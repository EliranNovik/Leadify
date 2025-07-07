import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Link } from 'react-router-dom';
import { CalendarIcon, FunnelIcon, UserIcon, CurrencyDollarIcon, VideoCameraIcon, ChevronDownIcon, DocumentArrowUpIcon, FolderIcon, ClockIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import DocumentModal from './DocumentModal';

const CalendarPage: React.FC = () => {
  const [meetings, setMeetings] = useState<any[]>([]);
  const [filteredMeetings, setFilteredMeetings] = useState<any[]>([]);
  const [staff, setStaff] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [totalAmount, setTotalAmount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedMeetingId, setExpandedMeetingId] = useState<number | null>(null);
  const [expandedMeetingData, setExpandedMeetingData] = useState<{
    [meetingId: number]: {
      loading: boolean;
      expert_notes?: any;
      handler_notes?: any;
    }
  }>({});
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<any>(null);

  // Navigation functions for date switching
  const goToPreviousDay = () => {
    const currentDate = new Date(selectedDate);
    currentDate.setDate(currentDate.getDate() - 1);
    setSelectedDate(currentDate.toISOString().split('T')[0]);
  };

  const goToNextDay = () => {
    const currentDate = new Date(selectedDate);
    currentDate.setDate(currentDate.getDate() + 1);
    setSelectedDate(currentDate.toISOString().split('T')[0]);
  };

  const goToToday = () => {
    setSelectedDate(new Date().toISOString().split('T')[0]);
  };

  useEffect(() => {
    const fetchMeetingsAndStaff = async () => {
      setIsLoading(true);
      // Fetch all meetings
      const { data: meetingsData, error: meetingsError } = await supabase
        .from('meetings')
        .select('*, lead:leads(id, name, lead_number, onedrive_folder_link, stage, manager, category, balance)')
        .order('meeting_date', { ascending: false });
      
      if (meetingsError) {
        console.error('Error fetching meetings:', meetingsError);
      } else {
        setMeetings(meetingsData || []);
      }

      // Fetch distinct staff members (assuming from 'meetings' table)
      const { data: staffData, error: staffError } = await supabase
        .from('meetings')
        .select('meeting_manager');

      if (staffError) {
        console.error('Error fetching staff:', staffError);
      } else {
        const uniqueStaff = [...new Set(staffData.map(item => item.meeting_manager).filter(Boolean))];
        setStaff(uniqueStaff);
      }
      setIsLoading(false);
    };

    fetchMeetingsAndStaff();
  }, []);

  // Fetch latest notes from leads table when a meeting is expanded
  useEffect(() => {
    const fetchExpandedMeetingData = async (meeting: any) => {
      setExpandedMeetingData(prev => ({
        ...prev,
        [meeting.id]: { ...prev[meeting.id], loading: true }
      }));
      try {
        const { data, error } = await supabase
          .from('leads')
          .select('expert_notes,handler_notes')
          .eq('id', meeting.lead.id)
          .single();
        if (error) throw error;
        setExpandedMeetingData(prev => ({
          ...prev,
          [meeting.id]: { loading: false, ...data }
        }));
      } catch (error) {
        setExpandedMeetingData(prev => ({
          ...prev,
          [meeting.id]: { ...prev[meeting.id], loading: false }
        }));
        console.error('Failed to load meeting details:', error);
      }
    };
    if (expandedMeetingId) {
      const meeting = meetings.find(m => m.id === expandedMeetingId);
      if (meeting && meeting.lead && meeting.lead.id) {
        fetchExpandedMeetingData(meeting);
      }
    }
  }, [expandedMeetingId, meetings]);

  useEffect(() => {
    let filtered = meetings;

    if (selectedDate) {
      filtered = filtered.filter(m => m.meeting_date === selectedDate);
    }

    if (selectedStaff) {
      filtered = filtered.filter(m => m.meeting_manager === selectedStaff);
    }

    setFilteredMeetings(filtered);

    // Calculate total balance for the day
    const total = filtered.reduce((acc, meeting) => {
      if (typeof meeting.lead?.balance === 'number') {
        return acc + meeting.lead.balance;
      } else if (typeof meeting.meeting_amount === 'number') {
        return acc + meeting.meeting_amount;
      }
      return acc;
    }, 0);
    setTotalAmount(total);

  }, [selectedDate, selectedStaff, meetings]);

  const getStageBadge = (stage: string) => {
    if (!stage || typeof stage !== 'string' || !stage.trim()) {
      return <span className="badge bg-black text-white badge-md ml-2">No Stage</span>;
    }
    return <span className="badge bg-black text-white badge-md ml-2">{stage.replace(/_/g, ' ')}</span>;
  };

  // Helper to extract a valid Teams join link from various formats
  const getValidTeamsLink = (link: string | undefined) => {
    if (!link) return '';
    try {
      if (link.startsWith('http')) return link;
      const obj = JSON.parse(link);
      if (obj && typeof obj === 'object' && obj.joinUrl && typeof obj.joinUrl === 'string') {
        return obj.joinUrl;
      }
      if (obj && typeof obj === 'object' && obj.joinWebUrl && typeof obj.joinWebUrl === 'string') {
        return obj.joinWebUrl;
      }
    } catch (e) {
      if (typeof link === 'string' && link.startsWith('http')) return link;
    }
    return '';
  };

  const renderMeetingRow = (meeting: any) => {
    const isExpanded = expandedMeetingId === meeting.id;
    const expandedData = expandedMeetingData[meeting.id] || {};

    return (
      <React.Fragment key={meeting.id}>
        <tr className="hover:bg-base-200/50">
          <td className="font-bold">
            <Link to={`/clients/${meeting.lead.lead_number}`} className="text-black hover:opacity-75">
              {meeting.lead.name} ({meeting.lead.lead_number})
            </Link>
          </td>
          <td>{new Date(meeting.meeting_date).toLocaleDateString()} at {meeting.meeting_time ? meeting.meeting_time.slice(0,5) : ''}</td>
          <td>{meeting.lead.manager || meeting.meeting_manager}</td>
          <td>{meeting.lead.category || 'N/A'}</td>
          <td>${typeof meeting.lead.balance === 'number' ? meeting.lead.balance.toLocaleString() : (meeting.meeting_amount?.toLocaleString() || '0')}</td>
          <td>{getStageBadge(meeting.lead.stage)}</td>
          <td>
            <button 
              className="btn btn-primary btn-sm gap-2"
              onClick={() => {
                const url = getValidTeamsLink(meeting.teams_meeting_url);
                if (url) {
                  window.open(url, '_blank');
                } else {
                  alert('No meeting URL available');
                }
              }}
            >
              <VideoCameraIcon className="w-4 h-4" />
              Join Meeting
            </button>
          </td>
        </tr>
        
        {/* Expanded Details Row */}
        {isExpanded && (
          <tr>
            <td colSpan={7} className="p-0">
              <div className="bg-base-100/50 p-4 border-t border-base-200">
                {expandedData.loading ? (
                  <div className="flex justify-center items-center py-4">
                    <span className="loading loading-spinner loading-md"></span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-base-200/50 p-4 rounded-lg">
                      <h5 className="font-semibold text-base-content/90 mb-2">Expert Notes</h5>
                      <div className="space-y-3 max-h-60 overflow-y-auto">
                        {Array.isArray(expandedData.expert_notes) && expandedData.expert_notes.length > 0 ? (
                          expandedData.expert_notes.map((note: any) => (
                            <div key={note.id} className="bg-base-200 p-3 rounded-md shadow-sm">
                              <div className="flex items-center gap-2 text-xs text-base-content/60 mb-1">
                                <ClockIcon className="w-4 h-4" />
                                <span>{note.timestamp}</span>
                              </div>
                              <p className="text-sm text-base-content/90 whitespace-pre-wrap">{note.content}</p>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-base-content/70">
                            {expandedData.expert_notes || 'No expert notes yet.'}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="bg-base-200/50 p-4 rounded-lg">
                      <h5 className="font-semibold text-base-content/90 mb-2">Handler Notes</h5>
                      <div className="space-y-3 max-h-60 overflow-y-auto">
                        {Array.isArray(expandedData.handler_notes) && expandedData.handler_notes.length > 0 ? (
                          expandedData.handler_notes.map((note: any) => (
                            <div key={note.id} className="bg-base-200 p-3 rounded-md shadow-sm">
                              <div className="flex items-center gap-2 text-xs text-base-content/60 mb-1">
                                <ClockIcon className="w-4 h-4" />
                                <span>{note.timestamp}</span>
                              </div>
                              <p className="text-sm text-base-content/90 whitespace-pre-wrap">{note.content}</p>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-base-content/70">
                            {expandedData.handler_notes || 'No handler notes yet.'}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="md:col-span-2 flex justify-center">
                      <button
                        onClick={() => {
                          setSelectedMeeting(meeting);
                          setIsDocumentModalOpen(true);
                        }}
                        className={`btn btn-outline btn-primary flex items-center gap-2 px-4 py-2 text-base font-semibold rounded-lg shadow hover:bg-primary hover:text-white transition-colors ${!meeting.lead.onedrive_folder_link ? 'btn-disabled' : ''}`}
                        disabled={!meeting.lead.onedrive_folder_link}
                      >
                        <FolderIcon className="w-5 h-5" />
                        Documents
                        <span className="badge badge-primary badge-sm ml-2">3</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </td>
          </tr>
        )}
        
        {/* Toggle Row */}
        <tr>
          <td colSpan={7} className="p-0">
            <div
              className="bg-base-200 hover:bg-base-300 cursor-pointer transition-colors p-2 text-center"
              onClick={() => setExpandedMeetingId(expandedMeetingId === meeting.id ? null : meeting.id)}
            >
              <div className="flex items-center justify-center gap-2 text-sm font-medium text-primary">
                <span>{expandedMeetingId === meeting.id ? 'Show Less' : 'Show More'}</span>
                <ChevronDownIcon className={`w-5 h-5 transition-transform ${expandedMeetingId === meeting.id ? 'rotate-180' : ''}`} />
              </div>
            </div>
          </td>
        </tr>
      </React.Fragment>
    );
  };

  return (
    <div className="p-4 md:p-6 lg:p-8">
      {/* Date Navigation */}
      <div className="mb-6 flex items-center justify-center gap-4">
        <button
          onClick={goToPreviousDay}
          className="btn btn-circle btn-outline btn-primary"
          title="Previous Day"
        >
          <ChevronLeftIcon className="w-6 h-6" />
        </button>
        
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold">
            {new Date(selectedDate).toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </span>
          <button
            onClick={goToToday}
            className="btn btn-sm btn-primary"
            title="Go to Today"
          >
            Today
          </button>
        </div>
        
        <button
          onClick={goToNextDay}
          className="btn btn-circle btn-outline btn-primary"
          title="Next Day"
        >
          <ChevronRightIcon className="w-6 h-6" />
        </button>
      </div>

      <div className="mb-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <CalendarIcon className="w-8 h-8 text-primary" />
          Calendar
        </h1>

        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto">
          <div className="flex items-center gap-2">
            <FunnelIcon className="w-5 h-5 text-gray-500" />
            <input 
              type="date" 
              className="input input-bordered w-full md:w-auto"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <UserIcon className="w-5 h-5 text-gray-500" />
            <select 
              className="select select-bordered w-full md:w-auto"
              value={selectedStaff}
              onChange={(e) => setSelectedStaff(e.target.value)}
            >
              <option value="">All Staff</option>
              {staff.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Meetings List */}
      <div className="bg-base-100 rounded-lg shadow-lg overflow-x-auto">
        <table className="table w-full">
          <thead>
            <tr className="bg-base-200">
              <th>Lead</th>
              <th>Date & Time</th>
              <th>Manager</th>
              <th>Category</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="text-center p-8">Loading meetings...</td></tr>
            ) : filteredMeetings.length > 0 ? (
              filteredMeetings.map(renderMeetingRow)
            ) : (
              <tr><td colSpan={7} className="text-center p-8">No meetings found for the selected filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Total Amount */}
      <div className="mt-6 flex justify-end">
        <div className="card bg-primary text-primary-content p-4 shadow-lg">
          <div className="flex items-center gap-3">
            <CurrencyDollarIcon className="w-7 h-7" />
            <div>
              <div className="text-lg font-bold">Total Balance</div>
              <div className="text-2xl font-extrabold">${totalAmount.toLocaleString()}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Document Modal */}
      {isDocumentModalOpen && selectedMeeting && (
        <DocumentModal
          isOpen={isDocumentModalOpen}
          onClose={() => {
            setIsDocumentModalOpen(false);
            setSelectedMeeting(null);
          }}
          leadNumber={selectedMeeting.lead.lead_number}
          clientName={selectedMeeting.lead.name}
          onDocumentCountChange={() => {}}
        />
      )}
    </div>
  );
};

export default CalendarPage; 