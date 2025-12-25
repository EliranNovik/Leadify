import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { XMarkIcon, MagnifyingGlassIcon, PaperAirplaneIcon, PaperClipIcon, ChevronDownIcon, PlusIcon, DocumentTextIcon, UserIcon, SparklesIcon, LinkIcon, UserPlusIcon, CheckIcon } from '@heroicons/react/24/outline';
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
import { generateSearchVariants } from '../lib/transliteration';
import { replaceEmailTemplateParams } from '../lib/emailTemplateParams';

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

// Helper function to detect Hebrew/RTL text
const containsRTLText = (text?: string | null): boolean => {
  if (!text) return false;
  // Remove HTML tags to check only text content
  const textOnly = text.replace(/<[^>]*>/g, '');
  return /[\u0590-\u05FF]/.test(textOnly);
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
  
  // Preserve line breaks: convert \n to <br>
  result = result
    .replace(/\r\n/g, '\n')  // Normalize line endings
    .replace(/\r/g, '\n')    // Handle old Mac line endings
    .replace(/\n/g, '<br>'); // Convert to HTML line breaks
  
  // Use dir="auto" to let the browser automatically detect text direction
  // This handles mixed content (English + Hebrew) correctly
  result = `<div dir="auto" style="font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif;">${result}</div>`;
  
  return result;
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

const sanitizeEmailHtml = (html: string): string => {
  // First filter out problematic images
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

const replaceTemplateTokens = async (
  content: string, 
  contact: Contact | null,
  options?: {
    meetingDate?: string;
    meetingTime?: string;
    meetingLocation?: string;
    meetingLink?: string;
  }
) => {
  if (!content) return '';
  
  // Build context for template replacement
  const isLegacyLead = contact?.lead_type === 'legacy' || 
                       (contact?.id && contact.id.toString().startsWith('legacy_'));
  
  // Determine client ID and legacy ID
  let clientId: string | null = null;
  let legacyId: number | null = null;
  
  if (isLegacyLead) {
    if (contact?.lead_number) {
      const numeric = parseInt(contact.lead_number.replace(/[^0-9]/g, ''), 10);
      legacyId = isNaN(numeric) ? null : numeric;
      clientId = legacyId?.toString() || null;
    } else if (contact?.id) {
      const numeric = parseInt(contact.id.toString().replace(/[^0-9]/g, ''), 10);
      legacyId = isNaN(numeric) ? null : numeric;
      clientId = legacyId?.toString() || null;
    }
  } else {
    clientId = contact?.client_uuid || contact?.id?.toString() || null;
  }
  
  const context = {
    clientId,
    legacyId,
    clientName: contact?.name || null,
    contactName: contact?.name || null,
    leadNumber: contact?.lead_number || null,
    topic: contact?.topic || null,
    leadType: contact?.lead_type || null,
    meetingDate: options?.meetingDate || null,
    meetingTime: options?.meetingTime || null,
    meetingLocation: options?.meetingLocation || null,
    meetingLink: options?.meetingLink || null,
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
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [emailThread, setEmailThread] = useState<EmailMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [newMessageIsRTL, setNewMessageIsRTL] = useState(false);
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
  
  // Template filters
  const [templateLanguageFilter, setTemplateLanguageFilter] = useState<string | null>(null);
  const [templatePlacementFilter, setTemplatePlacementFilter] = useState<number | null>(null);
  const [availableLanguages, setAvailableLanguages] = useState<Array<{ id: string; name: string }>>([]);
  const [availablePlacements, setAvailablePlacements] = useState<Array<{ id: number; name: string }>>([]);
  
  // AI suggestions state
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [showAISuggestions, setShowAISuggestions] = useState(false);
  
  // Lead contacts modal state (for adding contacts to recipients)
  const [showContactsModal, setShowContactsModal] = useState(false);
  const [modalLeadContacts, setModalLeadContacts] = useState<ContactInfo[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<number>>(new Set());
  const [loadingContacts, setLoadingContacts] = useState(false);
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  // New Email Modal state
  const [isNewEmailModalOpen, setIsNewEmailModalOpen] = useState(false);
  const [newEmailSearchTerm, setNewEmailSearchTerm] = useState('');
  const [newEmailSearchResults, setNewEmailSearchResults] = useState<CombinedLead[]>([]);
  const [isNewEmailSearching, setIsNewEmailSearching] = useState(false);
  const newEmailSearchTimeoutRef = useRef<NodeJS.Timeout>();
  const masterSearchResultsRef = useRef<CombinedLead[]>([]);
  const previousSearchQueryRef = useRef<string>('');
  const previousRawSearchValueRef = useRef<string>('');
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
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isManuallySettingContactIdRef = useRef(false);
  const currentLoadingContactIdRef = useRef<string | number | null>(null);
  const isFetchingRef = useRef(false);
  const isSettingUpContactRef = useRef(false);
  const [setupComplete, setSetupComplete] = useState(false);
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
  const [isSuperuser, setIsSuperuser] = useState<boolean | null>(null);
  const [showMyContactsOnly, setShowMyContactsOnly] = useState<boolean>(true);

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
          
          // Fetch database user ID from users table for read_by field
          if (authUser.email && authUser.email.includes('@')) {
            // Try by email first
            const { data: userRow, error } = await supabase
              .from('users')
              .select('id, full_name, email, employee_id, is_superuser')
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
              // Set superuser status
              const superuserStatus = userRow.is_superuser === true;
              setIsSuperuser(superuserStatus);
              // For non-superusers, always show only their contacts (no tabs)
              if (!superuserStatus) {
                setShowMyContactsOnly(true);
              }
            } else {
              // Try by auth_id if email lookup fails
              const { data: userByAuthId, error: authIdError } = await supabase
                .from('users')
                .select('id, full_name, email, employee_id, is_superuser')
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
                // Set superuser status
                const superuserStatus = userByAuthId.is_superuser === true;
                setIsSuperuser(superuserStatus);
                // For non-superusers, always show only their contacts (no tabs)
                if (!superuserStatus) {
                  setShowMyContactsOnly(true);
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

  // Fetch employees for autocomplete
  useEffect(() => {
    const fetchEmployees = async () => {
      try {
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
          console.error('Error fetching employees:', employeesResult.error || usersResult.error);
          return;
        }

        // Create employee_id to email mapping
        const employeeIdToEmail = new Map<number, string>();
        usersResult.data?.forEach((user: any) => {
          if (user.employee_id && user.email) {
            employeeIdToEmail.set(user.employee_id, user.email.toLowerCase());
          }
        });

        // Build employee list with email and name
        const employeeList: Array<{ email: string; name: string }> = [];
        employeesResult.data?.forEach((emp: any) => {
          if (!emp.display_name) return;
          
          // Method 1: Use email from users table
          const emailFromUsers = employeeIdToEmail.get(emp.id);
          if (emailFromUsers) {
            employeeList.push({ email: emailFromUsers, name: emp.display_name });
          }
          
          // Method 2: Also add pattern email
          const patternEmail = `${emp.display_name.toLowerCase().replace(/\s+/g, '.')}@lawoffice.org.il`;
          // Only add if it's different from the actual email
          if (!emailFromUsers || emailFromUsers !== patternEmail) {
            employeeList.push({ email: patternEmail, name: emp.display_name });
          }
        });

        // Remove duplicates based on email
        const uniqueEmployees = Array.from(
          new Map(employeeList.map(emp => [emp.email, emp])).values()
        );
        
        setEmployees(uniqueEmployees);
      } catch (error) {
        console.error('Error fetching employees:', error);
      }
    };

    if (isOpen) {
      fetchEmployees();
    }
  }, [isOpen]);


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
        setShowToSuggestions(false);
        setToSuggestions([]);
      } else {
        const updated = [...ccRecipients];
        pushRecipient(updated, value);
        setCcRecipients(updated);
        setCcInput('');
        setShowCcSuggestions(false);
        setCcSuggestions([]);
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

  const handleRecipientKeyDown = (type: 'to' | 'cc') => (event: React.KeyboardEvent<HTMLInputElement>) => {
    const value = type === 'to' ? toInput : ccInput;
    const suggestions = type === 'to' ? toSuggestions : ccSuggestions;
    const showSuggestions = type === 'to' ? showToSuggestions : showCcSuggestions;
    
    if (event.key === 'ArrowDown' && showSuggestions && suggestions.length > 0) {
      event.preventDefault();
      // Select first suggestion
      const firstSuggestion = suggestions[0];
      if (firstSuggestion) {
        addRecipient(type, firstSuggestion.email);
      }
      return;
    }
    
    if (event.key === 'Escape') {
      if (type === 'to') {
        setShowToSuggestions(false);
      } else {
        setShowCcSuggestions(false);
      }
      return;
    }
    
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
    const suggestions = type === 'to' ? toSuggestions : ccSuggestions;
    const showSuggestions = type === 'to' ? showToSuggestions : showCcSuggestions;
    const suggestionsRef = type === 'to' ? toSuggestionsRef : ccSuggestionsRef;

    return (
      <div className="relative">
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
              const newValue = event.target.value;
              setValue(newValue);
              if (recipientError) {
                setRecipientError(null);
              }
              
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
              if (value.trim().length > 0) {
                const results = searchEmployees(value.trim());
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
                  addRecipient(type, suggestion.email);
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

  const handleTemplateSelect = async (template: EmailTemplate) => {
    setSelectedTemplateId(template.id);
    
    // Replace template tokens (async to fetch meeting data if needed)
    const templatedBody = await replaceTemplateTokens(template.content, selectedContact);
    const finalBody = templatedBody || template.content || template.rawContent;
    
    if (template.subject && template.subject.trim()) {
      const templatedSubject = await replaceTemplateTokens(template.subject, selectedContact);
      setSubject(templatedSubject);
    }
    
    setNewMessage(finalBody);
    
    // Check if template is Hebrew based on language or content
    const isHebrew = isHebrewLanguage(template.languageId, template.languageName) || containsHebrew(finalBody);
    setNewMessageIsRTL(isHebrew);
    
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
      // If "My Contacts" is enabled but user info isn't loaded yet, wait for it
      if (showMyContactsOnly && !currentUserEmployeeId && !currentUserFullName) {
        console.log('⏳ Waiting for user info before fetching "My Contacts"');
        return;
      }
      
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

        // Fetch new leads with email conversations (with role filter if enabled)
        const newLeadIds = Array.from(uniqueClientIds);
        let newLeadsData: any[] = [];
        
        if (newLeadIds.length > 0) {
          let query = supabase
            .from('leads')
            .select('id, name, email, lead_number, phone, mobile, created_at, topic, closer, scheduler, handler, manager, helper, expert, closer_id, meeting_scheduler_id, meeting_manager_id, meeting_lawyer_id, expert_id, case_handler_id');
          
          // Apply role filter if "My Contacts" is enabled AND we have user info
          if (showMyContactsOnly && (currentUserEmployeeId || currentUserFullName)) {
            // Build filter conditions for new leads
            const newLeadConditions: string[] = [];
            
            // Text fields (saved as display names): closer, scheduler, handler
            if (currentUserFullName) {
              const fullNameLower = currentUserFullName.trim().toLowerCase();
              newLeadConditions.push(`closer.ilike.%${fullNameLower}%`);
              newLeadConditions.push(`scheduler.ilike.%${fullNameLower}%`);
              newLeadConditions.push(`handler.ilike.%${fullNameLower}%`);
            }
            
            // Numeric fields (saved as employee IDs): manager, helper, expert, case_handler_id
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
          
          // Always filter by lead IDs that have email conversations
          query = query.in('id', newLeadIds);

          const { data: leadsData, error: leadsError } = await query;

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

        // Fetch legacy leads with email conversations (with role filter if enabled)
        const legacyLeadIds = Array.from(uniqueLegacyIds).filter(id => !isNaN(id));
        let legacyLeadsData: any[] = [];
        
        if (legacyLeadIds.length > 0) {
          let query = supabase
            .from('leads_lead')
            .select('id, name, email, phone, mobile, cdate, category_id, closer_id, meeting_scheduler_id, meeting_manager_id, meeting_lawyer_id, expert_id, case_handler_id');
          
          // Apply role filter if "My Contacts" is enabled AND we have user info
          if (showMyContactsOnly && currentUserEmployeeId) {
            // Build filter conditions for legacy leads (all numeric IDs)
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
          
          // Always filter by lead IDs that have email conversations
          query = query.in('id', legacyLeadIds);

          const { data: legacyLeads, error: legacyLeadsError } = await query;

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

        // Combine all contacts (already filtered at database level)
        let allContacts: Contact[] = [...newLeadsData, ...legacyLeadsData];
        
        console.log(`📧 Fetched ${allContacts.length} contacts with email conversations (${newLeadsData.length} new + ${legacyLeadsData.length} legacy)`);
        
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

  // Handle search in New Email Modal
  useEffect(() => {
    if (newEmailSearchTimeoutRef.current) {
      clearTimeout(newEmailSearchTimeoutRef.current);
    }

    const trimmedQuery = newEmailSearchTerm.trim();
    const previousQuery = previousSearchQueryRef.current.trim();

    if (!trimmedQuery) {
      setNewEmailSearchResults([]);
      setIsNewEmailSearching(false);
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
        setNewEmailSearchResults(filtered);
        setIsNewEmailSearching(false);
        previousSearchQueryRef.current = trimmedQuery;
        previousRawSearchValueRef.current = newEmailSearchTerm;
        return;
      }
    }

    // Otherwise, perform new search (query got shorter or changed significantly)
    setIsNewEmailSearching(true);

    newEmailSearchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchLeads(trimmedQuery);
        masterSearchResultsRef.current = results;
        setNewEmailSearchResults(results);
        previousSearchQueryRef.current = trimmedQuery;
        previousRawSearchValueRef.current = newEmailSearchTerm;
      } catch (error) {
        console.error('Error searching leads:', error);
        setNewEmailSearchResults([]);
        masterSearchResultsRef.current = [];
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
    masterSearchResultsRef.current = [];
    previousSearchQueryRef.current = '';
    previousRawSearchValueRef.current = '';
    
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
    
    // For non-superusers, only count unread messages from "My Contacts" (contacts that match user roles)
    // The contacts array is already filtered at the database level when showMyContactsOnly is true
    // For superusers, count all unread messages from all contacts
    let contactsToCount = contacts;
    
    // If user is not a superuser, ensure we only count contacts from "My Contacts"
    // (This should already be filtered, but we verify for safety)
    if (isSuperuser === false && showMyContactsOnly) {
      // Contacts are already filtered, so we can use them directly
      contactsToCount = contacts;
    } else if (isSuperuser === true) {
      // Superusers see all contacts, so count all
      contactsToCount = contacts;
    }
    
    const totalUnread = contactsToCount.reduce((sum, contact) => sum + (contact.unread_count || 0), 0);
    window.dispatchEvent(new CustomEvent('email:unread-count', { detail: { count: totalUnread } }));
  }, [contacts, isSuperuser, showMyContactsOnly]);

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

            // Filter problematic images before processing
            const filteredContent = filterProblematicImages(rawContent);
            
            // Extract body and ensure line breaks are preserved
            let cleanedHtml = sanitizeEmailHtml(extractHtmlBody(filteredContent));
            
            // Ensure line breaks are preserved (convert \n to <br> if needed)
            if (cleanedHtml && !cleanedHtml.includes('<br>')) {
              cleanedHtml = cleanedHtml.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '<br>');
            }
            
            // Apply auto text direction (only if not already wrapped)
            if (cleanedHtml && !cleanedHtml.includes('dir=')) {
              cleanedHtml = `<div dir="auto" style="font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif;">${cleanedHtml}</div>`;
              cleanedHtml = sanitizeEmailHtml(cleanedHtml);
            }
            
            const previewHtml = cleanedHtml && cleanedHtml.trim() ? cleanedHtml : convertBodyToHtml(filteredContent);

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
      
      // Build a comprehensive query that matches emails in multiple ways
      // This ensures we catch all emails regardless of how they were saved
      let emailQuery = supabase
        .from('emails')
        .select('id, message_id, sender_name, sender_email, recipient_list, subject, body_html, body_preview, sent_at, direction, attachments, client_id, legacy_id, contact_id, is_read')
        .order('sent_at', { ascending: true });

      // Build query conditions that match emails by:
      // 1. client_id/legacy_id (main identifier)
      // 2. contact_id (if available)
      // 3. email address (fallback for emails without contact_id)
      
      const contactEmail = sanitizeEmailForFilter(normalizeEmailForFilter(selectedContact.email));
      const queryConditions: string[] = [];
      
      // Always include client_id/legacy_id match
      if (legacyId !== null) {
        queryConditions.push(`legacy_id.eq.${legacyId}`);
        console.log(`📧 Querying emails with legacy_id=${legacyId}`);
      }
      if (clientUuid) {
        queryConditions.push(`client_id.eq.${clientUuid}`);
        console.log(`📧 Querying emails with client_id=${clientUuid}`);
      }
      
      // Also match by contact_id if we have it
      if (contactId) {
        queryConditions.push(`contact_id.eq.${contactId}`);
        console.log(`📧 Querying emails with contact_id=${contactId}`);
      }
      
      // Also match by email address in recipient_list or sender_email
      // This catches emails that might not have contact_id set yet
      if (contactEmail) {
        queryConditions.push(`recipient_list.ilike.%${contactEmail}%`);
        queryConditions.push(`sender_email.ilike.${contactEmail}`);
        console.log(`📧 Querying emails with email=${contactEmail}`);
      }
      
      if (queryConditions.length === 0) {
        console.warn('📧 No valid identifiers for email fetch', {
          selectedContact,
          clientUuid,
          legacyId,
          contactId,
          contactEmail
        });
        setEmailThread([]);
        setIsLoading(false);
        return;
      }
      
      // Use OR to match any of these conditions
      // Then we'll filter in memory to ensure proper matching
      emailQuery = emailQuery.or(queryConditions.join(','));

    let { data, error } = await emailQuery;
    
    if (error) {
      console.error('📧 Error querying emails:', error);
      throw error;
    }
    
    // Filter results in memory to ensure proper matching
    // Include emails that match by:
    // 1. client_id/legacy_id match (required)
    // 2. AND (contact_id match OR email address match OR no contact_id)
    if (!error && data && data.length > 0) {
      const normalizedContactEmail = contactEmail ? contactEmail.toLowerCase() : null;
      const normalizedSenderEmail = selectedContact.email ? normalizeEmailForFilter(selectedContact.email).toLowerCase() : null;
      
      data = data.filter((email: any) => {
        // First, must match by client_id or legacy_id
        const clientIdMatch = clientUuid && email.client_id === clientUuid;
        const legacyIdMatch = legacyId !== null && email.legacy_id === legacyId;
        
        if (!clientIdMatch && !legacyIdMatch) {
          return false; // Must match main identifier
        }
        
        // If we have a contactId, prefer emails with matching contact_id
        if (contactId && email.contact_id === contactId) {
          return true;
        }
        
        // If email has no contact_id, include it if email address matches
        if (!email.contact_id || email.contact_id === null) {
          if (normalizedContactEmail) {
            const recipientMatch = email.recipient_list && 
                                  email.recipient_list.toLowerCase().includes(normalizedContactEmail);
            const senderMatch = email.sender_email && 
                               normalizeEmailForFilter(email.sender_email).toLowerCase() === normalizedContactEmail;
            if (recipientMatch || senderMatch) {
              return true;
            }
          }
          // If no contact_id and no email match, still include for main contact view
          // This ensures emails sent without contact_id still appear
          return true;
        }
        
        // If email has a different contact_id, only include if it matches the main contact email
        if (normalizedContactEmail) {
          const recipientMatch = email.recipient_list && 
                                email.recipient_list.toLowerCase().includes(normalizedContactEmail);
          const senderMatch = email.sender_email && 
                             normalizeEmailForFilter(email.sender_email).toLowerCase() === normalizedContactEmail;
          return recipientMatch || senderMatch;
        }
        
        return false;
      });
      
      console.log(`📧 Filtered to ${data.length} emails after in-memory filtering`);
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
      
      // Build employee email-to-name mapping once for all emails
      const employeeEmailMap = await buildEmployeeEmailToNameMap();
      
      const formattedThread: EmailMessage[] = (data || []).map((row: any) => {
        let rawHtml = typeof row.body_html === 'string' ? row.body_html : null;
        let rawPreview = typeof row.body_preview === 'string' ? row.body_preview : null;
        
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
        
        const cleanedPreview = rawPreview ? extractHtmlBody(rawPreview) : null;

        // Ensure line breaks are preserved in cleaned HTML
        if (cleanedHtml) {
          // Convert newlines to <br> if not already present
          if (!cleanedHtml.includes('<br>') && !cleanedHtml.includes('<br/>') && !cleanedHtml.includes('<br />')) {
            cleanedHtml = cleanedHtml.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '<br>');
          }
          
          // Apply auto text direction (only if not already wrapped)
          if (!cleanedHtml.includes('dir=')) {
            cleanedHtml = `<div dir="auto" style="font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif;">${cleanedHtml}</div>`;
          }
        }

        const fallbackText = cleanedPreview || cleanedHtml || row.subject || '';
        let resolvedHtml = cleanedHtml;
        if (!resolvedHtml && fallbackText) {
          resolvedHtml = convertBodyToHtml(fallbackText);
        }
        
        // Sanitize but preserve Outlook's direction and style attributes
        const sanitizedHtml = resolvedHtml ? sanitizeEmailHtml(resolvedHtml) : null;
        
        // For preview, ensure line breaks and RTL
        let sanitizedPreview = cleanedPreview ? sanitizeEmailHtml(cleanedPreview) : null;
        if (!sanitizedPreview) {
          sanitizedPreview = sanitizedHtml;
        }
        if (!sanitizedPreview && fallbackText) {
          sanitizedPreview = sanitizeEmailHtml(convertBodyToHtml(fallbackText));
        }

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

        // Determine if email is from team/user based on sender email domain
        // Emails from @lawoffice.org.il are ALWAYS team/user, never client
        const senderEmail = row.sender_email || '';
        const isFromOffice = isOfficeEmail(senderEmail);
        
        // Override direction field: if sender is from office domain, it's always outgoing (team/user)
        let correctedDirection = row.direction === 'outgoing' ? 'outgoing' : 'incoming';
        if (isFromOffice) {
          correctedDirection = 'outgoing';
        }
        
        // Get sender display name - use employee display_name for office emails
        let senderDisplayName = row.sender_name || 'Team';
        if (isFromOffice) {
          // For team/user emails: use employee display_name from cache if available
          senderDisplayName = employeeEmailMap.get(senderEmail.toLowerCase()) || row.sender_name || 'Team';
        }

        return {
          id: row.message_id || row.id?.toString?.() || `email_${row.id}`,
          subject: row.subject || 'No Subject',
          body_html: sanitizedHtml,
          body_preview: sanitizedPreview ?? null,
          sender_name: senderDisplayName,
          sender_email: senderEmail,
          recipient_list: row.recipient_list || '',
          sent_at: row.sent_at,
          direction: correctedDirection,
          attachments: parsedAttachments,
          // Store employee display_name if from office domain for use in display
          sender_display_name: isFromOffice ? senderDisplayName : undefined
        } as EmailMessage & { sender_display_name?: string };
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
      setSetupComplete(false);
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
    console.log(`🔄 Triggering fetch for key: ${fetchKey} (contact: ${selectedContact.name}, contactId: ${selectedContactId || 'null'})`);
    
    // Fetch emails when selectedContact, selectedContactId, or setupComplete changes
    fetchEmailThread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContact?.id, selectedContactId, setupComplete]); // Added setupComplete to trigger when setup is done

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

  // Handle image loading errors in email content (CORS-blocked images from external domains)
  useEffect(() => {
    if (!isOpen || emailThread.length === 0) return;

    // Small delay to ensure DOM is updated after emailThread changes
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
  }, [isOpen, emailThread]);

  const handleContactSelect = async (contact: Contact) => {
    console.log(`👤 Selecting contact: ${contact.name} (ID: ${contact.id})`);
    
    // Set flag to prevent fetches while we're setting up the contact
    isSettingUpContactRef.current = true;
    setSetupComplete(false); // Reset setup completion state
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
    setNewMessageIsRTL(false);
    
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
    setTemplateLanguageFilter(null);
    setTemplatePlacementFilter(null);
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
      
      // Clear all fetching flags and keys to allow fresh fetch BEFORE clearing setup flag
      isFetchingRef.current = false;
      lastFetchedKeyRef.current = null;
      
      // Clear setup flag LAST - this will allow the useEffect to trigger
      isSettingUpContactRef.current = false;
      clearTimeout(safetyTimeout); // Make sure to clear safety timeout
      
      // Set setup complete state to trigger useEffect
      setSetupComplete(true);
      
      // The useEffect will automatically trigger now that:
      // 1. isSettingUpContactRef.current is false
      // 2. selectedContact is set
      // 3. selectedContactId is set (or null)
      // 4. All fetching flags are cleared
      // 5. setupComplete state changed (triggers re-render)
      console.log(`✅ Setup complete, useEffect should trigger fetch automatically`);
    } catch (error) {
      console.error('❌ Error fetching contacts for selected contact:', error);
      clearTimeout(safetyTimeout); // Clear safety timeout on error
      // On error, clear everything and allow fetch with null contactId
      setSelectedContactId(null);
      
      // Clear all fetching flags and keys BEFORE clearing setup flag
      isFetchingRef.current = false;
      lastFetchedKeyRef.current = null;
      
      // CRITICAL: Always clear the setup flag even on error so we can still try to fetch
      isSettingUpContactRef.current = false;
      setSetupComplete(true); // Trigger useEffect even on error
      console.log(`⚠️ Setup flag cleared after error, useEffect will attempt to fetch emails`);
      
      // The useEffect will automatically trigger now that the setup flag is cleared
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
    setNewMessageIsRTL(false);
    setAttachments([]);
    const initialRecipients = normaliseAddressList(contact.email);
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

  // Handle opening contacts modal
  const handleOpenContactsModal = async () => {
    if (!selectedContact) return;
    
    setShowContactsModal(true);
    setLoadingContacts(true);
    setSelectedContactIds(new Set());
    
    try {
      const isLegacyLead = selectedContact.lead_type === 'legacy' || selectedContact.id.toString().startsWith('legacy_');
      const leadId = isLegacyLead 
        ? (typeof selectedContact.id === 'string' ? selectedContact.id.replace('legacy_', '') : String(selectedContact.id))
        : (selectedContact.client_uuid || selectedContact.id);
      
      const contacts = await fetchLeadContacts(leadId, isLegacyLead);
      
      // Filter only contacts with valid emails
      const contactsWithEmail = contacts.filter(c => c.email && c.email.trim());
      setModalLeadContacts(contactsWithEmail);
    } catch (error) {
      console.error('Error fetching lead contacts:', error);
      toast.error('Failed to load contacts');
      setModalLeadContacts([]);
    } finally {
      setLoadingContacts(false);
    }
  };
  
  // Toggle contact selection
  const toggleContactSelection = (contactId: number) => {
    setSelectedContactIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(contactId)) {
        newSet.delete(contactId);
      } else {
        newSet.add(contactId);
      }
      return newSet;
    });
  };
  
  // Add selected contacts to recipients
  const handleAddSelectedContacts = () => {
    const selectedContacts = modalLeadContacts.filter(c => selectedContactIds.has(c.id));
    const newRecipients = selectedContacts
      .map(c => c.email!)
      .filter(email => email && !toRecipients.includes(email));
    
    if (newRecipients.length > 0) {
      setToRecipients(prev => [...prev, ...newRecipients]);
      toast.success(`Added ${newRecipients.length} contact(s) to recipients`);
    }
    
    setShowContactsModal(false);
    setSelectedContactIds(new Set());
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
    setNewMessageIsRTL(false);
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
        
        // Determine client_id - use the same logic as fetchEmailThread to ensure consistency
        const clientUuidForSend = selectedContact.client_uuid
          ?? selectedContact.idstring
          ?? (typeof selectedContact.id === 'string' && selectedContact.id.includes('-') ? selectedContact.id : null)
          ?? (!isLegacyLead ? selectedContact.id : null);
        
        console.log('📧 Sending email with context:', {
          clientId: !isLegacyLead ? clientUuidForSend : null,
          legacyLeadId: isLegacyLead ? legacyId : null,
          contactId: emailContactId,
          contactEmail: selectedContact.email,
          leadType: selectedContact.lead_type || (isLegacyLead ? 'legacy' : 'new'),
        });
        
        await sendEmailViaBackend({
          userId,
          subject: derivedSubject,
          bodyHtml: emailContentWithSignature,
          to: finalToSnapshot,
          cc: finalCcSnapshot,
          attachments: backendAttachments.length > 0 ? backendAttachments : undefined,
          context: {
            clientId: !isLegacyLead ? clientUuidForSend : null,
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
        
        console.log('📧 Email sent successfully, waiting before refresh...');

        // Update contact's last_message_time optimistically in contacts list
        const now = new Date().toISOString();
        setContacts(prev => prev.map(contact => {
          if (contact.id === selectedContact.id) {
            return { ...contact, last_message_time: now };
          }
          return contact;
        }));

        // Force refresh the thread by clearing fetch flags
        isFetchingRef.current = false;
        lastFetchedKeyRef.current = null;
        
        // Add a delay to ensure the email is saved in the database
        // Increase delay to 2 seconds to allow backend processing
        console.log('📧 Waiting 2 seconds for email to be saved...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('📧 Refreshing email thread...');
        // Refresh the thread in the background to replace any optimistic
        // messages with the final stored versions.
        await fetchEmailThread();
        console.log('📧 Email thread refresh completed');
        
        // Also refresh contacts list to ensure it's sorted correctly
        // This will update last_message_time from the database
        if (isOpen) {
          // Re-fetch contacts to update last_message_time and sort order
          const fetchContactsAsync = async () => {
            try {
              // Fetch unique client_id and legacy_id from emails table
              const { data: emailsData } = await supabase
                .from('emails')
                .select('client_id, legacy_id')
                .or('client_id.not.is.null,legacy_id.not.is.null');

              if (!emailsData) return;

              const uniqueClientIds = new Set<string>();
              const uniqueLegacyIds = new Set<number>();
              
              emailsData.forEach((email: any) => {
                if (email.client_id) uniqueClientIds.add(String(email.client_id));
                if (email.legacy_id) uniqueLegacyIds.add(Number(email.legacy_id));
              });

              // Update the current selected contact's last_message_time
              setContacts(prev => {
                const updated = prev.map(contact => {
                  if (contact.id === selectedContact.id) {
                    // Get the latest email for this contact
                    const isLegacyContact = contact.lead_type === 'legacy';
                    const legacyId = isLegacyContact 
                      ? parseInt(String(contact.lead_number || contact.id).replace(/[^0-9]/g, ''), 10)
                      : null;
                    
                    // We'll update this properly in a moment, for now just return the contact
                    return contact;
                  }
                  return contact;
                });
                
                // Sort by last_message_time
                return updated.sort((a, b) => {
                  if (a.last_message_time && b.last_message_time) {
                    return new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime();
                  }
                  if (a.last_message_time) return -1;
                  if (b.last_message_time) return 1;
                  return a.name.localeCompare(b.name);
                });
              });
            } catch (error) {
              console.error('Error refreshing contacts list:', error);
            }
          };
          
          // Refresh contacts list in background
          fetchContactsAsync();
        }
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

  // Check if text contains both Hebrew and English/Latin characters (mixed content)
  const containsMixedContent = (text?: string | null): boolean => {
    if (!text) return false;
    const visibleText = extractVisibleText(text);
    const hasHebrew = /[\u0590-\u05FF]/.test(visibleText);
    const hasEnglish = /[a-zA-Z]/.test(visibleText);
    return hasHebrew && hasEnglish;
  };

  // Count Hebrew vs English characters to determine dominant language
  const getDominantLanguage = (text?: string | null): 'hebrew' | 'english' => {
    if (!text) return 'english';
    const visibleText = extractVisibleText(text);
    
    // Count Hebrew characters
    const hebrewMatches = visibleText.match(/[\u0590-\u05FF]/g);
    const hebrewCount = hebrewMatches ? hebrewMatches.length : 0;
    
    // Count English/Latin characters (letters only, not spaces/punctuation)
    const englishMatches = visibleText.match(/[a-zA-Z]/g);
    const englishCount = englishMatches ? englishMatches.length : 0;
    
    // If more Hebrew characters, return 'hebrew', otherwise 'english'
    return hebrewCount > englishCount ? 'hebrew' : 'english';
  };

  // Get direction for plain text (no HTML)
  // Based on dominant language: more Hebrew = RTL, more English = LTR
  const getTextDirection = (text?: string | null): 'rtl' | 'ltr' => {
    if (!text) return 'ltr';
    const dominant = getDominantLanguage(text);
    return dominant === 'hebrew' ? 'rtl' : 'ltr';
  };

  // Get alignment for text - based on dominant language
  const getTextAlignment = (text?: string | null): 'right' | 'left' => {
    if (!text) return 'left';
    const dominant = getDominantLanguage(text);
    return dominant === 'hebrew' ? 'right' : 'left';
  };

  const getMessageDirection = (message: EmailMessage): 'rtl' | 'ltr' => {
    // Combine all text content to determine overall direction
    const allText = [
      message.subject || '',
      message.body_html ? extractVisibleText(message.body_html) : '',
      message.body_preview ? extractVisibleText(message.body_preview) : ''
    ].join(' ');
    
    // Determine dominant language based on character count
    const dominant = getDominantLanguage(allText);
    return dominant === 'hebrew' ? 'rtl' : 'ltr';
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
      <div className="h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className={`flex-none flex flex-col border-b border-gray-200`}>
          <div className="flex items-center justify-between p-4 md:p-6">
            <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
              <h2 className="text-lg md:text-2xl font-bold text-gray-900 flex-shrink-0">Email Thread</h2>
              {selectedContact && !isMobile && (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span 
                    className="text-gray-600"
                    dir="auto"
                  >
                    {selectedContact.name} ({selectedContact.lead_number})
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {selectedContact && (
                <button
                  onClick={() => {
                    // Get the correct lead identifier based on lead type
                    const isLegacy = selectedContact.lead_type === 'legacy' || selectedContact.id?.toString().startsWith('legacy_');
                    
                    let leadIdentifier: string | null = null;
                    
                    if (isLegacy) {
                      // For legacy leads, extract the numeric ID
                      const contactId = selectedContact.id?.toString();
                      if (contactId) {
                        if (contactId.startsWith('legacy_')) {
                          // Extract numeric ID from "legacy_<id>"
                          leadIdentifier = contactId.replace('legacy_', '');
                        } else if (/^\d+$/.test(contactId)) {
                          // Already numeric
                          leadIdentifier = contactId;
                        }
                      }
                    } else {
                      // For new leads, use lead_number
                      leadIdentifier = selectedContact.lead_number || selectedContact.client_uuid || null;
                    }
                    
                    if (!leadIdentifier) {
                      console.error('Cannot navigate: No valid lead identifier found', selectedContact);
                      return;
                    }
                    
                    // Encode the identifier to handle sub-leads with '/' characters
                    const encodedIdentifier = encodeURIComponent(leadIdentifier);
                    console.log('Navigating to client:', leadIdentifier, 'encoded:', encodedIdentifier);
                    
                    // Close email modal first, then navigate
                    onClose();
                    
                    // Small delay to ensure modal closes before navigation
                    setTimeout(() => {
                      navigate(`/clients/${encodedIdentifier}`, { replace: true });
                    }, 100);
                  }}
                  className="btn btn-primary btn-sm gap-2"
                  title="View Client Page"
                >
                  <UserIcon className="w-4 h-4" />
                  <span className="hidden md:inline">View Client</span>
                </button>
              )}
              <button
                onClick={onClose}
                className="btn btn-ghost btn-circle flex-shrink-0"
              >
                <XMarkIcon className="w-5 h-5 md:w-6 md:h-6" />
              </button>
            </div>
          </div>
          
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
              {/* Toggle Tabs - Only show for superusers */}
              {isSuperuser === true && (
                <div className="flex gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => setShowMyContactsOnly(false)}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      !showMyContactsOnly
                        ? 'bg-purple-600 text-white shadow-sm'
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
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    My Contacts
                  </button>
                </div>
              )}
              
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
                      <div 
                        className="font-semibold text-gray-900 truncate text-sm md:text-base"
                        dir="auto"
                      >
                        {contact.name}
                      </div>
                       <div className="text-xs md:text-sm text-gray-500 truncate" dir="ltr">
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
                          <h3 
                            className="font-semibold text-gray-900 text-sm"
                            dir="auto"
                          >
                            {selectedContact.name}
                          </h3>
                          <p className="text-xs text-gray-500" dir="ltr">
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
                        <h3 
                          className="font-semibold text-gray-900"
                          dir="auto"
                        >
                          {selectedContact.name}
                        </h3>
                        <p className="text-sm text-gray-500" dir="ltr">
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
                        
                        // Determine if email is from team/user based on sender email domain
                        // Emails from @lawoffice.org.il are ALWAYS team/user, never client
                        const senderEmail = message.sender_email || '';
                        const isFromOffice = isOfficeEmail(senderEmail);
                        // If sender is from office domain, it's ALWAYS team/user, regardless of direction field
                        const isOutgoing = isFromOffice ? true : (message.direction === 'outgoing');
                        
                        // Get sender display name - use employee display_name for office emails
                        let senderDisplayName: string;
                        if (isOutgoing) {
                          // For team/user emails: use employee display_name from cache if available, otherwise fallback
                          senderDisplayName = (message as any).sender_display_name 
                            || message.sender_name 
                            || currentUserFullName 
                            || userEmail 
                            || 'You';
                        } else {
                          // For client emails
                          senderDisplayName = message.sender_name || selectedContact.name || 'Sender';
                        }
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
                                  dir="auto"
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
                                  <div className="text-xs text-gray-500 mt-1 space-y-0.5" dir="ltr" style={{ textAlign: 'left' }}>
                                    <div>
                                      <span className="font-medium">From:</span> <span className="text-gray-700">{message.sender_email || 'Unknown'}</span>
                                    </div>
                                    {message.recipient_list && (() => {
                                      const recipients = message.recipient_list.split(/[,;]/).map((r: string) => r.trim()).filter((r: string) => r);
                                      return (
                                        <div>
                                          <span className="font-medium">To:</span> <span className="text-gray-700">
                                            {recipients.map((recipient: string, idx: number) => (
                                              <span key={idx}>
                                                {recipient}
                                                {idx < recipients.length - 1 && ', '}
                                              </span>
                                            ))}
                                          </span>
                                        </div>
                                      );
                                    })()}
                                    <div className="text-gray-400">{formatTime(message.sent_at)}</div>
                                  </div>
                                </div>
                                
                                {message.body_html ? (
                                  <div
                                    dangerouslySetInnerHTML={{ __html: message.body_html }}
                                    className="prose prose-sm max-w-none text-gray-700 break-words email-content"
                                    style={{ 
                                      wordBreak: 'break-word', 
                                      overflowWrap: 'anywhere',
                                      whiteSpace: 'pre-wrap' // Preserve line breaks and whitespace
                                    }}
                                    dir="auto"
                                  />
                                ) : message.body_preview ? (
                                  <div
                                    className="text-gray-700 whitespace-pre-wrap break-words"
                                    style={{ 
                                      wordBreak: 'break-word', 
                                      overflowWrap: 'anywhere'
                                    }}
                                    dir="auto"
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

              <input
                type="text"
                placeholder="Subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              <label className="font-semibold text-sm">Body</label>

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
                onChange={(e) => {
                  setNewMessage(e.target.value);
                  // Dynamically detect Hebrew as user types
                  setNewMessageIsRTL(containsHebrew(e.target.value));
                }}
                dir={newMessageIsRTL ? 'rtl' : 'ltr'}
                style={{
                  textAlign: newMessageIsRTL ? 'right' : 'left',
                  direction: newMessageIsRTL ? 'rtl' : 'ltr'
                }}
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
            <div className="flex-none px-6 py-4 border-t border-gray-200 flex items-center justify-between gap-4" style={{ position: 'sticky', bottom: 0, zIndex: 10 }}>
              {/* Left side - Buttons and Template Filters */}
              <div className="flex items-center gap-4 flex-wrap">
                {/* Circle action buttons */}
                <div className="flex items-center gap-3">
                  {/* Attach Files Button */}
                  <button
                    type="button"
                    className="btn btn-circle border-0 text-white hover:opacity-90 transition-all hover:scale-105"
                    style={{ 
                      backgroundColor: '#4218CC', 
                      width: '44px', 
                      height: '44px'
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSending}
                    title="Attach files"
                  >
                    <PaperClipIcon className="w-6 h-6" />
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
                    className="btn btn-circle border-0 text-white hover:opacity-90 transition-all hover:scale-105"
                    style={{ 
                      backgroundColor: '#4218CC', 
                      width: '44px', 
                      height: '44px'
                    }}
                    title={newMessage.trim() ? "Improve message with AI" : "Get AI suggestions"}
                  >
                    {isLoadingAI ? (
                      <span className="loading loading-spinner loading-sm" />
                    ) : (
                      <SparklesIcon className="w-6 h-6" />
                    )}
                  </button>
                  
                  {/* Add Link Button */}
                  <button
                    type="button"
                    className={`btn btn-circle border-0 text-white hover:opacity-90 transition-all hover:scale-105 ${
                      showLinkForm ? 'ring-2 ring-offset-2 ring-[#4218CC]' : ''
                    }`}
                    style={{ 
                      backgroundColor: '#4218CC', 
                      width: '44px', 
                      height: '44px'
                    }}
                    onClick={() => setShowLinkForm(prev => !prev)}
                    disabled={isSending}
                    title={showLinkForm ? 'Hide link form' : 'Add link'}
                  >
                    <LinkIcon className="w-6 h-6" />
                  </button>
                  
                  {/* Add Contacts from Lead Button */}
                  <button
                    type="button"
                    className={`btn btn-circle border-0 text-white hover:opacity-90 transition-all hover:scale-105 ${
                      showContactsModal ? 'ring-2 ring-offset-2 ring-[#4218CC]' : ''
                    }`}
                    style={{ 
                      backgroundColor: '#4218CC', 
                      width: '44px', 
                      height: '44px'
                    }}
                    onClick={handleOpenContactsModal}
                    disabled={isSending || !selectedContact}
                    title="Add contacts from lead"
                  >
                    <UserPlusIcon className="w-6 h-6" />
                  </button>
                </div>
                
                {/* Divider */}
                <div className="w-px h-8 bg-base-300 hidden sm:block" />
                
                {/* Template filters */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Language Filter */}
                  <select
                    className="select select-bordered select-sm w-28 text-sm"
                    value={templateLanguageFilter || ''}
                    onChange={(e) => {
                      setTemplateLanguageFilter(e.target.value || null);
                      if (!templateDropdownOpen) {
                        setTemplateDropdownOpen(true);
                      }
                    }}
                  >
                    <option value="">Language</option>
                    {availableLanguages.map(lang => (
                      <option key={lang.id} value={lang.id}>
                        {lang.name}
                      </option>
                    ))}
                  </select>
                  
                  {/* Placement Filter */}
                  <select
                    className="select select-bordered select-sm w-36 text-sm"
                    value={templatePlacementFilter ?? ''}
                    onChange={(e) => {
                      setTemplatePlacementFilter(e.target.value ? Number(e.target.value) : null);
                      if (!templateDropdownOpen) {
                        setTemplateDropdownOpen(true);
                      }
                    }}
                  >
                    <option value="">Placement</option>
                    {availablePlacements.map(placement => (
                      <option key={placement.id} value={placement.id}>
                        {placement.name}
                      </option>
                    ))}
                  </select>
                  
                  {/* Template Search */}
                  <div className="relative w-40" ref={templateDropdownRef}>
                    <input
                      type="text"
                      className="input input-bordered input-sm w-full pr-8"
                      placeholder="Templates..."
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
                      <div className="absolute bottom-full mb-1 z-20 w-72 bg-white border border-gray-300 rounded-md shadow-lg max-h-56 overflow-y-auto">
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
                  
                  {/* Clear Filters Button */}
                  {(selectedTemplateId !== null || templateLanguageFilter || templatePlacementFilter !== null) && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-circle"
                      onClick={() => {
                        setSelectedTemplateId(null);
                        setTemplateSearch('');
                        setNewMessage('');
                        setNewMessageIsRTL(false);
                        if (selectedContact) {
                          const category = selectedContact.topic || 'General';
                          setSubject(`${selectedContact.lead_number} - ${selectedContact.name} - ${category}`);
                        }
                      }}
                      title="Clear filters"
                    >
                      <XMarkIcon className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
              
              {/* Right side - Send button only */}
              <button
                onClick={handleSendEmail}
                disabled={isSending || !newMessage.trim()}
                className="btn btn-primary min-w-[100px] flex items-center gap-2"
              >
                {isSending ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <>
                    <PaperAirplaneIcon className="w-4 h-4" />
                    Send
                  </>
                )}
              </button>
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
                          <div 
                            className="font-semibold text-gray-900 truncate"
                            dir="auto"
                          >
                            {contact.name}
                          </div>
                          <div className="text-sm text-gray-500 truncate" dir="ltr">
                            {contact.email || 'No email'}
                          </div>
                          <div className="text-xs text-gray-400" dir="ltr">
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
                              <p 
                                className="font-semibold text-gray-900 truncate"
                                dir="auto"
                              >
                                {result.isContact && !result.isMainContact ? 'Contact: ' : ''}{displayName}
                              </p>
                              <span className="text-xs text-gray-500 font-mono" dir="ltr">{result.lead_number}</span>
                            </div>
                            {displayEmail && (
                              <p className="text-sm text-gray-600 truncate" dir="ltr">{displayEmail}</p>
                            )}
                            {displayPhone && (
                              <p className="text-xs text-gray-500 truncate" dir="ltr">{displayPhone}</p>
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
      
      {/* Lead Contacts Modal */}
      {showContactsModal && createPortal(
        <div className="fixed inset-0 z-[10002] flex items-center justify-center">
          <div 
            className="absolute inset-0 bg-black/50" 
            onClick={() => setShowContactsModal(false)} 
          />
          <div className="relative z-10 bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Select Contacts</h3>
                <p className="text-sm text-gray-500">Add contacts from this lead to recipients</p>
              </div>
              <button
                onClick={() => setShowContactsModal(false)}
                className="btn btn-ghost btn-sm btn-circle"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            
            {/* Modal Body */}
            <div className="px-5 py-4 max-h-[320px] overflow-y-auto">
              {loadingContacts ? (
                <div className="flex items-center justify-center py-8">
                  <span className="loading loading-spinner loading-md text-primary" />
                  <span className="ml-2 text-gray-500">Loading contacts...</span>
                </div>
              ) : modalLeadContacts.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <UserPlusIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No contacts with email found for this lead</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {modalLeadContacts.map(contact => {
                    const isSelected = selectedContactIds.has(contact.id);
                    const alreadyAdded = toRecipients.includes(contact.email!);
                    
                    return (
                      <div
                        key={contact.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                          alreadyAdded 
                            ? 'bg-gray-50 border-gray-200 opacity-60 cursor-not-allowed'
                            : isSelected 
                              ? 'bg-purple-50 border-purple-300' 
                              : 'bg-white border-gray-200 hover:bg-gray-50'
                        }`}
                        onClick={() => !alreadyAdded && toggleContactSelection(contact.id)}
                      >
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                          alreadyAdded
                            ? 'bg-gray-300 border-gray-300'
                            : isSelected 
                              ? 'bg-[#4218CC] border-[#4218CC]' 
                              : 'border-gray-300'
                        }`}>
                          {(isSelected || alreadyAdded) && <CheckIcon className="w-3 h-3 text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900 truncate">{contact.name}</span>
                            {contact.isMain && (
                              <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Main</span>
                            )}
                            {alreadyAdded && (
                              <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">Added</span>
                            )}
                          </div>
                          <p className="text-sm text-gray-500 truncate">{contact.email}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            
            {/* Modal Footer */}
            <div className="px-5 py-4 border-t border-gray-200 flex items-center justify-between bg-gray-50">
              <span className="text-sm text-gray-500">
                {selectedContactIds.size > 0 
                  ? `${selectedContactIds.size} contact(s) selected`
                  : 'Select contacts to add'}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowContactsModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm text-white"
                  style={{ backgroundColor: '#4218CC' }}
                  onClick={handleAddSelectedContacts}
                  disabled={selectedContactIds.size === 0}
                >
                  Add Selected
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default EmailThreadModal; 