import { supabase } from './supabase';

export type UnavailabilityType = 'sick_days' | 'vacation' | 'general';

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
  created_at: string;
};

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
      return 'bg-orange-100 text-orange-700 border border-orange-200';
    case 'vacation':
      return 'bg-green-100 text-green-700 border border-green-200';
    case 'general':
      return 'bg-slate-100 text-slate-700 border border-slate-200';
    default:
      return 'bg-gray-100 text-gray-700 border border-gray-200';
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

export function unavailabilityReasonText(entry: EmployeeUnavailabilityEntry): string {
  if (entry.unavailability_type === 'sick_days') {
    return entry.sick_days_reason?.trim() || '—';
  }
  if (entry.unavailability_type === 'vacation') {
    return entry.vacation_reason?.trim() || '—';
  }
  return entry.general_reason?.trim() || '—';
}

function formatUnavailabilityDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
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
  };
}

function cloneEntryFieldsForInsert(
  entry: EmployeeUnavailabilityEntry,
  startDate: string,
  endDate: string,
) {
  return {
    employee_id: entry.employee_id,
    unavailability_type: entry.unavailability_type,
    sick_days_reason: entry.sick_days_reason,
    vacation_reason: entry.vacation_reason,
    general_reason: entry.general_reason,
    document_url: entry.document_url,
    start_date: startDate,
    end_date: endDate,
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

/** Update fields for one day row; splits multi-day records when needed. */
export async function updateUnavailabilityDayRow(
  entry: EmployeeUnavailabilityEntry,
  day: string,
  payload: UnavailabilityEditPayload,
  employeeId: number,
): Promise<void> {
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
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : startDate;
  const filterFromDate = new Date(filterFrom);
  const filterToDate = new Date(filterTo);
  return startDate <= filterToDate && endDate >= filterFromDate;
}

export async function fetchEmployeeUnavailabilitiesInRange(
  employeeId: number,
  dateFrom: string,
  dateTo: string,
): Promise<EmployeeUnavailabilityEntry[]> {
  const { data, error } = await supabase
    .from('employee_unavailability_reasons')
    .select(
      `id, employee_id, unavailability_type, sick_days_reason, vacation_reason,
       general_reason, document_url, start_date, end_date, created_at`,
    )
    .eq('employee_id', employeeId)
    .order('start_date', { ascending: false });

  if (error) throw error;

  return ((data || []) as EmployeeUnavailabilityEntry[]).filter((row) =>
    rangesOverlap(row.start_date, row.end_date, dateFrom, dateTo),
  );
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
