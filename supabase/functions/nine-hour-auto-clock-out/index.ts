import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const LOG_PREFIX = '[nine-hour-auto-clock-out]';
const JERUSALEM_TZ = 'Asia/Jerusalem';
const NINE_HOURS_MS = 9 * 60 * 60 * 1000;
const OVERTIME_PROMPT_MS = 10 * 60 * 1000;
const OVERTIME_FINAL_COUNTDOWN_MS = 20 * 1000;
const AUTO_ENFORCE_MS = NINE_HOURS_MS + OVERTIME_PROMPT_MS + OVERTIME_FINAL_COUNTDOWN_MS;
const PRESENCE_STALE_MS = Number(Deno.env.get('CLOCK_IN_PRESENCE_STALE_MS') || 90_000);
const WORKDAY_END_HOUR_JERUSALEM = Number(Deno.env.get('CLOCK_IN_WORKDAY_END_HOUR_JERUSALEM') || 23);

function jerusalemDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: JERUSALEM_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
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

function buildJerusalemStartOfDayIso(dateStr: string) {
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

function buildJerusalemEndOfDayIso(dateStr: string) {
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

function parseExternFlag(extern: unknown) {
  return (
    extern === true
    || extern === 'true'
    || extern === 1
    || extern === '1'
    || (typeof extern === 'string' && extern.toLowerCase() === 'true')
  );
}

function hasRecentPresence(lastSeenAt: number | null, now = Date.now()) {
  if (lastSeenAt == null) return false;
  return now - lastSeenAt < PRESENCE_STALE_MS;
}

function shouldServerEnforce(totalMs: number, lastSeenAt: number | null, now = Date.now()) {
  if (totalMs < NINE_HOURS_MS) return false;
  if (totalMs >= AUTO_ENFORCE_MS) return true;
  return !hasRecentPresence(lastSeenAt, now);
}

function isPastJerusalemWorkdayEnd(now = new Date()) {
  const { hour } = jerusalemTimeParts(now);
  return hour >= WORKDAY_END_HOUR_JERUSALEM;
}

function shouldEnforceNineHourLimit(
  totalMs: number,
  lastSeenAt: number | null,
  hasOvertimeOptIn: boolean,
  now = Date.now(),
) {
  if (hasOvertimeOptIn) return false;
  return shouldServerEnforce(totalMs, lastSeenAt, now);
}

function isPastWorkdayEndClientDeadline(now = new Date()) {
  const { hour, minute, second } = jerusalemTimeParts(now);
  if (hour > WORKDAY_END_HOUR_JERUSALEM) return true;
  if (hour < WORKDAY_END_HOUR_JERUSALEM) return false;
  if (minute > 2) return true;
  if (minute < 2) return false;
  return second >= 20;
}

function shouldEnforceWorkdayEnd(
  lastSeenAt: number | null,
  hasWorkdayEndOptIn: boolean,
  now = Date.now(),
) {
  if (!isPastJerusalemWorkdayEnd(new Date(now))) return false;
  if (hasWorkdayEndOptIn) return false;
  if (isPastWorkdayEndClientDeadline(new Date(now))) return true;
  return !hasRecentPresence(lastSeenAt, now);
}

type ActiveRecord = {
  id: number;
  employee_id: number;
  user_id: string;
  clock_in_location_id: number | null;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const cronSecret = Deno.env.get('NINE_HOUR_AUTO_CLOCKOUT_CRON_SECRET');
  const cronHeader = req.headers.get('x-cron-secret');
  if (!cronSecret || cronHeader !== cronSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const workDate = jerusalemDateKey();
  const now = Date.now();
  const summary = {
    checked: 0,
    clockedOut: 0,
    endOfDayClockOuts: 0,
    skipped: 0,
    errors: [] as { employeeId: number; message: string }[],
  };
  const pastWorkdayEnd = isPastJerusalemWorkdayEnd(new Date(now));

  try {
    const { data: activeRecords, error } = await admin
      .from('employee_clock_in')
      .select('id, employee_id, user_id, clock_in_location_id')
      .eq('is_active', true);

    if (error) throw error;

    for (const record of (activeRecords ?? []) as ActiveRecord[]) {
      summary.checked += 1;
      try {
        const { data: userRow } = await admin
          .from('users')
          .select('extern')
          .eq('auth_id', record.user_id)
          .maybeSingle();
        if (parseExternFlag(userRow?.extern)) {
          summary.skipped += 1;
          continue;
        }

        if (pastWorkdayEnd) {
          const { data: workdayEndOptIn } = await admin
            .from('employee_clock_in_workday_end_opt_in')
            .select('employee_id')
            .eq('employee_id', record.employee_id)
            .eq('work_date', workDate)
            .maybeSingle();

          const { data: presenceRow } = await admin
            .from('employee_clock_in_presence')
            .select('last_seen_at')
            .eq('employee_id', record.employee_id)
            .maybeSingle();
          const lastPresenceAt = presenceRow?.last_seen_at
            ? new Date(presenceRow.last_seen_at).getTime()
            : null;

          if (!shouldEnforceWorkdayEnd(lastPresenceAt, workdayEndOptIn != null, now)) {
            summary.skipped += 1;
            continue;
          }

          const clockOutTime = new Date().toISOString();
          const endOfDayUpdate = {
            clock_out_time: clockOutTime,
            is_active: false,
            notes: `Auto clock-out: end of workday (${WORKDAY_END_HOUR_JERUSALEM}:00 Asia/Jerusalem)`,
          };

          if (record.clock_in_location_id) {
            const { error: updateError } = await admin
              .from('employee_clock_in')
              .update({ ...endOfDayUpdate, clock_out_location_id: record.clock_in_location_id })
              .eq('id', record.id);
            if (updateError) {
              const { error: fallbackError } = await admin
                .from('employee_clock_in')
                .update(endOfDayUpdate)
                .eq('id', record.id);
              if (fallbackError) throw fallbackError;
            }
          } else {
            const { error: updateError } = await admin
              .from('employee_clock_in')
              .update(endOfDayUpdate)
              .eq('id', record.id);
            if (updateError) throw updateError;
          }

          summary.clockedOut += 1;
          summary.endOfDayClockOuts += 1;

          // Keep auth session — gate blocks CRM until next clock-in.
          console.log(LOG_PREFIX, `employee=${record.employee_id} end-of-day clocked out (session kept)`);
          continue;
        }

        const { data: optIn } = await admin
          .from('employee_clock_in_overtime_opt_in')
          .select('employee_id')
          .eq('employee_id', record.employee_id)
          .eq('work_date', workDate)
          .maybeSingle();
        const overtimeOptIn = optIn != null;

        const todayStart = buildJerusalemStartOfDayIso(workDate);
        const todayEnd = buildJerusalemEndOfDayIso(workDate);
        const { data: dayRecords, error: dayError } = await admin
          .from('employee_clock_in')
          .select('clock_in_time, clock_out_time')
          .eq('employee_id', record.employee_id)
          .gte('clock_in_time', todayStart)
          .lte('clock_in_time', todayEnd);
        if (dayError) throw dayError;

        let totalMs = 0;
        for (const row of dayRecords ?? []) {
          const start = new Date(row.clock_in_time).getTime();
          const end = row.clock_out_time ? new Date(row.clock_out_time).getTime() : now;
          totalMs += Math.max(0, end - start);
        }

        const { data: presenceRow } = await admin
          .from('employee_clock_in_presence')
          .select('last_seen_at')
          .eq('employee_id', record.employee_id)
          .maybeSingle();
        const lastPresenceAt = presenceRow?.last_seen_at
          ? new Date(presenceRow.last_seen_at).getTime()
          : null;

        if (!shouldEnforceNineHourLimit(totalMs, lastPresenceAt, overtimeOptIn, now)) {
          summary.skipped += 1;
          continue;
        }

        const clockOutTime = new Date().toISOString();
        const baseUpdate = {
          clock_out_time: clockOutTime,
          is_active: false,
          notes: 'Auto clock-out: 9-hour limit',
        };

        if (record.clock_in_location_id) {
          const { error: updateError } = await admin
            .from('employee_clock_in')
            .update({ ...baseUpdate, clock_out_location_id: record.clock_in_location_id })
            .eq('id', record.id);
          if (updateError) {
            const { error: fallbackError } = await admin
              .from('employee_clock_in')
              .update(baseUpdate)
              .eq('id', record.id);
            if (fallbackError) throw fallbackError;
          }
        } else {
          const { error: updateError } = await admin
            .from('employee_clock_in')
            .update(baseUpdate)
            .eq('id', record.id);
          if (updateError) throw updateError;
        }

        summary.clockedOut += 1;

        // Keep auth session — gate blocks CRM until next clock-in.
        console.log(LOG_PREFIX, `employee=${record.employee_id} clocked out (session kept)`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        summary.errors.push({ employeeId: record.employee_id, message });
        console.error(LOG_PREFIX, `employee=${record.employee_id}`, message);
      }
    }

    return new Response(JSON.stringify({ success: true, ...summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(LOG_PREFIX, message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
