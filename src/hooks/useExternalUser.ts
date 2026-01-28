import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export const useExternalUser = () => {
    const [isExternalUser, setIsExternalUser] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [userName, setUserName] = useState<string | null>(null);

    useEffect(() => {
        const checkExternalUser = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user?.email) {
                    setIsExternalUser(false);
                    setIsLoading(false);
                    return;
                }

                const { data, error } = await supabase
                    .from('users')
                    .select('extern, first_name, last_name, full_name')
                    .eq('email', user.email)
                    .single();

                if (!error && data) {
                    const isExternal = data.extern === true || data.extern === 'true' || data.extern === 1;
                    setIsExternalUser(isExternal);

                    // Set user name
                    if (data.first_name && data.last_name && data.first_name.trim() && data.last_name.trim()) {
                        setUserName(`${data.first_name.trim()} ${data.last_name.trim()}`);
                    } else if (data.full_name && data.full_name.trim()) {
                        setUserName(data.full_name.trim());
                    } else {
                        setUserName(user.email);
                    }
                } else {
                    setIsExternalUser(false);
                    setUserName(user.email || null);
                }
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
