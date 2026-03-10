import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase, sessionManager, isAuthError, isExpectedNoSessionError, handleSessionExpiration } from '../lib/supabase';
import { preCheckExternalUser } from '../hooks/useExternalUser';

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

// Get Supabase URL for localStorage key checking
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';

interface AuthState {
  user: any;
  userFullName: string | null;
  userInitials: string | null;
  isLoading: boolean;
  isInitialized: boolean;
  /** True only after Supabase INITIAL_SESSION has been processed. Used to avoid redirecting before we know session state. */
  sessionCheckComplete: boolean;
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
  // Default to initialized=true to prevent premature redirects
  // Let INITIAL_SESSION event handle actual session detection
  // This prevents new tabs from redirecting to login before auth state is determined
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    userFullName: null,
    userInitials: null,
    isLoading: false,
    isInitialized: true,
    sessionCheckComplete: false, // Set true only after INITIAL_SESSION is handled - prevents redirect before we know session
  });

  // Prevent duplicate processing
  const processingRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);
  /** Set when we restore session from getSession() before INITIAL_SESSION; prevents INITIAL_SESSION(null) from overwriting. */
  const restoredFromStorageRef = useRef(false);
  /** Set when we restore session from getCachedSession(); prevents INITIAL_SESSION(null) from overwriting and redirecting. */
  const restoredFromCacheRef = useRef(false);

  const fetchUserDetails = useCallback(async (user: any) => {
    if (!user?.id) return;

    try {
      // Match by auth_id (Supabase auth user ID) - more reliable than email
      // Use maybeSingle() instead of single() to handle cases where user doesn't exist in users table
      // This prevents errors when auth user exists but users table record is missing
      let { data, error } = await supabase
        .from('users')
        .select('first_name, last_name, full_name, email')
        .eq('auth_id', user.id)
        .maybeSingle();

      // Fallback to email if not found by auth_id (for backwards compatibility)
      if ((error || !data) && user.email) {
        const { data: userByEmail, error: emailError } = await supabase
          .from('users')
          .select('first_name, last_name, full_name, email')
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

        setAuthState(prev => ({
          ...prev,
          userFullName: fullName,
          userInitials: initials,
        }));
      } else {
        // Fallback to auth user metadata
        const authName = user.user_metadata?.first_name || user.user_metadata?.full_name || user.email || 'User';
        setAuthState(prev => ({
          ...prev,
          userFullName: authName,
          userInitials: authName.split(' ').map((n: string) => n[0]).join('').toUpperCase(),
        }));
      }
    } catch (error) {
      console.error('Error fetching user details:', error);
      // Fallback to email or default
      const fallbackName = user.email || 'User';
      setAuthState(prev => ({
        ...prev,
        userFullName: fallbackName,
        userInitials: fallbackName[0].toUpperCase(),
      }));
    }
  }, []);

  const updateAuthState = useCallback((session: any, isInitialized: boolean = true) => {
    // Prevent duplicate updates for the same user
    const userId = session?.user?.id || null;

    console.log('[AuthContext] updateAuthState called, userId:', userId, 'isInitialized:', isInitialized);

    // Use functional update to avoid dependency on authState
    setAuthState(prev => {
      // Prevent duplicate updates for the same user, but allow updates when:
      // 1. User changes (sign in/out)
      // 2. State is not yet initialized
      // 3. User goes from null to a user (sign in)
      const userChanged = prev.user?.id !== userId;
      const isSignIn = !prev.user && userId; // Going from no user to a user

      console.log('[AuthContext] updateAuthState check:', {
        userChanged,
        isSignIn,
        prevUserId: prev.user?.id,
        newUserId: userId,
        prevInitialized: prev.isInitialized,
        lastUserIdRef: lastUserIdRef.current
      });

      if (!userChanged && !isSignIn && prev.isInitialized && userId === lastUserIdRef.current) {
        console.log('[AuthContext] Skipping duplicate update');
        return prev; // No change needed - same user, already initialized
      }

      console.log('[AuthContext] Updating auth state with user:', userId);
      lastUserIdRef.current = userId;

      if (session?.user) {
        // Check if session is expired
        if (sessionManager.isSessionExpired(session)) {
          console.log('Session is expired - logging out');
          // Only sign out if we actually had a user
          if (prev.user) {
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
            isLoading: false,
            isInitialized: true
          };
        }

        // Only fetch user details if we don't have them or user changed
        if ((!prev.userFullName || prev.user?.id !== session.user.id) && session.user) {
          fetchUserDetails(session.user);
        }

        // Set temporary display name from email so we never show "User" while details load (fixes mobile/deployed)
        const tempName = session.user.email || '';
        const tempInitials = tempName ? tempName[0].toUpperCase() : '';

        return {
          ...prev,
          user: session.user,
          userFullName: prev.userFullName || tempName,
          userInitials: prev.userInitials || tempInitials,
          isLoading: false,
          isInitialized
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
          isLoading: false,
          isInitialized
        };
      }
    });
  }, [fetchUserDetails]);

  const handleAuthStateChange = useCallback(async (event: string, session: any) => {
    console.log('[AuthContext] Auth state change event:', event, 'Session:', session?.user?.id || 'no user');

    // Always process SIGNED_IN events immediately, even if processing
    // This ensures sign-in works correctly
    if (event === 'SIGNED_IN') {
      console.log('[AuthContext] Processing SIGNED_IN event, updating auth state');
      // Ensure sessionStorage flag is set
      if (typeof window !== 'undefined' && session?.user) {
        sessionStorage.setItem('user_signed_in', 'true');
        sessionStorage.setItem('user_signed_in_timestamp', Date.now().toString());
      }
      updateAuthState(session, true);
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
          lastUserIdRef.current = null;
          return {
            ...prev,
            user: null,
            userFullName: null,
            userInitials: null,
            isLoading: false,
            isInitialized: true
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

  // Session expiration monitoring - only when user exists
  // LESS AGGRESSIVE - trust Supabase's auto-refresh and only check occasionally
  useEffect(() => {
    if (!authState.user) return;

    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 3; // Require 3 consecutive failures before logging out

    const checkSessionExpiration = async () => {
      try {
        // Get current session first to verify it still exists
        const { data: { session }, error } = await supabase.auth.getSession();

        // If there's an error, check if it's a network error
        if (error) {
          const errorMsg = String(error.message || error).toLowerCase();
          const isNetworkErr = errorMsg.includes('network') || errorMsg.includes('timeout') || errorMsg.includes('fetch');
          
          if (isNetworkErr) {
            // Network error - don't treat as auth failure
            consecutiveFailures = 0; // Reset on network errors
            return;
          }
        }

        // If session exists, reset failure count
        if (session?.user) {
          consecutiveFailures = 0;
          return; // Session is valid
        }

        // No session - try refresh once (Supabase autoRefreshToken may not have run yet)
        if (!session && typeof window !== 'undefined') {
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
              const { data: { session: refreshed }, error } = await supabase.auth.refreshSession();
              if (!error && refreshed?.user) {
                consecutiveFailures = 0;
                updateAuthState(refreshed, true);
                return;
              }
              // Refresh failed - do not clear tokens here; only clear after multiple consecutive failures below
            }
          } catch (e) {
            console.warn('Could not check/refresh session:', e);
          }
        }

        // No session (and refresh didn't recover) - increment failure count
        consecutiveFailures++;

        // Only clear state after multiple consecutive failures
        // This prevents false positives from transient network issues
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.log(`Session check failed ${consecutiveFailures} times consecutively, clearing auth state`);

          // Double-check one more time before clearing
          const { data: { session: finalCheck } } = await supabase.auth.getSession();
          if (!finalCheck?.user) {
            if (typeof window !== 'undefined') {
              try {
                Object.keys(localStorage).forEach(key => {
                  if (key.includes('supabase.auth.token') || (key.includes('sb-') && key.includes('-auth-token'))) {
                    localStorage.removeItem(key);
                  }
                });
              } catch (e) {
                console.warn('Could not clear auth storage:', e);
              }
            }
            setAuthState(prev => {
              if (!prev.user) return prev;
              return {
                ...prev,
                user: null,
                userFullName: null,
                userInitials: null,
                isLoading: false,
                isInitialized: true
              };
            });
          } else {
            consecutiveFailures = 0;
          }
        }
      } catch (error) {
        console.error('Error checking session expiration:', error);
        
        // Check if it's a network error
        const errorMsg = String(error instanceof Error ? error.message : error).toLowerCase();
        const isNetworkErr = errorMsg.includes('network') || errorMsg.includes('timeout') || errorMsg.includes('fetch');
        
        // Don't clear state on network errors
        if (isNetworkErr) {
          consecutiveFailures = 0; // Reset on network errors
          return;
        }
        
        // Only handle if it's a clear auth error (not network error)
        if (isAuthError(error) && !isNetworkErr) {
          consecutiveFailures++;
          // Only redirect after multiple failures
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            try {
              await handleSessionExpiration();
            } catch (handleError) {
              // Silently fail - don't disrupt user experience
            }
          }
        }
      }
    };

    // Check less frequently - every 5 minutes instead of 60 seconds
    // This reduces false positives and gives Supabase more time to auto-refresh
    const interval = setInterval(checkSessionExpiration, 300000); // 5 minutes

    return () => clearInterval(interval);
  }, [authState.user]);

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
        // INSTANT: Check cached session from localStorage immediately (synchronous)
        // This allows immediate render without waiting for async checks
        const getCachedSession = () => {
          try {
            const keyFromUrl = `sb-${supabaseUrl.split('//')[1]?.split('.')[0]}-auth-token`;
            for (const key of [keyFromUrl, ...Object.keys(localStorage)]) {
              if (!key || (!key.includes('supabase.auth.token') && !(key.startsWith('sb-') && key.includes('-auth-token')))) continue;
              const cached = localStorage.getItem(key);
              if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed?.currentSession?.user) {
                  return parsed.currentSession;
                }
              }
            }
          } catch (e) {
            // Ignore errors
          }
          return null;
        };

        const cachedSession = getCachedSession();
        if (cachedSession?.user) {
          // INSTANT: Set user immediately from cache
          console.log('[AuthContext] Using cached session for instant initialization');
          restoredFromCacheRef.current = true;
          updateAuthState(cachedSession, true);
          setAuthState(prev => ({ ...prev, sessionCheckComplete: true }));
          // Fetch user details in background (non-blocking)
          fetchUserDetails(cachedSession.user).catch(() => {});
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
                console.log('[AuthContext] Found stored tokens, trying getSession() for deployed env...');
                // In production INITIAL_SESSION can fire with null; getSession() reads storage directly and is more reliable
                const { data: { session } } = await supabase.auth.getSession();
                if (isMounted && session?.user) {
                  restoredFromStorageRef.current = true;
                  updateAuthState(session, true);
                  setAuthState(prev => ({ ...prev, sessionCheckComplete: true }));
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
          console.log('[AuthContext] onAuthStateChange fired:', event, 'Session:', session?.user?.id || 'no user');

          // Handle INITIAL_SESSION - this fires immediately when listener is set up
          if (event === 'INITIAL_SESSION') {
            if (isMounted && !initHandled) {
              initHandled = true;
              if (session?.user) {
                console.log('[AuthContext] INITIAL_SESSION has user, updating state');
                updateAuthState(session, true);
                setAuthState(prev => ({ ...prev, sessionCheckComplete: true }));
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
                  console.log('[AuthContext] Session from getSession() after INITIAL_SESSION null');
                  updateAuthState(fromStorage, true);
                  setAuthState(prev => ({ ...prev, sessionCheckComplete: true }));
                  return;
                }
                // 2) If still no session, try refresh (network). Do NOT sign out on failure - can clear valid sessions in production.
                try {
                  const { data: { session: refreshed }, error } = await supabase.auth.refreshSession();
                  if (isMounted && !error && refreshed?.user) {
                    console.log('[AuthContext] Session refreshed after INITIAL_SESSION null');
                    updateAuthState(refreshed, true);
                    setAuthState(prev => ({ ...prev, sessionCheckComplete: true }));
                    return;
                  }
                } catch (e: any) {
                  // Never sign out here - in deployed envs this can wrongly clear a valid session (e.g. transient/refresh errors).
                  if (!isExpectedNoSessionError(e)) {
                    console.warn('[AuthContext] refreshSession failed:', e);
                  }
                }
                // 3) Mark session check complete; delayed getSession() retries can still restore session.
                setAuthState(prev => ({
                  ...prev,
                  user: null,
                  userFullName: null,
                  userInitials: null,
                  isLoading: false,
                  isInitialized: true,
                  sessionCheckComplete: true
                }));
                // 4) Retry getSession() after delays (storage may hydrate late on mobile/slow devices).
                const retryDelays = [800, 2000, 4500];
                retryDelays.forEach((delayMs) => {
                  setTimeout(async () => {
                    if (!isMounted) return;
                    const { data: { session: lateSession } } = await supabase.auth.getSession();
                    if (lateSession?.user) {
                      console.log('[AuthContext] Session restored on delayed getSession() after', delayMs, 'ms');
                      updateAuthState(lateSession, true);
                      setAuthState(prev => ({ ...prev, sessionCheckComplete: true }));
                    }
                  }, delayMs);
                });
              }
            }
            return;
          }
          // Handle TOKEN_REFRESHED so we keep the session alive without re-fetching user details every time
          if (event === 'TOKEN_REFRESHED' && session?.user && isMounted) {
            updateAuthState(session, true);
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
              ...(prev.user ? {} : { user: null, userFullName: null, userInitials: null }),
            };
          });
        }, 3500);

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
