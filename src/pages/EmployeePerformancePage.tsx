import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { UserGroupIcon, ChartBarIcon, AcademicCapIcon, CurrencyDollarIcon, ClockIcon, CheckCircleIcon, XCircleIcon, DocumentTextIcon, BanknotesIcon, Squares2X2Icon, ListBulletIcon, CalendarDaysIcon } from '@heroicons/react/24/outline';
import EmployeeModal from '../components/EmployeeModal';
import SalaryModal from '../components/SalaryModal';
import BonusPoolModal from '../components/BonusPoolModal';
import { convertToNIS, calculateTotalRevenueInNIS } from '../lib/currencyConversion';
import { calculateEmployeeBonus, EmployeeBonus, RoleBonus } from '../lib/bonusCalculation';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar, PieChart, Pie, Cell, Legend } from 'recharts';

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
    total_meetings?: number;
    completed_meetings?: number;
    contracts_signed?: number;
    cases_handled?: number;
    total_revenue?: number;
    total_bonus?: number;
    average_rating?: number;
    last_activity?: string;
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
    // Bonus information
    calculated_bonus?: number;
    bonus_breakdown?: any[];
  };
}

interface DepartmentGroup {
  name: string;
  employees: Employee[];
  total_meetings: number;
  total_revenue: number;
  total_signed_contracts: number;
  average_performance: number;
}

interface SubdepartmentGroup {
  name: string;
  bonus_percentage: number;
  employees: Employee[];
  total_meetings: number;
  total_revenue: number;
  average_performance: number;
  total_signed_contracts?: number;
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

// Employee Performance Box Component for grid view
interface EmployeePerformanceBoxProps {
  employee: Employee;
  onEmployeeClick: (employee: Employee) => void;
}

const EmployeePerformanceBox: React.FC<EmployeePerformanceBoxProps> = ({ 
  employee, 
  onEmployeeClick 
}) => {
  const formatCurrency = (amount: number) => {
    return `₪${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  };

  const formatDate = (dateString: string) => {
    if (!dateString || dateString === 'No activity') return 'No activity';
    return new Date(dateString).toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  return (
    <div 
      className="card bg-base-100 shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer overflow-hidden"
      onClick={() => onEmployeeClick(employee)}
    >
      {/* Header with background image */}
      <div className="relative h-24 overflow-hidden" style={{ backgroundColor: '#3e2bcd' }}>
        {/* Background pattern overlay */}
        <div className="absolute inset-0 bg-black/20"></div>
        <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-black/30"></div>
        
        {/* Decorative elements */}
        <div className="absolute top-2 right-2 w-16 h-16 bg-white/10 rounded-full blur-xl"></div>
        <div className="absolute bottom-2 left-2 w-12 h-12 bg-white/5 rounded-full blur-lg"></div>
        
        {/* Employee info overlay */}
        <div className="relative z-10 p-4 h-full flex items-end">
          <div className="flex items-center gap-3">
            <div className="avatar">
              {employee.photo_url ? (
                <div className="rounded-full w-16 h-16 ring-2 ring-white/30">
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
                          <div class="bg-white/20 backdrop-blur-sm text-white rounded-full w-16 h-16 flex items-center justify-center ring-2 ring-white/30">
                            <span class="text-lg font-bold">${getInitials(employee.display_name)}</span>
                          </div>
                        `;
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="bg-white/20 backdrop-blur-sm text-white rounded-full w-16 h-16 flex items-center justify-center ring-2 ring-white/30">
                  <span className="text-lg font-bold">
                    {getInitials(employee.display_name)}
                  </span>
                </div>
              )}
            </div>
            <div className="text-white flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="font-semibold text-lg truncate drop-shadow-sm">{employee.display_name}</div>
              </div>
              <div className="text-white/80 text-sm truncate drop-shadow-sm">{employee.email}</div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Role Glassy Box */}
      <div className="relative -mt-2 mx-4 mb-4">
        <div className="bg-white/80 backdrop-blur-md rounded-lg p-3 border border-white/20" style={{ boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.1)' }}>
          <div className="flex items-center">
            <span className="text-sm font-medium text-gray-700">{getRoleDisplayName(employee.bonuses_role)}</span>
          </div>
        </div>
      </div>
      
      <div className="card-body p-4">

        {/* Performance Metrics */}
        <div className="space-y-3">
          {/* Managed Meetings */}
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Managed</span>
            <div className="text-right">
              <div className="font-semibold text-sm">
                {employee.performance_metrics?.total_meetings || 0}
              </div>
              <div className="text-xs text-gray-500">Meetings</div>
            </div>
          </div>

          {/* Scheduled Meetings */}
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Scheduled</span>
            <div className="text-right">
              <div className="font-semibold text-sm">
                {employee.performance_metrics?.meetings_scheduled || 0}
              </div>
              <div className="text-xs text-gray-500">Meetings</div>
            </div>
          </div>

          {/* Cases */}
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Cases</span>
            <div className="text-right">
              <div className="font-semibold text-sm">
                {employee.performance_metrics?.cases_handled || 0}
              </div>
              <div className="text-xs text-gray-500">Handled</div>
            </div>
          </div>

          {/* Contracts Signed */}
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Contracts</span>
            <div className="text-right">
              <div className="font-semibold text-sm">
                {employee.performance_metrics?.contracts_signed || 0}
              </div>
              <div className="text-xs text-gray-500">Signed</div>
            </div>
          </div>

          {/* Revenue */}
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Revenue</span>
            <div className="text-right">
              <div className="font-semibold text-sm">
                {formatCurrency(employee.performance_metrics?.total_revenue || 0)}
              </div>
            </div>
          </div>

          {/* Bonus */}
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Bonus</span>
            <div className="text-right">
              <div className="font-semibold text-sm text-black">
                {formatCurrency(employee.performance_metrics?.calculated_bonus || employee.performance_metrics?.total_bonus || 0)}
              </div>
            </div>
          </div>

          {/* Performance Percentage */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Performance</span>
              <span className="text-sm font-medium">
                {employee.performance_metrics?.performance_percentage || 0}%
              </span>
            </div>
            {employee.performance_metrics?.performance_percentage !== undefined && (
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className={`h-2 rounded-full ${
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
            )}
          </div>

          {/* Last Activity */}
          <div className="flex justify-between items-center pt-2 border-t border-gray-100">
            <span className="text-sm text-gray-600">Last Activity</span>
            <div className="text-right">
              <div className="text-xs text-gray-500">
                {formatDate(employee.performance_metrics?.last_activity || 'No activity')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const EmployeePerformancePage: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departmentGroups, setDepartmentGroups] = useState<DepartmentGroup[]>([]);
  const [subdepartmentGroups, setSubdepartmentGroups] = useState<SubdepartmentGroup[]>([]);
  const [correctedTotalRevenue, setCorrectedTotalRevenue] = useState<number>(0);
  const [totalSignedContracts, setTotalSignedContracts] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [showRevenueGraph, setShowRevenueGraph] = useState(false);
  const [revenueGraphData, setRevenueGraphData] = useState<any[]>([]);
  const [showMeetingsGraph, setShowMeetingsGraph] = useState(false);
  const [meetingsGraphData, setMeetingsGraphData] = useState<any[]>([]);
  const [meetingsByTypeData, setMeetingsByTypeData] = useState<any[]>([]);
  const [showContractsGraph, setShowContractsGraph] = useState(false);
  const [contractsGraphData, setContractsGraphData] = useState<any[]>([]);
  const [contractsByDepartmentData, setContractsByDepartmentData] = useState<any[]>([]);
  
  // Loading states for graphs
  const [revenueGraphLoading, setRevenueGraphLoading] = useState(false);
  const [meetingsGraphLoading, setMeetingsGraphLoading] = useState(false);
  const [contractsGraphLoading, setContractsGraphLoading] = useState(false);
  const [graphYear, setGraphYear] = useState<number>(new Date().getFullYear());
  const [graphStartMonth, setGraphStartMonth] = useState<number>(1);
  const [graphEndMonth, setGraphEndMonth] = useState<number>(new Date().getMonth() + 1);
  const [error, setError] = useState<string | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [selectedRole, setSelectedRole] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [appliedDateFrom, setAppliedDateFrom] = useState<string>('');
  const [appliedDateTo, setAppliedDateTo] = useState<string>('');
  const [isApplyingFilter, setIsApplyingFilter] = useState(false);
  const [viewMode, setViewMode] = useState<'department' | 'subdepartment'>('department');
  const [selectedSubdepartment, setSelectedSubdepartment] = useState<string>('all');
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSalaryModalOpen, setIsSalaryModalOpen] = useState(false);
  const [isBonusPoolModalOpen, setIsBonusPoolModalOpen] = useState(false);
  const [displayViewMode, setDisplayViewMode] = useState<'list' | 'grid'>('list');

  // Fetch comprehensive performance data for employees
  // Fetch meetings data for the graph
  const fetchMeetingsGraphData = async (year: number, startMonth: number, endMonth: number) => {
    setMeetingsGraphLoading(true);
    try {
      console.log(`📊 Fetching meetings graph data for ${year}, months ${startMonth}-${endMonth}`);
      
      // Calculate date range for the entire period
      const startDate = new Date(year, startMonth - 1, 1);
      const endDate = new Date(year, endMonth, 0, 23, 59, 59);
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];
      
      console.log(`📊 Fetching all meetings data for period: ${startDateStr} to ${endDateStr}`);
      
      // Fetch all regular meetings for the entire period in one query
      const { data: allRegularMeetings, error: regularMeetingsError } = await supabase
        .from('meetings')
        .select(`
          id, 
          meeting_date, 
          legacy_lead_id
        `)
        .gte('meeting_date', startDateStr)
        .lte('meeting_date', endDateStr);
      
      if (regularMeetingsError) {
        console.error('Error fetching regular meetings:', regularMeetingsError);
      }
      
      // Fetch all legacy meetings for the entire period in one query
      const { data: allLegacyMeetings, error: legacyMeetingsError } = await supabase
        .from('leads_lead')
        .select(`
          id, 
          meeting_date
        `)
        .gte('meeting_date', startDateStr)
        .lte('meeting_date', endDateStr)
        .not('meeting_date', 'is', null);
      
      if (legacyMeetingsError) {
        console.error('Error fetching legacy meetings:', legacyMeetingsError);
      }
      
      // Process data by month
      const graphData = [];
      const meetingsByDept = new Map();
      
      for (let month = startMonth; month <= endMonth; month++) {
        const monthStartDate = new Date(year, month - 1, 1);
        const monthEndDate = new Date(year, month, 0, 23, 59, 59);
        const monthStartStr = monthStartDate.toISOString().split('T')[0];
        const monthEndStr = monthEndDate.toISOString().split('T')[0];
        
        // Filter meetings for this month
        const monthRegularMeetings = allRegularMeetings?.filter(meeting => 
          meeting.meeting_date >= monthStartStr && meeting.meeting_date <= monthEndStr
        ) || [];
        
        const monthLegacyMeetings = allLegacyMeetings?.filter(meeting => 
          meeting.meeting_date >= monthStartStr && meeting.meeting_date <= monthEndStr
        ) || [];
        
        // Create a set to track unique meetings and avoid double counting
        const uniqueMeetings = new Set();
        
        // Add regular meetings to the set
        monthRegularMeetings.forEach(meeting => {
          uniqueMeetings.add(`regular_${meeting.id}`);
        });
        
        // Add legacy meetings to the set, but only if they don't have a corresponding regular meeting
        monthLegacyMeetings.forEach(legacyMeeting => {
          // Check if this legacy meeting already has a corresponding regular meeting
          const hasRegularMeeting = monthRegularMeetings.some(regularMeeting => 
            regularMeeting.legacy_lead_id === legacyMeeting.id
          );
          
          // Only add if there's no corresponding regular meeting
          if (!hasRegularMeeting) {
            uniqueMeetings.add(`legacy_${legacyMeeting.id}`);
          }
        });
        
        const totalMeetings = uniqueMeetings.size;
        const regularCount = monthRegularMeetings.length;
        const legacyCount = monthLegacyMeetings.length;
        
        graphData.push({
          month: month,
          monthName: monthStartDate.toLocaleDateString('en-US', { month: 'short' }),
          total: totalMeetings
        });
        
        console.log(`📊 ${year}-${month}: ${totalMeetings} unique meetings (${regularCount} regular + ${legacyCount} legacy, ${regularCount + legacyCount - totalMeetings} duplicates removed)`);
      }
      
      // Get department data for meetings - fetch department info separately for better performance
      const departmentCounts = new Map();
      
      // Get unique lead IDs from all meetings
      const allLeadIds = new Set();
      
      // Add regular meeting lead IDs
      if (allRegularMeetings) {
        allRegularMeetings.forEach(meeting => {
          if (meeting.legacy_lead_id) {
            allLeadIds.add(meeting.legacy_lead_id);
          }
        });
      }
      
      // Add legacy meeting IDs
      if (allLegacyMeetings) {
        allLegacyMeetings.forEach(meeting => {
          allLeadIds.add(meeting.id);
        });
      }
      
      // Fetch department data for all unique leads in one query
      if (allLeadIds.size > 0) {
        const leadIdsArray = Array.from(allLeadIds);
        
        // Process in batches to avoid query size limits
        const batchSize = 100;
        for (let i = 0; i < leadIdsArray.length; i += batchSize) {
          const batch = leadIdsArray.slice(i, i + batchSize);
          
          const { data: leadsWithDept, error: deptError } = await supabase
            .from('leads_lead')
            .select(`
              id,
              misc_category(
                misc_maincategory(
                  tenant_departement(name)
                )
              )
            `)
            .in('id', batch);
          
          if (deptError) {
            console.error('Error fetching department data:', deptError);
            continue;
          }
          
              // Count meetings by department
              if (leadsWithDept) {
                leadsWithDept.forEach(lead => {
                  const leadData = lead as any;
                  const departmentName = leadData.misc_category?.misc_maincategory?.tenant_departement?.name || 'Unknown';
              
              // Count how many meetings this lead has
              let meetingCount = 0;
              
              // Count regular meetings for this lead
              if (allRegularMeetings) {
                meetingCount += allRegularMeetings.filter(meeting => meeting.legacy_lead_id === lead.id).length;
              }
              
              // Count legacy meetings for this lead
              if (allLegacyMeetings) {
                meetingCount += allLegacyMeetings.filter(meeting => meeting.id === lead.id).length;
              }
              
              if (meetingCount > 0) {
                departmentCounts.set(departmentName, (departmentCounts.get(departmentName) || 0) + meetingCount);
              }
            });
          }
        }
      }
      
      // Convert meetings by department to array
      const meetingsByDeptArray = Array.from(departmentCounts.entries()).map(([dept, count]) => ({
        department: dept,
        meetings: count
      }));
      
      console.log('📊 Meetings graph data:', graphData);
      console.log('📊 Meetings by department data:', meetingsByDeptArray);
      setMeetingsGraphData(graphData);
      setMeetingsByTypeData(meetingsByDeptArray);
      
    } catch (error) {
      console.error('Error fetching meetings graph data:', error);
    } finally {
      setMeetingsGraphLoading(false);
    }
  };

  // Fetch contracts data for the graph
  const fetchContractsGraphData = async (year: number, startMonth: number, endMonth: number) => {
    setContractsGraphLoading(true);
    try {
      console.log(`📊 Fetching contracts graph data for ${year}, months ${startMonth}-${endMonth}`);
      
      const graphData = [];
      const contractsByDept = new Map();
      
      for (let month = startMonth; month <= endMonth; month++) {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);
        
        console.log(`📊 Fetching contracts data for ${year}-${month.toString().padStart(2, '0')}: ${startDate.toISOString()} to ${endDate.toISOString()}`);
        
        // Fetch signed stages for this month
        const { data: stageRecords, error: stageError } = await supabase
          .from('leads_leadstage')
          .select('lead_id, date')
          .eq('stage', 60)
          .gte('date', startDate.toISOString())
          .lte('date', endDate.toISOString());
        
        if (stageError) {
          console.error(`Error fetching stages for ${year}-${month}:`, stageError);
          continue;
        }
        
        if (!stageRecords || stageRecords.length === 0) {
          graphData.push({
            month: month,
            monthName: startDate.toLocaleDateString('en-US', { month: 'short' }),
            contracts: 0
          });
          continue;
        }
        
        // Fetch leads data with department info
        const leadIds = [...new Set(stageRecords.map(record => record.lead_id).filter(id => id !== null))];
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
          console.error(`Error fetching leads for ${year}-${month}:`, leadsError);
          continue;
        }
        
        let monthContracts = 0;
        
        if (leadsData && leadsData.length > 0) {
          leadsData.forEach(lead => {
            monthContracts += 1;
            
            // Get department name
            const leadData = lead as any;
            const departmentName = leadData.misc_category?.misc_maincategory?.tenant_departement?.name || 'Unknown';
            contractsByDept.set(departmentName, (contractsByDept.get(departmentName) || 0) + 1);
          });
        }
        
        graphData.push({
          month: month,
          monthName: startDate.toLocaleDateString('en-US', { month: 'short' }),
          contracts: monthContracts
        });
        
        console.log(`📊 ${year}-${month}: ${monthContracts} contracts`);
      }
      
      // Convert contracts by department to array
      const contractsByDeptArray = Array.from(contractsByDept.entries()).map(([dept, count]) => ({
        department: dept,
        contracts: count
      }));
      
      console.log('📊 Contracts graph data:', graphData);
      console.log('📊 Contracts by department data:', contractsByDeptArray);
      setContractsGraphData(graphData);
      setContractsByDepartmentData(contractsByDeptArray);
      
    } catch (error) {
      console.error('Error fetching contracts graph data:', error);
    } finally {
      setContractsGraphLoading(false);
    }
  };

  // Fetch revenue data for the graph
  const fetchRevenueGraphData = async (year: number, startMonth: number, endMonth: number) => {
    setRevenueGraphLoading(true);
    try {
      console.log(`📊 Fetching revenue graph data for ${year}, months ${startMonth}-${endMonth}`);
      
      const graphData = [];
      
      for (let month = startMonth; month <= endMonth; month++) {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);
        
        console.log(`📊 Fetching data for ${year}-${month.toString().padStart(2, '0')}: ${startDate.toISOString()} to ${endDate.toISOString()}`);
        
        // Fetch signed stages for this month
        const { data: stageRecords, error: stageError } = await supabase
          .from('leads_leadstage')
          .select('lead_id, date')
          .eq('stage', 60)
          .gte('date', startDate.toISOString())
          .lte('date', endDate.toISOString());
        
        if (stageError) {
          console.error(`Error fetching stages for ${year}-${month}:`, stageError);
          continue;
        }
        
        if (!stageRecords || stageRecords.length === 0) {
          graphData.push({
            month: month,
            monthName: startDate.toLocaleDateString('en-US', { month: 'short' }),
            revenue: 0,
            contracts: 0
          });
          continue;
        }
        
        // Fetch leads data for the signed stages
        const leadIds = [...new Set(stageRecords.map(record => record.lead_id).filter(id => id !== null))];
        const { data: leadsData, error: leadsError } = await supabase
          .from('leads_lead')
          .select('id, total, currency_id')
          .in('id', leadIds);
        
        if (leadsError) {
          console.error(`Error fetching leads for ${year}-${month}:`, leadsError);
          continue;
        }
        
        // Calculate total revenue for this month
        let monthRevenue = 0;
        let monthContracts = 0;
        
        if (leadsData && leadsData.length > 0) {
          leadsData.forEach(lead => {
            const amount = parseFloat(lead.total) || 0;
            const amountInNIS = convertToNIS(amount, lead.currency_id);
            monthRevenue += amountInNIS;
            monthContracts += 1;
          });
        }
        
        graphData.push({
          month: month,
          monthName: startDate.toLocaleDateString('en-US', { month: 'short' }),
          revenue: Math.round(monthRevenue),
          contracts: monthContracts
        });
        
        console.log(`📊 ${year}-${month}: ${monthContracts} contracts, ₪${Math.round(monthRevenue)} revenue`);
      }
      
      console.log('📊 Revenue graph data:', graphData);
      setRevenueGraphData(graphData);
      
    } catch (error) {
      console.error('Error fetching revenue graph data:', error);
    } finally {
      setRevenueGraphLoading(false);
    }
  };

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

      // Fetch ALL leads for the date range to get total meetings count
      const { data: allLeads, error: allLeadsError } = await supabase
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
        .gte('cdate', fromDateValue)
        .lte('cdate', toDateValue);
      
      if (allLeadsError) {
        console.error('Error fetching all leads:', allLeadsError);
        throw allLeadsError;
      }
      
      console.log('📊 All leads fetched:', allLeads?.length || 0);

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
        allLeads: allLeads || [],
        proformaInvoices,
        dateRange: { from: fromDateValue, to: toDateValue }
      };
    } catch (error) {
      console.error('Error fetching comprehensive performance data:', error);
      throw error;
    }
  };

  // Calculate team averages for performance benchmarking
  // Calculate bonuses for all employees
  const calculateEmployeeBonuses = async (employees: Employee[], dateFrom?: string, dateTo?: string) => {
    if (!dateFrom || !dateTo) return employees;

    console.log(`🎯 Calculating bonuses for ${employees.length} employees for date range: ${dateFrom} to ${dateTo}`);

    const employeesWithBonuses = await Promise.all(
      employees.map(async (employee) => {
        try {
          console.log(`🎯 Processing employee: ${employee.display_name}, Role: ${employee.bonuses_role}, ID: ${employee.id}`);
          
          const bonusData = await calculateEmployeeBonus(
            employee.id,
            employee.bonuses_role,
            dateFrom,
            dateTo,
            0 // monthlyPoolAmount - the function will fetch the actual pool internally
          );

          console.log(`🎯 Bonus calculated for ${employee.display_name}:`, {
            totalBonus: bonusData.totalBonus,
            roleBonuses: bonusData.roleBonuses.length,
            roleBonusesDetails: bonusData.roleBonuses
          });

          return {
            ...employee,
            performance_metrics: {
              ...employee.performance_metrics,
              calculated_bonus: bonusData.totalBonus,
              bonus_breakdown: bonusData.roleBonuses,
            },
          };
        } catch (error) {
          console.error(`Error calculating bonus for employee ${employee.id}:`, error);
          return employee;
        }
      })
    );

    return employeesWithBonuses;
  };

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
      // Only fetch if both applied dates are selected, or if no applied dates are selected (use default)
      const shouldFetch = (!appliedDateFrom && !appliedDateTo) || (appliedDateFrom && appliedDateTo);
      
      if (!shouldFetch) {
        console.log('📅 Skipping fetch - waiting for both applied dates to be selected');
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Get employee data using the new pattern with users table join - only active users
        const { data: allEmployeesData, error: allEmployeesDataError } = await supabase
          .from('users')
          .select(`
            id,
            full_name,
            email,
            employee_id,
            is_active,
            tenants_employee!employee_id(
              id,
              display_name,
              bonuses_role,
              department_id,
              user_id,
              photo_url,
              photo,
              phone,
              mobile,
              phone_ext,
              tenant_departement!department_id(
                id,
                name
              )
            )
          `)
          .not('employee_id', 'is', null)
          .eq('is_active', true);

        if (allEmployeesDataError) {
          console.error('Error fetching all employees:', allEmployeesDataError);
          throw allEmployeesDataError;
        }

        // Fetch departments for mapping (fallback)
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

        // Process employees data with deduplication
        const processedEmployees = (allEmployeesData || [])
          .filter(user => user.tenants_employee && user.email)
          .map(user => {
            const employee = user.tenants_employee as any;
            return {
              id: employee.id,
              display_name: employee.display_name,
              bonuses_role: employee.bonuses_role,
              department: employee.tenant_departement?.name || (employee.department_id ? departmentMap.get(employee.department_id) || 'Unknown' : 'General'),
              email: user.email,
              is_active: true, // All users with employee_id are considered active
              photo_url: employee.photo_url,
              photo: employee.photo,
              phone: employee.phone,
              mobile: employee.mobile,
              phone_ext: employee.phone_ext
            };
          });

        // Deduplicate by employee ID to prevent duplicates
        const uniqueEmployeesMap = new Map();
        processedEmployees.forEach(emp => {
          if (!uniqueEmployeesMap.has(emp.id)) {
            uniqueEmployeesMap.set(emp.id, emp);
          }
        });
        const activeEmployees = Array.from(uniqueEmployeesMap.values());

        // Filter to only active employees and exclude specific employees
        const excludedEmployees = ['FINANCE', 'INTERNS', 'NO SCHEDULER', 'Mango Test', 'pink', 'Interns'];
        const filteredActiveEmployees = activeEmployees.filter(emp => 
          emp.is_active && !excludedEmployees.includes(emp.display_name)
        );

        console.log('🔍 Employee Performance - Active employees loaded:', {
          totalUsers: allEmployeesData?.length || 0,
          processedEmployees: processedEmployees.length,
          uniqueEmployees: activeEmployees.length,
          finalFilteredEmployees: filteredActiveEmployees.length,
          departmentsFound: departmentsData?.length || 0,
          sampleEmployee: filteredActiveEmployees[0] ? {
            id: filteredActiveEmployees[0].id,
            name: filteredActiveEmployees[0].display_name,
            email: filteredActiveEmployees[0].email,
            bonuses_role: filteredActiveEmployees[0].bonuses_role
          } : null,
          allEmployees: filteredActiveEmployees.map(emp => ({
            id: emp.id,
            name: emp.display_name,
            role: emp.bonuses_role
          }))
        });

        // Fetch comprehensive performance data
        const performanceData = await fetchComprehensivePerformanceData(appliedDateFrom, appliedDateTo);
        
        console.log('🔍 Employee Performance - Performance data fetched:', {
          signedLeadsCount: performanceData.signedLeads.length,
          allLeadsCount: performanceData.allLeads.length,
          proformaInvoicesCount: performanceData.proformaInvoices.length,
          dateRange: performanceData.dateRange,
          sampleSignedLead: performanceData.signedLeads[0] ? {
            id: performanceData.signedLeads[0].id,
            name: performanceData.signedLeads[0].name,
            closer_id: performanceData.signedLeads[0].closer_id,
            case_handler_id: performanceData.signedLeads[0].case_handler_id,
            expert_id: performanceData.signedLeads[0].expert_id,
            total: performanceData.signedLeads[0].total
          } : null
        });
        
        // Calculate team averages
        const teamAverages = calculateTeamAverages(
          filteredActiveEmployees, 
          performanceData.signedLeads, 
          performanceData.proformaInvoices
        );

        // Process performance metrics for each employee (include ALL employees, even those without data)
        const employeesWithMetrics = filteredActiveEmployees.map((employee) => {
          const employeeIdStr = String(employee.id);
          const employeeIdNum = Number(employee.id);
          const role = employee.bonuses_role?.toLowerCase();
              
          // Initialize metrics - all employees start with 0 values
          let totalMeetings = 0;
          let scheduledMeetings = 0;
          let completedMeetings = 0;
          let contractsSigned = 0;
          let casesHandled = 0;
          let totalRevenue = 0;
          let lastActivity: string | null = null;
          
          // Count signed contracts across all roles
          const roleMetrics: { [key: string]: { signed: number; revenue: number } } = {};
          
          // Process ALL leads for total meetings count
          if (performanceData.allLeads && performanceData.allLeads.length > 0) {
            performanceData.allLeads.forEach(lead => {
              const leadDate = lead.cdate;
              
              // Check if employee participated in the meeting (only meeting roles)
              // Convert lead IDs to numbers for comparison
              const meetingManagerId = lead.meeting_manager_id ? Number(lead.meeting_manager_id) : null;
              const meetingLawyerId = lead.meeting_lawyer_id ? Number(lead.meeting_lawyer_id) : null;
              const meetingSchedulerId = lead.meeting_scheduler_id ? Number(lead.meeting_scheduler_id) : null;
              
              const isEmployeeInMeeting = 
                meetingManagerId === employeeIdNum ||
                meetingLawyerId === employeeIdNum;
              
              if (isEmployeeInMeeting) {
                totalMeetings++;
                
                if (!lastActivity || new Date(leadDate) > new Date(lastActivity)) {
                  lastActivity = leadDate;
                }
              }
              
              // Check if employee scheduled this meeting
              if (meetingSchedulerId === employeeIdNum) {
                scheduledMeetings++;
              }
              
              // Note: Cases are counted from signed leads only, not all leads
            });
          }
          
          // Process SIGNED leads for contracts signed count and revenue
          if (performanceData.signedLeads && performanceData.signedLeads.length > 0) {
            performanceData.signedLeads.forEach(lead => {
              const leadTotal = parseFloat(lead.total) || 0;
              const leadTotalInNIS = convertToNIS(leadTotal, lead.currency_id);
              
              // Convert all lead role IDs to numbers for proper comparison
              const caseHandlerId = lead.case_handler_id ? Number(lead.case_handler_id) : null;
              const closerId = lead.closer_id ? Number(lead.closer_id) : null;
              const expertId = lead.expert_id ? Number(lead.expert_id) : null;
              const meetingSchedulerId = lead.meeting_scheduler_id ? Number(lead.meeting_scheduler_id) : null;
              const meetingManagerId = lead.meeting_manager_id ? Number(lead.meeting_manager_id) : null;
              const meetingLawyerId = lead.meeting_lawyer_id ? Number(lead.meeting_lawyer_id) : null;
              
              // Debug currency conversion
              console.log(`🔍 EmployeePerformancePage Employee Metrics - Lead ${lead.id}:`, {
                originalAmount: leadTotal,
                currencyId: lead.currency_id,
                convertedAmount: leadTotalInNIS,
                conversionRate: leadTotal > 0 ? leadTotalInNIS / leadTotal : 1,
                employeeId: employeeIdNum,
                caseHandlerId,
                closerId,
                expertId,
                meetingSchedulerId,
                meetingManagerId,
                meetingLawyerId
              });
              
              // Check if employee appears in ANY role for this signed lead
              let isEmployeeInAnyRole = false;
              let actualRole = '';
              
              if (caseHandlerId === employeeIdNum) {
                isEmployeeInAnyRole = true;
                actualRole = 'h';
              } else if (closerId === employeeIdNum) {
                isEmployeeInAnyRole = true;
                actualRole = 'c';
              } else if (expertId === employeeIdNum) {
                isEmployeeInAnyRole = true;
                actualRole = 'e';
              } else if (meetingSchedulerId === employeeIdNum) {
                isEmployeeInAnyRole = true;
                actualRole = 's';
              } else if (meetingManagerId === employeeIdNum) {
                isEmployeeInAnyRole = true;
                actualRole = 'z';
              } else if (meetingLawyerId === employeeIdNum) {
                isEmployeeInAnyRole = true;
                actualRole = 'helper-closer';
              }
              
              if (isEmployeeInAnyRole) {
                // Initialize role metrics if not exists
                if (!roleMetrics[actualRole]) {
                  roleMetrics[actualRole] = { signed: 0, revenue: 0 };
                }
                roleMetrics[actualRole].signed++;
                roleMetrics[actualRole].revenue += leadTotalInNIS; // Use NIS amount
                
                contractsSigned++; // Count actual contracts signed
                totalRevenue += leadTotalInNIS; // Use NIS amount
                
                console.log(`✅ Employee ${employee.display_name} matched in role ${actualRole} for lead ${lead.id}`);
              }
              
              // Count cases handled (only from signed leads)
              if (caseHandlerId === employeeIdNum) {
                casesHandled++;
              }
            });
          }
          
          // Calculate performance percentage based on role average (average = 100%, capped at 100%)
          const teamAvg = teamAverages[role];
          const employeeSigned = roleMetrics[role]?.signed || 0;
          let performancePercentage = 0;
          
          if (teamAvg && teamAvg.avgSigned > 0) {
            // Calculate percentage where average performance = 100%
            // If employee has same as average, they get 100%
            // If employee has more than average, they get 100% (capped)
            // If employee has less than average, they get proportionally less
            performancePercentage = Math.min(100, Math.round((employeeSigned / teamAvg.avgSigned) * 100));
          } else if (teamAvg && teamAvg.avgSigned === 0 && employeeSigned > 0) {
            // If average is 0 but employee has performance, give them 100%
            performancePercentage = 100;
          }
          
          console.log(`📊 Performance calculation for ${employee.display_name} (${role}):`, {
            employeeSigned,
            teamAvgSigned: teamAvg?.avgSigned || 0,
            performancePercentage,
            roleMetrics: roleMetrics[role]
          });

          return {
            ...employee,
            performance_metrics: {
              total_meetings: totalMeetings,
              meetings_scheduled: scheduledMeetings,
              completed_meetings: completedMeetings,
              contracts_signed: contractsSigned,
              cases_handled: casesHandled,
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

        console.log('🔍 Employee Performance - Final metrics calculated:', {
          totalEmployees: employeesWithMetrics.length,
          employeesWithStats: employeesWithMetrics.filter(emp => 
            emp.performance_metrics && 
            (emp.performance_metrics.contracts_signed > 0 || emp.performance_metrics.total_revenue > 0)
          ).length,
          sampleEmployeeMetrics: employeesWithMetrics[0] ? {
            name: employeesWithMetrics[0].display_name,
            id: employeesWithMetrics[0].id,
            role: employeesWithMetrics[0].bonuses_role,
            contractsSigned: employeesWithMetrics[0].performance_metrics?.contracts_signed || 0,
            totalRevenue: employeesWithMetrics[0].performance_metrics?.total_revenue || 0,
            totalMeetings: employeesWithMetrics[0].performance_metrics?.total_meetings || 0
          } : null
        });

        // Calculate bonuses for all employees
        const employeesWithBonuses = await calculateEmployeeBonuses(employeesWithMetrics, dateFrom, dateTo);
        
        setEmployees(employeesWithBonuses);

        // Group employees by department
        const groupedByDepartment = employeesWithBonuses.reduce((groups, employee) => {
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
            let departmentCounts: { [key: string]: number } = {};
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
              if (leadData.misc_category && leadData.misc_category.misc_maincategory && leadData.misc_category.misc_maincategory.department_id) {
                departmentId = leadData.misc_category.misc_maincategory.department_id;
              }
                  
                  // Get department name from the mapping
                  const departmentName = departmentId ? departmentMap[departmentId] || 'Unknown' : 'General';
                  
                  console.log(`📊 Processing lead ${lead.id}: departmentId=${departmentId}, departmentName=${departmentName}, amount=${amount}, amountInNIS=${amountInNIS}`);
                  console.log(`📊 Available department mappings:`, departmentMap);
                  
                  if (!departmentRevenue[departmentName]) {
                    departmentRevenue[departmentName] = 0;
                    departmentCounts[departmentName] = 0;
                  }
                  departmentRevenue[departmentName] += amountInNIS; // Use NIS amount
                  departmentCounts[departmentName] += 1; // Count signed contracts
                  
                  console.log(`📊 Updated revenue for ${departmentName}: ${departmentRevenue[departmentName]}, count: ${departmentCounts[departmentName]}`);
                  
                  // Special debugging for Marketing department
                  if (departmentName.toLowerCase() === 'marketing') {
                    console.log(`🎯 MARKETING LEAD FOUND: Lead ${lead.id}, Amount: ${amount}, AmountInNIS: ${amountInNIS}, Total Marketing Revenue: ${departmentRevenue[departmentName]}, Count: ${departmentCounts[departmentName]}`);
                  }
                }
              });
            }
            
            console.log('📊 Department revenue calculated:', departmentRevenue);
            console.log('📊 Department counts calculated:', departmentCounts);
            
            // Special debugging for Marketing department
            if (departmentRevenue['Marketing']) {
              console.log(`🎯 FINAL MARKETING REVENUE: ₪${departmentRevenue['Marketing']}, COUNT: ${departmentCounts['Marketing'] || 0}`);
            } else {
              console.log('⚠️ NO MARKETING REVENUE FOUND in final calculation');
            }
            
            return { revenue: departmentRevenue, counts: departmentCounts };
            } catch (error) {
            console.error('Error calculating department revenue:', error);
            return {};
          }
        };

        // Calculate department revenue using Dashboard logic
        const departmentData = await calculateDepartmentRevenue(dateFrom, dateTo);
        const departmentRevenueData = departmentData.revenue || {};
        const departmentCountsData = departmentData.counts || {};
        
        console.log('📊 Department revenue data received:', departmentRevenueData);
        console.log('📊 Department counts data received:', departmentCountsData);
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
          
          // Try to find revenue and counts for this department with case-insensitive matching
          let totalRevenue = departmentRevenueData[deptName] || 0;
          let totalSignedContracts = departmentCountsData[deptName] || 0;
          
          // If no exact match, try case-insensitive matching
          if (totalRevenue === 0) {
            const revenueDeptNames = Object.keys(departmentRevenueData);
            const matchingDept = revenueDeptNames.find(revDept => 
              revDept.toLowerCase() === deptName.toLowerCase()
            );
            if (matchingDept) {
              totalRevenue = departmentRevenueData[matchingDept];
              totalSignedContracts = departmentCountsData[matchingDept] || 0;
              console.log(`📊 Found case-insensitive match: ${deptName} -> ${matchingDept} (${totalRevenue} revenue, ${totalSignedContracts} contracts)`);
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
              totalSignedContracts = departmentCountsData[matchingDept] || 0;
              console.log(`📊 Found partial match: ${deptName} -> ${matchingDept} (${totalRevenue} revenue, ${totalSignedContracts} contracts)`);
            }
          }
          
          const averagePerformance = deptEmployees.length > 0 
            ? deptEmployees.reduce((sum, emp) => sum + (emp.performance_metrics?.completed_meetings || 0), 0) / deptEmployees.length
            : 0;

          console.log(`📊 Department ${deptName}: ${deptEmployees.length} employees, ${totalMeetings} meetings, ${totalRevenue} revenue, ${totalSignedContracts} signed contracts`);

          return {
            name: deptName,
            employees: deptEmployees,
            total_meetings: totalMeetings,
            total_revenue: totalRevenue,
            total_signed_contracts: totalSignedContracts,
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

        // Calculate total signed contracts avoiding double counting for shared departments
        let totalSignedContractsFromDepartments = 0;
        const processedContractsBaseNames = new Set<string>();
        
        departmentGroups.forEach(dept => {
          const baseName = dept.name.split(' - ')[0];
          
          if (sharedDepartments.has(baseName)) {
            // Only count once for shared departments (use the first occurrence)
            if (!processedContractsBaseNames.has(baseName)) {
              totalSignedContractsFromDepartments += dept.total_signed_contracts;
              processedContractsBaseNames.add(baseName);
              console.log(`📊 Added contracts for shared department: ${dept.name} (${dept.total_signed_contracts} contracts)`);
            } else {
              console.log(`📊 Skipped duplicate contracts for shared department: ${dept.name} (${dept.total_signed_contracts} contracts)`);
            }
          } else {
            // Count normally for non-shared departments
            totalSignedContractsFromDepartments += dept.total_signed_contracts;
            console.log(`📊 Added contracts for unique department: ${dept.name} (${dept.total_signed_contracts} contracts)`);
          }
        });
        
        console.log('📊 Total signed contracts from all departments (avoiding double counting):', totalSignedContractsFromDepartments);

        // Store the corrected totals
        setCorrectedTotalRevenue(totalRevenueFromDepartments);
        setTotalSignedContracts(totalSignedContractsFromDepartments);
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
  }, [appliedDateFrom, appliedDateTo]); // Add appliedDateFrom and appliedDateTo as dependencies

  // Fetch graph data when graph parameters change
  useEffect(() => {
    if (showRevenueGraph) {
      fetchRevenueGraphData(graphYear, graphStartMonth, graphEndMonth);
    }
    if (showMeetingsGraph) {
      fetchMeetingsGraphData(graphYear, graphStartMonth, graphEndMonth);
    }
    if (showContractsGraph) {
      fetchContractsGraphData(graphYear, graphStartMonth, graphEndMonth);
    }
  }, [showRevenueGraph, showMeetingsGraph, showContractsGraph, graphYear, graphStartMonth, graphEndMonth]);

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

    // Note: Date filtering is handled in the data fetching, not in employee display
    // All employees should be shown even if they have no activity in the selected period

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

  const handleApplyDateFilter = async () => {
    if (!dateFrom || !dateTo) {
      alert('Please select both from and to dates');
      return;
    }
    
    setIsApplyingFilter(true);
    
    try {
      // Set the applied dates
      setAppliedDateFrom(dateFrom);
      setAppliedDateTo(dateTo);
      
      // The useEffect will handle the actual data fetching
    } catch (error) {
      console.error('Error applying date filter:', error);
    } finally {
      setIsApplyingFilter(false);
    }
  };

  const handleClearDateFilter = () => {
    setAppliedDateFrom('');
    setAppliedDateTo('');
    setDateFrom('');
    setDateTo('');
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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0 mb-3 sm:mb-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <ChartBarIcon className="w-6 h-6 sm:w-8 sm:h-8 text-primary" />
            <h1 className="text-xl sm:text-3xl font-bold">Employee Performance</h1>
          </div>
          <div className="flex items-center gap-2">
            {/* View Toggle */}
            <div className="flex items-center bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setDisplayViewMode('list')}
                className={`p-2 rounded-md transition-colors ${
                  displayViewMode === 'list' 
                    ? 'bg-white shadow-sm text-primary' 
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                title="List View"
              >
                <ListBulletIcon className="w-5 h-5" />
              </button>
              <button
                onClick={() => setDisplayViewMode('grid')}
                className={`p-2 rounded-md transition-colors ${
                  displayViewMode === 'grid' 
                    ? 'bg-white shadow-sm text-primary' 
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                title="Grid View"
              >
                <Squares2X2Icon className="w-5 h-5" />
              </button>
            </div>
            
            {/* Action Buttons */}
            <div className="flex gap-2">
              {/* Manage Salaries Button */}
              <button
                onClick={() => setIsSalaryModalOpen(true)}
                className="btn btn-primary gap-2"
              >
                <BanknotesIcon className="w-5 h-5" />
                Manage Salaries
              </button>
              
              {/* Manage Bonus Pool Button */}
              <button
                onClick={() => setIsBonusPoolModalOpen(true)}
                className="btn btn-primary gap-2"
              >
                <CurrencyDollarIcon className="w-5 h-5" />
                Bonus Pool
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 md:gap-4 mb-8">
        {/* Total Employees */}
        <div className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl bg-white text-gray-800 relative overflow-hidden p-3 md:p-6" style={{ boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.1)' }}>
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full shadow" style={{ backgroundColor: '#3e2bcd' }}>
              <UserGroupIcon className="w-5 h-5 md:w-7 md:h-7 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm sm:text-base md:text-lg lg:text-xl font-extrabold leading-tight" style={{ color: '#3e2bcd' }}>{employees.length}</div>
              <div className="text-gray-600 text-xs md:text-sm font-medium mt-1">Total Employees</div>
            </div>
          </div>
        </div>

        {/* Total Signed Contracts */}
        <div 
          className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl bg-white text-gray-800 relative overflow-hidden p-3 md:p-6"
          style={{ boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.1)' }}
          onClick={() => setShowContractsGraph(!showContractsGraph)}
        >
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full shadow" style={{ backgroundColor: '#3e2bcd' }}>
              <DocumentTextIcon className="w-5 h-5 md:w-7 md:h-7 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm sm:text-base md:text-lg lg:text-xl font-extrabold leading-tight" style={{ color: '#3e2bcd' }}>{totalSignedContracts}</div>
              <div className="text-gray-600 text-xs md:text-sm font-medium mt-1">Signed Contracts</div>
            </div>
          </div>
        </div>

        {/* Total Meetings */}
        <div 
          className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl bg-white text-gray-800 relative overflow-hidden p-3 md:p-6"
          style={{ boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.1)' }}
          onClick={() => setShowMeetingsGraph(!showMeetingsGraph)}
        >
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full shadow" style={{ backgroundColor: '#3e2bcd' }}>
              <CalendarDaysIcon className="w-5 h-5 md:w-7 md:h-7 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm sm:text-base md:text-lg lg:text-xl font-extrabold leading-tight" style={{ color: '#3e2bcd' }}>
                {employees.reduce((sum, emp) => sum + (emp.performance_metrics?.total_meetings || 0), 0)}
              </div>
              <div className="text-gray-600 text-xs md:text-sm font-medium mt-1">Managed Meetings</div>
            </div>
          </div>
        </div>


        {/* Total Revenue */}
        <div 
          className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl bg-white text-gray-800 relative overflow-hidden p-3 md:p-6"
          style={{ boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.1)' }}
          onClick={() => setShowRevenueGraph(!showRevenueGraph)}
        >
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full shadow" style={{ backgroundColor: '#3e2bcd' }}>
              <CurrencyDollarIcon className="w-5 h-5 md:w-7 md:h-7 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm sm:text-base md:text-lg lg:text-xl font-extrabold leading-tight" style={{ color: '#3e2bcd' }}>
                {formatCurrency(correctedTotalRevenue)}
              </div>
              <div className="text-gray-600 text-xs md:text-sm font-medium mt-1">Total Revenue</div>
            </div>
          </div>
        </div>

        {/* Total Bonus */}
        <div className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl bg-white text-gray-800 relative overflow-hidden p-3 md:p-6" style={{ boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.1)' }}>
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full shadow" style={{ backgroundColor: '#3e2bcd' }}>
              <BanknotesIcon className="w-5 h-5 md:w-7 md:h-7 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm sm:text-base md:text-lg lg:text-xl font-extrabold leading-tight" style={{ color: '#3e2bcd' }}>
                {formatCurrency(employees.reduce((total, emp) => total + (emp.performance_metrics?.calculated_bonus || emp.performance_metrics?.total_bonus || 0), 0))}
              </div>
              <div className="text-gray-600 text-xs md:text-sm font-medium mt-1">Total Employee Bonuses</div>
            </div>
          </div>
        </div>
      </div>


      {/* Revenue Graph */}
      {showRevenueGraph && (
        <div className="card bg-base-100 shadow-sm mb-4 sm:mb-6">
          <div className="card-body p-3 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Monthly Revenue Trend</h2>
              
              {/* Graph Controls */}
              <div className="flex flex-col sm:flex-row gap-3">
                {/* Year Selector */}
                <div className="form-control">
                  <label className="label">
                    <span className="label-text text-sm font-medium">Year</span>
                  </label>
                  <select 
                    className="select select-bordered select-sm w-full sm:w-24"
                    value={graphYear}
                    onChange={(e) => setGraphYear(parseInt(e.target.value))}
                  >
                    {Array.from({ length: 5 }, (_, i) => {
                      const year = new Date().getFullYear() - i;
                      return (
                        <option key={year} value={year}>{year}</option>
                      );
                    })}
                  </select>
                </div>

                {/* Start Month */}
                <div className="form-control">
                  <label className="label">
                    <span className="label-text text-sm font-medium">From Month</span>
                  </label>
                  <select 
                    className="select select-bordered select-sm w-full sm:w-32"
                    value={graphStartMonth}
                    onChange={(e) => setGraphStartMonth(parseInt(e.target.value))}
                  >
                    {Array.from({ length: 12 }, (_, i) => {
                      const month = i + 1;
                      const monthName = new Date(2024, i).toLocaleDateString('en-US', { month: 'short' });
                      return (
                        <option key={month} value={month}>{monthName}</option>
                      );
                    })}
                  </select>
                </div>

                {/* End Month */}
                <div className="form-control">
                  <label className="label">
                    <span className="label-text text-sm font-medium">To Month</span>
                  </label>
                  <select 
                    className="select select-bordered select-sm w-full sm:w-32"
                    value={graphEndMonth}
                    onChange={(e) => setGraphEndMonth(parseInt(e.target.value))}
                  >
                    {Array.from({ length: 12 }, (_, i) => {
                      const month = i + 1;
                      const monthName = new Date(2024, i).toLocaleDateString('en-US', { month: 'short' });
                      return (
                        <option key={month} value={month}>{monthName}</option>
                      );
                    })}
                  </select>
                </div>
              </div>
            </div>

            {/* Chart */}
            <div className="h-80 w-full">
              {revenueGraphLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="flex flex-col items-center gap-3">
                    <span className="loading loading-spinner loading-lg text-primary"></span>
                    <p className="text-sm text-gray-600">Loading revenue data...</p>
                  </div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={revenueGraphData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis 
                      dataKey="monthName" 
                      stroke="#6b7280"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis 
                      stroke="#6b7280"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `₪${(value / 1000).toFixed(0)}k`}
                    />
                    <Tooltip 
                      contentStyle={{
                        backgroundColor: '#1f2937',
                        border: 'none',
                        borderRadius: '8px',
                        color: '#f9fafb'
                      }}
                      formatter={(value: any, name: string) => [
                        name === 'revenue' ? `₪${value.toLocaleString()}` : value,
                        name === 'revenue' ? 'Revenue' : 'Contracts'
                      ]}
                      labelFormatter={(label) => `Month: ${label}`}
                      itemStyle={{ color: '#f9fafb' }}
                    />
                      <Line 
                        type="monotone" 
                        dataKey="revenue" 
                        stroke="#6c4edb" 
                        strokeWidth={3}
                        dot={{ fill: '#6c4edb', strokeWidth: 2, r: 4 }}
                        activeDot={{ r: 6, stroke: '#6c4edb', strokeWidth: 2 }}
                      />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Summary Stats */}
            {revenueGraphData.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6 pt-4 border-t border-gray-200">
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-800">
                    ₪{revenueGraphData.reduce((sum, item) => sum + item.revenue, 0).toLocaleString()}
                  </div>
                  <div className="text-sm text-gray-600">Total Revenue</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-800">
                    {revenueGraphData.reduce((sum, item) => sum + item.contracts, 0)}
                  </div>
                  <div className="text-sm text-gray-600">Total Contracts</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-800">
                    ₪{Math.round(revenueGraphData.reduce((sum, item) => sum + item.revenue, 0) / revenueGraphData.length).toLocaleString()}
                  </div>
                  <div className="text-sm text-gray-600">Avg Monthly Revenue</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Meetings Graph */}
      {showMeetingsGraph && (
        <div className="card bg-base-100 shadow-sm mb-4 sm:mb-6">
          <div className="card-body p-3 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Monthly Meetings Trend</h2>
              
              {/* Graph Controls */}
              <div className="flex flex-col sm:flex-row gap-3">
                {/* Year Selector */}
                <div className="form-control">
                  <label className="label">
                    <span className="label-text text-sm font-medium">Year</span>
                  </label>
                  <select 
                    className="select select-bordered select-sm w-full sm:w-24"
                    value={graphYear}
                    onChange={(e) => setGraphYear(parseInt(e.target.value))}
                  >
                    {Array.from({ length: 5 }, (_, i) => {
                      const year = new Date().getFullYear() - i;
                      return (
                        <option key={year} value={year}>{year}</option>
                      );
                    })}
                  </select>
                </div>

                {/* Start Month */}
                <div className="form-control">
                  <label className="label">
                    <span className="label-text text-sm font-medium">From Month</span>
                  </label>
                  <select 
                    className="select select-bordered select-sm w-full sm:w-32"
                    value={graphStartMonth}
                    onChange={(e) => setGraphStartMonth(parseInt(e.target.value))}
                  >
                    {Array.from({ length: 12 }, (_, i) => {
                      const month = i + 1;
                      const monthName = new Date(2024, i).toLocaleDateString('en-US', { month: 'short' });
                      return (
                        <option key={month} value={month}>{monthName}</option>
                      );
                    })}
                  </select>
                </div>

                {/* End Month */}
                <div className="form-control">
                  <label className="label">
                    <span className="label-text text-sm font-medium">To Month</span>
                  </label>
                  <select 
                    className="select select-bordered select-sm w-full sm:w-32"
                    value={graphEndMonth}
                    onChange={(e) => setGraphEndMonth(parseInt(e.target.value))}
                  >
                    {Array.from({ length: 12 }, (_, i) => {
                      const month = i + 1;
                      const monthName = new Date(2024, i).toLocaleDateString('en-US', { month: 'short' });
                      return (
                        <option key={month} value={month}>{monthName}</option>
                      );
                    })}
                  </select>
                </div>
              </div>
            </div>

            {/* Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Monthly Meetings Line Chart */}
              <div className="h-80 w-full">
                <h3 className="text-lg font-semibold text-gray-700 mb-4">Monthly Meetings Trend</h3>
                {meetingsGraphLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="flex flex-col items-center gap-3">
                      <span className="loading loading-spinner loading-lg text-primary"></span>
                      <p className="text-sm text-gray-600">Loading meetings data...</p>
                    </div>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={meetingsGraphData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis 
                        dataKey="monthName" 
                        stroke="#6b7280"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis 
                        stroke="#6b7280"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip 
                        contentStyle={{
                          backgroundColor: '#1f2937',
                          border: 'none',
                          borderRadius: '8px',
                          color: '#f9fafb'
                        }}
                        itemStyle={{ color: '#f9fafb' }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="total" 
                        stroke="#3b82f6" 
                        strokeWidth={3}
                        dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
                        activeDot={{ r: 6, stroke: '#3b82f6', strokeWidth: 2 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Meetings by Department Bar Chart */}
              <div className="h-80 w-full">
                <h3 className="text-lg font-semibold text-gray-700 mb-4">Meetings by Department</h3>
                {meetingsGraphLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="flex flex-col items-center gap-3">
                      <span className="loading loading-spinner loading-lg text-primary"></span>
                      <p className="text-sm text-gray-600">Loading department data...</p>
                    </div>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={meetingsByTypeData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis 
                        dataKey="department" 
                        stroke="#6b7280"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        angle={-45}
                        textAnchor="end"
                        height={80}
                      />
                      <YAxis 
                        stroke="#6b7280"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip 
                        contentStyle={{
                          backgroundColor: '#1f2937',
                          border: 'none',
                          borderRadius: '8px',
                          color: '#f9fafb'
                        }}
                        itemStyle={{ color: '#f9fafb' }}
                      />
                      <Bar dataKey="meetings" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Summary Stats */}
            {meetingsGraphData.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6 pt-4 border-t border-gray-200">
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-800">
                    {meetingsGraphData.reduce((sum, item) => sum + item.total, 0)}
                  </div>
                  <div className="text-sm text-gray-600">Total Meetings</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-800">
                    {Math.round(meetingsGraphData.reduce((sum, item) => sum + item.total, 0) / meetingsGraphData.length)}
                  </div>
                  <div className="text-sm text-gray-600">Avg Monthly</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Contracts Graph */}
      {showContractsGraph && (
        <div className="card bg-base-100 shadow-sm mb-4 sm:mb-6">
          <div className="card-body p-3 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Monthly Contracts Trend</h2>
              
              {/* Graph Controls */}
              <div className="flex flex-col sm:flex-row gap-3">
                {/* Year Selector */}
                <div className="form-control">
                  <label className="label">
                    <span className="label-text text-sm font-medium">Year</span>
                  </label>
                  <select 
                    className="select select-bordered select-sm w-full sm:w-24"
                    value={graphYear}
                    onChange={(e) => setGraphYear(parseInt(e.target.value))}
                  >
                    {Array.from({ length: 5 }, (_, i) => {
                      const year = new Date().getFullYear() - i;
                      return (
                        <option key={year} value={year}>{year}</option>
                      );
                    })}
                  </select>
                </div>

                {/* Start Month */}
                <div className="form-control">
                  <label className="label">
                    <span className="label-text text-sm font-medium">From Month</span>
                  </label>
                  <select 
                    className="select select-bordered select-sm w-full sm:w-32"
                    value={graphStartMonth}
                    onChange={(e) => setGraphStartMonth(parseInt(e.target.value))}
                  >
                    {Array.from({ length: 12 }, (_, i) => {
                      const month = i + 1;
                      const monthName = new Date(2024, i).toLocaleDateString('en-US', { month: 'short' });
                      return (
                        <option key={month} value={month}>{monthName}</option>
                      );
                    })}
                  </select>
                </div>

                {/* End Month */}
                <div className="form-control">
                  <label className="label">
                    <span className="label-text text-sm font-medium">To Month</span>
                  </label>
                  <select 
                    className="select select-bordered select-sm w-full sm:w-32"
                    value={graphEndMonth}
                    onChange={(e) => setGraphEndMonth(parseInt(e.target.value))}
                  >
                    {Array.from({ length: 12 }, (_, i) => {
                      const month = i + 1;
                      const monthName = new Date(2024, i).toLocaleDateString('en-US', { month: 'short' });
                      return (
                        <option key={month} value={month}>{monthName}</option>
                      );
                    })}
                  </select>
                </div>
              </div>
            </div>

            {/* Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Monthly Contracts Line Chart */}
              <div className="h-80 w-full">
                <h3 className="text-lg font-semibold text-gray-700 mb-4">Monthly Contracts Trend</h3>
                {contractsGraphLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="flex flex-col items-center gap-3">
                      <span className="loading loading-spinner loading-lg text-primary"></span>
                      <p className="text-sm text-gray-600">Loading contracts data...</p>
                    </div>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={contractsGraphData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis 
                        dataKey="monthName" 
                        stroke="#6b7280"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis 
                        stroke="#6b7280"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip 
                        contentStyle={{
                          backgroundColor: '#1f2937',
                          border: 'none',
                          borderRadius: '8px',
                          color: '#f9fafb'
                        }}
                        itemStyle={{ color: '#f9fafb' }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="contracts" 
                        stroke="#7c3aed" 
                        strokeWidth={3}
                        dot={{ fill: '#7c3aed', strokeWidth: 2, r: 4 }}
                        activeDot={{ r: 6, stroke: '#7c3aed', strokeWidth: 2 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Contracts by Department Bar Chart */}
              <div className="h-80 w-full">
                <h3 className="text-lg font-semibold text-gray-700 mb-4">Contracts by Department</h3>
                {contractsGraphLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="flex flex-col items-center gap-3">
                      <span className="loading loading-spinner loading-lg text-primary"></span>
                      <p className="text-sm text-gray-600">Loading department data...</p>
                    </div>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={contractsByDepartmentData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis 
                        dataKey="department" 
                        stroke="#6b7280"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        angle={-45}
                        textAnchor="end"
                        height={80}
                      />
                      <YAxis 
                        stroke="#6b7280"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip 
                        contentStyle={{
                          backgroundColor: '#1f2937',
                          border: 'none',
                          borderRadius: '8px',
                          color: '#f9fafb'
                        }}
                        itemStyle={{ color: '#f9fafb' }}
                      />
                      <Bar dataKey="contracts" fill="#7c3aed" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Summary Stats */}
            {contractsGraphData.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6 pt-4 border-t border-gray-200">
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-800">
                    {contractsGraphData.reduce((sum, item) => sum + item.contracts, 0)}
                  </div>
                  <div className="text-sm text-gray-600">Total Contracts</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-800">
                    {contractsByDepartmentData.length}
                  </div>
                  <div className="text-sm text-gray-600">Departments</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-800">
                    {Math.round(contractsGraphData.reduce((sum, item) => sum + item.contracts, 0) / contractsGraphData.length)}
                  </div>
                  <div className="text-sm text-gray-600">Avg Monthly</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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
                      {subdept.name}
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
              <input
                type="date"
                className="input input-bordered input-sm sm:input-md"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
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

            {/* Date Filter Actions */}
            <div className="form-control">
              <div className="label">
                <span className="label-text font-semibold text-xs sm:text-sm">Date Filter Actions</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleApplyDateFilter}
                  className="btn btn-primary btn-xs sm:btn-sm flex-1"
                  disabled={isApplyingFilter}
                >
                  {isApplyingFilter ? (
                    <>
                      <span className="loading loading-spinner loading-xs"></span>
                      Applying...
                    </>
                  ) : (
                    'Apply Filter'
                  )}
                </button>
                <button
                  onClick={handleClearDateFilter}
                  className="btn btn-outline btn-xs sm:btn-sm flex-1"
                >
                  Clear Filter
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="form-control">
              <div className="label">
                <span className="label-text font-semibold text-xs sm:text-sm">Actions</span>
              </div>
              <div className="flex gap-2">
                <button
                  className={`btn btn-xs sm:btn-sm flex-1 ${viewMode === 'department' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setViewMode('department')}
                >
                  Departments
                </button>
                <button
                  className={`btn btn-xs sm:btn-sm flex-1 ${viewMode === 'subdepartment' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setViewMode('subdepartment')}
                >
                  Roles
                </button>
                <button
                  className="btn btn-outline btn-xs sm:btn-sm flex-1"
                  onClick={() => {
                    setSelectedDepartment('all');
                    setSelectedSubdepartment('all');
                    setSelectedRole('all');
                    setSearchQuery('');
                    setDateFrom('');
                    setDateTo('');
                    setAppliedDateFrom('');
                    setAppliedDateTo('');
                  }}
                  title="Clear all filters"
                >
                  Clear
                </button>
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
          
          // Note: Date filtering is handled in the data fetching, not in employee display
          // All employees should be shown even if they have no activity in the selected period
          
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
                    <span className="badge badge-primary text-xs">{filteredEmployees.length} employees</span>
                  </div>
                </div>
                <div className="text-xs sm:text-sm text-gray-600">
                  <span className="hidden sm:inline">{groupData.total_meetings} meetings • {formatCurrency(groupData.total_revenue)} revenue • {groupData.total_signed_contracts} signed contracts</span>
                  <span className="sm:hidden">{groupData.total_meetings} meetings • {groupData.total_signed_contracts} contracts</span>
                </div>
              </div>
            </div>
            <div className="card-body p-0">
              {displayViewMode === 'list' ? (
                /* List View */
                <div className="overflow-x-auto">
                  <table className="table w-full text-sm sm:text-base">
                  <thead>
                    <tr>
                      <th className="w-1/3 text-sm sm:text-base">Employee</th>
                      <th className="w-1/12 text-sm sm:text-base">
                        <span className="hidden sm:inline">Managed Meetings</span>
                        <span className="sm:hidden">Managed</span>
                      </th>
                      <th className="w-1/12 text-sm sm:text-base">
                        <span className="hidden sm:inline">Scheduled Meetings</span>
                        <span className="sm:hidden">Scheduled</span>
                      </th>
                      <th className="w-1/12 text-sm sm:text-base">
                        <span className="hidden sm:inline">Contracts Signed</span>
                        <span className="sm:hidden">Contracts</span>
                      </th>
                      <th className="w-1/12 text-sm sm:text-base">
                        <span className="hidden sm:inline">Cases</span>
                        <span className="sm:hidden">Cases</span>
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
                            <div className="rounded-full w-12 sm:w-16">
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
                                      <div class="bg-primary text-primary-content rounded-full w-12 sm:w-16 h-12 sm:h-16 flex items-center justify-center">
                                        <span class="text-sm sm:text-lg font-bold">${getInitials(employee.display_name)}</span>
                                      </div>
                                    `;
                                  }
                                }}
                              />
                            </div>
                          ) : (
                            <div className="placeholder">
                              <div className="bg-primary text-primary-content rounded-full w-12 sm:w-16 h-12 sm:h-16 flex items-center justify-center">
                                <span className="text-sm sm:text-lg font-bold">
                                  {getInitials(employee.display_name)}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-sm sm:text-base truncate">{employee.display_name}</div>
                          <span className="text-sm max-w-full truncate inline-block px-2 sm:px-3 py-1 rounded-full text-white font-medium bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 shadow-sm flex-shrink-0 mt-1">
                            {getRoleDisplayName(employee.bonuses_role)}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="w-1/12 font-semibold text-sm sm:text-base">
                      {employee.performance_metrics?.total_meetings || 0}
                    </td>
                    <td className="w-1/12 font-semibold text-sm sm:text-base">
                      {employee.performance_metrics?.meetings_scheduled || 0}
                    </td>
                    <td className="w-1/12 font-semibold text-sm sm:text-base">
                      {employee.performance_metrics?.contracts_signed || 0}
                    </td>
                    <td className="w-1/12 font-semibold text-sm sm:text-base">
                      {employee.performance_metrics?.cases_handled || 0}
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
                      <td className="w-1/12 font-semibold text-black text-sm sm:text-base">
                        <span className="hidden sm:inline">{formatCurrency(employee.performance_metrics?.calculated_bonus || employee.performance_metrics?.total_bonus || 0)}</span>
                        <span className="sm:hidden">₪{(employee.performance_metrics?.calculated_bonus || employee.performance_metrics?.total_bonus || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
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
              ) : (
                /* Grid View */
                <div className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredEmployees.map((employee) => (
                      <EmployeePerformanceBox
                        key={employee.id}
                        employee={employee}
                        onEmployeeClick={handleEmployeeClick}
                      />
                    ))}
                  </div>
                </div>
              )}
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

      {/* Salary Modal */}
      <SalaryModal 
        isOpen={isSalaryModalOpen}
        onClose={() => setIsSalaryModalOpen(false)}
        employees={employees}
      />

      {/* Bonus Pool Modal */}
      <BonusPoolModal 
        isOpen={isBonusPoolModalOpen}
        onClose={() => setIsBonusPoolModalOpen(false)}
      />
    </div>
  );
};

export default EmployeePerformancePage;
