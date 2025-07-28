import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import {
  MagnifyingGlassIcon,
  PaperAirplaneIcon,
  FaceSmileIcon,
  PaperClipIcon,
  XMarkIcon,
  PhoneIcon,
  EnvelopeIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';

interface Client {
  id: string;
  lead_number: string;
  name: string;
  email?: string;
  phone?: string;
  mobile?: string;
  topic?: string;
  status?: string;
  stage?: string;
  closer?: string;
  scheduler?: string;
  next_followup?: string;
  probability?: number;
  balance?: number;
  potential_applicants?: number;
}

interface WhatsAppMessage {
  id: number;
  lead_id: string;
  sender_id?: string;
  sender_name: string;
  direction: 'in' | 'out';
  message: string;
  sent_at: string;
  status: string;
}

const WhatsAppPage: React.FC = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [allMessages, setAllMessages] = useState<WhatsAppMessage[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [showChat, setShowChat] = useState(false);

  // Mobile detection
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Fetch current user info
  useEffect(() => {
    const fetchCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id) {
        const { data: userRow } = await supabase
          .from('users')
          .select('id, full_name, email')
          .eq('auth_id', user.id)
          .single();
        if (userRow) {
          setCurrentUser(userRow);
        }
      }
    };
    fetchCurrentUser();
  }, []);

  // Fetch all clients with WhatsApp messages
  useEffect(() => {
    const fetchAllClients = async () => {
      try {
        setLoading(true);
        
        // Fetch all leads instead of only those with WhatsApp messages
        const { data: leadsData, error: leadsError } = await supabase
          .from('leads')
          .select('id, lead_number, name, email, phone, mobile, topic, status, stage, closer, scheduler, next_followup, probability, balance, potential_applicants')
          .order('name');

        if (leadsError) {
          console.error('Error fetching leads:', leadsError);
          return;
        }

        setClients(leadsData || []);
      } catch (error) {
        console.error('Error fetching clients:', error);
        toast.error('Failed to load clients');
      } finally {
        setLoading(false);
      }
    };

    fetchAllClients();
  }, []);

  // Fetch messages for selected client
  useEffect(() => {
    const fetchMessages = async () => {
      if (!selectedClient) {
        setMessages([]);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('whatsapp_messages')
          .select('*')
          .eq('lead_id', selectedClient.id)
          .order('sent_at', { ascending: true });

        if (error) {
          console.error('Error fetching messages:', error);
          toast.error('Failed to load messages');
          return;
        }

        setMessages(data || []);
      } catch (error) {
        console.error('Error fetching messages:', error);
        toast.error('Failed to load messages');
      }
    };

    fetchMessages();
  }, [selectedClient]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Filter clients based on search term
  const filteredClients = clients.filter(client =>
    client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    client.lead_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (client.email && client.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (client.phone && client.phone.includes(searchTerm)) ||
    (client.mobile && client.mobile.includes(searchTerm))
  );

  // Send new message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedClient || !currentUser) return;

    setSending(true);
    try {
      const now = new Date();
      const { error: insertError } = await supabase
        .from('whatsapp_messages')
        .insert([
          {
            lead_id: selectedClient.id,
            sender_id: currentUser.id,
            sender_name: currentUser.full_name || currentUser.email || 'You',
            direction: 'out',
            message: newMessage.trim(),
            sent_at: now.toISOString(),
            status: 'sent',
          }
        ]);

      if (insertError) {
        toast.error('Failed to send message: ' + insertError.message);
        return;
      }

      // Add message to local state
      const newMsg: WhatsAppMessage = {
        id: Date.now(), // Temporary ID
        lead_id: selectedClient.id,
        sender_id: currentUser.id,
        sender_name: currentUser.full_name || currentUser.email || 'You',
        direction: 'out',
        message: newMessage.trim(),
        sent_at: now.toISOString(),
        status: 'sent',
      };

      setMessages(prev => [...prev, newMsg]);
      setNewMessage('');
      toast.success('Message sent!');
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  // Get last message for client preview
  const getLastMessage = (clientId: string) => {
    const clientMessages = messages.filter(msg => msg.lead_id === clientId);
    return clientMessages[clientMessages.length - 1];
  };

  // Get all messages for all clients to show last message preview
  const getAllMessages = async () => {
    try {
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .order('sent_at', { ascending: false });

      if (error) {
        console.error('Error fetching all messages:', error);
        return;
      }

      return data || [];
    } catch (error) {
      console.error('Error fetching all messages:', error);
    }
  };

  // Fetch all messages on component mount
  useEffect(() => {
    const fetchAllMessages = async () => {
      const messages = await getAllMessages();
      if (messages) {
        setAllMessages(messages);
      }
    };
    fetchAllMessages();
  }, []);

  // Get last message for client preview from all messages
  const getLastMessageForClient = (clientId: string) => {
    return allMessages.find(msg => msg.lead_id === clientId);
  };

  // Get unread count for client from all messages
  const getUnreadCountForClient = (clientId: string) => {
    const clientMessages = allMessages.filter(msg => msg.lead_id === clientId);
    return clientMessages.filter(msg => msg.direction === 'in' && msg.status !== 'read').length;
  };

  // Format last message time
  const formatLastMessageTime = (timestamp: string) => {
    const messageDate = new Date(timestamp);
    const now = new Date();
    const diffTime = now.getTime() - messageDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      // Today - show time
      return messageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays <= 7) {
      // Within a week - show weekday
      return messageDate.toLocaleDateString([], { weekday: 'short' });
    } else {
      // More than a week - show date
      return messageDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  return (
    <div className={`fixed inset-0 flex bg-gray-100 ${isMobile ? '' : ''}`} style={isMobile ? {} : { top: '64px', left: '96px', right: '0px', bottom: '0px' }}>
      {/* Left Panel - Client List */}
      <div className={`${isMobile ? 'w-full' : 'w-1/3'} bg-white border-r border-gray-200 flex flex-col ${isMobile && showChat ? 'hidden' : ''}`}>
        {/* Header - Fixed */}
        <div className="flex-shrink-0 p-4 border-b border-gray-200 bg-white text-gray-900">
          <div className="flex items-center gap-3">
            <FaWhatsapp className="w-8 h-8 text-green-600" />
            <div>
              <h1 className="text-xl font-bold text-gray-900">WhatsApp</h1>
              <p className="text-sm text-gray-600">All client conversations</p>
            </div>
          </div>
        </div>

        {/* Search Bar - Fixed */}
        <div className="flex-shrink-0 p-4 border-b border-gray-200">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search clients..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Client List - Scrollable */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="loading loading-spinner loading-lg text-green-600"></div>
            </div>
          ) : filteredClients.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <FaWhatsapp className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p className="text-lg font-medium">No clients found</p>
              <p className="text-sm">No clients match your search criteria</p>
            </div>
          ) : (
            filteredClients.map((client) => {
              const lastMessage = getLastMessageForClient(client.id);
              const unreadCount = getUnreadCountForClient(client.id);
              const isSelected = selectedClient?.id === client.id;

              return (
                <div
                  key={client.id}
                  onClick={() => {
                    setSelectedClient(client);
                    if (isMobile) {
                      setShowChat(true);
                    }
                  }}
                  className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${
                    isSelected ? 'bg-green-50 border-l-4 border-l-green-500' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                      <span className="text-green-600 font-semibold text-lg">
                        {client.name.charAt(0).toUpperCase()}
                      </span>
                    </div>

                    {/* Client Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-gray-900 truncate">
                          {client.name}
                        </h3>
                        <div className="flex items-center gap-2">
                          {lastMessage && (
                            <span className="text-xs text-gray-500">
                              {formatLastMessageTime(lastMessage.sent_at)}
                            </span>
                          )}
                          {unreadCount > 0 && (
                            <span className="bg-green-500 text-white text-xs rounded-full px-2 py-1 min-w-[20px] text-center">
                              {unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-gray-500 truncate">
                        {client.lead_number}
                      </p>
                      {lastMessage && (
                        <p className="text-sm text-gray-600 truncate mt-1">
                          {lastMessage.direction === 'out' ? 'You: ' : ''}
                          {lastMessage.message}
                        </p>
                      )}
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
        {selectedClient ? (
          <>
            {/* Chat Header - Fixed */}
            <div className="flex-shrink-0 p-4 border-b border-gray-200 bg-white">
              <div className="flex items-center gap-3">
                {isMobile && (
                  <button
                    onClick={() => setShowChat(false)}
                    className="p-2 rounded-lg hover:bg-gray-100"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                <div className="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center">
                  <span className="text-white font-semibold">
                    {selectedClient.name.split(' ').map((n: string) => n[0]).join('').toUpperCase()}
                  </span>
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">{selectedClient.name}</h3>
                  {(selectedClient.closer || selectedClient.scheduler || selectedClient.next_followup || selectedClient.probability || selectedClient.balance || selectedClient.total_applicants) && (
                    <div className="mt-1 pt-1 border-t border-gray-200">
                      <div className="flex items-center gap-3 text-sm text-purple-600">
                        <span className="text-gray-500">{selectedClient.lead_number}</span>
                        {selectedClient.closer && (
                          <span><span className="text-black">•</span> Closer: {selectedClient.closer}</span>
                        )}
                        {selectedClient.scheduler && (
                          <span><span className="text-black">•</span> Scheduler: {selectedClient.scheduler}</span>
                        )}
                        {selectedClient.next_followup && (
                          <span><span className="text-black">•</span> Follow-up: {new Date(selectedClient.next_followup).toLocaleDateString()}</span>
                        )}
                        {selectedClient.probability && (
                          <span><span className="text-black">•</span> Probability: {selectedClient.probability}%</span>
                        )}
                        {selectedClient.balance && (
                          <span><span className="text-black">•</span> Balance: ${selectedClient.balance.toLocaleString()}</span>
                        )}
                        {selectedClient.total_applicants && (
                          <span><span className="text-black">•</span> Applicants: {selectedClient.total_applicants}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Messages - Scrollable */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <FaWhatsapp className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p className="text-lg font-medium">No messages yet</p>
                  <p className="text-sm">Start the conversation with {selectedClient.name}</p>
                </div>
              ) : (
                messages.map((message, index) => (
                  <div
                    key={message.id || index}
                    className={`flex ${message.direction === 'out' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[70%] rounded-2xl px-4 py-2 shadow-sm ${
                        message.direction === 'out'
                          ? 'bg-green-500 text-white'
                          : 'bg-white text-gray-900 border border-gray-200'
                      }`}
                    >
                      <p className="text-sm break-words">{message.message}</p>
                      <div className="flex items-center gap-1 mt-1 text-xs opacity-70 justify-end">
                        <span>
                          {new Date(message.sent_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                        {message.direction === 'out' && (
                          <span className="inline-block align-middle">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={2}
                              stroke="currentColor"
                              className="w-4 h-4"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M4.5 12.75l6 6 9-13.5"
                              />
                            </svg>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input - Fixed */}
            <div className="flex-shrink-0 p-4 bg-white border-t border-gray-200">
              <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                <button type="button" className="btn btn-ghost btn-circle">
                  <FaceSmileIcon className="w-6 h-6 text-gray-500" />
                </button>
                <button type="button" className="btn btn-ghost btn-circle">
                  <PaperClipIcon className="w-6 h-6 text-gray-500" />
                </button>
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type a message..."
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
          /* No client selected */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-gray-500">
              <FaWhatsapp className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <h2 className="text-xl font-medium mb-2">Welcome to WhatsApp</h2>
              <p className="text-sm">Select a client to start chatting</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WhatsAppPage; 