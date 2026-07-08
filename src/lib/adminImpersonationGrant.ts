const GRANT_STORAGE_KEY = 'admin_impersonation_grant_v1';

export type AdminImpersonationGrant = {
  adminAuthUserId: string;
  switchGrant: string;
};

export function writeAdminImpersonationGrant(grant: AdminImpersonationGrant): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(GRANT_STORAGE_KEY, JSON.stringify(grant));
  } catch {
    // ignore
  }
}

export function readAdminImpersonationGrant(adminAuthUserId?: string): AdminImpersonationGrant | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(GRANT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AdminImpersonationGrant;
      if (parsed?.adminAuthUserId && parsed?.switchGrant) {
        if (!adminAuthUserId || parsed.adminAuthUserId === adminAuthUserId) {
          return parsed;
        }
      }
    }
  } catch {
    // ignore
  }

  if (!adminAuthUserId) return null;

  try {
    const bypassRaw = sessionStorage.getItem('admin_clock_in_bypass_v1');
    if (!bypassRaw) return null;
    const bypass = JSON.parse(bypassRaw) as {
      adminAuthUserId?: string;
      switchGrant?: string | null;
    };
    if (
      bypass?.adminAuthUserId === adminAuthUserId &&
      typeof bypass.switchGrant === 'string' &&
      bypass.switchGrant.trim()
    ) {
      return {
        adminAuthUserId,
        switchGrant: bypass.switchGrant,
      };
    }
  } catch {
    // ignore
  }

  return null;
}

export function clearAdminImpersonationGrant(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(GRANT_STORAGE_KEY);
  } catch {
    // ignore
  }
}
