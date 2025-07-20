import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, ClockIcon, UserIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { Client } from '../types/client';

interface TimelineEntry {
  id: string;
  stage: string;
  changed_by: string;
  changed_at: string;
  user_full_name?: string;
}

const TimelinePage: React.FC = () => {
  const { lead_number } = useParams<{ lead_number: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [timelineData, setTimelineData] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (lead_number) {
      fetchClientAndTimeline();
    }
  }, [lead_number]);

  const fetchClientAndTimeline = async () => {
    try {
      setLoading(true);
      
      // Fetch client data
      const { data: clientData, error: clientError } = await supabase
        .from('leads')
        .select('*')
        .eq('lead_number', lead_number)
        .single();

      if (clientError) throw clientError;
      setClient(clientData);

      // Fetch timeline data (stage changes)
      // Create timeline based on available data
      const mockTimeline: TimelineEntry[] = [
        {
          id: '1',
          stage: 'created',
          changed_by: clientData.created_by || 'System',
          changed_at: clientData.created_at,
          user_full_name: clientData.created_by_full_name || 'System'
        }
      ];

      // Add current stage if different from created
      if (clientData.stage !== 'created') {
        mockTimeline.push({
          id: '2',
          stage: clientData.stage,
          changed_by: clientData.stage_changed_by || 'Unknown',
          changed_at: clientData.stage_changed_at || clientData.updated_at || clientData.created_at,
          user_full_name: clientData.stage_changed_by || 'Unknown'
        });
      }

      // Fetch user full names for stage changes
      const userEmails = [...new Set(mockTimeline.map(entry => entry.changed_by).filter(email => email && email !== 'System'))];
      
      if (userEmails.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('email, full_name, name')
          .in('email', userEmails);

        if (users) {
          mockTimeline.forEach(entry => {
            const user = users.find(u => u.email === entry.changed_by);
            if (user) {
              entry.user_full_name = user.full_name || user.name || user.email;
            }
          });
        }
      }

      setTimelineData(mockTimeline.sort((a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime()));
    } catch (error) {
      console.error('Error fetching timeline:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStageDisplayName = (stage: string) => {
    const stageMap: { [key: string]: string } = {
      'created': 'Lead Created',
      'scheduler_assigned': 'Scheduler Assigned',
      'meeting_scheduled': 'Meeting Scheduled',
      'meeting_paid': 'Meeting Paid',
      'unactivated': 'Unactivated',
      'communication_started': 'Communication Started',
      'another_meeting': 'Another Meeting',
      'revised_offer': 'Revised Offer',
      'offer_sent': 'Offer Sent',
      'waiting_for_mtng_sum': 'Waiting for Meeting Summary',
      'client_signed': 'Client Signed',
      'client_declined': 'Client Declined',
      'lead_summary': 'Lead Summary',
      'meeting_rescheduled': 'Meeting Rescheduled',
      'meeting_ended': 'Meeting Ended',
      'Mtng sum+Agreement sent': 'Meeting Summary + Agreement Sent',
      'Client signed agreement': 'Client Signed Agreement',
      'payment_request_sent': 'Payment Request Sent',
      'finances_and_payments_plan': 'Finances and Payments Plan'
    };
    return stageMap[stage] || stage;
  };

  const getStageColor = (stage: string) => {
    const colorMap: { [key: string]: string } = {
      'created': 'bg-blue-100 text-blue-800',
      'scheduler_assigned': 'bg-purple-100 text-purple-800',
      'meeting_scheduled': 'bg-yellow-100 text-yellow-800',
      'meeting_paid': 'bg-green-100 text-green-800',
      'communication_started': 'bg-indigo-100 text-indigo-800',
      'offer_sent': 'bg-orange-100 text-orange-800',
      'client_signed': 'bg-green-100 text-green-800',
      'client_declined': 'bg-red-100 text-red-800',
      'meeting_ended': 'bg-gray-100 text-gray-800',
      'payment_request_sent': 'bg-teal-100 text-teal-800',
      'finances_and_payments_plan': 'bg-emerald-100 text-emerald-800'
    };
    return colorMap[stage] || 'bg-gray-100 text-gray-800';
  };

  const getStageIcon = (stage: string) => {
    if (stage.includes('declined') || stage.includes('failed')) {
      return <XCircleIcon className="w-5 h-5 text-red-500" />;
    }
    if (stage.includes('signed') || stage.includes('paid') || stage.includes('completed')) {
      return <CheckCircleIcon className="w-5 h-5 text-green-500" />;
    }
    return <ClockIcon className="w-5 h-5 text-blue-500" />;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-600">Client Not Found</h2>
          <p className="text-gray-500 mt-2">The client with lead number {lead_number} could not be found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate(`/clients/${lead_number}`)}
                className="btn btn-ghost btn-sm"
              >
                <ArrowLeftIcon className="w-4 h-4" />
                Back to Client
              </button>
              <div className="h-6 w-px bg-gray-300"></div>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">Timeline</h1>
                <p className="text-sm text-gray-500">{client.name} ({client.lead_number})</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Timeline Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center gap-3 mb-6">
          <ClockIcon className="w-6 h-6 text-primary" />
          <h2 className="text-2xl font-bold text-gray-900">Stage Timeline</h2>
        </div>

            {timelineData.length === 0 ? (
              <div className="text-center py-12">
                <ClockIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">No timeline data available</p>
              </div>
            ) : (
              <div className="space-y-6">
                {timelineData.map((entry, index) => (
                  <div key={entry.id} className="relative">
                    {/* Timeline line */}
                    {index < timelineData.length - 1 && (
                      <div className="absolute left-6 top-12 w-0.5 h-16 bg-gray-200"></div>
                    )}
                    
                    {/* Timeline entry */}
                    <div className="flex items-start gap-4">
                      <div className="flex-shrink-0 w-12 h-12 bg-white border-2 border-gray-200 rounded-full flex items-center justify-center">
                        {getStageIcon(entry.stage)}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStageColor(entry.stage)}`}>
                            {getStageDisplayName(entry.stage)}
                          </span>
                          <span className="text-sm text-gray-500">{formatDate(entry.changed_at)}</span>
                        </div>
                        
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <UserIcon className="w-4 h-4" />
                          <span>Changed by: {entry.user_full_name || 'Unknown'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
      </div>
    </div>
  );
};

export default TimelinePage;