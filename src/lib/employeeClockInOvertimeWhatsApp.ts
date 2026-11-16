import { supabase } from './supabase';
import { buildBackendApiUrl } from './backendApiBase';
import {
  formatDurationMinutesLabel,
  formatOvertimeSessionDateLabel,
  segmentsTotalMinutes,
  type ClockInOutSegment,
} from './employeeClockInOvertimeApproval';

/** Fired when Michael approves or declines, so open working-hours views can reload. */
export const CLOCK_IN_OVERTIME_RESOLVED_EVENT = 'clock-in-overtime-resolved';

export type OvertimeApprovalRequestStatus = 'pending' | 'approved' | 'declined';

export type OvertimeApprovalRequestRow = {
  id: number;
  status: OvertimeApprovalRequestStatus;
  created_at: string;
  resolved_at: string | null;
};

/** Placeholder {{5}}. One label per day, for example "Monday 16 November 2026". */
export function formatOvertimeDatePlaceholder(dateKeys: string[]): string {
  return [...new Set(dateKeys.filter(Boolean))]
    .sort()
    .map(formatOvertimeSessionDateLabel)
    .join(', ');
}

/** Minutes past the employee's standard day. */
export function overtimeMinutesBeyondBase(totalMinutes: number, baseHours: number): number {
  return Math.max(0, Math.round(totalMinutes) - Math.round(baseHours * 60));
}

/**
 * Placeholder {{3}}. The date is included so Michael can tell one day's message from the next.
 */
export function formatOvertimeHoursPlaceholder(params: {
  minutes: number;
  dateKey?: string;
  from?: string;
  to?: string;
}): string {
  const duration = formatDurationMinutesLabel(Math.max(0, params.minutes));
  const range = params.from && params.to ? `${params.from}–${params.to}` : '';
  const when = params.dateKey ? formatOvertimeSessionDateLabel(params.dateKey) : '';
  const head = range ? `${duration} (${range})` : duration;
  return when ? `${head} on ${when}` : head;
}

/**
 * Short schedule plus the employee's reason. Kept for screens that still build a preview.
 * The WhatsApp description placeholder is the reason alone.
 */
export function buildOvertimeApprovalDescription(params: {
  dateKeys: string[];
  segments: ClockInOutSegment[];
  existingMinutes?: number;
  reason: string;
}): string {
  const segments = params.segments.filter((seg) => seg.clockInTime && seg.clockOutTime);
  const periods = segments
    .map((seg) => `${seg.clockInTime}–${seg.clockOutTime}`)
    .join(', ');
  const dates = [...new Set(params.dateKeys.filter(Boolean))]
    .sort()
    .map(formatOvertimeSessionDateLabel)
    .join(', ');
  const total = formatDurationMinutesLabel(
    Math.max(0, params.existingMinutes || 0) + segmentsTotalMinutes(segments),
  );
  const schedule = [dates, periods].filter(Boolean).join(' ');
  const reason = params.reason.replace(/\s+/g, ' ').trim();
  const head = schedule ? `${schedule} (${total}).` : `${total}.`;
  return `${head} ${reason}`.trim();
}

export async function requestMichaelOvertimeApproval(params: {
  employeeId: number;
  reason: string;
  hours: string;
  workplace: string;
  date: string;
  clockInIds: number[];
}): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) {
    throw new Error('Sign in again before sending the overtime request');
  }

  const response = await fetch(buildBackendApiUrl('/api/clock-in/overtime-approval/request'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      employeeId: params.employeeId,
      reason: params.reason.trim(),
      hours: params.hours.trim(),
      workplace: params.workplace.trim(),
      date: params.date.trim(),
      clockInIds: params.clockInIds,
    }),
  });

  const body = await response.json().catch(() => ({} as { error?: string }));
  if (!response.ok) {
    throw new Error(body?.error || 'Could not send the WhatsApp message to Michael');
  }
}

/** Latest Yes/No request that includes this clock-in, if the signed-in employee can read it. */
export async function fetchLatestOvertimeRequestStatus(
  clockInId: number,
): Promise<OvertimeApprovalRequestStatus | null> {
  if (!Number.isFinite(clockInId) || clockInId <= 0) return null;
  const { data, error } = await supabase
    .from('employee_clock_in_overtime_requests')
    .select('status')
    .contains('clock_in_ids', [clockInId])
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !data?.[0]) return null;
  const status = data[0].status;
  if (status === 'pending' || status === 'approved' || status === 'declined') return status;
  return null;
}

/** Clock-in rows that are still waiting, so an already-approved day is not sent again. */
export async function filterPendingClockInIds(ids: number[]): Promise<number[]> {
  const unique = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (unique.length === 0) return [];

  const { data, error } = await supabase
    .from('employee_clock_in')
    .select('id, approved, declined')
    .in('id', unique);

  if (error) throw error;

  return (data || [])
    .filter((row) => row.approved !== true && row.declined !== true)
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id));
}

let warnedOvertimeRequestRead = false;

export async function fetchRecentOvertimeApprovalRequests(
  employeeId: number,
): Promise<OvertimeApprovalRequestRow[]> {
  const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('employee_clock_in_overtime_requests')
    .select('id, status, created_at, resolved_at')
    .eq('employee_id', employeeId)
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  if (error) {
    if (!warnedOvertimeRequestRead) {
      warnedOvertimeRequestRead = true;
      console.warn('Overtime approval requests:', error.message);
    }
    return [];
  }

  return (data || []).flatMap((row) => {
    const id = Number(row.id);
    const status = row.status;
    if (!Number.isFinite(id)) return [];
    if (status !== 'pending' && status !== 'approved' && status !== 'declined') return [];
    return [{
      id,
      status,
      created_at: row.created_at,
      resolved_at: row.resolved_at ?? null,
    }];
  });
}
