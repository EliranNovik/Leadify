import { supabase } from './supabase';

export type EmployeeWorkingHoursSubmission = {
  id: number;
  employee_id: number;
  user_id: string;
  year: number;
  month: number;
  period_total: string | null;
  missing_days: number;
  submitted_at: string;
};

export class WorkingHoursAlreadySubmittedError extends Error {
  constructor() {
    super('Working hours for this month were already submitted.');
    this.name = 'WorkingHoursAlreadySubmittedError';
  }
}

export class WorkingHoursMonthLockedError extends Error {
  constructor() {
    super('This month has been submitted. Cancel the submission to add or edit entries.');
    this.name = 'WorkingHoursMonthLockedError';
  }
}

export function yearMonthFromDateKey(dateKey: string): { year: number; month: number } {
  const [year, month] = dateKey.split('-').map(Number);
  return { year, month };
}

export async function fetchWorkingHoursSubmission(
  employeeId: number,
  year: number,
  month: number,
): Promise<EmployeeWorkingHoursSubmission | null> {
  const { data, error } = await supabase
    .from('employee_working_hours_submissions')
    .select('id, employee_id, user_id, year, month, period_total, missing_days, submitted_at')
    .eq('employee_id', employeeId)
    .eq('year', year)
    .eq('month', month)
    .maybeSingle();

  if (error) throw error;
  return (data as EmployeeWorkingHoursSubmission | null) ?? null;
}

/** All working-hours submissions for a calendar month (admin report). */
export async function fetchWorkingHoursSubmissionsForMonth(
  year: number,
  month: number,
): Promise<EmployeeWorkingHoursSubmission[]> {
  const { data, error } = await supabase
    .from('employee_working_hours_submissions')
    .select('id, employee_id, user_id, year, month, period_total, missing_days, submitted_at')
    .eq('year', year)
    .eq('month', month);

  if (error) throw error;
  return (data as EmployeeWorkingHoursSubmission[]) ?? [];
}

export async function submitWorkingHoursMonth(params: {
  employeeId: number;
  userId: string;
  year: number;
  month: number;
  periodTotal: string;
  missingDays: number;
}): Promise<EmployeeWorkingHoursSubmission> {
  const { data, error } = await supabase
    .from('employee_working_hours_submissions')
    .insert({
      employee_id: params.employeeId,
      user_id: params.userId,
      year: params.year,
      month: params.month,
      period_total: params.periodTotal,
      missing_days: params.missingDays,
    })
    .select('id, employee_id, user_id, year, month, period_total, missing_days, submitted_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new WorkingHoursAlreadySubmittedError();
    }
    throw error;
  }

  return data as EmployeeWorkingHoursSubmission;
}

export async function assertWorkingHoursMonthEditable(
  employeeId: number,
  year: number,
  month: number,
): Promise<void> {
  const submission = await fetchWorkingHoursSubmission(employeeId, year, month);
  if (submission) throw new WorkingHoursMonthLockedError();
}

export async function assertDateEditableForEmployee(
  employeeId: number,
  dateKey: string,
): Promise<void> {
  const { year, month } = yearMonthFromDateKey(dateKey);
  await assertWorkingHoursMonthEditable(employeeId, year, month);
}

export async function cancelWorkingHoursSubmission(
  employeeId: number,
  year: number,
  month: number,
): Promise<void> {
  const { error } = await supabase
    .from('employee_working_hours_submissions')
    .delete()
    .eq('employee_id', employeeId)
    .eq('year', year)
    .eq('month', month);

  if (error) throw error;
}
