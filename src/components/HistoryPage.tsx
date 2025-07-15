import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, DocumentTextIcon, UserIcon, PencilSquareIcon, ChatBubbleLeftRightIcon, PhoneIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { Client } from '../types/client';

interface HistoryEntry {
  id: string;
  type: 'edit' | 'interaction' | 'stage_change';
  field?: string;
  old_value?: string;
  new_value?: string;
  changed_by: string;
  changed_at: string;
  user_full_name?: string;
  interaction_type?: 'email' | 'whatsapp' | 'phone' | 'sms' | 'meeting';
  interaction_content?: string;
  interaction_direction?: 'incoming' | 'outgoing';
}

const HistoryPage: React.FC = () => {
  const { lead_number } = useParams<{ lead_number: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [historyData, setHistoryData] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<'all' | 'edits' | 'interactions' | 'stage_changes'>('all');

  useEffect(() => {
    if (lead_number) {
      fetchClientAndHistory();
    }
  }, [lead_number]);

  const fetchClientAndHistory = async () => {
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

      // Build history from available data
      const historyEntries: HistoryEntry[] = [];

      // Add field edit history
      const fieldEditHistory = [
        {
          field: 'special_notes',
          changed_by: clientData.special_notes_last_edited_by,
          changed_at: clientData.special_notes_last_edited_at,
          current_value: clientData.special_notes
        },
        {
          field: 'general_notes',
          changed_by: clientData.general_notes_last_edited_by,
          changed_at: clientData.general_notes_last_edited_at,
          current_value: clientData.general_notes
        },
        {
          field: 'tags',
          changed_by: clientData.tags_last_edited_by,
          changed_at: clientData.tags_last_edited_at,
          current_value: clientData.tags
        },
        {
          field: 'anchor',
          changed_by: clientData.anchor_last_edited_by,
          changed_at: clientData.anchor_last_edited_at,
          current_value: clientData.anchor
        },
        {
          field: 'facts',
          changed_by: clientData.facts_last_edited_by,
          changed_at: clientData.facts_last_edited_at,
          current_value: clientData.facts
        }
      ];

      fieldEditHistory.forEach((field, index) => {
        if (field.changed_by && field.changed_at) {
          historyEntries.push({
            id: `edit_${index}`,
            type: 'edit',
            field: field.field,
            new_value: field.current_value,
            changed_by: field.changed_by,
            changed_at: field.changed_at
          });
        }
      });

      // Add stage change history
      if (clientData.last_stage_changed_by && clientData.last_stage_changed_at) {
        historyEntries.push({
          id: 'stage_change',
          type: 'stage_change',
          field: 'stage',
          new_value: clientData.stage,
          changed_by: clientData.last_stage_changed_by,
          changed_at: clientData.last_stage_changed_at
        });
      }

      // Add manual interactions from the interactions field
      if (clientData.manual_interactions && Array.isArray(clientData.manual_interactions)) {
        clientData.manual_interactions.forEach((interaction: any, index: number) => {
          historyEntries.push({
            id: `interaction_${index}`,
            type: 'interaction',
            changed_by: interaction.employee || 'Unknown',
            changed_at: `${interaction.date} ${interaction.time}`,
            interaction_type: interaction.kind?.toLowerCase() || 'unknown',
            interaction_content: interaction.content || interaction.observation || 'No content',
            interaction_direction: interaction.direction || 'outgoing'
          });
        });
      }

      // Fetch user full names
      const userEmails = [...new Set(historyEntries.map(entry => entry.changed_by).filter(email => email && email !== 'System'))];
      
      if (userEmails.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('email, full_name, name')
          .in('email', userEmails);

        if (users) {
          historyEntries.forEach(entry => {
            const user = users.find(u => u.email === entry.changed_by);
            if (user) {
              entry.user_full_name = user.full_name || user.name || user.email;
            }
          });
        }
      }

      // Sort by date (newest first)
      historyEntries.sort((a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime());
      
      setHistoryData(historyEntries);
    } catch (error) {
      console.error('Error fetching history:', error);
    } finally {
      setLoading(false);
    }
  };

  const getFieldDisplayName = (field: string) => {
    const fieldMap: { [key: string]: string } = {
      'special_notes': 'Special Notes',
      'general_notes': 'General Notes',
      'tags': 'Tags',
      'anchor': 'Anchor',
      'facts': 'Facts of Case',
      'stage': 'Stage'
    };
    return fieldMap[field] || field;
  };

  const getInteractionIcon = (type: string) => {
    switch (type) {
      case 'email':
        return <EnvelopeIcon className="w-4 h-4 text-blue-500" />;
      case 'whatsapp':
        return <ChatBubbleLeftRightIcon className="w-4 h-4 text-green-500" />;
      case 'phone':
      case 'call':
        return <PhoneIcon className="w-4 h-4 text-purple-500" />;
      case 'sms':
        return <ChatBubbleLeftRightIcon className="w-4 h-4 text-orange-500" />;
      default:
        return <DocumentTextIcon className="w-4 h-4 text-gray-500" />;
    }
  };

  const getEntryIcon = (entry: HistoryEntry) => {
    switch (entry.type) {
      case 'edit':
        return <PencilSquareIcon className="w-4 h-4 text-blue-500" />;
      case 'interaction':
        return getInteractionIcon(entry.interaction_type || 'unknown');
      case 'stage_change':
        return <DocumentTextIcon className="w-4 h-4 text-green-500" />;
      default:
        return <DocumentTextIcon className="w-4 h-4 text-gray-500" />;
    }
  };


  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  };

  const filteredHistory = historyData.filter(entry => {
    if (filterType === 'all') return true;
    if (filterType === 'edits') return entry.type === 'edit';
    if (filterType === 'interactions') return entry.type === 'interaction';
    if (filterType === 'stage_changes') return entry.type === 'stage_change';
    return true;
  });

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
                <h1 className="text-xl font-semibold text-gray-900">History</h1>
                <p className="text-sm text-gray-500">{client.name} ({client.lead_number})</p>
              </div>
            </div>
            
            {/* Filter */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Filter:</label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as any)}
                className="select select-bordered select-sm"
              >
                <option value="all">All Changes</option>
                <option value="edits">Field Edits</option>
                <option value="interactions">Interactions</option>
                <option value="stage_changes">Stage Changes</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* History Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center gap-3 mb-6">
          <DocumentTextIcon className="w-6 h-6 text-primary" />
          <h2 className="text-2xl font-bold text-gray-900">Change History</h2>
        </div>

            {filteredHistory.length === 0 ? (
              <div className="text-center py-12">
                <DocumentTextIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">No history data available</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredHistory.map((entry) => (
                  <div key={entry.id} className="p-4 border-b border-gray-200 last:border-b-0">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 mt-1">
                        {getEntryIcon(entry)}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-medium text-gray-900">
                            {entry.type === 'edit' && `Updated ${getFieldDisplayName(entry.field || '')}`}
                            {entry.type === 'interaction' && `${entry.interaction_type?.toUpperCase()} ${entry.interaction_direction}`}
                            {entry.type === 'stage_change' && 'Stage Changed'}
                          </span>
                          <span className="text-sm text-gray-500">•</span>
                          <span className="text-sm text-gray-500">{formatDate(entry.changed_at)}</span>
                        </div>
                        
                        <div className="flex items-center gap-2 mb-2">
                          <UserIcon className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-600">{entry.user_full_name || entry.changed_by}</span>
                        </div>
                        
                        {entry.type === 'edit' && entry.new_value && (
                          <div className="mt-2">
                            <p className="text-sm text-gray-700">{entry.new_value}</p>
                          </div>
                        )}
                        
                        {entry.type === 'interaction' && entry.interaction_content && (
                          <div className="mt-2">
                            <p className="text-sm text-gray-700">{entry.interaction_content}</p>
                          </div>
                        )}
                        
                        {entry.type === 'stage_change' && entry.new_value && (
                          <div className="mt-2">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                              {entry.new_value.replace(/_/g, ' ')}
                            </span>
                          </div>
                        )}
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

export default HistoryPage;