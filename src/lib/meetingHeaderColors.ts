/**
 * Colour coding for the meeting card headers in the Meeting tab.
 *
 * The four kinds are not four values of one column: `calendar_type` only tells internal meetings
 * ('staff' / 'recruitment') apart from client meetings, so an internal meeting counts as external
 * once a firm contact or a free participant is on the guest list.
 */

export type MeetingHeaderKind =
  | 'active_client'
  | 'potential_client'
  | 'internal_meeting'
  | 'external_meeting';

export interface MeetingHeaderParticipant {
  type?: string | null;
}

/** Participant kinds that make an internal meeting an external one. */
const OUTSIDE_PARTICIPANT_TYPES = new Set(['firm', 'extern']);

const INTERNAL_CALENDAR_TYPES = new Set(['staff', 'recruitment']);

export function resolveMeetingHeaderKind(
  calendarType: string | null | undefined,
  participants?: MeetingHeaderParticipant[] | null,
): MeetingHeaderKind {
  if (INTERNAL_CALENDAR_TYPES.has(String(calendarType ?? ''))) {
    const hasOutsider = (participants ?? []).some((p) =>
      OUTSIDE_PARTICIPANT_TYPES.has(String(p?.type ?? '')),
    );
    return hasOutsider ? 'external_meeting' : 'internal_meeting';
  }
  if (calendarType === 'active_client') return 'active_client';
  return 'potential_client';
}

/** Dark enough for the white header text that sits on top of them. */
export const MEETING_HEADER_COLORS: Record<MeetingHeaderKind, string> = {
  active_client: '#15803D', // green — same family as the 'A' badge
  potential_client: '#0078D4', // Outlook blue
  internal_meeting: '#B45309', // amber — same family as the 'IM' badge
  external_meeting: '#6D28D9', // violet
};

export const MEETING_HEADER_KIND_LABELS: Record<MeetingHeaderKind, string> = {
  active_client: 'Active Client',
  potential_client: 'Potential Client',
  internal_meeting: 'Internal Meeting',
  external_meeting: 'Internal Meeting (External Participants)',
};
