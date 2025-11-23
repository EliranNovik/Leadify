import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, PaperAirplaneIcon, FaceSmileIcon, PaperClipIcon, ClockIcon, LockClosedIcon, DocumentTextIcon, DocumentIcon, PhotoIcon, FilmIcon, MusicalNoteIcon } from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import EmojiPicker from 'emoji-picker-react';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { buildApiUrl } from '../lib/api';
import { fetchWhatsAppTemplates, filterTemplates, type WhatsAppTemplate } from '../lib/whatsappTemplates';
import { fetchLeadContacts } from '../lib/contactHelpers';
import type { ContactInfo } from '../lib/contactHelpers';
import { format } from 'date-fns';

interface WhatsAppMessage {
  id: number;
  lead_id: string;
  sender_id?: string;
  sender_name: string;
  direction: 'in' | 'out';
  message: string;
  sent_at: string;
  status: string;
  message_type: 'text' | 'image' | 'document' | 'audio' | 'video' | 'location' | 'contact' | 'button_response' | 'list_response';
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

interface SchedulerWhatsAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  client?: {
    id: string;
    name: string;
    lead_number: string;
    phone?: string;
    mobile?: string;
    lead_type?: string;
  };
  selectedContact?: {
    contact: ContactInfo;
    leadId: string | number;
    leadType: 'legacy' | 'new';
  } | null;
  onClientUpdate?: () => Promise<void>;
  hideContactSelector?: boolean; // Hide contact selector dropdown
}

const SchedulerWhatsAppModal: React.FC<SchedulerWhatsAppModalProps> = ({ isOpen, onClose, client, selectedContact: propSelectedContact, onClientUpdate, hideContactSelector = false }) => {
  // Debug: Log when propSelectedContact changes
  useEffect(() => {
    if (isOpen) {
      console.log('🔍 SchedulerWhatsAppModal - propSelectedContact received:', {
        hasProp: !!propSelectedContact,
        contactId: propSelectedContact?.contact.id,
        contactName: propSelectedContact?.contact.name,
        contactPhone: propSelectedContact?.contact.phone || propSelectedContact?.contact.mobile,
        hideContactSelector
      });
    }
  }, [isOpen, propSelectedContact, hideContactSelector]);
  const [newMessage, setNewMessage] = useState('');
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  
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
  
  // 24-hour window state
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [isLocked, setIsLocked] = useState(false);
  
  // Auto-scroll state
  const [shouldAutoScroll, setShouldAutoScroll] = useState(false);
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  
  // State for lead contacts (all contacts associated with the client)
  const [leadContacts, setLeadContacts] = useState<ContactInfo[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);

  // Fetch current user
  useEffect(() => {
    const fetchCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        if (user.email.includes('@')) {
          const { data: userRow } = await supabase
            .from('users')
            .select('id, full_name, email')
            .eq('email', user.email)
            .single();
          
          if (userRow) {
            setCurrentUser(userRow);
            return;
          }
        }
        
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

  // If propSelectedContact is provided, use it directly
  useEffect(() => {
    console.log('🔍 propSelectedContact useEffect triggered:', {
      hasPropSelectedContact: !!propSelectedContact,
      contactId: propSelectedContact?.contact.id,
      contactName: propSelectedContact?.contact.name,
      isOpen
    });
    
    if (propSelectedContact) {
      console.log('📞 propSelectedContact set:', {
        contactId: propSelectedContact.contact.id,
        contactName: propSelectedContact.contact.name,
        contactPhone: propSelectedContact.contact.phone || propSelectedContact.contact.mobile,
        leadId: propSelectedContact.leadId,
        leadType: propSelectedContact.leadType
      });
      // IMPORTANT: Always use propSelectedContact when it's available, clear any previous selection
      setSelectedContactId(propSelectedContact.contact.id);
      setLeadContacts([propSelectedContact.contact]);
      // Clear messages when contact changes to force refetch
      setMessages([]);
    } else if (isOpen && hideContactSelector) {
      // If modal is open with hideContactSelector but no propSelectedContact, 
      // it means we're waiting for it - don't clear selectedContactId yet
      console.log('⏳ Waiting for propSelectedContact to be set...');
    } else if (!isOpen) {
      // Only clear if modal is closed
      setSelectedContactId(null);
    }
  }, [propSelectedContact, isOpen, hideContactSelector]);

  // Fetch contacts for the client (only if no propSelectedContact)
  useEffect(() => {
    if (propSelectedContact) return; // Skip if we have a prop contact
    
    const fetchContactsForClient = async () => {
      if (!client) {
        setLeadContacts([]);
        setSelectedContactId(null);
        return;
      }

      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      const leadId = isLegacyLead 
        ? (typeof client.id === 'string' ? client.id.replace('legacy_', '') : String(client.id))
        : client.id;

      const contacts = await fetchLeadContacts(leadId, isLegacyLead);
      setLeadContacts(contacts);
      
      // If there are contacts, select the main contact by default, or the first one
      if (contacts.length > 0) {
        const mainContact = contacts.find(c => c.isMain) || contacts[0];
        setSelectedContactId(mainContact.id);
      } else {
        setSelectedContactId(null);
      }
    };

    if (client) {
      fetchContactsForClient();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, propSelectedContact]);

  // Fetch WhatsApp templates
  useEffect(() => {
    const loadTemplates = async () => {
      try {
        setIsLoadingTemplates(true);
        const fetchedTemplates = await fetchWhatsAppTemplates();
        setTemplates(fetchedTemplates);
      } catch (error) {
        console.error('Error loading templates:', error);
      } finally {
        setIsLoadingTemplates(false);
      }
    };
    
    if (isOpen) {
      loadTemplates();
    }
  }, [isOpen]);

  // Process template messages for display
  const processTemplateMessage = (message: WhatsAppMessage): WhatsAppMessage => {
    if (message.direction === 'out' && message.message) {
      const isAlreadyProperlyFormatted = templates.some(template => 
        template.content && message.message === template.content
      );
      
      if (isAlreadyProperlyFormatted) {
        return message;
      }
      
      const needsProcessing = 
        message.message.includes('Template:') ||
        message.message.includes('[Template:') ||
        message.message.includes('[template:]') ||
        message.message.includes('template:') ||
        message.message.includes('TEMPLATE_MARKER:') ||
        message.message === '' ||
        message.message === 'Template sent';

      if (needsProcessing) {
        const templateMatch = message.message.match(/\[Template:\s*([^\]]+)\]/) || 
                              message.message.match(/Template:\s*(.+)/);
        if (templateMatch) {
          let templateTitle = templateMatch[1].trim().replace(/\]$/, '');
          const template = templates.find(t => 
            t.title.toLowerCase() === templateTitle.toLowerCase() ||
            (t.name360 && t.name360.toLowerCase() === templateTitle.toLowerCase())
          );
          
          if (template) {
            if (template.params === '0' && template.content) {
              return { ...message, message: template.content };
            } else if (template.params === '1') {
              return { ...message, message: template.content || `Template: ${template.title}` };
            }
          }
        }
        
        const templateMarkerMatch = message.message.match(/TEMPLATE_MARKER:(.+)/);
        if (templateMarkerMatch) {
          const templateTitle = templateMarkerMatch[1];
          const template = templates.find(t => t.title === templateTitle);
          if (template) {
            if (template.params === '0' && template.content) {
              return { ...message, message: template.content };
            } else if (template.params === '1') {
              return { ...message, message: template.content || `Template: ${template.title}` };
            }
          }
        }
        
        if (message.message === '' || message.message === 'Template sent') {
          return { ...message, message: 'Template message sent' };
        }
      }
    }
    return message;
  };

  // Helper functions
  const isEmojiOnly = (text: string): boolean => {
    const cleanText = text.trim();
    if (cleanText.length === 0) return false;
    const hasNonAscii = /[^\x00-\x7F]/.test(cleanText);
    const isShort = cleanText.length <= 5;
    return hasNonAscii && isShort;
  };

  const getDocumentIcon = (mimeType?: string) => {
    if (!mimeType) return DocumentTextIcon;
    if (mimeType.includes('pdf')) return DocumentTextIcon;
    if (mimeType.includes('word') || mimeType.includes('document')) return DocumentIcon;
    if (mimeType.includes('image/')) return PhotoIcon;
    if (mimeType.includes('video/')) return FilmIcon;
    if (mimeType.includes('audio/')) return MusicalNoteIcon;
    return DocumentTextIcon;
  };

  const renderMessageStatus = (status?: string) => {
    if (!status) return null;
    
    const baseClasses = "w-4 h-4";
    
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
          <svg className={`${baseClasses} text-blue-500`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l4 4L11 8" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l4 4L17 8" />
          </svg>
        );
      default:
        return null;
    }
  };

  const formatDateSeparator = (timestamp: string) => {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    }
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    const diffTime = today.getTime() - date.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 7) {
      return date.toLocaleDateString('en-US', { weekday: 'long' });
    }
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

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

  const isClientLocked = (lastMessageTime: string) => {
    const lastMessage = new Date(lastMessageTime);
    const now = new Date();
    const diffMs = now.getTime() - lastMessage.getTime();
    const hoursPassed = diffMs / (1000 * 60 * 60);
    return hoursPassed > 24;
  };

  // Fetch messages
  useEffect(() => {
    const fetchMessages = async (isPolling = false) => {
      if (!client?.id || !isOpen) {
        setMessages([]);
        return;
      }

      // If hideContactSelector is true and we're expecting a propSelectedContact but don't have it yet, wait
      // This prevents fetching messages with client's phone when a contact should be selected
      if (hideContactSelector && !propSelectedContact && !selectedContactId && !isPolling) {
        console.log('⏳ Waiting for propSelectedContact to be set...', {
          hideContactSelector,
          hasPropSelectedContact: !!propSelectedContact,
          selectedContactId
        });
        return;
      }

      try {
        // CRITICAL: If hideContactSelector is true, we MUST use propSelectedContact
        // Don't fall back to selectedContactId or leadContacts if propSelectedContact is not available yet
        if (hideContactSelector && !propSelectedContact && !isPolling) {
          console.log('⏳ Waiting for propSelectedContact (hideContactSelector=true)...');
          return;
        }
        
        // ALWAYS prioritize propSelectedContact if it's provided (from contact selector)
        // This ensures we use the correct contact even if state hasn't updated yet
        const selectedContact = propSelectedContact?.contact || (selectedContactId ? leadContacts.find(c => c.id === selectedContactId) : null);
        const contactId = propSelectedContact?.contact.id || selectedContactId || null;
        
        console.log('🔍 fetchMessages called:', {
          isOpen,
          clientId: client?.id,
          contactId,
          hasPropSelectedContact: !!propSelectedContact,
          propSelectedContactId: propSelectedContact?.contact.id,
          propSelectedContactName: propSelectedContact?.contact.name,
          propSelectedContactPhone: propSelectedContact?.contact.phone || propSelectedContact?.contact.mobile,
          selectedContactId,
          hasSelectedContact: !!selectedContact,
          selectedContactName: selectedContact?.name,
          selectedContactPhone: selectedContact?.phone || selectedContact?.mobile,
          leadContactsCount: leadContacts.length
        });
        
        const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
        let query = supabase.from('whatsapp_messages').select('*');
        
        // If we have a selected contact (from propSelectedContact or selectedContactId), filter by contact's phone number
        // IMPORTANT: If propSelectedContact is provided, we MUST use it and not fall back to client
        if (selectedContact) {
          const contactPhone = selectedContact.phone || selectedContact.mobile;
          console.log('🔄 Fetching WhatsApp messages for contact:', {
            contactId: selectedContact.id,
            contactName: selectedContact.name,
            contactPhone: contactPhone,
            clientPhone: client?.phone || client?.mobile,
            isFromProp: !!propSelectedContact,
            hideContactSelector
          });
          
          if (!contactPhone) {
            console.error('❌ Selected contact has no phone number!', selectedContact);
            toast.error(`Contact ${selectedContact.name} has no phone number. Cannot load WhatsApp conversation.`);
            setMessages([]);
            return;
          }
          
          if (contactPhone) {
            // Normalize phone numbers for comparison (remove spaces, dashes, etc.)
            const normalizePhone = (phone: string) => phone.replace(/\D/g, '');
            const normalizedContactPhone = normalizePhone(contactPhone);
            
            // Fetch all messages for this lead, then filter by phone number
            if (isLegacyLead) {
              const legacyId = parseInt(client.id.replace('legacy_', ''));
              query = query.eq('legacy_id', legacyId);
            } else {
              query = query.eq('lead_id', client.id);
            }
            
            const { data: allMessages, error: allError } = await query.order('sent_at', { ascending: true });
            
            if (!allError && allMessages) {
              // Filter messages by:
              // 1. contact_id matches (if set)
              // 2. phone_number matches (normalized comparison)
              const filteredMessages = allMessages.filter(msg => {
                // First priority: exact contact_id match
                if (contactId && msg.contact_id === contactId) {
                  return true;
                }
                
                // Second priority: phone number match (normalized)
                if (msg.phone_number) {
                  const normalizedMsgPhone = normalizePhone(msg.phone_number);
                  // Try full match first
                  if (normalizedMsgPhone === normalizedContactPhone) {
                    return true;
                  }
                  // Fallback: last 4 digits match (for cases with country codes)
                  if (normalizedContactPhone.length >= 4 && normalizedMsgPhone.length >= 4) {
                    const contactLast4 = normalizedContactPhone.slice(-4);
                    const msgLast4 = normalizedMsgPhone.slice(-4);
                    if (contactLast4 === msgLast4) {
                      return true;
                    }
                  }
                }
                
                return false;
              });
              
              console.log(`📱 Filtered ${filteredMessages.length} messages from ${allMessages.length} total for contact ${selectedContact.name} (phone: ${contactPhone})`);
              
              const processedMessages = filteredMessages.map(processTemplateMessage);
              if (!isPolling) {
                setMessages(processedMessages);
              } else {
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
                    return processedMessages;
                  }
                  return prevMessages;
                });
              }
              return;
            }
          } else {
            console.warn('⚠️ Selected contact has no phone number:', selectedContact);
          }
        }
        
        // Fallback: if no contact selected or contact has no phone, filter by lead_id/legacy_id only
        // This shows all messages for the lead (client's phone number)
        console.warn('⚠️ No selected contact or contact has no phone, falling back to lead messages', {
          hasSelectedContact: !!selectedContact,
          hasPropSelectedContact: !!propSelectedContact,
          selectedContactId,
          contactId
        });
        if (isLegacyLead) {
          const legacyId = parseInt(client.id.replace('legacy_', ''));
          query = query.eq('legacy_id', legacyId);
        } else {
          query = query.eq('lead_id', client.id);
        }
        
        const { data, error } = await query.order('sent_at', { ascending: true });

        if (error) {
          console.error('Error fetching messages:', error);
          return;
        }

        const processedMessages = (data || []).map(processTemplateMessage);
        
        if (!isPolling) {
          setMessages(processedMessages);
        } else {
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
              return processedMessages;
            }
            return prevMessages;
          });
        }
        
        // Mark incoming messages as read
        if (currentUser && data && data.length > 0 && !isPolling) {
          const incomingMessageIds = data
            .filter(msg => msg.direction === 'in' && (!(msg as any).is_read || (msg as any).is_read === false))
            .map(msg => msg.id);
          
          if (incomingMessageIds.length > 0) {
            try {
              await supabase
                .from('whatsapp_messages')
                .update({ 
                  is_read: true, 
                  read_at: new Date().toISOString(),
                  read_by: currentUser.id 
                })
                .in('id', incomingMessageIds);
            } catch (error) {
              console.error('Error marking messages as read:', error);
            }
          }
        }
        
        // Auto-scroll on first load
        if (!isPolling && isFirstLoad && shouldAutoScroll) {
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            setShouldAutoScroll(false);
            setIsFirstLoad(false);
          }, 200);
        }
      } catch (error) {
        console.error('Error fetching messages:', error);
      }
    };

    if (isOpen) {
      // If hideContactSelector is true, we expect propSelectedContact to be set
      // Wait a bit longer to ensure it's available before fetching
      const delay = hideContactSelector ? 200 : 100;
      const timeoutId = setTimeout(() => {
        fetchMessages(false);
      }, delay);
      const interval = setInterval(() => fetchMessages(true), 5000);
      return () => {
        clearTimeout(timeoutId);
        clearInterval(interval);
      };
    }
  }, [isOpen, client?.id, currentUser, shouldAutoScroll, isFirstLoad, templates, selectedContactId, propSelectedContact, hideContactSelector]);

  // Refetch messages when propSelectedContact changes (especially when it goes from null to a value)
  useEffect(() => {
    if (isOpen && propSelectedContact && client?.id) {
      console.log('🔄 propSelectedContact changed, refetching messages for contact:', propSelectedContact.contact.name);
      // Clear messages first to show loading state
      setMessages([]);
      // Refetch after a short delay to ensure state is updated
      const timeoutId = setTimeout(() => {
        // Trigger refetch by calling fetchMessages
        // We'll use a flag to force a fresh fetch
        setShouldAutoScroll(true);
        setIsFirstLoad(true);
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [propSelectedContact?.contact.id, isOpen, client?.id]);

  // Update timer for 24-hour window
  useEffect(() => {
    if (!client || !isOpen) {
      setTimeLeft('');
      setIsLocked(false);
      return;
    }

    // Lock input if there are no messages
    if (messages.length === 0) {
      setTimeLeft('');
      setIsLocked(true);
      return;
    }

    const lastIncomingMessage = messages
      .filter(msg => msg.direction === 'in')
      .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime())[0];

    if (lastIncomingMessage) {
      calculateTimeLeft(lastIncomingMessage.sent_at);
      
      const interval = setInterval(() => {
        calculateTimeLeft(lastIncomingMessage.sent_at);
      }, 60000);
      
      return () => clearInterval(interval);
    } else {
      // No incoming messages, but there are outgoing messages - still lock
      setTimeLeft('');
      setIsLocked(true);
    }
  }, [client, messages, isOpen]);

  // Auto-scroll when messages change
  useEffect(() => {
    if (shouldAutoScroll && messages.length > 0) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        setShouldAutoScroll(false);
      }, 100);
    }
  }, [messages, shouldAutoScroll]);

  // Auto-scroll to bottom when modal opens
  useEffect(() => {
    if (isOpen && messages.length > 0) {
      // Use multiple timeouts to ensure the DOM is ready and messages are rendered
      const scrollToBottom = () => {
        if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        } else {
          // Fallback: scroll the messages container directly
          const messagesContainer = document.querySelector('.overflow-y-auto');
          if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
          }
        }
      };
      
      // Try immediately
      setTimeout(scrollToBottom, 100);
      // Try again after a short delay to ensure rendering is complete
      setTimeout(scrollToBottom, 300);
      // Try once more after messages are fully loaded
      setTimeout(scrollToBottom, 500);
    }
  }, [isOpen, messages.length]);

  // Handle click outside for emoji picker
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (isEmojiPickerOpen) {
        if (!target.closest('.emoji-picker-container') && !target.closest('button[type="button"]')) {
          setIsEmojiPickerOpen(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isEmojiPickerOpen]);

  // Send message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if ((!newMessage.trim() && !selectedTemplate) || !client || !currentUser) {
      return;
    }

    setSending(true);
    
    // Get phone number from selected contact or client
    let phoneNumber: string | null = null;
    let contactId: number | null = null;
    
    // Use propSelectedContact if available, otherwise use selectedContactId
    const activeContactId = propSelectedContact?.contact.id || selectedContactId;
    
    if (activeContactId) {
      const selectedContact = propSelectedContact?.contact || leadContacts.find(c => c.id === activeContactId);
      if (selectedContact) {
        phoneNumber = selectedContact.phone || selectedContact.mobile || null;
        contactId = selectedContact.id;
      }
    }
    
    // Fallback to client's phone number
    if (!phoneNumber) {
      phoneNumber = client.phone || client.mobile || null;
    }
    
    if (!phoneNumber) {
      toast.error('No phone number found for this contact');
      setSending(false);
      return;
    }

    const senderName = currentUser.full_name || currentUser.email;
    
    try {
      const messagePayload: any = {
        leadId: client.id,
        phoneNumber: phoneNumber,
        sender_name: senderName,
        contactId: contactId || null
      };

      if (selectedTemplate) {
        messagePayload.isTemplate = true;
        messagePayload.templateName = selectedTemplate.name360;
        messagePayload.templateLanguage = selectedTemplate.language || 'en_US';
        
        if (selectedTemplate.params === '1') {
          messagePayload.templateParameters = [
            {
              type: 'text',
              text: newMessage.trim() || 'Hello'
            }
          ];
          messagePayload.message = newMessage.trim() || 'Template sent';
        } else if (selectedTemplate.params === '0') {
          messagePayload.message = `TEMPLATE_MARKER:${selectedTemplate.title}`;
        }
      } else {
        if (!newMessage.trim()) {
          throw new Error('Message is required for non-template messages');
        }
        messagePayload.message = newMessage.trim();
      }

      const response = await fetch(buildApiUrl('/api/whatsapp/send-message'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messagePayload),
      });

      const result = await response.json();

      if (!response.ok) {
        if (result.code === 'RE_ENGAGEMENT_REQUIRED') {
          throw new Error('⚠️ WhatsApp 24-Hour Rule: You can only send template messages after 24 hours of customer inactivity.');
        }
        throw new Error(result.error || 'Failed to send message');
      }

      let displayMessage = newMessage.trim();
      if (selectedTemplate) {
        if (selectedTemplate.params === '0' && selectedTemplate.content) {
          displayMessage = selectedTemplate.content;
        } else if (selectedTemplate.params === '1' && newMessage.trim()) {
          displayMessage = newMessage.trim();
        } else if (selectedTemplate.params === '1' && !newMessage.trim()) {
          displayMessage = `Template: ${selectedTemplate.title}`;
        }
      }
      
      const newMsg: WhatsAppMessage = {
        id: Date.now(),
        lead_id: client.id,
        sender_id: currentUser.id,
        sender_name: senderName,
        direction: 'out',
        message: displayMessage,
        sent_at: new Date().toISOString(),
        status: 'sent',
        message_type: 'text',
        whatsapp_status: 'sent',
        whatsapp_message_id: result.messageId
      };

      setMessages(prev => [...prev, newMsg]);
      setShouldAutoScroll(true);
      setNewMessage('');
      setSelectedTemplate(null);
      
      if (onClientUpdate) {
        await onClientUpdate();
      }
      
      toast.success('Message sent via WhatsApp!');
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Failed to send message: ' + (error as Error).message);
    } finally {
      setSending(false);
    }
  };

  // Send media
  const handleSendMedia = async () => {
    if (!selectedFile || !client || !currentUser) {
      return;
    }

    setUploadingMedia(true);
    try {
      const phoneNumber = client.phone || client.mobile;
      if (!phoneNumber) {
        toast.error('No phone number found for this client');
        return;
      }

      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('leadId', client.id);

      const uploadResponse = await fetch(buildApiUrl('/api/whatsapp/upload-media'), {
        method: 'POST',
        body: formData,
      });

      const uploadResult = await uploadResponse.json();

      if (!uploadResponse.ok) {
        throw new Error(uploadResult.error || 'Failed to upload media');
      }

      const mediaType = selectedFile.type.startsWith('image/') ? 'image' : 'document';
      const senderName = currentUser.full_name || currentUser.email;
      const response = await fetch(buildApiUrl('/api/whatsapp/send-media'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          leadId: client.id,
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

      const newMsg: WhatsAppMessage = {
        id: Date.now(),
        lead_id: client.id,
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
      setShouldAutoScroll(true);
      setNewMessage('');
      setSelectedFile(null);
      
      if (onClientUpdate) {
        await onClientUpdate();
      }
      
      toast.success('Media sent via WhatsApp!');
    } catch (error) {
      console.error('Error sending media:', error);
      toast.error('Failed to send media: ' + (error as Error).message);
    } finally {
      setUploadingMedia(false);
    }
  };

  // AI suggestions
  const handleAISuggestions = async () => {
    if (!client || isLoadingAI) return;

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
          clientName: client.name,
          requestType
        }),
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success) {
        const suggestion = result.suggestion.trim();
        setAiSuggestions([suggestion]);
      } else {
        if (result.code === 'OPENAI_QUOTA') {
          toast.error('AI quota exceeded. Please try again later.');
          setAiSuggestions(['Sorry, AI is temporarily unavailable.']);
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

  const applyAISuggestion = (suggestion: string) => {
    setNewMessage(suggestion);
    setShowAISuggestions(false);
    setAiSuggestions([]);
  };

  // Handlers
  const handleEmojiClick = (emojiObject: any) => {
    const emoji = emojiObject.emoji;
    setNewMessage(prev => prev + emoji);
    setIsEmojiPickerOpen(false);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  if (!isOpen) return null;

  // Get the active contact (prioritize propSelectedContact, then use selectedContactId + leadContacts)
  const activeContact = propSelectedContact?.contact || (selectedContactId ? leadContacts.find(c => c.id === selectedContactId) : null);
  const displayName = activeContact?.name || client?.name || 'Unknown';
  const displayPhone = activeContact?.phone || activeContact?.mobile || client?.phone || client?.mobile || '';

  const lastIncomingMessage = messages
    .filter(msg => msg.direction === 'in')
    .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime())[0];
  const clientLocked = lastIncomingMessage ? isClientLocked(lastIncomingMessage.sent_at) : false;

  return createPortal(
    <div className="fixed inset-0 bg-white z-[9999] overflow-hidden">
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex-none flex items-center justify-between p-4 md:p-6 border-b border-gray-200">
          <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
            <FaWhatsapp className="w-6 h-6 md:w-8 md:h-8 text-green-600 flex-shrink-0" />
            <h2 className="text-lg md:text-2xl font-bold text-gray-900">WhatsApp</h2>
            {client && (
              <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse flex-shrink-0"></div>
                {clientLocked && (
                  <div className="absolute -top-1 -right-1 bg-red-500 rounded-full p-0.5">
                    <LockClosedIcon className="w-2 h-2 text-white" />
                  </div>
                )}
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm md:text-lg font-semibold text-gray-900 truncate">
                    {displayName}
                  </span>
                  {activeContact && (
                    <span className="text-xs text-gray-500 px-2 py-0.5 bg-blue-100 rounded-full">
                      Contact
                    </span>
                  )}
                  <span className="text-xs md:text-sm text-gray-500 font-mono flex-shrink-0">
                    ({client.lead_number})
                  </span>
                </div>
                {timeLeft && (
                  <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
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
          </div>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-circle flex-shrink-0"
          >
            <XMarkIcon className="w-5 h-5 md:w-6 md:h-6" />
          </button>
        </div>

        {/* Messages - Scrollable */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0 overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
          {messages.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <FaWhatsapp className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p className="text-lg font-medium">No messages yet</p>
              <p className="text-sm">Start the conversation with {client?.name}</p>
            </div>
          ) : (
            messages.map((message, index) => {
              const showDateSeparator = index === 0 || 
                new Date(message.sent_at).toDateString() !== new Date(messages[index - 1].sent_at).toDateString();
              
              return (
                <React.Fragment key={message.id || index}>
                  {showDateSeparator && (
                    <div className="flex justify-center my-4">
                      <div className="bg-gray-100 text-gray-600 text-sm font-medium px-3 py-1.5 rounded-full">
                        {formatDateSeparator(message.sent_at)}
                      </div>
                    </div>
                  )}
                  
                  <div className={`flex flex-col ${message.direction === 'out' ? 'items-end' : 'items-start'}`}>
                    {message.direction === 'out' && (
                      <span className="text-sm text-gray-600 mb-1 mr-2 font-medium">
                        {message.sender_name}
                      </span>
                    )}
                    {message.direction === 'in' && (
                      <span className="text-sm text-gray-600 mb-1 ml-2 font-medium">
                        {message.sender_name}
                      </span>
                    )}
                    <div
                      className={`group max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-2 shadow-sm ${
                        message.direction === 'out'
                          ? isEmojiOnly(message.message)
                            ? 'bg-white text-gray-900'
                            : 'bg-green-600 text-white'
                          : 'bg-white text-gray-900 border border-gray-200'
                      }`}
                    >
                      {message.message_type === 'text' && (
                        <p 
                          className={`break-words whitespace-pre-wrap ${
                            isEmojiOnly(message.message) ? 'text-6xl leading-tight' : 'text-base'
                          }`}
                          dir={message.message?.match(/[\u0590-\u05FF]/) ? 'rtl' : 'ltr'}
                          style={{ textAlign: message.message?.match(/[\u0590-\u05FF]/) ? 'right' : 'left' }}
                        >
                          {message.message}
                        </p>
                      )}
                      
                      {message.message_type === 'image' && message.media_url && (
                        <div>
                          <img 
                            src={message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`)}
                            alt="Image"
                            className="max-w-full md:max-w-[700px] max-h-[300px] md:max-h-[600px] object-cover rounded-lg mb-2 shadow-sm"
                            onError={(e) => {
                              e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik01MCAxMDAgTDEwMCA1MCBMMTUwIDEwMCBMMTAwIDE1MCBMNTAgMTAwWiIgZmlsbD0iI0QxRDVEMCIvPgo8dGV4dCB4PSIxMDAiIHk9IjExMCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE0IiBmaWxsPSIjNjc3NDhCIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5JbWFnZSBVbmF2YWlsYWJsZTwvdGV4dD4KPC9zdmc+';
                            }}
                          />
                          {message.caption && (
                            <p className="text-base break-words">{message.caption}</p>
                          )}
                        </div>
                      )}
                      
                      {message.message_type === 'document' && (
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
                        </div>
                      )}
                      
                      {message.message_type === 'video' && message.media_url && (
                        <video 
                          controls
                          className="max-w-full md:max-w-[700px] max-h-[300px] md:max-h-[600px] object-cover rounded-lg mb-2 shadow-sm"
                        >
                          <source src={message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`)} />
                          Your browser does not support the video tag.
                        </video>
                      )}
                      
                      {message.message_type === 'audio' && message.media_url && (
                        <audio
                          controls
                          className="w-full"
                        >
                          <source src={message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`)} />
                          Your browser does not support the audio tag.
                        </audio>
                      )}

                      {/* Message status and time */}
                      <div className="flex items-center justify-between mt-1">
                        <div className="flex items-center gap-1 text-sm opacity-80">
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
                  </div>
                </React.Fragment>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="flex-none border-t border-gray-200 bg-white" style={{ position: 'sticky', bottom: 0, zIndex: 10 }}>
          {/* Lock Message */}
          {isLocked && (
            <div className="px-4 pb-2 pt-2">
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <LockClosedIcon className="w-5 h-5 text-red-600 flex-shrink-0" />
                <div className="text-sm text-red-700">
                  <p className="font-medium">Messaging window expired</p>
                  <p className="text-xs text-red-600">More than 24 hours have passed. You can only send template messages.</p>
                </div>
              </div>
            </div>
          )}

          {/* Template Dropdown */}
          {showTemplateSelector && (
            <div className="px-4 pt-3 pb-2">
              <div className="p-3 bg-gray-50 rounded-lg border">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium">Select Template:</div>
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
                
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {isLoadingTemplates ? (
                    <div className="text-center text-gray-500 py-4">
                      <div className="loading loading-spinner loading-sm"></div>
                      <span className="ml-2">Loading templates...</span>
                    </div>
                  ) : (
                    filterTemplates(templates, templateSearchTerm).map((template) => (
                      <button
                        key={template.id}
                        type="button"
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
                          } else {
                            setNewMessage('');
                          }
                        }}
                        className={`block w-full text-left p-3 rounded border ${
                          selectedTemplate?.id === template.id 
                            ? 'bg-green-50 border-green-300' 
                            : 'bg-white border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-gray-900">{template.title}</div>
                          {template.active === 't' ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                              Pending
                            </span>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* AI Suggestions Dropdown */}
          {showAISuggestions && (
            <div className="px-4 pt-3 pb-2">
              <div className="p-3 bg-gray-50 rounded-lg border">
                <div className="flex items-center justify-between mb-2">
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
            </div>
          )}

          {/* Input Area */}
          <form onSubmit={handleSendMessage} className="flex items-center gap-2 p-4">
            {/* Template Icon Button */}
            <button
              type="button"
              onClick={() => setShowTemplateSelector(!showTemplateSelector)}
              className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                selectedTemplate 
                  ? 'bg-green-500 text-white' 
                  : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-100'
              }`}
            >
              <DocumentTextIcon className="w-5 h-5" />
            </button>

            {/* File upload button */}
            <label 
              className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all bg-white border border-gray-300 text-gray-500 hover:bg-gray-100 cursor-pointer"
            >
              <PaperClipIcon className="w-5 h-5" />
              <input
                type="file"
                className="hidden"
                accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,audio/*,video/*"
                onChange={handleFileSelect}
                disabled={uploadingMedia || (isLocked && !selectedTemplate)}
              />
            </label>

            {/* Emoji Button */}
            <div className="relative flex-shrink-0">
              <button 
                type="button" 
                onClick={() => setIsEmojiPickerOpen(!isEmojiPickerOpen)}
                className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all bg-white border border-gray-300 text-gray-500 hover:bg-gray-100"
                disabled={isLocked && !selectedTemplate}
              >
                <FaceSmileIcon className="w-5 h-5" />
              </button>
              
              {isEmojiPickerOpen && (!isLocked || selectedTemplate) && (
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

            {/* AI Suggestions Button */}
            <button
              type="button"
              onClick={handleAISuggestions}
              disabled={isLoadingAI || (isLocked && !selectedTemplate) || !client}
              className={`flex-shrink-0 px-3 py-2 rounded-full flex items-center justify-center transition-all text-sm font-medium ${
                isLoadingAI
                  ? 'bg-blue-500 text-white'
                  : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-100'
              } ${(isLocked && !selectedTemplate) || !client ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
              title={newMessage.trim() ? "Improve message with AI" : "Get AI suggestions"}
            >
              {isLoadingAI ? (
                <div className="loading loading-spinner loading-sm"></div>
              ) : (
                'AI'
              )}
            </button>

            {/* Selected file preview */}
            {selectedFile && (
              <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-1 border border-gray-300">
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

            {/* Contact Selector - Show if multiple contacts, no pre-selected contact, and not hidden */}
            {!hideContactSelector && !propSelectedContact && leadContacts.length > 1 && (
              <div className="px-4 py-2 border-b border-gray-200 bg-gray-50">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-gray-600">Contact:</label>
                  <select
                    className="select select-bordered select-sm text-xs flex-1"
                    value={selectedContactId || ''}
                    onChange={(e) => {
                      const contactId = e.target.value ? parseInt(e.target.value, 10) : null;
                      setSelectedContactId(contactId);
                    }}
                  >
                    {leadContacts.map(contact => (
                      <option key={contact.id} value={contact.id}>
                        {contact.name} {contact.isMain && '(Main)'} - {contact.phone || contact.mobile || 'No phone'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            {/* Message Input */}
            <textarea
              value={newMessage}
              onChange={(e) => {
                setNewMessage(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
              }}
              placeholder={
                isLocked 
                  ? (messages.length === 0 
                      ? "No messages yet - use templates to start conversation"
                      : "Window expired - use templates")
                  : selectedFile 
                    ? "Add a caption..." 
                    : selectedTemplate 
                      ? selectedTemplate.params === '1' 
                        ? `Parameter for: ${selectedTemplate.title}` 
                        : `Template: ${selectedTemplate.title}`
                      : "Type a message..."
              }
              className={`flex-1 resize-none rounded-2xl textarea textarea-bordered ${
                (isLocked && !selectedTemplate) ? 'bg-gray-100 cursor-not-allowed' : ''
              }`}
              disabled={sending || uploadingMedia || (isLocked && !selectedTemplate)}
              rows={1}
              style={{ 
                maxHeight: '200px', 
                minHeight: '40px',
                paddingTop: '12px', 
                paddingBottom: '12px', 
                paddingLeft: '16px', 
                paddingRight: '16px',
                direction: newMessage ? (newMessage.match(/[\u0590-\u05FF]/) ? 'rtl' : 'ltr') : 'ltr',
                textAlign: newMessage ? (newMessage.match(/[\u0590-\u05FF]/) ? 'right' : 'left') : 'left',
                fontSize: '15px'
              }}
            />
            
            {/* Send Button */}
            {selectedFile ? (
              <button
                type="button"
                onClick={handleSendMedia}
                disabled={uploadingMedia || (isLocked && !selectedTemplate)}
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
                disabled={(!newMessage.trim() && !selectedTemplate) || sending || (isLocked && !selectedTemplate)}
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
      </div>
    </div>,
    document.body
  );
};

export default SchedulerWhatsAppModal;