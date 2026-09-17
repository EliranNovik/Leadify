import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, PaperAirplaneIcon, FaceSmileIcon, PaperClipIcon, ClockIcon, LockClosedIcon, LockOpenIcon, DocumentTextIcon, DocumentIcon, PhotoIcon, FilmIcon, MusicalNoteIcon, MicrophoneIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import EmojiPicker from 'emoji-picker-react';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { fetchAiMessageSuggestion } from '../lib/aiMessageSuggestion';
import { buildApiUrl } from '../lib/api';
import { useAdminRole } from '../hooks/useAdminRole';
import { normalizeMessageUrlsForLinkify } from '../lib/normalizeMessageUrlsForLinkify';
import {
  fetchWhatsAppTemplates,
  type WhatsAppTemplate,
} from '../lib/whatsappTemplates';
import WhatsAppTemplatePicker from './whatsapp/WhatsAppTemplatePicker';
import { generateTemplateParameters } from '../lib/whatsappTemplateParams';
import { getTemplateParamDefinitions, generateParamsFromDefinitions } from '../lib/whatsappTemplateParamMapping';
import {
  applyWhatsAppFetchedMessages,
  createOptimisticOutgoingWhatsAppMessage,
  resolveOutgoingTemplateDisplayMessage,
  sortWhatsAppMessagesBySentAt,
} from '../lib/whatsappOptimisticMessage';
import { fetchLeadContacts } from '../lib/contactHelpers';
import type { ContactInfo } from '../lib/contactHelpers';
import { format } from 'date-fns';
import VoiceMessagePlayer from './whatsapp/VoiceMessagePlayer';
import VoiceMessageRecorder from './whatsapp/VoiceMessageRecorder';
import WhatsAppAvatar from './whatsapp/WhatsAppAvatar';
import { collectWhatsAppPhoneVariants, whatsAppPhonesMatch } from '../lib/whatsappPhone';
import { fetchWhatsAppRowsPaged } from '../lib/whatsappChatMessages';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { useNavigate } from 'react-router-dom';
import {
  WHATSAPP_OUTGOING_BUBBLE_CLASS,
  WHATSAPP_OUTGOING_MESSAGE_GRADIENT,
  WHATSAPP_OUTGOING_TEXT_COLOR,
  WHATSAPP_OUTGOING_VOICE_PLAYER_CLASS,
  WHATSAPP_CHAT_HEADER_GLASS_CLASS,
  WHATSAPP_CHAT_THREAD_BG_CLASS,
  WHATSAPP_CHAT_BUBBLE_WIDTH_CLASS,
  WHATSAPP_CHAT_BUBBLE_META_CLASS,
  WHATSAPP_BUBBLE_TEXT_CLASS,
  whatsAppChatBubbleAlignClass,
  WHATSAPP_COMPOSER_FIELD_CLASS,
  WHATSAPP_COMPOSER_TEXTAREA_CLASS,
  WHATSAPP_COMPOSER_TOOLS_BTN_CLASS,
  WHATSAPP_COMPOSER_SEND_BTN_CLASS,
  growWhatsAppComposerTextarea,
  whatsAppComposerDir,
  whatsAppComposerMaxHeightPx,
  WHATSAPP_READ_RECEIPT_COLOR,
  WHATSAPP_SENT_RECEIPT_COLOR,
  type WhatsAppMessageLinkStyle,
  whatsAppMessageLinkColor,
  whatsAppMessageLinkFontWeight,
  WHATSAPP_MESSAGE_BOLD_FONT_WEIGHT,
} from '../lib/whatsappOutgoingMessageStyle';
import {
  isPexWhatsAppThread,
  WhatsAppPexComposerHint,
  WhatsAppPexUnlockMenuItem,
  WhatsAppTemplateMenuItem,
  WhatsAppWindowLockBanner,
  whatsAppComposerLocked,
  whatsAppComposerTextDisabled,
  whatsAppLockedPlaceholder,
  whatsAppSendBlockedByWindow,
  whatsAppSendResultToast,
  whatsAppDispatchSucceeded,
  PEX_TEMPLATES_UNAVAILABLE,
  resolveWhatsAppOutgoingSenderUi,
} from '../lib/pexWhatsAppChat';

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
  template_id?: number;
  contact_id?: number | null;
  phone_number?: string | null;
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
    wa_window_expires_at?: string | null;
  };
  selectedContact?: {
    contact: ContactInfo;
    leadId: string | number;
    leadType: 'legacy' | 'new';
  } | null;
  onClientUpdate?: () => Promise<void>;
  hideContactSelector?: boolean; // Hide contact selector dropdown
  showContactSidebar?: boolean; // Show a left sidebar listing all of the lead's contacts (WhatsApp-page style)
}

const SchedulerWhatsAppModal: React.FC<SchedulerWhatsAppModalProps> = ({ isOpen, onClose, client, selectedContact: propSelectedContact, onClientUpdate, hideContactSelector = false, showContactSidebar = false }) => {
  const { isSuperUser } = useAdminRole();
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
  const [waRealtimeNonce, setWaRealtimeNonce] = useState(0);
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
  const [pexWindowUnlocked, setPexWindowUnlocked] = useState(false);
  const [pexWaWindow, setPexWaWindow] = useState<string | null>(client?.wa_window_expires_at || null);

  // Auto-scroll state
  const [shouldAutoScroll, setShouldAutoScroll] = useState(false);
  const [isFirstLoad, setIsFirstLoad] = useState(true);

  // State for lead contacts (all contacts associated with the client)
  const [leadContacts, setLeadContacts] = useState<ContactInfo[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);

  // Sidebar: all of the lead's contacts (loaded independently of leadContacts which may be a single
  // prop-selected contact) + the contact the user clicked in the sidebar (overrides propSelectedContact).
  const [sidebarContacts, setSidebarContacts] = useState<ContactInfo[]>([]);
  const [activeContactOverride, setActiveContactOverride] = useState<ContactInfo | null>(null);
  // Per-contact last message preview for the sidebar: contactId -> { text, time }
  const [contactLastMessages, setContactLastMessages] = useState<Record<number, { text: string; time: string }>>({});

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

  useEffect(() => {
    growWhatsAppComposerTextarea(textareaRef.current, {
      minPx: 40,
      maxPx: whatsAppComposerMaxHeightPx(selectedTemplate),
    });
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
            .select('id, full_name, email, tenants_employee!users_employee_id_fkey(display_name)')
            .eq('email', user.email)
            .single();

          if (userRow) {
            const emp = Array.isArray((userRow as any).tenants_employee) ? (userRow as any).tenants_employee[0] : (userRow as any).tenants_employee;
            const displayName = emp?.display_name;
            setCurrentUser({
              id: userRow.id,
              full_name: displayName || userRow.full_name || userRow.email,
              email: userRow.email,
            });
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
      // A freshly clicked interaction should reset the sidebar's active contact to it
      setActiveContactOverride(propSelectedContact.contact);
      // Clear messages when contact changes to force refetch
      setMessages([]);
    } else if (isOpen && hideContactSelector) {
      // If modal is open with hideContactSelector but no propSelectedContact, 
      // it means we're waiting for it - don't clear selectedContactId yet
      console.log('⏳ Waiting for propSelectedContact to be set...');
    } else if (!isOpen) {
      // Only clear if modal is closed
      setSelectedContactId(null);
      setActiveContactOverride(null);
    }
  }, [propSelectedContact, isOpen, hideContactSelector]);

  // Sidebar: load ALL of the lead's contacts (independent of the single prop-selected contact)
  useEffect(() => {
    if (!showContactSidebar || !isOpen || !client) {
      setSidebarContacts([]);
      return;
    }
    let cancelled = false;
    const loadSidebarContacts = async () => {
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      const leadId = isLegacyLead
        ? (typeof client.id === 'string' ? client.id.replace('legacy_', '') : String(client.id))
        : client.id;
      try {
        const contacts = await fetchLeadContacts(leadId, isLegacyLead);
        if (cancelled) return;
        setSidebarContacts(contacts);

        // Build per-contact last-message preview from this lead's WhatsApp messages
        let msgQuery = supabase
          .from('whatsapp_messages')
          .select('message, caption, message_type, sent_at, direction, contact_id, phone_number');
        if (isLegacyLead) {
          msgQuery = msgQuery.eq('legacy_id', parseInt(String(client.id).replace('legacy_', '')));
        } else {
          msgQuery = msgQuery.eq('lead_id', client.id);
        }
        const { data: allMsgs } = await msgQuery.order('sent_at', { ascending: false }).limit(800);
        if (cancelled) return;

        const normalizePhone = (phone: string) => (phone || '').replace(/\D/g, '');
        const previews: Record<number, { text: string; time: string }> = {};
        (allMsgs || []).forEach((msg: any) => {
          const matched = contacts.find((c) => {
            if (msg.contact_id != null && c.id === msg.contact_id) return true;
            const cPhone = normalizePhone(c.phone || c.mobile || '');
            const mPhone = normalizePhone(msg.phone_number || '');
            if (!cPhone || !mPhone) return false;
            if (cPhone === mPhone) return true;
            return cPhone.length >= 4 && mPhone.length >= 4 && cPhone.slice(-4) === mPhone.slice(-4);
          });
          if (!matched) return;
          const rawText =
            msg.message_type === 'image'
              ? (msg.caption || '📷 Photo')
              : msg.message_type === 'audio' || msg.message_type === 'voice'
                ? '🎤 Voice message'
                : (msg.message || '');
          const prefix = msg.direction === 'out' ? 'You: ' : '';
          previews[matched.id] = {
            text: `${prefix}${rawText}`.trim(),
            time: msg.sent_at,
          };
        });
        setContactLastMessages(previews);
      } catch (e) {
        console.warn('[SchedulerWhatsAppModal] failed to load sidebar contacts:', e);
        if (!cancelled) {
          setSidebarContacts([]);
          setContactLastMessages({});
        }
      }
    };
    loadSidebarContacts();
    return () => {
      cancelled = true;
    };
  }, [showContactSidebar, isOpen, client?.id, client?.lead_type]);

  const formatSidebarTimestamp = (iso: string): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  const handleSidebarContactSelect = (contact: ContactInfo) => {
    setActiveContactOverride(contact);
    setSelectedContactId(contact.id);
    setMessages([]);
    setShouldAutoScroll(true);
    setIsFirstLoad(true);
  };

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

  // Helper function to convert URLs, email addresses, and bold formatting in text
  const renderTextWithLinks = (text: string, linkStyle: WhatsAppMessageLinkStyle = 'default'): React.ReactNode => {
    if (!text) return text;

    // Process links (URLs and emails)
    const processLinks = (input: string, startKey: number = 0): (string | React.ReactElement)[] => {
      input = normalizeMessageUrlsForLinkify(input);
      const linkRegex = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|mailto:[^\s<>"']+|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s<>"']*)?)/gi;
      const parts: (string | React.ReactElement)[] = [];
      let lastIndex = 0;
      let match;
      let keyCounter = startKey;

      linkRegex.lastIndex = 0;

      while ((match = linkRegex.exec(input)) !== null) {
        // Add text before the link
        if (match.index > lastIndex) {
          parts.push(input.substring(lastIndex, match.index));
        }

        // Determine if it's an email or URL
        const matchedText = match[0];
        let href = matchedText;
        let displayText = matchedText;
        const hasHttpScheme = /^https?:\/\//i.test(matchedText);
        const hasMailtoScheme = /^mailto:/i.test(matchedText);

        if (matchedText.includes('@') && !hasHttpScheme && !hasMailtoScheme) {
          // It's an email address
          href = `mailto:${matchedText}`;
          displayText = matchedText;
        } else if (hasMailtoScheme) {
          // Already has mailto: prefix
          href = matchedText;
          displayText = matchedText.replace(/^mailto:/i, '');
        } else if (!hasHttpScheme && !hasMailtoScheme) {
          // It's a URL without protocol
          href = `https://${matchedText}`;
          displayText = matchedText;
        }

        // Replace long URLs with "Meeting Link" text
        if (/^https?:\/\//i.test(href)) {
          if (
            matchedText.length > 50 ||
            /teams\.microsoft\.com/i.test(href) ||
            href.includes('meetup-join') ||
            href.includes('meeting')
          ) {
            displayText = 'Meeting Link';
          }
        }

        parts.push(
          <a
            key={`link-${keyCounter++}`}
            href={href}
            target={href.startsWith('mailto:') ? undefined : '_blank'}
            rel={href.startsWith('mailto:') ? undefined : 'noopener noreferrer'}
            className="hover:underline break-all"
            dir="ltr"
            style={{
              color: whatsAppMessageLinkColor(linkStyle),
              wordBreak: 'break-all',
              overflowWrap: 'anywhere',
              hyphens: 'auto',
              maxWidth: '100%',
              whiteSpace: 'normal',
              display: 'inline',
              fontWeight: whatsAppMessageLinkFontWeight(linkStyle),
              lineBreak: 'anywhere',
              unicodeBidi: 'isolate',
            }}
          >
            {displayText}
          </a>
        );

        lastIndex = match.index + match[0].length;
      }

      // Add remaining text
      if (lastIndex < input.length) {
        parts.push(input.substring(lastIndex));
      }

      return parts;
    };

    // Process bold formatting (*text*) and links together
    const processBoldAndLinks = (input: string, startKey: number = 0): (string | React.ReactElement)[] => {
      const boldRegex = /\*([^*]+)\*/g;
      const parts: (string | React.ReactElement)[] = [];
      let lastIndex = 0;
      let match;
      let keyCounter = startKey;

      boldRegex.lastIndex = 0;

      while ((match = boldRegex.exec(input)) !== null) {
        // Add text before the bold (process links in it)
        if (match.index > lastIndex) {
          const beforeText = input.substring(lastIndex, match.index);
          const processedBefore = processLinks(beforeText, keyCounter);
          parts.push(...processedBefore);
          // Update key counter based on links added
          keyCounter += processedBefore.filter(p => React.isValidElement(p)).length;
        }

        // Add the bold text (also process links inside bold text)
        const boldContent = match[1];
        const processedBold = processLinks(boldContent, keyCounter);
        if (processedBold.length === 1 && typeof processedBold[0] === 'string') {
          // No links in bold, just make it bold
          parts.push(
            <strong key={`bold-${keyCounter++}`} style={{ fontWeight: WHATSAPP_MESSAGE_BOLD_FONT_WEIGHT }}>
              {boldContent}
            </strong>
          );
        } else {
          // Has links in bold, wrap in strong
          parts.push(
            <strong key={`bold-${keyCounter++}`} style={{ fontWeight: WHATSAPP_MESSAGE_BOLD_FONT_WEIGHT }}>
              {processedBold}
            </strong>
          );
          keyCounter += processedBold.filter(p => React.isValidElement(p)).length;
        }

        lastIndex = match.index + match[0].length;
      }

      // Add remaining text (process links in it)
      if (lastIndex < input.length) {
        const remainingText = input.substring(lastIndex);
        parts.push(...processLinks(remainingText, keyCounter));
      } else if (parts.length === 0) {
        // No bold found, process links in the whole text
        return processLinks(input, 0);
      }

      return parts;
    };

    // Start processing with bold formatting
    const result = processBoldAndLinks(text);

    // If no formatting found, return original text
    if (result.length === 0) {
      return text;
    }

    // If only one part and it's a string, return it directly
    if (result.length === 1 && typeof result[0] === 'string') {
      return result[0];
    }

    return <>{result}</>;
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

    const whatsappMessageId = typeof message === 'object' ? message.whatsapp_message_id : undefined;
    const errorMessage = typeof message === 'object' ? message.error_message : undefined;
    const status = (typeof message === 'string' ? message : message.whatsapp_status) || (whatsappMessageId ? 'delivered' : 'sent');

    // Special case: If status is "failed" but whatsapp_message_id exists,
    // but DB status update failed. Show as "delivered" (will be auto-fixed in background).
    // Don't show "failed" in UI if message was actually sent.
    const effectiveStatus = (status === 'failed' && whatsappMessageId) ? 'delivered' : status;

    const baseClasses = "w-3.5 h-3.5";

    switch (effectiveStatus) {
      case 'sent':
      case 'pending':
        return (
          <svg className={baseClasses} fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: WHATSAPP_SENT_RECEIPT_COLOR }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'delivered':
        return (
          <svg className={baseClasses} fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: WHATSAPP_SENT_RECEIPT_COLOR }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'read':
        return (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: WHATSAPP_READ_RECEIPT_COLOR }}>
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

  useRealtimeRefresh({
    channelName: `scheduler-whatsapp-${client?.id || 'none'}`,
    enabled: Boolean(isOpen && client?.id),
    debounceMs: 300,
    tables: [
      {
        table: 'whatsapp_messages',
        match: (payload) => {
          const row = (payload.new || payload.old) as Record<string, unknown> | null;
          if (!row || !client?.id) return false;
          const isLegacyLead = client.lead_type === 'legacy' || String(client.id).startsWith('legacy_');
          if (isLegacyLead) {
            const legacyId = parseInt(String(client.id).replace('legacy_', ''), 10);
            return Number(row.legacy_id) === legacyId;
          }
          return String(row.lead_id || '') === String(client.id);
        },
      },
    ],
    onChange: () => setWaRealtimeNonce((n) => n + 1),
  });

  // Fetch messages
  useEffect(() => {
    const fetchMessages = async (isPolling = false) => {
      if (!client?.id || !isOpen) {
        setMessages([]);
        return;
      }

      // If hideContactSelector is true and we're expecting a propSelectedContact but don't have it yet, wait
      // This prevents fetching messages with client's phone when a contact should be selected
      if (hideContactSelector && !propSelectedContact && !activeContactOverride && !selectedContactId && !isPolling) {
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
        // (unless the user explicitly picked a contact in the sidebar — activeContactOverride)
        if (hideContactSelector && !propSelectedContact && !activeContactOverride && !isPolling) {
          console.log('⏳ Waiting for propSelectedContact (hideContactSelector=true)...');
          return;
        }

        // Priority: sidebar override > propSelectedContact > selectedContactId.
        // activeContactOverride lets the left sidebar switch the conversation even when a
        // propSelectedContact was provided by the parent.
        const selectedContact =
          activeContactOverride ||
          propSelectedContact?.contact ||
          (selectedContactId ? (sidebarContacts.find(c => c.id === selectedContactId) || leadContacts.find(c => c.id === selectedContactId)) : null);
        const contactId = selectedContact?.id || null;

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
            const phones = collectWhatsAppPhoneVariants([
              contactPhone,
              selectedContact.mobile,
              selectedContact.phone,
              client?.phone,
              client?.mobile,
            ]);

            let allMessages: any[] = [];
            if (isLegacyLead) {
              const legacyId = parseInt(client.id.replace('legacy_', ''));
              allMessages = await fetchWhatsAppRowsPaged(supabase, { legacyId });
            } else {
              allMessages = await fetchWhatsAppRowsPaged(supabase, { leadId: String(client.id) });
            }

            const matchesThread = (msg: any) => {
              if (contactId && Number(msg.contact_id) === Number(contactId)) return true;
              if (msg.phone_number && phones.some((p) => whatsAppPhonesMatch(msg.phone_number, p))) {
                return true;
              }
              return false;
            };

            let filteredMessages = allMessages.filter(matchesThread);

            if (filteredMessages.length === 0 && phones.length > 0) {
              if (isLegacyLead) {
                const legacyId = parseInt(client.id.replace('legacy_', ''));
                filteredMessages = await fetchWhatsAppRowsPaged(supabase, {
                  legacyId: Number.isNaN(legacyId) ? null : legacyId,
                  phones,
                });
              } else {
                filteredMessages = await fetchWhatsAppRowsPaged(supabase, {
                  leadId: String(client.id),
                  phones,
                });
              }
            }

            if (filteredMessages.length > 0 || allMessages) {
              console.log(
                `📱 Filtered ${filteredMessages.length} messages for contact ${selectedContact.name} (phone: ${contactPhone})`,
              );

              const processedMessages = filteredMessages.map(processTemplateMessage);
              setMessages((prevMessages) =>
                applyWhatsAppFetchedMessages(processedMessages, prevMessages, isPolling),
              );
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

          // For legacy leads, fetch from leads_leadinteractions with optional creator join
          let result = await supabase
            .from('leads_leadinteractions')
            .select(`id, cdate, date, time, content, description, creator_id, direction, kind,
              creator_employee:tenants_employee!leads_leadinteractions_creator_id_fkey(id, display_name, official_name)`)
            .eq('lead_id', legacyId)
            .eq('kind', 'w')
            .order('cdate', { ascending: true });
          let interactions: any[] | null = result.data;
          const interactionsError = result.error;
          if (interactionsError) {
            const fallback = await supabase
              .from('leads_leadinteractions')
              .select('id, cdate, date, time, content, description, creator_id, direction, kind')
              .eq('lead_id', legacyId)
              .eq('kind', 'w')
              .order('cdate', { ascending: true });
            interactions = fallback.data as any[] | null;
            if (fallback.error) {
              console.error('Error fetching legacy interactions:', fallback.error);
              const data = await fetchWhatsAppRowsPaged(supabase, { legacyId });
              const processedMessages = (data || []).map(processTemplateMessage);
              setMessages((prevMessages) =>
                applyWhatsAppFetchedMessages(processedMessages, prevMessages, isPolling),
              );
              return;
            }
          }

          const creatorIds = [...new Set((interactions || [])
            .map((i: any) => i.creator_id)
            .filter((id: any) => id && id !== '\\N' && id !== 'EMPTY' && id != null)
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
              employeeNameMap = (employees as { id: number; display_name: string | null }[]).reduce((acc, emp) => {
                if (emp.display_name) acc[emp.id] = emp.display_name;
                return acc;
              }, {} as Record<number, string>);
            }
          }

          const fromJoin = (rel: any) => {
            const r = Array.isArray(rel) ? rel[0] : rel;
            const name = r?.display_name ?? r?.official_name;
            return name && String(name).trim() ? String(name).trim() : null;
          };

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

            // Get sender name from join (creator_employee) or fallback to employeeNameMap
            let senderName = 'Unknown';
            if (interaction.creator_id && interaction.creator_id !== '\\N' && interaction.creator_id !== 'EMPTY') {
              const fromJoinName = fromJoin(interaction.creator_employee);
              const creatorId = Number(interaction.creator_id);
              if (fromJoinName) {
                senderName = fromJoinName;
              } else if (!isNaN(creatorId) && employeeNameMap[creatorId]) {
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

          setMessages((prevMessages) =>
            applyWhatsAppFetchedMessages(processedMessages, prevMessages, isPolling),
          );
          return;
        }

        let rows = await fetchWhatsAppRowsPaged(supabase, { leadId: String(client.id) });
        if (rows.length === 0) {
          const phones = collectWhatsAppPhoneVariants([client?.phone, client?.mobile]);
          if (phones.length) {
            rows = await fetchWhatsAppRowsPaged(supabase, {
              leadId: String(client.id),
              phones,
            });
          }
        }

        const processedMessages = rows.map(processTemplateMessage);

        setMessages((prevMessages) =>
          applyWhatsAppFetchedMessages(processedMessages, prevMessages, isPolling),
        );

        // Mark incoming messages as read
        if (currentUser && rows.length > 0 && !isPolling) {
          const incomingMessageIds = rows
            .filter(msg => msg.direction === 'in' && (!(msg as any).is_read || (msg as any).is_read === false))
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

                // Immediately update messages state to reflect read status
                setMessages(prev => prev.map(msg =>
                  incomingMessageIds.includes(msg.id)
                    ? { ...msg, is_read: true }
                    : msg
                ));
              }
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
  }, [isOpen, client?.id, currentUser, shouldAutoScroll, isFirstLoad, templates, selectedContactId, propSelectedContact, hideContactSelector, activeContactOverride, waRealtimeNonce]);

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

  useEffect(() => {
    const leadId = client?.id;
    if (!isOpen || !leadId || client?.lead_type === 'legacy' || String(leadId).startsWith('legacy_')) {
      setPexWaWindow(client?.wa_window_expires_at || null);
      return;
    }
    let cancelled = false;
    supabase
      .from('leads')
      .select('wa_window_expires_at')
      .eq('id', leadId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setPexWaWindow(data?.wa_window_expires_at || null);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, client?.id, client?.lead_type, client?.wa_window_expires_at]);

  const isPexChat = isPexWhatsAppThread({
    messages,
    waWindowExpiresAt: pexWaWindow || client?.wa_window_expires_at,
  });

  useEffect(() => {
    setPexWindowUnlocked(false);
  }, [client?.id, client?.lead_type, propSelectedContact?.contact?.id]);

  const pexAdminBypass = isPexChat && isSuperUser && pexWindowUnlocked;
  const inputLocked = whatsAppComposerLocked(isLocked, pexAdminBypass);

  const togglePexWindowUnlock = useCallback(() => {
    setPexWindowUnlocked((prev) => {
      const next = !prev;
      toast.success(
        next
          ? '24-hour window unlocked — you can send a test message'
          : '24-hour window re-locked',
      );
      return next;
    });
  }, []);

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
  }, [client, messages, isOpen, isPexChat]);

  useEffect(() => {
    if (!isPexChat) return;
    setShowTemplateSelector(false);
    setSelectedTemplate(null);
  }, [isPexChat]);

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

    if (isPexChat && selectedTemplate) {
      toast.error(PEX_TEMPLATES_UNAVAILABLE);
      return;
    }

    if ((!newMessage.trim() && !selectedTemplate) || !client || !currentUser) {
      return;
    }

    setSending(true);

    // Get phone number from selected contact or client
    let phoneNumber: string | null = null;
    let contactId: number | null = null;

    // Sidebar override > propSelectedContact > selectedContactId
    const sendContact =
      activeContactOverride ||
      propSelectedContact?.contact ||
      (selectedContactId ? (sidebarContacts.find(c => c.id === selectedContactId) || leadContacts.find(c => c.id === selectedContactId)) : null);

    if (sendContact) {
      phoneNumber = sendContact.phone || sendContact.mobile || null;
      contactId = sendContact.id;
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
        messagePayload.templateLanguage = selectedTemplate.language;

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

      const templateSnapshot = selectedTemplate;
      const outgoingText = templateSnapshot
        ? resolveOutgoingTemplateDisplayMessage(templateSnapshot, messagePayload.message, newMessage)
        : (messagePayload.message || newMessage.trim());

      const optimisticId = -Date.now();
      const optimisticMsg = createOptimisticOutgoingWhatsAppMessage({
        lead_id: client.id,
        sender_id: currentUser.id,
        sender_name: senderName,
        message: outgoingText,
        sent_at: new Date().toISOString(),
        template_id: templateSnapshot?.id,
      });
      optimisticMsg.id = optimisticId;

      setMessages((prev) => sortWhatsAppMessagesBySentAt([...prev, optimisticMsg as WhatsAppMessage]));
      setShouldAutoScroll(true);
      setNewMessage('');
      setSelectedTemplate(null);

      if (textareaRef.current) {
        setTimeout(() => {
          growWhatsAppComposerTextarea(textareaRef.current, {
            minPx: 40,
            maxPx: whatsAppComposerMaxHeightPx(null),
          });
        }, 0);
      }

      if (isMobile) {
        setIsInputFocused(false);
        textareaRef.current?.blur();
      }

      const response = await fetch(buildApiUrl('/api/whatsapp/send-message'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messagePayload),
      });

      const result = await response.json();

      if (!whatsAppDispatchSucceeded(response.ok, result)) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        if (result.code === 'RE_ENGAGEMENT_REQUIRED') {
          throw new Error('⚠️ WhatsApp 24-Hour Rule: You can only send template messages after 24 hours of customer inactivity.');
        }
        throw new Error(result.error || 'Failed to send message');
      }

      setMessages((prev) =>
        sortWhatsAppMessagesBySentAt(
          prev.map((m) =>
            m.id === optimisticId
              ? {
                  ...m,
                  id: Date.now(),
                  whatsapp_message_id: result.messageId,
                  whatsapp_status: 'sent' as const,
                  template_id: templateSnapshot?.id,
                  message: outgoingText,
                }
              : m,
          ),
        ),
      );

      if (onClientUpdate) {
        await onClientUpdate();
      }

      toast.success(whatsAppSendResultToast(result));
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
      if (client.phone || client.mobile) {
        formData.append('phoneNumber', client.phone || client.mobile || '');
      }

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

      if (!whatsAppDispatchSucceeded(response.ok, result)) {
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

      toast.success(result.via === 'pex' ? 'Media saved — PEX will send it' : 'Media sent via WhatsApp!');
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

      const result = await fetchAiMessageSuggestion({
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
      });

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

  // Get the active contact (sidebar override > propSelectedContact > selectedContactId)
  const activeContact =
    activeContactOverride ||
    propSelectedContact?.contact ||
    (selectedContactId ? (sidebarContacts.find(c => c.id === selectedContactId) || leadContacts.find(c => c.id === selectedContactId)) : null);
  const displayName = activeContact?.name || client?.name || 'Unknown';
  const displayPhone = activeContact?.phone || activeContact?.mobile || client?.phone || client?.mobile || '';

  const lastIncomingMessage = messages
    .filter(msg => msg.direction === 'in')
    .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime())[0];
  const clientLocked = lastIncomingMessage ? isClientLocked(lastIncomingMessage.sent_at) : false;

  return createPortal(
    <div className={`fixed inset-0 ${WHATSAPP_CHAT_THREAD_BG_CLASS} z-[9999] overflow-hidden`}>
      <div className="h-full flex">
        {/* Left contacts sidebar (WhatsApp-page style) — lists all of the lead's contacts */}
        {showContactSidebar && !isMobile && (
          <div className="w-80 flex-none border-r border-gray-200 flex flex-col min-h-0 bg-white">
            <div className="flex-none px-4 pt-4 pb-3">
              <div className="flex items-center gap-3">
                <FaWhatsapp className="w-7 h-7 text-green-600 flex-shrink-0" />
                <h1 className="text-xl font-semibold text-gray-900 tracking-tight">Contacts</h1>
              </div>
              {client && (
                <p className="mt-1 text-xs text-gray-500 truncate">
                  {client.name} ({client.lead_number})
                </p>
              )}
            </div>
            <div className="flex-1 overflow-y-auto min-h-0">
              {sidebarContacts.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-sm">No contacts found</div>
              ) : (
                sidebarContacts.map((contact) => {
                  const isActive = activeContact?.id === contact.id;
                  const lastMessage = contactLastMessages[contact.id];
                  const initials = (contact.name || '?')
                    .trim()
                    .split(/\s+/)
                    .map((p) => p[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase() || '?';
                  return (
                    <button
                      key={contact.id}
                      type="button"
                      onClick={() => handleSidebarContactSelect(contact)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-l-4 ${
                        isActive
                          ? 'bg-green-50 border-green-500'
                          : 'border-transparent hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-green-500 text-white font-semibold shadow-sm">
                        {initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-gray-900">{contact.name}</span>
                          {contact.isMain && (
                            <span className="flex-none rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                              Main
                            </span>
                          )}
                          {lastMessage?.time && (
                            <span className="ml-auto flex-none text-[10px] text-gray-400">
                              {formatSidebarTimestamp(lastMessage.time)}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-gray-500">
                          {lastMessage?.text || 'No messages yet'}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      <div className={`h-full flex-1 min-w-0 flex flex-col relative ${WHATSAPP_CHAT_THREAD_BG_CLASS}`}>
        {/* Header */}
        <div className={`absolute top-0 inset-x-0 z-40 flex items-center justify-between px-3 py-1.5 ${WHATSAPP_CHAT_HEADER_GLASS_CLASS}`}>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <FaWhatsapp className="w-5 h-5 text-green-600 flex-shrink-0" />
            {client && (
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {clientLocked && (
                  <div className="absolute -top-1 -right-1 bg-red-500 rounded-full p-0.5">
                    <LockClosedIcon className="w-2 h-2 text-white" />
                  </div>
                )}
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm font-semibold text-gray-900 truncate">
                    {displayName}
                  </span>
                  <span className="text-xs text-gray-500 font-mono flex-shrink-0">
                    ({client.lead_number})
                  </span>
                </div>
                {timeLeft && (
                  <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                    pexAdminBypass
                      ? 'bg-violet-100 text-violet-800'
                      : isLocked
                        ? 'bg-red-100 text-red-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                    {pexAdminBypass ? (
                      <>
                        <LockOpenIcon className="w-4 h-4" />
                        <span>Test</span>
                      </>
                    ) : isLocked ? (
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
            className="btn btn-ghost btn-circle btn-sm flex-shrink-0"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Messages - Scrollable */}
        <div
          className="flex-1 overflow-y-auto px-4 pb-4 space-y-6 min-h-0 overscroll-contain"
          style={{
            paddingTop: 52,
            paddingBottom: inputLocked ? '200px' : '120px',
            WebkitOverflowScrolling: 'touch',
            overflowX: 'hidden',
            maxWidth: '100%',
          }}
        >
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
              const lookedUpSenderId = getEmployeeById(message.sender_name)?.id;
              const outgoingSender =
                message.direction === 'out'
                  ? resolveWhatsAppOutgoingSenderUi(message, lookedUpSenderId)
                  : { label: message.sender_name, employeeId: lookedUpSenderId ?? null };
              const outgoingSenderLabel = outgoingSender.label || message.sender_name;
              const outgoingEmployeeId = outgoingSender.employeeId;

              return (
                <React.Fragment key={message.id || index}>
                  {showDateSeparator && (
                    <div className="flex justify-center my-4 w-full">
                      <div className="text-sm font-medium px-3 py-1.5 rounded-full bg-gray-200 text-gray-900 border border-gray-300">
                        {formatDateSeparator(message.sent_at)}
                      </div>
                    </div>
                  )}

                  <div data-whatsapp-id={message.id} className={`flex flex-col ${message.direction === 'out' ? 'items-end' : 'items-start'}`} style={{ maxWidth: '100%', minWidth: 0 }}>
                    {message.direction === 'out' && (
                      <div className="flex items-center gap-2 mb-1 mr-2">
                        <span className="text-sm text-gray-600 font-medium">
                          {outgoingSenderLabel}
                        </span>
                        <EmployeeAvatar
                          employeeId={outgoingEmployeeId}
                          size="md"
                        />
                      </div>
                    )}

                    {/* Image or Emoji-only messages - render outside bubble */}
                    {(message.message_type === 'image' || (message.message_type === 'text' && isEmojiOnly(message.message))) ? (
                      <div className={`flex flex-col ${WHATSAPP_CHAT_BUBBLE_WIDTH_CLASS} ${whatsAppChatBubbleAlignClass(message.direction)}`}>
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
                          <p
                            className={`${WHATSAPP_BUBBLE_TEXT_CLASS} text-base mt-1`}
                            dir={whatsAppComposerDir(message.caption || '')}
                            style={{
                              wordBreak: 'break-word',
                              overflowWrap: 'break-word',
                              overflow: 'visible',
                              maxWidth: '100%',
                              minWidth: 0,
                              height: 'auto',
                              color: message.direction === 'out' ? WHATSAPP_OUTGOING_TEXT_COLOR : undefined
                            }}
                          >
                            {renderTextWithLinks(message.caption, 'outgoing')}
                          </p>
                        )}

                        {/* Timestamp and read receipts at bottom of image/emoji */}
                        <div className="flex items-center justify-end gap-1 mt-1">
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
                        className={`group ${WHATSAPP_CHAT_BUBBLE_WIDTH_CLASS} ${whatsAppChatBubbleAlignClass(message.direction)} rounded-2xl px-3 py-2 shadow-sm ${message.direction === 'out'
                          ? WHATSAPP_OUTGOING_BUBBLE_CLASS
                          : 'bg-white text-gray-900'
                          }`}
                        style={{
                          wordBreak: 'break-word',
                          overflowWrap: 'anywhere',
                          overflow: 'visible',
                          height: 'auto',
                          ...(message.direction === 'out'
                            ? { background: WHATSAPP_OUTGOING_MESSAGE_GRADIENT }
                            : {}),
                        }}
                      >
                        {message.message_type === 'text' && (
                          <p
                            className={`${WHATSAPP_BUBBLE_TEXT_CLASS} text-[17px] leading-snug`}
                            dir={whatsAppComposerDir(message.message || '')}
                            style={{
                              wordBreak: 'break-word',
                              overflowWrap: 'anywhere',
                              overflow: 'visible',
                              maxWidth: '100%',
                              minWidth: 0,
                              height: 'auto',
                              color: message.direction === 'out' ? WHATSAPP_OUTGOING_TEXT_COLOR : undefined
                            }}
                          >
                            {renderTextWithLinks(message.message, 'outgoing')}
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
                              className={message.direction === 'out' ? WHATSAPP_OUTGOING_VOICE_PLAYER_CLASS : 'bg-gray-50'}
                              senderName={message.sender_name || 'Unknown'}
                              profilePictureUrl={message.profile_picture_url}
                              showAvatar={false}
                            />
                            {message.caption && (
                              <p
                                className={`${WHATSAPP_BUBBLE_TEXT_CLASS} text-base mt-2`}
                                dir={whatsAppComposerDir(message.caption || '')}
                                style={{
                                  wordBreak: 'break-word',
                                  overflowWrap: 'break-word',
                                  overflow: 'visible',
                                  maxWidth: '100%',
                                  minWidth: 0,
                                  height: 'auto',
                                  color: message.direction === 'out' ? WHATSAPP_OUTGOING_TEXT_COLOR : undefined
                                }}
                              >
                                {renderTextWithLinks(message.caption, 'outgoing')}
                              </p>
                            )}
                            {!message.caption && message.message && (
                              <p
                                className={`${WHATSAPP_BUBBLE_TEXT_CLASS} text-base mt-2`}
                                dir={whatsAppComposerDir(message.message || '')}
                                style={{
                                  wordBreak: 'break-word',
                                  overflowWrap: 'break-word',
                                  overflow: 'visible',
                                  maxWidth: '100%',
                                  minWidth: 0,
                                  height: 'auto',
                                  color: message.direction === 'out' ? WHATSAPP_OUTGOING_TEXT_COLOR : undefined
                                }}
                              >
                                {renderTextWithLinks(message.message, 'outgoing')}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Timestamp — bottom-right of the bubble */}
                        <div className={WHATSAPP_CHAT_BUBBLE_META_CLASS}>
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
                    )}
                    {message.direction === 'in' && (
                      <div className="flex items-center gap-2 mt-1 ml-2">
                        <WhatsAppAvatar
                          name={displayName}
                          size="sm"
                        />
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
        <div className={`absolute ${isMobile ? 'bottom-2' : 'bottom-0'} left-0 right-0 ${isMobile ? 'px-4 pb-2' : 'p-4'} z-30 pointer-events-none`}>
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
          {isPexChat && (
            <div className="mb-2 pointer-events-auto">
              <WhatsAppPexComposerHint />
            </div>
          )}
          {isLocked && (
            <WhatsAppWindowLockBanner
              isPex={isPexChat}
              windowLocked={isLocked}
              adminUnlocked={pexAdminBypass}
            />
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


          {/* Input Field and Buttons */}
          <div className={`${WHATSAPP_COMPOSER_FIELD_CLASS} relative pointer-events-auto`}>
            {/* Consolidated Tools Button */}
            <div className="relative self-end" ref={desktopToolsRef}>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowDesktopTools((prev) => !prev);
                  setShowTemplateSelector(false);
                }}
                disabled={sending || uploadingMedia}
                className={`${WHATSAPP_COMPOSER_TOOLS_BTN_CLASS} w-10 h-10 min-h-10 min-w-10`}
                title="Message tools"
              >
                <Squares2X2Icon className="w-5 h-5" />
              </button>

              {/* Tools Dropdown Menu */}
              {showDesktopTools && (
                <div className="absolute bottom-full left-0 mb-2 z-50 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[180px]">
                  <WhatsAppTemplateMenuItem
                    isPex={isPexChat}
                    onOpen={() => {
                      setShowTemplateSelector(true);
                      setShowDesktopTools(false);
                    }}
                  />
                  <WhatsAppPexUnlockMenuItem
                    isPex={isPexChat}
                    isSuperuser={isSuperUser}
                    windowLocked={isLocked}
                    unlocked={pexWindowUnlocked}
                    onToggle={togglePexWindowUnlock}
                    onClose={() => setShowDesktopTools(false)}
                  />
                  <label className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors cursor-pointer">
                    <PaperClipIcon className="w-5 h-5" style={{ color: '#3E28CD' }} />
                    <span className="text-sm text-gray-700">Attach File</span>
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,audio/*,video/*"
                      onChange={handleFileSelect}
                      disabled={uploadingMedia || inputLocked}
                    />
                  </label>
                  <button
                    onClick={() => {
                      setShowVoiceRecorder(!showVoiceRecorder);
                      setShowDesktopTools(false);
                    }}
                    disabled={inputLocked}
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
                    disabled={inputLocked}
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
                    disabled={isLoadingAI || inputLocked || !client}
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
              {showTemplateSelector && (
                <div
                  ref={templateSelectorRef}
                  className="absolute left-0 bottom-[calc(100%+8px)] z-[10000] w-[min(26rem,calc(100vw-2rem))]"
                >
                  <WhatsAppTemplatePicker
                    templates={templates}
                    selectedTemplate={selectedTemplate}
                    searchTerm={templateSearchTerm}
                    onSearchChange={setTemplateSearchTerm}
                    selectedLanguage={selectedLanguage}
                    onLanguageChange={setSelectedLanguage}
                    isLoading={isLoadingTemplates}
                    onClose={() => setShowTemplateSelector(false)}
                    onSelect={(template) => {
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
                      } else {
                        setNewMessage('');
                      }
                    }}
                    className="max-h-[min(26rem,calc(100vh-8rem))]"
                  />
                </div>
              )}
            </div>

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

            <textarea
              ref={textareaRef}
              value={newMessage}
              onChange={(e) => {
                setNewMessage(e.target.value);
                growWhatsAppComposerTextarea(e.target, {
                  minPx: 40,
                  maxPx: whatsAppComposerMaxHeightPx(selectedTemplate),
                });
              }}
              onKeyDown={(e) => {
                // Let Enter create new lines
              }}
              placeholder={
                selectedTemplate
                  ? selectedTemplate.params === '1'
                    ? `Parameter for: ${selectedTemplate.title}`
                    : `Template: ${selectedTemplate.title}`
                  : inputLocked
                    ? whatsAppLockedPlaceholder(isPexChat, messages.length === 0)
                    : selectedFile
                      ? "Add a caption..."
                      : "Type a message..."
              }
              className={WHATSAPP_COMPOSER_TEXTAREA_CLASS}
              dir={whatsAppComposerDir(newMessage)}
              rows={1}
              disabled={sending || uploadingMedia || whatsAppComposerTextDisabled(inputLocked, selectedTemplate)}
              style={{
                backgroundColor: 'transparent',
                maxHeight: `${whatsAppComposerMaxHeightPx(selectedTemplate)}px`,
                minHeight: '40px',
              }}
            />

            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                if (selectedFile) {
                  handleSendMedia();
                } else {
                  const syntheticEvent = {
                    preventDefault: () => { },
                    stopPropagation: () => { },
                    currentTarget: e.currentTarget,
                    target: e.target,
                  } as React.FormEvent;
                  handleSendMessage(syntheticEvent);
                }
              }}
              disabled={(!newMessage.trim() && !selectedTemplate && !selectedFile) || sending || uploadingMedia || whatsAppSendBlockedByWindow(inputLocked, selectedTemplate, isPexChat)}
              className={`${WHATSAPP_COMPOSER_SEND_BTN_CLASS} w-10 h-10 min-h-10 min-w-10`}
              style={{ background: '#000000', borderColor: 'transparent' }}
              title={selectedFile ? 'Send media' : selectedTemplate ? 'Send template' : 'Send message'}
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
      </div>
    </div>,
    document.body
  );
};

export default SchedulerWhatsAppModal;