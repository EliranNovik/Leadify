import React, { useState, useEffect } from 'react';
import { supabase, type Lead } from '../lib/supabase';
import { Link } from 'react-router-dom';
import { BellAlertIcon } from '@heroicons/react/24/outline';

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
                    .lt('follow_up_date', today)
                    .not('status', 'in', ['Unactivated', 'Client Signed', 'Client Declined']); // Example statuses to exclude

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
                            <th>Name</th>
                            <th>Topic</th>
                            <th>Follow-up Date</th>
                            <th>Days Overdue</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {overdueLeads.length === 0 ? (
                            <tr><td colSpan={5} className="text-center p-4">No overdue follow-ups. Great job!</td></tr>
                        ) : overdueLeads.map(lead => {
                            const daysOverdue = lead.follow_up_date ? Math.floor((new Date().getTime() - new Date(lead.follow_up_date).getTime()) / (1000 * 3600 * 24)) : 0;
                            return (
                                <tr key={lead.id} className="hover">
                                    <td>
                                        <div className="flex items-center space-x-3">
                                             <div className="avatar placeholder">
                                                <div className="bg-error/20 text-error-content rounded-full w-10 h-10">
                                                    <span>{lead.name.substring(0,2)}</span>
                                                </div>
                                            </div>
                                            <div>
                                                <div className="font-bold">{lead.name}</div>
                                                <div className="text-sm opacity-50">{lead.lead_number}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td>{lead.topic}</td>
                                    <td>
                                        <span className="font-medium text-error">
                                            {lead.follow_up_date ? new Date(lead.follow_up_date).toLocaleDateString() : 'N/A'}
                                        </span>
                                    </td>
                                    <td>
                                        <span className="badge badge-error text-white">{daysOverdue} days</span>
                                    </td>
                                    <th>
                                        <Link to={`/clients/${lead.lead_number}`} className="btn btn-ghost btn-xs">details</Link>
                                    </th>
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