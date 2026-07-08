const BYPASS_STORAGE_KEY = 'admin_clock_in_bypass_v1';
export const ADMIN_PROFILE_BYPASS_CHANGED_EVENT = 'admin-profile-bypass-changed';

export type AdminClockInBypassMode = 'self' | 'user';

export type AdminClockInBypass = {
  /** Auth user id of the signed-in worker session. */
  sessionAuthUserId: string;
  /** Superuser who initiated impersonation. */
  adminAuthUserId: string;
  mode: AdminClockInBypassMode;
  targetUserId: string | null;
  targetEmployeeId: number | null;
  targetDisplayName: string;
  targetPhotoUrl: string | null;
  targetInitials: string;
  /** Signed grant for switching between worker accounts. */
  switchGrant?: string | null;
};

export type BypassStaffUser = {
  userId: string;
  employeeId: number;
  displayName: string;
  photoUrl: string | null;
  email: string;
};

function parseSuperuserFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function deriveInitialsFromName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'U';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export function readAdminClockInBypassRaw(): AdminClockInBypass | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(BYPASS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminClockInBypass;
    if (!parsed?.adminAuthUserId || !parsed.mode) return null;
    if (!parsed.sessionAuthUserId) {
      parsed.sessionAuthUserId = parsed.adminAuthUserId;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function readAdminClockInBypass(
  currentAuthUserId: string | undefined,
): AdminClockInBypass | null {
  if (!currentAuthUserId) return null;
  const bypass = readAdminClockInBypassRaw();
  if (!bypass) return null;
  const sessionId = bypass.sessionAuthUserId || bypass.adminAuthUserId;
  if (sessionId !== currentAuthUserId) return null;
  return bypass;
}

export function writeAdminClockInBypass(bypass: AdminClockInBypass): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(BYPASS_STORAGE_KEY, JSON.stringify(bypass));
    window.dispatchEvent(new CustomEvent(ADMIN_PROFILE_BYPASS_CHANGED_EVENT));
  } catch {
    // ignore quota / private mode
  }
}

export function clearAdminClockInBypass(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(BYPASS_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(ADMIN_PROFILE_BYPASS_CHANGED_EVENT));
  } catch {
    // ignore
  }
}

export async function verifyAuthUserIsSuperuser(authUserId: string): Promise<boolean> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('users')
    .select('is_superuser')
    .eq('auth_id', authUserId)
    .maybeSingle();

  if (error || !data) return false;
  return parseSuperuserFlag(data.is_superuser);
}

function displayNameFromUserRow(row: {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  tenants_employee?: { display_name?: string | null } | { display_name?: string | null }[] | null;
}): string {
  const emp = row.tenants_employee;
  const employeeName = Array.isArray(emp) ? emp[0]?.display_name : emp?.display_name;
  if (employeeName?.trim()) return employeeName.trim();

  if (row.first_name?.trim() && row.last_name?.trim()) {
    return `${row.first_name.trim()} ${row.last_name.trim()}`;
  }
  if (row.full_name?.trim()) return row.full_name.trim();
  return (row.email || 'User').trim();
}

function photoFromUserRow(row: {
  tenants_employee?: { photo_url?: string | null; photo?: string | null } | { photo_url?: string | null; photo?: string | null }[] | null;
}): string | null {
  const emp = row.tenants_employee;
  const employee = Array.isArray(emp) ? emp[0] : emp;
  const photoUrl = employee?.photo_url;
  const photo = employee?.photo;
  const resolved =
    (typeof photoUrl === 'string' && photoUrl.trim()) ||
    (typeof photo === 'string' && photo.trim()) ||
    '';
  return resolved || null;
}

export async function fetchBypassStaffUsers(): Promise<BypassStaffUser[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('users')
    .select(`
      id,
      first_name,
      last_name,
      full_name,
      email,
      employee_id,
      is_active,
      extern,
      tenants_employee!employee_id (
        display_name,
        photo_url,
        photo
      )
    `)
    .eq('is_active', true)
    .not('employee_id', 'is', null)
    .order('full_name', { ascending: true });

  if (error) {
    console.error('Failed to load staff users for admin bypass:', error);
    return [];
  }

  return (data || [])
    .filter((row) => {
      const extern = row.extern;
      const isExternal =
        extern === true ||
        extern === 'true' ||
        extern === 1 ||
        extern === '1';
      const employeeId = Number(row.employee_id);
      return !isExternal && Number.isFinite(employeeId) && employeeId > 0;
    })
    .map((row) => {
      const employeeId = Number(row.employee_id);
      const displayName = displayNameFromUserRow(row);
      return {
        userId: String(row.id),
        employeeId,
        displayName,
        photoUrl: photoFromUserRow(row),
        email: String(row.email || ''),
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));
}

export async function buildSelfAdminBypass(adminAuthUserId: string): Promise<AdminClockInBypass | null> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('users')
    .select(`
      id,
      first_name,
      last_name,
      full_name,
      email,
      employee_id,
      tenants_employee!employee_id (
        display_name,
        photo_url,
        photo
      )
    `)
    .eq('auth_id', adminAuthUserId)
    .maybeSingle();

  if (error || !data) return null;

  const displayName = displayNameFromUserRow(data);
  const employeeId =
    data.employee_id != null && data.employee_id !== '' ? Number(data.employee_id) : null;

  return {
    sessionAuthUserId: adminAuthUserId,
    adminAuthUserId,
    mode: 'self',
    targetUserId: String(data.id),
    targetEmployeeId: Number.isFinite(employeeId) ? employeeId : null,
    targetDisplayName: displayName,
    targetPhotoUrl: photoFromUserRow(data),
    targetInitials: deriveInitialsFromName(displayName),
  };
}

export function buildUserAdminBypass(
  adminAuthUserId: string,
  staffUser: BypassStaffUser,
  workerAuthUserId: string,
  switchGrant?: string | null,
): AdminClockInBypass {
  return {
    sessionAuthUserId: workerAuthUserId,
    adminAuthUserId,
    mode: 'user',
    targetUserId: staffUser.userId,
    targetEmployeeId: staffUser.employeeId,
    targetDisplayName: staffUser.displayName,
    targetPhotoUrl: staffUser.photoUrl,
    targetInitials: deriveInitialsFromName(staffUser.displayName),
    switchGrant: switchGrant ?? null,
  };
}

export function resolveAdminSwitchGrant(adminAuthUserId: string): {
  switchGrant: string | null;
  sessionAuthUserId: string | null;
} {
  const bypass = readAdminClockInBypassRaw();
  if (bypass?.adminAuthUserId === adminAuthUserId) {
    return {
      switchGrant: bypass.switchGrant ?? null,
      sessionAuthUserId: bypass.sessionAuthUserId ?? null,
    };
  }
  return { switchGrant: null, sessionAuthUserId: null };
}
