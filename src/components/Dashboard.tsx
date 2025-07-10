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




  // Add mock client messages
  const mockMessages = [
    {
      id: '10',
      client_name: 'David Lee',
      lead_number: 'L122324',
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
      content: 'Hi, I have uploaded the required documents. Please confirm receipt.'
    },
    {
      id: '11',
      client_name: 'Emma Wilson',
      lead_number: 'L122325',
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
      content: 'Can you update me on the status of my application?'
    },
    {
      id: '13',
      client_name: 'John Smith',
      lead_number: 'L122326',
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
      content: 'Thank you for the meeting today. Looking forward to next steps.'
    },
    {
      id: '14',
      client_name: 'Sarah Parker',
      lead_number: 'L122327',
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
      content: 'I have a question about the contract terms.'
    },
    {
      id: '15',
      client_name: 'Tom Anderson',
      lead_number: 'L122328',
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





  // Handler to open AI Suggestions modal
  const handleAISuggestionsExpand = () => {
    setExpanded('ai');
    setTimeout(() => {
      aiSuggestionsRef.current?.openModal?.();
      aiSuggestionsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }, 100);
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

  // Refs and state for matching AI Suggestions height
  const aiRef = useRef<HTMLDivElement>(null);
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
    <div className="p-0 md:p-6 space-y-8">
      {/* 1. Summary Boxes: 4 columns */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6 mb-8 w-full mt-6 md:mt-0">
        {/* Meetings Today */}
        <div
          className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white relative overflow-hidden p-3 md:p-6"
          onClick={() => setExpanded(expanded === 'meetings' ? null : 'meetings')}
        >
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
              <CalendarIcon className="w-5 h-5 md:w-7 md:h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">{meetingsToday}</div>
              <div className="text-white/80 text-xs md:text-sm font-medium mt-1">Meetings Today</div>
            </div>
          </div>
          {/* SVG Graph Placeholder */}
          <svg className="absolute bottom-2 right-2 w-10 h-5 md:w-16 md:h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><path d="M2 28 Q16 8 32 20 T62 8" /></svg>
        </div>

        {/* Overdue Follow-ups */}
        <div
          className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-purple-600 via-blue-600 to-blue-500 text-white relative overflow-hidden p-3 md:p-6"
          onClick={() => setExpanded(expanded === 'overdue' ? null : 'overdue')}
        >
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
              <ExclamationTriangleIcon className="w-5 h-5 md:w-7 md:h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">{overdueFollowups}</div>
              <div className="text-white/80 text-xs md:text-sm font-medium mt-1">Overdue Follow-ups</div>
            </div>
          </div>
          {/* SVG Bar Chart Placeholder */}
          <svg className="absolute bottom-2 right-2 w-10 h-5 md:w-12 md:h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 48 32"><rect x="2" y="20" width="4" height="10"/><rect x="10" y="10" width="4" height="20"/><rect x="18" y="16" width="4" height="14"/><rect x="26" y="6" width="4" height="24"/><rect x="34" y="14" width="4" height="16"/></svg>
        </div>

        {/* New Messages */}
        <div
          className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white relative overflow-hidden p-3 md:p-6"
          onClick={() => setExpanded(expanded === 'messages' ? null : 'messages')}
        >
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
              <ChatBubbleLeftRightIcon className="w-5 h-5 md:w-7 md:h-7 mr-1 text-white" />
            </div>
            <div>
              <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">{latestMessages.length}</div>
              <div className="text-white/80 text-xs md:text-sm font-medium mt-1">New Messages</div>
            </div>
          </div>
          {/* SVG Circle Placeholder */}
          <svg className="absolute bottom-2 right-2 w-10 h-10 md:w-10 md:h-10 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" /><text x="16" y="21" textAnchor="middle" fontSize="10" fill="white" opacity="0.7">99+</text></svg>
        </div>

        {/* Action Required */}
        <div
          className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-teal-400 via-green-400 to-green-600 text-white relative overflow-hidden p-3 md:p-6"
        >
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
              <ArrowTrendingUpIcon className="w-5 h-5 md:w-7 md:h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">3</div>
              <div className="text-white/80 text-xs md:text-sm font-medium mt-1">Action Required</div>
            </div>
          </div>
          {/* SVG Line Chart Placeholder */}
          <svg className="absolute bottom-2 right-2 w-10 h-5 md:w-16 md:h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><polyline points="2,28 16,20 32,24 48,10 62,18" /></svg>
        </div>
      </div>

      {/* Expanded Content for Top Boxes */}
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
        <div className="glass-card mt-4 animate-fade-in">
          <div className="space-y-4">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Latest Messages</h3>
            <div className="space-y-3">
              {latestMessages.map((message, index) => (
                <div key={index} className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">{message.client_name}</span>
                      {message.lead_number && (
                        <span className="text-sm text-primary font-medium">({message.lead_number})</span>
                      )}
                    </div>
                    <span className="text-sm text-gray-500">
                      {new Date(message.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                  <p className="text-gray-700 text-sm">{message.content}</p>
                  <div className="flex gap-2 mt-3">
                    <button className="btn btn-sm btn-primary">Reply</button>
                    <button className="btn btn-sm btn-outline">View Details</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-center mt-4">
              <button className="btn btn-outline btn-primary">View All Messages</button>
            </div>
          </div>
        </div>
      )}

      {/* 2. AI Suggestions (left) and Scoreboard (right) side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10 w-full" style={{ alignItems: 'stretch' }}>
        {/* AI Suggestions Box */}
        <div ref={aiRef} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-lg flex flex-col w-full">
          <AISuggestions />
        </div>
        {/* Scoreboard Box */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-lg flex flex-col justify-between w-full">
          {/* Score Board Section */}
          <div className="card-body p-8">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-6 gap-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-tr from-[#3b28c7] via-[#3b28c7] to-[#3b28c7] shadow">
                  <ChartBarIcon className="w-7 h-7 text-white" />
                </div>
                <span className="text-2xl font-extrabold bg-gradient-to-tr from-[#3b28c7] via-[#3b28c7] to-[#3b28c7] text-transparent bg-clip-text drop-shadow">Score Board</span>
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
                  return (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={chartData}
                        barCategoryGap={32}
                        margin={{ top: 32, right: 32, left: 16, bottom: 32 }}
                      >
                        <XAxis dataKey="category" tick={{ fontSize: 16, fill: '#3b28c7', fontWeight: 600 }} axisLine={{ stroke: '#3b28c7' }} tickLine={{ stroke: '#3b28c7' }} />
                        <YAxis tick={{ fontSize: 14, fill: '#3b28c7' }} axisLine={{ stroke: '#3b28c7' }} tickLine={{ stroke: '#3b28c7' }} width={60} />
                        <CartesianGrid strokeDasharray="3 3" stroke="#3b28c7" opacity={0.15} />
                        <Tooltip
                          contentStyle={{ background: 'rgba(0,0,0,0.8)', borderRadius: 12, color: '#fff', border: 'none' }}
                          labelStyle={{ color: '#fff', fontWeight: 'bold' }}
                          itemStyle={{ color: '#fff' }}
                          formatter={(value: number, name: string) => {
                            if (name === 'signed') return [value.toLocaleString(), 'Signed'];
                            if (name === 'due') return [value.toLocaleString(), 'Due'];
                            return [value.toLocaleString(), name || 'Unknown'];
                          }}
                        />
                        <Bar dataKey="signed" name="Signed" fill="#3b28c7" radius={[8, 8, 0, 0]} barSize={40} />
                        <Bar dataKey="due" name="Due" fill="#06b6d4" radius={[8, 8, 0, 0]} barSize={40} />
                        <RechartsLegend
                          verticalAlign="top"
                          align="center"
                          iconType="rect"
                          height={36}
                          wrapperStyle={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: '#3b28c7' }}
                          formatter={(value: string) => {
                            if (value === 'Signed') return <span style={{ color: '#3b28c7' }}>Signed</span>;
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

      {/* 3. Top Workers Row: 4 boxes */}
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

      {/* 4. My Performance Graph (Full Width) */}
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