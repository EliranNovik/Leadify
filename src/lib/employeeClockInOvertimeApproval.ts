import { supabase } from './supabase';
import { dateRangeToIsoBounds } from './employeeClockInFormat';
import {
  DEFAULT_MIN_HOURS,
  fetchEmployeeMinHours,
  normalizeMinHours,
} from './employeeClockInOvertime';
import {
  CLOCK_IN_HELP_CONTACT_EMPLOYEE_IDS,
  buildHelpContactWhatsAppUrl,
  resolveHelpContactMobile,
  type ClockInHelpContact,
} from './clockInHelpContacts';

export const CLOCK_IN_OVERTIME_APPROVAL_BUCKET = 'employee-clock-in-overtime-approvals';
export const CLOCK_IN_OVERTIME_DOC_MAX_BYTES = 10 * 1024 * 1024;
export const CLOCK_IN_OVERTIME_DOC_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
] as const;

export type ClockInOvertimeApprovalFileMeta = {
  storagePath: string;
  fileName: string;
  mimeType: string;
};

function parseHhMm(value: string): { hours: number; minutes: number } | null {
  const [h, m] = String(value || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return { hours: h, minutes: m };
}

/** Duration of a same-day clock-in/out period, in minutes. Negative if out is before in. */
export function clockSessionDurationMinutes(clockInTime: string, clockOutTime: string): number {
  const start = parseHhMm(clockInTime);
  const end = parseHhMm(clockOutTime);
  if (!start || !end) return 0;
  return end.hours * 60 + end.minutes - (start.hours * 60 + start.minutes);
}

/**
 * Hours a session may run before it needs an overtime approval: the employee's own contracted
 * `min_hours`, read from `tenants_employee`.
 *
 * Was a flat nine hours for everyone, which let the 176 employees on an eight-hour contract log an
 * extra hour as if it were a normal day. Anything past their base hours is overtime and needs
 * Michael's sign-off.
 *
 * This brings approval in line with how the hours are already *paid*: `employeeExtraHours.ts` has
 * always measured overtime from `min_hours` too, so a 9h approval limit meant an eight-hour employee
 * could bank an hour of 125% overtime without anyone signing off on it.
 */
export async function fetchOvertimeApprovalBaseHours(employeeId: number): Promise<number> {
  return fetchEmployeeMinHours(employeeId);
}

/** Fallback base hours for a UI that has not loaded the employee's contract yet. */
export const DEFAULT_OVERTIME_APPROVAL_BASE_HOURS = DEFAULT_MIN_HOURS;

export function clockSessionExceedsOvertimeBase(
  clockInTime: string,
  clockOutTime: string,
  baseHours: number,
): boolean {
  const minutes = clockSessionDurationMinutes(clockInTime, clockOutTime);
  return minutes > normalizeMinHours(baseHours) * 60;
}

export function formatClockSessionDurationLabel(clockInTime: string, clockOutTime: string): string {
  const minutes = Math.max(0, clockSessionDurationMinutes(clockInTime, clockOutTime));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours <= 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function formatOvertimeSessionDateLabel(dateKey: string): string {
  const [y, m, d] = String(dateKey || '').split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return dateKey;
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function buildOvertimeApprovalWhatsAppMessage(params: {
  clockInTime: string;
  clockOutTime: string;
  dateKeys?: string[];
  notes?: string | null;
  /** The employee's own base hours, which is what the request is asking to go beyond. */
  baseHours: number;
}): string {
  const durationLabel = formatClockSessionDurationLabel(params.clockInTime, params.clockOutTime);
  const dateLabels = [...new Set((params.dateKeys || []).filter(Boolean))]
    .sort()
    .map(formatOvertimeSessionDateLabel);
  const datePart = dateLabels.join(', ');
  const session = datePart
    ? `${datePart}, ${params.clockInTime}–${params.clockOutTime} (${durationLabel})`
    : `${params.clockInTime}–${params.clockOutTime} (${durationLabel})`;
  const initial =
    `Hi Michael, I need overtime approval to clock in more than my ${normalizeMinHours(params.baseHours)}h standard day. Planned session: ${session}.`;
  const extraNotes = params.notes?.trim();
  if (!extraNotes) return initial;
  return `${initial}\n\nAdditional notes:\n${extraNotes}`;
}

export async function fetchMichaelDeckerWhatsAppUrl(
  message: string,
): Promise<string | null> {
  const topContactId = CLOCK_IN_HELP_CONTACT_EMPLOYEE_IDS[0];
  const { data } = await supabase
    .from('tenants_employee')
    .select('id, display_name, photo_url, photo, mobile, phone')
    .eq('id', topContactId)
    .maybeSingle();

  if (!data) return null;

  const contact: ClockInHelpContact = {
    id: Number(data.id),
    display_name: data.display_name?.trim() || `Employee #${topContactId}`,
    photo_url: data.photo_url ?? null,
    photo: data.photo ?? null,
    mobile: data.mobile ?? null,
    phone: data.phone ?? null,
    email: null,
  };
  const mobile = resolveHelpContactMobile(contact);
  if (!mobile) return null;
  const url = buildHelpContactWhatsAppUrl(mobile);
  if (!url) return null;
  return `${url}?text=${encodeURIComponent(message)}`;
}

export function overtimeApprovalRequiredError(baseHours: number): Error {
  return new Error(
    `Clock-in/out is longer than your ${normalizeMinHours(baseHours)}h standard day. Get WhatsApp approval from Michael Decker and upload the screenshot before saving.`,
  );
}

/**
 * The save-time guard.
 *
 * Reads the base hours here rather than trusting a caller-supplied number: this is the one check that
 * actually blocks a write, and a screen that forgot to pass the employee's contract would quietly let
 * overtime through unapproved.
 */
export async function assertManualDurationAllowed(params: {
  employeeId: number;
  clockInTime: string;
  clockOutTime: string;
  overtimeApprovalStoragePath?: string | null;
  /**
   * Let the session through without its screenshot, which only the daily lead allocation page asks
   * for: there the hours are a precondition of the allocation, and blocking the save leaves the
   * allocation unreported too. The session is still written as pending, so HR sees it as overtime
   * waiting on an approval rather than as an approved day.
   */
  approvalDeferred?: boolean;
}): Promise<void> {
  const baseHours = await fetchOvertimeApprovalBaseHours(params.employeeId);
  if (!clockSessionExceedsOvertimeBase(params.clockInTime, params.clockOutTime, baseHours)) return;
  if (params.overtimeApprovalStoragePath?.trim()) return;
  if (params.approvalDeferred) return;
  throw overtimeApprovalRequiredError(baseHours);
}

/** What one stored session of a day already holds towards its overtime approval. */
export type StoredOvertimeApproval = {
  sessionId: number;
  clockInTime: string;
  clockOutTime: string;
  locationId: number | null;
  storagePath: string | null;
  fileName: string | null;
  mimeType: string | null;
};

function isoToHhMm(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * The day's finished sessions together with the approval screenshot each one carries.
 *
 * A screen that is about to rewrite a day needs this to tell an approved overtime day from one
 * still waiting: the hours themselves say nothing about whether Michael signed them off.
 */
export async function fetchDayOvertimeApprovals(
  employeeId: number,
  dateKey: string,
): Promise<StoredOvertimeApproval[]> {
  const { start, end } = dateRangeToIsoBounds(dateKey, dateKey);
  const core = 'id, clock_in_time, clock_out_time, clock_in_location_id, declined';
  const read = (columns: string) =>
    supabase
      .from('employee_clock_in')
      .select(columns)
      .eq('employee_id', employeeId)
      .gte('clock_in_time', start)
      .lte('clock_in_time', end)
      .order('clock_in_time', { ascending: true });

  let result = await read(
    `${core}, overtime_approval_storage_path, overtime_approval_file_name, overtime_approval_mime_type`,
  );
  // The approval columns arrived in a later migration; a store without them still has the hours.
  if (result.error && /overtime_approval/i.test(result.error.message || '')) {
    result = await read(core);
  }
  if (result.error) throw result.error;

  return ((result.data || []) as any[])
    .filter((row) => row?.declined !== true && row?.clock_out_time)
    .map((row) => ({
      sessionId: Number(row.id),
      clockInTime: isoToHhMm(row.clock_in_time),
      clockOutTime: isoToHhMm(row.clock_out_time),
      locationId: row.clock_in_location_id ?? null,
      storagePath: row.overtime_approval_storage_path ?? null,
      fileName: row.overtime_approval_file_name ?? null,
      mimeType: row.overtime_approval_mime_type ?? null,
    }));
}

/** Put the screenshot on a session that was saved without one. */
export async function attachOvertimeApprovalToSession(
  sessionId: number,
  meta: ClockInOvertimeApprovalFileMeta,
): Promise<void> {
  const { error } = await supabase
    .from('employee_clock_in')
    .update({
      overtime_approval_storage_path: meta.storagePath,
      overtime_approval_file_name: meta.fileName || null,
      overtime_approval_mime_type: meta.mimeType || null,
    })
    .eq('id', sessionId);

  if (error && String(error.message || '').includes('overtime_approval')) {
    throw new Error(
      'Overtime approval screenshot could not be saved. Run sql/2026-09-24_employee_clock_in_overtime_approval.sql and try again.',
    );
  }
  if (error) throw error;
}

export function isAllowedOvertimeApprovalFile(file: File): string | null {
  if (file.size > CLOCK_IN_OVERTIME_DOC_MAX_BYTES) {
    return 'File size must be less than 10MB';
  }
  const mime = (file.type || '').toLowerCase();
  const allowed = CLOCK_IN_OVERTIME_DOC_MIME_TYPES.includes(
    mime as (typeof CLOCK_IN_OVERTIME_DOC_MIME_TYPES)[number],
  );
  if (!allowed && !/\.(jpe?g|png|gif|webp|pdf)$/i.test(file.name)) {
    return 'Upload a screenshot or PDF of the WhatsApp approval';
  }
  return null;
}

export async function uploadClockInOvertimeApprovalDocument(
  employeeId: number,
  file: File,
): Promise<ClockInOvertimeApprovalFileMeta> {
  const typeError = isAllowedOvertimeApprovalFile(file);
  if (typeError) throw new Error(typeError);

  const ext = file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'jpg';
  const storagePath = `${employeeId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage
    .from(CLOCK_IN_OVERTIME_APPROVAL_BUCKET)
    .upload(storagePath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    });

  if (error) {
    throw new Error(error.message || 'Failed to upload approval screenshot');
  }

  return {
    storagePath,
    fileName: file.name,
    mimeType: file.type || 'image/jpeg',
  };
}

export async function createClockInOvertimeApprovalSignedUrl(
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const path = storagePath.trim();
  if (!path) throw new Error('Missing overtime approval document');
  const { data, error } = await supabase.storage
    .from(CLOCK_IN_OVERTIME_APPROVAL_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Failed to open overtime approval document');
  }
  return data.signedUrl;
}
