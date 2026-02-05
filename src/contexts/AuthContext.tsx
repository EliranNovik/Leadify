import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase, sessionManager, isAuthError, handleSessionExpiration } from '../lib/supabase';
import { preCheckExternalUser } from '../hooks/useExternalUser';

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
  // Check localStorage synchronously first to avoid loading screen if session exists
  // This allows pages to render immediately while auth verification happens in background
  const hasStoredSession = typeof window !== 'undefined' && 
    Object.keys(localStorage).some(key => key.includes('supabase.auth.token'));
  
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    userFullName: null,
    userInitials: null,
    // If we have a stored session, mark as initialized immediately to skip loading screen
    // The actual session verification will happen in the background
    isLoading: false, // Don't show loading if we have stored session
    isInitialized: hasStoredSession, // Mark as initialized if session exists
  });

  // Prevent duplicate processing
  const processingRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);

  const fetchUserDetails = useCallback(async (user: any) => {
    if (!user?.email) return;
    
    try {
      const { data, error } = await supabase
        .from('users')
        .select('first_name, last_name, full_name')
        .eq('email', user.email)
        .single();
      
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
          fullName = user.email;
          initials = user.email[0].toUpperCase();
        }
        
        setAuthState(prev => ({
          ...prev,
          userFullName: fullName,
          userInitials: initials,
        }));
      } else {
        // Fallback to auth user metadata
        const authName = user.user_metadata?.first_name || user.user_metadata?.full_name || user.email;
        setAuthState(prev => ({
          ...prev,
          userFullName: authName,
          userInitials: authName.split(' ').map((n: string) => n[0]).join('').toUpperCase(),
        }));
      }
    } catch (error) {
      console.error('Error fetching user details:', error);
      // Fallback to email
      setAuthState(prev => ({
        ...prev,
        userFullName: user.email,
        userInitials: user.email[0].toUpperCase(),
      }));
    }
  }, []);

  const updateAuthState = useCallback((session: any, isInitialized: boolean = true) => {
    // Prevent duplicate updates for the same user
    const userId = session?.user?.id || null;
    
    // Use functional update to avoid dependency on authState
    setAuthState(prev => {
      // Prevent duplicate updates for the same user
      if (userId === lastUserIdRef.current && prev.user?.id === userId && prev.isInitialized) {
        return prev; // No change needed
      }
      
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
    // Prevent concurrent processing
    if (processingRef.current) {
      return;
    }
    
    processingRef.current = true;
    
    try {
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
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
    
    const initializeAuth = async () => {
      try {
        // Check session immediately on mount to get current state
        // This prevents redirecting to login before we know if user is authenticated
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (isMounted && !initHandled) {
          initHandled = true;
          if (!error && session?.user) {
            // User is authenticated - update state immediately
            updateAuthState(session, true);
          } else {
            // No session - mark as initialized with no user
            setAuthState(prev => ({
              ...prev,
              user: null,
              userFullName: null,
              userInitials: null,
              isLoading: false,
              isInitialized: true
            }));
          }
        }
        
        // Set up auth state change listener for future changes
        const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange((event, session) => {
          // Skip INITIAL_SESSION since we already handled it above
          if (event === 'INITIAL_SESSION' && initHandled) {
            return;
          }
          handleAuthStateChange(event, session);
        });
        subscription = authSubscription;
        
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
          // On error, mark as initialized to prevent infinite loading
          // If we had a stored session, we still mark as initialized (user might be logged out)
          setAuthState(prev => ({ 
            ...prev, 
            isLoading: false, 
            isInitialized: true,
            // Clear user on error if we had one
            user: prev.user && hasStoredSession ? prev.user : null
          }));
        }
      }
    };
    
    initializeAuth();
    
    return () => {
      isMounted = false;
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
