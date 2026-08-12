import {
  canAccessLeadTimeReport,
  fetchCurrentEmployeeContext,
  fetchMissingLeadAllocationDates,
  fetchSickVacationExemptDatesForEmployee,
  getJerusalemTodayIsoDate,
  latestMissingLeadAllocationDate,
  leadTimeReportPathForDate,
  listExpectedLeadAllocationWorkDates,
  LEAD_ALLOCATION_REPORTING_START_DATE,
  LEAD_ALLOCATION_SAVED_EVENT,
  minHoursToMs,
  normalizeLeadTimeReportingExcludedDates,
  type CurrentEmployeeContext,
} from './employeeLeadReporting';
import { fetchActiveClockInRecord } from './employeeClockOut';

const JERUSALEM_TZ = 'Asia/Jerusalem';

export const LEAD_ALLOCATION_REMINDER_POLL_MS = 30_000;

/** How long after a slot starts we may still fire it (avoids late catch-up on login). */
export const LEAD_ALLOCATION_REMINDER_SLOT_WINDOW_MINUTES = 45;

export type LeadAllocationReminderSlot =
  | 'clocked_1h'
  | 'clocked_15m'
  | 'fixed_16'
  | 'fixed_17';

type ReminderState = {
  dateKey: string;
  /** Toast slots already fired today (current-day report only). */
  firedSlots: LeadAllocationReminderSlot[];
  /** Jerusalem hours (0–23) for which the past-days backlog modal was already shown today. */
  modalHoursShown: number[];
};

function storageKey(employeeId: number, dateKey: string): string {
  // v2: localStorage so dismiss/fired state survives tab close, logout, and new sessions.
  return `lead_alloc_reminder_v2:${employeeId}:${dateKey}`;
}

function legacySessionKey(employeeId: number, dateKey: string): string {
  return `lead_alloc_reminder_v1:${employeeId}:${dateKey}`;
}

function readRawState(employeeId: number, dateKey: string): string | null {
  try {
    const fromLocal = localStorage.getItem(storageKey(employeeId, dateKey));
    if (fromLocal) return fromLocal;
  } catch {
    /* ignore */
  }
  try {
    return sessionStorage.getItem(legacySessionKey(employeeId, dateKey));
  } catch {
    return null;
  }
}

function readState(employeeId: number, dateKey: string): ReminderState {
  try {
    const raw = readRawState(employeeId, dateKey);
    if (!raw) {
      return { dateKey, firedSlots: [], modalHoursShown: [] };
    }
    const parsed = JSON.parse(raw) as Partial<ReminderState>;
    return {
      dateKey,
      firedSlots: Array.isArray(parsed.firedSlots)
        ? (parsed.firedSlots.filter(Boolean) as LeadAllocationReminderSlot[])
        : [],
      modalHoursShown: Array.isArray(parsed.modalHoursShown)
        ? parsed.modalHoursShown
            .map((h) => Number(h))
            .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23)
        : [],
    };
  } catch {
    return { dateKey, firedSlots: [], modalHoursShown: [] };
  }
}

function writeState(employeeId: number, state: ReminderState): void {
  const payload = JSON.stringify(state);
  try {
    localStorage.setItem(storageKey(employeeId, state.dateKey), payload);
  } catch {
    /* ignore quota */
  }
  try {
    sessionStorage.removeItem(legacySessionKey(employeeId, state.dateKey));
  } catch {
    /* ignore */
  }
}

function jerusalemTimeParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: JERUSALEM_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { hour: get('hour'), minute: get('minute'), second: get('second') };
}

export function getJerusalemHour(now = new Date()): number {
  return jerusalemTimeParts(now).hour;
}

/** Missing reports for days strictly before today (backlog only — never includes today). */
export function pastMissingLeadAllocationDates(
  missingDates: string[],
  todayIso: string = getJerusalemTodayIsoDate(),
): string[] {
  return missingDates.filter((day) => day < todayIso);
}

export function hasShownLeadAllocationReminderModalForHour(
  employeeId: number,
  hour: number,
  dateKey = getJerusalemTodayIsoDate(),
): boolean {
  return readState(employeeId, dateKey).modalHoursShown.includes(hour);
}

export function markLeadAllocationReminderModalShownForHour(
  employeeId: number,
  hour: number,
  dateKey = getJerusalemTodayIsoDate(),
): void {
  const state = readState(employeeId, dateKey);
  if (!state.modalHoursShown.includes(hour)) {
    state.modalHoursShown.push(hour);
    writeState(employeeId, state);
  }
}

/**
 * Backlog modal: only when there are past missing days (yesterday and earlier),
 * a due time slot is active, and we have not already shown the modal this hour.
 * Never opens for "today only".
 */
export function shouldOpenLeadAllocationBacklogModal(params: {
  employeeId: number;
  missingDates: string[];
  dueSlots: LeadAllocationReminderSlot[];
  now?: Date;
}): boolean {
  const today = getJerusalemTodayIsoDate(params.now);
  const pastMissing = pastMissingLeadAllocationDates(params.missingDates, today);
  if (pastMissing.length === 0) return false;
  if (!params.dueSlots.length) return false;
  const hour = getJerusalemHour(params.now);
  return !hasShownLeadAllocationReminderModalForHour(params.employeeId, hour, today);
}

/** Marks the current Jerusalem hour as shown so the modal waits until the next hour. */
export function markLeadAllocationReminderModalDismissed(
  employeeId: number,
  dateKey = getJerusalemTodayIsoDate(),
): void {
  markLeadAllocationReminderModalShownForHour(
    employeeId,
    getJerusalemHour(),
    dateKey,
  );
}

export function hasFiredLeadAllocationReminderSlot(
  employeeId: number,
  slot: LeadAllocationReminderSlot,
  dateKey = getJerusalemTodayIsoDate(),
): boolean {
  return readState(employeeId, dateKey).firedSlots.includes(slot);
}

export function markLeadAllocationReminderSlotFired(
  employeeId: number,
  slot: LeadAllocationReminderSlot,
  dateKey = getJerusalemTodayIsoDate(),
): void {
  const state = readState(employeeId, dateKey);
  if (!state.firedSlots.includes(slot)) {
    state.firedSlots.push(slot);
    writeState(employeeId, state);
  }
}

export function jerusalemMinutesSinceMidnight(now = new Date()): number {
  const { hour, minute } = jerusalemTimeParts(now);
  return hour * 60 + minute;
}

function isWithinSlotWindow(nowMs: number, slotStartMs: number, windowMinutes: number): boolean {
  return nowMs >= slotStartMs && nowMs < slotStartMs + windowMinutes * 60 * 1000;
}

/**
 * Due reminder time slots for this moment.
 * Clocked in (today’s session) → 1h and 15m before (clock-in + base hours).
 * Otherwise → 16:00 and 17:00 Asia/Jerusalem.
 *
 * @param requireExpectedWorkday — when true (today's toast reminders), skip if today is
 *   not a required reporting day (weekday mask / excluded / sick / vacation).
 *   when false (past-days modal), still use the clock/fixed clocks so backlog can surface
 *   even if today itself is exempt.
 */
export function resolveDueLeadAllocationReminderSlots(params: {
  now?: Date;
  dateKey: string;
  isClockedIn: boolean;
  clockInTimeIso: string | null;
  minHours: number;
  firedSlots: Iterable<LeadAllocationReminderSlot>;
  weekdays?: number[];
  /** Profile excluded + sick/vacation exempt dates. */
  excludedDates?: string[];
  slotWindowMinutes?: number;
  requireExpectedWorkday?: boolean;
}): LeadAllocationReminderSlot[] {
  const now = params.now ?? new Date();
  const fired = new Set(params.firedSlots);
  const due: LeadAllocationReminderSlot[] = [];
  const windowMinutes = params.slotWindowMinutes ?? LEAD_ALLOCATION_REMINDER_SLOT_WINDOW_MINUTES;
  const requireExpectedWorkday = params.requireExpectedWorkday !== false;

  if (requireExpectedWorkday) {
    if (
      !listExpectedLeadAllocationWorkDates(params.dateKey, undefined, {
        weekdays: params.weekdays,
        excludedDates: params.excludedDates,
      }).includes(params.dateKey)
    ) {
      return due;
    }
  }

  const clockInMs =
    params.isClockedIn && params.clockInTimeIso
      ? new Date(params.clockInTimeIso).getTime()
      : NaN;
  const clockInIsToday =
    Number.isFinite(clockInMs) &&
    getJerusalemTodayIsoDate(new Date(clockInMs)) === params.dateKey;

  if (clockInIsToday) {
    const baseEndMs = clockInMs + minHoursToMs(params.minHours);
    const oneHourBefore = baseEndMs - 60 * 60 * 1000;
    const fifteenBefore = baseEndMs - 15 * 60 * 1000;
    const nowMs = now.getTime();

    if (isWithinSlotWindow(nowMs, oneHourBefore, windowMinutes) && !fired.has('clocked_1h')) {
      due.push('clocked_1h');
    }
    if (isWithinSlotWindow(nowMs, fifteenBefore, windowMinutes) && !fired.has('clocked_15m')) {
      due.push('clocked_15m');
    }
    return due;
  }

  const minutes = jerusalemMinutesSinceMidnight(now);
  const fixed16 = 16 * 60;
  const fixed17 = 17 * 60;
  if (
    minutes >= fixed16 &&
    minutes < fixed16 + windowMinutes &&
    !fired.has('fixed_16')
  ) {
    due.push('fixed_16');
  }
  if (
    minutes >= fixed17 &&
    minutes < fixed17 + windowMinutes &&
    !fired.has('fixed_17')
  ) {
    due.push('fixed_17');
  }
  return due;
}

export function leadAllocationReminderCopy(slot: LeadAllocationReminderSlot): {
  title: string;
  body: string;
} {
  switch (slot) {
    case 'clocked_1h':
      return {
        title: 'Today’s lead report due soon',
        body: 'About 1 hour left in your base hours — fill today’s lead allocation before you finish.',
      };
    case 'clocked_15m':
      return {
        title: '15 minutes left',
        body: 'Almost at your base hours. Submit today’s daily lead allocation now.',
      };
    case 'fixed_16':
      return {
        title: 'Today’s lead report reminder',
        body: 'It’s 16:00 — remember to complete today’s daily lead allocation report.',
      };
    case 'fixed_17':
      return {
        title: 'Today’s lead report still open',
        body: 'It’s 17:00 — today’s daily lead allocation is still missing.',
      };
    default:
      return {
        title: 'Today’s lead report',
        body: 'Please fill out today’s daily lead allocation.',
      };
  }
}

export type LeadAllocationReminderSnapshot = {
  ctx: CurrentEmployeeContext;
  /** All missing required days (past + today), after weekdays/excluded/sick/vacation filters. */
  missingDates: string[];
  /** Yesterday and earlier only. */
  pastMissingDates: string[];
  todayMissing: boolean;
  latestMissing: string | null;
  isClockedIn: boolean;
  clockInTimeIso: string | null;
  /**
   * Effective excluded dates for slot gating: profile excluded_dates + approved
   * sick_days / vacation covering the reporting window.
   */
  effectiveExcludedDates: string[];
};

export async function loadLeadAllocationReminderSnapshot(): Promise<LeadAllocationReminderSnapshot | null> {
  const ctx = await fetchCurrentEmployeeContext();
  // Only employees with lead-time reporting enabled get reminders / backlog modal.
  if (
    !ctx ||
    !canAccessLeadTimeReport({
      leadTimeReportingEnabled: ctx.leadTimeReportingEnabled,
    })
  ) {
    return null;
  }

  const today = getJerusalemTodayIsoDate();

  const [missingDates, active, sickVacationDates] = await Promise.all([
    // Internally merges weekdays + profile excluded + sick/vacation.
    fetchMissingLeadAllocationDates(ctx.employeeId, {
      weekdays: ctx.leadTimeReportingWeekdays,
      excludedDates: ctx.leadTimeReportingExcludedDates,
    }),
    fetchActiveClockInRecord(ctx.employeeId).catch(() => null),
    fetchSickVacationExemptDatesForEmployee(
      ctx.employeeId,
      LEAD_ALLOCATION_REPORTING_START_DATE,
      today,
    ).catch(() => [] as string[]),
  ]);

  const effectiveExcludedDates = normalizeLeadTimeReportingExcludedDates([
    ...ctx.leadTimeReportingExcludedDates,
    ...sickVacationDates,
  ]);

  return {
    ctx,
    missingDates,
    pastMissingDates: pastMissingLeadAllocationDates(missingDates, today),
    todayMissing: missingDates.includes(today),
    latestMissing: latestMissingLeadAllocationDate(missingDates),
    isClockedIn: Boolean(active),
    clockInTimeIso: active?.clock_in_time ?? null,
    effectiveExcludedDates,
  };
}

export { LEAD_ALLOCATION_SAVED_EVENT, leadTimeReportPathForDate };
