import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  PencilIcon,
} from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import { supabase } from '../../lib/supabase';
import { fetchLeadContacts, ContactInfo } from '../../lib/contactHelpers';
import { buildApiUrl } from '../../lib/api';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { loginRequest } from '../../msalConfig';
import { createTeamsMeeting, sendEmail, createCalendarEventWithAttendee } from '../../lib/graph';
import { generateICSFromDateTime } from '../../lib/icsGenerator';
import { meetingInvitationEmailTemplate } from '../Meetings';
import MeetingSummaryComponent from '../MeetingSummary';
import { replaceEmailTemplateParams, replaceEmailTemplateParamsSync } from '../../lib/emailTemplateParams';

const fakeNames = ['Anna Zh', 'Mindi', 'Sarah L', 'David K', '---'];

// This will be populated dynamically from the database
const getLocationOptions = (meetingLocations: any[]) => {
  return meetingLocations.map(loc => loc.name).filter(Boolean);
};

const parseMeetingConfirmationValue = (value: any): boolean | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return true;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return null;
};

const normalizeMeetingConfirmationBy = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
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
  const [showScheduleDrawer, setShowScheduleDrawer] = useState(false);
  const [sendingEmailMeetingId, setSendingEmailMeetingId] = useState<number | null>(null);
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
  
  // Edit meeting state
  const [editingMeetingId, setEditingMeetingId] = useState<number | null>(null);
  const [editedMeeting, setEditedMeeting] = useState<Partial<Meeting>>({});
  const [isUpdatingMeeting, setIsUpdatingMeeting] = useState(false);


  // New: Lead-level scheduling info
  const [leadSchedulingInfo, setLeadSchedulingInfo] = useState<{
    scheduler?: string;
    meeting_scheduling_notes?: string;
    next_followup?: string;
    followup?: string;
    meeting_confirmation?: boolean | null;
    meeting_confirmation_by?: number | null;
  }>({});

  // Scheduling information history
  const [schedulingHistory, setSchedulingHistory] = useState<Array<{
    id: string;
    meeting_scheduling_notes?: string;
    next_followup?: string;
    followup?: string;
    followup_log?: string;
    created_by: string;
    created_at: string;
    note_id?: string;
    from_notes?: boolean; // Flag to indicate if this came from lead_notes
  }>>([]);

  const [creatingTeamsMeetingId, setCreatingTeamsMeetingId] = useState<number | null>(null);
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [allMeetingLocations, setAllMeetingLocations] = useState<any[]>([]);
  
  // Notify modal state
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [selectedMeetingForNotify, setSelectedMeetingForNotify] = useState<Meeting | null>(null);
  const [contacts, setContacts] = useState<ContactInfo[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [selectedEmailLanguage, setSelectedEmailLanguage] = useState<'en' | 'he'>('en');
  const [emailTemplates, setEmailTemplates] = useState<{ en: string | null; he: string | null }>({ en: null, he: null });
  const [emailType, setEmailType] = useState<'invitation' | 'invitation_jlm' | 'invitation_tlv' | 'invitation_tlv_parking' | 'reminder' | 'cancellation' | 'rescheduled'>('invitation');
  
  // Notify dropdown state
  const [showNotifyDropdown, setShowNotifyDropdown] = useState<number | null>(null); // Track which meeting's dropdown is open
  const notifyDropdownRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [showWhatsAppDropdown, setShowWhatsAppDropdown] = useState<number | null>(null); // Track which meeting's WhatsApp dropdown is open
  const whatsAppDropdownRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [whatsAppReminderType, setWhatsAppReminderType] = useState<'reminder' | 'missed_appointment'>('reminder');
  
  // WhatsApp notify modal state
  const [showWhatsAppNotifyModal, setShowWhatsAppNotifyModal] = useState(false);
  const [selectedMeetingForWhatsAppNotify, setSelectedMeetingForWhatsAppNotify] = useState<Meeting | null>(null);
  const [whatsAppContacts, setWhatsAppContacts] = useState<ContactInfo[]>([]);
  const [loadingWhatsAppContacts, setLoadingWhatsAppContacts] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<'he' | 'en' | 'ru'>('he');
  const [reminderTemplates, setReminderTemplates] = useState<Array<{ id: number; language: string; content: string; name: string; params?: string; param_mapping?: any }>>([]);
  const [sendingWhatsAppMeetingId, setSendingWhatsAppMeetingId] = useState<number | null>(null);
  
  // Schedule Meeting Drawer state
  const [scheduleMeetingFormData, setScheduleMeetingFormData] = useState({
    date: '',
    time: '09:00',
    location: 'Teams',
    manager: '',
    helper: '',
    brief: '',
    attendance_probability: 'Medium',
    complexity: 'Simple',
    car_number: '',
    calendar: 'current', // 'current' or 'active_client'
  });
  const [isSchedulingMeeting, setIsSchedulingMeeting] = useState(false);
  const [meetingCountsByTime, setMeetingCountsByTime] = useState<Record<string, number>>({});
  const [showTimeDropdown, setShowTimeDropdown] = useState(false);
  const timeDropdownRef = useRef<HTMLDivElement>(null);
  const [showManagerDropdown, setShowManagerDropdown] = useState(false);
  const managerDropdownRef = useRef<HTMLDivElement>(null);
  const [managerSearchTerm, setManagerSearchTerm] = useState('');
  const [showHelperDropdown, setShowHelperDropdown] = useState(false);
  const helperDropdownRef = useRef<HTMLDivElement>(null);
  const [helperSearchTerm, setHelperSearchTerm] = useState('');

  // Reschedule drawer state
  const [showRescheduleDrawer, setShowRescheduleDrawer] = useState(false);
  const [rescheduleFormData, setRescheduleFormData] = useState({
    date: '',
    time: '09:00',
    location: 'Teams',
    calendar: 'active_client',
    manager: '',
    helper: '',
    brief: '',
    attendance_probability: 'Medium',
    complexity: 'Simple',
    car_number: '',
  });
  const [meetingToDelete, setMeetingToDelete] = useState<number | null>(null);
  const [rescheduleOption, setRescheduleOption] = useState<'cancel' | 'reschedule'>('cancel');
  const [rescheduleMeetings, setRescheduleMeetings] = useState<any[]>([]);
  const [isReschedulingMeeting, setIsReschedulingMeeting] = useState(false);

  // Helper function to get tomorrow's date
  const getTomorrowDate = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  };

  // Helper function to get employee display name from ID
  const getEmployeeDisplayName = (employeeId: string | number | null | undefined) => {
    if (employeeId === null || employeeId === undefined || employeeId === '---') return '--';
    const employee = allEmployees.find((emp: any) => emp.id.toString() === employeeId.toString());
    return employee ? employee.display_name : employeeId.toString();
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

// Helper function to detect Hebrew/RTL text
const containsRTL = (text?: string | null): boolean => {
  if (!text) return false;
  // Remove HTML tags to check only text content
  const textOnly = text.replace(/<[^>]*>/g, '');
  return /[\u0590-\u05FF]/.test(textOnly);
};

// Parse template content from database (handles various formats)
const parseTemplateContent = (rawContent: string | null | undefined): string => {
  if (!rawContent) return '';

  const sanitizeTemplateText = (text: string) => {
    if (!text) return '';
    return text
      .split('\n')
      .map(line => line.replace(/\s+$/g, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  };

  const tryParseDelta = (input: string) => {
    try {
      const parsed = JSON.parse(input);
      const ops = parsed?.delta?.ops || parsed?.ops;
      if (Array.isArray(ops)) {
        const text = ops
          .map((op: any) => (typeof op?.insert === 'string' ? op.insert : ''))
          .join('');
        return sanitizeTemplateText(text);
      }
    } catch (error) {
      // ignore
    }
    return null;
  };

  const cleanHtml = (input: string) => {
    let text = input;
    const htmlMatch = text.match(/html\s*:\s*(.*)/is);
    if (htmlMatch) {
      text = htmlMatch[1];
    }
    text = text
      .replace(/^{?delta\s*:\s*\{.*?\},?/is, '')
      .replace(/^{|}$/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\r/g, '')
      .replace(/\\/g, '\\');
    return sanitizeTemplateText(text);
  };

  let text = tryParseDelta(rawContent);
  if (text !== null) {
    return text;
  }

  text = tryParseDelta(
    rawContent
      .replace(/^"|"$/g, '')
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
  );
  if (text !== null) {
    return text;
  }

  const normalised = rawContent
    .replace(/\\"/g, '"')
    .replace(/\r/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
  const insertRegex = /"?insert"?\s*:\s*"([^"\n]*)"/g;
  const inserts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = insertRegex.exec(normalised))) {
    inserts.push(match[1]);
  }
  if (inserts.length > 0) {
    const combined = inserts.join('');
    const decoded = combined.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    return sanitizeTemplateText(decoded);
  }

  return sanitizeTemplateText(cleanHtml(rawContent));
};

// Helper function to preserve line breaks and format HTML with RTL support
const formatEmailBody = async (
  template: string, 
  recipientName: string,
  context?: {
    client?: any;
    meeting?: Meeting;
    meetingDate?: string;
    meetingTime?: string;
    meetingLocation?: string;
    meetingLink?: string;
  }
): Promise<string> => {
  if (!template) return '';
  
  let htmlBody = template;
  
  // If context is provided, use centralized template replacement
  if (context?.client || context?.meeting) {
    const isLegacyLead = context.client?.lead_type === 'legacy' || 
                         (context.client?.id && context.client.id.toString().startsWith('legacy_'));
    
    // Determine client ID and legacy ID
    let clientId: string | null = null;
    let legacyId: number | null = null;
    
    if (isLegacyLead) {
      if (context.client?.id) {
        const numeric = parseInt(context.client.id.toString().replace(/[^0-9]/g, ''), 10);
        legacyId = isNaN(numeric) ? null : numeric;
        clientId = legacyId?.toString() || null;
      }
    } else {
      clientId = context.client?.id || null;
    }
    
    // Use provided meeting data or fetch from DB
    const templateContext = {
      clientId,
      legacyId,
      clientName: context.client?.name || recipientName,
      contactName: recipientName,
      leadNumber: context.client?.lead_number || null,
      // topic: context.client?.topic || null, // Topic removed - not to be included in emails
      leadType: context.client?.lead_type || null,
      meetingDate: context.meetingDate || null,
      meetingTime: context.meetingTime || null,
      meetingLocation: context.meetingLocation || null,
      meetingLink: context.meetingLink || null,
    };
    
    htmlBody = await replaceEmailTemplateParams(template, templateContext);
  } else {
    // Fallback: just replace {name} for backward compatibility
    htmlBody = template.replace(/\{\{name\}\}/g, recipientName).replace(/\{name\}/gi, recipientName);
  }
  
  // Preserve line breaks: convert \n to <br> if not already in HTML
  // Check if content already has HTML structure
  const hasHtmlTags = /<[a-z][\s\S]*>/i.test(htmlBody);
  
  if (!hasHtmlTags) {
    // Plain text: convert line breaks to <br> and preserve spacing
    htmlBody = htmlBody
      .replace(/\r\n/g, '\n')  // Normalize line endings
      .replace(/\r/g, '\n')    // Handle old Mac line endings
      .replace(/\n/g, '<br>'); // Convert to HTML line breaks
  } else {
    // Has HTML: ensure <br> tags are preserved, convert remaining \n
    htmlBody = htmlBody
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/(<br\s*\/?>|\n)/gi, '<br>') // Normalize all line breaks
      .replace(/\n/g, '<br>'); // Convert any remaining newlines
  }
  
  // Detect if content contains Hebrew/RTL text
  const isRTL = containsRTL(htmlBody);
  
  // Wrap in div with proper direction and styling
  if (isRTL) {
    htmlBody = `<div dir="rtl" style="text-align: right; direction: rtl; font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif;">${htmlBody}</div>`;
  } else {
    htmlBody = `<div dir="ltr" style="text-align: left; direction: ltr; font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif;">${htmlBody}</div>`;
  }
  
  return htmlBody;
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

    const fetchReminderTemplates = async () => {
      // Fetch both reminder_of_a_meeting and missed_appointment templates
      // Fetch all languages and normalize in code, since DB might have 'he_IL', 'en_US', etc.
      const { data, error } = await supabase
        .from('whatsapp_templates_v2')
        .select('id, name, language, content, params, param_mapping')
        .in('name', ['reminder_of_a_meeting', 'missed_appointment'])
        .eq('active', true);
      
      if (!error && data) {
        console.log('📱 Fetched reminder templates:', data);
        setReminderTemplates(data);
      } else {
        console.error('Error fetching reminder templates:', error);
      }
    };

    fetchEmployees();
    fetchMeetingLocations();
    fetchReminderTemplates();
  }, []);

  // Set default location to Teams when meeting locations are loaded
  useEffect(() => {
    if (allMeetingLocations.length > 0 && !scheduleMeetingFormData.location) {
      const teamsLocation = allMeetingLocations.find(loc => loc.name === 'Teams') || allMeetingLocations[0];
      setScheduleMeetingFormData(prev => ({
        ...prev,
        location: teamsLocation.name,
      }));
    }
  }, [allMeetingLocations]);

  // Fetch meeting counts by time for the selected date
  useEffect(() => {
    const fetchMeetingCounts = async () => {
      if (!scheduleMeetingFormData.date) {
        setMeetingCountsByTime({});
        return;
      }

      try {
        const { data: meetings, error } = await supabase
          .from('meetings')
          .select('meeting_time')
          .eq('meeting_date', scheduleMeetingFormData.date)
          .or('status.is.null,status.neq.canceled');

        if (error) {
          console.error('Error fetching meeting counts:', error);
          setMeetingCountsByTime({});
          return;
        }

        const counts: Record<string, number> = {};
        if (meetings) {
          meetings.forEach((meeting: any) => {
            if (meeting.meeting_time) {
              const timeStr = typeof meeting.meeting_time === 'string' 
                ? meeting.meeting_time.substring(0, 5) 
                : new Date(meeting.meeting_time).toTimeString().substring(0, 5);
              counts[timeStr] = (counts[timeStr] || 0) + 1;
            }
          });
        }
        setMeetingCountsByTime(counts);
      } catch (error) {
        console.error('Error fetching meeting counts:', error);
        setMeetingCountsByTime({});
      }
    };

    fetchMeetingCounts();
  }, [scheduleMeetingFormData.date]);

  // Handle click outside for dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (timeDropdownRef.current && !timeDropdownRef.current.contains(event.target as Node)) {
        setShowTimeDropdown(false);
      }
      if (managerDropdownRef.current && !managerDropdownRef.current.contains(event.target as Node)) {
        setShowManagerDropdown(false);
      }
      if (helperDropdownRef.current && !helperDropdownRef.current.contains(event.target as Node)) {
        setShowHelperDropdown(false);
      }
      // Close notify dropdowns
      notifyDropdownRefs.current.forEach((ref, meetingId) => {
        if (ref && !ref.contains(event.target as Node)) {
          if (showNotifyDropdown === meetingId) {
            setShowNotifyDropdown(null);
          }
        }
      });
      // Close WhatsApp dropdowns
      whatsAppDropdownRefs.current.forEach((ref, meetingId) => {
        if (ref && !ref.contains(event.target as Node)) {
          if (showWhatsAppDropdown === meetingId) {
            setShowWhatsAppDropdown(null);
          }
        }
      });
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showNotifyDropdown, showWhatsAppDropdown]);

      // Reset form and set default location to Teams when drawer opens
      useEffect(() => {
        if (showScheduleDrawer && allMeetingLocations.length > 0) {
          const teamsLocation = allMeetingLocations.find(loc => loc.name === 'Teams') || allMeetingLocations[0];
          setScheduleMeetingFormData({
            date: '',
            time: '09:00',
            location: teamsLocation.name,
            manager: '',
            helper: '',
            brief: '',
            attendance_probability: 'Medium',
            complexity: 'Simple',
            car_number: '',
            calendar: 'active_client',
          });
        }
      }, [showScheduleDrawer, allMeetingLocations]);

  // Simplified employee unavailability check (can be enhanced later)
  const isEmployeeUnavailable = useCallback((employeeName: string, date: string, time: string): boolean => {
    // This is a simplified version - can be enhanced with actual availability data
    return false;
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
            .select('meeting_scheduler_id, meeting_scheduling_notes, next_followup, followup_log, meeting_confirmation, meeting_confirmation_by')
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
              meeting_confirmation: parseMeetingConfirmationValue(data.meeting_confirmation),
              meeting_confirmation_by: normalizeMeetingConfirmationBy(data?.meeting_confirmation_by),
            });
          } else {
            setLeadSchedulingInfo({});
          }
        } else {
          // For new leads, fetch from leads table
          const { data: newData, error: newError } = await supabase
            .from('leads')
            .select('scheduler, meeting_scheduling_notes, next_followup, followup, meeting_confirmation, meeting_confirmation_by')
            .eq('id', client.id)
            .single();
          
          data = newData;
          error = newError;
          
          if (data) {
            setLeadSchedulingInfo({
              scheduler: data.scheduler || '',
              meeting_scheduling_notes: data.meeting_scheduling_notes || '',
              next_followup: data.next_followup || '',
              followup: data.followup || '',
              meeting_confirmation: parseMeetingConfirmationValue(data.meeting_confirmation),
              meeting_confirmation_by: normalizeMeetingConfirmationBy(data?.meeting_confirmation_by),
            });
          } else {
            setLeadSchedulingInfo({});
          }
        }
        
        if (error) throw error;
      } catch (error) {
        setLeadSchedulingInfo({});
      }
    };

    const fetchSchedulingHistory = async () => {
      if (!client.id) {
        setSchedulingHistory([]);
        return;
      }
      
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      
      try {
        // Fetch from scheduling_info_history table
        let historyQuery = supabase
          .from('scheduling_info_history')
          .select('*')
          .order('created_at', { ascending: false});
        
        if (isLegacyLead) {
          const legacyId = client.id.toString().replace('legacy_', '');
          historyQuery = historyQuery.eq('legacy_lead_id', legacyId);
        } else {
          historyQuery = historyQuery.eq('lead_id', client.id);
        }
        
        const { data: historyData, error: historyError } = await historyQuery;
        
        if (historyError) throw historyError;
        
        // Fetch from follow_ups table
        let followUpsQuery = supabase
          .from('follow_ups')
          .select(`
            *,
            users!user_id (
              full_name,
              email
            )
          `)
          .order('created_at', { ascending: false });
        
        if (isLegacyLead) {
          const legacyId = client.id.toString().replace('legacy_', '');
          followUpsQuery = followUpsQuery.eq('lead_id', legacyId);
        } else {
          followUpsQuery = followUpsQuery.eq('new_lead_id', client.id);
        }
        
        const { data: followUpsData, error: followUpsError } = await followUpsQuery;
        
        if (followUpsError) {
          console.error('Error fetching follow-ups:', followUpsError);
        }
        
        // Transform follow_ups data to match scheduling_history format
        const followUpsHistory = (followUpsData || []).map((entry: any) => ({
          id: entry.id,
          next_followup: entry.date,
          created_by: entry.users?.full_name || 'Unknown',
          created_at: entry.created_at,
          from_followups: true,
        }));
        
        // Fetch from lead_notes table for scheduling-related notes
        // Only fetch for new leads (legacy leads don't have lead_notes)
        let notesData: any[] = [];
        if (!isLegacyLead) {
          const { data: notes, error: notesError } = await supabase
            .from('lead_notes')
            .select('*')
            .eq('lead_id', client.id)
            .in('note_type', ['scheduling', 'followup', 'general'])
            .order('created_at', { ascending: false });
          
          if (!notesError && notes) {
            // Transform lead_notes to match scheduling_history format
            notesData = notes.map(note => ({
              id: note.id,
              meeting_scheduling_notes: note.content,
              next_followup: null,
              followup: note.note_type === 'followup' ? note.content : null,
              followup_log: null,
              created_by: note.created_by_name || 'Unknown',
              created_at: note.created_at,
              note_id: note.id,
              from_notes: true,
            }));
          }
        }
        
        // Merge and sort by created_at (newest first)
        const allHistory = [
          ...(historyData || []).map((entry: any) => ({ ...entry, from_notes: false, from_followups: false })),
          ...followUpsHistory,
          ...notesData,
        ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        
        setSchedulingHistory(allHistory);
      } catch (error) {
        console.error('Error fetching scheduling history:', error);
        setSchedulingHistory([]);
      }
    };

    // Add useEffect after both functions are defined
    useEffect(() => {
      console.log('MeetingTab useEffect triggered - client changed:', client?.id, client?.lead_type);
      fetchMeetings();
      fetchLeadSchedulingInfo();
      fetchSchedulingHistory();
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

  const handleNotifyClick = async (meeting: Meeting, type: 'invitation' | 'invitation_jlm' | 'invitation_tlv' | 'invitation_tlv_parking' | 'reminder' | 'cancellation' | 'rescheduled') => {
    setEmailType(type);
    setSelectedMeetingForNotify(meeting);
    setLoadingContacts(true);
    setShowNotifyDropdown(null); // Close dropdown
    try {
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      const normalizedLeadId = isLegacyLead 
        ? (typeof client.id === 'string' ? client.id.replace('legacy_', '') : String(client.id))
        : client.id;
      
      const fetchedContacts = await fetchLeadContacts(normalizedLeadId, isLegacyLead);
      setContacts(fetchedContacts);
      
      // Fetch email templates based on type
      try {
        let enTemplateId: number;
        let heTemplateId: number;
        
        switch (type) {
          case 'invitation':
            enTemplateId = 151;
            heTemplateId = 152;
            break;
          case 'invitation_jlm':
            enTemplateId = 157;
            heTemplateId = 158;
            break;
          case 'invitation_tlv':
            enTemplateId = 161;
            heTemplateId = 162;
            break;
          case 'invitation_tlv_parking':
            enTemplateId = 159;
            heTemplateId = 160;
            break;
          case 'reminder':
            enTemplateId = 163;
            heTemplateId = 164;
            break;
          case 'cancellation':
            enTemplateId = 153;
            heTemplateId = 154;
            break;
          case 'rescheduled':
            enTemplateId = 155;
            heTemplateId = 156;
            break;
          default:
            enTemplateId = 151;
            heTemplateId = 152;
        }
        
        const { data: enTemplate, error: enError } = await supabase
          .from('misc_emailtemplate')
          .select('content')
          .eq('id', enTemplateId)
          .single();
        
        const { data: heTemplate, error: heError } = await supabase
          .from('misc_emailtemplate')
          .select('content')
          .eq('id', heTemplateId)
          .single();
        
        if (!enError && enTemplate) {
          const parsedContent = parseTemplateContent(enTemplate.content);
          setEmailTemplates(prev => ({ ...prev, en: parsedContent }));
        } else {
          setEmailTemplates(prev => ({ ...prev, en: null }));
        }
        
        if (!heError && heTemplate) {
          const parsedContent = parseTemplateContent(heTemplate.content);
          setEmailTemplates(prev => ({ ...prev, he: parsedContent }));
        } else {
          setEmailTemplates(prev => ({ ...prev, he: null }));
        }
      } catch (error) {
        console.error('Error fetching email templates:', error);
      }
      
      setShowNotifyModal(true);
    } catch (error) {
      console.error('Error fetching contacts:', error);
      toast.error('Failed to load contacts');
    } finally {
      setLoadingContacts(false);
    }
  };

  const handleWhatsAppNotifyClick = async (meeting: Meeting) => {
    setSelectedMeetingForWhatsAppNotify(meeting);
    setLoadingWhatsAppContacts(true);
    try {
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      const normalizedLeadId = isLegacyLead 
        ? (typeof client.id === 'string' ? client.id.replace('legacy_', '') : String(client.id))
        : client.id;
      
      const fetchedContacts = await fetchLeadContacts(normalizedLeadId, isLegacyLead);
      console.log('📱 WhatsApp Notify - Fetched contacts (before dedup):', fetchedContacts.length, fetchedContacts);
      
      // Deduplicate contacts - only remove exact duplicates within the contact list
      const uniqueContacts: ContactInfo[] = [];
      const seenContactKeys = new Set<string>();

      // Helper to normalize contact info for comparison
      const normalizeContactInfo = (c: Partial<ContactInfo>) => {
        const normalizePhone = (phone: string | null | undefined) => phone?.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '') || '';
        return {
          name: (c.name || '').toLowerCase().trim(),
          email: (c.email || '').toLowerCase().trim(),
          phone: normalizePhone(c.phone || c.mobile), // Use phone or mobile, whichever is available
        };
      };

      // Helper to check if two contacts are exact duplicates
      const contactsMatch = (c1: ContactInfo, c2: ContactInfo): boolean => {
        const n1 = normalizeContactInfo(c1);
        const n2 = normalizeContactInfo(c2);
        
        // Match if same email (and email is not empty)
        if (n1.email && n2.email && n1.email === n2.email) {
          return true;
        }
        
        // Match if same phone (and phone is not empty)
        if (n1.phone && n2.phone && n1.phone === n2.phone) {
          return true;
        }
        
        // Match if same name AND (same email OR same phone)
        if (n1.name && n2.name && n1.name === n2.name) {
          if ((n1.email && n2.email && n1.email === n2.email) ||
              (n1.phone && n2.phone && n1.phone === n2.phone)) {
            return true;
          }
        }
        
        return false;
      };

      // Add fetched contacts, deduplicating only exact duplicates
      fetchedContacts.forEach((contact) => {
        const normalized = normalizeContactInfo(contact);
        const contactKey = `${normalized.email}_${normalized.phone}_${normalized.name}`;
        
        // Check if we've already seen a contact with the same key
        if (seenContactKeys.has(contactKey)) {
          return; // Skip duplicate
        }
        
        // Check if this contact is a duplicate of any existing contact
        const isDuplicate = uniqueContacts.some(existing => contactsMatch(existing, contact));
        if (isDuplicate) {
          return; // Skip duplicate
        }
        
        // Add the contact
        seenContactKeys.add(contactKey);
        uniqueContacts.push(contact);
      });

      // If no contacts were found from DB, add a fallback contact based on the lead's primary info
      if (uniqueContacts.length === 0 && (client.phone || client.mobile)) {
        const fallbackContact: ContactInfo = {
          id: -1, // Use -1 as a temporary ID for fallback contact
          name: client.name || 'Client',
          email: client.email || null,
          phone: client.phone || null,
          mobile: client.mobile || null,
          country_id: null,
          isMain: true,
        };
        uniqueContacts.push(fallbackContact);
      }

      console.log('📱 WhatsApp Notify - Deduplicated contacts:', uniqueContacts.length, uniqueContacts);
      setWhatsAppContacts(uniqueContacts);
      setShowWhatsAppNotifyModal(true);
    } catch (error) {
      console.error('Error fetching contacts:', error);
      toast.error('Failed to load contacts');
    } finally {
      setLoadingWhatsAppContacts(false);
    }
  };

  const handleSendWhatsAppReminder = async (meeting: Meeting, phoneNumbers?: string | string[], reminderType?: 'reminder' | 'missed_appointment') => {
    if (!selectedMeetingForWhatsAppNotify) return;
    
    const type = reminderType || whatsAppReminderType;
    setSendingWhatsAppMeetingId(meeting.id);
    setShowWhatsAppNotifyModal(false);
    setShowWhatsAppDropdown(null); // Close dropdown
    
    try {
      // Get the selected template based on reminder type and language
      const templateName = type === 'missed_appointment' ? 'missed_appointment' : 'reminder_of_a_meeting';
      const targetLanguage = selectedLanguage.toLowerCase();
      
      // Helper function to normalize language code (e.g., 'he_IL' -> 'he', 'en_US' -> 'en')
      const normalizeLanguageCode = (lang: string | null | undefined): string => {
        if (!lang) return '';
        return lang.split('_')[0].toLowerCase();
      };
      
      // Template ID mappings:
      // reminder_of_a_meeting: HE = 1, EN = 2
      // missed_appointment: EN = 16, HE = 15, RU = 15
      let selectedTemplate;
      if (type === 'missed_appointment') {
        // Use template ID mapping for missed_appointment
        const templateIdMap: Record<string, number> = {
          'en': 16,
          'he': 15,
          'ru': 15
        };
        const templateId = templateIdMap[targetLanguage];
        
        // Match by ID first (most reliable)
        selectedTemplate = reminderTemplates.find(t => t.id === templateId);
        
        // Fallback: match by name and normalized language
        if (!selectedTemplate) {
          selectedTemplate = reminderTemplates.find(t => {
            const templateLangNormalized = normalizeLanguageCode(t.language);
            return t.name === 'missed_appointment' && templateLangNormalized === targetLanguage;
          });
        }
      } else {
        // reminder_of_a_meeting: match by ID first
        const templateIdMap: Record<string, number> = {
          'he': 1,
          'en': 2
        };
        const templateId = templateIdMap[targetLanguage];
        
        // Match by ID first (most reliable)
        selectedTemplate = reminderTemplates.find(t => t.id === templateId);
        
        // Fallback: match by name and normalized language
        if (!selectedTemplate) {
          selectedTemplate = reminderTemplates.find(t => {
            const templateLangNormalized = normalizeLanguageCode(t.language);
            return t.name === 'reminder_of_a_meeting' && templateLangNormalized === targetLanguage;
          });
        }
      }

      if (!selectedTemplate) {
        console.error('📱 Template not found:', { 
          selectedLanguage, 
          targetLanguage, 
          availableTemplates: reminderTemplates.map(t => ({ id: t.id, name: t.name, language: t.language }))
        });
        toast.error(`Reminder template not found for ${selectedLanguage === 'he' ? 'Hebrew' : 'English'}. Please ensure templates with name "reminder_of_a_meeting" and language "${targetLanguage}" exist in the database.`);
        return;
      }
      
      console.log('📱 Selected template:', { id: selectedTemplate.id, name: selectedTemplate.name, language: selectedTemplate.language });

      // Get current user's full name
      const { data: { user } } = await supabase.auth.getUser();
      let senderName = 'You';
      if (user?.id) {
        const { data: userRow, error: userLookupError } = await supabase
          .from('users')
          .select(`
            full_name,
            employee_id,
            tenants_employee!employee_id(
              display_name
            )
          `)
          .eq('auth_id', user.id)
          .single();
        if (!userLookupError && userRow) {
          const employee = Array.isArray(userRow.tenants_employee) ? userRow.tenants_employee[0] : userRow.tenants_employee;
          senderName = employee?.display_name || userRow.full_name || 'You';
        }
      }

      // Format meeting date
      const formatDate = (dateStr: string): string => {
        const [year, month, day] = dateStr.split('-');
        return `${day}/${month}/${year}`;
      };
      const formattedDate = formatDate(meeting.date);
      const formattedTime = meeting.time ? meeting.time.substring(0, 5) : '';

      // Get location name
      const locationName = getMeetingLocationName(meeting.location);

      // Determine phone numbers to send to
      const phoneNumbersToSend = phoneNumbers 
        ? (Array.isArray(phoneNumbers) ? phoneNumbers : [phoneNumbers])
        : [];

      if (phoneNumbersToSend.length === 0) {
        toast.error('No phone numbers selected');
        return;
      }

      // Send WhatsApp message to each phone number
      const sendPromises = phoneNumbersToSend.map(async (phoneNumber) => {
        if (!phoneNumber || phoneNumber.trim() === '') {
          return { success: false, phoneNumber, error: 'Invalid phone number' };
        }

        // Find contact for this phone number to get contact_id
        const contact = whatsAppContacts.find(c => 
          (c.phone && c.phone.trim() === phoneNumber.trim()) || 
          (c.mobile && c.mobile.trim() === phoneNumber.trim())
        );

        const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
        // Keep the 'legacy_' prefix for backend - backend expects it to identify legacy leads
        const normalizedLeadId = isLegacyLead 
          ? (typeof client.id === 'string' ? client.id : `legacy_${client.id}`)
          : client.id;

        // Generate template parameters - same approach as SchedulerWhatsAppModal
        let templateParameters: Array<{ type: string; text: string }> = [];
        const paramCount = Number(selectedTemplate.params) || 0;
        
        if (paramCount > 0) {
          try {
            console.log('🔍 Getting template param definitions...');
            const { getTemplateParamDefinitions, generateParamsFromDefinitions } = await import('../../lib/whatsappTemplateParamMapping');
            const { generateTemplateParameters } = await import('../../lib/whatsappTemplateParams');
            
            const paramDefinitions = await getTemplateParamDefinitions(selectedTemplate.id, selectedTemplate.name);
            
            // Create a client object with meeting data for parameter generation
            const currentMeeting = meeting;
            const formatDate = (dateStr: string): string => {
              const [year, month, day] = dateStr.split('-');
              return `${day}/${month}/${year}`;
            };
            const formattedDate = formatDate(currentMeeting.date);
            const formattedTime = currentMeeting.time ? currentMeeting.time.substring(0, 5) : '';
            const meetingLink = getValidTeamsLink(currentMeeting.link) || '';
            
            const clientForParams = {
              ...client,
              meeting_date: formattedDate,
              meeting_time: formattedTime,
              meeting_location: locationName,
              meeting_link: meetingLink,
            };
            
            if (paramDefinitions.length > 0) {
              console.log('✅ Using template-specific param definitions');
              templateParameters = await generateParamsFromDefinitions(paramDefinitions, clientForParams, contact?.id || null);
            } else {
              console.log('⚠️ No specific param definitions, using generic generation');
              templateParameters = await generateTemplateParameters(paramCount, clientForParams, contact?.id || null);
            }
            
            // Override with meeting-specific data
            // Note: mobile_number, phone_number, and email should use logged-in user's data (handled by helper functions)
            // Only override meeting-specific parameters
            if (paramDefinitions.length > 0) {
              paramDefinitions.forEach((param: any, index: number) => {
                if (templateParameters[index]) {
                  let paramValue = templateParameters[index].text || '';
                  
                  switch (param.type) {
                    case 'meeting_date':
                      paramValue = formattedDate || '';
                      break;
                    case 'meeting_time':
                      paramValue = formattedTime || '';
                      break;
                    case 'meeting_location':
                      paramValue = locationName || '';
                      break;
                    case 'meeting_link':
                      paramValue = meetingLink || '';
                      break;
                    // mobile_number, phone_number, and email are handled by helper functions
                    // which correctly fetch the logged-in user's data from tenants_employee table
                    default:
                      // Keep the generated value (includes mobile_number, phone_number, email from helper functions)
                      paramValue = templateParameters[index].text || '';
                  }
                  
                  templateParameters[index].text = paramValue.trim();
                }
              });
            }
            
            // Ensure we have exactly the right number of parameters
            while (templateParameters.length < paramCount) {
              templateParameters.push({ type: 'text', text: '' });
            }
            
            // Backend will handle empty parameter replacement with 'N/A'
            // Just ensure all parameters are strings (not null/undefined)
            templateParameters = templateParameters.map((param) => ({
              type: 'text',
              text: (param.text || '').trim()
            }));
            
            if (templateParameters && templateParameters.length > 0) {
              console.log(`✅ Template with ${paramCount} param(s) - auto-filled parameters:`, templateParameters);
            } else {
              console.error('❌ Failed to generate template parameters');
              toast.error('Failed to generate template parameters. Please try again.');
              setSendingWhatsAppMeetingId(null);
              return;
            }
          } catch (error) {
            console.error('❌ Error generating template parameters:', error);
            toast.error(`Error generating template parameters: ${error instanceof Error ? error.message : 'Unknown error'}`);
            setSendingWhatsAppMeetingId(null);
            return;
          }
        }

        // Generate filled template content for display (backend requires message field for templates with params)
        let filledContent = selectedTemplate.content || '';
        if (templateParameters && templateParameters.length > 0) {
          templateParameters.forEach((param, index) => {
            if (param && param.text) {
              filledContent = filledContent.replace(new RegExp(`\\{\\{${index + 1}\\}\\}`, 'g'), param.text);
            }
          });
        }

        const messagePayload: any = {
          leadId: normalizedLeadId,
          phoneNumber: phoneNumber.trim(),
          sender_name: senderName,
          isTemplate: true,
          templateId: selectedTemplate.id,
          templateName: selectedTemplate.name,
          templateLanguage: selectedTemplate.language || targetLanguage, // Use exact language from template: 'he' or 'en'
          contactId: contact?.id || null,
        };

        // Backend requires message field when template has parameters
        if (paramCount > 0) {
          messagePayload.templateParameters = templateParameters;
          messagePayload.message = filledContent || 'Template sent';
          console.log(`✅ Template with ${paramCount} param(s) - filled content:`, filledContent);
        } else {
          // Template with no parameters
          messagePayload.message = selectedTemplate.content || 'Template sent';
        }

        const response = await fetch(buildApiUrl('/api/whatsapp/send-message'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(messagePayload),
        });

        const result = await response.json();

        if (!response.ok) {
          let errorMessage = '';
          if (result.code === 'RE_ENGAGEMENT_REQUIRED') {
            errorMessage = '⚠️ WhatsApp 24-Hour Rule: You can only send template messages after 24 hours of customer inactivity.';
          } else {
            errorMessage = result.error || 'Failed to send WhatsApp message';
          }
          return { success: false, phoneNumber, error: errorMessage };
        }

        return { success: true, phoneNumber };
      });

      const results = await Promise.all(sendPromises);
      const successCount = results.filter((r): r is { success: boolean; phoneNumber: string; error?: string } => r !== undefined && r.success).length;
      const failureCount = results.filter((r): r is { success: boolean; phoneNumber: string; error?: string } => r !== undefined && !r.success).length;

      if (successCount > 0) {
        const typeLabel = type === 'missed_appointment' ? 'missed appointment' : 'reminder';
        toast.success(`WhatsApp ${typeLabel} sent to ${successCount} contact${successCount !== 1 ? 's' : ''}`);
        // Stage evaluation is handled automatically by database triggers
      }
      if (failureCount > 0) {
        const errors = results.filter((r): r is { success: boolean; phoneNumber: string; error?: string } => r !== undefined && !r.success).map(r => r.error || 'Unknown error').join(', ');
        toast.error(`Failed to send to ${failureCount} contact${failureCount !== 1 ? 's' : ''}: ${errors}`);
      }

      if (onClientUpdate) await onClientUpdate();
      await fetchMeetings();
    } catch (error) {
      console.error('Error sending WhatsApp reminder:', error);
      toast.error('Failed to send WhatsApp reminder');
    } finally {
      setSendingWhatsAppMeetingId(null);
    }
  };

  const handleSendEmail = async (meeting: Meeting, emailAddress?: string | string[], contactName?: string, explicitEmailType?: 'invitation' | 'invitation_jlm' | 'invitation_tlv' | 'invitation_tlv_parking' | 'reminder' | 'cancellation' | 'rescheduled') => {
    setSendingEmailMeetingId(meeting.id);
    setShowNotifyModal(false);
    try {
      const recipientEmail = emailAddress || client.email;
      if (!recipientEmail || (Array.isArray(recipientEmail) && recipientEmail.length === 0) || !instance) {
        throw new Error('Recipient email or MSAL instance missing');
      }
      const accounts = instance.getAllAccounts();
      if (!accounts.length) throw new Error('No Microsoft account found');
      const account = accounts[0];
      
      // Try silent token acquisition first, fall back to popup if needed
      let tokenResponse;
      try {
        tokenResponse = await instance.acquireTokenSilent({ ...loginRequest, account });
      } catch (error) {
        // If silent acquisition fails (e.g., session expired), try interactive popup
        if (error instanceof InteractionRequiredAuthError) {
          toast('Your session has expired. Please sign in again.', { icon: '🔑' });
          tokenResponse = await instance.acquireTokenPopup({ ...loginRequest, account });
        } else {
          throw error; // Re-throw other errors
        }
      }
      
      const senderName = account?.name || 'Your Team';
      const now = new Date();
      
      // Format time without seconds (for ICS file)
      const formattedTime = meeting.time ? meeting.time.substring(0, 5) : meeting.time;
      
      // Format date as dd/mm/yyyy
      const formatDate = (dateStr: string): string => {
        const [year, month, day] = dateStr.split('-');
        return `${day}/${month}/${year}`;
      };
      const formattedDate = formatDate(meeting.date);
      
      // Use explicit email type if provided, otherwise use state
      const currentEmailType = explicitEmailType || emailType;
      
      // Compose subject based on email type
      let subject: string;
      if (currentEmailType === 'cancellation') {
        subject = `[${client.lead_number || client.id}] - ${client.name} - Meeting Canceled`;
      } else if (currentEmailType === 'reminder') {
        subject = `Meeting Reminder - ${formattedDate}`;
      } else if (currentEmailType === 'rescheduled') {
        subject = `[${client.lead_number || client.id}] - ${client.name} - Meeting Rescheduled`;
      } else {
        // All invitation types (invitation, invitation_jlm, invitation_tlv, invitation_tlv_parking)
        subject = `Meeting with Decker, Pex, Levi Lawoffice - ${formattedDate}`;
      }
      const joinLink = getValidTeamsLink(meeting.link);
      // Category and topic removed - not to be included in emails
      const locationName = getMeetingLocationName(meeting.location);
      
      // Check if recipient email is a Microsoft domain (for Outlook/Exchange)
      const isMicrosoftEmail = (email: string | string[]): boolean => {
        const emails = Array.isArray(email) ? email : [email];
        const microsoftDomains = ['outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'onmicrosoft.com'];
        return emails.some(addr => 
          microsoftDomains.some(domain => addr.toLowerCase().includes(`@${domain}`))
        );
      };
      
      const recipientEmailArray = Array.isArray(recipientEmail) ? recipientEmail : [recipientEmail];
      const primaryRecipientEmail = recipientEmailArray[0];
      const useOutlookCalendarInvite = isMicrosoftEmail(recipientEmail);
      
      // Get recipient name (use provided contactName, or find from contacts, or fallback to client name)
      const recipientName = contactName || (Array.isArray(emailAddress) 
        ? (contacts.find(c => c.email === primaryRecipientEmail)?.name || client.name)
        : (contacts.find(c => c.email === emailAddress)?.name || client.name));
      
      // Build description HTML (category and topic removed)
      let descriptionHtml = `<p>Meeting with <strong>${recipientName}</strong></p>`;
      if (joinLink) {
        descriptionHtml += `<p><strong>Join Teams Meeting:</strong> <a href="${joinLink}">${joinLink}</a></p>`;
      }
      if (meeting.brief) {
        descriptionHtml += `<p><strong>Brief:</strong><br>${meeting.brief.replace(/\n/g, '<br>')}</p>`;
      }
      
      // Calendar subject (category and topic removed)
      const calendarSubject = `Meeting with Decker, Pex, Levi Lawoffice`;
      
      // Prepare date/time for calendar
      const startDateTime = new Date(`${meeting.date}T${formattedTime}:00`);
      const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000); // 1 hour duration
      
      // Determine language based on client's language_id for automatic template selection
      // For rescheduled emails, automatically use language_id; for others, use manual selection
      let languageToUse: 'en' | 'he';
      if (currentEmailType === 'rescheduled') {
        // Automatically determine language from client's language_id
        const isHebrew = client.language_id === 2 || 
                        (client.language_id === undefined && client.language?.toLowerCase().includes('hebrew'));
        languageToUse = isHebrew ? 'he' : 'en';
        console.log('🌐 Reschedule email - Auto language selection:', {
          language_id: client.language_id,
          language: client.language,
          selectedLanguage: languageToUse
        });
      } else {
        // Use manual language selection for other email types
        languageToUse = selectedEmailLanguage;
      }
      
      // Get email template based on determined language
      const selectedTemplate = languageToUse === 'en' ? emailTemplates.en : emailTemplates.he;
      
      // Build HTML body for email - use template if available, otherwise fallback to default template
      let htmlBody: string;
      if (selectedTemplate) {
        // Use formatEmailBody to preserve line breaks and apply RTL formatting
        // Pass meeting context for template parameter replacement
        htmlBody = await formatEmailBody(selectedTemplate, recipientName, {
          client,
          meeting,
          meetingDate: formattedDate,
          meetingTime: formattedTime,
          meetingLocation: locationName,
          meetingLink: joinLink,
        });
      } else {
        // Fallback to default template if no template found
        const fallbackHtml = meetingInvitationEmailTemplate({
          clientName: recipientName,
          meetingDate: formattedDate,
          meetingTime: undefined,
          location: locationName,
          category: '',
          topic: '', // Topic removed - not to be included in emails
          joinLink,
          senderName: senderName,
        });
        // Apply RTL formatting to fallback template as well
        htmlBody = await formatEmailBody(fallbackHtml, recipientName, {
          client,
          meeting,
          meetingDate: formattedDate,
          meetingTime: formattedTime,
          meetingLocation: locationName,
          meetingLink: joinLink,
        });
      }
      
      // Only create calendar invites for invitations (all invitation types)
      if (currentEmailType === 'invitation' || currentEmailType === 'invitation_jlm' || currentEmailType === 'invitation_tlv' || currentEmailType === 'invitation_tlv_parking') {
        if (useOutlookCalendarInvite) {
          // Use Microsoft Graph API to create a calendar event with attendees
          // This automatically sends a proper Outlook meeting invitation that appears as a calendar box, not an attachment
          // The invitation email is sent automatically by Outlook/Exchange, so we don't need to send a separate email
          try {
            await createCalendarEventWithAttendee(tokenResponse.accessToken, {
              subject: calendarSubject,
              startDateTime: startDateTime.toISOString(),
              endDateTime: endDateTime.toISOString(),
              location: locationName === 'Teams' ? 'Microsoft Teams Meeting' : locationName,
              description: descriptionHtml,
              attendeeEmail: primaryRecipientEmail,
              attendeeName: recipientName,
              organizerEmail: account.username || 'noreply@lawoffice.org.il',
              organizerName: senderName,
              teamsJoinUrl: locationName === 'Teams' ? joinLink : undefined,
              timeZone: 'Asia/Jerusalem'
            });
            
            // The calendar event creation automatically sends a meeting invitation email via Outlook
            // This invitation appears as a proper calendar box in Outlook, not as an attachment
          } catch (calendarError) {
            console.error('Failed to create Outlook calendar event:', calendarError);
            // Fallback to ICS attachment if Outlook calendar creation fails
            throw calendarError; // Will be caught by outer catch
          }
        } else {
          // For non-Microsoft email clients (Gmail, etc.), use ICS attachment
          // Generate ICS calendar file attachment
          let attachments: Array<{ name: string; contentBytes: string; contentType?: string }> | undefined;
          try {
            const icsContent = generateICSFromDateTime({
              subject: calendarSubject,
              date: meeting.date,
              time: formattedTime,
              durationMinutes: 60,
              location: locationName === 'Teams' ? 'Microsoft Teams Meeting' : locationName,
              description: descriptionHtml.replace(/<[^>]+>/g, ''), // Strip HTML for ICS
              organizerEmail: account.username || 'noreply@lawoffice.org.il',
              organizerName: senderName,
              attendeeEmail: primaryRecipientEmail,
              attendeeName: recipientName,
              teamsJoinUrl: locationName === 'Teams' ? joinLink : undefined,
              timeZone: 'Asia/Jerusalem'
            });
            
            const icsBase64 = btoa(unescape(encodeURIComponent(icsContent)));
            
            attachments = [{
              name: 'meeting-invite.ics',
              contentBytes: icsBase64,
              contentType: 'text/calendar; charset=utf-8; method=REQUEST'
            }];
          } catch (icsError) {
            console.error('Failed to generate ICS file:', icsError);
          }
          
          // Send email with ICS attachment
          await sendEmail(tokenResponse.accessToken, { 
            to: recipientEmail, 
            subject, 
            body: htmlBody,
            attachments
          });
        }
      } else {
        // For reminder and cancellation, just send email without calendar invite
        await sendEmail(tokenResponse.accessToken, { 
          to: recipientEmail, 
          subject, 
          body: htmlBody
        });
      }
      const emailTypeMessages: Record<'invitation' | 'invitation_jlm' | 'invitation_tlv' | 'invitation_tlv_parking' | 'reminder' | 'cancellation' | 'rescheduled', string> = {
        invitation: `Meeting invitation sent for meeting on ${meeting.date}`,
        invitation_jlm: `Meeting invitation (JLM) sent for meeting on ${meeting.date}`,
        invitation_tlv: `Meeting invitation (TLV) sent for meeting on ${meeting.date}`,
        invitation_tlv_parking: `Meeting invitation (TLV + Parking) sent for meeting on ${meeting.date}`,
        reminder: `Meeting reminder sent for meeting on ${meeting.date}`,
        cancellation: `Meeting cancellation notice sent for meeting on ${meeting.date}`,
        rescheduled: `Meeting rescheduled notice sent for meeting on ${meeting.date}`
      };
      toast.success(emailTypeMessages[currentEmailType]);
      // --- Optimistic upsert to emails table ---
      // For Outlook calendar invites, the email is sent automatically by Exchange
      // For non-Outlook, we send the email with ICS attachment
      await supabase.from('emails').upsert([
        {
          message_id: `optimistic_${now.getTime()}`,
          client_id: client.id,
          thread_id: null,
          sender_name: senderName,
          sender_email: account.username || account.name || 'Me',
          recipient_list: recipientEmail,
          subject,
          body_preview: htmlBody,
          sent_at: now.toISOString(),
          direction: 'outgoing',
          attachments: null,
        }
      ], { onConflict: 'message_id' });
      // Stage evaluation is handled automatically by database triggers
      
      if (onClientUpdate) await onClientUpdate();
      // Refresh meetings to show updated data
      await fetchMeetings();
    } catch (error) {
      toast.error('Failed to send email.');
      console.error(error);
    } finally {
      setSendingEmailMeetingId(null);
    }
  };

  const handleCreateTeamsMeeting = async (meeting: Meeting) => {
    setCreatingTeamsMeetingId(meeting.id);
    try {
      if (!instance) throw new Error('MSAL instance not available');
      const accounts = instance.getAllAccounts();
      if (!accounts.length) throw new Error('No Microsoft account found');
      
      // Try silent token acquisition first, fall back to popup if needed
      let tokenResponse;
      try {
        tokenResponse = await instance.acquireTokenSilent({ ...loginRequest, account: accounts[0] });
      } catch (error) {
        // If silent acquisition fails (e.g., session expired), try interactive popup
        if (error instanceof InteractionRequiredAuthError) {
          toast('Your session has expired. Please sign in again.', { icon: '🔑' });
          tokenResponse = await instance.acquireTokenPopup({ ...loginRequest, account: accounts[0] });
        } else {
          throw error; // Re-throw other errors
        }
      }
      
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

  // Helper to determine if a meeting is in the past (based on date only, not time)
  const isPastMeeting = (meeting: Meeting) => {
    if (meeting.status === 'canceled') return true;
    const meetingDate = new Date(meeting.date);
    const today = new Date();
    // Set both dates to start of day for comparison
    meetingDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    return meetingDate < today;
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

  // Fetch upcoming meetings for reschedule drawer
  useEffect(() => {
    const fetchRescheduleMeetings = async () => {
      if (!client.id || !showRescheduleDrawer) return;
      
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      
      let query = supabase
        .from('meetings')
        .select('*')
        .neq('status', 'canceled')
        .gte('meeting_date', new Date().toISOString().split('T')[0])
        .order('meeting_date', { ascending: true });
      
      if (isLegacyLead) {
        const legacyId = client.id.toString().replace('legacy_', '');
        query = query.eq('legacy_lead_id', legacyId);
      } else {
        query = query.eq('client_id', client.id);
      }
      
      const { data, error } = await query;
      
      if (!error && data) {
        setRescheduleMeetings(data);
      } else {
        setRescheduleMeetings([]);
      }
    };
    
    fetchRescheduleMeetings();
  }, [client.id, showRescheduleDrawer]);

  const handleToggleMeetingConfirmation = async () => {
    if (!client.id) return;
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
    const currentValue = leadSchedulingInfo.meeting_confirmation ?? false;
    const newValue = !currentValue;
    const { data: { user } } = await supabase.auth.getUser();
    let confirmerEmployeeId: number | null = null;
    let confirmerDisplayName = user?.email || 'Unknown';

    if (user?.id) {
      try {
        const { data: userRow, error: userRowError } = await supabase
          .from('users')
          .select('employee_id, full_name')
          .eq('auth_id', user.id)
          .single();

        if (!userRowError) {
          if (userRow?.employee_id !== null && userRow?.employee_id !== undefined) {
            const parsedEmployeeId = Number(userRow.employee_id);
            if (Number.isFinite(parsedEmployeeId)) {
              confirmerEmployeeId = parsedEmployeeId;
              const matchedEmployee = allEmployees.find(emp => emp.id.toString() === parsedEmployeeId.toString());
              confirmerDisplayName = matchedEmployee?.display_name || userRow.full_name || confirmerDisplayName;
            } else {
              confirmerDisplayName = userRow?.full_name || confirmerDisplayName;
            }
          } else {
            confirmerDisplayName = userRow?.full_name || confirmerDisplayName;
          }
        }
      } catch (lookupError) {
        console.warn('Unable to resolve employee_id for meeting confirmation toggle:', lookupError);
      }
    }

    const updatePayload = {
      meeting_confirmation: newValue,
      meeting_confirmation_by: newValue ? confirmerEmployeeId : null,
    };
    const fallbackPayload = {
      meeting_confirmation: newValue ? new Date().toISOString() : null,
      meeting_confirmation_by: newValue ? confirmerEmployeeId : null,
    };
    const applyUpdate = async (table: 'leads' | 'leads_lead', filterKey: string, filterValue: any) => {
      const { error } = await supabase
        .from(table)
        .update(updatePayload)
        .eq(filterKey, filterValue);
      if (error) {
        if (error.code === '22007') {
          const { error: fallbackError } = await supabase
            .from(table)
            .update(fallbackPayload)
            .eq(filterKey, filterValue);
          if (fallbackError) {
            throw fallbackError;
          }
        } else {
          throw error;
        }
      }
    };
    try {
      if (isLegacyLead) {
        const legacyId = client.id.toString().replace('legacy_', '');
        await applyUpdate('leads_lead', 'id', legacyId);
      } else {
        await applyUpdate('leads', 'id', client.id);
      }
      setLeadSchedulingInfo(prev => ({
        ...prev,
        meeting_confirmation: newValue,
        meeting_confirmation_by: newValue ? confirmerEmployeeId : null,
      }));
      toast.success(
        newValue
          ? `Meeting marked as confirmed${confirmerDisplayName ? ` by ${confirmerDisplayName}` : ''}`
          : 'Meeting confirmation removed'
      );
    } catch (error) {
      console.error('Error updating meeting confirmation:', error);
      toast.error('Failed to update meeting confirmation');
    }
  };

  // Create calendar event function (same as Clients.tsx)
  const createCalendarEvent = async (accessToken: string, meetingDetails: {
    subject: string;
    startDateTime: string;
    endDateTime: string;
    location: string;
    calendar?: string;
    manager?: string;
    helper?: string;
    brief?: string;
    attendance_probability?: string;
    complexity?: string;
    car_number?: string;
    expert?: string;
    amount?: number;
    currency?: string;
  }) => {
    const calendarEmail = meetingDetails.calendar === 'active_client' 
      ? 'shared-newclients@lawoffice.org.il' 
      : 'shared-potentialclients@lawoffice.org.il';
    
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(calendarEmail)}/calendar/events`;
    
    const description = [
      'Meeting Details:',
      `Manager: ${meetingDetails.manager || 'Not specified'}`,
      `Helper: ${meetingDetails.helper || 'Not specified'}`,
      `Expert: ${meetingDetails.expert || 'Not specified'}`,
      `Amount: ${meetingDetails.currency || '₪'}${meetingDetails.amount || 0}`,
      `Attendance Probability: ${meetingDetails.attendance_probability || 'Not specified'}`,
      `Complexity: ${meetingDetails.complexity || 'Not specified'}`,
      meetingDetails.car_number ? `Car Number: ${meetingDetails.car_number}` : '',
      meetingDetails.brief ? `Brief: ${meetingDetails.brief}` : '',
      '',
      'Generated by RMQ 2.0 System'
    ].filter(line => line !== '').join('\n');

    const body: any = {
      subject: meetingDetails.subject,
      start: {
        dateTime: meetingDetails.startDateTime,
        timeZone: 'UTC'
      },
      end: {
        dateTime: meetingDetails.endDateTime,
        timeZone: 'UTC'
      },
      location: {
        displayName: meetingDetails.location
      },
      body: {
        contentType: 'text',
        content: description
      },
    };

    if (meetingDetails.location === 'Teams') {
      body.isOnlineMeeting = true;
      body.onlineMeetingProvider = 'teamsForBusiness';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.json();
      let errorMessage = 'Failed to create calendar event';
      if (response.status === 403) {
        errorMessage = `Access denied to calendar ${calendarEmail}. Please check permissions.`;
      } else if (response.status === 404) {
        errorMessage = `Calendar ${calendarEmail} not found. Please verify the calendar exists.`;
      } else if (response.status === 400) {
        errorMessage = `Invalid request to calendar ${calendarEmail}. ${error.error?.message || ''}`;
      } else {
        errorMessage = error.error?.message || `HTTP ${response.status}: ${response.statusText}`;
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    const joinUrl = data.onlineMeeting?.joinUrl || data.webLink;
    
    return {
      joinUrl: joinUrl,
      id: data.id,
      onlineMeeting: data.onlineMeeting
    };
  };

  // Test calendar access permissions
  const testCalendarAccess = async (accessToken: string, calendarEmail: string) => {
    try {
      const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(calendarEmail)}/calendar`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      return response.ok;
    } catch (error) {
      console.error(`Calendar access test failed for ${calendarEmail}:`, error);
      return false;
    }
  };

  // Handle schedule meeting from drawer (same logic as Clients.tsx)
  const handleScheduleMeetingFromDrawer = async () => {
    if (!client) return;
    if (!instance || typeof instance.getAllAccounts !== 'function' || typeof instance.acquireTokenSilent !== 'function') {
      toast.error('Microsoft login is not available. Please try again later.');
      return;
    }
    setIsSchedulingMeeting(true);
    try {
      const account = instance.getAllAccounts()[0];
      if (!account) {
        toast.error("You must be signed in to schedule a Teams meeting.");
        setIsSchedulingMeeting(false);
        return;
      }

      // Get current user's full_name from database
      let currentUserFullName = '';
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
        console.log('Could not fetch user full_name');
      }

      let teamsMeetingUrl = '';
      const selectedLocation = allMeetingLocations.find(
        loc => loc.name === scheduleMeetingFormData.location
      );

      // If this is a Teams meeting, create an online event via Graph
      if (scheduleMeetingFormData.location === 'Teams') {
        let accessToken;
        try {
          const response = await instance.acquireTokenSilent({
            ...loginRequest,
            account,
          });
          accessToken = response.accessToken;
        } catch (error) {
          if (error instanceof InteractionRequiredAuthError) {
            const response = await instance.loginPopup(loginRequest);
            accessToken = response.accessToken;
          } else {
            throw error;
          }
        }

        const [year, month, day] = scheduleMeetingFormData.date.split('-').map(Number);
        const [hours, minutes] = scheduleMeetingFormData.time.split(':').map(Number);
        const start = new Date(year, month - 1, day, hours, minutes);
        const end = new Date(start.getTime() + 30 * 60000); // 30 min meeting

        const calendarEmail = scheduleMeetingFormData.calendar === 'active_client' 
          ? 'shared-newclients@lawoffice.org.il' 
          : 'shared-potentialclients@lawoffice.org.il';
        
        try {
          const hasAccess = await testCalendarAccess(accessToken, calendarEmail);
          if (!hasAccess) {
            // Show warning but continue - calendar creation will be attempted and will fail gracefully
            toast.error(`Cannot access calendar ${calendarEmail}. Meeting will still be created without calendar sync.`);
          }
        } catch (accessError) {
          // If access check fails, show warning but continue
          console.warn('⚠️ Calendar access check failed:', accessError);
          toast.error(`Calendar access check failed. Meeting will still be created without calendar sync.`);
        }

        const categoryName = client.category || 'No Category';
        const meetingSubject = `[#${client.lead_number || client.id}] ${client.name} - ${categoryName} - ${scheduleMeetingFormData.brief || 'Meeting'}`;
        
        try {
          const calendarEventData = await createCalendarEvent(accessToken, {
            subject: meetingSubject,
            startDateTime: start.toISOString(),
            endDateTime: end.toISOString(),
            location: scheduleMeetingFormData.location,
            calendar: scheduleMeetingFormData.calendar,
            manager: scheduleMeetingFormData.manager,
            helper: scheduleMeetingFormData.helper,
            brief: scheduleMeetingFormData.brief,
            attendance_probability: scheduleMeetingFormData.attendance_probability,
            complexity: scheduleMeetingFormData.complexity,
            car_number: scheduleMeetingFormData.car_number,
            expert: client.expert || '---',
            amount: 0,
            currency: '₪',
          });
          teamsMeetingUrl = calendarEventData.joinUrl;
        } catch (calendarError) {
          console.error('Calendar creation failed:', calendarError);
          const errorMessage = calendarError instanceof Error ? calendarError.message : String(calendarError);
          // Show warning but continue with meeting creation
          toast.error(`Calendar sync failed: ${errorMessage}. Meeting will still be created.`);
          // Continue without calendar event - meeting will be created without Teams URL
          teamsMeetingUrl = '';
        }
      } else if (selectedLocation?.default_link) {
        teamsMeetingUrl = selectedLocation.default_link;
      }

      // Check if this is a legacy lead
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      const legacyId = isLegacyLead ? client.id.toString().replace('legacy_', '') : null;

      const meetingData = {
        client_id: isLegacyLead ? null : client.id,
        legacy_lead_id: isLegacyLead ? legacyId : null,
        meeting_date: scheduleMeetingFormData.date,
        meeting_time: scheduleMeetingFormData.time,
        meeting_location: scheduleMeetingFormData.location,
        meeting_manager: scheduleMeetingFormData.manager || '',
        meeting_currency: '₪',
        meeting_amount: 0,
        expert: client.expert || '---',
        helper: scheduleMeetingFormData.helper || '---',
        teams_meeting_url: teamsMeetingUrl,
        meeting_brief: scheduleMeetingFormData.brief || '',
        attendance_probability: scheduleMeetingFormData.attendance_probability,
        complexity: scheduleMeetingFormData.complexity,
        car_number: scheduleMeetingFormData.car_number || '',
        scheduler: currentUserFullName,
        last_edited_timestamp: new Date().toISOString(),
        last_edited_by: currentUserFullName,
        calendar_type: scheduleMeetingFormData.calendar === 'active_client' ? 'active_client' : 'potential_client',
      };

      const { data: insertedData, error: meetingError } = await supabase
        .from('meetings')
        .insert([meetingData])
        .select();

      if (meetingError) {
        console.error('Meeting creation error:', meetingError);
        throw meetingError;
      }

      // Helper function to get employee ID from display name
      const getEmployeeIdFromDisplayName = (displayName: string | null | undefined): number | null => {
        if (!displayName || displayName === '---' || displayName.trim() === '') return null;
        
        // Try exact match first
        let employee = allEmployees.find((emp: any) => 
          emp.display_name && emp.display_name.trim() === displayName.trim()
        );
        
        // If not found, try case-insensitive match
        if (!employee) {
          employee = allEmployees.find((emp: any) => 
            emp.display_name && emp.display_name.trim().toLowerCase() === displayName.trim().toLowerCase()
          );
        }
        
        if (!employee) {
          console.warn(`Employee not found for display name: "${displayName}"`);
          return null;
        }
        
        // Ensure ID is a number
        return typeof employee.id === 'number' ? employee.id : parseInt(employee.id, 10);
      };

      // Resolve manager and helper employee IDs
      const managerEmployeeId = getEmployeeIdFromDisplayName(scheduleMeetingFormData.manager);
      const helperEmployeeId = getEmployeeIdFromDisplayName(scheduleMeetingFormData.helper);
      
      // Resolve scheduler employee ID
      const schedulerEmployeeId = getEmployeeIdFromDisplayName(currentUserFullName);
      
      // Resolve expert employee ID
      const expertEmployeeId = getEmployeeIdFromDisplayName(client.expert);

      // Update client/lead record with roles (but NOT stage - as per user requirement)
      if (isLegacyLead) {
        const updatePayload: any = {};

        // Update scheduler for legacy leads (must be numeric employee ID, not display name)
        if (schedulerEmployeeId !== null) {
          updatePayload.meeting_scheduler_id = schedulerEmployeeId;
        }

        // Update manager and helper for legacy leads
        if (managerEmployeeId !== null) {
          updatePayload.meeting_manager_id = managerEmployeeId;
        }
        if (helperEmployeeId !== null) {
          updatePayload.meeting_lawyer_id = helperEmployeeId;
        }
        
        // Update expert for legacy leads (must be numeric employee ID, not display name)
        if (expertEmployeeId !== null) {
          updatePayload.expert_id = expertEmployeeId;
        }

        // Only update if there are changes to make
        if (Object.keys(updatePayload).length > 0) {
          const { error: updateError } = await supabase
            .from('leads_lead')
            .update(updatePayload)
            .eq('id', legacyId);

          if (updateError) {
            console.error('Error updating legacy lead roles:', updateError);
            // Don't throw - meeting was created successfully, this is just a bonus update
          }
        }
      } else {
        const updatePayload: any = {};

        // Update scheduler for new leads
        if (schedulerEmployeeId !== null) {
          updatePayload.scheduler = currentUserFullName; // New leads use display name
        }

        // Update manager and helper for new leads (as employee IDs)
        if (managerEmployeeId !== null) {
          updatePayload.manager = managerEmployeeId;
        }
        if (helperEmployeeId !== null) {
          updatePayload.helper = helperEmployeeId;
        }

        // Note: Expert is not updated for new leads in Clients.tsx, so we follow the same pattern

        // Only update if there are changes to make
        if (Object.keys(updatePayload).length > 0) {
          const { error: updateError } = await supabase
            .from('leads')
            .update(updatePayload)
            .eq('id', client.id);

          if (updateError) {
            console.error('Error updating new lead roles:', updateError);
            // Don't throw - meeting was created successfully, this is just a bonus update
          }
        }
      }

      // Automatically send the appropriate meeting invitation email
      console.log('📧 Checking if we can send automatic invitation:', {
        hasInsertedData: !!insertedData,
        insertedDataLength: insertedData?.length,
        hasClient: !!client,
        clientEmail: client?.email,
        clientName: client?.name,
        meetingData: insertedData?.[0]
      });
      
      if (insertedData && insertedData.length > 0 && client.email) {
        const newMeeting: Meeting = {
          id: insertedData[0].id,
          client_id: insertedData[0].client_id,
          date: insertedData[0].meeting_date,
          time: insertedData[0].meeting_time,
          location: insertedData[0].meeting_location,
          manager: insertedData[0].meeting_manager,
          currency: insertedData[0].meeting_currency,
          amount: insertedData[0].meeting_amount,
          brief: insertedData[0].meeting_brief,
          scheduler: insertedData[0].scheduler || currentUserFullName,
          helper: insertedData[0].helper,
          expert: insertedData[0].expert,
          link: insertedData[0].teams_meeting_url || '',
          lastEdited: {
            timestamp: insertedData[0].last_edited_timestamp,
            user: insertedData[0].last_edited_by,
          },
        };

        // Determine the appropriate invitation type based on meeting location
        const location = (scheduleMeetingFormData.location || '').toLowerCase();
        let invitationType: 'invitation' | 'invitation_jlm' | 'invitation_tlv' | 'invitation_tlv_parking' = 'invitation';
        
        if (location.includes('jrslm') || location.includes('jerusalem')) {
          invitationType = 'invitation_jlm';
        } else if (location.includes('tlv') && location.includes('parking')) {
          invitationType = 'invitation_tlv_parking';
        } else if (location.includes('tlv') || location.includes('tel aviv')) {
          invitationType = 'invitation_tlv';
        }

        console.log('🎯 Auto-sending meeting invitation:', {
          location: scheduleMeetingFormData.location,
          invitationType,
          clientEmail: client.email,
          meetingDate: newMeeting.date
        });
        
        // Send the invitation email with calendar invite (ICS/Outlook)
        // Pass invitationType directly as the 4th parameter
        try {
          await handleSendEmail(newMeeting, client.email, client.name, invitationType);
          console.log('✅ Meeting invitation sent successfully');
        } catch (emailError) {
          console.error('❌ Error sending meeting invitation:', emailError);
          toast.warning('Meeting scheduled, but failed to send invitation email.');
        }
      } else {
        console.log('⚠️ Meeting created but email not sent:', {
          hasInsertedData: !!insertedData,
          dataLength: insertedData?.length,
          hasClientEmail: !!client?.email
        });
      }

      // Update UI
      setShowScheduleDrawer(false);
      setIsSchedulingMeeting(false);
      
      // Reset form
      setScheduleMeetingFormData({
        date: '',
        time: '09:00',
        location: 'Teams',
        manager: '',
        helper: '',
        brief: '',
        attendance_probability: 'Medium',
        complexity: 'Simple',
        car_number: '',
        calendar: 'active_client',
      });
      
      if (onClientUpdate) await onClientUpdate();
      await fetchMeetings();
    } catch (error) {
      console.error('Error scheduling meeting:', error);
      toast.error('Failed to schedule meeting. Please try again.');
      setIsSchedulingMeeting(false);
    }
  };

  // Handle cancel meeting
  const handleCancelMeeting = async () => {
    if (!client || !meetingToDelete) return;
    setIsReschedulingMeeting(true);
    try {
      const account = instance.getAllAccounts()[0];
      
      // Cancel the meeting
      const { data: { user } } = await supabase.auth.getUser();
      const editor = user?.email || account?.name || 'system';
      const { error: cancelError } = await supabase
        .from('meetings')
        .update({ 
          status: 'canceled', 
          last_edited_timestamp: new Date().toISOString(), 
          last_edited_by: editor 
        })
        .eq('id', meetingToDelete);
      
      if (cancelError) throw cancelError;

      // Get meeting details for email
      const { data: canceledMeeting, error: fetchError } = await supabase
        .from('meetings')
        .select('*')
        .eq('id', meetingToDelete)
        .single();
      
      if (fetchError) throw fetchError;

      // Send cancellation email to client
      if (client.email && canceledMeeting) {
        let accessToken;
        try {
          const response = await instance.acquireTokenSilent({ ...loginRequest, account });
          accessToken = response.accessToken;
        } catch (error) {
          if (error instanceof InteractionRequiredAuthError) {
            const response = await instance.loginPopup(loginRequest);
            accessToken = response.accessToken;
          } else {
            throw error;
          }
        }
        
        // Get language_id from client - for legacy leads, it's directly in the client object
        // For new leads, we might need to fetch it from the database
        const isLegacyLeadForCancel = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
        let clientLanguageId: number | null = null;
        
        if (isLegacyLeadForCancel) {
          // For legacy leads, language_id should be directly on the client
          // It might be in client.language_id or we need to fetch it
          if ((client as any).language_id) {
            clientLanguageId = (client as any).language_id;
          } else {
            // Fetch it from the database
            const legacyId = client.id.toString().replace('legacy_', '');
            const { data: legacyData } = await supabase
              .from('leads_lead')
              .select('language_id')
              .eq('id', legacyId)
              .single();
            clientLanguageId = legacyData?.language_id || null;
          }
        } else {
          // For new leads, check if language_id is on the client, otherwise fetch it
          if ((client as any).language_id) {
            clientLanguageId = (client as any).language_id;
          } else {
            const { data: leadData } = await supabase
              .from('leads')
              .select('language_id')
              .eq('id', client.id)
              .single();
            clientLanguageId = leadData?.language_id || null;
          }
        }
        
        // Fetch email template by name ('cancellation') and language_id
        let templateContent: string | null = null;
        try {
          console.log('📧 Fetching cancellation email template:', { clientLanguageId, isLegacyLeadForCancel });
          
          if (!clientLanguageId) {
            console.warn('⚠️ No language_id found for client, cannot fetch template');
          } else {
            const { data: template, error: templateError } = await supabase
              .from('misc_emailtemplate')
              .select('content')
              .eq('name', 'cancellation')
              .eq('language_id', clientLanguageId)
              .single();
          
            if (templateError) {
              console.error('❌ Error fetching cancellation email template:', templateError);
            } else if (template && template.content) {
              // Try parsing, but if it returns empty, use raw content (might be HTML)
              const parsed = parseTemplateContent(template.content);
              templateContent = parsed && parsed.trim() ? parsed : template.content;
              console.log('✅ Cancellation email template fetched successfully', {
                languageId: clientLanguageId,
                rawLength: template.content.length,
                parsedLength: parsed?.length || 0,
                finalLength: templateContent?.length || 0,
                usingRaw: !parsed || !parsed.trim()
              });
            }
          }
        } catch (error) {
          console.error('❌ Exception fetching cancellation email template:', error);
        }
        
        // Format meeting date and time
        const formatDate = (dateStr: string): string => {
          const [year, month, day] = dateStr.split('-');
          return `${day}/${month}/${year}`;
        };
        const formattedDate = formatDate(canceledMeeting.meeting_date);
        const formattedTime = canceledMeeting.meeting_time ? canceledMeeting.meeting_time.substring(0, 5) : '';
        const locationName = getMeetingLocationName(canceledMeeting.meeting_location || canceledMeeting.meeting_location_old);
        
        // Build email body using template or fallback
        let emailBody: string;
        if (templateContent && templateContent.trim()) {
          console.log('✅ Using cancellation email template');
          // Use template with parameter replacement
          emailBody = await formatEmailBody(templateContent, client.name, {
            client,
            meeting: canceledMeeting as any,
            meetingDate: formattedDate,
            meetingTime: formattedTime,
            meetingLocation: locationName,
          });
        } else {
          console.warn('⚠️ Using fallback hardcoded email template for cancellation');
          // Fallback to hardcoded email
          const userName = account?.name || 'Staff';
          let signature = (account && (account as any).signature) ? (account as any).signature : null;
          if (!signature) {
            signature = `<br><br>${userName},<br>Decker Pex Levi Law Offices`;
          }
          emailBody = `
            <div style='font-family:sans-serif;font-size:16px;color:#222;'>
              <p>Dear ${client.name},</p>
              <p>We regret to inform you that your meeting scheduled for:</p>
              <ul style='margin:16px 0 24px 0;padding-left:20px;'>
                <li><strong>Date:</strong> ${formattedDate}</li>
                <li><strong>Time:</strong> ${formattedTime}</li>
                <li><strong>Location:</strong> ${locationName}</li>
              </ul>
              <p>has been canceled.</p>
              <p>If you have any questions or would like to reschedule, please let us know.</p>
              <div style='margin-top:32px;'>${signature}</div>
            </div>
          `;
        }
        
        const subject = `[${client.lead_number || client.id}] - ${client.name} - Meeting Canceled`;
        await sendEmail(accessToken, {
          to: client.email,
          subject,
          body: emailBody,
        });
      }

      toast.success('Meeting canceled and client notified.');
      setShowRescheduleDrawer(false);
      setMeetingToDelete(null);
      setRescheduleFormData({
        date: '',
        time: '09:00',
        location: 'Teams',
        calendar: 'active_client',
        manager: '',
        helper: '',
        brief: '',
        attendance_probability: 'Medium',
        complexity: 'Simple',
        car_number: '',
      });
      setRescheduleOption('cancel');
      if (onClientUpdate) await onClientUpdate();
      await fetchMeetings();
    } catch (error) {
      toast.error('Failed to cancel meeting.');
      console.error(error);
    } finally {
      setIsReschedulingMeeting(false);
    }
  };

  // Handle reschedule meeting
  const handleRescheduleMeeting = async () => {
    if (!client || !rescheduleFormData.date || !rescheduleFormData.time) return;
    setIsReschedulingMeeting(true);
    try {
      const account = instance.getAllAccounts()[0];
      
      // IMPORTANT: Always automatically cancel the oldest upcoming meeting when rescheduling
      // Find and cancel the oldest upcoming meeting automatically (user doesn't need to select)
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      const legacyId = isLegacyLead ? client.id.toString().replace('legacy_', '') : null;
      
      // Query for the oldest upcoming meeting to cancel
      let query = supabase
        .from('meetings')
        .select('id, meeting_date, meeting_time, meeting_location, meeting_location_old')
        .neq('status', 'canceled')
        .gte('meeting_date', new Date().toISOString().split('T')[0])
        .order('meeting_date', { ascending: true })
        .order('meeting_time', { ascending: true })
        .limit(1);
      
      if (isLegacyLead) {
        query = query.eq('legacy_lead_id', legacyId);
      } else {
        query = query.eq('client_id', client.id);
      }
      
      const { data: upcomingMeetingsToCancel, error: queryError } = await query;
      
      let canceledMeeting = null;
      let meetingIdToCancel: number | null = null;
      
      if (queryError) {
        console.error('❌ Error querying for meetings to cancel:', queryError);
      } else if (upcomingMeetingsToCancel && upcomingMeetingsToCancel.length > 0) {
        meetingIdToCancel = upcomingMeetingsToCancel[0].id;
        console.log('🔄 Automatically canceling oldest upcoming meeting before rescheduling:', meetingIdToCancel);
        
        const { data: { user } } = await supabase.auth.getUser();
        const editor = user?.email || account?.name || 'system';
        const { error: cancelError } = await supabase
          .from('meetings')
          .update({ 
            status: 'canceled', 
            last_edited_timestamp: new Date().toISOString(), 
            last_edited_by: editor 
          })
          .eq('id', meetingIdToCancel);
        
        if (cancelError) {
          console.error('❌ Failed to cancel old meeting:', cancelError);
          throw new Error(`Failed to cancel old meeting: ${cancelError.message}`);
        }

        const { data: canceledMeetingData } = await supabase
          .from('meetings')
          .select('*')
          .eq('id', meetingIdToCancel)
          .single();
        
        canceledMeeting = canceledMeetingData;
        console.log('✅ Old meeting canceled successfully:', meetingIdToCancel);
      } else {
        console.log('ℹ️ No upcoming meetings found to cancel (this is a new meeting, not a reschedule)');
      }

      // Get current user's full_name from database
      let currentUserFullName = '';
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
        console.log('Could not fetch user full_name');
      }

      // Create the new meeting
      let teamsMeetingUrl = '';
      const selectedLocation = allMeetingLocations.find(
        loc => loc.name === rescheduleFormData.location
      );

      // If this is a Teams meeting, create an online event via Graph
      if (rescheduleFormData.location === 'Teams') {
        let accessToken;
        try {
          const response = await instance.acquireTokenSilent({ ...loginRequest, account });
          accessToken = response.accessToken;
        } catch (error) {
          if (error instanceof InteractionRequiredAuthError) {
            const response = await instance.loginPopup(loginRequest);
            accessToken = response.accessToken;
          } else {
            throw error;
          }
        }

        const [year, month, day] = rescheduleFormData.date.split('-').map(Number);
        const [hours, minutes] = rescheduleFormData.time.split(':').map(Number);
        const start = new Date(year, month - 1, day, hours, minutes);
        const end = new Date(start.getTime() + 30 * 60000); // 30 min meeting

        const calendarEmail = 'shared-newclients@lawoffice.org.il'; // Always use active client calendar
        
        const hasAccess = await testCalendarAccess(accessToken, calendarEmail);
        
        if (!hasAccess) {
          toast.error(`Cannot access calendar ${calendarEmail}. Please check permissions or contact your administrator.`);
          setIsReschedulingMeeting(false);
          return;
        }

        const categoryName = client.category || 'No Category';
        const meetingSubject = `[#${client.lead_number || client.id}] ${client.name} - ${categoryName} - Meeting`;
        
        try {
          const calendarEventData = await createCalendarEvent(accessToken, {
            subject: meetingSubject,
            startDateTime: start.toISOString(),
            endDateTime: end.toISOString(),
            location: rescheduleFormData.location,
            calendar: rescheduleFormData.calendar,
            manager: rescheduleFormData.manager,
            helper: rescheduleFormData.helper,
            brief: rescheduleFormData.brief,
            attendance_probability: rescheduleFormData.attendance_probability,
            complexity: rescheduleFormData.complexity,
            car_number: rescheduleFormData.car_number,
            expert: client.expert || '---',
            amount: 0,
            currency: '₪',
          });
          teamsMeetingUrl = calendarEventData.joinUrl;
        } catch (calendarError) {
          console.error('Calendar creation failed:', calendarError);
          const errorMessage = calendarError instanceof Error ? calendarError.message : String(calendarError);
          // Show warning but continue with meeting creation
          toast.error(`Calendar sync failed: ${errorMessage}. Meeting will still be created.`);
          // Continue without calendar event - meeting will be created without Teams URL
          teamsMeetingUrl = '';
        }
      } else if (selectedLocation?.default_link) {
        teamsMeetingUrl = selectedLocation.default_link;
      }

      // Use the isLegacyLead and legacyId already declared at the start of the function (line 2605-2606)
      const meetingData = {
        client_id: isLegacyLead ? null : client.id,
        legacy_lead_id: isLegacyLead ? legacyId : null,
        meeting_date: rescheduleFormData.date,
        meeting_time: rescheduleFormData.time,
        meeting_location: rescheduleFormData.location,
        meeting_manager: rescheduleFormData.manager || '',
        meeting_currency: '₪',
        meeting_amount: 0,
        expert: client.expert || '---',
        helper: rescheduleFormData.helper || '---',
        teams_meeting_url: teamsMeetingUrl,
        meeting_brief: rescheduleFormData.brief || '',
        attendance_probability: rescheduleFormData.attendance_probability,
        complexity: rescheduleFormData.complexity,
        car_number: rescheduleFormData.car_number || '',
        scheduler: currentUserFullName,
        last_edited_timestamp: new Date().toISOString(),
        last_edited_by: currentUserFullName,
        calendar_type: 'active_client', // Always active_client for MeetingTab
      };

      const { data: insertedData, error: meetingError } = await supabase
        .from('meetings')
        .insert([meetingData])
        .select();

      if (meetingError) {
        console.error('Meeting creation error:', meetingError);
        throw meetingError;
      }

      // Send notification email to client
      if (client.email) {
        let accessToken;
        try {
          const response = await instance.acquireTokenSilent({ ...loginRequest, account });
          accessToken = response.accessToken;
        } catch (error) {
          if (error instanceof InteractionRequiredAuthError) {
            const response = await instance.loginPopup(loginRequest);
            accessToken = response.accessToken;
          } else {
            throw error;
          }
        }
        
        const userName = account?.name || 'Staff';
        let signature = (account && (account as any).signature) ? (account as any).signature : null;
        if (!signature) {
          signature = `<br><br>${userName},<br>Decker Pex Levi Law Offices`;
        }
        
        const meetingLink = getValidTeamsLink(teamsMeetingUrl);
        const joinButton = meetingLink
          ? `<div style='margin:24px 0;'>
              <a href='${meetingLink}' target='_blank' style='background:#3b28c7;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;display:inline-block;'>Join Meeting</a>
            </div>`
          : '';
        
        // Get language_id from client - for legacy leads, it's directly in the client object
        // For new leads, we might need to fetch it from the database
        let clientLanguageId: number | null = null;
        
        if (isLegacyLead) {
          // For legacy leads, language_id should be directly on the client
          // It might be in client.language_id or we need to fetch it
          if ((client as any).language_id) {
            clientLanguageId = (client as any).language_id;
          } else {
            // Fetch it from the database
            const legacyIdForReschedule = client.id.toString().replace('legacy_', '');
            const { data: legacyData } = await supabase
              .from('leads_lead')
              .select('language_id')
              .eq('id', legacyIdForReschedule)
              .single();
            clientLanguageId = legacyData?.language_id || null;
          }
        } else {
          // For new leads, check if language_id is on the client, otherwise fetch it
          if ((client as any).language_id) {
            clientLanguageId = (client as any).language_id;
          } else {
            const { data: leadData } = await supabase
              .from('leads')
              .select('language_id')
              .eq('id', client.id)
              .single();
            clientLanguageId = leadData?.language_id || null;
          }
        }
        
        // Fetch email template by name ('rescheduled') and language_id
        let templateContent: string | null = null;
        try {
          console.log('📧 Fetching rescheduled email template:', { clientLanguageId, isLegacyLead });
          
          if (!clientLanguageId) {
            console.warn('⚠️ No language_id found for client, cannot fetch template');
          } else {
            const { data: template, error: templateError } = await supabase
              .from('misc_emailtemplate')
              .select('content')
              .eq('name', 'rescheduled')
              .eq('language_id', clientLanguageId)
              .single();
            
            if (templateError) {
              console.error('❌ Error fetching rescheduled email template:', templateError);
            } else if (template && template.content) {
              // Try parsing, but if it returns empty, use raw content (might be HTML)
              const parsed = parseTemplateContent(template.content);
              templateContent = parsed && parsed.trim() ? parsed : template.content;
              console.log('✅ Rescheduled email template fetched successfully', {
                languageId: clientLanguageId,
                rawLength: template.content.length,
                parsedLength: parsed?.length || 0,
                finalLength: templateContent?.length || 0,
                usingRaw: !parsed || !parsed.trim()
              });
            }
          }
        } catch (error) {
          console.error('❌ Exception fetching rescheduled email template:', error);
        }
        
        // Format dates and times
        const formatDate = (dateStr: string): string => {
          const [year, month, day] = dateStr.split('-');
          return `${day}/${month}/${year}`;
        };
        const formattedNewDate = formatDate(rescheduleFormData.date);
        const formattedNewTime = rescheduleFormData.time.substring(0, 5);
        const newLocationName = getMeetingLocationName(rescheduleFormData.location);
        
        let formattedOldDate = '';
        let formattedOldTime = '';
        let oldLocationName = '';
        if (canceledMeeting) {
          formattedOldDate = formatDate(canceledMeeting.meeting_date);
          formattedOldTime = canceledMeeting.meeting_time ? canceledMeeting.meeting_time.substring(0, 5) : '';
          oldLocationName = getMeetingLocationName(canceledMeeting.meeting_location || canceledMeeting.meeting_location_old);
        }
        
        // Build email body using template or fallback
        let emailBody: string;
        if (templateContent && templateContent.trim()) {
          console.log('✅ Using rescheduled email template');
          // Use template with parameter replacement
          // For rescheduled, we pass both old and new meeting details
          emailBody = await formatEmailBody(templateContent, client.name, {
            client,
            meetingDate: formattedNewDate,
            meetingTime: formattedNewTime,
            meetingLocation: newLocationName,
            meetingLink: meetingLink || undefined,
          });
        } else {
          console.warn('⚠️ Using fallback hardcoded email template for rescheduled meeting');
          // Fallback to hardcoded email
          const userName = account?.name || 'Staff';
          let signature = (account && (account as any).signature) ? (account as any).signature : null;
          if (!signature) {
            signature = `<br><br>${userName},<br>Decker Pex Levi Law Offices`;
          }
          
          if (canceledMeeting) {
            emailBody = `
              <div style='font-family:sans-serif;font-size:16px;color:#222;'>
                <p>Dear ${client.name},</p>
                <p>We regret to inform you that your previous meeting scheduled for:</p>
                <ul style='margin:16px 0 16px 0;padding-left:20px;'>
                  <li><strong>Date:</strong> ${formattedOldDate}</li>
                  <li><strong>Time:</strong> ${formattedOldTime}</li>
                  <li><strong>Location:</strong> ${oldLocationName}</li>
                </ul>
                <p>has been canceled. Please find below the details for your new meeting:</p>
                <ul style='margin:16px 0 24px 0;padding-left:20px;'>
                  <li><strong>Date:</strong> ${formattedNewDate}</li>
                  <li><strong>Time:</strong> ${formattedNewTime}</li>
                  <li><strong>Location:</strong> ${newLocationName}</li>
                </ul>
                ${joinButton}
                <p>Please check the calendar invitation attached for the exact meeting time.</p>
                <p>If you have any questions or need to reschedule again, please let us know.</p>
                <div style='margin-top:32px;'>${signature}</div>
              </div>
            `;
          } else {
            emailBody = `
              <div style='font-family:sans-serif;font-size:16px;color:#222;'>
                <p>Dear ${client.name},</p>
                <p>We have scheduled a new meeting for you. Please find the details below:</p>
                <ul style='margin:16px 0 24px 0;padding-left:20px;'>
                  <li><strong>Date:</strong> ${formattedNewDate}</li>
                  <li><strong>Time:</strong> ${formattedNewTime}</li>
                  <li><strong>Location:</strong> ${newLocationName}</li>
                </ul>
                ${joinButton}
                <p>Please check the calendar invitation attached for the exact meeting time.</p>
                <p>If you have any questions or need to reschedule, please let us know.</p>
                <div style='margin-top:32px;'>${signature}</div>
              </div>
            `;
          }
        }
        
        const emailSubject = canceledMeeting 
          ? `[${client.lead_number || client.id}] - ${client.name} - Meeting Rescheduled`
          : `[${client.lead_number || client.id}] - ${client.name} - New Meeting Scheduled`;
        
        const [year, month, day] = rescheduleFormData.date.split('-').map(Number);
        const [hours, minutes] = rescheduleFormData.time.split(':').map(Number);
        const startDateTime = new Date(year, month - 1, day, hours, minutes);
        const endDateTime = new Date(startDateTime.getTime() + 30 * 60000);
        
        const categoryName = client.category || 'No Category';
        const meetingSubject = canceledMeeting 
          ? `[#${client.lead_number || client.id}] ${client.name} - ${categoryName} - Meeting Rescheduled`
          : `[#${client.lead_number || client.id}] ${client.name} - ${categoryName} - Meeting`;
        
        try {
          await createCalendarEventWithAttendee(accessToken, {
            subject: meetingSubject,
            startDateTime: startDateTime.toISOString(),
            endDateTime: endDateTime.toISOString(),
            location: rescheduleFormData.location === 'Teams' ? 'Microsoft Teams Meeting' : rescheduleFormData.location,
            description: emailBody,
            attendeeEmail: client.email,
            attendeeName: client.name,
            organizerEmail: account.username || 'noreply@lawoffice.org.il',
            organizerName: userName,
            teamsJoinUrl: meetingLink || undefined,
            timeZone: 'Asia/Jerusalem'
          });
          
          await sendEmail(accessToken, {
            to: client.email,
            subject: emailSubject,
            body: emailBody,
          });
        } catch (calendarError) {
          console.error('Failed to create calendar invitation:', calendarError);
          await sendEmail(accessToken, {
            to: client.email,
            subject: emailSubject,
            body: emailBody,
          });
        }
      }

      toast.success('Meeting rescheduled and client notified.');
      setShowRescheduleDrawer(false);
      setMeetingToDelete(null);
      setRescheduleFormData({
        date: '',
        time: '09:00',
        location: 'Teams',
        calendar: 'active_client',
        manager: '',
        helper: '',
        brief: '',
        attendance_probability: 'Medium',
        complexity: 'Simple',
        car_number: '',
      });
      setRescheduleOption('cancel');
      if (onClientUpdate) await onClientUpdate();
      await fetchMeetings();
    } catch (error) {
      toast.error('Failed to reschedule meeting.');
      console.error(error);
    } finally {
      setIsReschedulingMeeting(false);
    }
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

  // Edit meeting functions
  const handleEditMeeting = (meeting: Meeting) => {
    setEditingMeetingId(meeting.id);
    
    // Find the location ID for the current location name
    let locationId = meeting.location;
    if (typeof meeting.location === 'string' && !meeting.location.match(/^\d+$/)) {
      // If it's a string name, find the corresponding ID
      const location = allMeetingLocations.find(loc => loc.name === meeting.location);
      locationId = location ? location.id : meeting.location;
    }
    
    const normalizedLocation =
      typeof locationId === 'number'
        ? String(locationId)
        : typeof locationId === 'string'
          ? locationId
          : '';

    setEditedMeeting({
      date: meeting.date,
      time: meeting.time ? meeting.time.substring(0, 5) : meeting.time, // Remove seconds if present
      location: normalizedLocation,
      manager: meeting.manager,
      currency: meeting.currency,
      amount: meeting.amount,
      brief: meeting.brief,
      scheduler: meeting.scheduler,
      helper: meeting.helper,
    });
  };

  const handleCancelEditMeeting = () => {
    setEditingMeetingId(null);
    setEditedMeeting({});
  };

  const handleSaveMeeting = async () => {
    if (!editingMeetingId) return;
    
    setIsUpdatingMeeting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const editor = user?.email || 'system';
      
      // Check if location changed to Teams and needs Teams meeting creation
      const originalMeeting = meetings.find(m => m.id === editingMeetingId);
      const newLocationName = getMeetingLocationName(editedMeeting.location);
      const originalLocationName = getMeetingLocationName(originalMeeting?.location);
      
      // For Teams meetings, we should create a Teams meeting if:
      // 1. New location is Teams AND original location was not Teams, OR
      // 2. New location is Teams AND there's no existing Teams meeting link
      const needsTeamsMeeting = newLocationName === 'Teams' && 
        (originalLocationName !== 'Teams' || !originalMeeting?.link || !getValidTeamsLink(originalMeeting?.link));
      
      console.log('🔍 Teams meeting creation check:', {
        editingMeetingId,
        originalMeeting: originalMeeting ? { id: originalMeeting.id, location: originalMeeting.location } : null,
        editedMeetingLocation: editedMeeting.location,
        newLocationName,
        originalLocationName,
        hasExistingLink: !!originalMeeting?.link,
        existingLink: originalMeeting?.link,
        isValidTeamsLink: originalMeeting?.link ? !!getValidTeamsLink(originalMeeting.link) : false,
        needsTeamsMeeting
      });
      
      let teamsMeetingUrl = originalMeeting?.link; // Keep existing link if any
      
      // Create Teams meeting if location changed to Teams and no existing link
      if (needsTeamsMeeting) {
        console.log('🔧 Creating Teams meeting for location change...');
        console.log('🔧 Meeting details:', { date: editedMeeting.date, time: editedMeeting.time, client: client.name });
        
        try {
          if (!instance) throw new Error('MSAL instance not available');
          const accounts = instance.getAllAccounts();
          if (!accounts.length) throw new Error('No Microsoft account found');
          
          console.log('🔧 MSAL instance and accounts available');
          
          // Try silent token acquisition first, fall back to popup if needed
          let tokenResponse;
          try {
            tokenResponse = await instance.acquireTokenSilent({ ...loginRequest, account: accounts[0] });
            console.log('🔧 Token acquired successfully');
          } catch (error) {
            // If silent acquisition fails (e.g., session expired), try interactive popup
            if (error instanceof InteractionRequiredAuthError) {
              toast('Your session has expired. Please sign in again.', { icon: '🔑' });
              tokenResponse = await instance.acquireTokenPopup({ ...loginRequest, account: accounts[0] });
              console.log('🔧 Token acquired via popup');
            } else {
              throw error; // Re-throw other errors
            }
          }
          
          const startDateTime = new Date(`${editedMeeting.date}T${editedMeeting.time || '09:00'}`).toISOString();
          const endDateTime = new Date(new Date(startDateTime).getTime() + 60 * 60 * 1000).toISOString();
          
          console.log('🔧 Creating Teams meeting with:', {
            subject: `Meeting with ${client.name}`,
            startDateTime,
            endDateTime,
          });
          
          const teamsData = await createTeamsMeeting(tokenResponse.accessToken, {
            subject: `Meeting with ${client.name}`,
            startDateTime,
            endDateTime,
          });
          
          console.log('🔧 Teams meeting created successfully:', teamsData);
          
          if (!teamsData || !teamsData.joinUrl) {
            throw new Error('No joinUrl returned from Teams API');
          }
          
          teamsMeetingUrl = teamsData.joinUrl;
          console.log('🔧 Teams meeting URL:', teamsMeetingUrl);
          toast.success('Teams meeting created automatically!');
        } catch (teamsError: any) {
          console.error('❌ Failed to create Teams meeting:', teamsError);
          console.error('❌ Error details:', {
            message: teamsError.message,
            stack: teamsError.stack,
            needsTeamsMeeting,
            newLocationName,
            originalLocationName,
            hasExistingLink: !!originalMeeting?.link
          });
          toast.error(`Meeting updated but failed to create Teams meeting: ${teamsError.message}`);
        }
      }
      
      // Check if this is a legacy meeting
      const isLegacyMeeting = originalMeeting && (originalMeeting as any).isLegacy;
      
      // Update database based on meeting type
      let dbError;
      
      if (isLegacyMeeting) {
        // For legacy meetings, update the leads_lead table
        const legacyId = client.id.toString().replace('legacy_', '');
        const locationIdValue =
          editedMeeting.location && /^\d+$/.test(String(editedMeeting.location))
            ? Number(editedMeeting.location)
            : null;
        const updateData: any = {
          meeting_date: editedMeeting.date,
          meeting_time: editedMeeting.time,
          meeting_location_id: locationIdValue,
          meeting_manager_id: editedMeeting.manager,
          meeting_total_currency_id: editedMeeting.currency === 'NIS' ? 1 : editedMeeting.currency === 'USD' ? 2 : 3,
          meeting_total: editedMeeting.amount,
          meeting_brief: editedMeeting.brief,
          meeting_scheduler_id: editedMeeting.scheduler,
          meeting_lawyer_id: editedMeeting.helper,
        };
        
        // Add Teams meeting URL if we created one
        if (teamsMeetingUrl && newLocationName === 'Teams') {
          updateData.meeting_url = teamsMeetingUrl;
        }
        
        const { error } = await supabase
          .from('leads_lead')
          .update(updateData)
          .eq('id', legacyId);
        
        dbError = error;
      } else {
        // For new meetings, update the meetings table
        // Convert location ID to location name for new leads
        const locationText = getMeetingLocationName(editedMeeting.location);
        
        const updateData: any = {
          meeting_date: editedMeeting.date,
          meeting_time: editedMeeting.time,
          meeting_location: locationText, // Use location name (text) for new leads
          meeting_manager: editedMeeting.manager,
          meeting_currency: editedMeeting.currency,
          meeting_amount: editedMeeting.amount,
          meeting_brief: editedMeeting.brief,
          scheduler: editedMeeting.scheduler,
          helper: editedMeeting.helper,
          last_edited_timestamp: new Date().toISOString(),
          last_edited_by: editor,
        };
        
        // Add Teams meeting URL if we created one
        if (teamsMeetingUrl && newLocationName === 'Teams') {
          updateData.teams_meeting_url = teamsMeetingUrl;
        }

        const { error } = await supabase
          .from('meetings')
          .update(updateData)
          .eq('id', editingMeetingId);
        
        dbError = error;
      }

      if (dbError) throw dbError;

      // If it's a Teams meeting and date/time changed, update Outlook
      const finalTeamsUrl = teamsMeetingUrl || originalMeeting?.link;
      if (originalMeeting && getMeetingLocationName(editedMeeting.location) === 'Teams' && finalTeamsUrl) {
        const dateChanged = originalMeeting.date !== editedMeeting.date;
        const timeChanged = originalMeeting.time !== editedMeeting.time;
        
        console.log('🔄 Checking Outlook sync:', {
          dateChanged,
          timeChanged,
          finalTeamsUrl,
          originalDate: originalMeeting.date,
          newDate: editedMeeting.date,
          originalTime: originalMeeting.time,
          newTime: editedMeeting.time
        });
        
        if (dateChanged || timeChanged) {
          try {
            const account = instance.getActiveAccount();
            if (account) {
              // Try silent token acquisition first, fall back to popup if needed
              let tokenResponse;
              try {
                tokenResponse = await instance.acquireTokenSilent({
                  ...loginRequest,
                  account: account,
                });
              } catch (error) {
                // If silent acquisition fails (e.g., session expired), try interactive popup
                if (error instanceof InteractionRequiredAuthError) {
                  toast('Your session has expired. Please sign in again.', { icon: '🔑' });
                  tokenResponse = await instance.acquireTokenPopup({
                    ...loginRequest,
                    account: account,
                  });
                } else {
                  throw error; // Re-throw other errors
                }
              }
              
              if (tokenResponse.accessToken) {
                console.log('🔄 Updating Outlook meeting...');
                await updateOutlookMeeting(tokenResponse.accessToken, finalTeamsUrl, {
                  startDateTime: `${editedMeeting.date}T${editedMeeting.time}:00`,
                  endDateTime: `${editedMeeting.date}T${editedMeeting.time}:00`,
                });
                console.log('✅ Outlook meeting updated successfully');
              }
            }
          } catch (outlookError) {
            console.error('❌ Failed to update Outlook meeting:', outlookError);
            toast.error('Meeting updated in database but failed to sync with Outlook');
          }
        }
      }

      toast.success('Meeting updated successfully');
      setMeetings(prev => prev.map(m => 
        m.id === editingMeetingId 
          ? { ...m, ...editedMeeting, link: teamsMeetingUrl || m.link, lastEdited: { timestamp: new Date().toISOString(), user: editor } }
          : m
      ));
      
      setEditingMeetingId(null);
      setEditedMeeting({});
      
      if (onClientUpdate) await onClientUpdate();
    } catch (error) {
      console.error('Error updating meeting:', error);
      toast.error('Failed to update meeting');
    } finally {
      setIsUpdatingMeeting(false);
    }
  };

  // Use expandedMeetingData if available
  const expandedData = expandedMeetingData[meeting.id] || {};
  const isExpanded = expandedMeetingId === meeting.id;

  const past = isPastMeeting(meeting);
  const showPastActions = past && isRecentPastMeeting(meeting);
  const headerColor = past ? '#DC473F' : '#369A69';

  return (
      <div key={meeting.id} className="bg-white border border-gray-200 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden relative">
        {/* Canceled watermark */}
        {meeting.status === 'canceled' && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="bg-red-500 text-white px-4 py-2 rounded-lg transform -rotate-12 font-bold text-lg shadow-lg">
              CANCELED
            </div>
          </div>
        )}
        {/* Header */}
        <div className="px-2 sm:px-4 py-2 sm:py-3 border-b" style={{ backgroundColor: headerColor, color: 'white' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-lg shadow-sm" style={{ backgroundColor: headerColor }}>
                <CalendarIcon className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              </div>
              <div>
                <p className="font-bold text-sm sm:text-lg text-white">{formattedDate}</p>
                <div className="flex items-center gap-1 sm:gap-2 text-white">
                  <ClockIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                  <span className="text-xs sm:text-sm font-medium">{meeting.time ? meeting.time.substring(0, 5) : ''}</span>
                </div>
              </div>
            </div>
            {/* Action Buttons */}
            <div className="flex gap-1 sm:gap-2">
              {/* Edit Button */}
              <button
                className="btn btn-xs sm:btn-sm backdrop-blur-md bg-white/20 text-white hover:bg-white/30 border border-white/30 shadow-lg"
                onClick={() => handleEditMeeting(meeting)}
                title="Edit Meeting"
              >
                <PencilIcon className="w-3 h-3 sm:w-4 sm:h-4" />
              </button>
              {!past && (
                <>
                  <div className="relative" ref={(el) => {
                    if (el) {
                      notifyDropdownRefs.current.set(meeting.id, el);
                    } else {
                      notifyDropdownRefs.current.delete(meeting.id);
                    }
                  }}>
                    <button
                      className="btn btn-xs sm:btn-sm backdrop-blur-md bg-white/20 text-white hover:bg-white/30 border border-white/30 shadow-lg"
                      onClick={() => {
                        if (sendingEmailMeetingId !== meeting.id) {
                          setShowNotifyDropdown(showNotifyDropdown === meeting.id ? null : meeting.id);
                        }
                      }}
                      disabled={sendingEmailMeetingId === meeting.id}
                      title="Notify Client via Email"
                    >
                      {sendingEmailMeetingId === meeting.id ? (
                        <span className="loading loading-spinner loading-xs" style={{ color: '#ffffff' }}></span>
                      ) : (
                        <>
                          <EnvelopeIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                          <ChevronDownIcon className="w-2.5 h-2.5 sm:w-3 sm:h-3 ml-0.5 sm:ml-1" />
                        </>
                      )}
                    </button>
                    {showNotifyDropdown === meeting.id && (
                      <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                        {/* Conditional Meeting Invitation based on location */}
                        {(() => {
                          const location = (meeting.location || '').toLowerCase();
                          
                          if (location.includes('jrslm') || location.includes('jerusalem')) {
                            return (
                              <button
                                className="w-full text-left px-4 py-2 text-sm text-gray-900 hover:bg-gray-100 first:rounded-t-lg"
                                onClick={() => handleNotifyClick(meeting, 'invitation_jlm')}
                              >
                                Meeting Invitation JLM
                              </button>
                            );
                          } else if (location.includes('tlv') && location.includes('parking')) {
                            return (
                              <button
                                className="w-full text-left px-4 py-2 text-sm text-gray-900 hover:bg-gray-100 first:rounded-t-lg"
                                onClick={() => handleNotifyClick(meeting, 'invitation_tlv_parking')}
                              >
                                Meeting Invitation TLV + Parking
                              </button>
                            );
                          } else if (location.includes('tlv') || location.includes('tel aviv')) {
                            return (
                              <button
                                className="w-full text-left px-4 py-2 text-sm text-gray-900 hover:bg-gray-100 first:rounded-t-lg"
                                onClick={() => handleNotifyClick(meeting, 'invitation_tlv')}
                              >
                                Meeting Invitation TLV
                              </button>
                            );
                          } else {
                            return (
                              <button
                                className="w-full text-left px-4 py-2 text-sm text-gray-900 hover:bg-gray-100 first:rounded-t-lg"
                                onClick={() => handleNotifyClick(meeting, 'invitation')}
                              >
                                Meeting Invitation
                              </button>
                            );
                          }
                        })()}
                        <button
                          className="w-full text-left px-4 py-2 text-sm text-gray-900 hover:bg-gray-100"
                          onClick={() => handleNotifyClick(meeting, 'reminder')}
                        >
                          Meeting Reminder
                        </button>
                        <button
                          className="w-full text-left px-4 py-2 text-sm text-gray-900 hover:bg-gray-100"
                          onClick={() => handleNotifyClick(meeting, 'rescheduled')}
                        >
                          Meeting Rescheduled
                        </button>
                        <button
                          className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 last:rounded-b-lg text-red-600"
                          onClick={() => handleNotifyClick(meeting, 'cancellation')}
                        >
                          Meeting Cancellation
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="relative" ref={(el) => {
                    if (el) {
                      whatsAppDropdownRefs.current.set(meeting.id, el);
                    } else {
                      whatsAppDropdownRefs.current.delete(meeting.id);
                    }
                  }}>
                    <button
                      className="btn btn-xs sm:btn-sm backdrop-blur-md bg-white/20 text-white hover:bg-white/30 border border-white/30 shadow-lg"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (sendingWhatsAppMeetingId !== meeting.id) {
                          setShowWhatsAppDropdown(showWhatsAppDropdown === meeting.id ? null : meeting.id);
                        }
                      }}
                      disabled={sendingWhatsAppMeetingId === meeting.id}
                      title="Send WhatsApp Reminder"
                    >
                      {sendingWhatsAppMeetingId === meeting.id ? (
                        <span className="loading loading-spinner loading-xs" style={{ color: '#ffffff' }}></span>
                      ) : (
                        <>
                          <FaWhatsapp className="w-3 h-3 sm:w-4 sm:h-4 text-green-300" />
                          <ChevronDownIcon className="w-2.5 h-2.5 sm:w-3 sm:h-3 ml-0.5 sm:ml-1" />
                        </>
                      )}
                    </button>
                    {showWhatsAppDropdown === meeting.id && (
                      <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                        <button
                          className="w-full text-left px-4 py-2 text-sm text-gray-900 hover:bg-gray-100 first:rounded-t-lg"
                          onClick={(e) => {
                            e.stopPropagation();
                            setWhatsAppReminderType('reminder');
                            handleWhatsAppNotifyClick(meeting);
                            setShowWhatsAppDropdown(null);
                          }}
                        >
                          Meeting Reminder
                        </button>
                        <button
                          className="w-full text-left px-4 py-2 text-sm text-gray-900 hover:bg-gray-100 last:rounded-b-lg"
                          onClick={(e) => {
                            e.stopPropagation();
                            setWhatsAppReminderType('missed_appointment');
                            handleWhatsAppNotifyClick(meeting);
                            setShowWhatsAppDropdown(null);
                          }}
                        >
                          Missed Appointment
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
              {!past && getMeetingLocationName(meeting.location) === 'Teams' && !meeting.link && (
                <button
                  className="btn btn-xs sm:btn-sm backdrop-blur-md bg-white/20 text-white hover:bg-white/30 border border-white/30 shadow-lg"
                  onClick={() => handleCreateTeamsMeeting(meeting)}
                  disabled={creatingTeamsMeetingId === meeting.id}
                >
                  {creatingTeamsMeetingId === meeting.id ? (
                    <span className="loading loading-spinner loading-xs"></span>
                  ) : (
                    <VideoCameraIcon className="w-3 h-3 sm:w-4 sm:h-4 sm:hidden" />
                  )}
                  <span className="hidden sm:inline">Teams</span>
                </button>
              )}
              {!past && getMeetingLocationName(meeting.location) === 'Teams' && meeting.link && getValidTeamsLink(meeting.link) && (
                <a
                  href={getValidTeamsLink(meeting.link)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-xs sm:btn-sm backdrop-blur-md bg-white/20 text-white hover:bg-white/30 border border-white/30 shadow-lg"
                  title="Join Teams Meeting"
                >
                  <LinkIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                </a>
              )}
              {/* Legacy meeting URL link */}
              {meeting.link && !getValidTeamsLink(meeting.link) && (
                <a
                  href={meeting.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-xs sm:btn-sm backdrop-blur-md bg-white/20 text-white hover:bg-white/30 border border-white/30 shadow-lg"
                >
                  <LinkIcon className="w-3 h-3 sm:w-4 sm:h-4 sm:hidden" />
                  <span className="hidden sm:inline">Link</span>
                </a>
              )}
              {/* Cancel only for upcoming and not canceled */}
              {!isPastMeeting(meeting) && meeting.status !== 'canceled' && (
                <button
                  className="hidden sm:flex btn btn-xs sm:btn-sm backdrop-blur-md bg-white/20 text-white hover:bg-white/30 border border-white/30 shadow-lg"
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
                  <XMarkIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-3 sm:p-4">
          <div className="space-y-3 sm:space-y-3">



            {/* Meeting Details */}
            {editingMeetingId === meeting.id ? (
              /* Edit Mode */
              <div className="space-y-4">
                {/* Date and Time */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                    <label className="text-sm font-medium uppercase tracking-wide" style={{ color: '#391BCB' }}>Date</label>
                    <input
                      type="date"
                      className="input input-bordered w-full"
                      value={editedMeeting.date || ''}
                      onChange={(e) => setEditedMeeting(prev => ({ ...prev, date: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium uppercase tracking-wide" style={{ color: '#391BCB' }}>Time</label>
                    <select
                      className="select select-bordered w-full"
                      value={editedMeeting.time || ''}
                      onChange={(e) => setEditedMeeting(prev => ({ ...prev, time: e.target.value }))}
                    >
                      <option value="">{meeting.time ? meeting.time.substring(0, 5) : 'Select time'}</option>
                      {timeOptions.map(time => (
                        <option key={time} value={time}>{time}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Location and Manager */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium uppercase tracking-wide" style={{ color: '#391BCB' }}>Location</label>
                    <select
                      className="select select-bordered w-full"
                      value={editedMeeting.location ?? ''}
                      onChange={(e) => {
                        const value = e.target.value;
                        setEditedMeeting(prev => ({ ...prev, location: value }));
                      }}
                    >
                      <option value="">{getMeetingLocationName(meeting.location) || 'Select location'}</option>
                      {allMeetingLocations.map((location: any) => (
                        <option key={location.id} value={location.id}>{location.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium uppercase tracking-wide" style={{ color: '#391BCB' }}>Manager</label>
                    <select
                      className="select select-bordered w-full"
                      value={editedMeeting.manager || ''}
                      onChange={(e) => setEditedMeeting(prev => ({ ...prev, manager: e.target.value }))}
                    >
                      <option value="">{getEmployeeDisplayName(meeting.manager) || 'Select manager'}</option>
                      {allEmployees.map((emp: any) => (
                        <option key={emp.id} value={emp.id}>{emp.display_name || emp.full_name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Scheduler and Helper */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium uppercase tracking-wide" style={{ color: '#391BCB' }}>Scheduler</label>
                    <select
                      className="select select-bordered w-full"
                      value={editedMeeting.scheduler || ''}
                      onChange={(e) => setEditedMeeting(prev => ({ ...prev, scheduler: e.target.value }))}
                    >
                      <option value="">{getEmployeeDisplayName(meeting.scheduler) || 'Select scheduler'}</option>
                      {allEmployees.map((emp: any) => (
                        <option key={emp.id} value={emp.id}>{emp.display_name || emp.full_name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium uppercase tracking-wide" style={{ color: '#391BCB' }}>Helper</label>
                    <select
                      className="select select-bordered w-full"
                      value={editedMeeting.helper || ''}
                      onChange={(e) => setEditedMeeting(prev => ({ ...prev, helper: e.target.value }))}
                    >
                      <option value="">{getEmployeeDisplayName(meeting.helper) || 'Select helper'}</option>
                      {allEmployees.map((emp: any) => (
                        <option key={emp.id} value={emp.id}>{emp.display_name || emp.full_name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Amount */}
                <div className="space-y-2">
                  <label className="text-sm font-medium uppercase tracking-wide" style={{ color: '#391BCB' }}>Amount</label>
                  <div className="flex gap-2">
                    <select
                      className="select select-bordered flex-shrink-0"
                      value={editedMeeting.currency || 'NIS'}
                      onChange={(e) => setEditedMeeting(prev => ({ ...prev, currency: e.target.value }))}
                    >
                      {currencyOptions.map(currency => (
                        <option key={currency.value} value={currency.value}>{currency.symbol}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      className="input input-bordered flex-1"
                      placeholder={meeting.amount ? meeting.amount.toString() : "Amount"}
                      value={editedMeeting.amount || ''}
                      onChange={(e) => setEditedMeeting(prev => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))}
                    />
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 pt-4 border-t border-purple-100">
                  <button
                    className="btn btn-sm text-white border-none"
                    style={{ backgroundColor: '#391BCB' }}
                    onClick={handleSaveMeeting}
                    disabled={isUpdatingMeeting}
                  >
                    {isUpdatingMeeting ? (
                      <span className="loading loading-spinner loading-xs"></span>
                    ) : (
                      <CheckIcon className="w-4 h-4" />
                    )}
                    Save Changes
                  </button>
                  <button
                    className="btn btn-sm text-white border-none"
                    style={{ backgroundColor: '#391BCB' }}
                    onClick={handleCancelEditMeeting}
                    disabled={isUpdatingMeeting}
                  >
                    <XMarkIcon className="w-4 h-4" />
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              /* View Mode */
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-3">
                <div className="space-y-2 sm:space-y-2">
                  <label className="text-sm sm:text-sm font-medium uppercase tracking-wide" style={{ color: '#391BCB' }}>Location</label>
                <div className="flex items-center gap-2 sm:gap-2">
                    <MapPinIcon className="w-4 h-4 sm:w-4 sm:h-4" style={{ color: '#391BCB' }} />
                  <span className="text-sm sm:text-base text-gray-900">{getMeetingLocationName(meeting.location)}</span>
                </div>
              </div>
              <div className="space-y-2 sm:space-y-2">
                  <label className="text-sm sm:text-sm font-medium uppercase tracking-wide" style={{ color: '#391BCB' }}>Manager</label>
                <div className="flex items-center gap-2 sm:gap-2">
                    <UserIcon className="w-4 h-4 sm:w-4 sm:h-4" style={{ color: '#391BCB' }} />
                  <span className="text-sm sm:text-base text-gray-900">{getEmployeeDisplayName(meeting.manager)}</span>
                </div>
              </div>
              <div className="space-y-2 sm:space-y-2">
                  <label className="text-sm sm:text-sm font-medium uppercase tracking-wide" style={{ color: '#391BCB' }}>Scheduler</label>
                <div className="flex items-center gap-2 sm:gap-2">
                    <UserCircleIcon className="w-4 h-4 sm:w-4 sm:h-4" style={{ color: '#391BCB' }} />
                  <span className="text-sm sm:text-base text-gray-900">{getEmployeeDisplayName(meeting.scheduler)}</span>
                </div>
              </div>
              <div className="space-y-2 sm:space-y-2">
                  <label className="text-sm sm:text-sm font-medium uppercase tracking-wide" style={{ color: '#391BCB' }}>Helper</label>
                <div className="flex items-center gap-2 sm:gap-2">
                    <UserCircleIcon className="w-4 h-4 sm:w-4 sm:h-4" style={{ color: '#391BCB' }} />
                  <span className="text-sm sm:text-base text-gray-900">{getEmployeeDisplayName(meeting.helper)}</span>
                </div>
              </div>
              <div className="space-y-2 sm:space-y-2">
                  <label className="text-sm sm:text-sm font-medium uppercase tracking-wide" style={{ color: '#391BCB' }}>Expert</label>
                <div className="flex items-center gap-2 sm:gap-2">
                    <AcademicCapIcon className="w-4 h-4 sm:w-4 sm:h-4" style={{ color: '#391BCB' }} />
                  <span className="text-sm sm:text-base text-gray-900">{getEmployeeDisplayName(meeting.expert)}</span>
                </div>
              </div>
              <div className="space-y-2 sm:space-y-2">
                  <label className="text-sm sm:text-sm font-medium uppercase tracking-wide" style={{ color: '#391BCB' }}>Amount</label>
                <div className="flex items-center gap-2">
                  {meeting.amount && meeting.amount > 0 ? (
                      <span className="text-sm sm:text-base font-semibold" style={{ color: '#391BCB' }}>
                      {getCurrencySymbol(meeting.currency)} {typeof meeting.amount === 'number' ? meeting.amount.toLocaleString() : meeting.amount}
                    </span>
                  ) : (
                    <span className="text-sm sm:text-base text-gray-400 italic">Not specified</span>
                  )}
                </div>
              </div>
            </div>
            )}

            {/* Brief Section */}
            {editingMeetingId !== meeting.id && (
            <div className="border-t border-purple-100 pt-3 sm:pt-3">
              <div className="flex justify-between items-center mb-2 sm:mb-2">
                  <label className="text-sm sm:text-sm font-medium uppercase tracking-wide" style={{ color: '#391BCB' }}>Brief</label>
                {editingBriefId === meeting.id ? (
                  <div className="flex items-center gap-1">
                    <button className="btn btn-ghost btn-xs hover:bg-green-50" onClick={() => handleSaveBrief(meeting.id)}>
                      <CheckIcon className="w-4 h-4 sm:w-4 sm:h-4 text-green-600" />
                    </button>
                    <button className="btn btn-ghost btn-xs hover:bg-red-50" onClick={handleCancelEdit}>
                      <XMarkIcon className="w-4 h-4 sm:w-4 sm:h-4 text-red-600" />
                    </button>
                  </div>
                ) : (
                  <button className="btn btn-ghost btn-xs hover:bg-purple-50" onClick={handleEditBrief}>
                    <PencilSquareIcon className="w-4 h-4 sm:w-4 sm:h-4 text-purple-500 hover:text-purple-600" />
                  </button>
                )}
              </div>
              {editingBriefId === meeting.id ? (
                <textarea
                  className="textarea textarea-bordered w-full h-20 sm:h-20 text-sm sm:text-base"
                  value={editedBrief}
                  onChange={(e) => setEditedBrief(e.target.value)}
                  placeholder="Add a meeting brief..."
                />
              ) : (
                <div className="bg-gray-50 rounded-lg p-3 sm:p-3 min-h-[60px] sm:min-h-[60px]">
                  {meeting.brief ? (
                    <p className="text-sm sm:text-base text-gray-900 whitespace-pre-wrap">{meeting.brief}</p>
                  ) : (
                    <span className="text-sm sm:text-base text-gray-400 italic">No brief provided</span>
                  )}
                </div>
              )}
            </div>
            )}

            {/* Brief Section in Edit Mode */}
            {editingMeetingId === meeting.id && (
              <div className="border-t border-purple-100 pt-3">
                <label className="text-sm font-medium text-purple-600 uppercase tracking-wide">Brief</label>
                <textarea
                  className="textarea textarea-bordered w-full h-20 text-base mt-2"
                  value={editedMeeting.brief || ''}
                  onChange={(e) => setEditedMeeting(prev => ({ ...prev, brief: e.target.value }))}
                  placeholder="Add a meeting brief..."
                />
              </div>
            )}

            {/* Last Edited */}
            {meeting.lastEdited && (
              <div className="text-sm sm:text-sm text-gray-400 flex justify-between border-t border-gray-100 pt-2 sm:pt-2">
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
          className="cursor-pointer transition-all p-2 text-center border-t border-purple-200 bg-white"
          onClick={() => setExpandedMeetingId(expandedMeetingId === meeting.id ? null : meeting.id)}
        >
          <div className="flex items-center justify-center gap-2 text-xs font-medium" style={{ color: '#391BCB' }}>
            <span>{expandedMeetingId === meeting.id ? 'Show Less' : 'Show More'}</span>
            <ChevronDownIcon className={`w-4 h-4 transition-transform ${expandedMeetingId === meeting.id ? 'rotate-180' : ''}`} style={{ color: '#391BCB' }} />
          </div>
        </div>
      </div>
    );
  };

  const updateOutlookMeeting = async (accessToken: string, meetingId: string, updates: any) => {
    const url = `https://graph.microsoft.com/v1.0/me/calendar/events/${meetingId}`;
    
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        start: {
          dateTime: updates.startDateTime,
          timeZone: 'Asia/Jerusalem'
        },
        end: {
          dateTime: updates.endDateTime,
          timeZone: 'Asia/Jerusalem'
        }
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to update Outlook meeting: ${response.statusText}`);
    }
  };

  return (
    <div className="px-1 sm:px-4 md:px-6 py-2 sm:py-4 md:py-6 space-y-4 sm:space-y-6">
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
        {/* Schedule/Reschedule Meeting Button - Only show when stage is 60 or higher (client signed agreement and beyond) */}
        {(() => {
          const stageId = typeof client.stage === 'number' ? client.stage : 
                          typeof client.stage === 'string' ? parseInt(client.stage, 10) : null;
          return stageId !== null && stageId >= 60;
        })() && (
          <button
            onClick={() => {
              if (upcomingMeetings.length > 0) {
                setShowRescheduleDrawer(true);
              } else {
                setShowScheduleDrawer(true);
              }
            }}
            className="btn text-white border-none"
            style={{ 
              background: 'linear-gradient(to bottom right, #10b981, #14b8a6)',
              border: 'none',
              boxShadow: 'none'
            }}
          >
            <CalendarIcon className="w-5 h-5 mr-2 text-white" />
            {upcomingMeetings.length > 0 ? 'Reschedule Meeting' : 'Schedule Meeting'}
          </button>
        )}
      </div>

      {/* Scheduling History Table */}
      {schedulingHistory.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
          <div className="px-6 py-4 bg-white">
            <h4 className="text-lg font-semibold text-gray-900">Scheduling History</h4>
            <div className="border-b border-gray-200 mt-3"></div>
          </div>
          <div className="p-6">
            <div className="overflow-x-auto">
              <table className="table w-full">
                  <thead>
                    <tr>
                      <th className="text-xs font-semibold text-gray-600 uppercase">Date</th>
                      <th className="text-xs font-semibold text-gray-600 uppercase">Created By</th>
                      <th className="text-xs font-semibold text-gray-600 uppercase">Scheduling Notes</th>
                      <th className="text-xs font-semibold text-gray-600 uppercase">Next Follow-up</th>
                      <th className="text-xs font-semibold text-gray-600 uppercase">Follow-up Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedulingHistory.map((entry) => (
                      <tr key={entry.id}>
                        <td className="text-sm text-gray-900">
                          {new Date(entry.created_at).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </td>
                        <td className="text-sm text-gray-900">{entry.created_by || 'Unknown'}</td>
                        <td className="text-sm text-gray-900 whitespace-pre-line max-w-xs">
                          {entry.meeting_scheduling_notes || <span className="text-gray-400 italic">No notes</span>}
                        </td>
                        <td className="text-sm text-gray-900">
                          {entry.next_followup ? new Date(entry.next_followup).toLocaleDateString() : <span className="text-gray-400 italic">Not set</span>}
                        </td>
                        <td className="text-sm text-gray-900 whitespace-pre-line max-w-xs">
                          {entry.followup || entry.followup_log || <span className="text-gray-400 italic">No notes</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Meeting Summary Content Box */}
      {/* <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
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
            {/* <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-4 h-4 bg-blue-500 rounded-full"></div>
                <span className="font-medium text-blue-900">Summary Status</span>
              </div>
              <p className="text-sm text-blue-700">
                Meeting summaries will appear here automatically after meetings with transcription enabled.
              </p>
            </div>

            {/* Instructions */}
            {/* <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
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
      </div> */}

      {/* Two-column grid: Upcoming (left) and Past (right) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-6">
        {/* Upcoming Meetings (Left) */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden">
          <div className="px-3 sm:px-6 py-4 bg-white">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-semibold text-gray-900">Upcoming Meetings</h4>
              {upcomingMeetings.length > 0 && (
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  {leadSchedulingInfo.meeting_confirmation && leadSchedulingInfo.meeting_confirmation_by ? (
                    <span className="text-sm text-gray-600">
                      {getEmployeeDisplayName(leadSchedulingInfo.meeting_confirmation_by)} confirmed meeting
                    </span>
                  ) : (
                    <span className="text-sm text-gray-600">Not confirmed</span>
                  )}
                  <input
                    type="checkbox"
                    className="toggle toggle-primary toggle-sm"
                    checked={leadSchedulingInfo.meeting_confirmation ?? false}
                    onChange={handleToggleMeetingConfirmation}
                  />
                </label>
              )}
            </div>
            <div className="border-b border-gray-200 mt-3"></div>
          </div>
          <div className="p-3 sm:p-6">
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
          <div className="px-3 sm:px-6 py-4 bg-white">
            <h4 className="text-lg font-semibold text-gray-900">Past Meetings</h4>
            <div className="border-b border-gray-200 mt-3"></div>
          </div>
          <div className="p-3 sm:p-6">
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

      {/* Notify Modal */}
      {showNotifyModal && selectedMeetingForNotify && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowNotifyModal(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Select Recipient</h3>
                <button
                  onClick={() => setShowNotifyModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
              
              {/* Language Selection */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Email Language</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedEmailLanguage('en')}
                    className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${
                      selectedEmailLanguage === 'en'
                        ? 'bg-primary text-white border-primary'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    English
                  </button>
                  <button
                    onClick={() => setSelectedEmailLanguage('he')}
                    className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${
                      selectedEmailLanguage === 'he'
                        ? 'bg-primary text-white border-primary'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    עברית
                  </button>
                </div>
              </div>
              
              {loadingContacts ? (
                <div className="flex justify-center items-center py-8">
                  <span className="loading loading-spinner loading-md"></span>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Email All Option */}
                  {contacts.filter(c => c.email && c.email !== '---').length > 1 && (
                    <button
                      onClick={() => {
                        // Send to all contacts at once
                        const allEmails = contacts
                          .filter(c => c.email && c.email !== '---')
                          .map(c => c.email!);
                        
                        if (allEmails.length === 0) {
                          toast.error('No email addresses found for contacts');
                          return;
                        }
                        
                        handleSendEmail(selectedMeetingForNotify, allEmails, client.name);
                      }}
                      className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:bg-purple-50 hover:border-purple-300 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <EnvelopeIcon className="w-5 h-5 text-purple-600" />
                        <div>
                          <div className="font-medium text-gray-900">Email All Contacts</div>
                          <div className="text-sm text-gray-500">
                            {contacts.filter(c => c.email && c.email !== '---').length} contact{contacts.filter(c => c.email && c.email !== '---').length !== 1 ? 's' : ''} with email
                          </div>
                        </div>
                      </div>
                    </button>
                  )}
                  
                  {/* Individual Contacts */}
                  {contacts
                    .filter(c => c.email && c.email !== '---')
                    .map((contact) => (
                      <button
                        key={contact.id}
                        onClick={() => handleSendEmail(selectedMeetingForNotify, contact.email!, contact.name)}
                        className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:bg-purple-50 hover:border-purple-300 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <UserCircleIcon className="w-5 h-5 text-purple-600" />
                          <div className="flex-1">
                            <div className="font-medium text-gray-900">
                              {contact.name || '---'}
                              {contact.isMain && (
                                <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">Main</span>
                              )}
                            </div>
                            <div className="text-sm text-gray-500">{contact.email}</div>
                          </div>
                        </div>
                      </button>
                    ))}
                  
                  {/* Client Email (fallback) */}
                  {client.email && contacts.filter(c => c.email && c.email !== '---').length === 0 && (
                    <button
                      onClick={() => handleSendEmail(selectedMeetingForNotify, client.email, client.name)}
                      className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:bg-purple-50 hover:border-purple-300 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <EnvelopeIcon className="w-5 h-5 text-purple-600" />
                        <div>
                          <div className="font-medium text-gray-900">{client.name}</div>
                          <div className="text-sm text-gray-500">{client.email}</div>
                        </div>
                      </div>
                    </button>
                  )}
                  
                  {contacts.filter(c => c.email && c.email !== '---').length === 0 && !client.email && (
                    <div className="text-center py-8 text-gray-500">
                      <EnvelopeIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                      <p>No email addresses found</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Notify Modal */}
      {showWhatsAppNotifyModal && selectedMeetingForWhatsAppNotify && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowWhatsAppNotifyModal(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  Send WhatsApp {whatsAppReminderType === 'missed_appointment' ? 'Missed Appointment' : 'Reminder'}
                </h3>
                <button
                  onClick={() => setShowWhatsAppNotifyModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
              
              {/* Language Selection */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Language</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedLanguage('he')}
                    className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${
                      selectedLanguage === 'he'
                        ? 'bg-green-600 text-white border-green-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    Hebrew
                  </button>
                  <button
                    onClick={() => setSelectedLanguage('en')}
                    className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${
                      selectedLanguage === 'en'
                        ? 'bg-green-600 text-white border-green-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    English
                  </button>
                  {whatsAppReminderType === 'missed_appointment' && (
                    <button
                      onClick={() => setSelectedLanguage('ru')}
                      className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${
                        selectedLanguage === 'ru'
                          ? 'bg-green-600 text-white border-green-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      Russian
                    </button>
                  )}
                </div>
              </div>
              
              {loadingWhatsAppContacts ? (
                <div className="flex justify-center items-center py-8">
                  <span className="loading loading-spinner loading-md"></span>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Helper function to check if contact has valid phone */}
                  {(() => {
                    const contactsWithPhone = whatsAppContacts.filter(c => {
                      const phone = c.phone?.trim();
                      const mobile = c.mobile?.trim();
                      return (phone && phone !== '' && phone !== '---') || (mobile && mobile !== '' && mobile !== '---');
                    });
                    
                    return (
                      <>
                        {/* WhatsApp All Option */}
                        {contactsWithPhone.length > 1 && (
                          <button
                            onClick={() => {
                              // Send to all contacts at once
                              const allPhones = contactsWithPhone
                                .map(c => {
                                  const phone = c.phone?.trim();
                                  const mobile = c.mobile?.trim();
                                  return (phone && phone !== '' && phone !== '---') ? phone : (mobile && mobile !== '' && mobile !== '---') ? mobile : null;
                                })
                                .filter(Boolean) as string[];
                              
                              if (allPhones.length === 0) {
                                toast.error('No phone numbers found for contacts');
                                return;
                              }
                              
                              handleSendWhatsAppReminder(selectedMeetingForWhatsAppNotify, allPhones, whatsAppReminderType);
                            }}
                            className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:bg-green-50 hover:border-green-300 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <FaWhatsapp className="w-5 h-5 text-green-600" />
                              <div>
                                <div className="font-medium text-gray-900">Send to All Contacts</div>
                                <div className="text-sm text-gray-500">
                                  {contactsWithPhone.length} contact{contactsWithPhone.length !== 1 ? 's' : ''} with phone
                                </div>
                              </div>
                            </div>
                          </button>
                        )}
                        
                        {/* Individual Contacts */}
                        {contactsWithPhone.map((contact) => {
                          const phone = contact.phone?.trim();
                          const mobile = contact.mobile?.trim();
                          const phoneNumber = (phone && phone !== '' && phone !== '---') ? phone : (mobile && mobile !== '' && mobile !== '---') ? mobile : null;
                          
                          if (!phoneNumber) return null;
                          
                          return (
                            <button
                              key={contact.id}
                              onClick={() => handleSendWhatsAppReminder(selectedMeetingForWhatsAppNotify, phoneNumber, whatsAppReminderType)}
                              className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:bg-green-50 hover:border-green-300 transition-colors"
                            >
                              <div className="flex items-center gap-3">
                                <UserCircleIcon className="w-5 h-5 text-green-600" />
                                <div className="flex-1">
                                  <div className="font-medium text-gray-900">
                                    {contact.name || '---'}
                                    {contact.isMain && (
                                      <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Main</span>
                                    )}
                                  </div>
                                  <div className="text-sm text-gray-500">{phoneNumber}</div>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                        
                        {/* Client Phone (fallback) */}
                        {(() => {
                          const clientPhone = client.phone?.trim();
                          const clientMobile = client.mobile?.trim();
                          const hasClientPhone = (clientPhone && clientPhone !== '' && clientPhone !== '---') || (clientMobile && clientMobile !== '' && clientMobile !== '---');
                          
                          if (hasClientPhone && contactsWithPhone.length === 0) {
                            const clientPhoneNumber = (clientPhone && clientPhone !== '' && clientPhone !== '---') ? clientPhone : (clientMobile && clientMobile !== '' && clientMobile !== '---') ? clientMobile : null;
                            if (clientPhoneNumber) {
                              return (
                                <button
                                  onClick={() => handleSendWhatsAppReminder(selectedMeetingForWhatsAppNotify, clientPhoneNumber, whatsAppReminderType)}
                                  className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:bg-green-50 hover:border-green-300 transition-colors"
                                >
                                  <div className="flex items-center gap-3">
                                    <FaWhatsapp className="w-5 h-5 text-green-600" />
                                    <div>
                                      <div className="font-medium text-gray-900">{client.name}</div>
                                      <div className="text-sm text-gray-500">{clientPhoneNumber}</div>
                                    </div>
                                  </div>
                                </button>
                              );
                            }
                          }
                          return null;
                        })()}
                        
                        {contactsWithPhone.length === 0 && !(client.phone?.trim() && client.phone.trim() !== '' && client.phone.trim() !== '---') && !(client.mobile?.trim() && client.mobile.trim() !== '' && client.mobile.trim() !== '---') && (
                          <div className="text-center py-8 text-gray-500">
                            <FaWhatsapp className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                            <p>No phone numbers found</p>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {meetings.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-lg overflow-hidden">
          <div className="px-6 py-4 bg-white">
            <h4 className="text-lg font-semibold text-gray-900">Meetings</h4>
            <div className="border-b border-gray-200 mt-3"></div>
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

      {/* Schedule Meeting Drawer */}
      {showScheduleDrawer && (
        <div className="fixed inset-0 z-50 flex">
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black/30"
            onClick={() => {
              setShowScheduleDrawer(false);
              setScheduleMeetingFormData({
                date: '',
                time: '09:00',
                location: 'Teams',
                manager: '',
                helper: '',
                brief: '',
                attendance_probability: 'Medium',
                complexity: 'Simple',
                car_number: '',
                calendar: 'active_client',
              });
            }}
          />
          {/* Panel */}
          <div className="ml-auto w-full max-w-md bg-base-100 h-screen shadow-2xl flex flex-col animate-slideInRight z-50">
            {/* Fixed Header */}
            <div className="flex items-center justify-between p-8 pb-4 border-b border-base-300">
              <h3 className="text-2xl font-bold">Schedule Meeting</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => {
                setShowScheduleDrawer(false);
                setScheduleMeetingFormData({
                  date: '',
                  time: '09:00',
                  location: 'Teams',
                  manager: '',
                  helper: '',
                  brief: '',
                  attendance_probability: 'Medium',
                  complexity: 'Simple',
                  car_number: '',
                  calendar: 'active_client',
                });
              }}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            
            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-8 pt-4">
              <div className="flex flex-col gap-4">
                {/* Location */}
                <div>
                  <label className="block font-semibold mb-1">Location</label>
                  <select
                    className="select select-bordered w-full"
                    value={scheduleMeetingFormData.location}
                    onChange={(e) => setScheduleMeetingFormData(prev => ({ ...prev, location: e.target.value }))}
                  >
                    {allMeetingLocations.map((location) => (
                      <option key={location.id} value={location.name}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Calendar */}
                <div>
                  <label className="block font-semibold mb-1">Calendar</label>
                  <select
                    className="select select-bordered w-full"
                    value={scheduleMeetingFormData.calendar}
                    onChange={(e) => setScheduleMeetingFormData(prev => ({ ...prev, calendar: e.target.value }))}
                  >
                    <option value="active_client">Active Client</option>
                  </select>
                </div>

                {/* Date */}
                <div>
                  <label className="block font-semibold mb-1">Date</label>
                  <input
                    type="date"
                    className="input input-bordered w-full"
                    value={scheduleMeetingFormData.date}
                    onChange={(e) => {
                      setScheduleMeetingFormData(prev => ({ ...prev, date: e.target.value }));
                      setMeetingCountsByTime({});
                    }}
                    required
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>

                {/* Time */}
                <div className="relative" ref={timeDropdownRef}>
                  <label className="block font-semibold mb-1">Time</label>
                  <div
                    className="input input-bordered w-full cursor-pointer flex items-center justify-between"
                    onClick={() => setShowTimeDropdown(!showTimeDropdown)}
                  >
                    <span>{scheduleMeetingFormData.time}</span>
                    <ChevronDownIcon className="w-4 h-4" />
                  </div>
                  {showTimeDropdown && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                      {Array.from({ length: 32 }, (_, i) => {
                        const hour = Math.floor(i / 2) + 8; // Start from 8:00
                        const minute = i % 2 === 0 ? '00' : '30';
                        const timeOption = `${hour.toString().padStart(2, '0')}:${minute}`;
                        const count = meetingCountsByTime[timeOption] || 0;
                        // Determine badge color based on count
                        const badgeClass = count === 0 
                          ? 'badge badge-ghost' 
                          : count <= 2 
                          ? 'badge badge-success' 
                          : count <= 5 
                          ? 'badge badge-warning' 
                          : 'badge badge-error';
                        return (
                          <div
                            key={timeOption}
                            className="px-4 py-2 cursor-pointer hover:bg-gray-100 flex items-center justify-between"
                            onClick={() => {
                              setScheduleMeetingFormData(prev => ({ ...prev, time: timeOption }));
                              setShowTimeDropdown(false);
                            }}
                          >
                            <span>{timeOption}</span>
                            <span className={badgeClass}>{count}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Manager (Optional) */}
                <div className="relative" ref={managerDropdownRef}>
                  <label className="block font-semibold mb-1">Manager (Optional)</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    placeholder="Select a manager..."
                    value={scheduleMeetingFormData.manager}
                    onChange={(e) => {
                      const value = e.target.value;
                      setScheduleMeetingFormData(prev => ({ ...prev, manager: value }));
                      setManagerSearchTerm(value);
                      setShowManagerDropdown(true);
                    }}
                    onFocus={() => {
                      setManagerSearchTerm(scheduleMeetingFormData.manager || '');
                      setShowManagerDropdown(true);
                    }}
                    autoComplete="off"
                  />
                  {showManagerDropdown && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                      {(() => {
                        const searchTerm = (managerSearchTerm || scheduleMeetingFormData.manager || '').toLowerCase();
                        const filteredEmployees = allEmployees.filter(emp => {
                          return !searchTerm || emp.display_name.toLowerCase().includes(searchTerm);
                        });
                        
                        return filteredEmployees.length > 0 ? (
                          filteredEmployees.map(emp => {
                            const isUnavailable = scheduleMeetingFormData.date && scheduleMeetingFormData.time
                              ? isEmployeeUnavailable(emp.display_name, scheduleMeetingFormData.date, scheduleMeetingFormData.time)
                              : false;
                            return (
                              <div
                                key={emp.id}
                                className={`px-4 py-2 cursor-pointer flex items-center justify-between ${
                                  isUnavailable
                                    ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                    : 'hover:bg-gray-100'
                                }`}
                                onClick={() => {
                                  setScheduleMeetingFormData(prev => ({ ...prev, manager: emp.display_name }));
                                  setManagerSearchTerm('');
                                  setShowManagerDropdown(false);
                                }}
                              >
                                <span>{emp.display_name}</span>
                                {isUnavailable && (
                                  <div className="flex items-center gap-1">
                                    <ClockIcon className="w-4 h-4" />
                                    <span className="text-xs">Unavailable</span>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <div className="px-4 py-2 text-gray-500 text-center">
                            No employees found
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* Helper (Optional) */}
                <div className="relative" ref={helperDropdownRef}>
                  <label className="block font-semibold mb-1">Helper (Optional)</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    placeholder="Select a helper..."
                    value={scheduleMeetingFormData.helper}
                    onChange={(e) => {
                      const value = e.target.value;
                      setScheduleMeetingFormData(prev => ({ ...prev, helper: value }));
                      setHelperSearchTerm(value);
                      setShowHelperDropdown(true);
                    }}
                    onFocus={() => {
                      setHelperSearchTerm(scheduleMeetingFormData.helper || '');
                      setShowHelperDropdown(true);
                    }}
                    autoComplete="off"
                  />
                  {showHelperDropdown && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                      {(() => {
                        const searchTerm = (helperSearchTerm || scheduleMeetingFormData.helper || '').toLowerCase();
                        const filteredEmployees = allEmployees.filter(emp => {
                          return !searchTerm || emp.display_name.toLowerCase().includes(searchTerm);
                        });
                        
                        return filteredEmployees.length > 0 ? (
                          filteredEmployees.map(emp => {
                            const isUnavailable = scheduleMeetingFormData.date && scheduleMeetingFormData.time
                              ? isEmployeeUnavailable(emp.display_name, scheduleMeetingFormData.date, scheduleMeetingFormData.time)
                              : false;
                            return (
                              <div
                                key={emp.id}
                                className={`px-4 py-2 cursor-pointer flex items-center justify-between ${
                                  isUnavailable
                                    ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                    : 'hover:bg-gray-100'
                                }`}
                                onClick={() => {
                                  setScheduleMeetingFormData(prev => ({ ...prev, helper: emp.display_name }));
                                  setHelperSearchTerm('');
                                  setShowHelperDropdown(false);
                                }}
                              >
                                <span>{emp.display_name}</span>
                                {isUnavailable && (
                                  <div className="flex items-center gap-1">
                                    <ClockIcon className="w-4 h-4" />
                                    <span className="text-xs">Unavailable</span>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <div className="px-4 py-2 text-gray-500 text-center">
                            No employees found
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* Meeting Brief (Optional) */}
                <div>
                  <label htmlFor="meeting-brief" className="block font-semibold mb-1">Meeting Brief (Optional)</label>
                  <textarea
                    id="meeting-brief"
                    name="meeting-brief"
                    className="textarea textarea-bordered w-full min-h-[80px]"
                    value={scheduleMeetingFormData.brief}
                    onChange={(e) => setScheduleMeetingFormData(prev => ({ ...prev, brief: e.target.value }))}
                    placeholder="Brief description of the meeting topic..."
                  />
                </div>

                {/* Meeting Attendance Probability */}
                <div>
                  <label className="block font-semibold mb-1">Meeting Attendance Probability</label>
                  <select
                    className="select select-bordered w-full"
                    value={scheduleMeetingFormData.attendance_probability}
                    onChange={(e) => setScheduleMeetingFormData(prev => ({ ...prev, attendance_probability: e.target.value }))}
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Very High">Very High</option>
                  </select>
                </div>

                {/* Meeting Complexity */}
                <div>
                  <label className="block font-semibold mb-1">Meeting Complexity</label>
                  <select
                    className="select select-bordered w-full"
                    value={scheduleMeetingFormData.complexity}
                    onChange={(e) => setScheduleMeetingFormData(prev => ({ ...prev, complexity: e.target.value }))}
                  >
                    <option value="Simple">Simple</option>
                    <option value="Complex">Complex</option>
                  </select>
                </div>

                {/* Meeting Car Number */}
                <div>
                  <label htmlFor="car-number" className="block font-semibold mb-1">Meeting Car Number</label>
                  <input
                    id="car-number"
                    type="text"
                    className="input input-bordered w-full"
                    value={scheduleMeetingFormData.car_number}
                    onChange={(e) => setScheduleMeetingFormData(prev => ({ ...prev, car_number: e.target.value }))}
                    placeholder="Enter car number..."
                  />
                </div>
              </div>
            </div>
            
            {/* Fixed Footer */}
            <div className="p-8 pt-4 border-t border-base-300 bg-base-100">
              <div className="flex justify-end">
                <button 
                  className="btn btn-primary px-8" 
                  onClick={handleScheduleMeetingFromDrawer}
                  disabled={!scheduleMeetingFormData.date || !scheduleMeetingFormData.time || isSchedulingMeeting}
                >
                  {isSchedulingMeeting ? (
                    <>
                      <span className="loading loading-spinner loading-sm"></span>
                      Creating Meeting...
                    </>
                  ) : (
                    'Create Meeting'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule Meeting Drawer */}
      {showRescheduleDrawer && (
        <div className="fixed inset-0 z-50 flex">
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black/30"
            onClick={() => {
              setShowRescheduleDrawer(false);
              setMeetingToDelete(null);
              setRescheduleFormData({
                date: '',
                time: '09:00',
                location: 'Teams',
                calendar: 'active_client',
                manager: '',
                helper: '',
                brief: '',
                attendance_probability: 'Medium',
                complexity: 'Simple',
                car_number: '',
              });
              setRescheduleOption('cancel');
            }}
          />
          {/* Panel */}
          <div className="ml-auto w-full max-w-md bg-base-100 h-screen shadow-2xl flex flex-col animate-slideInRight z-50">
            {/* Fixed Header */}
            <div className="flex items-center justify-between p-8 pb-4 border-b border-base-300">
              <h3 className="text-2xl font-bold">Reschedule Meeting</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => {
                setShowRescheduleDrawer(false);
                setMeetingToDelete(null);
                setRescheduleFormData({
                  date: '',
                  time: '09:00',
                  location: 'Teams',
                  calendar: 'active_client',
                  manager: '',
                  helper: '',
                  brief: '',
                  attendance_probability: 'Medium',
                  complexity: 'Simple',
                  car_number: '',
                });
                setRescheduleOption('cancel');
              }}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-8 pt-4">
              <div className="flex flex-col gap-4">
                {/* Select Meeting */}
                {rescheduleMeetings.length > 0 && (
                  <div>
                    <label className="block font-semibold mb-1">
                      Select Meeting {rescheduleOption === 'reschedule' ? '(Optional)' : ''}
                    </label>
                    <select
                      className="select select-bordered w-full"
                      value={meetingToDelete || ''}
                      onChange={(e) => {
                        const meetingId = e.target.value ? parseInt(e.target.value) : null;
                        setMeetingToDelete(meetingId);
                        // Pre-fill form with selected meeting data
                        const selectedMeeting = rescheduleMeetings.find(m => m.id === meetingId);
                        if (selectedMeeting) {
                          setRescheduleFormData({
                            date: selectedMeeting.meeting_date || getTomorrowDate(),
                            time: selectedMeeting.meeting_time ? selectedMeeting.meeting_time.substring(0, 5) : '09:00',
                            location: selectedMeeting.meeting_location || 'Teams',
                            calendar: 'active_client',
                            manager: selectedMeeting.meeting_manager || '',
                            helper: selectedMeeting.helper || '',
                            brief: selectedMeeting.meeting_brief || '',
                            attendance_probability: selectedMeeting.attendance_probability || 'Medium',
                            complexity: selectedMeeting.complexity || 'Simple',
                            car_number: selectedMeeting.car_number || '',
                          });
                        }
                      }}
                      required={rescheduleOption === 'cancel'}
                    >
                      <option value="">Select a meeting...</option>
                      {rescheduleMeetings.map((meeting) => (
                        <option key={meeting.id} value={meeting.id}>
                          {meeting.meeting_date} {meeting.meeting_time ? meeting.meeting_time.substring(0, 5) : ''} - {meeting.meeting_location || 'Teams'}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Reschedule Options */}
                <div>
                  <label className="block font-semibold mb-2">Action</label>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      className={`btn flex-1 ${rescheduleOption === 'cancel' ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => setRescheduleOption('cancel')}
                    >
                      Cancel Meeting
                    </button>
                    <button
                      type="button"
                      className={`btn flex-1 ${rescheduleOption === 'reschedule' ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => setRescheduleOption('reschedule')}
                    >
                      Reschedule Meeting
                    </button>
                  </div>
                  <p className="text-sm text-gray-500 mt-2">
                    {rescheduleOption === 'cancel' 
                      ? 'Cancel the meeting and send cancellation email to client.'
                      : 'Cancel the previous meeting and create a new one. Client will be notified of both actions.'}
                  </p>
                </div>

                {/* Form fields - only show when reschedule option is selected */}
                {rescheduleOption === 'reschedule' && (
                  <>
                    {/* Location */}
                    <div>
                      <label className="block font-semibold mb-1">Location</label>
                      <select
                        className="select select-bordered w-full"
                        value={rescheduleFormData.location}
                        onChange={(e) => setRescheduleFormData((prev: any) => ({ ...prev, location: e.target.value }))}
                      >
                        {allMeetingLocations.map((location) => (
                          <option key={location.id} value={location.name}>
                            {location.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Calendar */}
                    <div>
                      <label className="block font-semibold mb-1">Calendar</label>
                      <select
                        className="select select-bordered w-full"
                        value={rescheduleFormData.calendar}
                        onChange={(e) => setRescheduleFormData((prev: any) => ({ ...prev, calendar: e.target.value }))}
                      >
                        <option value="active_client">Active Client</option>
                      </select>
                    </div>

                    {/* Date */}
                    <div>
                      <label className="block font-semibold mb-1">New Date</label>
                      <input
                        type="date"
                        className="input input-bordered w-full"
                        value={rescheduleFormData.date}
                        onChange={(e) => setRescheduleFormData((prev: any) => ({ ...prev, date: e.target.value }))}
                        required
                        min={new Date().toISOString().split('T')[0]}
                      />
                    </div>

                    {/* Time */}
                    <div>
                      <label className="block font-semibold mb-1">New Time</label>
                      <select
                        className="select select-bordered w-full"
                        value={rescheduleFormData.time}
                        onChange={(e) => setRescheduleFormData((prev: any) => ({ ...prev, time: e.target.value }))}
                        required
                      >
                        {Array.from({ length: 32 }, (_, i) => {
                          const hour = Math.floor(i / 2) + 8; // Start from 8:00
                          const minute = i % 2 === 0 ? '00' : '30';
                          const timeOption = `${hour.toString().padStart(2, '0')}:${minute}`;
                          return (
                            <option key={timeOption} value={timeOption}>
                              {timeOption}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    {/* Manager (Optional) */}
                    <div className="relative" ref={managerDropdownRef}>
                      <label className="block font-semibold mb-1">Manager (Optional)</label>
                      <input
                        type="text"
                        className="input input-bordered w-full"
                        placeholder="Select a manager..."
                        value={rescheduleFormData.manager}
                        onChange={(e) => {
                          const value = e.target.value;
                          setRescheduleFormData((prev: any) => ({ ...prev, manager: value }));
                          setManagerSearchTerm(value);
                          setShowManagerDropdown(true);
                        }}
                        onFocus={() => {
                          setManagerSearchTerm(rescheduleFormData.manager || '');
                          setShowManagerDropdown(true);
                        }}
                        autoComplete="off"
                      />
                      {showManagerDropdown && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                          {(() => {
                            const searchTerm = (managerSearchTerm || rescheduleFormData.manager || '').toLowerCase();
                            const filteredEmployees = allEmployees.filter(emp => {
                              return !searchTerm || emp.display_name.toLowerCase().includes(searchTerm);
                            });
                            
                            return filteredEmployees.length > 0 ? (
                              filteredEmployees.map(emp => {
                                const isUnavailable = rescheduleFormData.date && rescheduleFormData.time
                                  ? isEmployeeUnavailable(emp.display_name, rescheduleFormData.date, rescheduleFormData.time)
                                  : false;
                                return (
                                  <div
                                    key={emp.id}
                                    className={`px-4 py-2 cursor-pointer flex items-center justify-between ${
                                      isUnavailable
                                        ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                        : 'hover:bg-gray-100'
                                    }`}
                                    onClick={() => {
                                      setRescheduleFormData((prev: any) => ({ ...prev, manager: emp.display_name }));
                                      setManagerSearchTerm('');
                                      setShowManagerDropdown(false);
                                    }}
                                  >
                                    <span>{emp.display_name}</span>
                                    {isUnavailable && (
                                      <div className="flex items-center gap-1">
                                        <ClockIcon className="w-4 h-4" />
                                        <span className="text-xs">Unavailable</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            ) : (
                              <div className="px-4 py-2 text-gray-500 text-center">
                                No employees found
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>

                    {/* Helper (Optional) */}
                    <div className="relative" ref={helperDropdownRef}>
                      <label className="block font-semibold mb-1">Helper (Optional)</label>
                      <input
                        type="text"
                        className="input input-bordered w-full"
                        placeholder="Select a helper..."
                        value={rescheduleFormData.helper}
                        onChange={(e) => {
                          const value = e.target.value;
                          setRescheduleFormData((prev: any) => ({ ...prev, helper: value }));
                          setHelperSearchTerm(value);
                          setShowHelperDropdown(true);
                        }}
                        onFocus={() => {
                          setHelperSearchTerm(rescheduleFormData.helper || '');
                          setShowHelperDropdown(true);
                        }}
                        autoComplete="off"
                      />
                      {showHelperDropdown && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                          {(() => {
                            const searchTerm = (helperSearchTerm || rescheduleFormData.helper || '').toLowerCase();
                            const filteredEmployees = allEmployees.filter(emp => {
                              return !searchTerm || emp.display_name.toLowerCase().includes(searchTerm);
                            });
                            
                            return filteredEmployees.length > 0 ? (
                              filteredEmployees.map(emp => {
                                const isUnavailable = rescheduleFormData.date && rescheduleFormData.time
                                  ? isEmployeeUnavailable(emp.display_name, rescheduleFormData.date, rescheduleFormData.time)
                                  : false;
                                return (
                                  <div
                                    key={emp.id}
                                    className={`px-4 py-2 cursor-pointer flex items-center justify-between ${
                                      isUnavailable
                                        ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                        : 'hover:bg-gray-100'
                                    }`}
                                    onClick={() => {
                                      setRescheduleFormData((prev: any) => ({ ...prev, helper: emp.display_name }));
                                      setHelperSearchTerm('');
                                      setShowHelperDropdown(false);
                                    }}
                                  >
                                    <span>{emp.display_name}</span>
                                    {isUnavailable && (
                                      <div className="flex items-center gap-1">
                                        <ClockIcon className="w-4 h-4" />
                                        <span className="text-xs">Unavailable</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            ) : (
                              <div className="px-4 py-2 text-gray-500 text-center">
                                No employees found
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>

                    {/* Meeting Brief (Optional) */}
                    <div>
                      <label htmlFor="reschedule-meeting-brief" className="block font-semibold mb-1">Meeting Brief (Optional)</label>
                      <textarea
                        id="reschedule-meeting-brief"
                        name="reschedule-meeting-brief"
                        className="textarea textarea-bordered w-full min-h-[80px]"
                        value={rescheduleFormData.brief}
                        onChange={(e) => setRescheduleFormData((prev: any) => ({ ...prev, brief: e.target.value }))}
                        placeholder="Brief description of the meeting topic..."
                      />
                    </div>

                    {/* Meeting Attendance Probability */}
                    <div>
                      <label className="block font-semibold mb-1">Meeting Attendance Probability</label>
                      <select
                        className="select select-bordered w-full"
                        value={rescheduleFormData.attendance_probability}
                        onChange={(e) => setRescheduleFormData((prev: any) => ({ ...prev, attendance_probability: e.target.value }))}
                      >
                        <option value="Low">Low</option>
                        <option value="Medium">Medium</option>
                        <option value="High">High</option>
                        <option value="Very High">Very High</option>
                      </select>
                    </div>

                    {/* Meeting Complexity */}
                    <div>
                      <label className="block font-semibold mb-1">Meeting Complexity</label>
                      <select
                        className="select select-bordered w-full"
                        value={rescheduleFormData.complexity}
                        onChange={(e) => setRescheduleFormData((prev: any) => ({ ...prev, complexity: e.target.value }))}
                      >
                        <option value="Simple">Simple</option>
                        <option value="Complex">Complex</option>
                      </select>
                    </div>

                    {/* Meeting Car Number */}
                    <div>
                      <label htmlFor="reschedule-car-number" className="block font-semibold mb-1">Meeting Car Number</label>
                      <input
                        id="reschedule-car-number"
                        type="text"
                        className="input input-bordered w-full"
                        value={rescheduleFormData.car_number}
                        onChange={(e) => setRescheduleFormData((prev: any) => ({ ...prev, car_number: e.target.value }))}
                        placeholder="Enter car number..."
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Fixed Footer */}
            <div className="p-8 pt-4 border-t border-base-300 bg-base-100">
              <div className="flex justify-end gap-3">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setShowRescheduleDrawer(false);
                    setMeetingToDelete(null);
                    setRescheduleFormData({
                      date: '',
                      time: '09:00',
                      location: 'Teams',
                      calendar: 'active_client',
                      manager: '',
                      helper: '',
                      brief: '',
                      attendance_probability: 'Medium',
                      complexity: 'Simple',
                      car_number: '',
                    });
                    setRescheduleOption('cancel');
                  }}
                >
                  Cancel
                </button>
                {rescheduleOption === 'cancel' ? (
                  <button
                    className="btn btn-primary px-8"
                    onClick={handleCancelMeeting}
                    disabled={!meetingToDelete || isReschedulingMeeting}
                  >
                    {isReschedulingMeeting ? (
                      <>
                        <span className="loading loading-spinner loading-sm"></span>
                        Canceling...
                      </>
                    ) : (
                      'Cancel Meeting'
                    )}
                  </button>
                ) : (
                  <button
                    className="btn btn-primary px-8"
                    onClick={handleRescheduleMeeting}
                    disabled={!rescheduleFormData.date || !rescheduleFormData.time || isReschedulingMeeting}
                  >
                    {isReschedulingMeeting ? (
                      <>
                        <span className="loading loading-spinner loading-sm"></span>
                        Rescheduling...
                      </>
                    ) : (
                      'Reschedule Meeting'
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MeetingTab; 