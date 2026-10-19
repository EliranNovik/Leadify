/**
 * Filters for the Meeting tab list: a date range and a meeting type.
 *
 * The type is a `MeetingHeaderKind` so the filter and the header colours always agree on what an
 * external meeting is. Resolving that kind needs the participant list, which only the component
 * has, so callers resolve it and pass it in.
 */

import type { MeetingHeaderKind } from './meetingHeaderColors';

export type MeetingKindFilter = MeetingHeaderKind | 'all';

export interface MeetingFilterValues {
  dateFrom: string;
  dateTo: string;
  kind: MeetingKindFilter;
}

export const EMPTY_MEETING_FILTERS: MeetingFilterValues = {
  dateFrom: '',
  dateTo: '',
  kind: 'all',
};

export function hasActiveMeetingFilters(filters: MeetingFilterValues): boolean {
  return Boolean(filters.dateFrom || filters.dateTo || filters.kind !== 'all');
}

/** Meeting dates arrive as 'YYYY-MM-DD' or as a full timestamp; only the day matters here. */
function toYmd(value: string | null | undefined): string {
  return String(value ?? '').trim().slice(0, 10);
}

export function meetingMatchesFilters(
  meeting: { date?: string | null },
  kind: MeetingHeaderKind,
  filters: MeetingFilterValues,
): boolean {
  if (filters.kind !== 'all' && filters.kind !== kind) return false;

  const date = toYmd(meeting.date);
  // A meeting with no usable date cannot be placed in a range, so a range filter hides it.
  if (filters.dateFrom && (!date || date < toYmd(filters.dateFrom))) return false;
  if (filters.dateTo && (!date || date > toYmd(filters.dateTo))) return false;
  return true;
}

export const MEETING_KIND_FILTER_OPTIONS: Array<{ value: MeetingKindFilter; label: string }> = [
  { value: 'all', label: 'All types' },
  { value: 'active_client', label: 'Active client' },
  { value: 'potential_client', label: 'Potential client' },
  { value: 'internal_meeting', label: 'Internal meeting' },
  { value: 'external_meeting', label: 'External meeting' },
];
