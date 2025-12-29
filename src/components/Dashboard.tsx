import React, { useState, useEffect, useRef, useMemo } from 'react';
import Meetings from './Meetings';
import AISuggestions from './AISuggestions';
import AISuggestionsModal from './AISuggestionsModal';
import OverdueFollowups from './OverdueFollowups';
import WaitingForPriceOfferMyLeadsWidget from './WaitingForPriceOfferMyLeadsWidget';
import ClosedDealsWithoutPaymentPlanWidget from './ClosedDealsWithoutPaymentPlanWidget';
import UnavailableEmployeesModal from './UnavailableEmployeesModal';
import { UserGroupIcon, CalendarIcon, ExclamationTriangleIcon, ChatBubbleLeftRightIcon, ArrowTrendingUpIcon, ChartBarIcon, ChevronLeftIcon, ChevronRightIcon, XMarkIcon, ClockIcon, SparklesIcon, MagnifyingGlassIcon, FunnelIcon, CheckCircleIcon, PlusIcon, ArrowPathIcon, VideoCameraIcon, PhoneIcon, EnvelopeIcon, DocumentTextIcon, PencilSquareIcon, TrashIcon, Squares2X2Icon, TableCellsIcon } from '@heroicons/react/24/outline';
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
import { formatMeetingValue } from '../lib/meetingValue';
import { toast } from 'react-hot-toast';
import CompactAvailabilityCalendar, { CompactAvailabilityCalendarRef } from './CompactAvailabilityCalendar';


// My Availability Section Component
const MyAvailabilitySection: React.FC<{ onAvailabilityChange?: () => void }> = ({ onAvailabilityChange }) => {
  const calendarRef = React.useRef<CompactAvailabilityCalendarRef>(null);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">My Availability</h3>
        <button
          onClick={() => {
            calendarRef.current?.openAddRangeModal();
          }}
          className="btn btn-sm btn-primary btn-circle"
          title="Add Range"
        >
          <PlusIcon className="w-4 h-4" />
        </button>
      </div>
      <CompactAvailabilityCalendar ref={calendarRef} onAvailabilityChange={onAvailabilityChange} />
    </>
  );
};

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
  // Date filter for team availability (default to today)
  const [teamAvailabilityDate, setTeamAvailabilityDate] = useState<string>(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
  // Department filter for team availability
  const [departmentFilter, setDepartmentFilter] = useState<string>('');
  const [availableDepartments, setAvailableDepartments] = useState<string[]>([]);
  const navigate = useNavigate();
  // Map of meeting location name -> default_link (from tenants_meetinglocation)
  const [meetingLocationLinks, setMeetingLocationLinks] = useState<Record<string, string>>({});

  // 1. Add state for real signed leads
  const [realSignedLeads, setRealSignedLeads] = useState<any[]>([]);
  const [realLeadsLoading, setRealLeadsLoading] = useState(false);
  
  // State for real performance data
  const [realPerformanceData, setRealPerformanceData] = useState<any[]>([]);
  const [realTeamAverageData, setRealTeamAverageData] = useState<any[]>([]);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [currentUserEmployeeId, setCurrentUserEmployeeId] = useState<number | null>(null);
  const [currentUserFullName, setCurrentUserFullName] = useState<string>('');

  // 1. Add state for real overdue leads
  const [realOverdueLeads, setRealOverdueLeads] = useState<any[]>([]);
  const [overdueLeadsLoading, setOverdueLeadsLoading] = useState(false);
  
  // Removed cache - simplified approach
  
  // State for "Show More" functionality
  const [showAllOverdueLeads, setShowAllOverdueLeads] = useState(false);
  const [allOverdueLeads, setAllOverdueLeads] = useState<any[]>([]);
  const [loadingMoreLeads, setLoadingMoreLeads] = useState(false);
  const [overdueCountFetched, setOverdueCountFetched] = useState(false);
  
  // State for follow-ups tabs and view mode
  const [followUpTab, setFollowUpTab] = useState<'today' | 'overdue' | 'tomorrow' | 'future'>('today');
  const [followUpViewMode, setFollowUpViewMode] = useState<'table' | 'card'>(() => {
    // Default to table on desktop, card on mobile
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 768 ? 'table' : 'card';
    }
    return 'table';
  });
  const [todayFollowUps, setTodayFollowUps] = useState<any[]>([]);
  const [tomorrowFollowUps, setTomorrowFollowUps] = useState<any[]>([]);
  const [futureFollowUps, setFutureFollowUps] = useState<any[]>([]);
  const [futureFollowUpsLoading, setFutureFollowUpsLoading] = useState(false);
  const [todayFollowUpsLoading, setTodayFollowUpsLoading] = useState(false);
  const [tomorrowFollowUpsLoading, setTomorrowFollowUpsLoading] = useState(false);
  const [editingFollowUpId, setEditingFollowUpId] = useState<string | number | null>(null);
  const [editFollowUpDate, setEditFollowUpDate] = useState<string>('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Fetch meeting locations and their default links for join buttons
  useEffect(() => {
    const fetchMeetingLocations = async () => {
      try {
        const { data, error } = await supabase
          .from('tenants_meetinglocation')
          .select('name, default_link');

        if (error) {
          return;
        }

        const map: Record<string, string> = {};
        (data || []).forEach((loc: any) => {
          if (loc.name && loc.default_link) {
            map[loc.name] = loc.default_link;
          }
        });
        setMeetingLocationLinks(map);
      } catch (err) {
      }
    };

    fetchMeetingLocations();
  }, []);

  // Fetch detailed unavailable employees data for table
  // Helper function to map role codes to display names
  // Helper function to get today's date string in YYYY-MM-DD format
  const getTodayDateString = (): string => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Helper function to format the date description for display
  const getDateDescription = (dateString: string): string => {
    if (dateString === getTodayDateString()) {
      return 'today';
    }
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  const getRoleDisplayName = (roleCode: string | null | undefined): string => {
    if (!roleCode) return 'N/A';
    
    const roleMap: { [key: string]: string } = {
      'c': 'Closer',
      's': 'Scheduler',
      'h': 'Handler',
      'n': 'No role',
      'e': 'Expert',
      'z': 'Manager',
      'Z': 'Manager',
      'p': 'Partner',
      'm': 'Manager',
      'dm': 'Department Manager',
      'pm': 'Project Manager',
      'se': 'Secretary',
      'b': 'Book keeper',
      'partners': 'Partners',
      'dv': 'Developer',
      'ma': 'Marketing',
      'P': 'Partner',
      'M': 'Manager',
      'DM': 'Department Manager',
      'PM': 'Project Manager',
      'SE': 'Secretary',
      'B': 'Book keeper',
      'Partners': 'Partners',
      'd': 'Diverse',
      'f': 'Finance',
      'col': 'Collection',
      'lawyer': 'Helper Closer'
    };
    
    return roleMap[roleCode] || roleCode || 'N/A';
  };

  const fetchUnavailableEmployeesData = async (selectedDate?: string) => {
    setUnavailableEmployeesLoading(true);
    try {
      // Use provided date or default to today
      const dateToUse = selectedDate || teamAvailabilityDate;
      const selectedDateObj = new Date(dateToUse);
      const year = selectedDateObj.getFullYear();
      const month = String(selectedDateObj.getMonth() + 1).padStart(2, '0');
      const day = String(selectedDateObj.getDate()).padStart(2, '0');
      const selectedDateString = `${year}-${month}-${day}`;
      
      // Also get today's date for "currently active" comparison
      const today = new Date();
      const todayYear = today.getFullYear();
      const todayMonth = String(today.getMonth() + 1).padStart(2, '0');
      const todayDay = String(today.getDate()).padStart(2, '0');
      const todayString = `${todayYear}-${todayMonth}-${todayDay}`;

      const { data: employees, error } = await supabase
        .from('tenants_employee')
        .select(`
          id,
          display_name,
          unavailable_times,
          unavailable_ranges,
          bonuses_role,
          department_id,
          photo_url,
          photo,
          tenant_departement!department_id(id, name)
        `)
        .not('unavailable_times', 'is', null);

      if (error) {
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
        
        // Check for specific time slots on selected date
        const selectedDateTimes = unavailableTimes.filter((time: any) => time.date === selectedDateString);
        
        // Check for date ranges that include selected date
        const selectedDateRanges = unavailableRanges.filter((range: any) => 
          selectedDateString >= range.startDate && selectedDateString <= range.endDate
        );

        if (selectedDateTimes.length > 0 || selectedDateRanges.length > 0) {
          totalUnavailable++;

          // Process time slots
          selectedDateTimes.forEach((time: any) => {
            const startTime = parseInt(time.startTime.split(':')[0]) * 60 + parseInt(time.startTime.split(':')[1]);
            const endTime = parseInt(time.endTime.split(':')[0]) * 60 + parseInt(time.endTime.split(':')[1]);
            // Only mark as "currently active" if it's today and the current time is within the range
            const isCurrentlyActive = selectedDateString === todayString && currentTime >= startTime && currentTime <= endTime;
            
            if (isCurrentlyActive) {
              currentlyUnavailable++;
            } else {
              scheduledTimeOff++;
            }

            const formattedDate = new Date(time.date).toLocaleDateString('en-GB', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric'
            });

            const departmentName = (employee.tenant_departement as any)?.name || 'N/A';
            detailedData.push({
              id: `${employee.id}-${time.id}`,
              employeeId: employee.id,
              employeeName: employee.display_name,
              role: getRoleDisplayName(employee.bonuses_role),
              department: departmentName,
              date: formattedDate,
              time: `${time.startTime} - ${time.endTime}`,
              reason: time.reason,
              isActive: isCurrentlyActive,
              photo_url: employee.photo_url || null,
              photo: employee.photo || null
            });
          });

          // Process date ranges
          selectedDateRanges.forEach((range: any) => {
            scheduledTimeOff++;

            const startDateFormatted = new Date(range.startDate).toLocaleDateString('en-GB', {
              day: '2-digit',
              month: '2-digit'
            });
            const endDateFormatted = new Date(range.endDate).toLocaleDateString('en-GB', {
              day: '2-digit',
              month: '2-digit'
            });

            const departmentName = (employee.tenant_departement as any)?.name || 'N/A';
            detailedData.push({
              id: `${employee.id}-${range.id}`,
              employeeId: employee.id,
              employeeName: employee.display_name,
              role: getRoleDisplayName(employee.bonuses_role),
              department: departmentName,
              date: `${startDateFormatted} to ${endDateFormatted}`,
              time: 'All Day',
              reason: range.reason,
              isActive: false,
              photo_url: employee.photo_url || null,
              photo: employee.photo || null
            });
          });
        }
      });

      // Deduplicate: keep only the latest availability entry per employee
      const employeeMap = new Map<number, any>();
      // Sort by id in descending order to get latest entries first
      detailedData.sort((a, b) => {
        // Compare by id (which includes time/range id) in reverse order
        return b.id.localeCompare(a.id);
      });
      
      // Keep only the first occurrence of each employee (which will be the latest)
      detailedData.forEach(item => {
        if (!employeeMap.has(item.employeeId)) {
          employeeMap.set(item.employeeId, item);
        }
      });
      
      // Convert map back to array
      const uniqueData = Array.from(employeeMap.values());
      
      // Recalculate counts based on unique data
      const uniqueTotalUnavailable = uniqueData.length;
      const uniqueCurrentlyUnavailable = uniqueData.filter(item => item.isActive).length;
      const uniqueScheduledTimeOff = uniqueTotalUnavailable - uniqueCurrentlyUnavailable;

      setUnavailableEmployeesData(uniqueData);
      setUnavailableEmployeesCount(uniqueTotalUnavailable);
      setCurrentlyUnavailableCount(uniqueCurrentlyUnavailable);
      setScheduledTimeOffCount(uniqueScheduledTimeOff);
      
      // Extract unique departments from the unique data
      const departments = Array.from(new Set(uniqueData.map(item => item.department).filter(dept => dept && dept !== 'N/A')));
      departments.sort();
      setAvailableDepartments(departments as string[]);
    } catch (error) {
    } finally {
      setUnavailableEmployeesLoading(false);
    }
  };

  // Optimized function to fetch follow-up leads data using the new follow_ups table
  const fetchFollowUpLeadsData = async (dateType: 'today' | 'overdue' | 'tomorrow' | 'future', fetchAll = false) => {
    try {
      // Get current user's data
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return { newLeads: [], legacyLeads: [], totalCount: 0 };
      }
      const { data: userData, error: userDataError } = await supabase
        .from('users')
        .select('id')
        .eq('auth_id', user.id)
        .single();

      if (userDataError || !userData?.id) {
        return { newLeads: [], legacyLeads: [], totalCount: 0 };
      }

      const userId = userData.id;
      
      // Get today's date for filtering
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStart = today.toISOString();
      today.setHours(23, 59, 59, 999);
      const todayEnd = today.toISOString();
      
      // Get tomorrow's date for filtering
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const tomorrowStart = tomorrow.toISOString();
      tomorrow.setHours(23, 59, 59, 999);
      const tomorrowEnd = tomorrow.toISOString();
      
      // Get 2 days from now (start of future follow-ups)
      const twoDaysFromNow = new Date(today);
      twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
      twoDaysFromNow.setHours(0, 0, 0, 0);
      const futureStart = twoDaysFromNow.toISOString();
      
      const fiftyDaysAgo = new Date();
      fiftyDaysAgo.setDate(fiftyDaysAgo.getDate() - 50);
      fiftyDaysAgo.setHours(0, 0, 0, 0);
      const fiftyDaysAgoISO = fiftyDaysAgo.toISOString();
      
      // Fetch new leads with follow-ups from follow_ups table
      let newFollowupsQuery = supabase
        .from('follow_ups')
        .select(`
          id,
          date,
          new_lead_id,
          leads!follow_ups_new_lead_id_fkey (
            id,
            lead_number,
            name,
            stage,
            topic,
            status,
            unactivated_at,
            expert,
            manager,
            meeting_manager,
            category,
            category_id,
            balance,
            balance_currency,
            probability,
            handler,
            scheduler,
            closer,
            meeting_manager_id,
            expert_id,
            case_handler_id
          )
        `)
        .eq('user_id', userId)
        .not('new_lead_id', 'is', null);

      // Apply date filter based on dateType
      if (dateType === 'today') {
        newFollowupsQuery = newFollowupsQuery.gte('date', todayStart).lte('date', todayEnd);
      } else if (dateType === 'tomorrow') {
        newFollowupsQuery = newFollowupsQuery.gte('date', tomorrowStart).lte('date', tomorrowEnd);
      } else if (dateType === 'future') {
        // future: 2 days and up from now
        newFollowupsQuery = newFollowupsQuery.gte('date', futureStart);
      } else {
        // overdue: less than today but not more than 50 days ago
        newFollowupsQuery = newFollowupsQuery.gte('date', fiftyDaysAgoISO).lt('date', todayStart);
      }

      newFollowupsQuery = newFollowupsQuery.limit(fetchAll ? 1000 : 1000);
      
      const { data: newFollowupsData, error: newFollowupsError } = await newFollowupsQuery;
      if (newFollowupsError) throw newFollowupsError;

      // Fetch legacy leads with follow-ups from follow_ups table
      let legacyFollowupsQuery = supabase
        .from('follow_ups')
        .select(`
          id,
          date,
          lead_id,
          leads_lead!follow_ups_lead_id_fkey (
            id,
            name,
            stage,
            topic,
            status,
            expert_id,
            meeting_manager_id,
            meeting_lawyer_id,
            meeting_scheduler_id,
            case_handler_id,
            closer_id,
            category_id,
            total,
            currency_id
          )
        `)
        .eq('user_id', userId)
        .not('lead_id', 'is', null);

      // Apply date filter based on dateType
      if (dateType === 'today') {
        legacyFollowupsQuery = legacyFollowupsQuery.gte('date', todayStart).lte('date', todayEnd);
      } else if (dateType === 'tomorrow') {
        legacyFollowupsQuery = legacyFollowupsQuery.gte('date', tomorrowStart).lte('date', tomorrowEnd);
      } else if (dateType === 'future') {
        // future: 2 days and up from now
        legacyFollowupsQuery = legacyFollowupsQuery.gte('date', futureStart);
      } else {
        // overdue: less than today but not more than 50 days ago
        legacyFollowupsQuery = legacyFollowupsQuery.gte('date', fiftyDaysAgoISO).lt('date', todayStart);
      }

      legacyFollowupsQuery = legacyFollowupsQuery.limit(fetchAll ? 1000 : 1000);

      const { data: legacyFollowupsData, error: legacyFollowupsError } = await legacyFollowupsQuery;
      if (legacyFollowupsError) throw legacyFollowupsError;

      // Process new leads - filter for active leads only
      const processedNewLeads = (newFollowupsData || [])
        .filter(followup => {
          const lead = followup.leads as any;
          // Filter out inactive leads: no lead_number, empty lead_number, or has unactivated_at
          return lead && 
                 lead.lead_number && 
                 lead.lead_number !== '' && 
                 !lead.unactivated_at &&
                 lead.status !== 'not_qualified' && 
                 lead.status !== 'declined';
        })
        .map(followup => {
          const lead = followup.leads as any;
          return {
            ...lead,
            next_followup: followup.date, // Include follow-up date for compatibility
            follow_up_id: followup.id, // Include follow-up ID for editing/deleting
            lead_type: 'new' as const
          };
        });

      // Process legacy leads - filter for active leads only (status = 0, stage < 100)
      const processedLegacyLeads = (legacyFollowupsData || [])
        .filter(followup => {
          const lead = followup.leads_lead as any;
          return lead && 
                 lead.status === 0 && 
                 (lead.stage === null || lead.stage < 100);
        })
        .map(followup => {
          const lead = followup.leads_lead as any;
          return {
            ...lead,
            next_followup: followup.date, // Include follow-up date for compatibility
            follow_up_id: followup.id, // Include follow-up ID for editing/deleting
            lead_type: 'legacy' as const,
            lead_number: lead.id?.toString() || ''
          };
        });

      const result = {
        newLeads: processedNewLeads,
        legacyLeads: processedLegacyLeads,
        totalCount: processedNewLeads.length + processedLegacyLeads.length
      };
      
      return result;
    } catch (error) {
      return { newLeads: [], legacyLeads: [], totalCount: 0 };
    }
  };
  
  // Keep old function name for backward compatibility
  const fetchOverdueLeadsData = async (fetchAll = false) => {
    return fetchFollowUpLeadsData('overdue', fetchAll);
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

  // Helper function to check if location is online/teams/zoom
  const isOnlineLocation = (location: string | undefined): boolean => {
    if (!location) return false;
    const locationLower = location.toLowerCase().trim();
    return locationLower === 'online' || locationLower === 'teams' || locationLower === 'zoom';
  };

  // Fetch current user ID on mount
  useEffect(() => {
    const fetchUserId = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: userData } = await supabase
            .from('users')
            .select('id')
            .eq('auth_id', user.id)
            .single();
          if (userData) {
            setCurrentUserId(userData.id);
          }
        }
      } catch (error) {
      }
    };
    fetchUserId();
  }, []);

  // Handler to edit follow-up date
  const handleEditFollowUp = (lead: any) => {
    setEditingFollowUpId(lead.follow_up_id);
    setEditFollowUpDate(lead.next_followup ? new Date(lead.next_followup).toISOString().split('T')[0] : '');
  };

  // Handler to save edited follow-up date
  const handleSaveFollowUp = async (lead: any) => {
    if (!currentUserId || !editingFollowUpId) return;
    
    try {
      if (editFollowUpDate && editFollowUpDate.trim() !== '') {
        const { error } = await supabase
          .from('follow_ups')
          .update({ date: editFollowUpDate + 'T00:00:00Z' })
          .eq('id', editingFollowUpId)
          .eq('user_id', currentUserId);
        
        if (error) throw error;
        
        toast.success('Follow-up date updated successfully');
      } else {
        // Delete if date is empty
        await handleDeleteFollowUp(lead);
        return;
      }
      
      // Refresh follow-ups
      if (followUpTab === 'today') {
        const result = await fetchFollowUpLeadsData('today');
        setTodayFollowUps([...result.newLeads, ...result.legacyLeads]);
      } else if (followUpTab === 'tomorrow') {
        const result = await fetchFollowUpLeadsData('tomorrow');
        setTomorrowFollowUps([...result.newLeads, ...result.legacyLeads]);
      } else if (followUpTab === 'future') {
        const result = await fetchFollowUpLeadsData('future');
        setFutureFollowUps([...result.newLeads, ...result.legacyLeads]);
      } else {
        const result = await fetchFollowUpLeadsData('overdue');
        setRealOverdueLeads([...result.newLeads, ...result.legacyLeads]);
      }
      
      setEditingFollowUpId(null);
      setEditFollowUpDate('');
    } catch (error: any) {
      toast.error(`Failed to update follow-up: ${error.message || 'Unknown error'}`);
    }
  };

  // Handler to delete follow-up
  const handleDeleteFollowUp = async (lead: any) => {
    if (!currentUserId || !lead.follow_up_id) return;
    
    if (!window.confirm('Are you sure you want to delete this follow-up?')) {
      return;
    }
    
    try {
      const { error } = await supabase
        .from('follow_ups')
        .delete()
        .eq('id', lead.follow_up_id)
        .eq('user_id', currentUserId);
      
      if (error) throw error;
      
      toast.success('Follow-up deleted successfully');
      
      // Refresh follow-ups
      if (followUpTab === 'today') {
        const result = await fetchFollowUpLeadsData('today');
        setTodayFollowUps([...result.newLeads, ...result.legacyLeads]);
      } else if (followUpTab === 'tomorrow') {
        const result = await fetchFollowUpLeadsData('tomorrow');
        setTomorrowFollowUps([...result.newLeads, ...result.legacyLeads]);
      } else if (followUpTab === 'future') {
        const result = await fetchFollowUpLeadsData('future');
        setFutureFollowUps([...result.newLeads, ...result.legacyLeads]);
      } else {
        const result = await fetchFollowUpLeadsData('overdue');
        setRealOverdueLeads([...result.newLeads, ...result.legacyLeads]);
      }
      
      setEditingFollowUpId(null);
      setEditFollowUpDate('');
    } catch (error: any) {
      toast.error(`Failed to delete follow-up: ${error.message || 'Unknown error'}`);
    }
  };

  // Handler to cancel editing
  const handleCancelEditFollowUp = () => {
    setEditingFollowUpId(null);
    setEditFollowUpDate('');
  };

  // --- Add state for today's meetings (real data) ---
  const [todayMeetings, setTodayMeetings] = useState<any[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [meetingsInNextHour, setMeetingsInNextHour] = useState(0);
  const [nextHourMeetings, setNextHourMeetings] = useState<any[]>([]);
  // Fetch meetings on initial mount and refresh every minute
  useEffect(() => {
    const fetchMeetings = async () => {
      setMeetingsLoading(true);
      try {
        // First, fetch current user's employee_id, display name, and email
        const { data: { user } } = await supabase.auth.getUser();
        let userEmployeeId: number | null = null;
        let userDisplayName: string | null = null;
        let userEmail: string | null = null;
        
        if (user) {
          userEmail = user.email || null;
          
          const { data: userData } = await supabase
            .from('users')
            .select(`
              employee_id,
              email,
              tenants_employee!employee_id(
                id,
                display_name
              )
            `)
            .eq('auth_id', user.id)
            .single();
          
          if (userData?.employee_id) {
            userEmployeeId = userData.employee_id;
          }
          
          // Use email from userData if available, otherwise use auth email
          if (userData?.email) {
            userEmail = userData.email;
          }
          
          // Get display name from employee relationship
          if (userData?.tenants_employee) {
            const empData = Array.isArray(userData.tenants_employee) 
              ? userData.tenants_employee[0] 
              : userData.tenants_employee;
            if (empData?.display_name) {
              userDisplayName = empData.display_name;
            }
          }
        }
        
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const todayStart = new Date(today);
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(today);
        todayEnd.setHours(23, 59, 59, 999);
        
        // Fetch client meetings with proper joins to both leads and leads_lead tables
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
              id, name, lead_number, manager, topic, expert, stage, scheduler, helper, closer, handler, balance, balance_currency
            ),
            legacy_lead:leads_lead!legacy_lead_id(
              id, name, meeting_manager_id, meeting_lawyer_id, meeting_scheduler_id, category, category_id, expert_id, stage, closer_id, case_handler_id, total, currency_id
            )
          `)
          .eq('meeting_date', todayStr)
          .or('status.is.null,status.neq.canceled,status.neq.cancelled');
        
        // Fetch staff meetings from outlook_teams_meetings where user is in attendees
        let staffMeetings: any[] = [];
        if (userEmail) {
          const { data: outlookMeetings, error: outlookError } = await supabase
            .from('outlook_teams_meetings')
            .select('*')
            .gte('start_date_time', todayStart.toISOString())
            .lte('start_date_time', todayEnd.toISOString())
            .or('status.is.null,status.neq.cancelled');
          
          if (!outlookError && outlookMeetings) {
            // Filter staff meetings where user's email is in attendees array
            staffMeetings = outlookMeetings.filter((meeting: any) => {
              if (!meeting.attendees || !Array.isArray(meeting.attendees)) return false;
              // Check if user's email is in the attendees array
              return meeting.attendees.some((attendee: any) => {
                const attendeeEmail = typeof attendee === 'string' 
                  ? attendee.toLowerCase() 
                  : (attendee.email || '').toLowerCase();
                return attendeeEmail === userEmail?.toLowerCase();
              });
            });
          }
        }
          
        if (!error && meetings) {
          // Fetch employee names for ID mapping
          const employeeIds = new Set<string>();
          meetings.forEach((meeting: any) => {
            const addValidId = (id: any) => {
              if (id && id !== '---' && id !== '' && id !== null && id !== undefined) {
                employeeIds.add(id.toString());
              }
            };
            
            addValidId(meeting.legacy_lead?.expert_id);
            addValidId(meeting.legacy_lead?.meeting_manager_id);
            addValidId(meeting.legacy_lead?.meeting_lawyer_id);
            addValidId(meeting.legacy_lead?.meeting_scheduler_id);
            addValidId(meeting.legacy_lead?.case_handler_id);
            addValidId(meeting.expert);
            addValidId(meeting.meeting_manager);
            addValidId(meeting.helper);
            // For new leads, expert might be an ID
            if (meeting.lead?.expert && !isNaN(Number(meeting.lead.expert))) {
              addValidId(meeting.lead.expert);
            }
            // For new leads, scheduler might be an ID
            if (meeting.lead?.scheduler && !isNaN(Number(meeting.lead.scheduler))) {
              addValidId(meeting.lead.scheduler);
            }
            // For new leads, helper might be an ID
            if (meeting.lead?.helper && !isNaN(Number(meeting.lead.helper))) {
              addValidId(meeting.lead.helper);
            }
            // For new leads, closer might be an ID
            if (meeting.lead?.closer && !isNaN(Number(meeting.lead.closer))) {
              addValidId(meeting.lead.closer);
            }
            // For new leads, manager might be an ID
            if (meeting.lead?.manager && !isNaN(Number(meeting.lead.manager))) {
              addValidId(meeting.lead.manager);
            }
            // For new leads, handler might be an ID
            if (meeting.lead?.handler && !isNaN(Number(meeting.lead.handler))) {
              addValidId(meeting.lead.handler);
            }
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

          // Filter meetings to only include those where user's employee_id matches a role
          // Helper function to check if user matches any role
          const userMatchesRole = (meeting: any): boolean => {
            if (!userEmployeeId) return true; // If no user employee_id, show all meetings
            
            // Check legacy lead roles
            if (meeting.legacy_lead) {
              const legacyLead = meeting.legacy_lead;
              return (
                legacyLead.meeting_scheduler_id?.toString() === userEmployeeId.toString() ||
                legacyLead.meeting_manager_id?.toString() === userEmployeeId.toString() ||
                legacyLead.meeting_lawyer_id?.toString() === userEmployeeId.toString() ||
                legacyLead.expert_id?.toString() === userEmployeeId.toString() ||
                legacyLead.closer_id?.toString() === userEmployeeId.toString() ||
                legacyLead.case_handler_id?.toString() === userEmployeeId.toString()
              );
            }
            
            // Check new lead roles
            if (meeting.lead) {
              const newLead = meeting.lead;
              // For new leads, fields might be IDs or display names
              // We need to check both the lead fields and the meeting fields
              const checkField = (field: any): boolean => {
                if (!field) return false;
                // If it's a number/ID, compare directly with employee_id
                if (!isNaN(Number(field))) {
                  return field.toString() === userEmployeeId?.toString();
                }
                // If it's a string (display name), compare with user's display name
                if (typeof field === 'string' && userDisplayName) {
                  return field.trim() === userDisplayName.trim();
                }
                return false;
              };
              
              return (
                checkField(newLead.scheduler) ||
                checkField(newLead.manager) ||
                checkField(newLead.helper) ||
                checkField(newLead.expert) ||
                checkField(newLead.closer) ||
                checkField(newLead.handler) ||
                checkField(meeting.meeting_manager) ||
                checkField(meeting.expert) ||
                checkField(meeting.helper)
              );
            }
            
            // Fallback: check meeting-level fields
            if (userEmployeeId) {
              return (
                meeting.meeting_manager?.toString() === userEmployeeId.toString() ||
                meeting.expert?.toString() === userEmployeeId.toString() ||
                meeting.helper?.toString() === userEmployeeId.toString()
              );
            }
            // If we have display name, check against meeting fields that might be display names
            if (userDisplayName) {
              return (
                (typeof meeting.meeting_manager === 'string' && meeting.meeting_manager.trim() === userDisplayName.trim()) ||
                (typeof meeting.expert === 'string' && meeting.expert.trim() === userDisplayName.trim()) ||
                (typeof meeting.helper === 'string' && meeting.helper.trim() === userDisplayName.trim())
              );
            }
            return false;
          };
          
          // Filter meetings by user role
          const filteredMeetings = (meetings || []).filter(userMatchesRole);
          
          // Process the meetings to combine lead data from both tables
          const processedMeetings = filteredMeetings.map((meeting: any) => {
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
          
          // Store processed meetings first
          const processedMeetingsList = processedMeetings.map((meeting: any) => {
            // Determine expert name
            let expertName = 'Unassigned';
            if (meeting.legacy_lead?.expert_id) {
              expertName = employeeNameMap[meeting.legacy_lead.expert_id.toString()] || meeting.legacy_lead.expert_id.toString();
            } else if (meeting.lead?.expert) {
              // For new leads, expert might be a name or ID
              if (isNaN(Number(meeting.lead.expert))) {
                expertName = meeting.lead.expert;
              } else {
                expertName = employeeNameMap[meeting.lead.expert.toString()] || meeting.lead.expert;
              }
            } else if (meeting.expert) {
              // Fallback to meeting.expert
              if (isNaN(Number(meeting.expert))) {
                expertName = meeting.expert;
              } else {
                expertName = employeeNameMap[meeting.expert.toString()] || meeting.expert;
              }
            }

            // Determine scheduler name
            let schedulerName = '---';
            if (meeting.legacy_lead?.meeting_scheduler_id) {
              // For legacy leads, use meeting_scheduler_id
              schedulerName = employeeNameMap[meeting.legacy_lead.meeting_scheduler_id.toString()] || meeting.legacy_lead.meeting_scheduler_id.toString();
            } else if (meeting.lead?.scheduler) {
              // For new leads, first check lead.scheduler field
              const schedulerField = meeting.lead.scheduler;
              if (!isNaN(Number(schedulerField))) {
                // If it's an ID, look it up
                schedulerName = employeeNameMap[schedulerField.toString()] || schedulerField.toString();
              } else {
                // If it's a display name, use it directly
                schedulerName = schedulerField;
              }
            } else if (meeting.meeting_manager) {
              // Fallback to meeting_manager if scheduler is not set
              schedulerName = employeeNameMap[meeting.meeting_manager.toString()] || meeting.meeting_manager;
            }

            // Determine stage name
            let stageName = 'N/A';
            if (meeting.lead?.stage) {
              stageName = getStageName(meeting.lead.stage.toString());
            } else if (meeting.legacy_lead?.stage) {
              stageName = getStageName(meeting.legacy_lead.stage.toString());
            }

            // Determine manager name
            let managerName = 'Unassigned';
            if (meeting.legacy_lead?.meeting_manager_id) {
              // For legacy leads, use meeting_manager_id
              managerName = employeeNameMap[meeting.legacy_lead.meeting_manager_id.toString()] || meeting.legacy_lead.meeting_manager_id.toString();
            } else if (meeting.lead?.manager) {
              // For new leads, first check lead.manager field
              const managerField = meeting.lead.manager;
              if (!isNaN(Number(managerField))) {
                // If it's an ID, look it up
                managerName = employeeNameMap[managerField.toString()] || managerField.toString();
              } else {
                // If it's a display name, use it directly
                managerName = managerField;
              }
            } else if (meeting.meeting_manager) {
              // Fallback to meeting_manager if manager is not set
              managerName = employeeNameMap[meeting.meeting_manager.toString()] || meeting.meeting_manager;
            }

            // Determine helper name
            let helperName = '---';
            if (meeting.legacy_lead?.meeting_lawyer_id) {
              // For legacy leads, use meeting_lawyer_id
              helperName = employeeNameMap[meeting.legacy_lead.meeting_lawyer_id.toString()] || meeting.legacy_lead.meeting_lawyer_id.toString();
            } else if (meeting.lead?.helper) {
              // For new leads, first check lead.helper field
              const helperField = meeting.lead.helper;
              if (!isNaN(Number(helperField))) {
                // If it's an ID, look it up
                helperName = employeeNameMap[helperField.toString()] || helperField.toString();
              } else {
                // If it's a display name, use it directly
                helperName = helperField;
              }
            } else if (meeting.helper) {
              // Fallback to meeting.helper if helper is not set
              helperName = employeeNameMap[meeting.helper.toString()] || meeting.helper;
            }

            return {
              id: meeting.id,
              lead: meeting.lead?.lead_number || 'N/A',
              name: meeting.lead?.name || 'Unknown',
              topic: meeting.lead?.topic || 'Consultation',
              expert: expertName,
              scheduler: schedulerName,
              helper: helperName,
              stage: stageName,
              time: meeting.meeting_time,
              location: meeting.meeting_location || 'Teams',
              manager: managerName,
            value: formatMeetingValue({
              leadBalance: meeting.lead?.balance,
              leadBalanceCurrency: meeting.lead?.balance_currency,
              legacyTotal: meeting.legacy_lead?.total,
              legacyCurrencyId: meeting.legacy_lead?.currency_id ?? null,
              meetingAmount: meeting.meeting_amount,
              meetingCurrency: meeting.meeting_currency,
            }).display,
              link: meeting.teams_meeting_url || meetingLocationLinks[meeting.meeting_location] || '',
            };
          });

          // Process staff meetings to match the same structure
          const processedStaffMeetings = staffMeetings.map((staffMeeting: any) => {
            // Extract time from start_date_time
            const startDate = new Date(staffMeeting.start_date_time);
            const timeStr = startDate.toTimeString().substring(0, 5); // HH:MM format
            
            return {
              id: `staff-${staffMeeting.id}`,
              lead: 'Staff Meeting',
              name: staffMeeting.subject || 'Staff Meeting',
              topic: staffMeeting.description || 'Staff Meeting',
              expert: '---',
              scheduler: '---',
              helper: '---',
              stage: 'N/A',
              time: timeStr,
              location: staffMeeting.location || 'Teams',
              manager: '---',
              value: 'N/A',
              link: staffMeeting.teams_join_url || staffMeeting.teams_meeting_url || '',
              isStaffMeeting: true,
              meetingDateTime: startDate
            };
          });
          
          // Combine client meetings and staff meetings
          const allMeetings = [...processedMeetingsList, ...processedStaffMeetings];
          
          // Sort all meetings by time
          allMeetings.sort((a: any, b: any) => {
            const timeA = a.time || '00:00';
            const timeB = b.time || '00:00';
            return timeA.localeCompare(timeB);
          });
          
          setTodayMeetings(allMeetings);
          
          // Calculate meetings in next hour
          const nowForNextHour = new Date();
          const oneHourLater = new Date(nowForNextHour.getTime() + 60 * 60 * 1000);
          
          const meetingsInNextHourList = allMeetings
            .map((meeting: any) => {
              if (!meeting.time && !meeting.meetingDateTime) return null;
              
              let meetingDateTime: Date;
              if (meeting.meetingDateTime) {
                // Staff meeting already has meetingDateTime
                meetingDateTime = meeting.meetingDateTime;
              } else {
                // Parse meeting time (format: HH:MM or HH:MM:SS)
                const timeParts = meeting.time.split(':');
                if (timeParts.length < 2) return null;
                
                const meetingHour = parseInt(timeParts[0], 10);
                const meetingMinute = parseInt(timeParts[1], 10);
                
                // Create meeting datetime for today
                meetingDateTime = new Date(nowForNextHour);
                meetingDateTime.setHours(meetingHour, meetingMinute, 0, 0);
              }
              
              // Check if meeting is between now and one hour from now
              if (meetingDateTime >= nowForNextHour && meetingDateTime <= oneHourLater) {
                return {
                  ...meeting,
                  meetingDateTime
                };
              }
              return null;
            })
            .filter(Boolean)
            .sort((a: any, b: any) => a.meetingDateTime.getTime() - b.meetingDateTime.getTime());
          
          setMeetingsInNextHour(meetingsInNextHourList.length);
          setNextHourMeetings(meetingsInNextHourList);
        } else {
          // Even if client meetings fail, try to show staff meetings
          let staffMeetingsFallback: any[] = [];
          if (userEmail) {
            const today = new Date();
            const todayStart = new Date(today);
            todayStart.setHours(0, 0, 0, 0);
            const todayEnd = new Date(today);
            todayEnd.setHours(23, 59, 59, 999);
            
            const { data: outlookMeetings, error: outlookError } = await supabase
              .from('outlook_teams_meetings')
              .select('*')
              .gte('start_date_time', todayStart.toISOString())
              .lte('start_date_time', todayEnd.toISOString())
              .or('status.is.null,status.neq.cancelled');
            
            if (!outlookError && outlookMeetings) {
              staffMeetingsFallback = outlookMeetings.filter((meeting: any) => {
                if (!meeting.attendees || !Array.isArray(meeting.attendees)) return false;
                return meeting.attendees.some((attendee: any) => {
                  const attendeeEmail = typeof attendee === 'string' 
                    ? attendee.toLowerCase() 
                    : (attendee.email || '').toLowerCase();
                  return attendeeEmail === userEmail?.toLowerCase();
                });
              });
            }
          }
          
          const processedStaffMeetings = staffMeetingsFallback.map((staffMeeting: any) => {
            const startDate = new Date(staffMeeting.start_date_time);
            const timeStr = startDate.toTimeString().substring(0, 5);
            return {
              id: `staff-${staffMeeting.id}`,
              lead: 'Staff Meeting',
              name: staffMeeting.subject || 'Staff Meeting',
              topic: staffMeeting.description || 'Staff Meeting',
              expert: '---',
              scheduler: '---',
              helper: '---',
              stage: 'N/A',
              time: timeStr,
              location: staffMeeting.location || 'Teams',
              manager: '---',
              value: 'N/A',
              link: staffMeeting.teams_join_url || staffMeeting.teams_meeting_url || '',
              isStaffMeeting: true,
              meetingDateTime: startDate
            };
          });
          
          setTodayMeetings(processedStaffMeetings);
          setMeetingsInNextHour(0);
          setNextHourMeetings([]);
        }
      } catch (e) {
        setTodayMeetings([]);
        setMeetingsInNextHour(0);
        setNextHourMeetings([]);
      }
      setMeetingsLoading(false);
    };
    
    // Fetch immediately on mount
    fetchMeetings();
    
    // Refresh meetings every minute to update the "next hour" count
    const interval = setInterval(() => {
      fetchMeetings();
    }, 60000); // 60 seconds
    
    return () => clearInterval(interval);
  }, []); // Empty dependency array - only run on mount

  // Helper function to format time until meeting
  const formatTimeUntil = (meetingDateTime: Date): string => {
    const now = new Date();
    const diffMs = meetingDateTime.getTime() - now.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    
    if (diffMinutes < 1) return 'now';
    if (diffMinutes === 1) return 'in 1 minute';
    if (diffMinutes < 60) return `in ${diffMinutes} minutes`;
    
    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;
    if (minutes === 0) return `in ${hours} hour${hours > 1 ? 's' : ''}`;
    return `in ${hours} hour${hours > 1 ? 's' : ''} ${minutes} minute${minutes > 1 ? 's' : ''}`;
  };

  // Note: Meetings are now fetched on mount and refreshed every minute in the main useEffect above
  // This useEffect is kept for backwards compatibility but may be redundant
  useEffect(() => {
    const updateNextHourCount = () => {
      if (todayMeetings.length === 0) {
        setMeetingsInNextHour(0);
        setNextHourMeetings([]);
        return;
      }

      const now = new Date();
      const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
      
      const meetingsList = todayMeetings
        .map((meeting: any) => {
          if (!meeting.time) return null;
          
          // Parse meeting time (format: HH:MM or HH:MM:SS)
          const timeParts = meeting.time.split(':');
          if (timeParts.length < 2) return null;
          
          const meetingHour = parseInt(timeParts[0], 10);
          const meetingMinute = parseInt(timeParts[1], 10);
          
          // Create meeting datetime for today
          const meetingDateTime = new Date(now);
          meetingDateTime.setHours(meetingHour, meetingMinute, 0, 0);
          
          // Check if meeting is between now and one hour from now
          if (meetingDateTime >= now && meetingDateTime <= oneHourLater) {
            return {
              ...meeting,
              meetingDateTime
            };
          }
          return null;
        })
        .filter(Boolean)
        .sort((a: any, b: any) => a.meetingDateTime.getTime() - b.meetingDateTime.getTime());
      
      setMeetingsInNextHour(meetingsList.length);
      setNextHourMeetings(meetingsList);
    };

    // Update immediately
    updateNextHourCount();

    // Update every minute
    const interval = setInterval(updateNextHourCount, 60000);

    return () => clearInterval(interval);
  }, [todayMeetings]);

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

  // Update meetingsToday count when todayMeetings changes
  useEffect(() => {
    setMeetingsToday(todayMeetings.length);
  }, [todayMeetings]);

  // Fetch summary data (mocked for now, replace with real queries)
  useEffect(() => {
    // Fetch today's followups count - optimized count query using employee relationship
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
        
        // Get today's date for filtering
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStart = today.toISOString();
        today.setHours(23, 59, 59, 999);
        const todayEnd = today.toISOString();
        
        const userId = userData.id;
        
        // Fetch today's follow-ups count for new leads from follow_ups table
        const newLeadsPromise = supabase
          .from('follow_ups')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .not('new_lead_id', 'is', null)
          .gte('date', todayStart)
          .lte('date', todayEnd);
        
        // Fetch today's follow-ups count for legacy leads from follow_ups table
        const legacyLeadsPromise = supabase
          .from('follow_ups')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .not('lead_id', 'is', null)
          .gte('date', todayStart)
          .lte('date', todayEnd);
        
        const countPromises = [newLeadsPromise, legacyLeadsPromise];
        
        const results = await Promise.all(countPromises);
        const [newLeadsCount, legacyLeadsCount] = results;
        
        const totalCount = (newLeadsCount.count || 0) + (legacyLeadsCount?.count || 0);
        setOverdueFollowups(totalCount);
      } catch (error) {
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
        const { data: userLeads, error: userLeadsError } = await supabase
          .from('users')
          .select('id')
          .eq('auth_id', user.id)
          .single();

        if (userLeadsError) {
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

  // Calculate date array for last 30 days
  const today = new Date();
  const daysArray = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (29 - i));
    return d;
  });

  // Use real performance data if available, otherwise use empty array
  const performanceData = realPerformanceData.length > 0 ? realPerformanceData : daysArray.map((date) => ({
    date: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    count: 0,
    isToday: date.toDateString() === today.toDateString(),
    isThisMonth: date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear(),
  }));

  // Use real team average data if available, otherwise use empty array
  const teamAverageData = realTeamAverageData.length > 0 ? realTeamAverageData : daysArray.map((date) => ({
    date: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    avg: 0
  }));

  const contractsToday = performanceData.find(d => d.isToday)?.count || 0;
  const contractsThisMonth = performanceData.filter(d => d.isThisMonth).reduce((sum: number, d: { count: number; isThisMonth: boolean }) => sum + d.count, 0);
  const contractsLast30 = performanceData.reduce((sum: number, d: { count: number }) => sum + d.count, 0);

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
  
  // State for real chart data (daily department performance)
  const [departmentChartData, setDepartmentChartData] = useState<{
    [category: string]: { date: string; contracts: number; amount: number }[];
  }>({});

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
        setContractsSignedThisMonth(0);
        setContractsSignedLastMonth(0);
      } finally {
        setContractsLoading(false);
      }
    };

    fetchContractsSigned();
  }, []);

  // Fetch real performance data from leads_leadstage
  const fetchPerformanceData = async () => {
    setPerformanceLoading(true);
    try {
      // Get current user's employee ID and full name
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setPerformanceLoading(false);
        return;
      }

      // Get user's full name and employee ID
      const { data: userData, error: userError } = await supabase
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

      if (userError || !userData) {
        setPerformanceLoading(false);
        return;
      }

      const userFullName = (userData.tenants_employee as any)?.display_name || userData.full_name;
      const userEmployeeId = userData.employee_id;

      setCurrentUserFullName(userFullName || '');
      setCurrentUserEmployeeId(userEmployeeId);

      // Calculate date 30 days ago
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString();

      // Fetch contracts signed (stage = 60) from last 30 days
      const { data: contractsData, error: contractsError } = await supabase
        .from('leads_leadstage')
        .select(`
          id,
          stage,
          date,
          creator_id,
          lead_id,
          newlead_id
        `)
        .eq('stage', 60)
        .gte('date', thirtyDaysAgoStr);

      if (contractsError) {
      }

      // Process contracts to determine which belong to current user
      const userContractsByDate: Record<string, number> = {};
      const allContractsByDate: Record<string, number> = {};

      // Initialize all dates with 0
      daysArray.forEach(date => {
        const dateStr = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        userContractsByDate[dateStr] = 0;
        allContractsByDate[dateStr] = 0;
      });

      // Process each contract
      for (const contract of contractsData || []) {
        if (!contract.date) continue;
        
        const contractDate = new Date(contract.date);
        const dateStr = contractDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        
        // Count all contracts for team average
        allContractsByDate[dateStr] = (allContractsByDate[dateStr] || 0) + 1;

        // Check if this contract belongs to current user
        let belongsToUser = false;

        if (contract.creator_id) {
          // Use creator_id if available
          belongsToUser = contract.creator_id === userEmployeeId;
        } else {
          // If creator_id is NULL, get closer from the lead
          if (contract.newlead_id) {
            // New lead - get closer (string) from leads table
            const { data: newLead } = await supabase
              .from('leads')
              .select('closer')
              .eq('id', contract.newlead_id)
              .single();
            
            if (newLead?.closer === userFullName) {
              belongsToUser = true;
            }
          } else if (contract.lead_id) {
            // Legacy lead - get closer_id (bigint) from leads_lead table
            const { data: legacyLead } = await supabase
              .from('leads_lead')
              .select('closer_id')
              .eq('id', contract.lead_id)
              .single();
            
            if (legacyLead?.closer_id === userEmployeeId) {
              belongsToUser = true;
            }
          }
        }

        if (belongsToUser) {
          userContractsByDate[dateStr] = (userContractsByDate[dateStr] || 0) + 1;
        }
      }

      // Calculate team average per day
      const totalContracts = Object.values(allContractsByDate).reduce((sum, count) => sum + count, 0);
      const teamDailyAverage = totalContracts / 30; // Average per day over 30 days

      // Build performance data array
      const performanceDataArray = daysArray.map((date) => {
        const dateStr = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        return {
          date: dateStr,
          count: userContractsByDate[dateStr] || 0,
          isToday: date.toDateString() === today.toDateString(),
          isThisMonth: date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear(),
        };
      });

      // Build team average data array
      const teamAverageDataArray = daysArray.map((date) => {
        const dateStr = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        return {
          date: dateStr,
          avg: Math.round((allContractsByDate[dateStr] || 0) * 10) / 10 // Round to 1 decimal
        };
      });

      setRealPerformanceData(performanceDataArray);
      setRealTeamAverageData(teamAverageDataArray);
    } catch (error) {
    } finally {
      setPerformanceLoading(false);
    }
  };

  // Fetch performance data on component mount
  useEffect(() => {
    fetchPerformanceData();
  }, []);

  // Fetch department performance data
  const fetchDepartmentPerformance = async () => {
      setDepartmentPerformanceLoading(true);
      try {
        const now = new Date();
        const today = new Date();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(now.getDate() - 30);
        
        // Use selected month and year instead of current month
        const selectedMonthIndex = months.indexOf(selectedMonth);
        const selectedDate = new Date(selectedYear, selectedMonthIndex, 1);
        const selectedMonthName = selectedDate.toLocaleDateString('en-US', { month: 'long' });
        // Fetch only important departments from tenant_departement
        const { data: allDepartments, error: departmentsError } = await supabase
          .from('tenant_departement')
          .select('id, name, min_income, important')
          .eq('important', 't')
          .order('id');
        
        if (departmentsError) {
          throw departmentsError;
        }
        
        // Extract department IDs and create target mapping
        const departmentIds = allDepartments?.map(dept => dept.id) || [];
        const departmentTargets = allDepartments || [];
        // Log which departments are important
        const importantDepts = departmentTargets.filter(dept => dept.important === 't');
        // Debug: Log each department with its index
        departmentTargets.forEach((dept, index) => {
        });
        
        // Set department names for UI display
        const names = departmentTargets.map(dept => dept.name);
        setDepartmentNames(names);
        // Debug: Show the exact mapping of ID -> Name -> Target
        departmentTargets.forEach((dept, index) => {
        });
        
        // Create target map (department ID -> min_income)
        const targetMap: { [key: number]: number } = {};
        departmentTargets?.forEach(dept => {
          targetMap[dept.id] = parseFloat(dept.min_income || '0');
        });
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
        // For date comparison, we need to extract just the date part from the record date
        const extractDateFromRecord = (recordDate: string) => {
          // Handle both ISO string format and date-only format
          if (recordDate.includes('T')) {
            return recordDate.split('T')[0];
          }
          return recordDate;
        };
        // CORRECT APPROACH: Query leads_leadstage for stage 60 (agreement signed) separately
        // Fetch data for Today and Last 30d (always current date range)
        // Fetch legacy leads stage records with timeout protection
        let stageRecords: any[] = [];
        let stageError: any = null;
        
        try {
          // Query legacy leads - use cdate for filtering as it's more reliable for recent records
          // cdate is set when the record is created, so it accurately reflects when the stage change occurred
          const queryPromise = supabase
            .from('leads_leadstage')
            .select('id, date, cdate, lead_id')
            .eq('stage', 60)
            .not('lead_id', 'is', null) // Legacy leads only
            .gte('cdate', thirtyDaysAgoStr)
            .lte('cdate', new Date(new Date(todayStr).getTime() + 86400000).toISOString().split('T')[0])
            .limit(5000); // Add limit to prevent timeout
          
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Query timeout')), 15000)
          );
          
          const result = await Promise.race([queryPromise, timeoutPromise]) as any;
          
          if (result?.error) {
            stageError = result.error;
          } else {
            stageRecords = result?.data || [];
          }
        } catch (err: any) {
          stageError = err;
        }
        
        if (stageError) {
          // Don't throw, continue without stage records
        }
        // Fetch new leads signed agreements from multiple sources
        // 1. Fetch contracts with signed_at (with timeout protection)
        let contractsData: any[] = [];
        let contractsError: any = null;
        
        try {
          const queryPromise = supabase
            .from('contracts')
            .select('id, client_id, signed_at, total_amount')
            .not('client_id', 'is', null)
            .not('signed_at', 'is', null)
            .eq('status', 'signed')
            .gte('signed_at', thirtyDaysAgoStr)
            .lt('signed_at', new Date(new Date(todayStr).getTime() + 86400000).toISOString().split('T')[0])
            .limit(5000); // Add limit to prevent timeout
          
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Query timeout')), 15000)
          );
          
          const result = await Promise.race([queryPromise, timeoutPromise]) as any;
          
          if (result?.error) {
            contractsError = result.error;
          } else {
            contractsData = result?.data || [];
          }
        } catch (err: any) {
          contractsError = err;
        }
        
        if (contractsError) {
          // Don't throw, continue without contracts
        }
        // 2. Fetch new leads stage records (newlead_id)
        // Add timeout protection and limit to prevent query timeout
        let newLeadStageRecords: any[] = [];
        let newLeadStageError: any = null;
        
        try {
          const queryPromise = supabase
            .from('leads_leadstage')
            .select('id, date, cdate, newlead_id')
            .eq('stage', 60)
            .not('newlead_id', 'is', null) // New leads only
            .gte('cdate', thirtyDaysAgoStr)
            .lte('cdate', todayStr)
            .limit(5000); // Add limit to prevent timeout
          
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Query timeout')), 15000)
          );
          
          const result = await Promise.race([queryPromise, timeoutPromise]) as any;
          
          if (result?.error) {
            newLeadStageError = result.error;
          } else {
            newLeadStageRecords = result?.data || [];
          }
        } catch (err: any) {
          newLeadStageError = err;
          // Continue without new lead stages
        }
        
        if (newLeadStageError) {
          // Don't throw, continue without new lead stages
        }
        // 3. Fetch leads with date_signed (with timeout protection)
        let leadsWithDateSigned: any[] = [];
        let dateSignedError: any = null;
        
        try {
          const queryPromise = supabase
            .from('leads')
            .select('id, date_signed')
            .not('date_signed', 'is', null)
            .gte('date_signed', thirtyDaysAgoStr)
            .lte('date_signed', todayStr)
            .limit(5000); // Add limit to prevent timeout
          
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Query timeout')), 15000)
          );
          
          const result = await Promise.race([queryPromise, timeoutPromise]) as any;
          
          if (result?.error) {
            dateSignedError = result.error;
          } else {
            leadsWithDateSigned = result?.data || [];
          }
        } catch (err: any) {
          dateSignedError = err;
        }
        
        if (dateSignedError) {
          // Don't throw, continue without date_signed leads
        }
        // Combine all new lead IDs from different sources
        const newLeadIdsSet = new Set<string>();
        (contractsData || []).forEach(contract => {
          if (contract.client_id) newLeadIdsSet.add(String(contract.client_id));
        });
        (newLeadStageRecords || []).forEach(record => {
          if (record.newlead_id) newLeadIdsSet.add(String(record.newlead_id));
        });
        (leadsWithDateSigned || []).forEach(lead => {
          if (lead.id) newLeadIdsSet.add(String(lead.id));
        });
        
        const newLeadIds = Array.from(newLeadIdsSet);
        // Fetch new leads data
        let newLeadsData: any[] = [];
        if (newLeadIds.length > 0) {
          const { data: newLeads, error: newLeadsError } = await supabase
            .from('leads')
            .select(`
              id, balance, proposal_total, currency_id, balance_currency, proposal_currency, date_signed,
              misc_category!category_id(
                id, name, parent_id,
                misc_maincategory!parent_id(
                  id, name, department_id,
                  tenant_departement(id, name)
                )
              )
            `)
            .in('id', newLeadIds);
          
          if (newLeadsError) {
            // Don't throw, continue without new leads
          } else {
            newLeadsData = newLeads || [];
          }
        }
        
        // Fetch leads data separately if we have stage records
        let agreementRecords: any[] = [];
        
        // Process legacy leads
        if (stageRecords && stageRecords.length > 0) {
          const leadIds = [...new Set(stageRecords.map(record => record.lead_id).filter(id => id !== null))];
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
            throw leadsError;
          }
          // Join the legacy data
          const leadsMap = new Map(leadsData?.map(lead => [lead.id, lead]) || []);
          const legacyRecords = stageRecords.map(stageRecord => {
            const lead = leadsMap.get(stageRecord.lead_id);
            // Use cdate if date is null, otherwise use date (cdate is more reliable for recent records)
            const recordDate = stageRecord.cdate || stageRecord.date;
            return {
              ...stageRecord,
              date: recordDate,
              leads_lead: lead || null,
              isNewLead: false
            };
          }).filter(record => record.leads_lead !== null);
          
          agreementRecords.push(...legacyRecords);
        }
        
        // Process new leads - create records from contracts, stage records, and date_signed
        const newLeadsMap = new Map(newLeadsData.map(lead => [String(lead.id), lead]));
        
        // Create records from contracts
        (contractsData || []).forEach(contract => {
          if (!contract.client_id || !contract.signed_at) return;
          const lead = newLeadsMap.get(String(contract.client_id));
          if (!lead) return;
          const recordDate = contract.signed_at.split('T')[0];
          agreementRecords.push({
            id: `contract-${contract.id}`,
            date: recordDate,
            cdate: contract.signed_at,
            lead_id: null,
            newlead_id: String(contract.client_id),
            leads_lead: {
              ...lead,
              total: contract.total_amount || lead.balance || lead.proposal_total || 0,
              currency_id: lead.currency_id
            },
            isNewLead: true
          });
        });
        
        // Create records from new lead stage records
        (newLeadStageRecords || []).forEach(record => {
          if (!record.newlead_id) return;
          const lead = newLeadsMap.get(String(record.newlead_id));
          if (!lead) return;
          const recordDate = (record.date || record.cdate || '').split('T')[0];
          agreementRecords.push({
            id: `newstage-${record.id}`,
            date: recordDate,
            cdate: record.cdate || record.date,
            lead_id: null,
            newlead_id: String(record.newlead_id),
            leads_lead: lead,
            isNewLead: true
          });
        });
        
        // Create records from leads with date_signed
        (leadsWithDateSigned || []).forEach(lead => {
          if (!lead.id || !lead.date_signed) return;
          const leadData = newLeadsMap.get(String(lead.id));
          if (!leadData) return;
          const recordDate = lead.date_signed.split('T')[0];
          // Check if we already have a record for this lead (from contracts or stages)
          const existing = agreementRecords.find(r => 
            r.newlead_id === String(lead.id) && r.date === recordDate
          );
          if (!existing) {
            agreementRecords.push({
              id: `datesigned-${lead.id}`,
              date: recordDate,
              cdate: lead.date_signed,
              lead_id: null,
              newlead_id: String(lead.id),
              leads_lead: leadData,
              isNewLead: true
            });
          }
        });
        if (agreementRecords && agreementRecords.length > 0) {
        }
        
        // Fetch data for selected month (separate query)
        const endOfMonthStr = new Date(selectedYear, selectedMonthIndex + 1, 0).toISOString().split('T')[0];
        
        // Fetch legacy leads stage records for month
        const { data: monthStageRecords, error: monthStageError } = await supabase
          .from('leads_leadstage')
          .select('id, date, cdate, lead_id')
          .eq('stage', 60)
          .not('lead_id', 'is', null) // Legacy leads only
          .gte('date', startOfMonthStr)
          .lte('date', endOfMonthStr);
        
        if (monthStageError) {
          throw monthStageError;
        }
        // Fetch new leads signed agreements for month from multiple sources
        const { data: monthContractsData, error: monthContractsError } = await supabase
          .from('contracts')
          .select('id, client_id, signed_at, total_amount')
          .not('client_id', 'is', null)
          .not('signed_at', 'is', null)
          .eq('status', 'signed')
          .gte('signed_at', startOfMonthStr)
          .lte('signed_at', new Date(new Date(endOfMonthStr).getTime() + 86400000).toISOString().split('T')[0]);
        
        if (monthContractsError) {
        }
        const { data: monthNewLeadStageRecords, error: monthNewLeadStageError } = await supabase
          .from('leads_leadstage')
          .select('id, date, cdate, newlead_id')
          .eq('stage', 60)
          .not('newlead_id', 'is', null) // New leads only
          .gte('cdate', startOfMonthStr)
          .lte('cdate', endOfMonthStr);
        
        if (monthNewLeadStageError) {
        }
        const { data: monthLeadsWithDateSigned, error: monthDateSignedError } = await supabase
          .from('leads')
          .select('id, date_signed')
          .not('date_signed', 'is', null)
          .gte('date_signed', startOfMonthStr)
          .lte('date_signed', endOfMonthStr);
        
        if (monthDateSignedError) {
        }
        // Combine all new lead IDs for month
        const monthNewLeadIdsSet = new Set<string>();
        (monthContractsData || []).forEach(contract => {
          if (contract.client_id) monthNewLeadIdsSet.add(String(contract.client_id));
        });
        (monthNewLeadStageRecords || []).forEach(record => {
          if (record.newlead_id) monthNewLeadIdsSet.add(String(record.newlead_id));
        });
        (monthLeadsWithDateSigned || []).forEach(lead => {
          if (lead.id) monthNewLeadIdsSet.add(String(lead.id));
        });
        
        const monthNewLeadIds = Array.from(monthNewLeadIdsSet);
        // Fetch month new leads data
        let monthNewLeadsData: any[] = [];
        if (monthNewLeadIds.length > 0) {
          const { data: monthNewLeads, error: monthNewLeadsError } = await supabase
            .from('leads')
            .select(`
              id, balance, proposal_total, currency_id, balance_currency, proposal_currency, date_signed,
              misc_category!category_id(
                id, name, parent_id,
                misc_maincategory!parent_id(
                  id, name, department_id,
                  tenant_departement(id, name)
                )
              )
            `)
            .in('id', monthNewLeadIds);
          
          if (monthNewLeadsError) {
          } else {
            monthNewLeadsData = monthNewLeads || [];
          }
        }
        
        // Fetch leads data separately for month if we have stage records
        let monthAgreementRecords: any[] = [];
        
        // Process legacy leads for month
        if (monthStageRecords && monthStageRecords.length > 0) {
          const monthLeadIds = [...new Set(monthStageRecords.map(record => record.lead_id).filter(id => id !== null))];
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
            throw monthLeadsError;
          }
          // Join the legacy data
          const monthLeadsMap = new Map(monthLeadsData?.map(lead => [lead.id, lead]) || []);
          const monthLegacyRecords = monthStageRecords.map(stageRecord => {
            const lead = monthLeadsMap.get(stageRecord.lead_id);
            const recordDate = (stageRecord.date || stageRecord.cdate || '').split('T')[0];
            return {
              ...stageRecord,
              date: recordDate,
              leads_lead: lead || null,
              isNewLead: false
            };
          }).filter(record => record.leads_lead !== null);
          
          monthAgreementRecords.push(...monthLegacyRecords);
        }
        
        // Process new leads for month
        const monthNewLeadsMap = new Map(monthNewLeadsData.map(lead => [String(lead.id), lead]));
        
        (monthContractsData || []).forEach(contract => {
          if (!contract.client_id || !contract.signed_at) return;
          const lead = monthNewLeadsMap.get(String(contract.client_id));
          if (!lead) return;
          const recordDate = contract.signed_at.split('T')[0];
          monthAgreementRecords.push({
            id: `month-contract-${contract.id}`,
            date: recordDate,
            cdate: contract.signed_at,
            lead_id: null,
            newlead_id: String(contract.client_id),
            leads_lead: {
              ...lead,
              total: contract.total_amount || lead.balance || lead.proposal_total || 0,
              currency_id: lead.currency_id
            },
            isNewLead: true
          });
        });
        
        (monthNewLeadStageRecords || []).forEach(record => {
          if (!record.newlead_id) return;
          const lead = monthNewLeadsMap.get(String(record.newlead_id));
          if (!lead) return;
          const recordDate = (record.date || record.cdate || '').split('T')[0];
          monthAgreementRecords.push({
            id: `month-newstage-${record.id}`,
            date: recordDate,
            cdate: record.cdate || record.date,
            lead_id: null,
            newlead_id: String(record.newlead_id),
            leads_lead: lead,
            isNewLead: true
          });
        });
        
        (monthLeadsWithDateSigned || []).forEach(lead => {
          if (!lead.id || !lead.date_signed) return;
          const leadData = monthNewLeadsMap.get(String(lead.id));
          if (!leadData) return;
          const recordDate = lead.date_signed.split('T')[0];
          const existing = monthAgreementRecords.find(r => 
            r.newlead_id === String(lead.id) && r.date === recordDate
          );
          if (!existing) {
            monthAgreementRecords.push({
              id: `month-datesigned-${lead.id}`,
              date: recordDate,
              cdate: lead.date_signed,
              lead_id: null,
              newlead_id: String(lead.id),
              leads_lead: leadData,
              isNewLead: true
            });
          }
        });
        if (monthAgreementRecords && monthAgreementRecords.length > 0) {
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
              return;
            }
            processedRecordIds.add(record.id);
            
            const lead = record.leads_lead as any;
            if (!lead) {
              return;
            }
            
            // For new leads, amount might be in balance, proposal_total, or total (from contracts)
            // For legacy leads, amount is in total
            let amount = 0;
            if (record.isNewLead) {
              amount = parseFloat(lead.total) || parseFloat(lead.balance) || parseFloat(lead.proposal_total) || 0;
            } else {
              amount = parseFloat(lead.total) || 0;
            }
            const amountInNIS = convertToNIS(amount, lead.currency_id);
            const recordDate = record.date;
            
            // Debug currency conversion
            // Log non-NIS currencies for verification
            if (lead.currency_id && lead.currency_id !== 1) {
            }
            
            // Get department ID from the JOIN
            let departmentId = null;
            if (lead.misc_category?.misc_maincategory?.department_id) {
              departmentId = lead.misc_category.misc_maincategory.department_id;
            }
            if (departmentId && departmentIds.includes(departmentId)) {
              processedCount++;
              
              // For Today and Last 30d, use the department index + 1 (to skip General)
              const deptIndex = departmentIds.indexOf(departmentId) + 1;
              
              // For current month, use the department index directly (no General column)
              const monthDeptIndex = departmentIds.indexOf(departmentId);
              // Extract date part for comparison
              const recordDateOnly = extractDateFromRecord(recordDate);
              
              // Check if it's today
              if (recordDateOnly === todayStr) {
                newAgreementData.Today[deptIndex].count++;
                newAgreementData.Today[deptIndex].amount += amountInNIS; // Use NIS amount
                newAgreementData.Today[0].count++; // General
                newAgreementData.Today[0].amount += amountInNIS; // Use NIS amount
              }
              
              // Check if it's in last 30 days (or entire month if at end of month)
              if (recordDateOnly >= effectiveThirtyDaysAgo) {
                newAgreementData["Last 30d"][deptIndex].count++;
                newAgreementData["Last 30d"][deptIndex].amount += amountInNIS; // Use NIS amount
                newAgreementData["Last 30d"][0].count++; // General
                newAgreementData["Last 30d"][0].amount += amountInNIS; // Use NIS amount
              }
              
              // Note: Month data will be processed separately from monthStageRecords
              
              // Debug: Show why dates might be different
            } else {
              skippedCount++;
            }
          });
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
              return;
            }
            processedMonthRecordIds.add(record.id);
            
            const lead = record.leads_lead as any;
            if (!lead) {
              return;
            }
            
            // For new leads, amount might be in balance, proposal_total, or total (from contracts)
            // For legacy leads, amount is in total
            let amount = 0;
            if (record.isNewLead) {
              amount = parseFloat(lead.total) || parseFloat(lead.balance) || parseFloat(lead.proposal_total) || 0;
            } else {
              amount = parseFloat(lead.total) || 0;
            }
            const amountInNIS = convertToNIS(amount, lead.currency_id);
            const recordDate = record.date;
            
            // Get department ID from the JOIN
            let departmentId = null;
            if (lead.misc_category?.misc_maincategory?.department_id) {
              departmentId = lead.misc_category.misc_maincategory.department_id;
            }
            if (departmentId && departmentIds.includes(departmentId)) {
              monthProcessedCount++;
              
              // For current month, use the department index directly (no General column)
              const monthDeptIndex = departmentIds.indexOf(departmentId);
              // Extract date part for comparison
              const recordDateOnly = extractDateFromRecord(recordDate);
              
              // Check if it's in selected month
              if (recordDateOnly >= startOfMonthStr) {
                newAgreementData[selectedMonthName][monthDeptIndex].count++;
                newAgreementData[selectedMonthName][monthDeptIndex].amount += amountInNIS; // Use NIS amount
              }
            } else {
              monthSkippedCount++;
            }
          });
        }
        
        // Calculate totals for each time period
        // Debug: Show the raw data before calculating totals
        // Calculate dynamic totals based on actual number of departments
        const numDepartments = departmentTargets.length;
        const totalIndexToday = numDepartments + 1; // General + departments + Total
        const totalIndexMonth = numDepartments; // departments + Total (no General for month)
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
        // Log currency distribution summary
        const currencyDistribution = {
          NIS: 0,
          USD: 0,
          EUR: 0,
          GBP: 0,
          Unknown: 0
        };
        // Combine all records that were processed
        const allProcessedRecords = [...(agreementRecords || []), ...(monthAgreementRecords || [])];
        if (allProcessedRecords.length > 0) {
          // Check first 5 records for currency data
          for (let i = 0; i < Math.min(5, allProcessedRecords.length); i++) {
            const record = allProcessedRecords[i];
            const lead = record.leads_lead;
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
          }
        });
        setAgreementData(newAgreementData);
        
        // Fetch daily chart data for the last 30 days
        await fetchDepartmentChartData(departmentIds, departmentTargets, thirtyDaysAgoStr, todayStr);
        
      } catch (error) {
      } finally {
        setDepartmentPerformanceLoading(false);
      }
  };
  
  // Fetch real daily chart data for department performance
  const fetchDepartmentChartData = async (
    departmentIds: number[],
    departmentTargets: any[],
    fromDate: string,
    toDate: string
  ) => {
    try {
      // Fetch stage records for the date range
      const { data: stageRecords, error: stageError } = await supabase
        .from('leads_leadstage')
        .select('id, date, lead_id')
        .eq('stage', 60)
        .gte('date', fromDate)
        .lte('date', toDate);
      
      if (stageError) {
        return;
      }
      
      if (!stageRecords || stageRecords.length === 0) {
        setDepartmentChartData({});
        return;
      }
      
      // Fetch leads data
      const leadIds = [...new Set(stageRecords.map(record => record.lead_id).filter(id => id !== null))];
      const { data: leadsData, error: leadsError } = await supabase
        .from('leads_lead')
        .select('id, category_id, meeting_total, meeting_total_currency_id')
        .in('id', leadIds);
      
      if (leadsError) {
        return;
      }
      
      // Create a map of lead_id to lead data
      const leadsMap = new Map();
      leadsData?.forEach(lead => {
        leadsMap.set(lead.id, lead);
      });
      
      // Create date range array
      const startDate = new Date(fromDate);
      const endDate = new Date(toDate);
      const dateArray: string[] = [];
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        dateArray.push(d.toISOString().split('T')[0]);
      }
      
      // Initialize chart data structure with all categories
      const allCategories = ['General', ...departmentTargets.map(d => d.name), 'Total'];
      const chartDataMap: { [category: string]: { [date: string]: { contracts: number; amount: number } } } = {};
      
      // Initialize all categories with all dates
      allCategories.forEach(category => {
        chartDataMap[category] = {};
        dateArray.forEach(date => {
          chartDataMap[category][date] = { contracts: 0, amount: 0 };
        });
      });
      
      // Process stage records
      stageRecords.forEach(record => {
        const lead = leadsMap.get(record.lead_id);
        if (!lead) return;
        
        const recordDate = record.date?.split('T')[0] || record.date;
        if (!recordDate || !dateArray.includes(recordDate)) return;
        
        // Get department from category_id
        const departmentId = lead.category_id;
        const deptIndex = departmentIds.indexOf(departmentId);
        
        // Convert amount to NIS
        let amountInNIS = 0;
        if (lead.meeting_total && lead.meeting_total_currency_id) {
          const currencyId = lead.meeting_total_currency_id;
          const amount = parseFloat(lead.meeting_total) || 0;
          if (currencyId === 1) { // NIS
            amountInNIS = amount;
          } else if (currencyId === 2) { // USD
            amountInNIS = amount * 3.5; // Approximate conversion
          } else if (currencyId === 3) { // EUR
            amountInNIS = amount * 3.8; // Approximate conversion
          }
        }
        
        if (deptIndex >= 0) {
          const categoryName = departmentTargets[deptIndex]?.name;
          if (categoryName && chartDataMap[categoryName]) {
            chartDataMap[categoryName][recordDate].contracts++;
            chartDataMap[categoryName][recordDate].amount += amountInNIS;
          }
        }
        
        // Also add to General and Total
        if (chartDataMap['General']) {
          chartDataMap['General'][recordDate].contracts++;
          chartDataMap['General'][recordDate].amount += amountInNIS;
        }
        if (chartDataMap['Total']) {
          chartDataMap['Total'][recordDate].contracts++;
          chartDataMap['Total'][recordDate].amount += amountInNIS;
        }
      });
      
      // Convert to array format for charts
      const finalChartData: { [category: string]: { date: string; contracts: number; amount: number }[] } = {};
      Object.keys(chartDataMap).forEach(category => {
        finalChartData[category] = dateArray.map(date => ({
          date: new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
          contracts: chartDataMap[category][date].contracts,
          amount: chartDataMap[category][date].amount
        }));
      });
      
      setDepartmentChartData(finalChartData);
    } catch (error) {
      setDepartmentChartData({});
    }
  };

  // Fetch invoiced data using the same logic as CollectionDueReport
  // For new leads: payment_plans where ready_to_pay = true and paid = false
  // For legacy leads: finances_paymentplanrow where ready_to_pay = true and actual_date IS NULL
  // Group by department instead of employee
  const fetchInvoicedData = async () => {
    setInvoicedDataLoading(true);
    try {
      const now = new Date();
      const today = new Date();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(now.getDate() - 30);
      
      // Use selected month and year
      const selectedMonthIndex = months.indexOf(selectedMonth);
      const selectedDate = new Date(selectedYear, selectedMonthIndex, 1);
      const selectedMonthName = selectedDate.toLocaleDateString('en-US', { month: 'long' });
      
      // Fetch only important departments (same as agreement data)
      const { data: allDepartments, error: departmentsError } = await supabase
        .from('tenant_departement')
        .select('id, name, min_income, important')
        .eq('important', 't')
        .order('id');
      
      if (departmentsError) {
        throw departmentsError;
      }
      
      // Extract department IDs and create target mapping
      const departmentIds = allDepartments?.map(dept => dept.id) || [];
      const departmentTargets = allDepartments || [];
      // Create target map (department ID -> min_income)
      const targetMap: { [key: number]: number } = {};
      departmentTargets?.forEach(dept => {
        targetMap[dept.id] = parseFloat(dept.min_income || '0');
      });
      
      // Calculate date ranges
      const todayStr = today.toISOString().split('T')[0];
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
      const startOfMonth = new Date(Date.UTC(selectedYear, selectedMonthIndex, 1));
      const startOfMonthStr = startOfMonth.toISOString().split('T')[0];
      const endOfMonthStr = new Date(selectedYear, selectedMonthIndex + 1, 0).toISOString().split('T')[0];
      
      // Check if we're at the end of the month
      const daysInMonth = new Date(selectedYear, selectedMonthIndex + 1, 0).getDate();
      const isEndOfMonth = now.getDate() >= (daysInMonth - 2);
      const effectiveThirtyDaysAgo = isEndOfMonth ? startOfMonthStr : thirtyDaysAgoStr;
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
      
      // Fetch new payment plans - only unpaid ones that are ready to pay (same as CollectionDueReport)
      // Note: We don't filter by date range here because we need data for multiple periods (Today, Last 30d, Month)
      // We'll filter by date in the processing step
      console.log('🔍 Invoiced Data - Fetching new payment plans with ready_to_pay=true...');
      let newPaymentsQuery = supabase
        .from('payment_plans')
        .select(`
          id,
          lead_id,
          value,
          value_vat,
          currency,
          due_date,
          cancel_date,
          ready_to_pay,
          paid
        `)
        .eq('ready_to_pay', true)
        .eq('paid', false) // Only unpaid payments
        .not('due_date', 'is', null)
        .is('cancel_date', null);
      
      const { data: newPayments, error: newError } = await newPaymentsQuery;
      if (newError) {
        console.error('❌ Invoiced Data - Error fetching new payments:', newError);
        throw newError;
      }
      console.log('✅ Invoiced Data - Fetched new payments:', newPayments?.length || 0);
      if (newPayments && newPayments.length > 0) {
        console.log('📊 Invoiced Data - Sample new payment:', {
          id: newPayments[0].id,
          lead_id: newPayments[0].lead_id,
          due_date: newPayments[0].due_date,
          value: newPayments[0].value,
          ready_to_pay: newPayments[0].ready_to_pay,
          paid: newPayments[0].paid
        });
      }
      
      // Fetch legacy payment plans from finances_paymentplanrow (same as CollectionDueReport)
      // Note: CollectionDueReport does NOT filter by ready_to_pay for legacy payments
      // It only filters by cancel_date IS NULL, actual_date IS NULL (unpaid), and date range
      // Note: We don't filter by date range here because we need data for multiple periods (Today, Last 30d, Month)
      // We'll filter by date in the processing step
      console.log('🔍 Invoiced Data - Fetching legacy payment plans...');
      let legacyPaymentsQuery = supabase
        .from('finances_paymentplanrow')
        .select(`
          id,
          lead_id,
          value,
          value_base,
          vat_value,
          currency_id,
          due_date,
          date,
          cancel_date,
          ready_to_pay,
          actual_date,
          accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)
        `)
        .not('due_date', 'is', null) // Only fetch if due_date has a date (not NULL)
        .is('cancel_date', null) // Exclude cancelled payments (only fetch if cancel_date IS NULL)
        .is('actual_date', null); // Only unpaid payments (actual_date IS NULL means not paid yet)
      
      const { data: legacyPayments, error: legacyError } = await legacyPaymentsQuery;
      if (legacyError) {
        console.error('❌ Invoiced Data - Error fetching legacy payments:', legacyError);
        throw legacyError;
      }
      console.log('✅ Invoiced Data - Fetched legacy payments:', legacyPayments?.length || 0);
      
      // Note: CollectionDueReport does NOT filter by ready_to_pay for legacy payments
      // So we use all legacy payments without filtering by ready_to_pay
      const filteredLegacyPayments = legacyPayments || [];
      
      if (filteredLegacyPayments.length > 0) {
        console.log('📊 Invoiced Data - Sample legacy payment:', {
          id: filteredLegacyPayments[0].id,
          lead_id: filteredLegacyPayments[0].lead_id,
          due_date: filteredLegacyPayments[0].due_date,
          date: filteredLegacyPayments[0].date,
          value_base: filteredLegacyPayments[0].value_base,
          actual_date: filteredLegacyPayments[0].actual_date
        });
      }
      
      // Get unique lead IDs
      const newLeadIds = Array.from(new Set((newPayments || []).map(p => p.lead_id).filter(Boolean)));
      const legacyLeadIds = Array.from(new Set(filteredLegacyPayments.map(p => p.lead_id).filter(Boolean))).map(id => Number(id)).filter(id => !Number.isNaN(id));
      
      console.log('📊 Invoiced Data - Unique new lead IDs:', newLeadIds.length);
      console.log('📊 Invoiced Data - Unique legacy lead IDs:', legacyLeadIds.length);
      
      // Fetch lead metadata with category and department info
      let newLeadsMap = new Map();
      if (newLeadIds.length > 0) {
        console.log('🔍 Invoiced Data - Fetching new leads metadata...');
        const { data: newLeads, error: newLeadsError } = await supabase
          .from('leads')
          .select(`
            id,
            category_id,
            misc_category!category_id(
              id,
              name,
              parent_id,
              misc_maincategory!parent_id(
                id,
                name,
                department_id,
                tenant_departement!department_id(
                  id,
                  name
                )
              )
            )
          `)
          .in('id', newLeadIds);

        if (newLeadsError) {
          console.error('❌ Invoiced Data - Error fetching new leads:', newLeadsError);
        } else {
          console.log('✅ Invoiced Data - Fetched new leads:', newLeads?.length || 0);
          if (newLeads) {
            newLeads.forEach(lead => {
              newLeadsMap.set(lead.id, lead);
            });
          }
        }
      }

      let legacyLeadsMap = new Map();
      if (legacyLeadIds.length > 0) {
        console.log('🔍 Invoiced Data - Fetching legacy leads metadata...');
        const { data: legacyLeads, error: legacyLeadsError } = await supabase
          .from('leads_lead')
          .select(`
            id,
            category_id,
            misc_category!category_id(
              id,
              name,
              parent_id,
              misc_maincategory!parent_id(
                id,
                name,
                department_id,
                tenant_departement!department_id(
                  id,
                  name
                )
              )
            )
          `)
          .in('id', legacyLeadIds);

        if (legacyLeadsError) {
          console.error('❌ Invoiced Data - Error fetching legacy leads:', legacyLeadsError);
        } else {
          console.log('✅ Invoiced Data - Fetched legacy leads:', legacyLeads?.length || 0);
          if (legacyLeads) {
            legacyLeads.forEach(lead => {
              const key = lead.id?.toString() || String(lead.id);
              legacyLeadsMap.set(key, lead);
              if (typeof lead.id === 'number') {
                legacyLeadsMap.set(lead.id, lead);
              }
            });
          }
        }
      }
      
      console.log('📊 Invoiced Data - Date ranges:', {
        todayStr,
        effectiveThirtyDaysAgo,
        startOfMonthStr,
        endOfMonthStr,
        selectedMonthName
      });
      
      // Process payments and group by department
      // Process new payments
      let newPaymentsProcessed = 0;
      let newPaymentsSkipped = 0;
      (newPayments || []).forEach(payment => {
        const lead = newLeadsMap.get(payment.lead_id);
        if (!lead) {
          newPaymentsSkipped++;
          return;
        }

        // Get department from category -> main category -> department
        const category = lead.misc_category;
        const mainCategory = category ? (Array.isArray(category.misc_maincategory) ? category.misc_maincategory[0] : category.misc_maincategory) : null;
        const department = mainCategory?.tenant_departement ? (Array.isArray(mainCategory.tenant_departement) ? mainCategory.tenant_departement[0] : mainCategory.tenant_departement) : null;
        const departmentId = department?.id || null;

        if (!departmentId || !departmentIds.includes(departmentId)) return;

        const value = Number(payment.value || 0);
        let vat = Number(payment.value_vat || 0);
        if (!vat && (payment.currency || '₪') === '₪') {
          vat = Math.round(value * 0.18 * 100) / 100;
        }
        const amount = value + vat;
        const amountInNIS = convertToNIS(amount, payment.currency === '₪' ? 1 : payment.currency === '€' ? 2 : payment.currency === '$' ? 3 : payment.currency === '£' ? 4 : 1);

        const dueDate = payment.due_date ? (typeof payment.due_date === 'string' ? payment.due_date.split('T')[0] : new Date(payment.due_date).toISOString().split('T')[0]) : null;
        if (!dueDate) return;

        const deptIndex = departmentIds.indexOf(departmentId) + 1; // +1 to skip General column

        // Check if it's today
        if (dueDate === todayStr) {
          newInvoicedData["Today"][deptIndex].count += 1;
          newInvoicedData["Today"][deptIndex].amount += amountInNIS;
          newInvoicedData["Today"][0].count += 1; // General
          newInvoicedData["Today"][0].amount += amountInNIS;
        }

        // Check if it's in last 30 days
        if (dueDate >= effectiveThirtyDaysAgo && dueDate <= todayStr) {
          newInvoicedData["Last 30d"][deptIndex].count += 1;
          newInvoicedData["Last 30d"][deptIndex].amount += amountInNIS;
          newInvoicedData["Last 30d"][0].count += 1; // General
          newInvoicedData["Last 30d"][0].amount += amountInNIS;
        }

        // Check if it's in selected month
        if (dueDate >= startOfMonthStr && dueDate <= endOfMonthStr) {
          const monthDeptIndex = departmentIds.indexOf(departmentId); // No General column for month
          newInvoicedData[selectedMonthName][monthDeptIndex].count += 1;
          newInvoicedData[selectedMonthName][monthDeptIndex].amount += amountInNIS;
        }
      });
      
      console.log('📊 Invoiced Data - New payments processing:', {
        total: (newPayments || []).length,
        processed: newPaymentsProcessed,
        skipped: newPaymentsSkipped
      });

      // Process legacy payments
      let legacyPaymentsProcessed = 0;
      let legacyPaymentsSkipped = 0;
      filteredLegacyPayments.forEach(payment => {
        const leadIdKey = payment.lead_id?.toString() || String(payment.lead_id);
        const leadIdNum = typeof payment.lead_id === 'number' ? payment.lead_id : Number(payment.lead_id);
        let lead = legacyLeadsMap.get(leadIdKey) || legacyLeadsMap.get(leadIdNum);
        
        if (!lead) {
          legacyPaymentsSkipped++;
          return;
        }

        // Get department from category -> main category -> department
        const category = lead.misc_category;
        const mainCategory = category ? (Array.isArray(category.misc_maincategory) ? category.misc_maincategory[0] : category.misc_maincategory) : null;
        const department = mainCategory?.tenant_departement ? (Array.isArray(mainCategory.tenant_departement) ? mainCategory.tenant_departement[0] : mainCategory.tenant_departement) : null;
        const departmentId = department?.id || null;

        if (!departmentId || !departmentIds.includes(departmentId)) return;

        // Use value_base for legacy payments as specified in CollectionDueReport
        const value = Number(payment.value_base || 0);
        let vat = Number(payment.vat_value || 0);
        
        // Get currency from accounting_currencies relation
        const accountingCurrency: any = payment.accounting_currencies 
          ? (Array.isArray(payment.accounting_currencies) ? payment.accounting_currencies[0] : payment.accounting_currencies) 
          : null;
        
        let currencyId = 1; // Default to NIS
        if (accountingCurrency?.name) {
          if (accountingCurrency.name === 'NIS' || accountingCurrency.name === '₪') currencyId = 1;
          else if (accountingCurrency.name === 'EUR' || accountingCurrency.name === '€') currencyId = 2;
          else if (accountingCurrency.name === 'USD' || accountingCurrency.name === '$') currencyId = 3;
          else if (accountingCurrency.name === 'GBP' || accountingCurrency.name === '£') currencyId = 4;
        } else if (payment.currency_id) {
          currencyId = payment.currency_id;
        }
        
        // Calculate VAT if not provided and currency is NIS
        if (!vat && (currencyId === 1)) {
          vat = Math.round(value * 0.18 * 100) / 100;
        }
        const amount = value + vat;
        const amountInNIS = convertToNIS(amount, currencyId);

        // Use due_date for date filtering (same as CollectionDueReport)
        const dueDate = payment.due_date ? (typeof payment.due_date === 'string' ? payment.due_date.split('T')[0] : new Date(payment.due_date).toISOString().split('T')[0]) : null;
        if (!dueDate) return;

        const deptIndex = departmentIds.indexOf(departmentId) + 1; // +1 to skip General column

        // Check if it's today
        if (dueDate === todayStr) {
          newInvoicedData["Today"][deptIndex].count += 1;
          newInvoicedData["Today"][deptIndex].amount += amountInNIS;
          newInvoicedData["Today"][0].count += 1; // General
          newInvoicedData["Today"][0].amount += amountInNIS;
        }

        // Check if it's in last 30 days
        if (dueDate >= effectiveThirtyDaysAgo && dueDate <= todayStr) {
          newInvoicedData["Last 30d"][deptIndex].count += 1;
          newInvoicedData["Last 30d"][deptIndex].amount += amountInNIS;
          newInvoicedData["Last 30d"][0].count += 1; // General
          newInvoicedData["Last 30d"][0].amount += amountInNIS;
        }

        // Check if it's in selected month
        if (dueDate >= startOfMonthStr && dueDate <= endOfMonthStr) {
          const monthDeptIndex = departmentIds.indexOf(departmentId); // No General column for month
          newInvoicedData[selectedMonthName][monthDeptIndex].count += 1;
          newInvoicedData[selectedMonthName][monthDeptIndex].amount += amountInNIS;
        }
      });
      
      console.log('📊 Invoiced Data - Legacy payments processing:', {
        total: filteredLegacyPayments.length,
        processed: legacyPaymentsProcessed,
        skipped: legacyPaymentsSkipped
      });
      
      console.log('📊 Invoiced Data - Final data before totals:', {
        Today: newInvoicedData["Today"].map((item, idx) => ({ idx, count: item.count, amount: item.amount })),
        Last30d: newInvoicedData["Last 30d"].map((item, idx) => ({ idx, count: item.count, amount: item.amount })),
        Month: newInvoicedData[selectedMonthName].map((item, idx) => ({ idx, count: item.count, amount: item.amount }))
      });
      
      // Calculate totals
      const numDepartments = departmentTargets.length;
      const totalIndexToday = numDepartments + 1; // General + departments + Total
      const totalIndexMonth = numDepartments; // departments + Total (no General for month)
      
      // Today totals (sum of departments, excluding General and Total)
      const todayTotalCount = newInvoicedData.Today.slice(1, numDepartments + 1).reduce((sum, item) => sum + item.count, 0);
      const todayTotalAmount = Math.ceil(newInvoicedData.Today.slice(1, numDepartments + 1).reduce((sum, item) => sum + item.amount, 0));
      newInvoicedData.Today[totalIndexToday] = { count: todayTotalCount, amount: todayTotalAmount, expected: 0 };
      
      // Last 30d totals
      const last30TotalCount = newInvoicedData["Last 30d"].slice(1, numDepartments + 1).reduce((sum, item) => sum + item.count, 0);
      const last30TotalAmount = Math.ceil(newInvoicedData["Last 30d"].slice(1, numDepartments + 1).reduce((sum, item) => sum + item.amount, 0));
      newInvoicedData["Last 30d"][totalIndexToday] = { count: last30TotalCount, amount: last30TotalAmount, expected: 0 };
      
      // Current month totals
      const monthTotalCount = newInvoicedData[selectedMonthName].slice(0, numDepartments).reduce((sum, item) => sum + item.count, 0);
      const monthTotalAmount = Math.ceil(newInvoicedData[selectedMonthName].slice(0, numDepartments).reduce((sum, item) => sum + item.amount, 0));
      newInvoicedData[selectedMonthName][totalIndexMonth] = { count: monthTotalCount, amount: monthTotalAmount, expected: 0 };
      
      setInvoicedData(newInvoicedData);
      
    } catch (error: any) {
    } finally {
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
    fetchDepartmentPerformance();
    fetchInvoicedData();
  }, [selectedMonth, selectedYear]);

  // Fetch unavailable employees data on component mount and when date changes
  useEffect(() => {
    fetchUnavailableEmployeesData(teamAvailabilityDate);
  }, [teamAvailabilityDate]);


  // Refresh data when unavailable employees modal closes
  useEffect(() => {
    if (!isUnavailableEmployeesModalOpen) {
      fetchUnavailableEmployeesData(teamAvailabilityDate);
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
  const departmentCategories = includedDeptIndexes.map(idx => scoreboardCategories[idx]);
  const mobileCategories = scoreboardCategories.filter(cat => cat !== 'General');

  type MobilePeriodType = 'today' | 'last30d' | 'currentMonth' | 'target';
  const [mobilePeriodRows, setMobilePeriodRows] = useState<{ id: string; period: MobilePeriodType }[]>([
    { id: 'row-today', period: 'today' },
  ]);

  const mobilePeriodOptions: { period: MobilePeriodType; label: string }[] = [
    { period: 'today', label: 'Today' },
    { period: 'last30d', label: 'Last 30d' },
    { period: 'currentMonth', label: selectedMonth },
    { period: 'target', label: 'Target' },
  ];

  const addMobilePeriodRow = (period: MobilePeriodType) => {
    setMobilePeriodRows((prev) => [
      ...prev,
      { id: `${period}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, period },
    ]);
  };

  const toggleMobilePeriodRow = (period: MobilePeriodType) => {
    setMobilePeriodRows((prev) => {
      const existingIndex = prev.findIndex((row) => row.period === period);
      if (existingIndex !== -1) {
        if (prev.length <= 1) {
          return prev;
        }
        const next = [...prev];
        next.splice(existingIndex, 1);
        return next;
      }
      return [
        ...prev,
        { id: `${period}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, period },
      ];
    });
  };

  const getMobilePeriodInfo = (period: MobilePeriodType) => {
    switch (period) {
      case 'today':
        return { label: 'Today', gradient: 'from-indigo-500 to-purple-600', dotColor: 'bg-indigo-500' };
      case 'last30d':
        return { label: 'Last 30d', gradient: 'from-purple-500 to-indigo-600', dotColor: 'bg-purple-500' };
      case 'currentMonth':
        return { label: selectedMonth, gradient: 'from-blue-500 to-cyan-600', dotColor: 'bg-blue-500' };
      case 'target':
        return { label: 'Target', gradient: 'from-emerald-500 to-teal-600', dotColor: 'bg-emerald-500' };
      default:
        return { label: 'Today', gradient: 'from-indigo-500 to-purple-600', dotColor: 'bg-indigo-500' };
    }
  };

  const getMobilePeriodData = (period: MobilePeriodType, category: string) => {
    const defaultValue = { count: 0, amount: 0, expected: 0 };
    const categoryIndex = scoreboardCategories.indexOf(category);
    const todayData = agreementData['Today']?.[categoryIndex] || defaultValue;
    const last30Data = agreementData['Last 30d']?.[categoryIndex] || defaultValue;
    const monthArray = agreementData[selectedMonth] || [];
    const monthIndex =
      category === 'Total'
        ? departmentNames.length
        : Math.max(0, departmentNames.indexOf(category));
    const monthData = monthArray[monthIndex] || defaultValue;
    const targetData = {
      count: 0,
      amount: 0,
      expected: monthData.expected || last30Data.expected || todayData.expected || 0,
    };

    switch (period) {
      case 'today':
        return todayData;
      case 'last30d':
        return last30Data;
      case 'currentMonth':
        return monthData;
      case 'target':
        return targetData;
      default:
        return todayData;
    }
  };

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
  const handleCardFlip = (cardKey: string) => {
    setFlippedCards(prev => {
      const newSet = new Set(prev);
      if (newSet.has(cardKey)) {
        newSet.delete(cardKey);
      } else {
        newSet.add(cardKey);
      }
      return newSet;
    });
  };

  // Compute chart data from actual agreementData and invoicedData
  // "signed" = signed agreements (from agreementData)
  // "due" = invoiced (from invoicedData)
  const scoreboardBarDataToday = useMemo(() => {
    // Filter out "General" from departmentNames if it exists to avoid duplicates
    const filteredDeptNames = departmentNames.filter(name => name !== 'General');
    const categories = ['General', ...filteredDeptNames, 'Total'];
    
    // Create a mapping from department name to its index in departmentNames (which matches data structure order)
    const deptNameToIndex = new Map<string, number>();
    departmentNames.forEach((name, idx) => {
      if (name !== 'General') {
        deptNameToIndex.set(name, idx);
      }
    });
    
    return categories.map((category, index) => {
      let signedAmount = 0;
      let dueAmount = 0;
      
      if (index === 0) {
        // General -> data index 0
        signedAmount = agreementData['Today']?.[0]?.amount || 0;
        dueAmount = invoicedData['Today']?.[0]?.amount || 0;
      } else if (index === categories.length - 1) {
        // Total -> data index = departmentNames.length + 1
        signedAmount = agreementData['Today']?.[departmentNames.length + 1]?.amount || 0;
        dueAmount = invoicedData['Today']?.[departmentNames.length + 1]?.amount || 0;
      } else {
        // Department -> find its index in departmentNames to get correct data index
        const deptIndexInNames = deptNameToIndex.get(category);
        if (deptIndexInNames !== undefined) {
          // Data index = deptIndexInNames + 1 (because General is at index 0)
          signedAmount = agreementData['Today']?.[deptIndexInNames + 1]?.amount || 0;
          dueAmount = invoicedData['Today']?.[deptIndexInNames + 1]?.amount || 0;
        }
      }
      
      return {
        category,
        signed: Math.ceil(signedAmount),
        due: Math.ceil(dueAmount),
      };
    });
  }, [departmentNames, agreementData, invoicedData]);

  const scoreboardBarData30d = useMemo(() => {
    // Filter out "General" from departmentNames if it exists to avoid duplicates
    const filteredDeptNames = departmentNames.filter(name => name !== 'General');
    const categories = ['General', ...filteredDeptNames, 'Total'];
    
    // Create a mapping from department name to its index in departmentNames (which matches data structure order)
    const deptNameToIndex = new Map<string, number>();
    departmentNames.forEach((name, idx) => {
      if (name !== 'General') {
        deptNameToIndex.set(name, idx);
      }
    });
    
    return categories.map((category, index) => {
      let signedAmount = 0;
      let dueAmount = 0;
      
      if (index === 0) {
        // General -> data index 0
        signedAmount = agreementData['Last 30d']?.[0]?.amount || 0;
        dueAmount = invoicedData['Last 30d']?.[0]?.amount || 0;
      } else if (index === categories.length - 1) {
        // Total -> data index = departmentNames.length + 1
        signedAmount = agreementData['Last 30d']?.[departmentNames.length + 1]?.amount || 0;
        dueAmount = invoicedData['Last 30d']?.[departmentNames.length + 1]?.amount || 0;
      } else {
        // Department -> find its index in departmentNames to get correct data index
        const deptIndexInNames = deptNameToIndex.get(category);
        if (deptIndexInNames !== undefined) {
          // Data index = deptIndexInNames + 1 (because General is at index 0)
          signedAmount = agreementData['Last 30d']?.[deptIndexInNames + 1]?.amount || 0;
          dueAmount = invoicedData['Last 30d']?.[deptIndexInNames + 1]?.amount || 0;
        }
      }
      
      return {
        category,
        signed: Math.ceil(signedAmount),
        due: Math.ceil(dueAmount),
      };
    });
  }, [departmentNames, agreementData, invoicedData]);

  const scoreboardBarDataMonth = useMemo(() => {
    // Filter out "General" from departmentNames if it exists to avoid duplicates
    const filteredDeptNames = departmentNames.filter(name => name !== 'General');
    const categories = [...filteredDeptNames, 'Total'];
    const selectedMonthName = new Date(selectedYear, months.indexOf(selectedMonth), 1).toLocaleDateString('en-US', { month: 'long' });
    
    // Create a mapping from department name to its index in departmentNames (which matches data structure order)
    const deptNameToIndex = new Map<string, number>();
    departmentNames.forEach((name, idx) => {
      if (name !== 'General') {
        deptNameToIndex.set(name, idx);
      }
    });
    
    return categories.map((category, index) => {
      let signedAmount = 0;
      let dueAmount = 0;
      
      if (index === categories.length - 1) {
        // Total -> data index = departmentNames.length (no General column in month data)
        signedAmount = agreementData[selectedMonthName]?.[departmentNames.length]?.amount || 0;
        dueAmount = invoicedData[selectedMonthName]?.[departmentNames.length]?.amount || 0;
      } else {
        // Department -> find its index in departmentNames to get correct data index
        const deptIndexInNames = deptNameToIndex.get(category);
        if (deptIndexInNames !== undefined) {
          // For month data: no General column, so data index = deptIndexInNames
          signedAmount = agreementData[selectedMonthName]?.[deptIndexInNames]?.amount || 0;
          dueAmount = invoicedData[selectedMonthName]?.[deptIndexInNames]?.amount || 0;
        }
      }
      
      return {
        category,
        signed: Math.ceil(signedAmount),
        due: Math.ceil(dueAmount),
      };
    });
  }, [departmentNames, agreementData, invoicedData, selectedMonth, selectedYear, months]);

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
  const performanceDashboardRef = useRef<HTMLDivElement>(null);
  const [aiHeight, setAiHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    function updateHeight() {
      // Only match heights on desktop (md breakpoint and above)
      // On mobile, let AI box have natural height
      const isMobile = window.innerWidth < 768; // md breakpoint
      
      if (!isMobile && performanceDashboardRef.current && aiRef.current && !aiContainerCollapsed) {
        const performanceHeight = performanceDashboardRef.current.offsetHeight;
        setAiHeight(performanceHeight);
      } else {
        // On mobile or when collapsed, don't set fixed height
        setAiHeight(undefined);
      }
    }
    
    // Initial update with delay to ensure DOM is ready
    const timeoutId = setTimeout(updateHeight, 100);
    
    // Update on resize
    window.addEventListener('resize', updateHeight);
    
    // Use ResizeObserver for more accurate height tracking
    let resizeObserver: ResizeObserver | null = null;
    if (performanceDashboardRef.current) {
      resizeObserver = new ResizeObserver(() => {
        // Small delay to ensure DOM is updated
        setTimeout(updateHeight, 50);
      });
      resizeObserver.observe(performanceDashboardRef.current);
    }
    
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', updateHeight);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [aiContainerCollapsed]);

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
            <th className="text-center px-5 py-3 font-semibold text-slate-700">Total</th>
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
                    // Find the correct department index in departmentNames to match the data structure
                    const deptIndexInNames = departmentNames.indexOf(category);
                    const dataIndex = deptIndexInNames >= 0 ? deptIndexInNames : index;
                    const data = isToday ? dataSource["Today"][dataIndex + 1] : // Skip General row
                                isLast30 ? dataSource["Last 30d"][dataIndex + 1] : // Skip General row
                                dataSource[selectedMonth]?.[dataIndex]; // This month uses selected month data (no General row)
                    const amount = data?.amount || 0;
                    const target = data?.expected || 0;
                    const targetClass = target > 0 ? (amount >= target ? 'text-green-600' : 'text-red-600') : 'text-slate-700';
                    
                    return (
                      <td key={`${category}-combined`} className="px-5 py-3 text-center">
                        <div className="space-y-1">
                          <div className="badge font-semibold px-2 py-1 bg-slate-100 text-slate-700 border border-slate-200">{data?.count || 0}</div>
                          <div className="border-t border-slate-200 my-1"></div>
                          <div className="font-semibold text-slate-700">₪{Math.ceil(amount).toLocaleString()}</div>
                        </div>
                      </td>
                    );
                  })}
                  {/* Total column for this time period */}
                  <td className="px-5 py-3 text-center text-slate-700">
                    <div className="space-y-1">
                      <div className="flex items-center justify-center">
                        <div className="badge bg-slate-100 text-slate-700 font-semibold px-2 py-1 border border-slate-200">
                          {(() => {
                            // Calculate the correct total index based on number of departments
                            const totalIndexToday = departmentNames.length + 1; // General + departments + Total
                            const totalIndexMonth = departmentNames.length; // departments + Total (no General)
                            
                            if (isToday) {
                              // Use pre-calculated total from data structure
                              return dataSource["Today"]?.[totalIndexToday]?.count || 0;
                            } else if (isLast30) {
                              // Use pre-calculated total from data structure
                              return dataSource["Last 30d"]?.[totalIndexToday]?.count || 0;
                            } else {
                              // Use pre-calculated total from data structure for month
                              return dataSource[selectedMonth]?.[totalIndexMonth]?.count || 0;
                            }
                          })()}
                        </div>
                      </div>
                      <div className="border-t border-slate-200 my-1"></div>
                      <div className="font-semibold text-slate-700">
                        ₪{(() => {
                          // Calculate the correct total index based on number of departments
                          const totalIndexToday = departmentNames.length + 1; // General + departments + Total
                          const totalIndexMonth = departmentNames.length; // departments + Total (no General)
                          
                          if (isToday) {
                            // Use pre-calculated total from data structure
                            return Math.ceil(dataSource["Today"]?.[totalIndexToday]?.amount || 0).toLocaleString();
                          } else if (isLast30) {
                            // Use pre-calculated total from data structure
                            return Math.ceil(dataSource["Last 30d"]?.[totalIndexToday]?.amount || 0).toLocaleString();
                          } else {
                            // Use pre-calculated total from data structure for month
                            return Math.ceil(dataSource[selectedMonth]?.[totalIndexMonth]?.amount || 0).toLocaleString();
                          }
                        })()}
                      </div>
                    </div>
                  </td>
                </tr>
                {/* Target row - only show for current month */}
                {isThisMonth && (
                  <tr className="bg-white border border-slate-200">
                    <td className="px-5 py-3 font-semibold text-slate-700">Target {columnType}</td>
                    {categories.map((category, index) => {
                      // Find the correct department index in departmentNames to match the data structure
                      const deptIndexInNames = departmentNames.indexOf(category);
                      const dataIndex = deptIndexInNames >= 0 ? deptIndexInNames : index;
                      const data = dataSource[selectedMonth]?.[dataIndex];
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
                    <td className="px-5 py-3 text-center font-semibold text-slate-700">
                      {(() => {
                        // Sum all department targets (excluding Total row)
                        // For month data, departments are at indices 0 to departmentNames.length - 1
                        const numDepartments = departmentNames.length;
                        const totalTarget = dataSource[selectedMonth]?.slice(0, numDepartments).reduce((sum: number, item: { count: number; amount: number; expected: number }) => sum + (item.expected || 0), 0) || 0;
                        return totalTarget ? `₪${Math.ceil(totalTarget).toLocaleString()}` : '—';
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
    
    (async () => {
      try {
        // Calculate date 30 days ago
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const thirtyDaysAgoStr = thirtyDaysAgo.toISOString();

        // Fetch contracts signed (stage = 60) from last 30 days
        const { data: contractsData, error: contractsError } = await supabase
          .from('leads_leadstage')
          .select(`
            id,
            stage,
            date,
            creator_id,
            lead_id,
            newlead_id
          `)
          .eq('stage', 60)
          .gte('date', thirtyDaysAgoStr)
          .order('date', { ascending: false });

        if (contractsError) {
          setRealSignedLeads([]);
          setRealLeadsLoading(false);
          return;
        }

        // Get current user info
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setRealSignedLeads([]);
          setRealLeadsLoading(false);
          return;
        }

        const { data: userData } = await supabase
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

        const userFullName = (userData?.tenants_employee as any)?.display_name || userData?.full_name;
        const userEmployeeId = userData?.employee_id;

        // Filter contracts that belong to current user and deduplicate by lead
        const userContractsMap = new Map<string, any>();

        for (const contract of contractsData || []) {
          let belongsToUser = false;

          if (contract.creator_id) {
            belongsToUser = contract.creator_id === userEmployeeId;
          } else {
            // If creator_id is NULL, get closer from the lead
            if (contract.newlead_id) {
              const { data: newLead } = await supabase
                .from('leads')
                .select('closer')
                .eq('id', contract.newlead_id)
                .single();
              
              if (newLead?.closer === userFullName) {
                belongsToUser = true;
              }
            } else if (contract.lead_id) {
              const { data: legacyLead } = await supabase
                .from('leads_lead')
                .select('closer_id')
                .eq('id', contract.lead_id)
                .single();
              
              if (legacyLead?.closer_id === userEmployeeId) {
                belongsToUser = true;
              }
            }
          }

          if (belongsToUser) {
            // Deduplicate by lead_id/newlead_id - keep only the first (most recent) contract per lead
            const leadKey = contract.newlead_id ? `new_${contract.newlead_id}` : `legacy_${contract.lead_id}`;
            if (!userContractsMap.has(leadKey)) {
              userContractsMap.set(leadKey, contract);
            }
          }
        }

        // Convert map to array
        const userContracts = Array.from(userContractsMap.values());

        // Get unique lead IDs (both new and legacy) - already deduplicated
        const newLeadIds = [...new Set(userContracts.map(c => c.newlead_id).filter(Boolean))];
        const legacyLeadIds = [...new Set(userContracts.map(c => c.lead_id).filter(Boolean))];

        // Fetch new leads data
        let newLeadsData: any[] = [];
        if (newLeadIds.length > 0) {
          const { data: newLeads, error: newLeadsError } = await supabase
            .from('leads')
            .select(`
              id,
              lead_number,
              name,
              category,
              category_id,
              date_signed,
              number_of_applicants_meeting,
              balance,
              balance_currency,
              proposal_total,
              proposal_currency
            `)
            .in('id', newLeadIds);

          if (!newLeadsError && newLeads) {
            newLeadsData = newLeads;
          }
        }

        // Fetch legacy leads data
        let legacyLeadsData: any[] = [];
        if (legacyLeadIds.length > 0) {
          const { data: legacyLeads, error: legacyLeadsError } = await supabase
            .from('leads_lead')
            .select(`
              id,
              name,
              category_id,
              no_of_applicants,
              total,
              currency_id
            `)
            .in('id', legacyLeadIds);

          if (!legacyLeadsError && legacyLeads) {
            // Fetch currency codes
            const currencyIds = legacyLeads.map(l => l.currency_id).filter(Boolean);
            let currencyMap: Record<number, string> = {};
            
            if (currencyIds.length > 0) {
              const { data: currencies } = await supabase
                .from('accounting_currencies')
                .select('id, iso_code')
                .in('id', currencyIds);
              
              if (currencies) {
                currencyMap = currencies.reduce((acc, curr) => {
                  acc[curr.id] = curr.iso_code;
                  return acc;
                }, {} as Record<number, string>);
              }
            }

            legacyLeadsData = legacyLeads.map(lead => ({
              ...lead,
              currency_code: currencyMap[lead.currency_id] || '₪'
            }));
          }
        }

        // Fetch categories with main categories for category names
        const allCategoryIds = [
          ...new Set([
            ...newLeadsData.map(l => l.category_id).filter(Boolean),
            ...legacyLeadsData.map(l => l.category_id).filter(Boolean)
          ])
        ];

        let categoryMap: Record<number, string> = {};
        if (allCategoryIds.length > 0) {
          const { data: categories } = await supabase
            .from('misc_category')
            .select(`
              id,
              name,
              parent_id,
              misc_maincategory!parent_id(
                id,
                name
              )
            `)
            .in('id', allCategoryIds);

          if (categories) {
            categoryMap = categories.reduce((acc, cat: any) => {
              // Format as "subcategory (main category)" or just "category" if no main category
              const mainCategory = Array.isArray(cat.misc_maincategory) 
                ? cat.misc_maincategory[0] 
                : cat.misc_maincategory;
              
              if (mainCategory?.name) {
                acc[cat.id] = `${cat.name} (${mainCategory.name})`;
              } else {
                acc[cat.id] = cat.name;
              }
              return acc;
            }, {} as Record<number, string>);
          }
        }

        // Combine and map contracts to leads with signed date
        const signedLeadsWithDate = userContracts.map(contract => {
          if (contract.newlead_id) {
            const lead = newLeadsData.find(l => l.id === contract.newlead_id);
            if (lead) {
              return {
                id: lead.id,
                lead_number: lead.lead_number,
                name: lead.name,
                category: categoryMap[lead.category_id] || lead.category || 'N/A',
                signed_date: contract.date,
                applicants: lead.number_of_applicants_meeting || 'N/A',
                value: lead.balance || lead.proposal_total || 0,
                currency: lead.balance_currency || lead.proposal_currency || '₪',
                lead_type: 'new'
              };
            }
          } else if (contract.lead_id) {
            const lead = legacyLeadsData.find(l => l.id === contract.lead_id);
            if (lead) {
              return {
                id: `legacy_${lead.id}`,
                lead_number: lead.id.toString(),
                name: lead.name,
                category: categoryMap[lead.category_id] || 'N/A',
                signed_date: contract.date,
                applicants: lead.no_of_applicants || 'N/A',
                value: lead.total || 0,
                currency: lead.currency_code || '₪',
                lead_type: 'legacy'
              };
            }
          }
          return null;
        }).filter(Boolean);

        // Sort by signed date (most recent first)
        signedLeadsWithDate.sort((a, b) => {
          if (!a || !b) return 0;
          const dateA = new Date(a.signed_date).getTime();
          const dateB = new Date(b.signed_date).getTime();
          return dateB - dateA;
        });

        setRealSignedLeads(signedLeadsWithDate);
      } catch (error) {
        setRealSignedLeads([]);
      } finally {
        setRealLeadsLoading(false);
      }
    })();
  }, [showLeadsList]);

  // 2. Add effect to fetch follow-up leads when expanded === 'overdue'
  useEffect(() => {
    if (expanded !== 'overdue') return;

    const fetchFollowUpLeads = async () => {
      if (followUpTab === 'today') {
        setTodayFollowUpsLoading(true);
        try {
          const { newLeads, legacyLeads } = await fetchFollowUpLeadsData('today', true);
          const combinedLeads = [...newLeads, ...legacyLeads];
          const processedLeads = await processOverdueLeadsForDisplay(combinedLeads, true);
          setTodayFollowUps(processedLeads);
        } catch (error) {
          setTodayFollowUps([]);
        } finally {
          setTodayFollowUpsLoading(false);
        }
      } else if (followUpTab === 'tomorrow') {
        setTomorrowFollowUpsLoading(true);
        try {
          const { newLeads, legacyLeads } = await fetchFollowUpLeadsData('tomorrow', true);
          const combinedLeads = [...newLeads, ...legacyLeads];
          const processedLeads = await processOverdueLeadsForDisplay(combinedLeads, true);
          setTomorrowFollowUps(processedLeads);
        } catch (error) {
          setTomorrowFollowUps([]);
        } finally {
          setTomorrowFollowUpsLoading(false);
        }
      } else if (followUpTab === 'future') {
        setFutureFollowUpsLoading(true);
        try {
          const { newLeads, legacyLeads } = await fetchFollowUpLeadsData('future', true);
          const combinedLeads = [...newLeads, ...legacyLeads];
          const processedLeads = await processOverdueLeadsForDisplay(combinedLeads, true);
          setFutureFollowUps(processedLeads);
        } catch (error) {
          setFutureFollowUps([]);
        } finally {
          setFutureFollowUpsLoading(false);
        }
      } else {
        // overdue
        setOverdueLeadsLoading(true);
        try {
          const { newLeads, legacyLeads } = await fetchOverdueLeadsData(false);
          const combinedLeads = [...newLeads, ...legacyLeads];
          const processedLeads = await processOverdueLeadsForDisplay(combinedLeads);
          setRealOverdueLeads(processedLeads);
        } catch (error) {
          setRealOverdueLeads([]);
        } finally {
          setOverdueLeadsLoading(false);
        }
      }
    };

    fetchFollowUpLeads();
  }, [expanded, followUpTab]);

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
    } finally {
      setLoadingMoreLeads(false);
    }
  };

  // Helper function to process overdue leads for display
  const processOverdueLeadsForDisplay = async (leadsData: any[], processAll = false) => {
    try {
      // Separate new and legacy leads based on table structure
      // New leads come from 'leads' table and have lead_number field (string)
      // Legacy leads come from 'leads_lead' table and don't have lead_number, or have any role ID fields
      const newLeads = leadsData.filter(lead => {
        // New leads have lead_number as a string field
        // Filter out deleted leads (those without lead_number)
        return lead.lead_number && 
               typeof lead.lead_number === 'string' && 
               lead.lead_number.trim() !== '' &&
               !lead.id?.toString().startsWith('legacy_');
      });
      
      const legacyLeads = leadsData.filter(lead => {
        // Legacy leads either:
        // 1. Don't have lead_number (from leads_lead table)
        // 2. Have any of the role ID fields (expert_id, meeting_manager_id, etc.)
        // 3. Have id that starts with 'legacy_' (already processed)
        // 4. Have id as a number (legacy leads have bigint id)
        const hasRoleField = lead.expert_id || 
                            lead.meeting_manager_id || 
                            lead.meeting_lawyer_id || 
                            lead.meeting_scheduler_id || 
                            lead.case_handler_id || 
                            lead.closer_id;
        const isLegacyId = typeof lead.id === 'number' || lead.id?.toString().startsWith('legacy_');
        return (!lead.lead_number && isLegacyId) || hasRoleField || isLegacyId;
      });
      // Fetch stage names for new leads
      let newLeadStageIds: number[] = [];
      if (newLeads.length > 0) {
        newLeadStageIds = [...new Set(newLeads.map(lead => lead.stage).filter((stage): stage is number => 
          stage !== null && stage !== undefined && typeof stage === 'number'
        ))];
      }
      
      let newLeadStageNameMap: { [key: number]: string } = {};
      if (newLeadStageIds.length > 0) {
        const { data: newLeadStages, error: newLeadStagesError } = await supabase
          .from('lead_stages')
          .select('id, name')
          .in('id', newLeadStageIds);
        
        if (!newLeadStagesError && newLeadStages) {
          newLeadStageNameMap = newLeadStages.reduce((acc: { [key: number]: string }, stage: any) => {
            acc[stage.id] = stage.name || getStageName(String(stage.id));
            return acc;
          }, {});
        }
      }
      
      // Fetch employee names for new leads (for expert_id, meeting_manager_id, and also check expert/manager fields if they're numeric IDs)
      let newLeadEmployeeIds: number[] = [];
      if (newLeads.length > 0) {
        const employeeIdSet = new Set<number>();
        
        // Collect from ID fields
        newLeads.forEach(lead => {
          if (lead.expert_id && typeof lead.expert_id === 'number') {
            employeeIdSet.add(lead.expert_id);
          }
          if (lead.meeting_manager_id && typeof lead.meeting_manager_id === 'number') {
            employeeIdSet.add(lead.meeting_manager_id);
          }
          
          // Also check expert and manager text fields - they might contain numeric IDs
          if (lead.expert && typeof lead.expert === 'string' && !isNaN(Number(lead.expert))) {
            const expertId = Number(lead.expert);
            if (expertId > 0) {
              employeeIdSet.add(expertId);
            }
          }
          if (lead.manager && typeof lead.manager === 'string' && !isNaN(Number(lead.manager))) {
            const managerId = Number(lead.manager);
            if (managerId > 0) {
              employeeIdSet.add(managerId);
            }
          }
        });
        
        newLeadEmployeeIds = Array.from(employeeIdSet);
      }
      
      let newLeadEmployeeNameMap: { [key: number]: string } = {};
      if (newLeadEmployeeIds.length > 0) {
        const { data: newLeadEmployees, error: newLeadEmployeesError } = await supabase
          .from('tenants_employee')
          .select('id, display_name')
          .in('id', newLeadEmployeeIds);
        
        if (!newLeadEmployeesError && newLeadEmployees) {
          newLeadEmployeeNameMap = newLeadEmployees.reduce((acc: { [key: number]: string }, employee: any) => {
            acc[employee.id] = employee.display_name;
            return acc;
          }, {});
        }
      }
      
      // Fetch categories with main categories for new leads
      let newLeadCategoryIds: number[] = [];
      let newLeadCategoryNameMap: { [key: number]: string } = {};
      if (newLeads.length > 0) {
        newLeadCategoryIds = [...new Set(newLeads.map(lead => lead.category_id).filter((id): id is number => id !== null && id !== undefined && typeof id === 'number'))];
        
        if (newLeadCategoryIds.length > 0) {
          const { data: newLeadCategories, error: newLeadCategoriesError } = await supabase
            .from('misc_category')
            .select(`
              id,
              name,
              parent_id,
              misc_maincategory!parent_id(
                id,
                name
              )
            `)
            .in('id', newLeadCategoryIds);
          
          if (!newLeadCategoriesError && newLeadCategories) {
            newLeadCategoryNameMap = newLeadCategories.reduce((acc: { [key: number]: string }, category: any) => {
              // Format as "subcategory (main category)" or just "category" if no main category
              const mainCategory = Array.isArray(category.misc_maincategory) 
                ? category.misc_maincategory[0] 
                : category.misc_maincategory;
              
              if (mainCategory?.name) {
                acc[category.id] = `${category.name} (${mainCategory.name})`;
              } else {
                acc[category.id] = category.name;
              }
              return acc;
            }, {});
          }
        }
      }
      
      // Process new leads - filter out any that don't have lead_number (deleted leads)
      // Also filter out leads where lead_number equals the ID (which means it's deleted)
      const validNewLeads = newLeads.filter(lead => {
        if (!lead.lead_number || typeof lead.lead_number !== 'string' || lead.lead_number.trim() === '') {
          return false; // No lead_number = deleted
        }
        // Check if lead_number is actually the ID (UUID or numeric ID) - this also means deleted
        const leadIdStr = lead.id?.toString() || '';
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lead.lead_number);
        const isRawId = lead.lead_number === leadIdStr || lead.lead_number === String(lead.id);
        if (isUUID || isRawId) {
          return false; // lead_number is the ID = deleted lead
        }
        return true; // Valid lead_number
      });
      const processedNewLeads = validNewLeads.map(lead => {
        // Resolve expert name - check if expert_id is set, or if expert field contains a numeric ID
        let expertName = 'Not assigned';
        if (lead.expert_id && typeof lead.expert_id === 'number') {
          expertName = newLeadEmployeeNameMap[lead.expert_id] || 'Not assigned';
        } else if (lead.expert) {
          // Check if expert is a numeric ID (string that can be converted to number)
          if (typeof lead.expert === 'string' && !isNaN(Number(lead.expert)) && Number(lead.expert) > 0) {
            const expertId = Number(lead.expert);
            expertName = newLeadEmployeeNameMap[expertId] || lead.expert;
          } else {
            // It's a text name, use it directly
            expertName = lead.expert;
          }
        }
        
        // Resolve manager name - check if meeting_manager_id is set, or if manager field contains a numeric ID
        let managerName = 'Not assigned';
        if (lead.meeting_manager_id && typeof lead.meeting_manager_id === 'number') {
          managerName = newLeadEmployeeNameMap[lead.meeting_manager_id] || 'Not assigned';
        } else if (lead.manager) {
          // Check if manager is a numeric ID (string that can be converted to number)
          if (typeof lead.manager === 'string' && !isNaN(Number(lead.manager)) && Number(lead.manager) > 0) {
            const managerId = Number(lead.manager);
            managerName = newLeadEmployeeNameMap[managerId] || lead.manager;
          } else {
            // It's a text name, use it directly
            managerName = lead.manager;
          }
        } else if (lead.meeting_manager && typeof lead.meeting_manager === 'string') {
          // Check if meeting_manager is a numeric ID
          if (!isNaN(Number(lead.meeting_manager)) && Number(lead.meeting_manager) > 0) {
            const managerId = Number(lead.meeting_manager);
            managerName = newLeadEmployeeNameMap[managerId] || lead.meeting_manager;
          } else {
            managerName = lead.meeting_manager;
          }
        }
        
        // Resolve category name - check if category_id is set, otherwise use category text field
        let categoryName = 'Not specified';
        if (lead.category_id && typeof lead.category_id === 'number') {
          categoryName = newLeadCategoryNameMap[lead.category_id] || lead.category || 'Not specified';
        } else if (lead.category && typeof lead.category === 'string') {
          categoryName = lead.category;
        }
        
        // Use lead_number directly from database - it's already fetched from the leads table
        // At this point we know lead_number exists and is valid (filtered above)
        return {
          ...lead,
          lead_type: 'new' as const,
          lead_number: lead.lead_number, // Use lead_number from database, guaranteed to exist
          stage_name: (lead.stage !== null && lead.stage !== undefined) 
            ? (newLeadStageNameMap[lead.stage] || getStageName(String(lead.stage)))
            : 'Follow-up Required',
          expert_name: expertName,
          manager_name: managerName,
          category_name: categoryName,
          amount: lead.balance || 0,
          currency: lead.balance_currency || '₪',
          topic: lead.topic || 'Not specified',
          probability: lead.probability || 0
        };
      });

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
        // Fetch all related data in parallel for better performance
        const [stageResult, employeeResult, categoryResult] = await Promise.allSettled([
          stageIds.length > 0 ? supabase.from('lead_stages').select('id, name').in('id', stageIds) : Promise.resolve({ data: [] }),
          employeeIds.length > 0 ? supabase.from('tenants_employee').select('id, display_name').in('id', employeeIds) : Promise.resolve({ data: [] }),
          categoryIds.length > 0 ? supabase.from('misc_category').select(`
            id,
            name,
            parent_id,
            misc_maincategory!parent_id(
              id,
              name
            )
          `).in('id', categoryIds) : Promise.resolve({ data: [] })
        ]);

        // Build maps from results
        if (stageResult.status === 'fulfilled' && stageResult.value.data) {
          stageNameMap = stageResult.value.data.reduce((acc: { [key: number]: string }, stage: any) => {
            acc[stage.id] = stage.name || getStageName(String(stage.id));
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
            // Format as "subcategory (main category)" or just "category" if no main category
            const mainCategory = Array.isArray(category.misc_maincategory) 
              ? category.misc_maincategory[0] 
              : category.misc_maincategory;
            
            if (mainCategory?.name) {
              acc[category.id] = `${category.name} (${mainCategory.name})`;
            } else {
              acc[category.id] = category.name;
            }
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
        stage_name: stageNameMap[lead.stage] || getStageName(String(lead.stage)) || 'Follow-up Required',
        expert_name: employeeNameMap[lead.expert_id] || 'Not assigned',
        manager_name: employeeNameMap[lead.meeting_manager_id] || 'Not assigned',
        category_name: categoryNameMap[lead.category_id] || 'Not specified',
        amount: lead.total || 0,
        currency: lead.currency_id || 1,
        topic: lead.topic || 'Not specified',
        probability: 0 // Legacy leads don't have probability field
      }));

      // Combine and filter out deleted leads (new leads without lead_number or with ID as lead_number)
      const allLeads = [...processedNewLeads, ...processedLegacyLeads]
        .filter(lead => {
          // For new leads, ensure they have a valid lead_number (deleted leads don't have one)
          if (lead.lead_type === 'new') {
            if (!lead.lead_number || typeof lead.lead_number !== 'string' || lead.lead_number.trim() === '') {
              return false; // No lead_number = deleted
            }
            // Check if lead_number is actually the ID (UUID or numeric ID) - this also means deleted
            const leadIdStr = lead.id?.toString() || '';
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lead.lead_number);
            const isRawId = lead.lead_number === leadIdStr || lead.lead_number === String(lead.id);
            if (isUUID || isRawId) {
              return false; // lead_number is the ID = deleted lead
            }
            return true; // Valid lead_number
          }
          // Legacy leads are always included (they use ID as lead_number)
          return true;
        })
        .sort((a, b) => {
          if (!a.next_followup && !b.next_followup) return 0;
          if (!a.next_followup) return 1;
          if (!b.next_followup) return -1;
          return new Date(a.next_followup).getTime() - new Date(b.next_followup).getTime();
        });
      return allLeads;
    } catch (error) {
      return [];
    }
  };

  return (
    <div className="p-0 md:p-6 space-y-8">
      {/* 1. Summary Boxes: 4 columns */}
      <div className="flex md:grid md:grid-cols-4 gap-3 md:gap-6 mb-8 w-full mt-6 md:mt-0 overflow-x-auto scrollbar-hide pb-2 md:pb-0 overflow-y-visible">
        {/* Meetings Today */}
        <div
          className="flex-shrink-0 rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white relative overflow-visible p-4 md:p-6 w-[calc(50vw-0.75rem)] md:w-auto h-32 md:h-auto ml-4 md:ml-0"
          onClick={() => setExpanded(expanded === 'meetings' ? null : 'meetings')}
        >
          {/* Meetings in Next Hour Badge - Desktop: top, Mobile: bottom */}
          {meetingsInNextHour > 0 && nextHourMeetings.length > 0 && (
            <>
              {/* Desktop: Top Right */}
              <div className="hidden md:flex absolute top-1 right-2 z-10 group items-center gap-2 flex-wrap justify-end max-w-[calc(100%-1rem)]">
                {/* Text Badge - Active - Only show first meeting */}
                <span className="inline-flex items-center px-2.5 py-1 text-white text-xs font-semibold whitespace-nowrap break-words">
                  Meeting {formatTimeUntil(nextHourMeetings[0].meetingDateTime)} with {nextHourMeetings[0].name} ({nextHourMeetings[0].lead})
                </span>
                {/* Count Badge */}
                <span 
                  className="inline-flex items-center justify-center min-w-[28px] h-7 px-2.5 bg-white text-red-500 text-xs font-bold rounded-full shadow-lg animate-pulse ring-2 ring-white ring-opacity-75 cursor-help flex-shrink-0"
                  title={nextHourMeetings.map((meeting: any) => 
                    `Meeting ${formatTimeUntil(meeting.meetingDateTime)} with ${meeting.name} (${meeting.lead})`
                  ).join('\n')}
                >
                  {meetingsInNextHour}
                </span>
                {/* Custom Tooltip */}
                <div className="absolute right-0 top-full mt-2 w-[280px] max-w-[calc(100vw-2rem)] p-2.5 sm:p-3 bg-gray-900 text-white text-xs sm:text-sm rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 pointer-events-none whitespace-normal">
                  <div className="space-y-2">
                    {nextHourMeetings.map((meeting: any, index: number) => (
                      <div key={meeting.id || index} className="border-b border-gray-700 last:border-0 pb-2 last:pb-0">
                        <div className="font-semibold text-white text-[11px] sm:text-sm break-words leading-snug">
                          Meeting {formatTimeUntil(meeting.meetingDateTime)}
                        </div>
                        <div className="text-gray-300 text-[10px] sm:text-xs mt-0.5 sm:mt-1 break-words leading-relaxed">
                          with {meeting.name} ({meeting.lead})
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Tooltip arrow */}
                  <div className="absolute -top-2 right-4 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-900"></div>
                </div>
              </div>
              
              {/* Mobile: Count Badge - Top Right */}
              <div className="md:hidden absolute top-2 right-2 z-10 group">
                <span 
                  className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 bg-white text-red-500 text-[10px] font-bold rounded-full shadow-lg animate-pulse ring-2 ring-white ring-opacity-75 cursor-help flex-shrink-0"
                  title={nextHourMeetings.map((meeting: any) => 
                    `Meeting ${formatTimeUntil(meeting.meetingDateTime)} with ${meeting.name} (${meeting.lead})`
                  ).join('\n')}
                >
                  {meetingsInNextHour}
                </span>
                {/* Custom Tooltip */}
                <div className="absolute right-0 top-full mt-2 w-[280px] max-w-[calc(100vw-2rem)] p-2.5 bg-gray-900 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 pointer-events-none whitespace-normal">
                  <div className="space-y-2">
                    {nextHourMeetings.map((meeting: any, index: number) => (
                      <div key={meeting.id || index} className="border-b border-gray-700 last:border-0 pb-2 last:pb-0">
                        <div className="font-semibold text-white text-[11px] break-words leading-snug">
                          Meeting {formatTimeUntil(meeting.meetingDateTime)}
                        </div>
                        <div className="text-gray-300 text-[10px] mt-0.5 break-words leading-relaxed">
                          with {meeting.name} ({meeting.lead})
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Tooltip arrow */}
                  <div className="absolute -top-2 right-4 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-900"></div>
                </div>
              </div>
              
              {/* Mobile: Text Notice - Bottom */}
              <div className="md:hidden absolute bottom-1 left-0 right-0 z-10 flex items-center justify-center px-2">
                <span className="inline-flex items-center px-2 py-0.5 text-white text-[9px] font-semibold whitespace-normal break-words text-center leading-tight">
                  Meeting {formatTimeUntil(nextHourMeetings[0].meetingDateTime)} with {nextHourMeetings[0].name} ({nextHourMeetings[0].lead})
                </span>
              </div>
            </>
          )}
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-12 h-12 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
              <CalendarIcon className="w-7 h-7 md:w-7 md:h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-extrabold text-white leading-tight">{meetingsToday}</div>
              <div className="text-white/80 text-sm md:text-sm font-medium mt-1">Meetings Today</div>
            </div>
          </div>
          {/* SVG Graph Placeholder */}
          <svg className="absolute bottom-2 right-2 w-10 h-5 md:w-16 md:h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><path d="M2 28 Q16 8 32 20 T62 8" /></svg>
        </div>

        {/* Follow ups */}
        <div
          className="flex-shrink-0 rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-purple-600 via-blue-600 to-blue-500 text-white relative overflow-hidden p-4 md:p-6 w-[calc(50vw-0.75rem)] md:w-auto h-32 md:h-auto"
          onClick={() => setExpanded(expanded === 'overdue' ? null : 'overdue')}
        >
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-12 h-12 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
              <ExclamationTriangleIcon className="w-7 h-7 md:w-7 md:h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-extrabold text-white leading-tight">{overdueFollowups}</div>
              <div className="text-white/80 text-sm md:text-sm font-medium mt-1">Today's Follow ups</div>
            </div>
          </div>
          {/* SVG Bar Chart Placeholder */}
          <svg className="absolute bottom-2 right-2 w-10 h-5 md:w-12 md:h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 48 32"><rect x="2" y="20" width="4" height="10"/><rect x="10" y="10" width="4" height="20"/><rect x="18" y="16" width="4" height="14"/><rect x="26" y="6" width="4" height="24"/><rect x="34" y="14" width="4" height="16"/></svg>
        </div>

        {/* New Messages */}
        <div
          className="flex-shrink-0 rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white relative overflow-hidden p-4 md:p-6 w-[calc(50vw-0.75rem)] md:w-auto h-32 md:h-auto"
          onClick={() => setExpanded(expanded === 'messages' ? null : 'messages')}
        >
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-12 h-12 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
              <ChatBubbleLeftRightIcon className="w-7 h-7 md:w-7 md:h-7 mr-1 text-white" />
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-extrabold text-white leading-tight">{latestMessages.length}</div>
              <div className="text-white/80 text-sm md:text-sm font-medium mt-1">New Messages</div>
            </div>
          </div>
          {/* SVG Circle Placeholder */}
          <svg className="absolute bottom-2 right-2 w-10 h-10 md:w-10 md:h-10 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" /><text x="16" y="21" textAnchor="middle" fontSize="10" fill="white" opacity="0.7">99+</text></svg>
        </div>

        {/* Action Required */}
        <div
          className="flex-shrink-0 rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl bg-gradient-to-tr from-[#4b2996] via-[#6c4edb] to-[#3b28c7] text-white relative overflow-hidden p-4 md:p-6 w-[calc(50vw-0.75rem)] md:w-auto h-32 md:h-auto"
          onClick={() => setIsAISuggestionsModalOpen(true)}
        >
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center justify-center w-12 h-12 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
              <ArrowTrendingUpIcon className="w-7 h-7 md:w-7 md:h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-3xl md:text-4xl font-extrabold text-white leading-tight">{aiActions}</div>
              <div className="text-white/80 text-sm md:text-sm font-medium mt-1">Action Required</div>
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
              <div className="flex gap-4 overflow-x-auto py-4 px-1 scrollbar-hide">
                  {todayMeetings.map((meeting, index) => (
                    <div key={meeting.id} className="min-w-[85vw] max-w-[90vw] bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 border border-gray-100 group flex flex-col justify-between h-full min-h-[340px] relative pb-16" style={{ flex: '0 0 85vw' }}>
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
                          <span className="text-sm font-bold text-gray-800">
                            {meeting.time && meeting.time.includes(':') && meeting.time.split(':').length === 3
                              ? meeting.time.substring(0, 5)
                              : meeting.time}
                          </span>
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
                        {/* Scheduler */}
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs font-semibold text-gray-500">Scheduler</span>
                          <span className="text-sm font-bold text-gray-800">{meeting.scheduler || '---'}</span>
                        </div>
                        {/* Stage */}
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs font-semibold text-gray-500">Stage</span>
                          <span className="text-sm font-bold text-gray-800">{meeting.stage || 'N/A'}</span>
                        </div>
                        {/* Location */}
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs font-semibold text-gray-500">Location</span>
                          <span className="text-sm font-bold text-gray-800">{meeting.location}</span>
                        </div>
                        </div>
                      </div>
                      {/* Action Buttons */}
                      {(() => {
                        // meeting.link already prefers explicit Teams URL and falls back to location default_link
                        const hasLink = !!getValidTeamsLink(meeting.link);
                        const isTeamsMeeting = !!meeting.teams_meeting_url || !!(meeting.link && getValidTeamsLink(meeting.link));
                        const hasDefaultForLocation = !!meetingLocationLinks[meeting.location];
                        const isOnline = isOnlineLocation(meeting.location || '');
                        const isStaffMeeting = meeting.isStaffMeeting === true;
                        // Show join button for:
                        // - meetings with valid Teams/online links
                        // - locations that have a default_link configured
                        // - staff meetings with links
                        return hasLink && (isTeamsMeeting || isOnline || hasDefaultForLocation || isStaffMeeting);
                      })() && (
                        <div className="absolute bottom-4 left-4 right-4">
                          {/* Join Meeting (Teams) */}
                          <button 
                            className="btn btn-primary btn-xs sm:btn-sm w-full"
                            onClick={() => {
                              const url = getValidTeamsLink(
                                meeting.link ||
                                meeting.teams_meeting_url ||
                                meetingLocationLinks[meeting.location]
                              );
                              if (url) {
                                window.open(url, '_blank');
                              } else {
                                alert('No meeting URL available');
                              }
                            }}
                            title={meeting.isStaffMeeting ? "Join Meeting" : "Teams Meeting"}
                          >
                            <VideoCameraIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                          </button>
                        </div>
                      )}
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
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
            <div className="font-bold text-lg text-base-content/80">Follow ups</div>
            
            {/* Tabs */}
            <div className="flex gap-2 items-center">
              <button
                onClick={() => setFollowUpTab('today')}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  followUpTab === 'today'
                    ? 'text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                style={followUpTab === 'today' ? { backgroundColor: '#3E2BCD' } : {}}
              >
                Today
              </button>
              <button
                onClick={() => setFollowUpTab('overdue')}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  followUpTab === 'overdue'
                    ? 'text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                style={followUpTab === 'overdue' ? { backgroundColor: '#3E2BCD' } : {}}
              >
                Overdue
              </button>
              <button
                onClick={() => setFollowUpTab('tomorrow')}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  followUpTab === 'tomorrow'
                    ? 'text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                style={followUpTab === 'tomorrow' ? { backgroundColor: '#3E2BCD' } : {}}
              >
                Tomorrow
              </button>
              <button
                onClick={() => setFollowUpTab('future')}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  followUpTab === 'future'
                    ? 'text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                style={followUpTab === 'future' ? { backgroundColor: '#3E2BCD' } : {}}
              >
                Future
              </button>
              {/* View Mode Toggle - Desktop only */}
              <div className="hidden md:flex">
                <button
                  onClick={() => setFollowUpViewMode(followUpViewMode === 'table' ? 'card' : 'table')}
                  className={`px-3 py-2 rounded-xl text-sm font-medium transition-all text-white shadow-md`}
                  style={{ backgroundColor: '#3E2BCD' }}
                  title={followUpViewMode === 'table' ? 'Switch to Card View' : 'Switch to Table View'}
                >
                  {followUpViewMode === 'table' ? (
                    <Squares2X2Icon className="w-5 h-5" />
                  ) : (
                    <TableCellsIcon className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>
          </div>
          
          {/* Get current leads based on tab */}
          {(() => {
            const isLoading = followUpTab === 'today' ? todayFollowUpsLoading : 
                             followUpTab === 'tomorrow' ? tomorrowFollowUpsLoading :
                             followUpTab === 'future' ? futureFollowUpsLoading :
                             overdueLeadsLoading;
            const currentLeads = followUpTab === 'today' ? todayFollowUps :
                                followUpTab === 'tomorrow' ? tomorrowFollowUps :
                                followUpTab === 'future' ? futureFollowUps :
                                realOverdueLeads;
            
            if (isLoading) {
              return (
                <div className="flex justify-center items-center py-12">
                  <span className="loading loading-spinner loading-lg text-primary"></span>
                </div>
              );
            }
            
            if (currentLeads.length === 0) {
              return (
                <div className="text-center py-12 text-gray-500">
                  No {followUpTab} follow-ups. Great job!
                </div>
              );
            }
            
            // Table View (Desktop only, Mobile always shows cards)
            // Use CSS media query approach - hide table on mobile, show cards
            if (followUpViewMode === 'table') {
              return (
                <>
                  {/* Desktop Table View */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="table w-full">
                    <thead>
                      <tr>
                        <th>Lead</th>
                        <th>Stage</th>
                        <th>Category</th>
                        <th>Topic</th>
                        <th>Expert</th>
                        <th>Manager</th>
                        <th>Amount</th>
                        <th>Follow-up Date</th>
                        {followUpTab === 'overdue' && <th>Days Overdue</th>}
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentLeads.map((lead) => {
                        const daysOverdue = lead.next_followup ? Math.floor((new Date().getTime() - new Date(lead.next_followup).getTime()) / (1000 * 3600 * 24)) : 0;
                        return (
                          <tr 
                            key={lead.id} 
                            className="cursor-pointer hover:bg-gray-50"
                            onClick={() => {
                              if (lead.lead_type === 'legacy') {
                                // For legacy leads, remove "legacy_" prefix and navigate to {id}
                                const legacyId = lead.id?.toString().replace('legacy_', '');
                                navigate(`/clients/${legacyId}`);
                              } else {
                                // For new leads, use lead_number instead of id
                                navigate(`/clients/${lead.lead_number}`);
                              }
                            }}
                          >
                            <td>
                              <div className="flex flex-col">
                                <span className="text-sm text-gray-500">
                                  {lead.lead_number}
                                  {lead.lead_type === 'legacy' && <span className="text-xs text-gray-400 ml-1">(L)</span>}
                                </span>
                                <span className="font-semibold text-gray-900">{lead.name}</span>
                              </div>
                            </td>
                            <td>{lead.stage_name || 'N/A'}</td>
                            <td>{lead.lead_type === 'legacy' ? lead.category_name : (lead.category_name || lead.category || 'N/A')}</td>
                            <td>{lead.topic || 'N/A'}</td>
                            <td>{lead.expert_name || 'N/A'}</td>
                            <td>{lead.manager_name || 'N/A'}</td>
                            <td>
                              {lead.lead_type === 'legacy' 
                                ? `₪${Math.ceil(lead.amount || 0).toLocaleString()}` 
                                : `${lead.balance_currency || '₪'}${Math.ceil(lead.balance || 0).toLocaleString()}`
                              }
                            </td>
                            <td>
                              {editingFollowUpId === lead.follow_up_id ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="date"
                                    value={editFollowUpDate}
                                    onChange={(e) => setEditFollowUpDate(e.target.value)}
                                    className="input input-sm input-bordered"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <button
                                    className="btn btn-xs btn-primary"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSaveFollowUp(lead);
                                    }}
                                  >
                                    Save
                                  </button>
                                  <button
                                    className="btn btn-xs btn-ghost"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCancelEditFollowUp();
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <span>{lead.next_followup ? new Date(lead.next_followup).toLocaleDateString() : 'N/A'}</span>
                              )}
                            </td>
                            {followUpTab === 'overdue' && (
                              <td>{daysOverdue}</td>
                            )}
                            <td onClick={(e) => e.stopPropagation()}>
                              {editingFollowUpId !== lead.follow_up_id && (
                                <div className="flex gap-1">
                                  <button
                                    className="btn btn-xs btn-ghost"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleEditFollowUp(lead);
                                    }}
                                    title="Edit follow-up date"
                                  >
                                    <PencilSquareIcon className="w-4 h-4" style={{ color: '#3E28CD' }} />
                                  </button>
                                  <button
                                    className="btn btn-xs btn-ghost text-error"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteFollowUp(lead);
                                    }}
                                    title="Delete follow-up"
                                  >
                                    <TrashIcon className="w-4 h-4" style={{ color: '#3E28CD' }} />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Mobile Card View (shown when table mode but on mobile) */}
                <div className="md:hidden space-y-4">
                  {currentLeads.map((lead) => {
                    const daysOverdue = lead.next_followup ? Math.floor((new Date().getTime() - new Date(lead.next_followup).getTime()) / (1000 * 3600 * 24)) : 0;
                    return (
                      <div 
                        key={lead.id} 
                        className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 border border-red-100 group flex flex-col justify-between min-h-[340px] relative cursor-pointer"
                        onClick={() => {
                          if (lead.lead_type === 'legacy') {
                            // For legacy leads, remove "legacy_" prefix and navigate to legacy-{id}
                            const legacyId = lead.id?.toString().replace('legacy_', '');
                            navigate(`/clients/legacy-${legacyId}`);
                          } else {
                            // For new leads, use lead_number instead of id
                            navigate(`/clients/${lead.lead_number}`);
                          }
                        }}
                      >
                        <div className="flex-1 flex flex-col">
                          <div className="mb-3 flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-gray-400 tracking-widest">
                                {lead.lead_number}
                                {lead.lead_type === 'legacy' && <span className="text-sm text-gray-500 ml-1">(L)</span>}
                              </span>
                              {followUpTab === 'today' && (
                                <span className="text-sm font-bold px-2 py-1 rounded bg-green-600 text-white">Today</span>
                              )}
                              {followUpTab === 'tomorrow' && (
                                <span className="text-sm font-bold px-2 py-1 rounded bg-blue-600 text-white">Tomorrow</span>
                              )}
                              {followUpTab === 'future' && (
                                <span className="text-sm font-bold px-2 py-1 rounded bg-purple-600 text-white">Future</span>
                              )}
                            </div>
                            <h3 className="text-xl font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate">{lead.name}</h3>
                          </div>
                          <div className="flex justify-between items-center py-1">
                            <span className="text-sm font-semibold text-gray-500">Stage</span>
                            <span className="text-sm font-bold text-black">
                              {lead.stage_name || 'Follow-up Required'}
                            </span>
                          </div>
                          <div className="space-y-2 divide-y divide-gray-100 mt-2">
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Category</span>
                              <span className="text-sm font-bold text-gray-800">
                                {lead.lead_type === 'legacy' ? lead.category_name : (lead.category_name || lead.category || 'Not specified')}
                              </span>
                            </div>
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Topic</span>
                              <span className="text-sm font-bold text-gray-800">{lead.topic || 'Not specified'}</span>
                            </div>
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Expert</span>
                              <span className="text-sm font-bold text-gray-800">
                                {lead.expert_name || 'Not assigned'}
                              </span>
                            </div>
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Amount</span>
                              <span className="text-sm font-bold text-gray-800">
                                {lead.lead_type === 'legacy' 
                                  ? `₪${Math.ceil(lead.amount || 0).toLocaleString()}` 
                                  : `${lead.balance_currency || '₪'}${Math.ceil(lead.balance || 0).toLocaleString()}`
                                }
                              </span>
                            </div>
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Manager</span>
                              <span className="text-sm font-bold text-gray-800">
                                {lead.manager_name || 'Not assigned'}
                              </span>
                            </div>
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Probability</span>
                              <span className="text-sm font-bold text-gray-800">{lead.probability || 0}%</span>
                            </div>
                            {/* Follow-up Date */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Follow-up Date</span>
                              {editingFollowUpId === lead.follow_up_id ? (
                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="date"
                                    value={editFollowUpDate}
                                    onChange={(e) => setEditFollowUpDate(e.target.value)}
                                    className="input input-xs input-bordered"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <button
                                    className="btn btn-xs btn-primary"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSaveFollowUp(lead);
                                    }}
                                  >
                                    Save
                                  </button>
                                  <button
                                    className="btn btn-xs btn-ghost"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCancelEditFollowUp();
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                  <span className="text-sm font-bold text-gray-800">
                                    {lead.next_followup ? new Date(lead.next_followup).toLocaleDateString() : 'N/A'}
                                  </span>
                                  <button
                                    className="btn btn-xs btn-ghost"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleEditFollowUp(lead);
                                    }}
                                    title="Edit follow-up date"
                                  >
                                    <PencilSquareIcon className="w-4 h-4" style={{ color: '#3E28CD' }} />
                                  </button>
                                  <button
                                    className="btn btn-xs btn-ghost text-error"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteFollowUp(lead);
                                    }}
                                    title="Delete follow-up"
                                  >
                                    <TrashIcon className="w-4 h-4" style={{ color: '#3E28CD' }} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
              );
            }
            
            // Card View (Mobile default, Desktop optional)
            return (
              <>
                {/* Desktop Card Grid View */}
                <div className="hidden md:grid grid-cols-2 lg:grid-cols-3 gap-6">
                  {currentLeads.map((lead) => {
                    const daysOverdue = lead.next_followup ? Math.floor((new Date().getTime() - new Date(lead.next_followup).getTime()) / (1000 * 3600 * 24)) : 0;
                    return (
                      <div 
                        key={lead.id} 
                        className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 border border-red-100 group flex flex-col justify-between min-h-[340px] relative cursor-pointer"
                        onClick={() => {
                          if (lead.lead_type === 'legacy') {
                            // For legacy leads, remove "legacy_" prefix and navigate to legacy-{id}
                            const legacyId = lead.id?.toString().replace('legacy_', '');
                            navigate(`/clients/legacy-${legacyId}`);
                          } else {
                            // For new leads, use lead_number instead of id
                            navigate(`/clients/${lead.lead_number}`);
                          }
                        }}
                      >
                        <div className="flex-1 flex flex-col">
                          {/* Lead Number and Name */}
                          <div className="mb-3 flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-400 tracking-widest">
                              {lead.lead_number}
                              {lead.lead_type === 'legacy' && <span className="text-sm text-gray-500 ml-1">(L)</span>}
                            </span>
                            <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                            <h3 className="text-xl font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{lead.name}</h3>
                            {followUpTab === 'today' && (
                              <span className="text-sm font-bold px-2 py-1 rounded bg-green-600 text-white">Today</span>
                            )}
                            {followUpTab === 'tomorrow' && (
                              <span className="text-sm font-bold px-2 py-1 rounded bg-blue-600 text-white">Tomorrow</span>
                            )}
                          </div>
                          {/* Stage */}
                          <div className="flex justify-between items-center py-1">
                            <span className="text-sm font-semibold text-gray-500">Stage</span>
                            <span className="text-sm font-bold text-black">
                              {lead.stage_name || 'Follow-up Required'}
                            </span>
                          </div>
                          <div className="space-y-2 divide-y divide-gray-100 mt-2">
                            {/* Category */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Category</span>
                              <span className="text-sm font-bold text-gray-800">
                                {lead.lead_type === 'legacy' ? lead.category_name : (lead.category_name || lead.category || 'Not specified')}
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
                                {lead.expert_name || 'Not assigned'}
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
                                {lead.manager_name || 'Not assigned'}
                              </span>
                            </div>
                            {/* Probability */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Probability</span>
                              <span className="text-sm font-bold text-gray-800">{lead.probability || 0}%</span>
                            </div>
                            {/* Follow-up Date */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Follow-up Date</span>
                              {editingFollowUpId === lead.follow_up_id ? (
                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="date"
                                    value={editFollowUpDate}
                                    onChange={(e) => setEditFollowUpDate(e.target.value)}
                                    className="input input-xs input-bordered"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <button
                                    className="btn btn-xs btn-primary"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSaveFollowUp(lead);
                                    }}
                                  >
                                    Save
                                  </button>
                                  <button
                                    className="btn btn-xs btn-ghost"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCancelEditFollowUp();
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                  <span className="text-sm font-bold text-gray-800">
                                    {lead.next_followup ? new Date(lead.next_followup).toLocaleDateString() : 'N/A'}
                                  </span>
                                  <button
                                    className="btn btn-xs btn-ghost"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleEditFollowUp(lead);
                                    }}
                                    title="Edit follow-up date"
                                  >
                                    <PencilSquareIcon className="w-4 h-4" style={{ color: '#3E28CD' }} />
                                  </button>
                                  <button
                                    className="btn btn-xs btn-ghost text-error"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteFollowUp(lead);
                                    }}
                                    title="Delete follow-up"
                                  >
                                    <TrashIcon className="w-4 h-4" style={{ color: '#3E28CD' }} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Mobile Card View */}
                <div className="md:hidden space-y-4">
                  {currentLeads.map((lead) => {
                    const daysOverdue = lead.next_followup ? Math.floor((new Date().getTime() - new Date(lead.next_followup).getTime()) / (1000 * 3600 * 24)) : 0;
                    return (
                      <div 
                        key={lead.id} 
                        className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 border border-red-100 group flex flex-col justify-between min-h-[340px] relative cursor-pointer"
                        onClick={() => {
                          if (lead.lead_type === 'legacy') {
                            // For legacy leads, remove "legacy_" prefix and navigate to legacy-{id}
                            const legacyId = lead.id?.toString().replace('legacy_', '');
                            navigate(`/clients/legacy-${legacyId}`);
                          } else {
                            // For new leads, use lead_number instead of id
                            navigate(`/clients/${lead.lead_number}`);
                          }
                        }}
                      >
                        <div className="flex-1 flex flex-col">
                          {/* Lead Number and Name */}
                          <div className="mb-3 flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-400 tracking-widest">
                              {lead.lead_number}
                              {lead.lead_type === 'legacy' && <span className="text-sm text-gray-500 ml-1">(L)</span>}
                            </span>
                            <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                            <h3 className="text-xl font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{lead.name}</h3>
                            {followUpTab === 'today' && (
                              <span className="text-sm font-bold px-2 py-1 rounded bg-green-600 text-white">Today</span>
                            )}
                            {followUpTab === 'tomorrow' && (
                              <span className="text-sm font-bold px-2 py-1 rounded bg-blue-600 text-white">Tomorrow</span>
                            )}
                          </div>
                          {/* Stage */}
                          <div className="flex justify-between items-center py-1">
                            <span className="text-sm font-semibold text-gray-500">Stage</span>
                            <span className="text-sm font-bold text-black">
                              {lead.stage_name || 'Follow-up Required'}
                            </span>
                          </div>
                          <div className="space-y-2 divide-y divide-gray-100 mt-2">
                            {/* Category */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Category</span>
                              <span className="text-sm font-bold text-gray-800">
                                {lead.lead_type === 'legacy' ? lead.category_name : (lead.category_name || lead.category || 'Not specified')}
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
                                {lead.expert_name || 'Not assigned'}
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
                                {lead.manager_name || 'Not assigned'}
                              </span>
                            </div>
                            {/* Probability */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Probability</span>
                              <span className="text-sm font-bold text-gray-800">{lead.probability || 0}%</span>
                            </div>
                            {/* Follow-up Date */}
                            <div className="flex justify-between items-center py-1">
                              <span className="text-sm font-semibold text-gray-500">Follow-up Date</span>
                              {editingFollowUpId === lead.follow_up_id ? (
                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="date"
                                    value={editFollowUpDate}
                                    onChange={(e) => setEditFollowUpDate(e.target.value)}
                                    className="input input-xs input-bordered"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <button
                                    className="btn btn-xs btn-primary"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSaveFollowUp(lead);
                                    }}
                                  >
                                    Save
                                  </button>
                                  <button
                                    className="btn btn-xs btn-ghost"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCancelEditFollowUp();
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                  <span className="text-sm font-bold text-gray-800">
                                    {lead.next_followup ? new Date(lead.next_followup).toLocaleDateString() : 'N/A'}
                                  </span>
                                  <button
                                    className="btn btn-xs btn-ghost"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleEditFollowUp(lead);
                                    }}
                                    title="Edit follow-up date"
                                  >
                                    <PencilSquareIcon className="w-4 h-4" style={{ color: '#3E28CD' }} />
                                  </button>
                                  <button
                                    className="btn btn-xs btn-ghost text-error"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteFollowUp(lead);
                                    }}
                                    title="Delete follow-up"
                                  >
                                    <TrashIcon className="w-4 h-4" style={{ color: '#3E28CD' }} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
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
      <div className="flex flex-col md:flex-row mb-6 md:mb-10 w-full relative transition-all duration-500 ease-in-out md:items-start gap-4 md:gap-0">
        {/* AI Suggestions Box */}
        {!aiContainerCollapsed && (
        <div 
          ref={aiRef} 
          className={`bg-white border border-gray-200 rounded-2xl p-4 shadow-lg flex flex-col transition-all duration-500 ease-in-out w-full md:w-1/5 opacity-100 md:overflow-hidden`}
          style={aiHeight ? { height: `${aiHeight}px`, minHeight: `${aiHeight}px`, maxHeight: `${aiHeight}px` } : undefined}
        >
          <div className="flex justify-between items-center mb-4 flex-shrink-0">
            <h3 className="text-lg font-semibold text-gray-900">AI Assistant</h3>
            <button
              onClick={() => setAiContainerCollapsed(true)}
              className="btn btn-ghost btn-sm text-gray-500 hover:text-gray-700 transition-colors"
              title="Close AI Assistant"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
          {/* On mobile: no flex-1, let content determine height. On desktop: flex-1 with scroll */}
          <div className="md:flex-1 md:overflow-y-auto md:min-h-0 scrollbar-hide" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            <style>{`
              .scrollbar-hide::-webkit-scrollbar {
                display: none;
              }
            `}</style>
            <AISuggestions />
          </div>
        </div>
        )}
        
        {/* Professional CRM Scoreboard */}
        <div 
          ref={performanceDashboardRef}
          className={`bg-white border border-gray-200 rounded-2xl shadow-lg transition-all duration-500 ease-in-out ${
            aiContainerCollapsed ? 'w-full' : 'w-full md:w-4/5'
          } ${aiContainerCollapsed ? 'ml-0' : 'md:ml-8'}`}
        >
          <div className="p-8">
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
                                  
                  {/* Mobile comparison blocks */}
                  {departmentPerformanceLoading ? (
                    <div className="flex justify-center items-center py-12 md:hidden">
                      <span className="loading loading-spinner loading-lg text-primary"></span>
                    </div>
                  ) : (
                    <div className="md:hidden space-y-4">
                      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-800">Compare periods</div>
                            <p className="text-xs text-gray-500">Add or remove rows to compare each department</p>
                          </div>
                          {mobilePeriodRows.length > 1 && (
                            <button
                              className="btn btn-ghost btn-xs"
                              onClick={() => setMobilePeriodRows([{ id: 'row-today', period: 'today' }])}
                            >
                              Reset
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {mobilePeriodOptions.map((option) => {
                            const isActive = mobilePeriodRows.some((row) => row.period === option.period);
                            return (
                              <button
                                key={option.period}
                                className={`btn btn-xs ${isActive ? 'btn-primary' : 'btn-outline'}`}
                                onClick={() => toggleMobilePeriodRow(option.period)}
                              >
                                {isActive ? `Remove ${option.label}` : `Add ${option.label}`}
                              </button>
                            );
                          })}
                        </div>
                        {mobilePeriodRows.some((row) => row.period === 'currentMonth') && (
                          <div className="flex items-center gap-2 mt-3 text-xs text-gray-600">
                            <span className="font-semibold text-gray-700">Month:</span>
                            <select
                              className="select select-xs select-bordered w-auto"
                              value={selectedMonth}
                              onChange={(e) => setSelectedMonth(e.target.value)}
                            >
                              {months.map((month) => (
                                <option key={month} value={month}>{month}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        <div className="-mx-2 overflow-x-auto pb-2 mt-2">
                          <div className="flex flex-col gap-3 px-2 min-w-max">
                            {mobilePeriodRows.map((row) => {
                              const periodInfo = getMobilePeriodInfo(row.period);
                              return (
                                <div key={row.id} className="rounded-2xl border border-gray-100 bg-white shadow-sm">
                                  <div className="flex gap-3 px-4 py-2 items-center border-b border-gray-100 text-xs text-gray-600">
                                    <div className="flex items-center gap-2">
                                      <div className={`w-2 h-2 rounded-full ${periodInfo.dotColor}`}></div>
                                      <span className="font-semibold text-slate-800 uppercase tracking-wide">{periodInfo.label}</span>
                                    </div>
                                    {mobilePeriodRows.length > 1 && (
                                      <button
                                        className="btn btn-ghost btn-xs"
                                        onClick={() => toggleMobilePeriodRow(row.period)}
                                      >
                                        Remove
                                      </button>
                                    )}
                                  </div>
                                  <div className="flex gap-3 px-4 py-3 flex-nowrap">
                                    {mobileCategories.map((category) => {
                                      const periodData = getMobilePeriodData(row.period, category);
                                      const cardKey = `${row.id}-${category}`;
                                      const isFlipped = flippedCards.has(cardKey);
                                      const percentage = periodData.expected > 0
                                        ? Math.min(100, Math.round((periodData.amount / periodData.expected) * 100))
                                        : 0;
                                      const chartData = departmentChartData[category] || [];

                                      return (
                                        <div
                                          key={cardKey}
                                          className="relative h-64 min-w-[260px] flex-shrink-0"
                                          style={{ perspective: '1000px' }}
                                        >
                                          <div
                                            className="relative w-full h-full transition-transform duration-700 cursor-pointer"
                                            style={{ transformStyle: 'preserve-3d', transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
                                            onClick={() => handleCardFlip(cardKey)}
                                          >
                                            <div
                                              className="absolute inset-0 bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden"
                                              style={{ backfaceVisibility: 'hidden', transform: 'rotateY(0deg)' }}
                                            >
                                              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                                                <h4 className="text-sm font-semibold text-slate-800">{category}</h4>
                                                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{periodInfo.label}</span>
                                              </div>
                                              <div className="p-4">
                                                <div className={`bg-gradient-to-br ${periodInfo.gradient} rounded-lg p-4 border border-opacity-20 shadow-md`}>
                                                  <div className="flex items-center gap-2 mb-3">
                                                    <div className={`w-2.5 h-2.5 ${periodInfo.dotColor} rounded-full shadow-sm`}></div>
                                                    <span className="text-xs font-semibold text-white uppercase tracking-wide">{periodInfo.label}</span>
                                                  </div>
                                                  <div className="space-y-2">
                                                    <div>
                                                      <div className="text-2xl font-bold text-white mb-1">{periodData.count}</div>
                                                      <div className="text-xs font-medium text-white/90">Contracts</div>
                                                    </div>
                                                    <div className="pt-2 border-t border-white/20">
                                                      <div className="text-lg font-bold text-white mb-1">₪{periodData.amount ? Math.ceil(periodData.amount).toLocaleString() : '0'}</div>
                                                      <div className="text-xs font-medium text-white/90">Amount</div>
                                                    </div>
                                                    {row.period === 'target' ? (
                                                      <div className="pt-2 border-t border-white/20">
                                                        <div className="flex items-center justify-between mb-1">
                                                          <span className="text-xs font-medium text-white/90">Progress</span>
                                                          <span className="text-xs font-bold text-white">{percentage}%</span>
                                                        </div>
                                                        <div className="w-full bg-white/20 rounded-full h-2 overflow-hidden">
                                                          <div className="h-full bg-white rounded-full transition-all duration-500" style={{ width: `${percentage}%` }}></div>
                                                        </div>
                                                        <div className="text-xs font-medium text-white/80 mt-1">Target: ₪{periodData.expected ? Math.ceil(periodData.expected).toLocaleString() : '0'}</div>
                                                      </div>
                                                    ) : (
                                                      periodData.expected > 0 && (
                                                        <div className="pt-2 border-t border-white/20">
                                                          <div className="flex items-center justify-between mb-1">
                                                            <span className="text-xs font-medium text-white/90">Target</span>
                                                            <span className="text-xs font-bold text-white">₪{Math.ceil(periodData.expected).toLocaleString()}</span>
                                                          </div>
                                                          <div className="w-full bg-white/20 rounded-full h-2 overflow-hidden mt-1">
                                                            <div className="h-full bg-white rounded-full transition-all duration-500" style={{ width: `${percentage}%` }}></div>
                                                          </div>
                                                        </div>
                                                      )
                                                    )}
                                                  </div>
                                                </div>
                                              </div>
                                            </div>
                                            <div
                                              className={`absolute inset-0 bg-gradient-to-br ${periodInfo.gradient} rounded-xl border border-opacity-30 shadow-lg overflow-hidden`}
                                              style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
                                            >
                                              <div className="px-4 py-3 bg-white/10 border-b border-white/20 flex items-center justify-between">
                                                <h4 className="text-sm font-semibold text-white">{category}</h4>
                                                <span className="text-[10px] font-semibold uppercase tracking-wide text-white/80">{periodInfo.label}</span>
                                              </div>
                                              <div className="p-4 h-full">
                                                <div className="w-full h-40" style={{ minWidth: '200px', minHeight: '160px' }}>
                                                  {chartData && chartData.length > 0 ? (
                                                    <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={160}>
                                                      <LineChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                                                        <XAxis
                                                          dataKey="date"
                                                          tick={{ fontSize: 10, fill: 'white' }}
                                                          axisLine={{ stroke: 'white' }}
                                                          tickLine={{ stroke: 'white' }}
                                                          interval={Math.floor(chartData.length / 6)}
                                                        />
                                                        <YAxis
                                                          tick={{ fontSize: 10, fill: 'white' }}
                                                          axisLine={{ stroke: 'white' }}
                                                          tickLine={{ stroke: 'white' }}
                                                          width={40}
                                                        />
                                                        <Tooltip contentStyle={{ backgroundColor: 'rgba(15,23,42,0.9)', border: 'none' }} />
                                                        <Line type="monotone" dataKey="contracts" stroke="#fff" strokeWidth={2} dot={false} />
                                                      </LineChart>
                                                    </ResponsiveContainer>
                                                  ) : (
                                                    <div className="flex items-center justify-center h-full text-white/70 text-xs">
                                                      No trend data yet
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
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
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

      {/* Team Availability and Calendar Section */}
      <div className="w-full mt-12">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
          {/* Team Availability Section */}
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 px-6 py-4 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-tr from-purple-500 to-blue-600 rounded-lg flex items-center justify-center">
                <UserGroupIcon className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Team Availability</h2>
                <p className="text-sm text-gray-500">
                  Employees unavailable on {getDateDescription(teamAvailabilityDate)}
                </p>
              </div>
            </div>
            
            {/* Center: Department Filter - Dropdown */}
            <div className="flex items-center justify-center flex-1">
              <div className="relative">
                <select
                  className="select select-bordered select-sm w-48"
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                >
                  <option value="">All Departments</option>
                  {availableDepartments.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const currentDate = new Date(teamAvailabilityDate + 'T00:00:00');
                  currentDate.setDate(currentDate.getDate() - 1);
                  const year = currentDate.getFullYear();
                  const month = String(currentDate.getMonth() + 1).padStart(2, '0');
                  const day = String(currentDate.getDate()).padStart(2, '0');
                  setTeamAvailabilityDate(`${year}-${month}-${day}`);
                }}
                className="btn btn-sm btn-ghost btn-circle"
                title="Previous day"
              >
                <ChevronLeftIcon className="w-5 h-5" />
              </button>
              <CalendarIcon className="w-5 h-5 text-gray-500" />
              <input
                type="date"
                className="input input-bordered input-sm"
                value={teamAvailabilityDate}
                onChange={(e) => setTeamAvailabilityDate(e.target.value)}
                title="Select date to check availability"
              />
              <button
                type="button"
                onClick={() => {
                  const currentDate = new Date(teamAvailabilityDate + 'T00:00:00');
                  currentDate.setDate(currentDate.getDate() + 1);
                  const year = currentDate.getFullYear();
                  const month = String(currentDate.getMonth() + 1).padStart(2, '0');
                  const day = String(currentDate.getDate()).padStart(2, '0');
                  setTeamAvailabilityDate(`${year}-${month}-${day}`);
                }}
                className="btn btn-sm btn-ghost btn-circle"
                title="Next day"
              >
                <ChevronRightIcon className="w-5 h-5" />
              </button>
            </div>
          </div>
          
          {/* Employee Cards */}
          {unavailableEmployeesLoading ? (
            <div className="flex justify-center items-center py-8 px-6">
              <div className="loading loading-spinner loading-lg text-gray-600"></div>
            </div>
          ) : unavailableEmployeesData.length > 0 ? (
            <div className="px-6 pb-6 pt-6">
              <div className="flex overflow-x-auto gap-5 pb-4 -mx-6 px-6 sm:grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 sm:overflow-x-visible sm:pb-0 sm:-mx-0 sm:px-0">
                {unavailableEmployeesData
                  .filter((item) => {
                    if (!departmentFilter.trim()) return true;
                    return item.department?.toLowerCase().includes(departmentFilter.toLowerCase());
                  })
                  .map((item) => {
                  const employeeInitials = item.employeeName
                    .split(' ')
                    .map((n: string) => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2);
                  
                  return (
                    <div
                      key={item.id}
                      className="relative overflow-hidden rounded-xl border-2 border-gray-300 bg-white min-h-[200px] flex-shrink-0 w-[280px] sm:w-auto sm:min-w-0"
                      style={{
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
                      }}
                    >
                      {/* Background Image with Overlay */}
                      {item.photo && (
                        <div 
                          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
                          style={{ backgroundImage: `url(${item.photo})` }}
                        >
                          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black/70"></div>
                        </div>
                      )}
                      
                      {/* Role Badge - Top Right Corner */}
                      {item.role && (
                        <div className="absolute top-2 right-2 z-20">
                          <span className="badge badge-sm px-2 py-1 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-0 text-xs font-semibold shadow-lg">
                            {item.role}
                          </span>
                        </div>
                      )}
                      
                      {/* Content */}
                      <div className={`relative z-10 p-4 flex flex-col h-full ${item.photo ? 'text-white' : 'text-gray-900'}`}>
                        {/* Top Row: Profile Image (Left), Time Range (Center), Role Badge (Right - already positioned) */}
                        <div className="flex items-start justify-between mb-2">
                          {/* Left Side: Profile Image and Name */}
                          <div className="flex-shrink-0 flex flex-col items-center">
                            {/* Profile Image or Initials Circle */}
                            {item.photo_url ? (
                              <img
                                src={item.photo_url}
                                alt={item.employeeName}
                                className="w-20 h-20 rounded-full object-cover shadow-lg mb-1.5"
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement;
                                  const targetParent = target.parentElement;
                                  if (targetParent) {
                                    target.style.display = 'none';
                                    const fallback = document.createElement('div');
                                    fallback.className = `w-20 h-20 rounded-full flex items-center justify-center shadow-lg mb-1.5 ${item.photo ? 'bg-primary/90' : 'bg-primary'} text-white text-base font-bold`;
                                    fallback.textContent = employeeInitials;
                                    targetParent.insertBefore(fallback, target);
                                  }
                                }}
                              />
                            ) : (
                              <div className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg mb-1.5 ${item.photo ? 'bg-primary/90' : 'bg-primary'} text-white text-base font-bold`}>
                                {employeeInitials}
                              </div>
                            )}
                            {/* Employee Name - Always shown under the circle */}
                            <h4 className={`text-sm font-semibold text-center truncate max-w-[80px] ${item.photo ? 'text-white drop-shadow-lg' : 'text-gray-900'}`}>
                              {item.employeeName}
                            </h4>
                          </div>
                          
                          {/* Spacer for right side (role badge) */}
                          <div className="w-16 flex-shrink-0"></div>
                        </div>
                        
                        {/* Center: Time Range - Moved lower */}
                        <div className="flex-1 text-center px-2 mb-3">
                          {item.time && (
                            <div className={`text-sm font-semibold ${item.photo ? 'text-white' : 'text-gray-800'}`}>
                              {item.time}
                            </div>
                          )}
                          {/* Date Range - only if it's a range */}
                          {item.date && item.date.includes('to') && (
                            <div className={`text-xs font-medium mt-1 ${item.photo ? 'text-white/90' : 'text-gray-700'}`}>
                              {item.date}
                            </div>
                          )}
                        </div>
                        
                        {/* Department */}
                        <div className="text-center mb-3">
                          <div className={`text-sm font-medium ${item.photo ? 'text-white/90' : 'text-gray-600'}`}>
                            {item.department}
                          </div>
                        </div>
                        
                        {/* Reason */}
                        <div className={`border-t-2 pt-3 mt-auto ${item.photo ? 'border-white/30' : 'border-gray-300'}`}>
                          {item.reason && (
                            <div className={`text-sm text-center px-2 py-1 rounded-md truncate ${item.photo ? 'text-white/90 bg-white/20' : 'text-gray-600 bg-gray-100'}`} title={item.reason}>
                              {item.reason}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    );
                  })}
              </div>
            </div>
          ) : (
            <div className="px-6 pb-6 pt-8 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="p-3 bg-green-100 rounded-full">
                  <CheckCircleIcon className="w-8 h-8 text-green-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">All Team Members Available</h3>
                  <p className="text-gray-600">
                    No employees are unavailable on {getDateDescription(teamAvailabilityDate)}. Great job team!
                  </p>
                </div>
              </div>
            </div>
          )}
          </div>
          
          {/* My Availability Calendar - Desktop Only */}
          <div className="hidden lg:block">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6 h-full">
              <MyAvailabilitySection onAvailabilityChange={() => fetchUnavailableEmployeesData(teamAvailabilityDate)} />
            </div>
          </div>
        </div>
      </div>

      {/* 3. Employee Scoreboard Component */}
      <EmployeeScoreboard />

      {/* Closed deals without Payments plan Box */}
      <div className="w-full mt-12">
        <ClosedDealsWithoutPaymentPlanWidget maxItems={10} />
      </div>

      {/* My Waiting Leads Box */}
      <div className="w-full mt-12">
        <WaitingForPriceOfferMyLeadsWidget maxItems={10} />
      </div>

      {/* 4. My Performance Graph (Full Width) */}
      <div className="w-full mt-12">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 w-full max-w-full">
          <div className="p-8">
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
              <div className="w-full h-72 bg-white" style={{ minWidth: '400px', minHeight: '288px' }}>
                {performanceData && performanceData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={400} minHeight={288}>
                    <LineChart data={performanceData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
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
      {showLeadsList && (
        <div className="glass-card mt-6 p-6 shadow-lg rounded-2xl w-full max-w-full animate-fade-in">
          <div className="font-bold text-lg mb-4 text-base-content/80">My Signed Leads (Last 30 Days)</div>
          {realLeadsLoading ? (
            <div className="flex justify-center items-center py-12"><span className="loading loading-spinner loading-lg text-primary"></span></div>
          ) : realSignedLeads.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No signed leads found in the last 30 days</div>
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th>Lead Number + Client Name</th>
                      <th>Category</th>
                      <th>Signed Agreement Date</th>
                      <th>Applicants</th>
                      <th>Value (Amount)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {realSignedLeads.map((lead) => (
                      <tr 
                        key={lead.id} 
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => window.location.href = `/clients/${lead.lead_number}`}
                      >
                        <td>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-gray-400 tracking-widest">{lead.lead_number}</span>
                            <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                            <span className="font-semibold text-gray-900">{lead.name}</span>
                          </div>
                        </td>
                        <td>{lead.category}</td>
                        <td>{lead.signed_date ? new Date(lead.signed_date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'N/A'}</td>
                        <td>{lead.applicants}</td>
                        <td className="font-semibold text-green-600">
                          {(lead.currency === 'NIS' ? '₪' : (lead.currency || '₪'))}{lead.value ? Number(lead.value).toLocaleString() : '0'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile Card View */}
              <div className="md:hidden flex flex-col gap-4">
                {realSignedLeads.map((lead) => (
                  <div
                    key={lead.id}
                    className="bg-white rounded-xl p-4 shadow-md border border-gray-100 cursor-pointer hover:shadow-lg transition-shadow"
                    onClick={() => window.location.href = `/clients/${lead.lead_number}`}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-semibold text-gray-400 tracking-widest">{lead.lead_number}</span>
                      <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                      <span className="font-semibold text-gray-900 flex-1">{lead.name}</span>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Category:</span>
                        <span className="font-semibold">{lead.category}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Signed Date:</span>
                        <span className="font-semibold">{lead.signed_date ? new Date(lead.signed_date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'N/A'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Applicants:</span>
                        <span className="font-semibold">{lead.applicants}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Value:</span>
                        <span className="font-semibold text-green-600">
                          {(lead.currency === 'NIS' ? '₪' : (lead.currency || '₪'))}{lead.value ? Number(lead.value).toLocaleString() : '0'}
                        </span>
                      </div>
                    </div>
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

export default Dashboard;
