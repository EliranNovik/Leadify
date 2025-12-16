import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import {
  XMarkIcon,
  UserIcon,
  PhoneIcon,
  EnvelopeIcon,
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  DevicePhoneMobileIcon,
  TableCellsIcon,
  Squares2X2Icon,
  ArrowUpIcon,
  ArrowDownIcon
} from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import { fetchLegacyInteractions } from '../lib/legacyInteractionsApi';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';

interface EmployeeStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  employee: {
    id: number;
    display_name: string;
    photo_url?: string | null;
  } | null;
}

interface FullEmployeeData {
  id: number;
  display_name: string;
  photo_url?: string | null;
  photo?: string | null;
  phone?: string | null;
  mobile?: string | null;
  phone_ext?: string | null;
  mobile_ext?: string | null;
  email?: string | null;
  bonuses_role?: string | null;
  department?: string | null;
}

// Helper function to map role codes to display names
const getRoleDisplayName = (roleCode: string | null | undefined): string => {
  if (!roleCode) return 'No role';
  
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
  
  return roleMap[roleCode.toLowerCase()] || roleCode || 'No role';
};

interface CallStatusStats {
  answered: number;
  noAnswer: number;
  busy: number;
  failed: number;
  cancelled: number;
  redirected: number;
  unknown: number;
}

interface DirectionStats {
  inbound: number;
  outbound: number;
}

interface InteractionStats {
  whatsapp: number;
  email: number;
  phone: number;
  // Call-specific stats
  callStats: {
    totalDuration: number; // Total duration in seconds
    statusBreakdown: CallStatusStats;
  };
  // Direction stats for all interaction types
  directionStats: {
    whatsapp: DirectionStats;
    email: DirectionStats;
    phone: DirectionStats;
  };
}

const EmployeeStatsModal: React.FC<EmployeeStatsModalProps> = ({
  isOpen,
  onClose,
  employee
}) => {
  const [statsFromDate, setStatsFromDate] = useState<string>('');
  const [statsToDate, setStatsToDate] = useState<string>('');
  const [stats, setStats] = useState<InteractionStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [fullEmployeeData, setFullEmployeeData] = useState<FullEmployeeData | null>(null);
  const [compareAll, setCompareAll] = useState(false);
  const [allEmployeesStats, setAllEmployeesStats] = useState<Array<{ employee: any; stats: InteractionStats }>>([]);
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [allEmployees, setAllEmployees] = useState<Array<{ id: number; display_name: string; photo_url?: string | null; photo?: string | null; bonuses_role?: string | null }>>([]);
  const [showEmployeeDropdown, setShowEmployeeDropdown] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('cards');

  // Fetch all employees for filter dropdown (only active users)
  useEffect(() => {
    const fetchAllEmployees = async () => {
      if (!isOpen) return;
      
      try {
        // Fetch employees with active users only
        const { data, error } = await supabase
          .from('users')
          .select(`
            employee_id,
            tenants_employee!employee_id (
              id,
              display_name,
              photo_url,
              photo,
              bonuses_role
            )
          `)
          .eq('is_active', true)
          .not('employee_id', 'is', null);
        
        if (error) {
          console.error('Error fetching all employees:', error);
          return;
        }
        
        // Extract employee data from the join
        const employees: Array<{ id: number; display_name: string; photo_url?: string | null; photo?: string | null; bonuses_role?: string | null }> = [];
        (data || []).forEach((user: any) => {
          const emp = user.tenants_employee;
          if (emp && emp.display_name) {
            employees.push({
              id: emp.id,
              display_name: emp.display_name,
              photo_url: emp.photo_url || null,
              photo: emp.photo || null,
              bonuses_role: emp.bonuses_role || null
            });
          }
        });
        
        employees.sort((a, b) => {
          return a.display_name.localeCompare(b.display_name);
        });
        
        setAllEmployees(employees);
      } catch (error) {
        console.error('Error fetching all employees:', error);
      }
    };
    
    fetchAllEmployees();
  }, [isOpen]);

  // Fetch full employee data when modal opens
  useEffect(() => {
    const fetchFullEmployeeData = async () => {
      if (!employee || !isOpen) return;
      
      try {
        const { data, error } = await supabase
          .from('tenants_employee')
          .select(`
            id, 
            display_name, 
            photo_url, 
            photo, 
            phone, 
            mobile, 
            phone_ext, 
            mobile_ext,
            bonuses_role,
            department_id,
            tenant_departement!department_id (
              id,
              name
            )
          `)
          .eq('id', employee.id)
          .single();
        
        if (error) {
          console.error('Error fetching employee data:', error);
          // Fallback to basic employee data
          setFullEmployeeData({
            id: employee.id,
            display_name: employee.display_name,
            photo_url: employee.photo_url || null,
            photo: null,
            phone: null,
            mobile: null,
            phone_ext: null,
            mobile_ext: null,
            email: null,
            bonuses_role: null,
            department: null
          });
          return;
        }
        
        // Fetch email from users table
        let email = null;
        const { data: userData } = await supabase
          .from('users')
          .select('email')
          .eq('employee_id', employee.id)
          .maybeSingle();
        
        if (userData) {
          email = userData.email;
        }
        
        // Get department name from the join
        const departmentName = (data as any).tenant_departement?.name || null;
        
        setFullEmployeeData({
          id: data.id,
          display_name: data.display_name,
          photo_url: data.photo_url || null,
          photo: data.photo || null,
          phone: data.phone || null,
          mobile: data.mobile || null,
          phone_ext: data.phone_ext || null,
          mobile_ext: data.mobile_ext || null,
          email: email,
          bonuses_role: data.bonuses_role || null,
          department: departmentName
        });
      } catch (error) {
        console.error('Error fetching full employee data:', error);
          // Fallback to basic employee data
          setFullEmployeeData({
            id: employee.id,
            display_name: employee.display_name,
            photo_url: employee.photo_url || null,
            photo: null,
            phone: null,
            mobile: null,
            phone_ext: null,
            mobile_ext: null,
            email: null,
            bonuses_role: null,
            department: null
          });
      }
    };
    
    fetchFullEmployeeData();
  }, [employee, isOpen]);

  // Set default dates to current day only
  useEffect(() => {
    if (isOpen) {
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      
      setStatsToDate(todayStr);
      setStatsFromDate(todayStr);
    }
  }, [isOpen]);

  // Fetch statistics when dates change or modal opens
  useEffect(() => {
    if (isOpen && statsFromDate && statsToDate) {
      if (compareAll) {
        fetchAllEmployeesStats();
      } else if (employee) {
        fetchEmployeeStats();
      }
    }
  }, [isOpen, employee?.id, statsFromDate, statsToDate, compareAll]);

  const fetchEmployeeStats = async () => {
    if (!employee) return;

    setLoading(true);
    try {
      const startDate = `${statsFromDate}T00:00:00`;
      const endDate = `${statsToDate}T23:59:59`;

      // Get employee email for filtering
      let employeeEmail: string | null = null;
      if (fullEmployeeData?.email) {
        employeeEmail = fullEmployeeData.email.toLowerCase();
      } else {
        // Fetch email if not already loaded
        const { data: userData } = await supabase
          .from('users')
          .select('email')
          .eq('employee_id', employee.id)
          .maybeSingle();
        if (userData?.email) {
          employeeEmail = userData.email.toLowerCase();
        }
      }

      const initialStats: InteractionStats = {
        whatsapp: 0,
        email: 0,
        phone: 0,
        callStats: {
          totalDuration: 0,
          statusBreakdown: {
            answered: 0,
            noAnswer: 0,
            busy: 0,
            failed: 0,
            cancelled: 0,
            redirected: 0,
            unknown: 0
          }
        },
        directionStats: {
          whatsapp: { inbound: 0, outbound: 0 },
          email: { inbound: 0, outbound: 0 },
          phone: { inbound: 0, outbound: 0 }
        }
      };

      // Fetch WhatsApp messages from new leads (whatsapp_messages table)
      const { data: whatsappMessages } = await supabase
        .from('whatsapp_messages')
        .select('id, direction')
        .eq('sender_name', employee.display_name)
        .gte('sent_at', startDate)
        .lte('sent_at', endDate);

      whatsappMessages?.forEach((msg: any) => {
        initialStats.whatsapp++;
        const direction = msg.direction?.toLowerCase();
        if (direction === 'inbound' || direction === 'in') {
          initialStats.directionStats.whatsapp.inbound++;
        } else if (direction === 'outbound' || direction === 'out' || direction === 'outgoing') {
          initialStats.directionStats.whatsapp.outbound++;
        }
      });

      // Fetch emails - filter by employee email
      if (employeeEmail) {
        // Fetch inbound emails where recipient_list contains employee email
        const { data: inboundEmails } = await supabase
          .from('emails')
          .select('id, direction, sender_email, recipient_list')
          .in('direction', ['inbound', 'in', 'incoming'])
          .ilike('recipient_list', `%${employeeEmail}%`)
          .gte('sent_at', startDate)
          .lte('sent_at', endDate);

        // Fetch outbound emails where sender_email matches employee email
        const { data: outboundEmails } = await supabase
          .from('emails')
          .select('id, direction, sender_email, recipient_list')
          .in('direction', ['outbound', 'out', 'outgoing'])
          .eq('sender_email', employeeEmail)
          .gte('sent_at', startDate)
          .lte('sent_at', endDate);

        // Process inbound emails
        inboundEmails?.forEach((email: any) => {
          const senderEmail = email.sender_email?.toLowerCase() || '';
          
          // Skip if sender is from office domain (internal email from another employee)
          // But allow if it's from the employee themselves (in case they sent to themselves)
          if (senderEmail.includes('@lawoffice.org.il') && senderEmail !== employeeEmail) {
            return;
          }
          
          initialStats.email++;
          initialStats.directionStats.email.inbound++;
        });

        // Process outbound emails
        outboundEmails?.forEach((email: any) => {
          const recipientList = email.recipient_list?.toLowerCase() || '';
          
          // Skip if recipient contains office domain (but allow if employee is in recipients - they sent to themselves)
          if (recipientList.includes('@lawoffice.org.il') && !recipientList.includes(employeeEmail)) {
            return;
          }
          
          initialStats.email++;
          initialStats.directionStats.email.outbound++;
        });
      }

      // Fetch phone calls from new leads (call_logs table) with detailed info
      const { data: calls } = await supabase
        .from('call_logs')
        .select('id, duration, status, direction')
        .eq('employee_id', employee.id)
        .gte('cdate', startDate)
        .lte('cdate', endDate);

      calls?.forEach((call: any) => {
        initialStats.phone++;
        
        // Track direction
        const direction = call.direction?.toLowerCase();
        if (direction === 'inbound' || direction === 'in') {
          initialStats.directionStats.phone.inbound++;
        } else if (direction === 'outbound' || direction === 'out') {
          initialStats.directionStats.phone.outbound++;
        }
        
        // Track duration (in seconds)
        if (call.duration && typeof call.duration === 'number') {
          initialStats.callStats.totalDuration += call.duration;
        }
        
        // Track status
        const status = call.status?.toLowerCase() || 'unknown';
        if (status === 'answered') {
          initialStats.callStats.statusBreakdown.answered++;
        } else if (status === 'no+answer' || status === 'no answer' || status === 'noanswer') {
          initialStats.callStats.statusBreakdown.noAnswer++;
        } else if (status === 'busy') {
          initialStats.callStats.statusBreakdown.busy++;
        } else if (status === 'failed' || status === 'congestion') {
          initialStats.callStats.statusBreakdown.failed++;
        } else if (status === 'cancelled' || status === 'cancel') {
          initialStats.callStats.statusBreakdown.cancelled++;
        } else if (status === 'redirected') {
          initialStats.callStats.statusBreakdown.redirected++;
        } else {
          initialStats.callStats.statusBreakdown.unknown++;
        }
      });

      // Fetch legacy lead interactions from leads_leadinteractions table
      const employeeIdStr = String(employee.id);
      const { data: legacyInteractions } = await supabase
        .from('leads_leadinteractions')
        .select('kind, employee_id, creator_id, direction, minutes')
        .gte('cdate', startDate)
        .lte('cdate', endDate)
        .or(`employee_id.eq.${employeeIdStr},creator_id.eq.${employeeIdStr}`);

      legacyInteractions?.forEach((interaction: any) => {
        const kind = interaction.kind;
        const direction = interaction.direction?.toLowerCase();
        
        // Map kind to interaction type
        // 'w' = WhatsApp, 'e' = Email, 'c' = Call/Phone, others = Manual
        if (kind === 'w') {
          initialStats.whatsapp++;
          if (direction === 'inbound' || direction === 'in') {
            initialStats.directionStats.whatsapp.inbound++;
          } else if (direction === 'outbound' || direction === 'out') {
            initialStats.directionStats.whatsapp.outbound++;
          }
        } else if (kind === 'e') {
          initialStats.email++;
          if (direction === 'inbound' || direction === 'in') {
            initialStats.directionStats.email.inbound++;
          } else if (direction === 'outbound' || direction === 'out') {
            initialStats.directionStats.email.outbound++;
          }
        } else if (kind === 'c') {
          initialStats.phone++;
          if (direction === 'inbound' || direction === 'in' || direction === 'i') {
            initialStats.directionStats.phone.inbound++;
          } else if (direction === 'outbound' || direction === 'out' || direction === 'o') {
            initialStats.directionStats.phone.outbound++;
          }
          // Add duration from legacy interactions (minutes to seconds)
          if (interaction.minutes && typeof interaction.minutes === 'number') {
            initialStats.callStats.totalDuration += interaction.minutes * 60;
          }
        }
        // All other kinds are ignored (manual interactions removed)
      });

      setStats(initialStats);
    } catch (error) {
      console.error('Error fetching employee stats:', error);
    } finally {
      setLoading(false);
    }
  };

  // Helper function to fetch stats for a single employee (reusable for compare all)
  const fetchStatsForEmployee = async (emp: { id: number; display_name: string }): Promise<InteractionStats> => {
    const startDate = `${statsFromDate}T00:00:00`;
    const endDate = `${statsToDate}T23:59:59`;

    // Get employee email for filtering
    const { data: userData } = await supabase
      .from('users')
      .select('email')
      .eq('employee_id', emp.id)
      .maybeSingle();
    const employeeEmail = userData?.email?.toLowerCase() || null;

    const initialStats: InteractionStats = {
      whatsapp: 0,
      email: 0,
      phone: 0,
      callStats: {
        totalDuration: 0,
        statusBreakdown: {
          answered: 0,
          noAnswer: 0,
          busy: 0,
          failed: 0,
          cancelled: 0,
          redirected: 0,
          unknown: 0
        }
      },
      directionStats: {
        whatsapp: { inbound: 0, outbound: 0 },
        email: { inbound: 0, outbound: 0 },
        phone: { inbound: 0, outbound: 0 }
      }
    };

    // Fetch WhatsApp messages
    const { data: whatsappMessages } = await supabase
      .from('whatsapp_messages')
      .select('id, direction')
      .eq('sender_name', emp.display_name)
      .gte('sent_at', startDate)
      .lte('sent_at', endDate);

    whatsappMessages?.forEach((msg: any) => {
      initialStats.whatsapp++;
      const direction = msg.direction?.toLowerCase();
      if (direction === 'inbound' || direction === 'in') {
        initialStats.directionStats.whatsapp.inbound++;
      } else if (direction === 'outbound' || direction === 'out' || direction === 'outgoing') {
        initialStats.directionStats.whatsapp.outbound++;
      }
    });

    // Fetch emails - filter by employee email
    if (employeeEmail) {
      // Fetch inbound emails where recipient_list contains employee email
      const { data: inboundEmails } = await supabase
        .from('emails')
        .select('id, direction, sender_email, recipient_list')
        .in('direction', ['inbound', 'in', 'incoming'])
        .ilike('recipient_list', `%${employeeEmail}%`)
        .gte('sent_at', startDate)
        .lte('sent_at', endDate);

      // Fetch outbound emails where sender_email matches employee email
      const { data: outboundEmails } = await supabase
        .from('emails')
        .select('id, direction, sender_email, recipient_list')
        .in('direction', ['outbound', 'out', 'outgoing'])
        .eq('sender_email', employeeEmail)
        .gte('sent_at', startDate)
        .lte('sent_at', endDate);

      // Process inbound emails
      inboundEmails?.forEach((email: any) => {
        const senderEmail = email.sender_email?.toLowerCase() || '';
        
        // Skip if sender is from office domain (internal email from another employee)
        // But allow if it's from the employee themselves (in case they sent to themselves)
        if (senderEmail.includes('@lawoffice.org.il') && senderEmail !== employeeEmail) {
          return;
        }
        
        initialStats.email++;
        initialStats.directionStats.email.inbound++;
      });

      // Process outbound emails
      outboundEmails?.forEach((email: any) => {
        const recipientList = email.recipient_list?.toLowerCase() || '';
        
        // Skip if recipient contains office domain (but allow if employee is in recipients - they sent to themselves)
        if (recipientList.includes('@lawoffice.org.il') && !recipientList.includes(employeeEmail)) {
          return;
        }
        
        initialStats.email++;
        initialStats.directionStats.email.outbound++;
      });
    }

    // Fetch phone calls
    const { data: calls } = await supabase
      .from('call_logs')
      .select('id, duration, status, direction')
      .eq('employee_id', emp.id)
      .gte('cdate', startDate)
      .lte('cdate', endDate);

    calls?.forEach((call: any) => {
      initialStats.phone++;
      const direction = call.direction?.toLowerCase();
      if (direction === 'inbound' || direction === 'in') {
        initialStats.directionStats.phone.inbound++;
      } else if (direction === 'outbound' || direction === 'out') {
        initialStats.directionStats.phone.outbound++;
      }
      if (call.duration && typeof call.duration === 'number') {
        initialStats.callStats.totalDuration += call.duration;
      }
      const status = call.status?.toLowerCase() || 'unknown';
      if (status === 'answered') {
        initialStats.callStats.statusBreakdown.answered++;
      } else if (status === 'no+answer' || status === 'no answer' || status === 'noanswer') {
        initialStats.callStats.statusBreakdown.noAnswer++;
      } else if (status === 'busy') {
        initialStats.callStats.statusBreakdown.busy++;
      } else if (status === 'failed' || status === 'congestion') {
        initialStats.callStats.statusBreakdown.failed++;
      } else if (status === 'cancelled' || status === 'cancel') {
        initialStats.callStats.statusBreakdown.cancelled++;
      } else if (status === 'redirected') {
        initialStats.callStats.statusBreakdown.redirected++;
      } else {
        initialStats.callStats.statusBreakdown.unknown++;
      }
    });

    // Fetch legacy interactions
    const employeeIdStr = String(emp.id);
    const { data: legacyInteractions } = await supabase
      .from('leads_leadinteractions')
      .select('kind, employee_id, creator_id, direction, minutes')
      .gte('cdate', startDate)
      .lte('cdate', endDate)
      .or(`employee_id.eq.${employeeIdStr},creator_id.eq.${employeeIdStr}`);

    legacyInteractions?.forEach((interaction: any) => {
      const kind = interaction.kind;
      const direction = interaction.direction?.toLowerCase();
      
      if (kind === 'w') {
        initialStats.whatsapp++;
        if (direction === 'inbound' || direction === 'in') {
          initialStats.directionStats.whatsapp.inbound++;
        } else if (direction === 'outbound' || direction === 'out') {
          initialStats.directionStats.whatsapp.outbound++;
        }
      } else if (kind === 'e') {
        initialStats.email++;
        if (direction === 'inbound' || direction === 'in') {
          initialStats.directionStats.email.inbound++;
        } else if (direction === 'outbound' || direction === 'out') {
          initialStats.directionStats.email.outbound++;
        }
      } else if (kind === 'c') {
        initialStats.phone++;
        if (direction === 'inbound' || direction === 'in' || direction === 'i') {
          initialStats.directionStats.phone.inbound++;
        } else if (direction === 'outbound' || direction === 'out' || direction === 'o') {
          initialStats.directionStats.phone.outbound++;
        }
        if (interaction.minutes && typeof interaction.minutes === 'number') {
          initialStats.callStats.totalDuration += interaction.minutes * 60;
        }
      }
    });

    return initialStats;
  };

  const fetchAllEmployeesStats = async () => {
    if (!statsFromDate || !statsToDate) return;

    setLoading(true);
    try {
      // Fetch stats for all employees (filtering happens client-side)
      const statsPromises = allEmployees.map(emp => 
        fetchStatsForEmployee(emp).then(stats => ({ employee: emp, stats }))
      );

      const results = await Promise.all(statsPromises);
      setAllEmployeesStats(results);
    } catch (error) {
      console.error('Error fetching all employees stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;
  
  // If comparing all, don't require single employee data
  if (!compareAll && (!employee || !fullEmployeeData)) return null;

  const initials = fullEmployeeData?.display_name
    ? fullEmployeeData.display_name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : '';

  return (
    <div className="fixed inset-0 z-[9999] overflow-y-auto bg-black bg-opacity-50">
      <div className="bg-white w-full h-full flex flex-col">
        {/* Header with Background Image - Only show when not comparing all */}
        {!compareAll && fullEmployeeData && (
        <div className="mb-8 relative">
          {/* Background Image with Overlay */}
          {fullEmployeeData.photo && (
            <div 
              className="absolute inset-0 rounded-lg bg-cover bg-center bg-no-repeat"
              style={{ backgroundImage: `url(${fullEmployeeData.photo})` }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/40 to-black/60 rounded-lg"></div>
            </div>
          )}
          <div className={`relative z-10 p-3 sm:p-6 rounded-lg ${fullEmployeeData.photo ? 'text-white' : ''}`}>
            {/* Mobile Layout */}
            <div className="sm:hidden">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="avatar flex-shrink-0">
                    {fullEmployeeData.photo_url ? (
                      <div className="rounded-full w-16">
                        <img 
                          src={fullEmployeeData.photo_url} 
                          alt={fullEmployeeData.display_name}
                          className="w-full h-full object-cover rounded-full"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            const parent = target.parentElement;
                            if (parent) {
                              parent.innerHTML = `
                                <div class="bg-primary text-primary-content rounded-full w-16 h-16 flex items-center justify-center">
                                  <span class="text-lg font-bold">${initials}</span>
                                </div>
                              `;
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <div className="placeholder">
                        <div className="bg-primary text-primary-content rounded-full w-16 h-16 flex items-center justify-center">
                          <span className="text-lg font-bold">{initials}</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    {/* Mobile Role and Department Badges - Centered at Top */}
                    {(fullEmployeeData.bonuses_role || fullEmployeeData.department) && (
                      <div className="flex items-center justify-center gap-2 mb-2">
                        {fullEmployeeData.bonuses_role && (
                          <span className="badge badge-primary badge-md px-3 py-1.5 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-0 text-sm font-semibold shadow-lg">
                            {getRoleDisplayName(fullEmployeeData.bonuses_role)}
                          </span>
                        )}
                        {fullEmployeeData.department && (
                          <span className={`badge badge-md px-3 py-1.5 text-sm font-semibold shadow-lg ${fullEmployeeData.photo ? 'bg-white/20 text-white border-white/30 backdrop-blur-sm' : 'badge-outline'}`}>
                            {fullEmployeeData.department}
                          </span>
                        )}
                      </div>
                    )}
                    
                    <h2 className={`text-xl font-bold mb-1 truncate ${fullEmployeeData.photo ? 'text-white drop-shadow-lg' : ''}`}>
                      {fullEmployeeData.display_name}
                    </h2>
                    {fullEmployeeData.email && (
                      <p className={`text-sm mb-2 truncate ${fullEmployeeData.photo ? 'text-white/90 drop-shadow-md' : 'text-gray-600'}`}>
                        {fullEmployeeData.email}
                      </p>
                    )}
                    
                    {/* Mobile Contact Info */}
                    {(fullEmployeeData.phone || fullEmployeeData.mobile || fullEmployeeData.phone_ext || fullEmployeeData.mobile_ext) && (
                      <div className="flex flex-wrap items-center gap-2 text-xs mt-1 mb-2">
                        {fullEmployeeData.phone && (
                          <div className={`flex items-center gap-1 ${fullEmployeeData.photo ? 'text-white/90' : 'text-gray-700'}`}>
                            <PhoneIcon className={`w-3 h-3 ${fullEmployeeData.photo ? 'text-white/80' : 'text-gray-500'}`} />
                            <span>{fullEmployeeData.phone}</span>
                          </div>
                        )}
                        {fullEmployeeData.mobile && (
                          <div className={`flex items-center gap-1 ${fullEmployeeData.photo ? 'text-white/90' : 'text-gray-700'}`}>
                            <DevicePhoneMobileIcon className={`w-3 h-3 ${fullEmployeeData.photo ? 'text-white/80' : 'text-gray-500'}`} />
                            <span>{fullEmployeeData.mobile}</span>
                          </div>
                        )}
                        {fullEmployeeData.phone_ext && (
                          <div className={`flex items-center gap-1 ${fullEmployeeData.photo ? 'text-white/90' : 'text-gray-700'}`}>
                            <span className={`text-xs ${fullEmployeeData.photo ? 'text-white/70' : 'text-gray-500'}`}>Ext:</span>
                            <span>{fullEmployeeData.phone_ext}</span>
                          </div>
                        )}
                        {fullEmployeeData.mobile_ext && (
                          <div className={`flex items-center gap-1 ${fullEmployeeData.photo ? 'text-white/90' : 'text-gray-700'}`}>
                            <span className={`text-xs ${fullEmployeeData.photo ? 'text-white/70' : 'text-gray-500'}`}>Mob Ext:</span>
                            <span>{fullEmployeeData.mobile_ext}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <button 
                  className={`btn btn-md btn-circle flex-shrink-0 ${fullEmployeeData.photo ? 'btn-ghost text-white hover:bg-white/20' : 'btn-ghost'}`}
                  onClick={onClose}
                >
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>
            </div>

            {/* Desktop Layout */}
            <div className="hidden sm:block">
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-start gap-6 flex-1">
                  <div className="avatar">
                    {fullEmployeeData.photo_url ? (
                      <div className="rounded-full w-32 sm:w-40">
                        <img 
                          src={fullEmployeeData.photo_url} 
                          alt={fullEmployeeData.display_name}
                          className="w-full h-full object-cover rounded-full"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            const parent = target.parentElement;
                            if (parent) {
                              parent.innerHTML = `
                                <div class="bg-primary text-primary-content rounded-full w-32 sm:w-40 h-32 sm:h-40 flex items-center justify-center">
                                  <span class="text-3xl sm:text-4xl font-bold">${initials}</span>
                                </div>
                              `;
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <div className="placeholder">
                        <div className="bg-primary text-primary-content rounded-full w-32 sm:w-40 h-32 sm:h-40 flex items-center justify-center">
                          <span className="text-3xl sm:text-4xl font-bold">{initials}</span>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex-1">
                    <h2 className={`text-3xl font-bold mb-2 ${fullEmployeeData.photo ? 'text-white drop-shadow-lg' : ''}`}>
                      {fullEmployeeData.display_name}
                    </h2>
                    {fullEmployeeData.email && (
                      <p className={`text-lg mb-3 ${fullEmployeeData.photo ? 'text-white/90 drop-shadow-md' : 'text-gray-600'}`}>
                        {fullEmployeeData.email}
                      </p>
                    )}
                    
                    {/* Desktop Contact Information */}
                    <div className="flex flex-wrap items-center gap-6">
                      {fullEmployeeData.phone && (
                        <div className={`flex items-center gap-2 ${fullEmployeeData.photo ? 'text-white/90' : 'text-gray-700'}`}>
                          <PhoneIcon className={`w-5 h-5 ${fullEmployeeData.photo ? 'text-white/80' : 'text-gray-500'}`} />
                          <span className="text-base">{fullEmployeeData.phone}</span>
                        </div>
                      )}
                      {fullEmployeeData.mobile && (
                        <div className={`flex items-center gap-2 ${fullEmployeeData.photo ? 'text-white/90' : 'text-gray-700'}`}>
                          <DevicePhoneMobileIcon className={`w-5 h-5 ${fullEmployeeData.photo ? 'text-white/80' : 'text-gray-500'}`} />
                          <span className="text-base">{fullEmployeeData.mobile}</span>
                        </div>
                      )}
                      {fullEmployeeData.phone_ext && (
                        <div className={`flex items-center gap-2 ${fullEmployeeData.photo ? 'text-white/90' : 'text-gray-700'}`}>
                          <PhoneIcon className={`w-5 h-5 ${fullEmployeeData.photo ? 'text-white/80' : 'text-gray-500'}`} />
                          <span className={`text-sm ${fullEmployeeData.photo ? 'text-white/70' : 'text-gray-500'}`}>Ext:</span>
                          <span className="text-base">{fullEmployeeData.phone_ext}</span>
                        </div>
                      )}
                      {fullEmployeeData.mobile_ext && (
                        <div className={`flex items-center gap-2 ${fullEmployeeData.photo ? 'text-white/90' : 'text-gray-700'}`}>
                          <DevicePhoneMobileIcon className={`w-5 h-5 ${fullEmployeeData.photo ? 'text-white/80' : 'text-gray-500'}`} />
                          <span className={`text-sm ${fullEmployeeData.photo ? 'text-white/70' : 'text-gray-500'}`}>Mob Ext:</span>
                          <span className="text-base">{fullEmployeeData.mobile_ext}</span>
                        </div>
                      )}
                      {fullEmployeeData.bonuses_role && (
                        <div className={`flex items-center gap-2 ${fullEmployeeData.photo ? 'text-white/90' : 'text-gray-700'}`}>
                          <span className={`text-sm ${fullEmployeeData.photo ? 'text-white/70' : 'text-gray-500'}`}>Role:</span>
                          <span className="badge badge-primary badge-sm px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-0 text-xs">
                            {getRoleDisplayName(fullEmployeeData.bonuses_role)}
                          </span>
                        </div>
                      )}
                      {fullEmployeeData.department && (
                        <div className={`flex items-center gap-2 ${fullEmployeeData.photo ? 'text-white/90' : 'text-gray-700'}`}>
                          <span className={`text-sm ${fullEmployeeData.photo ? 'text-white/70' : 'text-gray-500'}`}>Dept:</span>
                          <span className={`badge badge-sm px-2 py-1 text-xs ${fullEmployeeData.photo ? 'bg-white/20 text-white border-white/30 backdrop-blur-sm' : 'badge-outline'}`}>
                            {fullEmployeeData.department}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                
                <button 
                  className={`btn btn-md btn-circle ${fullEmployeeData.photo ? 'btn-ghost text-white hover:bg-white/20' : 'btn-ghost'}`}
                  onClick={onClose}
                >
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {compareAll && (
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold">Employee Comparison</h2>
              <button
                className="btn btn-ghost btn-circle"
                onClick={onClose}
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
          )}

          {/* Compare All Button, View Toggle, and Employee Filter */}
          <div className="mb-6 flex flex-col sm:flex-row gap-4 items-start sm:items-end">
            <button
              onClick={() => {
                setCompareAll(!compareAll);
                if (!compareAll) {
                  setStats(null);
                  setAllEmployeesStats([]);
                }
              }}
              className={`btn ${compareAll ? 'btn-primary' : 'btn-outline'} flex-shrink-0`}
            >
              {compareAll ? 'View Single Employee' : 'Compare All'}
            </button>

            {compareAll && (
              <>
                {/* View Mode Toggle */}
                <button
                  className={`btn ${viewMode === 'cards' ? 'btn-primary' : 'btn-outline'} flex-shrink-0 flex items-center justify-center`}
                  onClick={() => setViewMode(viewMode === 'table' ? 'cards' : 'table')}
                  title={viewMode === 'cards' ? 'Switch to Table View' : 'Switch to Cards View'}
                >
                  {viewMode === 'cards' ? (
                    <TableCellsIcon className="w-5 h-5" />
                  ) : (
                    <Squares2X2Icon className="w-5 h-5" />
                  )}
                </button>

                {/* Employee Search Filter */}
                <div className="flex-1 w-full sm:w-auto">
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    placeholder="Search employee..."
                    value={employeeFilter}
                    onChange={(e) => {
                      setEmployeeFilter(e.target.value);
                    }}
                  />
                </div>
              </>
            )}
          </div>

          {/* Date Filter */}
          <div className="mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  From Date
                </label>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={statsFromDate}
                  onChange={(e) => setStatsFromDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  To Date
                </label>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={statsToDate}
                  onChange={(e) => setStatsToDate(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={compareAll ? fetchAllEmployeesStats : fetchEmployeeStats}
                  className="btn btn-primary w-full"
                  disabled={loading}
                >
                  {loading ? 'Loading...' : 'Refresh Stats'}
                </button>
              </div>
            </div>
          </div>

          {/* Statistics Table */}
          {loading ? (
            <div className="flex justify-center items-center py-12">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : compareAll && allEmployeesStats.length > 0 ? (
            viewMode === 'cards' ? (
              /* Card View for All Employees */
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {allEmployeesStats
                  .filter(({ employee }) => {
                    if (!employeeFilter.trim()) return true;
                    return employee.display_name?.toLowerCase().includes(employeeFilter.toLowerCase().trim());
                  })
                  .map(({ employee, stats }) => {
                  const totalDuration = stats.callStats.totalDuration;
                  const hours = Math.floor(totalDuration / 3600);
                  const minutes = Math.floor((totalDuration % 3600) / 60);
                  const seconds = totalDuration % 60;
                  const durationStr = hours > 0 
                    ? `${hours}h ${minutes}m ${seconds}s`
                    : minutes > 0 
                    ? `${minutes}m ${seconds}s`
                    : `${seconds}s`;
                  
                  const employeeInitials = employee.display_name
                    .split(' ')
                    .map((n: string) => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2);
                  
                  // Find employee photo_url and photo from allEmployees array
                  const employeeData = allEmployees.find(emp => emp.id === employee.id);
                  const photoUrl = employeeData?.photo_url || null;
                  const backgroundPhoto = employeeData?.photo || null;
                  const role = employeeData?.bonuses_role || null;
                  
                  return (
                    <div key={employee.id} className="bg-white border border-gray-200 rounded-lg p-4 relative overflow-hidden" style={{
                      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                      transform: 'translateZ(0)'
                    }}>
                      {/* Background Image with Overlay */}
                      {backgroundPhoto && (
                        <div 
                          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
                          style={{ backgroundImage: `url(${backgroundPhoto})` }}
                        >
                          <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/40 to-black/60"></div>
                        </div>
                      )}
                      
                      {/* Role Badge - Top Right Corner */}
                      {role && (
                        <div className="absolute top-2 right-2 z-20">
                          <span className="badge badge-primary badge-sm px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-0 text-xs font-semibold shadow-lg">
                            {getRoleDisplayName(role)}
                          </span>
                        </div>
                      )}
                      
                      {/* Content */}
                      <div className={`relative z-10 ${backgroundPhoto ? 'text-white' : ''}`}>
                      {/* Profile Image */}
                      <div className="flex items-center justify-center mb-4">
                        {photoUrl ? (
                          <img
                            src={photoUrl}
                            alt={employee.display_name}
                            className="w-20 h-20 rounded-full object-cover"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              const parent = target.parentElement;
                              if (parent) {
                                const fallback = document.createElement('div');
                                fallback.className = 'w-20 h-20 rounded-full flex items-center justify-center bg-primary text-primary-content';
                                fallback.textContent = employeeInitials;
                                parent.appendChild(fallback);
                              }
                            }}
                          />
                        ) : (
                          <div className="w-20 h-20 rounded-full flex items-center justify-center bg-primary text-primary-content text-xl font-bold">
                            {employeeInitials}
                          </div>
                        )}
                      </div>
                      
                      {/* Employee Name */}
                      <h3 className={`text-xl font-semibold text-center mb-4 ${backgroundPhoto ? 'drop-shadow-lg' : ''}`}>{employee.display_name}</h3>
                      
                      {/* Stats */}
                      <div className={`space-y-3 ${backgroundPhoto ? 'text-white' : ''}`}>
                        {/* WhatsApp Stats */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <FaWhatsapp className={`w-5 h-5 ${backgroundPhoto ? 'text-white' : 'text-green-500'}`} />
                            <span className={`text-base font-medium ${backgroundPhoto ? 'text-white' : 'text-gray-600'}`}>WhatsApp</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1">
                              <ArrowDownIcon className={`w-4 h-4 ${backgroundPhoto ? 'text-white/80' : 'text-gray-500'}`} />
                              <span className="font-bold text-base">{stats.directionStats.whatsapp.inbound}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <ArrowUpIcon className={`w-4 h-4 ${backgroundPhoto ? 'text-white/80' : 'text-gray-500'}`} />
                              <span className="font-bold text-base">{stats.directionStats.whatsapp.outbound}</span>
                            </div>
                          </div>
                        </div>
                        
                        {/* Email Stats */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <EnvelopeIcon className={`w-5 h-5 ${backgroundPhoto ? 'text-white' : 'text-blue-500'}`} />
                            <span className={`text-base font-medium ${backgroundPhoto ? 'text-white' : 'text-gray-600'}`}>Email</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1">
                              <ArrowDownIcon className={`w-4 h-4 ${backgroundPhoto ? 'text-white/80' : 'text-gray-500'}`} />
                              <span className="font-bold text-base">{stats.directionStats.email.inbound}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <ArrowUpIcon className={`w-4 h-4 ${backgroundPhoto ? 'text-white/80' : 'text-gray-500'}`} />
                              <span className="font-bold text-base">{stats.directionStats.email.outbound}</span>
                            </div>
                          </div>
                        </div>
                        
                        {/* Phone Stats */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <PhoneIcon className={`w-5 h-5 ${backgroundPhoto ? 'text-white' : 'text-indigo-500'}`} />
                            <span className={`text-base font-medium ${backgroundPhoto ? 'text-white' : 'text-gray-600'}`}>Phone</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1">
                              <ArrowDownIcon className={`w-4 h-4 ${backgroundPhoto ? 'text-white/80' : 'text-gray-500'}`} />
                              <span className="font-bold text-base">{stats.directionStats.phone.inbound}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <ArrowUpIcon className={`w-4 h-4 ${backgroundPhoto ? 'text-white/80' : 'text-gray-500'}`} />
                              <span className="font-bold text-base">{stats.directionStats.phone.outbound}</span>
                            </div>
                          </div>
                        </div>
                        
                        <div className={`border-t pt-3 mt-3 ${backgroundPhoto ? 'border-white/20' : 'border-gray-200'}`}>
                          <div className="flex items-center justify-between">
                            <span className={`text-base font-semibold ${backgroundPhoto ? 'text-white' : 'text-gray-700'}`}>Total</span>
                            <span className="font-bold text-xl">{stats.whatsapp + stats.email + stats.phone}</span>
                          </div>
                          <div className="flex items-center justify-between mt-2">
                            <span className={`text-sm font-medium ${backgroundPhoto ? 'text-white/90' : 'text-gray-500'}`}>Call Duration</span>
                            <span className="text-base font-semibold">{durationStr}</span>
                          </div>
                        </div>
                      </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Comparison Table for All Employees */
              <div className="space-y-6">
                <div className="overflow-x-auto">
                  <table className="table w-full">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>WhatsApp</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Total Interactions</th>
                        <th>Call Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allEmployeesStats.map(({ employee, stats }) => {
                        const totalDuration = stats.callStats.totalDuration;
                        const hours = Math.floor(totalDuration / 3600);
                        const minutes = Math.floor((totalDuration % 3600) / 60);
                        const seconds = totalDuration % 60;
                        const durationStr = hours > 0 
                          ? `${hours}h ${minutes}m ${seconds}s`
                          : minutes > 0 
                          ? `${minutes}m ${seconds}s`
                          : `${seconds}s`;
                        
                        return (
                          <tr key={employee.id}>
                            <td className="font-medium">{employee.display_name}</td>
                            <td>{stats.whatsapp}</td>
                            <td>{stats.email}</td>
                            <td>{stats.phone}</td>
                            <td className="font-bold">{stats.whatsapp + stats.email + stats.phone}</td>
                            <td>{durationStr}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Detailed Comparison Graph */}
                <div className="mt-8">
                  <h4 className="text-2xl font-bold mb-6">Detailed Comparison</h4>
                  <div className="h-[1800px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        layout="vertical"
                        data={allEmployeesStats
                          .filter(({ employee }) => {
                            if (!employeeFilter.trim()) return true;
                            return employee.display_name?.toLowerCase().includes(employeeFilter.toLowerCase().trim());
                          })
                          .map(({ employee, stats }) => ({
                            name: employee.display_name,
                            WhatsApp: stats.whatsapp,
                            Email: stats.email,
                            Phone: stats.phone
                          }))}
                        margin={{ top: 30, right: 100, left: 160, bottom: 30 }}
                        barCategoryGap="30%"
                        barGap={8}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                          type="number"
                          stroke="#6b7280"
                          fontSize={14}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          type="category"
                          dataKey="name"
                          stroke="#6b7280"
                          fontSize={15}
                          tickLine={false}
                          axisLine={false}
                          width={150}
                          interval={0}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#1f2937',
                            border: 'none',
                            borderRadius: '8px',
                            color: '#f9fafb',
                            padding: '12px'
                          }}
                          itemStyle={{ color: '#f9fafb', padding: '4px' }}
                        />
                        <Legend
                          wrapperStyle={{ paddingTop: '20px' }}
                          iconType="circle"
                        />
                        <Bar dataKey="WhatsApp" fill="#25D366" radius={[0, 6, 6, 0]} barSize={50} />
                        <Bar dataKey="Email" fill="#3b82f6" radius={[0, 6, 6, 0]} barSize={50} />
                        <Bar dataKey="Phone" fill="#8b5cf6" radius={[0, 6, 6, 0]} barSize={50} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )
          ) : stats ? (
            <div className="space-y-6">
              <div className="overflow-x-auto">
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th>Interaction Type</th>
                      <th>Total</th>
                      <th>Inbound</th>
                      <th>Outbound</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <div className="flex items-center gap-2">
                          <FaWhatsapp className="w-5 h-5 text-green-500" />
                          <span>WhatsApp</span>
                        </div>
                      </td>
                      <td className="font-bold">{stats.whatsapp}</td>
                      <td>{stats.directionStats.whatsapp.inbound}</td>
                      <td>{stats.directionStats.whatsapp.outbound}</td>
                    </tr>
                    <tr>
                      <td>
                        <div className="flex items-center gap-2">
                          <EnvelopeIcon className="w-5 h-5 text-blue-500" />
                          <span>Email</span>
                        </div>
                      </td>
                      <td className="font-bold">{stats.email}</td>
                      <td>{stats.directionStats.email.inbound}</td>
                      <td>{stats.directionStats.email.outbound}</td>
                    </tr>
                    <tr>
                      <td>
                        <div className="flex items-center gap-2">
                          <PhoneIcon className="w-5 h-5 text-indigo-500" />
                          <span>Phone</span>
                        </div>
                      </td>
                      <td className="font-bold">{stats.phone}</td>
                      <td>{stats.directionStats.phone.inbound}</td>
                      <td>{stats.directionStats.phone.outbound}</td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr className="font-bold">
                      <td>Total</td>
                      <td>{stats.whatsapp + stats.email + stats.phone}</td>
                      <td>
                        {stats.directionStats.whatsapp.inbound + 
                         stats.directionStats.email.inbound + 
                         stats.directionStats.phone.inbound}
                      </td>
                      <td>
                        {stats.directionStats.whatsapp.outbound + 
                         stats.directionStats.email.outbound + 
                         stats.directionStats.phone.outbound}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Call Statistics */}
              <div className="p-6">
                <h4 className="text-lg font-semibold mb-4">Call Statistics</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Total Duration */}
                  <div>
                    <h5 className="text-sm font-medium text-gray-700 mb-2">Total Call Duration</h5>
                    <div className="text-2xl font-bold text-indigo-600">
                      {(() => {
                        const hours = Math.floor(stats.callStats.totalDuration / 3600);
                        const minutes = Math.floor((stats.callStats.totalDuration % 3600) / 60);
                        const seconds = stats.callStats.totalDuration % 60;
                        if (hours > 0) {
                          return `${hours}h ${minutes}m ${seconds}s`;
                        } else if (minutes > 0) {
                          return `${minutes}m ${seconds}s`;
                        } else {
                          return `${seconds}s`;
                        }
                      })()}
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      ({stats.callStats.totalDuration.toLocaleString()} seconds)
                    </p>
                  </div>

                  {/* Status Breakdown */}
                  <div>
                    <h5 className="text-sm font-medium text-gray-700 mb-3">Call Status Breakdown</h5>
                    <div className="flex flex-col md:flex-row gap-4 items-center md:items-start">
                      {/* Pie Chart */}
                      <div className="w-full md:w-48 h-48 flex-shrink-0">
                        {(() => {
                          const chartData = [
                            { name: 'Answered', value: stats.callStats.statusBreakdown.answered, color: '#10b981' },
                            { name: 'No Answer', value: stats.callStats.statusBreakdown.noAnswer, color: '#ef4444' },
                            { name: 'Busy', value: stats.callStats.statusBreakdown.busy, color: '#eab308' },
                            { name: 'Failed', value: stats.callStats.statusBreakdown.failed, color: '#dc2626' },
                            { name: 'Cancelled', value: stats.callStats.statusBreakdown.cancelled, color: '#f59e0b' },
                            { name: 'Redirected', value: stats.callStats.statusBreakdown.redirected, color: '#3b82f6' },
                            { name: 'Unknown', value: stats.callStats.statusBreakdown.unknown, color: '#6b7280' }
                          ].filter(item => item.value > 0);

                          const total = chartData.reduce((sum, item) => sum + item.value, 0);

                          if (total === 0) {
                            return (
                              <div className="w-full h-full flex items-center justify-center text-gray-400">
                                No data
                              </div>
                            );
                          }

                          return (
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={chartData}
                                  cx="50%"
                                  cy="50%"
                                  labelLine={false}
                                  outerRadius={80}
                                  fill="#8884d8"
                                  dataKey="value"
                                >
                                  {chartData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                  ))}
                                </Pie>
                                <Tooltip />
                              </PieChart>
                            </ResponsiveContainer>
                          );
                        })()}
                      </div>

                      {/* Status List */}
                      <div className="space-y-2 flex-1">
                        {stats.callStats.statusBreakdown.answered > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-sm">
                              <span className="font-semibold text-green-600">
                                {stats.callStats.statusBreakdown.answered}
                              </span>
                              {' '}Answered
                            </span>
                          </div>
                        )}
                        {stats.callStats.statusBreakdown.noAnswer > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-sm">
                              <span className="font-semibold text-red-600">
                                {stats.callStats.statusBreakdown.noAnswer}
                              </span>
                              {' '}No Answer
                            </span>
                          </div>
                        )}
                        {stats.callStats.statusBreakdown.busy > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-sm">
                              <span className="font-semibold text-yellow-600">
                                {stats.callStats.statusBreakdown.busy}
                              </span>
                              {' '}Busy
                            </span>
                          </div>
                        )}
                        {stats.callStats.statusBreakdown.failed > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-sm">
                              <span className="font-semibold text-red-600">
                                {stats.callStats.statusBreakdown.failed}
                              </span>
                              {' '}Failed
                            </span>
                          </div>
                        )}
                        {stats.callStats.statusBreakdown.cancelled > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-sm">
                              <span className="font-semibold text-yellow-600">
                                {stats.callStats.statusBreakdown.cancelled}
                              </span>
                              {' '}Cancelled
                            </span>
                          </div>
                        )}
                        {stats.callStats.statusBreakdown.redirected > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-sm">
                              <span className="font-semibold text-blue-600">
                                {stats.callStats.statusBreakdown.redirected}
                              </span>
                              {' '}Redirected
                            </span>
                          </div>
                        )}
                        {stats.callStats.statusBreakdown.unknown > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-sm">
                              <span className="font-semibold text-gray-600">
                                {stats.callStats.statusBreakdown.unknown}
                              </span>
                              {' '}Unknown
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Charts/Graphs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Interaction Types Breakdown */}
                <div className="p-6">
                  <h4 className="text-lg font-semibold mb-4">Interaction Types Breakdown</h4>
                  <div className="space-y-4">
                    {['whatsapp', 'email', 'phone'].map((type) => {
                      const typeStats = type === 'whatsapp' ? stats.whatsapp :
                                      type === 'email' ? stats.email : stats.phone;
                      const maxTotal = Math.max(
                        stats.whatsapp,
                        stats.email,
                        stats.phone
                      );
                      const percentage = maxTotal > 0 ? (typeStats / maxTotal) * 100 : 0;
                      
                      return (
                        <div key={type}>
                          <div className="flex justify-between mb-1">
                            <span className="text-sm font-medium capitalize">{type}</span>
                            <span className="text-sm text-gray-600">{typeStats}</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-4">
                            <div
                              className="bg-blue-500 h-4 rounded-full"
                              style={{ width: `${percentage}%` }}
                            ></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Inbound vs Outbound Comparison */}
                <div className="p-6">
                  <h4 className="text-lg font-semibold mb-4">Inbound vs Outbound</h4>
                  <div className="space-y-4">
                    {['whatsapp', 'email', 'phone'].map((type) => {
                      const directionStats = stats.directionStats[type as keyof typeof stats.directionStats];
                      const total = directionStats.inbound + directionStats.outbound;
                      const inboundPercentage = total > 0 ? (directionStats.inbound / total) * 100 : 0;
                      const outboundPercentage = total > 0 ? (directionStats.outbound / total) * 100 : 0;
                      
                      return (
                        <div key={type}>
                          <div className="flex justify-between mb-1">
                            <span className="text-sm font-medium capitalize">{type}</span>
                            <span className="text-sm text-gray-600">
                              {directionStats.inbound} in / {directionStats.outbound} out
                            </span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-4 flex">
                            <div
                              className="bg-green-500 h-4 rounded-l-full"
                              style={{ width: `${inboundPercentage}%` }}
                              title={`Inbound: ${directionStats.inbound}`}
                            ></div>
                            <div
                              className="bg-blue-500 h-4 rounded-r-full"
                              style={{ width: `${outboundPercentage}%` }}
                              title={`Outbound: ${directionStats.outbound}`}
                            ></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              No statistics available
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmployeeStatsModal;

