/**
 * Activity-aware Supabase session keep-alive.
 *
 * Goal: while the user keeps using the app (desktop or mobile), refresh the
 * session before the access token dies and periodically rotate the refresh
 * token so an active day does not end in a surprise logout.
 *
 * Does NOT disable auth expiry. Refresh-token lifetime is still enforced by
 * Supabase; configure a longer refresh expiry in the dashboard for multi-day
 * absences (see SESSION_EXPIRATION_SETUP.md).
 */

import type { Session } from '@supabase/supabase-js';
import { isExpectedNoSessionError, isNetworkError, supabase } from './supabase';
import { hasAnySupabaseAuthKey } from './authBootstrap';

/** Treat the user as "actively using the app" within this window. */
const RECENT_ACTIVITY_MS = 20 * 60 * 1000; // 20 minutes

/** While active, refresh at most this often (extends refresh-token window via rotation). */
const PROACTIVE_REFRESH_MIN_INTERVAL_MS = 25 * 60 * 1000; // 25 minutes

/** When recently active, refresh access token this many seconds before expiry. */
export const ACTIVE_ACCESS_REFRESH_BUFFER_SEC = 180; // 3 minutes

/** When idle, keep the existing tighter buffer. */
export const IDLE_ACCESS_REFRESH_BUFFER_SEC = 90;

const ACTIVITY_EVENTS: Array<keyof DocumentEventMap> = [
  'pointerdown',
  'keydown',
  'touchstart',
  'scroll',
];

let lastActivityAt = Date.now();
let lastSuccessfulRefreshAt = 0;
let activityTrackingStarted = false;
let activityThrottleTimer: ReturnType<typeof setTimeout> | null = null;
let refreshInFlight: Promise<'skipped' | 'refreshed' | 'failed'> | null = null;

export function markAuthActivity(now = Date.now()): void {
  lastActivityAt = now;
}

export function getLastAuthActivityAt(): number {
  return lastActivityAt;
}

export function wasRecentlyActive(withinMs: number = RECENT_ACTIVITY_MS): boolean {
  return Date.now() - lastActivityAt <= withinMs;
}

export function getAccessRefreshBufferSec(): number {
  return wasRecentlyActive() ? ACTIVE_ACCESS_REFRESH_BUFFER_SEC : IDLE_ACCESS_REFRESH_BUFFER_SEC;
}

function onActivityEvent(): void {
  // Throttle storage of activity timestamps (scroll is noisy).
  if (activityThrottleTimer) return;
  activityThrottleTimer = setTimeout(() => {
    activityThrottleTimer = null;
  }, 1500);
  markAuthActivity();
}

/**
 * Start listening for user interaction. Safe to call multiple times.
 * Call only in the browser when a user session exists.
 */
export function startAuthActivityTracking(): void {
  if (typeof document === 'undefined' || activityTrackingStarted) return;
  activityTrackingStarted = true;
  markAuthActivity();
  for (const eventName of ACTIVITY_EVENTS) {
    document.addEventListener(eventName, onActivityEvent, { passive: true, capture: true });
  }
}

export function stopAuthActivityTracking(): void {
  if (typeof document === 'undefined' || !activityTrackingStarted) return;
  activityTrackingStarted = false;
  for (const eventName of ACTIVITY_EVENTS) {
    document.removeEventListener(eventName, onActivityEvent, true);
  }
  if (activityThrottleTimer) {
    clearTimeout(activityThrottleTimer);
    activityThrottleTimer = null;
  }
}

function shouldProactiveRefreshWhileActive(now = Date.now()): boolean {
  if (!wasRecentlyActive()) return false;
  if (!lastSuccessfulRefreshAt) return true;
  return now - lastSuccessfulRefreshAt >= PROACTIVE_REFRESH_MIN_INTERVAL_MS;
}

/**
 * Refresh the Supabase session when needed.
 * - Near access-token expiry (buffer depends on recent activity)
 * - Or periodically while the user is actively using the app (refresh-token rotation)
 */
export async function refreshSessionIfNeeded(options?: {
  /** Force a refresh attempt even if buffers say skip (e.g. tab became visible). */
  forceIfNearExpiry?: boolean;
}): Promise<'skipped' | 'refreshed' | 'failed'> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error || !session?.user) {
        // Try one refresh if we still look logged-in from storage elsewhere.
        const { data: { session: refreshed }, error: refreshError } = await supabase.auth.refreshSession();
        if (!refreshError && refreshed?.user) {
          lastSuccessfulRefreshAt = Date.now();
          markAuthActivity();
          return 'refreshed';
        }
        return 'failed';
      }

      const expiresAtSec = typeof session.expires_at === 'number' ? session.expires_at : null;
      const nowSec = Math.floor(Date.now() / 1000);
      const bufferSec = getAccessRefreshBufferSec();
      const nearExpiry =
        !expiresAtSec ||
        expiresAtSec - nowSec <= bufferSec ||
        (options?.forceIfNearExpiry === true && expiresAtSec - nowSec <= ACTIVE_ACCESS_REFRESH_BUFFER_SEC);

      const proactive = shouldProactiveRefreshWhileActive();

      if (!nearExpiry && !proactive) {
        return 'skipped';
      }

      const { data: { session: refreshed }, error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError && refreshed?.user) {
        lastSuccessfulRefreshAt = Date.now();
        return 'refreshed';
      }
      return 'failed';
    } catch {
      return 'failed';
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * Resolve a usable session on cold resume paths (QR landing, deep links, bfcache restore).
 *
 * A single `getSession()` is not enough on phones: the tab is usually reopened with an
 * expired access token while the network is still switching (cellular → office Wi-Fi), so
 * the very first refresh can fail even though the stored refresh token is fine. Retry with
 * backoff and only report "signed out" when storage has no auth keys or Supabase says the
 * refresh token itself is invalid/expired.
 */
export async function resolveSessionWithRecovery(options?: {
  attempts?: number;
  baseDelayMs?: number;
}): Promise<Session | null> {
  const attempts = Math.max(1, options?.attempts ?? 3);
  const baseDelayMs = options?.baseDelayMs ?? 350;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (session?.user) return session;

    // Nothing stored at all → the user really is signed out on this device/browser.
    if (!error && !hasAnySupabaseAuthKey()) return null;

    try {
      const { data: { session: refreshed }, error: refreshError } =
        await supabase.auth.refreshSession();
      if (refreshed?.user) {
        lastSuccessfulRefreshAt = Date.now();
        markAuthActivity();
        return refreshed;
      }
      // Definitive rejection of the stored refresh token — retrying cannot help.
      if (refreshError && !isNetworkError(refreshError) && isExpectedNoSessionError(refreshError)) {
        return null;
      }
    } catch (e) {
      if (!isNetworkError(e) && isExpectedNoSessionError(e)) return null;
    }

    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (attempt + 1)));
    }
  }

  const { data: { session: last } } = await supabase.auth.getSession();
  return last?.user ? last : null;
}
