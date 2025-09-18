import React, { useState } from 'react';
import { XMarkIcon, UserIcon, ChartBarIcon, CurrencyDollarIcon, ClockIcon, CheckCircleIcon, XCircleIcon, CalendarDaysIcon, TrophyIcon, PhoneIcon, DevicePhoneMobileIcon, EyeIcon } from '@heroicons/react/24/outline';

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

// Get currency symbol
const getCurrencySymbol = (currency?: string) => {
  switch (currency) {
    case 'USD': return '$';
    case 'EUR': return '€';
    case 'GBP': return '£';
    case 'NIS':
    default: return '₪';
  }
};

// Helper function to get role-based table headers
const getRoleTableHeaders = (role: string): string[] => {
  const roleMap: { [key: string]: string[] } = {
    'h': ['Role', 'Department', 'Cases', 'Applicants', 'Total'],
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
        employee.department || 'N/A',
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

  // Function to fetch leads for a specific role
  const fetchRoleLeads = async (role: string) => {
    setLoadingRoleLeads(true);
    try {
      // Import supabase client
      const { supabase } = await import('../lib/supabase');
      
      let query = supabase.from('leads_lead').select(`
        lead_number,
        name,
        category,
        stage,
        language,
        applicants,
        total,
        balance
      `).eq('is_active', true);

      // Add role-specific filters
      switch (role.toLowerCase()) {
        case 'handler':
        case 'h':
          query = query.eq('handler_id', employee.id);
          break;
        case 'closer':
        case 'c':
          query = query.eq('closer_id', employee.id);
          break;
        case 'expert':
        case 'e':
          query = query.eq('expert_id', employee.id);
          break;
        case 'scheduler':
        case 's':
          query = query.eq('scheduler_id', employee.id);
          break;
        case 'manager':
        case 'z':
          query = query.eq('manager_id', employee.id);
          break;
        case 'helper-closer':
          query = query.eq('helper_closer_id', employee.id);
          break;
        default:
          break;
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching role leads:', error);
        setRoleLeads([]);
      } else {
        setRoleLeads(data || []);
      }
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


  // Helper function to format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const averageRevenuePerMeeting = metrics.completed_meetings > 0 
    ? metrics.total_revenue / metrics.completed_meetings 
    : 0;

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
            <div className="stat-value" style={{color: '#3829BF'}}>{metrics.expert_opinions_completed || 0}</div>
            <div className="stat-desc">Opinions completed</div>
          </div>,
          <div key="feasibility-no-check" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <CheckCircleIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Feasible (No Check)</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{metrics.feasibility_no_check || 0}</div>
            <div className="stat-desc">Direct feasibility</div>
          </div>,
          <div key="feasibility-further-check" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <ClockIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Feasible (Further Check)</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{metrics.feasibility_further_check || 0}</div>
            <div className="stat-desc">Requires investigation</div>
          </div>,
          <div key="feasibility-no-feasibility" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <XCircleIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">No Feasibility</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{metrics.feasibility_no_feasibility || 0}</div>
            <div className="stat-desc">Not feasible</div>
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
            <div className="stat-desc">Total meetings scheduled</div>
          </div>,
          <div key="total-meetings" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <ChartBarIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Total Meetings</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{metrics.total_meetings || 0}</div>
            <div className="stat-desc">All time meetings</div>
          </div>,
          <div key="completed-meetings" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <CheckCircleIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Completed</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{metrics.completed_meetings || 0}</div>
            <div className="stat-desc">{completionRate}% completion rate</div>
          </div>,
          <div key="completion-rate" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <TrophyIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Completion Rate</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{completionRate}%</div>
            <div className="stat-desc">Success rate</div>
          </div>
        ];

      case 'c': // Closer
        return [
          <div key="signed-agreements" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <CheckCircleIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Signed Agreements</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{metrics.signed_agreements || 0}</div>
            <div className="stat-desc">Total agreements signed</div>
          </div>,
          <div key="total-agreement-amount" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <CurrencyDollarIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Total Agreement Amount</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{formatCurrency(metrics.total_agreement_amount || 0)}</div>
            <div className="stat-desc">Total value signed</div>
          </div>,
          <div key="avg-agreement-value" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <TrophyIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Avg Agreement Value</div>
            <div className="stat-value" style={{color: '#3829BF'}}>
              {formatCurrency((metrics.signed_agreements && metrics.signed_agreements > 0) 
                ? (metrics.total_agreement_amount || 0) / metrics.signed_agreements 
                : 0)}
            </div>
            <div className="stat-desc">Per agreement</div>
          </div>,
          <div key="total-revenue" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <ChartBarIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Total Revenue</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{formatCurrency(metrics.total_revenue || 0)}</div>
            <div className="stat-desc">All time earnings</div>
          </div>
        ];

      case 'h': // Handler
        return [
          <div key="cases-handled" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <UserIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Cases Handled</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{metrics.cases_handled || 0}</div>
            <div className="stat-desc">Total cases processed</div>
          </div>,
          <div key="applicants-processed" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <CheckCircleIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Applicants Processed</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{metrics.applicants_processed || 0}</div>
            <div className="stat-desc">Total applicants handled</div>
          </div>,
          <div key="total-invoiced-amount" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <CurrencyDollarIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Total Invoiced Amount</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{formatCurrency(metrics.total_invoiced_amount || 0)}</div>
            <div className="stat-desc">From leads processed</div>
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
            <div className="stat-desc">Per case handled</div>
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
            <div className="stat-desc">All time meetings</div>
          </div>,
          <div key="completed-meetings" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <CheckCircleIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Completed</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{metrics.completed_meetings || 0}</div>
            <div className="stat-desc">{completionRate}% completion rate</div>
          </div>,
          <div key="total-revenue" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <CurrencyDollarIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Total Revenue</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{formatCurrency(metrics.total_revenue || 0)}</div>
            <div className="stat-desc">All time earnings</div>
          </div>,
          <div key="avg-revenue-per-meeting" className="stat bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
            <div className="stat-figure" style={{color: '#3829BF'}}>
              <TrophyIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Avg Revenue/Meeting</div>
            <div className="stat-value" style={{color: '#3829BF'}}>{formatCurrency(averageRevenuePerMeeting)}</div>
            <div className="stat-desc">Per completed meeting</div>
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
              <button 
                className={`btn btn-sm btn-circle ml-2 flex-shrink-0 ${employee.photo ? 'btn-ghost text-white hover:bg-white/20' : 'btn-ghost'}`}
                onClick={onClose}
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
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
            
            <button 
              className={`btn btn-sm btn-circle ml-4 ${employee.photo ? 'btn-ghost text-white hover:bg-white/20' : 'btn-ghost'}`}
              onClick={onClose}
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
          </div>
          </div>
        </div>

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
                onClick={() => {
                  // TODO: Implement date filtering logic
                  console.log('Filtering data from', fromDate, 'to', toDate);
                }}
                disabled={!fromDate || !toDate}
              >
                Save
              </button>
              {(fromDate || toDate) && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setFromDate('');
                    setToDate('');
                    // TODO: Reset to show all data
                    console.log('Clearing date filters');
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          
          {/* Desktop Layout */}
          <div className="hidden sm:flex items-center gap-3 flex-wrap">
            <h3 className="text-lg font-semibold text-base-content">Performance Period</h3>
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
              onClick={() => {
                // TODO: Implement date filtering logic
                console.log('Filtering data from', fromDate, 'to', toDate);
              }}
              disabled={!fromDate || !toDate}
            >
              Apply Filter
            </button>
            {(fromDate || toDate) && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                  // TODO: Reset to show all data
                  console.log('Clearing date filters');
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6">
          <div className="flex border-b border-base-300 overflow-x-auto">
            <button
              className={`flex-shrink-0 px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm border-b-2 transition-colors ${
                activeTab === 'overview'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-base-content/70 hover:text-base-content'
              }`}
              onClick={() => setActiveTab('overview')}
            >
              Overview
            </button>
            <button
              className={`flex-shrink-0 px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm border-b-2 transition-colors ${
                activeTab === 'availability'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-base-content/70 hover:text-base-content'
              }`}
              onClick={() => setActiveTab('availability')}
            >
              Availability
            </button>
            <button
              className={`flex-shrink-0 px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm border-b-2 transition-colors ${
                activeTab === 'tasks'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-base-content/70 hover:text-base-content'
              }`}
              onClick={() => setActiveTab('tasks')}
            >
              Tasks & Projects
            </button>
            <button
              className={`flex-shrink-0 px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm border-b-2 transition-colors ${
                activeTab === 'clients'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-base-content/70 hover:text-base-content'
              }`}
              onClick={() => setActiveTab('clients')}
            >
              Client Cases
            </button>
            <button
              className={`flex-shrink-0 px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm border-b-2 transition-colors ${
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

        {/* Performance Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Completion Rate Chart */}
          <div className="card bg-base-100 shadow-sm">
            <div className="card-body">
              <h3 className="card-title flex items-center gap-2">
                <ChartBarIcon className="w-5 h-5" />
                Completion Rate
              </h3>
              <div className="flex items-center justify-center h-32">
                <div className="radial-progress text-primary" style={{"--value": completionRate} as React.CSSProperties} role="progressbar">
                  <span className="text-lg font-bold">{completionRate}%</span>
                </div>
              </div>
              <div className="text-center text-sm text-gray-600">
                {metrics.completed_meetings} of {metrics.total_meetings} meetings completed
              </div>
            </div>
          </div>

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
        <div className="card bg-base-100 shadow-sm mb-6">
          <div className="card-body">
            <h3 className="card-title flex items-center gap-2">
              <ChartBarIcon className="w-5 h-5" />
              {employee.display_name}'s {getRoleDisplayName(employee.bonuses_role)} Performance
            </h3>
            <div className="overflow-x-auto">
              <table className="table table-zebra w-full">
                <thead>
                  <tr>
                    {getRoleTableHeaders(employee.bonuses_role).map((header, index) => (
                      <th key={index} className="font-semibold">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {getRoleTableData(employee).map((data, index) => (
                      <td key={index} className="font-medium">{data}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Employee's Performance Across All Roles */}
        <div className="card bg-base-100 shadow-sm mb-6">
          <div className="card-body">
            <h3 className="card-title flex items-center gap-2">
              <ChartBarIcon className="w-5 h-5" />
              {employee.display_name}'s Performance Across All Roles
            </h3>
            <p className="text-sm text-gray-600 mb-4">Performance metrics for {employee.display_name} across all roles performed during the working month</p>
            
            <div className="overflow-x-auto">
              <table className="table table-zebra w-full">
                 <thead>
                   <tr>
                     <th className="font-semibold w-32">Role</th>
                     <th className="font-semibold w-32">Department</th>
                     <th className="font-semibold w-32">Cases</th>
                     <th className="font-semibold w-32">Applicants</th>
                     <th className="font-semibold w-32">Signed Contracts</th>
                     <th className="font-semibold w-32">Expert Examinations</th>
                     <th className="font-semibold w-32">Meetings Total</th>
                     <th className="font-semibold w-32">Successful Meetings</th>
                     <th className="font-semibold w-32">Signed Total</th>
                     <th className="font-semibold w-32">Total Due</th>
                     <th className="font-semibold w-32">Actions</th>
                   </tr>
                 </thead>
                <tbody>
                   {/* Handler Role Performance - Only show if not primary role */}
                   {employee.bonuses_role?.toLowerCase() !== 'h' && (
                     <tr>
                       <td className="font-medium text-black">Handler</td>
                       <td>{employee.department || 'N/A'}</td>
                       <td>{(employee.performance_metrics as any)?.cases_handled || 0}</td>
                       <td>{(employee.performance_metrics as any)?.applicants_processed || 0}</td>
                       <td>-</td>
                       <td>-</td>
                       <td>-</td>
                       <td>-</td>
                       <td>-</td>
                       <td>{formatCurrency((employee.performance_metrics as any)?.total_invoiced_amount || 0)}</td>
                       <td>
                         <button
                           onClick={() => handleRoleClick('handler')}
                           className="btn btn-sm btn-outline btn-primary"
                           title="View Leads"
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
                       <td>-</td>
                       <td>{(employee.performance_metrics as any)?.signed_agreements || 0}</td>
                       <td>-</td>
                       <td>-</td>
                       <td>-</td>
                       <td>{formatCurrency((employee.performance_metrics as any)?.total_agreement_amount || 0)}</td>
                       <td>{formatCurrency((employee.performance_metrics as any)?.total_due || 0)}</td>
                       <td>
                         <button
                           onClick={() => handleRoleClick('closer')}
                           className="btn btn-sm btn-outline btn-primary"
                           title="View Leads"
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
                       <td>-</td>
                       <td>{(employee.performance_metrics as any)?.expert_examinations || 0}</td>
                       <td>-</td>
                       <td>-</td>
                       <td>{formatCurrency((employee.performance_metrics as any)?.expert_total || 0)}</td>
                       <td>-</td>
                       <td>
                         <button
                           onClick={() => handleRoleClick('expert')}
                           className="btn btn-sm btn-outline btn-primary"
                           title="View Leads"
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
                       <td>-</td>
                       <td>{(employee.performance_metrics as any)?.meetings_scheduled || 0}</td>
                       <td>{(employee.performance_metrics as any)?.signed_meetings || 0}</td>
                       <td>-</td>
                       <td>{formatCurrency((employee.performance_metrics as any)?.due_total || 0)}</td>
                       <td>
                         <button
                           onClick={() => handleRoleClick('scheduler')}
                           className="btn btn-sm btn-outline btn-primary"
                           title="View Leads"
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
                       <td>{(employee.performance_metrics as any)?.contracts_managed || 0}</td>
                       <td>-</td>
                       <td>-</td>
                       <td>{(employee.performance_metrics as any)?.successful_meetings || 0}</td>
                       <td>{formatCurrency((employee.performance_metrics as any)?.signed_total || 0)}</td>
                       <td>{formatCurrency((employee.performance_metrics as any)?.due_total || 0)}</td>
                       <td>
                         <button
                           onClick={() => handleRoleClick('manager')}
                           className="btn btn-sm btn-outline btn-primary"
                           title="View Leads"
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
                       <td>-</td>
                       <td>{(employee.performance_metrics as any)?.signed_agreements || 0}</td>
                       <td>-</td>
                       <td>-</td>
                       <td>-</td>
                       <td>{formatCurrency((employee.performance_metrics as any)?.total_agreement_amount || 0)}</td>
                       <td>{formatCurrency((employee.performance_metrics as any)?.total_due || 0)}</td>
                       <td>
                         <button
                           onClick={() => handleRoleClick('helper-closer')}
                           className="btn btn-sm btn-outline btn-primary"
                           title="View Leads"
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
                        No additional roles performed this month
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
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
                        <table className="table table-zebra w-full">
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
                                    ? `${getCurrencySymbol(meeting.balance_currency)}${meeting.balance.toLocaleString()}`
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
                        <table className="table table-zebra w-full">
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
                        <table className="table table-zebra w-full">
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
                        <div className="stat-desc">Scheduled meetings</div>
                      </div>
                      
                      <div className="stat bg-white rounded-lg shadow-sm">
                        <div className="stat-title">Unavailable Times</div>
                        <div className="stat-value text-warning">{unavailableTimes.length}</div>
                        <div className="stat-desc">Time blocks</div>
                      </div>
                      
                      <div className="stat bg-white rounded-lg shadow-sm">
                        <div className="stat-title">Unavailable Ranges</div>
                        <div className="stat-value text-secondary">{unavailableRanges.length}</div>
                        <div className="stat-desc">Extended periods</div>
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
                        <div className="stat-desc">Days in ranges</div>
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
                  <table className="table table-zebra w-full">
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

                {/* Role Leads Table */}
                <div className="card bg-base-100 shadow-sm">
                  <div className="card-body">
                    <h3 className="card-title flex items-center gap-2">
                      <ChartBarIcon className="w-5 h-5" />
                      {selectedRole} Role Leads
                    </h3>
                    <p className="text-sm text-gray-600 mb-4">
                      Detailed leads for {employee.display_name} in the {selectedRole} role
                    </p>
                    
                    {loadingRoleLeads ? (
                      <div className="flex justify-center items-center py-8">
                        <span className="loading loading-spinner loading-lg"></span>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="table table-zebra w-full">
                          <thead>
                            <tr>
                              <th className="font-semibold">Lead Number + Client</th>
                              <th className="font-semibold">Category</th>
                              <th className="font-semibold">Stage</th>
                              <th className="font-semibold">Language</th>
                              <th className="font-semibold">Applicants</th>
                              <th className="font-semibold">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                              {roleLeads.length > 0 ? (
                              roleLeads.map((lead, index) => (
                                <tr key={lead.lead_number || index}>
                                  <td className="font-medium">
                                    <div>
                                      <div className="font-semibold">{lead.lead_number}</div>
                                      <div className="text-sm text-gray-600">{lead.name}</div>
                                    </div>
                                  </td>
                                  <td>{lead.category || 'N/A'}</td>
                                  <td>
                                    <span className="badge badge-outline">
                                      {lead.stage || 'N/A'}
                                    </span>
                                  </td>
                                  <td>{lead.language || 'N/A'}</td>
                                  <td>{lead.applicants || 0}</td>
                                  <td>{formatCurrency(lead.total || 0)}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={6} className="text-center text-gray-500 py-8">
                                  No leads found for this role
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
