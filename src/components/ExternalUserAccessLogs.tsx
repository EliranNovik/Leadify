import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { DocumentTextIcon, CalendarIcon, ClockIcon } from '@heroicons/react/24/outline';
import { usePersistedState, usePersistedFilters } from '../hooks/usePersistedState';

interface AccessLog {
    id: number;
    created_at: string;
    request_method: string;
    endpoint: string;
    request_body: string;
    response_body: string;
    response_code: number;
}

interface ExpandedRow {
    [key: number]: boolean;
}

interface ExternalUserAccessLogsProps {
    onBack?: () => void;
    showFullView?: boolean;
}

const ExternalUserAccessLogs: React.FC<ExternalUserAccessLogsProps> = ({ onBack, showFullView = false }) => {
    const [accessLogsCount, setAccessLogsCount] = usePersistedState('externalUserAccessLogs_count', 0, {
        storage: 'sessionStorage',
    });
    const [logs, setLogs] = useState<AccessLog[]>([]);
    const [logsByDay, setLogsByDay] = useState<{ [key: string]: AccessLog[] }>({});
    const [availableDays, setAvailableDays] = useState<string[]>([]);
    const [currentDayIndex, setCurrentDayIndex] = usePersistedState('externalUserAccessLogs_currentDayIndex', 0, {
        storage: 'sessionStorage',
    });
    const [loading, setLoading] = useState(true);
    const [loadingLogs, setLoadingLogs] = useState(false);
    const [expandedRows, setExpandedRows] = useState<ExpandedRow>({});
    const [allowedSourceIds, setAllowedSourceIds] = useState<number[]>([]);
    const hasInitializedRef = useRef(false);
    const [filters, setFilters] = usePersistedFilters('externalUserAccessLogs_filters', {
        dateFrom: '',
        dateTo: ''
    }, {
        storage: 'sessionStorage',
    });

    // Fetch user's allowed source IDs
    useEffect(() => {
        const fetchAllowedSourceIds = async () => {
            try {
                const { data: { user }, error: authError } = await supabase.auth.getUser();
                
                if (authError || !user) {
                    console.error('Error getting auth user:', authError);
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
                    console.log('⚠️ No extern_source_id found for user');
                    setAllowedSourceIds([]);
                    return;
                }

                // Extract source IDs from extern_source_id
                let sourceIds: number[] = [];
                
                if (Array.isArray(finalUserData.extern_source_id)) {
                    sourceIds = finalUserData.extern_source_id.filter(id => typeof id === 'number');
                } else if (typeof finalUserData.extern_source_id === 'string') {
                    try {
                        const parsed = JSON.parse(finalUserData.extern_source_id);
                        if (Array.isArray(parsed)) {
                            sourceIds = parsed.filter(id => typeof id === 'number');
                        }
                    } catch (e) {
                        console.error('Error parsing extern_source_id:', e);
                    }
                }

                if (sourceIds.length === 0) {
                    setAllowedSourceIds([]);
                    return;
                }

                // Use the source IDs directly (no need to fetch codes)
                setAllowedSourceIds(sourceIds);
            } catch (error) {
                console.error('Error fetching allowed source IDs:', error);
                setAllowedSourceIds([]);
            }
        };

        fetchAllowedSourceIds();
    }, []);

    // Fetch access logs count (last 30 days)
    useEffect(() => {
        const fetchAccessLogsCount = async () => {
            if (allowedSourceIds.length === 0) {
                setAccessLogsCount(0);
                setLoading(false);
                return;
            }

            // Check cache first - if we have valid cached data, use it and skip fetch
            const cacheKey = 'externalUserAccessLogs_count_cache';
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) {
                try {
                    const { count, timestamp } = JSON.parse(cached);
                    const now = Date.now();
                    
                    // If cached data is less than 5 minutes old, use it
                    if ((now - timestamp) < 5 * 60 * 1000) {
                        setAccessLogsCount(count);
                        setLoading(false);
                        hasInitializedRef.current = true;
                        return;
                    }
                } catch (e) {
                    // Invalid cache, continue to fetch
                }
            }
            
            // If we already have persisted state and haven't initialized, check if it's still valid
            if (accessLogsCount > 0 && !hasInitializedRef.current) {
                hasInitializedRef.current = true;
                setLoading(false);
                // Check if persisted state is still valid (less than 5 minutes old)
                if (cached) {
                    try {
                        const { timestamp } = JSON.parse(cached);
                        const now = Date.now();
                        
                        if ((now - timestamp) < 5 * 60 * 1000) {
                            return; // Persisted state is still valid
                        }
                    } catch (e) {
                        // Continue to fetch
                    }
                }
            }

            try {
                setLoading(true);
                
                // Get date range for last 30 days
                const now = new Date();
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(now.getDate() - 30);
                thirtyDaysAgo.setHours(0, 0, 0, 0);
                const startTimestamp = thirtyDaysAgo.toISOString();
                const endTimestamp = now.toISOString();

                // Fetch all access logs for hook endpoints in the last 30 days
                const { data, error } = await supabase
                    .from('access_logs')
                    .select('id, response_body')
                    .in('endpoint', ['/api/hook/catch', '/api/hook/facebook'])
                    .gte('created_at', startTimestamp)
                    .lte('created_at', endTimestamp);

                if (error) {
                    console.error('Error fetching access logs count:', error);
                    setAccessLogsCount(0);
                } else {
                    // Filter by source_id in response_body.data.source_id
                    const filteredLogs = (data || []).filter(log => {
                        if (!log.response_body) return false;
                        try {
                            const parsed = JSON.parse(log.response_body);
                            // Check response_body.data.source_id
                            const sourceId = parsed?.data?.source_id;
                            return sourceId && allowedSourceIds.includes(Number(sourceId));
                        } catch {
                            return false;
                        }
                    });
                    const count = filteredLogs.length;
                    setAccessLogsCount(count);
                    // Cache the result
                    const cacheData = {
                        count,
                        timestamp: Date.now()
                    };
                    sessionStorage.setItem('externalUserAccessLogs_count_cache', JSON.stringify(cacheData));
                    hasInitializedRef.current = true;
                }
            } catch (error) {
                console.error('Error fetching access logs count:', error);
                setAccessLogsCount(0);
            } finally {
                setLoading(false);
            }
        };

        if (allowedSourceIds.length > 0 && !hasInitializedRef.current) {
            fetchAccessLogsCount();
        }
    }, [allowedSourceIds]);

    // Fetch access logs with filters
    const fetchLogs = async () => {
        if (allowedSourceIds.length === 0) {
            setLogs([]);
            return;
        }

        try {
            setLoadingLogs(true);

            let query = supabase
                .from('access_logs')
                .select('*', { count: 'exact' })
                .in('endpoint', ['/api/hook/catch', '/api/hook/facebook'])
                .order('created_at', { ascending: false });

            // Apply date filters
            if (filters.dateFrom) {
                query = query.gte('created_at', filters.dateFrom);
            }
            if (filters.dateTo) {
                // Add time to end of day
                const endDate = new Date(filters.dateTo);
                endDate.setHours(23, 59, 59, 999);
                query = query.lte('created_at', endDate.toISOString());
            }

            // Fetch all matching logs (we'll filter by source_id client-side)
            const { data, error } = await query;

            if (error) {
                console.error('Error fetching access logs:', error);
                setLogs([]);
                return;
            }

            // Filter by source_id in response_body.data.source_id
            const filteredLogs = (data || []).filter(log => {
                if (!log.response_body) return false;
                try {
                    const parsed = JSON.parse(log.response_body);
                    // Check response_body.data.source_id
                    const sourceId = parsed?.data?.source_id;
                    return sourceId && allowedSourceIds.includes(Number(sourceId));
                } catch {
                    return false;
                }
            });

            setLogs(filteredLogs);

            // Group logs by day
            const groupedByDay: { [key: string]: AccessLog[] } = {};
            filteredLogs.forEach(log => {
                const logDate = new Date(log.created_at);
                const dayKey = logDate.toISOString().split('T')[0]; // YYYY-MM-DD format
                if (!groupedByDay[dayKey]) {
                    groupedByDay[dayKey] = [];
                }
                groupedByDay[dayKey].push(log);
            });

            // Sort logs within each day by time (newest first)
            Object.keys(groupedByDay).forEach(dayKey => {
                groupedByDay[dayKey].sort((a, b) => 
                    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                );
            });

            // Sort days in descending order (newest first)
            const sortedDays = Object.keys(groupedByDay).sort((a, b) => b.localeCompare(a));
            setAvailableDays(sortedDays);
            setLogsByDay(groupedByDay);
            
            // Only reset to 0 if the persisted index is out of bounds
            if (sortedDays.length > 0) {
                setCurrentDayIndex(prev => {
                    // If persisted index is valid, keep it; otherwise use 0
                    return (prev >= 0 && prev < sortedDays.length) ? prev : 0;
                });
            }
        } catch (error) {
            console.error('Error fetching access logs:', error);
            setLogs([]);
        } finally {
            setLoadingLogs(false);
        }
    };

    useEffect(() => {
        if (showFullView && allowedSourceIds.length > 0) {
            fetchLogs();
        }
    }, [showFullView, filters, allowedSourceIds]);

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        
        return {
            date: `${day}/${month}/${year}`,
            time: `${hours}:${minutes}`
        };
    };

    const getResponseCodeColor = (code: number) => {
        if (code >= 200 && code < 300) return 'text-green-600';
        if (code >= 400 && code < 500) return 'text-yellow-600';
        if (code >= 500) return 'text-red-600';
        return 'text-gray-600';
    };

    const getMethodColor = (method: string) => {
        switch (method.toUpperCase()) {
            case 'GET': return 'bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white';
            case 'POST': return 'bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white';
            case 'PUT': return 'bg-yellow-100 text-yellow-800';
            case 'DELETE': return 'bg-red-100 text-red-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    const toggleRowExpansion = (logId: number) => {
        setExpandedRows(prev => ({
            ...prev,
            [logId]: !prev[logId]
        }));
    };

    const formatJson = (jsonString: string) => {
        try {
            const parsed = JSON.parse(jsonString);
            return JSON.stringify(parsed, null, 2);
        } catch {
            return jsonString;
        }
    };

    // Get current day's logs
    const currentDay = availableDays[currentDayIndex] || '';
    const currentDayLogs = logsByDay[currentDay] || [];

    // Format day for display
    const formatDayDisplay = (dayKey: string) => {
        if (!dayKey) return '';
        const date = new Date(dayKey);
        return date.toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
    };

    // If showing full view, render the full logs table
    if (showFullView) {
        return (
            <div className="w-full">
                {/* Date Filters */}
                <div className="bg-white p-4 rounded-lg shadow-sm mb-6">
                    <h3 className="text-lg font-semibold mb-4">Filters</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
                            <input
                                type="date"
                                value={filters.dateFrom}
                                onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
                            <input
                                type="date"
                                value={filters.dateTo}
                                onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value }))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div className="flex items-end">
                            <button
                                onClick={() => setFilters({ dateFrom: '', dateTo: '' })}
                                className="w-full px-4 py-2 bg-white text-black border border-black rounded-md hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-500"
                            >
                                Clear Filters
                            </button>
                        </div>
                    </div>
                </div>

                {/* Day Navigation */}
                {availableDays.length > 0 && (
                    <div className="bg-white p-4 rounded-lg shadow-sm mb-6">
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setCurrentDayIndex(prev => Math.max(0, prev - 1))}
                                    disabled={currentDayIndex === 0}
                                    className="btn btn-sm btn-ghost"
                                >
                                    ← Previous Day
                                </button>
                                <div className="text-lg font-semibold text-gray-900 min-w-[200px] text-center">
                                    {formatDayDisplay(currentDay)}
                                </div>
                                <button
                                    onClick={() => setCurrentDayIndex(prev => Math.min(availableDays.length - 1, prev + 1))}
                                    disabled={currentDayIndex === availableDays.length - 1}
                                    className="btn btn-sm btn-ghost"
                                >
                                    Next Day →
                                </button>
                            </div>
                            <div className="text-sm text-gray-600">
                                Day {currentDayIndex + 1} of {availableDays.length} ({currentDayLogs.length} logs)
                            </div>
                        </div>
                    </div>
                )}

                {/* Logs Table */}
                <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                    {loadingLogs ? (
                        <div className="p-8 text-center">
                            <div className="loading loading-spinner loading-lg text-primary"></div>
                            <p className="mt-2 text-gray-600">Loading access logs...</p>
                        </div>
                    ) : currentDayLogs.length === 0 ? (
                        <div className="p-8 text-center">
                            <p className="text-gray-600">No access logs found for your sources</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Time
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Method
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Endpoint
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Request Body
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Response Code
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {currentDayLogs.map((log) => (
                                        <React.Fragment key={log.id}>
                                            <tr 
                                                className="hover:bg-gray-50 cursor-pointer"
                                                onClick={() => toggleRowExpansion(log.id)}
                                            >
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                    <div className="flex items-center space-x-2">
                                                        <ClockIcon className="w-4 h-4 text-gray-500" />
                                                        <span>{formatDate(log.created_at).time}</span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getMethodColor(log.request_method)}`}>
                                                        {log.request_method}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-mono">
                                                    {log.endpoint}
                                                </td>
                                                <td className="px-6 py-4 text-sm text-gray-900 max-w-3xl">
                                                    <pre className="text-xs overflow-x-auto whitespace-pre-wrap">
                                                        {log.request_body ? formatJson(log.request_body) : 'No request body'}
                                                    </pre>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getResponseCodeColor(log.response_code)}`}>
                                                        {log.response_code}
                                                    </span>
                                                </td>
                                            </tr>
                                            {expandedRows[log.id] && (
                                                <tr className="bg-white">
                                                    <td colSpan={5} className="px-6 py-4">
                                                        <div className="space-y-2">
                                                            <h4 className="font-semibold text-sm text-gray-700">Response Body:</h4>
                                                            <pre className="text-xs bg-white p-3 rounded border overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
                                                                {log.response_body ? formatJson(log.response_body) : 'No response body'}
                                                            </pre>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Return the count box
    return (
        <div className="bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 rounded-xl p-6 shadow-lg hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-white mb-1">Access Logs</h3>
                    <p className="text-3xl font-bold text-white">
                        {loading ? (
                            <span className="loading loading-spinner loading-sm"></span>
                        ) : (
                            accessLogsCount
                        )}
                    </p>
                    <p className="text-sm text-white/80 mt-1">Last 30 days</p>
                </div>
                <div className="text-white/80">
                    <DocumentTextIcon className="w-12 h-12" />
                </div>
            </div>
        </div>
    );
};

export default ExternalUserAccessLogs;
