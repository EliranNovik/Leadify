import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { ChevronDownIcon, MagnifyingGlassIcon, CalendarIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useMsal } from '@azure/msal-react';

const schedulers = ['Anna Zh', 'Mindi', 'Sarah L', 'David K', 'Yael', 'Michael R'];

const categories = [
  'German Citizenship',
  'Austrian Citizenship', 
  'General Inquiry',
  'Proposal Discussion',
  'New Business Opportunity'
];

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
      setStyle({
        position: 'fixed',
        top: rect.bottom + 4, // 4px gap
        left: rect.left,
        minWidth: rect.width,
        zIndex: 9999999,
      });
    }
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
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

const NewCasesPage: React.FC = () => {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownAnchors = useRef<{ [key: string]: HTMLButtonElement | null }>({});

  useEffect(() => {
    const fetchLeads = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('stage', 'created')
        .order('created_at', { ascending: false });
      setLeads(data || []);
      setLoading(false);
    };
    fetchLeads();
  }, []);

  // Get unique topics from leads for dynamic category options
  const availableTopics = [...new Set(leads.map(lead => lead.topic).filter(Boolean))];
  const dynamicCategories = availableTopics.length > 0 ? availableTopics : categories;

  const assignScheduler = async (leadId: string, scheduler: string) => {
    setAssigningId(leadId);
    
    try {
      // Get current user info from MSAL
      const { instance } = useMsal();
      const account = instance?.getAllAccounts()[0];
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

      await supabase
        .from('leads')
        .update({ 
          scheduler, 
          stage: 'scheduler_assigned',
          stage_changed_by: currentUserFullName,
          stage_changed_at: new Date().toISOString()
        })
        .eq('id', leadId);
      setLeads(leads.filter(l => l.id !== leadId));
      setAssigningId(null);
      setOpenDropdown(null);
    } catch (error) {
      console.error('Error assigning scheduler:', error);
      alert('Failed to assign scheduler. Please try again.');
    }
  };

  // Filter leads based on category and date
  const filteredLeads = leads.filter(lead => {
    const matchesCategory = !categoryFilter || lead.topic === categoryFilter;
    const matchesDate = !dateFilter || lead.created_at.startsWith(dateFilter);
    return matchesCategory && matchesDate;
  });

  const handleCardClick = (lead: any) => {
    navigate(`/clients/${lead.lead_number}`);
  };

  const handleAssignClick = (e: React.MouseEvent, leadId: string, scheduler: string) => {
    e.stopPropagation();
    assignScheduler(leadId, scheduler);
  };

  const toggleDropdown = (e: React.MouseEvent, leadId: string) => {
    e.stopPropagation();
    setOpenDropdown(openDropdown === leadId ? null : leadId);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setOpenDropdown(null);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8 flex items-center gap-3">
        <span>New Cases</span>
      </h1>

      {/* Filters */}
      <div className="card bg-base-100 shadow-lg p-6 mb-8">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Category Filter */}
          <div className="flex-1">
            <label className="label">
              <span className="label-text font-semibold">Filter by Category</span>
            </label>
            <select 
              className="select select-bordered w-full"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All Categories</option>
              {dynamicCategories.map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>

          {/* Date Filter */}
          <div className="flex-1">
            <label className="label">
              <span className="label-text font-semibold">Filter by Date Created</span>
            </label>
            <input 
              type="date" 
              className="input input-bordered w-full"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
            />
          </div>

          {/* Clear Filters */}
          <div className="flex items-end">
            <button 
              className="btn btn-outline"
              onClick={() => {
                setCategoryFilter('');
                setDateFilter('');
              }}
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">Loading...</div>
      ) : filteredLeads.length === 0 ? (
        <div className="text-center py-12 text-base-content/60">
          {leads.length === 0 ? 'No new cases found.' : 'No cases match the selected filters.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredLeads.map(lead => (
            <div key={lead.id} className="card bg-base-100 shadow-lg p-6 flex flex-col gap-4 relative transition-all duration-300 ease-out hover:scale-105 hover:shadow-lg hover:bg-base-50 cursor-pointer" onClick={() => handleCardClick(lead)}>
              {/* Stage Badge */}
              <div className="absolute top-4 right-4">
                <span className="badge badge-primary">
                  {lead.stage || 'created'}
                </span>
              </div>
              
              <div className="font-bold text-lg">{lead.name} <span className="text-base-content/50">({lead.lead_number})</span></div>
              <div className="text-base-content/70">{lead.topic || 'No topic'}</div>
              <div className="text-base-content/70">Created: {new Date(lead.created_at).toLocaleString()}</div>
              <div className="mt-2 relative">
                <button 
                  ref={el => { dropdownAnchors.current[lead.id] = el; }}
                  className="btn bg-black text-white hover:bg-gray-800 border-none gap-2 min-w-[160px]"
                  onClick={(e) => toggleDropdown(e, lead.id)}
                >
                  <span>Assign to</span>
                  <ChevronDownIcon className="w-5 h-5" />
                </button>
                <DropdownPortal anchorRef={{ current: dropdownAnchors.current[lead.id] }} open={openDropdown === lead.id} onClose={() => setOpenDropdown(null)}>
                  <ul className="menu p-2">
                    {schedulers.map(s => (
                      <li key={s}>
                        <a 
                          className="flex items-center gap-3 py-3 hover:bg-base-200 rounded" 
                          onClick={(e) => handleAssignClick(e, lead.id, s)}
                        >
                          {assigningId === lead.id ? <span className="loading loading-spinner loading-xs"></span> : null}
                          {s}
                        </a>
                      </li>
                    ))}
                  </ul>
                </DropdownPortal>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default NewCasesPage; 