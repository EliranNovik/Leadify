import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { getStageColour } from '../lib/stageUtils';

interface Case {
  id: string;
  lead_number: string;
  client_name: string;
  category: string;
  stage: string;
  stage_colour?: string | null;
  assigned_date: string;
  applicants_count: number | null;
  value: number | null;
  currency: string | null;
}

// Helper function to get contrasting text color based on background
const getContrastingTextColor = (hexColor?: string | null) => {
  if (!hexColor) return '#111827'; // Default to black if no color
  let sanitized = hexColor.trim();
  if (sanitized.startsWith('#')) sanitized = sanitized.slice(1);
  if (sanitized.length === 3) {
    sanitized = sanitized.split('').map(char => char + char).join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(sanitized)) {
    return '#111827';
  }
  const r = parseInt(sanitized.slice(0, 2), 16) / 255;
  const g = parseInt(sanitized.slice(2, 4), 16) / 255;
  const b = parseInt(sanitized.slice(4, 6), 16) / 255;

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.55 ? '#111827' : '#ffffff';
};

const MyCasesPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [newCases, setNewCases] = useState<Case[]>([]);
  const [otherCases, setOtherCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStage, setSelectedStage] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  useEffect(() => {
    if (user?.id) {
      fetchMyCases();
    }
  }, [user?.id]);

  const fetchMyCases = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get current user's employee ID from users table
      console.log('🔍 MyCases - Current user ID:', user?.id);
      
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('employee_id')
        .eq('auth_id', user?.id)
        .single();

      console.log('🔍 MyCases - User data query result:', { userData, userError });

      if (userError || !userData?.employee_id) {
        console.error('🔍 MyCases - Employee lookup failed:', { userError, userData });
        throw new Error('Employee not found for current user');
      }

      const employeeId = userData.employee_id;
      console.log('🔍 MyCases - Employee ID found:', employeeId);

      // Calculate date 1 week ago
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      const oneWeekAgoISO = oneWeekAgo.toISOString().split('T')[0];

      console.log('🔍 MyCases - Fetching leads with case_handler_id:', employeeId);
      
      // Use a targeted approach - only last 6 months for better performance
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const sixMonthsAgoISO = sixMonthsAgo.toISOString().split('T')[0];
      
      console.log('🔍 MyCases - Date range:', { sixMonthsAgoISO });
      
      // Let's check what case_handler_id values exist in the database
      const { data: allCaseHandlers, error: handlersError } = await supabase
        .from('leads_lead')
        .select('case_handler_id')
        .not('case_handler_id', 'is', null)
        .limit(20);
      
      console.log('🔍 MyCases - Sample case_handler_id values in database:', { 
        allCaseHandlers: allCaseHandlers?.map(l => l.case_handler_id),
        handlersError 
      });
      
      // First, let's check if there are ANY leads with this case_handler_id
      const { data: testLeads, error: testError } = await supabase
        .from('leads_lead')
        .select('id, case_handler_id, cdate')
        .eq('case_handler_id', employeeId)
        .limit(5);
      
      console.log('🔍 MyCases - Test query (any leads with this case_handler_id):', { 
        testLeads, 
        testError,
        count: testLeads?.length || 0 
      });
      
      const { data: leadsData, error: leadsError } = await supabase
        .from('leads_lead')
        .select(`
          id,
          manual_id,
          name,
          stage,
          category_id,
          cdate,
          no_of_applicants,
          total,
          currency_id,
          accounting_currencies!leads_lead_currency_id_fkey (
            name,
            iso_code
          )
        `)
        .eq('case_handler_id', employeeId)
        // Remove status filter - let's see all leads assigned to this handler
        // Remove date filter - let's see all leads regardless of date
        .order('cdate', { ascending: false })
        .limit(100); // Increased limit since we have proper indexes now

      console.log('🔍 MyCases - Leads query result:', { 
        leadsData, 
        leadsError,
        count: leadsData?.length || 0 
      });

      if (leadsError) throw leadsError;

      console.log('🔍 MyCases - Leads fetched:', leadsData?.length || 0);

      // Fetch stage names and colors separately (since foreign key relationship doesn't exist yet)
      const { data: stages } = await supabase
        .from('lead_stages')
        .select('id, name, colour');

      // Fetch categories with their parent main category names using JOINs
      const { data: allCategories } = await supabase
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

      // Create lookup maps
      const stageMap = new Map();
      const stageColourMap = new Map();
      stages?.forEach(stage => {
        stageMap.set(String(stage.id), stage.name);
        if (stage.colour) {
          stageColourMap.set(String(stage.id), stage.colour);
        }
      });

      // Helper function to get category name with main category (like PipelinePage)
      const getCategoryName = (categoryId: string | number | null | undefined) => {
        if (!categoryId || categoryId === '---') return 'Unknown';
        
        const category = allCategories?.find((cat: any) => cat.id.toString() === categoryId.toString()) as any;
        if (category) {
          // Return category name with main category in parentheses
          if (category.misc_maincategory?.name) {
            return `${category.name} (${category.misc_maincategory.name})`;
          } else {
            return category.name;
          }
        }
        
        return 'Unknown';
      };

      console.log('🔍 MyCases - Lookup maps created:', {
        stagesCount: stages?.length || 0,
        categoriesCount: allCategories?.length || 0,
        sampleCategories: allCategories?.slice(0, 3).map((cat: any) => ({ 
          id: cat.id, 
          name: cat.name, 
          mainCategory: cat.misc_maincategory?.name 
        }))
      });

      // Helper function to get currency symbol
      const getCurrencySymbol = (currencyId: number | null | undefined, currencyData: any): string => {
        if (!currencyId) return '₪'; // Default to shekel
        
        // Handle currency data (could be array or object)
        const currency = Array.isArray(currencyData) ? currencyData[0] : currencyData;
        
        if (currency?.iso_code) {
          // Map ISO codes to symbols
          const symbolMap: { [key: string]: string } = {
            'ILS': '₪',
            'USD': '$',
            'EUR': '€',
            'GBP': '£',
            'CAD': 'C$',
            'AUD': 'A$',
            'JPY': '¥',
            'CHF': 'CHF',
            'SEK': 'kr',
            'NOK': 'kr',
            'DKK': 'kr',
            'PLN': 'zł',
            'CZK': 'Kč',
            'HUF': 'Ft',
            'RON': 'lei',
            'BGN': 'лв',
            'HRK': 'kn',
            'RUB': '₽',
            'UAH': '₴',
            'TRY': '₺'
          };
          return symbolMap[currency.iso_code] || currency.iso_code;
        }
        
        // Fallback to currency_id mapping if no currency data
        const fallbackMap: { [key: number]: string } = {
          1: '₪',
          2: '€',
          3: '$',
          4: '£'
        };
        return fallbackMap[currencyId] || '₪';
      };

      // Process the data with proper lookups
      const processedCases: Case[] = (leadsData || []).map(lead => {
        const leadNumber = lead.manual_id || lead.id;
        const category = getCategoryName(lead.category_id);
        const stage = stageMap.get(String(lead.stage)) || String(lead.stage) || 'Unknown';
        const stageColour = stageColourMap.get(String(lead.stage)) || getStageColour(String(lead.stage)) || null;
        const value = lead.total || null;
        const currency = getCurrencySymbol(lead.currency_id, lead.accounting_currencies);

        return {
          id: lead.id,
          lead_number: String(leadNumber), // Keep the full lead number including sub-leads for display
          client_name: lead.name || 'Unknown',
          category,
          stage,
          stage_colour: stageColour, // Add stage colour to the case object
          assigned_date: lead.cdate,
          applicants_count: lead.no_of_applicants,
          value,
          currency
        };
      });

      // Separate into new and other cases
      const newCasesList = processedCases.filter(caseItem => 
        new Date(caseItem.assigned_date) >= new Date(oneWeekAgoISO)
      );
      const otherCasesList = processedCases.filter(caseItem => 
        new Date(caseItem.assigned_date) < new Date(oneWeekAgoISO)
      );

      console.log('🔍 MyCases - Cases separated:', {
        newCases: newCasesList.length,
        otherCases: otherCasesList.length
      });

      setNewCases(newCasesList);
      setOtherCases(otherCasesList);

    } catch (err) {
      console.error('Error fetching my cases:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch cases');
    } finally {
      setLoading(false);
    }
  };

  const handleCaseClick = (caseItem: Case) => {
    // Navigate using the actual database ID, not the manual_id
    // The manual_id (like "150667/3") is just for display
    // The actual lead ID (like "172517") is used for navigation
    navigate(`/clients/${caseItem.id}`);
  };

  // Fuzzy search function
  const fuzzySearch = (text: string, query: string): boolean => {
    if (!query) return true;
    
    const textLower = text.toLowerCase();
    const queryLower = query.toLowerCase().trim();
    
    // Direct substring match
    if (textLower.includes(queryLower)) return true;
    
    // Fuzzy match - check if all characters in query appear in order in text
    let queryIndex = 0;
    for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
      if (textLower[i] === queryLower[queryIndex]) {
        queryIndex++;
      }
    }
    return queryIndex === queryLower.length;
  };

  // Filter cases based on search query, stage, and category
  const filterCases = (cases: Case[]): Case[] => {
    return cases.filter(caseItem => {
      // Search filter
      const matchesSearch = !searchQuery.trim() || 
        fuzzySearch(caseItem.lead_number, searchQuery) ||
        fuzzySearch(caseItem.client_name, searchQuery);
      
      // Stage filter
      const matchesStage = !selectedStage || caseItem.stage === selectedStage;
      
      // Category filter
      const matchesCategory = !selectedCategory || caseItem.category === selectedCategory;
      
      return matchesSearch && matchesStage && matchesCategory;
    });
  };

  const filteredNewCases = filterCases(newCases);
  const filteredOtherCases = filterCases(otherCases);

  // Get unique stages and categories from all cases
  const allCases = [...newCases, ...otherCases];
  const uniqueStages = Array.from(new Set(allCases.map(c => c.stage))).sort();
  const uniqueCategories = Array.from(new Set(allCases.map(c => c.category))).sort();

  // Check if any filter is active
  const hasActiveFilters = searchQuery.trim() || selectedStage || selectedCategory;

  // Clear all filters function
  const clearAllFilters = () => {
    setSearchQuery('');
    setSelectedStage('');
    setSelectedCategory('');
  };

  const renderTable = (cases: Case[], title: string, emptyMessage: string) => (
    <div className="bg-white rounded-lg shadow-sm border">
      <div className="px-3 sm:px-6 py-2 sm:py-4 border-b">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900">{title}</h2>
      </div>
      
      {cases.length === 0 ? (
        <div className="px-3 sm:px-6 py-8 sm:py-12 text-center">
          <p className="text-sm sm:text-base text-gray-500">{emptyMessage}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table w-full table-compact sm:table-normal">
            <thead>
              <tr className="bg-white">
                <th className="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 text-left text-[10px] sm:text-xs font-medium text-gray-900 uppercase tracking-wider">
                  Case
                </th>
                <th className="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 text-left text-[10px] sm:text-xs font-medium text-gray-900 uppercase tracking-wider">
                  Client
                </th>
                <th className="hidden md:table-cell px-2 sm:px-4 lg:px-6 py-2 sm:py-3 text-left text-[10px] sm:text-xs font-medium text-gray-900 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 text-center text-[10px] sm:text-xs font-medium text-gray-900 uppercase tracking-wider">
                  Applicants
                </th>
                <th className="hidden md:table-cell px-2 sm:px-4 lg:px-6 py-2 sm:py-3 text-right text-[10px] sm:text-xs font-medium text-gray-900 uppercase tracking-wider">
                  Value
                </th>
                <th className="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 text-right text-[10px] sm:text-xs font-medium text-gray-900 uppercase tracking-wider">
                  Stage
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {cases.map((caseItem) => (
                <tr 
                  key={caseItem.id} 
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => handleCaseClick(caseItem)}
                >
                  <td className="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4">
                    <span className="text-black font-medium text-xs sm:text-sm">
                      {caseItem.lead_number}
                    </span>
                  </td>
                  <td className="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-gray-900 text-xs sm:text-sm">
                    <div className="whitespace-nowrap">
                      {caseItem.client_name}
                    </div>
                    <div className="md:hidden text-[10px] text-gray-500 mt-0.5 space-y-0.5">
                      <div className="whitespace-nowrap">{caseItem.category}</div>
                      {caseItem.value !== null && caseItem.value !== undefined && (
                        <div className="whitespace-nowrap font-medium text-gray-700">
                          {caseItem.currency || '₪'}{typeof caseItem.value === 'number' ? caseItem.value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : caseItem.value}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="hidden md:table-cell px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-gray-900 text-xs sm:text-sm">
                    <div className="max-w-[150px] lg:max-w-none truncate lg:whitespace-nowrap">
                      {caseItem.category}
                    </div>
                  </td>
                  <td className="px-1 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-center text-gray-900 text-xs sm:text-sm">
                    {caseItem.applicants_count || 0}
                  </td>
                  <td className="hidden md:table-cell px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-right text-gray-900 text-xs sm:text-sm">
                    {caseItem.value !== null && caseItem.value !== undefined ? (
                      <span className="font-medium">
                        {caseItem.currency || '₪'}{typeof caseItem.value === 'number' ? caseItem.value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : caseItem.value}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-2 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 text-right">
                    {caseItem.stage_colour ? (() => {
                      const badgeTextColour = getContrastingTextColor(caseItem.stage_colour);
                      return (
                        <span 
                          className="badge text-xs sm:text-sm px-1.5 sm:px-2 py-0.5 sm:py-1" 
                          style={{ 
                            backgroundColor: caseItem.stage_colour, 
                            color: badgeTextColour 
                          }}
                        >
                          {caseItem.stage}
                        </span>
                      );
                    })() : (
                      <span className="badge text-xs sm:text-sm px-1.5 sm:px-2 py-0.5 sm:py-1 bg-gray-100 text-gray-800">
                        {caseItem.stage}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="loading loading-spinner loading-lg text-primary"></div>
          <p className="mt-4 text-gray-600">Loading your cases...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="alert alert-error mb-4">
            <div>
              <h3 className="font-bold">Error Loading Cases</h3>
              <div className="text-xs">{error}</div>
            </div>
          </div>
          <button
            onClick={fetchMyCases}
            className="btn btn-primary"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold text-gray-900">My Cases</h1>
            </div>
          </div>
        </div>
      </div>

      {/* Search Bar and Filters */}
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-6">
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
              </svg>
            </div>
            <input
              type="text"
              className="input input-bordered w-full pl-10"
              placeholder="Search by lead number or client name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
                onClick={() => setSearchQuery('')}
              >
                <svg className="h-5 w-5 text-gray-400 hover:text-gray-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>

          {/* Stage Filter */}
          <div className="w-full sm:w-48">
            <select
              className="select select-bordered w-full"
              value={selectedStage}
              onChange={(e) => setSelectedStage(e.target.value)}
            >
              <option value="">All Stages</option>
              {uniqueStages.map(stage => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
            </select>
          </div>

          {/* Category Filter */}
          <div className="w-full sm:w-64">
            <select
              className="select select-bordered w-full"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="">All Categories</option>
              {uniqueCategories.map(category => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <button
              className="btn btn-ghost btn-sm sm:btn-md"
              onClick={clearAllFilters}
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 pb-4 sm:pb-8">
        <div className="space-y-3 sm:space-y-8">
          {/* New Cases Table */}
          {renderTable(
            filteredNewCases, 
            `New Cases (${filteredNewCases.length}${hasActiveFilters ? ` of ${newCases.length}` : ''})`, 
            hasActiveFilters ? "No matching new cases found." : "No new cases assigned in the last week."
          )}

          {/* Other Cases Table */}
          {renderTable(
            filteredOtherCases, 
            `Other Cases (${filteredOtherCases.length}${hasActiveFilters ? ` of ${otherCases.length}` : ''})`, 
            hasActiveFilters ? "No matching cases found." : "No other cases found."
          )}
        </div>
      </div>
    </div>
  );
};

export default MyCasesPage;
