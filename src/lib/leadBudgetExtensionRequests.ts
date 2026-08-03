import { supabase } from './supabase';
import {
  fetchCurrentEmployeeContext,
  formatAllocationCostNis,
  formatAllocationWorkedDuration,
  normalizeEmployeeMinHours,
  salaryToHourlyRateNis,
  workedMsAtHourlyRateToCostNis,
  type LeadReportingType,
} from './employeeLeadReporting';
import { fetchAverageGrossSalaryLastMonths } from './employeeSalaries';

export type LeadBudgetExtensionStatus = 'pending' | 'approved' | 'declined';

export type LeadBudgetExtensionRequest = {
  id: number;
  createdAt: string;
  leadType: LeadReportingType | null;
  newLeadId: string | null;
  legacyLeadId: number | null;
  leadNumber: string | null;
  clientName: string | null;
  employeeId: number;
  employeeName: string;
  employeePhotoUrl: string | null;
  userId: string;
  requestedExtraMs: number;
  requestedExtraCostNis: number;
  requestReason: string;
  costAtRequestNis: number | null;
  maxAtRequestNis: number | null;
  workedMsAtRequest: number | null;
  status: LeadBudgetExtensionStatus;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedByEmployeeId: number | null;
  reviewerName: string | null;
  reviewedAt: string | null;
  approvedExtraCostNis: number | null;
};

export type LeadBudgetExtensionLeadRef = {
  leadType?: LeadReportingType | null;
  newLeadId?: string | null;
  legacyLeadId?: number | null;
  leadNumber?: string | null;
};

function leadMatchFilter(query: any, lead: LeadBudgetExtensionLeadRef) {
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

function mapRequestRow(row: any): LeadBudgetExtensionRequest {
  const emp = Array.isArray(row.tenants_employee) ? row.tenants_employee[0] : row.tenants_employee;
  const reviewerEmp = Array.isArray(row.reviewed_by_employee)
    ? row.reviewed_by_employee[0]
    : row.reviewed_by_employee;
  const photo =
    (typeof emp?.photo_url === 'string' && emp.photo_url.trim()) ||
    (typeof emp?.photo === 'string' && emp.photo.trim()) ||
    null;

  return {
    id: Number(row.id),
    createdAt: row.created_at,
    leadType: (row.lead_type as LeadReportingType | null) || null,
    newLeadId: row.new_lead_id || null,
    legacyLeadId: row.legacy_lead_id != null ? Number(row.legacy_lead_id) : null,
    leadNumber: row.lead_number != null ? String(row.lead_number) : null,
    clientName: row.client_name != null ? String(row.client_name) : null,
    employeeId: Number(row.employee_id),
    employeeName: emp?.display_name?.trim() || `Employee #${row.employee_id}`,
    employeePhotoUrl: photo,
    userId: row.user_id,
    requestedExtraMs: Number(row.requested_extra_ms) || 0,
    requestedExtraCostNis: Number(row.requested_extra_cost_nis) || 0,
    requestReason: String(row.request_reason || ''),
    costAtRequestNis:
      row.cost_at_request_nis != null ? Number(row.cost_at_request_nis) : null,
    maxAtRequestNis: row.max_at_request_nis != null ? Number(row.max_at_request_nis) : null,
    workedMsAtRequest:
      row.worked_ms_at_request != null ? Number(row.worked_ms_at_request) : null,
    status: row.status as LeadBudgetExtensionStatus,
    reviewNote: row.review_note != null ? String(row.review_note) : null,
    reviewedBy: row.reviewed_by || null,
    reviewedByEmployeeId:
      row.reviewed_by_employee_id != null ? Number(row.reviewed_by_employee_id) : null,
    reviewerName: reviewerEmp?.display_name?.trim() || null,
    reviewedAt: row.reviewed_at || null,
    approvedExtraCostNis:
      row.approved_extra_cost_nis != null ? Number(row.approved_extra_cost_nis) : null,
  };
}

const REQUEST_SELECT = `
  id,
  created_at,
  lead_type,
  new_lead_id,
  legacy_lead_id,
  lead_number,
  client_name,
  employee_id,
  user_id,
  requested_extra_ms,
  requested_extra_cost_nis,
  request_reason,
  cost_at_request_nis,
  max_at_request_nis,
  worked_ms_at_request,
  status,
  review_note,
  reviewed_by,
  reviewed_by_employee_id,
  reviewed_at,
  approved_extra_cost_nis,
  tenants_employee!employee_id (
    id,
    display_name,
    photo_url,
    photo
  ),
  reviewed_by_employee:tenants_employee!reviewed_by_employee_id (
    id,
    display_name
  )
`;

function postgrestOrEq(column: string, value: string | number): string {
  if (typeof value === 'number') return `${column}.eq.${value}`;
  const escaped = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `${column}.eq."${escaped}"`;
}

function leadNumberLookupCandidates(leadNumber: string | null | undefined): string[] {
  const raw = String(leadNumber || '').trim();
  if (!raw) return [];
  const base = raw.replace(/\/\d+$/, '');
  return base && base !== raw ? [raw, base] : [raw];
}

/**
 * Sum of approved extra cost for a lead (added on top of value-based max).
 * Matches by UUID / legacy id / lead_number (including base number without /N suffix).
 */
export async function fetchApprovedBudgetExtensionNis(
  lead: LeadBudgetExtensionLeadRef,
): Promise<number> {
  const orParts: string[] = [];
  if (lead.newLeadId) orParts.push(postgrestOrEq('new_lead_id', lead.newLeadId));
  if (lead.legacyLeadId != null && Number.isFinite(Number(lead.legacyLeadId))) {
    orParts.push(postgrestOrEq('legacy_lead_id', Number(lead.legacyLeadId)));
  }
  for (const num of leadNumberLookupCandidates(lead.leadNumber)) {
    orParts.push(postgrestOrEq('lead_number', num));
  }

  if (orParts.length === 0) return 0;

  const { data, error } = await supabase
    .from('lead_employee_budget_extension_requests')
    .select('id, approved_extra_cost_nis')
    .eq('status', 'approved')
    .or(orParts.join(','));

  if (error) {
    console.error('[leadBudgetExtension] approved sum failed:', error);
    return 0;
  }

  const seen = new Set<number>();
  let sum = 0;
  for (const row of data || []) {
    const id = Number(row.id);
    if (Number.isFinite(id)) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    sum += Number(row.approved_extra_cost_nis) || 0;
  }
  return Math.round(sum * 100) / 100;
}

export function applyBudgetExtensions(
  baseMaxAllowedCostNis: number,
  approvedExtraCostNis: number,
): number {
  return Math.round((Math.max(0, baseMaxAllowedCostNis) + Math.max(0, approvedExtraCostNis)) * 100) / 100;
}

export async function fetchLeadBudgetExtensionRequests(
  lead: LeadBudgetExtensionLeadRef,
): Promise<LeadBudgetExtensionRequest[]> {
  let query = supabase
    .from('lead_employee_budget_extension_requests')
    .select(REQUEST_SELECT)
    .order('created_at', { ascending: false });

  query = leadMatchFilter(query, lead);
  if (!query) return [];

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(mapRequestRow);
}

export async function fetchBudgetExtensionRequestsForLeads(
  leads: LeadBudgetExtensionLeadRef[],
): Promise<Map<string, LeadBudgetExtensionRequest[]>> {
  const byKey = new Map<string, LeadBudgetExtensionRequest[]>();
  if (leads.length === 0) return byKey;

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

  const chunks: any[] = [];

  if (newIds.length > 0) {
    const { data, error } = await supabase
      .from('lead_employee_budget_extension_requests')
      .select(REQUEST_SELECT)
      .in('new_lead_id', newIds)
      .order('created_at', { ascending: false });
    if (error) throw error;
    chunks.push(...(data || []));
  }
  if (legacyIds.length > 0) {
    const { data, error } = await supabase
      .from('lead_employee_budget_extension_requests')
      .select(REQUEST_SELECT)
      .in('legacy_lead_id', legacyIds)
      .order('created_at', { ascending: false });
    if (error) throw error;
    chunks.push(...(data || []));
  }
  if (leadNumbers.length > 0) {
    const { data, error } = await supabase
      .from('lead_employee_budget_extension_requests')
      .select(REQUEST_SELECT)
      .in('lead_number', leadNumbers)
      .order('created_at', { ascending: false });
    if (error) throw error;
    chunks.push(...(data || []));
  }

  const seen = new Set<number>();
  for (const raw of chunks) {
    const id = Number(raw.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const mapped = mapRequestRow(raw);
    const key =
      mapped.leadType === 'legacy' && mapped.legacyLeadId != null
        ? `legacy:${mapped.legacyLeadId}`
        : mapped.newLeadId
          ? `new:${mapped.newLeadId}`
          : mapped.leadNumber
            ? `number:${mapped.leadNumber}`
            : `id:${mapped.id}`;
    const list = byKey.get(key) || [];
    list.push(mapped);
    byKey.set(key, list);
  }

  return byKey;
}

export async function createLeadBudgetExtensionRequest(params: {
  leadType: LeadReportingType | null;
  newLeadId: string | null;
  legacyLeadId: number | null;
  leadNumber: string | null;
  clientName: string | null;
  requestedExtraMs: number;
  requestReason: string;
  costAtRequestNis: number;
  maxAtRequestNis: number;
  workedMsAtRequest: number;
  hourRateNis?: number | null;
}): Promise<LeadBudgetExtensionRequest> {
  const ctx = await fetchCurrentEmployeeContext();
  if (!ctx) throw new Error('Employee context required to request more budget');

  const reason = params.requestReason.trim();
  if (!reason) throw new Error('Please enter a reason for the request');
  if (!(params.requestedExtraMs > 0)) throw new Error('Please choose how much extra time to request');

  let hourRate = params.hourRateNis ?? null;
  if (hourRate == null || !(hourRate > 0)) {
    const salaryMap = await fetchAverageGrossSalaryLastMonths([ctx.employeeId], 6);
    const { data: emp } = await supabase
      .from('tenants_employee')
      .select('min_hours')
      .eq('id', ctx.employeeId)
      .maybeSingle();
    const minHours = normalizeEmployeeMinHours(emp?.min_hours);
    hourRate = salaryToHourlyRateNis(salaryMap.get(ctx.employeeId) ?? null, minHours);
  }

  const requestedExtraCostNis =
    workedMsAtHourlyRateToCostNis(params.requestedExtraMs, hourRate) ?? 0;

  const { data, error } = await supabase
    .from('lead_employee_budget_extension_requests')
    .insert({
      lead_type: params.leadType,
      new_lead_id: params.newLeadId,
      legacy_lead_id: params.legacyLeadId,
      lead_number: params.leadNumber,
      client_name: params.clientName,
      employee_id: ctx.employeeId,
      user_id: ctx.userId,
      requested_extra_ms: Math.round(params.requestedExtraMs),
      requested_extra_cost_nis: Math.round(requestedExtraCostNis * 100) / 100,
      request_reason: reason,
      cost_at_request_nis: Math.round(params.costAtRequestNis * 100) / 100,
      max_at_request_nis: Math.round(params.maxAtRequestNis * 100) / 100,
      worked_ms_at_request: Math.round(params.workedMsAtRequest),
      status: 'pending',
    })
    .select(REQUEST_SELECT)
    .single();

  if (error) throw error;
  return mapRequestRow(data);
}

export async function reviewLeadBudgetExtensionRequest(params: {
  requestId: number;
  decision: 'approved' | 'declined';
  reviewNote?: string | null;
  /** Defaults to requested_extra_cost_nis when approving */
  approvedExtraCostNis?: number | null;
}): Promise<LeadBudgetExtensionRequest> {
  const ctx = await fetchCurrentEmployeeContext();
  if (!ctx) throw new Error('Employee context required to review request');

  const { data: existing, error: fetchError } = await supabase
    .from('lead_employee_budget_extension_requests')
    .select('id, status, requested_extra_cost_nis')
    .eq('id', params.requestId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!existing) throw new Error('Request not found');
  if (existing.status !== 'pending') throw new Error('Request was already reviewed');

  const approvedExtra =
    params.decision === 'approved'
      ? params.approvedExtraCostNis != null && params.approvedExtraCostNis >= 0
        ? Math.round(params.approvedExtraCostNis * 100) / 100
        : Math.round(Number(existing.requested_extra_cost_nis) * 100) / 100
      : null;

  const { data, error } = await supabase
    .from('lead_employee_budget_extension_requests')
    .update({
      status: params.decision,
      review_note: params.reviewNote?.trim() || null,
      reviewed_by: ctx.userId,
      reviewed_by_employee_id: ctx.employeeId,
      reviewed_at: new Date().toISOString(),
      approved_extra_cost_nis: approvedExtra,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.requestId)
    .select(REQUEST_SELECT)
    .single();

  if (error) throw error;
  return mapRequestRow(data);
}

export { formatAllocationCostNis, formatAllocationWorkedDuration };
