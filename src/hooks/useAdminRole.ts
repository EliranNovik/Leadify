import { useState, useEffect, useCallback } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

function parseSuperuserFlag(v: unknown): boolean {
  return v === true || v === 'true' || v === 1;
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

function applyRoleRow(
  data: { role?: string | null; is_staff?: boolean | null; is_superuser?: unknown } | null,
  setIsAdmin: (v: boolean) => void,
  setIsSuperUser: (v: boolean) => void
) {
  if (!data) {
    setIsAdmin(false);
    setIsSuperUser(false);
    return;
  }
  const superUserStatus = parseSuperuserFlag(data.is_superuser);
  const adminStatus =
    data.role === 'admin' || data.is_staff === true || superUserStatus;
  setIsAdmin(adminStatus);
  setIsSuperUser(superUserStatus);
}

export const useAdminRole = () => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperUser, setIsSuperUser] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const checkAdminRole = useCallback(async () => {
    try {
      const user = await getAuthenticatedUser();

      if (!user) {
        setIsAdmin(false);
        setIsSuperUser(false);
        return;
      }

      const { data, error } = await fetchUsersRoleRow(user);

      if (!error && data) {
        applyRoleRow(data, setIsAdmin, setIsSuperUser);
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
            applyRoleRow(retryData, setIsAdmin, setIsSuperUser);
            return;
          }
        }
      } catch {
        /* non-fatal */
      }

      setIsAdmin(false);
      setIsSuperUser(false);
    } catch {
      setIsAdmin(false);
      setIsSuperUser(false);
    }
  }, []);

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
      if (
        event === 'SIGNED_IN' ||
        event === 'SIGNED_OUT' ||
        event === 'TOKEN_REFRESHED' ||
        event === 'INITIAL_SESSION' ||
        event === 'USER_UPDATED'
      ) {
        void checkAdminRole();
      }
    });

    return () => subscription.unsubscribe();
  }, [checkAdminRole]);

  return { isAdmin, isSuperUser, isLoading, refreshAdminStatus };
};
