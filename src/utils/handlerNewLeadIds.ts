import { supabase } from '../lib/supabase';
import { newLeadFieldMatchesEmployee } from './rolePercentageCalculator';

/**
 * New `leads` table rows where the employee is the case handler, same rules as
 * `EmployeeRoleLeadsModal` / role matching: `case_handler_id`, `handler` as id string, or
 * name match via `newLeadFieldMatchesEmployee` (incl. ilike display name candidates).
 * This is stricter and broader than a single PostgREST `.or(handler.eq.name, case_handler_id)`,
 * which misses `handler` stored as numeric id string.
 */
export async function resolveNewLeadIdsForHandler(
  employeeId: number,
  employeeDisplayName: string
): Promise<string[]> {
  const [byCaseHandler, byHandlerFieldId, byHandlerIlike] = await Promise.all([
    supabase.from('leads').select('id, handler, case_handler_id').eq('case_handler_id', employeeId),
    supabase.from('leads').select('id, handler, case_handler_id').eq('handler', String(employeeId)),
    employeeDisplayName?.trim()
      ? supabase
          .from('leads')
          .select('id, handler, case_handler_id')
          .ilike('handler', employeeDisplayName.trim())
      : Promise.resolve({ data: [] as { id: string; handler: unknown; case_handler_id: unknown }[], error: null as any }),
  ]);

  const handlerRowsMap = new Map<string, { id: string; handler: unknown; case_handler_id: unknown }>();
  for (const r of byCaseHandler.data || []) {
    if (r?.id) handlerRowsMap.set(String(r.id), r);
  }
  for (const r of byHandlerFieldId.data || []) {
    if (r?.id) handlerRowsMap.set(String(r.id), r);
  }
  for (const r of (byHandlerIlike as { data?: { id: string; handler: unknown; case_handler_id: unknown }[] }).data || []) {
    if (r?.id) handlerRowsMap.set(String(r.id), r);
  }

  const out: string[] = [];
  for (const r of handlerRowsMap.values()) {
    const asCase = r.case_handler_id != null && Number(r.case_handler_id) === employeeId;
    if (asCase) {
      if (r.id) out.push(String(r.id));
      continue;
    }
    if (newLeadFieldMatchesEmployee(r.handler, employeeId, employeeDisplayName)) {
      if (r.id) out.push(String(r.id));
    }
  }
  return out;
}

/**
 * Employee IDs to load from `tenants_employee` for a new `leads` row.
 * `case_handler_id` and numeric `handler` (number or string of digits) both count.
 * Text names in `handler` are not IDs — ignore here.
 */
export function collectHandlerEmployeeIdsForLookup(lead: {
  case_handler_id?: unknown;
  handler?: unknown;
}): number[] {
  const ids: number[] = [];
  if (lead.case_handler_id != null && String(lead.case_handler_id).trim() !== '') {
    const n = Number(lead.case_handler_id);
    if (!Number.isNaN(n) && n > 0) {
      ids.push(n);
    }
  }
  if (lead.handler == null || lead.handler === '') {
    return ids;
  }
  if (typeof lead.handler === 'number' && !Number.isNaN(lead.handler) && lead.handler > 0) {
    ids.push(lead.handler);
    return ids;
  }
  if (typeof lead.handler === 'string') {
    const t = lead.handler.trim();
    if (t && /^\d+$/.test(t)) {
      const n = Number(t);
      if (!Number.isNaN(n) && n > 0) {
        ids.push(n);
      }
    }
  }
  return ids;
}

/**
 * Show handler like the app stores it: prefer `tenants_employee` display_name for
 * `case_handler_id` and for numeric `handler` (id stored as id); else use
 * `handler` when it is a non-numeric string (text name on the lead).
 */
export function getNewLeadHandlerDisplayName(
  lead: { case_handler_id?: unknown; handler?: unknown },
  idToName: Map<number, string>
): string {
  if (lead.case_handler_id != null && String(lead.case_handler_id).trim() !== '') {
    const n = Number(lead.case_handler_id);
    if (!Number.isNaN(n) && n > 0) {
      const name = idToName.get(n);
      if (name) return name;
    }
  }
  if (lead.handler != null && lead.handler !== '') {
    if (typeof lead.handler === 'number' && !Number.isNaN(lead.handler) && lead.handler > 0) {
      return idToName.get(lead.handler) || '—';
    }
    if (typeof lead.handler === 'string') {
      const t = lead.handler.trim();
      if (!t) return '—';
      if (/^\d+$/.test(t)) {
        const n = Number(t);
        if (!Number.isNaN(n) && n > 0) {
          return idToName.get(n) || t;
        }
        return t;
      }
      return t;
    }
  }
  return '—';
}

/** Same UTC day bounds as SalesContributionPage `computeDateBounds` — use for `due_date` / stage `date` filters. */
export function paymentDueDateBoundsUtc(
  fromDate?: string,
  toDate?: string
): { startIso: string | null; endIso: string | null } {
  const startIso = fromDate ? `${fromDate}T00:00:00.000Z` : null;
  const endIso = (() => {
    if (toDate) return `${toDate}T23:59:59.999Z`;
    if (fromDate) return `${fromDate}T23:59:59.999Z`;
    return null;
  })();
  return { startIso, endIso };
}
