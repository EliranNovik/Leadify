import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { XMarkIcon, MagnifyingGlassIcon, PaperAirplaneIcon, PaperClipIcon, ChevronDownIcon, PlusIcon } from '@heroicons/react/24/outline';
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
}

const EmailThreadModal: React.FC<EmailThreadModalProps> = ({ isOpen, onClose }) => {
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
  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();
    if (!query) return templates;
    return templates.filter(template => template.name.toLowerCase().includes(query));
  }, [templates, templateSearch]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>('');
  const [mailboxStatus, setMailboxStatus] = useState<{ connected: boolean; lastSync?: string | null; error?: string | null }>({
    connected: false,
  });
  const [downloadingAttachments, setDownloadingAttachments] = useState<Record<string, boolean>>({});
  const [currentUserFullName, setCurrentUserFullName] = useState('');

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
        } else {
          setUserId(null);
          setUserEmail('');
        }
      } catch (error) {
        console.error('Failed to load authenticated user for EmailThreadModal:', error);
        if (isMounted) {
          setUserId(null);
          setUserEmail('');
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

  useEffect(() => {
    if (!userId) {
      setCurrentUserFullName('');
      return;
    }
    let isMounted = true;
    const loadFullName = async () => {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('full_name, email')
          .eq('auth_id', userId)
          .maybeSingle();
        if (!isMounted) return;
        if (!error && data) {
          if (data.full_name) {
            setCurrentUserFullName(data.full_name);
          }
          if (data.email && !userEmail) {
            setUserEmail(data.email);
          }
        }
      } catch (error) {
        console.error('Failed to load current user details for EmailThreadModal:', error);
      }
    };
    loadFullName();
    return () => {
      isMounted = false;
    };
  }, [userId, userEmail]);

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

  // Fetch all contacts
  useEffect(() => {
    const fetchContacts = async () => {
      try {
        // Fetch new leads from 'leads' table
        const { data: newLeads, error: newLeadsError } = await supabase
          .from('leads')
          .select('id, name, email, lead_number, phone, created_at, topic');
        
        if (newLeadsError) {
          console.error('❌ Error fetching new leads:', newLeadsError);
        }

        // Fetch legacy leads from 'leads_lead' table
        let legacyLeads: any[] = [];
        let legacyLeadsError: any = null;
        
        try {
          const result = await supabase
            .from('leads_lead')
            .select('id, name, email, phone, cdate, category_id');
          legacyLeads = result.data || [];
          legacyLeadsError = result.error;
        } catch (error) {
          console.error('❌ Network error fetching legacy leads:', error);
          legacyLeadsError = error;
        }
        
        if (legacyLeadsError) {
          console.error('❌ Error fetching legacy leads:', legacyLeadsError);
          // Continue with empty array
        }

        // Combine all contacts
        const allContacts: Contact[] = [
          ...(newLeads || []).map(lead => ({
            ...lead,
            lead_type: 'new' as const,
            client_uuid: lead.id ? String(lead.id) : null,
          })),
          ...(legacyLeads || []).map(lead => ({
            ...lead,
            lead_number: lead.id?.toString(), // Use lead ID as lead_number for legacy leads
            created_at: lead.cdate, // Use cdate as created_at for legacy leads
            topic: null, // Legacy leads don't have topic in this table
            lead_type: 'legacy' as const,
            idstring: null,
            client_uuid: null
          }))
        ];

        console.log(`👥 Fetched ${allContacts.length} total contacts (${newLeads?.length || 0} new + ${legacyLeads?.length || 0} legacy)`);
        
        const data = allContacts;
        
        // Fetch last message time and unread status for each contact
        // Only include contacts that have emails in the emails table
        const contactsWithLastMessage = await Promise.all(
          (data || []).map(async (contact) => {
            const isLegacyContact =
              contact.lead_type === 'legacy' ||
              (typeof contact.id === 'string' && contact.id.startsWith('legacy_'));

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
 
            // Only include contacts that have at least one email
            if (!lastMessage) {
              return null; // Filter out contacts without emails
            }
 
            // Check for unread incoming messages (last 7 days)
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
 
            let unreadMessages: { id: string }[] | null = null;
            if (isLegacyContact && legacyId !== null) {
              const { data } = await supabase
                .from('emails')
                .select('id')
                .eq('legacy_id', legacyId)
                .eq('direction', 'incoming')
                .gte('sent_at', sevenDaysAgo.toISOString())
                .is('is_read', false);
              unreadMessages = data ?? null;
            } else {
              const { data } = await supabase
                .from('emails')
                .select('id')
                .eq('client_id', String(contact.id))
                .eq('direction', 'incoming')
                .gte('sent_at', sevenDaysAgo.toISOString())
                .is('is_read', false);
              unreadMessages = data ?? null;
            }
 
            return {
              ...contact,
              last_message_time: lastMessage?.sent_at || null,
              unread_count: unreadMessages?.length || 0
            };
          })
        );

        // Filter out null contacts (those without emails)
        const filtered = contactsWithLastMessage.filter(Boolean) as Contact[];
 
         // Filter out null contacts (those without emails)
        const contactsWithEmails = filtered;

        console.log(`📧 Showing ${contactsWithEmails.length} contacts with emails (filtered from ${allContacts.length} total contacts)`);
        
        // Store all contacts for contact selector
        setAllContacts(allContacts);
        setFilteredAllContacts(allContacts); // Initialize filtered all contacts
        // Show only contacts with emails in main list
        const filteredContacts = contactsWithEmails
           .map(contact => contact as Contact)
           .sort((a, b) => {
             if (a.last_message_time && b.last_message_time) {
               return new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime();
             }
             if (a.last_message_time) return -1;
             if (b.last_message_time) return 1;
             return a.name.localeCompare(b.name);
           });
 
         setContacts(filteredContacts);
         setFilteredContacts(filteredContacts);
      } catch (error) {
        console.error('Error fetching contacts:', error);
        toast.error('Failed to load contacts');
      }
    };

    if (isOpen) {
      fetchContacts();
    }
  }, [isOpen]);

  // Filter contacts based on search
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
      setEmailThread([]);
      setIsLoading(false);
      return;
    }

    console.log(`🔄 Fetching email thread for contact: ${selectedContact.name} (ID: ${selectedContact.id})`);
    
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

      let emailQuery = supabase
        .from('emails')
        .select('id, message_id, sender_name, sender_email, recipient_list, subject, body_html, body_preview, sent_at, direction, attachments, client_id, legacy_id')
        .order('sent_at', { ascending: true });

      if (legacyId !== null) {
        console.log(`📧 Querying legacy emails by legacy_id=${legacyId}`);
        emailQuery = emailQuery.eq('legacy_id', legacyId);
      } else if (clientUuid) {
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

    const { data, error } = await emailQuery;

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
          attachments: row.attachments || []
        } as EmailMessage;
      });

      setEmailThread(formattedThread);
      hydrateEmailThreadBodies(formattedThread);
    } catch (error) {
      console.error(`❌ Error fetching email thread for ${selectedContact?.name}:`, error);
      if (error && typeof error === 'object' && 'message' in error) {
        toast.error(`Failed to load emails for ${selectedContact?.name}`);
      }
      setEmailThread([]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedContact, hydrateEmailThreadBodies]);

  useEffect(() => {
    fetchEmailThread();
  }, [fetchEmailThread]);

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

  const handleContactSelect = (contact: Contact) => {
    console.log(`👤 Selecting contact: ${contact.name} (ID: ${contact.id})`);
    
    // Clear previous contact's data immediately
    setEmailThread([]);
    setSelectedContact(contact);
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
        <div className={`flex-none flex items-center justify-between p-4 md:p-6 border-b border-gray-200`}>
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
            
            {/* Search Bar */}
            <div className="p-3 md:p-4 border-b border-gray-200">
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

            {/* Contacts List */}
            <div className="flex-1 overflow-y-auto">
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

            {/* New Email Button */}
            <div className="p-3 md:p-4 border-t border-gray-200 bg-gray-50">
              <button
                onClick={() => setShowContactSelector(true)}
                className="w-full btn btn-outline btn-primary btn-sm"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                New Email
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
                    <div className="flex items-center justify-center h-full">
                      <div className="loading loading-spinner loading-lg text-blue-500"></div>
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
                    <div className="space-y-8">
                      {emailThread.map((message, index) => (
                        <div key={message.id} className="border-b border-gray-200 pb-6 last:border-b-0">
                          {/* Email Header with Label */}
                          <div className="flex items-center justify-between mb-4">
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
                                  {message.direction === 'outgoing' ? message.sender_name : selectedContact.name}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {formatDate(message.sent_at)}
                                </div>
                              </div>
                            </div>
                          </div>
                          
                          {/* Complete Email Content */}
                          <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
                            {/* Email Header */}
                            <div className="mb-4 pb-4 border-b border-gray-200">
                              <div className="text-sm text-gray-600 space-y-1">
                                <div><strong>From:</strong> {message.sender_name} &lt;{message.sender_email}&gt;</div>
                                <div><strong>To:</strong> {message.recipient_list || (message.direction === 'outgoing' ? `${selectedContact.name} <${selectedContact.email}>` : `eliran@lawoffice.org.il`)}</div>
                                <div><strong>Date:</strong> {formatDate(message.sent_at)}</div>
                                {message.subject && (
                                  <div><strong>Subject:</strong> {message.subject}</div>
                                )}
                              </div>
                            </div>
                            
                            {/* Complete Email Body - Full Content */}
                            <div className="email-content">
                              {message.body_html ? (
                                <div 
                                  dangerouslySetInnerHTML={{ __html: message.body_html }}
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
                                  {message.attachments.map((attachment, idx) => (
                                    <div key={idx} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                                      <PaperClipIcon className="w-5 h-5 text-gray-400" />
                                      <div className="flex-1">
                                        <div className="font-medium text-gray-900">{attachment.name}</div>
                                        {attachment.size && (
                                          <div className="text-sm text-gray-500">
                                            {(attachment.size / 1024).toFixed(1)} KB
                                          </div>
                                        )}
                                        {attachment.contentType && (
                                          <div className="text-xs text-gray-400">
                                            {attachment.contentType}
                                          </div>
                                        )}
                                      </div>
                                      {attachment.contentBytes && (
                                        <button
                                          onClick={() => downloadAttachment(message.id, attachment)}
                                          className="btn btn-sm btn-outline btn-primary"
                                          title="Download attachment"
                                        >
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                          </svg>
                                          Download
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
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
                <label className="font-semibold text-sm">To</label>
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
    </div>
  );
};

export default EmailThreadModal; 