import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { getStageName } from '../lib/stageUtils';
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
}

const MasterLeadPage: React.FC = () => {
  const { lead_number } = useParams<{ lead_number: string }>();
  const navigate = useNavigate();
  const [subLeads, setSubLeads] = useState<SubLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [subLeadsLoading, setSubLeadsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [masterLeadInfo, setMasterLeadInfo] = useState<any>(null);
  const [stageMap, setStageMap] = useState<Map<string, string>>(new Map());

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

  const getStageBadge = (stage?: string | number, stageMap?: Map<string, string>) => {
    if (!stage) return <span className="badge" style={{ backgroundColor: '#391bcb', color: 'white' }}>Unknown</span>;
    
    const stageName = stageMap?.get(String(stage)) || String(stage);
    
    // All stage badges use the same custom color
    return <span className="badge" style={{ backgroundColor: '#391bcb', color: 'white' }}>{stageName}</span>;
  };

    const fetchSubLeads = async () => {
      if (!lead_number) return;
      
      try {
        setLoading(true);
        setError(null);
        
        // First, get the master lead info with related data
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
            )
          `)
          .eq('id', parseInt(lead_number))
          .single();

        if (masterError) {
          console.error('Error fetching master lead:', masterError);
          setError('Failed to fetch master lead information');
          return;
        }

        setMasterLeadInfo(masterLead);

        // Fetch sub-leads with related data
        setSubLeadsLoading(true);
        const { data: subLeadsData, error: subLeadsError } = await supabase
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
            )
          `)
          .eq('master_id', lead_number)
          .order('id', { ascending: true })
          .limit(50);

        if (subLeadsError) {
          console.error('Error fetching sub-leads:', subLeadsError);
          setError('Failed to fetch sub-leads');
          return;
        }

        // Fetch categories with main categories
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

        // Fetch employees
        const { data: employees } = await supabase
          .from('tenants_employee')
          .select('id, display_name');

        // Fetch stage names
        const { data: stages } = await supabase
          .from('lead_stages')
          .select('id, name');

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

        const stageMap = new Map();
        stages?.forEach(stage => stageMap.set(String(stage.id), stage.name));
        setStageMap(stageMap);

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
            stage: stageMap.get(String(masterLead.stage)) || String(masterLead.stage) || 'Unknown',
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
            scheduler: employeeMap.get(masterLead.meeting_scheduler_id) || '---',
            closer: employeeMap.get(masterLead.closer_id) || '---',
            handler: employeeMap.get(masterLead.case_handler_id) || '---',
            master_id: masterLead.master_id,
            isMaster: true
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
                scheduler: employeeMap.get(lead.meeting_scheduler_id),
                closer_id: lead.closer_id,
                closer: employeeMap.get(lead.closer_id),
                case_handler_id: lead.case_handler_id,
                handler: employeeMap.get(lead.case_handler_id)
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
              stage: stageMap.get(String(lead.stage)) || String(lead.stage) || 'Unknown',
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
              scheduler: employeeMap.get(lead.meeting_scheduler_id) || '---',
              closer: employeeMap.get(lead.closer_id) || '---',
              handler: employeeMap.get(lead.case_handler_id) || '---',
              master_id: lead.master_id,
              isMaster: false
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
    // Use the actual lead ID for navigation, not the display number
    navigate(`/clients/${subLead.actual_lead_id}`);
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
                    
                    // Use manual_id if available, otherwise use id
                    let displayNumber = masterLeadInfo.manual_id || String(masterLeadInfo.id);
                    
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
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Sub-leads Table */}
        <div className="bg-white rounded-lg shadow-sm border">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold text-gray-900">Sub-leads</h2>
          </div>
          
          {subLeads.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <UserIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">No sub-leads found for this master lead.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
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
                      className={`hover:bg-gray-50 cursor-pointer ${subLead.isMaster ? 'bg-blue-50 border-l-4 border-blue-500' : ''}`}
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
                        {getStageBadge(subLead.stage, stageMap)}
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
          )}
        </div>
      </div>
    </div>
  );
};

export default MasterLeadPage;
