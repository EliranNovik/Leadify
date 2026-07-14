const supabase = require('../config/supabase');
const nineHourOvertimeWhatsAppService = require('./nineHourOvertimeWhatsAppService');

const JERUSALEM_TZ = 'Asia/Jerusalem';
const NINE_HOURS_MS = 9 * 60 * 60 * 1000;
const OVERTIME_PROMPT_MS = 10 * 60 * 1000;
const OVERTIME_FINAL_COUNTDOWN_MS = 20 * 1000;
/** Same deadline as the in-browser prompt (9h + 10m + 20s without a response). */
const AUTO_ENFORCE_MS = NINE_HOURS_MS + OVERTIME_PROMPT_MS + OVERTIME_FINAL_COUNTDOWN_MS;
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

async function isExternalAuthUser(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('extern')
    .eq('auth_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[NineHourAutoClockOut] extern lookup failed:', error.message);
    return false;
  }

  return parseExternFlag(data?.extern);
}

async function hasOvertimeOptIn(employeeId, workDate) {
  const { data, error } = await supabase
    .from('employee_clock_in_overtime_opt_in')
    .select('employee_id')
    .eq('employee_id', employeeId)
    .eq('work_date', workDate)
    .maybeSingle();

  if (error) {
    console.error('[NineHourAutoClockOut] overtime opt-in lookup failed:', error.message);
    return false;
  }

  return data != null;
}

async function fetchTodayClockedMs(employeeId, now = Date.now()) {
  const dateKey = jerusalemDateKey(new Date(now));
  const todayStart = buildJerusalemStartOfDayIso(dateKey);
  const todayEnd = buildJerusalemEndOfDayIso(dateKey);

  const { data, error } = await supabase
    .from('employee_clock_in')
    .select('clock_in_time, clock_out_time')
    .eq('employee_id', employeeId)
    .gte('clock_in_time', todayStart)
    .lte('clock_in_time', todayEnd);

  if (error) throw error;

  let totalMs = 0;
  for (const record of data ?? []) {
    const start = new Date(record.clock_in_time).getTime();
    const end = record.clock_out_time
      ? new Date(record.clock_out_time).getTime()
      : now;
    totalMs += Math.max(0, end - start);
  }
  return totalMs;
}

async function clockOutActiveRecord(record, notes = 'Auto clock-out: 9-hour limit') {
  const clockOutTime = new Date().toISOString();
  const baseUpdate = {
    clock_out_time: clockOutTime,
    is_active: false,
    notes,
  };

  if (record.clock_in_location_id) {
    const withLocation = {
      ...baseUpdate,
      clock_out_location_id: record.clock_in_location_id,
    };
    const { error } = await supabase
      .from('employee_clock_in')
      .update(withLocation)
      .eq('id', record.id);
    if (!error) return;
  }

  const { error: fallbackError } = await supabase
    .from('employee_clock_in')
    .update(baseUpdate)
    .eq('id', record.id);

  if (fallbackError) throw fallbackError;
}

async function fetchLastPresenceAt(employeeId) {
  const { data, error } = await supabase
    .from('employee_clock_in_presence')
    .select('last_seen_at')
    .eq('employee_id', employeeId)
    .maybeSingle();

  if (error) {
    console.error('[NineHourAutoClockOut] presence lookup failed:', error.message);
    return null;
  }

  if (!data?.last_seen_at) return null;
  return new Date(data.last_seen_at).getTime();
}

function hasRecentPresence(lastSeenAt, now = Date.now()) {
  if (lastSeenAt == null) return false;
  return now - lastSeenAt < PRESENCE_STALE_MS;
}

/**
 * Server enforcement rules:
 * - Below 9h: never
 * - At/above full client deadline (9h + 10m + 20s): always (safety backup)
 * - Between 9h and deadline with recent browser heartbeat: skip (client shows friendly UI)
 * - At/above 9h without recent heartbeat: enforce (user left without clocking out)
 */
function isPastJerusalemWorkdayEnd(now = new Date()) {
  const { hour } = jerusalemTimeParts(now);
  return hour >= WORKDAY_END_HOUR_JERUSALEM;
}

function shouldServerEnforce(totalMs, lastSeenAt, now = Date.now()) {
  if (totalMs < NINE_HOURS_MS) return false;
  if (totalMs >= AUTO_ENFORCE_MS) return true;
  return !hasRecentPresence(lastSeenAt, now);
}

function shouldSendNineHourWhatsApp(totalMs, overtimeOptIn, now = new Date()) {
  if (isPastJerusalemWorkdayEnd(now)) return false;
  if (overtimeOptIn) return false;
  return totalMs >= NINE_HOURS_MS;
}

function shouldEnforceNineHourLimit(totalMs, lastSeenAt, hasOvertimeOptInFlag, now = Date.now()) {
  if (hasOvertimeOptInFlag) return false;
  return shouldServerEnforce(totalMs, lastSeenAt, now);
}

async function hasWorkdayEndOptIn(employeeId, workDate) {
  const { data, error } = await supabase
    .from('employee_clock_in_workday_end_opt_in')
    .select('employee_id')
    .eq('employee_id', employeeId)
    .eq('work_date', workDate)
    .maybeSingle();

  if (error) {
    console.error('[NineHourAutoClockOut] workday-end opt-in lookup failed:', error.message);
    return false;
  }

  return data != null;
}

function isPastWorkdayEndClientDeadline(now = new Date()) {
  const { hour, minute, second } = jerusalemTimeParts(now);
  if (hour > WORKDAY_END_HOUR_JERUSALEM) return true;
  if (hour < WORKDAY_END_HOUR_JERUSALEM) return false;
  if (minute > 2) return true;
  if (minute < 2) return false;
  return second >= 20;
}

function shouldEnforceWorkdayEnd(lastSeenAt, hasWorkdayEndOptIn, now = Date.now()) {
  if (!isPastJerusalemWorkdayEnd(new Date(now))) return false;
  if (hasWorkdayEndOptIn) return false;
  if (isPastWorkdayEndClientDeadline(new Date(now))) return true;
  return !hasRecentPresence(lastSeenAt, now);
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
    endOfDayClockOuts: 0,
    whatsappSent: 0,
    whatsappSkipped: 0,
    skipped: 0,
    errors: [],
  };

  const pastWorkdayEnd = isPastJerusalemWorkdayEnd();

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

      const lastPresenceAt = await fetchLastPresenceAt(record.employee_id);

      if (pastWorkdayEnd) {
        const workdayEndOptIn = await hasWorkdayEndOptIn(record.employee_id, workDate);
        if (!shouldEnforceWorkdayEnd(lastPresenceAt, workdayEndOptIn)) {
          summary.skipped += 1;
          continue;
        }

        await clockOutActiveRecord(
          record,
          `Auto clock-out: end of workday (${WORKDAY_END_HOUR_JERUSALEM}:00 Asia/Jerusalem)`,
        );
        summary.clockedOut += 1;
        summary.endOfDayClockOuts += 1;

        // Keep auth session — client gate blocks CRM until next clock-in.
        console.log(
          `[NineHourAutoClockOut] employee=${record.employee_id} end-of-day clock out (session kept)`,
        );
        continue;
      }

      const overtimeOptIn = await hasOvertimeOptIn(record.employee_id, workDate);
      const totalMs = await fetchTodayClockedMs(record.employee_id);

      if (shouldSendNineHourWhatsApp(totalMs, overtimeOptIn)) {
        const whatsappResult = await nineHourOvertimeWhatsAppService.sendNineHourOvertimeWhatsAppIfNeeded(
          record.employee_id,
          workDate,
        );
        if (whatsappResult.sent) {
          summary.whatsappSent += 1;
        } else if (whatsappResult.error) {
          summary.errors.push({
            employeeId: record.employee_id,
            message: `Nine-hour WhatsApp: ${whatsappResult.error}`,
          });
        } else {
          summary.whatsappSkipped += 1;
        }
      }

      if (!shouldEnforceNineHourLimit(totalMs, lastPresenceAt, overtimeOptIn)) {
        summary.skipped += 1;
        continue;
      }

      await clockOutActiveRecord(record);
      summary.clockedOut += 1;

      // Keep auth session — client gate blocks CRM until next clock-in.
      console.log(
        `[NineHourAutoClockOut] employee=${record.employee_id} totalMs=${totalMs} clocked out (session kept)`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ employeeId: record.employee_id, message });
      console.error(
        `[NineHourAutoClockOut] failed for employee=${record.employee_id}:`,
        message,
      );
    }
  }

  return summary;
}

module.exports = {
  runNineHourAutoClockOut,
  AUTO_ENFORCE_MS,
  NINE_HOURS_MS,
  PRESENCE_STALE_MS,
  WORKDAY_END_HOUR_JERUSALEM,
  _internal: {
    jerusalemDateKey,
    fetchTodayClockedMs,
    shouldServerEnforce,
    shouldEnforceNineHourLimit,
    shouldSendNineHourWhatsApp,
    shouldEnforceWorkdayEnd,
    hasRecentPresence,
    isPastJerusalemWorkdayEnd,
    isPastWorkdayEndClientDeadline,
  },
};
