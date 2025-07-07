import React, { useState, useEffect, useRef } from 'react';
import Meetings from './Meetings';
import AISuggestions from './AISuggestions';
import OverdueFollowups from './OverdueFollowups';
import { UserGroupIcon, CalendarIcon, ExclamationTriangleIcon, ChatBubbleLeftRightIcon, ArrowTrendingUpIcon, ChartBarIcon, ChevronLeftIcon, ChevronRightIcon, XMarkIcon, ClockIcon, SparklesIcon, MagnifyingGlassIcon, FunnelIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { PieChart as RechartsPieChart, Pie, Cell } from 'recharts';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot, ReferenceArea, BarChart, Bar, Legend as RechartsLegend, CartesianGrid } from 'recharts';
import { RadialBarChart, RadialBar, PolarAngleAxis, Legend } from 'recharts';
import { useMsal } from '@azure/msal-react';
import { DateTime } from 'luxon';

interface CalendarEvent {
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

function getDateString(year: number, month: number, day: number) {
  return [
    year,
    String(month + 1).padStart(2, '0'),
    String(day).padStart(2, '0')
  ].join('-');
}

const DEFAULT_MAILBOXES = [
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

const Dashboard: React.FC = () => {
  // State for summary numbers
  const [meetingsToday, setMeetingsToday] = useState(0);
  const [overdueFollowups, setOverdueFollowups] = useState(0);
  const [newMessages, setNewMessages] = useState(0);
  const [aiActions, setAIActions] = useState(0);
  const [latestMessages, setLatestMessages] = useState<any[]>([]);

  // State for expanded sections
  const [expanded, setExpanded] = useState<'meetings' | 'overdue' | 'ai' | 'messages' | null>(null);

  const aiSuggestionsRef = useRef<any>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [leads, setLeads] = useState<any[]>([]);
  const [meetings, setMeetings] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [isCalendarLoading, setIsCalendarLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Add state for selected event details modal
  const [selectedEventDetails, setSelectedEventDetails] = useState<CalendarEvent | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);

  // Add mock client messages
  const mockMessages = [
    {
      id: '10',
      client_name: 'David Lee',
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
      content: 'Hi, I have uploaded the required documents. Please confirm receipt.'
    },
    {
      id: '11',
      client_name: 'Emma Wilson',
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
      content: 'Can you update me on the status of my application?'
    },
    {
      id: '13',
      client_name: 'John Smith',
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
      content: 'Thank you for the meeting today. Looking forward to next steps.'
    },
    {
      id: '14',
      client_name: 'Sarah Parker',
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
      content: 'I have a question about the contract terms.'
    },
    {
      id: '15',
      client_name: 'Tom Anderson',
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
      content: 'Please let me know if you need any more information from my side.'
    }
  ];

  // Fetch summary data (mocked for now, replace with real queries)
  useEffect(() => {
    // Fetch meetings today
    (async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase.from('meetings').select('id').eq('meeting_date', today);
      setMeetingsToday(data?.length || 0);
    })();
    // Fetch overdue followups
    (async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase.from('leads').select('id').lte('next_followup', today).not('next_followup', 'is', null);
      setOverdueFollowups(data?.length || 0);
    })();
    // Fetch new messages (mock: last 5 from leads table with messages)
    (async () => {
      const { data } = await supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(5);
      if (data && data.length > 0) {
        setLatestMessages(data);
        setNewMessages(data.length);
      } else {
        setLatestMessages(mockMessages);
        setNewMessages(mockMessages.length);
      }
    })();
    // Fetch AI actions (mock: count from suggestions API or table)
    (async () => {
      // Replace with real AI suggestions count
      setAIActions(2);
    })();
  }, []);

  // Graph data (mocked)
  const meetingsPerMonth = [
    { month: 'June 2025', count: 64 },
    { month: 'July 2025', count: 74 },
    { month: 'August 2025', count: 41 },
  ];
  // Mock data for contracts signed by category
  const contractsByCategory = [
    { category: 'German Citizenship', count: 14, amount: 168000 },
    { category: 'Austrian Citizenship', count: 7, amount: 98000 },
    { category: 'Business Visa', count: 4, amount: 48000 },
    { category: 'Family Reunification', count: 3, amount: 36000 },
    { category: 'Other', count: 2, amount: 24000 },
  ];

  // Mock calendar events data
  const mockCalendarEvents = [
    { id: 1, title: 'Client Meeting - Mark Smith', date: '2024-01-15', type: 'meeting', color: '#3b28c7' },
    { id: 2, title: 'Outlook Event - Team Coral', date: '2024-01-15', type: 'outlook', color: '#6366f1' },
    { id: 3, title: 'Client Meeting - Ronaldo Garcia', date: '2024-01-16', type: 'meeting', color: '#3b28c7' },
    { id: 4, title: 'Outlook Event - Sales Review', date: '2024-01-17', type: 'outlook', color: '#6366f1' },
    { id: 5, title: 'Client Meeting - Franz Wilson', date: '2024-01-18', type: 'meeting', color: '#3b28c7' },
    { id: 6, title: 'Outlook Event - Weekly Planning', date: '2024-01-19', type: 'outlook', color: '#6366f1' },
    { id: 7, title: 'Client Meeting - Marina Johnson', date: '2024-01-20', type: 'meeting', color: '#3b28c7' },
  ];

  const { instance, accounts } = useMsal();
  const sharedMailboxes = DEFAULT_MAILBOXES;

  const fetchOutlookEvents = async (): Promise<CalendarEvent[]> => {
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
      let allEvents: CalendarEvent[] = [];
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
            const mailboxEvents: CalendarEvent[] = data.value.map((event: any) => ({
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

  // Calendar helper functions
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    return { daysInMonth, firstDayOfMonth };
  };

  const getEventsForDate = (date: string): CalendarEvent[] => {
    return calendarEvents.filter(event => event.date === date);
  };

  const formatDate = (date: Date) => {
    return date.toISOString().split('T')[0];
  };

  const goToPreviousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  // Handler to open AI Suggestions modal
  const handleAISuggestionsExpand = () => {
    setExpanded('ai');
    setTimeout(() => {
      aiSuggestionsRef.current?.openModal?.();
      aiSuggestionsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }, 100);
  };

  // Fetch calendar events when date changes
  useEffect(() => {
    fetchCalendarEvents();
  }, [currentDate, accounts, instance]);

  const handleDateClick = (date: string) => {
    setSelectedDate(date);
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setSelectedDate(null);
  };

  const getEventsForSelectedDate = () => {
    if (!selectedDate) return [];
    return calendarEvents.filter(event => event.date === selectedDate);
  };

  // Mock data for My Performance (last 30 days)
  const today = new Date();
  const daysArray = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (29 - i));
    return d;
  });
  const performanceData = daysArray.map((date, i) => ({
    date: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    count: Math.floor(Math.random() * 5) + (date.getDate() === today.getDate() ? 5 : 1), // More contracts today
    isToday: date.toDateString() === today.toDateString(),
    isThisMonth: date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear(),
  }));
  const contractsToday = performanceData.find(d => d.isToday)?.count || 0;
  const contractsThisMonth = performanceData.filter(d => d.isThisMonth).reduce((sum, d) => sum + d.count, 0);
  const contractsLast30 = performanceData.reduce((sum, d) => sum + d.count, 0);

  // Mock data for signed leads (last 30 days)
  const signedLeads = performanceData.map((d, i) => ({
    id: `L${10000 + i}`,
    clientName: [
      'David Lee', 'Emma Wilson', 'Noah Cohen', 'Olivia Levi', 'Liam Katz',
      'Maya Gold', 'Ethan Weiss', 'Sophie Adler', 'Daniel Stern', 'Ella Rubin',
      'Ava Berger', 'Ben Shalev', 'Mia Rosen', 'Leo Friedman', 'Zoe Klein',
      'Sara Weiss', 'Jonah Adler', 'Lily Stern', 'Max Rubin', 'Nina Berger',
      'Adam Shalev', 'Tamar Rosen', 'Oren Friedman', 'Shira Klein', 'Eli Weiss',
      'Noa Adler', 'Amit Stern', 'Lior Rubin', 'Dana Berger', 'Yarden Shalev'
    ][i % 30],
    date: d.date,
    amount: Math.floor(Math.random() * 8000) + 2000,
    category: ['German Citizenship', 'Austrian Citizenship', 'Business Visa', 'Family Reunification', 'Other'][i % 5],
    topic: [
      'Citizenship', 'Visa', 'Family Reunification', 'Business', 'Other'
    ][i % 5],
    expert: [
      'Dr. Cohen', 'Adv. Levi', 'Ms. Katz', 'Mr. Gold', 'Dr. Weiss'
    ][i % 5],
    leadNumber: `L${10000 + i}`,
  }));

  // Mock data for team average contracts signed per day (last 30 days)
  const teamAverageData = daysArray.map((date, i) => ({
    date: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    avg: 3 + Math.sin(i / 5) * 1.5 // some variation for demo
  }));

  // Remove dropdown state
  const [showLeadsList, setShowLeadsList] = React.useState(false);

  // Mock data for Score Board
  const scoreboardTabs = ["Today", "Last 30d", "Tables"];
  const scoreboardCategories = [
    "General",
    "Commercial & Civil",
    "Small cases",
    "USA - Immigration",
    "Immigration to Israel",
    "Austria and Germany",
    "Total"
  ];
  const scoreboardData = {
    Today: [
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 3, amount: 18396, expected: 20000 },
      { count: 3, amount: 18396, expected: 20000 },
    ],
    "Last 30d": [
      { count: 0, amount: 0, expected: 0 },
      { count: 7, amount: 113629, expected: 100000 },
      { count: 26, amount: 47920, expected: 70000 },
      { count: 11, amount: 109675, expected: 150000 },
      { count: 18, amount: 166332, expected: 250000 },
      { count: 71, amount: 1505920, expected: 1700000 },
      { count: 133, amount: 1943476, expected: 2350000 },
    ],
  };
  const scoreboardHighlights = {
    June: [
      null,
      null,
      { amount: 70000 },
      { amount: 150000 },
      { amount: 250000 },
      { amount: 80000 },
      { amount: 1700000 },
      { amount: 2350000 },
    ],
  };
  // Score Board state
  const [scoreTab, setScoreTab] = React.useState("Today");

  // Get the current month name
  const currentMonthName = new Date().toLocaleString('en-US', { month: 'long' });

  // Mock data for Score Board bar charts
  const scoreboardBarDataToday = [
    { category: 'General', signed: 0, due: 0 },
    { category: 'Commercial & Civil', signed: 20000, due: 15000 },
    { category: 'Small cases', signed: 5000, due: 7000 },
    { category: 'USA - Immigration', signed: 8000, due: 12000 },
    { category: 'Immigration to Israel', signed: 12000, due: 9000 },
    { category: 'Austria and Germany', signed: 50000, due: 35000 },
  ];
  const scoreboardBarDataJune = [
    { category: 'General', signed: 0, due: 0 },
    { category: 'Commercial & Civil', signed: 113629, due: 100000 },
    { category: 'Small cases', signed: 47920, due: 70000 },
    { category: 'USA - Immigration', signed: 109675, due: 150000 },
    { category: 'Immigration to Israel', signed: 166332, due: 250000 },
    { category: 'Poland', signed: 0, due: 80000 },
    { category: 'Austria and Germany', signed: 1505920, due: 1700000 },
  ];
  const scoreboardBarData30d = [
    { category: 'General', signed: 0, due: 0 },
    { category: 'Commercial & Civil', signed: 113629, due: 130000 },
    { category: 'Small cases', signed: 47920, due: 50000 },
    { category: 'USA - Immigration', signed: 109675, due: 80000 },
    { category: 'Immigration to Israel', signed: 166332, due: 90000 },
    { category: 'Poland', signed: 0, due: 0 },
    { category: 'Austria and Germany', signed: 1505920, due: 950000 },
  ];

  // Custom Tooltip for My Performance chart
  const PerformanceTooltip = ({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) => {
    if (!active || !payload || payload.length === 0) return null;
    // Find the team avg for this date
    const teamAvgObj = teamAverageData.find(d => d.date === label);
    const teamAvg = teamAvgObj ? Math.ceil(teamAvgObj.avg) : null;
    // Find my contracts for this date
    const myContractsObj = performanceData.find(d => d.date === label);
    const myContracts = myContractsObj ? myContractsObj.count : null;
    return (
      <div style={{ background: 'rgba(0,0,0,0.8)', borderRadius: 12, color: '#fff', padding: 12, minWidth: 120 }}>
        <div className="font-bold mb-1">{label}</div>
        {myContracts !== null && (
          <div>Contracts: {myContracts} contracts</div>
        )}
        {teamAvg !== null && (
          <div>Team Avg: {teamAvg} contracts</div>
        )}
      </div>
    );
  };

  // Refs and state for matching calendar height to AI Suggestions
  const aiRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [aiHeight, setAiHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    function updateHeight() {
      if (aiRef.current) {
        setAiHeight(aiRef.current.offsetHeight);
      }
    }
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  const [showAISuggestionsModal, setShowAISuggestionsModal] = useState(false);

  const [filterType, setFilterType] = useState<'all' | 'urgent' | 'important' | 'reminder'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Extended list for the modal view
  const allSuggestions = [
    {
      id: '1',
      type: 'urgent',
      message: 'Contract for David Lee (L122324) needs immediate review',
      action: 'Review Contract',
      dueDate: 'Today',
      context: 'Client meeting scheduled for tomorrow'
    },
    {
      id: '2',
      type: 'important',
      message: 'Follow up with Emma Wilson about the Service Agreement proposal',
      action: 'Send Follow-up',
      dueDate: 'Within 24 hours',
      context: 'Last contact was 5 days ago'
    },
    {
      id: '3',
      type: 'reminder',
      message: "Prepare documentation for John Smith's software implementation meeting",
      action: 'Prepare Docs',
      dueDate: 'Before 10:00 AM',
      context: 'Meeting scheduled for today'
    },
    {
      id: '4',
      type: 'important',
      message: 'Update client profile with new information from recent meeting',
      action: 'Update Profile',
      dueDate: 'Today',
      context: 'Meeting notes available'
    },
    {
      id: '5',
      type: 'urgent',
      message: 'Critical deadline approaching for Sarah Parker case review',
      action: 'Review Case',
      dueDate: 'Tomorrow',
      context: 'Documents submitted last week pending review'
    },
    {
      id: '6',
      type: 'important',
      message: 'Schedule quarterly review meeting with Tom Anderson',
      action: 'Schedule Meeting',
      dueDate: 'This week',
      context: 'Last review was 3 months ago'
    },
    {
      id: '7',
      type: 'reminder',
      message: 'Update team availability calendar for next month',
      action: 'Update Calendar',
      dueDate: 'By Friday',
      context: 'Required for resource planning'
    },
    {
      id: '8',
      type: 'urgent',
      message: 'Respond to urgent inquiry from Rachel Green regarding contract terms',
      action: 'Respond',
      dueDate: 'Today',
      context: 'Client awaiting response for 24 hours'
    },
    {
      id: '9',
      type: 'important',
      message: 'Review and approve new marketing materials for upcoming campaign',
      action: 'Review Materials',
      dueDate: 'Next 48 hours',
      context: 'Campaign launch scheduled next week'
    },
    {
      id: '10',
      type: 'reminder',
      message: 'Complete monthly performance reports for team members',
      action: 'Complete Reports',
      dueDate: 'End of month',
      context: 'Required for performance reviews'
    }
  ];

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'urgent':
        return <ExclamationTriangleIcon className="w-5 h-5 text-red-500" />;
      case 'important':
        return <ExclamationTriangleIcon className="w-5 h-5 text-yellow-500" />;
      case 'reminder':
        return <ClockIcon className="w-5 h-5 text-blue-500" />;
      default:
        return null;
    }
  };

  const filteredSuggestions = allSuggestions.filter(suggestion => {
    const matchesType = filterType === 'all' || suggestion.type === filterType;
    const matchesSearch = suggestion.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         suggestion.context?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesType && matchesSearch;
  });

  const SuggestionCard = ({ suggestion }: { suggestion: any }) => (
    <div className="card bg-white hover:bg-gray-50 transition-colors border border-gray-200">
      <div className="card-body p-4">
        <div className="flex items-start gap-3">
          {getTypeIcon(suggestion.type)}
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <span className="badge badge-sm bg-gray-100 text-gray-800 font-semibold border-none">
                {suggestion.type.charAt(0).toUpperCase() + suggestion.type.slice(1)}
              </span>
              {suggestion.dueDate && (
                <span className="text-sm text-gray-600">
                  Due: {suggestion.dueDate}
                </span>
              )}
            </div>
            <p className="mt-2 text-sm text-gray-900 font-semibold">{suggestion.message}</p>
            {suggestion.context && (
              <p className="mt-1 text-sm text-gray-700">
                {suggestion.context}
              </p>
            )}
            <button className="btn btn-primary btn-sm mt-3 gap-2">
              {suggestion.action}
              <ArrowTrendingUpIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="p-4 md:p-6 space-y-8">
      {/* Top Summary Boxes */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8 w-full">
        {/* Meetings Today */}
        <div
          className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white relative overflow-hidden"
          onClick={() => setExpanded(expanded === 'meetings' ? null : 'meetings')}
        >
          <div className="flex items-center gap-4 p-6">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/20 shadow">
              <CalendarIcon className="w-7 h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-4xl font-extrabold text-white leading-tight">{meetingsToday}</div>
              <div className="text-white/80 text-sm font-medium mt-1">Meetings Today</div>
            </div>
          </div>
          {/* SVG Graph Placeholder */}
          <svg className="absolute bottom-4 right-4 w-16 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><path d="M2 28 Q16 8 32 20 T62 8" /></svg>
        </div>

        {/* Overdue Follow-ups */}
        <div
          className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-purple-600 via-blue-600 to-blue-500 text-white relative overflow-hidden"
          onClick={() => setExpanded(expanded === 'overdue' ? null : 'overdue')}
        >
          <div className="flex items-center gap-4 p-6">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/20 shadow">
              <ExclamationTriangleIcon className="w-7 h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-4xl font-extrabold text-white leading-tight">{overdueFollowups}</div>
              <div className="text-white/80 text-sm font-medium mt-1">Overdue Follow-ups</div>
            </div>
          </div>
          {/* SVG Bar Chart Placeholder */}
          <svg className="absolute bottom-4 right-4 w-12 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 48 32"><rect x="2" y="20" width="4" height="10"/><rect x="10" y="10" width="4" height="20"/><rect x="18" y="16" width="4" height="14"/><rect x="26" y="6" width="4" height="24"/><rect x="34" y="14" width="4" height="16"/></svg>
        </div>

        {/* New Messages */}
        <div
          className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white relative overflow-hidden"
          onClick={() => setExpanded(expanded === 'messages' ? null : 'messages')}
        >
          <div className="flex items-center gap-4 p-6">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/20 shadow">
              <ChatBubbleLeftRightIcon className="w-7 h-7 mr-1 text-white" />
            </div>
            <div>
              <div className="text-4xl font-extrabold text-white leading-tight">{latestMessages.length}</div>
              <div className="text-white/80 text-sm font-medium mt-1">New Messages</div>
            </div>
          </div>
          {/* SVG Circle Placeholder */}
          <svg className="absolute bottom-4 right-4 w-10 h-10 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" /><text x="16" y="21" textAnchor="middle" fontSize="10" fill="white" opacity="0.7">99+</text></svg>
        </div>

        {/* Action Required */}
        <div
          className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-teal-400 via-green-400 to-green-600 text-white relative overflow-hidden"
        >
          <div className="flex items-center gap-4 p-6">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/20 shadow">
              <ArrowTrendingUpIcon className="w-7 h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-4xl font-extrabold text-white leading-tight">3</div>
              <div className="text-white/80 text-sm font-medium mt-1">Action Required</div>
            </div>
          </div>
          {/* SVG Line Chart Placeholder */}
          <svg className="absolute bottom-4 right-4 w-16 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><polyline points="2,28 16,20 32,24 48,10 62,18" /></svg>
        </div>
      </div>

      {/* Expanded Content for Top Boxes - now directly under the grid */}
      {expanded === 'meetings' && (
        <div className="glass-card mt-4 animate-fade-in">
          <Meetings />
        </div>
      )}
      {expanded === 'overdue' && (
        <div className="glass-card mt-4 animate-fade-in">
          <OverdueFollowups />
        </div>
      )}
      {expanded === 'messages' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
          {/* Client Emails Card */}
          <div className="card shadow-xl rounded-2xl relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #edeafd 0%, #c7bfff 100%)', color: '#222' }}>
            <div className="card-body p-6">
              <div className="flex items-center gap-2 px-2 py-2 rounded-lg mb-4" style={{ background: '#e3dbfa' }}>
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full" style={{ background: '#4638e2' }}>
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8" /><rect x="3" y="6" width="18" height="12" rx="2" /></svg>
                </span>
                <span className="text-xl font-bold" style={{ color: '#4638e2' }}>Client Emails</span>
              </div>
              {/* Email Messages List */}
              <div className="space-y-4">
                {/* Example Email Message */}
                <div className="rounded-xl p-4 mb-2" style={{ background: '#f7f7fa', color: '#222', boxShadow: '0 1px 4px 0 rgba(0,0,0,0.03)' }}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-lg" style={{ color: '#222' }}>John Smith</span>
                    <span className="text-sm" style={{ color: '#666' }}>2 hours ago</span>
                  </div>
                  <div className="font-semibold mb-1" style={{ color: '#333' }}>Contract Review Request</div>
                  <div className="text-sm mb-2" style={{ color: '#444' }}>Hi, I would like to discuss the contract terms we discussed last week...</div>
                </div>
                <div className="rounded-xl p-4 mb-2" style={{ background: '#f7f7fa', color: '#222', boxShadow: '0 1px 4px 0 rgba(0,0,0,0.03)' }}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-lg" style={{ color: '#222' }}>Maria Garcia</span>
                    <span className="text-sm" style={{ color: '#666' }}>4 hours ago</span>
                  </div>
                  <div className="font-semibold mb-1" style={{ color: '#333' }}>Meeting Confirmation</div>
                  <div className="text-sm mb-2" style={{ color: '#444' }}>Thank you for the meeting yesterday. I have some questions about...</div>
                </div>
                <div className="rounded-xl p-4 mb-2" style={{ background: '#f7f7fa', color: '#222', boxShadow: '0 1px 4px 0 rgba(0,0,0,0.03)' }}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-lg" style={{ color: '#222' }}>David Wilson</span>
                    <span className="text-sm" style={{ color: '#666' }}>1 day ago</span>
                  </div>
                  <div className="font-semibold mb-1" style={{ color: '#333' }}>Document Submission</div>
                  <div className="text-sm mb-2" style={{ color: '#444' }}>I have attached the requested documents for my application...</div>
                </div>
              </div>
              {/* SVG Decoration */}
              <svg className="absolute bottom-4 right-4 w-16 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><rect x="2" y="20" width="4" height="10"/><rect x="10" y="10" width="4" height="20"/><rect x="18" y="16" width="4" height="14"/><rect x="26" y="6" width="4" height="24"/><rect x="34" y="14" width="4" height="16"/></svg>
            </div>
          </div>
          {/* WhatsApp Messages Card */}
          <div className="card shadow-xl rounded-2xl relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #e6f7f5 0%, #b2f1e1 100%)', color: '#222' }}>
            <div className="card-body p-6">
              <div className="flex items-center gap-2 px-2 py-2 rounded-lg mb-4" style={{ background: '#d2f5e8' }}>
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full" style={{ background: '#25d366' }}>
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 32 32"><path d="M16 3C9.373 3 4 8.373 4 15c0 2.64.86 5.09 2.36 7.13L4 29l7.14-2.33C13.09 27.14 14.52 27.5 16 27.5c6.627 0 12-5.373 12-12S22.627 3 16 3zm0 22c-1.33 0-2.63-.26-3.85-.77l-.27-.12-4.24 1.39 1.39-4.13-.18-.28C6.91 18.13 6 16.61 6 15c0-5.52 4.48-10 10-10s10 4.48 10 10-4.48 10-10 10zm5.07-7.75c-.28-.14-1.65-.81-1.9-.9-.25-.09-.43-.14-.61.14-.18.28-.7.9-.86 1.08-.16.18-.32.2-.6.07-.28-.14-1.18-.44-2.25-1.41-.83-.74-1.39-1.65-1.55-1.93-.16-.28-.02-.43.12-.57.13-.13.28-.34.42-.51.14-.17.18-.29.28-.48.09-.19.05-.36-.02-.5-.07-.14-.61-1.47-.84-2.01-.22-.53-.45-.46-.61-.47-.16-.01-.35-.01-.54-.01-.19 0-.5.07-.76.34-.26.27-1 1-.97 2.43.03 1.43 1.03 2.81 1.18 3.01.15.2 2.03 3.1 5.01 4.22.7.24 1.25.38 1.68.49.71.18 1.36.15 1.87.09.57-.07 1.65-.67 1.89-1.32.23-.65.23-1.2.16-1.32-.07-.12-.25-.19-.53-.33z"/></svg>
                </span>
                <span className="text-xl font-bold" style={{ color: '#25d366' }}>WhatsApp Messages</span>
              </div>
              {/* WhatsApp Messages List */}
              <div className="space-y-4">
                <div className="rounded-xl p-4 mb-2" style={{ background: '#f7f7fa', color: '#222', boxShadow: '0 1px 4px 0 rgba(0,0,0,0.03)' }}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-lg" style={{ color: '#222' }}>Sarah Johnson</span>
                    <span className="text-sm" style={{ color: '#666' }}>30 min ago</span>
                  </div>
                  <div className="text-sm mb-2" style={{ color: '#444' }}>Hi! I have a quick question about my application status</div>
                </div>
                <div className="rounded-xl p-4 mb-2" style={{ background: '#f7f7fa', color: '#222', boxShadow: '0 1px 4px 0 rgba(0,0,0,0.03)' }}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-lg" style={{ color: '#222' }}>Michael Brown</span>
                    <span className="text-sm" style={{ color: '#666' }}>1 hour ago</span>
                  </div>
                  <div className="text-sm mb-2" style={{ color: '#444' }}>Thanks for the update. When can we schedule the next meeting?</div>
                </div>
                <div className="rounded-xl p-4 mb-2" style={{ background: '#f7f7fa', color: '#222', boxShadow: '0 1px 4px 0 rgba(0,0,0,0.03)' }}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-lg" style={{ color: '#222' }}>Emma Wilson</span>
                    <span className="text-sm" style={{ color: '#666' }}>3 hours ago</span>
                  </div>
                  <div className="text-sm mb-2" style={{ color: '#444' }}>I sent the documents you requested. Please let me know if you need anything else</div>
                </div>
                <div className="rounded-xl p-4 mb-2" style={{ background: '#f7f7fa', color: '#222', boxShadow: '0 1px 4px 0 rgba(0,0,0,0.03)' }}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-lg" style={{ color: '#222' }}>Alex Thompson</span>
                    <span className="text-sm" style={{ color: '#666' }}>5 hours ago</span>
                  </div>
                  <div className="text-sm mb-2" style={{ color: '#444' }}>Perfect! Looking forward to our meeting tomorrow</div>
                </div>
              </div>
              {/* SVG Decoration */}
              <svg className="absolute bottom-4 right-4 w-16 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><circle cx="32" cy="16" r="14" /></svg>
            </div>
          </div>
        </div>
      )}

      {/* AI Suggestions and Calendar Row - use same grid as summary boxes for perfect alignment */}
      <div className="flex flex-row mb-10 w-full justify-between" style={{ alignItems: 'flex-start' }}>
        <div ref={aiRef} className="min-h-[240px] bg-white border border-gray-200 rounded-2xl p-4 shadow-lg flex flex-col justify-between flex-1 mr-10" style={{ maxWidth: 'calc(100% - 440px)' }}>
          {/* AI Suggestions Box with title and View All */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <SparklesIcon className="w-6 h-6" style={{ color: '#3b28c7' }} />
              <div className="text-2xl font-bold">RMQ AI NOTICE</div>
            </div>
            <button className="btn btn-sm btn-outline" style={{ borderColor: '#3b28c7', color: '#3b28c7' }} onClick={() => setShowAISuggestionsModal(true)}>View All</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Suggestion 1 */}
            <div className="bg-gray-50 rounded-xl p-6 border border-gray-100">
              <div className="flex items-center gap-2 text-sm font-semibold text-red-500 mb-1">
                <ExclamationTriangleIcon className="w-4 h-4" />
                Urgent
              </div>
              <div className="font-bold text-lg mb-1">Contract for David Lee (L122324) needs immediate review</div>
              <div className="text-base text-gray-700 mb-2">Client meeting scheduled for tomorrow</div>
              <button className="btn btn-primary">Review Contract →</button>
            </div>
            {/* Suggestion 2 */}
            <div className="bg-gray-50 rounded-xl p-6 border border-gray-100">
              <div className="flex items-center gap-2 text-sm font-semibold text-yellow-600 mb-1">
                <ExclamationTriangleIcon className="w-4 h-4" />
                Important
              </div>
              <div className="font-bold text-lg mb-1">Follow up with Emma Wilson about the Service Agreement proposal</div>
              <div className="text-base text-gray-700 mb-2">Last contact was 5 days ago</div>
              <button className="btn btn-primary">Send Follow-up →</button>
            </div>
            {/* Suggestion 3 */}
            <div className="bg-gray-50 rounded-xl p-6 border border-gray-100">
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-600 mb-1">
                <ClockIcon className="w-4 h-4" />
                Info
              </div>
              <div className="font-bold text-lg mb-1">Schedule onboarding call with Michael Brown</div>
              <div className="text-base text-gray-700 mb-2">No onboarding call scheduled yet</div>
              <button className="btn btn-primary">Schedule Call →</button>
            </div>
            {/* Suggestion 4 */}
            <div className="bg-gray-50 rounded-xl p-6 border border-gray-100">
              <div className="flex items-center gap-2 text-sm font-semibold text-green-600 mb-1">
                <ClockIcon className="w-4 h-4" />
                Reminder
              </div>
              <div className="font-bold text-lg mb-1">Send contract to Sarah Parker for signature</div>
              <div className="text-base text-gray-700 mb-2">Draft contract is ready for review</div>
              <button className="btn btn-primary">Send Contract →</button>
            </div>
          </div>
        </div>
        {/* Calendar Box - fully featured */}
        <div ref={calendarRef} className="w-[400px] max-w-md bg-white border border-gray-200 rounded-2xl p-4 shadow-lg flex flex-col justify-between" style={aiHeight ? { minHeight: aiHeight } : { minHeight: 240 }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg" style={{ background: '#edeafd', border: '1px solid #4638e2' }}>
                <CalendarIcon className="w-5 h-5" style={{ color: '#4638e2' }} />
              </div>
              <span className="text-lg font-bold" style={{ color: '#4638e2' }}>Calendar</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={goToPreviousMonth} className="btn btn-ghost btn-xs" style={{ color: '#4638e2' }}>
                <ChevronLeftIcon className="w-3 h-3" />
              </button>
              <button onClick={goToToday} className="btn btn-xs text-xs" style={{ color: '#fff', background: '#4638e2' }}>
                Today
              </button>
              <button onClick={goToNextMonth} className="btn btn-ghost btn-xs" style={{ color: '#4638e2' }}>
                <ChevronRightIcon className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="text-center mb-4">
            <span className="text-base font-semibold" style={{ color: '#4638e2' }}>
              {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </span>
          </div>
          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1 mb-4">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(day => (
              <div key={day} className="text-center text-sm font-semibold p-1" style={{ color: '#4638e2', opacity: 0.8 }}>
                {day}
              </div>
            ))}
            {(() => {
              const { daysInMonth, firstDayOfMonth } = getDaysInMonth(currentDate);
              const days = [];
              for (let i = 0; i < firstDayOfMonth; i++) {
                days.push(<div key={`empty-${i}`} className="h-10"></div>);
              }
              for (let day = 1; day <= daysInMonth; day++) {
                const dateStr = getDateString(currentDate.getFullYear(), currentDate.getMonth(), day);
                const events = getEventsForDate(dateStr);
                const isToday = dateStr === getDateString(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
                days.push(
                  <div
                    key={day}
                    className={`h-10 border p-1 text-sm relative cursor-pointer rounded-lg transition-colors duration-150 ${isToday ? 'bg-[#edeafd] text-[#4638e2] font-bold' : 'hover:bg-[#edeafd] text-black'}`}
                    style={{ borderColor: '#4638e2' }}
                    onClick={() => handleDateClick(dateStr)}
                  >
                    <div className="text-right leading-none">{day}</div>
                    <div className="flex flex-col gap-0.5 mt-0.5">
                      {events.slice(0, 1).map(event => (
                        <div key={event.id} className="flex items-center gap-1">
                          <div
                            className="w-2 h-2 rounded-full mx-auto"
                            style={{ backgroundColor: event.type === 'meeting' ? '#4638e2' : '#b3aaf7' }}
                            title={event.type === 'meeting' ? (event.clientName || '') : event.title}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }
              return days;
            })()}
          </div>
          {/* Legend */}
          <div className="flex items-center justify-center gap-4 text-sm mt-2">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ background: '#4638e2' }}></div>
              <span style={{ color: '#4638e2', fontWeight: 600 }}>Meetings</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ background: '#b3aaf7' }}></div>
              <span style={{ color: '#4638e2', fontWeight: 600 }}>Outlook</span>
            </div>
          </div>
        </div>
      </div>

      {/* Top Workers Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 w-full mb-12">
        {/* Top Closers */}
        <div className="rounded-2xl p-8 flex flex-col items-center shadow-lg border border-white/20 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2">
            <UserGroupIcon className="w-6 h-6 text-white opacity-90" />
            <span className="text-base font-bold text-white drop-shadow">Top Closers</span>
          </div>
          <div className="w-full flex flex-col gap-2 mt-1">
            {[
              { name: 'MiriamL', count: 12, movement: 'up' },
              { name: 'YehonatanD', count: 9, movement: 'down' },
              { name: 'Isaac', count: 7, movement: 'none' },
            ].map((user, idx) => (
              <div key={user.name} className="flex items-center gap-2 w-full">
                <div className="flex items-center gap-1">
                  {user.movement === 'up' && (
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M10 16V4m0 0l-5 5m5-5l5 5" /></svg>
                  )}
                  {user.movement === 'down' && (
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M10 4v12m0 0l-5-5m5 5l5-5" /></svg>
                  )}
                  {user.movement === 'none' && (
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M6 10h8" /></svg>
                  )}
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-base shadow-lg bg-white/20 text-white`}>{user.name[0]}</div>
                </div>
                <div className="flex-1">
                  <span className="font-semibold text-white text-xl">{user.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-3xl font-bold text-white">{user.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Top Schedulers */}
        <div className="rounded-2xl p-8 flex flex-col items-center shadow-lg border border-white/20 bg-gradient-to-tr from-purple-600 via-blue-600 to-blue-500 text-white min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2">
            <CalendarIcon className="w-6 h-6 text-white opacity-90" />
            <span className="text-base font-bold text-white drop-shadow">Top Schedulers</span>
          </div>
          <div className="w-full flex flex-col gap-2 mt-1">
            {[
              { name: 'Anna Zh', count: 15, movement: 'up' },
              { name: 'MichaelW', count: 11, movement: 'down' },
              { name: 'Isaac', count: 8, movement: 'none' },
            ].map((user, idx) => (
              <div key={user.name} className="flex items-center gap-2 w-full">
                <div className="flex items-center gap-1">
                  {user.movement === 'up' && (
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M10 16V4m0 0l-5 5m5-5l5 5" /></svg>
                  )}
                  {user.movement === 'down' && (
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M10 4v12m0 0l-5-5m5 5l5-5" /></svg>
                  )}
                  {user.movement === 'none' && (
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M6 10h8" /></svg>
                  )}
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-base shadow-lg bg-white/20 text-white`}>{user.name[0]}</div>
                </div>
                <div className="flex-1">
                  <span className="font-semibold text-white text-xl">{user.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-3xl font-bold text-white">{user.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Top Experts */}
        <div className="rounded-2xl p-8 flex flex-col items-center shadow-lg border border-white/20 bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-6 h-6 text-white opacity-90" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 14l9-5-9-5-9 5 9 5z" /><path d="M12 14l6.16-3.422A12.083 12.083 0 0112 21.5a12.083 12.083 0 01-6.16-10.922L12 14z" /></svg>
            <span className="text-base font-bold text-white drop-shadow">Top Experts</span>
          </div>
          <div className="w-full flex flex-col gap-2 mt-1">
            {[
              { name: 'Kyrill', count: 10, movement: 'down' },
              { name: 'Ido', count: 8, movement: 'up' },
              { name: 'YaelG', count: 6, movement: 'none' },
            ].map((user, idx) => (
              <div key={user.name} className="flex items-center gap-2 w-full">
                <div className="flex items-center gap-1">
                  {user.movement === 'up' && (
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M10 16V4m0 0l-5 5m5-5l5 5" /></svg>
                  )}
                  {user.movement === 'down' && (
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M10 4v12m0 0l-5-5m5 5l5-5" /></svg>
                  )}
                  {user.movement === 'none' && (
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M6 10h8" /></svg>
                  )}
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-base shadow-lg bg-white/20 text-white`}>{user.name[0]}</div>
                </div>
                <div className="flex-1">
                  <span className="font-semibold text-white text-xl">{user.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-3xl font-bold text-white">{user.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Top Handler */}
        <div className="rounded-2xl p-8 flex flex-col items-center shadow-lg border border-white/20 bg-gradient-to-tr from-teal-400 via-green-400 to-green-600 text-white min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2">
            <UserGroupIcon className="w-6 h-6 text-white opacity-90" />
            <span className="text-base font-bold text-white drop-shadow">Top Handlers</span>
          </div>
          <div className="w-full flex flex-col gap-2 mt-1">
            {[
              { name: 'Caroline', count: 7, movement: 'up' },
              { name: 'Lena', count: 6, movement: 'down' },
              { name: 'Lior', count: 5, movement: 'none' },
            ].map((user, idx) => (
              <div key={user.name} className="flex items-center gap-2 w-full">
                <div className="flex items-center gap-1">
                  {user.movement === 'up' && (
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M10 16V4m0 0l-5 5m5-5l5 5" /></svg>
                  )}
                  {user.movement === 'down' && (
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M10 4v12m0 0l-5-5m5 5l5-5" /></svg>
                  )}
                  {user.movement === 'none' && (
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M6 10h8" /></svg>
                  )}
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-base shadow-lg bg-white/20 text-white`}>{user.name[0]}</div>
                </div>
                <div className="flex-1">
                  <span className="font-semibold text-white text-xl">{user.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-3xl font-bold text-white">{user.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* My Performance Graph (Full Width) */}
      <div className="w-full mt-12">
        <div className="rounded-3xl p-0.5 bg-gradient-to-tr from-indigo-500 via-purple-500 to-cyan-400">
          <div className="card shadow-xl rounded-3xl w-full max-w-full relative overflow-hidden bg-white">
            <div className="card-body p-8">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-6 gap-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex items-center justify-center w-12 h-12 rounded-full shadow bg-white">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                      <defs>
                        <linearGradient id="perfIconGradient" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                          <stop stopColor="#a21caf" />
                          <stop offset="1" stopColor="#06b6d4" />
                        </linearGradient>
                      </defs>
                      <path d="M3 17V21M7 13V21M11 9V21M15 5V21M19 3V21" stroke="url(#perfIconGradient)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <span className="text-2xl font-bold text-gray-900">My Performance</span>
                </div>
                <div className="flex gap-6 text-sm md:text-base items-center">
                  <div className="flex flex-col items-center">
                    <span className="font-bold text-gray-900 text-xl">{contractsLast30}</span>
                    <span className="text-gray-500">Last 30 Days</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="font-bold text-gray-900 text-xl">{contractsToday}</span>
                    <span className="text-gray-500">Today</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="font-bold text-gray-900 text-xl">{contractsThisMonth}</span>
                    <span className="text-gray-500">This Month</span>
                  </div>
                  {/* View Leads Button */}
                  <button
                    className="btn btn-sm btn-outline border-gray-300 text-gray-700 hover:bg-gray-100 ml-2"
                    onClick={() => setShowLeadsList((v) => !v)}
                  >
                    {showLeadsList ? 'Hide Leads' : 'View Leads'}
                  </button>
                </div>
              </div>
              <div className="w-full h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={performanceData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#222' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#222' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} width={30} />
                    <Tooltip content={<PerformanceTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="count"
                      stroke="#3b28c7"
                      strokeWidth={3}
                      dot={{ r: 5, stroke: '#3b28c7', strokeWidth: 2, fill: '#fff' }}
                      activeDot={{ r: 8, fill: '#3b28c7', stroke: '#000', strokeWidth: 3 }}
                      name="My Contracts"
                    />
                    <Line
                      type="monotone"
                      data={teamAverageData}
                      dataKey="avg"
                      stroke="#06b6d4"
                      strokeWidth={3}
                      dot={false}
                      name="Team Avg"
                      strokeDasharray="6 6"
                    />
                    {/* Highlight today */}
                    {performanceData.map((d, i) => d.isToday && (
                      <ReferenceDot key={i} x={d.date} y={d.count} r={10} fill="#3b28c7" stroke="#000" strokeWidth={3} />
                    ))}
                    {/* Highlight this month */}
                    {(() => {
                      const first = performanceData.findIndex(d => d.isThisMonth);
                      const last = performanceData.map(d => d.isThisMonth).lastIndexOf(true);
                      if (first !== -1 && last !== -1 && last > first) {
                        return (
                          <ReferenceArea x1={performanceData[first].date} x2={performanceData[last].date} fill="#3b28c7" fillOpacity={0.07} />
                        );
                      }
                      return null;
                    })()}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {/* Legend for My Contracts and Team Avg */}
              <div className="flex gap-6 mt-4 items-center">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-6 h-2 rounded-full" style={{background:'#3b28c7'}}></span>
                  <span className="text-base font-semibold text-gray-900">My Contracts</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-block w-6 h-2 rounded-full" style={{background:'#06b6d4'}}></span>
                  <span className="text-base font-semibold text-gray-900">Team Avg</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Signed Leads List Below Performance Box */}
      {showLeadsList && (
        <div className="glass-card mt-6 p-6 shadow-lg rounded-2xl w-full max-w-full animate-fade-in">
          <div className="font-bold text-lg mb-4 text-base-content/80">Signed Leads (Last 30 Days)</div>
          <div className="overflow-x-auto">
            <table className="table w-full text-lg">
              <thead>
                <tr>
                  <th className="font-bold text-xl px-0 py-3">Lead</th>
                  <th className="font-bold text-xl px-0 py-3">Topic</th>
                  <th className="font-bold text-xl px-0 py-3">Expert</th>
                  <th className="font-bold text-xl px-0 py-3">Amount</th>
                  <th className="font-bold text-xl px-0 py-3">Signed Date</th>
                </tr>
              </thead>
              <tbody>
                {signedLeads.slice().reverse().map((lead, idx) => (
                  <tr
                    key={lead.id}
                    className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} transition-all duration-150 hover:bg-gray-200`}
                  >
                    <td className="px-0 py-3 text-primary whitespace-nowrap">
                      <span className="font-bold">{lead.leadNumber}</span>
                      <span className="text-black font-normal ml-2">- {lead.clientName}</span>
                    </td>
                    <td className="px-0 py-3"><span className="badge badge-outline">{lead.topic}</span></td>
                    <td className="px-0 py-3 text-base-content/80 whitespace-nowrap">{lead.expert}</td>
                    <td className="px-0 py-3 text-success font-bold whitespace-nowrap">₪{lead.amount.toLocaleString()}</td>
                    <td className="px-0 py-3 text-base-content/80 whitespace-nowrap">{lead.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Score Board Section */}
      <div className="w-full mt-12">
        <div className="rounded-3xl p-0.5 bg-gradient-to-tr from-indigo-500 via-purple-500 to-cyan-400">
          <div className="card shadow-xl rounded-3xl w-full max-w-full relative overflow-hidden bg-white">
            <div className="card-body p-8">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-6 gap-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-tr from-purple-500 via-indigo-500 to-purple-700 shadow">
                    <ChartBarIcon className="w-7 h-7 text-white" />
                  </div>
                  <span className="text-2xl font-extrabold bg-gradient-to-tr from-purple-600 via-indigo-500 to-purple-700 text-transparent bg-clip-text drop-shadow">Score Board</span>
                </div>
                <div className="tabs tabs-boxed bg-white/20 rounded-xl p-1">
                  {scoreboardTabs.map(tab => (
                    <a
                      key={tab}
                      className={`tab text-lg font-semibold px-6 py-2 rounded-lg transition-all ${scoreTab === tab ? 'tab-active bg-white text-purple-600 shadow' : 'text-white/80 hover:bg-white/20'}`}
                      onClick={() => setScoreTab(tab)}
                    >
                      {tab}
                    </a>
                  ))}
                </div>
              </div>
              {/* Table for Tables tab only */}
              {scoreTab === 'Tables' && (
                <div className="overflow-x-auto">
                  <table className="table w-full rounded-xl bg-white/10">
                    <thead>
                      <tr>
                        <th className="text-lg font-bold text-gray-900 px-4 py-3 whitespace-nowrap bg-white border-b-2 border-purple-200"></th>
                        {scoreboardCategories.map(cat => (
                          <th key={cat} className="text-lg font-bold text-gray-900 px-4 py-3 whitespace-nowrap bg-white border-b-2 border-purple-200">{cat}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {/* Today row */}
                      <tr className="hover:bg-white/10 transition-all">
                        <td className="px-4 py-3 text-left font-bold text-lg text-gray-900">Today</td>
                        {scoreboardData["Today"].map((cell, i) => (
                          <td key={i} className="px-4 py-3 text-center align-top">
                            <div className="inline-flex flex-col items-start w-full gap-1">
                              <div className="flex flex-col items-center justify-center bg-purple-50 rounded-xl shadow-sm px-4 py-3 w-full hover:bg-purple-100/40 transition-all">
                                <div className="flex items-center gap-1 mb-1">
                                  <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>
                                  <span className="font-bold text-xl text-purple-900">{cell.count}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className={`text-base font-semibold ${cell.amount < cell.expected ? 'text-red-500' : cell.amount >= cell.expected && cell.expected > 0 ? 'text-green-600' : 'text-gray-900'}`}>₪{cell.amount ? cell.amount.toLocaleString() : '0'}</span>
                                </div>
                              </div>
                              {cell.expected > 0 && (
                                <div className="text-xs text-gray-500 mt-1 text-right w-full">
                                  <span className="opacity-70">Expected:</span> <span className="font-semibold">{cell.expected.toLocaleString()}</span>
                                </div>
                              )}
                            </div>
                          </td>
                        ))}
                      </tr>
                      {/* Last 30d row */}
                      <tr className="hover:bg-white/10 transition-all">
                        <td className="px-4 py-3 text-left font-bold text-lg text-gray-900">Last 30 days</td>
                        {scoreboardData["Last 30d"].map((cell, i) => (
                          <td key={i} className="px-4 py-3 text-center align-top">
                            <div className="inline-flex flex-col items-start w-full gap-1">
                              <div className="flex flex-col items-center justify-center bg-purple-50 rounded-xl shadow-sm px-4 py-3 w-full hover:bg-purple-100/40 transition-all">
                                <div className="flex items-center gap-1 mb-1">
                                  <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>
                                  <span className="font-bold text-xl text-purple-900">{cell.count}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className={`text-base font-semibold ${cell.amount < cell.expected ? 'text-red-500' : cell.amount >= cell.expected && cell.expected > 0 ? 'text-green-600' : 'text-gray-900'}`}>₪{cell.amount ? cell.amount.toLocaleString() : '0'}</span>
                                </div>
                              </div>
                              {cell.expected > 0 && (
                                <div className="text-xs text-gray-500 mt-1 text-right w-full">
                                  <span className="opacity-70">Expected:</span> <span className="font-semibold">{cell.expected.toLocaleString()}</span>
                                </div>
                              )}
                            </div>
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              {/* Bar chart for Today, June, and Last 30d tabs */}
              {(scoreTab === 'Today' || scoreTab === currentMonthName || scoreTab === 'Last 30d') && (
                <div className="w-full h-[420px] flex flex-col items-center justify-center">
                  {(() => {
                    const chartData = scoreTab === 'Today' ? scoreboardBarDataToday : scoreTab === 'June' || scoreTab === currentMonthName ? scoreboardBarDataJune : scoreboardBarData30d;
                    console.log('Score Board chart data for tab:', scoreTab, chartData);
                    return (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={chartData}
                          barCategoryGap={32}
                          margin={{ top: 32, right: 32, left: 16, bottom: 32 }}
                        >
                          <XAxis dataKey="category" tick={{ fontSize: 16, fill: '#6b21a8', fontWeight: 600 }} axisLine={{ stroke: '#a21caf' }} tickLine={{ stroke: '#a21caf' }} />
                          <YAxis tick={{ fontSize: 14, fill: '#6b21a8' }} axisLine={{ stroke: '#a21caf' }} tickLine={{ stroke: '#a21caf' }} width={60} />
                          <CartesianGrid strokeDasharray="3 3" stroke="#a21caf" opacity={0.15} />
                          <Tooltip
                            contentStyle={{ background: 'rgba(0,0,0,0.8)', borderRadius: 12, color: '#fff', border: 'none' }}
                            labelStyle={{ color: '#fff', fontWeight: 'bold' }}
                            itemStyle={{ color: '#fff' }}
                            formatter={(value: number, name: string) => {
                              console.log('Tooltip formatter called with:', { value, name });
                              if (name === 'signed') return [value.toLocaleString(), 'Signed'];
                              if (name === 'due') return [value.toLocaleString(), 'Due'];
                              // Fallback for any unexpected name values
                              return [value.toLocaleString(), name || 'Unknown'];
                            }}
                          />
                          <Bar dataKey="signed" name="Signed" fill="#a21caf" radius={[8, 8, 0, 0]} barSize={40} />
                          <Bar dataKey="due" name="Due" fill="#06b6d4" radius={[8, 8, 0, 0]} barSize={40} />
                          <RechartsLegend
                            verticalAlign="top"
                            align="center"
                            iconType="rect"
                            height={36}
                            wrapperStyle={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: '#a21caf' }}
                            formatter={(value: string) => {
                              if (value === 'Signed') return <span style={{ color: '#a21caf' }}>Signed</span>;
                              if (value === 'Due') return <span style={{ color: '#06b6d4' }}>Due</span>;
                              return value;
                            }}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Calendar Day Details Modal */}
      {isDrawerOpen && selectedDate && (
        <div className="modal modal-open">
          <div className="modal-box max-w-2xl bg-white shadow-2xl rounded-2xl">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl" style={{ background: '#edeafd', border: '1.5px solid #4638e2' }}>
                  <CalendarIcon className="w-6 h-6" style={{ color: '#4638e2' }} />
                </div>
                <div>
                  <h3 className="text-xl font-bold" style={{ color: '#4638e2' }}>
                    {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </h3>
                  <p className="text-sm" style={{ color: '#4638e2', opacity: 0.7, marginTop: 4 }}>
                    {getEventsForSelectedDate().length} event{getEventsForSelectedDate().length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              <button 
                className="btn btn-circle btn-ghost btn-sm hover:bg-purple-100"
                onClick={closeDrawer}
              >
                <XMarkIcon className="w-5 h-5" style={{ color: '#4638e2' }} />
              </button>
            </div>

            <div className="space-y-4 max-h-96 overflow-y-auto">
              {getEventsForSelectedDate().length > 0 ? (
                getEventsForSelectedDate().map((event) => (
                  <div 
                    key={event.id}
                    className="card bg-white border shadow-sm hover:shadow-md transition-all duration-200"
                    style={{ border: '1.5px solid #4638e2', background: '#f7f6fd' }}
                  >
                    <div className="card-body p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <div 
                              className="w-3 h-3 rounded-full"
                              style={{
                                backgroundColor: '#4638e2'
                              }}
                            />
                            <span className="text-sm font-semibold uppercase tracking-wide" style={{ color: '#4638e2' }}>
                              {event.type === 'meeting' ? 'Meeting' : 'Outlook Event'}
                            </span>
                          </div>
                          <h4 className="font-bold text-lg text-gray-900 mb-1">
                            {event.title}
                          </h4>
                          {event.type === 'outlook' && (
                            <p className="text-sm font-medium mb-2" style={{ color: '#4638e2' }}>
                              Time: {event.resource?.isAllDay
                                ? 'All Day'
                                : (() => {
                                    let ianaTz = windowsToIana(event.startTimeZone) || 'Asia/Jerusalem';
                                    if (typeof event.start === 'string' && typeof event.end === 'string') {
                                      try {
                                        const start = DateTime.fromISO(event.start, { zone: ianaTz });
                                        const end = DateTime.fromISO(event.end, { zone: ianaTz });
                                        return `${start.toFormat('HH:mm')} - ${end.toFormat('HH:mm')}`;
                                      } catch (e) {
                                        // fallback: just show the time part from the string if possible
                                        const startStr = typeof event.start === 'string' ? (event.start as string).length >= 16 ? (event.start as string).slice(11, 16) : 'N/A' : 'N/A';
                                        const endStr = typeof event.end === 'string' ? (event.end as string).length >= 16 ? (event.end as string).slice(11, 16) : 'N/A' : 'N/A';
                                        return `${startStr} - ${endStr}`;
                                      }
                                    }
                                    return 'N/A';
                                  })()}
                            </p>
                          )}
                          {event.type === 'meeting' && (
                            <p className="text-sm font-medium mb-2" style={{ color: '#4638e2' }}>
                              Lead: {event.leadNumber} - {event.clientName}
                            </p>
                          )}
                          <div className="flex items-center gap-4 text-sm text-gray-600">
                            <div className="flex items-center gap-1">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span>{event.type === 'meeting' ? (event.meetingTime ? event.meetingTime : 'All Day') : 'All Day'}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                              <span>
                                {event.type === 'meeting'
                                  ? `Manager: ${event.manager || 'N/A'}`
                                  : 'Outlook Calendar'}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <button className="btn btn-sm btn-outline btn-primary border-purple-300 text-purple-700 hover:bg-purple-100" onClick={() => { setSelectedEventDetails(event); setIsDetailsModalOpen(true); }}
                                  style={{ borderColor: '#4638e2', color: '#4638e2' }}
                          >
                            View Details
                          </button>
                          {event.type === 'outlook' && (
                            <>
                              <p className="text-sm font-medium mb-2" style={{ color: '#4638e2' }}>
                                Time: {event.resource?.isAllDay
                                  ? 'All Day'
                                  : (() => {
                                      let ianaTz = windowsToIana(event.startTimeZone) || 'Asia/Jerusalem';
                                      if (typeof event.start === 'string' && typeof event.end === 'string') {
                                        try {
                                          const start = DateTime.fromISO(event.start, { zone: ianaTz });
                                          const end = DateTime.fromISO(event.end, { zone: ianaTz });
                                          return `${start.toFormat('HH:mm')} - ${end.toFormat('HH:mm')}`;
                                        } catch (e) {
                                          // fallback: just show the time part from the string if possible
                                          const startStr = typeof event.start === 'string' ? (event.start as string).length >= 16 ? (event.start as string).slice(11, 16) : 'N/A' : 'N/A';
                                          const endStr = typeof event.end === 'string' ? (event.end as string).length >= 16 ? (event.end as string).slice(11, 16) : 'N/A' : 'N/A';
                                          return `${startStr} - ${endStr}`;
                                        }
                                      }
                                      return 'N/A';
                                    })()}
                              </p>
                              {(() => {
                                const joinUrl = event.resource?.onlineMeeting?.joinUrl
                                  || event.resource?.teamsMeetingUrl
                                  || event.resource?.webLink
                                  || event.resource?.location?.uri;
                                return joinUrl ? (
                                  <div className="mt-2">
                                    <a
                                      href={joinUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="btn btn-sm w-full"
                                      style={{ background: '#4638e2', color: '#fff', border: 'none' }}
                                    >
                                      Join Meeting
                                    </a>
                                  </div>
                                ) : null;
                              })()}
                            </>
                          )}
                          {event.type === 'meeting' && (
                            <button className="btn btn-sm" style={{ background: '#4638e2', color: '#fff', border: 'none' }}>
                              Join Meeting
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12">
                  <div className="flex items-center justify-center w-16 h-16 rounded-full mx-auto mb-4" style={{ background: '#edeafd' }}>
                    <CalendarIcon className="w-8 h-8" style={{ color: '#4638e2' }} />
                  </div>
                  <h4 className="text-lg font-semibold mb-2" style={{ color: '#4638e2' }}>No Events Scheduled</h4>
                  <p className="text-gray-500 mb-4">
                    There are no meetings or events scheduled for this day.
                  </p>
                  <button className="btn" style={{ background: '#4638e2', color: '#fff', border: 'none' }}>
                    Schedule Meeting
                  </button>
                </div>
              )}
            </div>

            <div className="modal-action mt-6">
              <button 
                className="btn btn-outline"
                style={{ borderColor: '#4638e2', color: '#4638e2' }}
                onClick={closeDrawer}
              >
                Close
              </button>
              <button className="btn" style={{ background: '#4638e2', color: '#fff', border: 'none' }}>
                Add Event
              </button>
            </div>
          </div>
        </div>
      )}

      {isDetailsModalOpen && selectedEventDetails && (
        <div className="modal modal-open">
          <div className="modal-box max-w-2xl bg-white shadow-2xl rounded-2xl border border-purple-200">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-purple-100 border border-purple-300">
                  <CalendarIcon className="w-6 h-6 text-purple-700" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">
                    {selectedEventDetails.title}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {selectedEventDetails.type === 'meeting' ? 'Client Meeting' : 'Outlook Event'}
                  </p>
                </div>
              </div>
              <button 
                className="btn btn-circle btn-ghost btn-sm hover:bg-purple-100"
                onClick={() => setIsDetailsModalOpen(false)}
              >
                <XMarkIcon className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {selectedEventDetails.type === 'meeting' && (
                <>
                  <p className="text-base text-purple-700 font-semibold">Lead: {selectedEventDetails.leadNumber} - {selectedEventDetails.clientName}</p>
                  <p className="text-base text-purple-700 font-semibold">Time: {selectedEventDetails.meetingTime}</p>
                </>
              )}
              {selectedEventDetails.type === 'outlook' && selectedEventDetails.description && (
                <div className="prose max-w-none">
                  <h4 className="font-bold text-lg text-gray-900 mb-2">Description</h4>
                  <div dangerouslySetInnerHTML={{ __html: selectedEventDetails.description }} />
                </div>
              )}
              {selectedEventDetails.type === 'outlook' && (
                <>
                  <p className="text-base text-purple-700 font-semibold">
                    Time: {selectedEventDetails.resource?.isAllDay || selectedEventDetails.allDay
                      ? 'All Day'
                      : (selectedEventDetails.resource?.start?.dateTime && selectedEventDetails.resource?.end?.dateTime)
                        ? `${new Date(selectedEventDetails.resource.start.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(selectedEventDetails.resource.end.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                        : (selectedEventDetails.start && selectedEventDetails.end)
                          ? `${selectedEventDetails.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${selectedEventDetails.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                          : 'N/A'}
                  </p>
                  {(() => {
                    const joinUrl = selectedEventDetails.resource?.onlineMeeting?.joinUrl
                      || selectedEventDetails.resource?.teamsMeetingUrl
                      || selectedEventDetails.resource?.webLink
                      || selectedEventDetails.resource?.location?.uri;
                    return joinUrl ? (
                      <div className="mt-2">
                        <a
                          href={joinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-primary bg-purple-600 hover:bg-purple-700 text-white w-full"
                        >
                          Join Meeting
                        </a>
                      </div>
                    ) : null;
                  })()}
                </>
              )}
            </div>
            <div className="modal-action mt-6">
              <button 
                className="btn btn-outline border-purple-300 text-purple-700 hover:bg-purple-100"
                onClick={() => setIsDetailsModalOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Suggestions Modal */}
      {showAISuggestionsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[80vh] overflow-hidden border border-gray-200">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-white">
              <h3 className="text-xl font-semibold flex items-center gap-2 text-gray-900">
                <SparklesIcon className="w-6 h-6" style={{ color: '#3b28c7' }} />
                All AI Suggestions
              </h3>
              <button 
                className="btn btn-ghost btn-sm btn-circle text-gray-700 hover:bg-gray-100"
                onClick={() => setShowAISuggestionsModal(false)}
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 border-b border-gray-200 bg-white">
              <div className="flex gap-4 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search suggestions..."
                      className="input input-bordered w-full pl-10 bg-white text-gray-900 border-gray-300 placeholder-gray-400"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <FunnelIcon className="w-5 h-5 text-gray-700" />
                  <select
                    className="select select-bordered bg-white text-gray-900 border-gray-300"
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value as any)}
                  >
                    <option value="all">All Types</option>
                    <option value="urgent">Urgent</option>
                    <option value="important">Important</option>
                    <option value="reminder">Reminder</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="p-4 overflow-y-auto max-h-[calc(80vh-200px)] bg-white">
              <div className="grid grid-cols-1 gap-4">
                {filteredSuggestions.map((suggestion) => (
                  <SuggestionCard key={suggestion.id} suggestion={suggestion} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Glassy card style
// Add this style globally or in the component
<style>{`
  .glass-card {
    background: rgba(255,255,255,0.60);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-radius: 1rem;
    box-shadow: 0 4px 24px 0 rgba(0,0,0,0.08), 0 1.5px 8px 0 rgba(0,0,0,0.04);
    padding: 1.5rem;
  }
`}</style>

export default Dashboard; 