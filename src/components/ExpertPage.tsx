import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Link } from 'react-router-dom';
import { AcademicCapIcon, MagnifyingGlassIcon, CalendarIcon, ChevronUpIcon, ChevronDownIcon, XMarkIcon, UserIcon, ChatBubbleLeftRightIcon, FolderIcon } from '@heroicons/react/24/outline';
import { format, parseISO } from 'date-fns';
import DocumentModal from './DocumentModal';
import { BarChart3, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';

interface LeadForExpert {
  id: number;
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
}

const ExpertPage: React.FC = () => {
  const [leads, setLeads] = useState<LeadForExpert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMeetingDateFrom, setFilterMeetingDateFrom] = useState('');
  const [filterMeetingDateTo, setFilterMeetingDateTo] = useState('');
  const [sortColumn, setSortColumn] = useState<'created_at' | 'meeting_date' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [selectedLead, setSelectedLead] = useState<LeadForExpert | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [meetingSort, setMeetingSort] = useState<'upcoming' | 'past'>('upcoming');
  const [viewMode, setViewMode] = useState<'box' | 'list'>('box');

  useEffect(() => {
    const fetchLeads = async () => {
      setIsLoading(true);
      
      const { data, error } = await supabase
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
          number_of_applicants_meeting
        `)
        .or('eligibility_status.is.null,eligibility_status.eq.""')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching leads for expert page:', error);
        setLeads([]);
      } else {
        setLeads(data as LeadForExpert[]);
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
          if (filterMeetingDateFrom && meetingDate < filterMeetingDateFrom) matchesMeetingRange = false;
          if (filterMeetingDateTo && meetingDate > filterMeetingDateTo) matchesMeetingRange = false;
        } else {
          // If no meeting date, exclude if filtering by range
          matchesMeetingRange = false;
        }
      }
      return matchesSearch && matchesMeetingRange;
    });
  }, [leads, searchQuery, filterMeetingDateFrom, filterMeetingDateTo]);

  // Sorting handler
  const handleSort = (column: 'created_at' | 'meeting_date') => {
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
      const sortedMeetings = [...lead.meetings].filter(m => m.meeting_date).sort((a, b) => new Date(b.meeting_date).getTime() - new Date(a.meeting_date).getTime());
      if (!sortedMeetings.length) return null;
      return new Date(sortedMeetings[0].meeting_date);
    }
    type LeadWithLatest = LeadForExpert & { _latestMeetingDate: Date | null };
    return (sortedLeads as LeadForExpert[])
      .map(lead => ({ ...lead, _latestMeetingDate: getLatestMeetingDate(lead) } as LeadWithLatest))
      .filter(lead => {
        if (meetingSort === 'upcoming') {
          // Include leads with no meeting date (N/A) or with a future/today meeting
          return !lead._latestMeetingDate || isNaN(lead._latestMeetingDate.getTime()) || lead._latestMeetingDate >= today;
        } else {
          // Only leads with a valid past meeting date
          return lead._latestMeetingDate && !isNaN(lead._latestMeetingDate.getTime()) && lead._latestMeetingDate < today;
        }
      })
      .sort((a, b) => {
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
  }, [sortedLeads, meetingSort, today]);

  const handleRowClick = (lead: LeadForExpert) => {
    setSelectedLead(lead);
    setDrawerOpen(true);
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    setTimeout(() => setSelectedLead(null), 400); // Wait for animation
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
        </div>
      </div>

      {/* Summary Statistics Cards */}
      <div className="mb-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Total Archival Checks */}
        <div className="bg-[#22c55e] rounded-2xl p-6 text-white shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:scale-105 border border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/80 text-sm font-medium">Total Archival Checks Done</p>
              <p className="text-3xl font-bold drop-shadow">{summaryStats.archivalChecks}</p>
              <p className="text-white/70 text-xs mt-1">Last 30 days</p>
            </div>
            <div className="bg-white/20 rounded-full p-3">
              <AcademicCapIcon className="w-8 h-8 text-white/90" />
            </div>
          </div>
        </div>
        {/* Top Worker */}
        <div className="bg-[#3b82f6] rounded-2xl p-6 text-white shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:scale-105 border border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/80 text-sm font-medium">Top Expert</p>
              <p className="text-xl font-bold truncate drop-shadow">{summaryStats.topWorker}</p>
              <p className="text-white/70 text-xs mt-1">{summaryStats.topWorkerCount} lead{summaryStats.topWorkerCount === 1 ? '' : 's'} (last 30 days)</p>
            </div>
            <div className="bg-white/20 rounded-full p-3">
                <UserIcon className="w-8 h-8 text-white/90" />
            </div>
          </div>
        </div>
        {/* Total Leads */}
        <div className="bg-gradient-to-br from-[#c084fc] to-[#a21caf] rounded-2xl p-6 text-white shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:scale-105 border border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/80 text-sm font-medium">Total Leads</p>
              <p className="text-3xl font-bold drop-shadow">{summaryStats.totalLeads}</p>
              <p className="text-white/70 text-xs mt-1">In pipeline</p>
            </div>
            <div className="bg-[#c084fc]/30 rounded-full flex items-center justify-center" style={{ width: 80, height: 80 }}>
              <BarChart3 className="w-10 h-10 text-white" />
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
                className="bg-white rounded-2xl p-6 shadow-md hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 cursor-pointer border border-gray-100 group"
            >
              {/* Lead Number and Name */}
              <div className="mb-3 flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-400 tracking-widest">{lead.lead_number}</span>
                <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                  <h3 className="text-2xl font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{lead.name}</h3>
              </div>
              <div className="space-y-2 divide-y divide-gray-100">
                {/* Expert */}
                <div className="flex justify-between items-center py-1">
                    <span className="text-base font-semibold text-gray-500">Expert</span>
                    <span className="text-lg font-bold text-gray-800 ml-2">{lead.expert || 'N/A'}</span>
                </div>
                {/* Stage */}
                <div className="flex justify-between items-center py-1">
                    <span className="text-base font-semibold text-gray-500">Stage</span>
                    <span className={'text-base font-bold ml-2 px-2 py-1 rounded bg-[#3b28c7] text-white'}>
                    {lead.stage ? lead.stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'N/A'}
                  </span>
                </div>
                {/* Category */}
                <div className="flex justify-between items-center py-1">
                    <span className="text-base font-semibold text-gray-500">Category</span>
                    <span className="text-lg font-bold text-gray-800 ml-2">{lead.topic || 'N/A'}</span>
                </div>
                {/* Date Created */}
                <div className="flex justify-between items-center py-1">
                    <span className="text-base font-semibold text-gray-500">Date Created</span>
                    <span className="text-lg font-bold text-gray-800 ml-2">{format(parseISO(lead.created_at), 'dd/MM/yyyy')}</span>
                </div>
                {/* Probability */}
                <div className="flex justify-between items-center py-1">
                    <span className="text-base font-semibold text-gray-500">Probability</span>
                    <span className={`text-lg font-bold ml-2 ${
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
                    <span className="text-base font-semibold text-gray-500">Total Applicants</span>
                    <span className="text-lg font-bold text-gray-800 ml-2">
                    {lead.number_of_applicants_meeting ?? 'N/A'}
                  </span>
                </div>
                {/* Meeting Date */}
                <div className="flex justify-between items-center py-1">
                    <span className="text-base font-semibold text-gray-500">Meeting Date</span>
                    <span className={`text-base font-bold ml-2 px-2 py-1 rounded ${meetingSort === 'past' ? 'bg-purple-600 text-white' : 'bg-[#22c55e] text-white'}`}> 
                    {lead._latestMeetingDate && !isNaN(lead._latestMeetingDate.getTime()) ? format(lead._latestMeetingDate, 'yyyy-MM-dd') : 'N/A'}
                  </span>
                </div>
              </div>
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
          <table className="table table-zebra w-full text-lg">
            <thead>
              <tr>
                <th>Lead #</th>
                <th>Name</th>
                <th>Expert</th>
                <th>Stage</th>
                <th>Category</th>
                <th>Date Created</th>
                <th>Probability</th>
                <th>Applicants</th>
                <th>Meeting Date</th>
              </tr>
            </thead>
            <tbody>
              {meetingSortedLeads.map((lead) => (
                <tr key={lead.id} className="hover:bg-blue-50 cursor-pointer" onClick={() => handleRowClick(lead)}>
                  <td>{lead.lead_number}</td>
                  <td className="font-bold">{lead.name}</td>
                  <td>{lead.expert || 'N/A'}</td>
                  <td>{lead.stage ? lead.stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'N/A'}</td>
                  <td>{lead.topic || 'N/A'}</td>
                  <td>{format(parseISO(lead.created_at), 'dd/MM/yyyy')}</td>
                  <td>{lead.probability !== undefined && lead.probability !== null ? `${lead.probability}%` : 'N/A'}</td>
                  <td>{lead.number_of_applicants_meeting ?? 'N/A'}</td>
                  <td>{lead.meetings && lead.meetings.length > 0 ? [...lead.meetings].sort((a, b) => new Date(b.meeting_date).getTime() - new Date(a.meeting_date).getTime())[0].meeting_date : 'N/A'}</td>
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
                      <div className="mt-1 text-base-content/80">{selectedLead.meetings && selectedLead.meetings.length > 0 ? [...selectedLead.meetings].sort((a, b) => new Date(b.meeting_date).getTime() - new Date(a.meeting_date).getTime())[0].meeting_date : <span className='text-base-content/40'>N/A</span>}</div>
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
    </div>
  );
};

export default ExpertPage; 