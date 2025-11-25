import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { buildApiUrl } from '../lib/api';
import { fetchWhatsAppTemplates, filterTemplates, testDatabaseAccess, refreshTemplatesFromAPI, type WhatsAppTemplate } from '../lib/whatsappTemplates';
import { fetchLeadContacts } from '../lib/contactHelpers';
import type { ContactInfo } from '../lib/contactHelpers';
import { searchLeads, type CombinedLead } from '../lib/legacyLeadsApi';
import EmojiPicker from 'emoji-picker-react';
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
  LockClosedIcon,
  ClockIcon,
  PencilIcon,
  TrashIcon,
  EllipsisVerticalIcon,
  CheckIcon,
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
  lead_type?: 'legacy' | 'new';
  isContact?: boolean;
  lead_id?: string | null; // For contacts, this is the associated lead_id
  contact_id?: number; // For contacts, this is the contact_id
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
  template_id?: number; // Database template ID for proper matching
}

interface WhatsAppPageProps {
  selectedContact?: {
    contact: any;
    leadId: string | number;
    leadType: 'legacy' | 'new';
  } | null;
}

const WhatsAppPage: React.FC<WhatsAppPageProps> = ({ selectedContact: propSelectedContact }) => {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  
  // Search state (for filtering fetched clients only - no API calls)
  
  // New Message Modal state
  const [isNewMessageModalOpen, setIsNewMessageModalOpen] = useState(false);
  const [newMessageSearchTerm, setNewMessageSearchTerm] = useState('');
  const [newMessageSearchResults, setNewMessageSearchResults] = useState<CombinedLead[]>([]);
  const [isNewMessageSearching, setIsNewMessageSearching] = useState(false);
  const newMessageSearchTimeoutRef = useRef<NodeJS.Timeout>();

  // Debug selectedFile state changes
  useEffect(() => {
    console.log('📁 selectedFile state changed:', selectedFile);
  }, [selectedFile]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [allMessages, setAllMessages] = useState<WhatsAppMessage[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [shouldCloseOnNavigate, setShouldCloseOnNavigate] = useState(false);
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
  
  // Emoji picker state
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  
  // Lock state for 24-hour window
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [isLocked, setIsLocked] = useState(false);

  // Edit/Delete message state
  const [editingMessage, setEditingMessage] = useState<number | null>(null);
  const [editMessageText, setEditMessageText] = useState('');
  const [deletingMessage, setDeletingMessage] = useState<number | null>(null);
  const [showDeleteOptions, setShowDeleteOptions] = useState<number | null>(null);
  const [userCache, setUserCache] = useState<Record<string, string>>({});
  
  // State for lead contacts (all contacts associated with the selected client)
  const [leadContacts, setLeadContacts] = useState<ContactInfo[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);

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

  // Helper function to detect if message contains only emojis
  const isEmojiOnly = (text: string): boolean => {
    // Simple approach: check if the text length is very short and contains emoji-like characters
    const cleanText = text.trim();
    if (cleanText.length === 0) return false;
    
    // Check if the message is very short (likely emoji-only) and contains non-ASCII characters
    const hasNonAscii = /[^\x00-\x7F]/.test(cleanText);
    const isShort = cleanText.length <= 5; // Most emojis are 1-3 characters
    
    return hasNonAscii && isShort;
  };

  // Helper function to process template messages for display (optimized - minimal logging)
  const processTemplateMessage = (message: WhatsAppMessage): WhatsAppMessage => {
    // Early return for non-outgoing messages or messages without content
    if (message.direction !== 'out' || !message.message) {
      return message;
    }

    // PRIORITY 1: Match by template_id if available (most reliable)
    if (message.template_id) {
      // Convert both to numbers for comparison (handle string/number mismatch)
      const templateId = Number(message.template_id);
      const template = templates.find(t => Number(t.id) === templateId);
      if (template) {
        // Check if message already has the correct template content (avoid unnecessary processing)
        if (template.content && message.message === template.content) {
          return message; // Already correct, no need to process
        }
        
        console.log(`✅ Matched template by ID ${templateId}: ${template.title} (${template.language || 'N/A'})`);
        if (template.params === '0' && template.content) {
          return { ...message, message: template.content };
        } else if (template.params === '1') {
          // For templates with params, try to extract parameter from message or show template name
          const paramMatch = message.message.match(/\[Template:.*?\]\s*(.+)/);
          if (paramMatch && paramMatch[1].trim()) {
            return { ...message, message: paramMatch[1].trim() };
          }
          return { ...message, message: template.content || `Template: ${template.title}` };
        }
      } else {
        console.warn(`⚠️ Template with ID ${templateId} not found in templates list. Available IDs:`, templates.map(t => t.id));
      }
    }

    // Quick check: if message already matches a template content, no processing needed
    // This prevents reprocessing messages that are already correctly formatted
    const isAlreadyProperlyFormatted = templates.some(template => {
      if (!template.content) return false;
      // Exact match
      if (message.message === template.content) return true;
      // Also check if message contains the template content (for messages with extra formatting)
      if (message.message.includes(template.content) && template.content.length > 20) return true;
      return false;
    });
    
    if (isAlreadyProperlyFormatted) {
      // If it has template_id, make sure it matches the template we found
      if (message.template_id) {
        const matchingTemplate = templates.find(t => 
          t.content && (message.message === t.content || message.message.includes(t.content))
        );
        if (matchingTemplate && Number(matchingTemplate.id) === Number(message.template_id)) {
          return message; // Correct template, no processing needed
        }
      } else {
        return message; // Already formatted correctly, no template_id needed
      }
    }
    
    // Quick check for template patterns (most messages won't match, so check early)
    const hasTemplatePattern = 
      message.message.includes('Template:') ||
      message.message.includes('[Template:') ||
      message.message.includes('[template:]') ||
      message.message.includes('template:') ||
      message.message.includes('TEMPLATE_MARKER:') ||
      message.message === '' ||
      message.message === 'Template sent';

    if (!hasTemplatePattern) {
      return message; // Early return for non-template messages
    }

    // PRIORITY 2: Fallback to name matching for backward compatibility (legacy messages without template_id)
    // Process template message (only if we get here)
    // Try to find the template by looking for template info in the message
    const templateMatch = message.message.match(/\[Template:\s*([^\]]+)\]/) || 
                          message.message.match(/Template:\s*(.+)/);
    
    if (templateMatch) {
      // Clean the template title: remove trailing spaces and brackets
      const templateTitle = templateMatch[1].trim().replace(/\]$/, '');
      
      // Try case-insensitive matching on title first
      const template = templates.find(t => 
        t.title.toLowerCase() === templateTitle.toLowerCase()
      );
      
      if (template) {
        if (template.params === '0' && template.content) {
          return { ...message, message: template.content };
        } else if (template.params === '1') {
          return { ...message, message: template.content || `Template: ${template.title}` };
        }
      } else {
        // Try to find by name360 field as well (case-insensitive)
        const templateByName = templates.find(t => 
          t.name360 && t.name360.toLowerCase() === templateTitle.toLowerCase()
        );
        if (templateByName) {
          if (templateByName.params === '0' && templateByName.content) {
            return { ...message, message: templateByName.content };
          } else if (templateByName.params === '1') {
            return { ...message, message: templateByName.content || `Template: ${templateByName.title}` };
          }
        }
      }
    }
    
    // Check for TEMPLATE_MARKER
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
    
    // If message is empty or "Template sent", show generic message
    if (message.message === '' || message.message === 'Template sent') {
      return { ...message, message: 'Template message sent' };
    }
    
    return message;
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
      if (event.key === 'Escape' && isNewMessageModalOpen) {
        setIsNewMessageModalOpen(false);
        setNewMessageSearchTerm('');
        setNewMessageSearchResults([]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedMedia, isNewMessageModalOpen]);

  // Fetch current user info
  useEffect(() => {
    const fetchCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        console.log('🔍 Looking for user with email:', user.email);
        
        // Only try database lookup if it looks like an email
        if (user.email.includes('@')) {
          const { data: userRow, error } = await supabase
            .from('users')
            .select('id, full_name, email')
            .eq('email', user.email)
            .single();
          
          if (userRow) {
            console.log('✅ Found user in database:', userRow);
            setCurrentUser(userRow);
            return;
          }
        }
        
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
    };
    fetchCurrentUser();
  }, []);

  // Fetch WhatsApp templates
  useEffect(() => {
    const loadTemplates = async () => {
      try {
        console.log('🔄 Starting to load WhatsApp templates...');
        setIsLoadingTemplates(true);
        const fetchedTemplates = await fetchWhatsAppTemplates();
        console.log('📦 Templates loaded:', fetchedTemplates.length, 'templates');
        console.log('📋 Available templates:', fetchedTemplates.map(t => ({
          id: t.id,
          title: t.title,
          name360: t.name360,
          params: t.params,
          active: t.active
        })));
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

  // Fetch only clients/leads with existing WhatsApp conversations
  useEffect(() => {
    const fetchClientsWithConversations = async () => {
      try {
        setLoading(true);
        
        // Fetch all WhatsApp messages to get both lead_ids and contact_ids
        const { data: whatsappMessages, error: whatsappError } = await supabase
          .from('whatsapp_messages')
          .select('lead_id, contact_id');

        if (whatsappError) {
          console.error('Error fetching WhatsApp messages:', whatsappError);
        }

        // Get unique lead IDs from WhatsApp messages (where lead_id is not null)
        const uniqueLeadIds = new Set<string>();
        // Get unique contact IDs from WhatsApp messages (where contact_id is not null)
        const uniqueContactIds = new Set<number>();
        
        (whatsappMessages || []).forEach((msg: any) => {
          if (msg.lead_id) {
            uniqueLeadIds.add(String(msg.lead_id));
          }
          if (msg.contact_id) {
            uniqueContactIds.add(Number(msg.contact_id));
          }
        });

        // Fetch unique lead_ids from leads_leadinteractions (legacy leads) where kind = 'w' (WhatsApp)
        const { data: legacyInteractions, error: legacyError } = await supabase
          .from('leads_leadinteractions')
          .select('lead_id')
          .eq('kind', 'w')
          .not('lead_id', 'is', null);

        if (legacyError) {
          console.error('Error fetching legacy interactions:', legacyError);
        }

        // Get unique legacy lead IDs
        const uniqueLegacyIds = new Set<string>();
        (legacyInteractions || []).forEach((interaction: any) => {
          if (interaction.lead_id) {
            uniqueLegacyIds.add(String(interaction.lead_id));
          }
        });

        // Fetch new leads with conversations
        const newLeadIds = Array.from(uniqueLeadIds);
        let newLeadsData: any[] = [];
        
        if (newLeadIds.length > 0) {
          const { data: leadsData, error: leadsError } = await supabase
            .from('leads')
            .select('id, lead_number, name, email, phone, mobile, topic, status, stage, closer, scheduler, next_followup, probability, balance, potential_applicants')
            .in('id', newLeadIds);

          if (leadsError) {
            console.error('Error fetching new leads:', leadsError);
          } else {
            newLeadsData = (leadsData || []).map(lead => ({
              ...lead,
              lead_type: 'new' as const,
              isContact: false
            }));
          }
        }

        // Fetch legacy leads with conversations
        const legacyLeadIds = Array.from(uniqueLegacyIds).map(id => Number(id)).filter(id => !isNaN(id));
        let legacyLeadsData: any[] = [];
        
        if (legacyLeadIds.length > 0) {
          const { data: legacyLeads, error: legacyLeadsError } = await supabase
            .from('leads_lead')
            .select('id, lead_number, name, email, phone, mobile, topic, status, stage, closer_id, meeting_scheduler_id, next_followup, probability, total, potential_applicants')
            .in('id', legacyLeadIds);

          if (legacyLeadsError) {
            console.error('Error fetching legacy leads:', legacyLeadsError);
          } else {
            legacyLeadsData = (legacyLeads || []).map(lead => ({
              id: `legacy_${lead.id}`,
              lead_number: String(lead.id),
              name: lead.name || '',
              email: lead.email || '',
              phone: lead.phone || '',
              mobile: lead.mobile || '',
              topic: lead.topic || '',
              status: lead.status ? String(lead.status) : '',
              stage: lead.stage ? String(lead.stage) : '',
              closer: lead.closer_id ? String(lead.closer_id) : '',
              scheduler: lead.meeting_scheduler_id ? String(lead.meeting_scheduler_id) : '',
              next_followup: lead.next_followup || '',
              probability: lead.probability ? Number(lead.probability) : undefined,
              balance: lead.total ? Number(lead.total) : undefined,
              potential_applicants: lead.potential_applicants || '',
              lead_type: 'legacy' as const,
              isContact: false
            }));
          }
        }

        // Fetch contacts with WhatsApp conversations that are connected to leads
        const contactIdsArray = Array.from(uniqueContactIds);
        let contactClientsData: any[] = [];
        
        if (contactIdsArray.length > 0) {
          // First, fetch relationships to ensure contacts are connected to leads
          const { data: relationships, error: relationshipsError } = await supabase
            .from('lead_leadcontact')
            .select('contact_id, newlead_id, lead_id')
            .in('contact_id', contactIdsArray)
            .not('newlead_id', 'is', null);

          if (relationshipsError) {
            console.error('Error fetching contact relationships:', relationshipsError);
          } else if (relationships && relationships.length > 0) {
            // Get unique contact IDs that are actually connected to leads
            const connectedContactIds = new Set<number>();
            const contactToLeadMap = new Map<number, string>();
            
            relationships.forEach((rel: any) => {
              if (rel.contact_id && rel.newlead_id) {
                connectedContactIds.add(Number(rel.contact_id));
                contactToLeadMap.set(Number(rel.contact_id), String(rel.newlead_id));
              }
            });

            if (connectedContactIds.size > 0) {
              // Fetch contact details only for contacts connected to leads
              const { data: contactsData, error: contactsError } = await supabase
                .from('leads_contact')
                .select('id, name, email, phone, mobile')
                .in('id', Array.from(connectedContactIds));

              if (contactsError) {
                console.error('Error fetching contacts:', contactsError);
              } else if (contactsData && contactsData.length > 0) {
                // Get unique lead IDs for these contacts
                const leadIdsForContacts = new Set<string>();
                contactsData.forEach((contact: any) => {
                  const leadId = contactToLeadMap.get(contact.id);
                  if (leadId) {
                    leadIdsForContacts.add(leadId);
                  }
                });

                // Fetch lead information for these contacts
                let leadsForContacts: any[] = [];
                if (leadIdsForContacts.size > 0) {
                  const { data: leadsForContactsData, error: leadsForContactsError } = await supabase
                    .from('leads')
                    .select('id, lead_number, name, email, phone, mobile, topic, status, stage, closer, scheduler, next_followup, probability, balance, potential_applicants')
                    .in('id', Array.from(leadIdsForContacts));

                  if (!leadsForContactsError && leadsForContactsData) {
                    leadsForContacts = leadsForContactsData;
                  }
                }

                // Create Client objects for contacts that are connected to leads
                contactClientsData = contactsData
                  .filter((contact: any) => contactToLeadMap.has(contact.id)) // Only include connected contacts
                  .map((contact: any) => {
                    const leadId = contactToLeadMap.get(contact.id);
                    const associatedLead = leadsForContacts.find(lead => lead.id === leadId);
                    
                    return {
                      id: `contact_${contact.id}`,
                      lead_id: leadId || null, // Store the actual lead_id from relationship
                      contact_id: contact.id, // Store the contact_id
                      lead_number: associatedLead?.lead_number || `Contact ${contact.id}`,
                      name: contact.name || '',
                      email: contact.email || '',
                      phone: contact.phone || '',
                      mobile: contact.mobile || '',
                      topic: associatedLead?.topic || '',
                      status: associatedLead?.status || '',
                      stage: associatedLead?.stage || '',
                      closer: associatedLead?.closer || '',
                      scheduler: associatedLead?.scheduler || '',
                      next_followup: associatedLead?.next_followup || '',
                      probability: associatedLead?.probability || undefined,
                      balance: associatedLead?.balance || undefined,
                      potential_applicants: associatedLead?.potential_applicants || '',
                      lead_type: 'new' as const,
                      isContact: true // Mark as contact
                    };
                  });
              }
            }
          }
        }

        // Combine all clients: leads and contacts
        const allClients = [...newLeadsData, ...legacyLeadsData, ...contactClientsData];
        setClients(allClients);
      } catch (error) {
        console.error('Error fetching clients with conversations:', error);
        toast.error('Failed to load clients');
      } finally {
        setLoading(false);
      }
    };

    fetchClientsWithConversations();
  }, []);

  // If propSelectedContact is provided, use it directly
  useEffect(() => {
    if (propSelectedContact) {
      setSelectedContactId(propSelectedContact.contact.id);
      // Ensure no duplicates - use array with single contact
      setLeadContacts([propSelectedContact.contact]);
      // Create a Client object from the contact
      const clientObj: Client = {
        id: propSelectedContact.leadId,
        name: propSelectedContact.contact.name,
        phone: propSelectedContact.contact.phone || propSelectedContact.contact.mobile || '',
        lead_type: propSelectedContact.leadType,
      };
      setSelectedClient(clientObj);
    }
  }, [propSelectedContact]);

  // Fetch contacts for the selected client (only if no propSelectedContact)
  useEffect(() => {
    if (propSelectedContact) return; // Skip if we have a prop contact
    
    const fetchContactsForClient = async () => {
      if (!selectedClient) {
        setLeadContacts([]);
        setSelectedContactId(null);
        return;
      }

      const isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');
      const leadId = isLegacyLead 
        ? (typeof selectedClient.id === 'string' ? selectedClient.id.replace('legacy_', '') : String(selectedClient.id))
        : selectedClient.id;

      const contacts = await fetchLeadContacts(leadId, isLegacyLead);
      
      // Deduplicate contacts by ID to prevent duplicate key warnings
      const uniqueContacts = contacts.filter((contact, index, self) => 
        index === self.findIndex(c => c.id === contact.id)
      );
      
      setLeadContacts(uniqueContacts);
      
      // If there are contacts, select the main contact by default, or the first one
      if (uniqueContacts.length > 0) {
        const mainContact = uniqueContacts.find(c => c.isMain) || uniqueContacts[0];
        setSelectedContactId(mainContact.id);
      } else {
        setSelectedContactId(null);
      }
    };

    if (selectedClient) {
      fetchContactsForClient();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient, propSelectedContact]);

  // Track if initial load is complete to prevent polling interference
  const initialLoadCompleteRef = useRef(false);

  // Fetch messages for selected client
  useEffect(() => {
    // Reset initial load flag when client changes
    initialLoadCompleteRef.current = false;
    
    const fetchMessages = async (isPolling = false) => {
      if (!selectedClient) {
        setMessages([]);
        setLoadingMessages(false);
        return;
      }

      // Show loading state only on initial load
      if (!isPolling) {
        setLoadingMessages(true);
      }

      try {
        // Get contact_id if we have a selected contact from the contact selector
        // Also try to find it from leadContacts if not set yet
        let contactId = selectedContactId || (propSelectedContact?.contact.id ?? null);
        
        // If we don't have a contactId but we have leadContacts, try to find the matching contact
        if (!contactId && leadContacts.length > 0) {
          const matchingContact = leadContacts.find(c => 
            (c.email && selectedClient.email && c.email === selectedClient.email) ||
            (c.phone && selectedClient.phone && c.phone === selectedClient.phone) ||
            (c.mobile && (selectedClient.mobile || selectedClient.phone) && c.mobile === (selectedClient.mobile || selectedClient.phone)) ||
            (c.name && selectedClient.name && c.name === selectedClient.name)
          );
          if (matchingContact) {
            contactId = matchingContact.id;
            console.log(`📧 Found matching contact in leadContacts: ${matchingContact.name} (ID: ${contactId})`);
          }
        }
        
        // Only log initial loads, not polling (reduces console noise)
        if (!isPolling) {
          console.log('🔄 Fetching messages for client:', selectedClient.id, contactId ? `contact_id=${contactId}` : '');
        }
        
        // Check if this is a legacy lead
        const isLegacyLead = selectedClient.id.toString().startsWith('legacy_');
        
        if (isLegacyLead) {
          // Extract numeric ID from legacy_<id>
          const legacyId = Number(selectedClient.id.replace('legacy_', ''));
          
          if (isNaN(legacyId)) {
            console.error('Invalid legacy lead ID:', selectedClient.id);
            setMessages([]);
            return;
          }
          
          // Fetch from leads_leadinteractions for legacy leads
          const { data: interactions, error: interactionsError } = await supabase
            .from('leads_leadinteractions')
            .select('*')
            .eq('lead_id', legacyId)
            .eq('kind', 'w') // 'w' for WhatsApp
            .order('cdate', { ascending: true });
          
          if (interactionsError) {
            console.error('Error fetching legacy interactions:', interactionsError);
            toast.error('Failed to load messages');
            return;
          }
          
          // Transform legacy interactions to WhatsAppMessage format
          const transformedMessages: WhatsAppMessage[] = (interactions || []).map((interaction: any) => {
            // Combine date and time to create sent_at
            const dateStr = interaction.date || '';
            const timeStr = interaction.time || '';
            let sentAt = new Date().toISOString();
            
            if (dateStr && timeStr) {
              try {
                // Try to parse date and time
                const [year, month, day] = dateStr.split('-');
                const [hours, minutes, seconds] = timeStr.split(':');
                if (year && month && day && hours && minutes) {
                  sentAt = new Date(
                    parseInt(year),
                    parseInt(month) - 1,
                    parseInt(day),
                    parseInt(hours),
                    parseInt(minutes),
                    seconds ? parseInt(seconds) : 0
                  ).toISOString();
                }
              } catch (e) {
                // Fallback to cdate if available
                sentAt = interaction.cdate || new Date().toISOString();
              }
            } else if (interaction.cdate) {
              sentAt = interaction.cdate;
            }
            
            return {
              id: interaction.id,
              lead_id: selectedClient.id, // Keep the legacy_ prefix for consistency
              sender_name: interaction.employee_id ? `Employee ${interaction.employee_id}` : 'Unknown',
              direction: interaction.direction === 'i' ? 'in' : 'out',
              message: interaction.content || interaction.description || '',
              sent_at: sentAt,
              status: 'sent',
              message_type: 'text',
              whatsapp_status: 'sent',
            };
          });
          
          const processedMessages = transformedMessages.map(processTemplateMessage);
          
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
        
        // For new leads, use whatsapp_messages table
        // If this is a contact (not a main lead), fetch messages by contact_id
        let allMessagesForLead: any[] = [];
        
        if (selectedClient.isContact && selectedClient.contact_id) {
          // This is a contact - fetch messages by contact_id
          const { data: contactMessages, error: contactError } = await supabase
            .from('whatsapp_messages')
            .select('*')
            .eq('contact_id', selectedClient.contact_id)
            .order('sent_at', { ascending: true });
          
          if (contactError) {
            console.error('Error fetching contact messages:', contactError);
            toast.error('Failed to load messages');
            setLoadingMessages(false);
            return;
          }
          
          allMessagesForLead = contactMessages || [];
        } else {
          // This is a main lead - fetch by lead_id first, then filter by contact_id or phone number
          const { data: leadMessages, error: leadError } = await supabase
            .from('whatsapp_messages')
            .select('*')
            .eq('lead_id', selectedClient.id)
            .order('sent_at', { ascending: true });
          
          if (leadError) {
            console.error('Error fetching messages:', leadError);
            toast.error('Failed to load messages');
            setLoadingMessages(false);
            return;
          }
          
          allMessagesForLead = leadMessages || [];
        }

        // Filter messages based on contact_id or phone number (only for main leads, not contacts)
        let filteredMessages = allMessagesForLead || [];
        
        if (!selectedClient.isContact && contactId) {
          // Get the selected contact details
          const selectedContact = propSelectedContact?.contact || leadContacts.find(c => c.id === contactId);
          
          if (selectedContact) {
            const contactPhone = selectedContact.phone || selectedContact.mobile;
            let last4Digits = '';
            
            if (contactPhone) {
              // Extract last 4 digits for phone matching
              const phoneDigits = contactPhone.replace(/\D/g, '');
              last4Digits = phoneDigits.slice(-4);
            }
            
            // Filter messages: 
            // 1. First try exact contact_id match
            // 2. If no contact_id match, fallback to phone number matching (last 4 digits)
            filteredMessages = (allMessagesForLead || []).filter(msg => {
              // Exact contact_id match
              if (msg.contact_id === contactId) {
                return true;
              }
              
              // Fallback: if message has no contact_id, match by phone number (last 4 digits)
              if (!msg.contact_id && msg.phone_number && last4Digits.length >= 4) {
                const msgPhoneDigits = msg.phone_number.replace(/\D/g, '');
                const msgLast4 = msgPhoneDigits.slice(-4);
                if (msgLast4 === last4Digits) {
                  return true;
                }
              }
              
              return false;
            });
          } else {
            // If contact not found, show all messages for the lead (fallback)
            filteredMessages = allMessagesForLead || [];
          }
        }
        // For contacts, we already have the filtered messages (fetched by contact_id)
        
        const data = filteredMessages;

        // Only log on initial load
        if (!isPolling) {
          console.log('📨 Messages fetched:', data?.length || 0, 'messages', contactId ? `(filtered by contact_id=${contactId})` : '');
        }
        
        // Process template messages for display (batch process for better performance)
        // Log template_id presence for debugging
        if (!isPolling && data && data.length > 0) {
          const messagesWithTemplateId = data.filter((m: any) => m.template_id);
          if (messagesWithTemplateId.length > 0) {
            console.log(`📋 Found ${messagesWithTemplateId.length} messages with template_id:`, 
              messagesWithTemplateId.map((m: any) => ({ id: m.id, template_id: m.template_id, message: m.message?.substring(0, 50) }))
            );
          }
        }
        const processedMessages = (data || []).map(processTemplateMessage);
        
        // Always update messages immediately on initial load
        // For polling, only update if there are actual changes
        if (!isPolling) {
          // Immediate update for initial load
          setMessages(processedMessages);
          setLoadingMessages(false); // Hide loading state
          initialLoadCompleteRef.current = true; // Mark initial load as complete
        } else {
          // Only poll if initial load is complete
          if (!initialLoadCompleteRef.current) {
            return; // Skip polling until initial load completes
          }
          // For polling, only update if there are new messages or changes
          setMessages(prevMessages => {
            // Quick length check first
            if (processedMessages.length !== prevMessages.length) {
              // Merge template_id from previous messages if missing in new messages
              return processedMessages.map(newMsg => {
                const prevMsg = prevMessages.find(p => p.id === newMsg.id || p.whatsapp_message_id === newMsg.whatsapp_message_id);
                if (prevMsg && prevMsg.template_id && !newMsg.template_id) {
                  return { ...newMsg, template_id: prevMsg.template_id };
                }
                return newMsg;
              });
            }
            
            // Deep comparison only if lengths match
            const hasChanges = processedMessages.some((newMsg, index) => {
              const prevMsg = prevMessages[index];
              return !prevMsg || 
                     newMsg.id !== prevMsg.id || 
                     newMsg.message !== prevMsg.message ||
                     newMsg.whatsapp_status !== prevMsg.whatsapp_status;
            });
            
            if (hasChanges) {
              // Merge template_id from previous messages if missing in new messages
              return processedMessages.map(newMsg => {
                const prevMsg = prevMessages.find(p => p.id === newMsg.id || p.whatsapp_message_id === newMsg.whatsapp_message_id);
                if (prevMsg && prevMsg.template_id && !newMsg.template_id) {
                  // Re-process with the preserved template_id
                  return processTemplateMessage({ ...newMsg, template_id: prevMsg.template_id });
                }
                return newMsg;
              });
            }
            
            return prevMessages;
          });
        }
        
        // Mark incoming messages as read when viewing the conversation
        if (currentUser && data && data.length > 0 && !isPolling) {
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
        setLoadingMessages(false); // Hide loading state on error
      }
    };

    // Initial load - wait for it to complete before starting polling
    fetchMessages(false).then(() => {
      initialLoadCompleteRef.current = true;
    });
    
    // Set up polling to refresh messages every 5 seconds
    // Delay first poll to ensure initial load completes
    const pollDelay = setTimeout(() => {
      const interval = setInterval(() => {
        if (initialLoadCompleteRef.current) {
          fetchMessages(true);
        }
      }, 5000);
      
      // Store interval for cleanup
      (window as any).__whatsappPollInterval = interval;
    }, 2000); // Wait 2 seconds before starting polling
    
    return () => {
      clearTimeout(pollDelay);
      if ((window as any).__whatsappPollInterval) {
        clearInterval((window as any).__whatsappPollInterval);
      }
    };
  }, [selectedClient, selectedContactId, leadContacts, propSelectedContact]);

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

  // Update timer for 24-hour window
  useEffect(() => {
    if (!selectedClient) {
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
      // No incoming messages, but there are outgoing messages - still lock
      setTimeLeft('');
      setIsLocked(true);
    }
  }, [selectedClient, messages]);

  // Auto-scroll to bottom only when chat is first selected or new message is sent
  const [shouldAutoScroll, setShouldAutoScroll] = useState(false);
  const [isFirstLoad, setIsFirstLoad] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<WhatsAppTemplate | null>(null);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [templateSearchTerm, setTemplateSearchTerm] = useState('');
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  
  // AI suggestions state
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [showAISuggestions, setShowAISuggestions] = useState(false);
  
  // Mobile input focus state
  const [isInputFocused, setIsInputFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Mobile dropdown state
  const [showMobileDropdown, setShowMobileDropdown] = useState(false);
  
  useEffect(() => {
    if (shouldAutoScroll && messages.length > 0) {
      // Add a small delay to ensure messages are rendered
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        setShouldAutoScroll(false);
      }, 100);
    }
  }, [messages, shouldAutoScroll]);

  // Expand textarea on mobile when template or AI content is added
  useEffect(() => {
    if (isMobile && textareaRef.current && (selectedTemplate || aiSuggestions.length > 0 || newMessage.length > 100)) {
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
          textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 300)}px`;
        }
      }, 0);
    }
  }, [newMessage, selectedTemplate, aiSuggestions, isMobile]);

  // Handle click outside to close emoji picker and mobile dropdown, and reset input focus
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
      
      // Reset input focus on mobile when clicking outside the input area
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
  }, [isEmojiPickerOpen, showMobileDropdown, isMobile, isInputFocused]);

  // Handle search input changes - now only filters fetched clients (no API calls)
  // Removed the searchLeads API call - search now only filters through existing clients

  // Handle search in New Message Modal
  useEffect(() => {
    if (newMessageSearchTimeoutRef.current) {
      clearTimeout(newMessageSearchTimeoutRef.current);
    }

    if (!newMessageSearchTerm.trim()) {
      setNewMessageSearchResults([]);
      setIsNewMessageSearching(false);
      return;
    }

    setIsNewMessageSearching(true);

    newMessageSearchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchLeads(newMessageSearchTerm.trim());
        console.log('[WhatsAppPage] Search results received:', results.length);
        console.log('[WhatsAppPage] Sample results:', results.slice(0, 5).map(r => ({
          name: r.name,
          lead_number: r.lead_number,
          lead_type: r.lead_type,
          isContact: r.isContact,
          contactName: r.contactName
        })));
        const ronDeckerResults = results.filter(r => {
          const name = (r.name || r.contactName || '').toLowerCase();
          return name.includes('ron') && name.includes('decker');
        });
        console.log('[WhatsAppPage] Ron Decker results:', ronDeckerResults.length, ronDeckerResults.map(r => ({
          name: r.name,
          contactName: r.contactName,
          lead_number: r.lead_number,
          lead_type: r.lead_type
        })));
        setNewMessageSearchResults(results);
      } catch (error) {
        console.error('Error searching leads:', error);
        setNewMessageSearchResults([]);
      } finally {
        setIsNewMessageSearching(false);
      }
    }, 300);
  }, [newMessageSearchTerm]);

  // Handle clicking on a contact in New Message Modal
  const handleNewMessageContactClick = async (result: CombinedLead) => {
    // If this is a contact (not main contact), create a contact client
    if (result.isContact && !result.isMainContact) {
      const isLegacyLead = result.lead_type === 'legacy';
      const leadId = isLegacyLead 
        ? (typeof result.id === 'string' ? result.id.replace('legacy_', '') : String(result.id))
        : result.id;
      
      // Fetch contacts to get the contact ID
      const contacts = await fetchLeadContacts(leadId, isLegacyLead);
      const selectedContact = contacts.find(c => 
        (c.phone && result.phone && c.phone === result.phone) ||
        (c.mobile && result.mobile && c.mobile === result.mobile) ||
        (c.email && result.email && c.email === result.email) ||
        (c.name && result.name && c.name === result.name) ||
        (result.contactName && c.name && c.name === result.contactName)
      );
      
      if (!selectedContact) {
        toast.error('Contact not found');
        return;
      }
      
      // Fetch lead information for the contact
      let leadData: any = null;
      if (isLegacyLead) {
        const { data: legacyLead, error } = await supabase
          .from('leads_lead')
          .select('id, lead_number, name, email, phone, mobile, topic, status, stage, closer_id, meeting_scheduler_id, next_followup, probability, total, potential_applicants')
          .eq('id', Number(leadId))
          .single();
        
        if (!error && legacyLead) {
          leadData = legacyLead;
        }
      } else {
        const { data: newLead, error } = await supabase
          .from('leads')
          .select('id, lead_number, name, email, phone, mobile, topic, status, stage, closer, scheduler, next_followup, probability, balance, potential_applicants')
          .eq('id', leadId)
          .single();
        
        if (!error && newLead) {
          leadData = newLead;
        }
      }
      
      // Create a contact client
      const contactClient: Client = {
        id: `contact_${selectedContact.id}`,
        lead_id: leadId, // Store the associated lead_id
        contact_id: selectedContact.id, // Store the contact_id
        lead_number: leadData?.lead_number || result.lead_number || `Contact ${selectedContact.id}`,
        name: selectedContact.name || result.contactName || result.name || '',
        email: selectedContact.email || result.email || '',
        phone: selectedContact.phone || result.phone || '',
        mobile: selectedContact.mobile || result.mobile || '',
        topic: leadData?.topic || result.topic || '',
        status: leadData?.status || result.status || '',
        stage: leadData?.stage || result.stage || '',
        closer: isLegacyLead ? (leadData?.closer_id ? String(leadData.closer_id) : '') : (leadData?.closer || ''),
        scheduler: isLegacyLead ? (leadData?.meeting_scheduler_id ? String(leadData.meeting_scheduler_id) : '') : (leadData?.scheduler || ''),
        next_followup: leadData?.next_followup || result.next_followup || '',
        probability: leadData?.probability ? Number(leadData.probability) : undefined,
        balance: isLegacyLead ? (leadData?.total ? Number(leadData.total) : undefined) : (leadData?.balance || undefined),
        potential_applicants: leadData?.potential_applicants || result.potential_applicants || '',
        lead_type: result.lead_type,
        isContact: true // Mark as contact
      };
      
      // Check if contact client already exists
      const existingContactClient = clients.find(c => 
        c.isContact && c.contact_id === selectedContact.id
      );
      
      if (!existingContactClient) {
        setClients(prev => [contactClient, ...prev]);
      }
      
      // Set the selected client and contact
      setSelectedClient(existingContactClient || contactClient);
      setSelectedContactId(selectedContact.id);
      setLeadContacts([]); // Contacts don't have sub-contacts
      
      console.log(`✅ Selected contact: ${selectedContact.name} (Contact ID: ${selectedContact.id}, Lead ID: ${leadId})`);
    } else {
      // This is a main lead - create a regular lead client
      const existingClient = clients.find(c => {
        if (result.lead_type === 'legacy') {
          return c.id === `legacy_${result.id}`;
        } else {
          return c.id === result.id;
        }
      });

      let clientToSelect: Client;

      if (!existingClient) {
        // Add the client to the list
        const newClient: Client = {
          id: result.lead_type === 'legacy' ? `legacy_${result.id}` : result.id,
          lead_number: result.lead_number,
          name: result.name,
          email: result.email,
          phone: result.phone,
          mobile: result.mobile,
          topic: result.topic,
          status: result.status,
          stage: result.stage,
          closer: result.closer,
          scheduler: result.scheduler,
          next_followup: result.next_followup,
          probability: result.probability,
          balance: result.balance,
          potential_applicants: result.potential_applicants,
          lead_type: result.lead_type,
          isContact: false
        };
        
        setClients(prev => [newClient, ...prev]);
        clientToSelect = newClient;
      } else {
        clientToSelect = existingClient;
      }

      // Set the selected client
      setSelectedClient(clientToSelect);
      
      // For main leads, fetch contacts and select the main one
      const isLegacyLead = clientToSelect.lead_type === 'legacy' || clientToSelect.id.toString().startsWith('legacy_');
      const leadId = isLegacyLead 
        ? (typeof clientToSelect.id === 'string' ? clientToSelect.id.replace('legacy_', '') : String(clientToSelect.id))
        : clientToSelect.id;
      
      const contacts = await fetchLeadContacts(leadId, isLegacyLead);
      setLeadContacts(contacts);
      
      if (contacts.length > 0) {
        const mainContact = contacts.find(c => c.isMain) || contacts[0];
        setSelectedContactId(mainContact.id);
      }
    }

    // Close modal and clear search
    setIsNewMessageModalOpen(false);
    setNewMessageSearchTerm('');
    setNewMessageSearchResults([]);
    
    // Open chat on mobile
    if (isMobile) {
      setShowChat(true);
    }
  };

  // Filter clients based on search term (only filters through fetched clients)
  const filteredClients = clients.filter(client =>
    client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    client.lead_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (client.email && client.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (client.phone && client.phone.includes(searchTerm)) ||
    (client.mobile && client.mobile.includes(searchTerm))
  ).sort((a, b) => {
    // Get last message for each client
    let lastMessageA: any = null;
    let lastMessageB: any = null;
    
    if (a.isContact && a.contact_id) {
      lastMessageA = allMessages.filter(m => m.contact_id === a.contact_id).sort((x, y) => new Date(y.sent_at).getTime() - new Date(x.sent_at).getTime())[0];
    } else {
      lastMessageA = allMessages.filter(m => m.lead_id === a.id).sort((x, y) => new Date(y.sent_at).getTime() - new Date(x.sent_at).getTime())[0];
    }
    
    if (b.isContact && b.contact_id) {
      lastMessageB = allMessages.filter(m => m.contact_id === b.contact_id).sort((x, y) => new Date(y.sent_at).getTime() - new Date(x.sent_at).getTime())[0];
    } else {
      lastMessageB = allMessages.filter(m => m.lead_id === b.id).sort((x, y) => new Date(y.sent_at).getTime() - new Date(x.sent_at).getTime())[0];
    }
    
    // If both have messages, sort by latest message time (descending)
    if (lastMessageA && lastMessageB) {
      return new Date(lastMessageB.sent_at).getTime() - new Date(lastMessageA.sent_at).getTime();
    }
    
    // If only one has messages, prioritize it
    if (lastMessageA && !lastMessageB) return -1;
    if (lastMessageB && !lastMessageA) return 1;
    
    // If neither has messages, maintain original order
    return 0;
  });

  // Send new message via WhatsApp API
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('🚀 Send button clicked!', { 
      newMessage: newMessage.trim(), 
      selectedTemplate: selectedTemplate?.title, 
      selectedClient: selectedClient?.name,
      currentUser: currentUser?.email 
    });
    
    if ((!newMessage.trim() && !selectedTemplate) || !selectedClient || !currentUser) {
      console.log('❌ Send blocked:', { 
        hasMessage: !!newMessage.trim(), 
        hasTemplate: !!selectedTemplate, 
        hasClient: !!selectedClient, 
        hasUser: !!currentUser 
      });
      return;
    }

    setSending(true);
    
    // Get phone number from selected contact or client
    let phoneNumber: string | null = null;
    let contactId: number | null = null;
    
    if (selectedContactId && leadContacts.length > 0) {
      const selectedContact = leadContacts.find(c => c.id === selectedContactId);
      if (selectedContact) {
        phoneNumber = selectedContact.phone || selectedContact.mobile || null;
        contactId = selectedContact.id;
      }
    }
    
    // Fallback to client's phone number
    if (!phoneNumber) {
      phoneNumber = selectedClient.phone || selectedClient.mobile || null;
    }
    
    if (!phoneNumber) {
      toast.error('No phone number found for this contact');
      setSending(false);
      return;
    }

    const senderName = currentUser.full_name || currentUser.email;
    
    try {

      // Prepare message payload
      // For contacts, use the associated lead_id; for main leads, use the client id
      const leadIdForMessage = selectedClient.isContact && selectedClient.lead_id 
        ? selectedClient.lead_id 
        : selectedClient.id;
      
      const messagePayload: any = {
        leadId: leadIdForMessage,
        phoneNumber: phoneNumber,
        sender_name: senderName,
        contactId: selectedClient.isContact && selectedClient.contact_id 
          ? selectedClient.contact_id 
          : (contactId || null)
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
        
        // Only add parameters if the template requires them
        if (selectedTemplate.params === '1') {
          // Template requires parameters - send default empty parameters
          // Even if user didn't provide input, we need to send parameters for WhatsApp
          messagePayload.templateParameters = [
            {
              type: 'text',
              text: newMessage.trim() || 'Hello' // User message or default
            }
          ];
          messagePayload.message = newMessage.trim() || 'Template sent';
          console.log('📱 Template with params - sending with templateParameters');
        } else if (selectedTemplate.params === '0') {
          // Template with no parameters - don't include message or templateParameters
          // WhatsApp will send template as-is
          messagePayload.message = `TEMPLATE_MARKER:${selectedTemplate.title}`; // Mark as template for database storage
        }
      } else {
        // Regular message requires message text
        if (!newMessage.trim()) {
          throw new Error('Message is required for non-template messages');
        }
        messagePayload.message = newMessage.trim();
      }

      // Debug: Log the payload being sent
      console.log('📤 Sending message payload:', messagePayload);
      
      // Send message via WhatsApp API
      const apiUrl = buildApiUrl('/api/whatsapp/send-message');
      console.log('🌐 API URL:', apiUrl);
      console.log('📤 Request payload:', JSON.stringify(messagePayload, null, 2));
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messagePayload),
      });

      console.log('📥 Response status:', response.status, response.statusText);
      console.log('📥 Response headers:', Object.fromEntries(response.headers.entries()));
      
      const result = await response.json();
      console.log('📥 Response body:', JSON.stringify(result, null, 2));

      if (!response.ok) {
        console.error('❌ API request failed:', {
          status: response.status,
          statusText: response.statusText,
          result: result
        });
        if (result.code === 'RE_ENGAGEMENT_REQUIRED') {
          throw new Error('⚠️ WhatsApp 24-Hour Rule: You can only send template messages after 24 hours of customer inactivity. The customer needs to reply first to reset the timer.');
        }
        if (result.error && result.error.includes('Template name does not exist')) {
          throw new Error('❌ Template Error: The selected template does not exist in your WhatsApp Business Account. Please check Meta Business Manager to see which templates are actually available, or use a different template.');
        }
        throw new Error(result.error || 'Failed to send message');
      }
      
      console.log('✅ API request successful. Message ID:', result.messageId);
      
      // Immediately after sending, fetch the message from database to verify template_id was saved
      if (result.messageId) {
        console.log('🔍 Verifying template_id was saved in database...');
        setTimeout(async () => {
          try {
            const { data: savedMessage, error: fetchError } = await supabase
              .from('whatsapp_messages')
              .select('id, template_id, whatsapp_message_id, message')
              .eq('whatsapp_message_id', result.messageId)
              .single();
            
            if (fetchError) {
              console.error('❌ Error fetching saved message:', fetchError);
            } else if (savedMessage) {
              console.log('🔍 Message fetched from database:', {
                id: savedMessage.id,
                whatsapp_message_id: savedMessage.whatsapp_message_id,
                template_id: savedMessage.template_id,
                message: savedMessage.message?.substring(0, 50)
              });
              if (selectedTemplate && savedMessage.template_id === null) {
                console.error('❌ CRITICAL: template_id is NULL in database! Expected:', selectedTemplate.id);
                console.error('❌ This means the backend did not save template_id. Check backend logs on Render.com');
              } else if (selectedTemplate && savedMessage.template_id == selectedTemplate.id) {
                console.log('✅ SUCCESS: template_id was saved correctly:', savedMessage.template_id);
              }
            }
          } catch (error) {
            console.error('❌ Error verifying message:', error);
          }
        }, 2000); // Wait 2 seconds for database to be updated
      }
      
      // Add message to local state
      console.log('📤 Sending message with sender:', senderName, 'from user:', currentUser);
      
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
      
      const newMsg: WhatsAppMessage = {
        id: Date.now(), // Temporary ID
        lead_id: selectedClient.id,
        sender_id: currentUser.id,
        sender_name: senderName,
        direction: 'out',
        message: displayMessage,
        sent_at: new Date().toISOString(),
        status: 'sent',
        message_type: 'text',
        whatsapp_status: 'sent',
        whatsapp_message_id: result.messageId,
        template_id: selectedTemplate?.id || undefined // Include template_id for proper matching
      };
      
      console.log('💾 Creating local message object:', {
        id: newMsg.id,
        whatsapp_message_id: newMsg.whatsapp_message_id,
        template_id: newMsg.template_id,
        message: newMsg.message?.substring(0, 50)
      });

      setMessages(prev => [...prev, newMsg]);
      setShouldAutoScroll(true); // Trigger auto-scroll when new message is sent
      setNewMessage('');
      setSelectedTemplate(null); // Clear template selection after sending
      // Reset mobile input focus state
      if (isMobile) {
        setIsInputFocused(false);
        textareaRef.current?.blur();
      }
      toast.success('Message sent via WhatsApp!');
    } catch (error) {
      console.error('Error sending message:', error);
      
      // If template sending failed, offer to send as regular message
      if (selectedTemplate && error instanceof Error && error.message.includes('Template')) {
        // Only offer fallback if there's a message to send
        if (newMessage.trim()) {
          const shouldSendAsRegular = window.confirm(
            `Template sending failed: ${error.message}\n\nWould you like to send this as a regular message instead?`
          );
          
          if (shouldSendAsRegular) {
            // Send as regular message without template
            const regularPayload = {
              leadId: selectedClient.id,
              phoneNumber: phoneNumber,
              sender_name: senderName,
              message: newMessage.trim()
            };
          
            try {
            const regularResponse = await fetch(buildApiUrl('/api/whatsapp/send-message'), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(regularPayload),
            });

            const regularResult = await regularResponse.json();

            if (regularResponse.ok) {
              // Add message to local state
              const newMsg: WhatsAppMessage = {
                id: Date.now(),
                lead_id: selectedClient.id,
                sender_id: currentUser.id,
                sender_name: senderName,
                direction: 'out',
                message: newMessage.trim(),
                sent_at: new Date().toISOString(),
                status: 'sent',
                message_type: 'text',
                whatsapp_status: 'sent',
                whatsapp_message_id: regularResult.messageId
              };

              setMessages(prev => [...prev, newMsg]);
              setShouldAutoScroll(true);
              setNewMessage('');
              setSelectedTemplate(null); // Clear template selection
              toast.success('Message sent as regular text (template failed)');
              return;
            } else {
              throw new Error(regularResult.error || 'Failed to send regular message');
            }
          } catch (regularError) {
            console.error('Error sending regular message:', regularError);
            toast.error('Failed to send as regular message: ' + (regularError as Error).message);
            return;
          }
          }
        }
      }
      
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

  // Fetch all messages on component mount and set up polling
  useEffect(() => {
    const fetchAllMessages = async () => {
      const messages = await getAllMessages();
      if (messages) {
        setAllMessages(messages);
      }
    };
    
    fetchAllMessages();
    
    // Set up polling to refresh all messages every 30 seconds
    const interval = setInterval(() => {
      fetchAllMessages();
    }, 30000);
    
    return () => clearInterval(interval);
  }, []);

  // Get last message for client preview from all messages
  const getLastMessageForClient = (client: Client) => {
    if (client.isContact && client.contact_id) {
      // For contacts, find by contact_id
      return allMessages.find(msg => msg.contact_id === client.contact_id);
    } else {
      // For main leads, find by lead_id
      return allMessages.find(msg => msg.lead_id === client.id);
    }
  };

  // Get unread count for client from all messages
  const getUnreadCountForClient = (client: Client) => {
    let clientMessages: any[] = [];
    
    if (client.isContact && client.contact_id) {
      // For contacts, filter by contact_id
      clientMessages = allMessages.filter(msg => msg.contact_id === client.contact_id);
    } else {
      // For main leads, filter by lead_id
      clientMessages = allMessages.filter(msg => msg.lead_id === client.id);
    }
    
    // Use the same simple logic as WhatsApp Leads Page
    return clientMessages.filter(msg => {
      if (msg.direction !== 'in') return false;
      // Check if message is unread (same logic as WhatsApp Leads Page)
      const isRead = (msg as any).is_read;
      return !isRead || isRead === false;
    }).length;
  };

  // Calculate total unread messages across all clients
  const totalUnreadCount = allMessages.filter(msg => {
    if (msg.direction !== 'in') return false;
    // Use the same simple logic as WhatsApp Leads Page
    const isRead = (msg as any).is_read;
    return !isRead || isRead === false;
  }).length;

  // Handle file selection
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    console.log('📁 File selected:', file);
    if (file) {
      console.log('📁 File details:', {
        name: file.name,
        size: file.size,
        type: file.type
      });
      setSelectedFile(file);
    }
  };

  // Handle emoji selection
  const handleEmojiClick = (emojiObject: any) => {
    const emoji = emojiObject.emoji;
    setNewMessage(prev => prev + emoji);
    setIsEmojiPickerOpen(false);
  };

  // Handle AI suggestions
  const handleAISuggestions = async () => {
    if (!selectedClient || isLoadingAI) return;

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
          clientName: selectedClient.name,
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
      toast.success('Message edited successfully!');
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

  // Send media message
  const handleSendMedia = async () => {
    if (!selectedFile || !selectedClient || !currentUser) {
      console.log('❌ Cannot send media - missing file, client, or user:', { selectedFile, selectedClient, currentUser });
      return;
    }

    console.log('📤 Starting to send media:', {
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
      fileType: selectedFile.type,
      clientId: selectedClient.id,
      clientName: selectedClient.name
    });

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

  // Format date separator (WhatsApp-style)
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

  // Calculate time left in 24-hour window
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

  // Check if a client is locked (24 hours passed since last message)
  const isClientLocked = (lastMessageTime: string) => {
    const lastMessage = new Date(lastMessageTime);
    const now = new Date();
    const diffMs = now.getTime() - lastMessage.getTime();
    const hoursPassed = diffMs / (1000 * 60 * 60);
    return hoursPassed > 24;
  };

  return (
    <div className="fixed inset-0 bg-white z-[9999] overflow-hidden">
      <div className="h-full flex flex-col overflow-hidden" style={{ height: '100vh', maxHeight: '100vh' }}>
        {/* Header */}
        <div className={`flex items-center justify-between p-4 md:p-6 border-b border-gray-200 ${isMobile && isContactsHeaderGlass ? 'bg-white/70 backdrop-blur-md supports-[backdrop-filter]:bg-white/50' : 'bg-white'} ${isMobile && showChat ? 'hidden' : ''}`}>
          <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
            <div className="relative">
              <FaWhatsapp className="w-6 h-6 md:w-8 md:h-8 text-green-600 flex-shrink-0" />
              {totalUnreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {totalUnreadCount > 9 ? '9+' : totalUnreadCount}
                </span>
              )}
            </div>
            <h2 className="text-lg md:text-2xl font-bold text-gray-900 flex-shrink-0">WhatsApp</h2>
            {selectedClient && (
              <div className="hidden md:flex items-center gap-4 min-w-0 flex-1 overflow-hidden">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative">
                    <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse flex-shrink-0"></div>
                    {(isLocked || messages.length === 0) && (
                      <div className="absolute -top-1 -right-1 bg-red-500 rounded-full p-0.5">
                        <LockClosedIcon className="w-2 h-2 text-white" />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-lg font-semibold text-gray-900 truncate">
                      {selectedClient.name}
                    </span>
                    <span className="text-sm text-gray-500 font-mono flex-shrink-0">
                      ({selectedClient.lead_number})
                    </span>
                  </div>
                  {timeLeft && (
                    <div className={`flex items-center gap-1 px-2 py-1 rounded text-sm font-medium ${
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
          <div className="flex items-center gap-2 flex-shrink-0">
            {selectedClient && (
              <button
                onClick={() => {
                  console.log('Navigating to client:', selectedClient.lead_number);
                  // Navigate to client page - this will replace the WhatsApp route in the browser history
                  navigate(`/clients/${selectedClient.lead_number}`);
                }}
                className="btn btn-primary btn-sm gap-2"
                title="View Client Page"
              >
                <UserIcon className="w-4 h-4" />
                <span className="hidden md:inline">View Client</span>
              </button>
            )}
            {!isMobile && (
              <button
                onClick={() => window.history.back()}
                className="btn btn-ghost btn-circle flex-shrink-0"
              >
                <XMarkIcon className="w-5 h-5 md:w-6 md:h-6" />
              </button>
            )}
          </div>
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
              <div className="relative search-container">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search conversations..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Client List Container - Flex column to separate scrollable area from fixed button */}
            <div className="flex flex-col flex-1 min-h-0">
              {/* Scrollable Client List */}
              <div ref={contactListRef} onScroll={handleContactListScroll} className="flex-1 overflow-y-auto min-h-0">
                {loading ? (
                  <div className="flex items-center justify-center h-32">
                    <div className="loading loading-spinner loading-lg text-green-600"></div>
                  </div>
                ) : filteredClients.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    <FaWhatsapp className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                    <p className="text-lg font-medium">
                      {searchTerm.trim() ? 'No clients found' : 'No conversations yet'}
                    </p>
                    <p className="text-sm">
                      {searchTerm.trim() 
                        ? 'No clients match your search criteria' 
                        : 'Start a conversation or search for a client to begin'}
                    </p>
                  </div>
                ) : (
                  filteredClients.map((client) => {
                    const lastMessage = getLastMessageForClient(client);
                    const unreadCount = getUnreadCountForClient(client);
                    const isSelected = selectedClient?.id === client.id;
                    
                    // Check if client has any messages
                    let clientMessages: any[] = [];
                    if (client.isContact && client.contact_id) {
                      // For contacts, filter by contact_id
                      clientMessages = allMessages.filter(m => m.contact_id === client.contact_id);
                    } else {
                      // For main leads, filter by lead_id
                      clientMessages = allMessages.filter(m => m.lead_id === client.id);
                    }
                    const hasNoMessages = clientMessages.length === 0;
                    
                    // Check if client has any incoming messages
                    const incomingMessages = clientMessages.filter(m => m.direction === 'in');
                    const hasNoIncomingMessages = incomingMessages.length === 0;
                    
                    // Get the last incoming message timestamp
                    const lastIncomingMessage = incomingMessages.sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime())[0];
                    const clientLastMessage = lastIncomingMessage?.sent_at || '';
                    
                    // Client is locked if:
                    // 1. No messages at all, OR
                    // 2. No incoming messages (only outgoing), OR
                    // 3. 24 hours have passed since last incoming message
                    const locked = hasNoMessages || hasNoIncomingMessages || (clientLastMessage && isClientLocked(clientLastMessage));

                    return (
                      <div
                        key={client.id}
                        onClick={async () => {
                          console.log(`👤 Selecting WhatsApp client: ${client.name} (ID: ${client.id})`);
                          
                          // Clear previous client's messages immediately
                          setMessages([]);
                          setLoadingMessages(true);
                          setSelectedClient(client);
                          setShouldAutoScroll(true); // Trigger auto-scroll when chat is selected
                          setIsFirstLoad(true); // Mark as first load
                          
                          // If this is a contact, set the contact ID directly
                          if (client.isContact && client.contact_id) {
                            setSelectedContactId(client.contact_id);
                            setLeadContacts([]); // Contacts don't have sub-contacts
                            console.log(`✅ Selected contact: ${client.name} (Contact ID: ${client.contact_id})`);
                          } else {
                            // For main leads, fetch contacts
                            try {
                              const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
                              const leadId = isLegacyLead 
                                ? (typeof client.id === 'string' ? client.id.replace('legacy_', '') : String(client.id))
                                : client.id;
                              
                              const fetchedContacts = await fetchLeadContacts(leadId, isLegacyLead);
                              
                              // Deduplicate contacts by ID to prevent duplicate key warnings
                              const uniqueContacts = fetchedContacts.filter((contact, index, self) => 
                                index === self.findIndex(c => c.id === contact.id)
                              );
                              
                              setLeadContacts(uniqueContacts);
                              
                              // Find the matching contact from the fetched contacts
                              // Try to match by email, phone, or name
                              const matchingContact = uniqueContacts.find(c => 
                                (c.email && client.email && c.email === client.email) ||
                                (c.phone && client.phone && c.phone === client.phone) ||
                                (c.mobile && (client.mobile || client.phone) && c.mobile === (client.mobile || client.phone)) ||
                                (c.name && client.name && c.name === client.name)
                              );
                              
                              if (matchingContact) {
                                console.log(`✅ Found matching contact: ${matchingContact.name} (ID: ${matchingContact.id})`);
                                setSelectedContactId(matchingContact.id);
                              } else if (uniqueContacts.length > 0) {
                                // Fallback to main contact if no match found
                                const mainContact = uniqueContacts.find(c => c.isMain) || uniqueContacts[0];
                                console.log(`⚠️ No exact match, using main contact: ${mainContact.name} (ID: ${mainContact.id})`);
                                setSelectedContactId(mainContact.id);
                              } else {
                                setSelectedContactId(null);
                              }
                            } catch (error) {
                              console.error('Error fetching contacts for selected client:', error);
                              setSelectedContactId(null);
                            }
                          }
                          
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
                          <div className="w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center flex-shrink-0 relative border bg-green-100 border-green-200 text-green-700 shadow-[0_4px_12px_rgba(16,185,129,0.2)] dark:bg-white/15 dark:border-white/30 dark:text-white dark:shadow-[0_4px_12px_rgba(0,0,0,0.35)]">
                            <span className="font-semibold text-sm md:text-lg text-green-700 dark:text-white dark:drop-shadow">
                              {client.name.charAt(0).toUpperCase()}
                            </span>
                            {/* Lock icon overlay */}
                            {locked && (
                              <div className="absolute -bottom-1 -right-1 bg-red-500 rounded-full p-1">
                                <LockClosedIcon className="w-3 h-3 text-white" />
                              </div>
                            )}
                          </div>

                          {/* Client Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <h3 className="font-semibold text-gray-900 truncate text-base md:text-base">
                                  {client.name}
                                </h3>
                                {client.isContact && (
                                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full flex-shrink-0">
                                    Contact
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
                                {lastMessage && (
                                  <span className="text-xs text-gray-500">
                                    {formatLastMessageTime(lastMessage.sent_at)}
                                  </span>
                                )}
                                {unreadCount > 0 && (
                                  <span className="bg-cyan-500 text-white text-xs rounded-full px-1 md:px-2 py-1 min-w-[16px] md:min-w-[20px] text-center shadow-[0_4px_12px_rgba(6,182,212,0.35)]">
                                    {unreadCount}
                                  </span>
                                )}
                              </div>
                            </div>
                            <p className="text-sm md:text-sm text-gray-500 truncate">
                              {client.isContact ? `Contact • ${client.lead_number}` : client.lead_number}
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
              
              {/* New Message Button - Fixed at bottom */}
              <div className="flex-none p-3 border-t border-gray-200 bg-white">
                <button
                  onClick={() => setIsNewMessageModalOpen(true)}
                  className="w-full btn btn-primary btn-sm flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span>New Message</span>
                </button>
              </div>
            </div>
          </div>

          {/* Right Panel - Chat */}
          <div className={`${isMobile ? 'w-full' : 'flex-1'} flex flex-col bg-white ${isMobile && !showChat ? 'hidden' : ''}`} style={isMobile ? { height: '100vh', overflow: 'hidden', position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40 } : {}}>
            {selectedClient ? (
              <>
                {/* Mobile Chat Header - Only visible on mobile when in chat */}
                {isMobile && (
                  <div className={`flex-none flex items-center px-4 py-3 border-b border-gray-200 ${isChatHeaderGlass ? 'bg-white/70 backdrop-blur-md supports-[backdrop-filter]:bg-white/50' : 'bg-white'}`} style={{ zIndex: 40 }}>
                    <button
                      onClick={() => setShowChat(false)}
                      className="btn btn-ghost btn-circle btn-sm flex-shrink-0 mr-3"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <div className="flex items-center gap-2 flex-1 min-w-0 mr-3" style={{ maxWidth: 'calc(100% - 100px)' }}>
                      <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center relative flex-shrink-0">
                        <span className="text-green-600 font-semibold text-sm">
                          {selectedClient.name.charAt(0).toUpperCase()}
                        </span>
                        {(isLocked || messages.length === 0) && (
                          <div className="absolute -bottom-1 -right-1 bg-red-500 rounded-full p-1">
                            <LockClosedIcon className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-gray-900 text-sm truncate">
                          {selectedClient.name}
                        </h3>
                        <p className="text-xs text-gray-500 truncate">
                          {selectedClient.lead_number}
                        </p>
                      </div>
                    </div>
                    {timeLeft && (
                      <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                        isLocked ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                      }`} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
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

            {/* Messages - Scrollable */}
            <div ref={chatMessagesRef} onScroll={handleChatMessagesScroll} className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0 overscroll-contain" style={isMobile ? { flex: '1 1 auto', paddingBottom: showTemplateSelector ? '300px' : '200px', WebkitOverflowScrolling: 'touch' } : {}}>
              {messages.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <FaWhatsapp className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  {loadingMessages ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="loading loading-spinner loading-lg text-green-600"></div>
                      <p className="text-lg font-medium">Loading messages...</p>
                    </div>
                  ) : (
                    <p className="text-lg font-medium">No messages yet</p>
                  )}
                  <p className="text-sm">Start the conversation with {selectedClient.name}</p>
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
                      
                  <div
                    className={`flex flex-col ${message.direction === 'out' ? 'items-end' : 'items-start'}`}
                  >
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
                      className={`group max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-2 shadow-sm relative ${
                        message.direction === 'out'
                          ? isEmojiOnly(message.message)
                            ? 'bg-white text-gray-900'
                            : 'bg-green-600 text-white'
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
                          {/* Message content based on type */}
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
                          
                          {message.message_type === 'button_response' && (
                            <div className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg border border-blue-200">
                              <svg className="w-5 h-5 text-blue-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                              </svg>
                              <p className="text-sm font-medium text-blue-900">{message.message}</p>
                            </div>
                          )}
                          
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
                            <p 
                              className="text-base break-words"
                              dir={message.caption?.match(/[\u0590-\u05FF]/) ? 'rtl' : 'ltr'}
                              style={{ textAlign: message.caption?.match(/[\u0590-\u05FF]/) ? 'right' : 'left' }}
                            >
                              {message.caption}
                            </p>
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
                            <p 
                              className="text-base break-words mt-2"
                              dir={message.caption?.match(/[\u0590-\u05FF]/) ? 'rtl' : 'ltr'}
                              style={{ textAlign: message.caption?.match(/[\u0590-\u05FF]/) ? 'right' : 'left' }}
                            >
                              {message.caption}
                            </p>
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
                            <p className="text-base break-words mt-2">{message.caption}</p>
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
                            <p 
                              className="text-base break-words"
                              dir={message.caption?.match(/[\u0590-\u05FF]/) ? 'rtl' : 'ltr'}
                              style={{ textAlign: message.caption?.match(/[\u0590-\u05FF]/) ? 'right' : 'left' }}
                            >
                              {message.caption}
                            </p>
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
                          <p className="text-base break-words mt-1">{message.message}</p>
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

            {/* Message Input - Fixed with glassy blur on mobile */}
            <div 
              className={`flex-none border-t transition-all duration-200 ${
                isMobile 
                  ? 'bg-white/80 backdrop-blur-lg supports-[backdrop-filter]:bg-white/70 border-gray-300/50' 
                  : 'bg-white border-gray-200'
              }`}
              style={isMobile ? { zIndex: 50, position: 'sticky', bottom: 0, paddingBottom: `calc(30px + env(safe-area-inset-bottom))` } : {}}
            >
              {/* Template Dropdown - Above input on mobile, toggled by icon */}
              {showTemplateSelector && isMobile && (
                <div className="absolute bottom-full left-0 right-0 mb-2 p-3 bg-white/95 backdrop-blur-lg supports-[backdrop-filter]:bg-white/85 rounded-t-xl border-t border-x border-gray-200 shadow-lg max-h-[50vh] overflow-y-auto">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-semibold text-gray-900">Templates</div>
                    <button
                      type="button"
                      onClick={() => setShowTemplateSelector(false)}
                      className="btn btn-ghost btn-xs"
                    >
                      <XMarkIcon className="w-4 h-4" />
                    </button>
                  </div>
                  
                  {/* Search Input */}
                  <div className="mb-3">
                    <input
                      type="text"
                      placeholder="Search templates..."
                      value={templateSearchTerm}
                      onChange={(e) => setTemplateSearchTerm(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                  </div>
                  
                  {/* Templates List */}
                  <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                    {isLoadingTemplates ? (
                      <div className="text-center text-gray-500 py-4">
                        <div className="loading loading-spinner loading-sm"></div>
                        <span className="ml-2">Loading...</span>
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
                          className={`w-full text-left p-2 rounded-lg border transition-colors ${
                            selectedTemplate?.id === template.id 
                              ? 'bg-green-50 border-green-300' 
                              : 'bg-white border-gray-200 hover:bg-white'
                          }`}
                        >
                          <div className="font-medium text-gray-900 text-sm">{template.title}</div>
                          {template.active === 't' ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 mt-1">
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 mt-1">
                              Pending
                            </span>
                          )}
                        </button>
                      ))
                    )}
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
              
              {/* Template Dropdown - Desktop */}
              {!isMobile && showTemplateSelector && (
                <div className="px-4 pt-3 pb-2">
                  <div className="p-3 bg-white rounded-lg border">
                    <div className="text-sm font-medium mb-2">Select Template:</div>
                    
                    <div className="mb-3">
                      <input
                        type="text"
                        placeholder="Search templates..."
                        value={templateSearchTerm}
                        onChange={(e) => setTemplateSearchTerm(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    
                    <div className="max-h-64 overflow-y-auto space-y-2">
                      {isLoadingTemplates ? (
                        <div className="text-center text-gray-500 py-4">
                          <div className="loading loading-spinner loading-sm"></div>
                          <span className="ml-2">Loading templates...</span>
                        </div>
                      ) : (
                        <>
                          {filterTemplates(templates, templateSearchTerm).map((template) => (
                            <button
                              key={template.id}
                              type="button"
                              onClick={() => {
                                if (template.active !== 't') {
                                  toast.error('This template is pending approval and cannot be used yet. Please wait for Meta to approve it or select an active template.');
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
                                  ? 'bg-blue-50 border-blue-300' 
                                  : 'bg-white border-gray-200 hover:bg-white'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="font-medium text-gray-900">{template.title}</div>
                                <div className="flex items-center gap-1">
                                  <span className="text-xs text-gray-500 font-mono">{template.name360}</span>
                                  {template.active === 't' && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                      Active
                                    </span>
                                  )}
                                  {template.active !== 't' && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                      Pending
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="text-sm text-gray-500 mt-1">
                                {template.params === '1' && (
                                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800 mb-2">
                                    Requires Parameter
                                  </span>
                                )}
                                {template.params === '0' && (
                                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 mb-2">
                                    No Parameters
                                  </span>
                                )}
                                {template.content && template.content !== 'EMPTY' && (
                                  <div className="text-xs text-gray-600 mt-1 bg-white p-2 rounded">
                                    <strong>Template Name:</strong> {template.name360}<br/>
                                    <strong>Content:</strong> {template.content}
                                  </div>
                                )}
                              </div>
                            </button>
                          ))}
                          
                          {filterTemplates(templates, templateSearchTerm).length === 0 && (
                            <div className="text-center text-gray-500 py-4">
                              {templateSearchTerm ? 'No templates found matching your search.' : 'No templates available.'}
                            </div>
                          )}
                        </>
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
                      <p className="text-xs text-red-600">More than 24 hours have passed since the client's last message. You can no longer send messages to this contact.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Input Area */}
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
                            onChange={handleFileSelect}
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
                          disabled={isLoadingAI || isLocked || !selectedClient}
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
                        onChange={handleFileSelect}
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
                      disabled={isLoadingAI || isLocked || !selectedClient}
                      className={`flex-shrink-0 px-3 py-2 rounded-full flex items-center justify-center transition-all text-sm font-medium ${
                        isLoadingAI
                          ? 'bg-blue-500 text-white'
                          : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-100'
                      } ${isLocked || !selectedClient ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
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
                  onChange={(e) => {
                    setNewMessage(e.target.value);
                    const textarea = e.target;
                    textarea.style.height = 'auto';
                    // On mobile, when focused or when template/AI content is added, expand to max height
                    if (isMobile && (isInputFocused || selectedTemplate || aiSuggestions.length > 0)) {
                      textarea.style.height = `${Math.min(textarea.scrollHeight, 300)}px`;
                    } else {
                      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
                    }
                  }}
                  onFocus={(e) => {
                    if (isMobile) {
                      setIsInputFocused(true);
                      // Expand to max height when focused on mobile
                      e.target.style.height = 'auto';
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 300)}px`;
                    }
                  }}
                  onBlur={(e) => {
                    if (isMobile) {
                      setIsInputFocused(false);
                      // Reset to normal height when blurred
                      e.target.style.height = 'auto';
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                    }
                  }}
                  onKeyDown={(e) => {
                    // Let Enter create new lines
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
                  className={`flex-1 resize-none rounded-2xl transition-all duration-300 ${
                    isMobile 
                      ? `bg-white/80 backdrop-blur-md border border-gray-300/50 ${isInputFocused ? 'flex-[1.2]' : ''}` 
                      : 'textarea textarea-bordered'
                  } ${isLocked ? 'bg-gray-100/80 cursor-not-allowed' : ''}`}
                  disabled={sending || uploadingMedia || isLocked}
                  rows={1}
                  style={{ 
                    maxHeight: isMobile && (isInputFocused || selectedTemplate || aiSuggestions.length > 0) ? '300px' : '200px', 
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

      {/* New Message Modal */}
      {isNewMessageModalOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-60" onClick={() => setIsNewMessageModalOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col m-4" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-xl font-semibold">New Message</h2>
              <button
                onClick={() => {
                  setIsNewMessageModalOpen(false);
                  setNewMessageSearchTerm('');
                  setNewMessageSearchResults([]);
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
                  placeholder="Search for a contact or lead..."
                  value={newMessageSearchTerm}
                  onChange={(e) => setNewMessageSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  autoFocus
                />
                {isNewMessageSearching && (
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                    <div className="loading loading-spinner loading-sm text-gray-400"></div>
                  </div>
                )}
              </div>
            </div>

            {/* Search Results */}
            <div className="flex-1 overflow-y-auto p-4">
              {!newMessageSearchTerm.trim() ? (
                <div className="text-center py-8 text-gray-500">
                  <FaWhatsapp className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p className="text-lg font-medium">Search for a contact</p>
                  <p className="text-sm">Type a name, email, phone, or lead number to find a contact</p>
                </div>
              ) : isNewMessageSearching ? (
                <div className="flex items-center justify-center py-8">
                  <div className="loading loading-spinner loading-lg text-green-600"></div>
                </div>
              ) : newMessageSearchResults.length > 0 ? (
                <div className="space-y-2">
                  {newMessageSearchResults.map((result, index) => {
                    // Use a more unique key to avoid React key conflicts
                    const uniqueKey = result.lead_type === 'legacy' 
                      ? `legacy_${result.id}_${result.contactName || result.name}_${index}`
                      : `${result.id}_${result.contactName || result.name}_${index}`;
                    
                    const displayName = result.contactName || result.name || '';
                    const displayEmail = result.email || '';
                    const displayPhone = result.phone || result.mobile || '';
                    
                    return (
                      <button
                        key={uniqueKey}
                        onClick={() => handleNewMessageContactClick(result)}
                        className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors rounded-lg border border-gray-200"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                            <span className="font-semibold text-green-700">
                              {displayName.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-gray-900 truncate">
                                {result.isContact && !result.isMainContact ? 'Contact: ' : ''}{displayName}
                              </p>
                              <span className="text-xs text-gray-500 font-mono">{result.lead_number}</span>
                            </div>
                            {displayEmail && (
                              <p className="text-sm text-gray-600 truncate">{displayEmail}</p>
                            )}
                            {displayPhone && (
                              <p className="text-xs text-gray-500 truncate">
                                {displayPhone}
                              </p>
                            )}
                          </div>
                          <FaWhatsapp className="w-5 h-5 text-green-600 flex-shrink-0" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <p className="text-sm">No contacts found</p>
                  <p className="text-xs mt-1">Try a different search term</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WhatsAppPage; 