const supabase = require('../config/supabase');
const nineHourOvertimeWhatsAppService = require('./nineHourOvertimeWhatsAppService');

const JERUSALEM_TZ = 'Asia/Jerusalem';
const NINE_HOURS_MS = 9 * 60 * 60 * 1000;
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
 * End-of-day auto clock-out stores remaining base hours (min_hours minus
 * already-closed sessions today), not the wall-clock span until 23:00.
 * Never writes a time after `now` or before clock-in.
 */
function computeBaseHoursClockOutIso(clockInIso, minHours, closedMs = 0, nowMs = Date.now()) {
  const startMs = new Date(clockInIso).getTime();
  if (!Number.isFinite(startMs)) return new Date(nowMs).toISOString();
  const remainingMs = Math.max(0, normalizeMinHours(minHours) * 60 * 60 * 1000 - closedMs);
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

async function fetchEmployeeMinHours(employeeId) {
  const { data, error } = await supabase
    .from('tenants_employee')
    .select('min_hours')
    .eq('id', employeeId)
    .maybeSingle();

  if (error) {
    console.error('[NineHourAutoClockOut] min_hours lookup failed:', error.message);
    return DEFAULT_MIN_HOURS;
  }

  return normalizeMinHours(data?.min_hours);
}

async function fetchTodayClosedDurationMs(employeeId, excludeRecordId, now = Date.now()) {
  const dateKey = jerusalemDateKey(new Date(now));
  const todayStart = buildJerusalemStartOfDayIso(dateKey);
  const todayEnd = buildJerusalemEndOfDayIso(dateKey);

  const { data, error } = await supabase
    .from('employee_clock_in')
    .select('id, clock_in_time, clock_out_time')
    .eq('employee_id', employeeId)
    .gte('clock_in_time', todayStart)
    .lte('clock_in_time', todayEnd);

  if (error) throw error;

  let totalMs = 0;
  for (const record of data ?? []) {
    if (record.id === excludeRecordId || !record.clock_out_time) continue;
    const start = new Date(record.clock_in_time).getTime();
    const end = new Date(record.clock_out_time).getTime();
    totalMs += Math.max(0, end - start);
  }
  return totalMs;
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

async function clockOutActiveRecord(record, notes, clockOutTime = new Date().toISOString()) {
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

function isPastJerusalemWorkdayEnd(now = new Date()) {
  const { hour } = jerusalemTimeParts(now);
  return hour >= WORKDAY_END_HOUR_JERUSALEM;
}

function shouldSendNineHourWhatsApp(totalMs, overtimeOptIn, now = new Date()) {
  if (isPastJerusalemWorkdayEnd(now)) return false;
  if (overtimeOptIn) return false;
  return totalMs >= NINE_HOURS_MS;
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
        const closedMs = await fetchTodayClosedDurationMs(record.employee_id, record.id, nowMs);
        const clockOutTime = computeBaseHoursClockOutIso(
          record.clock_in_time,
          minHours,
          closedMs,
          nowMs,
        );
        await clockOutActiveRecord(
          record,
          `Auto clock-out: end of workday (${WORKDAY_END_HOUR_JERUSALEM}:00 Asia/Jerusalem); duration set to base hours (${minHours}h)`,
          clockOutTime,
        );
        summary.clockedOut += 1;
        summary.endOfDayClockOuts += 1;

        console.log(
          `[NineHourAutoClockOut] employee=${record.employee_id} end-of-day clock out at ${clockOutTime} (base hours ${minHours}h, session kept)`,
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

      // 9h is a CRM reminder only — never auto clock-out. 23:00 sets base hours.
      summary.skipped += 1;
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
  NINE_HOURS_MS,
  PRESENCE_STALE_MS,
  WORKDAY_END_HOUR_JERUSALEM,
  DEFAULT_MIN_HOURS,
  _internal: {
    jerusalemDateKey,
    fetchTodayClockedMs,
    shouldSendNineHourWhatsApp,
    isPastJerusalemWorkdayEnd,
    fetchTodayClosedDurationMs,
    computeBaseHoursClockOutIso,
    normalizeMinHours,
  },
};
