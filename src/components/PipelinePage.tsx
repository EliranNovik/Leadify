import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Link } from 'react-router-dom';
import { AcademicCapIcon, MagnifyingGlassIcon, CalendarIcon, ChevronUpIcon, ChevronDownIcon, XMarkIcon, UserIcon, ChatBubbleLeftRightIcon, FolderIcon, ChartBarIcon, QuestionMarkCircleIcon, PhoneIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import { format, parseISO } from 'date-fns';
import DocumentModal from './DocumentModal';

interface LeadForPipeline {
  id: number;
  lead_number: string;
  name: string;
  created_at: string;
  expert?: string;
  topic?: string;
  handler_notes?: { content: string }[];
  expert_notes?: { content: string }[];
  meetings: { meeting_date: string }[];
  onedrive_folder_link?: string;
  stage?: string;
  number_of_applicants_meeting?: number;
  potential_applicants_meeting?: number;
  balance?: number;
  balance_currency?: string;
  probability?: number;
  eligibility_status?: string | null;
  next_followup?: string | null;
  manual_interactions?: any[];
  email?: string;
  mobile?: string;
  phone?: string;
}

const getCurrencySymbol = (currencyCode?: string) => {
  switch (currencyCode) {
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    case 'NIS':
      return '₪';
    default:
      return '$';
  }
};

const PipelinePage: React.FC = () => {
  const [leads, setLeads] = useState<LeadForPipeline[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCreatedDate, setFilterCreatedDate] = useState('');
  const [filterMeetingDate, setFilterMeetingDate] = useState('');
  const [sortColumn, setSortColumn] = useState<'created_at' | 'meeting_date' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [selectedLead, setSelectedLead] = useState<LeadForPipeline | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [contactDrawerOpen, setContactDrawerOpen] = useState(false);
  const [newContact, setNewContact] = useState({
    method: 'email',
    date: '',
    time: '',
    length: '',
    content: '',
    observation: '',
  });

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
          expert_notes,
          meetings (
            meeting_date
          ),
          onedrive_folder_link,
          stage,
          number_of_applicants_meeting,
          potential_applicants_meeting,
          balance,
          balance_currency,
          probability,
          eligibility_status,
          next_followup,
          manual_interactions,
          email,
          mobile,
          phone
        `)
        .order('created_at', { ascending: false });
      console.log('PipelinePage leads fetch:', { data, error });
      if (error) {
        console.error('Error fetching leads for pipeline page:', error);
        setLeads([]);
      } else {
        setLeads(data as LeadForPipeline[]);
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
      const matchesCreatedDate = filterCreatedDate 
        ? format(parseISO(lead.created_at), 'yyyy-MM-dd') === filterCreatedDate
        : true;
      const matchesMeetingDate = filterMeetingDate
        ? lead.meetings.some(m => m.meeting_date === filterMeetingDate)
        : true;
      return matchesSearch && matchesCreatedDate && matchesMeetingDate;
    });
  }, [leads, searchQuery, filterCreatedDate, filterMeetingDate]);

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

  const handleRowClick = (lead: LeadForPipeline) => {
    setSelectedLead(lead);
    setDrawerOpen(true);
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    setTimeout(() => setSelectedLead(null), 400);
  };

  const openContactDrawer = () => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear().toString().slice(-2)}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    setNewContact({
      method: 'email',
      date,
      time,
      length: '',
      content: '',
      observation: '',
    });
    setContactDrawerOpen(true);
    setDrawerOpen(false);
  };

  const closeContactDrawer = () => {
    setContactDrawerOpen(false);
  };

  const handleNewContactChange = (field: string, value: string) => {
    setNewContact((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveContact = async () => {
    if (!selectedLead) return;

    const now = new Date();
    const newInteraction = {
      id: `manual_${now.getTime()}`,
      date: newContact.date || now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }),
      time: newContact.time || now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      raw_date: now.toISOString(),
      employee: 'Current User',
      direction: 'out',
      kind: newContact.method,
      length: newContact.length ? `${newContact.length}m` : '',
      content: newContact.content,
      observation: newContact.observation,
      editable: true,
    };

    try {
      const existingInteractions = selectedLead.manual_interactions || [];
      const updatedInteractions = [...existingInteractions, newInteraction];

      const { error: updateError } = await supabase
        .from('leads')
        .update({ manual_interactions: updatedInteractions })
        .eq('id', selectedLead.id);

      if (updateError) throw updateError;
      
      // Update local state
      setSelectedLead({ ...selectedLead, manual_interactions: updatedInteractions });
      closeContactDrawer();
      
      // Refresh leads data
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
            expert_notes,
            meetings (
              meeting_date
            ),
            onedrive_folder_link,
            stage,
            number_of_applicants_meeting,
            potential_applicants_meeting,
            balance,
            balance_currency,
            probability,
            eligibility_status,
            next_followup,
            manual_interactions,
            email,
            mobile,
            phone
          `)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Error fetching leads for pipeline page:', error);
          setLeads([]);
        } else {
          setLeads(data as LeadForPipeline[]);
        }
        setIsLoading(false);
      };
      
      await fetchLeads();
    } catch (error) {
      console.error('Error saving contact:', error);
    }
  };

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="mb-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <ChartBarIcon className="w-8 h-8 text-primary" />
          Pipeline
        </h1>
      </div>
      {/* Filters and Search */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Search */}
        <div className="relative flex items-center h-full">
          <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-base-content/50" />
          <input
            type="text"
            placeholder="Search by name or lead..."
            className="input input-bordered w-full pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        {/* Filter by Created Date */}
        <div className="flex items-center h-full">
          <span className="text-xs font-semibold text-base-content/70 mr-2 whitespace-nowrap">Filter by Created Date</span>
          <CalendarIcon className="w-5 h-5 text-base-content/50 mr-2" />
          <input 
            type="date"
            className="input input-bordered w-full"
            value={filterCreatedDate}
            onChange={(e) => setFilterCreatedDate(e.target.value)}
          />
        </div>
        {/* Filter by Meeting Date */}
        <div className="flex items-center h-full">
          <span className="text-xs font-semibold text-base-content/70 mr-2 whitespace-nowrap">Filter by Meeting Date</span>
          <CalendarIcon className="w-5 h-5 text-base-content/50 mr-2" />
          <input 
            type="date"
            className="input input-bordered w-full"
            value={filterMeetingDate}
            onChange={(e) => setFilterMeetingDate(e.target.value)}
          />
        </div>
      </div>
      {/* Leads Table */}
      <div className="bg-base-100 rounded-lg shadow-lg overflow-x-auto">
        <table className="table w-full">
          <thead>
            <tr className="bg-primary">
              <th className="text-white">Lead</th>
              <th className="text-white">Expert</th>
              <th className="text-white">Category</th>
              <th className="text-white">Stage</th>
              <th className="text-white">Total Applicants</th>
              <th className="text-white">Potential Applicants</th>
              <th className="text-white">Offer (Balance)</th>
              <th className="text-white">Probability (%)</th>
              <th className="text-white">Handler Notes</th>
              <th className="cursor-pointer select-none text-white" onClick={() => handleSort('meeting_date')}>
                <span className="inline-flex items-center gap-1">   
                  Meeting Date
                  {sortColumn === 'meeting_date' && (
                    sortDirection === 'asc' ? <ChevronUpIcon className="w-4 h-4 inline text-white" /> : <ChevronDownIcon className="w-4 h-4 inline text-white" />
                  )}
                </span>
              </th>
              <th className="text-white">Follow Up Date</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={12} className="text-center p-8">Loading leads...</td></tr>
            ) : sortedLeads.length > 0 ? (
              sortedLeads.map((lead, index) => (
                <tr key={lead.id} className={`cursor-pointer transition-all duration-200 hover:shadow-lg hover:bg-gray-100 hover:scale-[1.01] border-b border-base-200/50 ${index % 2 === 0 ? 'bg-base-50/30' : 'bg-base-100'}`} onClick={() => handleRowClick(lead)}>
                  <td className="font-bold py-4">
                    <Link to={`/clients/${lead.lead_number}?tab=expert`} className="text-black hover:opacity-75">
                      {lead.name} ({lead.lead_number})
                    </Link>
                  </td>
                  <td className="py-4">{
                    lead.eligibility_status && lead.eligibility_status !== ''
                      ? <AcademicCapIcon className="w-6 h-6 text-primary mx-auto" title="Feasibility chosen" />
                      : <QuestionMarkCircleIcon className="w-6 h-6 text-warning mx-auto" title="Feasibility not chosen" />
                  }</td>
                  <td className="py-4">{lead.topic || 'N/A'}</td>
                  <td className="py-4">{lead.stage || 'N/A'}</td>
                  <td className="py-4">{lead.number_of_applicants_meeting ?? 'N/A'}</td>
                  <td className="py-4">{lead.potential_applicants_meeting ?? 'N/A'}</td>
                  <td className="py-4 font-semibold">{lead.balance !== undefined && lead.balance !== null 
                    ? `${getCurrencySymbol(lead.balance_currency)}${lead.balance}` 
                    : 'N/A'}</td>
                  <td className="py-4">{lead.probability !== undefined && lead.probability !== null ? `${lead.probability}%` : 'N/A'}</td>
                  <td className="max-w-xs truncate py-4">{
                    lead.handler_notes && lead.handler_notes.length > 0
                      ? lead.handler_notes[lead.handler_notes.length - 1].content
                      : 'N/A'
                  }</td>
                  <td className="py-4">{lead.meetings.length > 0 ? lead.meetings[0].meeting_date : 'N/A'}</td>
                  <td className="py-4">{lead.next_followup ? format(parseISO(lead.next_followup), 'dd/MM/yyyy') : 'N/A'}</td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={12} className="text-center p-8 text-base-content/60">No leads found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
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
              <button className="btn btn-ghost btn-circle" onClick={closeDrawer}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-6 flex-1 overflow-y-auto">
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
              {/* Contact Client Button */}
              <div>
                <span className="font-medium">Contact:</span>
                <button
                  onClick={openContactDrawer}
                  className="btn btn-outline btn-primary mt-2 flex items-center gap-2"
                >
                  <PhoneIcon className="w-5 h-5" />
                  Contact Client
                </button>
              </div>
              {/* Last Interactions */}
              <div>
                <span className="font-medium">Last Interactions:</span>
                <div className="mt-2 p-3 bg-base-200 rounded-lg text-base-content/80">
                  {selectedLead.manual_interactions && selectedLead.manual_interactions.length > 0
                    ? selectedLead.manual_interactions
                        .sort((a, b) => new Date(b.raw_date).getTime() - new Date(a.raw_date).getTime())
                        .slice(0, 3)
                        .map((interaction, index) => (
                          <div key={interaction.id} className={`${index > 0 ? 'mt-2 pt-2 border-t border-base-300' : ''}`}>
                            <div className="flex items-center gap-2 text-sm">
                              <span className="font-medium">{interaction.date} {interaction.time}</span>
                              <span className="badge badge-sm">{interaction.kind}</span>
                            </div>
                            <div className="text-sm mt-1">{interaction.content}</div>
                            {interaction.observation && (
                              <div className="text-xs text-base-content/60 mt-1">{interaction.observation}</div>
                            )}
                          </div>
                        ))
                    : <span className='text-base-content/40'>No interactions recorded</span>}
                </div>
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
                  <div className="mt-1 text-base-content/80">{selectedLead.meetings.length > 0 ? selectedLead.meetings[0].meeting_date : <span className='text-base-content/40'>N/A</span>}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Contact Drawer */}
      {contactDrawerOpen && selectedLead && (
        <div className="fixed inset-0 flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30 transition-opacity duration-300 z-[9998]" onClick={closeContactDrawer} />
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl p-8 flex flex-col z-[9999]">
            <div className="animate-slideInRight h-full flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-bold">Contact Client</h3>
                <button className="btn btn-ghost btn-sm" onClick={closeContactDrawer}>
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>
              <div className="flex flex-col gap-4 flex-1">
                <div>
                  <label className="block font-semibold mb-1">How to contact</label>
                  <select
                    className="select select-bordered w-full"
                    value={newContact.method}
                    onChange={e => handleNewContactChange('method', e.target.value)}
                  >
                    <option value="email">Email</option>
                    <option value="phone">Phone</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="meeting">Meeting</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">Date</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={newContact.date}
                    onChange={e => handleNewContactChange('date', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Time</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={newContact.time}
                    onChange={e => handleNewContactChange('time', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Minutes</label>
                  <input
                    type="number"
                    min="0"
                    className="input input-bordered w-full"
                    value={newContact.length}
                    onChange={e => handleNewContactChange('length', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Content</label>
                  <textarea
                    className="textarea textarea-bordered w-full min-h-[80px]"
                    value={newContact.content}
                    onChange={e => handleNewContactChange('content', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Observation</label>
                  <textarea
                    className="textarea textarea-bordered w-full min-h-[60px]"
                    value={newContact.observation}
                    onChange={e => handleNewContactChange('observation', e.target.value)}
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <button className="btn btn-primary px-8" onClick={handleSaveContact}>
                  Save
                </button>
              </div>
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

export default PipelinePage; 