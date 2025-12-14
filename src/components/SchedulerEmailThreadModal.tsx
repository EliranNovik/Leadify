import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, PaperAirplaneIcon, PaperClipIcon, MagnifyingGlassIcon, ChevronDownIcon, ChevronUpIcon, PlusIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { appendEmailSignature } from '../lib/emailSignature';
import sanitizeHtml from 'sanitize-html';
import {
  getMailboxStatus,
  triggerMailboxSync,
  sendEmailViaBackend,
  fetchEmailBodyFromBackend,
} from '../lib/mailboxApi';
import { fetchLeadContacts } from '../lib/contactHelpers';
import type { ContactInfo } from '../lib/contactHelpers';
import { replaceEmailTemplateParams } from '../lib/emailTemplateParams';

const normalizeEmailForFilter = (value?: string | null) =>
  value ? value.trim().toLowerCase() : '';

const sanitizeEmailForFilter = (value: string) =>
  value.replace(/[^a-z0-9@._+!~-]/g, '');

const collectClientEmails = (client?: { email?: string | null } | null): string[] => {
  const emails: string[] = [];
  const pushEmail = (val?: string | null) => {
    const normalized = normalizeEmailForFilter(val);
    if (normalized) {
      emails.push(normalized);
    }
  };

  if (client?.email) {
    pushEmail(client.email);
  }

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

interface SchedulerEmailThreadModalProps {
  isOpen: boolean;
  onClose: () => void;
  client?: {
    id: string;
    name: string;
    lead_number: string;
    email?: string;
    lead_type?: string;
    topic?: string;
    user_internal_id?: string | number | null;
  };
  onClientUpdate?: () => Promise<void>;
}

interface EmailTemplate {
  id: number;
  name: string;
  subject: string | null;
  content: string;
  rawContent: string;
  languageId: string | null;
  languageName: string | null;
  placementId: number | null;
  placementName: string | null;
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

const normaliseAddressList = (value: string | null | undefined) => {
  if (!value) return [] as string[];
  return value
    .split(/[;,]+/)
    .map(item => item.trim())
    .filter(item => item.length > 0);
};

const convertBodyToHtml = (text: string) => {
  if (!text) return '';
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  const escaped = text.replace(urlRegex, url => {
    const safeUrl = url.replace(/"/g, '&quot;');
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
  
  // Preserve line breaks: convert \n to <br>
  let html = escaped
    .replace(/\r\n/g, '\n')  // Normalize line endings
    .replace(/\r/g, '\n')    // Handle old Mac line endings
    .replace(/\n/g, '<br>'); // Convert to HTML line breaks
  
  // Check if content contains Hebrew/RTL text using helper function (defined later in component)
  // For now, use inline check to avoid dependency issues
  const textOnly = html.replace(/<[^>]*>/g, '');
  const isRTL = /[\u0590-\u05FF]/.test(textOnly);
  
  // Wrap with proper direction and styling
  if (isRTL) {
    html = `<div dir="rtl" style="text-align: right; direction: rtl; font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif;">${html}</div>`;
  } else {
    html = `<div dir="ltr" style="text-align: left; direction: ltr; font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif;">${html}</div>`;
  }
  
  return html;
};

// Filter out problematic image URLs that are known to be blocked by CORS
const filterProblematicImages = (html: string): string => {
  if (!html) return html;
  
  // List of domains/patterns that are commonly blocked by CORS
  const problematicPatterns = [
    'lh7-rt.googleusercontent.com',
    'googleusercontent.com',
    'drive.google.com',
  ];
  
  // Remove img tags with problematic URLs to prevent CORS errors
  let filteredHtml = html;
  
  problematicPatterns.forEach(pattern => {
    // Escape special regex characters in the pattern
    const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // More aggressive regex to catch all variations of img tags with problematic URLs
    // This will match img tags containing the pattern anywhere (in src, alt, or other attributes)
    const regex = new RegExp(
      `<img[^>]*?${escapedPattern}[^>]*?>`,
      'gis'
    );
    
    // Replace problematic img tags with empty string (remove them completely)
    filteredHtml = filteredHtml.replace(regex, '');
    
    // Also try matching with src attribute specifically (more specific match)
    const srcRegex = new RegExp(
      `<img[^>]*?src\\s*=\\s*["'][^"']*?${escapedPattern}[^"']*?["'][^>]*?>`,
      'gis'
    );
    filteredHtml = filteredHtml.replace(srcRegex, '');
  });
  
  return filteredHtml;
};

// Sanitize email HTML - preserve Outlook formatting
const sanitizeEmailHtml = (html: string): string => {
  // First filter out problematic images to prevent CORS errors
  const filteredHtml = filterProblematicImages(html);
  
  return sanitizeHtml(filteredHtml, {
    allowedTags: ['p', 'b', 'i', 'u', 'ul', 'ol', 'li', 'br', 'strong', 'em', 'a', 'span', 'div', 'body', 'img'],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      span: ['style', 'dir'],
      div: ['style', 'dir'],
      p: ['style', 'dir'],
      body: ['style', 'dir'],
      img: ['src', 'alt', 'style', 'width', 'height', 'crossorigin'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard',
  });
};

const replaceTemplateTokens = async (content: string, client: SchedulerEmailThreadModalProps['client']) => {
  if (!content) return '';
  
  const isLegacyLead = client?.lead_type === 'legacy' || 
                       (client?.id && client.id.toString().startsWith('legacy_'));
  
  // Determine client ID and legacy ID
  let clientId: string | null = null;
  let legacyId: number | null = null;
  
  if (isLegacyLead) {
    if (client?.id) {
      const numeric = parseInt(client.id.toString().replace(/[^0-9]/g, ''), 10);
      legacyId = isNaN(numeric) ? null : numeric;
      clientId = legacyId?.toString() || null;
    }
  } else {
    clientId = client?.id || null;
  }
  
  const context = {
    clientId,
    legacyId,
    clientName: client?.name || null,
    contactName: client?.name || null,
    leadNumber: client?.lead_number || null,
    topic: client?.topic || null,
    leadType: client?.lead_type || null,
  };
  
  return await replaceEmailTemplateParams(content, context);
};

// Check if an email is from the office domain (always team/user, never client)
const isOfficeEmail = (email: string | null | undefined): boolean => {
  if (!email) return false;
  return email.toLowerCase().endsWith('@lawoffice.org.il');
};

// Build email-to-display-name mapping for all employees
const buildEmployeeEmailToNameMap = async (): Promise<Map<string, string>> => {
  const emailToNameMap = new Map<string, string>();
  
  try {
    // Fetch all employees and users in parallel
    const [employeesResult, usersResult] = await Promise.all([
      supabase
        .from('tenants_employee')
        .select('id, display_name')
        .not('display_name', 'is', null),
      supabase
        .from('users')
        .select('employee_id, email')
        .not('email', 'is', null)
    ]);
    
    if (employeesResult.error || usersResult.error) {
      console.error('Error fetching employees/users for email mapping:', employeesResult.error || usersResult.error);
      return emailToNameMap;
    }
    
    // Create employee_id to email mapping from users table
    const employeeIdToEmail = new Map<number, string>();
    usersResult.data?.forEach((user: any) => {
      if (user.employee_id && user.email) {
        employeeIdToEmail.set(user.employee_id, user.email.toLowerCase());
      }
    });
    
    // Map emails to display names
    employeesResult.data?.forEach((emp: any) => {
      if (!emp.display_name) return;
      
      // Method 1: Use email from users table (employee_id match)
      const emailFromUsers = employeeIdToEmail.get(emp.id);
      if (emailFromUsers) {
        emailToNameMap.set(emailFromUsers, emp.display_name);
      }
      
      // Method 2: Use pattern matching (display_name.toLowerCase().replace(/\s+/g, '.') + '@lawoffice.org.il')
      const patternEmail = `${emp.display_name.toLowerCase().replace(/\s+/g, '.')}@lawoffice.org.il`;
      emailToNameMap.set(patternEmail, emp.display_name);
    });
  } catch (error) {
    console.error('Error building employee email-to-name map:', error);
  }
  
  return emailToNameMap;
};

const SchedulerEmailThreadModal: React.FC<SchedulerEmailThreadModalProps> = ({ isOpen, onClose, client, onClientUpdate }) => {
  const [emails, setEmails] = useState<any[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [emailSearchQuery, setEmailSearchQuery] = useState("");
  const [isSearchBarOpen, setIsSearchBarOpen] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeBodyIsRTL, setComposeBodyIsRTL] = useState(false);
  const [composeAttachments, setComposeAttachments] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [currentUserFullName, setCurrentUserFullName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [toRecipients, setToRecipients] = useState<string[]>([]);
  const [ccRecipients, setCcRecipients] = useState<string[]>([]);
  const [toInput, setToInput] = useState('');
  const [ccInput, setCcInput] = useState('');
  const [recipientError, setRecipientError] = useState<string | null>(null);
  
  // Employee autocomplete state
  const [employees, setEmployees] = useState<Array<{ email: string; name: string }>>([]);
  const [toSuggestions, setToSuggestions] = useState<Array<{ email: string; name: string }>>([]);
  const [ccSuggestions, setCcSuggestions] = useState<Array<{ email: string; name: string }>>([]);
  const [showToSuggestions, setShowToSuggestions] = useState(false);
  const [showCcSuggestions, setShowCcSuggestions] = useState(false);
  const toSuggestionsRef = useRef<HTMLDivElement>(null);
  const ccSuggestionsRef = useRef<HTMLDivElement>(null);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const templateDropdownRef = useRef<HTMLDivElement | null>(null);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  // Template filters
  const [templateLanguageFilter, setTemplateLanguageFilter] = useState<string | null>(null);
  const [templatePlacementFilter, setTemplatePlacementFilter] = useState<number | null>(null);
  const [availableLanguages, setAvailableLanguages] = useState<Array<{ id: string; name: string }>>([]);
  const [availablePlacements, setAvailablePlacements] = useState<Array<{ id: number; name: string }>>([]);
  
  const filteredTemplates = useMemo(() => {
    let filtered = templates;
    
    // Filter by language
    if (templateLanguageFilter) {
      filtered = filtered.filter(template => template.languageId === templateLanguageFilter);
    }
    
    // Filter by placement
    if (templatePlacementFilter !== null) {
      filtered = filtered.filter(template => template.placementId === templatePlacementFilter);
    }
    
    // Filter by search query
    const query = templateSearch.trim().toLowerCase();
    if (query) {
      filtered = filtered.filter(template => template.name.toLowerCase().includes(query));
    }
    
    return filtered;
  }, [templates, templateSearch, templateLanguageFilter, templatePlacementFilter]);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>('');
  const [mailboxStatus, setMailboxStatus] = useState<{ connected: boolean; lastSync?: string | null; error?: string | null }>({
    connected: false,
  });
  const [downloadingAttachments, setDownloadingAttachments] = useState<Record<string, boolean>>({});
  const syncOnOpenRef = useRef(false);
  
  // State for lead contacts (all contacts associated with the client)
  const [leadContacts, setLeadContacts] = useState<ContactInfo[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);

  const extractHtmlBody = (html: string) => {
    if (!html) return html;
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    return bodyMatch ? bodyMatch[1] : html;
  };

  // Format time with date and time - shows full date and time
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    
    // Compare dates by calendar day (ignore time) to properly detect today/yesterday
    const dateStartOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const nowStartOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((nowStartOfDay.getTime() - dateStartOfDay.getTime()) / (1000 * 60 * 60 * 24));

    const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (diffDays === 0) {
      // Today: show "Today at HH:MM"
      return `Today at ${timeString}`;
    } else if (diffDays === 1) {
      // Yesterday: show "Yesterday at HH:MM"
      return `Yesterday at ${timeString}`;
    } else if (diffDays <= 7) {
      // Within a week: show weekday, date, and time
      const weekday = date.toLocaleDateString([], { weekday: 'short' });
      const monthDay = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      return `${weekday}, ${monthDay} at ${timeString}`;
    } else {
      // Older: show full date and time
      const dateString = date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
      return `${dateString} at ${timeString}`;
    }
  };

  // Format date separator
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

  // Extract visible text from HTML for RTL detection (ignore HTML tags and metadata)
  const extractVisibleText = (html?: string | null): string => {
    if (!html) return '';
    // Remove HTML tags but preserve text content
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    return tempDiv.textContent || tempDiv.innerText || '';
  };

  const containsRTL = (text?: string | null) => {
    if (!text) return false;
    // Check only visible text content, not HTML tags
    const visibleText = extractVisibleText(text);
    return /[\u0590-\u05FF]/.test(visibleText);
  };

  // Get direction for plain text (no HTML)
  const getTextDirection = (text?: string | null): 'rtl' | 'ltr' => {
    if (!text) return 'ltr';
    return /[\u0590-\u05FF]/.test(text) ? 'rtl' : 'ltr';
  };

  const getMessageDirection = (message: any): 'rtl' | 'ltr' => {
    // Check subject (plain text)
    if (message.subject && /[\u0590-\u05FF]/.test(message.subject)) {
      return 'rtl';
    }
    // Check body_html (extract visible text only)
    if (message.body_html && containsRTL(message.body_html)) {
      return 'rtl';
    }
    // Check body_preview (extract visible text only)
    if (message.body_preview && containsRTL(message.body_preview)) {
      return 'rtl';
    }
    return 'ltr';
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [emails]);

  // Handle image loading errors in email content (CORS-blocked images from external domains)
  useEffect(() => {
    if (!isOpen || emails.length === 0) return;

    // Small delay to ensure DOM is updated after emails changes
    const timeoutId = setTimeout(() => {
      const emailContentDivs = document.querySelectorAll('.email-content');
      emailContentDivs.forEach(div => {
        const images = div.querySelectorAll('img');
        images.forEach((img: HTMLImageElement) => {
          // Remove existing error handlers to avoid duplicates
          const existingHandler = (img as any).__errorHandler;
          if (existingHandler) {
            img.removeEventListener('error', existingHandler);
          }

          // Check if image is already in an error state (failed to load)
          if (img.complete && img.naturalHeight === 0) {
            // Image already failed to load
            img.style.display = 'none';
            img.setAttribute('data-load-error', 'true');
            return;
          }

          // Check for known problematic URLs (Google Drive, etc.) and hide them preemptively
          const src = img.src || img.getAttribute('src') || '';
          if (src && (
            src.includes('lh7-rt.googleusercontent.com') ||
            src.includes('googleusercontent.com/docsz') ||
            src.includes('google-drive') ||
            src.includes('drive.google.com')
          )) {
            // Pre-emptively hide known problematic external images
            img.style.display = 'none';
            img.setAttribute('data-load-error', 'true');
            return;
          }

          // Add error handler to hide images that fail to load (CORS issues)
          const errorHandler = () => {
            // Hide the image instead of showing broken image icon
            img.style.display = 'none';
            img.setAttribute('data-load-error', 'true');
          };

          img.addEventListener('error', errorHandler);
          // Store reference to handler for cleanup
          (img as any).__errorHandler = errorHandler;
        });
      });
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      // Cleanup: remove error handlers
      const emailContentDivs = document.querySelectorAll('.email-content');
      emailContentDivs.forEach(div => {
        const images = div.querySelectorAll('img');
        images.forEach(img => {
          const handler = (img as any).__errorHandler;
          if (handler) {
            img.removeEventListener('error', handler);
            delete (img as any).__errorHandler;
          }
        });
      });
    };
  }, [isOpen, emails]);

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

  useEffect(() => {
    if (!isOpen || !client) return;
    const initialRecipients = normaliseAddressList(client.email);
    setToRecipients(initialRecipients.length > 0 ? initialRecipients : []);
    setCcRecipients([]);
    setToInput('');
    setCcInput('');
    setRecipientError(null);
    setSelectedTemplateId(null);
    setTemplateSearch('');
    setTemplateLanguageFilter(null);
    setTemplatePlacementFilter(null);
    setShowLinkForm(false);
    setLinkLabel('');
    setLinkUrl('');
  }, [isOpen, client?.email]);

  // Fetch contacts for the client
  useEffect(() => {
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
  }, [client]);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    const loadTemplates = async () => {
      try {
        // First, fetch languages and placements to create lookup maps
        const [languagesResult, placementsResult, templatesResult] = await Promise.all([
          supabase
            .from('misc_language')
            .select('id, name')
            .order('name', { ascending: true }),
          supabase
            .from('email_templates_placement')
            .select('id, name')
            .order('name', { ascending: true }),
          supabase
            .from('misc_emailtemplate')
            .select(`
              *,
              email_templates_placement!placement_id (
                id,
                name
              )
            `)
            .eq('active', 't')
            .order('name', { ascending: true })
        ]);

        if (templatesResult.error) {
          console.error('Error fetching templates:', templatesResult.error);
          throw templatesResult.error;
        }
        if (!isMounted) return;

        // Create lookup maps for languages and placements
        const languageMap = new Map<string, string>();
        if (!languagesResult.error && languagesResult.data) {
          languagesResult.data.forEach((lang: any) => {
            languageMap.set(String(lang.id), lang.name || 'Unknown');
          });
          setAvailableLanguages(languagesResult.data.map((lang: any) => ({
            id: String(lang.id),
            name: lang.name || 'Unknown'
          })));
        }

        const placementMap = new Map<number, string>();
        if (!placementsResult.error && placementsResult.data) {
          placementsResult.data.forEach((placement: any) => {
            const placementId = typeof placement.id === 'number' ? placement.id : Number(placement.id);
            placementMap.set(placementId, placement.name || 'Unknown');
          });
          setAvailablePlacements(placementsResult.data.map((placement: any) => ({
            id: typeof placement.id === 'number' ? placement.id : Number(placement.id),
            name: placement.name || 'Unknown'
          })));
        }

        // Parse templates and match with language/placement names
        const parsed = (templatesResult.data || []).map((template: any) => {
          const placement = Array.isArray(template.email_templates_placement) 
            ? template.email_templates_placement[0] 
            : template.email_templates_placement;
          
          const languageId = template.language_id ? String(template.language_id) : null;
          const languageName = languageId ? languageMap.get(languageId) || null : null;
          
          return {
            id: typeof template.id === 'number' ? template.id : Number(template.id),
            name: template.name || `Template ${template.id}`,
            subject: typeof template.subject === 'string' ? template.subject : null,
            content: parseTemplateContent(template.content),
            rawContent: template.content || '',
            languageId: languageId,
            languageName: languageName,
            placementId: placement?.id ? (typeof placement.id === 'number' ? placement.id : Number(placement.id)) : null,
            placementName: placement?.name || null,
          };
        });

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
        console.error('Failed to load authenticated user for SchedulerEmailThreadModal:', error);
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
      console.error('Failed to fetch mailbox status for scheduler modal:', error);
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

  // Fetch current user's full name
  useEffect(() => {
    if (!userId) {
      setCurrentUserFullName('');
      return;
    }
    let isMounted = true;
    const fetchCurrentUserFullName = async () => {
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
        console.error('Error fetching user full name:', error);
      }
    };
    fetchCurrentUserFullName();
    return () => {
      isMounted = false;
    };
  }, [userId, userEmail]);

  const hydrateEmailBodies = useCallback(
    async (messages: any[]) => {
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
          if (!message.message_id) return;
          try {
            const rawContent = await fetchEmailBodyFromBackend(userId, message.message_id);
            if (!rawContent || typeof rawContent !== 'string') return;
            
            // Filter problematic images before processing
            const filteredContent = filterProblematicImages(rawContent);
            const cleanedHtml = extractHtmlBody(filteredContent);
            const sanitised = cleanedHtml ? sanitizeEmailHtml(cleanedHtml) : sanitizeEmailHtml(filteredContent);
            
            updates[message.message_id] = {
              html: sanitised,
              preview: sanitised,
            };
            await supabase
              .from('emails')
              .update({ body_html: rawContent, body_preview: rawContent })
              .eq('message_id', message.message_id);
          } catch (error) {
            console.warn('Failed to hydrate scheduler email body from backend:', error);
          }
        })
      );

      if (Object.keys(updates).length > 0) {
        setEmails(prev =>
          prev.map(email => {
            const update = updates[email.message_id];
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

  // Function to fetch emails from database for the modal
  const fetchEmailsForModal = useCallback(async () => {
    if (!client?.id) return;
    
    setEmailsLoading(true);
    try {
      // Fetch emails from database for this specific client
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      const legacyId = isLegacyLead ? parseInt(client.id.replace('legacy_', '')) : null;
      let emailQuery = supabase
        .from('emails')
        .select('id, message_id, sender_name, sender_email, recipient_list, subject, body_html, body_preview, sent_at, direction, attachments')
        .order('sent_at', { ascending: true });

      const emailFilters = buildEmailFilterClauses({
        clientId: !isLegacyLead ? String(client.id) : null,
        legacyId,
        emails: collectClientEmails(client),
      });

      if (emailFilters.length > 0) {
        emailQuery = emailQuery.or(emailFilters.join(','));
      } else if (isLegacyLead && legacyId !== null) {
        emailQuery = emailQuery.eq('legacy_id', legacyId);
      } else {
        emailQuery = emailQuery.eq('client_id', client.id);
      }
      
      const { data: emailData, error: emailError } = await emailQuery;
      
      if (emailError) {
        console.error('Error fetching emails:', emailError);
        setEmails([]);
        return;
      }
      
      // Build employee email-to-name mapping once for all emails
      const employeeEmailMap = await buildEmployeeEmailToNameMap();
      
      // Format emails for display - preserve Outlook HTML structure
      const formattedEmailsForModal = (emailData || []).map((email: any) => {
        let rawHtml = typeof email.body_html === 'string' ? email.body_html : null;
        let rawPreview = typeof email.body_preview === 'string' ? email.body_preview : null;
        
        // Filter out problematic images BEFORE processing to prevent CORS errors
        if (rawHtml) {
          rawHtml = filterProblematicImages(rawHtml);
        }
        if (rawPreview) {
          rawPreview = filterProblematicImages(rawPreview);
        }
        
        // Preserve original Outlook HTML as much as possible
        // Only extract body if it's wrapped in <body> tags, but preserve all formatting
        let cleanedHtml = null;
        if (rawHtml) {
          const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
          if (bodyMatch) {
            // Extract body content but preserve the inner HTML structure
            cleanedHtml = bodyMatch[1];
          } else {
            // No body tags, use as-is
            cleanedHtml = rawHtml;
          }
        }
        
        let cleanedPreview = null;
        if (rawPreview) {
          const previewMatch = rawPreview.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
          if (previewMatch) {
            cleanedPreview = previewMatch[1];
          } else {
            cleanedPreview = rawPreview;
          }
        } else if (cleanedHtml) {
          cleanedPreview = cleanedHtml;
        }
        
        const fallbackText = cleanedPreview || cleanedHtml || email.subject || '';
        
        // Sanitize but preserve Outlook's direction and style attributes
        const sanitizedHtml = cleanedHtml ? sanitizeEmailHtml(cleanedHtml) : null;
        const sanitizedPreview = cleanedPreview
          ? sanitizeEmailHtml(cleanedPreview)
          : sanitizedHtml ?? (fallbackText ? sanitizeEmailHtml(convertBodyToHtml(fallbackText)) : null);

        // Parse attachments from JSONB - it might be a string or already an array
        let parsedAttachments: any[] = [];
        if (email.attachments) {
          try {
            // If it's a string, parse it
            if (typeof email.attachments === 'string') {
              parsedAttachments = JSON.parse(email.attachments);
            } 
            // If it's already an array, use it directly
            else if (Array.isArray(email.attachments)) {
              parsedAttachments = email.attachments;
            }
            // If it's an object with a value property (Graph API format), extract the array
            else if (email.attachments.value && Array.isArray(email.attachments.value)) {
              parsedAttachments = email.attachments.value;
            }
            // If it's a single object, wrap it in an array
            else if (typeof email.attachments === 'object') {
              parsedAttachments = [email.attachments];
            }
          } catch (e) {
            console.error('Error parsing attachments:', e, email.attachments);
            parsedAttachments = [];
          }
        }
        
        // Filter out inline attachments that shouldn't be displayed as separate attachments
        parsedAttachments = parsedAttachments.filter((att: any) => {
          // Only show non-inline attachments or if isInline is false/undefined
          return att && !att.isInline && att.name;
        });
        
        // Determine if email is from team/user based on sender email domain
        // Emails from @lawoffice.org.il are ALWAYS team/user, never client
        const senderEmail = email.sender_email || '';
        const isFromOffice = isOfficeEmail(senderEmail);
        
        // Override direction field: if sender is from office domain, it's always outgoing (team/user)
        let correctedDirection = email.direction;
        if (isFromOffice) {
          correctedDirection = 'outgoing';
        }
        
        return {
          id: email.id,
          message_id: email.message_id,
          subject: email.subject || 'No Subject',
          body_html: sanitizedHtml,
          body_preview: sanitizedPreview || '',
          from: senderEmail,
          to: email.recipient_list || '',
          date: email.sent_at,
          direction: correctedDirection,
          sender_email: senderEmail, // Keep original for reference
          sender_name: email.sender_name || null, // Keep original sender_name
          attachments: parsedAttachments,
          // Store employee display_name if from office domain (fetched from tenants_employee table)
          sender_display_name: isFromOffice ? (employeeEmailMap.get(senderEmail.toLowerCase()) || email.sender_name || null) : null
        };
      });
      
      setEmails(formattedEmailsForModal);
      await hydrateEmailBodies(formattedEmailsForModal);
    } catch (error) {
      console.error('❌ Error in fetchEmailsForModal:', error);
      setEmails([]);
    } finally {
      setEmailsLoading(false);
    }
  }, [client, hydrateEmailBodies]);

  const runMailboxSync = useCallback(async () => {
    if (!userId) {
      toast.error('Please sign in to sync emails.');
      return;
    }
    if (!mailboxStatus.connected) {
      toast.error('Mailbox not connected. Please connect it before syncing.');
      return;
    }

    try {
      await triggerMailboxSync(userId);
      await refreshMailboxStatus();
      await fetchEmailsForModal();
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error) {
      console.warn('SchedulerEmailThreadModal: Mailbox sync failed, continuing with cached emails', error);
      toast.error(error instanceof Error ? error.message : 'Failed to sync emails.');
    }
  }, [userId, mailboxStatus.connected, refreshMailboxStatus, fetchEmailsForModal, onClientUpdate]);

  // Fetch emails when modal opens
  useEffect(() => {
    if (!isOpen || !client) {
      syncOnOpenRef.current = false;
      return;
    }

    const defaultSubject = `[${client.lead_number}] - ${client.name} - ${client.topic || ''}`;
    setComposeSubject(prev => (prev && prev.trim() ? prev : defaultSubject));

    if (!syncOnOpenRef.current) {
      // First open: load from DB immediately for fast UI,
      // then trigger a background sync that will update the DB.
      syncOnOpenRef.current = true;
      fetchEmailsForModal();
      runMailboxSync();
    } else {
      // Subsequent opens: just load from DB.
      fetchEmailsForModal();
    }
  }, [isOpen, client, runMailboxSync, fetchEmailsForModal]);

  const handleAttachmentUpload = (files: FileList) => {
    if (!files || files.length === 0) return;
    
    const newFiles = Array.from(files);
    setComposeAttachments(prev => [...prev, ...newFiles]);
  };

  const handleSendEmail = async () => {
    if (!client || !composeBody.trim()) {
      toast.error('Please enter a message.');
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
      const fallbackRecipients = normaliseAddressList(client.email);
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

    setSending(true);

    // Snapshot current compose state so we can send in the background
    const bodySnapshot = composeBody;
    const attachmentsSnapshot = [...composeAttachments];
    const toSnapshot = [...finalToRecipients];
    const ccSnapshot = [...finalCcRecipients];
    const subjectSnapshot =
      composeSubject && composeSubject.trim()
        ? composeSubject.trim()
        : `[${client.lead_number}] - ${client.name}`;

    // Optimistic UI: append an outgoing email immediately using basic HTML.
    const optimisticId = `temp_${Date.now()}`;
    const optimisticSentAt = new Date().toISOString();
    const optimisticBodyHtml = convertBodyToHtml(bodySnapshot);

    const optimisticEmail = {
      id: optimisticId,
      message_id: optimisticId,
      subject: subjectSnapshot,
      body_html: optimisticBodyHtml,
      body_preview: optimisticBodyHtml,
      from: userEmail || '',
      to: toSnapshot.join(', '),
      date: optimisticSentAt,
      sent_at: optimisticSentAt,
      direction: 'outgoing' as const,
      attachments: attachmentsSnapshot.map((file) => ({
        name: file.name,
        contentType: file.type || 'application/octet-stream',
      })),
    };

    setEmails((prev) => [...prev, optimisticEmail]);

    // Reset compose UI immediately
    toast.success('Email queued to send');
    setComposeBody('');
    setComposeBodyIsRTL(false);
    setComposeAttachments([]);
    const defaultSubject = `[${client.lead_number}] - ${client.name} - ${client.topic || ''}`;
    setComposeSubject(defaultSubject);
    setShowLinkForm(false);
    setLinkLabel('');
    setLinkUrl('');
    setShowCompose(false);
    setSending(false);

    // Fire-and-forget: perform the actual send in the background.
    (async () => {
      try {
        const bodyHtml = convertBodyToHtml(bodySnapshot);
        const emailContentWithSignature = await appendEmailSignature(bodyHtml);
        const attachmentsPayload = await Promise.all(
          attachmentsSnapshot.map(async (file) => ({
            name: file.name,
            contentType: file.type || 'application/octet-stream',
            contentBytes: await fileToBase64(file),
          }))
        );

        const isLegacyLead =
          client?.lead_type === 'legacy' || client?.id.toString().startsWith('legacy_');
        const legacyId = isLegacyLead
          ? (() => {
              const numeric = parseInt(String(client.id).replace('legacy_', ''), 10);
              return Number.isNaN(numeric) ? null : numeric;
            })()
          : null;

        // Find the contact_id from the selected contact or the first recipient
        let contactId: number | null = selectedContactId;
        if (!contactId && toSnapshot.length > 0) {
          // Try to find contact by email
          const contactByEmail = leadContacts.find(c => c.email === toSnapshot[0]);
          if (contactByEmail) {
            contactId = contactByEmail.id;
          }
        }

        await sendEmailViaBackend({
          userId,
          subject: subjectSnapshot,
          bodyHtml: emailContentWithSignature,
          to: toSnapshot,
          cc: ccSnapshot,
          attachments: attachmentsPayload.length > 0 ? attachmentsPayload : undefined,
          context: {
            clientId: !isLegacyLead ? client.id : null,
            legacyLeadId: isLegacyLead ? legacyId : null,
            leadType: client?.lead_type || (isLegacyLead ? 'legacy' : 'new'),
            leadNumber: client?.lead_number || null,
            contactEmail: client?.email || null,
            contactName: client?.name || null,
            contactId: contactId || null,
            senderName: currentUserFullName || userEmail || 'Team',
            userInternalId: client?.user_internal_id || undefined,
          },
        });

        // Refresh from DB so optimistic email is replaced with stored one.
        await fetchEmailsForModal();
      } catch (error) {
        console.error('Error sending email (background):', error);
        toast.error(error instanceof Error ? error.message : 'Failed to send email');
      }
    })();
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = reader.result as string;
        resolve(base64.split(',')[1]);
      };
      reader.onerror = error => reject(error);
    });
  };

  if (!isOpen) return null;

  // Search employees locally
  const searchEmployees = (searchText: string): Array<{ email: string; name: string }> => {
    if (!searchText || searchText.trim().length < 1) return [];
    
    const searchLower = searchText.trim().toLowerCase();
    return employees
      .filter(emp => 
        emp.name.toLowerCase().includes(searchLower) || 
        emp.email.toLowerCase().includes(searchLower)
      )
      .slice(0, 10); // Limit to 10 results
  };

  const renderRecipients = (type: 'to' | 'cc') => {
    const recipients = type === 'to' ? toRecipients : ccRecipients;
    const inputValue = type === 'to' ? toInput : ccInput;
    const setInputValue = type === 'to' ? setToInput : setCcInput;
    const setRecipients = type === 'to' ? setToRecipients : setCcRecipients;
    const suggestions = type === 'to' ? toSuggestions : ccSuggestions;
    const showSuggestions = type === 'to' ? showToSuggestions : showCcSuggestions;
    const suggestionsRef = type === 'to' ? toSuggestionsRef : ccSuggestionsRef;

    const addRecipient = (email: string) => {
      if (email && emailRegex.test(email)) {
        setRecipients(prev => [...prev, email]);
        setInputValue('');
        if (type === 'to') {
          setShowToSuggestions(false);
          setToSuggestions([]);
        } else {
          setShowCcSuggestions(false);
          setCcSuggestions([]);
        }
      }
    };

    return (
      <div className="relative">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            className="input input-bordered w-full"
            placeholder={`Add ${type} recipient (e.g., name@example.com)`}
            value={inputValue}
            onChange={event => {
              const newValue = event.target.value;
              setInputValue(newValue);
              
              // Search employees immediately as user types
              if (newValue.trim().length > 0) {
                const results = searchEmployees(newValue.trim());
                if (type === 'to') {
                  setToSuggestions(results);
                  setShowToSuggestions(results.length > 0);
                } else {
                  setCcSuggestions(results);
                  setShowCcSuggestions(results.length > 0);
                }
              } else {
                if (type === 'to') {
                  setToSuggestions([]);
                  setShowToSuggestions(false);
                } else {
                  setCcSuggestions([]);
                  setShowCcSuggestions(false);
                }
              }
            }}
            onFocus={() => {
              // Show suggestions if we have them or search again
              if (inputValue.trim().length > 0) {
                const results = searchEmployees(inputValue.trim());
                if (type === 'to') {
                  setToSuggestions(results);
                  setShowToSuggestions(results.length > 0);
                } else {
                  setCcSuggestions(results);
                  setShowCcSuggestions(results.length > 0);
                }
              }
            }}
            onBlur={() => {
              // Delay hiding to allow clicking on suggestions
              setTimeout(() => {
                if (type === 'to') {
                  setShowToSuggestions(false);
                } else {
                  setShowCcSuggestions(false);
                }
              }, 200);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                // If there are suggestions, use the first one, otherwise use the input value
                if (showSuggestions && suggestions.length > 0) {
                  addRecipient(suggestions[0].email);
                } else {
                  const newRecipient = inputValue.trim();
                  if (newRecipient && emailRegex.test(newRecipient)) {
                    addRecipient(newRecipient);
                  }
                }
              } else if (event.key === 'ArrowDown' && showSuggestions && suggestions.length > 0) {
                event.preventDefault();
                addRecipient(suggestions[0].email);
              } else if (event.key === 'Escape') {
                if (type === 'to') {
                  setShowToSuggestions(false);
                } else {
                  setShowCcSuggestions(false);
                }
              }
            }}
          />
        </div>
        
        {/* Recipient tags */}
        {recipients.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {recipients.map((recipient, index) => (
              <span key={index} className="flex items-center bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full">
                {recipient}
                <button
                  type="button"
                  onClick={() => setRecipients(prev => prev.filter((_, i) => i !== index))}
                  className="ml-1 text-blue-800 hover:text-blue-900"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        
        {/* Autocomplete Suggestions Dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div
            ref={suggestionsRef}
            className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto"
            onMouseDown={(e) => e.preventDefault()} // Prevent input blur on click
          >
            {suggestions.map((suggestion, index) => (
              <div
                key={`${type}-suggestion-${index}-${suggestion.email}`}
                className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm border-b border-gray-100 last:border-b-0"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addRecipient(suggestion.email);
                }}
              >
                <div className="font-medium text-gray-900">{suggestion.name}</div>
                <div className="text-xs text-gray-500">{suggestion.email}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Helper function to check if text contains Hebrew
  const containsHebrew = (text: string): boolean => {
    return /[\u0590-\u05FF]/.test(text);
  };

  // Helper function to check if language is Hebrew
  const isHebrewLanguage = (languageId: string | null, languageName: string | null): boolean => {
    if (!languageId && !languageName) return false;
    const langId = languageId?.toString().toLowerCase() || '';
    const langName = languageName?.toString().toLowerCase() || '';
    return langId.includes('he') || langName.includes('hebrew') || langName.includes('עברית');
  };

  const handleTemplateSelect = (template: EmailTemplate) => {
    setSelectedTemplateId(template.id);
    // Use parsed content which preserves line breaks from DB
    const finalBody = template.content || '';
    setComposeBody(finalBody);
    
    // Check if template is Hebrew based on language or content
    const isHebrew = isHebrewLanguage(template.languageId, template.languageName) || containsHebrew(finalBody);
    setComposeBodyIsRTL(isHebrew);
    
    setComposeSubject(template.subject || `[${client?.lead_number}] - ${client?.name} - ${client?.topic || ''}]`);
    setShowLinkForm(false);
    setLinkLabel('');
    setLinkUrl('');
  };

  const handleInsertLink = () => {
    if (!linkUrl.trim()) return;
    const linkMarkdown = `[${linkLabel || linkUrl}](${linkUrl})`;
    setComposeBody(prev => prev + '\n\n' + linkMarkdown);
    setShowLinkForm(false);
    setLinkLabel('');
    setLinkUrl('');
  };

  const handleCancelLink = () => {
    setShowLinkForm(false);
    setLinkLabel('');
    setLinkUrl('');
  };

  return (
    <>
      {createPortal(
        <div className="fixed inset-0 bg-white z-[9999]">
          {/* CSS to ensure email content displays fully and preserves Outlook formatting */}
          <style>{`
            .email-content {
              max-width: none !important;
              overflow: visible !important;
              word-wrap: break-word !important;
            }
            .email-content * {
              max-width: none !important;
              overflow: visible !important;
            }
            .email-content img {
              max-width: 100% !important;
              height: auto !important;
            }
            .email-content img[data-load-error="true"] {
              display: none !important;
            }
            .email-content table {
              width: 100% !important;
              border-collapse: collapse !important;
            }
            .email-content p, 
            .email-content div, 
            .email-content span {
              word-wrap: break-word !important;
            }
            /* Preserve Outlook's original text direction and alignment */
            .email-content [dir] {
              /* Let Outlook's dir attribute control direction */
            }
            .email-content [dir="auto"] {
              unicode-bidi: plaintext;
            }
            .email-content [dir="rtl"] {
              text-align: right;
            }
            .email-content [dir="ltr"] {
              text-align: left;
            }
          `}</style>
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 md:p-6 border-b border-gray-200">
              <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
                <h2 className="text-lg md:text-2xl font-bold text-gray-900">Email Thread</h2>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0"></div>
                  <span className="text-gray-600 text-sm md:text-base truncate">
                    {client?.name} ({client?.lead_number})
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="btn btn-ghost btn-circle"
                >
                  <XMarkIcon className="w-5 h-5 md:w-6 md:h-6" />
                </button>
              </div>
            </div>

            {/* Search Bar - Collapsible */}
            <div className="border-b border-gray-200 bg-white">
              {/* Toggle Button */}
              <div className="px-4 md:px-6 py-2 flex items-center justify-between">
                <button
                  onClick={() => setIsSearchBarOpen(!isSearchBarOpen)}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                >
                  <span>Search emails</span>
                  {isSearchBarOpen ? (
                    <ChevronUpIcon className="h-4 w-4" />
                  ) : (
                    <ChevronDownIcon className="h-4 w-4" />
                  )}
                </button>
                {emailSearchQuery && (
                  <span className="text-xs text-gray-500">
                    {emailSearchQuery.length} character{emailSearchQuery.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {/* Search Input - Collapsible */}
              {isSearchBarOpen && (
                <div className="px-4 md:px-6 pb-3 transition-all duration-200">
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
                      autoFocus
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
              )}
            </div>

            {/* Email Thread */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 min-h-0 overscroll-contain bg-white" style={{ WebkitOverflowScrolling: 'touch' }}>
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
                    <p className="text-sm">No emails found for {client?.name}. Try syncing or send a new email.</p>
                  </div>
                </div>
              ) : emails.filter((message) => {
                if (!emailSearchQuery.trim()) return true;
                
                const searchTerm = emailSearchQuery.toLowerCase();
                
                // Search in subject
                if (message.subject && message.subject.toLowerCase().includes(searchTerm)) return true;
                
                // Search in email body content
                if (message.body_preview && message.body_preview.toLowerCase().includes(searchTerm)) return true;
                
                // Search in sender name (from field)
                if (message.from && message.from.toLowerCase().includes(searchTerm)) return true;
                
                // Search in recipient (to field)
                if (message.to && message.to.toLowerCase().includes(searchTerm)) return true;
                
                // Search in sender name (display name)
                // Determine if from office domain (team/user) based on email, not just direction
                const isFromOffice = isOfficeEmail(message.from);
                const isTeamEmail = isFromOffice || message.direction === 'outgoing';
                const senderName = isTeamEmail 
                  ? ((message as any).sender_display_name || currentUserFullName || 'Team')
                  : (client?.name || 'Client');
                if (senderName && senderName.toLowerCase().includes(searchTerm)) return true;
                
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
                <div className="space-y-4">
                  {[...emails]
                    .filter((message) => {
                      if (!emailSearchQuery.trim()) return true;
                      
                      const searchTerm = emailSearchQuery.toLowerCase();
                      
                      // Search in subject
                      if (message.subject && message.subject.toLowerCase().includes(searchTerm)) return true;
                      
                      // Search in email body content
                      if (message.body_preview && message.body_preview.toLowerCase().includes(searchTerm)) return true;
                      
                      // Search in sender name (from field)
                      if (message.from && message.from.toLowerCase().includes(searchTerm)) return true;
                      
                      // Search in recipient (to field)
                      if (message.to && message.to.toLowerCase().includes(searchTerm)) return true;
                      
                      // Search in sender name (display name)
                      // Determine if from office domain (team/user) based on email, not just direction
                      const isFromOffice = isOfficeEmail(message.from);
                      const isTeamEmail = isFromOffice || message.direction === 'outgoing';
                      const senderName = isTeamEmail 
                        ? ((message as any).sender_display_name || currentUserFullName || 'Team')
                        : (client?.name || 'Client');
                      if (senderName && senderName.toLowerCase().includes(searchTerm)) return true;
                      
                      return false;
                    })
                    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                    .map((message, index, filteredMessages) => {
                      const showDateSeparator = index === 0 || 
                        new Date(message.date).toDateString() !== new Date(filteredMessages[index - 1].date).toDateString();
                      
                      // Determine if email is from team/user based on sender email domain
                      // Emails from @lawoffice.org.il are ALWAYS team/user, never client
                      const senderEmail = message.from || '';
                      const isFromOffice = isOfficeEmail(senderEmail);
                      // If sender is from office domain, it's ALWAYS team/user, regardless of direction field
                      const isTeamEmail = isFromOffice ? true : (message.direction === 'outgoing');
                      
                      // Get sender display name - use employee display_name for office emails
                      let senderDisplayName: string;
                      if (isTeamEmail) {
                        // For team/user emails: use employee display_name from cache if available, otherwise fallback
                        senderDisplayName = (message as any).sender_display_name 
                          || message.sender_name 
                          || currentUserFullName 
                          || senderEmail 
                          || 'Team';
                      } else {
                        // For client emails
                        senderDisplayName = client?.name || message.sender_name || senderEmail || 'Client';
                      }
                      
                      const messageDirection = getMessageDirection(message);
                      const isRTLMessage = messageDirection === 'rtl';
                      
                      return (
                        <React.Fragment key={message.id || index}>
                          {showDateSeparator && (
                            <div className="flex justify-center my-4">
                              <div className="bg-white border border-gray-200 text-gray-600 text-sm font-medium px-3 py-1.5 rounded-full shadow-sm">
                                {formatDateSeparator(message.date)}
                              </div>
                            </div>
                          )}
                          
                          <div className={`flex flex-col ${isTeamEmail ? 'items-end' : 'items-start'}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
                                isTeamEmail
                                  ? 'bg-blue-100 text-blue-700 border border-blue-200'
                                  : 'bg-pink-100 text-pink-700 border border-pink-200'
                              }`}>
                                {isTeamEmail ? 'Team' : 'Client'}
                              </div>
                              <div
                                className={`text-xs font-semibold ${
                                  isTeamEmail ? 'text-blue-600' : 'text-gray-600'
                                }`}
                                dir={getTextDirection(senderDisplayName)}
                              >
                                {senderDisplayName}
                              </div>
                            </div>
                            <div
                              className="max-w-full md:max-w-[70%] rounded-2xl px-4 py-2 shadow-sm border border-gray-200 bg-white text-gray-900"
                              style={{ 
                                wordBreak: 'break-word', 
                                overflowWrap: 'anywhere'
                              }}
                            >
                              <div className="mb-2">
                                <div 
                                  className="text-sm font-semibold text-gray-900" 
                                  dir="auto"
                                >
                                  {message.subject}
                                </div>
                                <div className="text-xs text-gray-500 mt-1" dir="ltr" style={{ textAlign: 'left' }}>{formatTime(message.date)}</div>
                              </div>
                              
                              {message.body_html ? (
                                <div
                                  dangerouslySetInnerHTML={{ __html: message.body_html }}
                                  className="prose prose-sm max-w-none text-gray-700 break-words email-content"
                                  style={{ 
                                    wordBreak: 'break-word', 
                                    overflowWrap: 'anywhere'
                                  }}
                                  dir="auto"
                                />
                              ) : message.body_preview ? (
                                // body_preview is sanitized HTML, so always render it as HTML
                                <div
                                  dangerouslySetInnerHTML={{ __html: message.body_preview }}
                                  className="prose prose-sm max-w-none text-gray-700 break-words email-content"
                                  style={{ 
                                    wordBreak: 'break-word', 
                                    overflowWrap: 'anywhere'
                                  }}
                                  dir="auto"
                                />
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
                                      
                                      return (
                                        <div
                                          key={attachmentKey}
                                          className="flex items-center gap-2 text-xs font-medium text-blue-600 w-full"
                                        >
                                          <DocumentTextIcon className="w-4 h-4 flex-shrink-0" />
                                          <span className="truncate flex-1">
                                            {attachmentName}
                                          </span>
                                          {attachment.size && (
                                            <span className="text-xs text-gray-500 flex-shrink-0">
                                              ({(attachment.size / 1024).toFixed(1)} KB)
                                            </span>
                                          )}
                                        </div>
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

            {/* Compose Email Section */}
            <div className="border-t border-gray-200 px-4 md:px-6 py-4 bg-white">
              <button
                onClick={() => {
                  setShowCompose(true);
                  const initialRecipients = normaliseAddressList(client?.email);
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
                }}
                className="w-full btn btn-primary h-12 min-h-0"
              >
                <PaperAirplaneIcon className="w-4 h-4 mr-2" />
                Compose Message
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {showCompose && createPortal(
        <div className="fixed inset-0 z-[10001] flex">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowCompose(false)} />
          <div className="relative w-full h-full bg-white shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-xl font-semibold">Compose Email</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCompose(false)}>
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
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

              <div className="space-y-3" ref={templateDropdownRef}>
                <div className="flex flex-wrap items-center gap-3">
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
                              <div className="font-medium">{template.name}</div>
                              {(template.placementName || template.languageName) && (
                                <div className="text-xs text-gray-500 mt-1">
                                  {template.placementName && <span>{template.placementName}</span>}
                                  {template.placementName && template.languageName && <span> • </span>}
                                  {template.languageName && <span>{template.languageName}</span>}
                                </div>
                              )}
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
                      setComposeBody('');
                      setComposeBodyIsRTL(false);
                      if (client) {
                        const defaultSubject = `[${client.lead_number}] - ${client.name} - ${client.topic || ''}`;
                        setComposeSubject(defaultSubject);
                      }
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                
                {/* Language and Placement Filters */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative w-full sm:w-48">
                    <select
                      className="select select-bordered w-full text-sm"
                      value={templateLanguageFilter || ''}
                      onChange={(e) => {
                        setTemplateLanguageFilter(e.target.value || null);
                        if (!templateDropdownOpen) {
                          setTemplateDropdownOpen(true);
                        }
                      }}
                    >
                      <option value="">All Languages</option>
                      {availableLanguages.map(lang => (
                        <option key={lang.id} value={lang.id}>
                          {lang.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="relative w-full sm:w-48">
                    <select
                      className="select select-bordered w-full text-sm"
                      value={templatePlacementFilter || ''}
                      onChange={(e) => {
                        setTemplatePlacementFilter(e.target.value ? Number(e.target.value) : null);
                        if (!templateDropdownOpen) {
                          setTemplateDropdownOpen(true);
                        }
                      }}
                    >
                      <option value="">All Placements</option>
                      {availablePlacements.map(placement => (
                        <option key={placement.id} value={placement.id}>
                          {placement.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {(templateLanguageFilter || templatePlacementFilter !== null) && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setTemplateLanguageFilter(null);
                        setTemplatePlacementFilter(null);
                      }}
                    >
                      Clear Filters
                    </button>
                  )}
                </div>
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

              <textarea
                placeholder="Type your message..."
                value={composeBody}
                onChange={(e) => {
                  setComposeBody(e.target.value);
                  // Dynamically detect Hebrew as user types
                  setComposeBodyIsRTL(containsHebrew(e.target.value));
                }}
                dir={composeBodyIsRTL ? 'rtl' : 'ltr'}
                style={{
                  textAlign: composeBodyIsRTL ? 'right' : 'left',
                  direction: composeBodyIsRTL ? 'rtl' : 'ltr'
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-y min-h-[320px]"
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
            <div className="px-6 py-4 border-t border-gray-200 flex flex-col sm:flex-row gap-3 justify-between">
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
                  disabled={sending || !composeBody.trim()}
                  className="btn btn-primary btn-sm"
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
    </>
  );
};

export default SchedulerEmailThreadModal;