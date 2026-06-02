import { supabase } from './supabase';

export interface SalaryEntryRow {
  employee_id: number;
  employee_name: string;
  department: string;
  role: string;
  photo_url: string | null;
  recordId?: number;
  gross_salary: number;
  net_salary: number | null;
}

export interface ActiveStaffEmployee {
  id: number;
  display_name: string;
  photo_url: string | null;
}

/** Active staff: tenants_employee rows linked to users with is_staff + is_active. */
export async function fetchActiveStaffEmployees(): Promise<ActiveStaffEmployee[]> {
  const { data, error } = await supabase
    .from('tenants_employee')
    .select('id, display_name, photo_url, photo');

  if (error) {
    throw error;
  }

  const allEmployeeIds = (data || []).map((e: { id: number }) => e.id);
  let staffEmployeeIds = new Set<number>();
  if (allEmployeeIds.length > 0) {
    const { data: staffUsers, error: usersError } = await supabase
      .from('users')
      .select('employee_id')
      .in('employee_id', allEmployeeIds)
      .eq('is_staff', true)
      .eq('is_active', true);

    if (usersError) {
      throw usersError;
    }
    staffEmployeeIds = new Set(
      (staffUsers || []).map((u: { employee_id: number | null }) => u.employee_id).filter(Boolean) as number[],
    );
  }

  return (data || [])
    .filter((emp: { id: number }) => staffEmployeeIds.has(emp.id))
    .map(
      (emp: {
        id: number;
        display_name: string | null;
        photo_url: string | null;
        photo: string | null;
      }) => ({
        id: emp.id,
        display_name: emp.display_name?.trim() || `Employee #${emp.id}`,
        photo_url:
          (typeof emp.photo_url === 'string' && emp.photo_url.trim()) ||
          (typeof emp.photo === 'string' && emp.photo.trim()) ||
          null,
      }),
    )
    .sort((a, b) => a.display_name.localeCompare(b.display_name, undefined, { sensitivity: 'base' }));
}

const ROLE_DISPLAY: Record<string, string> = {
  c: 'Closer',
  s: 'Scheduler',
  h: 'Handler',
  n: 'No role',
  e: 'Expert',
  z: 'Manager',
  Z: 'Manager',
  p: 'Partner',
  m: 'Manager',
  dm: 'Department Manager',
  pm: 'Project Manager',
  se: 'Secretary',
  b: 'Book keeper',
  partners: 'Partners',
  dv: 'Developer',
  ma: 'Marketing',
  P: 'Partner',
  M: 'Manager',
  DM: 'Department Manager',
  PM: 'Project Manager',
  SE: 'Secretary',
  B: 'Book keeper',
  Partners: 'Partners',
  d: 'Diverse',
  f: 'Finance',
};

export const getSalaryRoleDisplayName = (roleCode: string): string =>
  ROLE_DISPLAY[roleCode] || roleCode || 'No role';

export const getSalaryEmployeeInitials = (name: string): string =>
  name
    .split(' ')
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

/** Stable hue per employee — same person always gets the same colour. */
export const stableHueForSalaryAvatar = (employeeId: number | null, label: string): number => {
  if (employeeId != null && Number.isFinite(employeeId)) {
    return Math.abs(Math.trunc(employeeId)) * 47 % 360;
  }
  let h = 0;
  const s = label || '?';
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h % 360;
};

export const salaryAvatarGradientStyle = (
  employeeId: number,
  label: string,
): { background: string } => {
  const hue = stableHueForSalaryAvatar(employeeId, label);
  const hue2 = (hue + 32) % 360;
  return {
    background: `linear-gradient(145deg, hsl(${hue} 58% 46%), hsl(${hue2} 52% 36%))`,
  };
};

export const formatSalaryCurrency = (amount: number): string =>
  new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);

export const SALARY_MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1).map(month => ({
  value: month,
  label: new Date(2000, month - 1, 1).toLocaleString('en-US', { month: 'long' }),
}));

export function salaryYearOptions(): number[] {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: 8 }, (_, i) => currentYear - 5 + i);
}

/** Active staff: linked users with is_staff + is_active (same filter as Employee Salaries Report manual entries). */
export async function fetchActiveStaffSalaryRows(
  salaryMonth: number,
  salaryYear: number,
): Promise<SalaryEntryRow[]> {
  const activeEmployees = await fetchActiveStaffEmployees();
  const employeeIds = activeEmployees.map(e => e.id);
  if (employeeIds.length === 0) {
    return [];
  }

  const [metaRes, salariesRes] = await Promise.all([
    supabase
      .from('tenants_employee')
      .select(`
        id,
        bonuses_role,
        tenant_departement!department_id ( name )
      `)
      .in('id', employeeIds),
    supabase
      .from('employee_salary')
      .select('id, employee_id, gross_salary, net_salary')
      .eq('salary_month', salaryMonth)
      .eq('salary_year', salaryYear),
  ]);

  if (metaRes.error) {
    throw metaRes.error;
  }

  const metaById = new Map(
    (metaRes.data || []).map((emp: {
      id: number;
      bonuses_role: string | null;
      tenant_departement: { name: string } | Array<{ name: string }> | null;
    }) => [emp.id, emp]),
  );

  const salaryByEmployee = new Map<number, { id: number; gross_salary: number; net_salary: number | null }>();
  salariesRes.data?.forEach((r: { employee_id: number; id: number; gross_salary: number; net_salary: number | null }) => {
    salaryByEmployee.set(r.employee_id, {
      id: r.id,
      gross_salary: r.gross_salary ?? 0,
      net_salary: r.net_salary,
    });
  });

  return activeEmployees
    .map(emp => {
      const meta = metaById.get(emp.id);
      const dept = meta
        ? Array.isArray(meta.tenant_departement)
          ? meta.tenant_departement[0]?.name
          : meta.tenant_departement?.name
        : undefined;
      const existing = salaryByEmployee.get(emp.id);
      return {
        employee_id: emp.id,
        employee_name: emp.display_name,
        department: dept || '—',
        role: meta?.bonuses_role || '',
        photo_url: emp.photo_url,
        recordId: existing?.id,
        gross_salary: existing?.gross_salary ?? 0,
        net_salary: existing?.net_salary ?? null,
      };
    })
    .sort((a, b) => a.employee_name.localeCompare(b.employee_name, undefined, { sensitivity: 'base' }));
}

/** Upsert manual salary rows; preserves document_url / extracted_data when editing numbers. */
export async function saveActiveStaffSalaryRows(
  rows: SalaryEntryRow[],
  salaryMonth: number,
  salaryYear: number,
): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Not authenticated');
  }

  const toSave = rows.filter(
    r => r.gross_salary > 0 || (r.net_salary != null && r.net_salary !== 0),
  );
  if (toSave.length === 0) {
    throw new Error('Add at least one salary (Gross or Net) to save');
  }

  for (const row of toSave) {
    const { data: existingRow } = await supabase
      .from('employee_salary')
      .select('document_url, extracted_data')
      .eq('employee_id', row.employee_id)
      .eq('salary_month', salaryMonth)
      .eq('salary_year', salaryYear)
      .maybeSingle();

    const payload = {
      employee_id: row.employee_id,
      salary_month: salaryMonth,
      salary_year: salaryYear,
      gross_salary: Number(row.gross_salary) || 0,
      net_salary: row.net_salary != null ? Number(row.net_salary) : null,
      document_url: existingRow?.document_url ?? null,
      extracted_data: existingRow?.extracted_data ?? null,
      approved: false,
      uploaded_by: user.id,
    };

    const { error } = await supabase
      .from('employee_salary')
      .upsert(payload, { onConflict: 'employee_id,salary_month,salary_year' });

    if (error) {
      throw error;
    }
  }

  return toSave.length;
}
