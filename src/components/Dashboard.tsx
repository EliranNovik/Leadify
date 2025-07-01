import React, { useState, useEffect, useRef } from 'react';
import Meetings from './Meetings';
import AISuggestions from './AISuggestions';
import OverdueFollowups from './OverdueFollowups';
import { UserGroupIcon, CalendarIcon, ExclamationTriangleIcon, ChatBubbleLeftRightIcon, ArrowTrendingUpIcon, ChartBarIcon, ChevronLeftIcon, ChevronRightIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { PieChart as RechartsPieChart, Pie, Cell } from 'recharts';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot, ReferenceArea, BarChart, Bar, Legend as RechartsLegend, CartesianGrid } from 'recharts';
import { RadialBarChart, RadialBar, PolarAngleAxis, Legend } from 'recharts';

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  type: 'meeting' | 'outlook';
  leadNumber?: string;
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

  // Add mock client messages
  const mockMessages = [
    {
      id: '1',
      client_name: 'David Lee',
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
      content: 'Hi, I have uploaded the required documents. Please confirm receipt.'
    },
    {
      id: '2',
      client_name: 'Emma Wilson',
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
      content: 'Can you update me on the status of my application?'
    },
    {
      id: '3',
      client_name: 'John Smith',
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
      content: 'Thank you for the meeting today. Looking forward to next steps.'
    },
    {
      id: '4',
      client_name: 'Sarah Parker',
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
      content: 'I have a question about the contract terms.'
    },
    {
      id: '5',
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
    { id: 1, title: 'Client Meeting - John Smith', date: '2024-01-15', type: 'meeting', color: '#3b28c7' },
    { id: 2, title: 'Outlook Event - Team Sync', date: '2024-01-15', type: 'outlook', color: '#6366f1' },
    { id: 3, title: 'Client Meeting - Maria Garcia', date: '2024-01-16', type: 'meeting', color: '#3b28c7' },
    { id: 4, title: 'Outlook Event - Sales Review', date: '2024-01-17', type: 'outlook', color: '#6366f1' },
    { id: 5, title: 'Client Meeting - David Wilson', date: '2024-01-18', type: 'meeting', color: '#3b28c7' },
    { id: 6, title: 'Outlook Event - Weekly Planning', date: '2024-01-19', type: 'outlook', color: '#6366f1' },
    { id: 7, title: 'Client Meeting - Sarah Johnson', date: '2024-01-20', type: 'meeting', color: '#3b28c7' },
  ];

  // Fetch calendar events
  const fetchCalendarEvents = async () => {
    setIsCalendarLoading(true);
    try {
      // Fetch meetings from leads table
      const { data: meetingsData, error: meetingsError } = await supabase
        .from('leads')
        .select('id, name, meeting_date, lead_number')
        .not('meeting_date', 'is', null)
        .gte('meeting_date', new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).toISOString())
        .lt('meeting_date', new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).toISOString());

      if (meetingsError) throw meetingsError;

      // Fetch outlook events (mock data for now - replace with actual outlook integration)
      const mockOutlookEvents = [
        { id: 'out1', title: 'Team Sync', date: '2024-01-15', type: 'outlook' },
        { id: 'out2', title: 'Sales Review', date: '2024-01-17', type: 'outlook' },
        { id: 'out3', title: 'Weekly Planning', date: '2024-01-19', type: 'outlook' },
      ];

      // Combine and format events
      const formattedMeetings = meetingsData?.map(meeting => ({
        id: `meeting-${meeting.id}`,
        title: `Meeting - ${meeting.name}`,
        date: meeting.meeting_date.split('T')[0],
        type: 'meeting' as const,
        leadNumber: meeting.lead_number
      })) || [];

      const formattedOutlook = mockOutlookEvents.map(event => ({
        ...event,
        date: event.date,
        type: 'outlook' as const
      }));

      setCalendarEvents([...formattedMeetings, ...formattedOutlook]);
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
  }, [currentDate]);

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

  return (
    <div className="p-4 md:p-6 space-y-8">
      {/* Top Summary Boxes */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
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
              <ChatBubbleLeftRightIcon className="w-7 h-7 text-white opacity-90" />
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
          <div className="card shadow-xl rounded-2xl relative overflow-hidden bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white">
            <div className="card-body p-6">
              <div className="flex items-center gap-2 mb-4">
                <svg className="w-6 h-6 text-white/90" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8" /><rect x="3" y="6" width="18" height="12" rx="2" /></svg>
                <span className="text-xl font-bold text-white">Client Emails</span>
              </div>
              {/* Email Messages List */}
              <div className="space-y-6">
                {/* Example Email Message */}
                <div className="bg-white/10 rounded-xl p-4 mb-2">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-white text-lg">John Smith</span>
                    <span className="text-white/70 text-sm">2 hours ago</span>
                  </div>
                  <div className="font-semibold text-white/90 mb-1">Contract Review Request</div>
                  <div className="text-white/80 text-sm mb-2">Hi, I would like to discuss the contract terms we discussed last week...</div>
                  <span className="w-2 h-2 bg-cyan-300 rounded-full inline-block" />
                </div>
                <div className="p-1" />
                <div className="flex justify-between items-center mb-1">
                  <span className="font-bold text-white text-lg">Maria Garcia</span>
                  <span className="text-white/70 text-sm">4 hours ago</span>
                </div>
                <div className="font-semibold text-white/90 mb-1">Meeting Confirmation</div>
                <div className="text-white/80 text-sm mb-2">Thank you for the meeting yesterday. I have some questions about...</div>
                <div className="p-1" />
                <div className="bg-white/10 rounded-xl p-4 mb-2">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-white text-lg">David Wilson</span>
                    <span className="text-white/70 text-sm">1 day ago</span>
                  </div>
                  <div className="font-semibold text-white/90 mb-1">Document Submission</div>
                  <div className="text-white/80 text-sm mb-2">I have attached the requested documents for my application...</div>
                  <span className="w-2 h-2 bg-cyan-300 rounded-full inline-block" />
                </div>
              </div>
              {/* SVG Decoration */}
              <svg className="absolute bottom-4 right-4 w-16 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><rect x="2" y="20" width="4" height="10"/><rect x="10" y="10" width="4" height="20"/><rect x="18" y="16" width="4" height="14"/><rect x="26" y="6" width="4" height="24"/><rect x="34" y="14" width="4" height="16"/></svg>
            </div>
          </div>
          {/* WhatsApp Messages Card */}
          <div className="card shadow-xl rounded-2xl relative overflow-hidden bg-gradient-to-tr from-emerald-500 via-teal-500 to-teal-600 text-white">
            <div className="card-body p-6">
              <div className="flex items-center gap-2 mb-4">
                <svg className="w-6 h-6 text-white/90" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16.72 11.06a6.5 6.5 0 10-11.44 6.1L3 21l3.94-2.28a6.5 6.5 0 009.78-7.66z" /><path d="M8 10h.01" /><path d="M12 14h.01" /><path d="M16 10h.01" /></svg>
                <span className="text-xl font-bold text-white">WhatsApp Messages</span>
              </div>
              {/* WhatsApp Messages List */}
              <div className="space-y-6">
                <div className="bg-white/10 rounded-xl p-4 mb-2">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-white text-lg">Sarah Johnson</span>
                    <span className="text-white/70 text-sm">30 min ago</span>
                  </div>
                  <div className="text-white/80 text-sm mb-2">Hi! I have a quick question about my application status</div>
                  <span className="w-2 h-2 bg-emerald-300 rounded-full inline-block" />
                </div>
                <div className="flex justify-between items-center mb-1">
                  <span className="font-bold text-white text-lg">Michael Brown</span>
                  <span className="text-white/70 text-sm">1 hour ago</span>
                </div>
                <div className="text-white/80 text-sm mb-2">Thanks for the update. When can we schedule the next meeting?</div>
                <div className="bg-white/10 rounded-xl p-4 mb-2">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-white text-lg">Emma Wilson</span>
                    <span className="text-white/70 text-sm">3 hours ago</span>
                  </div>
                  <div className="text-white/80 text-sm mb-2">I sent the documents you requested. Please let me know if you need anything else</div>
                  <span className="w-2 h-2 bg-emerald-300 rounded-full inline-block" />
                </div>
                <div className="flex justify-between items-center mb-1">
                  <span className="font-bold text-white text-lg">Alex Thompson</span>
                  <span className="text-white/70 text-sm">5 hours ago</span>
                </div>
                <div className="text-white/80 text-sm mb-2">Perfect! Looking forward to our meeting tomorrow</div>
              </div>
              {/* SVG Decoration */}
              <svg className="absolute bottom-4 right-4 w-16 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><circle cx="32" cy="16" r="14" /></svg>
            </div>
          </div>
        </div>
      )}

      {/* AI Suggestions always visible */}
      <div className="card shadow-xl rounded-2xl mb-8 relative overflow-hidden bg-gradient-to-tr from-emerald-500 via-teal-500 to-teal-600 text-white" ref={aiSuggestionsRef}>
        <div className="card-body p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/20 shadow">
              <ChatBubbleLeftRightIcon className="w-6 h-6 text-white opacity-90" />
            </div>
            <span className="text-xl font-bold text-white">AI Suggestions</span>
          </div>
          <AISuggestions ref={aiSuggestionsRef} />
          {/* SVG Decoration */}
          <svg className="absolute bottom-4 right-4 w-16 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><path d="M2 28 Q16 8 32 20 T62 8" /></svg>
        </div>
      </div>

      {/* Graphs Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Meetings per Month Donut Chart */}
        <div className="card shadow-xl rounded-2xl p-6 flex flex-col items-center lg:col-span-1 relative overflow-hidden bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white">
          <div className="flex items-center gap-2 mb-4">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/20 shadow">
              <CalendarIcon className="w-6 h-6 text-white opacity-90" />
            </div>
            <span className="text-lg font-bold text-white">Monthly Meeting Statistics</span>
          </div>
          <div className="w-full flex flex-col items-center gap-4 mt-2">
            {/* Professional Donut Progress Ring for Current Month */}
            {(() => {
              const currentMonth = meetingsPerMonth[meetingsPerMonth.length - 1];
              const target = 100; // You can adjust this target as needed
              const value = currentMonth.count;
              const percent = Math.min(value / target, 1);
              const data = [
                { name: 'Meetings', value },
                { name: 'Remaining', value: Math.max(target - value, 0) },
              ];
              const COLORS = ['#ffffff', 'rgba(255,255,255,0.3)'];
              return (
                <div style={{ width: 180, height: 180, position: 'relative' }}>
                  <RechartsPieChart width={180} height={180}>
                    <Pie
                      data={data}
                      cx="50%"
                      cy="50%"
                      innerRadius={65}
                      outerRadius={85}
                      startAngle={90}
                      endAngle={-270}
                      dataKey="value"
                      stroke="none"
                      isAnimationActive={true}
                    >
                      {data.map((entry, i) => (
                        <Cell key={`cell-${i}`} fill={COLORS[i]} />
                      ))}
                    </Pie>
                  </RechartsPieChart>
                  {/* Centered label */}
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    textAlign: 'center',
                  }}>
                    <div className="text-3xl font-bold text-white">{value}</div>
                    <div className="text-base font-semibold text-white/80">{currentMonth.month}</div>
                    <div className="text-xs text-white/70">{Math.round(percent * 100)}% of target</div>
                  </div>
                </div>
              );
            })()}
            {/* Minimal legend below */}
            <div className="flex flex-col gap-1 mt-2 text-sm text-white/80">
              <div><span className="inline-block w-3 h-3 rounded-full mr-2 bg-white"></span>Meetings this month</div>
              <div><span className="inline-block w-3 h-3 rounded-full mr-2 bg-white/30"></span>Target</div>
            </div>
          </div>
          {/* SVG Decoration */}
          <svg className="absolute bottom-4 right-4 w-16 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><circle cx="32" cy="16" r="12" /></svg>
        </div>
        {/* Contracts Signed by Category Bar Graph */}
        <div className="card shadow-xl rounded-2xl p-6 flex flex-col items-center lg:col-span-1 relative overflow-hidden bg-gradient-to-tr from-purple-600 via-blue-600 to-blue-500 text-white">
          <div className="flex items-center gap-2 mb-4">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/20 shadow">
              <ChartBarIcon className="w-6 h-6 text-white opacity-90" />
            </div>
            <span className="text-lg font-bold text-white">Contracts & Revenue by Category</span>
          </div>
          <div className="w-full max-w-xl flex flex-col gap-4 mt-2">
            <div className="w-full space-y-3">
              {contractsByCategory.map((cat, i) => (
                <div key={cat.category} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-base font-semibold text-white/90">{cat.category}</span>
                    <div className="text-right">
                      <div className="text-sm font-bold text-white">{cat.count} contracts</div>
                      <div className="text-xs text-green-300 font-medium">₪{(cat.amount / 1000).toFixed(1)}k</div>
                    </div>
                  </div>
                  <div className="flex-1 bg-white/20 rounded-full h-6 relative overflow-hidden">
                    <div
                      className="h-6 rounded-full flex items-center justify-end pr-3 text-white font-bold text-sm transition-all relative"
                      style={{
                        width: `${Math.max(10, (cat.count / Math.max(...contractsByCategory.map(c => c.count))) * 100)}%`,
                        background: '#ffffff',
                        boxShadow: '0 2px 8px 0 rgba(255,255,255,0.2)'
                      }}
                    >
                      {cat.count}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* SVG Decoration */}
          <svg className="absolute bottom-4 right-4 w-16 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><rect x="2" y="20" width="4" height="10"/><rect x="10" y="10" width="4" height="20"/><rect x="18" y="16" width="4" height="14"/><rect x="26" y="6" width="4" height="24"/><rect x="34" y="14" width="4" height="16"/></svg>
        </div>
        {/* Compact Calendar Section */}
        <div className="card shadow-xl rounded-2xl p-4 lg:col-span-1 relative overflow-hidden bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/20 shadow">
                <CalendarIcon className="w-5 h-5 text-white opacity-90" />
              </div>
              <span className="text-base font-bold text-white">Calendar</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={goToPreviousMonth} className="btn btn-ghost btn-xs text-white hover:bg-white/20">
                <ChevronLeftIcon className="w-3 h-3" />
              </button>
              <button onClick={goToToday} className="btn btn-xs text-xs text-white bg-white/20 hover:bg-white/30">
                Today
              </button>
              <button onClick={goToNextMonth} className="btn btn-ghost btn-xs text-white hover:bg-white/20">
                <ChevronRightIcon className="w-3 h-3" />
              </button>
            </div>
          </div>
          
          <div className="text-center mb-3">
            <span className="text-sm font-semibold text-white">
              {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </span>
          </div>

          {/* Compact Calendar Grid */}
          <div className="grid grid-cols-7 gap-0.5 mb-3">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(day => (
              <div key={day} className="text-center text-xs font-semibold text-white/80 p-1">
                {day}
              </div>
            ))}
            
            {(() => {
              const { daysInMonth, firstDayOfMonth } = getDaysInMonth(currentDate);
              const days = [];
              
              // Add empty cells for days before the first day of the month
              for (let i = 0; i < firstDayOfMonth; i++) {
                days.push(<div key={`empty-${i}`} className="h-8"></div>);
              }
              
              // Add cells for each day of the month
              for (let day = 1; day <= daysInMonth; day++) {
                const dateStr = formatDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), day));
                const events = getEventsForDate(dateStr);
                const isToday = dateStr === formatDate(new Date());
                
                days.push(
                  <div 
                    key={day} 
                    className={`h-8 border border-white/20 p-0.5 text-xs relative cursor-pointer ${
                      isToday ? 'bg-white text-blue-600 font-bold' : 'hover:bg-white/10 text-white'
                    }`}
                    onClick={() => handleDateClick(dateStr)}
                  >
                    <div className="text-right leading-none">{day}</div>
                    <div className="flex flex-col gap-0.5 mt-0.5">
                      {events.slice(0, 1).map(event => (
                        <div
                          key={event.id}
                          className="w-2 h-2 rounded-full mx-auto"
                          style={{ 
                            backgroundColor: event.type === 'meeting' ? '#ffffff' : '#e0e7ff'
                          }}
                          title={`${event.title}${event.leadNumber ? ` (${event.leadNumber})` : ''}`}
                        />
                      ))}
                      {events.length > 1 && (
                        <div className="text-xs text-white/70 text-center leading-none">
                          +{events.length - 1}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }
              
              return days;
            })()}
          </div>

          {/* Compact Legend */}
          <div className="flex items-center justify-center gap-3 text-xs text-white">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-white"></div>
              <span>Meetings</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-blue-200"></div>
              <span>Outlook</span>
            </div>
          </div>
          {/* SVG Decoration */}
          <svg className="absolute bottom-4 right-4 w-16 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><polyline points="2,28 16,20 32,24 48,10 62,18" /></svg>
        </div>
      </div>

      {/* My Performance Graph (Full Width) */}
      <div className="w-full mt-12">
        <div className="card shadow-xl rounded-2xl w-full max-w-full relative overflow-hidden bg-gradient-to-tr from-yellow-400 via-orange-400 to-pink-500 text-white">
          <div className="card-body p-8">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-6 gap-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-white/20 shadow">
                  <ChartBarIcon className="w-7 h-7 text-white opacity-90" />
                </div>
                <span className="text-2xl font-bold text-white">My Performance</span>
              </div>
              <div className="flex gap-6 text-sm md:text-base items-center">
                <div className="flex flex-col items-center">
                  <span className="font-bold text-white text-xl">{contractsLast30}</span>
                  <span className="text-white/80">Last 30 Days</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="font-bold text-white text-xl">{contractsToday}</span>
                  <span className="text-white/80">Today</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="font-bold text-white text-xl">{contractsThisMonth}</span>
                  <span className="text-white/80">This Month</span>
                </div>
                {/* View Leads Button */}
                <button
                  className="btn btn-sm btn-outline border-white/40 text-white hover:bg-white/10 ml-2"
                  onClick={() => setShowLeadsList((v) => !v)}
                >
                  {showLeadsList ? 'Hide Leads' : 'View Leads'}
                </button>
              </div>
            </div>
            <div className="w-full h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={performanceData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#ffffff' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#ffffff' }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip content={<PerformanceTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#ffffff"
                    strokeWidth={3}
                    dot={{ r: 5, stroke: '#fff', strokeWidth: 2, fill: '#ffffff' }}
                    activeDot={{ r: 8, fill: '#ffffff', stroke: '#000', strokeWidth: 3 }}
                    name="My Contracts"
                  />
                  <Line
                    type="monotone"
                    data={teamAverageData}
                    dataKey="avg"
                    stroke="#fbbf24"
                    strokeWidth={3}
                    dot={false}
                    name="Team Avg"
                    strokeDasharray="6 6"
                  />
                  {/* Highlight today */}
                  {performanceData.map((d, i) => d.isToday && (
                    <ReferenceDot key={i} x={d.date} y={d.count} r={10} fill="#ffffff" stroke="#000" strokeWidth={3} />
                  ))}
                  {/* Highlight this month */}
                  {(() => {
                    const first = performanceData.findIndex(d => d.isThisMonth);
                    const last = performanceData.map(d => d.isThisMonth).lastIndexOf(true);
                    if (first !== -1 && last !== -1 && last > first) {
                      return (
                        <ReferenceArea x1={performanceData[first].date} x2={performanceData[last].date} fill="#ffffff" fillOpacity={0.1} />
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
                <span className="inline-block w-6 h-2 rounded-full bg-white"></span>
                <span className="text-base font-semibold text-white">My Contracts</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-6 h-2 rounded-full bg-yellow-300"></span>
                <span className="text-base font-semibold text-white">Team Avg</span>
              </div>
            </div>
            {/* SVG Decoration */}
            <svg className="absolute bottom-4 right-4 w-16 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><polyline points="2,28 16,20 32,24 48,10 62,18" /></svg>
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
        <div className="card shadow-xl rounded-2xl w-full max-w-full relative overflow-hidden bg-gradient-to-tr from-indigo-500 via-purple-500 to-purple-600 text-white">
          <div className="card-body p-8">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-6 gap-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-white/20 shadow">
                  <ChartBarIcon className="w-7 h-7 text-white opacity-90" />
                </div>
                <span className="text-2xl font-bold text-white">Score Board</span>
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
                      <th className="text-base font-bold text-white/90 px-4 py-3 bg-white/20 rounded-t-xl whitespace-nowrap"></th>
                      {scoreboardCategories.map(cat => (
                        <th key={cat} className="text-base font-bold text-white/90 px-4 py-3 bg-white/20 rounded-t-xl whitespace-nowrap">{cat}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Today row */}
                    <tr className="hover:bg-white/10 transition-all">
                      <td className="px-4 py-3 text-left font-bold text-lg text-white/90">Today</td>
                      {scoreboardData["Today"].map((cell, i) => (
                        <td key={i} className="px-4 py-3 text-center align-top">
                          <div className="inline-flex flex-col items-start w-full">
                            <div className="flex items-start justify-between bg-white/20 rounded-xl px-3 py-2 shadow-sm w-full">
                              <span className="badge bg-white text-purple-600 font-bold text-lg min-w-[2.5rem] h-10 flex justify-center items-center shadow-md">
                                {cell.count}
                              </span>
                              <span className={`text-lg font-bold leading-tight ${cell.amount < cell.expected ? 'text-red-300' : cell.amount >= cell.expected && cell.expected > 0 ? 'text-green-300' : 'text-white/80'}`}>₪{cell.amount ? cell.amount.toLocaleString() : '0'}</span>
                            </div>
                            {cell.expected > 0 && (
                              <div className="text-xs text-white/70 mt-1 text-right w-full">
                                <span className="opacity-70">Expected:</span> <span className="font-semibold">{cell.expected.toLocaleString()}</span>
                              </div>
                            )}
                          </div>
                        </td>
                      ))}
                    </tr>
                    {/* Last 30d row */}
                    <tr className="hover:bg-white/10 transition-all">
                      <td className="px-4 py-3 text-left font-bold text-lg text-white/90">Last 30 days</td>
                      {scoreboardData["Last 30d"].map((cell, i) => (
                        <td key={i} className="px-4 py-3 text-center align-top">
                          <div className="inline-flex flex-col items-start w-full">
                            <div className="flex items-start justify-between bg-white/20 rounded-xl px-3 py-2 shadow-sm w-full">
                              <span className="badge bg-white text-purple-600 font-bold text-lg min-w-[2.5rem] h-10 flex justify-center items-center shadow-md">
                                {cell.count}
                              </span>
                              <span className={`text-lg font-bold leading-tight ${cell.amount < cell.expected ? 'text-red-300' : cell.amount >= cell.expected && cell.expected > 0 ? 'text-green-300' : 'text-white/80'}`}>₪{cell.amount ? cell.amount.toLocaleString() : '0'}</span>
                            </div>
                            {cell.expected > 0 && (
                              <div className="text-xs text-white/70 mt-1 text-right w-full">
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
                        <XAxis dataKey="category" tick={{ fontSize: 16, fill: '#ffffff', fontWeight: 600 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 14, fill: '#ffffff' }} axisLine={false} tickLine={false} width={60} />
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff" opacity={0.2} />
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
                        <Bar dataKey="signed" name="Signed" fill="#ffffff" radius={[8, 8, 0, 0]} barSize={40} />
                        <Bar dataKey="due" name="Due" fill="#fbbf24" radius={[8, 8, 0, 0]} barSize={40} />
                        <RechartsLegend
                          verticalAlign="top"
                          align="center"
                          iconType="rect"
                          height={36}
                          wrapperStyle={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: '#ffffff' }}
                          formatter={(value: string) => {
                            console.log('Legend formatter called with:', { value });
                            const item = meetingsPerMonth.find(m => m.month === value);
                            return value;
                          }}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  );
                })()}
              </div>
            )}
            {/* SVG Decoration */}
            <svg className="absolute bottom-4 right-4 w-16 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><rect x="2" y="20" width="4" height="10"/><rect x="10" y="10" width="4" height="20"/><rect x="18" y="16" width="4" height="14"/><rect x="26" y="6" width="4" height="24"/><rect x="34" y="14" width="4" height="16"/></svg>
          </div>
        </div>
      </div>
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