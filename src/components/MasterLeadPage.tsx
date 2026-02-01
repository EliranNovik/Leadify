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
  ExclamationTriangleIcon,
  XMarkIcon,
  DocumentTextIcon
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
  type SubLead,
  type ContractData
} from '../lib/masterLeadApi';

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

// SubLead and ContractData are now imported from masterLeadApi

const MasterLeadPage: React.FC = () => {
  const { lead_number } = useParams<{ lead_number: string }>();
  const navigate = useNavigate();
  
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
  
  const [loading, setLoading] = useState(true);
  
  // Check persisted data on mount and set loading accordingly
  useEffect(() => {
    if (lead_number && masterLeadInfo && subLeads.length > 0) {
      const decodedLeadNumber = decodeURIComponent(lead_number);
      const baseLeadNumber = decodedLeadNumber.includes('/') ? decodedLeadNumber.split('/')[0] : decodedLeadNumber;
      const persistedLeadNumber = String(masterLeadInfo.lead_number || masterLeadInfo.id || '');
      const persistedBaseNumber = persistedLeadNumber.includes('/') ? persistedLeadNumber.split('/')[0] : persistedLeadNumber;
      
      // Check if persisted data matches current lead
      if (persistedBaseNumber === baseLeadNumber || subLeads.some(subLead => {
        const subLeadNumber = String(subLead.lead_number || subLead.id || '');
        const subLeadBase = subLeadNumber.includes('/') ? subLeadNumber.split('/')[0] : subLeadNumber;
        return subLeadBase === baseLeadNumber || subLeadNumber === baseLeadNumber;
      })) {
        // We have matching persisted data, set loading to false immediately
        setLoading(false);
        setSubLeadsLoading(false);
      }
    }
  }, []); // Only run on mount
  const [subLeadsLoading, setSubLeadsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewingContract, setViewingContract] = useState<{ id: string; mode: 'view' | 'edit'; contractHtml?: string; signedContractHtml?: string; status?: string; public_token?: string; signed_at?: string } | null>(null);

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

    const decodedLeadNumber = decodeURIComponent(lead_number);
    const baseLeadNumber = decodedLeadNumber.includes('/') ? decodedLeadNumber.split('/')[0] : decodedLeadNumber;

    try {
      setLoading(true);
      setError(null);
      setSubLeadsLoading(true);

      // Try new leads first
      const newLeadResult = await fetchNewMasterLead(baseLeadNumber, setContractsDataMap);
      
      if (newLeadResult.success && newLeadResult.masterLead) {
        setMasterLeadInfo(newLeadResult.masterLead);
        // Add agreement buttons to sub-leads
        const subLeadsWithAgreements = (newLeadResult.subLeads || []).map(lead => ({
          ...lead,
          agreement: createAgreementButton(lead, false)
        }));
        setSubLeads(subLeadsWithAgreements);
        setSubLeadsLoading(false);
        setLoading(false);
        return;
      }

      // Try legacy leads
      const normalizedId = extractNumericId(baseLeadNumber);
      if (!normalizedId) {
        setError('Invalid master lead number');
        setSubLeadsLoading(false);
        setLoading(false);
        return;
      }

      const legacyResult = await fetchLegacyMasterLead(baseLeadNumber, normalizedId, setContractsDataMap);
      
      if (legacyResult.success && legacyResult.masterLead) {
        setMasterLeadInfo(legacyResult.masterLead);
        // Add agreement buttons to sub-leads
        const subLeadsWithAgreements = (legacyResult.subLeads || []).map(lead => ({
          ...lead,
          agreement: createAgreementButton(lead, true)
        }));
        setSubLeads(subLeadsWithAgreements);
      } else {
        setError(legacyResult.error || 'Failed to fetch master lead');
      }
    } catch (error) {
      console.error('Error fetching sub-leads:', error);
      setError('An unexpected error occurred while fetching data');
    } finally {
      setLoading(false);
      setSubLeadsLoading(false);
    }
  }, [lead_number]);

  // Track previous lead_number to detect changes
  const prevLeadNumberRef = useRef<string | undefined>(undefined);
  const hasCheckedPersistedDataRef = useRef<string | undefined>(undefined);
  
  // Initialize stage names cache on mount to ensure badges display correctly
  useEffect(() => {
    fetchStageNames().catch(error => {
      console.error('Error initializing stage names:', error);
    });
  }, []);
  
  useEffect(() => {
    if (!lead_number) {
      setLoading(false);
      return;
    }
    
    const decodedLeadNumber = decodeURIComponent(lead_number);
    const baseLeadNumber = decodedLeadNumber.includes('/') ? decodedLeadNumber.split('/')[0] : decodedLeadNumber;
    const prevBaseLeadNumber = prevLeadNumberRef.current ? (prevLeadNumberRef.current.includes('/') ? prevLeadNumberRef.current.split('/')[0] : prevLeadNumberRef.current) : undefined;
    
    // Clear persisted state when lead_number changes to a different lead
    if (prevLeadNumberRef.current && baseLeadNumber !== prevBaseLeadNumber) {
      setSubLeads([]);
      setMasterLeadInfo(null);
      setContractsDataArray([]);
      prevLeadNumberRef.current = decodedLeadNumber;
      hasCheckedPersistedDataRef.current = undefined;
      // Fetch new lead data
      fetchSubLeads();
      return;
    }
    
    // Check if we've already checked persisted data for this lead_number
    const alreadyChecked = hasCheckedPersistedDataRef.current === baseLeadNumber;
    
    // If already checked, don't do anything (prevent loops)
    if (alreadyChecked) {
      return;
    }
    
    // Check if we have persisted data for the current lead (only check once per lead_number)
    const currentMasterLeadInfo = masterLeadInfo;
    const currentSubLeads = subLeads;
    const hasPersistedData = currentMasterLeadInfo && currentSubLeads.length > 0;
    let currentLeadMatches = false;
    
    if (hasPersistedData) {
      // Check if persisted data matches current lead_number
      // Convert to string to handle both string and number IDs
      const persistedLeadNumber = String(currentMasterLeadInfo.lead_number || currentMasterLeadInfo.id || '');
      const persistedBaseNumber = persistedLeadNumber.includes('/') ? persistedLeadNumber.split('/')[0] : persistedLeadNumber;
      
      // Also check if any sub-lead matches
      const subLeadMatches = currentSubLeads.some(subLead => {
        const subLeadNumber = String(subLead.lead_number || subLead.id || '');
        const subLeadBase = subLeadNumber.includes('/') ? subLeadNumber.split('/')[0] : subLeadNumber;
        return subLeadBase === baseLeadNumber || subLeadNumber === baseLeadNumber;
      });
      
      currentLeadMatches = persistedBaseNumber === baseLeadNumber || subLeadMatches;
    }
    
    // Mark as checked BEFORE deciding what to do (prevents loops)
    hasCheckedPersistedDataRef.current = baseLeadNumber;
    prevLeadNumberRef.current = decodedLeadNumber;
    
    // If we have persisted data for the current lead, skip fetching
    if (hasPersistedData && currentLeadMatches) {
      console.log('🔍 MasterLeadPage: Using persisted data, skipping fetch');
      // Set loading to false immediately to prevent loading screen
      setLoading(false);
      setSubLeadsLoading(false);
      return;
    }
    
    // Only fetch if we don't have matching persisted data
    fetchSubLeads();
  }, [lead_number, fetchSubLeads]); // Include fetchSubLeads since it's wrapped in useCallback

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
                    const formattedLeadNumber = formatLegacyLeadNumber(masterLeadInfo, undefined, hasSubLeads);
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
        <div>
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
                          {subLead.category && subLead.category !== 'Unknown' && (
                            <div className="flex items-start gap-2" title="Category">
                              <TagIcon className="h-4 w-4 text-base-content/50 mt-0.5 flex-shrink-0" />
                              <span className="line-clamp-2 break-words">{subLead.category}</span>
                            </div>
                          )}
                          {subLead.topic && (
                            <div className="flex items-start gap-2" title="Topic">
                              <DocumentTextIcon className="h-4 w-4 text-base-content/50 mt-0.5 flex-shrink-0" />
                              <span className="line-clamp-2 break-words">{subLead.topic}</span>
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
                    <tr>
                      <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                        Lead
                      </th>
                      <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                        Total
                      </th>
                      <th className="hidden md:table-cell px-3 sm:px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                        Category
                      </th>
                      <th className="hidden lg:table-cell px-3 sm:px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                        Topic
                      </th>
                      <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                        Stage
                      </th>
                      <th className="hidden lg:table-cell px-3 sm:px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                        Contact
                      </th>
                      <th className="hidden sm:table-cell px-3 sm:px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                        Applicants
                      </th>
                      <th className="hidden xl:table-cell px-3 sm:px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                        Agreement
                      </th>
                      <th className="hidden lg:table-cell px-3 sm:px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                        Scheduler
                      </th>
                      <th className="hidden xl:table-cell px-3 sm:px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                        Closer
                      </th>
                      <th className="hidden xl:table-cell px-3 sm:px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                        Handler
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {subLeads.map((subLead) => (
                      <tr
                        key={subLead.id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={(e) => handleSubLeadClick(subLead, e)}
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
                        <td className="hidden md:table-cell px-3 sm:px-6 py-4">
                          <div className="flex items-center">
                            <span className="text-gray-900 line-clamp-2 break-words">{subLead.category}</span>
                          </div>
                        </td>
                        <td className="hidden lg:table-cell px-3 sm:px-6 py-4">
                          <div className="flex items-center">
                            <span className="text-gray-900 line-clamp-2 break-words">{subLead.topic || '---'}</span>
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
                        <td colSpan={10} className="px-6 py-4 text-center">
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
    </div>
  );
};

export default MasterLeadPage;
