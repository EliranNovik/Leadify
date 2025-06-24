import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Link } from 'react-router-dom';
import { AcademicCapIcon, MagnifyingGlassIcon, CalendarIcon } from '@heroicons/react/24/outline';
import { format, parseISO } from 'date-fns';

interface LeadForExpert {
  id: number;
  lead_number: string;
  name: string;
  created_at: string;
  expert?: string;
  topic?: string;
  handler_notes?: { content: string }[];
  meetings: { meeting_date: string }[];
}

const ExpertPage: React.FC = () => {
  const [leads, setLeads] = useState<LeadForExpert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCreatedDate, setFilterCreatedDate] = useState('');
  const [filterMeetingDate, setFilterMeetingDate] = useState('');

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
          )
        `)
        .is('eligibility_status', null)
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
      
      const matchesCreatedDate = filterCreatedDate 
        ? format(parseISO(lead.created_at), 'yyyy-MM-dd') === filterCreatedDate
        : true;

      const matchesMeetingDate = filterMeetingDate
        ? lead.meetings.some(m => m.meeting_date === filterMeetingDate)
        : true;

      return matchesSearch && matchesCreatedDate && matchesMeetingDate;
    });
  }, [leads, searchQuery, filterCreatedDate, filterMeetingDate]);

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="mb-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <AcademicCapIcon className="w-8 h-8 text-primary" />
          Expert Review Queue
        </h1>
      </div>

      {/* Filters and Search */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Search */}
        <div className="relative">
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
        <div className="flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-base-content/50" />
            <input 
              type="date"
              className="input input-bordered w-full"
              value={filterCreatedDate}
              onChange={(e) => setFilterCreatedDate(e.target.value)}
            />
        </div>
        {/* Filter by Meeting Date */}
        <div className="flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-base-content/50" />
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
            <tr className="bg-base-200">
              <th>Lead</th>
              <th>Expert</th>
              <th>Category</th>
              <th>Handler Notes</th>
              <th>Date Created</th>
              <th>Meeting Date</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="text-center p-8">Loading leads...</td></tr>
            ) : filteredLeads.length > 0 ? (
              filteredLeads.map(lead => (
                <tr key={lead.id} className="hover:bg-base-200/50">
                  <td className="font-bold">
                    <Link to={`/clients/${lead.lead_number}?tab=expert`} className="text-black hover:opacity-75">
                      {lead.name} ({lead.lead_number})
                    </Link>
                  </td>
                  <td>{lead.expert || 'N/A'}</td>
                  <td>{lead.topic || 'N/A'}</td>
                  <td className="max-w-xs truncate">{
                    lead.handler_notes && lead.handler_notes.length > 0
                      ? lead.handler_notes[lead.handler_notes.length - 1].content
                      : 'N/A'
                  }</td>
                  <td>{format(parseISO(lead.created_at), 'dd/MM/yyyy')}</td>
                  <td>{lead.meetings.length > 0 ? lead.meetings[0].meeting_date : 'N/A'}</td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={6} className="text-center p-8">No leads requiring eligibility review.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ExpertPage; 