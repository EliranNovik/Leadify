const supabase = require('../config/supabase');
const nineHourOvertimeWhatsAppService = require('./nineHourOvertimeWhatsAppService');

const JERUSALEM_TZ = 'Asia/Jerusalem';
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_MIN_HOURS = 8;
const PRESENCE_STALE_MS = Number(process.env.CLOCK_IN_PRESENCE_STALE_MS || 90_000);
const WORKDAY_END_HOUR_JERUSALEM = Number(process.env.CLOCK_IN_WORKDAY_END_HOUR_JERUSALEM || 23);

function jerusalemDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: JERUSALEM_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function jerusalemTimeParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: JERUSALEM_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { hour: get('hour'), minute: get('minute'), second: get('second') };
}

function buildJerusalemStartOfDayIso(dateStr) {
  for (const offset of ['+03:00', '+02:00']) {
    const candidate = `${dateStr}T00:00:00.000${offset}`;
    const d = new Date(candidate);
    const { hour, minute, second } = jerusalemTimeParts(d);
    if (jerusalemDateKey(d) === dateStr && hour === 0 && minute === 0 && second === 0) {
      return d.toISOString();
    }
  }
  return new Date(`${dateStr}T00:00:00+03:00`).toISOString();
}

function buildJerusalemEndOfDayIso(dateStr) {
  for (const offset of ['+03:00', '+02:00']) {
    const candidate = `${dateStr}T23:59:59.999${offset}`;
    const d = new Date(candidate);
    const { hour, minute, second } = jerusalemTimeParts(d);
    if (jerusalemDateKey(d) === dateStr && hour === 23 && minute === 59 && second === 59) {
      return d.toISOString();
    }
  }
  return new Date(`${dateStr}T23:59:59.999+03:00`).toISOString();
}

function parseExternFlag(extern) {
  return (
    extern === true
    || extern === 'true'
    || extern === 1
    || extern === '1'
    || (typeof extern === 'string' && extern.toLowerCase() === 'true')
  );
}

function normalizeMinHours(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MIN_HOURS;
  return parsed;
}

/**
 * When the open session should be stamped as having ended: the moment the day's allowance ran out.
 *
 * Stores the hours the employee is actually owed rather than the wall-clock span up to whenever this
 * ran, by subtracting what today already has closed against it. Never writes a time after `now` or
 * before clock-in.
 */
function computeAllowanceClockOutIso(clockInIso, allowanceMs, closedMs = 0, nowMs = Date.now()) {
  const startMs = new Date(clockInIso).getTime();
  if (!Number.isFinite(startMs)) return new Date(nowMs).toISOString();
  const remainingMs = Math.max(0, allowanceMs - closedMs);
  const targetMs = startMs + remainingMs;
  const endMs = Math.min(Math.max(targetMs, startMs), nowMs);
  return new Date(endMs).toISOString();
}

async function isExternalAuthUser(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('extern')
    .eq('auth_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[AutoClockOut] extern lookup failed:', error.message);
    return false;
  }

  return parseExternFlag(data?.extern);
}

async function fetchEmployeeMinHours(employeeId) {
  const { data, error } = await supabase
    .from('tenants_employee')
    .select('min_hours')
    .eq('id', employeeId)
    .maybeSingle();

  if (error) {
    console.error('[AutoClockOut] min_hours lookup failed:', error.message);
    return DEFAULT_MIN_HOURS;
  }

  return normalizeMinHours(data?.min_hours);
}

/**
 * Whether a session was typed in rather than clocked live.
 *
 * `manually` alone is not enough to tell: the manual-entry screens clear it when the session is short
 * enough to auto-approve, so a pre-added row can look automatic. Every one of them does set
 * `location_source` to 'manual', which is what actually separates the two.
 *
 * An edited live session ends up marked 'manual' too, and that is the right side of the line for it to
 * land on — an edit is a figure someone signed off on, so it should behave like a pre-added entry.
 */
function isPreAddedSession(record) {
  return (
    record?.manually === true
    || String(record?.location_source || '').trim().toLowerCase() === 'manual'
  );
}

/**
 * A timestamp as epoch milliseconds, or null when it cannot be read as one.
 *
 * The empty and nullish check has to come first: `new Date(null)` is the epoch rather than an invalid
 * date, so a row with no clock-in would otherwise measure as decades of work and be clocked straight
 * back out. The query cannot return such a row today, but nothing about this arithmetic should depend
 * on that.
 */
function toEpochMs(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Split a day's sessions into the three figures the clock-in policy needs.
 *
 * - `elapsedMs` — everything worked today, with the still-open session counted up to `now`.
 * - `preAddedMs` — the share of that which was entered by hand, excluding the open session.
 * - `closedMs` — the share already clocked out, again excluding the open session.
 *
 * Declined sessions are left out of all three: an entry that was rejected is not worked time, so it
 * must neither push the employee toward their clock-out nor extend their day.
 *
 * Kept separate from the query so the arithmetic can be tested without a database.
 */
function summarizeTodayHours(rows, activeRecordId = null, now = Date.now()) {
  let elapsedMs = 0;
  let preAddedMs = 0;
  let closedMs = 0;

  for (const record of rows ?? []) {
    if (record?.declined === true) continue;

    const start = toEpochMs(record.clock_in_time);
    // No usable start, so there is no duration to attribute and nothing worth guessing at.
    if (start === null) continue;
    /*
     * A clock-out that will not parse leaves the session counted as still running, in both the
     * duration and the closed bucket below. Splitting those two decisions is how a row ends up
     * measured to `now` yet filed as finished.
     */
    const closedEnd = record.clock_out_time ? toEpochMs(record.clock_out_time) : null;
    const ms = Math.max(0, (closedEnd ?? now) - start);

    elapsedMs += ms;
    if (record.id === activeRecordId) continue;
    if (closedEnd !== null) closedMs += ms;
    if (isPreAddedSession(record)) preAddedMs += ms;
  }

  return { elapsedMs, preAddedMs, closedMs };
}

/**
 * Today's hours for one employee.
 *
 * One query for all three figures rather than one each: the scheduler runs every minute over every
 * open session, so a round trip here is paid per employee per minute.
 */
async function fetchTodayHours(employeeId, activeRecordId = null, now = Date.now()) {
  const dateKey = jerusalemDateKey(new Date(now));
  const todayStart = buildJerusalemStartOfDayIso(dateKey);
  const todayEnd = buildJerusalemEndOfDayIso(dateKey);

  const { data, error } = await supabase
    .from('employee_clock_in')
    .select('id, clock_in_time, clock_out_time, manually, declined, location_source')
    .eq('employee_id', employeeId)
    .gte('clock_in_time', todayStart)
    .lte('clock_in_time', todayEnd);

  if (error) throw error;

  return summarizeTodayHours(data, activeRecordId, now);
}

/**
 * Whether a session is still open right now.
 *
 * The run reads every active session up front and then works through them one at a time, so by the
 * time a record is reached the employee may have clocked out by hand. Both the reminder and the
 * clock-out check this first — neither should reach someone who has already left for the day.
 *
 * Treats a failed lookup as "not clocked in", so an unreadable row is skipped rather than messaged
 * or clocked out on a guess.
 */
async function isStillClockedIn(recordId) {
  const { data, error } = await supabase
    .from('employee_clock_in')
    .select('is_active')
    .eq('id', recordId)
    .maybeSingle();

  if (error) {
    console.error('[AutoClockOut] active-session re-check failed:', error.message);
    return false;
  }

  return data?.is_active === true;
}

/**
 * Close an open session, and report whether this call is the one that closed it.
 *
 * `is_active` is part of the match, not just the id: a session closed since the run started is left
 * untouched, and two overlapping runs cannot both clock the same session out. A match of zero rows is
 * not an error in PostgREST, so the updated rows are selected back to tell the two apart.
 *
 * @returns {Promise<boolean>} true when this call wrote the clock-out.
 */
async function clockOutActiveRecord(record, notes, clockOutTime = new Date().toISOString()) {
  const baseUpdate = {
    clock_out_time: clockOutTime,
    is_active: false,
    notes,
  };

  const applyUpdate = async (payload) => {
    const { data, error } = await supabase
      .from('employee_clock_in')
      .update(payload)
      .eq('id', record.id)
      .eq('is_active', true)
      .select('id');
    return { rows: data?.length ?? 0, error };
  };

  if (record.clock_in_location_id) {
    const { rows, error } = await applyUpdate({
      ...baseUpdate,
      clock_out_location_id: record.clock_in_location_id,
    });
    if (!error) return rows > 0;
  }

  const { rows, error: fallbackError } = await applyUpdate(baseUpdate);
  if (fallbackError) throw fallbackError;
  return rows > 0;
}

function isPastJerusalemWorkdayEnd(now = new Date()) {
  const { hour } = jerusalemTimeParts(now);
  return hour >= WORKDAY_END_HOUR_JERUSALEM;
}

/**
 * How long today may run before the open session is closed: the employee's own `min_hours`, plus any
 * hours they pre-added by hand.
 *
 * The pre-added hours are already inside `elapsedMs`, so counting them here cancels them out of the
 * comparison — which is the entire point. Before this, someone who pre-added an approved extra block
 * for today carried those hours into the total the moment they arrived, which put them past their
 * base hours and had them force-closed and notified within a minute of clocking in. Now their live
 * session still gets its full base hours and the pre-added block sits on top, where it belongs.
 */
function resolveClockInAllowanceMs(minHours, preAddedMs = 0) {
  return normalizeMinHours(minHours) * HOUR_MS + Math.max(0, preAddedMs || 0);
}

/**
 * The allowance in words, for the note left on the session and the run's log line.
 *
 * Spells out the pre-added part when there is one, so anyone reading a clock-out that landed well
 * past base hours can see why without going back through the day's other entries.
 */
function describeAllowance(minHours, preAddedMs = 0) {
  const hours = normalizeMinHours(minHours);
  if (!(preAddedMs > 0)) return `base hours (${hours}h)`;
  const preAddedHours = Math.round((preAddedMs / HOUR_MS) * 100) / 100;
  return `${Math.round((hours + preAddedHours) * 100) / 100}h (base ${hours}h + ${preAddedHours}h pre-added)`;
}

/**
 * Which stage of the clock-in policy an open session has reached, or null for neither.
 *
 * The reminder lands an hour before the allowance and the clock-out on it. Both arguments are
 * milliseconds, so nothing here needs to know how the allowance was arrived at.
 *
 * `clock_out` wins when both thresholds are behind the employee — a session only ever advances, and a
 * run that catches up on a missed reminder must still clock the session out rather than nudge it.
 */
function resolveClockInStage(elapsedMs, allowanceMs) {
  if (elapsedMs >= allowanceMs) return 'clock_out';
  // An allowance of an hour or less leaves no room for a reminder ahead of the clock-out.
  const reminderMs = allowanceMs - HOUR_MS;
  if (reminderMs > 0 && elapsedMs >= reminderMs) return 'reminder';
  return null;
}

async function runNineHourAutoClockOut() {
  const workDate = jerusalemDateKey();
  const { data: activeRecords, error } = await supabase
    .from('employee_clock_in')
    .select('id, employee_id, user_id, clock_in_time, clock_in_location_id')
    .eq('is_active', true);

  if (error) throw error;

  const summary = {
    checked: activeRecords?.length ?? 0,
    clockedOut: 0,
    /** Clock-outs from reaching the employee's own base hours, which is the normal path. */
    baseHoursClockOuts: 0,
    /** Clock-outs from the 23:00 sweep, which only catches sessions the base-hours path missed. */
    endOfDayClockOuts: 0,
    whatsappSent: 0,
    whatsappSkipped: 0,
    skipped: 0,
    errors: [],
  };

  const pastWorkdayEnd = isPastJerusalemWorkdayEnd();
  const nowMs = Date.now();

  for (const record of activeRecords ?? []) {
    try {
      if (!record.user_id) {
        summary.skipped += 1;
        continue;
      }

      if (await isExternalAuthUser(record.user_id)) {
        summary.skipped += 1;
        continue;
      }

      if (pastWorkdayEnd) {
        const minHours = await fetchEmployeeMinHours(record.employee_id);
        const today = await fetchTodayHours(record.employee_id, record.id, nowMs);
        const allowanceMs = resolveClockInAllowanceMs(minHours, today.preAddedMs);
        const clockOutTime = computeAllowanceClockOutIso(
          record.clock_in_time,
          allowanceMs,
          today.closedMs,
          nowMs,
        );
        const didClockOut = await clockOutActiveRecord(
          record,
          `Auto clock-out: end of workday (${WORKDAY_END_HOUR_JERUSALEM}:00 Asia/Jerusalem);`
            + ` duration set to ${describeAllowance(minHours, today.preAddedMs)}`,
          clockOutTime,
        );

        if (!didClockOut) {
          summary.skipped += 1;
          continue;
        }

        summary.clockedOut += 1;
        summary.endOfDayClockOuts += 1;

        console.log(
          `[AutoClockOut] employee=${record.employee_id} end-of-day clock out at ${clockOutTime}`
            + ` (${describeAllowance(minHours, today.preAddedMs)}, session kept)`,
        );
        continue;
      }

      const minHours = await fetchEmployeeMinHours(record.employee_id);
      const today = await fetchTodayHours(record.employee_id, record.id, nowMs);
      const allowanceMs = resolveClockInAllowanceMs(minHours, today.preAddedMs);
      const stage = resolveClockInStage(today.elapsedMs, allowanceMs);

      if (!stage) {
        summary.skipped += 1;
        continue;
      }

      /*
       * Only act on a session that is still open.
       *
       * The active list was read at the top of the run and every record since has cost several
       * queries, so an employee may well have clocked out by hand in the meantime. Checked here for
       * both stages, because neither a reminder nor a "you have been signed out" notice should reach
       * someone who already left.
       */
      if (!(await isStillClockedIn(record.id))) {
        summary.skipped += 1;
        continue;
      }

      if (stage === 'clock_out') {
        /*
         * Stamped at the moment they actually used up the allowance, not at the moment this run
         * noticed. The scheduler ticks once a minute, so `now` would otherwise drift past it.
         */
        const clockOutTime = computeAllowanceClockOutIso(
          record.clock_in_time,
          allowanceMs,
          today.closedMs,
          nowMs,
        );
        const didClockOut = await clockOutActiveRecord(
          record,
          `Auto clock-out: reached ${describeAllowance(minHours, today.preAddedMs)}`,
          clockOutTime,
        );

        // Lost the race to a manual clock-out, so there is nothing to announce.
        if (!didClockOut) {
          summary.skipped += 1;
          continue;
        }

        summary.clockedOut += 1;
        summary.baseHoursClockOuts += 1;
        console.log(
          `[AutoClockOut] employee=${record.employee_id} clocked out at ${clockOutTime}`
            + ` (${describeAllowance(minHours, today.preAddedMs)})`,
        );
      }

      /*
       * Sent after the clock-out, not before: template 51 says the employee *has been* signed out, so
       * it must not go out until that is true. A send failure leaves them correctly clocked out and is
       * reported rather than retried, since the next run sees an inactive session.
       */
      const whatsappResult = await nineHourOvertimeWhatsAppService.sendClockInWhatsAppIfNeeded(
        record.employee_id,
        workDate,
        stage,
      );
      if (whatsappResult.sent) {
        summary.whatsappSent += 1;
      } else if (whatsappResult.error) {
        summary.errors.push({
          employeeId: record.employee_id,
          message: `Clock-in WhatsApp (${stage}): ${whatsappResult.error}`,
        });
      } else {
        summary.whatsappSkipped += 1;
      }

      if (stage === 'reminder') summary.skipped += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ employeeId: record.employee_id, message });
      console.error(
        `[AutoClockOut] failed for employee=${record.employee_id}:`,
        message,
      );
    }
  }

  return summary;
}

module.exports = {
  runNineHourAutoClockOut,
  HOUR_MS,
  PRESENCE_STALE_MS,
  WORKDAY_END_HOUR_JERUSALEM,
  DEFAULT_MIN_HOURS,
  _internal: {
    jerusalemDateKey,
    fetchTodayHours,
    summarizeTodayHours,
    isPreAddedSession,
    resolveClockInAllowanceMs,
    describeAllowance,
    resolveClockInStage,
    isPastJerusalemWorkdayEnd,
    computeAllowanceClockOutIso,
    normalizeMinHours,
  },
};
