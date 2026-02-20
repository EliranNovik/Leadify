import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { usePersistedState } from '../hooks/usePersistedState';
import { buildApiUrl } from '../lib/api';
import { fetchWhatsAppTemplates, filterTemplates, testDatabaseAccess, refreshTemplatesFromAPI, type WhatsAppTemplate } from '../lib/whatsappTemplates';
import TemplateOptionCard from '../components/whatsapp/TemplateOptionCard';
import { generateTemplateParameters } from '../lib/whatsappTemplateParams';
import { getTemplateParamDefinitions, generateParamsFromDefinitions } from '../lib/whatsappTemplateParamMapping';
import { fetchLeadContacts } from '../lib/contactHelpers';
import type { ContactInfo } from '../lib/contactHelpers';
import { searchLeads, type CombinedLead } from '../lib/legacyLeadsApi';
import { generateSearchVariants } from '../lib/transliteration';
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
  MicrophoneIcon,
  ClockIcon,
  PencilIcon,
  TrashIcon,
  EllipsisVerticalIcon,
  CheckIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import WhatsAppAvatar from '../components/whatsapp/WhatsAppAvatar';
import VoiceMessagePlayer from '../components/whatsapp/VoiceMessagePlayer';
import VoiceMessageRecorder from '../components/whatsapp/VoiceMessageRecorder';

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
  handler?: string;
  next_followup?: string;
  probability?: number;
  balance?: number;
  potential_applicants?: number;
  lead_type?: 'legacy' | 'new';
  isContact?: boolean;
  lead_id?: string | null; // For contacts, this is the associated lead_id
  contact_id?: number; // For contacts, this is the contact_id
  whatsapp_profile_picture_url?: string | null; // WhatsApp profile picture URL
  // Role fields for new leads (numeric IDs)
  manager?: number | null;
  helper?: number | null;
  expert?: number | null;
  case_handler_id?: number | null;
  // Role fields for legacy leads (numeric IDs)
  closer_id?: number | null;
  meeting_scheduler_id?: number | null;
  meeting_manager_id?: number | null;
  meeting_lawyer_id?: number | null;
  expert_id?: number | null;
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
  profile_picture_url?: string | null; // WhatsApp profile picture URL
  voice_note?: boolean; // True if this is a voice note (not regular audio)
  contact_id?: number; // Contact ID for messages associated with a specific contact
  legacy_id?: number; // Legacy lead ID for legacy leads
  phone_number?: string | null; // Phone number for matching messages to contacts
}

interface WhatsAppPageProps {
  selectedContact?: {
    contact: any;
    leadId: string | number;
    leadType: 'legacy' | 'new';
  } | null;
  onClose?: () => void;
}

const WhatsAppPage: React.FC<WhatsAppPageProps> = ({ selectedContact: propSelectedContact, onClose }) => {
  const navigate = useNavigate();

  // Tab preference (which tab is active)
  const [showMyContactsOnly, setShowMyContactsOnly] = usePersistedState<boolean>('whatsapp_showMyContactsOnly', true, {
    storage: 'sessionStorage',
  });

  // Separate persisted state for "My Contacts" tab
  const [myContactsClients, setMyContactsClients] = usePersistedState<Client[]>('whatsapp_myContacts_clients', [], {
    storage: 'sessionStorage',
  });
  const [myContactsSelectedClient, setMyContactsSelectedClient] = usePersistedState<any>('whatsapp_myContacts_selectedClient', null, {
    storage: 'sessionStorage',
  });
  const [myContactsMessages, setMyContactsMessages] = usePersistedState<WhatsAppMessage[]>('whatsapp_myContacts_messages', [], {
    storage: 'sessionStorage',
  });

  // Separate persisted state for "All Contacts" tab
  const [allContactsClients, setAllContactsClients] = usePersistedState<Client[]>('whatsapp_allContacts_clients', [], {
    storage: 'sessionStorage',
  });
  const [allContactsSelectedClient, setAllContactsSelectedClient] = usePersistedState<any>('whatsapp_allContacts_selectedClient', null, {
    storage: 'sessionStorage',
  });
  const [allContactsMessages, setAllContactsMessages] = usePersistedState<WhatsAppMessage[]>('whatsapp_allContacts_messages', [], {
    storage: 'sessionStorage',
  });

  // Shared state for all messages (same for both tabs)
  const [allMessages, setAllMessages] = usePersistedState<WhatsAppMessage[]>('whatsapp_allMessages', [], {
    storage: 'sessionStorage',
  });

  // Current active state (derived from showMyContactsOnly)
  const clients = showMyContactsOnly ? myContactsClients : allContactsClients;
  const setClients = showMyContactsOnly ? setMyContactsClients : setAllContactsClients;
  const selectedClient = showMyContactsOnly ? myContactsSelectedClient : allContactsSelectedClient;
  const setSelectedClient = showMyContactsOnly ? setMyContactsSelectedClient : setAllContactsSelectedClient;
  const messages = showMyContactsOnly ? myContactsMessages : allContactsMessages;
  const setMessages = showMyContactsOnly ? setMyContactsMessages : setAllContactsMessages;

  // Non-persisted UI state
  const [searchTerm, setSearchTerm] = useState('');
  const [newMessage, setNewMessage] = useState('');
  // Initialize loading based on whether we have cached data
  // Check sessionStorage directly to avoid React state initialization timing issues
  const getHasCachedData = () => {
    try {
      const myContactsKey = 'persisted_state_whatsapp_myContacts_clients';
      const allContactsKey = 'persisted_state_whatsapp_allContacts_clients';
      const allMessagesKey = 'persisted_state_whatsapp_allMessages';
      const tabKey = showMyContactsOnly ? myContactsKey : allContactsKey;
      const clientsData = sessionStorage.getItem(tabKey);
      const messagesData = sessionStorage.getItem(allMessagesKey);
      if (clientsData && messagesData) {
        const clients = JSON.parse(clientsData);
        const messages = JSON.parse(messagesData);
        return Array.isArray(clients) && clients.length > 0 && Array.isArray(messages) && messages.length > 0;
      }
    } catch {
      // Ignore errors
    }
    return false;
  };
  const [loading, setLoading] = useState(!getHasCachedData()); // Start as false if we have cached data
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  // Search state (for filtering fetched clients only - no API calls)

  // New Message Modal state
  const [isNewMessageModalOpen, setIsNewMessageModalOpen] = useState(false);
  const [newMessageSearchTerm, setNewMessageSearchTerm] = useState('');
  const [newMessageSearchResults, setNewMessageSearchResults] = useState<CombinedLead[]>([]);
  const [isNewMessageSearching, setIsNewMessageSearching] = useState(false);
  const newMessageSearchTimeoutRef = useRef<NodeJS.Timeout>();
  const masterSearchResultsRef = useRef<CombinedLead[]>([]);
  const previousSearchQueryRef = useRef<string>('');
  const previousRawSearchValueRef = useRef<string>('');

  // Debug selectedFile state changes
  useEffect(() => {
    console.log('📁 selectedFile state changed:', selectedFile);
  }, [selectedFile]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [shouldCloseOnNavigate, setShouldCloseOnNavigate] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<{ url: string, type: 'image' | 'video', caption?: string } | null>(null);
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

  // State for user role filtering
  const [currentUserEmployeeId, setCurrentUserEmployeeId] = useState<number | null>(null);
  const [currentUserFullName, setCurrentUserFullName] = useState<string | null>(null);
  const [isSuperuser, setIsSuperuser] = useState<boolean | null>(null);
  const [allEmployees, setAllEmployees] = useState<any[]>([]);

  // Track if we've loaded initial data (to prevent refetching if state was restored)
  // Use sessionStorage to persist this across modal open/close
  const getHasInitialData = () => {
    try {
      const stored = sessionStorage.getItem('whatsapp_hasInitialData');
      return stored === 'true';
    } catch {
      return false;
    }
  };

  const setHasInitialData = (value: boolean) => {
    try {
      sessionStorage.setItem('whatsapp_hasInitialData', String(value));
    } catch {
      // Ignore storage errors
    }
  };

  const hasInitialDataRef = useRef(getHasInitialData());

  // Helper function to get employee by ID (exact copy from RolesTab)
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

  // Helper to get employee ID from role (similar to RolesTab's getEmployeeIdFromRole)
  const getEmployeeIdFromRole = (roleValue: string | number | null | undefined, isLegacy: boolean, legacyFieldName?: string, client?: Client): string | number | null => {
    if (!roleValue || roleValue === '---' || roleValue === '--' || roleValue === '') return null;

    // For legacy leads with a specific field name, get the ID directly from client
    if (isLegacy && legacyFieldName && client) {
      return (client as any)[legacyFieldName] || null;
    }

    // For new leads, check if there's a direct ID field first (e.g., case_handler_id for handler)
    // This handles cases where both the display name and ID might be stored
    if (legacyFieldName === 'case_handler_id' && client && (client as any).case_handler_id) {
      return (client as any).case_handler_id;
    }

    // If it's already a number, it's likely an ID
    if (typeof roleValue === 'number' || (typeof roleValue === 'string' && /^\d+$/.test(roleValue.trim()))) {
      return typeof roleValue === 'string' ? Number(roleValue) : roleValue;
    }

    // Otherwise, it's likely a display name - find the employee by name
    if (typeof roleValue === 'string') {
      const employee = allEmployees.find((emp: any) => {
        if (!emp.display_name) return false;
        return emp.display_name.trim().toLowerCase() === roleValue.trim().toLowerCase();
      });
      return employee?.id || null;
    }

    return null;
  };

  // Helper function to get employee display name from ID
  const getEmployeeDisplayName = (employeeId: string | number | null | undefined) => {
    if (employeeId === null || employeeId === undefined || employeeId === '---') return '---';

    // Convert employeeId to number for comparison
    const idAsNumber = typeof employeeId === 'string' ? parseInt(employeeId, 10) : Number(employeeId);

    if (isNaN(idAsNumber)) {
      return '---';
    }

    // Find employee by ID - try multiple comparison methods
    const employee = allEmployees.find((emp: any) => {
      if (!emp || !emp.id) return false;

      // Handle bigint type
      const empId = typeof emp.id === 'bigint' ? Number(emp.id) : emp.id;
      const empIdNum = typeof empId === 'string' ? parseInt(empId, 10) : Number(empId);

      if (isNaN(empIdNum)) return false;

      // Try string comparison
      if (String(empId) === String(employeeId)) return true;
      // Try number comparison
      if (empIdNum === idAsNumber) return true;

      return false;
    });

    if (employee && employee.display_name) {
      const displayName = employee.display_name;
      if (displayName.toLowerCase() === 'not_assigned' || displayName.toLowerCase() === 'not assigned') {
        return '---';
      }
      return displayName;
    }

    return '---';
  };

  // Helper function to get employee initials
  const getEmployeeInitials = (name: string | null | undefined): string => {
    if (!name || name === '---' || name === '--' || name === 'Not assigned') return '';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  // Component to render employee avatar (exact copy from RolesTab)
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
  // Helper function to convert URLs, email addresses, and bold formatting in text
  const renderTextWithLinks = (text: string): React.ReactNode => {
    if (!text) return text;

    // Process links (URLs and emails)
    const processLinks = (input: string, startKey: number = 0): (string | React.ReactElement)[] => {
      const linkRegex = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|mailto:[^\s<>"']+|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s<>"']*)?)/g;
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

        if (matchedText.includes('@') && !matchedText.startsWith('http') && !matchedText.startsWith('mailto:')) {
          // It's an email address
          href = `mailto:${matchedText}`;
          displayText = matchedText;
        } else if (matchedText.startsWith('mailto:')) {
          // Already has mailto: prefix
          href = matchedText;
          displayText = matchedText.replace(/^mailto:/, '');
        } else if (!matchedText.startsWith('http://') && !matchedText.startsWith('https://') && !matchedText.startsWith('mailto:')) {
          // It's a URL without protocol
          href = `https://${matchedText}`;
          displayText = matchedText;
        }

        // Replace long URLs with "Meeting Link" text
        if (href.startsWith('http://') || href.startsWith('https://')) {
          if (matchedText.length > 50 || href.includes('teams.microsoft.com') || href.includes('meetup-join') || href.includes('meeting')) {
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
            style={{
              color: '#39ff14',
              wordBreak: 'break-all',
              overflowWrap: 'anywhere',
              hyphens: 'auto',
              maxWidth: '100%',
              whiteSpace: 'normal',
              display: 'inline',
              fontWeight: 600,
              lineBreak: 'anywhere'
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
            <strong key={`bold-${keyCounter++}`} style={{ fontWeight: 900 }}>
              {boldContent}
            </strong>
          );
        } else {
          // Has links in bold, wrap in strong
          parts.push(
            <strong key={`bold-${keyCounter++}`} style={{ fontWeight: 900 }}>
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

  const isEmojiOnly = (text: string): boolean => {
    // Simple approach: check if the text length is very short and contains emoji-like characters
    const cleanText = text.trim();
    if (cleanText.length === 0) return false;

    // Exclude Hebrew text (Unicode range \u0590-\u05FF) - it should not be treated as emoji
    const hasHebrew = /[\u0590-\u05FF]/.test(cleanText);
    if (hasHebrew) return false;

    // Check if the message is very short (likely emoji-only) and contains non-ASCII characters
    const hasNonAscii = /[^\x00-\x7F]/.test(cleanText);
    const isShort = cleanText.length <= 5; // Most emojis are 1-3 characters

    // Emoji detection: check for emoji Unicode ranges
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/u;
    const hasEmoji = emojiRegex.test(cleanText);

    return hasEmoji && isShort && !hasHebrew;
  };

  // Helper function to check if a client matches user roles (matches RolesTab.tsx logic)
  const clientMatchesUserRoles = (
    client: Client,
    employeeId: number | null,
    fullName: string | null
  ): boolean => {
    if (!employeeId && !fullName) return false;

    const stringIdentifiers = fullName ? [fullName.trim().toLowerCase()] : [];
    const numericId = employeeId ? String(employeeId).trim() : null;

    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');

    if (isLegacyLead) {
      // For legacy leads, all roles use numeric IDs (matching RolesTab.tsx)
      const roleFields = [
        (client as any).closer_id,
        (client as any).meeting_scheduler_id,
        (client as any).meeting_manager_id,
        (client as any).meeting_lawyer_id,
        (client as any).expert_id,
        (client as any).case_handler_id
      ];

      // Legacy leads require numeric employee ID to match (they don't use text names for roles)
      if (numericId) {
        const match = roleFields.some(field => {
          if (field === null || field === undefined) return false;
          return String(field).trim() === numericId;
        });
        if (match) {
          console.log(`✅ Legacy lead ${client.id} matched by numeric role field`);
        }
        return match;
      } else {
        // If no numeric ID available, can't match legacy leads (they use numeric IDs only)
        console.log(`⚠️ Legacy lead ${client.id} cannot be matched: no employee ID available`);
        return false;
      }
    } else {
      // For new leads, match RolesTab.tsx logic:
      // - Text fields (saved as display names): scheduler, closer, handler
      // - Numeric ID fields (saved as employee IDs): manager, helper, expert, case_handler_id
      const textRoleFields = [
        client.closer,      // Text field
        client.scheduler,   // Text field
        (client as any).handler  // Text field
      ];

      const numericRoleFields = [
        (client as any).manager,        // Numeric ID field (NOT meeting_manager_id)
        (client as any).helper,           // Numeric ID field (NOT meeting_lawyer_id)
        (client as any).expert,           // Numeric ID field (NOT expert_id)
        (client as any).case_handler_id  // Numeric ID field (for handler role)
      ];

      // Check text fields (scheduler, closer, handler are saved as display names)
      if (stringIdentifiers.length > 0) {
        const textMatch = textRoleFields.some(field => {
          if (!field || typeof field !== 'string') return false;
          return stringIdentifiers.includes(field.trim().toLowerCase());
        });
        if (textMatch) {
          console.log(`✅ New lead ${client.id} matched by text role field`);
          return true;
        }
      }

      // Check numeric fields (manager, helper, expert, case_handler_id are saved as employee IDs)
      if (numericId) {
        const numericMatch = numericRoleFields.some(field => {
          if (field === null || field === undefined) return false;
          return String(field).trim() === numericId;
        });
        if (numericMatch) {
          console.log(`✅ New lead ${client.id} matched by numeric role field`);
          return true;
        }
      }
    }

    return false;
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
        } else {
          // Template has parameters - check if message already has filled content
          const paramCount = Number(template.params) || 0;

          // If message doesn't contain template markers and has actual content, use it
          if (message.message && !message.message.includes('TEMPLATE_MARKER:') && !message.message.includes('[Template:')) {
            return message; // Already filled content
          }

          // Otherwise, show the template content with placeholders
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

  // Helper function to navigate to client page
  const handleNavigateToClient = (client: Client) => {
    // Get the correct lead identifier based on lead type
    const isLegacy = client.lead_type === 'legacy' || client.id?.toString().startsWith('legacy_');

    let leadIdentifier: string | null = null;

    // For contacts, use the same logic as regular leads - use lead_number for new leads, not lead_id (UUID)
    if (isLegacy) {
      // For legacy leads, extract the numeric ID
      const clientId = client.id?.toString();
      if (clientId) {
        if (clientId.startsWith('legacy_')) {
          // Extract numeric ID from "legacy_<id>"
          leadIdentifier = clientId.replace('legacy_', '');
        } else if (/^\d+$/.test(clientId)) {
          // Already numeric
          leadIdentifier = clientId;
        }
      }
      // Fallback: use lead_number if it's a numeric string (for legacy contacts)
      if (!leadIdentifier && client.lead_number && /^\d+$/.test(client.lead_number)) {
        leadIdentifier = client.lead_number;
      }
    } else {
      // For new leads, use lead_number
      leadIdentifier = client.lead_number || client.manual_id || null;
    }

    if (!leadIdentifier) {
      console.error('Cannot navigate: No valid lead identifier found', client);
      return;
    }

    // Encode the identifier to handle sub-leads with '/' characters
    const encodedIdentifier = encodeURIComponent(leadIdentifier);
    console.log('Navigating to client:', leadIdentifier, 'encoded:', encodedIdentifier);

    // Close WhatsApp modal first, then navigate
    if (onClose) {
      onClose();
    }

    // Small delay to ensure modal closes before navigation
    setTimeout(() => {
      navigate(`/clients/${encodedIdentifier}`, { replace: true });
    }, 100);
  };

  // Track which messages we've already attempted to fix to prevent infinite loops
  const fixedMessageIdsRef = useRef<Set<number>>(new Set());

  // Automatically fix message status when whatsapp_message_id exists but status is "failed"
  // This means the message was sent successfully but DB status update failed
  const autoFixMessageStatus = useCallback(async (messagesToFix: WhatsAppMessage[]) => {
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
      const updateMessageState = (prevMessages: WhatsAppMessage[]) =>
        prevMessages.map(msg =>
          fixedIds.includes(msg.id)
            ? { ...msg, whatsapp_status: 'delivered' as const, error_message: undefined }
            : msg
        );

      setMessages(updateMessageState);
      setAllMessages(updateMessageState as any);

      // Also update tab-specific message states
      setMyContactsMessages(updateMessageState);
      setAllContactsMessages(updateMessageState);
    }
  }, []);

  // Helper function to render WhatsApp-style message status
  const renderMessageStatus = (message?: WhatsAppMessage | { whatsapp_status?: string; whatsapp_message_id?: string; error_message?: string }) => {
    if (!message) return null;

    const status = message.whatsapp_status;
    const whatsappMessageId = message.whatsapp_message_id;

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
          <svg className={baseClasses} fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: '#000000' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l4 4L11 8" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l4 4L17 8" />
          </svg>
        );
      case 'read':
        return (
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: '#00d9ff' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 12l4 4L11 8" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l4 4L17 8" />
          </svg>
        );
      case 'failed':
        // Only show "failed" if message was NOT actually sent (no whatsapp_message_id)
        // If whatsapp_message_id exists, it means message was sent, so we show "delivered" above
        const errorMessage = message.error_message;
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

    // Only handle glass effect for header, search bar stays fixed
    setIsContactsHeaderGlass(currentTop > 0);
    lastScrollTopRef.current = currentTop;
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
        masterSearchResultsRef.current = [];
        previousSearchQueryRef.current = '';
        previousRawSearchValueRef.current = '';
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedMedia, isNewMessageModalOpen]);

  // Fetch current user info and employee data
  useEffect(() => {
    const fetchCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        console.log('🔍 Looking for user with email:', user.email);

        // Only try database lookup if it looks like an email
        if (user.email.includes('@')) {
          const { data: userRow, error } = await supabase
            .from('users')
            .select(`
              id, 
              full_name, 
              email,
              employee_id,
              is_superuser,
              tenants_employee!employee_id(
                id,
                display_name
              )
            `)
            .eq('email', user.email)
            .single();

          if (userRow) {
            console.log('✅ Found user in database:', userRow);
            setCurrentUser(userRow);

            // Set superuser status
            const superuserStatus = userRow.is_superuser === true;
            setIsSuperuser(superuserStatus);

            // For non-superusers, always show only their contacts (no tabs)
            if (!superuserStatus) {
              setShowMyContactsOnly(true);
            }

            // Set employee ID and display name for role filtering
            if (userRow.employee_id && typeof userRow.employee_id === 'number') {
              setCurrentUserEmployeeId(userRow.employee_id);
            }

            if (userRow.full_name) {
              setCurrentUserFullName(userRow.full_name);
            } else if (userRow.tenants_employee && Array.isArray(userRow.tenants_employee) && userRow.tenants_employee.length > 0) {
              const displayName = (userRow.tenants_employee as any)[0].display_name;
              if (displayName) {
                setCurrentUserFullName(displayName);
              }
            }
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

        // Try to set full name from metadata
        if (fallbackUser.full_name) {
          setCurrentUserFullName(fallbackUser.full_name);
        }
      }
    };
    fetchCurrentUser();
  }, []);

  // Fetch all employees for display name mapping (including photos for avatars)
  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        const { data, error } = await supabase
          .from('tenants_employee')
          .select('id, display_name, photo_url, photo')
          .order('display_name', { ascending: true });

        if (!error && data) {
          setAllEmployees(data);
        }
      } catch (error) {
        console.error('Error fetching employees:', error);
      }
    };

    fetchEmployees();
  }, []);

  // Update client display names when employees are loaded
  useEffect(() => {
    if (allEmployees.length > 0 && clients.length > 0) {
      setClients(prevClients => {
        const updated = prevClients.map(client => {
          // For legacy leads, update closer and scheduler display names if they're still IDs
          if (client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_')) {
            const currentCloser = client.closer_id ? getEmployeeDisplayName(client.closer_id) : client.closer;
            const currentScheduler = client.meeting_scheduler_id ? getEmployeeDisplayName(client.meeting_scheduler_id) : client.scheduler;

            // Only update if the values changed (avoid unnecessary re-renders)
            if (currentCloser !== client.closer || currentScheduler !== client.scheduler) {
              return {
                ...client,
                closer: currentCloser,
                scheduler: currentScheduler,
              };
            }
          }
          return client;
        });
        return updated;
      });
    }
  }, [allEmployees.length]); // Only depend on employees, not clients

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
      // IMMEDIATELY check sessionStorage for cached data and set loading to false if found
      // This prevents the spinner from showing even briefly
      const hasCachedDataDirect = getHasCachedData();
      if (hasCachedDataDirect) {
        setLoading(false);
      }

      // Get current tab's state
      const currentClients = showMyContactsOnly ? myContactsClients : allContactsClients;
      const currentSelectedClient = showMyContactsOnly ? myContactsSelectedClient : allContactsSelectedClient;
      const hasInitialData = hasInitialDataRef.current || getHasInitialData();

      console.log(`🔍 Checking cached state for ${showMyContactsOnly ? 'My Contacts' : 'All Contacts'} tab:`, {
        currentClientsLength: currentClients.length,
        allMessagesLength: allMessages.length,
        hasInitialData: hasInitialData,
        hasInitialDataRef: hasInitialDataRef.current,
        sessionStorageValue: getHasInitialData(),
        hasCachedDataDirect: hasCachedDataDirect
      });

      // If we have cached data (either from React state or directly from sessionStorage), use it immediately
      if (hasCachedDataDirect || (currentClients.length > 0 && allMessages.length > 0)) {
        console.log(`✅ Using cached WhatsApp data for ${showMyContactsOnly ? 'My Contacts' : 'All Contacts'} tab:`, {
          clientsCount: currentClients.length,
          messagesCount: allMessages.length,
          selectedClient: currentSelectedClient?.name || currentSelectedClient?.lead_number || 'none',
          hasInitialData: hasInitialData,
          fromDirectCheck: hasCachedDataDirect
        });

        // IMMEDIATELY set loading to false to hide spinner
        setLoading(false);

        // Mark that we have initial data (if not already marked)
        if (!hasInitialData) {
          hasInitialDataRef.current = true;
          setHasInitialData(true);
        }

        // If React state hasn't been restored yet but we have cached data, wait for state to restore
        if (hasCachedDataDirect && (currentClients.length === 0 || allMessages.length === 0)) {
          console.log('⏳ Cached data detected but React state not yet restored, waiting for state restoration...');
          // State will be restored by usePersistedState, just return early to prevent fetching
          return;
        }

        // Restore messages for selected client if one is selected
        if (currentSelectedClient) {
          const clientMessages = allMessages.filter(msg => {
            if (currentSelectedClient.lead_type === 'legacy' || currentSelectedClient.id?.toString().startsWith('legacy_')) {
              return msg.legacy_id === Number(currentSelectedClient.id);
            } else if (currentSelectedClient.contact_id) {
              return msg.contact_id === currentSelectedClient.contact_id;
            } else {
              return msg.lead_id === currentSelectedClient.id;
            }
          }).sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
          if (showMyContactsOnly) {
            setMyContactsMessages(clientMessages);
          } else {
            setAllContactsMessages(clientMessages);
          }
        }

        // Only fetch new messages (polling for updates)
        fetchNewMessagesOnly();
        return;
      }

      // If "My Contacts" is enabled but user info isn't loaded yet, wait for it
      if (showMyContactsOnly && !currentUserEmployeeId && !currentUserFullName) {
        console.log('⏳ Waiting for user info before fetching "My Contacts"');
        return;
      }

      // If we already have data for this tab, skip full fetch
      if (hasInitialData && currentClients.length > 0) {
        console.log(`⏭️ Skipping full fetch - using cached data for ${showMyContactsOnly ? 'My Contacts' : 'All Contacts'} tab`);
        setLoading(false);
        return;
      }

      // No cached data - need to fetch
      console.log(`🔄 No cached data found, fetching fresh data for ${showMyContactsOnly ? 'My Contacts' : 'All Contacts'} tab`);

      try {
        setLoading(true);
        hasInitialDataRef.current = true;
        setHasInitialData(true);

        // Fetch all WhatsApp messages to get both lead_ids, contact_ids, and legacy_ids
        // IMPORTANT: Fetch ALL messages without limit to ensure we don't miss any contacts/leads
        // Supabase defaults to 1000 rows, so we need to explicitly fetch all or use pagination
        let whatsappMessages: any[] = [];
        let hasMore = true;
        let page = 0;
        const PAGE_SIZE = 1000;

        while (hasMore) {
          const { data: pageData, error: pageError } = await supabase
            .from('whatsapp_messages')
            .select('lead_id, contact_id, legacy_id, phone_number, sent_at, direction, is_read')
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
            .order('sent_at', { ascending: false });

          if (pageError) {
            console.error('❌ Error fetching WhatsApp messages page', page, ':', pageError);
            break;
          }

          if (pageData && pageData.length > 0) {
            whatsappMessages.push(...pageData);
            console.log(`🔍 DEBUG: Fetched page ${page + 1}, ${pageData.length} messages, total so far: ${whatsappMessages.length}`);

            // If we got less than PAGE_SIZE, we've reached the end
            if (pageData.length < PAGE_SIZE) {
              hasMore = false;
            } else {
              page++;
            }
          } else {
            hasMore = false;
          }
        }

        console.log('🔍 DEBUG: Total WhatsApp messages fetched:', whatsappMessages.length);

        // Check for L204687 specifically in messages
        const l204687Messages = whatsappMessages.filter((msg: any) => {
          // Check if message has lead_id that might be L204687
          return msg.lead_id;
        });
        console.log('🔍 DEBUG L204687: Messages with lead_id:', l204687Messages.length);

        // Get unique lead IDs from WhatsApp messages (where lead_id is not null)
        const uniqueLeadIds = new Set<string>();
        // Get unique contact IDs from WhatsApp messages (where contact_id is not null)
        const uniqueContactIds = new Set<number>();
        // Map contact_id to legacy_id from whatsapp_messages
        const contactToLegacyIdMap = new Map<number, number>();

        whatsappMessages.forEach((msg: any) => {
          if (msg.lead_id) {
            uniqueLeadIds.add(String(msg.lead_id));
          }
          if (msg.contact_id) {
            uniqueContactIds.add(Number(msg.contact_id));
            // If this message has a legacy_id, map it to the contact_id
            if (msg.legacy_id) {
              contactToLegacyIdMap.set(Number(msg.contact_id), Number(msg.legacy_id));
            }
          }
        });

        console.log('🔍 DEBUG: After processing messages:');
        console.log('  - Total messages:', whatsappMessages.length);
        console.log('  - Unique lead_ids:', uniqueLeadIds.size);
        console.log('  - Unique contact_ids:', uniqueContactIds.size);

        // Check for L204687 in messages BEFORE we query for it
        console.log('🔍 DEBUG L204687: Checking messages for L204687...');
        // First, try to find L204687 by lead_number to get its id
        const { data: l204687Lead, error: l204687Error } = await supabase
          .from('leads')
          .select('id, lead_number')
          .or('lead_number.eq.L204687,lead_number.eq.C204687,lead_number.eq.204687,lead_number.ilike.%204687%')
          .limit(10);

        if (!l204687Error && l204687Lead && l204687Lead.length > 0) {
          console.log('🔍 DEBUG L204687: Found in leads table:', l204687Lead);
          for (const lead of l204687Lead) {
            const l204687Id = lead.id;
            const l204687Number = lead.lead_number;
            const l204687MessageCount = whatsappMessages.filter((m: any) => m.lead_id === l204687Id).length;
            const hasL204687InUniqueIds = uniqueLeadIds.has(String(l204687Id));

            console.log('🔍 DEBUG L204687: Lead:', { id: l204687Id, lead_number: l204687Number });
            console.log('🔍 DEBUG L204687: Message count in fetched messages:', l204687MessageCount);
            console.log('🔍 DEBUG L204687: In uniqueLeadIds?', hasL204687InUniqueIds);

            if (l204687MessageCount > 0 && !hasL204687InUniqueIds) {
              console.log('⚠️ DEBUG L204687: WARNING - Has messages but not in uniqueLeadIds! Adding manually...');
              uniqueLeadIds.add(String(l204687Id));
              console.log('✅ DEBUG L204687: Added to uniqueLeadIds');
            } else if (l204687MessageCount === 0) {
              console.log('⚠️ DEBUG L204687: No messages found for this lead_id in fetched messages');
              // Check if messages might exist but weren't fetched (beyond 1000 limit)
              console.log('⚠️ DEBUG L204687: This might mean messages exist but were not fetched due to pagination limit');
            }
          }
        } else {
          console.log('🔍 DEBUG L204687: Not found in leads table, error:', l204687Error);
        }

        console.log('🔍 DEBUG: Unique lead_ids from messages:', uniqueLeadIds.size);
        console.log('🔍 DEBUG: Unique contact_ids from messages:', uniqueContactIds.size);
        console.log('🔍 DEBUG: Sample lead_ids:', Array.from(uniqueLeadIds).slice(0, 20));

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
        // IMPORTANT: Use the same approach as InteractionsTab - query leads that have messages directly
        // Instead of extracting lead_ids and querying, we'll query all leads and filter by those with messages
        const newLeadIds = Array.from(uniqueLeadIds);
        let newLeadsData: any[] = [];

        console.log('🔍 DEBUG: Starting to fetch new leads');
        console.log('🔍 DEBUG: uniqueLeadIds from messages=', newLeadIds.length, 'sample:', newLeadIds.slice(0, 10));


        if (newLeadIds.length > 0) {
          // For "All Contacts" tab: fetch ALL leads that have messages (no role filter)
          // For "My Contacts" tab: apply role filter
          if (!showMyContactsOnly) {
            // All Contacts: Fetch all leads with messages, no role filter
            // Use batched queries if there are too many lead_ids (Supabase has a limit)
            const BATCH_SIZE = 1000;
            const batches: string[][] = [];
            for (let i = 0; i < newLeadIds.length; i += BATCH_SIZE) {
              batches.push(newLeadIds.slice(i, i + BATCH_SIZE));
            }

            const allLeadsPromises = batches.map(batch =>
              supabase
                .from('leads')
                .select('id, lead_number, name, email, phone, mobile, topic, status, stage, closer, scheduler, handler, manager, helper, expert, case_handler_id, next_followup, probability, balance, potential_applicants')
                .in('id', batch)
            );

            const allLeadsResults = await Promise.all(allLeadsPromises);
            const allLeads: any[] = [];

            allLeadsResults.forEach(({ data, error }) => {
              if (error) {
                console.error('Error fetching leads batch:', error);
              } else if (data) {
                allLeads.push(...data);
              }
            });

            newLeadsData = allLeads.map(lead => ({
              ...lead,
              lead_type: 'new' as const,
              isContact: false
            }));

            console.log('🔍 DEBUG: Fetched all leads with messages:', newLeadsData.length, 'from', newLeadIds.length, 'unique lead_ids');
            console.log('🔍 DEBUG: Sample fetched lead_numbers:', newLeadsData.slice(0, 10).map((l: any) => l.lead_number));

            // Check if L204687 is in the results
            const hasL204687 = newLeadsData.some((l: any) =>
              l.lead_number === '204687' ||
              l.lead_number === 'L204687' ||
              String(l.lead_number) === '204687' ||
              String(l.lead_number) === 'L204687'
            );
            console.log('🔍 DEBUG L204687: In fetched results?', hasL204687);

            // IMPORTANT: Check for any lead_ids from messages that weren't found
            // This handles cases where the batch query might have missed some leads
            const foundLeadIds = new Set(newLeadsData.map((l: any) => l.id));
            const missingLeadIds = newLeadIds.filter(id => !foundLeadIds.has(id));

            console.log('🔍 DEBUG: Found lead_ids:', foundLeadIds.size);
            console.log('🔍 DEBUG: Missing lead_ids:', missingLeadIds.length);
            console.log('🔍 DEBUG: Sample missing lead_ids:', missingLeadIds.slice(0, 10));

            // Check if L204687's id is in missingLeadIds
            if (l204687Lead && l204687Lead.length > 0) {
              const l204687Id = l204687Lead[0].id;
              const isL204687Missing = missingLeadIds.includes(String(l204687Id));
              console.log('🔍 DEBUG L204687: Is in missingLeadIds?', isL204687Missing, 'id:', l204687Id);
            }

            if (missingLeadIds.length > 0) {
              console.log('🔍 DEBUG: Found', missingLeadIds.length, 'missing lead_ids, fetching them directly...');
              // Fetch missing leads directly by id in batches
              const MISSING_BATCH_SIZE = 100;
              for (let i = 0; i < missingLeadIds.length; i += MISSING_BATCH_SIZE) {
                const batch = missingLeadIds.slice(i, i + MISSING_BATCH_SIZE);
                console.log(`🔍 DEBUG: Fetching missing batch ${i / MISSING_BATCH_SIZE + 1}, size:`, batch.length);
                const { data: missingLeads, error: missingError } = await supabase
                  .from('leads')
                  .select('id, lead_number, name, email, phone, mobile, topic, status, stage, closer, scheduler, handler, manager, helper, expert, case_handler_id, next_followup, probability, balance, potential_applicants')
                  .in('id', batch);

                if (missingError) {
                  console.error('❌ DEBUG: Error fetching missing leads batch:', missingError);
                } else {
                  console.log(`🔍 DEBUG: Fetched ${missingLeads?.length || 0} leads from missing batch`);
                  if (missingLeads && missingLeads.length > 0) {
                    const missingLeadsData = missingLeads.map(lead => ({
                      ...lead,
                      lead_type: 'new' as const,
                      isContact: false
                    }));
                    newLeadsData.push(...missingLeadsData);

                    // Check if L204687 is in this batch
                    const hasL204687InBatch = missingLeadsData.some((l: any) =>
                      l.lead_number === '204687' ||
                      l.lead_number === 'L204687' ||
                      String(l.lead_number) === '204687' ||
                      String(l.lead_number) === 'L204687'
                    );
                    if (hasL204687InBatch) {
                      console.log('✅ DEBUG L204687: Found in missing leads batch!');
                    }
                  }
                }
              }
              console.log('🔍 DEBUG: After fetching missing leads, total newLeadsData count=', newLeadsData.length);

              // Final check for L204687
              const hasL204687Final = newLeadsData.some((l: any) =>
                l.lead_number === '204687' ||
                l.lead_number === 'L204687' ||
                String(l.lead_number) === '204687' ||
                String(l.lead_number) === 'L204687'
              );
              console.log('🔍 DEBUG L204687: Final check - In newLeadsData?', hasL204687Final);
            }
          } else {
            // My Contacts: Apply role filter
            let query = supabase
              .from('leads')
              .select('id, lead_number, name, email, phone, mobile, topic, status, stage, closer, scheduler, handler, manager, helper, expert, case_handler_id, next_followup, probability, balance, potential_applicants');

            if (currentUserEmployeeId || currentUserFullName) {
              const newLeadConditions: string[] = [];

              if (currentUserFullName) {
                const fullNameLower = currentUserFullName.trim().toLowerCase();
                newLeadConditions.push(`closer.ilike.%${fullNameLower}%`);
                newLeadConditions.push(`scheduler.ilike.%${fullNameLower}%`);
                newLeadConditions.push(`handler.ilike.%${fullNameLower}%`);
              }

              if (currentUserEmployeeId) {
                newLeadConditions.push(`manager.eq.${currentUserEmployeeId}`);
                newLeadConditions.push(`helper.eq.${currentUserEmployeeId}`);
                newLeadConditions.push(`expert.eq.${currentUserEmployeeId}`);
                newLeadConditions.push(`case_handler_id.eq.${currentUserEmployeeId}`);
              }

              if (newLeadConditions.length > 0) {
                query = query.or(newLeadConditions.join(','));
              }
            }

            // Filter by lead IDs that have WhatsApp conversations
            const BATCH_SIZE = 1000;
            const batches: string[][] = [];
            for (let i = 0; i < newLeadIds.length; i += BATCH_SIZE) {
              batches.push(newLeadIds.slice(i, i + BATCH_SIZE));
            }

            const allLeadsPromises = batches.map(batch =>
              query.in('id', batch)
            );

            const allLeadsResults = await Promise.all(allLeadsPromises);
            const allLeads: any[] = [];

            allLeadsResults.forEach(({ data, error }) => {
              if (error) {
                console.error('Error fetching leads batch:', error);
              } else if (data) {
                allLeads.push(...data);
              }
            });

            newLeadsData = allLeads.map(lead => ({
              ...lead,
              lead_type: 'new' as const,
              isContact: false
            }));
          }

          const { data: leadsData, error: leadsError } = { data: newLeadsData, error: null };

          console.log('🔍 Debug L212670: Fetched leadsData count=', leadsData?.length, 'leadIds queried=', newLeadIds.length, 'found L212670?', leadsData?.some((l: any) => l.lead_number === '212670' || String(l.lead_number) === '212670'));

          if (leadsError) {
            console.error('Error fetching new leads:', leadsError);
          } else {
            newLeadsData = (leadsData || []).map(lead => ({
              ...lead,
              lead_type: 'new' as const,
              isContact: false
            }));
          }

          // Find leads that have messages but weren't found in the initial query
          // Use the same logic as InteractionsTab.tsx: query by lead_id for new leads (line 2496)
          const missingLeadIds = new Set<string>();

          // Check all lead_ids from messages that weren't found in the initial query
          (whatsappMessages || []).forEach((msg: any) => {
            if (msg.lead_id && !newLeadIds.includes(msg.lead_id)) {
              // This lead_id has messages but wasn't in our initial query results
              missingLeadIds.add(msg.lead_id);
            }
          });

          // Search for missing leads by lead_id (same approach as InteractionsTab.tsx)
          if (missingLeadIds.size > 0) {
            console.log('🔍 Debug: Searching for missing leads by lead_id:', Array.from(missingLeadIds).slice(0, 10), `(total: ${missingLeadIds.size})`);
            for (const leadId of missingLeadIds) {
              // Skip if we already have this lead
              if (newLeadsData.some((l: any) => l.id === leadId)) {
                continue;
              }

              const { data: directLeadData, error: directError } = await supabase
                .from('leads')
                .select('id, lead_number, name, email, phone, mobile, topic, status, stage, closer, scheduler, handler, manager, helper, expert, case_handler_id, next_followup, probability, balance, potential_applicants')
                .eq('id', leadId)
                .limit(1);

              if (!directError && directLeadData && directLeadData.length > 0) {
                const lead = directLeadData[0];
                console.log(`🔍 Debug: Found lead by lead_id!`, { id: lead.id, lead_number: lead.lead_number, name: lead.name });

                // Check if this lead has messages - use the same logic as InteractionsTab.tsx
                // For new leads: check by lead_id (same as InteractionsTab.tsx line 2496)
                const hasMessages = (whatsappMessages || []).some((msg: any) => {
                  return msg.lead_id === lead.id;
                });

                const messagesCount = (whatsappMessages || []).filter((m: any) => m.lead_id === lead.id).length;

                console.log(`🔍 Debug L${lead.lead_number}: Has messages?`, hasMessages, {
                  leadId: lead.id,
                  messagesWithLeadId: messagesCount
                });

                // Check if lead matches role filter (if "My Contacts" is enabled)
                let matchesRoleFilter = true;
                if (showMyContactsOnly && (currentUserEmployeeId || currentUserFullName)) {
                  matchesRoleFilter = false;

                  if (currentUserFullName) {
                    const fullNameLower = currentUserFullName.trim().toLowerCase();
                    if (lead.closer?.toLowerCase().includes(fullNameLower) ||
                      lead.scheduler?.toLowerCase().includes(fullNameLower) ||
                      lead.handler?.toLowerCase().includes(fullNameLower)) {
                      matchesRoleFilter = true;
                    }
                  }

                  if (currentUserEmployeeId) {
                    if (lead.manager === currentUserEmployeeId ||
                      lead.helper === currentUserEmployeeId ||
                      lead.expert === currentUserEmployeeId ||
                      lead.case_handler_id === currentUserEmployeeId) {
                      matchesRoleFilter = true;
                    }
                  }
                }

                // Add to results if it has messages and (we're showing all contacts OR it matches role filter)
                if (hasMessages && (!showMyContactsOnly || matchesRoleFilter)) {
                  console.log(`✅ Adding L${lead.lead_number} to results (hasMessages: ${hasMessages}, matchesRoleFilter: ${matchesRoleFilter}, showMyContactsOnly: ${showMyContactsOnly})`);
                  newLeadsData.push({
                    ...lead,
                    lead_type: 'new' as const,
                    isContact: false
                  });
                } else {
                  console.log(`❌ Not adding L${lead.lead_number} (hasMessages: ${hasMessages}, matchesRoleFilter: ${matchesRoleFilter}, showMyContactsOnly: ${showMyContactsOnly})`);
                }
              }
            }
          }

          // Also check for L212670 specifically if it's not in the results (by lead_number as fallback)
          // Use the same search patterns as searchLeads in legacyLeadsApi.ts
          if (!newLeadsData.some((l: any) => l.lead_number === '212670' || String(l.lead_number) === '212670')) {
            console.log('🔍 Debug L212670: Not found in initial results, trying search with multiple patterns (like searchLeads)');

            // Use the same patterns as searchLeads for 6-digit queries
            // Try exact matches: L212670, C212670, 212670
            const exactPatterns = [
              'lead_number.eq.L212670',
              'lead_number.eq.C212670',
              'lead_number.eq.212670',
            ];

            let directLeadData: any = null;
            let directError: any = null;

            // Try exact match first
            const { data: exactData, error: exactError } = await supabase
              .from('leads')
              .select('id, lead_number, name, email, phone, mobile, topic, status, stage, closer, scheduler, handler, manager, helper, expert, case_handler_id, next_followup, probability, balance, potential_applicants')
              .or(exactPatterns.join(','))
              .limit(1);

            if (!exactError && exactData && exactData.length > 0) {
              directLeadData = exactData;
              console.log('🔍 Debug L212670: Found via exact match!', {
                id: exactData[0].id,
                lead_number: exactData[0].lead_number,
                name: exactData[0].name
              });
            } else {
              // Fallback to ilike search
              console.log('🔍 Debug L212670: Exact match failed, trying ilike...');
              const { data: ilikeData, error: ilikeError } = await supabase
                .from('leads')
                .select('id, lead_number, name, email, phone, mobile, topic, status, stage, closer, scheduler, handler, manager, helper, expert, case_handler_id, next_followup, probability, balance, potential_applicants')
                .ilike('lead_number', '%212670%')
                .limit(10);

              if (!ilikeError && ilikeData && ilikeData.length > 0) {
                // Find exact match (212670, L212670, or number 212670)
                const exactMatch = ilikeData.find((l: any) => {
                  const ln = String(l.lead_number || '').trim();
                  return ln === '212670' ||
                    ln === 'L212670' ||
                    ln === 'l212670' ||
                    Number(ln) === 212670;
                });

                if (exactMatch) {
                  directLeadData = [exactMatch];
                  console.log('🔍 Debug L212670: Found via ilike search!', {
                    id: exactMatch.id,
                    lead_number: exactMatch.lead_number,
                    name: exactMatch.name
                  });
                } else {
                  console.log('🔍 Debug L212670: ilike found results but no exact match:', ilikeData.map((l: any) => ({
                    lead_number: l.lead_number,
                    id: l.id,
                    name: l.name
                  })));
                }
              } else {
                directError = ilikeError || exactError;
                console.log('🔍 Debug L212670: Both exact and ilike searches failed:', directError);
              }
            }

            if (directLeadData && directLeadData.length > 0) {
              const lead = directLeadData[0];
              console.log(`🔍 Debug L212670: Found directly by lead_number!`, { id: lead.id, name: lead.name });

              // Check if this lead has messages - use the same logic as InteractionsTab.tsx
              // For new leads: check by lead_id (same as InteractionsTab.tsx line 2496)
              const hasDirectMessages = (whatsappMessages || []).some((msg: any) => {
                return msg.lead_id === lead.id;
              });

              const directMessagesCount = (whatsappMessages || []).filter((m: any) => m.lead_id === lead.id).length;

              // Also check if this lead has contacts with messages
              // First, find all contacts associated with this lead
              const { data: leadContacts, error: contactsError } = await supabase
                .from('lead_leadcontact')
                .select('contact_id')
                .eq('newlead_id', lead.id);

              let hasContactsWithMessages = false;
              let contactsWithMessagesCount = 0;

              if (!contactsError && leadContacts && leadContacts.length > 0) {
                const contactIds = leadContacts.map((c: any) => c.contact_id).filter(Boolean);
                if (contactIds.length > 0) {
                  // Check if any of these contacts have messages
                  contactsWithMessagesCount = (whatsappMessages || []).filter((m: any) =>
                    m.contact_id && contactIds.includes(Number(m.contact_id))
                  ).length;
                  hasContactsWithMessages = contactsWithMessagesCount > 0;
                }
              }

              // Lead has messages if it has direct messages OR contacts with messages
              const hasMessages = hasDirectMessages || hasContactsWithMessages;

              // IMPORTANT: Also check if contacts have messages by checking all whatsappMessages
              // Sometimes messages might be linked differently, so let's check all messages for these contact IDs
              let contactsWithAnyMessages = false;
              if (leadContacts && leadContacts.length > 0) {
                const contactIds = leadContacts.map((c: any) => c.contact_id).filter(Boolean);
                // Check if any messages have these contact_ids
                const messagesForContacts = (whatsappMessages || []).filter((m: any) =>
                  m.contact_id && contactIds.includes(Number(m.contact_id))
                );
                contactsWithAnyMessages = messagesForContacts.length > 0;
                if (contactsWithAnyMessages && !hasContactsWithMessages) {
                  console.log(`🔍 Debug L212670: Found ${messagesForContacts.length} messages for contacts using alternative check!`);
                  hasContactsWithMessages = true;
                  contactsWithMessagesCount = messagesForContacts.length;
                }
              }

              // Check if lead has ANY contacts (even without messages) - we should show it in "All Contacts" tab
              const hasContacts = leadContacts && leadContacts.length > 0;

              console.log(`🔍 Debug L212670: Has messages?`, hasMessages, {
                leadId: lead.id,
                directMessagesWithLeadId: directMessagesCount,
                hasContactsWithMessages: hasContactsWithMessages,
                contactsWithMessagesCount: contactsWithMessagesCount,
                totalContacts: leadContacts?.length || 0,
                hasContacts: hasContacts,
                contactIds: leadContacts?.map((c: any) => c.contact_id).filter(Boolean) || []
              });

              // IMPORTANT: Even if no direct messages, if it has contacts with messages, we should still add it
              // This ensures L212670 appears in the contact panel so users can access its contacts
              if (hasContactsWithMessages && !hasDirectMessages) {
                console.log(`🔍 Debug L212670: No direct messages but has ${contactsWithMessagesCount} messages via contacts - will add to show contacts`);
              }

              // Check if lead matches role filter (if "My Contacts" is enabled)
              let matchesRoleFilter = true;
              if (showMyContactsOnly && (currentUserEmployeeId || currentUserFullName)) {
                matchesRoleFilter = false;

                if (currentUserFullName) {
                  const fullNameLower = currentUserFullName.trim().toLowerCase();
                  if (lead.closer?.toLowerCase().includes(fullNameLower) ||
                    lead.scheduler?.toLowerCase().includes(fullNameLower) ||
                    lead.handler?.toLowerCase().includes(fullNameLower)) {
                    matchesRoleFilter = true;
                  }
                }

                if (currentUserEmployeeId) {
                  if (lead.manager === currentUserEmployeeId ||
                    lead.helper === currentUserEmployeeId ||
                    lead.expert === currentUserEmployeeId ||
                    lead.case_handler_id === currentUserEmployeeId) {
                    matchesRoleFilter = true;
                  }
                }
              }

              // Add to results if:
              // 1. It has messages (direct or via contacts) OR
              // 2. It has contacts (even without messages) AND we're showing all contacts
              // AND (we're showing all contacts OR it matches role filter)
              const shouldAdd = (hasMessages || (hasContacts && !showMyContactsOnly)) && (!showMyContactsOnly || matchesRoleFilter);

              if (shouldAdd) {
                console.log(`✅ Adding L212670 to results (hasMessages: ${hasMessages}, hasContacts: ${hasContacts}, matchesRoleFilter: ${matchesRoleFilter}, showMyContactsOnly: ${showMyContactsOnly})`);
                newLeadsData.push({
                  ...lead,
                  lead_type: 'new' as const,
                  isContact: false
                });
              } else {
                console.log(`❌ Not adding L212670 (hasMessages: ${hasMessages}, hasContacts: ${hasContacts}, matchesRoleFilter: ${matchesRoleFilter}, showMyContactsOnly: ${showMyContactsOnly})`);
              }
            } else {
              console.log('🔍 Debug L212670: Lead not found in new leads table, checking legacy leads...');
              // Also check if L212670 is a legacy lead
              const { data: legacyL212670, error: legacyError } = await supabase
                .from('leads_lead')
                .select('id, lead_number, name, email, phone, mobile, topic, status, stage, closer_id, meeting_scheduler_id, meeting_manager_id, meeting_lawyer_id, expert_id, case_handler_id, next_followup, probability, total, potential_applicants')
                .or('lead_number.eq.212670,lead_number.eq.L212670,lead_number.ilike.%212670%')
                .limit(1);

              if (!legacyError && legacyL212670 && legacyL212670.length > 0) {
                const legacyLead = legacyL212670[0];
                console.log(`🔍 Debug L212670: Found in legacy leads!`, { id: legacyLead.id, lead_number: legacyLead.lead_number, name: legacyLead.name });

                // Check if this legacy lead has messages
                const hasLegacyMessages = (whatsappMessages || []).some((msg: any) => {
                  return msg.legacy_id === legacyLead.id;
                });

                const legacyMessagesCount = (whatsappMessages || []).filter((m: any) => m.legacy_id === legacyLead.id).length;

                console.log(`🔍 Debug L212670 (legacy): Has messages?`, hasLegacyMessages, {
                  legacyId: legacyLead.id,
                  messagesWithLegacyId: legacyMessagesCount
                });

                if (hasLegacyMessages) {
                  console.log(`✅ Adding L212670 (legacy) to results`);
                  legacyLeadsData.push({
                    id: `legacy_${legacyLead.id}`,
                    lead_number: String(legacyLead.lead_number || legacyLead.id),
                    name: legacyLead.name || '',
                    email: legacyLead.email || '',
                    phone: legacyLead.phone || '',
                    mobile: legacyLead.mobile || '',
                    topic: legacyLead.topic || '',
                    status: legacyLead.status ? String(legacyLead.status) : '',
                    stage: legacyLead.stage ? String(legacyLead.stage) : '',
                    closer: legacyLead.closer_id ? getEmployeeDisplayName(legacyLead.closer_id) : '',
                    scheduler: legacyLead.meeting_scheduler_id ? getEmployeeDisplayName(legacyLead.meeting_scheduler_id) : '',
                    closer_id: legacyLead.closer_id || null,
                    meeting_scheduler_id: legacyLead.meeting_scheduler_id || null,
                    meeting_manager_id: legacyLead.meeting_manager_id || null,
                    meeting_lawyer_id: legacyLead.meeting_lawyer_id || null,
                    expert_id: legacyLead.expert_id || null,
                    case_handler_id: legacyLead.case_handler_id || null,
                    next_followup: legacyLead.next_followup || '',
                    probability: legacyLead.probability ? Number(legacyLead.probability) : undefined,
                    balance: legacyLead.total ? Number(legacyLead.total) : undefined,
                    potential_applicants: legacyLead.potential_applicants || '',
                    lead_type: 'legacy' as const,
                    isContact: false
                  });
                }
              }
            }
          } else {
            console.log('🔍 Debug L212670: Already found in initial results');
          }
        }

        // Fetch legacy leads with conversations
        const legacyLeadIds = Array.from(uniqueLegacyIds).map(id => Number(id)).filter(id => !isNaN(id));
        let legacyLeadsData: any[] = [];

        if (legacyLeadIds.length > 0) {
          let query = supabase
            .from('leads_lead')
            .select('id, lead_number, name, email, phone, mobile, topic, status, stage, closer_id, meeting_scheduler_id, meeting_manager_id, meeting_lawyer_id, expert_id, case_handler_id, next_followup, probability, total, potential_applicants');

          // Apply role filter if "My Contacts" is enabled AND we have user info
          // If showMyContactsOnly is true but user info isn't loaded yet, skip filtering (will re-fetch when user info loads)
          if (showMyContactsOnly && currentUserEmployeeId) {
            const legacyConditions = [
              `closer_id.eq.${currentUserEmployeeId}`,
              `meeting_scheduler_id.eq.${currentUserEmployeeId}`,
              `meeting_manager_id.eq.${currentUserEmployeeId}`,
              `meeting_lawyer_id.eq.${currentUserEmployeeId}`,
              `expert_id.eq.${currentUserEmployeeId}`,
              `case_handler_id.eq.${currentUserEmployeeId}`
            ];
            query = query.or(legacyConditions.join(','));
          }

          // Always filter by lead IDs that have WhatsApp conversations
          query = query.in('id', legacyLeadIds);

          const { data: legacyLeads, error: legacyLeadsError } = await query;

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
              closer: lead.closer_id ? getEmployeeDisplayName(lead.closer_id) : '',
              scheduler: lead.meeting_scheduler_id ? getEmployeeDisplayName(lead.meeting_scheduler_id) : '',
              closer_id: lead.closer_id || null,
              meeting_scheduler_id: lead.meeting_scheduler_id || null,
              meeting_manager_id: lead.meeting_manager_id || null,
              meeting_lawyer_id: lead.meeting_lawyer_id || null,
              expert_id: lead.expert_id || null,
              case_handler_id: lead.case_handler_id || null,
              next_followup: lead.next_followup || '',
              probability: lead.probability ? Number(lead.probability) : undefined,
              balance: lead.total ? Number(lead.total) : undefined,
              potential_applicants: lead.potential_applicants || '',
              lead_type: 'legacy' as const,
              isContact: false
            }));
          }
        }

        // Fetch contacts with WhatsApp conversations
        // For "All Contacts" tab: include ALL contacts with messages
        // For "My Contacts" tab: only include contacts whose associated leads match role filter
        const contactIdsArray = Array.from(uniqueContactIds);
        let contactClientsData: any[] = [];

        // IMPORTANT: Also check if L212670 has contacts with messages that weren't found via lead_id
        // This handles cases where messages only have contact_id, not lead_id
        const l212670Found = newLeadsData.some((l: any) => l.lead_number === '212670' || String(l.lead_number) === '212670') ||
          legacyLeadsData.some((l: any) => l.lead_number === '212670' || String(l.lead_number) === '212670');

        if (!l212670Found) {
          console.log('🔍 Debug L212670: Checking if it has contacts with messages...');
          // Try to find L212670 in new leads table (try multiple formats)
          let l212670Id: string | null = null;
          let l212670Data: any = null;

          // Try as string
          const { data: stringData } = await supabase
            .from('leads')
            .select('id, lead_number')
            .eq('lead_number', '212670')
            .limit(1);

          if (stringData && stringData.length > 0) {
            l212670Data = stringData[0];
            l212670Id = stringData[0].id;
          } else {
            // Try as number
            const { data: numberData } = await supabase
              .from('leads')
              .select('id, lead_number')
              .eq('lead_number', 212670)
              .limit(1);

            if (numberData && numberData.length > 0) {
              l212670Data = numberData[0];
              l212670Id = numberData[0].id;
            } else {
              // Try legacy leads
              const { data: legacyData } = await supabase
                .from('leads_lead')
                .select('id, lead_number')
                .or('lead_number.eq.212670,lead_number.eq.L212670,lead_number.ilike.%212670%')
                .limit(1);

              if (legacyData && legacyData.length > 0) {
                l212670Data = legacyData[0];
                l212670Id = `legacy_${legacyData[0].id}`;
              }
            }
          }

          if (l212670Id && l212670Data) {
            console.log(`🔍 Debug L212670: Found lead!`, { id: l212670Id, lead_number: l212670Data.lead_number, isLegacy: l212670Id.toString().startsWith('legacy_') });

            // Find contacts for L212670
            let l212670Contacts: any[] = [];
            if (l212670Id.toString().startsWith('legacy_')) {
              const legacyId = Number(l212670Id.replace('legacy_', ''));
              const { data: legacyContacts } = await supabase
                .from('lead_leadcontact')
                .select('contact_id')
                .eq('lead_id', legacyId);
              if (legacyContacts) l212670Contacts = legacyContacts;
            } else {
              const { data: newContacts } = await supabase
                .from('lead_leadcontact')
                .select('contact_id')
                .eq('newlead_id', l212670Id);
              if (newContacts) l212670Contacts = newContacts;
            }

            if (l212670Contacts.length > 0) {
              const l212670ContactIds = l212670Contacts.map((c: any) => c.contact_id).filter(Boolean);
              // Check if any of these contacts have messages
              const l212670ContactsWithMessages = (whatsappMessages || []).filter((m: any) =>
                m.contact_id && l212670ContactIds.includes(Number(m.contact_id))
              );

              if (l212670ContactsWithMessages.length > 0) {
                console.log(`🔍 Debug L212670: Found ${l212670ContactsWithMessages.length} messages via contacts! Adding contact IDs to fetch list.`);
                // Add these contact IDs to the fetch list if not already there
                l212670ContactIds.forEach((contactId: number) => {
                  if (!contactIdsArray.includes(contactId)) {
                    contactIdsArray.push(contactId);
                    uniqueContactIds.add(contactId);
                  }
                });
              } else {
                console.log(`🔍 Debug L212670: Found ${l212670Contacts.length} contacts but none have messages`);
              }
            } else {
              console.log(`🔍 Debug L212670: No contacts found for this lead`);
            }
          } else {
            console.log('🔍 Debug L212670: Lead not found in database (neither new nor legacy)');
          }
        }

        if (contactIdsArray.length > 0) {
          // First, fetch relationships to get lead associations (both new and legacy)
          const { data: relationships, error: relationshipsError } = await supabase
            .from('lead_leadcontact')
            .select('contact_id, newlead_id, lead_id')
            .in('contact_id', contactIdsArray);

          if (relationshipsError) {
            console.error('Error fetching contact relationships:', relationshipsError);
          }

          // Separate new leads and legacy leads from relationships
          const newLeadIdsForContacts = new Set<string>();
          const legacyLeadIdsForContacts = new Set<number>();
          const contactToNewLeadMap = new Map<number, string>();
          const contactToLegacyLeadMap = new Map<number, number>();
          const connectedContactIds = new Set<number>();

          if (relationships && relationships.length > 0) {
            relationships.forEach((rel: any) => {
              if (rel.contact_id) {
                connectedContactIds.add(Number(rel.contact_id));
                if (rel.newlead_id) {
                  newLeadIdsForContacts.add(String(rel.newlead_id));
                  contactToNewLeadMap.set(Number(rel.contact_id), String(rel.newlead_id));
                }
                if (rel.lead_id) {
                  legacyLeadIdsForContacts.add(Number(rel.lead_id));
                  contactToLegacyLeadMap.set(Number(rel.contact_id), Number(rel.lead_id));
                }
              }
            });
          }

          // For "All Contacts" tab: fetch ALL contacts with messages, even if no relationship exists
          // For "My Contacts" tab: only fetch contacts that have relationships (to filter by role)
          const contactsToFetch = !showMyContactsOnly
            ? contactIdsArray  // All contacts with messages
            : Array.from(connectedContactIds);  // Only contacts with relationships

          if (contactsToFetch.length > 0) {
            // Fetch contact details
            const { data: contactsData, error: contactsError } = await supabase
              .from('leads_contact')
              .select('id, name, email, phone, mobile, whatsapp_profile_picture_url')
              .in('id', contactsToFetch);

            if (contactsError) {
              console.error('Error fetching contacts:', contactsError);
            } else if (contactsData && contactsData.length > 0) {
              // Fetch new leads for contacts (with role filter if enabled)
              let newLeadsForContacts: any[] = [];
              if (newLeadIdsForContacts.size > 0) {
                let contactsNewLeadsQuery = supabase
                  .from('leads')
                  .select('id, lead_number, name, email, phone, mobile, topic, status, stage, closer, scheduler, handler, manager, helper, expert, case_handler_id, next_followup, probability, balance, potential_applicants')
                  .in('id', Array.from(newLeadIdsForContacts));

                // Apply role filter if "My Contacts" is enabled
                if (showMyContactsOnly && (currentUserEmployeeId || currentUserFullName)) {
                  const contactLeadConditions: string[] = [];

                  if (currentUserFullName) {
                    const fullNameLower = currentUserFullName.trim().toLowerCase();
                    contactLeadConditions.push(`closer.ilike.%${fullNameLower}%`);
                    contactLeadConditions.push(`scheduler.ilike.%${fullNameLower}%`);
                    contactLeadConditions.push(`handler.ilike.%${fullNameLower}%`);
                  }

                  if (currentUserEmployeeId) {
                    contactLeadConditions.push(`manager.eq.${currentUserEmployeeId}`);
                    contactLeadConditions.push(`helper.eq.${currentUserEmployeeId}`);
                    contactLeadConditions.push(`expert.eq.${currentUserEmployeeId}`);
                    contactLeadConditions.push(`case_handler_id.eq.${currentUserEmployeeId}`);
                  }

                  if (contactLeadConditions.length > 0) {
                    contactsNewLeadsQuery = contactsNewLeadsQuery.or(contactLeadConditions.join(','));
                  }
                }

                const { data: newLeadsData, error: newLeadsError } = await contactsNewLeadsQuery;
                if (!newLeadsError && newLeadsData) {
                  newLeadsForContacts = newLeadsData;
                }
              }

              // Fetch legacy leads for contacts (with role filter if enabled)
              // Include both legacy_ids from relationships AND from whatsapp_messages
              const allLegacyIdsForContacts = new Set<number>();
              legacyLeadIdsForContacts.forEach(id => allLegacyIdsForContacts.add(id));
              // Add legacy_ids from whatsapp_messages
              contactToLegacyIdMap.forEach(legacyId => allLegacyIdsForContacts.add(legacyId));

              let legacyLeadsForContacts: any[] = [];
              if (allLegacyIdsForContacts.size > 0) {
                let contactsLegacyLeadsQuery = supabase
                  .from('leads_lead')
                  .select('id, lead_number, name, email, phone, mobile, topic, status, stage, closer_id, meeting_scheduler_id, meeting_manager_id, meeting_lawyer_id, expert_id, case_handler_id, next_followup, probability, total, potential_applicants')
                  .in('id', Array.from(allLegacyIdsForContacts));

                // Apply role filter if "My Contacts" is enabled AND we have user info
                if (showMyContactsOnly && currentUserEmployeeId) {
                  const legacyConditions = [
                    `closer_id.eq.${currentUserEmployeeId}`,
                    `meeting_scheduler_id.eq.${currentUserEmployeeId}`,
                    `meeting_manager_id.eq.${currentUserEmployeeId}`,
                    `meeting_lawyer_id.eq.${currentUserEmployeeId}`,
                    `expert_id.eq.${currentUserEmployeeId}`,
                    `case_handler_id.eq.${currentUserEmployeeId}`
                  ];
                  contactsLegacyLeadsQuery = contactsLegacyLeadsQuery.or(legacyConditions.join(','));
                }

                const { data: legacyLeadsData, error: legacyLeadsError } = await contactsLegacyLeadsQuery;
                if (!legacyLeadsError && legacyLeadsData) {
                  legacyLeadsForContacts = legacyLeadsData;
                }
              }

              // Create Client objects ONLY for contacts whose associated leads match the role filter
              // If "My Contacts" is enabled, only include contacts whose leads passed the role filter
              // If "All Contacts" is enabled, include all contacts
              // IMPORTANT: Also check newLeadsData (main leads list) to include contacts from leads found via fallback (e.g., L212670)
              contactClientsData = contactsData
                .filter((contact: any) => {
                  const newLeadId = contactToNewLeadMap.get(contact.id);
                  const legacyLeadId = contactToLegacyLeadMap.get(contact.id);
                  // Also check if we have a legacy_id directly from whatsapp_messages
                  const legacyIdFromMessages = contactToLegacyIdMap.get(contact.id);
                  const finalLegacyLeadId = legacyIdFromMessages || legacyLeadId;

                  // If "My Contacts" is enabled, only include contacts whose associated lead is in the filtered results
                  if (showMyContactsOnly && (currentUserEmployeeId || currentUserFullName)) {
                    if (newLeadId) {
                      // Check if the new lead is in the filtered results
                      // Check both newLeadsForContacts (from relationships) AND newLeadsData (main leads, including fallback finds)
                      const inContactsLeads = newLeadsForContacts.some(lead => lead.id === newLeadId);
                      const inMainLeads = newLeadsData.some(lead => lead.id === newLeadId);
                      if (inContactsLeads || inMainLeads) {
                        console.log(`✅ Contact ${contact.id} (${contact.name}) included: lead ${newLeadId} found in ${inContactsLeads ? 'contacts leads' : 'main leads'}`);
                        return true;
                      }
                      console.log(`❌ Contact ${contact.id} (${contact.name}) excluded: lead ${newLeadId} not in filtered results`);
                      return false;
                    } else if (finalLegacyLeadId) {
                      // Check if the legacy lead is in the filtered results
                      return legacyLeadsForContacts.some(lead => lead.id === finalLegacyLeadId);
                    }
                    return false;
                  }

                  // If "All Contacts" is enabled, include ALL contacts with messages
                  // They don't need to have a relationship - if they have messages, show them
                  return true;
                })
                .map((contact: any) => {
                  const newLeadId = contactToNewLeadMap.get(contact.id);
                  const legacyLeadId = contactToLegacyLeadMap.get(contact.id);
                  // Get legacy_id directly from whatsapp_messages if available (more accurate)
                  const legacyIdFromMessages = contactToLegacyIdMap.get(contact.id);
                  const finalLegacyLeadId = legacyIdFromMessages || legacyLeadId;

                  // IMPORTANT: Check both newLeadsForContacts (from relationships) AND newLeadsData (main leads, including fallback finds like L212670)
                  const associatedNewLeadFromContacts = newLeadId ? newLeadsForContacts.find(lead => lead.id === newLeadId) : null;
                  const associatedNewLeadFromMain = newLeadId ? newLeadsData.find(lead => lead.id === newLeadId) : null;
                  const associatedNewLead = associatedNewLeadFromContacts || associatedNewLeadFromMain;

                  // Use finalLegacyLeadId (from messages first, then relationship) to find the associated lead
                  const associatedLegacyLead = finalLegacyLeadId ? legacyLeadsForContacts.find(lead => lead.id === finalLegacyLeadId) : null;
                  const associatedLead = associatedNewLead || associatedLegacyLead;

                  // Debug log for L212670 contacts
                  if (associatedNewLead && (associatedNewLead.lead_number === '212670' || String(associatedNewLead.lead_number) === '212670')) {
                    console.log(`✅ Found contact ${contact.id} (${contact.name}) for L212670:`, {
                      contactId: contact.id,
                      contactName: contact.name,
                      leadId: newLeadId,
                      leadNumber: associatedNewLead.lead_number,
                      foundIn: associatedNewLeadFromContacts ? 'contacts leads' : 'main leads (fallback)'
                    });
                  }
                  const isLegacy = !!associatedLegacyLead || !!finalLegacyLeadId;

                  // Get lead_number: use associatedLead's lead_number, or for legacy use the legacy_id itself
                  let leadNumber: string;
                  if (associatedLead?.lead_number) {
                    leadNumber = associatedLead.lead_number;
                  } else if (finalLegacyLeadId) {
                    // For legacy leads, the lead_number is the legacy_id itself
                    leadNumber = String(finalLegacyLeadId);
                  } else {
                    // Fallback: use contact id (shouldn't happen in normal cases)
                    leadNumber = `Contact ${contact.id}`;
                  }

                  // CRITICAL: Always use contact's name from leads_contact table, NEVER use lead's name
                  // The contact.name comes directly from the database query at line 934
                  const contactName = contact.name || '';

                  // Debug: Log to verify we're using contact name, not lead name
                  if (contactName) {
                    console.log(`✅ Contact client created: ID=${contact.id}, Name="${contactName}" (from leads_contact), NOT from lead "${associatedLead?.name || 'N/A'}"`);
                  }

                  return {
                    id: `contact_${contact.id}`,
                    lead_id: newLeadId || (finalLegacyLeadId ? String(finalLegacyLeadId) : null),
                    contact_id: contact.id,
                    lead_number: leadNumber,
                    name: contactName, // Always use contact's name from leads_contact table
                    email: contact.email || '',
                    phone: contact.phone || '',
                    mobile: contact.mobile || '',
                    topic: associatedLead?.topic || '',
                    status: associatedLead?.status || '',
                    stage: associatedLead?.stage || '',
                    closer: isLegacy ? (associatedLead?.closer_id ? getEmployeeDisplayName(associatedLead.closer_id) : '') : (associatedLead?.closer || ''),
                    scheduler: isLegacy ? (associatedLead?.meeting_scheduler_id ? getEmployeeDisplayName(associatedLead.meeting_scheduler_id) : '') : (associatedLead?.scheduler || ''),
                    handler: associatedLead?.handler || '',
                    manager: associatedLead?.manager || null,
                    helper: associatedLead?.helper || null,
                    expert: associatedLead?.expert || null,
                    case_handler_id: associatedLead?.case_handler_id || null,
                    next_followup: associatedLead?.next_followup || '',
                    probability: associatedLead?.probability ? Number(associatedLead.probability) : undefined,
                    balance: isLegacy ? (associatedLead?.total ? Number(associatedLead.total) : undefined) : (associatedLead?.balance || undefined),
                    potential_applicants: associatedLead?.potential_applicants || '',
                    lead_type: isLegacy ? 'legacy' as const : 'new' as const,
                    isContact: true,
                    whatsapp_profile_picture_url: contact.whatsapp_profile_picture_url || null
                  };
                });
            }
          }
        }

        // Combine all clients: leads and contacts
        // Note: Role filtering is already done at the database level for all leads and contacts
        let allClients = [...newLeadsData, ...legacyLeadsData, ...contactClientsData];

        // Filter out contacts that share the same lead_number and phone as a lead client
        // BUT: Keep contacts that have messages with contact_id - they should be shown separately
        // This prevents showing duplicate entries with the same messages, but allows contacts with their own messages
        // For "All Contacts" tab, be more lenient and keep contacts even if they match leads
        const filteredContactClients = contactClientsData.filter(contact => {
          // Check if this contact has messages with contact_id in whatsapp_messages
          const contactHasMessages = (whatsappMessages || []).some((msg: any) =>
            msg.contact_id === contact.contact_id
          );

          // If contact has messages with contact_id, always show it (don't filter out)
          if (contactHasMessages) {
            return true;
          }

          // For "All Contacts" tab, keep all contacts (they have messages, so show them)
          if (!showMyContactsOnly) {
            return true;
          }

          // Normalize contact phone numbers
          const contactPhone = (contact.phone || contact.mobile || '').trim();
          const contactPhoneNormalized = contactPhone.replace(/\D/g, '');

          // Check if this contact matches any lead client by lead_number and phone
          const hasMatchingLead = [...newLeadsData, ...legacyLeadsData].some(lead => {
            // Match by lead_number (normalize both to strings for comparison)
            const leadNumberMatch = String(lead.lead_number || '').trim() === String(contact.lead_number || '').trim();

            // Match by phone (check both phone and mobile fields)
            const leadPhone = (lead.phone || lead.mobile || '').trim();
            const leadPhoneNormalized = leadPhone.replace(/\D/g, '');

            // Phone match: exact match or normalized match (if both have phone numbers)
            const phoneMatch = contactPhoneNormalized && leadPhoneNormalized
              ? contactPhoneNormalized === leadPhoneNormalized
              : (contactPhone && leadPhone && contactPhone === leadPhone);

            // Also check by name as additional safeguard (if lead_number matches but phone doesn't, still might be duplicate)
            const nameMatch = contact.name && lead.name &&
              contact.name.trim().toLowerCase() === lead.name.trim().toLowerCase();

            // Filter out if:
            // 1. lead_number matches AND (phone matches OR name matches), OR
            // 2. lead_number matches AND both phones are empty (likely same entity)
            if (leadNumberMatch) {
              if (phoneMatch || nameMatch) {
                return true; // Definitely a duplicate
              }
              // If lead_number matches but no phone/name match, still filter out to avoid duplicates
              // (this handles cases where contact might have different phone but same lead)
              return true;
            }

            return false;
          });

          // Keep contact only if no matching lead found
          return !hasMatchingLead;
        });

        // Rebuild allClients with filtered contacts
        allClients = [...newLeadsData, ...legacyLeadsData, ...filteredContactClients];

        // Save to the appropriate tab's state
        if (showMyContactsOnly) {
          setMyContactsClients(allClients);
        } else {
          setAllContactsClients(allClients);
        }
      } catch (error) {
        console.error('Error fetching clients with conversations:', error);
        toast.error('Failed to load clients');
      } finally {
        setLoading(false);
      }
    };

    fetchClientsWithConversations();
  }, [showMyContactsOnly, currentUserEmployeeId, currentUserFullName, myContactsClients.length, allContactsClients.length, allMessages.length]);

  // Function to fetch only new messages (polling for updates)
  const fetchNewMessagesOnly = useCallback(async () => {
    if (!allMessages.length) return; // No existing messages to compare against

    try {
      // Get the most recent message timestamp from cached messages
      const mostRecentTimestamp = allMessages.reduce((latest, msg) => {
        const msgTime = new Date(msg.sent_at).getTime();
        return msgTime > latest ? msgTime : latest;
      }, 0);

      // Fetch only messages newer than the most recent cached message
      const { data: newMessages, error } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .gt('sent_at', new Date(mostRecentTimestamp).toISOString())
        .order('sent_at', { ascending: true });

      if (error) {
        console.error('Error fetching new messages:', error);
        return;
      }

      if (newMessages && newMessages.length > 0) {
        console.log(`🆕 Found ${newMessages.length} new messages`);

        // Update allMessages with new messages
        setAllMessages(prev => [...prev, ...newMessages]);

        // If a client is selected and the new messages are for that client, update messages
        const currentSelectedClient = showMyContactsOnly ? myContactsSelectedClient : allContactsSelectedClient;
        if (currentSelectedClient) {
          const clientNewMessages = newMessages.filter(msg => {
            if (currentSelectedClient.lead_type === 'legacy' || currentSelectedClient.id?.toString().startsWith('legacy_')) {
              return msg.legacy_id === Number(currentSelectedClient.id);
            } else if (currentSelectedClient.contact_id) {
              return msg.contact_id === currentSelectedClient.contact_id;
            } else {
              return msg.lead_id === currentSelectedClient.id;
            }
          });

          if (clientNewMessages.length > 0) {
            if (showMyContactsOnly) {
              setMyContactsMessages(prev => [...prev, ...clientNewMessages]);
            } else {
              setAllContactsMessages(prev => [...prev, ...clientNewMessages]);
            }
            // Show notification for new messages
            toast.success(`${clientNewMessages.length} new message${clientNewMessages.length > 1 ? 's' : ''} received`);
          }
        }

        // Refresh clients list to update unread counts for both tabs
        // This is a lightweight operation that just updates the UI
        if (showMyContactsOnly) {
          setMyContactsClients(prev => {
            return prev.map(client => {
              const clientNewMessages = newMessages.filter(msg => {
                if (client.lead_type === 'legacy' || client.id?.toString().startsWith('legacy_')) {
                  return msg.legacy_id === Number(client.id);
                } else if (client.contact_id) {
                  return msg.contact_id === client.contact_id;
                } else {
                  return msg.lead_id === client.id;
                }
              });

              if (clientNewMessages.length > 0) {
                // Update unread count (messages that are incoming and not read)
                const unreadNew = clientNewMessages.filter(msg =>
                  msg.direction === 'in' && !msg.is_read
                ).length;

                return {
                  ...client,
                  unreadCount: (client.unreadCount || 0) + unreadNew
                };
              }

              return client;
            });
          });
        } else {
          setAllContactsClients(prev => {
            return prev.map(client => {
              const clientNewMessages = newMessages.filter(msg => {
                if (client.lead_type === 'legacy' || client.id?.toString().startsWith('legacy_')) {
                  return msg.legacy_id === Number(client.id);
                } else if (client.contact_id) {
                  return msg.contact_id === client.contact_id;
                } else {
                  return msg.lead_id === client.id;
                }
              });

              if (clientNewMessages.length > 0) {
                // Update unread count (messages that are incoming and not read)
                const unreadNew = clientNewMessages.filter(msg =>
                  msg.direction === 'in' && !msg.is_read
                ).length;

                return {
                  ...client,
                  unreadCount: (client.unreadCount || 0) + unreadNew
                };
              }

              return client;
            });
          });
        }
      }
    } catch (error) {
      console.error('Error in fetchNewMessagesOnly:', error);
    }
  }, [allMessages, showMyContactsOnly, myContactsSelectedClient, allContactsSelectedClient, setAllMessages, setMyContactsMessages, setAllContactsMessages, setMyContactsClients, setAllContactsClients]);

  // Poll for new messages every 10 seconds if we have cached data
  useEffect(() => {
    const currentClients = showMyContactsOnly ? myContactsClients : allContactsClients;
    const hasInitialData = hasInitialDataRef.current || getHasInitialData();
    if (!hasInitialData || currentClients.length === 0 || allMessages.length === 0) return;

    const intervalId = setInterval(() => {
      fetchNewMessagesOnly();
    }, 10000); // Poll every 10 seconds

    return () => clearInterval(intervalId);
  }, [fetchNewMessagesOnly, showMyContactsOnly, myContactsClients.length, allContactsClients.length, allMessages.length]);

  // Save state when modal closes (via onClose callback)
  useEffect(() => {
    // State is automatically saved by usePersistedState hooks
    // This effect ensures state is saved when component unmounts or modal closes
    return () => {
      // State will be persisted automatically by usePersistedState
      console.log('💾 WhatsApp state saved to sessionStorage for both tabs');
    };
  }, [myContactsClients, allContactsClients, myContactsSelectedClient, allContactsSelectedClient, myContactsMessages, allContactsMessages, allMessages, showMyContactsOnly]);

  // Handle tab switch - restore state for the newly selected tab
  useEffect(() => {
    // When switching tabs, restore the selected client and messages for that tab
    const currentSelectedClient = showMyContactsOnly ? myContactsSelectedClient : allContactsSelectedClient;
    const currentMessages = showMyContactsOnly ? myContactsMessages : allContactsMessages;

    if (currentSelectedClient && allMessages.length > 0) {
      const clientMessages = allMessages.filter(msg => {
        if (currentSelectedClient.lead_type === 'legacy' || currentSelectedClient.id?.toString().startsWith('legacy_')) {
          return msg.legacy_id === Number(currentSelectedClient.id);
        } else if (currentSelectedClient.contact_id) {
          return msg.contact_id === currentSelectedClient.contact_id;
        } else {
          return msg.lead_id === currentSelectedClient.id;
        }
      }).sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());

      if (showMyContactsOnly) {
        setMyContactsMessages(clientMessages);
      } else {
        setAllContactsMessages(clientMessages);
      }
    }
  }, [showMyContactsOnly]); // Only run when tab changes

  // If propSelectedContact is provided, use it directly
  useEffect(() => {
    if (propSelectedContact) {
      setSelectedContactId(propSelectedContact.contact.id);
      // Ensure no duplicates - use array with single contact
      setLeadContacts([propSelectedContact.contact]);
      // Create a Client object from the contact
      // CRITICAL: Always use contact's name from propSelectedContact.contact.name (from leads_contact table)
      const contactName = propSelectedContact.contact.name || '';
      console.log(`✅ Creating client from propSelectedContact: Contact ID=${propSelectedContact.contact.id}, Name="${contactName}" (from leads_contact)`);

      const clientObj: Client = {
        id: `contact_${propSelectedContact.contact.id}`, // Use contact_ prefix for contacts
        lead_id: String(propSelectedContact.leadId), // Store the lead_id
        contact_id: propSelectedContact.contact.id, // Store the contact_id
        lead_number: String(propSelectedContact.leadId),
        name: contactName, // Always use contact's name from leads_contact table
        phone: propSelectedContact.contact.phone || propSelectedContact.contact.mobile || '',
        mobile: propSelectedContact.contact.mobile || propSelectedContact.contact.phone || '',
        email: propSelectedContact.contact.email || '',
        lead_type: propSelectedContact.leadType,
        isContact: true, // Mark as contact
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

      // Check if this is a contact client (not a main lead)
      const isContactClient = selectedClient.isContact;

      // For contacts, use the associated lead_id; for main leads, use the client id
      let actualLeadId: string | number;
      let isLegacyLead: boolean;

      if (isContactClient && selectedClient.lead_id) {
        // This is a contact - use the associated lead_id
        actualLeadId = selectedClient.lead_id;
        // Determine if the associated lead is legacy based on lead_type
        isLegacyLead = selectedClient.lead_type === 'legacy';
      } else {
        // This is a main lead
        isLegacyLead = selectedClient.lead_type === 'legacy' || selectedClient.id.toString().startsWith('legacy_');
        actualLeadId = isLegacyLead
          ? (typeof selectedClient.id === 'string' ? selectedClient.id.replace('legacy_', '') : String(selectedClient.id))
          : selectedClient.id;
      }

      const contacts = await fetchLeadContacts(actualLeadId, isLegacyLead);

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
              lead_id: selectedClient.id, // Keep the legacy_ prefix for consistency
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

          // Ensure messages are sorted by sent_at in ascending order (oldest first, newest last)
          const sortedProcessedMessages = [...processedMessages].sort((a, b) =>
            new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
          );

          if (!isPolling) {
            setMessages(sortedProcessedMessages);
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
        // If this is a contact (not a main lead), fetch messages by contact_id ONLY
        let allMessagesForLead: any[] = [];

        if (selectedClient.isContact && selectedClient.contact_id) {
          // This is a contact - fetch messages by contact_id AND by phone number
          // Messages might be saved with phone_number but contact_id might be null or incorrect
          // So we need to match by both contact_id and phone/mobile number
          // CRITICAL: Use contact's phone/mobile, NOT the lead's phone/mobile
          // The contact client should already have the contact's phone/mobile from when it was created
          const contactPhone = selectedClient.phone || selectedClient.mobile || '';
          const contactMobile = selectedClient.mobile || selectedClient.phone || '';

          console.log('📞 Fetching messages for contact:', {
            contactId: selectedClient.contact_id,
            contactName: selectedClient.name,
            contactPhone: contactPhone,
            contactMobile: contactMobile,
            isContact: selectedClient.isContact,
            leadId: selectedClient.lead_id
          });

          if (!contactPhone && !contactMobile) {
            console.error('❌ Contact has no phone number!', selectedClient);
            toast.error(`Contact ${selectedClient.name} has no phone number. Cannot load WhatsApp conversation.`);
            setMessages([]);
            setLoadingMessages(false);
            return;
          }

          // Normalize phone numbers for matching (remove spaces, dashes, etc.)
          const normalizePhone = (phone: string) => phone ? phone.replace(/\D/g, '') : '';
          const normalizedContactPhone = normalizePhone(contactPhone);
          const normalizedContactMobile = normalizePhone(contactMobile);

          // Create phone variations for matching (similar to backend logic)
          // CRITICAL: Generate ALL possible variations to match messages saved in different formats
          const phoneVariations: string[] = [];

          // Helper to generate all variations for a phone number
          const generatePhoneVariations = (phone: string, normalized: string) => {
            const variations: string[] = [];
            if (!phone || !normalized) return variations;

            // Original format
            variations.push(phone);
            variations.push(normalized);

            // With/without country code (972 for Israel)
            if (normalized.startsWith('972')) {
              variations.push(normalized.replace(/^972/, ''));
              variations.push(`0${normalized.replace(/^972/, '')}`); // Add leading 0
            } else {
              variations.push(`972${normalized}`);
              variations.push(`+972${normalized}`);
              // If it starts with 0, also try without 0
              if (normalized.startsWith('0')) {
                variations.push(normalized.replace(/^0/, ''));
                variations.push(`972${normalized.replace(/^0/, '')}`);
              }
            }

            // With/without plus
            variations.push(`+${normalized}`);
            variations.push(normalized.replace(/^\+/, ''));

            // Last 4, 8, 9, 10 digits (for partial matching in database queries)
            if (normalized.length >= 4) {
              variations.push(normalized.slice(-4));
            }
            if (normalized.length >= 8) {
              variations.push(normalized.slice(-8));
            }
            if (normalized.length >= 9) {
              variations.push(normalized.slice(-9));
            }
            if (normalized.length >= 10) {
              variations.push(normalized.slice(-10));
            }

            return variations;
          };

          // Generate variations for phone
          if (contactPhone) {
            phoneVariations.push(...generatePhoneVariations(contactPhone, normalizedContactPhone));
          }

          // Generate variations for mobile (if different from phone)
          if (contactMobile && contactMobile !== contactPhone) {
            phoneVariations.push(...generatePhoneVariations(contactMobile, normalizedContactMobile));
          }

          // Remove duplicates and empty strings
          const uniquePhoneVariations = Array.from(new Set(phoneVariations.filter(Boolean)));

          console.log(`📞 Generated ${uniquePhoneVariations.length} phone variations for contact ${selectedClient.contact_id}:`, {
            originalPhone: contactPhone,
            originalMobile: contactMobile,
            normalizedPhone: normalizedContactPhone,
            normalizedMobile: normalizedContactMobile,
            variations: uniquePhoneVariations.slice(0, 10) // Show first 10 for debugging
          });

          // Fetch messages by contact_id OR by phone_number matching
          // Also filter by lead_id to ensure we only get messages for this specific lead's contact
          // Use OR condition to get messages that match either criteria
          let contactMessagesQuery = supabase
            .from('whatsapp_messages')
            .select('*');

          // First, filter by lead_id to ensure we only get messages for this lead
          // For contacts, we MUST use lead_id (not client.id which is contact_${id})
          // For main leads, we can use client.id
          const leadIdForQuery = selectedClient.isContact
            ? selectedClient.lead_id  // For contacts, only use lead_id
            : (selectedClient.lead_id || selectedClient.id); // For main leads, use lead_id or id

          if (leadIdForQuery) {
            // Handle legacy leads (they have legacy_id in messages, not lead_id)
            const isLegacy = selectedClient.lead_type === 'legacy' ||
              (selectedClient.lead_id && selectedClient.lead_id.toString().startsWith('legacy_')) ||
              (typeof leadIdForQuery === 'string' && leadIdForQuery.startsWith('legacy_'));

            if (isLegacy) {
              const legacyId = typeof leadIdForQuery === 'string'
                ? Number(leadIdForQuery.replace('legacy_', ''))
                : Number(leadIdForQuery);
              if (!isNaN(legacyId)) {
                contactMessagesQuery = contactMessagesQuery.eq('legacy_id', legacyId);
              }
            } else {
              // For new leads, filter by lead_id
              contactMessagesQuery = contactMessagesQuery.eq('lead_id', leadIdForQuery);
            }
          }

          // Build OR conditions: contact_id match OR phone_number match
          const orConditions: string[] = [];

          // Add contact_id condition
          if (selectedClient.contact_id) {
            orConditions.push(`contact_id.eq.${selectedClient.contact_id}`);
          }

          // Add phone_number conditions for each variation
          // CRITICAL: For inbound messages, the phone_number in the message is the sender's phone (the contact's phone)
          // So we need to match by phone_number to get inbound messages from this contact
          // NOTE: Supabase OR queries have limitations, so we'll fetch all messages for the lead
          // and filter client-side for better phone number matching
          if (uniquePhoneVariations.length > 0) {
            // For Supabase queries, we can only use a limited number of OR conditions
            // So we'll add the most common variations and do additional filtering client-side
            const primaryVariations = uniquePhoneVariations.slice(0, 10); // Limit to first 10 for query
            primaryVariations.forEach(phone => {
              orConditions.push(`phone_number.eq.${phone}`);
            });
          }

          // If we have conditions, apply them with OR
          if (orConditions.length > 0) {
            contactMessagesQuery = contactMessagesQuery.or(orConditions.join(','));
          } else {
            // If no conditions, we still need to fetch messages by lead_id only
            // This will fetch all messages for the lead, and we'll filter client-side
          }

          console.log(`🔍 Contact messages query:`, {
            leadId: leadIdForQuery,
            contactId: selectedClient.contact_id,
            phoneVariations: uniquePhoneVariations.length,
            orConditions: orConditions.length
          });

          // CRITICAL: For better phone number matching, fetch ALL messages for the lead first
          // Then filter client-side using all phone variations
          // This ensures we don't miss messages due to phone number format differences
          let contactMessages: any[] = [];

          // First, try the OR query with contact_id and phone variations
          const { data: orQueryMessages, error: orQueryError } = await contactMessagesQuery
            .order('sent_at', { ascending: true });

          if (orQueryError) {
            console.warn('⚠️ OR query error (may be due to too many conditions), fetching all messages for lead:', orQueryError);
          } else {
            contactMessages = orQueryMessages || [];
          }

          // Also fetch ALL messages for this lead (without phone/contact filters) to catch any we might have missed
          // This is important for inbound messages that might have different phone formats
          let allLeadMessagesQuery = supabase
            .from('whatsapp_messages')
            .select('*');

          if (leadIdForQuery) {
            const isLegacy = selectedClient.lead_type === 'legacy' ||
              (selectedClient.lead_id && selectedClient.lead_id.toString().startsWith('legacy_')) ||
              (typeof leadIdForQuery === 'string' && leadIdForQuery.startsWith('legacy_'));

            if (isLegacy) {
              const legacyId = typeof leadIdForQuery === 'string'
                ? Number(leadIdForQuery.replace('legacy_', ''))
                : Number(leadIdForQuery);
              if (!isNaN(legacyId)) {
                allLeadMessagesQuery = allLeadMessagesQuery.eq('legacy_id', legacyId);
              }
            } else {
              allLeadMessagesQuery = allLeadMessagesQuery.eq('lead_id', leadIdForQuery);
            }
          }

          const { data: allLeadMessages, error: allLeadError } = await allLeadMessagesQuery
            .order('sent_at', { ascending: true });

          if (allLeadError) {
            console.error('Error fetching all lead messages:', allLeadError);
          } else {
            // Merge messages, avoiding duplicates
            const existingIds = new Set(contactMessages.map((m: any) => m.id));
            const additionalMessages = (allLeadMessages || []).filter((m: any) => !existingIds.has(m.id));
            contactMessages = [...contactMessages, ...additionalMessages];
            console.log(`📥 Fetched ${contactMessages.length} total messages (${orQueryMessages?.length || 0} from OR query, ${additionalMessages.length} additional from lead query)`);
          }

          // Additional filtering: ensure messages match the contact's phone number AND lead_id
          // This handles cases where phone_number format might differ slightly
          // CRITICAL: Also verify lead_id matches to prevent messages from wrong leads
          // For contacts, MUST use lead_id (not client.id which is contact_${id})
          const isLegacy = selectedClient.lead_type === 'legacy' ||
            (selectedClient.lead_id && selectedClient.lead_id.toString().startsWith('legacy_'));
          const expectedLeadId = selectedClient.isContact
            ? selectedClient.lead_id  // For contacts, only use lead_id
            : (selectedClient.lead_id || selectedClient.id); // For main leads, use lead_id or id
          const expectedLegacyId = isLegacy && expectedLeadId ? (typeof expectedLeadId === 'string'
            ? Number(expectedLeadId.replace('legacy_', ''))
            : Number(expectedLeadId)) : null;

          allMessagesForLead = (contactMessages || []).filter((msg: any) => {
            // CRITICAL: First check lead_id/legacy_id match
            if (isLegacy) {
              // For legacy leads, check legacy_id
              if (expectedLegacyId !== null && msg.legacy_id !== expectedLegacyId) {
                return false;
              }
            } else {
              // For new leads, check lead_id
              if (expectedLeadId && msg.lead_id !== expectedLeadId) {
                return false;
              }
            }

            // CRITICAL FIX: Prioritize phone number matching over contact_id
            // If phone number matches, include the message even if contact_id doesn't match
            // This handles cases where messages were incorrectly assigned to the wrong contact_id
            let phoneMatches = false;
            if (msg.phone_number) {
              const normalizedMsgPhone = normalizePhone(msg.phone_number);

              // Try multiple matching strategies:
              // 1. Exact match
              // 2. Last 8 digits match (handles country code differences)
              // 3. Last 4 digits match (handles more format variations)
              const matchesPhone = normalizedContactPhone && normalizedMsgPhone &&
                (normalizedMsgPhone === normalizedContactPhone ||
                  (normalizedContactPhone.length >= 8 && normalizedMsgPhone.length >= 8 &&
                    normalizedMsgPhone.endsWith(normalizedContactPhone.slice(-8))) ||
                  (normalizedContactPhone.length >= 4 && normalizedMsgPhone.length >= 4 &&
                    normalizedMsgPhone.endsWith(normalizedContactPhone.slice(-4))) ||
                  (normalizedContactPhone.length >= 8 && normalizedMsgPhone.length >= 8 &&
                    normalizedContactPhone.endsWith(normalizedMsgPhone.slice(-8))) ||
                  (normalizedContactPhone.length >= 4 && normalizedMsgPhone.length >= 4 &&
                    normalizedContactPhone.endsWith(normalizedMsgPhone.slice(-4))));

              const matchesMobile = normalizedContactMobile && normalizedMsgPhone &&
                (normalizedMsgPhone === normalizedContactMobile ||
                  (normalizedContactMobile.length >= 8 && normalizedMsgPhone.length >= 8 &&
                    normalizedMsgPhone.endsWith(normalizedContactMobile.slice(-8))) ||
                  (normalizedContactMobile.length >= 4 && normalizedMsgPhone.length >= 4 &&
                    normalizedMsgPhone.endsWith(normalizedContactMobile.slice(-4))) ||
                  (normalizedContactMobile.length >= 8 && normalizedMsgPhone.length >= 8 &&
                    normalizedContactMobile.endsWith(normalizedMsgPhone.slice(-8))) ||
                  (normalizedContactMobile.length >= 4 && normalizedMsgPhone.length >= 4 &&
                    normalizedContactMobile.endsWith(normalizedMsgPhone.slice(-4))));

              phoneMatches = !!(matchesPhone || matchesMobile);

              if (phoneMatches) {
                console.log(`✅ Phone match found: msg="${normalizedMsgPhone}", contact="${normalizedContactPhone || normalizedContactMobile}"`);
              }
            }

            // If phone number matches, include the message (even if contact_id doesn't match)
            if (phoneMatches) {
              return true;
            }

            // If phone number doesn't match, check if contact_id matches
            // This handles messages that might not have a phone_number but have the correct contact_id
            if (msg.contact_id && msg.contact_id === selectedClient.contact_id) {
              console.log(`✅ Message ${msg.id} matched by contact_id (phone didn't match)`);
              return true;
            }

            // If neither phone nor contact_id matches, exclude the message
            console.log(`❌ Message ${msg.id} filtered out for contact ${selectedClient.contact_id}:`, {
              msgContactId: msg.contact_id,
              msgPhoneNumber: msg.phone_number,
              contactPhone: contactPhone,
              contactMobile: contactMobile,
              phoneMatches: phoneMatches
            });
            return false;
          });

          console.log(`📱 Fetched ${allMessagesForLead.length} messages for contact ${selectedClient.contact_id} (phone: ${contactPhone || contactMobile}, lead_id: ${expectedLeadId}, isLegacy: ${isLegacy})`);

          // Debug: Log message details to verify matching
          if (!isPolling && allMessagesForLead.length > 0) {
            console.log('📋 Sample messages for contact:', allMessagesForLead.slice(0, 3).map((m: any) => ({
              id: m.id,
              contact_id: m.contact_id,
              lead_id: m.lead_id,
              legacy_id: m.legacy_id,
              phone_number: m.phone_number,
              direction: m.direction,
              sender_name: m.sender_name,
              message: m.message?.substring(0, 50)
            })));

            // Count inbound vs outbound messages
            const inboundCount = allMessagesForLead.filter((m: any) => m.direction === 'in').length;
            const outboundCount = allMessagesForLead.filter((m: any) => m.direction === 'out').length;
            console.log(`📊 Message direction breakdown: ${inboundCount} inbound, ${outboundCount} outbound`);
          }

          // Also log ALL messages fetched from database (before filtering)
          if (!isPolling && contactMessages && contactMessages.length > 0) {
            const allInbound = contactMessages.filter((m: any) => m.direction === 'in').length;
            const allOutbound = contactMessages.filter((m: any) => m.direction === 'out').length;
            console.log(`📊 All messages from DB (before filtering): ${contactMessages.length} total (${allInbound} inbound, ${allOutbound} outbound)`);

            // Log inbound messages that might have been filtered out
            const filteredOutInbound = contactMessages.filter((m: any) => {
              if (m.direction !== 'in') return false;
              return !allMessagesForLead.some((filtered: any) => filtered.id === m.id);
            });
            if (filteredOutInbound.length > 0) {
              console.warn(`⚠️ ${filteredOutInbound.length} inbound messages were filtered out:`, filteredOutInbound.map((m: any) => ({
                id: m.id,
                contact_id: m.contact_id,
                phone_number: m.phone_number,
                lead_id: m.lead_id
              })));
            }
          }
        } else {
          // This is a main lead - fetch by lead_id
          // For main leads, we need to fetch ALL messages (both with and without contact_id)
          // because when a contact is selected, we need to filter by phone number matching
          // The filtering will happen later based on whether a contact is selected
          const { data: leadMessages, error: leadError } = await supabase
            .from('whatsapp_messages')
            .select('*')
            .eq('lead_id', selectedClient.id)
            // Don't filter by contact_id here - we'll filter later based on contact selection
            .order('sent_at', { ascending: true });

          if (leadError) {
            console.error('Error fetching messages:', leadError);
            toast.error('Failed to load messages');
            setLoadingMessages(false);
            return;
          }

          allMessagesForLead = leadMessages || [];
        }

        // Filter messages based on phone number (only for main leads with selected contact)
        // For contact clients, we already have the correct messages (filtered by contact_id)
        let filteredMessages = allMessagesForLead || [];

        // Only apply phone-based filtering for main leads (not contact clients)
        if (!selectedClient.isContact && contactId) {
          // Get the selected contact details
          const selectedContact = propSelectedContact?.contact || leadContacts.find(c => c.id === contactId);

          if (selectedContact) {
            const contactPhone = selectedContact.phone || selectedContact.mobile;
            const leadPhone = selectedClient.phone || selectedClient.mobile;
            let last4Digits = '';

            if (contactPhone) {
              // Extract last 4 digits for phone matching
              const phoneDigits = contactPhone.replace(/\D/g, '');
              last4Digits = phoneDigits.slice(-4);
            }

            // Find ALL contact_ids that share the same phone number
            const relatedContactIds = new Set<number>();
            if (last4Digits.length >= 4) {
              // Add the selected contact_id
              relatedContactIds.add(contactId);

              // Find all other contacts with the same phone number
              leadContacts.forEach(contact => {
                const cPhone = contact.phone || contact.mobile;
                if (cPhone) {
                  const cPhoneDigits = cPhone.replace(/\D/g, '');
                  const cLast4 = cPhoneDigits.slice(-4);
                  if (cLast4 === last4Digits) {
                    relatedContactIds.add(contact.id);
                  }
                }
              });
            }

            console.log(`🔍 Message filtering debug:`, {
              selectedContactId: contactId,
              relatedContactIds: Array.from(relatedContactIds),
              last4Digits,
              totalMessages: allMessagesForLead?.length || 0,
              leadContactsCount: leadContacts.length,
              contactPhone: contactPhone,
              messages: (allMessagesForLead || []).map((m: any) => ({
                id: m.id,
                contact_id: m.contact_id,
                phone_number: m.phone_number,
                direction: m.direction
              }))
            });

            // SIMPLE RULE: If there's only ONE contact, show ALL messages (no filtering)
            // This handles cases where not all contacts are loaded yet
            if (leadContacts.length === 1) {
              console.log(`✅ Only one contact - showing all ${allMessagesForLead?.length || 0} messages`);
              filteredMessages = allMessagesForLead || [];
            } else {
              // Filter messages: Include messages from ANY contact with the same phone number
              filteredMessages = (allMessagesForLead || []).filter(msg => {
                // Match by any related contact_id (all contacts with same phone)
                if (msg.contact_id && relatedContactIds.has(msg.contact_id)) {
                  console.log(`✅ Message ${msg.id} matched (contact_id=${msg.contact_id} shares phone)`);
                  return true;
                }

                // If message has contact_id but it's not in relatedContactIds, check if phone matches
                // This handles cases where contact_id might be wrong but phone number is correct
                // Use more flexible phone matching (last 4, last 8, or full match)
                if (msg.contact_id && !relatedContactIds.has(msg.contact_id) && msg.phone_number && contactPhone) {
                  const msgPhoneDigits = msg.phone_number.replace(/\D/g, '');
                  const contactPhoneDigits = contactPhone.replace(/\D/g, '');

                  // Try multiple matching strategies
                  const matches =
                    msgPhoneDigits === contactPhoneDigits ||
                    (contactPhoneDigits.length >= 8 && msgPhoneDigits.length >= 8 &&
                      msgPhoneDigits.endsWith(contactPhoneDigits.slice(-8))) ||
                    (contactPhoneDigits.length >= 4 && msgPhoneDigits.length >= 4 &&
                      msgPhoneDigits.endsWith(contactPhoneDigits.slice(-4))) ||
                    (contactPhoneDigits.length >= 8 && msgPhoneDigits.length >= 8 &&
                      contactPhoneDigits.endsWith(msgPhoneDigits.slice(-8))) ||
                    (contactPhoneDigits.length >= 4 && msgPhoneDigits.length >= 4 &&
                      contactPhoneDigits.endsWith(msgPhoneDigits.slice(-4)));

                  if (matches) {
                    console.log(`✅ Message ${msg.id} matched by phone number (contact_id=${msg.contact_id} doesn't match but phone does)`);
                    return true;
                  }
                }

                // If message has no contact_id, match by phone number (last 4, last 8, or full match)
                if (!msg.contact_id && msg.phone_number && contactPhone) {
                  const msgPhoneDigits = msg.phone_number.replace(/\D/g, '');
                  const contactPhoneDigits = contactPhone.replace(/\D/g, '');

                  // Try multiple matching strategies
                  const matches =
                    msgPhoneDigits === contactPhoneDigits ||
                    (contactPhoneDigits.length >= 8 && msgPhoneDigits.length >= 8 &&
                      msgPhoneDigits.endsWith(contactPhoneDigits.slice(-8))) ||
                    (contactPhoneDigits.length >= 4 && msgPhoneDigits.length >= 4 &&
                      msgPhoneDigits.endsWith(contactPhoneDigits.slice(-4))) ||
                    (contactPhoneDigits.length >= 8 && msgPhoneDigits.length >= 8 &&
                      contactPhoneDigits.endsWith(msgPhoneDigits.slice(-8))) ||
                    (contactPhoneDigits.length >= 4 && msgPhoneDigits.length >= 4 &&
                      contactPhoneDigits.endsWith(msgPhoneDigits.slice(-4)));

                  if (matches) {
                    console.log(`✅ Message ${msg.id} matched by phone number (contact_id=null)`);
                    return true;
                  }
                }

                // If no contact_id and no phone_number, check if contact also has no phone
                // If contact has phone but message doesn't, exclude it
                if (!msg.contact_id && !msg.phone_number) {
                  if (!contactPhone) {
                    console.log(`✅ Message ${msg.id} matched (no contact_id, no phone_number, contact has no phone)`);
                    return true;
                  } else {
                    console.log(`❌ Message ${msg.id} filtered out (no contact_id, no phone_number, but contact has phone)`);
                    return false;
                  }
                }

                console.log(`❌ Message ${msg.id} filtered out (contact_id=${msg.contact_id}, phone_number=${msg.phone_number || 'null'}, last4Digits=${last4Digits})`);
                return false;
              });
            }
          } else {
            // If contact not found, show all messages for the lead (fallback)
            filteredMessages = allMessagesForLead || [];
          }
        } else {
          // If no contact is selected for a main lead, show only messages without contact_id
          // (messages that belong directly to the main lead, not to any contact)
          filteredMessages = (allMessagesForLead || []).filter(msg => !msg.contact_id);
        }

        // For contact clients, we already have the filtered messages in allMessagesForLead
        // Make sure filteredMessages is set correctly for contacts
        if (selectedClient.isContact) {
          filteredMessages = allMessagesForLead || [];
          console.log(`✅ Contact client: Using ${filteredMessages.length} messages from allMessagesForLead`);
        }

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
        // Process messages: if viewing a contact, update sender_name to use contact's name
        const processedMessages = (data || []).map((msg: any) => {
          const processed = processTemplateMessage(msg);

          // If we're viewing a contact and the message is from the client (direction 'in'),
          // update sender_name to use the contact's name instead of the lead's name
          if (selectedClient.isContact && selectedClient.contact_id && processed.direction === 'in') {
            // Use the contact's name from selectedClient
            if (selectedClient.name && selectedClient.name !== processed.sender_name) {
              console.log(`🔄 Updating sender_name for contact message: "${processed.sender_name}" -> "${selectedClient.name}"`);
              processed.sender_name = selectedClient.name;
            }
          }

          return processed;
        });

        // Always update messages immediately on initial load
        // For polling, only update if there are actual changes
        // Ensure messages are sorted by sent_at in ascending order (oldest first, newest last)
        const sortedMessages = [...processedMessages].sort((a, b) =>
          new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
        );

        if (!isPolling) {
          // Immediate update for initial load
          setMessages(sortedMessages);
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
              const merged = processedMessages.map(newMsg => {
                const prevMsg = prevMessages.find(p => p.id === newMsg.id || p.whatsapp_message_id === newMsg.whatsapp_message_id);
                if (prevMsg && prevMsg.template_id && !newMsg.template_id) {
                  return { ...newMsg, template_id: prevMsg.template_id };
                }
                return newMsg;
              });
              // Sort by sent_at in ascending order (oldest first, newest last)
              return merged.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
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
              const merged = processedMessages.map(newMsg => {
                const prevMsg = prevMessages.find(p => p.id === newMsg.id || p.whatsapp_message_id === newMsg.whatsapp_message_id);
                if (prevMsg && prevMsg.template_id && !newMsg.template_id) {
                  // Re-process with the preserved template_id
                  return processTemplateMessage({ ...newMsg, template_id: prevMsg.template_id });
                }
                return newMsg;
              });
              // Sort by sent_at in ascending order (oldest first, newest last)
              return merged.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
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
    // Only re-fetch when these specific values change, not when leadContacts array reference changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient?.id, selectedClient?.isContact, selectedClient?.contact_id, selectedContactId, propSelectedContact?.contact?.id]);

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

  // Calculate time left for 24-hour window
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
  const [selectedLanguage, setSelectedLanguage] = useState<string>('');
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);

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

  // AI suggestions state
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [showAISuggestions, setShowAISuggestions] = useState(false);

  // Mobile input focus state
  const [isInputFocused, setIsInputFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Mobile dropdown state
  const [showMobileDropdown, setShowMobileDropdown] = useState(false);

  // Desktop tools dropdown state
  const [showDesktopTools, setShowDesktopTools] = useState(false);
  const desktopToolsRef = useRef<HTMLDivElement>(null);
  const mobileToolsRef = useRef<HTMLDivElement>(null);
  const templateSelectorRef = useRef<HTMLDivElement>(null);

  const filteredTemplates = filterTemplates(templates, templateSearchTerm);

  const handleTemplateSelect = (template: WhatsAppTemplate) => {
    if (template.active !== 't') {
      toast.error('Template pending approval');
      return;
    }

    setSelectedTemplate(template);
    setShowTemplateSelector(false);
    setShowMobileDropdown(false);
    setTemplateSearchTerm('');

    if (template.params === '0') {
      setNewMessage(template.content || '');

      // Expand textarea for both mobile and desktop when template is inserted
      if (textareaRef.current) {
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            // Use larger max height when template is present (400px for desktop, 300px for mobile)
            const maxHeight = isMobile ? 300 : 400;
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`;
          }
        }, 0);
      }
    } else {
      setNewMessage('');
    }
  };

  useEffect(() => {
    if (shouldAutoScroll && messages.length > 0) {
      // Add a small delay to ensure messages are rendered
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        setShouldAutoScroll(false);
      }, 100);
    }
  }, [messages, shouldAutoScroll]);

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

  // Handle click outside to close emoji picker, dropdowns, and reset input focus
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Don't close if clicking inside template selector
      if (templateSelectorRef.current && templateSelectorRef.current.contains(target)) {
        return;
      }

      if (isEmojiPickerOpen) {
        if (!target.closest('.emoji-picker-container') && !target.closest('button[type="button"]')) {
          setIsEmojiPickerOpen(false);
        }
      }

      if (showMobileDropdown) {
        if (mobileToolsRef.current && !mobileToolsRef.current.contains(target)) {
          setShowMobileDropdown(false);
        }
      }

      if (showDesktopTools) {
        if (desktopToolsRef.current && !desktopToolsRef.current.contains(target)) {
          setShowDesktopTools(false);
        }
      }

      // Close template selector if clicking outside
      if (showTemplateSelector && templateSelectorRef.current && !templateSelectorRef.current.contains(target)) {
        // Don't close if clicking on the template button itself
        if (!target.closest('button') || !target.closest('button')?.textContent?.includes('Template')) {
          setShowTemplateSelector(false);
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
  }, [isEmojiPickerOpen, showMobileDropdown, showDesktopTools, isMobile, isInputFocused, showTemplateSelector]);

  // Handle search input changes - now only filters fetched clients (no API calls)
  // Removed the searchLeads API call - search now only filters through existing clients

  // Client-side filtering function for incremental search
  const filterResultsClientSide = (results: CombinedLead[], query: string): CombinedLead[] => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return results;

    const searchVariants = generateSearchVariants(trimmed);
    const digits = trimmed.replace(/\D/g, '');

    return results.filter((lead) => {
      const name = (lead.contactName || lead.name || '').toLowerCase();
      const email = (lead.email || '').toLowerCase();
      const phone = (lead.phone || '').replace(/\D/g, '');
      const mobile = (lead.mobile || '').replace(/\D/g, '');
      const leadNumber = (lead.lead_number || '').toLowerCase();

      // Check if any search variant matches
      return searchVariants.some(variant => {
        const variantLower = variant.toLowerCase();
        return (
          name.includes(variantLower) ||
          email.includes(variantLower) ||
          leadNumber.includes(variantLower) ||
          (digits.length >= 3 && (phone.includes(digits) || mobile.includes(digits)))
        );
      });
    });
  };

  // Handle search in New Message Modal
  useEffect(() => {
    if (newMessageSearchTimeoutRef.current) {
      clearTimeout(newMessageSearchTimeoutRef.current);
    }

    const trimmedQuery = newMessageSearchTerm.trim();
    const previousQuery = previousSearchQueryRef.current.trim();

    if (!trimmedQuery) {
      setNewMessageSearchResults([]);
      setIsNewMessageSearching(false);
      masterSearchResultsRef.current = [];
      previousSearchQueryRef.current = '';
      previousRawSearchValueRef.current = '';
      return;
    }

    // Check if this is an extension of the previous query (user is continuing to type)
    // An extension means: the new query is longer AND starts with the previous query
    // BUT: Don't use incremental filtering for:
    // - Numeric queries (lead numbers) - need precise database searches
    // - Phone numbers - need precise database searches
    // - Very short queries (< 3 chars) - might not have enough results to filter
    const isNumeric = /^\d+$/.test(trimmedQuery);
    const digits = trimmedQuery.replace(/\D/g, '');
    const isPhoneNumber = /^[\d\s\-\(\)\+]+$/.test(trimmedQuery) && digits.length >= 3;
    const startsWithZero = digits.startsWith('0') && digits.length >= 4;
    const isLeadNumber = isNumeric && digits.length <= 6 && !startsWithZero;
    const isVeryShortQuery = trimmedQuery.length < 3;

    const isQueryExtension = previousQuery &&
      trimmedQuery.length > previousQuery.length &&
      trimmedQuery.toLowerCase().startsWith(previousQuery.toLowerCase()) &&
      masterSearchResultsRef.current.length > 0 &&
      !isNumeric && // Don't use incremental filtering for pure numeric queries
      !isPhoneNumber && // Don't use incremental filtering for phone numbers
      !isLeadNumber && // Don't use incremental filtering for lead numbers
      !isVeryShortQuery && // Don't use incremental filtering for very short queries
      previousQuery.length >= 3; // Previous query must also be at least 3 chars

    if (isQueryExtension) {
      // Filter existing results client-side for faster response
      // This prevents unnecessary API calls when user is just continuing to type
      // Only works for text queries (names, emails) with sufficient length
      const filtered = filterResultsClientSide(masterSearchResultsRef.current, trimmedQuery);

      // If filtering results in empty results, perform a new search instead
      // This handles cases where the extended query doesn't match any existing results
      if (filtered.length === 0 && masterSearchResultsRef.current.length > 0) {
        // Don't return early - let it perform a new search
        // This ensures we don't show "no results" when there might be matches
      } else {
        setNewMessageSearchResults(filtered);
        setIsNewMessageSearching(false);
        previousSearchQueryRef.current = trimmedQuery;
        previousRawSearchValueRef.current = newMessageSearchTerm;
        return;
      }
    }

    // Otherwise, perform new search (query got shorter or changed significantly)
    setIsNewMessageSearching(true);

    newMessageSearchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchLeads(trimmedQuery);
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
        masterSearchResultsRef.current = results;
        setNewMessageSearchResults(results);
        previousSearchQueryRef.current = trimmedQuery;
        previousRawSearchValueRef.current = newMessageSearchTerm;
      } catch (error) {
        console.error('Error searching leads:', error);
        setNewMessageSearchResults([]);
        masterSearchResultsRef.current = [];
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
      // CRITICAL: Always use contact's name from selectedContact (from leads_contact table)
      // NEVER use result.name (which might be the lead's name) as a fallback
      const contactName = selectedContact.name || result.contactName || '';
      if (!contactName) {
        console.warn(`⚠️ Contact ${selectedContact.id} has no name! Using fallback.`);
      }
      console.log(`✅ Creating contact client: Contact ID=${selectedContact.id}, Name="${contactName}" (from leads_contact), NOT from lead "${result.name || 'N/A'}"`);

      const contactClient: Client = {
        id: `contact_${selectedContact.id}`,
        lead_id: leadId, // Store the associated lead_id
        contact_id: selectedContact.id, // Store the contact_id
        lead_number: leadData?.lead_number || result.lead_number || `Contact ${selectedContact.id}`,
        name: contactName, // Always use contact's name, never lead's name
        email: selectedContact.email || result.email || '',
        phone: selectedContact.phone || result.phone || '',
        mobile: selectedContact.mobile || result.mobile || '',
        topic: leadData?.topic || result.topic || '',
        status: leadData?.status || result.status || '',
        stage: leadData?.stage || result.stage || '',
        closer: isLegacyLead ? (leadData?.closer_id ? getEmployeeDisplayName(leadData.closer_id) : '') : (leadData?.closer || ''),
        scheduler: isLegacyLead ? (leadData?.meeting_scheduler_id ? getEmployeeDisplayName(leadData.meeting_scheduler_id) : '') : (leadData?.scheduler || ''),
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
    masterSearchResultsRef.current = [];
    previousSearchQueryRef.current = '';
    previousRawSearchValueRef.current = '';

    // Open chat on mobile
    if (isMobile) {
      setShowChat(true);
    }
  };

  // Filter clients based on search term (only filters through fetched clients)
  // This will be computed after getLastMessageForClient is defined (see below)

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

    // Get phone number and contact ID
    // CRITICAL: If selectedClient is a contact (isContact=true), use its contact_id and phone directly
    // Otherwise, check selectedContactId from leadContacts dropdown
    let phoneNumber: string | null = null;
    let contactId: number | null = null;

    if (selectedClient.isContact && selectedClient.contact_id) {
      // This is a contact client - use its contact_id and phone directly
      contactId = selectedClient.contact_id;
      phoneNumber = selectedClient.phone || selectedClient.mobile || null;
      console.log(`📞 Using contact client: contact_id=${contactId}, phone=${phoneNumber}, name=${selectedClient.name}`);
    } else if (selectedContactId && leadContacts.length > 0) {
      // This is a main lead with a selected contact from dropdown
      const selectedContact = leadContacts.find(c => c.id === selectedContactId);
      if (selectedContact) {
        phoneNumber = selectedContact.phone || selectedContact.mobile || null;
        contactId = selectedContact.id;
        console.log(`📞 Using selected contact from dropdown: contact_id=${contactId}, phone=${phoneNumber}, name=${selectedContact.name}`);
      }
    }

    // Fallback to client's phone number (for main leads without selected contact)
    if (!phoneNumber) {
      phoneNumber = selectedClient.phone || selectedClient.mobile || null;
      console.log(`📞 Using main lead phone: phone=${phoneNumber}, name=${selectedClient.name}`);
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
        contactId: contactId // Use the contactId we determined above (from contact client or selected contact)
      };

      console.log(`📤 Message payload: leadId=${leadIdForMessage}, contactId=${contactId}, phoneNumber=${phoneNumber}, isContact=${selectedClient.isContact}`);

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
        console.log(`🔍 Template "${selectedTemplate.name360}" requires ${paramCount} parameter(s)`);

        if (paramCount > 0) {
          // Try to get specific param definitions first, otherwise use generic
          let templateParams: Array<{ type: string; text: string }> = [];

          try {
            console.log('🔍 Getting template param definitions...');
            const paramDefinitions = await getTemplateParamDefinitions(selectedTemplate.id, selectedTemplate.name360);
            console.log('🔍 Param definitions:', paramDefinitions);

            if (paramDefinitions.length > 0) {
              console.log('✅ Using template-specific param definitions');
              templateParams = await generateParamsFromDefinitions(paramDefinitions, selectedClient, contactId || null);
            } else {
              console.log('⚠️ No specific param definitions, using generic generation');
              // Fallback to generic param generation
              templateParams = await generateTemplateParameters(paramCount, selectedClient, contactId || null);
            }

            console.log('✅ Generated template params:', templateParams);

            // Ensure we have valid parameters
            if (templateParams && templateParams.length > 0) {
              messagePayload.templateParameters = templateParams;

              // Generate the filled template content for display
              let filledContent = selectedTemplate.content || '';
              templateParams.forEach((param, index) => {
                if (param && param.text) {
                  // Replace placeholder with actual value, or keep placeholder if value is empty
                  const value = param.text.trim() || `{{${index + 1}}}`;
                  filledContent = filledContent.replace(new RegExp(`\\{\\{${index + 1}\\}\\}`, 'g'), value);
                }
              });

              messagePayload.message = filledContent || `TEMPLATE_MARKER:${selectedTemplate.title}`;
              console.log(`✅ Template with ${paramCount} param(s) - auto-filled parameters:`, messagePayload.templateParameters);
              console.log(`✅ Filled template content:`, filledContent);
            } else {
              console.error('❌ Failed to generate template parameters, templateParams is empty:', templateParams);
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
          // Template with no parameters - use the content directly
          messagePayload.message = selectedTemplate.content || `TEMPLATE_MARKER:${selectedTemplate.title}`;
          console.log('✅ Template with no parameters, using content directly:', messagePayload.message);
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

      // Add message to the end and ensure messages are sorted by sent_at
      setMessages(prev => {
        const updated = [...prev, newMsg];
        // Sort by sent_at in ascending order (oldest first, newest last)
        return updated.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
      });
      setShouldAutoScroll(true); // Trigger auto-scroll when new message is sent
      setNewMessage('');
      setSelectedTemplate(null); // Clear template selection after sending

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

                // Add message to the end and ensure messages are sorted by sent_at
                setMessages(prev => {
                  const updated = [...prev, newMsg];
                  // Sort by sent_at in ascending order (oldest first, newest last)
                  return updated.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
                });
                setShouldAutoScroll(true);
                setNewMessage('');
                setSelectedTemplate(null); // Clear template selection

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
      // Explicitly select is_read to ensure it's included
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('id, sent_at, sender_name, direction, message, whatsapp_status, whatsapp_message_id, error_message, contact_id, phone_number, template_id, lead_id, legacy_id, is_read')
        .order('sent_at', { ascending: false });

      if (error) {
        console.error('Error fetching all messages:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error fetching all messages:', error);
      return [];
    }
  };

  // Fetch all messages on component mount only if we don't have cached data
  useEffect(() => {
    // If we already have cached messages, skip fetching
    if (allMessages.length > 0 && hasInitialDataRef.current) {
      console.log('✅ Using cached messages, skipping initial fetch');
      return;
    }

    const fetchAllMessages = async () => {
      const messages = await getAllMessages();
      if (messages) {
        setAllMessages(messages);
      }
    };

    // Only fetch if we don't have cached data
    if (allMessages.length === 0) {
      fetchAllMessages();
    }

    // Note: Polling for new messages is handled by fetchNewMessagesOnly
  }, []);

  // Auto-fix message statuses when messages are loaded (if status is "failed" but whatsapp_message_id exists)
  useEffect(() => {
    if (messages.length > 0) {
      autoFixMessageStatus(messages);
    }
  }, [messages, autoFixMessageStatus]);

  // Auto-fix message statuses in allMessages as well
  useEffect(() => {
    if (allMessages.length > 0) {
      autoFixMessageStatus(allMessages as WhatsAppMessage[]);
    }
  }, [allMessages, autoFixMessageStatus]);

  // Get last message for client preview from all messages
  const getLastMessageForClient = (client: Client) => {
    if (client.isContact && client.contact_id) {
      // For contacts, find by contact_id OR phone number (using same logic as fetchMessages)
      // For contacts, MUST use lead_id (not client.id which is contact_${id})
      const isLegacy = client.lead_type === 'legacy' ||
        (client.lead_id && client.lead_id.toString().startsWith('legacy_'));
      const expectedLeadId = client.isContact
        ? client.lead_id  // For contacts, only use lead_id
        : (client.lead_id || client.id); // For main leads, use lead_id or id
      const expectedLegacyId = isLegacy && expectedLeadId ? (typeof expectedLeadId === 'string'
        ? Number(expectedLeadId.replace('legacy_', ''))
        : Number(expectedLeadId)) : null;

      // Get contact phone numbers for matching
      const contactPhone = client.phone || client.mobile || '';
      const contactMobile = client.mobile || client.phone || '';
      const normalizePhone = (phone: string) => phone ? phone.replace(/\D/g, '') : '';
      const normalizedContactPhone = normalizePhone(contactPhone);
      const normalizedContactMobile = normalizePhone(contactMobile);

      // Generate phone variations (same as in fetchMessages)
      const generatePhoneVariations = (phone: string, normalized: string) => {
        const variations: string[] = [];
        if (!phone || !normalized) return variations;
        variations.push(phone);
        variations.push(normalized);
        if (normalized.startsWith('972')) {
          variations.push(normalized.replace(/^972/, ''));
          variations.push(`0${normalized.replace(/^972/, '')}`);
        } else {
          variations.push(`972${normalized}`);
          variations.push(`+972${normalized}`);
          if (normalized.startsWith('0')) {
            variations.push(normalized.replace(/^0/, ''));
            variations.push(`972${normalized.replace(/^0/, '')}`);
          }
        }
        variations.push(`+${normalized}`);
        variations.push(normalized.replace(/^\+/, ''));
        if (normalized.length >= 4) variations.push(normalized.slice(-4));
        if (normalized.length >= 8) variations.push(normalized.slice(-8));
        if (normalized.length >= 9) variations.push(normalized.slice(-9));
        if (normalized.length >= 10) variations.push(normalized.slice(-10));
        return variations;
      };

      const phoneVariations: string[] = [];
      if (contactPhone) {
        phoneVariations.push(...generatePhoneVariations(contactPhone, normalizedContactPhone));
      }
      if (contactMobile && contactMobile !== contactPhone) {
        phoneVariations.push(...generatePhoneVariations(contactMobile, normalizedContactMobile));
      }
      const uniquePhoneVariations = Array.from(new Set(phoneVariations.filter(Boolean)));

      // Find ALL matching messages, then return the most recent one
      const matchingMessages = allMessages.filter(msg => {
        // First verify lead_id/legacy_id matches
        if (isLegacy) {
          if (expectedLegacyId !== null && msg.legacy_id !== expectedLegacyId) {
            return false;
          }
        } else {
          if (expectedLeadId && msg.lead_id !== expectedLeadId) {
            return false;
          }
        }

        // Match by contact_id (highest priority)
        if (msg.contact_id === client.contact_id) {
          return true;
        }

        // Match by phone number (using all variations)
        if (msg.phone_number) {
          const normalizedMsgPhone = normalizePhone(msg.phone_number);
          for (const variation of uniquePhoneVariations) {
            const normalizedVariation = normalizePhone(variation);
            if (normalizedVariation && normalizedMsgPhone) {
              if (normalizedMsgPhone === normalizedVariation ||
                (normalizedVariation.length >= 8 && normalizedMsgPhone.length >= 8 &&
                  (normalizedMsgPhone.endsWith(normalizedVariation.slice(-8)) ||
                    normalizedVariation.endsWith(normalizedMsgPhone.slice(-8)))) ||
                (normalizedVariation.length >= 4 && normalizedMsgPhone.length >= 4 &&
                  (normalizedMsgPhone.endsWith(normalizedVariation.slice(-4)) ||
                    normalizedVariation.endsWith(normalizedMsgPhone.slice(-4))))) {
                return true;
              }
            }
          }
        }

        return false;
      });

      // Return the most recent message (sorted by sent_at descending, take first)
      if (matchingMessages.length > 0) {
        return matchingMessages.sort((a, b) =>
          new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime()
        )[0];
      }

      return undefined;
    } else {
      // For main leads, find by lead_id but EXCLUDE messages with contact_id
      // CRITICAL: Messages with contact_id belong to contacts, not the main lead
      // Also handle legacy leads (they use legacy_id, not lead_id)
      const isLegacy = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');

      if (isLegacy) {
        const legacyId = typeof client.id === 'string'
          ? Number(client.id.replace('legacy_', ''))
          : Number(client.id);
        if (!isNaN(legacyId)) {
          // Get all contacts for this lead to check phone number matches
          const contactsForThisLead = clients.filter(c =>
            c.isContact &&
            c.lead_id &&
            String(c.lead_id) === String(legacyId)
          );

          const normalizePhone = (phone: string) => phone ? phone.replace(/\D/g, '') : '';

          // Find ALL matching messages, then return the most recent one
          const matchingMessages = allMessages.filter(msg => {
            // STRICT: Must not have contact_id (null, undefined, or falsy)
            if (msg.contact_id !== null && msg.contact_id !== undefined) {
              return false;
            }

            // CRITICAL: If message has a phone_number, check if it matches any contact's phone
            // If it matches, exclude it from main lead (it belongs to a contact)
            if (msg.phone_number && contactsForThisLead.length > 0) {
              const msgPhoneNormalized = normalizePhone(msg.phone_number);
              for (const contact of contactsForThisLead) {
                const contactPhone = contact.phone || contact.mobile || '';
                const contactMobile = contact.mobile || contact.phone || '';
                const contactPhoneNormalized = normalizePhone(contactPhone);
                const contactMobileNormalized = normalizePhone(contactMobile);

                // Check if message phone matches contact phone (exact, last 8, or last 4 digits)
                if (contactPhoneNormalized && msgPhoneNormalized) {
                  if (msgPhoneNormalized === contactPhoneNormalized ||
                    (contactPhoneNormalized.length >= 8 && msgPhoneNormalized.length >= 8 &&
                      (msgPhoneNormalized.endsWith(contactPhoneNormalized.slice(-8)) ||
                        contactPhoneNormalized.endsWith(msgPhoneNormalized.slice(-8)))) ||
                    (contactPhoneNormalized.length >= 4 && msgPhoneNormalized.length >= 4 &&
                      (msgPhoneNormalized.endsWith(contactPhoneNormalized.slice(-4)) ||
                        contactPhoneNormalized.endsWith(msgPhoneNormalized.slice(-4))))) {
                    console.log(`❌ Excluding message ${msg.id} from main lead (legacy): phone matches contact ${contact.contact_id} (${contact.name})`);
                    return false;
                  }
                }

                // Check mobile too
                if (contactMobileNormalized && msgPhoneNormalized && contactMobileNormalized !== contactPhoneNormalized) {
                  if (msgPhoneNormalized === contactMobileNormalized ||
                    (contactMobileNormalized.length >= 8 && msgPhoneNormalized.length >= 8 &&
                      (msgPhoneNormalized.endsWith(contactMobileNormalized.slice(-8)) ||
                        contactMobileNormalized.endsWith(msgPhoneNormalized.slice(-8)))) ||
                    (contactMobileNormalized.length >= 4 && msgPhoneNormalized.length >= 4 &&
                      (msgPhoneNormalized.endsWith(contactMobileNormalized.slice(-4)) ||
                        contactMobileNormalized.endsWith(msgPhoneNormalized.slice(-4))))) {
                    console.log(`❌ Excluding message ${msg.id} from main lead (legacy): phone matches contact ${contact.contact_id} (${contact.name}) mobile`);
                    return false;
                  }
                }
              }
            }

            // Match by legacy_id
            return msg.legacy_id === legacyId;
          });

          // Return the most recent message (sorted by sent_at descending, take first)
          if (matchingMessages.length > 0) {
            const found = matchingMessages.sort((a, b) =>
              new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime()
            )[0];
            console.log(`✅ Main lead (legacy) last message found: client=${client.id}, legacyId=${legacyId}, msgId=${found.id}, contact_id=${found.contact_id}, sent_at=${found.sent_at}`);
            return found;
          }

          return undefined;
        }
      } else {
        // For new leads, match by lead_id (can be UUID string)
        // CRITICAL: Must exclude messages with contact_id OR messages whose phone matches a contact's phone
        // Get all contacts for this lead to check phone number matches
        const contactsForThisLead = clients.filter(c =>
          c.isContact &&
          c.lead_id &&
          (String(c.lead_id) === String(client.id) || c.lead_id === client.id)
        );

        const normalizePhone = (phone: string) => phone ? phone.replace(/\D/g, '') : '';

        // Find ALL matching messages, then return the most recent one
        const matchingMessages = allMessages.filter(msg => {
          // STRICT: Must not have contact_id (null, undefined, or falsy)
          if (msg.contact_id !== null && msg.contact_id !== undefined) {
            return false;
          }

          // CRITICAL: If message has a phone_number, check if it matches any contact's phone
          // If it matches, exclude it from main lead (it belongs to a contact)
          if (msg.phone_number && contactsForThisLead.length > 0) {
            const msgPhoneNormalized = normalizePhone(msg.phone_number);
            for (const contact of contactsForThisLead) {
              const contactPhone = contact.phone || contact.mobile || '';
              const contactMobile = contact.mobile || contact.phone || '';
              const contactPhoneNormalized = normalizePhone(contactPhone);
              const contactMobileNormalized = normalizePhone(contactMobile);

              // Check if message phone matches contact phone (exact, last 8, or last 4 digits)
              if (contactPhoneNormalized && msgPhoneNormalized) {
                if (msgPhoneNormalized === contactPhoneNormalized ||
                  (contactPhoneNormalized.length >= 8 && msgPhoneNormalized.length >= 8 &&
                    (msgPhoneNormalized.endsWith(contactPhoneNormalized.slice(-8)) ||
                      contactPhoneNormalized.endsWith(msgPhoneNormalized.slice(-8)))) ||
                  (contactPhoneNormalized.length >= 4 && msgPhoneNormalized.length >= 4 &&
                    (msgPhoneNormalized.endsWith(contactPhoneNormalized.slice(-4)) ||
                      contactPhoneNormalized.endsWith(msgPhoneNormalized.slice(-4))))) {
                  console.log(`❌ Excluding message ${msg.id} from main lead: phone matches contact ${contact.contact_id} (${contact.name})`);
                  return false;
                }
              }

              // Check mobile too
              if (contactMobileNormalized && msgPhoneNormalized && contactMobileNormalized !== contactPhoneNormalized) {
                if (msgPhoneNormalized === contactMobileNormalized ||
                  (contactMobileNormalized.length >= 8 && msgPhoneNormalized.length >= 8 &&
                    (msgPhoneNormalized.endsWith(contactMobileNormalized.slice(-8)) ||
                      contactMobileNormalized.endsWith(msgPhoneNormalized.slice(-8)))) ||
                  (contactMobileNormalized.length >= 4 && msgPhoneNormalized.length >= 4 &&
                    (msgPhoneNormalized.endsWith(contactMobileNormalized.slice(-4)) ||
                      contactMobileNormalized.endsWith(msgPhoneNormalized.slice(-4))))) {
                  console.log(`❌ Excluding message ${msg.id} from main lead: phone matches contact ${contact.contact_id} (${contact.name}) mobile`);
                  return false;
                }
              }
            }
          }

          // Match by lead_id (handle both string and number comparison)
          return String(msg.lead_id) === String(client.id) || msg.lead_id === client.id;
        });

        // Return the most recent message (sorted by sent_at descending, take first)
        if (matchingMessages.length > 0) {
          const found = matchingMessages.sort((a, b) =>
            new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime()
          )[0];
          console.log(`✅ Main lead (new) last message found: client=${client.id}, msgLeadId=${found.lead_id}, msgId=${found.id}, contact_id=${found.contact_id}, sent_at=${found.sent_at}`);
          return found;
        }

        return undefined;
      }

      return undefined; // No match found
    }
  };

  // Get unread count for client from all messages
  const getUnreadCountForClient = (client: Client) => {
    let clientMessages: any[] = [];

    if (client.isContact && client.contact_id) {
      // For contacts, filter by contact_id OR phone number (using same logic as fetchMessages)
      const isLegacy = client.lead_type === 'legacy' ||
        (client.lead_id && client.lead_id.toString().startsWith('legacy_'));
      const expectedLeadId = client.isContact
        ? client.lead_id  // For contacts, only use lead_id
        : (client.lead_id || client.id); // For main leads, use lead_id or id
      const expectedLegacyId = isLegacy && expectedLeadId ? (typeof expectedLeadId === 'string'
        ? Number(expectedLeadId.replace('legacy_', ''))
        : Number(expectedLeadId)) : null;

      // Get contact phone numbers for matching
      const contactPhone = client.phone || client.mobile || '';
      const contactMobile = client.mobile || client.phone || '';
      const normalizePhone = (phone: string) => phone ? phone.replace(/\D/g, '') : '';
      const normalizedContactPhone = normalizePhone(contactPhone);
      const normalizedContactMobile = normalizePhone(contactMobile);

      // Generate phone variations (same as in fetchMessages)
      const generatePhoneVariations = (phone: string, normalized: string) => {
        const variations: string[] = [];
        if (!phone || !normalized) return variations;
        variations.push(phone);
        variations.push(normalized);
        if (normalized.startsWith('972')) {
          variations.push(normalized.replace(/^972/, ''));
          variations.push(`0${normalized.replace(/^972/, '')}`);
        } else {
          variations.push(`972${normalized}`);
          variations.push(`+972${normalized}`);
          if (normalized.startsWith('0')) {
            variations.push(normalized.replace(/^0/, ''));
            variations.push(`972${normalized.replace(/^0/, '')}`);
          }
        }
        variations.push(`+${normalized}`);
        variations.push(normalized.replace(/^\+/, ''));
        if (normalized.length >= 4) variations.push(normalized.slice(-4));
        if (normalized.length >= 8) variations.push(normalized.slice(-8));
        if (normalized.length >= 9) variations.push(normalized.slice(-9));
        if (normalized.length >= 10) variations.push(normalized.slice(-10));
        return variations;
      };

      const phoneVariations: string[] = [];
      if (contactPhone) {
        phoneVariations.push(...generatePhoneVariations(contactPhone, normalizedContactPhone));
      }
      if (contactMobile && contactMobile !== contactPhone) {
        phoneVariations.push(...generatePhoneVariations(contactMobile, normalizedContactMobile));
      }
      const uniquePhoneVariations = Array.from(new Set(phoneVariations.filter(Boolean)));

      clientMessages = allMessages.filter(msg => {
        // First verify lead_id/legacy_id matches
        if (isLegacy) {
          if (expectedLegacyId !== null && msg.legacy_id !== expectedLegacyId) {
            return false;
          }
        } else {
          if (expectedLeadId && msg.lead_id !== expectedLeadId) {
            return false;
          }
        }

        // Match by contact_id (highest priority)
        if (msg.contact_id === client.contact_id) {
          return true;
        }

        // Match by phone number (using all variations)
        if (msg.phone_number) {
          const normalizedMsgPhone = normalizePhone(msg.phone_number);
          for (const variation of uniquePhoneVariations) {
            const normalizedVariation = normalizePhone(variation);
            if (normalizedVariation && normalizedMsgPhone) {
              if (normalizedMsgPhone === normalizedVariation ||
                (normalizedVariation.length >= 8 && normalizedMsgPhone.length >= 8 &&
                  (normalizedMsgPhone.endsWith(normalizedVariation.slice(-8)) ||
                    normalizedVariation.endsWith(normalizedMsgPhone.slice(-8)))) ||
                (normalizedVariation.length >= 4 && normalizedMsgPhone.length >= 4 &&
                  (normalizedMsgPhone.endsWith(normalizedVariation.slice(-4)) ||
                    normalizedVariation.endsWith(normalizedMsgPhone.slice(-4))))) {
                return true;
              }
            }
          }
        }

        return false;
      });
    } else {
      // For main leads, filter by lead_id but EXCLUDE messages with contact_id
      // CRITICAL: Messages with contact_id belong to contacts, not the main lead
      // Also handle legacy leads (they use legacy_id, not lead_id)
      const isLegacy = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');

      if (isLegacy) {
        const legacyId = typeof client.id === 'string'
          ? Number(client.id.replace('legacy_', ''))
          : Number(client.id);
        if (!isNaN(legacyId)) {
          // Get all contacts for this lead to check phone number matches
          const contactsForThisLead = clients.filter(c =>
            c.isContact &&
            c.lead_id &&
            String(c.lead_id) === String(legacyId)
          );

          const normalizePhone = (phone: string) => phone ? phone.replace(/\D/g, '') : '';

          clientMessages = allMessages.filter(msg => {
            // STRICT: Must not have contact_id (null, undefined, or falsy)
            if (msg.contact_id !== null && msg.contact_id !== undefined) {
              return false;
            }

            // CRITICAL: If message has a phone_number, check if it matches any contact's phone
            // If it matches, exclude it from main lead (it belongs to a contact)
            if (msg.phone_number && contactsForThisLead.length > 0) {
              const msgPhoneNormalized = normalizePhone(msg.phone_number);
              for (const contact of contactsForThisLead) {
                const contactPhone = contact.phone || contact.mobile || '';
                const contactMobile = contact.mobile || contact.phone || '';
                const contactPhoneNormalized = normalizePhone(contactPhone);
                const contactMobileNormalized = normalizePhone(contactMobile);

                // Check if message phone matches contact phone (exact, last 8, or last 4 digits)
                if (contactPhoneNormalized && msgPhoneNormalized) {
                  if (msgPhoneNormalized === contactPhoneNormalized ||
                    (contactPhoneNormalized.length >= 8 && msgPhoneNormalized.length >= 8 &&
                      (msgPhoneNormalized.endsWith(contactPhoneNormalized.slice(-8)) ||
                        contactPhoneNormalized.endsWith(msgPhoneNormalized.slice(-8)))) ||
                    (contactPhoneNormalized.length >= 4 && msgPhoneNormalized.length >= 4 &&
                      (msgPhoneNormalized.endsWith(contactPhoneNormalized.slice(-4)) ||
                        contactPhoneNormalized.endsWith(msgPhoneNormalized.slice(-4))))) {
                    return false;
                  }
                }

                // Check mobile too
                if (contactMobileNormalized && msgPhoneNormalized && contactMobileNormalized !== contactPhoneNormalized) {
                  if (msgPhoneNormalized === contactMobileNormalized ||
                    (contactMobileNormalized.length >= 8 && msgPhoneNormalized.length >= 8 &&
                      (msgPhoneNormalized.endsWith(contactMobileNormalized.slice(-8)) ||
                        contactMobileNormalized.endsWith(msgPhoneNormalized.slice(-8)))) ||
                    (contactMobileNormalized.length >= 4 && msgPhoneNormalized.length >= 4 &&
                      (msgPhoneNormalized.endsWith(contactMobileNormalized.slice(-4)) ||
                        contactMobileNormalized.endsWith(msgPhoneNormalized.slice(-4))))) {
                    return false;
                  }
                }
              }
            }

            // Match by legacy_id
            return msg.legacy_id === legacyId;
          });
          console.log(`📊 Main lead (legacy) unread count: client=${client.id}, legacyId=${legacyId}, filteredMessages=${clientMessages.length}, totalMessages=${allMessages.length}, contactsForLead=${contactsForThisLead.length}`);
        } else {
          clientMessages = [];
        }
      } else {
        // For new leads, match by lead_id (can be UUID string)
        // CRITICAL: Must exclude messages with contact_id OR messages whose phone matches a contact's phone
        // Get all contacts for this lead to check phone number matches
        const contactsForThisLead = clients.filter(c =>
          c.isContact &&
          c.lead_id &&
          (String(c.lead_id) === String(client.id) || c.lead_id === client.id)
        );

        const normalizePhone = (phone: string) => phone ? phone.replace(/\D/g, '') : '';

        clientMessages = allMessages.filter(msg => {
          // STRICT: Must not have contact_id (null, undefined, or falsy)
          if (msg.contact_id !== null && msg.contact_id !== undefined) {
            return false;
          }

          // CRITICAL: If message has a phone_number, check if it matches any contact's phone
          // If it matches, exclude it from main lead (it belongs to a contact)
          if (msg.phone_number && contactsForThisLead.length > 0) {
            const msgPhoneNormalized = normalizePhone(msg.phone_number);
            for (const contact of contactsForThisLead) {
              const contactPhone = contact.phone || contact.mobile || '';
              const contactMobile = contact.mobile || contact.phone || '';
              const contactPhoneNormalized = normalizePhone(contactPhone);
              const contactMobileNormalized = normalizePhone(contactMobile);

              // Check if message phone matches contact phone (exact, last 8, or last 4 digits)
              if (contactPhoneNormalized && msgPhoneNormalized) {
                if (msgPhoneNormalized === contactPhoneNormalized ||
                  (contactPhoneNormalized.length >= 8 && msgPhoneNormalized.length >= 8 &&
                    (msgPhoneNormalized.endsWith(contactPhoneNormalized.slice(-8)) ||
                      contactPhoneNormalized.endsWith(msgPhoneNormalized.slice(-8)))) ||
                  (contactPhoneNormalized.length >= 4 && msgPhoneNormalized.length >= 4 &&
                    (msgPhoneNormalized.endsWith(contactPhoneNormalized.slice(-4)) ||
                      contactPhoneNormalized.endsWith(msgPhoneNormalized.slice(-4))))) {
                  return false;
                }
              }

              // Check mobile too
              if (contactMobileNormalized && msgPhoneNormalized && contactMobileNormalized !== contactPhoneNormalized) {
                if (msgPhoneNormalized === contactMobileNormalized ||
                  (contactMobileNormalized.length >= 8 && msgPhoneNormalized.length >= 8 &&
                    (msgPhoneNormalized.endsWith(contactMobileNormalized.slice(-8)) ||
                      contactMobileNormalized.endsWith(msgPhoneNormalized.slice(-8)))) ||
                  (contactMobileNormalized.length >= 4 && msgPhoneNormalized.length >= 4 &&
                    (msgPhoneNormalized.endsWith(contactMobileNormalized.slice(-4)) ||
                      contactMobileNormalized.endsWith(msgPhoneNormalized.slice(-4))))) {
                  return false;
                }
              }
            }
          }

          // Match by lead_id (handle both string and number comparison)
          return String(msg.lead_id) === String(client.id) || msg.lead_id === client.id;
        });
        console.log(`📊 Main lead (new) unread count: client=${client.id}, filteredMessages=${clientMessages.length}, totalMessages=${allMessages.length}, messagesWithContactId=${allMessages.filter(m => m.contact_id).length}, contactsForLead=${contactsForThisLead.length}`);
      }
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

  // State for lazy loading contacts
  const [visibleClientsCount, setVisibleClientsCount] = useState(20);

  // Filter clients: exclude those without any messages, then apply search filter
  // This is computed here (after getLastMessageForClient is defined) using useMemo
  const filteredClients = useMemo(() => {
    // Filter clients: exclude those without any messages
    // IMPORTANT: Use a more lenient check - if client exists in the list, it means it has messages
    // The getLastMessageForClient might be too strict, so we'll trust that clients in the list have messages
    const clientsWithMessages = clients.filter(client => {
      // First, try to get last message
      const lastMessage = getLastMessageForClient(client);
      if (lastMessage !== undefined && lastMessage !== null) {
        return true;
      }

      // Fallback: Check if there are any messages in allMessages for this client
      // This is more lenient and will catch cases where getLastMessageForClient fails
      if (client.isContact && client.contact_id) {
        const hasMessages = allMessages.some((msg: any) => {
          // Match by contact_id
          if (msg.contact_id === client.contact_id) return true;
          // Match by phone number
          const normalizePhone = (phone: string) => phone ? phone.replace(/\D/g, '') : '';
          const contactPhone = normalizePhone(client.phone || client.mobile || '');
          if (msg.phone_number && contactPhone) {
            const msgPhone = normalizePhone(msg.phone_number);
            if (msgPhone === contactPhone) return true;
          }
          return false;
        });
        if (hasMessages) return true;
      } else {
        // For main leads
        const isLegacy = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
        const hasMessages = allMessages.some((msg: any) => {
          if (isLegacy) {
            const legacyId = typeof client.id === 'string'
              ? Number(client.id.replace('legacy_', ''))
              : Number(client.id);
            return !msg.contact_id && msg.legacy_id === legacyId;
          } else {
            return !msg.contact_id && (String(msg.lead_id) === String(client.id) || msg.lead_id === client.id);
          }
        });
        if (hasMessages) return true;
      }

      return false;
    });

    console.log('🔍 DEBUG filteredClients: clientsWithMessages count:', clientsWithMessages.length);

    // Check if L204687 passed the message filter
    const hasL204687WithMessages = clientsWithMessages.some((c: any) =>
      c.lead_number === '204687' ||
      c.lead_number === 'L204687' ||
      String(c.lead_number) === '204687' ||
      String(c.lead_number) === 'L204687'
    );
    console.log('🔍 DEBUG L204687: Passed message filter?', hasL204687WithMessages);

    // Apply search filter
    const searchFiltered = clientsWithMessages.filter(client =>
      client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      client.lead_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (client.email && client.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (client.phone && client.phone.includes(searchTerm)) ||
      (client.mobile && client.mobile.includes(searchTerm))
    );

    console.log('🔍 DEBUG filteredClients: searchFiltered count:', searchFiltered.length);

    // Check if L204687 passed the search filter
    const hasL204687InSearch = searchFiltered.some((c: any) =>
      c.lead_number === '204687' ||
      c.lead_number === 'L204687' ||
      String(c.lead_number) === '204687' ||
      String(c.lead_number) === 'L204687'
    );
    console.log('🔍 DEBUG L204687: Passed search filter?', hasL204687InSearch, 'searchTerm:', searchTerm);

    // Sort: 1st by unread on top (sorted by last received message date), then by last message received or sent (most recent first)
    const sorted = searchFiltered.sort((a, b) => {
      // Get unread counts
      const unreadCountA = getUnreadCountForClient(a);
      const unreadCountB = getUnreadCountForClient(b);

      // First priority: unread messages (clients with unread messages go to top)
      if (unreadCountA > 0 && unreadCountB === 0) return -1;
      if (unreadCountB > 0 && unreadCountA === 0) return 1;

      // If both have unread messages, sort by latest message timestamp (most recent first)
      if (unreadCountA > 0 && unreadCountB > 0) {
        const lastMessageA = getLastMessageForClient(a);
        const lastMessageB = getLastMessageForClient(b);

        if (lastMessageA && lastMessageB) {
          const dateA = new Date(lastMessageA.sent_at);
          const dateB = new Date(lastMessageB.sent_at);

          if (!isNaN(dateA.getTime()) && !isNaN(dateB.getTime())) {
            // Sort by most recent message first (descending - newest on top)
            return dateB.getTime() - dateA.getTime();
          }
        }

        // If only one has messages, prioritize it
        if (lastMessageA && !lastMessageB) return -1;
        if (lastMessageB && !lastMessageA) return 1;
      }

      // If both have unread or both don't have unread, and unread counts differ, sort by unread count (descending)
      if (unreadCountA !== unreadCountB) {
        return unreadCountB - unreadCountA;
      }

      // Second priority: latest message time (most recent first) - includes both received and sent messages
      const lastMessageA = getLastMessageForClient(a);
      const lastMessageB = getLastMessageForClient(b);

      if (lastMessageA && lastMessageB) {
        // Sort by sent_at (most recent first) - this includes both received and sent messages
        // Ensure we're comparing valid dates
        const dateA = new Date(lastMessageA.sent_at);
        const dateB = new Date(lastMessageB.sent_at);

        // Check if dates are valid
        if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) {
          // If dates are invalid, maintain order
          return 0;
        }

        // Sort by most recent first (descending order)
        const timeDiff = dateB.getTime() - dateA.getTime();
        return timeDiff;
      }

      // If only one has messages, prioritize it
      if (lastMessageA && !lastMessageB) return -1;
      if (lastMessageB && !lastMessageA) return 1;

      // If neither has messages, maintain original order
      return 0;
    });

    // Final check for L204687 after sorting
    const hasL204687Final = sorted.some((c: any) =>
      c.lead_number === '204687' ||
      c.lead_number === 'L204687' ||
      String(c.lead_number) === '204687' ||
      String(c.lead_number) === 'L204687'
    );
    console.log('🔍 DEBUG L204687: Final - In sorted filteredClients?', hasL204687Final);
    if (hasL204687Final) {
      const l204687Index = sorted.findIndex((c: any) =>
        c.lead_number === '204687' ||
        c.lead_number === 'L204687' ||
        String(c.lead_number) === '204687' ||
        String(c.lead_number) === 'L204687'
      );
      console.log('🔍 DEBUG L204687: Position in sorted list:', l204687Index);
    }

    return sorted;
  }, [clients, searchTerm, allMessages]);

  // Visible clients for lazy loading
  const visibleClients = useMemo(() => {
    return filteredClients.slice(0, visibleClientsCount);
  }, [filteredClients, visibleClientsCount]);

  // Check if there are more clients to load
  const hasMoreClients = filteredClients.length > visibleClientsCount;

  // Load more clients handler
  const loadMoreClients = useCallback(() => {
    setVisibleClientsCount(prev => Math.min(prev + 20, filteredClients.length));
  }, [filteredClients.length]);

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

  // Send media message (optionally with a specific file)
  const handleSendMedia = async (fileOverride?: File) => {
    const fileToSend = fileOverride || selectedFile;

    if (!fileToSend || !selectedClient || !currentUser) {
      console.log('❌ Cannot send media - missing file, client, or user:', {
        fileToSend,
        selectedFile,
        fileOverride,
        selectedClient,
        currentUser
      });
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

    console.log('📤 Starting to send media:', {
      fileName: fileToSend.name,
      fileSize: fileToSend.size,
      fileType: fileToSend.type,
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

      console.log('📤 Uploading file:', {
        name: fileForUpload.name,
        size: fileForUpload.size,
        type: fileForUpload.type,
        isFile: fileForUpload instanceof File
      });

      formData.append('file', fileForUpload);
      formData.append('leadId', selectedClient.id);

      // Upload media to WhatsApp
      // Note: Don't set Content-Type header - browser will set it automatically with boundary for FormData
      const uploadResponse = await fetch(buildApiUrl('/api/whatsapp/upload-media'), {
        method: 'POST',
        body: formData,
        // Don't set Content-Type - let browser set it with multipart/form-data boundary
      });

      const uploadResult = await uploadResponse.json();

      if (!uploadResponse.ok) {
        // Check if it's a WebM format issue
        if (uploadResult.requiresConversion || fileToSend.type.includes('webm')) {
          throw new Error('WebM audio format is not supported by WhatsApp. Please try recording again - your browser should automatically use a supported format (OGG/Opus). If the issue persists, try using a different browser like Firefox or Chrome.');
        }
        throw new Error(uploadResult.error || 'Failed to upload media');
      }

      // Send media message
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
          leadId: selectedClient.id,
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

      // Add message to local state
      console.log('📤 Sending media with sender:', senderName, 'from user:', currentUser);
      console.log('📤 Media details:', {
        mediaType,
        isVoiceMessage,
        mediaId: uploadResult.mediaId,
        messageId: result.messageId
      });

      const newMsg: WhatsAppMessage = {
        id: Date.now(),
        lead_id: selectedClient.id,
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

      console.log('📤 Adding message to local state:', newMsg);
      // Add message to the end and ensure messages are sorted by sent_at
      setMessages(prev => {
        const updated = [...prev, newMsg];
        // Sort by sent_at in ascending order (oldest first, newest last)
        return updated.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
      });
      setShouldAutoScroll(true); // Trigger auto-scroll when media message is sent
      setNewMessage('');
      if (!fileOverride) {
        setSelectedFile(null);
      }
      setShowVoiceRecorder(false); // Close voice recorder if it was open
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

    // Check if message is from today (same day, month, year)
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDate = new Date(messageDate.getFullYear(), messageDate.getMonth(), messageDate.getDate());
    const isToday = today.getTime() === msgDate.getTime();

    if (isToday) {
      // Today - show time in 24-hour format
      return messageDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    } else {
      // Not today - calculate days difference
      const diffTime = today.getTime() - msgDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        return 'Yesterday';
      } else if (diffDays < 7) {
        // Within a week - show weekday
        return messageDate.toLocaleDateString('en-US', { weekday: 'short' });
      } else {
        // More than a week - show date
        return messageDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
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

  // Check if a client is locked (24 hours passed since last message)
  const isClientLocked = (lastMessageTime: string) => {
    const lastMessage = new Date(lastMessageTime);
    const now = new Date();
    const diffMs = now.getTime() - lastMessage.getTime();
    const hoursPassed = diffMs / (1000 * 60 * 60);
    return hoursPassed > 24;
  };

  return (
    <div className="fixed inset-0 bg-white z-[9999]" style={{ overflow: 'visible' }}>
      <div className="h-full flex flex-col" style={{ height: '100vh', maxHeight: '100vh', overflow: 'visible' }}>
        {/* Header */}
        <div className={`flex items-center justify-between p-4 md:p-6 border-b border-gray-200 ${isMobile && isContactsHeaderGlass ? 'bg-white/70 backdrop-blur-md supports-[backdrop-filter]:bg-white/50' : 'bg-white'} ${isMobile && showChat ? 'hidden' : ''}`}>
          <div className="flex items-center min-w-0 flex-1">
            <div className="relative flex-shrink-0 mr-4">
              <FaWhatsapp className="w-6 h-6 md:w-8 md:h-8 text-green-600 flex-shrink-0" />
              {totalUnreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {totalUnreadCount > 9 ? '9+' : totalUnreadCount}
                </span>
              )}
            </div>
            {selectedClient && (
              <div className="hidden md:flex items-center gap-4 min-w-0 flex-1 overflow-hidden">
                <div className="flex items-center gap-3 min-w-0">
                </div>

                <div className="hidden md:flex items-center gap-4 lg:gap-6">
                  {/* Closer */}
                  <div className="flex items-center gap-2">
                    <EmployeeAvatar
                      employeeId={getEmployeeIdFromRole(
                        selectedClient.closer,
                        selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_'),
                        'closer_id',
                        selectedClient
                      )}
                      size="sm"
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Closer</span>
                      <span className="text-sm font-semibold text-gray-700">
                        {(() => {
                          const isLegacy = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
                          if (isLegacy && selectedClient.closer_id) {
                            return getEmployeeDisplayName(selectedClient.closer_id);
                          }
                          // For new leads, check if closer is numeric (ID) or display name
                          if (selectedClient.closer && /^\d+$/.test(String(selectedClient.closer).trim())) {
                            return getEmployeeDisplayName(Number(selectedClient.closer));
                          }
                          return selectedClient.closer || '---';
                        })()}
                      </span>
                    </div>
                  </div>

                  {/* Scheduler */}
                  <div className="flex items-center gap-2">
                    <EmployeeAvatar
                      employeeId={getEmployeeIdFromRole(
                        selectedClient.scheduler,
                        selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_'),
                        'meeting_scheduler_id',
                        selectedClient
                      )}
                      size="sm"
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Scheduler</span>
                      <span className="text-sm font-semibold text-gray-700">
                        {(() => {
                          const isLegacy = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
                          if (isLegacy && selectedClient.meeting_scheduler_id) {
                            return getEmployeeDisplayName(selectedClient.meeting_scheduler_id);
                          }
                          // For new leads, check if scheduler is numeric (ID) or display name
                          if (selectedClient.scheduler && /^\d+$/.test(String(selectedClient.scheduler).trim())) {
                            return getEmployeeDisplayName(Number(selectedClient.scheduler));
                          }
                          return selectedClient.scheduler || '---';
                        })()}
                      </span>
                    </div>
                  </div>

                  {/* Handler */}
                  <div className="flex items-center gap-2">
                    <EmployeeAvatar
                      employeeId={(() => {
                        const isLegacy = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
                        // For legacy, use case_handler_id directly
                        if (isLegacy) {
                          return selectedClient.case_handler_id || null;
                        }
                        // For new leads, check case_handler_id first, then handler
                        if (selectedClient.case_handler_id) {
                          return selectedClient.case_handler_id;
                        }
                        return getEmployeeIdFromRole(selectedClient.handler, false, undefined, selectedClient);
                      })()}
                      size="sm"
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Handler</span>
                      <span className="text-sm font-semibold text-gray-700">
                        {(() => {
                          const isLegacy = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
                          if (isLegacy && selectedClient.case_handler_id) {
                            return getEmployeeDisplayName(selectedClient.case_handler_id);
                          }
                          // For new leads
                          if (selectedClient.case_handler_id) {
                            return getEmployeeDisplayName(selectedClient.case_handler_id);
                          }
                          if (selectedClient.handler && /^\d+$/.test(String(selectedClient.handler).trim())) {
                            return getEmployeeDisplayName(Number(selectedClient.handler));
                          }
                          return selectedClient.handler || '---';
                        })()}
                      </span>
                    </div>
                  </div>

                  {/* Expert */}
                  <div className="flex items-center gap-2">
                    <EmployeeAvatar
                      employeeId={getEmployeeIdFromRole(
                        selectedClient.expert,
                        selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_'),
                        'expert_id',
                        selectedClient
                      )}
                      size="sm"
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Expert</span>
                      <span className="text-sm font-semibold text-gray-700">
                        {(() => {
                          const isLegacy = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
                          if (isLegacy && selectedClient.expert_id) {
                            return getEmployeeDisplayName(selectedClient.expert_id);
                          }
                          // For new leads
                          if (selectedClient.expert && /^\d+$/.test(String(selectedClient.expert).trim())) {
                            return getEmployeeDisplayName(Number(selectedClient.expert));
                          }
                          return selectedClient.expert || '---';
                        })()}
                      </span>
                    </div>
                  </div>
                </div>

                {(selectedClient.next_followup || selectedClient.probability || selectedClient.balance || selectedClient.potential_applicants) && (
                  <div className="hidden md:flex items-center gap-4 lg:gap-6">
                    <div className="w-px h-6 bg-gray-300"></div>

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
            {selectedClient && !isMobile && (
              <div className="flex items-center gap-3">
                <div
                  className="flex items-center gap-2 min-w-0 cursor-pointer hover:opacity-80 transition-opacity px-3 py-1.5 rounded-lg hover:bg-gray-50"
                  onClick={() => handleNavigateToClient(selectedClient)}
                  title="View Client Page"
                >
                  <span className="text-lg font-semibold text-gray-900 truncate">
                    {selectedClient.name}
                  </span>
                  <span className="text-sm text-gray-500 font-mono flex-shrink-0">
                    ({selectedClient.lead_number})
                  </span>
                </div>
                {timeLeft && (
                  <div className={`flex items-center gap-1 px-2 py-1 rounded text-sm font-medium ${isLocked ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
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

        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left Panel - Client List */}
          <div className={`${isMobile ? 'w-full' : 'w-80'} border-r border-gray-200 flex flex-col min-h-0 ${isMobile && showChat ? 'hidden' : ''}`}>
            {/* Filter Toggle and Search Bar - Fixed on mobile */}
            <div className={`${isMobile
              ? 'sticky top-0 z-10 bg-white border-b border-gray-200 p-3'
              : 'p-3 border-b border-gray-200'
              }`}>
              {/* Toggle Tabs - Only show for superusers */}
              {isSuperuser === true && (
                <div className="flex gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => setShowMyContactsOnly(false)}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${!showMyContactsOnly ? 'text-white shadow-sm' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    style={!showMyContactsOnly
                      ? { background: 'linear-gradient(to bottom right, #047857, #0f766e)' }
                      : undefined
                    }
                  >
                    All Contacts
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowMyContactsOnly(true)}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${showMyContactsOnly ? 'text-white shadow-sm' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    style={showMyContactsOnly
                      ? { background: 'linear-gradient(to bottom right, #047857, #0f766e)' }
                      : undefined
                    }
                  >
                    My Contacts
                  </button>
                </div>
              )}

              {/* Search Bar */}
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
              <div
                ref={contactListRef}
                onScroll={(e) => {
                  handleContactListScroll(e);
                  const target = e.target as HTMLElement;
                  // Load more when user scrolls near bottom (within 200px)
                  if (target.scrollHeight - target.scrollTop - target.clientHeight < 200) {
                    if (hasMoreClients) {
                      loadMoreClients();
                    }
                  }
                }}
                className="flex-1 overflow-y-auto min-h-0"
              >
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
                  <>
                    {visibleClients.map((client) => {
                      const lastMessage = getLastMessageForClient(client);
                      const unreadCount = getUnreadCountForClient(client);
                      const isSelected = selectedClient?.id === client.id;

                      // Check if client has any messages
                      let clientMessages: any[] = [];
                      if (client.isContact && client.contact_id) {
                        // For contacts, filter by phone number match OR contact_id match
                        // Prioritize phone number matching to handle incorrectly assigned contact_ids
                        const isLegacy = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
                        const expectedLeadId = client.isContact
                          ? client.lead_id  // For contacts, only use lead_id
                          : (client.lead_id || client.id); // For main leads, use lead_id or id
                        const expectedLegacyId = isLegacy ? (typeof expectedLeadId === 'string'
                          ? Number(expectedLeadId.replace('legacy_', ''))
                          : Number(expectedLeadId)) : null;

                        // Normalize contact's phone numbers for matching
                        const normalizePhone = (phone: string) => phone ? phone.replace(/\D/g, '') : '';
                        const contactPhone = client.phone || client.mobile || '';
                        const contactMobile = client.mobile || client.phone || '';
                        const normalizedContactPhone = normalizePhone(contactPhone);
                        const normalizedContactMobile = normalizePhone(contactMobile);

                        clientMessages = allMessages.filter(m => {
                          // First verify lead_id/legacy_id matches
                          if (isLegacy) {
                            if (expectedLegacyId !== null && m.legacy_id !== expectedLegacyId) {
                              return false;
                            }
                          } else {
                            if (expectedLeadId && m.lead_id !== expectedLeadId) {
                              return false;
                            }
                          }

                          // Check if phone number matches (prioritize this)
                          const msgPhoneNumber = (m as any).phone_number;
                          if (msgPhoneNumber && (normalizedContactPhone || normalizedContactMobile)) {
                            const normalizedMsgPhone = normalizePhone(msgPhoneNumber);
                            const matchesPhone = normalizedContactPhone && normalizedMsgPhone &&
                              (normalizedMsgPhone === normalizedContactPhone ||
                                normalizedMsgPhone.endsWith(normalizedContactPhone.slice(-8)) ||
                                normalizedContactPhone.endsWith(normalizedMsgPhone.slice(-8)));
                            const matchesMobile = normalizedContactMobile && normalizedMsgPhone &&
                              (normalizedMsgPhone === normalizedContactMobile ||
                                normalizedMsgPhone.endsWith(normalizedContactMobile.slice(-8)) ||
                                normalizedContactMobile.endsWith(normalizedMsgPhone.slice(-8)));

                            if (matchesPhone || matchesMobile) {
                              return true; // Phone matches, include even if contact_id doesn't match
                            }
                          }

                          // Fallback: check if contact_id matches
                          if (m.contact_id === client.contact_id) {
                            return true;
                          }

                          return false;
                        });
                      } else {
                        // For main leads, filter by lead_id but exclude messages with contact_id
                        // (those messages belong to contacts, not the main lead)
                        clientMessages = allMessages.filter(m =>
                          m.lead_id === client.id && !m.contact_id
                        );
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
                          className={`p-3 md:p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${isSelected ? 'bg-green-50 border-l-4 border-l-green-500' : ''
                            }`}
                        >
                          <div className="flex items-center gap-2 md:gap-3">
                            {/* Avatar */}
                            <div className="flex-shrink-0 relative">
                              <div className="w-10 h-10 md:w-12 md:h-12">
                                <WhatsAppAvatar
                                  name={client.name}
                                  profilePictureUrl={client.whatsapp_profile_picture_url}
                                  size="md"
                                  className="w-full h-full"
                                />
                              </div>
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
                                </div>
                                <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
                                  {lastMessage && (
                                    <span className="text-xs text-gray-500">
                                      {formatLastMessageTime(lastMessage.sent_at)}
                                    </span>
                                  )}
                                  {unreadCount > 0 && (
                                    <span className="bg-green-500 text-white text-xs rounded-full px-1 md:px-2 py-1 min-w-[16px] md:min-w-[20px] text-center shadow-[0_4px_12px_rgba(34,197,94,0.35)]">
                                      {unreadCount}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <p className="text-sm md:text-sm text-gray-500 truncate">
                                {client.lead_number}
                              </p>
                              {lastMessage && (
                                <div className="flex items-center gap-1 mt-1">
                                  <p className="text-sm md:text-sm text-gray-600 truncate flex-1">
                                    {lastMessage.direction === 'out' ? `${lastMessage.sender_name}: ` : ''}
                                    {lastMessage.message}
                                  </p>
                                  {lastMessage.direction === 'out' && lastMessage.whatsapp_status && (
                                    <span className="inline-block align-middle flex-shrink-0" style={{ transform: 'scale(0.75)' }}>
                                      {renderMessageStatus(lastMessage)}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {hasMoreClients && (
                      <div className="p-4 text-center">
                        <button
                          onClick={loadMoreClients}
                          className="btn btn-outline btn-sm"
                          style={{ borderColor: '#059669', color: '#059669' }}
                        >
                          Load More ({filteredClients.length - visibleClientsCount} remaining)
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* New Message Button - Fixed at bottom */}
              <div className="flex-none p-3 border-t border-gray-200 bg-white">
                <button
                  onClick={() => setIsNewMessageModalOpen(true)}
                  className="flex items-center gap-3 w-full"
                >
                  <div className="btn btn-circle w-12 h-12 text-white border-none shadow-lg hover:shadow-xl transition-shadow flex-shrink-0" style={{ background: 'linear-gradient(to bottom right, #047857, #0f766e)' }}>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* Right Panel - Chat */}
          <div className={`${isMobile ? 'w-full' : 'flex-1'} flex flex-col bg-white min-h-0 relative ${isMobile && !showChat ? 'hidden' : ''}`} style={isMobile ? { height: '100vh', overflow: 'hidden', position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40 } : { overflow: 'hidden' }}>
            {selectedClient ? (
              <>
                {/* Mobile Chat Header - Only visible on mobile when in chat */}
                {isMobile && (
                  <div className={`flex-none flex flex-col border-b border-gray-200 ${isChatHeaderGlass ? 'bg-white/70 backdrop-blur-md supports-[backdrop-filter]:bg-white/50' : 'bg-white'}`} style={{ zIndex: 40 }}>
                    <div className="flex items-center px-2 py-3 relative">
                      {/* Left Side - Back Button, Avatar, and Name */}
                      <div className="flex items-center gap-2 flex-shrink-0 z-10">
                        {/* Back Button */}
                        <button
                          onClick={() => setShowChat(false)}
                          className="btn btn-ghost btn-circle btn-sm flex-shrink-0"
                          style={{ width: '40px', height: '40px', minWidth: '40px' }}
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>

                        {/* Client Avatar */}
                        <div className="w-8 h-8 rounded-full flex items-center justify-center relative flex-shrink-0 border bg-green-100 border-green-200 text-green-700 shadow-[0_4px_12px_rgba(16,185,129,0.2)]">
                          <span className="font-semibold text-xs">
                            {selectedClient.name.charAt(0).toUpperCase()}
                          </span>
                          {(isLocked || messages.length === 0) && (
                            <div className="absolute -bottom-1 -right-1 bg-red-500 rounded-full p-0.5">
                              <LockClosedIcon className="w-2.5 h-2.5 text-white" />
                            </div>
                          )}
                        </div>

                        {/* Client Name and Lead Number - Clickable */}
                        <div
                          className="min-w-0 cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => handleNavigateToClient(selectedClient)}
                          title="View Client Page"
                        >
                          <h3 className="font-semibold text-gray-900 text-sm truncate">
                            {selectedClient.name}
                          </h3>
                          <p className="text-xs text-gray-500 font-mono truncate">
                            {selectedClient.lead_number}
                          </p>
                        </div>
                      </div>

                      {/* Right Side - Time Left Badge and Close Button */}
                      <div className="flex items-center gap-1 ml-auto flex-shrink-0 z-10">
                        {/* Time Left Badge */}
                        {timeLeft && (
                          <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${isLocked ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                            }`} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                            {isLocked ? (
                              <LockClosedIcon className="w-3 h-3" />
                            ) : (
                              <>
                                <ClockIcon className="w-3 h-3" />
                                <span className="text-xs">{timeLeft}</span>
                              </>
                            )}
                          </div>
                        )}

                        {/* Close Button - Right */}
                        <button
                          onClick={() => {
                            if (onClose) {
                              onClose();
                            } else {
                              window.history.back();
                            }
                          }}
                          className="btn btn-ghost btn-circle btn-sm flex-shrink-0"
                          style={{ width: '40px', height: '40px', minWidth: '40px' }}
                          title="Close"
                        >
                          <XMarkIcon className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Messages - Scrollable */}
                <div ref={chatMessagesRef} onScroll={handleChatMessagesScroll} className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0 overscroll-contain relative" style={isMobile ? { flex: '1 1 auto', paddingBottom: showTemplateSelector ? '300px' : (isLocked ? '280px' : '200px'), WebkitOverflowScrolling: 'touch', overflowX: 'hidden', maxWidth: '100%' } : { paddingBottom: isLocked ? '200px' : '120px', overflowX: 'hidden', maxWidth: '100%' }}>
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
                              <div className="text-sm font-medium px-3 py-1.5 rounded-full border bg-green-100 border-green-200 text-green-700 shadow-[0_4px_12px_rgba(16,185,129,0.2)]">
                                {formatDateSeparator(message.sent_at)}
                              </div>
                            </div>
                          )}

                          <div
                            className={`flex gap-2 ${message.direction === 'out' ? 'flex-row-reverse' : 'flex-row'}`}
                            style={{ maxWidth: '100%', minWidth: 0 }}
                          >
                            <div className={`flex flex-col ${message.direction === 'out' ? 'items-end' : 'items-start'} flex-1`} style={{ maxWidth: '100%', minWidth: 0 }}>
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
                                <div className="flex items-center gap-2 mb-1 ml-2">
                                  <WhatsAppAvatar
                                    name={selectedClient?.name || message.sender_name || 'Client'}
                                    size="sm"
                                  />
                                </div>
                              )}

                              {/* Image or Emoji-only messages - render outside bubble */}
                              {(message.message_type === 'image' || (message.message_type === 'text' && isEmojiOnly(message.message))) ? (
                                <div className={`flex flex-col ${message.direction === 'out' ? 'items-end ml-auto' : 'items-start'} max-w-xs sm:max-w-md`}>
                                  {/* Image content */}
                                  {message.message_type === 'image' && message.media_url && (
                                    <div
                                      className="relative cursor-pointer group"
                                      onClick={() => message.media_url && setSelectedMedia({
                                        url: message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`),
                                        type: 'image',
                                        caption: message.caption
                                      })}
                                    >
                                      <img
                                        src={message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`)}
                                        alt="Image"
                                        className="max-w-full max-h-80 md:max-h-[600px] rounded-lg object-cover transition-transform group-hover:scale-105"
                                        onError={(e) => {
                                          console.log('Failed to load image:', message.media_url);
                                          e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik01MCAxMDAgTDEwMCA1MCBMMTUwIDEwMCBMMTAwIDE1MCBMNTAgMTAwWiIgZmlsbD0iI0QxRDVEMCIvPgo8dGV4dCB4PSIxMDAiIHk9IjExMCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE0IiBmaWxsPSIjNjc3NDhCIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5JbWFnZSBVbmF2YWlsYWJsZTwvdGV4dD4KPC9zdmc+';
                                          e.currentTarget.style.border = '1px solid #e5e7eb';
                                          e.currentTarget.style.borderRadius = '0.5rem';
                                        }}
                                      />
                                      <div className="absolute inset-0 bg-black/20 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                        <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                                        </svg>
                                      </div>
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
                                      className="text-base break-words mt-1"
                                      dir={message.caption?.match(/[\u0590-\u05FF]/) ? 'rtl' : 'ltr'}
                                      style={{
                                        textAlign: message.caption?.match(/[\u0590-\u05FF]/) ? 'right' : 'left',
                                        wordBreak: 'break-word',
                                        overflowWrap: 'break-word',
                                        overflow: 'visible',
                                        maxWidth: '100%',
                                        minWidth: 0,
                                        height: 'auto',
                                        fontWeight: message.caption?.match(/[\u0590-\u05FF]/) ? 600 : undefined,
                                        color: message.direction === 'out' ? 'white' : undefined
                                      }}
                                    >
                                      {renderTextWithLinks(message.caption)}
                                    </p>
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
                                  className={`group ${message.direction === 'out' ? 'max-w-[75%] md:max-w-[35%] lg:max-w-[30%]' : 'max-w-[75%] md:max-w-[70%]'} rounded-2xl px-4 py-1.5 shadow-sm relative ${message.direction === 'out'
                                    ? 'text-white border border-transparent'
                                    : 'bg-white text-gray-900 border border-gray-200'
                                    }`}
                                  style={{
                                    wordBreak: 'break-word',
                                    overflowWrap: 'break-word',
                                    overflow: 'visible',
                                    minWidth: 0,
                                    maxWidth: '100%',
                                    height: 'auto',
                                    ...(message.direction === 'out' ? {
                                      background: 'linear-gradient(to bottom right, #047857, #0f766e)',
                                      borderColor: 'transparent'
                                    } : {})
                                  }}
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
                                      className={`w-full bg-transparent border-none outline-none resize-none overflow-y-auto ${message.direction === 'out'
                                        ? 'text-gray-900 placeholder-gray-500'
                                        : 'text-gray-900 placeholder-gray-500'
                                        }`}
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
                                          className="break-words whitespace-pre-wrap text-base"
                                          dir={message.message?.match(/[\u0590-\u05FF]/) ? 'rtl' : 'ltr'}
                                          style={{
                                            textAlign: message.message?.match(/[\u0590-\u05FF]/) ? 'right' : 'left',
                                            wordBreak: 'break-word',
                                            overflowWrap: 'anywhere',
                                            hyphens: 'auto',
                                            overflow: 'visible',
                                            maxWidth: '100%',
                                            minWidth: 0,
                                            height: 'auto',
                                            fontWeight: message.message?.match(/[\u0590-\u05FF]/) ? 600 : undefined,
                                            color: message.direction === 'out' ? 'white' : undefined
                                          }}
                                        >
                                          {renderTextWithLinks(message.message)}
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
                                          style={{
                                            textAlign: message.caption?.match(/[\u0590-\u05FF]/) ? 'right' : 'left',
                                            wordBreak: 'break-word',
                                            overflowWrap: 'break-word',
                                            overflow: 'visible',
                                            maxWidth: '100%',
                                            minWidth: 0,
                                            height: 'auto',
                                            fontWeight: message.caption?.match(/[\u0590-\u05FF]/) ? 600 : undefined,
                                            color: message.direction === 'out' ? 'white' : undefined
                                          }}
                                        >
                                          {renderTextWithLinks(message.caption)}
                                        </p>
                                      )}
                                    </div>
                                  )}

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
                                        <p
                                          className="text-base break-words mt-2"
                                          style={{
                                            wordBreak: 'break-word',
                                            overflowWrap: 'break-word',
                                            overflow: 'visible',
                                            maxWidth: '100%',
                                            minWidth: 0,
                                            height: 'auto',
                                            fontWeight: message.caption?.match(/[\u0590-\u05FF]/) ? 600 : undefined,
                                            color: message.direction === 'out' ? 'white' : undefined
                                          }}
                                        >
                                          {renderTextWithLinks(message.caption)}
                                        </p>
                                      )}
                                      {!message.caption && message.message && message.message !== 'Voice message' && (
                                        <p
                                          className="text-base break-words mt-2"
                                          style={{
                                            wordBreak: 'break-word',
                                            overflowWrap: 'break-word',
                                            overflow: 'visible',
                                            maxWidth: '100%',
                                            minWidth: 0,
                                            height: 'auto',
                                            fontWeight: message.message?.match(/[\u0590-\u05FF]/) ? 600 : undefined,
                                            color: message.direction === 'out' ? 'white' : undefined
                                          }}
                                        >
                                          {renderTextWithLinks(message.message)}
                                        </p>
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
                                          style={{
                                            textAlign: message.caption?.match(/[\u0590-\u05FF]/) ? 'right' : 'left',
                                            wordBreak: 'break-word',
                                            overflowWrap: 'break-word',
                                            overflow: 'visible',
                                            maxWidth: '100%',
                                            minWidth: 0,
                                            height: 'auto',
                                            fontWeight: message.caption?.match(/[\u0590-\u05FF]/) ? 600 : undefined,
                                            color: message.direction === 'out' ? 'white' : undefined
                                          }}
                                        >
                                          {renderTextWithLinks(message.caption)}
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
                                  <div className="flex items-center justify-between -mt-1">
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
                              )}
                            </div>
                          </div>
                        </React.Fragment>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Message Input - Desktop Only */}
                {!isMobile && (
                  <div className={`absolute ${isMobile ? 'bottom-2' : 'bottom-0'} left-0 right-0 ${isMobile ? 'px-4 pb-2' : 'p-4'} z-[100] pointer-events-none`} style={{ overflow: 'visible' }}>
                    {/* Lock Message - Above input field (or above template modal when open) */}
                    {isLocked && !showTemplateSelector && (
                      <div className="mb-2 pointer-events-auto">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg shadow-md whitespace-nowrap w-fit">
                          <LockClosedIcon className="w-4 h-4 text-red-600 flex-shrink-0" />
                          <span className="text-xs font-medium text-red-700">24-Hours rule - use templates</span>
                        </div>
                      </div>
                    )}
                    <div className="flex items-end gap-3 relative pointer-events-auto" style={{ overflow: 'visible' }}>
                      {/* Consolidated Tools Button */}
                      <div className="relative" ref={desktopToolsRef} style={{ overflow: 'visible' }}>
                        <button
                          onClick={() => setShowDesktopTools(prev => !prev)}
                          disabled={sending || uploadingMedia}
                          className="btn btn-circle w-12 h-12 text-white disabled:opacity-50 shadow-lg hover:shadow-xl transition-shadow"
                          style={{ background: 'linear-gradient(to bottom right, #047857, #0f766e)', borderColor: 'transparent' }}
                          title="Message tools"
                        >
                          <Squares2X2Icon className="w-6 h-6" />
                        </button>

                        {/* Tools Dropdown Menu */}
                        {showDesktopTools && (
                          <div className="absolute left-0 z-[9999] bg-white border border-gray-200 rounded-lg shadow-lg min-w-[180px] pointer-events-auto" style={{ top: 'auto', bottom: 'calc(100% + 8px)' }}>
                            <button
                              onClick={() => {
                                setShowTemplateSelector(!showTemplateSelector);
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
                              disabled={isLoadingAI || isLocked || !selectedClient}
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

                      <div className="relative" style={{ overflow: 'visible' }}>
                        {/* Emoji Picker */}
                        {isEmojiPickerOpen && (
                          <div className="absolute left-0 z-[9999] pointer-events-auto" style={{ top: 'auto', bottom: 'calc(100% + 8px)' }}>
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
                            if (selectedTemplate) return; // Prevent changes when template is selected
                            setNewMessage(e.target.value);
                            const textarea = e.target;
                            textarea.style.height = 'auto';
                            // Use larger max height when template is present
                            const maxHeight = selectedTemplate && selectedTemplate.params === '0' ? 400 : 200;
                            textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
                          }}
                          onKeyDown={(e) => {
                            if (selectedTemplate) return; // Prevent changes when template is selected
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
                          className="textarea w-full resize-none border border-white/30 rounded-2xl focus:border-white/50 focus:outline-none"
                          rows={1}
                          readOnly={!!selectedTemplate}
                          disabled={sending || uploadingMedia || isLocked}
                          style={{
                            backgroundColor: selectedTemplate ? 'rgba(240, 240, 240, 0.9)' : 'rgba(255, 255, 255, 0.8)',
                            backdropFilter: 'blur(10px)',
                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                            maxHeight: selectedTemplate && selectedTemplate.params === '0' ? '400px' : '128px',
                            cursor: selectedTemplate ? 'not-allowed' : 'text',
                            minHeight: isMobile ? '48px' : '44px',
                            ...(isMobile && !newMessage ? { height: '48px' } : {})
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
                              preventDefault: () => { },
                              stopPropagation: () => { },
                              currentTarget: e.currentTarget,
                              target: e.target,
                            } as React.FormEvent;
                            handleSendMessage(syntheticEvent);
                          }
                        }}
                        disabled={(!newMessage.trim() && !selectedTemplate && !selectedFile) || sending || uploadingMedia}
                        className="btn btn-circle w-12 h-12 text-white shadow-lg hover:shadow-xl transition-shadow disabled:opacity-50"
                        style={{ background: 'linear-gradient(to bottom right, #047857, #0f766e)', borderColor: 'transparent' }}
                        title={selectedFile ? 'Send media' : 'Send message'}
                      >
                        {sending || uploadingMedia ? (
                          <div className="loading loading-spinner loading-sm"></div>
                        ) : (
                          <PaperAirplaneIcon className="w-5 h-5" />
                        )}
                      </button>
                    </div>

                    {/* Template Dropdown - Desktop */}
                    {showTemplateSelector && (
                      <div
                        ref={templateSelectorRef}
                        className="absolute bottom-full left-0 right-0 mb-2 pointer-events-auto z-[9999]"
                        style={{
                          overflow: 'visible',
                          maxHeight: 'calc(100vh - 120px)', // Account for header and input area
                          // Ensure it doesn't get cut off at the top on smaller screens
                          transform: 'translateY(0)',
                          top: 'auto',
                          bottom: '100%'
                        }}
                      >
                        {/* Lock Message - Above template modal when open */}
                        {isLocked && (
                          <div className="mb-2 pointer-events-auto">
                            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg shadow-md whitespace-nowrap w-fit">
                              <LockClosedIcon className="w-4 h-4 text-red-600 flex-shrink-0" />
                              <span className="text-xs font-medium text-red-700">24-Hours rule - use templates</span>
                            </div>
                          </div>
                        )}
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
                                      toast.error('This template is pending approval and cannot be used yet. Please wait for Meta to approve it or select an active template.');
                                      return;
                                    }
                                    setSelectedTemplate(template);
                                    setShowTemplateSelector(false);
                                    setTemplateSearchTerm('');
                                    setSelectedLanguage('');
                                    // Always set template content in input field
                                    setNewMessage(template.content || '');

                                    // Expand textarea for desktop when template is inserted
                                    if (textareaRef.current) {
                                      setTimeout(() => {
                                        if (textareaRef.current) {
                                          textareaRef.current.style.height = 'auto';
                                          const maxHeight = 400; // Desktop max height
                                          textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`;
                                        }
                                      }, 0);
                                    }
                                  }}
                                />
                              ))
                              }
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* AI Suggestions Dropdown - Desktop */}
                    {showAISuggestions && (
                      <div className="absolute bottom-full left-0 right-0 mb-2 px-4 pointer-events-auto z-[9999]" style={{ overflow: 'visible' }}>
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
                  </div>
                )}

                {/* Message Input - Mobile Only */}
                {isMobile && (
                  <div className="lg:hidden absolute bottom-0 left-0 right-0 p-3 z-[100] pointer-events-none" style={{ overflow: 'visible' }}>
                    {/* AI Suggestions Dropdown - Mobile */}
                    {showAISuggestions && (
                      <div className="mb-2 pointer-events-auto">
                        <div className="p-3 bg-white/95 backdrop-blur-lg supports-[backdrop-filter]:bg-white/85 rounded-xl border border-gray-200 shadow-lg max-h-[50vh] overflow-y-auto">
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
                    <div className="relative space-y-2 pointer-events-auto" style={{ overflow: 'visible' }}>
                      <div className="flex items-center gap-2">
                        <div className="relative" ref={mobileToolsRef} style={{ overflow: 'visible' }}>
                          <button
                            onClick={() => setShowMobileDropdown(!showMobileDropdown)}
                            className="btn btn-circle w-12 h-12 text-white shadow-lg hover:shadow-xl transition-shadow"
                            style={{ background: 'linear-gradient(to bottom right, #047857, #0f766e)', borderColor: 'transparent' }}
                            title="Message tools"
                          >
                            <Squares2X2Icon className="w-6 h-6" />
                          </button>
                          {showMobileDropdown && (
                            <div className="absolute left-0 z-[9999] bg-white border border-gray-200 rounded-xl shadow-xl w-64 divide-y divide-gray-100 pointer-events-auto" style={{ top: 'auto', bottom: 'calc(100% + 8px)' }}>
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setShowTemplateSelector(true);
                                  setShowMobileDropdown(false);
                                }}
                                className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 flex items-center gap-2"
                              >
                                <DocumentTextIcon className="w-4 h-4 text-green-600" />
                                Template
                              </button>
                              <label className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 flex items-center gap-2 cursor-pointer">
                                <PaperClipIcon className="w-4 h-4 text-gray-600" />
                                Attachment
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
                                  setIsEmojiPickerOpen(!isEmojiPickerOpen);
                                  setShowMobileDropdown(false);
                                }}
                                disabled={isLocked}
                                className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50"
                              >
                                <FaceSmileIcon className="w-4 h-4 text-yellow-500" />
                                Add emojis
                              </button>
                              <button
                                onClick={() => {
                                  handleAISuggestions();
                                  setShowMobileDropdown(false);
                                }}
                                disabled={isLoadingAI || isLocked || !selectedClient}
                                className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50"
                              >
                                {isLoadingAI ? (
                                  <div className="loading loading-spinner loading-xs"></div>
                                ) : (
                                  <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                  </svg>
                                )}
                                AI Suggestions
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="flex-1">
                          <textarea
                            ref={textareaRef}
                            value={newMessage}
                            onChange={(e) => {
                              if (selectedTemplate) return; // Prevent changes when template is selected
                              setNewMessage(e.target.value);
                              const textarea = e.target;
                              textarea.style.height = 'auto';
                              // Use larger max height when template is present
                              const maxHeight = selectedTemplate && selectedTemplate.params === '0' ? 400 : (isInputFocused || aiSuggestions.length > 0 ? 300 : 200);
                              const calculatedHeight = Math.min(textarea.scrollHeight, maxHeight);
                              const minHeight = isMobile ? 48 : 36;
                              textarea.style.height = `${Math.max(calculatedHeight, minHeight)}px`;
                            }}
                            onFocus={(e) => {
                              if (selectedTemplate) return; // Prevent focus changes when template is selected
                              setIsInputFocused(true);
                              e.target.style.height = 'auto';
                              const maxHeight = selectedTemplate && selectedTemplate.params === '0' ? 400 : 300;
                              const calculatedHeight = Math.min(e.target.scrollHeight, maxHeight);
                              const minHeight = isMobile ? 48 : 36;
                              e.target.style.height = `${Math.max(calculatedHeight, minHeight)}px`;
                            }}
                            onBlur={(e) => {
                              setIsInputFocused(false);
                              e.target.style.height = 'auto';
                              const maxHeight = selectedTemplate && selectedTemplate.params === '0' ? 400 : 200;
                              const calculatedHeight = Math.min(e.target.scrollHeight, maxHeight);
                              const minHeight = isMobile ? 48 : 36;
                              e.target.style.height = `${Math.max(calculatedHeight, minHeight)}px`;
                            }}
                            onKeyDown={(e) => {
                              if (selectedTemplate) return; // Prevent changes when template is selected
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
                            className="textarea w-full resize-none text-sm border border-white/30 rounded-2xl focus:border-white/50 focus:outline-none"
                            rows={1}
                            readOnly={!!selectedTemplate}
                            disabled={sending || uploadingMedia || isLocked}
                            style={{
                              lineHeight: '1.4',
                              backgroundColor: selectedTemplate ? 'rgba(240, 240, 240, 0.9)' : 'rgba(255, 255, 255, 0.8)',
                              backdropFilter: 'blur(10px)',
                              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                              maxHeight: selectedTemplate && selectedTemplate.params === '0' ? '400px' : '160px',
                              cursor: selectedTemplate ? 'not-allowed' : 'text',
                              minHeight: isMobile ? '48px' : '36px',
                              height: isMobile && !newMessage && !selectedTemplate ? '48px' : 'auto'
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
                                preventDefault: () => { },
                                stopPropagation: () => { },
                                currentTarget: e.currentTarget,
                                target: e.target,
                              } as React.FormEvent;
                              handleSendMessage(syntheticEvent);
                            }
                          }}
                          disabled={(!newMessage.trim() && !selectedTemplate && !selectedFile) || sending || uploadingMedia}
                          className="btn btn-circle w-12 h-12 text-white shadow-lg hover:shadow-xl transition-shadow disabled:opacity-50"
                          style={{ background: 'linear-gradient(to bottom right, #047857, #0f766e)', borderColor: 'transparent' }}
                          title={selectedFile ? 'Send media' : 'Send message'}
                        >
                          {sending || uploadingMedia ? (
                            <div className="loading loading-spinner loading-sm"></div>
                          ) : (
                            <PaperAirplaneIcon className="w-5 h-5" />
                          )}
                        </button>
                      </div>

                      {/* Mobile Emoji Picker */}
                      {isEmojiPickerOpen && !isLocked && (
                        <div className="absolute left-0 z-[9999] pointer-events-auto" style={{ top: 'auto', bottom: 'calc(100% + 8px)' }}>
                          <EmojiPicker
                            onEmojiClick={handleEmojiClick}
                            width={300}
                            height={350}
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
                  </div>
                )}

                {/* Template Dropdown - Mobile (rendered outside hidden container) */}
                {showTemplateSelector && isMobile && (
                  <div
                    className="fixed inset-0 z-[9999] flex items-end justify-center p-4"
                    onClick={(e) => {
                      // Only close if clicking directly on the backdrop, not on the modal content
                      if (e.target === e.currentTarget) {
                        setShowTemplateSelector(false);
                      }
                    }}
                  >
                    {/* Backdrop */}
                    <div
                      className="fixed inset-0 bg-black/50 z-[9998]"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowTemplateSelector(false);
                      }}
                    />
                    <div
                      ref={templateSelectorRef}
                      className="relative z-[9999] w-full max-w-md h-[90vh] overflow-hidden pointer-events-auto flex flex-col rounded-t-2xl shadow-2xl"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Prevent clicks inside modal from closing anything
                      }}
                    >
                      <div className="bg-white h-full flex flex-col overflow-hidden rounded-t-2xl">
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
                                e.nativeEvent.stopImmediatePropagation();
                                setShowTemplateSelector(false);
                              }}
                              className="btn btn-ghost btn-xs text-white hover:bg-white/20 rounded-full p-1.5 z-50 relative"
                              aria-label="Close template selector"
                            >
                              <XMarkIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Content */}
                        <div className="p-4 flex-1 flex flex-col min-h-0 overflow-hidden">
                          {/* Search Input */}
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

                          {/* Templates List */}
                          <div className="space-y-3 flex-1 overflow-y-auto">
                            {isLoadingTemplates ? (
                              <div className="text-center text-gray-500 py-4">
                                <div className="loading loading-spinner loading-sm"></div>
                                <span className="ml-2">Loading...</span>
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
                                  // Always set template content in input field
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
                                }}
                              />
                            ))
                            }
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}


                {/* Voice Recorder */}
                {showVoiceRecorder && (
                  <div className={`w-full mb-2 ${isMobile ? 'p-3' : 'px-4 pb-2'}`}>
                    <VoiceMessageRecorder
                      onRecorded={(audioBlob) => {
                        // Convert blob to File and set as selectedFile
                        // Use the MIME type from the recorder (should be audio/ogg if supported)
                        const mimeType = audioBlob.type || 'audio/webm;codecs=opus';
                        const extension = mimeType.includes('ogg') ? 'ogg' : 'webm';
                        const audioFile = new File([audioBlob], `voice_${Date.now()}.${extension}`, { type: mimeType });

                        // Set as selectedFile so the regular send button can handle it
                        setSelectedFile(audioFile);

                        // Close the recorder UI
                        setShowVoiceRecorder(false);
                      }}
                      onCancel={() => setShowVoiceRecorder(false)}
                    />
                  </div>
                )}

                {/* Selected file preview */}
                {selectedFile && (
                  <div className={`flex items-center gap-2 bg-gray-100/80 backdrop-blur-md rounded-lg px-3 py-1 border border-gray-300/50 ${isMobile ? 'mx-3 mb-2' : 'mx-4 mb-2'}`}>
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
        <div className="fixed inset-0 z-[10005] bg-black bg-opacity-90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative w-full h-full flex items-center justify-center" onClick={() => setSelectedMedia(null)}>
            {/* Close button */}
            <button
              onClick={() => setSelectedMedia(null)}
              className="absolute top-4 right-4 z-[10006] btn btn-circle btn-ghost bg-black bg-opacity-50 text-white hover:bg-opacity-70 transition-all duration-200"
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
              className="absolute top-4 left-4 z-[10006] btn btn-circle btn-ghost bg-black bg-opacity-50 text-white hover:bg-opacity-70 transition-all duration-200"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </button>

            {/* Delete button */}
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="absolute top-4 left-20 z-[10006] btn btn-circle btn-ghost bg-black bg-opacity-50 text-white hover:bg-opacity-70 transition-all duration-200"
              title="Delete"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>

            {showDeleteConfirm && (
              <div className="fixed inset-0 z-[10007] flex items-center justify-center bg-black bg-opacity-60">
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
        <div className="fixed inset-0 z-[10007] flex items-center justify-center bg-black bg-opacity-60">
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
                  masterSearchResultsRef.current = [];
                  previousSearchQueryRef.current = '';
                  previousRawSearchValueRef.current = '';
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
                          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 border bg-green-100 border-green-200 text-green-700 shadow-[0_4px_12px_rgba(16,185,129,0.2)]">
                            <span className="font-semibold">
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