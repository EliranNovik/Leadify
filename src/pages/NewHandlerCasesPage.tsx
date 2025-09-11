import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { ChevronDownIcon, MagnifyingGlassIcon, CalendarIcon, Squares2X2Icon, Bars3Icon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useMsal } from '@azure/msal-react';
import toast from 'react-hot-toast';

// Portal dropdown component
const DropdownPortal: React.FC<{
  anchorRef: React.RefObject<HTMLButtonElement>;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ anchorRef, open, onClose, children }) => {
  const [style, setStyle] = useState<React.CSSProperties>({});
  
  useEffect(() => {
    if (open && anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const dropdownHeight = 250; // max height of dropdown
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      
      // Position above if not enough space below, otherwise below
      const shouldPositionAbove = spaceBelow < dropdownHeight && spaceAbove > dropdownHeight;
      
      const newStyle = {
        position: 'fixed' as const,
        top: shouldPositionAbove ? rect.top - dropdownHeight - 4 : rect.bottom + 4,
        left: rect.left,
        minWidth: rect.width,
        zIndex: 9999999,
      };
      
      setStyle(newStyle);
    }
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      // Temporarily disable to test
      return;
      
      const target = e.target as Element;
      const isInsideDropdown = target.closest('.dropdown-content') || target.closest('.handler-dropdown') || target.closest('[data-dropdown]');
      
      if (!isInsideDropdown && anchorRef.current && !anchorRef.current?.contains(target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open, anchorRef, onClose]);

  if (!open) return null;
  
  return createPortal(
    <div style={style} className="bg-base-100 shadow-xl rounded-lg border border-base-300 min-w-[240px]">
      {children}
    </div>,
    document.body
  );
};

const NewHandlerCasesPage: React.FC = () => {
  const navigate = useNavigate();
  const { instance } = useMsal();
  const [leads, setLeads] = useState<any[]>([]);
  const [handlers, setHandlers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [valueFilter, setValueFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [sortByApplicants, setSortByApplicants] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownAnchors = useRef<{ [key: string]: HTMLButtonElement | null }>({});
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      
      // Fetch leads with stage 'Client signed agreement' and include contracts data
      const { data: leadsData, error: leadsError } = await supabase
        .from('leads')
        .select(`
          *,
          contracts (
            id,
            signed_at,
            applicant_count
          )
        `)
        .eq('stage', 'Client signed agreement')
        .order('created_at', { ascending: false });
      
      if (leadsError) {
        console.error('Error fetching leads:', leadsError);
      } else {
        setLeads(leadsData || []);
      }

      // Fetch employees with bonuses_role 'h' from tenants_employee table
      const { data: handlersData, error: handlersError } = await supabase
        .from('tenants_employee')
        .select('id, display_name, official_name')
        .eq('bonuses_role', 'h')
        .order('display_name');
      
      if (handlersError) {
        console.error('Error fetching handlers:', handlersError);
      } else {
        setHandlers(handlersData || []);
      }
      
      setLoading(false);
    };
    
    fetchData();
  }, []);

  const assignHandler = async (leadId: string, handlerId: string) => {
    setAssigningId(leadId);
    
    try {
      // Get current user info from MSAL
      const account = instance?.getActiveAccount();
      let currentUserFullName = account?.name || 'Unknown User';
      
      // Try to get full_name from database
      if (account?.username) {
        try {
          const { data: userData } = await supabase
            .from('users')
            .select('full_name')
            .eq('email', account.username)
            .single();
          
          if (userData?.full_name) {
            currentUserFullName = userData.full_name;
          }
        } catch (error) {
          console.log('Could not fetch user full_name, using account.name as fallback');
        }
      }
      
      // Get handler details
      const handler = handlers.find(h => h.id === handlerId);
      const handlerName = handler ? (handler.display_name || handler.official_name || 'Unknown Handler') : 'Unknown Handler';
      
      // Update the lead with handler information
      const { error } = await supabase
        .from('leads')
        .update({
          handler: handlerName,
          stage: 'handler_assigned',
          stage_changed_by: currentUserFullName,
          stage_changed_at: new Date().toISOString()
        })
        .eq('id', leadId);
      
      if (error) {
        console.error('Error assigning handler:', error);
        toast.error('Failed to assign handler. Please try again.');
      } else {
        // Remove the lead from the local state
        setLeads(prevLeads => prevLeads.filter(lead => lead.id !== leadId));
        
        // Show success toast
        toast.success(`Handler ${handlerName} assigned successfully!`);
        
        // Close the dropdown
        setOpenDropdown(null);
      }
    } catch (error) {
      console.error('Error assigning handler:', error);
      toast.error('Failed to assign handler. Please try again.');
    } finally {
      setAssigningId(null);
    }
  };

  // Get the most recent contract for a lead
  const getLatestContract = (lead: any) => {
    if (!lead.contracts || lead.contracts.length === 0) return null;
    return lead.contracts.sort((a: any, b: any) => 
      new Date(b.signed_at || b.created_at || 0).getTime() - 
      new Date(a.signed_at || a.created_at || 0).getTime()
    )[0];
  };

  // Filter leads based on search query, date range, and value
  const filteredLeads = leads.filter(lead => {
    const matchesSearch = !searchQuery || 
      lead.lead_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.name?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesDateFrom = !dateFrom || lead.created_at >= dateFrom;
    const matchesDateTo = !dateTo || lead.created_at <= dateTo + 'T23:59:59';
    
    // Value filter
    const balance = lead.balance || lead.proposal_total || 0;
    const matchesValue = valueFilter === 'all' || 
      (valueFilter === 'high' && balance >= 50000) ||
      (valueFilter === 'medium' && balance >= 20000 && balance < 50000) ||
      (valueFilter === 'low' && balance < 20000);
    
    return matchesSearch && matchesDateFrom && matchesDateTo && matchesValue;
  });

  // Sort leads by applicants if sortByApplicants is enabled
  const sortedLeads = sortByApplicants 
    ? [...filteredLeads].sort((a, b) => {
        const aContract = getLatestContract(a);
        const bContract = getLatestContract(b);
        const aApplicants = aContract?.applicant_count || 0;
        const bApplicants = bContract?.applicant_count || 0;
        return bApplicants - aApplicants; // Most applicants first
      })
    : filteredLeads;

  const handleCardClick = (lead: any) => {
    navigate(`/clients/${lead.lead_number}`);
  };

  const handleAssignClick = (e: React.MouseEvent, leadId: string, handlerId: string) => {
    e.stopPropagation();
    assignHandler(leadId, handlerId);
  };

  const toggleDropdown = (e: React.MouseEvent, leadId: string) => {
    e.stopPropagation();
    const newState = openDropdown === leadId ? null : leadId;
    setOpenDropdown(newState);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // Check if the click is inside any dropdown
      const target = e.target as Element;
      const isInsideDropdown = target.closest('.dropdown-content') || target.closest('.handler-dropdown') || target.closest('[data-dropdown]');
      
      if (!isInsideDropdown) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8 flex items-center gap-3">
        <span>New Handler Cases</span>
      </h1>

      {/* Filters */}
      <div className="card bg-base-100 shadow-lg p-6 mb-8">
        <div className="space-y-4">
          {/* Search Bar */}
          <div className="flex flex-col md:flex-row items-start md:items-center gap-2">
            <label className="font-semibold text-sm whitespace-nowrap">Search:</label>
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="Search by lead number, client name..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          
          {/* Date Range */}
          <div className="flex flex-col md:flex-row items-start md:items-center gap-2">
            <label className="font-semibold text-sm whitespace-nowrap">Date Created:</label>
            <div className="flex flex-col sm:flex-row gap-2 w-full">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 flex-1">
                <span className="text-xs text-gray-500 sm:hidden">From:</span>
                <input
                  type="date"
                  className="input input-bordered input-sm w-full"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                />
              </div>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 flex-1">
                <span className="text-xs text-gray-500 sm:hidden">To:</span>
                <input
                  type="date"
                  className="input input-bordered input-sm w-full"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                />
              </div>
            </div>
          </div>
          
          {/* Value and Applicants Filters */}
          <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
            {/* Value Filter */}
            <div className="flex flex-col gap-2">
              <label className="font-semibold text-sm">Filter by Value:</label>
              <div className="flex gap-2">
                <button
                  className={`btn btn-sm ${valueFilter === 'all' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setValueFilter('all')}
                >
                  All
                </button>
                <button
                  className={`btn btn-sm ${valueFilter === 'high' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setValueFilter('high')}
                >
                  High (₪50k+)
                </button>
                <button
                  className={`btn btn-sm ${valueFilter === 'medium' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setValueFilter('medium')}
                >
                  Medium (₪20k-50k)
                </button>
                <button
                  className={`btn btn-sm ${valueFilter === 'low' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setValueFilter('low')}
                >
                  Low (&lt;₪20k)
                </button>
              </div>
            </div>
            
            {/* Sort by Applicants */}
            <div className="flex flex-col gap-2">
              <label className="font-semibold text-sm">Sort by Applicants:</label>
              <button
                className={`btn btn-sm ${sortByApplicants ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setSortByApplicants(!sortByApplicants)}
              >
                {sortByApplicants ? 'Most Applicants First' : 'Sort by Applicants'}
              </button>
            </div>
          </div>
          
          {/* View Toggle and Clear Filters */}
          <div className="flex justify-between items-center">
            <button
              className="btn btn-outline btn-sm flex items-center gap-2"
              onClick={() => setViewMode(viewMode === 'cards' ? 'list' : 'cards')}
              title={viewMode === 'cards' ? 'Switch to List View' : 'Switch to Card View'}
            >
              {viewMode === 'cards' ? (
                <Bars3Icon className="w-5 h-5" />
              ) : (
                <Squares2X2Icon className="w-5 h-5" />
              )}
              <span className="hidden md:inline">{viewMode === 'cards' ? 'List View' : 'Card View'}</span>
            </button>
            
            <button
              className="btn btn-outline btn-sm"
              onClick={() => {
                setSearchQuery('');
                setDateFrom('');
                setDateTo('');
                setValueFilter('all');
                setSortByApplicants(false);
              }}
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">Loading...</div>
      ) : sortedLeads.length === 0 ? (
        <div className="text-center py-12 text-base-content/60">
          {leads.length === 0 ? 'No handler cases found.' : 'No cases match the selected filters.'}
        </div>
      ) : viewMode === 'list' ? (
        // List View
        <div className="overflow-x-auto bg-white rounded-2xl shadow-lg p-6 w-full">
          <table className="table w-full">
            <thead>
              <tr>
                <th className="text-lg font-bold">&nbsp;</th>
                <th className="text-lg font-bold">Lead</th>
                <th className="text-lg font-bold">Client Name</th>
                <th className="text-lg font-bold">Balance</th>
                <th className="text-lg font-bold">Topic</th>
                <th className="text-lg font-bold">Created</th>
                <th className="text-lg font-bold">Signed Date</th>
                <th className="text-lg font-bold">Applicants</th>
                <th className="text-lg font-bold">Category</th>
                <th className="text-lg font-bold">Closer</th>
                <th className="text-lg font-bold">Expert</th>
                <th className="text-lg font-bold">Scheduler</th>
                <th className="text-lg font-bold">Actions</th>
              </tr>
            </thead>
            <tbody className="text-base">
              {sortedLeads.map(lead => {
                const latestContract = getLatestContract(lead);
                return (
                  <tr key={lead.id} className="hover:bg-base-100 cursor-pointer" onClick={() => handleCardClick(lead)}>
                    <td>
                      <span className="badge bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none font-semibold text-xs px-3 py-1 min-w-fit max-w-32 truncate" title={lead.stage || 'Success'}>
                        {lead.stage || 'Success'}
                      </span>
                    </td>
                    <td className="font-bold text-primary">#{lead.lead_number}</td>
                    <td>{lead.name}</td>
                    <td>
                      <div className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg px-3 py-1 inline-block">
                        <span className="text-white font-bold text-sm">
                          ₪{(lead.balance || lead.proposal_total || 0).toLocaleString()}
                        </span>
                      </div>
                    </td>
                    <td>{lead.topic || 'No topic'}</td>
                    <td>{new Date(lead.created_at).toLocaleDateString()}</td>
                    <td>{latestContract?.signed_at ? new Date(latestContract.signed_at).toLocaleDateString() : 'Not signed'}</td>
                    <td>{latestContract?.applicant_count || 'N/A'}</td>
                    <td>{lead.category || 'N/A'}</td>
                    <td>{lead.closer || 'N/A'}</td>
                    <td>{lead.expert || 'N/A'}</td>
                    <td>{lead.scheduler || 'N/A'}</td>
                    <td>
                      <button 
                        ref={el => { dropdownAnchors.current[lead.id] = el; }}
                        className="btn btn-sm bg-black text-white hover:bg-gray-800 border-none gap-2"
                        onClick={(e) => toggleDropdown(e, lead.id)}
                      >
                        <span>Assign</span>
                        <ChevronDownIcon className="w-4 h-4" />
                      </button>
                      <DropdownPortal anchorRef={{ current: dropdownAnchors.current[lead.id] }} open={openDropdown === lead.id} onClose={() => setOpenDropdown(null)}>
                        <div 
                          className="dropdown-content handler-dropdown bg-white rounded-lg shadow-lg border border-base-200 min-w-[200px] max-h-[250px] overflow-y-auto z-50" 
                          style={{ maxHeight: '250px', top: 'auto', bottom: '100%' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {handlers.length === 0 ? (
                            <div className="p-4 text-center">
                              <span className="text-gray-500">No handlers available</span>
                            </div>
                          ) : (
                            <div className="py-2">
                              {handlers.map(handler => (
                                <button 
                                  key={handler.id}
                                  className="w-full text-center py-3 px-4 hover:bg-base-200 text-base font-medium block text-center" 
                                  onClick={(e) => handleAssignClick(e, lead.id, handler.id)}
                                >
                                  {assigningId === lead.id ? <span className="loading loading-spinner loading-xs"></span> : null}
                                  <span className="inline-block w-full text-center">{handler.display_name || handler.official_name || 'Unknown Handler'}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </DropdownPortal>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        // Card View
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sortedLeads.map(lead => {
            const latestContract = getLatestContract(lead);
            return (
              <div 
                key={lead.id} 
                className="card bg-base-100 shadow-lg hover:shadow-2xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 cursor-pointer group"
                onClick={() => handleCardClick(lead)}
              >
                <div className="card-body p-5">
                  {/* Balance Amount */}
                  <div className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl shadow-lg p-3 mb-4">
                    <div className="text-center">
                      <div className="text-white text-lg font-bold">
                        ₪{(lead.balance || lead.proposal_total || 0).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex justify-between items-center mb-2">
                    <h2 className="card-title text-xl font-bold group-hover:text-primary transition-colors">
                      {lead.name}
                    </h2>
                    <span className="badge bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none">
                      {lead.stage || 'Success'}
                    </span>
                  </div>
                  
                  <p className="text-sm text-base-content/60 font-mono mb-4">#{lead.lead_number}</p>

                  <div className="divider my-0"></div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mt-4">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-base-content/50 uppercase tracking-wide">Date Created</span>
                      <span className="font-medium">{new Date(lead.created_at).toLocaleDateString()}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-base-content/50 uppercase tracking-wide">Signed Date</span>
                      <span className="font-medium">
                        {latestContract?.signed_at ? new Date(latestContract.signed_at).toLocaleDateString() : 'Not signed'}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-base-content/50 uppercase tracking-wide">Applicants</span>
                      <span className="font-medium">{latestContract?.applicant_count || 'N/A'}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-base-content/50 uppercase tracking-wide">Contracts</span>
                      <span className="font-medium">{lead.contracts ? lead.contracts.length : 0}</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-base-200/50">
                    <p className="text-sm font-semibold text-base-content/80">{lead.topic || 'No topic specified'}</p>
                    <div className="flex items-center gap-4 mt-2">
                      <span className="text-xs text-base-content/60">Category: {lead.category || 'N/A'}</span>
                      <span className="text-xs text-base-content/60">Closer: {lead.closer || 'N/A'}</span>
                      <span className="text-xs text-base-content/60">Expert: {lead.expert || 'N/A'}</span>
                      <span className="text-xs text-base-content/60">Scheduler: {lead.scheduler || 'N/A'}</span>
                    </div>
                  </div>

                  {/* Assign Handler Button */}
                  <div className="mt-4 pt-4 border-t border-base-200/50">
                    <button 
                      ref={el => { dropdownAnchors.current[lead.id] = el; }}
                      className="btn bg-black text-white hover:bg-gray-800 border-none gap-2 w-full"
                      onClick={(e) => toggleDropdown(e, lead.id)}
                    >
                      <span>Assign Handler</span>
                      <ChevronDownIcon className="w-5 h-5" />
                    </button>
                    <DropdownPortal anchorRef={{ current: dropdownAnchors.current[lead.id] }} open={openDropdown === lead.id} onClose={() => setOpenDropdown(null)}>
                      <div 
                        className="dropdown-content handler-dropdown bg-white rounded-lg shadow-lg border border-base-200 min-w-[200px] max-h-[250px] overflow-y-auto z-50" 
                        style={{ maxHeight: '250px', top: 'auto', bottom: '100%' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {handlers.length === 0 ? (
                          <div className="p-4 text-center">
                            <span className="text-gray-500">No handlers available</span>
                          </div>
                        ) : (
                          <div className="py-2">
                            {handlers.map(handler => (
                              <button 
                                key={handler.id}
                                className="w-full text-center py-3 px-4 hover:bg-base-200 text-base font-medium block text-center" 
                                onClick={(e) => handleAssignClick(e, lead.id, handler.id)}
                              >
                                {assigningId === lead.id ? <span className="loading loading-spinner loading-xs"></span> : null}
                                <span className="inline-block w-full text-center">{handler.display_name || handler.official_name || 'Unknown Handler'}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </DropdownPortal>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default NewHandlerCasesPage;