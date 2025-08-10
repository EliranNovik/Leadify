import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { buildApiUrl } from '../lib/api';
import {
  MagnifyingGlassIcon,
  PaperAirplaneIcon,
  FaceSmileIcon,
  PaperClipIcon,
  XMarkIcon,
  PhoneIcon,
  EnvelopeIcon,
  UserIcon,
  DocumentTextIcon,
  DocumentIcon,
  PhotoIcon,
  FilmIcon,
  MusicalNoteIcon,
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
  message_type: 'text' | 'image' | 'document' | 'audio' | 'video' | 'location' | 'contact';
  media_url?: string;
  media_id?: string;
  media_filename?: string;
  media_mime_type?: string;
  media_size?: number;
  caption?: string;
  whatsapp_message_id?: string;
  whatsapp_status?: 'sent' | 'delivered' | 'read' | 'failed';
  whatsapp_timestamp?: string;
  error_message?: string;
}

const WhatsAppPage: React.FC = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [allMessages, setAllMessages] = useState<WhatsAppMessage[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<{url: string, type: 'image' | 'video', caption?: string} | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Contacts panel (mobile) UI state
  const contactListRef = useRef<HTMLDivElement>(null);
  const [isSearchHiddenMobile, setIsSearchHiddenMobile] = useState(false);
  const lastScrollTopRef = useRef(0);
  const [isContactsHeaderGlass, setIsContactsHeaderGlass] = useState(false);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const [isChatHeaderGlass, setIsChatHeaderGlass] = useState(false);
  const [isChatFooterGlass, setIsChatFooterGlass] = useState(false);

  // Helper function to get document icon based on MIME type
  const getDocumentIcon = (mimeType?: string) => {
    if (!mimeType) return DocumentTextIcon;
    
    if (mimeType.includes('pdf')) return DocumentTextIcon;
    if (mimeType.includes('word') || mimeType.includes('document')) return DocumentIcon;
    if (mimeType.includes('image/')) return PhotoIcon;
    if (mimeType.includes('video/')) return FilmIcon;
    if (mimeType.includes('audio/')) return MusicalNoteIcon;
    
    return DocumentTextIcon;
  };

  // Helper function to render WhatsApp-style message status
  const renderMessageStatus = (status?: string) => {
    if (!status) return null;
    
    const baseClasses = "w-7 h-7";
    
    switch (status) {
      case 'sent':
        return (
          <svg className={baseClasses} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'delivered':
        return (
          <svg className={`${baseClasses} text-gray-500`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l4 4L11 8" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l4 4L17 8" />
          </svg>
        );
      case 'read':
        return (
          <svg className={`${baseClasses} text-black`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l4 4L11 8" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l4 4L17 8" />
          </svg>
        );
      default:
        return null;
    }
  };

  // Mobile detection
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Handle scroll to hide on scroll down, reveal on scroll up (mobile only)
  const handleContactListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (!isMobile) return;
    const currentTop = e.currentTarget.scrollTop;
    const diff = currentTop - lastScrollTopRef.current;

    // Always show at very top
    if (currentTop <= 0) {
      setIsSearchHiddenMobile(false);
      setIsContactsHeaderGlass(false);
      lastScrollTopRef.current = currentTop;
      return;
    }

    // Small threshold to avoid jitter
    if (Math.abs(diff) > 4) {
      if (diff > 0) {
        // Scrolling down -> hide
        setIsSearchHiddenMobile(true);
      } else {
        // Scrolling up -> show
        setIsSearchHiddenMobile(false);
      }
      setIsContactsHeaderGlass(currentTop > 0);
      lastScrollTopRef.current = currentTop;
    }
  };

  // Chat messages scroll: toggle glass headers/footers on mobile
  const handleChatMessagesScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (!isMobile) return;
    const top = e.currentTarget.scrollTop;
    setIsChatHeaderGlass(top > 0);
    setIsChatFooterGlass(top > 0);
  };

  // Keyboard support for modal
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selectedMedia) {
        setSelectedMedia(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedMedia]);

  // Fetch current user info
  useEffect(() => {
    const fetchCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        console.log('🔍 Looking for user with email:', user.email);
        
        // Try to find user in users table by email
        const { data: userRow, error } = await supabase
          .from('users')
          .select('id, full_name, email')
          .eq('email', user.email)
          .single();
        
        if (userRow) {
          console.log('✅ Found user in database:', userRow);
          setCurrentUser(userRow);
        } else {
          console.log('❌ User not found in database, using auth metadata');
          // Fallback: create a user object with available data
          const fallbackUser = {
            id: user.id,
            full_name: user.user_metadata?.full_name || user.user_metadata?.name || user.email,
            email: user.email
          };
          console.log('📝 Using fallback user:', fallbackUser);
          setCurrentUser(fallbackUser);
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
    const fetchMessages = async (isPolling = false) => {
      if (!selectedClient) {
        setMessages([]);
        return;
      }

      try {
        console.log('🔄 Fetching messages for client:', selectedClient.id, isPolling ? '(polling)' : '(initial)');
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

        console.log('📨 Messages fetched:', data?.length || 0, 'messages');
        console.log('📋 Messages data:', data);
        setMessages(data || []);
        
        // Only trigger auto-scroll on initial load, not during polling
        if (!isPolling && isFirstLoad && shouldAutoScroll) {
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            setShouldAutoScroll(false);
            setIsFirstLoad(false);
          }, 200);
        }
      } catch (error) {
        console.error('Error fetching messages:', error);
        toast.error('Failed to load messages');
      }
    };

    fetchMessages(false); // Initial load
    
    // Set up polling to refresh messages every 5 seconds
    const interval = setInterval(() => fetchMessages(true), 5000);
    
    return () => clearInterval(interval);
  }, [selectedClient]);

  // Auto-scroll to bottom only when chat is first selected or new message is sent
  const [shouldAutoScroll, setShouldAutoScroll] = useState(false);
  const [isFirstLoad, setIsFirstLoad] = useState(false);
  
  useEffect(() => {
    if (shouldAutoScroll && messages.length > 0) {
      // Add a small delay to ensure messages are rendered
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        setShouldAutoScroll(false);
      }, 100);
    }
  }, [messages, shouldAutoScroll]);

  // Filter clients based on search term
  const filteredClients = clients.filter(client =>
    client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    client.lead_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (client.email && client.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (client.phone && client.phone.includes(searchTerm)) ||
    (client.mobile && client.mobile.includes(searchTerm))
  );

  // Send new message via WhatsApp API
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedClient || !currentUser) return;

    setSending(true);
    try {
      // Get phone number from client
      const phoneNumber = selectedClient.phone || selectedClient.mobile;
      if (!phoneNumber) {
        toast.error('No phone number found for this client');
        return;
      }

      const senderName = currentUser.full_name || currentUser.email;

      // Send message via WhatsApp API
      const response = await fetch(buildApiUrl('/api/whatsapp/send-message'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          leadId: selectedClient.id,
          message: newMessage.trim(),
          phoneNumber: phoneNumber,
          sender_name: senderName
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send message');
      }

      // Add message to local state
      console.log('📤 Sending message with sender:', senderName, 'from user:', currentUser);
      
      const newMsg: WhatsAppMessage = {
        id: Date.now(), // Temporary ID
        lead_id: selectedClient.id,
        sender_id: currentUser.id,
        sender_name: senderName,
        direction: 'out',
        message: newMessage.trim(),
        sent_at: new Date().toISOString(),
        status: 'sent',
        message_type: 'text',
        whatsapp_status: 'sent',
        whatsapp_message_id: result.messageId
      };

      setMessages(prev => [...prev, newMsg]);
      setShouldAutoScroll(true); // Trigger auto-scroll when new message is sent
      setNewMessage('');
      toast.success('Message sent via WhatsApp!');
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Failed to send message: ' + (error as Error).message);
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

  // Handle file selection
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  // Send media message
  const handleSendMedia = async () => {
    if (!selectedFile || !selectedClient || !currentUser) return;

    setUploadingMedia(true);
    try {
      const phoneNumber = selectedClient.phone || selectedClient.mobile;
      if (!phoneNumber) {
        toast.error('No phone number found for this client');
        return;
      }

      // Create FormData for file upload
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('leadId', selectedClient.id);

      // Upload media to WhatsApp
      const uploadResponse = await fetch(buildApiUrl('/api/whatsapp/upload-media'), {
        method: 'POST',
        body: formData,
      });

      const uploadResult = await uploadResponse.json();

      if (!uploadResponse.ok) {
        throw new Error(uploadResult.error || 'Failed to upload media');
      }

      // Send media message
      const mediaType = selectedFile.type.startsWith('image/') ? 'image' : 'document';
      const senderName = currentUser.full_name || currentUser.email;
      const response = await fetch(buildApiUrl('/api/whatsapp/send-media'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          leadId: selectedClient.id,
          mediaUrl: uploadResult.mediaId,
          mediaType: mediaType,
          caption: newMessage.trim() || undefined,
          phoneNumber: phoneNumber,
          sender_name: senderName
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send media');
      }

      // Add message to local state
      console.log('📤 Sending media with sender:', senderName, 'from user:', currentUser);
      
      const newMsg: WhatsAppMessage = {
        id: Date.now(),
        lead_id: selectedClient.id,
        sender_id: currentUser.id,
        sender_name: senderName,
        direction: 'out',
        message: newMessage.trim() || `${mediaType} message`,
        sent_at: new Date().toISOString(),
        status: 'sent',
        message_type: mediaType as any,
        whatsapp_status: 'sent',
        whatsapp_message_id: result.messageId,
        media_url: uploadResult.mediaId,
        caption: newMessage.trim() || undefined
      };

      setMessages(prev => [...prev, newMsg]);
      setShouldAutoScroll(true); // Trigger auto-scroll when media message is sent
      setNewMessage('');
      setSelectedFile(null);
      toast.success('Media sent via WhatsApp!');
    } catch (error) {
      console.error('Error sending media:', error);
      toast.error('Failed to send media: ' + (error as Error).message);
    } finally {
      setUploadingMedia(false);
    }
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
    <div className="fixed inset-0 bg-white z-[9999]">
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className={`flex items-center justify-between p-4 md:p-6 border-b border-gray-200 ${isMobile && isContactsHeaderGlass ? 'bg-white/70 backdrop-blur-md supports-[backdrop-filter]:bg-white/50' : 'bg-white'}`}>
          <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
            <FaWhatsapp className="w-6 h-6 md:w-8 md:h-8 text-green-600 flex-shrink-0" />
            <h2 className="text-lg md:text-2xl font-bold text-gray-900 flex-shrink-0">WhatsApp</h2>
            {selectedClient && (
              <div className="hidden md:flex items-center gap-4 min-w-0 flex-1 overflow-hidden">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse flex-shrink-0"></div>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-lg font-semibold text-gray-900 truncate">
                      {selectedClient.name}
                    </span>
                    <span className="text-sm text-gray-500 font-mono flex-shrink-0">
                      ({selectedClient.lead_number})
                    </span>
                  </div>
                </div>
                
                {(selectedClient.closer || selectedClient.scheduler || selectedClient.next_followup || selectedClient.probability || selectedClient.balance || selectedClient.potential_applicants) && (
                  <div className="hidden md:flex items-center gap-4 lg:gap-6">
                    <div className="w-px h-6 bg-gray-300"></div>
                    
                    {selectedClient.closer && (
                      <div className="flex flex-col items-center">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Closer</span>
                        <span className="text-sm font-semibold text-gray-700">{selectedClient.closer}</span>
                      </div>
                    )}
                    
                    {selectedClient.scheduler && (
                      <div className="flex flex-col items-center">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Scheduler</span>
                        <span className="text-sm font-semibold text-gray-700">{selectedClient.scheduler}</span>
                      </div>
                    )}
                    
                    {selectedClient.next_followup && (
                      <div className="flex flex-col items-center">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Follow-up</span>
                        <span className="text-sm font-semibold text-gray-700">{new Date(selectedClient.next_followup).toLocaleDateString()}</span>
                      </div>
                    )}
                    
                    {selectedClient.probability && (
                      <div className="flex flex-col items-center">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Probability</span>
                        <span className="text-sm font-semibold text-gray-900">{selectedClient.probability}%</span>
                      </div>
                    )}
                    
                    {selectedClient.balance && (
                      <div className="flex flex-col items-center">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Balance</span>
                        <span className="text-sm font-semibold text-gray-900">${selectedClient.balance.toLocaleString()}</span>
                      </div>
                    )}
                    
                    {selectedClient.potential_applicants && (
                      <div className="flex flex-col items-center">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Applicants</span>
                        <span className="text-sm font-semibold text-purple-600">{selectedClient.potential_applicants}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => window.history.back()}
            className="btn btn-ghost btn-circle flex-shrink-0"
          >
            <XMarkIcon className="w-5 h-5 md:w-6 md:h-6" />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel - Client List */}
          <div className={`${isMobile ? 'w-full' : 'w-80'} border-r border-gray-200 flex flex-col ${isMobile && showChat ? 'hidden' : ''}`}>
            {/* Search Bar (sticky on mobile, hides on scroll down) */}
            <div className={`${isMobile
                ? 'sticky top-0 z-10 bg-white transition-all duration-300 ' +
                  (isSearchHiddenMobile
                    ? 'h-0 p-0 -translate-y-full overflow-hidden border-b-0'
                    : 'p-3 translate-y-0 border-b border-gray-200')
                : 'p-3 border-b border-gray-200'
              }`}>
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

            {/* Client List */}
            <div ref={contactListRef} onScroll={handleContactListScroll} className="flex-1 overflow-y-auto">
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
                        setShouldAutoScroll(true); // Trigger auto-scroll when chat is selected
                        setIsFirstLoad(true); // Mark as first load
                        if (isMobile) {
                          setShowChat(true);
                        }
                      }}
                      className={`p-3 md:p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${
                        isSelected ? 'bg-green-50 border-l-4 border-l-green-500' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 md:gap-3">
                        {/* Avatar */}
                        <div className="w-10 h-10 md:w-12 md:h-12 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-green-600 font-semibold text-sm md:text-lg">
                            {client.name.charAt(0).toUpperCase()}
                          </span>
                        </div>

                        {/* Client Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-gray-900 truncate text-base md:text-base">
                              {client.name}
                            </h3>
                            <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
                              {lastMessage && (
                                <span className="text-xs text-gray-500">
                                  {formatLastMessageTime(lastMessage.sent_at)}
                                </span>
                              )}
                              {unreadCount > 0 && (
                                <span className="bg-green-500 text-white text-xs rounded-full px-1 md:px-2 py-1 min-w-[16px] md:min-w-[20px] text-center">
                                  {unreadCount}
                                </span>
                              )}
                            </div>
                          </div>
                          <p className="text-sm md:text-sm text-gray-500 truncate">
                            {client.lead_number}
                          </p>
                          {lastMessage && (
                            <p className="text-sm md:text-sm text-gray-600 truncate mt-1">
                              {lastMessage.direction === 'out' ? `${lastMessage.sender_name}: ` : ''}
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
                {/* Mobile Chat Header - Only visible on mobile when in chat */}
                {isMobile && (
                  <div className={`flex items-center justify-between p-4 border-b border-gray-200 ${isChatHeaderGlass ? 'bg-white/70 backdrop-blur-md supports-[backdrop-filter]:bg-white/50' : 'bg-white'}`}>
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
                          <span className="text-green-600 font-semibold text-sm">
                            {selectedClient.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900 text-sm">
                            {selectedClient.name}
                          </h3>
                          <p className="text-xs text-gray-500">
                            {selectedClient.lead_number}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

            {/* Messages - Scrollable */}
            <div ref={chatMessagesRef} onScroll={handleChatMessagesScroll} className="flex-1 overflow-y-auto p-4 space-y-4">
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
                    className={`flex flex-col ${message.direction === 'out' ? 'items-end' : 'items-start'}`}
                  >
                    {message.direction === 'out' && (
                      <span className="text-xs text-gray-500 mb-1 mr-2">
                        {message.sender_name}
                      </span>
                    )}
                    {message.direction === 'in' && (
                      <span className="text-xs text-gray-500 mb-1 ml-2">
                        {message.sender_name}
                      </span>
                    )}
                    <div
                      className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-2 shadow-sm ${
                        message.direction === 'out'
                          ? 'bg-green-600 text-white'
                          : 'bg-white text-gray-900 border border-gray-200'
                      }`}
                    >
                      {/* Message content based on type */}
                      {message.message_type === 'text' && (
                        <p className="text-sm break-words">{message.message}</p>
                      )}
                      
                      {message.message_type === 'image' && (
                        <div>
                          {message.media_url && (
                            <div className="relative inline-block">
                              <img 
                                src={message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`)}
                                alt="Image"
                                className="max-w-full md:max-w-[700px] max-h-[300px] md:max-h-[600px] object-cover rounded-lg mb-2 shadow-sm cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => message.media_url && setSelectedMedia({
                                  url: message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`),
                                  type: 'image',
                                  caption: message.caption
                                })}
                                onError={(e) => {
                                  console.log('Failed to load image:', message.media_url);
                                  // Replace with error placeholder
                                  e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik01MCAxMDAgTDEwMCA1MCBMMTUwIDEwMCBMMTAwIDE1MCBMNTAgMTAwWiIgZmlsbD0iI0QxRDVEMCIvPgo8dGV4dCB4PSIxMDAiIHk9IjExMCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE0IiBmaWxsPSIjNjc3NDhCIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5JbWFnZSBVbmF2YWlsYWJsZTwvdGV4dD4KPC9zdmc+';
                                  e.currentTarget.style.border = '1px solid #e5e7eb';
                                  e.currentTarget.style.borderRadius = '0.5rem';
                                }}
                              />
                              <button
                                onClick={() => {
                                  if (!message.media_url) return;
                                  const url = message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`);
                                  const link = document.createElement('a');
                                  link.href = url;
                                  link.download = `image_${Date.now()}.jpg`;
                                  link.click();
                                }}
                                className="absolute top-2 right-2 btn btn-ghost btn-xs bg-black bg-opacity-50 text-white hover:bg-opacity-70"
                                title="Download"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                              </button>
                            </div>
                          )}
                          {message.caption && (
                            <p className="text-sm break-words">{message.caption}</p>
                          )}
                        </div>
                      )}
                      
                      {message.message_type === 'document' && (
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            {React.createElement(getDocumentIcon(message.media_mime_type), { className: "w-6 h-6" })}
                            <div className="flex-1">
                                                              <a 
                                  href={message.media_url?.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block hover:opacity-80 transition-opacity"
                              >
                                <p className="text-sm font-medium underline cursor-pointer">
                                  {message.media_filename || 'Document'}
                                </p>
                                {message.media_size && (
                                  <p className="text-xs opacity-70">
                                    {(message.media_size / 1024).toFixed(1)} KB
                                  </p>
                                )}
                              </a>
                            </div>
                            <button
                              onClick={() => {
                                if (!message.media_url) return;
                                                                  const url = message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`);
                                const link = document.createElement('a');
                                link.href = url;
                                link.download = message.media_filename || 'document';
                                link.click();
                              }}
                              className="btn btn-ghost btn-xs"
                              title="Download"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </button>
                          </div>
                          
                          {/* Document Preview */}
                          {message.media_url && (
                            <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                              <div className="p-3 bg-white border-b border-gray-200">
                                <div className="flex items-center gap-2">
                                  <DocumentTextIcon className="w-4 h-4 text-gray-500" />
                                  <span className="text-xs text-gray-600 font-medium">
                                    {message.media_filename || 'Document Preview'}
                                  </span>
                                </div>
                              </div>
                              <div className="p-4 min-h-[120px] flex items-center justify-center">
                                {message.media_mime_type === 'application/pdf' ? (
                                  <iframe
                                    src={`${message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`)}#toolbar=0&navpanes=0&scrollbar=0`}
                                    className="w-full h-32 border-0"
                                    title="PDF Preview"
                                    onError={(e) => {
                                      console.log('Failed to load PDF preview:', message.media_url);
                                      // Show error message instead of hiding
                                      const iframe = e.currentTarget;
                                      iframe.style.display = 'none';
                                      const errorDiv = document.createElement('div');
                                      errorDiv.className = 'text-center text-gray-500 p-4';
                                      errorDiv.innerHTML = `
                                        <DocumentTextIcon class="w-12 h-12 mx-auto mb-2 text-gray-400" />
                                        <p class="text-xs">PDF Preview Unavailable</p>
                                        <p class="text-xs opacity-70">Media may have expired</p>
                                      `;
                                      iframe.parentNode?.appendChild(errorDiv);
                                    }}
                                  />
                                ) : message.media_mime_type?.includes('image/') ? (
                                  <img
                                    src={message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`)}
                                    alt="Document Preview"
                                    className="max-w-full max-h-24 object-contain rounded"
                                    onError={(e) => {
                                      console.log('Failed to load image preview:', message.media_url);
                                      // Show error message instead of hiding
                                      e.currentTarget.style.display = 'none';
                                      const errorDiv = document.createElement('div');
                                      errorDiv.className = 'text-center text-gray-500 p-4';
                                      errorDiv.innerHTML = `
                                        <DocumentTextIcon class="w-12 h-12 mx-auto mb-2 text-gray-400" />
                                        <p class="text-xs">Preview Unavailable</p>
                                        <p class="text-xs opacity-70">Media may have expired</p>
                                      `;
                                      e.currentTarget.parentNode?.appendChild(errorDiv);
                                    }}
                                  />
                                ) : (
                                  <div className="text-center text-gray-500">
                                    <DocumentTextIcon className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                                    <p className="text-xs">Preview not available</p>
                                    <p className="text-xs opacity-70">{message.media_mime_type}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                          
                          {message.caption && (
                            <p className="text-sm break-words mt-2">{message.caption}</p>
                          )}
                        </div>
                      )}
                      
                      {message.message_type === 'audio' && (
                        <div>
                          <div className="flex items-center gap-2">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="text-sm">Audio message</span>
                          </div>
                          {message.caption && (
                            <p className="text-sm break-words mt-2">{message.caption}</p>
                          )}
                        </div>
                      )}
                      
                      {message.message_type === 'video' && (
                        <div>
                          {message.media_url && (
                            <video 
                              controls
                              className="max-w-full md:max-w-[700px] max-h-[300px] md:max-h-[600px] object-cover rounded-lg mb-2 shadow-sm cursor-pointer hover:opacity-90 transition-opacity"
                              onClick={() => message.media_url && setSelectedMedia({
                                url: message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`),
                                type: 'video',
                                caption: message.caption
                              })}
                              onError={(e) => {
                                console.log('Failed to load video:', message.media_url);
                                // Show error message instead of hiding
                                e.currentTarget.style.display = 'none';
                                const errorDiv = document.createElement('div');
                                errorDiv.className = 'text-center text-gray-500 p-4 border border-gray-200 rounded-lg bg-gray-50';
                                errorDiv.innerHTML = `
                                  <FilmIcon class="w-12 h-12 mx-auto mb-2 text-gray-400" />
                                  <p class="text-xs font-medium">Video Unavailable</p>
                                  <p class="text-xs opacity-70">Media may have expired</p>
                                `;
                                e.currentTarget.parentNode?.appendChild(errorDiv);
                              }}
                            >
                              <source src={message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`)} />
                              Your browser does not support the video tag.
                            </video>
                          )}
                          {message.caption && (
                            <p className="text-sm break-words">{message.caption}</p>
                          )}
                        </div>
                      )}
                      
                      {message.message_type === 'location' && (
                        <div>
                          <div className="flex items-center gap-2">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <span className="text-sm">Location shared</span>
                          </div>
                          <p className="text-sm break-words mt-1">{message.message}</p>
                        </div>
                      )}
                      
                      {message.message_type === 'contact' && (
                        <div>
                          <div className="flex items-center gap-2">
                            <UserIcon className="w-6 h-6" />
                            <span className="text-sm">Contact shared</span>
                          </div>
                        </div>
                      )}

                      {/* Message status and time */}
                      <div className="flex items-center gap-1 mt-1 text-xs opacity-70 justify-end">
                        <span>
                          {new Date(message.sent_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                        {message.direction === 'out' && (
                          <span className="inline-block align-middle text-current">
                            {renderMessageStatus(message.whatsapp_status)}
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
            <div className={`flex-shrink-0 p-4 border-t border-gray-200 ${isMobile && isChatFooterGlass ? 'bg-white/70 backdrop-blur-md supports-[backdrop-filter]:bg-white/50' : 'bg-white'}`}>
              <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                <button type="button" className="btn btn-ghost btn-circle">
                  <FaceSmileIcon className="w-6 h-6 text-gray-500" />
                </button>
                
                {/* File upload button */}
                <label className="btn btn-ghost btn-circle cursor-pointer">
                  <PaperClipIcon className="w-6 h-6 text-gray-500" />
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,audio/*,video/*"
                    onChange={handleFileSelect}
                    disabled={uploadingMedia}
                  />
                </label>

                {/* Selected file preview */}
                {selectedFile && (
                  <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-1">
                    <span className="text-xs text-gray-600">{selectedFile.name}</span>
                    <button
                      type="button"
                      onClick={() => setSelectedFile(null)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <XMarkIcon className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder={selectedFile ? "Add a caption..." : "Type a message..."}
                  className="flex-1 input input-bordered rounded-full"
                  disabled={sending || uploadingMedia}
                />
                
                {selectedFile ? (
                  <button
                    type="button"
                    onClick={handleSendMedia}
                    disabled={uploadingMedia}
                    className="btn btn-primary btn-circle"
                  >
                    {uploadingMedia ? (
                      <div className="loading loading-spinner loading-sm"></div>
                    ) : (
                      <PaperAirplaneIcon className="w-5 h-5" />
                    )}
                  </button>
                ) : (
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
                )}
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
      </div>

      {/* Media Modal */}
      {selectedMedia && (
        <div className="fixed inset-0 z-[9999] bg-black bg-opacity-90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative w-full h-full flex items-center justify-center" onClick={() => setSelectedMedia(null)}>
            {/* Close button */}
            <button
              onClick={() => setSelectedMedia(null)}
              className="absolute top-4 right-4 z-10 btn btn-circle btn-ghost bg-black bg-opacity-50 text-white hover:bg-opacity-70 transition-all duration-200"
            >
              <XMarkIcon className="w-6 h-6" />
            </button>

            {/* Download button */}
            <button
              onClick={() => {
                if (!selectedMedia) return;
                const link = document.createElement('a');
                link.href = selectedMedia.url;
                link.download = `media_${Date.now()}.${selectedMedia.type === 'image' ? 'jpg' : 'mp4'}`;
                link.click();
              }}
              className="absolute top-4 left-4 z-10 btn btn-circle btn-ghost bg-black bg-opacity-50 text-white hover:bg-opacity-70 transition-all duration-200"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </button>

            {/* Delete button */}
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="absolute top-4 left-20 z-10 btn btn-circle btn-ghost bg-black bg-opacity-50 text-white hover:bg-opacity-70 transition-all duration-200"
              title="Delete"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>

            {showDeleteConfirm && (
              <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-60">
                <div className="bg-white rounded-lg shadow-xl p-8 max-w-xs w-full text-center">
                  <h2 className="text-lg font-semibold mb-4">Delete this media?</h2>
                  <p className="mb-6 text-gray-600">Are you sure you want to delete this media? This action cannot be undone.</p>
                  <div className="flex justify-center gap-4">
                    <button
                      className="btn btn-error"
                      onClick={async () => {
                        // Implement delete logic here (API call, then update state)
                        setShowDeleteConfirm(false);
                        setSelectedMedia(null);
                        toast.success('Media deleted (mock)');
                      }}
                    >
                      Delete
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => setShowDeleteConfirm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Media content */}
            <div className="relative w-full h-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
              {selectedMedia.type === 'image' ? (
                <img
                  src={selectedMedia.url}
                  alt="Full size image"
                  className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                  onError={(e) => {
                    console.log('Failed to load image in modal:', selectedMedia.url);
                    e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik01MCAxMDAgTDEwMCA1MCBMMTUwIDEwMCBMMTAwIDE1MCBMNTAgMTAwWiIgZmlsbD0iI0QxRDVEMCIvPgo8dGV4dCB4PSIxMDAiIHk9IjExMCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE0IiBmaWxsPSIjNjc3NDhCIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5JbWFnZSBVbmF2YWlsYWJsZTwvdGV4dD4KPC9zdmc+';
                  }}
                />
              ) : (
                <video
                  controls
                  className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                  onError={(e) => {
                    console.log('Failed to load video in modal:', selectedMedia.url);
                    e.currentTarget.style.display = 'none';
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'text-center text-white p-8 bg-gray-800 rounded-lg';
                    errorDiv.innerHTML = `
                      <FilmIcon class="w-16 h-16 mx-auto mb-4 text-gray-400" />
                      <p class="text-lg font-medium">Video Unavailable</p>
                      <p class="text-sm opacity-70">Media may have expired</p>
                    `;
                    e.currentTarget.parentNode?.appendChild(errorDiv);
                  }}
                >
                  <source src={selectedMedia.url} />
                  Your browser does not support the video tag.
                </video>
              )}

              {/* Caption */}
              {selectedMedia.caption && (
                <div className="absolute bottom-4 left-4 right-4 bg-black bg-opacity-50 text-white p-4 rounded-lg backdrop-blur-sm">
                  <p className="text-sm">{selectedMedia.caption}</p>
                </div>
              )}
            </div>

            {/* Footer Gallery */}
            {selectedMedia.type === 'image' && (
              <div className="absolute bottom-0 left-0 right-0 px-4 pb-4 flex items-center justify-center">
                <div className="bg-black bg-opacity-60 rounded-lg p-2 flex gap-2 overflow-x-auto max-w-[90vw] scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
                  {messages.filter(m => m.message_type === 'image' && m.media_url).map((img, idx) => {
                    const url = img.media_url!.startsWith('http') ? img.media_url! : buildApiUrl(`/api/whatsapp/media/${img.media_url}`);
                    const isActive = selectedMedia.url === url;
                    return (
                      <img
                        key={img.id}
                        src={url}
                        alt="thumb"
                        className={`h-16 w-16 object-cover rounded-md cursor-pointer border-2 transition-all duration-200 ${isActive ? 'border-green-400 shadow-lg scale-110' : 'border-transparent opacity-70 hover:opacity-100'}`}
                        onClick={e => {
                          e.stopPropagation();
                          setSelectedMedia({ url, type: 'image', caption: img.caption });
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-60">
          <div className="bg-white rounded-lg shadow-xl p-8 max-w-xs w-full text-center">
            <h2 className="text-lg font-semibold mb-4">Delete this media?</h2>
            <p className="mb-6 text-gray-600">Are you sure you want to delete this media? This action cannot be undone.</p>
            <div className="flex justify-center gap-4">
              <button
                className="btn btn-error"
                onClick={async () => {
                  // Implement delete logic here (API call, then update state)
                  setShowDeleteConfirm(false);
                  setSelectedMedia(null);
                  toast.success('Media deleted (mock)');
                }}
              >
                Delete
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WhatsAppPage; 