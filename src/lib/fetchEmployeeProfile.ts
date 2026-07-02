import { supabase } from './supabase';

export type EmployeeProfile = {
  id: number;
  display_name: string;
  photo_url: string | null;
  chat_background_image_url: string | null;
  mobile: string;
  phone: string;
  phone_ext: string;
  email: string | null;
  department_name: string;
  bonuses_role: string;
  official_name: string;
  linkedin_url: string | null;
};

const EMPLOYEE_SELECT = `
  id,
  display_name,
  photo_url,
  chat_background_image_url,
  mobile,
  phone,
  phone_ext,
  bonuses_role,
  official_name,
  linkedin_url,
  department_id,
  tenant_departement!department_id (
    name
  )
`;

function mapEmployeeRow(employeeData: Record<string, unknown>, userEmail: string | null): EmployeeProfile {
  const dept = employeeData.tenant_departement as { name?: string } | { name?: string }[] | null;
  const departmentName = Array.isArray(dept) ? dept[0]?.name : dept?.name;

  return {
    id: Number(employeeData.id),
    display_name: String(employeeData.display_name ?? ''),
    photo_url: (employeeData.photo_url as string) || null,
    chat_background_image_url: (employeeData.chat_background_image_url as string) || null,
    mobile: String(employeeData.mobile ?? ''),
    phone: String(employeeData.phone ?? ''),
    phone_ext: String(employeeData.phone_ext ?? ''),
    email: userEmail,
    department_name: departmentName || 'General',
    bonuses_role: String(employeeData.bonuses_role ?? 'Employee'),
    official_name: String(employeeData.official_name || employeeData.display_name || ''),
    linkedin_url: (employeeData.linkedin_url as string) || null,
  };
}

async function enrichWithEmail(employeeId: number): Promise<string | null> {
  const { data: userData } = await supabase
    .from('users')
    .select('email')
    .eq('employee_id', employeeId)
    .maybeSingle();
  return userData?.email ?? null;
}

export async function fetchEmployeeProfileById(employeeId: number): Promise<EmployeeProfile | null> {
  const { data, error } = await supabase
    .from('tenants_employee')
    .select(EMPLOYEE_SELECT)
    .eq('id', employeeId)
    .maybeSingle();

  if (error || !data) return null;

  const email = await enrichWithEmail(data.id);
  return mapEmployeeRow(data as Record<string, unknown>, email);
}

function mapPublicBusinessCardRow(row: Record<string, unknown>): EmployeeProfile {
  return {
    id: Number(row.id),
    display_name: String(row.display_name ?? ''),
    photo_url: (row.photo_url as string) || null,
    chat_background_image_url: (row.chat_background_image_url as string) || null,
    mobile: String(row.mobile ?? ''),
    phone: String(row.phone ?? ''),
    phone_ext: String(row.phone_ext ?? ''),
    email: (row.email as string) || null,
    department_name: String(row.department_name ?? 'General'),
    bonuses_role: String(row.bonuses_role ?? 'Employee'),
    official_name: String(row.official_name || row.display_name || ''),
    linkedin_url: (row.linkedin_url as string) || null,
  };
}

/** Public business card page — uses RPC when available (anon/mobile share links). */
export async function fetchPublicBusinessCardById(employeeId: number): Promise<EmployeeProfile | null> {
  if (!Number.isFinite(employeeId) || employeeId <= 0) return null;

  const { data, error } = await supabase.rpc('get_public_business_card', {
    p_employee_id: employeeId,
  });

  if (!error && data && typeof data === 'object' && (data as Record<string, unknown>).id != null) {
    return mapPublicBusinessCardRow(data as Record<string, unknown>);
  }

  return fetchEmployeeProfileById(employeeId);
}

export async function fetchEmployeeProfileByDisplayName(
  displayName: string,
): Promise<EmployeeProfile | null> {
  const trimmed = displayName.trim();
  if (!trimmed) return null;

  const { data, error } = await supabase
    .from('tenants_employee')
    .select(EMPLOYEE_SELECT)
    .eq('display_name', trimmed)
    .maybeSingle();

  if (error || !data) return null;

  const email = await enrichWithEmail(data.id);
  return mapEmployeeRow(data as Record<string, unknown>, email);
}

/** Resolve employee by display or official name (portal team cards use official_name). */
export async function fetchEmployeeProfileByName(name: string): Promise<EmployeeProfile | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const byDisplay = await fetchEmployeeProfileByDisplayName(trimmed);
  if (byDisplay) return byDisplay;

  const { data, error } = await supabase
    .from('tenants_employee')
    .select(EMPLOYEE_SELECT)
    .eq('official_name', trimmed)
    .maybeSingle();

  if (error || !data) return null;

  const email = await enrichWithEmail(data.id);
  return mapEmployeeRow(data as Record<string, unknown>, email);
}

/** Resolve issuer for public proforma — prefers employee id, falls back to display name. */
/** True when the string looks like a dialable phone number (has at least one digit). */
function isUsablePhone(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && /\d/.test(trimmed);
}

/** Prefer mobile; use office phone when mobile is missing or not dialable. */
export function getEmployeeCallPhone(
  employee: Pick<EmployeeProfile, 'mobile' | 'phone'> | null | undefined,
): string {
  if (!employee) return '';

  const mobile = String(employee.mobile ?? '').trim();
  if (isUsablePhone(mobile)) return mobile;

  const phone = String(employee.phone ?? '').trim();
  if (isUsablePhone(phone)) return phone;

  return '';
}

export async function fetchIssuerEmployee(options: {
  employeeId?: number | string | null;
  displayName?: string | null;
}): Promise<EmployeeProfile | null> {
  const id =
    options.employeeId != null && options.employeeId !== ''
      ? Number(options.employeeId)
      : NaN;

  if (Number.isFinite(id) && id > 0) {
    const byId = await fetchEmployeeProfileById(id);
    if (byId) return byId;
  }

  if (options.displayName) {
    return fetchEmployeeProfileByDisplayName(options.displayName);
  }

  return null;
}
