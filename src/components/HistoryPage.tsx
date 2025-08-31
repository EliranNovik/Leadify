import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, DocumentTextIcon, UserIcon, PencilSquareIcon, ChatBubbleLeftRightIcon, PhoneIcon, EnvelopeIcon, BanknotesIcon, ArrowPathIcon, UserPlusIcon, NoSymbolIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { Client } from '../types/client';

interface HistoryEntry {
  id: string;
  type: 'edit' | 'interaction' | 'stage_change' | 'lead_created' | 'finance_change' | 'unactivation' | 'activation';
  field?: string;
  old_value?: string;
  new_value?: string;
  changed_by: string;
  changed_at: string;
  user_full_name?: string;
  interaction_type?: 'email' | 'whatsapp' | 'phone' | 'sms' | 'meeting';
  interaction_content?: string;
  interaction_direction?: 'incoming' | 'outgoing';
  // Finance change specific fields
  finance_change_type?: string;
  finance_notes?: string;
  // Unactivation specific fields
  unactivation_reason?: string;
}

const HistoryPage: React.FC = () => {
  const { lead_number } = useParams<{ lead_number: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [historyData, setHistoryData] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<'all' | 'edits' | 'interactions' | 'stage_changes' | 'lead_created' | 'finance_changes' | 'unactivation'>('all');

  useEffect(() => {
    if (lead_number) {
      fetchClientAndHistory();
    }
  }, [lead_number]);

  const fetchClientAndHistory = async () => {
    try {
      setLoading(true);
      
      // Fetch client data with related interactions
      const { data: clientData, error: clientError } = await supabase
        .from('leads')
        .select(`
          *,
          emails (*),
          whatsapp_messages (*)
        `)
        .eq('lead_number', lead_number)
        .single();

      if (clientError) throw clientError;
      setClient(clientData);

      // Build history from available data
      const historyEntries: HistoryEntry[] = [];

      // Add lead creation event
      historyEntries.push({
        id: 'lead_created',
        type: 'lead_created',
        changed_by: clientData.created_by || 'System',
        changed_at: clientData.created_at,
        user_full_name: clientData.created_by_full_name || 'System'
      });

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
      if (clientData.stage_changed_by && clientData.stage_changed_at) {
        historyEntries.push({
          id: 'stage_change',
          type: 'stage_change',
          field: 'stage',
          new_value: clientData.stage,
          changed_by: clientData.stage_changed_by,
          changed_at: clientData.stage_changed_at
        });
      }

      // Add unactivation history
      if (clientData.unactivated_by && clientData.unactivated_at) {
        historyEntries.push({
          id: 'unactivation',
          type: 'unactivation',
          changed_by: clientData.unactivated_by,
          changed_at: clientData.unactivated_at,
          unactivation_reason: clientData.unactivation_reason || 'No reason provided'
        });
      }

      // Note: Activation events would need to be tracked separately since they clear the unactivation data
      // For now, we'll only show unactivation events. Activation events could be added to a separate table
      // or tracked in the lead_changes table in the future.

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
            interaction_direction: interaction.direction || 'outgoing',
            user_full_name: interaction.employee || 'Unknown'
          });
        });
      }

      // Add email interactions
      if (clientData.emails && Array.isArray(clientData.emails)) {
        clientData.emails.forEach((email: any, index: number) => {
          const emailDate = new Date(email.sent_at);
          historyEntries.push({
            id: `email_${index}`,
            type: 'interaction',
            changed_by: email.direction === 'outgoing' ? 'You' : clientData.name,
            changed_at: email.sent_at,
            interaction_type: 'email',
            interaction_content: email.subject || email.body_preview || 'No content',
            interaction_direction: email.direction || 'outgoing',
            user_full_name: email.direction === 'outgoing' ? 'You' : clientData.name
          });
        });
      }

      // Add WhatsApp interactions
      if (clientData.whatsapp_messages && Array.isArray(clientData.whatsapp_messages)) {
        clientData.whatsapp_messages.forEach((msg: any, index: number) => {
          historyEntries.push({
            id: `whatsapp_${index}`,
            type: 'interaction',
            changed_by: msg.direction === 'out' ? msg.sender_name || 'You' : clientData.name,
            changed_at: msg.sent_at,
            interaction_type: 'whatsapp',
            interaction_content: msg.message || 'No content',
            interaction_direction: msg.direction === 'out' ? 'outgoing' : 'incoming',
            user_full_name: msg.direction === 'out' ? msg.sender_name || 'You' : clientData.name
          });
        });
      }

      // Add finance changes from payment_plan_changes table
      console.log('Fetching payment changes for lead_id:', clientData.id);
      
      // Fetch changes directly by lead_id (this will include both existing and deleted payments)
      const { data: paymentChanges, error: paymentChangesError } = await supabase
        .from('payment_plan_changes')
        .select('*')
        .eq('lead_id', clientData.id)
        .order('changed_at', { ascending: false });

      console.log('Payment changes fetch result:', { paymentChanges, paymentChangesError });

      // Add lead changes from lead_changes table
      console.log('Fetching lead changes for lead_id:', clientData.id);
      
      const { data: leadChanges, error: leadChangesError } = await supabase
        .from('lead_changes')
        .select('*')
        .eq('lead_id', clientData.id)
        .order('changed_at', { ascending: false });

      console.log('Lead changes fetch result:', { leadChanges, leadChangesError });

      if (!paymentChangesError && paymentChanges) {
        paymentChanges.forEach((change: any) => {
          const fieldDisplayName = getFieldDisplayName(change.field_name);
          
          if (change.field_name === 'payment_deleted') {
            // Handle deletion entries
            try {
              const deletedPayment = JSON.parse(change.old_value);
              historyEntries.push({
                id: `payment_change_${change.id}`,
                type: 'finance_change',
                changed_by: change.changed_by,
                changed_at: change.changed_at,
                finance_change_type: 'payment_deleted',
                finance_notes: `Payment deleted: ${deletedPayment.payment_order || 'Unknown payment'} (${deletedPayment.value || 0})`,
                user_full_name: change.changed_by // Will be updated later with actual user name
              });
            } catch (e) {
              console.error('Error parsing deleted payment data:', e);
            }
          } else if (change.field_name === 'payment_plan_created' || change.field_name === 'auto_plan_created') {
            // Handle payment plan creation entries
            try {
              const paymentData = JSON.parse(change.new_value);
              historyEntries.push({
                id: `payment_change_${change.id}`,
                type: 'finance_change',
                changed_by: change.changed_by,
                changed_at: change.changed_at,
                finance_change_type: change.field_name,
                finance_notes: `Payment plan created: ${paymentData.payment_order} (${paymentData.value})`,
                user_full_name: change.changed_by // Will be updated later with actual user name
              });
            } catch (e) {
              console.error('Error parsing payment plan creation data:', e);
            }
          } else {
            // Handle regular field changes
            const oldValue = change.old_value || 'empty';
            const newValue = change.new_value || 'empty';
            
            historyEntries.push({
              id: `payment_change_${change.id}`,
              type: 'finance_change',
              changed_by: change.changed_by,
              changed_at: change.changed_at,
              finance_change_type: 'payment_field_updated',
              finance_notes: `${fieldDisplayName} changed from "${oldValue}" to "${newValue}"`,
              user_full_name: change.changed_by // Will be updated later with actual user name
            });
          }
        });
      }

      // Add lead changes to history entries
      if (!leadChangesError && leadChanges) {
        leadChanges.forEach((change: any) => {
          // Handle activation events specially
          if (change.field_name === 'lead_activated') {
            historyEntries.push({
              id: `lead_change_${change.id}`,
              type: 'activation',
              changed_by: change.changed_by,
              changed_at: change.changed_at,
              user_full_name: change.changed_by
            });
          } else {
            // Handle regular field changes
            const fieldDisplayName = getFieldDisplayName(change.field_name);
            
            historyEntries.push({
              id: `lead_change_${change.id}`,
              type: 'edit',
              field: change.field_name,
              old_value: change.old_value,
              new_value: change.new_value,
              changed_by: change.changed_by,
              changed_at: change.changed_at,
              user_full_name: change.changed_by
            });
          }
        });
      }

      // Fetch user full names for all changed_by values
      const allChangedBy = [...new Set(historyEntries.map(entry => entry.changed_by).filter(name => name && name !== 'System'))];
      
      if (allChangedBy.length > 0) {
        console.log('Looking up users for:', allChangedBy);
        console.log('All history entries:', historyEntries.map(e => ({ changed_by: e.changed_by, type: e.type })));
        
        // Try to find users by email first
        const { data: usersByEmail } = await supabase
          .from('users')
          .select('email, full_name, first_name, last_name')
          .in('email', allChangedBy);

        // Try to find users by name (full_name, first_name + last_name)
        const { data: usersByName } = await supabase
          .from('users')
          .select('email, full_name, first_name, last_name')
          .or(`full_name.in.(${allChangedBy.join(',')}),first_name.in.(${allChangedBy.join(',')}),last_name.in.(${allChangedBy.join(',')})`);

        console.log('Users found by email:', usersByEmail);
        console.log('Users found by name:', usersByName);

        // Combine both results
        const allUsers = [...(usersByEmail || []), ...(usersByName || [])];
        
        if (allUsers.length > 0) {
          historyEntries.forEach(entry => {
            console.log(`Processing entry with changed_by: "${entry.changed_by}"`);
            // Try to find by email first
            let user = allUsers.find(u => u.email === entry.changed_by);
            
            // If not found by email, try by name (case-insensitive)
            if (!user) {
              user = allUsers.find(u => 
                u.full_name?.toLowerCase() === entry.changed_by?.toLowerCase() || 
                `${u.first_name} ${u.last_name}`.toLowerCase() === entry.changed_by?.toLowerCase() ||
                u.first_name?.toLowerCase() === entry.changed_by?.toLowerCase() ||
                u.last_name?.toLowerCase() === entry.changed_by?.toLowerCase()
              );
            }
            
            if (user) {
              entry.user_full_name = user.full_name || `${user.first_name} ${user.last_name}` || user.email;
              console.log(`Found user for ${entry.changed_by}:`, entry.user_full_name);
            } else {
              // If no user found, use the changed_by value as is
              entry.user_full_name = entry.changed_by;
              console.log(`No user found for ${entry.changed_by}, using as-is`);
            }
          });
        } else {
          // If no users found in database, use the changed_by values as is
          historyEntries.forEach(entry => {
            entry.user_full_name = entry.changed_by;
            console.log(`No users found in DB, using ${entry.changed_by} as-is`);
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
      'facts': 'Facts',
      'stage': 'Stage',
      'due_date': 'Due Date',
      'due_percent': 'Due Percentage',
      'value': 'Amount',
      'value_vat': 'VAT Amount',
      'client_name': 'Client Name',
      'payment_order': 'Payment Order',
      'notes': 'Notes',
      'payment_deleted': 'Payment Deleted',
      'payment_plan_created': 'Payment Plan Created',
      'auto_plan_created': 'Auto Finance Plan Created',
      // Additional lead field names
      'name': 'Client Name',
      'source': 'Source',
      'language': 'Language',
      'category': 'Category',
      'topic': 'Topic',
      'probability': 'Probability',
      'number_of_applicants_meeting': 'Number of Applicants Meeting',
      'potential_applicants_meeting': 'Potential Applicants Meeting',
      'balance': 'Balance',
      'next_followup': 'Next Follow-up',
      'balance_currency': 'Balance Currency',
    };
    return fieldMap[field] || field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const getFinanceChangeDisplayName = (changeType: string) => {
    const changeTypeMap: { [key: string]: string } = {
      'payment_created': 'Payment Created',
      'payment_updated': 'Payment Updated',
      'payment_deleted': 'Payment Deleted',
      'payment_marked_paid': 'Payment Marked as Paid',
      'payment_plan_created': 'Payment Plan Created',
      'auto_plan_created': 'Auto Finance Plan Created',
      'contract_created': 'Contract Created',
      'contract_updated': 'Contract Updated',
      'payment_field_updated': 'Payment Field Updated'
    };
    return changeTypeMap[changeType] || changeType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
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
        return <ArrowPathIcon className="w-4 h-4 text-orange-500" />;
      case 'lead_created':
        return <UserPlusIcon className="w-4 h-4 text-green-500" />;
      case 'finance_change':
        return <BanknotesIcon className="w-4 h-4 text-purple-500" />;
      case 'unactivation':
        return <NoSymbolIcon className="w-4 h-4 text-red-500" />;
      case 'activation':
        return <CheckCircleIcon className="w-4 h-4 text-green-500" />;
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
    if (filterType === 'edits' && entry.type === 'edit') return true;
    if (filterType === 'interactions' && entry.type === 'interaction') return true;
    if (filterType === 'stage_changes' && entry.type === 'stage_change') return true;
    if (filterType === 'lead_created' && entry.type === 'lead_created') return true;
    if (filterType === 'finance_changes' && entry.type === 'finance_change') return true;
    if (filterType === 'unactivation' && (entry.type === 'unactivation' || entry.type === 'activation')) return true;
    return false;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="loading loading-spinner loading-lg"></div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => navigate(`/clients/${lead_number}`)}
          className="btn btn-outline btn-sm"
        >
          <ArrowLeftIcon className="w-4 h-4 mr-2" />
          Back to Client
        </button>
        <h1 className="text-3xl font-bold">Change History</h1>
      </div>

      {client && (
        <div className="mb-6 p-4 bg-base-100 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-2">{client.name}</h2>
          <p className="text-gray-600">Lead #{client.lead_number}</p>
          {filteredHistory.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-200">
              <p className="text-sm text-gray-500">
                <span className="font-medium">Last interaction:</span> {filteredHistory[0].user_full_name || filteredHistory[0].changed_by}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mb-6">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as any)}
          className="select select-bordered"
        >
          <option value="all">All Changes</option>
          <option value="edits">Field Edits</option>
          <option value="interactions">Interactions</option>
          <option value="stage_changes">Stage Changes</option>
          <option value="lead_created">Lead Created</option>
          <option value="finance_changes">Finance Changes</option>
          <option value="unactivation">Unactivation Events</option>
        </select>
      </div>

      <div className="space-y-4">
        {filteredHistory.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No history entries found.
          </div>
        ) : (
          filteredHistory.map((entry) => (
            <div key={entry.id} className="bg-white rounded-lg shadow-lg hover:shadow-2xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 p-4 border border-gray-100">
              <div className="flex items-start gap-3">
                <div className="mt-1">
                  {getEntryIcon(entry)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">
                        {entry.type === 'finance_change' 
                          ? getFinanceChangeDisplayName(entry.finance_change_type || '')
                          : entry.type === 'interaction'
                          ? `${entry.interaction_type?.toUpperCase()} ${entry.interaction_direction}`
                          : entry.type === 'unactivation'
                          ? 'Lead Unactivated'
                          : entry.type === 'activation'
                          ? 'Lead Activated'
                          : entry.field 
                          ? `${getFieldDisplayName(entry.field)} Updated`
                          : entry.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                        }
                      </span>
                    </div>
                    <span className="text-sm text-gray-500">
                      {formatDate(entry.changed_at)}
                    </span>
                  </div>
                  
                  <div className="text-sm text-gray-600 mb-2">
                    <span className="font-medium">By:</span> {entry.user_full_name || entry.changed_by}
                  </div>
                  
                  {entry.type === 'finance_change' && entry.finance_notes && (
                    <div className="text-sm text-gray-700 bg-gray-50 p-2 rounded">
                      {entry.finance_notes}
                    </div>
                  )}
                  
                  {entry.type === 'interaction' && entry.interaction_content && (
                    <div className="text-sm text-gray-700 bg-gray-50 p-2 rounded">
                      {entry.interaction_content}
                    </div>
                  )}
                  
                  {entry.type === 'edit' && entry.new_value && (
                    <div className="text-sm text-gray-700 bg-gray-50 p-2 rounded">
                      <span className="font-medium">New value:</span> {entry.new_value}
                    </div>
                  )}
                  
                  {entry.type === 'stage_change' && entry.new_value && (
                    <div className="text-sm text-gray-700 bg-gray-50 p-2 rounded">
                      <span className="font-medium">New stage:</span> {entry.new_value}
                    </div>
                  )}
                  
                  {entry.type === 'unactivation' && entry.unactivation_reason && (
                    <div className="text-sm text-gray-700 bg-red-50 p-2 rounded border border-red-200">
                      <span className="font-medium text-red-700">Reason:</span> {entry.unactivation_reason.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                    </div>
                  )}
                  
                  {entry.type === 'activation' && (
                    <div className="text-sm text-gray-700 bg-green-50 p-2 rounded border border-green-200">
                      <span className="font-medium text-green-700">Lead reactivated</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default HistoryPage;