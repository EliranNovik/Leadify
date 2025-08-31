import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { ClientTabProps } from '../../types/client';
import TimelineHistoryButtons from './TimelineHistoryButtons';
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
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../../msalConfig';
import { createTeamsMeeting, sendEmail } from '../../lib/graph';
import { meetingInvitationEmailTemplate } from '../Meetings';
import MeetingSummaryComponent from '../MeetingSummary';

const fakeNames = ['Anna Zh', 'Mindi', 'Sarah L', 'David K', '---'];

// This will be populated dynamically from the database
const getLocationOptions = (meetingLocations: any[]) => {
  return meetingLocations.map(loc => loc.name).filter(Boolean);
};

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
  status?: string;
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
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [allMeetingLocations, setAllMeetingLocations] = useState<any[]>([]);

  // Helper function to get employee display name from ID
  const getEmployeeDisplayName = (employeeId: string | null | undefined) => {
    if (!employeeId || employeeId === '---') return '---';
    const employee = allEmployees.find((emp: any) => emp.id.toString() === employeeId.toString());
    return employee ? employee.display_name : employeeId; // Fallback to ID if not found
  };

  // Helper function to get meeting location name from ID
  const getMeetingLocationName = (locationId: string | number | null | undefined) => {
    console.log('MeetingTab: getMeetingLocationName called with:', locationId);
    console.log('MeetingTab: allMeetingLocations:', allMeetingLocations);
    
    if (!locationId || locationId === '---' || locationId === 'Not specified') return 'Not specified';
    const location = allMeetingLocations.find((loc: any) => loc.id.toString() === locationId.toString());
    console.log('MeetingTab: Found location:', location);
    return location ? location.name : locationId; // Fallback to ID if not found
  };

  // Helper function to get currency symbol
  const getCurrencySymbol = (currencyCode?: string) => {
    switch (currencyCode) {
      case '₪':
      case 'NIS':
      case 'ILS':
        return '₪';
      case '$':
      case 'USD':
        return '$';
      case '€':
      case 'EUR':
        return '€';
      case '£':
      case 'GBP':
        return '£';
      default:
        return '₪'; // Default to NIS for legacy leads
    }
  };

  // Fetch all employees and meeting locations
  useEffect(() => {
    const fetchEmployees = async () => {
      const { data, error } = await supabase
        .from('tenants_employee')
        .select('id, display_name, bonuses_role')
        .order('display_name', { ascending: true });
      
      if (!error && data) {
        setAllEmployees(data);
      }
    };

    const fetchMeetingLocations = async () => {
      const { data, error } = await supabase
        .from('tenants_meetinglocation')
        .select('id, name, default_link, address, order')
        .order('order', { ascending: true });
      
      console.log('MeetingTab: Fetched meeting locations:', { data, error });
      
      if (!error && data) {
        setAllMeetingLocations(data);
      }
    };

    fetchEmployees();
    fetchMeetingLocations();
  }, []);

  const fetchMeetings = async () => {
    if (!client.id) return;
    
    // Check if this is a legacy lead
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
    
    try {
      let allMeetings: any[] = [];
      
      if (isLegacyLead) {
        // For legacy leads, fetch from both leads_lead table (existing meetings) and meetings table (new meetings)
        const legacyId = client.id.toString().replace('legacy_', '');
        console.log('MeetingTab: Client ID:', client.id, 'Extracted legacy ID:', legacyId);
        
        // Fetch existing meetings from leads_lead table
        console.log('fetchMeetings: Querying legacy lead with ID:', legacyId);
        const { data: legacyData, error: legacyError } = await supabase
          .from('leads_lead')
          .select(`
            id, 
            meeting_datetime, 
            meeting_url, 
            meeting_brief, 
            meeting_location_old, 
            meeting_location_id, 
            meeting_total, 
            meeting_fop, 
            meeting_lawyer_id, 
            meeting_manager_id, 
            meeting_scheduler_id, 
            meeting_date, 
            meeting_time
          `)
          .eq('id', legacyId);
        
        console.log('fetchMeetings: Legacy query result:', { legacyData, legacyError });
        console.log('fetchMeetings: Legacy ID being searched:', legacyId);
        console.log('fetchMeetings: Client ID:', client.id);
        
        // Debug meeting_total values
        if (legacyData && legacyData.length > 0) {
          console.log('MeetingTab: Legacy meeting data with totals:', legacyData.map(m => ({
            id: m.id,
            meeting_total: m.meeting_total,
            meeting_date: m.meeting_date,
            meeting_time: m.meeting_time
          })));
        }
        
        if (legacyData && legacyData.length > 0) {
          const legacyMeetings = legacyData
            .filter((m: any) => {
              // Only create meeting objects if there's actual meeting information
              return m.meeting_date || m.meeting_datetime || m.meeting_time || m.meeting_location_id || m.meeting_location_old || m.meeting_url;
            })
            .map((m: any) => ({
              id: `legacy_${m.id}`,
              client_id: client.id,
              date: m.meeting_date || m.meeting_datetime?.split('T')[0] || '',
              time: m.meeting_time || m.meeting_datetime?.split('T')[1]?.substring(0, 5) || '',
              location: m.meeting_location_id ? String(m.meeting_location_id) : (m.meeting_location_old || 'Not specified'),
              manager: m.meeting_manager_id || '---',
              currency: '₪', // Default currency for legacy
              amount: m.meeting_total || 0,
              brief: m.meeting_brief || '',
              scheduler: m.meeting_scheduler_id || '---',
              helper: m.meeting_lawyer_id || '---',
              expert: m.meeting_lawyer_id || '---',
              link: m.meeting_url || '',
              status: 'scheduled',
              expert_notes: '',
              handler_notes: '',
              eligibility_status: '',
              feasibility_notes: '',
              documents_link: '',
              lastEdited: {
                timestamp: new Date().toISOString(),
                user: 'Legacy System',
              },
              isLegacy: true,
            }));
          console.log('MeetingTab: Mapped legacy meetings:', legacyMeetings.map(m => ({
            id: m.id,
            amount: m.amount,
            currency: m.currency,
            date: m.date,
            time: m.time
          })));
          allMeetings.push(...legacyMeetings);
        }
        
        // Fetch new meetings from meetings table using legacy_lead_id
        console.log('fetchMeetings: Querying meetings for legacy lead with ID:', legacyId);
        const { data: meetingsData, error: meetingsError } = await supabase
          .from('meetings')
          .select('*')
          .eq('legacy_lead_id', legacyId)
          .order('meeting_date', { ascending: false });
        
        console.log('fetchMeetings: New meetings query result:', { meetingsData, meetingsError });
        
        if (meetingsData) {
          const newMeetings = meetingsData.map((m: any) => ({
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
            status: m.status || 'scheduled',
            expert_notes: m.expert_notes,
            handler_notes: m.handler_notes,
            eligibility_status: m.eligibility_status,
            feasibility_notes: m.feasibility_notes,
            documents_link: m.documents_link,
            lastEdited: {
              timestamp: m.last_edited_timestamp,
              user: m.last_edited_by,
            },
            isLegacy: false,
          }));
          allMeetings.push(...newMeetings);
        }
      } else {
        // For new leads, fetch from meetings table
        const { data: newData, error: newError } = await supabase
          .from('meetings')
          .select('*')
          .eq('client_id', client.id)
          .order('meeting_date', { ascending: false });
        
        if (newData) {
          const formattedMeetings = newData.map((m: any) => ({
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
            status: m.status || 'scheduled',
            expert_notes: m.expert_notes,
            handler_notes: m.handler_notes,
            eligibility_status: m.eligibility_status,
            feasibility_notes: m.feasibility_notes,
            documents_link: m.documents_link,
            lastEdited: {
              timestamp: m.last_edited_timestamp,
              user: m.last_edited_by,
            },
            isLegacy: false,
          }));
          allMeetings = formattedMeetings;
        }
      }
      
      console.log('fetchMeetings: All meetings:', allMeetings);
      setMeetings(allMeetings);
      
    } catch (error) {
      console.error('Error fetching meetings:', error);
      toast.error('Failed to load meetings.');
    }
  };

    const fetchLeadSchedulingInfo = async () => {
      if (!client.id) return;
      
      // Check if this is a legacy lead
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      
      try {
        let data;
        let error;
        
        if (isLegacyLead) {
          // For legacy leads, fetch from leads_lead table
          const legacyId = client.id.toString().replace('legacy_', '');
          const { data: legacyData, error: legacyError } = await supabase
            .from('leads_lead')
            .select('meeting_scheduler_id, meeting_scheduling_notes, next_followup, followup_log')
            .eq('id', legacyId)
            .single();
          
          data = legacyData;
          error = legacyError;
          
          if (data) {
            setLeadSchedulingInfo({
              scheduler: data.meeting_scheduler_id || '',
              meeting_scheduling_notes: data.meeting_scheduling_notes || '',
              next_followup: data.next_followup || '',
              followup: data.followup_log || '',
            });
          } else {
            setLeadSchedulingInfo({});
          }
        } else {
          // For new leads, fetch from leads table
          const { data: newData, error: newError } = await supabase
            .from('leads')
            .select('scheduler, meeting_scheduling_notes, next_followup, followup')
            .eq('id', client.id)
            .single();
          
          data = newData;
          error = newError;
          
          if (data) {
            setLeadSchedulingInfo(data);
          } else {
            setLeadSchedulingInfo({});
          }
        }
        
        if (error) throw error;
      } catch (error) {
        setLeadSchedulingInfo({});
      }
    };

    // Add useEffect after both functions are defined
    useEffect(() => {
      console.log('MeetingTab useEffect triggered - client changed:', client?.id, client?.lead_type);
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
      
      // Check if this is a legacy lead
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      
      try {
        let data;
        let error;
        
        if (isLegacyLead) {
          // For legacy leads, fetch from leads_lead table
          const legacyId = client.id.toString().replace('legacy_', '');
          const { data: legacyData, error: legacyError } = await supabase
            .from('leads_lead')
            .select('expert_notes, handler_notes')
            .eq('id', legacyId)
            .single();
          
          data = legacyData;
          error = legacyError;
        } else {
          // For new leads, fetch from leads table
          const { data: newData, error: newError } = await supabase
            .from('leads')
            .select('expert_notes, handler_notes')
            .eq('id', meeting.client_id)
            .single();
          
          data = newData;
          error = newError;
        }
        
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
  }, [expandedMeetingId, meetings, client]);

  const handleSaveField = async () => {
    if (!editingField) return;
    const { meetingId, field } = editingField;

    // Check if this is a legacy lead
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');

    try {
      let error;
      
      if (isLegacyLead) {
        // For legacy leads, update the leads_lead table
        const legacyId = client.id.toString().replace('legacy_', '');
        const { error: legacyError } = await supabase
          .from('leads_lead')
          .update({ [field]: editedContent })
          .eq('id', legacyId);
        
        error = legacyError;
      } else {
        // For new leads, update the meetings table
        const { error: newError } = await supabase
          .from('meetings')
          .update({ [field]: editedContent })
          .eq('id', meetingId);
        
        error = newError;
      }
      
      if (error) throw error;

      toast.success('Notes updated successfully!');
      setEditingField(null);
      setEditedContent('');
      if (onClientUpdate) {
        await onClientUpdate();
      }
      // Refresh meetings to show updated data
      await fetchMeetings();
    } catch (error) {
      toast.error('Failed to update notes.');
      console.error(error);
    }
  };

  const handleSaveBrief = async (meetingId: number) => {
    try {
      // Check if this is a legacy meeting
      const meeting = meetings.find(m => m.id === meetingId);
      const isLegacyMeeting = meeting && (meeting as any).isLegacy;

      if (isLegacyMeeting) {
        // For legacy meetings, update the leads_lead table
        const legacyId = client.id.toString().replace('legacy_', '');
        const { error } = await supabase
          .from('leads_lead')
          .update({ meeting_brief: editedBrief })
          .eq('id', legacyId);
        
        if (error) throw error;
      } else {
        // For new meetings, update the meetings table
        const { error } = await supabase
          .from('meetings')
          .update({ meeting_brief: editedBrief })
          .eq('id', meetingId);
        
        if (error) throw error;
      }
      
      toast.success('Meeting brief updated!');
      setEditingBriefId(null);
      setEditedBrief('');
      if (onClientUpdate) {
        await onClientUpdate();
      }
      // Refresh meetings to show updated data
      await fetchMeetings();
    } catch (error) {
      toast.error('Failed to update meeting brief.');
      console.error(error);
    }
  };

  const handleSendEmail = async (meeting: Meeting) => {
    setIsSendingEmail(true);
    try {
      if (!client.email || !instance) throw new Error('Client email or MSAL instance missing');
      const accounts = instance.getAllAccounts();
      if (!accounts.length) throw new Error('No Microsoft account found');
      const account = accounts[0];
      const tokenResponse = await instance.acquireTokenSilent({ ...loginRequest, account });
      const senderName = account?.name || 'Your Team';
      const now = new Date();
      // Compose subject and HTML body using the template
      const subject = `Meeting Invitation: ${meeting.date} at ${meeting.time}`;
      const joinLink = getValidTeamsLink(meeting.link);
      const category = client.category || '---';
      const topic = client.topic || '---';
      const htmlBody = meetingInvitationEmailTemplate({
        clientName: client.name,
        meetingDate: meeting.date,
        meetingTime: meeting.time,
        location: meeting.location,
        category,
        topic,
        joinLink,
        senderName: senderName + ' - אלירן נוביק',
      });
      // Send email via Graph API
      await sendEmail(tokenResponse.accessToken, { to: client.email, subject, body: htmlBody });
      toast.success(`Email sent for meeting on ${meeting.date}`);
      // --- Optimistic upsert to emails table ---
      await supabase.from('emails').upsert([
        {
          message_id: `optimistic_${now.getTime()}`,
          client_id: client.id,
          thread_id: null,
          sender_name: senderName,
          sender_email: account.username || account.name || 'Me',
          recipient_list: client.email,
          subject,
          body_preview: htmlBody,
          sent_at: now.toISOString(),
          direction: 'outgoing',
          attachments: null,
        }
      ], { onConflict: 'message_id' });
      if (onClientUpdate) await onClientUpdate();
      // Refresh meetings to show updated data
      await fetchMeetings();
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
      
      // Check if meeting already has a Teams URL
      if (meeting.link) {
        toast.success('Teams meeting already exists for this meeting');
        return;
      }
      
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
      
      // Check if this is a legacy meeting
      const isLegacyMeeting = (meeting as any).isLegacy;
      
      if (isLegacyMeeting) {
        // For legacy meetings, update the leads_lead table
        const legacyId = client.id.toString().replace('legacy_', '');
        const { error } = await supabase
          .from('leads_lead')
          .update({ meeting_url: joinUrl })
          .eq('id', legacyId);
        
        if (error) throw error;
      } else {
        // For new meetings, update the meetings table
        const { error: newError } = await supabase
          .from('meetings')
          .update({ teams_meeting_url: joinUrl })
          .eq('id', meeting.id);
        
        if (newError) throw newError;
      }
      toast.success('Teams meeting created and saved!');
      if (onClientUpdate) await onClientUpdate();
      // Refresh meetings to show updated data
      await fetchMeetings();
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

  // Helper to determine if a meeting is in the past
  const isPastMeeting = (meeting: Meeting) => {
    if (meeting.status === 'canceled') return true;
    const meetingDateTime = new Date(`${meeting.date}T${meeting.time || '00:00'}`);
    return meetingDateTime < new Date();
  };

  // Helper to determine if a past meeting is within 1 day
  const isRecentPastMeeting = (meeting: Meeting) => {
    if (!isPastMeeting(meeting)) return false;
    const meetingDateTime = new Date(`${meeting.date}T${meeting.time || '00:00'}`);
    const now = new Date();
    const diffMs = now.getTime() - meetingDateTime.getTime();
    return diffMs <= 24 * 60 * 60 * 1000; // 1 day in ms
  };

  // Split meetings into upcoming and past
  const upcomingMeetings = meetings.filter(m => !isPastMeeting(m));
  const pastMeetings = meetings.filter(m => isPastMeeting(m));

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



    const past = isPastMeeting(meeting);
    const showPastActions = past && isRecentPastMeeting(meeting);

    return (
      <div key={meeting.id} className="bg-white border border-purple-200 rounded-xl shadow-lg hover:shadow-xl hover:border-purple-300 transition-all duration-200 overflow-hidden relative">
        {/* Canceled watermark */}
        {meeting.status === 'canceled' && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="bg-red-500 text-white px-4 py-2 rounded-lg transform -rotate-12 font-bold text-lg shadow-lg">
              CANCELED
            </div>
          </div>
        )}
        {/* Header */}
        <div className="px-4 py-3 bg-gradient-to-r from-purple-50 to-blue-50 border-b border-purple-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 shadow-sm">
                <CalendarIcon className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-bold text-lg text-gray-900">{formattedDate}</p>
                <div className="flex items-center gap-2 text-purple-600">
                  <ClockIcon className="w-4 h-4" />
                  <span className="text-sm font-medium">{meeting.time ? meeting.time.substring(0, 5) : ''}</span>
                </div>
              </div>
            </div>
            {/* Action Buttons */}
            <div className="flex gap-2">
              {!past && (
                <button
                  className="btn btn-sm bg-purple-600 hover:bg-purple-700 text-white border-none shadow-sm"
                  onClick={() => handleSendEmail(meeting)}
                  disabled={isSendingEmail}
                >
                  <EnvelopeIcon className="w-4 h-4" />
                  Notify
                </button>
              )}
              {!past && getMeetingLocationName(meeting.location) === 'Teams' && !meeting.link && (
                <button
                  className="btn btn-sm btn-outline border-purple-300 text-purple-600 hover:bg-purple-50"
                  onClick={() => handleCreateTeamsMeeting(meeting)}
                  disabled={creatingTeamsMeetingId === meeting.id}
                >
                  {creatingTeamsMeetingId === meeting.id ? (
                    <span className="loading loading-spinner loading-xs"></span>
                  ) : (
                    <VideoCameraIcon className="w-4 h-4" />
                  )}
                  Teams
                </button>
              )}
              {!past && meeting.link && getValidTeamsLink(meeting.link) && (
                <a
                  href={getValidTeamsLink(meeting.link)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-sm bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white border-none shadow-sm"
                >
                  <LinkIcon className="w-4 h-4" />
                  Join
                </a>
              )}
              {/* Legacy meeting URL link */}
              {meeting.link && !getValidTeamsLink(meeting.link) && (
                <a
                  href={meeting.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-sm bg-green-600 hover:bg-green-700 text-white border-none shadow-sm"
                >
                  <LinkIcon className="w-4 h-4" />
                  Link
                </a>
              )}
              {/* Cancel only for upcoming and not canceled */}
              {!isPastMeeting(meeting) && meeting.status !== 'canceled' && (
                <button
                  className="btn btn-outline btn-error btn-sm"
                  title="Cancel Meeting"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm('Cancel this meeting?')) return;
                    try {
                      const { data: { user } } = await supabase.auth.getUser();
                      const editor = user?.email || 'system';
                      const { error } = await supabase.from('meetings').update({ status: 'canceled', last_edited_timestamp: new Date().toISOString(), last_edited_by: editor }).eq('id', meeting.id);
                      if (error) throw error;
                      toast.success('Meeting canceled');
                      setMeetings(prev => prev.map(m => m.id === meeting.id ? { ...m, status: 'canceled' } : m));
                      if (onClientUpdate) await onClientUpdate();
                      // Refresh meetings to show updated data
                      await fetchMeetings();
                    } catch (err) {
                      toast.error('Failed to cancel meeting');
                    }
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          <div className="space-y-3">



            {/* Meeting Details */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium text-purple-600 uppercase tracking-wide">Location</label>
                <div className="flex items-center gap-2">
                  <MapPinIcon className="w-4 h-4 text-purple-400" />
                  <span className="text-base text-gray-900">{getMeetingLocationName(meeting.location)}</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-purple-600 uppercase tracking-wide">Manager</label>
                <div className="flex items-center gap-2">
                  <UserIcon className="w-4 h-4 text-purple-400" />
                  <span className="text-base text-gray-900">{getEmployeeDisplayName(meeting.manager)}</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-purple-600 uppercase tracking-wide">Scheduler</label>
                <div className="flex items-center gap-2">
                  <UserCircleIcon className="w-4 h-4 text-purple-400" />
                  <span className="text-base text-gray-900">{getEmployeeDisplayName(meeting.scheduler)}</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-purple-600 uppercase tracking-wide">Helper</label>
                <div className="flex items-center gap-2">
                  <UserCircleIcon className="w-4 h-4 text-purple-400" />
                  <span className="text-base text-gray-900">{getEmployeeDisplayName(meeting.helper)}</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-purple-600 uppercase tracking-wide">Expert</label>
                <div className="flex items-center gap-2">
                  <AcademicCapIcon className="w-4 h-4 text-purple-400" />
                  <span className="text-base text-gray-900">{getEmployeeDisplayName(meeting.expert)}</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-purple-600 uppercase tracking-wide">Amount</label>
                <div className="flex items-center gap-1">
                  {meeting.amount && meeting.amount > 0 ? (
                    <span className="text-base font-semibold text-purple-700">
                      {getCurrencySymbol(meeting.currency)} {typeof meeting.amount === 'number' ? meeting.amount.toLocaleString() : meeting.amount}
                    </span>
                  ) : (
                    <span className="text-base text-gray-400 italic">Not specified</span>
                  )}
                </div>
              </div>
            </div>

            {/* Brief Section */}
            <div className="border-t border-purple-100 pt-3">
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm font-medium text-purple-600 uppercase tracking-wide">Brief</label>
                {editingBriefId === meeting.id ? (
                  <div className="flex items-center gap-1">
                    <button className="btn btn-ghost btn-xs hover:bg-green-50" onClick={() => handleSaveBrief(meeting.id)}>
                      <CheckIcon className="w-4 h-4 text-green-600" />
                    </button>
                    <button className="btn btn-ghost btn-xs hover:bg-red-50" onClick={handleCancelEdit}>
                      <XMarkIcon className="w-4 h-4 text-red-600" />
                    </button>
                  </div>
                ) : (
                  <button className="btn btn-ghost btn-xs hover:bg-purple-50" onClick={handleEditBrief}>
                    <PencilSquareIcon className="w-4 h-4 text-purple-500 hover:text-purple-600" />
                  </button>
                )}
              </div>
              {editingBriefId === meeting.id ? (
                <textarea
                  className="textarea textarea-bordered w-full h-20 text-base"
                  value={editedBrief}
                  onChange={(e) => setEditedBrief(e.target.value)}
                  placeholder="Add a meeting brief..."
                />
              ) : (
                <div className="bg-gray-50 rounded-lg p-3 min-h-[60px]">
                  {meeting.brief ? (
                    <p className="text-base text-gray-900 whitespace-pre-wrap">{meeting.brief}</p>
                  ) : (
                    <span className="text-base text-gray-400 italic">No brief provided</span>
                  )}
                </div>
              )}
            </div>

            {/* Last Edited */}
            {meeting.lastEdited && (
              <div className="text-sm text-gray-400 flex justify-between border-t border-gray-100 pt-2">
                <span>Last edited by {meeting.lastEdited.user}</span>
                <span>{new Date(meeting.lastEdited.timestamp).toLocaleDateString()}</span>
              </div>
            )}
          </div>
        </div>
        {/* Collapsible Section */}
        {isExpanded && (
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 border-t border-purple-100 p-4">
            {expandedData.loading ? (
              <div className="flex justify-center items-center py-8">
                <span className="loading loading-spinner loading-md text-purple-600"></span>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Meeting Summary */}
                <MeetingSummaryComponent
                  meetingId={meeting.id}
                  clientId={client.id}
                  clientEmail={client.email}
                  onUpdate={onClientUpdate}
                />
                
                {/* Expert and Handler Notes */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-white rounded-lg p-4 border border-purple-100 shadow-sm">
                    <div className="flex justify-between items-center mb-2">
                      <h5 className="font-semibold text-purple-800">Expert Notes</h5>
                      <button 
                        className="btn btn-ghost btn-xs hover:bg-purple-50"
                        onClick={() => handleEditField(meeting.id, 'expert_notes', expandedData.expert_notes)}
                      >
                        <PencilSquareIcon className="w-4 h-4 text-purple-500 hover:text-purple-600" />
                      </button>
                    </div>
                    {editingField?.meetingId === meeting.id && editingField?.field === 'expert_notes' ? (
                      <textarea
                        className="textarea textarea-bordered w-full h-20 text-sm"
                        value={editedContent}
                        onChange={e => setEditedContent(e.target.value)}
                        placeholder="Edit expert notes..."
                      />
                    ) : (
                      <div className="bg-gray-50 rounded-lg p-3 min-h-[60px]">
                        {expandedData.expert_notes ? (
                          <p className="text-sm text-gray-900">
                            {Array.isArray(expandedData.expert_notes) && expandedData.expert_notes.length > 0
                              ? expandedData.expert_notes[expandedData.expert_notes.length - 1].content
                              : expandedData.expert_notes}
                          </p>
                        ) : (
                          <span className="text-sm text-gray-400 italic">No notes yet</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="bg-white rounded-lg p-4 border border-purple-100 shadow-sm">
                    <div className="flex justify-between items-center mb-2">
                      <h5 className="font-semibold text-purple-800">Handler Notes</h5>
                      <button 
                        className="btn btn-ghost btn-xs hover:bg-purple-50"
                        onClick={() => handleEditField(meeting.id, 'handler_notes', expandedData.handler_notes)}
                      >
                        <PencilSquareIcon className="w-4 h-4 text-purple-500 hover:text-purple-600" />
                      </button>
                    </div>
                    {editingField?.meetingId === meeting.id && editingField?.field === 'handler_notes' ? (
                      <textarea
                        className="textarea textarea-bordered w-full h-20 text-sm"
                        value={editedContent}
                        onChange={e => setEditedContent(e.target.value)}
                        placeholder="Edit handler notes..."
                      />
                    ) : (
                      <div className="bg-gray-50 rounded-lg p-3 min-h-[60px]">
                        {expandedData.handler_notes ? (
                          <p className="text-sm text-gray-900">
                            {Array.isArray(expandedData.handler_notes) && expandedData.handler_notes.length > 0
                              ? expandedData.handler_notes[expandedData.handler_notes.length - 1].content
                              : expandedData.handler_notes}
                          </p>
                        ) : (
                          <span className="text-sm text-gray-400 italic">No notes yet</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Expander Toggle */}
        <div
          className="bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 cursor-pointer transition-all p-2 text-center border-t border-purple-200"
          onClick={() => setExpandedMeetingId(expandedMeetingId === meeting.id ? null : meeting.id)}
        >
          <div className="flex items-center justify-center gap-2 text-xs font-medium text-white">
            <span>{expandedMeetingId === meeting.id ? 'Show Less' : 'Show More'}</span>
            <ChevronDownIcon className={`w-4 h-4 transition-transform ${expandedMeetingId === meeting.id ? 'rotate-180' : ''}`} />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-2 sm:p-4 md:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
            <CalendarIcon className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Meeting Management</h2>
            <p className="text-sm text-gray-500">Schedule and track client meetings</p>
          </div>
        </div>
        <button
          onClick={fetchMeetings}
          className="btn btn-outline btn-sm gap-2 hover:bg-purple-50"
          title="Refresh meetings"
        >
          <ArrowPathIcon className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Lead Scheduling Info Box */}
      {(leadSchedulingInfo.scheduler || leadSchedulingInfo.meeting_scheduling_notes || leadSchedulingInfo.next_followup || leadSchedulingInfo.followup) && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
          <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
            <h4 className="text-lg font-semibold text-gray-900">Scheduling Information</h4>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">Scheduler</label>
                <div className="bg-gray-50 rounded-lg p-3">
                  <span className="text-base font-semibold text-gray-900">
                    {getEmployeeDisplayName(leadSchedulingInfo.scheduler) || <span className="text-gray-400 font-normal">Not assigned</span>}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">Scheduling Notes</label>
                <div className="bg-gray-50 rounded-lg p-3 min-h-[60px]">
                  <span className="text-sm text-gray-900 whitespace-pre-line">
                    {leadSchedulingInfo.meeting_scheduling_notes || <span className="text-gray-400 italic">No notes</span>}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">Next Follow-up</label>
                <div className="bg-gray-50 rounded-lg p-3">
                  <span className="text-base font-semibold text-gray-900">
                    {leadSchedulingInfo.next_followup ? new Date(leadSchedulingInfo.next_followup).toLocaleDateString() : <span className="text-gray-400 font-normal">Not set</span>}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-500 uppercase tracking-wide">Follow-up Notes</label>
                <div className="bg-gray-50 rounded-lg p-3 min-h-[60px]">
                  <span className="text-sm text-gray-900 whitespace-pre-line">
                    {leadSchedulingInfo.followup || <span className="text-gray-400 italic">No notes</span>}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Meeting Summary Content Box */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
        <div className="px-6 py-4 bg-gradient-to-r from-blue-50 to-purple-50 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gradient-to-tr from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h4 className="text-lg font-semibold text-gray-900">Meeting Summary Content</h4>
          </div>
        </div>
        <div className="p-6">
          <div className="space-y-4">
            <div className="text-sm text-gray-600">
              <p>This section displays AI-generated meeting summaries, transcripts, and genealogical data extracted from Teams meetings.</p>
              <p className="mt-2">Summaries are automatically generated when meetings end and transcripts become available.</p>
            </div>
            
            {/* Summary Status */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-4 h-4 bg-blue-500 rounded-full"></div>
                <span className="font-medium text-blue-900">Summary Status</span>
              </div>
              <p className="text-sm text-blue-700">
                Meeting summaries will appear here automatically after meetings with transcription enabled.
              </p>
            </div>

            {/* Instructions */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-4 h-4 bg-yellow-500 rounded-full"></div>
                <span className="font-medium text-yellow-900">How to Get Summaries</span>
              </div>
              <ul className="text-sm text-yellow-700 space-y-1">
                <li>• Schedule meetings with <code className="bg-yellow-100 px-1 rounded">[#CLIENTID]</code> in the subject</li>
                <li>• Enable transcription in Teams meetings</li>
                <li>• Speak in Hebrew or English during the meeting</li>
                <li>• End the meeting normally - summary will appear automatically</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Two-column grid: Upcoming (left) and Past (right) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Upcoming Meetings (Left) */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
          <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
            <h4 className="text-lg font-semibold text-gray-900">Upcoming Meetings</h4>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              {upcomingMeetings.length > 0 ? (
                upcomingMeetings.map(renderMeetingCard)
              ) : (
                <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg">
                  <CalendarIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                  <p className="font-medium">No upcoming meetings</p>
                  <p className="text-sm">Schedule a meeting to get started</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Past Meetings (Right) */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
          <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
            <h4 className="text-lg font-semibold text-gray-900">Past Meetings</h4>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              {pastMeetings.length > 0 ? (
                pastMeetings.map(renderMeetingCard)
              ) : (
                <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg">
                  <ClockIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                  <p className="font-medium">No past meetings</p>
                  <p className="text-sm">Completed meetings will appear here</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {meetings.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-lg overflow-hidden">
          <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
            <h4 className="text-lg font-semibold text-gray-900">Meetings</h4>
          </div>
          <div className="p-6">
            <div className="text-center py-12 text-gray-500">
              <CalendarIcon className="w-16 h-16 mx-auto text-gray-300 mb-4" />
              <p className="text-lg font-medium mb-2">No meetings scheduled</p>
              <p className="text-sm">Schedule your first meeting to get started</p>
            </div>
          </div>
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
      
      <TimelineHistoryButtons client={client} />
    </div>
  );
};

export default MeetingTab; 