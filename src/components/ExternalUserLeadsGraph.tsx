import React, { useState, useEffect } from 'react';
import { supabase, isExpectedNoSessionError } from '../lib/supabase';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { ChartBarIcon } from '@heroicons/react/24/outline';

interface LeadsGraphData {
    source: string;
    count: number;
}

/** Parse `users.extern_source_id` (array or JSON string); allow numeric strings. */
export function parseExternSourceIds(raw: unknown): number[] {
    const out: number[] = [];
    const push = (v: unknown) => {
        if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
        else if (typeof v === 'string' && v.trim() !== '') {
            const n = Number(v.trim());
            if (Number.isFinite(n)) out.push(n);
        }
    };
    if (Array.isArray(raw)) raw.forEach(push);
    else if (typeof raw === 'string') {
        try {
            const p = JSON.parse(raw);
            if (Array.isArray(p)) p.forEach(push);
        } catch {
            /* ignore */
        }
    }
    return out;
}

/** PostgREST `.or()`: match `source_id` OR legacy text `source` (same pattern as ExternalUserLeadSearchPage). */
export function buildLeadSourcesOrFilter(sourceIds: number[], sourceNames: string[]): string {
    const orParts: string[] = [];
    const numericIds = sourceIds.filter((n) => Number.isFinite(n));
    if (numericIds.length === 1) {
        orParts.push(`source_id.eq.${numericIds[0]}`);
    } else if (numericIds.length > 1) {
        orParts.push(`source_id.in.(${numericIds.join(',')})`);
    }

    const cleanedNames = sourceNames.map((s) => String(s ?? '').trim()).filter((s) => s !== '');
    if (cleanedNames.length === 1) {
        // Plain `eq` is fine for a single value; supabase-js will URL-encode.
        orParts.push(`source.eq.${cleanedNames[0]}`);
    } else if (cleanedNames.length > 1) {
        // IMPORTANT: `.or()` uses a comma-separated grammar, so values containing spaces/commas
        // must be quoted. PostgREST supports `in.("a","b")`.
        const quoted = cleanedNames
            .map((s) => `"${s.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`)
            .join(',');
        orParts.push(`source.in.(${quoted})`);
    }

    return orParts.join(',');
}

function initSourceCounts(allowedSources: { id: number; name: string }[]): Record<string, number> {
    const sourceCounts: Record<string, number> = {};
    allowedSources.forEach((s) => {
        sourceCounts[s.name] = 0;
    });
    return sourceCounts;
}

/** Map a lead row to the canonical misc_leadsource.name bucket, or null if out of scope. */
function bucketLeadByAllowedSource(
    lead: { source_id?: unknown; source?: string | null },
    allowedSources: { id: number; name: string }[],
): string | null {
    const idToName = new Map<string, string>();
    const nameNormToCanonical = new Map<string, string>();
    for (const s of allowedSources) {
        idToName.set(String(s.id), s.name);
        nameNormToCanonical.set(s.name.trim().toLowerCase(), s.name);
    }
    const sid = lead.source_id != null && String(lead.source_id).trim() !== '' ? String(lead.source_id) : '';
    if (sid && idToName.has(sid)) return idToName.get(sid)!;
    const key = (lead.source || '').trim().toLowerCase();
    if (key && nameNormToCanonical.has(key)) return nameNormToCanonical.get(key)!;
    return null;
}

const ExternalUserLeadsGraph: React.FC = () => {
    const [graphData, setGraphData] = useState<LeadsGraphData[]>([]);
    const [successfulLeadsData, setSuccessfulLeadsData] = useState<LeadsGraphData[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingSuccessful, setLoadingSuccessful] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [errorSuccessful, setErrorSuccessful] = useState<string | null>(null);

    useEffect(() => {
        const fetchLeadsData = async () => {
            try {
                // Check cache first
                const cacheKey = 'externalUserLeadsGraph_cache_v2';
                const cached = sessionStorage.getItem(cacheKey);
                if (cached) {
                    try {
                        const { data, timestamp } = JSON.parse(cached);
                        const now = Date.now();
                        
                        // If cached data is less than 5 minutes old, use it
                        if ((now - timestamp) < 5 * 60 * 1000) {
                            setGraphData(data);
                            setLoading(false);
                            return;
                        }
                    } catch (e) {
                        // Invalid cache, continue to fetch
                    }
                }

                setLoading(true);
                setError(null);

                // Get current user's extern_source_id
                const { data: { user }, error: authError } = await supabase.auth.getUser();
                
                if (authError || !user) {
                    if (authError && !isExpectedNoSessionError(authError)) {
                      console.error('Error getting auth user:', authError);
                    }
                    setError('Unable to fetch user data');
                    setLoading(false);
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
                    setGraphData([]);
                    setLoading(false);
                    return;
                }

                const sourceIds = parseExternSourceIds(finalUserData.extern_source_id);

                if (sourceIds.length === 0) {
                    console.log('⚠️ No valid source IDs found');
                    setGraphData([]);
                    setLoading(false);
                    return;
                }

                // Get date range for last 30 days
                const now = new Date();
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(now.getDate() - 30);
                thirtyDaysAgo.setHours(0, 0, 0, 0);
                const startTimestamp = thirtyDaysAgo.toISOString();
                const endTimestamp = now.toISOString();

                // Fetch source names for the allowed IDs
                const { data: allowedSources, error: sourcesError } = await supabase
                    .from('misc_leadsource')
                    .select('id, name')
                    .in('id', sourceIds)
                    .eq('active', true)
                    .order('name');

                if (sourcesError || !allowedSources || allowedSources.length === 0) {
                    console.error('Error fetching allowed sources:', sourcesError);
                    setGraphData([]);
                    setLoading(false);
                    return;
                }

                const allowedTyped = allowedSources.map((s) => ({
                    id: Number((s as any).id),
                    name: String((s as any).name),
                }));
                const allowedSourceNames = allowedTyped.map((s) => s.name);
                const sourceIdsFromMisc = allowedTyped.map((s) => s.id).filter((n) => Number.isFinite(n));
                const sourcesOr = buildLeadSourcesOrFilter(sourceIdsFromMisc, allowedSourceNames);

                // Fetch leads: include rows keyed by source_id OR text source (aligned with lead search).
                const { data: leads, error: leadsError } = await supabase
                    .from('leads')
                    .select('id, source_id, source, created_at')
                    .gte('created_at', startTimestamp)
                    .lte('created_at', endTimestamp)
                    .or(sourcesOr);

                if (leadsError) {
                    console.error('Error fetching leads:', leadsError);
                    setError('Unable to fetch leads data');
                    setLoading(false);
                    return;
                }

                const sourceCounts = initSourceCounts(allowedTyped);

                if (leads) {
                    leads.forEach((lead) => {
                        const bucket = bucketLeadByAllowedSource(lead, allowedTyped);
                        if (bucket && Object.prototype.hasOwnProperty.call(sourceCounts, bucket)) {
                            sourceCounts[bucket] += 1;
                        }
                    });
                }

                // Convert to array format for chart
                const chartData: LeadsGraphData[] = allowedSources
                    .map(source => ({
                        source: source.name,
                        count: sourceCounts[source.name] || 0
                    }))
                    .sort((a, b) => b.count - a.count); // Sort by count descending

                setGraphData(chartData);
                
                // Cache the result
                const cacheData = {
                    data: chartData,
                    timestamp: Date.now()
                };
                sessionStorage.setItem('externalUserLeadsGraph_cache', JSON.stringify(cacheData));
            } catch (error) {
                console.error('Error fetching leads graph data:', error);
                setError('An error occurred while fetching data');
            } finally {
                setLoading(false);
            }
        };

        fetchLeadsData();
    }, []);

    // Fetch successful leads (past Meeting Scheduled stage)
    useEffect(() => {
        const fetchSuccessfulLeadsData = async () => {
            try {
                // Check cache first
                const cacheKey = 'externalUserSuccessfulLeadsGraph_cache_v2';
                const cached = sessionStorage.getItem(cacheKey);
                if (cached) {
                    try {
                        const { data, timestamp } = JSON.parse(cached);
                        const now = Date.now();
                        
                        // If cached data is less than 5 minutes old, use it
                        if ((now - timestamp) < 5 * 60 * 1000) {
                            setSuccessfulLeadsData(data);
                            setLoadingSuccessful(false);
                            return;
                        }
                    } catch (e) {
                        // Invalid cache, continue to fetch
                    }
                }

                setLoadingSuccessful(true);
                setErrorSuccessful(null);

                // Get current user's extern_source_id
                const { data: { user }, error: authError } = await supabase.auth.getUser();
                
                if (authError || !user) {
                    if (authError && !isExpectedNoSessionError(authError)) {
                      console.error('Error getting auth user:', authError);
                    }
                    setErrorSuccessful('Unable to fetch user data');
                    setLoadingSuccessful(false);
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
                    setSuccessfulLeadsData([]);
                    setLoadingSuccessful(false);
                    return;
                }

                const sourceIds = parseExternSourceIds(finalUserData.extern_source_id);

                if (sourceIds.length === 0) {
                    console.log('⚠️ No valid source IDs found');
                    setSuccessfulLeadsData([]);
                    setLoadingSuccessful(false);
                    return;
                }

                // Fetch source names for the allowed IDs
                const { data: allowedSources, error: sourcesError } = await supabase
                    .from('misc_leadsource')
                    .select('id, name')
                    .in('id', sourceIds)
                    .eq('active', true)
                    .order('name');

                if (sourcesError || !allowedSources || allowedSources.length === 0) {
                    console.error('Error fetching allowed sources:', sourcesError);
                    setSuccessfulLeadsData([]);
                    setLoadingSuccessful(false);
                    return;
                }

                const allowedTyped = allowedSources.map((s) => ({
                    id: Number((s as any).id),
                    name: String((s as any).name),
                }));
                const allowedSourceNames = allowedTyped.map((s) => s.name);
                const sourceIdsFromMisc = allowedTyped.map((s) => s.id).filter((n) => Number.isFinite(n));
                const sourcesOr = buildLeadSourcesOrFilter(sourceIdsFromMisc, allowedSourceNames);

                // Get date range for last 30 days
                const now = new Date();
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(now.getDate() - 30);
                thirtyDaysAgo.setHours(0, 0, 0, 0);
                const startTimestamp = thirtyDaysAgo.toISOString();
                const endTimestamp = now.toISOString();

                // Stage IDs for successful leads past Meeting Scheduled stage
                const successfulStageIds = [20, 21, 30, 40, 50, 55, 60, 70, 100, 105, 150, 200];

                const { data: leads, error: leadsError } = await supabase
                    .from('leads')
                    .select('id, source_id, source, stage, created_at')
                    .in('stage', successfulStageIds)
                    .gte('created_at', startTimestamp)
                    .lte('created_at', endTimestamp)
                    .or(sourcesOr);

                if (leadsError) {
                    console.error('Error fetching successful leads:', leadsError);
                    setErrorSuccessful('Unable to fetch successful leads data');
                    setLoadingSuccessful(false);
                    return;
                }

                const sourceCounts = initSourceCounts(allowedTyped);

                if (leads) {
                    leads.forEach((lead) => {
                        const bucket = bucketLeadByAllowedSource(lead, allowedTyped);
                        if (bucket && Object.prototype.hasOwnProperty.call(sourceCounts, bucket)) {
                            sourceCounts[bucket] += 1;
                        }
                    });
                }

                // Convert to array format for chart
                const chartData: LeadsGraphData[] = allowedSources
                    .map(source => ({
                        source: source.name,
                        count: sourceCounts[source.name] || 0
                    }))
                    .sort((a, b) => b.count - a.count); // Sort by count descending

                setSuccessfulLeadsData(chartData);
                
                // Cache the result
                const cacheData = {
                    data: chartData,
                    timestamp: Date.now()
                };
                sessionStorage.setItem('externalUserSuccessfulLeadsGraph_cache', JSON.stringify(cacheData));
            } catch (error) {
                console.error('Error fetching successful leads graph data:', error);
                setErrorSuccessful('An error occurred while fetching data');
            } finally {
                setLoadingSuccessful(false);
            }
        };

        fetchSuccessfulLeadsData();
    }, []);

    // Custom tooltip component
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-3">
                    <p className="font-semibold text-gray-900 mb-1">{label}</p>
                    <p className="text-blue-600 font-medium">
                        Leads: <span className="text-gray-900">{payload[0].value}</span>
                    </p>
                </div>
            );
        }
        return null;
    };

    if (loading) {
        return (
            <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-100">
                <div className="flex items-center justify-center h-64">
                    <div className="flex flex-col items-center gap-3">
                        <span className="loading loading-spinner loading-lg text-primary"></span>
                        <p className="text-gray-500">Loading graph data...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-100">
                <div className="flex items-center justify-center h-64">
                    <div className="text-center">
                        <p className="text-red-500 font-medium">{error}</p>
                    </div>
                </div>
            </div>
        );
    }

    if (graphData.length === 0) {
        return (
            <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-100">
                <div className="flex items-center justify-center h-64">
                    <div className="text-center">
                        <ChartBarIcon className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                        <p className="text-gray-500">No leads data available for the last 30 days</p>
                    </div>
                </div>
            </div>
        );
    }

    // Render function for the first graph (Last 30 Days)
    const renderFirstGraph = () => {
        if (loading) {
            return (
                <div className="flex items-center justify-center h-64">
                    <div className="flex flex-col items-center gap-3">
                        <span className="loading loading-spinner loading-lg text-primary"></span>
                        <p className="text-gray-500">Loading graph data...</p>
                    </div>
                </div>
            );
        }

        if (error) {
            return (
                <div className="flex items-center justify-center h-64">
                    <div className="text-center">
                        <p className="text-red-500 font-medium">{error}</p>
                    </div>
                </div>
            );
        }

        if (graphData.length === 0) {
            return (
                <div className="flex items-center justify-center h-64">
                    <div className="text-center">
                        <ChartBarIcon className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                        <p className="text-gray-500">No leads data available for the last 30 days</p>
                    </div>
                </div>
            );
        }

        return (
            <div className="w-full h-80">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                        data={graphData}
                        margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                        barCategoryGap="20%"
                    >
                        <defs>
                            <linearGradient id="leadsGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.9} />
                                <stop offset="50%" stopColor="#06b6d4" stopOpacity={0.8} />
                                <stop offset="100%" stopColor="#10b981" stopOpacity={0.9} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid 
                            strokeDasharray="3 3" 
                            stroke="#e5e7eb" 
                            opacity={0.3}
                            vertical={false}
                        />
                        <XAxis
                            dataKey="source"
                            angle={-45}
                            textAnchor="end"
                            height={80}
                            tick={{ fontSize: 11, fill: '#6b7280', fontWeight: '500' }}
                            axisLine={{ stroke: '#d1d5db', strokeWidth: 1 }}
                            tickLine={{ stroke: '#d1d5db', strokeWidth: 1 }}
                            interval={0}
                        />
                        <YAxis
                            tick={{ fontSize: 12, fill: '#6b7280' }}
                            axisLine={{ stroke: '#d1d5db', strokeWidth: 1 }}
                            tickLine={{ stroke: '#d1d5db', strokeWidth: 1 }}
                            width={50}
                            tickMargin={8}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar
                            dataKey="count"
                            fill="url(#leadsGradient)"
                            radius={[8, 8, 0, 0]}
                            stroke="#3b82f6"
                            strokeWidth={1}
                        />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        );
    };

    // Render function for the second graph (Successful Leads)
    const renderSecondGraph = () => {
        if (loadingSuccessful) {
            return (
                <div className="flex items-center justify-center h-64">
                    <div className="flex flex-col items-center gap-3">
                        <span className="loading loading-spinner loading-lg text-primary"></span>
                        <p className="text-gray-500">Loading graph data...</p>
                    </div>
                </div>
            );
        }

        if (errorSuccessful) {
            return (
                <div className="flex items-center justify-center h-64">
                    <div className="text-center">
                        <p className="text-red-500 font-medium">{errorSuccessful}</p>
                    </div>
                </div>
            );
        }

        if (successfulLeadsData.length === 0) {
            return (
                <div className="flex items-center justify-center h-64">
                    <div className="text-center">
                        <ChartBarIcon className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                        <p className="text-gray-500">No successful leads data available</p>
                    </div>
                </div>
            );
        }

        return (
            <div className="w-full h-80">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                        data={successfulLeadsData}
                        margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                        barCategoryGap="20%"
                    >
                        <defs>
                            <linearGradient id="successfulLeadsGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#10b981" stopOpacity={0.9} />
                                <stop offset="50%" stopColor="#059669" stopOpacity={0.8} />
                                <stop offset="100%" stopColor="#047857" stopOpacity={0.9} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid 
                            strokeDasharray="3 3" 
                            stroke="#e5e7eb" 
                            opacity={0.3}
                            vertical={false}
                        />
                        <XAxis
                            dataKey="source"
                            angle={-45}
                            textAnchor="end"
                            height={80}
                            tick={{ fontSize: 11, fill: '#6b7280', fontWeight: '500' }}
                            axisLine={{ stroke: '#d1d5db', strokeWidth: 1 }}
                            tickLine={{ stroke: '#d1d5db', strokeWidth: 1 }}
                            interval={0}
                        />
                        <YAxis
                            tick={{ fontSize: 12, fill: '#6b7280' }}
                            axisLine={{ stroke: '#d1d5db', strokeWidth: 1 }}
                            tickLine={{ stroke: '#d1d5db', strokeWidth: 1 }}
                            width={50}
                            tickMargin={8}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar
                            dataKey="count"
                            fill="url(#successfulLeadsGradient)"
                            radius={[8, 8, 0, 0]}
                            stroke="#10b981"
                            strokeWidth={1}
                        />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            {/* First Graph - Last 30 Days */}
            <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-100">
                <div className="mb-4">
                    <h3 className="text-xl font-bold text-gray-900 mb-1">Leads by Source (Last 30 Days)</h3>
                    <p className="text-sm text-gray-500">Distribution of leads across your assigned sources</p>
                </div>
                {renderFirstGraph()}
            </div>

            {/* Second Graph - Successful Leads */}
            <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-100">
                <div className="mb-4">
                    <h3 className="text-xl font-bold text-gray-900 mb-1">Successful Leads Past Meeting Scheduled Stage (Last 30 Days)</h3>
                    <p className="text-sm text-gray-500">Leads in advanced stages by source</p>
                </div>
                {renderSecondGraph()}
            </div>
        </div>
    );
};

export default ExternalUserLeadsGraph;
