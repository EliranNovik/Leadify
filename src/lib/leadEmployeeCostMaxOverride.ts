import { supabase } from './supabase';
import type { LeadReportingType } from './employeeLeadReporting';
import { applyBudgetExtensions, type LeadBudgetExtensionLeadRef } from './leadBudgetExtensionRequests';

export type LeadCostMaxOverrideLeadRef = LeadBudgetExtensionLeadRef;

function leadMatchFilter(query: any, lead: LeadCostMaxOverrideLeadRef) {
  if (lead.leadType === 'legacy' && lead.legacyLeadId != null) {
    return query.eq('legacy_lead_id', lead.legacyLeadId);
  }
  if (lead.newLeadId) {
    return query.eq('new_lead_id', lead.newLeadId);
  }
  if (lead.leadNumber) {
    return query.eq('lead_number', lead.leadNumber);
  }
  return null;
}

export function leadOverrideStorageKey(lead: LeadCostMaxOverrideLeadRef): string | null {
  if (lead.leadType === 'legacy' && lead.legacyLeadId != null) {
    return `legacy:${lead.legacyLeadId}`;
  }
  if (lead.newLeadId) return `new:${lead.newLeadId}`;
  if (lead.leadNumber) return `number:${lead.leadNumber}`;
  return null;
}

/** Effective max: absolute override when set, otherwise formula + approved extensions. */
export function resolveEffectiveMaxAllowedCostNis(params: {
  baseMaxAllowedCostNis: number;
  approvedExtensionCostNis: number;
  maxOverrideNis: number | null | undefined;
}): number {
  if (params.maxOverrideNis != null && Number.isFinite(params.maxOverrideNis)) {
    return Math.round(Math.max(0, Number(params.maxOverrideNis)) * 100) / 100;
  }
  return applyBudgetExtensions(params.baseMaxAllowedCostNis, params.approvedExtensionCostNis);
}

export async function fetchLeadCostMaxOverrideNis(
  lead: LeadCostMaxOverrideLeadRef,
): Promise<number | null> {
  let query = supabase
    .from('lead_employee_cost_max_overrides')
    .select('max_allowed_cost_nis')
    .limit(1);

  query = leadMatchFilter(query, lead);
  if (!query) return null;

  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error('[leadCostMaxOverride] fetch failed:', error);
    return null;
  }
  if (data?.max_allowed_cost_nis == null) return null;
  const n = Number(data.max_allowed_cost_nis);
  return Number.isFinite(n) ? Math.round(Math.max(0, n) * 100) / 100 : null;
}

export async function fetchLeadCostMaxOverridesForLeads(
  leads: LeadCostMaxOverrideLeadRef[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (leads.length === 0) return map;

  const newIds = Array.from(
    new Set(leads.map((l) => l.newLeadId).filter((id): id is string => Boolean(id))),
  );
  const legacyIds = Array.from(
    new Set(
      leads
        .map((l) => l.legacyLeadId)
        .filter((id): id is number => id != null && Number.isFinite(id)),
    ),
  );
  const leadNumbers = Array.from(
    new Set(
      leads
        .filter((l) => !l.newLeadId && l.legacyLeadId == null && l.leadNumber)
        .map((l) => String(l.leadNumber)),
    ),
  );

  const rows: any[] = [];
  if (newIds.length > 0) {
    const { data, error } = await supabase
      .from('lead_employee_cost_max_overrides')
      .select('new_lead_id, legacy_lead_id, lead_number, max_allowed_cost_nis')
      .in('new_lead_id', newIds);
    if (error) throw error;
    rows.push(...(data || []));
  }
  if (legacyIds.length > 0) {
    const { data, error } = await supabase
      .from('lead_employee_cost_max_overrides')
      .select('new_lead_id, legacy_lead_id, lead_number, max_allowed_cost_nis')
      .in('legacy_lead_id', legacyIds);
    if (error) throw error;
    rows.push(...(data || []));
  }
  if (leadNumbers.length > 0) {
    const { data, error } = await supabase
      .from('lead_employee_cost_max_overrides')
      .select('new_lead_id, legacy_lead_id, lead_number, max_allowed_cost_nis')
      .in('lead_number', leadNumbers)
      .is('new_lead_id', null)
      .is('legacy_lead_id', null);
    if (error) throw error;
    rows.push(...(data || []));
  }

  for (const row of rows) {
    const n = Number(row.max_allowed_cost_nis);
    if (!Number.isFinite(n)) continue;
    const value = Math.round(Math.max(0, n) * 100) / 100;
    if (row.new_lead_id) map.set(`new:${row.new_lead_id}`, value);
    if (row.legacy_lead_id != null) map.set(`legacy:${row.legacy_lead_id}`, value);
    if (row.lead_number && !row.new_lead_id && row.legacy_lead_id == null) {
      map.set(`number:${row.lead_number}`, value);
    }
  }

  return map;
}

export async function upsertLeadCostMaxOverride(params: {
  leadType: LeadReportingType | null;
  newLeadId: string | null;
  legacyLeadId: number | null;
  leadNumber: string | null;
  maxAllowedCostNis: number;
}): Promise<void> {
  const maxAllowedCostNis = Math.round(Math.max(0, Number(params.maxAllowedCostNis) || 0) * 100) / 100;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Not authenticated');

  let employeeId: number | null = null;
  const { data: userRow } = await supabase
    .from('users')
    .select('employee_id')
    .eq('auth_id', user.id)
    .maybeSingle();
  if (userRow?.employee_id != null) employeeId = Number(userRow.employee_id);

  const leadRef: LeadCostMaxOverrideLeadRef = {
    leadType: params.leadType,
    newLeadId: params.newLeadId,
    legacyLeadId: params.legacyLeadId,
    leadNumber: params.leadNumber,
  };

  let existingQuery = supabase.from('lead_employee_cost_max_overrides').select('id').limit(1);
  existingQuery = leadMatchFilter(existingQuery, leadRef);
  if (!existingQuery) throw new Error('Missing lead identity for max override');

  const { data: existing } = await existingQuery.maybeSingle();

  const payload = {
    max_allowed_cost_nis: maxAllowedCostNis,
    updated_at: new Date().toISOString(),
    updated_by: user.id,
    updated_by_employee_id: employeeId,
    lead_type: params.leadType,
    new_lead_id: params.newLeadId,
    legacy_lead_id: params.legacyLeadId,
    lead_number: params.leadNumber && params.leadNumber !== '—' ? params.leadNumber : null,
  };

  if (existing?.id != null) {
    const { error } = await supabase
      .from('lead_employee_cost_max_overrides')
      .update(payload)
      .eq('id', existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from('lead_employee_cost_max_overrides').insert(payload);
  if (error) throw error;
}

export async function clearLeadCostMaxOverride(lead: LeadCostMaxOverrideLeadRef): Promise<void> {
  let query = supabase.from('lead_employee_cost_max_overrides').delete();
  query = leadMatchFilter(query, lead);
  if (!query) throw new Error('Missing lead identity for max override');
  const { error } = await query;
  if (error) throw error;
}

export async function leadHasPaymentPlan(params: {
  leadType: LeadReportingType | null;
  newLeadId: string | null;
  legacyLeadId: number | null;
}): Promise<boolean> {
  if (params.leadType === 'legacy' && params.legacyLeadId != null) {
    const { data, error } = await supabase
      .from('finances_paymentplanrow')
      .select('id')
      .eq('lead_id', params.legacyLeadId)
      .is('cancel_date', null)
      .limit(1);
    if (error) {
      console.error('[leadHasPaymentPlan] legacy failed:', error);
      throw error;
    }
    // Any active plan row (including expenses) locks Total.
    return (data || []).length > 0;
  }

  if (params.newLeadId) {
    const { data, error } = await supabase
      .from('payment_plans')
      .select('id')
      .or(`lead_id.eq.${params.newLeadId},lead_ids.eq.${params.newLeadId}`)
      .is('cancel_date', null)
      .limit(1);
    if (error) {
      console.error('[leadHasPaymentPlan] new failed:', error);
      throw error;
    }
    return (data || []).length > 0;
  }

  return false;
}

/**
 * Update stored lead value used for employee-cost budget (no payment plan).
 * New leads: balance + proposal_total. Legacy: total_base (NIS) / total.
 */
export async function updateLeadTotalValueNis(params: {
  leadType: LeadReportingType | null;
  newLeadId: string | null;
  legacyLeadId: number | null;
  newValueNis: number;
}): Promise<void> {
  const value = Math.round(Math.max(0, Number(params.newValueNis) || 0) * 100) / 100;

  const hasPlan = await leadHasPaymentPlan(params);
  if (hasPlan) {
    throw new Error('This lead has a payment plan');
  }

  if (params.leadType === 'legacy' && params.legacyLeadId != null) {
    const { data: legacy, error: fetchError } = await supabase
      .from('leads_lead')
      .select('id, currency_id')
      .eq('id', params.legacyLeadId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!legacy) throw new Error('Lead not found');

    const currencyId = Number(legacy.currency_id) || 1;
    const updatePayload =
      currencyId === 1
        ? { total_base: value, total: value }
        : { total: value, total_base: value };

    const { error } = await supabase
      .from('leads_lead')
      .update(updatePayload)
      .eq('id', params.legacyLeadId);
    if (error) throw error;
    return;
  }

  if (!params.newLeadId) throw new Error('Missing lead id');

  const { error } = await supabase
    .from('leads')
    .update({ balance: value, proposal_total: value })
    .eq('id', params.newLeadId);
  if (error) throw error;
}
