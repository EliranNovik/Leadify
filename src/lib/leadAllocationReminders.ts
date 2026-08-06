import {
  canAccessLeadTimeReport,
  fetchCurrentEmployeeContext,
  fetchMissingLeadAllocationDates,
  getJerusalemTodayIsoDate,
  latestMissingLeadAllocationDate,
  leadTimeReportPathForDate,
  listExpectedLeadAllocationWorkDates,
  LEAD_ALLOCATION_SAVED_EVENT,
  minHoursToMs,
  type CurrentEmployeeContext,
} from './employeeLeadReporting';
import { fetchActiveClockInRecord } from './employeeClockOut';
import { isIsraeliWeekendIso } from './employeeExtraHours';

const JERUSALEM_TZ = 'Asia/Jerusalem';

export const LEAD_ALLOCATION_REMINDER_POLL_MS = 30_000;

export type LeadAllocationReminderSlot =
  | 'clocked_1h'
  | 'clocked_15m'
  | 'fixed_16'
  | 'fixed_17';

type ReminderState = {
  dateKey: string;
  firedSlots: LeadAllocationReminderSlot[];
  /** Jerusalem hours (0–23) for which the backlog modal was already shown today. */
  modalHoursShown: number[];
};

function storageKey(employeeId: number, dateKey: string): string {
  return `lead_alloc_reminder_v1:${employeeId}:${dateKey}`;
}

function readState(employeeId: number, dateKey: string): ReminderState {
  try {
    const raw = sessionStorage.getItem(storageKey(employeeId, dateKey));
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
  try {
    sessionStorage.setItem(storageKey(employeeId, state.dateKey), JSON.stringify(state));
  } catch {
    /* ignore quota */
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

/** True when the backlog modal should open for this Jerusalem hour. */
export function shouldOpenLeadAllocationBacklogModal(params: {
  employeeId: number;
  missingDates: string[];
  now?: Date;
}): boolean {
  const today = getJerusalemTodayIsoDate(params.now);
  const pastMissing = pastMissingLeadAllocationDates(params.missingDates, today);
  if (pastMissing.length === 0) return false;
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

/**
 * Due reminder slots for this moment.
 * Clocked in → 1h and 15m before (clock-in + base hours).
 * Not clocked in → 16:00 and 17:00 Asia/Jerusalem.
 */
export function resolveDueLeadAllocationReminderSlots(params: {
  now?: Date;
  dateKey: string;
  isClockedIn: boolean;
  clockInTimeIso: string | null;
  minHours: number;
  firedSlots: Iterable<LeadAllocationReminderSlot>;
}): LeadAllocationReminderSlot[] {
  const now = params.now ?? new Date();
  const fired = new Set(params.firedSlots);
  const due: LeadAllocationReminderSlot[] = [];

  // Timed day-end reminders only on expected workdays.
  if (isIsraeliWeekendIso(params.dateKey)) return due;
  if (!listExpectedLeadAllocationWorkDates(params.dateKey).includes(params.dateKey)) {
    return due;
  }

  if (params.isClockedIn && params.clockInTimeIso) {
    const clockInMs = new Date(params.clockInTimeIso).getTime();
    if (Number.isFinite(clockInMs)) {
      const baseEndMs = clockInMs + minHoursToMs(params.minHours);
      const oneHourBefore = baseEndMs - 60 * 60 * 1000;
      const fifteenBefore = baseEndMs - 15 * 60 * 1000;
      const nowMs = now.getTime();

      if (nowMs >= oneHourBefore && !fired.has('clocked_1h')) {
        due.push('clocked_1h');
      }
      if (nowMs >= fifteenBefore && !fired.has('clocked_15m')) {
        due.push('clocked_15m');
      }
    }
    return due;
  }

  const minutes = jerusalemMinutesSinceMidnight(now);
  if (minutes >= 16 * 60 && !fired.has('fixed_16')) due.push('fixed_16');
  if (minutes >= 17 * 60 && !fired.has('fixed_17')) due.push('fixed_17');
  return due;
}

export function leadAllocationReminderCopy(slot: LeadAllocationReminderSlot): {
  title: string;
  body: string;
} {
  switch (slot) {
    case 'clocked_1h':
      return {
        title: 'Daily lead report due soon',
        body: 'About 1 hour left in your base hours — fill today\'s lead allocation before you finish.',
      };
    case 'clocked_15m':
      return {
        title: '15 minutes left',
        body: 'Almost at your base hours. Submit today’s daily lead allocation now.',
      };
    case 'fixed_16':
      return {
        title: 'Daily lead report reminder',
        body: 'It’s 16:00 — remember to complete your daily lead allocation report.',
      };
    case 'fixed_17':
      return {
        title: 'Daily lead report still open',
        body: 'It’s 17:00 — your daily lead allocation for today is still missing.',
      };
    default:
      return {
        title: 'Daily lead report',
        body: 'You have a missing daily lead allocation to fill out.',
      };
  }
}

export type LeadAllocationReminderSnapshot = {
  ctx: CurrentEmployeeContext;
  missingDates: string[];
  todayMissing: boolean;
  latestMissing: string | null;
  isClockedIn: boolean;
  clockInTimeIso: string | null;
};

export async function loadLeadAllocationReminderSnapshot(): Promise<LeadAllocationReminderSnapshot | null> {
  const ctx = await fetchCurrentEmployeeContext();
  if (
    !ctx ||
    !canAccessLeadTimeReport({
      isSuperUser: ctx.isSuperUser,
      bonusesRole: ctx.bonusesRole,
    })
  ) {
    return null;
  }

  const [missingDates, active] = await Promise.all([
    fetchMissingLeadAllocationDates(ctx.employeeId),
    fetchActiveClockInRecord(ctx.employeeId).catch(() => null),
  ]);

  const today = getJerusalemTodayIsoDate();
  return {
    ctx,
    missingDates,
    todayMissing: missingDates.includes(today),
    latestMissing: latestMissingLeadAllocationDate(missingDates),
    isClockedIn: Boolean(active),
    clockInTimeIso: active?.clock_in_time ?? null,
  };
}

export { LEAD_ALLOCATION_SAVED_EVENT, leadTimeReportPathForDate };
