import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase, sessionManager, isAuthError, isExpectedNoSessionError, handleSessionExpiration } from '../lib/supabase';
import { preCheckExternalUser } from '../hooks/useExternalUser';
import {
  readCachedSupabaseSessionFromStorage,
  hasAnySupabaseAuthKey,
  readAuthDisplayCache,
  writeAuthDisplayCache,
  clearAuthDisplayCache,
  deriveInitialsFromDisplayName,
} from '../lib/authBootstrap';

const USER_DETAIL_SELECT =
  'first_name, last_name, full_name, email, tenants_employee!employee_id(photo_url, photo)';

const DEBUG_AUTH = String(import.meta.env.VITE_DEBUG_AUTH || '').toLowerCase() === 'true';
const debugLog = (...args: any[]) => {
  if (!DEBUG_AUTH) return;
  // eslint-disable-next-line no-console
  console.log(...args);
};

function profilePhotoFromUsersRow(data: {
  tenants_employee?: { photo_url?: string | null; photo?: string | null } | null;
}): string | null {
  const emp = data?.tenants_employee;
  if (!emp || typeof emp !== 'object') return null;
  const a = emp.photo_url;
  const b = emp.photo;
  const s =
    (typeof a === 'string' && a.trim()) || (typeof b === 'string' && b.trim()) || '';
  return s || null;
}

// Helper to check if error is a network/transient error (not a real auth failure)
const isNetworkError = (error: any): boolean => {
  if (!error) return false;
  const errorMsg = String(error.message || error).toLowerCase();
  return (
    errorMsg.includes('network') ||
    errorMsg.includes('timeout') ||
    errorMsg.includes('fetch') ||
    errorMsg.includes('connection') ||
    errorMsg.includes('failed to fetch') ||
    (error.status !== undefined && error.status === 0) || // Network error status
    error.code === 'ECONNABORTED' ||
    error.code === 'ETIMEDOUT'
  );
};

function buildSyncInitialAuthState(): AuthState {
  const empty: AuthState = {
    user: null,
    userFullName: null,
    userInitials: null,
    profilePhotoUrl: null,
    isLoading: false,
    isInitialized: true,
    sessionCheckComplete: false,
    supabaseSessionReady: false,
    sessionRefreshNonce: 0,
  };
  if (typeof window === 'undefined') return empty;

  const session = readCachedSupabaseSessionFromStorage();
  if (session?.user) {
    const u = session.user;
    const email = ((u.email as string) || '').trim();
    const display = u.id ? readAuthDisplayCache(String(u.id)) : null;
    const userFullName = display?.userFullName || email || null;
    const userInitials =
      display?.userInitials || (userFullName ? deriveInitialsFromDisplayName(userFullName) : null);
    const profilePhotoUrl = display?.profilePhotoUrl ?? null;
    return {
      user: u,
      userFullName,
      userInitials,
      profilePhotoUrl,
      isLoading: false,
      isInitialized: true,
      sessionCheckComplete: true,
      // Cache hydrate allows instant UI, but does not guarantee Supabase has attached JWT yet.
      supabaseSessionReady: false,
      sessionRefreshNonce: 0,
    };
  }

  if (!hasAnySupabaseAuthKey()) {
    return {
      ...empty,
      sessionCheckComplete: true,
    };
  }

  return empty;
}

interface AuthState {
  user: any;
  userFullName: string | null;
  userInitials: string | null;
  /** Cached employee/profile image URL for instant avatar after refresh */
  profilePhotoUrl: string | null;
  isLoading: boolean;
  isInitialized: boolean;
  /** True only after Supabase INITIAL_SESSION has been processed. Used to avoid redirecting before we know session state. */
  sessionCheckComplete: boolean;
  /** True only after Supabase has a confirmed hydrated session for this tab. */
  supabaseSessionReady: boolean;
  /** Bumped after token refresh / visibility refresh so consumers (e.g. Header) refetch profile once. */
  sessionRefreshNonce: number;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

function useAuthContext() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
}

export { useAuthContext };

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Refs must be set synchronously when we hydrate from localStorage so INITIAL_SESSION(null)
  // (can fire as soon as onAuthStateChange registers) never clears the user — fixes new tabs / Chrome.
  const processingRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);
  const restoredFromStorageRef = useRef(false);
  const restoredFromCacheRef = useRef(false);
  const syncHydratedRef = useRef(false);

  const [authState, setAuthState] = useState<AuthState>(() => {
    const initial = buildSyncInitialAuthState();
    if (initial.user) {
      syncHydratedRef.current = true;
      restoredFromCacheRef.current = true;
      lastUserIdRef.current = initial.user.id ?? null;
    }
    return initial;
  });

  const markSupabaseSessionReady = useCallback((ready: boolean) => {
    setAuthState((prev) => {
      if (prev.supabaseSessionReady === ready) return prev;
      return { ...prev, supabaseSessionReady: ready };
    });
  }, []);

  const fetchUserDetails = useCallback(async (user: any) => {
    if (!user?.id) return;

    try {
      // Match by auth_id (Supabase auth user ID) - more reliable than email
      // Use maybeSingle() instead of single() to handle cases where user doesn't exist in users table
      // This prevents errors when auth user exists but users table record is missing
      let { data, error } = await supabase
        .from('users')
        .select(USER_DETAIL_SELECT)
        .eq('auth_id', user.id)
        .maybeSingle();

      // Fallback to email if not found by auth_id (for backwards compatibility)
      if ((error || !data) && user.email) {
        const { data: userByEmail, error: emailError } = await supabase
          .from('users')
          .select(USER_DETAIL_SELECT)
          .eq('email', user.email)
          .maybeSingle();
        
        if (!emailError && userByEmail) {
          data = userByEmail;
          error = null;
        }
      }

      if (!error && data) {
        let fullName: string;
        let initials: string;

        if (data.first_name && data.last_name && data.first_name.trim() && data.last_name.trim()) {
          fullName = `${data.first_name.trim()} ${data.last_name.trim()}`;
          initials = `${data.first_name[0]}${data.last_name[0]}`.toUpperCase();
        } else if (data.full_name && data.full_name.trim()) {
          fullName = data.full_name.trim();
          initials = data.full_name.split(' ').map((n: string) => n[0]).join('').toUpperCase();
        } else {
          fullName = data.email || user.email || 'User';
          initials = (data.email || user.email || 'U')[0].toUpperCase();
        }

        const photoUrl = profilePhotoFromUsersRow(data as any);
        writeAuthDisplayCache(user.id, fullName, initials, photoUrl);
        setAuthState(prev => ({
          ...prev,
          userFullName: fullName,
          userInitials: initials,
          profilePhotoUrl: photoUrl,
        }));
      } else {
        // Fallback to auth user metadata
        const authName = user.user_metadata?.first_name || user.user_metadata?.full_name || user.email || 'User';
        const metaInitials = authName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || authName[0].toUpperCase();
        writeAuthDisplayCache(user.id, authName, metaInitials, undefined);
        setAuthState(prev => ({
          ...prev,
          userFullName: authName,
          userInitials: metaInitials,
        }));
      }
    } catch (error) {
      console.error('Error fetching user details:', error);
      // Fallback to email or default
      const fallbackName = user.email || 'User';
      const fi = fallbackName[0]?.toUpperCase() || 'U';
      writeAuthDisplayCache(user.id, fallbackName, fi, undefined);
      setAuthState(prev => ({
        ...prev,
        userFullName: fallbackName,
        userInitials: fi,
      }));
    }
  }, []);

  const updateAuthState = useCallback((session: any, isInitialized: boolean = true) => {
    // Prevent duplicate updates for the same user
    const userId = session?.user?.id || null;

    debugLog('[AuthContext] updateAuthState called, userId:', userId, 'isInitialized:', isInitialized);

    // Use functional update to avoid dependency on authState
    setAuthState(prev => {
      // Prevent duplicate updates for the same user, but allow updates when:
      // 1. User changes (sign in/out)
      // 2. State is not yet initialized
      // 3. User goes from null to a user (sign in)
      const userChanged = prev.user?.id !== userId;
      const isSignIn = !prev.user && userId; // Going from no user to a user

      debugLog('[AuthContext] updateAuthState check:', {
        userChanged,
        isSignIn,
        prevUserId: prev.user?.id,
        newUserId: userId,
        prevInitialized: prev.isInitialized,
        lastUserIdRef: lastUserIdRef.current
      });

      if (!userChanged && !isSignIn && prev.isInitialized && userId === lastUserIdRef.current) {
        debugLog('[AuthContext] Skipping duplicate update');
        return prev; // No change needed - same user, already initialized
      }

      debugLog('[AuthContext] Updating auth state with user:', userId);
      lastUserIdRef.current = userId;

      if (session?.user) {
        // Check if session is expired
        if (sessionManager.isSessionExpired(session)) {
          debugLog('Session is expired - logging out');
          // Only sign out if we actually had a user
          if (prev.user) {
            const uid = prev.user.id;
            if (uid) clearAuthDisplayCache(String(uid));
            supabase.auth.signOut().then(() => {
              if (typeof window !== 'undefined') {
                window.location.href = '/login';
              }
            });
          }
          return {
            ...prev,
            user: null,
            userFullName: null,
            userInitials: null,
            profilePhotoUrl: null,
            isLoading: false,
            isInitialized: true,
            sessionRefreshNonce: 0,
          };
        }

        // Always refresh from API in background (display cache already prevents email flash on first paint)
        if (session.user) {
          fetchUserDetails(session.user);
        }

        const uid = session.user.id ? String(session.user.id) : '';
        const display = uid ? readAuthDisplayCache(uid) : null;
        const email = (session.user.email as string) || '';
        const tempName = display?.userFullName || email;
        const tempInitials =
          display?.userInitials || (tempName ? deriveInitialsFromDisplayName(tempName) : '');
        const tempPhoto = display?.profilePhotoUrl ?? null;

        return {
          ...prev,
          user: session.user,
          userFullName: prev.userFullName || tempName || null,
          userInitials: prev.userInitials || tempInitials || null,
          profilePhotoUrl: prev.profilePhotoUrl ?? tempPhoto,
          isLoading: false,
          isInitialized,
          // Do NOT set supabaseSessionReady here; cached sessions can call updateAuthState before
          // Supabase actually re-attaches a JWT for this tab. Ready is flipped only after a real
          // getSession()/INITIAL_SESSION/refreshSession confirms hydration.
          supabaseSessionReady: prev.supabaseSessionReady,
        };
      } else {
        // Only clear state if we actually had a user before
        // This prevents clearing state on initial load when there's no session
        if (!prev.user && prev.isInitialized) {
          return prev; // Already cleared, no change needed
        }

        // Only clear if we're sure the user is signed out
        return {
          ...prev,
          user: null,
          userFullName: null,
          userInitials: null,
          profilePhotoUrl: null,
          isLoading: false,
          isInitialized,
          supabaseSessionReady: false,
          sessionRefreshNonce: 0,
        };
      }
    });
  }, [fetchUserDetails]);

  const handleAuthStateChange = useCallback(async (event: string, session: any) => {
    debugLog('[AuthContext] Auth state change event:', event, 'Session:', session?.user?.id || 'no user');

    // Always process SIGNED_IN events immediately, even if processing
    // This ensures sign-in works correctly
    if (event === 'SIGNED_IN') {
      debugLog('[AuthContext] Processing SIGNED_IN event, updating auth state');
      // Ensure sessionStorage flag is set
      if (typeof window !== 'undefined' && session?.user) {
        sessionStorage.setItem('user_signed_in', 'true');
        sessionStorage.setItem('user_signed_in_timestamp', Date.now().toString());
      }
      updateAuthState(session, true);
      // SIGNED_IN must also unblock ProtectedRoute immediately.
      // Some environments won't emit INITIAL_SESSION after an interactive sign-in redirect,
      // and ProtectedRoute waits on `supabaseSessionReady`.
      setAuthState((prev) => ({ ...prev, sessionCheckComplete: true }));
      markSupabaseSessionReady(true);
      if (session?.user?.id) {
        preCheckExternalUser(session.user.id).catch(err => {
          console.error('Error pre-checking external user:', err);
        });
      }
      return;
    }

    // Prevent concurrent processing for other events
    if (processingRef.current) {
      return;
    }

    processingRef.current = true;

    try {
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
        // For INITIAL_SESSION, ensure we mark as initialized
        updateAuthState(session, true);

        // Pre-check external user status in the background
        // This ensures the check is ready when the dashboard loads
        if (session?.user?.id) {
          preCheckExternalUser(session.user.id).catch(err => {
            console.error('Error pre-checking external user:', err);
          });
        }
      } else if (event === 'SIGNED_OUT') {
        // Clear sessionStorage flag
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('user_signed_in');
          sessionStorage.removeItem('user_signed_in_timestamp');
        }
        // Only clear if we actually had a user
        setAuthState(prev => {
          if (!prev.user) {
            return prev; // Already cleared
          }
          const uid = prev.user.id;
          if (uid) clearAuthDisplayCache(String(uid));
          lastUserIdRef.current = null;
          return {
            ...prev,
            user: null,
            userFullName: null,
            userInitials: null,
            profilePhotoUrl: null,
            isLoading: false,
            isInitialized: true,
            supabaseSessionReady: false,
            sessionRefreshNonce: 0,
          };
        });
        // Don't redirect here - let the component handle it
      } else if (event === 'USER_UPDATED' && session?.user) {
        // Only update if user actually changed
        if (lastUserIdRef.current !== session.user.id) {
          updateAuthState(session, true);
        }
      }
    } finally {
      // Reset processing flag after a short delay
      setTimeout(() => {
        processingRef.current = false;
      }, 100);
    }
  }, [updateAuthState]);

  // Single debounced visibility refresh (avoids duplicate work with Header; Chrome/Safari friendly)
  const visibilityDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibilityRefreshInFlight = useRef(false);

  useEffect(() => {
    if (typeof document === 'undefined' || !authState.user) return;

    const VISIBILITY_DEBOUNCE_MS = 450;

    const runRefresh = async () => {
      if (document.visibilityState !== 'visible' || visibilityRefreshInFlight.current) return;
      visibilityRefreshInFlight.current = true;
      try {
        const { data: { session }, error } = await supabase.auth.refreshSession();
        if (!error && session?.user) {
          updateAuthState(session, true);
          await fetchUserDetails(session.user).catch(() => {});
          setAuthState((prev) => ({
            ...prev,
            sessionRefreshNonce: prev.sessionRefreshNonce + 1,
          }));
        }
      } catch {
        /* non-fatal */
      } finally {
        visibilityRefreshInFlight.current = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (visibilityDebounceRef.current) clearTimeout(visibilityDebounceRef.current);
      visibilityDebounceRef.current = setTimeout(() => {
        visibilityDebounceRef.current = null;
        void runRefresh();
      }, VISIBILITY_DEBOUNCE_MS);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (visibilityDebounceRef.current) clearTimeout(visibilityDebounceRef.current);
    };
  }, [authState.user, updateAuthState, fetchUserDetails]);

  // Proactive session watchdog:
  // - checks session periodically (no user action needed)
  // - refreshes shortly before expiry
  // - signs out automatically on confirmed unrecoverable auth state
  useEffect(() => {
    if (!authState.user) return;

    let isMounted = true;
    let checkInFlight = false;
    let consecutiveAuthFailures = 0;
    const MAX_CONSECUTIVE_AUTH_FAILURES = 2;
    const CHECK_INTERVAL_MS = 60000; // 1 minute
    const REFRESH_BUFFER_SEC = 90; // refresh when <90s to expiry

    const maybeExpireSession = async () => {
      if (!isMounted) return;
      consecutiveAuthFailures += 1;
      if (consecutiveAuthFailures < MAX_CONSECUTIVE_AUTH_FAILURES) return;
      await handleSessionExpiration();
    };

    const runWatchdogCheck = async () => {
      if (!isMounted || checkInFlight) return;
      checkInFlight = true;
      try {
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          if (isNetworkError(error)) {
            // Transient connectivity issues should not force sign-out.
            return;
          }
          if (isAuthError(error)) {
            await maybeExpireSession();
          }
          return;
        }

        if (session?.user) {
          consecutiveAuthFailures = 0;

          const expiresAtSec = typeof session.expires_at === 'number' ? session.expires_at : null;
          const nowSec = Math.floor(Date.now() / 1000);
          const shouldRefreshSoon = !!expiresAtSec && expiresAtSec - nowSec <= REFRESH_BUFFER_SEC;

          if (shouldRefreshSoon) {
            const { data: { session: refreshed }, error: refreshError } = await supabase.auth.refreshSession();
            if (!refreshError && refreshed?.user) {
              updateAuthState(refreshed, true);
              setAuthState((prev) => ({
                ...prev,
                sessionRefreshNonce: prev.sessionRefreshNonce + 1,
              }));
              consecutiveAuthFailures = 0;
              return;
            }
            if (refreshError && !isNetworkError(refreshError)) {
              await maybeExpireSession();
            }
          }
          return;
        }

        // Missing session while app still thinks user is signed in.
        const hasTokens = hasAnySupabaseAuthKey();
        if (hasTokens) {
          const { data: { session: refreshed }, error: refreshError } = await supabase.auth.refreshSession();
          if (!refreshError && refreshed?.user) {
            updateAuthState(refreshed, true);
            setAuthState((prev) => ({
              ...prev,
              sessionRefreshNonce: prev.sessionRefreshNonce + 1,
            }));
            consecutiveAuthFailures = 0;
            return;
          }
          if (refreshError && isNetworkError(refreshError)) {
            return;
          }
        }

        await maybeExpireSession();
      } catch (e) {
        if (!isNetworkError(e) && isAuthError(e)) {
          await maybeExpireSession();
        }
      } finally {
        checkInFlight = false;
      }
    };

    const interval = setInterval(() => {
      void runWatchdogCheck();
    }, CHECK_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void runWatchdogCheck();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    void runWatchdogCheck();

    return () => {
      isMounted = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authState.user, updateAuthState]);

  // Initialize auth state - INSTANT initialization using cached session
  useEffect(() => {
    let subscription: any = null;
    let isMounted = true;
    let storageListener: ((e: StorageEvent) => void) | null = null;
    let initHandled = false;
    let sessionCheckFallbackTimeout: ReturnType<typeof setTimeout> | null = null;
    const storageCheckTimeouts = new Map<string, NodeJS.Timeout>();

    const initializeAuth = async () => {
      try {
        const cachedSession = readCachedSupabaseSessionFromStorage();

        if (syncHydratedRef.current && authState.user?.id) {
          // First paint already hydrated from buildSyncInitialAuthState — avoid duplicate updateAuthState
          lastUserIdRef.current = authState.user.id;
          restoredFromCacheRef.current = true;
          fetchUserDetails(authState.user).catch(() => {});
          debugLog('[AuthContext] Sync-hydrated session (first paint); background user details only');
          // above log moved behind debug flag

          // Confirm Supabase has hydrated session for this tab (real getSession()).
          const t0 = DEBUG_AUTH && typeof performance !== 'undefined' ? performance.now() : 0;
          supabase.auth.getSession().then(({ data: { session } }) => {
            if (!isMounted) return;
            if (session?.user) {
              markSupabaseSessionReady(true);
              if (DEBUG_AUTH) {
                const dt =
                  (typeof performance !== 'undefined' ? performance.now() : Date.now()) - (t0 || 0);
                console.log(`[AUTH-DEBUG] getSession() confirmed user after sync hydrate in ${dt.toFixed(1)}ms`);
              }
            }
          }).catch(() => {});
        } else if (cachedSession?.user) {
          debugLog('[AuthContext] Using cached session for instant initialization');
          restoredFromCacheRef.current = true;
          updateAuthState(cachedSession, true);
          setAuthState(prev => ({ ...prev, sessionCheckComplete: true }));
          fetchUserDetails(cachedSession.user).catch(() => {});

          // Confirm Supabase has hydrated session for this tab (real getSession()).
          const t0 = DEBUG_AUTH && typeof performance !== 'undefined' ? performance.now() : 0;
          supabase.auth.getSession().then(({ data: { session } }) => {
            if (!isMounted) return;
            if (session?.user) {
              markSupabaseSessionReady(true);
              if (DEBUG_AUTH) {
                const dt =
                  (typeof performance !== 'undefined' ? performance.now() : Date.now()) - (t0 || 0);
                console.log(`[AUTH-DEBUG] getSession() confirmed user after cached session in ${dt.toFixed(1)}ms`);
              }
            }
          }).catch(() => {});
        } else {
          // Even if no cached session, check localStorage for tokens
          // This helps with mobile browsers that might have cleared the cached session
          // but still have tokens stored
          if (typeof window !== 'undefined') {
            try {
              let hasStoredTokens = false;
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (key.includes('supabase.auth.token') || (key.includes('sb-') && key.includes('-auth-token')))) {
                  hasStoredTokens = true;
                  break;
                }
              }
              
              if (hasStoredTokens) {
                debugLog('[AuthContext] Found stored tokens, trying getSession() for deployed env...');
                // In production INITIAL_SESSION can fire with null; getSession() reads storage directly and is more reliable
                const { data: { session } } = await supabase.auth.getSession();
                if (isMounted && session?.user) {
                  restoredFromStorageRef.current = true;
                  updateAuthState(session, true);
                  setAuthState(prev => ({ ...prev, sessionCheckComplete: true }));
                  markSupabaseSessionReady(true);
                }
              }
            } catch (e) {
              // localStorage access failed - might be private mode
              console.warn('[AuthContext] Could not check localStorage:', e);
            }
          }
        }

        // Set up auth state change listener - INITIAL_SESSION should fire immediately
        const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
          debugLog('[AuthContext] onAuthStateChange fired:', event, 'Session:', session?.user?.id || 'no user');

          // Handle INITIAL_SESSION - this fires immediately when listener is set up
          if (event === 'INITIAL_SESSION') {
            if (isMounted && !initHandled) {
              initHandled = true;
              if (session?.user) {
                debugLog('[AuthContext] INITIAL_SESSION has user, updating state');
                updateAuthState(session, true);
                setAuthState(prev => ({ ...prev, sessionCheckComplete: true }));
                markSupabaseSessionReady(true);
              } else {
                // If we already restored user from cache or getSession(), do not overwrite with null.
                if (restoredFromStorageRef.current || restoredFromCacheRef.current) {
                  setAuthState(prev => ({ ...prev, sessionCheckComplete: true }));
                  return;
                }
                // No session from INITIAL_SESSION - in production Supabase may not have hydrated from storage yet.
                // 1) Prefer getSession() first (reads storage, no network) - most reliable in deployed envs.
                const { data: { session: fromStorage } } = await supabase.auth.getSession();
                if (isMounted && fromStorage?.user) {
                  debugLog('[AuthContext] Session from getSession() after INITIAL_SESSION null');
                  updateAuthState(fromStorage, true);
                  setAuthState(prev => ({ ...prev, sessionCheckComplete: true }));
                  markSupabaseSessionReady(true);
                  return;
                }
                // 2) If still no session, try refresh (network). Do NOT sign out on failure - can clear valid sessions in production.
                try {
                  const { data: { session: refreshed }, error } = await supabase.auth.refreshSession();
                  if (isMounted && !error && refreshed?.user) {
                    debugLog('[AuthContext] Session refreshed after INITIAL_SESSION null');
                    updateAuthState(refreshed, true);
                    setAuthState(prev => ({ ...prev, sessionCheckComplete: true }));
                    markSupabaseSessionReady(true);
                    return;
                  }
                } catch (e: any) {
                  // Never sign out here - in deployed envs this can wrongly clear a valid session (e.g. transient/refresh errors).
                  if (!isExpectedNoSessionError(e)) {
                    console.warn('[AuthContext] refreshSession failed:', e);
                  }
                }
                // 3) Mark session check complete; delayed getSession() retries can still restore session.
                // Do not wipe user if state already has one and auth keys still exist (new tab / race with sync hydrate).
                const keysStillPresent = hasAnySupabaseAuthKey();
                setAuthState((prev) => {
                  if (prev.user?.id && keysStillPresent) {
                    return { ...prev, sessionCheckComplete: true };
                  }
                  return {
                    ...prev,
                    user: null,
                    userFullName: null,
                    userInitials: null,
                    profilePhotoUrl: null,
                    isLoading: false,
                    isInitialized: true,
                    sessionCheckComplete: true,
                    sessionRefreshNonce: prev.sessionRefreshNonce,
                  };
                });
                // 4) Retry getSession() after delays (storage may hydrate late on mobile/slow devices).
                const retryDelays = [300, 900, 2000];
                retryDelays.forEach((delayMs) => {
                  setTimeout(async () => {
                    if (!isMounted) return;
                    const { data: { session: lateSession } } = await supabase.auth.getSession();
                    if (lateSession?.user) {
                      debugLog('[AuthContext] Session restored on delayed getSession() after', delayMs, 'ms');
                      updateAuthState(lateSession, true);
                      setAuthState(prev => ({ ...prev, sessionCheckComplete: true }));
                      markSupabaseSessionReady(true);
                    }
                  }, delayMs);
                });
              }
            }
            return;
          }
          // Handle TOKEN_REFRESHED: refresh session state, user details, and signal Header once
          if (event === 'TOKEN_REFRESHED' && session?.user && isMounted) {
            updateAuthState(session, true);
            fetchUserDetails(session.user).catch(() => {});
            setAuthState((prev) => ({
              ...prev,
              sessionRefreshNonce: prev.sessionRefreshNonce + 1,
            }));
            return;
          }
          // Handle all other events normally
          handleAuthStateChange(event, session);
        });
        subscription = authSubscription;

        // Do NOT set initHandled here. INITIAL_SESSION must run and set sessionCheckComplete
        // so that ProtectedRoute can redirect to login when there is no user. If we set
        // initHandled here, INITIAL_SESSION's handler is skipped and sessionCheckComplete
        // is never set for unauthenticated users, allowing everyone in.

        // Fallback: if INITIAL_SESSION never fires or is delayed, force session check complete
        // after a short delay so unauthenticated users are redirected to login.
        sessionCheckFallbackTimeout = setTimeout(() => {
          if (!isMounted) return;
          setAuthState(prev => {
            if (prev.sessionCheckComplete) return prev; // Already determined
            return {
              ...prev,
              sessionCheckComplete: true,
              isLoading: false,
              isInitialized: true,
              ...(prev.user
                ? {}
                : { user: null, userFullName: null, userInitials: null, profilePhotoUrl: null }),
            };
          });
        }, 1500);

        // Listen for localStorage changes from other tabs
        // Add debouncing to prevent excessive checks
        storageListener = (e: StorageEvent) => {
          // Only react to Supabase auth token changes
          if (e.key && e.key.includes('supabase.auth.token') && e.newValue !== e.oldValue) {
            // Debounce storage events to prevent excessive checks
            const existingTimeout = storageCheckTimeouts.get(e.key);
            if (existingTimeout) {
              clearTimeout(existingTimeout);
            }

            const timeout = setTimeout(() => {
              storageCheckTimeouts.delete(e.key || '');
              // Session changed in another tab, refresh our session
              if (isMounted) {
                supabase.auth.getSession().then(({ data: { session }, error }) => {
                  if (!isMounted) return;

                  // Only update if there's an actual change
                  if (!error && session?.user) {
                    // Check if user actually changed
                    const currentUserId = lastUserIdRef.current;
                    if (currentUserId !== session.user.id) {
                      handleAuthStateChange('SIGNED_IN', session);
                    }
                  } else if (!session) {
                    // Only clear if we actually had a user
                    if (lastUserIdRef.current) {
                      handleAuthStateChange('SIGNED_OUT', null);
                    }
                  }
                });
              }
            }, 500); // 500ms debounce - increased to reduce frequency

            if (e.key) {
              storageCheckTimeouts.set(e.key, timeout);
            }
          }
        };

        window.addEventListener('storage', storageListener);
      } catch (error) {
        console.error('Auth initialization error:', error);
        // On error, mark as initialized and session check complete so ProtectedRoute can decide
        if (isMounted && !initHandled) {
          initHandled = true;
          setAuthState(prev => ({
            ...prev,
            isLoading: false,
            isInitialized: true,
            sessionCheckComplete: true,
            user: prev.user || null
          }));
        }
      }
    };

    initializeAuth();

    return () => {
      isMounted = false;
      if (sessionCheckFallbackTimeout) clearTimeout(sessionCheckFallbackTimeout);
      if (subscription) {
        subscription.unsubscribe();
      }
      if (storageListener) {
        window.removeEventListener('storage', storageListener);
      }
      // Clear all pending storage check timeouts
      storageCheckTimeouts.forEach(timeout => clearTimeout(timeout));
      storageCheckTimeouts.clear();
    };
  }, [handleAuthStateChange, updateAuthState, fetchUserDetails]);

  return (
    <AuthContext.Provider value={authState}>
      {children}
    </AuthContext.Provider>
  );
};
