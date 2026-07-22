import { supabase } from './supabase';
import { toDateInputValue } from './employeeClockInFormat';
import { fetchEmployeeWorksFromHome } from './clockInLocations';

export type WfhPeriodRequestStatus = 'pending' | 'approved' | 'declined';

export type WfhPeriodRequest = {
  id: number;
  employee_id: number;
  user_id: string;
  start_date: string;
  end_date: string;
  status: WfhPeriodRequestStatus;
  notes: string | null;
  decline_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  employee_name?: string;
  employee_department?: string;
  employee_photo_url?: string | null;
};

const WFH_PERIOD_SELECT = `
  id, employee_id, user_id, start_date, end_date, status, notes, decline_note,
  reviewed_by, reviewed_at, created_at
`;

function normalizeDateKey(value: string | Date): string {
  if (value instanceof Date) return toDateInputValue(value);
  return String(value).slice(0, 10);
}

export function formatWfhPeriodLabel(startDate: string, endDate: string): string {
  const start = normalizeDateKey(startDate);
  const end = normalizeDateKey(endDate);
  if (start === end) {
    return new Date(`${start}T12:00:00`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
  const fmt = (d: string) =>
    new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

export async function fetchPendingWfhPeriodRequest(
  employeeId: number,
): Promise<WfhPeriodRequest | null> {
  const { data, error } = await supabase
    .from('employee_wfh_period_requests')
    .select(WFH_PERIOD_SELECT)
    .eq('employee_id', employeeId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as WfhPeriodRequest | null) ?? null;
}

export async function fetchPendingWfhPeriodRequestCount(
  employeeId: number,
): Promise<boolean> {
  const { count, error } = await supabase
    .from('employee_wfh_period_requests')
    .select('id', { count: 'exact', head: true })
    .eq('employee_id', employeeId)
    .eq('status', 'pending');

  if (error) throw error;
  return (count ?? 0) > 0;
}

/** True if an approved period covers the given day (defaults to today). */
export async function employeeHasApprovedWfhPeriodOnDate(
  employeeId: number,
  dateKey: string = toDateInputValue(new Date()),
): Promise<boolean> {
  const day = normalizeDateKey(dateKey);
  const { count, error } = await supabase
    .from('employee_wfh_period_requests')
    .select('id', { count: 'exact', head: true })
    .eq('employee_id', employeeId)
    .eq('status', 'approved')
    .lte('start_date', day)
    .gte('end_date', day);

  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * Home clock-in allowed when permanent works_from_home is on,
 * or an approved WFH period covers today.
 */
export async function employeeCanClockInFromHomeToday(
  employeeId: number,
): Promise<boolean> {
  const worksFromHome = await fetchEmployeeWorksFromHome(employeeId);
  if (worksFromHome) return true;
  return employeeHasApprovedWfhPeriodOnDate(employeeId);
}

export async function insertWfhPeriodRequest(input: {
  employeeId: number;
  userId: string;
  startDate: string;
  endDate: string;
  notes?: string | null;
}): Promise<WfhPeriodRequest> {
  const start = normalizeDateKey(input.startDate);
  const end = normalizeDateKey(input.endDate);
  if (end < start) {
    throw new Error('End date must be on or after start date');
  }

  const pending = await fetchPendingWfhPeriodRequestCount(input.employeeId);
  if (pending) {
    throw new Error('You already have a pending work-from-home request');
  }

  const { data, error } = await supabase
    .from('employee_wfh_period_requests')
    .insert({
      employee_id: input.employeeId,
      user_id: input.userId,
      start_date: start,
      end_date: end,
      status: 'pending',
      notes: input.notes?.trim() || null,
    })
    .select(WFH_PERIOD_SELECT)
    .single();

  if (error) throw error;
  return data as WfhPeriodRequest;
}

export async function fetchPendingWfhPeriodRequestsForApproval(): Promise<WfhPeriodRequest[]> {
  const { data, error } = await supabase
    .from('employee_wfh_period_requests')
    .select(
      `${WFH_PERIOD_SELECT},
       tenants_employee:employee_id (
         display_name, photo_url, photo,
         tenant_departement:department_id ( name )
       )`,
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) throw error;

  type Row = WfhPeriodRequest & {
    tenants_employee?:
      | {
          display_name: string | null;
          photo_url?: string | null;
          photo?: string | null;
          tenant_departement?: { name: string } | { name: string }[] | null;
        }
      | Array<{
          display_name: string | null;
          photo_url?: string | null;
          photo?: string | null;
          tenant_departement?: { name: string } | { name: string }[] | null;
        }>
      | null;
  };

  return ((data || []) as Row[]).map((row) => {
    const emp = Array.isArray(row.tenants_employee)
      ? row.tenants_employee[0]
      : row.tenants_employee;
    const deptRaw = emp?.tenant_departement;
    const dept = Array.isArray(deptRaw) ? deptRaw[0] : deptRaw;
    const { tenants_employee: _drop, ...rest } = row;
    return {
      ...rest,
      employee_name: emp?.display_name?.trim() || `Employee #${row.employee_id}`,
      employee_department: dept?.name?.trim() || undefined,
      employee_photo_url: emp?.photo_url?.trim() || emp?.photo?.trim() || null,
    };
  });
}

export async function fetchPendingWfhPeriodApprovalCount(): Promise<number> {
  const { count, error } = await supabase
    .from('employee_wfh_period_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  if (error) throw error;
  return count ?? 0;
}

export async function approveWfhPeriodRequest(
  requestId: number,
  reviewerAuthUserId: string,
): Promise<void> {
  const { error } = await supabase
    .from('employee_wfh_period_requests')
    .update({
      status: 'approved',
      reviewed_by: reviewerAuthUserId,
      reviewed_at: new Date().toISOString(),
      decline_note: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .eq('status', 'pending');

  if (error) throw error;
}

export async function declineWfhPeriodRequest(
  requestId: number,
  reviewerAuthUserId: string,
  declineNote?: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('employee_wfh_period_requests')
    .update({
      status: 'declined',
      reviewed_by: reviewerAuthUserId,
      reviewed_at: new Date().toISOString(),
      decline_note: declineNote?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .eq('status', 'pending');

  if (error) throw error;
}
