import React, { useState, useEffect } from 'react';
import { 
  BuildingOfficeIcon, 
  CurrencyDollarIcon, 
  ClockIcon,
  ScaleIcon,
  GlobeAltIcon,
  UserGroupIcon,
  DocumentTextIcon,
  BriefcaseIcon,
  AcademicCapIcon,
  HeartIcon,
  HomeIcon,
  CogIcon,
  ChartBarIcon,
  ShieldCheckIcon,
  UsersIcon,
  WrenchScrewdriverIcon,
  BanknotesIcon,
  ClipboardDocumentListIcon,
  ExclamationTriangleIcon,
  StarIcon
} from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';

interface DepartmentListProps {
  meetings: any[];
  viewMode: 'list' | 'cards';
  renderMeetingCard: (meeting: any) => React.ReactNode;
  renderMeetingRow: (meeting: any) => React.ReactNode;
}

const DepartmentList: React.FC<DepartmentListProps> = ({ 
  meetings, 
  viewMode, 
  renderMeetingCard, 
  renderMeetingRow 
}) => {
  const [departments, setDepartments] = useState<any[]>([]);
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Function to get the appropriate icon for each department
  const getDepartmentIcon = (departmentName: string) => {
    const name = departmentName.toLowerCase();
    
    // Staff Meeting gets a special icon
    if (name.includes('staff')) {
      return <UsersIcon className="w-6 h-6 text-white" />;
    }
    
    // Legal-related departments
    if (name.includes('legal') || name.includes('law') || name.includes('attorney')) {
      return <ScaleIcon className="w-6 h-6 text-white" />;
    }
    
    // Immigration to Israel - Home icon (representing homeland)
    if (name.includes('israel') || name.includes('israeli') || name.includes('aliyah')) {
      return <HomeIcon className="w-6 h-6 text-white" />;
    }
    
    // USA Immigration - Flag icon (using ShieldCheckIcon as flag representation)
    if (name.includes('usa') || name.includes('united states') || name.includes('america') || name.includes('us immigration')) {
      return <ShieldCheckIcon className="w-6 h-6 text-white" />;
    }
    
    // Small cases - different icon from Austria/Germany
    if (name.includes('small cases') || name.includes('small case')) {
      return <DocumentTextIcon className="w-6 h-6 text-white" />;
    }
    
    // Austria and Germany immigration - globe icon
    if (name.includes('austria') || name.includes('german') || name.includes('germany')) {
      return <GlobeAltIcon className="w-6 h-6 text-white" />;
    }
    
    // General immigration-related departments
    if (name.includes('immigration') || name.includes('citizenship') || name.includes('visa') || name.includes('passport')) {
      return <GlobeAltIcon className="w-6 h-6 text-white" />;
    }
    
    // Business/Corporate departments
    if (name.includes('business') || name.includes('corporate') || name.includes('commercial')) {
      return <BriefcaseIcon className="w-6 h-6 text-white" />;
    }
    
    // HR/Personnel departments
    if (name.includes('hr') || name.includes('human') || name.includes('personnel') || name.includes('staff')) {
      return <UserGroupIcon className="w-6 h-6 text-white" />;
    }
    
    // Finance/Accounting departments
    if (name.includes('finance') || name.includes('accounting') || name.includes('financial') || name.includes('money')) {
      return <BanknotesIcon className="w-6 h-6 text-white" />;
    }
    
    // Marketing departments
    if (name.includes('marketing') || name.includes('sales') || name.includes('advertising')) {
      return <ChartBarIcon className="w-6 h-6 text-white" />;
    }
    
    // IT/Technology departments
    if (name.includes('it') || name.includes('technology') || name.includes('tech') || name.includes('computer')) {
      return <CogIcon className="w-6 h-6 text-white" />;
    }
    
    // Education/Training departments
    if (name.includes('education') || name.includes('training') || name.includes('learning') || name.includes('academy')) {
      return <AcademicCapIcon className="w-6 h-6 text-white" />;
    }
    
    // Healthcare/Medical departments
    if (name.includes('health') || name.includes('medical') || name.includes('healthcare') || name.includes('clinic')) {
      return <HeartIcon className="w-6 h-6 text-white" />;
    }
    
    // Real Estate departments
    if (name.includes('real estate') || name.includes('property') || name.includes('housing')) {
      return <HomeIcon className="w-6 h-6 text-white" />;
    }
    
    // Security departments
    if (name.includes('security') || name.includes('safety') || name.includes('protection')) {
      return <ShieldCheckIcon className="w-6 h-6 text-white" />;
    }
    
    // Operations departments
    if (name.includes('operations') || name.includes('operational') || name.includes('management')) {
      return <WrenchScrewdriverIcon className="w-6 h-6 text-white" />;
    }
    
    // Documentation/Administration departments
    if (name.includes('admin') || name.includes('administration') || name.includes('document') || name.includes('paperwork')) {
      return <ClipboardDocumentListIcon className="w-6 h-6 text-white" />;
    }
    
    // Unassigned meetings
    if (name.includes('unassigned') || name.includes('unknown')) {
      return <ExclamationTriangleIcon className="w-6 h-6 text-white" />;
    }
    
    // Default icon for any other department
    return <BuildingOfficeIcon className="w-6 h-6 text-white" />;
  };
  
  // Currency conversion rates (you can make this dynamic by fetching from an API)
  const currencyRates = {
    'USD': 3.7,  // 1 USD = 3.7 NIS (approximate)
    'EUR': 4.0,  // 1 EUR = 4.0 NIS (approximate)
    'GBP': 4.7,  // 1 GBP = 4.7 NIS (approximate)
    'NIS': 1,    // 1 NIS = 1 NIS
    '₪': 1,      // 1 ₪ = 1 NIS
    'ILS': 1     // 1 ILS = 1 NIS
  };

  // Helper function to convert any currency amount to NIS
  const convertToNIS = (amount: number, currency: string): number => {
    if (!amount || amount <= 0) return 0;
    
    const normalizedCurrency = currency?.toUpperCase().trim();
    const rate = currencyRates[normalizedCurrency as keyof typeof currencyRates] || 1;
    
    console.log(`💰 Converting ${amount} ${currency} to NIS (rate: ${rate}) = ${amount * rate}`);
    return amount * rate;
  };

  // Fetch departments and categories with department mapping using SQL JOINs
  const fetchDepartmentData = async () => {
    try {
      setIsLoading(true);
      
      // Use SQL JOIN to get categories with their departments directly
      const { data: categoryMappingData, error: mappingError } = await supabase
        .from('misc_category')
        .select(`
          id,
          name,
          parent_id,
          misc_maincategory!parent_id (
            id,
            name,
            department_id,
            tenant_departement!department_id (
              id,
              name
            )
          )
        `)
        .order('name', { ascending: true });
      
      if (mappingError) {
        console.error('❌ Error fetching category mapping:', mappingError);
        throw mappingError;
      }

      // Fetch all departments for the dropdown
      const { data: departmentsData, error: departmentsError } = await supabase
        .from('tenant_departement')
        .select('id, name')
        .order('name', { ascending: true });
      
      if (departmentsError) throw departmentsError;
      setDepartments(departmentsData || []);
      setAllCategories(categoryMappingData || []);
      
      console.log('🔍 Department data loaded with JOINs:', {
        departments: departmentsData?.length || 0,
        categories: categoryMappingData?.length || 0,
        sampleCategories: categoryMappingData?.slice(0, 3).map((cat: any) => ({ 
          id: cat.id, 
          name: cat.name, 
          mainCategory: cat.misc_maincategory?.name,
          department: cat.misc_maincategory?.tenant_departement?.name
        }))
      });
      
    } catch (error) {
      console.error('Error fetching department data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Group meetings by department using direct JOIN data
  const groupMeetingsByDepartment = (meetings: any[], departments: any[]) => {
    const grouped: { [key: string]: any[] } = {};
    
    // Initialize all departments
    departments.forEach(dept => {
      grouped[dept.name] = [];
    });
    
    // Add an "Unassigned" department for meetings without category mapping
    grouped['Unassigned'] = [];
    
    // Add a "Staff Meeting" department for staff meetings
    grouped['Staff Meeting'] = [];
    
    for (const meeting of meetings) {
      const lead = meeting.lead || {};
      let categoryId = lead.category_id || meeting.category_id;
      let categoryName = lead.category || meeting.category || '';
      
      console.log('Processing meeting:', {
        meetingId: meeting.id,
        categoryId: categoryId,
        categoryName: categoryName,
        calendarType: meeting.calendar_type,
        allCategoriesLength: allCategories.length
      });
      
      // Check if this is a staff meeting first
      if (meeting.calendar_type === 'staff') {
        grouped['Staff Meeting'].push(meeting);
        console.log(`✅ Staff meeting assigned to Staff Meeting department`);
        continue;
      }
      
      let departmentName = null;
      
      // For legacy leads, categoryName might actually be a category ID (number)
      if (!categoryId && categoryName && !isNaN(Number(categoryName))) {
        const originalCategoryName = categoryName;
        categoryId = categoryName;
        categoryName = '';
        console.log(`Legacy lead detected: treating categoryName "${originalCategoryName}" as categoryId "${categoryId}"`);
      }
      
      // Find category by ID and get department directly from JOINed data
      if (categoryId && allCategories.length > 0) {
        const foundCategory = allCategories.find((cat: any) => 
          cat.id.toString() === categoryId.toString()
        );
        
        if (foundCategory && foundCategory.misc_maincategory?.tenant_departement) {
          departmentName = foundCategory.misc_maincategory.tenant_departement.name;
          console.log(`Found category by ID ${categoryId}: "${foundCategory.name}" -> Dept: "${departmentName}"`);
        }
      }
      
      // If not found by ID, try to find by category name
      if (!departmentName && categoryName && allCategories.length > 0) {
        const foundCategory = allCategories.find((cat: any) => 
          cat.name.toLowerCase().trim() === String(categoryName).toLowerCase().trim()
        );
        
        if (foundCategory && foundCategory.misc_maincategory?.tenant_departement) {
          departmentName = foundCategory.misc_maincategory.tenant_departement.name;
          console.log(`Found category by name "${categoryName}": "${foundCategory.name}" -> Dept: "${departmentName}"`);
        }
      }
      
      if (departmentName && grouped[departmentName]) {
        grouped[departmentName].push(meeting);
        console.log(`✅ Assigned to department: ${departmentName}`);
      } else {
        // If no mapping found and it's not a staff meeting, add to unassigned
        grouped['Unassigned'].push(meeting);
        console.log(`❌ No mapping found, assigned to Unassigned`);
      }
    }
    
    return grouped;
  };

  useEffect(() => {
    fetchDepartmentData();
  }, []);

  if (isLoading) {
    return (
      <div className="mt-6 text-center p-8">
        <div className="loading loading-spinner loading-lg"></div>
        <p className="mt-4 text-base-content/60">Loading departments...</p>
      </div>
    );
  }

  console.log('🔍 DepartmentList: About to group meetings:', {
    meetingsCount: meetings.length,
    allCategoriesLength: allCategories.length,
    sampleAllCategories: allCategories.slice(0, 3).map(cat => ({ 
      id: cat.id, 
      name: cat.name, 
      mainCategory: cat.misc_maincategory?.name,
      department: cat.misc_maincategory?.tenant_departement?.name
    }))
  });
  
  const departmentMeetings = groupMeetingsByDepartment(meetings, departments);

  return (
    <div className="mt-6">
      {/* Department Overview - Compact Cards Style */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Object.keys(departmentMeetings).map((deptName) => {
          const deptMeetings = departmentMeetings[deptName] || [];
          
          // Calculate department statistics with currency conversion
          const totalAmount = deptMeetings.reduce((sum: number, meeting: any) => {
            const lead = meeting.lead || {};
            let amount = 0;
            let currency = 'NIS';
            
            // Determine if this is a legacy lead
            const isLegacy = lead.lead_type === 'legacy' || lead.id?.toString().startsWith('legacy_');
            
            // Get balance value using same logic as balance badge
            if (isLegacy) {
              // For legacy leads: if currency_id is 1 (NIS/ILS), use total_base; otherwise use total
              const currencyId = (lead as any).currency_id;
              let numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
              if (!numericCurrencyId || isNaN(numericCurrencyId)) {
                numericCurrencyId = 1; // Default to NIS
              }
              if (numericCurrencyId === 1) {
                amount = (lead as any).total_base ?? 0;
              } else {
                amount = (lead as any).total ?? 0;
              }
              // Get currency symbol - balance_currency should already be set from JOIN
              currency = lead.balance_currency || '₪';
            } else if (typeof lead.balance === 'number' && lead.balance > 0) {
              // For new leads, use balance
              amount = lead.balance;
              currency = lead.balance_currency || '₪';
            } else if ((lead as any).proposal_total && typeof (lead as any).proposal_total === 'number') {
              // Fallback to proposal_total for new leads
              amount = (lead as any).proposal_total;
              currency = (lead as any).proposal_currency || lead.balance_currency || '₪';
            }
            // Fallback to meeting_amount if lead balance is not available
            else if (typeof meeting.meeting_amount === 'number' && meeting.meeting_amount > 0) {
              amount = meeting.meeting_amount;
              currency = meeting.meeting_currency || 'NIS';
            }
            
            // Normalize currency symbol to code for conversion
            let currencyCode = currency;
            if (currency === '₪') currencyCode = 'NIS';
            else if (currency === '€') currencyCode = 'EUR';
            else if (currency === '$') currencyCode = 'USD';
            else if (currency === '£') currencyCode = 'GBP';
            else if (currency === 'ILS') currencyCode = 'NIS';
            
            // Convert to NIS using the conversion function
            const amountInNIS = convertToNIS(amount, currencyCode);
            return sum + amountInNIS;
          }, 0);

          // Calculate total applicants for this department (exclude staff meetings)
          const totalApplicants = deptName === 'Staff Meeting' ? 0 : deptMeetings.reduce((sum: number, meeting: any) => {
            const lead = meeting.lead || {};
            const legacyLead = meeting.legacy_lead || {};
            
            // For new leads, get number_of_applicants_meeting from leads table
            if (lead.number_of_applicants_meeting && typeof lead.number_of_applicants_meeting === 'number') {
              return sum + lead.number_of_applicants_meeting;
            }
            
            // For legacy leads, get no_of_applicants from leads_lead table
            if (legacyLead.no_of_applicants && typeof legacyLead.no_of_applicants === 'number') {
              return sum + legacyLead.no_of_applicants;
            }
            
            return sum;
          }, 0);

          // Calculate average probability for this department (exclude staff meetings)
          const averageProbability = deptName === 'Staff Meeting' ? 0 : (() => {
            const probabilities = deptMeetings
              .map((meeting: any) => {
                const lead = meeting.lead || {};
                const legacyLead = meeting.legacy_lead || {};
                
                // For new leads, get probability from leads table
                if (lead.probability && typeof lead.probability === 'number') {
                  return lead.probability;
                }
                
                // For legacy leads, get probability from leads_lead table
                if (legacyLead.probability && typeof legacyLead.probability === 'number') {
                  return legacyLead.probability;
                }
                
                return null;
              })
              .filter(prob => prob !== null && prob > 0);
            
            if (probabilities.length === 0) return 0;
            
            const sum = probabilities.reduce((acc, prob) => acc + prob, 0);
            return Math.round(sum / probabilities.length);
          })();
          
          // Don't show departments with no meetings
          if (deptMeetings.length === 0) return null;
          
          return (
            <div key={deptName} className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 hover:shadow-xl transition-shadow duration-200">
              {/* Department Header */}
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg" style={{ backgroundColor: '#4418C4' }}>
                  {getDepartmentIcon(deptName)}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{deptName}</h3>
                  <p className="text-sm text-gray-500">{deptMeetings.length} meetings</p>
                </div>
              </div>

              {/* Department Stats */}
              <div className="space-y-3">
                {/* Total Amount */}
                {totalAmount > 0 && (
                  <div className="flex items-center gap-2">
                    <CurrencyDollarIcon className="w-4 h-4 text-green-600" />
                    <span className="text-sm text-gray-600">Total:</span>
                    <span className="font-semibold text-green-600">₪{totalAmount.toLocaleString()}</span>
                  </div>
                )}

                {/* Total Applicants (exclude staff meetings) */}
                {deptName !== 'Staff Meeting' && (
                  <div className="flex items-center gap-2">
                    <UserGroupIcon className="w-4 h-4 text-blue-600" />
                    <span className="text-sm text-gray-600">Total Applicants:</span>
                    <span className="text-sm font-medium text-gray-900">{totalApplicants}</span>
                  </div>
                )}

                {/* Average Probability (exclude staff meetings) */}
                {deptName !== 'Staff Meeting' && averageProbability > 0 && (
                  <div className="flex items-center gap-2">
                    <ChartBarIcon className="w-4 h-4 text-purple-600" />
                    <span className="text-sm text-gray-600">Avg Probability:</span>
                    <span className="text-sm font-medium text-gray-900">{averageProbability}%</span>
                  </div>
                )}

              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DepartmentList;
