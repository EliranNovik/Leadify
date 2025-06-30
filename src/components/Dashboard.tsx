import React, { useState, useEffect, useRef } from 'react';
import Meetings from './Meetings';
import AISuggestions from './AISuggestions';
import OverdueFollowups from './OverdueFollowups';
import { UserGroupIcon, CalendarIcon, ExclamationTriangleIcon, ChatBubbleLeftRightIcon, ArrowTrendingUpIcon, ChartBarIcon, ChevronLeftIcon, ChevronRightIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { PieChart } from 'react-minimal-pie-chart';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot, ReferenceArea, BarChart, Bar, Legend as RechartsLegend, CartesianGrid } from 'recharts';

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

  return (
    <div className="p-4 md:p-6 space-y-8">
      {/* Top Summary Boxes */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* Meetings Today */}
        <div className="card bg-base-100 shadow-lg cursor-pointer hover:shadow-xl transition-all duration-300 border-t-4" style={{ borderTopColor: '#3b28c7' }} onClick={() => setExpanded(expanded === 'meetings' ? null : 'meetings')}>
          <div className="card-body p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-3xl font-bold text-primary">{meetingsToday}</h3>
                <p className="text-base-content/70">Meetings Today</p>
              </div>
              <CalendarIcon className="w-8 h-8 text-primary" />
            </div>
          </div>
        </div>

        {/* Overdue Follow-ups */}
        <div className="card bg-base-100 shadow-lg cursor-pointer hover:shadow-xl transition-all duration-300 border-t-4" style={{ borderTopColor: '#dc2626' }} onClick={() => setExpanded(expanded === 'overdue' ? null : 'overdue')}>
          <div className="card-body p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-3xl font-bold text-error">{overdueFollowups}</h3>
                <p className="text-base-content/70">Overdue Follow-ups</p>
              </div>
              <ExclamationTriangleIcon className="w-8 h-8 text-error" />
            </div>
          </div>
        </div>

        {/* New Messages */}
        <div className="card bg-base-100 shadow-lg cursor-pointer hover:shadow-xl transition-all duration-300 border-t-4" style={{ borderTopColor: '#0891b2' }} onClick={() => setExpanded(expanded === 'messages' ? null : 'messages')}>
          <div className="card-body p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-3xl font-bold text-info">{latestMessages.length}</h3>
                <p className="text-base-content/70">New Messages</p>
              </div>
              <ChatBubbleLeftRightIcon className="w-8 h-8 text-info" />
            </div>
          </div>
        </div>

        {/* Action Required */}
        <div className="card bg-base-100 shadow-lg cursor-pointer hover:shadow-xl transition-all duration-300 border-t-4" style={{ borderTopColor: '#f59e0b' }}>
          <div className="card-body p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-3xl font-bold text-warning">3</h3>
                <p className="text-base-content/70">Action Required</p>
              </div>
              <ArrowTrendingUpIcon className="w-8 h-8 text-warning" />
            </div>
          </div>
        </div>
      </div>

      {/* AI Suggestions always visible */}
      <div className="glass-card mb-8" ref={aiSuggestionsRef}>
        <AISuggestions ref={aiSuggestionsRef} />
      </div>

      {/* Graphs Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Meetings per Month Donut Chart */}
        <div className="card bg-base-100 shadow-lg p-6 flex flex-col items-center lg:col-span-1">
          <div className="flex items-center gap-2 mb-4">
            <CalendarIcon className="w-6 h-6 text-primary" />
            <span className="text-lg font-bold">Monthly Meeting Statistics</span>
          </div>
          <div className="w-full flex flex-col items-center gap-4 mt-2">
            <PieChart
              data={meetingsPerMonth.map((month, i) => ({
                title: month.month,
                value: month.count,
                color: ["#3b28c7", "#6366f1", "#a5b4fc"][i % 3],
              }))}
              lineWidth={30}
              paddingAngle={3}
              rounded
              animate
              label={({ dataEntry }) => dataEntry.value}
              labelStyle={{
                fontSize: '8px',
                fontWeight: 'bold',
                fill: '#fff',
              }}
              style={{ height: 180 }}
            />
            <div className="flex flex-col gap-2 mt-2">
              {meetingsPerMonth.map((month, i) => (
                <div key={month.month} className="flex items-center gap-2 text-sm">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: ["#3b28c7", "#6366f1", "#a5b4fc"][i % 3] }}></span>
                  <span className="font-semibold text-base-content/80">{month.month}:</span>
                  <span className="text-primary font-bold">{month.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* Contracts Signed by Category Bar Graph */}
        <div className="card bg-base-100 shadow-lg p-6 flex flex-col items-center lg:col-span-1">
          <div className="flex items-center gap-2 mb-4">
            <ChartBarIcon className="w-6 h-6 text-primary" />
            <span className="text-lg font-bold">Contracts & Revenue by Category</span>
          </div>
          <div className="w-full max-w-xl flex flex-col gap-4 mt-2">
            <div className="w-full space-y-3">
              {contractsByCategory.map((cat, i) => (
                <div key={cat.category} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-base font-semibold text-base-content/80">{cat.category}</span>
                    <div className="text-right">
                      <div className="text-sm font-bold text-primary">{cat.count} contracts</div>
                      <div className="text-xs text-success font-medium">₪{(cat.amount / 1000).toFixed(1)}k</div>
                    </div>
                  </div>
                  <div className="flex-1 bg-base-200 rounded-full h-6 relative overflow-hidden">
                    <div
                      className="h-6 rounded-full flex items-center justify-end pr-3 text-white font-bold text-sm transition-all relative"
                      style={{
                        width: `${Math.max(10, (cat.count / Math.max(...contractsByCategory.map(c => c.count))) * 100)}%`,
                        background: '#3b28c7',
                        boxShadow: '0 2px 8px 0 rgba(59,40,199,0.10)'
                      }}
                    >
                      {cat.count}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* Compact Calendar Section */}
        <div className="card shadow-lg p-4 lg:col-span-1" style={{ backgroundColor: '#3b28c7' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-white" />
              <span className="text-base font-bold text-white">Calendar</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={goToPreviousMonth} className="btn btn-ghost btn-xs text-white hover:bg-white/20">
                <ChevronLeftIcon className="w-3 h-3" />
              </button>
              <button onClick={goToToday} className="btn btn-xs text-xs text-white" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
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
                      isToday ? 'bg-white text-purple-600 font-bold' : 'hover:bg-white/10 text-white'
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
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#ffffff' }}></div>
              <span>Meetings</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#e0e7ff' }}></div>
              <span>Outlook</span>
            </div>
          </div>
        </div>
      </div>

      {/* Expandable Sections */}
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
        <div className="card bg-base-100 shadow-lg mt-4 animate-fade-in">
          <div className="card-body p-6">
            <div className="flex items-center gap-2 mb-6">
              <ChatBubbleLeftRightIcon className="w-6 h-6 text-info" />
              <h3 className="text-xl font-bold">Latest Messages</h3>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Client Emails */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                    <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                  </svg>
                  <h4 className="text-lg font-semibold text-blue-600">Client Emails</h4>
                </div>
                
                <div className="space-y-3">
                  {[
                    {
                      client: 'John Smith',
                      subject: 'Contract Review Request',
                      preview: 'Hi, I would like to discuss the contract terms we discussed last week...',
                      time: '2 hours ago',
                      unread: true
                    },
                    {
                      client: 'Maria Garcia',
                      subject: 'Meeting Confirmation',
                      preview: 'Thank you for the meeting yesterday. I have some questions about...',
                      time: '4 hours ago',
                      unread: false
                    },
                    {
                      client: 'David Wilson',
                      subject: 'Document Submission',
                      preview: 'I have attached the requested documents for my application...',
                      time: '1 day ago',
                      unread: true
                    }
                  ].map((email, i) => (
                    <div key={i} className={`card ${email.unread ? 'bg-blue-50 border-l-4 border-blue-500' : 'bg-base-50'} hover:shadow-md transition-all cursor-pointer`}>
                      <div className="card-body p-4">
                        <div className="flex items-start justify-between mb-2">
                          <h5 className="font-semibold text-base">{email.client}</h5>
                          <span className="text-xs text-base-content/60">{email.time}</span>
                        </div>
                        <h6 className="font-medium text-sm text-base-content/80 mb-1">{email.subject}</h6>
                        <p className="text-sm text-base-content/70 line-clamp-2">{email.preview}</p>
                        {email.unread && (
                          <div className="w-2 h-2 bg-blue-500 rounded-full mt-2"></div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* WhatsApp Messages */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.885 3.488"/>
                  </svg>
                  <h4 className="text-lg font-semibold text-green-600">WhatsApp Messages</h4>
                </div>
                
                <div className="space-y-3">
                  {[
                    {
                      client: 'Sarah Johnson',
                      message: 'Hi! I have a quick question about my application status',
                      time: '30 min ago',
                      unread: true
                    },
                    {
                      client: 'Michael Brown',
                      message: 'Thanks for the update. When can we schedule the next meeting?',
                      time: '1 hour ago',
                      unread: false
                    },
                    {
                      client: 'Emma Wilson',
                      message: 'I sent the documents you requested. Please let me know if you need anything else',
                      time: '3 hours ago',
                      unread: true
                    },
                    {
                      client: 'Alex Thompson',
                      message: 'Perfect! Looking forward to our meeting tomorrow',
                      time: '5 hours ago',
                      unread: false
                    }
                  ].map((whatsapp, i) => (
                    <div key={i} className={`card ${whatsapp.unread ? 'bg-green-50 border-l-4 border-green-500' : 'bg-base-50'} hover:shadow-md transition-all cursor-pointer`}>
                      <div className="card-body p-4">
                        <div className="flex items-start justify-between mb-2">
                          <h5 className="font-semibold text-base">{whatsapp.client}</h5>
                          <span className="text-xs text-base-content/60">{whatsapp.time}</span>
                        </div>
                        <p className="text-sm text-base-content/70 line-clamp-2">{whatsapp.message}</p>
                        {whatsapp.unread && (
                          <div className="w-2 h-2 bg-green-500 rounded-full mt-2"></div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Calendar Events Drawer */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Overlay */}
          <div 
            className="fixed inset-0 bg-black/50 transition-opacity"
            onClick={closeDrawer}
          />
          
          {/* Drawer */}
          <div className="fixed right-0 top-0 h-full w-96 bg-base-100 shadow-2xl transform transition-transform duration-300 ease-out">
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-base-200">
                <div className="flex items-center gap-2">
                  <CalendarIcon className="w-6 h-6 text-primary" />
                  <span className="text-lg font-bold">
                    {selectedDate ? new Date(selectedDate).toLocaleDateString('en-US', { 
                      weekday: 'long', 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric' 
                    }) : 'Events'}
                  </span>
                </div>
                <button 
                  onClick={closeDrawer} 
                  className="btn btn-ghost btn-circle btn-sm"
                  aria-label="Close drawer"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
              
              {/* Content */}
              <div className="flex-1 overflow-y-auto p-4">
                {getEventsForSelectedDate().length === 0 ? (
                  <div className="text-center py-8">
                    <CalendarIcon className="w-12 h-12 text-base-content/30 mx-auto mb-4" />
                    <p className="text-base-content/60">No events scheduled for this date</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {getEventsForSelectedDate().map((event, index) => (
                      <div 
                        key={event.id} 
                        className="card bg-base-200/50 hover:bg-base-200 transition-colors"
                      >
                        <div className="card-body p-4">
                          <div className="flex items-start gap-3">
                            <div 
                              className="w-3 h-3 rounded-full mt-1 flex-shrink-0"
                              style={{ 
                                backgroundColor: event.type === 'meeting' ? '#3b28c7' : '#6366f1'
                              }}
                            />
                            <div className="flex-1">
                              <div className="flex items-center justify-between mb-2">
                                <span className="badge badge-sm">
                                  {event.type === 'meeting' ? 'Client Meeting' : 'Outlook Event'}
                                </span>
                                {event.leadNumber && (
                                  <span className="text-sm text-base-content/60 font-mono">
                                    {event.leadNumber}
                                  </span>
                                )}
                              </div>
                              <h3 className="font-semibold text-base mb-1">{event.title}</h3>
                              {event.type === 'meeting' && event.leadNumber && (
                                <p className="text-sm text-base-content/70">
                                  Lead: {event.leadNumber}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* My Performance Graph (Full Width) */}
      <div className="w-full mt-12">
        <div className="glass-card p-8 shadow-xl rounded-2xl w-full max-w-full relative">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-6 gap-4">
            <div className="flex items-center gap-2 mb-2">
              <ChartBarIcon className="w-7 h-7 text-primary" />
              <span className="text-2xl font-bold">My Performance</span>
            </div>
            <div className="flex gap-6 text-sm md:text-base items-center">
              <div className="flex flex-col items-center">
                <span className="font-bold text-primary text-xl">{contractsLast30}</span>
                <span className="text-base-content/60">Last 30 Days</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="font-bold text-primary text-xl">{contractsToday}</span>
                <span className="text-base-content/60">Today</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="font-bold text-primary text-xl">{contractsThisMonth}</span>
                <span className="text-base-content/60">This Month</span>
              </div>
              {/* View Leads Button */}
              <button
                className="btn btn-sm btn-outline btn-primary ml-2"
                onClick={() => setShowLeadsList((v) => !v)}
              >
                {showLeadsList ? 'Hide Leads' : 'View Leads'}
              </button>
            </div>
          </div>
          <div className="w-full h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={performanceData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#8884d8' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#8884d8' }} axisLine={false} tickLine={false} width={30} />
                <Tooltip
                  contentStyle={{ background: 'rgba(59,40,199,0.95)', borderRadius: 12, color: '#fff', border: 'none' }}
                  labelStyle={{ color: '#fff', fontWeight: 'bold' }}
                  itemStyle={{ color: '#fff' }}
                  formatter={(value, name) => [name === 'avg' ? `${value} (team avg)` : `${value} contracts`, name === 'avg' ? 'Team Avg' : 'Contracts']}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#3b28c7"
                  strokeWidth={3}
                  dot={{ r: 5, stroke: '#fff', strokeWidth: 2, fill: '#3b28c7' }}
                  activeDot={{ r: 8, fill: '#6366f1', stroke: '#fff', strokeWidth: 3 }}
                  name="My Contracts"
                />
                <Line
                  type="monotone"
                  data={teamAverageData}
                  dataKey="avg"
                  stroke="#f59e0b"
                  strokeWidth={3}
                  dot={false}
                  name="Team Avg"
                  strokeDasharray="6 6"
                />
                {/* Highlight today */}
                {performanceData.map((d, i) => d.isToday && (
                  <ReferenceDot key={i} x={d.date} y={d.count} r={10} fill="#6366f1" stroke="#fff" strokeWidth={3} />
                ))}
                {/* Highlight this month */}
                {(() => {
                  const first = performanceData.findIndex(d => d.isThisMonth);
                  const last = performanceData.map(d => d.isThisMonth).lastIndexOf(true);
                  if (first !== -1 && last !== -1 && last > first) {
                    return (
                      <ReferenceArea x1={performanceData[first].date} x2={performanceData[last].date} fill="#a5b4fc" fillOpacity={0.12} />
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
              <span className="inline-block w-6 h-2 rounded-full" style={{ background: '#3b28c7' }}></span>
              <span className="text-base font-semibold">My Contracts</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-6 h-2 rounded-full" style={{ background: '#f59e0b' }}></span>
              <span className="text-base font-semibold">Team Avg</span>
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
        <div className="glass-card p-8 shadow-xl rounded-2xl w-full max-w-full">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-6 gap-4">
            <span className="text-2xl font-bold text-base-content">Score Board</span>
            <div className="tabs tabs-boxed bg-base-200 rounded-xl p-1">
              {scoreboardTabs.map(tab => (
                <a
                  key={tab}
                  className={`tab text-lg font-semibold px-6 py-2 rounded-lg transition-all ${scoreTab === tab ? 'tab-active bg-primary text-white shadow' : 'text-base-content/70 hover:bg-base-300'}`}
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
              <table className="table w-full rounded-xl bg-base-100">
                <thead>
                  <tr>
                    <th className="text-base font-bold text-base-content/80 px-4 py-3 bg-base-200 rounded-t-xl whitespace-nowrap"></th>
                    {scoreboardCategories.map(cat => (
                      <th key={cat} className="text-base font-bold text-base-content/80 px-4 py-3 bg-base-200 rounded-t-xl whitespace-nowrap">{cat}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Today row */}
                  <tr className="hover:bg-base-200/40 transition-all">
                    <td className="px-4 py-3 text-left font-bold text-lg text-base-content/80">Today</td>
                    {scoreboardData["Today"].map((cell, i) => (
                      <td key={i} className="px-4 py-3 text-center align-top">
                        <div className="inline-flex flex-col items-start w-full">
                          <div className="flex items-start justify-between bg-base-200 rounded-xl px-3 py-2 shadow-sm w-full">
                            <span className="badge bg-primary text-white font-bold text-lg min-w-[2.5rem] h-10 flex justify-center items-center shadow-md">
                              {cell.count}
                            </span>
                            <span className={`text-lg font-bold leading-tight ${cell.amount < cell.expected ? 'text-error' : cell.amount >= cell.expected && cell.expected > 0 ? 'text-success' : 'text-base-content/80'}`}>₪{cell.amount ? cell.amount.toLocaleString() : '0'}</span>
                          </div>
                          {cell.expected > 0 && (
                            <div className="text-xs text-base-content/60 mt-1 text-right w-full">
                              <span className="opacity-70">Expected:</span> <span className="font-semibold">{cell.expected.toLocaleString()}</span>
                            </div>
                          )}
                        </div>
                      </td>
                    ))}
                  </tr>
                  {/* Last 30d row */}
                  <tr className="hover:bg-base-200/40 transition-all">
                    <td className="px-4 py-3 text-left font-bold text-lg text-base-content/80">Last 30 days</td>
                    {scoreboardData["Last 30d"].map((cell, i) => (
                      <td key={i} className="px-4 py-3 text-center align-top">
                        <div className="inline-flex flex-col items-start w-full">
                          <div className="flex items-start justify-between bg-base-200 rounded-xl px-3 py-2 shadow-sm w-full">
                            <span className="badge bg-primary text-white font-bold text-lg min-w-[2.5rem] h-10 flex justify-center items-center shadow-md">
                              {cell.count}
                            </span>
                            <span className={`text-lg font-bold leading-tight ${cell.amount < cell.expected ? 'text-error' : cell.amount >= cell.expected && cell.expected > 0 ? 'text-success' : 'text-base-content/80'}`}>₪{cell.amount ? cell.amount.toLocaleString() : '0'}</span>
                          </div>
                          {cell.expected > 0 && (
                            <div className="text-xs text-base-content/60 mt-1 text-right w-full">
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
                      <XAxis dataKey="category" tick={{ fontSize: 16, fill: '#3b28c7', fontWeight: 600 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 14, fill: '#8884d8' }} axisLine={false} tickLine={false} width={60} />
                      <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" opacity={0.5} />
                      <Tooltip
                        contentStyle={{ background: 'rgba(59,40,199,0.95)', borderRadius: 12, color: '#fff', border: 'none' }}
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
                      <Bar dataKey="signed" name="Signed" fill="#3b28c7" radius={[8, 8, 0, 0]} barSize={40} />
                      <Bar dataKey="due" name="Due" fill="#f59e0b" radius={[8, 8, 0, 0]} barSize={40} />
                      <RechartsLegend
                        verticalAlign="top"
                        align="center"
                        iconType="rect"
                        height={36}
                        wrapperStyle={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}
                        formatter={(value, entry) => {
                          console.log('Legend formatter called with:', { value, entry });
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