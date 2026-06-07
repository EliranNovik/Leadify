import { useState, useEffect, useCallback, useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { readCachedSupabaseSessionFromStorage } from '../lib/authBootstrap';

function parseSuperuserFlag(v: unknown): boolean {
  return v === true || v === 'true' || v === 1;
}

type CachedUserRole = { isAdmin: boolean; isSuperUser: boolean };

const USER_ROLE_CACHE_PREFIX = 'crm_user_role_v1_';
const userRoleModuleCache = new Map<string, CachedUserRole>();

function readCachedUserRole(userId: string): CachedUserRole | null {
  if (userRoleModuleCache.has(userId)) return userRoleModuleCache.get(userId)!;
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(USER_ROLE_CACHE_PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedUserRole;
    if (typeof parsed.isAdmin === 'boolean' && typeof parsed.isSuperUser === 'boolean') {
      userRoleModuleCache.set(userId, parsed);
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeCachedUserRole(userId: string, role: CachedUserRole): void {
  userRoleModuleCache.set(userId, role);
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(USER_ROLE_CACHE_PREFIX + userId, JSON.stringify(role));
  } catch {
    /* ignore */
  }
}

function clearCachedUserRole(userId: string): void {
  userRoleModuleCache.delete(userId);
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(USER_ROLE_CACHE_PREFIX + userId);
  } catch {
    /* ignore */
  }
}

function readInitialCachedRole(): CachedUserRole {
  const uid = readCachedSupabaseSessionFromStorage()?.user?.id;
  if (uid) {
    const cached = readCachedUserRole(String(uid));
    if (cached) return cached;
  }
  return { isAdmin: false, isSuperUser: false };
}

function deriveRoleFromRow(
  data: { role?: string | null; is_staff?: boolean | null; is_superuser?: unknown } | null,
): CachedUserRole {
  if (!data) return { isAdmin: false, isSuperUser: false };
  const isSuperUser = parseSuperuserFlag(data.is_superuser);
  const isAdmin = data.role === 'admin' || data.is_staff === true || isSuperUser;
  return { isAdmin, isSuperUser };
}

/** Same session resolution as Header so MobileBottomNav / Sidebar match desktop chrome. */
async function getAuthenticatedUser(): Promise<User | null> {
  let user = (await supabase.auth.getSession()).data?.session?.user ?? null;
  if (!user) {
    user = (await supabase.auth.getUser()).data?.user ?? null;
  }
  if (!user) {
    try {
      const { data: { session } } = await supabase.auth.refreshSession();
      if (session?.user) user = session.user;
    } catch (_) {
      /* ignore */
    }
  }
  if (!user) {
    for (const delayMs of [50, 200]) {
      await new Promise((r) => setTimeout(r, delayMs));
      const session = (await supabase.auth.getSession()).data?.session;
      if (session?.user) {
        user = session.user;
        break;
      }
    }
  }
  return user;
}

/**
 * Prefer auth_id (matches Header); fall back to exact email. Avoids ilike-only mismatches.
 */
async function fetchUsersRoleRow(user: User) {
  const byAuth = await supabase
    .from('users')
    .select('role, is_staff, is_superuser')
    .eq('auth_id', user.id)
    .maybeSingle();

  if (!byAuth.error && byAuth.data) {
    return { data: byAuth.data, error: null as null };
  }

  if (user.email) {
    const byEmail = await supabase
      .from('users')
      .select('role, is_staff, is_superuser')
      .eq('email', user.email)
      .maybeSingle();
    if (!byEmail.error && byEmail.data) {
      return { data: byEmail.data, error: null as null };
    }
    return { data: null, error: byEmail.error };
  }

  return { data: null, error: byAuth.error };
}

export const useAdminRole = () => {
  const initialRole = readInitialCachedRole();
  const [isAdmin, setIsAdmin] = useState(initialRole.isAdmin);
  const [isSuperUser, setIsSuperUser] = useState(initialRole.isSuperUser);
  const [isLoading, setIsLoading] = useState(false);
  const lastUserIdRef = useRef<string | null>(null);

  const applyRole = useCallback((role: CachedUserRole) => {
    setIsAdmin(role.isAdmin);
    setIsSuperUser(role.isSuperUser);
  }, []);

  const checkAdminRole = useCallback(async () => {
    try {
      const user = await getAuthenticatedUser();

      if (!user) {
        setIsAdmin(false);
        setIsSuperUser(false);
        return;
      }

      const uid = String(user.id);
      lastUserIdRef.current = uid;
      const cached = readCachedUserRole(uid);
      // Show the cached role instantly (stage dropdown, nav, etc.) while we refresh in the background.
      if (cached) applyRole(cached);

      const { data, error } = await fetchUsersRoleRow(user);

      if (!error && data) {
        const role = deriveRoleFromRow(data);
        writeCachedUserRole(uid, role);
        applyRole(role);
        return;
      }

      // Row missing: sync then retry (same RPC as before)
      try {
        const { data: syncResult } = await supabase.rpc('create_user_if_missing', {
          user_email: user.email,
        });

        if (syncResult?.success && user.email) {
          const { data: retryData, error: retryError } = await fetchUsersRoleRow(user);
          if (!retryError && retryData) {
            const role = deriveRoleFromRow(retryData);
            writeCachedUserRole(uid, role);
            applyRole(role);
            return;
          }
        }
      } catch {
        /* non-fatal */
      }

      // Fetch failed — keep the cached role if we have one instead of flashing to false.
      if (!cached) applyRole({ isAdmin: false, isSuperUser: false });
    } catch {
      const uid = readCachedSupabaseSessionFromStorage()?.user?.id;
      const cached = uid ? readCachedUserRole(String(uid)) : null;
      if (!cached) applyRole({ isAdmin: false, isSuperUser: false });
    }
  }, [applyRole]);

  const refreshAdminStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      await checkAdminRole();
    } finally {
      setIsLoading(false);
    }
  }, [checkAdminRole]);

  useEffect(() => {
    void checkAdminRole();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        if (lastUserIdRef.current) {
          clearCachedUserRole(lastUserIdRef.current);
          lastUserIdRef.current = null;
        }
        applyRole({ isAdmin: false, isSuperUser: false });
        return;
      }
      if (
        event === 'SIGNED_IN' ||
        event === 'TOKEN_REFRESHED' ||
        event === 'INITIAL_SESSION' ||
        event === 'USER_UPDATED'
      ) {
        void checkAdminRole();
      }
    });

    return () => subscription.unsubscribe();
  }, [checkAdminRole, applyRole]);

  return { isAdmin, isSuperUser, isLoading, refreshAdminStatus };
};
