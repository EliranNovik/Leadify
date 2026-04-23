import React, { useState, useEffect, useRef } from 'react';
import { supabase, isExpectedNoSessionError } from '../lib/supabase';
import { BoltIcon, CalendarIcon, ClockIcon } from '@heroicons/react/24/outline';
import { usePersistedFilters } from '../hooks/usePersistedState';
import { parseExternSourceIds } from './ExternalUserLeadsGraph';

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
    /** Supabase auth user id — scopes caches/persisted filters so switching accounts cannot leak counts. */
    storageScope: string;
    onBack?: () => void;
    showFullView?: boolean;
}

function logMatchesAllowedSources(
    log: { request_body?: string | null; response_body?: string | null },
    allowedIdsSet: Set<number>,
    allowedCodesSet: Set<number>,
    allowedNamesSet: Set<string>,
): boolean {
    if (log?.response_body) {
        try {
            const parsed = JSON.parse(String(log.response_body));
            const sid = parsed?.data?.source_id;
            if (sid != null && allowedIdsSet.has(Number(sid))) return true;
            const sourceName = parsed?.data?.source ?? parsed?.data?.source_name ?? parsed?.data?.sourceName;
            if (typeof sourceName === 'string' && allowedNamesSet.has(sourceName.trim().toLowerCase())) return true;
        } catch {
            /* ignore */
        }
    }
    if (log?.request_body) {
        try {
            const parsedReq = JSON.parse(String(log.request_body));
            const q = parsedReq?.query && typeof parsedReq.query === 'object' ? parsedReq.query : parsedReq;
            const sourceCode = q?.source_code ?? q?.sourceCode ?? q?.source;
            const sourceId = q?.source_id ?? q?.sourceId;
            if (sourceId != null && allowedIdsSet.has(Number(sourceId))) return true;
            if (sourceCode != null && allowedCodesSet.size > 0 && allowedCodesSet.has(Number(sourceCode))) return true;
            const sourceName = q?.source_name ?? q?.sourceName ?? (typeof q?.source === 'string' ? q?.source : null);
            if (typeof sourceName === 'string' && allowedNamesSet.has(sourceName.trim().toLowerCase())) return true;
        } catch {
            /* ignore */
        }
    }
    return false;
}

const ExternalUserAccessLogs: React.FC<ExternalUserAccessLogsProps> = ({ storageScope, onBack, showFullView = false }) => {
    const [accessLogsCount, setAccessLogsCount] = useState(0);
    const [logs, setLogs] = useState<AccessLog[]>([]);
    const [logsByDay, setLogsByDay] = useState<{ [key: string]: AccessLog[] }>({});
    const [availableDays, setAvailableDays] = useState<string[]>([]);
    const [currentDayIndex, setCurrentDayIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadingLogs, setLoadingLogs] = useState(false);
    const [expandedRows, setExpandedRows] = useState<ExpandedRow>({});
    const [allowedSourceIds, setAllowedSourceIds] = useState<number[]>([]);
    const hasInitializedRef = useRef(false);

    useEffect(() => {
        hasInitializedRef.current = false;
        setAccessLogsCount(0);
        setCurrentDayIndex(0);
    }, [storageScope]);
    const [filters, setFilters] = usePersistedFilters(`externalUserAccessLogs_filters_${storageScope}`, {
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
                    if (authError && !isExpectedNoSessionError(authError)) {
                      console.error('Error getting auth user:', authError);
                    }
                    return;
                }

                if (user.id !== storageScope) {
                    console.warn('Access logs: session user does not match storageScope; skipping source load');
                    setAllowedSourceIds([]);
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

                const sourceIds = parseExternSourceIds(finalUserData.extern_source_id);

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
    }, [storageScope]);

    // Fetch access logs count (last 30 days)
    useEffect(() => {
        const fetchAccessLogsCount = async () => {
            if (!storageScope) {
                setAccessLogsCount(0);
                setLoading(false);
                return;
            }
            if (allowedSourceIds.length === 0) {
                setAccessLogsCount(0);
                setLoading(false);
                return;
            }

            // Check cache first - if we have valid cached data, use it and skip fetch
            // Bump cache version when matching logic changes (ids/codes/names).
            const cacheKey = `externalUserAccessLogs_count_cache_v3_${storageScope}`;
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
            
            try {
                setLoading(true);
                
                // Get date range for last 30 days
                const now = new Date();
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(now.getDate() - 30);
                thirtyDaysAgo.setHours(0, 0, 0, 0);
                const startTimestamp = thirtyDaysAgo.toISOString();
                const endTimestamp = now.toISOString();

                const allowedIdsSet = new Set(allowedSourceIds.map((n) => Number(n)).filter((n) => Number.isFinite(n)));
                // Map allowed misc_leadsource.id -> misc_leadsource.code, so logs can be matched by request source_code too.
                const { data: srcRows, error: srcErr } = await supabase
                    .from('misc_leadsource')
                    .select('id, code, name')
                    .in('id', allowedSourceIds);
                if (srcErr) {
                    console.warn('Access logs: failed to load misc_leadsource codes:', srcErr);
                }
                const allowedCodesSet = new Set<number>();
                const allowedNamesSet = new Set<string>();
                (srcRows || []).forEach((r: any) => {
                    const c = r?.code;
                    const n = typeof c === 'string' ? Number(c) : c;
                    if (Number.isFinite(n)) allowedCodesSet.add(Number(n));
                    const name = typeof r?.name === 'string' ? r.name.trim().toLowerCase() : '';
                    if (name) allowedNamesSet.add(name);
                });

                // Fetch all access logs for hook endpoints in the last 30 days
                const { data, error } = await supabase
                    .from('access_logs')
                    .select('id, request_body, response_body')
                    .in('endpoint', ['/api/hook/catch', '/api/hook/facebook'])
                    .gte('created_at', startTimestamp)
                    .lte('created_at', endTimestamp);

                if (error) {
                    console.error('Error fetching access logs count:', error);
                    setAccessLogsCount(0);
                } else {
                    // Count logs that match by response data.source_id OR by request source_code/source_id
                    const filteredLogs = (data || []).filter((log: any) =>
                        logMatchesAllowedSources(log, allowedIdsSet, allowedCodesSet, allowedNamesSet),
                    );
                    const count = filteredLogs.length;
                    setAccessLogsCount(count);
                    // Cache the result
                    const cacheData = {
                        count,
                        timestamp: Date.now()
                    };
                    sessionStorage.setItem(cacheKey, JSON.stringify(cacheData));
                    hasInitializedRef.current = true;
                }
            } catch (error) {
                console.error('Error fetching access logs count:', error);
                setAccessLogsCount(0);
            } finally {
                setLoading(false);
            }
        };

        if (storageScope && allowedSourceIds.length > 0 && !hasInitializedRef.current) {
            void fetchAccessLogsCount();
        }
    }, [allowedSourceIds, storageScope]);

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

            // Date filters: full-page defaults to last 30 days (summary count uses the same window).
            if (filters.dateFrom) {
                query = query.gte('created_at', filters.dateFrom);
            } else if (showFullView) {
                const now = new Date();
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(now.getDate() - 30);
                thirtyDaysAgo.setHours(0, 0, 0, 0);
                query = query.gte('created_at', thirtyDaysAgo.toISOString());
            }
            if (filters.dateTo) {
                const endDate = new Date(filters.dateTo);
                endDate.setHours(23, 59, 59, 999);
                query = query.lte('created_at', endDate.toISOString());
            } else {
                query = query.lte('created_at', new Date().toISOString());
            }

            // Fetch all matching logs (we'll filter by source_id client-side)
            const { data, error } = await query;

            if (error) {
                console.error('Error fetching access logs:', error);
                setLogs([]);
                return;
            }

            const allowedIdsSet = new Set(allowedSourceIds.map((n) => Number(n)).filter((n) => Number.isFinite(n)));
            const { data: srcRows } = await supabase
                .from('misc_leadsource')
                .select('id, code, name')
                .in('id', allowedSourceIds);
            const allowedCodesSet = new Set<number>();
            const allowedNamesSet = new Set<string>();
            (srcRows || []).forEach((r: any) => {
                const c = r?.code;
                const n = typeof c === 'string' ? Number(c) : c;
                if (Number.isFinite(n)) allowedCodesSet.add(Number(n));
                const name = typeof r?.name === 'string' ? r.name.trim().toLowerCase() : '';
                if (name) allowedNamesSet.add(name);
            });

            const filteredLogs = (data || []).filter((log) =>
                logMatchesAllowedSources(log, allowedIdsSet, allowedCodesSet, allowedNamesSet),
            );

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
        <div className="bg-gradient-to-tr from-amber-500 via-orange-500 to-yellow-400 rounded-xl p-6 shadow-lg hover:shadow-xl transition-all duration-300">
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
                    <BoltIcon className="w-12 h-12" />
                </div>
            </div>
        </div>
    );
};

export default ExternalUserAccessLogs;
