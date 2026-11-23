import { supabase } from './supabase';

function groupExcludedDates(
  rows: Array<{ employee_id: number | null; work_date: string | null }>,
): Map<number, Set<string>> {
  const byEmployee = new Map<number, Set<string>>();
  for (const row of rows) {
    const employeeId = Number(row.employee_id);
    const workDate = String(row.work_date || '').slice(0, 10);
    if (!employeeId || !workDate) continue;
    const dates = byEmployee.get(employeeId) ?? new Set<string>();
    dates.add(workDate);
    byEmployee.set(employeeId, dates);
  }
  return byEmployee;
}

/** Days in the range whose automatic base hours were deleted. */
export async function fetchAutoFillExclusionsInRange(
  dateFrom: string,
  dateTo: string,
): Promise<Map<number, Set<string>>> {
  const { data, error } = await supabase
    .from('employee_auto_fill_exclusions')
    .select('employee_id, work_date')
    .gte('work_date', dateFrom)
    .lte('work_date', dateTo);

  if (error) {
    console.warn('[auto-fill exclusions]', error.message);
    return new Map();
  }

  return groupExcludedDates(data || []);
}

export async function fetchAutoFillExcludedDates(
  employeeId: number,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('employee_auto_fill_exclusions')
    .select('work_date')
    .eq('employee_id', employeeId);

  if (error) {
    console.warn('[auto-fill exclusions]', error.message);
    return new Set();
  }

  return new Set(
    (data || [])
      .map((row) => String(row.work_date || '').slice(0, 10))
      .filter(Boolean),
  );
}

/** Remember that this day must stay empty instead of receiving automatic base hours. */
export async function excludeAutoFilledDay(
  employeeId: number,
  workDate: string,
): Promise<void> {
  const { error } = await supabase
    .from('employee_auto_fill_exclusions')
    .upsert(
      { employee_id: employeeId, work_date: workDate },
      { onConflict: 'employee_id,work_date', ignoreDuplicates: true },
    );

  if (error) throw new Error(error.message);
}
