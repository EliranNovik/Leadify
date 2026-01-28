import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import ExternalUserLeadSearch from './ExternalUserLeadSearch';
import { ChartBarIcon } from '@heroicons/react/24/outline';

interface ExternalUserDashboardProps {
    userName: string | null;
}

const ExternalUserDashboard: React.FC<ExternalUserDashboardProps> = ({ userName }) => {
    const [newLeadsCount, setNewLeadsCount] = useState(0);

    // Fetch new leads count for external users (today only)
    useEffect(() => {
        const fetchNewLeadsCount = async () => {
            try {
                // Get today's start and end timestamps
                const now = new Date();
                const todayStart = new Date();
                todayStart.setHours(0, 0, 0, 0);
                const startTimestamp = todayStart.toISOString();

                // Set to end of day (23:59:59.999) for today
                now.setHours(23, 59, 59, 999);
                const endTimestamp = now.toISOString();

                const { count, error } = await supabase
                    .from('leads')
                    .select('*', { count: 'exact', head: true })
                    .gte('created_at', startTimestamp)
                    .lte('created_at', endTimestamp);

                if (!error && count !== null) {
                    setNewLeadsCount(count);
                } else if (error) {
                    console.error('Error fetching new leads count:', error);
                }
            } catch (error) {
                console.error('Error fetching new leads count:', error);
            }
        };

        fetchNewLeadsCount();
    }, []);

    return (
        <div className="min-h-screen bg-white pt-16">
            <div className="container mx-auto px-4 py-6">
                {/* Welcome Message */}
                <div className="mb-6">
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">
                        Welcome, {userName || 'User'}!
                    </h1>
                    <p className="text-gray-600">Access your leads and manage your cases</p>
                </div>

                {/* Summary Box - New Leads */}
                <div className="mb-6">
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
