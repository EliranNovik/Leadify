import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ClientTabProps } from '../../types/client';
import {
  InformationCircleIcon,
  ExclamationCircleIcon,
  PencilIcon,
  CheckIcon,
  XMarkIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  ScaleIcon,
  ExclamationTriangleIcon,
  BanknotesIcon,
  FlagIcon,
  ChatBubbleLeftRightIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import { toast } from 'react-hot-toast';
import { useAuthContext } from '../../contexts/AuthContext';
import {
  fetchPublicUserId,
  fetchLeadFieldFlagsForLead,
  setLeadFieldFlagged,
  setLegacyLeadFieldFlagged,
  FLAG_TYPE_PROBABILITY,
  type ContentFlagMeta,
} from '../../lib/userContentFlags';
import {
  readPendingProbSession,
  writePendingProbSession,
  clearPendingProbSession,
} from '../../lib/pendingProbabilityStorage';
import ProbabilitySlidersModal, {
  caseProbabilityFromFactors,
  clampProbabilityPart,
  probabilityLevelLabel,
  splitProbabilityEvenly,
  type ProbabilitySlidersValues,
} from './ProbabilitySlidersModal';

const INFOTAB_DEBUG = typeof window !== 'undefined' && (window as any).__INFOTAB_DEBUG__ === true;

/** Full-screen bottom sheet on small screens only — used for editing Info tab fields on mobile */
function MobileEditModal({
  open,
  title,
  onClose,
  onSave,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onSave: () => void | Promise<void>;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] md:hidden flex items-end justify-center sm:items-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        className="relative w-full sm:max-w-lg max-h-[92vh] flex flex-col bg-base-100 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-base-300 mt-auto sm:mt-0"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-edit-modal-title"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-base-200 shrink-0">
          <h3 id="mobile-edit-modal-title" className="text-lg font-bold text-base-content pr-2">
            {title}
          </h3>
          <button type="button" className="btn btn-sm btn-circle btn-ghost" onClick={onClose} aria-label="Close">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">{children}</div>
        <div
          className="flex gap-2 p-4 border-t border-base-200 bg-base-100 shrink-0"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
        >
          <button type="button" className="btn btn-outline flex-1" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary flex-1" onClick={() => void onSave()}>
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Helper function to decode HTML entities
const decodeHtmlEntities = (text: string): string => {
  if (!text) return '';

  // Create a temporary DOM element to decode HTML entities
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
};

// Helper function to strip HTML tags from text
const stripHtmlTags = (text: string): string => {
  if (!text) return '';

  // First decode HTML entities
  let decoded = decodeHtmlEntities(text);

  // Decode HTML entities again in case there were double-encoded entities
  decoded = decodeHtmlEntities(decoded);

  // Convert common HTML line breaks and block elements to newlines before stripping tags
  // Order matters: process block-level elements first, then inline breaks
  decoded = decoded.replace(/<\/p>/gi, '\n\n'); // Paragraphs get double newline
  decoded = decoded.replace(/<\/div>/gi, '\n'); // Divs get single newline
  decoded = decoded.replace(/<\/tr>/gi, '\n'); // Table rows get newline
  decoded = decoded.replace(/<\/td>/gi, ' '); // Table cells get space
  decoded = decoded.replace(/<\/th>/gi, ' '); // Table headers get space
  decoded = decoded.replace(/<\/li>/gi, '\n'); // List items get newline
  decoded = decoded.replace(/<\/h[1-6]>/gi, '\n\n'); // Headings get double newline
  decoded = decoded.replace(/<br\s*\/?>/gi, '\n'); // Line breaks get newline
  decoded = decoded.replace(/<\/blockquote>/gi, '\n\n'); // Blockquotes get double newline

  // Remove HTML tags using regex (non-greedy match)
  const withoutTags = decoded.replace(/<[^>]*>/g, '');

  // Decode HTML entities one more time to catch any remaining entities
  let finalDecoded = decodeHtmlEntities(withoutTags);

  // Convert underscores to spaces for better readability
  finalDecoded = finalDecoded.replace(/_/g, ' ');

  // Clean up whitespace while preserving line breaks
  // Replace multiple spaces/tabs with single space (but not newlines)
  finalDecoded = finalDecoded.replace(/[ \t]+/g, ' '); // Collapse horizontal whitespace to single space
  // Remove spaces at the start of lines
  finalDecoded = finalDecoded.replace(/^[ \t]+/gm, '');
  // Remove spaces at the end of lines
  finalDecoded = finalDecoded.replace(/[ \t]+$/gm, '');
  // Collapse 3+ consecutive newlines to max 2 newlines
  finalDecoded = finalDecoded.replace(/\n{3,}/g, '\n\n');

  return finalDecoded.trim();
};

// Helper function to clean up text formatting
const formatNoteText = (text: string): string => {
  if (!text) return '';

  // Replace \r\n with \n, then \r with \n for proper line breaks
  // Also handle escaped \r characters (\\r)
  return text
    .replace(/\\r\\n/g, '\n')  // Handle escaped \r\n
    .replace(/\\r/g, '\n')     // Handle escaped \r
    .replace(/\r\n/g, '\n')    // Handle actual \r\n
    .replace(/\r/g, '\n')      // Handle actual \r
    .trim();
};

/**
 * Direction from the first *strong* directional character (Unicode bidi).
 * - Hebrew / Arabic scripts → rtl
 * - Latin letters → ltr
 * - Numbers, punctuation, spaces only → ltr (avoids wrongly forcing RTL on English-only content)
 */
const getTextDirection = (text: string): 'rtl' | 'ltr' => {
  if (!text) return 'ltr';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    // Hebrew
    if (cp >= 0x0590 && cp <= 0x05ff) return 'rtl';
    // Arabic + related RTL scripts
    if (cp >= 0x0600 && cp <= 0x06ff) return 'rtl';
    if (cp >= 0x0750 && cp <= 0x077f) return 'rtl';
    if (cp >= 0x08a0 && cp <= 0x08ff) return 'rtl';
    // Latin (English and common European letters)
    if (/[A-Za-z]/.test(ch)) return 'ltr';
  }
  return 'ltr';
};

// Helper function to decode URL-encoded text in URLs
const decodeUrlInText = (text: string): string => {
  if (!text) return '';

  // Match URLs (http://, https://) and decode URL-encoded parts
  const urlRegex = /(https?:\/\/[^\s<>]+)/gi;
  return text.replace(urlRegex, (url) => {
    try {
      // Decode the URL to show Hebrew characters properly (decodeURI handles full URLs correctly)
      return decodeURI(url);
    } catch (e) {
      // If decoding fails, return original URL
      return url;
    }
  });
};

// Helper function to get the correct field value based on lead type
const getFieldValue = (client: any, fieldName: string, legacyFieldName?: string) => {
  if (client.lead_type === 'legacy') {
    // For legacy leads, use the legacy field name if provided, otherwise use the original
    const fieldToUse = legacyFieldName || fieldName;
    return client[fieldToUse];
  }
  // For new leads, use the original field name
  return client[fieldName];
};

/** Hide "Last edited" footer when editor is missing/Unknown or timestamp is missing. */
const shouldShowLastEditedMeta = (editedBy: unknown, editedAt: unknown): boolean => {
  const by = String(editedBy ?? '').trim();
  if (!by || by.toLowerCase() === 'unknown') return false;
  if (editedAt == null || editedAt === '') return false;
  return true;
};

// Helper function to determine if this is a legacy lead
const isLegacyLead = (client: any) => {
  return client.lead_type === 'legacy' || client.id?.toString().startsWith('legacy_');
};

// Legacy probability may be numeric text or labels like L/M/H/VH (or Low/Medium/High/Very High).
const parseProbabilityValue = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    return Number.isNaN(value) ? null : Math.round(value);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const asNumber = Number(raw);
  if (!Number.isNaN(asNumber)) return Math.round(asNumber);

  const normalized = raw.toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'l' || normalized === 'low') return 25;
  if (normalized === 'm' || normalized === 'medium') return 50;
  if (normalized === 'h' || normalized === 'high') return 75;
  if (normalized === 'vh' || normalized === 'veryhigh') return 90;

  return null;
};

const InfoTab: React.FC<ClientTabProps> = ({
  client,
  onClientUpdate,
  readOnly = false,
  onSwitchClientTab,
  flaggedConversationCount = 0,
  onProbabilityConversationPending,
}) => {
  const { user } = useAuthContext();
  const authUserId = user?.id ?? null;
  const [publicUserId, setPublicUserId] = useState<string | null>(null);
  const [leadFieldFlagMeta, setLeadFieldFlagMeta] = useState<Map<string, ContentFlagMeta>>(() => new Map());
  const [pendingProbabilityValues, setPendingProbabilityValues] = useState<ProbabilitySlidersValues | null>(null);
  const [highProbGateOpen, setHighProbGateOpen] = useState(false);
  const [flagChooserOpen, setFlagChooserOpen] = useState(false);

  useEffect(() => {
    if (!authUserId) {
      setPublicUserId(null);
      return;
    }
    let cancelled = false;
    void fetchPublicUserId(supabase, authUserId).then((id) => {
      if (!cancelled) setPublicUserId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [authUserId]);

  useEffect(() => {
    if (!publicUserId || !client?.id) {
      setLeadFieldFlagMeta(new Map());
      return;
    }
    const isLeg = client.lead_type === 'legacy' || client.id?.toString().startsWith('legacy_');
    const legacyId = isLeg
      ? Number.parseInt(String(client.id).replace(/^legacy_/, ''), 10)
      : null;
    const newUuid = !isLeg && client.id != null ? String(client.id) : null;
    let cancelled = false;
    void fetchLeadFieldFlagsForLead(supabase, publicUserId, {
      newLeadId: newUuid || undefined,
      legacyLeadId: legacyId != null && !Number.isNaN(legacyId) ? legacyId : undefined,
    }).then((map) => {
      if (!cancelled) setLeadFieldFlagMeta(map);
    });
    return () => {
      cancelled = true;
    };
  }, [publicUserId, client?.id, client?.lead_type]);

  if (!client) {
    return <div className="flex justify-center items-center h-32"><span className="loading loading-spinner loading-md text-primary"></span></div>;
  }

  // Check if this is a legacy lead
  const isLegacy = isLegacyLead(client);
  const legacyLeadNumericId = isLegacy
    ? Number.parseInt(String(client.id).replace(/^legacy_/, ''), 10)
    : null;
  const newLeadUuidForFlags = !isLegacy && client.id != null ? String(client.id) : null;

  // Get field values with proper mapping for legacy leads
  const getProbability = () => {
    const prob = getFieldValue(client, 'probability');
    const parsed = parseProbabilityValue(prob);
    return parsed != null ? clampProbabilityPart(parsed) : 50;
  };

  const getSpecialNotes = () => {
    const notes = getFieldValue(client, 'special_notes');
    return notes ? [notes] : [];
  };

  const getGeneralNotes = () => {
    // For legacy leads, use 'notes' field instead of 'general_notes'
    const notes = isLegacy ? getFieldValue(client, 'notes') : getFieldValue(client, 'general_notes');
    return notes || '';
  };

  const getAnchor = () => {
    // For legacy leads, use 'anchor_full_name' field instead of 'anchor'
    const anchor = isLegacy ? getFieldValue(client, 'anchor_full_name') : getFieldValue(client, 'anchor');
    return anchor || '';
  };

  const getFileId = () => {
    // For legacy leads, use state if available, otherwise try client data
    if (isLegacy) {
      return legacyFileId || getFieldValue(client, 'file_id') || '';
    }
    // For new leads, use client data
    return getFieldValue(client, 'file_id') || '';
  };

  const getFacts = () => {
    // For legacy leads, use 'description' field instead of 'facts'
    const facts = isLegacy ? getFieldValue(client, 'description') : getFieldValue(client, 'facts');

    if (!facts) {
      return [];
    }

    try {
      // Try to parse as JSON first
      const parsedFacts = JSON.parse(facts);

      // If it's an object, extract non-null values
      if (typeof parsedFacts === 'object' && parsedFacts !== null) {
        const nonNullFacts = Object.entries(parsedFacts)
          .filter(([key, value]) => value !== null && value !== undefined && value !== '')
          .map(([key, value]) => {
            // Convert "n/" to line break in values
            let processedValue = typeof value === 'string' ? value.replace(/n\//g, '\n') : String(value || '');
            // Strip HTML tags from the value
            processedValue = stripHtmlTags(processedValue);
            return { key, value: processedValue };
          });

        return nonNullFacts;
      }

      // If it's not an object, treat as plain text
      // Convert "n/" to line break and strip HTML tags
      let processedFacts = typeof facts === 'string' ? facts.replace(/n\//g, '\n') : String(facts || '');
      processedFacts = stripHtmlTags(processedFacts);
      const result = [{ key: 'facts', value: processedFacts }];
      return result;
    } catch (error) {
      // If JSON parsing fails, treat as plain text
      // Convert "n/" to line break and strip HTML tags
      let processedFacts = typeof facts === 'string' ? facts.replace(/n\//g, '\n') : String(facts || '');
      processedFacts = stripHtmlTags(processedFacts);
      const result = [{ key: 'facts', value: processedFacts }];
      return result;
    }
  };

  // State for eligibility status and section eligibility (for legacy leads)
  const [eligibilityStatus, setEligibilityStatus] = useState<string>('');
  const [sectionEligibility, setSectionEligibility] = useState<string>('');
  const [legacyFileId, setLegacyFileId] = useState<string>('');

  // Function to fetch file_id for legacy leads
  const fetchLegacyFileId = async () => {
    if (!isLegacy || !client?.id) return;

    try {
      const legacyId = client.id.toString().replace('legacy_', '');
      const { data, error } = await supabase
        .from('leads_lead')
        .select('file_id')
        .eq('id', legacyId)
        .single();

      if (error) {
        console.error('Error fetching legacy file_id:', error);
        return;
      }

      if (data) {
        const raw = data.file_id != null ? String(data.file_id).trim() : '';
        const normalized = (raw === '' || raw === '0000') ? '' : raw;
        setLegacyFileId(normalized);
        if (INFOTAB_DEBUG) console.log('✅ InfoTab - Legacy file_id loaded:', data.file_id, '-> normalized:', normalized);
      }
    } catch (error) {
      console.error('Error in fetchLegacyFileId:', error);
    }
  };

  // Function to fetch eligibility data for legacy leads
  const fetchLegacyEligibilityData = async () => {
    if (!isLegacy || !client?.id) return;

    try {
      const legacyId = client.id.toString().replace('legacy_', '');
      const { data, error } = await supabase
        .from('leads_lead')
        .select('expert_examination, section_eligibility, eligibilty_date, eligibility_status, eligibility_status_timestamp')
        .eq('id', legacyId)
        .single();

      if (error) {
        console.error('Error fetching legacy eligibility data:', error);
        return;
      }

      if (data) {
        // Priority: Use eligibility_status if it exists, otherwise map from expert_examination
        let eligibilityValue = '';

        if (data.eligibility_status) {
          eligibilityValue = data.eligibility_status;
        } else {
          // Fallback: Map expert_examination to eligibility status
          const examValue = Number(data.expert_examination);
          if (examValue === 8) {
            eligibilityValue = 'feasible_no_check';
          } else if (examValue === 1) {
            eligibilityValue = 'not_feasible';
          } else if (examValue === 5) {
            eligibilityValue = 'feasible_check';
          }
        }

        setEligibilityStatus(eligibilityValue);
        setSectionEligibility(data.section_eligibility || '');

        if (INFOTAB_DEBUG) console.log('✅ InfoTab - Legacy eligibility data loaded:', {
          eligibility_status: data.eligibility_status,
          expert_examination: data.expert_examination,
          final_eligibility: eligibilityValue,
          section_eligibility: data.section_eligibility
        });
      }
    } catch (error) {
      console.error('Error in fetchLegacyEligibilityData:', error);
    }
  };

  // Fetch eligibility data and file_id for legacy leads on mount; reset legacy file_id when client changes to avoid showing/saving stale value (e.g. 0000)
  useEffect(() => {
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    if (isLegacyLead) {
      setLegacyFileId(''); // Clear immediately so we don't show or save previous lead's file_id
      fetchLegacyEligibilityData();
      fetchLegacyFileId();
    } else {
      setLegacyFileId('');
      setEligibilityStatus(getFieldValue(client, 'eligibility_status') || '');
      setSectionEligibility(getFieldValue(client, 'section_eligibility') || '');
    }
  }, [client?.id, client?.lead_type]);

  useEffect(() => {
    setCurrentUserFollowupNotes((getFieldValue(client, 'followup_log') as string) || null);
  }, [client]);

  const getEligibilityStatus = () => {
    // For legacy leads, use state (fetched from database)
    // For new leads, use client data
    if (isLegacy) {
      return eligibilityStatus;
    }
    return getFieldValue(client, 'eligibility_status') || '';
  };

  const getEligibleStatus = () => {
    // For new leads, 'eligible' is a boolean
    // For legacy leads, 'eligibile' is stored as 'true'/'false' strings (TEXT column)
    if (isLegacy) {
      const eligibile = getFieldValue(client, 'eligibile');
      return eligibile === 'true' || eligibile === true;
    }
    return getFieldValue(client, 'eligible') === true || getFieldValue(client, 'eligible') === 'true';
  };

  // State for current user's follow-up
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserFollowup, setCurrentUserFollowup] = useState<string | null>(null);
  const [currentUserFollowupNotes, setCurrentUserFollowupNotes] = useState<string | null>(
    (getFieldValue(client, 'followup_log') as string) || null
  );
  const [followupId, setFollowupId] = useState<number | null>(null);
  const [isFollowupLoading, setIsFollowupLoading] = useState(false);
  const cachedUserIdRef = useRef<string | null>(null);

  const getNextFollowup = () => {
    // Return the current user's follow-up from the follow_ups table
    return currentUserFollowup;
  };

  const [probability, setProbability] = useState(getProbability());
  const [probFactorLegal, setProbFactorLegal] = useState(0);
  const [probFactorSeriousness, setProbFactorSeriousness] = useState(0);
  const [probFactorFinancial, setProbFactorFinancial] = useState(0);
  const [probFactorsLoaded, setProbFactorsLoaded] = useState(false);
  const [probabilityModalOpen, setProbabilityModalOpen] = useState(false);
  const [probabilitySaving, setProbabilitySaving] = useState(false);
  const [isEditingSpecialNotes, setIsEditingSpecialNotes] = useState(false);
  const [isEditingGeneralNotes, setIsEditingGeneralNotes] = useState(false);
  const [isEditingAnchor, setIsEditingAnchor] = useState(false);
  const [isEditingFacts, setIsEditingFacts] = useState(false);
  const [eligible, setEligible] = useState(getEligibleStatus());
  const [isAddingFollowup, setIsAddingFollowup] = useState(false);
  const [isEditingFollowup, setIsEditingFollowup] = useState(false);
  const [followupDate, setFollowupDate] = useState('');
  const [isEditingFollowupNotes, setIsEditingFollowupNotes] = useState(false);
  const [followupNotes, setFollowupNotes] = useState('');
  const [isEditingFileId, setIsEditingFileId] = useState(false);
  const [editedFileId, setEditedFileId] = useState('');

  const [specialNotes, setSpecialNotes] = useState(getSpecialNotes());
  const [generalNotes, setGeneralNotes] = useState(getGeneralNotes());
  const [anchor, setAnchor] = useState(getAnchor());
  const [factsOfCase, setFactsOfCase] = useState(getFacts());
  const [fileId, setFileId] = useState(getFileId());

  const [editedSpecialNotes, setEditedSpecialNotes] = useState(specialNotes.join('\n'));
  const [editedGeneralNotes, setEditedGeneralNotes] = useState(generalNotes);
  const [editedAnchor, setEditedAnchor] = useState(anchor);
  const [editedFacts, setEditedFacts] = useState(() => {
    const facts = getFacts();
    if (Array.isArray(facts)) {
      return facts.map(fact => `${fact.key}: ${fact.value}`).join('\n');
    }
    return '';
  });

  const [isMdUp, setIsMdUp] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : true
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = () => setIsMdUp(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  /** On viewports &lt; md, open edit flows in a modal instead of inline */
  const useMobileEditModal = !readOnly && !isMdUp;

  // When factor columns are not loaded yet, keep probability label in sync with client row
  useEffect(() => {
    if (!probFactorsLoaded) {
      setProbability(getProbability());
    }
  }, [client?.probability, client?.id, probFactorsLoaded]);

  // Fetch legal / seriousness / financial_ability for case probability breakdown
  useEffect(() => {
    let cancelled = false;

    const parseLegalPotential = (v: unknown): number | null => {
      if (v == null || v === '') return null;
      if (typeof v === 'string') {
        const n = parseInt(String(v).trim(), 10);
        return Number.isNaN(n) ? null : n;
      }
      const n = Number(v);
      return Number.isNaN(n) ? null : Math.round(n);
    };

    const parseBigFactor = (v: unknown): number | null => {
      if (v == null || v === '') return null;
      const n = Number(v);
      return Number.isNaN(n) ? null : Math.round(n);
    };

    const loadFactors = async () => {
      if (!client?.id) return;
      setProbFactorsLoaded(false);

      const tableName = isLegacy ? 'leads_lead' : 'leads';
      const rowId = isLegacy ? client.id.toString().replace('legacy_', '') : client.id;

      try {
        const { data, error } = await supabase
          .from(tableName)
          .select('legal_potential, financial_ability, seriousness, probability')
          .eq('id', rowId)
          .maybeSingle();

        if (cancelled) return;
        if (error && error.code !== 'PGRST116') {
          if (INFOTAB_DEBUG) console.warn('InfoTab probability factors fetch:', error);
        }

        const L = data ? parseLegalPotential(data.legal_potential) : null;
        const S = data ? parseBigFactor(data.seriousness) : null;
        const F = data ? parseBigFactor(data.financial_ability) : null;

        if (L == null && S == null && F == null) {
          const fromDb = data ? parseProbabilityValue(data.probability) : null;
          const targetCaseProb =
            fromDb != null ? clampProbabilityPart(fromDb) : clampProbabilityPart(getProbability());
          const split = splitProbabilityEvenly(targetCaseProb);
          setProbFactorLegal(split.legal);
          setProbFactorSeriousness(split.seriousness);
          setProbFactorFinancial(split.financial);
          setProbability(caseProbabilityFromFactors(split.legal, split.seriousness, split.financial));
        } else {
          const l = L ?? 0;
          const s = S ?? 0;
          const f = F ?? 0;
          setProbFactorLegal(l);
          setProbFactorSeriousness(s);
          setProbFactorFinancial(f);
          setProbability(caseProbabilityFromFactors(l, s, f));
        }
      } catch (e) {
        if (!cancelled && INFOTAB_DEBUG) console.warn('InfoTab loadFactors', e);
        if (!cancelled) {
          const split = splitProbabilityEvenly(getProbability());
          setProbFactorLegal(split.legal);
          setProbFactorSeriousness(split.seriousness);
          setProbFactorFinancial(split.financial);
          setProbability(caseProbabilityFromFactors(split.legal, split.seriousness, split.financial));
        }
      } finally {
        if (!cancelled) setProbFactorsLoaded(true);
      }
    };

    void loadFactors();
    return () => {
      cancelled = true;
    };
  }, [client?.id, isLegacy]);

  // Update file ID when client changes
  useEffect(() => {
    const newFileId = getFileId();
    setFileId(newFileId);
  }, [client?.file_id, client?.id, legacyFileId]);

  // Update eligible status when client changes
  // Only update if we're not currently toggling (to prevent race condition)
  const [isTogglingEligible, setIsTogglingEligible] = useState(false);

  useEffect(() => {
    if (!isTogglingEligible) {
      setEligible(getEligibleStatus());
    }
  }, [client, isTogglingEligible]);

  // State to hold current user's display name
  const [currentUserName, setCurrentUserName] = useState<string>('Unknown');

  // Fetch current user ID and name (auth_id first, then email fallback so it never fails when user exists)
  useEffect(() => {
    async function fetchUserInfo() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        let userProfile: { id: string; full_name?: string; email?: string } | null = null;
        const byAuth = await supabase
          .from('users')
          .select('id, full_name, email')
          .eq('auth_id', user.id)
          .maybeSingle();
        if (byAuth.data) userProfile = byAuth.data;
        else if (user.email) {
          const byEmail = await supabase
            .from('users')
            .select('id, full_name, email')
            .eq('email', user.email)
            .maybeSingle();
          if (byEmail.data) userProfile = byEmail.data;
        }
        if (userProfile) {
          setCurrentUserId(userProfile.id);
          setCurrentUserName(userProfile.full_name || userProfile.email || user.email || 'Unknown');
        }
      } catch (error) {
        if (INFOTAB_DEBUG) console.warn('InfoTab: error fetching user info', error);
      }
    }
    fetchUserInfo();
  }, []);

  // Resolve user id (cached in ref so switching clients only re-fetches follow_ups; single .or() query)
  const resolveUserIdForFollowup = async (): Promise<string | null> => {
    if (currentUserId) {
      cachedUserIdRef.current = currentUserId;
      return currentUserId;
    }
    if (cachedUserIdRef.current) return cachedUserIdRef.current;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return null;
    let id: string | null = null;
    const byAuth = await supabase.from('users').select('id').eq('auth_id', user.id).maybeSingle();
    if (byAuth.data?.id) id = byAuth.data.id;
    if (!id && user.email) {
      const byEmail = await supabase.from('users').select('id').eq('email', user.email).maybeSingle();
      if (byEmail.data?.id) id = byEmail.data.id;
    }
    if (id) cachedUserIdRef.current = id;
    return id;
  };

  // Fetch current user's follow-up from follow_ups table only (user resolved inline to avoid waiting)
  useEffect(() => {
    if (!client?.id) {
      setCurrentUserFollowup(null);
      setCurrentUserFollowupNotes(null);
      setFollowupId(null);
      setIsFollowupLoading(false);
      return;
    }

    let cancelled = false;
    setIsFollowupLoading(true);

    const fetchUserFollowup = async () => {
      const setFollowup = (id: number | null, dateStr: string | null) => {
        if (!cancelled) {
          setFollowupId(id);
          setCurrentUserFollowup(dateStr);
        }
      };

      try {
        const userId = await resolveUserIdForFollowup();
        if (cancelled) return;

        const legacy = isLegacyLead(client);
        const legacyIdRaw = client.id.toString().replace('legacy_', '');
        const legacyIdNum = /^\d+$/.test(legacyIdRaw) ? parseInt(legacyIdRaw, 10) : null;

        let data: { id: number; date: string } | null = null;
        let error: any = null;

        if (userId) {
          if (legacy && legacyIdNum != null) {
            const res = await supabase
              .from('follow_ups')
              .select('id, date')
              .eq('lead_id', legacyIdNum)
              .eq('user_id', userId)
              .order('date', { ascending: false })
              .limit(1);
            error = res.error;
            data = res.data?.[0] ?? null;
          } else if (!legacy) {
            const res = await supabase
              .from('follow_ups')
              .select('id, date')
              .eq('new_lead_id', client.id)
              .eq('user_id', userId)
              .order('date', { ascending: false })
              .limit(1);
            error = res.error;
            data = res.data?.[0] ?? null;
          }
        }

        if (!data && !error && userId) {
          if (legacy && legacyIdNum != null) {
            const res = await supabase
              .from('follow_ups')
              .select('id, date, user_id')
              .eq('lead_id', legacyIdNum)
              .order('date', { ascending: false })
              .limit(20);
            if (!res.error && res.data?.length) {
              const forUser = res.data.find((r: any) => r.user_id === userId);
              if (forUser) data = { id: forUser.id, date: forUser.date };
            }
          } else if (!legacy) {
            const res = await supabase
              .from('follow_ups')
              .select('id, date, user_id')
              .eq('new_lead_id', client.id)
              .order('date', { ascending: false })
              .limit(20);
            if (!res.error && res.data?.length) {
              const forUser = res.data.find((r: any) => r.user_id === userId);
              if (forUser) data = { id: forUser.id, date: forUser.date };
            }
          }
        }

        if (cancelled) return;
        if (error && error.code !== 'PGRST116') {
          if (INFOTAB_DEBUG) console.warn('InfoTab follow-up fetch:', error);
          setFollowup(null, null);
          return;
        }

        if (data) {
          const dateStr = data.date ? new Date(data.date).toISOString().split('T')[0] : null;
          setFollowup(data.id, dateStr);
        } else {
          setFollowup(null, null);
        }
      } catch (err) {
        if (!cancelled && INFOTAB_DEBUG) console.warn('Error fetching user follow-up:', err);
        if (!cancelled) {
          setCurrentUserFollowup(null);
          setCurrentUserFollowupNotes(null);
          setFollowupId(null);
        }
      } finally {
        if (!cancelled) setIsFollowupLoading(false);
      }
    };

    fetchUserFollowup();
    return () => { cancelled = true; };
  }, [client?.id]);

  const applyLeadFieldFlag = async (
    fieldKey: 'expert_notes' | 'handler_notes',
    flagTypeId: number = FLAG_TYPE_PROBABILITY
  ): Promise<boolean> => {
    if (!publicUserId) {
      toast.error('Please sign in to flag.');
      return false;
    }
    if (leadFieldFlagMeta.has(fieldKey)) {
      toast.success('Already flagged.');
      return true;
    }
    if (isLegacy && legacyLeadNumericId != null && !Number.isNaN(legacyLeadNumericId)) {
      const { error } = await setLegacyLeadFieldFlagged(
        supabase,
        publicUserId,
        legacyLeadNumericId,
        fieldKey,
        true,
        flagTypeId
      );
      if (error) {
        toast.error(error.message);
        return false;
      }
    } else if (newLeadUuidForFlags) {
      const { error } = await setLeadFieldFlagged(
        supabase,
        publicUserId,
        newLeadUuidForFlags,
        fieldKey,
        true,
        flagTypeId
      );
      if (error) {
        toast.error(error.message);
        return false;
      }
    } else {
      toast.error('Unable to save flag for this lead.');
      return false;
    }
    setLeadFieldFlagMeta((prev) => {
      const next = new Map(prev);
      next.set(fieldKey, { createdAt: new Date().toISOString(), flagTypeId });
      return next;
    });
    toast.success('Flag saved.');
    return true;
  };

  const highProbGateAlreadySatisfied = (): boolean =>
    leadFieldFlagMeta.has('expert_notes') ||
    leadFieldFlagMeta.has('handler_notes') ||
    (flaggedConversationCount ?? 0) > 0;

  const performProbabilitySave = async (values: ProbabilitySlidersValues) => {
    const L = clampProbabilityPart(values.legal);
    const S = clampProbabilityPart(values.seriousness);
    const F = clampProbabilityPart(values.financial);
    const prob = caseProbabilityFromFactors(L, S, F);

    setProbabilitySaving(true);
    try {
      const tableName = isLegacy ? 'leads_lead' : 'leads';
      const clientId = isLegacy ? client.id.toString().replace('legacy_', '') : client.id;

      const updatePayload = isLegacy
        ? {
            legal_potential: String(L),
            seriousness: S,
            financial_ability: F,
            probability: prob,
          }
        : {
            legal_potential: L,
            seriousness: S,
            financial_ability: F,
            probability: prob,
          };

      const { error } = await supabase.from(tableName).update(updatePayload).eq('id', clientId);

      if (error) throw error;

      clearPendingProbSession(client);

      setProbFactorLegal(L);
      setProbFactorSeriousness(S);
      setProbFactorFinancial(F);
      setProbability(prob);
      setProbabilityModalOpen(false);
      setHighProbGateOpen(false);
      setPendingProbabilityValues(null);

      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error) {
      console.error('Error updating case probability:', error);
      alert('Failed to update case probability');
    } finally {
      setProbabilitySaving(false);
    }
  };

  const handleProbabilitySave = async (values: ProbabilitySlidersValues) => {
    if (readOnly) return;
    const L = clampProbabilityPart(values.legal);
    const S = clampProbabilityPart(values.seriousness);
    const F = clampProbabilityPart(values.financial);
    const prob = caseProbabilityFromFactors(L, S, F);

    if (prob >= 90 && !highProbGateAlreadySatisfied()) {
      setPendingProbabilityValues(values);
      setHighProbGateOpen(true);
      return;
    }

    await performProbabilitySave(values);
  };

  const resolveHighProbGate = async (choice: 'expert_notes' | 'handler_notes' | 'conversation') => {
    if (!pendingProbabilityValues) return;
    const values = pendingProbabilityValues;

    if (choice === 'conversation') {
      setPendingProbabilityValues(null);
      setHighProbGateOpen(false);
      setProbabilityModalOpen(false);
      if (onProbabilityConversationPending) {
        onProbabilityConversationPending(values);
      } else {
        writePendingProbSession(client, values);
        onSwitchClientTab?.('interactions');
      }
      toast.success('Flag a message on the timeline — your probability will save automatically.');
      return;
    }

    const ok = await applyLeadFieldFlag(choice);
    if (!ok) return;

    await performProbabilitySave(values);
    setPendingProbabilityValues(null);
  };

  const handleFlagChooserChoice = async (
    choice: 'expert_notes' | 'handler_notes' | 'conversation'
  ) => {
    if (choice === 'conversation') {
      setFlagChooserOpen(false);
      setProbabilityModalOpen(false);
      onSwitchClientTab?.('interactions');
      toast.success('Use the flag on a message in Interactions.');
      return;
    }
    await applyLeadFieldFlag(choice);
    setFlagChooserOpen(false);
  };

  const handleEligibleToggle = async (newEligible: boolean) => {
    setIsTogglingEligible(true);

    try {
      console.log('🔍 handleEligibleToggle - Starting:', {
        isLegacy,
        clientId: client.id,
        newEligible,
        currentEligible: eligible
      });

      // Optimistically update the UI first
      setEligible(newEligible);

      const tableName = isLegacy ? 'leads_lead' : 'leads';
      const idField = isLegacy ? 'id' : 'id';

      // Extract legacy ID - use string format like handleProbabilityChange does
      const clientId = isLegacy ? client.id.toString().replace('legacy_', '') : client.id;

      console.log('🔍 handleEligibleToggle - Extracted ID:', {
        original: client.id,
        extracted: clientId,
        type: typeof clientId
      });

      // For legacy leads, convert boolean to 'true'/'false' strings (TEXT column)
      // For new leads, use boolean
      const updateData = isLegacy
        ? { eligibile: (newEligible ? 'true' : 'false') }
        : { eligible: newEligible };

      console.log('🔍 handleEligibleToggle - Update query:', {
        tableName,
        idField,
        clientId,
        updateData
      });

      // Try with string ID first (like handleProbabilityChange)
      let result = await supabase
        .from(tableName)
        .update(updateData)
        .eq(idField, clientId)
        .select();

      // If that fails and it's a legacy lead, try with number format
      if (result.error && isLegacy) {
        console.log('⚠️ handleEligibleToggle - String ID failed, trying number format');
        const numericId = parseInt(clientId, 10);
        result = await supabase
          .from(tableName)
          .update(updateData)
          .eq(idField, numericId)
          .select();
      }

      console.log('🔍 handleEligibleToggle - Update result:', { data: result.data, error: result.error });

      if (result.error) {
        console.error('❌ Error updating eligible status:', result.error);
        // Revert optimistic update on error
        setEligible(!newEligible);
        alert(`Failed to update eligible status: ${result.error.message || result.error.code || 'Unknown error'}`);
        return;
      }

      if (!result.data || result.data.length === 0) {
        console.warn('⚠️ handleEligibleToggle - No rows updated');
        // Revert optimistic update
        setEligible(!newEligible);
        alert('No rows were updated. Please check the lead ID.');
        return;
      }

      console.log('✅ handleEligibleToggle - Successfully updated:', result.data);

      // Refresh client data in parent component
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error: any) {
      console.error('❌ Error updating eligible status:', error);
      // Revert optimistic update on error
      setEligible(!newEligible);
      alert(`Failed to update eligible status: ${error?.message || 'Unknown error'}`);
    } finally {
      // Allow useEffect to sync state after a short delay
      setTimeout(() => {
        setIsTogglingEligible(false);
      }, 500);
    }
  };

  const handleAddFollowup = async () => {
    if (!followupDate) {
      alert('Please select a follow-up date');
      return;
    }

    if (!currentUserId) {
      alert('User not authenticated');
      return;
    }

    try {
      const insertData: any = {
        user_id: currentUserId,
        date: followupDate + 'T00:00:00Z', // Convert to timestamp format
        created_at: new Date().toISOString()
      };

      if (isLegacy) {
        const legacyIdRaw = client.id.toString().replace('legacy_', '');
        const legacyIdNum = /^\d+$/.test(legacyIdRaw) ? parseInt(legacyIdRaw, 10) : NaN;
        if (Number.isNaN(legacyIdNum)) {
          alert('Invalid legacy lead id');
          return;
        }
        insertData.lead_id = legacyIdNum;
        insertData.new_lead_id = null;
      } else {
        insertData.new_lead_id = client.id;
        insertData.lead_id = null;
      }

      const { data, error } = await supabase
        .from('follow_ups')
        .insert(insertData)
        .select('id')
        .single();

      if (error) throw error;

      // Update local state
      if (data) {
        setFollowupId(data.id);
        setCurrentUserFollowup(followupDate);
      }

      setIsAddingFollowup(false);
      setIsEditingFollowup(false);
      setFollowupDate('');

      // Refresh client data in parent component
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error) {
      console.error('Error adding follow-up:', error);
      alert('Failed to add follow-up date');
    }
  };

  const resolveCurrentUserIdAsync = async (): Promise<string | null> => {
    if (currentUserId) return currentUserId;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return null;
    const byAuth = await supabase.from('users').select('id').eq('auth_id', user.id).maybeSingle();
    if (byAuth.data?.id) return byAuth.data.id;
    if (user.email) {
      const byEmail = await supabase.from('users').select('id').eq('email', user.email).maybeSingle();
      if (byEmail.data?.id) return byEmail.data.id;
    }
    return null;
  };

  const resolveFollowupId = async (userIdOverride?: string | null): Promise<number | null> => {
    if (followupId != null) return followupId;
    const userId = userIdOverride ?? await resolveCurrentUserIdAsync();
    if (!userId || !client?.id) return null;
    const legacy = isLegacyLead(client);
    const legacyIdNum = legacy ? (() => {
      const raw = client.id.toString().replace('legacy_', '');
      return /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
    })() : null;
    if (legacy && legacyIdNum != null) {
      const res = await supabase
        .from('follow_ups')
        .select('id')
        .eq('lead_id', legacyIdNum)
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();
      const id = res.data?.id;
      if (id != null) setFollowupId(id);
      return id ?? null;
    }
    if (!legacy) {
      const res = await supabase
        .from('follow_ups')
        .select('id')
        .eq('new_lead_id', client.id)
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();
      const id = res.data?.id;
      if (id != null) setFollowupId(id);
      return id ?? null;
    }
    return null;
  };

  const handleUpdateFollowup = async () => {
    if (!followupDate) {
      alert('Please select a follow-up date');
      return;
    }

    const userId = await resolveCurrentUserIdAsync();
    if (!userId) {
      alert('User not authenticated');
      return;
    }

    const idToUse = await resolveFollowupId(userId);
    if (idToUse == null) {
      alert('Follow-up not found or user not authenticated');
      return;
    }

    try {
      const { error } = await supabase
        .from('follow_ups')
        .update({
          date: followupDate + 'T00:00:00Z'
        })
        .eq('id', idToUse)
        .eq('user_id', userId);

      if (error) throw error;

      setCurrentUserFollowup(followupDate);
      setIsEditingFollowup(false);
      setFollowupDate('');

      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error) {
      console.error('Error updating follow-up:', error);
      alert('Failed to update follow-up date');
    }
  };

  const handleDeleteFollowup = async () => {
    if (!window.confirm('Are you sure you want to delete this follow-up?')) {
      return;
    }

    const userId = await resolveCurrentUserIdAsync();
    if (!userId) {
      alert('User not authenticated');
      return;
    }

    const idToUse = await resolveFollowupId(userId);
    if (idToUse == null) {
      alert('Follow-up not found or user not authenticated');
      return;
    }

    try {
      const { error } = await supabase
        .from('follow_ups')
        .delete()
        .eq('id', idToUse)
        .eq('user_id', userId);

      if (error) throw error;

      // Update local state
      setFollowupId(null);
      setCurrentUserFollowup(null);
      setCurrentUserFollowupNotes(null);
      setIsEditingFollowup(false);
      setFollowupDate('');

      // Refresh client data in parent component
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error) {
      console.error('Error deleting follow-up:', error);
      alert('Failed to delete follow-up date');
    }
  };

  const handleSaveFollowupNotes = async () => {
    const normalizedNotes = (followupNotes || '').trim();

    try {
      if (isLegacy) {
        const legacyId = client.id.toString().replace('legacy_', '');
        const legacyIdNum = parseInt(legacyId, 10);
        if (Number.isNaN(legacyIdNum)) {
          alert('Invalid legacy lead id');
          return;
        }

        const { error } = await supabase
          .from('leads_lead')
          .update({ followup_log: normalizedNotes || null })
          .eq('id', legacyIdNum);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('leads')
          .update({ followup_log: normalizedNotes || null })
          .eq('id', client.id);
        if (error) throw error;
      }

      setCurrentUserFollowupNotes(normalizedNotes || null);
      setIsEditingFollowupNotes(false);
      setFollowupNotes('');
      if (onClientUpdate) await onClientUpdate();
    } catch (error) {
      console.error('Error saving follow-up notes:', error);
      alert('Failed to save follow-up notes');
    }
  };

  const saveFileIdEdits = async () => {
    try {
      const tableName = isLegacy ? 'leads_lead' : 'leads';
      const raw = (editedFileId || '').trim();
      const valueToSave = raw === '' || raw === '0000' ? null : raw;
      if (isLegacy) {
        const legacyIdStr = client.id.toString().replace('legacy_', '');
        const legacyId = parseInt(legacyIdStr, 10);
        if (isNaN(legacyId)) {
          console.error('Invalid legacy ID:', legacyIdStr);
          throw new Error('Invalid legacy ID');
        }
        const { error } = await supabase
          .from(tableName)
          .update({ file_id: valueToSave })
          .eq('id', legacyId)
          .select('file_id')
          .single();
        if (error) throw error;
        const savedFileId = valueToSave ?? '';
        setFileId(savedFileId);
        setLegacyFileId(savedFileId);
        setIsEditingFileId(false);
      } else {
        const { error } = await supabase
          .from(tableName)
          .update({ file_id: valueToSave })
          .eq('id', client.id)
          .select('file_id')
          .single();
        if (error) throw error;
        setFileId(valueToSave ?? '');
        setIsEditingFileId(false);
      }
      if (onClientUpdate) await onClientUpdate();
    } catch (error) {
      console.error('Error updating file ID:', error);
      alert('Failed to update file ID');
    }
  };

  const saveSpecialNotesEdits = async () => {
    try {
      const userName = currentUserName;
      const tableName = isLegacy ? 'leads_lead' : 'leads';
      if (isLegacy) {
        const legacyIdStr = client.id.toString().replace('legacy_', '');
        const legacyId = parseInt(legacyIdStr, 10);
        if (isNaN(legacyId)) {
          console.error('Invalid legacy ID:', legacyIdStr);
          throw new Error('Invalid legacy ID');
        }
        const { error } = await supabase
          .from(tableName)
          .update({
            special_notes: formatNoteText(editedSpecialNotes),
            special_notes_last_edited_by: userName,
            special_notes_last_edited_at: new Date().toISOString(),
          })
          .eq('id', legacyId)
          .select('special_notes')
          .single();
        if (error) throw error;
        setSpecialNotes(formatNoteText(editedSpecialNotes).split('\n').filter((note) => note.trim() !== ''));
        setIsEditingSpecialNotes(false);
      } else {
        const { error } = await supabase
          .from(tableName)
          .update({
            special_notes: formatNoteText(editedSpecialNotes),
            special_notes_last_edited_by: userName,
            special_notes_last_edited_at: new Date().toISOString(),
          })
          .eq('id', client.id)
          .select('special_notes')
          .single();
        if (error) throw error;
        setSpecialNotes(formatNoteText(editedSpecialNotes).split('\n').filter((note) => note.trim() !== ''));
        setIsEditingSpecialNotes(false);
      }
      if (onClientUpdate) await onClientUpdate();
    } catch (error) {
      console.error('Error updating special notes:', error);
      alert('Failed to update special notes');
    }
  };

  const saveGeneralNotesEdits = async () => {
    try {
      const userName = currentUserName;
      const tableName = isLegacy ? 'leads_lead' : 'leads';
      if (isLegacy) {
        const legacyIdStr = client.id.toString().replace('legacy_', '');
        const legacyId = parseInt(legacyIdStr, 10);
        if (isNaN(legacyId)) {
          console.error('Invalid legacy ID:', legacyIdStr);
          throw new Error('Invalid legacy ID');
        }
        const { error } = await supabase
          .from(tableName)
          .update({
            notes: formatNoteText(editedGeneralNotes),
            notes_last_edited_by: userName,
            notes_last_edited_at: new Date().toISOString(),
          })
          .eq('id', legacyId)
          .select('notes')
          .single();
        if (error) throw error;
        setGeneralNotes(formatNoteText(editedGeneralNotes));
        setIsEditingGeneralNotes(false);
      } else {
        const { error } = await supabase
          .from(tableName)
          .update({
            general_notes: formatNoteText(editedGeneralNotes),
            general_notes_last_edited_by: userName,
            general_notes_last_edited_at: new Date().toISOString(),
          })
          .eq('id', client.id)
          .select('general_notes')
          .single();
        if (error) throw error;
        setGeneralNotes(formatNoteText(editedGeneralNotes));
        setIsEditingGeneralNotes(false);
      }
      if (onClientUpdate) await onClientUpdate();
    } catch (error) {
      console.error('Error updating general notes:', error);
      alert('Failed to update general notes');
    }
  };

  const saveFactsEdits = async () => {
    try {
      const userName = currentUserName;
      const tableName = isLegacy ? 'leads_lead' : 'leads';
      const formattedFacts = formatNoteText(editedFacts);
      if (isLegacy) {
        const legacyIdStr = client.id.toString().replace('legacy_', '');
        const legacyId = parseInt(legacyIdStr, 10);
        if (isNaN(legacyId)) {
          console.error('Invalid legacy ID:', legacyIdStr);
          throw new Error('Invalid legacy ID');
        }
        const { error } = await supabase
          .from(tableName)
          .update({
            description: formattedFacts,
            description_last_edited_by: userName,
            description_last_edited_at: new Date().toISOString(),
          })
          .eq('id', legacyId)
          .select('description')
          .single();
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from(tableName)
          .update({
            facts: formattedFacts,
            facts_last_edited_by: userName,
            facts_last_edited_at: new Date().toISOString(),
          })
          .eq('id', client.id)
          .select('facts')
          .single();
        if (error) throw error;
      }
      const processedFacts = formattedFacts.replace(/n\//g, '\n');
      const factsArray = processedFacts
        .split('\n')
        .filter((fact) => fact.trim() !== '')
        .map((line) => {
          const trimmedLine = line.trim();
          return { key: 'facts', value: trimmedLine };
        });
      setFactsOfCase(factsArray);
      setIsEditingFacts(false);
      if (onClientUpdate) await onClientUpdate();
    } catch (error) {
      console.error('Error updating facts:', error);
      alert('Failed to update facts');
    }
  };

  const EditButtons = readOnly
    ? () => null
    : ({ isEditing, onEdit, onSave, onCancel, editButtonClassName, editIconClassName }: {
        isEditing: boolean;
        onEdit: () => void;
        onSave: () => void;
        onCancel: () => void;
        editButtonClassName?: string;
        editIconClassName?: string;
      }) => (
        <div className="flex gap-2">
          {isEditing ? (
            <>
              <button
                className="btn btn-circle btn-ghost btn-md"
                onClick={onSave}
              >
                <CheckIcon className="w-5 h-5 text-success" />
              </button>
              <button
                className="btn btn-circle btn-ghost btn-md"
                onClick={onCancel}
              >
                <XMarkIcon className="w-5 h-5 text-error" />
              </button>
            </>
          ) : (
            <>
              <button
                className={`${editButtonClassName} btn btn-sm`}
                onClick={onEdit}
              >
                <PencilSquareIcon className={`w-4 h-4 ${editIconClassName}`} />
              </button>
            </>
          )}
        </div>
      );

  const getEligibilityDisplay = (status: string | undefined) => {
    switch (status) {
      case 'feasible_no_check':
        return { text: 'Feasible (no check)', className: 'badge-success text-success-content' };
      case 'feasible_check':
        return { text: 'Feasible (further check)', className: 'badge-warning text-warning-content' };
      case 'not_feasible':
        return { text: 'No feasibility', className: 'badge-error text-error-content' };
      default:
        return { text: 'Not checked', className: 'badge-neutral' };
    }
  };

  const eligibilityDisplay = getEligibilityDisplay(getEligibilityStatus());

  // Follow-up status logic
  const today = new Date();
  const nextFollowupValue = getNextFollowup();
  const nextFollowupDate = nextFollowupValue ? new Date(nextFollowupValue) : null;
  let followupStatus = '';
  let followupCountdown = '';
  if (nextFollowupDate) {
    // Remove time for comparison
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const followupMidnight = new Date(nextFollowupDate.getFullYear(), nextFollowupDate.getMonth(), nextFollowupDate.getDate());
    const diffDays = Math.floor((todayMidnight.getTime() - followupMidnight.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === -1 || diffDays === 0) {
      followupStatus = 'Close to follow up';
    } else if (diffDays === 1) {
      followupStatus = 'Missed!';
    } else if (diffDays < -1) {
      followupCountdown = `Follow up in ${Math.abs(diffDays)} days`;
    }
  }

  const probabilityTone =
    probability >= 85
      ? {
          valueClass: 'text-emerald-800',
          barClass: 'bg-emerald-600',
          badgeClass: 'text-emerald-800 bg-emerald-50 border-emerald-100',
          label: 'Very high chance',
        }
      : probability >= 70
      ? {
          valueClass: 'text-emerald-700',
          barClass: 'bg-emerald-500',
          badgeClass: 'text-emerald-700 bg-emerald-50 border-emerald-100',
          label: 'High chance',
        }
      : probability >= 40
        ? {
            valueClass: 'text-amber-700',
            barClass: 'bg-amber-500',
            badgeClass: 'text-amber-700 bg-amber-50 border-amber-100',
            label: 'Moderate chance',
          }
        : {
            valueClass: 'text-rose-700',
            barClass: 'bg-rose-500',
            badgeClass: 'text-rose-700 bg-rose-50 border-rose-100',
            label: 'Low chance',
          };

  const pendingProbStored = readPendingProbSession(client);
  const probabilityModalInitialLegal = pendingProbStored?.legal ?? probFactorLegal;
  const probabilityModalInitialSeriousness = pendingProbStored?.seriousness ?? probFactorSeriousness;
  const probabilityModalInitialFinancial = pendingProbStored?.financial ?? probFactorFinancial;

  return (
    <div className="p-2 sm:p-4 md:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
          <InformationCircleIcon className="w-5 h-5 text-gray-600" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold">Client Information</h2>
          </div>
          <p className="text-sm text-gray-500">View and manage client details and case information</p>
        </div>
      </div>

      {/* Main Info Grid */}
      <div className="space-y-8">
        <div className="space-y-1 mb-4">
          <h3 className="text-xs font-semibold tracking-wide text-gray-500 uppercase">Overview</h3>
          <div className="h-px w-full bg-gradient-to-r from-transparent via-gray-300/45 to-transparent" />
        </div>
        {/* Overview: row 1 = Case Probability + Follow-up; row 2 = Eligibility + File ID */}
        <div className="mb-10 flex flex-col gap-10 lg:mb-16 lg:gap-14">
          <div className="flex flex-col divide-y divide-gray-200/50 lg:flex-row lg:divide-x lg:divide-y-0 lg:items-stretch">
          {/* Case Probability */}
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="px-0 sm:px-1 pt-2 pb-8 lg:py-2 lg:pr-6 lg:pb-6 space-y-5">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-lg font-semibold text-black">Case Probability</h4>
                {!readOnly && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm rounded-md text-gray-500 hover:text-gray-900"
                    onClick={() => setProbabilityModalOpen(true)}
                    disabled={!probFactorsLoaded}
                    aria-label="Edit case probability"
                  >
                    <PencilSquareIcon className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="space-y-3">
                {!probFactorsLoaded ? (
                  <div className="flex justify-center py-4">
                    <span className="loading loading-spinner loading-sm text-primary align-middle" />
                  </div>
                ) : (
                  <>
                    <div className="text-center space-y-1">
                      <span className={`text-5xl font-extrabold leading-none ${probabilityTone.valueClass}`}>
                        {probability}%
                      </span>
                      <p className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${probabilityTone.badgeClass}`}>
                        {probabilityTone.label}
                      </p>
                    </div>
                    <div className="h-3 w-full rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${probabilityTone.barClass} transition-all duration-300`}
                        style={{ width: `${Math.max(0, Math.min(100, probability))}%` }}
                      />
                    </div>
                  </>
                )}
              </div>

              {!probFactorsLoaded ? (
                <p className="text-xs text-gray-400">Loading breakdown...</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between py-1.5">
                    <p className="text-sm font-normal text-gray-500 flex items-center gap-2">
                      <ScaleIcon className="w-4 h-4 text-gray-400" />
                      Legal
                    </p>
                    <p className="text-sm font-bold text-gray-900">{probabilityLevelLabel(probFactorLegal)}</p>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <p className="text-sm font-normal text-gray-500 flex items-center gap-2">
                      <ExclamationTriangleIcon className="w-4 h-4 text-gray-400" />
                      Seriousness
                    </p>
                    <p className="text-sm font-bold text-gray-900">{probabilityLevelLabel(probFactorSeriousness)}</p>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <p className="text-sm font-normal text-gray-500 flex items-center gap-2">
                      <BanknotesIcon className="w-4 h-4 text-gray-400" />
                      Financial ability
                    </p>
                    <p className="text-sm font-bold text-gray-900">{probabilityLevelLabel(probFactorFinancial)}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Followup */}
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="px-0 sm:px-1 pt-2 pb-8 lg:py-2 lg:px-6 lg:pb-6 space-y-5">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-lg font-semibold text-gray-900">Follow-up Status</h4>
                {isFollowupLoading ? (
                  <span className="text-xs text-gray-400">Loading...</span>
                ) : null}
              </div>

              {isFollowupLoading ? (
                <div className="flex items-center justify-center py-6 gap-2">
                  <span className="loading loading-spinner loading-sm text-primary"></span>
                  <span className="text-sm text-gray-500">Loading follow-up...</span>
                </div>
              ) : nextFollowupDate && !isEditingFollowup ? (
                <div className="space-y-5">
                  <div className="space-y-1">
                    <p className="text-sm text-gray-500">Next Follow-up</p>
                    <p className="text-base font-semibold text-gray-900">{nextFollowupDate.toLocaleDateString()}</p>
                  </div>

                  <div className="pt-4 space-y-2">
                    <div className="h-px w-full bg-gradient-to-r from-transparent via-gray-300/40 to-transparent mb-4" aria-hidden />
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-gray-500">Notes</p>
                      {!readOnly && (
                        <button
                          className="btn btn-ghost btn-sm btn-square rounded-md text-gray-600 hover:text-gray-900"
                          onClick={() => {
                            setFollowupNotes(currentUserFollowupNotes || '');
                            setIsEditingFollowupNotes(true);
                          }}
                          aria-label="Edit follow-up notes"
                        >
                          <PencilSquareIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">
                      {currentUserFollowupNotes && currentUserFollowupNotes.trim().length > 0
                        ? currentUserFollowupNotes
                        : 'No notes yet'}
                    </p>
                  </div>

                  {!readOnly && (
                    <div className="flex gap-2 justify-end">
                      <button
                        className="btn btn-primary btn-sm rounded-md px-3"
                        onClick={() => {
                          setIsEditingFollowup(true);
                          setFollowupDate(nextFollowupDate.toISOString().split('T')[0]);
                        }}
                      >
                        <PencilSquareIcon className="w-4 h-4" />
                        Change
                      </button>
                      <button
                        className="btn btn-outline btn-sm rounded-md px-3"
                        onClick={handleDeleteFollowup}
                      >
                        <TrashIcon className="w-4 h-4" />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ) : isAddingFollowup || isEditingFollowup ? (
                <div className="space-y-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-sm text-gray-500">Select Follow-up Date</label>
                    <input
                      type="date"
                      className="input input-bordered w-full"
                      value={followupDate}
                      onChange={(e) => setFollowupDate(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      readOnly={readOnly}
                      disabled={readOnly}
                    />
                  </div>
                  {!readOnly && (
                    <div className="flex gap-2 justify-end">
                      <button
                        className="btn btn-ghost btn-sm rounded-md px-3"
                        onClick={() => {
                          setIsAddingFollowup(false);
                          setIsEditingFollowup(false);
                          setFollowupDate('');
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn btn-primary btn-sm rounded-md px-3"
                        onClick={isEditingFollowup ? handleUpdateFollowup : handleAddFollowup}
                      >
                        Save
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="space-y-1">
                    <p className="text-sm text-gray-500">Next Follow-up</p>
                    {!readOnly && (
                      <button
                        className="btn btn-primary btn-sm rounded-md mt-2 active:scale-95 transition-transform"
                        onClick={() => setIsAddingFollowup(true)}
                      >
                        <PlusIcon className="w-4 h-4" />
                        Schedule Follow-up
                      </button>
                    )}
                  </div>

                  <div className="pt-4 space-y-2">
                    <div className="h-px w-full bg-gradient-to-r from-transparent via-gray-300/40 to-transparent mb-4" aria-hidden />
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-gray-500">Notes</p>
                      {!readOnly && (
                        <button
                          className="btn btn-ghost btn-sm btn-square rounded-md text-gray-600 hover:text-gray-900"
                          onClick={() => {
                            setFollowupNotes(currentUserFollowupNotes || '');
                            setIsEditingFollowupNotes(true);
                          }}
                          aria-label="Edit follow-up notes"
                        >
                          <PencilSquareIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">
                      {currentUserFollowupNotes && currentUserFollowupNotes.trim().length > 0
                        ? currentUserFollowupNotes
                        : 'No notes yet'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
          </div>

          <div className="flex flex-col divide-y divide-gray-200/50 border-t border-gray-200/50 pt-10 lg:flex-row lg:divide-x lg:divide-y-0 lg:items-stretch lg:pt-14">
          {/* Eligibility */}
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="space-y-5 px-0 pb-8 pt-2 sm:px-1 lg:pb-6 lg:pl-0 lg:pr-6 lg:pt-2">
              <h4 className="text-lg font-semibold text-gray-900">Eligibility Status</h4>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3 py-1">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${eligibilityDisplay.text === 'Not checked' ? 'bg-gray-300' : 'bg-emerald-500'}`} />
                    <span className="text-sm text-gray-600">Status</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">
                    {eligibilityDisplay.text === 'Not checked' ? 'Not checked yet' : eligibilityDisplay.text}
                  </span>
                </div>

                <div>
                  <div className="h-px w-full bg-gradient-to-r from-transparent via-gray-300/40 to-transparent mb-3" aria-hidden />
                  <div className="flex items-center justify-between gap-3 py-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${eligibilityDisplay.text === 'Not checked' ? 'bg-gray-300' : 'bg-emerald-500'}`} />
                      <span className="text-sm text-gray-600">Expert Review</span>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">
                      {eligibilityDisplay.text === 'Not checked' ? 'Not completed' : 'Completed'}
                    </span>
                  </div>
                </div>

                <div>
                  <div className="h-px w-full bg-gradient-to-r from-transparent via-gray-300/40 to-transparent mb-3" aria-hidden />
                  <div className="flex items-center justify-between gap-3 py-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${eligible ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                      <span className="text-sm text-gray-600">Eligibility Decided</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        className="toggle toggle-success"
                        checked={eligible}
                        onChange={readOnly ? undefined : (e) => handleEligibleToggle(e.target.checked)}
                        disabled={readOnly}
                      />
                      <span className="text-sm font-medium text-gray-700">
                        {eligible ? 'Yes' : 'Not determined'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {(() => {
                const currentSection = isLegacy ? sectionEligibility : (client.section_eligibility ?? '');
                if (['feasible_no_check', 'feasible_check'].includes(getEligibilityStatus() ?? '') && currentSection) {
                  const sections = [
                    { value: '116', label: 'German Citizenship - § 116' },
                    { value: '15', label: 'German Citizenship - § 15' },
                    { value: '5', label: 'German Citizenship - § 5' },
                    { value: '58c', label: 'Austrian Citizenship - § 58c' },
                  ];
                  const found = sections.find(s => s.value === currentSection);
                  return (
                    <div className="mt-4 pt-4">
                      <div className="h-px w-full bg-gradient-to-r from-transparent via-gray-300/40 to-transparent mb-4" aria-hidden />
                      <p className="text-xs text-gray-500">
                        Section: <span className="font-semibold text-gray-700">{found ? found.label.split(' - ')[1] : currentSection}</span>
                      </p>
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          </div>

          {/* File ID — same row as Eligibility; grey panel fills column */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col self-stretch overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col px-0 pb-8 pt-2 sm:px-1 lg:pb-6 lg:pl-6 lg:pr-0 lg:pt-2">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-gray-200 bg-gray-50 p-4 shadow-sm dark:border-gray-600 dark:bg-gray-800/90">
                <div className="flex min-h-0 flex-1 flex-col gap-5">
                  <div className="flex shrink-0 items-center justify-between gap-1">
                    <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">File ID</h4>
                    {useMobileEditModal && isEditingFileId ? (
                      <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Editing...</span>
                    ) : (
                      <EditButtons
                        isEditing={isEditingFileId && !useMobileEditModal}
                        onEdit={() => {
                          setIsEditingFileId(true);
                          setEditedFileId(fileId);
                        }}
                        onSave={saveFileIdEdits}
                        onCancel={() => setIsEditingFileId(false)}
                        editButtonClassName="btn btn-ghost btn-sm rounded-md hover:bg-gray-200/80 dark:hover:bg-gray-700/80 active:scale-95 transition-transform"
                        editIconClassName="w-4 h-4 text-gray-500 dark:text-gray-400"
                      />
                    )}
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col">
                    {isEditingFileId && !useMobileEditModal ? (
                      <input
                        type="text"
                        className="input input-bordered input-sm w-full max-w-full border-gray-200 bg-white text-gray-900 placeholder:text-gray-500 dark:border-gray-600 dark:bg-gray-900/50"
                        value={editedFileId}
                        onChange={(e) => setEditedFileId(e.target.value)}
                        placeholder="Enter file ID..."
                      />
                    ) : fileId ? (
                      <div className="flex min-h-0 flex-1 flex-col gap-3">
                        <div className="flex flex-col gap-2">
                          <p className="text-sm font-bold text-gray-900 break-all leading-snug dark:text-gray-100">{fileId}</p>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs rounded-md self-start gap-1 border border-gray-400/80 bg-gray-300/50 text-gray-800 hover:bg-gray-300 dark:border-gray-500 dark:bg-gray-700/50 dark:text-gray-100 dark:hover:bg-gray-600"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(fileId);
                              } catch {
                                // no-op
                              }
                            }}
                          >
                            Copy
                          </button>
                        </div>
                        <p className="text-[11px] text-gray-600 leading-tight dark:text-gray-400">Linked to this case.</p>
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <div className="space-y-1">
                          <p className="text-sm text-gray-500 dark:text-gray-400">No file ID yet</p>
                          {!readOnly && (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm rounded-md mt-2 active:scale-95 transition-transform"
                              onClick={() => {
                                setIsEditingFileId(true);
                                setEditedFileId(fileId);
                              }}
                            >
                              <PlusIcon className="h-4 w-4" />
                              Add File ID
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
          </div>
        </div>

        <div className="!mt-20 md:!mt-24 mb-4 space-y-1">
          <h3 className="text-xs font-semibold tracking-wide text-gray-500 uppercase">Case Details</h3>
          <div className="h-px w-full bg-gradient-to-r from-transparent via-gray-300/45 to-transparent" />
        </div>

        {/* Row 2: Special Notes and General Notes */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Special Notes */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-all duration-200">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-base font-semibold text-gray-900">Special Notes</h4>
                {useMobileEditModal && isEditingSpecialNotes ? (
                  <span className="text-xs text-gray-400 shrink-0">Editing…</span>
                ) : (
                  <EditButtons
                    isEditing={isEditingSpecialNotes && !useMobileEditModal}
                    onEdit={() => {
                      setIsEditingSpecialNotes(true);
                      setEditedSpecialNotes(specialNotes.map(note => formatNoteText(note)).join('\n'));
                    }}
                    onSave={saveSpecialNotesEdits}
                    onCancel={() => setIsEditingSpecialNotes(false)}
                    editButtonClassName="btn btn-ghost btn-sm rounded-md hover:bg-gray-100 active:scale-95 transition-transform"
                    editIconClassName="w-4 h-4 text-gray-400"
                  />
                )}
            </div>
            <div>
              {isEditingSpecialNotes && !useMobileEditModal ? (
                <textarea
                  dir="auto"
                  className="textarea textarea-bordered w-full h-32 text-start"
                  value={editedSpecialNotes}
                  onChange={(e) => setEditedSpecialNotes(e.target.value)}
                  placeholder="Add special notes here..."
                />
              ) : (
                <div className="space-y-3">
                  <div className="min-h-[80px]">
                    {specialNotes.length > 0 ? (
                      specialNotes.map((note, index) => (
                        <p
                          key={index}
                          dir={getTextDirection(formatNoteText(note))}
                          className="text-sm text-gray-600 leading-relaxed mb-2 last:mb-0 whitespace-pre-wrap break-words text-start"
                        >
                          {formatNoteText(note)}
                        </p>
                      ))
                    ) : (
                      <div className="space-y-2">
                        <span className="text-gray-500 block">No special notes added</span>
                        {!readOnly && (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm rounded-md mt-2 active:scale-95 transition-transform"
                            onClick={() => {
                              setIsEditingSpecialNotes(true);
                              setEditedSpecialNotes(specialNotes.map((note) => formatNoteText(note)).join('\n'));
                            }}
                          >
                            <PlusIcon className="w-4 h-4" />
                            Add Special Note
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {shouldShowLastEditedMeta(
                    getFieldValue(client, 'special_notes_last_edited_by'),
                    getFieldValue(client, 'special_notes_last_edited_at')
                  ) && (
                    <div className="text-xs text-gray-400 flex justify-between">
                      <span>Last edited by {getFieldValue(client, 'special_notes_last_edited_by')}</span>
                      <span>
                        Last edited at{' '}
                        {new Date(getFieldValue(client, 'special_notes_last_edited_at')).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* General Notes */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-all duration-200">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-base font-semibold text-gray-900">General Notes</h4>
                {useMobileEditModal && isEditingGeneralNotes ? (
                  <span className="text-xs text-gray-400 shrink-0">Editing…</span>
                ) : (
                  <EditButtons
                    isEditing={isEditingGeneralNotes && !useMobileEditModal}
                    onEdit={() => {
                      setIsEditingGeneralNotes(true);
                      setEditedGeneralNotes(formatNoteText(generalNotes));
                    }}
                    onSave={saveGeneralNotesEdits}
                    onCancel={() => setIsEditingGeneralNotes(false)}
                    editButtonClassName="btn btn-ghost btn-sm rounded-md hover:bg-gray-100 active:scale-95 transition-transform"
                    editIconClassName="w-4 h-4 text-gray-400"
                  />
                )}
            </div>
            <div>
              {isEditingGeneralNotes && !useMobileEditModal ? (
                <textarea
                  dir="auto"
                  className="textarea textarea-bordered w-full h-32 text-start"
                  value={editedGeneralNotes}
                  onChange={(e) => setEditedGeneralNotes(e.target.value)}
                  placeholder="Add general notes here..."
                />
              ) : (
                <div className="space-y-3">
                  <div className="min-h-[80px]">
                    {generalNotes ? (
                      <p
                        dir={getTextDirection(formatNoteText(generalNotes))}
                        className="text-gray-900 whitespace-pre-wrap break-words text-start"
                      >
                        {formatNoteText(generalNotes)}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <span className="text-gray-500 block">No notes yet</span>
                        {!readOnly && (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm rounded-md mt-2 active:scale-95 transition-transform"
                            onClick={() => {
                              setIsEditingGeneralNotes(true);
                              setEditedGeneralNotes(formatNoteText(generalNotes));
                            }}
                          >
                            <PlusIcon className="w-4 h-4" />
                            Add Note
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {shouldShowLastEditedMeta(
                    getFieldValue(client, isLegacy ? 'notes_last_edited_by' : 'general_notes_last_edited_by'),
                    getFieldValue(client, isLegacy ? 'notes_last_edited_at' : 'general_notes_last_edited_at')
                  ) && (
                    <div className="text-xs text-gray-400 flex justify-between">
                      <span>
                        Last edited by{' '}
                        {getFieldValue(client, isLegacy ? 'notes_last_edited_by' : 'general_notes_last_edited_by')}
                      </span>
                      <span>
                        Last edited at{' '}
                        {new Date(
                          getFieldValue(client, isLegacy ? 'notes_last_edited_at' : 'general_notes_last_edited_at')
                        ).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Row 4: Facts of Case and Tags */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Facts of Case */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-all duration-200">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-base font-semibold text-gray-900">Facts of Case</h4>
                {useMobileEditModal && isEditingFacts ? (
                  <span className="text-xs text-gray-400 shrink-0">Editing…</span>
                ) : (
                  <EditButtons
                    isEditing={isEditingFacts && !useMobileEditModal}
                    onEdit={() => {
                      setIsEditingFacts(true);
                      setEditedFacts(factsOfCase.map(fact => fact.value).join('\n'));
                    }}
                    onSave={saveFactsEdits}
                    onCancel={() => setIsEditingFacts(false)}
                    editButtonClassName="btn btn-ghost btn-sm rounded-md hover:bg-gray-100 active:scale-95 transition-transform"
                    editIconClassName="w-4 h-4 text-gray-400"
                  />
                )}
            </div>
            <div>
              {isEditingFacts && !useMobileEditModal ? (
                <textarea
                  dir="auto"
                  className="textarea textarea-bordered w-full h-32 text-start"
                  value={editedFacts}
                  onChange={(e) => setEditedFacts(e.target.value)}
                  placeholder="Add case facts here..."
                />
              ) : (
                <div className="space-y-3">
                  <div className="min-h-[80px]">
                    {factsOfCase.length > 0 ? (
                      (() => {
                        const processedFacts = factsOfCase
                          .map((fact) => {
                            let displayValue =
                              typeof fact.value === 'string' ? fact.value.replace(/n\//g, '\n') : String(fact.value || '');
                            displayValue = decodeUrlInText(displayValue);
                            return displayValue;
                          })
                          .join('\n');
                        // Per-line dir="auto" so English lines stay LTR and Hebrew lines RTL in the same box
                        return processedFacts.split('\n').map((line, idx) => (
                          <p
                            key={idx}
                            dir="auto"
                            className="text-gray-900 break-words text-start m-0 min-h-[1.25em]"
                          >
                            {line.length === 0 ? '\u00a0' : line}
                          </p>
                        ));
                      })()
                    ) : (
                      <div className="space-y-2">
                        <span className="text-gray-500 block">No facts recorded yet</span>
                        <p className="text-sm text-gray-500">Capture key facts to support this case.</p>
                        {!readOnly && (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm rounded-md mt-2 active:scale-95 transition-transform"
                            onClick={() => {
                              setIsEditingFacts(true);
                              setEditedFacts(factsOfCase.map(fact => fact.value).join('\n'));
                            }}
                          >
                            <PlusIcon className="w-4 h-4" />
                            Add Fact
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {shouldShowLastEditedMeta(
                    getFieldValue(client, isLegacy ? 'description_last_edited_by' : 'facts_last_edited_by'),
                    getFieldValue(client, isLegacy ? 'description_last_edited_at' : 'facts_last_edited_at')
                  ) && (
                    <div className="text-xs text-gray-400 flex justify-between">
                      <span>
                        Last edited by{' '}
                        {getFieldValue(client, isLegacy ? 'description_last_edited_by' : 'facts_last_edited_by')}
                      </span>
                      <span>
                        Last edited at{' '}
                        {new Date(
                          getFieldValue(client, isLegacy ? 'description_last_edited_at' : 'facts_last_edited_at')
                        ).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Tags moved to ClientHeader modal */}
        </div>

        {/* Row 5: Anchor - COMMENTED OUT */}
        {/* <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 gap-y-12">
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
            <div className="pl-6 pt-2 pb-2 w-2/5">
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-semibold text-black">Anchor</h4>
                <EditButtons
                  isEditing={isEditingAnchor}
                  onEdit={() => {
                    setIsEditingAnchor(true);
                    setEditedAnchor(anchor);
                  }}
                  onSave={async () => {
                    try {
                      const userName = currentUserName;
                      const tableName = isLegacy ? 'leads_lead' : 'leads';
                      const idField = isLegacy ? 'id' : 'id';
                      const clientId = isLegacy ? client.id.toString().replace('legacy_', '') : client.id;
                      
                      const { error } = await supabase
                        .from(tableName)
                        .update({
                          [isLegacy ? 'anchor_full_name' : 'anchor']: editedAnchor,
                          [isLegacy ? 'anchor_full_name_last_edited_by' : 'anchor_last_edited_by']: userName,
                          [isLegacy ? 'anchor_full_name_last_edited_at' : 'anchor_last_edited_at']: new Date().toISOString(),
                        })
                        .eq(idField, clientId);
                      
                      if (error) throw error;
                      
                      setAnchor(editedAnchor);
                      setIsEditingAnchor(false);
                      
                      if (onClientUpdate) {
                        await onClientUpdate();
                      }
                    } catch (error) {
                      console.error('Error updating anchor:', error);
                      alert('Failed to update anchor');
                    }
                  }}
                  onCancel={() => setIsEditingAnchor(false)}
                  editButtonClassName="btn btn-ghost btn-sm"
                  editIconClassName="w-5 h-5 text-black"
                />
              </div>
              <div className="border-b border-gray-200 mt-2"></div>
            </div>
            <div className="p-6">
              {isEditingAnchor ? (
                <textarea
                  className="textarea textarea-bordered w-full h-32"
                  value={editedAnchor}
                  onChange={(e) => setEditedAnchor(e.target.value)}
                  placeholder="Add anchor information..."
                />
              ) : (
                <div className="space-y-3">
                  <div className="min-h-[80px]">
                    {anchor ? (
                      <p dir={getTextDirection(anchor)} className="text-gray-900 text-start">
                        {anchor}
                      </p>
                    ) : (
                      <span className="text-gray-500">No anchor information</span>
                    )}
                  </div>
                  {(getFieldValue(client, isLegacy ? 'anchor_full_name_last_edited_by' : 'anchor_last_edited_by') || getFieldValue(client, isLegacy ? 'anchor_full_name_last_edited_at' : 'anchor_last_edited_at')) && (
                    <div className="text-xs text-gray-400 flex justify-between">
                      <span>Last edited by {getFieldValue(client, isLegacy ? 'anchor_full_name_last_edited_by' : 'anchor_last_edited_by') || 'Unknown'}</span>
                      <span>{getFieldValue(client, isLegacy ? 'anchor_full_name_last_edited_at' : 'anchor_last_edited_at') ? new Date(getFieldValue(client, isLegacy ? 'anchor_full_name_last_edited_at' : 'anchor_last_edited_at')).toLocaleString() : ''}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div> */}

        {isEditingFollowupNotes && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => {
                setIsEditingFollowupNotes(false);
                setFollowupNotes('');
              }}
              aria-hidden="true"
            />
            <div
              className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-gray-200"
              role="dialog"
              aria-modal="true"
              aria-labelledby="followup-notes-modal-title"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                <h3 id="followup-notes-modal-title" className="text-lg font-semibold text-gray-900">Edit Follow-up Notes</h3>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-circle"
                  onClick={() => {
                    setIsEditingFollowupNotes(false);
                    setFollowupNotes('');
                  }}
                  aria-label="Close follow-up notes modal"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5">
                <textarea
                  dir="auto"
                  className="textarea textarea-bordered w-full min-h-[180px] text-start"
                  value={followupNotes}
                  onChange={(e) => setFollowupNotes(e.target.value)}
                  placeholder="Add follow-up notes..."
                />
              </div>
              <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setIsEditingFollowupNotes(false);
                    setFollowupNotes('');
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleSaveFollowupNotes}
                  disabled={readOnly}
                >
                  Save Notes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Mobile (< md): full-screen editors — desktop keeps inline editing in cards */}
        {useMobileEditModal && isEditingFileId && (
          <MobileEditModal
            open
            title="File ID"
            onClose={() => setIsEditingFileId(false)}
            onSave={saveFileIdEdits}
          >
            <label className="label">
              <span className="label-text">File ID</span>
            </label>
            <input
              type="text"
              className="input input-bordered w-full"
              value={editedFileId}
              onChange={(e) => setEditedFileId(e.target.value)}
              placeholder="Enter file ID..."
            />
          </MobileEditModal>
        )}
        {useMobileEditModal && isEditingSpecialNotes && (
          <MobileEditModal
            open
            title="Special Notes"
            onClose={() => setIsEditingSpecialNotes(false)}
            onSave={saveSpecialNotesEdits}
          >
            <textarea
              dir="auto"
              className="textarea textarea-bordered w-full min-h-[240px] text-start"
              rows={10}
              value={editedSpecialNotes}
              onChange={(e) => setEditedSpecialNotes(e.target.value)}
              placeholder="Add special notes here..."
            />
          </MobileEditModal>
        )}
        {useMobileEditModal && isEditingGeneralNotes && (
          <MobileEditModal
            open
            title="General Notes"
            onClose={() => setIsEditingGeneralNotes(false)}
            onSave={saveGeneralNotesEdits}
          >
            <textarea
              dir="auto"
              className="textarea textarea-bordered w-full min-h-[240px] text-start"
              rows={10}
              value={editedGeneralNotes}
              onChange={(e) => setEditedGeneralNotes(e.target.value)}
              placeholder="Add general notes here..."
            />
          </MobileEditModal>
        )}
        {useMobileEditModal && isEditingFacts && (
          <MobileEditModal
            open
            title="Facts of Case"
            onClose={() => setIsEditingFacts(false)}
            onSave={saveFactsEdits}
          >
            <textarea
              dir="auto"
              className="textarea textarea-bordered w-full min-h-[240px] text-start"
              rows={10}
              value={editedFacts}
              onChange={(e) => setEditedFacts(e.target.value)}
              placeholder="Add case facts here..."
            />
          </MobileEditModal>
        )}
      </div>

      <ProbabilitySlidersModal
        open={probabilityModalOpen}
        onClose={() => {
          setProbabilityModalOpen(false);
          setPendingProbabilityValues(null);
          setFlagChooserOpen(false);
          setHighProbGateOpen(false);
        }}
        onSave={handleProbabilitySave}
        initialLegal={probabilityModalInitialLegal}
        initialSeriousness={probabilityModalInitialSeriousness}
        initialFinancial={probabilityModalInitialFinancial}
        saving={probabilitySaving}
        readOnly={readOnly}
        onFlagClick={readOnly ? undefined : () => setFlagChooserOpen(true)}
      />

      {flagChooserOpen &&
        createPortal(
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setFlagChooserOpen(false)}
              aria-hidden
            />
            <div
              className="relative z-[131] w-full max-w-md rounded-2xl border border-base-300 bg-base-100 p-5 shadow-2xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="info-flag-chooser-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <h3 id="info-flag-chooser-title" className="text-lg font-bold text-base-content pr-6">
                  What do you want to flag?
                </h3>
                <button
                  type="button"
                  className="btn btn-sm btn-circle btn-ghost shrink-0"
                  onClick={() => setFlagChooserOpen(false)}
                  aria-label="Close"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-base-content/70 mb-4">
                Open Interactions to flag a specific message.
              </p>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  className="btn btn-outline justify-start gap-2 border-amber-200 text-amber-900 hover:bg-amber-50"
                  onClick={() => void handleFlagChooserChoice('conversation')}
                >
                  <ChatBubbleLeftRightIcon className="h-5 w-5 shrink-0" />
                  Conversation (Interactions)
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {highProbGateOpen &&
        createPortal(
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50" aria-hidden />
            <div
              className="relative z-[131] w-full max-w-md rounded-2xl border border-base-300 bg-base-100 p-5 shadow-2xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="info-high-prob-gate-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <FlagIcon className="h-6 w-6 shrink-0 text-amber-600" />
                  <h3 id="info-high-prob-gate-title" className="text-lg font-bold text-base-content">
                    Case probability 90% or higher
                  </h3>
                </div>
              </div>
              <p className="text-sm text-base-content/80 mb-4">
                Save requires linking this rating to a flag. Open Interactions to flag a message first — then
                return to Info to save your probability (unless you already flagged a message on this lead).
              </p>
              <div className="flex flex-col gap-2 mb-4">
                <button
                  type="button"
                  className="btn btn-outline justify-start gap-2 border-2 border-[#471CCA] bg-white text-[#471CCA] hover:bg-[#471CCA]/10 hover:border-[#471CCA] dark:bg-base-100 dark:border-[#a78bfa] dark:text-[#c4b5fd] dark:hover:bg-[#471CCA]/20"
                  onClick={() => void resolveHighProbGate('conversation')}
                >
                  <ChatBubbleLeftRightIcon className="h-5 w-5 shrink-0" />
                  Open Interactions to flag a message first
                </button>
              </div>
              <button
                type="button"
                className="btn btn-outline w-full"
                onClick={() => {
                  setHighProbGateOpen(false);
                  setPendingProbabilityValues(null);
                }}
              >
                Back to adjust sliders
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default InfoTab; 