import { useEffect, useRef } from 'react';
import { useAuthContext } from '../contexts/AuthContext';

type SessionRefetchFn = () => void | Promise<void>;

/**
 * Runs `fn` once Supabase has a hydrated session, and again after every token refresh
 * or visibility-driven refresh (`sessionRefreshNonce` from AuthContext).
 *
 * Use for PostgREST dropdowns, joined selects, and other reads that can return empty
 * under RLS when the client had not attached a user JWT yet. The global `fetch` wrapper
 * in `lib/supabase.ts` already retries 401s; this covers the “empty session / late hydrate” case.
 *
 * Pass stable identity via `extraDeps` when the fetch should also re-run for other reasons.
 */
export function useRefetchOnSupabaseSession(
  fn: SessionRefetchFn,
  extraDeps: unknown[] = []
): void {
  const { sessionRefreshNonce, supabaseSessionReady } = useAuthContext();
  const fnRef = useRef<SessionRefetchFn>(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!supabaseSessionReady) return;
    void Promise.resolve(fnRef.current());
    // sessionRefreshNonce + supabaseSessionReady intentionally drive refetch; fn kept in ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionRefreshNonce, supabaseSessionReady, ...extraDeps]);
}
