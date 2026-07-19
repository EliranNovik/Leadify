import { supabase } from './supabase';
import { assertDateEditableForEmployee } from './employeeWorkingHoursSubmissions';
import { monthRange } from './employeeClockInFormat';

export type UnavailabilityType = 'sick_days' | 'vacation' | 'general';

export type UnavailabilityApprovalStatus = 'approved' | 'pending' | 'declined';

export type UnavailabilityApprovalFields = {
  approved?: boolean | null;
  declined?: boolean | null;
  approved_by?: string | null;
  approved_at?: string | null;
  decline_note?: string | null;
  unavailability_type?: UnavailabilityType | string | null;
};

/**
 * "General" is a soft calendar note only: it can coexist with clock-ins on the same day,
 * never needs HR approval, and must not block working-hours submission or cover missing days.
 */
export function isGeneralUnavailability(
  entry: { unavailability_type?: string | null } | null | undefined,
): boolean {
  return entry?.unavailability_type === 'general';
}

export function unavailabilityRequiresApproval(
  entry: { unavailability_type?: string | null } | null | undefined,
): boolean {
  return Boolean(entry) && !isGeneralUnavailability(entry);
}

/** Pending leave insert defaults (employee self-service). */
export function pendingUnavailabilityApprovalFields(): {
  approved: false;
  declined: false;
  approved_by: null;
  approved_at: null;
  decline_note: null;
} {
  return {
    approved: false,
    declined: false,
    approved_by: null,
    approved_at: null,
    decline_note: null,
  };
}

/** Manager/HR creates leave already approved — also used for general notes. */
export function approvedUnavailabilityApprovalFields(approverAuthUserId?: string | null): {
  approved: true;
  declined: false;
  approved_by: string | null;
  approved_at: string;
  decline_note: null;
} {
  return {
    approved: true,
    declined: false,
    approved_by: approverAuthUserId ?? null,
    approved_at: new Date().toISOString(),
    decline_note: null,
  };
}

/** Approval columns to write on insert/update based on leave type. */
export function approvalFieldsForUnavailabilityType(
  type: UnavailabilityType | string,
  approverAuthUserId?: string | null,
):
  | ReturnType<typeof pendingUnavailabilityApprovalFields>
  | ReturnType<typeof approvedUnavailabilityApprovalFields> {
  if (type === 'general') {
    return approvedUnavailabilityApprovalFields(approverAuthUserId);
  }
  return pendingUnavailabilityApprovalFields();
}

export function normalizeUnavailabilityApprovalFields<T extends UnavailabilityApprovalFields>(
  entry: T,
): T & { approved: boolean; declined: boolean } {
  if (isGeneralUnavailability(entry)) {
    return {
      ...entry,
      approved: true,
      declined: false,
    };
  }
  return {
    ...entry,
    approved: entry.approved === true,
    declined: entry.declined === true,
  };
}

export function getUnavailabilityApprovalStatus(
  entry: UnavailabilityApprovalFields,
): UnavailabilityApprovalStatus {
  if (isGeneralUnavailability(entry)) return 'approved';
  if (entry.declined === true) return 'declined';
  if (entry.approved === true) return 'approved';
  return 'pending';
}

/** Sick/vacation that are approved cover a workday; general never does (clock-ins still expected). */
export function isUnavailabilityCounted(entry: UnavailabilityApprovalFields): boolean {
  if (isGeneralUnavailability(entry)) return false;
  return getUnavailabilityApprovalStatus(entry) === 'approved';
}

export function filterCountedUnavailability<T extends UnavailabilityApprovalFields>(
  entries: T[],
): T[] {
  return entries.filter(isUnavailabilityCounted);
}

export function countUnavailabilityApprovalBlockers(
  entries: UnavailabilityApprovalFields[],
): { pendingCount: number; declinedCount: number } {
  let pendingCount = 0;
  let declinedCount = 0;
  for (const entry of entries) {
    if (!unavailabilityRequiresApproval(entry)) continue;
    const status = getUnavailabilityApprovalStatus(entry);
    if (status === 'pending') pendingCount += 1;
    else if (status === 'declined') declinedCount += 1;
  }
  return { pendingCount, declinedCount };
}

export type EmployeeUnavailabilityEntry = {
  id: number;
  employee_id: number;
  unavailability_type: UnavailabilityType;
  sick_days_reason: string | null;
  vacation_reason: string | null;
  general_reason: string | null;
  document_url: string | null;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  created_at: string;
  approved?: boolean;
  declined?: boolean;
  approved_by?: string | null;
  approved_at?: string | null;
  decline_note?: string | null;
};

export const UNAVAILABILITY_SELECT = `
  id, employee_id, unavailability_type, sick_days_reason, vacation_reason,
  general_reason, document_url, start_date, end_date, start_time, end_time, created_at,
  approved, declined, approved_by, approved_at, decline_note
`;

/** Only count leave that overlaps the given calendar month (months stay independent). */
export function countUnavailabilityApprovalBlockersInMonth(
  entries: Array<UnavailabilityApprovalFields & { start_date: string; end_date: string | null }>,
  year: number,
  month1to12: number,
): { pendingCount: number; declinedCount: number } {
  const { from, to } = monthRange(year, month1to12);
  const inMonth = entries.filter((entry) => {
    const startKey = String(entry.start_date).slice(0, 10);
    const endKey = entry.end_date ? String(entry.end_date).slice(0, 10) : startKey;
    return startKey <= to && endKey >= from;
  });
  return countUnavailabilityApprovalBlockers(inMonth);
}

export function hasUnavailabilityApprovalBlockers(
  entries: UnavailabilityApprovalFields[],
): boolean {
  const { pendingCount, declinedCount } = countUnavailabilityApprovalBlockers(entries);
  return pendingCount > 0 || declinedCount > 0;
}

export function unavailabilityApprovalWatermarkLabel(
  status: UnavailabilityApprovalStatus,
): string | null {
  if (status === 'pending') return 'Waiting for approval';
  if (status === 'declined') return 'Declined';
  if (status === 'approved') return 'Approved';
  return null;
}

export function unavailabilityApprovalLabelClass(status: UnavailabilityApprovalStatus): string {
  if (status === 'pending') return 'text-sky-700';
  if (status === 'declined') return 'text-red-700';
  if (status === 'approved') return 'text-emerald-700';
  return '';
}

export function unavailabilityTypeLabel(type: UnavailabilityType | string): string {
  switch (type) {
    case 'sick_days':
      return 'Sick day/s';
    case 'vacation':
      return 'Vacation';
    case 'general':
      return 'General';
    default:
      return String(type);
  }
}

/** Short label for compact calendar day cells. */
export function unavailabilityTypeShortLabel(type: UnavailabilityType | string): string {
  switch (type) {
    case 'sick_days':
      return 'Sick';
    case 'vacation':
      return 'Vacation';
    case 'general':
      return 'General';
    default:
      return String(type);
  }
}

/** Tailwind classes for type badges (aligned with Dashboard sick/vacation/general colors). */
export function unavailabilityTypeBadgeClass(type: UnavailabilityType | string): string {
  switch (type) {
    case 'sick_days':
      return 'bg-orange-100 text-orange-700 border-0';
    case 'vacation':
      return 'bg-green-100 text-green-700 border-0';
    case 'general':
      return 'bg-slate-100 text-slate-700 border-0';
    default:
      return 'bg-gray-100 text-gray-700 border-0';
  }
}

/** Compact label styling for calendar day cells. */
export function unavailabilityTypeCompactLabelClass(type: UnavailabilityType | string): string {
  switch (type) {
    case 'sick_days':
      return 'bg-orange-100/90 text-orange-800';
    case 'vacation':
      return 'bg-green-100/90 text-green-800';
    case 'general':
      return 'bg-slate-100/90 text-slate-800';
    default:
      return 'bg-gray-100/90 text-gray-800';
  }
}

export function formatUnavailabilityTime(time: string | null | undefined): string {
  if (!time?.trim()) return '';
  const trimmed = time.trim();
  if (trimmed.length >= 8 && trimmed.includes(':')) {
    return trimmed.substring(0, 5);
  }
  return trimmed;
}

export function unavailabilityGeneralTimeRange(entry: EmployeeUnavailabilityEntry): string {
  const start = formatUnavailabilityTime(entry.start_time);
  const end = formatUnavailabilityTime(entry.end_time);
  if (start && end) return `${start} – ${end}`;
  if (start) return start;
  if (end) return end;
  return '';
}

export function unavailabilityReasonText(entry: EmployeeUnavailabilityEntry): string {
  if (entry.unavailability_type === 'sick_days') {
    return entry.sick_days_reason?.trim() || '—';
  }
  if (entry.unavailability_type === 'vacation') {
    return entry.vacation_reason?.trim() || '—';
  }
  const reason = entry.general_reason?.trim() || '';
  const timeRange = unavailabilityGeneralTimeRange(entry);
  if (reason && timeRange) return `${reason} (${timeRange})`;
  if (reason) return reason;
  if (timeRange) return timeRange;
  return '—';
}

function formatUnavailabilityDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function unavailabilityDateLabel(date: string): string {
  return formatUnavailabilityDate(date);
}

export function unavailabilityDateRangeLabel(
  startDate: string,
  endDate: string | null,
): string {
  const start = formatUnavailabilityDate(startDate);
  if (!endDate || endDate === startDate) return start;
  return `${start} – ${formatUnavailabilityDate(endDate)}`;
}

function getTodayIsoLocal(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Vacation badge / compact period text with Today / Today and tomorrow when applicable. */
export function vacationPeriodLabel(startDate: string, endDate: string | null): string {
  const end = endDate ?? startDate;
  const today = getTodayIsoLocal();
  const tomorrow = addDaysIso(today, 1);

  if (startDate === today && end === today) {
    return 'Today';
  }
  if (startDate === today && end === tomorrow) {
    return 'Today and tomorrow';
  }
  return unavailabilityDateRangeLabel(startDate, endDate);
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export type EmployeeUnavailabilityDayRow = EmployeeUnavailabilityEntry & {
  date: string;
};

export type UnavailabilityEditPayload = {
  unavailability_type: UnavailabilityType;
  reason: string;
  document_url: string | null;
  documentFile?: File | null;
};

function recordEndDate(entry: EmployeeUnavailabilityEntry): string {
  return entry.end_date || entry.start_date;
}

function buildReasonUpdateFields(
  type: UnavailabilityType,
  reason: string,
  documentUrl: string | null,
) {
  return {
    unavailability_type: type,
    sick_days_reason: type === 'sick_days' ? reason : null,
    vacation_reason: type === 'vacation' ? reason : null,
    general_reason: type === 'general' ? reason : null,
    document_url: documentUrl,
    ...approvalFieldsForUnavailabilityType(type),
  };
}

function cloneEntryFieldsForInsert(
  entry: EmployeeUnavailabilityEntry,
  startDate: string,
  endDate: string,
) {
  const approval = approvalFieldsForUnavailabilityType(entry.unavailability_type);
  return {
    employee_id: entry.employee_id,
    unavailability_type: entry.unavailability_type,
    sick_days_reason: entry.sick_days_reason,
    vacation_reason: entry.vacation_reason,
    general_reason: entry.general_reason,
    document_url: entry.document_url,
    start_date: startDate,
    end_date: endDate,
    start_time: entry.start_time,
    end_time: entry.end_time,
    ...approval,
  };
}

export async function uploadUnavailabilityDocument(
  employeeId: number,
  file: File,
): Promise<string> {
  const fileExt = file.name.split('.').pop();
  const fileName = `employee_${employeeId}_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

  const { error } = await supabase.storage
    .from('employee-unavailability-documents')
    .upload(fileName, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    });

  if (error) throw error;
  return fileName;
}

/** Remove a single calendar day from an unavailability record. */
export async function deleteUnavailabilityDay(
  entry: EmployeeUnavailabilityEntry,
  day: string,
): Promise<void> {
  await assertDateEditableForEmployee(entry.employee_id, day);

  const end = recordEndDate(entry);

  if (day < entry.start_date || day > end) {
    throw new Error('Day is outside the unavailability period');
  }

  if (entry.start_date === end) {
    const { error } = await supabase
      .from('employee_unavailability_reasons')
      .delete()
      .eq('id', entry.id);
    if (error) throw error;
    return;
  }

  if (day === entry.start_date) {
    const newStart = addDaysIso(day, 1);
    const { error } = await supabase
      .from('employee_unavailability_reasons')
      .update({ start_date: newStart })
      .eq('id', entry.id);
    if (error) throw error;
    return;
  }

  if (day === end) {
    const newEnd = addDaysIso(day, -1);
    const { error } = await supabase
      .from('employee_unavailability_reasons')
      .update({ end_date: newEnd })
      .eq('id', entry.id);
    if (error) throw error;
    return;
  }

  const beforeEnd = addDaysIso(day, -1);
  const afterStart = addDaysIso(day, 1);

  const { error: shrinkError } = await supabase
    .from('employee_unavailability_reasons')
    .update({ end_date: beforeEnd })
    .eq('id', entry.id);
  if (shrinkError) throw shrinkError;

  const { error: insertError } = await supabase
    .from('employee_unavailability_reasons')
    .insert(cloneEntryFieldsForInsert(entry, afterStart, end));
  if (insertError) throw insertError;
}

/** Update fields for one day row; splits multi-day records when needed. Resets to pending. */
export async function updateUnavailabilityDayRow(
  entry: EmployeeUnavailabilityEntry,
  day: string,
  payload: UnavailabilityEditPayload,
  employeeId: number,
): Promise<void> {
  await assertDateEditableForEmployee(employeeId, day);

  let documentUrl = payload.document_url;
  if (payload.documentFile) {
    documentUrl = await uploadUnavailabilityDocument(employeeId, payload.documentFile);
  }

  const updateFields = buildReasonUpdateFields(
    payload.unavailability_type,
    payload.reason,
    documentUrl,
  );

  const end = recordEndDate(entry);
  const isSingleDay = entry.start_date === end && entry.start_date === day;

  if (isSingleDay) {
    const { error } = await supabase
      .from('employee_unavailability_reasons')
      .update({
        ...updateFields,
        start_date: day,
        end_date: day,
      })
      .eq('id', entry.id);
    if (error) throw error;
    return;
  }

  await deleteUnavailabilityDay(entry, day);

  const { error } = await supabase
    .from('employee_unavailability_reasons')
    .insert({
      employee_id: employeeId,
      ...updateFields,
      start_date: day,
      end_date: day,
    });
  if (error) throw error;
}

/** Expand each unavailability record into one row per calendar day. */
export function expandUnavailabilitiesToDailyRows(
  entries: EmployeeUnavailabilityEntry[],
  dateFrom?: string,
  dateTo?: string,
): EmployeeUnavailabilityDayRow[] {
  const rows: EmployeeUnavailabilityDayRow[] = [];

  for (const entry of entries) {
    const end = entry.end_date || entry.start_date;
    let current = entry.start_date;

    while (current <= end) {
      const inFilter =
        (!dateFrom || current >= dateFrom) &&
        (!dateTo || current <= dateTo);

      if (inFilter) {
        rows.push({ ...entry, date: current });
      }

      if (current === end) break;
      current = addDaysIso(current, 1);
    }
  }

  rows.sort((a, b) => b.date.localeCompare(a.date));
  return rows;
}

function rangesOverlap(
  start: string,
  end: string | null,
  filterFrom: string,
  filterTo: string,
): boolean {
  // Compare YYYY-MM-DD as strings to avoid timezone shifts from Date parsing.
  const startKey = String(start).slice(0, 10);
  const endKey = end ? String(end).slice(0, 10) : startKey;
  return startKey <= filterTo && endKey >= filterFrom;
}

function mapUnavailabilityRows(data: unknown): EmployeeUnavailabilityEntry[] {
  return ((data || []) as EmployeeUnavailabilityEntry[]).map(normalizeUnavailabilityApprovalFields);
}

export async function fetchEmployeeUnavailabilitiesInRange(
  employeeId: number,
  dateFrom: string,
  dateTo: string,
): Promise<EmployeeUnavailabilityEntry[]> {
  const { data, error } = await supabase
    .from('employee_unavailability_reasons')
    .select(UNAVAILABILITY_SELECT)
    .eq('employee_id', employeeId)
    .lte('start_date', dateTo)
    .or(`end_date.gte.${dateFrom},end_date.is.null`)
    .order('start_date', { ascending: false });

  if (error) throw error;

  return mapUnavailabilityRows(data).filter((row) =>
    rangesOverlap(row.start_date, row.end_date, dateFrom, dateTo),
  );
}

/** All employees' unavailability records overlapping a date range. */
export async function fetchAllUnavailabilitiesInRange(
  dateFrom: string,
  dateTo: string,
): Promise<EmployeeUnavailabilityEntry[]> {
  const { data, error } = await supabase
    .from('employee_unavailability_reasons')
    .select(UNAVAILABILITY_SELECT)
    .lte('start_date', dateTo)
    .or(`end_date.gte.${dateFrom},end_date.is.null`)
    .order('start_date', { ascending: true });

  if (error) throw error;

  return mapUnavailabilityRows(data).filter((row) =>
    rangesOverlap(row.start_date, row.end_date, dateFrom, dateTo),
  );
}

export type UnavailabilityReasonReportRow = {
  id: number;
  employee_id: number;
  unavailability_type: string;
  sick_days_reason: string | null;
  document_url: string | null;
  start_date: string;
  end_date: string | null;
  created_at: string;
  approved?: boolean;
  declined?: boolean;
};

/** Lightweight fetch for the unavailabilities report summary (no employee join). */
export async function fetchUnavailabilityReasonsForReportInRange(
  dateFrom: string,
  dateTo: string,
): Promise<UnavailabilityReasonReportRow[]> {
  const { data, error } = await supabase
    .from('employee_unavailability_reasons')
    .select(
      `id, employee_id, unavailability_type, sick_days_reason, document_url, start_date, end_date, created_at,
       approved, declined`,
    )
    .lte('start_date', dateTo)
    .or(`end_date.gte.${dateFrom},end_date.is.null`)
    .order('start_date', { ascending: false });

  if (error) throw error;

  return ((data || []) as UnavailabilityReasonReportRow[])
    .map((row) => ({
      ...row,
      approved: row.approved === true,
      declined: row.declined === true,
    }))
    .filter((row) => rangesOverlap(row.start_date, row.end_date, dateFrom, dateTo));
}

export type EmployeeUnavailabilityDocument = EmployeeUnavailabilityEntry & {
  document_url: string;
};

/** All unavailability records for an employee that have an uploaded document. */
export async function fetchEmployeeUnavailabilityDocuments(
  employeeId: number,
): Promise<EmployeeUnavailabilityDocument[]> {
  const { data, error } = await supabase
    .from('employee_unavailability_reasons')
    .select(UNAVAILABILITY_SELECT)
    .eq('employee_id', employeeId)
    .not('document_url', 'is', null)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return mapUnavailabilityRows(data)
    .filter((row) => Boolean(row.document_url?.trim()))
    .map((row) => ({ ...row, document_url: row.document_url!.trim() }));
}

export function documentNameFromUrl(documentUrl: string): string {
  try {
    let filename = '';
    if (documentUrl.includes('?')) {
      filename = documentUrl.split('?')[0].split('/').pop() || '';
    } else {
      filename = documentUrl.split('/').pop() || '';
    }
    if (!filename) return 'document';
    const ext = filename.split('.').pop() || '';
    if (filename.startsWith('employee_') && filename.includes('_')) {
      return `Document.${ext}`;
    }
    return filename.split('?')[0];
  } catch {
    return 'document';
  }
}
