/** Shared user role flags — used by AuthContext and useAdminRole cache. */

export const USER_ROLE_CACHE_PREFIX = 'crm_user_role_v1_';

export type CachedUserRole = { isAdmin: boolean; isSuperUser: boolean };

export function parseSuperuserFlag(v: unknown): boolean {
  return v === true || v === 'true' || v === 1;
}

export function deriveRoleFromUserRow(
  data: { role?: string | null; is_staff?: boolean | null; is_superuser?: unknown } | null,
): CachedUserRole {
  if (!data) return { isAdmin: false, isSuperUser: false };
  const isSuperUser = parseSuperuserFlag(data.is_superuser);
  const isAdmin = data.role === 'admin' || data.is_staff === true || isSuperUser;
  return { isAdmin, isSuperUser };
}

export function readCachedUserRole(userId: string): CachedUserRole | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(USER_ROLE_CACHE_PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedUserRole;
    if (typeof parsed.isAdmin === 'boolean' && typeof parsed.isSuperUser === 'boolean') {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function writeCachedUserRole(userId: string, role: CachedUserRole): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    localStorage.setItem(USER_ROLE_CACHE_PREFIX + userId, JSON.stringify(role));
  } catch {
    /* ignore */
  }
}

export function clearCachedUserRole(userId: string): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    localStorage.removeItem(USER_ROLE_CACHE_PREFIX + userId);
  } catch {
    /* ignore */
  }
}
