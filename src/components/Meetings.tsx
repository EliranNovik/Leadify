import React, { useEffect, useState } from 'react';
import { CalendarIcon, ClockIcon, MapPinIcon, UserIcon, LinkIcon, VideoCameraIcon, XCircleIcon, CheckCircleIcon, ExclamationTriangleIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { Link } from 'react-router-dom';
import { getStageName } from '../lib/stageUtils';
import { formatMeetingValue } from '../lib/meetingValue';

interface Meeting {
  id: number;
  lead: string;
  info: string | number;
  expert: string;
  helper: string;
  scheduler: string;
  date: string;
  time: string;
  value: string;
  location: string;
  staff: string[];
  name: string;
  topic: string;
  link: string;
  // Optional raw Teams URL if present
  teams_meeting_url?: string;
  manager?: string;
  brief: string;
  stage?: string | number;
  leadManager?: string;
  isStaffMeeting?: boolean; // Flag to identify staff meetings
  // Expert status fields
  eligibility_status?: string | null;
  expert_examination?: number | null;
  is_legacy?: boolean;
}

interface MeetingRecord {
  id: number;
  meeting_date: string;
  meeting_time: string;
  meeting_location: string;
  meeting_manager: string;
  meeting_currency: string;
  meeting_amount: number;
  expert: string;
  helper: string;
  teams_meeting_url: string;
  meeting_brief: string;
  lead?: {
    id: number;
    lead_number: string;
    name: string;
    status: string;
    topic: string;
    manager?: string;
    stage?: string;
    expert?: string;
    scheduler?: string;
    helper?: string;
    closer?: string;
    handler?: string;
    balance?: number | string | null;
    balance_currency?: string | null;
    eligibility_status?: string | null;
    lead_type?: string;
  };
  legacy_lead?: {
    id: number;
    name: string;
    stage?: string | number;
    expert_id?: string;
    meeting_manager_id?: string;
    meeting_lawyer_id?: string;
    meeting_scheduler_id?: string;
    category?: string;
    category_id?: number;
    total?: number;
    currency_id?: number;
    closer_id?: string | number;
    case_handler_id?: string | number;
    expert_examination?: number;
    lead_type?: string;
  };
}

// Meeting invitation email template for Notify Client
export const meetingInvitationEmailTemplate = ({
  clientName,
  meetingDate,
  meetingTime,
  location,
  category,
  topic,
  joinLink,
  senderName
}: {
  clientName: string;
  meetingDate: string;
  meetingTime?: string; // Optional - removed from email since calendar invite has it
  location: string;
  category: string;
  topic: string;
  joinLink: string;
  senderName: string;
}) => {
  // Check if this is a Teams meeting and has a valid join link
  const isTeamsMeeting = location && location.toLowerCase().includes('teams') && joinLink;
  
  return `
  <div style="font-family: system-ui, Arial, sans-serif; font-size: 16px; color: #222;">
    <p>Dear ${clientName},</p>
    <p>You are invited to a meeting with our office. Please find the details below:</p>
    <ul style="margin-bottom: 18px;">
      <li><strong>Date:</strong> ${meetingDate}</li>
      ${meetingTime ? `<li><strong>Time:</strong> ${meetingTime}</li>` : ''}
      <li><strong>Location:</strong> ${location}</li>
    </ul>
    ${isTeamsMeeting ? `
    <div style="margin: 24px 0;">
      <a href="${joinLink}" target="_blank" style="display: inline-block; background: #3b28c7; color: #fff; font-weight: 600; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 17px; letter-spacing: 0.5px;">Join Meeting</a>
    </div>
    ` : ''}
    <p>Please check the calendar invitation attached for the exact meeting time.</p>
    <p>If you have any questions or need to reschedule, please let us know.</p>
  </div>
`;
};

const Meetings: React.FC = () => {
  const [todayMeetings, setTodayMeetings] = useState<Meeting[]>([]);
  const [tomorrowMeetings, setTomorrowMeetings] = useState<Meeting[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Helper function to extract valid Teams link from stored data
  const getValidTeamsLink = (link: string | undefined): string => {
    if (!link) return '';
    try {
      // If it's a plain URL, return as is
      if (link.startsWith('http')) return link;
      // If it's a stringified object, parse and extract joinUrl
      const obj = JSON.parse(link);
      if (obj && typeof obj === 'object' && obj.joinUrl && typeof obj.joinUrl === 'string') {
        return obj.joinUrl;
      }
      // Some Graph API responses use joinWebUrl
      if (obj && typeof obj === 'object' && obj.joinWebUrl && typeof obj.joinWebUrl === 'string') {
        return obj.joinWebUrl;
      }
    } catch (e) {
      // Not JSON, just return as is
      if (typeof link === 'string' && link.startsWith('http')) return link;
    }
    return '';
  };

  // Helper function to check if location is online/teams/zoom
  const isOnlineLocation = (location: string | undefined): boolean => {
    if (!location) return false;
    const locationLower = location.toLowerCase().trim();
    return locationLower === 'online' || locationLower === 'teams' || locationLower === 'zoom';
  };

  // Helper function to get expert status icon and color
  const getExpertStatusIcon = (meeting: Meeting) => {
    let status: string | number | null = null;
    const isLegacy = meeting.is_legacy || false;

    // Get the appropriate status based on lead type
    if (isLegacy) {
      status = meeting.expert_examination ?? null;
    } else {
      status = meeting.eligibility_status || null;
    }

    // For legacy leads with expert_examination
    if (isLegacy && status !== null) {
      const examStatus = Number(status);
      
      if (examStatus === 1) {
        return (
          <span className="w-7 h-7 rounded-full bg-red-500 text-white inline-flex items-center justify-center font-semibold shadow-md ml-2" title="Not Feasible">
            <XCircleIcon className="w-4 h-4" />
          </span>
        );
      } else if (examStatus === 5) {
        return (
          <span className="w-7 h-7 rounded-full bg-orange-500 text-white inline-flex items-center justify-center font-semibold shadow-md ml-2" title="Feasible (further check)">
            <ExclamationTriangleIcon className="w-4 h-4" />
          </span>
        );
      } else if (examStatus === 8) {
        return (
          <span className="w-7 h-7 rounded-full bg-green-500 text-white inline-flex items-center justify-center font-semibold shadow-md ml-2" title="Feasible (no check)">
            <CheckCircleIcon className="w-4 h-4" />
          </span>
        );
      }
    }

    // For new leads with eligibility_status
    if (!isLegacy && status) {
      const statusStr = String(status);
      
      if (statusStr === 'not_feasible') {
        return (
          <span className="w-7 h-7 rounded-full bg-red-500 text-white inline-flex items-center justify-center font-semibold shadow-md ml-2" title="Not Feasible">
            <XCircleIcon className="w-4 h-4" />
          </span>
        );
      } else if (statusStr === 'feasible_no_check') {
        return (
          <span className="w-7 h-7 rounded-full bg-green-500 text-white inline-flex items-center justify-center font-semibold shadow-md ml-2" title="Feasible (no check)">
            <CheckCircleIcon className="w-4 h-4" />
          </span>
        );
      } else if (statusStr === 'feasible_with_check') {
        return (
          <span className="w-7 h-7 rounded-full bg-orange-500 text-white inline-flex items-center justify-center font-semibold shadow-md ml-2" title="Feasible (with check)">
            <ExclamationTriangleIcon className="w-4 h-4" />
          </span>
        );
      }
    }

    // Default: Not checked
    return (
      <span className="w-7 h-7 rounded-full bg-gray-400 text-white inline-flex items-center justify-center font-semibold shadow-md ml-2" title="Expert opinion not checked">
        <QuestionMarkCircleIcon className="w-4 h-4" />
      </span>
    );
  };

  useEffect(() => {
    const fetchMeetings = async () => {
      try {
        // First, fetch current user's employee_id, display name, and email
        const { data: { user } } = await supabase.auth.getUser();
        let userEmployeeId: number | null = null;
        let userDisplayName: string | null = null;
        let userEmail: string | null = null;
        
        if (user) {
          userEmail = user.email || null; // Get user email for staff meetings
          const { data: userData } = await supabase
            .from('users')
            .select(`
              employee_id,
              tenants_employee!employee_id(
                id,
                display_name
              )
            `)
            .eq('auth_id', user.id)
            .single();
          
          if (userData?.employee_id) {
            userEmployeeId = userData.employee_id;
          }
          
          // Get display name from employee relationship
          if (userData?.tenants_employee) {
            const empData = Array.isArray(userData.tenants_employee) 
              ? userData.tenants_employee[0] 
              : userData.tenants_employee;
            if (empData?.display_name) {
              userDisplayName = empData.display_name;
            }
          }
        }
        
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const tomorrow = new Date(today.getTime() + 86400000);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        // Fetch meetings from Supabase - join with both leads and leads_lead tables to get lead information
        const { data: meetings, error: fetchError } = await supabase
          .from('meetings')
          .select(`
            id,
            meeting_date,
            meeting_time,
            meeting_location,
            meeting_manager,
            meeting_currency,
            meeting_amount,
            expert,
            helper,
            teams_meeting_url,
            meeting_brief,
            lead:leads!client_id (
              id,
              lead_number,
              name,
              status,
              topic,
              manager,
              stage,
              expert,
              scheduler,
              helper,
              closer,
              handler,
              balance,
              balance_currency,
              eligibility_status
            ),
            legacy_lead:leads_lead!legacy_lead_id (
              id,
              name,
              stage,
              expert_id,
              meeting_manager_id,
              meeting_lawyer_id,
              meeting_scheduler_id,
              category,
              category_id,
              total,
              currency_id,
              closer_id,
              case_handler_id,
              expert_examination
            )
          `)
          .or(`meeting_date.eq.${todayStr},meeting_date.eq.${tomorrowStr}`)
          .not('teams_meeting_url', 'is', null)
          .returns<MeetingRecord[]>();

        if (fetchError) {
          throw new Error(`Error fetching meetings: ${fetchError.message}`);
        }

        if (!meetings) {
          throw new Error('No meetings data received');
        }

        // Fetch employee names for ID mapping
        // Only collect numeric IDs for database query (string names are already display names)
        const employeeIds = new Set<number>();
        meetings.forEach(meeting => {
          // Helper function to add valid numeric IDs only
          const addValidNumericId = (id: any) => {
            if (id != null && id !== '' && id !== '---' && id !== undefined) {
              const numId = typeof id === 'number' ? id : Number(id);
              // Only add if it's a valid number and not NaN
              if (!isNaN(numId) && numId > 0) {
                employeeIds.add(numId);
              }
            }
          };
          
          // Legacy lead IDs (should be numeric)
          addValidNumericId(meeting.legacy_lead?.meeting_manager_id);
          addValidNumericId(meeting.legacy_lead?.meeting_lawyer_id);
          addValidNumericId(meeting.legacy_lead?.meeting_scheduler_id);
          addValidNumericId(meeting.legacy_lead?.expert_id);
          addValidNumericId(meeting.legacy_lead?.case_handler_id);
          
          // Meeting-level fields (might be numeric IDs)
          addValidNumericId(meeting.expert);
          addValidNumericId(meeting.meeting_manager);
          addValidNumericId(meeting.helper);
          
          // New lead fields - only add if they're numeric
          if (meeting.lead?.scheduler && !isNaN(Number(meeting.lead.scheduler))) {
            addValidNumericId(meeting.lead.scheduler);
          }
          if (meeting.lead?.helper && !isNaN(Number(meeting.lead.helper))) {
            addValidNumericId(meeting.lead.helper);
          }
          if (meeting.lead?.closer && !isNaN(Number(meeting.lead.closer))) {
            addValidNumericId(meeting.lead.closer);
          }
          if (meeting.lead?.expert && !isNaN(Number(meeting.lead.expert))) {
            addValidNumericId(meeting.lead.expert);
          }
          if (meeting.lead?.manager && !isNaN(Number(meeting.lead.manager))) {
            addValidNumericId(meeting.lead.manager);
          }
          if (meeting.lead?.handler && !isNaN(Number(meeting.lead.handler))) {
            addValidNumericId(meeting.lead.handler);
          }
        });

        let employeeNameMap: Record<string, string> = {};
        if (employeeIds.size > 0) {
          // Convert Set to array of numbers for the query
          const numericIds = Array.from(employeeIds);
          const { data: employees, error: employeeError } = await supabase
            .from('tenants_employee')
            .select('id, display_name')
            .in('id', numericIds);
          
          if (!employeeError && employees) {
            employeeNameMap = employees.reduce((acc, emp) => {
              // Map both numeric and string versions of the ID
              acc[emp.id.toString()] = emp.display_name;
              acc[String(emp.id)] = emp.display_name;
              return acc;
            }, {} as Record<string, string>);
          }
        }

        // Fetch category names for legacy leads
        const categoryIds = meetings
          .filter(m => m.legacy_lead?.category_id)
          .map(m => m.legacy_lead!.category_id!)
          .filter(Boolean);

        let categoryNameMap: Record<number, string> = {};
        if (categoryIds.length > 0) {
          const { data: categories, error: categoryError } = await supabase
            .from('misc_category')
            .select('id, name')
            .in('id', categoryIds);
          
          if (!categoryError && categories) {
            categoryNameMap = categories.reduce((acc, cat) => {
              acc[cat.id] = cat.name;
              return acc;
            }, {} as Record<number, string>);
          }
        }

        // Fetch currency information for legacy leads
        const currencyIds = meetings
          .filter(m => m.legacy_lead?.currency_id)
          .map(m => m.legacy_lead!.currency_id!)
          .filter(Boolean);

        let currencyMap: Record<number, string> = {};
        if (currencyIds.length > 0) {
          const { data: currencies, error: currencyError } = await supabase
            .from('accounting_currencies')
            .select('id, iso_code')
            .in('id', currencyIds);
          
          if (!currencyError && currencies) {
            currencyMap = currencies.reduce((acc, curr) => {
              acc[curr.id] = curr.iso_code;
              return acc;
            }, {} as Record<number, string>);
          }
        }

        // Filter meetings to only include those where user's employee_id matches a role
        // Helper function to check if user matches any role
        const userMatchesRole = (meeting: MeetingRecord): boolean => {
          if (!userEmployeeId && !userDisplayName) return true; // If no user data, show all meetings
          
          // Check legacy lead roles
          if (meeting.legacy_lead) {
            const legacyLead = meeting.legacy_lead;
            if (userEmployeeId) {
              return (
                legacyLead.meeting_scheduler_id?.toString() === userEmployeeId.toString() ||
                legacyLead.meeting_manager_id?.toString() === userEmployeeId.toString() ||
                legacyLead.meeting_lawyer_id?.toString() === userEmployeeId.toString() ||
                legacyLead.expert_id?.toString() === userEmployeeId.toString() ||
                legacyLead.closer_id?.toString() === userEmployeeId.toString() ||
                legacyLead.case_handler_id?.toString() === userEmployeeId.toString()
              );
            }
          }
          
          // Check new lead roles
          if (meeting.lead) {
            const newLead = meeting.lead;
            // For new leads, fields might be IDs or display names
            const checkField = (field: any): boolean => {
              if (!field) return false;
              // If it's a number/ID, compare directly with employee_id
              if (!isNaN(Number(field)) && userEmployeeId) {
                return field.toString() === userEmployeeId.toString();
              }
              // If it's a string (display name), compare with user's display name
              if (typeof field === 'string' && userDisplayName) {
                return field.trim() === userDisplayName.trim();
              }
              return false;
            };
            
            return (
              checkField(newLead.scheduler) ||
              checkField(newLead.manager) ||
              checkField(newLead.helper) ||
              checkField(newLead.expert) ||
              checkField(newLead.closer) ||
              checkField(newLead.handler) ||
              checkField(meeting.meeting_manager) ||
              checkField(meeting.expert) ||
              checkField(meeting.helper)
            );
          }
          
          // Fallback: check meeting-level fields
          if (userEmployeeId) {
            return (
              meeting.meeting_manager?.toString() === userEmployeeId.toString() ||
              meeting.expert?.toString() === userEmployeeId.toString() ||
              meeting.helper?.toString() === userEmployeeId.toString()
            );
          }
          // If we have display name, check against meeting fields that might be display names
          if (userDisplayName) {
            return (
              (typeof meeting.meeting_manager === 'string' && meeting.meeting_manager.trim() === userDisplayName.trim()) ||
              (typeof meeting.expert === 'string' && meeting.expert.trim() === userDisplayName.trim()) ||
              (typeof meeting.helper === 'string' && meeting.helper.trim() === userDisplayName.trim())
            );
          }
          return false;
        };
        
        // Filter meetings by user role
        const filteredMeetings = meetings.filter(userMatchesRole);
        
        // Transform and filter meetings
        const transformedMeetings = filteredMeetings.map(meeting => {
          // Determine which lead data to use
          let leadData = null;
          
          if (meeting.legacy_lead) {
            // Use legacy lead data and map column names to match new leads structure
            leadData = {
              ...meeting.legacy_lead,
              lead_type: 'legacy',
              // Map legacy column names to new structure
              manager: meeting.legacy_lead.meeting_manager_id,
              helper: meeting.legacy_lead.meeting_lawyer_id,
              // For legacy leads, use the ID as lead_number
              lead_number: meeting.legacy_lead.id?.toString(),
              // Use category name if available, otherwise category_id as string
              topic: meeting.legacy_lead.category || 
                     (meeting.legacy_lead.category_id ? categoryNameMap[meeting.legacy_lead.category_id] || meeting.legacy_lead.category_id.toString() : 'Consultation')
            };
          } else if (meeting.lead) {
            // Use new lead data
            leadData = {
              ...meeting.lead,
              lead_type: 'new'
            };
          }
          
          return {
            id: meeting.id,
            lead: leadData?.lead_number || 'N/A',
            info: leadData?.stage ? getStageName(leadData.stage.toString()) : '', // Transform stage ID to name
            expert: (() => {
              // For legacy leads, use expert_id from the lead data
              if (meeting.legacy_lead?.expert_id) {
                const expertName = employeeNameMap[meeting.legacy_lead.expert_id.toString()];
                return expertName || meeting.legacy_lead.expert_id.toString();
              }
              // For new leads, check lead.expert first (might be name or ID), then meeting.expert
              if (meeting.lead?.expert) {
                // If it's already a name (not a number), return it
                if (isNaN(Number(meeting.lead.expert))) {
                  return meeting.lead.expert;
                }
                // Otherwise, try to look it up as an ID
                const expertName = employeeNameMap[meeting.lead.expert.toString()];
                return expertName || meeting.lead.expert;
              }
              // Fallback to meeting.expert (from meetings table)
              if (meeting.expert) {
                // If it's already a name (not a number), return it
                if (isNaN(Number(meeting.expert))) {
                  return meeting.expert;
                }
                // Otherwise, try to look it up as an ID
                const expertName = employeeNameMap[meeting.expert.toString()];
                return expertName || meeting.expert;
              }
              return 'Unassigned';
            })(),
            helper: (() => {
              // For legacy leads, use meeting_lawyer_id from the lead data
              if (meeting.legacy_lead?.meeting_lawyer_id) {
                return employeeNameMap[meeting.legacy_lead.meeting_lawyer_id] || meeting.legacy_lead.meeting_lawyer_id;
              }
              // For new leads, first check lead.helper field
              if (meeting.lead?.helper) {
                const helperField = meeting.lead.helper;
                if (!isNaN(Number(helperField))) {
                  // If it's an ID, look it up
                  return employeeNameMap[helperField.toString()] || helperField.toString();
                } else {
                  // If it's a display name, use it directly
                  return helperField;
                }
              }
              // Fallback to meeting.helper from the meetings table
              return meeting.helper ? employeeNameMap[meeting.helper] || meeting.helper : '';
            })(),
            scheduler: (() => {
              // For legacy leads, use meeting_scheduler_id from the lead data
              if (meeting.legacy_lead?.meeting_scheduler_id) {
                return employeeNameMap[meeting.legacy_lead.meeting_scheduler_id] || meeting.legacy_lead.meeting_scheduler_id;
              }
              // For new leads, first check lead.scheduler field
              if (meeting.lead?.scheduler) {
                const schedulerField = meeting.lead.scheduler;
                if (!isNaN(Number(schedulerField))) {
                  // If it's an ID, look it up
                  return employeeNameMap[schedulerField.toString()] || schedulerField.toString();
                } else {
                  // If it's a display name, use it directly
                  return schedulerField;
                }
              }
              // Fallback to meeting_manager from the meetings table
              return meeting.meeting_manager ? employeeNameMap[meeting.meeting_manager] || meeting.meeting_manager : '';
            })(),
            date: meeting.meeting_date,
            time: meeting.meeting_time,
            value: formatMeetingValue({
              leadBalance: meeting.lead?.balance,
              leadBalanceCurrency: meeting.lead?.balance_currency,
              legacyTotal: meeting.legacy_lead?.total,
              legacyCurrencyId: meeting.legacy_lead?.currency_id ?? null,
              legacyCurrencyCode: meeting.legacy_lead?.currency_id
                ? currencyMap[meeting.legacy_lead.currency_id]
                : undefined,
              meetingAmount: meeting.meeting_amount,
              meetingCurrency: meeting.meeting_currency,
            }).display,
            location: meeting.meeting_location || 'Teams',
            staff: [
              meeting.meeting_manager ? employeeNameMap[meeting.meeting_manager] || meeting.meeting_manager : '',
              (() => {
                // For legacy leads, use meeting_lawyer_id from the lead data
                if (meeting.legacy_lead?.meeting_lawyer_id) {
                  return employeeNameMap[meeting.legacy_lead.meeting_lawyer_id] || meeting.legacy_lead.meeting_lawyer_id;
                }
                // For new leads or meetings table helper
                return meeting.helper ? employeeNameMap[meeting.helper] || meeting.helper : '';
              })(),
              (() => {
                // For legacy leads, use expert_id from the lead data
                if (meeting.legacy_lead?.expert_id) {
                  return employeeNameMap[meeting.legacy_lead.expert_id] || meeting.legacy_lead.expert_id;
                }
                // For new leads or meetings table expert
                return meeting.expert ? employeeNameMap[meeting.expert] || meeting.expert : '';
              })()
            ].filter(Boolean), // Remove any null/undefined/empty values
            name: leadData?.name || 'Unknown',
            topic: leadData?.topic || 'Consultation',
            link: meeting.teams_meeting_url,
            manager: (() => {
              // For legacy leads, use meeting_manager_id from the lead data
              if (meeting.legacy_lead?.meeting_manager_id) {
                return employeeNameMap[meeting.legacy_lead.meeting_manager_id] || meeting.legacy_lead.meeting_manager_id;
              }
              // For new leads, first check lead.manager field
              if (meeting.lead?.manager) {
                const managerField = meeting.lead.manager;
                if (!isNaN(Number(managerField))) {
                  // If it's an ID, look it up
                  return employeeNameMap[managerField.toString()] || managerField.toString();
                } else {
                  // If it's a display name, use it directly
                  return managerField;
                }
              }
              // Fallback to meeting_manager from the meetings table
              return meeting.meeting_manager ? employeeNameMap[meeting.meeting_manager] || meeting.meeting_manager : '';
            })(),
            brief: meeting.meeting_brief || '',
            stage: leadData?.stage || '', // Keep original stage for reference
            leadManager: (() => {
              // For legacy leads, use meeting_manager_id
              if (meeting.legacy_lead?.meeting_manager_id) {
                return employeeNameMap[meeting.legacy_lead.meeting_manager_id] || meeting.legacy_lead.meeting_manager_id;
              }
              // For new leads, check lead.manager
              if (meeting.lead?.manager) {
                const managerField = meeting.lead.manager;
                if (!isNaN(Number(managerField))) {
                  return employeeNameMap[managerField.toString()] || managerField.toString();
                } else {
                  return managerField;
                }
              }
              return '';
            })(),
            // Expert status fields
            eligibility_status: meeting.lead?.eligibility_status || null,
            expert_examination: meeting.legacy_lead?.expert_examination ?? null,
            is_legacy: !!meeting.legacy_lead
          };
        });

        // Fetch staff meetings from outlook_teams_meetings where user is in attendees
        let staffMeetingsToday: Meeting[] = [];
        let staffMeetingsTomorrow: Meeting[] = [];
        
        if (userEmail) {
          // First, fetch employees and users to create email-to-name mapping
          const [employeesResult, usersResult] = await Promise.all([
            supabase
              .from('tenants_employee')
              .select('id, display_name')
              .not('display_name', 'is', null),
            supabase
              .from('users')
              .select('employee_id, email')
              .not('email', 'is', null)
          ]);

          // Create email-to-name mapping
          const emailToNameMap = new Map<string, string>();
          
          if (employeesResult.data && usersResult.data) {
            // Create employee_id to email mapping
            const employeeIdToEmail = new Map<number, string>();
            usersResult.data.forEach((user: any) => {
              if (user.employee_id && user.email) {
                employeeIdToEmail.set(user.employee_id, user.email.toLowerCase());
              }
            });

            // Map emails to display names
            employeesResult.data.forEach((emp: any) => {
              const email = employeeIdToEmail.get(emp.id);
              if (email && emp.display_name) {
                emailToNameMap.set(email, emp.display_name);
              }
              // Also try the pattern from CalendarPage: display_name.toLowerCase().replace(/\s+/g, '.') + '@lawoffice.org.il'
              const patternEmail = `${emp.display_name.toLowerCase().replace(/\s+/g, '.')}@lawoffice.org.il`;
              emailToNameMap.set(patternEmail, emp.display_name);
            });
          }

          const todayStart = new Date(today);
          todayStart.setHours(0, 0, 0, 0);
          const todayEnd = new Date(today);
          todayEnd.setHours(23, 59, 59, 999);
          
          const tomorrowStart = new Date(tomorrow);
          tomorrowStart.setHours(0, 0, 0, 0);
          const tomorrowEnd = new Date(tomorrow);
          tomorrowEnd.setHours(23, 59, 59, 999);

          const { data: outlookMeetings, error: outlookError } = await supabase
            .from('outlook_teams_meetings')
            .select('*')
            .gte('start_date_time', todayStart.toISOString())
            .lte('start_date_time', tomorrowEnd.toISOString())
            .or('status.is.null,status.neq.cancelled');
          
          if (!outlookError && outlookMeetings) {
            const filteredStaffMeetings = outlookMeetings.filter((meeting: any) => {
              if (!meeting.attendees || !Array.isArray(meeting.attendees)) return false;
              // Check if user's email is in the attendees array
              return meeting.attendees.some((attendee: any) => {
                const attendeeEmail = typeof attendee === 'string' 
                  ? attendee.toLowerCase() 
                  : (attendee.email || '').toLowerCase();
                return attendeeEmail === userEmail?.toLowerCase();
              });
            });

            // Process staff meetings to match Meeting interface
            const processedStaffMeetings = filteredStaffMeetings.map((staffMeeting: any) => {
              const startDate = new Date(staffMeeting.start_date_time);
              const meetingDate = startDate.toISOString().split('T')[0];
              const timeStr = startDate.toTimeString().substring(0, 5); // HH:MM format
              
              // Extract attendees and map emails to employee names for client column
              let attendeesText = 'Staff Meeting';
              if (staffMeeting.attendees && Array.isArray(staffMeeting.attendees) && staffMeeting.attendees.length > 0) {
                const attendeeNames = staffMeeting.attendees.map((attendee: any) => {
                  let attendeeEmail: string | null = null;
                  
                  // Extract email from attendee (could be string or object)
                  if (typeof attendee === 'string') {
                    attendeeEmail = attendee.toLowerCase();
                  } else if (attendee && typeof attendee === 'object') {
                    attendeeEmail = (attendee.email || '').toLowerCase();
                  }
                  
                  // Try to get name from email mapping, otherwise use name/displayName from object
                  if (attendeeEmail && emailToNameMap.has(attendeeEmail)) {
                    return emailToNameMap.get(attendeeEmail)!;
                  } else if (attendee && typeof attendee === 'object') {
                    // Fallback to name/displayName from object if available
                    return attendee.name || attendee.displayName || attendeeEmail || 'Unknown';
                  } else if (attendeeEmail) {
                    // If it's just an email string and we couldn't map it, use the email
                    return attendeeEmail;
                  }
                  
                  return 'Unknown';
                }).filter(Boolean);
                
                if (attendeeNames.length > 0) {
                  attendeesText = attendeeNames.join(', ');
                }
              }
              
              // Use subject/title for info column (like in calendar page)
              const infoText = staffMeeting.subject || staffMeeting.title || 'Staff Meeting';
              
              return {
                id: staffMeeting.id,
                lead: 'Staff Meeting',
                info: infoText,
                expert: '--',
                helper: '--',
                scheduler: '--',
                date: meetingDate,
                time: timeStr,
                value: '--',
                location: staffMeeting.location || 'Teams',
                staff: ['--'],
                name: attendeesText, // Client column shows employee names (not emails)
                topic: staffMeeting.description || 'Internal Meeting',
                link: staffMeeting.teams_join_url || staffMeeting.teams_meeting_url || '',
                manager: '--',
                brief: staffMeeting.description || '',
                stage: 'N/A',
                leadManager: '--',
                isStaffMeeting: true, // Mark as staff meeting
              } as Meeting;
            });

            // Separate today and tomorrow staff meetings
            staffMeetingsToday = processedStaffMeetings.filter(m => m.date === todayStr);
            staffMeetingsTomorrow = processedStaffMeetings.filter(m => m.date === tomorrowStr);
          }
        }

        // Combine client meetings and staff meetings
        const allTodayMeetings = [
          ...transformedMeetings.filter(m => m.date === todayStr),
          ...staffMeetingsToday
        ];
        const allTomorrowMeetings = [
          ...transformedMeetings.filter(m => m.date === tomorrowStr),
          ...staffMeetingsTomorrow
        ];

        // Sort by time
        allTodayMeetings.sort((a, b) => {
          const timeA = a.time || '00:00';
          const timeB = b.time || '00:00';
          return timeA.localeCompare(timeB);
        });
        allTomorrowMeetings.sort((a, b) => {
          const timeA = a.time || '00:00';
          const timeB = b.time || '00:00';
          return timeA.localeCompare(timeB);
        });

        setTodayMeetings(allTodayMeetings);
        setTomorrowMeetings(allTomorrowMeetings);
        setError(null);
      } catch (err) {
        console.error('Error in fetchMeetings:', err);
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
        setTodayMeetings([]);
        setTomorrowMeetings([]);
      }
    };

    fetchMeetings();
  }, []);

  // Helper to format date as DD/MM/YYYY
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  // Get today's and tomorrow's date strings for titles
  const todayDateStr = formatDate(new Date().toISOString().split('T')[0]);
  const tomorrowDateStr = formatDate(new Date(Date.now() + 86400000).toISOString().split('T')[0]);

  const getLocationBadge = (location: Meeting['location']) => {
    switch (location) {
      case 'Jerusalem Office':
        return 'badge-info';
      case 'Tel Aviv Office':
        return 'badge-success';
      case 'Teams':
        return 'badge-warning';
      default:
        return '';
    }
  };

  const getStageBadge = (stage: string | number) => {
    if (!stage) return null;
    
    // Convert stage to string and handle both string and number types
    const stageStr = stage.toString();
    const stageText = stageStr.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    return (
      <span className="text-sm font-medium text-gray-700">
        {stageText}
      </span>
    );
  };

  // Helper function to format time without seconds
  const formatTime = (timeStr: string | undefined): string => {
    if (!timeStr) return '--';
    // If time is in HH:MM:SS format, remove seconds
    if (timeStr.includes(':') && timeStr.split(':').length === 3) {
      return timeStr.substring(0, 5); // Return HH:MM
    }
    return timeStr; // Return as is if already in HH:MM format
  };

  const renderMeetingsTable = (meetings: Meeting[]) => (
    <div className="overflow-x-auto">
      <table className="table w-full">
        <thead>
          <tr>
            <th>Lead #</th>
            <th>Info</th>
            <th>Time</th>
            <th>Client</th>
            <th>Topic</th>
            <th>Expert</th>
            <th>Helper</th>
            <th>Manager</th>
            <th>Scheduler</th>
            <th>Value</th>
            <th>Location</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody>
          {meetings.map((meeting) => (
            <tr key={meeting.id}>
              <td className="font-medium text-primary">
                <Link to={`/clients/${meeting.lead}`} className="font-bold text-primary">
                  {meeting.lead}
                </Link>
              </td>
              <td className="align-middle">
                {getStageBadge(meeting.info)}
              </td>
              <td>
                <div className="flex items-center gap-1">
                  <ClockIcon className="w-4 h-4" />
                  {formatTime(meeting.time)}
                </div>
              </td>
              <td className="font-medium">{meeting.name}</td>
              <td>{meeting.topic}</td>
              <td>
                <div className="flex items-center">
                  <span>{meeting.expert}</span>
                  {getExpertStatusIcon(meeting)}
                </div>
              </td>
              <td>{meeting.helper || '---'}</td>
              <td>{meeting.leadManager || '---'}</td>
              <td>{meeting.scheduler || '---'}</td>
              <td className="font-semibold text-primary">{meeting.value}</td>
              <td>
                <div className="flex items-center gap-1">
                  <MapPinIcon className="w-4 h-4" />
                  <span>{meeting.location}</span>
                </div>
              </td>
              <td>
                {getValidTeamsLink(meeting.link) && (
                  <button 
                    className="btn btn-primary btn-xs sm:btn-sm"
                    onClick={() => {
                      const url = getValidTeamsLink(meeting.link);
                      if (url) {
                        window.open(url, '_blank');
                      } else {
                        alert('No meeting URL available');
                      }
                    }}
                    title="Teams Meeting"
                  >
                    <VideoCameraIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderMeetingsCards = (meetings: Meeting[]) => (
    <div className="flex gap-4 overflow-x-auto md:hidden py-4 px-1">
      {meetings.map((meeting) => (
        <div
          key={meeting.id}
          className="min-w-[85vw] max-w-[90vw] bg-base-100 rounded-xl shadow-lg p-4 flex flex-col gap-2 border border-base-200"
          style={{ flex: '0 0 85vw' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="font-bold text-lg text-primary">{meeting.name}</span>
            {getStageBadge(meeting.info)}
          </div>
          <div className="flex items-center gap-2 text-base-content/70 text-sm">
            <CalendarIcon className="w-5 h-5" />
            <span>{meeting.date}</span>
            <ClockIcon className="w-5 h-5 ml-3" />
            <span>{formatTime(meeting.time)}</span>
          </div>
          <div className="flex items-center gap-2 text-base-content/70 text-sm">
            <UserIcon className="w-5 h-5" />
            <span>{meeting.expert}</span>
            {getExpertStatusIcon(meeting)}
          </div>
          <div className="flex items-center gap-2 text-base-content/70 text-sm">
            <span className="font-semibold">Helper:</span>
            <span>{meeting.helper || '---'}</span>
          </div>
          <div className="flex items-center gap-2 text-base-content/70 text-sm">
            <MapPinIcon className="w-5 h-5" />
            <span>{meeting.location}</span>
          </div>
          <div className="flex items-center gap-2 text-base-content/70 text-sm">
            <span className="font-semibold">Topic:</span>
            <span>{meeting.topic}</span>
          </div>
          <div className="flex items-center gap-2 text-base-content/70 text-sm">
            <span className="font-semibold">Value:</span>
            <span className="text-primary font-bold">{meeting.value}</span>
          </div>
          <div className="flex items-center gap-2 text-base-content/70 text-sm">
            <span className="font-semibold">Scheduler:</span>
            <span>{meeting.scheduler || '---'}</span>
          </div>
          {isOnlineLocation(meeting.location) && getValidTeamsLink(meeting.link) && (
            <button 
              className="btn btn-primary btn-xs sm:btn-sm mt-2"
              onClick={() => {
                const url = getValidTeamsLink(meeting.link);
                if (url) {
                  window.open(url, '_blank');
                } else {
                  alert('No meeting URL available');
                }
              }}
              title="Teams Meeting"
            >
              <VideoCameraIcon className="w-3 h-3 sm:w-4 sm:h-4" />
            </button>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
      
      {/* Today's Meetings */}
      <div className="bg-base-100 rounded-lg shadow-lg p-2 md:p-4 w-full max-w-full">
        <div className="pb-2 md:pb-4 border-b border-base-200">
          <h2 className="text-2xl md:text-xl font-bold md:font-semibold flex items-center gap-4 md:gap-2">
            <CalendarIcon className="w-7 h-7 md:w-6 md:h-6 text-primary" />
            Today's Meetings
            <span className="inline-flex items-center gap-1 bg-primary/10 text-[#3b28c7] font-semibold rounded-full px-3 py-1 text-base ml-2">
              {todayDateStr}
            </span>
          </h2>
        </div>
        {/* Mobile: Cards */}
        {todayMeetings.length > 0 && (
          <div className="md:hidden">
            {renderMeetingsCards(todayMeetings)}
          </div>
        )}
        {/* Desktop: Table */}
        <div className="hidden md:block">
          {todayMeetings.length > 0 ? (
            renderMeetingsTable(todayMeetings)
          ) : (
            <div className="text-center py-8 text-base-content/70">
              No meetings scheduled for today
            </div>
          )}
        </div>
        {/* Mobile: No meetings */}
        {todayMeetings.length === 0 && (
          <div className="md:hidden text-center py-8 text-base-content/70">
            No meetings scheduled for today
          </div>
        )}
      </div>

      {/* Tomorrow's Meetings */}
      <div className="bg-base-100 rounded-lg shadow-lg p-2 md:p-4 w-full max-w-full">
        <div className="pb-2 md:pb-4 border-b border-base-200">
          <h2 className="text-2xl md:text-xl font-bold md:font-semibold flex items-center gap-4 md:gap-2">
            <CalendarIcon className="w-7 h-7 md:w-6 md:h-6 text-primary" />
            Tomorrow's Meetings
            <span className="inline-flex items-center gap-1 bg-primary/10 text-[#3b28c7] font-semibold rounded-full px-3 py-1 text-base ml-2">
              {tomorrowDateStr}
            </span>
          </h2>
        </div>
        {/* Mobile: Cards */}
        {tomorrowMeetings.length > 0 && (
          <div className="md:hidden">
            {renderMeetingsCards(tomorrowMeetings)}
          </div>
        )}
        {/* Desktop: Table */}
        <div className="hidden md:block">
          {tomorrowMeetings.length > 0 ? (
            renderMeetingsTable(tomorrowMeetings)
          ) : (
            <div className="text-center py-8 text-base-content/70">
              No meetings scheduled for tomorrow
            </div>
          )}
        </div>
        {/* Mobile: No meetings */}
        {tomorrowMeetings.length === 0 && (
          <div className="md:hidden text-center py-8 text-base-content/70">
            No meetings scheduled for tomorrow
          </div>
        )}
      </div>
    </div>
  );
};

export default Meetings; 