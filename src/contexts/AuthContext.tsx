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

  // Add a fallback timeout to prevent infinite loading
  useEffect(() => {
    const fallbackTimeout = setTimeout(() => {
      if (!authState.isInitialized) {
        // Auth initialization timeout - allowing app to proceed
        setAuthState(prev => ({ ...prev, isLoading: false, isInitialized: true }));
      }
    }, 2000); // 2 second fallback

    return () => clearTimeout(fallbackTimeout);
  }, [authState.isInitialized]);

  const fetchUserDetails = useCallback(async (user: any, retryCount = 0) => {
    if (!user?.email) return;
    
    try {
      const { data, error } = await supabase
        .from('users')
        .select('first_name, last_name, full_name')
        .eq('email', user.email)
        .single();
      
      if (!error && data) {
        if (data.first_name && data.last_name && data.first_name.trim() && data.last_name.trim()) {
          const fullName = `${data.first_name.trim()} ${data.last_name.trim()}`;
          setAuthState(prev => ({
            ...prev,
            userFullName: fullName,
            userInitials: `${data.first_name[0]}${data.last_name[0]}`.toUpperCase(),
          }));
        } else if (data.full_name && data.full_name.trim()) {
          setAuthState(prev => ({
            ...prev,
            userFullName: data.full_name.trim(),
            userInitials: data.full_name.split(' ').map((n: string) => n[0]).join('').toUpperCase(),
          }));
        } else {
          setAuthState(prev => ({
            ...prev,
            userFullName: user.email,
            userInitials: user.email[0].toUpperCase(),
          }));
        }
      } else {
        // Fallback to auth user metadata
        if (user.user_metadata?.first_name || user.user_metadata?.full_name) {
          const authName = user.user_metadata.first_name || user.user_metadata.full_name;
          setAuthState(prev => ({
            ...prev,
            userFullName: authName,
            userInitials: authName.split(' ').map((n: string) => n[0]).join('').toUpperCase(),
          }));
        } else {
          setAuthState(prev => ({
            ...prev,
            userFullName: user.email,
            userInitials: user.email[0].toUpperCase(),
          }));
        }
      }
    } catch (error) {
      console.error('Error fetching user details:', error);
      if (retryCount < 3) {
        setTimeout(() => fetchUserDetails(user, retryCount + 1), 1000);
      }
    }
  }, []);

  // Track last processed event to prevent duplicate processing
  const lastProcessedEvent = useRef<{ event: string; userId: string | null; timestamp: number } | null>(null);
  const processingRef = useRef(false);

  const handleAuthStateChange = useCallback(async (event: string, session: any) => {
    // Prevent duplicate processing of the same event
    const userId = session?.user?.id || null;
    const now = Date.now();
    
    // Check if we're already processing this event
    if (processingRef.current) {
      return;
    }
    
    // Debounce: ignore duplicate events within 500ms
    if (lastProcessedEvent.current) {
      const { event: lastEvent, userId: lastUserId, timestamp } = lastProcessedEvent.current;
      if (lastEvent === event && lastUserId === userId && (now - timestamp) < 500) {
        return; // Skip duplicate event
      }
    }
    
    processingRef.current = true;
    lastProcessedEvent.current = { event, userId, timestamp: now };
    
    try {
      // Simplified handling - let Supabase manage session lifecycle
      if (event === 'SIGNED_IN' && session?.user) {
        // Check if session is expired
        if (sessionManager.isSessionExpired(session)) {
          console.log('SIGNED_IN event but session is expired - logging out');
          setAuthState({
            user: null,
            userFullName: null,
            userInitials: null,
            isLoading: false,
            isInitialized: true
          });
          await supabase.auth.signOut();
          if (typeof window !== 'undefined') {
            window.location.href = '/login';
          }
          return;
        }
        
        setAuthState(prev => {
          // Only update if user actually changed
          if (prev.user?.id === session.user.id) {
            return prev; // No change needed
          }
          // Fetch user details if we don't already have them
          if (!prev.userFullName) {
            fetchUserDetails(session.user);
          }
          return { 
            ...prev, 
            user: session.user,
            isLoading: false,
            isInitialized: true 
          };
        });
      } else if (event === 'SIGNED_OUT') {
        // Clear all auth state immediately
        setAuthState({
          user: null,
          userFullName: null,
          userInitials: null,
          isLoading: false,
          isInitialized: true
        });
        // Redirect to login page
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
      } else if (event === 'INITIAL_SESSION') {
        if (session?.user) {
          // Check if session is expired
          if (sessionManager.isSessionExpired(session)) {
            console.log('INITIAL_SESSION event but session is expired - logging out');
            setAuthState({
              user: null,
              userFullName: null,
              userInitials: null,
              isLoading: false,
              isInitialized: true
            });
            await supabase.auth.signOut();
            if (typeof window !== 'undefined') {
              window.location.href = '/login';
            }
            return;
          }
          
          setAuthState(prev => {
            // Only update if user actually changed
            if (prev.user?.id === session.user.id && prev.isInitialized) {
              return prev; // No change needed
            }
            // Fetch user details if we don't already have them
            if (!prev.userFullName) {
              fetchUserDetails(session.user);
            }
            return { 
              ...prev, 
              user: session.user,
              isLoading: false,
              isInitialized: true 
            };
          });
        } else {
          setAuthState(prev => {
            // Only update if we had a user before
            if (!prev.user) {
              return prev; // No change needed
            }
            return {
              ...prev,
              user: null,
              userFullName: null,
              userInitials: null,
              isLoading: false,
              isInitialized: true
            };
          });
        }
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        // Just update user, don't refetch details - only if user changed
        setAuthState(prev => {
          if (prev.user?.id === session.user.id) {
            return prev; // No change needed
          }
          return { 
            ...prev, 
            user: session.user
          };
        });
      } else if (event === 'USER_UPDATED' && session?.user) {
        // Only update if user actually changed
        setAuthState(prev => {
          if (prev.user?.id === session.user.id) {
            return prev; // No change needed
          }
          return { 
            ...prev, 
            user: session.user
          };
        });
      }
    } finally {
      // Reset processing flag after a short delay to allow legitimate state changes
      setTimeout(() => {
        processingRef.current = false;
      }, 100);
    }
  }, [fetchUserDetails]);

  // Session expiration monitoring - check frequently and immediately on page load
  useEffect(() => {
    if (!authState.user) return; // No need to monitor if no user
    
    const checkSessionExpiration = async () => {
      try {
        // Use the improved check function that handles expiration automatically
        const isExpired = await sessionManager.checkAndHandleExpiration();
        if (isExpired) {
          // Session expired - handleSessionExpiration already called
          setAuthState({
            user: null,
            userFullName: null,
            userInitials: null,
            isLoading: false,
            isInitialized: true
          });
          return;
        }
      } catch (error) {
        console.error('Error checking session expiration:', error);
        // On error, check if it's an auth error
        if (isAuthError(error)) {
          await handleSessionExpiration();
        }
      }
    };
    
    // Check immediately on mount and when user changes
    checkSessionExpiration();
    
    // Then check every 5 seconds (more frequent for better security)
    const interval = setInterval(checkSessionExpiration, 5000);
    
    return () => clearInterval(interval);
  }, [authState.user]);
  
  // Also check on page visibility change (when user switches back to tab)
  useEffect(() => {
    if (!authState.user) return;
    
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        // Page became visible - check session immediately
        try {
          await sessionManager.checkAndHandleExpiration();
        } catch (error) {
          console.error('Error checking session on visibility change:', error);
        }
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [authState.user]);

  useEffect(() => {
    let subscription: any = null;
    let isMounted = true;
    let storageListener: ((e: StorageEvent) => void) | null = null;
    
    const initializeAuth = async () => {
      try {
        // Set up auth state change listener - Supabase handles magic links automatically
        const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange(handleAuthStateChange);
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
        
        // Get initial session - Supabase handles refresh and magic links automatically
        // For new tabs, wait a bit longer to allow localStorage to sync across tabs
        // Check localStorage directly to see if there's a session token
        const hasStoredSession = typeof window !== 'undefined' && 
          Object.keys(localStorage).some(key => key.includes('supabase.auth.token'));
        
        if (!hasStoredSession) {
          // No stored session, minimal delay
          await new Promise(resolve => setTimeout(resolve, 50));
        } else {
          // Stored session exists - this might be a new tab syncing, wait longer
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        // Try to get session with retry logic, especially for new tabs
        let session = null;
        let error = null;
        let attempts = 0;
        const maxAttempts = hasStoredSession ? 3 : 1; // Retry more if session exists in storage
        
        while (attempts < maxAttempts && !session && isMounted) {
          const result = await supabase.auth.getSession();
          session = result.data?.session;
          error = result.error;
          
          if (session?.user || error) {
            break; // Got session or error, stop retrying
          }
          
          attempts++;
          if (attempts < maxAttempts && isMounted) {
            // Wait before retry with progressive delay
            await new Promise(resolve => setTimeout(resolve, 200 * attempts));
          }
        }
        
        if (!isMounted) return;
        
        if (error) {
          console.error('Error getting session:', error);
          // Don't block app on error - might be temporary
          setAuthState(prev => ({ ...prev, isLoading: false, isInitialized: true }));
          return;
        }
        
        if (session?.user) {
          // Check if session is expired before setting user
          if (sessionManager.isSessionExpired(session)) {
            console.log('Initial session is expired - logging out');
            setAuthState({
              user: null,
              userFullName: null,
              userInitials: null,
              isLoading: false,
              isInitialized: true
            });
            await supabase.auth.signOut();
            if (typeof window !== 'undefined') {
              window.location.href = '/login';
            }
            return;
          }
          
          setAuthState(prev => {
            // Only update if user actually changed
            if (prev.user?.id === session.user.id && prev.isInitialized) {
              return prev; // No change needed
            }
            // Fetch user details if we don't already have them
            if (!prev.userFullName) {
              fetchUserDetails(session.user);
            }
            return { ...prev, user: session.user, isLoading: false, isInitialized: true };
          });
        } else {
          setAuthState(prev => {
            // Only update if we had a user before
            if (!prev.user && prev.isInitialized) {
              return prev; // No change needed
            }
            return {
              ...prev,
              user: null,
              userFullName: null,
              userInitials: null,
              isLoading: false,
              isInitialized: true
            };
          });
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
        // Even if auth fails, don't block the app
        if (isMounted) {
          setAuthState(prev => ({ ...prev, isLoading: false, isInitialized: true }));
        }
      }
    };
    
    // Start auth initialization immediately
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
  }, [handleAuthStateChange]); // Removed fetchUserDetails from deps to prevent re-initialization

  return (
    <AuthContext.Provider value={authState}>
      {children}
    </AuthContext.Provider>
  );
}; 