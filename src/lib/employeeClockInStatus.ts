import { supabase } from './supabase';

/** Employee IDs that currently have an active clock-in row. */
export async function fetchClockedInEmployeeIds(): Promise<Set<number>> {
  const { data, error } = await supabase
    .from('employee_clock_in')
    .select('employee_id')
    .eq('is_active', true);

  if (error) {
    throw error;
  }

  const ids = new Set<number>();
  for (const row of data ?? []) {
    const id = Number(row.employee_id);
    if (!Number.isNaN(id)) ids.add(id);
  }
  return ids;
}
