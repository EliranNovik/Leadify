import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

// Module-level cache to prevent refetching on every component mount
interface CachedExternalUser {
    isExternalUser: boolean;
    userName: string | null;
    timestamp: number;
    userId: string;
}

let cachedExternalUser: CachedExternalUser | null = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export const useExternalUser = () => {
    const [isExternalUser, setIsExternalUser] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [userName, setUserName] = useState<string | null>(null);

    useEffect(() => {
        const checkExternalUser = async () => {
            try {
                const { data: { user }, error: authError } = await supabase.auth.getUser();
                
                if (authError || !user) {
                    console.error('Error getting auth user:', authError);
                    setIsExternalUser(false);
                    setIsLoading(false);
                    return;
                }

                // Check cache first
                const now = Date.now();
                if (cachedExternalUser && 
                    cachedExternalUser.userId === user.id && 
                    (now - cachedExternalUser.timestamp) < CACHE_DURATION) {
                    // Use cached data
                    setIsExternalUser(cachedExternalUser.isExternalUser);
                    setUserName(cachedExternalUser.userName);
                    setIsLoading(false);
                    return;
                }

                // First, try to find user by auth_id
                let userData = null;
                let userError = null;

                if (user.id) {
                    const { data, error } = await supabase
                        .from('users')
                        .select('extern, first_name, last_name, full_name')
                        .eq('auth_id', user.id)
                        .maybeSingle();
                    
                    userData = data;
                    userError = error;
                }

                // If not found by auth_id, try by email (case-insensitive)
                if ((userError || !userData) && user.email) {
                    const { data, error } = await supabase
                        .from('users')
                        .select('extern, first_name, last_name, full_name')
                        .ilike('email', user.email)
                        .maybeSingle();
                    
                    if (!error && data) {
                        userData = data;
                        userError = null;
                    }
                }

                let finalIsExternal = false;
                let finalUserName: string | null = null;

                if (userData) {
                    finalIsExternal = userData.extern === true || userData.extern === 'true' || userData.extern === 1;

                    // Set user name
                    if (userData.first_name && userData.last_name && userData.first_name.trim() && userData.last_name.trim()) {
                        finalUserName = `${userData.first_name.trim()} ${userData.last_name.trim()}`;
                    } else if (userData.full_name && userData.full_name.trim()) {
                        finalUserName = userData.full_name.trim();
                    } else {
                        finalUserName = user.email;
                    }
                } else {
                    // User not found in users table - default to non-external
                    console.warn('User not found in users table, defaulting to non-external:', user.email);
                    finalIsExternal = false;
                    finalUserName = user.email || null;
                }

                // Update state
                setIsExternalUser(finalIsExternal);
                setUserName(finalUserName);

                // Update cache
                cachedExternalUser = {
                    isExternalUser: finalIsExternal,
                    userName: finalUserName,
                    timestamp: now,
                    userId: user.id
                };
            } catch (error) {
                console.error('Error checking external user status:', error);
                setIsExternalUser(false);
            } finally {
                setIsLoading(false);
            }
        };

        checkExternalUser();
    }, []);

    return { isExternalUser, isLoading, userName };
};
