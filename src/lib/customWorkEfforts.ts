import { supabase } from './supabase';
import type { EffortAreaId, WorkEffort } from './workAreaEfforts';

function isCustomEffortArea(value: string): value is EffortAreaId {
  return value === 'marketing' || value === 'sales' || value === 'finances' || value === 'development';
}

export async function fetchCustomWorkEfforts(): Promise<WorkEffort[]> {
  const { data, error } = await supabase
    .from('employee_work_efforts')
    .select('id, area, name')
    .order('name');
  if (error) throw error;
  return (data || []).flatMap((row) => {
    const area = String(row.area || '');
    if (!isCustomEffortArea(area)) return [];
    const name = String(row.name || '').trim();
    if (!name) return [];
    return [{ id: String(row.id), area, category: 'More', name }];
  });
}

export async function createCustomWorkEffort(area: EffortAreaId, rawName: string): Promise<WorkEffort> {
  const name = rawName.trim();
  if (name.length < 2) throw new Error('Enter at least 2 characters.');
  const { data, error } = await supabase
    .from('employee_work_efforts')
    .insert({ area, name })
    .select('id, area, name')
    .single();
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === '23505') throw new Error('That effort is already in this area.');
    const message = String((error as { message?: string }).message || '');
    if (code === '42P01' || code === 'PGRST205' || /does not exist|schema cache/i.test(message)) {
      throw new Error('Run sql/2026-11-18_employee_effort_allocations.sql in Supabase, then add the effort again.');
    }
    throw error;
  }
  return {
    id: String(data.id),
    area,
    category: 'More',
    name: String(data.name || name),
  };
}
