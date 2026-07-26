/**
 * Persist where to send the user after login.
 * Used by entry-kiosk QR clock-in so sign-in (password or magic link)
 * returns to `/clock-in/entry?…` instead of the CRM gate.
 */

const STORAGE_KEY = 'crm_post_login_redirect';
const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

type StoredRedirect = {
  path: string;
  savedAt: number;
};

export function isSafeInternalPath(path: unknown): path is string {
  return (
    typeof path === 'string'
    && path.startsWith('/')
    && !path.startsWith('//')
    && !path.includes('://')
  );
}

export function persistPostLoginRedirect(path: string): void {
  if (typeof window === 'undefined' || !isSafeInternalPath(path)) return;
  try {
    const payload: StoredRedirect = { path, savedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearPostLoginRedirect(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Read and clear a previously persisted redirect (if still fresh). */
export function consumePostLoginRedirect(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRedirect;
    if (!isSafeInternalPath(parsed?.path)) return null;
    if (!Number.isFinite(parsed.savedAt) || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      return null;
    }
    return parsed.path;
  } catch {
    clearPostLoginRedirect();
    return null;
  }
}

/**
 * Resolve post-login destination from (in order):
 * location.state.from → ?redirect= → persisted localStorage → `/`
 * Clears storage once a path is chosen so it is not reused on a later login.
 */
export function resolvePostLoginPath(options?: {
  stateFrom?: unknown;
  searchRedirect?: string | null;
}): string {
  const fromState = options?.stateFrom;
  if (isSafeInternalPath(fromState)) {
    clearPostLoginRedirect();
    return fromState;
  }

  const redirect = options?.searchRedirect ?? null;
  if (isSafeInternalPath(redirect)) {
    clearPostLoginRedirect();
    return redirect;
  }

  return consumePostLoginRedirect() || '/';
}

/** Absolute URL for Supabase emailRedirectTo (magic link / OTP). */
export function buildAuthEmailRedirectTo(internalPath: string): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://rainmakerqueen.org';
  const path = isSafeInternalPath(internalPath) ? internalPath : '/';
  return `${origin.replace(/\/$/, '')}${path}`;
}
