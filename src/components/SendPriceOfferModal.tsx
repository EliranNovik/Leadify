import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { InteractionRequiredAuthError, IPublicClientApplication } from '@azure/msal-browser';
import toast from 'react-hot-toast';
import { sendEmailViaBackend } from '../lib/mailboxApi';
import { convertBodyToHtml, escapeHtml, formatPlainEmailParagraphs, htmlToPlainEmail, isComposeBodyEmpty, plainTextToEditorHtml } from '../lib/emailBodyHtml';
import { buildOutgoingHtmlWithSignature } from '../lib/emailSignature';
import { supabase } from '../lib/supabase';
import { saveOutgoingEmailRecord } from '../lib/saveOutgoingEmailRecord';
import { saveLeadPriceOffer } from '../lib/leadPriceOfferVersions';
import { fetchLeadCaseFileForAi, parseFollowupDocumentLinks, formatRequiredDocumentLinksBlock, applyCrmDocumentLinksToEmailDraft } from '../lib/leadFollowupAiApi';
import {
  applyContractLinkPreviewHtml,
  bodyHasContractLink,
  buildClickableContractLinkHtml,
  fetchLeadContractPublicLink,
  labelForContractLink,
  stripLooseContractPreviewText,
} from '../lib/leadContractLink';
import { sendWordDocumentAiChatMessage } from '../lib/wordDocumentAiApi';
import { updateLeadStageWithHistory } from '../lib/leadStageManager';
import { PaperAirplaneIcon, PlusIcon, XMarkIcon, ChevronDownIcon, PaperClipIcon, SparklesIcon, LinkIcon, UserPlusIcon, CheckIcon, ChatBubbleLeftRightIcon, DocumentTextIcon, DocumentCheckIcon, Bars3BottomLeftIcon, Bars3BottomRightIcon, BoldIcon, UnderlineIcon } from '@heroicons/react/24/outline';
import { EditorContent, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extension-placeholder';
import { TextAlign } from '@tiptap/extension-text-align';
import { Highlight } from '@tiptap/extension-highlight';
import { TextStyle } from '@tiptap/extension-text-style';
import { FontSize } from '@tiptap/extension-font-size';
import { Underline } from '@tiptap/extension-underline';
import { Link } from '@tiptap/extension-link';
import { ContractLinkPreview } from './signature/ContractLinkPreviewExtension';
import { fetchLeadContacts, ContactInfo } from '../lib/contactHelpers';
import { fetchStageNames, normalizeStageName, getStageName, getStageColour, getSoftStageBadgeStyle } from '../lib/stageUtils';
import { ComposeBodyWithSignature, COMPOSE_SEND_BUTTON_CLASS, COMPOSE_CC_TOGGLE_CLASS } from './signature/ComposeSignaturePreview';

const PRICE_OFFER_ACTION_BUTTON_CLASS =
  'btn btn-circle border-0 bg-white text-gray-600 shadow-sm hover:bg-white hover:shadow transition-all hover:scale-105';

const PRICE_OFFER_ACTION_BUTTON_STYLE: React.CSSProperties = {
  backgroundColor: '#ffffff',
  color: '#4B5563',
  width: 44,
  height: 44,
};

const PRICE_OFFER_LABELED_BUTTON_CLASS =
  'inline-flex h-11 items-center gap-1.5 rounded-full border-0 bg-white px-3 text-sm font-medium text-gray-600 shadow-sm transition-all hover:scale-105 hover:bg-white hover:shadow disabled:opacity-40';

const PRICE_OFFER_LABELED_BUTTON_STYLE: React.CSSProperties = {
  backgroundColor: '#ffffff',
  color: '#4B5563',
  height: 44,
};
import { ComposeAttachmentPreviews } from './signature/ComposeAttachmentPreviews';
import { ComposeAiEmptyPrompt, ComposeAiRedoButton, useComposeAiTypewriter } from './signature/ComposeAiEmptyPrompt';
import ContractAiReviewPanel, { type ContractAiReviewMessage } from './ContractAiReviewPanel';
import { EMAIL_AI_QUICK_ACTIONS } from '../lib/aiProfessionalWriting';
import { cleanMeetingBriefText, hasHebrewText } from '../lib/meetingSummaryNotesApi';

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

/** CRM already appends the company signature — drop anything after the sign-off. */
const stripAiEmailSignature = (text: string): string => {
  const normalized = text.replace(/\r\n/g, '\n').trimEnd();
  const lines = normalized.split('\n');
  const closeRe =
    /^(best regards|kind regards|warm regards|with regards|regards|sincerely|yours sincerely|yours truly|thanks|thank you|בברכה|בכבוד רב)\s*,?\s*$/i;
  let closeIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (closeRe.test(lines[i].trim())) closeIdx = i;
  }
  if (closeIdx >= 0) return lines.slice(0, closeIdx + 1).join('\n').trim();
  return normalized.replace(
    /\n+(?:\[your name\]|\[your position\]|decker,?\s*pex[\s\S]*)$/i,
    '',
  ).trim();
};

const PRICE_OFFER_AI_DRAFT_PROMPT =
  'Write a detailed professional price offer email for this client. Analyze the CRM case file and meeting brief. State the offer amount clearly, recap what was discussed, and explain the next step. Use 4–7 short paragraphs. Do not invent facts. Never write a short check-in.';

const MEETING_SUMMARY_RULE = '────────';
const MEETING_SUMMARY_TITLE_EN = 'Meeting Summary';
const MEETING_SUMMARY_TITLE_HE = 'סיכום פגישה';

const meetingSummaryTitle = (summary: string) =>
  hasHebrewText(summary) ? MEETING_SUMMARY_TITLE_HE : MEETING_SUMMARY_TITLE_EN;

const buildMeetingSummaryPlainBlock = (summary: string) => {
  const text = cleanMeetingBriefText(summary);
  return `${meetingSummaryTitle(text)}\n${text}`;
};

const bodyHasMeetingSummaryBlock = (text: string) => {
  const plain = text.replace(/\u0332/g, '');
  return plain.includes(MEETING_SUMMARY_TITLE_EN) || plain.includes(MEETING_SUMMARY_TITLE_HE);
};

const buildMeetingSummaryHtmlBlock = (title: string, summary: string) => {
  const dir = hasHebrewText(summary) ? 'rtl' : 'ltr';
  const align = dir === 'rtl' ? 'right' : 'left';
  const paragraphs = escapeHtml(summary).replace(/\n/g, '<br>');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse;">
  <tr>
    <td style="width:3px;background:#4218CC;font-size:0;line-height:0;">&nbsp;</td>
    <td dir="${dir}" style="padding:14px 18px;background:#f6f5f2;text-align:${align};">
      <div style="font-size:12px;font-weight:600;letter-spacing:0.08em;${
        title === MEETING_SUMMARY_TITLE_HE ? '' : 'text-transform:uppercase;'
      }color:#4218CC;margin-bottom:8px;">${escapeHtml(title)}</div>
      <div style="font-size:14px;line-height:1.65;color:#374151;">${paragraphs}</div>
    </td>
  </tr>
</table>`;
};

const applyMeetingSummaryHtml = (text: string, summary = '') => {
  const withLegacyRules = text.replace(
    new RegExp(
      `(${MEETING_SUMMARY_TITLE_EN}|${MEETING_SUMMARY_TITLE_HE})\\n${MEETING_SUMMARY_RULE}\\n([\\s\\S]*?)\\n${MEETING_SUMMARY_RULE}`,
      'g',
    ),
    (_match, title: string, content: string) => buildMeetingSummaryHtmlBlock(title, content.trim()),
  );
  const cleaned = cleanMeetingBriefText(summary);
  if (!cleaned) return withLegacyRules;
  const title = meetingSummaryTitle(cleaned);
  const candidates = [
    `${title}\n${cleaned}`,
    `${title}\n\n${cleaned}`,
  ];
  for (const block of candidates) {
    if (withLegacyRules.includes(block)) {
      return withLegacyRules.replace(block, buildMeetingSummaryHtmlBlock(title, cleaned));
    }
  }
  return withLegacyRules;
};

const COMPOSE_FONT_SIZES = ['12px', '14px', '16px', '18px', '22px'] as const;
const HIGHLIGHT_YELLOW = '#fef08a';

const FORMAT_BTN_CLASS =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-gray-600 transition hover:bg-white disabled:opacity-40';
const FORMAT_BTN_ACTIVE_CLASS =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#4218CC] text-white transition disabled:opacity-40';

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
  const attachmentsSectionRef = useRef<HTMLDivElement>(null);
  
  // AI suggestions state
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [showAISuggestions, setShowAISuggestions] = useState(false);
  const [aiDraftActive, setAiDraftActive] = useState(false);
  const [aiChatOpen, setAiChatOpen] = useState(true);
  const [aiChatMessages, setAiChatMessages] = useState<ContractAiReviewMessage[]>([]);
  const [aiChatRemarks, setAiChatRemarks] = useState('');
  const [aiChatApplying, setAiChatApplying] = useState(false);
  const [aiChatThinking, setAiChatThinking] = useState<string | null>(null);
  const [meetingSummary, setMeetingSummary] = useState('');
  const [insertingContractLink, setInsertingContractLink] = useState(false);
  const caseFileRef = useRef('');
  const caseFilePromiseRef = useRef<Promise<string> | null>(null);
  
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
  const [showCcField, setShowCcField] = useState(false);
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
    setShowCcField(false);
    setToInput('');
    setCcInput('');
    setRecipientError(null);
    setShowLinkForm(false);
    setLinkLabel('');
    setLinkUrl('');

    setSubject(defaultSubject);
    setComposeBody('');
    setAiDraftActive(false);
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
    setAiChatOpen(true);
    setAiChatMessages([]);
    setAiChatRemarks('');
    setAiChatApplying(false);
    setAiChatThinking(null);
    setMeetingSummary('');
    setInsertingContractLink(false);
  }, [isOpen, client, defaultSubject]);

  useEffect(() => {
    if (!isOpen || !client?.id) {
      caseFileRef.current = '';
      caseFilePromiseRef.current = null;
      return;
    }
    const leadId = String(client.id);
    const promise = fetchLeadCaseFileForAi({
      leadId,
      isLegacy: client.lead_type === 'legacy' || leadId.startsWith('legacy_'),
    })
      .then((text) => {
        caseFileRef.current = text;
        return text;
      })
      .catch((error) => {
        console.warn('Failed to load CRM case file for price-offer AI', error);
        caseFileRef.current = '';
        return '';
      });
    caseFilePromiseRef.current = promise;
  }, [isOpen, client?.id, client?.lead_type]);

  useEffect(() => {
    if (!isOpen || !client?.id) {
      setMeetingSummary('');
      return;
    }
    let cancelled = false;
    const loadMeetingSummary = async () => {
      const isLegacy = client.lead_type === 'legacy' || String(client.id).startsWith('legacy_');
      const query = supabase
        .from('meetings')
        .select('meeting_summary_notes, meeting_brief')
        .order('meeting_date', { ascending: false })
        .limit(1);
      const { data, error } = isLegacy
        ? await query.eq('legacy_lead_id', String(client.id).replace(/^legacy_/i, ''))
        : await query.eq('client_id', client.id);
      if (cancelled) return;
      if (error || !data?.[0]) {
        setMeetingSummary('');
        return;
      }
      const text =
        String(data[0].meeting_summary_notes ?? '').trim() ||
        String(data[0].meeting_brief ?? '').trim();
      setMeetingSummary(cleanMeetingBriefText(text));
    };
    void loadMeetingSummary();
    return () => {
      cancelled = true;
    };
  }, [isOpen, client?.id, client?.lead_type]);

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
    setComposeBody(prev => updateOfferBodyWithTotal(prev, total, currency));
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

  const syncingEditorRef = useRef(false);
  const composeEditorRef = useRef<ReturnType<typeof useEditor>>(null);
  const [, bumpEditorUi] = useState(0);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: false }),
      Underline,
      TextStyle,
      FontSize,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['paragraph'] }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          class: 'text-[#4218CC] underline',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
      ContractLinkPreview,
      Placeholder.configure({ placeholder: 'Type your message...' }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class:
          'price-offer-compose-editor min-h-[240px] outline-none text-[15px] leading-relaxed text-gray-900',
      },
    },
    onUpdate: ({ editor: next }) => {
      if (syncingEditorRef.current) return;
      setBody(next.getHTML());
      bumpEditorUi(n => n + 1);
    },
    onSelectionUpdate: () => bumpEditorUi(n => n + 1),
  });
  composeEditorRef.current = editor;

  const setComposeBody = useCallback((next: string | ((prev: string) => string)) => {
    setBody(prev => {
      const raw = typeof next === 'function' ? next(prev) : next;
      const html = plainTextToEditorHtml(raw);
      const ed = composeEditorRef.current;
      if (ed) {
        syncingEditorRef.current = true;
        ed.commands.setContent(html || '');
        syncingEditorRef.current = false;
      }
      return html;
    });
  }, []);

  const { cancel: cancelComposeAiTypewrite } = useComposeAiTypewriter(setComposeBody);

  if (!isOpen) return null;

  const closeModal = () => {
    if (sending) return;
    setAiChatOpen(false);
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
    const linkHtml = label
      ? `<p><a href="${escapeHtml(formattedUrl)}">${escapeHtml(label)}</a></p>`
      : `<p><a href="${escapeHtml(formattedUrl)}">${escapeHtml(formattedUrl)}</a></p>`;
    if (composeEditorRef.current) {
      composeEditorRef.current.chain().focus().insertContent(linkHtml).run();
    } else {
      setComposeBody(prev => `${prev || ''}${linkHtml}`);
    }

    handleCancelLink();
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
    if (files.length === 0) return;
    setAttachments(prev => [...prev, ...files]);
    event.target.value = '';
    window.setTimeout(() => {
      attachmentsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const applyAISuggestion = (suggestion: string) => {
    setComposeBody(formatPlainEmailParagraphs(suggestion));
    setShowAISuggestions(false);
    setAiSuggestions([]);
  };

  const applyPriceOfferAiDraft = (text: string) => {
    const trimmed = stripAiEmailSignature(
      text.replace(/\[\[\/?[A-Z]+(?::[^\]]+)?\]\]/g, '').replace(/\r\n/g, '\n').trim(),
    );
    const subjectMatch = trimmed.match(/^Subject:\s*(.+?)\n(?:\s*\n)?([\s\S]*)$/i);
    if (subjectMatch) {
      const nextSubject = subjectMatch[1].trim();
      if (nextSubject) setSubject(nextSubject);
      setComposeBody(
        applyContractLinkPreviewHtml(formatPlainEmailParagraphs(stripAiEmailSignature(subjectMatch[2]))),
      );
      setAiDraftActive(true);
      return;
    }
    setComposeBody(applyContractLinkPreviewHtml(formatPlainEmailParagraphs(trimmed)));
    setAiDraftActive(true);
  };

  const handleApplyPriceOfferAiChat = async (remarksOverride?: string) => {
    const remarks = (remarksOverride ?? aiChatRemarks).trim();
    if (!remarks || !client || aiChatApplying) return;
    setAiChatOpen(true);
    setAiChatApplying(true);
    setAiChatThinking('Opening the case file…');
    setAiChatMessages((prev) => [...prev, { role: 'user', content: remarks }]);
    setAiChatRemarks('');
    try {
      let caseContext =
        caseFileRef.current ||
        (caseFilePromiseRef.current ? await caseFilePromiseRef.current : '') ||
        (await fetchLeadCaseFileForAi({
          leadId: String(client.id),
          isLegacy: client.lead_type === 'legacy' || String(client.id).startsWith('legacy_'),
        }).catch(() => ''));
      let links = parseFollowupDocumentLinks(caseContext);
      if (!links.contractSigningUrl && !links.poaUrl && !links.invoiceUrl) {
        const fresh = await fetchLeadCaseFileForAi({
          leadId: String(client.id),
          isLegacy: client.lead_type === 'legacy' || String(client.id).startsWith('legacy_'),
        }).catch(() => '');
        if (fresh) {
          caseContext = fresh;
          caseFileRef.current = fresh;
          links = parseFollowupDocumentLinks(fresh);
        }
      }
      const requiredLinks = formatRequiredDocumentLinksBlock(links);
      setAiChatThinking('Reading the case and your request…');
      const offerAmount = [total.trim(), currency.trim()].filter(Boolean).join(' ');
      const meetingBrief =
        meetingSummary.trim() ||
        String(client.meeting_brief || client.meeting_summary_notes || '').trim();
      const offerContext = [
        'This is a FIRST PRICE OFFER email after a meeting (not a later follow-up).',
        offerAmount ? `Offer amount to state in the email: ${offerAmount}` : '',
        meetingBrief ? `Meeting brief:\n${meetingBrief}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      const currentDocumentText = `Subject: ${subject || `(price offer for ${client.name || 'client'})`}\n\n${
        htmlToPlainEmail(body) || '(empty price-offer email — draft one for this client)'
      }`;
      const userRemarks = [
        'Write a detailed professional price offer email: 4–7 short paragraphs. Analyze the case file and meeting brief. Never a short check-in.',
        remarks,
        offerContext,
        requiredLinks,
        caseContext
          ? `[BACKGROUND CASE FILE — use these facts. Copy REQUIRED LINKS exactly when needed. Do not dump this file into the email. Never use example.com.]\n${caseContext}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const result = await sendWordDocumentAiChatMessage(
        {
          currentDocumentText,
          userRemarks,
          clientName: client.name,
          leadNumber: client.lead_number,
          language: client.language,
          category: client.category,
          chatHistory: aiChatMessages.map((m) => ({
            role: m.role,
            content:
              m.role === 'assistant' && m.kind === 'change'
                ? 'Updated the price offer email.'
                : m.content,
          })),
          caseContext: [offerContext, requiredLinks, caseContext].filter(Boolean).join('\n\n'),
          purpose: 'email_followup',
        },
        (text) => setAiChatThinking(text),
      );
      if (result.intent === 'action') {
        applyPriceOfferAiDraft(
          applyCrmDocumentLinksToEmailDraft(result.improvedDocumentText, links, remarks),
        );
      }
      setAiChatMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          kind: result.intent === 'question' ? 'answer' : 'change',
          content:
            result.intent === 'question'
              ? result.answer
              : result.changeSummary || 'Done — I updated the price offer email.',
        },
      ]);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'AI request failed');
    } finally {
      setAiChatApplying(false);
      setAiChatThinking(null);
    }
  };

  const handleCreateEmailWithAi = () => {
    if (aiChatApplying || !client) return;
    void handleApplyPriceOfferAiChat(PRICE_OFFER_AI_DRAFT_PROMPT);
  };

  const handleInsertMeetingSummary = () => {
    const text = meetingSummary.trim();
    if (!text) {
      toast.error('No meeting summary is saved for this client.');
      return;
    }
    if (bodyHasMeetingSummaryBlock(body)) {
      toast('Meeting summary is already in the email.');
      return;
    }
    const title = meetingSummaryTitle(text);
    const summaryHtml = `<p><strong>${escapeHtml(title)}</strong></p>${text
      .split(/\n{2,}/)
      .map(para => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
      .join('')}`;
    cancelComposeAiTypewrite();
    if (composeEditorRef.current) {
      composeEditorRef.current.chain().focus().insertContent(summaryHtml).run();
    } else {
      setComposeBody(prev => `${prev || ''}${summaryHtml}`);
    }
  };

  const handleInsertAgreementLink = async () => {
    if (!client || insertingContractLink) return;
    if (bodyHasContractLink(body)) {
      toast('Agreement link is already in the email.');
      return;
    }
    setInsertingContractLink(true);
    try {
      const link = await fetchLeadContractPublicLink(
        String(client.id),
        client.lead_type === 'legacy' || String(client.id).startsWith('legacy_'),
      );
      if (!link) {
        toast.error('No agreement or contract link is available for this client.');
        return;
      }
      cancelComposeAiTypewrite();
      const leadNumber = client.lead_number ? String(client.lead_number) : '';
      const editor = composeEditorRef.current;
      if (editor) {
        const cleaned = stripLooseContractPreviewText(editor.getHTML());
        if (cleaned !== editor.getHTML()) {
          editor.commands.setContent(cleaned || '');
        }
        const inserted = editor.chain().focus().insertContractLinkPreview({
          href: link.url,
          signed: link.signed,
          leadNumber,
        }).run();
        if (!inserted || !bodyHasContractLink(editor.getHTML())) {
          editor.commands.setContent(
            `${stripLooseContractPreviewText(editor.getHTML())}${buildClickableContractLinkHtml(link.url, link.signed, leadNumber)}`,
          );
        }
      } else {
        setComposeBody(prev => `${prev || ''}${buildClickableContractLinkHtml(link.url, link.signed, leadNumber)}`);
      }
      toast.success(`${labelForContractLink(link.signed)} added`);
    } catch (error) {
      console.error('Failed to insert agreement link:', error);
      toast.error('Failed to add the agreement link.');
    } finally {
      setInsertingContractLink(false);
    }
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

    setComposeBody(templatedBody || template.content || template.rawContent);
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
      // Get Supabase auth user for userId
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        toast.error('You must be signed in to send an email.');
        setSending(false);
        return;
      }
      const userId = authUser.id;

      const closerName = (await fetchCurrentUserFullName()) || 'Current User';

      const htmlBody = convertBodyToHtml(applyMeetingSummaryHtml(body, meetingSummary), {
        markdownLinks: true,
      });
      const { html: htmlWithSignature, inlineAttachments } = await buildOutgoingHtmlWithSignature(htmlBody);
      
      // Prepare attachments if any
      const emailAttachments = [
        ...(attachments.length > 0 ? await mapAttachmentsForBackend(attachments) : []),
        ...inlineAttachments,
      ];

      const isLegacyLead = typeof client?.id === 'string' && client.id.startsWith('legacy_');
      const legacyId = isLegacyLead
        ? Number.parseInt(String(client.id).replace('legacy_', ''), 10)
        : null;

      const now = new Date();
      const recipientListForLog = [...finalToRecipients, ...finalCcRecipients].join(', ');
      const messageId = `offer_${isLegacyLead ? `legacy_${legacyId}` : client?.id}_${now.getTime()}`;
      const plainBody = htmlToPlainEmail(body);
      const bodyPreview = plainBody;
      let parsedTotal: number | null = null;
      if (total !== null && total !== undefined && String(total).trim() !== '') {
        const numericTotal = Number(total);
        parsedTotal = Number.isNaN(numericTotal) ? null : numericTotal;
      }

      // Use sendEmailViaBackend for consistency and proper backend processing
      await sendEmailViaBackend({
        userId,
        subject,
        bodyHtml: htmlWithSignature,
        to: finalToRecipients,
        cc: finalCcRecipients,
        attachments: emailAttachments.length > 0 ? emailAttachments : undefined,
        context: {
          clientId: !isLegacyLead ? client.id : null,
          legacyLeadId: isLegacyLead ? legacyId : null,
          leadType: client?.lead_type || (isLegacyLead ? 'legacy' : 'new'),
          leadNumber: client?.lead_number || null,
          contactEmail: client?.email || null,
          contactName: client?.name || null,
          senderName: closerName,
          crmMessageId: messageId,
        },
      });

      await saveLeadPriceOffer(client, {
        body,
        senderName: closerName,
        senderEmail: authUser.email || '',
        sentAt: now.toISOString(),
        total: parsedTotal,
        currency,
        emailMessageId: messageId,
      });

      await saveOutgoingEmailRecord({
        client,
        subject,
        htmlBody,
        senderName: closerName,
        senderEmail: authUser.email || '',
        recipientList: recipientListForLog,
        sentAt: now,
        messageId,
        bodyPreview,
        attachments:
          attachments.length > 0
            ? attachments.map((file) => ({
                name: file.name,
                contentType: file.type || 'application/octet-stream',
              }))
            : null,
      });

      let stageId = await resolveStageId('Mtng sum+Agreement sent');
      if (stageId === null) {
        stageId = 50;
      }

      // Helper function to convert currency symbol to currency_id for legacy leads
      const currencyNameToId = (currencyName: string): number | null => {
        switch (currencyName) {
          case '₪': return 1; // NIS
          case '€': return 2; // EUR  
          case '$': return 3; // USD
          case '£': return 4; // GBP
          default: return 1; // Default to NIS
        }
      };

      // Build additionalFields based on lead type
      let additionalFields: Record<string, any> = {};

      // For legacy leads, only include fields that exist in leads_lead table
      if (isLegacyLead) {
        additionalFields = {
          proposal: plainBody,
          total: parsedTotal ? String(parsedTotal) : null, // Use 'total' instead of 'balance', convert to string
          currency_id: currencyNameToId(currency), // Use 'currency_id' instead of 'balance_currency', convert to ID
        };
        console.log('💾 Saving proposal for legacy lead:', {
          legacyId,
          proposal: plainBody.substring(0, 100) + '...',
          total: parsedTotal,
          currency_id: currencyNameToId(currency),
          additionalFields,
        });
      } else {
        // For new leads, include all proposal and balance fields
        additionalFields = {
          proposal_text: plainBody,
          proposal_total: parsedTotal,
          proposal_currency: currency,
          closer: closerName,
          balance: parsedTotal,
          balance_currency: currency,
        };
      }

      // Try to update stage, but don't fail if this fails (email is already saved)
      try {
        await updateLeadStageWithHistory({
          lead: client,
          stage: stageId,
          additionalFields,
        });
        
        // For legacy leads, also verify the proposal was saved
        if (isLegacyLead && !Number.isNaN(legacyId)) {
          const { data: verifyData, error: verifyError } = await supabase
            .from('leads_lead')
            .select('proposal, total, currency_id')
            .eq('id', legacyId)
            .maybeSingle();
          
          if (verifyError) {
            console.error('❌ Error verifying proposal save:', verifyError);
          } else {
            console.log('✅ Verified proposal saved:', {
              proposal: verifyData?.proposal ? verifyData.proposal.substring(0, 100) + '...' : null,
              total: verifyData?.total,
              currency_id: verifyData?.currency_id,
            });
          }
        }
      } catch (stageError) {
        console.error('❌ Error updating lead stage (but email was saved):', stageError);
        // Don't throw - email is already saved, stage update can be retried
      }
      // Stage evaluation is handled automatically by database triggers

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
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-0 py-2">
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
          {type === 'to' && !showCcField && ccRecipients.length === 0 && (
            <button
              type="button"
              className={`${COMPOSE_CC_TOGGLE_CLASS} ml-auto`}
              onClick={() => setShowCcField(true)}
            >
              Cc
            </button>
          )}
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

  const stageStr =
    client?.stage != null && String(client.stage).trim() !== '' ? String(client.stage) : '';
  const stageLabel = stageStr
    ? /^\d+$/.test(stageStr)
      ? getStageName(stageStr) || stageStr
      : stageStr
    : '';
  const stageBadgeStyle = stageStr ? getSoftStageBadgeStyle(getStageColour(stageStr), stageStr) : null;

  return (
    <div className={`fixed inset-0 z-[70] send-price-offer-modal ${aiChatOpen ? 'md:pr-[28rem]' : ''}`}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative z-10 flex h-full flex-col bg-base-100">
        <div className="min-h-0 flex-1 overflow-y-auto">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-white/40 bg-white/45 px-6 py-4 shadow-[0_1px_0_0_rgba(255,255,255,0.55)] backdrop-blur-xl backdrop-saturate-150">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="shrink-0 text-2xl font-bold">Send Price Offer</h2>
            {(client?.lead_number || client?.name) && (
              <p className="truncate text-sm font-medium text-base-content/55">
                {[client?.lead_number, client?.name].filter(Boolean).join(' · ')}
              </p>
            )}
            {stageLabel && stageBadgeStyle ? (
              <span
                className="badge stage-badge shrink-0 rounded-full border-0 px-2.5 py-0.5 text-xs font-medium"
                style={{ backgroundColor: stageBadgeStyle.backgroundColor, color: stageBadgeStyle.color }}
                title={stageLabel}
              >
                {stageLabel}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 bg-transparent text-black hover:opacity-70 disabled:opacity-50"
              onClick={() => setAiChatOpen(true)}
              disabled={sending || !client}
              title="AI price offer assistant"
            >
              <SparklesIcon className="h-5 w-5" />
              <span className="text-sm font-semibold">AI</span>
            </button>
            <button className="btn btn-ghost" onClick={closeModal} disabled={sending}>
              <XMarkIcon className="w-6 h-6" />
            </button>
          </div>
        </header>

        <main className="space-y-6 px-6 py-6">
          <section className="space-y-2">
            <label className="font-semibold text-sm">To</label>
            {renderRecipients('to')}
          </section>

          {(showCcField || ccRecipients.length > 0) && (
          <section className="space-y-2">
            <label className="font-semibold text-sm">CC</label>
            {renderRecipients('cc')}
          </section>
          )}

          {recipientError && <p className="text-sm text-error">{recipientError}</p>}

          <section className="space-y-2">
            <label className="font-semibold text-sm">Subject</label>
            <input
              type="text"
              className="w-full border-0 border-b border-gray-200 px-0 py-2 outline-none ring-0 focus:outline-none focus:ring-0"
              value={subject}
              onChange={event => setSubject(event.target.value)}
            />
          </section>

          <section className="space-y-3">
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
                {aiSuggestions.length > 0 ? (
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

            <ComposeBodyWithSignature
              afterSignature={
                attachments.length > 0 ? (
                  <div ref={attachmentsSectionRef} className="mt-4 border-t border-slate-100 px-4 pb-6 pt-4">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Attachments
                    </p>
                    <ComposeAttachmentPreviews
                      files={attachments}
                      onRemove={removeAttachment}
                      className=""
                    />
                  </div>
                ) : null
              }
            >
            <div className="relative" onKeyDown={() => cancelComposeAiTypewrite()}>
            <EditorContent
              editor={editor}
              className="min-h-[240px] [&_.ProseMirror]:min-h-[240px] [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:mb-3 [&_.ProseMirror_p:last-child]:mb-0 [&_.ProseMirror_a:not(.contract-link-preview-btn)]:text-[#4218CC] [&_.ProseMirror_a:not(.contract-link-preview-btn)]:underline [&_.ProseMirror_p.is-editor-empty:first-child]:before:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child]:before:float-left [&_.ProseMirror_p.is-editor-empty:first-child]:before:h-0 [&_.ProseMirror_p.is-editor-empty:first-child]:before:text-gray-400 [&_.ProseMirror_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]"
            />
            <ComposeAiEmptyPrompt
              visible={isComposeBodyEmpty(body) && !aiChatApplying}
              loading={aiChatApplying && isComposeBodyEmpty(body)}
              disabled={aiChatApplying || !client}
              onClick={handleCreateEmailWithAi}
            />
            </div>
            {aiDraftActive && !isComposeBodyEmpty(body) && !aiChatApplying ? (
              <ComposeAiRedoButton
                disabled={aiChatApplying || !client}
                onClick={() =>
                  void handleApplyPriceOfferAiChat(
                    'Rewrite this price offer email with different wording. Keep the same facts and offer amount.',
                  )
                }
              />
            ) : null}
            </ComposeBodyWithSignature>
          </section>
        </main>
        </div>

        <footer className="flex items-center justify-between gap-4 bg-gray-50 px-6 py-4">
          {/* Left side - Buttons and Template Filters */}
          <div className="flex w-full items-center gap-4">
            {/* Circle action buttons */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                className={COMPOSE_SEND_BUTTON_CLASS}
                onClick={handleSendOffer}
                disabled={sending}
              >
                {sending ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <>
                    <PaperAirplaneIcon className="h-6 w-6" />
                    Send
                  </>
                )}
              </button>
              {/* Attach Files Button */}
              <button
                type="button"
                className={PRICE_OFFER_ACTION_BUTTON_CLASS}
                style={PRICE_OFFER_ACTION_BUTTON_STYLE}
                onClick={() => fileInputRef.current?.click()}
                disabled={sending}
                title="Attach files"
              >
                <PaperClipIcon className="w-6 h-6" />
              </button>
              
              {/* AI assistant Button */}
              <button
                type="button"
                onClick={() => setAiChatOpen(true)}
                disabled={aiChatApplying || !client}
                className={`${PRICE_OFFER_ACTION_BUTTON_CLASS} ${
                  aiChatOpen ? 'ring-2 ring-offset-2 ring-[#4218CC]' : ''
                }`}
                style={PRICE_OFFER_ACTION_BUTTON_STYLE}
                title="AI price offer assistant"
              >
                {aiChatApplying ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <SparklesIcon className="w-6 h-6" />
                )}
              </button>
              
              {/* Add Link Button */}
              <button
                type="button"
                className={`${PRICE_OFFER_ACTION_BUTTON_CLASS} ${
                  showLinkForm ? 'ring-2 ring-offset-2 ring-[#4218CC]' : ''
                }`}
                style={PRICE_OFFER_ACTION_BUTTON_STYLE}
                onClick={() => setShowLinkForm(prev => !prev)}
                disabled={sending}
                title={showLinkForm ? 'Hide link form' : 'Add link'}
              >
                <LinkIcon className="w-6 h-6" />
              </button>

              {/* Add meeting summary */}
              <button
                type="button"
                className={`${PRICE_OFFER_LABELED_BUTTON_CLASS} ${
                  bodyHasMeetingSummaryBlock(body) ? 'ring-2 ring-offset-2 ring-[#4218CC]' : ''
                }`}
                style={PRICE_OFFER_LABELED_BUTTON_STYLE}
                onClick={handleInsertMeetingSummary}
                disabled={sending || !meetingSummary.trim()}
                title="Summary"
              >
                <DocumentTextIcon className="w-5 h-5" />
                Summary
              </button>

              {/* Add agreement / contract link */}
              <button
                type="button"
                className={`${PRICE_OFFER_LABELED_BUTTON_CLASS} ${
                  bodyHasContractLink(body) ? 'ring-2 ring-offset-2 ring-[#4218CC]' : ''
                }`}
                style={PRICE_OFFER_LABELED_BUTTON_STYLE}
                onClick={() => void handleInsertAgreementLink()}
                disabled={sending || insertingContractLink || !client}
                title="Contract"
              >
                {insertingContractLink ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <DocumentCheckIcon className="w-5 h-5" />
                )}
                Contract
              </button>
              
              {/* Add Contacts from Lead Button */}
              <button
                type="button"
                className={`${PRICE_OFFER_ACTION_BUTTON_CLASS} ${
                  showContactsModal ? 'ring-2 ring-offset-2 ring-[#4218CC]' : ''
                }`}
                style={PRICE_OFFER_ACTION_BUTTON_STYLE}
                onClick={handleOpenContactsModal}
                disabled={sending || !client}
                title="Add contacts from lead"
              >
                <UserPlusIcon className="w-6 h-6" />
              </button>
            </div>

            <div className="ml-auto flex flex-wrap items-center justify-end gap-3">

            <div
              className="flex items-center gap-1.5"
              onMouseDown={event => {
                if ((event.target as HTMLElement).closest('select')) return;
                event.preventDefault();
              }}
            >
              <button
                type="button"
                className={editor?.isActive({ textAlign: 'left' }) ? FORMAT_BTN_ACTIVE_CLASS : FORMAT_BTN_CLASS}
                title="Align left"
                disabled={sending || !editor}
                onClick={() => {
                  if (!editor) return;
                  if (editor.isActive({ textAlign: 'left' })) {
                    editor.chain().focus().unsetTextAlign().run();
                    return;
                  }
                  editor.chain().focus().setTextAlign('left').run();
                }}
              >
                <Bars3BottomLeftIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={editor?.isActive({ textAlign: 'right' }) ? FORMAT_BTN_ACTIVE_CLASS : FORMAT_BTN_CLASS}
                title="Align right"
                disabled={sending || !editor}
                onClick={() => {
                  if (!editor) return;
                  if (editor.isActive({ textAlign: 'right' })) {
                    editor.chain().focus().unsetTextAlign().run();
                    return;
                  }
                  editor.chain().focus().setTextAlign('right').run();
                }}
              >
                <Bars3BottomRightIcon className="h-4 w-4" />
              </button>
              <select
                className="h-9 shrink-0 rounded-full border-0 bg-white px-2.5 text-xs font-medium text-gray-600"
                title="Text size"
                disabled={sending || !editor}
                value={
                  COMPOSE_FONT_SIZES.includes(
                    String(editor?.getAttributes('textStyle').fontSize || '') as (typeof COMPOSE_FONT_SIZES)[number],
                  )
                    ? String(editor?.getAttributes('textStyle').fontSize)
                    : ''
                }
                onChange={event => {
                  if (!editor) return;
                  const next = event.target.value;
                  if (!next) {
                    editor.chain().focus().unsetFontSize().run();
                    return;
                  }
                  editor.chain().focus().setFontSize(next).run();
                }}
              >
                <option value="">Size</option>
                {COMPOSE_FONT_SIZES.map(size => (
                  <option key={size} value={size}>
                    {size.replace('px', '')}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={editor?.isActive('bold') ? FORMAT_BTN_ACTIVE_CLASS : FORMAT_BTN_CLASS}
                title="Bold"
                disabled={sending || !editor}
                onClick={() => editor?.chain().focus().toggleBold().run()}
              >
                <BoldIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={editor?.isActive('underline') ? FORMAT_BTN_ACTIVE_CLASS : FORMAT_BTN_CLASS}
                title="Underline"
                disabled={sending || !editor}
                onClick={() => editor?.chain().focus().toggleUnderline().run()}
              >
                <UnderlineIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={editor?.isActive('highlight') ? FORMAT_BTN_ACTIVE_CLASS : FORMAT_BTN_CLASS}
                title="Highlight"
                disabled={sending || !editor}
                onClick={() => {
                  if (!editor) return;
                  editor.chain().focus().toggleHighlight({ color: HIGHLIGHT_YELLOW }).run();
                }}
              >
                <span className="rounded-sm bg-[#fef08a] px-1 text-[11px] font-bold leading-none text-gray-800">A</span>
              </button>
            </div>
            
            {/* Divider */}
            <div className="w-px h-8 bg-base-300" />
            
            {/* Template picker */}
            <div className="flex items-center gap-2">
              <div className="relative w-64" ref={templateDropdownRef}>
                <input
                  type="text"
                  className="input input-bordered input-sm w-full bg-white pr-8"
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
                <ChevronDownIcon className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                {showTemplateDropdown && !templatesLoading && (
                  <div className="absolute bottom-full right-0 z-20 mb-2 w-[28rem] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                    <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2.5">
                      <select
                        className="select select-bordered select-sm min-w-0 flex-1 text-sm"
                        value={templateLanguageFilter || ''}
                        onChange={e => setTemplateLanguageFilter(e.target.value || null)}
                      >
                        <option value="">Language</option>
                        {availableLanguages.map(lang => (
                          <option key={lang.id} value={lang.id}>
                            {lang.name}
                          </option>
                        ))}
                      </select>
                      <select
                        className="select select-bordered select-sm min-w-0 flex-1 text-sm"
                        value={templatePlacementFilter ?? ''}
                        onChange={e =>
                          setTemplatePlacementFilter(e.target.value ? Number(e.target.value) : null)
                        }
                      >
                        <option value="">Placement</option>
                        {availablePlacements.map(placement => (
                          <option key={placement.id} value={placement.id}>
                            {placement.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {filteredTemplates.length === 0 ? (
                        <div className="px-3 py-3 text-sm text-gray-500">No templates found</div>
                      ) : (
                        filteredTemplates.map(template => (
                          <div
                            key={template.id}
                            className="cursor-pointer px-3 py-2 text-sm hover:bg-gray-100"
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
                    setComposeBody('');
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
          </div>
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
      <ContractAiReviewPanel
        isOpen={aiChatOpen}
        onClose={() => setAiChatOpen(false)}
        initialSummary={null}
        messages={aiChatMessages}
        remarks={aiChatRemarks}
        onRemarksChange={setAiChatRemarks}
        onApplyRemarks={() => void handleApplyPriceOfferAiChat()}
        isApplying={aiChatApplying}
        thinkingText={aiChatThinking}
        zIndex={10050}
        title={
          <span className="flex items-center gap-2.5">
            <ChatBubbleLeftRightIcon className="h-7 w-7 shrink-0 text-violet-600" />
            <span>AI price offer assistant</span>
          </span>
        }
        subtitle=""
        placeholder="e.g. Write a price offer email stating the meeting total…"
        conversationOnly
        sheetClassName="!shadow-none"
        leadId={client?.id != null ? String(client.id) : null}
        isLegacy={client?.lead_type === 'legacy' || String(client?.id || '').startsWith('legacy_')}
        quickActions={EMAIL_AI_QUICK_ACTIONS}
        onQuickAction={(prompt) => void handleApplyPriceOfferAiChat(prompt)}
      />
    </div>
  );
};

export default SendPriceOfferModal;
