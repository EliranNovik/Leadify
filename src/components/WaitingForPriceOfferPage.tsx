import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { 
  DocumentTextIcon,
  MagnifyingGlassIcon
} from '@heroicons/react/24/outline';
import { fetchStageNames, areStagesEquivalent } from '../lib/stageUtils';

interface LeadRow {
  id: string;
  lead_number: string;
  client_name: string;
  category: string;
  topic: string;
  manager: string;
  helper: string;
  meeting_date: string | null;
  lead_type: 'new' | 'legacy';
  applicants: number | null;
  value: string | null;
}

const WaitingForPriceOfferPage: React.FC = () => {
  const navigate = useNavigate();
  const [assignedLeads, setAssignedLeads] = useState<LeadRow[]>([]);
  const [unassignedLeads, setUnassignedLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [userEmployeeId, setUserEmployeeId] = useState<number | null>(null);
  const [userDisplayName, setUserDisplayName] = useState<string | null>(null);
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [employeeNameMap, setEmployeeNameMap] = useState<Map<string | number, string>>(new Map());
  const [currencyMap, setCurrencyMap] = useState<Map<number, string>>(new Map());
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [filteredCategoryOptions, setFilteredCategoryOptions] = useState<string[]>([]);
  const [waitingStageIds, setWaitingStageIds] = useState<number[]>([]);
  const WAITING_STAGE_TARGET = 'Waiting for Mtng sum';

  // Helper function to get category display name with main category (like Calendar)
  const getCategoryDisplayName = (categoryId: string | number | null | undefined, fallbackCategory?: string) => {
    if (!categoryId || categoryId === '---' || categoryId === '--') {
      if (fallbackCategory && fallbackCategory.trim() !== '') {
        const foundCategory = allCategories.find((cat: any) => 
          cat.name.toLowerCase().trim() === fallbackCategory.toLowerCase().trim()
        );
        if (foundCategory) {
          if (foundCategory.misc_maincategory?.name) {
            return `${foundCategory.name} (${foundCategory.misc_maincategory.name})`;
          } else {
            return foundCategory.name;
          }
        } else {
          return fallbackCategory;
        }
      }
      return 'Not specified';
    }
    
    const category = allCategories.find((cat: any) => cat.id.toString() === categoryId.toString());
    if (category) {
      if (category.misc_maincategory?.name) {
        return `${category.name} (${category.misc_maincategory.name})`;
      } else {
        return category.name;
      }
    }
    
    return fallbackCategory || 'Not specified';
  };

  // Fetch user's employee ID and display name
  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: userData } = await supabase
          .from('users')
          .select(`
            employee_id,
            tenants_employee!employee_id(
              id,
              display_name
            )
          `)
          .eq('auth_id', user.id)
          .single();

        if (userData) {
          if (userData.employee_id) {
            setUserEmployeeId(userData.employee_id);
          }
          if ((userData.tenants_employee as any)?.display_name) {
            setUserDisplayName((userData.tenants_employee as any).display_name);
          }
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
      }
    };

    fetchUserData();
  }, []);

  // Resolve stage IDs for "Waiting for Mtng sum"
  useEffect(() => {
    const resolveWaitingStageIds = async () => {
      try {
        const stageMap = await fetchStageNames();
        const matchedIds = Object.entries(stageMap)
          .filter(([, name]) => areStagesEquivalent(name, WAITING_STAGE_TARGET))
          .map(([id]) => Number(id))
          .filter(id => !Number.isNaN(id));

        if (matchedIds.length > 0) {
          setWaitingStageIds(Array.from(new Set(matchedIds)));
        } else {
          // Fallback to legacy numeric ID if mapping not found
          setWaitingStageIds([40]);
        }
      } catch (error) {
        console.error('Error resolving Waiting for Mtng sum stage IDs:', error);
        setWaitingStageIds([40]);
      }
    };

    resolveWaitingStageIds();
  }, []);

  // Fetch categories with main category relationship (like Calendar)
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const { data, error } = await supabase
          .from('misc_category')
          .select(`
            id,
            name,
            parent_id,
            misc_maincategory!parent_id(
              id,
              name
            )
          `)
          .order('name', { ascending: true });

        if (error) throw error;

        setAllCategories(data || []);
        
        // Format category names with main category in parentheses (like LeadSearchPage)
        const formattedCategories = data?.map((category: any) => {
          if (category.misc_maincategory?.name) {
            return `${category.name} (${category.misc_maincategory.name})`;
          } else {
            return category.name;
          }
        }).filter(Boolean) || [];
        
        setCategoryOptions(formattedCategories);
        setFilteredCategoryOptions(formattedCategories);
      } catch (error) {
        console.error('Error fetching categories:', error);
      }
    };

    fetchCategories();
  }, []);

  // Fetch employees for name mapping
  useEffect(() => {
    const fetchEmployees = async () => {
      try {
        const { data, error } = await supabase
          .from('tenants_employee')
          .select('id, display_name');

        if (error) throw error;

        const map = new Map<string | number, string>();
        data?.forEach(emp => {
          map.set(emp.id, emp.display_name);
        });
        setEmployeeNameMap(map);
      } catch (error) {
        console.error('Error fetching employees:', error);
      }
    };

    fetchEmployees();
  }, []);

  // Fetch currencies for value display
  useEffect(() => {
    const fetchCurrencies = async () => {
      try {
        // Try multiple currency tables (like other components do)
        const [currenciesResult, accountingCurrenciesResult] = await Promise.all([
          supabase.from('currencies').select('id, name, iso_code, front_name'),
          supabase.from('accounting_currencies').select('id, name, iso_code')
        ]);

        let currencyData: any[] = [];
        
        // Prefer currencies table, fallback to accounting_currencies
        if (!currenciesResult.error && currenciesResult.data && currenciesResult.data.length > 0) {
          currencyData = currenciesResult.data;
        } else if (!accountingCurrenciesResult.error && accountingCurrenciesResult.data && accountingCurrenciesResult.data.length > 0) {
          currencyData = accountingCurrenciesResult.data;
        }

        const map = new Map<number, string>();
        currencyData.forEach((curr: any) => {
          // Try different field names for currency symbol
          const symbol = curr.front_name || curr.name || curr.iso_code || '₪';
          // Handle both UUID and numeric IDs
          const id = typeof curr.id === 'string' ? parseInt(curr.id) || curr.id : curr.id;
          map.set(id, symbol);
        });
        
        // If no currencies found, add fallback mappings
        if (map.size === 0) {
          map.set(1, '₪');
          map.set(2, '$');
          map.set(3, '€');
          map.set(4, '£');
        }
        
        setCurrencyMap(map);
      } catch (error) {
        console.error('Error fetching currencies:', error);
        // Set fallback currency map on error
        const fallbackMap = new Map<number, string>();
        fallbackMap.set(1, '₪');
        fallbackMap.set(2, '$');
        fallbackMap.set(3, '€');
        fallbackMap.set(4, '£');
        setCurrencyMap(fallbackMap);
      }
    };

    fetchCurrencies();
  }, []);

  // Helper function to get currency symbol
  const getCurrencySymbol = (currencyId: number | null | undefined, currencyCode?: string) => {
    if (currencyCode) return currencyCode;
    if (currencyId && currencyMap.has(currencyId)) {
      return currencyMap.get(currencyId) || '₪';
    }
    return '₪';
  };

  // Fetch leads
  useEffect(() => {
    const fetchLeads = async () => {
      if (!userEmployeeId && !userDisplayName) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const assigned: LeadRow[] = [];
        const unassigned: LeadRow[] = [];

        // Fetch new leads with the resolved stage IDs
        const stageIdsToUse = waitingStageIds.length > 0 ? waitingStageIds : [40];
        let newLeadsQuery = supabase
          .from('leads')
          .select(`
            id,
            lead_number,
            name,
            category_id,
            category,
            topic,
            manager,
            helper,
            stage,
            balance,
            balance_currency,
            meetings!client_id(
              meeting_date
            ),
            misc_category!category_id(
              id,
              name,
              parent_id,
              misc_maincategory!parent_id(
                id,
                name
              )
            )
          `)
          .limit(1000); // safety cap

        if (stageIdsToUse.length === 1) {
          newLeadsQuery = newLeadsQuery.eq('stage', stageIdsToUse[0]);
        } else {
          newLeadsQuery = newLeadsQuery.in('stage', stageIdsToUse);
        }

        const { data: newLeadsData, error: newLeadsError } = await newLeadsQuery;

        if (newLeadsError) {
          console.error('Error fetching new leads:', newLeadsError);
        } else if (newLeadsData) {
          // Fetch applicants count for all new leads
          const newLeadIds = newLeadsData.map((l: any) => l.id);
          let applicantsCountMap = new Map<string, number>();
          
          if (newLeadIds.length > 0) {
            const { data: contactsData } = await supabase
              .from('contacts')
              .select('lead_id')
              .in('lead_id', newLeadIds)
              .eq('is_persecuted', false);
            
            if (contactsData) {
              contactsData.forEach((contact: any) => {
                const count = applicantsCountMap.get(contact.lead_id) || 0;
                applicantsCountMap.set(contact.lead_id, count + 1);
              });
            }
          }

          newLeadsData.forEach((lead: any) => {
            // Check if user is manager or helper
            const isManager = userDisplayName && (
              (typeof lead.manager === 'string' && lead.manager.trim() === userDisplayName.trim()) ||
              (lead.manager && String(lead.manager) === String(userEmployeeId))
            );
            const isHelper = userDisplayName && (
              (typeof lead.helper === 'string' && lead.helper.trim() === userDisplayName.trim()) ||
              (lead.helper && String(lead.helper) === String(userEmployeeId))
            );

            const hasManager = lead.manager && lead.manager !== '---' && lead.manager !== '';
            const hasHelper = lead.helper && lead.helper !== '---' && lead.helper !== '';

            // Get meeting date (use most recent meeting if multiple)
            let meetingDate = null;
            if (lead.meetings && Array.isArray(lead.meetings) && lead.meetings.length > 0) {
              // Sort by date descending and get the most recent
              const sortedMeetings = [...lead.meetings].sort((a: any, b: any) => {
                const dateA = a.meeting_date ? new Date(a.meeting_date).getTime() : 0;
                const dateB = b.meeting_date ? new Date(b.meeting_date).getTime() : 0;
                return dateB - dateA;
              });
              meetingDate = sortedMeetings[0].meeting_date;
            }

            // Format value
            const balance = lead.balance ? parseFloat(String(lead.balance)) : null;
            const currency = getCurrencySymbol(null, lead.balance_currency);
            const valueStr = balance !== null && !isNaN(balance) 
              ? `${balance.toLocaleString()} ${currency}`
              : null;

            const row: LeadRow = {
              id: lead.id,
              lead_number: lead.lead_number || '',
              client_name: lead.name || '',
              category: getCategoryDisplayName(lead.category_id, lead.category),
              topic: lead.topic || 'Not specified',
              manager: typeof lead.manager === 'string' 
                ? lead.manager 
                : (lead.manager ? employeeNameMap.get(lead.manager) || 'Unknown' : 'Unassigned'),
              helper: typeof lead.helper === 'string' 
                ? lead.helper 
                : (lead.helper ? employeeNameMap.get(lead.helper) || 'Unknown' : 'Unassigned'),
              meeting_date: meetingDate,
              lead_type: 'new',
              applicants: applicantsCountMap.get(lead.id) || null,
              value: valueStr
            };

            if (isManager || isHelper) {
              assigned.push(row);
            } else if (!hasManager && !hasHelper) {
              unassigned.push(row);
            }
          });
        }

        // Fetch legacy leads with stage 40 (exclude status 10 - inactive)
        let legacyLeadsQuery = supabase
          .from('leads_lead')
          .select(`
            id,
            name,
            category_id,
            category,
            topic,
            meeting_manager_id,
            meeting_lawyer_id,
            stage,
            meeting_date,
            no_of_applicants,
            total,
            currency_id,
            misc_category!category_id(
              id,
              name,
              parent_id,
              misc_maincategory!parent_id(
                id,
                name
              )
            )
          `)
          .eq('stage', 40)
          .neq('status', 10); // Exclude inactive leads (status 10)

        const { data: legacyLeadsData, error: legacyLeadsError } = await legacyLeadsQuery;

        if (legacyLeadsError) {
          console.error('Error fetching legacy leads:', legacyLeadsError);
        } else if (legacyLeadsData) {
          legacyLeadsData.forEach((lead: any) => {
            // Check if user is manager or lawyer
            const isManager = userEmployeeId && lead.meeting_manager_id && 
              String(lead.meeting_manager_id) === String(userEmployeeId);
            const isHelper = userEmployeeId && lead.meeting_lawyer_id && 
              String(lead.meeting_lawyer_id) === String(userEmployeeId);

            const hasManager = lead.meeting_manager_id && lead.meeting_manager_id !== null;
            const hasHelper = lead.meeting_lawyer_id && lead.meeting_lawyer_id !== null;

            // Format value
            const total = lead.total ? parseFloat(String(lead.total)) : null;
            const currency = getCurrencySymbol(lead.currency_id);
            const valueStr = total !== null && !isNaN(total) 
              ? `${total.toLocaleString()} ${currency}`
              : null;

            const row: LeadRow = {
              id: `legacy_${lead.id}`,
              lead_number: lead.id?.toString() || '',
              client_name: lead.name || '',
              category: getCategoryDisplayName(lead.category_id, lead.category),
              topic: lead.topic || 'Not specified',
              manager: lead.meeting_manager_id 
                ? (employeeNameMap.get(lead.meeting_manager_id) || 'Unknown')
                : 'Unassigned',
              helper: lead.meeting_lawyer_id 
                ? (employeeNameMap.get(lead.meeting_lawyer_id) || 'Unknown')
                : 'Unassigned',
              meeting_date: lead.meeting_date,
              lead_type: 'legacy',
              applicants: lead.no_of_applicants || null,
              value: valueStr
            };

            if (isManager || isHelper) {
              assigned.push(row);
            } else if (!hasManager && !hasHelper) {
              unassigned.push(row);
            }
          });
        }

        setAssignedLeads(assigned);
        setUnassignedLeads(unassigned);
      } catch (error) {
        console.error('Error fetching leads:', error);
      } finally {
        setLoading(false);
      }
    };

    if (
      allCategories.length > 0 &&
      employeeNameMap.size > 0 &&
      currencyMap.size > 0 &&
      waitingStageIds.length > 0
    ) {
      fetchLeads();
    }
  }, [
    userEmployeeId,
    userDisplayName,
    allCategories,
    employeeNameMap,
    currencyMap,
    waitingStageIds,
  ]);

  const formatDate = (date: string | null) => {
    if (!date) return 'Not set';
    try {
      return new Date(date).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    } catch {
      return 'Invalid date';
    }
  };

  const handleRowClick = (lead: LeadRow) => {
    if (lead.lead_type === 'legacy') {
      navigate(`/clients/${lead.lead_number}`);
    } else {
      navigate(`/clients/${lead.lead_number}`);
    }
  };

  // Filter leads based on search term and categories
  const filteredAssignedLeads = useMemo(() => {
    let filtered = assignedLeads;

    // Filter by search term (lead number or client name)
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(lead =>
        lead.lead_number.toLowerCase().includes(searchLower) ||
        lead.client_name.toLowerCase().includes(searchLower)
      );
    }

    // Filter by categories
    if (selectedCategories.length > 0) {
      filtered = filtered.filter(lead =>
        selectedCategories.includes(lead.category)
      );
    }

    return filtered;
  }, [assignedLeads, searchTerm, selectedCategories]);

  const filteredUnassignedLeads = useMemo(() => {
    let filtered = unassignedLeads;

    // Filter by search term (lead number or client name)
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(lead =>
        lead.lead_number.toLowerCase().includes(searchLower) ||
        lead.client_name.toLowerCase().includes(searchLower)
      );
    }

    // Filter by categories
    if (selectedCategories.length > 0) {
      filtered = filtered.filter(lead =>
        selectedCategories.includes(lead.category)
      );
    }

    return filtered;
  }, [unassignedLeads, searchTerm, selectedCategories]);

  const handleCategorySelect = (value: string) => {
    if (!selectedCategories.includes(value)) {
      setSelectedCategories([...selectedCategories, value]);
    }
  };

  const handleCategoryRemove = (value: string) => {
    setSelectedCategories(selectedCategories.filter(cat => cat !== value));
  };

  const handleCategoryFilterChange = (value: string) => {
    const filtered = categoryOptions.filter(option =>
      option.toLowerCase().includes(value.toLowerCase()) &&
      !selectedCategories.includes(option)
    );
    setFilteredCategoryOptions(filtered);
  };

  const renderTable = (leads: LeadRow[], title: string) => (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden hidden md:block">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-xl font-bold text-gray-900">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="table w-full">
          <thead>
            <tr className="bg-gray-50">
              <th className="font-semibold text-gray-700">Lead</th>
              <th className="font-semibold text-gray-700">Category</th>
              <th className="font-semibold text-gray-700">Topic</th>
              <th className="font-semibold text-gray-700">Manager/Helper</th>
              <th className="font-semibold text-gray-700">Applicants</th>
              <th className="font-semibold text-gray-700">Value (Total)</th>
              <th className="font-semibold text-gray-700">Meeting Date</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-500">
                  No leads found
                </td>
              </tr>
            ) : (
              leads.map((lead) => (
                <tr
                  key={lead.id}
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => handleRowClick(lead)}
                >
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{lead.lead_number}</span>
                      <span className="text-gray-700">{lead.client_name}</span>
                    </div>
                  </td>
                  <td>
                    <span className="text-gray-700">{lead.category}</span>
                  </td>
                  <td>
                    <span className="text-gray-700">{lead.topic}</span>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-700">
                        {lead.manager === 'Unassigned' ? (
                          <span className="text-gray-400 italic">Unassigned</span>
                        ) : (
                          lead.manager
                        )}
                      </span>
                      <span className="text-gray-400">/</span>
                      <span className="text-sm text-gray-700">
                        {lead.helper === 'Unassigned' ? (
                          <span className="text-gray-400 italic">Unassigned</span>
                        ) : (
                          lead.helper
                        )}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className="text-gray-700">{lead.applicants !== null ? lead.applicants : '---'}</span>
                  </td>
                  <td>
                    <span className="text-gray-700 font-medium">{lead.value || '---'}</span>
                  </td>
                  <td>
                    <span className="text-gray-700">{formatDate(lead.meeting_date)}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderCards = (leads: LeadRow[], title: string) => (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden md:hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-xl font-bold text-gray-900">{title}</h3>
      </div>
      <div className="flex gap-4 overflow-x-auto py-4 px-4 scrollbar-hide">
        {leads.length === 0 ? (
          <div className="w-full text-center py-8 text-gray-500">
            No leads found
          </div>
        ) : (
          leads.map((lead) => (
            <div
              key={lead.id}
              className="min-w-[85vw] max-w-[90vw] card bg-base-100 shadow-lg hover:shadow-2xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 cursor-pointer group"
              style={{ flex: '0 0 85vw' }}
              onClick={() => handleRowClick(lead)}
            >
              <div className="card-body p-5">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex flex-col">
                    <h2 className="card-title text-xl font-bold group-hover:text-primary transition-colors">
                      {lead.client_name}
                    </h2>
                    <p className="text-sm text-base-content/60 font-mono mt-1">#{lead.lead_number}</p>
                  </div>
                </div>
                
                <div className="divider my-2"></div>

                <div className="grid grid-cols-1 gap-3 text-sm mt-2">
                  <div className="flex items-center gap-2" title="Category">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    <span className="font-medium">{lead.category || 'N/A'}</span>
                  </div>
                  
                  <div className="flex items-center gap-2" title="Topic">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                    </svg>
                    <span>{lead.topic || 'No topic specified'}</span>
                  </div>
                  
                  <div className="flex items-center gap-2" title="Manager/Helper">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <span>
                      {lead.manager === 'Unassigned' ? (
                        <span className="text-gray-400 italic">Unassigned</span>
                      ) : (
                        lead.manager
                      )} / {lead.helper === 'Unassigned' ? (
                        <span className="text-gray-400 italic">Unassigned</span>
                      ) : (
                        lead.helper
                      )}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-2" title="Applicants">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    <span className="font-medium">{lead.applicants !== null ? lead.applicants : '---'}</span>
                  </div>
                  
                  <div className="flex items-center gap-2" title="Value (Total)">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="font-semibold text-primary">{lead.value || '---'}</span>
                  </div>
                  
                  <div className="flex items-center gap-2" title="Meeting Date">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="font-medium">{formatDate(lead.meeting_date)}</span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="p-4 sm:p-6 md:p-8">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-gradient-to-tr from-purple-500 to-blue-600 rounded-lg flex items-center justify-center">
            <DocumentTextIcon className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Waiting for Price Offer</h1>
            <p className="text-sm text-gray-500">Leads in stage "Waiting for Mtng sum" awaiting price offers</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-12">
          <span className="loading loading-spinner loading-lg text-purple-600"></span>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Search and Filter Bar */}
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Search Bar */}
              <div className="form-control">
                <label className="label mb-2">
                  <span className="label-text font-semibold">Search</span>
                </label>
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search by lead number or client name..."
                    className="input input-bordered w-full pl-10"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>

              {/* Category Filter */}
              <div className="form-control relative">
                <label className="label mb-2">
                  <span className="label-text font-semibold">Category</span>
                  {selectedCategories.length > 0 && (
                    <span className="label-text-alt text-purple-600 font-medium">
                      {selectedCategories.length} selected
                    </span>
                  )}
                </label>
                
                {/* Selected categories */}
                {selectedCategories.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {selectedCategories.map((category, index) => (
                      <span
                        key={index}
                        className="badge badge-primary badge-lg gap-2"
                      >
                        {category}
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs p-0 h-auto min-h-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCategoryRemove(category);
                          }}
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Category Input */}
                <div className="relative">
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    placeholder={selectedCategories.length === 0 ? "Type category or choose from suggestions..." : "Add more..."}
                    onChange={(e) => {
                      handleCategoryFilterChange(e.target.value);
                      setShowCategoryDropdown(true);
                    }}
                    onFocus={() => {
                      if (categoryOptions.length > 0) {
                        setShowCategoryDropdown(true);
                      }
                    }}
                    onBlur={() => {
                      setTimeout(() => setShowCategoryDropdown(false), 200);
                    }}
                  />
                  {showCategoryDropdown && filteredCategoryOptions.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                      {filteredCategoryOptions.map((option, index) => (
                        <div
                          key={index}
                          className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm flex items-center gap-2"
                          onClick={() => {
                            handleCategorySelect(option);
                            setShowCategoryDropdown(false);
                          }}
                        >
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                          </svg>
                          {option}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Results */}
          {filteredAssignedLeads.length > 0 && (
            <>
              {renderTable(filteredAssignedLeads, `My Leads (${filteredAssignedLeads.length})`)}
              {renderCards(filteredAssignedLeads, `My Leads (${filteredAssignedLeads.length})`)}
            </>
          )}
          {filteredUnassignedLeads.length > 0 && (
            <>
              {renderTable(filteredUnassignedLeads, `Unassigned Leads (${filteredUnassignedLeads.length})`)}
              {renderCards(filteredUnassignedLeads, `Unassigned Leads (${filteredUnassignedLeads.length})`)}
            </>
          )}
          {filteredAssignedLeads.length === 0 && filteredUnassignedLeads.length === 0 && assignedLeads.length + unassignedLeads.length > 0 && (
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-12 text-center">
              <DocumentTextIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-700 mb-2">No leads found</h3>
              <p className="text-gray-500">No leads match your search criteria.</p>
            </div>
          )}
          {assignedLeads.length === 0 && unassignedLeads.length === 0 && (
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-12 text-center">
              <DocumentTextIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-700 mb-2">No leads found</h3>
              <p className="text-gray-500">There are no leads in stage "Waiting for Mtng sum" at this time.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WaitingForPriceOfferPage;

