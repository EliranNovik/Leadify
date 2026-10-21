import { supabase } from './supabase';

/**
 * The firm's main departments — the same column set the dashboard's signed agreement
 * scoreboard is built from, so a department named there is named the same everywhere else.
 */
export type MainDepartment = { id: number; name: string };

/** Departments that carry a revenue target even when they are not flagged important. */
const MERGED_TARGET_DEPT_IDS = [2, 4, 5, 6];

/** Sales sub-departments roll up into their parent, so they never get a column of their own. */
const SALES_DEPT_IDS_TO_EXCLUDE = [12, 14, 15];

/** Commercial & Civil reports under this id, and it wins over the similarly named department. */
const COMMERCIAL_CIVIL_DEPT_ID = 20;

type DepartmentRow = { id: number | string; name?: string | null };

export function selectMainDepartments(
  important: DepartmentRow[],
  mergedTargets: DepartmentRow[] = [],
): MainDepartment[] {
  const byId = new Map<number, DepartmentRow>();
  for (const row of important) {
    const id = Number(row?.id);
    if (!Number.isFinite(id) || SALES_DEPT_IDS_TO_EXCLUDE.includes(id)) continue;
    byId.set(id, row);
  }
  for (const row of mergedTargets) {
    const id = Number(row?.id);
    if (!Number.isFinite(id) || SALES_DEPT_IDS_TO_EXCLUDE.includes(id) || byId.has(id)) continue;
    byId.set(id, row);
  }

  const hasCommercialCivil = byId.has(COMMERCIAL_CIVIL_DEPT_ID);

  return [...byId.entries()]
    .filter(([id, row]) => {
      if (id === COMMERCIAL_CIVIL_DEPT_ID) return true;
      const name = String(row?.name || '');
      if (name.includes('Commercial - Sales')) return false;
      if (hasCommercialCivil && name.includes('Commercial & Civil')) return false;
      return true;
    })
    .map(([id, row]) => ({
      id,
      name: id === COMMERCIAL_CIVIL_DEPT_ID ? 'Commercial & Civil' : String(row?.name || '').trim(),
    }))
    .filter((dept) => !!dept.name)
    .sort((a, b) => a.id - b.id);
}

export async function fetchMainDepartments(): Promise<MainDepartment[]> {
  const [important, merged] = await Promise.all([
    supabase.from('tenant_departement').select('id, name').eq('important', 't').order('id'),
    supabase
      .from('tenant_departement')
      .select('id, name')
      .in('id', MERGED_TARGET_DEPT_IDS)
      .order('id'),
  ]);

  if (important.error) throw important.error;

  return selectMainDepartments(
    (important.data || []) as DepartmentRow[],
    (merged.data || []) as DepartmentRow[],
  );
}
