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
