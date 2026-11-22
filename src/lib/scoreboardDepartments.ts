import { supabase } from './supabase';

/** Same department set as the Agreement signed columns on the home dashboard. */
const MERGED_TARGET_DEPT_IDS = [2, 4, 5, 6];
const SALES_DEPT_IDS_TO_EXCLUDE = [12, 14, 15];

export type ScoreboardDepartment = {
  id: number;
  name: string;
};

export const GENERAL_EFFORT_DEPARTMENT_LABEL = 'General';

let cachedDepartments: Promise<ScoreboardDepartment[]> | null = null;

export function fetchAgreementScoreboardDepartments(): Promise<ScoreboardDepartment[]> {
  if (!cachedDepartments) {
    cachedDepartments = loadAgreementScoreboardDepartments().catch((error) => {
      cachedDepartments = null;
      throw error;
    });
  }
  return cachedDepartments;
}

async function loadAgreementScoreboardDepartments(): Promise<ScoreboardDepartment[]> {
  const [
    { data: importantDepartments, error: importantError },
    { data: mergedTargetDepts, error: mergedError },
  ] = await Promise.all([
    supabase.from('tenant_departement').select('id, name, important').eq('important', 't').order('id'),
    supabase
      .from('tenant_departement')
      .select('id, name, important')
      .in('id', MERGED_TARGET_DEPT_IDS)
      .order('id'),
  ]);

  if (importantError) throw importantError;
  if (mergedError) console.error('Error fetching merged target departments:', mergedError);

  const departmentMap = new Map<number, ScoreboardDepartment>();
  for (const dept of importantDepartments || []) {
    if (SALES_DEPT_IDS_TO_EXCLUDE.includes(Number(dept.id))) continue;
    departmentMap.set(Number(dept.id), {
      id: Number(dept.id),
      name: String(dept.name || '').trim(),
    });
  }
  for (const dept of mergedTargetDepts || []) {
    const id = Number(dept.id);
    if (SALES_DEPT_IDS_TO_EXCLUDE.includes(id) || departmentMap.has(id)) continue;
    departmentMap.set(id, { id, name: String(dept.name || '').trim() });
  }

  const hasCommercialCivil = departmentMap.has(20);
  const departments = Array.from(departmentMap.values())
    .filter((dept) => {
      if (dept.name.toLowerCase() === 'general') return false;
      if (dept.id === 20) return true;
      if (dept.name === 'Commercial - Sales' || dept.name.includes('Commercial - Sales')) return false;
      if (hasCommercialCivil && (dept.name === 'Commercial & Civil' || dept.name.includes('Commercial & Civil'))) {
        return false;
      }
      return Boolean(dept.name);
    })
    .map((dept) => (dept.id === 20 ? { ...dept, name: 'Commercial & Civil' } : dept))
    .sort((a, b) => a.id - b.id);

  return departments;
}
