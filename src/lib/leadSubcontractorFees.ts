import { supabase } from './supabase';

export type LeadSubcontractorFeeRow = {
  id: number;
  created_at: string;
  updated_at: string;
  lead_type: 'new' | 'legacy' | null;
  new_lead_id: string | null;
  legacy_lead_id: number | null;
  lead_number: string | null;
  firm_id: string;
  amount: number;
  currency_id: number | null;
  notes: string | null;
  created_by: string | null;
  created_by_display_name?: string | null;
  firms?: { id: string; name: string } | null;
  accounting_currencies?: { id: number; name: string; iso_code: string | null } | null;
};

export type LeadFeeIdentity = {
  leadType: 'new' | 'legacy';
  newLeadId?: string | null;
  legacyLeadId?: number | null;
  leadNumber?: string | null;
};

export function resolveLeadFeeIdentity(client: {
  id?: string | number | null;
  lead_type?: string | null;
  lead_number?: string | null;
}): LeadFeeIdentity | null {
  if (!client?.id && !client?.lead_number) return null;
  const isLegacy =
    client.lead_type === 'legacy' || String(client.id ?? '').startsWith('legacy_');
  if (isLegacy) {
    const raw = String(client.id ?? '').replace(/^legacy_/i, '');
    const legacyLeadId = Number(raw);
    if (!Number.isFinite(legacyLeadId)) return null;
    return {
      leadType: 'legacy',
      legacyLeadId,
      leadNumber: client.lead_number ? String(client.lead_number) : null,
    };
  }
  return {
    leadType: 'new',
    newLeadId: client.id != null ? String(client.id) : null,
    leadNumber: client.lead_number ? String(client.lead_number) : null,
  };
}

/** Sum of fee amounts (numeric). Used for denormalized lead.subcontractor_fee + header Net. */
export function sumSubcontractorFeeAmounts(
  fees: Array<{ amount?: number | string | null }>,
): number {
  return fees.reduce((sum, fee) => {
    const n = Number(fee.amount ?? 0);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

const FEE_TOTALS_CHUNK = 200;

async function sumFeesGrouped(
  column: 'new_lead_id' | 'legacy_lead_id',
  ids: Array<string | number>,
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (ids.length === 0) return totals;

  for (let i = 0; i < ids.length; i += FEE_TOTALS_CHUNK) {
    const chunk = ids.slice(i, i + FEE_TOTALS_CHUNK);
    const { data, error } = await supabase
      .from('lead_subcontractor_fees')
      .select(`${column}, amount`)
      .in(column, chunk);
    if (error) throw error;
    for (const row of data || []) {
      const key = String((row as any)[column] ?? '');
      if (!key) continue;
      const amount = Number((row as any).amount ?? 0);
      if (!Number.isFinite(amount)) continue;
      totals.set(key, (totals.get(key) || 0) + amount);
    }
  }
  return totals;
}

export type LeadSubcontractorFeeTotalsMaps = {
  byNewLeadId: Map<string, number>;
  byLegacyLeadId: Map<number, number>;
};

/**
 * Batch SUM(amount) from lead_subcontractor_fees for many leads.
 * Leads with no fee rows are omitted from the maps (caller should fall back to leads.subcontractor_fee).
 */
export async function fetchSubcontractorFeeTotalsByLeadIds(params: {
  newLeadIds?: Array<string | null | undefined>;
  legacyLeadIds?: Array<number | string | null | undefined>;
}): Promise<LeadSubcontractorFeeTotalsMaps> {
  const newIds = Array.from(
    new Set(
      (params.newLeadIds || [])
        .map((id) => (id == null ? '' : String(id).trim()))
        .filter(Boolean),
    ),
  );
  const legacyIds = Array.from(
    new Set(
      (params.legacyLeadIds || [])
        .map((id) => {
          if (id == null || id === '') return NaN;
          const n = Number(String(id).replace(/^legacy_/i, ''));
          return Number.isFinite(n) ? n : NaN;
        })
        .filter((n) => Number.isFinite(n)),
    ),
  );

  const [newTotals, legacyTotalsRaw] = await Promise.all([
    sumFeesGrouped('new_lead_id', newIds),
    sumFeesGrouped('legacy_lead_id', legacyIds),
  ]);

  const byLegacyLeadId = new Map<number, number>();
  for (const [key, sum] of legacyTotalsRaw) {
    const n = Number(key);
    if (Number.isFinite(n)) byLegacyLeadId.set(n, Math.round(sum * 100) / 100);
  }

  const byNewLeadId = new Map<string, number>();
  for (const [key, sum] of newTotals) {
    byNewLeadId.set(key, Math.round(sum * 100) / 100);
  }

  return { byNewLeadId, byLegacyLeadId };
}

/** Prefer fee-table sum when present; otherwise denormalized leads.subcontractor_fee. */
export function resolveLeadSubcontractorFeeAmount(
  lead: { id?: string | number | null; subcontractor_fee?: unknown },
  maps: LeadSubcontractorFeeTotalsMaps | null | undefined,
  kind: 'new' | 'legacy',
): number {
  if (maps) {
    if (kind === 'new') {
      const id = lead?.id != null ? String(lead.id) : '';
      if (id && maps.byNewLeadId.has(id)) return maps.byNewLeadId.get(id) || 0;
    } else {
      const raw = lead?.id != null ? String(lead.id).replace(/^legacy_/i, '') : '';
      const id = Number(raw);
      if (Number.isFinite(id) && maps.byLegacyLeadId.has(id)) {
        return maps.byLegacyLeadId.get(id) || 0;
      }
    }
  }
  const n = Number(lead?.subcontractor_fee ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Patch lead.subcontractor_fee from fee-table totals (in place) for report/dashboard math. */
export function applySubcontractorFeeTotalsToLeads<T extends { id?: any; subcontractor_fee?: any }>(
  leads: T[],
  maps: LeadSubcontractorFeeTotalsMaps,
  kind: 'new' | 'legacy',
): T[] {
  for (const lead of leads) {
    lead.subcontractor_fee = resolveLeadSubcontractorFeeAmount(lead, maps, kind);
  }
  return leads;
}

async function enrichFeesWithCreatorNames(
  rows: LeadSubcontractorFeeRow[],
): Promise<LeadSubcontractorFeeRow[]> {
  const authIds = Array.from(
    new Set(rows.map((r) => r.created_by).filter((id): id is string => Boolean(id))),
  );
  if (authIds.length === 0) return rows;

  const { data: usersData, error: usersError } = await supabase
    .from('users')
    .select('auth_id, employee_id, full_name, first_name, last_name')
    .in('auth_id', authIds);
  if (usersError) {
    console.warn('[leadSubcontractorFees] creator users lookup:', usersError);
    return rows;
  }

  const users = usersData || [];
  const employeeIds = Array.from(
    new Set(
      users
        .map((u: any) => u.employee_id)
        .filter((id: unknown) => id != null && id !== '')
        .map((id: any) => Number(id))
        .filter((id: number) => Number.isFinite(id)),
    ),
  );

  const employeeNameById = new Map<number, string>();
  if (employeeIds.length > 0) {
    const { data: employees, error: empError } = await supabase
      .from('tenants_employee')
      .select('id, display_name')
      .in('id', employeeIds);
    if (empError) {
      console.warn('[leadSubcontractorFees] creator employees lookup:', empError);
    } else {
      for (const emp of employees || []) {
        const name = String((emp as any).display_name || '').trim();
        if (name) employeeNameById.set(Number((emp as any).id), name);
      }
    }
  }

  const nameByAuthId = new Map<string, string>();
  for (const u of users) {
    const authId = String((u as any).auth_id || '');
    if (!authId) continue;
    const empId = (u as any).employee_id != null ? Number((u as any).employee_id) : NaN;
    const fromEmployee = Number.isFinite(empId) ? employeeNameById.get(empId) : null;
    const fromUser =
      String((u as any).full_name || '').trim() ||
      [String((u as any).first_name || '').trim(), String((u as any).last_name || '').trim()]
        .filter(Boolean)
        .join(' ');
    const name = fromEmployee || fromUser;
    if (name) nameByAuthId.set(authId, name);
  }

  return rows.map((row) => ({
    ...row,
    created_by_display_name: row.created_by ? nameByAuthId.get(row.created_by) || null : null,
  }));
}

function normalizeFeeRow(row: any): LeadSubcontractorFeeRow {
  return {
    ...row,
    amount: Number(row.amount ?? 0),
    created_by: row.created_by ?? null,
    created_by_display_name: row.created_by_display_name ?? null,
    firms: Array.isArray(row.firms) ? row.firms[0] ?? null : row.firms ?? null,
    accounting_currencies: Array.isArray(row.accounting_currencies)
      ? row.accounting_currencies[0] ?? null
      : row.accounting_currencies ?? null,
  } as LeadSubcontractorFeeRow;
}

export async function fetchLeadSubcontractorFees(
  identity: LeadFeeIdentity,
): Promise<LeadSubcontractorFeeRow[]> {
  let query = supabase
    .from('lead_subcontractor_fees')
    .select(
      `
      id,
      created_at,
      updated_at,
      lead_type,
      new_lead_id,
      legacy_lead_id,
      lead_number,
      firm_id,
      amount,
      currency_id,
      notes,
      created_by,
      firms:firm_id ( id, name ),
      accounting_currencies:currency_id ( id, name, iso_code )
    `,
    )
    .order('created_at', { ascending: false });

  if (identity.leadType === 'legacy' && identity.legacyLeadId != null) {
    query = query.eq('legacy_lead_id', identity.legacyLeadId);
  } else if (identity.newLeadId) {
    query = query.eq('new_lead_id', identity.newLeadId);
  } else {
    return [];
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data || []).map(normalizeFeeRow);
  return enrichFeesWithCreatorNames(rows);
}

export async function insertLeadSubcontractorFee(input: {
  identity: LeadFeeIdentity;
  firmId: string;
  amount: number;
  currencyId: number | null;
  notes?: string | null;
  createdBy?: string | null;
}): Promise<LeadSubcontractorFeeRow> {
  const payload = {
    lead_type: input.identity.leadType,
    new_lead_id: input.identity.leadType === 'new' ? input.identity.newLeadId : null,
    legacy_lead_id: input.identity.leadType === 'legacy' ? input.identity.legacyLeadId : null,
    lead_number: input.identity.leadNumber || null,
    firm_id: input.firmId,
    amount: input.amount,
    currency_id: input.currencyId,
    notes: input.notes?.trim() || null,
    created_by: input.createdBy || null,
    updated_by: input.createdBy || null,
  };

  const { data, error } = await supabase
    .from('lead_subcontractor_fees')
    .insert(payload)
    .select(
      `
      id,
      created_at,
      updated_at,
      lead_type,
      new_lead_id,
      legacy_lead_id,
      lead_number,
      firm_id,
      amount,
      currency_id,
      notes,
      created_by,
      firms:firm_id ( id, name ),
      accounting_currencies:currency_id ( id, name, iso_code )
    `,
    )
    .single();

  if (error) throw error;
  const [enriched] = await enrichFeesWithCreatorNames([normalizeFeeRow(data)]);
  return enriched;
}

export async function updateLeadSubcontractorFeeNotes(input: {
  feeId: number;
  notes: string | null;
  updatedBy?: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from('lead_subcontractor_fees')
    .update({
      notes: input.notes?.trim() || null,
      updated_at: new Date().toISOString(),
      updated_by: input.updatedBy || null,
    })
    .eq('id', input.feeId);
  if (error) throw error;
}

export async function updateLeadSubcontractorFee(input: {
  feeId: number;
  firmId: string;
  amount: number;
  currencyId: number | null;
  notes?: string | null;
  updatedBy?: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from('lead_subcontractor_fees')
    .update({
      firm_id: input.firmId,
      amount: input.amount,
      currency_id: input.currencyId,
      notes: input.notes?.trim() || null,
      updated_at: new Date().toISOString(),
      updated_by: input.updatedBy || null,
    })
    .eq('id', input.feeId);
  if (error) throw error;
}

export async function deleteLeadSubcontractorFee(feeId: number): Promise<void> {
  const { error } = await supabase.from('lead_subcontractor_fees').delete().eq('id', feeId);
  if (error) throw error;
}

/** Write leads / leads_lead.subcontractor_fee directly (legacy scalar or after clearing fee lines). */
export async function setLeadSubcontractorFeeScalar(
  identity: LeadFeeIdentity,
  feeAmount: number,
): Promise<number> {
  const value = Number.isFinite(feeAmount) ? Math.round(feeAmount * 100) / 100 : 0;
  if (identity.leadType === 'legacy' && identity.legacyLeadId != null) {
    const { error } = await supabase
      .from('leads_lead')
      .update({ subcontractor_fee: value })
      .eq('id', identity.legacyLeadId);
    if (error) throw error;
    return value;
  }
  if (identity.newLeadId) {
    const { error } = await supabase
      .from('leads')
      .update({ subcontractor_fee: value })
      .eq('id', identity.newLeadId);
    if (error) throw error;
    return value;
  }
  throw new Error('Lead identity missing');
}

/** Delete all fee line items for a lead (trigger will zero subcontractor_fee). */
export async function deleteAllLeadSubcontractorFees(identity: LeadFeeIdentity): Promise<void> {
  let query = supabase.from('lead_subcontractor_fees').delete();
  if (identity.leadType === 'legacy' && identity.legacyLeadId != null) {
    query = query.eq('legacy_lead_id', identity.legacyLeadId);
  } else if (identity.newLeadId) {
    query = query.eq('new_lead_id', identity.newLeadId);
  } else {
    throw new Error('Lead identity missing');
  }
  const { error } = await query;
  if (error) throw error;
}

/** @deprecated Prefer setLeadSubcontractorFeeScalar. Kept for scripts. */
export async function syncLeadSubcontractorFeeScalar(
  identity: LeadFeeIdentity,
  feeSum: number,
): Promise<void> {
  await setLeadSubcontractorFeeScalar(identity, feeSum);
}

export function dispatchSubcontractorFeesChanged(detail?: {
  leadId?: string | number | null;
  feeSum?: number;
}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('subcontractorFees:changed', { detail: detail || {} }),
  );
}
