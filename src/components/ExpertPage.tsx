import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Link } from 'react-router-dom';
import { AcademicCapIcon, MagnifyingGlassIcon, CalendarIcon, ChevronUpIcon, ChevronDownIcon, XMarkIcon, UserIcon, ChatBubbleLeftRightIcon, FolderIcon } from '@heroicons/react/24/outline';
import { format, parseISO } from 'date-fns';
import DocumentModal from './DocumentModal';
import { BarChart3, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { getStageName, initializeStageNames } from '../lib/stageUtils';

const LABEL_OPTIONS = [
  'High Value',
  'Low Value',
  'Potential Clients',
  'High Risk',
  'Low Risk',
];

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
  expert_comments?: { text: string; timestamp: string; user: string }[];
  label?: string | null;
  lead_type?: 'new' | 'legacy';
  highlighted_by?: string[];
}

const ExpertPage: React.FC = () => {
  const [leads, setLeads] = useState<LeadForExpert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMeetingDateFrom, setFilterMeetingDateFrom] = useState('');
  const [filterMeetingDateTo, setFilterMeetingDateTo] = useState('');
  const [sortColumn, setSortColumn] = useState<'created_at' | 'meeting_date' | 'probability' | 'applicants' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [selectedLead, setSelectedLead] = useState<LeadForExpert | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [meetingSort, setMeetingSort] = useState<'upcoming' | 'past'>('upcoming');
  const [viewMode, setViewMode] = useState<'box' | 'list'>('box');
  const [newComment, setNewComment] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [labelFilter, setLabelFilter] = useState('');
  const [labelDropdownOpen, setLabelDropdownOpen] = useState<number | string | null>(null);
  const [labelSubmitting, setLabelSubmitting] = useState(false);
  const [highlightedLeads, setHighlightedLeads] = useState<LeadForExpert[]>([]);
  const [highlightPanelOpen, setHighlightPanelOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

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
            handler_notes,
            meetings (
              meeting_date
            ),
            onedrive_folder_link,
            expert_notes,
            stage,
            probability,
            number_of_applicants_meeting,
            expert_page_comments,
            expert_page_label,
            expert_page_highlighted_by
          `)
          .or('eligibility_status.is.null,eligibility_status.eq.""');

        // Filter new leads by expert field if we have user's full name
        if (currentUserFullName) {
          newLeadsQuery = newLeadsQuery.eq('expert', currentUserFullName);
          console.log('Filtering new leads by expert:', currentUserFullName);
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
            handler_notes,
            expert_notes,
            stage,
            probability,
            no_of_applicants,
            meeting_date,
            meeting_time,
            expert_examination,
            expert_page_comments,
            expert_page_label,
            expert_page_highlighted_by
          `)
          .eq('expert_examination', 0) // Only fetch leads where expert_examination is 0
          .gte('meeting_date', '2025-01-01'); // Only fetch leads with meeting dates from 2025 onwards

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

        // Process new leads
        const processedNewLeads = (newLeadsData || []).map(lead => ({
          ...lead,
          meetings: lead.meetings || [],
          expert_comments: lead.expert_page_comments || [],
          label: lead.expert_page_label || null,
          highlighted_by: lead.expert_page_highlighted_by || [],
          lead_type: 'new' as const
        })).filter(lead => {
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

          return {
            id: `legacy_${lead.id}`,
            lead_number: lead.id?.toString() || '',
            name: lead.name || '',
            created_at: lead.cdate || new Date().toISOString(),
            expert: lead.expert_id ? employeeNameMap[lead.expert_id] || `Employee ${lead.expert_id}` : null,
            topic: lead.topic,
            handler_notes: lead.handler_notes || [],
            meetings: legacyMeetings, // Use the constructed meetings array
            onedrive_folder_link: null,
            expert_notes: lead.expert_notes || [],
            stage: lead.stage?.toString() || '',
            probability: typeof lead.probability === 'string' ? parseFloat(lead.probability) : lead.probability,
            number_of_applicants_meeting: lead.no_of_applicants,
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

        setLeads(allLeads as LeadForExpert[]);
      } catch (error) {
        console.error('Error fetching leads for expert page:', error);
        setLeads([]);
      }
      setIsLoading(false);
    };

    fetchLeads();
  }, []);

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

      // Label filter
      const matchesLabel = labelFilter ? lead.label === labelFilter : true;

      return matchesSearch && matchesMeetingRange && matchesLabel;
    });
  }, [leads, searchQuery, filterMeetingDateFrom, filterMeetingDateTo, labelFilter]);

  // Sorting handler
  const handleSort = (column: 'created_at' | 'meeting_date' | 'probability' | 'applicants') => {
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

  const handleRowClick = (lead: LeadForExpert) => {
    setSelectedLead(lead);
    setDrawerOpen(true);
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

  // Calculate summary statistics
  const summaryStats = useMemo(() => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Total Archival Checks (assuming each lead is an archival check)
    const archivalChecks = leads.filter(lead => new Date(lead.created_at) >= thirtyDaysAgo).length;

    // Top Worker (expert with most leads in last 30 days)
    const expertCounts: Record<string, number> = {};
    leads.filter(lead => new Date(lead.created_at) >= thirtyDaysAgo).forEach(lead => {
      const expert = lead.expert || 'Unknown';
      expertCounts[expert] = (expertCounts[expert] || 0) + 1;
    });
    let topWorker = 'N/A';
    let topWorkerCount = 0;
    Object.entries(expertCounts).forEach(([expert, count]) => {
      if (count > topWorkerCount) {
        topWorker = expert;
        topWorkerCount = count;
      }
    });

    // Total leads
    const totalLeads = leads.length;

    return {
      archivalChecks,
      topWorker,
      topWorkerCount,
      totalLeads
    };
  }, [leads]);

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
          <div className="flex flex-col min-w-[220px]">
            <label className="text-xs font-semibold text-base-content/70 mb-1">Meeting Date</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                className="input input-bordered w-full max-w-[110px]"
                value={filterMeetingDateFrom}
                onChange={e => setFilterMeetingDateFrom(e.target.value)}
                placeholder="From"
              />
              <span className="mx-2 text-base-content/50">-</span>
              <input
                type="date"
                className="input input-bordered w-full max-w-[110px]"
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
          {/* Filter by Label */}
          <div className="flex flex-col min-w-[180px]">
            <label className="text-xs font-semibold text-base-content/70 mb-1">Label</label>
            <select
              className="select select-bordered w-full"
              value={labelFilter}
              onChange={e => setLabelFilter(e.target.value)}
            >
              <option value="">All</option>
              {LABEL_OPTIONS.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
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
              <p className="text-xl font-bold truncate">{summaryStats.topWorker}</p>
              <p className="text-white/90 text-xs mt-1">{summaryStats.topWorkerCount} lead{summaryStats.topWorkerCount === 1 ? '' : 's'} (last 30 days)</p>
            </div>
            <div className="bg-white/20 rounded-full p-3">
                <UserIcon className="w-8 h-8" />
            </div>
          </div>
        </div>
        {/* Total Leads */}
        <div className="bg-gradient-to-tr from-teal-400 via-green-400 to-green-600 rounded-2xl p-6 text-white shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:scale-105">
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

      {/* View toggle button */}
      <div className="flex justify-end mb-4">
        <button
          className={`btn btn-sm mr-2 ${viewMode === 'box' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setViewMode('box')}
        >
          Box View
        </button>
        <button
          className={`btn btn-sm ${viewMode === 'list' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setViewMode('list')}
        >
          List View
        </button>
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
                {/* Expert */}
                <div className="flex justify-between items-center py-1">
                    <span className="text-sm font-semibold text-gray-500">Expert</span>
                    <span className="text-base font-bold text-gray-800 ml-2">{lead.expert || 'N/A'}</span>
                </div>
                {/* Stage */}
                <div className="flex justify-between items-center py-1">
                    <span className="text-sm font-semibold text-gray-500">Stage</span>
                    <span className={'text-sm font-bold ml-2 px-2 py-1 rounded bg-[#3b28c7] text-white'}>
                    {lead.stage ? getStageName(lead.stage) : 'N/A'}
                  </span>
                </div>
                {/* Category */}
                <div className="flex justify-between items-center py-1">
                    <span className="text-sm font-semibold text-gray-500">Category</span>
                    <span className="text-base font-bold text-gray-800 ml-2">{lead.topic || 'N/A'}</span>
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
                {/* Meeting Date */}
                <div className="flex justify-between items-center py-1">
                    <span className="text-sm font-semibold text-gray-500">Meeting Date</span>
                    <span className={`text-sm font-bold ml-2 px-2 py-1 rounded ${meetingSort === 'past' ? 'bg-purple-600 text-white' : 'bg-[#22c55e] text-white'}`}> 
                    {lead.meetings && lead.meetings.length > 0 ? (() => {
                      const meetingDateStr = lead.meetings[0].meeting_date;
                      // Since meeting_date is stored as text, extract the date part and format it
                      const dateOnly = meetingDateStr.split(' ')[0];
                      // Convert YYYY-MM-DD to dd/mm/yyyy format
                      const [year, month, day] = dateOnly.split('-');
                      const formattedDate = `${day}/${month}/${year}`;
                      return formattedDate;
                    })() : 'N/A'}
                  </span>
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
          <table className="table w-full text-lg">
            <thead>
              <tr>
                <th>Lead #</th>
                <th>Name</th>
                <th>Expert</th>
                <th>Stage</th>
                <th>Category</th>
                <th 
                  className="cursor-pointer hover:bg-base-200 transition-colors"
                  onClick={() => handleSort('created_at')}
                >
                  Date Created
                  {sortColumn === 'created_at' && (
                    <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>
                  )}
                </th>
                <th 
                  className="cursor-pointer hover:bg-base-200 transition-colors"
                  onClick={() => handleSort('probability')}
                >
                  Probability
                  {sortColumn === 'probability' && (
                    <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>
                  )}
                </th>
                <th 
                  className="cursor-pointer hover:bg-base-200 transition-colors"
                  onClick={() => handleSort('applicants')}
                >
                  Applicants
                  {sortColumn === 'applicants' && (
                    <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>
                  )}
                </th>
                <th 
                  className="cursor-pointer hover:bg-base-200 transition-colors"
                  onClick={() => handleSort('meeting_date')}
                >
                  Meeting Date
                  {sortColumn === 'meeting_date' && (
                    <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>
                  )}
                </th>
                <th>Label</th>
              </tr>
            </thead>
            <tbody>
              {meetingSortedLeads.map((lead) => (
                <tr key={lead.id} className="hover:bg-blue-50 cursor-pointer" onClick={() => handleRowClick(lead)}>
                  <td>{lead.lead_number}</td>
                  <td className="font-bold">{lead.name}</td>
                  <td>{lead.expert || 'N/A'}</td>
                  <td>{lead.stage ? getStageName(lead.stage) : 'N/A'}</td>
                  <td>{lead.topic || 'N/A'}</td>
                  <td>{format(parseISO(lead.created_at), 'dd/MM/yyyy')}</td>
                  <td>{lead.probability !== undefined && lead.probability !== null ? `${lead.probability}%` : 'N/A'}</td>
                  <td>{lead.number_of_applicants_meeting ?? 'N/A'}</td>
                  <td>{lead.meetings && lead.meetings.length > 0 ? (() => {
                    const meetingDateStr = [...lead.meetings].sort((a, b) => new Date(b.meeting_date).getTime() - new Date(a.meeting_date).getTime())[0].meeting_date;
                    // Convert YYYY-MM-DD to dd/mm/yyyy format
                    const dateOnly = meetingDateStr.split(' ')[0];
                    const [year, month, day] = dateOnly.split('-');
                    const formattedDate = `${day}/${month}/${year}`;
                    return formattedDate;
                  })() : 'N/A'}</td>
                  <td>{lead.label ? <span className="badge badge-outline badge-primary font-semibold">{lead.label}</span> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
                    <AcademicCapIcon className="w-6 h-6 text-base-content/70" />
                    <span className="font-medium">Expert:</span>
                    <span>{selectedLead.expert || <span className='text-base-content/40'>Not assigned</span>}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <ChatBubbleLeftRightIcon className="w-6 h-6 text-base-content/70" />
                    <span className="font-medium">Category:</span>
                    <span>{selectedLead.topic || <span className='text-base-content/40'>N/A</span>}</span>
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
                      <div className="flex items-center gap-1">
                        <span className="font-semibold">Expert:</span>
                        <span>{lead.expert || 'N/A'}</span>
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
    </div>
  );
};

export default ExpertPage; 