import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const LOG_PREFIX = '[nine-hour-auto-clock-out]';
const JERUSALEM_TZ = 'Asia/Jerusalem';
const DEFAULT_MIN_HOURS = 8;
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

function normalizeMinHours(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MIN_HOURS;
  return parsed;
}

function computeBaseHoursClockOutIso(
  clockInIso: string,
  minHours: number,
  closedMs = 0,
  nowMs = Date.now(),
) {
  const startMs = new Date(clockInIso).getTime();
  if (!Number.isFinite(startMs)) return new Date(nowMs).toISOString();
  const remainingMs = Math.max(0, normalizeMinHours(minHours) * 60 * 60 * 1000 - closedMs);
  const targetMs = startMs + remainingMs;
  const endMs = Math.min(Math.max(targetMs, startMs), nowMs);
  return new Date(endMs).toISOString();
}

function isPastJerusalemWorkdayEnd(now = new Date()) {
  const { hour } = jerusalemTimeParts(now);
  return hour >= WORKDAY_END_HOUR_JERUSALEM;
}

type ActiveRecord = {
  id: number;
  employee_id: number;
  user_id: string;
  clock_in_time: string;
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
      .select('id, employee_id, user_id, clock_in_time, clock_in_location_id')
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

        if (!pastWorkdayEnd) {
          // 9h is a CRM reminder only — never auto clock-out before 23:00.
          summary.skipped += 1;
          continue;
        }

        const { data: employeeRow } = await admin
          .from('tenants_employee')
          .select('min_hours')
          .eq('id', record.employee_id)
          .maybeSingle();
        const minHours = normalizeMinHours(employeeRow?.min_hours);

        const workDate = jerusalemDateKey(new Date(now));
        const todayStart = buildJerusalemStartOfDayIso(workDate);
        const todayEnd = buildJerusalemEndOfDayIso(workDate);
        const { data: dayRecords, error: dayError } = await admin
          .from('employee_clock_in')
          .select('id, clock_in_time, clock_out_time')
          .eq('employee_id', record.employee_id)
          .gte('clock_in_time', todayStart)
          .lte('clock_in_time', todayEnd);
        if (dayError) throw dayError;

        let closedMs = 0;
        for (const row of dayRecords ?? []) {
          if (row.id === record.id || !row.clock_out_time) continue;
          const start = new Date(row.clock_in_time).getTime();
          const end = new Date(row.clock_out_time).getTime();
          closedMs += Math.max(0, end - start);
        }

        const clockOutTime = computeBaseHoursClockOutIso(
          record.clock_in_time,
          minHours,
          closedMs,
          now,
        );
        const endOfDayUpdate = {
          clock_out_time: clockOutTime,
          is_active: false,
          notes: `Auto clock-out: end of workday (${WORKDAY_END_HOUR_JERUSALEM}:00 Asia/Jerusalem); duration set to base hours (${minHours}h)`,
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

        console.log(
          LOG_PREFIX,
          `employee=${record.employee_id} end-of-day clocked out at ${clockOutTime} (base hours ${minHours}h, session kept)`,
        );
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
