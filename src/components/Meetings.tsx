import React, { useEffect, useState } from 'react';
import { CalendarIcon, ClockIcon, MapPinIcon, UserIcon, LinkIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { Link } from 'react-router-dom';

interface Meeting {
  id: number;
  lead: string;
  info: string;
  expert: string;
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
  stage?: string;
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
  leads: {
    lead_number: string;
    name: string;
    status: string;
    topic: string;
    stage?: string;
    manager?: string;
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

        // Fetch meetings from Supabase - join with leads table to get lead information
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
            leads:client_id (
              lead_number,
              name,
              status,
              topic,
              stage,
              manager
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

        // Transform and filter meetings
        const transformedMeetings = meetings.map(meeting => ({
          id: meeting.id,
          lead: meeting.leads?.lead_number || 'N/A',
          info: meeting.leads?.stage || '',
          expert: meeting.expert || 'Unassigned',
          date: meeting.meeting_date,
          time: meeting.meeting_time,
          value: meeting.meeting_amount ? `${meeting.meeting_currency} ${meeting.meeting_amount}` : '0',
          location: meeting.meeting_location || 'Teams',
          staff: [
            meeting.meeting_manager,
            meeting.helper,
            meeting.expert
          ].filter(Boolean), // Remove any null/undefined/empty values
          name: meeting.leads?.name || 'Unknown',
          topic: meeting.leads?.topic || 'Consultation',
          link: meeting.teams_meeting_url,
          manager: meeting.meeting_manager,
          brief: meeting.meeting_brief || '',
          stage: meeting.leads?.stage,
          leadManager: meeting.leads?.manager || ''
        }));

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

  const getStageBadge = (stage: string) => {
    if (!stage) return null;
    const stageText = stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
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
              <td>{meeting.staff[1] || '---'}</td>
              <td>{meeting.leadManager || '---'}</td>
              <td>{meeting.manager || '---'}</td>
              <td>
                <div className="flex items-center gap-1">
                  <ClockIcon className="w-4 h-4" />
                  {meeting.time}
                </div>
              </td>
              <td className="font-semibold text-success">{meeting.value}</td>
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
            <MapPinIcon className="w-5 h-5" />
            <span>{meeting.location}</span>
          </div>
          <div className="flex items-center gap-2 text-base-content/70 text-sm">
            <span className="font-semibold">Topic:</span>
            <span>{meeting.topic}</span>
          </div>
          <div className="flex items-center gap-2 text-base-content/70 text-sm">
            <span className="font-semibold">Value:</span>
            <span className="text-success font-bold">{meeting.value}</span>
          </div>
          <div className="flex items-center gap-2 text-base-content/70 text-sm">
            <span className="font-semibold">Scheduler:</span>
            <span>{meeting.manager || '---'}</span>
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