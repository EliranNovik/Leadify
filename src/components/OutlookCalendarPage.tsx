import React, { useEffect, useState } from 'react';
import { Calendar, momentLocalizer, Views } from 'react-big-calendar';
import { useMsal } from '@azure/msal-react';
import moment from 'moment';
import { PlusIcon, TrashIcon, PencilIcon, CheckIcon, XMarkIcon, ClockIcon, UserIcon, MapPinIcon, VideoCameraIcon, CalendarIcon, FunnelIcon, ChevronDownIcon, DocumentArrowUpIcon, FolderIcon, ChevronLeftIcon, ChevronRightIcon, CurrencyDollarIcon } from '@heroicons/react/24/outline';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { supabase } from '../lib/supabase';
import TeamsMeetingModal from './TeamsMeetingModal';
import { getOutlookTeamsMeetings, type OutlookTeamsMeeting } from '../lib/outlookTeamsMeetingsApi';

// Interface for meetings table data (matching MeetingTab structure)
interface MeetingData {
  id: number;
  client_id: number;
  date: string;
  time: string;
  location: string;
  manager: string;
  currency: string;
  amount: number;
  brief: string;
  scheduler: string;
  helper: string;
  expert: string;
  link: string; // This is teams_meeting_url
  status?: string;
  expert_notes?: string;
  handler_notes?: string;
  eligibility_status?: string;
  feasibility_notes?: string;
  documents_link?: string;
  lastEdited: {
    timestamp: string;
    user: string;
  };
}

// Interface for leads table data
interface LeadData {
  id: number;
  lead_number: string;
  name: string;
  manager: string;
  helper: string;
  category: string;
  balance: number;
}

const localizer = momentLocalizer(moment);

interface SharedMailbox {
  id: string;
  email: string;
  color: string;
  label: string;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  resource: any;
  color: string;
  group: string;
  mailbox: string;
  location?: string;
  attendees?: any[];
  description?: string;
}

// Calendar event interface for the dashboard-style calendar
interface DashboardCalendarEvent {
  id: string;
  title: string;
  date: string;
  type: 'meeting' | 'outlook';
  leadNumber?: string;
  clientName?: string;
  meetingTime?: string;
  allDay?: boolean;
  start?: Date | null;
  end?: Date | null;
  resource?: any;
  description?: string;
  startTimeZone?: string;
  endTimeZone?: string;
  manager?: string;
}

const DEFAULT_MAILBOXES: SharedMailbox[] = [
  { id: '1', email: 'shared-staffcalendar@lawoffice.org.il', color: '#6366f1', label: 'Staff' },
  { id: '2', email: 'shared-newclients@lawoffice.org.il', color: '#10b981', label: 'New Clients' },
  { id: '3', email: 'shared-potentialclients@lawoffice.org.il', color: '#f59e42', label: 'Potential Clients' },
];

// Helper: Map Windows time zone to IANA (expanded)
function windowsToIana(windowsTz: string | undefined): string | undefined {
  if (!windowsTz) return undefined;
  const map: Record<string, string> = {
    'Israel Standard Time': 'Asia/Jerusalem',
    'Pacific Standard Time': 'America/Los_Angeles',
    'Eastern Standard Time': 'America/New_York',
    'Central Europe Standard Time': 'Europe/Berlin',
    'GMT Standard Time': 'Europe/London',
    'W. Europe Standard Time': 'Europe/Berlin',
    'Romance Standard Time': 'Europe/Paris',
    'Central Standard Time': 'America/Chicago',
    'Mountain Standard Time': 'America/Denver',
    'China Standard Time': 'Asia/Shanghai',
    'Tokyo Standard Time': 'Asia/Tokyo',
    // Add more as needed
  };
  return map[windowsTz] || undefined;
}

function getDateString(year: number, month: number, day: number) {
  return [
    year,
    String(month + 1).padStart(2, '0'),
    String(day).padStart(2, '0')
  ].join('-');
}

const OutlookCalendarPage: React.FC = () => {
  const { instance, accounts } = useMsal();

  // Helper to extract a valid Teams join link from various formats (from CalendarPage)
  const getValidTeamsLink = (link: string | undefined) => {
    if (!link) return '';
    try {
      if (link.startsWith('http')) return link;
      const obj = JSON.parse(link);
      if (obj && typeof obj === 'object' && obj.joinUrl && typeof obj.joinUrl === 'string') {
        return obj.joinUrl;
      }
      if (obj && typeof obj === 'object' && obj.joinWebUrl && typeof obj.joinWebUrl === 'string') {
        return obj.joinWebUrl;
      }
    } catch (e) {
      if (typeof link === 'string' && link.startsWith('http')) return link;
    }
    return '';
  };
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const sharedMailboxes = DEFAULT_MAILBOXES;
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [view, setView] = useState(Views.MONTH);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedMailbox, setSelectedMailbox] = useState('');
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [totalAmount, setTotalAmount] = useState(0);
  const [viewMode, setViewMode] = useState<'list' | 'month'>('list');
  const [monthModalDay, setMonthModalDay] = useState<Date | null>(null);
  const [monthModalEvents, setMonthModalEvents] = useState<CalendarEvent[]>([]);
  
  // Teams meeting modal state
  const [isTeamsMeetingModalOpen, setIsTeamsMeetingModalOpen] = useState(false);
  const [selectedDateForMeeting, setSelectedDateForMeeting] = useState<Date | null>(null);
  const [selectedTimeForMeeting, setSelectedTimeForMeeting] = useState<string>('');
  
  // Teams meetings from database
  const [outlookTeamsMeetings, setOutlookTeamsMeetings] = useState<OutlookTeamsMeeting[]>([]);
  
  // Meetings from database for lead information
  const [meetingsData, setMeetingsData] = useState<MeetingData[]>([]);
  
  // Leads from database for additional information
  const [leadsData, setLeadsData] = useState<LeadData[]>([]);

  // Calendar state for dashboard-style calendar
  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarEvents, setCalendarEvents] = useState<DashboardCalendarEvent[]>([]);
  const [isCalendarLoading, setIsCalendarLoading] = useState(false);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Calendar helper functions
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    return { daysInMonth, firstDayOfMonth };
  };

  const getEventsForDate = (date: string): DashboardCalendarEvent[] => {
    return calendarEvents.filter(event => event.date === date);
  };

  const formatDate = (date: Date) => {
    return date.toISOString().split('T')[0];
  };

  const goToPreviousMonthCalendar = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const goToNextMonthCalendar = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const goToTodayCalendar = () => {
    setCurrentDate(new Date());
  };

  const handleDateClick = (date: string) => {
    setSelectedCalendarDate(date);
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setSelectedCalendarDate(null);
  };

  const getEventsForSelectedDate = () => {
    if (!selectedCalendarDate) return [];
    return calendarEvents.filter(event => event.date === selectedCalendarDate);
  };

  // Fetch Outlook events for dashboard calendar
  const fetchOutlookEvents = async (): Promise<DashboardCalendarEvent[]> => {
    if (!accounts[0] || sharedMailboxes.length === 0) return [];
    try {
      const account = accounts[0];
      const tokenResponse = await instance.acquireTokenSilent({
        scopes: [
          'Calendars.Read',
          'Calendars.Read.Shared',
          'Calendars.ReadWrite',
          'Calendars.ReadWrite.Shared'
        ],
        account,
      });
      let allEvents: DashboardCalendarEvent[] = [];
      for (const mailbox of sharedMailboxes) {
        try {
          console.log('[Outlook Fetch] Fetching events for mailbox:', mailbox.email);
          const res = await fetch(
            `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox.email)}/calendar/events?$top=100&$orderby=start/dateTime&$select=id,subject,start,end,isAllDay,location,attendees,body,organizer,onlineMeeting,webLink`,
            {
              headers: {
                Authorization: `Bearer ${tokenResponse.accessToken}`,
                'Content-Type': 'application/json',
              },
            }
          );
          console.log('[Outlook Fetch] Response status for', mailbox.email, ':', res.status);
          if (!res.ok) {
            const errorText = await res.text();
            console.error('[Outlook Fetch] Error for', mailbox.email, ':', errorText);
            continue;
          }
          const data = await res.json();
          console.log('[Outlook Fetch] Events fetched for', mailbox.email, ':', data.value?.length || 0);
          if (data.value) {
            const mailboxEvents: DashboardCalendarEvent[] = data.value.map((event: any) => ({
              id: `outlook-${event.id}`,
              title:
                mailbox.email === 'shared-staffcalendar@lawoffice.org.il' ? 'Staff Meeting' :
                mailbox.email === 'shared-newclients@lawoffice.org.il' ? 'Existing Client Meeting' :
                mailbox.email === 'shared-potentialclients@lawoffice.org.il' ? 'Potential Client Meeting' :
                event.subject || 'No Subject',
              date: event.start?.dateTime
                ? event.start.dateTime.split('T')[0]
                : event.start?.date
                  ? event.start.date
                  : '',
              type: 'outlook',
              color: mailbox.color,
              group: mailbox.label,
              mailbox: mailbox.email,
              start: event.start?.dateTime
                ? event.start.dateTime
                : event.start?.date
                  ? event.start.date
                  : null,
              end: event.end?.dateTime
                ? event.end.dateTime
                : event.end?.date
                  ? event.end.date
                  : null,
              startTimeZone: event.start?.timeZone,
              endTimeZone: event.end?.timeZone,
              allDay: event.isAllDay || false,
              location: event.location?.displayName,
              attendees: event.attendees,
              description: event.body?.content,
              resource: event,
            }));
            console.log('[Outlook Fetch] Parsed events for', mailbox.email, ':', mailboxEvents);
            allEvents = allEvents.concat(mailboxEvents);
          }
        } catch (error) {
          console.error('[Outlook Fetch] Exception for', mailbox.email, ':', error);
          // skip mailbox on error
        }
      }
      console.log('[Outlook Fetch] Final allEvents array:', allEvents);
      return allEvents;
    } catch (err) {
      return [];
    }
  };

  // Fetch Teams meetings from database
  const fetchOutlookTeamsMeetings = async () => {
    try {
      const { data, error } = await getOutlookTeamsMeetings();
      if (error) {
        console.error('Error fetching Teams meetings from database:', error);
        return;
      }
      setOutlookTeamsMeetings(data || []);
      console.log('Teams meetings from database:', data);
    } catch (error) {
      console.error('Exception fetching Teams meetings from database:', error);
    }
  };

  // Fetch meetings data from database for lead information
  const fetchMeetingsData = async () => {
    try {
      console.log('Fetching meetings data from database...');
      const { data, error } = await supabase
        .from('meetings')
        .select('*')
        .not('meeting_manager', 'is', null);
      
      console.log('Raw meetings data from database:', data);
      console.log('Number of meetings found:', data?.length || 0);

      if (error) {
        console.error('Error fetching meetings data:', error);
        return;
      }
      
      // Format meetings data like in MeetingTab
      const formattedMeetings = data?.map((m: any) => ({
        id: m.id,
        client_id: m.client_id,
        date: m.meeting_date,
        time: m.meeting_time,
        location: m.meeting_location,
        manager: m.meeting_manager,
        currency: m.meeting_currency,
        amount: m.meeting_amount,
        brief: m.meeting_brief,
        scheduler: m.scheduler,
        helper: m.helper,
        expert: m.expert,
        link: m.teams_meeting_url, // This is the key field for Teams URL
        status: m.status || 'scheduled',
        expert_notes: m.expert_notes,
        handler_notes: m.handler_notes,
        eligibility_status: m.eligibility_status,
        feasibility_notes: m.feasibility_notes,
        documents_link: m.documents_link,
        lastEdited: {
          timestamp: m.last_edited_timestamp,
          user: m.last_edited_by,
        },
      })) || [];
      
      setMeetingsData(formattedMeetings);
      console.log('Formatted meetings data from database:', formattedMeetings);
      console.log('Number of meetings found:', formattedMeetings.length);
      
      // Log meetings with Teams URLs
      const meetingsWithTeamsUrls = formattedMeetings.filter(m => m.link);
      console.log('Meetings with Teams URLs:', meetingsWithTeamsUrls);
      console.log('Number of meetings with Teams URLs:', meetingsWithTeamsUrls.length);
      
      // Log some sample meetings for debugging
      if (formattedMeetings.length > 0) {
        console.log('Sample meetings:', formattedMeetings.slice(0, 3));
      }
    } catch (error) {
      console.error('Exception fetching meetings data:', error);
    }
  };

  // Fetch leads data from database for additional information
  const fetchLeadsData = async () => {
    try {
      console.log('Fetching leads data from database...');
      const { data, error } = await supabase
        .from('leads')
        .select('id, lead_number, name, manager, helper, category, balance');

      if (error) {
        console.error('Error fetching leads data:', error);
        return;
      }
      setLeadsData(data || []);
      console.log('Leads data from database:', data);
      console.log('Number of leads found:', data?.length || 0);
    } catch (error) {
      console.error('Exception fetching leads data:', error);
    }
  };

  // Fetch calendar events
  const fetchCalendarEvents = async () => {
    setIsCalendarLoading(true);
    try {
      const { data: meetingsData, error: meetingsError } = await supabase
        .from('meetings')
        .select('id, meeting_date, client_id, meeting_brief, meeting_time, leads!client_id(id, lead_number, name, manager)')
        .not('meeting_date', 'is', null);

      console.log('Fetched ALL meetings for dashboard calendar:', meetingsData);

      if (meetingsError) throw meetingsError;

      const outlookEvents = await fetchOutlookEvents();
      console.log('[Outlook Fetch] outlookEvents returned:', outlookEvents);

      // Combine and format events
      const formattedMeetings = meetingsData?.map(meeting => ({
        id: `meeting-${meeting.id}`,
        title: meeting.meeting_brief || 'Meeting',
        date: typeof meeting.meeting_date === 'string' ? meeting.meeting_date.split('T')[0] : '',
        type: 'meeting' as const,
        leadNumber: Array.isArray(meeting.leads) && meeting.leads.length > 0 && typeof meeting.leads[0] === 'object' && meeting.leads[0] !== null && 'lead_number' in meeting.leads[0]
          ? (meeting.leads[0] as any).lead_number
          : (meeting.leads && typeof meeting.leads === 'object' && 'lead_number' in meeting.leads ? (meeting.leads as any).lead_number : 'N/A'),
        clientName: Array.isArray(meeting.leads) && meeting.leads.length > 0 && typeof meeting.leads[0] === 'object' && meeting.leads[0] !== null && 'name' in meeting.leads[0]
          ? (meeting.leads[0] as any).name
          : (meeting.leads && typeof meeting.leads === 'object' && 'name' in meeting.leads ? (meeting.leads as any).name : 'N/A'),
        meetingTime: meeting.meeting_time || 'N/A',
        manager: Array.isArray(meeting.leads) && meeting.leads.length > 0 && typeof meeting.leads[0] === 'object' && meeting.leads[0] !== null && 'manager' in meeting.leads[0]
          ? (meeting.leads[0] as any).manager
          : (meeting.leads && typeof meeting.leads === 'object' && 'manager' in meeting.leads ? (meeting.leads as any).manager : 'N/A'),
      })) || [];

      const allEvents = [...formattedMeetings, ...outlookEvents];
      console.log('Setting calendarEvents:', allEvents);
      setCalendarEvents(allEvents);
    } catch (error) {
      console.error('Error fetching calendar events:', error);
    } finally {
      setIsCalendarLoading(false);
    }
  };

  // Fetch calendar events when date changes
  useEffect(() => {
    fetchCalendarEvents();
  }, [currentDate, accounts, instance]);

  useEffect(() => {
    const fetchEvents = async () => {
      if (!accounts[0] || sharedMailboxes.length === 0) return;
      
      setLoading(true);
      try {
        const account = accounts[0];
        const tokenResponse = await instance.acquireTokenSilent({
          scopes: [
            'Calendars.Read',
            'Calendars.Read.Shared',
            'Calendars.ReadWrite',
            'Calendars.ReadWrite.Shared'
          ],
          account,
        });
        console.log('Access token acquired for calendar events');

        // Fetch events for each shared mailbox using /users/{email}/calendar/events
        let allEvents: CalendarEvent[] = [];
        for (const mailbox of sharedMailboxes) {
          try {
            console.log(`Fetching events for mailbox: ${mailbox.email}`);
            const res = await fetch(
              `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox.email)}/calendar/events?$top=100&$orderby=start/dateTime&$select=id,subject,start,end,isAllDay,location,attendees,body,organizer`,
              { 
                headers: { 
                  Authorization: `Bearer ${tokenResponse.accessToken}`,
                  'Content-Type': 'application/json'
                } 
              }
            );
            
            if (!res.ok) {
              const errorText = await res.text();
              console.error(`Error fetching events for ${mailbox.email}:`, errorText);
              continue; // Skip this mailbox and continue with others
            }
            
            const data = await res.json();
            console.log(`Events fetched for ${mailbox.email}:`, data.value?.length || 0, 'events');
            
            if (data.value) {
              const mailboxEvents: CalendarEvent[] = data.value.map((event: any) => ({
                id: event.id,
                title: event.subject || 'No Subject',
                start: new Date(event.start.dateTime || event.start.date),
                end: new Date(event.end.dateTime || event.end.date),
                allDay: event.isAllDay || false,
                resource: event,
                color: mailbox.color,
                group: mailbox.label,
                mailbox: mailbox.email,
                location: event.location?.displayName,
                attendees: event.attendees,
                description: event.body?.content,
              }));
              allEvents = allEvents.concat(mailboxEvents);
            }
          } catch (error) {
            console.error(`Error processing mailbox ${mailbox.email}:`, error);
          }
        }
        
        setEvents(allEvents);
        console.log(`Total events loaded: ${allEvents.length}`);
      } catch (err) {
        console.error('Error fetching calendar events:', err);
      }
      setLoading(false);
    };
    
    fetchEvents();
    fetchOutlookTeamsMeetings();
    fetchMeetingsData();
    fetchLeadsData();
  }, [instance, accounts, sharedMailboxes]);

  const handleEventClick = (event: CalendarEvent) => {
    setSelectedEvent(event);
    setShowEventModal(true);
  };

  const closeEventModal = () => {
    setShowEventModal(false);
    setSelectedEvent(null);
  };

  // Custom event style getter for color-coding
  const eventStyleGetter = (event: CalendarEvent) => {
    return {
      style: {
        backgroundColor: event.color,
        borderRadius: '6px',
        color: 'white',
        border: 'none',
        display: 'block',
        fontSize: '12px',
        padding: '2px 4px',
        cursor: 'pointer',
        fontWeight: '500',
      },
    };
  };

  // Custom event component for month view to show time
  const MonthEventComponent = ({ event }: { event: CalendarEvent }) => {
    const formatTime = (date: Date) => moment(date).format('HH:mm');
    const isAllDay = event.allDay;
    const timeText = isAllDay ? 'All Day' : `${formatTime(event.start)} - ${formatTime(event.end)}`;
    return (
      <div 
        className="event-item cursor-pointer hover:opacity-80 transition-opacity"
        onClick={() => handleEventClick(event)}
        title={`${event.title} (${event.group})`}
      >
        <div className="font-medium text-xs mb-1">{event.title}</div>
        <div className="text-xs opacity-90 flex items-center gap-1">
          <ClockIcon className="w-3 h-3" />
          {timeText}
        </div>
        {event.location && (
          <div className="text-xs opacity-90 flex items-center gap-1 mt-1">
            <MapPinIcon className="w-3 h-3" />
            {event.location}
          </div>
        )}
      </div>
    );
  };

  // Custom event component for week/day/agenda views: just the title
  const TitleOnlyEventComponent = ({ event }: { event: CalendarEvent }) => (
    <div
      className="event-item cursor-pointer hover:opacity-80 transition-opacity"
      onClick={() => handleEventClick(event)}
      title={`${event.title} (${event.group})`}
    >
      <span className="font-medium text-xs">{event.title}</span>
    </div>
  );

  // Custom event component for agenda view: modern card style
  const AgendaEventComponent = ({ event }: { event: CalendarEvent }) => {
    const joinUrl = event.resource?.onlineMeeting?.joinUrl
      || event.resource?.teamsMeetingUrl
      || event.resource?.webLink
      || event.resource?.location?.uri;
    return (
      <div className="bg-base-100 rounded-lg shadow p-4 mb-4 flex flex-col md:flex-row md:items-center gap-4 border border-base-200">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <CalendarIcon className="w-5 h-5 text-primary" />
            <span className="font-bold text-lg text-black" style={{ color: '#222' }}>{event.title}</span>
            <span
              className="ml-2 px-2 py-1 rounded text-xs font-semibold border"
              style={{ background: '#fff', borderColor: event.color, color: '#222' }}
            >
              {event.group}
            </span>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-base-content/80 mb-2">
            <div className="flex items-center gap-1">
              <span className="font-semibold text-black" style={{ color: '#222' }}>When:</span>
              <span className="text-black" style={{ color: '#222' }}>
                {event.allDay
                  ? 'All Day'
                  : `${moment(event.start).format('MMM D, YYYY h:mm A')} - ${moment(event.end).format('h:mm A')}`}
              </span>
            </div>
            {event.location && (
              <div className="flex items-center gap-1">
                <MapPinIcon className="w-4 h-4" />
                <span>{event.location}</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <span className="font-semibold">Mailbox:</span>
              <span>{event.mailbox}</span>
            </div>
          </div>
          {event.attendees && event.attendees.length > 0 && (
            <div className="flex items-center gap-2 mb-2">
              <UserIcon className="w-4 h-4" />
              <span className="font-semibold">Attendees:</span>
              <span>{event.attendees.map((a: any) => a.emailAddress?.name || a.emailAddress?.address).join(', ')}</span>
            </div>
          )}
        </div>
        {joinUrl && (
          <a
            href={joinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary flex items-center gap-2 self-start md:self-center"
          >
            <VideoCameraIcon className="w-5 h-5" />
            Join Meeting
          </a>
        )}
      </div>
    );
  };

  // Custom toolbar with view switcher
  const CustomToolbar = (toolbar: any) => {
    const goToToday = () => {
      toolbar.onNavigate('TODAY');
    };

    const goToPrev = () => {
      toolbar.onNavigate('PREV');
    };

    const goToNext = () => {
      toolbar.onNavigate('NEXT');
    };

    const viewNames = {
      [Views.MONTH]: 'Month',
      [Views.WEEK]: 'Week',
      [Views.DAY]: 'Day',
      [Views.AGENDA]: 'Agenda',
    };

    return (
      <div className="flex justify-between items-center mb-4 p-4 bg-base-200 rounded-lg">
        <div className="flex items-center gap-2">
          <button className="btn btn-sm btn-outline" onClick={goToToday}>
            Today
          </button>
          <div className="flex gap-1">
            <button className="btn btn-sm btn-outline" onClick={goToPrev}>
              ‹
            </button>
            <button className="btn btn-sm btn-outline" onClick={goToNext}>
              ›
            </button>
          </div>
          <h2 className="text-lg font-semibold ml-4">
            {toolbar.label}
          </h2>
        </div>
        
        <div className="flex gap-1">
          <button
            className="btn btn-sm btn-primary flex items-center gap-2"
            onClick={() => {
              setSelectedDateForMeeting(new Date());
              setSelectedTimeForMeeting('09:00');
              setIsTeamsMeetingModalOpen(true);
            }}
          >
            <VideoCameraIcon className="h-4 w-4" />
            Create Teams Meeting
          </button>
          {Object.entries(viewNames).map(([viewKey, viewName]) => (
            <button
              key={viewKey}
              className={`btn btn-sm ${toolbar.view === viewKey ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => toolbar.onView(viewKey)}
            >
              {viewName}
            </button>
          ))}
        </div>
      </div>
    );
  };

  // Date navigation
  const goToPreviousDay = () => {
    const currentDate = new Date(selectedDate);
    currentDate.setDate(currentDate.getDate() - 1);
    setSelectedDate(currentDate.toISOString().split('T')[0]);
  };
  const goToNextDay = () => {
    const currentDate = new Date(selectedDate);
    currentDate.setDate(currentDate.getDate() + 1);
    setSelectedDate(currentDate.toISOString().split('T')[0]);
  };
  const goToToday = () => {
    setSelectedDate(new Date().toISOString().split('T')[0]);
  };

  // Filter events by date and mailbox
  const filteredEvents = events.filter(ev => {
    const eventDate = ev.start.toISOString().split('T')[0];
    const dateMatch = eventDate === selectedDate;
    const mailboxMatch = selectedMailbox ? ev.mailbox === selectedMailbox : true;
    return dateMatch && mailboxMatch;
  });

  useEffect(() => {
    // Calculate total amount (mock: use event.resource.amount or 0)
    const total = filteredEvents.reduce((acc, ev) => acc + (ev.resource?.amount || 0), 0);
    setTotalAmount(total);
  }, [filteredEvents]);

  // Render event row (like renderMeetingRow in CalendarPage)
  const renderEventRow = (event: CalendarEvent) => {
    const isExpanded = expandedEventId === event.id;
    return (
      <React.Fragment key={event.id}>
        <tr className="hover:bg-base-200/50">
          <td className="font-bold flex items-center gap-2">
            <span style={{ background: event.color, width: 12, height: 12, borderRadius: 6, display: 'inline-block' }} />
            {event.title}
          </td>
          <td>{event.start.toLocaleDateString()} at {event.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
          <td>{event.group}</td>
          <td className="max-w-xs">
            {(() => {
              // Check if this meeting exists in our database
              const dbMeeting = outlookTeamsMeetings.find(m => 
                m.teams_meeting_id === event.resource?.id || 
                m.subject === event.title
              );
              
              // For Potential Clients meetings, show lead information
              if (event.group === 'Potential Clients') {
                console.log('Potential Clients meeting found:', {
                  title: event.title,
                  resource: event.resource,
                  teamsUrl: event.resource?.onlineMeeting?.joinUrl,
                  webLink: event.resource?.webLink,
                  meetingsData: meetingsData
                });
                
                // Extract lead number from title (e.g., "[#L27] Norman King - Meeting" -> "L27")
                const leadNumberMatch = event.title.match(/\[#(L\d+)\]/);
                const leadNumber = leadNumberMatch ? leadNumberMatch[1] : null;
                
                console.log('Extracted lead number:', leadNumber);
                
                // Find matching meeting in database by Teams URL or subject
                const matchingMeeting = meetingsData.find(m => {
                  const urlMatch = m.link === event.resource?.onlineMeeting?.joinUrl ||
                                  m.link === event.resource?.webLink;
                  const subjectMatch = m.brief === event.title;
                  
                  console.log('Checking meeting match:', {
                    meetingId: m.id,
                    meetingSubject: m.brief,
                    meetingUrl: m.link,
                    eventTitle: event.title,
                    eventUrl: event.resource?.onlineMeeting?.joinUrl,
                    urlMatch,
                    subjectMatch
                  });
                  
                  return urlMatch || subjectMatch;
                });
                
                // Find matching lead by lead number
                const matchingLead = leadNumber ? leadsData.find(l => l.lead_number === leadNumber) : null;
                
                console.log('Matching meeting found:', matchingMeeting);
                console.log('Matching lead found:', matchingLead);
                
                return (
                  <div className="text-sm text-gray-700">
                    <div className="space-y-1">
                      <div><span className="font-medium">Manager:</span> {matchingMeeting?.manager || matchingLead?.manager || 'N/A'}</div>
                      <div><span className="font-medium">Helper:</span> {matchingMeeting?.helper || matchingLead?.helper || 'N/A'}</div>
                      <div><span className="font-medium">Category:</span> {matchingLead?.category || 'N/A'}</div>
                      <div><span className="font-medium">Balance:</span> ${(matchingLead?.balance || 0).toLocaleString()}</div>
                    </div>
                  </div>
                );
              }
              
              // For other meetings, show regular description
              const description = dbMeeting?.description || event.description;
              
              if (description) {
                // Strip HTML tags and format nicely
                const cleanDescription = description
                  .replace(/<[^>]*>/g, '') // Remove HTML tags
                  .replace(/\s+/g, ' ') // Normalize whitespace
                  .trim();
                
                return (
                  <div className="text-sm text-gray-700" title={cleanDescription}>
                    {cleanDescription.length > 100 
                      ? (
                        <div>
                          <div>{cleanDescription.substring(0, 100)}...</div>
                          <div className="text-xs text-gray-500 mt-1">
                            Hover to see full description
                          </div>
                        </div>
                      ) 
                      : cleanDescription
                    }
                  </div>
                );
              } else {
                return (
                  <span className="text-gray-400 italic text-sm">No description</span>
                );
              }
            })()}
          </td>
          <td><span className="badge badge-success">{event.resource?.status || 'Scheduled'}</span></td>
          <td>
            {(() => {
              // Check outlook_teams_meetings table for staff meetings (DON'T CHANGE THIS LOGIC)
              const outlookDbMeeting = outlookTeamsMeetings.find(m => 
                m.teams_meeting_id === event.resource?.id || 
                m.subject === event.title
              );

              // Check meetings table for potential clients meetings
              const meetingsTableMeeting = meetingsData.find(m => {
                // Extract lead number from event title (e.g., "[#L30] Bernhard Meisler - Meeting" -> lead_number = 30)
                const leadMatch = event.title.match(/\[#L(\d+)\]/);
                if (leadMatch) {
                  const leadNumber = parseInt(leadMatch[1]);
                  // Find matching lead by lead number
                  const matchingLead = leadsData.find(lead => lead.lead_number === leadNumber.toString());
                  if (matchingLead && m.client_id === matchingLead.id) {
                    return true;
                  }
                }
                return false;
              });

              // Check if this is a Teams meeting based on Graph API data or database tables
              const hasTeamsMeeting = outlookDbMeeting?.teams_join_url
                || outlookDbMeeting?.teams_meeting_url
                || meetingsTableMeeting?.link
                || event.resource?.onlineMeeting?.joinUrl 
                || event.resource?.teamsMeetingUrl 
                || event.resource?.teams_meeting_url
                || event.resource?.webLink
                || (event.resource?.location?.displayName && event.resource.location.displayName.includes('Microsoft Teams Meeting'))
                || (event.resource?.onlineMeeting && Object.keys(event.resource.onlineMeeting).length > 0);
              
              // Get the location from the event or meeting data
              let location = event.location || 'N/A';
              
              // For potential clients meetings, try to get location from meetings table
              if (event.group === 'Potential Clients' && meetingsTableMeeting) {
                location = meetingsTableMeeting.location || location;
              }
              
              // If it's a Teams meeting, show the Teams button
              if (hasTeamsMeeting) {
                return (
                  <button 
                    className="btn btn-sm btn-primary gap-2"
                    title={((outlookDbMeeting?.teams_join_url || meetingsTableMeeting?.link || event.resource?.onlineMeeting?.joinUrl || event.resource?.webLink) ? 'Join Teams Meeting' : 'Teams Meeting (check Outlook/Teams for join link)')}
                    onClick={() => {
                      // Priority order: outlook_teams_meetings -> meetings table -> Graph API
                      let url = null;
                      
                      // Check outlook_teams_meetings table (for staff meetings)
                      if (outlookDbMeeting?.teams_join_url) {
                        url = getValidTeamsLink(outlookDbMeeting.teams_join_url);
                      }
                      
                      // Check meetings table (for potential clients meetings)
                      if (!url && meetingsTableMeeting?.link) {
                        url = getValidTeamsLink(meetingsTableMeeting.link);
                      }
                      
                      // Fallback to Graph API data
                      if (!url) {
                        url = getValidTeamsLink(event.resource?.onlineMeeting?.joinUrl || event.resource?.webLink);
                      }
                      
                      if (url) {
                        window.open(url, '_blank');
                      } else {
                        alert('No meeting URL available');
                      }
                    }}
                  >
                    <VideoCameraIcon className="w-4 h-4" />
                    {((outlookDbMeeting?.teams_join_url || meetingsTableMeeting?.link || event.resource?.onlineMeeting?.joinUrl || event.resource?.webLink) ? 'Join Teams Meeting' : 'Teams Meeting')}
                  </button>
                );
              }
              
              // For non-Teams meetings, show the location
              return (
                <span className="text-sm font-medium text-gray-700">
                  {location}
                </span>
              );
            })()}
          </td>
        </tr>
        {/* Expanded Details Row */}
        {isExpanded && (
          <tr>
            <td colSpan={6} className="p-0">
              <div className="bg-base-100/50 p-4 border-t border-base-200">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-base-200/50 p-4 rounded-lg">
                    <h5 className="font-semibold text-base-content/90 mb-2">Description</h5>
                    <div className="text-sm text-base-content/90 whitespace-pre-wrap">{event.description ? stripHtml(event.description) : 'No description.'}</div>
                  </div>
                  <div className="bg-base-200/50 p-4 rounded-lg">
                    <h5 className="font-semibold text-base-content/90 mb-2">Attendees</h5>
                    <div className="space-y-2">
                      {event.attendees && event.attendees.length > 0 ? (
                        event.attendees.map((a: any, idx: number) => (
                          <div key={idx} className="flex items-center gap-2 text-sm">
                            <UserIcon className="w-4 h-4" />
                            {a.emailAddress?.name || a.emailAddress?.address}
                          </div>
                        ))
                      ) : (
                        <span className="text-base-content/70">No attendees.</span>
                      )}
                    </div>
                  </div>
                  <div className="md:col-span-2 flex justify-center gap-4">
                    <button
                      onClick={() => {
                        setSelectedEvent(event);
                        setIsDocumentModalOpen(true);
                      }}
                      className="btn btn-outline btn-primary flex items-center gap-2 px-4 py-2 text-base font-semibold rounded-lg shadow hover:bg-primary hover:text-white transition-colors"
                    >
                      <FolderIcon className="w-5 h-5" />
                      Documents
                    </button>
                                          {(() => {
                        // Check outlook_teams_meetings table for staff meetings
                        const expandedOutlookDbMeeting = outlookTeamsMeetings.find(m => 
                          m.teams_meeting_id === event.resource?.id || 
                          m.subject === event.title
                        );
                        
                        // Check meetings table for potential clients meetings
                        const expandedMeetingsTableMeeting = meetingsData.find(m => {
                          const leadMatch = event.title.match(/\[#L(\d+)\]/);
                          if (leadMatch) {
                            const leadNumber = parseInt(leadMatch[1]);
                            // Find matching lead by lead number
                            const matchingLead = leadsData.find(lead => lead.lead_number === leadNumber.toString());
                            if (matchingLead && m.client_id === matchingLead.id) {
                              return true;
                            }
                          }
                          return false;
                        });
                        
                        // Priority order: outlook_teams_meetings -> meetings table -> Graph API
                        let teamsUrl = null;
                        
                        if (expandedOutlookDbMeeting?.teams_join_url) {
                          teamsUrl = getValidTeamsLink(expandedOutlookDbMeeting.teams_join_url);
                        } else if (expandedMeetingsTableMeeting?.link) {
                          teamsUrl = getValidTeamsLink(expandedMeetingsTableMeeting.link);
                        } else {
                          teamsUrl = getValidTeamsLink(event.resource?.onlineMeeting?.joinUrl || event.resource?.webLink);
                        }
                        
                        return teamsUrl && (
                        <a
                          href={teamsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-primary flex items-center gap-2 px-4 py-2 text-base font-semibold rounded-lg shadow hover:bg-primary/90 transition-colors"
                        >
                          <VideoCameraIcon className="w-5 h-5" />
                          Open Teams Meeting
                        </a>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </td>
          </tr>
        )}
        {/* Toggle Row */}
        <tr>
          <td colSpan={6} className="p-0">
            <div
              className="bg-base-200 hover:bg-base-300 cursor-pointer transition-colors p-2 text-center"
              onClick={() => setExpandedEventId(expandedEventId === event.id ? null : event.id)}
            >
              <div className="flex items-center justify-center gap-2 text-sm font-medium text-primary">
                <span>{expandedEventId === event.id ? 'Show Less' : 'Show More'}</span>
                <ChevronDownIcon className={`w-5 h-5 transition-transform ${expandedEventId === event.id ? 'rotate-180' : ''}`} />
              </div>
            </div>
          </td>
        </tr>
      </React.Fragment>
    );
  };

  // Helper: get all days in current month
  const getMonthDays = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days: Date[] = [];
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push(new Date(year, month, d));
    }
    return days;
  };
  // Helper: get events for a given day
  const getEventsForDay = (day: Date) => {
    const dayStr = day.toISOString().split('T')[0];
    return events.filter(ev => ev.start.toISOString().split('T')[0] === dayStr);
  };
  // Month view state
  const [monthViewDate, setMonthViewDate] = useState(() => {
    const d = new Date(selectedDate);
    d.setDate(1);
    return d;
  });
  // Month navigation
  const goToPrevMonth = () => {
    setMonthViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };
  const goToNextMonth = () => {
    setMonthViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };
  // Month grid rendering
  const renderMonthGrid = () => {
    const days = getMonthDays(monthViewDate);
    const firstDayOfWeek = new Date(monthViewDate.getFullYear(), monthViewDate.getMonth(), 1).getDay();
    const blanks = Array.from({ length: firstDayOfWeek }, (_, i) => <div key={'blank-' + i}></div>);
    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <button className="btn btn-circle btn-outline btn-primary" onClick={goToPrevMonth}><ChevronLeftIcon className="w-6 h-6" /></button>
          <span className="text-lg font-semibold">
            {monthViewDate.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
          </span>
          <button className="btn btn-circle btn-outline btn-primary" onClick={goToNextMonth}><ChevronRightIcon className="w-6 h-6" /></button>
        </div>
        <div className="grid grid-cols-7 gap-2 mb-2 text-center text-base-content/70 font-semibold">
          <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {blanks}
          {days.map(day => {
            const evs = getEventsForDay(day);
            const isToday = day.toDateString() === new Date().toDateString();
            return (
              <div
                key={day.toISOString()}
                className={`card cursor-pointer transition-all hover:shadow-lg p-2 min-h-[80px] flex flex-col items-start ${isToday ? 'border-2 border-primary' : 'border border-base-200'}`}
                onClick={() => {
                  setMonthModalDay(day);
                  setMonthModalEvents(evs);
                }}
              >
                <div className="font-bold text-base-content/80 mb-1">{day.getDate()}</div>
                <div className="flex flex-wrap gap-1">
                  {evs.slice(0, 3).map(ev => (
                    <span key={ev.id} className="badge badge-xs" style={{ background: ev.color }} title={ev.title}></span>
                  ))}
                  {evs.length > 3 && <span className="badge badge-xs bg-base-200">+{evs.length - 3}</span>}
                </div>
              </div>
            );
          })}
        </div>
        {/* Modal for day events */}
        {monthModalDay && (
          <div className="modal modal-open">
            <div className="modal-box max-w-lg">
              <div className="flex items-center justify-between mb-4">
                <div className="text-lg font-bold">
                  {monthModalDay.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                </div>
                <button className="btn btn-sm btn-circle btn-ghost" onClick={() => setMonthModalDay(null)}>✕</button>
              </div>
              {monthModalEvents.length === 0 ? (
                <div className="text-base-content/60">No events for this day.</div>
              ) : (
                <div className="space-y-4">
                  {monthModalEvents.map(ev => (
                    <div key={ev.id} className="card bg-base-100 shadow p-3 flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="badge badge-xs" style={{ background: ev.color }}></span>
                        <span className="font-semibold">{ev.title}</span>
                      </div>
                      <div className="text-xs text-base-content/70">
                        {ev.allDay 
                          ? 'All Day'
                          : `${ev.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${ev.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                        }
                      </div>
                      <div className="text-xs text-base-content/60">{ev.group} • {ev.mailbox}</div>
                      {ev.location && (
                        <div className="text-xs text-base-content/70 mt-1"><span className="font-medium">Location:</span> {ev.location}</div>
                      )}
                      <div className="text-xs text-base-content/70 mt-1">
                        <span className="font-medium">Description:</span> {ev.description ? stripHtml(ev.description) : 'No description'}
                      </div>
                      <div className="flex gap-2 mt-1">
                        <button className="btn btn-xs btn-outline btn-primary" onClick={() => {
                          const joinUrl = ev.resource?.onlineMeeting?.joinUrl
                            || ev.resource?.teamsMeetingUrl
                            || ev.resource?.webLink
                            || ev.resource?.location?.uri;
                          if (joinUrl) {
                            window.open(joinUrl, '_blank');
                          } else {
                            alert('No meeting URL available');
                          }
                        }}>Join</button>
                        <button className="btn btn-xs btn-outline" onClick={() => setSelectedEvent(ev)}>Details</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Add a helper function to strip HTML tags
  function stripHtml(html?: string): string {
    if (!html) return '';
    const tmp = document.createElement('DIV');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  return (
    <div className="p-4 md:p-6 lg:p-8">
      {/* Date Navigation */}
      <div className="mb-6 flex items-center justify-center gap-4">
        <button
          onClick={goToPreviousDay}
          className="btn btn-circle btn-outline btn-primary"
          title="Previous Day"
        >
          <ChevronLeftIcon className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold">
            {new Date(selectedDate).toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </span>
          <button
            onClick={goToToday}
            className="btn btn-sm btn-primary"
            title="Go to Today"
          >
            Today
          </button>
        </div>
        <button
          onClick={goToNextDay}
          className="btn btn-circle btn-outline btn-primary"
          title="Next Day"
        >
          <ChevronRightIcon className="w-6 h-6" />
        </button>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <CalendarIcon className="w-8 h-8 text-primary" />
            Outlook Calendar
          </h1>
          <button
            className="btn btn-primary flex items-center gap-2"
            onClick={() => {
              setSelectedDateForMeeting(new Date());
              setSelectedTimeForMeeting('09:00');
              setIsTeamsMeetingModalOpen(true);
            }}
          >
            <VideoCameraIcon className="h-5 w-5" />
            Create Teams Meeting
          </button>
        </div>
        <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto">
          <div className="flex items-center gap-2">
            <FunnelIcon className="w-5 h-5 text-gray-500" />
            <input 
              type="date" 
              className="input input-bordered w-full md:w-auto"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <UserIcon className="w-5 h-5 text-gray-500" />
            <select 
              className="select select-bordered w-full md:w-auto"
              value={selectedMailbox}
              onChange={(e) => setSelectedMailbox(e.target.value)}
            >
              <option value="">All Calendars</option>
              {sharedMailboxes.map(mb => <option key={mb.email} value={mb.email}>{mb.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* View Toggle */}
      <div className="flex justify-end mb-4">
        <div className="btn-group">
          <button className={`btn btn-sm ${viewMode === 'list' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setViewMode('list')}>List View</button>
          <button className={`btn btn-sm ${viewMode === 'month' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setViewMode('month')}>Month View</button>
        </div>
      </div>

      {viewMode === 'month' ? (
        renderMonthGrid()
      ) : (
        <div className="bg-base-100 rounded-lg shadow-lg overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr className="bg-base-200">
                <th>Title</th>
                <th>Date & Time</th>
                <th>Group</th>
                <th>Description</th>
                <th>Status</th>
                <th>Location</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center p-8">Loading events...</td></tr>
              ) : filteredEvents.length > 0 ? (
                filteredEvents.map(renderEventRow)
              ) : (
                <tr><td colSpan={6} className="text-center p-8">No events found for the selected filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Total Amount */}
      <div className="mt-6 flex justify-end">
        <div className="card bg-primary text-primary-content p-4 shadow-lg">
          <div className="flex items-center gap-3">
            <CurrencyDollarIcon className="w-7 h-7" />
            <div>
              <div className="text-lg font-bold">Total Balance</div>
              <div className="text-2xl font-extrabold">${totalAmount.toLocaleString()}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Document Modal */}
      {isDocumentModalOpen && selectedEvent && (
        <div className="modal modal-open">
          <div className="modal-box max-w-2xl">
            <div className="flex justify-between items-start mb-4">
              <h3 className="font-bold text-lg">{selectedEvent.title}</h3>
              <button 
                className="btn btn-sm btn-circle btn-ghost"
                onClick={() => setIsDocumentModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span 
                  style={{ background: selectedEvent.color, width: 16, height: 16, borderRadius: 4, display: 'inline-block' }}
                />
                <span className="text-sm font-medium">{selectedEvent.group}</span>
              </div>
              <div className="flex items-center gap-2">
                <ClockIcon className="w-5 h-5 text-base-content/70" />
                <div>
                  <div className="font-medium">
                    {selectedEvent.allDay ? 'All Day' : 
                      `${selectedEvent.start.toLocaleDateString()} ${selectedEvent.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${selectedEvent.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    }
                  </div>
                  <div className="text-sm text-base-content/70">
                    {selectedEvent.mailbox}
                  </div>
                </div>
              </div>
              {selectedEvent.location && (
                <div className="flex items-center gap-2">
                  <span className="font-medium">Location:</span>
                  <span>{selectedEvent.location}</span>
                </div>
              )}
              {selectedEvent.attendees && selectedEvent.attendees.length > 0 && (
                <div>
                  <div className="font-medium mb-2">Attendees</div>
                  <div className="space-y-1">
                    {selectedEvent.attendees.map((attendee: any, index: number) => (
                      <div key={index} className="text-sm text-base-content/80">
                        {attendee.emailAddress?.name || attendee.emailAddress?.address}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {selectedEvent.description && (
                <div>
                  <div className="font-medium mb-2">Description</div>
                  <div className="text-sm text-base-content/80 prose prose-sm max-w-none">
                    {selectedEvent.description}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-action">
              <button className="btn" onClick={() => setIsDocumentModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Teams Meeting Modal */}
      <TeamsMeetingModal
        isOpen={isTeamsMeetingModalOpen}
        onClose={() => {
          setIsTeamsMeetingModalOpen(false);
          // Refresh Teams meetings data when modal closes
          fetchOutlookTeamsMeetings();
        }}
        selectedDate={selectedDateForMeeting || undefined}
        selectedTime={selectedTimeForMeeting}
      />
    </div>
  );
};

export default OutlookCalendarPage; 