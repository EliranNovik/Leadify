import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase, sessionManager } from '../lib/supabase';

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

  const handleAuthStateChange = useCallback(async (event: string, session: any) => {
    console.log('🔐 Auth state change:', event, session?.user?.email);
    
    if (event === 'SIGNED_IN' && session?.user) {
      console.log('✅ User signed in via auth state change');
      setAuthState(prev => ({ 
        ...prev, 
        user: session.user,
        isLoading: false,
        isInitialized: true 
      }));
      // Fetch user details in background
      fetchUserDetails(session.user);
    } else if (event === 'SIGNED_OUT') {
      console.log('❌ User signed out');
      setAuthState(prev => ({
        ...prev,
        user: null,
        userFullName: null,
        userInitials: null,
        isLoading: false,
        isInitialized: true
      }));
    } else if (event === 'INITIAL_SESSION' && session?.user) {
      console.log('🔄 Initial session detected');
      setAuthState(prev => ({ 
        ...prev, 
        user: session.user,
        isLoading: false,
        isInitialized: true 
      }));
      // Fetch user details in background
      fetchUserDetails(session.user);
    } else if (event === 'TOKEN_REFRESHED' && session?.user) {
      console.log('🔄 Token refreshed');
      setAuthState(prev => ({ 
        ...prev, 
        user: session.user,
        isLoading: false,
        isInitialized: true 
      }));
    }
  }, [fetchUserDetails]);

  // Session monitoring is handled in App.tsx to avoid conflicts

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        // Check if we're coming from a magic link (check both hash fragments and URL params)
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const urlParams = new URLSearchParams(window.location.search);
        
        // Check hash fragments first (most common for magic links)
        let accessToken = hashParams.get('access_token');
        let refreshToken = hashParams.get('refresh_token');
        let type = hashParams.get('type');
        
        // If not in hash, check URL parameters
        if (!accessToken || !refreshToken) {
          accessToken = urlParams.get('access_token');
          refreshToken = urlParams.get('refresh_token');
          type = urlParams.get('type');
        }
        
        // Also check for other magic link indicators
        const hasMagicLinkParams = accessToken || refreshToken || type === 'magiclink' || 
          window.location.href.includes('access_token') || 
          window.location.href.includes('refresh_token');
        
        if (accessToken && refreshToken) {
          console.log('🔗 Magic link detected, processing authentication...');
          // Set the session manually for magic link
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          });
          
          if (error) {
            console.error('Error setting session from magic link:', error);
          } else if (data?.session?.user) {
            console.log('✅ Magic link authentication successful');
            setAuthState(prev => ({ 
              ...prev, 
              user: data.session!.user,
              isLoading: false,
              isInitialized: true 
            }));
            fetchUserDetails(data.session!.user);
            // Clean up the URL
            window.history.replaceState({}, document.title, window.location.pathname);
            return;
          }
        } else if (hasMagicLinkParams) {
          console.log('🔗 Magic link parameters detected but incomplete, letting Supabase handle it...');
          // Force Supabase to process the URL by calling getSession
          try {
            const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
            if (sessionError) {
              console.error('Error getting session from magic link:', sessionError);
            } else if (sessionData?.session?.user) {
              console.log('✅ Magic link processed by Supabase');
              setAuthState(prev => ({ 
                ...prev, 
                user: sessionData.session.user,
                isLoading: false,
                isInitialized: true 
              }));
              fetchUserDetails(sessionData.session.user);
              // Clean up the URL
              window.history.replaceState({}, document.title, window.location.pathname);
              return;
            }
          } catch (error) {
            console.error('Error processing magic link:', error);
          }
        }
        
        // Set up auth state change listener FIRST
        const { data: { subscription } } = supabase.auth.onAuthStateChange(handleAuthStateChange);
        
        // Try to get session with proper session management
        try {
          const session = await sessionManager.getSession();
          
          if (session?.user) {
            console.log('✅ Existing session found');
            setAuthState(prev => ({ ...prev, user: session.user }));
            // Don't wait for user details to load - let it happen in background
            fetchUserDetails(session.user);
          } else {
            console.log('ℹ️ No existing session found');
          }
        } catch (sessionError) {
          console.log('ℹ️ Session check failed, auth listener will handle state changes');
          // Don't fail completely - the auth listener will handle state changes
        }
        
        setAuthState(prev => ({ ...prev, isLoading: false, isInitialized: true }));
        
        return () => {
          subscription.unsubscribe();
        };
      } catch (error) {
        console.error('Auth initialization error:', error);
        // Even if auth fails, don't block the app
        setAuthState(prev => ({ ...prev, isLoading: false, isInitialized: true }));
      }
    };
    
    // Start auth initialization immediately
    initializeAuth();
  }, [handleAuthStateChange]);

  return (
    <AuthContext.Provider value={authState}>
      {children}
    </AuthContext.Provider>
  );
}; 