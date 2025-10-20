import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { buildApiUrl } from '../lib/api';
import {
  MagnifyingGlassIcon,
  PaperAirplaneIcon,
  PhoneIcon,
  UserPlusIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';

interface WhatsAppLead {
  id: number;
  lead_id: string | null;
  legacy_id: number | null;
  sender_name: string;
  direction: 'in' | 'out';
  message: string;
  sent_at: string;
  status: string;
  message_type: 'text' | 'image' | 'document' | 'audio' | 'video' | 'location' | 'contact';
  media_url?: string;
  media_filename?: string;
  media_mime_type?: string;
  media_size?: number;
  caption?: string;
  whatsapp_message_id?: string;
  whatsapp_status?: 'sent' | 'delivered' | 'read' | 'failed';
  whatsapp_timestamp?: string;
  error_message?: string;
  phone_number?: string;
  is_connected: boolean;
  message_count: number;
  last_message_at: string;
}

const WhatsAppLeadsPage: React.FC = () => {
  const [leads, setLeads] = useState<WhatsAppLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLead, setSelectedLead] = useState<WhatsAppLead | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch current user info
  useEffect(() => {
    const fetchCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        // Try to find user in users table by email
        const { data: userRow } = await supabase
          .from('users')
          .select('id, full_name, email')
          .eq('email', user.email)
          .single();
        
        if (userRow) {
          setCurrentUser(userRow);
        } else {
          // Fallback: create a user object with available data
          const fallbackUser = {
            id: user.id,
            full_name: user.user_metadata?.full_name || user.user_metadata?.name || user.email,
            email: user.email
          };
          setCurrentUser(fallbackUser);
        }
      }
    };
    fetchCurrentUser();
  }, []);

  // Mobile detection
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Fetch WhatsApp leads (messages from unconnected numbers)
  useEffect(() => {
    const fetchWhatsAppLeads = async () => {
      try {
        setLoading(true);
        console.log('🔍 Fetching WhatsApp leads...');

        // Get all incoming WhatsApp messages
        const { data: incomingMessages, error } = await supabase
          .from('whatsapp_messages')
          .select(`
            *,
            leads!whatsapp_messages_lead_id_fkey(id, name, lead_number, phone, mobile)
          `)
          .eq('direction', 'in')
          .order('sent_at', { ascending: false });

        if (error) {
          console.error('Error fetching WhatsApp messages:', error);
          toast.error('Failed to load WhatsApp leads');
          return;
        }

        console.log('📨 Raw incoming messages:', incomingMessages?.length || 0);
        console.log('📨 Sample message data:', incomingMessages?.slice(0, 3));

        // Group messages by phone number and identify unconnected ones
        const leadMap = new Map<string, WhatsAppLead>();
        
        incomingMessages?.forEach((message) => {
          // Use phone_number field directly from database, fallback to extraction if not available
          const phoneNumber = message.phone_number || extractPhoneNumber(message.sender_name) || extractPhoneFromMessage(message.message) || 'unknown';
          
          console.log('🔍 Processing message:', {
            id: message.id,
            sender_name: message.sender_name,
            phone_number: message.phone_number,
            extractedPhone: phoneNumber,
            lead_id: message.lead_id,
            legacy_id: message.legacy_id,
            hasLeads: !!message.leads
          });
          
          if (!leadMap.has(phoneNumber)) {
            // Consider connected if linked to a new lead via FK or legacy_id present
            const isConnected = !!message.lead_id || !!message.legacy_id || !!message.leads;
            
            // Additional check: see if phone number matches any existing lead's phone/mobile (new leads only)
            const phoneMatchesLead = !!message.leads && (
              message.leads.phone === phoneNumber || message.leads.mobile === phoneNumber
            );
            
            leadMap.set(phoneNumber, {
              ...message,
              phone_number: phoneNumber,
              is_connected: !!isConnected || !!phoneMatchesLead,
              message_count: 1,
              last_message_at: message.sent_at
            });
          } else {
            const existingLead = leadMap.get(phoneNumber)!;
            existingLead.message_count += 1;
            // Keep the most recent message as the main message
            if (new Date(message.sent_at) > new Date(existingLead.last_message_at)) {
              Object.assign(existingLead, {
                ...message,
                phone_number: phoneNumber,
                message_count: existingLead.message_count,
                last_message_at: message.sent_at
              });
            }
          }
        });

        // Filter out connected leads and convert to array
        const unconnectedLeads = Array.from(leadMap.values())
          .filter(lead => !lead.is_connected && lead.phone_number !== 'unknown')
          .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());

        console.log('📊 Unconnected leads found:', unconnectedLeads.length);
        console.log('📋 Sample unconnected leads:', unconnectedLeads.slice(0, 3));
        console.log('📋 All unconnected leads details:', unconnectedLeads.map(lead => ({
          phone_number: lead.phone_number,
          sender_name: lead.sender_name,
          message: lead.message,
          is_connected: lead.is_connected,
          message_count: lead.message_count
        })));
        setLeads(unconnectedLeads);

      } catch (error) {
        console.error('Error fetching WhatsApp leads:', error);
        toast.error('Failed to load WhatsApp leads');
      } finally {
        setLoading(false);
      }
    };

    fetchWhatsAppLeads();
    
    // Set up polling to refresh every 30 seconds
    const interval = setInterval(fetchWhatsAppLeads, 30000);
    return () => clearInterval(interval);
  }, []);

  // Helper function to extract phone number from sender name
  const extractPhoneNumber = (senderName: string): string | null => {
    if (!senderName) return null;
    
    // Try to extract full phone number from various formats
    // Israeli phone numbers: +972501234567, 972501234567, 0501234567, 501234567
    const phoneRegex = /(\+?9725[0-9]{8}|05[0-9]{8}|5[0-9]{8})/;
    const match = senderName.match(phoneRegex);
    return match ? match[1] : null;
  };

  // Helper function to extract phone number from message content
  const extractPhoneFromMessage = (message: string): string | null => {
    if (!message) return null;
    
    // Try to extract full phone number from message content
    // Israeli phone numbers: +972501234567, 972501234567, 0501234567, 501234567
    const phoneRegex = /(\+?9725[0-9]{8}|05[0-9]{8}|5[0-9]{8})/;
    const match = message.match(phoneRegex);
    return match ? match[1] : null;
  };

  // Fetch messages for selected lead
  useEffect(() => {
    const fetchMessages = async () => {
      if (!selectedLead) {
        setMessages([]);
        return;
      }

      try {
        console.log('🔄 Fetching messages for lead:', selectedLead.phone_number);
        
        // Fetch messages that match the phone number or sender name
        // Use separate queries to avoid special character parsing issues
        const [phoneQuery, nameQuery] = await Promise.all([
          supabase
            .from('whatsapp_messages')
            .select('*')
            .eq('phone_number', selectedLead.phone_number)
            .order('sent_at', { ascending: true }),
          supabase
            .from('whatsapp_messages')
            .select('*')
            .eq('sender_name', selectedLead.sender_name)
            .order('sent_at', { ascending: true })
        ]);

        // Combine results and remove duplicates
        const phoneMessages = phoneQuery.data || [];
        const nameMessages = nameQuery.data || [];
        const allMessages = [...phoneMessages, ...nameMessages];
        
        console.log('🔍 Query results:', {
          phoneMessages: phoneMessages.length,
          nameMessages: nameMessages.length,
          totalMessages: allMessages.length
        });
        
        // Remove duplicates based on message ID
        const uniqueMessages = allMessages.filter((message, index, self) => 
          index === self.findIndex(m => m.id === message.id)
        );
        
        const data = uniqueMessages;
        const error = phoneQuery.error || nameQuery.error;

        if (error) {
          console.error('Error fetching messages:', error);
          toast.error('Failed to load messages');
          return;
        }

        console.log('📨 Messages fetched for lead:', data?.length || 0);
        setMessages(data || []);
        
        // Auto-scroll to bottom
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);

      } catch (error) {
        console.error('Error fetching messages:', error);
        toast.error('Failed to load messages');
      }
    };

    fetchMessages();
  }, [selectedLead]);

  // Filter leads based on search term
  const filteredLeads = leads.filter(lead =>
    lead.phone_number?.includes(searchTerm) ||
    lead.sender_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lead.message.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Send reply message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedLead || !currentUser) return;

    setSending(true);
    try {
      console.log('🚀 Sending reply message:', {
        message: newMessage.trim(),
        to: selectedLead.phone_number,
        sender: currentUser.full_name || currentUser.email
      });

      // Send message via WhatsApp API
      const response = await fetch(buildApiUrl('/api/whatsapp/send-message'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          leadId: null, // No lead ID for new WhatsApp leads
          phoneNumber: selectedLead.phone_number,
          message: newMessage.trim(),
          sender_name: currentUser.full_name || currentUser.email
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send message');
      }

      // Add message to local state
      const newMsg = {
        id: Date.now(), // Temporary ID
        phone_number: selectedLead.phone_number,
        sender_name: currentUser.full_name || currentUser.email,
        direction: 'out',
        message: newMessage.trim(),
        sent_at: new Date().toISOString(),
        status: 'sent',
        message_type: 'text',
        whatsapp_status: 'sent',
        whatsapp_message_id: result.messageId
      };

      setMessages(prev => [...prev, newMsg]);
      setNewMessage('');
      
      // Auto-scroll to bottom
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);

      toast.success('Reply sent successfully!');
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Failed to send message: ' + (error as Error).message);
    } finally {
      setSending(false);
    }
  };

  // Convert lead to client
  const handleConvertToLead = async (lead: WhatsAppLead) => {
    try {
      setLoading(true);
      console.log('🔄 Converting WhatsApp lead to new lead:', lead);

      // Get current user information
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        toast.error('User not authenticated');
        return;
      }

      // Extract name from phone number or use a default
      const leadName = lead.phone_number || 'WhatsApp Lead';
      
      // Create the new lead using the database function
      const { data, error } = await supabase.rpc('create_new_lead_v3', {
        p_lead_name: leadName,
        p_lead_email: null, // We don't have email from WhatsApp
        p_lead_phone: lead.phone_number,
        p_lead_topic: 'WhatsApp Inquiry', // Default topic
        p_lead_language: 'English', // Default language
        p_lead_source: 'WhatsApp', // Source is WhatsApp
        p_created_by: user.email,
        p_balance_currency: 'NIS', // Default currency
        p_proposal_currency: 'NIS' // Default currency
      });

      if (error) {
        console.error('Error creating lead:', error);
        toast.error('Failed to create lead');
        return;
      }

      const newLead = data?.[0];
      if (!newLead) {
        toast.error('Could not create lead');
        return;
      }

      console.log('✅ Created new lead:', newLead);

      // Update the WhatsApp messages to link them to the new lead
      const { error: updateError } = await supabase
        .from('whatsapp_messages')
        .update({ 
          lead_id: newLead.id,
          legacy_id: null // Clear legacy_id since this is a new lead
        })
        .or(`sender_name.ilike.%${lead.phone_number}%,sender_name.ilike.%${lead.sender_name}%,message.ilike.%${lead.phone_number}%`);

      if (updateError) {
        console.error('Error linking messages to lead:', updateError);
        // Don't fail the whole process, just log the error
      } else {
        console.log('✅ Linked WhatsApp messages to new lead');
      }

      toast.success(`Lead ${newLead.lead_number} created successfully!`);
      
      // Refresh the leads list to remove the converted lead
      setLeads(prevLeads => prevLeads.filter(l => l.id !== lead.id));
      setSelectedLead(null);

      // Navigate to the new lead's page
      window.location.href = `/clients/${newLead.lead_number}`;

    } catch (error) {
      console.error('Error converting lead:', error);
      toast.error('Failed to convert lead');
    } finally {
      setLoading(false);
    }
  };

  // Format time
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffTime = now.getTime() - date.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays <= 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  // Get message preview
  const getMessagePreview = (message: string) => {
    return message.length > 50 ? message.substring(0, 50) + '...' : message;
  };

  return (
    <div className="fixed inset-0 bg-white z-[9999]">
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
            <FaWhatsapp className="w-6 h-6 md:w-8 md:h-8 text-green-600 flex-shrink-0" />
            <h2 className="text-lg md:text-2xl font-bold text-gray-900 flex-shrink-0">WhatsApp Leads</h2>
            <div className="flex items-center gap-2">
              <span className="bg-green-100 text-green-800 text-xs font-medium px-2.5 py-0.5 rounded-full">
                {leads.length} Leads
              </span>
            </div>
          </div>
          <button
            onClick={() => window.history.back()}
            className="btn btn-ghost btn-circle flex-shrink-0"
          >
            <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel - Leads List */}
          <div className={`${isMobile ? 'w-full' : 'w-80'} border-r border-gray-200 flex flex-col ${isMobile && showChat ? 'hidden' : ''}`}>
            {/* Search Bar */}
            <div className="p-3 border-b border-gray-200">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by phone number or message..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Leads List */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center h-32">
                  <div className="loading loading-spinner loading-lg text-green-600"></div>
                </div>
              ) : filteredLeads.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <ChatBubbleLeftRightIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p className="text-lg font-medium">No WhatsApp leads found</p>
                  <p className="text-sm">
                    {searchTerm ? 'No leads match your search criteria' : 'New leads will appear here when potential clients message your WhatsApp number'}
                  </p>
                </div>
              ) : (
                filteredLeads.map((lead) => {
                  const isSelected = selectedLead?.id === lead.id;

                  return (
                    <div
                      key={lead.id}
                      onClick={() => {
                        setSelectedLead(lead);
                        if (isMobile) {
                          setShowChat(true);
                        }
                      }}
                      className={`p-3 md:p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${
                        isSelected ? 'bg-green-50 border-l-4 border-l-green-500' : ''
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Avatar */}
                        <div className="w-10 h-10 md:w-12 md:h-12 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                          {lead.sender_name && lead.sender_name !== lead.phone_number && !lead.sender_name.match(/^\d+$/) ? (
                            <span className="text-green-600 font-semibold text-sm md:text-lg">
                              {lead.sender_name.charAt(0).toUpperCase()}
                            </span>
                          ) : (
                            <PhoneIcon className="w-5 h-5 md:w-6 md:h-6 text-green-600" />
                          )}
                        </div>

                        {/* Lead Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex flex-col">
                              <h3 className="font-semibold text-gray-900 truncate">
                                {lead.sender_name && lead.sender_name !== lead.phone_number && !lead.sender_name.match(/^\d+$/) 
                                  ? lead.sender_name 
                                  : lead.phone_number || 'Unknown Number'}
                              </h3>
                              {lead.sender_name && lead.sender_name !== lead.phone_number && !lead.sender_name.match(/^\d+$/) && (
                                <p className="text-xs text-gray-500 truncate">
                                  {lead.phone_number}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <span className="text-xs text-gray-500">
                                {formatTime(lead.last_message_at)}
                              </span>
                              {lead.message_count > 1 && (
                                <span className="bg-green-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[16px] text-center">
                                  {lead.message_count}
                                </span>
                              )}
                            </div>
                          </div>
                          
                          <p className="text-sm text-gray-600 truncate mb-2">
                            {getMessagePreview(lead.message)}
                          </p>
                          
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Panel - Chat */}
          <div className={`${isMobile ? 'w-full' : 'flex-1'} flex flex-col bg-white ${isMobile && !showChat ? 'hidden' : ''}`}>
            {selectedLead ? (
              <>
                {/* Mobile Chat Header */}
                {isMobile && (
                  <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setShowChat(false)}
                        className="btn btn-ghost btn-circle btn-sm"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                          {selectedLead.sender_name && selectedLead.sender_name !== selectedLead.phone_number && !selectedLead.sender_name.match(/^\d+$/) ? (
                            <span className="text-green-600 font-semibold text-sm">
                              {selectedLead.sender_name.charAt(0).toUpperCase()}
                            </span>
                          ) : (
                            <PhoneIcon className="w-4 h-4 text-green-600" />
                          )}
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900 text-sm">
                            {selectedLead.sender_name && selectedLead.sender_name !== selectedLead.phone_number && !selectedLead.sender_name.match(/^\d+$/) 
                              ? selectedLead.sender_name 
                              : selectedLead.phone_number || 'Unknown Number'}
                          </h3>
                          <p className="text-xs text-gray-500">
                            {selectedLead.sender_name && selectedLead.sender_name !== selectedLead.phone_number && !selectedLead.sender_name.match(/^\d+$/) 
                              ? selectedLead.phone_number 
                              : ''}
                          </p>
                          <p className="text-xs text-gray-500">
                            {selectedLead.message_count} messages
                          </p>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleConvertToLead(selectedLead)}
                      className="btn btn-primary btn-sm"
                    >
                      <UserPlusIcon className="w-4 h-4 mr-1" />
                      Convert to Lead
                    </button>
                  </div>
                )}

                {/* Desktop Header */}
                {!isMobile && (
                  <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                        {selectedLead.sender_name && selectedLead.sender_name !== selectedLead.phone_number && !selectedLead.sender_name.match(/^\d+$/) ? (
                          <span className="text-green-600 font-semibold text-lg">
                            {selectedLead.sender_name.charAt(0).toUpperCase()}
                          </span>
                        ) : (
                          <PhoneIcon className="w-5 h-5 text-green-600" />
                        )}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">
                          {selectedLead.sender_name && selectedLead.sender_name !== selectedLead.phone_number && !selectedLead.sender_name.match(/^\d+$/) 
                            ? selectedLead.sender_name 
                            : selectedLead.phone_number || 'Unknown Number'}
                        </h3>
                        {selectedLead.sender_name && selectedLead.sender_name !== selectedLead.phone_number && !selectedLead.sender_name.match(/^\d+$/) && (
                          <p className="text-sm text-gray-500">
                            {selectedLead.phone_number}
                          </p>
                        )}
                        <p className="text-sm text-gray-500">
                          {selectedLead.message_count} messages • Last message {formatTime(selectedLead.last_message_at)}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleConvertToLead(selectedLead)}
                      className="btn btn-primary"
                    >
                      <UserPlusIcon className="w-4 h-4 mr-2" />
                      Convert to Lead
                    </button>
                  </div>
                )}

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {messages.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <ChatBubbleLeftRightIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p className="text-lg font-medium">No messages yet</p>
                      <p className="text-sm">Messages from this number will appear here</p>
                    </div>
                  ) : (
                    messages.map((message, index) => (
                      <div
                        key={message.id || index}
                        className={`flex flex-col ${message.direction === 'out' ? 'items-end' : 'items-start'}`}
                      >
                        {message.direction === 'in' && (
                          <span className="text-xs text-gray-500 mb-1 ml-2">
                            {message.sender_name}
                          </span>
                        )}
                        {message.direction === 'out' && (
                          <span className="text-xs text-gray-500 mb-1 mr-2">
                            You
                          </span>
                        )}
                        <div
                          className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-2 shadow-sm ${
                            message.direction === 'out'
                              ? 'bg-green-600 text-white'
                              : 'bg-white text-gray-900 border border-gray-200'
                          }`}
                        >
                          <p className="break-words text-sm">{message.message}</p>
                          <div className="flex items-center gap-1 mt-1 text-xs opacity-70 justify-end">
                            <span>
                              {new Date(message.sent_at).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Message Input */}
                <div className="flex-shrink-0 p-4 border-t border-gray-200 bg-white">
                  <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      placeholder="Type a reply..."
                      className="flex-1 input input-bordered rounded-full"
                      disabled={sending}
                    />
                    <button
                      type="submit"
                      disabled={!newMessage.trim() || sending}
                      className="btn btn-primary btn-circle"
                    >
                      {sending ? (
                        <div className="loading loading-spinner loading-sm"></div>
                      ) : (
                        <PaperAirplaneIcon className="w-5 h-5" />
                      )}
                    </button>
                  </form>
                </div>
              </>
            ) : (
              /* No lead selected */
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-gray-500">
                  <ChatBubbleLeftRightIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                  <h2 className="text-xl font-medium mb-2">WhatsApp Leads</h2>
                  <p className="text-sm">Select a lead to view messages and start a conversation</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WhatsAppLeadsPage;
