import React, { useState, useEffect } from 'react';
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
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';

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
          const agreementNode = lead.docs_url ? (
            <a 
              href={lead.docs_url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 underline"
            >
              View Agreement
            </a>
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
          stages: stages?.slice(0, 3),
          leadContacts: leadContacts?.slice(0, 3),
          categoriesCount: categories?.length || 0,
          employeeMapSize: employeeMap.size,
          stageMapSize: stageMap.size,
          contactMapSize: contactMap.size,
          employeeMapKeys: Array.from(employeeMap.keys()).slice(0, 5), // Show first 5 keys
          stageMapKeys: Array.from(stageMap.keys()).slice(0, 5), // Show first 5 stage keys
          contactMapKeys: Array.from(contactMap.keys()).slice(0, 5) // Show first 5 contact keys
        });

        // Process the data
        const processedSubLeads: SubLead[] = [];

        // Add master lead first
        if (masterLead) {
          const masterLeadNumber = masterLead.manual_id || String(masterLead.id);
          const displayNumber = masterLead.stage === 100 ? `C${masterLeadNumber}` : masterLeadNumber;
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
            agreement: masterLead.docs_url ? (
              <a 
                href={masterLead.docs_url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 underline"
              >
                View Agreement
              </a>
            ) : '---',
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
          subLeadsData.forEach((lead, index) => {
            const subLeadNumber = lead.manual_id || String(lead.id);
            const displayNumber = lead.stage === 100 ? `C${subLeadNumber}` : subLeadNumber;
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
              agreement: lead.docs_url ? (
                <a 
                  href={lead.docs_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 underline"
                >
                  View Agreement
                </a>
              ) : '---',
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
          employeesCount: employees?.length || 0,
          stagesCount: stages?.length || 0
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
                    
                    // Use lead_number if available, then manual_id, otherwise fallback to id
                    let displayNumber = masterLeadInfo.lead_number || masterLeadInfo.manual_id || String(masterLeadInfo.id);
                    
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
                          {subLead.applicants > 0 && (
                            <div className="flex items-center gap-2" title="Applicants">
                              <UserIcon className="h-4 w-4 text-base-content/50" />
                              <span>{subLead.applicants} applicant{subLead.applicants !== 1 ? 's' : ''}</span>
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
    </div>
  );
};

export default MasterLeadPage;
