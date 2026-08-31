import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { getStageName, getStageColour, fetchStageNames } from '../lib/stageUtils';
import {
  ArrowLeftIcon,
  UserIcon,
  CurrencyDollarIcon,
  TagIcon,
  LinkIcon,
  LinkSlashIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
  DocumentTextIcon,
  PlusCircleIcon,
  MagnifyingGlassIcon
} from '@heroicons/react/24/outline';
import { createPortal } from 'react-dom';
import { toast } from 'react-hot-toast';
import { getFrontendBaseUrl } from '../lib/api';
import { usePersistedState } from '../hooks/usePersistedState';
import {
  fetchNewMasterLead,
  fetchLegacyMasterLead,
  extractNumericId,
  formatLegacyLeadNumber,
  linkLeadToChain,
  breakLinkedLeads,
  type SubLead,
  type ContractData
} from '../lib/masterLeadApi';
import { searchLeads } from '../lib/legacyLeadsApi';
import type { CombinedLead } from '../lib/legacyLeadsApi';
import DocumentModal from './DocumentModal';
import { CLIENT_HEADER_ONEDRIVE_SUBFOLDER } from '../lib/leadOneDrivePaths';
import { expandLeadCaseDocumentLeadNumbers } from '../lib/leadCaseDocumentKeys';

// Helper function to process HTML for editing with consistent styling
const processHtmlForEditing = (html: string): string => {
  if (!html) return '';

  // Replace placeholders with styled input fields and signature pads
  let processed = html
    .replace(/\{\{text\}\}/g, '<input type="text" class="inline-input" style="border: 2px solid #3b82f6; border-radius: 6px; padding: 4px 8px; margin: 0 4px; min-width: 150px; font-family: inherit; font-size: 14px; background: #ffffff; color: #374151; box-shadow: 0 1px 3px rgba(0,0,0,0.1);" placeholder="Enter text..." />')
    .replace(/\{\{sig\}\}/g, '<div class="signature-pad" style="display: inline-block; border: 2px dashed #3b82f6; border-radius: 6px; padding: 12px; margin: 0 4px; min-width: 180px; min-height: 50px; background: #f8fafc; cursor: pointer; text-align: center; font-size: 14px; color: #6b7280; font-weight: 500;">Click to sign</div>');

  return processed;
};

// Helper function to process signed contract HTML for display (replaces placeholders with filled values)
const processSignedContractHtml = (html: string, signedDate?: string): string => {
  if (!html) return '';

  let processed = html;

  // STEP 1: Extract ALL base64 signature data first (before any cleanup)
  const base64Matches: string[] = [];
  const base64Regex = /data:image\/png;base64,[A-Za-z0-9+/=]+/gi;
  let match;
  while ((match = base64Regex.exec(html)) !== null) {
    if (!base64Matches.includes(match[0])) {
      base64Matches.push(match[0]);
    }
  }

  // STEP 2: Remove ALL img tags completely (including broken ones)
  // This handles both properly formed and broken img tags
  processed = processed.replace(/<img[^>]*>/gi, '');
  // Also remove any broken img tag fragments
  processed = processed.replace(/<img[^<]*/gi, '');
  processed = processed.replace(/img[^>]*>/gi, '');
  // Remove any orphaned attributes that might look like img tags
  processed = processed.replace(/src\s*=\s*["']data:image[^"']*["'][^>]*/gi, '');
  processed = processed.replace(/alt\s*=\s*["']Signature["'][^>]*/gi, '');
  processed = processed.replace(/class\s*=\s*["']user-input["'][^>]*/gi, '');

  // STEP 3: Insert proper img tags for each base64 signature found
  base64Matches.forEach((base64Data, index) => {
    const imgTag = `<img src="${base64Data}" style="display: inline-block; vertical-align: middle; border: 2px solid #10b981; border-radius: 6px; padding: 4px; margin: 0 4px; background-color: #f0fdf4; max-width: 200px; max-height: 80px; object-fit: contain;" alt="Signature" />`;

    // Priority 1: Replace {{sig}} placeholder (this is the correct location at the bottom)
    if (processed.includes('{{sig}}')) {
      processed = processed.replace('{{sig}}', imgTag);
    } else {
      // Priority 2: Look for "חתימת הלקוח" (Client Signature) - this should be at the bottom
      const clientSigIndex = processed.search(/חתימת\s+הלקוח|Client\s+Signature/i);
      if (clientSigIndex !== -1) {
        // Find the end of the paragraph/tag containing "חתימת הלקוח" and insert after it
        // Look for the closing tag after the signature text
        let insertPos = processed.indexOf('</p>', clientSigIndex);
        if (insertPos === -1) {
          insertPos = processed.indexOf('</div>', clientSigIndex);
        }
        if (insertPos === -1) {
          insertPos = processed.indexOf('>', clientSigIndex);
          if (insertPos !== -1) insertPos += 1;
        } else {
          insertPos += 4; // Move past </p> or </div>
        }

        if (insertPos === -1 || insertPos < clientSigIndex) {
          // Fallback: insert right after the signature text
          insertPos = clientSigIndex + 20; // Approximate length of "חתימת הלקוח"
        }

        processed = processed.substring(0, insertPos) + ' ' + imgTag + processed.substring(insertPos);
      } else {
        // Priority 3: Find the LAST occurrence of "חתימת" in the document (should be at bottom)
        let lastSigIndex = -1;
        let searchIndex = 0;
        while (true) {
          const found = processed.indexOf('חתימת', searchIndex);
          if (found === -1) break;
          lastSigIndex = found;
          searchIndex = found + 1;
        }

        if (lastSigIndex !== -1) {
          // Found last occurrence - insert after the paragraph containing it
          let insertPos = processed.indexOf('</p>', lastSigIndex);
          if (insertPos === -1) {
            insertPos = processed.indexOf('</div>', lastSigIndex);
          }
          if (insertPos === -1) {
            insertPos = processed.indexOf('>', lastSigIndex);
            if (insertPos !== -1) insertPos += 1;
          } else {
            insertPos += 4;
          }

          if (insertPos === -1 || insertPos < lastSigIndex) {
            insertPos = lastSigIndex + 10;
          }

          processed = processed.substring(0, insertPos) + ' ' + imgTag + processed.substring(insertPos);
        } else {
          // Last resort: append at the very end, before any closing tags
          // Find the last </p> or </div> and insert before it
          const lastP = processed.lastIndexOf('</p>');
          const lastDiv = processed.lastIndexOf('</div>');
          const lastTag = Math.max(lastP, lastDiv);

          if (lastTag !== -1) {
            processed = processed.substring(0, lastTag) + ' ' + imgTag + processed.substring(lastTag);
          } else {
            // No closing tags found, just append at the end
            processed += ' ' + imgTag;
          }
        }
      }
    }
  });

  // Replace {{date}} placeholders with the actual signed date (if available)
  if (signedDate) {
    const formattedDate = new Date(signedDate).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    processed = processed.replace(/\{\{date\}\}/g, `<span style="display: inline-block; vertical-align: middle; border: 2px solid #10b981; border-radius: 6px; padding: 4px 8px; margin: 0 4px; min-width: 150px; background-color: #f0fdf4; color: #065f46; font-weight: bold;">${formattedDate}</span>`);
  } else {
    // If no date provided, show placeholder
    processed = processed.replace(/\{\{date\}\}/g, '<span style="display: inline-block; vertical-align: middle; border: 2px solid #10b981; border-radius: 6px; padding: 4px 8px; margin: 0 4px; min-width: 150px; background-color: #f0fdf4; color: #065f46; font-weight: bold;">_____________</span>');
  }

  // Replace {{text}} placeholders with styled filled text
  processed = processed.replace(/\{\{text\}\}/g, '<span style="display: inline-block; vertical-align: middle; border: 2px solid #10b981; border-radius: 6px; padding: 4px 8px; margin: 0 4px; min-width: 150px; background-color: #f0fdf4; color: #065f46; font-weight: bold;">_____________</span>');

  // Replace {{sig}} placeholders with signature image display (only if not already replaced by base64)
  processed = processed.replace(/\{\{sig\}\}/g, '<div style="display: inline-block; vertical-align: middle; border: 2px solid #10b981; border-radius: 6px; padding: 4px; margin: 0 4px; background-color: #f0fdf4; min-width: 200px; min-height: 80px; display: flex; align-items: center; justify-content: center;"><span style="color: #065f46; font-size: 12px;">✓ Signed</span></div>');

  return processed;
};

// Helper function for rich text editing commands
const executeCommand = (command: string, value?: string) => {
  const contentDiv = document.querySelector('[contenteditable="true"]');
  if (contentDiv) {
    (contentDiv as HTMLElement).focus();
    document.execCommand(command, false, value);
  }
};

function leadDocumentLookupKeys(subLead: SubLead): string[] {
  return expandLeadCaseDocumentLeadNumbers(
    subLead.document_lead_number,
    subLead.lead_number,
    subLead.actual_lead_id,
    subLead.manual_id,
  );
}

function canonicalDocumentLeadNumber(subLead: SubLead): string {
  const stored = String(subLead.document_lead_number || '').trim();
  if (stored) return stored;
  const displayed = String(subLead.lead_number || '').trim();
  if (subLead.isMaster) {
    const withoutSuffix = displayed.replace(/\/1$/, '');
    if (String(subLead.id || '').startsWith('legacy_')) {
      return String(subLead.actual_lead_id || '').replace(/^legacy_/, '') || withoutSuffix.replace(/^[LC]/i, '');
    }
    return withoutSuffix || displayed;
  }
  return displayed;
}

function DocumentsCountBadge({
  count,
  onClick,
  title,
}: {
  count: number;
  onClick: (event: React.MouseEvent) => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title || 'Open documents'}
      className="inline-flex h-8 min-w-[2.5rem] items-center justify-center gap-1 rounded-full bg-gray-100 px-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200"
    >
      <DocumentTextIcon className="h-4 w-4 shrink-0" />
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

function resolveMasterLeadClientId(subLead: SubLead): string {
  const id = String(subLead.id || '').trim();
  if (id.startsWith('legacy_')) return id;
  if (id.includes('-')) return id;
  if (/^\d+$/.test(id)) return `legacy_${id}`;
  return id || String(subLead.actual_lead_id || '');
}

// SubLead and ContractData are now imported from masterLeadApi

type MasterLeadEmployeeRow = {
  id: number | string;
  display_name?: string | null;
  photo_url?: string | null;
  photo?: string | null;
};

/** Survives SPA navigations so avatars paint immediately on return to this page. */
let masterLeadEmployeesCache: MasterLeadEmployeeRow[] | null = null;
let masterLeadEmployeesInflight: Promise<MasterLeadEmployeeRow[]> | null = null;

async function loadMasterLeadEmployees(forceRefresh = false): Promise<MasterLeadEmployeeRow[]> {
  if (!forceRefresh && masterLeadEmployeesCache && masterLeadEmployeesCache.length > 0) {
    return masterLeadEmployeesCache;
  }
  if (!forceRefresh && masterLeadEmployeesInflight) {
    return masterLeadEmployeesInflight;
  }

  masterLeadEmployeesInflight = (async () => {
    const { data, error } = await supabase
      .from('tenants_employee')
      .select('id, display_name, photo_url, photo')
      .order('display_name', { ascending: true });

    if (error) {
      console.error('Error fetching employees for master lead page:', error);
      return masterLeadEmployeesCache || [];
    }

    masterLeadEmployeesCache = (data || []) as MasterLeadEmployeeRow[];
    return masterLeadEmployeesCache;
  })().finally(() => {
    masterLeadEmployeesInflight = null;
  });

  return masterLeadEmployeesInflight;
}

const MasterLeadPage: React.FC = () => {
  const { lead_number } = useParams<{ lead_number: string }>();
  const navigate = useNavigate();
  const [allEmployees, setAllEmployees] = useState<MasterLeadEmployeeRow[]>(
    () => masterLeadEmployeesCache || []
  );

  // Persisted state - convert Map to/from array for serialization
  const [contractsDataArray, setContractsDataArray] = usePersistedState<Array<[string, ContractData]>>(
    'masterLeadPage_contractsData',
    [],
    { storage: 'sessionStorage' }
  );

  // Convert array to Map and vice versa
  const contractsDataMap = useMemo(() => {
    return new Map<string, ContractData>(contractsDataArray);
  }, [contractsDataArray]);

  const setContractsDataMap = (updater: (prev: Map<string, ContractData>) => Map<string, ContractData>) => {
    const newMap = updater(contractsDataMap);
    setContractsDataArray(Array.from(newMap.entries()));
  };

  const [subLeads, setSubLeads] = usePersistedState<SubLead[]>(
    'masterLeadPage_subLeads',
    [],
    { storage: 'sessionStorage' }
  );

  const [masterLeadInfo, setMasterLeadInfo] = usePersistedState<any>(
    'masterLeadPage_masterLeadInfo',
    null,
    { storage: 'sessionStorage' }
  );

  // Track the current lead number to detect changes and clear old data immediately
  const currentLeadNumberRef = useRef<string | undefined>(undefined);
  const masterLeadInfoRef = useRef(masterLeadInfo);
  const subLeadsRef = useRef(subLeads);
  const fetchInFlightRef = useRef(false);
  const lastFetchedBaseRef = useRef<string | null>(null);

  useEffect(() => {
    masterLeadInfoRef.current = masterLeadInfo;
  }, [masterLeadInfo]);
  useEffect(() => {
    subLeadsRef.current = subLeads;
  }, [subLeads]);

  const getRouteBaseLeadNumber = useCallback((raw?: string) => {
    if (!raw) return '';
    const decoded = decodeURIComponent(raw);
    const baseRaw = decoded.includes('/') ? decoded.split('/')[0] : decoded;
    return baseRaw.replace(/^[LC]/i, '');
  }, []);

  const persistedMatchesRoute = useCallback((baseLeadNumber: string, info: any, leads: SubLead[]) => {
    if (!baseLeadNumber || !info || !leads?.length) return false;
    const persistedLeadNumber = String(info.lead_number || info.id || '');
    const persistedBase = (persistedLeadNumber.includes('/') ? persistedLeadNumber.split('/')[0] : persistedLeadNumber).replace(/^[LC]/i, '');
    if (persistedBase === baseLeadNumber) return true;
    return leads.some((subLead) => {
      const subLeadNumber = String(subLead.lead_number || subLead.id || '');
      const subLeadBase = (subLeadNumber.includes('/') ? subLeadNumber.split('/')[0] : subLeadNumber).replace(/^[LC]/i, '');
      const clean = subLeadNumber.replace(/^[LC]/i, '');
      const actual = String(subLead.actual_lead_id || '').replace(/^[LC]/i, '');
      const rowId = String(subLead.id || '').replace(/^legacy_/, '');
      return subLeadBase === baseLeadNumber || clean === baseLeadNumber || actual === baseLeadNumber || rowId === baseLeadNumber;
    });
  }, []);

  // Clear persisted state immediately when lead_number changes to prevent showing old data
  useEffect(() => {
    if (!lead_number) return;

    const decodedLeadNumber = decodeURIComponent(lead_number);
    const baseLeadNumber = getRouteBaseLeadNumber(lead_number);
    const prevBaseLeadNumber = currentLeadNumberRef.current
      ? getRouteBaseLeadNumber(currentLeadNumberRef.current)
      : undefined;

    // If lead number changed, clear persisted state immediately
    if (prevBaseLeadNumber && baseLeadNumber !== prevBaseLeadNumber) {
      setSubLeads([]);
      setMasterLeadInfo(null);
      setContractsDataArray([]);
      lastFetchedBaseRef.current = null;
      setLoading(true);
      setSubLeadsLoading(true);
    }

    currentLeadNumberRef.current = decodedLeadNumber;
  }, [lead_number, getRouteBaseLeadNumber, setSubLeads, setMasterLeadInfo, setContractsDataArray]);

  // Start without a blocking loader when session cache already matches this route
  const [loading, setLoading] = useState(() => {
    if (typeof window === 'undefined' || !lead_number) return true;
    try {
      const base = (() => {
        const decoded = decodeURIComponent(lead_number);
        const baseRaw = decoded.includes('/') ? decoded.split('/')[0] : decoded;
        return baseRaw.replace(/^[LC]/i, '');
      })();
      const infoRaw = sessionStorage.getItem('persisted_state_masterLeadPage_masterLeadInfo');
      const leadsRaw = sessionStorage.getItem('persisted_state_masterLeadPage_subLeads');
      if (!infoRaw || !leadsRaw) return true;
      const info = JSON.parse(infoRaw);
      const leads = JSON.parse(leadsRaw) as SubLead[];
      if (!info || !Array.isArray(leads) || leads.length === 0) return true;
      const persistedLeadNumber = String(info.lead_number || info.id || '');
      const persistedBase = (persistedLeadNumber.includes('/') ? persistedLeadNumber.split('/')[0] : persistedLeadNumber).replace(/^[LC]/i, '');
      if (persistedBase === base) return false;
      const subMatch = leads.some((subLead) => {
        const subLeadNumber = String(subLead.lead_number || subLead.id || '');
        const subLeadBase = (subLeadNumber.includes('/') ? subLeadNumber.split('/')[0] : subLeadNumber).replace(/^[LC]/i, '');
        return subLeadBase === base || subLeadNumber.replace(/^[LC]/i, '') === base;
      });
      return !subMatch;
    } catch {
      return true;
    }
  });

  // Validate persisted data once on mount (do not force a loading flash when cache matches)
  useEffect(() => {
    if (!lead_number) {
      if (subLeads.length > 0 || masterLeadInfo) {
        setSubLeads([]);
        setMasterLeadInfo(null);
        setContractsDataArray([]);
      }
      setLoading(false);
      setSubLeadsLoading(false);
      return;
    }

    const baseLeadNumber = getRouteBaseLeadNumber(lead_number);
    if (persistedMatchesRoute(baseLeadNumber, masterLeadInfo, subLeads)) {
      setLoading(false);
      setSubLeadsLoading(false);
    } else if (masterLeadInfo || subLeads.length > 0) {
      setSubLeads([]);
      setMasterLeadInfo(null);
      setContractsDataArray([]);
      setLoading(true);
    }
  }, []); // Only run on mount
  const [subLeadsLoading, setSubLeadsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewingContract, setViewingContract] = useState<{ id: string; mode: 'view' | 'edit'; contractHtml?: string; signedContractHtml?: string; status?: string; public_token?: string; signed_at?: string } | null>(null);

  const [addLeadModalOpen, setAddLeadModalOpen] = useState(false);
  const [addLeadSearchQuery, setAddLeadSearchQuery] = useState('');
  const [addLeadSearchResults, setAddLeadSearchResults] = useState<CombinedLead[]>([]);
  const [addLeadSearching, setAddLeadSearching] = useState(false);
  const [addLeadSelected, setAddLeadSelected] = useState<CombinedLead | null>(null);
  const [addLeadConfirming, setAddLeadConfirming] = useState(false);
  const addLeadSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [breakLinkModalOpen, setBreakLinkModalOpen] = useState(false);
  const [breakLinkSelectedIds, setBreakLinkSelectedIds] = useState<Set<string>>(new Set());
  const [breakLinkConfirming, setBreakLinkConfirming] = useState(false);
  const [documentCounts, setDocumentCounts] = useState<Record<string, number>>({});
  const [documentsLead, setDocumentsLead] = useState<SubLead | null>(null);
  const [documentTabsShowAll, setDocumentTabsShowAll] = useState(false);

  // Add compact table styles
  const compactTableStyles = `
    .compact-table th,
    .compact-table td {
      padding-left: 8px !important;
      padding-right: 8px !important;
    }
    .compact-table th:first-child,
    .compact-table td:first-child {
      padding-left: 12px !important;
    }
    .compact-table th:last-child,
    .compact-table td:last-child {
      padding-right: 12px !important;
    }
  `;

  // Helper function to get contrasting text color based on background
  const getContrastingTextColor = (hexColor?: string | null) => {
    if (!hexColor) return '#ffffff';
    let sanitized = hexColor.trim();
    if (sanitized.startsWith('#')) sanitized = sanitized.slice(1);
    if (sanitized.length === 3) {
      sanitized = sanitized.split('').map(char => char + char).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(sanitized)) {
      return '#ffffff';
    }
    const r = parseInt(sanitized.slice(0, 2), 16) / 255;
    const g = parseInt(sanitized.slice(2, 4), 16) / 255;
    const b = parseInt(sanitized.slice(4, 6), 16) / 255;

    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.55 ? '#111827' : '#ffffff';
  };

  const getStageBadge = (stage?: string | number) => {
    if (!stage && stage !== 0) {
      return (
        <span className="stage-badge badge badge-md bg-gray-100 text-gray-600 text-sm px-2.5 py-1.5">
          No Stage
        </span>
      );
    }

    const stageStr = String(stage);
    const stageName = getStageName(stageStr);
    const stageColor = getStageColour(stageStr);
    const textColor = getContrastingTextColor(stageColor);

    // Use the stage color if available, otherwise use default purple
    const backgroundColor = stageColor || '#3b28c7';

    return (
      <span
        className="stage-badge badge badge-md text-sm px-2.5 py-1.5"
        style={{
          backgroundColor: backgroundColor,
          color: textColor,
          borderColor: backgroundColor,
        }}
      >
        {stageName}
      </span>
    );
  };

  const isInactiveLead = (lead: CombinedLead) => {
    if (lead.lead_type === 'legacy') {
      return lead.status === 10;
    }
    return lead.status === 'inactive' || String(lead.stage) === '91';
  };

  const getStageBadgeForSearchLead = (lead: CombinedLead) => {
    const stageStr = lead.stage != null ? String(lead.stage).trim() : '';
    const stageName = stageStr ? (/^\d+$/.test(stageStr) ? getStageName(stageStr) : stageStr) : '—';
    const useInactiveStyle = isInactiveLead(lead);
    if (useInactiveStyle) {
      return (
        <span className="stage-badge badge badge-sm px-2 py-0.5 bg-gray-300 text-black border border-gray-400">
          {stageName}
        </span>
      );
    }
    const backgroundColor =
      (lead.stage_colour && lead.stage_colour.trim()) ||
      (/^\d+$/.test(stageStr) ? getStageColour(stageStr) : '') ||
      '#3b28c7';
    const textColor = getContrastingTextColor(backgroundColor);
    return (
      <span
        className="stage-badge badge badge-sm text-xs px-2 py-0.5"
        style={{ backgroundColor, color: textColor, borderColor: backgroundColor }}
      >
        {stageName}
      </span>
    );
  };

  // Fetch employees for avatars (use in-memory cache so return visits don't flash empty)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const hadCache = !!(masterLeadEmployeesCache && masterLeadEmployeesCache.length > 0);
      if (hadCache) {
        setAllEmployees(masterLeadEmployeesCache!);
      }
      const data = await loadMasterLeadEmployees(false);
      if (!cancelled) setAllEmployees(data);
      // Soft-refresh only when we painted from cache (keeps photos current without double first-load)
      if (hadCache) {
        void loadMasterLeadEmployees(true).then((fresh) => {
          if (!cancelled) setAllEmployees(fresh);
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Helper function to get employee by ID
  const getEmployeeById = (employeeId: string | number | null | undefined) => {
    if (!employeeId || employeeId === '---' || employeeId === null || employeeId === undefined) {
      return null;
    }

    const idAsNumber = typeof employeeId === 'string' ? parseInt(employeeId, 10) : Number(employeeId);
    if (isNaN(idAsNumber)) return null;

    return (
      allEmployees.find((emp) => {
        const empId = typeof emp.id === 'bigint' ? Number(emp.id) : emp.id;
        const empIdNum = typeof empId === 'string' ? parseInt(empId, 10) : Number(empId);
        if (isNaN(empIdNum)) return false;
        return empIdNum === idAsNumber;
      }) || null
    );
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

  // Component to render employee avatar
  const EmployeeAvatar: React.FC<{
    employeeId: string | number | null | undefined;
    size?: 'sm' | 'md' | 'lg';
  }> = ({ employeeId, size = 'sm' }) => {
    const [imageError, setImageError] = useState(false);
    const employee = getEmployeeById(employeeId);
    const sizeClasses = size === 'sm' ? 'w-6 h-6 text-xs' : size === 'md' ? 'w-8 h-8 text-sm' : 'w-12 h-12 text-base';

    useEffect(() => {
      setImageError(false);
    }, [employeeId]);

    if (!employee) return null;

    const photoUrl = employee.photo_url || employee.photo;
    const initials = getEmployeeInitials(employee.display_name);

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

    return (
      <img
        src={photoUrl}
        alt={employee.display_name || ''}
        loading="eager"
        decoding="async"
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

  // Create agreement button for a lead
  const createAgreementButton = (lead: SubLead, isLegacy: boolean) => {
    // For new leads, use the lead ID directly (UUID string)
    // For legacy leads, extract the numeric ID from the lead ID (format: legacy_123)
    // The contracts map uses the numeric lead ID as the key for legacy leads
    const lookupKey = isLegacy
      ? lead.id.replace('legacy_', '')
      : lead.id;

    const contractData = contractsDataMap.get(lookupKey);
    if (contractData) {
      return (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleViewContract(contractData.id, contractData.isLegacy);
          }}
          className="text-blue-600 hover:text-blue-800 underline cursor-pointer"
        >
          View Agreement
        </button>
      );
    }
    return '---';
  };

  const fetchSubLeads = useCallback(async () => {
    if (!lead_number) return;
    if (fetchInFlightRef.current) return;

    const decodedLeadNumber = decodeURIComponent(lead_number);
    const baseLeadNumber = decodedLeadNumber.includes('/') ? decodedLeadNumber.split('/')[0] : decodedLeadNumber;
    const routeBase = getRouteBaseLeadNumber(lead_number);
    const normalizedId = extractNumericId(baseLeadNumber);

    fetchInFlightRef.current = true;
    try {
      const hasExistingData = persistedMatchesRoute(
        routeBase,
        masterLeadInfoRef.current,
        subLeadsRef.current
      );
      // Never block the page when we already have matching rows — soft-refresh only.
      if (hasExistingData) {
        setLoading(false);
        setSubLeadsLoading(true);
      } else {
        setLoading(true);
        setSubLeadsLoading(false);
      }
      setError(null);

      // Start new-leads fetch immediately; in parallel check whether legacy id is a true root master.
      let probedNewContracts: Map<string, ContractData> | null = null;
      const probeSetContracts: typeof setContractsDataMap = (updater) => {
        probedNewContracts = updater(new Map());
      };

      const legacyRootPromise =
        normalizedId && !Number.isNaN(parseInt(normalizedId, 10))
          ? supabase
              .from('leads_lead')
              .select('id, master_id')
              .eq('id', parseInt(normalizedId, 10))
              .maybeSingle()
          : Promise.resolve({ data: null as any, error: null });

      const [newLeadResult, legacyRootRes] = await Promise.all([
        fetchNewMasterLead(baseLeadNumber, probeSetContracts),
        legacyRootPromise,
      ]);

      const legacyRow = legacyRootRes?.data;
      const isLegacyRootMaster =
        !!legacyRow?.id &&
        (legacyRow.master_id == null || String(legacyRow.master_id).trim() === '');

      const newCount = newLeadResult.subLeads?.length || 0;
      const newOk = !!(newLeadResult.success && newLeadResult.masterLead);

      // Prefer the new-leads chain whenever it resolves — avoids a second heavy legacy round-trip.
      if (newOk && newCount > 0) {
        if (probedNewContracts) {
          setContractsDataMap(() => probedNewContracts as Map<string, ContractData>);
        }
        setMasterLeadInfo(newLeadResult.masterLead);
        setSubLeads(newLeadResult.subLeads || []);
        lastFetchedBaseRef.current = routeBase;
        return;
      }

      if (isLegacyRootMaster && normalizedId) {
        const legacyResult = await fetchLegacyMasterLead(baseLeadNumber, normalizedId, setContractsDataMap);
        if (legacyResult.success && legacyResult.masterLead) {
          setMasterLeadInfo(legacyResult.masterLead);
          setSubLeads(legacyResult.subLeads || []);
          lastFetchedBaseRef.current = routeBase;
          return;
        }
      }

      if (newOk) {
        if (probedNewContracts) {
          setContractsDataMap(() => probedNewContracts as Map<string, ContractData>);
        }
        setMasterLeadInfo(newLeadResult.masterLead);
        setSubLeads(newLeadResult.subLeads || []);
        lastFetchedBaseRef.current = routeBase;
        return;
      }

      if (normalizedId) {
        const legacyResult = await fetchLegacyMasterLead(baseLeadNumber, normalizedId, setContractsDataMap);
        if (legacyResult.success && legacyResult.masterLead) {
          setMasterLeadInfo(legacyResult.masterLead);
          setSubLeads(legacyResult.subLeads || []);
          lastFetchedBaseRef.current = routeBase;
          return;
        }
        setError(legacyResult.error || 'Failed to fetch master lead');
        return;
      }

      setError('Invalid master lead number');
    } catch (error) {
      console.error('Error fetching sub-leads:', error);
      setError('An unexpected error occurred while fetching data');
    } finally {
      fetchInFlightRef.current = false;
      setLoading(false);
      setSubLeadsLoading(false);
    }
  }, [
    lead_number,
    getRouteBaseLeadNumber,
    persistedMatchesRoute,
    setContractsDataMap,
    setMasterLeadInfo,
    setSubLeads,
  ]);

  // Soft refresh when returning to the tab (no full-page loader, no focus spam)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || !lead_number) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        fetchSubLeads();
      }, 250);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (timer) clearTimeout(timer);
    };
  }, [lead_number, fetchSubLeads]);

  // Track previous lead_number to detect changes
  const prevLeadNumberRef = useRef<string | undefined>(undefined);
  const hasCheckedPersistedDataRef = useRef<string | undefined>(undefined);

  // Initialize stage names cache on mount to ensure badges display correctly
  useEffect(() => {
    fetchStageNames().catch(error => {
      console.error('Error initializing stage names:', error);
    });
  }, []);

  // Update agreements when contracts change.
  // Important: avoid render loops by using a functional update and only mutating when values actually differ.
  useEffect(() => {
    if (contractsDataMap.size === 0) return;

    const masterIsLegacy =
      !!masterLeadInfo &&
      (masterLeadInfo.lead_type === 'legacy' || String(masterLeadInfo.id || '').startsWith('legacy_'));

    setSubLeads((prev) => {
      if (!prev.length) return prev;

      let changed = false;
      const next = prev.map((lead) => {
        const leadIsLegacy = String(lead.id || '').startsWith('legacy_') || masterIsLegacy;
        const lookupKey = leadIsLegacy ? String(lead.id).replace('legacy_', '') : String(lead.id);
        const contractData = contractsDataMap.get(lookupKey);

        const nextAgreement = contractData ? contractData.id : '---';
        const nextIsLegacy = contractData ? contractData.isLegacy : undefined;

        if (lead.agreement !== nextAgreement || lead.agreementIsLegacy !== nextIsLegacy) {
          changed = true;
          return { ...lead, agreement: nextAgreement, agreementIsLegacy: nextIsLegacy };
        }
        return lead;
      });

      return changed ? next : prev;
    });
  }, [contractsDataArray, masterLeadInfo, contractsDataMap.size, setSubLeads]);

  const chainMemberIds = useMemo(() => {
    const ids = new Set<string>();
    subLeads.forEach((s) => ids.add(String(s.id)));
    if (masterLeadInfo?.id != null) ids.add(String(masterLeadInfo.id));
    return ids;
  }, [subLeads, masterLeadInfo]);

  useEffect(() => {
    if (!addLeadModalOpen) return;
    if (!addLeadSearchQuery.trim()) {
      setAddLeadSearchResults([]);
      setAddLeadSearching(false);
      return;
    }
    if (addLeadSearchTimeoutRef.current) clearTimeout(addLeadSearchTimeoutRef.current);
    setAddLeadSearching(true);
    addLeadSearchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchLeads(addLeadSearchQuery.trim(), { limit: 20 });
        setAddLeadSearchResults(
          results.filter((r) => {
            const id = String(r.id);
            const legacyId = r.lead_type === 'legacy' ? `legacy_${id}` : id;
            if (chainMemberIds.has(id) || chainMemberIds.has(legacyId)) return false;
            // Exclude subleads: has master_id or (new lead) lead_number contains /
            if (r.master_id != null && r.master_id !== '') return false;
            if (r.lead_type === 'new' && (r.lead_number || '').includes('/')) return false;
            // Exclude leads already linked to a master via linked_master_lead
            if (r.linked_master_lead != null && r.linked_master_lead !== '') return false;
            return true;
          })
        );
      } catch (e) {
        setAddLeadSearchResults([]);
      } finally {
        setAddLeadSearching(false);
      }
    }, 300);
    return () => {
      if (addLeadSearchTimeoutRef.current) clearTimeout(addLeadSearchTimeoutRef.current);
    };
  }, [addLeadModalOpen, addLeadSearchQuery, chainMemberIds]);

  const handleAddLeadConfirm = useCallback(async () => {
    if (!addLeadSelected || !lead_number || !masterLeadInfo) return;
    const decodedLeadNumber = decodeURIComponent(lead_number);
    const baseLeadNumber = decodedLeadNumber.includes('/') ? decodedLeadNumber.split('/')[0] : decodedLeadNumber;
    const isLegacyChain = subLeads.some((s) => String(s.id).startsWith('legacy_'));
    if (!baseLeadNumber) return;
    setAddLeadConfirming(true);
    try {
      const leadId = addLeadSelected.lead_type === 'legacy' ? addLeadSelected.id.replace(/^legacy_/, '') : addLeadSelected.id;
      const result = await linkLeadToChain(
        addLeadSelected.lead_type === 'legacy' ? `legacy_${leadId}` : leadId,
        addLeadSelected.lead_type,
        baseLeadNumber,
        !!isLegacyChain,
        masterLeadInfo
      );
      if (result.success) {
        toast.success('Lead linked to master chain successfully');
        setAddLeadModalOpen(false);
        setAddLeadSearchQuery('');
        setAddLeadSearchResults([]);
        setAddLeadSelected(null);
        fetchSubLeads();
      } else {
        toast.error(result.error || 'Failed to add lead to chain');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add lead to chain');
    } finally {
      setAddLeadConfirming(false);
    }
  }, [addLeadSelected, lead_number, masterLeadInfo, subLeads, fetchSubLeads]);

  useEffect(() => {
    if (!lead_number) {
      setLoading(false);
      return;
    }

    const decodedLeadNumber = decodeURIComponent(lead_number);
    const routeBase = getRouteBaseLeadNumber(lead_number);
    const prevBase = prevLeadNumberRef.current
      ? getRouteBaseLeadNumber(prevLeadNumberRef.current)
      : undefined;

    if (prevLeadNumberRef.current && routeBase !== prevBase) {
      setSubLeads([]);
      setMasterLeadInfo(null);
      setContractsDataArray([]);
      lastFetchedBaseRef.current = null;
      hasCheckedPersistedDataRef.current = undefined;
      prevLeadNumberRef.current = decodedLeadNumber;
      setLoading(true);
      fetchSubLeads();
      return;
    }

    prevLeadNumberRef.current = decodedLeadNumber;

    const hasMatchingCache = persistedMatchesRoute(
      routeBase,
      masterLeadInfoRef.current,
      subLeadsRef.current
    );

    if (hasMatchingCache) {
      // Paint cached rows immediately, then soft-refresh in background.
      setLoading(false);
      hasCheckedPersistedDataRef.current = routeBase;
      if (lastFetchedBaseRef.current !== routeBase) {
        fetchSubLeads();
      }
      return;
    }

    hasCheckedPersistedDataRef.current = routeBase;
    fetchSubLeads();
  }, [lead_number, fetchSubLeads, getRouteBaseLeadNumber, persistedMatchesRoute, setSubLeads, setMasterLeadInfo, setContractsDataArray]);

  // Handle view contract - for legacy contracts opens modal, for new contracts navigates
  const handleViewContract = async (contractId: string, isLegacyContract: boolean = false) => {
    console.log('🔍 handleViewContract called with:', contractId, 'isLegacyContract:', isLegacyContract);

    // Check if this is a legacy contract (ID starts with 'legacy_' or isLegacyContract is true)
    if (isLegacyContract || contractId.startsWith('legacy_')) {
      console.log('🔍 Legacy contract detected');

      // For legacy contracts, find the contract data and display it in a modal
      const legacyContractId = contractId.startsWith('legacy_')
        ? contractId.replace('legacy_', '')
        : contractId;

      // Find the contract data in contractsDataMap by searching for the contract ID
      const contractData = Array.from(contractsDataMap.values()).find((value) =>
        value.isLegacy && (value.id === contractId || value.id === `legacy_${legacyContractId}`)
      );

      console.log('🔍 Found contract data:', contractData);

      if (contractData && contractData.isLegacy && (contractData.contractHtml || contractData.signedContractHtml)) {
        console.log('🔍 Setting up legacy contract modal');

        // Determine if contract is signed or draft
        const hasSignedContract = contractData.signedContractHtml &&
          contractData.signedContractHtml.trim() !== '' &&
          contractData.signedContractHtml !== '\\N';
        const hasDraftContract = contractData.contractHtml &&
          contractData.contractHtml.trim() !== '' &&
          contractData.contractHtml !== '\\N';

        console.log('🔍 Contract status check:', { hasSignedContract, hasDraftContract });

        if (hasSignedContract || hasDraftContract) {
          setViewingContract({
            id: contractData.id,
            mode: hasSignedContract ? 'view' : 'edit', // If signed, view only; if draft, editable
            contractHtml: contractData.contractHtml,
            signedContractHtml: contractData.signedContractHtml,
            status: hasSignedContract ? 'signed' : 'draft',
            public_token: contractData.public_token,
            signed_at: contractData.signed_at
          });

          console.log('🔍 Set viewingContract with mode:', hasSignedContract ? 'view' : 'edit');
          return;
        } else {
          console.log('🔍 No contract content found');
          toast.error('No contract content found for this legacy contract.');
          return;
        }
      } else {
        // Try to fetch the contract data from database if not in map
        console.log('🔍 Contract data not in map, fetching from database...');
        const { data: legacyContractData, error: legacyError } = await supabase
          .from('lead_leadcontact')
          .select('id, contract_html, signed_contract_html, public_token, lead_id')
          .eq('id', legacyContractId)
          .maybeSingle();

        if (!legacyError && legacyContractData) {
          const hasContractHtml = legacyContractData.contract_html && legacyContractData.contract_html.trim() !== '' && legacyContractData.contract_html !== '\\N';
          const hasSignedContractHtml = legacyContractData.signed_contract_html && legacyContractData.signed_contract_html.trim() !== '' && legacyContractData.signed_contract_html !== '\\N';

          if (hasContractHtml || hasSignedContractHtml) {
            const hasSigned = hasSignedContractHtml;

            // Fetch signed date from leads_leadstage table (stage 60 = Client signed agreement)
            let signedDate: string | undefined = undefined;
            if (hasSigned && legacyContractData.lead_id) {
              const { data: stageData } = await supabase
                .from('leads_leadstage')
                .select('cdate')
                .eq('lead_id', legacyContractData.lead_id)
                .eq('stage', 60)
                .order('cdate', { ascending: false })
                .limit(1)
                .maybeSingle();

              signedDate = stageData?.cdate || undefined;
            }

            setViewingContract({
              id: `legacy_${legacyContractData.id}`,
              mode: hasSigned ? 'view' : 'edit',
              contractHtml: legacyContractData.contract_html,
              signedContractHtml: legacyContractData.signed_contract_html,
              status: hasSigned ? 'signed' : 'draft',
              public_token: legacyContractData.public_token,
              signed_at: signedDate
            });
            return;
          }
        }
        toast.error('No contract found for this legacy lead.');
        return;
      }
    }

    // For new contracts, navigate to the contract page
    console.log('🔍 New contract, navigating to:', `/contract/${contractId}`);
    navigate(`/contract/${contractId}`);
  };

  // Filter subLeads to only show ones that match the current lead_number
  // This prevents showing old data when navigating to a different master lead
  // Linked-only subleads (isLinkedOnly) show actual lead number and are always included for current master
  const filteredSubLeads = useMemo(() => {
    if (!lead_number) return [];

    const decodedLeadNumber = decodeURIComponent(lead_number);
    const baseLeadNumberRaw = decodedLeadNumber.includes('/') ? decodedLeadNumber.split('/')[0] : decodedLeadNumber;
    const baseLeadNumber = baseLeadNumberRaw.replace(/^[LC]/i, '');

    return subLeads.filter(subLead => {
      if (subLead.isMaster || subLead.isLinkedOnly) return true;
      const subLeadNumber = String(subLead.lead_number || subLead.id || '');
      const subLeadBaseRaw = subLeadNumber.includes('/') ? subLeadNumber.split('/')[0] : subLeadNumber;
      const subLeadBase = subLeadBaseRaw.replace(/^[LC]/i, '');
      const subLeadNumberClean = subLeadNumber.replace(/^[LC]/i, '');
      const actualId = String(subLead.actual_lead_id || '').replace(/^[LC]/i, '');
      const rowId = String(subLead.id || '').replace(/^legacy_/, '');
      return (
        subLeadBase === baseLeadNumber ||
        subLeadNumberClean === baseLeadNumber ||
        actualId === baseLeadNumber ||
        rowId === baseLeadNumber
      );
    });
  }, [subLeads, lead_number]);

  // Linked-only leads (break-link applies only to these, not traditional subleads)
  const linkedOnlyLeads = useMemo(
    () => filteredSubLeads.filter((s): s is SubLead => !!s.isLinkedOnly),
    [filteredSubLeads]
  );

  const handleSubLeadClick = (subLead: SubLead, event?: React.MouseEvent) => {
    const isNewTab = event?.metaKey || event?.ctrlKey;

    if (isNewTab) {
      // Open in new tab
      const url = subLead.route || (subLead.actual_lead_id ? `/clients/${subLead.actual_lead_id}` : '#');
      window.open(url, '_blank');
      return;
    }

    // Normal navigation in same tab
    if (subLead.route) {
      navigate(subLead.route);
      return;
    }

    if (subLead.actual_lead_id) {
      navigate(`/clients/${subLead.actual_lead_id}`);
    }
  };

  const totalDocumentCount = useMemo(
    () => filteredSubLeads.reduce((sum, lead) => sum + (documentCounts[lead.id] ?? 0), 0),
    [filteredSubLeads, documentCounts],
  );

  const openLeadDocuments = (subLead: SubLead, event?: React.MouseEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    setDocumentsLead(subLead);
  };

  const openAllDocuments = () => {
    const withDocs = filteredSubLeads.find((lead) => (documentCounts[lead.id] ?? 0) > 0);
    setDocumentsLead(withDocs || filteredSubLeads[0] || null);
  };

  useEffect(() => {
    if (!documentsLead) setDocumentTabsShowAll(false);
  }, [documentsLead]);

  const documentTabLeads = useMemo(() => {
    if (documentTabsShowAll) return filteredSubLeads;
    return filteredSubLeads.filter((lead) => {
      if (lead.id === documentsLead?.id) return true;
      const count = documentCounts[lead.id];
      if (count === undefined) return true;
      return count > 0;
    });
  }, [filteredSubLeads, documentCounts, documentTabsShowAll, documentsLead?.id]);

  useEffect(() => {
    if (!subLeads.length) {
      setDocumentCounts({});
      return;
    }

    let cancelled = false;
    const leads = subLeads.slice();
    const keyToLeadIds = new Map<string, string[]>();
    const queryKeys = new Set<string>();

    for (const lead of leads) {
      for (const key of leadDocumentLookupKeys(lead)) {
        queryKeys.add(key);
        const existing = keyToLeadIds.get(key) || [];
        existing.push(lead.id);
        keyToLeadIds.set(key, existing);
      }
    }

    const keys = [...queryKeys];
    void (async () => {
      const counts: Record<string, number> = {};
      for (const lead of leads) counts[lead.id] = 0;

      for (let i = 0; i < keys.length; i += 80) {
        const chunk = keys.slice(i, i + 80);
        const { data, error: docsError } = await supabase
          .from('lead_case_documents')
          .select('lead_number')
          .in('lead_number', chunk)
          .not('storage_path', 'is', null);
        if (docsError) {
          console.warn('Master lead document counts:', docsError.message);
          continue;
        }
        for (const row of data || []) {
          const leadNumber = String((row as { lead_number?: string }).lead_number || '').trim();
          for (const leadId of keyToLeadIds.get(leadNumber) || []) {
            counts[leadId] = (counts[leadId] || 0) + 1;
          }
        }
      }

      if (!cancelled) setDocumentCounts(counts);
    })();

    return () => {
      cancelled = true;
    };
  }, [subLeads]);

  // Don't return early - always render the page structure so header/sidebar are visible
  // Show loading/error states within the content area instead
  return (
    <div className="min-h-screen bg-[#ececec]">
      <style>{compactTableStyles}</style>
      {/* Header */}
      <div className="bg-transparent">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 md:py-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <button
                onClick={() => navigate(-1)}
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-base-content shadow-sm transition-colors hover:bg-white/90 border-0 outline-none"
              >
                <ArrowLeftIcon className="w-4 h-4" />
                Back
              </button>
              <div className="min-w-0">
                <h1 className="text-xl md:text-2xl font-semibold text-base-content truncate">
                  Master lead #{(() => {
                    if (!masterLeadInfo) return lead_number;

                    // For new leads, use lead_number and add /1 if it's a master lead with subleads
                    if (masterLeadInfo.lead_number) {
                      let displayNumber = masterLeadInfo.lead_number;
                      // Check if it's a master lead (no master_id) and has subleads
                      const isMaster = !masterLeadInfo.master_id || String(masterLeadInfo.master_id).trim() === '';
                      const hasSubLeads = subLeads.length > 1; // More than 1 because master is included in subLeads
                      if (isMaster && hasSubLeads && !displayNumber.includes('/')) {
                        displayNumber = `${displayNumber}/1`;
                      }
                      return displayNumber;
                    }

                    // For legacy leads, format lead number using the same logic as Clients.tsx
                    const hasSubLeads = subLeads.length > 1;
                    // If this row still has master_id, it is not the chain root — show its own id, not "parent/?"
                    const isRootMaster =
                      !masterLeadInfo.master_id || String(masterLeadInfo.master_id).trim() === '';
                    const formattedLeadNumber = isRootMaster
                      ? formatLegacyLeadNumber(masterLeadInfo, undefined, hasSubLeads)
                      : String(masterLeadInfo.id).replace(/^legacy_/, '');
                    let displayNumber = formattedLeadNumber;

                    // Add "C" prefix for legacy leads with stage "100" (Success) or higher (after stage 60)
                    if (masterLeadInfo.stage === '100' || masterLeadInfo.stage === 100) {
                      displayNumber = `C${displayNumber}`;
                    }

                    return displayNumber;
                  })()}
                </h1>
                <p className="mt-1 text-sm text-base-content/60 flex items-center gap-3 flex-wrap">
                  <span>
                    {filteredSubLeads.length} lead{filteredSubLeads.length !== 1 ? 's' : ''} found (including master lead)
                  </span>
                  {masterLeadInfo && filteredSubLeads.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setAddLeadModalOpen(true);
                          setAddLeadSearchQuery('');
                          setAddLeadSearchResults([]);
                          setAddLeadSelected(null);
                        }}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 hover:bg-primary/10 rounded-lg px-2 py-1 transition-colors border-0 outline-none bg-transparent cursor-pointer"
                      >
                        <PlusCircleIcon className="w-6 h-6" />
                        Add lead to chain
                      </button>
                      {linkedOnlyLeads.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setBreakLinkModalOpen(true);
                            setBreakLinkSelectedIds(new Set());
                          }}
                          className="btn btn-sm btn-outline btn-secondary inline-flex items-center gap-1.5"
                        >
                          <LinkSlashIcon className="w-4 h-4" />
                          Break link
                        </button>
                      )}
                    </>
                  )}
                </p>
              </div>
            </div>
            {filteredSubLeads.length > 0 && (
              <button
                type="button"
                onClick={openAllDocuments}
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-base-content shadow-sm transition-colors hover:bg-white/90 border-0 outline-none"
              >
                <DocumentTextIcon className="h-4 w-4" />
                All documents
                <span className="inline-flex min-w-[1.85rem] items-center justify-center rounded-full bg-gray-100 px-2.5 py-1 text-sm font-bold tabular-nums">
                  {totalDocumentCount}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        {/* Loading State - only show if we don't have any data yet */}
        {loading && !masterLeadInfo && subLeads.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="loading loading-spinner loading-lg text-primary"></div>
              <p className="mt-4 text-gray-600">Loading master lead data...</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center max-w-md">
              <div className="alert alert-error mb-4">
                <ExclamationTriangleIcon className="w-6 h-6" />
                <div>
                  <h3 className="font-bold">Error Loading Data</h3>
                  <div className="text-xs">{error}</div>
                </div>
              </div>
              <button
                onClick={() => {
                  setError(null);
                  fetchSubLeads();
                }}
                className="btn btn-primary"
              >
                Try Again
              </button>
              <button
                onClick={() => navigate(-1)}
                className="btn btn-ghost ml-2"
              >
                Go Back
              </button>
            </div>
          </div>
        )}

        {/* Sub-leads Section - show if we have data or if not in error state */}
        {!error && (subLeads.length > 0 || masterLeadInfo) && (
          <div className="overflow-hidden rounded-[18px] bg-white shadow-sm">
            <div className="flex items-center gap-2 px-5 py-4">
              <UserIcon className="h-5 w-5 text-base-content/50" />
              <h2 className="text-base font-semibold text-base-content">Leads</h2>
            </div>
            {subLeads.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-base-content/50">
                No sub-leads found for this master lead.
              </div>
            ) : (
              <>
                {/* Mobile Card View */}
                <div className="md:hidden space-y-4 p-4">
                  {filteredSubLeads.map((subLead) => {
                    const cardClasses = [
                      'card',
                      'shadow-lg',
                      'hover:shadow-2xl',
                      'transition-all',
                      'duration-300',
                      'ease-in-out',
                      'transform',
                      'hover:-translate-y-1',
                      'cursor-pointer',
                      'group',
                      'border',
                      'bg-base-100',
                      'border-base-200',
                    ].join(' ');

                    return (
                      <div
                        key={subLead.id}
                        className={cardClasses}
                        onClick={(e) => handleSubLeadClick(subLead, e)}
                      >
                        <div className="card-body p-5">
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <h2 className="card-title text-xl font-bold group-hover:text-primary transition-colors truncate">
                                {subLead.name || 'Unknown'}
                              </h2>
                              {subLead.isMaster && (
                                <span
                                  className="badge badge-xs border-2"
                                  style={{
                                    backgroundColor: '#4218cc',
                                    color: '#ffffff',
                                    borderColor: '#4218cc'
                                  }}
                                >
                                  Master
                                </span>
                              )}
                            </div>
                            {getStageBadge(subLead.stage)}
                          </div>

                          <p className="text-sm text-base-content/60 font-mono mb-4">
                            #{subLead.lead_number}
                          </p>

                          <div className="divider my-0"></div>

                          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mt-4">
                            <div className="flex items-center gap-2" title="Total">
                              <CurrencyDollarIcon className="h-4 w-4 text-base-content/50" />
                              <span className="font-medium">
                                {subLead.currency_symbol}{subLead.total?.toLocaleString() || '0.0'}
                              </span>
                            </div>
                            {(subLead.category && subLead.category !== 'Unknown') || subLead.topic ? (
                              <div className="flex items-start gap-2" title="Category / Topic">
                                <TagIcon className="h-4 w-4 text-base-content/50 mt-0.5 flex-shrink-0" />
                                <div className="flex flex-col gap-1">
                                  {subLead.category && subLead.category !== 'Unknown' && (
                                    <span className="line-clamp-1 break-words text-sm">{subLead.category}</span>
                            )}
                            {subLead.topic && (
                                    <span className="line-clamp-1 break-words text-sm text-base-content/70">{subLead.topic}</span>
                            )}
                                </div>
                              </div>
                            ) : null}
                            {subLead.contact && subLead.contact !== '---' && (
                              <div className="flex items-center gap-2" title="Contact">
                                <UserIcon className="h-4 w-4 text-base-content/50" />
                                <span className="truncate">{subLead.contact}</span>
                              </div>
                            )}
                            {(subLead.applicants ?? 0) > 0 && (
                              <div className="flex items-center gap-2" title="Applicants">
                                <UserIcon className="h-4 w-4 text-base-content/50" />
                                <span>{subLead.applicants} applicant{(subLead.applicants ?? 0) !== 1 ? 's' : ''}</span>
                              </div>
                            )}
                            <div className="flex items-center" title="Documents">
                              <DocumentsCountBadge
                                count={documentCounts[subLead.id] ?? 0}
                                onClick={(e) => openLeadDocuments(subLead, e)}
                              />
                            </div>
                          </div>

                          {subLead.agreement && subLead.agreement !== '---' && (
                            <div
                              className="mt-4 pt-4 border-t border-base-200/50"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex items-center gap-2 text-sm">
                                <LinkIcon className="h-4 w-4 text-base-content/50" />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (subLead.agreement) {
                                      handleViewContract(subLead.agreement, subLead.agreementIsLegacy);
                                    }
                                  }}
                                  className="text-blue-600 hover:text-blue-800 underline cursor-pointer"
                                >
                                  View
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {subLeadsLoading && (
                    <div className="card bg-base-100 border border-base-200">
                      <div className="card-body p-5 text-center">
                        <div className="flex items-center justify-center">
                          <div className="loading loading-spinner loading-sm mr-2"></div>
                          <span className="text-base-content/60 text-sm">Loading sub-leads...</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Desktop Table View */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full min-w-[64rem] border-collapse text-left compact-table">
                    <thead>
                      <tr className="border-b border-base-200/80 bg-white text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        <th className="px-5 py-3 font-semibold">Lead</th>
                        <th className="px-3 py-3 font-semibold">Total</th>
                        <th className="hidden md:table-cell px-3 py-3 font-semibold">Category / Topic</th>
                        <th className="px-3 py-3 font-semibold">Stage</th>
                        <th className="hidden lg:table-cell px-3 py-3 font-semibold">Contact</th>
                        <th className="hidden sm:table-cell px-3 py-3 font-semibold">APP</th>
                        <th className="hidden xl:table-cell px-3 py-3 font-semibold">Contract</th>
                        <th className="hidden lg:table-cell px-3 py-3 font-semibold">Scheduler</th>
                        <th className="hidden xl:table-cell px-3 py-3 font-semibold">Closer</th>
                        <th className="hidden xl:table-cell px-3 py-3 font-semibold">Handler</th>
                        <th className="px-5 py-3 text-right font-semibold">Documents</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSubLeads.map((subLead) => (
                        <tr
                          key={subLead.id}
                          className="group cursor-pointer border-b border-base-200/60 last:border-b-0 bg-white transition-colors duration-150 hover:!bg-gray-50"
                          onClick={(e) => handleSubLeadClick(subLead, e)}
                        >
                          <td className="px-5 py-3.5 align-middle whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span className={`text-base font-semibold ${subLead.isMaster ? 'text-black' : 'text-primary'}`}>
                                {subLead.lead_number}
                              </span>
                              {subLead.isMaster && (
                                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                                  Master
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3.5 align-middle whitespace-nowrap text-sm text-gray-700">
                            {subLead.currency_symbol}{subLead.total?.toLocaleString() || '0.0'}
                          </td>
                          <td className="hidden md:table-cell max-w-[12rem] px-3 py-3.5 align-middle text-sm leading-snug text-gray-500">
                            <div className="flex flex-col gap-0.5">
                              {subLead.category && subLead.category !== 'Unknown' && (
                                <span className="line-clamp-2 whitespace-normal break-words">{subLead.category}</span>
                              )}
                              {subLead.topic && (
                                <span className="line-clamp-1 whitespace-normal break-words text-gray-400">{subLead.topic}</span>
                              )}
                              {(!subLead.category || subLead.category === 'Unknown') && !subLead.topic && (
                                <span className="text-gray-300">—</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3.5 align-middle whitespace-nowrap">
                            {getStageBadge(subLead.stage)}
                          </td>
                          <td className="hidden lg:table-cell max-w-[10rem] truncate px-3 py-3.5 align-middle text-sm font-medium text-gray-500" title={subLead.contact}>
                            {subLead.contact || '—'}
                          </td>
                          <td className="hidden sm:table-cell px-3 py-3.5 align-middle whitespace-nowrap text-sm text-gray-600">
                            {subLead.applicants || 0}
                          </td>
                          <td className="hidden xl:table-cell px-3 py-3.5 align-middle whitespace-nowrap text-sm">
                            {subLead.agreement && subLead.agreement !== '---' ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (subLead.agreement) {
                                    handleViewContract(subLead.agreement, subLead.agreementIsLegacy);
                                  }
                                }}
                                className="font-medium text-primary hover:text-primary/80 underline-offset-2 hover:underline cursor-pointer border-0 bg-transparent p-0"
                              >
                                View
                              </button>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="hidden lg:table-cell px-3 py-3.5 align-middle whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              {subLead.scheduler && subLead.scheduler !== '---' ? (
                                <>
                                  <EmployeeAvatar employeeId={subLead.scheduler_id} size="md" />
                                  <span className="text-sm text-gray-600">{subLead.scheduler}</span>
                                </>
                              ) : (
                                <span className="text-sm text-gray-300">—</span>
                              )}
                            </div>
                          </td>
                          <td className="hidden xl:table-cell px-3 py-3.5 align-middle whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              {subLead.closer && subLead.closer !== '---' ? (
                                <>
                                  <EmployeeAvatar employeeId={subLead.closer_id} size="md" />
                                  <span className="text-sm text-gray-600">{subLead.closer}</span>
                                </>
                              ) : (
                                <span className="text-sm text-gray-300">—</span>
                              )}
                            </div>
                          </td>
                          <td className="hidden xl:table-cell px-3 py-3.5 align-middle whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              {subLead.handler && subLead.handler !== '---' && subLead.handler !== 'Not assigned' ? (
                                <>
                                  <EmployeeAvatar employeeId={subLead.handler_id} size="md" />
                                  <span className="text-sm text-gray-600">{subLead.handler}</span>
                                </>
                              ) : (
                                <span className="text-sm text-gray-300">—</span>
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-3.5 align-middle whitespace-nowrap text-right">
                            <DocumentsCountBadge
                              count={documentCounts[subLead.id] ?? 0}
                              onClick={(e) => openLeadDocuments(subLead, e)}
                            />
                          </td>
                        </tr>
                      ))}
                      {subLeadsLoading && (
                        <tr>
                          <td colSpan={11} className="px-5 py-4 text-center">
                            <div className="flex items-center justify-center">
                              <div className="loading loading-spinner loading-sm mr-2"></div>
                              <span className="text-sm text-base-content/50">Loading sub-leads...</span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Legacy Contract Viewing Modal */}
      {viewingContract && viewingContract.contractHtml && typeof window !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 bg-white flex flex-col">
          <style>
            {`
              .inline-input {
                display: inline-block !important;
                vertical-align: middle !important;
                border: 2px solid #3b82f6 !important;
                border-radius: 6px !important;
                padding: 4px 8px !important;
                margin: 0 4px !important;
                min-width: 150px !important;
                font-family: inherit !important;
                font-size: 14px !important;
                background: #ffffff !important;
                color: #374151 !important;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
                line-height: 1.5 !important;
                height: auto !important;
              }
              .signature-pad {
                display: inline-block !important;
                vertical-align: middle !important;
                border: 2px dashed #3b82f6 !important;
                border-radius: 6px !important;
                padding: 12px !important;
                margin: 0 4px !important;
                min-width: 180px !important;
                min-height: 50px !important;
                background: #f8fafc !important;
                cursor: pointer !important;
                text-align: center !important;
                font-size: 14px !important;
                color: #6b7280 !important;
                font-weight: 500 !important;
                line-height: 1.5 !important;
              }
              .signature-input {
                display: inline-block !important;
                vertical-align: middle !important;
                border: 2px solid #3b82f6 !important;
                border-radius: 6px !important;
                padding: 4px 8px !important;
                margin: 0 4px !important;
                min-width: 150px !important;
                font-family: inherit !important;
                font-size: 14px !important;
                background: #ffffff !important;
                color: #374151 !important;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
                line-height: 1.5 !important;
                height: auto !important;
              }
              /* Right alignment for Hebrew text */
              .ql-align-right {
                text-align: right !important;
              }
              .ql-direction-rtl {
                direction: rtl !important;
              }
              /* Ensure paragraphs with right alignment are properly aligned */
              p.ql-align-right {
                text-align: right !important;
                direction: rtl !important;
              }
              /* Override any conflicting alignment */
              .prose p.ql-align-right {
                text-align: right !important;
                direction: rtl !important;
              }
              /* Specific styling for signature images */
              .signature-image {
                border: none !important;
                background: transparent !important;
                padding: 0 !important;
                margin: 0 !important;
                box-shadow: none !important;
                border-radius: 0 !important;
                display: inline-block !important;
                vertical-align: middle !important;
                max-width: 200px !important;
                max-height: 80px !important;
                object-fit: contain !important;
              }
            `}
          </style>
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gray-50 flex-shrink-0">
              <div>
                <h3 className="text-2xl font-bold text-gray-900">
                  {viewingContract.mode === 'edit' ? 'Edit Legacy Contract' : 'Legacy Contract'}
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  Status: <span className={`font-semibold ${viewingContract.status === 'signed' ? 'text-green-600' : 'text-yellow-600'}`}>
                    {viewingContract.status === 'signed' ? 'Signed' : 'Draft'}
                  </span>
                  {viewingContract.mode === 'edit' && (
                    <span className="ml-2 text-blue-600 font-semibold">(Editable)</span>
                  )}
                </p>
              </div>
              <button
                className="btn btn-ghost btn-lg"
                onClick={() => setViewingContract(null)}
              >
                <XMarkIcon className="w-8 h-8" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 p-6 overflow-y-auto">
              <div>
                <h4 className="text-lg font-semibold text-gray-800 mb-4">
                  {viewingContract.status === 'signed'
                    ? 'Signed Contract (Read Only)'
                    : viewingContract.mode === 'edit'
                      ? 'Contract Draft (Editable)'
                      : 'Contract Draft'
                  }
                </h4>
                {viewingContract.mode === 'edit' ? (
                  <div className="border border-gray-300 rounded-lg p-4 flex flex-col">
                    <div className="bg-white rounded-lg flex flex-col">
                      {/* Rich Text Toolbar */}
                      <div className="border-b border-gray-200 p-2 bg-gray-50">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => executeCommand('bold')}
                            className="btn btn-sm btn-ghost"
                            title="Bold"
                          >
                            <strong>B</strong>
                          </button>
                          <button
                            onClick={() => executeCommand('italic')}
                            className="btn btn-sm btn-ghost"
                            title="Italic"
                          >
                            <em>I</em>
                          </button>
                          <button
                            onClick={() => executeCommand('underline')}
                            className="btn btn-sm btn-ghost"
                            title="Underline"
                          >
                            <u>U</u>
                          </button>
                          <button
                            onClick={() => executeCommand('strikeThrough')}
                            className="btn btn-sm btn-ghost"
                            title="Strikethrough"
                          >
                            <s>S</s>
                          </button>
                          <div className="divider divider-horizontal mx-1"></div>
                          <button
                            onClick={() => executeCommand('formatBlock', 'p')}
                            className="btn btn-sm btn-ghost"
                            title="Paragraph"
                          >
                            P
                          </button>
                          <button
                            onClick={() => executeCommand('formatBlock', 'h1')}
                            className="btn btn-sm btn-ghost"
                            title="Heading 1"
                          >
                            H1
                          </button>
                          <button
                            onClick={() => executeCommand('formatBlock', 'h2')}
                            className="btn btn-sm btn-ghost"
                            title="Heading 2"
                          >
                            H2
                          </button>
                          <button
                            onClick={() => executeCommand('formatBlock', 'h3')}
                            className="btn btn-sm btn-ghost"
                            title="Heading 3"
                          >
                            H3
                          </button>
                          <div className="divider divider-horizontal mx-1"></div>
                          <button
                            onClick={() => executeCommand('insertUnorderedList')}
                            className="btn btn-sm btn-ghost"
                            title="Bullet List"
                          >
                            • List
                          </button>
                          <button
                            onClick={() => executeCommand('insertOrderedList')}
                            className="btn btn-sm btn-ghost"
                            title="Numbered List"
                          >
                            1. List
                          </button>
                          <div className="divider divider-horizontal mx-1"></div>
                          <button
                            onClick={() => executeCommand('justifyLeft')}
                            className="btn btn-sm btn-ghost"
                            title="Align Left"
                          >
                            ←
                          </button>
                          <button
                            onClick={() => executeCommand('justifyCenter')}
                            className="btn btn-sm btn-ghost"
                            title="Align Center"
                          >
                            ↔
                          </button>
                          <button
                            onClick={() => executeCommand('justifyRight')}
                            className="btn btn-sm btn-ghost"
                            title="Align Right"
                          >
                            →
                          </button>
                          <button
                            onClick={() => executeCommand('justifyFull')}
                            className="btn btn-sm btn-ghost"
                            title="Justify"
                          >
                            ≡
                          </button>
                        </div>
                      </div>
                      <div
                        key={`editor-content-${viewingContract?.id}-${Date.now()}`}
                        className="flex-1 prose prose-lg max-w-none p-4 overflow-y-auto"
                        style={{ maxHeight: 'calc(100vh - 300px)' }}
                      >
                        {viewingContract?.contractHtml && (
                          <div
                            className="prose prose-lg max-w-none"
                            contentEditable={viewingContract.mode === 'edit'}
                            suppressContentEditableWarning={true}
                            dangerouslySetInnerHTML={{
                              __html: viewingContract.mode === 'edit'
                                ? processHtmlForEditing(viewingContract.contractHtml)
                                : (viewingContract.status === 'signed' && viewingContract.signedContractHtml
                                  ? viewingContract.signedContractHtml
                                  : viewingContract.contractHtml)
                            }}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-50 p-6 rounded-lg h-full overflow-y-auto">
                    <div className="prose prose-lg max-w-none">
                      <div
                        className="font-sans text-base leading-relaxed text-gray-800"
                        dangerouslySetInnerHTML={{
                          __html: viewingContract.status === 'signed' && viewingContract.signedContractHtml
                            ? processSignedContractHtml(viewingContract.signedContractHtml, viewingContract.signed_at)
                            : viewingContract.contractHtml || ''
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 p-6 border-t border-gray-200 flex-shrink-0">
              {/* Share button for both edit and signed modes */}
              <button
                className="btn btn-info"
                onClick={async () => {
                  try {
                    console.log('🔍 Creating share link for legacy contract');

                    // Extract the legacy contract ID from the viewingContract.id
                    const legacyContractId = viewingContract.id.replace('legacy_', '');
                    console.log('🔍 Legacy contract ID for sharing:', legacyContractId);

                    // Always fetch the token from database first (to get the latest value, even if state has it)
                    console.log('🔍 Fetching public token from database');
                    const { data: contractData, error: fetchError } = await supabase
                      .from('lead_leadcontact')
                      .select('public_token')
                      .eq('id', legacyContractId)
                      .maybeSingle();

                    if (fetchError && fetchError.code !== 'PGRST116') {
                      console.error('❌ Error fetching public token:', fetchError);
                      toast.error('Failed to get share link.');
                      return;
                    }

                    let publicToken = contractData?.public_token;

                    // If no token exists in database, generate a new one (for both draft and signed contracts)
                    if (!publicToken) {
                      publicToken = crypto.randomUUID();
                      console.log('🔍 Generated new public token:', publicToken);

                      // Update the contract with the public token
                      const { error: updateError } = await supabase
                        .from('lead_leadcontact')
                        .update({ public_token: publicToken })
                        .eq('id', legacyContractId);

                      if (updateError) {
                        console.error('❌ Error updating legacy contract with public token:', updateError);
                        toast.error('Failed to create share link.');
                        return;
                      }

                      // Update the state with the new token so subsequent clicks use the same token
                      setViewingContract(prev => prev ? { ...prev, public_token: publicToken } : null);
                    } else {
                      console.log('🔍 Found existing public token:', publicToken);
                      // Update state to ensure it's in sync
                      if (!viewingContract.public_token || viewingContract.public_token !== publicToken) {
                        setViewingContract(prev => prev ? { ...prev, public_token: publicToken } : null);
                      }
                    }

                    // Create the public URL - always use production domain
                    const publicUrl = `${getFrontendBaseUrl()}/public-legacy-contract/${legacyContractId}/${publicToken}`;
                    console.log('🔍 Public URL created:', publicUrl);

                    // Copy to clipboard
                    await navigator.clipboard.writeText(publicUrl);
                    toast.success('Share link copied to clipboard!');

                  } catch (error) {
                    console.error('❌ Error creating share link:', error);
                    toast.error('Failed to create share link.');
                  }
                }}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                </svg>
                Share
              </button>

              {viewingContract.mode === 'edit' && (
                <button
                  className="btn btn-success"
                  onClick={async () => {
                    try {
                      console.log('🔍 Saving edited legacy contract');

                      // Get the content from the contentEditable div
                      const contentDiv = document.querySelector('[contenteditable="true"]');
                      if (!contentDiv) {
                        toast.error('Editor not found');
                        return;
                      }

                      let htmlContent = contentDiv.innerHTML;
                      console.log('🔍 Content from editor:', htmlContent);

                      // Extract values from input fields and replace them back with placeholders
                      const inputs = contentDiv.querySelectorAll('input.inline-input');
                      inputs.forEach((input) => {
                        const value = (input as HTMLInputElement).value || '_____________';
                        // Replace the input element with the value
                        const inputRegex = /<input[^>]*class="inline-input"[^>]*>/g;
                        htmlContent = htmlContent.replace(inputRegex, value);
                      });

                      // Replace signature pad containers and signature inputs with placeholders
                      htmlContent = htmlContent.replace(
                        /<div[^>]*class="signature-pad"[^>]*>.*?<\/div>/gs,
                        '{{sig}}'
                      );
                      htmlContent = htmlContent.replace(
                        /<input[^>]*class="signature-input"[^>]*>/g,
                        '{{sig}}'
                      );

                      console.log('🔍 Processed HTML content:', htmlContent);

                      // Extract the legacy contract ID from the viewingContract.id
                      const legacyContractId = viewingContract.id.replace('legacy_', '');
                      console.log('🔍 Legacy contract ID to update:', legacyContractId);

                      // Update the contract_html in lead_leadcontact table
                      const { error } = await supabase
                        .from('lead_leadcontact')
                        .update({ contract_html: htmlContent })
                        .eq('id', legacyContractId);

                      if (error) {
                        console.error('❌ Error updating legacy contract:', error);
                        toast.error('Failed to save contract changes.');
                        return;
                      }

                      console.log('✅ Legacy contract updated successfully');
                      toast.success('Contract saved successfully!');

                      // Close the modal
                      setViewingContract(null);

                      // Refresh the page data
                      fetchSubLeads();

                    } catch (error) {
                      console.error('❌ Error saving legacy contract:', error);
                      toast.error('Failed to save contract changes.');
                    }
                  }}
                >
                  Save Changes
                </button>
              )}

              <button
                className="btn btn-primary"
                onClick={() => {
                  // Create a blob and download the contract
                  const htmlContent = viewingContract.status === 'signed' && viewingContract.signedContractHtml
                    ? viewingContract.signedContractHtml
                    : viewingContract.contractHtml || '';

                  const blob = new Blob([htmlContent], { type: 'text/html' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `contract_${viewingContract.id}.html`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                }}
              >
                Download Contract
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setViewingContract(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Add lead to chain modal */}
      {addLeadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-base-100 rounded-xl shadow-xl border border-base-300 w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-base-300">
              <h2 className="text-lg font-semibold">Add lead to chain</h2>
              <button
                type="button"
                onClick={() => {
                  setAddLeadModalOpen(false);
                  setAddLeadSelected(null);
                  setAddLeadSearchQuery('');
                }}
                className="btn btn-ghost btn-sm btn-circle"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3 flex-1 min-h-0">
              {!addLeadSelected ? (
                <>
                  <p className="text-sm text-base-content/70">
                    Search for a lead (new or legacy) to add as the next sublead in this chain.
                  </p>
                  <div className="relative">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-base-content/40" />
                    <input
                      type="text"
                      placeholder="Search by lead number, name, email..."
                      className="input input-bordered w-full pl-10"
                      value={addLeadSearchQuery}
                      onChange={(e) => setAddLeadSearchQuery(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="flex-1 overflow-auto min-h-[200px] border border-base-300 rounded-lg">
                    {addLeadSearching ? (
                      <div className="p-6 text-center text-base-content/60">
                        <span className="loading loading-spinner loading-sm" />
                        <span className="ml-2">Searching...</span>
                      </div>
                    ) : addLeadSearchResults.length > 0 ? (
                      <ul className="divide-y divide-base-200">
                        {addLeadSearchResults.map((lead) => {
                          const inactive = isInactiveLead(lead);
                          return (
                            <li key={lead.lead_type === 'legacy' ? `legacy_${lead.id}` : lead.id}>
                              <button
                                type="button"
                                onClick={() => setAddLeadSelected(lead)}
                                className={`w-full px-4 py-3 text-left transition-colors rounded-lg border relative ${inactive ? 'bg-gray-100 hover:bg-gray-200 border-gray-200 text-black' : 'hover:bg-base-200 border-base-300 border-transparent'}`}
                              >
                                {inactive && (
                                  <div className="absolute top-1.5 left-1/2 -translate-x-1/2 text-xs font-medium text-black z-10">
                                    Inactive
                                  </div>
                                )}
                                <div className="absolute top-1.5 right-2 z-10">
                                  {getStageBadgeForSearchLead(lead)}
                                </div>
                                <div className={`flex flex-col gap-0.5 pr-20 ${inactive ? 'text-black' : ''}`}>
                                  <p className={`font-medium ${inactive ? 'text-black' : 'text-base-content'}`}>
                                    {lead.contactName || lead.name || '—'}
                                  </p>
                                  <p className={`text-sm font-mono ${inactive ? 'text-black/80' : 'text-base-content/70'}`}>
                                    #{lead.lead_number || lead.id}
                                  </p>
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : addLeadSearchQuery.trim() ? (
                      <div className="p-6 text-center text-base-content/60 text-sm">
                        No leads found. Try a different search.
                      </div>
                    ) : (
                      <div className="p-6 text-center text-base-content/50 text-sm">
                        Type to search for leads.
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-base-content/70">
                    Add this lead to the chain?
                  </p>
                  <div className="p-3 bg-base-200 rounded-lg flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{addLeadSelected.contactName || addLeadSelected.name || '—'}</p>
                      <p className="text-sm font-mono text-base-content/70">
                        #{addLeadSelected.lead_number || addLeadSelected.id}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStageBadgeForSearchLead(addLeadSelected)}
                      {isInactiveLead(addLeadSelected) && (
                        <span className="badge badge-sm bg-gray-300 text-black border border-gray-400">Inactive</span>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-base-content/70">
                    It will be added as the next sublead in this chain.
                  </p>
                  <div className="flex gap-2 justify-end pt-2">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setAddLeadSelected(null)}
                      disabled={addLeadConfirming}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleAddLeadConfirm}
                      disabled={addLeadConfirming}
                    >
                      {addLeadConfirming ? (
                        <>
                          <span className="loading loading-spinner loading-sm" />
                          Adding...
                        </>
                      ) : (
                        'Confirm add'
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Break link modal – choose which linked-only leads to unlink */}
      {breakLinkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-base-100 rounded-xl shadow-xl border border-base-300 w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-base-300">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <LinkSlashIcon className="w-5 h-5" />
                Break link
              </h2>
              <button
                type="button"
                onClick={() => {
                  setBreakLinkModalOpen(false);
                  setBreakLinkSelectedIds(new Set());
                }}
                className="btn btn-ghost btn-sm btn-circle"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3 flex-1 min-h-0 overflow-hidden">
              <p className="text-sm text-base-content/70">
                Select which linked leads to unlink from this master. This only affects leads that were added via “Add lead to chain” or “Combine leads” (linked_master_lead). Traditional subleads are not changed.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setBreakLinkSelectedIds(new Set(linkedOnlyLeads.map((s) => s.id)))}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setBreakLinkSelectedIds(new Set())}
                >
                  Clear
                </button>
              </div>
              <div className="flex-1 overflow-auto border border-base-300 rounded-lg divide-y divide-base-200">
                {linkedOnlyLeads.map((subLead) => {
                  const isChecked = breakLinkSelectedIds.has(subLead.id);
                  return (
                    <label
                      key={subLead.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-base-200 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          setBreakLinkSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(subLead.id)) next.delete(subLead.id);
                            else next.add(subLead.id);
                            return next;
                          });
                        }}
                        className="checkbox checkbox-sm"
                      />
                      <span className="font-medium">{subLead.name || '—'}</span>
                      <span className="text-sm font-mono text-base-content/70">
                        #{subLead.lead_number ?? subLead.id}
                      </span>
                      {subLead.stage != null && (
                        <span className="badge badge-sm badge-ghost">{getStageName(String(subLead.stage))}</span>
                      )}
                    </label>
                  );
                })}
              </div>
              <div className="flex gap-2 justify-end pt-2 border-t border-base-300">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setBreakLinkModalOpen(false);
                    setBreakLinkSelectedIds(new Set());
                  }}
                  disabled={breakLinkConfirming}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={breakLinkSelectedIds.size === 0 || breakLinkConfirming}
                  onClick={async () => {
                    if (breakLinkSelectedIds.size === 0) return;
                    setBreakLinkConfirming(true);
                    try {
                      const items = linkedOnlyLeads
                        .filter((s) => breakLinkSelectedIds.has(s.id))
                        .map((s) => ({
                          id: s.id.startsWith('legacy_') ? s.id : s.id,
                          type: s.id.startsWith('legacy_') ? 'legacy' as const : 'new' as const,
                        }));
                      const result = await breakLinkedLeads(items);
                      if (result.success) {
                        toast.success('Link(s) removed. Leads are no longer linked to this master.');
                        setBreakLinkModalOpen(false);
                        setBreakLinkSelectedIds(new Set());
                        fetchSubLeads();
                      } else {
                        toast.error(result.error || 'Failed to break link');
                      }
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Failed to break link');
                    } finally {
                      setBreakLinkConfirming(false);
                    }
                  }}
                >
                  {breakLinkConfirming ? (
                    <>
                      <span className="loading loading-spinner loading-sm" />
                      Breaking link...
                    </>
                  ) : (
                    `Break link (${breakLinkSelectedIds.size})`
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <DocumentModal
        isOpen={Boolean(documentsLead)}
        onClose={() => setDocumentsLead(null)}
        leadNumber={documentsLead ? canonicalDocumentLeadNumber(documentsLead) : ''}
        leadNumberLookupKeys={documentsLead ? leadDocumentLookupKeys(documentsLead) : []}
        clientName={documentsLead?.name || ''}
        clientId={documentsLead ? resolveMasterLeadClientId(documentsLead) : null}
        onedriveSubFolder={CLIENT_HEADER_ONEDRIVE_SUBFOLDER}
        includeRootFolderDocuments
        modalTitle="Case documents"
        requireCaseDocumentClassification
        onDocumentCountChange={(count) => {
          if (!documentsLead) return;
          setDocumentCounts((prev) => ({ ...prev, [documentsLead.id]: count }));
        }}
        headerExtra={
          filteredSubLeads.length > 1 ? (
            <div className="flex min-w-0 w-full items-center gap-2">
              <div className="flex shrink-0 rounded-2xl bg-gray-100 p-1">
                <button
                  type="button"
                  onClick={() => setDocumentTabsShowAll(false)}
                  className={`rounded-xl px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    !documentTabsShowAll
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'bg-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  With docs
                </button>
                <button
                  type="button"
                  onClick={() => setDocumentTabsShowAll(true)}
                  className={`rounded-xl px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    documentTabsShowAll
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'bg-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  All
                </button>
              </div>
              <div className="flex min-w-0 flex-1 overflow-x-auto rounded-2xl bg-gray-100 p-1">
                {documentTabLeads.map((lead) => {
                  const active = documentsLead?.id === lead.id;
                  return (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => setDocumentsLead(lead)}
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                        active
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'bg-transparent text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      <span>{lead.lead_number}</span>
                      <span
                        className={`inline-flex min-w-[1.4rem] items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                          active ? 'bg-gray-100 text-gray-700' : 'text-gray-500'
                        }`}
                      >
                        {documentCounts[lead.id] ?? 0}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null
        }
      />
    </div>
  );
};

export default MasterLeadPage;
