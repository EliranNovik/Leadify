import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Link, useNavigate } from 'react-router-dom';
import { AcademicCapIcon, MagnifyingGlassIcon, CalendarIcon, ChevronUpIcon, ChevronDownIcon, ChevronRightIcon, XMarkIcon, UserIcon, ChatBubbleLeftRightIcon, FolderIcon, ChartBarIcon, PhoneIcon, EnvelopeIcon, ClockIcon, PencilSquareIcon, EyeIcon, Squares2X2Icon, Bars3Icon } from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import { format, parseISO } from 'date-fns';
import DocumentModal from './DocumentModal';
import EditLeadDrawer from './EditLeadDrawer';
import SchedulerWhatsAppModal from './SchedulerWhatsAppModal';
import SchedulerEmailThreadModal from './SchedulerEmailThreadModal';
import { BarChart3, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { getStageName, initializeStageNames, getStageColour } from '../lib/stageUtils';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';

// Helper function to format currency amount
const formatAmount = (amount: number | null | undefined, currency: string | null | undefined): string => {
  if (amount === null || amount === undefined) return 'N/A';
  const currencySymbol = currency || '₪';
  return `${currencySymbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};

// Helper function to get display value (prefer balance, fallback to proposal_total)
const getDisplayValue = (lead: LeadForExpert): string => {
  if (lead.balance !== null && lead.balance !== undefined) {
    return formatAmount(lead.balance, lead.balance_currency);
  }
  if (lead.proposal_total !== null && lead.proposal_total !== undefined) {
    return formatAmount(lead.proposal_total, lead.proposal_currency);
  }
  return 'N/A';
};

// Helper function to get meeting color based on date
const getMeetingColor = (meetingDateStr: string): string => {
  if (!meetingDateStr) return 'bg-gray-100 text-gray-600';
  
  // Extract date part
  const dateOnly = meetingDateStr.split(' ')[0];
  const meetingDate = new Date(dateOnly);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Set meeting date to start of day for comparison
  const meetingDateStart = new Date(meetingDate);
  meetingDateStart.setHours(0, 0, 0, 0);
  
  // Calculate difference in days
  const diffTime = meetingDateStart.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) {
    // Past meeting - red
    return 'bg-red-500 text-white';
  } else if (diffDays === 0) {
    // Today - green
    return 'bg-green-500 text-white';
  } else {
    // Tomorrow or more than 1 day away - yellow
    return 'bg-yellow-500 text-white';
  }
};

// Helper function to calculate days since expert was assigned (using created_at as proxy)
const getDaysSinceAssigned = (createdAt: string): number => {
  if (!createdAt) return 0;
  const createdDate = new Date(createdAt);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  createdDate.setHours(0, 0, 0, 0);
  const diffTime = today.getTime() - createdDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

const LABEL_OPTIONS = [
  'High Value',
  'Low Value',
  'Potential Clients',
  'High Risk',
  'Low Risk',
];

// Helper function to get contrasting text color based on background
const getContrastingTextColor = (hexColor?: string | null) => {
  if (!hexColor) return '#111827'; // Default to black if no color
  let sanitized = hexColor.trim();
  if (sanitized.startsWith('#')) sanitized = sanitized.slice(1);
  if (sanitized.length === 3) {
    sanitized = sanitized.split('').map(char => char + char).join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(sanitized)) {
    return '#111827';
  }
  const r = parseInt(sanitized.slice(0, 2), 16) / 255;
  const g = parseInt(sanitized.slice(2, 4), 16) / 255;
  const b = parseInt(sanitized.slice(4, 6), 16) / 255;

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.55 ? '#111827' : '#ffffff';
};

interface LeadForExpert {
  id: number | string;
  lead_number: string;
  name: string;
  created_at: string;
  expert?: string;
  topic?: string;
  handler_notes?: { content: string }[];
  meetings: { meeting_date: string }[];
  onedrive_folder_link?: string;
  expert_notes?: { content: string }[];
  stage?: string;
  probability?: number;
  number_of_applicants_meeting?: number;
  balance?: number | null;
  balance_currency?: string | null;
  proposal_total?: number | null;
  proposal_currency?: string | null;
  expert_comments?: { text: string; timestamp: string; user: string }[];
  label?: string | null;
  tags?: string[] | null;
  lead_type?: 'new' | 'legacy';
  highlighted_by?: string[];
  facts?: string | null;
}

const ExpertPage: React.FC = () => {
  const [leads, setLeads] = useState<LeadForExpert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMeetingDateFrom, setFilterMeetingDateFrom] = useState('');
  const [filterMeetingDateTo, setFilterMeetingDateTo] = useState('');
  const [sortColumn, setSortColumn] = useState<'created_at' | 'meeting_date' | 'probability' | 'applicants' | 'value' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [selectedLead, setSelectedLead] = useState<LeadForExpert | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
  const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [meetingSort, setMeetingSort] = useState<'upcoming' | 'past'>('upcoming');
  const [viewMode, setViewMode] = useState<'box' | 'list'>('list');
  const [newComment, setNewComment] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string | number>>(new Set());
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [editingComments, setEditingComments] = useState<Set<string | number>>(new Set());
  const [newCommentValues, setNewCommentValues] = useState<Record<string | number, string>>({});
  const [editingExpertNote, setEditingExpertNote] = useState<Record<string | number, { noteIdx: number; content: string }>>({});
  const [tagFilter, setTagFilter] = useState('');
  const [labelDropdownOpen, setLabelDropdownOpen] = useState<number | string | null>(null);
  const [labelSubmitting, setLabelSubmitting] = useState(false);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [highlightedLeads, setHighlightedLeads] = useState<LeadForExpert[]>([]);
  const [highlightPanelOpen, setHighlightPanelOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  
  // State for row selection and action menu
  const [selectedRowId, setSelectedRowId] = useState<string | number | null>(null);
  const [showActionMenu, setShowActionMenu] = useState(false);
  
  const navigate = useNavigate();
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [topExpertName, setTopExpertName] = useState<string>('N/A');
  const [showMyStatsModal, setShowMyStatsModal] = useState(false);
  const [expertStats, setExpertStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [realSummaryStats, setRealSummaryStats] = useState<{
    totalArchivalChecks: number;
    topExpertId: number | null;
    topExpertCount: number;
  }>({
    totalArchivalChecks: 0,
    topExpertId: null,
    topExpertCount: 0
  });

  // Fetch categories on component mount
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const { data, error } = await supabase
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
          .order('name', { ascending: true });
        
        if (error) {
          console.error('Error fetching categories:', error);
        } else {
          setAllCategories(data || []);
        }
      } catch (error) {
        console.error('Error fetching categories:', error);
      }
    };
    
    fetchCategories();
  }, []);

  // Fetch tags for dropdown from misc_leadtag table
  useEffect(() => {
    const fetchTags = async () => {
      try {
        const { data: tagsData, error: tagsError } = await supabase
          .from('misc_leadtag')
          .select('name')
          .eq('active', true)
          .order('name', { ascending: true });
        
        if (tagsError) {
          console.error('Error fetching tags:', tagsError);
        } else if (tagsData) {
          setAvailableTags(tagsData.map(t => t.name));
        }
      } catch (error) {
        console.error('Error fetching tags:', error);
      }
    };
    
    fetchTags();
  }, []);

  // Helper function to fetch tags for all leads
  const fetchTagsForLeads = async (leads: LeadForExpert[]) => {
    try {
      // Separate legacy and new leads
      const legacyLeadIds: number[] = [];
      const newLeadIds: string[] = [];
      
      leads.forEach(lead => {
        if (lead.lead_type === 'legacy') {
          const legacyId = typeof lead.id === 'string' ? parseInt(lead.id.replace('legacy_', '')) : lead.id;
          if (!isNaN(legacyId)) {
            legacyLeadIds.push(legacyId);
          }
        } else {
          if (typeof lead.id === 'string' && !lead.id.startsWith('legacy_')) {
            newLeadIds.push(lead.id);
          }
        }
      });

      // Fetch tags for legacy leads
      let legacyTagsMap = new Map<number, string[]>();
      if (legacyLeadIds.length > 0) {
        const { data: legacyTagsData } = await supabase
          .from('leads_lead_tags')
          .select(`
            lead_id,
            misc_leadtag (
              name
            )
          `)
          .in('lead_id', legacyLeadIds);
        
        if (legacyTagsData) {
          legacyTagsData.forEach(item => {
            if (item.misc_leadtag && item.lead_id) {
              const leadId = item.lead_id;
              const tagName = (item.misc_leadtag as any).name;
              
              if (!legacyTagsMap.has(leadId)) {
                legacyTagsMap.set(leadId, []);
              }
              legacyTagsMap.get(leadId)!.push(tagName);
            }
          });
        }
      }

      // Fetch tags for new leads
      let newTagsMap = new Map<string, string[]>();
      if (newLeadIds.length > 0) {
        const { data: newTagsData } = await supabase
          .from('leads_lead_tags')
          .select(`
            newlead_id,
            misc_leadtag (
              name
            )
          `)
          .in('newlead_id', newLeadIds);
        
        if (newTagsData) {
          newTagsData.forEach(item => {
            if (item.misc_leadtag && item.newlead_id) {
              const leadId = item.newlead_id;
              const tagName = (item.misc_leadtag as any).name;
              
              if (!newTagsMap.has(leadId)) {
                newTagsMap.set(leadId, []);
              }
              newTagsMap.get(leadId)!.push(tagName);
            }
          });
        }
      }

      // Attach tags to leads
      leads.forEach(lead => {
        if (lead.lead_type === 'legacy') {
          const legacyId = typeof lead.id === 'string' ? parseInt(lead.id.replace('legacy_', '')) : lead.id;
          if (!isNaN(legacyId)) {
            lead.tags = legacyTagsMap.get(legacyId) || [];
          }
        } else {
          if (typeof lead.id === 'string' && !lead.id.startsWith('legacy_')) {
            lead.tags = newTagsMap.get(lead.id) || [];
          }
        }
      });
    } catch (error) {
      console.error('Error fetching tags for leads:', error);
    }
  };

  // Fetch real summary statistics from database (last 30 days)
  const fetchRealSummaryStats = async () => {
    try {
      // Calculate date 30 days ago
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

      // Fetch new leads with eligibility_status (expert opinions) from last 30 days
      const { data: newLeadsWithOpinions, error: newLeadsError } = await supabase
        .from('leads')
        .select('id, expert, eligibility_status, created_at')
        .in('eligibility_status', ['feasible_no_check', 'feasible_check', 'not_feasible'])
        .gte('created_at', thirtyDaysAgoStr)
        .not('expert', 'is', null)
        .neq('expert', '---');

      if (newLeadsError) {
        console.error('Error fetching new leads for summary stats:', newLeadsError);
      }

      // Fetch legacy leads with expert_examination from last 30 days
      const { data: legacyLeadsWithOpinions, error: legacyLeadsError } = await supabase
        .from('leads_lead')
        .select('id, expert_id, expert_examination, cdate')
        .not('expert_examination', 'is', null)
        .neq('expert_examination', '0')
        .neq('expert_examination', '')
        .gte('cdate', thirtyDaysAgoStr)
        .not('expert_id', 'is', null);

      if (legacyLeadsError) {
        console.error('Error fetching legacy leads for summary stats:', legacyLeadsError);
      }

      // Count total archival checks (expert opinions) from both tables
      const newLeadsCount = (newLeadsWithOpinions || []).length;
      const legacyLeadsCount = (legacyLeadsWithOpinions || []).length;
      const totalArchivalChecks = newLeadsCount + legacyLeadsCount;

      // Count expert opinions by expert ID
      const expertCounts: Record<number, number> = {};

      // Count from new leads (expert is employee ID)
      (newLeadsWithOpinions || []).forEach((lead: any) => {
        const expertId = typeof lead.expert === 'number' ? lead.expert : parseInt(lead.expert);
        if (!isNaN(expertId) && expertId > 0) {
          expertCounts[expertId] = (expertCounts[expertId] || 0) + 1;
        }
      });

      // Count from legacy leads (expert_id is employee ID)
      (legacyLeadsWithOpinions || []).forEach((lead: any) => {
        const expertId = typeof lead.expert_id === 'number' ? lead.expert_id : parseInt(lead.expert_id);
        if (!isNaN(expertId) && expertId > 0) {
          expertCounts[expertId] = (expertCounts[expertId] || 0) + 1;
        }
      });

      // Find top expert
      let topExpertId: number | null = null;
      let topExpertCount = 0;

      Object.entries(expertCounts).forEach(([expertIdStr, count]) => {
        const expertId = parseInt(expertIdStr);
        if (count > topExpertCount) {
          topExpertCount = count;
          topExpertId = expertId;
        }
      });

      setRealSummaryStats({
        totalArchivalChecks,
        topExpertId,
        topExpertCount
      });

      // Fetch top expert name
      if (topExpertId) {
        const { data: employeeData, error: employeeError } = await supabase
          .from('tenants_employee')
          .select('id, display_name')
          .eq('id', topExpertId)
          .single();

        if (!employeeError && employeeData?.display_name) {
          setTopExpertName(employeeData.display_name);
        } else {
          setTopExpertName(`Employee ${topExpertId}`);
        }
      } else {
        setTopExpertName('N/A');
      }
    } catch (error) {
      console.error('Error fetching real summary stats:', error);
    }
  };

  // Fetch real summary stats on component mount
  useEffect(() => {
    fetchRealSummaryStats();
  }, []);

  // Fetch expert statistics
  const fetchExpertStats = async () => {
    setLoadingStats(true);
    try {
      // Get current user's employee ID
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('No user found');
        setLoadingStats(false);
        return;
      }

      // Get user's full name
      const { data: userData } = await supabase
        .from('users')
        .select('full_name')
        .eq('email', user.email)
        .single();

      const currentUserFullName = userData?.full_name;
      if (!currentUserFullName) {
        console.error('Could not find user full name');
        setLoadingStats(false);
        return;
      }

      // Get employee ID
      const { data: employeeData, error: employeeError } = await supabase
        .from('tenants_employee')
        .select('id')
        .eq('display_name', currentUserFullName)
        .single();

      if (employeeError || !employeeData) {
        console.error('Could not find employee ID:', employeeError);
        setLoadingStats(false);
        return;
      }

      const currentUserEmployeeId = employeeData.id;

      // Calculate date 30 days ago
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

      // Fetch new leads where user is expert with eligibility_status (from last 30 days)
      // New leads store examination in eligibility_status as text: 'feasible_no_check', 'feasible_check', 'not_feasible'
      const { data: newLeads, error: newLeadsError } = await supabase
        .from('leads')
        .select('id, eligibility_status, created_at')
        .eq('expert', currentUserEmployeeId)
        .in('eligibility_status', ['feasible_no_check', 'feasible_check', 'not_feasible'])
        .gte('created_at', thirtyDaysAgoStr);

      if (newLeadsError) {
        console.error('Error fetching new leads:', newLeadsError);
      }

      // Fetch legacy leads with expert_examination from last 30 days
      // Legacy leads store examination in expert_examination as numeric: 8, 5, 1
      const { data: legacyLeads, error: legacyError } = await supabase
        .from('leads_lead')
        .select('id, expert_examination, cdate')
        .eq('expert_id', currentUserEmployeeId)
        .not('expert_examination', 'is', null)
        .neq('expert_examination', '0')
        .neq('expert_examination', '')
        .gte('cdate', thirtyDaysAgoStr);

      if (legacyError) {
        console.error('Error fetching legacy leads:', legacyError);
        setLoadingStats(false);
        return;
      }

      // Count feasibility types from both new and legacy leads
      const feasibilityCounts = {
        noFeasibility: 0,      // "1" or "not_feasible"
        feasibleFurtherCheck: 0, // "5" or "feasible_check"
        feasibleNoCheck: 0     // "8" or "feasible_no_check"
      };

      // Count from new leads (eligibility_status as text)
      (newLeads || []).forEach((lead: any) => {
        const eligibilityStatus = lead.eligibility_status;
        if (eligibilityStatus) {
          switch (eligibilityStatus) {
            case 'not_feasible':
              feasibilityCounts.noFeasibility++;
              break;
            case 'feasible_check':
              feasibilityCounts.feasibleFurtherCheck++;
              break;
            case 'feasible_no_check':
              feasibilityCounts.feasibleNoCheck++;
              break;
          }
        }
      });

      // Count from legacy leads (expert_examination as numeric string)
      (legacyLeads || []).forEach((lead: any) => {
        const examinationValue = String(lead.expert_examination);
        switch (examinationValue) {
          case "1":
            feasibilityCounts.noFeasibility++;
            break;
          case "5":
            feasibilityCounts.feasibleFurtherCheck++;
            break;
          case "8":
            feasibilityCounts.feasibleNoCheck++;
            break;
        }
      });

      // Total opinions = sum of all three types
      const totalOpinions = feasibilityCounts.noFeasibility + feasibilityCounts.feasibleFurtherCheck + feasibilityCounts.feasibleNoCheck;

      setExpertStats({
        totalOpinions,
        noFeasibility: feasibilityCounts.noFeasibility,
        feasibleFurtherCheck: feasibilityCounts.feasibleFurtherCheck,
        feasibleNoCheck: feasibilityCounts.feasibleNoCheck
      });
    } catch (error) {
      console.error('Error fetching expert stats:', error);
    } finally {
      setLoadingStats(false);
    }
  };

  // Fetch stats when modal opens
  useEffect(() => {
    if (showMyStatsModal) {
      fetchExpertStats();
    }
  }, [showMyStatsModal]);

  useEffect(() => {
    const fetchLeads = async () => {
      setIsLoading(true);
      try {
        // Initialize stage names cache first
        console.log('🔍 Initializing stage names cache...');
        await initializeStageNames();
        console.log('✅ Stage names cache initialized');
        
        // First, get the current user's full name from users table
        const { data: { user } } = await supabase.auth.getUser();
        let currentUserFullName: string | null = null;
        let currentUserEmployeeId: number | null = null;
        
        // Set user ID for highlighting
        setUserId(user?.id || null);
        
        if (user?.email) {
          // Get user's full name from users table
          const { data: userData, error: userError } = await supabase
            .from('users')
            .select('full_name')
            .eq('email', user.email)
            .single();
          
          if (!userError && userData?.full_name) {
            currentUserFullName = userData.full_name;
            console.log('Current user full name:', currentUserFullName);
            
            // Find the employee ID by matching full_name with display_name in tenants_employee
            const { data: employeeData, error: employeeError } = await supabase
              .from('tenants_employee')
              .select('id, display_name')
              .eq('display_name', currentUserFullName)
              .single();
            
            if (!employeeError && employeeData) {
              currentUserEmployeeId = employeeData.id;
              console.log('Found employee record:', employeeData);
            } else {
              console.log('Could not find employee record for user:', currentUserFullName, 'Error:', employeeError);
              
              // Fallback: try to find by partial match
              if (currentUserFullName && currentUserFullName.toLowerCase().includes('eliran')) {
                const { data: eliranEmployee, error: eliranError } = await supabase
                  .from('tenants_employee')
                  .select('id, display_name')
                  .ilike('display_name', '%eliran%')
                  .single();
                
                if (!eliranError && eliranEmployee) {
                  currentUserEmployeeId = eliranEmployee.id;
                  console.log('Found Eliran employee by partial match:', eliranEmployee);
                } else {
                  console.log('Could not find Eliran employee:', eliranError);
                }
              }
            }
          } else {
            console.log('Could not find user record for email:', user.email);
          }
        }

        // Fetch new leads (filter by expert field matching current user's full name)
        let newLeadsQuery = supabase
          .from('leads')
          .select(`
            id,
            lead_number,
            name,
            created_at,
            expert,
            topic,
            category_id,
            category,
            handler_notes,
            meetings (
              meeting_date
            ),
            onedrive_folder_link,
            expert_notes,
            facts,
            stage,
            probability,
            number_of_applicants_meeting,
            balance,
            balance_currency,
            proposal_total,
            proposal_currency,
            expert_page_comments,
            expert_page_label,
            expert_page_highlighted_by,
            misc_category!category_id(
              id,
              name,
              parent_id,
              misc_maincategory!parent_id(
                id,
                name
              )
            )
          `)
          .or('eligibility_status.is.null,eligibility_status.eq.""')
          .gte('stage', 20) // Only leads that have reached or passed stage 20 (Meeting scheduled)
          .lt('stage', 60) // Exclude leads that have already passed stage 60 (Client signed agreement)
          .neq('stage', 35); // Exclude stage 35 (Meeting irrelevant)

        // Filter new leads by expert field if we have user's employee ID
        // Note: For new leads, the 'expert' field stores an employee ID (number), not a display name
        if (currentUserEmployeeId) {
          newLeadsQuery = newLeadsQuery.eq('expert', currentUserEmployeeId);
          console.log('Filtering new leads by expert (employee ID):', currentUserEmployeeId);
        }

        const { data: newLeadsData, error: newLeadsError } = await newLeadsQuery.order('created_at', { ascending: false });

        if (newLeadsError) {
          console.error('Error fetching new leads:', newLeadsError);
          throw newLeadsError;
        }

        // Fetch legacy leads (filter by expert_id matching current user's employee ID)
        let legacyLeadsQuery = supabase
          .from('leads_lead')
          .select(`
            id,
            name,
            cdate,
            expert_id,
            topic,
            category_id,
            category,
            handler_notes,
            expert_notes,
            description,
            stage,
            probability,
            no_of_applicants,
            meeting_date,
            meeting_time,
            expert_examination,
            total_base,
            currency_id,
            proposal,
            expert_page_comments,
            expert_page_label,
            expert_page_highlighted_by,
            misc_category!category_id(
              id,
              name,
              parent_id,
              misc_maincategory!parent_id(
                id,
                name
              )
            )
          `)
          .eq('expert_examination', 0) // Only fetch leads where expert_examination is 0
          .gte('meeting_date', '2025-01-01') // Only fetch leads with meeting dates from 2025 onwards
          .gte('stage', 20) // Only leads that have reached or passed stage 20 (Meeting scheduled)
          .lt('stage', 60) // Exclude leads that have already passed stage 60 (Client signed agreement)
          .neq('stage', 35); // Exclude stage 35 (Meeting irrelevant)

        // Filter legacy leads by expert_id if we have the employee ID
        if (currentUserEmployeeId) {
          legacyLeadsQuery = legacyLeadsQuery.eq('expert_id', currentUserEmployeeId);
          console.log('Filtering legacy leads by expert_id:', currentUserEmployeeId);
        }

        const { data: legacyLeadsData, error: legacyLeadsError } = await legacyLeadsQuery.order('cdate', { ascending: false });

        if (legacyLeadsError) {
          console.error('Error fetching legacy leads:', legacyLeadsError);
          throw legacyLeadsError;
        }

        // Fetch employee names for legacy leads to display properly
        const expertIds = legacyLeadsData?.map(lead => lead.expert_id).filter(id => id !== null) || [];
        let employeeNameMap: Record<number, string> = {};
        
        if (expertIds.length > 0) {
          console.log('Fetching employee names for IDs:', expertIds);
          const { data: employeeData, error: employeeError } = await supabase
            .from('tenants_employee')
            .select('id, display_name')
            .in('id', expertIds);
          
          if (!employeeError && employeeData) {
            employeeNameMap = employeeData.reduce((acc, emp) => {
              acc[emp.id] = emp.display_name;
              return acc;
            }, {} as Record<number, string>);
            console.log('Employee name map created:', employeeNameMap);
          } else {
            console.error('Error fetching employee names:', employeeError);
          }
        }

        // Helper function to get category name from category_id
        const getCategoryName = (categoryId: string | number | null | undefined, fallbackCategory?: string) => {
          if (!categoryId || categoryId === '---') {
            // If no category_id but we have a fallback category, try to find it in the loaded categories
            if (fallbackCategory && fallbackCategory.trim() !== '') {
              const foundCategory = allCategories.find((cat: any) => 
                cat.name.toLowerCase().trim() === fallbackCategory.toLowerCase().trim()
              );
              
              if (foundCategory) {
                // Return category name with main category in parentheses
                if (foundCategory.misc_maincategory?.name) {
                  return `${foundCategory.name} (${foundCategory.misc_maincategory.name})`;
                } else {
                  return foundCategory.name;
                }
              } else {
                return fallbackCategory;
              }
            }
            return 'N/A';
          }
          
          // If allCategories is not loaded yet, return the original value
          if (!allCategories || allCategories.length === 0) {
            return String(categoryId);
          }
          
          // First try to find by ID
          const categoryById = allCategories.find((cat: any) => cat.id.toString() === categoryId.toString());
          if (categoryById) {
            // Return category name with main category in parentheses
            if (categoryById.misc_maincategory?.name) {
              return `${categoryById.name} (${categoryById.misc_maincategory.name})`;
            } else {
              return categoryById.name;
            }
          }
          
          return String(categoryId);
        };

        // Process new leads
        const processedNewLeads = (newLeadsData || []).map(lead => {
          // Get category name from category_id or joined data
          let categoryName = 'N/A';
          if (lead.misc_category) {
            // Use joined category data if available
            const cat = lead.misc_category as any;
            if (cat.misc_maincategory?.name) {
              categoryName = `${cat.name} (${cat.misc_maincategory.name})`;
            } else {
              categoryName = cat.name || 'N/A';
            }
          } else if (lead.category_id) {
            // Fallback to getCategoryName if no joined data
            categoryName = getCategoryName(lead.category_id, lead.category);
          } else if (lead.category) {
            categoryName = getCategoryName(null, lead.category);
          } else if (lead.topic) {
            categoryName = lead.topic;
          }
          
          return {
            ...lead,
            meetings: lead.meetings || [],
            expert_comments: lead.expert_page_comments || [],
            label: lead.expert_page_label || null,
            highlighted_by: lead.expert_page_highlighted_by || [],
            lead_type: 'new' as const,
            category: categoryName,
            topic: lead.topic || categoryName, // Keep topic for backward compatibility
            balance: lead.balance || null,
            balance_currency: lead.balance_currency || null,
            proposal_total: lead.proposal_total || null,
            proposal_currency: lead.proposal_currency || null
          };
        }).filter(lead => {
          // Filter new leads to only include those with meeting dates from 2025 onwards
          if (!lead.meetings || lead.meetings.length === 0) return false;
          const hasMeetingIn2025OrLater = lead.meetings.some(meeting => {
            const meetingDate = new Date(meeting.meeting_date);
            return meetingDate.getFullYear() >= 2025;
          });
          return hasMeetingIn2025OrLater;
        });

        // Process legacy leads
        const processedLegacyLeads = (legacyLeadsData || []).map(lead => {
          // Create meeting object for legacy leads using meeting_date and meeting_time
          const legacyMeetings = [];
          if (lead.meeting_date) {
            const meetingDate = lead.meeting_date;
            const meetingTime = lead.meeting_time || '';
            const combinedDateTime = meetingTime ? `${meetingDate} ${meetingTime}` : meetingDate;
            legacyMeetings.push({ meeting_date: combinedDateTime });
          }

          // Get category name for legacy leads (they use category_id)
          let categoryName = 'N/A';
          if (lead.misc_category) {
            // Use joined category data if available
            const cat = lead.misc_category as any;
            if (cat.misc_maincategory?.name) {
              categoryName = `${cat.name} (${cat.misc_maincategory.name})`;
            } else {
              categoryName = cat.name || 'N/A';
            }
          } else if (lead.category_id) {
            categoryName = getCategoryName(lead.category_id, lead.category);
          } else if (lead.category) {
            categoryName = getCategoryName(null, lead.category);
          } else if (lead.topic) {
            categoryName = lead.topic;
          }

          return {
            id: `legacy_${lead.id}`,
            lead_number: lead.id?.toString() || '',
            name: lead.name || '',
            created_at: lead.cdate || new Date().toISOString(),
            expert: lead.expert_id ? employeeNameMap[lead.expert_id] || `Employee ${lead.expert_id}` : null,
            topic: lead.topic || categoryName, // Keep topic for backward compatibility
            category: categoryName, // Add category field
            handler_notes: lead.handler_notes || [],
            meetings: legacyMeetings, // Use the constructed meetings array
            onedrive_folder_link: null,
            expert_notes: lead.expert_notes || [],
            facts: lead.description || null,
            stage: lead.stage?.toString() || '',
            probability: typeof lead.probability === 'string' ? parseFloat(lead.probability) : lead.probability,
            number_of_applicants_meeting: lead.no_of_applicants,
            balance: lead.total_base || null,
            balance_currency: lead.currency_id ? (lead.currency_id === 1 ? '₪' : lead.currency_id === 2 ? '€' : lead.currency_id === 3 ? '$' : lead.currency_id === 4 ? '£' : '₪') : null,
            proposal_total: lead.proposal || null,
            proposal_currency: lead.currency_id ? (lead.currency_id === 1 ? '₪' : lead.currency_id === 2 ? '€' : lead.currency_id === 3 ? '$' : lead.currency_id === 4 ? '£' : '₪') : null,
            expert_comments: lead.expert_page_comments || [],
            label: lead.expert_page_label || null,
            highlighted_by: lead.expert_page_highlighted_by || [],
            lead_type: 'legacy' as const
          };
        });

        // Combine and sort all leads by creation date
        const allLeads = [...processedNewLeads, ...processedLegacyLeads].sort((a, b) => 
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

        console.log('ExpertPage leads fetch:', { 
          newLeads: processedNewLeads.length, 
          legacyLeads: processedLegacyLeads.length,
          totalLeads: allLeads.length,
          currentUserFullName,
          currentUserEmployeeId,
          employeeNameMap
        });

        // Fetch tags for all leads
        await fetchTagsForLeads(allLeads as LeadForExpert[]);

        setLeads(allLeads as LeadForExpert[]);
      } catch (error) {
        console.error('Error fetching leads for expert page:', error);
        setLeads([]);
      }
      setIsLoading(false);
    };

    // Only fetch leads if categories are loaded (or if we don't need them)
    if (allCategories.length > 0 || true) { // Always fetch, but categories help with display
      fetchLeads();
    }
  }, [allCategories]);

  const filteredLeads = useMemo(() => {
    return leads.filter(lead => {
      const leadNameLower = lead.name.toLowerCase();
      const leadNumberLower = lead.lead_number.toLowerCase();
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = leadNameLower.includes(searchLower) || leadNumberLower.includes(searchLower);

      // Meeting date range filter
      let matchesMeetingRange = true;
      if (filterMeetingDateFrom || filterMeetingDateTo) {
        // Find the first meeting date (if any)
        const meetingDate = lead.meetings.length > 0 ? lead.meetings[0].meeting_date : '';
        if (meetingDate) {
          // Extract just the date part from the datetime string
          const dateOnly = meetingDate.split(' ')[0];
          if (filterMeetingDateFrom && dateOnly < filterMeetingDateFrom) matchesMeetingRange = false;
          if (filterMeetingDateTo && dateOnly > filterMeetingDateTo) matchesMeetingRange = false;
        } else {
          // If no meeting date, exclude if filtering by range
          matchesMeetingRange = false;
        }
      }

      // Tag filter
      const matchesTag = tagFilter ? (lead.tags && lead.tags.includes(tagFilter)) : true;

      return matchesSearch && matchesMeetingRange && matchesTag;
    });
  }, [leads, searchQuery, filterMeetingDateFrom, filterMeetingDateTo, tagFilter]);

  // Sorting handler
  const handleSort = (column: 'created_at' | 'meeting_date' | 'probability' | 'applicants' | 'value') => {
    if (sortColumn === column) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const sortedLeads = useMemo(() => {
    let leadsToSort = [...filteredLeads];
    if (sortColumn) {
      leadsToSort.sort((a, b) => {
        let aValue, bValue;
        if (sortColumn === 'created_at') {
          aValue = a.created_at;
          bValue = b.created_at;
        } else if (sortColumn === 'meeting_date') {
          aValue = a.meetings[0]?.meeting_date || '';
          bValue = b.meetings[0]?.meeting_date || '';
        } else if (sortColumn === 'probability') {
          aValue = a.probability || 0;
          bValue = b.probability || 0;
        } else if (sortColumn === 'applicants') {
          aValue = a.number_of_applicants_meeting || 0;
          bValue = b.number_of_applicants_meeting || 0;
        } else if (sortColumn === 'value') {
          // For value sorting, use balance if available, otherwise proposal_total
          aValue = (a.balance !== null && a.balance !== undefined) ? a.balance : (a.proposal_total !== null && a.proposal_total !== undefined ? a.proposal_total : 0);
          bValue = (b.balance !== null && b.balance !== undefined) ? b.balance : (b.proposal_total !== null && b.proposal_total !== undefined ? b.proposal_total : 0);
        }
        if (!aValue && !bValue) return 0;
        if (!aValue) return sortDirection === 'asc' ? -1 : 1;
        if (!bValue) return sortDirection === 'asc' ? 1 : -1;
        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return leadsToSort;
  }, [filteredLeads, sortColumn, sortDirection]);

  // Meeting date sort logic
  const today = new Date();
  today.setHours(0,0,0,0);
  const meetingSortedLeads = useMemo(() => {
    function getLatestMeetingDate(lead: LeadForExpert): Date | null {
      if (!lead.meetings || lead.meetings.length === 0) return null;
      const sortedMeetings = [...lead.meetings].filter(m => m.meeting_date).sort((a, b) => {
        // Since meeting_date is stored as text, we can compare strings directly for sorting
        return b.meeting_date.localeCompare(a.meeting_date);
      });
      if (!sortedMeetings.length) return null;
      // Convert the text date to a Date object for comparison with today
      const dateStr = sortedMeetings[0].meeting_date.split(' ')[0]; // Get just the date part
      return new Date(dateStr);
    }
    type LeadWithLatest = LeadForExpert & { _latestMeetingDate: Date | null };
    let filteredLeads = (sortedLeads as LeadForExpert[])
      .map(lead => ({ ...lead, _latestMeetingDate: getLatestMeetingDate(lead) } as LeadWithLatest))
      .filter(lead => {
        if (meetingSort === 'upcoming') {
          // Include leads with no meeting date (N/A) or with a future/today meeting
          return !lead._latestMeetingDate || isNaN(lead._latestMeetingDate.getTime()) || lead._latestMeetingDate >= today;
        } else {
          // Only leads with a valid past meeting date
          return lead._latestMeetingDate && !isNaN(lead._latestMeetingDate.getTime()) && lead._latestMeetingDate < today;
        }
      });
    
    // Apply column sorting if it's not meeting_date (which is handled by the meeting sort logic)
    if (sortColumn && sortColumn !== 'meeting_date') {
      filteredLeads.sort((a, b) => {
        let aValue, bValue;
        if (sortColumn === 'created_at') {
          aValue = a.created_at;
          bValue = b.created_at;
        } else if (sortColumn === 'probability') {
          aValue = a.probability || 0;
          bValue = b.probability || 0;
        } else if (sortColumn === 'applicants') {
          aValue = a.number_of_applicants_meeting || 0;
          bValue = b.number_of_applicants_meeting || 0;
        } else if (sortColumn === 'value') {
          // For value sorting, use balance if available, otherwise proposal_total
          aValue = (a.balance !== null && a.balance !== undefined) ? a.balance : (a.proposal_total !== null && a.proposal_total !== undefined ? a.proposal_total : 0);
          bValue = (b.balance !== null && b.balance !== undefined) ? b.balance : (b.proposal_total !== null && b.proposal_total !== undefined ? b.proposal_total : 0);
        }
        if (!aValue && !bValue) return 0;
        if (!aValue) return sortDirection === 'asc' ? -1 : 1;
        if (!bValue) return sortDirection === 'asc' ? 1 : -1;
        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    } else if (sortColumn === 'meeting_date') {
      // Apply meeting date column sorting
      filteredLeads.sort((a, b) => {
        const aDate = a._latestMeetingDate;
        const bDate = b._latestMeetingDate;
        
        if (!aDate && !bDate) return 0;
        if (!aDate) return sortDirection === 'asc' ? -1 : 1;
        if (!bDate) return sortDirection === 'asc' ? 1 : -1;
        
        const comparison = aDate.getTime() - bDate.getTime();
        return sortDirection === 'asc' ? comparison : -comparison;
      });
    } else {
      // Apply meeting date sorting logic (upcoming/past filter)
      filteredLeads.sort((a, b) => {
        if (!a._latestMeetingDate && !b._latestMeetingDate) return 0;
        if (!a._latestMeetingDate) return 1;
        if (!b._latestMeetingDate) return -1;
        if (meetingSort === 'upcoming') {
          // Soonest first, N/A last
          return a._latestMeetingDate.getTime() - b._latestMeetingDate.getTime();
        } else {
          // Most recent past first
          return b._latestMeetingDate.getTime() - a._latestMeetingDate.getTime();
        }
      });
    }
    
    return filteredLeads;
  }, [sortedLeads, meetingSort, today, sortColumn, sortDirection]);

  // Create client object for WhatsApp modal
  const clientForWhatsApp = useMemo(() => {
    if (!selectedLead) return undefined;
    const leadId = selectedLead.lead_type === 'legacy' ? `legacy_${selectedLead.id}` : String(selectedLead.id);
    return {
      id: leadId,
      name: selectedLead.name || '',
      lead_number: selectedLead.lead_number,
      lead_type: selectedLead.lead_type
    };
  }, [selectedLead]);

  // Create client object for Email modal
  const clientForEmail = useMemo(() => {
    if (!selectedLead) return undefined;
    const leadId = selectedLead.lead_type === 'legacy' ? `legacy_${selectedLead.id}` : String(selectedLead.id);
    return {
      id: leadId,
      name: selectedLead.name || '',
      lead_number: selectedLead.lead_number,
      lead_type: selectedLead.lead_type,
      topic: (selectedLead as any).category || selectedLead.topic || ''
    };
  }, [selectedLead]);

  const handleRowSelect = (leadId: string | number) => {
    setSelectedRowId(leadId);
    setShowActionMenu(true);
  };

  const handleRowClick = (lead: LeadForExpert) => {
    setSelectedLead(lead);
    setDrawerOpen(true);
  };

  // Action handlers
  const handleCall = (lead: LeadForExpert) => {
    // ExpertPage doesn't have phone/mobile fields, so we'll navigate to client page
    navigate(`/clients/${lead.lead_number}`);
  };

  const handleEmail = (lead: LeadForExpert) => {
    setSelectedLead(lead);
    setIsEmailModalOpen(true);
    setShowActionMenu(false);
    setSelectedRowId(null);
  };

  const handleWhatsApp = (lead: LeadForExpert) => {
    setSelectedLead(lead);
    setIsWhatsAppModalOpen(true);
    setShowActionMenu(false);
    setSelectedRowId(null);
  };

  const handleTimeline = (lead: LeadForExpert) => {
    navigate(`/clients/${lead.lead_number}?tab=interactions`);
  };

  const handleViewClient = (lead: LeadForExpert) => {
    navigate(`/clients/${lead.lead_number}`);
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    setTimeout(() => setSelectedLead(null), 400); // Wait for animation
  };

  // Helper to get current user's name
  async function fetchCurrentUserName() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user && user.email) {
      const { data, error } = await supabase
        .from('users')
        .select('full_name')
        .eq('email', user.email)
        .single();
      if (!error && data?.full_name) {
        return data.full_name;
      }
      return user.email;
    }
    return 'Unknown';
  }

  // Handler to add comment in collapsible section
  const handleAddCommentInCollapsible = async (leadId: string | number, commentText: string) => {
    if (!commentText.trim()) return;

    try {
      const lead = leads.find(l => l.id === leadId);
      if (!lead) return;

      const now = new Date().toISOString();
      const userName = await fetchCurrentUserName();
      const newCommentObj = { text: commentText.trim(), timestamp: now, user: userName };
      const updatedComments = [...(lead.expert_comments || []), newCommentObj];

      const tableName = lead.lead_type === 'legacy' ? 'leads_lead' : 'leads';
      const clientId = lead.lead_type === 'legacy' 
        ? (typeof leadId === 'string' ? parseInt(leadId.replace('legacy_', '')) : leadId)
        : leadId;

      const { error } = await supabase
        .from(tableName)
        .update({ expert_page_comments: updatedComments })
        .eq('id', clientId);

      if (error) throw error;

      // Update local state
      setLeads(prev => prev.map(l => 
        l.id === leadId 
          ? { ...l, expert_comments: updatedComments }
          : l
      ));

      // Clear comment editing state
      setEditingComments(prev => {
        const newSet = new Set(prev);
        newSet.delete(leadId);
        return newSet;
      });
      setNewCommentValues(prev => {
        const newState = { ...prev };
        delete newState[leadId];
        return newState;
      });
    } catch (error) {
      console.error('Error adding comment:', error);
      alert('Failed to add comment');
    }
  };

  // Handler to save expert note in collapsible section
  const handleSaveExpertNoteInCollapsible = async (leadId: string | number, noteIdx: number, content: string) => {
    try {
      const lead = leads.find(l => l.id === leadId);
      if (!lead) return;

      const userName = await fetchCurrentUserName();
      const now = new Date().toISOString();
      const updatedNotes = [...(lead.expert_notes || [])];
      
      if (noteIdx >= 0 && noteIdx < updatedNotes.length) {
        // Edit existing note
        const existingNote = updatedNotes[noteIdx];
        updatedNotes[noteIdx] = {
          ...(typeof existingNote === 'object' ? existingNote : { content: existingNote }),
          content: content.trim(),
          edited_by: userName,
          edited_at: now
        } as any;
      } else {
        // Add new note
        updatedNotes.push({
          content: content.trim(),
          user: userName,
          timestamp: now
        } as any);
      }

      const tableName = lead.lead_type === 'legacy' ? 'leads_lead' : 'leads';
      const clientId = lead.lead_type === 'legacy' 
        ? (typeof leadId === 'string' ? parseInt(leadId.replace('legacy_', '')) : leadId)
        : leadId;

      const { error } = await supabase
        .from(tableName)
        .update({ expert_notes: updatedNotes })
        .eq('id', clientId);

      if (error) throw error;

      // Update local state
      setLeads(prev => prev.map(l => 
        l.id === leadId 
          ? { ...l, expert_notes: updatedNotes }
          : l
      ));

      // Clear editing state
      setEditingExpertNote(prev => {
        const newState = { ...prev };
        delete newState[leadId];
        return newState;
      });
    } catch (error) {
      console.error('Error saving expert note:', error);
      alert('Failed to save expert note');
    }
  };

  // Add comment to lead
  const handleAddComment = async () => {
    if (!selectedLead || !newComment.trim()) return;
    setCommentSubmitting(true);
    const now = new Date().toISOString();
    const userName = await fetchCurrentUserName();
    const newCommentObj = { text: newComment.trim(), timestamp: now, user: userName };
    const updatedComments = [...(selectedLead.expert_comments || []), newCommentObj];
    try {
      if (selectedLead.lead_type === 'legacy') {
        // For legacy leads, extract numeric ID and update leads_lead table
        const numericId = typeof selectedLead.id === 'string' ? parseInt(selectedLead.id.replace('legacy_', '')) : selectedLead.id;
        const { error } = await supabase
          .from('leads_lead')
          .update({ expert_page_comments: updatedComments })
          .eq('id', numericId);
        if (error) throw error;
      } else {
        // For new leads
        const { error } = await supabase
          .from('leads')
          .update({ expert_page_comments: updatedComments })
          .eq('id', selectedLead.id);
        if (error) throw error;
      }
      
      setSelectedLead({ ...selectedLead, expert_comments: updatedComments });
      setNewComment('');
      // Optionally refresh leads
      setLeads(leads => leads.map(l => l.id === selectedLead.id ? { ...l, expert_comments: updatedComments } : l));
    } catch (err) {
      console.error('Error adding comment:', err);
      // Optionally show error
    }
    setCommentSubmitting(false);
  };

  const handleLabelChange = async (leadId: number | string, label: string) => {
    setLabelSubmitting(true);
    try {
      // Determine which table to update based on lead type
      const lead = leads.find(l => l.id === leadId);
      if (!lead) return;

      if (lead.lead_type === 'legacy') {
        // For legacy leads, we need to extract the numeric ID
        const numericId = typeof leadId === 'string' ? parseInt(leadId.replace('legacy_', '')) : leadId;
        const { error } = await supabase
          .from('leads_lead')
          .update({ expert_page_label: label })
          .eq('id', numericId);
        if (error) throw error;
      } else {
        // For new leads
        const { error } = await supabase
          .from('leads')
          .update({ expert_page_label: label })
          .eq('id', leadId);
        if (error) throw error;
      }
      
      setLeads(leads => leads.map(l => l.id === leadId ? { ...l, label } : l));
      if (selectedLead && selectedLead.id === leadId) {
        setSelectedLead({ ...selectedLead, label });
      }
      setLabelDropdownOpen(null);
    } catch (err) {
      console.error('Error updating label:', err);
      // Optionally show error
    }
    setLabelSubmitting(false);
  };

  // Set highlightedLeads based on leads.highlighted_by
  useEffect(() => {
    if (!userId || leads.length === 0) return;
    setHighlightedLeads(
      leads.filter(l => Array.isArray(l.highlighted_by) && l.highlighted_by.includes(userId))
    );
  }, [userId, leads]);

  const handleHighlight = async (lead: LeadForExpert) => {
    if (!userId || highlightedLeads.find(l => String(l.id) === String(lead.id))) return;
    // Add userId to highlighted_by array
    const highlightedBy = Array.isArray(lead.highlighted_by) ? [...lead.highlighted_by] : [];
    if (!highlightedBy.includes(userId)) {
      highlightedBy.push(userId);
      if (lead.lead_type === 'legacy') {
        const numericId = typeof lead.id === 'string' ? parseInt(lead.id.replace('legacy_', '')) : lead.id;
        await supabase.from('leads_lead').update({ expert_page_highlighted_by: highlightedBy }).eq('id', numericId);
      } else {
        await supabase.from('leads').update({ expert_page_highlighted_by: highlightedBy }).eq('id', lead.id);
      }
      setHighlightedLeads(prev => [...prev, { ...lead, highlighted_by: highlightedBy }]);
      setHighlightPanelOpen(true);
    }
  };

  const handleRemoveHighlight = async (leadId: string) => {
    if (!userId) return;
    const lead = leads.find(l => String(l.id) === String(leadId));
    if (!lead) return;
    let highlightedBy = Array.isArray(lead.highlighted_by) ? [...lead.highlighted_by] : [];
    highlightedBy = highlightedBy.filter((id: string) => id !== userId);
    if (lead.lead_type === 'legacy') {
      const numericId = typeof leadId === 'string' ? parseInt(leadId.replace('legacy_', '')) : parseInt(leadId);
      await supabase.from('leads_lead').update({ expert_page_highlighted_by: highlightedBy }).eq('id', numericId);
    } else {
      await supabase.from('leads').update({ expert_page_highlighted_by: highlightedBy }).eq('id', leadId);
    }
    setHighlightedLeads(prev => prev.filter(l => String(l.id) !== String(leadId)));
  };

  // For scrolling/animating to a main card
  const mainCardRefs = useRef<{ [id: string | number]: HTMLDivElement | null }>({});
  const handleHighlightCardClick = (leadId: number | string) => {
    const ref = mainCardRefs.current[leadId];
    if (ref) {
      ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
      ref.classList.add('ring-4', 'ring-primary', 'animate-pulse');
      setTimeout(() => {
        ref.classList.remove('animate-pulse');
        setTimeout(() => ref.classList.remove('ring-4', 'ring-primary'), 600);
      }, 1200);
    }
    setHighlightPanelOpen(false);
  };

  // Calculate summary statistics (using real data from database)
  const summaryStats = useMemo(() => {
    // Total leads (current filtered leads on page)
    const totalLeads = leads.length;

    return {
      archivalChecks: realSummaryStats.totalArchivalChecks,
      topWorkerCount: realSummaryStats.topExpertCount,
      totalLeads,
      topWorkerId: realSummaryStats.topExpertId
    };
  }, [leads, realSummaryStats]);

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="mb-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <AcademicCapIcon className="w-8 h-8 text-primary" />
          Expert Pipeline
        </h1>
      </div>

      {/* Filters and Search */}
      <div className="mb-6 flex flex-col md:flex-row md:items-end gap-4">
        {/* Search Bar */}
        <div className="relative flex items-center h-full max-w-xs w-full">
          <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-base-content/50" />
          <input
            type="text"
            placeholder="Search by name or lead..."
            className="input input-bordered w-full pl-10 max-w-xs"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        {/* Filters Row */}
        <div className="flex flex-row flex-wrap gap-4 w-full">
          {/* Meeting Date Range Filter */}
          <div className="flex flex-col min-w-[360px]">
            <label className="text-xs font-semibold text-base-content/70 mb-1">Meeting Date</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                className="input input-bordered w-full max-w-[160px]"
                value={filterMeetingDateFrom}
                onChange={e => setFilterMeetingDateFrom(e.target.value)}
                placeholder="From"
              />
              <span className="mx-2 text-base-content/50">-</span>
              <input
                type="date"
                className="input input-bordered w-full max-w-[160px]"
                value={filterMeetingDateTo}
                onChange={e => setFilterMeetingDateTo(e.target.value)}
                placeholder="To"
              />
            </div>
          </div>
          {/* Meeting Date Sort Filter */}
          <div className="flex flex-col min-w-[160px]">
            <label className="text-xs font-semibold text-base-content/70 mb-1">Meeting Date Sort</label>
            <select
              className="select select-bordered w-full"
              value={meetingSort}
              onChange={e => setMeetingSort(e.target.value as 'upcoming' | 'past')}
            >
              <option value="upcoming">Upcoming Meetings</option>
              <option value="past">Past Meetings</option>
            </select>
          </div>
          {/* Filter by Tag */}
          <div className="flex flex-col min-w-[180px]">
            <label className="text-xs font-semibold text-base-content/70 mb-1">Tag</label>
            <select
              className="select select-bordered w-full"
              value={tagFilter}
              onChange={e => setTagFilter(e.target.value)}
            >
              <option value="">All</option>
              {availableTags.map(tag => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </select>
          </div>
          {/* My Stats Button */}
          <div className="flex flex-col min-w-[140px]">
            <label className="text-xs font-semibold text-base-content/70 mb-1">&nbsp;</label>
            <button
              className="btn btn-primary w-full"
              onClick={() => setShowMyStatsModal(true)}
            >
              <ChartBarIcon className="w-4 h-4 mr-2" />
              My Stats
            </button>
          </div>
          {/* View Toggle Button (Icon Only) */}
          <div className="flex flex-col min-w-[40px]">
            <label className="text-xs font-semibold text-base-content/70 mb-1">&nbsp;</label>
            <button
              className="btn btn-outline btn-primary w-full"
              onClick={() => setViewMode(viewMode === 'box' ? 'list' : 'box')}
              title={viewMode === 'box' ? 'Switch to List View' : 'Switch to Box View'}
            >
              {viewMode === 'box' ? (
                <Bars3Icon className="w-5 h-5" />
              ) : (
                <Squares2X2Icon className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Summary Statistics Cards */}
      <div className="mb-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Total Archival Checks */}
        <div className="bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 rounded-2xl p-6 text-white shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:scale-105">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/90 text-sm font-medium">Total Archival Checks Done</p>
              <p className="text-3xl font-bold">{summaryStats.archivalChecks}</p>
              <p className="text-white/90 text-xs mt-1">Last 30 days</p>
            </div>
            <div className="bg-white/20 rounded-full p-3">
              <AcademicCapIcon className="w-8 h-8" />
            </div>
          </div>
        </div>
        {/* Top Worker */}
        <div className="bg-gradient-to-tr from-purple-600 via-blue-600 to-blue-500 rounded-2xl p-6 text-white shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:scale-105">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/90 text-sm font-medium">Top Expert</p>
              <p className="text-xl font-bold truncate">{topExpertName}</p>
              <p className="text-white/90 text-xs mt-1">{summaryStats.topWorkerCount} opinion{summaryStats.topWorkerCount === 1 ? '' : 's'} (last 30 days)</p>
            </div>
            <div className="bg-white/20 rounded-full p-3">
                <UserIcon className="w-8 h-8" />
            </div>
          </div>
        </div>
        {/* Total Leads */}
        <div className="bg-gradient-to-b from-teal-600 via-green-500 to-green-600 rounded-2xl p-6 text-white shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:scale-105">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/90 text-sm font-medium">Total Leads</p>
              <p className="text-3xl font-bold">{summaryStats.totalLeads}</p>
              <p className="text-white/90 text-xs mt-1">In pipeline</p>
            </div>
            <div className="bg-white/20 rounded-full p-3">
              <BarChart3 className="w-8 h-8" />
            </div>
          </div>
        </div>
      </div>

      {/* Lead grid/list rendering */}
        {isLoading ? (
          <div className="col-span-full text-center p-8">
            <div className="loading loading-spinner loading-lg"></div>
            <p className="mt-4 text-base-content/60">Loading leads...</p>
          </div>
      ) : viewMode === 'box' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6">
          {meetingSortedLeads.length > 0 ? (
          meetingSortedLeads.map((lead) => (
            <div
              key={lead.id}
              onClick={() => handleRowClick(lead)}
              ref={el => mainCardRefs.current[lead.id] = el}
                className="bg-white rounded-2xl p-6 shadow-md hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 cursor-pointer border border-gray-100 group relative pb-16"
            >
              {/* Lead Number and Name */}
              <div className="mb-3 flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-400 tracking-widest">{lead.lead_number}</span>
                <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                  <h3 className="text-xl font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{lead.name}</h3>
                  {lead.label && (
                    <span className="ml-2 px-2 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border-2 border-primary">{lead.label}</span>
                  )}
              </div>
              <div className="space-y-2 divide-y divide-gray-100">
                {/* Stage */}
                <div className="flex justify-between items-center py-1">
                    <span className="text-sm font-semibold text-gray-500">Stage</span>
                    {lead.stage ? (() => {
                      const stageColour = getStageColour(String(lead.stage)) || '#6b7280';
                      const badgeTextColour = getContrastingTextColor(stageColour);
                      return (
                        <span 
                          className="text-sm font-bold ml-2 px-2 py-1 rounded"
                          style={{
                            backgroundColor: stageColour,
                            color: badgeTextColour,
                          }}
                        >
                          {getStageName(lead.stage)}
                        </span>
                      );
                    })() : (
                      <span className="text-sm font-bold ml-2 px-2 py-1 rounded bg-gray-100 text-gray-800">
                        N/A
                      </span>
                    )}
                </div>
                {/* Category */}
                <div className="flex justify-between items-center py-1">
                    <span className="text-sm font-semibold text-gray-500">Category</span>
                    <span className="text-base font-bold text-gray-800 ml-2">{(lead as any).category || lead.topic || 'N/A'}</span>
                </div>
                {/* Date Created */}
                <div className="flex justify-between items-center py-1">
                    <span className="text-sm font-semibold text-gray-500">Date Created</span>
                    <span className="text-base font-bold text-gray-800 ml-2">{format(parseISO(lead.created_at), 'dd/MM/yyyy')}</span>
                </div>
                {/* Probability */}
                <div className="flex justify-between items-center py-1">
                    <span className="text-sm font-semibold text-gray-500">Probability</span>
                    <span className={`text-base font-bold ml-2 ${
                    (lead.probability || 0) >= 80 ? 'text-green-600' :
                    (lead.probability || 0) >= 60 ? 'text-yellow-600' :
                    (lead.probability || 0) >= 40 ? 'text-orange-600' :
                    'text-red-600'
                  }`}>
                    {lead.probability !== undefined && lead.probability !== null ? `${lead.probability}%` : 'N/A'}
                  </span>
                </div>
                {/* Total Applicants */}
                <div className="flex justify-between items-center py-1">
                    <span className="text-sm font-semibold text-gray-500">Total Applicants</span>
                    <span className="text-base font-bold text-gray-800 ml-2">
                    {lead.number_of_applicants_meeting ?? 'N/A'}
                  </span>
                </div>
                {/* Meeting */}
                <div className="flex justify-between items-center py-1">
                    <span className="text-sm font-semibold text-gray-500">Meeting</span>
                    {lead.meetings && lead.meetings.length > 0 ? (() => {
                      // Get the latest meeting date by sorting and taking the first one
                      const sortedMeetings = [...lead.meetings].filter(m => m.meeting_date).sort((a, b) => {
                        return new Date(b.meeting_date).getTime() - new Date(a.meeting_date).getTime();
                      });
                      if (sortedMeetings.length === 0) return <span className="text-sm font-bold ml-2">N/A</span>;
                      const meetingDateStr = sortedMeetings[0].meeting_date;
                      // Extract date and time parts
                      const parts = meetingDateStr.split(' ');
                      const dateOnly = parts[0];
                      const timeOnly = parts.length > 1 ? parts[1] : '';
                      // Convert YYYY-MM-DD to dd/mm/yyyy format
                      const [year, month, day] = dateOnly.split('-');
                      const formattedDate = `${day}/${month}/${year}`;
                      // Format time (HH:mm:ss to HH:mm)
                      const formattedTime = timeOnly ? timeOnly.substring(0, 5) : '';
                      const displayText = formattedTime ? `${formattedDate} - ${formattedTime}` : formattedDate;
                      const colorClass = getMeetingColor(meetingDateStr);
                      return (
                        <span className={`text-sm font-bold ml-2 px-2 py-1 rounded ${colorClass}`}>
                          {displayText}
                  </span>
                      );
                    })() : <span className="text-sm font-bold ml-2">N/A</span>}
                </div>
                {/* Value */}
                <div className="flex justify-between items-center py-1">
                    <span className="text-sm font-semibold text-gray-500">Value</span>
                    <span className="text-base font-bold text-gray-800 ml-2">{getDisplayValue(lead)}</span>
                </div>
              </div>
              
              {/* Action buttons */}
              <div className="mt-4 flex justify-end">
                <Link
                  to={`/clients/${lead.lead_number}`}
                  className="btn btn-outline btn-primary btn-sm flex items-center justify-center"
                  title="View Lead"
                  onClick={(e) => e.stopPropagation()}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                </Link>
                <button
                  className="btn btn-outline btn-warning btn-sm ml-2 flex items-center justify-center"
                  title={highlightedLeads.find(l => l.id === lead.id) ? 'Highlighted' : 'Highlight'}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleHighlight(lead);
                  }}
                  disabled={!!highlightedLeads.find(l => l.id === lead.id)}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-yellow-500"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364-6.364l-1.414 1.414M6.05 17.95l-1.414 1.414m12.728 0l-1.414-1.414M6.05 6.05L4.636 4.636" /></svg>
                </button>
              </div>
              
              {/* Most recent comment at the bottom left */}
              {lead.expert_comments && lead.expert_comments.length > 0 ? (
                <div className="absolute left-6 bottom-5 max-w-[85%] flex items-end">
                  <div className="flex items-start gap-2">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center shadow text-white text-sm font-bold">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4-4.03 7-9 7a9.77 9.77 0 01-4-.8l-4.28 1.07a1 1 0 01-1.21-1.21l1.07-4.28A7.94 7.94 0 013 12c0-4 4.03-7 9-7s9 3 9 7z"/></svg>
                    </div>
                    <div className="relative bg-white border border-base-200 rounded-2xl px-4 py-2 shadow-md text-sm text-base-content/90" style={{minWidth: '120px'}}>
                      <div className="font-medium leading-snug max-w-xs truncate" title={lead.expert_comments[lead.expert_comments.length - 1].text}>{lead.expert_comments[lead.expert_comments.length - 1].text}</div>
                      <div className="text-[11px] text-base-content/50 text-right mt-1">
                        {lead.expert_comments[lead.expert_comments.length - 1].user} · {format(new Date(lead.expert_comments[lead.expert_comments.length - 1].timestamp), 'dd/MM/yyyy HH:mm')}
                      </div>
                      {/* Chat bubble pointer */}
                      <div className="absolute left-[-10px] bottom-2 w-0 h-0 border-t-8 border-t-transparent border-b-8 border-b-transparent border-r-8 border-r-white border-l-0"></div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <div className="col-span-full text-center p-8">
            <div className="text-base-content/60">
              <FolderIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">No leads found</p>
              <p className="text-sm">Try adjusting your search or filters</p>
            </div>
          </div>
        )}
      </div>
      ) : (
        // List view rendering
        <div className="overflow-x-auto w-full">
          <table className="table w-full text-xs sm:text-sm">
            <thead>
              <tr>
                <th className="text-xs sm:text-sm w-10"></th>
                <th className="text-xs sm:text-sm">Lead</th>
                <th className="text-xs sm:text-sm">Assigned Since</th>
                <th 
                  className="text-xs sm:text-sm cursor-pointer hover:bg-base-200 transition-colors"
                  onClick={() => handleSort('meeting_date')}
                >
                  Meeting
                  {sortColumn === 'meeting_date' && (
                    <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>
                  )}
                </th>
                <th className="text-xs sm:text-sm">Stage</th>
                <th className="text-xs sm:text-sm">Category</th>
                <th 
                  className="text-xs sm:text-sm cursor-pointer hover:bg-base-200 transition-colors"
                  onClick={() => handleSort('created_at')}
                >
                  Date Created
                  {sortColumn === 'created_at' && (
                    <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>
                  )}
                </th>
                <th 
                  className="text-xs sm:text-sm cursor-pointer hover:bg-base-200 transition-colors"
                  onClick={() => handleSort('probability')}
                >
                  Probability
                  {sortColumn === 'probability' && (
                    <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>
                  )}
                </th>
                <th 
                  className="text-xs sm:text-sm cursor-pointer hover:bg-base-200 transition-colors"
                  onClick={() => handleSort('applicants')}
                >
                  Applicants
                  {sortColumn === 'applicants' && (
                    <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>
                  )}
                </th>
                <th 
                  className="text-xs sm:text-sm cursor-pointer hover:bg-base-200 transition-colors"
                  onClick={() => handleSort('value')}
                >
                  Value
                  {sortColumn === 'value' && (
                    <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>
                  )}
                </th>
                <th className="text-xs sm:text-sm">Tags</th>
              </tr>
            </thead>
            <tbody>
              {meetingSortedLeads.map((lead) => {
                const isExpanded = expandedRows.has(lead.id);
                return (
                  <React.Fragment key={lead.id}>
                <tr 
                  className={`hover:bg-blue-50 cursor-pointer ${selectedRowId === lead.id ? 'bg-primary/5 ring-2 ring-primary ring-offset-1' : ''}`}
                  onClick={() => handleRowSelect(lead.id)}
                >
                      {/* Expand/Collapse Arrow */}
                      <td className="px-2 py-3 md:py-4 text-center w-10">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedRows(prev => {
                              const newSet = new Set(prev);
                              if (newSet.has(lead.id)) {
                                newSet.delete(lead.id);
                              } else {
                                newSet.add(lead.id);
                              }
                              return newSet;
                            });
                          }}
                          className="p-1 hover:bg-base-200 rounded transition-colors"
                        >
                          {isExpanded ? (
                            <ChevronDownIcon className="w-5 h-5 text-gray-600" />
                          ) : (
                            <ChevronRightIcon className="w-5 h-5 text-gray-600" />
                          )}
                        </button>
                      </td>
                      <td className="text-xs sm:text-sm">
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-gray-400 tracking-widest">{lead.lead_number}</span>
                      <span className="font-bold">{lead.name}</span>
                    </div>
                  </td>
                  <td className="text-xs sm:text-sm">
                    {(() => {
                      const daysSince = getDaysSinceAssigned(lead.created_at);
                      return daysSince === 0 ? 'Today' : `${daysSince} day${daysSince === 1 ? '' : 's'}`;
                    })()}
                  </td>
                  <td className="text-xs sm:text-sm">
                    {lead.meetings && lead.meetings.length > 0 ? (() => {
                      const meetingDateStr = [...lead.meetings].sort((a, b) => new Date(b.meeting_date).getTime() - new Date(a.meeting_date).getTime())[0].meeting_date;
                      // Extract date and time parts
                      const parts = meetingDateStr.split(' ');
                      const dateOnly = parts[0];
                      const timeOnly = parts.length > 1 ? parts[1] : '';
                      // Convert YYYY-MM-DD to dd/mm/yyyy format
                      const [year, month, day] = dateOnly.split('-');
                      const formattedDate = `${day}/${month}/${year}`;
                      // Format time (HH:mm:ss to HH:mm)
                      const formattedTime = timeOnly ? timeOnly.substring(0, 5) : '';
                      const displayText = formattedTime ? `${formattedDate} - ${formattedTime}` : formattedDate;
                      const colorClass = getMeetingColor(meetingDateStr);
                      return (
                        <span className={`px-2 py-1 rounded font-semibold ${colorClass}`}>
                          {displayText}
                        </span>
                      );
                    })() : 'N/A'}
                  </td>
                  <td className="text-xs sm:text-sm">{lead.stage ? getStageName(lead.stage) : 'N/A'}</td>
                  <td className="text-xs sm:text-sm">{(lead as any).category || lead.topic || 'N/A'}</td>
                  <td className="text-xs sm:text-sm">{format(parseISO(lead.created_at), 'dd/MM/yyyy')}</td>
                  <td className="text-xs sm:text-sm">{lead.probability !== undefined && lead.probability !== null ? `${lead.probability}%` : 'N/A'}</td>
                  <td className="text-xs sm:text-sm">{lead.number_of_applicants_meeting ?? 'N/A'}</td>
                  <td className="text-xs sm:text-sm">{getDisplayValue(lead)}</td>
                  <td className="text-xs sm:text-sm">
                    {lead.tags && lead.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1 justify-center">
                        {lead.tags.map((tag, idx) => (
                          <span key={idx} className="badge badge-outline badge-primary font-semibold text-xs">{tag}</span>
                        ))}
                      </div>
                    ) : (
                      ''
                    )}
                  </td>
                </tr>
                    {/* Collapsible Content Row */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={10} className="px-4 py-4 bg-white border-b-2 border-gray-200">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Comments */}
                            <div className="bg-white border border-gray-200 rounded-2xl shadow-lg overflow-hidden">
                              <div className="pl-6 pt-2 pb-2 border-b border-gray-200 flex items-center justify-between">
                                <h4 className="text-lg font-semibold text-black">Comments</h4>
                                {!editingComments.has(lead.id) && (
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingComments(prev => new Set(prev).add(lead.id));
                                      setNewCommentValues(prev => ({ ...prev, [lead.id]: '' }));
                                    }}
                                  >
                                    <PencilSquareIcon className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                              <div className="p-6">
                                {editingComments.has(lead.id) ? (
                                  <div className="space-y-3">
                                    <textarea
                                      className="textarea textarea-bordered w-full h-32"
                                      value={newCommentValues[lead.id] || ''}
                                      onChange={(e) => setNewCommentValues(prev => ({ ...prev, [lead.id]: e.target.value }))}
                                      placeholder="Add a comment..."
                                    />
                                    <div className="flex gap-2 justify-end">
                                      <button
                                        className="btn btn-ghost btn-sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingComments(prev => {
                                            const newSet = new Set(prev);
                                            newSet.delete(lead.id);
                                            return newSet;
                                          });
                                          setNewCommentValues(prev => {
                                            const newState = { ...prev };
                                            delete newState[lead.id];
                                            return newState;
                                          });
                                        }}
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        className="btn btn-primary btn-sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleAddCommentInCollapsible(lead.id, newCommentValues[lead.id] || '');
                                        }}
                                      >
                                        Save
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    {lead.expert_comments && lead.expert_comments.length > 0 ? (
                                      <div className="space-y-3 max-h-64 overflow-y-auto">
                                        {lead.expert_comments.slice().reverse().map((comment, commentIdx) => (
                                          <div key={commentIdx} className="border border-gray-200 rounded-lg p-3">
                                            <div className="text-sm text-gray-900 whitespace-pre-wrap mb-2">{comment.text}</div>
                                            <div className="flex items-center gap-2 text-xs text-gray-400">
                                              <UserIcon className="w-3 h-3" />
                                              <span>{comment.user}</span>
                                              <span>·</span>
                                              <ClockIcon className="w-3 h-3" />
                                              <span>{format(new Date(comment.timestamp), 'dd/MM/yyyy HH:mm')}</span>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-gray-500">No comments yet</p>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                            
                            {/* Facts of Case */}
                            <div className="bg-white border border-gray-200 rounded-2xl shadow-lg overflow-hidden">
                              <div className="pl-6 pt-2 pb-2 border-b border-gray-200">
                                <h4 className="text-lg font-semibold text-black">Facts of Case</h4>
                              </div>
                              <div className="p-6">
                                {lead.facts ? (
                                  <div className="text-sm text-gray-900 whitespace-pre-wrap">{lead.facts}</div>
                                ) : (
                                  <p className="text-gray-500">No facts available</p>
                                )}
                              </div>
                            </div>
                            
                            {/* Expert Notes */}
                            <div className="bg-white border border-gray-200 rounded-2xl shadow-lg overflow-hidden">
                              <div className="pl-6 pt-2 pb-2 border-b border-gray-200 flex items-center justify-between">
                                <h4 className="text-lg font-semibold text-black">Expert Notes</h4>
                                {!editingExpertNote[lead.id] && (
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingExpertNote(prev => ({
                                        ...prev,
                                        [lead.id]: { noteIdx: -1, content: '' }
                                      }));
                                    }}
                                  >
                                    <PencilSquareIcon className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                              <div className="p-6">
                                {editingExpertNote[lead.id] ? (
                                  <div className="space-y-3">
                                    <textarea
                                      className="textarea textarea-bordered w-full h-32"
                                      value={editingExpertNote[lead.id]?.content || ''}
                                      onChange={(e) => setEditingExpertNote(prev => ({
                                        ...prev,
                                        [lead.id]: { ...prev[lead.id], content: e.target.value }
                                      }))}
                                      placeholder={editingExpertNote[lead.id]?.noteIdx === -1 ? "Add a new expert note..." : "Edit expert note..."}
                                    />
                                    <div className="flex gap-2 justify-end">
                                      <button
                                        className="btn btn-ghost btn-sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingExpertNote(prev => {
                                            const newState = { ...prev };
                                            delete newState[lead.id];
                                            return newState;
                                          });
                                        }}
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        className="btn btn-primary btn-sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const editState = editingExpertNote[lead.id];
                                          if (editState) {
                                            handleSaveExpertNoteInCollapsible(lead.id, editState.noteIdx, editState.content);
                                          }
                                        }}
                                      >
                                        Save
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    {lead.expert_notes && Array.isArray(lead.expert_notes) && lead.expert_notes.length > 0 ? (
                                      <div className="space-y-3 max-h-64 overflow-y-auto">
                                        {lead.expert_notes.map((note: any, noteIdx: number) => {
                                          const noteContent = typeof note === 'string' ? note : (note.content || JSON.stringify(note));
                                          const noteTimestamp = note.timestamp || note.created_at || note.edited_at;
                                          const noteUser = note.user || note.edited_by || note.created_by || note.created_by_name || 'Unknown';
                                          const displayDate = noteTimestamp ? (() => {
                                            try {
                                              return format(new Date(noteTimestamp), 'dd/MM/yyyy HH:mm');
                                            } catch {
                                              return noteTimestamp;
                                            }
                                          })() : null;
                                          
                                          return (
                                            <div key={noteIdx} className="border border-gray-200 rounded-lg p-3">
                                              <div className="flex items-start justify-between gap-2">
                                                <div className="flex-1">
                                                  <div className="text-sm text-gray-900 whitespace-pre-wrap mb-2">{noteContent}</div>
                                                  {(noteUser !== 'Unknown' || displayDate) && (
                                                    <div className="flex items-center gap-2 text-xs text-gray-400">
                                                      <UserIcon className="w-3 h-3" />
                                                      <span>{noteUser}</span>
                                                      {displayDate && (
                                                        <>
                                                          <span>·</span>
                                                          <ClockIcon className="w-3 h-3" />
                                                          <span>{displayDate}</span>
                                                        </>
                                                      )}
                                                    </div>
                                                  )}
                                                </div>
                                                <button
                                                  className="btn btn-ghost btn-xs"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setEditingExpertNote(prev => ({
                                                      ...prev,
                                                      [lead.id]: { noteIdx, content: noteContent }
                                                    }));
                                                  }}
                                                >
                                                  <PencilSquareIcon className="w-3 h-3" />
                                                </button>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ) : (
                                      <p className="text-gray-500">No expert notes</p>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                            
                            {/* Handler Notes */}
                            <div className="bg-white border border-gray-200 rounded-2xl shadow-lg overflow-hidden">
                              <div className="pl-6 pt-2 pb-2 border-b border-gray-200">
                                <h4 className="text-lg font-semibold text-black">Handler Notes</h4>
                              </div>
                              <div className="p-6">
                                {lead.handler_notes && Array.isArray(lead.handler_notes) && lead.handler_notes.length > 0 ? (
                                  <div className="space-y-3 max-h-64 overflow-y-auto">
                                    {lead.handler_notes.map((note: any, noteIdx: number) => {
                                      const noteContent = typeof note === 'string' ? note : (note.content || JSON.stringify(note));
                                      const noteTimestamp = note.timestamp || note.created_at || note.edited_at;
                                      const noteUser = note.user || note.edited_by || note.created_by || note.created_by_name || 'Unknown';
                                      const displayDate = noteTimestamp ? (() => {
                                        try {
                                          return format(new Date(noteTimestamp), 'dd/MM/yyyy HH:mm');
                                        } catch {
                                          return noteTimestamp;
                                        }
                                      })() : null;
                                      
                                      return (
                                        <div key={noteIdx} className="border border-gray-200 rounded-lg p-3">
                                          <div className="text-sm text-gray-900 whitespace-pre-wrap mb-2">{noteContent}</div>
                                          {(noteUser !== 'Unknown' || displayDate) && (
                                            <div className="flex items-center gap-2 text-xs text-gray-400">
                                              <UserIcon className="w-3 h-3" />
                                              <span>{noteUser}</span>
                                              {displayDate && (
                                                <>
                                                  <span>·</span>
                                                  <ClockIcon className="w-3 h-3" />
                                                  <span>{displayDate}</span>
                                                </>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <p className="text-gray-500">No handler notes</p>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Floating Action Buttons - Fixed position on right side */}
      {selectedRowId && (() => {
        const selectedLead = meetingSortedLeads.find(l => l.id === selectedRowId);
        if (!selectedLead) return null;
        
        return (
          <>
            {/* Overlay to close buttons */}
            <div
              className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
              onClick={() => {
                setShowActionMenu(false);
                setSelectedRowId(null);
              }}
            />
            
            {/* Floating Action Buttons - Fixed position on right side */}
            <div className="fixed right-6 top-1/2 -translate-y-1/2 z-50 flex flex-col items-end gap-3">
              {/* Call Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">Call</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCall(selectedLead);
                    setShowActionMenu(false);
                    setSelectedRowId(null);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="Call"
                >
                  <PhoneIcon className="w-6 h-6" />
                </button>
              </div>
              
              {/* Email Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">Email</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEmail(selectedLead);
                    setShowActionMenu(false);
                    setSelectedRowId(null);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="Email"
                >
                  <EnvelopeIcon className="w-6 h-6" />
                </button>
              </div>
              
              {/* WhatsApp Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">WhatsApp</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleWhatsApp(selectedLead);
                    setShowActionMenu(false);
                    setSelectedRowId(null);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="WhatsApp"
                >
                  <FaWhatsapp className="w-6 h-6" />
                </button>
              </div>
              
              {/* Timeline Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">Timeline</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTimeline(selectedLead);
                    setShowActionMenu(false);
                    setSelectedRowId(null);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="Timeline"
                >
                  <ClockIcon className="w-6 h-6" />
                </button>
              </div>
              
              {/* Edit Lead Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">Edit Lead</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEditDrawerOpen(true);
                    setShowActionMenu(false);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="Edit Lead"
                >
                  <PencilSquareIcon className="w-6 h-6" />
                </button>
              </div>
              
              {/* View Client Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">View Client</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleViewClient(selectedLead);
                    setShowActionMenu(false);
                    setSelectedRowId(null);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="View Client"
                >
                  <EyeIcon className="w-6 h-6" />
                </button>
              </div>
              
              {/* Documents Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">Documents</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedLead(selectedLead);
                    setIsDocumentModalOpen(true);
                    setShowActionMenu(false);
                    setSelectedRowId(null);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="Documents"
                >
                  <FolderIcon className="w-6 h-6" />
                </button>
              </div>
              
              {/* Highlight Button */}
              {!highlightedLeads.find(l => l.id === selectedLead.id) && (
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">Highlight</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleHighlight(selectedLead);
                      setShowActionMenu(false);
                      setSelectedRowId(null);
                    }}
                    className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                    title="Highlight"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364-6.364l-1.414 1.414M6.05 17.95l-1.414 1.414m12.728 0l-1.414-1.414M6.05 6.05L4.636 4.636" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </>
        );
      })()}

      {/* Drawer for lead summary */}
      {drawerOpen && selectedLead && !isDocumentModalOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30 transition-opacity duration-300" onClick={closeDrawer} />
          {/* Lead Summary Drawer */}
          <div className={`ml-auto w-full max-w-xl bg-white h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-50 rounded-l-2xl relative`} style={{ boxShadow: '0 0 40px 0 rgba(0,0,0,0.2)' }}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <FolderIcon className="w-8 h-8 text-primary" />
                <h3 className="text-2xl font-bold">Lead Summary</h3>
              </div>
              <div className="flex items-center gap-2">
                {selectedLead && (
                  <Link
                    to={`/clients/${selectedLead.lead_number}`}
                    className="btn btn-outline btn-primary btn-sm"
                  >
                    View Lead
                  </Link>
                )}
                <button className="btn btn-ghost btn-circle" onClick={closeDrawer}>
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>
            </div>
            {/* Label at the top */}
            <div className="flex items-center gap-3 mb-2 relative">
              {selectedLead.label && (
                <span className="px-2 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">{selectedLead.label}</span>
              )}
              <div className="relative">
                <button
                  className="btn btn-xs btn-outline btn-primary"
                  onClick={() => setLabelDropdownOpen(labelDropdownOpen === selectedLead.id ? null : selectedLead.id)}
                  disabled={labelSubmitting}
                >
                  {selectedLead.label ? 'Edit Label' : 'Add Label'}
                </button>
                {labelDropdownOpen === selectedLead.id && (
                  <div className="absolute left-0 mt-2 z-50 bg-white border border-base-200 rounded-lg shadow-lg p-2 min-w-[160px]">
                    {LABEL_OPTIONS.map(option => (
                      <button
                        key={option}
                        className={`block w-full text-left px-3 py-1 rounded hover:bg-primary/10 ${selectedLead.label === option ? 'bg-primary/10 text-primary font-bold' : ''}`}
                        onClick={() => handleLabelChange(selectedLead.id, option)}
                        disabled={labelSubmitting}
                      >
                        {option}
                      </button>
                    ))}
                    <button
                      className="block w-full text-left px-3 py-1 rounded hover:bg-base-200 text-error mt-1"
                      onClick={() => handleLabelChange(selectedLead.id, '')}
                      disabled={labelSubmitting}
                    >Remove Label</button>
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-6 flex-1 overflow-y-auto">
              {selectedLead && (
                <>
                  <div className="flex items-center gap-3">
                    <UserIcon className="w-6 h-6 text-base-content/70" />
                    <span className="font-semibold text-lg">{selectedLead.name} <span className="text-base-content/50">({selectedLead.lead_number})</span></span>
                  </div>
                  <div className="flex items-center gap-3">
                    <ChatBubbleLeftRightIcon className="w-6 h-6 text-base-content/70" />
                    <span className="font-medium">Category:</span>
                    <span>{(selectedLead as any).category || selectedLead.topic || <span className='text-base-content/40'>N/A</span>}</span>
                  </div>
                  {/* Documents Button */}
                  <div>
                    <span className="font-medium">Documents:</span>
                    {selectedLead.onedrive_folder_link ? (
                      <button
                        onClick={() => {
                          setDrawerOpen(false);
                          setIsDocumentModalOpen(true);
                        }}
                        className="btn btn-outline btn-primary mt-2 flex items-center gap-2"
                      >
                        <FolderIcon className="w-5 h-5" />
                        Open Documents
                      </button>
                    ) : (
                      <span className="ml-2 text-base-content/40">No link available</span>
                    )}
                  </div>
                  {/* Expert Note */}
                  <div>
                    <span className="font-medium">Expert Note:</span>
                    <div className="mt-2 p-3 bg-base-200 rounded-lg text-base-content/80">
                      {selectedLead.expert_notes && selectedLead.expert_notes.length > 0
                        ? selectedLead.expert_notes[selectedLead.expert_notes.length - 1].content
                        : <span className='text-base-content/40'>N/A</span>}
                    </div>
                  </div>
                  <div>
                    <span className="font-medium">Handler Notes:</span>
                    <div className="mt-2 p-3 bg-base-200 rounded-lg text-base-content/80">
                      {selectedLead.handler_notes && selectedLead.handler_notes.length > 0
                        ? selectedLead.handler_notes[selectedLead.handler_notes.length - 1].content
                        : <span className='text-base-content/40'>N/A</span>}
                    </div>
                  </div>
                  <div className="flex gap-6">
                    <div>
                      <span className="font-medium">Date Created:</span>
                      <div className="mt-1 text-base-content/80">{format(parseISO(selectedLead.created_at), 'dd/MM/yyyy')}</div>
                    </div>
                    <div>
                      <span className="font-medium">Meeting Date:</span>
                      <div className="mt-1 text-base-content/80">{selectedLead.meetings && selectedLead.meetings.length > 0 ? (() => {
                        const meetingDateStr = [...selectedLead.meetings].sort((a, b) => new Date(b.meeting_date).getTime() - new Date(a.meeting_date).getTime())[0].meeting_date;
                        // Convert YYYY-MM-DD to dd/mm/yyyy format
                        const dateOnly = meetingDateStr.split(' ')[0];
                        const [year, month, day] = dateOnly.split('-');
                        const formattedDate = `${day}/${month}/${year}`;
                        return formattedDate;
                      })() : <span className='text-base-content/40'>N/A</span>}</div>
                    </div>
                  </div>
                  {/* Comments Section */}
                  <div>
                    <span className="font-medium">Comments:</span>
                    <div className="mt-2 space-y-3">
                      {(selectedLead.expert_comments && selectedLead.expert_comments.length > 0) ? (
                        selectedLead.expert_comments.slice().reverse().map((c, idx) => (
                          <div key={idx} className="bg-base-200 rounded-lg p-3 flex flex-col">
                            <span className="text-base-content/90">{c.text}</span>
                            <span className="text-xs text-base-content/50 mt-1">{c.user} · {format(new Date(c.timestamp), 'dd/MM/yyyy HH:mm')}</span>
                          </div>
                        ))
                      ) : (
                        <span className="text-base-content/40">No comments yet.</span>
                      )}
                    </div>
                    <div className="mt-4 flex gap-2">
                      <input
                        type="text"
                        className="input input-bordered flex-1"
                        placeholder="Add a comment..."
                        value={newComment}
                        onChange={e => setNewComment(e.target.value)}
                        disabled={commentSubmitting}
                      />
                      <button
                        className="btn btn-primary"
                        onClick={handleAddComment}
                        disabled={commentSubmitting || !newComment.trim()}
                      >
                        {commentSubmitting ? 'Adding...' : 'Add'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Document Modal Drawer (right) */}
      {isDocumentModalOpen && selectedLead && (
        <div className="fixed inset-0 z-60 flex">
          <div className="fixed inset-0 bg-black/30 transition-opacity duration-300" onClick={() => { setIsDocumentModalOpen(false); setSelectedLead(null); }} />
          <div className="ml-auto w-full max-w-2xl bg-white h-full shadow-2xl p-0 flex flex-col animate-slideInRight z-60 rounded-l-2xl border-l-4 border-primary relative" style={{ boxShadow: '0 0 40px 0 rgba(0,0,0,0.2)' }}>
            <DocumentModal
              isOpen={isDocumentModalOpen}
              onClose={() => { setIsDocumentModalOpen(false); setSelectedLead(null); }}
              leadNumber={selectedLead.lead_number}
              clientName={selectedLead.name}
              onDocumentCountChange={() => {}}
            />
          </div>
        </div>
      )}
      
      {/* Highlighted Cards Panel */}
      <div className={`fixed top-0 right-0 h-full z-40 flex items-start transition-transform duration-300 ${highlightPanelOpen ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ width: 420 }}>
        <div className="relative h-full bg-white shadow-2xl border-l border-base-200 flex flex-col w-full">
          <div className="p-4 border-b border-base-200 flex items-center gap-2">
            <span className="font-bold text-lg">Highlights</span>
            <span className="badge badge-primary">{highlightedLeads.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {highlightedLeads.length === 0 ? (
              <div className="text-base-content/50 text-center mt-12">No highlighted leads yet.</div>
            ) : (
              highlightedLeads.map(lead => (
                <div key={lead.id} className="flex items-start gap-2">
                  {/* Card */}
                  <div
                    className="bg-white rounded-2xl shadow-lg border-2 border-primary/30 hover:shadow-2xl hover:border-primary/60 transition-all duration-200 cursor-pointer flex flex-col gap-2 relative p-4 group"
                    style={{ minHeight: 120, flex: 1 }}
                    onClick={() => handleHighlightCardClick(lead.id)}
                  >
                    {/* Label on top */}
                    {lead.label && (
                      <div className="mb-1 flex justify-start">
                        <span className="px-2 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border-2 border-primary">{lead.label}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-gray-400 tracking-widest">{lead.lead_number}</span>
                      <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                      <span className="font-bold text-base-content truncate text-base">{lead.name}</span>
                    </div>
                    {/* Two rows of content */}
                    <div className="flex flex-row gap-4 text-xs mb-1">
                      <div className="flex items-center gap-1">
                        <span className="font-semibold">Stage:</span>
                        <span>{lead.stage ? getStageName(lead.stage) : 'N/A'}</span>
                      </div>
                    </div>
                    <div className="flex flex-row gap-4 text-xs">
                      <div className="flex items-center gap-1">
                        <span className="font-semibold">Probability:</span>
                        <span>{lead.probability !== undefined && lead.probability !== null ? `${lead.probability}%` : 'N/A'}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="font-semibold">Applicants:</span>
                        <span>{lead.number_of_applicants_meeting ?? 'N/A'}</span>
                      </div>
                    </div>
                  </div>
                  {/* Remove button OUTSIDE the card */}
                  <button
                    className="btn btn-xs btn-error mt-2"
                    title="Remove from highlights"
                    onClick={e => { e.stopPropagation(); handleRemoveHighlight(String(lead.id)); }}
                  >
                    <XMarkIcon className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      {/* Highlight Panel Arrow Toggle (moves to left of panel when open) */}
      <button
        className={`fixed z-50 btn btn-circle btn-primary btn-sm transition-transform duration-300`}
        style={{
          top: 100,
          right: highlightPanelOpen ? 420 : 0,
          boxShadow: '0 2px 8px 0 rgba(0,0,0,0.10)',
          position: 'fixed',
        }}
        onClick={() => setHighlightPanelOpen(!highlightPanelOpen)}
        title={highlightPanelOpen ? 'Close Highlights' : 'Open Highlights'}
      >
        <svg className={`w-6 h-6 transition-transform ${highlightPanelOpen ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
      </button>

      {/* My Stats Modal */}
      {showMyStatsModal && (
        <div className="modal modal-open">
          <div className="modal-box max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-2xl font-bold flex items-center gap-2">
                  <ChartBarIcon className="w-6 h-6" />
                  My Expert Statistics
                </h3>
                <p className="text-sm text-gray-500 mt-1">Last 30 days</p>
              </div>
              <button
                className="btn btn-sm btn-circle btn-ghost"
                onClick={() => setShowMyStatsModal(false)}
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            {loadingStats ? (
              <div className="flex items-center justify-center py-12">
                <span className="loading loading-spinner loading-lg"></span>
                <span className="ml-3">Loading statistics...</span>
              </div>
            ) : expertStats ? (
              <div className="space-y-6">
                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="stat bg-white rounded-lg shadow-[0_10px_30px_rgba(0,0,0,0.15),0_1px_8px_rgba(0,0,0,0.1)] border border-gray-100">
                    <div className="stat-title">Total Opinions</div>
                    <div className="stat-value text-primary">{expertStats.totalOpinions}</div>
                    <div className="stat-desc">Expert examinations</div>
                  </div>
                  <div className="stat bg-white rounded-lg shadow-[0_10px_30px_rgba(0,0,0,0.15),0_1px_8px_rgba(0,0,0,0.1)] border border-gray-100">
                    <div className="stat-title">Feasible (No Check)</div>
                    <div className="stat-value text-success">{expertStats.feasibleNoCheck}</div>
                    <div className="stat-desc">Direct feasibility</div>
                  </div>
                  <div className="stat bg-white rounded-lg shadow-[0_10px_30px_rgba(0,0,0,0.15),0_1px_8px_rgba(0,0,0,0.1)] border border-gray-100">
                    <div className="stat-title">Feasible (Further Check)</div>
                    <div className="stat-value text-warning">{expertStats.feasibleFurtherCheck}</div>
                    <div className="stat-desc">Requires investigation</div>
                  </div>
                  <div className="stat bg-white rounded-lg shadow-[0_10px_30px_rgba(0,0,0,0.15),0_1px_8px_rgba(0,0,0,0.1)] border border-gray-100">
                    <div className="stat-title">Not Feasible</div>
                    <div className="stat-value text-error">{expertStats.noFeasibility}</div>
                    <div className="stat-desc">No feasibility</div>
                  </div>
                </div>

                {/* Bar Chart */}
                <div className="card bg-base-100 shadow-sm">
                  <div className="card-body">
                    <h4 className="card-title mb-4">Feasibility Distribution</h4>
                    <div className="h-80 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={[
                            { name: 'Feasible (No Check)', value: expertStats.feasibleNoCheck },
                            { name: 'Feasible (Further Check)', value: expertStats.feasibleFurtherCheck },
                            { name: 'Not Feasible', value: expertStats.noFeasibility }
                          ]}
                          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="value" fill="#6c4edb" radius={[8, 8, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-gray-500">No statistics available</p>
              </div>
            )}

            <div className="modal-action mt-6">
              <button className="btn btn-primary" onClick={() => setShowMyStatsModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Lead Drawer */}
      {selectedRowId && (
        <EditLeadDrawer
          isOpen={isEditDrawerOpen}
          onClose={() => {
            setIsEditDrawerOpen(false);
            setSelectedRowId(null);
          }}
          lead={leads.find(l => l.id === selectedRowId) as any || null}
          onSave={async () => {
            // Refetch leads after save - trigger useEffect by updating a dependency
            // For now, we'll just close and let the user manually refresh if needed
          }}
        />
      )}

      {/* WhatsApp Modal */}
      {selectedLead && clientForWhatsApp && (
        <SchedulerWhatsAppModal
          isOpen={isWhatsAppModalOpen}
          onClose={() => {
            setIsWhatsAppModalOpen(false);
            setSelectedLead(null);
            setSelectedRowId(null);
          }}
          client={clientForWhatsApp}
        />
      )}

      {/* Email Modal */}
      {selectedLead && clientForEmail && (
        <SchedulerEmailThreadModal
          isOpen={isEmailModalOpen}
          onClose={() => {
            setIsEmailModalOpen(false);
            setSelectedLead(null);
            setSelectedRowId(null);
          }}
          client={clientForEmail}
        />
      )}
    </div>
  );
};

export default ExpertPage; 