import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { readCachedSupabaseSessionFromStorage } from './authBootstrap';

/**
 * Resolve the current auth user without network when possible.
 * Prefer AuthContext user → localStorage session → getSession() → optional refresh callback.
 */
export async function resolveSessionUser(
  contextUser?: User | null,
  tryRefresh?: () => Promise<boolean>,
): Promise<User | null> {
  if (contextUser?.id) return contextUser;

  const cached = readCachedSupabaseSessionFromStorage()?.user;
  if (cached?.id) return cached as User;

  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) return session.user;

  if (tryRefresh) {
    const recovered = await tryRefresh();
    if (recovered) {
      const { data: { session: retrySession } } = await supabase.auth.getSession();
      if (retrySession?.user) return retrySession.user;
    }
  }

  return null;
}
