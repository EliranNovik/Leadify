import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { ClientTabProps } from '../../types/client';
import { 
  CalendarIcon, 
  PencilSquareIcon, 
  CheckIcon, 
  XMarkIcon, 
  ClockIcon, 
  UserIcon,
  VideoCameraIcon,
  MapPinIcon,
  EnvelopeIcon,
  LinkIcon,
  ClockIcon as ClockSolidIcon,
  UserCircleIcon,
  ChevronDownIcon,
  DocumentTextIcon,
  AcademicCapIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../../msalConfig';
import { createTeamsMeeting, sendEmail } from '../../lib/graph';

const fakeNames = ['Anna Zh', 'Mindi', 'Sarah L', 'David K', '---'];

const locationOptions = [
  'WhatsApp Video',
  'Teams',
  'Jerusalem Office',
  'Tel Aviv Office',
  'Phone call'
];

const currencyOptions = [
  { value: 'NIS', symbol: '₪' },
  { value: 'USD', symbol: '$' },
  { value: 'EUR', symbol: '€' }
];

const timeOptions = Array.from({ length: 32 }, (_, i) => {
  const hour = Math.floor(i / 2) + 8; // Start from 8:00
  const minute = i % 2 === 0 ? '00' : '30';
  return `${hour.toString().padStart(2, '0')}:${minute}`;
});

interface Meeting {
  id: number;
  client_id: string;
  date: string;
  time: string;
  location: string;
  manager: string;
  currency: string;
  amount: number;
  brief: string;
  scheduler: string;
  helper: string;
  expert: string;
  link: string;
  expert_notes?: string;
  handler_notes?: string;
  eligibility_status?: string;
  feasibility_notes?: string;
  documents_link?: string;
  lastEdited: {
    timestamp: string;
    user: string;
  };
}

const MeetingTab: React.FC<ClientTabProps> = ({ client, onClientUpdate }) => {
  const { instance } = useMsal();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [isCreatingMeeting, setIsCreatingMeeting] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [editingBriefId, setEditingBriefId] = useState<number | null>(null);
  const [editedBrief, setEditedBrief] = useState<string>('');
  const [expandedMeetingId, setExpandedMeetingId] = useState<number | null>(null);
  const [expandedMeetingData, setExpandedMeetingData] = useState<{
    [meetingId: number]: {
      loading: boolean;
      expert_notes?: string;
      handler_notes?: string;
    }
  }>({});
  const [editingField, setEditingField] = useState<{ meetingId: number; field: 'expert_notes' | 'handler_notes' } | null>(null);
  const [editedContent, setEditedContent] = useState<string>('');

  // New: Lead-level scheduling info
  const [leadSchedulingInfo, setLeadSchedulingInfo] = useState<{
    scheduler?: string;
    meeting_scheduling_notes?: string;
    next_followup?: string;
    followup?: string;
  }>({});

  const [creatingTeamsMeetingId, setCreatingTeamsMeetingId] = useState<number | null>(null);

  useEffect(() => {
    const fetchMeetings = async () => {
      if (!client.id) return;
      try {
        const { data, error } = await supabase
          .from('meetings')
          .select('*')
          .eq('client_id', client.id)
          .order('meeting_date', { ascending: false });

        if (error) throw error;

        if (data) {
          const formattedMeetings = data.map((m: any) => ({
            id: m.id,
            client_id: m.client_id,
            date: m.meeting_date,
            time: m.meeting_time,
            location: m.meeting_location,
            manager: m.meeting_manager,
            currency: m.meeting_currency,
            amount: m.meeting_amount,
            brief: m.meeting_brief,
            scheduler: m.scheduler,
            helper: m.helper,
            expert: m.expert,
            link: m.teams_meeting_url,
            expert_notes: m.expert_notes,
            handler_notes: m.handler_notes,
            eligibility_status: m.eligibility_status,
            feasibility_notes: m.feasibility_notes,
            documents_link: m.documents_link,
            lastEdited: {
              timestamp: m.last_edited_timestamp,
              user: m.last_edited_by,
            },
          }));
          setMeetings(formattedMeetings);
        }
      } catch (error) {
        console.error('Error fetching meetings:', error);
        toast.error('Failed to load meetings.');
      }
    };

    const fetchLeadSchedulingInfo = async () => {
      if (!client.id) return;
      try {
        const { data, error } = await supabase
          .from('leads')
          .select('scheduler, meeting_scheduling_notes, next_followup, followup')
          .eq('id', client.id)
          .single();
        if (error) throw error;
        setLeadSchedulingInfo(data || {});
      } catch (error) {
        setLeadSchedulingInfo({});
      }
    };

    fetchMeetings();
    fetchLeadSchedulingInfo();
  }, [client, onClientUpdate]);

  // Fetch latest notes from leads table when a meeting is expanded
  useEffect(() => {
    const fetchExpandedMeetingData = async (meeting: Meeting) => {
      setExpandedMeetingData(prev => ({
        ...prev,
        [meeting.id]: { ...prev[meeting.id], loading: true }
      }));
      try {
        const { data, error } = await supabase
          .from('leads')
          .select('expert_notes,handler_notes')
          .eq('id', meeting.client_id)
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
        toast.error('Failed to load meeting details.');
      }
    };
    if (expandedMeetingId) {
      const meeting = meetings.find(m => m.id === expandedMeetingId);
      if (meeting && (meeting as any).client_id) {
        fetchExpandedMeetingData(meeting as any);
      }
    }
  }, [expandedMeetingId, meetings]);

  const handleSaveField = async () => {
    if (!editingField) return;
    const { meetingId, field } = editingField;

    try {
      const { error } = await supabase
        .from('meetings')
        .update({ [field]: editedContent })
        .eq('id', meetingId);
      
      if (error) throw error;

      toast.success('Notes updated successfully!');
      setEditingField(null);
      setEditedContent('');
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error) {
      toast.error('Failed to update notes.');
      console.error(error);
    }
  };

  const handleSaveBrief = async (meetingId: number) => {
    try {
      const { error } = await supabase
        .from('meetings')
        .update({ meeting_brief: editedBrief })
        .eq('id', meetingId);

      if (error) throw error;
      
      toast.success('Meeting brief updated!');
      setEditingBriefId(null);
      setEditedBrief('');
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error) {
      toast.error('Failed to update meeting brief.');
      console.error(error);
    }
  };

  const handleSendEmail = async (meeting: Meeting) => {
    setIsSendingEmail(true);
    try {
      // This is a placeholder for the actual email sending logic
      await new Promise(resolve => setTimeout(resolve, 1000));
      toast.success(`Email sent for meeting on ${meeting.date}`);
    } catch (error) {
      toast.error('Failed to send email.');
      console.error(error);
    }
    setIsSendingEmail(false);
  };

  const handleCreateTeamsMeeting = async (meeting: Meeting) => {
    setCreatingTeamsMeetingId(meeting.id);
    try {
      if (!instance) throw new Error('MSAL instance not available');
      const accounts = instance.getAllAccounts();
      if (!accounts.length) throw new Error('No Microsoft account found');
      const tokenResponse = await instance.acquireTokenSilent({ ...loginRequest, account: accounts[0] });
      const startDateTime = new Date(`${meeting.date}T${meeting.time || '09:00'}`).toISOString();
      const endDateTime = new Date(new Date(startDateTime).getTime() + 60 * 60 * 1000).toISOString();
      const teamsData = await createTeamsMeeting(tokenResponse.accessToken, {
        subject: `Meeting with ${client.name}`,
        startDateTime,
        endDateTime,
        attendees: client.email ? [{ email: client.email }] : [],
      });
      const joinUrl = teamsData.joinUrl;
      if (!joinUrl) throw new Error('No joinUrl returned from Teams API');
      // Save to Supabase
      const { error } = await supabase.from('meetings').update({ teams_meeting_url: joinUrl }).eq('id', meeting.id);
      if (error) throw error;
      toast.success('Teams meeting created and saved!');
      if (onClientUpdate) await onClientUpdate();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create Teams meeting');
    } finally {
      setCreatingTeamsMeetingId(null);
    }
  };

  const getValidTeamsLink = (link: string | undefined) => {
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

  const renderMeetingCard = (meeting: Meeting) => {
    const formattedDate = new Date(meeting.date).toLocaleDateString('en-GB');

    const handleEditBrief = () => {
      setEditingBriefId(meeting.id);
      setEditedBrief(meeting.brief || '');
    };
  
    const handleCancelEdit = () => {
      setEditingBriefId(null);
      setEditedBrief('');
    };
    
    const handleEditField = (meetingId: number, field: 'expert_notes' | 'handler_notes', currentContent?: string) => {
      setEditingField({ meetingId, field });
      setEditedContent(currentContent || '');
    };

    const handleCancelEditField = () => {
      setEditingField(null);
      setEditedContent('');
    };

    // Use expandedMeetingData if available
    const expandedData = expandedMeetingData[meeting.id] || {};
    const isExpanded = expandedMeetingId === meeting.id;

    // Pick a gradient for this card
    const gradients = [
      'from-pink-500 via-purple-500 to-purple-600',
      'from-purple-600 via-blue-600 to-blue-500',
      'from-blue-500 via-cyan-500 to-teal-400',
      'from-teal-400 via-green-400 to-green-600',
    ];
    const iconColors = [
      'text-purple-500',
      'text-blue-500',
      'text-cyan-500',
      'text-green-500',
    ];
    const gradient = gradients[meeting.id % 4];
    const iconColor = iconColors[meeting.id % 4];

    const renderEditableSection = (
      title: string,
      field: 'expert_notes' | 'handler_notes',
      content?: any
    ) => {
      const isEditing = editingField?.meetingId === meeting.id && editingField?.field === field;
      
      // Extract the most recent note content if content is an array
      const latestNote = Array.isArray(content) && content.length > 0 ? content[content.length - 1].content : content;

      return (
        <div className="bg-base-200/50 p-4 rounded-lg">
          <div className="flex justify-between items-center mb-2">
            <h5 className="font-semibold text-base-content/90">{title}</h5>
            {isEditing ? (
              <div className="flex items-center gap-1">
                <button className="btn btn-ghost btn-xs btn-circle" onClick={handleSaveField}><CheckIcon className="w-4 h-4 text-success" /></button>
                <button className="btn btn-ghost btn-xs btn-circle" onClick={handleCancelEditField}><XMarkIcon className="w-4 h-4 text-error" /></button>
              </div>
            ) : (
              <button className="btn btn-ghost btn-xs btn-circle" onClick={() => handleEditField(meeting.id, field, content)}><PencilSquareIcon className="w-4 h-4" /></button>
            )}
          </div>
          {isEditing ? (
            <textarea
              className="textarea textarea-bordered w-full h-28"
              value={editedContent}
              onChange={e => setEditedContent(e.target.value)}
            />
          ) : (
            <p className="text-sm text-base-content/70 min-h-[4rem]">{latestNote || 'No notes yet.'}</p>
          )}
        </div>
      );
    };

    return (
      <div key={meeting.id} className={`p-[2px] rounded-2xl bg-gradient-to-tr ${gradient} shadow-xl hover:shadow-2xl transition-all duration-200 min-h-[220px]`}>
        <div className="bg-white rounded-2xl h-full w-full">
          <div className="card-body p-4">
            {/* Header */}
            <div className="flex flex-row justify-between items-start mb-2">
              <div className="flex items-center gap-4">
                <div className={`flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-tr ${gradient} shadow`}>
                  <CalendarIcon className="w-7 h-7 text-white opacity-90" />
                </div>
                <div>
                  <p className={`font-bold text-2xl bg-gradient-to-tr ${gradient} bg-clip-text text-transparent`}>{formattedDate}</p>
                  <div className={`flex items-center gap-2 bg-gradient-to-tr ${gradient} bg-clip-text text-transparent`}>
                    <ClockIcon className="w-5 h-5 text-transparent" style={{ WebkitTextStroke: '1px #a3a3a3' }} />
                    <span>{meeting.time}</span>
                  </div>
                </div>
              </div>
              {/* Action Buttons */}
              <div className="flex flex-col md:flex-row gap-2">
                <button
                  className="btn btn-primary btn-sm text-white border-none shadow-md hover:bg-purple-700"
                  onClick={() => handleSendEmail(meeting)}
                  disabled={isSendingEmail}
                  style={{ minWidth: 120 }}
                >
                  <EnvelopeIcon className="w-4 h-4" />
                  Notify Client
                </button>
                {meeting.location === 'Teams' && !meeting.link && (
                  <button
                    className="btn btn-accent btn-sm text-white border-none shadow-md hover:bg-accent-focus"
                    onClick={() => handleCreateTeamsMeeting(meeting)}
                    disabled={creatingTeamsMeetingId === meeting.id}
                    style={{ minWidth: 120 }}
                  >
                    {creatingTeamsMeetingId === meeting.id ? (
                      <span className="loading loading-spinner loading-xs mr-2"></span>
                    ) : (
                      <VideoCameraIcon className="w-4 h-4 mr-1" />
                    )}
                    Create Teams Link
                  </button>
                )}
                {meeting.link && getValidTeamsLink(meeting.link) && (
                  <a
                    href={getValidTeamsLink(meeting.link)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary btn-sm text-white border-none shadow-md hover:bg-purple-700"
                    style={{ minWidth: 120 }}
                  >
                    <LinkIcon className="w-4 h-4" />
                    Join Meeting
                  </a>
                )}
              </div>
            </div>

            {/* Details Section */}
            <div className="grid grid-cols-2 gap-x-2 gap-y-2 md:grid-cols-2 md:gap-3 mb-2">
              <div className="flex items-center gap-2">
                <MapPinIcon className={`w-5 h-5 ${iconColor}`} />
                <span className={`text-sm md:text-base bg-gradient-to-tr ${gradient} bg-clip-text text-transparent`}>{meeting.location}</span>
              </div>
              <div className="flex items-center gap-2">
                <UserIcon className={`w-5 h-5 ${iconColor}`} />
                <span className={`text-sm md:text-base bg-gradient-to-tr ${gradient} bg-clip-text text-transparent`}>Manager: {meeting.manager}</span>
              </div>
              <div className="flex items-center gap-2">
                <AcademicCapIcon className={`w-5 h-5 ${iconColor}`} />
                <span className={`text-sm md:text-base bg-gradient-to-tr ${gradient} bg-clip-text text-transparent`}>Expert: {meeting.expert}</span>
              </div>
              <div className="flex items-center gap-2">
                <UserCircleIcon className={`w-5 h-5 ${iconColor}`} />
                <span className={`text-sm md:text-base bg-gradient-to-tr ${gradient} bg-clip-text text-transparent`}>Helper: {meeting.helper}</span>
              </div>
              <div className="flex items-center gap-2 col-span-2 md:col-span-2">
                <span className={`font-semibold text-sm md:text-base bg-gradient-to-tr ${gradient} bg-clip-text text-transparent`}>{meeting.currency}</span>
                <span className={`text-sm md:text-base bg-gradient-to-tr ${gradient} bg-clip-text text-transparent`}>{meeting.amount}</span>
              </div>
            </div>

            {/* Brief Section */}
            <div className="mt-2 pt-2 border-t border-gray-200">
              <div className="flex justify-between items-center mb-2">
                <h4 className={`font-semibold bg-gradient-to-tr ${gradient} bg-clip-text text-transparent`}>Brief</h4>
                {editingBriefId === meeting.id ? (
                  <div className="flex items-center gap-1">
                    <button className="btn btn-ghost btn-sm btn-circle" onClick={() => handleSaveBrief(meeting.id)}>
                      <CheckIcon className="w-5 h-5 text-success" />
                    </button>
                    <button className="btn btn-ghost btn-sm btn-circle" onClick={handleCancelEdit}>
                      <XMarkIcon className="w-5 h-5 text-error" />
                    </button>
                  </div>
                ) : (
                  <button className={`btn btn-sm btn-circle shadow bg-gradient-to-tr ${gradient} text-white hover:opacity-90`} onClick={handleEditBrief}>
                    <PencilSquareIcon className="w-5 h-5" />
                  </button>
                )}
              </div>
              {editingBriefId === meeting.id ? (
                <textarea
                  className={`textarea textarea-bordered w-full h-24 border-gray-300 text-gray-700 placeholder-gray-400`}
                  value={editedBrief}
                  onChange={(e) => setEditedBrief(e.target.value)}
                  placeholder="Add a meeting brief..."
                />
              ) : (
                <div className="bg-gray-50 rounded-xl border border-gray-200 p-3 my-1 min-h-[2.5rem] whitespace-pre-wrap transition-all text-gray-800">
                  {meeting.brief || <span className="text-gray-400">No brief provided.</span>}
                </div>
              )}
            </div>

            {/* Last Edited Section */}
            <div className={`text-xs mt-2 flex flex-col gap-1 bg-gradient-to-tr ${gradient} bg-clip-text text-transparent`}>
              <div className="flex items-center gap-2">
                <ClockSolidIcon className="w-4 h-4" />
                <span>Last edited: {new Date(meeting.lastEdited.timestamp).toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-2">
                <UserCircleIcon className="w-4 h-4" />
                <span>by {meeting.lastEdited.user}</span>
              </div>
            </div>
          </div>
          {/* Collapsible Section - only render content if expanded */}
          {isExpanded && (
            <div className="bg-gray-50 p-2 md:p-3 border-t-2 border-dashed border-gray-200">
              {expandedData.loading ? (
                <div className="flex justify-center items-center py-8">
                  <span className="loading loading-spinner loading-md"></span>
                </div>
              ) : (
                <div className="flex flex-col md:flex-row gap-4">
                  <div className="flex-1 bg-white p-4 rounded-lg">
                    <div className="flex justify-between items-center mb-1">
                      <h5 className={`font-semibold bg-gradient-to-tr ${gradient} bg-clip-text text-transparent`}>Expert Notes</h5>
                      {editingField?.meetingId === meeting.id && editingField?.field === 'expert_notes' ? (
                        <div className="flex items-center gap-1">
                          <button className="btn btn-ghost btn-xs btn-circle" onClick={handleSaveField}><CheckIcon className="w-4 h-4 text-success" /></button>
                          <button className="btn btn-ghost btn-xs btn-circle" onClick={handleCancelEditField}><XMarkIcon className="w-4 h-4 text-error" /></button>
                        </div>
                      ) : (
                        <button className={`btn btn-xs btn-circle shadow bg-gradient-to-tr ${gradient} text-white hover:opacity-90`} onClick={() => handleEditField(meeting.id, 'expert_notes', expandedData.expert_notes)}>
                          <PencilSquareIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    {editingField?.meetingId === meeting.id && editingField?.field === 'expert_notes' ? (
                      <textarea
                        className="textarea textarea-bordered w-full h-24 border-gray-300 text-gray-700 placeholder-gray-400"
                        value={editedContent}
                        onChange={e => setEditedContent(e.target.value)}
                        placeholder="Edit expert notes..."
                      />
                    ) : (
                      <p className={`text-sm bg-gradient-to-tr ${gradient} bg-clip-text text-transparent min-h-[2rem]`}>
                        {Array.isArray(expandedData.expert_notes) && expandedData.expert_notes.length > 0
                          ? expandedData.expert_notes[expandedData.expert_notes.length - 1].content
                          : expandedData.expert_notes || 'No notes yet.'}
                      </p>
                    )}
                  </div>
                  <div className="flex-1 bg-white p-4 rounded-lg">
                    <div className="flex justify-between items-center mb-1">
                      <h5 className={`font-semibold bg-gradient-to-tr ${gradient} bg-clip-text text-transparent`}>Handler Notes</h5>
                      {editingField?.meetingId === meeting.id && editingField?.field === 'handler_notes' ? (
                        <div className="flex items-center gap-1">
                          <button className="btn btn-ghost btn-xs btn-circle" onClick={handleSaveField}><CheckIcon className="w-4 h-4 text-success" /></button>
                          <button className="btn btn-ghost btn-xs btn-circle" onClick={handleCancelEditField}><XMarkIcon className="w-4 h-4 text-error" /></button>
                        </div>
                      ) : (
                        <button className={`btn btn-xs btn-circle shadow bg-gradient-to-tr ${gradient} text-white hover:opacity-90`} onClick={() => handleEditField(meeting.id, 'handler_notes', expandedData.handler_notes)}>
                          <PencilSquareIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    {editingField?.meetingId === meeting.id && editingField?.field === 'handler_notes' ? (
                      <textarea
                        className="textarea textarea-bordered w-full h-24 border-gray-300 text-gray-700 placeholder-gray-400"
                        value={editedContent}
                        onChange={e => setEditedContent(e.target.value)}
                        placeholder="Edit handler notes..."
                      />
                    ) : (
                      <p className={`text-sm bg-gradient-to-tr ${gradient} bg-clip-text text-transparent min-h-[2rem]`}>
                        {Array.isArray(expandedData.handler_notes) && expandedData.handler_notes.length > 0
                          ? expandedData.handler_notes[expandedData.handler_notes.length - 1].content
                          : expandedData.handler_notes || 'No notes yet.'}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Expander Toggle */}
          <div
            className={`bg-gradient-to-tr ${gradient} hover:opacity-90 cursor-pointer transition-colors p-1 text-center rounded-b-2xl`}
            onClick={() => setExpandedMeetingId(expandedMeetingId === meeting.id ? null : meeting.id)}
          >
            <div className="flex items-center justify-center gap-2 text-xs font-medium text-white">
              <span>{expandedMeetingId === meeting.id ? 'Show Less' : 'Show More'}</span>
              <ChevronDownIcon className={`w-4 h-4 transition-transform ${expandedMeetingId === meeting.id ? 'rotate-180' : ''}`} />
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4">
      {/* Lead Scheduling Info Box */}
      {(leadSchedulingInfo.scheduler || leadSchedulingInfo.meeting_scheduling_notes || leadSchedulingInfo.next_followup || leadSchedulingInfo.followup) && (
        <div className="card bg-base-100 shadow-xl rounded-2xl mb-10">
          <div className="card-body p-6 md:p-8">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8 items-start">
              <div className="flex flex-col items-start gap-2">
                <div className="flex items-center gap-2 mb-1">
                  <UserIcon className="w-7 h-7 text-primary" />
                  <span className="font-semibold text-base-content/80 text-lg">Scheduler</span>
                </div>
                <div className="badge badge-outline badge-lg px-4 py-2 text-base font-bold bg-base-200">{leadSchedulingInfo.scheduler || <span className="text-base-content/40 font-normal">---</span>}</div>
              </div>
              <div className="flex flex-col items-start gap-2">
                <div className="flex items-center gap-2 mb-1">
                  <DocumentTextIcon className="w-7 h-7 text-primary" />
                  <span className="font-semibold text-base-content/80 text-lg">Meeting scheduling notes</span>
                </div>
                <div className="text-base-content/90 text-base whitespace-pre-line bg-base-200 rounded-lg p-3 w-full min-h-[3rem]">{leadSchedulingInfo.meeting_scheduling_notes || <span className="text-base-content/40 font-normal">---</span>}</div>
              </div>
              <div className="flex flex-col items-start gap-2">
                <div className="flex items-center gap-2 mb-1">
                  <ClockIcon className="w-7 h-7 text-primary" />
                  <span className="font-semibold text-base-content/80 text-lg">Next followup date</span>
                </div>
                <div className="text-base-content/90 text-base font-bold bg-base-200 rounded-lg px-4 py-2">{leadSchedulingInfo.next_followup ? new Date(leadSchedulingInfo.next_followup).toLocaleDateString() : <span className="text-base-content/40 font-normal">---</span>}</div>
              </div>
              <div className="flex flex-col items-start gap-2">
                <div className="flex items-center gap-2 mb-1">
                  <DocumentTextIcon className="w-7 h-7 text-primary" />
                  <span className="font-semibold text-base-content/80 text-lg">Followup notes</span>
                </div>
                <div className="text-base-content/90 text-base whitespace-pre-line bg-base-200 rounded-lg p-3 w-full min-h-[3rem]">{leadSchedulingInfo.followup || <span className="text-base-content/40 font-normal">---</span>}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-6 h-6 text-primary" />
          <h3 className="text-lg font-semibold">Meetings</h3>
        </div>
      </div>

      {meetings.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {meetings.map(renderMeetingCard)}
        </div>
      ) : (
        <div className="text-center py-8 text-base-content/70 bg-base-200 rounded-lg">
          No meetings scheduled yet.
        </div>
      )}

      {/* A placeholder for where the schedule meeting modal would be triggered */}
      {showScheduleModal && (
        // A proper modal implementation would go here
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
          <div className="bg-base-100 p-8 rounded-lg">
            <h2 className="text-xl font-bold mb-4">Schedule New Meeting</h2>
            <p>The UI for scheduling a new meeting is not yet implemented.</p>
            <button className="btn btn-primary mt-4" onClick={() => setShowScheduleModal(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MeetingTab; 