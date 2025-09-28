import React, { useState } from 'react';
import { XMarkIcon, UserIcon, ChartBarIcon, CurrencyDollarIcon, ClockIcon, CheckCircleIcon, XCircleIcon, CalendarDaysIcon, TrophyIcon, PhoneIcon, DevicePhoneMobileIcon, EyeIcon, PencilIcon } from '@heroicons/react/24/outline';
import { convertToNIS, getCurrencySymbol as getCurrencySymbolFromLib } from '../lib/currencyConversion';

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
    total_meetings: number;
    completed_meetings: number;
    total_revenue: number;
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
          <div className="text-4xl mb-2"></div>
          <div className="text-sm">No contract data available for the selected period</div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col">
      {/* Chart Area - Reduced padding and better proportions */}
      <div className="flex-1 relative px-1 py-1 min-h-0">
        <svg className="w-full h-full" viewBox="0 0 380 200" preserveAspectRatio="xMidYMid meet">
          {/* Modern Grid Lines */}
          <defs>
            <pattern id="closerGrid" width="40" height="20" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 20" fill="none" stroke="#f8fafc" strokeWidth="0.5"/>
            </pattern>
            {/* Gradient for main line */}
            <linearGradient id="closerGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#362AB8" stopOpacity="0.8"/>
              <stop offset="100%" stopColor="#362AB8" stopOpacity="0.1"/>
            </linearGradient>
            {/* Gradient for area fill */}
            <linearGradient id="closerAreaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#362AB8" stopOpacity="0.15"/>
              <stop offset="100%" stopColor="#362AB8" stopOpacity="0.02"/>
            </linearGradient>
          </defs>
          
          {/* Background */}
          <rect width="100%" height="100%" fill="url(#closerGrid)" />
          
          {/* Y-axis labels - Adjusted for new viewBox */}
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((value) => {
            const y = 160 - (value / 8) * 140;
            return (
              <g key={value}>
                <line x1="30" y1={y} x2="350" y2={y} stroke="#e2e8f0" strokeWidth="0.5" opacity="0.5"/>
                <text x="25" y={y + 4} textAnchor="end" className="text-xs fill-gray-400" fontSize="10">
                  {value}
                </text>
              </g>
            );
          })}
          
          {/* Team Average Line - Adjusted coordinates */}
          {teamDailyAverages.length > 0 && (
            <path
              d={teamDailyAverages.map((point: any, index: number) => {
                const x = (index / (teamDailyAverages.length - 1)) * 320 + 30;
                const y = 160 - (point.teamAverage / Math.max(maxContracts, maxTeamAverage)) * 140;
                return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
              }).join(' ')}
              fill="none"
              stroke="#94a3b8"
              strokeWidth="2"
              strokeDasharray="5,5"
              opacity="0.7"
            />
          )}
          
          {/* Area Fill - Adjusted coordinates */}
          <path
            d={`M 30 160 ${dailyData.map((point: any, index: number) => {
              const x = dailyData.length === 1 ? 30 + 320 / 2 : 
                       (index / (dailyData.length - 1)) * 320 + 30;
              const y = 160 - (point.contracts / maxContracts) * 140;
              return `L ${x} ${y}`;
            }).join(' ')} L 350 160 Z`}
            fill="url(#closerAreaGradient)"
          />
          
          {/* Main Line - Adjusted coordinates */}
          <path
            d={dailyData.map((point: any, index: number) => {
              const x = dailyData.length === 1 ? 30 + 320 / 2 : 
                       (index / (dailyData.length - 1)) * 320 + 30;
              const y = 160 - (point.contracts / maxContracts) * 140;
              return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
            }).join(' ')}
            fill="none"
            stroke="url(#closerGradient)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="drop-shadow-lg"
          />
          
          {/* Data Points - Adjusted coordinates */}
          {dailyData.map((point: any, index: number) => {
            const x = dailyData.length === 1 ? 30 + 320 / 2 : 
                     (index / (dailyData.length - 1)) * 320 + 30;
            const y = 160 - (point.contracts / maxContracts) * 140;
            return (
              <g key={index}>
                {/* Glow effect */}
                <circle
                  cx={x}
                  cy={y}
                  r="6"
                  fill="#362AB8"
                  opacity="0.2"
                />
                {/* Main circle */}
                <circle
                  cx={x}
                  cy={y}
                  r="4"
                  fill="#362AB8"
                  stroke="white"
                  strokeWidth="2"
                  className="hover:r-6 transition-all duration-200 cursor-pointer drop-shadow-sm"
                />
                {/* Inner dot */}
                <circle
                  cx={x}
                  cy={y}
                  r="2"
                  fill="white"
                  opacity="0.8"
                />
                {/* Hover tooltip - only visible on hover */}
                <g className="opacity-0 hover:opacity-100 transition-opacity duration-200">
                  <rect
                    x={x - 15}
                    y={y - 25}
                    width="30"
                    height="16"
                    fill="#374151"
                    rx="3"
                    className="drop-shadow-md"
                  />
                  <text
                    x={x}
                    y={y - 15}
                    textAnchor="middle"
                    className="text-xs font-semibold fill-white"
                    fontSize="10"
                  >
                    {point.contracts}
                  </text>
                </g>
              </g>
            );
          })}

          {/* X-Axis Labels - Positioned within the main chart SVG */}
          {dailyData.map((point: any, index: number) => {
            // Show every nth label to avoid overcrowding
            const showLabel = index % Math.max(1, Math.ceil(dailyData.length / 6)) === 0 || index === dailyData.length - 1;
            if (!showLabel) return null;
            
            const date = new Date(point.date);
            const month = date.toLocaleDateString('en-US', { month: 'short' });
            const day = date.getDate();
            
            // Use the exact same calculation as the data points
            const x = dailyData.length === 1 ? 30 + 320 / 2 : 
                     (index / (dailyData.length - 1)) * 320 + 30;
            
            return (
              <g key={`label-${index}`}>
                <text
                  x={x}
                  y="175"
                  textAnchor="middle"
                  className="text-xs font-semibold fill-gray-800"
                  fontSize="10"
                >
                  {day}
                </text>
                <text
                  x={x}
                  y="185"
                  textAnchor="middle"
                  className="text-xs fill-gray-500"
                  fontSize="9"
                >
                  {month}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
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
    <div className="w-full h-full flex flex-col">
      {/* Chart Area - Reduced padding and better proportions */}
      <div className="flex-1 relative px-1 py-1 min-h-0">
        <svg className="w-full h-full" viewBox="0 0 380 200" preserveAspectRatio="xMidYMid meet">
          {/* Modern Grid Lines */}
          <defs>
            <pattern id="modernGrid" width="40" height="20" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 20" fill="none" stroke="#f8fafc" strokeWidth="0.5"/>
            </pattern>
            {/* Gradient for main line */}
            <linearGradient id="mainGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#362AB8" stopOpacity="0.8"/>
              <stop offset="100%" stopColor="#362AB8" stopOpacity="0.1"/>
            </linearGradient>
            {/* Gradient for area fill */}
            <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#362AB8" stopOpacity="0.15"/>
              <stop offset="100%" stopColor="#362AB8" stopOpacity="0.02"/>
            </linearGradient>
          </defs>
          
          {/* Background */}
          <rect width="100%" height="100%" fill="url(#modernGrid)" />
          
          {/* Y-axis labels - Adjusted for new viewBox */}
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((value) => {
            const y = 160 - (value / 8) * 140;
            return (
              <g key={value}>
                <line x1="30" y1={y} x2="350" y2={y} stroke="#e2e8f0" strokeWidth="0.5" opacity="0.5"/>
                <text x="25" y={y + 4} textAnchor="end" className="text-xs fill-gray-400" fontSize="10">
                  {value}
                </text>
              </g>
            );
          })}
          
          {/* Team Average Line - Adjusted coordinates */}
          {teamDailyAverages.length > 0 && (
            <path
              d={teamDailyAverages.map((point: any, index: number) => {
                const x = (index / (teamDailyAverages.length - 1)) * 320 + 30;
                const y = 160 - (point.teamAverage / Math.max(maxExaminations, maxTeamAverage)) * 140;
                return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
              }).join(' ')}
              fill="none"
              stroke="#94a3b8"
              strokeWidth="2"
              strokeDasharray="5,5"
              opacity="0.7"
            />
          )}
          
          {/* Area Fill - Adjusted coordinates */}
          <path
            d={`M 30 160 ${dailyData.map((point: any, index: number) => {
              const x = dailyData.length === 1 ? 30 + 320 / 2 : 
                       (index / (dailyData.length - 1)) * 320 + 30;
              const y = 160 - (point.examinations / maxExaminations) * 140;
              return `L ${x} ${y}`;
            }).join(' ')} L 350 160 Z`}
            fill="url(#areaGradient)"
          />
          
          {/* Main Line - Adjusted coordinates */}
          <path
            d={dailyData.map((point: any, index: number) => {
              const x = dailyData.length === 1 ? 30 + 320 / 2 : 
                       (index / (dailyData.length - 1)) * 320 + 30;
              const y = 160 - (point.examinations / maxExaminations) * 140;
              return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
            }).join(' ')}
            fill="none"
            stroke="url(#mainGradient)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="drop-shadow-lg"
          />
          
          {/* Data Points - Adjusted coordinates */}
          {dailyData.map((point: any, index: number) => {
            const x = dailyData.length === 1 ? 30 + 320 / 2 : 
                     (index / (dailyData.length - 1)) * 320 + 30;
            const y = 160 - (point.examinations / maxExaminations) * 140;
            return (
              <g key={index}>
                {/* Glow effect */}
                <circle
                  cx={x}
                  cy={y}
                  r="6"
                  fill="#362AB8"
                  opacity="0.2"
                />
                {/* Main circle */}
                <circle
                  cx={x}
                  cy={y}
                  r="4"
                  fill="#362AB8"
                  stroke="white"
                  strokeWidth="2"
                  className="hover:r-6 transition-all duration-200 cursor-pointer drop-shadow-sm"
                />
                {/* Inner dot */}
                <circle
                  cx={x}
                  cy={y}
                  r="2"
                  fill="white"
                  opacity="0.8"
                />
                {/* Hover tooltip - only visible on hover */}
                <g className="opacity-0 hover:opacity-100 transition-opacity duration-200">
                  <rect
                    x={x - 15}
                    y={y - 25}
                    width="30"
                    height="16"
                    fill="#374151"
                    rx="3"
                    className="drop-shadow-md"
                  />
                  <text
                    x={x}
                    y={y - 15}
                    textAnchor="middle"
                    className="text-xs font-semibold fill-white"
                    fontSize="10"
                  >
                    {point.examinations}
                  </text>
                </g>
              </g>
            );
          })}

          {/* X-Axis Labels - Positioned within the main chart SVG */}
          {dailyData.map((point: any, index: number) => {
            // Show every nth label to avoid overcrowding
            const showLabel = index % Math.max(1, Math.ceil(dailyData.length / 6)) === 0 || index === dailyData.length - 1;
            if (!showLabel) return null;
            
            // Use the exact same calculation as the data points
            const x = dailyData.length === 1 ? 30 + 320 / 2 : 
                     (index / (dailyData.length - 1)) * 320 + 30;
            
            return (
              <g key={`label-${index}`}>
                <text
                  x={x}
                  y="175"
                  textAnchor="middle"
                  className="text-xs font-semibold fill-gray-800"
                  fontSize="10"
                >
                  {point.dayNumber}
                </text>
                <text
                  x={x}
                  y="185"
                  textAnchor="middle"
                  className="text-xs fill-gray-500"
                  fontSize="9"
                >
                  {point.dayName}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
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
const getRoleTableData = (employee: Employee): (string | number)[] => {
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
      return [
        getRoleDisplayName(employee.bonuses_role),
        (metrics as any).cases_handled || 0,
        (metrics as any).applicants_processed || 0,
        formatCurrency((metrics as any).total_invoiced_amount || 0)
      ];
    
    case 'c': // Closer
      return [
        getRoleDisplayName(employee.bonuses_role),
        (metrics as any).signed_agreements || 0,
        formatCurrency((metrics as any).total_agreement_amount || 0),
        formatCurrency((metrics as any).total_due || 0)
      ];
    
    case 'e': // Expert
      return [
        getRoleDisplayName(employee.bonuses_role),
        (metrics as any).expert_examinations || 0,
        formatCurrency((metrics as any).expert_total || 0)
      ];
    
    case 's': // Scheduler
      return [
        getRoleDisplayName(employee.bonuses_role),
        (metrics as any).meetings_scheduled || 0,
        (metrics as any).signed_meetings || 0,
        formatCurrency((metrics as any).due_total || 0)
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

const EmployeeModal: React.FC<EmployeeModalProps> = ({ employee, allEmployees, isOpen, onClose }) => {
  const [showRoleDetails, setShowRoleDetails] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [roleLeads, setRoleLeads] = useState<any[]>([]);
  const [loadingRoleLeads, setLoadingRoleLeads] = useState(false);
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'overview' | 'availability' | 'tasks' | 'clients' | 'feedback'>('overview');
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
               meeting.legacy_lead?.meeting_total_currency_id === 2 ? 'USD' : 
               meeting.legacy_lead?.meeting_total_currency_id === 3 ? 'EUR' : 'NIS'),
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
    
    setLoadingPerformance(true);
    setPerformanceError(null);
    
    try {
      const { supabase } = await import('../lib/supabase');
      
      // Calculate date range - default to last 30 days if no dates set
      const today = new Date();
      const defaultFromDate = new Date(today);
      defaultFromDate.setDate(today.getDate() - 30);
      
      const fromDateValue = fromDate || defaultFromDate.toISOString().split('T')[0];
      const toDateValue = toDate || today.toISOString().split('T')[0];
      
      console.log('📊 Fetching performance data for:', employee.display_name, 'from', fromDateValue, 'to', toDateValue);
      
      // Use Dashboard approach: Fetch signed stages first, then fetch corresponding leads
      console.log('📋 Fetching leads_leadstage records (stage 60 - agreement signed) for date range...');
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
  }, [employee, fromDate, toDate]);

  // Function to process performance data
  const processPerformanceData = (signedLeads: any[], proformaInvoices: any[], employee: Employee, expertData?: any, closerData?: any) => {
    const employeeId = employee.id;
    const employeeIdStr = String(employeeId); // Convert to string for comparison
    console.log('🔍 Processing performance data for employee:', employee.display_name, 'ID:', employeeId, 'ID as string:', employeeIdStr);
    console.log('🔍 Signed leads to process:', signedLeads.length);
    console.log('🔍 Sample signed lead:', signedLeads[0]);
    
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
      
      // Debug currency conversion
      console.log(`🔍 EmployeeModal Lead ${lead.id}:`, {
        originalAmount: leadTotal,
        currencyId: lead.meeting_total_currency_id,
        convertedAmount: leadTotalInNIS,
        conversionRate: leadTotal > 0 ? leadTotalInNIS / leadTotal : 1
      });
      
      console.log(`🔍 Lead ${index + 1}:`, {
        id: lead.id,
        name: lead.name,
        case_handler_id: lead.case_handler_id,
        closer_id: lead.closer_id,
        expert_id: lead.expert_id,
        meeting_scheduler_id: lead.meeting_scheduler_id,
        meeting_manager_id: lead.meeting_manager_id,
        meeting_lawyer_id: lead.meeting_lawyer_id,
        total: leadTotal
      });
      
      // Check each role and add to metrics if employee has that role
      if (lead.case_handler_id === employeeIdStr) {
        console.log('✅ Matched as Handler');
        roleMetrics.handler.signed += 1;
        roleMetrics.handler.total += leadTotalInNIS; // Use NIS amount
        roleMetrics.handler.cases += 1; // Each lead is a case
        roleMetrics.handler.applicants += parseInt(lead.no_of_applicants) || 0;
      }
      if (lead.closer_id === employeeIdStr) {
        console.log('✅ Matched as Closer');
        roleMetrics.closer.signed += 1;
        roleMetrics.closer.total += leadTotalInNIS; // Use NIS amount
      }
      if (lead.expert_id === employeeIdStr) {
        console.log('✅ Matched as Expert');
        roleMetrics.expert.signed += 1;
        roleMetrics.expert.total += leadTotalInNIS; // Use NIS amount
      }
      if (lead.meeting_scheduler_id === employeeIdStr) {
        console.log('✅ Matched as Scheduler');
        roleMetrics.scheduler.signed += 1;
        roleMetrics.scheduler.total += leadTotalInNIS; // Use NIS amount
      }
      if (lead.meeting_manager_id === employeeIdStr) {
        console.log('✅ Matched as Manager');
        roleMetrics.manager.signed += 1;
        roleMetrics.manager.total += leadTotalInNIS; // Use NIS amount
      }
      if (lead.meeting_lawyer_id === employeeIdStr) {
        console.log('✅ Matched as Helper Closer');
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
        if (correspondingLead.case_handler_id === employeeIdStr) {
          roleMetrics.handler.invoiced += invoiceAmount;
        }
        if (correspondingLead.closer_id === employeeIdStr) {
          roleMetrics.closer.invoiced += invoiceAmount;
        }
        if (correspondingLead.expert_id === employeeIdStr) {
          roleMetrics.expert.invoiced += invoiceAmount;
        }
        if (correspondingLead.meeting_scheduler_id === employeeIdStr) {
          roleMetrics.scheduler.invoiced += invoiceAmount;
        }
        if (correspondingLead.meeting_manager_id === employeeIdStr) {
          roleMetrics.manager.invoiced += invoiceAmount;
        }
        if (correspondingLead.meeting_lawyer_id === employeeIdStr) {
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
      
      // Debug total revenue calculation
      console.log(`🔍 EmployeeModal Total Revenue - Lead ${lead.id}:`, {
        leadTotal: leadTotal,
        leadCurrencyId: lead.meeting_total_currency_id,
        leadTotalInNIS: leadTotalInNIS,
        invoiceAmount: invoiceAmount,
        invoiceCurrencyId: correspondingInvoice?.currency_id,
        invoiceAmountInNIS: invoiceAmountInNIS
      });
      
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
      dateRange: { from: fromDate, to: toDate },
      signedLeads: signedLeads // Include signed leads for role filtering
    };
    
    console.log('🔍 Final role metrics:', result.roleMetrics);
    console.log('🔍 Total signed leads:', result.totalSigned);
    console.log('🔍 Total invoiced:', result.totalInvoiced);
    
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
  }, [activeTab, employee, fetchPerformanceData, fromDate, toDate]);

  // Fetch availability data when availability tab is selected
  React.useEffect(() => {
    if (activeTab === 'availability' && employee) {
      fetchAvailabilityData();
    }
  }, [activeTab, employee, fetchAvailabilityData]);

  if (!employee) return null;

  const metrics = employee.performance_metrics || {
    total_meetings: 0,
    completed_meetings: 0,
    total_revenue: 0,
    average_rating: 0,
    last_activity: 'No activity'
  };

  const completionRate = metrics.total_meetings > 0 
    ? Math.round((metrics.completed_meetings / metrics.total_meetings) * 100) 
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
      const employeeIdStr = String(employee.id);
      
      // Filter leads by role
      let roleLeads: any[] = [];
      
      switch (role.toLowerCase()) {
        case 'handler':
        case 'h':
          roleLeads = signedLeads.filter((lead: any) => lead.case_handler_id === employeeIdStr);
          break;
        case 'closer':
        case 'c':
          roleLeads = signedLeads.filter((lead: any) => lead.closer_id === employeeIdStr);
          break;
        case 'expert':
        case 'e':
          roleLeads = signedLeads.filter((lead: any) => lead.expert_id === employeeIdStr);
          break;
        case 'scheduler':
        case 's':
          roleLeads = signedLeads.filter((lead: any) => lead.meeting_scheduler_id === employeeIdStr);
          break;
        case 'manager':
        case 'z':
          roleLeads = signedLeads.filter((lead: any) => lead.meeting_manager_id === employeeIdStr);
          break;
        case 'helper-closer':
          roleLeads = signedLeads.filter((lead: any) => lead.meeting_lawyer_id === employeeIdStr);
          break;
        default:
          roleLeads = [];
          break;
      }

      // Apply date filter to role leads
      const today = new Date();
      const defaultFromDate = new Date(today);
      defaultFromDate.setDate(today.getDate() - 30);
      
      const fromDateValue = fromDate || defaultFromDate.toISOString().split('T')[0];
      const toDateValue = toDate || today.toISOString().split('T')[0];
      
      console.log('🔍 Filtering role leads by date range:', fromDateValue, 'to', toDateValue);
      
      const filteredRoleLeads = roleLeads.filter(lead => {
        const leadDate = lead.cdate ? lead.cdate.split('T')[0] : null;
        const isInRange = leadDate && leadDate >= fromDateValue && leadDate <= toDateValue;
        console.log('🔍 Lead date check:', { leadId: lead.id, leadDate, fromDateValue, toDateValue, isInRange });
        return isInRange;
      });
      
      console.log(`🔍 Filtered ${filteredRoleLeads.length} leads from ${roleLeads.length} total leads for date range`);

      // Format the leads for display
      const formattedLeads = filteredRoleLeads.map(lead => {
        console.log('🔍 Formatting lead for display:', {
          id: lead.id,
          name: lead.name,
          total: lead.total,
          meeting_total_currency_id: lead.meeting_total_currency_id,
          currency_symbol: getCurrencySymbol(lead.meeting_total_currency_id)
        });
        
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
            console.log(`🔍 EmployeeModal Role Leads - Lead ${lead.id}:`, {
              originalAmount: originalAmount,
              currencyId: lead.meeting_total_currency_id,
              convertedAmount: convertedAmount
            });
            return convertedAmount;
          })(), // Convert to NIS
          balance: lead.balance || 0,
          cdate: lead.cdate,
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

  const averageRevenuePerMeeting = metrics.completed_meetings > 0 
    ? metrics.total_revenue / metrics.completed_meetings 
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
          <div key="total-meetings" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
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
          <div key="signed-agreements" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <CheckCircleIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Signed Agreements</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{performanceData ? performanceData.roleMetrics.closer.signed : 0}</div>
            <div className="stat-desc text-base">Total agreements signed</div>
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
          <div key="total-revenue" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
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
            <div className="stat-value" style={{color: '#3829BF'}}>{performanceData ? formatCurrency(performanceData.totalSignedAcrossAllRoles) : formatCurrency(0)}</div>
            <div className="stat-desc text-base">Signed total across all roles</div>
          </div>,
          <div key="avg-case-value" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <TrophyIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Avg Case Value</div>
            <div className="stat-value" style={{color: '#3829BF'}}>
              {formatCurrency((metrics.cases_handled && metrics.cases_handled > 0) 
                ? (metrics.total_invoiced_amount || 0) / metrics.cases_handled 
                : 0)}
            </div>
            <div className="stat-desc text-base">Per case handled</div>
          </div>
        ];

      default: // Default stats for other roles
        return [
          <div key="total-meetings" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
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
          <div key="total-revenue" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
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
                  className={`btn btn-sm btn-circle flex-shrink-0 ${employee.photo ? 'btn-ghost text-white hover:bg-white/20' : 'btn-ghost'}`}
                  onClick={() => {
                    setIsEditingBackground(true);
                    setNewBackgroundUrl(employee.photo || '');
                  }}
                  title="Edit background image"
                >
                  <PencilIcon className="w-4 h-4" />
                </button>
                <button 
                  className={`btn btn-sm btn-circle flex-shrink-0 ${employee.photo ? 'btn-ghost text-white hover:bg-white/20' : 'btn-ghost'}`}
                  onClick={onClose}
                >
                  <XMarkIcon className="w-5 h-5" />
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
                className={`btn btn-sm btn-circle ${employee.photo ? 'btn-ghost text-white hover:bg-white/20' : 'btn-ghost'}`}
                onClick={() => {
                  setIsEditingBackground(true);
                  setNewBackgroundUrl(employee.photo || '');
                }}
                title="Edit background image"
              >
                <PencilIcon className="w-4 h-4" />
              </button>
              <button 
                className={`btn btn-sm btn-circle ${employee.photo ? 'btn-ghost text-white hover:bg-white/20' : 'btn-ghost'}`}
                onClick={onClose}
              >
                <XMarkIcon className="w-5 h-5" />
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
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                  // Reset to default (last 30 days) and refetch data
                  fetchPerformanceData();
                }}
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
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setFromDate('');
                setToDate('');
                // Reset to default (last 30 days) and refetch data
                fetchPerformanceData();
              }}
              title="Clear filters and show last 30 days"
            >
              Clear
            </button>
          </div>
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
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body">
                <h3 className="card-title flex items-center gap-2">
                  <ChartBarIcon className="w-5 h-5" />
                  Expert Performance Trend
                </h3>
                <div className="h-80">
                  <ExpertPerformanceChart expertData={performanceData.expertMetrics} dateRange={performanceData.dateRange} />
                </div>
              </div>
            </div>
          ) : employee.bonuses_role?.toLowerCase() === 'c' && performanceData?.closerMetrics ? (
            <div className="card bg-base-100 shadow-sm">
              <div className="card-body">
                <h3 className="card-title flex items-center gap-2">
                  <ChartBarIcon className="w-5 h-5" />
                  Closer Performance Trend
                </h3>
                <div className="h-80">
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
                  <span className="font-semibold">{formatCurrency(metrics.total_revenue)}</span>
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
                      <th className="font-semibold text-base">Role</th>
                      <th className="font-semibold text-base">Signed Contracts</th>
                      <th className="font-semibold text-base">Signed Total</th>
                      <th className="font-semibold text-base">Total Due (Invoiced)</th>
                      <th className="font-semibold text-base">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="font-medium">{getRoleDisplayName(employee.bonuses_role)}</td>
                      <td className="font-medium">{getRoleMetrics(employee.bonuses_role).signed}</td>
                      <td className="font-medium">{formatCurrency(getRoleMetrics(employee.bonuses_role).total)}</td>
                      <td className="font-medium">{formatCurrency(getRoleMetrics(employee.bonuses_role).invoiced)}</td>
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
                  <div className="text-sm text-gray-600">{formatDate(metrics.last_activity)}</div>
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
                  <div className="text-sm text-gray-600">{formatCurrency(metrics.total_revenue)} total</div>
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
                      {employee.display_name}'s {selectedRole} Leads
                    </h2>
                  </div>
                  <button
                    onClick={onClose}
                    className="btn btn-sm btn-circle btn-ghost"
                  >
                    <XMarkIcon className="w-5 h-5" />
                  </button>
                </div>

                {/* Performance Summary */}
                {performanceData && (
                  <div className="card bg-base-100 shadow-sm mb-6">
                    <div className="card-body">
                      <h3 className="card-title flex items-center gap-2">
                        <ChartBarIcon className="w-5 h-5" />
                        {selectedRole} Performance Summary
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="stat bg-primary/10 rounded-lg p-4">
                          <div className="stat-title">Signed Contracts</div>
                          <div className="stat-value text-primary">{getRoleMetrics(selectedRole).signed}</div>
                        </div>
                        <div className="stat bg-success/10 rounded-lg p-4">
                          <div className="stat-title">Signed Total</div>
                          <div className="stat-value text-success">{formatCurrency(getRoleMetrics(selectedRole).total)}</div>
                        </div>
                        <div className="stat bg-info/10 rounded-lg p-4">
                          <div className="stat-title">Total Invoiced</div>
                          <div className="stat-value text-info">{formatCurrency(getRoleMetrics(selectedRole).invoiced)}</div>
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
                 {selectedRole} Role Leads ({roleLeads.length} leads)
               </h3>
               <p className="text-sm text-gray-600 mb-4">
                 All signed leads for {employee.display_name} in the {selectedRole} role during the selected period
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
                                <td colSpan={7} className="text-center text-gray-500 py-8">
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
