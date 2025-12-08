import React, { useState, useEffect } from 'react';
import { supabase, type Lead } from '../lib/supabase';
import { Link } from 'react-router-dom';
import { BellAlertIcon } from '@heroicons/react/24/outline';
import { getStageName, initializeStageNames } from '../lib/stageUtils';

interface CombinedLead {
  id: number | string;
  lead_number: string;
  name: string;
  stage?: string;
  topic?: string;
  next_followup?: string;
  lead_type: 'new' | 'legacy';
}

const getStageBadge = (stage: string | undefined) => {
    const style = {
        backgroundColor: '#edeafd',
        color: '#4638e2',
        border: 'none',
        fontWeight: 600,
        fontSize: '0.95em',
        letterSpacing: '0.01em',
    };
    
    if (!stage) {
        return (
            <span className="badge badge-md ml-2" style={style}>
                No Stage
            </span>
        );
    }
    
    // Use getStageName for proper stage name transformation
    const stageName = getStageName(stage);
    
    return (
        <span className="badge badge-md ml-2" style={style}>
            {stageName}
        </span>
    );
};

const OverdueFollowups: React.FC = () => {
    const [overdueLeads, setOverdueLeads] = useState<CombinedLead[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);

    // Fetch current user ID
    useEffect(() => {
        const fetchCurrentUser = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (user?.email) {
                    const { data: userData } = await supabase
                        .from('users')
                        .select('id')
                        .eq('email', user.email)
                        .single();
                    if (userData?.id) {
                        setCurrentUserId(userData.id);
                    }
                }
            } catch (error) {
                console.error('Error fetching current user:', error);
            }
        };
        fetchCurrentUser();
    }, []);

    useEffect(() => {
        const fetchOverdueLeads = async () => {
            if (!currentUserId) {
                setLoading(false);
                return;
            }

            setLoading(true);
            try {
                // Initialize stage names cache first
                await initializeStageNames();
                
                const today = new Date();
                today.setHours(23, 59, 59, 999); // End of today
                const todayISO = today.toISOString();
                
                const fiftyDaysAgo = new Date();
                fiftyDaysAgo.setDate(fiftyDaysAgo.getDate() - 50);
                fiftyDaysAgo.setHours(0, 0, 0, 0); // Start of day
                const fiftyDaysAgoISO = fiftyDaysAgo.toISOString();
                
                // Fetch new leads with overdue follow-ups from follow_ups table
                const { data: newFollowupsData, error: newFollowupsError } = await supabase
                    .from('follow_ups')
                    .select(`
                        id,
                        date,
                        new_lead_id,
                        leads!follow_ups_new_lead_id_fkey (
                            id,
                            lead_number,
                            name,
                            stage,
                            topic,
                            status
                        )
                    `)
                    .eq('user_id', currentUserId)
                    .not('new_lead_id', 'is', null)
                    .lte('date', todayISO)
                    .gte('date', fiftyDaysAgoISO);

                if (newFollowupsError) throw newFollowupsError;

                // Fetch legacy leads with overdue follow-ups from follow_ups table
                const { data: legacyFollowupsData, error: legacyFollowupsError } = await supabase
                    .from('follow_ups')
                    .select(`
                        id,
                        date,
                        lead_id,
                        leads_lead!follow_ups_lead_id_fkey (
                            id,
                            name,
                            stage,
                            topic,
                            status
                        )
                    `)
                    .eq('user_id', currentUserId)
                    .not('lead_id', 'is', null)
                    .lte('date', todayISO)
                    .gte('date', fiftyDaysAgoISO);

                if (legacyFollowupsError) throw legacyFollowupsError;

                // Process new leads (filter for active leads)
                const processedNewLeads: CombinedLead[] = (newFollowupsData || [])
                    .filter(followup => {
                        const lead = followup.leads as any;
                        return lead && lead.status !== 'not_qualified' && lead.status !== 'declined';
                    })
                    .map(followup => {
                        const lead = followup.leads as any;
                        return {
                            id: lead.id,
                            lead_number: lead.lead_number,
                            name: lead.name || '',
                            stage: lead.stage,
                            topic: lead.topic || 'Consultation',
                            next_followup: followup.date,
                            lead_type: 'new' as const
                        };
                    });

                // Process legacy leads (filter for active leads: status = 0, stage < 100)
                const processedLegacyLeads: CombinedLead[] = (legacyFollowupsData || [])
                    .filter(followup => {
                        const lead = followup.leads_lead as any;
                        return lead && lead.status === 0 && (lead.stage === null || lead.stage < 100);
                    })
                    .map(followup => {
                        const lead = followup.leads_lead as any;
                        return {
                            id: `legacy_${lead.id}`,
                            lead_number: lead.id?.toString() || '',
                            name: lead.name || '',
                            stage: lead.stage?.toString() || '',
                            topic: lead.topic || 'Consultation',
                            next_followup: followup.date,
                            lead_type: 'legacy' as const
                        };
                    });

                // Combine and sort by follow-up date (oldest first)
                const allLeads = [...processedNewLeads, ...processedLegacyLeads].sort((a, b) => {
                    if (!a.next_followup && !b.next_followup) return 0;
                    if (!a.next_followup) return 1;
                    if (!b.next_followup) return -1;
                    return new Date(a.next_followup).getTime() - new Date(b.next_followup).getTime();
                });

                setOverdueLeads(allLeads);
            } catch (error) {
                console.error("Error fetching overdue leads:", error);
                setOverdueLeads([]);
            } finally {
                setLoading(false);
            }
        };

        fetchOverdueLeads();
    }, [currentUserId]);

    if (loading) {
        return <div className="text-center p-4">Loading overdue follow-ups...</div>;
    }

    return (
        <div>
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <BellAlertIcon className="w-6 h-6" style={{ color: '#4638e2' }} />
                <span>Overdue Follow-ups</span>
            </h2>
            <div className="bg-base-100 rounded-lg shadow-md overflow-x-auto">
                <table className="table w-full">
                    <thead>
                        <tr>
                            <th>Lead #</th>
                            <th>Info</th>
                            <th>Name</th>
                            <th>Topic</th>
                            <th>Follow-up Date</th>
                            <th>Days Overdue</th>
                        </tr>
                    </thead>
                    <tbody>
                        {overdueLeads.length === 0 ? (
                            <tr><td colSpan={6} className="text-center p-4">No overdue follow-ups. Great job!</td></tr>
                        ) : overdueLeads.map(lead => {
                            const daysOverdue = lead.next_followup ? Math.floor((new Date().getTime() - new Date(lead.next_followup).getTime()) / (1000 * 3600 * 24)) : 0;
                            return (
                                <tr key={lead.id} className="transition-all duration-150 hover:bg-[#f7f6fd] border-b border-base-200 last:border-0">
                                    <td>
                                        <Link to={`/clients/${lead.lead_number}`} className="font-bold" style={{ color: '#4638e2', fontWeight: 700, fontSize: '1.05em' }}>
                                            {lead.lead_number}
                                            {lead.lead_type === 'legacy' && <span className="text-xs text-gray-500 ml-1">(L)</span>}
                                        </Link>
                                    </td>
                                    <td>
                                        {getStageBadge(lead.stage)}
                                    </td>
                                    <td>
                                        <Link to={`/clients/${lead.lead_number}`} className="font-bold hover:underline" style={{ color: '#222', fontWeight: 700, fontSize: '1.05em' }}>
                                            {lead.name}
                                        </Link>
                                    </td>
                                    <td style={{ color: '#666', fontWeight: 500 }}>{lead.topic}</td>
                                    <td>
                                        <span className="font-medium" style={{ color: '#888' }}>
                                            {lead.next_followup ? new Date(lead.next_followup).toLocaleDateString() : 'N/A'}
                                        </span>
                                    </td>
                                    <td>
                                        <span style={{
                                            background: '#edeafd',
                                            color: '#4638e2',
                                            borderRadius: '999px',
                                            padding: '0.35em 1em',
                                            fontWeight: 700,
                                            fontSize: '0.98em',
                                            letterSpacing: '0.01em',
                                            display: 'inline-block',
                                        }}>{daysOverdue} days</span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default OverdueFollowups; 