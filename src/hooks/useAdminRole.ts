import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export const useAdminRole = () => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const refreshAdminStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError || !user) {
        setIsAdmin(false);
        setIsLoading(false);
        return;
      }

      const userEmail = user.email;
      
      const { data, error } = await supabase
        .from('users')
        .select('role, is_staff, is_superuser')
        .ilike('email', userEmail || '')
        .single();

      if (error) {
        setIsAdmin(false);
      } else {
        const adminStatus = data?.role === 'admin' || 
          data?.is_staff === true || 
          data?.is_superuser === true;
        
        setIsAdmin(adminStatus);
      }
    } catch (error) {
      setIsAdmin(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const checkAdminRole = async () => {
      try {
        // Use Supabase Auth instead of MSAL
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        
        if (authError || !user) {
          setIsAdmin(false);
          setIsLoading(false);
          return;
        }

        const userEmail = user.email;
        
        // Check if this user exists in our users table
        const { data: allUsers, error: allUsersError } = await supabase
          .from('users')
          .select('email, role, is_staff, is_superuser')
          .ilike('email', userEmail || '');
        
        // Check if the user exists in our users table
        if (!allUsers || allUsers.length === 0) {
          // User not found in custom table, try to sync them
          try {
            const { data: syncResult, error: syncError } = await supabase.rpc('create_user_if_missing', {
              user_email: userEmail
            });
            
            if (syncResult?.success) {
              // Re-check admin role after sync
              const { data: retryData, error: retryError } = await supabase
                .from('users')
                .select('role, is_staff, is_superuser')
                .ilike('email', userEmail || '')
                .single();
              
              if (!retryError && retryData) {
                const adminStatus = retryData?.role === 'admin' || 
                  retryData?.is_staff === true || 
                  retryData?.is_superuser === true;
                
                setIsAdmin(adminStatus);
                return;
              }
            }
          } catch (syncErr) {
            // Silent error handling
          }
          
          setIsAdmin(false);
          return;
        }
        
        const { data, error } = await supabase
          .from('users')
          .select('role, is_staff, is_superuser')
          .ilike('email', userEmail || '')
          .single();

        if (error) {
          setIsAdmin(false);
        } else {
          // User is admin if they have admin role, is_staff, or is_superuser
          const adminStatus = data?.role === 'admin' || 
            data?.is_staff === true || 
            data?.is_superuser === true;
          
          setIsAdmin(adminStatus);
        }
      } catch (error) {
        setIsAdmin(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkAdminRole();
    
    // Set up a listener for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        checkAdminRole();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return { isAdmin, isLoading, refreshAdminStatus };
}; 