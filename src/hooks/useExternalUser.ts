import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

// Module-level cache to prevent refetching on every component mount
interface CachedExternalUser {
    isExternalUser: boolean;
    userName: string | null;
    userImage: string | null;
    timestamp: number;
    userId: string;
}

let cachedExternalUser: CachedExternalUser | null = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Flag to track if check is in progress (prevents duplicate checks)
let checkInProgress = false;
let checkPromise: Promise<CachedExternalUser | null> | null = null;

/**
 * Pre-check external user status in the background
 * This can be called early (e.g., during login) to start the check
 * Returns a promise that resolves when the check is complete
 */
export const preCheckExternalUser = async (userId?: string): Promise<void> => {
    // If already checking, wait for that check to complete
    if (checkInProgress && checkPromise) {
        await checkPromise;
        return;
    }

    // If we have valid cached data, no need to check
    if (cachedExternalUser) {
        const now = Date.now();
        if ((now - cachedExternalUser.timestamp) < CACHE_DURATION) {
            // Check if userId matches if provided
            if (!userId || cachedExternalUser.userId === userId) {
                return; // Cache is valid
            }
        }
    }

    checkInProgress = true;
    checkPromise = (async () => {
        try {
            // Get auth user
            const { data: { user }, error: authError } = await supabase.auth.getUser();
            
            if (authError || !user) {
                return null;
            }

            // If userId provided, verify it matches
            if (userId && user.id !== userId) {
                return null;
            }

            // Check cache again (might have been updated by another call)
            const now = Date.now();
            if (cachedExternalUser && 
                cachedExternalUser.userId === user.id && 
                (now - cachedExternalUser.timestamp) < CACHE_DURATION) {
                return cachedExternalUser;
            }

            // Quick check for extern field
            const { data: userDataQuick, error: quickError } = await supabase
                .from('users')
                .select('extern')
                .eq('auth_id', user.id)
                .maybeSingle();
            
            if (!quickError && userDataQuick) {
                const externValue = userDataQuick.extern;
                const isExternal = externValue === true || 
                                 externValue === 'true' || 
                                 externValue === 1 || 
                                 externValue === '1' ||
                                 (typeof externValue === 'string' && externValue.toLowerCase() === 'true');
                
                // Create initial cache entry
                cachedExternalUser = {
                    isExternalUser: isExternal,
                    userName: user.email || null,
                    userImage: null,
                    timestamp: now,
                    userId: user.id
                };

                // If external, fetch full data in background (non-blocking)
                if (isExternal) {
                    // Fetch full data asynchronously without blocking
                    (async () => {
                        try {
                            const [userQuery, employeeQuery] = await Promise.all([
                                (async () => {
                                    try {
                                        return await supabase
                                            .from('users')
                                            .select('extern, first_name, last_name, full_name, employee_id')
                                            .eq('auth_id', user.id)
                                            .maybeSingle();
                                    } catch (err) {
                                        return { data: null, error: err };
                                    }
                                })(),
                                user.email ? (async () => {
                                    try {
                                        return await supabase
                                            .from('users')
                                            .select(`
                                                employee_id,
                                                tenants_employee!users_employee_id_fkey(
                                                    official_name,
                                                    display_name,
                                                    photo_url
                                                )
                                            `)
                                            .eq('email', user.email)
                                            .maybeSingle();
                                    } catch (err) {
                                        return { data: null, error: null };
                                    }
                                })() : Promise.resolve({ data: null, error: null })
                            ]);
                            
                            const fullUserData = userQuery.data;
                            const employeeData = employeeQuery.data;
                            
                            let finalUserName: string | null = user.email || null;
                            let finalUserImage: string | null = null;
                            
                            if (fullUserData) {
                                // Priority 1: full_name from users table
                                if (fullUserData.full_name?.trim()) {
                                    finalUserName = fullUserData.full_name.trim();
                                }
                                
                                // Priority 2: Employee official_name or display_name
                                if (employeeData?.tenants_employee) {
                                    const emp = Array.isArray(employeeData.tenants_employee) 
                                        ? employeeData.tenants_employee[0] 
                                        : employeeData.tenants_employee;
                                    if (emp?.photo_url) finalUserImage = emp.photo_url;
                                    
                                    if (!finalUserName || finalUserName === user.email) {
                                        if (emp?.official_name?.trim()) {
                                            finalUserName = emp.official_name.trim();
                                        } else if (emp?.display_name?.trim()) {
                                            finalUserName = emp.display_name.trim();
                                        }
                                    }
                                }
                                
                                // Priority 3: first_name + last_name
                                if (!finalUserName || finalUserName === user.email) {
                                    if (fullUserData.first_name && fullUserData.last_name) {
                                        finalUserName = `${fullUserData.first_name.trim()} ${fullUserData.last_name.trim()}`;
                                    }
                                }
                            }
                            
                            // Update cache with full data
                            cachedExternalUser = {
                                isExternalUser: true,
                                userName: finalUserName,
                                userImage: finalUserImage,
                                timestamp: Date.now(),
                                userId: user.id
                            };
                        } catch (err) {
                            console.error('Error fetching full external user data:', err);
                        }
                    })();
                }
                
                return cachedExternalUser;
            }

            // Fallback to email check
            if (user.email) {
                const { data: emailDataQuick, error: emailQuickError } = await supabase
                    .from('users')
                    .select('extern')
                    .ilike('email', user.email)
                    .maybeSingle();
                
                if (!emailQuickError && emailDataQuick) {
                    const externValue = emailDataQuick.extern;
                    const isExternal = externValue === true || 
                                     externValue === 'true' || 
                                     externValue === 1 || 
                                     externValue === '1' ||
                                     (typeof externValue === 'string' && externValue.toLowerCase() === 'true');
                    
                    cachedExternalUser = {
                        isExternalUser: isExternal,
                        userName: user.email || null,
                        userImage: null,
                        timestamp: now,
                        userId: user.id
                    };
                    
                    return cachedExternalUser;
                }
            }

            return null;
        } catch (error) {
            console.error('Error in preCheckExternalUser:', error);
            return null;
        } finally {
            checkInProgress = false;
            checkPromise = null;
        }
    })();

    await checkPromise;
};

export const useExternalUser = () => {
    const [isExternalUser, setIsExternalUser] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(true); // Start as true to prevent flash
    const [userName, setUserName] = useState<string | null>(null);
    const [userImage, setUserImage] = useState<string | null>(null);

    useEffect(() => {
        const checkExternalUser = async () => {
            try {
                // Get auth user first (fast)
                const { data: { user }, error: authError } = await supabase.auth.getUser();
                
                if (authError || !user) {
                    console.error('Error getting auth user:', authError);
                    setIsExternalUser(false);
                    setIsLoading(false);
                    return;
                }

                // Check cache first - this is fast and prevents flash
                const now = Date.now();
                if (cachedExternalUser && 
                    cachedExternalUser.userId === user.id && 
                    (now - cachedExternalUser.timestamp) < CACHE_DURATION) {
                    // Use cached data immediately - no loading needed
                    setIsExternalUser(cachedExternalUser.isExternalUser);
                    setUserName(cachedExternalUser.userName);
                    setUserImage(cachedExternalUser.userImage);
                    setIsLoading(false);
                    return;
                }

                // If check is in progress, wait for it
                if (checkInProgress && checkPromise) {
                    const result = await checkPromise;
                    if (result && result.userId === user.id) {
                        setIsExternalUser(result.isExternalUser);
                        setUserName(result.userName);
                        setUserImage(result.userImage);
                        setIsLoading(false);
                        return;
                    }
                }

                // Optimize: Only fetch extern field first to determine if external (fastest check)
                // Then fetch other data if needed
                const { data: userDataQuick, error: quickError } = await supabase
                    .from('users')
                    .select('extern')
                    .eq('auth_id', user.id)
                    .maybeSingle();
                
                // Log for debugging external user issues
                if (quickError) {
                    console.warn('Quick extern check error (will try fallback):', quickError);
                }
                
                if (!quickError && userDataQuick) {
                    // Handle various formats of extern field: true, 'true', 1, '1', etc.
                    const externValue = userDataQuick.extern;
                    const isExternal = externValue === true || 
                                     externValue === 'true' || 
                                     externValue === 1 || 
                                     externValue === '1' ||
                                     (typeof externValue === 'string' && externValue.toLowerCase() === 'true');
                    console.log('External user check result:', { 
                        userId: user.id, 
                        extern: externValue, 
                        isExternal,
                        type: typeof externValue 
                    });
                    setIsExternalUser(isExternal);
                    setIsLoading(false); // Set loading false immediately after extern check
                    
                    // Update cache immediately with extern status
                    cachedExternalUser = {
                        isExternalUser: isExternal,
                        userName: user.email || null,
                        userImage: null,
                        timestamp: now,
                        userId: user.id
                    };
                    
                    // Fetch full user data in background (non-blocking)
                    if (isExternal) {
                        // Only fetch full data if external user
                        const [userQuery, employeeQuery] = await Promise.all([
                            (async () => {
                                try {
                                    return await supabase
                                        .from('users')
                                        .select('extern, first_name, last_name, full_name, employee_id')
                                        .eq('auth_id', user.id)
                                        .maybeSingle();
                                } catch (err) {
                                    return { data: null, error: err };
                                }
                            })(),
                            user.email ? (async () => {
                                try {
                                    return await supabase
                                        .from('users')
                                        .select(`
                                            employee_id,
                                            tenants_employee!users_employee_id_fkey(
                                                official_name,
                                                display_name,
                                                photo_url
                                            )
                                        `)
                                        .eq('email', user.email)
                                        .maybeSingle();
                                } catch (err) {
                                    return { data: null, error: null };
                                }
                            })() : Promise.resolve({ data: null, error: null })
                        ]);
                        
                        const fullUserData = userQuery.data;
                        const employeeData = employeeQuery.data;
                        
                        let finalUserName: string | null = user.email || null;
                        let finalUserImage: string | null = null;
                        
                        if (fullUserData) {
                            // Priority 1: full_name from users table
                            if (fullUserData.full_name?.trim()) {
                                finalUserName = fullUserData.full_name.trim();
                            }
                            
                            // Priority 2: Employee official_name or display_name
                            if (employeeData?.tenants_employee) {
                                const emp = Array.isArray(employeeData.tenants_employee) 
                                    ? employeeData.tenants_employee[0] 
                                    : employeeData.tenants_employee;
                                if (emp?.photo_url) finalUserImage = emp.photo_url;
                                
                                // Only use employee name if full_name wasn't found
                                if (!finalUserName || finalUserName === user.email) {
                                    if (emp?.official_name?.trim()) {
                                        finalUserName = emp.official_name.trim();
                                    } else if (emp?.display_name?.trim()) {
                                        finalUserName = emp.display_name.trim();
                                    }
                                }
                            }
                            
                            // Priority 3: first_name + last_name (only if full_name not available)
                            if (!finalUserName || finalUserName === user.email) {
                                if (fullUserData.first_name && fullUserData.last_name) {
                                    finalUserName = `${fullUserData.first_name.trim()} ${fullUserData.last_name.trim()}`;
                                }
                            }
                        }
                        
                        setUserName(finalUserName);
                        setUserImage(finalUserImage);
                        
                        // Update cache with full data
                        cachedExternalUser = {
                            isExternalUser: true,
                            userName: finalUserName,
                            userImage: finalUserImage,
                            timestamp: now,
                            userId: user.id
                        };
                    }
                    return;
                }
                
                // Fallback to email if auth_id fails
                if (user.email) {
                    const { data: emailDataQuick, error: emailQuickError } = await supabase
                        .from('users')
                        .select('extern')
                        .ilike('email', user.email)
                        .maybeSingle();
                    
                    if (emailQuickError) {
                        console.warn('Email extern check error (will try full query):', emailQuickError);
                    }
                    
                    if (!emailQuickError && emailDataQuick) {
                        // Handle various formats of extern field: true, 'true', 1, '1', etc.
                        const externValue = emailDataQuick.extern;
                        const isExternal = externValue === true || 
                                         externValue === 'true' || 
                                         externValue === 1 || 
                                         externValue === '1' ||
                                         (typeof externValue === 'string' && externValue.toLowerCase() === 'true');
                        console.log('External user check result (email fallback):', { 
                            email: user.email, 
                            extern: externValue, 
                            isExternal,
                            type: typeof externValue 
                        });
                        setIsExternalUser(isExternal);
                        setIsLoading(false);
                        cachedExternalUser = {
                            isExternalUser: isExternal,
                            userName: user.email || null,
                            userImage: null,
                            timestamp: now,
                            userId: user.id
                        };
                        
                        // Fetch full user data in background if external
                        if (isExternal) {
                            (async () => {
                                try {
                                    const [userQuery, employeeQuery] = await Promise.all([
                                        supabase
                                            .from('users')
                                            .select('extern, first_name, last_name, full_name, employee_id')
                                            .ilike('email', user.email)
                                            .maybeSingle()
                                            .catch(() => ({ data: null, error: null })),
                                        supabase
                                            .from('users')
                                            .select(`
                                                employee_id,
                                                tenants_employee!users_employee_id_fkey(
                                                    official_name,
                                                    display_name,
                                                    photo_url
                                                )
                                            `)
                                            .eq('email', user.email)
                                            .maybeSingle()
                                            .catch(() => ({ data: null, error: null }))
                                    ]);
                                    
                                    const fullUserData = userQuery.data;
                                    const employeeData = employeeQuery.data;
                                    
                                    let finalUserName: string | null = user.email || null;
                                    let finalUserImage: string | null = null;
                                    
                                    if (fullUserData) {
                                        // Priority 1: full_name from users table
                                        if (fullUserData.full_name?.trim()) {
                                            finalUserName = fullUserData.full_name.trim();
                                        }
                                        
                                        // Priority 2: Employee official_name or display_name
                                        if (employeeData?.tenants_employee) {
                                            const emp = Array.isArray(employeeData.tenants_employee) 
                                                ? employeeData.tenants_employee[0] 
                                                : employeeData.tenants_employee;
                                            if (emp?.photo_url) finalUserImage = emp.photo_url;
                                            
                                            // Only use employee name if full_name wasn't found
                                            if (!finalUserName || finalUserName === user.email) {
                                                if (emp?.official_name?.trim()) {
                                                    finalUserName = emp.official_name.trim();
                                                } else if (emp?.display_name?.trim()) {
                                                    finalUserName = emp.display_name.trim();
                                                }
                                            }
                                        }
                                        
                                        // Priority 3: first_name + last_name (only if full_name not available)
                                        if (!finalUserName || finalUserName === user.email) {
                                            if (fullUserData.first_name && fullUserData.last_name) {
                                                finalUserName = `${fullUserData.first_name.trim()} ${fullUserData.last_name.trim()}`;
                                            }
                                        }
                                    }
                                    
                                    setUserName(finalUserName);
                                    setUserImage(finalUserImage);
                                    
                                    cachedExternalUser = {
                                        isExternalUser: true,
                                        userName: finalUserName,
                                        userImage: finalUserImage,
                                        timestamp: now,
                                        userId: user.id
                                    };
                                } catch (err) {
                                    console.error('Error fetching full user data in background:', err);
                                }
                            })();
                        }
                        return;
                    }
                }

                // Fetch user data and employee data in parallel for speed
                const userQueryPromise = user.id ? (async () => {
                    try {
                        const { data, error } = await supabase
                            .from('users')
                            .select('extern, first_name, last_name, full_name, employee_id')
                            .eq('auth_id', user.id)
                            .maybeSingle();
                        
                        if (!error && data) return { data, error: null };
                        
                        // Fallback to email if auth_id fails
                        if (user.email) {
                            const { data: emailData, error: emailError } = await supabase
                                .from('users')
                                .select('extern, first_name, last_name, full_name, employee_id')
                                .ilike('email', user.email)
                                .maybeSingle();
                            return { data: emailData, error: emailError };
                        }
                        return { data: null, error };
                    } catch (err) {
                        return { data: null, error: err };
                    }
                })() : Promise.resolve({ data: null, error: null });
                
                const employeeQueryPromise = user.email ? (async () => {
                    try {
                        const { data, error } = await supabase
                            .from('users')
                            .select(`
                                employee_id,
                                tenants_employee!users_employee_id_fkey(
                                    official_name,
                                    display_name,
                                    photo_url
                                )
                            `)
                            .eq('email', user.email)
                            .maybeSingle();
                        return { data, error };
                    } catch (err) {
                        // Don't fail if employee query fails
                        return { data: null, error: null };
                    }
                })() : Promise.resolve({ data: null, error: null });
                
                const [userQuery, employeeQuery] = await Promise.all([
                    userQueryPromise,
                    employeeQueryPromise
                ]);

                const userData = userQuery.data;
                const employeeData = employeeQuery.data;

                let finalIsExternal = false;
                let finalUserName: string | null = null;
                let finalUserImage: string | null = null;

                if (userQuery.error) {
                    console.error('Full user query error:', userQuery.error);
                }

                if (userData) {
                    // Handle various formats of extern field: true, 'true', 1, '1', etc.
                    const externValue = userData.extern;
                    finalIsExternal = externValue === true || 
                                    externValue === 'true' || 
                                    externValue === 1 || 
                                    externValue === '1' ||
                                    (typeof externValue === 'string' && externValue.toLowerCase() === 'true');
                    console.log('External user check result (full query):', { 
                        userId: user.id,
                        email: user.email,
                        extern: externValue, 
                        isExternal: finalIsExternal,
                        type: typeof externValue,
                        rawValue: JSON.stringify(externValue)
                    });

                    // Priority 1: full_name from users table
                    if (userData.full_name?.trim()) {
                        finalUserName = userData.full_name.trim();
                    }
                    
                    // Priority 2: Employee official_name or display_name
                    if (employeeData?.tenants_employee) {
                        const emp = Array.isArray(employeeData.tenants_employee) 
                            ? employeeData.tenants_employee[0] 
                            : employeeData.tenants_employee;
                        
                        if (emp?.photo_url) {
                            finalUserImage = emp.photo_url;
                        }
                        
                        // Only use employee name if full_name wasn't found
                        if (!finalUserName || finalUserName === user.email) {
                            if (emp?.official_name?.trim()) {
                                finalUserName = emp.official_name.trim();
                            } else if (emp?.display_name?.trim()) {
                                finalUserName = emp.display_name.trim();
                            }
                        }
                    }

                    // Priority 3: first_name + last_name (only if full_name not available)
                    if (!finalUserName || finalUserName === user.email) {
                        if (userData.first_name && userData.last_name && userData.first_name.trim() && userData.last_name.trim()) {
                            finalUserName = `${userData.first_name.trim()} ${userData.last_name.trim()}`;
                        } else if (!finalUserName) {
                            finalUserName = user.email;
                        }
                    }
                } else {
                    // User not found in users table - default to non-external
                    // This could indicate a data issue - user exists in auth but not in users table
                    console.warn('⚠️ User not found in users table, defaulting to non-external:', {
                        userId: user.id,
                        email: user.email,
                        userQueryError: userQuery.error,
                        employeeQueryError: employeeQuery.error
                    });
                    finalIsExternal = false;
                    finalUserName = user.email || null;
                }

                // Update state
                setIsExternalUser(finalIsExternal);
                setUserName(finalUserName);
                setUserImage(finalUserImage);

                // Update cache
                cachedExternalUser = {
                    isExternalUser: finalIsExternal,
                    userName: finalUserName,
                    userImage: finalUserImage,
                    timestamp: now,
                    userId: user.id
                };
            } catch (error) {
                console.error('❌ Error checking external user status:', error);
                // On error, check cache first - if we have cached data, use it
                if (cachedExternalUser && cachedExternalUser.userId === user?.id) {
                    console.log('Using cached external user data due to error');
                    setIsExternalUser(cachedExternalUser.isExternalUser);
                    setUserName(cachedExternalUser.userName);
                    setUserImage(cachedExternalUser.userImage);
                    setIsLoading(false);
                } else {
                    // Only default to false if we have no cached data and an error occurred
                    // This is a last resort - ideally errors should be handled by fallback queries
                    console.warn('No cached data available, defaulting to non-external due to error');
                    setIsExternalUser(false);
                    setIsLoading(false);
                }
            }
        };

        checkExternalUser();
    }, []);

    return { isExternalUser, isLoading, userName, userImage };
};
