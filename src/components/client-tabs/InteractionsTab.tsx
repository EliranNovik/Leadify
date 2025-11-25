import React, { useState, useEffect, useCallback, Fragment, useMemo } from 'react';
import { ClientTabProps, ClientInteractionsCache } from '../../types/client';
import TimelineHistoryButtons from './TimelineHistoryButtons';
import EmojiPicker from 'emoji-picker-react';
import {
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
  PhoneIcon,
  ArrowUturnRightIcon,
  ArrowUturnLeftIcon,
  PencilSquareIcon,
  PaperClipIcon,
  XMarkIcon,
  UserIcon,
  PaperAirplaneIcon,
  FaceSmileIcon,
  ChevronDownIcon,
  SparklesIcon,
  ExclamationTriangleIcon,
  PlayIcon,
  StopIcon,
  SpeakerWaveIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import { supabase } from '../../lib/supabase';
import { toast } from 'react-hot-toast';
import { createPortal } from 'react-dom';
import AISummaryPanel from './AISummaryPanel';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import sanitizeHtml from 'sanitize-html';
import { buildApiUrl } from '../../lib/api';
import { fetchLegacyInteractions } from '../../lib/legacyInteractionsApi';
import { appendEmailSignature } from '../../lib/emailSignature';
import SchedulerWhatsAppModal from '../SchedulerWhatsAppModal';
import ContactSelectorModal from '../ContactSelectorModal';
import EmailThreadModal from '../EmailThreadModal';
import { stripSignatureAndQuotedTextPreserveHtml } from '../../lib/graphEmailSync';
import {
  sendEmailViaBackend,
  triggerMailboxSync,
  fetchEmailBodyFromBackend,
  downloadAttachmentFromBackend,
  getMailboxLoginUrl,
  getMailboxStatus,
} from '../../lib/mailboxApi';
import { useAuthContext } from '../../contexts/AuthContext';
import { fetchLeadContacts } from '../../lib/contactHelpers';
import type { ContactInfo } from '../../lib/contactHelpers';
import { fetchWhatsAppTemplates, type WhatsAppTemplate } from '../../lib/whatsappTemplates';

const normalizeEmailForFilter = (value?: string | null) =>
  value ? value.trim().toLowerCase() : '';

const sanitizeEmailForFilter = (value: string) =>
  value.replace(/[^a-z0-9@._+!~-]/g, '');

// Helper function to detect Hebrew/RTL characters
const containsRTL = (text?: string | null) => !!text && /[\u0590-\u05FF]/.test(text);

// Helper function to get text direction based on content
const getTextDirection = (text?: string | null) => containsRTL(text) ? 'rtl' : 'ltr';

const collectClientEmails = (client: any): string[] => {
  const emails: string[] = [];
  const pushEmail = (val?: string | null) => {
    const normalized = normalizeEmailForFilter(val);
    if (normalized) {
      emails.push(normalized);
    }
  };

  pushEmail(client?.email);

  const extraEmails = (client as any)?.emails;
  if (Array.isArray(extraEmails)) {
    extraEmails.forEach((entry: any) => {
      if (typeof entry === 'string') {
        pushEmail(entry);
      } else if (entry && typeof entry === 'object') {
        if (typeof entry.email === 'string') {
          pushEmail(entry.email);
        }
        if (typeof entry.value === 'string') {
          pushEmail(entry.value);
        }
        if (typeof entry.address === 'string') {
          pushEmail(entry.address);
        }
      }
    });
  }

  return Array.from(new Set(emails));
};

const buildEmailFilterClauses = (params: {
  clientId?: string | null;
  legacyId?: number | null;
  emails: string[];
}) => {
  const clauses: string[] = [];

  if (params.legacyId !== undefined && params.legacyId !== null && !Number.isNaN(params.legacyId)) {
    clauses.push(`legacy_id.eq.${params.legacyId}`);
  }

  if (params.clientId) {
    clauses.push(`client_id.eq.${params.clientId}`);
  }

  params.emails.forEach((email) => {
    const sanitized = sanitizeEmailForFilter(email);
    if (sanitized) {
      clauses.push(`sender_email.ilike.${sanitized}`);
      clauses.push(`recipient_list.ilike.%${sanitized}%`);
    }
  });

  return clauses;
};

interface Attachment {
  id: string;
  name: string;
  contentType: string;
  sizeInBytes: number;
  isInline: boolean;
  contentUrl?: string; // For download
}

interface CallLog {
  id: number;
  cdate: string;
  udate?: string;
  direction?: string;
  date?: string;
  time?: string;
  source?: string;
  incomingdid?: string;
  destination?: string;
  status?: string;
  url?: string;
  call_id?: string;
  action?: string;
  duration?: number;
  lead_id?: number;
  lead_interaction_id?: number;
  employee_id?: number;
}

interface Interaction {
  id: string | number;
  date: string;
  time: string;
  raw_date: string;
  employee: string;
  direction: 'in' | 'out';
  kind: string;
  length: string;
  content: string;
  observation: string;
  editable: boolean;
  status?: string;
  subject?: string;
  error_message?: string; // Add error message field for WhatsApp failures
  call_log?: CallLog; // Add call log data for call interactions
  recording_url?: string; // Add recording URL for call interactions
  call_duration?: number; // Add call duration for call interactions
  body_html?: string | null;
  body_preview?: string | null;
  renderedContent?: string;
  renderedContentFallback?: string;
  contact_id?: number | null; // Contact ID for email and WhatsApp interactions
  sender_email?: string | null; // Sender email for email interactions
  recipient_list?: string | null; // Recipient list for email interactions
  phone_number?: string | null; // Phone number for WhatsApp interactions
}

interface EmailTemplate {
  id: number;
  name: string;
  subject: string | null;
  content: string;
  rawContent: string;
  languageId: string | null;
}

const contactMethods = [
  { value: 'email', label: 'E-mail' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'call', label: 'Call' },
  { value: 'call_log', label: 'Call Log' },
  { value: 'sms', label: 'SMS' },
  { value: 'office', label: 'In Office' },
];

const extractHtmlBody = (html: string) => {
  if (!html) return html;
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : html;
};

const parseTemplateContent = (rawContent: string | null | undefined): string => {
  if (!rawContent) return '';

  const sanitizeTemplateText = (text: string) => {
    if (!text) return '';

    return text
      .split('\n')
      .map(line => line.replace(/\s+$/g, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  };

  const tryParseDelta = (input: string) => {
    try {
      const parsed = JSON.parse(input);
      const ops = parsed?.delta?.ops || parsed?.ops;
      if (Array.isArray(ops)) {
        const text = ops
          .map((op: any) => (typeof op?.insert === 'string' ? op.insert : ''))
          .join('');
        return sanitizeTemplateText(text);
      }
    } catch (error) {
      // ignore
    }
    return null;
  };

  const cleanHtml = (input: string) => {
    let text = input;

    const htmlMatch = text.match(/html\s*:\s*(.*)/is);
    if (htmlMatch) {
      text = htmlMatch[1];
    }

    text = text
      .replace(/^{?delta\s*:\s*\{.*?\},?/is, '')
      .replace(/^{|}$/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\r/g, '')
      .replace(/\\/g, '\\');

    return sanitizeTemplateText(text);
  };

  let text = tryParseDelta(rawContent);
  if (text !== null) {
    return text;
  }

  text = tryParseDelta(
    rawContent
      .replace(/^"|"$/g, '')
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
  );
  if (text !== null) {
    return text;
  }

  const normalised = rawContent
    .replace(/\\"/g, '"')
    .replace(/\r/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
  const insertRegex = /"?insert"?\s*:\s*"([^"\n]*)"/g;
  const inserts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = insertRegex.exec(normalised))) {
    inserts.push(match[1]);
  }
  if (inserts.length > 0) {
    const combined = inserts.join('');
    const decoded = combined.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    return sanitizeTemplateText(decoded);
  }

  return sanitizeTemplateText(cleanHtml(rawContent));
};

const normaliseAddressList = (value: string | null | undefined) => {
  if (!value) return [] as string[];
  return value
    .split(/[;,]+/)
    .map(item => item.trim())
    .filter(item => item.length > 0);
};

const convertBodyToHtml = (text: string) => {
  if (!text) return '';
  // First, protect existing anchor tags by replacing them with placeholders
  const anchorPlaceholders: string[] = [];
  let placeholderIndex = 0;
  const anchorRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
  const textWithPlaceholders = text.replace(anchorRegex, (match) => {
    anchorPlaceholders.push(match);
    return `__ANCHOR_PLACEHOLDER_${placeholderIndex++}__`;
  });
  
  // Convert plain URLs to links (but skip those already in anchor tags)
  const urlRegex = /(https?:\/\/[^\s<>]+)/gi;
  const escaped = textWithPlaceholders.replace(urlRegex, url => {
    const safeUrl = url.replace(/"/g, '&quot;');
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
  
  // Restore original anchor tags
  let result = escaped;
  anchorPlaceholders.forEach((anchor, index) => {
    result = result.replace(`__ANCHOR_PLACEHOLDER_${index}__`, anchor);
  });
  
  return result.replace(/\n/g, '<br>');
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const replaceTemplateTokens = (content: string, client: any) => {
  if (!content) return '';
  return content
    .replace(/\{client_name\}/gi, client?.name || 'Client')
    .replace(/\{lead_number\}/gi, client?.lead_number || '')
    .replace(/\{topic\}/gi, client?.topic || '')
    .replace(/\{closer_name\}/gi, client?.closer || '')
    .replace(/\{lead_type\}/gi, client?.lead_type || '');
};

const emailTemplates = [
  {
    name: 'Document Reminder',
    subject: 'Reminder: Required Documents for Your Application',
    body: `Dear {client_name},\n\nAs part of your application process, we kindly remind you to upload the required documents to your client portal.\n\nThis will help us proceed without delays. If you need assistance or are unsure which documents are still needed, please contact us.\n\nYou can upload documents here: {upload_link}\n\nThank you for your cooperation.`,
  },
  {
    name: 'Application Submission Confirmation',
    subject: 'Confirmation: Your Application Has Been Submitted',
    body: `Dear {client_name},\n\nWe're pleased to inform you that your application has been successfully submitted to the relevant authorities.\n\nYou will be notified once there are any updates or additional requirements. Please note that processing times may vary depending on the case.\n\nIf you have any questions or wish to discuss the next steps, feel free to contact your case manager.`,
  },
];

// Helper to get current user's full name from Supabase
// Join users.employee_id with tenants_employee.id to get display_name
async function fetchCurrentUserFullName() {
  const { data: { user } } = await supabase.auth.getUser();
  if (user && user.id) {
    const { data, error } = await supabase
      .from('users')
      .select(`
        full_name,
        employee_id,
        tenants_employee!employee_id(
          display_name
        )
      `)
      .eq('auth_id', user.id)
      .single();
    if (!error && data) {
      // Return display_name from tenants_employee if available, otherwise full_name
      const employee = Array.isArray(data.tenants_employee) ? data.tenants_employee[0] : data.tenants_employee;
      return employee?.display_name || data.full_name;
    }
  }
  return null;
}

// Utility to sanitize email HTML for modal view
function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'b', 'i', 'u', 'ul', 'ol', 'li', 'br', 'strong', 'em', 'a'
    ],
    allowedAttributes: {
      'a': ['href', 'target', 'rel']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard',
    allowedStyles: {},
  });
}

const FETCH_BATCH_SIZE = 500;
const EMAIL_MODAL_LIMIT = 200;

const InteractionsTab: React.FC<ClientTabProps> = ({
  client,
  onClientUpdate,
  interactionsCache,
  onInteractionsCacheUpdate,
  onInteractionCountUpdate,
}) => {
  if (!client) {
    return <div className="flex justify-center items-center h-32"><span className="loading loading-spinner loading-md text-primary"></span></div>;
  }
  
  // Determine if this is a legacy lead
  const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
  
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [editIndex, setEditIndex] = useState<number|null>(null);
  const [editData, setEditData] = useState({ date: '', time: '', content: '', observation: '', length: '' });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [contactDrawerOpen, setContactDrawerOpen] = useState(false);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [newContact, setNewContact] = useState({
    method: 'email',
    date: '',
    time: '',
    length: '',
    content: '',
    observation: '',
  });
  const { user } = useAuthContext();
  const userId = user?.id ?? null;
  const userEmail = user?.email ?? null;
  const [mailboxStatus, setMailboxStatus] = useState<{ connected: boolean; mailbox?: string | null; lastSyncedAt?: string | null }>({
    connected: false,
    mailbox: null,
    lastSyncedAt: null,
  });
  const [isMailboxLoading, setIsMailboxLoading] = useState(false);
  const [mailboxError, setMailboxError] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [emails, setEmails] = useState<any[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [emailSearchQuery, setEmailSearchQuery] = useState('');
  const [interactionsLoading, setInteractionsLoading] = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeToRecipients, setComposeToRecipients] = useState<string[]>([]);
  const [composeCcRecipients, setComposeCcRecipients] = useState<string[]>([]);
  const [composeToInput, setComposeToInput] = useState('');
  const [composeCcInput, setComposeCcInput] = useState('');
  const [composeRecipientError, setComposeRecipientError] = useState<string | null>(null);
  
  // State for lead contacts (all contacts associated with the client)
  const [leadContacts, setLeadContacts] = useState<ContactInfo[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);
  const [showComposeLinkForm, setShowComposeLinkForm] = useState(false);
  const [composeLinkLabel, setComposeLinkLabel] = useState('');
  const [composeLinkUrl, setComposeLinkUrl] = useState('');
  const [composeTemplates, setComposeTemplates] = useState<EmailTemplate[]>([]);
  const [composeTemplateSearch, setComposeTemplateSearch] = useState('');
  const [composeTemplateDropdownOpen, setComposeTemplateDropdownOpen] = useState(false);
  const [selectedComposeTemplateId, setSelectedComposeTemplateId] = useState<number | null>(null);
  const composeTemplateDropdownRef = useRef<HTMLDivElement | null>(null);
  const [sending, setSending] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [composeAttachments, setComposeAttachments] = useState<{ name: string; contentType: string; contentBytes: string }[]>([]);
  const [downloadingAttachments, setDownloadingAttachments] = useState<Record<string, boolean>>({});
  const [activeEmailId, setActiveEmailId] = useState<string | null>(null);
  const [activeInteraction, setActiveInteraction] = useState<Interaction | null>(null);
  const [detailsDrawerOpen, setDetailsDrawerOpen] = useState(false);
  const [isWhatsAppOpen, setIsWhatsAppOpen] = useState(false);
  const [showContactSelector, setShowContactSelector] = useState(false);
  const [showContactSelectorForEmail, setShowContactSelectorForEmail] = useState(false);
  const [selectedContactForWhatsApp, setSelectedContactForWhatsApp] = useState<{
    contact: ContactInfo;
    leadId: string | number;
    leadType: 'legacy' | 'new';
  } | null>(null);
  // Use a ref to store the contact immediately (before state updates)
  const selectedContactForWhatsAppRef = useRef<{
    contact: ContactInfo;
    leadId: string | number;
    leadType: 'legacy' | 'new';
  } | null>(null);
  const [selectedContactForEmail, setSelectedContactForEmail] = useState<{
    contact: ContactInfo;
    leadId: string | number;
    leadType: 'legacy' | 'new';
  } | null>(null);
  const [whatsAppInput, setWhatsAppInput] = useState("");
  const [currentUserFullName, setCurrentUserFullName] = useState<string | null>(null);
  const userFullNameLoadedRef = useRef(false);
  const [bodyFocused, setBodyFocused] = useState(false);
  const [footerHeight, setFooterHeight] = useState(72);
  const [composeOverlayOpen, setComposeOverlayOpen] = useState(false);
  const quillRef = useRef<ReactQuill>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeWhatsAppId, setActiveWhatsAppId] = useState<string | null>(null);
  const [selectedMedia, setSelectedMedia] = useState<{url: string, type: 'image' | 'video', caption?: string} | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  // AI suggestions state for email compose
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [showAISuggestions, setShowAISuggestions] = useState(false);
  const formattedLastSync = useMemo(() => {
    if (!mailboxStatus.lastSyncedAt) return null;
    try {
      return new Date(mailboxStatus.lastSyncedAt).toLocaleString();
    } catch (error) {
      return null;
    }
  }, [mailboxStatus.lastSyncedAt]);

  const refreshMailboxStatus = useCallback(async () => {
    if (!userId) {
      setMailboxStatus({ connected: false, mailbox: null, lastSyncedAt: null });
      return;
    }
    try {
      setIsMailboxLoading(true);
      setMailboxError(null);
      const status = await getMailboxStatus(userId);
      setMailboxStatus({
        connected: Boolean(status?.connected),
        mailbox: status?.mailbox || status?.displayName || null,
        lastSyncedAt: status?.lastSyncedAt || status?.last_synced_at || null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load mailbox status';
      setMailboxError(message);
      console.error('Mailbox status error:', error);
    } finally {
      setIsMailboxLoading(false);
    }
  }, [userId]);

  const mailboxStatusRequestedRef = useRef(false);
  const isMountedRef = useRef(true);
  useEffect(() => {
    // Reset to true on mount
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('msal') === 'success') {
      const connectedMailbox = params.get('mailbox');
      toast.success(connectedMailbox ? `Mailbox ${connectedMailbox} connected` : 'Mailbox connected');
      params.delete('msal');
      params.delete('mailbox');
      const newSearch = params.toString();
      const newUrl = `${location.pathname}${newSearch ? `?${newSearch}` : ''}`;
      window.history.replaceState({}, '', newUrl);
      mailboxStatusRequestedRef.current = false;
      refreshMailboxStatus();
    }
  }, [location.pathname, location.search, refreshMailboxStatus]);

  const handleMailboxConnect = useCallback(async () => {
    if (!userId) {
      toast.error('Please sign in to connect your mailbox.');
      return;
    }
    try {
      setIsMailboxLoading(true);
      const redirectTo = `${window.location.origin}${location.pathname}${location.search}`;
      const url = await getMailboxLoginUrl(userId, redirectTo);
      const popup = window.open(url, '_blank', 'width=640,height=780');
      if (!popup) {
        window.location.href = url;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to initiate mailbox connection';
      toast.error(message);
      console.error('Mailbox connect error:', error);
    } finally {
      setIsMailboxLoading(false);
    }
  }, [userId, location.pathname]);

  const filteredComposeTemplates = useMemo(() => {
    const query = composeTemplateSearch.trim().toLowerCase();
    if (!query) return composeTemplates;
    return composeTemplates.filter(template => template.name.toLowerCase().includes(query));
  }, [composeTemplates, composeTemplateSearch]);

  const pushComposeRecipient = (list: string[], address: string) => {
    const normalized = address.trim();
    if (!normalized) return;
    if (!emailRegex.test(normalized)) {
      throw new Error('Please enter a valid email address.');
    }
    if (!list.some(item => item.toLowerCase() === normalized.toLowerCase())) {
      list.push(normalized);
    }
  };

  const addComposeRecipient = (type: 'to' | 'cc', rawValue: string) => {
    const value = rawValue.trim().replace(/[;,]+$/, '');
    if (!value) return;
    try {
      if (type === 'to') {
        const updated = [...composeToRecipients];
        pushComposeRecipient(updated, value);
        setComposeToRecipients(updated);
        setComposeToInput('');
      } else {
        const updated = [...composeCcRecipients];
        pushComposeRecipient(updated, value);
        setComposeCcRecipients(updated);
        setComposeCcInput('');
      }
      setComposeRecipientError(null);
    } catch (error) {
      setComposeRecipientError((error as Error).message);
    }
  };

  const removeComposeRecipient = (type: 'to' | 'cc', email: string) => {
    if (type === 'to') {
      setComposeToRecipients(prev => prev.filter(item => item !== email));
    } else {
      setComposeCcRecipients(prev => prev.filter(item => item !== email));
    }
  };

  const handleComposeRecipientKeyDown = (type: 'to' | 'cc') => (event: React.KeyboardEvent<HTMLInputElement>) => {
    const value = type === 'to' ? composeToInput : composeCcInput;
    const keys = ['Enter', ',', ';'];
    if (keys.includes(event.key)) {
      event.preventDefault();
      if (value.trim()) {
        addComposeRecipient(type, value);
      }
    } else if (event.key === 'Backspace' && !value) {
      if (type === 'to' && composeToRecipients.length > 0) {
        setComposeToRecipients(prev => prev.slice(0, -1));
      }
      if (type === 'cc' && composeCcRecipients.length > 0) {
        setComposeCcRecipients(prev => prev.slice(0, -1));
      }
    }
  };

  const renderComposeRecipients = (type: 'to' | 'cc') => {
    const items = type === 'to' ? composeToRecipients : composeCcRecipients;
    const value = type === 'to' ? composeToInput : composeCcInput;
    const setValue = type === 'to' ? setComposeToInput : setComposeCcInput;
    const placeholder = type === 'to' ? 'Add recipient and press Enter' : 'Add CC and press Enter';

    return (
      <div className="border border-base-300 rounded-lg px-3 py-2 flex flex-wrap gap-2">
        {items.map(email => (
          <span key={`${type}-${email}`} className="bg-primary/10 text-primary px-2 py-1 rounded-full text-sm flex items-center gap-1">
            {email}
            <button
              type="button"
              onClick={() => removeComposeRecipient(type, email)}
              className="text-primary hover:text-primary-focus"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[160px] outline-none bg-transparent"
          value={value}
          onChange={event => {
            setValue(event.target.value);
            if (composeRecipientError) {
              setComposeRecipientError(null);
            }
          }}
          onKeyDown={handleComposeRecipientKeyDown(type)}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="btn btn-xs btn-outline"
          onClick={() => addComposeRecipient(type, value)}
          disabled={!value.trim()}
        >
          <PlusIcon className="w-3 h-3" />
        </button>
      </div>
    );
  };

  const normaliseUrl = (value: string) => {
    if (!value) return '';
    let url = value.trim();
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }
    try {
      const parsed = new URL(url);
      return parsed.toString();
    } catch (error) {
      return '';
    }
  };

  const handleCancelComposeLink = () => {
    setShowComposeLinkForm(false);
    setComposeLinkLabel('');
    setComposeLinkUrl('');
  };

  const handleInsertComposeLink = () => {
    const formattedUrl = normaliseUrl(composeLinkUrl);
    if (!formattedUrl) {
      toast.error('Please provide a valid URL (including the domain).');
      return;
    }

    const label = composeLinkLabel.trim();
    setComposeBody(prev => {
      const existing = prev || '';
      const trimmedExisting = existing.replace(/\s*$/, '');
      // If label is provided, create HTML anchor tag with label as clickable text
      // If no label, just use the URL (convertBodyToHtml will make it clickable)
      const linkLine = label 
        ? `<a href="${formattedUrl.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer">${label}</a>`
        : formattedUrl;
      return trimmedExisting ? `${trimmedExisting}\n\n${linkLine}` : linkLine;
    });

    handleCancelComposeLink();
  };

  const handleComposeTemplateSelect = (template: EmailTemplate) => {
    setSelectedComposeTemplateId(template.id);
    const templatedBody = replaceTemplateTokens(template.content, client);
    if (template.subject && template.subject.trim()) {
      setComposeSubject(replaceTemplateTokens(template.subject, client));
    }
    setComposeBody(templatedBody || template.content || template.rawContent);
    setComposeTemplateSearch(template.name);
    setComposeTemplateDropdownOpen(false);
  };

  // Debug selectedFile state changes
  useEffect(() => {
    console.log('📁 selectedFile state changed:', selectedFile);
  }, [selectedFile]);
  const [showAiSummary, setShowAiSummary] = useState(false);
  const lastEmailRef = useRef<HTMLDivElement>(null);
  // 1. Add state for WhatsApp messages from DB
  const [whatsAppMessages, setWhatsAppMessages] = useState<any[]>([]);
  
  // WhatsApp templates state
  const [whatsAppTemplates, setWhatsAppTemplates] = useState<WhatsAppTemplate[]>([]);
  
  // Emoji picker state
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  
  // Audio playback state for call recordings
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioRef, setAudioRef] = useState<HTMLAudioElement | null>(null);

  // Audio playback functions
  const handlePlayRecording = async (recordingUrl: string, callId: string) => {
    let hasShownError = false; // Flag to prevent duplicate toast notifications
    
    try {
      
      // Stop current audio if playing
      if (audioRef && !audioRef.paused) {
        audioRef.pause();
        audioRef.currentTime = 0;
      }

      // Validate and clean the recording URL
      let cleanUrl = recordingUrl;
      
      // Check if URL is absolute (handle both encoded and unencoded URLs)
      let decodedUrl = recordingUrl;
      try {
        // Try to decode the URL first
        decodedUrl = decodeURIComponent(recordingUrl);
      } catch (error) {
        // If decoding fails, use the original URL
        decodedUrl = recordingUrl;
      }
      const isAbsolute = decodedUrl.startsWith('http://') || decodedUrl.startsWith('https://');
      
      if (!isAbsolute) {
        console.error('Invalid recording URL:', recordingUrl);
        toast.error('Invalid recording URL');
        return;
      }

      // For 1com URLs, extract call ID and use our proxy endpoint
      if (decodedUrl.includes('pbx6webserver.1com.co.il')) {
        try {
          // Extract call ID from the URL
          const urlParams = new URL(decodedUrl).searchParams;
          const callId = urlParams.get('id');
          const tenant = urlParams.get('tenant');
          
          if (!callId) {
            console.error('Could not extract call ID from URL:', decodedUrl);
            toast.error('Invalid recording URL format');
            return;
          }
          
          // Use our backend proxy to avoid CORS issues
          const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
          cleanUrl = `${backendUrl}/api/call-recording/${callId}${tenant ? `?tenant=${tenant}` : ''}`;
        } catch (error) {
          console.error('Error parsing 1com URL:', error);
          toast.error('Failed to parse recording URL');
          return;
        }
      }

      // First, check if this is a 2024 recording that might not be available
      const isOldRecording = callId.startsWith('pbx24-') || decodedUrl.includes('pbx24-');
      if (isOldRecording) {
        // Make a GET request to check if the recording is available
        try {
          const checkResponse = await fetch(cleanUrl);
          if (!checkResponse.ok) {
            const errorData = await checkResponse.json().catch(() => null);
            if (errorData?.isOldRecording) {
              if (!hasShownError) {
                hasShownError = true;
                toast.error('This recording is from 2024 and may no longer be accessible. 1com typically archives older recordings.');
              }
              return;
            }
          } else {
            // Check if the response is actually audio
            const contentType = checkResponse.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
              // The backend returned JSON instead of audio, likely an error
              const errorData = await checkResponse.json().catch(() => null);
              if (errorData?.isOldRecording) {
                if (!hasShownError) {
                  hasShownError = true;
                  toast.error('This recording is from 2024 and may no longer be accessible. 1com typically archives older recordings.');
                }
                return;
              }
            }
          }
        } catch (checkError) {
          // Continue with normal playback attempt
        }
      }

      // Create new audio element
      const audio = new Audio(cleanUrl);
      setAudioRef(audio);
      setPlayingAudioId(callId);

      audio.onended = () => {
        setPlayingAudioId(null);
        setAudioRef(null);
      };

      audio.onerror = (error) => {
        console.error('Audio playback error:', error);
        console.error('Failed URL:', cleanUrl);
        if (!hasShownError) {
          hasShownError = true;
          // Check if this is a 2024 recording for a more specific error message
          if (isOldRecording) {
            toast.error('This recording is from 2024 and may no longer be accessible. 1com typically archives older recordings.');
          } else {
            toast.error('Recording is not available');
          }
        }
        setPlayingAudioId(null);
        setAudioRef(null);
      };


      await audio.play();
    } catch (error) {
      console.error('Error playing recording:', error);
      if (!hasShownError) {
        hasShownError = true;
        toast.error('Recording is not available');
      }
      setPlayingAudioId(null);
      setAudioRef(null);
    }
  };

  const handleStopRecording = () => {
    if (audioRef && !audioRef.paused) {
      audioRef.pause();
      audioRef.currentTime = 0;
    }
    setPlayingAudioId(null);
    setAudioRef(null);
  };
  // Add state for WhatsApp error messages
  const [whatsAppError, setWhatsAppError] = useState<string | null>(null);
  
  // Debug: Log when whatsAppError changes
  useEffect(() => {
    console.log('🔍 WhatsApp error state changed:', whatsAppError);
  }, [whatsAppError]);

  // Find the index of the last email in the sorted interactions - memoized to prevent recalculation
  const INITIAL_VISIBLE_INTERACTIONS = 20;
  const [visibleInteractionsCount, setVisibleInteractionsCount] = useState(INITIAL_VISIBLE_INTERACTIONS);

  const sortedInteractions = useMemo(
    () => [...interactions].sort((a, b) => new Date(b.raw_date).getTime() - new Date(a.raw_date).getTime()),
    [interactions]
  );

  useEffect(() => {
    const nextCount = client.id
      ? Math.min(INITIAL_VISIBLE_INTERACTIONS, sortedInteractions.length || 0)
      : INITIAL_VISIBLE_INTERACTIONS;
    setVisibleInteractionsCount(nextCount);
  }, [client.id, sortedInteractions.length]);

  const visibleInteractions = useMemo(
    () => sortedInteractions.slice(0, visibleInteractionsCount),
    [sortedInteractions, visibleInteractionsCount]
  );
  const hasMoreInteractions = sortedInteractions.length > visibleInteractionsCount;
  const renderedInteractions = useMemo(
    () =>
      visibleInteractions.map((row) => {
        // Process WhatsApp messages with templates
        if (row.kind === 'whatsapp' && row.direction === 'out' && whatsAppTemplates.length > 0) {
          let processedContent = row.content || '';
          
          // PRIORITY 1: Match by template_id if available (most reliable)
          const templateId = (row as any).template_id;
          if (templateId) {
            const templateIdNum = Number(templateId);
            const template = whatsAppTemplates.find(t => Number(t.id) === templateIdNum);
            if (template) {
              if (template.params === '0' && template.content) {
                processedContent = template.content;
              } else if (template.params === '1') {
                const paramMatch = row.content?.match(/\[Template:.*?\]\s*(.+)/);
                if (paramMatch && paramMatch[1].trim()) {
                  processedContent = paramMatch[1].trim();
                } else {
                  processedContent = template.content || processedContent;
                }
              }
              return { ...row, content: processedContent };
            }
          }
          
          // PRIORITY 2: Fallback to name matching for backward compatibility
          if (processedContent.includes('[Template:') || processedContent.includes('Template:') || processedContent.includes('TEMPLATE_MARKER:')) {
            const templateMatch = processedContent.match(/\[Template:\s*([^\]]+)\]/) || 
                                  processedContent.match(/Template:\s*(.+)/) ||
                                  processedContent.match(/TEMPLATE_MARKER:(.+)/);
            
            if (templateMatch) {
              const templateTitle = templateMatch[1].trim().replace(/\]$/, '');
              const template = whatsAppTemplates.find(t => 
                t.title.toLowerCase() === templateTitle.toLowerCase() ||
                (t.name360 && t.name360.toLowerCase() === templateTitle.toLowerCase())
              );
              
              if (template) {
                if (template.params === '0' && template.content) {
                  processedContent = template.content;
                } else if (template.params === '1') {
                  const paramMatch = row.content?.match(/\[Template:.*?\]\s*(.+)/);
                  if (paramMatch && paramMatch[1].trim()) {
                    processedContent = paramMatch[1].trim();
                  } else {
                    processedContent = template.content || processedContent;
                  }
                }
                return { ...row, content: processedContent };
              }
            }
          }
        }
        
        if (row.kind !== 'email') {
          return row;
        }

        const originalContent =
          typeof row.content === 'string' ? row.content : row.content != null ? String(row.content) : '';

        const strippedBase = stripSignatureAndQuotedTextPreserveHtml(originalContent);
        const sanitizedBase = sanitizeEmailHtml(strippedBase);

        let sanitizedWithoutSubject = sanitizedBase;
        if (row.subject) {
          try {
            const subjectPattern = new RegExp(`^${escapeRegExp(row.subject)}\\s*:?\\s*[\\-–—]*`, 'i');
            const withoutSubjectSource = originalContent.replace(subjectPattern, '').trim();
            const strippedWithoutSubject = stripSignatureAndQuotedTextPreserveHtml(withoutSubjectSource);
            const sanitizedCandidate = sanitizeEmailHtml(strippedWithoutSubject);
            if (sanitizedCandidate) {
              sanitizedWithoutSubject = sanitizedCandidate;
            }
          } catch (error) {
            console.warn('Failed to strip subject prefix from email content', error);
          }
        }

        return {
          ...row,
          renderedContent: sanitizedWithoutSubject || sanitizedBase,
          renderedContentFallback: sanitizedBase,
        };
      }),
    [visibleInteractions, whatsAppTemplates] // Include templates in dependencies
  );
  const lastEmailIdx = useMemo(() => 
    sortedInteractions.map(row => row.kind).lastIndexOf('email'),
    [sortedInteractions]
  );

  // Debug: Log renderedInteractions to see what's being rendered
  useEffect(() => {
    const whatsappCount = renderedInteractions.filter((r: any) => r?.kind === 'whatsapp').length;
    const totalCount = renderedInteractions.length;
    console.log(`🔍 Rendered interactions: ${totalCount} total, ${whatsappCount} WhatsApp messages`);
    if (whatsappCount > 0) {
      console.log('✅ WhatsApp messages in renderedInteractions:', renderedInteractions.filter((r: any) => r?.kind === 'whatsapp').slice(0, 3));
    }
  }, [renderedInteractions]);

  // --- Add: handler for clicking an interaction to jump to message in modal ---
  const handleInteractionClick = async (row: Interaction, idx: number) => {
    if (row.kind === 'email') {
      // Ensure contacts are loaded first
      let contacts = leadContacts;
      if (contacts.length === 0) {
        try {
          const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
          const normalizedLeadId = isLegacyLead 
            ? (typeof client.id === 'string' ? client.id.replace('legacy_', '') : String(client.id))
            : client.id;
          
          contacts = await fetchLeadContacts(normalizedLeadId, isLegacyLead);
          setLeadContacts(contacts);
        } catch (error) {
          console.error('Error fetching contacts for email click:', error);
        }
      }
      
      // Find the contact associated with this email
      let contactToSelect: ContactInfo | null = null;
      const emailContactId = (row as any).contact_id;
      const senderEmail = (row as any).sender_email?.toLowerCase().trim();
      const recipientList = (row as any).recipient_list?.toLowerCase() || '';
      
      // First, try to find by contact_id if available (STRICT MATCH)
      if (emailContactId !== null && emailContactId !== undefined && contacts.length > 0) {
        contactToSelect = contacts.find(c => c.id === Number(emailContactId)) || null;
      }
      
      // If not found by contact_id, try to match by email address (for old emails without contact_id)
      if (!contactToSelect && contacts.length > 0) {
        // Split recipient list to check each recipient individually
        const recipients = recipientList.split(/[,;]/).map((r: string) => r.trim().toLowerCase()).filter((r: string) => r);
        
        const isOutgoing = row.direction === 'out';
        
        // For outgoing emails, prioritize matching recipients
        // For incoming emails, prioritize matching sender
        if (isOutgoing && recipients.length > 0) {
          // Outgoing email: match by recipient
          for (const contact of contacts) {
            const contactEmail = contact.email?.toLowerCase().trim();
            if (contactEmail && recipients.includes(contactEmail)) {
              contactToSelect = contact;
              break;
            }
          }
        } else if (!isOutgoing && senderEmail) {
          // Incoming email: match by sender
          for (const contact of contacts) {
            const contactEmail = contact.email?.toLowerCase().trim();
            if (contactEmail && senderEmail === contactEmail) {
              contactToSelect = contact;
              break;
            }
          }
        }
        
        // Fallback: try reverse matching if primary match didn't work
        if (!contactToSelect) {
          for (const contact of contacts) {
            const contactEmail = contact.email?.toLowerCase().trim();
            if (contactEmail) {
              if (isOutgoing && senderEmail === contactEmail) {
                // Outgoing but sender matches (less likely but possible)
                contactToSelect = contact;
                break;
              } else if (!isOutgoing && recipients.includes(contactEmail)) {
                // Incoming but recipient matches (less likely but possible)
                contactToSelect = contact;
                break;
              }
            }
          }
        }
      }
      
      // If still no contact found, use the main contact as fallback
      if (!contactToSelect && contacts.length > 0) {
        contactToSelect = contacts.find(c => c.isMain) || contacts[0] || null;
      }
      
      // Set the selected contact if found (BEFORE opening modal)
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      const leadId = isLegacyLead 
        ? (typeof client.id === 'string' ? client.id.replace('legacy_', '') : String(client.id))
        : client.id;
      
      if (contactToSelect) {
        
        // Set the contact state first
        setSelectedContactForEmail({
          contact: contactToSelect,
          leadId,
          leadType: isLegacyLead ? 'legacy' : 'new'
        });
        
        // Wait longer for state to update, then open modal
        await new Promise(resolve => setTimeout(resolve, 200));
      } else {
        console.warn('⚠️ No contact found for email, clearing selected contact and opening modal without filter', {
          emailId: row.id,
          emailContactId: emailContactId,
          senderEmail,
          recipientList,
          contactsCount: contacts.length,
          contacts: contacts.map(c => ({ id: c.id, name: c.name, email: c.email }))
        });
        // Clear any previously selected contact
        setSelectedContactForEmail(null);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // Now open the modal
      setIsEmailModalOpen(true);
      setActiveEmailId(row.id.toString());
      setTimeout(() => {
        const el = document.querySelector(`[data-email-id="${row.id}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-2', 'ring-primary');
          setTimeout(() => el.classList.remove('ring-2', 'ring-primary'), 1200);
        }
      }, 300);
    } else if (row.kind === 'whatsapp') {
      // Ensure contacts are loaded first
      let contacts = leadContacts;
      if (contacts.length === 0) {
        try {
          const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
          const normalizedLeadId = isLegacyLead 
            ? (typeof client.id === 'string' ? client.id.replace('legacy_', '') : String(client.id))
            : client.id;
          
          contacts = await fetchLeadContacts(normalizedLeadId, isLegacyLead);
          setLeadContacts(contacts);
        } catch (error) {
          console.error('Error fetching contacts for WhatsApp click:', error);
        }
      }
      
      // Find the contact associated with this WhatsApp message
      let contactToSelect: ContactInfo | null = null;
      const whatsappContactId = (row as any).contact_id;
      const phoneNumber = (row as any).phone_number;
      
      // First, try to find by contact_id if available (STRICT MATCH)
      if (whatsappContactId !== null && whatsappContactId !== undefined && contacts.length > 0) {
        contactToSelect = contacts.find(c => c.id === Number(whatsappContactId)) || null;
      }
      
      // If not found by contact_id, try to match by phone number
      if (!contactToSelect && phoneNumber && contacts.length > 0) {
        // Normalize phone number (remove spaces, dashes, etc.)
        const normalizePhone = (phone: string) => phone.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '');
        const normalizedPhone = normalizePhone(phoneNumber);
        
        for (const contact of contacts) {
          const contactPhone = contact.phone ? normalizePhone(contact.phone) : null;
          const contactMobile = contact.mobile ? normalizePhone(contact.mobile) : null;
          
          // Try exact match first
          if (contactPhone === normalizedPhone || contactMobile === normalizedPhone) {
            contactToSelect = contact;
            break;
          }
          
          // Try last 4 digits match (fallback)
          if (normalizedPhone.length >= 4) {
            const last4 = normalizedPhone.slice(-4);
            if ((contactPhone && contactPhone.slice(-4) === last4) || 
                (contactMobile && contactMobile.slice(-4) === last4)) {
              contactToSelect = contact;
              break;
            }
          }
        }
      }
      
      // If still no contact found, use the main contact as fallback
      if (!contactToSelect && contacts.length > 0) {
        contactToSelect = contacts.find(c => c.isMain) || contacts[0] || null;
      }
      
      // Set the contact if found
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      const leadId = isLegacyLead 
        ? (typeof client.id === 'string' ? client.id.replace('legacy_', '') : String(client.id))
        : client.id;
      
      if (contactToSelect) {
        console.log('📞 Setting contact for WhatsApp click:', contactToSelect.name);
        const contactData = {
          contact: contactToSelect,
          leadId,
          leadType: isLegacyLead ? 'legacy' : 'new' as 'legacy' | 'new'
        };
        selectedContactForWhatsAppRef.current = contactData;
        setSelectedContactForWhatsApp(contactData);
        // Wait a bit for state to update, then open modal
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setIsWhatsAppOpen(true);
            setActiveWhatsAppId(row.id.toString());
          });
        });
      } else {
        console.warn('⚠️ No contact found for WhatsApp message, opening without contact filter');
        // Clear any previously selected contact
        setSelectedContactForWhatsApp(null);
        selectedContactForWhatsAppRef.current = null;
        setIsWhatsAppOpen(true);
        setActiveWhatsAppId(row.id.toString());
      }
    } else {
      openEditDrawer(idx);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('focus') === 'email' && lastEmailIdx !== -1) {
      // Open the email modal for the last email
      setIsEmailModalOpen(true);
      setActiveEmailId(sortedInteractions[lastEmailIdx].id.toString());
      // Scroll to the last email
      setTimeout(() => {
        lastEmailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [location.search, lastEmailIdx, sortedInteractions]); // Now safe to include these memoized values

  // Handle email modal opening from localStorage flag
  useEffect(() => {
    if (localStorage.getItem('openEmailModal') === 'true') {
      // Wait for interactions to be loaded and emails to be available
      if (interactions.length > 0 && emails.length > 0) {
        if (lastEmailIdx !== -1) {
          setIsEmailModalOpen(true);
          setActiveEmailId(sortedInteractions[lastEmailIdx].id.toString());
          setTimeout(() => {
            lastEmailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
        }
        localStorage.removeItem('openEmailModal');
      } else {
        // If emails aren't loaded yet, wait a bit and try again
        const timeoutId = setTimeout(() => {
          if (localStorage.getItem('openEmailModal') === 'true') {
            if (interactions.length > 0 && emails.length > 0 && lastEmailIdx !== -1) {
              setIsEmailModalOpen(true);
              setActiveEmailId(sortedInteractions[lastEmailIdx].id.toString());
              setTimeout(() => {
                lastEmailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 100);
            }
            localStorage.removeItem('openEmailModal');
          }
        }, 2000); // Wait 2 seconds for emails to load
        
        return () => clearTimeout(timeoutId);
      }
    }
  }, [client.id, interactions.length, emails.length, lastEmailIdx, sortedInteractions]); // Include necessary dependencies

  // Handle WhatsApp modal opening from localStorage flag
  useEffect(() => {
    if (localStorage.getItem('openWhatsAppModal') === 'true') {
      // Wait for interactions to be loaded
      if (interactions.length > 0) {
        setIsWhatsAppOpen(true);
        localStorage.removeItem('openWhatsAppModal');
      } else {
        // If interactions aren't loaded yet, wait a bit and try again
        const timeoutId = setTimeout(() => {
          if (localStorage.getItem('openWhatsAppModal') === 'true') {
            if (interactions.length > 0) {
              setIsWhatsAppOpen(true);
            }
            localStorage.removeItem('openWhatsAppModal');
          }
        }, 2000); // Wait 2 seconds for interactions to load
        
        return () => clearTimeout(timeoutId);
      }
    }
  }, [client.id, interactions.length]); // Include interactions.length since we need to check it




  // Close WhatsApp modal when client changes
  useEffect(() => {
    setIsWhatsAppOpen(false);
    // Clear any stale flags when client changes
    localStorage.removeItem('openWhatsAppModal');
    localStorage.removeItem('whatsAppFromCalendar');
  }, [client.id]);

  // Handle click outside to close emoji picker
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isEmojiPickerOpen) {
        const target = event.target as HTMLElement;
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

  // Handle WhatsApp modal close and navigation back to Calendar
  const handleWhatsAppClose = () => {
    setIsWhatsAppOpen(false);
    setWhatsAppInput('');
    setSelectedFile(null);
    setSelectedMedia(null);
    setActiveWhatsAppId(null);
    setWhatsAppError(null); // Clear any error messages when closing
    selectedContactForWhatsAppRef.current = null; // Clear the ref
    
    // Check if WhatsApp was opened from Calendar
    if (localStorage.getItem('whatsAppFromCalendar') === 'true') {
      localStorage.removeItem('whatsAppFromCalendar');
      navigate('/calendar');
    }
  };

  // 2. Fetch WhatsApp messages from DB when WhatsApp modal opens or client changes
  useEffect(() => {
    async function fetchWhatsAppMessages() {
      if (!client?.id) return;
      
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      let query = supabase.from('whatsapp_messages').select('*');
      
      if (isLegacyLead) {
        const legacyId = parseInt(client.id.replace('legacy_', ''));
        query = query.eq('legacy_id', legacyId);
      } else {
        query = query.eq('lead_id', client.id);
      }
      
      const { data, error } = await query.order('sent_at', { ascending: true });
      if (!error && data) {
        setWhatsAppMessages(data);
      } else {
        setWhatsAppMessages([]);
      }
    }
    if (isWhatsAppOpen) {
      fetchWhatsAppMessages();
    }
  }, [isWhatsAppOpen, client.id]);

  // 3. Periodically check status of pending messages
  useEffect(() => {
    if (!isWhatsAppOpen || !client?.id) return;

    const interval = setInterval(async () => {
      // Check if there are any pending messages
      const hasPendingMessages = whatsAppMessages.some(msg => msg.whatsapp_status === 'pending');
      
      if (hasPendingMessages) {
        // Refetch messages to get updated statuses
        const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
        let query = supabase.from('whatsapp_messages').select('*');
        
        if (isLegacyLead) {
          const legacyId = parseInt(client.id.replace('legacy_', ''));
          query = query.eq('legacy_id', legacyId);
        } else {
          query = query.eq('lead_id', client.id);
        }
        
        const { data, error } = await query.order('sent_at', { ascending: true });
        if (!error && data) {
          setWhatsAppMessages(data);
        }
      }
    }, 5000); // Check every 5 seconds

    return () => clearInterval(interval);
  }, [isWhatsAppOpen, client.id, whatsAppMessages]);

  // 3. On send, save to DB and refetch messages
  const handleSendWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!whatsAppInput.trim()) return;

    // Clear any previous errors
    setWhatsAppError(null);

    // Check if client has phone number
    console.log('🔍 Checking phone numbers:', { phone: client.phone, mobile: client.mobile });
    if (!client.phone && !client.mobile) {
      console.log('❌ No phone number found, setting error');
      setWhatsAppError('❌ No phone number available for this client. Please add a phone number first.');
      // Add a small delay to ensure the error is displayed
      setTimeout(() => {
        console.log('🔍 Error should be visible now');
      }, 100);
      return;
    }

    // Validate phone number format
    const phoneNumber = client.phone || client.mobile;
    console.log('🔍 Phone number to use:', phoneNumber);
    if (!phoneNumber || phoneNumber.trim() === '') {
      console.log('❌ Phone number is empty, setting error');
      setWhatsAppError('❌ No phone number available for this client. Please add a phone number first.');
      return;
    }
    
    const now = new Date();
    let senderName = 'You';
    let whatsappStatus = 'sent';
    let errorMessage = null;
    
    try {
      // Get current user's full name from users table with employee join
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id) {
        const { data: userRow, error: userLookupError } = await supabase
          .from('users')
          .select(`
            full_name,
            email,
            employee_id,
            tenants_employee!employee_id(
              display_name
            )
          `)
          .eq('auth_id', user.id)
          .single();
        if (!userLookupError && userRow) {
          // Use display_name from tenants_employee if available, otherwise full_name
          const employee = Array.isArray(userRow.tenants_employee) ? userRow.tenants_employee[0] : userRow.tenants_employee;
          senderName = employee?.display_name || userRow.full_name || userRow.email || 'You';
        }
      }
      
      // Try to send via WhatsApp API first
      const response = await fetch(buildApiUrl('/api/whatsapp/send-message'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          leadId: client.id,
          message: whatsAppInput.trim(),
          phoneNumber: client.phone || client.mobile,
          sender_name: senderName
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        let errorMessage = '';
        if (result.code === 'RE_ENGAGEMENT_REQUIRED') {
          errorMessage = '⚠️ WhatsApp 24-Hour Rule: You can only send template messages after 24 hours of customer inactivity. The customer needs to reply first to reset the timer.';
        } else if (result.error?.includes('phone') || result.error?.includes('invalid') || result.error?.includes('format')) {
          errorMessage = '❌ Invalid phone number format. Please check the client\'s phone number.';
        } else if (result.error?.includes('not found') || result.error?.includes('404')) {
          errorMessage = '❌ Phone number not found or not registered on WhatsApp.';
        } else {
          errorMessage = `❌ WhatsApp API Error: ${result.error || 'Unknown error'}`;
        }
        
        setWhatsAppError(errorMessage);
        return; // Don't save to database if API call failed
      }
      
      // Message sent successfully via WhatsApp API - backend will save to database
      console.log('✅ WhatsApp message sent successfully, backend will save to database');
      
      setWhatsAppInput('');
      
      // Refetch messages - handle both new and legacy leads
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      let query = supabase.from('whatsapp_messages').select('*');
      if (isLegacyLead) {
        const legacyId = parseInt(client.id.replace('legacy_', ''));
        query = query.eq('legacy_id', legacyId);
      } else {
        query = query.eq('lead_id', client.id);
      }
      
      const { data, error } = await query.order('sent_at', { ascending: true });
      if (!error && data) {
        setWhatsAppMessages(data);
      }
      
      // Optionally, update interactions timeline
      if (onClientUpdate) await onClientUpdate();
      
      // Clear any previous errors and show success
      setWhatsAppError(null);
      
    } catch (err) {
      console.error('Unexpected error sending WhatsApp message:', err);
      setWhatsAppError('Unexpected error sending WhatsApp message: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  // Helper function to render WhatsApp-style message status
  const renderMessageStatus = (status?: string, errorMessage?: string) => {
    if (!status) return null;
    
    const baseClasses = "w-7 h-7";
    
    switch (status) {
      case 'sent':
        return (
          <svg className={baseClasses} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'pending':
        return (
          <svg className={`${baseClasses} text-gray-400 animate-pulse`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
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
      case 'failed':
        return (
          <div className="relative group">
            <svg className={`${baseClasses} text-red-500`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {errorMessage && (
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-red-600 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50 max-w-xs">
                {errorMessage}
                <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-red-600"></div>
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  // Handle file selection for WhatsApp
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
    setWhatsAppInput(prev => prev + emoji);
    setIsEmojiPickerOpen(false);
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

  // Send media message via WhatsApp
  const handleSendMedia = async () => {
    if (!selectedFile || !client) {
      console.log('❌ Cannot send media - missing file or client:', { selectedFile, client });
      return;
    }

    console.log('📤 Starting to send media:', {
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
      fileType: selectedFile.type,
      clientId: client.id,
      clientName: client.name
    });

    // Clear any previous errors
    setWhatsAppError(null);

    // Check if client has phone number
    console.log('🔍 Media: Checking phone numbers:', { phone: client.phone, mobile: client.mobile });
    if (!client.phone && !client.mobile) {
      console.log('❌ Media: No phone number found, setting error');
      setWhatsAppError('❌ No phone number available for this client. Please add a phone number first.');
      // Add a small delay to ensure the error is displayed
      setTimeout(() => {
        console.log('🔍 Media: Error should be visible now');
      }, 100);
      return;
    }

    setUploadingMedia(true);
    let whatsappStatus = 'sent';
    let errorMessage = null;
    
    try {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('leadId', client.id);

      // Upload media to WhatsApp
      const uploadResponse = await fetch(buildApiUrl('/api/whatsapp/upload-media'), {
        method: 'POST',
        body: formData,
      });

      const uploadResult = await uploadResponse.json();

      if (!uploadResponse.ok) {
        errorMessage = uploadResult.error || 'Failed to upload media';
        whatsappStatus = 'failed';
        throw new Error(errorMessage);
      }

      // Send media message
      const mediaType = selectedFile.type.startsWith('image/') ? 'image' : 'document';
      const senderName = currentUserFullName || 'You';
      const response = await fetch(buildApiUrl('/api/whatsapp/send-media'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          leadId: client.id,
          mediaUrl: uploadResult.mediaId,
          mediaType: mediaType,
          caption: whatsAppInput.trim() || undefined,
          phoneNumber: client.phone || client.mobile,
          sender_name: senderName
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        if (result.code === 'RE_ENGAGEMENT_REQUIRED') {
          errorMessage = '⚠️ WhatsApp 24-Hour Rule: You can only send template messages after 24 hours of customer inactivity.';
          whatsappStatus = 'failed';
        } else if (result.error?.includes('phone') || result.error?.includes('invalid') || result.error?.includes('format')) {
          errorMessage = '❌ Invalid phone number format. Please check the client\'s phone number.';
          whatsappStatus = 'failed';
        } else if (result.error?.includes('not found') || result.error?.includes('404')) {
          errorMessage = '❌ Phone number not found or not registered on WhatsApp.';
          whatsappStatus = 'failed';
        } else {
          errorMessage = result.error || 'Failed to send media';
          whatsappStatus = 'failed';
        }
        throw new Error(errorMessage);
      }

      // Media sent successfully - clear any previous errors
      setWhatsAppError(null);
      
    } catch (apiError) {
      // API call failed - don't save to database
      console.error('WhatsApp Media API Error:', apiError);
      const errorMessage = apiError instanceof Error ? apiError.message : 'Unknown API error';
      setWhatsAppError('Failed to send media: ' + errorMessage);
      setUploadingMedia(false);
      return; // Don't save to database if API call failed
    }

    // Media sent successfully - backend will save to database
    console.log('✅ WhatsApp media sent successfully, backend will save to database');
    
    setWhatsAppInput('');
    setSelectedFile(null);
    setUploadingMedia(false);
    
    // Refetch messages to update the display
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
    let query = supabase.from('whatsapp_messages').select('*');
    if (isLegacyLead) {
      const legacyId = parseInt(client.id.replace('legacy_', ''));
      query = query.eq('legacy_id', legacyId);
    } else {
      query = query.eq('lead_id', client.id);
    }
    
    const { data, error } = await query.order('sent_at', { ascending: true });
    if (!error && data) {
      setWhatsAppMessages(data);
    }
    
    // Optionally, update interactions timeline
    if (onClientUpdate) await onClientUpdate();
  };

  // 4. Use whatsAppMessages for chat display
  // Replace whatsAppChatMessages with whatsAppMessages in the modal rendering
  // 5. In the timeline, merge WhatsApp messages from DB with other interactions
  // In fetchAndCombineInteractions, fetch WhatsApp messages from DB and merge with manual_interactions and emails
  const fetchInteractions = useCallback(
    async (options?: { bypassCache?: boolean }) => {
      // Don't fetch if no client
      if (!client?.id) {
        console.log('⚠️ InteractionsTab: No client ID, skipping fetch');
        setInteractions([]);
        setEmails([]);
        setInteractionsLoading(false);
        return;
      }

      const cacheForLead: ClientInteractionsCache | null =
        interactionsCache && interactionsCache.leadId === client.id ? interactionsCache : null;

      if (!options?.bypassCache && cacheForLead) {
        console.log('✅ InteractionsTab using cached interactions for lead:', cacheForLead.leadId);
        let cachedInteractions = cacheForLead.interactions || [];
        const cachedWhatsAppCount = cachedInteractions.filter((i: any) => i.kind === 'whatsapp').length;
        console.log(`📊 Cached interactions: ${cachedInteractions.length} total, ${cachedWhatsAppCount} WhatsApp messages`);
        
        // Process cached WhatsApp messages with templates if templates are available
        if (whatsAppTemplates.length > 0 && cachedWhatsAppCount > 0) {
          console.log('🔄 Processing cached WhatsApp messages with templates...');
          cachedInteractions = cachedInteractions.map((interaction: any) => {
            if (interaction.kind === 'whatsapp' && interaction.direction === 'out') {
              // Process template messages from cache
              const templateId = interaction.template_id;
              if (templateId) {
                const templateIdNum = Number(templateId);
                const template = whatsAppTemplates.find(t => Number(t.id) === templateIdNum);
                if (template && template.content) {
                  if (template.params === '0') {
                    return { ...interaction, content: template.content };
                  } else if (template.params === '1') {
                    const paramMatch = interaction.content?.match(/\[Template:.*?\]\s*(.+)/);
                    if (paramMatch && paramMatch[1].trim()) {
                      return { ...interaction, content: paramMatch[1].trim() };
                    }
                    return { ...interaction, content: template.content };
                  }
                }
              }
              
              // Fallback to name matching
              const templateMatch = interaction.content?.match(/\[Template:\s*([^\]]+)\]/) || 
                                    interaction.content?.match(/Template:\s*(.+)/) ||
                                    interaction.content?.match(/TEMPLATE_MARKER:(.+)/);
              
              if (templateMatch) {
                const templateTitle = templateMatch[1].trim().replace(/\]$/, '');
                const template = whatsAppTemplates.find(t => 
                  t.title.toLowerCase() === templateTitle.toLowerCase() ||
                  (t.name360 && t.name360.toLowerCase() === templateTitle.toLowerCase())
                );
                if (template && template.content) {
                  if (template.params === '0') {
                    return { ...interaction, content: template.content };
                  } else if (template.params === '1') {
                    const paramMatch = interaction.content?.match(/\[Template:.*?\]\s*(.+)/);
                    if (paramMatch && paramMatch[1].trim()) {
                      return { ...interaction, content: paramMatch[1].trim() };
                    }
                    return { ...interaction, content: template.content };
                  }
                }
              }
            }
            return interaction;
          });
          console.log('✅ Processed cached WhatsApp messages with templates');
        }
        
        if (!isMountedRef.current) return;
        setInteractions(cachedInteractions);
        setEmails(cacheForLead.emails || []);
        setInteractionsLoading(false);
        const cachedCount =
          cacheForLead.count ?? (cacheForLead.interactions ? cacheForLead.interactions.length : 0);
        onInteractionCountUpdate?.(cachedCount);
        return;
      }

      const startTime = performance.now();
      console.log('🚀 Starting InteractionsTab fetch...');
      if (isMountedRef.current) {
        setInteractionsLoading(true);
      }
      try {
        // Ensure currentUserFullName is set before mapping emails
        let userFullName = currentUserFullName;
        if (!userFullName && !userFullNameLoadedRef.current) {
          const { data: { user } } = await supabase.auth.getUser();
          if (user && user.id) {
            const { data, error } = await supabase
              .from('users')
              .select(`
                full_name,
                employee_id,
                tenants_employee!employee_id(
                  display_name
                )
              `)
              .eq('auth_id', user.id)
              .single();
            if (!error && data) {
              // Use display_name from tenants_employee if available, otherwise full_name
              const employee = Array.isArray(data.tenants_employee) ? data.tenants_employee[0] : data.tenants_employee;
              userFullName = employee?.display_name || data.full_name;
              if (isMountedRef.current) {
                setCurrentUserFullName(userFullName);
                userFullNameLoadedRef.current = true;
              }
            }
          }
        }

        // Prepare parallel queries for better performance
        const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
        const legacyId = isLegacyLead ? parseInt(client.id.replace('legacy_', '')) : null;

        // Execute all database queries in parallel with aggressive limits
        const [whatsAppResult, callLogsResult, legacyResult, emailsResult] = await Promise.all([
          // WhatsApp messages query - only fetch essential fields
          client?.id ? (async () => {
            try {
              let query = supabase
                .from('whatsapp_messages')
                .select('id, sent_at, sender_name, direction, message, whatsapp_status, error_message, contact_id, phone_number, template_id')
                .limit(FETCH_BATCH_SIZE);
              
              if (isLegacyLead) {
                if (legacyId !== null) {
                  query = query.eq('legacy_id', legacyId);
                } else {
                  console.warn('⚠️ Legacy lead ID is null, skipping WhatsApp query');
                  return { data: [], error: null };
                }
              } else {
                query = query.eq('lead_id', client.id);
              }
              
              const { data, error } = await query.order('sent_at', { ascending: false });
              
              if (error) {
                console.error('❌ WhatsApp query error:', error);
              }
              
              return { data: data || [], error };
            } catch (err) {
              console.error('❌ WhatsApp query exception:', err);
              return { data: [], error: err };
            }
          })() : Promise.resolve({ data: [], error: null }),

          // Call logs query - only fetch essential fields
          client?.id ? (async () => {
            try {
              let query = supabase
                .from('call_logs')
                .select(`
                  id,
                  cdate,
                  time,
                  source,
                  destination,
                  status,
                  duration,
                  url,
                  direction,
                  tenants_employee!employee_id (
                    display_name
                  )
                `)
                .limit(FETCH_BATCH_SIZE);
              
              if (isLegacyLead) {
                query = query.eq('lead_id', legacyId);
              } else {
                // Skip client_id query if column doesn't exist
                query = query.eq('lead_id', client.id);
              }
              
              const { data, error } = await query.order('cdate', { ascending: false });
              return { data, error };
            } catch (error) {
              return { data: [], error };
            }
          })() : Promise.resolve({ data: [], error: null }),

          // Legacy interactions query - only for legacy leads, with limit
          isLegacyLead && client?.id ? (async () => {
            try {
              const interactions = await fetchLegacyInteractions(client.id, client.name);
              return interactions.slice(0, FETCH_BATCH_SIZE);
            } catch (error) {
              return [];
            }
          })() : Promise.resolve([]),

          client?.id
            ? (async () => {
                let emailQuery = supabase
                  .from('emails')
                  .select(
                    'id, message_id, subject, sent_at, direction, sender_email, recipient_list, body_html, body_preview, attachments, contact_id'
                  )
                  .limit(EMAIL_MODAL_LIMIT)
                  .order('sent_at', { ascending: false });

                if (isLegacyLead && legacyId !== null) {
                  emailQuery = emailQuery.eq('legacy_id', legacyId);
                } else {
                  emailQuery = emailQuery.eq('client_id', client.id);
                }

                const { data, error } = await emailQuery;
                return { data: data || [], error };
              })()
            : Promise.resolve({ data: [], error: null })
        ]);

        // Process results from parallel queries
        if (emailsResult.error) {
          console.error('❌ Failed to fetch emails for interactions tab:', emailsResult.error);
        }

        // Log WhatsApp query results for debugging
        if (whatsAppResult.error) {
          console.error('❌ Failed to fetch WhatsApp messages for interactions tab:', whatsAppResult.error);
        } else {
          console.log(`✅ Fetched ${whatsAppResult.data?.length || 0} WhatsApp messages for interactions tab`);
        }

        // Process WhatsApp messages with template content
        const processTemplateMessage = (msg: any): string => {
          let processedMessage = msg.message || '';
          
          // If templates aren't loaded yet, return original message
          if (whatsAppTemplates.length === 0) {
            console.log('⚠️ Templates not loaded yet, skipping template processing for message:', msg.id);
            return processedMessage;
          }
          
          // PRIORITY 1: Match by template_id if available (most reliable)
          if (msg.template_id) {
            const templateId = Number(msg.template_id);
            const template = whatsAppTemplates.find(t => Number(t.id) === templateId);
            if (template) {
              console.log(`✅ Matched template by ID ${templateId}: ${template.title} (${template.language || 'N/A'})`);
              if (template.params === '0' && template.content) {
                processedMessage = template.content;
              } else if (template.params === '1') {
                // For templates with params, try to extract parameter from message
                const paramMatch = msg.message?.match(/\[Template:.*?\]\s*(.+)/);
                if (paramMatch && paramMatch[1].trim()) {
                  processedMessage = paramMatch[1].trim();
                } else {
                  processedMessage = template.content || processedMessage;
                }
              }
              return processedMessage;
            } else {
              console.warn(`⚠️ Template with ID ${templateId} not found. Available IDs:`, whatsAppTemplates.map(t => t.id));
            }
          }
          
          // PRIORITY 2: Fallback to name matching for backward compatibility (legacy messages without template_id)
          if (msg.direction === 'out' && msg.message) {
            // Check if message already matches a template content
            const isAlreadyProperlyFormatted = whatsAppTemplates.some(template => 
              template.content && msg.message === template.content
            );
            
            if (isAlreadyProperlyFormatted) {
              return processedMessage;
            }
            
            // Try to find template by name in the message
            const templateMatch = msg.message.match(/\[Template:\s*([^\]]+)\]/) || 
                                  msg.message.match(/Template:\s*(.+)/) ||
                                  msg.message.match(/TEMPLATE_MARKER:(.+)/);
            
            if (templateMatch) {
              const templateTitle = templateMatch[1].trim().replace(/\]$/, '');
              console.log(`🔍 Looking for template by name: "${templateTitle}"`);
              
              // Try case-insensitive matching on title and name360
              const template = whatsAppTemplates.find(t => 
                t.title.toLowerCase() === templateTitle.toLowerCase() ||
                (t.name360 && t.name360.toLowerCase() === templateTitle.toLowerCase())
              );
              
              if (template) {
                console.log(`✅ Matched template by name "${templateTitle}": ${template.title} (${template.language || 'N/A'})`);
                if (template.params === '0' && template.content) {
                  processedMessage = template.content;
                } else if (template.params === '1') {
                  // For templates with params, try to extract parameter from message
                  const paramMatch = msg.message.match(/\[Template:.*?\]\s*(.+)/);
                  if (paramMatch && paramMatch[1].trim()) {
                    processedMessage = paramMatch[1].trim();
                  } else {
                    processedMessage = template.content || processedMessage;
                  }
                }
              } else {
                console.warn(`⚠️ Template with name "${templateTitle}" not found. Available names:`, whatsAppTemplates.map(t => t.title || t.name360));
              }
            }
          }
          
          return processedMessage;
        };

        const [whatsAppDbMessages, callLogInteractions, legacyInteractions] = [
          // Process WhatsApp messages
          (whatsAppResult.data || []).map((msg: any) => {
            // Ensure sent_at exists and is valid
            const sentAt = msg.sent_at || msg.created_at || new Date().toISOString();
            const sentAtDate = new Date(sentAt);
            
            // Skip messages with invalid dates
            if (isNaN(sentAtDate.getTime())) {
              console.warn('⚠️ WhatsApp message has invalid sent_at:', { id: msg.id, sent_at: msg.sent_at });
              return null;
            }
            
            // Process template message to get actual content
            const processedContent = processTemplateMessage(msg);
            
            // Log if template processing occurred
            if (msg.message !== processedContent && msg.direction === 'out') {
              console.log(`✅ Template processed for message ${msg.id}:`, {
                original: msg.message?.substring(0, 50),
                processed: processedContent?.substring(0, 50),
                template_id: msg.template_id
              });
            }
            
            return {
              id: msg.id,
              date: sentAtDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }),
              time: sentAtDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
              raw_date: sentAt,
              employee: msg.sender_name || 'You',
              direction: msg.direction || 'in',
              kind: 'whatsapp',
              length: '',
              content: processedContent,
              observation: msg.error_message || '',
              editable: false,
              status: msg.whatsapp_status || 'sent',
              error_message: msg.error_message,
              contact_id: msg.contact_id || null,
              phone_number: msg.phone_number || null,
              template_id: msg.template_id || null,
            };
          }).filter((msg: any) => msg !== null),

          // Process call logs
          callLogsResult.data?.map((callLog: any) => {
            const callDate = new Date(callLog.cdate);
            const callTime = callLog.time || '00:00';
            const direction = callLog.direction?.toLowerCase().includes('incoming') ? 'in' : 'out';
            
            // Get employee name from JOIN or fallback
            let employeeName = client.name;
            if (direction === 'out' && callLog.tenants_employee) {
              const employee = Array.isArray(callLog.tenants_employee) ? callLog.tenants_employee[0] : callLog.tenants_employee;
              employeeName = employee?.display_name || userFullName || 'You';
            } else if (direction === 'out') {
              employeeName = userFullName || 'You';
            }
            
            const duration = callLog.duration ? `${Math.floor(callLog.duration / 60)}:${(callLog.duration % 60).toString().padStart(2, '0')}` : '0:00';
            
            let content = '';
            if (callLog.source && callLog.destination) {
              content = `From: ${callLog.source}, To: ${callLog.destination}`;
            } else if (callLog.source) {
              content = `From: ${callLog.source}`;
            } else if (callLog.destination) {
              content = `To: ${callLog.destination}`;
            } else {
              content = 'Call logged';
            }
            
            return {
              id: `call_${callLog.id}`,
              date: callDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }),
              time: callTime,
              raw_date: callLog.cdate,
              employee: employeeName,
              direction: direction,
              kind: 'call',
              length: duration,
              content: content,
              observation: '',
              editable: false,
              status: callLog.status,
              call_log: callLog,
              recording_url: callLog.url,
              call_duration: callLog.duration,
              employee_data: callLog.tenants_employee
            };
          }) || [],

          // Process legacy interactions (filter out calls)
          Array.isArray(legacyResult) ? legacyResult.filter((interaction: any) => interaction.kind !== 'call') : []
        ];

        // 1. Manual interactions (excluding WhatsApp) - fast client-side processing
        const manualInteractions = (client.manual_interactions || []).filter((i: any) => i.kind !== 'whatsapp').map((i: any) => ({
          ...i,
          employee: i.direction === 'out' ? (userFullName || 'You') : i.employee || client.name,
        }));
        // 2. Email interactions - prioritise freshly fetched emails, fallback to client prop
        const clientEmails = emailsResult.data || [];
        
        const sortedEmails = [...clientEmails].sort((a: any, b: any) => {
          const aDate = new Date(a.sent_at || 0).getTime();
          const bDate = new Date(b.sent_at || 0).getTime();
          return bDate - aDate;
        });
        
        const emailInteractions = sortedEmails.map((e: any) => {
          const emailDate = new Date(e.sent_at);
          
          const bodyHtml = e.body_html ? extractHtmlBody(e.body_html) : null;
          const bodyPreview = e.body_preview || '';
          const body = bodyHtml || bodyPreview || e.subject || '';
          
          return {
            id: e.message_id,
            date: emailDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }),
            time: emailDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            raw_date: e.sent_at,
            employee: e.direction === 'outgoing' ? (userFullName || 'You') : client.name,
            direction: e.direction === 'outgoing' ? 'out' : 'in',
            kind: 'email',
            length: '',
            content: body,
            subject: e.subject || '',
            observation: e.observation || '',
            editable: true,
            status: e.status,
            body_html: bodyHtml,
            body_preview: bodyPreview || null,
            contact_id: e.contact_id || null,
            sender_email: e.sender_email || null,
            recipient_list: e.recipient_list || null,
          };
        });
      
        // Combine all interactions
        const combined = [...manualInteractions, ...emailInteractions, ...whatsAppDbMessages, ...callLogInteractions, ...legacyInteractions];
        
        // Filter out interactions with invalid dates and log for debugging
        const validInteractions = combined.filter((interaction: any) => {
          if (!interaction.raw_date) {
            console.warn('⚠️ Interaction missing raw_date:', { id: interaction.id, kind: interaction.kind });
            return false;
          }
          const date = new Date(interaction.raw_date);
          if (isNaN(date.getTime())) {
            console.warn('⚠️ Interaction has invalid raw_date:', { id: interaction.id, kind: interaction.kind, raw_date: interaction.raw_date });
            return false;
          }
          return true;
        });
        
        const uniqueInteractions = validInteractions.filter((interaction: any, index: number, self: any[]) => 
          index === self.findIndex((i: any) => i.id === interaction.id)
        );
        
        const sorted = uniqueInteractions.sort((a, b) => {
          const dateA = new Date(a.raw_date).getTime();
          const dateB = new Date(b.raw_date).getTime();
          return dateB - dateA;
        });
        
        // Log WhatsApp messages count for debugging
        const whatsappCount = sorted.filter((i: any) => i.kind === 'whatsapp').length;
        if (whatsappCount > 0) {
          console.log(`✅ Processed ${whatsappCount} WhatsApp messages in interactions timeline`);
        }
        
        const formattedEmailsForModal = sortedEmails.slice(0, EMAIL_MODAL_LIMIT).map((e: any) => {
          const previewSource = e.body_html || e.body_preview || e.subject || '';
          const previewHtmlSource = previewSource
            ? (/<[a-z][\s\S]*>/i.test(previewSource) ? extractHtmlBody(previewSource) : convertBodyToHtml(previewSource))
            : '';
          const sanitizedPreviewBase = previewHtmlSource ? sanitizeEmailHtml(previewHtmlSource) : '';
          const sanitizedPreview = sanitizedPreviewBase || sanitizeEmailHtml(convertBodyToHtml(e.subject || ''));

          return {
            id: e.message_id,
            subject: e.subject,
            from: e.sender_email,
            to: e.recipient_list,
            date: e.sent_at,
            bodyPreview: sanitizedPreview,
            direction: e.direction,
            attachments: e.attachments,
          };
        });
        // Always set interactions - React will handle unmounted components gracefully
        // If component remounts, we want the data anyway
        const whatsappInSorted = sorted.filter((i: any) => i.kind === 'whatsapp').length;
        console.log(`📊 Setting interactions: ${sorted.length} total, ${whatsappInSorted} WhatsApp messages`);
        console.log(`📊 isMountedRef.current: ${isMountedRef.current}`);
        
        if (!isMountedRef.current) {
          console.warn('⚠️ Component appears unmounted, but setting interactions anyway (component may remount)');
        }
        
        setInteractions(sorted as Interaction[]);
        
        const endTime = performance.now();
        const duration = Math.round(endTime - startTime);
        console.log(`✅ InteractionsTab loaded in ${duration}ms with ${sorted.length} interactions`);
        setEmails(formattedEmailsForModal);

        onInteractionCountUpdate?.(sorted.length);
        onInteractionsCacheUpdate?.({
          leadId: client.id,
          interactions: sorted,
          emails: formattedEmailsForModal,
          count: sorted.length,
          fetchedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error('Error in fetchAndCombineInteractions:', error);
        if (isMountedRef.current) {
          setInteractions([]);
          setEmails([]);
        }
        onInteractionCountUpdate?.(0);
        onInteractionsCacheUpdate?.({
          leadId: client.id,
          interactions: [],
          emails: [],
          count: 0,
          fetchedAt: new Date().toISOString(),
        });
      } finally {
        if (isMountedRef.current) setInteractionsLoading(false);
      }
    },
    [
      client,
      interactionsCache,
      currentUserFullName,
      onInteractionCountUpdate,
      onInteractionsCacheUpdate,
      whatsAppTemplates, // Include templates so messages are reprocessed when templates load
    ]
  );

  // Use ref to track last client ID to prevent infinite loops
  const lastClientIdRef = useRef<string | null>(null);
  const isFetchingRef = useRef<boolean>(false);
  
  useEffect(() => {
    const currentClientId = client?.id?.toString() || null;
    
    // Only fetch if client ID actually changed and we're not already fetching
    if (currentClientId && currentClientId !== lastClientIdRef.current && !isFetchingRef.current) {
      console.log('🔄 Client changed, fetching fresh interactions (bypassing cache)...', {
        previous: lastClientIdRef.current,
        current: currentClientId,
        isFetching: isFetchingRef.current,
        refAvailable: !!fetchInteractionsRef.current
      });
      lastClientIdRef.current = currentClientId;
      isFetchingRef.current = true;
      
      // Use the ref to get the latest fetchInteractions function
      // The ref is set in a separate useEffect, so it should be available
      // If ref is not set yet, wait a bit and try again, or use fetchInteractions directly
      const fetchFn = fetchInteractionsRef.current;
      if (fetchFn) {
        console.log('✅ Calling fetchInteractions via ref');
        fetchFn({ bypassCache: true }).finally(() => {
          isFetchingRef.current = false;
        });
      } else {
        // Ref not set yet, wait a tick and try again
        console.warn('⚠️ fetchInteractionsRef.current is null, scheduling retry...');
        setTimeout(() => {
          const retryFn = fetchInteractionsRef.current;
          if (retryFn) {
            console.log('✅ Retry: Calling fetchInteractions via ref');
            retryFn({ bypassCache: true }).finally(() => {
              isFetchingRef.current = false;
            });
          } else {
            console.error('❌ fetchInteractionsRef.current is still null after retry!');
            isFetchingRef.current = false;
          }
        }, 0);
      }
    } else if (!currentClientId) {
      // Clear if no client
      if (lastClientIdRef.current !== null) {
        lastClientIdRef.current = null;
        isFetchingRef.current = false;
        setInteractions([]);
        setEmails([]);
        setInteractionsLoading(false);
      }
    }
  }, [client?.id]); // Only depend on client.id - use ref for fetchInteractions to prevent loops

  // Fetch contacts when client changes
  useEffect(() => {
    const loadContacts = async () => {
      if (!client?.id) {
        setLeadContacts([]);
        return;
      }
      
      try {
        const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
        const normalizedLeadId = isLegacyLead 
          ? (typeof client.id === 'string' ? client.id.replace('legacy_', '') : String(client.id))
          : client.id;
        
        const contacts = await fetchLeadContacts(normalizedLeadId, isLegacyLead);
        setLeadContacts(contacts);
      } catch (error) {
        console.error('Error fetching contacts:', error);
        setLeadContacts([]);
      }
    };
    
    loadContacts();
  }, [client?.id, client?.lead_type]);

  // Fetch WhatsApp templates on component mount
  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const templates = await fetchWhatsAppTemplates();
        setWhatsAppTemplates(templates);
        console.log(`✅ Loaded ${templates.length} WhatsApp templates for interactions tab:`, templates.map(t => ({ id: t.id, name: t.title || t.name360, language: t.language })));
        
        // If interactions are already loaded, trigger a re-fetch to process templates
        // Use setTimeout to ensure state is updated and ref is available
        setTimeout(() => {
          if (interactions.length > 0) {
            console.log('🔄 Templates loaded, reprocessing interactions to apply template content...');
            if (fetchInteractionsRef.current) {
              fetchInteractionsRef.current({ bypassCache: true });
            }
          }
        }, 200);
      } catch (error) {
        console.error('Error fetching WhatsApp templates:', error);
        setWhatsAppTemplates([]);
      }
    };
    
    loadTemplates();
  }, []);

  const fetchInteractionsRef = useRef<typeof fetchInteractions | null>(null);
  useEffect(() => {
    fetchInteractionsRef.current = fetchInteractions;
    console.log('✅ fetchInteractionsRef updated');
  }, [fetchInteractions]);

  // Reprocess interactions when templates become available
  useEffect(() => {
    if (whatsAppTemplates.length > 0 && interactions.length > 0) {
      // Check if any WhatsApp interactions need template processing
      const whatsappInteractions = interactions.filter((i: any) => i.kind === 'whatsapp' && i.direction === 'out');
      const needsProcessing = whatsappInteractions.some((interaction: any) => 
        interaction.content?.includes('[Template:') || 
        interaction.content?.includes('Template:') || 
        interaction.content?.includes('TEMPLATE_MARKER:')
      );
      
      if (needsProcessing) {
        console.log('🔄 Templates are available, reprocessing WhatsApp interactions to apply template content...');
        // Use a delay to avoid infinite loops and ensure everything is ready
        const timeoutId = setTimeout(() => {
          if (fetchInteractionsRef.current) {
            fetchInteractionsRef.current({ bypassCache: true });
          }
        }, 300);
        return () => clearTimeout(timeoutId);
      }
    }
  }, [whatsAppTemplates.length]); // Only depend on templates length, not interactions to avoid loops


  const hydrateEmailBodies = useCallback(async (messages: { id: string; subject: string; bodyPreview: string }[]) => {
    if (!messages || messages.length === 0) return;
    if (!userId) return;

    const requiresHydration = messages.filter(message => {
      const preview = (message.bodyPreview || '').trim();
      if (!preview) return true;
      const normalisedPreview = preview.replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/g, ' ').trim();
      return normalisedPreview.length < 8 || normalisedPreview === message.subject;
    });

    if (requiresHydration.length === 0) return;

    try {
      const updates: Record<string, { html: string; preview: string }> = {};

      await Promise.all(
        requiresHydration.map(async message => {
          if (!message.id) return;
          try {
            const rawContent = await fetchEmailBodyFromBackend(userId, message.id);
            if (!rawContent || typeof rawContent !== 'string') return;

            const cleanedHtml = sanitizeEmailHtml(extractHtmlBody(rawContent));
            const previewHtml =
              cleanedHtml && cleanedHtml.trim()
                ? cleanedHtml
                : sanitizeEmailHtml(convertBodyToHtml(rawContent));

            updates[message.id] = {
              html: cleanedHtml,
              preview: previewHtml,
            };

            await supabase
              .from('emails')
              .update({ body_html: rawContent, body_preview: rawContent })
              .eq('message_id', message.id);
          } catch (err) {
            console.error('Unexpected error hydrating email body', err);
          }
        })
      );

      if (Object.keys(updates).length > 0) {
        setEmails(prev =>
          prev.map(email => {
            const update = updates[email.id];
            if (!update) return email;
            return {
              ...email,
              bodyPreview: update.preview,
            };
          })
        );
      }
    } catch (error) {
      console.error('Failed to hydrate email bodies from backend', error);
    }
  }, [userId]);

  const fetchEmailsForModal = useCallback(async () => {
    if (!client.id) return;
    
    setEmailsLoading(true);
    try {
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      const legacyId = isLegacyLead ? parseInt(client.id.replace('legacy_', '')) : null;

      let emailQuery = supabase
        .from('emails')
        .select(
          'id, message_id, sender_name, sender_email, recipient_list, subject, body_html, body_preview, sent_at, direction, attachments, contact_id'
        )
        .order('sent_at', { ascending: true });

      if (isLegacyLead && legacyId !== null) {
        emailQuery = emailQuery.eq('legacy_id', legacyId);
      } else {
        emailQuery = emailQuery.eq('client_id', client.id);
      }
      
      // Note: We'll filter by contact client-side to handle both contact_id and email matching
      // This ensures we catch emails that might not have contact_id set yet
      
      const { data: emailData, error: emailError } = await emailQuery;
      
      if (emailError) {
        console.error('❌ Error fetching emails for InteractionsTab:', emailError);
      } else {
        let clientEmails = emailData || [];
        console.log(`📧 InteractionsTab fetched ${clientEmails.length} emails for client ${client.id}`);
        
        // Strict client-side filtering if contact is selected
        if (selectedContactForEmail?.contact.id) {
          const contactId = Number(selectedContactForEmail.contact.id);
          const contactEmail = selectedContactForEmail.contact.email?.toLowerCase().trim();
          
          console.log(`🔍 Filtering emails for contact ID: ${contactId}, email: ${contactEmail}`);
          
          clientEmails = clientEmails.filter((e: any) => {
            // STRICT RULE: If email has contact_id, it MUST match exactly (no fallback to email matching)
            if (e.contact_id !== null && e.contact_id !== undefined) {
              const emailContactId = Number(e.contact_id);
              return emailContactId === contactId;
            }
            
            // Only if email has NO contact_id, then match by email address
            // This is a fallback for old emails that don't have contact_id set yet
            if (contactEmail) {
              const senderEmail = e.sender_email?.toLowerCase().trim();
              const recipientList = e.recipient_list?.toLowerCase() || '';
              
              // Split recipient_list by comma/semicolon and check for exact match
              const recipients = recipientList.split(/[,;]/).map((r: string) => r.trim());
              const matchesEmail = senderEmail === contactEmail || recipients.includes(contactEmail);
              
              if (matchesEmail) {
                console.log(`✅ Including email ${e.id} by email match: ${contactEmail}`);
              }
              return matchesEmail;
            }
            
            // No contact email to match, exclude this email
            console.log(`❌ Excluding email ${e.id}: no contact email to match`);
            return false;
          });
          
          console.log(`📧 After strict filtering by contact, ${clientEmails.length} emails remain`);
        }
        
        // Format emails for modal display
        const formattedEmailsForModal = clientEmails.map((e: any) => {
          const rawHtml = typeof e.body_html === 'string' ? e.body_html : null;
          const rawPreview = typeof e.body_preview === 'string' ? e.body_preview : null;
          const cleanedHtml = rawHtml && rawHtml.trim() ? extractHtmlBody(rawHtml) : null;
          const cleanedPreview = rawPreview && rawPreview.trim() ? extractHtmlBody(rawPreview) : null;
          const fallbackText = cleanedPreview || cleanedHtml || e.subject || '';
          return {
          id: e.message_id,
          subject: e.subject,
          from: e.sender_email,
          to: e.recipient_list,
          date: e.sent_at,
            bodyPreview: cleanedHtml ?? (fallbackText ? convertBodyToHtml(fallbackText) : ''),
          direction: e.direction,
          attachments: e.attachments,
          contact_id: e.contact_id,
          };
        });
        
        setEmails(formattedEmailsForModal);
      }
    } catch (error) {
      console.error('❌ Error in fetchEmailsForModal:', error);
      setEmails([]);
    } finally {
      setEmailsLoading(false);
    }
  }, [client, selectedContactForEmail]);

  const runMailboxSync = useCallback(async () => {
    if (!userId) {
      toast.error('Sign in to sync emails.');
      return;
    }
    if (!mailboxStatus.connected) {
      toast.error('Connect your mailbox to sync emails.');
      return;
    }

    setEmailsLoading(true);

    try {
      await triggerMailboxSync(userId);
      await refreshMailboxStatus();
      if (onClientUpdate) {
        await onClientUpdate();
      }
      await fetchEmailsForModal();
    } catch (e) {
      console.error('Mailbox sync failed:', e);
      const message = e instanceof Error ? e.message : 'Failed to sync new emails from server.';
      toast.error(message);
    } finally {
      setEmailsLoading(false);
    }
  }, [userId, mailboxStatus.connected, onClientUpdate, fetchEmailsForModal, refreshMailboxStatus]);

  const syncOnComposeRef = useRef(false);
  useEffect(() => {
    if (showCompose) {
      if (!syncOnComposeRef.current) {
        syncOnComposeRef.current = true;
        runMailboxSync();
      }
    } else {
      syncOnComposeRef.current = false;
    }
  }, [showCompose, runMailboxSync]);

  // Effect to run the slow sync only once when the component mounts
  // DISABLED: Graph sync is too slow and blocks UI loading
  // Run Graph sync only on explicit user action (like clicking refresh)
  useEffect(() => {
    // Skip automatic Graph sync for now - it's causing the 4-second delay
    // Users can manually sync emails if needed
    console.log('InteractionsTab mounted - skipping automatic mailbox sync for performance');
  }, [client.id]);

  // Handle AI suggestions for email compose
  const handleAISuggestions = async () => {
    if (!client || isLoadingAI) return;

    setIsLoadingAI(true);
    setShowAISuggestions(true);
    
    try {
      const requestType = composeBody.trim() ? 'improve' : 'suggest';
      
      // Get email conversation history from interactions
      const emailInteractions = interactions.filter(interaction => 
        interaction.kind === 'email' && interaction.content
      );
      
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-ai-suggestions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          currentMessage: composeBody.trim(),
          conversationHistory: emailInteractions.map(interaction => ({
            id: interaction.id,
            direction: interaction.direction === 'out' ? 'out' : 'in',
            message: interaction.content || '',
            sent_at: interaction.date + ' ' + interaction.time,
            sender_name: interaction.employee || 'Unknown'
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
    setComposeBody(suggestion);
    setShowAISuggestions(false);
    setAiSuggestions([]);
  };

  const handleSendEmail = async () => {
    if (!userId) {
      toast.error('Please sign in to send emails.');
      return;
    }
    if (!mailboxStatus.connected) {
      toast.error('Connect your mailbox before sending emails.');
      return;
    }

    const finalToRecipients = [...composeToRecipients];
    const finalCcRecipients = [...composeCcRecipients];

    try {
      if (composeToInput.trim()) {
        pushComposeRecipient(finalToRecipients, composeToInput.trim());
      }
      if (composeCcInput.trim()) {
        pushComposeRecipient(finalCcRecipients, composeCcInput.trim());
      }
    } catch (error) {
      setComposeRecipientError((error as Error).message || 'Please enter a valid email address.');
      return;
    }

    if (composeToInput.trim()) {
      setComposeToRecipients(finalToRecipients);
      setComposeToInput('');
    }
    if (composeCcInput.trim()) {
      setComposeCcRecipients(finalCcRecipients);
      setComposeCcInput('');
    }

    if (finalToRecipients.length === 0) {
      const fallbackRecipients = normaliseAddressList(client.email);
      if (fallbackRecipients.length > 0) {
        finalToRecipients.push(...fallbackRecipients);
      }
    }

    if (finalToRecipients.length === 0) {
      setComposeRecipientError('Please add at least one recipient.');
      return;
    }

    setComposeRecipientError(null);
    setSending(true);

    try {
      const bodyHtml = convertBodyToHtml(composeBody);
      const emailContentWithSignature = await appendEmailSignature(bodyHtml);
      const subject = composeSubject && composeSubject.trim()
        ? composeSubject
        : `[${client.lead_number}] - ${client.name}`;
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      const legacyId = isLegacyLead
        ? (() => {
            const numeric = parseInt(String(client.id).replace('legacy_', ''), 10);
            return Number.isNaN(numeric) ? null : numeric;
          })()
        : null;
      const senderName = currentUserFullName || userEmail || 'Your Team';

      // Find the contact_id from the selected contact or the first recipient
      let contactId: number | null = selectedContactId;
      if (!contactId && finalToRecipients.length > 0) {
        // Try to find contact by email
        const contactByEmail = leadContacts.find(c => c.email === finalToRecipients[0]);
        if (contactByEmail) {
          contactId = contactByEmail.id;
        }
      }

      const sendResult = await sendEmailViaBackend({
        userId,
        subject,
        bodyHtml: emailContentWithSignature,
        to: finalToRecipients,
        cc: finalCcRecipients,
        attachments: composeAttachments,
        context: {
          clientId: !isLegacyLead ? client.id : null,
          legacyLeadId: isLegacyLead ? legacyId : null,
          leadType: client.lead_type || (isLegacyLead ? 'legacy' : 'new'),
          leadNumber: client.lead_number || null,
          contactEmail: client.email || null,
          contactName: client.name || null,
          contactId: contactId || null,
          senderName,
          userInternalId: client.user_internal_id || undefined,
        },
      });

      const messageId = sendResult?.id || sendResult?.messageId || `temp_${Date.now()}`;
      const conversationId = sendResult?.conversationId || null;
      const sentAt = sendResult?.sentAt || new Date().toISOString();
      
      toast.success('Email sent!');
      await fetchInteractionsRef.current?.({ bypassCache: true });
      await fetchEmailsForModal();

      if (onClientUpdate) {
        await onClientUpdate();
      }

      setComposeBody('');
      setComposeAttachments([]);
      setShowComposeLinkForm(false);
      setComposeLinkLabel('');
      setComposeLinkUrl('');
      setShowCompose(false);
    } catch (e) {
      console.error('Error in handleSendEmail:', e);
      toast.error(e instanceof Error ? e.message : 'Failed to send email.');
    } finally {
      setSending(false);
    }
  };

  const handleDownloadAttachment = async (messageId: string, attachment: Attachment) => {
    if (downloadingAttachments[attachment.id]) return;
    if (!userId) {
      toast.error('Please sign in to download attachments.');
      return;
    }
    if (!mailboxStatus.connected) {
      toast.error('Connect your mailbox to download attachments.');
      return;
    }

    setDownloadingAttachments(prev => ({ ...prev, [attachment.id]: true }));
    toast.loading(`Downloading ${attachment.name}...`, { id: attachment.id });

    try {
      const { blob, fileName } = await downloadAttachmentFromBackend(userId, messageId, attachment.id);
      const downloadName = fileName || attachment.name || 'attachment';
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      toast.success(`${downloadName} downloaded.`, { id: attachment.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed.', { id: attachment.id });
    } finally {
      setDownloadingAttachments(prev => ({ ...prev, [attachment.id]: false }));
    }
  };

  const handleAttachmentUpload = async (files: FileList) => {
    if (!files || files.length === 0) return;
    
    for (const file of Array.from(files)) {
      if (file.size > 4 * 1024 * 1024) { // 4MB limit
        toast.error(`${file.name} is too large. Please choose files under 4MB.`);
        continue;
      }
      
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const base64Content = content.split(',')[1];
          if (!base64Content) throw new Error('Could not read file content.');

          setComposeAttachments(prev => [...prev, {
            name: file.name,
            contentType: file.type,
            contentBytes: base64Content
          }]);
          toast.success(`${file.name} attached.`);
        } catch (err) {
          toast.error(`Error processing ${file.name}.`);
        }
      };
      reader.onerror = () => {
        toast.error(`Failed to read ${file.name}.`);
      };
      reader.readAsDataURL(file);
    }
  };

  // Set the subject when the email modal opens (if not already set by user)
  useEffect(() => {
    if (isEmailModalOpen) {
      // Use selected contact's name if available, otherwise use client name
      const nameToUse = selectedContactForEmail?.contact.name || client.name;
      const defaultSubject = `[${client.lead_number}] - ${nameToUse} - ${client.topic || ''}`;
      setComposeSubject(prev => prev && prev.trim() ? prev : defaultSubject);
      
      // Fetch emails when modal opens - add delay to ensure contact is set if it was just set
      const fetchDelay = selectedContactForEmail ? 200 : 0;
      setTimeout(() => {
        fetchEmailsForModal();
      }, fetchDelay);
      
      if (!mailboxStatusRequestedRef.current) {
        mailboxStatusRequestedRef.current = true;
        refreshMailboxStatus();
      }
    }
  }, [isEmailModalOpen, client, fetchEmailsForModal, selectedContactForEmail]);

  // Separate effect to re-fetch emails when selected contact changes (while modal is open)
  useEffect(() => {
    if (isEmailModalOpen && selectedContactForEmail) {
      fetchEmailsForModal();
    }
  }, [selectedContactForEmail?.contact.id, isEmailModalOpen, fetchEmailsForModal]);

  // Clear selected contact when email modal closes
  useEffect(() => {
    if (!isEmailModalOpen) {
      setSelectedContactForEmail(null);
    }
  }, [isEmailModalOpen]);

  // Update openEditDrawer to return a Promise and always fetch latest data for manual interactions
  const openEditDrawer = async (idx: number) => {
    const row = interactions[idx];
    let latestRow = row;
    if (row.id && row.id.toString().startsWith('manual_')) {
      const { data, error } = await supabase
        .from('leads')
        .select('manual_interactions')
        .eq('id', client.id)
        .single();
      if (!error && data?.manual_interactions) {
        const found = data.manual_interactions.find((i: any) => i.id === row.id || i.id === Number(row.id));
        if (found) {
          latestRow = { ...row, ...found };
        }
      }
    }
    setActiveInteraction(latestRow);
    setEditData({
      date: latestRow.date || '',
      time: latestRow.time || '',
      content: latestRow.content || '',
      observation: latestRow.observation || '',
      length: latestRow.length ? String(latestRow.length).replace(/m$/, '') : '',
    });
    setDetailsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDetailsDrawerOpen(false);
    setActiveInteraction(null);
  };

  const handleEditChange = (field: string, value: string) => {
    setEditData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!activeInteraction) return;
    
    const isManual = activeInteraction.id.toString().startsWith('manual_');

    // --- Optimistic Update ---
    const previousInteractions = [...interactions];
    const updatedInteractions = interactions.map((interaction) => {
      if (interaction.id === activeInteraction.id) {
        return {
          ...interaction,
          date: editData.date,
          time: editData.time,
          content: editData.content,
          observation: editData.observation,
          length: editData.length ? `${editData.length}m` : '',
        };
      }
      return interaction;
    });
    setInteractions(updatedInteractions);
    closeDrawer();
    // --- End Optimistic Update ---

    try {
      if (isManual) {
        const updatedManualInteraction = updatedInteractions.find(i => i.id === activeInteraction.id);
        if (updatedManualInteraction) {
          const allManualInteractions = updatedInteractions.filter(i => i.id.toString().startsWith('manual_'));
          
          // Update manual_interactions and latest_interaction timestamp for new leads
          const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
          if (!isLegacyLead) {
            const { error } = await supabase
              .from('leads')
              .update({ 
                manual_interactions: allManualInteractions,
                latest_interaction: new Date().toISOString()
              })
              .eq('id', client.id);
            if (error) throw error;
          } else {
            const { error } = await supabase
              .from('leads')
              .update({ manual_interactions: allManualInteractions })
              .eq('id', client.id);
            if (error) throw error;
          }
        }
      } else {
        const { error } = await supabase
          .from('emails')
          .update({ observation: editData.observation })
          .eq('message_id', activeInteraction.id);
        if (error) throw error;
      }
      
      toast.success('Interaction updated!');
      if (onClientUpdate) await onClientUpdate(); // Silently refresh data
    } catch (error) {
      toast.error('Update failed. Reverting changes.');
      setInteractions(previousInteractions); // Revert on failure
      console.error(error);
    }
  };

  const openContactDrawer = () => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear().toString().slice(-2)}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    setNewContact({
      method: 'email',
      date,
      time,
      length: '',
      content: '',
      observation: '',
    });
    setContactDrawerOpen(true);
  };

  const closeContactDrawer = () => {
    setContactDrawerOpen(false);
  };

  const handleNewContactChange = (field: string, value: string) => {
    setNewContact((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveContact = async () => {
    if (!client) return;

    // Ensure we have the current user's full name
    let userFullName = currentUserFullName;
    if (!userFullName) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.id) {
          const { data: userData } = await supabase
            .from('users')
            .select(`
              full_name,
              employee_id,
              tenants_employee!employee_id(
                display_name
              )
            `)
            .eq('auth_id', user.id)
            .single();
          if (userData) {
            // Use display_name from tenants_employee if available, otherwise full_name
            const employee = Array.isArray(userData.tenants_employee) ? userData.tenants_employee[0] : userData.tenants_employee;
            userFullName = employee?.display_name || userData.full_name;
          }
        }
      } catch (error) {
        console.error('Error fetching user info:', error);
      }
    }

    const now = new Date();
    const newInteraction: Interaction = {
      id: `manual_${now.getTime()}`,
      date: newContact.date || now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }),
      time: newContact.time || now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      raw_date: now.toISOString(),
      employee: userFullName || 'You',
      direction: 'out',
      kind: newContact.method,
      length: newContact.length ? `${newContact.length}m` : '',
      content: newContact.content,
      observation: newContact.observation,
      editable: true,
    };

    // --- Optimistic Update ---
    const previousInteractions = [...interactions];
    const newInteractions = [newInteraction, ...interactions].sort((a, b) => new Date(b.raw_date).getTime() - new Date(a.raw_date).getTime());
    setInteractions(newInteractions);
    closeContactDrawer();
    // --- End Optimistic Update ---

    try {
      if (newContact.method === 'call_log') {
        // Get current user's employee ID for the call log
        let employeeId = null;
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user?.id) {
            const { data: userData } = await supabase
              .from('users')
              .select('employee_id')
              .eq('auth_id', user.id)
              .single();
            if (userData?.employee_id) {
              employeeId = userData.employee_id;
            }
          }
        } catch (error) {
          console.log('Could not fetch employee_id for call log:', error);
        }

        // Save to call_logs table
        const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
        const callLogData: any = {
          cdate: now.toISOString().split('T')[0],
          direction: 'Manual Entry',
          date: newContact.date ? new Date(newContact.date).toISOString().split('T')[0] : now.toISOString().split('T')[0],
          time: newContact.time || now.toTimeString().split(' ')[0].substring(0, 5),
          status: 'ANSWERED', // Default for manual entries
          duration: newContact.length ? parseInt(newContact.length) * 60 : 0, // Convert minutes to seconds
          employee_id: employeeId, // Include employee_id for JOIN queries
          action: ''
        };
        
        if (isLegacyLead) {
          const legacyId = parseInt(client.id.replace('legacy_', ''));
          callLogData.lead_id = legacyId;
        } else {
          callLogData.client_id = client.id;
        }
        
        const { error: callLogError } = await supabase
          .from('call_logs')
          .insert(callLogData);

        if (callLogError) throw callLogError;
        
        toast.success('Call log saved!');
        if (onClientUpdate) await onClientUpdate(); // Silently refresh data
      } else {
        // Save to manual_interactions
        const existingInteractions = client.manual_interactions || [];
        const updatedInteractions = [...existingInteractions, newInteraction];

        // Update manual_interactions and latest_interaction timestamp
        const { error: updateError } = await supabase
          .from('leads')
          .update({ 
            manual_interactions: updatedInteractions,
            latest_interaction: now.toISOString()
          })
          .eq('id', client.id);

        if (updateError) throw updateError;
        
        toast.success('Interaction saved!');
        if (onClientUpdate) await onClientUpdate(); // Silently refresh data
      }

    } catch (error) {
      toast.error('Save failed. Reverting changes.');
      setInteractions(previousInteractions); // Revert on failure
      console.error(error);
    }
  };

  // Combine emails and WhatsApp messages for AI summary
  const aiSummaryMessages = [
    // Emails
    ...emails.map(email => ({
      type: 'email',
      direction: email.direction === 'outgoing' ? 'out' : 'in',
      from: email.from,
      to: email.to,
      date: email.date,
      content: email.bodyPreview,
      subject: email.subject,
    })),
    // WhatsApp messages
    ...whatsAppMessages.map(msg => ({
      type: 'whatsapp',
      direction: msg.direction === 'out' ? 'out' : 'in',
      from: msg.sender_name || 'You',
      to: client.name,
      date: msg.date,
      content: msg.content,
    })),
  ].sort((a, b) => {
    // Sort by date descending (emails have full date, WhatsApp only time)
    const aDate = new Date(a.date);
    const bDate = new Date(b.date);
    return bDate.getTime() - aDate.getTime();
  });

  useEffect(() => {
    // Set default font size and family for new content
    const quillEditor = document.querySelector('.ql-editor');
    if (quillEditor) {
      (quillEditor as HTMLElement).style.fontSize = '16px';
      (quillEditor as HTMLElement).style.fontFamily = 'system-ui, Arial, sans-serif';
      (quillEditor as HTMLElement).style.lineHeight = '1.7';
      (quillEditor as HTMLElement).style.padding = '18px 16px';
    }
  }, []);

  useEffect(() => {
    if (isWhatsAppOpen) {
      console.log('WhatsApp client.id:', client.id);
      console.log('WhatsApp messages:', whatsAppMessages);
    }
  }, [isWhatsAppOpen, client.id]); // Removed whatsAppMessages dependency

  // Effect: when WhatsApp modal opens and activeWhatsAppId is set, scroll to and highlight the message
  React.useEffect(() => {
    if (isWhatsAppOpen && activeWhatsAppId) {
      setTimeout(() => {
        const el = document.querySelector(`[data-whatsapp-id="${activeWhatsAppId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          (el.firstChild as HTMLElement)?.classList?.add('ring-2', 'ring-primary');
          setTimeout(() => (el.firstChild as HTMLElement)?.classList?.remove('ring-2', 'ring-primary'), 1200);
        }
      }, 300);
    }
  }, [isWhatsAppOpen, activeWhatsAppId]);

  useEffect(() => {
    if (!isEmailModalOpen) return;
    
    // Use selected contact's email if available, otherwise fall back to client email
    const emailToUse = selectedContactForEmail?.contact.email || client.email;
    const initialRecipients = normaliseAddressList(emailToUse);
    setComposeToRecipients(initialRecipients.length > 0 ? initialRecipients : []);
    setComposeCcRecipients([]);
    setComposeToInput('');
    setComposeCcInput('');
    setComposeRecipientError(null);
    setShowComposeLinkForm(false);
    setComposeLinkLabel('');
    setComposeLinkUrl('');
    setSelectedComposeTemplateId(null);
    setComposeTemplateSearch('');
  }, [isEmailModalOpen, client.email, selectedContactForEmail]);

  useEffect(() => {
    if (!isEmailModalOpen) return;

    let isMounted = true;
    const loadTemplates = async () => {
      try {
        const { data, error } = await supabase
          .from('misc_emailtemplate')
              .select('*')
              .eq('active', 't')
              .order('name', { ascending: true });

        if (error) throw error;
        if (!isMounted) return;

        const parsed = (data || []).map((template: any) => ({
          id: typeof template.id === 'number' ? template.id : Number(template.id),
          name: template.name || `Template ${template.id}`,
          subject: typeof template.subject === 'string' ? template.subject : null,
          content: parseTemplateContent(template.content),
          rawContent: template.content || '',
          languageId: template.language_id ?? null,
        }));

        setComposeTemplates(parsed);
      } catch (error) {
        console.error('Failed to load email templates:', error);
        if (isMounted) {
          setComposeTemplates([]);
        }
      }
    };

    loadTemplates();
    return () => {
      isMounted = false;
    };
  }, [isEmailModalOpen]);

  useEffect(() => {
    if (!composeTemplateDropdownOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (composeTemplateDropdownRef.current && !composeTemplateDropdownRef.current.contains(event.target as Node)) {
        setComposeTemplateDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [composeTemplateDropdownOpen]);

  return (
    <div className="p-4 md:p-6 lg:p-8 flex flex-col xl:flex-row gap-6 md:gap-8 lg:gap-12 items-start min-h-screen max-w-7xl mx-auto">
      <div className="relative w-full flex-1 min-w-0">
        {/* Loading indicator */}
        {interactionsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="loading loading-spinner loading-lg text-primary"></div>
            <span className="ml-3 text-lg">Loading interactions...</span>
          </div>
        ) : (
          <>
            {/* Header with Contact Client Dropdown and AI Smart Recap */}
            <div className="w-full flex flex-col sm:flex-row items-stretch sm:items-center gap-4 mb-8 md:mb-12">
              <div className="dropdown">
                <label tabIndex={0} className="btn btn-outline btn-primary flex items-center gap-2 cursor-pointer w-full sm:w-auto justify-center">
                  <UserIcon className="w-5 h-5" /> Contact Client <ChevronDownIcon className="w-4 h-4 ml-1" />
                </label>
                <ul tabIndex={0} className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52 mt-2 z-[100]">
                  <li>
                    <button className="flex gap-2 items-center" onClick={() => {
                      // Show contact selector first
                      setShowContactSelectorForEmail(true);
                    }}>
                      <EnvelopeIcon className="w-5 h-5" /> Email
                    </button>
                  </li>
                  <li>
                    <button className="flex gap-2 items-center" onClick={() => {
                      // Show contact selector first
                      setShowContactSelector(true);
                    }}>
                      <FaWhatsapp className="w-5 h-5" /> WhatsApp
                    </button>
                  </li>
                  <li>
                    <button className="flex gap-2 items-center" onClick={openContactDrawer}>
                      <ChatBubbleLeftRightIcon className="w-5 h-5" /> Contact
                    </button>
                  </li>
                </ul>
              </div>
              
              {/* AI Smart Recap Button */}
              <button 
                className="btn bg-gradient-to-r from-purple-600 to-indigo-600 text-white border-none hover:from-purple-700 hover:to-indigo-700 shadow-lg w-full sm:w-auto justify-center"
                onClick={() => {
                  // Toggle AI summary panel on mobile, or show/hide it on desktop
                  if (window.innerWidth < 1024) {
                    // Mobile: show drawer with AI summary
                    setAiDrawerOpen(true);
                  } else {
                    // Desktop: toggle AI panel visibility
                    setShowAiSummary(!showAiSummary);
                  }
                }}
              >
                <SparklesIcon className="w-5 h-5" />
                AI Smart Recap
              </button>
              
            </div>
            
            {/* Timeline container with improved spacing */}
            <div className="relative max-w-5xl">
              {/* Timeline line */}
              <div className="absolute left-8 sm:left-12 md:left-16 top-0 bottom-0 w-1 bg-gradient-to-b from-primary via-accent to-secondary shadow-lg" style={{ zIndex: 0 }} />
              
              <div className="space-y-8 md:space-y-10 lg:space-y-12">
              {renderedInteractions
                .map((row, idx) => {
                // Debug: Log first few WhatsApp messages being rendered
                if (row.kind === 'whatsapp' && idx < 3) {
                  console.log(`🔍 Rendering WhatsApp message ${idx}:`, {
                    id: row.id,
                    kind: row.kind,
                    content: row.content?.substring(0, 50),
                    raw_date: row.raw_date,
                    employee: row.employee,
                    direction: row.direction
                  });
                }
                
                // Date formatting with validation and fallback
                let dateObj: Date;
                if (!row.raw_date) {
                  console.warn('⚠️ Interaction missing raw_date in render, using current date:', { id: row.id, kind: row.kind });
                  dateObj = new Date();
                } else {
                  dateObj = new Date(row.raw_date);
                  if (isNaN(dateObj.getTime())) {
                    console.warn('⚠️ Interaction has invalid raw_date in render, using current date:', { id: row.id, kind: row.kind, raw_date: row.raw_date });
                    dateObj = new Date();
                  }
                }
                
                const day = dateObj.getDate().toString().padStart(2, '0');
                const month = dateObj.toLocaleString('en', { month: 'short' });
                const time = dateObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
              
              // Icon and color
              let icon, iconBg, cardBg, textGradient, avatarBg;
              if (row.direction === 'out') {
                // Employee (Outgoing)
                if (row.kind === 'sms') {
                  icon = <ChatBubbleLeftRightIcon className="w-4 h-4 md:w-5 md:h-5 !text-purple-600 drop-shadow-sm" style={{color: '#9333ea'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-purple-200';
                } else if (row.kind === 'call') {
                  // Different colors based on call status
                  if (row.status === 'ANSWERED') {
                    icon = <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 !text-emerald-600 drop-shadow-sm" style={{color: '#059669'}} />;
                    iconBg = 'bg-white shadow-lg border-2 border-emerald-200';
                  } else if (row.status === 'NO+ANSWER' || row.status === 'NO ANSWER') {
                    icon = <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 !text-red-600 drop-shadow-sm" style={{color: '#dc2626'}} />;
                    iconBg = 'bg-white shadow-lg border-2 border-red-200';
                  } else if (row.status === 'MISSED') {
                    icon = <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 !text-orange-600 drop-shadow-sm" style={{color: '#ea580c'}} />;
                    iconBg = 'bg-white shadow-lg border-2 border-orange-200';
                  } else {
                    icon = <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 !text-blue-600 drop-shadow-sm" style={{color: '#2563eb'}} />;
                    iconBg = 'bg-white shadow-lg border-2 border-blue-200';
                  }
                } else if (row.kind === 'whatsapp') {
                  icon = <FaWhatsapp className="w-4 h-4 md:w-5 md:h-5 !text-green-600 drop-shadow-sm" style={{color: '#16a34a'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-green-200';
                } else if (row.kind === 'email') {
                  icon = <EnvelopeIcon className="w-4 h-4 md:w-5 md:h-5 !text-blue-600 drop-shadow-sm" style={{color: '#2563eb'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-blue-200';
                } else if (row.kind === 'office') {
                  icon = <UserIcon className="w-4 h-4 md:w-5 md:h-5 !text-orange-600 drop-shadow-sm" style={{color: '#ea580c'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-orange-200';
                } else {
                  icon = <UserIcon className="w-4 h-4 md:w-5 md:h-5 !text-gray-600 drop-shadow-sm" style={{color: '#4b5563'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-gray-200';
                }
                cardBg = 'bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600';
                textGradient = 'bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 bg-clip-text text-transparent';
                avatarBg = 'bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white';
              } else {
                // Client (Ingoing)
                if (row.kind === 'sms') {
                  icon = <ChatBubbleLeftRightIcon className="w-4 h-4 md:w-5 md:h-5 !text-indigo-600 drop-shadow-sm" style={{color: '#4f46e5'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-indigo-200';
                } else if (row.kind === 'call') {
                  // Different colors based on call status
                  if (row.status === 'ANSWERED') {
                    icon = <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 !text-teal-600 drop-shadow-sm" style={{color: '#0d9488'}} />;
                    iconBg = 'bg-white shadow-lg border-2 border-teal-200';
                  } else if (row.status === 'NO+ANSWER' || row.status === 'NO ANSWER') {
                    icon = <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 !text-rose-600 drop-shadow-sm" style={{color: '#e11d48'}} />;
                    iconBg = 'bg-white shadow-lg border-2 border-rose-200';
                  } else if (row.status === 'MISSED') {
                    icon = <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 !text-amber-600 drop-shadow-sm" style={{color: '#d97706'}} />;
                    iconBg = 'bg-white shadow-lg border-2 border-amber-200';
                  } else {
                    icon = <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 !text-cyan-600 drop-shadow-sm" style={{color: '#0891b2'}} />;
                    iconBg = 'bg-white shadow-lg border-2 border-cyan-200';
                  }
                } else if (row.kind === 'whatsapp') {
                  icon = <FaWhatsapp className="w-4 h-4 md:w-5 md:h-5 !text-green-600 drop-shadow-sm" style={{color: '#16a34a'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-green-200';
                } else if (row.kind === 'email') {
                  icon = <EnvelopeIcon className="w-4 h-4 md:w-5 md:h-5 !text-cyan-600 drop-shadow-sm" style={{color: '#0891b2'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-cyan-200';
                } else if (row.kind === 'office') {
                  icon = <UserIcon className="w-4 h-4 md:w-5 md:h-5 !text-amber-600 drop-shadow-sm" style={{color: '#d97706'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-amber-200';
                } else {
                  icon = <UserIcon className="w-4 h-4 md:w-5 md:h-5 !text-slate-600 drop-shadow-sm" style={{color: '#475569'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-slate-200';
                }
                cardBg = 'bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400';
                textGradient = 'bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 bg-clip-text text-transparent';
                avatarBg = 'bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white';
              }
              
              // Initials
              const initials = row.employee.split(' ').map(n => n[0]).join('').toUpperCase();
              
              return (
                <div
                  key={row.id}
                  ref={idx === lastEmailIdx ? lastEmailRef : null}
                  className="relative pl-16 sm:pl-20 md:pl-24 cursor-pointer group"
                  onClick={() => handleInteractionClick(row, idx)}
                >
                  {/* Timeline dot and icon, large, left-aligned */}
                  <div className="absolute -left-6 sm:-left-8 md:-left-10 top-0" style={{ zIndex: 2 }}>
                    <div className={`w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center shadow-xl ring-4 ring-white ${iconBg}`}>
                      {React.cloneElement(icon, { className: 'w-5 h-5 sm:w-6 sm:h-6 md:w-8 md:h-8' })}
                    </div>
                  </div>
                  
                  {/* Main content container with better spacing */}
                  <div className="flex flex-col lg:flex-row lg:items-start gap-4 lg:gap-6">
                    {/* Timestamp and metadata */}
                    <div className="flex-shrink-0 lg:w-32">
                      <div className="text-sm md:text-base font-semibold text-gray-700 mb-1">{day} {month}</div>
                      <div className="text-xs md:text-sm text-gray-500">{time}</div>
                      {row.length && row.length !== 'm' && (
                        <div className="text-xs text-gray-400 mt-1">{row.length}</div>
                      )}
                    </div>
                    
                    {/* Main content card */}
                    <div className="flex-1 min-w-0">
                      <div className={`p-[2px] rounded-2xl ${cardBg} shadow-xl hover:shadow-2xl transition-all duration-300 group-hover:scale-[1.02]`}>
                        <div className="bg-white rounded-2xl p-4 sm:p-5 md:p-6">
                          {/* Header section with employee info and status */}
                          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
                            <div className="flex items-center gap-3">
                              <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-bold ${avatarBg} text-sm sm:text-base`}>
                                {initials}
                              </div>
                              <div className="flex flex-col gap-1">
                                <div className={`font-semibold text-sm sm:text-base md:text-lg ${textGradient}`}>
                                  {row.employee}
                                </div>
                                {/* Show contact name for email and WhatsApp interactions */}
                                {(row.kind === 'email' || row.kind === 'whatsapp') && (() => {
                                  const interactionContactId = (row as any).contact_id;
                                  const senderEmail = (row as any).sender_email?.toLowerCase().trim();
                                  const recipientList = (row as any).recipient_list?.toLowerCase() || '';
                                  const phoneNumber = (row as any).phone_number;
                                  let contactName = null;
                                  
                                  // First, try to find by contact_id (most reliable)
                                  if (interactionContactId !== null && interactionContactId !== undefined) {
                                    if (leadContacts.length > 0) {
                                      const contact = leadContacts.find(c => c.id === Number(interactionContactId));
                                      if (contact) {
                                        contactName = contact.name;
                                      }
                                    }
                                  }
                                  
                                  // If not found by contact_id, try to match by email (for emails) or phone (for WhatsApp)
                                  if (!contactName && leadContacts.length > 0) {
                                    if (row.kind === 'email') {
                                      // Email matching logic
                                      const recipients = recipientList.split(/[,;]/).map((r: string) => r.trim().toLowerCase()).filter((r: string) => r);
                                      
                                      const isOutgoing = row.direction === 'out';
                                      for (const contact of leadContacts) {
                                        const contactEmail = contact.email?.toLowerCase().trim();
                                        if (contactEmail) {
                                          if (isOutgoing && recipients.includes(contactEmail)) {
                                            contactName = contact.name;
                                            break;
                                          } else if (!isOutgoing && senderEmail === contactEmail) {
                                            contactName = contact.name;
                                            break;
                                          }
                                        }
                                      }
                                    } else if (row.kind === 'whatsapp') {
                                      // WhatsApp matching logic - match by phone number
                                      if (phoneNumber) {
                                        // Normalize phone number (remove spaces, dashes, etc.)
                                        const normalizePhone = (phone: string) => phone.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '');
                                        const normalizedPhone = normalizePhone(phoneNumber);
                                        
                                        for (const contact of leadContacts) {
                                          const contactPhone = contact.phone ? normalizePhone(contact.phone) : null;
                                          const contactMobile = contact.mobile ? normalizePhone(contact.mobile) : null;
                                          
                                          // Try exact match first
                                          if (contactPhone === normalizedPhone || contactMobile === normalizedPhone) {
                                            contactName = contact.name;
                                            break;
                                          }
                                          
                                          // Try last 4 digits match (fallback)
                                          if (normalizedPhone.length >= 4) {
                                            const last4 = normalizedPhone.slice(-4);
                                            if ((contactPhone && contactPhone.slice(-4) === last4) || 
                                                (contactMobile && contactMobile.slice(-4) === last4)) {
                                              contactName = contact.name;
                                              break;
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                  
                                  return contactName ? (
                                    <div className="text-xs text-gray-500 flex items-center gap-1">
                                      <span>To:</span>
                                      <span className="font-medium text-gray-700">{contactName}</span>
                                    </div>
                                  ) : null;
                                })()}
                              </div>
                            </div>
                            
                            {/* Status badges */}
                            <div className="flex flex-wrap gap-2">
                              {/* Show status badge for WhatsApp and Call interactions */}
                              {row.kind === 'whatsapp' && row.status && (
                                <span className={`px-3 py-1 rounded-full font-medium shadow-sm ${cardBg} text-white text-xs ${row.status.toLowerCase().includes('not') ? 'opacity-80' : ''}`}>
                                  {row.status}
                                </span>
                              )}
                              {/* Call status badge - always show for calls */}
                              {row.kind === 'call' && (
                                <span className={`px-3 py-1 rounded-full font-medium shadow-sm text-xs ${
                                  row.status && row.status.toLowerCase() === 'answered' ? 'bg-green-500 text-white' :
                                  row.status && (row.status.toLowerCase() === 'no+answer' || row.status.toLowerCase() === 'no answer') ? 'bg-red-500 text-white' :
                                  row.status && row.status.toLowerCase() === 'failed' ? 'bg-red-500 text-white' :
                                  row.status && row.status.toLowerCase() === 'busy' ? 'bg-yellow-500 text-white' :
                                  'bg-gray-600 text-white'
                                }`}>
                                  {row.status === 'NO+ANSWER' ? 'NO ANSWER' : (row.status === 'unread' ? 'UNKNOWN' : (row.status || 'UNKNOWN'))}
                                </span>
                              )}
                              {row.length && row.length !== 'm' && (
                                <span className={`px-3 py-1 rounded-full font-medium shadow-sm ${cardBg} text-white text-xs`}>
                                  {row.length}
                                </span>
                              )}

                              {/* WhatsApp status indicator */}
                              {row.kind === 'whatsapp' && row.status && (
                                <div className="flex items-center gap-1">
                                  {renderMessageStatus(row.status, (row as any).error_message)}
                                  {row.status === 'failed' && (
                                    <span className="px-2 py-1 rounded-full font-medium shadow-sm bg-red-100 text-red-700 text-xs">
                                      Failed
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        
                          {/* Content section - hide content for calls since status is shown in badge */}
                          {row.content && row.kind !== 'call' && (
                            <div 
                              className="text-sm sm:text-base text-gray-700 break-words mb-4"
                              dir={getTextDirection(row.content)}
                              style={{ 
                                textAlign: containsRTL(row.content) ? 'right' : 'left',
                                lineHeight: '1.6'
                              }}
                            >
                              {/* Subject in bold with colon, then body with spacing */}
                              {row.subject ? (
                                <>
                                  <div 
                                    className="font-bold text-base sm:text-lg mb-2 text-gray-900"
                                    dir={getTextDirection(row.subject)}
                                    style={{ textAlign: containsRTL(row.subject) ? 'right' : 'left' }}
                                  >
                                    {row.subject}
                                  </div>
                                  <div 
                                    className="max-w-none whitespace-pre-wrap overflow-visible"
                                    style={{ lineHeight: '1.6', maxHeight: 'none' }}
                                    dir={getTextDirection(row.content)}
                                    dangerouslySetInnerHTML={{ 
                                      __html: row.renderedContent || row.renderedContentFallback || (row.content ? row.content.replace(/\n/g, '<br>') : '')
                                    }} 
                                  />
                                </>
                              ) : (
                                <div 
                                  className="max-w-none whitespace-pre-wrap overflow-visible"
                                  style={{ lineHeight: '1.6', maxHeight: 'none' }}
                                  dir={getTextDirection(row.content)}
                                  dangerouslySetInnerHTML={{ 
                                    __html: row.renderedContent || row.renderedContentFallback || (row.content ? row.content.replace(/\n/g, '<br>') : '')
                                  }} 
                                />
                              )}
                            </div>
                          )}
                          
                          {/* Call recording playback controls */}
                          {row.kind === 'call' && (
                            <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3 mb-4">
                              <div className="flex items-center gap-2">
                                <SpeakerWaveIcon className="w-5 h-5 text-gray-500" />
                                <div className="flex flex-col">
                                  <span className="text-sm font-medium text-gray-700">
                                    {row.recording_url ? 'Call Recording' : 'Recording not available'}
                                  </span>
                                </div>
                              </div>
                              {row.recording_url && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (playingAudioId === row.id) {
                                      handleStopRecording();
                                    } else {
                                      handlePlayRecording(row.recording_url!, row.id.toString());
                                    }
                                  }}
                                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                                    playingAudioId === row.id
                                      ? 'bg-red-500 text-white hover:bg-red-600 shadow-md'
                                      : 'bg-purple-500 text-white hover:bg-purple-600 shadow-md'
                                  }`}
                                >
                                  {playingAudioId === row.id ? (
                                    <>
                                      <StopIcon className="w-4 h-4" />
                                      Stop
                                    </>
                                  ) : (
                                    <>
                                      <PlayIcon className="w-4 h-4" />
                                      Play
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                          )}

                          {/* Observation/Notes */}
                          {row.observation && row.observation !== 'call-ended' && (
                            <div className="bg-purple-50 border-l-4 border-purple-400 p-3 rounded-r-lg">
                              <div className="flex items-start gap-2">
                                <div className="w-2 h-2 bg-purple-400 rounded-full mt-2 flex-shrink-0"></div>
                                <div>
                                  <div className="text-sm font-medium text-purple-900 mb-1">Note</div>
                                  <div className="text-sm text-purple-800 break-words">{row.observation}</div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
            .filter(Boolean)}

            {hasMoreInteractions && (
              <div className="flex justify-center pt-4">
                <button
                  className="btn btn-outline btn-primary"
                  onClick={() =>
                    setVisibleInteractionsCount(prev =>
                      Math.min(prev + INITIAL_VISIBLE_INTERACTIONS, sortedInteractions.length)
                    )
                  }
                >
                  Load more interactions ({sortedInteractions.length - visibleInteractionsCount})
                </button>
              </div>
            )}
              </div>
            </div>
            
            {/* Timeline and History Buttons at bottom */}
            <div className="mt-8 md:mt-12 pt-6 md:pt-8 border-t border-base-200">
              <TimelineHistoryButtons client={client} />
            </div>
          </>
        )}
      </div>
      {/* Right-side AI summary panel (hidden on mobile, conditional on desktop) */}
      {showAiSummary && (
        <div className="hidden xl:block w-full max-w-md ai-summary-panel">
          <div className="sticky top-8">
            <AISummaryPanel messages={aiSummaryMessages} />
          </div>
        </div>
      )}
      {/* Email Thread Modal - Inline modal showing all interactions filtered by selected contact */}
      {isEmailModalOpen && createPortal(
        <div className="fixed inset-0 bg-white z-[9999]">
          {/* CSS to ensure email content displays fully */}
          <style>{`
            .email-content .email-body {
              max-width: none !important;
              overflow: visible !important;
              word-wrap: break-word !important;
              white-space: pre-wrap !important;
            }
            .email-content .email-body * {
              max-width: none !important;
              overflow: visible !important;
            }
            .email-content .email-body img {
              max-width: 100% !important;
              height: auto !important;
            }
            .email-content .email-body table {
              width: 100% !important;
              border-collapse: collapse !important;
            }
            .email-content .email-body p, 
            .email-content .email-body div, 
            .email-content .email-body span {
              white-space: pre-wrap !important;
              word-wrap: break-word !important;
            }
          `}</style>
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between p-4 md:p-6 border-b border-gray-200">
              <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
                <h2 className="text-lg md:text-2xl font-bold text-gray-900">Interactions</h2>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0"></div>
                  <span className="text-gray-600 text-sm md:text-base truncate">
                    {selectedContactForEmail ? selectedContactForEmail.contact.name : client.name} ({client.lead_number})
                  </span>
                </div>
              </div>
              {selectedContactForEmail && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-100 rounded-lg border border-purple-200">
                  <span className="text-xs font-medium text-purple-700">Contact:</span>
                  <span className="text-sm font-semibold text-purple-900">{selectedContactForEmail.contact.name}</span>
                  {selectedContactForEmail.contact.isMain && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-purple-200 text-purple-800 rounded-full">Main</span>
                  )}
                </div>
              )}
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span
                    className={`inline-flex items-center gap-1 px-3 py-1 rounded-full font-semibold ${
                      mailboxStatus.connected
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-current"></span>
                    {mailboxStatus.connected ? 'Mailbox connected' : 'Mailbox disconnected'}
                  </span>
                  {formattedLastSync && (
                    <span>Last sync: {formattedLastSync}</span>
                  )}
                  {mailboxError && (
                    <span className="text-error">{mailboxError}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={runMailboxSync}
                    disabled={isMailboxLoading || emailsLoading || !mailboxStatus.connected || !userId}
                  >
                    {isMailboxLoading ? 'Syncing...' : 'Sync emails'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={handleMailboxConnect}
                    disabled={isMailboxLoading || !userId}
                  >
                    {mailboxStatus.connected ? 'Reconnect mailbox' : 'Connect mailbox'}
                  </button>
                  <button
                    onClick={() => setIsEmailModalOpen(false)}
                    className="btn btn-ghost btn-circle"
                  >
                    <XMarkIcon className="w-5 h-5 md:w-6 md:h-6" />
                  </button>
                </div>
              </div>
            </div>

            {/* Search Bar */}
            <div className="px-4 md:px-6 py-3 border-b border-gray-200 bg-gray-50">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  placeholder="Search emails by keywords, sender name, or recipient..."
                  value={emailSearchQuery}
                  onChange={(e) => setEmailSearchQuery(e.target.value)}
                />
                {emailSearchQuery && (
                  <button
                    onClick={() => setEmailSearchQuery('')}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  >
                    <XMarkIcon className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                  </button>
                )}
              </div>
            </div>

            {/* Email Thread */}
            <div className="flex-1 overflow-y-auto p-3 md:p-6 bg-white">
              {emailsLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="loading loading-spinner loading-lg text-purple-500"></div>
                </div>
              ) : emails.length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-500">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <p className="text-lg font-medium">No emails available</p>
                    <p className="text-sm">No emails found for {client.name}. Try syncing or send a new email.</p>
                  </div>
                </div>
              ) : emails.filter((message) => {
                if (!emailSearchQuery.trim()) return true;
                
                const searchTerm = emailSearchQuery.toLowerCase();
                
                // Search in subject
                if (message.subject && message.subject.toLowerCase().includes(searchTerm)) return true;
                
                // Search in email body content
                if (message.bodyPreview && message.bodyPreview.toLowerCase().includes(searchTerm)) return true;
                
                // Search in sender name (from field)
                if (message.from && message.from.toLowerCase().includes(searchTerm)) return true;
                
                // Search in recipient (to field)
                if (message.to && message.to.toLowerCase().includes(searchTerm)) return true;
                
                // Search in sender name (display name)
                const senderName = message.direction === 'outgoing' ? (currentUserFullName || 'Team') : client.name;
                if (senderName.toLowerCase().includes(searchTerm)) return true;
                
                return false;
              }).length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-500">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <MagnifyingGlassIcon className="w-8 h-8 text-gray-400" />
                    </div>
                    <p className="text-lg font-medium">No emails found</p>
                    <p className="text-sm">No emails match your search for "{emailSearchQuery}". Try a different search term.</p>
                    <button
                      onClick={() => setEmailSearchQuery('')}
                      className="mt-2 text-sm text-purple-600 hover:text-purple-800 underline"
                    >
                      Clear search
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {[...emails]
                    .filter((message) => {
                      // STRICT filtering by selected contact if one is selected
                      if (selectedContactForEmail) {
                        const contactId = Number(selectedContactForEmail.contact.id);
                        const contactEmail = selectedContactForEmail.contact.email?.toLowerCase().trim();
                        
                        // STRICT RULE: If email has contact_id, it MUST match exactly (no fallback to email matching)
                        if (message.contact_id !== null && message.contact_id !== undefined) {
                          const emailContactId = Number(message.contact_id);
                          if (emailContactId !== contactId) {
                            return false; // Different contact_id, exclude immediately
                          }
                          // contact_id matches, continue to search filter
                        } else {
                          // Only if email has NO contact_id, then match by email address (fallback for old emails)
                          if (contactEmail) {
                            const messageFrom = message.from?.toLowerCase().trim();
                            const messageTo = message.to?.toLowerCase().trim() || '';
                            
                            // Split recipient_list by comma/semicolon and check for exact match
                            const recipients = messageTo.split(/[,;]/).map((r: string) => r.trim());
                            const matchesContact = 
                              messageFrom === contactEmail || 
                              recipients.includes(contactEmail);
                            
                            if (!matchesContact) {
                              return false; // Email doesn't match, exclude
                            }
                          } else {
                            // No contact email to match, exclude this message
                            return false;
                          }
                        }
                      }
                      
                      if (!emailSearchQuery.trim()) return true;
                      
                      const searchTerm = emailSearchQuery.toLowerCase();
                      
                      // Search in subject
                      if (message.subject && message.subject.toLowerCase().includes(searchTerm)) return true;
                      
                      // Search in email body content
                      if (message.bodyPreview && message.bodyPreview.toLowerCase().includes(searchTerm)) return true;
                      
                      // Search in sender name (from field)
                      if (message.from && message.from.toLowerCase().includes(searchTerm)) return true;
                      
                      // Search in recipient (to field)
                      if (message.to && message.to.toLowerCase().includes(searchTerm)) return true;
                      
                      // Search in sender name (display name)
                      const senderName = message.direction === 'outgoing' ? (currentUserFullName || 'Team') : client.name;
                      if (senderName.toLowerCase().includes(searchTerm)) return true;
                      
                      return false;
                    })
                    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                    .map((message, index) => (
                      <div key={message.id} className="space-y-2">
                        {/* Email Header */}
                        <div className="flex items-center gap-3">
                          <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            message.direction === 'outgoing'
                              ? 'bg-blue-100 text-blue-700 border border-blue-200'
                              : 'bg-pink-100 text-pink-700 border border-pink-200'
                          }`}>
                            {message.direction === 'outgoing' ? 'Team' : 'Client'}
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900 text-sm">
                              {message.direction === 'outgoing' ? (currentUserFullName || 'Team') : client.name}
                            </div>
                            <div className="text-xs text-gray-500">
                              {new Date(message.date).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </div>
                          </div>
                        </div>
                        
                        {/* Complete Email Content */}
                        <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-lg hover:shadow-xl transition-shadow duration-300" style={{
                          boxShadow: '0 10px 25px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05), 0 0 0 1px rgba(0, 0, 0, 0.05)'
                        }}>
                          {/* Email Header */}
                          <div className="mb-4 pb-4 border-b border-gray-200">
                            <div className="text-sm text-gray-600 space-y-1">
                              <div><strong>From:</strong> {message.direction === 'outgoing' ? (currentUserFullName || 'Team') : client.name} &lt;{message.from}&gt;</div>
                              <div><strong>To:</strong> {message.to || (message.direction === 'outgoing' ? `${client.name} <${client.email}>` : `eliran@lawoffice.org.il`)}</div>
                              <div><strong>Date:</strong> {new Date(message.date).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}</div>
                              {message.subject && (
                                <div><strong>Subject:</strong> {message.subject}</div>
                              )}
                            </div>
                          </div>
                          
                          {/* Complete Email Body - Full Content */}
                          <div className="email-content">
                              {message.bodyPreview ? (
                                <div 
                                  dangerouslySetInnerHTML={{ __html: message.bodyPreview }}
                                  className="prose prose-sm max-w-none email-body"
                                  style={{
                                    fontFamily: 'inherit',
                                    lineHeight: '1.6',
                                    color: '#374151'
                                  }}
                                />
                              ) : (
                              <div className="text-gray-500 italic p-4 bg-gray-50 rounded">
                                No email content available
                              </div>
                            )}
                          </div>
                          
                          {/* Attachments */}
                          {message.attachments && message.attachments.length > 0 && (
                            <div className="mt-6 pt-4 border-t border-gray-200">
                              <div className="text-sm font-medium text-gray-700 mb-3">Attachments:</div>
                              <div className="space-y-2">
                                {message.attachments.map((attachment: Attachment, idx: number) => (
                                  <div key={attachment.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                                    <PaperClipIcon className="w-5 h-5 text-gray-400" />
                                    <div className="flex-1">
                                      <div className="font-medium text-gray-900">{attachment.name}</div>
                                      {attachment.sizeInBytes && (
                                        <div className="text-sm text-gray-500">
                                          {(attachment.sizeInBytes / 1024).toFixed(1)} KB
                                        </div>
                                      )}
                                      {attachment.contentType && (
                                        <div className="text-xs text-gray-400">
                                          {attachment.contentType}
                                        </div>
                                      )}
                                    </div>
                                    <button
                                      onClick={() => handleDownloadAttachment(message.id, attachment)}
                                      disabled={downloadingAttachments[attachment.id]}
                                      className="btn btn-sm btn-outline btn-primary"
                                      title="Download attachment"
                                    >
                                      {downloadingAttachments[attachment.id] ? (
                                        <span className="loading loading-spinner loading-xs" />
                                      ) : (
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                      )}
                                      Download
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Compose Area */}
            <div className="border-t border-gray-200 p-3 md:p-6">
              {showCompose && createPortal(
                <div className="fixed inset-0 z-[10002]">
                  <div className="absolute inset-0 bg-black/50" onClick={() => setShowCompose(false)} />
                  <div className="relative z-[10003] flex h-full w-full flex-col bg-white shadow-2xl">
                    <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200 md:px-6 lg:px-10">
                      <h2 className="text-lg font-semibold md:text-xl">Compose Email</h2>
                      <button className="btn btn-ghost btn-sm" onClick={() => setShowCompose(false)}>
                        <XMarkIcon className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 md:px-6 lg:px-10">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="font-semibold text-sm">To</label>
                          </div>
                          {renderComposeRecipients('to')}
                        </div>
                        <div className="space-y-2">
                          <label className="font-semibold text-sm">CC</label>
                          {renderComposeRecipients('cc')}
                        </div>
                        {composeRecipientError && <p className="text-sm text-error">{composeRecipientError}</p>}

                        <div className="flex flex-wrap items-center gap-3" ref={composeTemplateDropdownRef}>
                          <label className="text-sm font-semibold">Template</label>
                          <div className="relative w-full sm:w-64">
                            <input
                              type="text"
                              className="input input-bordered w-full pr-8"
                              placeholder="Search templates..."
                              value={composeTemplateSearch}
                              onChange={event => {
                                setComposeTemplateSearch(event.target.value);
                                if (!composeTemplateDropdownOpen) {
                                  setComposeTemplateDropdownOpen(true);
                                }
                              }}
                              onFocus={() => {
                                if (!composeTemplateDropdownOpen) {
                                  setComposeTemplateDropdownOpen(true);
                                }
                              }}
                              onBlur={() => setTimeout(() => setComposeTemplateDropdownOpen(false), 150)}
                            />
                            <ChevronDownIcon className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                            {composeTemplateDropdownOpen && (
                              <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-56 overflow-y-auto">
                                {filteredComposeTemplates.length === 0 ? (
                                  <div className="px-3 py-2 text-sm text-gray-500">No templates found</div>
                                ) : (
                                  filteredComposeTemplates.map(template => (
                                    <div
                                      key={template.id}
                                      className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                                      onMouseDown={e => e.preventDefault()}
                                      onClick={() => handleComposeTemplateSelect(template)}
                                    >
                                      {template.name}
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                          {selectedComposeTemplateId !== null && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => {
                                setSelectedComposeTemplateId(null);
                                setComposeTemplateSearch('');
                                setComposeBody('');
                                // Use selected contact's name if available, otherwise use client name
                                const nameToUse = selectedContactForEmail?.contact.name || client.name;
                                const defaultSubjectValue = `[${client.lead_number}] - ${nameToUse} - ${client.topic || ''}`;
                                setComposeSubject(defaultSubjectValue);
                              }}
                            >
                              Clear
                            </button>
                          )}
                        </div>

                  <input
                    type="text"
                    placeholder="Subject"
                    value={composeSubject}
                    onChange={(e) => setComposeSubject(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="font-semibold text-sm">Body</label>
                          <button
                            type="button"
                            className="btn btn-xs btn-outline"
                            onClick={() => setShowComposeLinkForm(prev => !prev)}
                          >
                            {showComposeLinkForm ? 'Hide Link Form' : 'Add Link'}
                          </button>
                        </div>

                        {showComposeLinkForm && (
                          <div className="flex flex-col gap-3 md:flex-row md:items-end bg-base-200/70 border border-base-300 rounded-lg p-3">
                            <div className="flex-1 flex flex-col gap-2 md:flex-row md:items-center">
                              <input
                                type="text"
                                className="input input-bordered w-full md:flex-1"
                                placeholder="Link label (optional)"
                                value={composeLinkLabel}
                                onChange={event => setComposeLinkLabel(event.target.value)}
                              />
                              <input
                                type="url"
                                className="input input-bordered w-full md:flex-1"
                                placeholder="https://example.com"
                                value={composeLinkUrl}
                                onChange={event => setComposeLinkUrl(event.target.value)}
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className="btn btn-sm btn-primary"
                                onClick={handleInsertComposeLink}
                                disabled={!composeLinkUrl.trim()}
                              >
                                Insert Link
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-ghost"
                                onClick={handleCancelComposeLink}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        {/* AI Suggestions Dropdown */}
                        {showAISuggestions && (
                          <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                            <div className="flex items-center justify-between mb-2">
                              <div className="text-sm font-semibold text-gray-900">
                                {composeBody.trim() ? 'AI Message Improvement' : 'AI Suggestions'}
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
                                  className="w-full p-4 rounded-lg border border-gray-200 bg-white cursor-pointer hover:bg-gray-100 transition-colors"
                                  onClick={() => applyAISuggestion(aiSuggestions[0])}
                                >
                                  <div className="text-sm text-gray-900">{aiSuggestions[0]}</div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                  <textarea
                    placeholder="Type your message..."
                    value={composeBody}
                    onChange={(e) => setComposeBody(e.target.value)}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-y min-h-[320px]"
                          rows={10}
                  />
                  
                  {composeAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {composeAttachments.map((file, index) => (
                        <div key={index} className="flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-lg">
                          <PaperClipIcon className="w-4 h-4 text-gray-500" />
                          <span className="text-sm">{file.name}</span>
                          <button
                            onClick={() => setComposeAttachments(prev => prev.filter((_, i) => i !== index))}
                            className="text-red-500 hover:text-red-700"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  </div>
                    <div className="px-4 py-4 border-t border-gray-200 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between md:px-6 lg:px-10">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="btn btn-ghost btn-sm"
                        >
                          <PaperClipIcon className="w-4 h-4" />
                          <span className="hidden sm:inline">Attach</span>
                        </button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          onChange={(e) => e.target.files && handleAttachmentUpload(e.target.files)}
                          className="hidden"
                        />
                        {/* AI Suggestions Button */}
                        <button
                          type="button"
                          onClick={handleAISuggestions}
                          disabled={isLoadingAI || !client}
                          className={`flex-shrink-0 px-3 py-2 rounded-full flex items-center justify-center transition-all text-sm font-medium ${
                            isLoadingAI
                              ? 'bg-blue-500 text-white'
                              : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-100'
                          } ${!client ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                          title={composeBody.trim() ? "Improve message with AI" : "Get AI suggestions"}
                        >
                          {isLoadingAI ? (
                            <div className="loading loading-spinner loading-sm"></div>
                          ) : (
                            'AI'
                          )}
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setShowCompose(false)}
                          className="btn btn-outline btn-sm flex-1 sm:flex-none"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSendEmail}
                          disabled={sending || !composeBody.trim()}
                          className="btn btn-primary btn-sm flex-1 sm:flex-none"
                        >
                          {sending ? (
                            <div className="loading loading-spinner loading-xs"></div>
                          ) : (
                            <>
                              <PaperAirplaneIcon className="w-4 h-4" />
                              Send
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>,
                document.body
              )}
              {!showCompose && (
                <button
                  onClick={() => {
                    // Use selected contact's email if available, otherwise fall back to client email
                    const emailToUse = selectedContactForEmail?.contact.email || client.email;
                    const initialRecipients = normaliseAddressList(emailToUse);
                    setComposeToRecipients(initialRecipients.length > 0 ? initialRecipients : []);
                    setComposeCcRecipients([]);
                    setComposeToInput('');
                    setComposeCcInput('');
                    setComposeRecipientError(null);
                    setShowComposeLinkForm(false);
                    setComposeLinkLabel('');
                    setComposeLinkUrl('');
                    setSelectedComposeTemplateId(null);
                    setComposeTemplateSearch('');
                    // Use selected contact's name if available, otherwise use client name
                    const nameToUse = selectedContactForEmail?.contact.name || client.name;
                    const defaultSubjectValue = `[${client.lead_number}] - ${nameToUse} - ${client.topic || ''}`;
                    setComposeSubject(defaultSubjectValue);
                    setComposeBody('');
                    setComposeAttachments([]);
                    setShowCompose(true);
                  }}
                  className="w-full btn btn-primary"
                >
                  <PaperAirplaneIcon className="w-4 h-4 mr-2" />
                  Compose Message
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
      {contactDrawerOpen && createPortal(
        <div className="fixed inset-0 z-[999] flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30" onClick={closeContactDrawer} />
          {/* Drawer */}
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-[999]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">Contact Client</h3>
              <button className="btn btn-ghost btn-sm" onClick={closeContactDrawer}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-4 flex-1">
              <div>
                <label className="block font-semibold mb-1">How to contact</label>
                <select
                  className="select select-bordered w-full"
                  value={newContact.method}
                  onChange={e => handleNewContactChange('method', e.target.value)}
                >
                  {contactMethods.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Date</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={newContact.date}
                  onChange={e => handleNewContactChange('date', e.target.value)}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Time</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={newContact.time}
                  onChange={e => handleNewContactChange('time', e.target.value)}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Minutes</label>
                <input
                  type="number"
                  min="0"
                  className="input input-bordered w-full"
                  value={newContact.length}
                  onChange={e => handleNewContactChange('length', e.target.value)}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Content</label>
                <textarea
                  className="textarea textarea-bordered w-full min-h-[80px]"
                  value={newContact.content}
                  onChange={e => handleNewContactChange('content', e.target.value)}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Observation</label>
                <textarea
                  className="textarea textarea-bordered w-full min-h-[60px]"
                  value={newContact.observation}
                  onChange={e => handleNewContactChange('observation', e.target.value)}
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button className="btn btn-primary px-8" onClick={handleSaveContact}>
                Save
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {/* Contact Selector Modal for WhatsApp */}
      {client && (
        <ContactSelectorModal
          isOpen={showContactSelector}
          onClose={() => {
            setShowContactSelector(false);
            setSelectedContactForWhatsApp(null);
          }}
          leadId={isLegacyLead 
            ? (typeof client.id === 'string' ? client.id.replace('legacy_', '') : String(client.id))
            : client.id}
          leadType={isLegacyLead ? 'legacy' : 'new'}
          leadName={client.name}
          leadNumber={client.lead_number}
          mode="whatsapp"
          onContactSelected={(contact, leadId, leadType) => {
            console.log('📞 Contact selected for WhatsApp:', { contact, leadId, leadType });
            // Set the contact in both state and ref (ref is immediate, state is async)
            const contactData = { contact, leadId, leadType };
            selectedContactForWhatsAppRef.current = contactData;
            setSelectedContactForWhatsApp(contactData);
            setShowContactSelector(false);
            // Use requestAnimationFrame to ensure state update is flushed, then open modal
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                console.log('🚀 Opening WhatsApp modal with contact:', contactData.contact.name);
                setIsWhatsAppOpen(true);
              });
            });
          }}
        />
      )}
      {/* Contact Selector Modal for Email */}
      {client && (
        <ContactSelectorModal
          isOpen={showContactSelectorForEmail}
          onClose={() => {
            setShowContactSelectorForEmail(false);
            // Don't clear selectedContactForEmail here - it will be cleared when email modal closes
          }}
          leadId={isLegacyLead 
            ? (typeof client.id === 'string' ? client.id.replace('legacy_', '') : String(client.id))
            : client.id}
          leadType={isLegacyLead ? 'legacy' : 'new'}
          leadName={client.name}
          leadNumber={client.lead_number}
          mode="email"
          onContactSelected={(contact, leadId, leadType) => {
            setSelectedContactForEmail({ contact, leadId, leadType });
            setShowContactSelectorForEmail(false);
            setIsEmailModalOpen(true);
          }}
        />
      )}
      {/* WhatsApp Modal */}
      <SchedulerWhatsAppModal
        isOpen={isWhatsAppOpen}
        onClose={() => {
          handleWhatsAppClose();
          setSelectedContactForWhatsApp(null);
          selectedContactForWhatsAppRef.current = null;
        }}
        client={client ? {
          id: client.id,
          name: client.name,
          lead_number: client.lead_number,
          phone: client.phone,
          mobile: client.mobile,
          lead_type: client.lead_type
        } : undefined}
        selectedContact={selectedContactForWhatsApp || selectedContactForWhatsAppRef.current}
        hideContactSelector={true}
        onClientUpdate={async () => {
          // Refresh interactions when WhatsApp messages are updated
          if (onClientUpdate) {
            await onClientUpdate();
          }
          // Trigger re-fetch of interactions by updating a dependency
          // The useEffect with client.id dependency will handle the refresh
        }}
      />
      {/* Email Thread Modal - Removed, using inline modal below instead */}
      {/* Details Drawer for Interactions */}
      {detailsDrawerOpen && activeInteraction && createPortal(
        <div className="fixed inset-0 z-[999] flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30" onClick={() => setDetailsDrawerOpen(false)} />
          {/* Drawer */}
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-[999]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">Interaction Details</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setDetailsDrawerOpen(false)}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-4 flex-1">
              <div><span className="font-semibold">Type:</span> {activeInteraction.kind}</div>
              <div><span className="font-semibold">Date:</span> {activeInteraction.date} {activeInteraction.time}</div>
              <div><span className="font-semibold">Employee:</span> {activeInteraction.employee}</div>
              {activeInteraction.kind === 'call' && activeInteraction.editable && (
                <>
                  <div>
                    <label className="block font-semibold mb-1">Minutes</label>
                    <input
                      type="number"
                      className="input input-bordered w-full"
                      value={editData.length}
                      onChange={e => handleEditChange('length', e.target.value)}
                      min={0}
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Content</label>
                    <textarea
                      className="textarea textarea-bordered w-full min-h-[80px]"
                      value={editData.content}
                      onChange={e => handleEditChange('content', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Observation</label>
                    <textarea
                      className="textarea textarea-bordered w-full min-h-[60px]"
                      value={editData.observation}
                      onChange={e => handleEditChange('observation', e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2 justify-end mt-4">
                    <button className="btn btn-primary" onClick={handleSave}>Save</button>
                    <button className="btn btn-ghost" onClick={closeDrawer}>Cancel</button>
                  </div>
                </>
              )}
              {/* Show non-editable fields for other types or non-editable interactions */}
              {!(activeInteraction.kind === 'call' && activeInteraction.editable) && (
                <>
                  <div><span className="font-semibold">Content:</span> {activeInteraction.content}</div>
                  <div><span className="font-semibold">Observation:</span> {activeInteraction.observation}</div>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
      {/* AI Smart Recap Drawer for Mobile */}
      {aiDrawerOpen && createPortal(
        <div className="fixed inset-0 z-[999] flex lg:hidden">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/50" onClick={() => setAiDrawerOpen(false)} />
          {/* Drawer */}
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl flex flex-col animate-slideInRight z-[999]">
            <div className="flex items-center justify-between p-6 border-b border-base-300 bg-gradient-to-r from-purple-600 to-indigo-600">
              <div className="flex items-center gap-3">
                <SparklesIcon className="w-6 h-6 text-white" />
                <h3 className="text-xl font-bold text-white saira-regular">AI Smart Recap</h3>
              </div>
              <button className="btn btn-ghost btn-sm text-white hover:bg-white/20" onClick={() => setAiDrawerOpen(false)}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <AISummaryPanel messages={aiSummaryMessages} />
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default InteractionsTab; 