import React, { useEffect, useState } from 'react';
import { CalendarIcon, ClockIcon, MapPinIcon, UserIcon, LinkIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { Link } from 'react-router-dom';
import { getStageName } from '../lib/stageUtils';

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
  manager?: string;
  brief: string;
  stage?: string | number;
  leadManager?: string;
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
  meetingTime: string;
  location: string;
  category: string;
  topic: string;
  joinLink: string;
  senderName: string;
}) => `
  <div style="font-family: system-ui, Arial, sans-serif; font-size: 16px; color: #222;">
    <p>Dear ${clientName},</p>
    <p>You are invited to a meeting with our office. Please find the details below:</p>
    <ul style="margin-bottom: 18px;">
      <li><strong>Date:</strong> ${meetingDate}</li>
      <li><strong>Time:</strong> ${meetingTime}</li>
      <li><strong>Location:</strong> ${location}</li>
      <li><strong>Category:</strong> ${category}</li>
      <li><strong>Topic:</strong> ${topic}</li>
    </ul>
    <div style="margin: 24px 0;">
      <a href="${joinLink}" target="_blank" style="display: inline-block; background: #3b28c7; color: #fff; font-weight: 600; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 17px; letter-spacing: 0.5px;">Join Meeting</a>
    </div>
    <p>If you have any questions or need to reschedule, please let us know.</p>
    <br />
    <p>Best regards,<br />${senderName}<br />Decker Pex Levi Law Offices</p>
  </div>
`;

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

  useEffect(() => {
    const fetchMeetings = async () => {
      try {
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
              stage
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
              currency_id
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
        const employeeIds = new Set<string>();
        meetings.forEach(meeting => {
          // Helper function to add valid IDs only
          const addValidId = (id: any) => {
            if (id && id !== '---' && id !== '' && id !== null && id !== undefined) {
              employeeIds.add(id.toString());
            }
          };
          
          addValidId(meeting.legacy_lead?.meeting_manager_id);
          addValidId(meeting.legacy_lead?.meeting_lawyer_id);
          addValidId(meeting.legacy_lead?.meeting_scheduler_id);
          addValidId(meeting.legacy_lead?.expert_id);
          addValidId(meeting.expert);
          addValidId(meeting.meeting_manager);
          addValidId(meeting.helper);
        });

        let employeeNameMap: Record<string, string> = {};
        if (employeeIds.size > 0) {
          const { data: employees, error: employeeError } = await supabase
            .from('tenants_employee')
            .select('id, display_name')
            .in('id', Array.from(employeeIds));
          
          if (!employeeError && employees) {
            employeeNameMap = employees.reduce((acc, emp) => {
              acc[emp.id.toString()] = emp.display_name;
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

        // Transform and filter meetings
        const transformedMeetings = meetings.map(meeting => {
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
                return employeeNameMap[meeting.legacy_lead.expert_id] || meeting.legacy_lead.expert_id;
              }
              // For new leads or meetings table expert
              return meeting.expert ? employeeNameMap[meeting.expert] || meeting.expert : 'Unassigned';
            })(),
            helper: (() => {
              // For legacy leads, use meeting_lawyer_id from the lead data
              if (meeting.legacy_lead?.meeting_lawyer_id) {
                return employeeNameMap[meeting.legacy_lead.meeting_lawyer_id] || meeting.legacy_lead.meeting_lawyer_id;
              }
              // For new leads or meetings table helper
              return meeting.helper ? employeeNameMap[meeting.helper] || meeting.helper : '';
            })(),
            scheduler: (() => {
              // For legacy leads, use meeting_scheduler_id from the lead data
              if (meeting.legacy_lead?.meeting_scheduler_id) {
                return employeeNameMap[meeting.legacy_lead.meeting_scheduler_id] || meeting.legacy_lead.meeting_scheduler_id;
              }
              // For new leads, use meeting_manager from the meetings table
              return meeting.meeting_manager ? employeeNameMap[meeting.meeting_manager] || meeting.meeting_manager : '';
            })(),
            date: meeting.meeting_date,
            time: meeting.meeting_time,
            value: (() => {
              // For legacy leads, use total and currency_id from the lead data
              if (meeting.legacy_lead?.total && meeting.legacy_lead?.currency_id) {
                const currencyCode = currencyMap[meeting.legacy_lead.currency_id] || 'USD';
                return `${currencyCode} ${meeting.legacy_lead.total}`;
              }
              // For new leads, use meeting_amount and meeting_currency from the meetings table
              return meeting.meeting_amount ? `${meeting.meeting_currency} ${meeting.meeting_amount}` : '0';
            })(),
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
            manager: meeting.meeting_manager ? employeeNameMap[meeting.meeting_manager] || meeting.meeting_manager : '',
            brief: meeting.meeting_brief || '',
            stage: leadData?.stage || '', // Keep original stage for reference
            leadManager: leadData?.manager ? employeeNameMap[leadData.manager] || leadData.manager : ''
          };
        });

        setTodayMeetings(transformedMeetings.filter(m => m.date === todayStr));
        setTomorrowMeetings(transformedMeetings.filter(m => m.date === tomorrowStr));
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
    const style = {
      backgroundColor: '#3b28c7',
      color: '#fff',
      border: 'none',
    };
    return (
      <span className="badge inline-flex items-center justify-center h-7 px-4 py-1 text-xs font-semibold rounded-lg text-center whitespace-nowrap font-semibold" style={style} title={stageText}>
        {stageText}
      </span>
    );
  };

  const renderMeetingsTable = (meetings: Meeting[]) => (
    <div className="overflow-x-auto">
      <table className="table table-zebra w-full">
        <thead>
          <tr>
            <th>Lead #</th>
            <th>Info</th>
            <th>Client</th>
            <th>Topic</th>
            <th>Expert</th>
            <th>Helper</th>
            <th>Staff</th>
            <th>Scheduler</th>
            <th>Time</th>
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
              <td className="font-medium">{meeting.name}</td>
              <td>{meeting.topic}</td>
              <td>{meeting.expert}</td>
              <td>{meeting.helper || '---'}</td>
              <td>{meeting.leadManager || '---'}</td>
              <td>{meeting.scheduler || '---'}</td>
              <td>
                <div className="flex items-center gap-1">
                  <ClockIcon className="w-4 h-4" />
                  {meeting.time}
                </div>
              </td>
              <td className="font-semibold text-primary">{meeting.value}</td>
              <td>
                <div className="flex items-center gap-1">
                  <MapPinIcon className="w-4 h-4" />
                  <span>{meeting.location}</span>
                </div>
              </td>
              <td>
                {getValidTeamsLink(meeting.link) && (
                  <a
                    href={getValidTeamsLink(meeting.link)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-ghost btn-sm"
                  >
                    <LinkIcon className="w-4 h-4" />
                    Join
                  </a>
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
            <span>{meeting.time}</span>
          </div>
          <div className="flex items-center gap-2 text-base-content/70 text-sm">
            <UserIcon className="w-5 h-5" />
            <span>{meeting.expert}</span>
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
          {getValidTeamsLink(meeting.link) && (
            <a
              href={getValidTeamsLink(meeting.link)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-sm mt-2"
            >
              <LinkIcon className="w-5 h-5" />
              Join
            </a>
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