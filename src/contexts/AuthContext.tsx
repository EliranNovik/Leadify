import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase, sessionManager, isAuthError, handleSessionExpiration } from '../lib/supabase';
import { preCheckExternalUser } from '../hooks/useExternalUser';

// Get Supabase URL for localStorage key checking
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';

interface AuthState {
  user: any;
  userFullName: string | null;
  userInitials: string | null;
  isLoading: boolean;
  isInitialized: boolean;
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
    // Default to initialized=true to prevent premature redirects
    // INITIAL_SESSION will fire immediately and update the state correctly
    isLoading: false,
    isInitialized: true, // Default to true - let auth events handle actual state
  });

  // Prevent duplicate processing
  const processingRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);

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

        return {
          ...prev,
          user: session.user,
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
  // Removed immediate check on mount and visibility change to avoid UI auth checks on refresh
  useEffect(() => {
    if (!authState.user) return;

    const checkSessionExpiration = async () => {
      try {
        // Get current session first to verify it still exists
        const { data: { session } } = await supabase.auth.getSession();

        // If session is gone, user was already signed out
        if (!session?.user) {
          return; // Don't clear state if session check fails - might be network issue
        }

        const isExpired = await sessionManager.checkAndHandleExpiration();
        if (isExpired) {
          // Only clear if we're sure the session is expired
          setAuthState(prev => {
            // Double-check we still have a user before clearing
            if (!prev.user) return prev;
            return {
              user: null,
              userFullName: null,
              userInitials: null,
              isLoading: false,
              isInitialized: true
            };
          });
        }
      } catch (error) {
        console.error('Error checking session expiration:', error);
        // Don't clear state on error - might be network issue
        // Only handle if it's a clear auth error
        if (isAuthError(error)) {
          try {
            await handleSessionExpiration();
          } catch (handleError) {
            // Silently fail - don't disrupt user experience
          }
        }
      }
    };

    // Only check periodically, not immediately on mount
    // Check every 60 seconds (less frequent to reduce load and false positives)
    const interval = setInterval(checkSessionExpiration, 60000);

    return () => clearInterval(interval);
  }, [authState.user]);

  // Initialize auth state
  useEffect(() => {
    let subscription: any = null;
    let isMounted = true;
    let storageListener: ((e: StorageEvent) => void) | null = null;
    let initHandled = false;
    const storageCheckTimeouts = new Map<string, NodeJS.Timeout>();

    // Fallback timeout: always mark as initialized after 3 seconds to prevent infinite loading
    const fallbackTimeout = setTimeout(() => {
      if (isMounted && !initHandled) {
        console.warn('Auth initialization taking too long, marking as initialized to prevent stuck loading');
        initHandled = true;
        setAuthState(prev => ({
          ...prev,
          isLoading: false,
          isInitialized: true,
          // Keep user if we had one from stored session
          user: prev.user || null
        }));
      }
    }, 3000);

    const initializeAuth = async () => {
      try {
        // Don't check localStorage here - let INITIAL_SESSION handle it
        // This prevents race conditions and ensures consistent behavior across tabs
        // INITIAL_SESSION will fire immediately when listener is set up and will have the correct session

        // Set up auth state change listener - INITIAL_SESSION should fire immediately
        const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange((event, session) => {
          console.log('[AuthContext] onAuthStateChange fired:', event, 'Session:', session?.user?.id || 'no user');

          // Handle INITIAL_SESSION - this fires immediately when listener is set up
          // This is the authoritative source for session state
          if (event === 'INITIAL_SESSION') {
            console.log('[AuthContext] INITIAL_SESSION event, initHandled:', initHandled, 'hasUser:', !!session?.user);
            if (isMounted && !initHandled) {
              initHandled = true;
              clearTimeout(fallbackTimeout);
              if (session?.user) {
                console.log('[AuthContext] INITIAL_SESSION has user, updating state');
                updateAuthState(session, true);
              } else {
                console.log('[AuthContext] INITIAL_SESSION no user, keeping initialized=true but no user');
                // Keep isInitialized=true to prevent redirect, but no user means not authenticated
                // ProtectedRoute will handle redirect if needed
                setAuthState(prev => ({
                  ...prev,
                  user: null,
                  userFullName: null,
                  userInitials: null,
                  isLoading: false,
                  isInitialized: true // Keep true - let ProtectedRoute handle redirect
                }));
              }
            }
            return;
          }
          // Handle all other events normally (SIGNED_IN, SIGNED_OUT, etc.)
          // IMPORTANT: Always handle SIGNED_IN to update state after login
          handleAuthStateChange(event, session);
        });
        subscription = authSubscription;

        // Fallback: If INITIAL_SESSION doesn't fire within 200ms, mark as initialized
        // This is a safety net, but INITIAL_SESSION should fire immediately
        setTimeout(() => {
          if (isMounted && !initHandled) {
            initHandled = true;
            clearTimeout(fallbackTimeout);
            setAuthState(prev => ({
              ...prev,
              user: null,
              userFullName: null,
              userInitials: null,
              isLoading: false,
              isInitialized: true
            }));
          }
        }, 200);

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
        if (isMounted && !initHandled) {
          initHandled = true;
          clearTimeout(fallbackTimeout);
          // On error, mark as initialized to prevent infinite loading
          // Always mark as initialized even on error to prevent stuck loading screen
          setAuthState(prev => ({
            ...prev,
            isLoading: false,
            isInitialized: true,
            // Keep user if we had one (might be network issue)
            user: prev.user || null
          }));
        }
      }
    };

    initializeAuth();

    return () => {
      isMounted = false;
      clearTimeout(fallbackTimeout);
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
  }, [handleAuthStateChange, updateAuthState]);

  return (
    <AuthContext.Provider value={authState}>
      {children}
    </AuthContext.Provider>
  );
};
