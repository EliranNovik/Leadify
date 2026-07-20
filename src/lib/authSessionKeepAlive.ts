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

import { supabase } from './supabase';

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
