import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { UserGroupIcon, ChartBarIcon, AcademicCapIcon, CurrencyDollarIcon, ClockIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import EmployeeModal from '../components/EmployeeModal';
import { convertToNIS, calculateTotalRevenueInNIS } from '../lib/currencyConversion';

interface Employee {
  id: string;
  display_name: string;
  email: string;
  bonuses_role: string;
  department: string;
  is_active: boolean;
  photo_url?: string;
  phone?: string;
  mobile?: string;
  phone_ext?: string;
  performance_metrics?: {
    total_meetings: number;
    completed_meetings: number;
    total_revenue: number;
    total_bonus: number;
    average_rating: number;
    last_activity: string;
    performance_percentage?: number;
    role_metrics?: { [key: string]: { signed: number; revenue: number } };
    team_average?: { avgSigned: number; avgRevenue: number; totalEmployees: number; totalSigned: number; totalRevenue: number };
    // Role-specific metrics
    expert_opinions_completed?: number;
    feasibility_no_check?: number;
    feasibility_further_check?: number;
    feasibility_no_feasibility?: number;
    meetings_scheduled?: number;
    signed_agreements?: number;
    total_agreement_amount?: number;
    cases_handled?: number;
    applicants_processed?: number;
    total_invoiced_amount?: number;
    // New role-specific metrics
    expert_examinations?: number;
    expert_total?: number;
    signed_meetings?: number;
    due_total?: number;
    successful_meetings?: number;
    contracts_managed?: number;
    signed_total?: number;
    total_due?: number;
  };
}

interface DepartmentGroup {
  name: string;
  employees: Employee[];
  total_meetings: number;
  total_revenue: number;
  average_performance: number;
}

interface SubdepartmentGroup {
  name: string;
  bonus_percentage: number;
  employees: Employee[];
  total_meetings: number;
  total_revenue: number;
  average_performance: number;
}

// Helper function to generate initials from display name
const getInitials = (displayName: string): string => {
  return displayName
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2); // Limit to 2 characters max
};


// Helper function to map role codes to display names
  const getRoleDisplayName = (roleCode: string): string => {
    const roleMap: { [key: string]: string } = {
      'c': 'Closer',
      's': 'Scheduler',
      'h': 'Handler',
      'n': 'No role',
      'e': 'Expert',
      'z': 'Manager',
      'Z': 'Manager',
      'p': 'Partner',
      'm': 'Manager',
      'dm': 'Department Manager',
      'pm': 'Project Manager',
      'se': 'Secretary',
      'b': 'Book keeper',
      'partners': 'Partners',
      'dv': 'Developer',
      'ma': 'Marketing',
      'P': 'Partner',
      'M': 'Manager',
      'DM': 'Department Manager',
      'PM': 'Project Manager',
      'SE': 'Secretary',
      'B': 'Book keeper',
      'Partners': 'Partners',
      'd': 'Diverse',
      'f': 'Finance'
    };
    
    return roleMap[roleCode] || roleCode || 'No role';
  };

const EmployeePerformancePage: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departmentGroups, setDepartmentGroups] = useState<DepartmentGroup[]>([]);
  const [subdepartmentGroups, setSubdepartmentGroups] = useState<SubdepartmentGroup[]>([]);
  const [correctedTotalRevenue, setCorrectedTotalRevenue] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [selectedRole, setSelectedRole] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [bonusAmount, setBonusAmount] = useState<string>('');
  const [viewMode, setViewMode] = useState<'department' | 'subdepartment'>('department');
  const [selectedSubdepartment, setSelectedSubdepartment] = useState<string>('all');
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Fetch comprehensive performance data for employees
  const fetchComprehensivePerformanceData = async (dateFrom?: string, dateTo?: string) => {
    try {
      // Calculate date range - default to last 30 days if no dates provided
      const today = new Date();
      const defaultFromDate = new Date(today);
      defaultFromDate.setDate(today.getDate() - 30);
      
      const fromDateValue = dateFrom || defaultFromDate.toISOString().split('T')[0];
      const toDateValue = dateTo || today.toISOString().split('T')[0];
      
      console.log('📊 Fetching comprehensive performance data from', fromDateValue, 'to', toDateValue);

      // Fetch signed stages (stage 60 - agreement signed) for the date range
      const { data: signedStages, error: stagesError } = await supabase
        .from('leads_leadstage')
        .select(`
          id,
          lead_id,
          stage,
          cdate
        `)
        .eq('stage', 60)
        .gte('cdate', fromDateValue)
        .lte('cdate', toDateValue);
      
      if (stagesError) {
        console.error('Error fetching lead stages:', stagesError);
        throw stagesError;
      }
      
      console.log('📊 Signed stages found:', signedStages?.length || 0);
      
      // Fetch leads data for the signed stages
      let signedLeads: any[] = [];
      if (signedStages && signedStages.length > 0) {
        const leadIds = [...new Set(signedStages.map(stage => stage.lead_id).filter(id => id !== null))];
        console.log('📋 Fetching leads data for', leadIds.length, 'unique signed leads...');
        
        const { data: leadsData, error: leadsError } = await supabase
          .from('leads_lead')
          .select(`
            id,
            name,
            case_handler_id,
            closer_id,
            expert_id,
            meeting_scheduler_id,
            meeting_manager_id,
            meeting_lawyer_id,
            total,
            currency_id,
            cdate,
            no_of_applicants
          `)
          .in('id', leadIds);
        
        if (leadsError) {
          console.error('Error fetching leads data:', leadsError);
          throw leadsError;
        }
        
        signedLeads = leadsData || [];
        console.log('📊 Signed leads fetched:', signedLeads.length);
      }

      // Fetch proforma invoices for the signed leads in the date range
      const { data: allInvoices, error: invoicesError } = await supabase
        .from('proformainvoice')
        .select(`
          id,
          lead_id,
          total,
          currency_id,
          cdate
        `)
        .gte('cdate', fromDateValue)
        .lte('cdate', toDateValue);
      
      if (invoicesError) {
        console.error('Error fetching proforma invoices:', invoicesError);
        throw invoicesError;
      }
      
      console.log('📊 All proforma invoices found:', allInvoices?.length || 0);
      
      // Filter invoices to only include those for signed leads
      const signedLeadIds = new Set(signedLeads.map(lead => lead.id));
      const proformaInvoices = allInvoices?.filter(invoice => signedLeadIds.has(invoice.lead_id)) || [];
      
      console.log('📊 Proforma invoices for signed leads:', proformaInvoices.length);

      return {
        signedLeads,
        proformaInvoices,
        dateRange: { from: fromDateValue, to: toDateValue }
      };
    } catch (error) {
      console.error('Error fetching comprehensive performance data:', error);
      throw error;
    }
  };

  // Calculate team averages for performance benchmarking
  const calculateTeamAverages = (employees: Employee[], signedLeads: any[], proformaInvoices: any[]) => {
    const roleAverages: { [key: string]: any } = {};
    
    // Group employees by role
    const employeesByRole = employees.reduce((acc, emp) => {
      const role = emp.bonuses_role?.toLowerCase();
      if (!acc[role]) acc[role] = [];
      acc[role].push(emp);
      return acc;
    }, {} as { [key: string]: Employee[] });

    // Calculate averages for each role
    Object.entries(employeesByRole).forEach(([role, roleEmployees]) => {
      const roleMetrics = roleEmployees.map(emp => {
        const employeeIdStr = String(emp.id);
        
        // Count signed contracts for this employee in this role
        let signedCount = 0;
        let totalRevenue = 0;
        
        signedLeads.forEach(lead => {
          let isEmployeeInRole = false;
          
          switch (role) {
            case 'h':
              isEmployeeInRole = lead.case_handler_id === employeeIdStr;
              break;
            case 'c':
              isEmployeeInRole = lead.closer_id === employeeIdStr;
              break;
            case 'e':
              isEmployeeInRole = lead.expert_id === employeeIdStr;
              break;
            case 's':
              isEmployeeInRole = lead.meeting_scheduler_id === employeeIdStr;
              break;
            case 'z':
            case 'Z':
              isEmployeeInRole = lead.meeting_manager_id === employeeIdStr;
              break;
            case 'helper-closer':
              isEmployeeInRole = lead.meeting_lawyer_id === employeeIdStr;
              break;
          }
          
          if (isEmployeeInRole) {
            signedCount++;
            const leadAmount = parseFloat(lead.total) || 0;
            const leadAmountInNIS = convertToNIS(leadAmount, lead.currency_id);
            totalRevenue += leadAmountInNIS;
            
            // Debug currency conversion
            console.log(`🔍 EmployeePerformancePage Team Averages - Lead ${lead.id}:`, {
              originalAmount: leadAmount,
              currencyId: lead.currency_id,
              convertedAmount: leadAmountInNIS,
              conversionRate: leadAmount > 0 ? leadAmountInNIS / leadAmount : 1
            });
          }
        });
        
        return {
          signed: signedCount,
          revenue: totalRevenue
        };
      });
      
      const totalSigned = roleMetrics.reduce((sum, m) => sum + m.signed, 0);
      const totalRevenue = roleMetrics.reduce((sum, m) => sum + m.revenue, 0);
      const avgSigned = roleEmployees.length > 0 ? totalSigned / roleEmployees.length : 0;
      const avgRevenue = roleEmployees.length > 0 ? totalRevenue / roleEmployees.length : 0;
      
      roleAverages[role] = {
        avgSigned,
        avgRevenue,
        totalEmployees: roleEmployees.length,
        totalSigned,
        totalRevenue
      };
    });
    
    return roleAverages;
  };

  // Fetch employees and their performance data
  useEffect(() => {
    const fetchEmployeePerformance = async () => {
      // Only fetch if both dates are selected, or if no dates are selected (use default)
      const shouldFetch = (!dateFrom && !dateTo) || (dateFrom && dateTo);
      
      if (!shouldFetch) {
        console.log('📅 Skipping fetch - waiting for both dates to be selected');
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Get basic employee data
        const { data: allEmployeesData, error: allEmployeesDataError } = await supabase
          .from('tenants_employee')
          .select(`
            id,
            display_name,
            bonuses_role,
            department_id,
            user_id,
            photo_url,
            photo,
            phone,
            mobile,
            phone_ext
          `);

        if (allEmployeesDataError) {
          console.error('Error fetching all employees:', allEmployeesDataError);
          throw allEmployeesDataError;
        }

        // Filter to only those with user_id
        const employeesData = allEmployeesData?.filter(emp => emp.user_id) || [];

        // Fetch departments for mapping
        const { data: departmentsData, error: departmentsError } = await supabase
          .from('tenant_departement')
          .select('id, name');

        if (departmentsError) {
          console.error('Error fetching departments:', departmentsError);
        }

        // Create department mapping
        const departmentMap = new Map();
        departmentsData?.forEach(dept => {
          departmentMap.set(dept.id, dept.name);
        });

        // Get auth user data for each employee
        const activeEmployees = await Promise.all(
          employeesData.map(async (employee) => {
            try {
              const { data: authUserData, error: authUserError } = await supabase
                .from('auth_user')
                .select('id, email, is_active')
                .eq('id', employee.user_id)
                .single();

              if (authUserError) {
                return {
                  id: employee.id,
                  display_name: employee.display_name,
                  bonuses_role: employee.bonuses_role,
                  department: employee.department_id ? departmentMap.get(employee.department_id) || 'Unknown' : 'General',
                  email: 'N/A',
                  is_active: false,
                  photo_url: employee.photo_url,
                  photo: employee.photo,
                  phone: employee.phone,
                  mobile: employee.mobile,
                  phone_ext: employee.phone_ext
                };
              }

              return {
                id: employee.id,
                display_name: employee.display_name,
                bonuses_role: employee.bonuses_role,
                department: employee.department_id ? departmentMap.get(employee.department_id) || 'Unknown' : 'General',
                email: authUserData?.email || 'N/A',
                is_active: authUserData?.is_active || false,
                photo_url: employee.photo_url,
                photo: employee.photo,
                phone: employee.phone,
                mobile: employee.mobile,
                phone_ext: employee.phone_ext
              };
            } catch (error) {
              console.error(`Error fetching auth user for employee ${employee.display_name}:`, error);
              return {
                id: employee.id,
                display_name: employee.display_name,
                bonuses_role: employee.bonuses_role,
                department: employee.department_id ? departmentMap.get(employee.department_id) || 'Unknown' : 'General',
                email: 'N/A',
                is_active: false,
                photo_url: employee.photo_url,
                photo: employee.photo,
                phone: employee.phone,
                mobile: employee.mobile,
                phone_ext: employee.phone_ext
              };
            }
          })
        );

        // Filter to only active employees and exclude specific employees
        const excludedEmployees = ['FINANCE', 'INTERNS', 'NO SCHEDULER', 'Mango Test', 'pink', 'Interns'];
        const filteredActiveEmployees = activeEmployees.filter(emp => 
          emp.is_active && !excludedEmployees.includes(emp.display_name)
        );

        console.log('🔍 Employee Performance - Active employees loaded:', {
          totalEmployees: employeesData?.length || 0,
          activeEmployees: filteredActiveEmployees.length,
          departmentsFound: departmentsData?.length || 0
        });

        // Fetch comprehensive performance data
        const performanceData = await fetchComprehensivePerformanceData(dateFrom, dateTo);
        
        // Calculate team averages
        const teamAverages = calculateTeamAverages(
          filteredActiveEmployees, 
          performanceData.signedLeads, 
          performanceData.proformaInvoices
        );

        // Process performance metrics for each employee (include ALL employees, even those without data)
        const employeesWithMetrics = filteredActiveEmployees.map((employee) => {
          const employeeIdStr = String(employee.id);
              const role = employee.bonuses_role?.toLowerCase();
              
          // Initialize metrics - all employees start with 0 values
          let totalMeetings = 0;
          let completedMeetings = 0;
          let totalRevenue = 0;
          let lastActivity: string | null = null;
          
          // Count signed contracts across all roles
          const roleMetrics: { [key: string]: { signed: number; revenue: number } } = {};
          
          // Only process if there are signed leads for the period
          if (performanceData.signedLeads && performanceData.signedLeads.length > 0) {
            performanceData.signedLeads.forEach(lead => {
              const leadTotal = parseFloat(lead.total) || 0;
              const leadTotalInNIS = convertToNIS(leadTotal, lead.currency_id);
              
              // Debug currency conversion
              console.log(`🔍 EmployeePerformancePage Employee Metrics - Lead ${lead.id}:`, {
                originalAmount: leadTotal,
                currencyId: lead.currency_id,
                convertedAmount: leadTotalInNIS,
                conversionRate: leadTotal > 0 ? leadTotalInNIS / leadTotal : 1
              });
              const leadDate = lead.cdate;
              
              // Check each role
              const roles = [
                { key: 'h', id: lead.case_handler_id },
                { key: 'c', id: lead.closer_id },
                { key: 'e', id: lead.expert_id },
                { key: 's', id: lead.meeting_scheduler_id },
                { key: 'z', id: lead.meeting_manager_id },
                { key: 'helper-closer', id: lead.meeting_lawyer_id }
              ];
              
              roles.forEach(({ key, id }) => {
                if (id === employeeIdStr) {
                  if (!roleMetrics[key]) {
                    roleMetrics[key] = { signed: 0, revenue: 0 };
                  }
                  roleMetrics[key].signed++;
                  roleMetrics[key].revenue += leadTotalInNIS; // Use NIS amount
                  
                  totalMeetings++;
                  completedMeetings++; // Signed contracts are considered completed
                  totalRevenue += leadTotalInNIS; // Use NIS amount
                  
                  if (!lastActivity || new Date(leadDate) > new Date(lastActivity)) {
                    lastActivity = leadDate;
                  }
                }
              });
            });
          }
          
          // Calculate performance percentage based on team average (capped at 100%)
          const teamAvg = teamAverages[role];
          const employeeSigned = roleMetrics[role]?.signed || 0;
          const performancePercentage = teamAvg && teamAvg.avgSigned > 0 
            ? Math.min(100, Math.round((employeeSigned / teamAvg.avgSigned) * 100))
            : 0;

          return {
            ...employee,
            performance_metrics: {
              total_meetings: totalMeetings,
              completed_meetings: completedMeetings,
              total_revenue: totalRevenue,
              total_bonus: 0,
              average_rating: 0,
              last_activity: lastActivity || 'No activity',
              performance_percentage: performancePercentage,
              role_metrics: roleMetrics,
              team_average: teamAvg
            }
          };
        });

        setEmployees(employeesWithMetrics);

        // Group employees by department
        const groupedByDepartment = employeesWithMetrics.reduce((groups, employee) => {
          const department = employee.department || 'Unassigned';
          if (!groups[department]) {
            groups[department] = [];
          }
          groups[department].push(employee);
          return groups;
        }, {} as Record<string, Employee[]>);

        // Calculate department revenue using Dashboard's agreement signed logic
        // IMPORTANT: This calculation is COMPLETELY INDEPENDENT of employee data
        // It only uses leads_leadstage (signed contracts) and leads_lead (with department mappings)
        const calculateDepartmentRevenue = async (dateFrom?: string, dateTo?: string) => {
          try {
            // Calculate date range - default to last 30 days if no dates provided
            const today = new Date();
            const defaultFromDate = new Date(today);
            defaultFromDate.setDate(today.getDate() - 30);
            
            const fromDateValue = dateFrom || defaultFromDate.toISOString().split('T')[0];
            const toDateValue = dateTo || today.toISOString().split('T')[0];
            
            console.log('📊 Calculating department revenue using Dashboard logic from', fromDateValue, 'to', toDateValue);
            console.log('📊 NOTE: Revenue calculation is COMPLETELY INDEPENDENT of employee data');

            // First, get ALL departments from tenant_departement to create a mapping
            // Employee Performance page needs ALL departments, not just important ones like Dashboard
            const { data: allDepartments, error: departmentsError } = await supabase
              .from('tenant_departement')
              .select('id, name, important')
              .order('id');
            
            if (departmentsError) {
              console.error('Error fetching departments for revenue calculation:', departmentsError);
              return {};
            }
            
            // Create department ID to name mapping
            const departmentMap: { [key: number]: string } = {};
            allDepartments?.forEach(dept => {
              departmentMap[dept.id] = dept.name;
            });
            
            console.log('📊 All departments fetched:', allDepartments?.map(d => `${d.id}: ${d.name} (important: ${d.important})`));
            console.log('📊 Department mapping created:', departmentMap);
            
            // Specifically check for Marketing department
            const marketingDept = allDepartments?.find(d => d.name.toLowerCase() === 'marketing');
            if (marketingDept) {
              console.log('📊 Marketing department found:', marketingDept);
            } else {
              console.log('⚠️ Marketing department NOT found in tenant_departement table');
            }

            // Fetch signed stages (stage 60 - agreement signed) for the date range
            const { data: signedStages, error: stagesError } = await supabase
              .from('leads_leadstage')
              .select('id, date, lead_id')
              .eq('stage', 60)
              .gte('date', fromDateValue)
              .lte('date', toDateValue);
            
            if (stagesError) {
              console.error('Error fetching lead stages for department revenue:', stagesError);
              return {};
            }
            
            console.log('📊 Signed stages found for department revenue:', signedStages?.length || 0);
            
            // Fetch leads data for the signed stages
            let departmentRevenue: { [key: string]: number } = {};
            if (signedStages && signedStages.length > 0) {
              const leadIds = [...new Set(signedStages.map(stage => stage.lead_id).filter(id => id !== null))];
              console.log('📋 Fetching leads data for department revenue calculation for', leadIds.length, 'unique signed leads...');
              
                const { data: leadsData, error: leadsError } = await supabase
                  .from('leads_lead')
                  .select(`
                    id, total, currency_id,
                    misc_category(
                      id, name, parent_id,
                      misc_maincategory(
                        id, name, department_id,
                        tenant_departement(id, name)
                      )
                    )
                  `)
                  .in('id', leadIds);
              
              if (leadsError) {
                console.error('Error fetching leads data for department revenue:', leadsError);
                return {};
              }
              
              console.log('📊 Leads data fetched for department revenue:', leadsData?.length || 0);
              
              // Debug: Check the structure of the first few leads
              if (leadsData && leadsData.length > 0) {
                console.log('📊 Sample lead data structure:', leadsData[0]);
                console.log('📊 Sample lead misc_category:', leadsData[0]?.misc_category);
                const sampleLead = leadsData[0] as any;
                if (sampleLead?.misc_category) {
                  console.log('📊 Sample category structure:', sampleLead.misc_category);
                  if (sampleLead.misc_category?.misc_maincategory) {
                    console.log('📊 Sample maincategory structure:', sampleLead.misc_category.misc_maincategory);
                    console.log('📊 Sample department_id:', sampleLead.misc_category.misc_maincategory.department_id);
                  }
                }
              }
              
              // Join the data and calculate revenue by department
              const leadsMap = new Map(leadsData?.map(lead => [lead.id, lead]) || []);
              signedStages.forEach(stageRecord => {
                const lead = leadsMap.get(stageRecord.lead_id);
                      if (lead) {
                  const amount = parseFloat(lead.total) || 0;
                  const amountInNIS = convertToNIS(amount, lead.currency_id);
                  
                  // Debug currency conversion
                  console.log(`🔍 EmployeePerformancePage Department Revenue - Lead ${lead.id}:`, {
                    originalAmount: amount,
                    currencyId: lead.currency_id,
                    convertedAmount: amountInNIS,
                    conversionRate: amount > 0 ? amountInNIS / amount : 1
                  });
                  
                  // Get department ID from the JOIN (same as Dashboard logic)
                  let departmentId = null;
                  // Dashboard treats misc_category and misc_maincategory as single objects, not arrays
                  const leadData = lead as any;
                  if (leadData.misc_category?.misc_maincategory?.department_id) {
                    departmentId = leadData.misc_category.misc_maincategory.department_id;
                  }
                  
                  // Get department name from the mapping
                  const departmentName = departmentId ? departmentMap[departmentId] || 'Unknown' : 'General';
                  
                  console.log(`📊 Processing lead ${lead.id}: departmentId=${departmentId}, departmentName=${departmentName}, amount=${amount}, amountInNIS=${amountInNIS}`);
                  console.log(`📊 Available department mappings:`, departmentMap);
                  
                  if (!departmentRevenue[departmentName]) {
                    departmentRevenue[departmentName] = 0;
                  }
                  departmentRevenue[departmentName] += amountInNIS; // Use NIS amount
                  
                  console.log(`📊 Updated revenue for ${departmentName}: ${departmentRevenue[departmentName]}`);
                  
                  // Special debugging for Marketing department
                  if (departmentName.toLowerCase() === 'marketing') {
                    console.log(`🎯 MARKETING LEAD FOUND: Lead ${lead.id}, Amount: ${amount}, AmountInNIS: ${amountInNIS}, Total Marketing Revenue: ${departmentRevenue[departmentName]}`);
                  }
                }
              });
            }
            
            console.log('📊 Department revenue calculated:', departmentRevenue);
            
            // Special debugging for Marketing department
            if (departmentRevenue['Marketing']) {
              console.log(`🎯 FINAL MARKETING REVENUE: ₪${departmentRevenue['Marketing']}`);
            } else {
              console.log('⚠️ NO MARKETING REVENUE FOUND in final calculation');
            }
            
            return departmentRevenue;
            } catch (error) {
            console.error('Error calculating department revenue:', error);
            return {};
          }
        };

        // Calculate department revenue using Dashboard logic
        const departmentRevenueData = await calculateDepartmentRevenue(dateFrom, dateTo);
        
        console.log('📊 Department revenue data received:', departmentRevenueData);
        console.log('📊 Available departments in groupedByDepartment:', Object.keys(groupedByDepartment));
        console.log('📊 Revenue calculation department names:', Object.keys(departmentRevenueData));
        console.log('📊 Employee department names:', Object.keys(groupedByDepartment));
        
        // Check for department name mismatches
        const revenueDepts = Object.keys(departmentRevenueData);
        const employeeDepts = Object.keys(groupedByDepartment);
        const missingInRevenue = employeeDepts.filter(dept => !revenueDepts.includes(dept));
        const missingInEmployees = revenueDepts.filter(dept => !employeeDepts.includes(dept));
        
        if (missingInRevenue.length > 0) {
          console.log('⚠️ Departments in employee data but not in revenue calculation:', missingInRevenue);
        }
        if (missingInEmployees.length > 0) {
          console.log('⚠️ Departments in revenue calculation but not in employee data:', missingInEmployees);
        }

        // Create department groups with aggregated metrics
        const departmentGroups: DepartmentGroup[] = Object.entries(groupedByDepartment).map(([deptName, deptEmployees]) => {
          const totalMeetings = deptEmployees.reduce((sum, emp) => sum + (emp.performance_metrics?.total_meetings || 0), 0);
          
          // Try to find revenue for this department with case-insensitive matching
          let totalRevenue = departmentRevenueData[deptName] || 0;
          
          // If no exact match, try case-insensitive matching
          if (totalRevenue === 0) {
            const revenueDeptNames = Object.keys(departmentRevenueData);
            const matchingDept = revenueDeptNames.find(revDept => 
              revDept.toLowerCase() === deptName.toLowerCase()
            );
            if (matchingDept) {
              totalRevenue = departmentRevenueData[matchingDept];
              console.log(`📊 Found case-insensitive match: ${deptName} -> ${matchingDept} (${totalRevenue})`);
            }
          }
          
          // If still no match, try partial matching
          if (totalRevenue === 0) {
            const revenueDeptNames = Object.keys(departmentRevenueData);
            const matchingDept = revenueDeptNames.find(revDept => 
              revDept.toLowerCase().includes(deptName.toLowerCase()) || 
              deptName.toLowerCase().includes(revDept.toLowerCase())
            );
            if (matchingDept) {
              totalRevenue = departmentRevenueData[matchingDept];
              console.log(`📊 Found partial match: ${deptName} -> ${matchingDept} (${totalRevenue})`);
            }
          }
          
          const averagePerformance = deptEmployees.length > 0 
            ? deptEmployees.reduce((sum, emp) => sum + (emp.performance_metrics?.completed_meetings || 0), 0) / deptEmployees.length
            : 0;

          console.log(`📊 Department ${deptName}: ${deptEmployees.length} employees, ${totalMeetings} meetings, ${totalRevenue} revenue`);

          return {
            name: deptName,
            employees: deptEmployees,
            total_meetings: totalMeetings,
            total_revenue: totalRevenue,
            average_performance: averagePerformance
          };
        });

        // Sort departments by total revenue
        departmentGroups.sort((a, b) => b.total_revenue - a.total_revenue);

        // Calculate total revenue from all departments (no double counting)
        // Check for departments that might share revenue (like Austria and Germany variants)
        console.log('📊 All department groups before total calculation:', departmentGroups.map(dept => ({
          name: dept.name,
          revenue: dept.total_revenue,
          employeeCount: dept.employees.length
        })));
        
        // Identify departments that might share revenue (same base name)
        const departmentRevenueMap = new Map<string, number>();
        const sharedDepartments = new Set<string>();
        
        departmentGroups.forEach(dept => {
          const baseName = dept.name.split(' - ')[0]; // Get base name (e.g., "Austria and Germany" from "Austria and Germany - Sales")
          
          if (departmentRevenueMap.has(baseName)) {
            // This base name already exists, mark as shared
            sharedDepartments.add(baseName);
            console.log(`⚠️ Found shared department: "${dept.name}" shares revenue with base "${baseName}"`);
          } else {
            departmentRevenueMap.set(baseName, dept.total_revenue);
          }
        });
        
        // Calculate total revenue avoiding double counting for shared departments
        let totalRevenueFromDepartments = 0;
        const processedBaseNames = new Set<string>();
        
        departmentGroups.forEach(dept => {
          const baseName = dept.name.split(' - ')[0];
          
          if (sharedDepartments.has(baseName)) {
            // Only count once for shared departments (use the first occurrence)
            if (!processedBaseNames.has(baseName)) {
              totalRevenueFromDepartments += dept.total_revenue;
              processedBaseNames.add(baseName);
              console.log(`📊 Added shared department revenue: "${dept.name}" (base: "${baseName}") = ₪${dept.total_revenue}`);
            } else {
              console.log(`📊 Skipped duplicate shared department: "${dept.name}" (base: "${baseName}") = ₪${dept.total_revenue}`);
            }
          } else {
            // Non-shared department, count normally
            totalRevenueFromDepartments += dept.total_revenue;
            console.log(`📊 Added unique department revenue: "${dept.name}" = ₪${dept.total_revenue}`);
          }
        });
        
        console.log('📊 Total revenue from all departments (avoiding double counting):', totalRevenueFromDepartments);
        console.log('📊 Shared departments detected:', Array.from(sharedDepartments));

        // Store the corrected total revenue
        setCorrectedTotalRevenue(totalRevenueFromDepartments);
        setDepartmentGroups(departmentGroups);

        // Create subdepartment groups
        const subdepartmentGroups: SubdepartmentGroup[] = [
          {
            name: 'Sales',
            bonus_percentage: 40,
            employees: employeesWithMetrics.filter(emp => 
              ['s', 'z', 'Z', 'c', 'e'].includes(emp.bonuses_role)
            ),
            total_meetings: 0,
            total_revenue: 0,
            average_performance: 0
          },
          {
            name: 'Handlers',
            bonus_percentage: 30,
            employees: employeesWithMetrics.filter(emp => 
              ['h', 'e', 'd'].includes(emp.bonuses_role)
            ),
            total_meetings: 0,
            total_revenue: 0,
            average_performance: 0
          },
          {
            name: 'Marketing',
            bonus_percentage: 5,
            employees: employeesWithMetrics.filter(emp => 
              ['ma'].includes(emp.bonuses_role)
            ),
            total_meetings: 0,
            total_revenue: 0,
            average_performance: 0
          },
          {
            name: 'Collection',
            bonus_percentage: 5,
            employees: employeesWithMetrics.filter(emp => 
              emp.department.toLowerCase().includes('finance') || 
              emp.department.toLowerCase().includes('collection')
            ),
            total_meetings: 0,
            total_revenue: 0,
            average_performance: 0
          },
          {
            name: 'Partners & Co',
            bonus_percentage: 20,
            employees: employeesWithMetrics.filter(emp => 
              ['p', 'm', 'dm', 'pm', 'se', 'b', 'partners', 'dv'].includes(emp.bonuses_role)
            ),
            total_meetings: 0,
            total_revenue: 0,
            average_performance: 0
          }
        ].map(subdept => {
          const totalMeetings = subdept.employees.reduce((sum, emp) => sum + (emp.performance_metrics?.total_meetings || 0), 0);
          // Calculate subdepartment revenue by summing up department revenues for employees in this subdepartment
          // But we need to be careful not to double-count revenue if multiple employees are in the same department
          const departmentRevenues = new Set<string>();
          const totalRevenue = subdept.employees.reduce((sum, emp) => {
            const deptRevenue = departmentRevenueData[emp.department] || 0;
            if (!departmentRevenues.has(emp.department)) {
              departmentRevenues.add(emp.department);
              return sum + deptRevenue;
            }
            return sum; // Don't double-count the same department
          }, 0);
          const averagePerformance = subdept.employees.length > 0 
            ? subdept.employees.reduce((sum, emp) => sum + (emp.performance_metrics?.completed_meetings || 0), 0) / subdept.employees.length
            : 0;

          console.log(`📊 Subdepartment ${subdept.name}: ${subdept.employees.length} employees, ${totalMeetings} meetings, ${totalRevenue} revenue`);

          return {
            ...subdept,
            total_meetings: totalMeetings,
            total_revenue: totalRevenue,
            average_performance: averagePerformance
          };
        });

        setSubdepartmentGroups(subdepartmentGroups);

        console.log('📊 Performance data loaded successfully:', {
          employees: employeesWithMetrics.length,
          dateRange: performanceData.dateRange,
          teamAverages: Object.keys(teamAverages).length
        });

      } catch (error) {
        console.error('Error fetching employee performance:', error);
        setError('Failed to load employee performance data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchEmployeePerformance();
  }, [dateFrom, dateTo]); // Add dateFrom and dateTo as dependencies


  // Filter employees based on selected department, role, search query, and date range
  const getFilteredEmployees = () => {
    let filtered = employees;

    if (selectedDepartment !== 'all') {
      filtered = filtered.filter(emp => emp.department === selectedDepartment);
    }

    if (selectedRole !== 'all') {
      filtered = filtered.filter(emp => emp.bonuses_role === selectedRole);
    }

    if (searchQuery.trim()) {
      filtered = filtered.filter(emp => 
        emp.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        emp.email.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Date range filtering based on last activity
    if (dateFrom) {
      filtered = filtered.filter(emp => {
        const lastActivity = emp.performance_metrics?.last_activity;
        if (!lastActivity || lastActivity === 'No activity') return false;
        return new Date(lastActivity) >= new Date(dateFrom);
      });
    }

    if (dateTo) {
      filtered = filtered.filter(emp => {
        const lastActivity = emp.performance_metrics?.last_activity;
        if (!lastActivity || lastActivity === 'No activity') return false;
        return new Date(lastActivity) <= new Date(dateTo);
      });
    }

    return filtered;
  };

  // Get unique departments and roles for filters
  const departments = [...new Set(employees.map(emp => emp.department).filter(Boolean))];
  const roles = [...new Set(employees.map(emp => emp.bonuses_role).filter(Boolean))];

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'ILS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  // Handle employee click to open modal
  const handleEmployeeClick = (employee: Employee) => {
    setSelectedEmployee(employee);
    setIsModalOpen(true);
  };

  // Handle modal close
  const handleModalClose = () => {
    setIsModalOpen(false);
    setSelectedEmployee(null);
  };

  // Format date
  const formatDate = (dateString: string) => {
    if (!dateString || dateString === 'No activity') return 'No activity';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-12">
          <div className="loading loading-spinner loading-lg text-primary"></div>
          <span className="ml-4 text-lg">Loading employee performance data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="alert alert-error">
          <XCircleIcon className="w-6 h-6" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6">
      {/* Header */}
      <div className="mb-4 sm:mb-6">
        <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
          <ChartBarIcon className="w-6 h-6 sm:w-8 sm:h-8 text-primary" />
          <h1 className="text-xl sm:text-3xl font-bold">Employee Performance</h1>
        </div>
        <p className="text-sm sm:text-base text-gray-600">Track and analyze employee performance across departments and roles</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 md:gap-4 mb-8">
        {/* Total Employees */}
        <div className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white relative overflow-hidden p-3 md:p-6">
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
              <UserGroupIcon className="w-5 h-5 md:w-7 md:h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">{employees.length}</div>
              <div className="text-white/80 text-xs md:text-sm font-medium mt-1">Total Employees</div>
            </div>
          </div>
          {/* SVG Graph Placeholder */}
          <svg className="absolute bottom-2 right-2 w-10 h-5 md:w-16 md:h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><path d="M2 28 Q16 8 32 20 T62 8" /></svg>
        </div>

        {/* Active Departments */}
        <div className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-purple-600 via-blue-600 to-blue-500 text-white relative overflow-hidden p-3 md:p-6">
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
              <AcademicCapIcon className="w-5 h-5 md:w-7 md:h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">{departmentGroups.length}</div>
              <div className="text-white/80 text-xs md:text-sm font-medium mt-1">Active Departments</div>
            </div>
          </div>
          {/* SVG Bar Chart Placeholder */}
          <svg className="absolute bottom-2 right-2 w-10 h-5 md:w-12 md:h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 48 32"><rect x="2" y="20" width="4" height="10"/><rect x="10" y="10" width="4" height="20"/><rect x="18" y="16" width="4" height="14"/><rect x="26" y="6" width="4" height="24"/><rect x="34" y="14" width="4" height="16"/></svg>
        </div>

        {/* Total Meetings */}
        <div className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white relative overflow-hidden p-3 md:p-6">
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
              <ClockIcon className="w-5 h-5 md:w-7 md:h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">
                {employees.reduce((sum, emp) => sum + (emp.performance_metrics?.total_meetings || 0), 0)}
              </div>
              <div className="text-white/80 text-xs md:text-sm font-medium mt-1">Total Meetings</div>
            </div>
          </div>
          {/* SVG Circle Placeholder */}
          <svg className="absolute bottom-2 right-2 w-10 h-10 md:w-10 md:h-10 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" /><text x="16" y="21" textAnchor="middle" fontSize="10" fill="white" opacity="0.7">99+</text></svg>
        </div>

        {/* Total Revenue */}
        <div className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-[#4b2996] via-[#6c4edb] to-[#3b28c7] text-white relative overflow-hidden p-3 md:p-6">
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
              <CurrencyDollarIcon className="w-5 h-5 md:w-7 md:h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">
                {formatCurrency(correctedTotalRevenue)}
              </div>
              <div className="text-white/80 text-xs md:text-sm font-medium mt-1">Total Revenue</div>
            </div>
          </div>
          {/* SVG Line Chart Placeholder */}
          <svg className="absolute bottom-2 right-2 w-10 h-5 md:w-16 md:h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><polyline points="2,28 16,20 32,24 48,10 62,18" /></svg>
        </div>

        {/* Total Bonus */}
        <div className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-yellow-500 via-orange-500 to-red-500 text-white relative overflow-hidden p-3 md:p-6">
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
              <svg className="w-5 h-5 md:w-7 md:h-7 text-white opacity-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
            </div>
            <div>
              <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">
                {formatCurrency(parseFloat(bonusAmount) || 0)}
              </div>
              <div className="text-white/80 text-xs md:text-sm font-medium mt-1">Total Bonus</div>
            </div>
          </div>
          {/* SVG Star Placeholder */}
          <svg className="absolute bottom-2 right-2 w-10 h-5 md:w-12 md:h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 32 32"><polygon points="16,2 20,12 30,12 22,20 26,30 16,24 6,30 10,20 2,12 12,12" /></svg>
        </div>
      </div>

      {/* View Mode Toggle */}
      <div className="card bg-base-100 shadow-sm mb-4 sm:mb-6">
        <div className="card-body p-3 sm:p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
            <h3 className="text-base sm:text-lg font-semibold">View Mode</h3>
            <div className="flex gap-2 w-full sm:w-auto">
              <button
                className={`btn btn-sm sm:btn-md flex-1 sm:flex-none ${viewMode === 'department' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setViewMode('department')}
              >
                Departments
              </button>
              <button
                className={`btn btn-sm sm:btn-md flex-1 sm:flex-none ${viewMode === 'subdepartment' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setViewMode('subdepartment')}
              >
                Roles
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card bg-base-100 shadow-sm mb-4 sm:mb-6">
        <div className="card-body p-3 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
            {/* Search Employee - First */}
            <div className="form-control xl:col-span-2">
              <label className="label">
                <span className="label-text font-semibold text-xs sm:text-sm">Search Employee</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search by name or email..."
                  className="input input-bordered input-sm sm:input-md w-full pr-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 gap-2">
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="btn btn-ghost btn-xs"
                      title="Clear search"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                  <svg className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Department/Subdepartment */}
            <div className="form-control">
              <label className="label">
                <span className="label-text font-semibold text-xs sm:text-sm">
                  {viewMode === 'department' ? 'Department' : 'Subdepartment'}
                </span>
              </label>
              <select
                className="select select-bordered select-sm sm:select-md"
                value={viewMode === 'department' ? selectedDepartment : selectedSubdepartment}
                onChange={(e) => {
                  if (viewMode === 'department') {
                    setSelectedDepartment(e.target.value);
                  } else {
                    setSelectedSubdepartment(e.target.value);
                  }
                }}
              >
                <option value="all">
                  All {viewMode === 'department' ? 'Departments' : 'Subdepartments'}
                </option>
                {viewMode === 'department' ? (
                  departments.map(dept => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))
                ) : (
                  subdepartmentGroups.map(subdept => (
                    <option key={subdept.name} value={subdept.name}>
                      {subdept.name} ({subdept.bonus_percentage}%)
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Role */}
            <div className="form-control">
              <label className="label">
                <span className="label-text font-semibold text-xs sm:text-sm">Role</span>
              </label>
              <select
                className="select select-bordered select-sm sm:select-md"
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
              >
                <option value="all">All Roles</option>
                {roles.map(role => (
                  <option key={role} value={role}>{getRoleDisplayName(role)}</option>
                ))}
              </select>
            </div>

            {/* Date From */}
            <div className="form-control">
              <label className="label">
                <span className="label-text font-semibold text-xs sm:text-sm">Date From</span>
              </label>
              <input
                type="date"
                className="input input-bordered input-sm sm:input-md"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>

            {/* Date To */}
            <div className="form-control">
              <label className="label">
                <span className="label-text font-semibold text-xs sm:text-sm">Date To</span>
              </label>
              <div className="flex gap-2">
              <input
                type="date"
                  className="input input-bordered input-sm sm:input-md flex-1"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                  }}
                  title="Clear date filters (reset to last 30 days)"
                >
                  Clear
                </button>
              </div>
              {/* Show message when only one date is selected */}
              {(dateFrom && !dateTo) || (!dateFrom && dateTo) ? (
                <div className="text-xs text-warning mt-1 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  Select both dates to filter data
                </div>
              ) : null}
            </div>

            {/* Monthly Bonus Pool with Clear All */}
            <div className="form-control">
              <label className="label">
                <span className="label-text font-semibold text-xs sm:text-sm">Monthly Bonus Pool</span>
              </label>
              <div className="flex flex-col gap-2">
                <div className="relative">
                  <input
                    type="number"
                    placeholder="Enter amount..."
                    className="input input-bordered input-sm sm:input-md w-full pr-8 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    value={bonusAmount}
                    onChange={(e) => setBonusAmount(e.target.value)}
                    min="0"
                    step="0.01"
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    <span className="text-gray-400 text-xs sm:text-sm">$</span>
                  </div>
                </div>
                <button
                  className="btn btn-outline btn-xs sm:btn-sm w-full"
                  onClick={() => {
                    setSelectedDepartment('all');
                    setSelectedSubdepartment('all');
                    setSelectedRole('all');
                    setSearchQuery('');
                    setDateFrom('');
                    setDateTo('');
                    setBonusAmount('');
                  }}
                  title="Clear all filters"
                >
                  Clear All
                </button>
              </div>
              <div className="label">
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Department/Subdepartment Groups */}
      <>
      {(() => {
        const groups = viewMode === 'department' ? departmentGroups : subdepartmentGroups;
        console.log('🔍 Current view mode:', viewMode);
        console.log('🔍 Groups to display:', groups.map(g => ({ name: g.name, employeeCount: g.employees.length })));
        return groups;
      })()
      .filter(group => {
        if (viewMode === 'department') {
          const deptGroup = group as DepartmentGroup;
          if (selectedDepartment !== 'all') {
            return deptGroup.name === selectedDepartment;
          }
          return true;
        } else {
          const subdeptGroup = group as SubdepartmentGroup;
          if (selectedSubdepartment !== 'all') {
            return subdeptGroup.name === selectedSubdepartment;
          }
          return true;
        }
      })
      .map((group) => {
        const isSubdepartment = viewMode === 'subdepartment';
        const groupData = isSubdepartment ? group as SubdepartmentGroup : group as DepartmentGroup;
        
        // Filter employees within the group
        const filteredEmployees = groupData.employees.filter(emp => {
          if (selectedRole !== 'all' && emp.bonuses_role !== selectedRole) return false;
          if (searchQuery.trim()) {
            const matchesSearch = emp.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                emp.email.toLowerCase().includes(searchQuery.toLowerCase());
            if (!matchesSearch) return false;
          }
          
          // Date range filtering based on last activity
          if (dateFrom) {
            const lastActivity = emp.performance_metrics?.last_activity;
            if (!lastActivity || lastActivity === 'No activity') return false;
            if (new Date(lastActivity) < new Date(dateFrom)) return false;
          }
          
          if (dateTo) {
            const lastActivity = emp.performance_metrics?.last_activity;
            if (!lastActivity || lastActivity === 'No activity') return false;
            if (new Date(lastActivity) > new Date(dateTo)) return false;
          }
          
          return true;
        });

        // Don't show the group if no employees match the filters
        if (filteredEmployees.length === 0) {
          return null;
        }

        return (
          <div key={groupData.name} className="card shadow-sm mb-4 sm:mb-6">
            <div className="card-header p-3 sm:p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                  <h3 className="text-lg sm:text-xl font-bold">{groupData.name}</h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    {isSubdepartment && (
                      <span className="badge badge-secondary text-xs">
                        {(groupData as SubdepartmentGroup).bonus_percentage}% Bonus
                      </span>
                    )}
                    <span className="badge badge-primary text-xs">{filteredEmployees.length} employees</span>
                  </div>
                </div>
                <div className="text-xs sm:text-sm text-gray-600">
                  <span className="hidden sm:inline">{groupData.total_meetings} meetings • {formatCurrency(groupData.total_revenue)} revenue</span>
                  <span className="sm:hidden">{groupData.total_meetings} meetings</span>
                </div>
              </div>
            </div>
            <div className="card-body p-0">
              <div className="overflow-x-auto">
                <table className="table w-full text-sm sm:text-base">
                  <thead>
                    <tr>
                      <th className="w-1/3 text-sm sm:text-base">Employee</th>
                      <th className="w-1/12 text-sm sm:text-base">
                        <span className="hidden sm:inline">Total Meetings</span>
                        <span className="sm:hidden">Total</span>
                      </th>
                      <th className="w-1/12 text-sm sm:text-base">
                        <span className="hidden sm:inline">Completed</span>
                        <span className="sm:hidden">Done</span>
                      </th>
                      <th className="w-1/12 text-sm sm:text-base">Revenue</th>
                      <th className="w-1/12 text-sm sm:text-base">
                        <span className="hidden sm:inline">Last Activity</span>
                        <span className="sm:hidden">Activity</span>
                      </th>
                      <th className="w-1/12 text-sm sm:text-base">Bonus</th>
                      <th className="w-1/12 text-sm sm:text-base">
                        <span className="hidden sm:inline">Performance</span>
                        <span className="sm:hidden">Perf</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.map((employee) => (
                  <tr 
                    key={employee.id} 
                    className="hover:bg-base-200 cursor-pointer"
                    onClick={() => handleEmployeeClick(employee)}
                  >
                    <td className="w-1/3">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="avatar">
                          {employee.photo_url ? (
                            <div className="rounded-full w-8 sm:w-12">
                              <img 
                                src={employee.photo_url} 
                                alt={employee.display_name}
                                className="w-full h-full object-cover rounded-full"
                                onError={(e) => {
                                  // Fallback to initials if image fails to load
                                  const target = e.target as HTMLImageElement;
                                  target.style.display = 'none';
                                  const parent = target.parentElement;
                                  if (parent) {
                                    parent.innerHTML = `
                                      <div class="bg-primary text-primary-content rounded-full w-8 sm:w-12 h-8 sm:h-12 flex items-center justify-center">
                                        <span class="text-xs sm:text-base font-bold">${getInitials(employee.display_name)}</span>
                                      </div>
                                    `;
                                  }
                                }}
                              />
                            </div>
                          ) : (
                            <div className="placeholder">
                              <div className="bg-primary text-primary-content rounded-full w-8 sm:w-12 h-8 sm:h-12 flex items-center justify-center">
                                <span className="text-xs sm:text-base font-bold">
                                  {getInitials(employee.display_name)}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="font-semibold text-sm sm:text-base truncate">{employee.display_name}</div>
                            <span className="text-xs max-w-full truncate inline-block px-1.5 sm:px-2 py-0.5 rounded-full text-white font-medium bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 shadow-sm flex-shrink-0">
                              {getRoleDisplayName(employee.bonuses_role)}
                            </span>
                          </div>
                          <div className="text-sm sm:text-base text-gray-500 truncate">{employee.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="w-1/12 font-semibold text-sm sm:text-base">
                      {employee.performance_metrics?.total_meetings || 0}
                    </td>
                    <td className="w-1/12 font-semibold text-success text-sm sm:text-base">
                      {employee.performance_metrics?.completed_meetings || 0}
                    </td>
                    <td className="w-1/12 font-semibold text-sm sm:text-base">
                      <span className="hidden sm:inline">{formatCurrency(employee.performance_metrics?.total_revenue || 0)}</span>
                      <span className="sm:hidden">₪{(employee.performance_metrics?.total_revenue || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                    </td>
                    <td className="w-1/12 text-sm sm:text-base">
                      <span className="hidden sm:inline">{formatDate(employee.performance_metrics?.last_activity || 'No activity')}</span>
                      <span className="sm:hidden">
                        {employee.performance_metrics?.last_activity && employee.performance_metrics.last_activity !== 'No activity' 
                          ? new Date(employee.performance_metrics.last_activity).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          : 'N/A'
                        }
                      </span>
                    </td>
                    <td className="w-1/12 font-semibold text-warning text-sm sm:text-base">
                      <span className="hidden sm:inline">{formatCurrency(employee.performance_metrics?.total_bonus || 0)}</span>
                      <span className="sm:hidden">₪{(employee.performance_metrics?.total_bonus || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                    </td>
                    <td className="w-1/12">
                      {employee.performance_metrics?.performance_percentage !== undefined ? (
                      <div className="flex items-center gap-1 sm:gap-2">
                        <div className="w-8 sm:w-16 bg-gray-200 rounded-full h-1.5 sm:h-2">
                          <div 
                              className={`h-1.5 sm:h-2 rounded-full ${
                                (employee.performance_metrics?.performance_percentage || 0) >= 100 
                                  ? 'bg-success' 
                                  : (employee.performance_metrics?.performance_percentage || 0) >= 75 
                                  ? 'bg-warning' 
                                  : 'bg-error'
                              }`}
                            style={{ 
                                width: `${Math.min(100, Math.max(0, employee.performance_metrics?.performance_percentage || 0))}%` 
                            }}
                          ></div>
                        </div>
                          <span className="text-sm sm:text-base font-medium">
                            {employee.performance_metrics?.performance_percentage || 0}%
                        </span>
                      </div>
                      ) : (
                        <span className="text-sm sm:text-base text-gray-500">N/A</span>
                      )}
                    </td>
                  </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })
      .filter(Boolean) // Remove null values from the array
      }
      </>

      {/* No data message */}
      {viewMode === 'department' ? (
        departmentGroups.length === 0 && !isLoading && (
          <div className="text-center py-12">
            <div className="text-gray-500 text-lg">No departments found</div>
            <div className="text-gray-400 text-sm mt-2">Try adjusting your filters or check back later</div>
          </div>
        )
      ) : (
        subdepartmentGroups.length === 0 && !isLoading && (
          <div className="text-center py-12">
            <div className="text-gray-500 text-lg">No subdepartments found</div>
            <div className="text-gray-400 text-sm mt-2">Try adjusting your filters or check back later</div>
          </div>
        )
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="text-center py-12">
          <div className="loading loading-spinner loading-lg"></div>
          <div className="text-gray-500 text-lg mt-4">Loading employee performance data...</div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="alert alert-error">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* Employee Modal */}
      <EmployeeModal 
        employee={selectedEmployee} 
        allEmployees={employees}
        isOpen={isModalOpen} 
        onClose={handleModalClose} 
      />
    </div>
  );
};

export default EmployeePerformancePage;
