import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase, sessionManager, isAuthError, handleSessionExpiration } from '../lib/supabase';

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
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    userFullName: null,
    userInitials: null,
    isLoading: true,
    isInitialized: false,
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
    if (userId === lastUserIdRef.current && authState.user?.id === userId && authState.isInitialized) {
      return; // No change needed
    }
    
    lastUserIdRef.current = userId;
    
    if (session?.user) {
      // Check if session is expired
      if (sessionManager.isSessionExpired(session)) {
        console.log('Session is expired - logging out');
        setAuthState({
          user: null,
          userFullName: null,
          userInitials: null,
          isLoading: false,
          isInitialized: true
        });
        supabase.auth.signOut().then(() => {
          if (typeof window !== 'undefined') {
            window.location.href = '/login';
          }
        });
        return;
      }
      
      setAuthState(prev => {
        // Only fetch user details if we don't have them
        if (!prev.userFullName && session.user) {
          fetchUserDetails(session.user);
        }
        return {
          ...prev,
          user: session.user,
          isLoading: false,
          isInitialized
        };
      });
    } else {
      setAuthState(prev => {
        // Only update if we had a user before
        if (!prev.user && prev.isInitialized) {
          return prev;
        }
        return {
          user: null,
          userFullName: null,
          userInitials: null,
          isLoading: false,
          isInitialized
        };
      });
    }
  }, [authState.user, fetchUserDetails]);

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
      } else if (event === 'SIGNED_OUT') {
        lastUserIdRef.current = null;
        setAuthState({
          user: null,
          userFullName: null,
          userInitials: null,
          isLoading: false,
          isInitialized: true
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
        const isExpired = await sessionManager.checkAndHandleExpiration();
        if (isExpired) {
          setAuthState({
            user: null,
            userFullName: null,
            userInitials: null,
            isLoading: false,
            isInitialized: true
          });
        }
      } catch (error) {
        console.error('Error checking session expiration:', error);
        if (isAuthError(error)) {
          await handleSessionExpiration();
        }
      }
    };
    
    // Only check periodically, not immediately on mount
    // Then check every 30 seconds (less frequent to reduce load)
    const interval = setInterval(checkSessionExpiration, 30000);
    
    return () => clearInterval(interval);
  }, [authState.user]);

  // Initialize auth state
  useEffect(() => {
    let subscription: any = null;
    let isMounted = true;
    let storageListener: ((e: StorageEvent) => void) | null = null;
    let initHandled = false;
    
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
        storageListener = (e: StorageEvent) => {
          // Only react to Supabase auth token changes
          if (e.key && e.key.includes('supabase.auth.token') && e.newValue !== e.oldValue) {
            // Session changed in another tab, refresh our session
            if (isMounted) {
              supabase.auth.getSession().then(({ data: { session }, error }) => {
                if (!error && session?.user && isMounted) {
                  handleAuthStateChange('SIGNED_IN', session);
                } else if (!session && isMounted) {
                  handleAuthStateChange('SIGNED_OUT', null);
                }
              });
            }
          }
        };
        
        window.addEventListener('storage', storageListener);
      } catch (error) {
        console.error('Auth initialization error:', error);
        if (isMounted && !initHandled) {
          initHandled = true;
          // On error, mark as initialized to prevent infinite loading
          setAuthState(prev => ({ ...prev, isLoading: false, isInitialized: true }));
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
    };
  }, [handleAuthStateChange, updateAuthState]);

  return (
    <AuthContext.Provider value={authState}>
      {children}
    </AuthContext.Provider>
  );
};
