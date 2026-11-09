/**
 * Submission Manager, held by several employees on one lead.
 *
 * Assignments live in `lead_submission_managers`. A trigger copies them onto
 * `submission_manager_ids` and sets `submission_manager_id` to the first employee
 * so the header still has one person. See sql/2026-11-09_lead_submission_managers.sql.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { leadSubEffortIdentityFromClientId } from './leadSubEfforts';

export type LeadSubmissionManagerIdentity = {
  newLeadId: string | null;
  legacyLeadId: number | null;
};

export function leadSubmissionManagerIdentity(
  clientId: string | number | null | undefined,
): LeadSubmissionManagerIdentity {
  return leadSubEffortIdentityFromClientId(clientId == null ? null : String(clientId));
}

export function normalizeSubmissionManagerIds(values: unknown[]): number[] {
  const ids = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  return [...new Set(ids)].sort((a, b) => a - b);
}

export function isSubmissionManager(ids: number[], employeeId: unknown): boolean {
  const id = Number(employeeId);
  return Number.isFinite(id) && ids.includes(id);
}

export type LeadSubmissionManagerRow = {
  new_lead_id: string | null;
  legacy_lead_id: number | null;
  employee_id: number;
  created_by: string | null;
};

export function buildSubmissionManagerRow(
  clientId: string | number | null | undefined,
  employeeId: unknown,
  createdBy?: string | null,
): LeadSubmissionManagerRow | null {
  const { newLeadId, legacyLeadId } = leadSubmissionManagerIdentity(clientId);
  const id = Number(employeeId);
  if (!Number.isFinite(id) || id <= 0) return null;
  if (!newLeadId && legacyLeadId == null) return null;

  return {
    new_lead_id: newLeadId,
    legacy_lead_id: newLeadId ? null : legacyLeadId,
    employee_id: id,
    created_by: createdBy ? String(createdBy) : null,
  };
}

export async function fetchLeadSubmissionManagerIds(
  supabase: SupabaseClient,
  clientId: string | number | null | undefined,
): Promise<number[]> {
  const { newLeadId, legacyLeadId } = leadSubmissionManagerIdentity(clientId);
  if (!newLeadId && legacyLeadId == null) return [];

  let query = supabase.from('lead_submission_managers').select('employee_id');
  query = newLeadId
    ? query.eq('new_lead_id', newLeadId)
    : query.eq('legacy_lead_id', legacyLeadId as number);

  const { data, error } = await query;
  if (error) throw error;
  return normalizeSubmissionManagerIds((data ?? []).map((row: any) => row.employee_id));
}

export async function addLeadSubmissionManager(
  supabase: SupabaseClient,
  params: {
    clientId: string | number | null | undefined;
    employeeId: unknown;
    createdBy?: string | null;
  },
): Promise<void> {
  const row = buildSubmissionManagerRow(params.clientId, params.employeeId, params.createdBy);
  if (!row) throw new Error('Could not work out which lead to add the submission manager to.');

  const { error } = await supabase.from('lead_submission_managers').insert(row);
  if (error && error.code !== '23505') throw error;
}

export async function removeLeadSubmissionManager(
  supabase: SupabaseClient,
  params: {
    clientId: string | number | null | undefined;
    employeeId: unknown;
  },
): Promise<void> {
  const { newLeadId, legacyLeadId } = leadSubmissionManagerIdentity(params.clientId);
  const employeeId = Number(params.employeeId);
  if (!Number.isFinite(employeeId)) return;
  if (!newLeadId && legacyLeadId == null) return;

  let query = supabase.from('lead_submission_managers').delete().eq('employee_id', employeeId);
  query = newLeadId
    ? query.eq('new_lead_id', newLeadId)
    : query.eq('legacy_lead_id', legacyLeadId as number);

  const { error } = await query;
  if (error) throw error;
}
