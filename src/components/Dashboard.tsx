import React, { useState, useEffect, useRef } from 'react';
import Meetings from './Meetings';
import AISuggestions from './AISuggestions';
import AISuggestionsModal from './AISuggestionsModal';
import OverdueFollowups from './OverdueFollowups';
import UnavailableEmployeesModal from './UnavailableEmployeesModal';
import { UserGroupIcon, CalendarIcon, ExclamationTriangleIcon, ChatBubbleLeftRightIcon, ArrowTrendingUpIcon, ChartBarIcon, ChevronLeftIcon, ChevronRightIcon, XMarkIcon, ClockIcon, SparklesIcon, MagnifyingGlassIcon, FunnelIcon, CheckCircleIcon, PlusIcon, ArrowPathIcon, VideoCameraIcon, PhoneIcon, EnvelopeIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { convertToNIS, calculateTotalRevenueInNIS } from '../lib/currencyConversion';
import { PieChart as RechartsPieChart, Pie, Cell } from 'recharts';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot, ReferenceArea, BarChart, Bar, Legend as RechartsLegend, CartesianGrid } from 'recharts';
import { RadialBarChart, RadialBar, PolarAngleAxis, Legend } from 'recharts';
import { useMsal } from '@azure/msal-react';
import { DateTime } from 'luxon';
import { FaWhatsapp } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import { getStageName } from '../lib/stageUtils';
import EmployeeScoreboard from './EmployeeScoreboard';





const Dashboard: React.FC = () => {
  // Get the current month name
  const currentMonthName = new Date().toLocaleString('en-US', { month: 'long' });
  
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
  const [isUnavailableEmployeesModalOpen, setIsUnavailableEmployeesModalOpen] = useState(false);
  const [unavailableEmployeesCount, setUnavailableEmployeesCount] = useState(0);
  const [currentlyUnavailableCount, setCurrentlyUnavailableCount] = useState(0);
  const [scheduledTimeOffCount, setScheduledTimeOffCount] = useState(0);
  const [unavailableEmployeesData, setUnavailableEmployeesData] = useState<any[]>([]);
  const [unavailableEmployeesLoading, setUnavailableEmployeesLoading] = useState(false);

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


  // Fetch detailed unavailable employees data for table
  const fetchUnavailableEmployeesData = async () => {
    setUnavailableEmployeesLoading(true);
    try {
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      const todayString = `${year}-${month}-${day}`;

      const { data: employees, error } = await supabase
        .from('tenants_employee')
        .select('id, display_name, unavailable_times, unavailable_ranges')
        .not('unavailable_times', 'is', null);

      if (error) {
        console.error('Error fetching employees for stats:', error);
        return;
      }

      if (!employees) {
        setUnavailableEmployeesData([]);
        setUnavailableEmployeesCount(0);
        setCurrentlyUnavailableCount(0);
        setScheduledTimeOffCount(0);
        return;
      }

      let totalUnavailable = 0;
      let currentlyUnavailable = 0;
      let scheduledTimeOff = 0;
      const detailedData: any[] = [];

      const now = new Date();
      const currentTime = now.getHours() * 60 + now.getMinutes();

      employees.forEach(employee => {
        const unavailableTimes = employee.unavailable_times || [];
        const unavailableRanges = employee.unavailable_ranges || [];
        
        // Check for specific time slots today
        const todayTimes = unavailableTimes.filter((time: any) => time.date === todayString);
        
        // Check for date ranges that include today
        const todayRanges = unavailableRanges.filter((range: any) => 
          todayString >= range.startDate && todayString <= range.endDate
        );

        if (todayTimes.length > 0 || todayRanges.length > 0) {
          totalUnavailable++;

          // Process time slots
          todayTimes.forEach((time: any) => {
            const startTime = parseInt(time.startTime.split(':')[0]) * 60 + parseInt(time.startTime.split(':')[1]);
            const endTime = parseInt(time.endTime.split(':')[0]) * 60 + parseInt(time.endTime.split(':')[1]);
            const isCurrentlyActive = currentTime >= startTime && currentTime <= endTime;
            
            if (isCurrentlyActive) {
              currentlyUnavailable++;
            } else {
              scheduledTimeOff++;
            }

            const formattedDate = new Date(time.date).toLocaleDateString('en-GB', {
              day: '2-digit',
              month: '2-digit'
            });

            detailedData.push({
              id: `${employee.id}-${time.id}`,
              employeeName: employee.display_name,
              date: formattedDate,
              time: `${time.startTime} - ${time.endTime}`,
              reason: time.reason,
              isActive: isCurrentlyActive
            });
          });

          // Process date ranges
          todayRanges.forEach((range: any) => {
            scheduledTimeOff++;

            const startDateFormatted = new Date(range.startDate).toLocaleDateString('en-GB', {
              day: '2-digit',
              month: '2-digit'
            });
            const endDateFormatted = new Date(range.endDate).toLocaleDateString('en-GB', {
              day: '2-digit',
              month: '2-digit'
            });

            detailedData.push({
              id: `${employee.id}-${range.id}`,
              employeeName: employee.display_name,
              date: `${startDateFormatted} to ${endDateFormatted}`,
              time: 'All Day',
              reason: range.reason,
              isActive: false
            });
          });
        }
      });

      setUnavailableEmployeesData(detailedData);
      setUnavailableEmployeesCount(totalUnavailable);
      setCurrentlyUnavailableCount(currentlyUnavailable);
      setScheduledTimeOffCount(scheduledTimeOff);
    } catch (error) {
      console.error('Error fetching unavailable employees data:', error);
    } finally {
      setUnavailableEmployeesLoading(false);
    }
  };

  // Optimized function to fetch overdue leads data using employee relationship
  const fetchOverdueLeadsData = async (fetchAll = false) => {
    try {
      // Get current user's data with employee relationship using JOIN
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return { newLeads: [], legacyLeads: [], totalCount: 0 };
      }

      console.log('🔍 Dashboard - Fetching user data for auth_id:', user.id);
      const { data: userData, error: userDataError } = await supabase
        .from('users')
        .select(`
          id,
          full_name,
          employee_id,
          tenants_employee!employee_id(
            id,
            display_name
          )
        `)
        .eq('auth_id', user.id)
        .single();

      if (userDataError) {
        console.error('❌ Dashboard - Error fetching user data:', userDataError);
        console.error('❌ Dashboard - User data error details:', {
          message: userDataError.message,
          details: userDataError.details,
          hint: userDataError.hint,
          code: userDataError.code
        });
        return { newLeads: [], legacyLeads: [], totalCount: 0 };
      }

      if (!userData) {
        return { newLeads: [], legacyLeads: [], totalCount: 0 };
      }

      // Use display_name from employee table or full_name from users table
      const userFullName = (userData.tenants_employee as any)?.display_name || userData.full_name;
      const userEmployeeId = userData.employee_id;
      
      if (!userFullName) {
        return { newLeads: [], legacyLeads: [], totalCount: 0 };
      }
      
      const today = new Date().toISOString().split('T')[0];
      const fiftyDaysAgo = new Date();
      fiftyDaysAgo.setDate(fiftyDaysAgo.getDate() - 50);
      const fiftyDaysAgoStr = fiftyDaysAgo.toISOString().split('T')[0];
      
      // Fetch new leads (using display_name for filtering)
      const { data: newLeadsData, error: newLeadsError } = await supabase
        .from('leads')
        .select('id, lead_number, name, stage, topic, next_followup, expert, manager, meeting_manager, category, balance, balance_currency, probability')
        .lte('next_followup', today)
        .gte('next_followup', fiftyDaysAgoStr)
        .not('next_followup', 'is', null)
        .or(`expert.eq.${userFullName},manager.eq.${userFullName},meeting_manager.eq.${userFullName}`)
        .limit(fetchAll ? 1000 : 12);

      if (newLeadsError) throw newLeadsError;

      // Fetch legacy leads (using employee ID for efficient filtering)
      let legacyLeadsData: any[] = [];
      let legacyLeadsError: any = null;
      
      if (userEmployeeId) {
        const { data, error } = await supabase
          .from('leads_lead')
          .select('id, name, stage, topic, next_followup, expert_id, meeting_manager_id, category_id, total, currency_id')
          .lte('next_followup', today)
          .gte('next_followup', fiftyDaysAgoStr)
          .not('next_followup', 'is', null)
          .eq('status', 0)
          .lt('stage', 100)
          .or(`expert_id.eq."${userEmployeeId}",meeting_manager_id.eq."${userEmployeeId}"`)
          .limit(fetchAll ? 1000 : 12);
        
        legacyLeadsData = data || [];
        legacyLeadsError = error;
      }

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
    // Fetch overdue followups - optimized count query using employee relationship
    (async () => {
      // Prevent multiple calls
      if (overdueCountFetched) return;
      setOverdueCountFetched(true);
      
      try {
        // Get current user's data with employee relationship using JOIN
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setOverdueFollowups(0);
          return;
        }

        console.log('🔍 Dashboard - Fetching user data for overdue followups, auth_id:', user.id);
        const { data: userData, error: userDataError } = await supabase
          .from('users')
          .select(`
            id,
            full_name,
            employee_id,
            tenants_employee!employee_id(
              id,
              display_name
            )
          `)
          .eq('auth_id', user.id)
          .single();

        if (userDataError) {
          console.error('❌ Dashboard - Error fetching user data for overdue followups:', userDataError);
          console.error('❌ Dashboard - User data error details:', {
            message: userDataError.message,
            details: userDataError.details,
            hint: userDataError.hint,
            code: userDataError.code
          });
          setOverdueFollowups(0);
          return;
        }

        if (!userData) {
          setOverdueFollowups(0);
          return;
        }

        // Use display_name from employee table or full_name from users table
        const userFullName = (userData.tenants_employee as any)?.display_name || userData.full_name;
        const userEmployeeId = userData.employee_id;
        
        if (!userFullName) {
          setOverdueFollowups(0);
          return;
        }
        
        const todayStr = new Date().toISOString().split('T')[0];
        const fiftyDaysAgo = new Date();
        fiftyDaysAgo.setDate(fiftyDaysAgo.getDate() - 50);
        const fiftyDaysAgoStr = fiftyDaysAgo.toISOString().split('T')[0];
        
        // Optimized count queries using employee relationship
        const countPromises = [
          supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .lte('next_followup', todayStr)
            .gte('next_followup', fiftyDaysAgoStr)
            .not('next_followup', 'is', null)
            .or(`expert.eq.${userFullName},manager.eq.${userFullName},meeting_manager.eq.${userFullName}`)
        ];
        
        // Only add legacy leads query if we have employee ID
        if (userEmployeeId) {
          countPromises.push(
            supabase
              .from('leads_lead')
              .select('*', { count: 'exact', head: true })
              .lte('next_followup', todayStr)
              .gte('next_followup', fiftyDaysAgoStr)
              .not('next_followup', 'is', null)
              .eq('status', 0)
              .lt('stage', 100)
              .or(`expert_id.eq."${userEmployeeId}",meeting_manager_id.eq."${userEmployeeId}"`)
          );
        }
        
        const results = await Promise.all(countPromises);
        const [newLeadsCount, legacyLeadsCount] = results;
        
        const totalCount = (newLeadsCount.count || 0) + (legacyLeadsCount?.count || 0);
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
        console.log('🔍 Dashboard - Fetching user leads for auth_id:', user.id);
        const { data: userLeads, error: userLeadsError } = await supabase
          .from('users')
          .select('id')
          .eq('auth_id', user.id)
          .single();

        if (userLeadsError) {
          console.error('❌ Dashboard - Error fetching user leads:', userLeadsError);
          console.error('❌ Dashboard - User leads error details:', {
            message: userLeadsError.message,
            details: userLeadsError.details,
            hint: userLeadsError.hint,
            code: userLeadsError.code
          });
          return;
        }

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
    { month: `${currentMonthName} 2025`, count: 41 },
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
  const contractsThisMonth = performanceData.filter(d => d.isThisMonth).reduce((sum: number, d: { count: number; isThisMonth: boolean }) => sum + d.count, 0);
  const contractsLast30 = performanceData.reduce((sum: number, d: { count: number }) => sum + d.count, 0);

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

  // Department Performance data
  const [departmentPerformanceLoading, setDepartmentPerformanceLoading] = useState<boolean>(true);
  const [invoicedDataLoading, setInvoicedDataLoading] = useState<boolean>(true);

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
          const total = data.reduce((sum: number, row: { value: string | number; value_vat: string | number }) => {
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

  // Fetch department performance data
  const fetchDepartmentPerformance = async () => {
      setDepartmentPerformanceLoading(true);
      try {
        console.log('🔍 Starting department performance fetch...');
        
        const now = new Date();
        const today = new Date();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(now.getDate() - 30);
        
        // Use selected month and year instead of current month
        const selectedMonthIndex = months.indexOf(selectedMonth);
        const selectedDate = new Date(selectedYear, selectedMonthIndex, 1);
        const selectedMonthName = selectedDate.toLocaleDateString('en-US', { month: 'long' });
        
        console.log('📅 Selected month/year:', selectedMonth, selectedYear);
        console.log('📅 Selected month index:', selectedMonthIndex);
        console.log('📅 Selected month name for display:', selectedMonthName);
        
        // Fetch only important departments from tenant_departement
        console.log('🎯 Fetching important departments from tenant_departement...');
        const { data: allDepartments, error: departmentsError } = await supabase
          .from('tenant_departement')
          .select('id, name, min_income, important')
          .eq('important', 't')
          .order('id');
        
        if (departmentsError) {
          console.error('❌ Error fetching departments:', departmentsError);
          throw departmentsError;
        }
        
        // Extract department IDs and create target mapping
        const departmentIds = allDepartments?.map(dept => dept.id) || [];
        const departmentTargets = allDepartments || [];
        
        console.log('📊 All department IDs found:', departmentIds);
        console.log('🎯 All department targets:', departmentTargets);
        
        // Log which departments are important
        const importantDepts = departmentTargets.filter(dept => dept.important === 't');
        console.log('⭐ Important departments:', importantDepts.map(dept => `${dept.id}: ${dept.name} (important: ${dept.important})`));
        
        // Debug: Log each department with its index
        console.log('🔍 Department mapping debug:');
        departmentTargets.forEach((dept, index) => {
          console.log(`  Index ${index}: ID ${dept.id} -> "${dept.name}" (important: ${dept.important})`);
        });
        
        // Set department names for UI display
        const names = departmentTargets.map(dept => dept.name);
        setDepartmentNames(names);
        console.log('📝 All department names set:', names);
        
        // Debug: Show the exact mapping of ID -> Name -> Target
        console.log('🎯 Department mapping for UI:');
        departmentTargets.forEach((dept, index) => {
          console.log(`  UI Index ${index}: ID ${dept.id} -> "${dept.name}" -> Target: ₪${dept.min_income}`);
        });
        
        // Create target map (department ID -> min_income)
        const targetMap: { [key: number]: number } = {};
        departmentTargets?.forEach(dept => {
          targetMap[dept.id] = parseFloat(dept.min_income || '0');
        });
        
        console.log('🎯 Target map created:', targetMap);
        
        // Initialize data structure dynamically based on actual departments
        const newAgreementData = {
          Today: [
            { count: 0, amount: 0, expected: 0 }, // General (index 0)
            ...departmentTargets.map(dept => ({ 
              count: 0, 
              amount: 0, 
              expected: parseFloat(dept.min_income || '0') 
            })), // Actual departments
            { count: 0, amount: 0, expected: 0 }, // Total (last index)
          ],
          "Last 30d": [
            { count: 0, amount: 0, expected: 0 }, // General (index 0)
            ...departmentTargets.map(dept => ({ 
              count: 0, 
              amount: 0, 
              expected: parseFloat(dept.min_income || '0') 
            })), // Actual departments
            { count: 0, amount: 0, expected: 0 }, // Total (last index)
          ],
          [selectedMonthName]: [
            ...departmentTargets.map(dept => ({ 
              count: 0, 
              amount: 0, 
              expected: parseFloat(dept.min_income || '0') 
            })), // Actual departments (no General column for month view)
            { count: 0, amount: 0, expected: 0 }, // Total (last index)
          ],
        };
        
        // Calculate date ranges
        const todayStr = today.toISOString().split('T')[0];
        const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
        
        // Fix timezone issue: Use UTC to avoid timezone conversion problems
        const startOfMonth = new Date(Date.UTC(selectedYear, selectedMonthIndex, 1));
        const startOfMonthStr = startOfMonth.toISOString().split('T')[0];
        
        // Check if we're at the end of the month (last 3 days)
        const daysInMonth = new Date(selectedYear, selectedMonthIndex + 1, 0).getDate();
        const isEndOfMonth = now.getDate() >= (daysInMonth - 2);
        
        // If we're at the end of the month, Last 30d should cover the entire month
        const effectiveThirtyDaysAgo = isEndOfMonth ? startOfMonthStr : thirtyDaysAgoStr;
        
        console.log('📅 Date calculation details:');
        console.log('  - Current date:', now.toDateString());
        console.log('  - Current month:', now.getMonth() + 1);
        console.log('  - Days in month:', daysInMonth);
        console.log('  - Current day:', now.getDate());
        console.log('  - Is end of month:', isEndOfMonth);
        console.log('  - Start of month (UTC):', startOfMonthStr);
        console.log('  - Thirty days ago:', thirtyDaysAgoStr);
        console.log('  - Effective 30 days ago:', effectiveThirtyDaysAgo);
        
        // For date comparison, we need to extract just the date part from the record date
        const extractDateFromRecord = (recordDate: string) => {
          // Handle both ISO string format and date-only format
          if (recordDate.includes('T')) {
            return recordDate.split('T')[0];
          }
          return recordDate;
        };
        
        console.log('📅 Date ranges calculated:');
        console.log('  - Today:', todayStr);
        console.log('  - 30 days ago:', thirtyDaysAgoStr);
        console.log('  - Start of month:', startOfMonthStr);
        console.log('  - Current date:', now.toDateString());
        console.log('  - Current month:', now.getMonth() + 1);
        console.log('  - Days in current month:', new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
        
        // CORRECT APPROACH: Query leads_leadstage for stage 60 (agreement signed) separately
        // Fetch data for Today and Last 30d (always current date range)
        console.log('📋 Fetching leads_leadstage records (stage 60 - agreement signed) for Today and Last 30d...');
        const { data: stageRecords, error: stageError } = await supabase
          .from('leads_leadstage')
          .select('id, date, lead_id')
          .eq('stage', 60)
          .gte('date', thirtyDaysAgoStr)
          .lte('date', todayStr);
        
        if (stageError) {
          console.error('❌ Error fetching stage records:', stageError);
          throw stageError;
        }
        
        console.log('✅ Stage records fetched:', stageRecords?.length || 0, 'records');
        
        // Debug: Check if there are any stage records at all (without date filter)
        if (stageRecords?.length === 0) {
          console.log('🔍 No stage records found for date range. Checking all stage 60 records...');
          const { data: allStageRecords, error: allStageError } = await supabase
            .from('leads_leadstage')
            .select('id, date, lead_id')
            .eq('stage', 60)
            .order('date', { ascending: false })
            .limit(10);
          
          if (allStageError) {
            console.error('❌ Error fetching all stage records:', allStageError);
          } else {
            console.log('📊 Recent stage 60 records (last 10):', allStageRecords?.map(record => ({
              id: record.id,
              date: record.date,
              lead_id: record.lead_id
            })));
          }
        }
        
        // Fetch leads data separately if we have stage records
        let agreementRecords: any[] = [];
        if (stageRecords && stageRecords.length > 0) {
          const leadIds = [...new Set(stageRecords.map(record => record.lead_id).filter(id => id !== null))];
          console.log('📋 Fetching leads data for', leadIds.length, 'unique leads...');
          
          const { data: leadsData, error: leadsError } = await supabase
            .from('leads_lead')
            .select(`
              id, total, currency_id,
              misc_category(
                id, name, parent_id,
                misc_maincategory(
                  id, name, department_id,
                  tenant_departement(id, name)
                )
              )
            `)
            .in('id', leadIds);
          
          if (leadsError) {
            console.error('❌ Error fetching leads data:', leadsError);
            throw leadsError;
          }
          
          console.log('✅ Leads data fetched:', leadsData?.length || 0, 'records');
          
          // Join the data
          const leadsMap = new Map(leadsData?.map(lead => [lead.id, lead]) || []);
          agreementRecords = stageRecords.map(stageRecord => {
            const lead = leadsMap.get(stageRecord.lead_id);
            return {
              ...stageRecord,
              leads_lead: lead || null
            };
          }).filter(record => record.leads_lead !== null);
          
          console.log('✅ Joined agreement records created:', agreementRecords.length, 'records');
        }
        
        console.log('✅ Agreement records processed:', agreementRecords?.length || 0, 'records');
        if (agreementRecords && agreementRecords.length > 0) {
          console.log('📝 Sample agreement record:', agreementRecords[0]);
        }
        
        // Fetch data for selected month (separate query)
        console.log('📋 Fetching leads_leadstage records (stage 60 - agreement signed) for selected month:', selectedMonthName, selectedYear);
        const { data: monthStageRecords, error: monthStageError } = await supabase
          .from('leads_leadstage')
          .select('id, date, lead_id')
          .eq('stage', 60)
          .gte('date', startOfMonthStr)
          .lte('date', new Date(selectedYear, selectedMonthIndex + 1, 0).toISOString().split('T')[0]);
        
        if (monthStageError) {
          console.error('❌ Error fetching month stage records:', monthStageError);
          throw monthStageError;
        }
        
        console.log('✅ Month stage records fetched:', monthStageRecords?.length || 0, 'records');
        
        // Fetch leads data separately for month if we have stage records
        let monthAgreementRecords: any[] = [];
        if (monthStageRecords && monthStageRecords.length > 0) {
          const monthLeadIds = [...new Set(monthStageRecords.map(record => record.lead_id).filter(id => id !== null))];
          console.log('📋 Fetching month leads data for', monthLeadIds.length, 'unique leads...');
          
          const { data: monthLeadsData, error: monthLeadsError } = await supabase
            .from('leads_lead')
            .select(`
              id, total, currency_id,
              misc_category(
                id, name, parent_id,
                misc_maincategory(
                  id, name, department_id,
                  tenant_departement(id, name)
                )
              )
            `)
            .in('id', monthLeadIds);
          
          if (monthLeadsError) {
            console.error('❌ Error fetching month leads data:', monthLeadsError);
            throw monthLeadsError;
          }
          
          console.log('✅ Month leads data fetched:', monthLeadsData?.length || 0, 'records');
          
          // Join the data
          const monthLeadsMap = new Map(monthLeadsData?.map(lead => [lead.id, lead]) || []);
          monthAgreementRecords = monthStageRecords.map(stageRecord => {
            const lead = monthLeadsMap.get(stageRecord.lead_id);
            return {
              ...stageRecord,
              leads_lead: lead || null
            };
          }).filter(record => record.leads_lead !== null);
          
          console.log('✅ Joined month agreement records created:', monthAgreementRecords.length, 'records');
        }
        
        console.log('✅ Month agreement records processed:', monthAgreementRecords?.length || 0, 'records');
        if (monthAgreementRecords && monthAgreementRecords.length > 0) {
          console.log('📝 Sample month agreement record:', monthAgreementRecords[0]);
        }
        
        if (agreementRecords && agreementRecords.length > 0) {
          // Process all records efficiently
          let processedCount = 0;
          let skippedCount = 0;
          
          // Track processed records to prevent duplicates
          const processedRecordIds = new Set();
          
          agreementRecords.forEach(record => {
            // Skip if already processed
            if (processedRecordIds.has(record.id)) {
              console.log(`⚠️ Skipping duplicate record: leadId=${record.id}`);
              return;
            }
            processedRecordIds.add(record.id);
            
            const lead = record.leads_lead as any;
            if (!lead) {
              console.log(`⚠️ No lead data for record: leadId=${record.lead_id}`);
              return;
            }
            
            const amount = parseFloat(lead.total) || 0;
            const amountInNIS = convertToNIS(amount, lead.currency_id);
            const recordDate = record.date;
            
            // Debug currency conversion
            console.log(`🔍 Dashboard Agreement Signed - Lead ${record.lead_id}:`, {
              originalAmount: amount,
              currencyId: lead.currency_id,
              convertedAmount: amountInNIS,
              conversionRate: amount > 0 ? amountInNIS / amount : 1
            });
            
            // Log non-NIS currencies for verification
            if (lead.currency_id && lead.currency_id !== 1) {
              console.log(`🌍 Non-NIS Currency Found - Lead ${record.lead_id}:`, {
                currencyId: lead.currency_id,
                originalAmount: amount,
                convertedAmount: amountInNIS,
                currencyType: lead.currency_id === 2 ? 'USD' : 
                             lead.currency_id === 3 ? 'EUR' : 
                             lead.currency_id === 4 ? 'GBP' : 'Unknown'
              });
            }
            
            // Get department ID from the JOIN
            let departmentId = null;
            if (lead.misc_category?.misc_maincategory?.department_id) {
              departmentId = lead.misc_category.misc_maincategory.department_id;
            }
            
            console.log(`📊 Processing record: leadId=${record.lead_id}, departmentId=${departmentId}, amount=${amount}, amountInNIS=${amountInNIS}, date=${recordDate}`);
            
            if (departmentId && departmentIds.includes(departmentId)) {
              processedCount++;
              
              // For Today and Last 30d, use the department index + 1 (to skip General)
              const deptIndex = departmentIds.indexOf(departmentId) + 1;
              
              // For current month, use the department index directly (no General column)
              const monthDeptIndex = departmentIds.indexOf(departmentId);
              
              console.log(`📍 Department mapping: deptId=${departmentId}, deptIndex=${deptIndex}, monthDeptIndex=${monthDeptIndex}`);
              console.log(`📍 Department names: deptId=${departmentId} -> ${scoreboardCategories[deptIndex]} (Last 30d), ${scoreboardCategories[monthDeptIndex + 1]} (${selectedMonthName})`);
              
              // Extract date part for comparison
              const recordDateOnly = extractDateFromRecord(recordDate);
              
              // Check if it's today
              if (recordDateOnly === todayStr) {
                console.log(`✅ Today match: ${recordDateOnly} === ${todayStr}`);
                newAgreementData.Today[deptIndex].count++;
                newAgreementData.Today[deptIndex].amount += amountInNIS; // Use NIS amount
                newAgreementData.Today[0].count++; // General
                newAgreementData.Today[0].amount += amountInNIS; // Use NIS amount
              }
              
              // Check if it's in last 30 days (or entire month if at end of month)
              if (recordDateOnly >= effectiveThirtyDaysAgo) {
                console.log(`✅ Last 30d match: ${recordDateOnly} >= ${effectiveThirtyDaysAgo}`);
                console.log(`  📊 Before: Last 30d[${deptIndex}] = count:${newAgreementData["Last 30d"][deptIndex].count}, amount:${newAgreementData["Last 30d"][deptIndex].amount}`);
                newAgreementData["Last 30d"][deptIndex].count++;
                newAgreementData["Last 30d"][deptIndex].amount += amountInNIS; // Use NIS amount
                console.log(`  📊 After: Last 30d[${deptIndex}] = count:${newAgreementData["Last 30d"][deptIndex].count}, amount:${newAgreementData["Last 30d"][deptIndex].amount}`);
                newAgreementData["Last 30d"][0].count++; // General
                newAgreementData["Last 30d"][0].amount += amountInNIS; // Use NIS amount
              }
              
              // Note: Month data will be processed separately from monthStageRecords
              
              // Debug: Show why dates might be different
              console.log(`🔍 Date comparison debug: recordDate=${recordDateOnly}, effectiveThirtyDaysAgo=${effectiveThirtyDaysAgo}, startOfMonth=${startOfMonthStr}`);
              console.log(`🔍 Last 30d condition: ${recordDateOnly} >= ${effectiveThirtyDaysAgo} = ${recordDateOnly >= effectiveThirtyDaysAgo}`);
              console.log(`🔍 Selected month condition: ${recordDateOnly} >= ${startOfMonthStr} = ${recordDateOnly >= startOfMonthStr}`);
            } else {
              skippedCount++;
              console.log(`⏭️ Skipped record: leadId=${record.lead_id}, departmentId=${departmentId}, validDept=${departmentIds.includes(departmentId)}`);
            }
          });
          
          console.log(`📈 Processing summary: ${processedCount} processed, ${skippedCount} skipped`);
        }
        
        // Process month data separately
        if (monthAgreementRecords && monthAgreementRecords.length > 0) {
          let monthProcessedCount = 0;
          let monthSkippedCount = 0;
          
          // Track processed records to prevent duplicates
          const processedMonthRecordIds = new Set();
          
          monthAgreementRecords.forEach(record => {
            // Skip if already processed
            if (processedMonthRecordIds.has(record.id)) {
              console.log(`⚠️ Skipping duplicate month record: leadId=${record.id}`);
              return;
            }
            processedMonthRecordIds.add(record.id);
            
            const lead = record.leads_lead as any;
            if (!lead) {
              console.log(`⚠️ No lead data for month record: leadId=${record.lead_id}`);
              return;
            }
            
            const amount = parseFloat(lead.total) || 0;
            const amountInNIS = convertToNIS(amount, lead.currency_id);
            const recordDate = record.date;
            
            // Get department ID from the JOIN
            let departmentId = null;
            if (lead.misc_category?.misc_maincategory?.department_id) {
              departmentId = lead.misc_category.misc_maincategory.department_id;
            }
            
            console.log(`📊 Processing month record: leadId=${record.lead_id}, departmentId=${departmentId}, amount=${amount}, amountInNIS=${amountInNIS}, date=${recordDate}`);
            console.log(`🔍 Department ID ${departmentId} in departmentIds? ${departmentIds.includes(departmentId)}`);
            console.log(`🔍 Available department IDs: [${departmentIds.join(', ')}]`);
            
            if (departmentId && departmentIds.includes(departmentId)) {
              monthProcessedCount++;
              
              // For current month, use the department index directly (no General column)
              const monthDeptIndex = departmentIds.indexOf(departmentId);
              
              console.log(`📍 Month department mapping: deptId=${departmentId}, monthDeptIndex=${monthDeptIndex}`);
              console.log(`📍 Month department name: deptId=${departmentId} -> ${scoreboardCategories[monthDeptIndex + 1]} (${selectedMonthName})`);
              console.log(`📍 Available scoreboardCategories: [${scoreboardCategories.join(', ')}]`);
              
              // Extract date part for comparison
              const recordDateOnly = extractDateFromRecord(recordDate);
              
              // Check if it's in selected month
              if (recordDateOnly >= startOfMonthStr) {
                console.log(`✅ Selected month match: ${recordDateOnly} >= ${startOfMonthStr}`);
                console.log(`  📊 Before: ${selectedMonthName}[${monthDeptIndex}] = count:${newAgreementData[selectedMonthName][monthDeptIndex].count}, amount:${newAgreementData[selectedMonthName][monthDeptIndex].amount}`);
                newAgreementData[selectedMonthName][monthDeptIndex].count++;
                newAgreementData[selectedMonthName][monthDeptIndex].amount += amountInNIS; // Use NIS amount
                console.log(`  📊 After: ${selectedMonthName}[${monthDeptIndex}] = count:${newAgreementData[selectedMonthName][monthDeptIndex].count}, amount:${newAgreementData[selectedMonthName][monthDeptIndex].amount}`);
              }
            } else {
              monthSkippedCount++;
              console.log(`⏭️ Skipped month record: leadId=${record.lead_id}, departmentId=${departmentId}, validDept=${departmentIds.includes(departmentId)}`);
            }
          });
          
          console.log(`📈 Month processing summary: ${monthProcessedCount} processed, ${monthSkippedCount} skipped`);
        }
        
        // Calculate totals for each time period
        console.log('🧮 Calculating totals...');
        
        // Debug: Show the raw data before calculating totals
        console.log('🔍 Raw data before totals:');
        console.log('  Today:', newAgreementData.Today.map((item, idx) => `[${idx}]: count=${item.count}, amount=${item.amount}`));
        console.log('  Last 30d:', newAgreementData["Last 30d"].map((item, idx) => `[${idx}]: count=${item.count}, amount=${item.amount}`));
        console.log(`  ${selectedMonthName}:`, newAgreementData[selectedMonthName].map((item, idx) => `[${idx}]: count=${item.count}, amount=${item.amount}`));
        
        // Calculate dynamic totals based on actual number of departments
        const numDepartments = departmentTargets.length;
        const totalIndexToday = numDepartments + 1; // General + departments + Total
        const totalIndexMonth = numDepartments; // departments + Total (no General for month)
        
        console.log(`🧮 Total calculation: ${numDepartments} departments, totalIndexToday=${totalIndexToday}, totalIndexMonth=${totalIndexMonth}`);
        
        // Today totals (sum of departments, excluding General and Total)
        const todayTotalCount = newAgreementData.Today.slice(1, numDepartments + 1).reduce((sum, item) => sum + item.count, 0);
        const todayTotalAmount = Math.ceil(newAgreementData.Today.slice(1, numDepartments + 1).reduce((sum, item) => sum + item.amount, 0));
        newAgreementData.Today[totalIndexToday] = {
          count: todayTotalCount,
          amount: todayTotalAmount,
          expected: 0
        };
        
        // Last 30d totals - use the General row [0] which already contains the total
        const last30TotalCount = newAgreementData["Last 30d"][0].count;
        const last30TotalAmount = Math.ceil(newAgreementData["Last 30d"][0].amount);
        newAgreementData["Last 30d"][totalIndexToday] = {
          count: last30TotalCount,
          amount: last30TotalAmount,
          expected: 0
        };
        
        // Current month totals - calculate by summing the individual department values
        const monthTotalCount = newAgreementData[selectedMonthName].slice(0, numDepartments).reduce((sum, item) => sum + item.count, 0);
        const monthTotalAmount = Math.ceil(newAgreementData[selectedMonthName].slice(0, numDepartments).reduce((sum, item) => sum + item.amount, 0));
        newAgreementData[selectedMonthName][totalIndexMonth] = {
          count: monthTotalCount,
          amount: monthTotalAmount,
          expected: 0
        };
        
        // Debug: Show the calculated totals
        console.log('🔍 Calculated totals:');
        console.log('  Today Total:', { count: todayTotalCount, amount: todayTotalAmount });
        console.log('  Last 30d Total:', { count: last30TotalCount, amount: last30TotalAmount });
        console.log(`  ${selectedMonthName} Total:`, { count: monthTotalCount, amount: monthTotalAmount });
        
        console.log('📊 Final agreement data:', newAgreementData);
        
        // Log currency distribution summary
        const currencyDistribution = {
          NIS: 0,
          USD: 0,
          EUR: 0,
          GBP: 0,
          Unknown: 0
        };
        
        console.log('🔍 Debugging Agreement Records for Currency Distribution:');
        console.log('📊 Total agreement records:', agreementRecords.length);
        console.log('📊 Total month agreement records:', monthAgreementRecords?.length || 0);
        
        // Combine all records that were processed
        const allProcessedRecords = [...(agreementRecords || []), ...(monthAgreementRecords || [])];
        console.log('📊 Total all processed records:', allProcessedRecords.length);
        
        if (allProcessedRecords.length > 0) {
          console.log('📊 Sample processed record structure:', allProcessedRecords[0]);
          console.log('📊 Sample lead structure:', allProcessedRecords[0]?.leads_lead);
          console.log('📊 Sample currency_id:', allProcessedRecords[0]?.leads_lead?.currency_id);
          
          // Check first 5 records for currency data
          for (let i = 0; i < Math.min(5, allProcessedRecords.length); i++) {
            const record = allProcessedRecords[i];
            const lead = record.leads_lead;
            console.log(`🔍 Record ${i} currency check:`, {
              leadId: lead?.id,
              hasLead: !!lead,
              currencyId: lead?.currency_id,
              total: lead?.total,
              allLeadFields: lead ? Object.keys(lead) : 'no lead'
            });
          }
        }
        
        allProcessedRecords.forEach((record, index) => {
          const lead = record.leads_lead;
          if (lead && lead.currency_id) {
            switch (lead.currency_id) {
              case 1: currencyDistribution.NIS++; break;
              case 2: currencyDistribution.USD++; break;
              case 3: currencyDistribution.EUR++; break;
              case 4: currencyDistribution.GBP++; break;
              default: currencyDistribution.Unknown++; break;
            }
          } else if (index < 5) { // Log first 5 records that don't have currency
            console.log(`🔍 Record ${index} missing currency:`, {
              hasLead: !!lead,
              currencyId: lead?.currency_id,
              leadId: lead?.id
            });
          }
        });
        
        console.log('🌍 Currency Distribution in Agreement Signed Data:', currencyDistribution);
        setAgreementData(newAgreementData);
        
      } catch (error) {
        console.error('❌ Error fetching department performance:', error);
      } finally {
        setDepartmentPerformanceLoading(false);
      }
  };

  // Fetch invoiced data using the same logic as agreement data
  const fetchInvoicedData = async () => {
    console.log('🚀 fetchInvoicedData function called!');
    setInvoicedDataLoading(true);
    try {
      console.log('🔍 Starting invoiced data fetch...');
      
      const now = new Date();
      const today = new Date();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(now.getDate() - 30);
      
      // Use selected month and year
      const selectedMonthIndex = months.indexOf(selectedMonth);
      const selectedDate = new Date(selectedYear, selectedMonthIndex, 1);
      const selectedMonthName = selectedDate.toLocaleDateString('en-US', { month: 'long' });
      
      console.log('📅 Fetching invoiced data for:', selectedMonth, selectedYear);
      
        // Fetch only important departments (same as agreement data)
        console.log('🎯 Fetching important departments for invoiced data...');
        const { data: allDepartments, error: departmentsError } = await supabase
          .from('tenant_departement')
          .select('id, name, min_income, important')
          .eq('important', 't')
          .order('id');
      
      if (departmentsError) {
        console.error('❌ Error fetching departments for invoiced data:', departmentsError);
        throw departmentsError;
      }
      
      // Extract department IDs and create target mapping
      const departmentIds = allDepartments?.map(dept => dept.id) || [];
      const departmentTargets = allDepartments || [];
      
      console.log('📊 Important department IDs for invoiced data:', departmentIds);
      console.log('🎯 Using same departments as agreement data for consistency...');
      
      // Create target map (department ID -> min_income)
      const targetMap: { [key: number]: number } = {};
      departmentTargets?.forEach(dept => {
        targetMap[dept.id] = parseFloat(dept.min_income || '0');
      });
      
      console.log('🎯 Target map created (invoiced):', targetMap);
      
      // Calculate date ranges
      const todayStr = today.toISOString().split('T')[0];
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
      const startOfMonth = new Date(Date.UTC(selectedYear, selectedMonthIndex, 1));
      const startOfMonthStr = startOfMonth.toISOString().split('T')[0];
      
      // Check if we're at the end of the month
      const daysInMonth = new Date(selectedYear, selectedMonthIndex + 1, 0).getDate();
      const isEndOfMonth = now.getDate() >= (daysInMonth - 2);
      const effectiveThirtyDaysAgo = isEndOfMonth ? startOfMonthStr : thirtyDaysAgoStr;
      
      console.log('📅 Invoiced data date ranges:');
      console.log('  - Today:', todayStr);
      console.log('  - 30 days ago:', thirtyDaysAgoStr);
      console.log('  - Start of month:', startOfMonthStr);
      console.log('  - Current date object:', new Date());
      console.log('  - Selected month/year:', selectedMonthIndex, selectedYear);
      console.log('  - Effective 30 days ago:', effectiveThirtyDaysAgo);
      
      // Initialize invoiced data structure
      const newInvoicedData = {
        Today: [
          { count: 0, amount: 0, expected: 0 }, // General (index 0)
          ...departmentTargets.map(dept => ({ 
            count: 0, 
            amount: 0, 
            expected: parseFloat(dept.min_income || '0') 
          })), // Actual departments
          { count: 0, amount: 0, expected: 0 }, // Total (last index)
        ],
        "Last 30d": [
          { count: 0, amount: 0, expected: 0 }, // General (index 0)
          ...departmentTargets.map(dept => ({ 
            count: 0, 
            amount: 0, 
            expected: parseFloat(dept.min_income || '0') 
          })), // Actual departments
          { count: 0, amount: 0, expected: 0 }, // Total (last index)
        ],
        [selectedMonthName]: [
          ...departmentTargets.map(dept => ({ 
            count: 0, 
            amount: 0, 
            expected: parseFloat(dept.min_income || '0') 
          })), // Actual departments (no General for month)
          { count: 0, amount: 0, expected: 0 }, // Total (last index)
        ],
      };
      
      // FIXED APPROACH: Use correct table - proformainvoice
      // Fetch invoice records first
      console.log('📋 Fetching proformainvoice records for Today and Last 30d...');
      console.log('🔍 Query parameters: cdate >=', thirtyDaysAgoStr, ', cdate <=', todayStr);
      console.log('🔍 Available department IDs for invoiced data: [', departmentIds.join(', '), ']');
      
      // First, let's test without date filters to see if we get any records
      console.log('🧪 Testing invoice query without date filters...');
      const { data: testRecords, error: testError } = await supabase
        .from('proformainvoice')
        .select('id, lead_id, sub_total, cdate, currency_id')
        .limit(5);
      
      if (testError) {
        console.error('❌ Error in test query:', testError);
      } else {
        console.log('🧪 Test query results (no date filter):', testRecords?.length || 0, 'records');
        if (testRecords && testRecords.length > 0) {
          console.log('🧪 Sample test record:', testRecords[0]);
          console.log('🧪 All test record dates:', testRecords.map(r => r.cdate));
        } else {
          console.log('🧪 No test records found - this might be the issue!');
        }
      }
      
      // NOTE: We fetch all invoice data, but filter it properly:
      // Today = actual today, Last 30d = actual last 30 days (like agreement signed table), Month = selected month
      const expandedStartDate = '2025-04-01'; // Start from April 2025 where data exists
      console.log('🔧 Using expanded date range to fetch all invoice data:', expandedStartDate, 'to', todayStr);
      console.log('📝 Note: Today=actual today, Last 30d=actual last 30 days, Month=selected month');
      
      const { data: invoiceRecords, error: invoiceError } = await supabase
        .from('proformainvoice')
        .select('id, lead_id, sub_total, cdate, currency_id')
        .gte('cdate', expandedStartDate)
        .lte('cdate', todayStr);
      
      if (invoiceError) {
        console.error('❌ Error fetching invoice records:', invoiceError);
        throw invoiceError;
      }
      
      console.log('✅ Invoice records fetched:', invoiceRecords?.length || 0, 'records');
      if (invoiceRecords && invoiceRecords.length > 0) {
        const dates = invoiceRecords.map(r => r.cdate).sort();
        console.log('📅 Invoice record date range:', dates[0], 'to', dates[dates.length - 1]);
        console.log('📅 Sample invoice dates:', dates.slice(0, 5));
      }
      
      // Debug: Check if there are any invoice records at all (without date filter)
      if (invoiceRecords?.length === 0) {
        console.log('🔍 No invoice records found for date range. Checking all invoice records...');
        const { data: allInvoiceRecords, error: allInvoiceError } = await supabase
          .from('proformainvoice')
          .select('id, lead_id, sub_total, cdate, currency_id')
          .order('cdate', { ascending: false })
          .limit(10);
        
        if (allInvoiceError) {
          console.error('❌ Error fetching all invoice records:', allInvoiceError);
        } else {
          console.log('📊 Recent invoice records (last 10):', allInvoiceRecords?.map(record => ({
            id: record.id,
            lead_id: record.lead_id,
            sub_total: record.sub_total,
            cdate: record.cdate
          })));
          console.log('🔍 Date range we\'re querying for:', {
            thirtyDaysAgo: thirtyDaysAgoStr,
            today: todayStr,
            startOfMonth: startOfMonthStr,
            currentDate: new Date().toISOString().split('T')[0],
            selectedMonth: selectedMonthName,
            selectedYear: selectedYear
          });
        }
      }
      
      // Fetch leads data separately if we have invoice records
      let processedInvoiceRecords: any[] = [];
      if (invoiceRecords && invoiceRecords.length > 0) {
        console.log('🚀 ENTERING invoice records processing block with', invoiceRecords.length, 'records');
        const leadIds = [...new Set(invoiceRecords.map(record => record.lead_id).filter(id => id !== null))];
        console.log('📋 Fetching leads data for', leadIds.length, 'unique leads...');
        
        const { data: leadsData, error: leadsError } = await supabase
          .from('leads_lead')
          .select(`
            id,
            misc_category(
              id, name, parent_id,
              misc_maincategory(
                id, name, department_id,
                tenant_departement(id, name)
              )
            )
          `)
          .in('id', leadIds);
        
        if (leadsError) {
          console.error('❌ Error fetching leads data for invoices:', leadsError);
          throw leadsError;
        }
        
        console.log('✅ Leads data fetched for invoices:', leadsData?.length || 0, 'records');
        
        // Join the data
        const leadsMap = new Map(leadsData?.map(lead => [lead.id, lead]) || []);
        const allJoinedRecords = invoiceRecords.map(invoiceRecord => {
          const lead = leadsMap.get(invoiceRecord.lead_id);
          return {
            ...invoiceRecord,
            leads_lead: lead || null
          };
        }).filter(record => record.leads_lead !== null);
        
        console.log('✅ All joined invoice records created:', allJoinedRecords.length, 'records');
        
        // Debug: Check the variables we're using for filtering
        console.log('🔍 Debug variables for filtering:');
        console.log('  - todayStr:', todayStr);
        console.log('  - effectiveThirtyDaysAgo:', effectiveThirtyDaysAgo);
        console.log('  - Sample record date:', allJoinedRecords[0]?.cdate);
        
        // Now filter by actual date ranges for Today and Last 30d
        console.log('🔄 Starting date filtering...');
        let todayRecords: any[] = [];
        let last30dRecords: any[] = [];
        
        try {
          todayRecords = allJoinedRecords.filter(record => {
            const recordDate = record.cdate;
            return recordDate === todayStr;
          });
          
          // For Last 30d, ALWAYS use the actual last 30 days from current date (like agreement signed table)
          // This should NOT be affected by the month filter - it's always relative to today
          last30dRecords = allJoinedRecords.filter(record => {
            const recordDate = record.cdate;
            return recordDate >= effectiveThirtyDaysAgo && recordDate <= todayStr;
          });
          
          console.log('✅ Date filtering completed successfully');
        } catch (error) {
          console.error('❌ Error in date filtering:', error);
        }
        
        console.log('📅 Filtered records:');
        console.log('  - Today records:', todayRecords.length);
        console.log('  - Last 30d records:', last30dRecords.length);
        console.log('  - Date range used:', effectiveThirtyDaysAgo, 'to', todayStr);
        console.log('  - Sample today record:', todayRecords[0]);
        console.log('  - Sample last30d record:', last30dRecords[0]);
        
        // Process both Today and Last 30d records separately
        const processRecords = (records: any[], period: string) => {
          console.log(`🔄 Processing ${period} records:`, records.length, 'records');
          
          records.forEach((record, index) => {
            if (index < 5) { // Only log first 5 records to avoid spam
              console.log(`📊 Processing ${period} invoice record ${index + 1}:`, {
                id: record.id,
                lead_id: record.lead_id,
                sub_total: record.sub_total,
                cdate: record.cdate
              });
            }
            
            const lead = record.leads_lead as any;
            if (!lead) {
              console.log(`⚠️ No lead data for ${period} invoice record: leadId=${record.lead_id}`);
              return;
            }
            
            const amount = Math.ceil(parseFloat(record.sub_total) || 0);
            const amountInNIS = convertToNIS(amount, record.currency_id);
            const recordDate = record.cdate;
            
            // Debug currency conversion
            console.log(`🔍 Dashboard Invoiced - Record ${record.id}:`, {
              originalAmount: amount,
              currencyId: record.currency_id,
              convertedAmount: amountInNIS,
              conversionRate: amount > 0 ? amountInNIS / amount : 1
            });
            
            // Log non-NIS currencies for verification
            if (record.currency_id && record.currency_id !== 1) {
              console.log(`🌍 Non-NIS Invoice Currency Found - Record ${record.id}:`, {
                currencyId: record.currency_id,
                originalAmount: amount,
                convertedAmount: amountInNIS,
                currencyType: record.currency_id === 2 ? 'USD' : 
                             record.currency_id === 3 ? 'EUR' : 
                             record.currency_id === 4 ? 'GBP' : 'Unknown'
              });
            }
            
            // Get department ID from the JOIN
            let departmentId = null;
            if (lead.misc_category?.misc_maincategory?.department_id) {
              departmentId = lead.misc_category.misc_maincategory.department_id;
            }
            
            if (index < 5) { // Only log first 5 records
              console.log(`  🔍 Lead ${record.lead_id} -> Department ${departmentId}`);
              console.log(`  💰 Amount: ${amount}, Date: ${recordDate}`);
            }
            
            if (departmentId && departmentIds.includes(departmentId)) {
              if (index < 5) {
                console.log(`  ✅ Valid ${period} record - processing...`);
              }
              
              // For Today and Last 30d, use the department index + 1 (to skip General)
              const deptIndex = departmentIds.indexOf(departmentId) + 1;
              
              // Extract date part for comparison
              const recordDateOnly = recordDate.includes('T') ? recordDate.split('T')[0] : recordDate;
              
              if (index < 5) {
                console.log(`  📅 Date comparison: ${recordDateOnly} vs Today: ${todayStr}, Last30: ${effectiveThirtyDaysAgo}`);
              }
              
              // Add to Today data if it's today
              if (recordDateOnly === todayStr) {
                newInvoicedData["Today"][deptIndex].count += 1;
                newInvoicedData["Today"][deptIndex].amount += amountInNIS; // Use NIS amount
                if (index < 5) console.log(`  ✅ Added to Today data: deptIndex=${deptIndex}, amount=${amountInNIS}`);
              }
              
              // Add to Last 30d data if it's within the actual last 30 days (like agreement signed table)
              if (recordDateOnly >= effectiveThirtyDaysAgo && recordDateOnly <= todayStr) {
                newInvoicedData["Last 30d"][deptIndex].count += 1;
                newInvoicedData["Last 30d"][deptIndex].amount += amountInNIS; // Use NIS amount
                if (index < 5) console.log(`  ✅ Added to Last 30d data: deptIndex=${deptIndex}, amount=${amountInNIS}`);
              }
            }
          });
        };
        
        // Process both Today and Last 30d records
        console.log('🚀 About to process records...');
        processRecords(todayRecords, 'Today');
        processRecords(last30dRecords, 'Last 30d');
        console.log('✅ Finished processing records');
        
        // Debug: Show the data after processing
        console.log('📊 Data after processing:');
        console.log('  - Today data:', newInvoicedData["Today"].map((item, index) => `[${index}]: count=${item.count}, amount=${item.amount}, expected=${item.expected}`));
        console.log('  - Last 30d data:', newInvoicedData["Last 30d"].map((item, index) => `[${index}]: count=${item.count}, amount=${item.amount}, expected=${item.expected}`));
        
        // Use all joined records for processing (not just Last 30d filtered)
        processedInvoiceRecords = allJoinedRecords; // Use all records for the main processing
        console.log('✅ COMPLETED invoice records processing block');
        console.log('🔍 processedInvoiceRecords length:', processedInvoiceRecords.length);
        console.log('🔍 last30dRecords length:', last30dRecords.length);
      } else {
        console.log('❌ NOT ENTERING invoice records processing block - no records or error');
        processedInvoiceRecords = []; // Set empty array if no records
      }
      
      // Fetch data for selected month (separate query)
      console.log('📋 Fetching invoice records for selected month:', selectedMonthName, selectedYear);
      const endOfMonthStr = new Date(selectedYear, selectedMonthIndex + 1, 0).toISOString().split('T')[0];
      console.log('🔍 Month query date range:', startOfMonthStr, 'to', endOfMonthStr);
      const { data: monthInvoiceRecords, error: monthInvoiceError } = await supabase
        .from('proformainvoice')
        .select('id, lead_id, sub_total, cdate, currency_id')
        .gte('cdate', startOfMonthStr)
        .lte('cdate', endOfMonthStr);
      
      if (monthInvoiceError) {
        console.error('❌ Error fetching month invoice records:', monthInvoiceError);
        throw monthInvoiceError;
      }
      
      console.log('✅ Month invoice records fetched:', monthInvoiceRecords?.length || 0, 'records');
      
      // Fetch leads data separately for month if we have invoice records
      let processedMonthInvoiceRecords: any[] = [];
      if (monthInvoiceRecords && monthInvoiceRecords.length > 0) {
        const monthLeadIds = [...new Set(monthInvoiceRecords.map(record => record.lead_id).filter(id => id !== null))];
        console.log('📋 Fetching month leads data for', monthLeadIds.length, 'unique leads...');
        
        const { data: monthLeadsData, error: monthLeadsError } = await supabase
          .from('leads_lead')
          .select(`
            id,
            misc_category(
              id, name, parent_id,
              misc_maincategory(
                id, name, department_id,
                tenant_departement(id, name)
              )
            )
          `)
          .in('id', monthLeadIds);
        
        if (monthLeadsError) {
          console.error('❌ Error fetching month leads data for invoices:', monthLeadsError);
          throw monthLeadsError;
        }
        
        console.log('✅ Month leads data fetched for invoices:', monthLeadsData?.length || 0, 'records');
        
        // Join the data
        const monthLeadsMap = new Map(monthLeadsData?.map(lead => [lead.id, lead]) || []);
        processedMonthInvoiceRecords = monthInvoiceRecords.map(invoiceRecord => {
          const lead = monthLeadsMap.get(invoiceRecord.lead_id);
          return {
            ...invoiceRecord,
            leads_lead: lead || null
          };
        }).filter(record => record.leads_lead !== null);
        
        console.log('✅ Joined month invoice records created:', processedMonthInvoiceRecords.length, 'records');
      }
      
      console.log('🔍 Checking main processing condition:', {
        hasProcessedRecords: !!processedInvoiceRecords,
        recordsLength: processedInvoiceRecords?.length || 0,
        hasProcessedMonthRecords: !!processedMonthInvoiceRecords,
        monthRecordsLength: processedMonthInvoiceRecords?.length || 0
      });
      
      if (processedInvoiceRecords && processedInvoiceRecords.length > 0) {
        console.log('🚀 ENTERING main invoice processing block with', processedInvoiceRecords.length, 'records');
        // Process all invoice records
        let processedCount = 0;
        let skippedCount = 0;
        
        console.log('🔄 Processing invoice records...');
        console.log('🔍 Department IDs to check:', departmentIds);
        
        processedInvoiceRecords.forEach((record, index) => {
          if (index < 5) { // Only log first 5 records to avoid spam
            console.log(`📊 Processing invoice record ${index + 1}:`, {
              id: record.id,
              lead_id: record.lead_id,
              sub_total: record.sub_total,
              cdate: record.cdate
            });
          }
          
          const lead = record.leads_lead as any;
          if (!lead) {
            console.log(`⚠️ No lead data for invoice record: leadId=${record.lead_id}`);
            return;
          }
          
          const amount = Math.ceil(parseFloat(record.sub_total) || 0); // Round up to nearest whole number
          const amountInNIS = convertToNIS(amount, record.currency_id);
          const recordDate = record.cdate;
          
          // Get department ID from the JOIN
          let departmentId = null;
          if (lead.misc_category?.misc_maincategory?.department_id) {
            departmentId = lead.misc_category.misc_maincategory.department_id;
          }
          
          if (index < 5) { // Only log first 5 records
            console.log(`  🔍 Lead ${record.lead_id} -> Department ${departmentId}`);
            console.log(`  💰 Amount: ${amount}, Date: ${recordDate}`);
          }
          
          if (departmentId && departmentIds.includes(departmentId)) {
            processedCount++;
            
            if (index < 5) {
              console.log(`  ✅ Valid record - processing...`);
            }
            
            // For Today and Last 30d, use the department index + 1 (to skip General)
            const deptIndex = departmentIds.indexOf(departmentId) + 1;
            
            // For current month, use the department index directly (no General column)
            const monthDeptIndex = departmentIds.indexOf(departmentId);
            
            // Extract date part for comparison
            const recordDateOnly = recordDate.includes('T') ? recordDate.split('T')[0] : recordDate;
            
            if (index < 5) {
              console.log(`  📅 Date comparison: ${recordDateOnly} vs Today: ${todayStr}, Last30: ${effectiveThirtyDaysAgo}, Month: ${startOfMonthStr}`);
            }
            
            // Check if it's today
            if (recordDateOnly === todayStr) {
              newInvoicedData.Today[deptIndex].count++;
              newInvoicedData.Today[deptIndex].amount += amountInNIS; // Use NIS amount
              newInvoicedData.Today[0].count++; // General
              newInvoicedData.Today[0].amount += amountInNIS; // Use NIS amount
            }
            
            // Check if it's in last 30 days (or entire month if at month end)
            if (recordDateOnly >= effectiveThirtyDaysAgo) {
              newInvoicedData["Last 30d"][deptIndex].count++;
              newInvoicedData["Last 30d"][deptIndex].amount += amountInNIS; // Use NIS amount
              newInvoicedData["Last 30d"][0].count++; // General
              newInvoicedData["Last 30d"][0].amount += amountInNIS; // Use NIS amount
            }
            
            // Note: Month data will be processed separately from monthInvoiceRecords
          } else {
            skippedCount++;
            if (index < 5) {
              console.log(`  ⏭️ Skipped: departmentId=${departmentId}, validDept=${departmentIds.includes(departmentId)}`);
            }
          }
        });
        
        console.log(`📈 Invoiced processing summary: ${processedCount} processed, ${skippedCount} skipped`);
        
        // Process month invoice data separately
        console.log('🔍 Checking month processing condition:', {
          hasProcessedMonthRecords: !!processedMonthInvoiceRecords,
          monthRecordsLength: processedMonthInvoiceRecords?.length || 0,
          selectedMonth: selectedMonthName
        });
        
        if (processedMonthInvoiceRecords && processedMonthInvoiceRecords.length > 0) {
          console.log('🚀 ENTERING month invoice processing block with', processedMonthInvoiceRecords.length, 'records');
          let monthProcessedCount = 0;
          let monthSkippedCount = 0;
          
          // Track processed records to prevent duplicates
          const processedMonthRecordIds = new Set();
          
          processedMonthInvoiceRecords.forEach((record, index) => {
            // Skip if already processed
            if (processedMonthRecordIds.has(record.id)) {
              console.log(`⚠️ Skipping duplicate month invoice record: id=${record.id}`);
              return;
            }
            processedMonthRecordIds.add(record.id);
            
            const lead = record.leads_lead as any;
            if (!lead) {
              console.log(`⚠️ No lead data for month invoice record: leadId=${record.lead_id}`);
              return;
            }
            
            const amount = Math.ceil(parseFloat(record.sub_total) || 0); // Round up to nearest whole number
            const amountInNIS = convertToNIS(amount, record.currency_id);
            const recordDate = record.cdate;
            
            // Get department ID from the JOIN
            let departmentId = null;
            if (lead.misc_category?.misc_maincategory?.department_id) {
              departmentId = lead.misc_category.misc_maincategory.department_id;
            }
            
            if (index < 5) { // Only log first 5 records
              console.log(`📊 Processing month invoice record ${index + 1}:`, {
                id: record.id,
                lead_id: record.lead_id,
                sub_total: record.sub_total,
                cdate: record.cdate
              });
              console.log(`  🔍 Lead ${record.lead_id} -> Department ${departmentId}`);
              console.log(`  💰 Amount: ${amount}, Date: ${recordDate}`);
            }
            
            if (departmentId && departmentIds.includes(departmentId)) {
              monthProcessedCount++;
              
              if (index < 5) {
                console.log(`  ✅ Valid month invoice record - processing...`);
              }
              
              // For current month, use the department index directly (no General column)
              const monthDeptIndex = departmentIds.indexOf(departmentId);
              
              // Extract date part for comparison
              const recordDateOnly = recordDate.includes('T') ? recordDate.split('T')[0] : recordDate;
              
              if (index < 5) {
                console.log(`  📅 Date comparison: ${recordDateOnly} vs Month: ${startOfMonthStr}`);
              }
              
              // Check if it's in selected month
              if (recordDateOnly >= startOfMonthStr) {
                newInvoicedData[selectedMonthName][monthDeptIndex].count++;
                newInvoicedData[selectedMonthName][monthDeptIndex].amount += amountInNIS; // Use NIS amount
              }
            } else {
              monthSkippedCount++;
              if (index < 5) {
                console.log(`  ⏭️ Skipped month invoice: departmentId=${departmentId}, validDept=${departmentIds.includes(departmentId)}`);
              }
            }
          });
          
          console.log(`📈 Month invoice processing summary: ${monthProcessedCount} processed, ${monthSkippedCount} skipped`);
        } else {
          console.log('❌ NOT ENTERING month invoice processing block - no processed month records');
        }
        
        // Calculate totals and round amounts up
        // Calculate dynamic totals based on actual number of departments
        const numDepartments = departmentTargets.length;
        const totalIndexToday = numDepartments + 1; // General + departments + Total
        const totalIndexMonth = numDepartments; // departments + Total (no General for month)
        
        console.log(`🧮 Invoiced total calculation: ${numDepartments} departments, totalIndexToday=${totalIndexToday}, totalIndexMonth=${totalIndexMonth}`);
        
        // Today totals (sum of departments, excluding General and Total)
        const todayTotalCount = newInvoicedData.Today.slice(1, numDepartments + 1).reduce((sum, item) => sum + item.count, 0);
        const todayTotalAmount = Math.ceil(newInvoicedData.Today.slice(1, numDepartments + 1).reduce((sum, item) => sum + item.amount, 0));
        newInvoicedData.Today[totalIndexToday] = { count: todayTotalCount, amount: todayTotalAmount, expected: 0 };
        
        // Last 30d totals - use the General row [0] which already contains the total
        const last30TotalCount = newInvoicedData["Last 30d"][0].count;
        const last30TotalAmount = Math.ceil(newInvoicedData["Last 30d"][0].amount);
        newInvoicedData["Last 30d"][totalIndexToday] = { count: last30TotalCount, amount: last30TotalAmount, expected: 0 };
        
        // Current month totals - calculate by summing the individual department values
        const monthTotalCount = newInvoicedData[selectedMonthName].slice(0, numDepartments).reduce((sum, item) => sum + item.count, 0);
        const monthTotalAmount = Math.ceil(newInvoicedData[selectedMonthName].slice(0, numDepartments).reduce((sum, item) => sum + item.amount, 0));
        newInvoicedData[selectedMonthName][totalIndexMonth] = { count: monthTotalCount, amount: monthTotalAmount, expected: 0 };
        
        console.log('📊 Final invoiced data:', newInvoicedData);
        
        // Log currency distribution summary for invoiced data
        const invoiceCurrencyDistribution = {
          NIS: 0,
          USD: 0,
          EUR: 0,
          GBP: 0,
          Unknown: 0
        };
        
        // Count currencies from all invoice records
        const allInvoiceRecords = [...(invoiceRecords || []), ...(monthInvoiceRecords || [])];
        allInvoiceRecords.forEach(record => {
          if (record.currency_id) {
            switch (record.currency_id) {
              case 1: invoiceCurrencyDistribution.NIS++; break;
              case 2: invoiceCurrencyDistribution.USD++; break;
              case 3: invoiceCurrencyDistribution.EUR++; break;
              case 4: invoiceCurrencyDistribution.GBP++; break;
              default: invoiceCurrencyDistribution.Unknown++; break;
            }
          }
        });
        
        console.log('🌍 Currency Distribution in Invoiced Data:', invoiceCurrencyDistribution);
        console.log('📊 Final invoiced data structure:');
        console.log('  - Today:', newInvoicedData["Today"]);
        console.log('  - Last 30d:', newInvoicedData["Last 30d"]);
        console.log('  - Selected month:', newInvoicedData[selectedMonthName]);
        setInvoicedData(newInvoicedData);
      } else {
        console.log('❌ NOT ENTERING main invoice processing block - no processed records');
        console.log('🔍 This means no data will be processed for Today, Last 30d, or month-specific calculations');
      }
      
    } catch (error: any) {
      console.error('❌ Error fetching invoiced data:', error);
      console.error('❌ Error details:', {
        message: error?.message || 'Unknown error',
        stack: error?.stack || 'No stack trace',
        name: error?.name || 'Unknown error type'
      });
    } finally {
      console.log('🏁 fetchInvoicedData function completed');
      setInvoicedDataLoading(false);
    }
  };

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
  // Department names state
  const [departmentNames, setDepartmentNames] = useState<string[]>([]);
  
  // Dynamic scoreboard categories based on actual departments
  const scoreboardCategories = [
    "General",
    ...departmentNames,
    "Total"
  ];
  // Agreement signed data (first table) - will be populated with real data
  const [agreementData, setAgreementData] = useState<{
    Today: { count: number; amount: number; expected: number }[];
    "Last 30d": { count: number; amount: number; expected: number }[];
    [key: string]: { count: number; amount: number; expected: number }[];
  }>({
    Today: [
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
    ],
    "Last 30d": [
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
    ],
  });

  // Score Board state
  const [scoreTab, setScoreTab] = React.useState("Tables");
  const [flippedCards, setFlippedCards] = React.useState<Set<string>>(new Set());
  // Column visibility for Department Performance table (desktop) - simplified to rows only
  const [showTodayCols, setShowTodayCols] = React.useState(true);
  const [showLast30Cols, setShowLast30Cols] = React.useState(true);
  const [showLastMonthCols, setShowLastMonthCols] = React.useState(true);
  
  // Month and year filter states - default to current month and year
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthName);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  
  
  // Available months and years for filtering
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  
  const years = [2023, 2024, 2025, 2026, 2027];

  // Add useEffect to refetch data when month/year changes
  useEffect(() => {
    console.log('🔄 useEffect triggered - fetching data for:', selectedMonth, selectedYear);
    fetchDepartmentPerformance();
    fetchInvoicedData();
  }, [selectedMonth, selectedYear]);

  // Fetch unavailable employees data on component mount
  useEffect(() => {
    fetchUnavailableEmployeesData();
  }, []);


  // Refresh data when unavailable employees modal closes
  useEffect(() => {
    if (!isUnavailableEmployeesModalOpen) {
      fetchUnavailableEmployeesData();
    }
  }, [isUnavailableEmployeesModalOpen]);

  // Invoiced data (second table) - will be populated with real data
  const [invoicedData, setInvoicedData] = useState<{
    Today: { count: number; amount: number; expected: number }[];
    "Last 30d": { count: number; amount: number; expected: number }[];
    [key: string]: { count: number; amount: number; expected: number }[];
  }>({
    Today: [
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
    ],
    "Last 30d": [
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
    ],
    [selectedMonth]: [
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
      { count: 0, amount: 0, expected: 0 },
    ],
  });

  const scoreboardHighlights = {
    [selectedMonth]: [
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

  const sumTodayCount = includedDeptIndexes.reduce((sum: number, i: number) => sum + (agreementData['Today'][i]?.count || 0), 0);
  const sumTodayAmount = includedDeptIndexes.reduce((sum: number, i: number) => sum + (agreementData['Today'][i]?.amount || 0), 0);
  const sumTodayExpected = includedDeptIndexes.reduce((sum: number, i: number) => sum + ((agreementData['Today'][i]?.expected || randomTodayTargetsRef.current[i] || 0)), 0);

  const sum30Count = includedDeptIndexes.reduce((sum: number, i: number) => sum + (agreementData['Last 30d'][i]?.count || 0), 0);
  const sum30Amount = includedDeptIndexes.reduce((sum: number, i: number) => sum + (agreementData['Last 30d'][i]?.amount || 0), 0);
  const sum30Expected = includedDeptIndexes.reduce((sum: number, i: number) => sum + (agreementData['Last 30d'][i]?.expected || 0), 0);

  const sumMonthCount = sum30Count; // using 30d as proxy for this month (demo)
  const sumMonthAmount = sum30Amount;
  const sumMonthTarget = sum30Expected;
  const totalPerformancePct = sum30Expected > 0 ? Math.round((sum30Amount / sum30Expected) * 100) : 0;

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
  const scoreboardBarDataMonth = [
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
    const visibleColumns: string[] = [];
    if (showTodayCols) visibleColumns.push('Today');
    if (showLast30Cols) visibleColumns.push('Last 30d');
    if (showLastMonthCols) visibleColumns.push(selectedMonth);

    // Use the correct data based on table type
    const dataSource: { [key: string]: { count: number; amount: number; expected: number }[] } = tableType === 'agreement' ? agreementData : invoicedData;

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
            const isThisMonth = columnType === selectedMonth;
            
            return (
              <React.Fragment key={columnType}>
                {/* Combined Count and Amount row */}
                <tr className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-semibold text-slate-700">{columnType}</td>
                  {categories.map((category, index) => {
                    const data = isToday ? dataSource["Today"][index + 1] : // Skip General row
                                isLast30 ? dataSource["Last 30d"][index + 1] : // Skip General row
                                dataSource[selectedMonth]?.[index]; // This month uses selected month data (no General row)
                    const amount = data?.amount || 0;
                    const target = data?.expected || 0;
                    const targetClass = target > 0 ? (amount >= target ? 'text-green-600' : 'text-red-600') : 'text-slate-700';
                    
                    return (
                      <td key={`${category}-combined`} className="px-5 py-3 text-center">
                        <div className="space-y-1">
                          <div className="badge font-semibold px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">{data?.count || 0}</div>
                          <div className="border-t border-slate-200 my-1"></div>
                          <div className="font-semibold text-slate-700">₪{Math.ceil(amount).toLocaleString()}</div>
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
                              return dataSource["Today"].slice(1, -1).reduce((sum: number, item: { count: number; amount: number; expected: number }) => sum + (item.count || 0), 0);
                            } else if (isLast30) {
                              return dataSource["Last 30d"].slice(1, -1).reduce((sum: number, item: { count: number; amount: number; expected: number }) => sum + (item.count || 0), 0);
                            } else {
                              // Use the pre-calculated total from the data instead of recalculating
                              return dataSource[selectedMonth]?.[5]?.count || 0;
                            }
                          })()}
                        </div>
                      </div>
                      <div className="border-t border-white/20 my-1"></div>
                      <div className="font-semibold text-white">
                        ₪{(() => {
                          if (isToday) {
                            return Math.ceil(dataSource["Today"].slice(1, -1).reduce((sum: number, item: { count: number; amount: number; expected: number }) => sum + (item.amount || 0), 0)).toLocaleString();
                          } else if (isLast30) {
                            return Math.ceil(dataSource["Last 30d"].slice(1, -1).reduce((sum: number, item: { count: number; amount: number; expected: number }) => sum + (item.amount || 0), 0)).toLocaleString();
                                                      } else {
                              // Use the pre-calculated total from the data instead of recalculating
                              return Math.ceil(dataSource[selectedMonth]?.[5]?.amount || 0).toLocaleString();
                            }
                        })()}
                      </div>
                    </div>
                  </td>
                </tr>
                {/* Target row - only show for current month */}
                {isThisMonth && (
                  <tr className="bg-white border-2 border-purple-600">
                    <td className="px-5 py-3 font-semibold text-slate-700">Target {columnType}</td>
                    {categories.map((category, index) => {
                      const data = dataSource[selectedMonth]?.[index];
                      const amount = data?.amount || 0;
                      const target = data?.expected || 0;
                      const targetClass = target > 0 ? (amount >= target ? 'text-green-600' : 'text-red-600') : 'text-slate-700';
                      
                      return (
                        <td key={`${category}-target`} className={`px-5 py-3 text-center font-semibold ${targetClass}`}>
                          {target ? `₪${Math.ceil(target).toLocaleString()}` : '—'}
                        </td>
                      );
                    })}
                    {/* Total target column */}
                    <td className="px-5 py-3 text-center text-white" style={{backgroundColor: '#411cce'}}>
                      {(() => {
                        // For invoiced data, sum all 5 department targets (indices 0-4)
                        // For agreement data, sum departments 1-5 (indices 0-4, excluding General)
                        const totalTarget = dataSource[selectedMonth]?.slice(0, 5).reduce((sum: number, item: { count: number; amount: number; expected: number }) => sum + (item.expected || 0), 0) || 0;
                        return (
                          <span className="font-semibold text-white">
                            {totalTarget ? `₪${Math.ceil(totalTarget).toLocaleString()}` : '—'}
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
                                  ? `₪${Math.ceil(lead.amount || 0).toLocaleString()}` 
                                  : `${lead.balance_currency || '₪'}${Math.ceil(lead.balance || 0).toLocaleString()}`
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
                                  ? `₪${Math.ceil(lead.amount || 0).toLocaleString()}` 
                                  : `${lead.balance_currency || '₪'}${Math.ceil(lead.balance || 0).toLocaleString()}`
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
                                    ? `₪${Math.ceil(lead.amount || 0).toLocaleString()}` 
                                    : `${lead.balance_currency || '₪'}${Math.ceil(lead.balance || 0).toLocaleString()}`
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
                                    ? `₪${Math.ceil(lead.amount || 0).toLocaleString()}` 
                                    : `${lead.balance_currency || '₪'}${Math.ceil(lead.balance || 0).toLocaleString()}`
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
                      <span className="text-2xl font-bold text-gray-900">{totalLeadsThisMonth}</span>
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
                      <span className="text-2xl font-bold text-gray-900">{meetingsScheduledThisMonth}</span>
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
                      <span className="text-2xl font-bold text-gray-900">₪{Math.ceil(realRevenueThisMonth).toLocaleString()}</span>
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
                      <span className="text-2xl font-bold text-gray-900">{contractsSignedThisMonth}</span>
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
                          <details className="dropdown dropdown-end">
                            <summary className="btn btn-xs btn-ghost text-slate-700">
                              {selectedMonth} <svg className="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            </summary>
                            <ul className="dropdown-content z-[1] p-2 shadow bg-base-100 rounded-box w-40 max-h-80 overflow-y-auto" style={{ display: 'flex', flexDirection: 'column' }}>
                              {months.map(month => (
                                <li key={month} style={{ width: '100%' }}>
                                  <a 
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setSelectedMonth(month);
                                      // Close the details element
                                      const details = e.currentTarget.closest('details');
                                      if (details) {
                                        details.removeAttribute('open');
                                      }
                                    }}
                                    className={`block w-full p-2 text-sm hover:bg-gray-100 ${selectedMonth === month ? 'bg-primary text-primary-content' : ''}`}
                                  >
                                    {month}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </details>
                          <details className="dropdown dropdown-end">
                            <summary className="btn btn-xs btn-ghost text-slate-700">
                              {selectedYear} <svg className="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            </summary>
                            <ul className="dropdown-content z-[1] p-2 shadow bg-base-100 rounded-box w-24 max-h-60 overflow-y-auto" style={{ display: 'flex', flexDirection: 'column' }}>
                              {years.map(year => (
                                <li key={year} style={{ width: '100%' }}>
                                  <a 
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setSelectedYear(year);
                                      // Close the details element
                                      const details = e.currentTarget.closest('details');
                                      if (details) {
                                        details.removeAttribute('open');
                                      }
                                    }}
                                    className="block w-full p-2 text-sm hover:bg-gray-100"
                                  >
                                    {year}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </details>
                        </div>
                      </div>
                      {departmentPerformanceLoading ? (
                        <div className="flex justify-center items-center py-12">
                          <span className="loading loading-spinner loading-lg text-primary"></span>
                        </div>
                      ) : renderColumnsView('agreement')}
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
                          <details className="dropdown dropdown-end">
                            <summary className="btn btn-xs btn-ghost text-slate-700">
                              {selectedMonth} <svg className="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            </summary>
                            <ul className="dropdown-content z-[1] p-2 shadow bg-base-100 rounded-box w-40 max-h-80 overflow-y-auto" style={{ display: 'flex', flexDirection: 'column' }}>
                              {months.map(month => (
                                <li key={month} style={{ width: '100%' }}>
                                  <a 
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setSelectedMonth(month);
                                      // Close the details element
                                      const details = e.currentTarget.closest('details');
                                      if (details) {
                                        details.removeAttribute('open');
                                      }
                                    }}
                                    className={`block w-full p-2 text-sm hover:bg-gray-100 ${selectedMonth === month ? 'bg-primary text-primary-content' : ''}`}
                                  >
                                    {month}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </details>
                          <details className="dropdown dropdown-end">
                            <summary className="btn btn-xs btn-ghost text-slate-700">
                              {selectedYear} <svg className="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            </summary>
                            <ul className="dropdown-content z-[1] p-2 shadow bg-base-100 rounded-box w-24 max-h-60 overflow-y-auto" style={{ display: 'flex', flexDirection: 'column' }}>
                              {years.map(year => (
                                <li key={year} style={{ width: '100%' }}>
                                  <a 
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setSelectedYear(year);
                                      // Close the details element
                                      const details = e.currentTarget.closest('details');
                                      if (details) {
                                        details.removeAttribute('open');
                                      }
                                    }}
                                    className="block w-full p-2 text-sm hover:bg-gray-100"
                                  >
                                    {year}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </details>
                        </div>
                      </div>
                      {invoicedDataLoading ? (
                        <div className="flex justify-center items-center py-12">
                          <span className="loading loading-spinner loading-lg text-primary"></span>
                        </div>
                      ) : renderColumnsView('invoiced')}
                    </div>
                                  </div>
                                  
                  {/* Mobile: keep card grid */}
                  {departmentPerformanceLoading ? (
                    <div className="flex justify-center items-center py-12 md:hidden">
                      <span className="loading loading-spinner loading-lg text-primary"></span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 md:hidden">
                      {scoreboardCategories.map((category, index) => {
                      const todayData = agreementData["Today"]?.[index] || { count: 0, amount: 0, expected: 0 };
                      const last30Data = agreementData["Last 30d"]?.[index] || { count: 0, amount: 0, expected: 0 };
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
                                      <div className="text-xs font-medium text-slate-600">₪{todayData.amount ? Math.ceil(todayData.amount).toLocaleString() : '0'}</div>
                                        </div>
                                    </div>
                                  <div className="bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg p-3 border border-purple-400">
                                    <div className="flex items-center gap-2 mb-2">
                                      <div className="w-2 h-2 bg-white rounded-full"></div>
                                      <span className="text-xs font-medium text-white">Last 30d</span>
                                  </div>
                                    <div className="space-y-1">
                                      <div className="text-lg font-bold text-white">{last30Data.count}</div>
                                      <div className="text-xs font-medium text-white/90">₪{last30Data.amount ? Math.ceil(last30Data.amount).toLocaleString() : '0'}</div>
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
                                <div className="w-full h-40" style={{ minWidth: '200px', minHeight: '160px' }}>
                                  {chartData && chartData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={160}>
                                      <LineChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'white' }} axisLine={{ stroke: 'white' }} tickLine={{ stroke: 'white' }} interval={5} />
                                        <YAxis tick={{ fontSize: 10, fill: 'white' }} axisLine={{ stroke: 'white' }} tickLine={{ stroke: 'white' }} width={25} />
                                        <Tooltip contentStyle={{ background: 'rgba(255,255,255,0.98)', borderRadius: 12, border: '1px solid #e5e7eb' }} itemStyle={{ color: '#6366f1', fontWeight: 600 }} />
                                        <Line type="monotone" dataKey="contracts" stroke="#ffffff" strokeWidth={3} dot={{ r: 3, fill: '#fff' }} />
                                      </LineChart>
                                    </ResponsiveContainer>
                                  ) : (
                                    <div className="flex items-center justify-center h-full text-white/70 text-sm">
                                      No data available
                                    </div>
                                  )}
                                </div>
                                                             </div>
                             </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  )}
                </div>
              )}

              {/* Professional Chart Visualization */}
              {(scoreTab === 'Today' || scoreTab === selectedMonth || scoreTab === 'Last 30d') && (
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
                    <div className="w-full h-[450px]" style={{ minWidth: '400px', minHeight: '450px' }}>
                      {(() => {
                        const chartData = scoreTab === 'Today' ? scoreboardBarDataToday : scoreTab === selectedMonth ? scoreboardBarDataMonth : scoreboardBarData30d;
                        return chartData && chartData.length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%" minWidth={400} minHeight={450}>
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
                                  if (name === 'signed') return [`${Math.ceil(value).toLocaleString()} NIS`, 'Signed'];
                                  if (name === 'due') return [`${Math.ceil(value).toLocaleString()} NIS`, 'Due'];
                                  return [Math.ceil(value).toLocaleString(), name || 'Unknown'];
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
                        ) : (
                          <div className="flex items-center justify-center h-full text-gray-500">
                            <div className="text-center">
                              <div className="text-lg font-medium mb-2">No data available</div>
                              <div className="text-sm">Chart will appear when data is loaded</div>
                            </div>
                          </div>
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
                          const data = scoreTab === 'Today' ? scoreboardBarDataToday : scoreTab === selectedMonth ? scoreboardBarDataMonth : scoreboardBarData30d;
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
                          const data = scoreTab === 'Today' ? scoreboardBarDataToday : scoreTab === selectedMonth ? scoreboardBarDataMonth : scoreboardBarData30d;
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
                          const data = scoreTab === 'Today' ? scoreboardBarDataToday : scoreTab === selectedMonth ? scoreboardBarDataMonth : scoreboardBarData30d;
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

      {/* 3. Employee Scoreboard Component */}
      <EmployeeScoreboard />

      {/* Team Availability Section */}
      <div className="w-full mt-12">
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-600">
                <UserGroupIcon className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Team Availability</h2>
                <p className="text-gray-500 text-sm">Employees unavailable today</p>
              </div>
            </div>
              
              {/* Detailed Table */}
              {unavailableEmployeesLoading ? (
                <div className="flex justify-center items-center py-8">
                  <div className="loading loading-spinner loading-lg text-gray-600"></div>
                </div>
              ) : unavailableEmployeesData.length > 0 ? (
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="table w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-gray-700 font-medium">Employee</th>
                          <th className="text-gray-700 font-medium">Date</th>
                          <th className="text-gray-700 font-medium">Time</th>
                          <th className="text-gray-700 font-medium">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unavailableEmployeesData.map((item) => (
                          <tr key={item.id} className="hover:bg-gray-50 border-b border-gray-100">
                            <td className="font-medium text-gray-900 py-3">{item.employeeName}</td>
                            <td className="text-gray-700 py-3">{item.date}</td>
                            <td className="text-gray-700 py-3">{item.time}</td>
                            <td className="text-gray-700 py-3">{item.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="bg-gray-50 rounded-lg p-8 border border-gray-200 text-center">
                  <div className="flex flex-col items-center gap-4">
                    <div className="p-3 bg-green-100 rounded-full">
                      <CheckCircleIcon className="w-8 h-8 text-green-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">All Team Members Available</h3>
                      <p className="text-gray-600">No employees are unavailable today. Great job team!</p>
                    </div>
                  </div>
                </div>
              )}
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
              <div className="w-full h-72" style={{ minWidth: '400px', minHeight: '288px' }}>
                {performanceData && performanceData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={400} minHeight={288}>
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
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    <div className="text-center">
                      <div className="text-lg font-medium mb-2">No performance data available</div>
                      <div className="text-sm">Chart will appear when data is loaded</div>
                    </div>
                  </div>
                )}
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
                          <span className="text-sm font-bold text-green-600">{lead.proposal_currency || '₪'}{lead.proposal_total ? Math.ceil(Number(lead.proposal_total)).toLocaleString() : ''}</span>
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
                          <span className="text-sm font-bold text-green-600">{lead.proposal_currency || '₪'}{lead.proposal_total ? Math.ceil(Number(lead.proposal_total)).toLocaleString() : ''}</span>
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

      {/* Unavailable Employees Modal */}
      <UnavailableEmployeesModal 
        isOpen={isUnavailableEmployeesModalOpen}
        onClose={() => setIsUnavailableEmployeesModalOpen(false)}
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