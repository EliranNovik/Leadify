import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

interface AuthState {
  user: any;
  userFullName: string | null;
  userInitials: string | null;
  isLoading: boolean;
  isInitialized: boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export const useAuthContext = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
};

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
      console.log('Auth initialization timeout - allowing app to proceed');
      setAuthState(prev => ({ ...prev, isLoading: false, isInitialized: true }));
    }, 2000); // 2 second fallback

    return () => clearTimeout(fallbackTimeout);
  }, []);

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
    console.log('Auth state change:', event, session?.user?.email);
    
    if (event === 'SIGNED_IN' && session?.user) {
      console.log('User signed in, updating state');
      setAuthState(prev => ({ 
        ...prev, 
        user: session.user,
        isLoading: false,
        isInitialized: true 
      }));
      // Fetch user details in background
      fetchUserDetails(session.user);
    } else if (event === 'SIGNED_OUT') {
      console.log('User signed out, clearing state');
      setAuthState(prev => ({
        ...prev,
        user: null,
        userFullName: null,
        userInitials: null,
        isLoading: false,
        isInitialized: true
      }));
    } else if (event === 'INITIAL_SESSION' && session?.user) {
      console.log('Initial session found, updating state');
      setAuthState(prev => ({ 
        ...prev, 
        user: session.user,
        isLoading: false,
        isInitialized: true 
      }));
      // Fetch user details in background
      fetchUserDetails(session.user);
    }
  }, [fetchUserDetails]);

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        console.log('Initializing auth...');
        
        // Set up auth state change listener FIRST
        const { data: { subscription } } = supabase.auth.onAuthStateChange(handleAuthStateChange);
        
        // Try to get session with timeout
        try {
          const sessionPromise = supabase.auth.getSession();
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Session check timeout')), 1500)
          );
          
          const { data: { session }, error } = await Promise.race([sessionPromise, timeoutPromise]) as any;
          console.log('Session check result:', { session, error, hasUser: !!session?.user });
          
          if (session?.user) {
            setAuthState(prev => ({ ...prev, user: session.user }));
            // Don't wait for user details to load - let it happen in background
            fetchUserDetails(session.user);
          }
        } catch (sessionError) {
          console.log('Session check failed, but auth listener is active:', sessionError);
          // Don't fail completely - the auth listener will handle state changes
        }
        
        setAuthState(prev => ({ ...prev, isLoading: false, isInitialized: true }));
        
        return () => subscription.unsubscribe();
      } catch (error) {
        console.error('Error initializing auth:', error);
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