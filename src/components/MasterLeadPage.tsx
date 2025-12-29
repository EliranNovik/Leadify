import React, { useState, useEffect, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { getStageName, getStageColour, fetchStageNames } from '../lib/stageUtils';
import { 
  ArrowLeftIcon, 
  UserIcon, 
  CurrencyDollarIcon,
  TagIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  LinkIcon,
  ExclamationTriangleIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';
import { createPortal } from 'react-dom';
import { toast } from 'react-hot-toast';
import { getFrontendBaseUrl } from '../lib/api';

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
  
  // First, handle base64 signature data (data:image/png;base64,...) - do this before replacing placeholders
  processed = processed.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, (match) => {
    return `<img src="${match}" style="display: inline-block; vertical-align: middle; border: 2px solid #10b981; border-radius: 6px; padding: 4px; margin: 0 4px; background-color: #f0fdf4; max-width: 200px; max-height: 80px; object-fit: contain;" alt="Signature" />`;
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

interface SubLead {
  id: string;
  lead_number: string;
  actual_lead_id: string; // The actual lead ID for navigation
  manual_id?: string;
  name: string;
  total?: number;
  currency?: string;
  currency_symbol?: string;
  category?: string;
  stage?: string;
  contact?: string;
  applicants?: number;
  agreement?: string | React.ReactNode;
  docs_url?: string;
  scheduler?: string;
  closer?: string;
  handler?: string;
  master_id?: string;
  isMaster?: boolean;
  route?: string;
}

const MasterLeadPage: React.FC = () => {
  const { lead_number } = useParams<{ lead_number: string }>();
  const navigate = useNavigate();
  const [subLeads, setSubLeads] = useState<SubLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [subLeadsLoading, setSubLeadsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [masterLeadInfo, setMasterLeadInfo] = useState<any>(null);
  const [viewingContract, setViewingContract] = useState<{ id: string; mode: 'view' | 'edit'; contractHtml?: string; signedContractHtml?: string; status?: string; public_token?: string; signed_at?: string } | null>(null);
  const [contractsDataMap, setContractsDataMap] = useState<Map<string, { id: string; isLegacy: boolean; contractHtml?: string; signedContractHtml?: string; public_token?: string; signed_at?: string }>>(new Map());

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

  // Helper function to get category name with main category
  const getCategoryName = (categoryId: string | number | null | undefined, categories: any[]) => {
    if (!categoryId || !categories || categories.length === 0) {
      return 'Unknown';
    }
    
    const category = categories.find((cat: any) => cat.id.toString() === categoryId.toString());
    if (category) {
      // Return category name with main category in parentheses
      if (category.misc_maincategory?.name) {
        return `${category.name} (${category.misc_maincategory.name})`;
      } else {
        return category.name; // Fallback if no main category
      }
    }
    
    return 'Unknown';
  };

  // Helper function to format lead number for legacy leads (same logic as Clients.tsx)
  const formatLegacyLeadNumber = (legacyLead: any, subLeadSuffix?: number): string => {
    const masterId = legacyLead.master_id;
    const leadId = String(legacyLead.id);
    
    // If master_id is null/empty, it's a master lead - return just the ID
    if (!masterId || String(masterId).trim() === '') {
      return leadId;
    }
    
    // If master_id exists, it's a sub-lead
    // Use provided suffix if available, otherwise calculate it
    if (subLeadSuffix !== undefined) {
      return `${masterId}/${subLeadSuffix}`;
    }
    
    // If suffix not provided, return a placeholder that will be calculated when data is fetched
    return `${masterId}/?`;
  };

  // Helper function to get currency symbol
  const getCurrencySymbol = (currencyCode?: string) => {
    if (!currencyCode) return '₪';
    const symbols: { [key: string]: string } = {
      'ILS': '₪',
      'NIS': '₪',
      'USD': '$',
      'EUR': '€',
      'GBP': '£',
      'CAD': 'C$',
      'AUD': 'A$'
    };
    return symbols[currencyCode.toUpperCase()] || currencyCode;
  };

  // Helper function to get currency info from lead data
  const getCurrencyInfo = (lead: any) => {
    // Use accounting_currencies name if available, otherwise fallback
    if (lead.accounting_currencies?.name) {
      return {
        currency: lead.accounting_currencies.name,
        symbol: getCurrencySymbol(lead.accounting_currencies.iso_code || lead.accounting_currencies.name)
      };
    } else {
      // Fallback currency mapping based on currency_id
      switch (lead.currency_id) {
        case 1: return { currency: 'NIS', symbol: '₪' };
        case 2: return { currency: 'USD', symbol: '$' };
        case 3: return { currency: 'EUR', symbol: '€' };
        default: return { currency: 'NIS', symbol: '₪' };
      }
    }
  };

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

  // Helper function to format contact information - only show name
  const getContactInfo = (lead: any, contactMap: Map<string, any>) => {
    // Get contact info from the contact map
    const contactInfo = contactMap.get(String(lead.id));
    
    // Only return the name, no phone/email
    if (contactInfo?.name && contactInfo.name.trim()) {
      return contactInfo.name.trim();
    } else if (lead.name && lead.name.trim()) {
      // Fallback to lead name if no contact info
      return lead.name.trim();
    }
    
    return '---';
  };

  const getStageBadge = (stage?: string | number) => {
    if (!stage && stage !== 0) {
      return (
        <span className="badge badge-sm bg-gray-100 text-gray-600">
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
        className="badge badge-sm text-xs px-2 py-1"
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

  const buildClientRoute = (manualId?: string | null, leadNumberValue?: string | null) => {
    const manualString = manualId?.toString().trim() || '';
    const leadString = leadNumberValue?.toString().trim() || '';
    const isSubLeadNumber = leadString.includes('/');

    if (isSubLeadNumber && manualString !== '') {
      const query = leadString !== '' ? `?lead=${encodeURIComponent(leadString)}` : '';
      return `/clients/${encodeURIComponent(manualString)}` + query;
    }

    if (leadString !== '') {
      return `/clients/${encodeURIComponent(leadString)}`;
    }

    if (manualString !== '') {
      return `/clients/${encodeURIComponent(manualString)}`;
    }

    return '/clients';
  };

    const extractNumericId = (value: string | null | undefined) => {
      if (!value) return null;
      if (/^\d+$/.test(value)) return value;
      const digitsOnly = value.replace(/\D/g, '');
      return digitsOnly.length > 0 ? digitsOnly : null;
    };

    const attemptFetchNewMaster = async (baseLeadNumber: string): Promise<boolean> => {
      try {
        const { data: masterLead, error: masterError } = await supabase
          .from('leads')
          .select('*')
          .eq('lead_number', baseLeadNumber)
          .maybeSingle();

        if (masterError) {
          console.error('Error fetching new master lead:', masterError);
        }

        if (!masterLead) {
          return false;
        }

        setSubLeadsLoading(true);

        const { data: subLeadsData, error: subLeadsError } = await supabase
          .from('leads')
          .select('*')
          .like('lead_number', `${baseLeadNumber}/%`)
          .order('lead_number', { ascending: true });

        if (subLeadsError) {
          console.error('Error fetching new sub-leads:', subLeadsError);
          setError('Failed to fetch sub-leads');
          setMasterLeadInfo(masterLead);
          setSubLeads([]);
          return true;
        }

        const { data: categories } = await supabase
          .from('misc_category')
          .select(`
            id,
            name,
            parent_id,
            misc_maincategory!parent_id (
              id,
              name
            )
          `)
          .order('name', { ascending: true });

        const { data: stageDefinitions } = await supabase
          .from('lead_stages')
          .select('id, name');

        const stageNameLookup = new Map<string, string>();
        stageDefinitions?.forEach(stage => {
          if (stage?.id !== undefined && stage?.id !== null) {
            stageNameLookup.set(String(stage.id), stage.name || String(stage.id));
          }
        });

        const leadIdsForContacts = [
          masterLead?.id,
          ...(subLeadsData?.map((lead: any) => lead.id) || []),
        ].filter(Boolean);

        const contactsByLead = new Map<string, any[]>();
        if (leadIdsForContacts.length > 0) {
          const { data: contactsData, error: contactsError } = await supabase
            .from('contacts')
            .select('id, lead_id, name, is_main_applicant, relationship')
            .in('lead_id', leadIdsForContacts.map(id => String(id)));

          if (contactsError) {
            console.error('Error fetching contacts for new leads:', contactsError);
          } else if (contactsData) {
            contactsData.forEach(contact => {
              if (!contact.lead_id) return;
              const key = String(contact.lead_id);
              const existing = contactsByLead.get(key) || [];
              existing.push(contact);
              contactsByLead.set(key, existing);
            });
          }
        }

        const isTruthy = (value: any) => value === true || value === 'true' || value === 't' || value === '1';

        const resolveContactName = (lead: any) => {
          const contactList = (contactsByLead.get(String(lead.id)) || []).slice();

          if (contactList.length > 0) {
            contactList.sort((a, b) => {
              const aMain = isTruthy(a.is_main_applicant) || (typeof a.relationship === 'string' && a.relationship.toLowerCase() === 'persecuted_person');
              const bMain = isTruthy(b.is_main_applicant) || (typeof b.relationship === 'string' && b.relationship.toLowerCase() === 'persecuted_person');
              if (aMain === bMain) return 0;
              return aMain ? -1 : 1;
            });

            const selectedContact = contactList[0];
            if (selectedContact?.name && selectedContact.name.trim()) {
              return selectedContact.name.trim();
            }
          }

          if (Array.isArray(lead.additional_contacts) && lead.additional_contacts.length > 0) {
            const additionalContact = lead.additional_contacts.find((contact: any) => contact?.name && contact.name.trim());
            if (additionalContact?.name) {
              return additionalContact.name.trim();
            }
          }

          const fallbackName = lead.anchor_full_name || lead.contact_name || lead.primary_contact_name || lead.name;
          return fallbackName && typeof fallbackName === 'string' && fallbackName.trim() ? fallbackName.trim() : '---';
        };

        const resolveStageName = (stageValue: any) => {
          if (stageValue === null || stageValue === undefined || stageValue === '') {
            return 'Unknown';
          }
          const stageKey = String(stageValue);
          return stageNameLookup.get(stageKey) || getStageName(stageKey) || stageKey;
        };

        // Fetch contracts for new leads
        const leadIdsForContracts = [
          masterLead?.id,
          ...(subLeadsData?.map((lead: any) => lead.id) || []),
        ].filter(Boolean);

        const newContractsMap = new Map<string, { id: string; isLegacy: boolean }>();
        if (leadIdsForContracts.length > 0) {
          const { data: newContractsData, error: newContractsError } = await supabase
            .from('contracts')
            .select('id, client_id')
            .in('client_id', leadIdsForContracts.map(id => String(id)));

          if (newContractsError) {
            console.error('Error fetching new contracts:', newContractsError);
          } else if (newContractsData) {
            newContractsData.forEach((contract: any) => {
              if (contract.client_id && contract.id) {
                newContractsMap.set(String(contract.client_id), {
                  id: contract.id,
                  isLegacy: false
                });
              }
            });
          }
        }

        // Update contractsDataMap with new leads contracts (merge with existing if any)
        setContractsDataMap(prev => {
          const merged = new Map(prev);
          newContractsMap.forEach((value, key) => {
            merged.set(key, value);
          });
          return merged;
        });

        const processedSubLeads: SubLead[] = [];

        const formatNewLead = (lead: any, isMaster: boolean): SubLead => {
          const leadNumberValue = lead.lead_number || baseLeadNumber;
          const manualValue = lead.manual_id ? String(lead.manual_id) : undefined;
          const totalRaw = lead.balance ?? lead.total ?? lead.meeting_total ?? 0;
          const totalValue = typeof totalRaw === 'number' ? totalRaw : parseFloat(totalRaw) || 0;
          const currencyCode = (lead.balance_currency || lead.currency || 'NIS') as string;
          const categoryName = getCategoryName(lead.category_id, categories || []) || lead.category || 'Unknown';
          const applicantsValue = lead.number_of_applicants_meeting ?? lead.number_of_applicants ?? lead.applicants ?? 0;
          const contactName = resolveContactName(lead);
          // Check if contract exists in newContractsMap (local map for this fetch)
          const contractData = newContractsMap.get(String(lead.id));
          const agreementNode = contractData ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleViewContract(contractData.id, false);
              }}
              className="text-blue-600 hover:text-blue-800 underline cursor-pointer"
            >
              View Agreement
            </button>
          ) : '---';

          return {
            id: String(lead.id),
            lead_number: leadNumberValue,
            actual_lead_id: manualValue || leadNumberValue || String(lead.id),
            manual_id: manualValue,
            name: lead.name || 'Unknown',
            total: totalValue,
            currency: currencyCode,
            currency_symbol: getCurrencySymbol(currencyCode),
            category: categoryName,
            stage: String(lead.stage), // Store stage ID for badge rendering
            contact: contactName,
            applicants: Number(applicantsValue) || 0,
            agreement: agreementNode,
            scheduler: lead.scheduler || lead.meeting_scheduler || '---',
            closer: lead.closer || lead.meeting_closer || '---',
            handler: lead.handler || lead.case_handler || '---',
            master_id: lead.master_id || baseLeadNumber,
            isMaster,
            route: buildClientRoute(manualValue, leadNumberValue),
          };
        };

        processedSubLeads.push(formatNewLead(masterLead, true));
        subLeadsData?.forEach((lead: any) => processedSubLeads.push(formatNewLead(lead, false)));

        processedSubLeads.sort((a, b) => {
          const extractOrder = (leadNumber: string) => {
            const parts = leadNumber.split('/');
            const lastPart = parts[parts.length - 1];
            return parseInt(lastPart, 10) || 0;
          };
          return extractOrder(a.lead_number) - extractOrder(b.lead_number);
        });

        setMasterLeadInfo(masterLead);
        setSubLeads(processedSubLeads);
        return true;
      } catch (error) {
        console.error('Error handling new master lead:', error);
        setError('An unexpected error occurred while fetching master lead data');
        return true;
      } finally {
        setSubLeadsLoading(false);
      }
    };

    const fetchSubLeads = async () => {
      if (!lead_number) return;
      
      const decodedLeadNumber = decodeURIComponent(lead_number);
      const baseLeadNumber = decodedLeadNumber.includes('/') ? decodedLeadNumber.split('/')[0] : decodedLeadNumber;

      try {
        setLoading(true);
        setError(null);

        const handledNewLead = await attemptFetchNewMaster(baseLeadNumber);
        if (handledNewLead) {
          return;
        }

        const normalizedId = extractNumericId(baseLeadNumber);
        if (!normalizedId) {
          console.error('Invalid master lead number provided:', lead_number);
          setError('Invalid master lead number');
          return;
        }
        const legacyId = parseInt(normalizedId, 10);
        
        // First, get the master lead info with related data including employee joins
        const { data: masterLead, error: masterError } = await supabase
          .from('leads_lead')
          .select(`
            id, name, total, stage, manual_id, master_id,
            category_id,
            meeting_scheduler_id,
            closer_id,
            case_handler_id,
            docs_url,
            currency_id,
            no_of_applicants,
            accounting_currencies!leads_lead_currency_id_fkey (
              name,
              iso_code
            ),
            scheduler:tenants_employee!meeting_scheduler_id (
              display_name
            ),
            closer:tenants_employee!closer_id (
              display_name
            ),
            handler:tenants_employee!case_handler_id (
              display_name
            )
          `)
          .eq('id', legacyId)
          .single();

        if (masterError) {
          console.error('Error fetching master lead:', masterError);
          setError('Failed to fetch master lead information');
          return;
        }

        setMasterLeadInfo(masterLead);

        // Initialize stage names cache first for proper badge rendering
        await fetchStageNames();

        // Fetch sub-leads with related data including employee joins
        setSubLeadsLoading(true);
        const subLeadsQuery = supabase
          .from('leads_lead')
          .select(`
            id, name, total, stage, manual_id, master_id,
            category_id,
            meeting_scheduler_id,
            closer_id,
            case_handler_id,
            docs_url,
            currency_id,
            no_of_applicants,
            accounting_currencies!leads_lead_currency_id_fkey (
              name,
              iso_code
            ),
            scheduler:tenants_employee!meeting_scheduler_id (
              display_name
            ),
            closer:tenants_employee!closer_id (
              display_name
            ),
            handler:tenants_employee!case_handler_id (
              display_name
            )
          `)
          .or(`master_id.eq.${baseLeadNumber},master_id.eq.${normalizedId}`)
          .order('id', { ascending: true })
          .limit(50);

        // Run queries in parallel for better performance
        const [
          { data: subLeadsData, error: subLeadsError },
          { data: categories },
          { data: employees }
        ] = await Promise.all([
          subLeadsQuery,
          supabase
            .from('misc_category')
            .select(`
              id,
              name,
              parent_id,
              misc_maincategory!parent_id (
                id,
                name
              )
            `)
            .order('name', { ascending: true }),
          supabase
            .from('tenants_employee')
            .select('id, display_name')
        ]);

        if (subLeadsError) {
          console.error('Error fetching sub-leads:', subLeadsError);
          setError('Failed to fetch sub-leads');
          return;
        }

        // Fetch contact information for all leads (master + sub-leads)
        const allLeadIds = [masterLead?.id, ...(subLeadsData?.map(lead => lead.id) || [])].filter(Boolean);
        
        // First, get the lead-contact relationships
        const { data: leadContacts, error: leadContactsError } = await supabase
          .from('lead_leadcontact')
          .select('lead_id, contact_id')
          .in('lead_id', allLeadIds);

        if (leadContactsError) {
          console.error('Error fetching lead contacts:', leadContactsError);
        }

        // Fetch contracts from contracts table for legacy leads (new contracts)
        const { data: contractsData, error: contractsError } = await supabase
          .from('contracts')
          .select('id, legacy_id')
          .in('legacy_id', allLeadIds)
          .order('created_at', { ascending: false });

        if (contractsError) {
          console.error('Error fetching contracts:', contractsError);
        }

        // Fetch legacy contracts from lead_leadcontact table (old legacy contracts)
        const { data: legacyContractsData, error: legacyContractsError } = await supabase
          .from('lead_leadcontact')
          .select('lead_id, id, public_token, contract_html, signed_contract_html')
          .in('lead_id', allLeadIds);
        
        // Fetch signed dates for legacy leads (from leads_leadstage where stage = 60)
        const signedDatesMap = new Map<number, string>();
        if (allLeadIds.length > 0) {
          const { data: stageData } = await supabase
            .from('leads_leadstage')
            .select('lead_id, cdate')
            .in('lead_id', allLeadIds)
            .eq('stage', 60)
            .order('cdate', { ascending: false });
          
          if (stageData) {
            // Group by lead_id and take the most recent date for each lead
            stageData.forEach(stage => {
              const leadId = Number(stage.lead_id);
              if (!signedDatesMap.has(leadId) || 
                  (stage.cdate && (!signedDatesMap.get(leadId) || new Date(stage.cdate) > new Date(signedDatesMap.get(leadId)!)))) {
                if (stage.cdate) {
                  signedDatesMap.set(leadId, stage.cdate);
                }
              }
            });
          }
        }

        if (legacyContractsError) {
          console.error('Error fetching legacy contracts:', legacyContractsError);
        }

        // Create agreement link map (lead_id -> agreement URL) - for backwards compatibility
        const agreementLinkMap = new Map<string, string>();
        
        // Create contract data map (lead_id -> contract data) - stores full contract info
        const contractsMap = new Map<string, { id: string; isLegacy: boolean; contractHtml?: string; signedContractHtml?: string; public_token?: string; signed_at?: string }>();
        
        // First, add contracts from contracts table (new contracts) - takes priority
        if (contractsData) {
          contractsData.forEach((contract: any) => {
            if (contract.legacy_id && contract.id) {
              // Use the same route format as ContractPage.tsx: /contract/:contractId
              const agreementUrl = `/contract/${contract.id}`;
              agreementLinkMap.set(String(contract.legacy_id), agreementUrl);
              
              // Store contract data for new contracts (not legacy)
              contractsMap.set(String(contract.legacy_id), {
                id: contract.id,
                isLegacy: false
              });
            }
          });
        }

        // Then, add legacy contracts from lead_leadcontact (old legacy contracts)
        // Only add if not already in map (new contracts take priority)
        if (legacyContractsData) {
          legacyContractsData.forEach((lc: any) => {
            // Check if there's a contract (either draft or signed)
            const hasContract = (lc.contract_html && lc.contract_html !== '\\N' && lc.contract_html.trim() !== '') ||
                               (lc.signed_contract_html && lc.signed_contract_html !== '\\N' && lc.signed_contract_html.trim() !== '');
            
            if (lc.lead_id && lc.id && hasContract && !contractsMap.has(String(lc.lead_id))) {
              // Get signed date for this lead
              const leadIdNum = Number(lc.lead_id);
              const signedDate = signedDatesMap.get(leadIdNum);
              
              // Store legacy contract data with HTML content and signed date
              contractsMap.set(String(lc.lead_id), {
                id: `legacy_${lc.id}`,
                isLegacy: true,
                contractHtml: lc.contract_html,
                signedContractHtml: lc.signed_contract_html,
                public_token: lc.public_token,
                signed_at: signedDate
              });
              
              // Also store in agreementLinkMap for backwards compatibility (but won't be used for legacy)
              const agreementUrl = `/clients/${lc.lead_id}/contract`;
              agreementLinkMap.set(String(lc.lead_id), agreementUrl);
            }
          });
        }

        // Store contracts data map in state
        setContractsDataMap(contractsMap);

        console.log('🔍 Agreement link map:', {
          contractsData,
          legacyContractsData: legacyContractsData?.map((lc: any) => ({
            lead_id: lc.lead_id,
            id: lc.id,
            has_contract_html: !!lc.contract_html,
            has_signed_contract_html: !!lc.signed_contract_html,
            public_token: lc.public_token ? 'exists' : 'missing'
          })),
          agreementLinkMap: Array.from(agreementLinkMap.entries()),
          contractsMap: Array.from(contractsMap.entries()),
          allLeadIds
        });

        // Then, get the contact details for the contact IDs we found
        const contactIds = leadContacts?.map(lc => lc.contact_id).filter(Boolean) || [];
        let contactDetails: any[] = [];
        
        if (contactIds.length > 0) {
          const { data: contacts, error: contactsError } = await supabase
            .from('leads_contact')
            .select('id, name, phone, email, mobile')
            .in('id', contactIds);

          if (contactsError) {
            console.error('Error fetching contact details:', contactsError);
          } else {
            contactDetails = contacts || [];
          }
        }

        // Create lookup maps
        const employeeMap = new Map();
        employees?.forEach(emp => employeeMap.set(String(emp.id), emp.display_name));


        // Create contact lookup map
        const contactMap = new Map();
        
        // Create a map of contact_id to contact details
        const contactDetailsMap = new Map();
        contactDetails.forEach(contact => {
          contactDetailsMap.set(contact.id, contact);
        });
        
        // Map lead_id to contact details
        leadContacts?.forEach(leadContact => {
          if (leadContact.contact_id && contactDetailsMap.has(leadContact.contact_id)) {
            contactMap.set(String(leadContact.lead_id), contactDetailsMap.get(leadContact.contact_id));
          }
        });

        console.log('🔍 Contact debugging:', {
          allLeadIds,
          leadContacts,
          leadContactsError,
          contactIds,
          contactDetails,
          contactMapSize: contactMap.size,
          contactMapKeys: Array.from(contactMap.keys())
        });

        // Debug logging
        console.log('🔍 Debug data:', {
          masterLead: masterLead,
          sampleSubLead: subLeadsData?.[0],
          categories: categories?.slice(0, 3),
          employees: employees?.slice(0, 3),
          leadContacts: leadContacts?.slice(0, 3),
          categoriesCount: categories?.length || 0,
          employeeMapSize: employeeMap.size,
          contactMapSize: contactMap.size,
          employeeMapKeys: Array.from(employeeMap.keys()).slice(0, 5), // Show first 5 keys
          contactMapKeys: Array.from(contactMap.keys()).slice(0, 5) // Show first 5 contact keys
        });

        // Process the data
        const processedSubLeads: SubLead[] = [];

        // Add master lead first
        if (masterLead) {
          // Format lead number using the same logic as Clients.tsx
          const formattedLeadNumber = formatLegacyLeadNumber(masterLead);
          const displayNumber = masterLead.stage === 100 ? `C${formattedLeadNumber}` : formattedLeadNumber;
          const currencyInfo = getCurrencyInfo(masterLead);
          
          // Debug master lead lookups
          console.log('🔍 Master lead lookups:', {
            category_id: masterLead.category_id,
            category: getCategoryName(masterLead.category_id, categories || []),
            currency_id: masterLead.currency_id,
            currency_info: currencyInfo,
            meeting_scheduler_id: masterLead.meeting_scheduler_id,
            scheduler: employeeMap.get(masterLead.meeting_scheduler_id),
            closer_id: masterLead.closer_id,
            closer: employeeMap.get(masterLead.closer_id),
            case_handler_id: masterLead.case_handler_id,
            handler: employeeMap.get(masterLead.case_handler_id)
          });
          
          processedSubLeads.push({
            id: `legacy_${masterLead.id}`,
            lead_number: displayNumber,
            actual_lead_id: String(masterLead.id),
            manual_id: masterLead.manual_id,
            name: masterLead.name || 'Unknown',
            total: parseFloat(masterLead.total) || 0,
            currency: currencyInfo.currency,
            currency_symbol: currencyInfo.symbol,
            category: getCategoryName(masterLead.category_id, categories || []),
            stage: String(masterLead.stage), // Store stage ID for badge rendering
            contact: getContactInfo(masterLead, contactMap),
            applicants: parseInt(masterLead.no_of_applicants) || 0,
            agreement: (() => {
              // Check if contract exists in contractsMap (using lead_id as key)
              const contractData = contractsMap.get(String(masterLead.id));
              
              console.log('🔍 Master lead agreement check:', {
                leadId: masterLead.id,
                contractData,
                contractsMapKeys: Array.from(contractsMap.keys())
              });
              
              if (contractData) {
                return (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      // For legacy leads, pass true for isLegacyContract
                      handleViewContract(contractData.id, contractData.isLegacy);
                    }}
                    className="text-blue-600 hover:text-blue-800 underline cursor-pointer"
                  >
                    View Agreement
                  </button>
                );
              }
              return '---';
            })(),
            scheduler: (() => {
              const scheduler = Array.isArray(masterLead.scheduler) ? masterLead.scheduler[0] : masterLead.scheduler;
              return (scheduler as any)?.display_name || '---';
            })(),
            closer: (() => {
              const closer = Array.isArray(masterLead.closer) ? masterLead.closer[0] : masterLead.closer;
              return (closer as any)?.display_name || '---';
            })(),
            handler: (() => {
              const handler = Array.isArray(masterLead.handler) ? masterLead.handler[0] : masterLead.handler;
              return (handler as any)?.display_name || '---';
            })(),
            master_id: masterLead.master_id,
            isMaster: true,
            route: `/clients/${masterLead.id}`
          });
        }

        // Add sub-leads
        if (subLeadsData) {
          // Calculate suffix for each sub-lead
          const subLeadsWithSuffix = subLeadsData.map((lead, index) => {
            let subLeadSuffix: number | undefined;
            if (lead.master_id) {
              // Find position of this lead in the ordered list of sub-leads with same master_id
              const sameMasterLeads = subLeadsData.filter(l => l.master_id === lead.master_id);
              const sortedSameMaster = [...sameMasterLeads].sort((a, b) => a.id - b.id);
              const currentIndex = sortedSameMaster.findIndex(l => l.id === lead.id);
              // Suffix starts at 2 (first sub-lead is /2, second is /3, etc.)
              subLeadSuffix = currentIndex >= 0 ? currentIndex + 2 : sameMasterLeads.length + 2;
            }
            return { lead, subLeadSuffix };
          });

          subLeadsWithSuffix.forEach(({ lead, subLeadSuffix }, index) => {
            // Format lead number using the same logic as Clients.tsx
            const formattedLeadNumber = formatLegacyLeadNumber(lead, subLeadSuffix);
            const displayNumber = lead.stage === 100 ? `C${formattedLeadNumber}` : formattedLeadNumber;
            const currencyInfo = getCurrencyInfo(lead);
            
            // Debug first sub-lead lookups
            if (index === 0) {
              console.log('🔍 First sub-lead lookups:', {
                category_id: lead.category_id,
                category: getCategoryName(lead.category_id, categories || []),
                currency_id: lead.currency_id,
                currency_info: currencyInfo,
                meeting_scheduler_id: lead.meeting_scheduler_id,
                scheduler_joined: lead.scheduler,
                scheduler_display_name: Array.isArray(lead.scheduler) ? (lead.scheduler[0] as any)?.display_name : (lead.scheduler as any)?.display_name,
                closer_id: lead.closer_id,
                closer_joined: lead.closer,
                closer_display_name: Array.isArray(lead.closer) ? (lead.closer[0] as any)?.display_name : (lead.closer as any)?.display_name,
                case_handler_id: lead.case_handler_id,
                handler_joined: lead.handler,
                handler_display_name: Array.isArray(lead.handler) ? (lead.handler[0] as any)?.display_name : (lead.handler as any)?.display_name
              });
            }
            
            processedSubLeads.push({
              id: `legacy_${lead.id}`,
              lead_number: displayNumber,
              actual_lead_id: String(lead.id),
              manual_id: lead.manual_id,
              name: lead.name || 'Unknown',
              total: parseFloat(lead.total) || 0,
              currency: currencyInfo.currency,
              currency_symbol: currencyInfo.symbol,
              category: getCategoryName(lead.category_id, categories || []),
              stage: String(lead.stage), // Store stage ID for badge rendering
              contact: getContactInfo(lead, contactMap),
              applicants: parseInt(lead.no_of_applicants) || 0,
              agreement: (() => {
                // Check if contract exists in contractsMap (using lead_id as key)
                const contractData = contractsMap.get(String(lead.id));
                
                console.log('🔍 Sub-lead agreement check:', {
                  leadId: lead.id,
                  contractData,
                  contractsMapKeys: Array.from(contractsMap.keys())
                });
                
                if (contractData) {
                  return (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        // For legacy leads, pass true for isLegacyContract
                        handleViewContract(contractData.id, contractData.isLegacy);
                      }}
                      className="text-blue-600 hover:text-blue-800 underline cursor-pointer"
                    >
                      View Agreement
                    </button>
                  );
                }
                return '---';
              })(),
              scheduler: (() => {
                const scheduler = Array.isArray(lead.scheduler) ? lead.scheduler[0] : lead.scheduler;
                return (scheduler as any)?.display_name || '---';
              })(),
              closer: (() => {
                const closer = Array.isArray(lead.closer) ? lead.closer[0] : lead.closer;
                return (closer as any)?.display_name || '---';
              })(),
              handler: (() => {
                const handler = Array.isArray(lead.handler) ? lead.handler[0] : lead.handler;
                return (handler as any)?.display_name || '---';
              })(),
              master_id: lead.master_id,
            isMaster: false,
            route: `/clients/${lead.id}`
            });
          });
        }

        // Sort sub-leads by lead number (manual_id if available, otherwise id)
        processedSubLeads.sort((a, b) => {
          // Extract the numeric part from the lead number for comparison
          const getNumericPart = (leadNumber: string) => {
            // Remove any prefixes like 'C' and extract the numeric part
            const cleanNumber = leadNumber.replace(/^C/, '');
            // Extract the last number after any slash (e.g., "170324/1" -> "1")
            const parts = cleanNumber.split('/');
            const lastPart = parts[parts.length - 1];
            return parseInt(lastPart) || 0;
          };
          
          const aNum = getNumericPart(a.lead_number);
          const bNum = getNumericPart(b.lead_number);
          
          return aNum - bNum;
        });

        console.log('🔍 Final processed sub-leads:', {
          processedSubLeads,
          totalLength: processedSubLeads.length,
          masterLead: !!masterLead,
          subLeadsCount: subLeadsData?.length || 0,
          categoriesCount: categories?.length || 0,
          employeesCount: employees?.length || 0
        });

        setSubLeads(processedSubLeads);
      } catch (error) {
        console.error('Error fetching sub-leads:', error);
        setError('An unexpected error occurred while fetching data');
      } finally {
        setLoading(false);
        setSubLeadsLoading(false);
      }
    };

  useEffect(() => {
    fetchSubLeads();
  }, [lead_number]);

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

  const handleSubLeadClick = (subLead: SubLead) => {
    if (subLead.route) {
      navigate(subLead.route);
      return;
    }
    
    if (subLead.actual_lead_id) {
      navigate(`/clients/${subLead.actual_lead_id}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="loading loading-spinner loading-lg text-primary"></div>
          <p className="mt-4 text-gray-600">Loading master lead data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
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
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <style>{compactTableStyles}</style>
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate(-1)}
                className="btn btn-ghost btn-sm"
              >
                <ArrowLeftIcon className="w-4 h-4 mr-2" />
                Back
              </button>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">
                  Master lead #{(() => {
                    if (!masterLeadInfo) return lead_number;
                    
                    // Format lead number using the same logic as Clients.tsx
                    const formattedLeadNumber = formatLegacyLeadNumber(masterLeadInfo);
                    let displayNumber = formattedLeadNumber;
                    
                    // Add "C" prefix for legacy leads with stage "100" (Success) or higher (after stage 60)
                    if (masterLeadInfo.stage === '100' || masterLeadInfo.stage === 100) {
                      displayNumber = `C${displayNumber}`;
                    }
                    
                    return displayNumber;
                  })()}
                </h1>
                <p className="text-sm text-gray-500">
                  {subLeads.length} lead{subLeads.length !== 1 ? 's' : ''} found (including master lead)
                  {subLeads.length === 1 && (
                    <span className="ml-2 text-orange-600">
                      • Sub-leads temporarily unavailable due to database performance
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">

        {/* Sub-leads Section */}
        <div className="bg-white rounded-lg shadow-sm border">
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-b">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900">Sub-leads</h2>
          </div>
          
          {subLeads.length === 0 ? (
            <div className="px-4 sm:px-6 py-8 sm:py-12 text-center">
              <UserIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-sm sm:text-base text-gray-500">No sub-leads found for this master lead.</p>
            </div>
          ) : (
            <>
              {/* Mobile Card View */}
              <div className="md:hidden space-y-4 p-4">
                {subLeads.map((subLead) => {
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
                      onClick={() => handleSubLeadClick(subLead)}
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
                          {subLead.category && subLead.category !== 'Unknown' && (
                            <div className="flex items-center gap-2" title="Category">
                              <TagIcon className="h-4 w-4 text-base-content/50" />
                              <span className="truncate">{subLead.category}</span>
                            </div>
                          )}
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
                        </div>

                        {subLead.agreement && subLead.agreement !== '---' && (
                          <div 
                            className="mt-4 pt-4 border-t border-base-200/50"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center gap-2 text-sm">
                              <LinkIcon className="h-4 w-4 text-base-content/50" />
                              {subLead.agreement}
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
                <table className="table w-full compact-table">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Lead
                      </th>
                      <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Total
                      </th>
                      <th className="hidden md:table-cell px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Category
                      </th>
                      <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Stage
                      </th>
                      <th className="hidden lg:table-cell px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Contact
                      </th>
                      <th className="hidden sm:table-cell px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Applicants
                      </th>
                      <th className="hidden xl:table-cell px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Agreement
                      </th>
                      <th className="hidden lg:table-cell px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Scheduler
                      </th>
                      <th className="hidden xl:table-cell px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Closer
                      </th>
                      <th className="hidden xl:table-cell px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Handler
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {subLeads.map((subLead) => (
                      <tr 
                        key={subLead.id} 
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => handleSubLeadClick(subLead)}
                      >
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                           
                            <span className={`hover:text-blue-800 font-medium ${subLead.isMaster ? 'text-blue-700 font-bold' : 'text-blue-600'}`}>
                              {subLead.lead_number}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <span className="text-gray-900">
                              {subLead.currency_symbol}{subLead.total?.toLocaleString() || '0.0'}
                            </span>
                          </div>
                        </td>
                        <td className="hidden md:table-cell px-3 sm:px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <span className="text-gray-900">{subLead.category}</span>
                          </div>
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          {getStageBadge(subLead.stage)}
                        </td>
                        <td className="hidden lg:table-cell px-3 sm:px-6 py-4 whitespace-nowrap text-gray-900">
                          <div className="text-sm">
                            {subLead.contact}
                          </div>
                        </td>
                        <td className="hidden sm:table-cell px-3 sm:px-6 py-4 whitespace-nowrap text-gray-900">
                          <div className="flex items-center">
                            <span className="text-sm font-medium">
                              {subLead.applicants || 0}
                            </span>
                          </div>
                        </td>
                        <td className="hidden xl:table-cell px-3 sm:px-6 py-4 whitespace-nowrap text-gray-900">
                          {subLead.agreement}
                        </td>
                        <td className="hidden lg:table-cell px-3 sm:px-6 py-4 whitespace-nowrap text-gray-900">
                          {subLead.scheduler}
                        </td>
                        <td className="hidden xl:table-cell px-3 sm:px-6 py-4 whitespace-nowrap text-gray-900">
                          {subLead.closer}
                        </td>
                        <td className="hidden xl:table-cell px-3 sm:px-6 py-4 whitespace-nowrap text-gray-900">
                          {subLead.handler}
                        </td>
                      </tr>
                    ))}
                    {subLeadsLoading && (
                      <tr>
                        <td colSpan={9} className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center">
                            <div className="loading loading-spinner loading-sm mr-2"></div>
                            <span className="text-gray-500">Loading sub-leads...</span>
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
                              ? viewingContract.signedContractHtml 
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
                    
                    let publicToken = viewingContract.public_token;
                    
                    // For signed contracts, always fetch the actual token from database
                    if (viewingContract.status === 'signed') {
                      console.log('🔍 Fetching actual public token from database for signed contract');
                      const { data, error } = await supabase
                        .from('lead_leadcontact')
                        .select('public_token')
                        .eq('id', legacyContractId)
                        .single();
                      
                      if (error) {
                        console.error('❌ Error fetching public token:', error);
                        toast.error('Failed to get share link.');
                        return;
                      }
                      
                      publicToken = data?.public_token;
                      if (!publicToken) {
                        toast.error('No share link found for this contract.');
                        return;
                      }
                      
                      console.log('🔍 Found existing public token:', publicToken);
                    }
                    
                    // For draft contracts, generate a new token if it doesn't exist
                    if (viewingContract.status === 'draft' && !publicToken) {
                      publicToken = crypto.randomUUID();
                      console.log('🔍 Generated new public token for draft contract:', publicToken);
                      
                      // Update the contract with the public token
                      const { error } = await supabase
                        .from('lead_leadcontact')
                        .update({ public_token: publicToken })
                        .eq('id', legacyContractId);
                      
                      if (error) {
                        console.error('❌ Error updating legacy contract with public token:', error);
                        toast.error('Failed to create share link.');
                        return;
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
    </div>
  );
};

export default MasterLeadPage;
