/**
 * Synchronous auth bootstrap helpers: read Supabase session from localStorage
 * and persist display name so first paint after refresh shows name (not email).
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';

/** Persisted per auth user id (localStorage — shared across tabs + survives refresh). */
export const AUTH_DISPLAY_STORAGE_PREFIX = 'crm_auth_display_v1_';

export function parseSupabaseAuthStorageValue(raw: string): { user: any; access_token?: string; expires_at?: number } | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.currentSession?.user) return parsed.currentSession;
    if (parsed.session?.user) return parsed.session;
    if (parsed.user && typeof parsed.user === 'object' && parsed.access_token) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function readCachedSupabaseSessionFromStorage(): { user: any; access_token?: string; expires_at?: number } | null {
  if (typeof window === 'undefined') return null;
  try {
    const keyFromUrl = `sb-${supabaseUrl.split('//')[1]?.split('.')[0]}-auth-token`;
    const keysToTry = new Set<string>();
    if (keyFromUrl) keysToTry.add(keyFromUrl);
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.includes('supabase.auth.token') || (k.startsWith('sb-') && k.includes('-auth-token')))) {
        keysToTry.add(k);
      }
    }
    for (const key of keysToTry) {
      const cached = localStorage.getItem(key);
      if (!cached) continue;
      const session = parseSupabaseAuthStorageValue(cached);
      if (session?.user) return session;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function hasAnySupabaseAuthKey(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.includes('supabase.auth.token') || (k.startsWith('sb-') && k.includes('-auth-token')))) {
        return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function readAuthDisplayCache(userId: string): {
  userFullName: string;
  userInitials: string;
  profilePhotoUrl: string | null;
} | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTH_DISPLAY_STORAGE_PREFIX + userId);
    if (!raw) return null;
    const d = JSON.parse(raw) as {
      userFullName?: string;
      userInitials?: string;
      profilePhotoUrl?: string | null;
    };
    if (d?.userFullName && typeof d.userFullName === 'string' && d.userFullName.trim() !== '') {
      const userFullName = d.userFullName.trim();
      const userInitials =
        typeof d.userInitials === 'string' && d.userInitials.trim() !== ''
          ? d.userInitials.trim().toUpperCase()
          : deriveInitialsFromDisplayName(userFullName);
      const profilePhotoUrl =
        typeof d.profilePhotoUrl === 'string' && d.profilePhotoUrl.trim() !== ''
          ? d.profilePhotoUrl.trim()
          : null;
      return { userFullName, userInitials, profilePhotoUrl };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function deriveInitialsFromDisplayName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  if (parts.length === 1 && parts[0].length >= 2) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (name[0] || 'U').toUpperCase();
}

/**
 * @param profilePhotoUrl - Resolved employee/profile image URL. `undefined` = keep previous value in storage; `null` = clear stored photo.
 */
export function writeAuthDisplayCache(
  userId: string,
  userFullName: string,
  userInitials: string,
  profilePhotoUrl?: string | null
): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    let photoOut: string | null = null;
    if (profilePhotoUrl !== undefined) {
      photoOut =
        typeof profilePhotoUrl === 'string' && profilePhotoUrl.trim() !== ''
          ? profilePhotoUrl.trim()
          : null;
    } else {
      try {
        const raw = localStorage.getItem(AUTH_DISPLAY_STORAGE_PREFIX + userId);
        if (raw) {
          const d = JSON.parse(raw) as { profilePhotoUrl?: string | null };
          if (typeof d?.profilePhotoUrl === 'string' && d.profilePhotoUrl.trim() !== '') {
            photoOut = d.profilePhotoUrl.trim();
          }
        }
      } catch {
        /* ignore */
      }
    }
    localStorage.setItem(
      AUTH_DISPLAY_STORAGE_PREFIX + userId,
      JSON.stringify({
        userFullName,
        userInitials,
        profilePhotoUrl: photoOut,
        savedAt: Date.now(),
      })
    );
  } catch {
    /* quota / private mode */
  }
}

export function clearAuthDisplayCache(userId: string): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    localStorage.removeItem(AUTH_DISPLAY_STORAGE_PREFIX + userId);
  } catch {
    /* ignore */
  }
}

/** Header / shell: sync display name for first paint (same tab refresh). */
export function readBootstrappedDisplayName(): string | null {
  const session = readCachedSupabaseSessionFromStorage();
  const uid = session?.user?.id;
  if (!uid) return null;
  return readAuthDisplayCache(uid)?.userFullName ?? null;
}

/** Header / shell: sync profile photo URL for first paint (browser may still decode from HTTP cache). */
export function readBootstrappedProfilePhotoUrl(): string | null {
  const session = readCachedSupabaseSessionFromStorage();
  const uid = session?.user?.id;
  if (!uid) return null;
  return readAuthDisplayCache(uid)?.profilePhotoUrl ?? null;
}
