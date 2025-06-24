import { useState, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { supabase } from '../lib/supabase';

export const useAdminRole = () => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { accounts } = useMsal();

  useEffect(() => {
    const checkAdminRole = async () => {
      if (!accounts || accounts.length === 0) {
        setIsAdmin(false);
        setIsLoading(false);
        return;
      }

      try {
        const userEmail = accounts[0].username;
        
        const { data, error } = await supabase
          .from('users')
          .select('role')
          .eq('email', userEmail)
          .single();

        if (error) {
          console.error('Error checking admin role:', error);
          setIsAdmin(false);
        } else {
          setIsAdmin(data?.role === 'admin');
        }
      } catch (error) {
        console.error('Error checking admin role:', error);
        setIsAdmin(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkAdminRole();
  }, [accounts]);

  return { isAdmin, isLoading };
}; 