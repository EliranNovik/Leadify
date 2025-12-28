import React, { useState } from 'react';
import { XMarkIcon, UserIcon, ChartBarIcon, CurrencyDollarIcon, ClockIcon, CheckCircleIcon, XCircleIcon, CalendarDaysIcon, TrophyIcon, PhoneIcon, DevicePhoneMobileIcon, EyeIcon, PencilIcon, DocumentTextIcon, CalendarIcon, BanknotesIcon } from '@heroicons/react/24/outline';
import { convertToNIS, getCurrencySymbol as getCurrencySymbolFromLib } from '../lib/currencyConversion';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar, PieChart, Pie, Cell, Legend } from 'recharts';
import { supabase } from '../lib/supabase';
import { calculateEmployeeBonus, getRoleDisplayName as getBonusRoleDisplayName, fetchMonthlyBonusPool, getRoleConfig, getBonusConfig } from '../lib/bonusCalculation';
import { usePersistedFilters } from '../hooks/usePersistedState';

// Extend window object to include monthly bonus pools cache
declare global {
  interface Window {
    monthlyBonusPoolsCache?: { [key: string]: any };
  }
}

interface Employee {
  id: string;
  display_name: string;
  email: string;
  bonuses_role: string;
  department: string;
  is_active: boolean;
  photo_url?: string;
  photo?: string; // Background photo from tenants_employee
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

interface EmployeeModalProps {
  employee: Employee | null;
  allEmployees: Employee[];
  isOpen: boolean;
  onClose: () => void;
}

// Helper function to generate initials from display name
const getInitials = (displayName: string): string => {
  return displayName
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
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
    'ma': 'Marketing',
    'p': 'Partner',
    'helper-closer': 'Helper Closer',
    'pm': 'Project Manager',
    'se': 'Secretary',
    'dv': 'Developer',
    'dm': 'Department Manager',
    'b': 'Book Keeper',
    'f': 'Finance'
  };
  
  return roleMap[roleCode] || roleCode || 'No role';
};

// Closer Performance Chart Component
function CloserPerformanceChart({ closerData, dateRange }: { closerData: any, dateRange: any }) {
  // Use real daily contract data from closerData
  let dailyData = closerData?.dailyContracts || [];
  
  // If no data available, generate sample data for demonstration
  if (dailyData.length === 0 && dateRange?.from && dateRange?.to) {
    console.log('📊 No daily contract data found, generating sample data for date range:', dateRange);
    const startDate = new Date(dateRange.from);
    const endDate = new Date(dateRange.to);
    dailyData = [];
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
      const dayNumber = d.getDate();
      // Generate some sample data for demonstration
      const contracts = Math.floor(Math.random() * 4) + 1; // Random between 1-4
      
      dailyData.push({
        date: dateStr,
        dayName,
        dayNumber,
        contracts
      });
    }
  } else if (dailyData.length > 0) {
    console.log('📊 Using real daily contract data:', dailyData.length, 'data points');
  }
  
  const maxContracts = Math.max(...dailyData.map((d: any) => d.contracts), 1);
  
  // Get team daily averages from closerData
  const teamDailyAverages = closerData?.teamDailyAverages || [];
  const maxTeamAverage = teamDailyAverages.length > 0 ? Math.max(...teamDailyAverages.map((d: any) => d.teamAverage), 1) : 1;
  
  // Merge team averages with daily data for the chart
  const chartData = dailyData.map((dailyPoint: any) => {
    const teamPoint = teamDailyAverages.find((team: any) => team.date === dailyPoint.date);
    return {
      ...dailyPoint,
      teamAverage: teamPoint ? teamPoint.teamAverage : 0
    };
  });
  
  console.log('📊 CloserPerformanceChart - closerData:', closerData);
  console.log('📊 CloserPerformanceChart - dailyData length:', dailyData.length);
  console.log('📊 CloserPerformanceChart - teamDailyAverages length:', teamDailyAverages.length);
  console.log('📊 CloserPerformanceChart - first few dailyData:', dailyData.slice(0, 3));
  console.log('📊 CloserPerformanceChart - first few teamAverages:', teamDailyAverages.slice(0, 3));
  console.log('📊 CloserPerformanceChart - maxContracts:', maxContracts);
  console.log('📊 CloserPerformanceChart - maxTeamAverage:', maxTeamAverage);

  // If still no data, show a message
  if (dailyData.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center">
        <div className="text-center text-gray-500">
          <div className="text-sm">No contract data available for the selected period</div>
        </div>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis 
          dataKey="date" 
          stroke="#6b7280"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { day: 'numeric' })}
        />
        <YAxis 
          stroke="#6b7280"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          domain={[0, 'dataMax']}
        />
        <Tooltip 
          contentStyle={{
            backgroundColor: '#1f2937',
            border: 'none',
            borderRadius: '8px',
            color: '#f9fafb'
          }}
          itemStyle={{ color: '#f9fafb' }}
          formatter={(value, name) => {
            if (name === 'contracts') {
              return [value, 'Your Contracts'];
            } else if (name === 'teamAverage') {
              return [value, 'Team Average'];
            }
            return [value, name];
          }}
        />
        <Line 
          type="monotone" 
          dataKey="contracts" 
          stroke="#6c4edb"
          strokeWidth={3}
          dot={{ fill: '#6c4edb', strokeWidth: 2, r: 4 }}
          activeDot={{ r: 6, stroke: '#6c4edb', strokeWidth: 2 }}
        />
        {teamDailyAverages.length > 0 && (
          <Line 
            type="monotone" 
            dataKey="teamAverage" 
            stroke="#9ca3af"
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={{ fill: '#9ca3af', strokeWidth: 2, r: 3 }}
            activeDot={{ r: 5, stroke: '#9ca3af', strokeWidth: 2 }}
          />
        )}
        <Legend 
          wrapperStyle={{ paddingTop: '20px' }}
          formatter={(value) => {
            if (value === 'contracts') return 'Your Contracts';
            if (value === 'teamAverage') return 'Team Average';
            return value;
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// Expert Performance Chart Component
function ExpertPerformanceChart({ expertData, dateRange }: { expertData: any, dateRange: any }) {
  // Use real daily examination data from expertData
  let dailyData = expertData?.dailyExaminations || [];
  
  // If no data available, generate sample data for demonstration
  if (dailyData.length === 0 && dateRange?.from && dateRange?.to) {
    console.log('📊 No daily data found, generating sample data for date range:', dateRange);
    const startDate = new Date(dateRange.from);
    const endDate = new Date(dateRange.to);
    dailyData = [];
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
      const dayNumber = d.getDate();
      // Generate some sample data for demonstration
      const examinations = Math.floor(Math.random() * 6) + 1; // Random between 1-6
      
      dailyData.push({
        date: dateStr,
        dayName,
        dayNumber,
        examinations
      });
    }
  } else if (dailyData.length > 0) {
    console.log('📊 Using real daily data:', dailyData.length, 'data points');
  }
  
  const maxExaminations = Math.max(...dailyData.map((d: any) => d.examinations), 1);
  
  // Get team daily averages from expertData
  const teamDailyAverages = expertData?.teamDailyAverages || [];
  const maxTeamAverage = teamDailyAverages.length > 0 ? Math.max(...teamDailyAverages.map((d: any) => d.teamAverage), 1) : 1;
  
  // Merge team averages with daily data for the chart
  const chartData = dailyData.map((dailyPoint: any) => {
    const teamPoint = teamDailyAverages.find((team: any) => team.date === dailyPoint.date);
    return {
      ...dailyPoint,
      teamAverage: teamPoint ? teamPoint.teamAverage : 0
    };
  });
  
  console.log('ExpertPerformanceChart - expertData:', expertData);
  console.log('ExpertPerformanceChart - dailyData length:', dailyData.length);
  console.log('ExpertPerformanceChart - teamDailyAverages length:', teamDailyAverages.length);
  console.log('ExpertPerformanceChart - first few dailyData:', dailyData.slice(0, 3));
  console.log('ExpertPerformanceChart - first few teamAverages:', teamDailyAverages.slice(0, 3));
  console.log('ExpertPerformanceChart - maxExaminations:', maxExaminations);
  console.log('ExpertPerformanceChart - maxTeamAverage:', maxTeamAverage);

  // If still no data, show a message
  if (dailyData.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center">
        <div className="text-center text-gray-500">
          <div className="text-4xl mb-2"></div>
          <div className="text-sm">No examination data available for the selected period</div>
        </div>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis 
          dataKey="date" 
          stroke="#6b7280"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { day: 'numeric' })}
        />
        <YAxis 
          stroke="#6b7280"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          domain={[0, 'dataMax']}
        />
        <Tooltip 
          contentStyle={{
            backgroundColor: '#1f2937',
            border: 'none',
            borderRadius: '8px',
            color: '#f9fafb'
          }}
          itemStyle={{ color: '#f9fafb' }}
          formatter={(value, name) => {
            if (name === 'examinations') {
              return [value, 'Your Examinations'];
            } else if (name === 'teamAverage') {
              return [value, 'Team Average'];
            }
            return [value, name];
          }}
        />
        <Line 
          type="monotone" 
          dataKey="examinations" 
          stroke="#6c4edb"
          strokeWidth={3}
          dot={{ fill: '#6c4edb', strokeWidth: 2, r: 4 }}
          activeDot={{ r: 6, stroke: '#6c4edb', strokeWidth: 2 }}
        />
        {teamDailyAverages.length > 0 && (
          <Line 
            type="monotone" 
            dataKey="teamAverage" 
            stroke="#9ca3af"
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={{ fill: '#9ca3af', strokeWidth: 2, r: 3 }}
            activeDot={{ r: 5, stroke: '#9ca3af', strokeWidth: 2 }}
          />
        )}
        <Legend 
          wrapperStyle={{ paddingTop: '20px' }}
          formatter={(value) => {
            if (value === 'examinations') return 'Your Examinations';
            if (value === 'teamAverage') return 'Team Average';
            return value;
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// Format currency
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

// Format date
const formatDate = (dateString: string) => {
  if (!dateString || dateString === 'No activity') return 'No activity';
  try {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch {
    return 'Invalid date';
  }
};

// Note: getCurrencySymbol is now imported from currencyConversion.ts

// Helper function to get role-based table headers
const getRoleTableHeaders = (role: string): string[] => {
  const roleMap: { [key: string]: string[] } = {
    'h': ['Role', 'Cases', 'Applicants', 'Total'],
    'c': ['Role', 'Signed Contracts', 'Signed Total', 'Total Due'],
    'e': ['Role', 'Expert Examinations', 'Total'],
    's': ['Role', 'Meetings Total', 'Signed Total', 'Due Total'],
    'z': ['Role', 'Total Successful Meetings', 'Signed Contracts', 'Signed Total', 'Due Total'],
    'Z': ['Role', 'Total Successful Meetings', 'Signed Contracts', 'Signed Total', 'Due Total'],
    'helper-closer': ['Role', 'Signed Contracts', 'Signed Total', 'Total Due']
  };
  
  return roleMap[role] || ['Role', 'Total Meetings', 'Completed', 'Revenue'];
};


// Helper function to get role-based table data
const getRoleTableData = (employee: Employee, performanceData?: any): (string | number)[] => {
  const role = employee.bonuses_role?.toLowerCase();
  const metrics = employee.performance_metrics || {
    total_meetings: 0,
    completed_meetings: 0,
    total_revenue: 0,
    average_rating: 0,
    last_activity: 'No activity'
  };
  
  switch (role) {
    case 'h': // Handler
      // Use performance data if available, otherwise fall back to employee metrics
      const handlerMetrics = performanceData?.roleMetrics?.handler;
      return [
        getRoleDisplayName(employee.bonuses_role),
        handlerMetrics?.cases || (metrics as any).cases_handled || 0,
        handlerMetrics?.applicants || (metrics as any).applicants_processed || 0,
        `₪${(handlerMetrics?.total || (metrics as any).total_agreement_amount || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
      ];
    
    case 'c': // Closer
      const closerMetrics = performanceData?.roleMetrics?.closer;
      return [
        getRoleDisplayName(employee.bonuses_role),
        closerMetrics?.signed || (metrics as any).signed_agreements || 0,
        `₪${(closerMetrics?.total || (metrics as any).total_agreement_amount || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
        `₪${(closerMetrics?.invoiced || (metrics as any).total_due || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
      ];
    
    case 'e': // Expert
      const expertMetrics = performanceData?.roleMetrics?.expert;
      return [
        getRoleDisplayName(employee.bonuses_role),
        expertMetrics?.signed || (metrics as any).expert_examinations || 0,
        `₪${(expertMetrics?.total || (metrics as any).expert_total || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
      ];
    
    case 's': // Scheduler
      const schedulerMetrics = performanceData?.roleMetrics?.scheduler;
      return [
        getRoleDisplayName(employee.bonuses_role),
        schedulerMetrics?.signed || (metrics as any).meetings_scheduled || 0,
        schedulerMetrics?.signed || (metrics as any).signed_meetings || 0,
        `₪${(schedulerMetrics?.invoiced || (metrics as any).due_total || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
      ];
    
    case 'z': // Manager
    case 'Z': // Manager
      return [
        getRoleDisplayName(employee.bonuses_role),
        (metrics as any).successful_meetings || 0,
        (metrics as any).contracts_managed || 0,
        formatCurrency((metrics as any).signed_total || 0),
        formatCurrency((metrics as any).due_total || 0)
      ];
    
    default:
      return [
        getRoleDisplayName(employee.bonuses_role),
        metrics.total_meetings || 0,
        metrics.completed_meetings || 0,
        formatCurrency(metrics.total_revenue || 0)
      ];
  }
};

// Salary History Component
interface SalaryHistoryProps {
  employeeId: string;
}

// Bonus Breakdown Component
interface BonusBreakdownProps {
  employee: Employee;
  dateFrom?: string;
  dateTo?: string;
}

const BonusBreakdown: React.FC<BonusBreakdownProps> = ({ employee, dateFrom, dateTo }) => {
  const [bonusData, setBonusData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    const fetchBonusData = async () => {
      if (!dateFrom || !dateTo) return;
      
      setLoading(true);
      try {
        const monthlyPoolAmount = 100000; // This should be configurable
        const bonus = await calculateEmployeeBonus(
          employee.id,
          employee.bonuses_role,
          dateFrom,
          dateTo,
          monthlyPoolAmount
        );
        setBonusData(bonus);
      } catch (error) {
        console.error('Error fetching bonus data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchBonusData();
  }, [employee.id, employee.bonuses_role, dateFrom, dateTo]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <BanknotesIcon className="w-5 h-5 text-warning" />
          <h3 className="text-lg font-semibold">Bonus Breakdown</h3>
        </div>
        <div className="text-center py-4">
          <span className="loading loading-spinner loading-md"></span>
          <p className="mt-2 text-gray-600">Calculating bonus...</p>
        </div>
      </div>
    );
  }

  if (!bonusData || bonusData.roleBonuses.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <BanknotesIcon className="w-5 h-5 text-warning" />
          <h3 className="text-lg font-semibold">Bonus Breakdown</h3>
        </div>
        <div className="text-center py-4 text-gray-500">
          No bonus data available for the selected period
        </div>
      </div>
    );
  }

  const formatCurrency = (amount: number) => {
    return `₪${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BanknotesIcon className="w-5 h-5 text-warning" />
        <h3 className="text-lg font-semibold">Bonus Breakdown</h3>
      </div>
      
      {/* Total Bonus */}
      <div className="card bg-warning/10 border border-warning/20">
        <div className="card-body p-4">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-warning">Total Calculated Bonus</span>
            <span className="text-2xl font-bold text-warning">
              {formatCurrency(bonusData.totalBonus)}
            </span>
          </div>
        </div>
      </div>

      {/* Role Bonuses */}
      <div className="space-y-3">
        {bonusData.roleBonuses.map((roleBonus: any, index: number) => (
          <div key={index} className="card bg-base-100 border border-gray-200">
            <div className="card-body p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="badge badge-primary">
                    {getBonusRoleDisplayName(roleBonus.role)}
                  </span>
                  <span className="text-sm text-gray-600">
                    {roleBonus.percentage}%
                  </span>
                </div>
                <span className="font-semibold text-warning">
                  {formatCurrency(roleBonus.bonusAmount)}
                </span>
              </div>
              
              <div className="text-sm text-gray-600 space-y-1">
                <div className="flex justify-between">
                  <span>Base Amount:</span>
                  <span>{formatCurrency(roleBonus.baseAmount)}</span>
                </div>
                {roleBonus.leadCount > 0 && (
                  <div className="flex justify-between">
                    <span>Leads:</span>
                    <span>{roleBonus.leadCount}</span>
                  </div>
                )}
                {roleBonus.isPoolBased && (
                  <div className="flex justify-between">
                    <span>Type:</span>
                    <span className="text-blue-600">Monthly Pool</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const SalaryHistory: React.FC<SalaryHistoryProps> = ({ employeeId }) => {
  const [salaryRecords, setSalaryRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch salary records for the employee
  const fetchSalaryRecords = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('employee_salaries')
        .select('*')
        .eq('employee_id', parseInt(employeeId))
        .order('year', { ascending: false })
        .order('month', { ascending: false });

      if (error) {
        console.error('Error fetching salary records:', error);
        setError('Failed to load salary records');
        return;
      }

      setSalaryRecords(data || []);
    } catch (err) {
      console.error('Error fetching salary records:', err);
      setError('Failed to load salary records');
    } finally {
      setLoading(false);
    }
  };

  // Fetch salary records on component mount
  React.useEffect(() => {
    fetchSalaryRecords();
  }, [employeeId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="loading loading-spinner loading-lg"></span>
        <span className="ml-3 text-gray-600">Loading salary history...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-error">
        <XCircleIcon className="w-5 h-5" />
        <span>{error}</span>
      </div>
    );
  }

  if (salaryRecords.length === 0) {
    return (
      <div className="text-center py-8">
        <CurrencyDollarIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h4 className="text-lg font-semibold text-gray-600 mb-2">No Salary Records</h4>
        <p className="text-sm text-gray-500">No salary records found for this employee.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="stat bg-base-200 rounded-lg">
          <div className="stat-figure text-primary">
            <CurrencyDollarIcon className="w-8 h-8" />
          </div>
          <div className="stat-title">Total Records</div>
          <div className="stat-value text-primary">{salaryRecords.length}</div>
        </div>
        
        <div className="stat bg-base-200 rounded-lg">
          <div className="stat-figure text-secondary">
            <CalendarIcon className="w-8 h-8" />
          </div>
          <div className="stat-title">Latest Salary</div>
          <div className="stat-value text-secondary">
            ₪{salaryRecords[0]?.salary_amount?.toLocaleString() || '0'}
          </div>
        </div>
        
        <div className="stat bg-base-200 rounded-lg">
          <div className="stat-figure text-accent">
            <ChartBarIcon className="w-8 h-8" />
          </div>
          <div className="stat-title">Average Salary</div>
          <div className="stat-value text-accent">
            ₪{Math.round(salaryRecords.reduce((sum, record) => sum + record.salary_amount, 0) / salaryRecords.length).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Salary Records Table */}
      <div className="overflow-x-auto">
        <table className="table w-full">
          <thead>
            <tr>
              <th>Period</th>
              <th>Salary Amount</th>
              <th>Created</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {salaryRecords.map((record) => {
              const monthName = new Date(record.year, record.month - 1).toLocaleDateString('en-US', { month: 'long' });
              return (
                <tr key={record.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="w-4 h-4 text-gray-500" />
                      <span className="font-medium">{monthName} {record.year}</span>
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <CurrencyDollarIcon className="w-4 h-4 text-green-500" />
                      <span className="font-semibold text-green-600">
                        ₪{record.salary_amount.toLocaleString()}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className="text-sm text-gray-600">
                      {new Date(record.created_at).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </span>
                  </td>
                  <td>
                    <span className="text-sm text-gray-600">
                      {new Date(record.updated_at).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const EmployeeModal: React.FC<EmployeeModalProps> = ({ employee, allEmployees, isOpen, onClose }) => {
  const [showRoleDetails, setShowRoleDetails] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [roleLeads, setRoleLeads] = useState<any[]>([]);
  const [loadingRoleLeads, setLoadingRoleLeads] = useState(false);
  const [fromDate, setFromDate] = usePersistedFilters('employeeModal_fromDate', '', {
    storage: 'sessionStorage',
  });
  const [toDate, setToDate] = usePersistedFilters('employeeModal_toDate', '', {
    storage: 'sessionStorage',
  });
  const [appliedFromDate, setAppliedFromDate] = usePersistedFilters('employeeModal_appliedFromDate', '', {
    storage: 'sessionStorage',
  });
  const [appliedToDate, setAppliedToDate] = usePersistedFilters('employeeModal_appliedToDate', '', {
    storage: 'sessionStorage',
  });
  const [isApplyingFilter, setIsApplyingFilter] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'availability' | 'tasks' | 'clients' | 'feedback' | 'salary' | 'bonus'>('overview');

  // Populate monthly bonus pools cache when modal opens
  React.useEffect(() => {
    if (isOpen && employee) {
      populateMonthlyBonusPoolsCache();
    }
  }, [isOpen, employee]);

  // Function to populate the monthly bonus pools cache
  const populateMonthlyBonusPoolsCache = async () => {
    try {
      console.log('🔄 Populating monthly bonus pools cache...');
      
      // Initialize cache if it doesn't exist
      if (!window.monthlyBonusPoolsCache) {
        window.monthlyBonusPoolsCache = {};
      }
      
      // Get the current year and fetch pools for the last 12 months
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;
      
      // Fetch pools for current year and previous year
      for (let year = currentYear - 1; year <= currentYear; year++) {
        for (let month = 1; month <= 12; month++) {
          const poolKey = `${year}-${month}`;
          
          // Skip if already cached
          if (window.monthlyBonusPoolsCache[poolKey]) {
            continue;
          }
          
          try {
            const pool = await fetchMonthlyBonusPool(year, month);
            if (pool) {
              window.monthlyBonusPoolsCache[poolKey] = pool;
              console.log(`✅ Cached pool for ${poolKey}: ${pool.pool_percentage}%`);
            }
          } catch (error) {
            console.log(`📊 No pool found for ${poolKey}`);
          }
        }
      }
      
      console.log('🎯 Monthly bonus pools cache populated:', window.monthlyBonusPoolsCache);
    } catch (error) {
      console.error('❌ Error populating monthly bonus pools cache:', error);
    }
  };
  const [unavailableTimes, setUnavailableTimes] = useState<any[]>([]);
  const [unavailableRanges, setUnavailableRanges] = useState<any[]>([]);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [currentWeekMeetings, setCurrentWeekMeetings] = useState<any[]>([]);
  
  // Performance data state
  const [performanceData, setPerformanceData] = useState<any>(null);
  const [loadingPerformance, setLoadingPerformance] = useState(false);
  const [performanceError, setPerformanceError] = useState<string | null>(null);
  
  // Lookup data state
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [allLanguages, setAllLanguages] = useState<any[]>([]);
  
  // Edit background image state
  const [isEditingBackground, setIsEditingBackground] = useState(false);
  const [newBackgroundUrl, setNewBackgroundUrl] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  
  // Interactive graphs state
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

  // Function to upload image to Supabase storage
  const uploadImageToStorage = async (file: File): Promise<string | null> => {
    try {
      const { supabase } = await import('../lib/supabase');
      
      // Generate unique filename
      const fileExt = file.name.split('.').pop();
      const fileName = `${employee?.id || 'unknown'}_${Date.now()}.${fileExt}`;
      const filePath = fileName; // Store directly in bucket root, not in subfolder
      
      console.log('📤 Uploading file:', { fileName, filePath, fileSize: file.size, fileType: file.type });
      
      // Upload file to Supabase storage
      const { data, error } = await supabase.storage
        .from('My-Profile')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type
        });
      
      if (error) {
        console.error('Error uploading image:', error);
        return null;
      }
      
      console.log('✅ Upload successful:', data);
      
      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('My-Profile')
        .getPublicUrl(filePath);
      
      console.log('🔗 Public URL generated:', publicUrl);
      
      return publicUrl;
    } catch (error) {
      console.error('Error uploading image:', error);
      return null;
    }
  };

  // Function to handle background image update
  const handleBackgroundImageUpdate = async () => {
    if (!employee || !newBackgroundUrl.trim()) return;
    
    setUploadingImage(true);
    
    try {
      const { supabase } = await import('../lib/supabase');
      
      const { error } = await supabase
        .from('tenants_employee')
        .update({ photo: newBackgroundUrl.trim() })
        .eq('display_name', employee.display_name);
      
      if (error) {
        console.error('Error updating background image:', error);
        alert('Failed to update background image');
        return;
      }
      
      // Update the employee object locally
      employee.photo = newBackgroundUrl.trim();
      setIsEditingBackground(false);
      setNewBackgroundUrl('');
      alert('Background image updated successfully!');
    } catch (error) {
      console.error('Error updating background image:', error);
      alert('Failed to update background image');
    } finally {
      setUploadingImage(false);
    }
  };

  // Function to handle file drop
  const handleFileDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    const imageFile = files.find(file => file.type.startsWith('image/'));
    
    if (!imageFile) {
      alert('Please drop a valid image file');
      return;
    }
    
    setUploadingImage(true);
    
    try {
      const uploadedUrl = await uploadImageToStorage(imageFile);
      
      if (uploadedUrl) {
        setNewBackgroundUrl(uploadedUrl);
        alert('Image uploaded successfully! Click "Update Background" to save.');
      } else {
        alert('Failed to upload image');
      }
    } catch (error) {
      console.error('Error handling file drop:', error);
      alert('Failed to upload image');
    } finally {
      setUploadingImage(false);
    }
  };

  // Function to handle file input change
  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
      alert('Please select a valid image file');
      return;
    }
    
    setUploadingImage(true);
    
    try {
      const uploadedUrl = await uploadImageToStorage(file);
      
      if (uploadedUrl) {
        setNewBackgroundUrl(uploadedUrl);
        alert('Image uploaded successfully! Click "Update Background" to save.');
      } else {
        alert('Failed to upload image');
      }
    } catch (error) {
      console.error('Error handling file input:', error);
      alert('Failed to upload image');
    } finally {
      setUploadingImage(false);
    }
  };

  // Function to fetch lookup data (categories and languages)
  const fetchLookupData = React.useCallback(async () => {
    try {
      const { supabase } = await import('../lib/supabase');
      
      // Fetch categories with their parent main category using JOINs
      const [categoriesResult, languagesResult] = await Promise.all([
        supabase.from('misc_category')
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
        supabase.from('misc_language').select('id, name').order('name')
      ]);
      
      if (!categoriesResult.error && categoriesResult.data) {
        setAllCategories(categoriesResult.data);
      }
      
      if (!languagesResult.error && languagesResult.data) {
        setAllLanguages(languagesResult.data);
      }
    } catch (error) {
      console.error('Error fetching lookup data:', error);
    }
  }, []);

  // Helper functions to get names from IDs
  const getCategoryName = (categoryId: string | number | null | undefined) => {
    if (!categoryId || categoryId === '---') return 'N/A';
    
    const category = allCategories.find(cat => cat.id.toString() === categoryId.toString());
    if (category) {
      // Return category name with main category in parentheses
      if (category.misc_maincategory?.name) {
        return `${category.name} (${category.misc_maincategory.name})`;
      } else {
        return category.name; // Fallback if no main category
      }
    }
    return String(categoryId);
  };

  const getLanguageName = (languageId: string | number | null | undefined) => {
    if (!languageId || languageId === '---') return 'N/A';
    
    const language = allLanguages.find(lang => lang.id.toString() === languageId.toString());
    return language ? language.name : String(languageId);
  };

  // Use the imported getCurrencySymbol function directly
  const getCurrencySymbol = getCurrencySymbolFromLib;

  // Function to fetch employee availability data
  const fetchAvailabilityData = React.useCallback(async () => {
    if (!employee) return;
    
    setLoadingAvailability(true);
    try {
      const { supabase } = await import('../lib/supabase');
      
      // Calculate current week date range
      const today = new Date();
      const currentDay = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - currentDay); // Go to Sunday
      startOfWeek.setHours(0, 0, 0, 0);
      
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6); // Go to Saturday
      endOfWeek.setHours(23, 59, 59, 999);

      const startOfWeekStr = startOfWeek.toISOString().split('T')[0];
      const endOfWeekStr = endOfWeek.toISOString().split('T')[0];

      // Run all queries in parallel with timeout for better performance
      const queryTimeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Query timeout')), 5000)
      );

      const [availabilityResult, meetingsResult]: any = await Promise.race([
        Promise.all([
          // Fetch unavailable times and ranges
          supabase
            .from('tenants_employee')
            .select('unavailable_times, unavailable_ranges')
            .eq('display_name', employee.display_name)
            .single(),
          
        // Fetch current week meetings with client data
        supabase
          .from('meetings')
          .select(`
            id,
            meeting_date,
            meeting_time,
            meeting_manager,
            helper,
            meeting_location,
            status,
            lead:leads!client_id(
              id,
              name,
              lead_number,
              stage,
              language,
              category,
              balance,
              balance_currency
            ),
            legacy_lead:leads_lead!legacy_lead_id(
              id,
              name,
              lead_number,
              stage,
              category,
              total,
              meeting_total_currency_id
            )
          `)
          .gte('meeting_date', startOfWeekStr)
          .lte('meeting_date', endOfWeekStr)
          .or(`meeting_manager.eq.${employee.display_name},helper.eq.${employee.display_name}`)
          .limit(15)
        ]),
        queryTimeout
      ]);

      // Process availability data
      if (availabilityResult.error) {
        console.error('Error fetching availability data:', availabilityResult.error);
        setUnavailableTimes([]);
        setUnavailableRanges([]);
      } else {
        setUnavailableTimes(availabilityResult.data?.unavailable_times || []);
        setUnavailableRanges(availabilityResult.data?.unavailable_ranges || []);
      }

      // Process meetings data with client information
      if (meetingsResult.error) {
        console.error('Error fetching meetings data:', meetingsResult.error);
        setCurrentWeekMeetings([]);
      } else {
        const processedMeetings = (meetingsResult.data || [])
          .filter((meeting: any) => meeting.meeting_date) // Only include meetings with valid dates
          .map((meeting: any) => ({
            id: meeting.id,
            meeting_date: meeting.meeting_date,
            meeting_time: meeting.meeting_time || '09:00',
            meeting_manager: meeting.meeting_manager,
            helper: meeting.helper,
            meeting_location: meeting.meeting_location || 'Teams',
            status: meeting.status || 'Scheduled',
            client_name: meeting.lead?.name || meeting.legacy_lead?.name || 'Unknown Client',
            lead_number: meeting.lead?.lead_number || meeting.legacy_lead?.lead_number || 'N/A',
            stage: meeting.lead?.stage || meeting.legacy_lead?.stage || 'N/A',
            language: meeting.lead?.language || 'N/A',
            category: meeting.lead?.category || meeting.legacy_lead?.category || 'N/A',
            balance: meeting.lead?.balance || meeting.legacy_lead?.total || 0,
            balance_currency: meeting.lead?.balance_currency || 
              (meeting.legacy_lead?.meeting_total_currency_id === 1 ? 'NIS' : 
               meeting.legacy_lead?.meeting_total_currency_id === 2 ? 'EUR' : 
               meeting.legacy_lead?.meeting_total_currency_id === 3 ? 'USD' : 'NIS'),
            role_in_meeting: meeting.meeting_manager === employee.display_name ? 'Manager' : 'Helper'
          }))
          .sort((a: any, b: any) => {
            const dateComparison = a.meeting_date.localeCompare(b.meeting_date);
            if (dateComparison !== 0) return dateComparison;
            return a.meeting_time.localeCompare(b.meeting_time);
          });
        
        setCurrentWeekMeetings(processedMeetings);
      }
    } catch (error) {
      console.error('Error fetching availability data:', error);
      setUnavailableTimes([]);
      setUnavailableRanges([]);
      setCurrentWeekMeetings([]);
    } finally {
      setLoadingAvailability(false);
    }
  }, [employee]);

  // Function to fetch employee performance data
  const fetchPerformanceData = React.useCallback(async () => {
    if (!employee) return;
    
    console.log('🚀 FETCHING PERFORMANCE DATA for employee:', employee.display_name, 'ID:', employee.id);
    setLoadingPerformance(true);
    setPerformanceError(null);
    
    try {
      const { supabase } = await import('../lib/supabase');
      
      // Calculate date range - default to last 30 days if no dates set
      const today = new Date();
      const defaultFromDate = new Date(today);
      defaultFromDate.setDate(today.getDate() - 30);
      
      const fromDateValue = appliedFromDate || defaultFromDate.toISOString().split('T')[0];
      const toDateValue = appliedToDate || today.toISOString().split('T')[0];
      
      console.log('📊 Fetching performance data for:', employee.display_name, 'from', fromDateValue, 'to', toDateValue);
      console.log('📊 Date range:', { fromDateValue, toDateValue, appliedFromDate, appliedToDate });
      console.log('📊 Today:', today.toISOString().split('T')[0]);
      console.log('📊 Default from date (30 days ago):', defaultFromDate.toISOString().split('T')[0]);
      
      // Use Dashboard approach: Fetch signed stages first, then fetch corresponding leads
      console.log('📋 Fetching leads_leadstage records (stage 60 - agreement signed) for date range...');
      console.log('📋 Date range query:', { fromDateValue, toDateValue, stage: 60 });
      
      // Now fetch with date filter
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
      console.log('📊 Sample signed stage:', signedStages?.[0]);
      
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
            meeting_total_currency_id,
            cdate,
            unactivated_at,
            unactivation_reason,
            category_id,
            category,
            language_id,
            no_of_applicants
          `)
          .in('id', leadIds);
        
        if (leadsError) {
          console.error('Error fetching leads data:', leadsError);
          throw leadsError;
        }
        
        signedLeads = leadsData || [];
        
        // Add stage date to each lead for proper date filtering
        signedLeads = signedLeads.map(lead => {
          const correspondingStage = signedStages.find(stage => stage.lead_id === lead.id);
          return {
            ...lead,
            stage_date: correspondingStage?.cdate || lead.cdate // Use stage date if available, fallback to lead date
          };
        });
        
        console.log('📊 Signed leads fetched:', signedLeads.length);
        console.log('📊 Sample signed lead:', signedLeads[0]);
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
      
      // Fetch closer-specific data if employee is a closer
      let closerData = null;
      if (employee.bonuses_role?.toLowerCase() === 'c') {
        console.log('📊 Fetching closer-specific data for:', employee.display_name, 'ID:', employee.id, 'Role:', employee.bonuses_role);
        
        // Fetch leads where employee is the closer (signed contracts)
        const { data: closerLeads, error: closerLeadsError } = await supabase
          .from('leads_lead')
          .select(`
            id,
            name,
            closer_id,
            total,
            cdate
          `)
          .eq('closer_id', employee.id)
          .gte('cdate', fromDateValue)
          .lte('cdate', toDateValue);
        
        if (closerLeadsError) {
          console.error('Error fetching closer leads:', closerLeadsError);
        } else {
          console.log('📊 Closer leads found:', closerLeads?.length || 0);
          console.log('📊 Sample closer lead:', closerLeads?.[0]);
        }
        
        // Fetch ALL closer leads for team average calculation
        const { data: allCloserLeads, error: allCloserLeadsError } = await supabase
          .from('leads_lead')
          .select(`
            id,
            closer_id,
            cdate
          `)
          .not('closer_id', 'is', null)
          .gte('cdate', fromDateValue)
          .lte('cdate', toDateValue);
        
        if (allCloserLeadsError) {
          console.error('Error fetching all closer leads for team average:', allCloserLeadsError);
        } else {
          console.log('📊 All closer leads found for team average:', allCloserLeads?.length || 0);
        }

        // Generate daily contract data for current closer
        const dailyContracts: any[] = [];
        if (closerLeads && closerLeads.length > 0) {
          // Group leads by date
          const leadsByDate: { [key: string]: any[] } = closerLeads.reduce((acc: { [key: string]: any[] }, lead: any) => {
            const date = lead.cdate ? lead.cdate.split('T')[0] : null;
            if (date) {
              if (!acc[date]) acc[date] = [];
              acc[date].push(lead);
            }
            return acc;
          }, {});

          // Create daily data points
          const startDate = new Date(fromDateValue);
          const endDate = new Date(toDateValue);
          for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
            const dayNumber = d.getDate();
            const contracts = leadsByDate[dateStr] ? leadsByDate[dateStr].length : 0;
            
            dailyContracts.push({
              date: dateStr,
              dayName,
              dayNumber,
              contracts
            });
          }
        }

        // Calculate team average daily contracts
        const teamDailyAverages: any[] = [];
        if (allCloserLeads && allCloserLeads.length > 0) {
          const allLeadsByDate: { [key: string]: any[] } = allCloserLeads.reduce((acc: { [key: string]: any[] }, lead: any) => {
            const date = lead.cdate ? lead.cdate.split('T')[0] : null;
            if (date) {
              if (!acc[date]) acc[date] = [];
              acc[date].push(lead);
            }
            return acc;
          }, {});

          const startDate = new Date(fromDateValue);
          const endDate = new Date(toDateValue);
          for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
            const dayNumber = d.getDate();
            
            const dayLeads = allLeadsByDate[dateStr] || [];
            const uniqueClosers = new Set(dayLeads.map(lead => lead.closer_id)).size;
            const totalContracts = dayLeads.length;
            const teamAverage = uniqueClosers > 0 ? totalContracts / uniqueClosers : 0;
            
            teamDailyAverages.push({
              date: dateStr,
              dayName,
              dayNumber,
              teamAverage: Math.round(teamAverage * 10) / 10 // Round to 1 decimal place
            });
          }
        }

        closerData = {
          leads: closerLeads || [],
          dailyContracts: dailyContracts,
          teamDailyAverages: teamDailyAverages
        };
        
        console.log('📊 Closer data prepared:', {
          leadsCount: closerLeads?.length || 0,
          dailyContractsCount: dailyContracts.length,
          sampleDailyData: dailyContracts.slice(0, 3),
          fullCloserData: closerData
        });
      }

      // Fetch expert-specific data if employee is an expert
      let expertData = null;
      if (employee.bonuses_role?.toLowerCase() === 'e') {
        console.log('🔬 Fetching expert-specific data for:', employee.display_name, 'ID:', employee.id, 'Role:', employee.bonuses_role);
        console.log('🔬 Employee ID type:', typeof employee.id, 'Employee ID value:', employee.id);
        
        // Fetch leads where employee is the expert (includes expert_examination column)
        const { data: expertLeads, error: expertLeadsError } = await supabase
          .from('leads_lead')
          .select(`
            id,
            name,
            expert_id,
            expert_examination,
            cdate
          `)
          .eq('expert_id', employee.id)
          .gte('cdate', fromDateValue)
          .lte('cdate', toDateValue);
        
        if (expertLeadsError) {
          console.error('Error fetching expert leads:', expertLeadsError);
        } else {
          console.log('🔬 Expert leads found:', expertLeads?.length || 0);
          console.log('🔬 Sample expert lead:', expertLeads?.[0]);
          console.log('🔬 Expert lead expert_id:', expertLeads?.[0]?.expert_id, 'Type:', typeof expertLeads?.[0]?.expert_id);
          if (expertLeads && expertLeads.length > 0) {
            console.log('🔬 Expert examination values:', expertLeads.map(lead => ({ 
              id: lead.id, 
              expert_examination: lead.expert_examination,
              type: typeof lead.expert_examination 
            })));
          }
        }

        // Fetch ALL expert leads for team average calculation
        const { data: allExpertLeads, error: allExpertLeadsError } = await supabase
          .from('leads_lead')
          .select(`
            id,
            expert_id,
            cdate
          `)
          .not('expert_id', 'is', null)
          .gte('cdate', fromDateValue)
          .lte('cdate', toDateValue);
        
        if (allExpertLeadsError) {
          console.error('Error fetching all expert leads for team average:', allExpertLeadsError);
        } else {
          console.log('🔬 All expert leads found for team average:', allExpertLeads?.length || 0);
        }
        
        // Generate daily examination data for current expert
        const dailyExaminations: any[] = [];
        if (expertLeads && expertLeads.length > 0) {
          // Group leads by date
          const leadsByDate: { [key: string]: any[] } = expertLeads.reduce((acc: { [key: string]: any[] }, lead: any) => {
            const date = lead.cdate ? lead.cdate.split('T')[0] : null;
            if (date) {
              if (!acc[date]) acc[date] = [];
              acc[date].push(lead);
            }
            return acc;
          }, {});

          // Create daily data points
          const startDate = new Date(fromDateValue);
          const endDate = new Date(toDateValue);
          for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
            const dayNumber = d.getDate();
            const examinations = leadsByDate[dateStr] ? leadsByDate[dateStr].length : 0;
            
            dailyExaminations.push({
              date: dateStr,
              dayName,
              dayNumber,
              examinations
            });
          }
        }

        // Calculate team average daily examinations
        const teamDailyAverages: any[] = [];
        if (allExpertLeads && allExpertLeads.length > 0) {
          // Group all expert leads by date
          const allLeadsByDate: { [key: string]: any[] } = allExpertLeads.reduce((acc: { [key: string]: any[] }, lead: any) => {
            const date = lead.cdate ? lead.cdate.split('T')[0] : null;
            if (date) {
              if (!acc[date]) acc[date] = [];
              acc[date].push(lead);
            }
            return acc;
          }, {});

          // Calculate daily averages
          const startDate = new Date(fromDateValue);
          const endDate = new Date(toDateValue);
          for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
            const dayNumber = d.getDate();
            
            const dayLeads = allLeadsByDate[dateStr] || [];
            // Count unique experts per day
            const uniqueExperts = new Set(dayLeads.map(lead => lead.expert_id)).size;
            const totalExaminations = dayLeads.length;
            const teamAverage = uniqueExperts > 0 ? totalExaminations / uniqueExperts : 0;
            
            teamDailyAverages.push({
              date: dateStr,
              dayName,
              dayNumber,
              teamAverage: Math.round(teamAverage * 10) / 10 // Round to 1 decimal place
            });
          }
        }

        expertData = {
          leads: expertLeads || [],
          dailyExaminations: dailyExaminations,
          teamDailyAverages: teamDailyAverages
        };
        
        console.log('🔬 Expert data prepared:', {
          leadsCount: expertLeads?.length || 0,
          dailyExaminationsCount: dailyExaminations.length,
          teamDailyAveragesCount: teamDailyAverages.length,
          sampleDailyData: dailyExaminations.slice(0, 3),
          sampleTeamAverages: teamDailyAverages.slice(0, 3),
          fullExpertData: expertData
        });
      }
      
      // Process the data to calculate role-specific metrics
      const processedData = processPerformanceData(signedLeads || [], proformaInvoices || [], employee, expertData, closerData);
      
      setPerformanceData(processedData);
      
    } catch (error) {
      console.error('Error fetching performance data:', error);
      setPerformanceError(error instanceof Error ? error.message : 'Failed to fetch performance data');
    } finally {
      setLoadingPerformance(false);
    }
  }, [employee, appliedFromDate, appliedToDate]);

  // Handle apply date filter
  const handleApplyDateFilter = async () => {
    setIsApplyingFilter(true);
    try {
      setAppliedFromDate(fromDate);
      setAppliedToDate(toDate);
      // The useEffect above will automatically trigger fetchPerformanceData when callCount changes
    } finally {
      setIsApplyingFilter(false);
    }
  };

  // Handle clear date filter
  const handleClearDateFilter = () => {
    setFromDate('');
    setToDate('');
    setAppliedFromDate('');
    setAppliedToDate('');
    // This will trigger fetchPerformanceData with empty dates (default to last 30 days)
  };

  // Fetch revenue data for the graph (employee-specific)
  const fetchRevenueGraphData = async (year: number, startMonth: number, endMonth: number) => {
    setRevenueGraphLoading(true);
    try {
      if (!employee) return;
      
      console.log(`📊 Fetching revenue graph data for employee ${employee.display_name} (${year}, months ${startMonth}-${endMonth})`);
      
      const { supabase } = await import('../lib/supabase');
      
      // Calculate date range for the entire period
      const startDate = new Date(year, startMonth - 1, 1);
      const endDate = new Date(year, endMonth, 0, 23, 59, 59);
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];
      
      console.log(`📊 Fetching employee revenue data for period: ${startDateStr} to ${endDateStr}`);
      
      // Fetch signed stages for the entire period
      const { data: stageRecords, error: stageError } = await supabase
        .from('leads_leadstage')
        .select('lead_id, date')
        .eq('stage', 60)
        .gte('date', startDate.toISOString())
        .lte('date', endDate.toISOString());
      
      if (stageError) {
        console.error('Error fetching stages:', stageError);
        return;
      }
      
      if (!stageRecords || stageRecords.length === 0) {
        setRevenueGraphData([]);
        return;
      }
      
      // Fetch leads data for the signed stages
      const leadIds = [...new Set(stageRecords.map(record => record.lead_id).filter(id => id !== null))];
      const { data: leadsData, error: leadsError } = await supabase
        .from('leads_lead')
        .select(`
          id,
          total,
          meeting_total_currency_id,
          case_handler_id,
          closer_id,
          expert_id,
          meeting_scheduler_id,
          meeting_manager_id,
          meeting_lawyer_id
        `)
        .in('id', leadIds);
      
      if (leadsError) {
        console.error('Error fetching leads:', leadsError);
        return;
      }
      
      // Create a map for quick lookup of lead details
      const leadsMap = new Map(leadsData?.map(lead => [lead.id, lead]));
      
      // Process data by month
      const graphData = [];
      
      for (let month = startMonth; month <= endMonth; month++) {
        const monthStartDate = new Date(year, month - 1, 1);
        const monthEndDate = new Date(year, month, 0, 23, 59, 59);
        
        // Filter stages for this month
        const monthStages = stageRecords.filter(record => {
          const recordDate = new Date(record.date);
          return recordDate >= monthStartDate && recordDate <= monthEndDate;
        });
        
        // Calculate total revenue for this month
        let monthRevenue = 0;
        let monthContracts = 0;
        
        monthStages.forEach(stage => {
          const lead = leadsMap.get(stage.lead_id);
          if (lead) {
            // Check if this lead belongs to the current employee in their MAIN role only
            const employeeIdNum = Number(employee.id);
            const mainRole = employee.bonuses_role?.toLowerCase();
            let isEmployeeLead = false;
            
            switch (mainRole) {
              case 'h': // Handler
                isEmployeeLead = Number(lead.case_handler_id) === employeeIdNum;
                break;
              case 'c': // Closer
                isEmployeeLead = Number(lead.closer_id) === employeeIdNum;
                break;
              case 'e': // Expert
                isEmployeeLead = Number(lead.expert_id) === employeeIdNum;
                break;
              case 's': // Scheduler
                isEmployeeLead = Number(lead.meeting_scheduler_id) === employeeIdNum;
                break;
              case 'z': // Manager
              case 'Z': // Manager
                isEmployeeLead = Number(lead.meeting_manager_id) === employeeIdNum;
                break;
              case 'helper-closer': // Helper Closer
                isEmployeeLead = Number(lead.meeting_lawyer_id) === employeeIdNum;
                break;
              default:
                // If no main role defined, don't count any revenue
                isEmployeeLead = false;
            }
            
            if (isEmployeeLead) {
              const amount = parseFloat(lead.total) || 0;
              const amountInNIS = convertToNIS(amount, lead.meeting_total_currency_id);
              monthRevenue += amountInNIS;
              monthContracts += 1;
              
              console.log(`✅ Revenue - Lead ${lead.id}: ${amount} (${lead.meeting_total_currency_id}) -> ₪${amountInNIS} for employee ${employee.display_name} in main role: ${mainRole}`);
            }
          }
        });
        
        graphData.push({
          month: month,
          monthName: monthStartDate.toLocaleDateString('en-US', { month: 'short' }),
          revenue: Math.round(monthRevenue),
          contracts: monthContracts
        });
        
        console.log(`📊 ${year}-${month}: ${monthContracts} employee contracts, ₪${Math.round(monthRevenue)} employee revenue for main role: ${employee.bonuses_role?.toLowerCase()}`);
      }
      
      console.log('📊 Employee revenue graph data:', graphData);
      setRevenueGraphData(graphData);
      
    } catch (error) {
      console.error('Error fetching employee revenue graph data:', error);
    } finally {
      setRevenueGraphLoading(false);
    }
  };

  // Fetch meetings data for the graph (employee-specific)
  const fetchMeetingsGraphData = async (year: number, startMonth: number, endMonth: number) => {
    setMeetingsGraphLoading(true);
    try {
      if (!employee) return;
      
      console.log(`📊 Fetching meetings graph data for employee ${employee.display_name} (${year}, months ${startMonth}-${endMonth})`);
      
      const { supabase } = await import('../lib/supabase');
      
      // Calculate date range for the entire period
      const startDate = new Date(year, startMonth - 1, 1);
      const endDate = new Date(year, endMonth, 0, 23, 59, 59);
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];
      
      console.log(`📊 Fetching employee meetings data for period: ${startDateStr} to ${endDateStr}`);
      
      // Fetch all regular meetings for the entire period
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
      
      // Fetch all legacy meetings for the entire period
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
      
      // Collect all unique lead IDs from both regular and legacy meetings
      const allLeadIds = new Set<number>();
      allRegularMeetings?.forEach(meeting => {
        if (meeting.legacy_lead_id) allLeadIds.add(meeting.legacy_lead_id);
      });
      allLegacyMeetings?.forEach(meeting => allLeadIds.add(meeting.id));
      
      // Fetch lead details (including role fields) for all unique leads
      let leadsData: any[] = [];
      if (allLeadIds.size > 0) {
        const { data, error } = await supabase
          .from('leads_lead')
          .select(`
            id,
            case_handler_id,
            closer_id,
            expert_id,
            meeting_scheduler_id,
            meeting_manager_id,
            meeting_lawyer_id,
            misc_category(
              misc_maincategory(
                tenant_departement(name)
              )
            )
          `)
          .in('id', Array.from(allLeadIds));
        if (error) console.error('Error fetching lead details for meetings:', error);
        else leadsData = data || [];
      }
      
      const leadsMap = new Map(leadsData.map(lead => [lead.id, lead]));
      
      // Filter meetings by employee using role-based filtering
      const employeeRegularMeetings = allRegularMeetings?.filter(meeting => {
        const lead = leadsMap.get(meeting.legacy_lead_id);
        if (!lead) return false;
        
        const employeeIdNum = Number(employee.id);
        return Number(lead.case_handler_id) === employeeIdNum ||
               Number(lead.closer_id) === employeeIdNum ||
               Number(lead.expert_id) === employeeIdNum ||
               Number(lead.meeting_scheduler_id) === employeeIdNum ||
               Number(lead.meeting_manager_id) === employeeIdNum ||
               Number(lead.meeting_lawyer_id) === employeeIdNum;
      }) || [];
      
      const employeeLegacyMeetings = allLegacyMeetings?.filter(meeting => {
        const lead = leadsMap.get(meeting.id);
        if (!lead) return false;
        
        const employeeIdNum = Number(employee.id);
        return Number(lead.case_handler_id) === employeeIdNum ||
               Number(lead.closer_id) === employeeIdNum ||
               Number(lead.expert_id) === employeeIdNum ||
               Number(lead.meeting_scheduler_id) === employeeIdNum ||
               Number(lead.meeting_manager_id) === employeeIdNum ||
               Number(lead.meeting_lawyer_id) === employeeIdNum;
      }) || [];
      
      console.log(`📊 Found ${employeeRegularMeetings.length} employee regular meetings and ${employeeLegacyMeetings.length} employee legacy meetings`);
      
      // Process data by month
      const graphData = [];
      const meetingsByDept = new Map();
      
      for (let month = startMonth; month <= endMonth; month++) {
        const monthStartDate = new Date(year, month - 1, 1);
        const monthEndDate = new Date(year, month, 0, 23, 59, 59);
        const monthStartStr = monthStartDate.toISOString().split('T')[0];
        const monthEndStr = monthEndDate.toISOString().split('T')[0];
        
        // Filter meetings for this month
        const monthRegularMeetings = employeeRegularMeetings.filter(meeting => 
          meeting.meeting_date >= monthStartStr && meeting.meeting_date <= monthEndStr
        );
        
        const monthLegacyMeetings = employeeLegacyMeetings.filter(meeting => 
          meeting.meeting_date >= monthStartStr && meeting.meeting_date <= monthEndStr
        );
        
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
        
        console.log(`📊 ${year}-${month}: ${totalMeetings} unique employee meetings (${regularCount} regular + ${legacyCount} legacy, ${regularCount + legacyCount - totalMeetings} duplicates removed)`);
      }
      
      // Get department data for employee meetings
      const departmentCounts = new Map();
      
      // Count meetings by department using the employee-filtered data
      employeeRegularMeetings.forEach(meeting => {
        const lead = leadsMap.get(meeting.legacy_lead_id);
        if (lead) {
          const leadData = lead as any;
          const departmentName = leadData.misc_category?.misc_maincategory?.tenant_departement?.name || 'Unknown';
          departmentCounts.set(departmentName, (departmentCounts.get(departmentName) || 0) + 1);
        }
      });
      
      employeeLegacyMeetings.forEach(meeting => {
        const lead = leadsMap.get(meeting.id);
        if (lead) {
          const leadData = lead as any;
          const departmentName = leadData.misc_category?.misc_maincategory?.tenant_departement?.name || 'Unknown';
          departmentCounts.set(departmentName, (departmentCounts.get(departmentName) || 0) + 1);
        }
      });
      
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

  // Fetch contracts data for the graph (employee-specific)
  const fetchContractsGraphData = async (year: number, startMonth: number, endMonth: number) => {
    setContractsGraphLoading(true);
    try {
      if (!employee) return;
      
      console.log(`📊 Fetching contracts graph data for employee ${employee.display_name} (ID: ${employee.id}) (${year}, months ${startMonth}-${endMonth})`);
      
      const { supabase } = await import('../lib/supabase');
      
      const graphData = [];
      const contractsByDept = new Map();
      
      for (let month = startMonth; month <= endMonth; month++) {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);
        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];
        
        console.log(`📊 Fetching employee contracts data for ${year}-${month.toString().padStart(2, '0')}: ${startDateStr} to ${endDateStr}`);
        
        // Fetch signed stages (stage 60 - agreement signed) for this month
        const { data: signedStages, error: stagesError } = await supabase
          .from('leads_leadstage')
          .select(`
            id,
            lead_id,
            stage,
            cdate
          `)
          .eq('stage', 60)
          .gte('cdate', startDateStr)
          .lte('cdate', endDateStr);
        
        if (stagesError) {
          console.error(`Error fetching signed stages for ${year}-${month}:`, stagesError);
          continue;
        }
        
        let monthContracts = 0;
        
        if (signedStages && signedStages.length > 0) {
          // Fetch leads data for the signed stages to get department info
          const leadIds = [...new Set(signedStages.map(stage => stage.lead_id).filter(id => id !== null))];
          
          const { data: leadsData, error: leadsError } = await supabase
            .from('leads_lead')
            .select(`
              id,
              case_handler_id,
              closer_id,
              expert_id,
              meeting_scheduler_id,
              meeting_manager_id,
              meeting_lawyer_id,
              misc_category(
                misc_maincategory(
                  tenant_departement(name)
                )
              )
            `)
            .in('id', leadIds);
          
          if (leadsError) {
            console.error(`Error fetching leads data for ${year}-${month}:`, leadsError);
            continue;
          }
          
          
          // Filter contracts by employee using role-based filtering
          const employeeContracts = signedStages.filter(stage => {
            const lead = leadsData?.find(l => l.id === stage.lead_id);
            if (!lead) return false;
            
            const employeeIdNum = Number(employee.id);
            const isEmployeeLead = 
              Number(lead.case_handler_id) === employeeIdNum ||
              Number(lead.closer_id) === employeeIdNum ||
              Number(lead.expert_id) === employeeIdNum ||
              Number(lead.meeting_scheduler_id) === employeeIdNum ||
              Number(lead.meeting_manager_id) === employeeIdNum ||
              Number(lead.meeting_lawyer_id) === employeeIdNum;
            
            if (isEmployeeLead) {
              console.log(`✅ Found employee ${employee.display_name} (${employee.id}) in lead ${lead.id} with role`);
            }
            
            return isEmployeeLead;
          });
          
          console.log(`📊 Found ${employeeContracts.length} employee contracts out of ${signedStages.length} total for ${year}-${month}`);
          
          // Count contracts and track departments
          employeeContracts.forEach(stage => {
            const lead = leadsData?.find(l => l.id === stage.lead_id);
            if (lead) {
              monthContracts += 1;
              
              // Track department for contracts
              const leadData = lead as any;
              const departmentName = leadData.misc_category?.misc_maincategory?.tenant_departement?.name || 'Unknown';
              contractsByDept.set(departmentName, (contractsByDept.get(departmentName) || 0) + 1);
            }
          });
        }
        
        graphData.push({
          month: month,
          monthName: startDate.toLocaleDateString('en-US', { month: 'short' }),
          contracts: monthContracts
        });
        
        console.log(`📊 ${year}-${month}: ${monthContracts} employee contracts`);
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

  // Function to process performance data
  const processPerformanceData = (signedLeads: any[], proformaInvoices: any[], employee: Employee, expertData?: any, closerData?: any) => {
    const employeeId = employee.id;
    const employeeIdNum = Number(employeeId); // Convert to number for comparison
    
    // Let's also check if there are any matches at all with detailed comparison
    let hasAnyMatches = false;
    signedLeads.slice(0, 10).forEach((lead, index) => {
      if (Number(lead.case_handler_id) === employeeIdNum || 
          Number(lead.closer_id) === employeeIdNum || 
          Number(lead.expert_id) === employeeIdNum || 
          Number(lead.meeting_scheduler_id) === employeeIdNum || 
          Number(lead.meeting_manager_id) === employeeIdNum || 
          Number(lead.meeting_lawyer_id) === employeeIdNum) {
        hasAnyMatches = true;
      }
    });
    
    const roleMetrics: any = {
      handler: { signed: 0, total: 0, invoiced: 0, cases: 0, applicants: 0 },
      closer: { signed: 0, total: 0, invoiced: 0 },
      expert: { signed: 0, total: 0, invoiced: 0 },
      scheduler: { signed: 0, total: 0, invoiced: 0 },
      manager: { signed: 0, total: 0, invoiced: 0 },
      helper_closer: { signed: 0, total: 0, invoiced: 0 }
    };
    
    // Process signed leads
    signedLeads.forEach((lead, index) => {
      const leadTotal = parseFloat(lead.total) || 0; // Convert string to number
      const leadTotalInNIS = convertToNIS(leadTotal, lead.meeting_total_currency_id); // Convert to NIS
      
      // Check each role and add to metrics if employee has that role
      if (Number(lead.case_handler_id) === employeeIdNum) {
        console.log('✅ Matched as Handler - Lead:', lead.id, 'Handler ID:', lead.case_handler_id, 'Employee ID:', employeeIdNum);
        roleMetrics.handler.signed += 1;
        roleMetrics.handler.total += leadTotalInNIS; // Use NIS amount
        roleMetrics.handler.cases += 1; // Each lead is a case
        roleMetrics.handler.applicants += parseInt(lead.no_of_applicants) || 0;
      }
      if (Number(lead.closer_id) === employeeIdNum) {
        console.log('✅ Matched as Closer - Lead:', lead.id, 'Closer ID:', lead.closer_id, 'Employee ID:', employeeIdNum);
        roleMetrics.closer.signed += 1;
        roleMetrics.closer.total += leadTotalInNIS; // Use NIS amount
      }
      if (Number(lead.expert_id) === employeeIdNum) {
        console.log('✅ Matched as Expert - Lead:', lead.id, 'Expert ID:', lead.expert_id, 'Employee ID:', employeeIdNum);
        roleMetrics.expert.signed += 1;
        roleMetrics.expert.total += leadTotalInNIS; // Use NIS amount
      }
      if (Number(lead.meeting_scheduler_id) === employeeIdNum) {
        console.log('✅ Matched as Scheduler - Lead:', lead.id, 'Scheduler ID:', lead.meeting_scheduler_id, 'Employee ID:', employeeIdNum);
        roleMetrics.scheduler.signed += 1;
        roleMetrics.scheduler.total += leadTotalInNIS; // Use NIS amount
      }
      if (Number(lead.meeting_manager_id) === employeeIdNum) {
        console.log('✅ Matched as Manager - Lead:', lead.id, 'Manager ID:', lead.meeting_manager_id, 'Employee ID:', employeeIdNum);
        roleMetrics.manager.signed += 1;
        roleMetrics.manager.total += leadTotalInNIS; // Use NIS amount
      }
      if (Number(lead.meeting_lawyer_id) === employeeIdNum) {
        console.log('✅ Matched as Helper Closer - Lead:', lead.id, 'Helper ID:', lead.meeting_lawyer_id, 'Employee ID:', employeeIdNum);
        roleMetrics.helper_closer.signed += 1;
        roleMetrics.helper_closer.total += leadTotalInNIS; // Use NIS amount
      }
    });
    
    // Process proforma invoices
    proformaInvoices.forEach(invoice => {
      const invoiceAmount = invoice.total || 0;
      
      // Find the corresponding lead to check roles
      const correspondingLead = signedLeads.find(lead => lead.id === invoice.lead_id);
      if (correspondingLead) {
        if (Number(correspondingLead.case_handler_id) === employeeIdNum) {
          roleMetrics.handler.invoiced += invoiceAmount;
        }
        if (Number(correspondingLead.closer_id) === employeeIdNum) {
          roleMetrics.closer.invoiced += invoiceAmount;
        }
        if (Number(correspondingLead.expert_id) === employeeIdNum) {
          roleMetrics.expert.invoiced += invoiceAmount;
        }
        if (Number(correspondingLead.meeting_scheduler_id) === employeeIdNum) {
          roleMetrics.scheduler.invoiced += invoiceAmount;
        }
        if (Number(correspondingLead.meeting_manager_id) === employeeIdNum) {
          roleMetrics.manager.invoiced += invoiceAmount;
        }
        if (Number(correspondingLead.meeting_lawyer_id) === employeeIdNum) {
          roleMetrics.helper_closer.invoiced += invoiceAmount;
        }
      }
    });
    
    // Calculate total revenue: use signed total if available, otherwise use due total
    // Never sum both together for the same lead
    let totalRevenue = 0;
    signedLeads.forEach(lead => {
      const leadTotal = parseFloat(lead.total) || 0;
      const leadTotalInNIS = convertToNIS(leadTotal, lead.meeting_total_currency_id);
      const correspondingInvoice = proformaInvoices.find(inv => inv.lead_id === lead.id);
      const invoiceAmount = correspondingInvoice ? (parseFloat(correspondingInvoice.total) || 0) : 0;
      const invoiceAmountInNIS = convertToNIS(invoiceAmount, correspondingInvoice?.currency_id);
      
      // Use signed total if available, otherwise use due total (invoice amount)
      if (leadTotal > 0) {
        totalRevenue += leadTotalInNIS; // Use NIS amount
      } else if (invoiceAmount > 0) {
        totalRevenue += invoiceAmountInNIS; // Use NIS amount
      }
    });

    // Calculate total signed amount across all roles for the employee
    const totalSignedAcrossAllRoles = Object.values(roleMetrics).reduce((sum, role: any) => sum + role.total, 0);

    // Process expert-specific data
    let expertMetrics = null;
    if (expertData && employee.bonuses_role?.toLowerCase() === 'e') {
      console.log('🔬 Processing expert data:', expertData);
      
      // Count feasibility types from expert_examination column in leads_lead (text field)
      const feasibilityCounts = {
        noFeasibility: 0,      // expert_examination = "1"
        feasibleFurtherCheck: 0, // expert_examination = "5"
        feasibleNoCheck: 0     // expert_examination = "8"
      };
      
      expertData.leads.forEach((lead: any) => {
        const examinationValue = lead.expert_examination;
        console.log('🔬 Lead expert_examination value:', examinationValue, 'type:', typeof examinationValue, 'for lead:', lead.id);
        
        // Handle text values and convert to string for comparison
        const examStr = String(examinationValue);
        
        switch (examStr) {
          case "1":
            feasibilityCounts.noFeasibility++;
            break;
          case "5":
            feasibilityCounts.feasibleFurtherCheck++;
            break;
          case "8":
            feasibilityCounts.feasibleNoCheck++;
            break;
          case "0":
          case "":
          case null:
          case undefined:
            // Not checked - don't count these
            break;
          default:
            console.log('🔬 Unknown expert_examination value:', examinationValue);
            break;
        }
      });
      
      expertMetrics = {
        expertOpinions: expertData.leads.length, // Count of leads where employee is expert
        noFeasibility: feasibilityCounts.noFeasibility,
        feasibleFurtherCheck: feasibilityCounts.feasibleFurtherCheck,
        feasibleNoCheck: feasibilityCounts.feasibleNoCheck,
        dailyExaminations: expertData.dailyExaminations, // Include daily examinations data
        teamDailyAverages: expertData.teamDailyAverages // Include team daily averages
      };
      
      console.log('🔬 Expert metrics calculated:', expertMetrics);
    }

    // Process closer-specific data
    let closerMetrics = null;
    if (closerData && employee.bonuses_role?.toLowerCase() === 'c') {
      console.log('📊 Processing closer data:', closerData);
      
      closerMetrics = {
        totalContracts: closerData.leads.length,
        dailyContracts: closerData.dailyContracts,
        teamDailyAverages: closerData.teamDailyAverages
      };
      
      console.log('📊 Closer metrics calculated:', closerMetrics);
    }

    const result = {
      roleMetrics,
      totalSigned: signedLeads.length,
      totalInvoiced: totalRevenue, // Use calculated total revenue instead of sum of all invoices
      totalSignedAcrossAllRoles: totalSignedAcrossAllRoles, // Sum of signed totals across all roles
      expertMetrics: expertMetrics, // Expert-specific metrics
      closerMetrics: closerMetrics, // Closer-specific metrics
      dateRange: { from: appliedFromDate, to: appliedToDate },
      signedLeads: signedLeads // Include signed leads for role filtering
    };
    
    
    // CRITICAL DEBUG: Check if employee ID matching is working
    console.log('🚨 CRITICAL DEBUG - Employee ID Matching Issue:');
    console.log('🚨 Employee ID:', employeeIdNum, 'Type:', typeof employeeIdNum);
    console.log('🚨 First lead closer_id:', signedLeads[0]?.closer_id, 'Type:', typeof signedLeads[0]?.closer_id);
    console.log('🚨 First lead meeting_scheduler_id:', signedLeads[0]?.meeting_scheduler_id, 'Type:', typeof signedLeads[0]?.meeting_scheduler_id);
    console.log('🚨 Are they equal?', Number(signedLeads[0]?.closer_id) === employeeIdNum);
    console.log('🚨 Are they equal (scheduler)?', Number(signedLeads[0]?.meeting_scheduler_id) === employeeIdNum);
    
    return result;
  };

  // Fetch lookup data when modal opens
  React.useEffect(() => {
    if (isOpen) {
      fetchLookupData();
    }
  }, [isOpen, fetchLookupData]);

  // Fetch performance data when overview tab is selected or dates change
  React.useEffect(() => {
    if (activeTab === 'overview' && employee) {
      fetchPerformanceData();
    }
  }, [activeTab, employee, fetchPerformanceData, appliedFromDate, appliedToDate]);

  // Fetch availability data when availability tab is selected
  React.useEffect(() => {
    if (activeTab === 'availability' && employee) {
      fetchAvailabilityData();
    }
  }, [activeTab, employee, fetchAvailabilityData]);

  // Fetch graph data when graphs are shown
  React.useEffect(() => {
    if (showRevenueGraph && employee) {
      fetchRevenueGraphData(graphYear, graphStartMonth, graphEndMonth);
    }
  }, [showRevenueGraph, graphYear, graphStartMonth, graphEndMonth, employee]);

  React.useEffect(() => {
    if (showMeetingsGraph && employee) {
      fetchMeetingsGraphData(graphYear, graphStartMonth, graphEndMonth);
    }
  }, [showMeetingsGraph, graphYear, graphStartMonth, graphEndMonth, employee]);

  React.useEffect(() => {
    if (showContractsGraph && employee) {
      fetchContractsGraphData(graphYear, graphStartMonth, graphEndMonth);
    }
  }, [showContractsGraph, graphYear, graphStartMonth, graphEndMonth, employee]);

  if (!employee) return null;

  const metrics = employee.performance_metrics || {
    total_meetings: 0,
    completed_meetings: 0,
    total_revenue: 0,
    average_rating: 0,
    last_activity: 'No activity'
  };

  const completionRate = (metrics.total_meetings || 0) > 0 
    ? Math.round(((metrics.completed_meetings || 0) / (metrics.total_meetings || 1)) * 100) 
    : 0;

  // Function to fetch leads for a specific role (only signed leads from performance data)
  const fetchRoleLeads = async (role: string) => {
    setLoadingRoleLeads(true);
    try {
      if (!performanceData) {
        setRoleLeads([]);
        return;
      }

      // Get the signed leads from our performance data
      const signedLeads = performanceData.signedLeads || [];
      const employeeIdNum = Number(employee.id);
      
      // Filter leads by role
      let roleLeads: any[] = [];
      
      switch (role.toLowerCase()) {
        case 'handler':
        case 'h':
          roleLeads = signedLeads.filter((lead: any) => Number(lead.case_handler_id) === employeeIdNum);
          break;
        case 'closer':
        case 'c':
          roleLeads = signedLeads.filter((lead: any) => Number(lead.closer_id) === employeeIdNum);
          break;
        case 'expert':
        case 'e':
          roleLeads = signedLeads.filter((lead: any) => Number(lead.expert_id) === employeeIdNum);
          break;
        case 'scheduler':
        case 's':
          roleLeads = signedLeads.filter((lead: any) => Number(lead.meeting_scheduler_id) === employeeIdNum);
          break;
        case 'manager':
        case 'z':
          roleLeads = signedLeads.filter((lead: any) => Number(lead.meeting_manager_id) === employeeIdNum);
          break;
        case 'helper-closer':
          roleLeads = signedLeads.filter((lead: any) => Number(lead.meeting_lawyer_id) === employeeIdNum);
          break;
        default:
          roleLeads = [];
          break;
      }

      // The signedLeads are already filtered by date range in processPerformanceData
      // No need to apply additional date filtering
      const filteredRoleLeads = roleLeads;
      
      // Format the leads for display
      const formattedLeads = filteredRoleLeads.map(lead => {
        return {
          lead_number: lead.id, // Use id as lead_number for legacy leads
          name: lead.name,
          category: getCategoryName(lead.category_id || lead.category),
          stage: 'Signed (60)',
          language: getLanguageName(lead.language_id),
          applicants: lead.no_of_applicants || 0,
          total: (() => {
            const originalAmount = parseFloat(lead.total) || 0;
            const convertedAmount = convertToNIS(originalAmount, lead.meeting_total_currency_id);
            return convertedAmount;
          })(), // Convert to NIS
          balance: lead.balance || 0,
          cdate: lead.stage_date || lead.cdate, // Use stage date (when signed) if available, fallback to creation date
          currency_id: lead.meeting_total_currency_id // Include currency ID for proper formatting
        };
      });

      setRoleLeads(formattedLeads);
      console.log(`📊 Fetched ${formattedLeads.length} leads for ${role} role`);
      
    } catch (error) {
      console.error('Error fetching role leads:', error);
      setRoleLeads([]);
    } finally {
      setLoadingRoleLeads(false);
    }
  };

  // Function to handle role button click
  const handleRoleClick = async (role: string) => {
    setSelectedRole(role);
    await fetchRoleLeads(role);
    setShowRoleDetails(true);
  };

  // Function to go back to role performance view
  const handleBackToRoles = () => {
    setShowRoleDetails(false);
    setSelectedRole('');
    setRoleLeads([]);
  };


  // Helper function to format currency with correct symbol, rounded up without decimals
  const formatCurrency = (amount: number, currencyId?: string | number | null) => {
    const roundedAmount = Math.ceil(amount);
    const currencySymbol = getCurrencySymbol(currencyId);
    return `${currencySymbol}${roundedAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  };

  // Calculate bonus for a specific lead based on employee's role using two-tier system
  const calculateLeadBonus = (lead: any, role: string) => {
    const totalAmount = lead.total || 0;
    
    // Map role names to bonus configuration role codes
    const roleMapping: { [key: string]: string } = {
      'helper-closer': 'lawyer',
      'handler': 'h',
      'closer': 'c',
      'expert': 'e',
      'scheduler': 's',
      'manager': 'z'
    };
    
    const bonusRole = roleMapping[role] || role;
    
    // Get role configuration
    const roleConfig = getRoleConfig(bonusRole);
    const groupConfig = getBonusConfig(bonusRole);
    
    if (!roleConfig || !groupConfig) {
      console.log(`No bonus configuration found for role: ${role}`);
      return {
        amount: 0,
        percentage: 0,
        basePercentage: 0,
        poolPercentage: 100,
        poolInfo: '',
        formatted: formatCurrency(0, lead.currency_id)
      };
    }

    // Get the monthly bonus pool percentage for the lead's date
    let poolPercentage = 100; // Default to 100% if no pool found
    let poolInfo = '';
    
    try {
      if (lead.cdate) {
        const leadDate = new Date(lead.cdate);
        const year = leadDate.getFullYear();
        const month = leadDate.getMonth() + 1;
        
        // Check if we have a cached pool percentage for this month
        const poolKey = `${year}-${month}`;
        const cachedPool = window.monthlyBonusPoolsCache?.[poolKey];
        
        if (cachedPool && cachedPool.pool_percentage > 0) {
          poolPercentage = cachedPool.pool_percentage;
          poolInfo = ` (Pool: ${poolPercentage.toFixed(1)}%)`;
          console.log(`🎯 Using cached pool percentage ${poolPercentage}% for lead ${lead.id} (${year}-${month})`);
        } else {
          console.log(`📊 No cached pool found for ${year}-${month}, using base percentage ${roleConfig.percentage}%`);
        }
      }
    } catch (error) {
      console.error('Error getting pool percentage:', error);
    }
    
    // Two-tier calculation:
    // 1. Group gets percentage of monthly pool
    // 2. Role gets percentage of group allocation
    const groupPoolPercentage = groupConfig.groupPercentage;
    const roleGroupPercentage = roleConfig.percentage;
    
    // Final calculation: (Group % of Pool) * (Role % of Group) / 100
    const finalPercentage = (groupPoolPercentage * roleGroupPercentage) / 100;
    
    const bonusAmount = (totalAmount * finalPercentage) / 100;
    return {
      amount: bonusAmount,
      percentage: finalPercentage,
      basePercentage: roleGroupPercentage,
      poolPercentage: poolPercentage,
      poolInfo: poolInfo,
      groupPercentage: groupPoolPercentage,
      formatted: formatCurrency(bonusAmount, lead.currency_id)
    };
  };

  const averageRevenuePerMeeting = (metrics.completed_meetings || 0) > 0 
    ? (metrics.total_revenue || 0) / (metrics.completed_meetings || 1) 
    : 0;

  // Helper function to get role metrics from performance data
  const getRoleMetrics = (role: string) => {
    if (!performanceData) return { signed: 0, total: 0, invoiced: 0 };
    
    const roleKey = role?.toLowerCase();
    switch (roleKey) {
      case 'h': return performanceData.roleMetrics.handler;
      case 'c': return performanceData.roleMetrics.closer;
      case 'e': return performanceData.roleMetrics.expert;
      case 's': return performanceData.roleMetrics.scheduler;
      case 'z': 
      case 'Z': return performanceData.roleMetrics.manager;
      case 'helper-closer': return performanceData.roleMetrics.helper_closer;
      default: return { signed: 0, total: 0, invoiced: 0 };
    }
  };

  // Get role-specific stats based on employee role
  const getRoleSpecificStats = () => {
    const role = employee.bonuses_role?.toLowerCase();
    
    switch (role) {
      case 'e': // Expert
        return [
          <div key="expert-opinions" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <UserIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Expert Opinions</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{performanceData?.expertMetrics?.expertOpinions || 0}</div>
            <div className="stat-desc text-base">Opinions completed</div>
          </div>,
          <div key="feasibility-no-check" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <CheckCircleIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Feasible (No Check)</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{performanceData?.expertMetrics?.feasibleNoCheck || 0}</div>
            <div className="stat-desc text-base">Direct feasibility</div>
          </div>,
          <div key="feasibility-further-check" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <ClockIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Feasible (Further Check)</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{performanceData?.expertMetrics?.feasibleFurtherCheck || 0}</div>
            <div className="stat-desc text-base">Requires investigation</div>
          </div>,
          <div key="feasibility-no-feasibility" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <XCircleIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">No Feasibility</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{performanceData?.expertMetrics?.noFeasibility || 0}</div>
            <div className="stat-desc text-base">Not feasible</div>
          </div>
        ];

      case 's': // Scheduler
        return [
          <div key="meetings-scheduled" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <CalendarDaysIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Meetings Scheduled</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{metrics.meetings_scheduled || 0}</div>
            <div className="stat-desc text-base">Total meetings scheduled</div>
          </div>,
          <div 
            key="total-meetings" 
            className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 cursor-pointer"
            onClick={() => setShowMeetingsGraph(!showMeetingsGraph)}
          >
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <ChartBarIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Total Meetings</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{metrics.total_meetings || 0}</div>
            <div className="stat-desc text-base">All time meetings</div>
          </div>,
          <div key="completed-meetings" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <CheckCircleIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Completed</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{metrics.completed_meetings || 0}</div>
            <div className="stat-desc text-base">{completionRate}% completion rate</div>
          </div>,
          <div key="completion-rate" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <TrophyIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Completion Rate</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{completionRate}%</div>
            <div className="stat-desc text-base">Success rate</div>
          </div>
        ];

      case 'c': // Closer
        return [
          <div 
            key="signed-agreements" 
            className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 cursor-pointer"
            onClick={() => setShowContractsGraph(!showContractsGraph)}
          >
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <DocumentTextIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Signed Contracts</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{performanceData ? performanceData.roleMetrics.closer.signed : 0}</div>
            <div className="stat-desc text-base">Total contracts signed</div>
          </div>,
          <div key="total-agreement-amount" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <CurrencyDollarIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Total Agreement Amount</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{performanceData ? formatCurrency(performanceData.roleMetrics.closer.total) : formatCurrency(0)}</div>
            <div className="stat-desc text-base">Total value signed</div>
          </div>,
          <div key="avg-agreement-value" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <TrophyIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Avg Agreement Value</div>
            <div className="stat-value" style={{color: '#3829BF'}}>
              {performanceData && performanceData.roleMetrics.closer.signed > 0 
                ? formatCurrency(performanceData.roleMetrics.closer.total / performanceData.roleMetrics.closer.signed)
                : formatCurrency(0)}
            </div>
            <div className="stat-desc text-base">Per agreement</div>
          </div>,
          <div 
            key="total-revenue" 
            className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 cursor-pointer"
            onClick={() => setShowRevenueGraph(!showRevenueGraph)}
          >
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <ChartBarIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Total Revenue</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{performanceData ? formatCurrency(performanceData.totalSignedAcrossAllRoles) : formatCurrency(0)}</div>
            <div className="stat-desc text-base">Signed total across all roles</div>
          </div>
        ];

      case 'h': // Handler
        return [
          <div key="cases-handled" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <UserIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Cases Handled</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{performanceData ? performanceData.roleMetrics.handler.cases : 0}</div>
            <div className="stat-desc text-base">Total cases processed</div>
          </div>,
          <div key="applicants-processed" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <CheckCircleIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Applicants Processed</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{performanceData ? performanceData.roleMetrics.handler.applicants : 0}</div>
            <div className="stat-desc text-base">Total applicants handled</div>
          </div>,
          <div key="total-invoiced-amount" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <CurrencyDollarIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Total Invoiced Amount</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{performanceData ? formatCurrency(performanceData.roleMetrics.handler.invoiced) : formatCurrency(0)}</div>
            <div className="stat-desc text-base">Handler role invoiced amount</div>
          </div>,
          <div key="total-revenue-all-roles" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <TrophyIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Total Revenue All Roles</div>
            <div className="stat-value" style={{color: '#3829BF'}}>
              {performanceData ? formatCurrency(performanceData.totalSignedAcrossAllRoles) : formatCurrency(0)}
            </div>
            <div className="stat-desc text-base">Combined revenue across all roles</div>
          </div>
        ];

      default: // Default stats for other roles
        return [
          <div 
            key="total-meetings" 
            className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 cursor-pointer"
            onClick={() => setShowMeetingsGraph(!showMeetingsGraph)}
          >
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <CalendarDaysIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Total Meetings</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{metrics.total_meetings || 0}</div>
            <div className="stat-desc text-base">All time meetings</div>
          </div>,
          <div key="completed-meetings" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <CheckCircleIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Completed</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{metrics.completed_meetings || 0}</div>
            <div className="stat-desc text-base">{completionRate}% completion rate</div>
          </div>,
          <div 
            key="total-revenue" 
            className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 cursor-pointer"
            onClick={() => setShowRevenueGraph(!showRevenueGraph)}
          >
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <CurrencyDollarIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Total Revenue</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{formatCurrency(metrics.total_revenue || 0)}</div>
            <div className="stat-desc text-base">All time earnings</div>
          </div>,
          <div key="avg-revenue-per-meeting" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <TrophyIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Avg Revenue/Meeting</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{formatCurrency(averageRevenuePerMeeting)}</div>
            <div className="stat-desc text-base">Per completed meeting</div>
          </div>
        ];
    }
  };

  return (
    <>
      <style>
        {`
          .fullscreen-modal {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            max-width: none !important;
            max-height: none !important;
            margin: 0 !important;
            padding: 0 !important;
            z-index: 9999 !important;
            background: rgba(0, 0, 0, 0.5) !important;
          }
          .fullscreen-modal .modal-box {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            max-width: none !important;
            max-height: none !important;
            margin: 0 !important;
            padding: 0 !important;
            border-radius: 0 !important;
            background: white !important;
          }

          .page-flip-container {
            perspective: 1000px;
            width: 100%;
            height: 100%;
            overflow: hidden;
          }

          .page-flip-inner {
            position: relative;
            width: 100%;
            height: 100%;
            transform-style: preserve-3d;
            transition: transform 0.6s ease-in-out;
          }

          .page-flip-inner.flipped {
            transform: rotateY(180deg);
          }

          .page-front, .page-back {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            backface-visibility: hidden;
            background: white;
            overflow-y: auto;
            overflow-x: hidden;
            -webkit-overflow-scrolling: touch;
            will-change: transform;
          }

          .page-front {
            z-index: 2;
          }

          .page-back {
            transform: rotateY(180deg);
            z-index: 1;
          }

          .page-flip-inner.flipped .page-front {
            z-index: 1;
          }

          .page-flip-inner.flipped .page-back {
            z-index: 2;
          }
        `}
      </style>
      <div 
        className={`modal fullscreen-modal ${isOpen ? 'modal-open' : ''}`}
      >
      <div className="modal-box w-full h-full overflow-y-auto p-0 m-0">
        <div className="p-6 h-full">
          <div className="page-flip-container">
            <div className={`page-flip-inner ${showRoleDetails ? 'flipped' : ''}`}>
              {/* Front Page - Role Performance */}
              <div className="page-front">
        {/* Header */}
        <div className="mb-8 relative">
          {/* Background Image with Overlay */}
          {employee.photo && (
            <div 
              className="absolute inset-0 rounded-lg bg-cover bg-center bg-no-repeat"
              style={{ backgroundImage: `url(${employee.photo})` }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/40 to-black/60 rounded-lg"></div>
            </div>
          )}
          <div className={`relative z-10 p-3 sm:p-6 rounded-lg ${employee.photo ? 'text-white' : ''}`}>
          {/* Mobile Layout */}
          <div className="sm:hidden">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="avatar flex-shrink-0">
                  {employee.photo_url ? (
                    <div className="rounded-full w-16">
                      <img 
                        src={employee.photo_url} 
                        alt={employee.display_name}
                        className="w-full h-full object-cover rounded-full"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          const parent = target.parentElement;
                          if (parent) {
                            parent.innerHTML = `
                              <div class="bg-primary text-primary-content rounded-full w-16 h-16 flex items-center justify-center">
                                <span class="text-lg font-bold">${getInitials(employee.display_name)}</span>
                              </div>
                            `;
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <div className="placeholder">
                      <div className="bg-primary text-primary-content rounded-full w-16 h-16 flex items-center justify-center">
                        <span className="text-lg font-bold">
                          {getInitials(employee.display_name)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className={`text-xl font-bold mb-1 truncate ${employee.photo ? 'text-white drop-shadow-lg' : ''}`}>{employee.display_name}</h2>
                  <p className={`text-sm mb-2 truncate ${employee.photo ? 'text-white/90 drop-shadow-md' : 'text-gray-600'}`}>{employee.email}</p>
                  
                  {/* Mobile Contact Info - Compact */}
                  {(employee.phone || employee.mobile || employee.phone_ext) && (
                    <div className="flex items-center gap-3 text-xs">
                      {employee.phone && (
                        <div className={`flex items-center gap-1 ${employee.photo ? 'text-white/90' : 'text-gray-700'}`}>
                          <PhoneIcon className={`w-3 h-3 ${employee.photo ? 'text-white/80' : 'text-gray-500'}`} />
                          <span>{employee.phone}</span>
                        </div>
                      )}
                      {employee.mobile && (
                        <div className={`flex items-center gap-1 ${employee.photo ? 'text-white/90' : 'text-gray-700'}`}>
                          <DevicePhoneMobileIcon className={`w-3 h-3 ${employee.photo ? 'text-white/80' : 'text-gray-500'}`} />
                          <span>{employee.mobile}</span>
                        </div>
                      )}
                      {employee.phone_ext && (
                        <div className={`flex items-center gap-1 ${employee.photo ? 'text-white/90' : 'text-gray-700'}`}>
                          <span className={`text-xs ${employee.photo ? 'text-white/70' : 'text-gray-500'}`}>Ext:</span>
                          <span>{employee.phone_ext}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  className={`btn btn-md btn-circle flex-shrink-0 ${employee.photo ? 'btn-ghost text-white hover:bg-white/20' : 'btn-ghost'}`}
                  onClick={() => {
                    setIsEditingBackground(true);
                    setNewBackgroundUrl(employee.photo || '');
                  }}
                  title="Edit background image"
                >
                  <PencilIcon className="w-5 h-5" />
                </button>
                <button 
                  className={`btn btn-md btn-circle flex-shrink-0 ${employee.photo ? 'btn-ghost text-white hover:bg-white/20' : 'btn-ghost'}`}
                  onClick={onClose}
                >
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>
            </div>
            
            {/* Mobile Badges */}
            <div className="flex items-center gap-2 justify-center">
              <div className="flex flex-col items-center">
                <span className={`text-xs uppercase tracking-wide mb-1 ${employee.photo ? 'text-white/80 drop-shadow-md' : 'text-gray-500'}`}>Role</span>
                <span className="badge badge-primary badge-md px-3 py-2 w-fit whitespace-nowrap bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-0 text-sm leading-tight shadow-lg">
                  {getRoleDisplayName(employee.bonuses_role)}
                </span>
              </div>
              <div className="flex flex-col items-center">
                <span className={`text-xs uppercase tracking-wide mb-1 ${employee.photo ? 'text-white/80 drop-shadow-md' : 'text-gray-500'}`}>Department</span>
                <span className={`badge badge-md px-3 py-2 w-fit whitespace-nowrap text-sm leading-tight shadow-lg ${employee.photo ? 'bg-white/20 text-white border-white/30 backdrop-blur-sm' : 'badge-outline'}`}>{employee.department}</span>
              </div>
            </div>
          </div>

          {/* Desktop Layout */}
          <div className="hidden sm:block">
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-start gap-6 flex-1">
              <div className="avatar">
                {employee.photo_url ? (
                  <div className="rounded-full w-32 sm:w-40">
                    <img 
                      src={employee.photo_url} 
                      alt={employee.display_name}
                      className="w-full h-full object-cover rounded-full"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        const parent = target.parentElement;
                        if (parent) {
                          parent.innerHTML = `
                            <div class="bg-primary text-primary-content rounded-full w-32 sm:w-40 h-32 sm:h-40 flex items-center justify-center">
                              <span class="text-3xl sm:text-4xl font-bold">${getInitials(employee.display_name)}</span>
                            </div>
                          `;
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div className="placeholder">
                    <div className="bg-primary text-primary-content rounded-full w-32 sm:w-40 h-32 sm:h-40 flex items-center justify-center">
                      <span className="text-3xl sm:text-4xl font-bold">
                        {getInitials(employee.display_name)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Column - Name, Email & Contact */}
                <div className="lg:col-span-1">
                  <h2 className={`text-3xl font-bold mb-2 ${employee.photo ? 'text-white drop-shadow-lg' : ''}`}>{employee.display_name}</h2>
                  <p className={`text-lg mb-3 ${employee.photo ? 'text-white/90 drop-shadow-md' : 'text-gray-600'}`}>{employee.email}</p>
                  
                  {/* Desktop Contact Information - Horizontal */}
                  {(employee.phone || employee.mobile || employee.phone_ext) && (
                    <div className="flex items-center gap-6">
                      {employee.phone && (
                        <div className={`flex items-center gap-2 ${employee.photo ? 'text-white/90' : 'text-gray-700'}`}>
                          <PhoneIcon className={`w-5 h-5 ${employee.photo ? 'text-white/80' : 'text-gray-500'}`} />
                          <span className="text-base">{employee.phone}</span>
                        </div>
                      )}
                      {employee.mobile && (
                        <div className={`flex items-center gap-2 ${employee.photo ? 'text-white/90' : 'text-gray-700'}`}>
                          <DevicePhoneMobileIcon className={`w-5 h-5 ${employee.photo ? 'text-white/80' : 'text-gray-500'}`} />
                          <span className="text-base">{employee.mobile}</span>
                        </div>
                      )}
                      {employee.phone_ext && (
                        <div className={`flex items-center gap-2 ${employee.photo ? 'text-white/90' : 'text-gray-700'}`}>
                          <PhoneIcon className={`w-5 h-5 ${employee.photo ? 'text-white/80' : 'text-gray-500'}`} />
                          <span className={`text-sm ${employee.photo ? 'text-white/70' : 'text-gray-500'}`}>Ext:</span>
                          <span className="text-base">{employee.phone_ext}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                
                {/* Right Column - Role & Department */}
                <div className="lg:col-span-1">
                  <div className="flex items-center gap-2 sm:gap-6">
                    <div className="flex flex-col">
                      <span className={`text-xs sm:text-sm uppercase tracking-wide mb-1 sm:mb-2 ${employee.photo ? 'text-white/80 drop-shadow-md' : 'text-gray-500'}`}>Role</span>
                      <span className="badge badge-primary badge-md sm:badge-xl px-3 py-2 sm:px-4 sm:py-3 w-fit whitespace-nowrap bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-0 text-sm sm:text-lg leading-tight shadow-lg">
                        {getRoleDisplayName(employee.bonuses_role)}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className={`text-xs sm:text-sm uppercase tracking-wide mb-1 sm:mb-2 ${employee.photo ? 'text-white/80 drop-shadow-md' : 'text-gray-500'}`}>Department</span>
                      <span className={`badge badge-md sm:badge-xl px-3 py-2 sm:px-4 sm:py-3 w-fit whitespace-nowrap text-sm sm:text-lg leading-tight shadow-lg ${employee.photo ? 'bg-white/20 text-white border-white/30 backdrop-blur-sm' : 'badge-outline'}`}>{employee.department}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button 
                className={`btn btn-md btn-circle ${employee.photo ? 'btn-ghost text-white hover:bg-white/20' : 'btn-ghost'}`}
                onClick={() => {
                  setIsEditingBackground(true);
                  setNewBackgroundUrl(employee.photo || '');
                }}
                title="Edit background image"
              >
                <PencilIcon className="w-5 h-5" />
              </button>
              <button 
                className={`btn btn-md btn-circle ${employee.photo ? 'btn-ghost text-white hover:bg-white/20' : 'btn-ghost'}`}
                onClick={onClose}
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
          </div>
          </div>
          </div>
        </div>

        {/* Background Image Edit Modal */}
        {isEditingBackground && (
          <div className="modal modal-open">
            <div className="modal-box max-w-lg w-[95vw] max-h-[90vh] overflow-y-auto mx-auto">
              <h3 className="font-bold text-lg mb-4">Edit Background Image</h3>
              
              {/* Drag and Drop Area */}
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  isDragging 
                    ? 'border-primary bg-primary/10' 
                    : 'border-gray-300 hover:border-gray-400'
                } ${uploadingImage ? 'opacity-50 pointer-events-none' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleFileDrop}
              >
                {uploadingImage ? (
                  <div className="flex flex-col items-center">
                    <span className="loading loading-spinner loading-lg mb-2"></span>
                    <p className="text-sm text-gray-600">Uploading image...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <svg className="w-12 h-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-lg font-medium text-gray-700 mb-2">
                      {isDragging ? 'Drop your image here' : 'Drag & drop an image here'}
                    </p>
                    <p className="text-sm text-gray-500 mb-4">or</p>
                    <label className="btn btn-primary btn-sm cursor-pointer">
                      Choose File
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFileInputChange}
                      />
                    </label>
                    <p className="text-xs text-gray-400 mt-2">Supports JPG, JPEG, PNG, GIF, WebP</p>
                  </div>
                )}
              </div>

              
              {/* Preview */}
              {newBackgroundUrl && (
                <div className="mt-4">
                  <label className="label">
                    <span className="label-text">Preview</span>
                  </label>
                  <div className="w-full h-40 bg-gray-200 rounded-lg overflow-hidden border">
                    <img
                      src={newBackgroundUrl}
                      alt="Background preview"
                      className="w-full h-full object-cover"
                      onLoad={(e) => {
                        console.log('✅ Image loaded successfully:', newBackgroundUrl);
                      }}
                      onError={(e) => {
                        console.error('❌ Image failed to load:', newBackgroundUrl);
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        const parent = target.parentElement;
                        if (parent) {
                          parent.innerHTML = `
                            <div class="flex flex-col items-center justify-center h-full text-gray-500 p-4">
                              <div class="text-sm font-medium mb-2">Image uploaded but preview failed</div>
                              <div class="text-xs text-center break-all mb-2">${newBackgroundUrl}</div>
                              <div class="text-xs text-green-600 mb-2">✅ File uploaded successfully to Supabase</div>
                              <div class="text-xs text-gray-400">Click "Update Background" to apply</div>
                            </div>
                          `;
                        }
                      }}
                    />
                  </div>
                  <div className="text-xs text-gray-400 mt-1 break-all">
                    URL: {newBackgroundUrl}
                  </div>
                </div>
              )}
              
              <div className="modal-action flex flex-col sm:flex-row justify-start gap-2 mt-6 px-0">
                <button
                  className="btn btn-ghost w-full sm:w-auto"
                  onClick={() => {
                    setIsEditingBackground(false);
                    setNewBackgroundUrl('');
                  }}
                  disabled={uploadingImage}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary w-full sm:w-auto"
                  onClick={handleBackgroundImageUpdate}
                  disabled={!newBackgroundUrl.trim() || uploadingImage}
                >
                  {uploadingImage ? (
                    <>
                      <span className="loading loading-spinner loading-sm"></span>
                      Updating...
                    </>
                  ) : (
                    'Update Background'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Date Filters */}
        <div className="mb-6">
          {/* Mobile Layout */}
          <div className="sm:hidden">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <label className="text-sm font-medium text-base-content/70">From:</label>
                <input
                  type="date"
                  className="input input-bordered input-sm w-32"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  placeholder="Start date"
                />
              </div>
              <div className="flex items-center gap-1">
                <label className="text-sm font-medium text-base-content/70">To:</label>
                <input
                  type="date"
                  className="input input-bordered input-sm w-32"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  placeholder="End date"
                />
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleApplyDateFilter}
                disabled={isApplyingFilter}
                title="Apply date filter"
              >
                {isApplyingFilter ? 'Applying...' : 'Apply'}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleClearDateFilter}
                title="Clear filters and show last 30 days"
              >
                Clear
              </button>
            </div>
          </div>
          
          {/* Desktop Layout */}
          <div className="hidden sm:flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-base-content/70">From:</label>
              <input
                type="date"
                className="input input-bordered input-sm w-auto"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                placeholder="Start date"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-base-content/70">To:</label>
              <input
                type="date"
                className="input input-bordered input-sm w-auto"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                placeholder="End date"
              />
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleApplyDateFilter}
              disabled={isApplyingFilter}
              title="Apply date filter"
            >
              {isApplyingFilter ? 'Applying...' : 'Apply'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleClearDateFilter}
              title="Clear filters and show last 30 days"
            >
              Clear
            </button>
          </div>
          
          {/* Active Filter Badge */}
          {(appliedFromDate || appliedToDate) && (
            <div className="mt-3">
              <span className="badge badge-primary badge-sm">
                Filtered: {appliedFromDate || 'All time'} to {appliedToDate || 'Today'}
              </span>
            </div>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="mb-6">
          <div className="flex border-b border-base-300 overflow-x-auto">
            <button
              className={`flex-shrink-0 px-4 sm:px-6 py-3 font-medium text-sm sm:text-base border-b-2 transition-colors ${
                activeTab === 'overview'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-base-content/70 hover:text-base-content'
              }`}
              onClick={() => setActiveTab('overview')}
            >
              Overview
            </button>
            <button
              className={`flex-shrink-0 px-4 sm:px-6 py-3 font-medium text-sm sm:text-base border-b-2 transition-colors ${
                activeTab === 'availability'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-base-content/70 hover:text-base-content'
              }`}
              onClick={() => setActiveTab('availability')}
            >
              Availability
            </button>
            <button
              className={`flex-shrink-0 px-4 sm:px-6 py-3 font-medium text-sm sm:text-base border-b-2 transition-colors ${
                activeTab === 'tasks'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-base-content/70 hover:text-base-content'
              }`}
              onClick={() => setActiveTab('tasks')}
            >
              Tasks & Projects
            </button>
            <button
              className={`flex-shrink-0 px-4 sm:px-6 py-3 font-medium text-sm sm:text-base border-b-2 transition-colors ${
                activeTab === 'clients'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-base-content/70 hover:text-base-content'
              }`}
              onClick={() => setActiveTab('clients')}
            >
              Client Cases
            </button>
            <button
              className={`flex-shrink-0 px-4 sm:px-6 py-3 font-medium text-sm sm:text-base border-b-2 transition-colors ${
                activeTab === 'feedback'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-base-content/70 hover:text-base-content'
              }`}
              onClick={() => setActiveTab('feedback')}
            >
              Feedback & Reviews
            </button>
            <button
              className={`flex-shrink-0 px-4 sm:px-6 py-3 font-medium text-sm sm:text-base border-b-2 transition-colors ${
                activeTab === 'salary'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-base-content/70 hover:text-base-content'
              }`}
              onClick={() => setActiveTab('salary')}
            >
              Salary
            </button>
            <button
              className={`flex-shrink-0 px-4 sm:px-6 py-3 font-medium text-sm sm:text-base border-b-2 transition-colors ${
                activeTab === 'bonus'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-base-content/70 hover:text-base-content'
              }`}
              onClick={() => setActiveTab('bonus')}
            >
              Bonus
            </button>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <>
        {/* Role-Specific Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {getRoleSpecificStats()}
        </div>

        {/* Performance Charts Section - 50/50 Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Expert Performance Chart, Closer Performance Chart, or Completion Rate Chart */}
          {employee.bonuses_role?.toLowerCase() === 'e' && performanceData?.expertMetrics ? (
            <div className="card bg-base-100 shadow-sm mb-4 sm:mb-6">
              <div className="card-body p-3 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Expert Performance Trend</h2>
                </div>
                <div className="h-80 w-full">
                  <ExpertPerformanceChart expertData={performanceData.expertMetrics} dateRange={performanceData.dateRange} />
                </div>
              </div>
            </div>
          ) : employee.bonuses_role?.toLowerCase() === 'c' && performanceData?.closerMetrics ? (
            <div className="card bg-base-100 shadow-sm mb-4 sm:mb-6">
              <div className="card-body p-3 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Closer Performance Trend</h2>
                </div>
                <div className="h-80 w-full">
                  <CloserPerformanceChart closerData={performanceData.closerMetrics} dateRange={performanceData.dateRange} />
                </div>
              </div>
            </div>
          ) : (
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body">
                <h3 className="card-title flex items-center gap-2">
                  <ChartBarIcon className="w-5 h-5" />
                  Completion Rate
                </h3>
                <div className="flex items-center justify-center h-80">
                  <div className="radial-progress text-primary" style={{"--value": completionRate} as React.CSSProperties} role="progressbar">
                    <span className="text-lg font-bold">{completionRate}%</span>
                  </div>
                </div>
                <div className="text-center text-sm text-gray-600">
                  {metrics.completed_meetings} of {metrics.total_meetings} meetings completed
                </div>
              </div>
            </div>
          )}

          {/* Revenue Trend */}
          <div className="card bg-base-100 shadow-sm">
            <div className="card-body">
              <h3 className="card-title flex items-center gap-2">
                <CurrencyDollarIcon className="w-5 h-5" />
                Revenue Performance
              </h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm">Total Revenue</span>
                  <span className="font-semibold">{formatCurrency(metrics.total_revenue || 0)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Avg per Meeting</span>
                  <span className="font-semibold">{formatCurrency(averageRevenuePerMeeting)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Completed Meetings</span>
                  <span className="font-semibold text-success">{metrics.completed_meetings}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Interactive Graphs Section */}
        {/* Revenue Graph */}
        {showRevenueGraph && (
          <div className="card bg-base-100 shadow-sm mb-4 sm:mb-6">
            <div className="card-body p-3 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Monthly Revenue Trend</h2>
                
                {/* Graph Controls (Year, From Month, To Month) */}
                <div className="flex flex-col sm:flex-row gap-3">
                  {/* Year Selector */}
                  <select 
                    className="select select-bordered select-sm w-full sm:w-24"
                    value={graphYear}
                    onChange={(e) => setGraphYear(parseInt(e.target.value))}
                  >
                    {Array.from({ length: 5 }, (_, i) => {
                      const year = new Date().getFullYear() - 2 + i;
                      return <option key={year} value={year}>{year}</option>;
                    })}
                  </select>
                  
                  {/* From Month Selector */}
                  <select 
                    className="select select-bordered select-sm w-full sm:w-32"
                    value={graphStartMonth}
                    onChange={(e) => setGraphStartMonth(parseInt(e.target.value))}
                  >
                    {Array.from({ length: 12 }, (_, i) => {
                      const month = i + 1;
                      const monthName = new Date(2024, i).toLocaleDateString('en-US', { month: 'short' });
                      return <option key={month} value={month}>{monthName}</option>;
                    })}
                  </select>
                  
                  {/* To Month Selector */}
                  <select 
                    className="select select-bordered select-sm w-full sm:w-32"
                    value={graphEndMonth}
                    onChange={(e) => setGraphEndMonth(parseInt(e.target.value))}
                  >
                    {Array.from({ length: 12 }, (_, i) => {
                      const month = i + 1;
                      const monthName = new Date(2024, i).toLocaleDateString('en-US', { month: 'short' });
                      return <option key={month} value={month}>{monthName}</option>;
                    })}
                  </select>
                </div>
              </div>

              {/* Revenue Line Chart */}
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
                        tickFormatter={(value) => value.toLocaleString()}
                      />
                      <Tooltip 
                        contentStyle={{
                          backgroundColor: '#1f2937',
                          border: 'none',
                          borderRadius: '8px',
                          color: '#f9fafb'
                        }}
                        itemStyle={{ color: '#f9fafb' }}
                        formatter={(value, name) => {
                          if (name === 'revenue') {
                            return [`₪${Number(value).toLocaleString()}`, 'Revenue'];
                          }
                          return [value, name];
                        }}
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
                <div className="flex justify-center mt-6 pt-4 border-t border-gray-200">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-800">
                      ₪{revenueGraphData.reduce((sum, item) => sum + item.revenue, 0).toLocaleString()}
                    </div>
                    <div className="text-sm text-gray-600">Total Revenue</div>
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
                
                {/* Graph Controls (Year, From Month, To Month) */}
                <div className="flex flex-col sm:flex-row gap-3">
                  {/* Year Selector */}
                  <select 
                    className="select select-bordered select-sm w-full sm:w-24"
                    value={graphYear}
                    onChange={(e) => setGraphYear(parseInt(e.target.value))}
                  >
                    {Array.from({ length: 5 }, (_, i) => {
                      const year = new Date().getFullYear() - 2 + i;
                      return <option key={year} value={year}>{year}</option>;
                    })}
                  </select>
                  
                  {/* From Month Selector */}
                  <select 
                    className="select select-bordered select-sm w-full sm:w-32"
                    value={graphStartMonth}
                    onChange={(e) => setGraphStartMonth(parseInt(e.target.value))}
                  >
                    {Array.from({ length: 12 }, (_, i) => {
                      const month = i + 1;
                      const monthName = new Date(2024, i).toLocaleDateString('en-US', { month: 'short' });
                      return <option key={month} value={month}>{monthName}</option>;
                    })}
                  </select>
                  
                  {/* To Month Selector */}
                  <select 
                    className="select select-bordered select-sm w-full sm:w-32"
                    value={graphEndMonth}
                    onChange={(e) => setGraphEndMonth(parseInt(e.target.value))}
                  >
                    {Array.from({ length: 12 }, (_, i) => {
                      const month = i + 1;
                      const monthName = new Date(2024, i).toLocaleDateString('en-US', { month: 'short' });
                      return <option key={month} value={month}>{monthName}</option>;
                    })}
                  </select>
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
                
                {/* Graph Controls (Year, From Month, To Month) */}
                <div className="flex flex-col sm:flex-row gap-3">
                  {/* Year Selector */}
                  <select 
                    className="select select-bordered select-sm w-full sm:w-24"
                    value={graphYear}
                    onChange={(e) => setGraphYear(parseInt(e.target.value))}
                  >
                    {Array.from({ length: 5 }, (_, i) => {
                      const year = new Date().getFullYear() - 2 + i;
                      return <option key={year} value={year}>{year}</option>;
                    })}
                  </select>
                  
                  {/* From Month Selector */}
                  <select 
                    className="select select-bordered select-sm w-full sm:w-32"
                    value={graphStartMonth}
                    onChange={(e) => setGraphStartMonth(parseInt(e.target.value))}
                  >
                    {Array.from({ length: 12 }, (_, i) => {
                      const month = i + 1;
                      const monthName = new Date(2024, i).toLocaleDateString('en-US', { month: 'short' });
                      return <option key={month} value={month}>{monthName}</option>;
                    })}
                  </select>
                  
                  {/* To Month Selector */}
                  <select 
                    className="select select-bordered select-sm w-full sm:w-32"
                    value={graphEndMonth}
                    onChange={(e) => setGraphEndMonth(parseInt(e.target.value))}
                  >
                    {Array.from({ length: 12 }, (_, i) => {
                      const month = i + 1;
                      const monthName = new Date(2024, i).toLocaleDateString('en-US', { month: 'short' });
                      return <option key={month} value={month}>{monthName}</option>;
                    })}
                  </select>
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6 pt-4 border-t border-gray-200">
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
                </div>
              )}
            </div>
          </div>
        )}

        {/* Current Employee Role Performance Table */}
        <div className="card bg-base-100 shadow-sm mb-6 mt-6">
          <div className="card-body">
            <h3 className="card-title flex items-center gap-2">
              <ChartBarIcon className="w-5 h-5" />
              {employee.display_name}'s {getRoleDisplayName(employee.bonuses_role)} Performance
              {performanceData && (
                <span className="text-sm font-normal text-gray-500 ml-2">
                  ({performanceData.dateRange.from ? `${performanceData.dateRange.from} to ${performanceData.dateRange.to}` : 'Last 30 days'})
                </span>
              )}
            </h3>
            
            {loadingPerformance ? (
              <div className="flex justify-center items-center py-8">
                <span className="loading loading-spinner loading-lg"></span>
                <span className="ml-3">Loading performance data...</span>
              </div>
            ) : performanceError ? (
              <div className="alert alert-error">
                <span>Error loading performance data: {performanceError}</span>
              </div>
            ) : performanceData ? (
              <div className="overflow-x-auto">
                <table className="table table-zebra w-full text-base">
                  <thead>
                    <tr>
                      {getRoleTableHeaders(employee.bonuses_role || '').map((header, index) => (
                        <th key={index} className="font-semibold text-base">{header}</th>
                      ))}
                      <th className="font-semibold text-base">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {getRoleTableData(employee, performanceData).map((data, index) => (
                        <td key={index} className="font-medium">{data}</td>
                      ))}
                      <td>
                        <button
                          onClick={() => handleRoleClick(employee.bonuses_role || '')}
                          className="btn btn-sm btn-circle btn-ghost hover:btn-primary"
                          title={`View ${getRoleDisplayName(employee.bonuses_role)} leads`}
                        >
                          <EyeIcon className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-500">No performance data available</p>
              </div>
            )}
          </div>
        </div>

        {/* Employee's Performance Across All Roles */}
        <div className="card bg-base-100 shadow-sm mb-6">
          <div className="card-body">
            <h3 className="card-title flex items-center gap-2">
              <ChartBarIcon className="w-5 h-5" />
              {employee.display_name}'s Performance Across All Roles
              {performanceData && (
                <span className="text-sm font-normal text-gray-500 ml-2">
                  ({performanceData.dateRange.from ? `${performanceData.dateRange.from} to ${performanceData.dateRange.to}` : 'Last 30 days'})
                </span>
              )}
            </h3>
            <p className="text-sm text-gray-600 mb-4">Performance metrics for {employee.display_name} across all roles performed during the selected period</p>
            
            {loadingPerformance ? (
              <div className="flex justify-center items-center py-8">
                <span className="loading loading-spinner loading-lg"></span>
                <span className="ml-3">Loading performance data...</span>
              </div>
            ) : performanceError ? (
              <div className="alert alert-error">
                <span>Error loading performance data: {performanceError}</span>
              </div>
            ) : performanceData ? (
              <div className="overflow-x-auto">
                <table className="table table-zebra w-full text-base">
                   <thead>
                     <tr>
                       <th className="font-semibold w-32 text-base">Role</th>
                       <th className="font-semibold w-32 text-base">Cases</th>
                       <th className="font-semibold w-32 text-base">Applicants</th>
                       <th className="font-semibold w-32 text-base">Signed Contracts</th>
                       <th className="font-semibold w-32 text-base">Expert Examinations</th>
                       <th className="font-semibold w-32 text-base">Meetings Total</th>
                       <th className="font-semibold w-32 text-base">Successful Meetings</th>
                       <th className="font-semibold w-32 text-base">Signed Total</th>
                       <th className="font-semibold w-32 text-base">Total Due</th>
                       <th className="font-semibold w-32 text-base">Actions</th>
                     </tr>
                   </thead>
                <tbody>
                   {/* Handler Role Performance - Only show if not primary role */}
                   {employee.bonuses_role?.toLowerCase() !== 'h' && (
                     <tr>
                       <td className="font-medium text-black">Handler</td>
                       <td>{performanceData.roleMetrics.handler.cases}</td>
                       <td>{performanceData.roleMetrics.handler.applicants}</td>
                       <td>{performanceData.roleMetrics.handler.signed}</td>
                       <td>-</td>
                       <td>-</td>
                       <td>-</td>
                       <td>{formatCurrency(performanceData.roleMetrics.handler.total)}</td>
                       <td>{formatCurrency(performanceData.roleMetrics.handler.invoiced)}</td>
                       <td>
                         <button
                           onClick={() => handleRoleClick('handler')}
                           className="btn btn-sm btn-circle btn-ghost hover:btn-primary"
                           title="View Handler leads"
                         >
                           <EyeIcon className="w-4 h-4" />
                         </button>
                       </td>
                     </tr>
                   )}

                   {/* Closer Role Performance - Only show if not primary role */}
                   {employee.bonuses_role?.toLowerCase() !== 'c' && (
                     <tr>
                       <td className="font-medium text-black">Closer</td>
                       <td>-</td>
                       <td>-</td>
                       <td>{performanceData.roleMetrics.closer.signed}</td>
                       <td>-</td>
                       <td>-</td>
                       <td>-</td>
                       <td>{formatCurrency(performanceData.roleMetrics.closer.total)}</td>
                       <td>{formatCurrency(performanceData.roleMetrics.closer.invoiced)}</td>
                       <td>
                         <button
                           onClick={() => handleRoleClick('closer')}
                           className="btn btn-sm btn-circle btn-ghost hover:btn-primary"
                           title="View Closer leads"
                         >
                           <EyeIcon className="w-4 h-4" />
                         </button>
                       </td>
                     </tr>
                   )}

                   {/* Expert Role Performance - Only show if not primary role */}
                   {employee.bonuses_role?.toLowerCase() !== 'e' && (
                     <tr>
                       <td className="font-medium text-black">Expert</td>
                       <td>-</td>
                       <td>-</td>
                       <td>-</td>
                       <td>{performanceData.roleMetrics.expert.signed}</td>
                       <td>-</td>
                       <td>-</td>
                       <td>{formatCurrency(performanceData.roleMetrics.expert.total)}</td>
                       <td>-</td>
                       <td>
                         <button
                           onClick={() => handleRoleClick('expert')}
                           className="btn btn-sm btn-circle btn-ghost hover:btn-primary"
                           title="View Expert leads"
                         >
                           <EyeIcon className="w-4 h-4" />
                         </button>
                       </td>
                     </tr>
                   )}

                   {/* Scheduler Role Performance - Only show if not primary role */}
                   {employee.bonuses_role?.toLowerCase() !== 's' && (
                     <tr>
                       <td className="font-medium text-black">Scheduler</td>
                       <td>-</td>
                       <td>-</td>
                       <td>-</td>
                       <td>-</td>
                       <td>{performanceData.roleMetrics.scheduler.signed}</td>
                       <td>-</td>
                       <td>{formatCurrency(performanceData.roleMetrics.scheduler.total)}</td>
                       <td>{formatCurrency(performanceData.roleMetrics.scheduler.invoiced)}</td>
                       <td>
                         <button
                           onClick={() => handleRoleClick('scheduler')}
                           className="btn btn-sm btn-circle btn-ghost hover:btn-primary"
                           title="View Scheduler leads"
                         >
                           <EyeIcon className="w-4 h-4" />
                         </button>
                       </td>
                     </tr>
                   )}

                   {/* Manager Role Performance - Only show if not primary role */}
                   {(employee.bonuses_role?.toLowerCase() !== 'z' && employee.bonuses_role?.toLowerCase() !== 'Z') && (
                     <tr>
                       <td className="font-medium text-black">Manager</td>
                       <td>-</td>
                       <td>-</td>
                       <td>-</td>
                       <td>-</td>
                       <td>-</td>
                       <td>{performanceData.roleMetrics.manager.signed}</td>
                       <td>{formatCurrency(performanceData.roleMetrics.manager.total)}</td>
                       <td>{formatCurrency(performanceData.roleMetrics.manager.invoiced)}</td>
                       <td>
                         <button
                           onClick={() => handleRoleClick('manager')}
                           className="btn btn-sm btn-circle btn-ghost hover:btn-primary"
                           title="View Manager leads"
                         >
                           <EyeIcon className="w-4 h-4" />
                         </button>
                       </td>
                     </tr>
                   )}

                   {/* Helper Closer Role Performance - Only show if not primary role */}
                   {employee.bonuses_role?.toLowerCase() !== 'helper-closer' && (
                     <tr>
                       <td className="font-medium text-black">Helper Closer</td>
                       <td>-</td>
                       <td>-</td>
                       <td>{performanceData.roleMetrics.helper_closer.signed}</td>
                       <td>-</td>
                       <td>-</td>
                       <td>-</td>
                       <td>{formatCurrency(performanceData.roleMetrics.helper_closer.total)}</td>
                       <td>{formatCurrency(performanceData.roleMetrics.helper_closer.invoiced)}</td>
                       <td>
                         <button
                           onClick={() => handleRoleClick('helper-closer')}
                           className="btn btn-sm btn-circle btn-ghost hover:btn-primary"
                           title="View Helper Closer leads"
                         >
                           <EyeIcon className="w-4 h-4" />
                         </button>
                       </td>
                     </tr>
                   )}

                  {/* Show message if no additional roles */}
                  {[
                    employee.bonuses_role?.toLowerCase() !== 'h',
                    employee.bonuses_role?.toLowerCase() !== 'c',
                    employee.bonuses_role?.toLowerCase() !== 'e',
                    employee.bonuses_role?.toLowerCase() !== 's',
                    (employee.bonuses_role?.toLowerCase() !== 'z' && employee.bonuses_role?.toLowerCase() !== 'Z'),
                    employee.bonuses_role?.toLowerCase() !== 'helper-closer'
                  ].every(condition => !condition) && (
                    <tr>
                      <td colSpan={10} className="text-center text-gray-500 py-8">
                        No additional roles performed in the selected period
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-500">No performance data available</p>
              </div>
            )}
          </div>
        </div>

        {/* Activity Timeline */}
        <div className="card bg-base-100 shadow-sm">
          <div className="card-body">
            <h3 className="card-title flex items-center gap-2">
              <ClockIcon className="w-5 h-5" />
              Recent Activity
            </h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
                <div className="w-2 h-2 bg-primary rounded-full"></div>
                <div className="flex-1">
                  <div className="font-medium">Last Activity</div>
                  <div className="text-sm text-gray-600">{formatDate(metrics.last_activity || 'No activity')}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
                <div className="w-2 h-2 bg-success rounded-full"></div>
                <div className="flex-1">
                  <div className="font-medium">Completion Rate</div>
                  <div className="text-sm text-gray-600">{completionRate}% of meetings completed</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
                <div className="w-2 h-2 bg-warning rounded-full"></div>
                <div className="flex-1">
                  <div className="font-medium">Revenue Generated</div>
                  <div className="text-sm text-gray-600">{formatCurrency(metrics.total_revenue || 0)} total</div>
                </div>
              </div>
            </div>
          </div>
        </div>
          </>
        )}

        {/* Availability Tab */}
        {activeTab === 'availability' && (
          <div className="space-y-6">
            {loadingAvailability ? (
              <div className="flex justify-center items-center py-8">
                <span className="loading loading-spinner loading-lg"></span>
                <span className="ml-3">Loading availability data...</span>
              </div>
            ) : (
              <>
                {/* Current Week Meetings */}
                <div className="card bg-base-100 shadow-sm">
                  <div className="card-body">
                    <h3 className="card-title">Current Week Meetings</h3>
                    <p className="text-sm text-gray-600 mb-4">Client meetings scheduled for {employee.display_name} this week</p>
                    
                    {currentWeekMeetings.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-gray-500">No meetings scheduled for this week</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="table table-zebra w-full text-base">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Time</th>
                              <th>Client</th>
                              <th>Role</th>
                              <th>Location</th>
                              <th>Language</th>
                              <th>Category</th>
                              <th>Balance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {currentWeekMeetings.map((meeting, index) => (
                              <tr key={meeting.id || index}>
                                <td className="font-medium">
                                  {new Date(meeting.meeting_date).toLocaleDateString('en-US', {
                                    weekday: 'short',
                                    month: 'short',
                                    day: 'numeric'
                                  })}
                                </td>
                                <td className="text-sm">
                                  {meeting.meeting_time ? meeting.meeting_time.slice(0, 5) : 'No time'}
                                </td>
                                <td className="text-sm">
                                  <div className="font-medium">
                                    {meeting.lead_number} - {meeting.client_name}
                                  </div>
                                </td>
                                <td className="text-sm text-black">
                                  {meeting.role_in_meeting}
                                </td>
                                <td className="text-sm">
                                  {meeting.meeting_location}
                                </td>
                                <td className="text-sm text-black">
                                  {meeting.language && meeting.language !== 'N/A' ? meeting.language : 'N/A'}
                                </td>
                                <td className="text-sm text-black">
                                  {meeting.category && meeting.category !== 'N/A' ? meeting.category : 'N/A'}
                                </td>
                                <td className="text-sm font-semibold text-black">
                                  {meeting.balance && meeting.balance > 0 
                                    ? `${getCurrencySymbol(meeting.balance_currency)}${meeting.balance.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                                    : '₪0'
                                  }
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>

                {/* Unavailable Times */}
                <div className="card bg-base-100 shadow-sm">
                  <div className="card-body">
                    <h3 className="card-title">Unavailable Times</h3>
                    <p className="text-sm text-gray-600 mb-4">Specific time blocks when {employee.display_name} is unavailable</p>
                    
                    {unavailableTimes.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-gray-500">No unavailability records found</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="table table-zebra w-full text-base">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Time</th>
                              <th>Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {unavailableTimes
                              .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                              .map((time, index) => (
                                <tr key={index}>
                                  <td className="font-medium">
                                    {new Date(time.date).toLocaleDateString('en-US', {
                                      weekday: 'short',
                                      year: 'numeric',
                                      month: 'short',
                                      day: 'numeric'
                                    })}
                                  </td>
                                  <td className="text-sm">
                                    {time.startTime} - {time.endTime}
                                  </td>
                                  <td className="text-sm">
                                    {time.reason || 'No reason provided'}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>

                {/* Unavailable Ranges */}
                <div className="card bg-base-100 shadow-sm">
                  <div className="card-body">
                    <h3 className="card-title">Unavailable Date Ranges</h3>
                    <p className="text-sm text-gray-600 mb-4">Extended periods when {employee.display_name} is unavailable</p>
                    
                    {unavailableRanges.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-gray-500">No unavailability records found</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="table table-zebra w-full text-base">
                          <thead>
                            <tr>
                              <th>Start Date</th>
                              <th>End Date</th>
                              <th>Duration</th>
                              <th>Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {unavailableRanges
                              .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
                              .map((range, index) => {
                                const startDate = new Date(range.startDate);
                                const endDate = new Date(range.endDate);
                                const durationDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                                
                                return (
                                  <tr key={index}>
                                    <td className="font-medium">
                                      {startDate.toLocaleDateString('en-US', {
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric'
                                      })}
                                    </td>
                                    <td className="font-medium">
                                      {endDate.toLocaleDateString('en-US', {
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric'
                                      })}
                                    </td>
                                    <td className="text-sm">
                                      {durationDays} day{durationDays !== 1 ? 's' : ''}
                                    </td>
                                    <td className="text-sm">
                                      {range.reason || 'No reason provided'}
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>

                {/* Summary */}
                <div className="card bg-base-100 shadow-sm">
                  <div className="card-body">
                    <h3 className="card-title">Availability Summary</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="stat bg-white rounded-lg shadow-sm">
                        <div className="stat-title">This Week's Meetings</div>
                        <div className="stat-value text-primary">{currentWeekMeetings.length}</div>
                        <div className="stat-desc text-base">Scheduled meetings</div>
                      </div>
                      
                      <div className="stat bg-white rounded-lg shadow-sm">
                        <div className="stat-title">Unavailable Times</div>
                        <div className="stat-value text-warning">{unavailableTimes.length}</div>
                        <div className="stat-desc text-base">Time blocks</div>
                      </div>
                      
                      <div className="stat bg-white rounded-lg shadow-sm">
                        <div className="stat-title">Unavailable Ranges</div>
                        <div className="stat-value text-secondary">{unavailableRanges.length}</div>
                        <div className="stat-desc text-base">Extended periods</div>
                      </div>
                      
                      <div className="stat bg-white rounded-lg shadow-sm">
                        <div className="stat-title">Total Days Off</div>
                        <div className="stat-value text-accent">
                          {unavailableRanges.reduce((total, range) => {
                            const startDate = new Date(range.startDate);
                            const endDate = new Date(range.endDate);
                            const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                            return total + days;
                          }, 0)}
                        </div>
                        <div className="stat-desc text-base">Days in ranges</div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Tasks & Projects Tab */}
        {activeTab === 'tasks' && (
          <div className="space-y-6">
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body">
                <h3 className="card-title">Tasks & Projects</h3>
                <p className="text-sm text-gray-600 mb-4">Active tasks and project involvement for {employee.display_name}</p>
                
                <div className="space-y-6">
                  <div>
                    <h4 className="font-semibold mb-3">Active Tasks</h4>
                    <div className="bg-base-200 rounded-lg p-4">
                      <p className="text-sm text-gray-600">Task management integration coming soon...</p>
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-semibold mb-3">Project Involvement</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-base-200 rounded-lg p-4">
                        <h5 className="font-medium mb-2">CRM Development</h5>
                        <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                          <div className="bg-primary h-2 rounded-full" style={{ width: '65%' }}></div>
                        </div>
                        <p className="text-xs text-gray-600">65% Complete</p>
                      </div>
                      
                      <div className="bg-base-200 rounded-lg p-4">
                        <h5 className="font-medium mb-2">Marketing Campaign</h5>
                        <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                          <div className="bg-success h-2 rounded-full" style={{ width: '80%' }}></div>
                        </div>
                        <p className="text-xs text-gray-600">80% Complete</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Client Cases Tab */}
        {activeTab === 'clients' && (
          <div className="space-y-6">
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body">
                <h3 className="card-title">Client Cases</h3>
                <p className="text-sm text-gray-600 mb-4">Clients assigned to {employee.display_name}</p>
                
                <div className="overflow-x-auto">
                  <table className="table table-zebra w-full text-base">
                    <thead>
                      <tr>
                        <th>Client</th>
                        <th>Status</th>
                        <th>Last Contact</th>
                        <th>Documents</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td colSpan={5} className="text-center text-gray-500 py-8">
                          Client case integration coming soon...
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Feedback & Reviews Tab */}
        {activeTab === 'feedback' && (
          <div className="space-y-6">
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body">
                <h3 className="card-title">Feedback & Reviews</h3>
                <p className="text-sm text-gray-600 mb-4">Performance feedback and reviews for {employee.display_name}</p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h4 className="font-semibold">Recent Feedback</h4>
                    <div className="bg-base-200 rounded-lg p-4">
                      <p className="text-sm text-gray-600">Feedback system coming soon...</p>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <h4 className="font-semibold">Performance Ratings</h4>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Teamwork</span>
                        <div className="rating rating-sm">
                          <input type="radio" name="teamwork" className="mask mask-star-2 bg-orange-400" disabled />
                          <input type="radio" name="teamwork" className="mask mask-star-2 bg-orange-400" disabled />
                          <input type="radio" name="teamwork" className="mask mask-star-2 bg-orange-400" disabled />
                          <input type="radio" name="teamwork" className="mask mask-star-2 bg-orange-400" disabled />
                          <input type="radio" name="teamwork" className="mask mask-star-2 bg-orange-400" disabled />
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Communication</span>
                        <div className="rating rating-sm">
                          <input type="radio" name="communication" className="mask mask-star-2 bg-orange-400" disabled />
                          <input type="radio" name="communication" className="mask mask-star-2 bg-orange-400" disabled />
                          <input type="radio" name="communication" className="mask mask-star-2 bg-orange-400" disabled />
                          <input type="radio" name="communication" className="mask mask-star-2 bg-orange-400" disabled />
                          <input type="radio" name="communication" className="mask mask-star-2 bg-gray-300" disabled />
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm">Performance</span>
                        <div className="rating rating-sm">
                          <input type="radio" name="performance" className="mask mask-star-2 bg-orange-400" disabled />
                          <input type="radio" name="performance" className="mask mask-star-2 bg-orange-400" disabled />
                          <input type="radio" name="performance" className="mask mask-star-2 bg-orange-400" disabled />
                          <input type="radio" name="performance" className="mask mask-star-2 bg-orange-400" disabled />
                          <input type="radio" name="performance" className="mask mask-star-2 bg-orange-400" disabled />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Salary Tab */}
        {activeTab === 'salary' && (
          <div className="space-y-6">
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body">
                <h3 className="card-title">Salary History</h3>
                <p className="text-sm text-gray-600 mb-4">Monthly salary records for {employee.display_name}</p>
                
                <SalaryHistory employeeId={employee.id} />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'bonus' && (
          <div className="space-y-6">
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body">
                <h3 className="card-title">Bonus Calculation</h3>
                <p className="text-sm text-gray-600 mb-4">Detailed bonus breakdown for {employee.display_name} based on current date filter</p>
                
                <BonusBreakdown 
                  employee={employee} 
                  dateFrom={fromDate} 
                  dateTo={toDate} 
                />
              </div>
            </div>
          </div>
        )}

                {/* Footer Actions */}
                <div className="modal-action">
                  <button className="btn btn-primary" onClick={onClose}>
                    Close
                  </button>
                </div>
              </div>

              {/* Back Page - Role Details */}
              <div className="page-back">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={handleBackToRoles}
                      className="btn btn-sm btn-outline btn-primary"
                    >
                      ← Back to Roles
                    </button>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                      {employee.display_name}'s {getRoleDisplayName(selectedRole)} Leads
                    </h2>
                  </div>
                  <button
                    onClick={onClose}
                    className="btn btn-md btn-circle btn-ghost"
                  >
                    <XMarkIcon className="w-6 h-6" />
                  </button>
                </div>

                {/* Performance Summary */}
                {performanceData && (
                  <div className="card bg-base-100 shadow-sm mb-6">
                    <div className="card-body">
                      <h3 className="card-title flex items-center gap-2">
                        <ChartBarIcon className="w-5 h-5" />
                        {getRoleDisplayName(selectedRole)} Performance Summary
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="stat bg-white rounded-lg p-4 shadow-lg" style={{ boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)' }}>
                          <div className="stat-title">Signed Contracts</div>
                          <div className="stat-value" style={{ color: '#3e2bcd' }}>{getRoleMetrics(selectedRole).signed}</div>
                        </div>
                        <div className="stat bg-white rounded-lg p-4 shadow-lg" style={{ boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)' }}>
                          <div className="stat-title">Signed Total</div>
                          <div className="stat-value" style={{ color: '#3e2bcd' }}>{formatCurrency(getRoleMetrics(selectedRole).total)}</div>
                        </div>
                        <div className="stat bg-white rounded-lg p-4 shadow-lg" style={{ boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)' }}>
                          <div className="stat-title">Total Invoiced</div>
                          <div className="stat-value" style={{ color: '#3e2bcd' }}>{formatCurrency(getRoleMetrics(selectedRole).invoiced)}</div>
                        </div>
                      </div>
                      <div className="text-sm text-gray-600 mt-2">
                        Period: {performanceData.dateRange.from} to {performanceData.dateRange.to}
                      </div>
                    </div>
                  </div>
                )}

                {/* Role Leads Table */}
                <div className="card bg-base-100 shadow-sm">
                  <div className="card-body">
               <h3 className="card-title flex items-center gap-2">
                 <ChartBarIcon className="w-5 h-5" />
                 {getRoleDisplayName(selectedRole)} Role Leads ({roleLeads.length} leads)
               </h3>
               <p className="text-sm text-gray-600 mb-4">
                 All signed leads for {employee.display_name} in the {getRoleDisplayName(selectedRole)} role during the selected period
               </p>
               <div className="text-xs text-gray-500 mb-2">
                 Period: {performanceData?.dateRange?.from || 'Last 30 days'} to {performanceData?.dateRange?.to || 'Today'}
               </div>
                    
                    {loadingRoleLeads ? (
                      <div className="flex justify-center items-center py-8">
                        <span className="loading loading-spinner loading-lg"></span>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="table table-zebra w-full text-base">
                          <thead>
                            <tr>
                              <th className="font-semibold text-base">Lead #</th>
                              <th className="font-semibold text-base">Client Name</th>
                              <th className="font-semibold text-base">Category</th>
                              <th className="font-semibold text-base">Language</th>
                              <th className="font-semibold text-base">Applicants</th>
                              <th className="font-semibold text-base">Total Amount</th>
                              <th className="font-semibold text-base">Bonus</th>
                              <th className="font-semibold text-base">Signed Date</th>
                            </tr>
                          </thead>
                          <tbody>
                              {roleLeads.length > 0 ? (
                              roleLeads.map((lead, index) => (
                                <tr key={lead.lead_number || index}>
                                  <td className="font-medium">
                                    <span className="badge badge-outline">
                                      {lead.lead_number || 'N/A'}
                                    </span>
                                  </td>
                                  <td className="font-medium">{lead.name || 'N/A'}</td>
                                  <td>{lead.category || 'N/A'}</td>
                                  <td>{lead.language || 'N/A'}</td>
                                  <td className="text-center">{lead.applicants || 0}</td>
                                  <td className="font-semibold text-success">{formatCurrency(lead.total || 0, lead.currency_id)}</td>
                                  <td className="font-semibold text-warning">
                                    {(() => {
                                      if (!selectedRole) {
                                        return (
                                          <div className="flex flex-col">
                                            <span>₪0</span>
                                            <span className="text-xs text-gray-500">(0%)</span>
                                          </div>
                                        );
                                      }
                                      const bonus = calculateLeadBonus(lead, selectedRole);
                                      return (
                                        <div className="flex flex-col">
                                          <span>{bonus.formatted}</span>
                                          <span className="text-xs text-gray-500">
                                            ({bonus.percentage.toFixed(1)}%{bonus.poolInfo})
                                          </span>
                                          <span className="text-xs text-blue-500">
                                            Group: {bonus.groupPercentage}% × Role: {bonus.basePercentage}%
                                          </span>
                                        </div>
                                      );
                                    })()}
                                  </td>
                                  <td className="text-sm text-gray-600">
                                    {lead.cdate ? new Date(lead.cdate).toLocaleDateString('en-US', {
                                      year: 'numeric',
                                      month: 'short',
                                      day: 'numeric'
                                    }) : 'N/A'}
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={8} className="text-center text-gray-500 py-8">
                                  No signed leads found for this role in the selected period
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer Actions */}
                <div className="modal-action">
                  <button className="btn btn-primary" onClick={onClose}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </>
  );
};

export default EmployeeModal;
