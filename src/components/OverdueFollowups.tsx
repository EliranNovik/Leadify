import React, { useState, useEffect } from 'react';
import { supabase, type Lead } from '../lib/supabase';
import { Link } from 'react-router-dom';
import { BellAlertIcon } from '@heroicons/react/24/outline';

const getStageBadge = (stage: string) => {
    const style = {
        backgroundColor: '#3b28c7',
        color: '#fff',
        border: 'none',
    };
    return (
        <span className="badge badge-md ml-2 font-semibold" style={style}>
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
                <BellAlertIcon className="w-6 h-6 text-error" />
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
                                <tr key={lead.id} className="hover">
                                    <td>
                                        <Link to={`/clients/${lead.lead_number}`} className="font-bold" style={{ color: '#3b28c7' }}>
                                            {lead.lead_number}
                                        </Link>
                                    </td>
                                    <td>
                                        {getStageBadge(lead.stage)}
                                    </td>
                                    <td>
                                        <Link to={`/clients/${lead.lead_number}`} className="font-bold hover:underline">
                                            {lead.name}
                                        </Link>
                                    </td>
                                    <td>{lead.topic}</td>
                                    <td>
                                        <span className="font-medium text-error">
                                            {lead.next_followup ? new Date(lead.next_followup).toLocaleDateString() : 'N/A'}
                                        </span>
                                    </td>
                                    <td>
                                        <span className="badge badge-error text-white">{daysOverdue} days</span>
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