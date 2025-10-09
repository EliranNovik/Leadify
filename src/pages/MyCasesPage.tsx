import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';

interface Case {
  id: string;
  lead_number: string;
  client_name: string;
  category: string;
  stage: string;
  assigned_date: string;
}

const MyCasesPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [newCases, setNewCases] = useState<Case[]>([]);
  const [otherCases, setOtherCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          cdate
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

      // Fetch stage names separately (since foreign key relationship doesn't exist yet)
      const { data: stages } = await supabase
        .from('lead_stages')
        .select('id, name');

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
      stages?.forEach(stage => stageMap.set(String(stage.id), stage.name));

      // Helper function to get category name with main category (like PipelinePage)
      const getCategoryName = (categoryId: string | number | null | undefined) => {
        if (!categoryId || categoryId === '---') return 'Unknown';
        
        const category = allCategories?.find((cat: any) => cat.id.toString() === categoryId.toString());
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
        sampleCategories: allCategories?.slice(0, 3).map(cat => ({ 
          id: cat.id, 
          name: cat.name, 
          mainCategory: cat.misc_maincategory?.name 
        }))
      });

      // Process the data with proper lookups
      const processedCases: Case[] = (leadsData || []).map(lead => {
        const leadNumber = lead.manual_id || lead.id;
        const category = getCategoryName(lead.category_id);
        const stage = stageMap.get(String(lead.stage)) || String(lead.stage) || 'Unknown';

        return {
          id: lead.id,
          lead_number: String(leadNumber),
          client_name: lead.name || 'Unknown',
          category,
          stage,
          assigned_date: lead.cdate
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
    navigate(`/clients/${caseItem.lead_number}`);
  };

  const renderTable = (cases: Case[], title: string, emptyMessage: string) => (
    <div className="bg-white rounded-lg shadow-sm border">
      <div className="px-6 py-4 border-b">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      </div>
      
      {cases.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-gray-500">{emptyMessage}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Case
                </th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Client Name
                </th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
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
                  <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                    <span className="text-blue-600 hover:text-blue-800 font-medium">
                      {caseItem.lead_number}
                    </span>
                  </td>
                  <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-gray-900">
                    {caseItem.client_name}
                  </td>
                  <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-gray-900">
                    {caseItem.category}
                  </td>
                  <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                    <span className="badge" style={{ backgroundColor: '#391bcb', color: 'white' }}>
                      {caseItem.stage}
                    </span>
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

      {/* Content */}
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          {/* New Cases Table */}
          {renderTable(
            newCases, 
            `New Cases (${newCases.length})`, 
            "No new cases assigned in the last week."
          )}

          {/* Other Cases Table */}
          {renderTable(
            otherCases, 
            `Other Cases (${otherCases.length})`, 
            "No other cases found."
          )}
        </div>
      </div>
    </div>
  );
};

export default MyCasesPage;
