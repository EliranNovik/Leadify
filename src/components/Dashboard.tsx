import React, { useState, useEffect, useRef } from 'react';
import Meetings from './Meetings';
import AISuggestions from './AISuggestions';
import AISuggestionsModal from './AISuggestionsModal';
import OverdueFollowups from './OverdueFollowups';
import { UserGroupIcon, CalendarIcon, ExclamationTriangleIcon, ChatBubbleLeftRightIcon, ArrowTrendingUpIcon, ChartBarIcon, ChevronLeftIcon, ChevronRightIcon, XMarkIcon, ClockIcon, SparklesIcon, MagnifyingGlassIcon, FunnelIcon, CheckCircleIcon, PlusIcon, ArrowPathIcon, VideoCameraIcon, PhoneIcon, EnvelopeIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { PieChart as RechartsPieChart, Pie, Cell } from 'recharts';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot, ReferenceArea, BarChart, Bar, Legend as RechartsLegend, CartesianGrid } from 'recharts';
import { RadialBarChart, RadialBar, PolarAngleAxis, Legend } from 'recharts';
import { useMsal } from '@azure/msal-react';
import { DateTime } from 'luxon';
import { FaWhatsapp } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import { getStageName } from '../lib/stageUtils';





const Dashboard: React.FC = () => {
  // State for summary numbers
  const [meetingsToday, setMeetingsToday] = useState(0);
  const [overdueFollowups, setOverdueFollowups] = useState(0);
  const [newMessages, setNewMessages] = useState(0);
  const [aiActions, setAIActions] = useState(0);
  const [latestMessages, setLatestMessages] = useState<any[]>([]);

  // State for expanded sections
  const [expanded, setExpanded] = useState<'meetings' | 'overdue' | 'ai' | 'messages' | null>(null);

  // State for AI container collapse/expand
  const [aiContainerCollapsed, setAiContainerCollapsed] = useState(false);

  const aiSuggestionsRef = useRef<any>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [leads, setLeads] = useState<any[]>([]);
  const [meetings, setMeetings] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const [isAISuggestionsModalOpen, setIsAISuggestionsModalOpen] = useState(false);

  // 1. Add state for real signed leads
  const [realSignedLeads, setRealSignedLeads] = useState<any[]>([]);
  const [realLeadsLoading, setRealLeadsLoading] = useState(false);

  // 1. Add state for real overdue leads
  const [realOverdueLeads, setRealOverdueLeads] = useState<any[]>([]);
  const [overdueLeadsLoading, setOverdueLeadsLoading] = useState(false);
  
  // Removed cache - simplified approach
  
  // State for "Show More" functionality
  const [showAllOverdueLeads, setShowAllOverdueLeads] = useState(false);
  const [allOverdueLeads, setAllOverdueLeads] = useState<any[]>([]);
  const [loadingMoreLeads, setLoadingMoreLeads] = useState(false);
  const [overdueCountFetched, setOverdueCountFetched] = useState(false);

  const navigate = useNavigate();

  // Simple function to fetch overdue leads data
  const fetchOverdueLeadsData = async (fetchAll = false) => {
    try {
      // Get current user's full name
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return { newLeads: [], legacyLeads: [], totalCount: 0 };
      }

      const { data: userData } = await supabase
        .from('users')
        .select('full_name')
        .eq('auth_id', user.id)
        .single();

      if (!userData?.full_name) {
        return { newLeads: [], legacyLeads: [], totalCount: 0 };
      }

      const userFullName = userData.full_name;
      
      const today = new Date().toISOString().split('T')[0];
      const fiftyDaysAgo = new Date();
      fiftyDaysAgo.setDate(fiftyDaysAgo.getDate() - 50);
      const fiftyDaysAgoStr = fiftyDaysAgo.toISOString().split('T')[0];
      
      // Get employee ID for legacy leads
      const { data: employeeData } = await supabase
        .from('tenants_employee')
        .select('id')
        .eq('display_name', userFullName)
        .single();

      const userEmployeeId = employeeData?.id;
      
      // Fetch new leads
      const { data: newLeadsData, error: newLeadsError } = await supabase
        .from('leads')
        .select('id, lead_number, name, stage, topic, next_followup, expert, manager, meeting_manager, category, balance, balance_currency, probability')
        .lte('next_followup', today)
        .gte('next_followup', fiftyDaysAgoStr)
        .not('next_followup', 'is', null)
        .or(`expert.eq.${userFullName},manager.eq.${userFullName},meeting_manager.eq.${userFullName}`)
        .limit(fetchAll ? 1000 : 12);

      if (newLeadsError) throw newLeadsError;

      // Fetch legacy leads
      let legacyLeadsQuery = supabase
        .from('leads_lead')
        .select('id, name, stage, topic, next_followup, expert_id, meeting_manager_id, category_id, total, currency_id')
        .lte('next_followup', today)
        .gte('next_followup', fiftyDaysAgoStr)
        .not('next_followup', 'is', null)
        .eq('status', 0)
        .lt('stage', 100);

      if (userEmployeeId) {
        legacyLeadsQuery = legacyLeadsQuery.or(`expert_id.eq.${userEmployeeId},meeting_manager_id.eq.${userEmployeeId}`);
      }

      const { data: legacyLeadsData, error: legacyLeadsError } = await legacyLeadsQuery.limit(fetchAll ? 1000 : 12);

      if (legacyLeadsError) throw legacyLeadsError;

      const result = {
        newLeads: newLeadsData || [],
        legacyLeads: legacyLeadsData || [],
        totalCount: (newLeadsData?.length || 0) + (legacyLeadsData?.length || 0)
      };
      
      return result;
    } catch (error) {
      console.warn('Error fetching overdue leads data:', error);
      return { newLeads: [], legacyLeads: [], totalCount: 0 };
    }
  };

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
    // Fetch today's meetings (real data, similar to Calendar page)
    const fetchMeetings = async () => {
      setMeetingsLoading(true);
      try {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        
        // Fetch all meetings with proper joins to both leads and leads_lead tables
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
            lead:leads!client_id(
              id, name, lead_number, manager, topic
            ),
            legacy_lead:leads_lead!legacy_lead_id(
              id, name, meeting_manager_id, meeting_lawyer_id, category, category_id
            )
          `)
          .eq('meeting_date', todayStr)
          .not('teams_meeting_url', 'is', null)
          .or('status.is.null,status.neq.canceled');
          
        if (!error && meetings) {
          // Process the meetings to combine lead data from both tables
          const processedMeetings = (meetings || []).map((meeting: any) => {
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
                // Use category_id if category is null
                topic: meeting.legacy_lead.category || meeting.legacy_lead.category_id
              };
            } else if (meeting.lead) {
              // Use new lead data
              leadData = {
                ...meeting.lead,
                lead_type: 'new'
              };
            }
            
            return {
              ...meeting,
              lead: leadData
            };
          });
          
          setTodayMeetings(
            processedMeetings.map((meeting: any) => ({
              id: meeting.id,
              lead: meeting.lead?.lead_number || 'N/A',
              name: meeting.lead?.name || 'Unknown',
              topic: meeting.lead?.topic || 'Consultation',
              expert: meeting.expert || 'Unassigned',
              time: meeting.meeting_time,
              location: meeting.meeting_location || 'Teams',
              manager: meeting.meeting_manager,
              value: meeting.meeting_amount ? `${meeting.meeting_currency} ${meeting.meeting_amount}` : '0',
              link: meeting.teams_meeting_url,
            }))
          );
        } else {
          setTodayMeetings([]);
        }
      } catch (e) {
        console.error('Error fetching meetings:', e);
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
    // Fetch overdue followups - simple count query
    (async () => {
      // Prevent multiple calls
      if (overdueCountFetched) return;
      setOverdueCountFetched(true);
      
      try {
        // Get current user's full name
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setOverdueFollowups(0);
          return;
        }

        const { data: userData } = await supabase
          .from('users')
          .select('full_name')
          .eq('auth_id', user.id)
          .single();

        if (!userData?.full_name) {
          setOverdueFollowups(0);
          return;
        }

        const userFullName = userData.full_name;
        
        const today = new Date().toISOString().split('T')[0];
        const fiftyDaysAgo = new Date();
        fiftyDaysAgo.setDate(fiftyDaysAgo.getDate() - 50);
        const fiftyDaysAgoStr = fiftyDaysAgo.toISOString().split('T')[0];
        
        // Get employee ID for legacy leads
        const { data: employeeData } = await supabase
          .from('tenants_employee')
          .select('id')
          .eq('display_name', userFullName)
          .single();

        const userEmployeeId = employeeData?.id;
        
        // Simple count queries for total
        const [newLeadsCount, legacyLeadsCount] = await Promise.all([
          supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .lte('next_followup', today)
            .gte('next_followup', fiftyDaysAgoStr)
            .not('next_followup', 'is', null)
            .or(`expert.eq.${userFullName},manager.eq.${userFullName},meeting_manager.eq.${userFullName}`),
          
          userEmployeeId ? 
            supabase
              .from('leads_lead')
              .select('*', { count: 'exact', head: true })
              .lte('next_followup', today)
              .gte('next_followup', fiftyDaysAgoStr)
              .not('next_followup', 'is', null)
              .eq('status', 0)
              .lt('stage', 100)
              .or(`expert_id.eq.${userEmployeeId},meeting_manager_id.eq.${userEmployeeId}`) :
            Promise.resolve({ count: 0, error: null })
        ]);
        
        const totalCount = (newLeadsCount.count || 0) + (legacyLeadsCount.count || 0);
        setOverdueFollowups(totalCount);
        
      } catch (error) {
        console.warn('Error fetching overdue count:', error);
        setOverdueFollowups(0);
      }
    })();
    // Fetch new messages (real data from emails and WhatsApp)
    (async () => {
      try {
        // Get current user's leads
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Get user's leads
        const { data: userLeads } = await supabase
          .from('users')
          .select('id')
          .eq('auth_id', user.id)
          .single();

        if (!userLeads) return;

        // Fetch recent incoming emails (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const { data: recentEmails } = await supabase
          .from('emails')
          .select(`
            id,
            message_id,
            client_id,
            sender_name,
            sender_email,
            subject,
            body_preview,
            sent_at,
            direction,
            leads:client_id (
              id,
              name,
              lead_number,
              email
            )
          `)
          .eq('direction', 'incoming')
          .gte('sent_at', sevenDaysAgo.toISOString())
          .order('sent_at', { ascending: false })
          .limit(10);

        // Fetch recent WhatsApp messages (last 7 days)
        const { data: recentWhatsApp } = await supabase
          .from('whatsapp_messages')
          .select(`
            id,
            lead_id,
            sender_name,
            message,
            sent_at,
            direction,
            leads:lead_id (
              id,
              name,
              lead_number,
              email
            )
          `)
          .eq('direction', 'in')
          .gte('sent_at', sevenDaysAgo.toISOString())
          .order('sent_at', { ascending: false })
          .limit(10);

        // Combine and format messages
        const allMessages: any[] = [];
        
        if (recentEmails) {
          recentEmails.forEach(email => {
            if (email.leads && typeof email.leads === 'object' && 'name' in email.leads) {
              const leads = email.leads as any;
              allMessages.push({
                id: email.message_id,
                type: 'email',
                client_name: leads.name,
                lead_number: leads.lead_number,
                content: email.subject || email.body_preview || 'Email received',
                sender: email.sender_name || email.sender_email,
                created_at: email.sent_at,
                client_id: email.client_id,
                direction: email.direction
              });
            }
          });
        }

        if (recentWhatsApp) {
          recentWhatsApp.forEach(msg => {
            if (msg.leads && typeof msg.leads === 'object' && 'name' in msg.leads) {
              const leads = msg.leads as any;
              allMessages.push({
                id: msg.id,
                type: 'whatsapp',
                client_name: leads.name,
                lead_number: leads.lead_number,
                content: msg.message,
                sender: msg.sender_name || 'Client',
                created_at: msg.sent_at,
                client_id: msg.lead_id,
                direction: msg.direction
              });
            }
          });
        }

        // Sort by date and take the latest 5
        const sortedMessages = allMessages
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 5);

        setLatestMessages(sortedMessages);
        setNewMessages(sortedMessages.length);
      } catch (error) {
        console.error('Error fetching messages:', error);
        setLatestMessages(mockMessages);
        setNewMessages(mockMessages.length);
      }
    })();
    // Fetch AI actions count
    (async () => {
      try {
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-notifications`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify({ action: 'get_notifications' })
        });

        if (response.ok) {
          const data = await response.json();
          setAIActions(data.count || 0);
        } else {
          setAIActions(0);
        }
      } catch (error) {
        console.error('Error fetching AI actions count:', error);
        setAIActions(0);
      }
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

  // Real data for Score Board
  const [realRevenueThisMonth, setRealRevenueThisMonth] = useState<number>(0);
  const [revenueLoading, setRevenueLoading] = useState<boolean>(true);
  const REVENUE_TARGET = 2000000; // 2M target

  // Lead growth data
  const [totalLeadsThisMonth, setTotalLeadsThisMonth] = useState<number>(0);
  const [totalLeadsLastMonth, setTotalLeadsLastMonth] = useState<number>(0);
  const [leadsLoading, setLeadsLoading] = useState<boolean>(true);

  // Conversion rate data
  const [meetingsScheduledThisMonth, setMeetingsScheduledThisMonth] = useState<number>(0);
  const [totalExistingLeads, setTotalExistingLeads] = useState<number>(0);
  const [conversionLoading, setConversionLoading] = useState<boolean>(true);

  // Contracts signed data
  const [contractsSignedThisMonth, setContractsSignedThisMonth] = useState<number>(0);
  const [contractsSignedLastMonth, setContractsSignedLastMonth] = useState<number>(0);
  const [contractsLoading, setContractsLoading] = useState<boolean>(true);

  // Fetch real revenue this month
  useEffect(() => {
    const fetchRevenueThisMonth = async () => {
      setRevenueLoading(true);
      try {
        const now = new Date();
        const thisMonth = now.getMonth();
        const thisYear = now.getFullYear();
        const startOfMonth = new Date(thisYear, thisMonth, 1);
        const endOfMonth = new Date(thisYear, thisMonth + 1, 0);

        const { data, error } = await supabase
          .from('payment_plans')
          .select('value, value_vat, paid_at')
          .eq('paid', true)
          .gte('paid_at', startOfMonth.toISOString())
          .lte('paid_at', endOfMonth.toISOString());

        if (!error && data) {
          const total = data.reduce((sum, row) => {
            return sum + (Number(row.value) + Number(row.value_vat));
          }, 0);
          setRealRevenueThisMonth(total);
        } else {
          setRealRevenueThisMonth(0);
        }
      } catch (error) {
        console.error('Error fetching revenue:', error);
        setRealRevenueThisMonth(0);
      } finally {
        setRevenueLoading(false);
      }
    };

    fetchRevenueThisMonth();
  }, []);

  // Fetch lead growth data
  useEffect(() => {
    const fetchLeadGrowth = async () => {
      setLeadsLoading(true);
      try {
        const now = new Date();
        const thisMonth = now.getMonth();
        const thisYear = now.getFullYear();
        
        // This month
        const startOfThisMonth = new Date(thisYear, thisMonth, 1);
        const endOfThisMonth = new Date(thisYear, thisMonth + 1, 0);
        
        // Last month
        const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
        const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;
        const startOfLastMonth = new Date(lastMonthYear, lastMonth, 1);
        const endOfLastMonth = new Date(lastMonthYear, lastMonth + 1, 0);

        // Fetch this month's leads
        const { data: thisMonthData, error: thisMonthError } = await supabase
          .from('leads')
          .select('id')
          .gte('created_at', startOfThisMonth.toISOString())
          .lte('created_at', endOfThisMonth.toISOString());

        // Fetch last month's leads
        const { data: lastMonthData, error: lastMonthError } = await supabase
          .from('leads')
          .select('id')
          .gte('created_at', startOfLastMonth.toISOString())
          .lte('created_at', endOfLastMonth.toISOString());

        if (!thisMonthError && thisMonthData) {
          setTotalLeadsThisMonth(thisMonthData.length);
        } else {
          setTotalLeadsThisMonth(0);
        }

        if (!lastMonthError && lastMonthData) {
          setTotalLeadsLastMonth(lastMonthData.length);
        } else {
          setTotalLeadsLastMonth(0);
        }
      } catch (error) {
        console.error('Error fetching lead growth:', error);
        setTotalLeadsThisMonth(0);
        setTotalLeadsLastMonth(0);
      } finally {
        setLeadsLoading(false);
      }
    };

    fetchLeadGrowth();
  }, []);

  // Fetch conversion rate data
  useEffect(() => {
    const fetchConversionRate = async () => {
      setConversionLoading(true);
      try {
        const now = new Date();
        const thisMonth = now.getMonth();
        const thisYear = now.getFullYear();
        const startOfThisMonth = new Date(thisYear, thisMonth, 1, 0, 0, 0, 0);
        const endOfThisMonth = new Date(thisYear, thisMonth + 1, 0, 23, 59, 59, 999);



        // Get new leads created this month
        const { data: newLeadsData, error: newLeadsError } = await supabase
          .from('leads')
          .select('id, created_at')
          .gte('created_at', startOfThisMonth.toISOString())
          .lte('created_at', endOfThisMonth.toISOString());



        // Get meetings scheduled this month (no duplicates per client)
        const { data: meetingsData, error: meetingsError } = await supabase
          .from('meetings')
          .select('client_id, created_at, status')
          .gte('created_at', startOfThisMonth.toISOString())
          .lte('created_at', endOfThisMonth.toISOString())
          .eq('status', 'scheduled');



        if (!newLeadsError && newLeadsData) {
          setTotalExistingLeads(newLeadsData.length);
        } else {
          setTotalExistingLeads(0);
        }

        if (!meetingsError && meetingsData) {
          // Remove duplicates per client (client_id)
          const uniqueClientIds = [...new Set(meetingsData.map(meeting => meeting.client_id))];
          setMeetingsScheduledThisMonth(uniqueClientIds.length);

        } else {
          setMeetingsScheduledThisMonth(0);
        }
      } catch (error) {
        console.error('Error fetching conversion rate:', error);
        setTotalExistingLeads(0);
        setMeetingsScheduledThisMonth(0);
      } finally {
        setConversionLoading(false);
      }
    };

    fetchConversionRate();
  }, []);

  // Fetch contracts signed data
  useEffect(() => {
    const fetchContractsSigned = async () => {
      setContractsLoading(true);
      try {
        const now = new Date();
        const thisMonth = now.getMonth();
        const thisYear = now.getFullYear();
        
        // This month
        const startOfThisMonth = new Date(thisYear, thisMonth, 1, 0, 0, 0, 0);
        const endOfThisMonth = new Date(thisYear, thisMonth + 1, 0, 23, 59, 59, 999);
        
        // Last month
        const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
        const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;
        const startOfLastMonth = new Date(lastMonthYear, lastMonth, 1, 0, 0, 0, 0);
        const endOfLastMonth = new Date(lastMonthYear, lastMonth + 1, 0, 23, 59, 59, 999);

        // Get contracts signed this month
        const { data: thisMonthContracts, error: thisMonthError } = await supabase
          .from('contracts')
          .select('id')
          .gte('created_at', startOfThisMonth.toISOString())
          .lte('created_at', endOfThisMonth.toISOString());

        // Get contracts signed last month
        const { data: lastMonthContracts, error: lastMonthError } = await supabase
          .from('contracts')
          .select('id')
          .gte('created_at', startOfLastMonth.toISOString())
          .lte('created_at', endOfLastMonth.toISOString());

        if (!thisMonthError && thisMonthContracts) {
          setContractsSignedThisMonth(thisMonthContracts.length);
        } else {
          setContractsSignedThisMonth(0);
        }

        if (!lastMonthError && lastMonthContracts) {
          setContractsSignedLastMonth(lastMonthContracts.length);
        } else {
          setContractsSignedLastMonth(0);
        }
      } catch (error) {
        console.error('Error fetching contracts signed:', error);
        setContractsSignedThisMonth(0);
        setContractsSignedLastMonth(0);
      } finally {
        setContractsLoading(false);
      }
    };

    fetchContractsSigned();
  }, []);

  // Calculate percentage from target
  const revenuePercentage = REVENUE_TARGET > 0 ? (realRevenueThisMonth / REVENUE_TARGET) * 100 : 0;
  const isAboveTarget = realRevenueThisMonth >= REVENUE_TARGET;

  // Calculate lead growth percentage
  const leadGrowthPercentage = totalLeadsLastMonth > 0 
    ? ((totalLeadsThisMonth - totalLeadsLastMonth) / totalLeadsLastMonth) * 100 
    : 0;
  const isLeadGrowthPositive = leadGrowthPercentage >= 0;

  // Calculate conversion rate
  const conversionRate = totalExistingLeads > 0 
    ? (meetingsScheduledThisMonth / totalExistingLeads) * 100 
    : 0;

  // Calculate contracts signed percentage
  const contractsPercentage = contractsSignedLastMonth > 0 
    ? ((contractsSignedThisMonth - contractsSignedLastMonth) / contractsSignedLastMonth) * 100 
    : 0;
  const isContractsGrowthPositive = contractsPercentage >= 0;

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
  // Agreement signed data (first table)
  const agreementData = {
    Today: [
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 1, amount: 2500, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 1, amount: 2500, expected: 0 },
    ],
    "Last 30d": [
      { count: 0, amount: 0, expected: 0 },
      { count: 10, amount: 76652, expected: 0 },
      { count: 39, amount: 67443, expected: 0 },
      { count: 15, amount: 130084, expected: 0 },
      { count: 43, amount: 389933, expected: 0 },
      { count: 84, amount: 1730117, expected: 0 },
      { count: 191, amount: 2394231, expected: 0 },
    ],
    "August": [
      { count: 51, amount: 994981, expected: 1600000 },
      { count: 0, amount: 0, expected: 100000 },
      { count: 5, amount: 54672, expected: 70000 },
      { count: 25, amount: 40500, expected: 150000 },
      { count: 8, amount: 64500, expected: 250000 },
      { count: 27, amount: 194638, expected: 1700000 },
      { count: 116, amount: 1349291, expected: 3870000 },
    ],
  };

  // Invoiced data (second table)
  const invoicedData = {
    Today: [
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 1, amount: 2500, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 1, amount: 2500, expected: 0 },
    ],
    "Last 30d": [
      { count: 0, amount: 0, expected: 0 },
      { count: 6, amount: 71204, expected: 0 },
      { count: 35, amount: 63709, expected: 0 },
      { count: 35, amount: 147667, expected: 0 },
      { count: 53, amount: 236008, expected: 0 },
      { count: 175, amount: 1149596, expected: 0 },
      { count: 305, amount: 1671621, expected: 0 },
    ],
    "August": [
      { count: 0, amount: 0, expected: 100000 },
      { count: 3, amount: 48311, expected: 70000 },
      { count: 21, amount: 36716, expected: 150000 },
      { count: 14, amount: 63636, expected: 250000 },
      { count: 30, amount: 110782, expected: 1700000 },
      { count: 102, amount: 676346, expected: 0 },
      { count: 170, amount: 935792, expected: 2350000 },
    ],
  };
  const scoreboardHighlights = {
    August: [
      null,
      null,
      { amount: 100000 },
      { amount: 70000 },
      { amount: 150000 },
      { amount: 250000 },
      { amount: 1700000 },
      { amount: 2350000 },
    ],
  };
  // Score Board state
  const [scoreTab, setScoreTab] = React.useState("Tables");
  const [flippedCards, setFlippedCards] = React.useState<Set<string>>(new Set());
  // Column-group visibility for Department Performance table (desktop)
  const [showTodayCols, setShowTodayCols] = React.useState(true);
  const [showLast30Cols, setShowLast30Cols] = React.useState(true);
  const [showLastMonthCols, setShowLastMonthCols] = React.useState(true);
  const [showRowsAsColumns, setShowRowsAsColumns] = React.useState(true);

  // Derived totals for Department Performance table (exclude 'General' and 'Total')
  const includedDeptIndexes = scoreboardCategories
    .map((cat, idx) => ({ cat, idx }))
    .filter(({ cat }) => cat !== 'General' && cat !== 'Total')
    .map(({ idx }) => idx);

  // Stable targets for Today where not provided
  const randomTodayTargetsRef = useRef<number[]>([]);
  useEffect(() => {
    if (randomTodayTargetsRef.current.length === 0) {
      randomTodayTargetsRef.current = scoreboardCategories.map((_, idx) => {
        const provided = agreementData['Today'][idx]?.expected;
        return provided || 0;
      });
    }
  }, []);

  const sumTodayCount = includedDeptIndexes.reduce((sum, i) => sum + (agreementData['Today'][i]?.count || 0), 0);
  const sumTodayAmount = includedDeptIndexes.reduce((sum, i) => sum + (agreementData['Today'][i]?.amount || 0), 0);
  const sumTodayExpected = includedDeptIndexes.reduce((sum, i) => sum + ((agreementData['Today'][i]?.expected || randomTodayTargetsRef.current[i] || 0)), 0);

  const sum30Count = includedDeptIndexes.reduce((sum, i) => sum + (agreementData['Last 30d'][i]?.count || 0), 0);
  const sum30Amount = includedDeptIndexes.reduce((sum, i) => sum + (agreementData['Last 30d'][i]?.amount || 0), 0);
  const sum30Expected = includedDeptIndexes.reduce((sum, i) => sum + (agreementData['Last 30d'][i]?.expected || 0), 0);

  const sumMonthCount = sum30Count; // using 30d as proxy for this month (demo)
  const sumMonthAmount = sum30Amount;
  const sumMonthTarget = sum30Expected;
  const totalPerformancePct = sum30Expected > 0 ? Math.round((sum30Amount / sum30Expected) * 100) : 0;

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
    { category: 'Commercial & Civil', signed: 0, due: 0 },
    { category: 'Small cases', signed: 0, due: 0 },
    { category: 'USA - Immigration', signed: 0, due: 0 },
    { category: 'Immigration to Israel', signed: 2500, due: 0 },
    { category: 'Austria and Germany', signed: 0, due: 0 },
  ];
  const scoreboardBarDataAugust = [
    { category: 'General', signed: 0, due: 0 },
    { category: 'Commercial & Civil', signed: 54672, due: 100000 },
    { category: 'Small cases', signed: 40500, due: 70000 },
    { category: 'USA - Immigration', signed: 64500, due: 150000 },
    { category: 'Immigration to Israel', signed: 194638, due: 250000 },
    { category: 'Austria and Germany', signed: 994981, due: 1700000 },
  ];
  const scoreboardBarData30d = [
    { category: 'General', signed: 0, due: 0 },
    { category: 'Commercial & Civil', signed: 76652, due: 0 },
    { category: 'Small cases', signed: 67443, due: 0 },
    { category: 'USA - Immigration', signed: 130084, due: 0 },
    { category: 'Immigration to Israel', signed: 389933, due: 0 },
    { category: 'Austria and Germany', signed: 1730117, due: 0 },
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

  // Helper function to render table in columns view (departments as columns)
  const renderColumnsView = (tableType: 'agreement' | 'invoiced') => {
    const categories = scoreboardCategories.filter(cat => cat !== 'General' && cat !== 'Total');
    const visibleColumns = [];
    if (showTodayCols) visibleColumns.push('Today');
    if (showLast30Cols) visibleColumns.push('Last 30d');
    if (showLastMonthCols) visibleColumns.push(new Date().toLocaleDateString('en-US', { month: 'long' }));

    // Use the correct data based on table type
    const dataSource = tableType === 'agreement' ? agreementData : invoicedData;

    return (
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="text-left px-5 py-3 font-semibold text-slate-700"></th>
            {categories.map(category => (
              <th key={category} className="text-center px-5 py-3 font-semibold text-slate-700">{category}</th>
            ))}
            <th className="text-center px-5 py-3 font-semibold text-white" style={{backgroundColor: '#411cce'}}>Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {visibleColumns.map(columnType => {
            const isToday = columnType === 'Today';
            const isLast30 = columnType === 'Last 30d';
            const isThisMonth = columnType === new Date().toLocaleDateString('en-US', { month: 'long' });
            
            return (
              <React.Fragment key={columnType}>
                {/* Combined Count and Amount row */}
                <tr className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-semibold text-slate-700">{columnType}</td>
                  {categories.map((category, index) => {
                    const data = isToday ? dataSource["Today"][index] : 
                                isLast30 ? dataSource["Last 30d"][index] : 
                                dataSource["August"][index]; // This month uses August data
                    const amount = data?.amount || 0;
                    const target = data?.expected || 0;
                    const targetClass = target > 0 ? (amount >= target ? 'text-green-600' : 'text-red-600') : 'text-slate-700';
                    
                    return (
                      <td key={`${category}-combined`} className="px-5 py-3 text-center">
                        <div className="space-y-1">
                          <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{data?.count || 0}</div>
                          <div className="border-t border-slate-200 my-1"></div>
                          <div className="font-semibold text-slate-700">₪{amount.toLocaleString()}</div>
                        </div>
                      </td>
                    );
                  })}
                  {/* Total column for this time period */}
                  <td className="px-5 py-3 text-center text-white" style={{backgroundColor: '#411cce'}}>
                    <div className="space-y-1">
                      <div className="flex items-center justify-center">
                        <div className="badge badge-white font-semibold px-2 py-1" style={{color: '#411cce'}}>
                          {(() => {
                            if (isToday) {
                              return dataSource["Today"].slice(1, -1).reduce((sum, item) => sum + (item.count || 0), 0);
                            } else if (isLast30) {
                              return dataSource["Last 30d"].slice(1, -1).reduce((sum, item) => sum + (item.count || 0), 0);
                            } else {
                              return dataSource["August"].slice(1, -1).reduce((sum, item) => sum + (item.count || 0), 0);
                            }
                          })()}
                        </div>
                      </div>
                      <div className="border-t border-white/20 my-1"></div>
                      <div className="font-semibold text-white">
                        ₪{(() => {
                          if (isToday) {
                            return dataSource["Today"].slice(1, -1).reduce((sum, item) => sum + (item.amount || 0), 0);
                          } else if (isLast30) {
                            return dataSource["Last 30d"].slice(1, -1).reduce((sum, item) => sum + (item.amount || 0), 0);
                          } else {
                            return dataSource["August"].slice(1, -1).reduce((sum, item) => sum + (item.amount || 0), 0);
                          }
                        })().toLocaleString()}
                      </div>
                    </div>
                  </td>
                </tr>
                {/* Target row - only show for current month */}
                {isThisMonth && (
                  <tr className="bg-white border-2 border-purple-600">
                    <td className="px-5 py-3 font-semibold text-slate-700">Target {columnType}</td>
                    {categories.map((category, index) => {
                      const data = dataSource["August"][index];
                      const amount = data?.amount || 0;
                      const target = data?.expected || 0;
                      const targetClass = target > 0 ? (amount >= target ? 'text-green-600' : 'text-red-600') : 'text-slate-700';
                      
                      return (
                        <td key={`${category}-target`} className={`px-5 py-3 text-center font-semibold ${targetClass}`}>
                          {target ? `₪${target.toLocaleString()}` : '—'}
                        </td>
                      );
                    })}
                    {/* Total target column */}
                    <td className="px-5 py-3 text-center text-white" style={{backgroundColor: '#411cce'}}>
                      {(() => {
                        const totalTarget = dataSource["August"].slice(1, -1).reduce((sum, item) => sum + (item.expected || 0), 0);
                        return (
                          <span className="font-semibold text-white">
                            {totalTarget ? `₪${totalTarget.toLocaleString()}` : '—'}
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    );
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
        // Fetch first 12 leads for display
        const { newLeads, legacyLeads, totalCount } = await fetchOverdueLeadsData(false);
        
        // Process the leads for display
        const combinedLeads = [...newLeads, ...legacyLeads];
        const processedLeads = await processOverdueLeadsForDisplay(combinedLeads);
        
        setRealOverdueLeads(processedLeads);
      } catch (error) {
        console.warn('Error fetching overdue leads for display:', error);
        setRealOverdueLeads([]);
      } finally {
        setOverdueLeadsLoading(false);
      }
    };

    fetchOverdueLeads();
  }, [expanded]);

  // Function to load all overdue leads
  const loadAllOverdueLeads = async () => {
    setLoadingMoreLeads(true);
    try {
      const { newLeads, legacyLeads, totalCount } = await fetchOverdueLeadsData(true);
      
      // Process all leads for display - pass true to indicate we want all leads
      const processedLeads = await processOverdueLeadsForDisplay([...newLeads, ...legacyLeads], true);
      
      setAllOverdueLeads(processedLeads);
      setShowAllOverdueLeads(true);
    } catch (error) {
      console.warn('Error loading all overdue leads:', error);
    } finally {
      setLoadingMoreLeads(false);
    }
  };

  // Helper function to process overdue leads for display
  const processOverdueLeadsForDisplay = async (leadsData: any[], processAll = false) => {
    try {
      console.log('Processing leads data:', leadsData.length, 'leads');
      console.log('Sample lead data:', leadsData.slice(0, 2));
      
      // Separate new and legacy leads based on table structure
      // New leads come from 'leads' table and have lead_number field
      // Legacy leads come from 'leads_lead' table and have expert_id field
      const newLeads = leadsData.filter(lead => lead.lead_number); // New leads have lead_number
      const legacyLeads = leadsData.filter(lead => lead.expert_id); // Legacy leads have expert_id
      
      console.log('New leads:', newLeads.length, 'Legacy leads:', legacyLeads.length);

      // Process new leads
      const processedNewLeads = newLeads.map(lead => ({
        ...lead,
        lead_type: 'new' as const,
        stage_name: lead.stage || 'Follow-up Required',
        expert_name: lead.expert || 'Not assigned',
        manager_name: lead.manager || 'Not assigned',
        category_name: lead.category || 'Not specified',
        amount: lead.balance || 0,
        currency: lead.balance_currency || '₪',
        topic: lead.topic || 'Not specified',
        probability: lead.probability || 0
      }));

      // Process legacy leads with related data
      let stageNameMap: { [key: number]: string } = {};
      let employeeNameMap: { [key: number]: string } = {};
      let categoryNameMap: { [key: number]: string } = {};

      if (legacyLeads.length > 0) {
        const limitedLegacyLeads = (showAllOverdueLeads || processAll) ? legacyLeads : legacyLeads.slice(0, 10); // Use all leads when showing all or processing all
        
        // Collect unique IDs from limited leads
        const stageIds = [...new Set(limitedLegacyLeads.map(lead => lead.stage).filter(Boolean))];
        const employeeIds = [...new Set([
          ...limitedLegacyLeads.map(lead => lead.expert_id).filter(Boolean),
          ...limitedLegacyLeads.map(lead => lead.meeting_manager_id).filter(Boolean)
        ])];
        const categoryIds = [...new Set(limitedLegacyLeads.map(lead => lead.category_id).filter(Boolean))];

        console.log('Fetching related data for:', { stageIds, employeeIds, categoryIds });

        // Fetch all related data in parallel for better performance
        const [stageResult, employeeResult, categoryResult] = await Promise.allSettled([
          stageIds.length > 0 ? supabase.from('lead_stages').select('id, name').in('id', stageIds) : Promise.resolve({ data: [] }),
          employeeIds.length > 0 ? supabase.from('tenants_employee').select('id, display_name').in('id', employeeIds) : Promise.resolve({ data: [] }),
          categoryIds.length > 0 ? supabase.from('misc_category').select('id, name').in('id', categoryIds) : Promise.resolve({ data: [] })
        ]);

        // Build maps from results
        if (stageResult.status === 'fulfilled' && stageResult.value.data) {
          stageNameMap = stageResult.value.data.reduce((acc: { [key: number]: string }, stage: any) => {
            acc[stage.id] = stage.name;
            return acc;
          }, {});
        }

        if (employeeResult.status === 'fulfilled' && employeeResult.value.data) {
          employeeNameMap = employeeResult.value.data.reduce((acc: { [key: number]: string }, employee: any) => {
            acc[employee.id] = employee.display_name;
            return acc;
          }, {});
        }

        if (categoryResult.status === 'fulfilled' && categoryResult.value.data) {
          categoryNameMap = categoryResult.value.data.reduce((acc: { [key: number]: string }, category: any) => {
            acc[category.id] = category.name;
            return acc;
          }, {});
        }
      }

      // Process legacy leads (use all when showing all or processing all, otherwise limit to 10)
      const leadsToProcess = (showAllOverdueLeads || processAll) ? legacyLeads : legacyLeads.slice(0, 10);
        
      const processedLegacyLeads = leadsToProcess.map(lead => ({
        ...lead,
        id: `legacy_${lead.id}`,
        lead_number: lead.id?.toString() || '',
        lead_type: 'legacy' as const,
        stage_name: stageNameMap[lead.stage] || `Stage ${lead.stage}`,
        expert_name: employeeNameMap[lead.expert_id] || 'Not assigned',
        manager_name: employeeNameMap[lead.meeting_manager_id] || 'Not assigned',
        category_name: categoryNameMap[lead.category_id] || 'Not specified',
        amount: lead.total || 0,
        currency: lead.currency_id || 1,
        topic: lead.topic || 'Not specified',
        probability: 0 // Legacy leads don't have probability field
      }));

      // Combine and sort by follow-up date (oldest first)
      const allLeads = [...processedNewLeads, ...processedLegacyLeads].sort((a, b) => {
        if (!a.next_followup && !b.next_followup) return 0;
        if (!a.next_followup) return 1;
        if (!b.next_followup) return -1;
        return new Date(a.next_followup).getTime() - new Date(b.next_followup).getTime();
      });

      console.log('Final processed leads:', allLeads.length);
      return allLeads;
    } catch (error) {
      console.warn('Error processing overdue leads for display:', error);
      return [];
    }
  };

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
          onClick={() => setIsAISuggestionsModalOpen(true)}
        >
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
              <ArrowTrendingUpIcon className="w-5 h-5 md:w-7 md:h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-2xl md:text-4xl font-extrabold text-white leading-tight">{aiActions}</div>
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
          <div className="flex justify-between items-center mb-4">
            <div className="font-bold text-lg text-base-content/80">Overdue Follow-ups</div>
            <div className="text-sm text-gray-500">
              Showing {realOverdueLeads.length} of {overdueFollowups} leads
            </div>
          </div>
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
                            <span className="text-sm font-semibold text-gray-400 tracking-widest">
                              {lead.lead_number}
                              {lead.lead_type === 'legacy' && <span className="text-sm text-gray-500 ml-1">(L)</span>}
                            </span>
                            <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                            <h3 className="text-xl font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{lead.name}</h3>
                            <span className="text-sm font-bold px-2 py-1 rounded bg-[#3b28c7] text-white">{daysOverdue} days overdue</span>
                          </div>
                          {/* Stage */}
                          <div className="flex justify-between items-center py-1">
                            <span className="text-sm font-semibold text-gray-500">Stage</span>
                            <span className="text-sm font-bold text-black">
                              {lead.lead_type === 'legacy' ? lead.stage_name : (lead.stage || 'Follow-up Required')}
                            </span>
                          </div>
                          <div className="space-y-2 divide-y divide-gray-100 mt-2">
                            {/* Category */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Category</span>
                              <span className="text-sm font-bold text-gray-800">
                                {lead.lead_type === 'legacy' ? lead.category_name : (lead.category || 'Not specified')}
                              </span>
                            </div>
                            {/* Topic */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Topic</span>
                              <span className="text-sm font-bold text-gray-800">{lead.topic || 'Not specified'}</span>
                            </div>
                            {/* Expert */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Expert</span>
                              <span className="text-sm font-bold text-gray-800">
                                {lead.lead_type === 'legacy' ? lead.expert_name : (lead.expert || 'Not assigned')}
                              </span>
                            </div>
                            {/* Amount */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Amount</span>
                              <span className="text-sm font-bold text-gray-800">
                                {lead.lead_type === 'legacy' 
                                  ? `₪${(lead.amount || 0).toLocaleString()}` 
                                  : `${lead.balance_currency || '₪'}${(lead.balance || 0).toLocaleString()}`
                                }
                              </span>
                            </div>
                            {/* Manager */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Manager</span>
                              <span className="text-sm font-bold text-gray-800">
                                {lead.lead_type === 'legacy' ? lead.manager_name : (lead.manager || 'Not assigned')}
                              </span>
                            </div>
                            {/* Probability */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Probability</span>
                              <span className="text-sm font-bold text-gray-800">{lead.probability || 0}%</span>
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
                            <span className="text-sm font-semibold text-gray-400 tracking-widest">
                              {lead.lead_number}
                              {lead.lead_type === 'legacy' && <span className="text-sm text-gray-500 ml-1">(L)</span>}
                            </span>
                            <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                            <h3 className="text-xl font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{lead.name}</h3>
                            <span className="text-sm font-bold px-2 py-1 rounded bg-[#3b28c7] text-white">{daysOverdue} days overdue</span>
                          </div>
                          {/* Stage */}
                          <div className="flex justify-between items-center py-1">
                            <span className="text-sm font-semibold text-gray-500">Stage</span>
                            <span className="text-sm font-bold text-black">
                              {lead.lead_type === 'legacy' ? lead.stage_name : (lead.stage || 'Follow-up Required')}
                            </span>
                          </div>
                          <div className="space-y-2 divide-y divide-gray-100 mt-2">
                            {/* Category */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Category</span>
                              <span className="text-sm font-bold text-gray-800">
                                {lead.lead_type === 'legacy' ? lead.category_name : (lead.category || 'Not specified')}
                              </span>
                            </div>
                            {/* Topic */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Topic</span>
                              <span className="text-sm font-bold text-gray-800">{lead.topic || 'Not specified'}</span>
                            </div>
                            {/* Expert */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Expert</span>
                              <span className="text-sm font-bold text-gray-800">
                                {lead.lead_type === 'legacy' ? lead.expert_name : (lead.expert || 'Not assigned')}
                              </span>
                            </div>
                            {/* Amount */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Amount</span>
                              <span className="text-sm font-bold text-gray-800">
                                {lead.lead_type === 'legacy' 
                                  ? `₪${(lead.amount || 0).toLocaleString()}` 
                                  : `${lead.balance_currency || '₪'}${(lead.balance || 0).toLocaleString()}`
                                }
                              </span>
                            </div>
                            {/* Manager */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Manager</span>
                              <span className="text-sm font-bold text-gray-800">
                                {lead.lead_type === 'legacy' ? lead.manager_name : (lead.manager || 'Not assigned')}
                              </span>
                            </div>
                            {/* Probability */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Probability</span>
                              <span className="text-sm font-bold text-gray-800">{lead.probability || 0}%</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              
              {/* Show More Button */}
              {!showAllOverdueLeads && realOverdueLeads.length > 0 && (
                <div className="flex justify-center mt-6">
                  <button 
                    className="btn btn-primary btn-lg gap-2"
                    onClick={loadAllOverdueLeads}
                    disabled={loadingMoreLeads}
                  >
                    {loadingMoreLeads ? (
                      <>
                        <span className="loading loading-spinner loading-sm"></span>
                        Loading...
                      </>
                    ) : (
                      <>
                        Show All {overdueFollowups} Leads
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </>
                    )}
                  </button>
                </div>
              )}
              
              {/* Show All Leads */}
              {showAllOverdueLeads && allOverdueLeads.length > 0 && (
                <>
                  <div className="mt-6 mb-4">
                    <h4 className="text-lg font-semibold text-gray-800 mb-2">All Overdue Follow-ups</h4>
                    <p className="text-sm text-gray-600">Showing all {allOverdueLeads.length} leads</p>
                  </div>
                  
                  {/* Desktop Card Grid View for All Leads */}
                  <div className="hidden md:grid grid-cols-2 lg:grid-cols-3 gap-6">
                    {allOverdueLeads.map((lead, index) => {
                      const daysOverdue = lead.next_followup ? Math.floor((new Date().getTime() - new Date(lead.next_followup).getTime()) / (1000 * 3600 * 24)) : 0;
                      return (
                        <div key={lead.id} className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 border border-red-100 group flex flex-col justify-between min-h-[340px] relative">
                          <div className="flex-1 flex flex-col">
                            {/* Lead Number and Name */}
                            <div className="mb-3 flex items-center gap-2">
                              <span className="text-sm font-semibold text-gray-400 tracking-widest">
                                {lead.lead_number}
                                {lead.lead_type === 'legacy' && <span className="text-sm text-gray-500 ml-1">(L)</span>}
                              </span>
                              <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                              <h3 className="text-xl font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{lead.name}</h3>
                              <span className="text-sm font-bold px-2 py-1 rounded bg-[#3b28c7] text-white">{daysOverdue} days overdue</span>
                            </div>
                            {/* Stage */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Stage</span>
                              <span className="text-sm font-bold text-black">
                                {lead.lead_type === 'legacy' ? lead.stage_name : (lead.stage || 'Follow-up Required')}
                              </span>
                            </div>
                            <div className="space-y-2 divide-y divide-gray-100 mt-2">
                              {/* Category */}
                              <div className="flex justify-between items-center py-1">
                                <span className="text-sm font-semibold text-gray-500">Category</span>
                                <span className="text-sm font-bold text-gray-800">
                                  {lead.lead_type === 'legacy' ? lead.category_name : (lead.category || 'Not specified')}
                                </span>
                              </div>
                              {/* Topic */}
                              <div className="flex justify-between items-center py-1">
                                <span className="text-sm font-semibold text-gray-500">Topic</span>
                                <span className="text-sm font-bold text-gray-800">{lead.topic || 'Not specified'}</span>
                              </div>
                              {/* Expert */}
                              <div className="flex justify-between items-center py-1">
                                <span className="text-sm font-semibold text-gray-500">Expert</span>
                                <span className="text-sm font-bold text-gray-800">
                                  {lead.lead_type === 'legacy' ? lead.expert_name : (lead.expert || 'Not assigned')}
                                </span>
                              </div>
                              {/* Amount */}
                              <div className="flex justify-between items-center py-1">
                                <span className="text-sm font-semibold text-gray-500">Amount</span>
                                <span className="text-sm font-bold text-gray-800">
                                  {lead.lead_type === 'legacy' 
                                    ? `₪${(lead.amount || 0).toLocaleString()}` 
                                    : `${lead.balance_currency || '₪'}${(lead.balance || 0).toLocaleString()}`
                                  }
                                </span>
                              </div>
                              {/* Manager */}
                              <div className="flex justify-between items-center py-1">
                                <span className="text-sm font-semibold text-gray-500">Manager</span>
                                <span className="text-sm font-bold text-gray-800">
                                  {lead.lead_type === 'legacy' ? lead.manager_name : (lead.manager || 'Not assigned')}
                                </span>
                              </div>
                              {/* Probability */}
                              <div className="flex justify-between items-center py-1">
                                <span className="text-sm font-semibold text-gray-500">Probability</span>
                                <span className="text-sm font-bold text-gray-800">{lead.probability || 0}%</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  
                  {/* Mobile Card View for All Leads */}
                  <div className="md:hidden space-y-4">
                    {allOverdueLeads.map((lead, index) => {
                      const daysOverdue = lead.next_followup ? Math.floor((new Date().getTime() - new Date(lead.next_followup).getTime()) / (1000 * 3600 * 24)) : 0;
                      return (
                        <div key={lead.id} className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 border border-red-100 group flex flex-col justify-between min-h-[340px] relative">
                          <div className="flex-1 flex flex-col">
                            {/* Lead Number and Name */}
                            <div className="mb-3 flex items-center gap-2">
                              <span className="text-sm font-semibold text-gray-400 tracking-widest">
                                {lead.lead_number}
                                {lead.lead_type === 'legacy' && <span className="text-sm text-gray-500 ml-1">(L)</span>}
                              </span>
                              <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                              <h3 className="text-xl font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{lead.name}</h3>
                              <span className="text-sm font-bold px-2 py-1 rounded bg-[#3b28c7] text-white">{daysOverdue} days overdue</span>
                            </div>
                            {/* Stage */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Stage</span>
                              <span className="text-sm font-bold text-black">
                                {lead.lead_type === 'legacy' ? lead.stage_name : (lead.stage || 'Follow-up Required')}
                              </span>
                            </div>
                            <div className="space-y-2 divide-y divide-gray-100 mt-2">
                              {/* Category */}
                              <div className="flex justify-between items-center py-1">
                                <span className="text-sm font-semibold text-gray-500">Category</span>
                                <span className="text-sm font-bold text-gray-800">
                                  {lead.lead_type === 'legacy' ? lead.category_name : (lead.category || 'Not specified')}
                                </span>
                              </div>
                              {/* Topic */}
                              <div className="flex justify-between items-center py-1">
                                <span className="text-sm font-semibold text-gray-500">Topic</span>
                                <span className="text-sm font-bold text-gray-800">{lead.topic || 'Not specified'}</span>
                              </div>
                              {/* Expert */}
                              <div className="flex justify-between items-center py-1">
                                <span className="text-sm font-semibold text-gray-500">Expert</span>
                                <span className="text-sm font-bold text-gray-800">
                                  {lead.lead_type === 'legacy' ? lead.expert_name : (lead.expert || 'Not assigned')}
                                </span>
                              </div>
                              {/* Amount */}
                              <div className="flex justify-between items-center py-1">
                                <span className="text-sm font-semibold text-gray-500">Amount</span>
                                <span className="text-sm font-bold text-gray-800">
                                  {lead.lead_type === 'legacy' 
                                    ? `₪${(lead.amount || 0).toLocaleString()}` 
                                    : `${lead.balance_currency || '₪'}${(lead.balance || 0).toLocaleString()}`
                                  }
                                </span>
                              </div>
                              {/* Manager */}
                              <div className="flex justify-between items-center py-1">
                                <span className="text-sm font-semibold text-gray-500">Manager</span>
                                <span className="text-sm font-bold text-gray-800">
                                  {lead.lead_type === 'legacy' ? lead.manager_name : (lead.manager || 'Not assigned')}
                                </span>
                              </div>
                              {/* Probability */}
                              <div className="flex justify-between items-center py-1">
                                <span className="text-sm font-semibold text-gray-500">Probability</span>
                                <span className="text-sm font-bold text-gray-800">{lead.probability || 0}%</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
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
                <div key={index} className="bg-gradient-to-r from-white to-gray-50 rounded-xl p-5 shadow-lg border border-gray-100 hover:shadow-xl hover:scale-[1.02] transition-all duration-300 cursor-pointer group"
                     onClick={() => {
                       // Navigate to client's interactions tab
                       if (message.client_id) {
  
                         navigate(`/clients/${message.lead_number}?tab=interactions`);
                       }
                     }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className={`text-xs px-3 py-1.5 rounded-full font-medium shadow-sm animate-pulse ${
                        message.type === 'email' 
                          ? 'bg-gradient-to-r from-pink-500 via-purple-500 to-purple-600 text-white' 
                          : 'bg-gradient-to-r from-blue-500 via-cyan-500 to-teal-400 text-white'
                      }`}>
                        {message.type === 'email' ? 'Email' : 'WhatsApp'}
                      </span>
                      <span className="font-bold text-gray-900 text-lg">{message.client_name}</span>
                      {message.lead_number && (
                        <span className="text-sm text-gray-600 font-medium">#{message.lead_number}</span>
                      )}
                    </div>
                    <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                      {new Date(message.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                  <p className="text-gray-700 text-sm line-clamp-2 mb-4 leading-relaxed">{message.content}</p>
                  <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                    <span className="text-xs text-gray-600 font-medium">From: {message.sender}</span>
                    <span className="text-xs text-primary font-medium group-hover:text-primary/80 transition-colors">
                      View conversation →
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {latestMessages.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                No new messages in the last 7 days
              </div>
            )}
            <div className="flex justify-center mt-4">
              <button className="btn btn-outline btn-primary" onClick={() => {
                // Refresh the messages by re-fetching
                setExpanded(null);
                setTimeout(() => setExpanded('messages'), 100);
              }}>
                Refresh Messages
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. AI Suggestions (left) and Scoreboard (right) side by side */}
      <div className="flex flex-col md:flex-row mb-10 w-full relative transition-all duration-500 ease-in-out" style={{ alignItems: 'stretch' }}>
        {/* AI Suggestions Box */}
        <div 
          ref={aiRef} 
          className={`bg-white border border-gray-200 rounded-2xl p-4 shadow-lg flex flex-col transition-all duration-500 ease-in-out ${
            aiContainerCollapsed 
              ? 'w-0 p-0 border-0 shadow-none overflow-hidden opacity-0' 
              : 'w-full md:w-1/5 opacity-100'
          }`}
        >
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-900">AI Assistant</h3>
            <button
              onClick={() => setAiContainerCollapsed(true)}
              className="btn btn-ghost btn-sm text-gray-500 hover:text-gray-700 transition-colors"
              title="Close AI Assistant"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
          <AISuggestions />
        </div>
        
        {/* Professional CRM Scoreboard */}
        <div className={`bg-white border border-gray-200 rounded-2xl shadow-lg flex flex-col justify-between transition-all duration-500 ease-in-out ${
          aiContainerCollapsed ? 'w-full' : 'w-full md:w-4/5'
        } ${aiContainerCollapsed ? 'ml-0' : 'md:ml-8'}`}>
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
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
                <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2 bg-purple-50 rounded-lg">
                      <UserGroupIcon className="w-5 h-5 text-purple-600" />
                    </div>
                    {leadsLoading ? (
                      <span className="text-2xl font-bold text-gray-900">Loading...</span>
                    ) : (
                      <span className="text-2xl font-bold text-gray-900">{totalLeadsThisMonth.toLocaleString()}</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-700 font-medium">Leads This Month</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {leadsLoading ? (
                      "Calculating..."
                    ) : (
                      <span className={`font-medium ${isLeadGrowthPositive ? 'text-green-600' : 'text-purple-600'}`}>
                        {isLeadGrowthPositive ? '+' : ''}{leadGrowthPercentage.toFixed(1)}% from last month
                      </span>
                    )}
                  </div>
                </div>
                
                <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2 bg-purple-50 rounded-lg">
                      <CheckCircleIcon className="w-5 h-5 text-purple-600" />
                    </div>
                    {conversionLoading ? (
                      <span className="text-2xl font-bold text-gray-900">Loading...</span>
                    ) : (
                      <span className="text-2xl font-bold text-gray-900">{meetingsScheduledThisMonth.toLocaleString()}</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-700 font-medium">Meetings Scheduled</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {conversionLoading ? (
                      "Calculating..."
                    ) : (
                      <span className="font-medium text-purple-600">
                        {conversionRate.toFixed(1)}% of new leads this month
                      </span>
                    )}
                  </div>
                </div>
                
                <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2 bg-purple-50 rounded-lg">
                      <ArrowTrendingUpIcon className="w-5 h-5 text-purple-600" />
                    </div>
                    {revenueLoading ? (
                      <span className="text-2xl font-bold text-gray-900">Loading...</span>
                    ) : (
                      <span className="text-2xl font-bold text-gray-900">₪{realRevenueThisMonth.toLocaleString()}</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-700 font-medium">Revenue This Month</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {revenueLoading ? (
                      "Calculating..."
                    ) : (
                      <span className={`font-medium ${isAboveTarget ? 'text-green-600' : 'text-purple-600'}`}>
                        {isAboveTarget ? '+' : ''}{revenuePercentage.toFixed(1)}% from ₪2M target
                      </span>
                    )}
                  </div>
                  {/* Progress Bar */}
                  {!revenueLoading && (
                    <div className="mt-3">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full transition-all duration-500 ${
                            isAboveTarget ? 'bg-green-500' : 'bg-purple-500'
                          }`}
                          style={{ width: `${Math.min(revenuePercentage, 100)}%` }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>₪0</span>
                        <span>₪2M Target</span>
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2 bg-purple-50 rounded-lg">
                      <DocumentTextIcon className="w-5 h-5 text-purple-600" />
                    </div>
                    {contractsLoading ? (
                      <span className="text-2xl font-bold text-gray-900">Loading...</span>
                    ) : (
                      <span className="text-2xl font-bold text-gray-900">{contractsSignedThisMonth.toLocaleString()}</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-700 font-medium">Contracts Signed</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {contractsLoading ? (
                      "Calculating..."
                    ) : (
                      <span className={`font-medium ${isContractsGrowthPositive ? 'text-green-600' : 'text-purple-600'}`}>
                        {isContractsGrowthPositive ? '+' : ''}{contractsPercentage.toFixed(1)}% from last month
                      </span>
                    )}
                  </div>
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
                  {/* Desktop: consolidated performance table */}
                  <div className="hidden md:block">
                    <div className="bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden">
                      <div className="flex items-center justify-between p-3 border-b border-slate-200 bg-slate-50">
                        <div className="text-sm font-semibold text-[#3b28c7]">Agreement signed</div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-700 mr-2">Filter by:</span>
                          <button className={`btn btn-xs ${showTodayCols ? 'btn-primary text-white' : 'btn-ghost text-slate-700'}`} onClick={() => setShowTodayCols(v => !v)}>Today</button>
                          <button className={`btn btn-xs ${showLast30Cols ? 'btn-primary text-white' : 'btn-ghost text-slate-700'}`} onClick={() => setShowLast30Cols(v => !v)}>Last 30d</button>
                          <button className={`btn btn-xs ${showLastMonthCols ? 'btn-primary text-white' : 'btn-ghost text-slate-700'}`} onClick={() => setShowLastMonthCols(v => !v)}>This Month</button>
                          <div className="border-l border-slate-300 h-6 mx-2"></div>
                          <button 
                            className={`btn btn-xs ${showRowsAsColumns ? 'btn-primary text-white' : 'btn-ghost text-slate-700'}`} 
                            onClick={() => setShowRowsAsColumns(v => !v)}
                            title="Toggle between rows and columns view"
                          >
                            {showRowsAsColumns ? 'Rows' : 'Columns'}
                          </button>
                        </div>
                      </div>
                      {showRowsAsColumns ? renderColumnsView('agreement') : (
                        <table className="min-w-full text-sm">
                          <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="text-left px-5 py-3 font-semibold text-slate-700">Department</th>
                            {showTodayCols && (
                              <th className="text-right px-5 py-3 font-semibold text-slate-700">Today</th>
                            )}
                            {showLast30Cols && (
                              <th className="text-right px-5 py-3 font-semibold text-slate-700">Last 30d</th>
                            )}
                            {showLastMonthCols && (
                              <>
                                <th className="text-right px-5 py-3 font-semibold text-slate-700">{new Date().toLocaleDateString('en-US', { month: 'long' })}</th>
                                <th className="text-right px-5 py-3 font-semibold text-slate-700 bg-slate-100">Target {new Date().toLocaleDateString('en-US', { month: 'long' })}</th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {/* Commercial & Civil */}
                          <tr className="hover:bg-slate-50">
                            <td className="px-5 py-3 font-semibold text-slate-700">Commercial & Civil</td>
                            {showTodayCols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{agreementData.Today[1].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{agreementData.Today[1].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLast30Cols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{agreementData["Last 30d"][1].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{agreementData["Last 30d"][1].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLastMonthCols && (<>
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{agreementData.August[1].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{agreementData.August[1].amount.toLocaleString()}</div>
                                </div>
                              </td>
                              <td className="px-5 py-3 text-right font-semibold text-slate-700 bg-slate-100">
                                <div className="text-right">₪{agreementData.August[1].expected.toLocaleString()}</div>
                              </td>
                            </>)}
                          </tr>
                          {/* Small cases */}
                          <tr className="hover:bg-slate-50">
                            <td className="px-5 py-3 font-semibold text-slate-700">Small cases</td>
                            {showTodayCols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{agreementData.Today[2].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{agreementData.Today[2].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLast30Cols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{agreementData["Last 30d"][2].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{agreementData["Last 30d"][2].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLastMonthCols && (<>
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{agreementData.August[2].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{agreementData.August[2].amount.toLocaleString()}</div>
                                </div>
                              </td>
                              <td className="px-5 py-3 text-right font-semibold text-slate-700 bg-slate-100">
                                <div className="text-right">₪{agreementData.August[2].expected.toLocaleString()}</div>
                              </td>
                            </>)}
                          </tr>
                          {/* USA - Immigration */}
                          <tr className="hover:bg-slate-50">
                            <td className="px-5 py-3 font-semibold text-slate-700">USA - Immigration</td>
                            {showTodayCols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{agreementData.Today[3].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{agreementData.Today[3].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLast30Cols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{agreementData["Last 30d"][3].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{agreementData["Last 30d"][3].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLastMonthCols && (<>
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{agreementData.August[3].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{agreementData.August[3].amount.toLocaleString()}</div>
                                </div>
                              </td>
                              <td className="px-5 py-3 text-right font-semibold text-slate-700 bg-slate-100">
                                <div className="text-right">₪{agreementData.August[3].expected.toLocaleString()}</div>
                              </td>
                            </>)}
                          </tr>
                          {/* Immigration to Israel */}
                          <tr className="hover:bg-slate-50">
                            <td className="px-5 py-3 font-semibold text-slate-700">Immigration to Israel</td>
                            {showTodayCols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{agreementData.Today[4].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{agreementData.Today[4].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLast30Cols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{agreementData["Last 30d"][4].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{agreementData["Last 30d"][4].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLastMonthCols && (<>
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{agreementData.August[4].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{agreementData.August[4].amount.toLocaleString()}</div>
                                </div>
                              </td>
                              <td className="px-5 py-3 text-right font-semibold text-slate-700 bg-slate-100">
                                <div className="text-right">₪{agreementData.August[4].expected.toLocaleString()}</div>
                              </td>
                            </>)}
                          </tr>
                          {/* Austria and Germany */}
                          <tr className="hover:bg-slate-50">
                            <td className="px-5 py-3 font-semibold text-slate-700">Austria and Germany</td>
                            {showTodayCols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{agreementData.Today[5].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{agreementData.Today[5].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLast30Cols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{agreementData["Last 30d"][5].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{agreementData["Last 30d"][5].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLastMonthCols && (<>
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{agreementData.August[5].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{agreementData.August[5].amount.toLocaleString()}</div>
                                </div>
                              </td>
                              <td className="px-5 py-3 text-right font-semibold text-slate-700 bg-slate-100">
                                <div className="text-right">₪{agreementData.August[5].expected.toLocaleString()}</div>
                              </td>
                            </>)}
                          </tr>
                          {/* Total */}
                          <tr className="bg-gradient-to-tr from-[#4b2996] via-[#6c4edb] to-[#3b28c7]">
                            <td className="px-5 py-3"><span className="font-semibold text-white">Total</span></td>
                            {showTodayCols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{agreementData.Today[6].count}</div>
                                  <div className="border-t border-white/20 my-1"></div>
                                  <div className="font-semibold text-white">₪{agreementData.Today[6].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLast30Cols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{agreementData["Last 30d"][6].count}</div>
                                  <div className="border-t border-white/20 my-1"></div>
                                  <div className="font-semibold text-white">₪{agreementData["Last 30d"][6].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLastMonthCols && (<>
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{agreementData.August[6].count}</div>
                                  <div className="border-t border-white/20 my-1"></div>
                                  <div className="font-semibold text-white">₪{agreementData.August[6].amount.toLocaleString()}</div>
                                </div>
                              </td>
                              <td className="px-5 py-3 text-right text-white font-semibold">
                                <div className="text-right">₪{agreementData.August[6].expected.toLocaleString()}</div>
                              </td>
                            </>)}
                          </tr>
                        </tbody>
                      </table>
                      )}
                    </div>
                              </div>
                              
                  {/* Duplicate table for Invoiced section */}
                  <div className="hidden md:block mt-6">
                    <div className="bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden">
                      <div className="flex items-center justify-between p-3 border-b border-slate-200 bg-slate-50">
                        <div className="text-sm font-semibold text-[#3b28c7]">Invoiced</div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-700 mr-2">Filter by:</span>
                          <button className={`btn btn-xs ${showTodayCols ? 'btn-primary text-white' : 'btn-ghost text-slate-700'}`} onClick={() => setShowTodayCols(v => !v)}>Today</button>
                          <button className={`btn btn-xs ${showLast30Cols ? 'btn-primary text-white' : 'btn-ghost text-slate-700'}`} onClick={() => setShowLast30Cols(v => !v)}>Last 30d</button>
                          <button className={`btn btn-xs ${showLastMonthCols ? 'btn-primary text-white' : 'btn-ghost text-slate-700'}`} onClick={() => setShowLastMonthCols(v => !v)}>This Month</button>
                          <div className="border-l border-slate-300 h-6 mx-2"></div>
                          <button 
                            className={`btn btn-xs ${showRowsAsColumns ? 'btn-primary text-white' : 'btn-ghost text-slate-700'}`} 
                            onClick={() => setShowRowsAsColumns(v => !v)}
                            title="Toggle between rows and columns view"
                          >
                            {showRowsAsColumns ? 'Rows' : 'Columns'}
                          </button>
                        </div>
                      </div>
                      {showRowsAsColumns ? renderColumnsView('invoiced') : (
                        <table className="min-w-full text-sm">
                          <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="text-left px-5 py-3 font-semibold text-slate-700">Department</th>
                            {showTodayCols && (
                              <th className="text-right px-5 py-3 font-semibold text-slate-700">Today</th>
                            )}
                            {showLast30Cols && (
                              <th className="text-right px-5 py-3 font-semibold text-slate-700">Last 30d</th>
                            )}
                            {showLastMonthCols && (
                              <>
                                <th className="text-right px-5 py-3 font-semibold text-slate-700">{new Date().toLocaleDateString('en-US', { month: 'long' })}</th>
                                <th className="text-right px-5 py-3 font-semibold text-slate-700 bg-slate-100">Target {new Date().toLocaleDateString('en-US', { month: 'long' })}</th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {/* Commercial & Civil */}
                          <tr className="hover:bg-slate-50">
                            <td className="px-5 py-3 font-semibold text-slate-700">Commercial & Civil</td>
                            {showTodayCols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{invoicedData.Today[1].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{invoicedData.Today[1].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLast30Cols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{invoicedData["Last 30d"][1].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{invoicedData["Last 30d"][1].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLastMonthCols && (<>
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{invoicedData.August[1].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{invoicedData.August[1].amount.toLocaleString()}</div>
                                </div>
                              </td>
                              <td className="px-5 py-3 text-right font-semibold text-slate-700 bg-slate-100">
                                <div className="text-right">₪{invoicedData.August[1].expected.toLocaleString()}</div>
                              </td>
                            </>)}
                          </tr>
                          {/* Small cases */}
                          <tr className="hover:bg-slate-50">
                            <td className="px-5 py-3 font-semibold text-slate-700">Small cases</td>
                            {showTodayCols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{invoicedData.Today[2].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{invoicedData.Today[2].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLast30Cols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{invoicedData["Last 30d"][2].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{invoicedData["Last 30d"][2].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLastMonthCols && (<>
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{invoicedData.August[2].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{invoicedData.August[2].amount.toLocaleString()}</div>
                                </div>
                              </td>
                              <td className="px-5 py-3 text-right font-semibold text-slate-700 bg-slate-100">
                                <div className="text-right">₪{invoicedData.August[2].expected.toLocaleString()}</div>
                              </td>
                            </>)}
                          </tr>
                          {/* USA - Immigration */}
                          <tr className="hover:bg-slate-50">
                            <td className="px-5 py-3 font-semibold text-slate-700">USA - Immigration</td>
                            {showTodayCols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{invoicedData.Today[3].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{invoicedData.Today[3].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLast30Cols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{invoicedData["Last 30d"][3].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{invoicedData["Last 30d"][3].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLastMonthCols && (<>
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{invoicedData.August[3].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{invoicedData.August[3].amount.toLocaleString()}</div>
                                </div>
                              </td>
                              <td className="px-5 py-3 text-right font-semibold text-slate-700 bg-slate-100">
                                <div className="text-right">₪{invoicedData.August[3].expected.toLocaleString()}</div>
                              </td>
                            </>)}
                          </tr>
                          {/* Immigration to Israel */}
                          <tr className="hover:bg-slate-50">
                            <td className="px-5 py-3 font-semibold text-slate-700">Immigration to Israel</td>
                            {showTodayCols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{invoicedData.Today[4].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{invoicedData.Today[4].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLast30Cols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{invoicedData["Last 30d"][4].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{invoicedData["Last 30d"][4].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLastMonthCols && (<>
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{invoicedData.August[4].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{invoicedData.August[4].amount.toLocaleString()}</div>
                                </div>
                              </td>
                              <td className="px-5 py-3 text-right font-semibold text-slate-700 bg-slate-100">
                                <div className="text-right">₪{invoicedData.August[4].expected.toLocaleString()}</div>
                              </td>
                            </>)}
                          </tr>
                          {/* Austria and Germany */}
                          <tr className="hover:bg-slate-50">
                            <td className="px-5 py-3 font-semibold text-slate-700">Austria and Germany</td>
                            {showTodayCols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{invoicedData.Today[5].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{invoicedData.Today[5].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLast30Cols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{invoicedData["Last 30d"][5].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{invoicedData["Last 30d"][5].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLastMonthCols && (<>
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{invoicedData.August[5].count}</div>
                                  <div className="border-t border-slate-200 my-1"></div>
                                  <div className="font-semibold text-slate-700">₪{invoicedData.August[5].amount.toLocaleString()}</div>
                                </div>
                              </td>
                              <td className="px-5 py-3 text-right font-semibold text-slate-700 bg-slate-100">
                                <div className="text-right">₪{invoicedData.August[5].expected.toLocaleString()}</div>
                              </td>
                            </>)}
                          </tr>
                          {/* Total */}
                          <tr className="bg-gradient-to-tr from-[#4b2996] via-[#6c4edb] to-[#3b28c7]">
                            <td className="px-5 py-3"><span className="font-semibold text-white">Total</span></td>
                            {showTodayCols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{invoicedData.Today[6].count}</div>
                                  <div className="border-t border-white/20 my-1"></div>
                                  <div className="font-semibold text-white">₪{invoicedData.Today[6].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLast30Cols && (
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{invoicedData["Last 30d"][6].count}</div>
                                  <div className="border-t border-white/20 my-1"></div>
                                  <div className="font-semibold text-white">₪{invoicedData["Last 30d"][6].amount.toLocaleString()}</div>
                                </div>
                              </td>
                            )}
                            {showLastMonthCols && (<>
                              <td className="px-5 py-3 text-right">
                                <div className="space-y-1">
                                  <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{invoicedData.August[6].count}</div>
                                  <div className="border-t border-white/20 my-1"></div>
                                  <div className="font-semibold text-white">₪{invoicedData.August[6].amount.toLocaleString()}</div>
                                </div>
                              </td>
                              <td className="px-5 py-3 text-right text-white font-semibold">
                                <div className="text-right">₪{invoicedData.August[6].expected.toLocaleString()}</div>
                              </td>
                            </>)}
                          </tr>
                        </tbody>
                        </table>
                      )}
                    </div>
                                  </div>
                                  
                  {/* Mobile: keep card grid */}
                  <div className="grid grid-cols-1 gap-4 md:hidden">
                    {scoreboardCategories.map((category, index) => {
                      const todayData = agreementData["Today"][index];
                      const last30Data = agreementData["Last 30d"][index];
                      const isFlipped = flippedCards.has(category);
                      const chartData = generateDepartmentData(category);
                      return (
                        <div key={category} className="relative h-64" style={{ perspective: '1000px' }}>
                          <div className="relative w-full h-full transition-transform duration-700 cursor-pointer" style={{ transformStyle: 'preserve-3d', transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }} onClick={() => handleCardFlip(category)}>
                            <div className="absolute inset-0 bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden group" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(0deg)' }}>
                              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                                <h4 className="text-sm font-semibold text-slate-800 text-center">{category}</h4>
                              </div>
                              <div className="p-4">
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                  <div className="bg-slate-50 rounded-lg p-3">
                                    <div className="flex items-center gap-2 mb-2">
                                      <div className="w-2 h-2 bg-indigo-500 rounded-full"></div>
                                      <span className="text-xs font-medium text-slate-600">Today</span>
                                    </div>
                                    <div className="space-y-1">
                                      <div className="text-lg font-bold text-slate-800">{todayData.count}</div>
                                      <div className="text-xs font-medium text-slate-600">₪{todayData.amount ? todayData.amount.toLocaleString() : '0'}</div>
                                        </div>
                                    </div>
                                  <div className="bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg p-3 border border-purple-400">
                                    <div className="flex items-center gap-2 mb-2">
                                      <div className="w-2 h-2 bg-white rounded-full"></div>
                                      <span className="text-xs font-medium text-white">Last 30d</span>
                                  </div>
                                    <div className="space-y-1">
                                      <div className="text-lg font-bold text-white">{last30Data.count}</div>
                                      <div className="text-xs font-medium text-white/90">₪{last30Data.amount ? last30Data.amount.toLocaleString() : '0'}</div>
                                </div>
                                      </div>
                                    </div>
                                  </div>
                              <div className="absolute bottom-2 right-2 text-xs text-gray-400">Tap to view</div>
                              </div>
                            <div className="absolute inset-0 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl border border-purple-300 shadow-lg overflow-hidden" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                              <div className="px-4 py-3 bg-white/10 border-b border-white/20">
                                <h4 className="text-sm font-semibold text-white text-center">{category} - 30 Day Trend</h4>
                              </div>
                              <div className="p-4 h-full">
                                <div className="w-full h-40">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'white' }} axisLine={{ stroke: 'white' }} tickLine={{ stroke: 'white' }} interval={5} />
                                      <YAxis tick={{ fontSize: 10, fill: 'white' }} axisLine={{ stroke: 'white' }} tickLine={{ stroke: 'white' }} width={25} />
                                      <Tooltip contentStyle={{ background: 'rgba(255,255,255,0.98)', borderRadius: 12, border: '1px solid #e5e7eb' }} itemStyle={{ color: '#6366f1', fontWeight: 600 }} />
                                      <Line type="monotone" dataKey="contracts" stroke="#ffffff" strokeWidth={3} dot={{ r: 3, fill: '#fff' }} />
                                    </LineChart>
                                  </ResponsiveContainer>
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
                        const chartData = scoreTab === 'Today' ? scoreboardBarDataToday : scoreTab === 'August' || scoreTab === currentMonthName ? scoreboardBarDataAugust : scoreboardBarData30d;
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
                                  if (name === 'signed') return [`${value.toLocaleString()} NIS`, 'Signed'];
                                  if (name === 'due') return [`${value.toLocaleString()} NIS`, 'Due'];
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
                          const data = scoreTab === 'Today' ? scoreboardBarDataToday : scoreTab === 'August' || scoreTab === currentMonthName ? scoreboardBarDataAugust : scoreboardBarData30d;
                          return data.reduce((sum: number, item: any) => sum + item.signed, 0);
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
                          const data = scoreTab === 'Today' ? scoreboardBarDataToday : scoreTab === 'August' || scoreTab === currentMonthName ? scoreboardBarDataAugust : scoreboardBarData30d;
                          return data.reduce((sum: number, item: any) => sum + item.due, 0);
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
                          const data = scoreTab === 'Today' ? scoreboardBarDataToday : scoreTab === 'August' || scoreTab === currentMonthName ? scoreboardBarDataAugust : scoreboardBarData30d;
                          const signed = data.reduce((sum: number, item: any) => sum + item.signed, 0);
                          const due = data.reduce((sum: number, item: any) => sum + item.due, 0);
                          const total = signed + due;
                          return total > 0 ? `${Math.round((signed / total) * 100)}%` : '0%';
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Quick Actions removed per request */}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Top Workers Row: 4 boxes */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6 w-full mb-12 px-4 md:px-0">
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
        <div className="rounded-3xl p-0.5 bg-gradient-to-tr from-white via-white to-white">
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

      {/* Floating button to reopen AI container */}
      {aiContainerCollapsed && (
        <button
          onClick={() => setAiContainerCollapsed(false)}
          className="fixed right-8 top-1/2 transform -translate-y-1/2 z-50 btn btn-circle btn-lg bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-110 border-none"
          title="Open AI Assistant"
        >
          <ChatBubbleLeftRightIcon className="w-6 h-6" />
        </button>
      )}

      {/* AI Suggestions Modal */}
      <AISuggestionsModal 
        isOpen={isAISuggestionsModalOpen}
        onClose={() => setIsAISuggestionsModalOpen(false)}
      />

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