import React, { useState, useEffect, useRef } from 'react';
import Meetings from './Meetings';
import AISuggestions from './AISuggestions';
import OverdueFollowups from './OverdueFollowups';
import { UserGroupIcon, CalendarIcon, ExclamationTriangleIcon, ChatBubbleLeftRightIcon, ArrowTrendingUpIcon, ChartBarIcon, ChevronLeftIcon, ChevronRightIcon, XMarkIcon, ClockIcon, SparklesIcon, MagnifyingGlassIcon, FunnelIcon, CheckCircleIcon, PlusIcon, ArrowPathIcon, VideoCameraIcon, PhoneIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { PieChart as RechartsPieChart, Pie, Cell } from 'recharts';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot, ReferenceArea, BarChart, Bar, Legend as RechartsLegend, CartesianGrid } from 'recharts';
import { RadialBarChart, RadialBar, PolarAngleAxis, Legend } from 'recharts';
import { useMsal } from '@azure/msal-react';
import { DateTime } from 'luxon';
import { FaWhatsapp } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';





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

  // 1. Add state for real signed leads
  const [realSignedLeads, setRealSignedLeads] = useState<any[]>([]);
  const [realLeadsLoading, setRealLeadsLoading] = useState(false);

  // 1. Add state for real overdue leads
  const [realOverdueLeads, setRealOverdueLeads] = useState<any[]>([]);
  const [overdueLeadsLoading, setOverdueLeadsLoading] = useState(false);

  const navigate = useNavigate();

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

  // --- Add state for today's meetings (real data) ---
  const [todayMeetings, setTodayMeetings] = useState<any[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(false);

  useEffect(() => {
    // Fetch today's meetings (real data, similar to Meetings.tsx)
    const fetchMeetings = async () => {
      setMeetingsLoading(true);
      try {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const { data: meetings, error } = await supabase
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
          .eq('meeting_date', todayStr)
          .not('teams_meeting_url', 'is', null);
        if (!error && meetings) {
          setTodayMeetings(
            meetings.map((meeting: any) => ({
              id: meeting.id,
              lead: meeting.leads?.lead_number || 'N/A',
              name: meeting.leads?.name || 'Unknown',
              topic: meeting.leads?.topic || 'Consultation',
              expert: meeting.expert || 'Unassigned',
              time: meeting.meeting_time,
              location: meeting.meeting_location || 'Teams',
              manager: meeting.meeting_manager,
              value: meeting.meeting_amount ? `${meeting.meeting_currency} ${meeting.meeting_amount}` : '0',
              link: meeting.teams_meeting_url,
              stage: meeting.leads?.stage,
            }))
          );
        } else {
          setTodayMeetings([]);
        }
      } catch (e) {
        setTodayMeetings([]);
      }
      setMeetingsLoading(false);
    };
    if (expanded === 'meetings') fetchMeetings();
  }, [expanded]);

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
  const [scoreTab, setScoreTab] = React.useState("Tables");
  const [flippedCards, setFlippedCards] = React.useState<Set<string>>(new Set());

  // Get the current month name
  const currentMonthName = new Date().toLocaleString('en-US', { month: 'long' });

  // Mock data for department line graphs (last 30 days)
  const generateDepartmentData = (category: string) => {
    const today = new Date();
    const data = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (29 - i));
      
      // Different patterns for different departments
      let baseValue = 0;
      switch (category) {
        case 'General':
          baseValue = Math.random() * 2;
          break;
        case 'Commercial & Civil':
          baseValue = 3 + Math.sin(i / 5) * 2 + Math.random() * 1.5;
          break;
        case 'Small cases':
          baseValue = 1 + Math.cos(i / 3) * 1 + Math.random() * 2;
          break;
        case 'USA - Immigration':
          baseValue = 2 + Math.sin(i / 4) * 1.5 + Math.random() * 1;
          break;
        case 'Immigration to Israel':
          baseValue = 4 + Math.cos(i / 6) * 2 + Math.random() * 2;
          break;
        case 'Austria and Germany':
          baseValue = 15 + Math.sin(i / 7) * 5 + Math.random() * 3;
          break;
        default:
          baseValue = Math.random() * 5;
      }
      
      return {
        date: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        fullDate: date.toLocaleDateString(),
        contracts: Math.max(0, Math.round(baseValue))
      };
    });
    return data;
  };

  // Handle card flip
  const handleCardFlip = (category: string) => {
    setFlippedCards(prev => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  };

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
    { category: 'Austria and Germany', signed: 1505920, due: 1700000 },
  ];
  const scoreboardBarData30d = [
    { category: 'General', signed: 0, due: 0 },
    { category: 'Commercial & Civil', signed: 113629, due: 130000 },
    { category: 'Small cases', signed: 47920, due: 50000 },
    { category: 'USA - Immigration', signed: 109675, due: 80000 },
    { category: 'Immigration to Israel', signed: 166332, due: 90000 },
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

  // 2. Add effect to fetch real signed leads when showLeadsList is true
  useEffect(() => {
    if (!showLeadsList) return;
    setRealLeadsLoading(true);
    // Stages considered as 'signed' or after
    const signedStages = [
      'Client signed agreement',
      'payment_request_sent',
      'finances_and_payments_plan',
      'Success',
      'client_signed',
      'Mtng sum+Agreement sent',
    ];
    (async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('id, lead_number, name, topic, expert, proposal_total, proposal_currency, date_signed, created_at, stage')
        .in('stage', signedStages)
        .order('date_signed', { ascending: false })
        .order('created_at', { ascending: false });
      if (!error && data) setRealSignedLeads(data);
      else setRealSignedLeads([]);
      setRealLeadsLoading(false);
    })();
  }, [showLeadsList]);

  // 2. Add effect to fetch real overdue leads when expanded === 'overdue'
  useEffect(() => {
    if (expanded !== 'overdue') return;
    
    const fetchOverdueLeads = async () => {
      setOverdueLeadsLoading(true);
      try {
        const today = new Date().toISOString().split('T')[0];
        const { data, error } = await supabase
          .from('leads')
          .select('*')
          .lte('next_followup', today)
          .not('next_followup', 'is', null);

        if (error) throw error;
        setRealOverdueLeads(data || []);
      } catch (error) {
        console.error("Error fetching overdue leads:", error);
        setRealOverdueLeads([]);
      } finally {
        setOverdueLeadsLoading(false);
      }
    };

    fetchOverdueLeads();
  }, [expanded]);

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
          className="rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-[#4b2996] via-[#6c4edb] to-[#3b28c7] text-white relative overflow-hidden p-3 md:p-6"
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
          {/* Desktop Table View */}
          <div className="hidden md:block">
            <Meetings />
          </div>
          {/* Mobile Card View (REAL DATA) */}
          <div className="md:hidden">
            <div className="space-y-4">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Today's Meetings</h3>
              {meetingsLoading ? (
                <div className="text-center py-8 text-base-content/70">Loading...</div>
              ) : todayMeetings.length === 0 ? (
                <div className="text-center py-8 text-base-content/70">No meetings scheduled for today</div>
              ) : (
              <div className="grid grid-cols-1 gap-4">
                  {todayMeetings.map((meeting, index) => (
                    <div key={meeting.id} className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 border border-gray-100 group flex flex-col justify-between h-full min-h-[340px] relative pb-16">
                    <div className="flex-1 cursor-pointer flex flex-col">
                      {/* Lead Number and Name */}
                      <div className="mb-3 flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-400 tracking-widest">{meeting.lead}</span>
                        <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                        <h3 className="text-lg font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{meeting.name}</h3>
                      </div>
                      {/* Stage */}
                      <div className="flex justify-between items-center py-1">
                        <span className="text-xs font-semibold text-gray-500">Stage</span>
                        <span className="text-xs font-bold ml-2 px-2 py-1 rounded bg-[#3b28c7] text-white">
                            {meeting.stage ? meeting.stage.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) : 'Meeting Scheduled'}
                        </span>
                      </div>
                      <div className="space-y-2 divide-y divide-gray-100">
                        {/* Time */}
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs font-semibold text-gray-500">Time</span>
                          <span className="text-sm font-bold text-gray-800">{meeting.time}</span>
                        </div>
                        {/* Manager */}
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs font-semibold text-gray-500">Manager</span>
                          <span className="text-sm font-bold text-gray-800">{meeting.manager}</span>
                        </div>
                          {/* Topic */}
                        <div className="flex justify-between items-center py-1">
                            <span className="text-xs font-semibold text-gray-500">Topic</span>
                            <span className="text-sm font-bold text-gray-800">{meeting.topic}</span>
                        </div>
                        {/* Amount */}
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs font-semibold text-gray-500">Amount</span>
                            <span className="text-sm font-bold text-green-600">{meeting.value}</span>
                        </div>
                        {/* Expert */}
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs font-semibold text-gray-500">Expert</span>
                          <span className="text-sm font-bold text-gray-800">{meeting.expert}</span>
                        </div>
                        {/* Location */}
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs font-semibold text-gray-500">Location</span>
                          <span className="text-sm font-bold text-gray-800">{meeting.location}</span>
                        </div>
                        </div>
                      </div>
                    {/* Action Buttons */}
                      <div className="absolute bottom-4 left-4 right-4">
                        {/* Join Meeting (Teams) */}
                        <a
                          className={`btn btn-primary btn-sm w-full${!getValidTeamsLink(meeting.link) ? ' pointer-events-none opacity-50' : ''}`}
                          href={getValidTeamsLink(meeting.link) || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                        <VideoCameraIcon className="w-4 h-4" />
                        Join Meeting
                        </a>
                    </div>
                  </div>
                ))}
              </div>
              )}
            </div>
          </div>
        </div>
      )}
      {expanded === 'overdue' && (
        <div className="glass-card mt-4 animate-fade-in">
          <div className="font-bold text-lg mb-4 text-base-content/80">Overdue Follow-ups</div>
          {overdueLeadsLoading ? (
            <div className="flex justify-center items-center py-12">
              <span className="loading loading-spinner loading-lg text-primary"></span>
            </div>
          ) : (
            <>
              {/* Desktop Card Grid View */}
              <div className="hidden md:grid grid-cols-2 lg:grid-cols-3 gap-6">
                {realOverdueLeads.length === 0 ? (
                  <div className="col-span-full text-center py-12 text-gray-500">
                    No overdue follow-ups. Great job!
                  </div>
                ) : (
                  realOverdueLeads.map((lead, index) => {
                    const daysOverdue = lead.next_followup ? Math.floor((new Date().getTime() - new Date(lead.next_followup).getTime()) / (1000 * 3600 * 24)) : 0;
                    return (
                      <div key={lead.id} className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 border border-red-100 group flex flex-col justify-between min-h-[340px] relative">
                        <div className="flex-1 flex flex-col">
                          {/* Lead Number and Name */}
                          <div className="mb-3 flex items-center gap-2">
                            <span className="text-xs font-semibold text-gray-400 tracking-widest">{lead.lead_number}</span>
                            <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                            <h3 className="text-lg font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{lead.name}</h3>
                            <span className="text-xs font-bold px-2 py-1 rounded bg-[#3b28c7] text-white">{daysOverdue} days overdue</span>
                          </div>
                          {/* Stage */}
                          <div className="flex justify-between items-center py-1">
                            <span className="text-xs font-semibold text-gray-500">Stage</span>
                            <span className="text-xs font-bold text-black">Follow-up Required</span>
                          </div>
                          <div className="space-y-2 divide-y divide-gray-100 mt-2">
                            {/* Category */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-xs font-semibold text-gray-500">Category</span>
                              <span className="text-xs font-bold text-gray-800">{lead.category || 'Not specified'}</span>
                            </div>
                            {/* Topic */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-xs font-semibold text-gray-500">Topic</span>
                              <span className="text-xs font-bold text-gray-800">{lead.topic || 'Not specified'}</span>
                            </div>
                            {/* Expert */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-xs font-semibold text-gray-500">Expert</span>
                              <span className="text-xs font-bold text-gray-800">{lead.expert || 'Not assigned'}</span>
                            </div>
                            {/* Amount */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-xs font-semibold text-gray-500">Amount</span>
                              <span className="text-xs font-bold text-gray-800">
                                {lead.balance_currency || '₪'}{(lead.balance || 0).toLocaleString()}
                              </span>
                            </div>
                            {/* Manager */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-xs font-semibold text-gray-500">Manager</span>
                              <span className="text-xs font-bold text-gray-800">{lead.manager || 'Not assigned'}</span>
                            </div>
                            {/* Probability */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-xs font-semibold text-gray-500">Probability</span>
                              <span className="text-xs font-bold text-gray-800">{lead.probability || 0}%</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              {/* Mobile Card View */}
              <div className="md:hidden space-y-4">
                {realOverdueLeads.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    No overdue follow-ups. Great job!
                  </div>
                ) : (
                  realOverdueLeads.map((lead, index) => {
                    const daysOverdue = lead.next_followup ? Math.floor((new Date().getTime() - new Date(lead.next_followup).getTime()) / (1000 * 3600 * 24)) : 0;
                    return (
                      <div key={lead.id} className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 border border-red-100 group flex flex-col justify-between min-h-[340px] relative">
                        <div className="flex-1 flex flex-col">
                          {/* Lead Number and Name */}
                          <div className="mb-3 flex items-center gap-2">
                            <span className="text-xs font-semibold text-gray-400 tracking-widest">{lead.lead_number}</span>
                            <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                            <h3 className="text-lg font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{lead.name}</h3>
                            <span className="text-xs font-bold px-2 py-1 rounded bg-[#3b28c7] text-white">{daysOverdue} days overdue</span>
                          </div>
                          {/* Stage */}
                          <div className="flex justify-between items-center py-1">
                            <span className="text-xs font-semibold text-gray-500">Stage</span>
                            <span className="text-xs font-bold text-black">Follow-up Required</span>
                          </div>
                          <div className="space-y-2 divide-y divide-gray-100 mt-2">
                            {/* Category */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-xs font-semibold text-gray-500">Category</span>
                              <span className="text-xs font-bold text-gray-800">{lead.category || 'Not specified'}</span>
                            </div>
                            {/* Topic */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-xs font-semibold text-gray-500">Topic</span>
                              <span className="text-xs font-bold text-gray-800">{lead.topic || 'Not specified'}</span>
                            </div>
                            {/* Expert */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-xs font-semibold text-gray-500">Expert</span>
                              <span className="text-xs font-bold text-gray-800">{lead.expert || 'Not assigned'}</span>
                            </div>
                            {/* Amount */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-xs font-semibold text-gray-500">Amount</span>
                              <span className="text-xs font-bold text-gray-800">
                                {lead.balance_currency || '₪'}{(lead.balance || 0).toLocaleString()}
                              </span>
                            </div>
                            {/* Manager */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-xs font-semibold text-gray-500">Manager</span>
                              <span className="text-xs font-bold text-gray-800">{lead.manager || 'Not assigned'}</span>
                            </div>
                            {/* Probability */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-xs font-semibold text-gray-500">Probability</span>
                              <span className="text-xs font-bold text-gray-800">{lead.probability || 0}%</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
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
      <div className="flex flex-col md:flex-row gap-8 mb-10 w-full" style={{ alignItems: 'stretch' }}>
        {/* AI Suggestions Box */}
        <div ref={aiRef} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-lg flex flex-col w-full md:w-1/5">
          <AISuggestions />
        </div>
        {/* Professional CRM Scoreboard */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-lg flex flex-col justify-between w-full md:w-4/5">
          <div className="w-full relative overflow-hidden">
            <div className="card-body p-8">
              {/* Header with gradient background */}
              <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8 gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 shadow-lg">
                    <ChartBarIcon className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <h2 className="text-3xl font-bold text-gray-900">Performance Dashboard</h2>
                    <p className="text-gray-600 text-sm mt-1">Real-time sales metrics and analytics</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="tabs tabs-boxed bg-gray-100 shadow-inner rounded-xl p-1 border border-gray-200">
                    {scoreboardTabs.map(tab => (
                      <a
                        key={tab}
                        className={`tab text-sm font-semibold px-4 py-2 rounded-lg transition-all ${scoreTab === tab ? 'tab-active bg-white text-purple-600 shadow-sm border border-purple-200' : 'text-gray-600 hover:bg-gray-50'}`}
                        onClick={() => setScoreTab(tab)}
                      >
                        {tab}
                      </a>
                    ))}
                  </div>
                </div>
              </div>

              {/* Performance Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2 bg-purple-50 rounded-lg">
                      <UserGroupIcon className="w-5 h-5 text-purple-600" />
                    </div>
                    <span className="text-2xl font-bold text-gray-900">142</span>
                  </div>
                  <div className="text-sm text-gray-700 font-medium">Total Leads</div>
                  <div className="text-xs text-gray-500 mt-1">+12% from last month</div>
                </div>
                
                <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2 bg-purple-50 rounded-lg">
                      <CheckCircleIcon className="w-5 h-5 text-purple-600" />
                    </div>
                    <span className="text-2xl font-bold text-gray-900">89</span>
                  </div>
                  <div className="text-sm text-gray-700 font-medium">Conversions</div>
                  <div className="text-xs text-gray-500 mt-1">62.7% conversion rate</div>
                </div>
                
                <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2 bg-purple-50 rounded-lg">
                      <ArrowTrendingUpIcon className="w-5 h-5 text-purple-600" />
                    </div>
                    <span className="text-2xl font-bold text-gray-900">₪487K</span>
                  </div>
                  <div className="text-sm text-gray-700 font-medium">Revenue</div>
                  <div className="text-xs text-gray-500 mt-1">+18% from target</div>
                </div>
                
                <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2 bg-purple-50 rounded-lg">
                      <ClockIcon className="w-5 h-5 text-purple-600" />
                    </div>
                    <span className="text-2xl font-bold text-gray-900">23</span>
                  </div>
                  <div className="text-sm text-gray-700 font-medium">Pending</div>
                  <div className="text-xs text-gray-500 mt-1">Require follow-up</div>
                </div>
              </div>

              {/* Department Performance Boxes */}
              {scoreTab === 'Tables' && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-gradient-to-br from-purple-100 to-indigo-100 rounded-lg border border-purple-200">
                      <ChartBarIcon className="w-5 h-5 text-purple-600" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-800">Department Performance</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {scoreboardCategories.map((category, index) => {
                                            const todayData = scoreboardData["Today"][index];
                      const last30Data = scoreboardData["Last 30d"][index];
                      const isFlipped = flippedCards.has(category);
                      const chartData = generateDepartmentData(category);
                      
                      return (
                        <div key={category} className="relative h-64" style={{ perspective: '1000px' }}>
                          <div 
                            className="relative w-full h-full transition-transform duration-700 cursor-pointer"
                            style={{ 
                              transformStyle: 'preserve-3d',
                              transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)'
                            }}
                            onClick={() => handleCardFlip(category)}
                          >
                            {/* Front of card */}
                            <div 
                              className="absolute inset-0 bg-white rounded-xl border border-gray-200 shadow-lg hover:shadow-2xl hover:scale-[1.02] transition-all duration-300 overflow-hidden group"
                              style={{ 
                                backfaceVisibility: 'hidden',
                                transform: 'rotateY(0deg)'
                              }}
                            >
                              {/* Header */}
                              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 group-hover:bg-gradient-to-r group-hover:from-purple-50 group-hover:to-indigo-50 transition-all duration-300">
                                <h4 className="text-sm font-semibold text-slate-800 text-center group-hover:text-purple-800 transition-colors duration-300">{category}</h4>
                              </div>
                              
                              {/* Content */}
                              <div className="p-4">
                                {/* Horizontal Stats Layout */}
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                  {/* Today Stats - Left */}
                                  <div className="bg-slate-50 rounded-lg p-3 group-hover:bg-slate-100 transition-all duration-300 hover:shadow-md">
                                    <div className="flex items-center gap-2 mb-2">
                                      <div className="w-2 h-2 bg-indigo-500 rounded-full group-hover:scale-125 transition-transform duration-300"></div>
                                      <span className="text-xs font-medium text-slate-600 group-hover:text-indigo-700 transition-colors duration-300">Today</span>
                                    </div>
                                    <div className="space-y-1">
                                      <div className="text-lg font-bold text-slate-800 group-hover:text-indigo-800 transition-colors duration-300">{todayData.count}</div>
                                      <div className="text-xs font-medium text-slate-600 group-hover:text-indigo-600 transition-colors duration-300">₪{todayData.amount ? todayData.amount.toLocaleString() : '0'}</div>
                                      {todayData.expected > 0 && (
                                        <div className="text-xs text-slate-500 group-hover:text-indigo-500 transition-colors duration-300">
                                          Target: {todayData.expected.toLocaleString()}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  
                                  {/* Last 30 Days Stats - Right */}
                                  <div className="bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg p-3 border border-purple-400 group-hover:from-purple-600 group-hover:to-indigo-700 group-hover:border-purple-500 transition-all duration-300 hover:shadow-md">
                                    <div className="flex items-center gap-2 mb-2">
                                      <div className="w-2 h-2 bg-white rounded-full group-hover:scale-125 transition-transform duration-300"></div>
                                      <span className="text-xs font-medium text-white group-hover:text-white transition-colors duration-300">Last 30d</span>
                                    </div>
                                    <div className="space-y-1">
                                      <div className="text-lg font-bold text-white group-hover:text-white transition-colors duration-300">{last30Data.count}</div>
                                      <div className="text-xs font-medium text-white/90 group-hover:text-white transition-colors duration-300">₪{last30Data.amount ? last30Data.amount.toLocaleString() : '0'}</div>
                                      {last30Data.expected > 0 && (
                                        <div className="text-xs text-white/80 group-hover:text-white/90 transition-colors duration-300">
                                          Target: {last30Data.expected.toLocaleString()}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                
                                {/* Performance Indicator */}
                                {last30Data.amount > 0 && (
                                  <div className="pt-2 border-t border-slate-100 group-hover:border-purple-200 transition-colors duration-300">
                                    <div className="flex justify-between items-center">
                                      <span className="text-xs text-slate-500 group-hover:text-purple-600 transition-colors duration-300">Performance</span>
                                      <div className={`text-xs font-medium px-2 py-1 rounded-full transition-all duration-300 hover:scale-105 ${
                                        last30Data.amount >= last30Data.expected 
                                          ? 'bg-green-100 text-green-700 group-hover:bg-green-200 group-hover:shadow-sm' 
                                          : last30Data.amount >= last30Data.expected * 0.8
                                          ? 'bg-yellow-100 text-yellow-700 group-hover:bg-yellow-200 group-hover:shadow-sm'
                                          : 'bg-red-100 text-red-700 group-hover:bg-red-200 group-hover:shadow-sm'
                                      }`}>
                                        {last30Data.expected > 0 
                                          ? `${Math.round((last30Data.amount / last30Data.expected) * 100)}%`
                                          : 'N/A'
                                        }
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                              
                              {/* Click hint */}
                              <div className="absolute bottom-2 right-2 text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                Click to view trends
                              </div>
                            </div>

                            {/* Back of card */}
                            <div 
                              className="absolute inset-0 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl border border-purple-300 shadow-lg overflow-hidden"
                              style={{ 
                                backfaceVisibility: 'hidden',
                                transform: 'rotateY(180deg)'
                              }}
                            >
                              {/* Header */}
                              <div className="px-4 py-3 bg-white/10 border-b border-white/20 backdrop-blur-sm">
                                <h4 className="text-sm font-semibold text-white text-center">{category} - 30 Day Trend</h4>
                              </div>
                              
                              {/* Chart */}
                              <div className="p-4 h-full">
                                <div className="w-full h-40">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                                      <XAxis 
                                        dataKey="date" 
                                        tick={{ fontSize: 10, fill: 'white' }} 
                                        axisLine={{ stroke: 'white', strokeWidth: 1 }} 
                                        tickLine={{ stroke: 'white' }}
                                        interval={5}
                                      />
                                      <YAxis 
                                        tick={{ fontSize: 10, fill: 'white' }} 
                                        axisLine={{ stroke: 'white', strokeWidth: 1 }} 
                                        tickLine={{ stroke: 'white' }}
                                        width={25}
                                      />
                                                                             <Tooltip
                                         contentStyle={{ 
                                           background: 'rgba(255,255,255,0.98)', 
                                           borderRadius: 12, 
                                           border: '1px solid #e5e7eb',
                                           boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                                           fontSize: 13,
                                           fontWeight: 500,
                                           padding: '12px 16px'
                                         }}
                                         labelStyle={{ 
                                           color: '#374151', 
                                           fontWeight: 'bold', 
                                           fontSize: 14, 
                                           marginBottom: 8 
                                         }}
                                         itemStyle={{ 
                                           color: '#6366f1', 
                                           fontSize: 13, 
                                           fontWeight: 600 
                                         }}
                                         labelFormatter={(label) => {
                                           const dataPoint = chartData.find(d => d.date === label);
                                           return dataPoint ? `Date: ${dataPoint.fullDate}` : `Date: ${label}`;
                                         }}
                                         formatter={(value: number, name: string) => [
                                           `${value} ${value === 1 ? 'contract' : 'contracts'}`, 
                                           'Contracts Signed'
                                         ]}
                                         cursor={{ stroke: 'rgba(255,255,255,0.3)', strokeWidth: 2 }}
                                         animationDuration={200}
                                       />
                                      <Line 
                                        type="monotone" 
                                        dataKey="contracts" 
                                        stroke="#ffffff" 
                                        strokeWidth={3}
                                        dot={{ fill: '#ffffff', stroke: '#ffffff', strokeWidth: 2, r: 3 }}
                                        activeDot={{ r: 5, fill: '#fbbf24', stroke: '#ffffff', strokeWidth: 2 }}
                                      />
                                    </LineChart>
                                  </ResponsiveContainer>
                                </div>
                                
                                {/* Stats summary */}
                                <div className="mt-2 text-white text-xs">
                                  <div className="flex justify-between">
                                    <span>Total: {chartData.reduce((sum, d) => sum + d.contracts, 0)} contracts</span>
                                    <span>Avg: {Math.round(chartData.reduce((sum, d) => sum + d.contracts, 0) / chartData.length)} per day</span>
                                  </div>
                                </div>
                                                             </div>
                             </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Professional Chart Visualization */}
              {(scoreTab === 'Today' || scoreTab === currentMonthName || scoreTab === 'Last 30d') && (
                <div className="bg-gradient-to-br from-gray-50 to-white rounded-2xl border border-gray-200 p-8 shadow-lg">
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                      <div className="p-3 bg-gradient-to-r from-purple-600 to-indigo-600 rounded-xl shadow-lg">
                        <ChartBarIcon className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-gray-900">Performance Analytics</h3>
                        <p className="text-sm text-gray-600">Real-time business metrics</p>
                      </div>
                    </div>
                    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
                      <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 bg-gradient-to-r from-purple-600 to-purple-700 rounded-full shadow-sm"></div>
                          <span className="text-sm font-medium text-gray-700">Signed</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full shadow-sm"></div>
                          <span className="text-sm font-medium text-gray-700">Due</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
                    <div className="w-full h-[450px]">
                      {(() => {
                        const chartData = scoreTab === 'Today' ? scoreboardBarDataToday : scoreTab === 'June' || scoreTab === currentMonthName ? scoreboardBarDataJune : scoreboardBarData30d;
                        return (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={chartData}
                              barCategoryGap={16}
                              margin={{ top: 30, right: 30, left: 20, bottom: 40 }}
                            >
                              <defs>
                                <linearGradient id="signedGradient" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.8}/>
                                  <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.9}/>
                                </linearGradient>
                                <linearGradient id="dueGradient" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.8}/>
                                  <stop offset="100%" stopColor="#0891b2" stopOpacity={0.9}/>
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="2 2" stroke="#e5e7eb" opacity={0.3} />
                              <XAxis 
                                dataKey="category" 
                                tick={{ fontSize: 11, fill: '#4b5563', fontWeight: '500' }} 
                                axisLine={{ stroke: '#d1d5db', strokeWidth: 1 }} 
                                tickLine={{ stroke: '#d1d5db', strokeWidth: 1 }} 
                                tickMargin={12}
                                interval={0}
                              />
                              <YAxis 
                                tick={{ fontSize: 12, fill: '#4b5563' }} 
                                axisLine={{ stroke: '#d1d5db', strokeWidth: 1 }} 
                                tickLine={{ stroke: '#d1d5db', strokeWidth: 1 }} 
                                width={45}
                                tickMargin={8}
                              />
                              <Tooltip
                                contentStyle={{ 
                                  background: 'rgba(255,255,255,0.98)', 
                                  borderRadius: 16, 
                                  border: '1px solid #e5e7eb',
                                  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                                  padding: '12px 16px'
                                }}
                                labelStyle={{ color: '#111827', fontWeight: 'bold', fontSize: '14px', marginBottom: '8px' }}
                                itemStyle={{ color: '#374151', fontSize: '13px', fontWeight: '500' }}
                                formatter={(value: number, name: string) => {
                                  if (name === 'signed') return [`${value.toLocaleString()} contracts`, 'Signed'];
                                  if (name === 'due') return [`${value.toLocaleString()} contracts`, 'Due'];
                                  return [value.toLocaleString(), name || 'Unknown'];
                                }}
                                cursor={{ fill: 'rgba(0, 0, 0, 0.05)' }}
                              />
                              <Bar 
                                dataKey="signed" 
                                name="signed" 
                                fill="url(#signedGradient)"
                                radius={[8, 8, 0, 0]} 
                                barSize={28}
                                stroke="#7c3aed"
                                strokeWidth={1}
                                strokeOpacity={0.3}
                              />
                              <Bar 
                                dataKey="due" 
                                name="due" 
                                fill="url(#dueGradient)"
                                radius={[8, 8, 0, 0]} 
                                barSize={28}
                                stroke="#0891b2"
                                strokeWidth={1}
                                strokeOpacity={0.3}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        );
                      })()}
                    </div>
                  </div>
                  
                  {/* Chart Statistics */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                    <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 bg-purple-600 rounded-full"></div>
                        <span className="text-sm font-medium text-gray-600">Total Signed</span>
                      </div>
                      <div className="text-2xl font-bold text-gray-900">
                        {(() => {
                          const data = scoreTab === 'Today' ? scoreboardBarDataToday : scoreTab === 'June' || scoreTab === currentMonthName ? scoreboardBarDataJune : scoreboardBarData30d;
                          return data.reduce((sum, item) => sum + item.signed, 0);
                        })()}
                      </div>
                    </div>
                    <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 bg-cyan-500 rounded-full"></div>
                        <span className="text-sm font-medium text-gray-600">Total Due</span>
                      </div>
                      <div className="text-2xl font-bold text-gray-900">
                        {(() => {
                          const data = scoreTab === 'Today' ? scoreboardBarDataToday : scoreTab === 'June' || scoreTab === currentMonthName ? scoreboardBarDataJune : scoreboardBarData30d;
                          return data.reduce((sum, item) => sum + item.due, 0);
                        })()}
                      </div>
                    </div>
                    <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                        <span className="text-sm font-medium text-gray-600">Conversion Rate</span>
                      </div>
                      <div className="text-2xl font-bold text-gray-900">
                        {(() => {
                          const data = scoreTab === 'Today' ? scoreboardBarDataToday : scoreTab === 'June' || scoreTab === currentMonthName ? scoreboardBarDataJune : scoreboardBarData30d;
                          const signed = data.reduce((sum, item) => sum + item.signed, 0);
                          const due = data.reduce((sum, item) => sum + item.due, 0);
                          const total = signed + due;
                          return total > 0 ? `${Math.round((signed / total) * 100)}%` : '0%';
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Quick Actions */}
              <div className="flex flex-wrap gap-3 mt-6">
                <button className="btn btn-sm bg-gradient-to-r from-purple-600 to-indigo-600 text-white border-none hover:from-purple-700 hover:to-indigo-700 shadow-lg">
                  <PlusIcon className="w-4 h-4 mr-2" />
                  New Lead
                </button>
                <button className="btn btn-sm bg-gradient-to-r from-blue-500 to-cyan-500 text-white border-none hover:from-blue-600 hover:to-cyan-600 shadow-lg">
                  <MagnifyingGlassIcon className="w-4 h-4 mr-2" />
                  Search
                </button>
                <button className="btn btn-sm bg-gradient-to-r from-green-500 to-teal-500 text-white border-none hover:from-green-600 hover:to-teal-600 shadow-lg">
                  <ArrowPathIcon className="w-4 h-4 mr-2" />
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Top Workers Row: 4 boxes */}
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6 w-full mb-12">
        {/* Top Closers */}
        <div className="rounded-2xl p-3 md:p-8 flex flex-col items-center shadow-lg border border-white/20 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white h-full min-h-[180px] md:min-h-0">
          <div className="flex items-center gap-2 mb-2">
            <UserGroupIcon className="w-5 h-5 md:w-6 md:h-6 text-white opacity-90" />
            <span className="text-sm md:text-base font-bold text-white drop-shadow">Top Closers</span>
          </div>
          <div className="w-full flex flex-col gap-2 mt-1 flex-1">
            {[
              { name: 'MiriamL', count: 12, movement: 'up' },
              { name: 'YehonatanD', count: 9, movement: 'down' },
              { name: 'Isaac', count: 7, movement: 'none' },
            ].map((user, idx) => (
              <div key={user.name} className="flex items-center gap-2 w-full">
                <div className="flex items-center gap-1">
                  {user.movement === 'up' && (
                    <svg className="w-3 h-3 md:w-4 md:h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M10 16V4m0 0l-5 5m5-5l5 5" /></svg>
                  )}
                  {user.movement === 'down' && (
                    <svg className="w-3 h-3 md:w-4 md:h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M10 4v12m0 0l-5-5m5 5l5-5" /></svg>
                  )}
                  {user.movement === 'none' && (
                    <svg className="w-3 h-3 md:w-4 md:h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M6 10h8" /></svg>
                  )}
                  <div className={`w-6 h-6 md:w-7 md:h-7 rounded-full flex items-center justify-center font-bold text-sm md:text-base shadow-lg bg-white/20 text-white`}>{user.name[0]}</div>
                </div>
                <div className="flex-1">
                  <span className="font-semibold text-white text-base md:text-xl">{user.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-2xl md:text-3xl font-bold text-white">{user.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Top Schedulers */}
        <div className="rounded-2xl p-3 md:p-8 flex flex-col items-center shadow-lg border border-white/20 bg-gradient-to-tr from-purple-600 via-blue-600 to-blue-500 text-white h-full min-h-[180px] md:min-h-0">
          <div className="flex items-center gap-2 mb-2">
            <CalendarIcon className="w-5 h-5 md:w-6 md:h-6 text-white opacity-90" />
            <span className="text-sm md:text-base font-bold text-white drop-shadow">Top Schedulers</span>
          </div>
          <div className="w-full flex flex-col gap-2 mt-1 flex-1">
            {[
              { name: 'Anna Zh', count: 15, movement: 'up' },
              { name: 'MichaelW', count: 11, movement: 'down' },
              { name: 'Isaac', count: 8, movement: 'none' },
            ].map((user, idx) => (
              <div key={user.name} className="flex items-center gap-2 w-full">
                <div className="flex items-center gap-1">
                  {user.movement === 'up' && (
                    <svg className="w-3 h-3 md:w-4 md:h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M10 16V4m0 0l-5 5m5-5l5 5" /></svg>
                  )}
                  {user.movement === 'down' && (
                    <svg className="w-3 h-3 md:w-4 md:h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M10 4v12m0 0l-5-5m5 5l5-5" /></svg>
                  )}
                  {user.movement === 'none' && (
                    <svg className="w-3 h-3 md:w-4 md:h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M6 10h8" /></svg>
                  )}
                  <div className={`w-6 h-6 md:w-7 md:h-7 rounded-full flex items-center justify-center font-bold text-sm md:text-base shadow-lg bg-white/20 text-white`}>{user.name[0]}</div>
                </div>
                <div className="flex-1">
                  <span className="font-semibold text-white text-base md:text-xl">{user.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-2xl md:text-3xl font-bold text-white">{user.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Top Experts */}
        <div className="rounded-2xl p-3 md:p-8 flex flex-col items-center shadow-lg border border-white/20 bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white h-full min-h-[180px] md:min-h-0">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-5 h-5 md:w-6 md:h-6 text-white opacity-90" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 14l9-5-9-5-9 5 9 5z" /><path d="M12 14l6.16-3.422A12.083 12.083 0 0112 21.5a12.083 12.083 0 01-6.16-10.922L12 14z" /></svg>
            <span className="text-sm md:text-base font-bold text-white drop-shadow">Top Experts</span>
          </div>
          <div className="w-full flex flex-col gap-2 mt-1 flex-1">
            {[
              { name: 'Kyrill', count: 10, movement: 'down' },
              { name: 'Ido', count: 8, movement: 'up' },
              { name: 'YaelG', count: 6, movement: 'none' },
            ].map((user, idx) => (
              <div key={user.name} className="flex items-center gap-2 w-full">
                <div className="flex items-center gap-1">
                  {user.movement === 'up' && (
                    <svg className="w-3 h-3 md:w-4 md:h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M10 16V4m0 0l-5 5m5-5l5 5" /></svg>
                  )}
                  {user.movement === 'down' && (
                    <svg className="w-3 h-3 md:w-4 md:h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M10 4v12m0 0l-5-5m5 5l5-5" /></svg>
                  )}
                  {user.movement === 'none' && (
                    <svg className="w-3 h-3 md:w-4 md:h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M6 10h8" /></svg>
                  )}
                  <div className={`w-6 h-6 md:w-7 md:h-7 rounded-full flex items-center justify-center font-bold text-sm md:text-base shadow-lg bg-white/20 text-white`}>{user.name[0]}</div>
                </div>
                <div className="flex-1">
                  <span className="font-semibold text-white text-base md:text-xl">{user.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-2xl md:text-3xl font-bold text-white">{user.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Top Handler */}
        <div className="rounded-2xl p-3 md:p-8 flex flex-col items-center shadow-lg border border-white/20 bg-gradient-to-tr from-[#4b2996] via-[#6c4edb] to-[#3b28c7] text-white h-full min-h-[180px] md:min-h-0">
          <div className="flex items-center gap-2 mb-2">
            <UserGroupIcon className="w-5 h-5 md:w-6 md:h-6 text-white opacity-90" />
            <span className="text-sm md:text-base font-bold text-white drop-shadow">Top Handlers</span>
          </div>
          <div className="w-full flex flex-col gap-2 mt-1 flex-1">
            {[
              { name: 'Caroline', count: 7, movement: 'up' },
              { name: 'Lena', count: 6, movement: 'down' },
              { name: 'Lior', count: 5, movement: 'none' },
            ].map((user, idx) => (
              <div key={user.name} className="flex items-center gap-2 w-full">
                <div className="flex items-center gap-1">
                  {user.movement === 'up' && (
                    <svg className="w-3 h-3 md:w-4 md:h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M10 16V4m0 0l-5 5m5-5l5 5" /></svg>
                  )}
                  {user.movement === 'down' && (
                    <svg className="w-3 h-3 md:w-4 md:h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M10 4v12m0 0l-5-5m5 5l5-5" /></svg>
                  )}
                  {user.movement === 'none' && (
                    <svg className="w-3 h-3 md:w-4 md:h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 20 20"><path strokeLinecap="round" strokeLinejoin="round" d="M6 10h8" /></svg>
                  )}
                  <div className={`w-6 h-6 md:w-7 md:h-7 rounded-full flex items-center justify-center font-bold text-sm md:text-base shadow-lg bg-white/20 text-white`}>{user.name[0]}</div>
                </div>
                <div className="flex-1">
                  <span className="font-semibold text-white text-base md:text-xl">{user.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-2xl md:text-3xl font-bold text-white">{user.count}</span>
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
          <div className="font-bold text-lg mb-4 text-base-content/80">My Signed Leads</div>
          {realLeadsLoading ? (
            <div className="flex justify-center items-center py-12"><span className="loading loading-spinner loading-lg text-primary"></span></div>
          ) : (
            <>
              {/* Desktop Card Grid View */}
              <div className="hidden md:grid grid-cols-2 lg:grid-cols-3 gap-6">
                {realSignedLeads.map((lead, idx) => (
                  <div
                    key={lead.id}
                    className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 border border-gray-100 group flex flex-col justify-between h-full min-h-[340px] relative"
              >
                <div className="flex-1 flex flex-col">
                  {/* Lead Number and Name */}
                  <div className="mb-3 flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-400 tracking-widest">{lead.lead_number}</span>
                    <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                        <h3 className="text-lg font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{lead.name}</h3>
                      </div>
                      {/* Stage */}
                      <div className="flex justify-between items-center py-1">
                        <span className="text-xs font-semibold text-gray-500">Stage</span>
                        <span className="text-xs font-bold ml-2 px-2 py-1 rounded bg-[#3b28c7] text-white">
                          {lead.stage}
                        </span>
                      </div>
                      <div className="space-y-2 divide-y divide-gray-100 mt-2">
                        {/* Topic */}
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs font-semibold text-gray-500">Topic</span>
                          <span className="badge badge-outline text-sm font-bold text-gray-800">{lead.topic}</span>
                        </div>
                        {/* Expert */}
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs font-semibold text-gray-500">Expert</span>
                          <span className="text-sm font-bold text-gray-800">{lead.expert}</span>
                        </div>
                        {/* Amount */}
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs font-semibold text-gray-500">Amount</span>
                          <span className="text-sm font-bold text-green-600">{lead.proposal_currency || '₪'}{lead.proposal_total ? Number(lead.proposal_total).toLocaleString() : ''}</span>
                        </div>
                        {/* Signed Date */}
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs font-semibold text-gray-500">Signed Date</span>
                          <span className="text-sm font-bold text-gray-800">{lead.date_signed ? new Date(lead.date_signed).toLocaleDateString() : (lead.created_at ? new Date(lead.created_at).toLocaleDateString() : '--')}</span>
                        </div>
                      </div>
                    </div>
                    {/* View Lead Button */}
                    <a
                      href={`/clients/${lead.lead_number}`}
                      className="btn btn-sm btn-outline border-[#3b28c7] text-[#3b28c7] font-bold mt-4 self-end hover:bg-[#3b28c7]/10 hover:border-[#3b28c7] transition-colors"
                      style={{ borderWidth: 2 }}
                    >
                      View Lead
                    </a>
                  </div>
                ))}
              </div>
              {/* Mobile Card View */}
              <div className="md:hidden flex flex-col gap-6">
                {realSignedLeads.map((lead, idx) => (
                  <div
                    key={lead.id}
                    className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 border border-gray-100 group flex flex-col justify-between min-h-[340px] relative"
                  >
                    <div className="flex-1 flex flex-col">
                      {/* Lead Number and Name */}
                      <div className="mb-3 flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-400 tracking-widest">{lead.lead_number}</span>
                        <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                        <h3 className="text-lg font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{lead.name}</h3>
                      </div>
                      {/* Stage */}
                      <div className="flex justify-between items-center py-1">
                        <span className="text-xs font-semibold text-gray-500">Stage</span>
                        <span className="text-xs font-bold ml-2 px-2 py-1 rounded bg-[#3b28c7] text-white">
                          {lead.stage}
                        </span>
                      </div>
                      <div className="space-y-2 divide-y divide-gray-100 mt-2">
                        {/* Topic */}
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs font-semibold text-gray-500">Topic</span>
                          <span className="badge badge-outline text-sm font-bold text-gray-800">{lead.topic}</span>
                        </div>
                        {/* Expert */}
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs font-semibold text-gray-500">Expert</span>
                          <span className="text-sm font-bold text-gray-800">{lead.expert}</span>
                        </div>
                        {/* Amount */}
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs font-semibold text-gray-500">Amount</span>
                          <span className="text-sm font-bold text-green-600">{lead.proposal_currency || '₪'}{lead.proposal_total ? Number(lead.proposal_total).toLocaleString() : ''}</span>
                        </div>
                        {/* Signed Date */}
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs font-semibold text-gray-500">Signed Date</span>
                          <span className="text-sm font-bold text-gray-800">{lead.date_signed ? new Date(lead.date_signed).toLocaleDateString() : (lead.created_at ? new Date(lead.created_at).toLocaleDateString() : '--')}</span>
                        </div>
                      </div>
                    </div>
                    {/* View Lead Button */}
                    <a
                      href={`/clients/${lead.lead_number}`}
                      className="btn btn-sm btn-outline border-[#3b28c7] text-[#3b28c7] font-bold mt-4 self-end hover:bg-[#3b28c7]/10 hover:border-[#3b28c7] transition-colors"
                      style={{ borderWidth: 2 }}
                    >
                      View Lead
                    </a>
                  </div>
                ))}
              </div>
            </>
          )}
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