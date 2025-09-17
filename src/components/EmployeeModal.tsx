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
    'helper-closer': 'Helper Closer'
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
        client_name,
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
        <div className="mb-8">
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-start gap-6 flex-1">
              <div className="avatar">
                {employee.photo_url ? (
                  <div className="rounded-full w-32">
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
                            <div class="bg-primary text-primary-content rounded-full w-32 h-32 flex items-center justify-center">
                              <span class="text-3xl font-bold">${getInitials(employee.display_name)}</span>
                            </div>
                          `;
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div className="placeholder">
                    <div className="bg-primary text-primary-content rounded-full w-32 h-32 flex items-center justify-center">
                      <span className="text-3xl font-bold">
                        {getInitials(employee.display_name)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Column - Name, Email & Contact */}
                <div className="lg:col-span-1">
                  <h2 className="text-3xl font-bold mb-2">{employee.display_name}</h2>
                  <p className="text-gray-600 text-lg mb-3">{employee.email}</p>
                  
                  {/* Contact Information */}
                  {(employee.phone || employee.mobile || employee.phone_ext) && (
                    <div className="space-y-2">
                      {employee.phone && (
                        <div className="flex items-center gap-2 text-gray-700">
                          <PhoneIcon className="w-5 h-5 text-gray-500" />
                          <span className="text-base">{employee.phone}</span>
                        </div>
                      )}
                      {employee.mobile && (
                        <div className="flex items-center gap-2 text-gray-700">
                          <DevicePhoneMobileIcon className="w-5 h-5 text-gray-500" />
                          <span className="text-base">{employee.mobile}</span>
                        </div>
                      )}
                      {employee.phone_ext && (
                        <div className="flex items-center gap-2 text-gray-700">
                          <PhoneIcon className="w-5 h-5 text-gray-500" />
                          <span className="text-sm text-gray-500">Extension:</span>
                          <span className="text-base">{employee.phone_ext}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                
                {/* Right Column - Role & Department */}
                <div className="lg:col-span-1">
                  <div className="flex items-center gap-6">
                    <div className="flex flex-col">
                      <span className="text-xs text-gray-500 uppercase tracking-wide mb-1">Role</span>
                      <span className="badge badge-primary badge-xl w-fit whitespace-nowrap overflow-hidden text-ellipsis bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-0">
                        {getRoleDisplayName(employee.bonuses_role)}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-gray-500 uppercase tracking-wide mb-1">Department</span>
                      <span className="badge badge-outline badge-xl w-fit">{employee.department}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <button 
              className="btn btn-sm btn-circle btn-ghost ml-4"
              onClick={onClose}
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

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
                                      <div className="text-sm text-gray-600">{lead.client_name}</div>
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
