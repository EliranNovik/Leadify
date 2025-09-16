import React from 'react';
import { XMarkIcon, UserIcon, ChartBarIcon, CurrencyDollarIcon, ClockIcon, CheckCircleIcon, XCircleIcon, CalendarDaysIcon, TrophyIcon } from '@heroicons/react/24/outline';

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

interface EmployeeModalProps {
  employee: Employee | null;
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
    'Z': 'Manager'
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

const EmployeeModal: React.FC<EmployeeModalProps> = ({ employee, isOpen, onClose }) => {
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

  const averageRevenuePerMeeting = metrics.completed_meetings > 0 
    ? metrics.total_revenue / metrics.completed_meetings 
    : 0;

  // Get role-specific stats based on employee role
  const getRoleSpecificStats = () => {
    const role = employee.bonuses_role?.toLowerCase();
    
    switch (role) {
      case 'e': // Expert
        return [
          <div key="expert-opinions" className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-primary">
              <UserIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Expert Opinions</div>
            <div className="stat-value text-primary">{metrics.expert_opinions_completed || 0}</div>
            <div className="stat-desc">Opinions completed</div>
          </div>,
          <div key="feasibility-no-check" className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-success">
              <CheckCircleIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Feasible (No Check)</div>
            <div className="stat-value text-success">{metrics.feasibility_no_check || 0}</div>
            <div className="stat-desc">Direct feasibility</div>
          </div>,
          <div key="feasibility-further-check" className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-warning">
              <ClockIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Feasible (Further Check)</div>
            <div className="stat-value text-warning">{metrics.feasibility_further_check || 0}</div>
            <div className="stat-desc">Requires investigation</div>
          </div>,
          <div key="feasibility-no-feasibility" className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-error">
              <XCircleIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">No Feasibility</div>
            <div className="stat-value text-error">{metrics.feasibility_no_feasibility || 0}</div>
            <div className="stat-desc">Not feasible</div>
          </div>
        ];

      case 's': // Scheduler
        return [
          <div key="meetings-scheduled" className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-primary">
              <CalendarDaysIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Meetings Scheduled</div>
            <div className="stat-value text-primary">{metrics.meetings_scheduled || 0}</div>
            <div className="stat-desc">Total meetings scheduled</div>
          </div>,
          <div key="total-meetings" className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-info">
              <ChartBarIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Total Meetings</div>
            <div className="stat-value text-info">{metrics.total_meetings || 0}</div>
            <div className="stat-desc">All time meetings</div>
          </div>,
          <div key="completed-meetings" className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-success">
              <CheckCircleIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Completed</div>
            <div className="stat-value text-success">{metrics.completed_meetings || 0}</div>
            <div className="stat-desc">{completionRate}% completion rate</div>
          </div>,
          <div key="completion-rate" className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-warning">
              <TrophyIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Completion Rate</div>
            <div className="stat-value text-warning">{completionRate}%</div>
            <div className="stat-desc">Success rate</div>
          </div>
        ];

      case 'c': // Closer
        return [
          <div key="signed-agreements" className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-primary">
              <CheckCircleIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Signed Agreements</div>
            <div className="stat-value text-primary">{metrics.signed_agreements || 0}</div>
            <div className="stat-desc">Total agreements signed</div>
          </div>,
          <div key="total-agreement-amount" className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-success">
              <CurrencyDollarIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Total Agreement Amount</div>
            <div className="stat-value text-success">{formatCurrency(metrics.total_agreement_amount || 0)}</div>
            <div className="stat-desc">Total value signed</div>
          </div>,
          <div key="avg-agreement-value" className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-warning">
              <TrophyIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Avg Agreement Value</div>
            <div className="stat-value text-warning">
              {formatCurrency((metrics.signed_agreements && metrics.signed_agreements > 0) 
                ? (metrics.total_agreement_amount || 0) / metrics.signed_agreements 
                : 0)}
            </div>
            <div className="stat-desc">Per agreement</div>
          </div>,
          <div key="total-revenue" className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-info">
              <ChartBarIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Total Revenue</div>
            <div className="stat-value text-info">{formatCurrency(metrics.total_revenue || 0)}</div>
            <div className="stat-desc">All time earnings</div>
          </div>
        ];

      case 'h': // Handler
        return [
          <div key="cases-handled" className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-primary">
              <UserIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Cases Handled</div>
            <div className="stat-value text-primary">{metrics.cases_handled || 0}</div>
            <div className="stat-desc">Total cases processed</div>
          </div>,
          <div key="applicants-processed" className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-success">
              <CheckCircleIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Applicants Processed</div>
            <div className="stat-value text-success">{metrics.applicants_processed || 0}</div>
            <div className="stat-desc">Total applicants handled</div>
          </div>,
          <div key="total-invoiced-amount" className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-warning">
              <CurrencyDollarIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Total Invoiced Amount</div>
            <div className="stat-value text-warning">{formatCurrency(metrics.total_invoiced_amount || 0)}</div>
            <div className="stat-desc">From leads processed</div>
          </div>,
          <div key="avg-case-value" className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-info">
              <TrophyIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Avg Case Value</div>
            <div className="stat-value text-info">
              {formatCurrency((metrics.cases_handled && metrics.cases_handled > 0) 
                ? (metrics.total_invoiced_amount || 0) / metrics.cases_handled 
                : 0)}
            </div>
            <div className="stat-desc">Per case handled</div>
          </div>
        ];

      default: // Default stats for other roles
        return [
          <div key="total-meetings" className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-primary">
              <CalendarDaysIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Total Meetings</div>
            <div className="stat-value text-primary">{metrics.total_meetings || 0}</div>
            <div className="stat-desc">All time meetings</div>
          </div>,
          <div key="completed-meetings" className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-success">
              <CheckCircleIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Completed</div>
            <div className="stat-value text-success">{metrics.completed_meetings || 0}</div>
            <div className="stat-desc">{completionRate}% completion rate</div>
          </div>,
          <div key="total-revenue" className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-warning">
              <CurrencyDollarIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Total Revenue</div>
            <div className="stat-value text-warning">{formatCurrency(metrics.total_revenue || 0)}</div>
            <div className="stat-desc">All time earnings</div>
          </div>,
          <div key="avg-revenue-per-meeting" className="stat bg-base-200 rounded-lg">
            <div className="stat-figure text-info">
              <TrophyIcon className="w-8 h-8" />
            </div>
            <div className="stat-title">Avg Revenue/Meeting</div>
            <div className="stat-value text-info">{formatCurrency(averageRevenuePerMeeting)}</div>
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
        `}
      </style>
      <div 
        className={`modal fullscreen-modal ${isOpen ? 'modal-open' : ''}`}
      >
      <div className="modal-box w-full h-full overflow-y-auto p-0 m-0">
        <div className="p-6 h-full">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="avatar">
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
                            <span class="text-xl font-bold">${getInitials(employee.display_name)}</span>
                          </div>
                        `;
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="placeholder">
                  <div className="bg-primary text-primary-content rounded-full w-16 h-16 flex items-center justify-center">
                    <span className="text-xl font-bold">
                      {getInitials(employee.display_name)}
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div>
              <h2 className="text-2xl font-bold">{employee.display_name}</h2>
              <p className="text-gray-600">{employee.email}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="badge badge-primary">{getRoleDisplayName(employee.bonuses_role)}</span>
                <span className="badge badge-outline">{employee.department}</span>
              </div>
            </div>
          </div>
          <button 
            className="btn btn-sm btn-circle btn-ghost"
            onClick={onClose}
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
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
                <div className="radial-progress text-primary" style={{"--value": completionRate}} role="progressbar">
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

        {/* Activity Timeline */}
        <div className="card bg-base-100 shadow-sm">
          <div className="card-body">
            <h3 className="card-title flex items-center gap-2">
              <ClockIcon className="w-5 h-5" />
              Recent Activity
            </h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-base-200 rounded-lg">
                <div className="w-2 h-2 bg-primary rounded-full"></div>
                <div className="flex-1">
                  <div className="font-medium">Last Activity</div>
                  <div className="text-sm text-gray-600">{formatDate(metrics.last_activity)}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-base-200 rounded-lg">
                <div className="w-2 h-2 bg-success rounded-full"></div>
                <div className="flex-1">
                  <div className="font-medium">Completion Rate</div>
                  <div className="text-sm text-gray-600">{completionRate}% of meetings completed</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-base-200 rounded-lg">
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
      </div>
      </div>
    </>
  );
};

export default EmployeeModal;
