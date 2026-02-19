import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, PaperAirplaneIcon, FaceSmileIcon, PaperClipIcon, ClockIcon, LockClosedIcon, DocumentTextIcon, DocumentIcon, PhotoIcon, FilmIcon, MusicalNoteIcon, MicrophoneIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import EmojiPicker from 'emoji-picker-react';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { buildApiUrl } from '../lib/api';
import { fetchWhatsAppTemplates, filterTemplates, type WhatsAppTemplate } from '../lib/whatsappTemplates';
import TemplateOptionCard from './whatsapp/TemplateOptionCard';
import { generateTemplateParameters } from '../lib/whatsappTemplateParams';
import { getTemplateParamDefinitions, generateParamsFromDefinitions } from '../lib/whatsappTemplateParamMapping';
import { fetchLeadContacts } from '../lib/contactHelpers';
import type { ContactInfo } from '../lib/contactHelpers';
import { format } from 'date-fns';
import VoiceMessagePlayer from './whatsapp/VoiceMessagePlayer';
import VoiceMessageRecorder from './whatsapp/VoiceMessageRecorder';
import WhatsAppAvatar from './whatsapp/WhatsAppAvatar';
import { useNavigate } from 'react-router-dom';

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
  profile_picture_url?: string | null; // WhatsApp profile picture URL
  voice_note?: boolean; // True if this is a voice note (not regular audio)
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
  const navigate = useNavigate();
  
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
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  
  // Employee state for avatars
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const fixedMessageIdsRef = useRef<Set<number>>(new Set());
  
  // Template state
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<WhatsAppTemplate | null>(null);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [templateSearchTerm, setTemplateSearchTerm] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('');
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
  
  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);
  
  // Mobile input focus state
  const [isInputFocused, setIsInputFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Tools dropdown state
  const [showDesktopTools, setShowDesktopTools] = useState(false);
  const [showMobileDropdown, setShowMobileDropdown] = useState(false);
  const desktopToolsRef = useRef<HTMLDivElement>(null);
  const mobileToolsRef = useRef<HTMLDivElement>(null);
  const templateSelectorRef = useRef<HTMLDivElement>(null);
  
  // Mobile detection
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Expand textarea when template or AI content is added (both desktop and mobile)
  useEffect(() => {
    if (textareaRef.current) {
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
          // Use larger max height when template is present (400px for both, or 300px for mobile without template)
          // If template is cleared, reset to regular height
          if (selectedTemplate && selectedTemplate.params === '0') {
            const maxHeight = 400;
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`;
          } else if (aiSuggestions.length > 0 || newMessage.length > 100) {
            const maxHeight = isMobile ? 300 : 200;
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`;
          } else {
            // Reset to regular height when template is cleared and no long content
            const regularHeight = isMobile ? 200 : 200;
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, regularHeight)}px`;
          }
        }
      }, 0);
    }
  }, [newMessage, selectedTemplate, aiSuggestions, isMobile]);

  // Handle click outside to reset input focus on mobile and close dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      // Don't close if clicking inside template selector
      if (templateSelectorRef.current && templateSelectorRef.current.contains(target)) {
        return;
      }
      
      // Close tools dropdowns
      if (desktopToolsRef.current && !desktopToolsRef.current.contains(target)) {
        setShowDesktopTools(false);
      }
      if (mobileToolsRef.current && !mobileToolsRef.current.contains(target)) {
        setShowMobileDropdown(false);
      }
      
      // Close template selector if clicking outside
      if (showTemplateSelector && templateSelectorRef.current && !templateSelectorRef.current.contains(target)) {
        // Don't close if clicking on the template button itself
        if (!target.closest('button') || !target.closest('button')?.textContent?.includes('Template')) {
          setShowTemplateSelector(false);
        }
      }
      
      // Reset input focus on mobile
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
  }, [isMobile, isInputFocused, showTemplateSelector]);

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

  // Fetch all employees for display name mapping (including photos for avatars)
  useEffect(() => {
    const fetchEmployees = async () => {
      const { data, error } = await supabase
        .from('tenants_employee')
        .select('id, display_name, photo_url, photo')
        .order('display_name', { ascending: true });

      if (error) {
        console.error('Error fetching employees:', error);
      } else {
        setAllEmployees(data || []);
      }
    };
    fetchEmployees();
  }, []);

  // Helper function to get employee initials
  const getEmployeeInitials = (name: string | null | undefined): string => {
    if (!name) return '??';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  // Helper function to get employee by ID or name
  const getEmployeeById = (employeeIdOrName: string | number | null | undefined) => {
    if (!employeeIdOrName || employeeIdOrName === '---' || employeeIdOrName === '--' || employeeIdOrName === '') {
      return null;
    }

    // First, try to match by ID
    const employeeById = allEmployees.find((emp: any) => {
      const empId = typeof emp.id === 'bigint' ? Number(emp.id) : emp.id;
      const searchId = typeof employeeIdOrName === 'string' ? parseInt(employeeIdOrName, 10) : employeeIdOrName;

      if (isNaN(Number(searchId))) return false;

      if (empId.toString() === searchId.toString()) return true;
      if (Number(empId) === Number(searchId)) return true;

      return false;
    });

    if (employeeById) {
      return employeeById;
    }

    // If not found by ID, try to match by display name
    if (typeof employeeIdOrName === 'string') {
      const employeeByName = allEmployees.find((emp: any) => {
        if (!emp.display_name) return false;
        return emp.display_name.trim().toLowerCase() === employeeIdOrName.trim().toLowerCase();
      });

      if (employeeByName) {
        return employeeByName;
      }
    }

    return null;
  };

  // Component to render employee avatar
  const EmployeeAvatar: React.FC<{
    employeeId: string | number | null | undefined;
    size?: 'sm' | 'md' | 'lg';
  }> = ({ employeeId, size = 'sm' }) => {
    const [imageError, setImageError] = useState(false);
    const employee = getEmployeeById(employeeId);
    const sizeClasses = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'md' ? 'w-12 h-12 text-sm' : 'w-16 h-16 text-base';

    if (!employee) {
      return null;
    }

    const photoUrl = employee.photo_url || employee.photo;
    const initials = getEmployeeInitials(employee.display_name);

    // If we know there's no photo URL or we have an error, show initials immediately
    if (imageError || !photoUrl) {
      return (
        <div
          className={`${sizeClasses} rounded-full flex items-center justify-center bg-green-100 text-green-700 font-semibold flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity`}
          onClick={() => {
            if (employee.id) {
              navigate(`/my-profile/${employee.id}`);
            }
          }}
          title={`View ${employee.display_name}'s profile`}
        >
          {initials}
        </div>
      );
    }

    // Try to render image
    return (
      <img
        src={photoUrl}
        alt={employee.display_name}
        className={`${sizeClasses} rounded-full object-cover flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity`}
        onClick={() => {
          if (employee.id) {
            navigate(`/my-profile/${employee.id}`);
          }
        }}
        onError={() => setImageError(true)}
        title={`View ${employee.display_name}'s profile`}
      />
    );
  };

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
      // PRIORITY 1: Match by template_id if available (most reliable)
      if ((message as any).template_id) {
        const template = templates.find(t => t.id === (message as any).template_id);
        if (template) {
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
        }
      }

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
        // PRIORITY 2: Fallback to name matching for backward compatibility (legacy messages without template_id)
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
    
    // Exclude Hebrew text (Unicode range \u0590-\u05FF) - it should not be treated as emoji
    const hasHebrew = /[\u0590-\u05FF]/.test(cleanText);
    if (hasHebrew) return false;
    
    const hasNonAscii = /[^\x00-\x7F]/.test(cleanText);
    const isShort = cleanText.length <= 5;
    
    // Emoji detection: check for emoji Unicode ranges
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/u;
    const hasEmoji = emojiRegex.test(cleanText);
    
    return hasEmoji && isShort && !hasHebrew;
  };

  // Helper function to normalize language codes (en and en_US both become 'en')
  const normalizeLanguage = (lang: string | undefined | null): string => {
    if (!lang) return 'en';
    const normalized = lang.toLowerCase();
    if (normalized === 'en_us' || normalized === 'en') return 'en';
    return normalized;
  };

  // Helper function to get display name for language
  const getLanguageDisplayName = (lang: string): string => {
    const normalized = normalizeLanguage(lang);
    const langMap: { [key: string]: string } = {
      'en': 'English',
      'he': 'Hebrew',
      'fr': 'French',
      'ar': 'Arabic',
      'ru': 'Russian',
      'es': 'Spanish',
      'de': 'German',
      'it': 'Italian',
      'pt': 'Portuguese',
      'zh': 'Chinese',
      'ja': 'Japanese',
      'ko': 'Korean',
      'tr': 'Turkish',
      'pl': 'Polish',
      'nl': 'Dutch',
      'sv': 'Swedish',
      'da': 'Danish',
      'no': 'Norwegian',
      'fi': 'Finnish',
    };
    return langMap[normalized] || lang.toUpperCase();
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

  // Automatically fix message status when whatsapp_message_id exists but status is "failed"
  // This means the message was sent successfully but DB status update failed
  const autoFixMessageStatus = React.useCallback(async (messagesToFix: WhatsAppMessage[]) => {
    const messagesNeedingFix = messagesToFix.filter(
      msg => 
        msg.whatsapp_status === 'failed' && 
        msg.whatsapp_message_id && 
        msg.id &&
        !fixedMessageIdsRef.current.has(msg.id) // Don't re-fix messages we've already fixed
    );

    if (messagesNeedingFix.length === 0) return;

    // Mark these messages as being fixed to prevent duplicate fixes
    messagesNeedingFix.forEach(msg => {
      if (msg.id) fixedMessageIdsRef.current.add(msg.id);
    });

    // Update all messages in batch
    const updatePromises = messagesNeedingFix.map(async (message) => {
      try {
        const { error } = await supabase
          .from('whatsapp_messages')
          .update({
            whatsapp_status: 'delivered', // Update to delivered since message was accepted by WhatsApp
            error_message: null // Clear error message since it was a DB update failure, not a send failure
          })
          .eq('id', message.id);

        if (error) {
          console.error(`Error auto-fixing message status for message ${message.id}:`, error);
          // Remove from fixed set if update failed so we can retry
          if (message.id) fixedMessageIdsRef.current.delete(message.id);
          return null;
        }

        return message.id;
      } catch (error) {
        console.error(`Error auto-fixing message status for message ${message.id}:`, error);
        // Remove from fixed set if update failed so we can retry
        if (message.id) fixedMessageIdsRef.current.delete(message.id);
        return null;
      }
    });

    const fixedIds = (await Promise.all(updatePromises)).filter(Boolean);

    if (fixedIds.length > 0) {
      console.log(`✅ Auto-fixed ${fixedIds.length} message status(es) from "failed" to "delivered"`);
      
      // Update local state to reflect the fix
      setMessages(prevMessages =>
        prevMessages.map(msg =>
          fixedIds.includes(msg.id)
            ? { ...msg, whatsapp_status: 'delivered' as const, error_message: undefined }
            : msg
        )
      );
    }
  }, []);

  const renderMessageStatus = (message?: WhatsAppMessage | { whatsapp_status?: string; whatsapp_message_id?: string; error_message?: string }) => {
    if (!message) return null;

    const status = typeof message === 'string' ? message : message.whatsapp_status;
    const whatsappMessageId = typeof message === 'object' ? message.whatsapp_message_id : undefined;
    const errorMessage = typeof message === 'object' ? message.error_message : undefined;

    if (!status) return null;

    // Special case: If status is "failed" but whatsapp_message_id exists,
    // it means WhatsApp accepted the message, so it was actually delivered
    // but DB status update failed. Show as "delivered" (will be auto-fixed in background).
    // Don't show "failed" in UI if message was actually sent.
    const effectiveStatus = (status === 'failed' && whatsappMessageId) ? 'delivered' : status;

    const baseClasses = "w-7 h-7";

    switch (effectiveStatus) {
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
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: '#3b82f6' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 12l4 4L11 8" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l4 4L17 8" />
          </svg>
        );
      case 'failed':
        // Only show "failed" if message was NOT actually sent (no whatsapp_message_id)
        // If whatsapp_message_id exists, it means message was sent, so we show "delivered" above
        let errorExplanation = 'Message failed to send.';
        if (errorMessage) {
          errorExplanation = `Failed: ${errorMessage}`;
        } else {
          errorExplanation = 'Message failed to send. Possible reasons: Invalid phone number, WhatsApp Business API error, or network issue.';
        }

        return (
          <div className="flex items-center gap-1.5 group relative" title={errorExplanation}>
            <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <span className="text-xs text-red-600 font-medium">Failed</span>
            {/* Tooltip on hover */}
            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 max-w-xs whitespace-normal">
              {errorExplanation}
              <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1">
                <div className="border-4 border-transparent border-t-gray-900"></div>
              </div>
            </div>
          </div>
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
          
          // For legacy leads, fetch from leads_leadinteractions table
          const { data: interactions, error: interactionsError } = await supabase
            .from('leads_leadinteractions')
            .select('*')
            .eq('lead_id', legacyId)
            .eq('kind', 'w') // 'w' for WhatsApp
            .order('cdate', { ascending: true });
          
          if (interactionsError) {
            console.error('Error fetching legacy interactions:', interactionsError);
            // Fallback to whatsapp_messages if leads_leadinteractions fails
            query = query.eq('legacy_id', legacyId);
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
            return;
          }
          
          // Fetch employee display names for creator_ids
          const creatorIds = [...new Set((interactions || [])
            .map((interaction: any) => interaction.creator_id)
            .filter((id: any) => id && id !== '\\N' && id !== 'EMPTY' && id !== null && id !== undefined)
            .map((id: any) => Number(id))
            .filter((id: number) => !isNaN(id))
          )];
          
          let employeeNameMap: Record<number, string> = {};
          if (creatorIds.length > 0) {
            const { data: employees, error: employeeError } = await supabase
              .from('tenants_employee')
              .select('id, display_name')
              .in('id', creatorIds);
            
            if (!employeeError && employees) {
              employeeNameMap = employees.reduce((acc, emp) => {
                acc[emp.id] = emp.display_name;
                return acc;
              }, {} as Record<number, string>);
            }
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
            
            // Get sender name from creator_id
            let senderName = 'Unknown';
            if (interaction.creator_id && interaction.creator_id !== '\\N' && interaction.creator_id !== 'EMPTY') {
              const creatorId = Number(interaction.creator_id);
              if (!isNaN(creatorId) && employeeNameMap[creatorId]) {
                senderName = employeeNameMap[creatorId];
              } else if (!isNaN(creatorId)) {
                senderName = `Employee ${creatorId}`;
              }
            }
            
            return {
              id: interaction.id,
              lead_id: client.id, // Keep the legacy_ prefix for consistency
              sender_name: senderName,
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

  // Auto-fix message statuses when messages are loaded (if status is "failed" but whatsapp_message_id exists)
  useEffect(() => {
    if (messages.length > 0) {
      autoFixMessageStatus(messages);
    }
  }, [messages, autoFixMessageStatus]);

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
        // Ensure templateId is sent as a number (not string) for proper database storage
        messagePayload.templateId = typeof selectedTemplate.id === 'string' ? parseInt(selectedTemplate.id, 10) : selectedTemplate.id;
        messagePayload.templateName = selectedTemplate.name360;
        messagePayload.templateLanguage = selectedTemplate.language || 'en_US';
        
        // Debug log to verify templateId is being sent
        console.log('📤 Template ID being sent:', messagePayload.templateId, '(type:', typeof messagePayload.templateId, ')');
        
        // Generate parameters based on actual param count
        const paramCount = Number(selectedTemplate.params) || 0;
        console.log(`🔍 Template "${selectedTemplate.name360}" requires ${paramCount} parameter(s)`);
        
        if (paramCount > 0) {
          let templateParams: Array<{ type: string; text: string }> = [];
          
          try {
            console.log('🔍 Getting template param definitions...');
            const paramDefinitions = await getTemplateParamDefinitions(selectedTemplate.id, selectedTemplate.name360);
            
            // Create a client object from the client prop
            const clientForParams = client ? {
              id: client.id,
              name: client.name,
              lead_type: client.lead_type || 'new',
              isContact: false
            } : null;
            
            if (paramDefinitions.length > 0) {
              console.log('✅ Using template-specific param definitions');
              templateParams = await generateParamsFromDefinitions(paramDefinitions, clientForParams || {}, contactId || null);
            } else {
              console.log('⚠️ No specific param definitions, using generic generation');
              templateParams = await generateTemplateParameters(paramCount, clientForParams || {}, contactId || null);
            }
            
            if (templateParams && templateParams.length > 0) {
              messagePayload.templateParameters = templateParams;
              
              // Generate the filled template content for display
              let filledContent = selectedTemplate.content || '';
              templateParams.forEach((param, index) => {
                if (param && param.text) {
                  filledContent = filledContent.replace(new RegExp(`\\{\\{${index + 1}\\}\\}`, 'g'), param.text);
                }
              });
              
              messagePayload.message = filledContent || 'Template sent';
              console.log(`✅ Template with ${paramCount} param(s) - auto-filled parameters:`, messagePayload.templateParameters);
              console.log(`✅ Filled template content:`, filledContent);
            } else {
              console.error('❌ Failed to generate template parameters');
              toast.error('Failed to generate template parameters. Please try again.');
              setSending(false);
              return;
            }
          } catch (error) {
            console.error('❌ Error generating template parameters:', error);
            toast.error(`Error generating template parameters: ${error instanceof Error ? error.message : 'Unknown error'}`);
            setSending(false);
            return;
          }
        } else {
          // Template with no parameters
          messagePayload.message = selectedTemplate.content || `TEMPLATE_MARKER:${selectedTemplate.title}`;
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
      
      // Reset textarea height to regular size after sending
      if (textareaRef.current) {
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            const regularHeight = isMobile ? 200 : 200;
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, regularHeight)}px`;
          }
        }, 0);
      }
      
      // Reset mobile input focus state
      if (isMobile) {
        setIsInputFocused(false);
        textareaRef.current?.blur();
      }
      
      // Stage evaluation is handled automatically by database triggers
      
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

  // Send media (optionally with a specific file)
  const handleSendMedia = async (fileOverride?: File) => {
    const fileToSend = fileOverride || selectedFile;
    
    if (!fileToSend || !client || !currentUser) {
      return;
    }

    // Validate file object
    if (!(fileToSend instanceof File) && !(fileToSend instanceof Blob)) {
      console.error('❌ Invalid file object:', fileToSend);
      toast.error('Invalid file. Please try recording again.');
      return;
    }

    // Check if file is WebM format (not supported by WhatsApp)
    const isWebM = fileToSend.type?.includes('webm') || (fileToSend.name && fileToSend.name.endsWith('.webm'));
    if (isWebM) {
      const shouldContinue = window.confirm(
        '⚠️ WebM audio format is not supported by WhatsApp.\n\n' +
        'Your browser recorded in WebM format, which WhatsApp cannot accept.\n\n' +
        'Options:\n' +
        '1. Try recording again - your browser may use a supported format\n' +
        '2. Use Firefox browser which supports OGG/Opus format\n' +
        '3. Cancel and try a different approach\n\n' +
        'Do you want to try sending anyway? (It will likely fail)'
      );
      if (!shouldContinue) {
        if (!fileOverride) setSelectedFile(null);
        return;
      }
    }

    setUploadingMedia(true);
    try {
      const phoneNumber = client.phone || client.mobile;
      if (!phoneNumber) {
        toast.error('No phone number found for this client');
        return;
      }

      const formData = new FormData();
      
      // Ensure we have a proper File object (not just a Blob)
      let fileForUpload: File;
      if (fileToSend instanceof File) {
        fileForUpload = fileToSend;
      } else if (fileToSend instanceof Blob) {
        // Convert Blob to File if needed
        const mimeType = fileToSend.type || 'audio/ogg;codecs=opus';
        const extension = mimeType.includes('ogg') ? 'ogg' : 'webm';
        fileForUpload = new File([fileToSend], `voice_${Date.now()}.${extension}`, { type: mimeType });
      } else {
        throw new Error('Invalid file type');
      }
      
      formData.append('file', fileForUpload);
      formData.append('leadId', client.id);

      const uploadResponse = await fetch(buildApiUrl('/api/whatsapp/upload-media'), {
        method: 'POST',
        body: formData,
      });

      const uploadResult = await uploadResponse.json();

      if (!uploadResponse.ok) {
        throw new Error(uploadResult.error || 'Failed to upload media');
      }

      // Determine media type: check if it's a voice message (audio/webm or audio/ogg) or regular audio
      const isVoiceMessage = fileToSend.type.includes('webm') || fileToSend.type.includes('opus') || fileToSend.type.includes('ogg');
      const mediaType = fileToSend.type.startsWith('image/') 
        ? 'image' 
        : fileToSend.type.startsWith('audio/') || isVoiceMessage
          ? 'audio'
          : 'document';
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
          sender_name: senderName,
          voiceNote: isVoiceMessage // Flag to indicate this is a voice note
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
        message: newMessage.trim() || (isVoiceMessage ? 'Voice message' : `${mediaType} message`),
        sent_at: new Date().toISOString(),
        status: 'sent',
        message_type: mediaType as any,
        whatsapp_status: 'sent',
        whatsapp_message_id: result.messageId,
        media_url: uploadResult.mediaId,
        media_id: uploadResult.mediaId, // Also set media_id for compatibility
        caption: newMessage.trim() || undefined,
        voice_note: isVoiceMessage
      };

      setMessages(prev => [...prev, newMsg]);
      setShouldAutoScroll(true);
      setNewMessage('');
      if (!fileOverride) {
        setSelectedFile(null);
      }
      setShowVoiceRecorder(false); // Close voice recorder if it was open
      
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
      <div className="h-full flex flex-col relative">
        {/* Header */}
        <div className="flex-none flex items-center justify-between p-4 md:p-6 border-b border-gray-200">
          <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
            <FaWhatsapp className="w-6 h-6 md:w-8 md:h-8 text-green-600 flex-shrink-0" />
            {client && (
              <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
                {clientLocked && (
                  <div className="absolute -top-1 -right-1 bg-red-500 rounded-full p-0.5">
                    <LockClosedIcon className="w-2 h-2 text-white" />
                  </div>
                )}
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm md:text-lg font-semibold text-gray-900 truncate">
                    {displayName}
                  </span>
                  <span className="text-xs md:text-sm text-gray-500 font-mono flex-shrink-0">
                    ({client.lead_number})
                  </span>
                </div>
                {timeLeft && (
                  <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                    isLocked ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {isLocked ? (
                      <LockClosedIcon className="w-4 h-4" />
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
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0 overscroll-contain" style={{ paddingBottom: isLocked ? '200px' : '120px', WebkitOverflowScrolling: 'touch' }}>
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
                      <div className="text-sm font-medium px-3 py-1.5 rounded-full border bg-green-100 border-green-200 text-green-700 shadow-[0_4px_12px_rgba(16,185,129,0.2)]">
                        {formatDateSeparator(message.sent_at)}
                      </div>
                    </div>
                  )}
                  
                  <div className={`flex flex-col ${message.direction === 'out' ? 'items-end' : 'items-start'}`}>
                    {message.direction === 'out' && (
                      <div className="flex items-center gap-2 mb-1 mr-2">
                        <span className="text-sm text-gray-600 font-medium">
                          {message.sender_name}
                        </span>
                        <EmployeeAvatar 
                          employeeId={getEmployeeById(message.sender_name)?.id || null}
                          size="md"
                        />
                      </div>
                    )}
                    {message.direction === 'in' && (
                      <div className="mb-1 ml-2">
                        <WhatsAppAvatar
                          name={message.sender_name}
                          profilePictureUrl={message.profile_picture_url}
                          size="md"
                        />
                      </div>
                    )}
                    
                    {/* Image or Emoji-only messages - render outside bubble */}
                    {(message.message_type === 'image' || (message.message_type === 'text' && isEmojiOnly(message.message))) ? (
                      <div className={`flex flex-col ${message.direction === 'out' ? 'items-end ml-auto' : 'items-start'} max-w-xs sm:max-w-md`}>
                        {/* Image content */}
                        {message.message_type === 'image' && message.media_url && (
                          <div className="relative">
                            <img 
                              src={message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`)}
                              alt="Image"
                              className="max-w-full max-h-80 md:max-h-[600px] rounded-lg object-cover"
                              onError={(e) => {
                                e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik01MCAxMDAgTDEwMCA1MCBMMTUwIDEwMCBMMTAwIDE1MCBMNTAgMTAwWiIgZmlsbD0iI0QxRDVEMCIvPgo8dGV4dCB4PSIxMDAiIHk9IjExMCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE0IiBmaWxsPSIjNjc3NDhCIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5JbWFnZSBVbmF2YWlsYWJsZTwvdGV4dD4KPC9zdmc+';
                              }}
                            />
                          </div>
                        )}

                        {/* Emoji-only content */}
                        {message.message_type === 'text' && isEmojiOnly(message.message) && (
                          <div className="text-6xl leading-tight">
                            {message.message}
                          </div>
                        )}

                        {/* Caption for images */}
                        {message.message_type === 'image' && message.caption && (
                          <p className="text-base break-words mt-1">{message.caption}</p>
                        )}

                        {/* Timestamp and read receipts at bottom of image/emoji */}
                        <div className={`flex items-center gap-1 mt-1 ${message.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                          <span className="text-xs text-gray-500">
                            {new Date(message.sent_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                          {message.direction === 'out' && (
                            <span className="inline-block align-middle text-current">
                              {renderMessageStatus(message)}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div
                        className={`group max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-2 shadow-sm ${
                          message.direction === 'out'
                            ? 'bg-green-100 border border-green-200 text-gray-900'
                            : 'bg-white text-gray-900 border border-gray-200'
                        }`}
                      >
                      {message.message_type === 'text' && (
                        <p 
                          className="break-words whitespace-pre-wrap text-base"
                          dir={message.message?.match(/[\u0590-\u05FF]/) ? 'rtl' : 'ltr'}
                          style={{ textAlign: message.message?.match(/[\u0590-\u05FF]/) ? 'right' : 'left' }}
                        >
                          {message.message}
                        </p>
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
                      
                      {/* Voice message */}
                      {(message.message_type === 'audio' || message.voice_note) && (message.media_url || message.media_id) && (
                        <div className="mt-2">
                          <VoiceMessagePlayer
                            audioUrl={(message.media_url || message.media_id || '').startsWith('http') 
                              ? (message.media_url || message.media_id || '') 
                              : buildApiUrl(`/api/whatsapp/media/${message.media_url || message.media_id}`)}
                            className={message.direction === 'out' ? 'bg-green-50' : 'bg-gray-50'}
                            senderName={message.sender_name || 'Unknown'}
                            profilePictureUrl={message.profile_picture_url}
                          />
                          {message.caption && (
                            <p className="text-base break-words mt-2">{message.caption}</p>
                          )}
                          {!message.caption && message.message && (
                            <p className="text-base break-words mt-2">{message.message}</p>
                          )}
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
                              {renderMessageStatus(message)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                      )}
                    </div>
                </React.Fragment>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="absolute bottom-0 left-0 right-0 p-4 z-30 pointer-events-none">
          {/* AI Suggestions Dropdown - Above everything */}
          {showAISuggestions && (
            <div className="mb-2 pointer-events-auto">
              <div className="p-3 bg-gray-50 rounded-lg border shadow-lg max-h-[50vh] overflow-y-auto">
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
          
          {/* Lock Message - Above input field */}
          {isLocked && (
            <div className="mb-2 pointer-events-auto">
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg shadow-md whitespace-nowrap w-fit">
                <LockClosedIcon className="w-4 h-4 text-red-600 flex-shrink-0" />
                <span className="text-xs font-medium text-red-700">24-Hours rule - use templates</span>
              </div>
            </div>
          )}

          {/* Voice Recorder */}
          {showVoiceRecorder && (
            <div className="w-full mb-2 pointer-events-auto">
              <VoiceMessageRecorder
                onRecorded={(audioBlob) => {
                  const mimeType = audioBlob.type || 'audio/webm;codecs=opus';
                  const extension = mimeType.includes('ogg') ? 'ogg' : 'webm';
                  const audioFile = new File([audioBlob], `voice_${Date.now()}.${extension}`, { type: mimeType });
                  setSelectedFile(audioFile);
                  setShowVoiceRecorder(false);
                  handleSendMedia(audioFile);
                }}
                onCancel={() => {
                  setShowVoiceRecorder(false);
                }}
                className="w-full"
              />
            </div>
          )}

          {/* Template Dropdown - Mobile */}
          {showTemplateSelector && isMobile && (
            <>
              {/* Backdrop */}
              <div 
                className="fixed inset-0 bg-black/50 z-[9998]"
                onClick={() => setShowTemplateSelector(false)}
              />
              <div 
                ref={templateSelectorRef} 
                className="pointer-events-auto fixed inset-0 z-[9999] overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="bg-white h-full flex flex-col overflow-hidden">
                  {/* Header with gradient background */}
                  <div className="px-5 py-4 bg-gradient-to-r from-green-500 to-emerald-600 flex-shrink-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FaWhatsapp className="w-5 h-5 text-white" />
                        <h3 className="text-base font-bold text-white">Select Template</h3>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setShowTemplateSelector(false);
                        }}
                        className="btn btn-ghost btn-xs text-white hover:bg-white/20 rounded-full p-1.5 z-50"
                        aria-label="Close template selector"
                      >
                        <XMarkIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  
                  {/* Content */}
                  <div className="p-4 flex-1 flex flex-col min-h-0 overflow-hidden">
                    <div className="mb-4 flex gap-2 flex-shrink-0">
                      <input
                        type="text"
                        placeholder="Search templates..."
                        value={templateSearchTerm}
                        onChange={(e) => setTemplateSearchTerm(e.target.value)}
                        className="flex-1 px-4 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-gray-50 transition-all"
                      />
                      <select
                        value={selectedLanguage}
                        onChange={(e) => setSelectedLanguage(e.target.value)}
                        className="px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-gray-50 transition-all min-w-[120px]"
                      >
                        <option value="">All</option>
                        {Array.from(new Set(templates.map(t => normalizeLanguage(t.language))))
                          .sort()
                          .map(lang => (
                            <option key={lang} value={lang}>
                              {getLanguageDisplayName(lang)}
                            </option>
                          ))}
                      </select>
                    </div>
                    
                    <div className="space-y-3 flex-1 overflow-y-auto">
                      {isLoadingTemplates ? (
                        <div className="text-center text-gray-500 py-4">
                          <div className="loading loading-spinner loading-sm"></div>
                          <span className="ml-2">Loading templates...</span>
                        </div>
                      ) : (() => {
                        let filtered = filterTemplates(templates, templateSearchTerm);
                        if (selectedLanguage) {
                          filtered = filtered.filter(t => normalizeLanguage(t.language) === selectedLanguage);
                        }
                        return filtered;
                      })().length === 0 ? (
                        <div className="text-center text-gray-500 py-4 text-sm">
                          {templateSearchTerm || selectedLanguage ? 'No templates found matching your filters.' : 'No templates available.'}
                        </div>
                      ) : (() => {
                        let filtered = filterTemplates(templates, templateSearchTerm);
                        if (selectedLanguage) {
                          filtered = filtered.filter(t => normalizeLanguage(t.language) === selectedLanguage);
                        }
                        return filtered;
                      })().map((template) => (
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
                            setSelectedLanguage('');
                            if (template.params === '0') {
                              setNewMessage(template.content || '');
                              if (textareaRef.current) {
                                setTimeout(() => {
                                  if (textareaRef.current) {
                                    textareaRef.current.style.height = 'auto';
                                    const maxHeight = isMobile ? 300 : 400;
                                    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`;
                                  }
                                }, 0);
                              }
                            } else {
                              setNewMessage('');
                            }
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Template Dropdown - Desktop */}
          {showTemplateSelector && !isMobile && (
            <div 
              ref={templateSelectorRef} 
              className="pointer-events-auto mb-2 relative z-40" 
              style={{ 
                overflow: 'visible',
                maxHeight: 'calc(100vh - 120px)', // Account for header and input area
                transform: 'translateY(0)',
                top: 'auto',
                bottom: '100%'
              }}
            >
              <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl overflow-hidden min-w-[600px] max-w-[800px] flex flex-col" style={{ maxHeight: 'calc(100vh - 200px)' }}>
                {/* Header with gradient background */}
                <div className="px-6 py-5 bg-gradient-to-r from-green-500 to-emerald-600 flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FaWhatsapp className="w-6 h-6 text-white" />
                      <h3 className="text-lg font-bold text-white">Select Template</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowTemplateSelector(false)}
                      className="btn btn-ghost btn-xs text-white hover:bg-white/20 rounded-full p-2"
                    >
                      <XMarkIcon className="w-5 h-5" />
                    </button>
                  </div>
                </div>
                
                {/* Content */}
                <div className="p-6 flex flex-col flex-1 min-h-0 overflow-hidden">
                  <div className="mb-5 flex gap-3 flex-shrink-0">
                    <input
                      type="text"
                      placeholder="Search templates..."
                      value={templateSearchTerm}
                      onChange={(e) => setTemplateSearchTerm(e.target.value)}
                      className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-gray-50 transition-all"
                    />
                    <select
                      value={selectedLanguage}
                      onChange={(e) => setSelectedLanguage(e.target.value)}
                      className="px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-gray-50 transition-all min-w-[140px]"
                    >
                      <option value="">All Languages</option>
                      {Array.from(new Set(templates.map(t => normalizeLanguage(t.language))))
                        .sort()
                        .map(lang => (
                          <option key={lang} value={lang}>
                            {getLanguageDisplayName(lang)}
                          </option>
                        ))}
                    </select>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto space-y-3 min-h-0" style={{ paddingBottom: '8px' }}>
                    {isLoadingTemplates ? (
                      <div className="text-center text-gray-500 py-4">
                        <div className="loading loading-spinner loading-sm"></div>
                        <span className="ml-2">Loading templates...</span>
                      </div>
                    ) : (() => {
                      let filtered = filterTemplates(templates, templateSearchTerm);
                      if (selectedLanguage) {
                        filtered = filtered.filter(t => normalizeLanguage(t.language) === selectedLanguage);
                      }
                      return filtered;
                    })().length === 0 ? (
                      <div className="text-center text-gray-500 py-4 text-sm">
                        {templateSearchTerm || selectedLanguage ? 'No templates found matching your filters.' : 'No templates available.'}
                      </div>
                    ) : (() => {
                      let filtered = filterTemplates(templates, templateSearchTerm);
                      if (selectedLanguage) {
                        filtered = filtered.filter(t => normalizeLanguage(t.language) === selectedLanguage);
                      }
                      return filtered;
                    })().map((template) => (
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
                          setSelectedLanguage('');
                          if (template.params === '0') {
                            setNewMessage(template.content || '');
                            if (textareaRef.current) {
                              setTimeout(() => {
                                if (textareaRef.current) {
                                  textareaRef.current.style.height = 'auto';
                                  const maxHeight = isMobile ? 300 : 400;
                                  textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`;
                                }
                              }, 0);
                            }
                          } else {
                            setNewMessage('');
                          }
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Voice Recorder */}
          {showVoiceRecorder && (
            <div className="w-full mb-2 pointer-events-auto">
              <VoiceMessageRecorder
                onRecorded={(audioBlob) => {
                  const mimeType = audioBlob.type || 'audio/webm;codecs=opus';
                  const extension = mimeType.includes('ogg') ? 'ogg' : 'webm';
                  const audioFile = new File([audioBlob], `voice_${Date.now()}.${extension}`, { type: mimeType });
                  setSelectedFile(audioFile);
                  setShowVoiceRecorder(false);
                  handleSendMedia(audioFile);
                }}
                onCancel={() => {
                  setShowVoiceRecorder(false);
                }}
                className="w-full"
              />
            </div>
          )}


          {/* Contact Selector - Show if multiple contacts, no pre-selected contact, and not hidden */}
          {!hideContactSelector && !propSelectedContact && leadContacts.length > 1 && (
            <div className="mb-2 px-4 py-2 border-b border-gray-200 bg-gray-50 pointer-events-auto">
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

          {/* Input Field and Buttons */}
          <div className="flex items-end gap-3 relative pointer-events-auto">
            {/* Consolidated Tools Button */}
            <div className="relative" ref={desktopToolsRef}>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowDesktopTools(prev => !prev);
                }}
                disabled={sending || uploadingMedia}
                className="btn btn-circle w-12 h-12 text-white disabled:opacity-50 shadow-lg hover:shadow-xl transition-shadow"
                style={{ background: 'linear-gradient(to bottom right, #059669, #0d9488)', borderColor: 'transparent' }}
                title="Message tools"
              >
                <Squares2X2Icon className="w-6 h-6" />
              </button>
              
              {/* Tools Dropdown Menu */}
              {showDesktopTools && (
                <div className="absolute bottom-full left-0 mb-2 z-50 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[180px]">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      console.log('Template button clicked, opening template selector');
                      setShowTemplateSelector(true);
                      setShowDesktopTools(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors"
                  >
                    <DocumentTextIcon className="w-5 h-5 text-green-600" />
                    <span className="text-sm text-gray-700">Template</span>
                  </button>
                  <label className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors cursor-pointer">
                    <PaperClipIcon className="w-5 h-5" style={{ color: '#3E28CD' }} />
                    <span className="text-sm text-gray-700">Attach File</span>
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,audio/*,video/*"
                      onChange={handleFileSelect}
                      disabled={uploadingMedia || isLocked}
                    />
                  </label>
                  <button
                    onClick={() => {
                      setShowVoiceRecorder(!showVoiceRecorder);
                      setShowDesktopTools(false);
                    }}
                    disabled={isLocked}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors disabled:opacity-50"
                  >
                    <MicrophoneIcon className="w-5 h-5 text-red-600" />
                    <span className="text-sm text-gray-700">Voice Message</span>
                  </button>
                  <button
                    onClick={() => {
                      setIsEmojiPickerOpen(!isEmojiPickerOpen);
                      setShowDesktopTools(false);
                    }}
                    disabled={isLocked}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors disabled:opacity-50"
                  >
                    <FaceSmileIcon className="w-5 h-5" style={{ color: '#3E28CD' }} />
                    <span className="text-sm text-gray-700">Add Emoji</span>
                  </button>
                  <button
                    onClick={() => {
                      handleAISuggestions();
                      setShowDesktopTools(false);
                    }}
                    disabled={isLoadingAI || isLocked || !client}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors disabled:opacity-50"
                  >
                    {isLoadingAI ? (
                      <div className="loading loading-spinner loading-xs"></div>
                    ) : (
                      <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    )}
                    <span className="text-sm text-gray-700">AI Suggestions</span>
                  </button>
                </div>
              )}
            </div>
            
            <div className="relative">
              {/* Emoji Picker */}
              {isEmojiPickerOpen && (
                <div className="absolute bottom-full left-0 mb-2 z-50">
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
            
            <div className="flex-1">
              <textarea
                ref={textareaRef}
                value={newMessage}
                onChange={(e) => {
                  setNewMessage(e.target.value);
                  const textarea = e.target;
                  textarea.style.height = 'auto';
                  const maxHeight = selectedTemplate && selectedTemplate.params === '0' ? 400 : 200;
                  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
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
                className="textarea w-full resize-none min-h-[44px] border border-white/30 rounded-2xl focus:border-white/50 focus:outline-none"
                rows={1}
                disabled={sending || uploadingMedia || isLocked}
                style={{ 
                  backgroundColor: 'rgba(255, 255, 255, 0.8)', 
                  backdropFilter: 'blur(10px)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                  maxHeight: selectedTemplate && selectedTemplate.params === '0' ? '400px' : '128px'
                }}
              />
            </div>
            
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                if (selectedFile) {
                  handleSendMedia();
                } else {
                  const syntheticEvent = {
                    preventDefault: () => {},
                    stopPropagation: () => {},
                    currentTarget: e.currentTarget,
                    target: e.target,
                  } as React.FormEvent;
                  handleSendMessage(syntheticEvent);
                }
              }}
              disabled={(!newMessage.trim() && !selectedTemplate && !selectedFile) || sending || uploadingMedia}
              className="btn btn-circle w-12 h-12 text-white shadow-lg hover:shadow-xl transition-shadow disabled:opacity-50"
              style={{ background: 'linear-gradient(to bottom right, #059669, #0d9488)', borderColor: 'transparent' }}
              title={selectedFile ? 'Send media' : 'Send message'}
            >
              {sending || uploadingMedia ? (
                <div className="loading loading-spinner loading-sm"></div>
              ) : (
                <PaperAirplaneIcon className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SchedulerWhatsAppModal;