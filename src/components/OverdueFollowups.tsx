import React, { useState, useEffect } from 'react';
import { supabase, type Lead } from '../lib/supabase';
import { Link } from 'react-router-dom';
import { BellAlertIcon } from '@heroicons/react/24/outline';

const getStageBadge = (stage: string) => {
    const style = {
        backgroundColor: '#edeafd',
        color: '#4638e2',
        border: 'none',
        fontWeight: 600,
        fontSize: '0.95em',
        letterSpacing: '0.01em',
    };
    return (
        <span className="badge badge-md ml-2" style={style}>
            {stage && typeof stage === 'string' && stage.trim() ? stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'No Stage'}
        </span>
    );
};

const OverdueFollowups: React.FC = () => {
    const [overdueLeads, setOverdueLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchOverdueLeads = async () => {
            setLoading(true);
            try {
                const today = new Date().toISOString().split('T')[0];
                const { data, error } = await supabase
                    .from('leads')
                    .select('*')
                    .lte('next_followup', today)
                    .not('next_followup', 'is', null);

                if (error) throw error;
                setOverdueLeads(data || []);
            } catch (error) {
                console.error("Error fetching overdue leads:", error);
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