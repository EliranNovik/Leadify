/**
 * The Helper Handler role, which unlike every other lead role can be held by several employees at
 * once.
 *
 * The assignments live in `lead_helper_handlers`, one row per employee per lead. `leads` and
 * `leads_lead` also carry a `helper_handler_ids` array, but a trigger derives it from this table —
 * nothing here writes it, and nothing should read it as the source of truth. See
 * sql/2026-10-13_lead_helper_handlers.sql.
 *
 * Takes the Supabase client as an argument like `leadSubEfforts` does, rather than importing the
 * singleton, so the pure parts can be tested without standing up a client.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { leadSubEffortIdentityFromClientId } from './leadSubEfforts';

/** Which of the two lead tables a client id belongs to, and its key there. */
export type LeadHelperHandlerIdentity = {
  newLeadId: string | null;
  legacyLeadId: number | null;
};

/**
 * Split a CRM client id into the key for whichever lead table owns it.
 *
 * Legacy ids reach the UI prefixed with `legacy_`. Delegated rather than reimplemented so the two
 * per-lead/per-employee features cannot disagree about what a client id means.
 */
export function leadHelperHandlerIdentity(
  clientId: string | number | null | undefined,
): LeadHelperHandlerIdentity {
  return leadSubEffortIdentityFromClientId(clientId == null ? null : String(clientId));
}

/**
 * Employee ids in the order the role should be displayed, with duplicates and junk removed.
 *
 * Sorted by id, matching what the trigger writes into `helper_handler_ids`, so the card and anything
 * reading the column list the same people in the same order.
 */
export function normalizeHelperHandlerIds(values: unknown[]): number[] {
  const ids = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  return [...new Set(ids)].sort((a, b) => a - b);
}

/** Whether an employee already holds the role, so the picker can leave them out. */
export function isHelperHandler(ids: number[], employeeId: unknown): boolean {
  const id = Number(employeeId);
  return Number.isFinite(id) && ids.includes(id);
}

/**
 * The row that records one assignment, or null when the client id belongs to neither lead table.
 *
 * Exported for the test that pins which lead key gets filled, since putting a legacy id in the uuid
 * column fails the table's check constraint rather than saving to the wrong place.
 */
export type LeadHelperHandlerRow = {
  new_lead_id: string | null;
  legacy_lead_id: number | null;
  employee_id: number;
  created_by: string | null;
};

export function buildHelperHandlerRow(
  clientId: string | number | null | undefined,
  employeeId: unknown,
  createdBy?: string | null,
): LeadHelperHandlerRow | null {
  const { newLeadId, legacyLeadId } = leadHelperHandlerIdentity(clientId);
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

/** Every employee holding the role on one lead. Empty for a lead that resolves to neither table. */
export async function fetchLeadHelperHandlerIds(
  supabase: SupabaseClient,
  clientId: string | number | null | undefined,
): Promise<number[]> {
  const { newLeadId, legacyLeadId } = leadHelperHandlerIdentity(clientId);
  if (!newLeadId && legacyLeadId == null) return [];

  let query = supabase.from('lead_helper_handlers').select('employee_id');
  query = newLeadId
    ? query.eq('new_lead_id', newLeadId)
    : query.eq('legacy_lead_id', legacyLeadId as number);

  const { data, error } = await query;
  if (error) throw error;
  return normalizeHelperHandlerIds((data ?? []).map((row: any) => row.employee_id));
}

/**
 * Give an employee the role on a lead.
 *
 * A unique violation means they already hold it, which is the desired end state, so it resolves
 * rather than throwing — two people adding the same person at once should not surface an error.
 */
export async function addLeadHelperHandler(
  supabase: SupabaseClient,
  params: {
    clientId: string | number | null | undefined;
    employeeId: unknown;
    createdBy?: string | null;
  },
): Promise<void> {
  const row = buildHelperHandlerRow(params.clientId, params.employeeId, params.createdBy);
  if (!row) throw new Error('Could not work out which lead to add the helper handler to.');

  const { error } = await supabase.from('lead_helper_handlers').insert(row);
  if (error && error.code !== '23505') throw error;
}

/** Take the role away from one employee on one lead. */
export async function removeLeadHelperHandler(
  supabase: SupabaseClient,
  params: {
    clientId: string | number | null | undefined;
    employeeId: unknown;
  },
): Promise<void> {
  const { newLeadId, legacyLeadId } = leadHelperHandlerIdentity(params.clientId);
  const employeeId = Number(params.employeeId);
  if (!Number.isFinite(employeeId)) return;
  if (!newLeadId && legacyLeadId == null) return;

  let query = supabase.from('lead_helper_handlers').delete().eq('employee_id', employeeId);
  query = newLeadId
    ? query.eq('new_lead_id', newLeadId)
    : query.eq('legacy_lead_id', legacyLeadId as number);

  const { error } = await query;
  if (error) throw error;
}
