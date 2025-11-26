import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { XMarkIcon, MagnifyingGlassIcon, PaperAirplaneIcon, PaperClipIcon, ChevronDownIcon, PlusIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { appendEmailSignature } from '../lib/emailSignature';
import sanitizeHtml from 'sanitize-html';
import { createPortal } from 'react-dom';
import {
  getMailboxStatus,
  triggerMailboxSync,
  sendEmailViaBackend,
  downloadAttachmentFromBackend,
  fetchEmailBodyFromBackend,
} from '../lib/mailboxApi';
import { fetchLeadContacts } from '../lib/contactHelpers';
import type { ContactInfo } from '../lib/contactHelpers';
import { searchLeads } from '../lib/legacyLeadsApi';
import type { CombinedLead } from '../lib/legacyLeadsApi';

const normalizeEmailForFilter = (value?: string | null) =>
  value ? value.trim().toLowerCase() : '';

const sanitizeEmailForFilter = (value: string) =>
  value.replace(/[^a-z0-9@._+!~-]/g, '');

const collectContactEmails = (contact: Contact): string[] => {
  const emails: string[] = [];
  const pushEmail = (val?: string | null) => {
    const normalized = normalizeEmailForFilter(val);
    if (normalized) {
      emails.push(normalized);
    }
  };

  pushEmail(contact?.email);

  if (Array.isArray((contact as any)?.emails)) {
    ((contact as any).emails || []).forEach((entry: any) => {
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

interface Contact {
  id: number | string;
  idstring?: string | null;
  name: string;
  email: string;
  lead_number: string | null;
  phone?: string;
  created_at: string;
  topic?: string | null;
  last_message_time?: string | null;
  unread_count?: number | null;
  lead_type?: 'legacy' | 'new';
  client_uuid?: string | null;
  user_internal_id?: string | number | null;
  // Role fields for filtering
  closer?: string;
  scheduler?: string;
  handler?: string;
  manager?: string;
  helper?: string;
  expert?: string;
  closer_id?: number;
  meeting_scheduler_id?: number;
  meeting_manager_id?: number;
  meeting_lawyer_id?: number;
  expert_id?: number;
  case_handler_id?: number;
}

interface EmailMessage {
  id: string;
  subject: string;
  body_html: string | null;
  body_preview?: string | null;
  sender_name: string;
  sender_email: string;
  recipient_list?: string;
  sent_at: string;
  direction: 'incoming' | 'outgoing';
  attachments?: {
    id?: string;
    name: string;
    contentType?: string;
    size?: number;
    contentBytes?: string;
    isInline?: boolean;
  }[];
}

interface EmailTemplate {
  id: number;
  name: string;
  subject: string | null;
  content: string;
  rawContent: string;
  languageId: string | null;
}

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

const extractHtmlBody = (html: string) => {
  if (!html) return html;
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : html;
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

const sanitizeEmailHtml = (html: string): string => {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'b', 'i', 'u', 'ul', 'ol', 'li', 'br', 'strong', 'em', 'a', 'span', 'div'],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      span: ['style'],
      div: ['style'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard',
  });
};

const replaceTemplateTokens = (content: string, contact: Contact | null) => {
  if (!content) return '';
  return content
    .replace(/\{client_name\}/gi, contact?.name || 'Client')
    .replace(/\{lead_number\}/gi, contact?.lead_number || '')
    .replace(/\{topic\}/gi, contact?.topic || '')
    .replace(/\{lead_type\}/gi, contact?.lead_type || '');
};

interface EmailThreadModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedContact?: {
    contact: ContactInfo;
    leadId: string | number;
    leadType: 'legacy' | 'new';
  } | null;
}

const EmailThreadModal: React.FC<EmailThreadModalProps> = ({ isOpen, onClose, selectedContact: propSelectedContact }) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [emailThread, setEmailThread] = useState<EmailMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [subject, setSubject] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [showCompose, setShowCompose] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showContactSelector, setShowContactSelector] = useState(false);
  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  const [searchAllContacts, setSearchAllContacts] = useState('');
  const [toRecipients, setToRecipients] = useState<string[]>([]);
  const [ccRecipients, setCcRecipients] = useState<string[]>([]);
  const [toInput, setToInput] = useState('');
  const [ccInput, setCcInput] = useState('');
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const templateDropdownRef = useRef<HTMLDivElement | null>(null);
  
  // AI suggestions state
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [showAISuggestions, setShowAISuggestions] = useState(false);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  // New Email Modal state
  const [isNewEmailModalOpen, setIsNewEmailModalOpen] = useState(false);
  const [newEmailSearchTerm, setNewEmailSearchTerm] = useState('');
  const [newEmailSearchResults, setNewEmailSearchResults] = useState<CombinedLead[]>([]);
  const [isNewEmailSearching, setIsNewEmailSearching] = useState(false);
  const newEmailSearchTimeoutRef = useRef<NodeJS.Timeout>();
  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();
    if (!query) return templates;
    return templates.filter(template => template.name.toLowerCase().includes(query));
  }, [templates, templateSearch]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isManuallySettingContactIdRef = useRef(false);
  const currentLoadingContactIdRef = useRef<string | number | null>(null);
  const isFetchingRef = useRef(false);
  const isSettingUpContactRef = useRef(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>('');
  const [databaseUserId, setDatabaseUserId] = useState<string | number | null>(null); // Database user ID for read_by
  const [mailboxStatus, setMailboxStatus] = useState<{ connected: boolean; lastSync?: string | null; error?: string | null }>({
    connected: false,
  });
  const [downloadingAttachments, setDownloadingAttachments] = useState<Record<string, boolean>>({});
  const [currentUserFullName, setCurrentUserFullName] = useState('');
  
  // State for lead contacts (all contacts associated with the selected lead)
  const [leadContacts, setLeadContacts] = useState<ContactInfo[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);
  
  // State for role-based filtering
  const [currentUserEmployeeId, setCurrentUserEmployeeId] = useState<number | null>(null);
  const [showMyContactsOnly, setShowMyContactsOnly] = useState<boolean>(true);

  useEffect(() => {
    if (!isOpen) return;

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

        setTemplates(parsed);
      } catch (error) {
        console.error('Failed to load email templates:', error);
        if (isMounted) {
          setTemplates([]);
        }
      }
    };

    loadTemplates();
    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!templateDropdownOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(event.target as Node)) {
        setTemplateDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [templateDropdownOpen]);

  useEffect(() => {
    let isMounted = true;
    const loadAuthUser = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!isMounted) return;
        const authUser = data?.user;
        if (authUser) {
          setUserId(authUser.id);
          setUserEmail(authUser.email || '');
          
          // Fetch database user ID from users table for read_by field
          if (authUser.email && authUser.email.includes('@')) {
            // Try by email first
            const { data: userRow, error } = await supabase
              .from('users')
              .select('id, full_name, email, employee_id')
              .eq('email', authUser.email)
              .maybeSingle();
            
            if (!error && userRow) {
              setDatabaseUserId(userRow.id);
              if (userRow.full_name) {
                setCurrentUserFullName(userRow.full_name);
              }
              if (userRow.employee_id && typeof userRow.employee_id === 'number') {
                setCurrentUserEmployeeId(userRow.employee_id);
              }
            } else {
              // Try by auth_id if email lookup fails
              const { data: userByAuthId, error: authIdError } = await supabase
                .from('users')
                .select('id, full_name, email, employee_id')
                .eq('auth_id', authUser.id)
                .maybeSingle();
              
              if (!authIdError && userByAuthId) {
                setDatabaseUserId(userByAuthId.id);
                if (userByAuthId.full_name) {
                  setCurrentUserFullName(userByAuthId.full_name);
                }
                if (userByAuthId.employee_id && typeof userByAuthId.employee_id === 'number') {
                  setCurrentUserEmployeeId(userByAuthId.employee_id);
                }
              }
            }
          }
        } else {
          setUserId(null);
          setUserEmail('');
          setDatabaseUserId(null);
          setCurrentUserFullName('');
          setCurrentUserEmployeeId(null);
        }
      } catch (error) {
        console.error('Failed to load authenticated user for EmailThreadModal:', error);
        if (isMounted) {
          setUserId(null);
          setUserEmail('');
          setDatabaseUserId(null);
          setCurrentUserFullName('');
          setCurrentUserEmployeeId(null);
        }
      }
    };

    loadAuthUser();
    return () => {
      isMounted = false;
    };
  }, []);

  const refreshMailboxStatus = useCallback(async () => {
    if (!userId) return;
    try {
      const status = await getMailboxStatus(userId);
      setMailboxStatus(status || { connected: false });
    } catch (error) {
      console.error('Failed to fetch mailbox status for EmailThreadModal:', error);
      setMailboxStatus(prev => ({
        ...prev,
        connected: false,
        error: error instanceof Error ? error.message : 'Failed to fetch mailbox status',
      }));
    }
  }, [userId]);

  useEffect(() => {
    refreshMailboxStatus();
  }, [refreshMailboxStatus]);


  const pushRecipient = (list: string[], address: string) => {
    const normalized = address.trim();
    if (!normalized) return;
    if (!emailRegex.test(normalized)) {
      throw new Error('Please enter a valid email address.');
    }
    if (!list.some(item => item.toLowerCase() === normalized.toLowerCase())) {
      list.push(normalized);
    }
  };

  const addRecipient = (type: 'to' | 'cc', rawValue: string) => {
    const value = rawValue.trim().replace(/[;,]+$/, '');
    if (!value) return;
    try {
      if (type === 'to') {
        const updated = [...toRecipients];
        pushRecipient(updated, value);
        setToRecipients(updated);
        setToInput('');
      } else {
        const updated = [...ccRecipients];
        pushRecipient(updated, value);
        setCcRecipients(updated);
        setCcInput('');
      }
      setRecipientError(null);
    } catch (error) {
      setRecipientError((error as Error).message);
    }
  };

  const removeRecipient = (type: 'to' | 'cc', email: string) => {
    if (type === 'to') {
      setToRecipients(prev => prev.filter(item => item !== email));
    } else {
      setCcRecipients(prev => prev.filter(item => item !== email));
    }
  };

  const handleRecipientKeyDown = (type: 'to' | 'cc') => (event: React.KeyboardEvent<HTMLInputElement>) => {
    const value = type === 'to' ? toInput : ccInput;
    const keys = ['Enter', ',', ';'];
    if (keys.includes(event.key)) {
      event.preventDefault();
      if (value.trim()) {
        addRecipient(type, value);
      }
    } else if (event.key === 'Backspace' && !value) {
      if (type === 'to' && toRecipients.length > 0) {
        setToRecipients(prev => prev.slice(0, -1));
      }
      if (type === 'cc' && ccRecipients.length > 0) {
        setCcRecipients(prev => prev.slice(0, -1));
      }
    }
  };

  const renderRecipients = (type: 'to' | 'cc') => {
    const items = type === 'to' ? toRecipients : ccRecipients;
    const value = type === 'to' ? toInput : ccInput;
    const setValue = type === 'to' ? setToInput : setCcInput;
    const placeholder = type === 'to' ? 'Add recipient and press Enter' : 'Add CC and press Enter';

    return (
      <div className="border border-base-300 rounded-lg px-3 py-2 flex flex-wrap gap-2">
        {items.map(email => (
          <span key={`${type}-${email}`} className="bg-primary/10 text-primary px-2 py-1 rounded-full text-sm flex items-center gap-1">
            {email}
            <button
              type="button"
              onClick={() => removeRecipient(type, email)}
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
            if (recipientError) {
              setRecipientError(null);
            }
          }}
          onKeyDown={handleRecipientKeyDown(type)}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="btn btn-xs btn-outline"
          onClick={() => addRecipient(type, value)}
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

  const handleCancelLink = () => {
    setShowLinkForm(false);
    setLinkLabel('');
    setLinkUrl('');
  };

  const handleInsertLink = () => {
    const formattedUrl = normaliseUrl(linkUrl);
    if (!formattedUrl) {
      toast.error('Please provide a valid URL (including the domain).');
      return;
    }

    const label = linkLabel.trim();
    setNewMessage(prev => {
      const existing = prev || '';
      const trimmedExisting = existing.replace(/\s*$/, '');
      // If label is provided, create HTML anchor tag with label as clickable text
      // If no label, just use the URL (convertBodyToHtml will make it clickable)
      const linkLine = label 
        ? `<a href="${formattedUrl.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer">${label}</a>`
        : formattedUrl;
      return trimmedExisting ? `${trimmedExisting}\n\n${linkLine}` : linkLine;
    });

    handleCancelLink();
  };

  const handleTemplateSelect = (template: EmailTemplate) => {
    setSelectedTemplateId(template.id);
    const templatedBody = replaceTemplateTokens(template.content, selectedContact);
    if (template.subject && template.subject.trim()) {
      setSubject(replaceTemplateTokens(template.subject, selectedContact));
    }
    setNewMessage(templatedBody || template.content || template.rawContent);
    setTemplateSearch(template.name);
    setTemplateDropdownOpen(false);
  };
  
  // MSAL for email sending



  // Helper function to clean up Microsoft diagnostic emails
  // Mobile detection
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Helper function to check if a contact matches user roles (same logic as WhatsAppPage)
  const contactMatchesUserRoles = (
    contact: Contact,
    employeeId: number | null,
    fullName: string | null
  ): boolean => {
    if (!employeeId && !fullName) return false;

    const stringIdentifiers = fullName ? [fullName.trim().toLowerCase()] : [];
    const numericId = employeeId ? String(employeeId).trim() : null;

    const isLegacyLead = contact.lead_type === 'legacy' || contact.id.toString().startsWith('legacy_');

    if (isLegacyLead) {
      // For legacy leads, check numeric fields
      const roleFields = [
        contact.closer_id,
        contact.meeting_scheduler_id,
        contact.meeting_manager_id,
        contact.meeting_lawyer_id,
        contact.expert_id,
        contact.case_handler_id
      ];

      if (numericId) {
        return roleFields.some(field => {
          if (field === null || field === undefined) return false;
          return String(field).trim() === numericId;
        });
      }
    } else {
      // For new leads, check both text and numeric fields
      const textRoleFields = [
        contact.closer,
        contact.scheduler,
        contact.handler,
        contact.manager,
        contact.helper,
        contact.expert
      ];

      const numericRoleFields = [
        contact.closer_id,
        contact.meeting_scheduler_id,
        contact.meeting_manager_id,
        contact.meeting_lawyer_id,
        contact.expert_id,
        contact.case_handler_id
      ];

      // Check text fields
      if (stringIdentifiers.length > 0) {
        const textMatch = textRoleFields.some(field => {
          if (!field || typeof field !== 'string') return false;
          return stringIdentifiers.includes(field.trim().toLowerCase());
        });
        if (textMatch) return true;
      }

      // Check numeric fields
      if (numericId) {
        const numericMatch = numericRoleFields.some(field => {
          if (field === null || field === undefined) return false;
          return String(field).trim() === numericId;
        });
        if (numericMatch) return true;
      }
    }

    return false;
  };

  // Fetch all contacts
  useEffect(() => {
    const fetchContactsWithEmailConversations = async () => {
      try {
        setIsLoading(true);
        
        // Fetch unique client_id and legacy_id from emails table
        // Only get emails where client_id or legacy_id is not null
        const { data: emailsData, error: emailsError } = await supabase
          .from('emails')
          .select('client_id, legacy_id')
          .or('client_id.not.is.null,legacy_id.not.is.null');

        if (emailsError) {
          console.error('Error fetching emails:', emailsError);
        }

        // Get unique client IDs (new leads) and legacy IDs
        const uniqueClientIds = new Set<string>();
        const uniqueLegacyIds = new Set<number>();
        
        (emailsData || []).forEach((email: any) => {
          if (email.client_id) {
            uniqueClientIds.add(String(email.client_id));
          }
          if (email.legacy_id) {
            uniqueLegacyIds.add(Number(email.legacy_id));
          }
        });

        // Fetch new leads with email conversations (including role fields)
        const newLeadIds = Array.from(uniqueClientIds);
        let newLeadsData: any[] = [];
        
        if (newLeadIds.length > 0) {
          const { data: leadsData, error: leadsError } = await supabase
            .from('leads')
            .select('id, name, email, lead_number, phone, mobile, created_at, topic, closer, scheduler, handler, manager, helper, expert, closer_id, meeting_scheduler_id, meeting_manager_id, meeting_lawyer_id, expert_id, case_handler_id')
            .in('id', newLeadIds);

          if (leadsError) {
            console.error('Error fetching new leads:', leadsError);
          } else {
            newLeadsData = (leadsData || []).map(lead => ({
              ...lead,
              lead_type: 'new' as const,
              client_uuid: lead.id ? String(lead.id) : null,
            }));
          }
        }

        // Fetch legacy leads with email conversations (including role fields)
        const legacyLeadIds = Array.from(uniqueLegacyIds).filter(id => !isNaN(id));
        let legacyLeadsData: any[] = [];
        
        if (legacyLeadIds.length > 0) {
          const { data: legacyLeads, error: legacyLeadsError } = await supabase
            .from('leads_lead')
            .select('id, name, email, phone, mobile, cdate, category_id, closer_id, meeting_scheduler_id, meeting_manager_id, meeting_lawyer_id, expert_id, case_handler_id')
            .in('id', legacyLeadIds);

          if (legacyLeadsError) {
            console.error('Error fetching legacy leads:', legacyLeadsError);
          } else {
            legacyLeadsData = (legacyLeads || []).map(lead => ({
              id: `legacy_${lead.id}`, // Use legacy_ prefix like WhatsAppPage
              lead_number: lead.id?.toString(),
              name: lead.name || '',
              email: lead.email || '',
              phone: lead.phone || '',
              mobile: lead.mobile || '',
              created_at: lead.cdate,
              topic: null,
              lead_type: 'legacy' as const,
              idstring: null,
              client_uuid: null,
              // Map role fields for filtering - convert IDs to strings like WhatsAppPage
              closer: lead.closer_id ? String(lead.closer_id) : '',
              scheduler: lead.meeting_scheduler_id ? String(lead.meeting_scheduler_id) : '',
              closer_id: lead.closer_id || null,
              meeting_scheduler_id: lead.meeting_scheduler_id || null,
              meeting_manager_id: lead.meeting_manager_id || null,
              meeting_lawyer_id: lead.meeting_lawyer_id || null,
              expert_id: lead.expert_id || null,
              case_handler_id: lead.case_handler_id || null,
              handler: null, // Not used for legacy
              manager: null, // Not used for legacy
              helper: null, // Not used for legacy
              expert: null // Not used for legacy
            }));
          }
        }

        // Combine all contacts
        let allContacts: Contact[] = [...newLeadsData, ...legacyLeadsData];
        
        console.log(`📧 Before filtering: ${allContacts.length} contacts (${newLeadsData.length} new + ${legacyLeadsData.length} legacy)`);
        console.log(`📧 Filter settings: showMyContactsOnly=${showMyContactsOnly}, employeeId=${currentUserEmployeeId}, fullName=${currentUserFullName}`);
        
        // Apply role-based filtering if "My Contacts" toggle is enabled
        if (showMyContactsOnly && (currentUserEmployeeId || currentUserFullName)) {
          const beforeFilterCount = allContacts.length;
          allContacts = allContacts.filter(contact => {
            const matches = contactMatchesUserRoles(contact, currentUserEmployeeId, currentUserFullName);
            if (!matches && contact.lead_type === 'legacy') {
              console.log(`❌ Legacy contact ${contact.id} (${contact.name}) did not match:`, {
                closer_id: (contact as any).closer_id,
                meeting_scheduler_id: (contact as any).meeting_scheduler_id,
                employeeId: currentUserEmployeeId,
                fullName: currentUserFullName
              });
            }
            return matches;
          });
          console.log(`📧 After filtering: ${allContacts.length} contacts (filtered from ${beforeFilterCount})`);
        }
        
        console.log(`📧 Fetched ${allContacts.length} contacts with email conversations (${newLeadsData.length} new + ${legacyLeadsData.length} legacy)`);
        
        // Fetch last message time and unread status for each contact
        const contactsWithLastMessage = await Promise.all(
          allContacts.map(async (contact) => {
            const isLegacyContact = contact.lead_type === 'legacy';
            const legacyId = isLegacyContact
              ? (() => {
                  const raw = contact.lead_number ?? contact.id;
                  const numeric = parseInt(String(raw).replace(/[^0-9]/g, ''), 10);
                  return Number.isFinite(numeric) ? numeric : null;
                })()
              : null;

            if (isLegacyContact && legacyId === null) {
              return null;
            }

            let lastMessage: { sent_at: string; direction: string } | null = null;
            if (isLegacyContact && legacyId !== null) {
              const { data: legacyMessage } = await supabase
                .from('emails')
                .select('sent_at, direction')
                .eq('legacy_id', legacyId)
                .order('sent_at', { ascending: false })
                .limit(1)
                .maybeSingle();
              lastMessage = legacyMessage ?? null;
            } else {
              const { data: clientMessage } = await supabase
                .from('emails')
                .select('sent_at, direction')
                .eq('client_id', String(contact.id))
                .order('sent_at', { ascending: false })
                .limit(1)
                .maybeSingle();
              lastMessage = clientMessage ?? null;
            }

            // Check for unread incoming messages (last 7 days)
            // For contacts, we need to check by both client_id/legacy_id AND contact_id when available
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
 
            // First, try to find a contact with matching email to get contact_id
            let contactIdForUnread: number | null = null;
            if (contact.email) {
              // Fetch contacts for this lead to find matching contact_id
              const isLegacyForContact = contact.lead_type === 'legacy';
              const leadIdForContact = isLegacyForContact
                ? (contact.lead_number ? parseInt(contact.lead_number.replace(/[^0-9]/g, ''), 10) : null)
                : (contact.client_uuid || contact.id);
              
              if (leadIdForContact) {
                try {
                  const contactsList = await fetchLeadContacts(
                    String(leadIdForContact), 
                    isLegacyForContact
                  );
                  const matchingContact = contactsList.find((c: ContactInfo) => 
                    c.email && contact.email && c.email.toLowerCase() === contact.email.toLowerCase()
                  );
                  if (matchingContact) {
                    contactIdForUnread = matchingContact.id;
                  }
                } catch (error) {
                  console.error('Error fetching contacts for unread count:', error);
                }
              }
            }
            
            // Build query for unread emails
            let unreadMessages: { id: string }[] | null = null;
            
            if (isLegacyContact && legacyId !== null) {
              // For legacy contacts: check by legacy_id and optionally by contact_id
              let query = supabase
                .from('emails')
                .select('id, contact_id')
                .eq('legacy_id', legacyId)
                .eq('direction', 'incoming')
                .gte('sent_at', sevenDaysAgo.toISOString())
                .or('is_read.is.null,is_read.eq.false');
              
              const { data } = await query;
              
              // Filter in memory if we have a contact_id
              if (contactIdForUnread && data) {
                // Include emails that match contact_id OR don't have contact_id set (fallback to main contact)
                const filtered = data.filter((email: any) => 
                  !email.contact_id || email.contact_id === contactIdForUnread
                );
                unreadMessages = filtered;
              } else {
                unreadMessages = data ?? null;
              }
            } else {
              // For new leads: check by client_id and optionally by contact_id
              let query = supabase
                .from('emails')
                .select('id, contact_id')
                .eq('client_id', String(contact.id))
                .eq('direction', 'incoming')
                .gte('sent_at', sevenDaysAgo.toISOString())
                .or('is_read.is.null,is_read.eq.false');
              
              const { data } = await query;
              
              // Filter in memory if we have a contact_id
              if (contactIdForUnread && data) {
                // Include emails that match contact_id OR don't have contact_id set (fallback to main contact)
                const filtered = data.filter((email: any) => 
                  !email.contact_id || email.contact_id === contactIdForUnread
                );
                unreadMessages = filtered;
              } else {
                unreadMessages = data ?? null;
              }
            }
 
            return {
              ...contact,
              last_message_time: lastMessage?.sent_at || null,
              unread_count: unreadMessages?.length || 0
            };
          })
        );

        // Filter out null contacts
        const filtered = contactsWithLastMessage.filter(Boolean) as Contact[];
        
        // Store all contacts for contact selector (we'll use searchLeads for this)
        setAllContacts(allContacts);
        setFilteredAllContacts(allContacts);
        
        // Show only contacts with emails in main list, sorted by last message time
        const sortedContacts = filtered
          .sort((a, b) => {
            if (a.last_message_time && b.last_message_time) {
              return new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime();
            }
            if (a.last_message_time) return -1;
            if (b.last_message_time) return 1;
            return a.name.localeCompare(b.name);
          });
 
        setContacts(sortedContacts);
        // Apply search filter if there's a search query
        if (searchQuery.trim()) {
          const filtered = sortedContacts.filter(contact =>
            contact.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            contact.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            contact.lead_number?.toLowerCase().includes(searchQuery.toLowerCase())
          );
          setFilteredContacts(filtered);
        } else {
          setFilteredContacts(sortedContacts);
        }
        
        // If current selected contact is no longer in the filtered list, clear it
        if (selectedContact && !sortedContacts.some(c => c.id === selectedContact.id)) {
          console.log(`⚠️ Selected contact ${selectedContact.name} is no longer in filtered list, clearing selection`);
          setSelectedContact(null);
          setSelectedContactId(null);
          setEmailThread([]);
        }
      } catch (error) {
        console.error('Error fetching contacts with email conversations:', error);
        toast.error('Failed to load contacts');
      } finally {
        setIsLoading(false);
      }
    };

    if (isOpen) {
      fetchContactsWithEmailConversations();
    }
  }, [isOpen, showMyContactsOnly, currentUserEmployeeId, currentUserFullName]);

  // Filter contacts based on search - now only filters through fetched contacts (no API calls)
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredContacts(contacts);
    } else {
      const filtered = contacts.filter(contact =>
        contact.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        contact.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        contact.lead_number?.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredContacts(filtered);
    }
  }, [searchQuery, contacts]);

  // Handle search in New Email Modal
  useEffect(() => {
    if (newEmailSearchTimeoutRef.current) {
      clearTimeout(newEmailSearchTimeoutRef.current);
    }

    if (!newEmailSearchTerm.trim()) {
      setNewEmailSearchResults([]);
      setIsNewEmailSearching(false);
      return;
    }

    setIsNewEmailSearching(true);

    newEmailSearchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchLeads(newEmailSearchTerm.trim());
        setNewEmailSearchResults(results);
      } catch (error) {
        console.error('Error searching leads:', error);
        setNewEmailSearchResults([]);
      } finally {
        setIsNewEmailSearching(false);
      }
    }, 300);
  }, [newEmailSearchTerm]);

  // Handle clicking on a contact in New Email Modal
  const handleNewEmailContactClick = async (result: CombinedLead) => {
    // Check if contact already exists in the list
    const existingContact = contacts.find(c => {
      if (result.lead_type === 'legacy') {
        return c.id === `legacy_${result.id}` || c.lead_number === result.lead_number;
      } else {
        return c.id === result.id || c.lead_number === result.lead_number;
      }
    });

    // If this is a contact (not main contact), fetch contacts and select the specific contact FIRST
    // This ensures selectedContactId is set before selectedContact changes trigger the useEffect
    if (result.isContact && !result.isMainContact) {
      const isLegacyLead = result.lead_type === 'legacy';
      const leadId = isLegacyLead 
        ? (typeof result.id === 'string' ? result.id.replace('legacy_', '') : String(result.id))
        : result.id;
      
      const fetchedContacts = await fetchLeadContacts(leadId, isLegacyLead);
      const selectedContactFromList = fetchedContacts.find(c => 
        (c.phone && result.phone && c.phone === result.phone) ||
        (c.mobile && result.mobile && c.mobile === result.mobile) ||
        (c.email && result.email && c.email === result.email) ||
        (c.name && (result.contactName || result.name) && c.name === (result.contactName || result.name))
      );
      
      if (selectedContactFromList) {
        // Set flag to prevent useEffect from overriding our manual selection
        isManuallySettingContactIdRef.current = true;
        
        // Set contacts and contact ID FIRST, before setting selectedContact
        setLeadContacts(fetchedContacts);
        setSelectedContactId(selectedContactFromList.id);
        
        // Create a Contact object that represents the SPECIFIC CONTACT, not the lead
        // Use contactName if available, otherwise fall back to name
        const contactName = result.contactName || result.name || selectedContactFromList.name;
        const contactEmail = selectedContactFromList.email || result.email || '';
        const contactPhone = selectedContactFromList.phone || result.phone || '';
        
        const contactForList: Contact = {
          id: result.lead_type === 'legacy' ? `legacy_${result.id}` : result.id,
          name: contactName, // Use the contact's name, not the lead's name
          email: contactEmail,
          lead_number: result.lead_number,
          phone: contactPhone,
          created_at: result.created_at || new Date().toISOString(),
          topic: result.topic,
          lead_type: result.lead_type,
          client_uuid: result.lead_type === 'new' ? String(result.id) : null,
        };
        
        // Check if this contact already exists in the list
        const existingContact = contacts.find(c => {
          if (result.lead_type === 'legacy') {
            return c.id === `legacy_${result.id}` || c.lead_number === result.lead_number;
          } else {
            return c.id === result.id || c.lead_number === result.lead_number;
          }
        });
        
        if (!existingContact) {
          setContacts(prev => [contactForList, ...prev]);
          setFilteredContacts(prev => [contactForList, ...prev]);
        }
        
        // Small delay to ensure state updates are processed
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Now set the selected contact to the CONTACT, not the lead
        setSelectedContact(contactForList);
      } else {
        // Contact not found in list, fall back to main contact logic
        let contactToSelect: Contact;
        const existingContact = contacts.find(c => {
          if (result.lead_type === 'legacy') {
            return c.id === `legacy_${result.id}` || c.lead_number === result.lead_number;
          } else {
            return c.id === result.id || c.lead_number === result.lead_number;
          }
        });
        
        if (!existingContact) {
          const newContact: Contact = {
            id: result.lead_type === 'legacy' ? `legacy_${result.id}` : result.id,
            name: result.contactName || result.name,
            email: result.email || '',
            lead_number: result.lead_number,
            phone: result.phone,
            created_at: result.created_at || new Date().toISOString(),
            topic: result.topic,
            lead_type: result.lead_type,
            client_uuid: result.lead_type === 'new' ? String(result.id) : null,
          };
          setContacts(prev => [newContact, ...prev]);
          setFilteredContacts(prev => [newContact, ...prev]);
          contactToSelect = newContact;
        } else {
          contactToSelect = existingContact;
        }
        setSelectedContact(contactToSelect);
      }
    } else {
      // For main contacts, fetch contacts and select the main one
      let contactToSelect: Contact;
      const existingContact = contacts.find(c => {
        if (result.lead_type === 'legacy') {
          return c.id === `legacy_${result.id}` || c.lead_number === result.lead_number;
        } else {
          return c.id === result.id || c.lead_number === result.lead_number;
        }
      });
      
      if (!existingContact) {
        const newContact: Contact = {
          id: result.lead_type === 'legacy' ? `legacy_${result.id}` : result.id,
          name: result.name,
          email: result.email || '',
          lead_number: result.lead_number,
          phone: result.phone,
          created_at: result.created_at || new Date().toISOString(),
          topic: result.topic,
          lead_type: result.lead_type,
          client_uuid: result.lead_type === 'new' ? String(result.id) : null,
        };
        setContacts(prev => [newContact, ...prev]);
        setFilteredContacts(prev => [newContact, ...prev]);
        contactToSelect = newContact;
      } else {
        contactToSelect = existingContact;
      }
      
      const isLegacyLead = contactToSelect.lead_type === 'legacy' || contactToSelect.id.toString().startsWith('legacy_');
      const leadId = isLegacyLead 
        ? (typeof contactToSelect.id === 'string' ? contactToSelect.id.replace('legacy_', '') : String(contactToSelect.id))
        : contactToSelect.client_uuid || contactToSelect.id;
      
      const fetchedContacts = await fetchLeadContacts(leadId, isLegacyLead);
      setLeadContacts(fetchedContacts);
      
      // Set selected contact
      setSelectedContact(contactToSelect);
      
      if (fetchedContacts.length > 0) {
        const mainContact = fetchedContacts.find(c => c.isMain) || fetchedContacts[0];
        setSelectedContactId(mainContact.id);
      }
    }

    // Close modal and clear search
    setIsNewEmailModalOpen(false);
    setNewEmailSearchTerm('');
    setNewEmailSearchResults([]);
    
    // Open chat on mobile
    if (isMobile) {
      setShowChat(true);
    }
  };

  // Filter all contacts for contact selector
  const [filteredAllContacts, setFilteredAllContacts] = useState<Contact[]>([]);
  
  useEffect(() => {
    if (!searchAllContacts.trim()) {
      setFilteredAllContacts(allContacts);
    } else {
      const filtered = allContacts.filter(contact =>
        contact.name?.toLowerCase().includes(searchAllContacts.toLowerCase()) ||
        contact.email?.toLowerCase().includes(searchAllContacts.toLowerCase()) ||
        contact.lead_number?.toLowerCase().includes(searchAllContacts.toLowerCase())
      );
      setFilteredAllContacts(filtered);
    }
  }, [searchAllContacts, allContacts]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const totalUnread = contacts.reduce((sum, contact) => sum + (contact.unread_count || 0), 0);
    window.dispatchEvent(new CustomEvent('email:unread-count', { detail: { count: totalUnread } }));
  }, [contacts]);

  // If propSelectedContact is provided, use it directly
  useEffect(() => {
    if (propSelectedContact) {
      setSelectedContactId(propSelectedContact.contact.id);
      setLeadContacts([propSelectedContact.contact]);
      // Create a Contact object from ContactInfo for selectedContact state
      const contactObj: Contact = {
        id: propSelectedContact.contact.id,
        name: propSelectedContact.contact.name,
        email: propSelectedContact.contact.email || '',
        lead_number: propSelectedContact.leadType === 'legacy' 
          ? String(propSelectedContact.leadId)
          : (typeof propSelectedContact.leadId === 'string' ? propSelectedContact.leadId : String(propSelectedContact.leadId)),
        lead_type: propSelectedContact.leadType,
        client_uuid: propSelectedContact.leadType === 'new' ? String(propSelectedContact.leadId) : null,
        created_at: new Date().toISOString(), // Required field, using current date as fallback
      };
      setSelectedContact(contactObj);
    }
  }, [propSelectedContact]);

  // Fetch contacts for the selected lead (only if no propSelectedContact)
  // This useEffect is now mainly for initial setup - handleContactSelect handles contact switching
  useEffect(() => {
    if (propSelectedContact) return; // Skip if we have a prop contact
    
    const fetchContactsForLead = async () => {
      if (!selectedContact) {
        setLeadContacts([]);
        // Don't clear selectedContactId here - it might be set by handleContactSelect
        return;
      }

      const isLegacyLead = selectedContact.lead_type === 'legacy' || selectedContact.id.toString().startsWith('legacy_');
      const leadId = isLegacyLead 
        ? (typeof selectedContact.id === 'string' ? selectedContact.id.replace('legacy_', '') : String(selectedContact.id))
        : (selectedContact.client_uuid || selectedContact.id);

      const contacts = await fetchLeadContacts(leadId, isLegacyLead);
      setLeadContacts(contacts);
      
      // Only set selectedContactId if it's not already set or if the current one is not in the contacts list
      // This preserves the contact selection when coming from "New Email" modal or handleContactSelect
      if (contacts.length > 0) {
        // Skip if we're manually setting the contact ID (from New Email modal or handleContactSelect)
        if (isManuallySettingContactIdRef.current) {
          isManuallySettingContactIdRef.current = false; // Reset the flag
          return; // Don't override the manually set contact ID
        }
        
        const currentContactId = selectedContactId;
        const isCurrentContactValid = currentContactId && contacts.some(c => c.id === currentContactId);
        
        if (!isCurrentContactValid) {
          // Current contact ID is not valid, select the main contact or first one
          const mainContact = contacts.find(c => c.isMain) || contacts[0];
          setSelectedContactId(mainContact.id);
        }
        // If currentContactId is valid, keep it (don't override)
      }
    };

    if (selectedContact) {
      fetchContactsForLead();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContact, propSelectedContact]);

  // Fetch email thread for selected contact
  const hydrateEmailThreadBodies = useCallback(
    async (messages: EmailMessage[]) => {
      if (!messages || messages.length === 0) return;
      if (!userId) return;

      const requiresHydration = messages.filter(message => {
        const body = (message.body_html || '').trim();
        const preview = (message.body_preview || '').trim();
        if (!body && !preview) return true;
        const normalised = (body || preview).replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/g, ' ').trim();
        return normalised.length < 8 || normalised === message.subject;
      });

      if (requiresHydration.length === 0) return;

      const updates: Record<string, { html: string; preview: string }> = {};

      await Promise.all(
        requiresHydration.map(async message => {
          if (!message.id) return;
          try {
            const rawContent = await fetchEmailBodyFromBackend(userId, message.id);
            if (!rawContent || typeof rawContent !== 'string') return;

            const cleanedHtml = sanitizeEmailHtml(extractHtmlBody(rawContent));
            const previewHtml = cleanedHtml && cleanedHtml.trim() ? cleanedHtml : convertBodyToHtml(rawContent);

            updates[message.id] = {
              html: cleanedHtml,
              preview: previewHtml,
            };

            await supabase
              .from('emails')
              .update({ body_html: rawContent, body_preview: rawContent })
              .eq('message_id', message.id);
          } catch (err) {
            console.warn('Failed to hydrate email body from backend', err);
          }
        })
      );

      if (Object.keys(updates).length > 0) {
        setEmailThread(prev =>
          prev.map(email => {
            const update = updates[email.id];
            if (!update) return email;
            return {
              ...email,
              body_html: update.html,
              body_preview: update.preview,
            };
          })
        );
      }
    },
    [userId]
  );

  const fetchEmailThread = useCallback(async () => {
    if (!selectedContact) {
      currentLoadingContactIdRef.current = null;
      isFetchingRef.current = false;
      setEmailThread([]);
      setIsLoading(false);
      return;
    }

    // Prevent duplicate fetches
    if (isFetchingRef.current) {
      console.log(`⏭️ Skipping duplicate fetch for contact: ${selectedContact.name} (ID: ${selectedContact.id})`);
      return;
    }

    // Track which contact we're loading for
    const loadingContactId = selectedContact.id;
    const loadingContactIdKey = `${loadingContactId}-${selectedContactId}`;
    currentLoadingContactIdRef.current = loadingContactId;
    isFetchingRef.current = true;

    console.log(`🔄 Fetching email thread for contact: ${selectedContact.name} (ID: ${selectedContact.id}), contactId: ${selectedContactId}`);
    
    // Clear thread immediately to prevent showing old emails
    setEmailThread([]);
    setIsLoading(true);
    
    try {
      const isLegacyContact =
        selectedContact.lead_type === 'legacy' ||
        selectedContact.id.toString().startsWith('legacy_');

      const clientUuid = selectedContact.client_uuid
        ?? selectedContact.idstring
        ?? (typeof selectedContact.id === 'string' && selectedContact.id.includes('-') ? selectedContact.id : null);

      let legacyId: number | null = null;
      if (isLegacyContact) {
        const derivedFromLeadNumber = Number((selectedContact.lead_number || '').replace(/[^0-9]/g, ''));
        if (!Number.isNaN(derivedFromLeadNumber) && derivedFromLeadNumber > 0) {
          legacyId = derivedFromLeadNumber;
        } else {
          const derivedFromId = Number(selectedContact.id.toString().replace(/[^0-9]/g, ''));
          if (!Number.isNaN(derivedFromId) && derivedFromId > 0) {
            legacyId = derivedFromId;
          }
        }
      }

      // Get contact_id if we have a selected contact from the contact selector
      // Use selectedContactId if available, otherwise try to find it from leadContacts
      let contactId = selectedContactId || (propSelectedContact?.contact.id ?? null);
      
      // If we don't have a contactId but we have leadContacts, try to find the matching contact
      if (!contactId && leadContacts.length > 0) {
        const matchingContact = leadContacts.find(c => 
          (c.email && selectedContact.email && c.email === selectedContact.email) ||
          (c.phone && selectedContact.phone && c.phone === selectedContact.phone) ||
          (c.mobile && selectedContact.phone && c.mobile === selectedContact.phone) ||
          (c.name && selectedContact.name && c.name === selectedContact.name)
        );
        if (matchingContact) {
          contactId = matchingContact.id;
          console.log(`📧 Found matching contact in leadContacts: ${matchingContact.name} (ID: ${contactId})`);
        }
      }
      
      let emailQuery = supabase
        .from('emails')
        .select('id, message_id, sender_name, sender_email, recipient_list, subject, body_html, body_preview, sent_at, direction, attachments, client_id, legacy_id, contact_id, is_read')
        .order('sent_at', { ascending: true });

      // If we have a contact_id, filter by it (each contact has their own conversation)
      if (contactId) {
        console.log(`📧 Querying emails by contact_id=${contactId}`);
        // First try exact contact_id match
        emailQuery = emailQuery.eq('contact_id', contactId);
        
        // Fallback: Also include emails that match by email address but don't have contact_id set
        // This handles cases where contact_id matching failed but email address matches
        const contactEmail = sanitizeEmailForFilter(normalizeEmailForFilter(selectedContact.email));
        if (contactEmail) {
          // Build fallback query: match by client_id/legacy_id AND email address AND contact_id is null
          const fallbackConditions: string[] = [];
          
          if (legacyId !== null) {
            fallbackConditions.push(`legacy_id.eq.${legacyId}`);
          }
          if (clientUuid) {
            fallbackConditions.push(`client_id.eq.${clientUuid}`);
          }
          
          if (fallbackConditions.length > 0) {
            // Use or() to include both contact_id match and fallback email match
            const emailMatch = `sender_email.ilike.${contactEmail},recipient_list.ilike.%${contactEmail}%`;
            const fallbackQuery = `${fallbackConditions[0]},${emailMatch}`;
            // Note: We'll fetch all and filter in memory for complex conditions
            emailQuery = emailQuery.or(`contact_id.eq.${contactId},${fallbackQuery}`);
          }
        }
      } else {
        // Fallback to old logic if no contact_id
        // Also include messages where client_id doesn't match but belong to the lead (show in main contact)
        if (legacyId !== null) {
          console.log(`📧 Querying legacy emails by legacy_id=${legacyId}`);
          emailQuery = emailQuery.eq('legacy_id', legacyId);
        } else if (clientUuid) {
          // For new leads, show all emails for this client_id, even if contact_id doesn't match
          // This ensures messages appear in the main contact
          emailQuery = emailQuery.eq('client_id', clientUuid);
        } else {
          console.warn('Skipping email fetch: contact lacks valid client UUID or legacy id', selectedContact);
          setEmailThread([]);
          setIsLoading(false);
          return;
        }

        const contactEmail = sanitizeEmailForFilter(normalizeEmailForFilter(selectedContact.email));
        const filterClauses: string[] = [];
        if (legacyId !== null) {
          filterClauses.push(`legacy_id.eq.${legacyId}`);
        }
        if (clientUuid) {
          filterClauses.push(`client_id.eq.${clientUuid}`);
        }
        if (contactEmail) {
          filterClauses.push(`sender_email.ilike.${contactEmail}`);
          filterClauses.push(`recipient_list.ilike.%${contactEmail}%`);
        }

        if (filterClauses.length === 0) {
          console.warn('📧 No valid identifiers for email fetch', selectedContact);
          setEmailThread([]);
          setIsLoading(false);
          return;
        }

        emailQuery = emailQuery.or(filterClauses.join(','));
      }

    let { data, error } = await emailQuery;
    
    // If we have contactId and contactEmail, apply fallback filtering in memory
    if (contactId && !error && data) {
      const contactEmail = sanitizeEmailForFilter(normalizeEmailForFilter(selectedContact.email));
      if (contactEmail) {
        // Filter to include: contact_id match OR (contact_id is null AND email matches AND client_id/legacy_id matches)
        const normalizedContactEmail = contactEmail.toLowerCase();
        data = data.filter((email: any) => {
          if (email.contact_id === contactId) return true;
          if (!email.contact_id) {
            // Check if client_id or legacy_id matches first (required)
            const clientMatch = (clientUuid && email.client_id === clientUuid) || 
                               (legacyId !== null && email.legacy_id === legacyId);
            if (clientMatch) {
              // Then check email match
              const senderMatch = email.sender_email && 
                                 normalizeEmailForFilter(email.sender_email).toLowerCase() === normalizedContactEmail;
              const recipientMatch = email.recipient_list && 
                                    email.recipient_list.toLowerCase().includes(normalizedContactEmail);
              return senderMatch || recipientMatch;
            }
          }
          return false;
        });
      }
    }

      if (error) throw error;
      
      console.log(`📧 Found ${data?.length || 0} emails for contact ${selectedContact.name} (ID: ${selectedContact.id})`);
      if (data && data.length > 0) {
        console.log('📧 Sample email:', {
          id: data[0].id,
          subject: data[0].subject,
          sender: data[0].sender_email,
          direction: data[0].direction,
          date: data[0].sent_at
        });
      } else {
        console.log('📧 No emails found for this contact');
      }
      
      const formattedThread: EmailMessage[] = (data || []).map((row: any) => {
        const rawHtml = typeof row.body_html === 'string' ? row.body_html : null;
        const rawPreview = typeof row.body_preview === 'string' ? row.body_preview : null;
        const cleanedHtml = rawHtml ? extractHtmlBody(rawHtml) : null;
        const cleanedPreview = rawPreview ? extractHtmlBody(rawPreview) : null;

        const fallbackText = cleanedPreview || cleanedHtml || row.subject || '';
        const resolvedHtml = cleanedHtml ?? (fallbackText ? convertBodyToHtml(fallbackText) : null);
        const sanitizedHtml = resolvedHtml ? sanitizeEmailHtml(resolvedHtml) : null;
        const sanitizedPreview = cleanedPreview
          ? sanitizeEmailHtml(cleanedPreview)
          : sanitizedHtml ?? (fallbackText ? sanitizeEmailHtml(convertBodyToHtml(fallbackText)) : null);

        // Parse attachments from JSONB - it might be a string or already an array
        let parsedAttachments: any[] = [];
        if (row.attachments) {
          try {
            // If it's a string, parse it
            if (typeof row.attachments === 'string') {
              parsedAttachments = JSON.parse(row.attachments);
            } 
            // If it's already an array, use it directly
            else if (Array.isArray(row.attachments)) {
              parsedAttachments = row.attachments;
            }
            // If it's an object with a value property (Graph API format), extract the array
            else if (row.attachments.value && Array.isArray(row.attachments.value)) {
              parsedAttachments = row.attachments.value;
            }
            // If it's a single object, wrap it in an array
            else if (typeof row.attachments === 'object') {
              parsedAttachments = [row.attachments];
            }
          } catch (e) {
            console.error('Error parsing attachments:', e, row.attachments);
            parsedAttachments = [];
          }
        }
        
        // Filter out inline attachments that shouldn't be displayed as separate attachments
        parsedAttachments = parsedAttachments.filter((att: any) => {
          // Only show non-inline attachments or if isInline is false/undefined
          return att && !att.isInline && att.name;
        });
        
        // Debug log for attachments
        if (parsedAttachments.length > 0) {
          console.log(`📎 Parsed ${parsedAttachments.length} attachments for email ${row.id}:`, parsedAttachments.map((a: any) => ({ name: a.name, size: a.size, hasId: !!a.id, hasContentBytes: !!a.contentBytes })));
        }

        return {
          id: row.message_id || row.id?.toString?.() || `email_${row.id}`,
          subject: row.subject || 'No Subject',
          body_html: sanitizedHtml,
          body_preview: sanitizedPreview ?? null,
          sender_name: row.sender_name || 'Team',
          sender_email: row.sender_email || '',
          recipient_list: row.recipient_list || '',
          sent_at: row.sent_at,
          direction: row.direction === 'outgoing' ? 'outgoing' : 'incoming',
          attachments: parsedAttachments
        } as EmailMessage;
      });

      // Only set emails if this is still the contact we're loading for
      if (currentLoadingContactIdRef.current === loadingContactId) {
        setEmailThread(formattedThread);
        hydrateEmailThreadBodies(formattedThread);
        
        // Mark incoming emails as read when viewing the conversation
        if (databaseUserId && data && data.length > 0) {
          // Get all incoming emails that are unread from the original data
          const incomingUnreadEmails = (data || []).filter((email: any) => 
            email.direction === 'incoming' && 
            (email.is_read === null || email.is_read === false)
          );
          
          if (incomingUnreadEmails.length > 0) {
            const emailIds = incomingUnreadEmails.map((e: any) => e.id).filter(Boolean) as string[];
            
            if (emailIds.length > 0) {
              try {
                // Update emails to mark as read - use databaseUserId (users.id) not auth userId
                const { error: updateError } = await supabase
                  .from('emails')
                  .update({ 
                    is_read: true, 
                    read_at: new Date().toISOString(),
                    read_by: databaseUserId 
                  })
                  .in('id', emailIds);
                
                if (updateError) {
                  console.error('Error marking emails as read:', updateError);
                } else {
                  console.log(`✅ Marked ${emailIds.length} incoming emails as read`);
                  
                  // Update unread count for the contact in the contacts list
                  setContacts(prev => prev.map(contact => {
                    if (contact.id === selectedContact.id) {
                      return { ...contact, unread_count: 0 };
                    }
                    return contact;
                  }));
                  
                  // Refresh unread count for all contacts to update Header
                  // This will be done in the next fetch cycle
                }
              } catch (error) {
                console.error('Error marking emails as read:', error);
              }
            }
          }
        }
      } else {
        console.log(`⚠️ Skipping email thread update - contact changed during fetch`);
        setEmailThread([]);
      }
    } catch (error) {
      console.error(`❌ Error fetching email thread for ${selectedContact?.name}:`, error);
      // Only show error and clear thread if this is still the contact we're loading for
      if (currentLoadingContactIdRef.current === loadingContactId) {
        if (error && typeof error === 'object' && 'message' in error) {
          toast.error(`Failed to load emails for ${selectedContact?.name}`);
        }
        setEmailThread([]);
      }
    } finally {
      // Only clear loading state if this is still the contact we're loading for
      if (currentLoadingContactIdRef.current === loadingContactId) {
        setIsLoading(false);
        currentLoadingContactIdRef.current = null;
      }
      // Always clear fetching flag
      isFetchingRef.current = false;
      // Clear last fetched key if fetch failed or was skipped
      if (currentLoadingContactIdRef.current !== loadingContactId) {
        lastFetchedKeyRef.current = null;
      }
    }
  }, [selectedContact?.id, selectedContactId, leadContacts.length, hydrateEmailThreadBodies, propSelectedContact?.leadId]);

  // Track last fetched key to prevent duplicate fetches
  const lastFetchedKeyRef = useRef<string | null>(null);
  
  useEffect(() => {
    if (!selectedContact) {
      lastFetchedKeyRef.current = null;
      isSettingUpContactRef.current = false;
      return;
    }
    
    // If we're still setting up the contact (finding the contactId), don't fetch yet
    if (isSettingUpContactRef.current) {
      console.log(`⏸️ Waiting for contact setup to complete before fetching...`);
      return;
    }
    
    // Create a unique key for this fetch request
    const fetchKey = `${selectedContact.id}-${selectedContactId || 'null'}`;
    
    // Skip if we're already fetching the same contact/contactId combination
    if (isFetchingRef.current || lastFetchedKeyRef.current === fetchKey) {
      console.log(`⏭️ Skipping duplicate fetch: ${fetchKey}, isFetching: ${isFetchingRef.current}, lastKey: ${lastFetchedKeyRef.current}`);
      return;
    }
    
    // Mark this as the last fetched key BEFORE fetching to prevent race conditions
    lastFetchedKeyRef.current = fetchKey;
    console.log(`🔄 Triggering fetch for key: ${fetchKey}`);
    
    // Fetch emails when selectedContact or selectedContactId changes
    fetchEmailThread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContact?.id, selectedContactId]); // Removed fetchEmailThread to prevent recreations from triggering useEffect

  const runMailboxSync = useCallback(async () => {
    if (!userId) {
      toast.error('Please sign in to sync emails.');
      return;
    }
    if (!mailboxStatus.connected) {
      toast.error('Mailbox not connected. Please connect it from the Interactions tab.');
      return;
    }

    try {
      await triggerMailboxSync(userId);
      await refreshMailboxStatus();
      await fetchEmailThread();
    } catch (error) {
      console.error('Mailbox sync failed:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to sync emails.');
    }
  }, [userId, mailboxStatus.connected, refreshMailboxStatus, fetchEmailThread]);


  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [emailThread]);

  const handleContactSelect = async (contact: Contact) => {
    console.log(`👤 Selecting contact: ${contact.name} (ID: ${contact.id})`);
    
    // Set flag to prevent fetches while we're setting up the contact
    isSettingUpContactRef.current = true;
    console.log(`🔄 Setup flag set to true for contact: ${contact.name}`);
    
    // Clear previous contact's data immediately and set loading state FIRST
    // Set the current loading contact ID to prevent showing old emails
    currentLoadingContactIdRef.current = contact.id;
    setEmailThread([]);
    setIsLoading(true);
    // Clear selectedContactId FIRST to prevent fetching with old contactId
    setSelectedContactId(null);
    // Clear the last fetched key so we can fetch for the new contact
    lastFetchedKeyRef.current = null;
    // Set selected contact AFTER clearing thread, loading, and contactId
    setSelectedContact(contact);
    console.log(`✅ Contact state cleared and set for: ${contact.name}`);
    setShowCompose(false);
    setNewMessage('');
    
    // Set default subject format: Lead number - client name - Category
    const category = contact.topic || 'General';
    setSubject(`${contact.lead_number} - ${contact.name} - ${category}`);
    setAttachments([]);
    const initialRecipients = normaliseAddressList(contact.email);
    setToRecipients(initialRecipients.length > 0 ? initialRecipients : []);
    setCcRecipients([]);
    setToInput('');
    setCcInput('');
    setRecipientError(null);
    setSelectedTemplateId(null);
    setTemplateSearch('');
    setShowLinkForm(false);
    setLinkLabel('');
    setLinkUrl('');
    
    // Fetch contacts for this lead and find the matching contact to set selectedContactId
    // Set a safety timeout to always clear the setup flag even if something goes wrong
    const safetyTimeout = setTimeout(() => {
      if (isSettingUpContactRef.current) {
        console.error('⚠️ Safety timeout: Contact setup taking too long, forcing clear of setup flag');
        isSettingUpContactRef.current = false;
        lastFetchedKeyRef.current = null;
      }
    }, 15000); // 15 second safety timeout
    
    try {
      const isLegacyLead = contact.lead_type === 'legacy' || contact.id.toString().startsWith('legacy_');
      const leadId = isLegacyLead 
        ? (typeof contact.id === 'string' ? contact.id.replace('legacy_', '') : String(contact.id))
        : (contact.client_uuid || contact.id);
      
      console.log(`🔍 Fetching contacts for lead: ${leadId}, isLegacy: ${isLegacyLead}`);
      
      // Add a timeout to prevent hanging forever
      const contactsPromise = fetchLeadContacts(leadId, isLegacyLead);
      const timeoutPromise = new Promise<any>((_, reject) => 
        setTimeout(() => reject(new Error('Contact fetch timeout after 10 seconds')), 10000)
      );
      
      const fetchedContacts = await Promise.race([contactsPromise, timeoutPromise]);
      clearTimeout(safetyTimeout); // Clear safety timeout if we succeed
      console.log(`📋 Fetched ${fetchedContacts?.length || 0} contacts for lead`);
      setLeadContacts(fetchedContacts || []);
      
      // Find the matching contact from the fetched contacts
      const matchingContact = fetchedContacts.find((c: any) => 
        (c.email && contact.email && c.email === contact.email) ||
        (c.phone && contact.phone && c.phone === contact.phone) ||
        (c.mobile && contact.phone && c.mobile === contact.phone) ||
        (c.name && contact.name && c.name === contact.name)
      );
      
      let finalContactId: number | null = null;
      
      if (matchingContact) {
        console.log(`✅ Found matching contact: ${matchingContact.name} (ID: ${matchingContact.id})`);
        finalContactId = matchingContact.id;
      } else if (fetchedContacts.length > 0) {
        // Fallback to main contact if no match found
        const mainContact = fetchedContacts.find((c: any) => c.isMain) || fetchedContacts[0];
        console.log(`⚠️ No exact match, using main contact: ${mainContact.name} (ID: ${mainContact.id})`);
        finalContactId = mainContact.id;
      } else {
        // No contacts found, keep it as null and fetch all emails for this lead
        console.log(`⚠️ No contacts found for lead, will fetch all emails for this lead`);
        finalContactId = null;
      }
      
      // Set the contactId if we found one
      if (finalContactId !== null) {
        isManuallySettingContactIdRef.current = true;
        setSelectedContactId(finalContactId);
      } else {
        setSelectedContactId(null);
      }
      
      // Always clear the setup flag - we're ready to fetch now (even if contactId is null)
      console.log(`✅ Contact setup complete, selectedContactId: ${finalContactId || 'null'}`);
      isSettingUpContactRef.current = false;
      clearTimeout(safetyTimeout); // Make sure to clear safety timeout
      
      // Clear all fetching flags and keys to allow fresh fetch
      isFetchingRef.current = false;
      lastFetchedKeyRef.current = null;
      
      // Manually trigger fetch since useEffect might not fire if dependencies haven't changed
      // Use setTimeout to ensure state updates have processed
      console.log(`🚀 Manually triggering fetch after setup completion, selectedContact: ${selectedContact?.name || 'null'}`);
      setTimeout(() => {
        console.log(`🚀 Executing fetchEmailThread() now...`);
        fetchEmailThread().catch(err => {
          console.error('❌ Error in manual fetchEmailThread call:', err);
        });
      }, 100);
    } catch (error) {
      console.error('❌ Error fetching contacts for selected contact:', error);
      clearTimeout(safetyTimeout); // Clear safety timeout on error
      // On error, clear everything and allow fetch with null contactId
      setSelectedContactId(null);
      lastFetchedKeyRef.current = null;
      // CRITICAL: Always clear the setup flag even on error so we can still try to fetch
      isSettingUpContactRef.current = false;
      console.log(`⚠️ Setup flag cleared after error, will attempt to fetch emails anyway`);
      
      // Manually trigger fetch even on error so user can see emails
      // Clear the fetching flag first to allow the fetch
      isFetchingRef.current = false;
      lastFetchedKeyRef.current = null;
      setTimeout(() => {
        fetchEmailThread();
      }, 100);
    }
    
    if (isMobile) {
      setShowChat(true);
    }
  };

  const handleContactSelectForNewEmail = (contact: Contact) => {
    console.log(`📧 Selecting contact for new email: ${contact.name} (ID: ${contact.id})`);
    
    // Set the selected contact
    setSelectedContact(contact);
    
    // Set default subject format: Lead number - client name - Category
    const category = contact.topic || 'General';
    setSubject(`${contact.lead_number} - ${contact.name} - ${category}`);
    
    // Clear compose form
    setNewMessage('');
    setAttachments([]);
    const initialRecipients = normaliseAddressList(contact.email);
    setToRecipients(initialRecipients.length > 0 ? initialRecipients : []);
    setCcRecipients([]);
    setToInput('');
    setCcInput('');
    setRecipientError(null);
    setSelectedTemplateId(null);
    setTemplateSearch('');
    setShowLinkForm(false);
    setLinkLabel('');
    setLinkUrl('');
    
    // Close contact selector and open compose
    setShowContactSelector(false);
    setShowCompose(true);
    
    if (isMobile) {
      setShowChat(true);
    }
  };

  const readFileAsBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        if (!base64) {
          reject(new Error(`Failed to encode ${file.name}`));
          return;
        }
        resolve(base64);
      };
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsDataURL(file);
    });

  const mapAttachmentsForBackend = async (files: File[]) => {
    const encoded = [];
    for (const file of files) {
      const contentBytes = await readFileAsBase64(file);
      encoded.push({
        name: file.name,
        contentType: file.type || 'application/octet-stream',
        contentBytes,
      });
    }
    return encoded;
  };

  // Handle AI suggestions
  const handleAISuggestions = async () => {
    if (!selectedContact || isLoadingAI) return;

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
          conversationHistory: emailThread.map(msg => ({
            id: msg.id,
            direction: msg.direction === 'outgoing' ? 'out' : 'in',
            message: msg.body_preview || msg.body_html || '',
            sent_at: msg.sent_at,
            sender_name: msg.sender_name || msg.sender_email
          })),
          clientName: selectedContact.name,
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
  };

  const handleSendEmail = async () => {
    if (!selectedContact || !newMessage.trim()) {
      toast.error('Please enter a message');
      return;
    }
    if (!userId) {
      toast.error('Please sign in to send emails.');
      return;
    }
    if (!mailboxStatus.connected) {
      toast.error('Mailbox not connected. Please connect it before sending emails.');
      return;
    }

    const finalToRecipients = [...toRecipients];
    const finalCcRecipients = [...ccRecipients];

    try {
      if (toInput.trim()) {
        pushRecipient(finalToRecipients, toInput.trim());
      }
      if (ccInput.trim()) {
        pushRecipient(finalCcRecipients, ccInput.trim());
      }
    } catch (error) {
      setRecipientError((error as Error).message || 'Please enter a valid email address.');
      return;
    }

    if (finalToRecipients.length === 0) {
      const fallbackRecipients = normaliseAddressList(selectedContact.email);
      if (fallbackRecipients.length > 0) {
        finalToRecipients.push(...fallbackRecipients);
      }
    }

    if (finalToRecipients.length === 0) {
      setRecipientError('Please add at least one recipient.');
      return;
    }

    setRecipientError(null);
    if (toInput.trim()) {
      setToRecipients(finalToRecipients);
      setToInput('');
    }
    if (ccInput.trim()) {
      setCcRecipients(finalCcRecipients);
      setCcInput('');
    }

    // Take snapshots so we can send in the background without being affected
    // by immediate UI resets.
    const messageSnapshot = newMessage;
    const attachmentsSnapshot = [...attachments];
    const finalToSnapshot = [...finalToRecipients];
    const finalCcSnapshot = [...finalCcRecipients];
    const senderName = currentUserFullName || userEmail || 'Team Member';
    const derivedSubject =
      subject && subject.trim()
        ? subject.trim()
        : `${selectedContact.lead_number || selectedContact.id} - ${selectedContact.name}`;

    // Optimistic UI: append an outgoing email immediately using basic HTML conversion.
    const optimisticId = `temp_${Date.now()}`;
    const optimisticSentAt = new Date().toISOString();
    const optimisticHtmlBody = convertBodyToHtml(messageSnapshot);

    const optimisticMessage: EmailMessage = {
      id: optimisticId,
      subject: derivedSubject,
      body_html: optimisticHtmlBody,
      body_preview: optimisticHtmlBody,
      sender_name: senderName,
      sender_email: userEmail || '',
      recipient_list: finalToSnapshot.join(', '),
      sent_at: optimisticSentAt,
      direction: 'outgoing',
      attachments: attachmentsSnapshot.map((file) => ({
        name: file.name,
        contentType: file.type || 'application/octet-stream',
      })),
    };

    setEmailThread((prev) => [...prev, optimisticMessage]);

    // Reset compose UI immediately for a snappy experience
    toast.success('Email queued to send');
    setNewMessage('');
    if (selectedContact) {
      const category = selectedContact.topic || 'General';
      setSubject(`${selectedContact.lead_number} - ${selectedContact.name} - ${category}`);
    } else {
      setSubject('');
    }
    setAttachments([]);
    setShowLinkForm(false);
    setLinkLabel('');
    setLinkUrl('');
    setShowCompose(false);

    // Fire-and-forget: actually send the email in the background.
    (async () => {
      try {
        const baseEmailContent = convertBodyToHtml(messageSnapshot);
        const emailContentWithSignature = await appendEmailSignature(baseEmailContent);
        const cleanedHtmlBody = extractHtmlBody(emailContentWithSignature);
        const backendAttachments = await mapAttachmentsForBackend(attachmentsSnapshot);

        const isLegacyLead =
          selectedContact.lead_type === 'legacy' ||
          selectedContact.id.toString().startsWith('legacy_');
        const legacyId = isLegacyLead
          ? (() => {
              const numeric = parseInt(selectedContact.id.toString().replace('legacy_', ''), 10);
              return Number.isNaN(numeric) ? null : numeric;
            })()
          : null;

        // Find the contact_id from the selected contact or the first recipient
        let contactId: number | null = selectedContactId;
        if (!contactId && finalToSnapshot.length > 0) {
          // Try to find contact by email
          const contactByEmail = leadContacts.find(c => c.email === finalToSnapshot[0]);
          if (contactByEmail) {
            contactId = contactByEmail.id;
          }
        }

        // Get contact_id from selectedContactId or propSelectedContact
        const emailContactId = selectedContactId || (propSelectedContact?.contact.id ?? null);
        
        await sendEmailViaBackend({
          userId,
          subject: derivedSubject,
          bodyHtml: emailContentWithSignature,
          to: finalToSnapshot,
          cc: finalCcSnapshot,
          attachments: backendAttachments.length > 0 ? backendAttachments : undefined,
          context: {
            clientId: !isLegacyLead ? selectedContact.client_uuid ?? selectedContact.id : null,
            legacyLeadId: isLegacyLead ? legacyId : null,
            leadType: selectedContact.lead_type || (isLegacyLead ? 'legacy' : 'new'),
            leadNumber: selectedContact.lead_number || null,
            contactEmail: selectedContact.email || null,
            contactName: selectedContact.name || null,
            contactId: emailContactId || null,
            senderName,
            userInternalId: selectedContact.user_internal_id || undefined,
          },
        });

        // Refresh the thread in the background to replace any optimistic
        // messages with the final stored versions.
        await fetchEmailThread();
      } catch (error) {
        console.error('Error sending email (background):', error);
        toast.error(error instanceof Error ? error.message : 'Failed to send email');
        // Optionally we could mark the optimistic message as failed here.
      }
    })();
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    setAttachments(prev => [...prev, ...files]);
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Format time - matches EmailThreadLeadPage
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

  // Format date separator - matches EmailThreadLeadPage
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

  const containsRTL = (text?: string | null) => !!text && /[\u0590-\u05FF]/.test(text);
  const getMessageDirection = (message: EmailMessage) => {
    if (containsRTL(message.body_html) || containsRTL(message.body_preview) || containsRTL(message.subject)) {
      return 'rtl';
    }
    return 'ltr';
  };

  const formatLastMessageTime = (dateString: string) => {
    const now = new Date();
    const messageDate = new Date(dateString);
    const diffInHours = (now.getTime() - messageDate.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 24) {
      // Today - show time
      return messageDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      });
    } else if (diffInHours < 48) {
      // Yesterday
      return 'Yesterday';
    } else if (diffInHours < 168) {
      // Within a week - show day
      return messageDate.toLocaleDateString('en-US', {
        weekday: 'short'
      });
    } else {
      // Older - show date
      return messageDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      });
    }
  };

  const downloadAttachment = async (messageId: string, attachment: any) => {
    if (attachment?.contentBytes) {
      try {
        const byteCharacters = atob(attachment.contentBytes);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: attachment.contentType || 'application/octet-stream' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = attachment.name || 'attachment';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        toast.success(`Downloaded ${attachment.name || 'attachment'}`);
      } catch (error) {
        console.error('Error downloading inline attachment:', error);
        toast.error('Failed to download attachment');
      }
      return;
    }

    if (!attachment?.id) {
      toast.error('Attachment content not available yet.');
      return;
    }
    if (!userId) {
      toast.error('Please sign in to download attachments.');
      return;
    }
    if (!mailboxStatus.connected) {
      toast.error('Mailbox not connected. Connect it to download attachments.');
      return;
    }
    if (downloadingAttachments[attachment.id]) {
      return;
    }

    setDownloadingAttachments(prev => ({ ...prev, [attachment.id]: true }));
    toast.loading(`Downloading ${attachment.name || 'attachment'}...`, { id: attachment.id });

    try {
      const { blob, fileName } = await downloadAttachmentFromBackend(userId, messageId, attachment.id);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName || attachment.name || 'attachment';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast.success(`Downloaded ${attachment.name || 'attachment'}`, { id: attachment.id });
    } catch (error) {
      console.error('Error downloading attachment via backend:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to download attachment', { id: attachment.id });
    } finally {
      setDownloadingAttachments(prev => {
        const next = { ...prev };
        delete next[attachment.id];
        return next;
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-white z-[9999] overflow-hidden">
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
      <div className="h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className={`flex-none flex flex-col border-b border-gray-200`}>
          <div className="flex items-center justify-between p-4 md:p-6">
            <div className="flex items-center gap-2 md:gap-4">
              <h2 className="text-lg md:text-2xl font-bold text-gray-900">Email Thread</h2>
              {selectedContact && !isMobile && (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-gray-600">
                    {selectedContact.name} ({selectedContact.lead_number})
                  </span>
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="btn btn-ghost btn-circle"
            >
              <XMarkIcon className="w-5 h-5 md:w-6 md:h-6" />
            </button>
          </div>
          
          {/* Toggle Tabs in Header when mobile and chat is open */}
          {isMobile && showChat && (
            <div className="px-3 pb-3 border-t border-gray-200 bg-white">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowMyContactsOnly(false);
                    setShowChat(false); // Show contacts list so user can see the filter working
                  }}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    !showMyContactsOnly
                      ? 'bg-green-600 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  All Contacts
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMyContactsOnly(true);
                    setShowChat(false); // Show contacts list so user can see the filter working
                  }}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    showMyContactsOnly
                      ? 'bg-green-600 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  My Contacts
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel - Contacts */}
          <div className={`${isMobile ? (showChat ? 'hidden' : 'w-full') : 'w-80'} border-r border-gray-200 flex flex-col`}>
            {/* Mobile Contacts Header */}
            {isMobile && !showChat && (
              <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white">
                <h2 className="text-lg font-semibold text-gray-900">Contacts</h2>
                {selectedContact && (
                  <button
                    onClick={() => setShowChat(true)}
                    className="btn btn-outline btn-sm"
                    title="View email thread"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    Chat
                  </button>
                )}
              </div>
            )}
            
            {/* Toggle Tabs and Search Bar */}
            <div className="p-3 border-b border-gray-200 bg-white">
              {/* Toggle Tabs */}
              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setShowMyContactsOnly(false)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    !showMyContactsOnly
                      ? 'bg-green-600 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  All Contacts
                </button>
                <button
                  type="button"
                  onClick={() => setShowMyContactsOnly(true)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    showMyContactsOnly
                      ? 'bg-green-600 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  My Contacts
                </button>
              </div>
              
              {/* Search Bar */}
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search contacts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Contacts List - Scrollable */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {filteredContacts.map((contact) => (
                                                  <div
                   key={contact.id}
                   onClick={() => handleContactSelect(contact)}
                   className={`p-3 md:p-4 border-b border-gray-100 cursor-pointer transition-colors hover:bg-gray-50 ${
                     selectedContact?.id === contact.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                   }`}
                 >
                   <div className="flex items-center gap-2 md:gap-3">
                     <div className="w-8 h-8 md:w-10 md:h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold text-sm md:text-base">
                       {contact.name.charAt(0).toUpperCase()}
                     </div>
                                         <div className="flex-1 min-w-0">
                       <div className="font-semibold text-gray-900 truncate text-sm md:text-base">
                         {contact.name}
                       </div>
                       <div className="text-xs md:text-sm text-gray-500 truncate">
                         {contact.email}
                       </div>
                                                <div className="flex items-center justify-between">
                           <div className="text-xs text-gray-400">
                             #{contact.lead_number}
                           </div>
                           <div className="flex items-center gap-1 md:gap-2">
                             {contact.unread_count && contact.unread_count > 0 && (
                               <div className="w-4 h-4 md:w-5 md:h-5 bg-white rounded-full border-2 border-[#3e28cd] flex items-center justify-center">
                                 <span className="text-xs text-[#3e28cd] font-bold">{contact.unread_count}</span>
                               </div>
                             )}
                             {contact.last_message_time && (
                               <div className="text-xs text-gray-400">
                                 {formatLastMessageTime(contact.last_message_time)}
                               </div>
                             )}
                           </div>
                         </div>
                     </div>
                  </div>
                </div>
              ))}
            </div>

            {/* New Email Button - Fixed at bottom */}
            <div className="flex-none p-3 md:p-4 border-t border-gray-200 bg-gray-50">
              <button
                onClick={() => setIsNewEmailModalOpen(true)}
                className="w-full btn btn-outline btn-primary btn-sm flex items-center justify-center gap-2"
              >
                <PlusIcon className="w-4 h-4" />
                <span>New Email</span>
              </button>
            </div>
          </div>

          {/* Right Panel - Email Thread */}
          <div className={`${isMobile ? (showChat ? 'w-full' : 'hidden') : 'flex-1'} flex flex-col`}>
            {selectedContact ? (
              <>
                {/* Mobile Chat Header - Only visible on mobile when in chat */}
                {isMobile && (
                  <div className="flex-none flex items-center justify-between p-4 border-b border-gray-200 bg-white">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setShowChat(false)}
                        className="btn btn-ghost btn-circle btn-sm"
                        title="Back to contacts"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold text-sm">
                          {selectedContact.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900 text-sm">
                            {selectedContact.name}
                          </h3>
                          <p className="text-xs text-gray-500">
                            {selectedContact.lead_number}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Desktop Chat Header */}
                {!isMobile && (
                  <div className="flex-none flex items-center justify-between p-4 border-b border-gray-200 bg-white">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold">
                        {selectedContact.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">
                          {selectedContact.name}
                        </h3>
                        <p className="text-sm text-gray-500">
                          {selectedContact.lead_number}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Email Thread */}
                <div className={`flex-1 overflow-y-auto p-4 md:p-6 min-h-0 overscroll-contain ${isMobile ? '' : ''}`} style={isMobile ? { WebkitOverflowScrolling: 'touch' } : {}}>
                  {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-full gap-4">
                      <div className="loading loading-spinner loading-lg text-blue-500"></div>
                      <div className="text-center">
                        <p className="text-lg font-medium text-gray-700">Loading emails...</p>
                        {selectedContact && (
                          <p className="text-sm text-gray-500 mt-1">Fetching emails for {selectedContact.name}</p>
                        )}
                      </div>
                    </div>
                  ) : emailThread.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-gray-500">
                      <div className="text-center">
                        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <p className="text-lg font-medium">No emails available</p>
                        <p className="text-sm">No emails found for {selectedContact.name}. Try syncing or send a new email.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {emailThread.map((message, index) => {
                        const showDateSeparator = index === 0 || 
                          new Date(message.sent_at).toDateString() !== new Date(emailThread[index - 1].sent_at).toDateString();
                        const isOutgoing = message.direction === 'outgoing';
                        const senderDisplayName = isOutgoing 
                          ? (currentUserFullName || message.sender_name || userEmail || 'You')
                          : (message.sender_name || selectedContact.name || 'Sender');
                        const messageDirection = getMessageDirection(message);
                        const isRTLMessage = messageDirection === 'rtl';
                        
                        return (
                          <React.Fragment key={message.id || index}>
                            {showDateSeparator && (
                              <div className="flex justify-center my-4">
                                <div className="bg-white border border-gray-200 text-gray-600 text-sm font-medium px-3 py-1.5 rounded-full shadow-sm">
                                  {formatDateSeparator(message.sent_at)}
                                </div>
                              </div>
                            )}
                            
                            <div className={`flex flex-col ${isOutgoing ? 'items-end' : 'items-start'}`}>
                              <div className="flex items-center gap-2 mb-1">
                                <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
                                  isOutgoing
                                    ? 'bg-blue-100 text-blue-700 border border-blue-200'
                                    : 'bg-pink-100 text-pink-700 border border-pink-200'
                                }`}>
                                  {isOutgoing ? 'Team' : 'Client'}
                                </div>
                                <div
                                  className={`text-xs font-semibold ${
                                    isOutgoing ? 'text-blue-600' : 'text-gray-600'
                                  }`}
                                  dir={messageDirection}
                                >
                                  {senderDisplayName}
                                </div>
                              </div>
                              <div
                                className="max-w-full md:max-w-[70%] rounded-2xl px-4 py-2 shadow-sm border border-gray-200 bg-white text-gray-900"
                                style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                                dir={messageDirection}
                              >
                                <div className="mb-2">
                                  <div className="text-sm font-semibold text-gray-900" dir={messageDirection}>{message.subject}</div>
                                  <div className="text-xs text-gray-500 mt-1" dir={messageDirection}>{formatTime(message.sent_at)}</div>
                                </div>
                                
                                {message.body_html ? (
                                  <div
                                    dangerouslySetInnerHTML={{ __html: message.body_html }}
                                    className="prose prose-sm max-w-none text-gray-700 break-words"
                                    style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                                    dir={messageDirection}
                                  />
                                ) : message.body_preview ? (
                                  <div
                                    className="text-gray-700 whitespace-pre-wrap break-words"
                                    style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                                    dir={messageDirection}
                                  >
                                    {message.body_preview}
                                  </div>
                                ) : (
                                  <div className="text-gray-500 italic">No content available</div>
                                )}

                                {message.attachments && Array.isArray(message.attachments) && message.attachments.length > 0 && (
                                  <div className="mt-3 pt-3 border-t border-gray-200">
                                    <div className="text-xs font-medium text-gray-600 mb-2">
                                      Attachments ({message.attachments.length}):
                                    </div>
                                    <div className="space-y-1">
                                      {message.attachments.map((attachment: any, idx: number) => {
                                        if (!attachment || (!attachment.id && !attachment.name)) {
                                          return null; // Skip invalid attachments
                                        }
                                        
                                        const attachmentKey = attachment.id || attachment.name || `${message.id}-${idx}`;
                                        const attachmentName = attachment.name || `Attachment ${idx + 1}`;
                                        const isDownloading =
                                          attachment.id && downloadingAttachments[attachment.id];
                                        
                                        return (
                                          <button
                                            key={attachmentKey}
                                            type="button"
                                            className="flex items-center gap-2 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors w-full text-left"
                                            onClick={() => downloadAttachment(message.id, attachment)}
                                            disabled={Boolean(isDownloading)}
                                          >
                                            {isDownloading ? (
                                              <span className="loading loading-spinner loading-xs text-blue-500" />
                                            ) : (
                                              <DocumentTextIcon className="w-4 h-4 flex-shrink-0" />
                                            )}
                                            <span className="truncate flex-1">
                                              {attachmentName}
                                            </span>
                                            {attachment.size && (
                                              <span className="text-xs text-gray-500 flex-shrink-0">
                                                ({(attachment.size / 1024).toFixed(1)} KB)
                                              </span>
                                            )}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </React.Fragment>
                        );
                      })}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </div>

                {/* Compose Area */}
                <div className="border-t border-gray-200 bg-white flex-none mt-auto">
                  <div className="px-4 md:px-6 py-4 bg-white">
                    <button
                      onClick={() => {
                        setShowCompose(true);
                        if (selectedContact) {
                          const initialRecipients = normaliseAddressList(selectedContact.email);
                          setToRecipients(initialRecipients.length > 0 ? initialRecipients : []);
                          setCcRecipients([]);
                          setToInput('');
                          setCcInput('');
                          setRecipientError(null);
                          setSelectedTemplateId(null);
                          setTemplateSearch('');
                          setShowLinkForm(false);
                          setLinkLabel('');
                          setLinkUrl('');
                        }
                      }}
                      className="w-full btn btn-primary h-12 min-h-0"
                    >
                      <PaperAirplaneIcon className="w-4 h-4 mr-2" />
                      Compose Message
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <p className="text-lg font-medium">Select a contact</p>
                  <p className="text-sm">Choose a contact from the list to view their email thread</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showCompose && createPortal(
        <div className="fixed inset-0 z-[10001] flex overflow-hidden">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowCompose(false)} />
          <div className="relative w-full h-full bg-white shadow-2xl flex flex-col overflow-hidden">
            <div className="flex-none flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-xl font-semibold">Compose Email</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCompose(false)}>
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0 overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-sm">To</label>
                  {leadContacts.length > 1 && (
                    <div className="flex items-center gap-2">
                      <select
                        className="select select-bordered select-sm text-xs"
                        value={selectedContactId || ''}
                        onChange={(e) => {
                          const contactId = e.target.value ? parseInt(e.target.value, 10) : null;
                          setSelectedContactId(contactId);
                          const contact = leadContacts.find(c => c.id === contactId);
                          if (contact && contact.email) {
                            // Add contact email to recipients if not already there
                            if (!toRecipients.includes(contact.email)) {
                              setToRecipients([...toRecipients, contact.email]);
                            }
                          }
                        }}
                      >
                        <option value="">Select a contact</option>
                        {leadContacts.map(contact => (
                          <option key={contact.id} value={contact.id}>
                            {contact.name} {contact.isMain && '(Main)'} - {contact.email || 'No email'}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                {renderRecipients('to')}
              </div>
              <div className="space-y-2">
                <label className="font-semibold text-sm">CC</label>
                {renderRecipients('cc')}
              </div>
              {recipientError && <p className="text-sm text-error">{recipientError}</p>}

              <div className="flex flex-wrap items-center gap-3" ref={templateDropdownRef}>
                <label className="text-sm font-semibold">Template</label>
                <div className="relative w-full sm:w-64">
                  <input
                    type="text"
                    className="input input-bordered w-full pr-8"
                    placeholder="Search templates..."
                    value={templateSearch}
                    onChange={event => {
                      setTemplateSearch(event.target.value);
                      if (!templateDropdownOpen) {
                        setTemplateDropdownOpen(true);
                      }
                    }}
                    onFocus={() => {
                      if (!templateDropdownOpen) {
                        setTemplateDropdownOpen(true);
                      }
                    }}
                    onBlur={() => setTimeout(() => setTemplateDropdownOpen(false), 150)}
                  />
                  <ChevronDownIcon className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  {templateDropdownOpen && (
                    <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-56 overflow-y-auto">
                      {filteredTemplates.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-gray-500">No templates found</div>
                      ) : (
                        filteredTemplates.map(template => (
                          <div
                            key={template.id}
                            className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => handleTemplateSelect(template)}
                          >
                            {template.name}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {selectedTemplateId !== null && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setSelectedTemplateId(null);
                      setTemplateSearch('');
                      setNewMessage('');
                      if (selectedContact) {
                        const category = selectedContact.topic || 'General';
                        setSubject(`${selectedContact.lead_number} - ${selectedContact.name} - ${category}`);
                      }
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>

              <input
                type="text"
                placeholder="Subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="font-semibold text-sm">Body</label>
                <button
                  type="button"
                  className="btn btn-xs btn-outline"
                  onClick={() => setShowLinkForm(prev => !prev)}
                >
                  {showLinkForm ? 'Hide Link Form' : 'Add Link'}
                </button>
              </div>

              {showLinkForm && (
                <div className="flex flex-col gap-3 md:flex-row md:items-end bg-base-200/70 border border-base-300 rounded-lg p-3">
                  <div className="flex-1 flex flex-col gap-2 md:flex-row md:items-center">
                    <input
                      type="text"
                      className="input input-bordered w-full md:flex-1"
                      placeholder="Link label (optional)"
                      value={linkLabel}
                      onChange={event => setLinkLabel(event.target.value)}
                    />
                    <input
                      type="url"
                      className="input input-bordered w-full md:flex-1"
                      placeholder="https://example.com"
                      value={linkUrl}
                      onChange={event => setLinkUrl(event.target.value)}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={handleInsertLink}
                      disabled={!linkUrl.trim()}
                    >
                      Insert Link
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={handleCancelLink}
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
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y min-h-[320px]"
              />

              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachments.map((file, index) => (
                    <div key={index} className="flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-lg">
                      <PaperClipIcon className="w-4 h-4 text-gray-500" />
                      <span className="text-sm">{file.name}</span>
                      <button
                        onClick={() => removeAttachment(index)}
                        className="text-red-500 hover:text-red-700"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-none px-6 py-4 border-t border-gray-200 flex flex-col sm:flex-row gap-3 justify-between" style={{ position: 'sticky', bottom: 0, zIndex: 10 }}>
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
                  onChange={handleFileUpload}
                  className="hidden"
                />
                {/* AI Suggestions Button */}
                <button
                  type="button"
                  onClick={handleAISuggestions}
                  disabled={isLoadingAI || !selectedContact}
                  className={`flex-shrink-0 px-3 py-2 rounded-full flex items-center justify-center transition-all text-sm font-medium ${
                    isLoadingAI
                      ? 'bg-blue-500 text-white'
                      : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-100'
                  } ${!selectedContact ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                  title={newMessage.trim() ? "Improve message with AI" : "Get AI suggestions"}
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
                  className="btn btn-outline btn-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendEmail}
                  disabled={isSending || !newMessage.trim()}
                  className="btn btn-primary btn-sm"
                >
                  {isSending ? (
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

      {/* Contact Selector Modal */}
      {showContactSelector && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10000]">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Select Contact</h2>
              <button
                onClick={() => setShowContactSelector(false)}
                className="btn btn-ghost btn-sm btn-circle"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Search */}
            <div className="p-4 border-b border-gray-200">
              <input
                type="text"
                placeholder="Search contacts..."
                className="input input-bordered w-full"
                value={searchAllContacts}
                onChange={(e) => setSearchAllContacts(e.target.value)}
              />
            </div>

            {/* Contacts List */}
            <div className="flex-1 overflow-y-auto p-4">
              {filteredAllContacts.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <p className="text-lg font-medium">No contacts found</p>
                  <p className="text-sm">Try a different search term</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredAllContacts.map((contact) => (
                    <div
                      key={contact.id}
                      onClick={() => handleContactSelectForNewEmail(contact)}
                      className="p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold">
                          {contact.name?.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-gray-900 truncate">
                            {contact.name}
                          </div>
                          <div className="text-sm text-gray-500 truncate">
                            {contact.email || 'No email'}
                          </div>
                          <div className="text-xs text-gray-400">
                            Lead: {contact.lead_number}
                          </div>
                        </div>
                        <div className="text-xs text-gray-400">
                          {contact.lead_type === 'legacy' ? 'Legacy' : 'New'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-200">
              <button
                onClick={() => setShowContactSelector(false)}
                className="w-full btn btn-outline"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Email Modal */}
      {isNewEmailModalOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-60" onClick={() => setIsNewEmailModalOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col m-4" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-xl font-semibold">New Email</h2>
              <button
                onClick={() => {
                  setIsNewEmailModalOpen(false);
                  setNewEmailSearchTerm('');
                  setNewEmailSearchResults([]);
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
                  value={newEmailSearchTerm}
                  onChange={(e) => setNewEmailSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoFocus
                />
                {isNewEmailSearching && (
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                    <div className="loading loading-spinner loading-sm text-gray-400"></div>
                  </div>
                )}
              </div>
            </div>

            {/* Search Results */}
            <div className="flex-1 overflow-y-auto p-4">
              {!newEmailSearchTerm.trim() ? (
                <div className="text-center py-8 text-gray-500">
                  <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <p className="text-lg font-medium">Search for a contact</p>
                  <p className="text-sm">Type a name, email, phone, or lead number to find a contact</p>
                </div>
              ) : isNewEmailSearching ? (
                <div className="flex items-center justify-center py-8">
                  <div className="loading loading-spinner loading-lg text-blue-600"></div>
                </div>
              ) : newEmailSearchResults.length > 0 ? (
                <div className="space-y-2">
                  {newEmailSearchResults.map((result, index) => {
                    const uniqueKey = result.lead_type === 'legacy' 
                      ? `legacy_${result.id}_${result.contactName || result.name}_${index}`
                      : `${result.id}_${result.contactName || result.name}_${index}`;
                    
                    const displayName = result.contactName || result.name || '';
                    const displayEmail = result.email || '';
                    const displayPhone = result.phone || result.mobile || '';
                    
                    return (
                      <button
                        key={uniqueKey}
                        onClick={() => handleNewEmailContactClick(result)}
                        className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors rounded-lg border border-gray-200"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                            <span className="font-semibold text-blue-700">
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
                              <p className="text-xs text-gray-500 truncate">{displayPhone}</p>
                            )}
                          </div>
                          <svg className="w-5 h-5 text-blue-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <p className="text-sm">No contacts found</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailThreadModal; 