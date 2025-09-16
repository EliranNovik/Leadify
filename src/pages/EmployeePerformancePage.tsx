import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { UserGroupIcon, ChartBarIcon, AcademicCapIcon, CurrencyDollarIcon, ClockIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import EmployeeModal from '../components/EmployeeModal';

interface Employee {
  id: string;
  display_name: string;
  email: string;
  bonuses_role: string;
  department: string;
  is_active: boolean;
  photo_url?: string;
  performance_metrics?: {
    total_meetings: number;
    completed_meetings: number;
    total_revenue: number;
    total_bonus: number;
    average_rating: number;
    last_activity: string;
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
      'd': 'Diverse'
    };
    
    return roleMap[roleCode] || roleCode || 'No role';
  };

const EmployeePerformancePage: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departmentGroups, setDepartmentGroups] = useState<DepartmentGroup[]>([]);
  const [subdepartmentGroups, setSubdepartmentGroups] = useState<SubdepartmentGroup[]>([]);
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

  // Fetch employees and their performance data
  useEffect(() => {
    const fetchEmployeePerformance = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // First, let's check what data we have in tenants_employee
        console.log('🔍 Debug: Checking tenants_employee data...');
        console.log('🔍 Debug: Supabase client:', supabase);
        
        // Check current user session
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        console.log('🔍 Debug: Current user:', {
          user: user,
          error: userError
        });

        // If no user session, try to get session instead
        if (!user) {
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();
          console.log('🔍 Debug: Current session:', {
            session: session,
            error: sessionError
          });
        }
        
        // Try a simple count query first
        const { count: employeeCount, error: countError } = await supabase
          .from('tenants_employee')
          .select('*', { count: 'exact', head: true });
        
        console.log('🔍 Debug: Employee count:', {
          count: employeeCount,
          error: countError
        });
        
        const { data: sampleEmployees, error: sampleEmployeesError } = await supabase
          .from('tenants_employee')
          .select('id, display_name, user_id, bonuses_role, department_id')
          .limit(5);

        console.log('🔍 Debug: Sample employees (first 5):', {
          error: sampleEmployeesError,
          data: sampleEmployees
        });

        // Check if auth_user table exists and has data
        console.log('🔍 Debug: Checking auth_user data...');
        const { data: authUsers, error: authUsersError } = await supabase
          .from('auth_user')
          .select('id, email, is_active')
          .limit(5);

        console.log('🔍 Debug: Auth users (first 5):', {
          error: authUsersError,
          data: authUsers
        });

        // Try a simpler approach - get employees first, then check their auth status
        // Let's get ALL employees first to see what we have
        const { data: allEmployeesData, error: allEmployeesDataError } = await supabase
          .from('tenants_employee')
          .select(`
            id,
            display_name,
            bonuses_role,
            department_id,
            user_id,
            photo_url
          `);

        console.log('🔍 Debug: ALL employees:', {
          count: allEmployeesData?.length || 0,
          sample: allEmployeesData?.slice(0, 5)
        });

        if (allEmployeesDataError) {
          console.error('Error fetching all employees:', allEmployeesDataError);
          throw allEmployeesDataError;
        }

        // Filter to only those with user_id for now
        const employeesData = allEmployeesData?.filter(emp => emp.user_id) || [];

        console.log('🔍 Debug: Employees with user_id:', {
          count: employeesData?.length || 0,
          sample: employeesData?.slice(0, 3)
        });

        // Fetch departments for mapping department_id to department name
        const { data: departmentsData, error: departmentsError } = await supabase
          .from('tenant_departement')
          .select('id, name');

        if (departmentsError) {
          console.error('Error fetching departments:', departmentsError);
        }

        console.log('🔍 Debug: Departments:', {
          count: departmentsData?.length || 0,
          data: departmentsData
        });

        // Create department mapping
        const departmentMap = new Map();
        departmentsData?.forEach(dept => {
          departmentMap.set(dept.id, dept.name);
        });

        // Now let's try to get the auth user data for each employee
        const activeEmployees = await Promise.all(
          employeesData.map(async (employee) => {
            try {
              // Get auth user data for this employee
              const { data: authUserData, error: authUserError } = await supabase
                .from('auth_user')
                .select('id, email, is_active')
                .eq('id', employee.user_id)
                .single();

              if (authUserError) {
                console.log(`🔍 Debug: No auth user found for employee ${employee.display_name}:`, authUserError.message);
                return {
                  id: employee.id,
                  display_name: employee.display_name,
                  bonuses_role: employee.bonuses_role,
                  department: employee.department_id ? departmentMap.get(employee.department_id) || 'Unknown' : 'General',
                  email: 'N/A',
                  is_active: false
                };
              }

              return {
                id: employee.id,
                display_name: employee.display_name,
                bonuses_role: employee.bonuses_role,
                department: employee.department_id ? departmentMap.get(employee.department_id) || 'Unknown' : 'General',
                email: authUserData?.email || 'N/A',
                is_active: authUserData?.is_active || false,
                photo_url: employee.photo_url
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
                photo_url: employee.photo_url
              };
            }
          })
        );

        // Filter to only active employees and exclude specific employees
        const excludedEmployees = ['FINANCE', 'INTERNS', 'NO SCHEDULER', 'Mango Test'];
        const filteredActiveEmployees = activeEmployees.filter(emp => 
          emp.is_active && !excludedEmployees.includes(emp.display_name)
        );

        // Debug: Log excluded employees
        const excludedFound = activeEmployees.filter(emp => 
          emp.is_active && excludedEmployees.includes(emp.display_name)
        );
        if (excludedFound.length > 0) {
          console.log('🚫 Excluded employees:', excludedFound.map(emp => ({
            name: emp.display_name,
            role: emp.bonuses_role,
            department: emp.department
          })));
        }

        console.log('🔍 Employee Performance - Active employees loaded:', {
          totalEmployees: employeesData?.length || 0,
          allEmployees: activeEmployees.length,
          activeEmployees: filteredActiveEmployees.length,
          departmentsFound: departmentsData?.length || 0,
          sample: filteredActiveEmployees.slice(0, 3).map(emp => ({
            name: emp.display_name,
            email: emp.email,
            role: emp.bonuses_role,
            department: emp.department
          }))
        });

        // Fetch performance metrics for each employee
        const employeesWithMetrics = await Promise.all(
          filteredActiveEmployees.map(async (employee) => {
            try {
              // Fetch meetings data for this employee
              const { data: meetingsData, error: meetingsError } = await supabase
                .from('meetings')
                .select(`
                  id,
                  meeting_date,
                  meeting_time,
                  meeting_manager,
                  helper,
                  meeting_amount,
                  meeting_currency,
                  status,
                  lead:leads!client_id(
                    id,
                    balance,
                    balance_currency
                  ),
                  legacy_lead:leads_lead!legacy_lead_id(
                    id,
                    total,
                    meeting_total_currency_id
                  )
                `)
                .or(`meeting_manager.eq.${employee.id},helper.eq.${employee.id}`)
                .order('meeting_date', { ascending: false });

              if (meetingsError) {
                console.error(`Error fetching meetings for ${employee.display_name}:`, meetingsError);
              }

              // Calculate performance metrics
              const meetings = meetingsData || [];
              const completedMeetings = meetings.filter(m => m.status !== 'canceled').length;
              const totalRevenue = meetings.reduce((sum, meeting) => {
                const lead = meeting.lead || meeting.legacy_lead;
                if (lead) {
                  const amount = lead.balance || lead.total || meeting.meeting_amount || 0;
                  return sum + (typeof amount === 'number' ? amount : 0);
                }
                return sum;
              }, 0);

              // Get last activity date
              const lastActivity = meetings.length > 0 
                ? meetings[0].meeting_date 
                : null;

              return {
                ...employee,
                performance_metrics: {
                  total_meetings: meetings.length,
                  completed_meetings: completedMeetings,
                  total_revenue: totalRevenue,
                  total_bonus: 0,
                  average_rating: 0, // Placeholder - would need rating system
                  last_activity: lastActivity || 'No activity'
                }
              };
            } catch (error) {
              console.error(`Error processing metrics for ${employee.display_name}:`, error);
              return {
                ...employee,
                performance_metrics: {
                  total_meetings: 0,
                  completed_meetings: 0,
                  total_revenue: 0,
                  total_bonus: 0,
                  average_rating: 0,
                  last_activity: 'No activity'
                }
              };
            }
          })
        );

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

        // Create department groups with aggregated metrics
        const departmentGroups: DepartmentGroup[] = Object.entries(groupedByDepartment).map(([deptName, deptEmployees]) => {
          const totalMeetings = deptEmployees.reduce((sum, emp) => sum + (emp.performance_metrics?.total_meetings || 0), 0);
          const totalRevenue = deptEmployees.reduce((sum, emp) => sum + (emp.performance_metrics?.total_revenue || 0), 0);
          const averagePerformance = deptEmployees.length > 0 
            ? deptEmployees.reduce((sum, emp) => sum + (emp.performance_metrics?.completed_meetings || 0), 0) / deptEmployees.length
            : 0;

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
          const totalRevenue = subdept.employees.reduce((sum, emp) => sum + (emp.performance_metrics?.total_revenue || 0), 0);
          const averagePerformance = subdept.employees.length > 0 
            ? subdept.employees.reduce((sum, emp) => sum + (emp.performance_metrics?.completed_meetings || 0), 0) / subdept.employees.length
            : 0;

          return {
            ...subdept,
            total_meetings: totalMeetings,
            total_revenue: totalRevenue,
            average_performance: averagePerformance
          };
        });

        setSubdepartmentGroups(subdepartmentGroups);

        // Debug: Log subdepartment groups
        console.log('🏢 Subdepartment groups created:', subdepartmentGroups.map(subdept => ({
          name: subdept.name,
          employeeCount: subdept.employees.length,
          employees: subdept.employees.map(emp => ({ name: emp.display_name, role: emp.bonuses_role }))
        })));

        // Debug: Log all unique roles found
        const allRoles = [...new Set(employeesWithMetrics.map(emp => emp.bonuses_role))];
        console.log('🔍 All roles found in data:', allRoles);
        
        // Debug: Log Partners & Co employees
        const partnersEmployees = employeesWithMetrics.filter(emp => 
          ['p', 'm', 'dm', 'pm', 'se', 'b', 'partners', 'dv'].includes(emp.bonuses_role)
        );
        console.log('🤝 Partners & Co employees:', partnersEmployees.map(emp => ({
          name: emp.display_name,
          role: emp.bonuses_role
        })));

      } catch (error) {
        console.error('Error fetching employee performance:', error);
        setError('Failed to load employee performance data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchEmployeePerformance();
  }, []);


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
      minimumFractionDigits: 0
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
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <ChartBarIcon className="w-8 h-8 text-primary" />
          <h1 className="text-3xl font-bold">Employee Performance</h1>
        </div>
        <p className="text-gray-600">Track and analyze employee performance across departments and roles</p>
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
                {formatCurrency(employees.reduce((sum, emp) => sum + (emp.performance_metrics?.total_revenue || 0), 0))}
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
      <div className="card bg-base-100 shadow-sm mb-6">
        <div className="card-body">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">View Mode</h3>
            <div className="flex gap-2">
              <button
                className={`btn ${viewMode === 'department' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setViewMode('department')}
              >
                Departments
              </button>
              <button
                className={`btn ${viewMode === 'subdepartment' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setViewMode('subdepartment')}
              >
                Roles
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card bg-base-100 shadow-sm mb-6">
        <div className="card-body">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="form-control">
              <label className="label">
                <span className="label-text font-semibold">
                  {viewMode === 'department' ? 'Department' : 'Subdepartment'}
                </span>
              </label>
              <select
                className="select select-bordered"
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

            <div className="form-control">
              <label className="label">
                <span className="label-text font-semibold">Role</span>
              </label>
              <select
                className="select select-bordered"
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
              >
                <option value="all">All Roles</option>
                {roles.map(role => (
                  <option key={role} value={role}>{getRoleDisplayName(role)}</option>
                ))}
              </select>
            </div>

            <div className="form-control flex-1">
              <label className="label">
                <span className="label-text font-semibold">Search Employee</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search by name or email..."
                  className="input input-bordered w-full pr-10"
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
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text font-semibold">Date From</span>
              </label>
              <input
                type="date"
                className="input input-bordered"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text font-semibold">Date To</span>
              </label>
              <input
                type="date"
                className="input input-bordered"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text font-semibold">Monthly Bonus Pool</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  placeholder="Enter total bonus pool amount..."
                  className="input input-bordered w-full pr-8 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  value={bonusAmount}
                  onChange={(e) => setBonusAmount(e.target.value)}
                  min="0"
                  step="0.01"
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                  <span className="text-gray-400 text-sm">$</span>
                </div>
              </div>
              <div className="label">
                <span className="label-text-alt text-gray-500">Total bonus amount for all employees</span>
              </div>
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text font-semibold">&nbsp;</span>
              </label>
              <button
                className="btn btn-outline btn-sm"
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
          <div key={groupData.name} className="card shadow-sm mb-6">
            <div className="card-header">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <AcademicCapIcon className="w-6 h-6 text-primary" />
                  {groupData.name}
                  {isSubdepartment && (
                    <span className="badge badge-secondary">
                      {(groupData as SubdepartmentGroup).bonus_percentage}% Bonus
                    </span>
                  )}
                  <span className="badge badge-primary">{filteredEmployees.length} employees</span>
                </h3>
                <div className="text-sm text-gray-600">
                  {groupData.total_meetings} meetings • {formatCurrency(groupData.total_revenue)} revenue
                </div>
              </div>
            </div>
            <div className="card-body p-0">
              <div className="overflow-x-auto">
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th className="w-1/4">Employee</th>
                      <th className="w-1/12">Role</th>
                      <th className="w-1/12">Total Meetings</th>
                      <th className="w-1/12">Completed</th>
                      <th className="w-1/12">Revenue</th>
                      <th className="w-1/12">Last Activity</th>
                      <th className="w-1/12">Bonus</th>
                      <th className="w-1/12">Performance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.map((employee) => (
                  <tr 
                    key={employee.id} 
                    className="hover:bg-base-200 cursor-pointer"
                    onClick={() => handleEmployeeClick(employee)}
                  >
                    <td className="w-1/4">
                      <div className="flex items-center gap-3">
                        <div className="avatar">
                          {employee.photo_url ? (
                            <div className="rounded-full w-10">
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
                                      <div class="bg-primary text-primary-content rounded-full w-10 h-10 flex items-center justify-center">
                                        <span class="text-sm font-bold">${getInitials(employee.display_name)}</span>
                                      </div>
                                    `;
                                  }
                                }}
                              />
                            </div>
                          ) : (
                            <div className="placeholder">
                              <div className="bg-primary text-primary-content rounded-full w-10 h-10 flex items-center justify-center">
                                <span className="text-sm font-bold">
                                  {getInitials(employee.display_name)}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="font-semibold">{employee.display_name}</div>
                          <div className="text-sm text-gray-500">{employee.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="w-1/12">
                      <span className="badge badge-outline">
                        {getRoleDisplayName(employee.bonuses_role)}
                      </span>
                    </td>
                    <td className="w-1/12 font-semibold">
                      {employee.performance_metrics?.total_meetings || 0}
                    </td>
                    <td className="w-1/12 font-semibold text-success">
                      {employee.performance_metrics?.completed_meetings || 0}
                    </td>
                    <td className="w-1/12 font-semibold">
                      {formatCurrency(employee.performance_metrics?.total_revenue || 0)}
                    </td>
                    <td className="w-1/12 text-sm">
                      {formatDate(employee.performance_metrics?.last_activity || 'No activity')}
                    </td>
                    <td className="w-1/12 font-semibold text-warning">
                      {formatCurrency(employee.performance_metrics?.total_bonus || 0)}
                    </td>
                    <td className="w-1/12">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-primary h-2 rounded-full" 
                            style={{ 
                              width: `${Math.min(100, ((employee.performance_metrics?.completed_meetings || 0) / Math.max(1, employee.performance_metrics?.total_meetings || 1)) * 100)}%` 
                            }}
                          ></div>
                        </div>
                        <span className="text-sm font-medium">
                          {Math.round(((employee.performance_metrics?.completed_meetings || 0) / Math.max(1, employee.performance_metrics?.total_meetings || 1)) * 100)}%
                        </span>
                      </div>
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
        isOpen={isModalOpen} 
        onClose={handleModalClose} 
      />
    </div>
  );
};

export default EmployeePerformancePage;
