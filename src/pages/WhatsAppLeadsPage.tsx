import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { buildApiUrl } from '../lib/api';
import { fetchWhatsAppTemplates, filterTemplates, type WhatsAppTemplate } from '../lib/whatsappTemplates';
import TemplateOptionCard from '../components/whatsapp/TemplateOptionCard';
import { generateTemplateParameters } from '../lib/whatsappTemplateParams';
import { getTemplateParamDefinitions, generateParamsFromDefinitions } from '../lib/whatsappTemplateParamMapping';
import {
  MagnifyingGlassIcon,
  PaperAirplaneIcon,
  FaceSmileIcon,
  PaperClipIcon,
  XMarkIcon,
  PhoneIcon,
  UserPlusIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  PhotoIcon,
  FilmIcon,
  LockClosedIcon,
  PencilIcon,
  TrashIcon,
  CheckIcon,
  ChevronDownIcon,
  UserGroupIcon,
  LinkIcon,
} from '@heroicons/react/24/outline';
import EmojiPicker from 'emoji-picker-react';
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
  message_type: 'text' | 'image' | 'document' | 'audio' | 'video' | 'location' | 'contact' | 'button_response' | 'list_response';
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
  unread_count?: number;
  last_message_at: string;
}

const WhatsAppLeadsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [leads, setLeads] = useState<WhatsAppLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLead, setSelectedLead] = useState<WhatsAppLead | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [isLocked, setIsLocked] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Media modal state
  const [selectedMedia, setSelectedMedia] = useState<{url: string, type: 'image' | 'video', caption?: string} | null>(null);

  // Edit/Delete message state
  const [editingMessage, setEditingMessage] = useState<number | null>(null);
  const [editMessageText, setEditMessageText] = useState('');
  const [deletingMessage, setDeletingMessage] = useState<number | null>(null);
  const [showDeleteOptions, setShowDeleteOptions] = useState<number | null>(null);
  const [userCache, setUserCache] = useState<Record<string, string>>({});

  // Template state
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<WhatsAppTemplate | null>(null);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [templateSearchTerm, setTemplateSearchTerm] = useState('');
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);

  // AI suggestions state
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [showAISuggestions, setShowAISuggestions] = useState(false);
  
  // Mobile dropdown state
  const [showMobileDropdown, setShowMobileDropdown] = useState(false);
  
  // Emoji picker state
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);

  // Mobile input focus state
  const [isInputFocused, setIsInputFocused] = useState(false);

  // Dropdown and lead selection state
  const [showActionDropdown, setShowActionDropdown] = useState(false);
  const [showLeadSearchModal, setShowLeadSearchModal] = useState(false);
  const [leadSearchQuery, setLeadSearchQuery] = useState('');
  const [leadSearchResults, setLeadSearchResults] = useState<any[]>([]);
  const [isSearchingLeads, setIsSearchingLeads] = useState(false);
  const [actionType, setActionType] = useState<'sublead' | 'contact' | null>(null);

  // Helper function to fetch user name by ID
  const getUserName = async (userId: string) => {
    if (!userId) return null;
    if (userCache[userId]) return userCache[userId];
    
    try {
      const { data } = await supabase
        .from('users')
        .select('first_name, full_name')
        .eq('id', userId)
        .single();
      
      if (data) {
        const name = data.first_name || data.full_name || 'Unknown User';
        setUserCache(prev => ({ ...prev, [userId]: name }));
        return name;
      }
    } catch (error) {
      console.error('Error fetching user:', error);
    }
    return null;
  };

  // Fetch current user info
  useEffect(() => {
    const fetchCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        // Only try database lookup if it looks like an email
        if (user.email.includes('@')) {
          const { data: userRow } = await supabase
            .from('users')
            .select('id, full_name, email, first_name')
            .eq('email', user.email)
            .single();
          
          if (userRow) {
            setCurrentUser(userRow);
            return;
          }
        }
        
        // Fallback: create a user object with available data
        const fallbackUser = {
          id: user.id,
          full_name: user.user_metadata?.full_name || user.user_metadata?.name || user.email,
          email: user.email
        };
        setCurrentUser(fallbackUser);
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

  // Handle click outside to close emoji picker and mobile dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      if (isEmojiPickerOpen) {
        if (!target.closest('.emoji-picker-container') && !target.closest('button[type="button"]')) {
          setIsEmojiPickerOpen(false);
        }
      }
      
      if (showMobileDropdown) {
        if (!target.closest('.mobile-dropdown-container')) {
          setShowMobileDropdown(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isEmojiPickerOpen, showMobileDropdown]);

  // Fetch WhatsApp templates
  useEffect(() => {
    const loadTemplates = async () => {
      try {
        console.log('🔄 Loading WhatsApp templates...');
        setIsLoadingTemplates(true);
        const fetchedTemplates = await fetchWhatsAppTemplates();
        console.log('📦 Templates loaded:', fetchedTemplates.length, 'templates');
        setTemplates(fetchedTemplates);
      } catch (error) {
        console.error('❌ Error loading templates:', error);
        toast.error('Failed to load templates');
      } finally {
        setIsLoadingTemplates(false);
      }
    };
    
    loadTemplates();
  }, []);

  // Fetch WhatsApp leads (messages from unconnected numbers)
  useEffect(() => {
    const fetchWhatsAppLeads = async () => {
      try {
        setLoading(true);
        console.log('🔍 Fetching WhatsApp leads...');

        // Get all incoming WhatsApp messages, including read status
        const { data: incomingMessages, error } = await supabase
          .from('whatsapp_messages')
          .select('*')
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
            legacy_id: message.legacy_id
          });
          
          if (!leadMap.has(phoneNumber)) {
            // Consider connected only if linked to a lead via FK (lead_id or legacy_id)
            // Backend should handle phone number matching, frontend only checks if lead exists
            const isConnected = !!message.lead_id || !!message.legacy_id;
            
            // Count unread messages (messages that are not read or is_read is null/false)
            const isUnread = !message.is_read || message.is_read === false;
            
            leadMap.set(phoneNumber, {
              ...message,
              phone_number: phoneNumber,
              is_connected: isConnected,
              message_count: 1,
              unread_count: isUnread ? 1 : 0,
              last_message_at: message.sent_at
            });
          } else {
            const existingLead = leadMap.get(phoneNumber)!;
            existingLead.message_count += 1;
            
            // Increment unread count if this message is unread
            const isUnread = !message.is_read || message.is_read === false;
            if (isUnread) {
              existingLead.unread_count = (existingLead.unread_count || 0) + 1;
            }
            
            // Keep the most recent message as the main message
            if (new Date(message.sent_at) > new Date(existingLead.last_message_at)) {
              Object.assign(existingLead, {
                ...message,
                phone_number: phoneNumber,
                message_count: existingLead.message_count,
                unread_count: existingLead.unread_count,
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

  // Auto-select lead from URL parameter (when navigating from bell icon)
  useEffect(() => {
    const phoneParam = searchParams.get('phone');
    if (phoneParam && leads.length > 0 && !selectedLead) {
      // Try to find the lead by phone number
      const normalizedPhoneParam = decodeURIComponent(phoneParam);
      const matchingLead = leads.find(lead => {
        // Try exact match first
        if (lead.phone_number === normalizedPhoneParam) return true;
        // Try matching with extracted phone number variations
        const extracted = extractPhoneNumber(lead.sender_name) || extractPhoneFromMessage(lead.message);
        if (extracted === normalizedPhoneParam) return true;
        // Try partial match (in case of formatting differences)
        if (lead.phone_number && normalizedPhoneParam && 
            (lead.phone_number.includes(normalizedPhoneParam) || normalizedPhoneParam.includes(lead.phone_number))) {
          return true;
        }
        return false;
      });
      
      if (matchingLead) {
        console.log('✅ Auto-selecting lead from URL parameter:', normalizedPhoneParam, matchingLead);
        setSelectedLead(matchingLead);
        if (isMobile) {
          setShowChat(true);
        }
        // Clear the URL parameter after selecting
        setSearchParams({});
      } else {
        console.log('⚠️ Could not find lead with phone number:', normalizedPhoneParam);
      }
    }
  }, [leads, searchParams, selectedLead, isMobile, setSearchParams]);

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
        
        // For outgoing messages, look up the user's first name
        const messagesWithSenderNames = await Promise.all(
          (data || []).map(async (message) => {
            if (message.direction === 'out' && message.sender_name) {
              // Try to find the user by email (sender_name might be an email)
              const { data: user } = await supabase
                .from('users')
                .select('first_name, full_name, email')
                .eq('email', message.sender_name)
                .single();
              
              if (user) {
                return {
                  ...message,
                  sender_first_name: user.first_name || user.full_name || message.sender_name
                };
              }
              
              // Try to find by full_name if sender_name is not an email
              const { data: userByName } = await supabase
                .from('users')
                .select('first_name, full_name')
                .eq('full_name', message.sender_name)
                .single();
              
              if (userByName) {
                return {
                  ...message,
                  sender_first_name: userByName.first_name || userByName.full_name || message.sender_name
                };
              }
            }
            
            return message;
          })
        );
        
        // Process template messages for display
        const processedMessages = messagesWithSenderNames.map(processTemplateMessage);
        setMessages(processedMessages);
        
        // Mark incoming messages as read when viewing the conversation
        if (currentUser && data && data.length > 0) {
          const incomingMessageIds = data
            .filter(msg => msg.direction === 'in' && (!msg.is_read || msg.is_read === false))
            .map(msg => msg.id);
          
          if (incomingMessageIds.length > 0) {
            try {
              const { error } = await supabase
                .from('whatsapp_messages')
                .update({ 
                  is_read: true, 
                  read_at: new Date().toISOString(),
                  read_by: currentUser.id 
                })
                .in('id', incomingMessageIds);
              
              if (error) {
                console.error('Error marking messages as read:', error);
              } else {
                console.log(`✅ Marked ${incomingMessageIds.length} messages as read`);
              }
            } catch (error) {
              console.error('Error marking messages as read:', error);
            }
          }
        }
        
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

  // Update timer for 24-hour window
  useEffect(() => {
    if (!selectedLead) {
      setTimeLeft('');
      setIsLocked(false);
      return;
    }

    // Find the last message from the client (incoming message)
    const lastIncomingMessage = messages
      .filter(msg => msg.direction === 'in')
      .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime())[0];

    if (lastIncomingMessage) {
      calculateTimeLeft(lastIncomingMessage.sent_at);
      
      // Update timer every minute
      const interval = setInterval(() => {
        calculateTimeLeft(lastIncomingMessage.sent_at);
      }, 60000); // Update every minute
      
      return () => clearInterval(interval);
    } else {
      // If no incoming messages, check the selected lead's last message time
      calculateTimeLeft(selectedLead.last_message_at);
      
      const interval = setInterval(() => {
        calculateTimeLeft(selectedLead.last_message_at);
      }, 60000);
      
      return () => clearInterval(interval);
    }
  }, [selectedLead, messages]);

  // Load user names for edited/deleted messages
  useEffect(() => {
    const loadUserNames = async () => {
      const userIds = new Set<string>();
      
      messages.forEach(msg => {
        if ((msg as any).edited_by) userIds.add((msg as any).edited_by);
        if ((msg as any).deleted_by) userIds.add((msg as any).deleted_by);
      });

      for (const userId of userIds) {
        if (!userCache[userId]) {
          const name = await getUserName(userId);
          if (name) {
            setUserCache(prev => ({ ...prev, [userId]: name }));
          }
        }
      }
    };

    if (messages.length > 0) {
      loadUserNames();
    }
  }, [messages]);

  // Filter leads based on search term and sort by latest message
  const filteredLeads = leads.filter(lead =>
    lead.phone_number?.includes(searchTerm) ||
    lead.sender_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lead.message.toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => {
    // Sort by last_message_at (descending - most recent first)
    return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
  });

  // Handle edit message
  const handleEditMessage = async (messageId: number, newText: string) => {
    try {
      const message = messages.find(m => m.id === messageId);
      if (!message || !message.whatsapp_message_id) {
        toast.error('Message ID not found');
        return;
      }

      const response = await fetch(buildApiUrl('/api/whatsapp/edit-message'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messageId: message.whatsapp_message_id,
          newMessage: newText,
          currentUserId: currentUser?.id
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to edit message');
      }

      // Update message in local state
      setMessages(prev => prev.map(m => 
        m.id === messageId 
          ? { ...m, message: newText, is_edited: true as any }
          : m
      ));

      setEditingMessage(null);
      setEditMessageText('');
      toast.success('Message edited (note: WhatsApp API does not support message editing, update is internal only)', { duration: 5000 });
    } catch (error) {
      console.error('Error editing message:', error);
      toast.error('Failed to edit message: ' + (error as Error).message);
    }
  };

  // Handle delete message
  const handleDeleteMessage = async (messageId: number, deleteForEveryone: boolean) => {
    try {
      const message = messages.find(m => m.id === messageId);
      if (!message || !message.whatsapp_message_id) {
        toast.error('Message ID not found');
        return;
      }

      const response = await fetch(buildApiUrl('/api/whatsapp/delete-message'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messageId: message.whatsapp_message_id,
          deleteForEveryone: deleteForEveryone,
          currentUserId: currentUser?.id
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete message');
      }

      if (deleteForEveryone) {
        // Remove message from local state
        setMessages(prev => prev.filter(m => m.id !== messageId));
        toast.success('Message deleted for everyone!');
      } else {
        // Mark as deleted for me
        setMessages(prev => prev.map(m => 
          m.id === messageId 
            ? { ...m, is_deleted: true as any }
            : m
        ));
        toast.success('Message deleted!');
      }

      setDeletingMessage(null);
      setShowDeleteOptions(null);
    } catch (error) {
      console.error('Error deleting message:', error);
      toast.error('Failed to delete message: ' + (error as Error).message);
    }
  };

  // Send reply message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && !selectedTemplate) || !selectedLead || !currentUser) return;

    setSending(true);
    try {
      console.log('🚀 Sending reply message:', {
        message: newMessage.trim(),
        to: selectedLead.phone_number,
        sender: currentUser.full_name || currentUser.email,
        hasTemplate: !!selectedTemplate,
        templateName: selectedTemplate?.name360
      });

      // Build the message payload
      const messagePayload: any = {
        leadId: null, // No lead ID for new WhatsApp leads
        phoneNumber: selectedLead.phone_number,
        message: selectedTemplate && selectedTemplate.params === '0' 
          ? `TEMPLATE_MARKER:${selectedTemplate.title}` 
          : newMessage.trim(),
        sender_name: currentUser.full_name || currentUser.email,
        hasTemplate: !!selectedTemplate,
        selectedTemplate: selectedTemplate?.title
      };

      // Check if we should send as template message
      if (selectedTemplate) {
        messagePayload.isTemplate = true;
        // Ensure templateId is sent as a number (not string) for proper database storage
        messagePayload.templateId = typeof selectedTemplate.id === 'string' ? parseInt(selectedTemplate.id, 10) : selectedTemplate.id;
        messagePayload.templateName = selectedTemplate.name360;
        messagePayload.templateLanguage = selectedTemplate.language || 'en_US'; // Use template's language
        
        // Debug log to verify templateId is being sent
        console.log('📤 Template ID being sent:', messagePayload.templateId, '(type:', typeof messagePayload.templateId, ')');
        
        // Generate parameters based on actual param count
        const paramCount = Number(selectedTemplate.params) || 0;
        if (paramCount > 0) {
          // Import the helper function
          const { generateTemplateParameters } = await import('../lib/whatsappTemplateParams');
          messagePayload.templateParameters = await generateTemplateParameters(
            paramCount,
            selectedLead,
            null // WhatsAppLeadsPage doesn't use contacts
          );
          messagePayload.message = selectedTemplate.content || 'Template sent';
          console.log(`📱 Template with ${paramCount} param(s) - auto-filled parameters:`, messagePayload.templateParameters);
        } else {
          // Template with no parameters
          messagePayload.templateParameters = [];
          messagePayload.message = `TEMPLATE_MARKER:${selectedTemplate.title}`;
        }
      }

      // Send message via WhatsApp API
      const response = await fetch(buildApiUrl('/api/whatsapp/send-message'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messagePayload),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send message');
      }

      // Add message to local state
      // Determine the message text to display
      let displayMessage = newMessage.trim();
      if (selectedTemplate) {
        if (selectedTemplate.params === '0' && selectedTemplate.content) {
          // Template without parameters - show template content
          displayMessage = selectedTemplate.content;
        } else if (selectedTemplate.params === '1' && newMessage.trim()) {
          // Template with parameters - show user input
          displayMessage = newMessage.trim();
        } else if (selectedTemplate.params === '1' && !newMessage.trim()) {
          // Template with parameters but no user input - show template name
          displayMessage = `Template: ${selectedTemplate.title}`;
        }
      }
      
      const newMsg = {
        id: Date.now(), // Temporary ID
        phone_number: selectedLead.phone_number,
        sender_name: currentUser.full_name || currentUser.email,
        direction: 'out',
        message: displayMessage,
        sent_at: new Date().toISOString(),
        status: 'sent',
        message_type: 'text',
        whatsapp_status: 'sent',
        whatsapp_message_id: result.messageId
      };

      setMessages(prev => [...prev, newMsg]);
      setNewMessage('');
      setSelectedTemplate(null); // Clear template after sending
      // Reset mobile input focus state
      if (isMobile) {
        setIsInputFocused(false);
        textareaRef.current?.blur();
      }
      
      // Refresh messages to get updated data (including any new incoming messages)
      // This will update the timer based on the latest message
      const refreshMessages = async () => {
        if (!selectedLead) return;
        
        try {
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

          const phoneMessages = phoneQuery.data || [];
          const nameMessages = nameQuery.data || [];
          const allMessages = [...phoneMessages, ...nameMessages];
          
          const uniqueMessages = allMessages.filter((message, index, self) => 
            index === self.findIndex(m => m.id === message.id)
          );
          
          // Process template messages for display
          const processedMessages = uniqueMessages.map(processTemplateMessage);
          
          // Only update if there are actual changes
          setMessages(prevMessages => {
            const hasChanges = processedMessages.length !== prevMessages.length ||
              processedMessages.some((newMsg, index) => {
                const prevMsg = prevMessages[index];
                return !prevMsg || 
                       newMsg.id !== prevMsg.id || 
                       newMsg.message !== prevMsg.message ||
                       newMsg.whatsapp_status !== prevMsg.whatsapp_status;
              });
            
            if (hasChanges) {
              console.log('🔄 Refresh detected changes, updating messages (Leads)');
              return processedMessages;
            } else {
              console.log('🔄 Refresh - no changes detected, keeping current messages (Leads)');
              return prevMessages;
            }
          });
        } catch (error) {
          console.error('Error refreshing messages:', error);
        }
      };
      
      // Refresh messages after a short delay to allow server to process
      setTimeout(() => {
        refreshMessages();
        
        // Also refresh the leads list to update the lock status
        // This will ensure the lock icon updates immediately when a new message arrives
        const refreshLeads = async () => {
          try {
            const { data: incomingMessages } = await supabase
              .from('whatsapp_messages')
              .select('*')
              .eq('direction', 'in')
              .order('sent_at', { ascending: false });

            if (incomingMessages) {
              const leadMap = new Map<string, WhatsAppLead>();
              
              incomingMessages.forEach((message) => {
                const phoneNumber = message.phone_number || extractPhoneNumber(message.sender_name) || extractPhoneFromMessage(message.message) || 'unknown';
                
                if (!leadMap.has(phoneNumber)) {
                  // Consider connected only if linked to a lead via FK (lead_id or legacy_id)
                  // Backend should handle phone number matching, frontend only checks if lead exists
                  const isConnected = !!message.lead_id || !!message.legacy_id;
                  const isUnread = !message.is_read || message.is_read === false;
                  
                  leadMap.set(phoneNumber, {
                    ...message,
                    phone_number: phoneNumber,
                    is_connected: isConnected,
                    message_count: 1,
                    unread_count: isUnread ? 1 : 0,
                    last_message_at: message.sent_at
                  });
                } else {
                  const existingLead = leadMap.get(phoneNumber)!;
                  existingLead.message_count += 1;
                  const isUnread = !message.is_read || message.is_read === false;
                  if (isUnread) {
                    existingLead.unread_count = (existingLead.unread_count || 0) + 1;
                  }
                  if (new Date(message.sent_at) > new Date(existingLead.last_message_at)) {
                    Object.assign(existingLead, {
                      ...message,
                      phone_number: phoneNumber,
                      message_count: existingLead.message_count,
                      unread_count: existingLead.unread_count,
                      last_message_at: message.sent_at
                    });
                  }
                }
              });

              const updatedLeads = Array.from(leadMap.values())
                .filter(lead => !lead.is_connected && lead.phone_number !== 'unknown')
                .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
              
              setLeads(updatedLeads);
            }
          } catch (error) {
            console.error('Error refreshing leads:', error);
          }
        };
        
        // Refresh leads list to update lock status
        refreshLeads();
      }, 1000);
      
      // Reset textarea height
      setTimeout(() => {
        const textarea = textareaRef.current;
        if (textarea) {
          textarea.style.height = '40px';
        }
      }, 100);
      
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

  // Send media message
  const handleSendMedia = async () => {
    if (!selectedFile || !selectedLead || !currentUser) {
      console.log('❌ Cannot send media - missing file, lead, or user:', { selectedFile, selectedLead, currentUser });
      return;
    }

    console.log('📤 Starting to send media:', {
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
      fileType: selectedFile.type,
      leadId: selectedLead.id,
      leadName: selectedLead.sender_name
    });

    setUploadingMedia(true);
    try {
      const phoneNumber = selectedLead.phone_number;
      if (!phoneNumber) {
        toast.error('No phone number found for this lead');
        return;
      }

      // Create FormData for file upload
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('leadId', selectedLead.lead_id || selectedLead.id.toString());

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
          leadId: selectedLead.lead_id || selectedLead.id.toString(),
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
      
      const newMsg = {
        id: Date.now(),
        lead_id: selectedLead.lead_id || selectedLead.id.toString(),
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

      // Use sender name, fallback to phone number, then default
      const leadName = lead.sender_name?.trim() || lead.phone_number || 'WhatsApp Lead';
      
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

  // Search leads from both leads and leads_lead tables
  const searchLeadsForSelection = async (query: string) => {
    if (!query.trim() || query.length < 2) {
      setLeadSearchResults([]);
      return;
    }

    setIsSearchingLeads(true);
    try {
      // Search in leads table (new leads)
      const { data: leadsData, error: leadsError } = await supabase
        .from('leads')
        .select(`
          id,
          lead_number,
          name,
          email,
          phone,
          mobile,
          stage
        `)
        .or(`lead_number.ilike.%${query}%,name.ilike.%${query}%,email.ilike.%${query}%`)
        .limit(10);

      // Search in leads_lead table (legacy leads)
      const { data: legacyLeadsData, error: legacyError } = await supabase
        .from('leads_lead')
        .select(`
          id,
          lead_number,
          name,
          email,
          phone,
          mobile,
          stage
        `)
        .or(`lead_number.ilike.%${query}%,name.ilike.%${query}%,email.ilike.%${query}%`)
        .limit(10);

      if (leadsError) console.error('Error searching leads:', leadsError);
      if (legacyError) console.error('Error searching legacy leads:', legacyError);

      // Combine and format results
      const allLeads = [
        ...(leadsData || []).map(lead => ({ ...lead, isLegacy: false })),
        ...(legacyLeadsData || []).map(lead => ({ ...lead, isLegacy: true }))
      ];

      // Deduplicate by lead_number
      const uniqueLeads = allLeads.filter((lead, index, self) => 
        index === self.findIndex(l => l.lead_number === lead.lead_number)
      );

      setLeadSearchResults(uniqueLeads.slice(0, 10));
    } catch (error) {
      console.error('Error in lead search:', error);
      setLeadSearchResults([]);
    } finally {
      setIsSearchingLeads(false);
    }
  };

  // Handle lead search input change
  useEffect(() => {
    if (showLeadSearchModal && leadSearchQuery) {
      const timeoutId = setTimeout(() => {
        searchLeadsForSelection(leadSearchQuery);
      }, 300);
      return () => clearTimeout(timeoutId);
    } else {
      setLeadSearchResults([]);
    }
  }, [leadSearchQuery, showLeadSearchModal]);

  // Handle create sublead
  const handleCreateSublead = async (parentLead: any) => {
    if (!selectedLead) return;

    try {
      setLoading(true);
      console.log('🔄 Creating sublead for parent:', parentLead);

      // Get current user information
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        toast.error('User not authenticated');
        return;
      }

      const leadName = selectedLead.sender_name?.trim() || selectedLead.phone_number || 'WhatsApp Lead';
      const parentLeadNumber = parentLead.lead_number;

      // Generate sublead number (parent_number/sub_number)
      // First, find the highest sublead number for this parent
      const { data: existingSubLeads } = await supabase
        .from('leads')
        .select('lead_number')
        .like('lead_number', `${parentLeadNumber}/%`)
        .order('lead_number', { ascending: false })
        .limit(1);

      let subNumber = 1;
      if (existingSubLeads && existingSubLeads.length > 0) {
        const lastSubLead = existingSubLeads[0].lead_number;
        const match = lastSubLead.match(/\/(\d+)$/);
        if (match) {
          subNumber = parseInt(match[1], 10) + 1;
        }
      }

      const subLeadNumber = `${parentLeadNumber}/${subNumber}`;

      // Get parent lead's master_id and manual_id
      let masterId: string | number = parentLead.id;
      let manualId: string = parentLead.lead_number;

      if (!parentLead.isLegacy) {
        // For new leads, try to get master_id and manual_id from the parent
        const { data: parentLeadData } = await supabase
          .from('leads')
          .select('master_id, manual_id')
          .eq('id', parentLead.id)
          .maybeSingle();

        if (parentLeadData?.master_id) {
          masterId = parentLeadData.master_id;
        }
        if (parentLeadData?.manual_id) {
          manualId = parentLeadData.manual_id;
        } else {
          // Generate a new manual_id if parent doesn't have one
          const { data: maxLeadData } = await supabase
            .from('leads')
            .select('manual_id')
            .not('manual_id', 'is', null)
            .order('manual_id', { ascending: false })
            .limit(1)
            .single();
          
          if (maxLeadData?.manual_id) {
            const maxId = BigInt(String(maxLeadData.manual_id));
            manualId = (maxId + BigInt(1)).toString();
          } else {
            manualId = Date.now().toString();
          }
        }
      } else {
        // For legacy leads, extract numeric ID from lead_number
        const numericMatch = parentLead.lead_number.match(/\d+/);
        if (numericMatch) {
          masterId = parseInt(numericMatch[0], 10);
          manualId = parentLead.lead_number;
        }
      }

      // Create sublead
      const subLeadData: Record<string, any> = {
        lead_number: subLeadNumber,
        master_id: masterId,
        manual_id: manualId,
        name: leadName,
        email: null,
        phone: selectedLead.phone_number || null,
        mobile: null,
        topic: 'WhatsApp Inquiry',
        language: 'English',
        source: 'WhatsApp',
        stage: 0,
        status: 'new',
        created_at: new Date().toISOString(),
        created_by: user.email,
        balance_currency: 'NIS',
        proposal_currency: 'NIS'
      };

      const { data: insertedSubLead, error: subLeadError } = await supabase
        .from('leads')
        .insert([subLeadData])
        .select('id')
        .single();

      if (subLeadError) {
        console.error('Error creating sublead:', subLeadError);
        toast.error('Failed to create sublead');
        return;
      }

      // Create contact for the sublead
      if (insertedSubLead?.id) {
        const { data: maxContactId } = await supabase
          .from('leads_contact')
          .select('id')
          .order('id', { ascending: false })
          .limit(1)
          .single();

        const newContactId = maxContactId ? maxContactId.id + 1 : 1;
        const currentDate = new Date().toISOString().split('T')[0];

        const { error: contactError } = await supabase
          .from('leads_contact')
          .insert([{
            id: newContactId,
            name: leadName,
            mobile: null,
            phone: selectedLead.phone_number || null,
            email: null,
            newlead_id: insertedSubLead.id,
            cdate: currentDate,
            udate: currentDate
          }]);

        if (contactError) {
          console.error('Error creating contact:', contactError);
        } else {
          // Create relationship
          const { data: maxRelationshipId } = await supabase
            .from('lead_leadcontact')
            .select('id')
            .order('id', { ascending: false })
            .limit(1)
            .single();

          const newRelationshipId = maxRelationshipId ? maxRelationshipId.id + 1 : 1;

          const { error: relationshipError } = await supabase
            .from('lead_leadcontact')
            .insert([{
              id: newRelationshipId,
              contact_id: newContactId,
              newlead_id: insertedSubLead.id,
              main: 'true'
            }]);

          if (relationshipError) {
            console.error('Error creating contact relationship:', relationshipError);
          }
        }
      }

      // Update WhatsApp messages to link them to the sublead
      const { error: updateError } = await supabase
        .from('whatsapp_messages')
        .update({ 
          lead_id: insertedSubLead.id,
          legacy_id: null
        })
        .or(`sender_name.ilike.%${selectedLead.phone_number}%,sender_name.ilike.%${selectedLead.sender_name}%,message.ilike.%${selectedLead.phone_number}%`);

      if (updateError) {
        console.error('Error linking messages to sublead:', updateError);
      }

      toast.success(`Sublead ${subLeadNumber} created successfully!`);
      
      // Refresh the leads list
      setLeads(prevLeads => prevLeads.filter(l => l.id !== selectedLead.id));
      setSelectedLead(null);
      setShowLeadSearchModal(false);
      setShowActionDropdown(false);

      // Navigate to the sublead's page
      window.location.href = `/clients/${subLeadNumber}`;

    } catch (error) {
      console.error('Error creating sublead:', error);
      toast.error('Failed to create sublead');
    } finally {
      setLoading(false);
    }
  };

  // Handle add as contact to lead
  const handleAddAsContact = async (targetLead: any) => {
    if (!selectedLead) return;

    try {
      setLoading(true);
      console.log('🔄 Adding WhatsApp lead as contact to:', targetLead);

      const leadName = selectedLead.sender_name?.trim() || selectedLead.phone_number || 'WhatsApp Contact';
      const targetLeadId = targetLead.id;
      const isLegacyLead = targetLead.isLegacy;

      // For legacy leads, create contact without lead_id/newlead_id, then link via lead_leadcontact
      // For new leads, use newlead_id in leads_contact and newlead_id in lead_leadcontact
      if (isLegacyLead) {
        // Get the next available contact ID
        const { data: maxContactId } = await supabase
          .from('leads_contact')
          .select('id')
          .order('id', { ascending: false })
          .limit(1)
          .single();

        const newContactId = maxContactId ? maxContactId.id + 1 : 1;
        const currentDate = new Date().toISOString().split('T')[0];

        // Create contact (without lead_id or newlead_id for legacy leads)
        let contactResult = await supabase
          .from('leads_contact')
          .insert([{
            id: newContactId,
            name: leadName,
            mobile: null,
            phone: selectedLead.phone_number || null,
            email: null,
            cdate: currentDate,
            udate: currentDate
          }])
          .select('id')
          .single();

        // If duplicate key error, get next available ID
        if (contactResult.error && contactResult.error.code === '23505') {
          const { data: maxIdData } = await supabase
            .from('leads_contact')
            .select('id')
            .order('id', { ascending: false })
            .limit(1)
            .single();
          
          const nextId = maxIdData ? maxIdData.id + 1 : 1;
          contactResult = await supabase
            .from('leads_contact')
            .insert([{
              id: nextId,
              name: leadName,
              mobile: null,
              phone: selectedLead.phone_number || null,
              email: null,
              cdate: currentDate,
              udate: currentDate
            }])
            .select('id')
            .single();
        }

        if (contactResult.error || !contactResult.data) {
          console.error('Error creating contact:', contactResult.error);
          toast.error('Failed to create contact');
          return;
        }

        const finalContactId = contactResult.data.id;

        // Create relationship in lead_leadcontact with lead_id for legacy leads
        const { data: maxRelationshipId } = await supabase
          .from('lead_leadcontact')
          .select('id')
          .order('id', { ascending: false })
          .limit(1)
          .single();

        const newRelationshipId = maxRelationshipId ? maxRelationshipId.id + 1 : 1;

        let relationshipResult = await supabase
          .from('lead_leadcontact')
          .insert([{
            id: newRelationshipId,
            contact_id: finalContactId,
            lead_id: targetLeadId, // For legacy leads
            main: 'false'
          }]);

        // If duplicate key error, get next available ID
        if (relationshipResult.error && relationshipResult.error.code === '23505') {
          const { data: maxRelIdData } = await supabase
            .from('lead_leadcontact')
            .select('id')
            .order('id', { ascending: false })
            .limit(1)
            .single();
          
          const nextRelId = maxRelIdData ? maxRelIdData.id + 1 : 1;
          relationshipResult = await supabase
            .from('lead_leadcontact')
            .insert([{
              id: nextRelId,
              contact_id: finalContactId,
              lead_id: targetLeadId,
              main: 'false'
            }]);
        }

        if (relationshipResult.error) {
          console.error('Error creating contact relationship:', relationshipResult.error);
          toast.error('Failed to link contact to lead');
          return;
        }
      } else {
        // For new leads
        const { data: maxContactId } = await supabase
          .from('leads_contact')
          .select('id')
          .order('id', { ascending: false })
          .limit(1)
          .single();

        const newContactId = maxContactId ? maxContactId.id + 1 : 1;
        const currentDate = new Date().toISOString().split('T')[0];

        // Create contact
        const { error: contactError } = await supabase
          .from('leads_contact')
          .insert([{
            id: newContactId,
            name: leadName,
            mobile: null,
            phone: selectedLead.phone_number || null,
            email: null,
            newlead_id: targetLeadId, // For new leads
            cdate: currentDate,
            udate: currentDate
          }]);

        if (contactError) {
          console.error('Error creating contact:', contactError);
          toast.error('Failed to create contact');
          return;
        }

        // Create relationship
        const { data: maxRelationshipId } = await supabase
          .from('lead_leadcontact')
          .select('id')
          .order('id', { ascending: false })
          .limit(1)
          .single();

        const newRelationshipId = maxRelationshipId ? maxRelationshipId.id + 1 : 1;

        const { error: relationshipError } = await supabase
          .from('lead_leadcontact')
          .insert([{
            id: newRelationshipId,
            contact_id: newContactId,
            newlead_id: targetLeadId, // For new leads
            main: 'false'
          }]);

        if (relationshipError) {
          console.error('Error creating contact relationship:', relationshipError);
          toast.error('Failed to link contact to lead');
          return;
        }
      }

      // Update WhatsApp messages to link them to the target lead
      const { error: updateError } = await supabase
        .from('whatsapp_messages')
        .update({ 
          lead_id: isLegacyLead ? null : targetLeadId,
          legacy_id: isLegacyLead ? targetLeadId : null
        })
        .or(`sender_name.ilike.%${selectedLead.phone_number}%,sender_name.ilike.%${selectedLead.sender_name}%,message.ilike.%${selectedLead.phone_number}%`);

      if (updateError) {
        console.error('Error linking messages to lead:', updateError);
      }

      toast.success(`Contact added to lead ${targetLead.lead_number} successfully!`);
      
      // Refresh the leads list
      setLeads(prevLeads => prevLeads.filter(l => l.id !== selectedLead.id));
      setSelectedLead(null);
      setShowLeadSearchModal(false);
      setShowActionDropdown(false);

      // Navigate to the target lead's page
      window.location.href = `/clients/${targetLead.lead_number}`;

    } catch (error) {
      console.error('Error adding contact:', error);
      toast.error('Failed to add contact');
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

  // Format date separator (WhatsApp-style)
  const formatDateSeparator = (timestamp: string) => {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Check if the date is today
    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    }
    // Check if the date is yesterday
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    // Check if the date is within the last 7 days
    const diffTime = today.getTime() - date.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 7) {
      return date.toLocaleDateString('en-US', { weekday: 'long' });
    }
    // Otherwise, show the full date
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  // Calculate time left in 24-hour window for WhatsApp messaging
  const calculateTimeLeft = (lastMessageTime: string) => {
    const lastMessage = new Date(lastMessageTime);
    const now = new Date();
    const diffMs = now.getTime() - lastMessage.getTime();
    const hoursLeft = 24 - (diffMs / (1000 * 60 * 60));
    
    if (hoursLeft <= 0) {
      setIsLocked(true);
      setTimeLeft('Locked');
      return;
    }
    
    setIsLocked(false);
    const hours = Math.floor(hoursLeft);
    const minutes = Math.floor((hoursLeft - hours) * 60);
    
    if (hours > 0) {
      setTimeLeft(`${hours}h ${minutes}m`);
    } else {
      setTimeLeft(`${minutes}m`);
    }
  };

  // Check if a lead is locked (24 hours passed since last message)
  const isLeadLocked = (lastMessageTime: string) => {
    const lastMessage = new Date(lastMessageTime);
    const now = new Date();
    const diffMs = now.getTime() - lastMessage.getTime();
    const hoursPassed = diffMs / (1000 * 60 * 60);
    return hoursPassed > 24;
  };

  // Get message preview
  const getMessagePreview = (message: string) => {
    return message.length > 50 ? message.substring(0, 50) + '...' : message;
  };

  // Helper function to get document icon
  const getDocumentIcon = (mimeType?: string) => {
    if (!mimeType) return DocumentTextIcon;
    if (mimeType.includes('image/')) return PhotoIcon;
    if (mimeType.includes('pdf')) return DocumentTextIcon;
    if (mimeType.includes('video/')) return FilmIcon;
    return DocumentTextIcon;
  };

  // Helper function to process template messages for display
  const processTemplateMessage = (message: any): any => {
    // Debug: Log the message to see what's actually stored
    console.log('🔍 Processing message (Leads):', {
      id: message.id,
      direction: message.direction,
      message: message.message,
      template_id: message.template_id,
      messageType: message.message_type,
      whatsappMessageId: message.whatsapp_message_id
    });

    // Check if this is a template message that needs processing
    if (message.direction === 'out' && message.message) {
      // PRIORITY 1: Match by template_id if available (most reliable)
      if (message.template_id) {
        const template = templates.find(t => t.id === message.template_id);
        if (template) {
          console.log('✅ Found template by ID (Leads):', template.id, template.title);
          const paramCount = Number(template.params) || 0;
          if (paramCount === 0 && template.content) {
            return { ...message, message: template.content };
          } else {
            // Template has parameters - check if message already has filled content
            // If message doesn't contain template markers and has actual content, use it
            if (message.message && !message.message.includes('TEMPLATE_MARKER:') && !message.message.includes('[Template:')) {
              return message; // Already filled content
            }
            // Otherwise, show the template content with placeholders
            return { ...message, message: template.content || `Template: ${template.title}` };
          }
        }
      }

      // First, check if the message is already properly formatted (contains actual template content)
      const isAlreadyProperlyFormatted = templates.some(template => 
        template.content && message.message === template.content
      );
      
      if (isAlreadyProperlyFormatted) {
        console.log('✅ Message already properly formatted (Leads), no processing needed');
        return message;
      }
      
      // Check for various template message patterns that need processing
      const needsProcessing = 
        message.message.includes('Template:') ||
        message.message.includes('[Template:') || // Database format with brackets
        message.message.includes('[template:]') ||
        message.message.includes('template:') ||
        message.message.includes('TEMPLATE_MARKER:') || // Our new marker
        message.message === '' || // Empty message might be a template
        message.message === 'Template sent'; // Default template message

      if (needsProcessing) {
        console.log('📋 Found template message that needs processing (Leads)...');
        
        // PRIORITY 2: Fallback to name matching for backward compatibility (legacy messages without template_id)
        // Try to find the template by looking for template info in the message
        // First try bracket format, then regular format
        const templateMatch = message.message.match(/\[Template:\s*([^\]]+)\]/) || 
                              message.message.match(/Template:\s*(.+)/);
        if (templateMatch) {
          // Clean the template title: remove trailing spaces and brackets
          let templateTitle = templateMatch[1].trim().replace(/\]$/, '');
          console.log('🔍 Looking for template with title (Leads):', templateTitle);
          console.log('📋 Available template titles (Leads):', templates.map(t => t.title));
          
          // Try case-insensitive matching on title first
          const template = templates.find(t => 
            t.title.toLowerCase() === templateTitle.toLowerCase()
          );
          if (template) {
            console.log('✅ Found template by title (Leads):', template.title, 'Content:', template.content);
            if (template.params === '0' && template.content) {
              return { ...message, message: template.content };
            } else if (template.params === '1') {
              return { ...message, message: template.content || `Template: ${template.title}` };
            }
          } else {
            console.log('❌ Template not found for title (Leads):', templateTitle);
            // Try to find by name360 field as well (case-insensitive)
            const templateByName = templates.find(t => 
              t.name360 && t.name360.toLowerCase() === templateTitle.toLowerCase()
            );
            if (templateByName) {
              console.log('✅ Found template by name360 (Leads):', templateByName.name360, 'Content:', templateByName.content);
              if (templateByName.params === '0' && templateByName.content) {
                return { ...message, message: templateByName.content };
              } else if (templateByName.params === '1') {
                return { ...message, message: templateByName.content || `Template: ${templateByName.title}` };
              }
            } else {
              console.log('❌ Template not found by name360 either (Leads):', templateTitle);
            }
          }
        }
        
        // Check for our TEMPLATE_MARKER
        const templateMarkerMatch = message.message.match(/TEMPLATE_MARKER:(.+)/);
        if (templateMarkerMatch) {
          const templateTitle = templateMarkerMatch[1];
          const template = templates.find(t => t.title === templateTitle);
          if (template) {
            console.log('✅ Found template by marker (Leads):', template.title);
            if (template.params === '0' && template.content) {
              return { ...message, message: template.content };
            } else if (template.params === '1') {
              return { ...message, message: template.content || `Template: ${template.title}` };
            }
          }
        }
        
        // If message is empty or "Template sent", try to find the most recent template
        if (message.message === '' || message.message === 'Template sent') {
          console.log('🔍 Empty template message (Leads), looking for recent template...');
          // This is a fallback - we'll show a generic template message
          return { ...message, message: 'Template message sent' };
        }
      }
    }
    return message;
  };

  // Helper function to download media
  const handleDownloadMedia = (mediaUrl: string, fileName: string) => {
    const url = mediaUrl.startsWith('http') ? mediaUrl : buildApiUrl(`/api/whatsapp/media/${mediaUrl}`);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Auto-resize textarea
  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const scrollHeight = textarea.scrollHeight;
      // On mobile, when focused or when template/AI content is added, expand to max height
      const maxHeight = isMobile && (isInputFocused || selectedTemplate || aiSuggestions.length > 0) ? 300 : 250;
      textarea.style.height = Math.min(scrollHeight, maxHeight) + 'px';
    }
  };

  // Handle message input change
  const handleMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewMessage(e.target.value);
    adjustTextareaHeight();
  };

  // Handle emoji selection
  const handleEmojiClick = (emojiObject: any) => {
    const emoji = emojiObject.emoji;
    setNewMessage(prev => prev + emoji);
    setIsEmojiPickerOpen(false);
  };

  // Handle AI suggestions
  const handleAISuggestions = async () => {
    if (!selectedLead || isLoadingAI) return;

    setIsLoadingAI(true);
    setShowAISuggestions(true);
    
    try {
      const requestType = newMessage.trim() ? 'improve' : 'suggest';
      
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-ai-suggestions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          currentMessage: newMessage.trim(),
          conversationHistory: messages.map(msg => ({
            id: msg.id,
            direction: msg.direction,
            message: msg.message,
            sent_at: msg.sent_at,
            sender_name: msg.sender_name
          })),
          clientName: selectedLead.sender_name,
          requestType
        }),
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success) {
        // Get the single suggestion and clean it
        const suggestion = result.suggestion.trim();
        setAiSuggestions([suggestion]);
      } else {
        if (result.code === 'OPENAI_QUOTA') {
          toast.error('AI quota exceeded. Please check plan/billing or try again later.');
          setAiSuggestions(['Sorry, AI is temporarily unavailable (quota exceeded).']);
          return;
        }
        throw new Error(result.error || 'Failed to get AI suggestions');
      }
    } catch (error) {
      console.error('Error getting AI suggestions:', error);
      toast.error('Failed to get AI suggestions. Please try again later.');
      setAiSuggestions(['Sorry, AI suggestions are not available right now.']);
    } finally {
      setIsLoadingAI(false);
    }
  };

  // Apply AI suggestion
  const applyAISuggestion = (suggestion: string) => {
    setNewMessage(suggestion);
    setShowAISuggestions(false);
    setAiSuggestions([]);
    // Expand textarea on mobile when AI suggestion is applied
    if (isMobile && textareaRef.current) {
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
          textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 300)}px`;
        }
      }, 0);
    }
  };

  // Adjust textarea height when message changes or mobile focus state changes
  useEffect(() => {
    adjustTextareaHeight();
  }, [newMessage, isMobile, isInputFocused, selectedTemplate, aiSuggestions]);

  // Expand textarea on mobile when template or AI content is added
  useEffect(() => {
    if (isMobile && textareaRef.current && (selectedTemplate || aiSuggestions.length > 0 || newMessage.length > 100)) {
      setTimeout(() => {
        adjustTextareaHeight();
      }, 0);
    }
  }, [newMessage, selectedTemplate, aiSuggestions, isMobile]);

  // Handle click outside to reset input focus on mobile
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (isMobile && isInputFocused && textareaRef.current) {
        if (!target.closest('textarea') && !target.closest('form')) {
          setIsInputFocused(false);
          textareaRef.current.blur();
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMobile, isInputFocused]);

  return (
    <div className="fixed inset-0 bg-white z-[9999] overflow-hidden">
      <div className="h-full flex flex-col overflow-hidden" style={{ height: '100vh', maxHeight: '100vh' }}>
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
                  const locked = isLeadLocked(lead.last_message_at);

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
                        <div className="w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center flex-shrink-0 relative border bg-green-100 border-green-200 text-green-700 shadow-[0_4px_12px_rgba(16,185,129,0.2)] dark:bg-white/15 dark:border-white/30 dark:text-white dark:shadow-[0_4px_12px_rgba(0,0,0,0.35)]">
                          {lead.sender_name && lead.sender_name !== lead.phone_number && !lead.sender_name.match(/^\d+$/) ? (
                            <span className="font-semibold text-sm md:text-lg text-green-700 dark:text-white dark:drop-shadow">
                              {lead.sender_name.charAt(0).toUpperCase()}
                            </span>
                          ) : (
                            <PhoneIcon className="w-5 h-5 md:w-6 md:h-6 text-green-700 dark:text-white" />
                          )}
                          {/* Lock icon overlay */}
                          {locked && (
                            <div className="absolute -bottom-1 -right-1 bg-red-500 rounded-full p-1">
                              <LockClosedIcon className="w-3 h-3 text-white" />
                            </div>
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
                              {lead.unread_count && lead.unread_count > 0 && (
                                <span className="bg-cyan-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[16px] text-center shadow-[0_4px_12px_rgba(6,182,212,0.35)]">
                                  {lead.unread_count}
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
          <div className={`${isMobile ? 'w-full' : 'flex-1'} flex flex-col bg-white ${isMobile && !showChat ? 'hidden' : ''}`} style={isMobile ? { height: '100vh', overflow: 'hidden', position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40 } : {}}>
            {selectedLead ? (
              <>
                {/* Mobile Chat Header */}
                {isMobile && (
                  <div className="flex-none flex items-center gap-2 p-4 border-b border-gray-200 bg-white" style={{ zIndex: 40 }}>
                      <button
                        onClick={() => setShowChat(false)}
                      className="btn btn-ghost btn-circle btn-sm flex-shrink-0"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                          {selectedLead.sender_name && selectedLead.sender_name !== selectedLead.phone_number && !selectedLead.sender_name.match(/^\d+$/) ? (
                            <span className="text-green-600 font-semibold text-sm">
                              {selectedLead.sender_name.charAt(0).toUpperCase()}
                            </span>
                          ) : (
                            <PhoneIcon className="w-4 h-4 text-green-600" />
                          )}
                        </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-gray-900 text-sm truncate">
                            {selectedLead.sender_name && selectedLead.sender_name !== selectedLead.phone_number && !selectedLead.sender_name.match(/^\d+$/) 
                              ? selectedLead.sender_name 
                              : selectedLead.phone_number || 'Unknown Number'}
                          </h3>
                        <p className="text-xs text-gray-500 truncate">
                            {selectedLead.sender_name && selectedLead.sender_name !== selectedLead.phone_number && !selectedLead.sender_name.match(/^\d+$/) 
                              ? selectedLead.phone_number 
                              : ''}
                          </p>
                        <p className="text-xs text-gray-500 truncate">
                            {selectedLead.message_count} messages
                          </p>
                        </div>
                      </div>
                    {/* Timer/Lock Icon */}
                    {timeLeft && (
                      <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium flex-shrink-0 ${
                        isLocked ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {isLocked ? (
                          <>
                            <LockClosedIcon className="w-4 h-4" />
                            <span>Locked</span>
                          </>
                        ) : (
                          <>
                            <ClockIcon className="w-4 h-4" />
                            <span>{timeLeft}</span>
                          </>
                        )}
                    </div>
                    )}
                  </div>
                )}

                {/* Desktop Header */}
                {!isMobile && (
                  <div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b border-gray-200 bg-white">
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
                    <div className="flex items-center gap-2">
                      {/* Timer/Lock Icon */}
                      {timeLeft && (
                        <div className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm font-medium ${
                          isLocked ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {isLocked ? (
                            <>
                              <LockClosedIcon className="w-5 h-5" />
                              <span>Locked</span>
                            </>
                          ) : (
                            <>
                              <ClockIcon className="w-5 h-5" />
                              <span>{timeLeft}</span>
                            </>
                          )}
                        </div>
                      )}
                      {/* Action Dropdown */}
                      <div className="relative">
                        <button
                          className="btn btn-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowActionDropdown(!showActionDropdown);
                          }}
                        >
                          <UserPlusIcon className="w-4 h-4 mr-2" />
                          Actions
                          <ChevronDownIcon className="w-4 h-4 ml-2" />
                        </button>
                        {showActionDropdown && (
                          <>
                            {/* Backdrop to close on outside click */}
                            <div
                              className="fixed inset-0 z-40"
                              onClick={() => setShowActionDropdown(false)}
                            />
                            <ul
                              className="absolute right-0 top-full mt-2 menu p-2 shadow-lg bg-base-100 rounded-box w-64 z-50 border border-gray-200"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <li>
                                <button
                                  onClick={() => {
                                    setShowActionDropdown(false);
                                    handleConvertToLead(selectedLead);
                                  }}
                                  className="flex items-center gap-2 w-full text-left"
                                >
                                  <UserPlusIcon className="w-4 h-4" />
                                  <span>Convert to Lead</span>
                                </button>
                              </li>
                              <li>
                                <button
                                  onClick={() => {
                                    setShowActionDropdown(false);
                                    setActionType('sublead');
                                    setShowLeadSearchModal(true);
                                    setLeadSearchQuery('');
                                    setLeadSearchResults([]);
                                  }}
                                  className="flex items-center gap-2 w-full text-left"
                                >
                                  <UserGroupIcon className="w-4 h-4" />
                                  <span>Create a Sublead</span>
                                </button>
                              </li>
                              <li>
                                <button
                                  onClick={() => {
                                    setShowActionDropdown(false);
                                    setActionType('contact');
                                    setShowLeadSearchModal(true);
                                    setLeadSearchQuery('');
                                    setLeadSearchResults([]);
                                  }}
                                  className="flex items-center gap-2 w-full text-left"
                                >
                                  <LinkIcon className="w-4 h-4" />
                                  <span>Add as Contact to Lead</span>
                                </button>
                              </li>
                            </ul>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0 overscroll-contain" style={isMobile ? { flex: '1 1 auto', paddingBottom: showTemplateSelector ? '240px' : '120px', WebkitOverflowScrolling: 'touch' } : {}}>
                  {messages.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <ChatBubbleLeftRightIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p className="text-lg font-medium">No messages yet</p>
                      <p className="text-sm">Messages from this number will appear here</p>
                    </div>
                  ) : (
                    messages.map((message, index) => {
                      // Check if we need to show a date separator
                      const showDateSeparator = index === 0 || 
                        new Date(message.sent_at).toDateString() !== new Date(messages[index - 1].sent_at).toDateString();
                      
                      return (
                        <React.Fragment key={message.id || index}>
                          {/* Date Separator */}
                          {showDateSeparator && (
                            <div className="flex justify-center my-4">
                              <div className="bg-gray-100 text-gray-600 text-sm font-medium px-3 py-1.5 rounded-full">
                                {formatDateSeparator(message.sent_at)}
                              </div>
                            </div>
                          )}
                          
                          <div className={`flex flex-col ${message.direction === 'out' ? 'items-end' : 'items-start'}`}>
                        {message.direction === 'in' && (
                          <span className="text-sm text-gray-600 mb-1 ml-2 font-medium">
                            {message.sender_name}
                          </span>
                        )}
                        {message.direction === 'out' && (
                          <span className="text-sm text-gray-600 mb-1 mr-2 font-medium">
                            {message.sender_first_name || message.sender_name || 'You'}
                          </span>
                        )}
                        <div
                          className={`group max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-2 shadow-sm relative ${
                            message.direction === 'out'
                              ? 'bg-green-600 text-white'
                              : 'bg-white text-gray-900 border border-gray-200'
                          }`}
                        >
                          {/* Edit input or message content */}
                          {editingMessage === message.id ? (
                            <textarea
                              value={editMessageText}
                              onChange={(e) => {
                                setEditMessageText(e.target.value);
                                // Auto-resize the textarea
                                e.target.style.height = 'auto';
                                e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                              }}
                              className="w-full bg-transparent border-none outline-none resize-none overflow-y-auto text-white placeholder-white/70"
                              autoFocus
                              style={{ 
                                minHeight: '20px', 
                                maxHeight: '200px', 
                                wordWrap: 'break-word',
                                overflowWrap: 'break-word',
                                whiteSpace: 'pre-wrap'
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  handleEditMessage(message.id, editMessageText);
                                } else if (e.key === 'Escape') {
                                  setEditingMessage(null);
                                  setEditMessageText('');
                                }
                              }}
                            />
                          ) : (
                            <>
                              {/* Text message - only show if no media */}
                              {(!message.message_type || message.message_type === 'text') && !message.media_url && !message.message?.includes('.pdf') && (
                                <p 
                                  className="break-words whitespace-pre-wrap text-base"
                                  dir={message.message?.match(/[\u0590-\u05FF]/) ? 'rtl' : 'ltr'}
                                  style={{ textAlign: message.message?.match(/[\u0590-\u05FF]/) ? 'right' : 'left' }}
                                >
                                  {message.message}
                                </p>
                              )}
                              
                              {/* Button response */}
                              {message.message_type === 'button_response' && (
                                <div className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg border border-blue-200">
                                  <svg className="w-5 h-5 text-blue-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                                  </svg>
                                  <p className="text-sm font-medium text-blue-900">{message.message}</p>
                                </div>
                              )}
                              
                              {/* List response */}
                              {message.message_type === 'list_response' && (
                                <div className="flex items-center gap-2 p-2 bg-green-50 rounded-lg border border-green-200">
                                  <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                  </svg>
                                  <p className="text-sm font-medium text-green-900">{message.message}</p>
                                </div>
                              )}
                            </>
                          )}

                          {/* Image message */}
                          {message.message_type === 'image' && message.media_url && (
                            <div>
                              <img 
                                src={message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`)}
                                alt="Image"
                                className="max-w-full max-h-[400px] object-cover rounded-lg mb-2 cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => {
                                  if (message.media_url) {
                                    setSelectedMedia({
                                      url: message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`),
                                      type: 'image',
                                      caption: message.caption
                                    });
                                  }
                                }}
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                }}
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleDownloadMedia(message.media_url!, `image_${message.id}.jpg`)}
                                  className="btn btn-sm btn-ghost"
                                >
                                  <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                  </svg>
                                  Download
                                </button>
                                {message.caption && (
                                  <p 
                                    className="text-base break-words"
                                    dir={message.caption?.match(/[\u0590-\u05FF]/) ? 'rtl' : 'ltr'}
                                    style={{ textAlign: message.caption?.match(/[\u0590-\u05FF]/) ? 'right' : 'left' }}
                                  >
                                    {message.caption}
                                  </p>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Document message with WhatsApp-style design */}
                          {(message.message_type === 'document' || (message.message && message.message.includes('.pdf'))) && message.media_url && (
                            <div className="mb-2">
                              {/* WhatsApp-style document card */}
                              <div className="bg-white rounded-lg border border-gray-300 overflow-hidden shadow-sm">
                                {/* Document header */}
                                <div className="p-3 border-b border-gray-200 flex items-center gap-3 bg-gray-50">
                                  <div className="bg-blue-100 p-3 rounded-lg">
                                    {React.createElement(getDocumentIcon(message.media_mime_type), { className: "w-6 h-6 text-blue-600" })}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm truncate">
                                      {message.media_filename || message.message?.match(/[\w.-]+\.pdf/) || 'Document'}
                                    </p>
                                    {message.media_size && (
                                      <p className="text-xs text-gray-500">
                                        {(message.media_size / 1024).toFixed(1)} KB
                                      </p>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => handleDownloadMedia(message.media_url!, message.media_filename || message.message || 'document')}
                                    className="btn btn-ghost btn-sm p-2 hover:bg-gray-200"
                                    title="Download"
                                  >
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                  </button>
                                </div>
                                
                                {/* PDF Preview for PDF documents */}
                                {(message.media_mime_type === 'application/pdf' || message.message?.includes('.pdf')) && (
                                  <div className="p-2 bg-gray-100">
                                    <iframe
                                      src={`${message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`)}#toolbar=0&navpanes=0&scrollbar=0`}
                                      className="w-full h-80 md:h-96 border-0 rounded"
                                      title="PDF Preview"
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          <div className="flex items-center justify-between mt-1">
                            <div className="flex items-center gap-1 text-sm opacity-80">
                            <span>
                              {new Date(message.sent_at).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
                              {(message as any).is_edited && (
                                <span className="text-xs opacity-60 italic">
                                  (edited{(message as any).edited_by ? ` by ${userCache[(message as any).edited_by] || '...'}` : ''})
                                </span>
                              )}
                              {(message as any).is_deleted && (message as any).deleted_by && (
                                <span className="text-xs opacity-60 italic text-red-600">
                                  (deleted by {userCache[(message as any).deleted_by] || '...'})
                                </span>
                              )}
                          </div>
                            
                            {/* Edit/Delete buttons removed - WhatsApp API does not support these features */}
                        </div>
                      </div>
                      </div>
                      </React.Fragment>
                    );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input Area - Sticky with glassy blur on mobile */}
                <div 
                  className={`flex-none border-t transition-all duration-200 ${
                    isMobile 
                      ? 'bg-white/80 backdrop-blur-lg supports-[backdrop-filter]:bg-white/70 border-gray-300/50' 
                      : 'bg-white border-gray-200'
                  }`}
                  style={isMobile ? { zIndex: 50, position: 'sticky', bottom: 0, paddingBottom: `calc(30px + env(safe-area-inset-bottom))` } : {}}
                >
                  {/* Template Dropdown - Above input on mobile */}
                  {showTemplateSelector && isMobile && (
                    <div className="absolute bottom-full left-0 right-0 mb-2 p-4 bg-white rounded-t-xl border-t border-x border-gray-200 shadow-lg max-h-[50vh] overflow-y-auto">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-sm font-semibold text-gray-900">Select Template</div>
                        <button
                          type="button"
                          onClick={() => setShowTemplateSelector(false)}
                          className="btn btn-ghost btn-xs"
                        >
                          <XMarkIcon className="w-4 h-4" />
                        </button>
                      </div>
                      
                      <div className="mb-3">
                        <input
                          type="text"
                          placeholder="Search templates..."
                          value={templateSearchTerm}
                          onChange={(e) => setTemplateSearchTerm(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                        />
                      </div>
                      
                      <div className="space-y-3 max-h-[40vh] overflow-y-auto">
                        {isLoadingTemplates ? (
                          <div className="text-center text-gray-500 py-4">
                            <div className="loading loading-spinner loading-sm"></div>
                            <span className="ml-2">Loading...</span>
                          </div>
                        ) : filterTemplates(templates, templateSearchTerm).length === 0 ? (
                          <div className="text-center text-gray-500 py-4 text-sm">
                            {templateSearchTerm ? 'No templates found matching your search.' : 'No templates available.'}
                          </div>
                        ) : (
                          filterTemplates(templates, templateSearchTerm).map((template) => (
                            <TemplateOptionCard
                              key={template.id}
                              template={template}
                              isSelected={selectedTemplate?.id === template.id}
                              onClick={() => {
                                if (template.active !== 't') {
                                  toast.error('Template pending approval');
                                  return;
                                }
                                setSelectedTemplate(template);
                                setShowTemplateSelector(false);
                                setTemplateSearchTerm('');
                                if (template.params === '0') {
                                  setNewMessage(template.content || '');
                                  // Expand textarea on mobile when template is applied
                                  if (isMobile && textareaRef.current) {
                                    setTimeout(() => {
                                      if (textareaRef.current) {
                                        textareaRef.current.style.height = 'auto';
                                        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 300)}px`;
                                      }
                                    }, 0);
                                  }
                                } else {
                                  setNewMessage('');
                                }
                              }}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {/* Template Dropdown - Desktop */}
                  {!isMobile && showTemplateSelector && (
                    <div className="px-4 pt-3 pb-2">
                      <div className="p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                          <div className="text-sm font-semibold text-gray-900">Select Template</div>
                          <button
                            type="button"
                            onClick={() => setShowTemplateSelector(false)}
                            className="btn btn-ghost btn-xs"
                          >
                            <XMarkIcon className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="mb-3">
                          <input
                            type="text"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                            placeholder="Search templates..."
                            value={templateSearchTerm}
                            onChange={(e) => setTemplateSearchTerm(e.target.value)}
                          />
                        </div>
                        <div className="space-y-3 max-h-60 overflow-y-auto">
                          {isLoadingTemplates ? (
                            <div className="flex items-center justify-center py-2">
                              <div className="loading loading-spinner loading-sm"></div>
                              <span className="ml-2">Loading...</span>
                            </div>
                          ) : filterTemplates(templates, templateSearchTerm).length === 0 ? (
                            <div className="text-center text-gray-500 py-4 text-sm">
                              {templateSearchTerm ? 'No templates found matching your search.' : 'No templates available.'}
                            </div>
                          ) : (
                            filterTemplates(templates, templateSearchTerm).map((template) => (
                              <TemplateOptionCard
                                key={template.id}
                                template={template}
                                isSelected={selectedTemplate?.id === template.id}
                                onClick={() => {
                                  if (template.active !== 't') {
                                    toast.error('Template pending approval');
                                    return;
                                  }
                                  setSelectedTemplate(template);
                                  setShowTemplateSelector(false);
                                  setTemplateSearchTerm('');
                                  if (template.params === '0') {
                                    setNewMessage(template.content || '');
                                    // Expand textarea on mobile when template is applied
                                    if (isMobile && textareaRef.current) {
                                      setTimeout(() => {
                                        adjustTextareaHeight();
                                      }, 0);
                                    }
                                  } else {
                                    setNewMessage('');
                                  }
                                }}
                              />
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Lock Message - Desktop only */}
                  {!isMobile && isLocked && (
                    <div className="px-4 pb-2">
                      <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <LockClosedIcon className="w-5 h-5 text-red-600 flex-shrink-0" />
                        <div className="text-sm text-red-700">
                          <p className="font-medium">Messaging window expired</p>
                          <p className="text-xs text-red-600">More than 24 hours have passed since the client's last message.</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* AI Suggestions Dropdown */}
                  {showAISuggestions && (
                    <div className={`${isMobile ? 'absolute bottom-full left-0 right-0 mb-2 p-3 bg-white/95 backdrop-blur-lg supports-[backdrop-filter]:bg-white/85 rounded-t-xl border-t border-x border-gray-200 shadow-lg max-h-[50vh] overflow-y-auto' : 'px-4 pt-3 pb-2'}`}>
                      <div className={`${isMobile ? 'flex items-center justify-between mb-2' : 'p-3 bg-gray-50 rounded-lg border'}`}>
                        <div className="text-sm font-semibold text-gray-900">
                          {newMessage.trim() ? 'AI Message Improvement' : 'AI Suggestions'}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setShowAISuggestions(false);
                            setAiSuggestions([]);
                          }}
                          className="btn btn-ghost btn-xs"
                        >
                          <XMarkIcon className="w-4 h-4" />
                        </button>
                      </div>
                      
                      <div className="space-y-2">
                        {isLoadingAI ? (
                          <div className="text-center text-gray-500 py-4">
                            <div className="loading loading-spinner loading-sm"></div>
                            <span className="ml-2">Getting AI suggestions...</span>
                          </div>
                        ) : (
                          <div 
                            className="w-full p-4 rounded-lg border border-gray-200 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                            onClick={() => applyAISuggestion(aiSuggestions[0])}
                          >
                            <div className="text-sm text-gray-900">{aiSuggestions[0]}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Input Form */}
                  <form onSubmit={handleSendMessage} className={`flex items-center gap-2 ${isMobile ? 'p-3' : 'p-4'}`}>
                    {/* Template Icon Button - Hidden on mobile when input is focused */}
                    {(!isMobile || !isInputFocused) && (
                      <button
                        type="button"
                        onClick={() => setShowTemplateSelector(!showTemplateSelector)}
                        className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
                          selectedTemplate 
                            ? 'bg-green-500 text-white' 
                            : isMobile 
                              ? 'bg-white/80 backdrop-blur-md border border-gray-300/50 text-gray-600 hover:bg-gray-100'
                              : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-100'
                        } ${isMobile && isInputFocused ? 'opacity-0 pointer-events-none w-0' : 'opacity-100'}`}
                      >
                        <DocumentTextIcon className="w-5 h-5" />
                      </button>
                    )}

                    {/* Mobile Dropdown Button */}
                    {isMobile ? (
                      <div className="relative flex-shrink-0 mobile-dropdown-container">
                        <button
                          type="button"
                          onClick={() => setShowMobileDropdown(!showMobileDropdown)}
                          className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all bg-white/80 backdrop-blur-md border border-gray-300/50 text-gray-600 hover:bg-gray-100"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                          </svg>
                        </button>
                        
                        {/* Mobile Dropdown */}
                        {showMobileDropdown && (
                          <div className="absolute bottom-14 left-0 z-50 bg-white/95 backdrop-blur-lg supports-[backdrop-filter]:bg-white/85 rounded-lg border border-gray-200 shadow-lg p-2 min-w-[120px]">
                            {/* File upload option */}
                            <label className="flex items-center gap-2 p-2 rounded hover:bg-gray-100 cursor-pointer">
                              <PaperClipIcon className="w-4 h-4 text-gray-600" />
                              <span className="text-sm text-gray-700">Attachment</span>
                              <input
                                type="file"
                                className="hidden"
                                accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,audio/*,video/*"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    console.log('📁 File selected:', file);
                                    setSelectedFile(file);
                                  }
                                }}
                                disabled={uploadingMedia || isLocked}
                              />
                            </label>
                            
                            {/* Emoji option */}
                            <button
                              type="button"
                              onClick={() => {
                                setIsEmojiPickerOpen(!isEmojiPickerOpen);
                                setShowMobileDropdown(false);
                              }}
                              disabled={isLocked}
                              className="w-full flex items-center gap-2 p-2 rounded hover:bg-gray-100 text-left"
                            >
                              <FaceSmileIcon className="w-4 h-4 text-gray-600" />
                              <span className="text-sm text-gray-700">Emoji</span>
                            </button>
                            
                            {/* AI option */}
                            <button
                              type="button"
                              onClick={() => {
                                handleAISuggestions();
                                setShowMobileDropdown(false);
                              }}
                              disabled={isLoadingAI || isLocked || !selectedLead}
                              className="w-full flex items-center gap-2 p-2 rounded hover:bg-gray-100 text-left"
                            >
                              {isLoadingAI ? (
                                <div className="loading loading-spinner loading-xs"></div>
                              ) : (
                                <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                </svg>
                              )}
                              <span className="text-sm text-gray-700">AI</span>
                            </button>
                          </div>
                        )}
                        
                        {/* Mobile Emoji Picker */}
                        {isEmojiPickerOpen && !isLocked && (
                          <div className="absolute bottom-14 left-0 z-50 emoji-picker-container">
                            <EmojiPicker
                              onEmojiClick={handleEmojiClick}
                              width={window.innerWidth - 40}
                              height={400}
                              skinTonesDisabled={false}
                              searchDisabled={false}
                              previewConfig={{
                                showPreview: true,
                                defaultEmoji: '1f60a',
                                defaultCaption: 'Choose your emoji!'
                              }}
                              lazyLoadEmojis={false}
                            />
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        {/* Desktop File upload button */}
                        <label 
                          className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all bg-white border border-gray-300 text-gray-500 hover:bg-gray-100 cursor-pointer"
                          onClick={() => !isLocked && console.log('📁 File upload button clicked')}
                        >
                          <PaperClipIcon className="w-5 h-5" />
                          <input
                            type="file"
                            className="hidden"
                            accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,audio/*,video/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                console.log('📁 File selected:', file);
                                setSelectedFile(file);
                              }
                            }}
                            disabled={uploadingMedia || isLocked}
                          />
                        </label>

                        {/* Desktop Emoji Button */}
                        <div className="relative flex-shrink-0">
                          <button 
                            type="button" 
                            onClick={() => setIsEmojiPickerOpen(!isEmojiPickerOpen)}
                            className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all bg-white border border-gray-300 text-gray-500 hover:bg-gray-100"
                            disabled={isLocked}
                          >
                            <FaceSmileIcon className="w-5 h-5" />
                          </button>
                          
                          {/* Emoji Picker */}
                          {isEmojiPickerOpen && !isLocked && (
                            <div className="absolute bottom-14 left-0 z-50 emoji-picker-container">
                              <EmojiPicker
                                onEmojiClick={handleEmojiClick}
                                width={350}
                                height={400}
                                skinTonesDisabled={false}
                                searchDisabled={false}
                                previewConfig={{
                                  showPreview: true,
                                  defaultEmoji: '1f60a',
                                  defaultCaption: 'Choose your emoji!'
                                }}
                                lazyLoadEmojis={false}
                              />
                            </div>
                          )}
                        </div>

                        {/* Desktop AI Suggestions Button */}
                        <button
                          type="button"
                          onClick={handleAISuggestions}
                          disabled={isLoadingAI || isLocked || !selectedLead}
                          className={`flex-shrink-0 px-3 py-2 rounded-full flex items-center justify-center transition-all text-sm font-medium ${
                            isLoadingAI
                              ? 'bg-blue-500 text-white'
                              : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-100'
                          } ${isLocked || !selectedLead ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                          title={newMessage.trim() ? "Improve message with AI" : "Get AI suggestions"}
                        >
                          {isLoadingAI ? (
                            <div className="loading loading-spinner loading-sm"></div>
                          ) : (
                            'AI'
                          )}
                        </button>
                      </>
                    )}

                    {/* Selected file preview */}
                    {selectedFile && (
                      <div className="flex items-center gap-2 bg-gray-100/80 backdrop-blur-md rounded-lg px-3 py-1 border border-gray-300/50">
                        <span className="text-xs text-gray-700">{selectedFile.name}</span>
                        <button
                          type="button"
                          onClick={() => setSelectedFile(null)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <XMarkIcon className="w-4 h-4" />
                        </button>
                      </div>
                    )}

                    {/* Message Input */}
                    <textarea
                      ref={textareaRef}
                      value={newMessage}
                      onChange={handleMessageChange}
                      onFocus={(e) => {
                        if (isMobile) {
                          setIsInputFocused(true);
                          // Expand to max height when focused on mobile
                          adjustTextareaHeight();
                        }
                      }}
                      onBlur={(e) => {
                        if (isMobile) {
                          setIsInputFocused(false);
                          // Reset to normal height when blurred
                          adjustTextareaHeight();
                        }
                      }}
                      onKeyDown={(e) => {
                        // Let Enter create new lines
                      }}
                      placeholder={isLocked ? "Window expired - use templates" : "Type a reply..."}
                      className={`flex-1 resize-none rounded-2xl transition-all duration-300 ${
                        isMobile 
                          ? `bg-white/80 backdrop-blur-md border border-gray-300/50 ${isInputFocused ? 'flex-[1.2]' : ''}` 
                          : 'textarea textarea-bordered'
                      } ${isLocked ? 'bg-gray-100/80 cursor-not-allowed' : ''}`}
                      disabled={sending || isLocked}
                      rows={1}
                      style={{ 
                        maxHeight: isMobile && (isInputFocused || selectedTemplate || aiSuggestions.length > 0) ? '300px' : '250px', 
                        minHeight: '40px',
                        paddingTop: '12px', 
                        paddingBottom: '12px', 
                        paddingLeft: '16px', 
                        paddingRight: '16px',
                        direction: newMessage ? (newMessage.match(/[\u0590-\u05FF]/) ? 'rtl' : 'ltr') : 'ltr',
                        textAlign: newMessage ? (newMessage.match(/[\u0590-\u05FF]/) ? 'right' : 'left') : 'left',
                        fontSize: '15px',
                        transition: 'all 0.3s ease-in-out'
                      }}
                    />

                    {/* Send Button */}
                    {selectedFile ? (
                      <button
                        type="button"
                        onClick={handleSendMedia}
                        disabled={uploadingMedia}
                        className="flex-shrink-0 w-10 h-10 rounded-full bg-green-500 text-white flex items-center justify-center hover:bg-green-600 transition-colors disabled:opacity-50"
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
                        disabled={(!newMessage.trim() && !selectedTemplate) || sending}
                        className="flex-shrink-0 w-10 h-10 rounded-full bg-green-500 text-white flex items-center justify-center hover:bg-green-600 transition-colors disabled:opacity-50"
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
                      <div class="w-16 h-16 mx-auto mb-4 text-gray-400">Video Unavailable</div>
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

            {/* Footer Gallery - Show all images from conversation */}
            {selectedMedia.type === 'image' && (
              <div className="absolute bottom-0 left-0 right-0 px-4 pb-4 flex items-center justify-center">
                <div className="bg-black bg-opacity-60 rounded-lg p-2 flex gap-2 overflow-x-auto max-w-[90vw] scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
                  {messages.filter(m => m.message_type === 'image' && m.media_url).map((img) => {
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

      {/* Lead Search Modal */}
      {showLeadSearchModal && (
        <div className="fixed inset-0 z-[9999] bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                {actionType === 'sublead' ? 'Select Parent Lead for Sublead' : 'Select Lead to Add Contact'}
              </h3>
              <button
                onClick={() => {
                  setShowLeadSearchModal(false);
                  setLeadSearchQuery('');
                  setLeadSearchResults([]);
                  setActionType(null);
                }}
                className="btn btn-ghost btn-sm btn-circle"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Search Input */}
            <div className="p-4 border-b border-gray-200">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by lead number, name, or email..."
                  value={leadSearchQuery}
                  onChange={(e) => setLeadSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  autoFocus
                />
              </div>
            </div>

            {/* Search Results */}
            <div className="flex-1 overflow-y-auto p-4">
              {isSearchingLeads ? (
                <div className="flex items-center justify-center py-8">
                  <div className="loading loading-spinner loading-lg text-green-600"></div>
                </div>
              ) : leadSearchResults.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  {leadSearchQuery.length >= 2 ? (
                    <>
                      <p className="text-lg font-medium">No leads found</p>
                      <p className="text-sm">Try a different search term</p>
                    </>
                  ) : (
                    <>
                      <MagnifyingGlassIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p className="text-lg font-medium">Search for a lead</p>
                      <p className="text-sm">Enter at least 2 characters to search</p>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {leadSearchResults.map((lead) => (
                    <button
                      key={`${lead.id}-${lead.isLegacy}`}
                      onClick={() => {
                        if (actionType === 'sublead') {
                          handleCreateSublead(lead);
                        } else if (actionType === 'contact') {
                          handleAddAsContact(lead);
                        }
                      }}
                      className="w-full text-left p-4 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-green-300 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-gray-900">{lead.lead_number}</span>
                            {lead.isLegacy && (
                              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Legacy</span>
                            )}
                          </div>
                          <p className="text-sm font-medium text-gray-700 truncate">{lead.name || 'No name'}</p>
                          {lead.email && (
                            <p className="text-xs text-gray-500 truncate">{lead.email}</p>
                          )}
                          {(lead.phone || lead.mobile) && (
                            <p className="text-xs text-gray-500 truncate">{lead.phone || lead.mobile}</p>
                          )}
                        </div>
                        <div className="ml-4 flex-shrink-0">
                          {actionType === 'sublead' ? (
                            <UserGroupIcon className="w-5 h-5 text-green-600" />
                          ) : (
                            <LinkIcon className="w-5 h-5 text-green-600" />
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WhatsAppLeadsPage;
