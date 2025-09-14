import { useState, useEffect, useCallback } from 'react';
import { supabase, sessionManager } from '../lib/supabase';

interface User {
  id: string;
  email: string;
  user_metadata?: any;
}

interface AuthState {
  user: User | null;
  userFullName: string | null;
  userInitials: string | null;
  isLoading: boolean;
  isInitialized: boolean;
}

export const useAuth = () => {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    userFullName: null,
    userInitials: null,
    isLoading: true,
    isInitialized: false,
  });

  const fetchUserDetails = useCallback(async (user: User, retryCount = 0): Promise<void> => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('first_name, last_name, full_name')
        .eq('email', user.email)
        .single();

      if (!error && data) {
        let fullName = '';
        if (data.first_name && data.last_name && data.first_name.trim() && data.last_name.trim()) {
          fullName = `${data.first_name.trim()} ${data.last_name.trim()}`;
        } else if (data.full_name && data.full_name.trim()) {
          fullName = data.full_name.trim();
        } else {
          fullName = user.email;
        }

        const initials = fullName.split(' ').map((n: string) => n[0]).join('');
        setAuthState(prev => ({
          ...prev,
          userFullName: fullName,
          userInitials: initials,
        }));
      } else {
        // Fallback to auth metadata
        if (user.user_metadata?.first_name || user.user_metadata?.full_name) {
          const authName = user.user_metadata.first_name || user.user_metadata.full_name;
          const initials = authName.split(' ').map((n: string) => n[0]).join('');
          setAuthState(prev => ({
            ...prev,
            userFullName: authName,
            userInitials: initials,
          }));
        } else {
          setAuthState(prev => ({
            ...prev,
            userFullName: user.email,
            userInitials: user.email.charAt(0).toUpperCase(),
          }));
        }
      }
    } catch (error) {
      console.error('Error fetching user details:', error);
      
      // Retry logic for network errors
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (retryCount < 3 && (errorMessage.includes('network') || errorMessage.includes('timeout'))) {
        setTimeout(() => fetchUserDetails(user, retryCount + 1), 1000 * (retryCount + 1));
        return;
      }
      
      // Fallback
      setAuthState(prev => ({
        ...prev,
        userFullName: user.email,
        userInitials: user.email.charAt(0).toUpperCase(),
      }));
    }
  }, []);

  const handleAuthStateChange = useCallback(async (event: string, session: any) => {
    try {
      switch (event) {
        case 'INITIAL_SESSION':
          if (session?.user) {
            setAuthState(prev => ({ ...prev, user: session.user, isLoading: false }));
            await fetchUserDetails(session.user);
          } else {
            setAuthState(prev => ({ 
              ...prev, 
              user: null, 
              userFullName: null, 
              userInitials: null, 
              isLoading: false 
            }));
          }
          setAuthState(prev => ({ ...prev, isInitialized: true }));
          break;

        case 'SIGNED_IN':
          if (session?.user) {
            setAuthState(prev => ({ ...prev, user: session.user, isLoading: false }));
            await fetchUserDetails(session.user);
          }
          break;

        case 'SIGNED_OUT':
          setAuthState({
            user: null,
            userFullName: null,
            userInitials: null,
            isLoading: false,
            isInitialized: true,
          });
          window.location.href = '/login';
          break;

        case 'TOKEN_REFRESHED':
          if (session?.user) {
            setAuthState(prev => ({ ...prev, user: session.user }));
            await fetchUserDetails(session.user);
          }
          break;

        case 'USER_UPDATED':
          if (session?.user) {
            setAuthState(prev => ({ ...prev, user: session.user }));
            await fetchUserDetails(session.user);
          }
          break;

        default:
          setAuthState(prev => ({ 
            ...prev, 
            user: session?.user ?? null, 
            isLoading: false 
          }));
          if (session?.user) {
            await fetchUserDetails(session.user);
          }
          break;
      }
    } catch (error) {
      console.error('Error handling auth state change:', error);
      setAuthState(prev => ({ ...prev, isLoading: false }));
    }
  }, [fetchUserDetails]);

  useEffect(() => {
    let authSubscription: any = null;

    const initializeAuth = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('Error getting initial session:', error);
          setAuthState({
            user: null,
            userFullName: null,
            userInitials: null,
            isLoading: false,
            isInitialized: true,
          });
          return;
        }

        await handleAuthStateChange('INITIAL_SESSION', session);

        const { data: { subscription } } = supabase.auth.onAuthStateChange(handleAuthStateChange);
        authSubscription = subscription;
      } catch (error) {
        console.error('Error initializing auth:', error);
        setAuthState({
          user: null,
          userFullName: null,
          userInitials: null,
          isLoading: false,
          isInitialized: true,
        });
      }
    };

    initializeAuth();

    return () => {
      if (authSubscription) {
        authSubscription.unsubscribe();
      }
    };
  }, [handleAuthStateChange]);

  // Session monitoring is handled in App.tsx to avoid conflicts

  return authState;
}; 