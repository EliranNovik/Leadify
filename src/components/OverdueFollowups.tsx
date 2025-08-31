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

    useEffect(() => {
        const fetchOverdueLeads = async () => {
            setLoading(true);
            try {
                // Initialize stage names cache first
                await initializeStageNames();
                
                const today = new Date().toISOString().split('T')[0];
                const fiftyDaysAgo = new Date();
                fiftyDaysAgo.setDate(fiftyDaysAgo.getDate() - 50);
                const fiftyDaysAgoStr = fiftyDaysAgo.toISOString().split('T')[0];
                
                // Fetch new leads with overdue follow-ups (not over 50 days)
                const { data: newLeadsData, error: newLeadsError } = await supabase
                    .from('leads')
                    .select(`
                        id,
                        lead_number,
                        name,
                        stage,
                        topic,
                        next_followup
                    `)
                    .lte('next_followup', today)
                    .gte('next_followup', fiftyDaysAgoStr)
                    .not('next_followup', 'is', null);

                if (newLeadsError) throw newLeadsError;

                // Fetch legacy leads with overdue follow-ups (not over 50 days)
                const { data: legacyLeadsData, error: legacyLeadsError } = await supabase
                    .from('leads_lead')
                    .select(`
                        id,
                        name,
                        stage,
                        topic,
                        next_followup
                    `)
                    .lte('next_followup', today)
                    .gte('next_followup', fiftyDaysAgoStr)
                    .not('next_followup', 'is', null)
                    .eq('status', 0) // Only fetch active legacy leads
                    .lt('stage', 100); // Don't fetch leads past stage 100 (Success)

                if (legacyLeadsError) throw legacyLeadsError;

                // Process new leads
                const processedNewLeads: CombinedLead[] = (newLeadsData || []).map(lead => ({
                    id: lead.id,
                    lead_number: lead.lead_number,
                    name: lead.name,
                    stage: lead.stage,
                    topic: lead.topic,
                    next_followup: lead.next_followup,
                    lead_type: 'new' as const
                }));

                // Process legacy leads
                const processedLegacyLeads: CombinedLead[] = (legacyLeadsData || []).map(lead => ({
                    id: `legacy_${lead.id}`,
                    lead_number: lead.id?.toString() || '',
                    name: lead.name || '',
                    stage: lead.stage?.toString() || '',
                    topic: lead.topic || 'Consultation',
                    next_followup: lead.next_followup,
                    lead_type: 'legacy' as const
                }));

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
    }, []);

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
                            <tr><td colSpan={5} className="text-center p-4">No overdue follow-ups. Great job!</td></tr>
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