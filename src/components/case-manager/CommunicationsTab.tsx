import React, { useState, useEffect } from 'react';
import { 
  ChatBubbleLeftRightIcon,
  PaperAirplaneIcon,
  ClockIcon,
  UserIcon
} from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import { toast } from 'react-hot-toast';

interface HandlerLead {
  id: string;
  lead_number: string;
  name: string;
  email?: string;
  phone?: string;
  category?: string;
  stage: string;
  handler_stage?: string;
  created_at: string;
  balance?: number;
  balance_currency?: string;
  onedrive_folder_link?: string;
  expert?: string;
  handler?: string;
  closer?: string;
  scheduler?: string;
  manager?: string;
}

interface Communication {
  id: string;
  lead_id: string;
  message: string;
  sent_by: string;
  sent_at: string;
  message_type: 'email' | 'sms' | 'whatsapp' | 'phone' | 'other';
  status: 'sent' | 'delivered' | 'read' | 'failed';
}

interface HandlerTabProps {
  leads: HandlerLead[];
  uploadFiles: (lead: HandlerLead, files: File[]) => Promise<void>;
  uploadingLeadId: string | null;
  uploadedFiles: { [leadId: string]: any[] };
  isUploading: boolean;
  handleFileInput: (lead: HandlerLead, e: React.ChangeEvent<HTMLInputElement>) => void;
  refreshLeads: () => Promise<void>;
}

const CommunicationsTab: React.FC<HandlerTabProps> = ({ leads }) => {
  const [communications, setCommunications] = useState<Communication[]>([]);
  const [loading, setLoading] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState<string>('');
  const [messageType, setMessageType] = useState<Communication['message_type']>('email');
  const [sending, setSending] = useState(false);

  const fetchCommunications = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('communications')
        .select('*')
        .order('sent_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setCommunications(data || []);
    } catch (error) {
      console.error('Error fetching communications:', error);
      toast.error('Failed to fetch communications');
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (leadId: string) => {
    if (!newMessage.trim()) {
      toast.error('Please enter a message');
      return;
    }

    setSending(true);
    try {
      const { error } = await supabase
        .from('communications')
        .insert({
          lead_id: leadId,
          message: newMessage,
          message_type: messageType,
          status: 'sent',
          sent_by: 'System User', // This should be the current user
          sent_at: new Date().toISOString()
        });

      if (error) throw error;
      
      toast.success('Message sent successfully');
      setNewMessage('');
      setSelectedLeadId('');
      fetchCommunications();
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    fetchCommunications();
  }, []);

  const getMessageTypeIcon = (type: Communication['message_type']) => {
    switch (type) {
      case 'email':
        return '📧';
      case 'sms':
        return '📱';
      case 'whatsapp':
        return '💬';
      case 'phone':
        return '📞';
      default:
        return '💬';
    }
  };

  const getStatusBadgeColor = (status: Communication['status']) => {
    switch (status) {
      case 'sent':
        return 'badge-info';
      case 'delivered':
        return 'badge-warning';
      case 'read':
        return 'badge-success';
      case 'failed':
        return 'badge-error';
      default:
        return 'badge-neutral';
    }
  };

  return (
    <div className="w-full px-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <h3 className="text-xl font-bold text-gray-900">Communications</h3>
          <p className="text-gray-600">Send messages and view communication history</p>
        </div>
      </div>

      {/* Send New Message */}
      <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-8 mb-8">
        <h4 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <PaperAirplaneIcon className="w-5 h-5 text-blue-600" />
          Send New Message
        </h4>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Select Lead</label>
            <select
              className="select select-bordered w-full"
              value={selectedLeadId}
              onChange={(e) => setSelectedLeadId(e.target.value)}
            >
              <option value="">Choose a lead...</option>
              {leads.map(lead => (
                <option key={lead.id} value={lead.id}>
                  {lead.name} - #{lead.lead_number}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message Type</label>
            <select
              className="select select-bordered w-full"
              value={messageType}
              onChange={(e) => setMessageType(e.target.value as Communication['message_type'])}
            >
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="phone">Phone Call</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
            <textarea
              className="textarea textarea-bordered w-full h-24 resize-none"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Enter your message..."
            />
          </div>

          <div className="flex gap-2">
            <button
              className="btn btn-primary"
              onClick={() => sendMessage(selectedLeadId)}
              disabled={!selectedLeadId || !newMessage.trim() || sending}
            >
              {sending ? (
                <div className="loading loading-spinner loading-sm"></div>
              ) : (
                <>
                  <PaperAirplaneIcon className="w-4 h-4" />
                  Send Message
                </>
              )}
            </button>
            <button
              className="btn btn-outline"
              onClick={() => {
                setNewMessage('');
                setSelectedLeadId('');
              }}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* Communications History */}
      <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-8 mb-8">
        <h4 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <ChatBubbleLeftRightIcon className="w-5 h-5 text-green-600" />
          Communication History
        </h4>
        
        {loading ? (
          <div className="text-center py-16 px-8">
            <div className="loading loading-spinner loading-lg text-purple-600"></div>
            <p className="text-gray-600 mt-4">Loading communications...</p>
          </div>
        ) : communications.length === 0 ? (
          <div className="text-center py-16 px-8 text-gray-500">
            <ChatBubbleLeftRightIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p className="text-lg font-medium mb-1">No communications found</p>
            <p className="text-base">No messages have been sent yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {communications.map((comm) => {
              const lead = leads.find(l => l.id === comm.lead_id);
              return (
                <div key={comm.id} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg">{getMessageTypeIcon(comm.message_type)}</span>
                        <h5 className="font-semibold text-gray-900">
                          {lead ? `${lead.name} (#${lead.lead_number})` : 'Unknown Lead'}
                        </h5>
                        <span className={`badge ${getStatusBadgeColor(comm.status)} text-white border-none`}>
                          {comm.status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">
                        Sent by: {comm.sent_by} • {new Date(comm.sent_at).toLocaleDateString()} {new Date(comm.sent_at).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                  
                  <div className="bg-white rounded-lg p-3 border border-gray-200">
                    <p className="text-gray-700 whitespace-pre-wrap">{comm.message}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-xl p-6 border border-gray-200">
        <h4 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <ClockIcon className="w-5 h-5 text-purple-600" />
          Quick Actions
        </h4>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <button className="btn btn-outline btn-lg">
            <span className="text-lg">📧</span>
            Send Email Template
          </button>
          <button className="btn btn-outline btn-lg">
            <span className="text-lg">💬</span>
            Send WhatsApp
          </button>
          <button className="btn btn-outline btn-lg">
            <span className="text-lg">📞</span>
            Schedule Call
          </button>
          <button className="btn btn-outline btn-lg">
            <span className="text-lg">📱</span>
            Send SMS
          </button>
          <button className="btn btn-outline btn-lg">
            <span className="text-lg">📋</span>
            Send Document Request
          </button>
          <button className="btn btn-outline btn-lg">
            <span className="text-lg">📅</span>
            Schedule Meeting
          </button>
        </div>
      </div>
    </div>
  );
};

export default CommunicationsTab; 