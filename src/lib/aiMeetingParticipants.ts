import { supabase } from './supabase';
import { syncMeetingAttendeesDisplayColumn } from './staffMeetingParticipants';
import {
  formatMeetingDate,
  loadActiveLeadMeetings,
  type AiMeetingGuest,
  type AiMeetingLead,
} from './aiMeetingBooking';

/**
 * Changing who is on a meeting that already exists.
 *
 * Asking for a guest to be added to Tuesday's hearing is not asking for a second hearing, so this
 * never books anything: it finds the meeting the person meant and edits its participant rows. When
 * the words they used fit more than one meeting, or none, it says so instead of guessing.
 */

/** One of the lead's meetings, flattened for matching against what the user said. */
export type EditableMeeting = {
  id: number;
  date: string;
  time: string;
  location: string;
  calendarType: string;
};

/** A row of `meeting_participants`, with a name to show and to match a removal against. */
export type MeetingAttendee = {
  rowId: string;
  kind: 'staff' | 'firm' | 'guest';
  name: string;
  employeeId: number | null;
  email: string | null;
};

const clean = (value: unknown): string => String(value ?? '').trim();

/** `14:00`, so a time typed with seconds still compares. */
const shortTime = (value: unknown): string => clean(value).slice(0, 5);

export type MeetingPick =
  | { status: 'picked'; meeting: EditableMeeting }
  | { status: 'none'; meetings: EditableMeeting[] }
  | { status: 'ambiguous'; meetings: EditableMeeting[] };

/**
 * Work out which meeting was meant from the date, time or place they mentioned.
 *
 * Everything they said has to agree: a court meeting at five when the court meeting is at nine is
 * answered with the lead's real meetings so they can be asked, because editing a different meeting
 * than the one described is worse than one more question. The place is matched loosely in both
 * directions, so "the court meeting" finds Court and "ministry" finds Ministry of Interior.
 */
export function pickMeetingForParticipantEdit(
  meetings: EditableMeeting[],
  wanted: {
    meetingId?: number | null;
    date?: string | null;
    time?: string | null;
    location?: string | null;
  },
): MeetingPick {
  if (meetings.length === 0) return { status: 'none', meetings };

  const wantedId = Number(wanted.meetingId);
  if (Number.isFinite(wantedId) && wantedId > 0) {
    const byId = meetings.find((meeting) => meeting.id === wantedId);
    return byId ? { status: 'picked', meeting: byId } : { status: 'none', meetings };
  }

  const date = clean(wanted.date);
  const time = shortTime(wanted.time);
  const location = clean(wanted.location).toLowerCase();
  let candidates = meetings;
  if (date) candidates = candidates.filter((meeting) => meeting.date === date);
  if (time) candidates = candidates.filter((meeting) => shortTime(meeting.time) === time);
  if (location) {
    candidates = candidates.filter((meeting) => {
      const name = meeting.location.toLowerCase();
      return name.includes(location) || location.includes(name);
    });
  }

  if (candidates.length === 1) return { status: 'picked', meeting: candidates[0] };
  if (candidates.length === 0) return { status: 'none', meetings };
  return { status: 'ambiguous', meetings: candidates };
}

/** `Tue 20 Oct 2026 at 18:00 · Teams`, for asking which meeting they meant. */
export function describeMeetingForPick(meeting: EditableMeeting): string {
  return `${formatMeetingDate(meeting.date)} at ${shortTime(meeting.time)} · ${meeting.location}`;
}

/**
 * True when the name is the person typing.
 *
 * "Add me as a guest" is how people say it, and a guest row called "me" would be useless to
 * everyone who reads the meeting later.
 */
export function nameMeansSignedInUser(name: string): boolean {
  return /^(me|myself|i|my self)$/i.test(clean(name));
}

/** Rows whose person is the one named, so "remove Irina" does not need her row id. */
export function matchAttendeesByName(attendees: MeetingAttendee[], name: string): MeetingAttendee[] {
  const query = clean(name).toLowerCase();
  if (!query) return [];
  const exact = attendees.filter((row) => row.name.toLowerCase() === query);
  if (exact.length > 0) return exact;
  return attendees.filter((row) => {
    const candidate = row.name.toLowerCase();
    return candidate.includes(query) || query.includes(candidate);
  });
}

/** The lead's active meetings, in the shape the picker reads. */
export async function loadEditableLeadMeetings(lead: AiMeetingLead): Promise<EditableMeeting[]> {
  const rows = await loadActiveLeadMeetings(lead);
  return rows.map((row) => ({
    id: Number(row.id),
    date: clean(row.meeting_date),
    time: shortTime(row.meeting_time),
    location: clean(row.meeting_location) || clean(row.meeting_subject) || 'No location',
    calendarType: clean(row.calendar_type),
  }));
}

/** Who is on the meeting now: colleagues, firm contacts and guests, by name. */
export async function loadMeetingAttendees(meetingId: number): Promise<MeetingAttendee[]> {
  const { data, error } = await supabase
    .from('meeting_participants')
    .select('id, employee_id, firm_contact_id, free_name, free_email')
    .eq('meeting_id', meetingId);
  if (error || !data) return [];

  const rows = data as Array<Record<string, unknown>>;
  const employeeIds = Array.from(
    new Set(rows.map((row) => Number(row.employee_id)).filter((id) => Number.isFinite(id) && id > 0)),
  );
  const firmIds = Array.from(
    new Set(rows.map((row) => clean(row.firm_contact_id)).filter((id) => id !== '')),
  );
  const [employees, firmContacts] = await Promise.all([
    employeeIds.length > 0
      ? supabase.from('tenants_employee').select('id, display_name').in('id', employeeIds)
      : Promise.resolve({ data: [] as any[] }),
    firmIds.length > 0
      ? supabase.from('firm_contacts').select('id, name').in('id', firmIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const employeeName = new Map<number, string>();
  ((employees as any).data || []).forEach((row: any) => {
    employeeName.set(Number(row.id), clean(row.display_name));
  });
  const firmName = new Map<string, string>();
  ((firmContacts as any).data || []).forEach((row: any) => {
    firmName.set(String(row.id), clean(row.name));
  });

  return rows.map((row) => {
    const employeeId = Number(row.employee_id);
    if (Number.isFinite(employeeId) && employeeId > 0) {
      return {
        rowId: String(row.id),
        kind: 'staff' as const,
        name: employeeName.get(employeeId) || `Employee #${employeeId}`,
        employeeId,
        email: null,
      };
    }
    const firmContactId = clean(row.firm_contact_id);
    if (firmContactId) {
      return {
        rowId: String(row.id),
        kind: 'firm' as const,
        name: firmName.get(firmContactId) || 'Firm contact',
        employeeId: null,
        email: null,
      };
    }
    return {
      rowId: String(row.id),
      kind: 'guest' as const,
      name: clean(row.free_name) || 'Guest',
      employeeId: null,
      email: clean(row.free_email) || null,
    };
  });
}

export type ParticipantChangeResult = {
  added: string[];
  removed: string[];
  /** Already there, or not there to begin with — worth saying so nobody edits twice. */
  unchanged: string[];
  attendees: MeetingAttendee[];
  error: string | null;
};

/**
 * Add and remove people on an existing meeting.
 *
 * Nobody is emailed: the invitation goes out when the calendar event is created, and the CRM does
 * not keep the Outlook event id, so a guest added afterwards is recorded on the meeting and has to
 * be invited from Outlook. The caller says that in its reply rather than implying an invite.
 */
export async function changeMeetingParticipants(args: {
  meeting: EditableMeeting;
  addStaffEmployeeIds?: number[];
  addGuests?: AiMeetingGuest[];
  removeNames?: string[];
}): Promise<ParticipantChangeResult> {
  const before = await loadMeetingAttendees(args.meeting.id);
  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];

  const rowsToInsert: Array<Record<string, unknown>> = [];
  const staffNames = new Map<number, string>();
  const wantedStaff = Array.from(
    new Set((args.addStaffEmployeeIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)),
  );
  if (wantedStaff.length > 0) {
    const { data } = await supabase
      .from('tenants_employee')
      .select('id, display_name')
      .in('id', wantedStaff);
    ((data as any[]) || []).forEach((row) => staffNames.set(Number(row.id), clean(row.display_name)));
  }
  for (const employeeId of wantedStaff) {
    const name = staffNames.get(employeeId) || `Employee #${employeeId}`;
    if (before.some((row) => row.employeeId === employeeId)) {
      unchanged.push(`${name} was already on the meeting`);
      continue;
    }
    rowsToInsert.push({ meeting_id: args.meeting.id, employee_id: employeeId });
    added.push(name);
  }
  for (const guest of args.addGuests || []) {
    const name = clean(guest.name);
    if (!name) continue;
    if (before.some((row) => row.name.toLowerCase() === name.toLowerCase())) {
      unchanged.push(`${name} was already on the meeting`);
      continue;
    }
    rowsToInsert.push({
      meeting_id: args.meeting.id,
      free_name: name,
      free_email: clean(guest.email) || null,
      free_phone: clean(guest.phone) || null,
      notes: clean(guest.notes) || null,
    });
    added.push(name);
  }

  const rowIdsToDelete: string[] = [];
  for (const name of args.removeNames || []) {
    const matches = matchAttendeesByName(before, name);
    if (matches.length === 0) {
      unchanged.push(`${clean(name)} is not on the meeting`);
      continue;
    }
    matches.forEach((row) => {
      if (!rowIdsToDelete.includes(row.rowId)) {
        rowIdsToDelete.push(row.rowId);
        removed.push(row.name);
      }
    });
  }

  let error: string | null = null;
  if (rowsToInsert.length > 0) {
    const { error: insertError } = await supabase.from('meeting_participants').insert(rowsToInsert);
    if (insertError) error = insertError.message;
  }
  if (!error && rowIdsToDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from('meeting_participants')
      .delete()
      .in('id', rowIdsToDelete);
    if (deleteError) error = deleteError.message;
  }

  /*
   * Staff and external meetings show their attendees in the calendar from a column on the meeting
   * itself, so it has to be rewritten whenever the list changes. Client meetings keep the real
   * meeting manager in that column and must be left alone.
   */
  if (!error && (added.length > 0 || removed.length > 0) && args.meeting.calendarType === 'staff') {
    await syncMeetingAttendeesDisplayColumn(args.meeting.id).catch(() => undefined);
  }

  return {
    added,
    removed,
    unchanged,
    attendees: error ? before : await loadMeetingAttendees(args.meeting.id),
    error,
  };
}
