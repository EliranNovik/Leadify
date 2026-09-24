import { supabase } from './supabase';
import { normalizeEmployeeMinHours } from './employeeLeadReporting';
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

export function clockSessionExceedsMinHours(
  clockInTime: string,
  clockOutTime: string,
  minHours: number,
): boolean {
  const minutes = clockSessionDurationMinutes(clockInTime, clockOutTime);
  const capMinutes = Math.round(normalizeEmployeeMinHours(minHours) * 60);
  return minutes > capMinutes;
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
  minHours: number;
  clockInTime: string;
  clockOutTime: string;
  dateKeys?: string[];
  notes?: string | null;
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
    `Hi Michael, I need overtime approval to clock in more than my ${params.minHours}h base hours. Planned session: ${session}.`;
  const extraNotes = params.notes?.trim();
  if (!extraNotes) return initial;
  return `${initial}\n\nAdditional notes:\n${extraNotes}`;
}

/** Read-only. Never writes `min_hours` or rewrites stored clock-in/out times. */
export async function fetchEmployeeMinHours(employeeId: number): Promise<number> {
  const { data } = await supabase
    .from('tenants_employee')
    .select('min_hours')
    .eq('id', employeeId)
    .maybeSingle();

  return normalizeEmployeeMinHours(data?.min_hours);
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

export function overtimeApprovalRequiredError(minHours: number): Error {
  return new Error(
    `Clock-in/out is longer than your ${minHours}h base hours. Get WhatsApp approval from Michael Decker and upload the screenshot before saving.`,
  );
}

export async function assertManualDurationAllowed(params: {
  employeeId: number;
  clockInTime: string;
  clockOutTime: string;
  overtimeApprovalStoragePath?: string | null;
}): Promise<void> {
  const minHours = await fetchEmployeeMinHours(params.employeeId);
  if (!clockSessionExceedsMinHours(params.clockInTime, params.clockOutTime, minHours)) {
    return;
  }
  if (params.overtimeApprovalStoragePath?.trim()) return;
  throw overtimeApprovalRequiredError(minHours);
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
