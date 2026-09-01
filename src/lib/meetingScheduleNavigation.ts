/** Shared helpers for opening the schedule/reschedule UI (mobile sheet vs desktop page). */

import { buildClientRouteFromCombinedLead } from './leadContactSearchUi';

/** Decode a route param at most once so we never produce %252F when re-encoding. */
export function safeDecodeRouteParam(value: string): string {
  let current = String(value ?? '').trim();
  if (/%[0-9A-Fa-f]{2}/.test(current)) {
    try {
      current = decodeURIComponent(current);
    } catch {
      /* keep raw */
    }
  }
  return current;
}

export function normalizeLeadRouteKey(value: string | number | null | undefined): string {
  const key = safeDecodeRouteParam(String(value ?? '').trim());
  return key || 'unknown';
}

export function isMobileMeetingScheduleUi(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 767px)').matches;
}

export function getScheduleMeetingPath(leadNumber: string | number | null | undefined): string {
  const key = normalizeLeadRouteKey(leadNumber);
  return `/clients/${encodeURIComponent(key)}/schedule-meeting`;
}

export function getRescheduleMeetingPath(leadNumber: string | number | null | undefined): string {
  const key = normalizeLeadRouteKey(leadNumber);
  return `/clients/${encodeURIComponent(key)}/reschedule-meeting`;
}

/**
 * Canonical /clients/... path after schedule/reschedule — same rules as Clients / search.
 * Prefer the loaded client object so legacy sub-leads use ?lead= and new sub-leads encode once.
 */
const optimisticLeadStageById = new Map<string, { stage: number; until: number }>();
const OPTIMISTIC_STAGE_TTL_MS = 30_000;

/** Remember a just-written stage so the client page can paint it before refetch finishes. */
export function rememberOptimisticLeadStage(
  leadId: string | number | null | undefined,
  stage: number,
): void {
  const id = String(leadId ?? '').trim();
  if (!id || !Number.isFinite(stage)) return;
  optimisticLeadStageById.set(id, { stage, until: Date.now() + OPTIMISTIC_STAGE_TTL_MS });
  const bare = id.replace(/^legacy_/i, '');
  if (bare && bare !== id) {
    optimisticLeadStageById.set(bare, { stage, until: Date.now() + OPTIMISTIC_STAGE_TTL_MS });
  }
}

export function consumeOptimisticLeadStage(
  leadId: string | number | null | undefined,
): number | null {
  const id = String(leadId ?? '').trim();
  if (!id) return null;
  const bare = id.replace(/^legacy_/i, '');
  const hit = optimisticLeadStageById.get(id) || optimisticLeadStageById.get(bare);
  if (!hit) return null;
  optimisticLeadStageById.delete(id);
  if (bare) optimisticLeadStageById.delete(bare);
  if (Date.now() > hit.until) return null;
  return hit.stage;
}

export function getClientPagePathFromClient(
  client: {
    id?: string | number | null;
    lead_number?: string | null;
    lead_type?: string | null;
    manual_id?: string | number | null;
  } | null | undefined,
  fallbackLeadParam?: string | null,
): string {
  if (client?.id != null || client?.lead_number) {
    const leadNumber = String(client.lead_number || '').trim();
    const id = String(client.id ?? leadNumber);
    const leadType =
      client.lead_type === 'legacy' || id.startsWith('legacy_') ? 'legacy' : 'new';
    return buildClientRouteFromCombinedLead({
      id,
      lead_number: leadNumber,
      lead_type: leadType,
      manual_id: client.manual_id != null ? String(client.manual_id) : undefined,
    });
  }

  const fallback = normalizeLeadRouteKey(fallbackLeadParam);
  if (!fallback || fallback === 'unknown') return '/clients';
  return `/clients/${encodeURIComponent(fallback)}`;
}
