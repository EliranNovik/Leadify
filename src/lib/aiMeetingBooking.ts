import { supabase } from './supabase';
import { fetchStageActorInfo, updateLeadStageWithHistory, type StageActorInfo } from './leadStageManager';
import {
  allowsAdditionalLeadMeetings,
  areStagesEquivalent,
  getStageName,
  shouldPreserveLeadStageOnMeeting,
} from './stageUtils';
import {
  ACTIVE_MEETING_STATUS_FILTER,
  cancelMeetingById,
  findMeetingToCancelOnReschedule,
} from './meetingRescheduleCancel';
import { createClientCalendarEventViaServer, createStaffCalendarEventViaServer } from './graph';
import { getValidTeamsLink } from './meetingJoinLink';
import { isTeamsMeetingLocationName } from './meetingLocationUtils';
import { ensureLeadCategories, resolveLeadCategoryName } from './leadMetaDisplay';

/**
 * Booking a lead meeting the way the Meeting tab does it, for callers that have no UI — today that
 * is RMQ AI.
 *
 * The rules here are the product's, not new ones: which calendar a meeting belongs on depends on
 * whether the client has signed, the lead stage moves the same way it does when a human books from
 * the Meeting tab, and a replacement meeting is a new row plus a cancelled old one. Anything this
 * cannot decide safely comes back as a question for the user instead of a guess.
 *
 * Deliberately left to the UI: client invitation emails and WhatsApp, and participant lists for
 * staff meetings.
 */

/** Stage 60 — Client signed agreement. Before it, a lead meeting is a potential-client meeting. */
export const CLIENT_SIGNED_STAGE_ID = 60;
/** Stage 20 — Meeting scheduled. */
export const MEETING_SCHEDULED_STAGE_ID = 20;
/** Stage 55 — Another meeting, used when a lead already got through the first round. */
export const ANOTHER_MEETING_STAGE_ID = 55;
export const DEFAULT_MEETING_DURATION_MINUTES = 30;
export const DEFAULT_MEETING_LOCATION = 'Teams';

/**
 * `meetings.calendar_type` — which shared Outlook calendar the meeting goes on, and nothing else.
 * Potential and active are the two client calendars; staff is the internal one.
 */
export type AiMeetingCalendar = 'potential_client' | 'active_client' | 'staff';

/** What the caller asked for. `auto` means "work it out from the stage", which is the normal case. */
export type AiMeetingCalendarRequest = 'auto' | 'potential_client' | 'active_client' | 'internal';

/**
 * Places a signed client's meeting is not really a client meeting: the office goes to the court,
 * the ministry or the bank with or for the client, which the Meeting tab files as an external
 * meeting (an internal meeting with external participants) rather than a client meeting.
 */
const EXTERNAL_MEETING_LOCATION_PATTERNS: readonly RegExp[] = [
  /\bcourt\b|\bcourthouse\b/i,
  /\bgovernment\b|\bgov\b|\bmunicipalit/i,
  /ministry|\bmisrad\b|interior/i,
  /\bembassy\b|consulate/i,
  /\bbank\b/i,
];

/** True for a location the firm attends as an external meeting rather than a client meeting. */
export function isExternalMeetingLocation(name?: string | null): boolean {
  const value = String(name || '').trim();
  if (!value) return false;
  return EXTERNAL_MEETING_LOCATION_PATTERNS.some((pattern) => pattern.test(value));
}

export type AiMeetingCalendarDecision = {
  calendar: AiMeetingCalendar;
  /** How to name that calendar to a person. */
  label: string;
  /** Set when the caller asked for another calendar, so the reply can explain the switch. */
  note: string | null;
  /** Which `internal_meeting_types` row a staff booking belongs to. */
  internalTypeCode?: 'staff' | 'extern';
};

export type AiMeetingStageDecision = {
  /** Stage to move the lead to, or null to leave the stage alone. */
  stage: number | null;
  /** One sentence for the user about what happened to the stage. */
  note: string;
};

export type AiMeetingEmployeeRef = { id: number | null; name: string };

export type AiMeetingLead = {
  /** `legacy_123` or the new-lead uuid — the id shape the rest of the CRM passes around. */
  id: string;
  /** Primary key in its own table. */
  recordId: string | number;
  leadNumber: string;
  name: string;
  isLegacy: boolean;
  stage: unknown;
  stageName: string;
  email: string | null;
  row: Record<string, unknown>;
};

/** A guest is anyone outside the firm: a clerk, a banker, an accountant the client brings. */
export type AiMeetingGuest = {
  name: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
};

/** Who is coming besides the client. */
export type AiMeetingParticipants = {
  /** Colleagues, as `tenants_employee.id`, which become `meeting_participants.employee_id` rows. */
  staffEmployeeIds?: number[];
  /** Guests, kept by name on the meeting and emailed the invitation when there is an event. */
  guests?: AiMeetingGuest[];
};

export type AiMeetingBookingRequest = {
  lead: AiMeetingLead;
  mode: 'schedule' | 'reschedule';
  date: string;
  time: string;
  durationMinutes?: number | string | null;
  location?: string | null;
  manager?: AiMeetingEmployeeRef | null;
  helper?: AiMeetingEmployeeRef | null;
  brief?: string | null;
  subject?: string | null;
  attendanceProbability?: string | null;
  complexity?: string | null;
  calendarRequest?: AiMeetingCalendarRequest;
  /** Which existing meeting to replace; otherwise the soonest active one is used. */
  preferredMeetingId?: number | null;
  actor?: StageActorInfo;
  /** Only used by external and internal meetings, which are the ones that carry participants. */
  participants?: AiMeetingParticipants;
};

export type AiMeetingBookingResult =
  /** Nothing was written — the caller has to come back with an answer first. */
  | { status: 'needs_input'; message: string }
  | { status: 'failed'; message: string }
  | {
      status: 'booked';
      message: string;
      /** The same facts the message is written from, for a caller that wants to render them. */
      summary: AiMeetingSummary;
      meetingId: number | null;
      calendar: AiMeetingCalendar;
      /** The shared Outlook calendar the event was created in, or null when Outlook was skipped. */
      outlookCalendarEmail: string | null;
      stageMovedTo: number | null;
      canceledMeetingIds: number[];
    };

/* ------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------ */

export function stageNumberOf(stage: unknown): number | null {
  if (stage == null || stage === '') return null;
  const n = Number(String(stage).trim());
  return Number.isFinite(n) ? n : null;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isoToUtcDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDaysIso(iso: string, days: number): string {
  const next = isoToUtcDate(iso);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** Today in the office timezone, which is the day every relative date is counted from. */
export function meetingTodayIso(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** `meetingTodayIso` plus a number of days, for a default date a form can start on. */
export function meetingDateInDays(days: number, now = new Date()): string {
  return addDaysIso(meetingTodayIso(now), days);
}

/** `Tue 20 Oct 2026`, so a confirmation reads as a date a person can check against a calendar. */
export function formatMeetingDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const date = isoToUtcDate(iso);
  const weekday = WEEKDAYS[date.getUTCDay()].slice(0, 3);
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${date.getUTCDate()} ${MONTH_LABELS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * The wording people and models actually use for a day, turned into `YYYY-MM-DD`.
 *
 * A bare weekday means the next one that has not happened yet, never today, because "let's do it
 * Monday" said on a Monday means next week. Anything unrecognised comes back as an error rather than
 * a guessed date — a meeting on the wrong day is worse than one more question.
 */
export function normalizeMeetingDateInput(
  raw: unknown,
  todayIso: string,
): { date: string } | { error: string } {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase()
    // A time or a weekday often rides along with the date ("tomorrow at 19:00", "Mon, 20 Oct").
    .replace(/\bat\b.*$/, '')
    .replace(/\b\d{1,2}:\d{2}\s*(am|pm)?\b/g, '')
    .replace(/[,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // "Mon 19 October" — the weekday is decoration once a real date follows it.
    .replace(/^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\s+(?=\d|[a-z]{3,9}\s+\d)/, '')
    .trim();
  if (!value) return { error: 'I need the meeting date.' };
  if (value === 'today' || value === 'tonight' || value === 'this evening') return { date: todayIso };
  if (value === 'tomorrow' || value === 'tmrw') return { date: addDaysIso(todayIso, 1) };
  if (/^(day after tomorrow|overmorrow|in 2 days)$/.test(value)) return { date: addDaysIso(todayIso, 2) };

  const inDays = value.match(/^in (\d{1,2}) days?$/);
  if (inDays) return { date: addDaysIso(todayIso, Number(inDays[1])) };

  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return { date: `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}` };
  }

  const dmy = value.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const month = dmy[2].padStart(2, '0');
    if (Number(month) > 12 || Number(month) < 1) {
      return { error: `"${raw}" is not a date I can read — use DD/MM/YYYY.` };
    }
    // A day and month with no year means the next time that date comes round.
    const year = dmy[3]
      ? dmy[3].length === 2
        ? `20${dmy[3]}`
        : dmy[3]
      : nextYearForMonthDay(todayIso, month, day);
    return { date: `${year}-${month}-${day}` };
  }

  // `20 Oct`, `20 October 2026`, `Oct 20`, with the year optional.
  const monthName = value.match(
    /^(?:(\d{1,2})\s+([a-z]{3,9})|([a-z]{3,9})\s+(\d{1,2}))(?:\s+(\d{4}))?(?:st|nd|rd|th)?$/,
  );
  if (monthName) {
    const dayPart = monthName[1] || monthName[4];
    const namePart = (monthName[2] || monthName[3] || '').slice(0, 3);
    const monthIndex = MONTH_LABELS.findIndex((label) => label.toLowerCase() === namePart);
    if (monthIndex >= 0 && dayPart) {
      const day = dayPart.padStart(2, '0');
      const month = String(monthIndex + 1).padStart(2, '0');
      const year = monthName[5] || nextYearForMonthDay(todayIso, month, day);
      return { date: `${year}-${month}-${day}` };
    }
  }

  const weekdayIndex = WEEKDAYS.indexOf(value.replace(/^(next|this|on|coming)\s+/, ''));
  if (weekdayIndex >= 0) {
    const todayIndex = isoToUtcDate(todayIso).getUTCDay();
    const ahead = (weekdayIndex - todayIndex + 7) % 7 || 7;
    return { date: addDaysIso(todayIso, ahead) };
  }

  return { error: `I could not read "${raw}" as a date. Give it as YYYY-MM-DD.` };
}

/** The year that makes a bare day/month fall today or later. */
function nextYearForMonthDay(todayIso: string, month: string, day: string): string {
  const year = Number(todayIso.slice(0, 4));
  const candidate = `${year}-${month}-${day}`;
  return candidate >= todayIso ? String(year) : String(year + 1);
}

/** `19:00`, `7pm`, `7.30 pm`, `1900` → `HH:MM`. Anything else is a question, not a default. */
export function normalizeMeetingTimeInput(raw: unknown): { time: string } | { error: string } {
  const value = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!value) return { error: 'I need the meeting time.' };

  const meridiem = value.match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm)$/);
  const plain = value.match(/^(\d{1,2})[:.](\d{2})$/);
  const compact = value.match(/^(\d{3,4})$/);

  let hour: number;
  let minute: number;
  if (meridiem) {
    hour = Number(meridiem[1]) % 12;
    minute = Number(meridiem[2] || '0');
    if (meridiem[3] === 'pm') hour += 12;
  } else if (plain) {
    hour = Number(plain[1]);
    minute = Number(plain[2]);
  } else if (compact) {
    const digits = compact[1].padStart(4, '0');
    hour = Number(digits.slice(0, 2));
    minute = Number(digits.slice(2));
  } else if (/^\d{1,2}$/.test(value)) {
    hour = Number(value);
    minute = 0;
  } else {
    return { error: `I could not read "${raw}" as a time. Give it as HH:MM on a 24-hour clock.` };
  }

  if (hour > 23 || minute > 59) {
    return { error: `"${raw}" is not a valid time of day.` };
  }
  return { time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

export function normalizeMeetingCalendarRequest(raw: unknown): AiMeetingCalendarRequest {
  const value = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (value === 'potential' || value === 'potential_client') return 'potential_client';
  if (value === 'active' || value === 'active_client') return 'active_client';
  if (value === 'internal' || value === 'external' || value === 'staff') return 'internal';
  return 'auto';
}

export function normalizeDurationMinutes(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MEETING_DURATION_MINUTES;
  return Math.round(n);
}

const ATTENDANCE_VALUES = ['Low', 'Medium', 'High', 'Very High'];

export function normalizeAttendanceProbability(raw: unknown): string {
  const value = String(raw ?? '').trim().toLowerCase();
  return ATTENDANCE_VALUES.find((option) => option.toLowerCase() === value) || 'Medium';
}

export function normalizeComplexity(raw: unknown): string {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === 'complex' ? 'Complex' : 'Simple';
}

/**
 * Which shared Outlook calendar the meeting goes on.
 *
 * Potential and active are not kinds of meeting — they are the two client calendars, and the lead
 * stage decides which one: the Meeting tab offers Potential Client only before stage 60 and Active
 * Client only from stage 60. A caller asking for the other one is corrected rather than obeyed,
 * because the calendar is what the schedulers watch in Outlook. Internal and external staff
 * meetings are a separate mailbox again, and a signed client's meeting at one of the external
 * places (court, ministry, embassy, bank) belongs there too.
 */
export function decideMeetingCalendar(args: {
  stage: unknown;
  requested?: AiMeetingCalendarRequest;
  /** The resolved location name, which can make a signed client's meeting an external one. */
  locationName?: string | null;
}): AiMeetingCalendarDecision {
  const requested = args.requested ?? 'auto';
  if (requested === 'internal') {
    return {
      calendar: 'staff',
      label: 'staff calendar (internal / external meeting)',
      note: 'Internal meetings sit on the staff calendar and leave the lead stage alone.',
      internalTypeCode: 'staff',
    };
  }

  const signed = shouldPreserveLeadStageOnMeeting(args.stage);
  const stageLabel = describeStage(args.stage);
  /*
   * A signed client's meeting at a court, ministry, embassy or bank is an external meeting, the
   * same as choosing External in the Meeting tab, which only offers it from stage 60. Before the
   * agreement is signed those are still ordinary client meetings, so nothing changes there.
   */
  if (signed && isExternalMeetingLocation(args.locationName)) {
    return {
      calendar: 'staff',
      label: 'staff calendar (external meeting)',
      note: `${args.locationName} is an external meeting for a signed client, so it goes on the staff calendar as an external meeting rather than on a client calendar, and the lead stage is left alone.`,
      internalTypeCode: 'extern',
    };
  }
  if (signed) {
    return {
      calendar: 'active_client',
      label: 'Active Clients Outlook calendar',
      note:
        requested === 'potential_client'
          ? `This client has already signed (${stageLabel}), so the meeting goes on the Active Clients calendar, not Potential Clients.`
          : null,
    };
  }
  return {
    calendar: 'potential_client',
    label: 'Potential Clients Outlook calendar',
    note:
      requested === 'active_client'
        ? `This lead has not signed the agreement yet (${stageLabel}), so the meeting goes on the Potential Clients calendar, not Active Clients.`
        : null,
  };
}

/** Stage name when there is one, otherwise the raw value, for use inside a sentence. */
export function describeStage(stage: unknown): string {
  if (stage == null || stage === '') return 'no stage set';
  const name = getStageName(String(stage));
  return name && name !== String(stage) ? name : `stage ${stage}`;
}

/**
 * Where the lead stage ends up, matching the Meeting tab exactly:
 * first booking → Meeting scheduled (20); a lead that already got past the meeting round (40–59) →
 * Another meeting (55); signed clients and staff meetings → untouched. A replacement meeting always
 * lands on Meeting scheduled unless the lead is already on Another meeting.
 */
export function decideMeetingStage(args: {
  stage: unknown;
  calendar: AiMeetingCalendar;
  mode: 'schedule' | 'reschedule';
}): AiMeetingStageDecision {
  if (args.calendar === 'staff') {
    return { stage: null, note: 'Lead stage unchanged — internal meetings do not move a lead.' };
  }
  if (shouldPreserveLeadStageOnMeeting(args.stage)) {
    return {
      stage: null,
      note: `Lead stage unchanged (${describeStage(args.stage)}) — meetings never move a signed client.`,
    };
  }

  const numeric = stageNumberOf(args.stage);
  if (args.mode === 'reschedule') {
    const isAnotherMeeting =
      numeric === ANOTHER_MEETING_STAGE_ID ||
      areStagesEquivalent(getStageName(String(args.stage ?? '')), 'Another meeting');
    if (isAnotherMeeting) {
      return { stage: null, note: 'Lead stage left on Another meeting.' };
    }
    return { stage: MEETING_SCHEDULED_STAGE_ID, note: 'Lead stage set back to Meeting scheduled.' };
  }

  if (numeric != null && numeric >= 40 && numeric < CLIENT_SIGNED_STAGE_ID) {
    return { stage: ANOTHER_MEETING_STAGE_ID, note: 'Lead stage moved to Another meeting.' };
  }
  return { stage: MEETING_SCHEDULED_STAGE_ID, note: 'Lead stage moved to Meeting scheduled.' };
}

/**
 * Zoom rooms that cannot hold two meetings in the same hour (ids from `tenants_meetinglocation`).
 * Same list the Meeting tab checks before it books.
 */
export const RESTRICTED_ROOM_LOCATION_IDS: readonly number[] = [
  3, 4, 15, 16, 17, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29,
];

type TimedMeeting = { id?: unknown; meeting_time?: string | null };

/** The first meeting already booked in the same clock hour, which is how the rooms are blocked. */
export function findRoomConflict<T extends TimedMeeting>(existing: T[], time: string): T | null {
  const hour = String(time || '').split(':')[0];
  if (!hour) return null;
  return existing.find((row) => String(row.meeting_time || '').split(':')[0] === hour) || null;
}

export type AiMeetingLocation = {
  id: number | null;
  name: string;
  default_link?: string | null;
  is_active?: boolean | null;
};

/**
 * Match a spoken location to a row in `tenants_meetinglocation`, falling back to Teams.
 * Returns `null` for a name that matches nothing, so the caller can list the real ones.
 */
export function pickMeetingLocation(
  locations: AiMeetingLocation[],
  requested?: string | null,
): AiMeetingLocation | null {
  const active = locations.filter((row) => row.is_active !== false);
  const pool = active.length > 0 ? active : locations;
  const wanted = String(requested ?? '').trim().toLowerCase();
  if (!wanted) {
    return pool.find((row) => row.name === DEFAULT_MEETING_LOCATION) || pool[0] || null;
  }
  return (
    pool.find((row) => row.name.toLowerCase() === wanted) ||
    pool.find((row) => row.name.toLowerCase().startsWith(wanted)) ||
    pool.find((row) => row.name.toLowerCase().includes(wanted)) ||
    null
  );
}

/**
 * Marker the meeting tools append their summary JSON under, so the chat can draw the meeting as a
 * card instead of repeating the confirmation lines. The model is told never to quote the block.
 */
export const MEETING_BOOKED_UI_MARKER = 'MEETING_BOOKED_UI_JSON';

export type AiMeetingSummary = {
  leadNumber: string;
  leadName: string;
  isLegacy: boolean;
  date: string;
  time: string;
  durationMinutes: number;
  location: string;
  calendarLabel: string;
  manager: string;
  helper: string;
  mode: 'schedule' | 'reschedule';
  stageNote: string;
  /** The shared mailbox the Outlook event was created in, when it was. */
  outlookCalendarEmail?: string | null;
  replaced?: { date?: string | null; time?: string | null } | null;
  notes: string[];
  /** For the card the chat shows; the written confirmation never quotes a link. */
  joinUrl?: string | null;
};

/**
 * The confirmation the user reads. First line is a complete sentence on its own, because the chat
 * also shows it as a toast; the detail lines below are for the reply itself.
 */
export function buildMeetingConfirmation(summary: AiMeetingSummary): string {
  const when = `${formatMeetingDate(summary.date)} at ${summary.time}`;
  const verb = summary.mode === 'reschedule' ? 'Moved' : 'Scheduled';
  const lines = [
    `${verb} the meeting for ${summary.leadNumber} ${summary.leadName} to ${when}.`,
    `When: ${when} · ${summary.durationMinutes} min · ${summary.location}`,
    `Calendar: ${summary.calendarLabel}${summary.isLegacy ? ' (legacy lead)' : ''}`,
    `Manager: ${summary.manager || '—'} · Helper: ${summary.helper || '—'}`,
    summary.stageNote,
  ];
  if (summary.outlookCalendarEmail) {
    lines.push(`Added to the ${summary.outlookCalendarEmail} Outlook calendar.`);
  }
  if (summary.replaced?.date) {
    lines.push(
      `Previous meeting on ${formatMeetingDate(String(summary.replaced.date))}${
        summary.replaced.time ? ` at ${summary.replaced.time}` : ''
      } is now cancelled.`,
    );
  }
  for (const note of summary.notes) {
    if (note) lines.push(note);
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Database side
 * ------------------------------------------------------------------ */

const LEAD_COLUMNS_NEW =
  'id, lead_number, name, stage, email, category, category_id, expert, scheduler, manager, helper, meeting_manager_id, meeting_lawyer_id';
const LEAD_COLUMNS_LEGACY =
  'id, manual_id, name, stage, email, category_id, expert_id, meeting_scheduler_id, meeting_manager_id, meeting_lawyer_id';

/**
 * Load the lead row by primary key.
 *
 * By id, never by lead number: `lead_number` is text with several spellings in use, and the old
 * version of this tool looked a lead up with `.eq('lead_number', …).single()`, which failed with
 * "multiple (or no) rows returned" whenever the spelling differed or the lead was legacy.
 */
export async function loadLeadForMeeting(args: {
  leadId: string;
  isLegacy: boolean;
  leadNumber?: string;
}): Promise<AiMeetingLead | null> {
  const rawId = String(args.leadId || '').replace(/^legacy_/i, '');
  if (!rawId) return null;

  if (args.isLegacy) {
    const numeric = Number.parseInt(rawId, 10);
    if (!Number.isFinite(numeric)) return null;
    const { data, error } = await supabase
      .from('leads_lead')
      .select(LEAD_COLUMNS_LEGACY)
      .eq('id', numeric)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    return {
      id: `legacy_${numeric}`,
      recordId: numeric,
      leadNumber: String(args.leadNumber || row.manual_id || numeric),
      name: String(row.name || '').trim() || String(args.leadNumber || numeric),
      isLegacy: true,
      stage: row.stage,
      stageName: describeStage(row.stage),
      email: (row.email as string | null) ?? null,
      row,
    };
  }

  const { data, error } = await supabase
    .from('leads')
    .select(LEAD_COLUMNS_NEW)
    .eq('id', rawId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: rawId,
    recordId: rawId,
    leadNumber: String(row.lead_number || args.leadNumber || rawId),
    name: String(row.name || '').trim() || String(row.lead_number || rawId),
    isLegacy: false,
    stage: row.stage,
    stageName: describeStage(row.stage),
    email: (row.email as string | null) ?? null,
    row,
  };
}

export async function loadMeetingLocations(): Promise<AiMeetingLocation[]> {
  const { data, error } = await supabase
    .from('tenants_meetinglocation')
    .select('id, name, default_link, is_active, order')
    .order('order', { ascending: true });
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: row.id == null ? null : Number(row.id),
    name: String(row.name || '').trim(),
    default_link: (row.default_link as string | null) ?? null,
    is_active: (row.is_active as boolean | null) ?? null,
  })).filter((row) => row.name);
}

/** `staff` is the type the Meeting tab preselects for an internal meeting. */
async function internalMeetingTypeIdByCode(code: 'staff' | 'extern'): Promise<number | null> {
  const { data } = await supabase
    .from('internal_meeting_types')
    .select('id, code')
    .eq('code', code)
    .maybeSingle();
  const id = Number((data as { id?: unknown } | null)?.id);
  return Number.isFinite(id) ? id : null;
}

/** Guests worth saving: the ones that were actually given a name. */
export function usableMeetingGuests(participants?: AiMeetingParticipants): AiMeetingGuest[] {
  return (participants?.guests || []).filter((row) => String(row?.name || '').trim() !== '');
}

/** Email addresses to invite, so a guest with no address costs nothing. */
export function meetingGuestAttendees(
  participants?: AiMeetingParticipants,
): Array<{ email: string; name: string }> {
  return usableMeetingGuests(participants)
    .map((guest) => ({ email: String(guest.email || '').trim(), name: String(guest.name).trim() }))
    .filter((guest) => guest.email !== '');
}

/** True when there is anyone to save, so the reply does not claim an empty participant list. */
export function hasMeetingParticipants(participants?: AiMeetingParticipants): boolean {
  const staff = (participants?.staffEmployeeIds || []).filter((id) => Number.isFinite(Number(id)));
  return staff.length > 0 || usableMeetingGuests(participants).length > 0;
}

/**
 * Save who is attending, the same shape the Meeting tab writes: one `meeting_participants` row per
 * colleague by employee id, and one per outsider by name.
 */
async function saveMeetingParticipants(
  meetingId: number,
  participants?: AiMeetingParticipants,
): Promise<{ count: number; error: string | null }> {
  if (!hasMeetingParticipants(participants)) return { count: 0, error: null };

  const rows: Array<Record<string, unknown>> = [];
  for (const id of new Set((participants?.staffEmployeeIds || []).map((value) => Number(value)))) {
    if (Number.isFinite(id) && id > 0) rows.push({ meeting_id: meetingId, employee_id: id });
  }
  for (const person of usableMeetingGuests(participants)) {
    const name = String(person.name).trim();
    rows.push({
      meeting_id: meetingId,
      free_name: name,
      free_email: String(person.email || '').trim() || null,
      free_phone: String(person.phone || '').trim() || null,
      notes: String(person.notes || '').trim() || null,
    });
  }
  if (rows.length === 0) return { count: 0, error: null };

  const { error } = await supabase.from('meeting_participants').insert(rows);
  return { count: error ? 0 : rows.length, error: error?.message || null };
}

/** Everyone on the meeting by name, for the staff calendar entry that lists them in its body. */
async function meetingParticipantNames(participants?: AiMeetingParticipants): Promise<string[]> {
  const names: string[] = [];
  const ids = Array.from(
    new Set((participants?.staffEmployeeIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)),
  );
  if (ids.length > 0) {
    const { data } = await supabase.from('tenants_employee').select('id, display_name').in('id', ids);
    ((data as Array<{ display_name?: unknown }>) || []).forEach((row) => {
      const name = String(row.display_name || '').trim();
      if (name) names.push(name);
    });
  }
  usableMeetingGuests(participants).forEach((guest) => names.push(String(guest.name).trim()));
  return names;
}

/** Employees a meeting can be shared with, for a participant picker. */
export async function loadMeetingStaffOptions(): Promise<AiMeetingEmployeeRef[]> {
  const { data, error } = await supabase
    .from('tenants_employee')
    .select('id, display_name')
    .order('display_name');
  if (error || !data) return [];
  return (data as Array<{ id: unknown; display_name: unknown }>)
    .map((row) => ({ id: Number(row.id), name: String(row.display_name || '').trim() }))
    .filter((row) => Number.isFinite(row.id) && row.name !== '');
}

async function employeeNameById(id: unknown): Promise<string> {
  const numeric = Number(id);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  const { data } = await supabase
    .from('tenants_employee')
    .select('display_name')
    .eq('id', numeric)
    .maybeSingle();
  return String((data as { display_name?: unknown } | null)?.display_name || '').trim();
}

/** Who the meeting row records as scheduler, following the Meeting tab's rules. */
async function resolveSchedulerName(args: {
  lead: AiMeetingLead;
  isPotential: boolean;
  actorName: string;
  replacedScheduler?: string | null;
}): Promise<string> {
  if (args.isPotential) return args.actorName;
  const replaced = String(args.replacedScheduler || '').trim();
  if (replaced && replaced !== '---') return replaced;
  if (args.lead.isLegacy) {
    return (await employeeNameById(args.lead.row.meeting_scheduler_id)) || '---';
  }
  const scheduler = args.lead.row.scheduler;
  const asName = String(scheduler ?? '').trim();
  if (!asName) return '---';
  if (/^\d+$/.test(asName)) return (await employeeNameById(asName)) || '---';
  return asName;
}

async function leadExpertName(lead: AiMeetingLead): Promise<string> {
  if (lead.isLegacy) return (await employeeNameById(lead.row.expert_id)) || '---';
  const expert = String(lead.row.expert ?? '').trim();
  if (!expert) return '---';
  if (/^\d+$/.test(expert)) return (await employeeNameById(expert)) || '---';
  return expert;
}

function leadMeetingFilter(query: any, lead: AiMeetingLead) {
  return lead.isLegacy
    ? query.eq('legacy_lead_id', Number(lead.recordId))
    : query.eq('client_id', lead.recordId);
}

/** Active (not cancelled) meetings for the lead, soonest first. */
export async function loadActiveLeadMeetings(
  lead: AiMeetingLead,
): Promise<
  Array<{
    id: number;
    meeting_date: string | null;
    meeting_time: string | null;
    meeting_location: string | null;
    scheduler: string | null;
    calendar_type: string | null;
    meeting_subject: string | null;
  }>
> {
  const { data, error } = await leadMeetingFilter(
    supabase
      .from('meetings')
      .select('id, meeting_date, meeting_time, meeting_location, scheduler, calendar_type, meeting_subject')
      .or(ACTIVE_MEETING_STATUS_FILTER)
      .order('meeting_date', { ascending: true })
      .order('meeting_time', { ascending: true }),
    lead,
  );
  if (error || !data) return [];
  return data as any[];
}

/** `[#L123] Client Name - Category - Brief`, the subject the shared calendars are read with. */
async function outlookEventSubject(lead: AiMeetingLead, brief?: string | null): Promise<string> {
  let category = String(lead.row.category ?? '').trim();
  if (!category || /^\d+$/.test(category)) {
    const categories = await ensureLeadCategories().catch(() => []);
    category =
      resolveLeadCategoryName(
        { category, category_id: (lead.row.category_id as string | number | null) ?? category },
        categories,
      ) || '';
  }
  return `[#${lead.leadNumber}] ${lead.name} - ${category || 'No Category'} - ${
    String(brief || '').trim() || 'Meeting'
  }`;
}

/**
 * Create the shared-calendar event in Outlook and hand back the Teams join link.
 *
 * Goes through the backend, which holds the firm's own Graph credentials: whoever is chatting does
 * not have to be signed in to Microsoft in that tab, and the event lands in the same shared mailbox
 * the Meeting tab and client self-booking use.
 *
 * Never throws. Outlook is best effort, as it is in the Meeting tab, so a mailbox that cannot be
 * reached costs the join link and nothing else — the note is what tells the user the meeting is in
 * the CRM but not on the calendar.
 */
async function createOutlookClientEvent(args: {
  lead: AiMeetingLead;
  calendar: AiMeetingCalendar;
  date: string;
  time: string;
  durationMinutes: number;
  locationName: string;
  manager: string;
  helper: string;
  expert: string;
  brief?: string | null;
  attendanceProbability: string;
  complexity: string;
  /** Guests with an email address; Outlook invites them from the shared mailbox. */
  attendees?: Array<{ email: string; name: string }>;
}): Promise<{ joinUrl: string; calendarEmail: string | null; note: string | null; invitedGuests: number }> {
  try {
    const event = await createClientCalendarEventViaServer({
      calendarType: args.calendar,
      subject: await outlookEventSubject(args.lead, args.brief),
      date: args.date,
      time: args.time,
      durationMinutes: args.durationMinutes,
      location: args.locationName,
      manager: args.manager,
      helper: args.helper,
      expert: args.expert || '---',
      brief: String(args.brief || ''),
      attendance_probability: args.attendanceProbability,
      complexity: args.complexity,
      amount: 0,
      currency: '₪',
      attendees: args.attendees,
    });
    const joinUrl = getValidTeamsLink(event.joinUrl) || '';
    return {
      joinUrl,
      calendarEmail: event.calendarEmail,
      invitedGuests: event.invitedGuests,
      note: joinUrl
        ? null
        : 'The calendar event was created but Outlook returned no Teams link — regenerate it from the meeting.',
    };
  } catch (error: any) {
    return {
      joinUrl: '',
      calendarEmail: null,
      invitedGuests: 0,
      note: `The meeting is in the CRM but not on the shared calendar (${
        error?.message || 'unknown error'
      }).`,
    };
  }
}

/**
 * Book or move a lead meeting.
 *
 * Writes in the order the UI uses: the meeting row first, then the previous meeting is cancelled
 * (never before, or a failure would leave the lead with nothing), then the stage and role fields.
 * A stage failure is reported but does not undo the meeting, which matches the Meeting tab.
 */
export async function bookLeadMeeting(request: AiMeetingBookingRequest): Promise<AiMeetingBookingResult> {
  const { lead, mode } = request;
  const notes: string[] = [];

  const locations = await loadMeetingLocations();
  const location = pickMeetingLocation(locations, request.location);
  if (!location) {
    const names = locations.map((row) => row.name).slice(0, 12).join(', ');
    return {
      status: 'needs_input',
      message: `There is no meeting location called "${request.location}". Pick one of: ${names}.`,
    };
  }

  // After the location, because where a signed client is being met can make it an external meeting.
  const calendarDecision = decideMeetingCalendar({
    stage: lead.stage,
    requested: request.calendarRequest,
    locationName: location.name,
  });
  if (calendarDecision.note) notes.push(calendarDecision.note);
  const isPotential = calendarDecision.calendar === 'potential_client';

  if (location.id != null && RESTRICTED_ROOM_LOCATION_IDS.includes(location.id)) {
    const { data: sameRoom } = await supabase
      .from('meetings')
      .select('id, meeting_time')
      .eq('meeting_date', request.date)
      .eq('meeting_location', location.name)
      .or(ACTIVE_MEETING_STATUS_FILTER);
    const clash = findRoomConflict((sameRoom as any[]) || [], request.time);
    if (clash) {
      return {
        status: 'needs_input',
        message: `${location.name} is already booked on ${formatMeetingDate(request.date)} in the ${
          request.time.split(':')[0]
        }:00 hour (existing meeting at ${clash.meeting_time}). Ask for another time or room.`,
      };
    }
  }

  const actor = request.actor ?? (await fetchStageActorInfo());
  const actorName = actor.fullName;

  let replaced: { id: number; meeting_date?: string | null; meeting_time?: string | null; scheduler?: string | null } | null =
    null;
  if (mode === 'reschedule') {
    const found = await findMeetingToCancelOnReschedule({
      supabase,
      clientId: lead.id,
      isLegacyLead: lead.isLegacy,
      preferredMeetingId: request.preferredMeetingId ?? null,
    });
    if (!found) {
      return {
        status: 'needs_input',
        message: `${lead.leadNumber} ${lead.name} has no active meeting to move. Book a new one instead.`,
      };
    }
    replaced = found as any;
  }

  const [schedulerName, expertName] = await Promise.all([
    resolveSchedulerName({
      lead,
      isPotential,
      actorName,
      replacedScheduler: replaced?.scheduler ?? null,
    }),
    leadExpertName(lead),
  ]);

  const durationMinutes = normalizeDurationMinutes(request.durationMinutes);
  const managerName = String(request.manager?.name || '').trim();
  const helperName = String(request.helper?.name || '').trim();

  /*
   * Teams meetings exist in Outlook first: the shared calendar event is what produces the join
   * link, exactly as the Meeting tab does it. A meeting in a room is not put on a client calendar
   * at all there, so it is not here either.
   */
  let teamsUrl = String(location.default_link || '').trim();
  let outlookCalendarEmail: string | null = null;
  let invitedGuests = 0;
  const guestAttendees = meetingGuestAttendees(request.participants);
  if (calendarDecision.calendar !== 'staff' && isTeamsMeetingLocationName(location.name)) {
    const outlook = await createOutlookClientEvent({
      lead,
      calendar: calendarDecision.calendar,
      date: request.date,
      time: request.time,
      durationMinutes,
      locationName: location.name,
      manager: managerName,
      helper: helperName,
      expert: expertName,
      brief: request.brief,
      attendanceProbability: normalizeAttendanceProbability(request.attendanceProbability),
      complexity: normalizeComplexity(request.complexity),
      attendees: guestAttendees,
    });
    if (outlook.joinUrl) teamsUrl = outlook.joinUrl;
    if (outlook.calendarEmail) outlookCalendarEmail = outlook.calendarEmail;
    if (outlook.note) notes.push(outlook.note);
    invitedGuests = outlook.invitedGuests;
  }

  const meetingRow: Record<string, unknown> = {
    client_id: lead.isLegacy ? null : lead.recordId,
    legacy_lead_id: lead.isLegacy ? String(lead.recordId) : null,
    meeting_date: request.date,
    meeting_time: request.time,
    duration: durationMinutes,
    meeting_location: location.name,
    meeting_manager: managerName,
    meeting_currency: '₪',
    meeting_amount: 0,
    expert: expertName,
    helper: helperName || '---',
    teams_meeting_url: teamsUrl,
    meeting_brief: String(request.brief || '').trim(),
    attendance_probability: normalizeAttendanceProbability(request.attendanceProbability),
    complexity: normalizeComplexity(request.complexity),
    car_number: '',
    scheduler: schedulerName,
    last_edited_timestamp: new Date().toISOString(),
    last_edited_by: actorName,
    calendar_type: calendarDecision.calendar,
    custom_link: null,
    custom_address: null,
    status: 'scheduled',
  };
  if (calendarDecision.calendar === 'staff') {
    const fallbackSubject =
      calendarDecision.internalTypeCode === 'extern'
        ? `[#${lead.leadNumber}] ${lead.name} - ${location.name}`
        : 'Internal meeting';
    meetingRow.meeting_subject = String(request.subject || request.brief || fallbackSubject).trim();
    const staffTypeId = await internalMeetingTypeIdByCode(calendarDecision.internalTypeCode || 'staff');
    if (staffTypeId != null) meetingRow.internal_meeting_type_id = staffTypeId;
    if (!hasMeetingParticipants(request.participants)) {
      notes.push('No participants were added — open the meeting in the CRM to invite people.');
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('meetings')
    .insert([meetingRow])
    .select('id')
    .maybeSingle();
  if (insertError) {
    return {
      status: 'failed',
      message: `Could not save the meeting: ${insertError.message}. Nothing was changed.`,
    };
  }
  const meetingId = inserted?.id != null ? Number((inserted as { id: unknown }).id) : null;

  if (!teamsUrl && isTeamsMeetingLocationName(location.name)) {
    notes.push('No Teams link yet — open the meeting in the CRM to generate one.');
  }

  if (meetingId != null) {
    const saved = await saveMeetingParticipants(meetingId, request.participants);
    if (saved.error) notes.push(`The meeting is saved but its participants are not (${saved.error}).`);
    else if (saved.count > 0) {
      const guestCount = usableMeetingGuests(request.participants).length;
      const invitation =
        calendarDecision.calendar === 'staff'
          ? 'Nobody was emailed — a staff calendar meeting lists the people coming instead of inviting them.'
          : guestCount === 0
            ? 'Nobody was emailed — invite them from the meeting in the CRM.'
            : invitedGuests > 0
              ? `${invitedGuests} guest${invitedGuests === 1 ? '' : 's'} were emailed the invitation.`
              : 'The guests were not emailed — invite them from the meeting in the CRM.';
      notes.push(
        `${saved.count} participant${saved.count === 1 ? '' : 's'} saved on the meeting. ${invitation}`,
      );
    }
  }

  /*
   * A staff or external meeting belongs on the staff shared calendar — that is where the CRM reads
   * staff meetings from, and where the Meeting tab puts them. It happens after the insert because
   * the people coming are named in the event body rather than invited to it.
   */
  if (meetingId != null && calendarDecision.calendar === 'staff') {
    try {
      const staffEvent = await createStaffCalendarEventViaServer({
        subject: String(meetingRow.meeting_subject || `${lead.leadNumber} ${lead.name}`),
        date: request.date,
        time: request.time,
        durationMinutes,
        location: location.name,
        participantNames: await meetingParticipantNames(request.participants),
        description: String(request.brief || ''),
      });
      outlookCalendarEmail = staffEvent.calendarEmail;
      const joinUrl = getValidTeamsLink(staffEvent.joinUrl) || '';
      if (joinUrl && !teamsUrl) {
        teamsUrl = joinUrl;
        await supabase.from('meetings').update({ teams_meeting_url: joinUrl }).eq('id', meetingId);
      }
    } catch (error: any) {
      notes.push(
        `The meeting is in the CRM but not on the staff calendar (${error?.message || 'unknown error'}).`,
      );
    }
  }

  const canceledMeetingIds: number[] = [];
  if (replaced) {
    try {
      const canceled = await cancelMeetingById({
        supabase,
        meetingId: replaced.id,
        editorDisplayName: actorName,
        excludeMeetingId: meetingId,
      });
      if (canceled) canceledMeetingIds.push(replaced.id);
      else notes.push(`Could not cancel the previous meeting (#${replaced.id}) — cancel it in the CRM.`);
    } catch (error: any) {
      notes.push(
        `Could not cancel the previous meeting (#${replaced.id}): ${error?.message || 'unknown error'}.`,
      );
    }
  }

  const stageDecision = decideMeetingStage({
    stage: lead.stage,
    calendar: calendarDecision.calendar,
    mode,
  });
  let stageMovedTo: number | null = null;
  let stageNote = stageDecision.note;
  if (calendarDecision.calendar !== 'staff') {
    const roleFields: Record<string, unknown> = {};
    if (lead.isLegacy) {
      if (isPotential && actor.employeeId != null) roleFields.meeting_scheduler_id = actor.employeeId;
      if (request.manager?.id != null) roleFields.meeting_manager_id = request.manager.id;
      if (request.helper?.id != null) roleFields.meeting_lawyer_id = request.helper.id;
    } else {
      if (isPotential && schedulerName && schedulerName !== '---') roleFields.scheduler = schedulerName;
      if (request.manager?.id != null) {
        roleFields.manager = request.manager.id;
        roleFields.meeting_manager_id = request.manager.id;
      }
      if (request.helper?.id != null) {
        roleFields.helper = request.helper.id;
        roleFields.meeting_lawyer_id = request.helper.id;
      }
    }

    try {
      if (stageDecision.stage != null) {
        await updateLeadStageWithHistory({
          lead: { ...lead.row, id: lead.id, lead_type: lead.isLegacy ? 'legacy' : 'new' } as any,
          stage: stageDecision.stage,
          additionalFields: roleFields,
          actor,
        });
        stageMovedTo = stageDecision.stage;
      } else if (Object.keys(roleFields).length > 0) {
        const { error: roleError } = lead.isLegacy
          ? await supabase.from('leads_lead').update(roleFields).eq('id', Number(lead.recordId))
          : await supabase.from('leads').update(roleFields).eq('id', lead.recordId);
        if (roleError) throw roleError;
      }
    } catch (error: any) {
      stageNote = `The meeting is booked, but updating the lead stage failed (${
        error?.message || 'unknown error'
      }) — set the stage in the CRM.`;
    }
  }

  const summary: AiMeetingSummary = {
    leadNumber: lead.leadNumber,
    leadName: lead.name,
    isLegacy: lead.isLegacy,
    date: request.date,
    time: request.time,
    durationMinutes,
    location: location.name,
    calendarLabel: calendarDecision.label,
    outlookCalendarEmail,
    manager: managerName,
    helper: helperName,
    mode,
    stageNote,
    replaced: replaced ? { date: replaced.meeting_date, time: replaced.meeting_time } : null,
    notes,
    joinUrl: teamsUrl || null,
  };

  return {
    status: 'booked',
    message: buildMeetingConfirmation(summary),
    summary,
    meetingId,
    calendar: calendarDecision.calendar,
    outlookCalendarEmail,
    stageMovedTo,
    canceledMeetingIds,
  };
}

/**
 * Whether booking another meeting should really be a reschedule.
 *
 * Up to Client signed agreement the pipeline runs one meeting at a time — the stage buttons go
 * schedule → another meeting → reschedule — so a second live booking would leave the stage
 * describing something that is no longer true. From stage 60 a case can have as many meetings as it
 * needs, so nothing is in the way.
 */
export function shouldAskToRescheduleInstead(args: {
  stage: unknown;
  activeMeetings: Array<{ meeting_date?: string | null }>;
  todayIso: string;
}): { ask: true; upcoming: { meeting_date?: string | null } } | { ask: false } {
  if (allowsAdditionalLeadMeetings(args.stage)) return { ask: false };
  const upcoming = args.activeMeetings.find(
    (row) => String(row.meeting_date || '') >= args.todayIso,
  );
  return upcoming ? { ask: true, upcoming } : { ask: false };
}
