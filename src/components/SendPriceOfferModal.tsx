import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { InteractionRequiredAuthError, IPublicClientApplication } from '@azure/msal-browser';
import toast from 'react-hot-toast';
import { sendEmail } from '../lib/graph';
import { supabase } from '../lib/supabase';
import { updateLeadStageWithHistory } from '../lib/leadStageManager';
import { PaperAirplaneIcon, PlusIcon, XMarkIcon, ChevronDownIcon, PaperClipIcon, SparklesIcon, LinkIcon, UserPlusIcon, CheckIcon } from '@heroicons/react/24/outline';
import { fetchLeadContacts, ContactInfo } from '../lib/contactHelpers';
import { fetchStageNames, normalizeStageName } from '../lib/stageUtils';

interface SendPriceOfferModalProps {
  isOpen: boolean;
  onClose: () => void;
  client: any;
  msalInstance: IPublicClientApplication;
  loginRequest: any;
  onOfferSent: () => Promise<void>;
}

type RecipientType = 'to' | 'cc';

type EmailTemplate = {
  id: number;
  name: string;
  subject: string | null;
  content: string;
  rawContent: string;
  languageId: string | null;
  languageName: string | null;
  placementId: number | null;
  placementName: string | null;
};

type EmployeeSuggestion = {
  email: string;
  name: string;
};

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function fetchCurrentUserFullName() {
  const { data: { user } } = await supabase.auth.getUser();
  if (user && user.email) {
    const { data, error } = await supabase
      .from('users')
      .select('full_name')
      .eq('email', user.email)
      .single();
    if (!error && data?.full_name) {
      return data.full_name;
    }
  }
  return null;
}

const normaliseAddressList = (value: string | null | undefined) => {
  if (!value) return [] as string[];
  return value
    .split(/[;,]+/)
    .map(item => item.trim())
    .filter(item => item.length > 0);
};

const updateOfferBodyWithTotal = (body: string, _total: string, _currency: string) => {
  if (!body) return body;
  return body
    .split('\n')
    .filter(line => !line.trim().toLowerCase().startsWith('total cost of the offer:'))
    .join('\n');
};

const parseTemplateContent = (rawContent: string | null | undefined): string => {
  if (!rawContent) return '';

  const sanitizeTemplateText = (text: string) => {
    if (!text) return '';

    const withoutTotal = text
      .split('\n')
      .filter(line => !/^total\s+cost\s+of\s+the\s+offer/i.test(line.trim()))
      .map(line => line.replace(/\s+$/g, ''));

    return withoutTotal
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

  // First attempt: raw JSON
  let text = tryParseDelta(rawContent);
  if (text !== null) {
    return text;
  }

  // Second attempt: sometimes the JSON is double-encoded as a string
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

  // Fallback: extract insert values manually
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

  // Final fallback: treat as HTML / plain text string or html: section
  return sanitizeTemplateText(cleanHtml(rawContent));
};

const manualStageIdFallbacks: Record<string, number> = {
  created: 0,
  schedulerassigned: 10,
  precommunication: 11,
  communicationstarted: 15,
  meetingscheduled: 20,
  meetingcomplete: 30,
  meetingirrelevant: 35,
  waitingformtngsum: 40,
  mtngsumagreementsent: 50,
  clientdeclinedpriceoffer: 51,
  clientdeclined: 51,
  anothermeeting: 55,
  clientsignedagreement: 60,
  paymentrequestsent: 70,
  droppedspamirrelevant: 91,
  success: 100,
  handlerset: 105,
  handlerstarted: 110,
  applicationsubmitted: 150,
  caseclosed: 200,
};

const resolveStageId = async (stage: string | number | null | undefined): Promise<number | null> => {
  if (stage === null || stage === undefined) {
    return null;
  }

  if (typeof stage === 'number') {
    return Number.isFinite(stage) ? stage : null;
  }

  const str = String(stage).trim();
  if (!str) {
    return null;
  }

  const numericDirect = Number(str);
  if (!Number.isNaN(numericDirect) && Number.isFinite(numericDirect)) {
    return numericDirect;
  }

  const normalized = normalizeStageName(str);
  if (normalized && manualStageIdFallbacks[normalized] !== undefined) {
    return manualStageIdFallbacks[normalized];
  }

  try {
    const stageNames = await fetchStageNames();
    for (const [id, name] of Object.entries(stageNames)) {
      if (!name) continue;
      const normalizedId = normalizeStageName(String(id));
      const normalizedName = normalizeStageName(name);
      if (normalizedId === normalized || normalizedName === normalized) {
        const numeric = Number(id);
        if (!Number.isNaN(numeric)) {
          return numeric;
        }
      }
    }
  } catch (error) {
    console.error('Failed to fetch stage names while resolving stage id:', error);
  }

  return manualStageIdFallbacks[normalized] ?? null;
};

const SendPriceOfferModal: React.FC<SendPriceOfferModalProps> = ({
  isOpen,
  onClose,
  client,
  msalInstance,
  loginRequest,
  onOfferSent,
}) => {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [total, setTotal] = useState('');
  const [currency, setCurrency] = useState('₪');
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const templateDropdownRef = useRef<HTMLDivElement | null>(null);
  
  // Language and Placement filter state
  const [templateLanguageFilter, setTemplateLanguageFilter] = useState<string | null>(null);
  const [templatePlacementFilter, setTemplatePlacementFilter] = useState<number | null>(null);
  const [availableLanguages, setAvailableLanguages] = useState<Array<{ id: string; name: string }>>([]);
  const [availablePlacements, setAvailablePlacements] = useState<Array<{ id: number; name: string }>>([]);
  
  // Employee autocomplete state
  const [employees, setEmployees] = useState<EmployeeSuggestion[]>([]);
  const [toSuggestions, setToSuggestions] = useState<EmployeeSuggestion[]>([]);
  const [ccSuggestions, setCcSuggestions] = useState<EmployeeSuggestion[]>([]);
  const [showToSuggestions, setShowToSuggestions] = useState(false);
  const [showCcSuggestions, setShowCcSuggestions] = useState(false);
  const toSuggestionsRef = useRef<HTMLDivElement>(null);
  const ccSuggestionsRef = useRef<HTMLDivElement>(null);
  
  // Attachments state
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // AI suggestions state
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [showAISuggestions, setShowAISuggestions] = useState(false);
  
  // Lead contacts modal state
  const [showContactsModal, setShowContactsModal] = useState(false);
  const [leadContacts, setLeadContacts] = useState<ContactInfo[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<number>>(new Set());
  const [loadingContacts, setLoadingContacts] = useState(false);
  
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

  const [toRecipients, setToRecipients] = useState<string[]>([]);
  const [ccRecipients, setCcRecipients] = useState<string[]>([]);
  const [toInput, setToInput] = useState('');
  const [ccInput, setCcInput] = useState('');
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  const defaultSubject = useMemo(() => {
    if (!client) return '';
    const leadNumber = client?.lead_number ? `[${client.lead_number}]` : '';
    const namePart = client?.name ? ` - ${client.name}` : '';
    const topicPart = client?.topic ? ` - ${client.topic}` : '';
    return `${leadNumber}${namePart}${topicPart}`.replace(/^\s*-\s*/, '');
  }, [client]);

  useEffect(() => {
    if (!isOpen || !client) return;

    const initialRecipients = normaliseAddressList(client.email);
    setToRecipients(initialRecipients.length > 0 ? initialRecipients : []);
    setCcRecipients([]);
    setToInput('');
    setCcInput('');
    setRecipientError(null);
    setShowLinkForm(false);
    setLinkLabel('');
    setLinkUrl('');

    setSubject(defaultSubject);
    setBody('');
    setTotal(
      client?.proposal_total !== null && client?.proposal_total !== undefined
        ? String(client.proposal_total)
        : ''
    );
    setCurrency(client?.proposal_currency || '₪');
    setSelectedTemplateId(null);
    setTemplateSearch('');
    setShowTemplateDropdown(false);
    setTemplateLanguageFilter(null);
    setTemplatePlacementFilter(null);
    
    // Reset employee suggestions
    setToSuggestions([]);
    setCcSuggestions([]);
    setShowToSuggestions(false);
    setShowCcSuggestions(false);
    
    // Reset attachments
    setAttachments([]);
    
    // Reset AI suggestions
    setAiSuggestions([]);
    setShowAISuggestions(false);
    setIsLoadingAI(false);
  }, [isOpen, client, defaultSubject]);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    const loadTemplates = async () => {
      setTemplatesLoading(true);
      try {
        // Fetch languages, placements, and templates in parallel
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
            .select('*, email_templates_placement(id, name)')
            .eq('active', 't')
            .order('name', { ascending: true })
        ]);

        if (templatesResult.error) throw templatesResult.error;
        if (!isMounted) return;

        // Build language map
        const languageMap = new Map<string, string>();
        if (!languagesResult.error && languagesResult.data) {
          languagesResult.data.forEach((lang: any) => {
            languageMap.set(String(lang.id), lang.name);
          });
          // Set available languages for filter
          setAvailableLanguages(
            languagesResult.data.map((lang: any) => ({
              id: String(lang.id),
              name: lang.name
            }))
          );
        }
        
        // Set available placements for filter
        if (!placementsResult.error && placementsResult.data) {
          setAvailablePlacements(
            placementsResult.data.map((p: any) => ({
              id: typeof p.id === 'number' ? p.id : Number(p.id),
              name: p.name
            }))
          );
        }

        const parsed = (templatesResult.data || []).map((template: any) => {
          const languageId = template.language_id ? String(template.language_id) : null;
          const languageName = languageId ? languageMap.get(languageId) || null : null;
          
          // Handle placement - could be array or object
          const placement = Array.isArray(template.email_templates_placement)
            ? template.email_templates_placement[0]
            : template.email_templates_placement;
          
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
        if (isMounted) {
          console.error('Failed to fetch email templates:', error);
          toast.error('Failed to load email templates.');
          setTemplates([]);
        }
      } finally {
        if (isMounted) {
          setTemplatesLoading(false);
        }
      }
    };

    loadTemplates();
    return () => {
      isMounted = false;
    };
  }, [isOpen]);
  
  // Fetch employees for autocomplete
  useEffect(() => {
    if (!isOpen) return;
    
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
        const employeeList: EmployeeSuggestion[] = [];
        employeesResult.data?.forEach((emp: any) => {
          if (!emp.display_name) return;
          
          const emailFromUsers = employeeIdToEmail.get(emp.id);
          if (emailFromUsers) {
            employeeList.push({ email: emailFromUsers, name: emp.display_name });
          }
          
          // Also add pattern email
          const patternEmail = `${emp.display_name.toLowerCase().replace(/\s+/g, '.')}@lawoffice.org.il`;
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

    fetchEmployees();
  }, [isOpen]);

  useEffect(() => {
    if (!showTemplateDropdown) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(event.target as Node)) {
        setShowTemplateDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTemplateDropdown]);

  useEffect(() => {
    if (!isOpen || selectedTemplateId === null) return;
    setBody(prev => updateOfferBodyWithTotal(prev, total, currency));
  }, [total, currency, selectedTemplateId, isOpen]);

  // Search employees locally - must be before early return to follow rules of hooks
  const searchEmployees = useCallback((searchText: string): EmployeeSuggestion[] => {
    if (!searchText || searchText.trim().length < 1) return [];
    
    const searchLower = searchText.trim().toLowerCase();
    return employees
      .filter(emp => 
        emp.name.toLowerCase().includes(searchLower) || 
        emp.email.toLowerCase().includes(searchLower)
      )
      .slice(0, 10); // Limit to 10 results
  }, [employees]);

  if (!isOpen) return null;

  const closeModal = () => {
    if (sending) return;
    onClose();
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
    setBody(prev => {
      const existing = prev || '';
      const trimmedExisting = existing.replace(/\s*$/, '');
      // Use markdown-style link format: [label](url) or just the URL if no label
      const linkLine = label ? `[${label}](${formattedUrl})` : formattedUrl;
      return trimmedExisting ? `${trimmedExisting}\n\n${linkLine}` : linkLine;
    });

    handleCancelLink();
  };

  const convertBodyToHtml = (text: string) => {
    if (!text) return '';
    
    // First, convert markdown-style links [label](url) to HTML
    // Using a more permissive regex that handles various URL formats
    let result = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
      // Ensure the URL is valid
      let finalUrl = url.trim();
      if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
        finalUrl = 'https://' + finalUrl;
      }
      const safeUrl = finalUrl.replace(/"/g, '&quot;');
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    
    // Then convert standalone URLs (not already in an anchor tag)
    // Match URLs that aren't preceded by href=" or ">
    const urlPattern = /(?<![">])(https?:\/\/[^\s<]+)/g;
    result = result.replace(urlPattern, url => {
      const safeUrl = url.replace(/"/g, '&quot;');
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });
    
    return result.replace(/\n/g, '<br>');
  };

  const addRecipient = (type: RecipientType, rawValue: string) => {
    const value = rawValue.trim().replace(/[;,]+$/, '');
    if (!value) return;
    if (!emailRegex.test(value)) {
      setRecipientError('Please enter a valid email address.');
      return;
    }

    setRecipientError(null);
    if (type === 'to') {
      if (!toRecipients.includes(value)) {
        setToRecipients(prev => [...prev, value]);
      }
      setToInput('');
      setShowToSuggestions(false);
      setToSuggestions([]);
    } else {
      if (!ccRecipients.includes(value)) {
        setCcRecipients(prev => [...prev, value]);
      }
      setCcInput('');
      setShowCcSuggestions(false);
      setCcSuggestions([]);
    }
  };

  const handleRecipientKeyDown = (type: RecipientType) => (event: React.KeyboardEvent<HTMLInputElement>) => {
    const keys = ['Enter', ',', ';'];
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
  
  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    setAttachments(prev => [...prev, ...files]);
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  // Handle AI suggestions
  const handleAISuggestions = async () => {
    if (!client || isLoadingAI) return;

    setIsLoadingAI(true);
    setShowAISuggestions(true);
    
    try {
      const requestType = body.trim() ? 'improve' : 'suggest';
      
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-ai-suggestions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          currentMessage: body.trim(),
          conversationHistory: [],
          clientName: client?.name || 'Client',
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

  const applyAISuggestion = (suggestion: string) => {
    setBody(suggestion);
    setShowAISuggestions(false);
    setAiSuggestions([]);
  };
  
  // Handle opening contacts modal
  const handleOpenContactsModal = async () => {
    if (!client) return;
    
    setShowContactsModal(true);
    setLoadingContacts(true);
    setSelectedContactIds(new Set());
    
    try {
      const isLegacyLead = typeof client.id === 'string' && client.id.startsWith('legacy_');
      const contacts = await fetchLeadContacts(client.id, isLegacyLead);
      
      // Filter only contacts with valid emails
      const contactsWithEmail = contacts.filter(c => c.email && c.email.trim());
      setLeadContacts(contactsWithEmail);
    } catch (error) {
      console.error('Error fetching lead contacts:', error);
      toast.error('Failed to load contacts');
      setLeadContacts([]);
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
    const selectedContacts = leadContacts.filter(c => selectedContactIds.has(c.id));
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
  
  // Map attachments for backend
  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1] || '';
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const mapAttachmentsForBackend = async (files: File[]) => {
    const encoded: Array<{ name: string; contentType: string; contentBytes: string }> = [];
    for (const file of files) {
      const base64 = await readFileAsBase64(file);
      encoded.push({
        name: file.name,
        contentType: file.type || 'application/octet-stream',
        contentBytes: base64,
      });
    }
    return encoded;
  };

  const removeRecipient = (type: RecipientType, email: string) => {
    if (type === 'to') {
      setToRecipients(prev => prev.filter(item => item !== email));
    } else {
      setCcRecipients(prev => prev.filter(item => item !== email));
    }
  };

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

  const handleTemplateSelect = (templateId: number) => {
    if (!client) return;

    const template = templates.find(item => item.id === templateId);
    if (!template) return;

    const clientName = client?.name || 'Client';
    const leadNumber = client?.lead_number ? String(client.lead_number) : '';

    setSelectedTemplateId(templateId);

    if (template.subject && template.subject.trim()) {
      const subjectWithTokens = template.subject
        .replace(/\{client_name\}/gi, clientName)
        .replace(/\{lead_number\}/gi, leadNumber);
      setSubject(subjectWithTokens.trim());
    }

    const templatedBody = template.content
      .replace(/\{client_name\}/gi, clientName)
      .replace(/\{lead_number\}/gi, leadNumber);

    setBody(templatedBody || template.content || template.rawContent);
    setTemplateSearch(template.name);
    setShowTemplateDropdown(false);
  };

  const handleSendOffer = async () => {
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

    if (!client) {
      toast.error('Client data is unavailable.');
      return;
    }

    setSending(true);
    try {
      const account = msalInstance.getAllAccounts()[0];
      if (!account) {
        toast.error('You must be signed in to send an email.');
        setSending(false);
        return;
      }

      let accessToken;
      try {
        const response = await msalInstance.acquireTokenSilent({ ...loginRequest, account });
        accessToken = response.accessToken;
      } catch (error) {
        if (error instanceof InteractionRequiredAuthError) {
          const response = await msalInstance.loginPopup(loginRequest);
          accessToken = response.accessToken;
        } else {
          throw error;
        }
      }

      const closerName = (await fetchCurrentUserFullName()) || 'Current User';

      const htmlBody = convertBodyToHtml(body);
      
      // Prepare attachments if any
      const emailAttachments = attachments.length > 0 
        ? await mapAttachmentsForBackend(attachments)
        : undefined;

      await sendEmail(accessToken, {
        to: finalToRecipients,
        cc: finalCcRecipients,
        subject,
        body: htmlBody,
        attachments: emailAttachments,
      });

      let parsedTotal: number | null = null;
      if (total !== null && total !== undefined && String(total).trim() !== '') {
        const numericTotal = Number(total);
        parsedTotal = Number.isNaN(numericTotal) ? null : numericTotal;
      }

      let stageId = await resolveStageId('Mtng sum+Agreement sent');
      if (stageId === null) {
        stageId = 50;
      }

      await updateLeadStageWithHistory({
        lead: client,
        stage: stageId,
        additionalFields: {
          proposal_text: body,
          proposal_total: parsedTotal,
          proposal_currency: currency,
          closer: closerName,
          balance: parsedTotal,
          balance_currency: currency,
        },
      });

      const now = new Date();
      const recipientListForLog = [...finalToRecipients, ...finalCcRecipients].join(', ');
      const messageId = `offer_${client?.id}_${now.getTime()}`;
      const isLegacyLead = typeof client?.id === 'string' && client.id.startsWith('legacy_');
      const legacyNumericId = isLegacyLead
        ? Number.parseInt(String(client.id).replace('legacy_', ''), 10)
        : null;
      const plainBody = body;

      const emailRecord: Record<string, any> = {
        message_id: messageId,
        thread_id: null,
        sender_name: closerName,
        sender_email: account.username || account.homeAccountId || null,
        recipient_list: recipientListForLog,
        subject,
        body_preview: plainBody,
        body_html: htmlBody,
        sent_at: now.toISOString(),
        direction: 'outgoing',
        attachments: attachments.length > 0 
          ? attachments.map(file => ({ name: file.name, contentType: file.type || 'application/octet-stream' }))
          : null,
      };

      if (isLegacyLead) {
        emailRecord.legacy_id = Number.isNaN(legacyNumericId) ? null : legacyNumericId;
      } else {
        emailRecord.client_id = client.id;
      }

      await supabase.from('emails').upsert([emailRecord], { onConflict: 'message_id' });

      toast.success('Offer email sent!');
      await onOfferSent();
      onClose();
    } catch (error: any) {
      console.error('Error sending offer email:', error);
      if (error?.message && error.message.includes('category')) {
        toast.error('Please set a category for this client before performing this action.', {
          duration: 4000,
          style: {
            background: '#fee2e2',
            color: '#dc2626',
            border: '1px solid #fecaca',
          },
        });
      } else {
        toast.error('Failed to send offer email.');
      }
    }
    setSending(false);
  };

  const renderRecipients = (type: RecipientType) => {
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
            <span
              key={`${type}-${email}`}
              className="bg-primary/10 text-primary px-2 py-1 rounded-full text-sm flex items-center gap-1"
            >
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
              
              // Search employees as user types
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
              // Show suggestions if we have them
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
            onMouseDown={(e) => e.preventDefault()}
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

  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative z-10 flex flex-col h-full bg-base-100">
        <header className="px-6 py-4 border-b border-base-200 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Send Price Offer</h2>
            <p className="text-sm text-base-content/60">Create and send a customized price offer to the client.</p>
          </div>
          <button className="btn btn-ghost" onClick={closeModal} disabled={sending}>
            <XMarkIcon className="w-6 h-6" />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          <section className="space-y-2">
            <label className="font-semibold text-sm">To</label>
            {renderRecipients('to')}
          </section>

          <section className="space-y-2">
            <label className="font-semibold text-sm">CC</label>
            {renderRecipients('cc')}
          </section>

          {recipientError && <p className="text-sm text-error">{recipientError}</p>}

          <section className="space-y-2">
            <label className="font-semibold text-sm">Subject</label>
            <input
              type="text"
              className="input input-bordered w-full"
              value={subject}
              onChange={event => setSubject(event.target.value)}
            />
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="font-semibold text-sm">Body</label>
            </div>
            
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileUpload}
              className="hidden"
            />

            {/* AI Suggestions Display */}
            {showAISuggestions && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-blue-700">AI Suggestion</span>
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost"
                    onClick={() => {
                      setShowAISuggestions(false);
                      setAiSuggestions([]);
                    }}
                  >
                    <XMarkIcon className="w-4 h-4" />
                  </button>
                </div>
                {isLoadingAI ? (
                  <div className="flex items-center gap-2 text-sm text-blue-600">
                    <span className="loading loading-spinner loading-sm" />
                    Getting AI suggestions...
                  </div>
                ) : aiSuggestions.length > 0 ? (
                  <div 
                    className="p-3 rounded-lg border border-blue-200 bg-white cursor-pointer hover:bg-blue-50 transition-colors"
                    onClick={() => applyAISuggestion(aiSuggestions[0])}
                  >
                    <div className="text-sm text-gray-900 whitespace-pre-wrap">{aiSuggestions[0]}</div>
                    <div className="text-xs text-blue-600 mt-2">Click to apply this suggestion</div>
                  </div>
                ) : null}
              </div>
            )}

            {/* Attachments Display */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((file, index) => (
                  <div key={index} className="flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-lg">
                    <PaperClipIcon className="w-4 h-4 text-gray-500" />
                    <span className="text-sm">{file.name}</span>
                    <button
                      onClick={() => removeAttachment(index)}
                      className="text-gray-500 hover:text-red-500"
                    >
                      <XMarkIcon className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

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
                    disabled={sending || !linkUrl.trim()}
                  >
                    Insert Link
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={handleCancelLink}
                    disabled={sending}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <textarea
              className="textarea textarea-bordered w-full min-h-[240px]"
              value={body}
              onChange={event => setBody(event.target.value)}
            />
          </section>
        </main>

        <footer className="px-6 py-4 border-t border-base-200 flex items-center justify-between gap-4">
          {/* Left side - Buttons and Template Filters */}
          <div className="flex items-center gap-4">
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
                disabled={sending}
                title="Attach files"
              >
                <PaperClipIcon className="w-6 h-6" />
              </button>
              
              {/* AI Suggestions Button */}
              <button
                type="button"
                onClick={handleAISuggestions}
                disabled={isLoadingAI || !client}
                className="btn btn-circle border-0 text-white hover:opacity-90 transition-all hover:scale-105"
                style={{ 
                  backgroundColor: '#4218CC', 
                  width: '44px', 
                  height: '44px'
                }}
                title="AI suggestions"
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
                disabled={sending}
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
                disabled={sending || !client}
                title="Add contacts from lead"
              >
                <UserPlusIcon className="w-6 h-6" />
              </button>
            </div>
            
            {/* Divider */}
            <div className="w-px h-8 bg-base-300" />
            
            {/* Template filters */}
            <div className="flex items-center gap-2">
              {/* Language Filter */}
              <select
                className="select select-bordered select-sm w-28 text-sm"
                value={templateLanguageFilter || ''}
                onChange={(e) => {
                  setTemplateLanguageFilter(e.target.value || null);
                  if (!showTemplateDropdown) {
                    setShowTemplateDropdown(true);
                  }
                }}
                disabled={templatesLoading || sending}
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
                  if (!showTemplateDropdown) {
                    setShowTemplateDropdown(true);
                  }
                }}
                disabled={templatesLoading || sending}
              >
                <option value="">Placement</option>
                {availablePlacements.map(placement => (
                  <option key={placement.id} value={placement.id}>
                    {placement.name}
                  </option>
                ))}
              </select>
              
              {/* Template Search */}
              <div className="relative w-52" ref={templateDropdownRef}>
                <input
                  type="text"
                  className="input input-bordered input-sm w-full pr-8"
                  placeholder={templatesLoading ? 'Loading...' : 'Templates...'}
                  value={templateSearch}
                  onChange={event => {
                    setTemplateSearch(event.target.value);
                    if (!showTemplateDropdown) {
                      setShowTemplateDropdown(true);
                    }
                  }}
                  onFocus={() => {
                    if (!templatesLoading) {
                      setShowTemplateDropdown(true);
                    }
                  }}
                  disabled={templatesLoading || sending}
                />
                <ChevronDownIcon className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                {showTemplateDropdown && !templatesLoading && (
                  <div className="absolute bottom-full mb-1 z-20 w-72 bg-white border border-gray-300 rounded-md shadow-lg max-h-56 overflow-y-auto">
                    {filteredTemplates.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-500">No templates found</div>
                    ) : (
                      filteredTemplates.map(template => (
                        <div
                          key={template.id}
                          className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                          onClick={() => handleTemplateSelect(template.id)}
                        >
                          <div>{template.name}</div>
                          {(template.placementName || template.languageName) && (
                            <div className="text-xs text-gray-500">
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
                    setBody('');
                    setSubject(defaultSubject);
                    setTemplateSearch('');
                    setShowTemplateDropdown(false);
                    setTemplateLanguageFilter(null);
                    setTemplatePlacementFilter(null);
                  }}
                  disabled={sending}
                  title="Clear filters"
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          
          {/* Right side - Send button only */}
          <button
            className="btn btn-primary min-w-[140px] flex items-center gap-2"
            onClick={handleSendOffer}
            disabled={sending}
          >
            {sending ? (
              <span className="loading loading-spinner loading-sm" />
            ) : (
              <>
                <PaperAirplaneIcon className="w-4 h-4" />
                Send Offer
              </>
            )}
          </button>
        </footer>
      </div>
      
      {/* Lead Contacts Modal */}
      {showContactsModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center">
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
              ) : leadContacts.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <UserPlusIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No contacts with email found for this lead</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {leadContacts.map(contact => {
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
        </div>
      )}
    </div>
  );
};

export default SendPriceOfferModal;
