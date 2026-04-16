import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase, isExpectedNoSessionError } from '../lib/supabase';
import ExternalUserLeadSearch from './ExternalUserLeadSearch';
import ExternalUserLeadsGraph, { buildLeadSourcesOrFilter, parseExternSourceIds } from './ExternalUserLeadsGraph';
import ExternalUserAccessLogs from './ExternalUserAccessLogs';
import { ChartBarIcon } from '@heroicons/react/24/outline';
import { usePersistedState } from '../hooks/usePersistedState';

interface ExternalUserDashboardProps {
    userName: string | null;
    userImage?: string | null;
}

const ExternalUserDashboard: React.FC<ExternalUserDashboardProps> = ({ userName, userImage }) => {
    const [newLeadsCount, setNewLeadsCount] = usePersistedState('externalUserDashboard_newLeadsCount', 0, {
        storage: 'sessionStorage',
    });
    const hasInitializedRef = useRef(false);
    const [accessLogsAuthId, setAccessLogsAuthId] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void supabase.auth.getUser().then(({ data }) => {
            if (!cancelled) setAccessLogsAuthId(data.user?.id ?? null);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    // Fetch new leads count for external users (today only, filtered by extern_source_id)
    useEffect(() => {
        const fetchNewLeadsCount = async () => {
            try {
                // Check cache first - if we have valid cached data, use it and skip fetch
                const cacheKey = 'externalUserDashboard_newLeadsCount_cache_v2';
                const cached = sessionStorage.getItem(cacheKey);
                if (cached) {
                    try {
                        const { count, timestamp, date } = JSON.parse(cached);
                        const now = new Date();
                        const today = now.toDateString();
                        
                        // If cached data is from today and less than 5 minutes old, use it
                        if (date === today && (now.getTime() - timestamp) < 5 * 60 * 1000) {
                            setNewLeadsCount(count);
                            hasInitializedRef.current = true;
                            return;
                        }
                    } catch (e) {
                        // Invalid cache, continue to fetch
                    }
                }
                
                // If we already have persisted state and haven't initialized, check if it's still valid
                if (newLeadsCount > 0 && !hasInitializedRef.current) {
                    hasInitializedRef.current = true;
                    // Check if persisted state is still valid (less than 5 minutes old)
                    if (cached) {
                        try {
                            const { timestamp, date } = JSON.parse(cached);
                            const now = new Date();
                            const today = now.toDateString();
                            
                            if (date === today && (now.getTime() - timestamp) < 5 * 60 * 1000) {
                                return; // Persisted state is still valid
                            }
                        } catch (e) {
                            // Continue to fetch
                        }
                    }
                }

                // Get current user's extern_source_id
                const { data: { user }, error: authError } = await supabase.auth.getUser();
                
                if (authError || !user) {
                    if (authError && !isExpectedNoSessionError(authError)) {
                      console.error('Error getting auth user:', authError);
                    }
                    return;
                }

                // Fetch user data with extern_source_id
                const { data: userData, error: userError } = await supabase
                    .from('users')
                    .select('id, extern_source_id')
                    .eq('auth_id', user.id)
                    .maybeSingle();

                // If not found by auth_id, try by email
                let finalUserData = userData;
                if ((userError || !userData) && user.email) {
                    const { data: userByEmail } = await supabase
                        .from('users')
                        .select('id, extern_source_id')
                        .eq('email', user.email)
                        .maybeSingle();
                    
                    if (userByEmail) {
                        finalUserData = userByEmail;
                    }
                }

                if (!finalUserData?.extern_source_id) {
                    console.log('⚠️ No extern_source_id found for user, setting count to 0');
                    setNewLeadsCount(0);
                    return;
                }

                const sourceIds = parseExternSourceIds(finalUserData.extern_source_id);

                if (sourceIds.length === 0) {
                    console.log('⚠️ No valid source IDs found, setting count to 0');
                    setNewLeadsCount(0);
                    return;
                }

                // Get today's start and end timestamps
                const now = new Date();
                const todayStart = new Date();
                todayStart.setHours(0, 0, 0, 0);
                const startTimestamp = todayStart.toISOString();

                // Set to end of day (23:59:59.999) for today
                now.setHours(23, 59, 59, 999);
                const endTimestamp = now.toISOString();

                // Fetch source names for the allowed IDs
                const { data: allowedSources, error: sourcesError } = await supabase
                    .from('misc_leadsource')
                    .select('id, name')
                    .in('id', sourceIds)
                    .eq('active', true);

                if (sourcesError || !allowedSources || allowedSources.length === 0) {
                    console.error('Error fetching allowed sources:', sourcesError);
                    setNewLeadsCount(0);
                    return;
                }

                const allowedSourceNames = allowedSources.map((s) => String((s as any).name));
                const sourceIdsFromMisc = allowedSources
                    .map((s) => Number((s as any).id))
                    .filter((n) => Number.isFinite(n));
                const sourcesOr = buildLeadSourcesOrFilter(sourceIdsFromMisc, allowedSourceNames);

                // Count new leads: source_id OR text source (aligned with lead search / graphs).
                const { count, error } = await supabase
                    .from('leads')
                    .select('*', { count: 'exact', head: true })
                    .gte('created_at', startTimestamp)
                    .lte('created_at', endTimestamp)
                    .or(sourcesOr);

                if (!error && count !== null) {
                    setNewLeadsCount(count);
                    // Cache the result
                    const cacheData = {
                        count,
                        timestamp: Date.now(),
                        date: new Date().toDateString()
                    };
                    sessionStorage.setItem('externalUserDashboard_newLeadsCount_cache_v2', JSON.stringify(cacheData));
                    hasInitializedRef.current = true;
                } else if (error) {
                    console.error('Error fetching new leads count:', error);
                }
            } catch (error) {
                console.error('Error fetching new leads count:', error);
            }
        };

        if (!hasInitializedRef.current) {
            fetchNewLeadsCount();
        }
    }, []);

    return (
        <div className="min-h-screen bg-white pt-16">
            <div className="container mx-auto px-4 py-6">
                {/* Welcome Message */}
                <div className="mb-6">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="h-11 w-11 overflow-hidden rounded-full border border-gray-200 bg-gray-100">
                            {userImage ? (
                                <img src={userImage} alt="" className="h-full w-full object-cover" />
                            ) : (
                                <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-gray-700">
                                    {(userName || 'U')
                                        .trim()
                                        .split(/\s+/)
                                        .filter(Boolean)
                                        .slice(0, 2)
                                        .map((p) => p[0]?.toUpperCase())
                                        .join('')}
                                </div>
                            )}
                        </div>
                        <h1 className="text-3xl font-bold text-gray-900">
                            Welcome, {userName || 'User'}!
                        </h1>
                    </div>
                    <p className="text-gray-600">Access your leads and manage your cases</p>
                </div>

                {/* Summary Boxes - New Leads and Access Logs */}
                <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* New Leads Box */}
                    <div className="bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 rounded-xl p-6 shadow-lg">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-semibold text-white mb-1">New Leads (Today)</h3>
                                <p className="text-3xl font-bold text-white">{newLeadsCount}</p>
                            </div>
                            <div className="text-white/80">
                                <ChartBarIcon className="w-12 h-12" />
                            </div>
                        </div>
                    </div>

                    {/* Access Logs Box */}
                    <Link to="/access-logs" className="cursor-pointer">
                        {accessLogsAuthId ? (
                            <ExternalUserAccessLogs key={accessLogsAuthId} storageScope={accessLogsAuthId} />
                        ) : (
                            <div className="bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 rounded-xl p-6 shadow-lg">
                                <div className="flex min-h-[88px] items-center justify-center">
                                    <span className="loading loading-spinner loading-md text-white" />
                                </div>
                            </div>
                        )}
                    </Link>
                </div>

                {/* Leads Graph - Last 30 Days */}
                <div className="mb-6">
                    <ExternalUserLeadsGraph />
                </div>

                {/* Lead Search Component */}
                <div className="mt-6">
                    <ExternalUserLeadSearch />
                </div>
            </div>
        </div>
    );
};

export default ExternalUserDashboard;
