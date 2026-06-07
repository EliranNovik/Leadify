import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { ClientTabProps } from '../../types/client';
import { useRealtimeRefresh, type RealtimeChangePayload } from '../../hooks/useRealtimeRefresh';
import {
  clearPendingMeetingRescheduleDrawer,
  clearPendingMeetingScheduleDrawer,
  consumePendingMeetingDrawers,
  CUSTOM_ADDRESS_LOCATION_ID,
  CUSTOM_LINK_LOCATION_ID,
  isMeetingLocationActive,
  isPhysicalMeetingLocation,
  normalizeMeetingLocationRow,
  pickTenantMeetingLocationAddress,
  preferEnglishMeetingTemplateLanguage,
  shouldIncludeMeetingJoinLink,
} from '../../lib/meetingLocationUtils';
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
  ChevronRightIcon,
  DocumentTextIcon,
  AcademicCapIcon,
  ArrowPathIcon,
  PencilIcon,
} from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import { SiZoom } from 'react-icons/si';
import { supabase } from '../../lib/supabase';
import { fetchLeadContacts, ContactInfo } from '../../lib/contactHelpers';
import {
  fetchEmailTemplatesAutomationCache,
  fetchMiscEmailTemplatesByIds,
  inferInvitationEmailTypeFromLocationName,
  isStaffOrInternalMeeting,
  resolveMeetingEmailTemplateIdsForNotify,
  resolveMeetingLocationId,
  type EmailAutomationCache,
} from '../../lib/emailTemplatesAutomation';
import { buildApiUrl } from '../../lib/api';
import { useAuthContext } from '../../contexts/AuthContext';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { loginRequest } from '../../msalConfig';
import { createTeamsMeeting, sendEmail, createCalendarEventWithAttendee, getAccessTokenWithFallback, AuthPopupBlockedError, triggerTokenRedirect, createStaffCalendarEvent, createStaffTeamsMeeting } from '../../lib/graph';
import { saveOutlookTeamsMeeting, type OutlookTeamsMeeting } from '../../lib/outlookTeamsMeetingsApi';
import { generateICSFromDateTime } from '../../lib/icsGenerator';
import { meetingInvitationEmailTemplate } from '../Meetings';
import MeetingSummaryComponent from '../MeetingSummary';
import MeetingSummaryNotesModal from './MeetingSummaryNotesModal';
import { replaceEmailTemplateParams, replaceEmailTemplateParamsSync } from '../../lib/emailTemplateParams';
import { saveOutgoingEmailRecord } from '../../lib/saveOutgoingEmailRecord';
import {
  fetchInternalMeetingWhatsAppTemplateNames,
  fillWhatsAppTemplateContent,
  generateMeetingWhatsAppTemplateParameters,
  selectReminderWhatsAppTemplate,
} from '../../lib/meetingWhatsAppNotify';
import TimePicker from '../TimePicker';

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
  car_number?: string;
  custom_link?: string;
  custom_address?: string;
  /** Free-text address for notifications/templates; independent of location type. */
  manual_address?: string | null;
  /** Staff-written summary from Meeting summary modal. */
  meeting_summary_notes?: string | null;
  isLegacy?: boolean;
  calendar_type?: string;
  /** Subject line for staff / IM meetings (`meetings.meeting_subject`). */
  meeting_subject?: string;
  /** Guest participants stored as employee ids on `meetings.extern1` / `meetings.extern2`. */
  extern1?: string | null;
  extern2?: string | null;
  lastEdited: {
    timestamp: string;
    user: string;
  };
}

type MeetingParticipantRow = {
  id: string;
  type: 'staff' | 'firm' | 'extern';
  badge: string;
  name: string;
  subtitle?: string | null;
  imageUrl?: string | null;
  employeeId?: number;
};

type NotifyRecipientSource = 'lead' | 'staff' | 'firm' | 'external';

type NotifyRecipient = ContactInfo & {
  recipientKey: string;
  source: NotifyRecipientSource;
  sourceLabel: string;
  imageUrl?: string | null;
  employeeId?: number;
  subtitle?: string | null;
};

const normalizeContactInfoForDedup = (c: Partial<ContactInfo>) => {
  const normalizePhone = (phone: string | null | undefined) =>
    phone?.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '') || '';
  return {
    name: (c.name || '').toLowerCase().trim(),
    email: (c.email || '').toLowerCase().trim(),
    phone: normalizePhone(c.phone || c.mobile),
  };
};

const contactsMatchForDedup = (c1: ContactInfo, c2: ContactInfo): boolean => {
  const n1 = normalizeContactInfoForDedup(c1);
  const n2 = normalizeContactInfoForDedup(c2);

  if (n1.email && n2.email && n1.email === n2.email) return true;
  if (n1.phone && n2.phone && n1.phone === n2.phone) return true;
  if (n1.name && n2.name && n1.name === n2.name) {
    if (
      (n1.email && n2.email && n1.email === n2.email) ||
      (n1.phone && n2.phone && n1.phone === n2.phone)
    ) {
      return true;
    }
  }
  return false;
};

function mergeNotifyRecipients(leadContacts: NotifyRecipient[], participantContacts: NotifyRecipient[]): NotifyRecipient[] {
  const result = [...leadContacts];
  for (const contact of participantContacts) {
    if (result.some((c) => c.recipientKey === contact.recipientKey)) continue;
    const duplicateParticipant = result
      .filter((c) => c.source !== 'lead')
      .some((c) => contactsMatchForDedup(c, contact));
    if (duplicateParticipant) continue;
    result.push(contact);
  }
  return result;
}

function getNotifySourceBadgeClass(source: NotifyRecipientSource): string {
  switch (source) {
    case 'staff':
      return 'bg-blue-100 text-blue-700';
    case 'firm':
      return 'bg-amber-100 text-amber-800';
    case 'external':
      return 'bg-gray-100 text-gray-700';
    default:
      return 'bg-purple-100 text-purple-700';
  }
}

function getNotifyRecipientPhone(contact: NotifyRecipient): string | null {
  const mobile = contact.mobile?.trim();
  const phone = contact.phone?.trim();

  // Staff WhatsApp must use mobile only — desk phone + extension breaks delivery.
  if (contact.source === 'staff') {
    if (mobile && mobile !== '' && mobile !== '---') return mobile;
    return null;
  }

  if (phone && phone !== '' && phone !== '---') return phone;
  if (mobile && mobile !== '' && mobile !== '---') return mobile;
  return null;
}

function getMeetingDbId(meeting: { id: number | string }): number | null {
  const id = typeof meeting.id === 'number' ? meeting.id : Number(meeting.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function fetchMeetingParticipantContacts(meetingId: number): Promise<NotifyRecipient[]> {
  const { data: partData, error: partErr } = await supabase
    .from('meeting_participants')
    .select('id, employee_id, firm_contact_id, free_name, free_email, free_phone')
    .eq('meeting_id', meetingId);
  if (partErr || !partData?.length) return [];

  const employeeIds = Array.from(
    new Set(
      partData
        .map((r: any) => (r.employee_id != null ? Number(r.employee_id) : null))
        .filter((n: any) => Number.isFinite(n) && n > 0)
    )
  ) as number[];
  const firmIds = Array.from(
    new Set(
      partData
        .map((r: any) => (r.firm_contact_id ? String(r.firm_contact_id) : null))
        .filter(Boolean)
    )
  ) as string[];

  const fetchEmployeesWithPhones = async () => {
    if (!employeeIds.length) return { data: [] as any[] };
    const res = await supabase
      .from('tenants_employee')
      .select('id, display_name, photo_url, photo, phone, mobile, phone_ext')
      .in('id', employeeIds);
    if (!res.error) return res;
    if ((res.error as any)?.code === '42703') {
      return supabase.from('tenants_employee').select('id, display_name, photo_url, photo').in('id', employeeIds);
    }
    return res;
  };

  const [empsRes, usersRes, firmsRes] = await Promise.all([
    fetchEmployeesWithPhones(),
    employeeIds.length
      ? supabase.from('users').select('employee_id, email').in('employee_id', employeeIds).not('email', 'is', null)
      : Promise.resolve({ data: [] as any[] }),
    firmIds.length
      ? supabase
          .from('firm_contacts')
          .select('id, name, email, second_email, user_email, phone, profile_image_url, firm_id, firms!firm_contacts_firm_id_fkey(id, name)')
          .in('id', firmIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const empById = new Map<number, any>();
  (empsRes as any).data?.forEach((e: any) => empById.set(Number(e.id), e));
  const emailByEmployeeId = new Map<number, string>();
  (usersRes as any).data?.forEach((u: any) => {
    const eid = Number(u.employee_id);
    if (Number.isFinite(eid) && eid > 0 && u.email) emailByEmployeeId.set(eid, String(u.email));
  });
  const firmById = new Map<string, any>();
  (firmsRes as any).data?.forEach((f: any) => firmById.set(String(f.id), f));

  let nextSyntheticId = -4000000;
  const allocId = (rowId: unknown): number => {
    if (rowId != null && /^\d+$/.test(String(rowId))) return -Number(rowId);
    return nextSyntheticId--;
  };

  const recipients: NotifyRecipient[] = [];

  for (const r of partData) {
    const rowKey = r.id != null ? String(r.id) : `idx-${recipients.length}`;

    if (r.employee_id != null) {
      const empId = Number(r.employee_id);
      const e = empById.get(empId);
      recipients.push({
        id: allocId(r.id),
        recipientKey: `staff-${rowKey}`,
        name: e?.display_name || `Staff #${empId}`,
        email: emailByEmployeeId.get(empId) || null,
        phone: e?.phone ? String(e.phone) : null,
        mobile: e?.mobile ? String(e.mobile) : null,
        country_id: null,
        isMain: false,
        source: 'staff',
        sourceLabel: 'Staff',
        imageUrl: e?.photo_url || e?.photo || null,
        employeeId: empId,
      });
    } else if (r.firm_contact_id) {
      const f = firmById.get(String(r.firm_contact_id));
      const firmObj = Array.isArray(f?.firms) ? f.firms[0] : f?.firms;
      const email = f?.email || f?.second_email || f?.user_email || null;
      recipients.push({
        id: allocId(r.id),
        recipientKey: `firm-${rowKey}`,
        name: f?.name || 'Firm contact',
        email: email ? String(email) : null,
        phone: f?.phone ? String(f.phone) : null,
        mobile: null,
        country_id: null,
        isMain: false,
        source: 'firm',
        sourceLabel: 'Firm Contact',
        imageUrl: f?.profile_image_url || null,
        subtitle: firmObj?.name ? String(firmObj.name) : null,
      });
    } else {
      const name = String(r.free_name || '').trim() || 'External participant';
      recipients.push({
        id: allocId(r.id),
        recipientKey: `ext-${rowKey}`,
        name,
        email: r.free_email ? String(r.free_email) : null,
        phone: r.free_phone ? String(r.free_phone) : null,
        mobile: null,
        country_id: null,
        isMain: false,
        source: 'external',
        sourceLabel: 'External',
      });
    }
  }

  return recipients;
}

/**
 * Wrap bare http(s) and mailto URLs in anchor tags for outgoing HTML emails.
 * Preserves existing <a>...</a> blocks and skips URLs inside HTML tags (e.g. href/src attributes).
 */
function linkifyPlainUrlsInEmailHtml(html: string): string {
  if (!html) return html;
  if (!/\bhttps?:\/\//i.test(html) && !/\bmailto:/i.test(html)) return html;

  const preserved: string[] = [];
  let s = html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (block) => {
    const i = preserved.length;
    preserved.push(block);
    return `@@MEETINGTAB_LINKIFY_A_${i}@@`;
  });

  const parts = s.split(/(<[^>]+>)/g);
  s = parts
    .map((part) => {
      if (!part || part.startsWith('<')) return part;
      return part.replace(
        /\b(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+)/gi,
        (url) => {
          const safeHref = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
          return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        }
      );
    })
    .join('');

  preserved.forEach((block, i) => {
    s = s.replace(`@@MEETINGTAB_LINKIFY_A_${i}@@`, block);
  });

  return s;
}

function OutlookIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#0078D4" d="M22 6.5v11c0 .83-.67 1.5-1.5 1.5H17V5h3.5c.83 0 1.5.67 1.5 1.5z" />
      <path fill="#0078D4" d="M16 5H4.5C3.67 5 3 5.67 3 6.5v11c0 .83.67 1.5 1.5 1.5H16V5z" />
      <path fill="#28A8EA" d="M15 12.5 8.5 7.25v10.5L15 12.5z" />
      <ellipse fill="#0078D4" cx="9.5" cy="12.5" rx="3.5" ry="4" />
    </svg>
  );
}

const MeetingTab: React.FC<ClientTabProps> = ({ client, onClientUpdate }) => {
  const { instance } = useMsal();

  // Holds the latest silent meetings reload so the realtime subscription can call it regardless of
  // where fetchMeetings is declared below.
  const fetchMeetingsRef = useRef<(() => Promise<void> | void) | null>(null);

  // Live updates: when a meeting for this lead is created/edited/cancelled anywhere, refresh the
  // meetings list in place instead of reloading the page. Cached meetings render instantly.
  useRealtimeRefresh({
    channelName: `meeting-tab-${client?.id ?? 'none'}`,
    enabled: !!client?.id,
    tables: (() => {
      const leadIdRaw = String(client?.id ?? '');
      const leadIdStripped = leadIdRaw.replace(/^legacy_/, '').toLowerCase();
      const matchLead = (payload: RealtimeChangePayload) => {
        const row = payload?.new ?? payload?.old;
        if (!row) return true;
        const r = row as Record<string, unknown>;
        const candidates = [r.client_id, r.legacy_lead_id, r.lead_id];
        if (candidates.every((c) => c == null)) return true;
        return candidates.some((c) => {
          if (c == null) return false;
          const s = String(c).toLowerCase();
          return s === leadIdStripped || s === leadIdRaw.toLowerCase();
        });
      };
      return [{ table: 'meetings', event: '*' as const, match: matchLead }];
    })(),
    onChange: () => {
      void fetchMeetingsRef.current?.();
    },
  });

  const [showAuthRedirectOption, setShowAuthRedirectOption] = useState(false);
  const authRedirectParamsRef = useRef<{ request: any; account: any } | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [meetingParticipantsById, setMeetingParticipantsById] = useState<
    Record<number, { loading: boolean; participants: MeetingParticipantRow[] }>
  >({});
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [isCreatingMeeting, setIsCreatingMeeting] = useState(false);
  const [showScheduleDrawer, setShowScheduleDrawer] = useState(false);
  const [sendingEmailMeetingId, setSendingEmailMeetingId] = useState<number | null>(null);
  const [editingBriefId, setEditingBriefId] = useState<number | null>(null);
  const [editedBrief, setEditedBrief] = useState<string>('');
  const [summaryNotesMeeting, setSummaryNotesMeeting] = useState<Meeting | null>(null);
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
  const [showCustomLocationModal, setShowCustomLocationModal] = useState(false);
  const [customLocationMode, setCustomLocationMode] = useState<'link' | 'address'>('link');
  const [customLocationTarget, setCustomLocationTarget] = useState<'schedule' | 'reschedule' | 'edit'>('schedule');
  const [customLocationDraft, setCustomLocationDraft] = useState('');
  const [isUpdatingMeeting, setIsUpdatingMeeting] = useState(false);
  const [showEditLocationDropdown, setShowEditLocationDropdown] = useState(false);
  const [showEditManagerDropdown, setShowEditManagerDropdown] = useState(false);
  const [showEditSchedulerDropdown, setShowEditSchedulerDropdown] = useState(false);
  const [showEditHelperDropdown, setShowEditHelperDropdown] = useState(false);
  const [editLocationSearchTerm, setEditLocationSearchTerm] = useState('');
  const [editManagerSearchTerm, setEditManagerSearchTerm] = useState('');
  const [editSchedulerSearchTerm, setEditSchedulerSearchTerm] = useState('');
  const [editHelperSearchTerm, setEditHelperSearchTerm] = useState('');
  const editLocationDropdownRef = useRef<HTMLDivElement>(null);
  const editManagerDropdownRef = useRef<HTMLDivElement>(null);
  const editSchedulerDropdownRef = useRef<HTMLDivElement>(null);
  const editHelperDropdownRef = useRef<HTMLDivElement>(null);


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
  const [showPastMeetingsPanel, setShowPastMeetingsPanel] = useState(false);

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
  const [employeeEmailToDisplayName, setEmployeeEmailToDisplayName] = useState<Record<string, string>>({});
  const [allMeetingLocations, setAllMeetingLocations] = useState<any[]>([]);
  const [emailAutomationCache, setEmailAutomationCache] = useState<EmailAutomationCache | null>(null);
  const selectableMeetingLocations = useMemo(
    () => allMeetingLocations.filter(isMeetingLocationActive),
    [allMeetingLocations]
  );
  const scheduleDrawerInitializedRef = useRef(false);

  // Notify modal state
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [selectedMeetingForNotify, setSelectedMeetingForNotify] = useState<Meeting | null>(null);
  const [contacts, setContacts] = useState<NotifyRecipient[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [selectedEmailRecipientKeys, setSelectedEmailRecipientKeys] = useState<Set<string>>(new Set());
  const [selectedEmailLanguage, setSelectedEmailLanguage] = useState<'en' | 'he'>('en');
  const [emailTemplates, setEmailTemplates] = useState<{
    en: { content: string | null; name: string | null } | null;
    he: { content: string | null; name: string | null } | null
  }>({ en: null, he: null });

  // Store template IDs for fetching names later
  const [emailTemplateIds, setEmailTemplateIds] = useState<{ en: number | null; he: number | null }>({ en: null, he: null });
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
  const [whatsAppContacts, setWhatsAppContacts] = useState<NotifyRecipient[]>([]);
  const [loadingWhatsAppContacts, setLoadingWhatsAppContacts] = useState(false);
  const [selectedWhatsAppRecipientKeys, setSelectedWhatsAppRecipientKeys] = useState<Set<string>>(new Set());
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
    custom_link: '',
    custom_address: '',
  });
  const [isSchedulingMeeting, setIsSchedulingMeeting] = useState(false);
  const [meetingCountsByTime, setMeetingCountsByTime] = useState<Record<string, number>>({});
  const [showManagerDropdown, setShowManagerDropdown] = useState(false);
  const managerDropdownRef = useRef<HTMLDivElement>(null);
  const [managerSearchTerm, setManagerSearchTerm] = useState('');

  // External (Internal-Meeting-with-external-participants) state
  // Mirrors CalendarPage's TeamsMeetingModal so users can convert this lead's
  // scheduled/rescheduled meeting into an internal meeting with external attendees.
  type FirmContactLite = { id: string; firm_id: string; name: string; email?: string | null; phone?: string | null };
  type FreeParticipant = { name: string; email?: string; phone?: string; notes?: string };
  type InternalMeetingTypeRow = { id: number; code: string; label: string; sort_order: number | null };
  const [firmContacts, setFirmContacts] = useState<FirmContactLite[]>([]);
  const [internalMeetingTypes, setInternalMeetingTypes] = useState<InternalMeetingTypeRow[]>([]);
  // Schedule drawer external state
  const [scheduleExternal, setScheduleExternal] = useState<{
    subject: string;
    internalMeetingTypeId: number | null;
    selectedStaffEmployeeIds: number[];
    selectedFirmContactIds: string[];
    freeParticipants: FreeParticipant[];
    freeDraft: FreeParticipant;
  }>({
    subject: '',
    internalMeetingTypeId: null,
    selectedStaffEmployeeIds: [],
    selectedFirmContactIds: [],
    freeParticipants: [],
    freeDraft: { name: '', email: '', phone: '', notes: '' },
  });
  const [scheduleStaffSearch, setScheduleStaffSearch] = useState('');
  const [showScheduleStaffDropdown, setShowScheduleStaffDropdown] = useState(false);
  const scheduleStaffDropdownRef = useRef<HTMLDivElement>(null);
  const [scheduleFirmContactSearch, setScheduleFirmContactSearch] = useState('');
  const [showScheduleFirmContactDropdown, setShowScheduleFirmContactDropdown] = useState(false);
  const scheduleFirmContactDropdownRef = useRef<HTMLDivElement>(null);
  // Reschedule drawer external state
  const [rescheduleExternal, setRescheduleExternal] = useState<{
    subject: string;
    internalMeetingTypeId: number | null;
    selectedStaffEmployeeIds: number[];
    selectedFirmContactIds: string[];
    freeParticipants: FreeParticipant[];
    freeDraft: FreeParticipant;
  }>({
    subject: '',
    internalMeetingTypeId: null,
    selectedStaffEmployeeIds: [],
    selectedFirmContactIds: [],
    freeParticipants: [],
    freeDraft: { name: '', email: '', phone: '', notes: '' },
  });
  const [rescheduleStaffSearch, setRescheduleStaffSearch] = useState('');
  const [showRescheduleStaffDropdown, setShowRescheduleStaffDropdown] = useState(false);
  const rescheduleStaffDropdownRef = useRef<HTMLDivElement>(null);
  const [rescheduleFirmContactSearch, setRescheduleFirmContactSearch] = useState('');
  const [showRescheduleFirmContactDropdown, setShowRescheduleFirmContactDropdown] = useState(false);
  const rescheduleFirmContactDropdownRef = useRef<HTMLDivElement>(null);

  // Inline edit: IM meeting participants + guest slots
  const [editExternal, setEditExternal] = useState<{
    subject: string;
    internalMeetingTypeId: number | null;
    selectedStaffEmployeeIds: number[];
    selectedFirmContactIds: string[];
    freeParticipants: FreeParticipant[];
    freeDraft: FreeParticipant;
  }>({
    subject: '',
    internalMeetingTypeId: null,
    selectedStaffEmployeeIds: [],
    selectedFirmContactIds: [],
    freeParticipants: [],
    freeDraft: { name: '', email: '', phone: '', notes: '' },
  });
  const [editStaffSearch, setEditStaffSearch] = useState('');
  const [showEditStaffDropdown, setShowEditStaffDropdown] = useState(false);
  const editStaffDropdownRef = useRef<HTMLDivElement>(null);
  const [editFirmContactSearch, setEditFirmContactSearch] = useState('');
  const [showEditFirmContactDropdown, setShowEditFirmContactDropdown] = useState(false);
  const editFirmContactDropdownRef = useRef<HTMLDivElement>(null);
  const [editGuest1SearchTerm, setEditGuest1SearchTerm] = useState('');
  const [editGuest2SearchTerm, setEditGuest2SearchTerm] = useState('');
  const [showEditGuest1Dropdown, setShowEditGuest1Dropdown] = useState(false);
  const [showEditGuest2Dropdown, setShowEditGuest2Dropdown] = useState(false);
  const editGuest1DropdownRef = useRef<HTMLDivElement>(null);
  const editGuest2DropdownRef = useRef<HTMLDivElement>(null);

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
    custom_link: '',
    custom_address: '',
  });
  const [meetingToDelete, setMeetingToDelete] = useState<number | null>(null);
  const [rescheduleOption, setRescheduleOption] = useState<'cancel' | 'reschedule'>('cancel');
  const [rescheduleMeetings, setRescheduleMeetings] = useState<any[]>([]);
  const [isReschedulingMeeting, setIsReschedulingMeeting] = useState(false);
  // Toggle for notifying client via email when scheduling a meeting
  const [notifyClientOnSchedule, setNotifyClientOnSchedule] = useState(false);
  // Toggle for notifying client via email when rescheduling a meeting
  const [notifyClientOnReschedule, setNotifyClientOnReschedule] = useState(false);

  // Helper function to get tomorrow's date
  const getTomorrowDate = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  };

  const isUnassignedEmployeeValue = (value: string | number | null | undefined): boolean => {
    if (value === null || value === undefined) return true;
    const s = String(value).trim();
    if (!s || s === '---' || s === '--') return true;
    const lower = s.toLowerCase();
    return lower === 'not assigned' || lower === 'unassigned';
  };

  // Helper function to get employee display name from ID
  const getEmployeeDisplayName = (employeeId: string | number | null | undefined) => {
    if (isUnassignedEmployeeValue(employeeId)) return '--';
    const value = String(employeeId);
    const employee = allEmployees.find((emp: any) => emp.id.toString() === value);
    return employee ? employee.display_name : value;
  };

  // Helper function to get employee by ID
  const getEmployeeById = (employeeId: string | number | null | undefined) => {
    if (isUnassignedEmployeeValue(employeeId)) return null;
    const value = String(employeeId).trim();
    const byId = allEmployees.find((emp: any) => emp.id.toString() === value);
    if (byId) return byId;
    return (
      allEmployees.find(
        (emp: any) => emp.display_name === value || emp.full_name === value
      ) || null
    );
  };

  const getLastEditedByDisplayName = (stored: string | null | undefined): string => {
    const raw = stored?.trim();
    if (!raw) return '--';
    if (raw.toLowerCase() === 'system') return 'System';

    const byDisplayName = allEmployees.find(
      (emp: any) => emp.display_name?.trim().toLowerCase() === raw.toLowerCase()
    );
    if (byDisplayName?.display_name) return byDisplayName.display_name;

    if (raw.includes('@')) {
      return employeeEmailToDisplayName[raw.toLowerCase()] || 'Staff';
    }

    return raw;
  };

  const resolveEditorDisplayName = async (): Promise<string> => {
    const account = instance.getAllAccounts()[0];
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser?.id) {
        const { data: userData } = await supabase
          .from('users')
          .select(`
            full_name,
            employee_id,
            tenants_employee!employee_id(
              display_name
            )
          `)
          .eq('auth_id', authUser.id)
          .maybeSingle();

        if (userData) {
          const employee = Array.isArray(userData.tenants_employee)
            ? userData.tenants_employee[0]
            : userData.tenants_employee;
          const name = employee?.display_name || userData.full_name;
          if (name?.trim()) return name.trim();
        }
      }

      const email = account?.username?.trim().toLowerCase();
      if (email && employeeEmailToDisplayName[email]) {
        return employeeEmailToDisplayName[email];
      }
    } catch {
      // fall through
    }

    return account?.name?.trim() || 'Staff';
  };

  // Pill badge label for the meeting type shown in the meeting card's top-right corner.
  const getCalendarTypeBadgeStyles = (calendarType?: string) => {
    if (!calendarType) return null;
    if (calendarType === 'staff') {
      return { label: 'IM' };
    }
    if (calendarType === 'active_client') {
      return { label: 'A' };
    }
    return { label: 'P' };
  };

  // Helper function to get employee initials
  const getEmployeeInitials = (name: string | null | undefined): string => {
    if (!name) return '--';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  // EmployeeAvatar component for edit form
  const EmployeeAvatar: React.FC<{
    employeeId: string | number | null | undefined;
    size?: 'sm' | 'md';
  }> = ({ employeeId, size = 'md' }) => {
    const [imageError, setImageError] = useState(false);
    const employee = getEmployeeById(employeeId);
    const sizeClasses = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-11 h-11 text-sm';

    if (!employee) {
      return (
        <div className={`${sizeClasses} rounded-full flex items-center justify-center bg-gray-200 text-gray-500 font-semibold flex-shrink-0`}>
          --
        </div>
      );
    }

    const photoUrl = employee.photo_url || employee.photo;
    const initials = getEmployeeInitials(employee.display_name);

    if (imageError || !photoUrl) {
      return (
        <div className={`${sizeClasses} rounded-full flex items-center justify-center bg-green-100 text-green-700 font-semibold flex-shrink-0`}>
          {initials}
        </div>
      );
    }

    return (
      <img
        src={photoUrl}
        alt={employee.display_name}
        className={`${sizeClasses} rounded-full object-cover flex-shrink-0`}
        onError={() => setImageError(true)}
        title={employee.display_name}
      />
    );
  };

  const getParticipantBadgeClass = (type: MeetingParticipantRow['type']) => {
    if (type === 'staff') return 'border-sky-200/70 bg-sky-50 text-sky-950/70';
    if (type === 'firm') return 'border-fuchsia-200/65 bg-fuchsia-50 text-fuchsia-950/70';
    return 'border-amber-200/70 bg-amber-50 text-amber-950/70';
  };

  const renderMeetingParticipantAvatar = (participant: MeetingParticipantRow) => {
    if (participant.type === 'staff' && participant.employeeId) {
      return <EmployeeAvatar employeeId={participant.employeeId} size="md" />;
    }

    const initials = getEmployeeInitials(participant.name);
    if (participant.imageUrl) {
      return (
        <img
          src={participant.imageUrl}
          alt={participant.name}
          className="w-11 h-11 rounded-full object-cover flex-shrink-0 ring-1 ring-gray-200"
          title={participant.name}
        />
      );
    }

    return (
      <div className="w-11 h-11 rounded-full flex items-center justify-center bg-gray-100 text-gray-600 font-semibold flex-shrink-0 ring-1 ring-gray-200 text-sm">
        {initials}
      </div>
    );
  };

  const NotifyRecipientAvatar: React.FC<{ contact: NotifyRecipient; size?: 'sm' | 'md' }> = ({ contact, size = 'sm' }) => {
    const [imageError, setImageError] = useState(false);
    const sizeClasses = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-11 h-11 text-sm';

    if (contact.source === 'staff' && contact.employeeId) {
      return <EmployeeAvatar employeeId={contact.employeeId} size={size} />;
    }

    const initials = getEmployeeInitials(contact.name);
    const avatarBgClass =
      contact.source === 'firm'
        ? 'bg-fuchsia-100 text-fuchsia-700'
        : contact.source === 'external'
          ? 'bg-amber-100 text-amber-700'
          : 'bg-purple-100 text-purple-700';

    if (contact.imageUrl && !imageError) {
      return (
        <img
          src={contact.imageUrl}
          alt={contact.name}
          className={`${sizeClasses} rounded-full object-cover flex-shrink-0 ring-1 ring-gray-200`}
          title={contact.name}
          onError={() => setImageError(true)}
        />
      );
    }

    return (
      <div className={`${sizeClasses} rounded-full flex items-center justify-center font-semibold flex-shrink-0 ring-1 ring-gray-200 ${avatarBgClass}`}>
        {initials}
      </div>
    );
  };

  const sortNotifyRecipients = (items: NotifyRecipient[]) => {
    const sourceOrder: Record<NotifyRecipientSource, number> = {
      staff: 0,
      firm: 1,
      external: 2,
      lead: 3,
    };
    return [...items].sort((a, b) => {
      const orderDiff = sourceOrder[a.source] - sourceOrder[b.source];
      if (orderDiff !== 0) return orderDiff;
      return a.name.localeCompare(b.name);
    });
  };

  // meetings.meeting_location is usually the location NAME (e.g. "TLV"), not the numeric id
  const resolveMeetingLocationRecord = (
    idOrName: string | number | null | undefined
  ): (typeof allMeetingLocations)[number] | undefined => {
    if (idOrName == null || idOrName === '' || idOrName === '---' || idOrName === 'Not specified') {
      return undefined;
    }
    const s = String(idOrName).trim();
    const byId = allMeetingLocations.find((loc: any) => String(loc.id) === s);
    if (byId) return byId;
    const byNameExact = allMeetingLocations.find(
      (loc: any) => loc.name != null && String(loc.name).trim() === s
    );
    if (byNameExact) return byNameExact;
    return allMeetingLocations.find(
      (loc: any) =>
        loc.name != null && String(loc.name).trim().toLowerCase() === s.toLowerCase()
    );
  };

  const getMeetingLocationName = (locationId: string | number | null | undefined) => {
    if (!locationId || locationId === '---' || locationId === 'Not specified') return 'Not specified';
    const location = resolveMeetingLocationRecord(locationId);
    return location?.name ?? String(locationId);
  };

  const resolveMeetingLocationTextForTemplate = (
    meeting: { location?: string | number | null; custom_address?: string | null },
    preferEnglish: boolean,
  ): string => {
    const custom = meeting.custom_address?.trim();
    if (custom) return custom;
    const locRow = resolveMeetingLocationRecord(meeting.location);
    const name = getMeetingLocationName(meeting.location);
    if (locRow && isPhysicalMeetingLocation(locRow)) {
      const addr = pickTenantMeetingLocationAddress(locRow, preferEnglish);
      if (addr) return addr;
    }
    return name;
  };

  const openCustomLocationModal = (
    target: 'schedule' | 'reschedule' | 'edit',
    mode: 'link' | 'address',
    currentValue: string
  ) => {
    setCustomLocationTarget(target);
    setCustomLocationMode(mode);
    setCustomLocationDraft(currentValue || '');
    setShowCustomLocationModal(true);
  };

  const handleMeetingLocationChange = (
    locationName: string,
    target: 'schedule' | 'reschedule'
  ) => {
    const selectedLocation = allMeetingLocations.find((loc: any) => loc.name === locationName);
    const locationId = Number(selectedLocation?.id);

    if (target === 'schedule') {
      setScheduleMeetingFormData((prev) => ({ ...prev, location: locationName }));
      if (locationId === CUSTOM_LINK_LOCATION_ID) {
        openCustomLocationModal('schedule', 'link', scheduleMeetingFormData.custom_link || '');
      } else if (locationId === CUSTOM_ADDRESS_LOCATION_ID) {
        openCustomLocationModal('schedule', 'address', scheduleMeetingFormData.custom_address || '');
      }
    } else {
      setRescheduleFormData((prev: any) => ({ ...prev, location: locationName }));
      if (locationId === CUSTOM_LINK_LOCATION_ID) {
        openCustomLocationModal('reschedule', 'link', rescheduleFormData.custom_link || '');
      } else if (locationId === CUSTOM_ADDRESS_LOCATION_ID) {
        openCustomLocationModal('reschedule', 'address', rescheduleFormData.custom_address || '');
      }
    }
  };

  const handleSaveCustomLocationValue = () => {
    const trimmed = customLocationDraft.trim();
    const key = customLocationMode === 'link' ? 'custom_link' : 'custom_address';
    if (customLocationTarget === 'schedule') {
      setScheduleMeetingFormData((prev) => ({ ...prev, [key]: trimmed }));
    } else if (customLocationTarget === 'reschedule') {
      setRescheduleFormData((prev: any) => ({ ...prev, [key]: trimmed }));
    } else {
      setEditedMeeting((prev) => ({ ...prev, [key]: trimmed }));
    }
    setShowCustomLocationModal(false);
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
      templateLanguage?: string | null;
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
        meetingLocationRaw: context.meeting
          ? String(context.meeting.location ?? '').trim() || null
          : null,
        meetingId: context.meeting?.id ?? null,
        meetingLink: context.meetingLink || null,
        meetingAddress: context.meeting
          ? (context.meeting.manual_address?.trim() || '')
          : undefined,
        templateLanguage: context.templateLanguage ?? null,
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

    // Make any remaining plain URLs clickable (templates often inject raw links via placeholders)
    htmlBody = linkifyPlainUrlsInEmailHtml(htmlBody);

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
        .select('id, display_name, bonuses_role, photo_url, photo')
        .order('display_name', { ascending: true });

      if (!error && data) {
        setAllEmployees(data);
      }

      const { data: userRows } = await supabase
        .from('users')
        .select('email, full_name, employee_id, tenants_employee!employee_id(display_name)')
        .not('email', 'is', null);

      const emailMap: Record<string, string> = {};
      (userRows || []).forEach((row: any) => {
        const email = row.email?.trim().toLowerCase();
        if (!email) return;
        const employee = Array.isArray(row.tenants_employee)
          ? row.tenants_employee[0]
          : row.tenants_employee;
        emailMap[email] = employee?.display_name || row.full_name || email;
      });
      setEmployeeEmailToDisplayName(emailMap);
    };

    const fetchMeetingLocations = async () => {
      const { data, error } = await supabase
        .from('tenants_meetinglocation')
        .select('id, name, default_link, address, address_en, order, is_active, is_physical_location')
        .order('order', { ascending: true });

      console.log('MeetingTab: Fetched meeting locations:', { data, error });

      if (!error && data) {
        setAllMeetingLocations(data.map((loc: any) => normalizeMeetingLocationRow(loc)));
      }
    };

    const fetchReminderTemplates = async () => {
      const { data, error } = await supabase
        .from('whatsapp_templates_v2')
        .select('id, name, language, content, params, param_mapping')
        .in('name', fetchInternalMeetingWhatsAppTemplateNames())
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
    void fetchEmailTemplatesAutomationCache().then(setEmailAutomationCache);
  }, []);

  // Set default location to Teams when meeting locations are loaded
  useEffect(() => {
    if (selectableMeetingLocations.length > 0 && !scheduleMeetingFormData.location) {
      const teamsLocation = selectableMeetingLocations.find(loc => loc.name === 'Teams') || selectableMeetingLocations[0];
      setScheduleMeetingFormData(prev => ({
        ...prev,
        location: teamsLocation.name,
      }));
    }
  }, [selectableMeetingLocations, scheduleMeetingFormData.location]);

  // Fetch meeting counts by time for the selected date (for both schedule drawer and edit form)
  useEffect(() => {
    const fetchMeetingCounts = async () => {
      const dateToUse =
        scheduleMeetingFormData.date || rescheduleFormData.date || editedMeeting.date;
      if (!dateToUse) {
        setMeetingCountsByTime({});
        return;
      }

      try {
        const { data: meetings, error } = await supabase
          .from('meetings')
          .select('meeting_time')
          .eq('meeting_date', dateToUse)
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
  }, [scheduleMeetingFormData.date, rescheduleFormData.date, editedMeeting.date]);

  // Handle click outside for dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (managerDropdownRef.current && !managerDropdownRef.current.contains(event.target as Node)) {
        setShowManagerDropdown(false);
      }
      if (editLocationDropdownRef.current && !editLocationDropdownRef.current.contains(event.target as Node)) {
        setShowEditLocationDropdown(false);
      }
      if (editManagerDropdownRef.current && !editManagerDropdownRef.current.contains(event.target as Node)) {
        setShowEditManagerDropdown(false);
      }
      if (editSchedulerDropdownRef.current && !editSchedulerDropdownRef.current.contains(event.target as Node)) {
        setShowEditSchedulerDropdown(false);
      }
      if (editHelperDropdownRef.current && !editHelperDropdownRef.current.contains(event.target as Node)) {
        setShowEditHelperDropdown(false);
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

  // Reset form once when the schedule drawer opens (not on every render / calendar change)
  useEffect(() => {
    if (!showScheduleDrawer) {
      scheduleDrawerInitializedRef.current = false;
      return;
    }
    if (scheduleDrawerInitializedRef.current) return;
    if (selectableMeetingLocations.length === 0) return;

    scheduleDrawerInitializedRef.current = true;
    const teamsLocation = selectableMeetingLocations.find(loc => loc.name === 'Teams') || selectableMeetingLocations[0];
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
      custom_link: '',
      custom_address: '',
    });
  }, [showScheduleDrawer, selectableMeetingLocations]);

  // Load firm_contacts + internal_meeting_types when schedule/reschedule drawers open
  // or when editing an IM (staff) meeting inline.
  useEffect(() => {
    const editingStaffMeeting = editingMeetingId != null && meetings.some(
      (m) => m.id === editingMeetingId && m.calendar_type === 'staff'
    );
    if (!showScheduleDrawer && !showRescheduleDrawer && !editingStaffMeeting) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ data: contactsData, error: contactsError }, { data: typesData, error: typesError }] = await Promise.all([
          supabase
            .from('firm_contacts')
            .select('id, firm_id, name, email, phone, is_active')
            .eq('is_active', true)
            .order('name', { ascending: true })
            .limit(500),
          supabase
            .from('internal_meeting_types')
            .select('id, code, label, sort_order')
            .order('sort_order', { ascending: true }),
        ]);
        if (cancelled) return;
        if (!contactsError && contactsData) {
          setFirmContacts(contactsData.map((c: any) => ({
            id: String(c.id),
            firm_id: String(c.firm_id),
            name: String(c.name),
            email: c.email ?? null,
            phone: c.phone ?? null,
          })));
        }
        if (!typesError && typesData) {
          const rows = (typesData || [])
            .map((r: any) => ({
              id: Number(r.id),
              code: String(r.code),
              label: String(r.label),
              sort_order: r.sort_order != null ? Number(r.sort_order) : null,
            }))
            .filter((r) => Number.isFinite(r.id));
          setInternalMeetingTypes(rows);
          const defaultType = rows.find((t) => t.code === 'staff') || rows[0] || null;
          setScheduleExternal((prev) => ({
            ...prev,
            internalMeetingTypeId: prev.internalMeetingTypeId ?? defaultType?.id ?? null,
          }));
          setRescheduleExternal((prev) => ({
            ...prev,
            internalMeetingTypeId: prev.internalMeetingTypeId ?? defaultType?.id ?? null,
          }));
        }
      } catch (e) {
        console.warn('MeetingTab: failed to load external-meeting lookups', e);
      }
    })();
    return () => { cancelled = true; };
  }, [showScheduleDrawer, showRescheduleDrawer, editingMeetingId, meetings]);

  // Allow the ClientHeader (top-left stage row) to open the Schedule / Reschedule
  // drawers via window events. Keeps drawer state local to MeetingTab where all
  // meeting-related state lives, including External Meeting support.
  useEffect(() => {
    const openSchedule = () => {
      clearPendingMeetingScheduleDrawer();
      setShowScheduleDrawer(true);
    };
    const openReschedule = () => {
      clearPendingMeetingRescheduleDrawer();
      setShowRescheduleDrawer(true);
    };
    window.addEventListener('meeting-tab:open-schedule-drawer', openSchedule);
    window.addEventListener('meeting-tab:open-reschedule-drawer', openReschedule);

    const pending = consumePendingMeetingDrawers();
    if (pending.schedule) setShowScheduleDrawer(true);
    if (pending.reschedule) setShowRescheduleDrawer(true);

    return () => {
      window.removeEventListener('meeting-tab:open-schedule-drawer', openSchedule);
      window.removeEventListener('meeting-tab:open-reschedule-drawer', openReschedule);
    };
  }, []);

  // Close staff/firm-contact dropdowns on outside click (Schedule + Reschedule).
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (scheduleStaffDropdownRef.current && !scheduleStaffDropdownRef.current.contains(target)) {
        setShowScheduleStaffDropdown(false);
      }
      if (scheduleFirmContactDropdownRef.current && !scheduleFirmContactDropdownRef.current.contains(target)) {
        setShowScheduleFirmContactDropdown(false);
      }
      if (rescheduleStaffDropdownRef.current && !rescheduleStaffDropdownRef.current.contains(target)) {
        setShowRescheduleStaffDropdown(false);
      }
      if (rescheduleFirmContactDropdownRef.current && !rescheduleFirmContactDropdownRef.current.contains(target)) {
        setShowRescheduleFirmContactDropdown(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

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
              calendar_type: 'active_client',
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
            link: m.custom_link || m.teams_meeting_url,
            status: m.status || 'scheduled',
            expert_notes: m.expert_notes,
            handler_notes: m.handler_notes,
            eligibility_status: m.eligibility_status,
            feasibility_notes: m.feasibility_notes,
            documents_link: m.documents_link,
            car_number: m.car_number,
            custom_link: m.custom_link,
            custom_address: m.custom_address,
            manual_address: m.manual_address ?? null,
            meeting_summary_notes: m.meeting_summary_notes ?? null,
            calendar_type: m.calendar_type || 'active_client',
            meeting_subject: m.meeting_subject || undefined,
            extern1: m.extern1 ?? null,
            extern2: m.extern2 ?? null,
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
            link: m.custom_link || m.teams_meeting_url,
            status: m.status || 'scheduled',
            expert_notes: m.expert_notes,
            handler_notes: m.handler_notes,
            eligibility_status: m.eligibility_status,
            feasibility_notes: m.feasibility_notes,
            documents_link: m.documents_link,
            car_number: m.car_number,
            custom_link: m.custom_link,
            custom_address: m.custom_address,
            manual_address: m.manual_address ?? null,
            meeting_summary_notes: m.meeting_summary_notes ?? null,
            calendar_type: m.calendar_type || 'active_client',
            meeting_subject: m.meeting_subject || undefined,
            extern1: m.extern1 ?? null,
            extern2: m.extern2 ?? null,
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
      // Legacy meetings coming from `leads_lead` should be treated as Potential Client meetings.
      // Don't invent additional meeting types beyond the existing ones.
      const normalizedMeetings = allMeetings.map((m: any) =>
        m?.isLegacy ? { ...m, calendar_type: 'potential_client' } : m
      );
      setMeetings(normalizedMeetings);

    } catch (error) {
      console.error('Error fetching meetings:', error);
      toast.error('Failed to load meetings.');
    }
  };
  // Expose the latest silent reload to the realtime subscription declared near the top.
  fetchMeetingsRef.current = fetchMeetings;

  const loadMeetingParticipants = useCallback(async (meetingId: number) => {
    setMeetingParticipantsById((prev) => ({
      ...prev,
      [meetingId]: { loading: true, participants: prev[meetingId]?.participants ?? [] },
    }));

    try {
      const { data: partData, error: partErr } = await supabase
        .from('meeting_participants')
        .select('id, employee_id, firm_contact_id, free_name, free_email, free_phone, notes')
        .eq('meeting_id', meetingId);
      if (partErr) throw partErr;

      const employeeIds = Array.from(
        new Set(
          (partData || [])
            .map((r: any) => (r.employee_id != null ? Number(r.employee_id) : null))
            .filter((n: any) => Number.isFinite(n) && n > 0)
        )
      ) as number[];
      const firmIds = Array.from(
        new Set(
          (partData || [])
            .map((r: any) => (r.firm_contact_id ? String(r.firm_contact_id) : null))
            .filter(Boolean)
        )
      ) as string[];

      const fetchEmployeesWithPhones = async () => {
        if (!employeeIds.length) return { data: [] as any[] };
        const res = await supabase
          .from('tenants_employee')
          .select('id, display_name, photo_url, photo, phone, mobile, phone_ext')
          .in('id', employeeIds);
        if (!res.error) return res;
        if ((res.error as any)?.code === '42703') {
          return supabase.from('tenants_employee').select('id, display_name, photo_url, photo').in('id', employeeIds);
        }
        return res;
      };

      const [empsRes, firmsRes] = await Promise.all([
        fetchEmployeesWithPhones(),
        firmIds.length
          ? supabase
              .from('firm_contacts')
              .select('id, name, profile_image_url, email, second_email, phone, notes, firm_id, firms!firm_contacts_firm_id_fkey(id, name)')
              .in('id', firmIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const empById = new Map<number, any>();
      (empsRes as any).data?.forEach((e: any) => empById.set(Number(e.id), e));
      const firmById = new Map<string, any>();
      (firmsRes as any).data?.forEach((f: any) => firmById.set(String(f.id), f));

      const rows: MeetingParticipantRow[] = (partData || []).map((r: any, idx: number) => {
        if (r.employee_id != null) {
          const e = empById.get(Number(r.employee_id));
          return {
            id: r.id != null ? String(r.id) : `staff-${idx}`,
            type: 'staff',
            badge: 'Staff',
            name: e?.display_name || `#${r.employee_id}`,
            imageUrl: e?.photo_url || e?.photo || null,
            employeeId: Number(r.employee_id),
          };
        }
        if (r.firm_contact_id) {
          const f = firmById.get(String(r.firm_contact_id));
          const firmObj = Array.isArray(f?.firms) ? f.firms[0] : f?.firms;
          return {
            id: r.id != null ? String(r.id) : `firm-${idx}`,
            type: 'firm',
            badge: 'Firm',
            name: f?.name || 'Firm contact',
            subtitle: firmObj?.name ? String(firmObj.name) : null,
            imageUrl: f?.profile_image_url || null,
          };
        }
        return {
          id: r.id != null ? String(r.id) : `extern-${idx}`,
          type: 'extern',
          badge: 'External',
          name: String(r.free_name || '').trim() || 'External participant',
        };
      });

      setMeetingParticipantsById((prev) => ({
        ...prev,
        [meetingId]: { loading: false, participants: rows },
      }));
    } catch (error) {
      console.error('Failed to load meeting participants', error);
      setMeetingParticipantsById((prev) => ({
        ...prev,
        [meetingId]: { loading: false, participants: [] },
      }));
    }
  }, []);

  useEffect(() => {
    const staffMeetingIds = meetings
      .filter((m) => m.calendar_type === 'staff' && typeof m.id === 'number')
      .map((m) => Number(m.id));
    staffMeetingIds.forEach((id) => {
      void loadMeetingParticipants(id);
    });
  }, [meetings, loadMeetingParticipants]);

  useEffect(() => {
    if (!showNotifyModal) {
      setSelectedEmailRecipientKeys(new Set());
      return;
    }
    const keys = contacts
      .filter((c) => c.email && c.email !== '---')
      .map((c) => c.recipientKey);
    if (keys.length === 0 && client.email) {
      keys.push('client-primary-email');
    }
    setSelectedEmailRecipientKeys(new Set(keys));
  }, [showNotifyModal, contacts, client.email]);

  useEffect(() => {
    if (!showWhatsAppNotifyModal) {
      setSelectedWhatsAppRecipientKeys(new Set());
      return;
    }
    const keys = whatsAppContacts
      .filter((c) => getNotifyRecipientPhone(c))
      .map((c) => c.recipientKey);
    if (keys.length === 0) {
      const clientPhone = client.phone?.trim();
      const clientMobile = client.mobile?.trim();
      const hasClientPhone =
        (clientPhone && clientPhone !== '' && clientPhone !== '---') ||
        (clientMobile && clientMobile !== '' && clientMobile !== '---');
      if (hasClientPhone) keys.push('client-primary-phone');
    }
    setSelectedWhatsAppRecipientKeys(new Set(keys));
  }, [showWhatsAppNotifyModal, whatsAppContacts, client.phone, client.mobile]);

  const toggleEmailRecipient = (recipientKey: string) => {
    setSelectedEmailRecipientKeys((prev) => {
      const next = new Set(prev);
      if (next.has(recipientKey)) next.delete(recipientKey);
      else next.add(recipientKey);
      return next;
    });
  };

  const toggleWhatsAppRecipient = (recipientKey: string) => {
    setSelectedWhatsAppRecipientKeys((prev) => {
      const next = new Set(prev);
      if (next.has(recipientKey)) next.delete(recipientKey);
      else next.add(recipientKey);
      return next;
    });
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
        .order('created_at', { ascending: false });

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

  const closeBriefEditModal = () => {
    setEditingBriefId(null);
    setEditedBrief('');
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
      let allContacts: NotifyRecipient[] = fetchedContacts.map((c) => ({
        ...c,
        recipientKey: `lead-${c.id}`,
        source: 'lead',
        sourceLabel: c.isMain ? 'Lead (Main)' : 'Lead Contact',
      }));

      if (meeting.calendar_type === 'staff') {
        const meetingDbId = getMeetingDbId(meeting);
        if (meetingDbId != null) {
          const participantContacts = await fetchMeetingParticipantContacts(meetingDbId);
          allContacts = mergeNotifyRecipients(allContacts, participantContacts);
        }
      }

      setContacts(allContacts);

      // Fetch email templates from admin automation rules (location × placement × language)
      try {
        const cache = emailAutomationCache ?? (await fetchEmailTemplatesAutomationCache());
        if (!emailAutomationCache) setEmailAutomationCache(cache);

        const templateIds = resolveMeetingEmailTemplateIdsForNotify(
          cache,
          meeting,
          allMeetingLocations,
          type,
        );

        if (!templateIds.en && !templateIds.he) {
          toast.error(
            'No email templates configured for this location and email type. Set them in Admin → Misc → Email Templates Automation.'
          );
          setEmailTemplates({ en: null, he: null });
          setEmailTemplateIds({ en: null, he: null });
        } else {
          const idsToLoad = [templateIds.en, templateIds.he].filter(
            (id): id is number => id != null && Number.isFinite(id)
          );
          const templatesById = await fetchMiscEmailTemplatesByIds(idsToLoad);

          const applyTemplate = (lang: 'en' | 'he', templateId: number | null) => {
            if (!templateId) {
              setEmailTemplates((prev) => ({ ...prev, [lang]: null }));
              setEmailTemplateIds((prev) => ({ ...prev, [lang]: null }));
              return;
            }
            const row = templatesById.get(templateId);
            if (!row?.content) {
              setEmailTemplates((prev) => ({ ...prev, [lang]: null }));
              setEmailTemplateIds((prev) => ({ ...prev, [lang]: null }));
              return;
            }
            const parsedContent = parseTemplateContent(row.content);
            setEmailTemplates((prev) => ({
              ...prev,
              [lang]: { content: parsedContent, name: row.name || null },
            }));
            setEmailTemplateIds((prev) => ({ ...prev, [lang]: templateId }));
          };

          applyTemplate('en', templateIds.en);
          applyTemplate('he', templateIds.he);
        }
      } catch (error) {
        console.error('Error fetching email templates:', error);
        toast.error('Failed to load email templates');
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
      let allContacts: NotifyRecipient[] = fetchedContacts.map((c) => ({
        ...c,
        recipientKey: `lead-${c.id}`,
        source: 'lead',
        sourceLabel: c.isMain ? 'Lead (Main)' : 'Lead Contact',
      }));

      if (meeting.calendar_type === 'staff') {
        const meetingDbId = getMeetingDbId(meeting);
        if (meetingDbId != null) {
          const participantContacts = await fetchMeetingParticipantContacts(meetingDbId);
          allContacts = mergeNotifyRecipients(allContacts, participantContacts);
        }
      }

      console.log('📱 WhatsApp Notify - Fetched contacts (before dedup):', allContacts.length, allContacts);

      // If no contacts were found from DB, add a fallback contact based on the lead's primary info
      if (allContacts.length === 0 && (client.phone || client.mobile)) {
        allContacts.push({
          id: -1,
          recipientKey: 'lead-fallback',
          name: client.name || 'Client',
          email: client.email || null,
          phone: client.phone || null,
          mobile: client.mobile || null,
          country_id: null,
          isMain: true,
          source: 'lead',
          sourceLabel: 'Lead (Main)',
        });
      }

      console.log('📱 WhatsApp Notify - Contacts for modal:', allContacts.length, allContacts);
      setWhatsAppContacts(allContacts);
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
      const templateName = type === 'missed_appointment' ? 'missed_appointment' : 'reminder_of_a_meeting';
      const targetLanguage = selectedLanguage.toLowerCase();
      const selectedTemplate = selectReminderWhatsAppTemplate(reminderTemplates, type, selectedLanguage, {
        useExternalMeetingTemplates: isStaffOrInternalMeeting(meeting),
      });

      if (!selectedTemplate) {
        console.error('📱 Template not found:', {
          selectedLanguage,
          targetLanguage,
          availableTemplates: reminderTemplates.map(t => ({ id: t.id, name: t.name, language: t.language }))
        });
        toast.error(`Reminder template not found for ${selectedLanguage === 'he' ? 'Hebrew' : 'English'}. Please ensure templates with name "${templateName}" and language "${targetLanguage}" exist in the database.`);
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

        const paramCount = Number(selectedTemplate.params) || 0;
        let templateParameters: Array<{ type: string; text: string }> = [];

        if (paramCount > 0) {
          try {
            const preferEnglishWhatsApp = preferEnglishMeetingTemplateLanguage(selectedLanguage);
            templateParameters = await generateMeetingWhatsAppTemplateParameters(
              selectedTemplate,
              { ...client },
              contact?.id || null,
              {
                formattedDate,
                formattedTime,
                locationName,
                locationTextForTemplate: resolveMeetingLocationTextForTemplate(
                  meeting,
                  preferEnglishWhatsApp,
                ),
                meetingLocationRaw: String(meeting.location ?? '').trim(),
                manualAddress: meeting.manual_address?.trim() ?? '',
                meetingId: meeting.id,
                joinLinkForTemplate: meeting.link?.trim() ?? '',
                templateLanguage: selectedLanguage,
              },
              { leadlessStaff: false },
            );
            if (templateParameters.length === 0) {
              console.error('❌ Failed to generate template parameters');
              toast.error('Failed to generate template parameters. Please try again.');
              setSendingWhatsAppMeetingId(null);
              return;
            }
            console.log(`✅ Template with ${paramCount} param(s) - auto-filled parameters:`, templateParameters);
          } catch (error) {
            console.error('❌ Error generating template parameters:', error);
            toast.error(`Error generating template parameters: ${error instanceof Error ? error.message : 'Unknown error'}`);
            setSendingWhatsAppMeetingId(null);
            return;
          }
        }

        const filledContent = fillWhatsAppTemplateContent(selectedTemplate.content || '', templateParameters);

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

        let response: Response;
        let result: any;

        try {
          response = await fetch(buildApiUrl('/api/whatsapp/send-message'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(messagePayload),
          });

          result = await response.json();
        } catch (fetchError) {
          // If we can't even parse the response, assume it failed
          console.error('❌ Error fetching or parsing WhatsApp API response:', fetchError);
          return { success: false, phoneNumber, error: 'Failed to send WhatsApp message: Network error' };
        }

        // Check if backend returned an error but message was actually sent
        // The backend sends WhatsApp message first, then saves to DB
        // If DB save fails, backend returns 500 with "Failed to save message" but message was already sent
        const isDbSaveError = !response.ok && result && result.error && (
          result.error.includes('save') ||
          result.error.includes('Failed to save message') ||
          result.details?.includes('save') ||
          result.details?.includes('permission denied')
        );

        if (!response.ok && !isDbSaveError) {
          // Real error - message was not sent
          let errorMessage = '';
          if (result?.code === 'RE_ENGAGEMENT_REQUIRED') {
            errorMessage = '⚠️ WhatsApp 24-Hour Rule: You can only send template messages after 24 hours of customer inactivity.';
          } else {
            errorMessage = result?.error || 'Failed to send WhatsApp message';
          }
          return { success: false, phoneNumber, error: errorMessage };
        }

        // If it's a DB save error, the message was sent but DB save failed
        // We'll handle it optimistically and still return success
        if (isDbSaveError) {
          console.warn('⚠️ WhatsApp message sent but database save failed. Adding optimistic record:', {
            error: result?.error,
            details: result?.details,
          });
          // Continue to optimistic insert below - message was sent successfully
        }

        // Successful API responses already persist the row in whatsapp_messages (see whatsappController.sendMessage).
        // A second client insert here caused duplicate timeline entries in InteractionsTab.
        if (response.ok) {
          return { success: true, phoneNumber };
        }

        // DB save failed after send: insert from client so the timeline can still show the message.
        const whatsappMessageId =
          result?.messageId ??
          result?.message_id ??
          result?.whatsapp_message_id ??
          result?.data?.whatsapp_message_id ??
          result?.id;

        try {
          const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
          const legacyId = isLegacyLead
            ? (() => {
              const numeric = parseInt(String(client.id).replace('legacy_', ''), 10);
              return Number.isNaN(numeric) ? null : numeric;
            })()
            : null;

          const now = new Date();
          const whatsappMessageRecord: any = {
            phone_number: phoneNumber.trim(),
            sender_name: senderName,
            direction: 'out',
            message: filledContent || selectedTemplate.content || `[Template: ${selectedTemplate.name}]`,
            template_id: selectedTemplate.id,
            sent_at: now.toISOString(),
            whatsapp_message_id: whatsappMessageId || `optimistic_${now.getTime()}`,
            whatsapp_status: 'sent', // Optimistic status
            message_type: 'text',
            whatsapp_timestamp: now.toISOString(),
          };

          // Set either client_id OR legacy_id, not both
          if (isLegacyLead) {
            whatsappMessageRecord.legacy_id = legacyId;
            whatsappMessageRecord.lead_id = null;
          } else {
            whatsappMessageRecord.lead_id = client.id;
            whatsappMessageRecord.legacy_id = null;
          }

          // Add contact_id if available
          if (contact?.id) {
            whatsappMessageRecord.contact_id = contact.id;
          }

          // Try to insert the message optimistically
          const { data: insertedData, error: insertError } = await supabase
            .from('whatsapp_messages')
            .insert([whatsappMessageRecord])
            .select();

          if (insertError) {
            console.error('❌ Failed to insert WhatsApp message record (message was sent successfully):', {
              error: insertError,
              code: insertError.code,
              message: insertError.message,
              details: insertError.details,
              hint: insertError.hint,
            });

            // If it's a permission error for pending_stage_evaluations, try workaround
            if (insertError.code === '42501' && insertError.message?.includes('pending_stage_evaluations')) {
              console.log('🔄 Permission denied for trigger, attempting workaround for WhatsApp message...');
              const messageRecordWithoutContext = { ...whatsappMessageRecord };
              delete messageRecordWithoutContext.lead_id;
              delete messageRecordWithoutContext.legacy_id;
              delete messageRecordWithoutContext.contact_id;

              const { data: insertedWithoutContext, error: insertWithoutContextError } = await supabase
                .from('whatsapp_messages')
                .insert([messageRecordWithoutContext])
                .select();

              if (!insertWithoutContextError && insertedWithoutContext && insertedWithoutContext.length > 0) {
                // Now try to update with the context
                const { error: updateError } = await supabase
                  .from('whatsapp_messages')
                  .update({
                    lead_id: whatsappMessageRecord.lead_id,
                    legacy_id: whatsappMessageRecord.legacy_id,
                    contact_id: whatsappMessageRecord.contact_id,
                  })
                  .eq('id', insertedWithoutContext[0].id);

                if (updateError) {
                  console.error('❌ Failed to update WhatsApp message record with context:', updateError);
                  console.warn('⚠️ WhatsApp message was sent successfully but cannot be saved to database due to permissions. It will appear after backend sync.');
                  // Don't throw - message was sent successfully
                } else {
                  console.log('✅ WhatsApp message record saved with workaround (insert then update)');
                }
              } else {
                console.error('❌ Workaround also failed for WhatsApp message:', insertWithoutContextError);
                console.warn('⚠️ WhatsApp message was sent successfully but cannot be saved to database due to permissions. It will appear after backend sync.');
                // Don't throw - message was sent successfully
              }
            } else {
              // Not a permission error, log it
              console.warn('⚠️ WhatsApp message was sent successfully but cannot be saved to database. It will appear after backend sync.');
            }
            // Don't throw - message was sent successfully, just log the error
          } else {
            console.log('✅ WhatsApp message record inserted successfully:', insertedData);
          }
        } catch (dbError) {
          // Database errors should not prevent success message
          // The message was already sent successfully
          console.error('❌ Error saving WhatsApp message record to database (message was sent successfully):', dbError);
          console.warn('⚠️ WhatsApp message was sent successfully but cannot be saved to database. It will appear after backend sync.');
          // Message was sent, so we still return success
          // The message will appear in InteractionsTab after backend sync
        }

        // Always return success if we got here (message was sent, DB save is just for immediate visibility)
        // The message will appear in InteractionsTab after backend sync if DB save failed
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

      const locationName = getMeetingLocationName(meeting.location);
      const joinLinkRaw = getMeetingJoinLink(meeting);
      const locationRecord = resolveMeetingLocationRecord(meeting.location);
      const includeJoinLink = shouldIncludeMeetingJoinLink(locationRecord, locationName);
      const joinLink = includeJoinLink ? joinLinkRaw : '';
      const teamsJoinUrlForCalendar =
        includeJoinLink && joinLink && getLinkType(joinLink) === 'teams' ? joinLink : undefined;
      const calendarLocationDisplay =
        includeJoinLink && locationName === 'Teams' ? 'Microsoft Teams Meeting' : locationName;

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
        const joinLabel = getLinkType(joinLink) === 'teams' ? 'Join Teams Meeting' : 'Join Meeting';
        descriptionHtml += `<p><strong>${joinLabel}:</strong> <a href="${joinLink}">${joinLink}</a></p>`;
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
        const languageId = (client as any)?.language_id;
        const isHebrew = languageId === 2 ||
          (languageId === undefined && client.language?.toLowerCase().includes('hebrew'));
        languageToUse = isHebrew ? 'he' : 'en';
        console.log('🌐 Reschedule email - Auto language selection:', {
          language_id: (client as any)?.language_id,
          language: client.language,
          selectedLanguage: languageToUse
        });
      } else {
        // Use manual language selection for other email types
        languageToUse = selectedEmailLanguage;
      }

      // Get email template based on determined language
      const selectedTemplate = languageToUse === 'en' ? emailTemplates.en : emailTemplates.he;

      // Get template name for subject (use template's name from database, or fallback to hardcoded)
      let subject: string;
      if (selectedTemplate?.name) {
        subject = selectedTemplate.name;
      } else {
        // Fallback to hardcoded subjects if template name not available
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
      }

      // Build HTML body for email - use template if available, otherwise fallback to default template
      let htmlBody: string;
      if (selectedTemplate?.content) {
        // Use formatEmailBody to preserve line breaks and apply RTL formatting
        // Pass meeting context for template parameter replacement
        htmlBody = await formatEmailBody(selectedTemplate.content, recipientName, {
          client,
          meeting,
          meetingDate: formattedDate,
          meetingTime: formattedTime,
          meetingLink: joinLink,
          templateLanguage: languageToUse,
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
          meetingLink: joinLink,
          templateLanguage: languageToUse,
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
              location: calendarLocationDisplay,
              description: descriptionHtml,
              attendeeEmail: primaryRecipientEmail,
              attendeeName: recipientName,
              organizerEmail: account.username || 'noreply@lawoffice.org.il',
              organizerName: senderName,
              teamsJoinUrl: teamsJoinUrlForCalendar,
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
              location: calendarLocationDisplay,
              description: descriptionHtml.replace(/<[^>]+>/g, ''), // Strip HTML for ICS
              organizerEmail: account.username || 'noreply@lawoffice.org.il',
              organizerName: senderName,
              attendeeEmail: primaryRecipientEmail,
              attendeeName: recipientName,
              teamsJoinUrl: teamsJoinUrlForCalendar,
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
            attachments,
            skipSignature: true // Don't include user signature in template emails
          });
        }
      } else {
        // For reminder and cancellation, just send email without calendar invite
        await sendEmail(tokenResponse.accessToken, {
          to: recipientEmail,
          subject,
          body: htmlBody,
          skipSignature: true // Don't include user signature in template emails
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

      const recipientEmailArrayForContact = Array.isArray(recipientEmail) ? recipientEmail : [recipientEmail];
      const contactByEmail =
        recipientEmailArrayForContact.length > 0
          ? contacts.find((c) => c.email === recipientEmailArrayForContact[0])
          : undefined;
      const contactId = contactByEmail && contactByEmail.id > 0 ? contactByEmail.id : null;
      const senderEmail = account.username || account.name || 'noreply@lawoffice.org.il';

      await saveOutgoingEmailRecord({
        client,
        subject,
        htmlBody,
        senderName,
        senderEmail,
        recipientList: recipientEmail,
        contactId,
        sentAt: now,
        messageId: `meeting_${currentEmailType}_${now.getTime()}`,
      });

      // Stage evaluation is handled automatically by database triggers
      // Note: The email is sent via Graph API directly, so the backend's recordOutgoingEmail is not called
      // However, the optimistic upsert ensures it appears immediately in InteractionsTab
      // When the email is synced from Outlook, it will be updated with the real message_id
      // The fixes to persistMessages ensure it maintains the proper client_id/legacy_id context

      if (onClientUpdate) await onClientUpdate();
      // Refresh meetings to show updated data
      await fetchMeetings();
    } catch (error) {
      // Only show "Failed to send email" if the actual email sending failed
      // Database errors are handled separately above
      console.error('❌ Error in handleSendEmail:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      console.error('❌ Error details:', {
        message: errorMessage,
        stack: errorStack,
        error: error,
      });

      // Check if this is a database-related error (shouldn't happen here, but just in case)
      if (errorMessage.includes('insert email record') || errorMessage.includes('upsert email record') || errorMessage.includes('save email record')) {
        toast.error('Email sent but failed to save record. It will appear after sync.');
      } else if (errorMessage.includes('Graph API error')) {
        // Extract the actual Graph API error message if available
        const graphErrorMatch = errorMessage.match(/Graph API error sending email: (.+)/);
        const displayMessage = graphErrorMatch ? graphErrorMatch[1] : 'Failed to send email via Microsoft Graph API.';
        toast.error(displayMessage);
      } else if (errorMessage.includes('No recipient') || errorMessage.includes('Recipient email')) {
        toast.error('Please specify a recipient email address.');
      } else if (errorMessage.includes('Microsoft account')) {
        toast.error('Please sign in to your Microsoft account.');
      } else {
        toast.error(`Failed to send email: ${errorMessage}`);
      }
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
      const existingLink = getValidTeamsLink(meeting.link);
      if (existingLink && existingLink.trim() !== '') {
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
    if (!link || link.trim() === '') return '';
    try {
      // If it's a plain URL, return as is
      if (link.startsWith('http')) {
        return link;
      }
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

  /**
   * Resolve join URL for emails: Teams/Graph JSON in meeting.link, custom_link, or location default_link (Zoom etc.).
   * English templates often failed when only default_link was set — getValidTeamsLink(meeting.link) returned ''.
   */
  const getMeetingJoinLink = (meeting: Meeting): string => {
    const fromStored = getValidTeamsLink(meeting.link);
    if (fromStored) return fromStored;

    const custom = (meeting as any).custom_link?.trim?.();
    if (custom && /^https?:\/\//i.test(custom)) return custom;

    const locRaw = meeting.location;
    if (locRaw === null || locRaw === undefined || locRaw === '') return '';

    const location = resolveMeetingLocationRecord(locRaw);
    const dl = location?.default_link?.trim?.();
    if (dl && /^https?:\/\//i.test(dl)) return dl;
    if (dl) return dl;
    return '';
  };

  const copyTextToClipboard = async (text: string) => {
    if (!text) return false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // fall through
    }
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  };

  // Helper function to detect link type (Teams, Zoom, or other)
  const getLinkType = (link: string | undefined): 'teams' | 'zoom' | 'other' => {
    if (!link) return 'other';
    const linkLower = link.toLowerCase();

    // Check for Teams links
    if (linkLower.includes('teams.microsoft.com') ||
      linkLower.includes('teams.live.com') ||
      linkLower.includes('microsoft.com/teams') ||
      linkLower.includes('teams.office.com')) {
      return 'teams';
    }

    // Check for Zoom links
    if (linkLower.includes('zoom.us') ||
      linkLower.includes('zoom.com') ||
      linkLower.includes('zoom.') && linkLower.includes('/j/')) {
      return 'zoom';
    }

    return 'other';
  };

  // Helper function to get the appropriate icon for a link
  const getLinkIcon = (link: string | undefined) => {
    const linkType = getLinkType(link);
    const iconClass = "w-3 h-3 sm:w-4 sm:h-4";

    switch (linkType) {
      case 'teams':
        // Use VideoCameraIcon for Teams (already imported)
        return <VideoCameraIcon className={iconClass} />;
      case 'zoom':
        return <SiZoom className={iconClass} />;
      default:
        return <LinkIcon className={iconClass} />;
    }
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

  // Create an internal meeting (staff calendar) tied to the current lead, with
  // external participants. Mirrors CalendarPage's TeamsMeetingModal create flow,
  // but also links the meeting row to this lead via client_id / legacy_lead_id.
  const STAFF_CALENDAR_EMAIL = 'shared-staffcalendar@lawoffice.org.il';
  const createExternalMeetingForLead = async (params: {
    date: string;
    time: string;
    durationMinutes?: number;
    subject: string;
    description?: string;
    location: string;
    internalMeetingTypeId: number | null;
    selectedStaffEmployeeIds: number[];
    selectedFirmContactIds: string[];
    freeParticipants: FreeParticipant[];
    freeDraft: FreeParticipant;
  }): Promise<{ meetingId: number | null; teamsMeetingUrl: string | null } | null> => {
    const startDateTime = new Date(`${params.date}T${params.time}:00`);
    const endDateTime = new Date(startDateTime.getTime() + (params.durationMinutes ?? 60) * 60000);

    const account = instance.getAllAccounts()[0];
    if (!account) {
      toast.error('You must be signed in to Microsoft to create internal meetings.');
      return null;
    }

    const locationLower = String(params.location || '').trim().toLowerCase();
    const shouldCreateTeamsMeeting = locationLower === 'teams' || locationLower.includes('teams');

    const scopes = shouldCreateTeamsMeeting
      ? ['https://graph.microsoft.com/Calendars.ReadWrite', 'https://graph.microsoft.com/OnlineMeetings.ReadWrite']
      : ['https://graph.microsoft.com/Calendars.ReadWrite'];
    const staffCalendarRequest = {
      ...loginRequest,
      scopes,
      extraQueryParameters: { login_hint: STAFF_CALENDAR_EMAIL },
    };
    setShowAuthRedirectOption(false);
    authRedirectParamsRef.current = { request: staffCalendarRequest, account };

    const accessToken = await getAccessTokenWithFallback(
      instance,
      staffCalendarRequest,
      account,
      () => toast.loading('Authenticating with shared calendar...', { duration: 3000 })
    );
    if (!accessToken) {
      toast.error('Microsoft auth failed. Allow popups or use "Sign in (this tab)".');
      return null;
    }

    // Build attendee email list for the Outlook event (staff + firm names + free names)
    const staffEmployees = allEmployees.filter((e: any) => params.selectedStaffEmployeeIds.includes(Number(e.id)));
    const selectedFirms = firmContacts.filter((c) => params.selectedFirmContactIds.includes(c.id));
    const freeDraftName = String(params.freeDraft?.name || '').trim();
    const allFreeParticipants = [
      ...(params.freeParticipants || []),
      ...(freeDraftName
        ? [{
            name: freeDraftName,
            email: (params.freeDraft?.email || '').trim() || undefined,
            phone: (params.freeDraft?.phone || '').trim() || undefined,
            notes: (params.freeDraft?.notes || '').trim() || undefined,
          }]
        : []),
    ].filter((p) => p && typeof p.name === 'string' && p.name.trim() !== '');

    const staffEmails: string[] = [];
    {
      const employeeIds = staffEmployees.map((e: any) => e.id);
      if (employeeIds.length > 0) {
        const { data: userRows } = await supabase
          .from('users')
          .select('employee_id, email')
          .in('employee_id', employeeIds)
          .eq('is_staff', true)
          .not('email', 'is', null);
        (userRows || []).forEach((r: any) => { if (r.email) staffEmails.push(String(r.email)); });
      }
    }
    const firmNames = selectedFirms.map((c) => String(c.name || '').trim()).filter(Boolean);
    const freeNames = allFreeParticipants.map((p) => String(p.name || '').trim()).filter(Boolean);
    const teamsAttendeeEmails = Array.from(new Set([...staffEmails, ...firmNames, ...freeNames].filter(Boolean)));

    const fmtGraph = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      const s = String(d.getSeconds()).padStart(2, '0');
      return `${y}-${m}-${day}T${h}:${min}:${s}`;
    };

    let teamsMeetingId: string | null = null;
    let teamsJoinUrl: string | null = null;
    try {
      if (shouldCreateTeamsMeeting) {
        const result = await createStaffTeamsMeeting(accessToken, {
          subject: params.subject,
          startDateTime: fmtGraph(startDateTime),
          endDateTime: fmtGraph(endDateTime),
          attendees: teamsAttendeeEmails.map((email) => ({ email })),
          isRecurring: false,
          recurrencePattern: 'weekly',
          recurrenceInterval: 1,
          recurrenceEndDate: null,
        });
        if (!result || !result.id) throw new Error('Teams meeting creation returned invalid result');
        teamsMeetingId = result.id;
        teamsJoinUrl = result.onlineMeeting?.joinUrl || result.joinUrl || null;
      } else {
        const result = await createStaffCalendarEvent(accessToken, {
          subject: params.subject,
          startDateTime: fmtGraph(startDateTime),
          endDateTime: fmtGraph(endDateTime),
          locationName: params.location || null,
          description: params.description || null,
          attendeesEmails: teamsAttendeeEmails,
          isRecurring: false,
          recurrencePattern: 'weekly',
          recurrenceInterval: 1,
          recurrenceEndDate: null,
        });
        teamsMeetingId = result?.id || null;
      }
    } catch (err) {
      console.error('External meeting Outlook creation failed:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to create Outlook event for external meeting.');
      return null;
    }

    // Persist outlook_teams_meetings meta row (best-effort).
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && teamsMeetingId) {
        const meta: OutlookTeamsMeeting = {
          teams_meeting_id: teamsMeetingId,
          subject: params.subject,
          start_date_time: startDateTime.toISOString(),
          end_date_time: endDateTime.toISOString(),
          ...(shouldCreateTeamsMeeting && teamsJoinUrl ? { teams_join_url: teamsJoinUrl, teams_meeting_url: teamsJoinUrl } : {}),
          calendar_id: STAFF_CALENDAR_EMAIL,
          attendees: teamsAttendeeEmails,
          description: params.description || '',
          location: params.location,
          created_by: user.id,
          is_online_meeting: shouldCreateTeamsMeeting,
          ...(shouldCreateTeamsMeeting ? { online_meeting_provider: 'teamsForBusiness' } : {}),
        };
        await saveOutlookTeamsMeeting(meta);
      }
    } catch (e) {
      console.warn('Failed to persist outlook_teams_meetings meta row', e);
    }

    // Insert the internal meeting row (calendar_type='staff') linked to this lead.
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
    const legacyId = isLegacyLead ? client.id.toString().replace('legacy_', '') : null;
    const { data: insertedMeeting, error: meetingInsertError } = await supabase
      .from('meetings')
      .insert({
        client_id: isLegacyLead ? null : client.id,
        legacy_lead_id: isLegacyLead ? legacyId : null,
        meeting_date: params.date,
        meeting_time: params.time,
        meeting_location: params.location,
        meeting_subject: params.subject,
        meeting_brief: params.description || null,
        calendar_type: 'staff',
        internal_meeting_type_id: params.internalMeetingTypeId,
        teams_id: teamsMeetingId,
        teams_meeting_url: teamsJoinUrl,
        custom_link: null,
        status: 'scheduled',
      })
      .select('id')
      .single();
    if (meetingInsertError) {
      console.error('External meeting insert failed', meetingInsertError);
      toast.error(`Failed to save meeting: ${meetingInsertError.message}`);
      return null;
    }
    const meetingId = insertedMeeting?.id ?? null;
    if (meetingId == null) {
      toast.error('Failed to save meeting');
      return null;
    }

    // Save participants
    const participantRows: any[] = [];
    params.selectedStaffEmployeeIds.forEach((employeeId) =>
      participantRows.push({ meeting_id: meetingId, employee_id: employeeId })
    );
    params.selectedFirmContactIds.forEach((firmContactId) =>
      participantRows.push({ meeting_id: meetingId, firm_contact_id: firmContactId })
    );
    allFreeParticipants.forEach((p) =>
      participantRows.push({
        meeting_id: meetingId,
        free_name: String(p.name).trim(),
        free_email: p.email ? String(p.email).trim() : null,
        free_phone: p.phone ? String(p.phone).trim() : null,
        notes: p.notes ? String(p.notes).trim() : null,
      })
    );
    if (participantRows.length > 0) {
      const { error: partErr } = await supabase.from('meeting_participants').insert(participantRows);
      if (partErr) {
        console.warn('Failed to save participants', partErr);
        toast.error(`Meeting saved but failed to save participants: ${partErr.message || 'Unknown error'}`);
      }
    }

    return { meetingId, teamsMeetingUrl: teamsJoinUrl };
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

      // External meeting branch: create an Internal Meeting (calendar_type='staff')
      // tied to this lead, with external participants. Skip the active/potential-client
      // calendar flow entirely.
      if (scheduleMeetingFormData.calendar === 'external') {
        const subject = scheduleExternal.subject.trim()
          || `[#${client.lead_number || client.id}] ${client.name} - Internal Meeting`;
        const result = await createExternalMeetingForLead({
          date: scheduleMeetingFormData.date,
          time: scheduleMeetingFormData.time,
          subject,
          description: scheduleMeetingFormData.brief || '',
          location: scheduleMeetingFormData.location,
          internalMeetingTypeId: scheduleExternal.internalMeetingTypeId,
          selectedStaffEmployeeIds: scheduleExternal.selectedStaffEmployeeIds,
          selectedFirmContactIds: scheduleExternal.selectedFirmContactIds,
          freeParticipants: scheduleExternal.freeParticipants,
          freeDraft: scheduleExternal.freeDraft,
        });
        if (result) {
          toast.success('Internal meeting created with external participants.');
          setShowScheduleDrawer(false);
          setNotifyClientOnSchedule(false);
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
            custom_link: '',
            custom_address: '',
          });
          setScheduleExternal({
            subject: '',
            internalMeetingTypeId: internalMeetingTypes.find((t) => t.code === 'staff')?.id ?? internalMeetingTypes[0]?.id ?? null,
            selectedStaffEmployeeIds: [],
            selectedFirmContactIds: [],
            freeParticipants: [],
            freeDraft: { name: '', email: '', phone: '', notes: '' },
          });
          if (onClientUpdate) await onClientUpdate();
          await fetchMeetings();
        }
        setIsSchedulingMeeting(false);
        return;
      }

      const editorDisplayName = await resolveEditorDisplayName();

      let teamsMeetingUrl = '';
      const selectedLocation = allMeetingLocations.find(
        loc => loc.name === scheduleMeetingFormData.location
      );
      const selectedLocationId = Number(selectedLocation?.id);
      const customLinkValue = scheduleMeetingFormData.custom_link?.trim() || '';
      const customAddressValue = scheduleMeetingFormData.custom_address?.trim() || '';

      if (selectedLocationId === CUSTOM_LINK_LOCATION_ID && !customLinkValue) {
        toast.error('Please enter a custom link for this location.');
        setIsSchedulingMeeting(false);
        return;
      }
      if (selectedLocationId === CUSTOM_ADDRESS_LOCATION_ID && !customAddressValue) {
        toast.error('Please enter a custom address for this location.');
        setIsSchedulingMeeting(false);
        return;
      }

      // Check for location conflict for restricted zoom room locations
      const restrictedLocationIds = [3, 4, 15, 16, 17, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29];
      if (selectedLocation && selectedLocation.id && restrictedLocationIds.includes(selectedLocation.id)) {
        // Extract hour from the selected time (e.g., "10:30" -> "10")
        const selectedTimeHour = scheduleMeetingFormData.time.split(':')[0];

        // Check if there's already a meeting at the same date, same hour, and location
        // We need to fetch all meetings for that date and location, then filter by hour
        const { data: allMeetingsForDate, error: conflictError } = await supabase
          .from('meetings')
          .select('id, meeting_date, meeting_time, meeting_location')
          .eq('meeting_date', scheduleMeetingFormData.date)
          .eq('meeting_location', scheduleMeetingFormData.location)
          .or('status.is.null,status.neq.canceled');

        if (conflictError) {
          console.error('Error checking for location conflicts:', conflictError);
        } else if (allMeetingsForDate && allMeetingsForDate.length > 0) {
          // Filter meetings to check if any are in the same hour
          const conflictingMeetings = allMeetingsForDate.filter((meeting: any) => {
            if (!meeting.meeting_time) return false;
            const meetingHour = meeting.meeting_time.split(':')[0];
            return meetingHour === selectedTimeHour;
          });

          if (conflictingMeetings.length > 0) {
            // There's already a meeting at this date, same hour, and location
            const conflictingTime = conflictingMeetings[0].meeting_time;
            toast.error(
              `This Zoom room is already booked at ${scheduleMeetingFormData.date} in the ${selectedTimeHour}:00 hour (existing meeting at ${conflictingTime}). Please choose a different time or location.`,
              {
                duration: 6000,
                position: 'top-right',
                style: {
                  background: '#ef4444',
                  color: '#fff',
                  fontWeight: '500',
                  maxWidth: '500px',
                },
              }
            );
            setIsSchedulingMeeting(false);
            return;
          }
        }
      }

      // If this is a Teams meeting, create an online event via Graph
      if (scheduleMeetingFormData.location === 'Teams') {
        let accessToken: string | null = null;
        try {
          const request = { ...loginRequest, account };
          accessToken = await getAccessTokenWithFallback(
            instance,
            request,
            account,
            () => toast.loading('Signing in to Microsoft...', { duration: 3000 })
          );
          if (!accessToken) {
            toast.error('Redirecting to sign in… If the page did not redirect, use "Sign in (this tab)" when the option appears.', { duration: 8000 });
            setIsSchedulingMeeting(false);
            return;
          }
        } catch (error) {
          if (error instanceof AuthPopupBlockedError) {
            authRedirectParamsRef.current = { request: { ...loginRequest, account }, account };
            setShowAuthRedirectOption(true);
            toast.error(error.message, { duration: 10000 });
            setIsSchedulingMeeting(false);
            return;
          }
          throw error;
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
      } else if (selectedLocationId === CUSTOM_LINK_LOCATION_ID) {
        teamsMeetingUrl = customLinkValue;
      } else if (selectedLocation?.default_link) {
        teamsMeetingUrl = selectedLocation.default_link;
      }

      // Check if this is a legacy lead
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      const legacyId = isLegacyLead ? client.id.toString().replace('legacy_', '') : null;

      let meetingSchedulerDisplayName = '---';
      if (isLegacyLead) {
        const schedulerName = getEmployeeDisplayName(client.meeting_scheduler_id);
        if (schedulerName && schedulerName !== '--') {
          meetingSchedulerDisplayName = schedulerName;
        }
      } else if (client.scheduler) {
        const schedulerName = getEmployeeDisplayName(client.scheduler);
        meetingSchedulerDisplayName = schedulerName !== '--' ? schedulerName : String(client.scheduler);
      }

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
        scheduler: meetingSchedulerDisplayName,
        last_edited_timestamp: new Date().toISOString(),
        last_edited_by: editorDisplayName,
        calendar_type: scheduleMeetingFormData.calendar === 'active_client' ? 'active_client' : 'potential_client',
        custom_link: selectedLocationId === CUSTOM_LINK_LOCATION_ID ? customLinkValue : null,
        custom_address: selectedLocationId === CUSTOM_ADDRESS_LOCATION_ID ? customAddressValue : null,
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

      // Resolve expert employee ID
      const expertEmployeeId = getEmployeeIdFromDisplayName(client.expert);

      // Update client/lead record with roles (but NOT stage - as per user requirement)
      if (isLegacyLead) {
        const updatePayload: any = {};

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

      // Send meeting invitation email only when notify toggle is on
      console.log('📧 Checking if we can send automatic invitation:', {
        notifyClientOnSchedule,
        hasInsertedData: !!insertedData,
        insertedDataLength: insertedData?.length,
        hasClient: !!client,
        clientEmail: client?.email,
        clientName: client?.name,
        meetingData: insertedData?.[0]
      });

      if (notifyClientOnSchedule && insertedData && insertedData.length > 0 && client.email) {
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
          scheduler: insertedData[0].scheduler || meetingSchedulerDisplayName,
          helper: insertedData[0].helper,
          expert: insertedData[0].expert,
          link: insertedData[0].teams_meeting_url || '',
          lastEdited: {
            timestamp: insertedData[0].last_edited_timestamp,
            user: insertedData[0].last_edited_by,
          },
        };

        // Determine the appropriate invitation type based on meeting location
        const invitationType = inferInvitationEmailTypeFromLocationName(scheduleMeetingFormData.location);

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
          toast('Meeting scheduled, but failed to send invitation email.', { icon: '⚠️' });
        }
      } else {
        console.log('⚠️ Meeting created but email not sent:', {
          hasInsertedData: !!insertedData,
          dataLength: insertedData?.length,
          hasClientEmail: !!client?.email
        });
      }

      // Update UI
      toast.success(notifyClientOnSchedule ? 'Meeting scheduled and client notified.' : 'Meeting scheduled.');
      setShowScheduleDrawer(false);
      setIsSchedulingMeeting(false);
      setNotifyClientOnSchedule(false);

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
        custom_link: '',
        custom_address: '',
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
      const editor = await resolveEditorDisplayName();
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

      // Send cancellation email to client (only if notify toggle is on)
      if (notifyClientOnReschedule && client.email && canceledMeeting) {
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
        let templateName: string | null = null;
        try {
          console.log('📧 Fetching cancellation email template:', { clientLanguageId, isLegacyLeadForCancel });

          if (!clientLanguageId) {
            console.warn('⚠️ No language_id found for client, cannot fetch template');
          } else {
            const { data: template, error: templateError } = await supabase
              .from('misc_emailtemplate')
              .select('content, name')
              .eq('name', 'cancellation')
              .eq('language_id', clientLanguageId)
              .single();

            if (templateError) {
              console.error('❌ Error fetching cancellation email template:', templateError);
            } else if (template && template.content) {
              // Store template name for subject
              templateName = template.name || null;

              // Try parsing, but if it returns empty, use raw content (might be HTML)
              const parsed = parseTemplateContent(template.content);
              templateContent = parsed && parsed.trim() ? parsed : template.content;
              console.log('✅ Cancellation email template fetched successfully', {
                languageId: clientLanguageId,
                templateName: template.name,
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
          const cancelTemplateLang = clientLanguageId === 2 ? 'he' : 'en';
          emailBody = await formatEmailBody(templateContent, client.name, {
            client,
            meeting: canceledMeeting as any,
            meetingDate: formattedDate,
            meetingTime: formattedTime,
            meetingLocation: locationName,
            templateLanguage: cancelTemplateLang,
          });
        } else {
          console.warn('⚠️ Using fallback hardcoded email template for cancellation');
          // Fallback to hardcoded email (no signature - template emails should not include signatures)
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
            </div>
          `;
        }

        // Use template name as subject, or fallback to hardcoded
        const subject = templateName || `[${client.lead_number || client.id}] - ${client.name} - Meeting Canceled`;
        await sendEmail(accessToken, {
          to: client.email,
          subject,
          body: emailBody,
          skipSignature: true // Don't include user signature in template emails
        });

        const cancelSentAt = new Date();
        await saveOutgoingEmailRecord({
          client,
          subject,
          htmlBody: emailBody,
          senderName: account?.name || 'Your Team',
          senderEmail: account.username || 'noreply@lawoffice.org.il',
          recipientList: client.email,
          sentAt: cancelSentAt,
          messageId: `meeting_cancellation_${cancelSentAt.getTime()}`,
        });
      }

      toast.success(notifyClientOnReschedule ? 'Meeting canceled and client notified.' : 'Meeting canceled.');
      setShowRescheduleDrawer(false);
      setMeetingToDelete(null);
      setNotifyClientOnReschedule(false); // Reset to default
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
        custom_link: '',
        custom_address: '',
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

      // External meeting branch: cancel previous meeting (if any) and create a
      // new internal meeting with external participants tied to this lead.
      if (rescheduleFormData.calendar === 'external') {
        const isLegacyLeadExt = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
        const legacyIdExt = isLegacyLeadExt ? client.id.toString().replace('legacy_', '') : null;

        // Cancel oldest upcoming meeting (mirrors normal reschedule semantics).
        let cancelQuery = supabase
          .from('meetings')
          .select('id, meeting_date, meeting_time, meeting_location')
          .neq('status', 'canceled')
          .gte('meeting_date', new Date().toISOString().split('T')[0])
          .order('meeting_date', { ascending: true })
          .order('meeting_time', { ascending: true })
          .limit(1);
        if (isLegacyLeadExt) cancelQuery = cancelQuery.eq('legacy_lead_id', legacyIdExt);
        else cancelQuery = cancelQuery.eq('client_id', client.id);
        const { data: toCancel } = await cancelQuery;
        if (toCancel && toCancel.length > 0) {
          const editor = await resolveEditorDisplayName();
          await supabase
            .from('meetings')
            .update({ status: 'canceled', last_edited_timestamp: new Date().toISOString(), last_edited_by: editor })
            .eq('id', toCancel[0].id);
        }

        const subject = rescheduleExternal.subject.trim()
          || `[#${client.lead_number || client.id}] ${client.name} - Internal Meeting`;
        const result = await createExternalMeetingForLead({
          date: rescheduleFormData.date,
          time: rescheduleFormData.time,
          subject,
          description: rescheduleFormData.brief || '',
          location: rescheduleFormData.location,
          internalMeetingTypeId: rescheduleExternal.internalMeetingTypeId,
          selectedStaffEmployeeIds: rescheduleExternal.selectedStaffEmployeeIds,
          selectedFirmContactIds: rescheduleExternal.selectedFirmContactIds,
          freeParticipants: rescheduleExternal.freeParticipants,
          freeDraft: rescheduleExternal.freeDraft,
        });
        if (result) {
          toast.success('Internal meeting created with external participants.');
          setShowRescheduleDrawer(false);
          setMeetingToDelete(null);
          setNotifyClientOnReschedule(false);
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
            custom_link: '',
            custom_address: '',
          });
          setRescheduleExternal({
            subject: '',
            internalMeetingTypeId: internalMeetingTypes.find((t) => t.code === 'staff')?.id ?? internalMeetingTypes[0]?.id ?? null,
            selectedStaffEmployeeIds: [],
            selectedFirmContactIds: [],
            freeParticipants: [],
            freeDraft: { name: '', email: '', phone: '', notes: '' },
          });
          setRescheduleOption('cancel');
          if (onClientUpdate) await onClientUpdate();
          await fetchMeetings();
        }
        setIsReschedulingMeeting(false);
        return;
      }

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

        const editor = await resolveEditorDisplayName();
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

      const editorDisplayName = await resolveEditorDisplayName();

      // Create the new meeting
      let teamsMeetingUrl = '';
      const selectedLocation = allMeetingLocations.find(
        loc => loc.name === rescheduleFormData.location
      );
      const selectedLocationId = Number(selectedLocation?.id);
      const customLinkValue = rescheduleFormData.custom_link?.trim() || '';
      const customAddressValue = rescheduleFormData.custom_address?.trim() || '';

      if (selectedLocationId === CUSTOM_LINK_LOCATION_ID && !customLinkValue) {
        toast.error('Please enter a custom link for this location.');
        setIsReschedulingMeeting(false);
        return;
      }
      if (selectedLocationId === CUSTOM_ADDRESS_LOCATION_ID && !customAddressValue) {
        toast.error('Please enter a custom address for this location.');
        setIsReschedulingMeeting(false);
        return;
      }

      // Check for location conflict for restricted zoom room locations
      const restrictedLocationIds = [3, 4, 15, 16, 17, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29];
      if (selectedLocation && selectedLocation.id && restrictedLocationIds.includes(selectedLocation.id)) {
        // Extract hour from the selected time (e.g., "10:30" -> "10")
        const selectedTimeHour = rescheduleFormData.time.split(':')[0];

        // Check if there's already a meeting at the same date, same hour, and location
        // We need to fetch all meetings for that date and location, then filter by hour
        // Exclude the meeting we're rescheduling (if it exists and hasn't been canceled yet)
        const { data: allMeetingsForDate, error: conflictError } = await supabase
          .from('meetings')
          .select('id, meeting_date, meeting_time, meeting_location')
          .eq('meeting_date', rescheduleFormData.date)
          .eq('meeting_location', rescheduleFormData.location)
          .or('status.is.null,status.neq.canceled');

        if (conflictError) {
          console.error('Error checking for location conflicts:', conflictError);
        } else if (allMeetingsForDate && allMeetingsForDate.length > 0) {
          // Filter meetings to check if any are in the same hour (excluding the meeting being rescheduled)
          const conflictingMeetings = allMeetingsForDate.filter((meeting: any) => {
            // Exclude the meeting we're rescheduling (if it exists)
            if (meetingIdToCancel && meeting.id === meetingIdToCancel) return false;
            if (!meeting.meeting_time) return false;
            const meetingHour = meeting.meeting_time.split(':')[0];
            return meetingHour === selectedTimeHour;
          });

          if (conflictingMeetings.length > 0) {
            // There's already a meeting at this date, same hour, and location
            const conflictingTime = conflictingMeetings[0].meeting_time;
            toast.error(
              `This Zoom room is already booked at ${rescheduleFormData.date} in the ${selectedTimeHour}:00 hour (existing meeting at ${conflictingTime}). Please choose a different time or location.`,
              {
                duration: 6000,
                position: 'top-right',
                style: {
                  background: '#ef4444',
                  color: '#fff',
                  fontWeight: '500',
                  maxWidth: '500px',
                },
              }
            );
            setIsReschedulingMeeting(false);
            return;
          }
        }
      }

      // If this is a Teams meeting, create an online event via Graph
      if (rescheduleFormData.location === 'Teams') {
        let accessToken: string | null = null;
        try {
          const request = { ...loginRequest, account };
          accessToken = await getAccessTokenWithFallback(
            instance,
            request,
            account,
            () => toast.loading('Signing in to Microsoft...', { duration: 3000 })
          );
          if (!accessToken) {
            toast.error('Redirecting to sign in… If the page did not redirect, use "Sign in (this tab)" when the option appears.', { duration: 8000 });
            setIsReschedulingMeeting(false);
            return;
          }
        } catch (error) {
          if (error instanceof AuthPopupBlockedError) {
            authRedirectParamsRef.current = { request: { ...loginRequest, account }, account };
            setShowAuthRedirectOption(true);
            toast.error(error.message, { duration: 10000 });
            setIsReschedulingMeeting(false);
            return;
          }
          throw error;
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
      } else if (selectedLocationId === CUSTOM_LINK_LOCATION_ID) {
        teamsMeetingUrl = customLinkValue;
      } else if (selectedLocation?.default_link) {
        teamsMeetingUrl = selectedLocation.default_link;
      }

      // Use the isLegacyLead and legacyId already declared at the start of the function (line 2605-2606)
      let meetingSchedulerDisplayName = '---';
      if (canceledMeeting?.scheduler && canceledMeeting.scheduler !== '---') {
        meetingSchedulerDisplayName = canceledMeeting.scheduler;
      } else if (isLegacyLead) {
        const schedulerName = getEmployeeDisplayName(client.meeting_scheduler_id);
        if (schedulerName && schedulerName !== '--') {
          meetingSchedulerDisplayName = schedulerName;
        }
      } else if (client.scheduler) {
        const schedulerName = getEmployeeDisplayName(client.scheduler);
        meetingSchedulerDisplayName = schedulerName !== '--' ? schedulerName : String(client.scheduler);
      }

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
        scheduler: meetingSchedulerDisplayName,
        last_edited_timestamp: new Date().toISOString(),
        last_edited_by: editorDisplayName,
        calendar_type: 'active_client', // Always active_client for MeetingTab
        custom_link: selectedLocationId === CUSTOM_LINK_LOCATION_ID ? customLinkValue : null,
        custom_address: selectedLocationId === CUSTOM_ADDRESS_LOCATION_ID ? customAddressValue : null,
      };

      const { data: insertedData, error: meetingError } = await supabase
        .from('meetings')
        .insert([meetingData])
        .select();

      if (meetingError) {
        console.error('Meeting creation error:', meetingError);
        throw meetingError;
      }

      // Send notification email to client (only if notify toggle is on)
      if (notifyClientOnReschedule && client.email) {
        let accessToken: string | null = null;
        try {
          const request = { ...loginRequest, account };
          accessToken = await getAccessTokenWithFallback(
            instance,
            request,
            account,
            () => toast.loading('Signing in to Microsoft...', { duration: 3000 })
          );
          if (!accessToken) {
            toast.error('Redirecting to sign in… Use "Sign in (this tab)" if the option appears.');
            setIsReschedulingMeeting(false);
            return;
          }
        } catch (error) {
          if (error instanceof AuthPopupBlockedError) {
            authRedirectParamsRef.current = { request: { ...loginRequest, account }, account };
            setShowAuthRedirectOption(true);
            toast.error(error.message, { duration: 10000 });
            setIsReschedulingMeeting(false);
            return;
          }
          throw error;
        }

        const userName = account?.name || 'Staff';

        const rescheduleLocationRecord = resolveMeetingLocationRecord(rescheduleFormData.location);
        const rescheduleLocationName = getMeetingLocationName(rescheduleFormData.location);
        const includeRescheduleJoinLink = shouldIncludeMeetingJoinLink(
          rescheduleLocationRecord,
          rescheduleLocationName
        );
        const meetingLink = includeRescheduleJoinLink ? getValidTeamsLink(teamsMeetingUrl) : '';
        const teamsJoinUrlForReschedule =
          includeRescheduleJoinLink && meetingLink && getLinkType(meetingLink) === 'teams'
            ? meetingLink
            : undefined;
        const calendarLocationDisplayForReschedule =
          includeRescheduleJoinLink && rescheduleFormData.location === 'Teams'
            ? 'Microsoft Teams Meeting'
            : rescheduleFormData.location;
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
        let templateName: string | null = null;
        try {
          console.log('📧 Fetching rescheduled email template:', { clientLanguageId, isLegacyLead });

          if (!clientLanguageId) {
            console.warn('⚠️ No language_id found for client, cannot fetch template');
          } else {
            const { data: template, error: templateError } = await supabase
              .from('misc_emailtemplate')
              .select('content, name')
              .eq('name', 'rescheduled')
              .eq('language_id', clientLanguageId)
              .single();

            if (templateError) {
              console.error('❌ Error fetching rescheduled email template:', templateError);
            } else if (template && template.content) {
              // Store template name for subject
              templateName = template.name || null;

              // Try parsing, but if it returns empty, use raw content (might be HTML)
              const parsed = parseTemplateContent(template.content);
              templateContent = parsed && parsed.trim() ? parsed : template.content;
              console.log('✅ Rescheduled email template fetched successfully', {
                languageId: clientLanguageId,
                templateName: template.name,
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
          const rescheduleTemplateLang = clientLanguageId === 2 ? 'he' : 'en';
          emailBody = await formatEmailBody(templateContent, client.name, {
            client,
            meetingDate: formattedNewDate,
            meetingTime: formattedNewTime,
            meetingLocation: newLocationName,
            meetingLink: meetingLink || undefined,
            templateLanguage: rescheduleTemplateLang,
          });
        } else {
          console.warn('⚠️ Using fallback hardcoded email template for rescheduled meeting');
          // Fallback to hardcoded email (no signature - template emails should not include signatures)
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
              </div>
            `;
          }
        }

        // Use template name as subject, or fallback to hardcoded
        const emailSubject = templateName || (canceledMeeting
          ? `[${client.lead_number || client.id}] - ${client.name} - Meeting Rescheduled`
          : `[${client.lead_number || client.id}] - ${client.name} - New Meeting Scheduled`);

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
            location: calendarLocationDisplayForReschedule,
            description: emailBody,
            attendeeEmail: client.email,
            attendeeName: client.name,
            organizerEmail: account.username || 'noreply@lawoffice.org.il',
            organizerName: userName,
            teamsJoinUrl: teamsJoinUrlForReschedule,
            timeZone: 'Asia/Jerusalem'
          });

          await sendEmail(accessToken, {
            to: client.email,
            subject: emailSubject,
            body: emailBody,
            skipSignature: true // Don't include user signature in template emails
          });
        } catch (calendarError) {
          console.error('Failed to create calendar invitation:', calendarError);
          await sendEmail(accessToken, {
            to: client.email,
            subject: emailSubject,
            body: emailBody,
            skipSignature: true // Don't include user signature in template emails
          });
        }

        const rescheduleSentAt = new Date();
        await saveOutgoingEmailRecord({
          client,
          subject: emailSubject,
          htmlBody: emailBody,
          senderName: userName,
          senderEmail: account.username || 'noreply@lawoffice.org.il',
          recipientList: client.email,
          sentAt: rescheduleSentAt,
          messageId: `meeting_reschedule_${rescheduleSentAt.getTime()}`,
        });
      }

      toast.success(notifyClientOnReschedule ? 'Meeting rescheduled and client notified.' : 'Meeting rescheduled.');
      setShowRescheduleDrawer(false);
      setMeetingToDelete(null);
      setNotifyClientOnReschedule(false); // Reset to default
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
        custom_link: '',
        custom_address: '',
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

  const resetEditExternalState = useCallback(() => {
    const defaultType = internalMeetingTypes.find((t) => t.code === 'staff') || internalMeetingTypes[0] || null;
    setEditExternal({
      subject: '',
      internalMeetingTypeId: defaultType?.id ?? null,
      selectedStaffEmployeeIds: [],
      selectedFirmContactIds: [],
      freeParticipants: [],
      freeDraft: { name: '', email: '', phone: '', notes: '' },
    });
    setEditStaffSearch('');
    setEditFirmContactSearch('');
    setShowEditStaffDropdown(false);
    setShowEditFirmContactDropdown(false);
  }, [internalMeetingTypes]);

  const loadEditExternalFromMeeting = useCallback(async (meetingId: number, meeting?: Partial<Meeting>) => {
    try {
      const [{ data: partData, error: partErr }, { data: meetingRow }] = await Promise.all([
        supabase
          .from('meeting_participants')
          .select('employee_id, firm_contact_id, free_name, free_email, free_phone, notes')
          .eq('meeting_id', meetingId),
        supabase
          .from('meetings')
          .select('internal_meeting_type_id, meeting_subject')
          .eq('id', meetingId)
          .maybeSingle(),
      ]);
      if (partErr) throw partErr;

      const staffIds: number[] = [];
      const firmIds: string[] = [];
      const freeParticipants: FreeParticipant[] = [];
      (partData || []).forEach((r: any) => {
        if (r.employee_id != null) {
          staffIds.push(Number(r.employee_id));
        } else if (r.firm_contact_id) {
          firmIds.push(String(r.firm_contact_id));
        } else if (r.free_name) {
          freeParticipants.push({
            name: String(r.free_name).trim(),
            email: r.free_email ? String(r.free_email).trim() : undefined,
            phone: r.free_phone ? String(r.free_phone).trim() : undefined,
            notes: r.notes ? String(r.notes).trim() : undefined,
          });
        }
      });

      const defaultType = internalMeetingTypes.find((t) => t.code === 'staff') || internalMeetingTypes[0] || null;
      setEditExternal({
        subject: (meeting?.meeting_subject ?? meetingRow?.meeting_subject ?? '').trim(),
        internalMeetingTypeId: meetingRow?.internal_meeting_type_id != null
          ? Number(meetingRow.internal_meeting_type_id)
          : defaultType?.id ?? null,
        selectedStaffEmployeeIds: staffIds,
        selectedFirmContactIds: firmIds,
        freeParticipants,
        freeDraft: { name: '', email: '', phone: '', notes: '' },
      });
    } catch (error) {
      console.error('Failed to load edit participants', error);
      resetEditExternalState();
    }
  }, [internalMeetingTypes, resetEditExternalState]);

  const saveMeetingParticipantsForEdit = useCallback(async (
    meetingId: number,
    ext: {
      selectedStaffEmployeeIds: number[];
      selectedFirmContactIds: string[];
      freeParticipants: FreeParticipant[];
      freeDraft: FreeParticipant;
    }
  ) => {
    const freeDraftName = String(ext.freeDraft?.name || '').trim();
    const allFreeParticipants = [
      ...(ext.freeParticipants || []),
      ...(freeDraftName
        ? [{
            name: freeDraftName,
            email: (ext.freeDraft?.email || '').trim() || undefined,
            phone: (ext.freeDraft?.phone || '').trim() || undefined,
            notes: (ext.freeDraft?.notes || '').trim() || undefined,
          }]
        : []),
    ].filter((p) => p && typeof p.name === 'string' && p.name.trim() !== '');

    await supabase.from('meeting_participants').delete().eq('meeting_id', meetingId);

    const participantRows: any[] = [];
    ext.selectedStaffEmployeeIds.forEach((employeeId) =>
      participantRows.push({ meeting_id: meetingId, employee_id: employeeId })
    );
    ext.selectedFirmContactIds.forEach((firmContactId) =>
      participantRows.push({ meeting_id: meetingId, firm_contact_id: firmContactId })
    );
    allFreeParticipants.forEach((p) =>
      participantRows.push({
        meeting_id: meetingId,
        free_name: String(p.name).trim(),
        free_email: p.email ? String(p.email).trim() : null,
        free_phone: p.phone ? String(p.phone).trim() : null,
        notes: p.notes ? String(p.notes).trim() : null,
      })
    );

    if (participantRows.length > 0) {
      const { error: partErr } = await supabase.from('meeting_participants').insert(participantRows);
      if (partErr) throw partErr;
    }

    await loadMeetingParticipants(meetingId);
  }, [loadMeetingParticipants]);

  const renderMeetingCard = (meeting: Meeting) => {
    const formattedDate = new Date(meeting.date).toLocaleDateString('en-GB');

    const handleEditBrief = () => {
      setEditingBriefId(meeting.id);
      setEditedBrief(meeting.brief || '');
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
    const handleEditMeeting = async (meeting: Meeting) => {
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

      // Convert scheduler display name to employee ID for the dropdown
      // For new meetings, scheduler is stored as display name, but dropdown needs employee ID
      let schedulerId = meeting.scheduler;
      if (meeting.scheduler && typeof meeting.scheduler === 'string') {
        // Try to find employee by display name
        const employee = allEmployees.find((emp: any) =>
          emp.display_name === meeting.scheduler || emp.full_name === meeting.scheduler
        );
        if (employee) {
          schedulerId = employee.id;
        }
      }

      setEditedMeeting({
        date: meeting.date,
        time: meeting.time ? meeting.time.substring(0, 5) : meeting.time, // Remove seconds if present
        location: normalizedLocation,
        manager: meeting.manager,
        currency: meeting.currency,
        amount: meeting.amount,
        brief: meeting.brief,
        scheduler: schedulerId,
        helper: meeting.helper,
        car_number: meeting.car_number,
        custom_link: meeting.custom_link,
        custom_address: meeting.custom_address,
        manual_address: meeting.manual_address ?? null,
        extern1: meeting.extern1 ?? null,
        extern2: meeting.extern2 ?? null,
        meeting_subject: meeting.meeting_subject,
        calendar_type: meeting.calendar_type,
      });

      setEditGuest1SearchTerm('');
      setEditGuest2SearchTerm('');
      setShowEditGuest1Dropdown(false);
      setShowEditGuest2Dropdown(false);

      if (meeting.calendar_type === 'staff' && typeof meeting.id === 'number') {
        await loadEditExternalFromMeeting(Number(meeting.id), meeting);
      } else {
        resetEditExternalState();
      }
    };

    const handleCancelEditMeeting = () => {
      setEditingMeetingId(null);
      setEditedMeeting({});
      setEditLocationSearchTerm('');
      setEditManagerSearchTerm('');
      setEditSchedulerSearchTerm('');
      setEditHelperSearchTerm('');
      setEditGuest1SearchTerm('');
      setEditGuest2SearchTerm('');
      setShowEditLocationDropdown(false);
      setShowEditManagerDropdown(false);
      setShowEditSchedulerDropdown(false);
      setShowEditHelperDropdown(false);
      setShowEditGuest1Dropdown(false);
      setShowEditGuest2Dropdown(false);
      resetEditExternalState();
    };

    const handleSaveMeeting = async () => {
      if (!editingMeetingId) return;

      setIsUpdatingMeeting(true);
      try {
        const editor = await resolveEditorDisplayName();

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
          // Convert scheduler employee ID to number for legacy meetings
          const schedulerEmployeeId = editedMeeting.scheduler
            ? (typeof editedMeeting.scheduler === 'string' ? parseInt(editedMeeting.scheduler, 10) : Number(editedMeeting.scheduler))
            : null;

          const updateData: any = {
            meeting_date: editedMeeting.date,
            meeting_time: editedMeeting.time,
            meeting_location_id: locationIdValue,
            meeting_manager_id: editedMeeting.manager,
            meeting_total_currency_id: editedMeeting.currency === 'NIS' ? 1 : editedMeeting.currency === 'USD' ? 2 : 3,
            meeting_total: editedMeeting.amount,
            meeting_brief: editedMeeting.brief,
            meeting_scheduler_id: schedulerEmployeeId,
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
          const selectedLocationForEdit = allMeetingLocations.find(
            (loc: any) => String(loc.id) === String(editedMeeting.location) || loc.name === locationText
          );
          const selectedLocationIdForEdit = Number(selectedLocationForEdit?.id);
          const customLinkValue = (editedMeeting.custom_link || '').trim();
          const customAddressValue = (editedMeeting.custom_address || '').trim();

          if (selectedLocationIdForEdit === CUSTOM_LINK_LOCATION_ID && !customLinkValue) {
            toast.error('Please enter a custom link for this location.');
            setIsUpdatingMeeting(false);
            return;
          }
          if (selectedLocationIdForEdit === CUSTOM_ADDRESS_LOCATION_ID && !customAddressValue) {
            toast.error('Please enter a custom address for this location.');
            setIsUpdatingMeeting(false);
            return;
          }

          // Convert scheduler employee ID to display name for new meetings
          const schedulerDisplayName = editedMeeting.scheduler
            ? getEmployeeDisplayName(editedMeeting.scheduler)
            : null;

          const meetingCalendarType = originalMeeting?.calendar_type;

          const updateData: any = {
            meeting_date: editedMeeting.date,
            meeting_time: editedMeeting.time,
            meeting_location: locationText, // Use location name (text) for new leads
            meeting_brief: editedMeeting.brief,
            car_number: editedMeeting.car_number || null,
            custom_link: selectedLocationIdForEdit === CUSTOM_LINK_LOCATION_ID ? customLinkValue : null,
            custom_address: selectedLocationIdForEdit === CUSTOM_ADDRESS_LOCATION_ID ? customAddressValue : null,
            manual_address: (editedMeeting.manual_address || '').trim() || null,
            last_edited_timestamp: new Date().toISOString(),
            last_edited_by: editor,
          };

          if (meetingCalendarType === 'staff') {
            updateData.meeting_subject = editExternal.subject.trim() || originalMeeting?.meeting_subject || null;
            updateData.internal_meeting_type_id = editExternal.internalMeetingTypeId;
          } else {
            updateData.meeting_currency = editedMeeting.currency;
            updateData.meeting_amount = editedMeeting.amount;
            if (meetingCalendarType !== 'active_client') {
              updateData.meeting_manager = editedMeeting.manager;
              updateData.scheduler = schedulerDisplayName;
              updateData.helper = editedMeeting.helper;
            }
            if (meetingCalendarType === 'active_client' || meetingCalendarType === 'potential_client') {
              updateData.extern1 = editedMeeting.extern1 ? String(editedMeeting.extern1) : null;
              updateData.extern2 = editedMeeting.extern2 ? String(editedMeeting.extern2) : null;
            }
          }

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

        if (!isLegacyMeeting && originalMeeting?.calendar_type === 'staff' && typeof editingMeetingId === 'number') {
          await saveMeetingParticipantsForEdit(editingMeetingId, editExternal);
        }

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
              // Silently fail - meeting is already updated in database
            }
          }
        }

        toast.success('Meeting updated successfully');
        setMeetings(prev => prev.map(m =>
          m.id === editingMeetingId
            ? {
                ...m,
                ...editedMeeting,
                meeting_subject: originalMeeting?.calendar_type === 'staff'
                  ? (editExternal.subject.trim() || m.meeting_subject)
                  : m.meeting_subject,
                link: teamsMeetingUrl || m.link,
                lastEdited: { timestamp: new Date().toISOString(), user: editor },
              }
            : m
        ));

        setEditingMeetingId(null);
        setEditedMeeting({});
        setEditLocationSearchTerm('');
        setEditManagerSearchTerm('');
        setEditSchedulerSearchTerm('');
        setEditHelperSearchTerm('');
        setEditGuest1SearchTerm('');
        setEditGuest2SearchTerm('');
        setShowEditLocationDropdown(false);
        setShowEditManagerDropdown(false);
        setShowEditSchedulerDropdown(false);
        setShowEditHelperDropdown(false);
        setShowEditGuest1Dropdown(false);
        setShowEditGuest2Dropdown(false);
        resetEditExternalState();

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
    const headerColor = past ? '#6B7280' : 'rgb(25, 49, 31)'; // Grey for past, dark green for upcoming

    const calendarTypeBadge = getCalendarTypeBadgeStyles(meeting.calendar_type);
    const meetingFieldLabelClass = 'text-xs font-medium uppercase tracking-wide text-gray-500';
    const sideBtnClass =
      'btn btn-circle h-11 w-11 min-h-11 min-w-11 p-0 shrink-0 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 shadow-sm';

    // Action buttons rendered in the vertical side column on the right of the card.
    const sideActionButtons = (
      <div className="flex flex-col items-center gap-2 sm:gap-3">
        {typeof meeting.id === 'number' && !meeting.isLegacy && (
          <div className="relative shrink-0">
            <button
              className="btn btn-circle h-11 w-11 min-h-11 min-w-11 p-0 shrink-0 border border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 hover:border-violet-400 shadow-sm"
              onClick={() => setSummaryNotesMeeting(meeting)}
              title="Meeting Summary (AI)"
            >
              <DocumentTextIcon className="w-5 h-5" />
            </button>
            <span className="absolute -top-1 -right-1 min-w-[1.25rem] h-5 px-1 flex items-center justify-center text-[10px] font-bold leading-none bg-violet-600 text-white rounded-full border-2 border-white shadow-sm pointer-events-none">
              AI
            </span>
          </div>
        )}
        {/* Edit Button - only for upcoming meetings */}
        {!past && (
          <button
            className={sideBtnClass}
            onClick={() => handleEditMeeting(meeting)}
            title="Edit Meeting"
          >
            <PencilIcon className="w-5 h-5" />
          </button>
        )}
        {!past && (
          <>
            <div className="relative flex justify-center" ref={(el) => {
              if (el) {
                notifyDropdownRefs.current.set(meeting.id, el);
              } else {
                notifyDropdownRefs.current.delete(meeting.id);
              }
            }}>
              <button
                className={sideBtnClass}
                onClick={() => {
                  if (sendingEmailMeetingId !== meeting.id) {
                    setShowNotifyDropdown(showNotifyDropdown === meeting.id ? null : meeting.id);
                  }
                }}
                disabled={sendingEmailMeetingId === meeting.id}
                title="Notify Client via Email"
              >
                {sendingEmailMeetingId === meeting.id ? (
                  <span className="loading loading-spinner loading-sm"></span>
                ) : (
                  <OutlookIcon className="w-5 h-5" />
                )}
              </button>
              {showNotifyDropdown === meeting.id && (
                <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                  {/* Conditional Meeting Invitation based on location */}
                  {(() => {
                    const locationRaw = String(meeting.location ?? '').trim();
                    const location = (
                      isStaffOrInternalMeeting(meeting) && locationRaw
                        ? locationRaw
                        : getMeetingLocationName(meeting.location)
                    ).toLowerCase();

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
            <div className="relative flex justify-center" ref={(el) => {
              if (el) {
                whatsAppDropdownRefs.current.set(meeting.id, el);
              } else {
                whatsAppDropdownRefs.current.delete(meeting.id);
              }
            }}>
              <button
                className={sideBtnClass}
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
                  <span className="loading loading-spinner loading-sm"></span>
                ) : (
                  <FaWhatsapp className="w-5 h-5 text-green-600" aria-hidden="true" />
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
        {(() => {
          const meetingLinkValue = meeting.link;
          const validLink = getValidTeamsLink(meeting.link);
          const hasLink = meetingLinkValue && meetingLinkValue.trim() !== '';
          const locationName = getMeetingLocationName(meeting.location);
          const isTeams = locationName === 'Teams';
          const location = resolveMeetingLocationRecord(meeting.location);
          const defaultLink = location?.default_link;

          if (!past) {
            // Determine which link to use: default_link first (if available), then valid link
            const linkToUse = defaultLink || validLink;

            // If we have a link (either default_link or valid link), show it
            if (linkToUse) {
              // Check if the link being used is a Teams link
              const isTeamsLink = linkToUse === validLink && getLinkType(validLink) === 'teams';
              const iconToShow = isTeamsLink ? <VideoCameraIcon className="w-5 h-5" /> : <LinkIcon className="w-5 h-5" />;
              const title = isTeamsLink ? 'Join Teams Meeting' : 'Join Meeting';

              return (
                <div className="dropdown dropdown-end">
                  <button
                    type="button"
                    className={sideBtnClass}
                    title={title}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {iconToShow}
                  </button>
                  <ul
                    tabIndex={0}
                    className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52 z-[1000]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <li>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const url = getMeetingJoinLink(meeting);
                          if (!url) {
                            toast.error('No meeting URL available');
                            return;
                          }
                          window.open(url, '_blank');
                        }}
                      >
                        Enter meeting
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          const url = getMeetingJoinLink(meeting);
                          if (!url) {
                            toast.error('No meeting URL available');
                            return;
                          }
                          const ok = await copyTextToClipboard(url);
                          if (ok) toast.success('Meeting link copied');
                          else toast.error('Failed to copy link');
                        }}
                      >
                        Copy link
                      </button>
                    </li>
                    {typeof navigator !== 'undefined' && typeof (navigator as any).share === 'function' && (
                      <li>
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            const url = getMeetingJoinLink(meeting);
                            if (!url) {
                              toast.error('No meeting URL available');
                              return;
                            }
                            try {
                              await (navigator as any).share({ title: 'Meeting link', url });
                            } catch {
                              // user cancelled / unsupported
                            }
                          }}
                        >
                          Share
                        </button>
                      </li>
                    )}
                  </ul>
                </div>
              );
            }

            // Show "Create Teams" button only for Teams location if there's NO link at all
            if (isTeams && !hasLink && !defaultLink) {
              return (
                <button
                  className={sideBtnClass}
                  onClick={() => handleCreateTeamsMeeting(meeting)}
                  disabled={creatingTeamsMeetingId === meeting.id}
                  title="Create Teams Meeting"
                >
                  {creatingTeamsMeetingId === meeting.id ? (
                    <span className="loading loading-spinner loading-sm"></span>
                  ) : (
                    <VideoCameraIcon className="w-5 h-5" />
                  )}
                </button>
              );
            }
          }
          return null;
        })()}
        {/* Fallback for legacy stored URL strings that don't parse as Teams JSON but still look like a URL */}
        {(() => {
          const raw = (meeting.link || '').trim();
          const looksLikeUrl = /^https?:\/\//i.test(raw);
          if (!raw || !looksLikeUrl) return null;
          if (getMeetingJoinLink(meeting)) return null; // already handled above
          return (
            <div className="dropdown dropdown-end">
              <button
                type="button"
                className={sideBtnClass}
                onClick={(e) => e.stopPropagation()}
                title="Meeting link"
              >
                <LinkIcon className="w-5 h-5" />
              </button>
              <ul
                tabIndex={0}
                className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52 z-[1000]"
                onClick={(e) => e.stopPropagation()}
              >
                <li>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(raw, '_blank');
                    }}
                  >
                    Enter meeting
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const ok = await copyTextToClipboard(raw);
                      if (ok) toast.success('Meeting link copied');
                      else toast.error('Failed to copy link');
                    }}
                  >
                    Copy link
                  </button>
                </li>
                {typeof navigator !== 'undefined' && typeof (navigator as any).share === 'function' && (
                  <li>
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await (navigator as any).share({ title: 'Meeting link', url: raw });
                        } catch {
                          // user cancelled / unsupported
                        }
                      }}
                    >
                      Share
                    </button>
                  </li>
                )}
              </ul>
            </div>
          );
        })()}
      </div>
    );

    const canUseSummaryNotes = typeof meeting.id === 'number' && !meeting.isLegacy;
    const hasAnyActionButton = canUseSummaryNotes || !past;

    const amountDisplay =
      meeting.amount && meeting.amount > 0
        ? `${getCurrencySymbol(meeting.currency)} ${typeof meeting.amount === 'number' ? meeting.amount.toLocaleString() : meeting.amount}`
        : '--';
    const carNumberDisplay = meeting.car_number?.trim() ? meeting.car_number.trim() : '--';
    const isActiveMeeting = meeting.calendar_type === 'active_client';
    const isStaffMeeting = meeting.calendar_type === 'staff';
    const isPotentialMeeting = meeting.calendar_type === 'potential_client';
    const handlerEmployeeId = client.case_handler_id ?? client.handler;
    const retentionHandlerId = (client as any).retainer_handler_id ?? (client as any).retainer_handler;
    const roleLeadId = isActiveMeeting ? handlerEmployeeId : meeting.manager;
    const roleLeadLabel = isActiveMeeting ? 'Handler' : 'Manager';
    const hasGuestEmployee = (guestId?: string | null) =>
      Boolean(guestId && guestId !== '--' && String(guestId).trim() !== '');
    const participantBundle =
      typeof meeting.id === 'number' ? meetingParticipantsById[Number(meeting.id)] : undefined;

    return (
      <div key={meeting.id} className="bg-white border border-gray-200 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 relative flex max-w-full">
        {/* Canceled watermark */}
        {meeting.status === 'canceled' && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="bg-red-500 text-white px-4 py-2 rounded-lg transform -rotate-12 font-bold text-lg shadow-lg">
              CANCELED
            </div>
          </div>
        )}
        <div className="flex-1 min-w-0 overflow-hidden rounded-l-xl">
        {/* Header */}
        <div className="px-2 sm:px-4 py-2 sm:py-3 border-b" style={{ backgroundColor: headerColor, color: 'white' }}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-lg shadow-sm flex-shrink-0" style={{ backgroundColor: headerColor }}>
                <CalendarIcon className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-sm sm:text-lg text-white truncate">{formattedDate}</p>
                <div className="flex items-center gap-1 sm:gap-2 text-white flex-wrap">
                  <ClockIcon className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
                  <span className="text-xs sm:text-sm font-medium">{meeting.time ? meeting.time.substring(0, 5) : ''}</span>
                  <span className="hidden md:inline-flex items-center gap-1.5 min-w-0 text-white/90">
                    <span className="text-white/50" aria-hidden="true">·</span>
                    <MapPinIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" aria-hidden="true" />
                    <span className="text-xs sm:text-sm font-medium truncate" title={getMeetingLocationName(meeting.location)}>
                      {getMeetingLocationName(meeting.location)}
                    </span>
                  </span>
                  <span className="hidden md:inline text-white/50" aria-hidden="true">·</span>
                  <span className="hidden md:inline text-xs sm:text-sm font-medium text-white/90 whitespace-nowrap" title={`Amount: ${amountDisplay}`}>
                    {amountDisplay}
                  </span>
                  <span className="hidden md:inline text-white/50" aria-hidden="true">·</span>
                  <span className="hidden md:inline text-xs sm:text-sm font-medium text-white/90 whitespace-nowrap" title={`Car number: ${carNumberDisplay}`}>
                    {carNumberDisplay}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 min-w-0 sm:flex-row sm:items-center sm:gap-2 shrink">
              {meeting.calendar_type === 'staff' && meeting.meeting_subject?.trim() && (
                <span
                  className="text-xs sm:text-sm font-semibold text-white truncate max-w-[140px] sm:max-w-xs text-right"
                  title={meeting.meeting_subject.trim()}
                >
                  {meeting.meeting_subject.trim()}
                </span>
              )}
              {/* Meeting Type Badge (P / A / IM) — same style as CalendarPage */}
              {calendarTypeBadge && (
                <span
                  className="inline-flex items-center justify-center min-w-[2.25rem] px-3 py-1.5 rounded-full text-sm font-bold whitespace-nowrap flex-shrink-0 border border-white/40 bg-white/20 text-white backdrop-blur-md shadow-sm"
                  title={
                    meeting.calendar_type === 'staff'
                      ? 'Internal Meeting (External Participants)'
                      : meeting.calendar_type === 'active_client'
                        ? 'Active Client'
                        : 'Potential Client'
                  }
                >
                  {calendarTypeBadge.label}
                </span>
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
                    <label className={meetingFieldLabelClass}>Date</label>
                    <input
                      type="date"
                      className="input input-bordered w-full"
                      value={editedMeeting.date || ''}
                      onChange={(e) => {
                        setEditedMeeting(prev => ({ ...prev, date: e.target.value }));
                        setMeetingCountsByTime({});
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <TimePicker
                      value={editedMeeting.time || (meeting.time ? meeting.time.substring(0, 5) : '09:00')}
                      onChange={(time) => setEditedMeeting(prev => ({ ...prev, time }))}
                      meetingCounts={editedMeeting.date ? meetingCountsByTime : {}}
                      label="Time"
                    />
                  </div>
                </div>

                {/* Location (+ role / participant fields by meeting type) */}
                <div className={`grid grid-cols-1 gap-3 ${isStaffMeeting || isActiveMeeting ? '' : 'md:grid-cols-2'}`}>
                  <div className="space-y-2 relative" ref={editLocationDropdownRef}>
                    <label className={meetingFieldLabelClass}>Location</label>
                    <input
                      type="text"
                      className="input input-bordered w-full"
                      placeholder="Select location..."
                      value={editLocationSearchTerm !== '' ? editLocationSearchTerm : (getMeetingLocationName(editedMeeting.location) || '')}
                      onChange={(e) => {
                        const value = e.target.value;
                        setEditLocationSearchTerm(value);
                        setShowEditLocationDropdown(true);
                      }}
                      onFocus={() => {
                        setEditLocationSearchTerm(getMeetingLocationName(editedMeeting.location) || '');
                        setShowEditLocationDropdown(true);
                      }}
                      onBlur={() => {
                        setTimeout(() => {
                          setEditLocationSearchTerm('');
                          setShowEditLocationDropdown(false);
                        }, 200);
                      }}
                      autoComplete="off"
                    />
                    {showEditLocationDropdown && (
                      <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                        {selectableMeetingLocations
                          .filter((location: any) => {
                            const searchTerm = editLocationSearchTerm.toLowerCase();
                            return !searchTerm || location.name.toLowerCase().includes(searchTerm);
                          })
                          .map((location: any) => (
                            <div
                              key={location.id}
                              className="px-4 py-2 cursor-pointer hover:bg-gray-100"
                              onClick={() => {
                                setEditedMeeting(prev => ({ ...prev, location: location.id }));
                                if (Number(location.id) === CUSTOM_LINK_LOCATION_ID) {
                                  openCustomLocationModal('edit', 'link', editedMeeting.custom_link || '');
                                } else if (Number(location.id) === CUSTOM_ADDRESS_LOCATION_ID) {
                                  openCustomLocationModal('edit', 'address', editedMeeting.custom_address || '');
                                }
                                setEditLocationSearchTerm('');
                                setShowEditLocationDropdown(false);
                              }}
                            >
                              {location.name}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  {!isStaffMeeting && !isActiveMeeting && (
                    <div className="space-y-2 relative" ref={editManagerDropdownRef}>
                      <label className={meetingFieldLabelClass}>Manager</label>
                      <input
                        type="text"
                        className="input input-bordered w-full"
                        placeholder="Select manager..."
                        value={editManagerSearchTerm !== '' ? editManagerSearchTerm : (getEmployeeDisplayName(editedMeeting.manager) || '')}
                        onChange={(e) => {
                          setEditManagerSearchTerm(e.target.value);
                          setShowEditManagerDropdown(true);
                        }}
                        onFocus={() => {
                          setEditManagerSearchTerm(getEmployeeDisplayName(editedMeeting.manager) || '');
                          setShowEditManagerDropdown(true);
                        }}
                        onBlur={() => {
                          setTimeout(() => {
                            setEditManagerSearchTerm('');
                            setShowEditManagerDropdown(false);
                          }, 200);
                        }}
                        autoComplete="off"
                      />
                      {showEditManagerDropdown && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                          {allEmployees
                            .filter((emp: any) => {
                              const searchTerm = editManagerSearchTerm.toLowerCase();
                              const displayName = (emp.display_name || emp.full_name || '').toLowerCase();
                              return !searchTerm || displayName.includes(searchTerm);
                            })
                            .map((emp: any) => (
                              <div
                                key={emp.id}
                                className="px-4 py-2 cursor-pointer hover:bg-gray-100 flex items-center gap-3"
                                onClick={() => {
                                  setEditedMeeting(prev => ({ ...prev, manager: emp.id }));
                                  setEditManagerSearchTerm('');
                                  setShowEditManagerDropdown(false);
                                }}
                              >
                                <EmployeeAvatar employeeId={emp.id} size="sm" />
                                <span>{emp.display_name || emp.full_name}</span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {Number(editedMeeting.location) === CUSTOM_LINK_LOCATION_ID && (
                  <div className="space-y-2">
                    <label className={meetingFieldLabelClass}>Custom Link</label>
                    <button
                      type="button"
                      className="btn btn-outline w-full justify-start"
                      onClick={() => openCustomLocationModal('edit', 'link', editedMeeting.custom_link || '')}
                    >
                      {editedMeeting.custom_link?.trim() || 'Set custom link'}
                    </button>
                  </div>
                )}
                {Number(editedMeeting.location) === CUSTOM_ADDRESS_LOCATION_ID && (
                  <div className="space-y-2">
                    <label className={meetingFieldLabelClass}>Custom Address</label>
                    <button
                      type="button"
                      className="btn btn-outline w-full justify-start"
                      onClick={() => openCustomLocationModal('edit', 'address', editedMeeting.custom_address || '')}
                    >
                      {editedMeeting.custom_address?.trim() || 'Set custom address'}
                    </button>
                  </div>
                )}

                {!(meeting as any).isLegacy && (
                  <div className="space-y-2">
                    <label className={meetingFieldLabelClass}>Manual Address</label>
                    <textarea
                      className="textarea textarea-bordered w-full min-h-[72px] text-base"
                      value={editedMeeting.manual_address || ''}
                      onChange={(e) => setEditedMeeting((prev) => ({ ...prev, manual_address: e.target.value }))}
                      placeholder="Street, city, floor, parking instructions…"
                      rows={2}
                    />
                    <p className="text-xs text-gray-500">
                      Optional address for emails and WhatsApp reminders (independent of location).
                    </p>
                  </div>
                )}

                {isStaffMeeting && (
                  <>
                    <div className="space-y-2">
                      <label className={meetingFieldLabelClass}>Meeting Subject</label>
                      <input
                        type="text"
                        className="input input-bordered w-full"
                        placeholder="Internal meeting subject"
                        value={editExternal.subject}
                        onChange={(e) => setEditExternal((prev) => ({ ...prev, subject: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className={meetingFieldLabelClass}>Internal Meeting Type</label>
                      <select
                        className="select select-bordered w-full"
                        value={editExternal.internalMeetingTypeId != null ? String(editExternal.internalMeetingTypeId) : ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setEditExternal((prev) => ({ ...prev, internalMeetingTypeId: v === '' ? null : Number(v) }));
                        }}
                        disabled={internalMeetingTypes.length === 0}
                      >
                        {internalMeetingTypes.length === 0 ? (
                          <option value="">Loading types…</option>
                        ) : (
                          internalMeetingTypes.map((t) => (
                            <option key={t.id} value={String(t.id)}>{t.label}</option>
                          ))
                        )}
                      </select>
                    </div>
                    <div className="relative space-y-2" ref={editStaffDropdownRef}>
                      <label className={meetingFieldLabelClass}>Staff Attendees</label>
                      <input
                        type="text"
                        className="input input-bordered w-full"
                        placeholder="Search staff..."
                        value={editStaffSearch}
                        onFocus={() => setShowEditStaffDropdown(true)}
                        onChange={(e) => { setEditStaffSearch(e.target.value); setShowEditStaffDropdown(true); }}
                      />
                      {showEditStaffDropdown && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                          {(allEmployees || [])
                            .filter((e: any) => {
                              const q = editStaffSearch.trim().toLowerCase();
                              return !q || (e.display_name || '').toLowerCase().includes(q);
                            })
                            .map((emp: any) => {
                              const isSelected = editExternal.selectedStaffEmployeeIds.includes(Number(emp.id));
                              return (
                                <div
                                  key={emp.id}
                                  className={`px-4 py-2 cursor-pointer flex items-center justify-between ${isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-gray-100'}`}
                                  onClick={() => {
                                    setEditExternal((prev) => ({
                                      ...prev,
                                      selectedStaffEmployeeIds: isSelected
                                        ? prev.selectedStaffEmployeeIds.filter((id) => id !== Number(emp.id))
                                        : [...prev.selectedStaffEmployeeIds, Number(emp.id)],
                                    }));
                                  }}
                                >
                                  <span>{emp.display_name}</span>
                                  {isSelected && <span className="text-xs">Selected</span>}
                                </div>
                              );
                            })}
                        </div>
                      )}
                      {editExternal.selectedStaffEmployeeIds.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {editExternal.selectedStaffEmployeeIds.map((id) => {
                            const emp = (allEmployees || []).find((e: any) => Number(e.id) === id);
                            return (
                              <span key={id} className="badge badge-outline gap-2">
                                {emp?.display_name || id}
                                <button
                                  type="button"
                                  className="text-gray-500 hover:text-gray-800"
                                  onClick={() => setEditExternal((prev) => ({
                                    ...prev,
                                    selectedStaffEmployeeIds: prev.selectedStaffEmployeeIds.filter((x) => x !== id),
                                  }))}
                                >×</button>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="relative space-y-2" ref={editFirmContactDropdownRef}>
                      <label className={meetingFieldLabelClass}>Firm Contacts</label>
                      <input
                        type="text"
                        className="input input-bordered w-full"
                        placeholder="Search firm contacts..."
                        value={editFirmContactSearch}
                        onFocus={() => setShowEditFirmContactDropdown(true)}
                        onChange={(e) => { setEditFirmContactSearch(e.target.value); setShowEditFirmContactDropdown(true); }}
                      />
                      {showEditFirmContactDropdown && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                          {(() => {
                            const q = editFirmContactSearch.trim().toLowerCase();
                            const list = (q
                              ? firmContacts.filter((c) => c.name.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q))
                              : firmContacts
                            ).slice(0, 50);
                            return list.length > 0 ? list.map((c) => {
                              const isSelected = editExternal.selectedFirmContactIds.includes(c.id);
                              return (
                                <div
                                  key={c.id}
                                  className={`px-4 py-2 cursor-pointer flex items-center justify-between ${isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-gray-100'}`}
                                  onClick={() => {
                                    setEditExternal((prev) => ({
                                      ...prev,
                                      selectedFirmContactIds: isSelected
                                        ? prev.selectedFirmContactIds.filter((id) => id !== c.id)
                                        : [...prev.selectedFirmContactIds, c.id],
                                    }));
                                  }}
                                >
                                  <div className="min-w-0">
                                    <div className="font-semibold truncate">{c.name}</div>
                                    <div className="text-xs text-gray-500 truncate">{c.email || c.phone || ''}</div>
                                  </div>
                                  {isSelected && <span className="text-xs ml-2">Selected</span>}
                                </div>
                              );
                            }) : (
                              <div className="px-4 py-2 text-gray-500 text-center">No matches</div>
                            );
                          })()}
                        </div>
                      )}
                      {editExternal.selectedFirmContactIds.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {editExternal.selectedFirmContactIds.map((id) => {
                            const c = firmContacts.find((x) => x.id === id);
                            if (!c) return null;
                            return (
                              <span key={id} className="badge badge-outline gap-2">
                                {c.name}
                                <button
                                  type="button"
                                  className="text-gray-500 hover:text-gray-800"
                                  onClick={() => setEditExternal((prev) => ({
                                    ...prev,
                                    selectedFirmContactIds: prev.selectedFirmContactIds.filter((x) => x !== id),
                                  }))}
                                >×</button>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label className={meetingFieldLabelClass}>Extern Participant</label>
                      <div className="grid grid-cols-1 gap-2">
                        <input
                          className="input input-bordered w-full"
                          placeholder="Name"
                          value={editExternal.freeDraft.name}
                          onChange={(e) => setEditExternal((prev) => ({ ...prev, freeDraft: { ...prev.freeDraft, name: e.target.value } }))}
                        />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <input
                            className="input input-bordered w-full"
                            placeholder="Email (optional)"
                            value={editExternal.freeDraft.email || ''}
                            onChange={(e) => setEditExternal((prev) => ({ ...prev, freeDraft: { ...prev.freeDraft, email: e.target.value } }))}
                          />
                          <input
                            className="input input-bordered w-full"
                            placeholder="Phone (optional)"
                            value={editExternal.freeDraft.phone || ''}
                            onChange={(e) => setEditExternal((prev) => ({ ...prev, freeDraft: { ...prev.freeDraft, phone: e.target.value } }))}
                          />
                        </div>
                        <textarea
                          className="textarea textarea-bordered w-full"
                          placeholder="Notes (optional)"
                          value={editExternal.freeDraft.notes || ''}
                          onChange={(e) => setEditExternal((prev) => ({ ...prev, freeDraft: { ...prev.freeDraft, notes: e.target.value } }))}
                        />
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={() => {
                            const name = (editExternal.freeDraft.name || '').trim();
                            if (!name) { toast.error('Extern participant name is required'); return; }
                            setEditExternal((prev) => ({
                              ...prev,
                              freeParticipants: [
                                ...prev.freeParticipants,
                                {
                                  name,
                                  email: (prev.freeDraft.email || '').trim() || undefined,
                                  phone: (prev.freeDraft.phone || '').trim() || undefined,
                                  notes: (prev.freeDraft.notes || '').trim() || undefined,
                                },
                              ],
                              freeDraft: { name: '', email: '', phone: '', notes: '' },
                            }));
                          }}
                        >
                          Add participant
                        </button>
                      </div>
                      {editExternal.freeParticipants.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {editExternal.freeParticipants.map((p, idx) => (
                            <span key={`${p.name}-${idx}`} className="badge badge-outline gap-2">
                              {p.name}
                              <button
                                type="button"
                                className="text-gray-500 hover:text-gray-800"
                                onClick={() => setEditExternal((prev) => ({
                                  ...prev,
                                  freeParticipants: prev.freeParticipants.filter((_, i) => i !== idx),
                                }))}
                              >×</button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {isActiveMeeting && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className={meetingFieldLabelClass}>Handler</label>
                      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                        <EmployeeAvatar employeeId={handlerEmployeeId} size="sm" />
                        <span className="text-sm text-gray-700">{getEmployeeDisplayName(handlerEmployeeId) || '--'}</span>
                      </div>
                      <p className="text-xs text-gray-400">Handler is managed in Roles and cannot be changed here.</p>
                    </div>
                    <div className="space-y-2">
                      <label className={meetingFieldLabelClass}>Retention Handler</label>
                      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                        <EmployeeAvatar employeeId={retentionHandlerId} size="sm" />
                        <span className="text-sm text-gray-700">{getEmployeeDisplayName(retentionHandlerId) || '--'}</span>
                      </div>
                    </div>
                  </div>
                )}

                {!isStaffMeeting && isPotentialMeeting && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2 relative" ref={editSchedulerDropdownRef}>
                      <label className={meetingFieldLabelClass}>Scheduler</label>
                      <input
                        type="text"
                        className="input input-bordered w-full"
                        placeholder="Select scheduler..."
                        value={editSchedulerSearchTerm !== '' ? editSchedulerSearchTerm : (getEmployeeDisplayName(editedMeeting.scheduler) || '')}
                        onChange={(e) => {
                          setEditSchedulerSearchTerm(e.target.value);
                          setShowEditSchedulerDropdown(true);
                        }}
                        onFocus={() => {
                          setEditSchedulerSearchTerm(getEmployeeDisplayName(editedMeeting.scheduler) || '');
                          setShowEditSchedulerDropdown(true);
                        }}
                        onBlur={() => {
                          setTimeout(() => {
                            setEditSchedulerSearchTerm('');
                            setShowEditSchedulerDropdown(false);
                          }, 200);
                        }}
                        autoComplete="off"
                      />
                      {showEditSchedulerDropdown && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                          {allEmployees
                            .filter((emp: any) => {
                              const searchTerm = editSchedulerSearchTerm.toLowerCase();
                              const displayName = (emp.display_name || emp.full_name || '').toLowerCase();
                              return !searchTerm || displayName.includes(searchTerm);
                            })
                            .map((emp: any) => (
                              <div
                                key={emp.id}
                                className="px-4 py-2 cursor-pointer hover:bg-gray-100 flex items-center gap-3"
                                onClick={() => {
                                  setEditedMeeting(prev => ({ ...prev, scheduler: emp.id }));
                                  setEditSchedulerSearchTerm('');
                                  setShowEditSchedulerDropdown(false);
                                }}
                              >
                                <EmployeeAvatar employeeId={emp.id} size="sm" />
                                <span>{emp.display_name || emp.full_name}</span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                    <div className="space-y-2 relative" ref={editHelperDropdownRef}>
                      <label className={meetingFieldLabelClass}>Helper</label>
                      <input
                        type="text"
                        className="input input-bordered w-full"
                        placeholder="Select helper..."
                        value={editHelperSearchTerm !== '' ? editHelperSearchTerm : (getEmployeeDisplayName(editedMeeting.helper) || '')}
                        onChange={(e) => {
                          setEditHelperSearchTerm(e.target.value);
                          setShowEditHelperDropdown(true);
                        }}
                        onFocus={() => {
                          setEditHelperSearchTerm(getEmployeeDisplayName(editedMeeting.helper) || '');
                          setShowEditHelperDropdown(true);
                        }}
                        onBlur={() => {
                          setTimeout(() => {
                            setEditHelperSearchTerm('');
                            setShowEditHelperDropdown(false);
                          }, 200);
                        }}
                        autoComplete="off"
                      />
                      {showEditHelperDropdown && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                          {allEmployees
                            .filter((emp: any) => {
                              const searchTerm = editHelperSearchTerm.toLowerCase();
                              const displayName = (emp.display_name || emp.full_name || '').toLowerCase();
                              return !searchTerm || displayName.includes(searchTerm);
                            })
                            .map((emp: any) => (
                              <div
                                key={emp.id}
                                className="px-4 py-2 cursor-pointer hover:bg-gray-100 flex items-center gap-3"
                                onClick={() => {
                                  setEditedMeeting(prev => ({ ...prev, helper: emp.id }));
                                  setEditHelperSearchTerm('');
                                  setShowEditHelperDropdown(false);
                                }}
                              >
                                <EmployeeAvatar employeeId={emp.id} size="sm" />
                                <span>{emp.display_name || emp.full_name}</span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {(isActiveMeeting || isPotentialMeeting) && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2 relative" ref={editGuest1DropdownRef}>
                      <label className={meetingFieldLabelClass}>Guest 1</label>
                      <input
                        type="text"
                        className="input input-bordered w-full"
                        placeholder="Select guest..."
                        value={editGuest1SearchTerm !== '' ? editGuest1SearchTerm : (hasGuestEmployee(editedMeeting.extern1) ? getEmployeeDisplayName(editedMeeting.extern1) : '')}
                        onChange={(e) => {
                          setEditGuest1SearchTerm(e.target.value);
                          setShowEditGuest1Dropdown(true);
                        }}
                        onFocus={() => {
                          setEditGuest1SearchTerm(hasGuestEmployee(editedMeeting.extern1) ? getEmployeeDisplayName(editedMeeting.extern1) : '');
                          setShowEditGuest1Dropdown(true);
                        }}
                        onBlur={() => {
                          setTimeout(() => {
                            setEditGuest1SearchTerm('');
                            setShowEditGuest1Dropdown(false);
                          }, 200);
                        }}
                        autoComplete="off"
                      />
                      {hasGuestEmployee(editedMeeting.extern1) && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs mt-1"
                          onClick={() => setEditedMeeting((prev) => ({ ...prev, extern1: null }))}
                        >
                          Clear guest
                        </button>
                      )}
                      {showEditGuest1Dropdown && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                          {allEmployees
                            .filter((emp: any) => {
                              const searchTerm = editGuest1SearchTerm.toLowerCase();
                              const displayName = (emp.display_name || emp.full_name || '').toLowerCase();
                              return !searchTerm || displayName.includes(searchTerm);
                            })
                            .map((emp: any) => (
                              <div
                                key={emp.id}
                                className="px-4 py-2 cursor-pointer hover:bg-gray-100 flex items-center gap-3"
                                onClick={() => {
                                  setEditedMeeting((prev) => ({ ...prev, extern1: String(emp.id) }));
                                  setEditGuest1SearchTerm('');
                                  setShowEditGuest1Dropdown(false);
                                }}
                              >
                                <EmployeeAvatar employeeId={emp.id} size="sm" />
                                <span>{emp.display_name || emp.full_name}</span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                    <div className="space-y-2 relative" ref={editGuest2DropdownRef}>
                      <label className={meetingFieldLabelClass}>Guest 2</label>
                      <input
                        type="text"
                        className="input input-bordered w-full"
                        placeholder="Select guest..."
                        value={editGuest2SearchTerm !== '' ? editGuest2SearchTerm : (hasGuestEmployee(editedMeeting.extern2) ? getEmployeeDisplayName(editedMeeting.extern2) : '')}
                        onChange={(e) => {
                          setEditGuest2SearchTerm(e.target.value);
                          setShowEditGuest2Dropdown(true);
                        }}
                        onFocus={() => {
                          setEditGuest2SearchTerm(hasGuestEmployee(editedMeeting.extern2) ? getEmployeeDisplayName(editedMeeting.extern2) : '');
                          setShowEditGuest2Dropdown(true);
                        }}
                        onBlur={() => {
                          setTimeout(() => {
                            setEditGuest2SearchTerm('');
                            setShowEditGuest2Dropdown(false);
                          }, 200);
                        }}
                        autoComplete="off"
                      />
                      {hasGuestEmployee(editedMeeting.extern2) && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs mt-1"
                          onClick={() => setEditedMeeting((prev) => ({ ...prev, extern2: null }))}
                        >
                          Clear guest
                        </button>
                      )}
                      {showEditGuest2Dropdown && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                          {allEmployees
                            .filter((emp: any) => {
                              const searchTerm = editGuest2SearchTerm.toLowerCase();
                              const displayName = (emp.display_name || emp.full_name || '').toLowerCase();
                              return !searchTerm || displayName.includes(searchTerm);
                            })
                            .map((emp: any) => (
                              <div
                                key={emp.id}
                                className="px-4 py-2 cursor-pointer hover:bg-gray-100 flex items-center gap-3"
                                onClick={() => {
                                  setEditedMeeting((prev) => ({ ...prev, extern2: String(emp.id) }));
                                  setEditGuest2SearchTerm('');
                                  setShowEditGuest2Dropdown(false);
                                }}
                              >
                                <EmployeeAvatar employeeId={emp.id} size="sm" />
                                <span>{emp.display_name || emp.full_name}</span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {!isStaffMeeting && (
                <>
                {/* Amount */}
                <div className="space-y-2">
                  <label className={meetingFieldLabelClass}>Amount</label>
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
                      className="input input-bordered flex-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      placeholder={meeting.amount ? meeting.amount.toString() : "Amount"}
                      value={editedMeeting.amount || ''}
                      onChange={(e) => setEditedMeeting(prev => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))}
                    />
                  </div>
                </div>

                {/* Car Number */}
                <div className="space-y-2">
                  <label className={meetingFieldLabelClass}>Car Number</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    placeholder={meeting.car_number || "Enter car number"}
                    value={editedMeeting.car_number || ''}
                    onChange={(e) => setEditedMeeting(prev => ({ ...prev, car_number: e.target.value }))}
                  />
                </div>
                </>
                )}

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
              <div className={`grid grid-cols-2 gap-3 sm:gap-3 ${isStaffMeeting ? 'md:grid-cols-1' : isActiveMeeting ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
                <div className="space-y-2 sm:space-y-2 md:hidden">
                  <label className={meetingFieldLabelClass}>Location</label>
                  <div className="flex items-center gap-2 sm:gap-2">
                    <MapPinIcon className="w-4 h-4 sm:w-4 sm:h-4 text-gray-400" />
                    <span className="text-sm sm:text-base text-gray-900">{getMeetingLocationName(meeting.location)}</span>
                  </div>
                </div>
                {meeting.manual_address?.trim() && (
                  <div className="space-y-2 sm:space-y-2 col-span-2">
                    <label className={meetingFieldLabelClass}>Manual Address</label>
                    <div className="flex items-start gap-2 sm:gap-2">
                      <MapPinIcon className="w-4 h-4 sm:w-4 sm:h-4 text-gray-400 mt-0.5 shrink-0" />
                      <span className="text-sm sm:text-base text-gray-900 whitespace-pre-wrap">{meeting.manual_address.trim()}</span>
                    </div>
                  </div>
                )}
                {isStaffMeeting ? (
                  <div className="space-y-2 sm:space-y-2 col-span-2 md:col-span-1">
                    <label className={meetingFieldLabelClass}>Participants</label>
                    {participantBundle?.loading ? (
                      <div className="flex items-center gap-2 py-1">
                        <span className="loading loading-spinner loading-sm"></span>
                        <span className="text-sm text-gray-500">Loading participants…</span>
                      </div>
                    ) : participantBundle?.participants?.length ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {participantBundle.participants.map((participant) => (
                          <div key={participant.id} className="flex items-center gap-2 min-w-0">
                            {renderMeetingParticipantAvatar(participant)}
                            <div className="min-w-0 flex-1">
                              <div className="text-sm sm:text-base text-gray-900 truncate" title={participant.name}>
                                {participant.name}
                              </div>
                              {participant.subtitle ? (
                                <div className="text-xs text-gray-500 truncate" title={participant.subtitle}>
                                  {participant.subtitle}
                                </div>
                              ) : null}
                              <span className={`inline-flex items-center mt-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${getParticipantBadgeClass(participant.type)}`}>
                                {participant.badge}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm sm:text-base text-gray-900">--</span>
                    )}
                  </div>
                ) : (
                  <>
                <div className="space-y-2 sm:space-y-2">
                  <label className={meetingFieldLabelClass}>{roleLeadLabel}</label>
                  <div className="flex items-center gap-2 sm:gap-2">
                    <EmployeeAvatar employeeId={roleLeadId} size="md" />
                    <span className="text-sm sm:text-base text-gray-900">{getEmployeeDisplayName(roleLeadId)}</span>
                  </div>
                </div>
                {isActiveMeeting && (
                  <div className="space-y-2 sm:space-y-2">
                    <label className={meetingFieldLabelClass}>Retention Handler</label>
                    <div className="flex items-center gap-2 sm:gap-2">
                      <EmployeeAvatar employeeId={retentionHandlerId} size="md" />
                      <span className="text-sm sm:text-base text-gray-900">{getEmployeeDisplayName(retentionHandlerId) || '--'}</span>
                    </div>
                  </div>
                )}
                {(isActiveMeeting || isPotentialMeeting) && (
                  <>
                    <div className="space-y-2 sm:space-y-2">
                      <label className={meetingFieldLabelClass}>Guest 1</label>
                      <div className="flex items-center gap-2 sm:gap-2">
                        {hasGuestEmployee(meeting.extern1) ? (
                          <>
                            <EmployeeAvatar employeeId={meeting.extern1} size="md" />
                            <span className="text-sm sm:text-base text-gray-900">{getEmployeeDisplayName(meeting.extern1)}</span>
                          </>
                        ) : (
                          <span className="text-sm sm:text-base text-gray-900">--</span>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2 sm:space-y-2">
                      <label className={meetingFieldLabelClass}>Guest 2</label>
                      <div className="flex items-center gap-2 sm:gap-2">
                        {hasGuestEmployee(meeting.extern2) ? (
                          <>
                            <EmployeeAvatar employeeId={meeting.extern2} size="md" />
                            <span className="text-sm sm:text-base text-gray-900">{getEmployeeDisplayName(meeting.extern2)}</span>
                          </>
                        ) : (
                          <span className="text-sm sm:text-base text-gray-900">--</span>
                        )}
                      </div>
                    </div>
                  </>
                )}
                {!isActiveMeeting && (
                <div className="space-y-2 sm:space-y-2">
                  <label className={meetingFieldLabelClass}>Scheduler</label>
                  <div className="flex items-center gap-2 sm:gap-2">
                    <EmployeeAvatar employeeId={meeting.scheduler} size="md" />
                    <span className="text-sm sm:text-base text-gray-900">{getEmployeeDisplayName(meeting.scheduler)}</span>
                  </div>
                </div>
                )}
                {!isActiveMeeting && (
                <div className="space-y-2 sm:space-y-2">
                  <label className={meetingFieldLabelClass}>Helper</label>
                  <div className="flex items-center gap-2 sm:gap-2">
                    <EmployeeAvatar employeeId={meeting.helper} size="md" />
                    <span className="text-sm sm:text-base text-gray-900">{getEmployeeDisplayName(meeting.helper)}</span>
                  </div>
                </div>
                )}
                {!isActiveMeeting && (
                <div className="space-y-2 sm:space-y-2">
                  <label className={meetingFieldLabelClass}>Expert</label>
                  <div className="flex items-center gap-2 sm:gap-2">
                    <EmployeeAvatar employeeId={meeting.expert} size="md" />
                    <span className="text-sm sm:text-base text-gray-900">{getEmployeeDisplayName(meeting.expert)}</span>
                  </div>
                </div>
                )}
                  </>
                )}
                <div className="space-y-2 sm:space-y-2 md:hidden">
                  <label className={meetingFieldLabelClass}>Amount</label>
                  <div className="flex items-center gap-2">
                    {meeting.amount && meeting.amount > 0 ? (
                      <span className="text-sm sm:text-base font-semibold" style={{ color: 'rgb(40, 75, 50)' }}>
                        {getCurrencySymbol(meeting.currency)} {typeof meeting.amount === 'number' ? meeting.amount.toLocaleString() : meeting.amount}
                      </span>
                    ) : (
                      <span className="text-sm sm:text-base text-gray-900">--</span>
                    )}
                  </div>
                </div>
                <div className="space-y-2 sm:space-y-2 md:hidden">
                  <label className={meetingFieldLabelClass}>Car Number</label>
                  <div className="flex items-center gap-2">
                    {meeting.car_number ? (
                      <span className="text-sm sm:text-base text-gray-900">{meeting.car_number}</span>
                    ) : (
                      <span className="text-sm sm:text-base text-gray-900">--</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Brief Section — edit opens a modal for comfortable writing */}
            {editingMeetingId !== meeting.id && (
              <div className="pt-3 sm:pt-3">
                <div className="flex justify-between items-center mb-2 sm:mb-2">
                  <label className={meetingFieldLabelClass}>Brief</label>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square hover:bg-gray-100"
                    onClick={handleEditBrief}
                    title="Edit brief"
                  >
                    <PencilSquareIcon className="w-4 h-4 text-gray-900" />
                  </button>
                </div>
                <div
                  className="bg-gray-50 rounded-lg p-3 sm:p-3 min-h-[60px] sm:min-h-[60px] max-h-48 overflow-y-auto cursor-pointer hover:bg-gray-100/90 transition-colors"
                  onClick={handleEditBrief}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleEditBrief();
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  title="Click to edit brief"
                >
                  {meeting.brief ? (
                    <p className="text-sm sm:text-base text-gray-700 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{meeting.brief}</p>
                  ) : (
                    <span className="text-sm sm:text-base text-gray-400 italic">No brief provided</span>
                  )}
                </div>
              </div>
            )}

            {/* Brief Section in Edit Mode */}
            {editingMeetingId === meeting.id && (
              <div className="pt-3">
                <label className={`${meetingFieldLabelClass} mt-2 block`}>Brief</label>
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
                <span>Last edited by {getLastEditedByDisplayName(meeting.lastEdited.user)}</span>
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
          className="cursor-pointer transition-all p-2 text-center bg-white"
          onClick={() => setExpandedMeetingId(expandedMeetingId === meeting.id ? null : meeting.id)}
        >
          <div className="flex items-center justify-center gap-2 text-xs font-medium" style={{ color: 'rgb(40, 75, 50)' }}>
            <span>{expandedMeetingId === meeting.id ? 'Show Less' : 'Show More'}</span>
            <ChevronDownIcon className={`w-4 h-4 transition-transform ${expandedMeetingId === meeting.id ? 'rotate-180' : ''}`} style={{ color: 'rgb(40, 75, 50)' }} />
          </div>
        </div>
        </div>
        {/* Right-side vertical action column */}
        {hasAnyActionButton && (
          <div className="flex flex-col items-center justify-start gap-2 sm:gap-3 p-2 sm:p-3 border-l border-gray-200 bg-gray-50/60 rounded-r-xl shrink-0 sticky top-20 self-start z-10">
            {sideActionButtons}
          </div>
        )}
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
    <div className="px-1 sm:px-4 md:px-6 py-2 sm:py-4 md:py-6 space-y-10 sm:space-y-16">
      {/* Header */}
      <div className="flex items-center justify-between mb-14">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
            <CalendarIcon className="w-5 h-5 text-gray-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Meeting Management</h2>
            <p className="text-sm text-gray-500">Schedule and track client meetings</p>
          </div>
        </div>
        {/* Schedule/Reschedule Meeting button moved to ClientHeader (top-left stage row).
            See window events 'meeting-tab:open-schedule-drawer' / 'meeting-tab:open-reschedule-drawer'. */}
      </div>

      {/* Scheduling History Table */}
      {schedulingHistory.length > 0 && (
        <div className="mb-16">
          <h4 className="text-base font-semibold text-gray-900 mb-4">Scheduling History</h4>
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-xs font-semibold text-gray-600 uppercase">Date</th>
                    <th className="text-xs font-semibold text-gray-600 uppercase">Created By</th>
                    <th className="text-xs font-semibold text-gray-600 uppercase">Scheduling Notes</th>
                    <th className="text-xs font-semibold text-gray-600 uppercase">Next Follow-up</th>
                    <th className="text-xs font-semibold text-gray-600 uppercase">Follow-up Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {schedulingHistory.map((entry) => {
                    const date = new Date(entry.created_at);
                    const day = date.getDate().toString().padStart(2, '0');
                    const month = (date.getMonth() + 1).toString().padStart(2, '0');
                    const year = date.getFullYear().toString().slice(-2);
                    const mobileDate = `${day}.${month}.${year}`;
                    const desktopDate = date.toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    });
                    
                    return (
                    <tr key={entry.id}>
                      <td className="text-sm text-gray-900">
                        <span className="md:hidden">{mobileDate}</span>
                        <span className="hidden md:inline">{desktopDate}</span>
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
                    );
                  })}
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

      {/* Upcoming Meetings with Past Meetings toggle */}
      <div className="relative">
        {/* Upcoming Meetings (main content) - centered */}
        <div className="w-full max-w-3xl mx-auto pr-14 sm:pr-16">
          <div className="flex items-center justify-end mb-5">
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
          <div className="space-y-8">
            {upcomingMeetings.length > 0 ? (
              upcomingMeetings.map(renderMeetingCard)
            ) : (
              <div className="text-center py-8 text-gray-500">
                <CalendarIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                <p className="font-medium">No upcoming meetings</p>
                <p className="text-sm">Schedule a meeting to get started</p>
              </div>
            )}
          </div>
        </div>

        {/* Past Meetings icon button - fixed on right edge, centered vertically */}
        <div className="fixed right-0 top-1/2 -translate-y-1/2 z-30">
          <button
            type="button"
            onClick={() => setShowPastMeetingsPanel(!showPastMeetingsPanel)}
            className={`relative flex flex-col items-center justify-center gap-2 w-12 py-6 rounded-l-2xl border shadow-lg transition-all duration-200 ${
              showPastMeetingsPanel
                ? 'bg-gray-100 border-gray-300 hover:bg-gray-50'
                : 'bg-white border-gray-200 hover:shadow-xl hover:bg-gray-50'
            }`}
            title={`Past Meetings${pastMeetings.length > 0 ? ` (${pastMeetings.length})` : ''}`}
          >
            <ClockIcon className="w-6 h-6 text-gray-600" />
            {pastMeetings.length > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1.5 flex items-center justify-center text-sm font-semibold bg-red-500 text-white rounded-full">
                {pastMeetings.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Past Meetings slide-out panel */}
      {showPastMeetingsPanel && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={() => setShowPastMeetingsPanel(false)}
            aria-hidden="true"
          />
          <div className="fixed top-0 right-0 bottom-0 w-full max-w-2xl bg-white shadow-xl z-50 flex flex-col border-l border-gray-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h4 className="text-base font-semibold text-gray-900">Past Meetings</h4>
              <button
                type="button"
                onClick={() => setShowPastMeetingsPanel(false)}
                className="btn btn-ghost btn-sm btn-square"
                aria-label="Close"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-6">
                {pastMeetings.length > 0 ? (
                  pastMeetings.map(renderMeetingCard)
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <ClockIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                    <p className="font-medium">No past meetings</p>
                    <p className="text-sm">Completed meetings will appear here</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Edit meeting brief — full modal for comfortable writing */}
      {editingBriefId !== null && (
        <div
          className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={closeBriefEditModal}
          role="presentation"
        >
          <div
            className="flex h-full min-h-0 w-full max-h-[100dvh] flex-col overflow-hidden bg-white shadow-xl rounded-none sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="meeting-brief-modal-title"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-3 sm:pt-5">
              <div>
                <h3 id="meeting-brief-modal-title" className="text-lg font-semibold text-gray-900">
                  Edit meeting brief
                </h3>
                {(() => {
                  const m = meetings.find((x) => x.id === editingBriefId);
                  const leadLabel =
                    client.lead_number != null && String(client.lead_number).trim() !== ''
                      ? String(client.lead_number)
                      : String(client.id);
                  const loc = m ? getMeetingLocationName(m.location) : null;
                  return (
                    <div className="text-sm mt-1.5 space-y-1">
                      <p className="text-gray-900">
                        <span className="font-semibold">#{leadLabel}</span>
                        <span className="text-gray-300 mx-1.5" aria-hidden>
                          |
                        </span>
                        <span className="font-medium">{client.name || '—'}</span>
                      </p>
                      {m && (
                        <p className="text-gray-500 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                          <span>{new Date(m.date).toLocaleDateString('en-GB')}</span>
                          {m.time && <span>· {m.time.substring(0, 5)}</span>}
                          {loc && (
                            <span className="inline-flex items-center gap-1 min-w-0 max-w-full">
                              <span className="text-gray-300" aria-hidden>
                                ·
                              </span>
                              <MapPinIcon className="w-3.5 h-3.5 opacity-70 shrink-0" aria-hidden />
                              <span className="truncate">{loc}</span>
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
              <button
                type="button"
                onClick={closeBriefEditModal}
                className="btn btn-ghost btn-sm btn-square shrink-0"
                aria-label="Close"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-4 sm:max-h-[calc(90vh-200px)] sm:overflow-y-auto sm:flex-none">
              <label htmlFor="meeting-brief-modal-text" className="sr-only">
                Meeting brief
              </label>
              <textarea
                id="meeting-brief-modal-text"
                className="textarea textarea-bordered w-full min-h-[12rem] flex-1 basis-0 resize-y text-base leading-relaxed sm:min-h-[320px] sm:h-[min(50vh,400px)] sm:flex-none sm:basis-auto"
                value={editedBrief}
                onChange={(e) => setEditedBrief(e.target.value)}
                placeholder="Add a meeting brief…"
                autoFocus
              />
            </div>
            <div className="shrink-0 space-y-2 border-t border-gray-100 bg-gray-50/80 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:space-y-2.5 sm:py-3 sm:pb-3 rounded-b-none sm:rounded-b-xl">
              <div className="flex justify-end gap-2">
                <button type="button" className="btn btn-ghost" onClick={closeBriefEditModal}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => editingBriefId != null && handleSaveBrief(editingBriefId)}
                >
                  Save
                </button>
              </div>
              {(() => {
                const bm = meetings.find((x) => x.id === editingBriefId);
                const le = bm?.lastEdited;
                if (!le) return null;
                const atText = le.timestamp
                  ? new Date(le.timestamp).toLocaleString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                  : null;
                return (
                  <p className="text-center text-xs leading-snug text-gray-500 sm:text-left">
                    Edited by{' '}
                    <span className="font-medium text-gray-600">{getLastEditedByDisplayName(le.user)}</span>
                    {atText ? (
                      <>
                        {' '}
                        <span className="text-gray-400">at</span> {atText}
                      </>
                    ) : null}
                  </p>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      <MeetingSummaryNotesModal
        open={summaryNotesMeeting != null && typeof summaryNotesMeeting.id === 'number'}
        meeting={
          summaryNotesMeeting && typeof summaryNotesMeeting.id === 'number'
            ? summaryNotesMeeting
            : null
        }
        clientName={client.name || 'Client'}
        leadNumber={client.lead_number != null ? String(client.lead_number) : null}
        locationLabel={
          summaryNotesMeeting ? getMeetingLocationName(summaryNotesMeeting.location) : null
        }
        onClose={() => setSummaryNotesMeeting(null)}
        resolveEditorDisplayName={resolveEditorDisplayName}
        onSaved={(meetingId, notes) => {
          setMeetings((prev) =>
            prev.map((m) =>
              m.id === meetingId ? { ...m, meeting_summary_notes: notes || null } : m,
            ),
          );
          void fetchMeetings();
        }}
      />

      {/* Notify Modal */}
      {showNotifyModal && selectedMeetingForNotify && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowNotifyModal(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 overflow-y-auto flex-1">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Select Recipients</h3>
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
                    className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${selectedEmailLanguage === 'en'
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                      }`}
                  >
                    English
                  </button>
                  <button
                    onClick={() => setSelectedEmailLanguage('he')}
                    className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${selectedEmailLanguage === 'he'
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
                (() => {
                  const sortedContacts = sortNotifyRecipients(contacts);
                  const emailContacts = sortedContacts.filter((c) => c.email && c.email !== '---');
                  const hasClientFallback = Boolean(client.email) && emailContacts.length === 0;
                  const selectableCount = emailContacts.length + (hasClientFallback ? 1 : 0);

                  return (
                    <div className="space-y-3">
                      {selectableCount > 1 && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-500">
                            {selectedEmailRecipientKeys.size} of {selectableCount} selected
                          </span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="text-primary hover:underline"
                              onClick={() =>
                                setSelectedEmailRecipientKeys(
                                  new Set([
                                    ...emailContacts.map((c) => c.recipientKey),
                                    ...(hasClientFallback ? ['client-primary-email'] : []),
                                  ])
                                )
                              }
                            >
                              Select all
                            </button>
                            <button
                              type="button"
                              className="text-gray-500 hover:underline"
                              onClick={() => setSelectedEmailRecipientKeys(new Set())}
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {sortedContacts.map((contact) => {
                          const hasEmail = Boolean(contact.email && contact.email !== '---');
                          const isSelected = hasEmail && selectedEmailRecipientKeys.has(contact.recipientKey);
                          return (
                            <label
                              key={contact.recipientKey}
                              className={`flex items-start gap-3 px-4 py-3 border rounded-lg transition-colors ${!hasEmail
                                ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                                : isSelected
                                  ? 'border-purple-300 bg-purple-50 cursor-pointer'
                                  : 'border-gray-200 hover:bg-gray-50 cursor-pointer'
                                }`}
                            >
                              <input
                                type="checkbox"
                                className="checkbox checkbox-primary checkbox-sm mt-1"
                                checked={isSelected}
                                disabled={!hasEmail}
                                onChange={() => toggleEmailRecipient(contact.recipientKey)}
                              />
                              <NotifyRecipientAvatar contact={contact} size="sm" />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-900 flex flex-wrap items-center gap-2">
                                  <span>{contact.name || '---'}</span>
                                  <span className={`text-xs px-2 py-0.5 rounded ${getNotifySourceBadgeClass(contact.source)}`}>
                                    {contact.sourceLabel}
                                  </span>
                                </div>
                                {contact.subtitle && (
                                  <div className="text-xs text-gray-400 truncate">{contact.subtitle}</div>
                                )}
                                <div className="text-sm text-gray-500 truncate">
                                  {hasEmail ? contact.email : 'No email address'}
                                </div>
                              </div>
                            </label>
                          );
                        })}

                        {hasClientFallback && (
                          <label
                            className={`flex items-start gap-3 px-4 py-3 border rounded-lg cursor-pointer transition-colors ${selectedEmailRecipientKeys.has('client-primary-email')
                              ? 'border-purple-300 bg-purple-50'
                              : 'border-gray-200 hover:bg-gray-50'
                              }`}
                          >
                            <input
                              type="checkbox"
                              className="checkbox checkbox-primary checkbox-sm mt-1"
                              checked={selectedEmailRecipientKeys.has('client-primary-email')}
                              onChange={() => toggleEmailRecipient('client-primary-email')}
                            />
                            <div className="w-8 h-8 rounded-full flex items-center justify-center bg-purple-100 text-purple-700 font-semibold flex-shrink-0 text-xs">
                              {getEmployeeInitials(client.name || 'Client')}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-gray-900">{client.name}</div>
                              <div className="text-sm text-gray-500 truncate">{client.email}</div>
                            </div>
                          </label>
                        )}

                        {sortedContacts.length === 0 && !hasClientFallback && (
                          <div className="text-center py-8 text-gray-500">
                            <EnvelopeIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                            <p>No recipients found</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()
              )}
            </div>

            {!loadingContacts && (
              <div className="p-6 pt-0 flex gap-3 border-t border-gray-100">
                <button
                  type="button"
                  className="btn btn-ghost flex-1"
                  onClick={() => setShowNotifyModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary flex-1"
                  disabled={selectedEmailRecipientKeys.size === 0 || sendingEmailMeetingId === selectedMeetingForNotify.id}
                  onClick={() => {
                    const selectedEmails = contacts
                      .filter((c) => selectedEmailRecipientKeys.has(c.recipientKey) && c.email && c.email !== '---')
                      .map((c) => c.email!);

                    if (selectedEmailRecipientKeys.has('client-primary-email') && client.email) {
                      selectedEmails.push(client.email);
                    }

                    if (selectedEmails.length === 0) {
                      toast.error('Select at least one recipient');
                      return;
                    }

                    handleSendEmail(selectedMeetingForNotify, selectedEmails, client.name);
                  }}
                >
                  {sendingEmailMeetingId === selectedMeetingForNotify.id ? (
                    <span className="loading loading-spinner loading-sm"></span>
                  ) : (
                    `Send Email${selectedEmailRecipientKeys.size > 1 ? ` (${selectedEmailRecipientKeys.size})` : ''}`
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* WhatsApp Notify Modal */}
      {showWhatsAppNotifyModal && selectedMeetingForWhatsAppNotify && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowWhatsAppNotifyModal(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 overflow-y-auto flex-1">
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
                    className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${selectedLanguage === 'he'
                      ? 'bg-green-600 text-white border-green-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                      }`}
                  >
                    Hebrew
                  </button>
                  <button
                    onClick={() => setSelectedLanguage('en')}
                    className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${selectedLanguage === 'en'
                      ? 'bg-green-600 text-white border-green-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                      }`}
                  >
                    English
                  </button>
                  {whatsAppReminderType === 'missed_appointment' && (
                    <button
                      onClick={() => setSelectedLanguage('ru')}
                      className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${selectedLanguage === 'ru'
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
                (() => {
                  const sortedContacts = sortNotifyRecipients(whatsAppContacts);
                  const phoneContacts = sortedContacts.filter((c) => getNotifyRecipientPhone(c));
                  const clientPhone = client.phone?.trim();
                  const clientMobile = client.mobile?.trim();
                  const clientPhoneNumber =
                    (clientPhone && clientPhone !== '' && clientPhone !== '---')
                      ? clientPhone
                      : (clientMobile && clientMobile !== '' && clientMobile !== '---')
                        ? clientMobile
                        : null;
                  const hasClientFallback = Boolean(clientPhoneNumber) && phoneContacts.length === 0;
                  const selectableCount = phoneContacts.length + (hasClientFallback ? 1 : 0);

                  return (
                    <div className="space-y-3">
                      {selectableCount > 1 && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-500">
                            {selectedWhatsAppRecipientKeys.size} of {selectableCount} selected
                          </span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="text-green-600 hover:underline"
                              onClick={() =>
                                setSelectedWhatsAppRecipientKeys(
                                  new Set([
                                    ...phoneContacts.map((c) => c.recipientKey),
                                    ...(hasClientFallback ? ['client-primary-phone'] : []),
                                  ])
                                )
                              }
                            >
                              Select all
                            </button>
                            <button
                              type="button"
                              className="text-gray-500 hover:underline"
                              onClick={() => setSelectedWhatsAppRecipientKeys(new Set())}
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {sortedContacts.map((contact) => {
                          const phoneNumber = getNotifyRecipientPhone(contact);
                          const hasPhone = Boolean(phoneNumber);
                          const isSelected = hasPhone && selectedWhatsAppRecipientKeys.has(contact.recipientKey);

                          return (
                            <label
                              key={contact.recipientKey}
                              className={`flex items-start gap-3 px-4 py-3 border rounded-lg transition-colors ${!hasPhone
                                ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                                : isSelected
                                  ? 'border-green-300 bg-green-50 cursor-pointer'
                                  : 'border-gray-200 hover:bg-gray-50 cursor-pointer'
                                }`}
                            >
                              <input
                                type="checkbox"
                                className="checkbox checkbox-success checkbox-sm mt-1"
                                checked={isSelected}
                                disabled={!hasPhone}
                                onChange={() => toggleWhatsAppRecipient(contact.recipientKey)}
                              />
                              <NotifyRecipientAvatar contact={contact} size="sm" />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-900 flex flex-wrap items-center gap-2">
                                  <span>{contact.name || '---'}</span>
                                  <span className={`text-xs px-2 py-0.5 rounded ${getNotifySourceBadgeClass(contact.source)}`}>
                                    {contact.sourceLabel}
                                  </span>
                                </div>
                                {contact.subtitle && (
                                  <div className="text-xs text-gray-400 truncate">{contact.subtitle}</div>
                                )}
                                <div className="text-sm text-gray-500 truncate">
                                  {hasPhone ? phoneNumber : 'No phone number'}
                                </div>
                              </div>
                            </label>
                          );
                        })}

                        {hasClientFallback && clientPhoneNumber && (
                          <label
                            className={`flex items-start gap-3 px-4 py-3 border rounded-lg cursor-pointer transition-colors ${selectedWhatsAppRecipientKeys.has('client-primary-phone')
                              ? 'border-green-300 bg-green-50'
                              : 'border-gray-200 hover:bg-gray-50'
                              }`}
                          >
                            <input
                              type="checkbox"
                              className="checkbox checkbox-success checkbox-sm mt-1"
                              checked={selectedWhatsAppRecipientKeys.has('client-primary-phone')}
                              onChange={() => toggleWhatsAppRecipient('client-primary-phone')}
                            />
                            <div className="w-8 h-8 rounded-full flex items-center justify-center bg-green-100 text-green-700 font-semibold flex-shrink-0 text-xs">
                              {getEmployeeInitials(client.name || 'Client')}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-gray-900">{client.name}</div>
                              <div className="text-sm text-gray-500 truncate">{clientPhoneNumber}</div>
                            </div>
                          </label>
                        )}

                        {sortedContacts.length === 0 && !hasClientFallback && (
                          <div className="text-center py-8 text-gray-500">
                            <FaWhatsapp className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                            <p>No recipients found</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()
              )}
            </div>

            {!loadingWhatsAppContacts && (
              <div className="p-6 pt-0 flex gap-3 border-t border-gray-100">
                <button
                  type="button"
                  className="btn btn-ghost flex-1"
                  onClick={() => setShowWhatsAppNotifyModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn bg-green-600 hover:bg-green-700 text-white border-green-600 flex-1"
                  disabled={selectedWhatsAppRecipientKeys.size === 0 || sendingWhatsAppMeetingId === selectedMeetingForWhatsAppNotify.id}
                  onClick={() => {
                    const selectedPhones = whatsAppContacts
                      .filter((c) => selectedWhatsAppRecipientKeys.has(c.recipientKey))
                      .map((c) => getNotifyRecipientPhone(c))
                      .filter(Boolean) as string[];

                    if (selectedWhatsAppRecipientKeys.has('client-primary-phone')) {
                      const clientPhone = client.phone?.trim();
                      const clientMobile = client.mobile?.trim();
                      const clientPhoneNumber =
                        (clientPhone && clientPhone !== '' && clientPhone !== '---')
                          ? clientPhone
                          : (clientMobile && clientMobile !== '' && clientMobile !== '---')
                            ? clientMobile
                            : null;
                      if (clientPhoneNumber) selectedPhones.push(clientPhoneNumber);
                    }

                    if (selectedPhones.length === 0) {
                      toast.error('Select at least one recipient');
                      return;
                    }

                    handleSendWhatsAppReminder(selectedMeetingForWhatsAppNotify, selectedPhones, whatsAppReminderType);
                  }}
                >
                  {sendingWhatsAppMeetingId === selectedMeetingForWhatsAppNotify.id ? (
                    <span className="loading loading-spinner loading-sm"></span>
                  ) : (
                    `Send WhatsApp${selectedWhatsAppRecipientKeys.size > 1 ? ` (${selectedWhatsAppRecipientKeys.size})` : ''}`
                  )}
                </button>
              </div>
            )}
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


      {/* Schedule Meeting Drawer — portaled to body so it covers the app header */}
      {showScheduleDrawer && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[320] flex">
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black/30"
            onClick={() => {
              setShowAuthRedirectOption(false);
              authRedirectParamsRef.current = null;
              setShowScheduleDrawer(false);
              setNotifyClientOnSchedule(false);
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
                custom_link: '',
                custom_address: '',
              });
            }}
          />
          {/* Panel */}
          <div className="fixed top-0 right-0 bottom-0 flex w-full max-w-md flex-col bg-base-100 shadow-2xl animate-slideInRight z-[321]">
            {showAuthRedirectOption && (
              <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 flex flex-col gap-2">
                <p className="text-sm text-amber-800">Sign-in was blocked. Use the button below to sign in in this tab, then try again.</p>
                <button
                  type="button"
                  className="btn btn-sm btn-warning"
                  onClick={async () => {
                    const params = authRedirectParamsRef.current;
                    if (!params) return;
                    setShowAuthRedirectOption(false);
                    authRedirectParamsRef.current = null;
                    toast.loading('Redirecting to Microsoft sign-in… Create the meeting again after you return.', { duration: 5000 });
                    await triggerTokenRedirect(instance, params.request, params.account);
                  }}
                >
                  Sign in (this tab)
                </button>
              </div>
            )}
            {/* Fixed Header */}
            <div className="flex items-center justify-between p-8 pb-4 border-b border-base-300 pt-[max(2rem,env(safe-area-inset-top))]">
              <h3 className="text-2xl font-bold">Schedule Meeting</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => {
                setShowAuthRedirectOption(false);
                authRedirectParamsRef.current = null;
                setShowScheduleDrawer(false);
                setNotifyClientOnSchedule(false);
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
                  custom_link: '',
                  custom_address: '',
                });
              }}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-8 pt-4">
              {/* Notify Client Toggle */}
              <div className="mb-6 flex items-center justify-between">
                <label className="block font-semibold text-base">Notify Client</label>
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  checked={notifyClientOnSchedule}
                  onChange={(e) => setNotifyClientOnSchedule(e.target.checked)}
                />
              </div>

              <div className="flex flex-col gap-4">
                {/* Location */}
                <div>
                  <label className="block font-semibold mb-1">Location</label>
                  <select
                    className="select select-bordered w-full"
                    value={scheduleMeetingFormData.location}
                    onChange={(e) => handleMeetingLocationChange(e.target.value, 'schedule')}
                  >
                    {selectableMeetingLocations.map((location) => (
                      <option key={location.id} value={location.name}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </div>

                {Number(allMeetingLocations.find((loc: any) => loc.name === scheduleMeetingFormData.location)?.id) === CUSTOM_LINK_LOCATION_ID && (
                  <div>
                    <label className="block font-semibold mb-1">Custom Link</label>
                    <button
                      type="button"
                      className="btn btn-outline w-full justify-start"
                      onClick={() => openCustomLocationModal('schedule', 'link', scheduleMeetingFormData.custom_link || '')}
                    >
                      {scheduleMeetingFormData.custom_link?.trim() || 'Set custom link'}
                    </button>
                  </div>
                )}
                {Number(allMeetingLocations.find((loc: any) => loc.name === scheduleMeetingFormData.location)?.id) === CUSTOM_ADDRESS_LOCATION_ID && (
                  <div>
                    <label className="block font-semibold mb-1">Custom Address</label>
                    <button
                      type="button"
                      className="btn btn-outline w-full justify-start"
                      onClick={() => openCustomLocationModal('schedule', 'address', scheduleMeetingFormData.custom_address || '')}
                    >
                      {scheduleMeetingFormData.custom_address?.trim() || 'Set custom address'}
                    </button>
                  </div>
                )}

                {/* Calendar */}
                <div>
                  <label className="block font-semibold mb-1">Calendar</label>
                  <select
                    className="select select-bordered w-full"
                    value={scheduleMeetingFormData.calendar}
                    onChange={(e) => setScheduleMeetingFormData(prev => ({ ...prev, calendar: e.target.value }))}
                  >
                    <option value="active_client">Active Client</option>
                    <option value="external">External Meeting</option>
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
                  />
                </div>

                {/* Time */}
                <TimePicker
                  variant="inline"
                  label="Time"
                  value={scheduleMeetingFormData.time}
                  onChange={(time) =>
                    setScheduleMeetingFormData((prev) => ({ ...prev, time }))
                  }
                  meetingCounts={
                    scheduleMeetingFormData.date ? meetingCountsByTime : {}
                  }
                  minHour={8}
                  maxHour={23}
                  disabled={!scheduleMeetingFormData.date}
                />

                {/* External Meeting fields (Internal Meeting with external participants) */}
                {scheduleMeetingFormData.calendar === 'external' && (
                  <>
                    {/* Subject */}
                    <div>
                      <label className="block font-semibold mb-1">Meeting Subject</label>
                      <input
                        type="text"
                        className="input input-bordered w-full"
                        placeholder={`[#${client.lead_number || client.id}] ${client.name} - Internal Meeting`}
                        value={scheduleExternal.subject}
                        onChange={(e) => setScheduleExternal((prev) => ({ ...prev, subject: e.target.value }))}
                      />
                    </div>

                    {/* Internal meeting type */}
                    <div>
                      <label className="block font-semibold mb-1">Internal Meeting Type</label>
                      <select
                        className="select select-bordered w-full"
                        value={scheduleExternal.internalMeetingTypeId != null ? String(scheduleExternal.internalMeetingTypeId) : ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setScheduleExternal((prev) => ({ ...prev, internalMeetingTypeId: v === '' ? null : Number(v) }));
                        }}
                        disabled={internalMeetingTypes.length === 0}
                      >
                        {internalMeetingTypes.length === 0 ? (
                          <option value="">Loading types…</option>
                        ) : (
                          internalMeetingTypes.map((t) => (
                            <option key={t.id} value={String(t.id)}>{t.label}</option>
                          ))
                        )}
                      </select>
                    </div>

                    {/* Staff attendees */}
                    <div className="relative" ref={scheduleStaffDropdownRef}>
                      <label className="block font-semibold mb-1">Staff Attendees</label>
                      <input
                        type="text"
                        className="input input-bordered w-full"
                        placeholder="Search staff..."
                        value={scheduleStaffSearch}
                        onFocus={() => setShowScheduleStaffDropdown(true)}
                        onChange={(e) => { setScheduleStaffSearch(e.target.value); setShowScheduleStaffDropdown(true); }}
                      />
                      {showScheduleStaffDropdown && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                          {(() => {
                            const q = scheduleStaffSearch.trim().toLowerCase();
                            const list = (allEmployees || []).filter((e: any) => !q || (e.display_name || '').toLowerCase().includes(q));
                            return list.length > 0 ? list.map((emp: any) => {
                              const isSelected = scheduleExternal.selectedStaffEmployeeIds.includes(Number(emp.id));
                              return (
                                <div
                                  key={emp.id}
                                  className={`px-4 py-2 cursor-pointer flex items-center justify-between ${isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-gray-100'}`}
                                  onClick={() => {
                                    setScheduleExternal((prev) => ({
                                      ...prev,
                                      selectedStaffEmployeeIds: isSelected
                                        ? prev.selectedStaffEmployeeIds.filter((id) => id !== Number(emp.id))
                                        : [...prev.selectedStaffEmployeeIds, Number(emp.id)],
                                    }));
                                  }}
                                >
                                  <span>{emp.display_name}</span>
                                  {isSelected && <span className="text-xs">Selected</span>}
                                </div>
                              );
                            }) : (
                              <div className="px-4 py-2 text-gray-500 text-center">No employees found</div>
                            );
                          })()}
                        </div>
                      )}
                      {scheduleExternal.selectedStaffEmployeeIds.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {scheduleExternal.selectedStaffEmployeeIds.map((id) => {
                            const emp = (allEmployees || []).find((e: any) => Number(e.id) === id);
                            return (
                              <span key={id} className="badge badge-outline gap-2">
                                {emp?.display_name || id}
                                <button
                                  type="button"
                                  className="text-gray-500 hover:text-gray-800"
                                  onClick={() => setScheduleExternal((prev) => ({
                                    ...prev,
                                    selectedStaffEmployeeIds: prev.selectedStaffEmployeeIds.filter((x) => x !== id),
                                  }))}
                                >×</button>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Firm contacts */}
                    <div className="relative" ref={scheduleFirmContactDropdownRef}>
                      <label className="block font-semibold mb-1">Firm Contacts</label>
                      <input
                        type="text"
                        className="input input-bordered w-full"
                        placeholder="Search firm contacts..."
                        value={scheduleFirmContactSearch}
                        onFocus={() => setShowScheduleFirmContactDropdown(true)}
                        onChange={(e) => { setScheduleFirmContactSearch(e.target.value); setShowScheduleFirmContactDropdown(true); }}
                      />
                      {showScheduleFirmContactDropdown && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                          {(() => {
                            const q = scheduleFirmContactSearch.trim().toLowerCase();
                            const list = (q ? firmContacts.filter((c) => c.name.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q)) : firmContacts).slice(0, 50);
                            return list.length > 0 ? list.map((c) => {
                              const isSelected = scheduleExternal.selectedFirmContactIds.includes(c.id);
                              return (
                                <div
                                  key={c.id}
                                  className={`px-4 py-2 cursor-pointer flex items-center justify-between ${isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-gray-100'}`}
                                  onClick={() => {
                                    setScheduleExternal((prev) => ({
                                      ...prev,
                                      selectedFirmContactIds: isSelected
                                        ? prev.selectedFirmContactIds.filter((id) => id !== c.id)
                                        : [...prev.selectedFirmContactIds, c.id],
                                    }));
                                  }}
                                >
                                  <div className="min-w-0">
                                    <div className="font-semibold truncate">{c.name}</div>
                                    <div className="text-xs text-gray-500 truncate">{c.email || c.phone || ''}</div>
                                  </div>
                                  {isSelected && <span className="text-xs ml-2">Selected</span>}
                                </div>
                              );
                            }) : (
                              <div className="px-4 py-2 text-gray-500 text-center">No matches</div>
                            );
                          })()}
                        </div>
                      )}
                      {scheduleExternal.selectedFirmContactIds.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {scheduleExternal.selectedFirmContactIds.map((id) => {
                            const c = firmContacts.find((x) => x.id === id);
                            if (!c) return null;
                            return (
                              <span key={id} className="badge badge-outline gap-2">
                                {c.name}
                                <button
                                  type="button"
                                  className="text-gray-500 hover:text-gray-800"
                                  onClick={() => setScheduleExternal((prev) => ({
                                    ...prev,
                                    selectedFirmContactIds: prev.selectedFirmContactIds.filter((x) => x !== id),
                                  }))}
                                >×</button>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Extern participant (free) */}
                    <div>
                      <label className="block font-semibold mb-1">Extern Participant</label>
                      <div className="grid grid-cols-1 gap-2">
                        <input
                          className="input input-bordered w-full"
                          placeholder="Name"
                          value={scheduleExternal.freeDraft.name}
                          onChange={(e) => setScheduleExternal((prev) => ({ ...prev, freeDraft: { ...prev.freeDraft, name: e.target.value } }))}
                        />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <input
                            className="input input-bordered w-full"
                            placeholder="Email (optional)"
                            value={scheduleExternal.freeDraft.email || ''}
                            onChange={(e) => setScheduleExternal((prev) => ({ ...prev, freeDraft: { ...prev.freeDraft, email: e.target.value } }))}
                          />
                          <input
                            className="input input-bordered w-full"
                            placeholder="Phone (optional)"
                            value={scheduleExternal.freeDraft.phone || ''}
                            onChange={(e) => setScheduleExternal((prev) => ({ ...prev, freeDraft: { ...prev.freeDraft, phone: e.target.value } }))}
                          />
                        </div>
                        <textarea
                          className="textarea textarea-bordered w-full"
                          placeholder="Notes (optional)"
                          value={scheduleExternal.freeDraft.notes || ''}
                          onChange={(e) => setScheduleExternal((prev) => ({ ...prev, freeDraft: { ...prev.freeDraft, notes: e.target.value } }))}
                        />
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={() => {
                            const name = (scheduleExternal.freeDraft.name || '').trim();
                            if (!name) { toast.error('Extern participant name is required'); return; }
                            setScheduleExternal((prev) => ({
                              ...prev,
                              freeParticipants: [
                                ...prev.freeParticipants,
                                {
                                  name,
                                  email: (prev.freeDraft.email || '').trim() || undefined,
                                  phone: (prev.freeDraft.phone || '').trim() || undefined,
                                  notes: (prev.freeDraft.notes || '').trim() || undefined,
                                },
                              ],
                              freeDraft: { name: '', email: '', phone: '', notes: '' },
                            }));
                          }}
                        >
                          Add participant
                        </button>
                      </div>
                      {scheduleExternal.freeParticipants.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {scheduleExternal.freeParticipants.map((p, idx) => (
                            <span key={`${p.name}-${idx}`} className="badge badge-outline gap-2">
                              {p.name}
                              <button
                                type="button"
                                className="text-gray-500 hover:text-gray-800"
                                onClick={() => setScheduleExternal((prev) => ({
                                  ...prev,
                                  freeParticipants: prev.freeParticipants.filter((_, i) => i !== idx),
                                }))}
                              >×</button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Meeting Brief (Optional) — always available, used as Outlook description for external too */}
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

                {/* Active-client-only fields: hidden for External Meeting */}
                {scheduleMeetingFormData.calendar !== 'external' && (
                  <>
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
                  </>
                )}
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
        </div>,
        document.body
      )}

      {/* Reschedule Meeting Drawer — portaled to body so it covers the app header */}
      {showRescheduleDrawer && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[320] flex flex-row">
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black/30"
            onClick={() => {
              setShowAuthRedirectOption(false);
              authRedirectParamsRef.current = null;
              setShowRescheduleDrawer(false);
              setMeetingToDelete(null);
              setNotifyClientOnReschedule(false); // Reset to default
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
                custom_link: '',
                custom_address: '',
              });
              setRescheduleOption('cancel');
            }}
          />
          {/* Panel */}
          <div className="fixed top-0 right-0 bottom-0 flex w-full max-w-md flex-col bg-base-100 shadow-2xl animate-slideInRight z-[321]">
            {showAuthRedirectOption && (
              <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 flex flex-col gap-2">
                <p className="text-sm text-amber-800">Sign-in was blocked. Use the button below to sign in in this tab, then try again.</p>
                <button
                  type="button"
                  className="btn btn-sm btn-warning"
                  onClick={async () => {
                    const params = authRedirectParamsRef.current;
                    if (!params) return;
                    setShowAuthRedirectOption(false);
                    authRedirectParamsRef.current = null;
                    toast.loading('Redirecting to Microsoft sign-in… Complete reschedule again after you return.', { duration: 5000 });
                    await triggerTokenRedirect(instance, params.request, params.account);
                  }}
                >
                  Sign in (this tab)
                </button>
              </div>
            )}
            {/* Fixed Header */}
            <div className="flex items-center justify-between p-8 pb-4 border-b border-base-300 pt-[max(2rem,env(safe-area-inset-top))]">
              <h3 className="text-2xl font-bold">Reschedule Meeting</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => {
                setShowAuthRedirectOption(false);
                authRedirectParamsRef.current = null;
                setShowRescheduleDrawer(false);
                setMeetingToDelete(null);
                setNotifyClientOnReschedule(false); // Reset to default
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
                  custom_link: '',
                  custom_address: '',
                });
                setRescheduleOption('cancel');
              }}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-8 pt-4">
              {/* Notify Client Toggle */}
              <div className="mb-6 flex items-center justify-between">
                <label className="block font-semibold text-base">Notify Client</label>
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  checked={notifyClientOnReschedule}
                  onChange={(e) => setNotifyClientOnReschedule(e.target.checked)}
                />
              </div>

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
                            custom_link: selectedMeeting.custom_link || '',
                            custom_address: selectedMeeting.custom_address || '',
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
                        onChange={(e) => handleMeetingLocationChange(e.target.value, 'reschedule')}
                      >
                        {selectableMeetingLocations.map((location) => (
                          <option key={location.id} value={location.name}>
                            {location.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {Number(allMeetingLocations.find((loc: any) => loc.name === rescheduleFormData.location)?.id) === CUSTOM_LINK_LOCATION_ID && (
                      <div>
                        <label className="block font-semibold mb-1">Custom Link</label>
                        <button
                          type="button"
                          className="btn btn-outline w-full justify-start"
                          onClick={() => openCustomLocationModal('reschedule', 'link', rescheduleFormData.custom_link || '')}
                        >
                          {rescheduleFormData.custom_link?.trim() || 'Set custom link'}
                        </button>
                      </div>
                    )}
                    {Number(allMeetingLocations.find((loc: any) => loc.name === rescheduleFormData.location)?.id) === CUSTOM_ADDRESS_LOCATION_ID && (
                      <div>
                        <label className="block font-semibold mb-1">Custom Address</label>
                        <button
                          type="button"
                          className="btn btn-outline w-full justify-start"
                          onClick={() => openCustomLocationModal('reschedule', 'address', rescheduleFormData.custom_address || '')}
                        >
                          {rescheduleFormData.custom_address?.trim() || 'Set custom address'}
                        </button>
                      </div>
                    )}

                    {/* Calendar */}
                    <div>
                      <label className="block font-semibold mb-1">Calendar</label>
                      <select
                        className="select select-bordered w-full"
                        value={rescheduleFormData.calendar}
                        onChange={(e) => setRescheduleFormData((prev: any) => ({ ...prev, calendar: e.target.value }))}
                      >
                        <option value="active_client">Active Client</option>
                        <option value="external">External Meeting</option>
                      </select>
                    </div>

                    {/* Date */}
                    <div>
                      <label className="block font-semibold mb-1">New Date</label>
                      <input
                        type="date"
                        className="input input-bordered w-full"
                        value={rescheduleFormData.date}
                        onChange={(e) => {
                          setRescheduleFormData((prev: any) => ({ ...prev, date: e.target.value }));
                          setMeetingCountsByTime({});
                        }}
                        required
                      />
                    </div>

                    {/* Time */}
                    <TimePicker
                      variant="inline"
                      label="New Time"
                      value={rescheduleFormData.time}
                      onChange={(time) =>
                        setRescheduleFormData((prev: any) => ({ ...prev, time }))
                      }
                      meetingCounts={
                        rescheduleFormData.date ? meetingCountsByTime : {}
                      }
                      minHour={8}
                      maxHour={23}
                      disabled={!rescheduleFormData.date}
                    />

                    {/* External Meeting fields (Internal Meeting with external participants) */}
                    {rescheduleFormData.calendar === 'external' && (
                      <>
                        <div>
                          <label className="block font-semibold mb-1">Meeting Subject</label>
                          <input
                            type="text"
                            className="input input-bordered w-full"
                            placeholder={`[#${client.lead_number || client.id}] ${client.name} - Internal Meeting`}
                            value={rescheduleExternal.subject}
                            onChange={(e) => setRescheduleExternal((prev) => ({ ...prev, subject: e.target.value }))}
                          />
                        </div>

                        <div>
                          <label className="block font-semibold mb-1">Internal Meeting Type</label>
                          <select
                            className="select select-bordered w-full"
                            value={rescheduleExternal.internalMeetingTypeId != null ? String(rescheduleExternal.internalMeetingTypeId) : ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              setRescheduleExternal((prev) => ({ ...prev, internalMeetingTypeId: v === '' ? null : Number(v) }));
                            }}
                            disabled={internalMeetingTypes.length === 0}
                          >
                            {internalMeetingTypes.length === 0 ? (
                              <option value="">Loading types…</option>
                            ) : (
                              internalMeetingTypes.map((t) => (
                                <option key={t.id} value={String(t.id)}>{t.label}</option>
                              ))
                            )}
                          </select>
                        </div>

                        <div className="relative" ref={rescheduleStaffDropdownRef}>
                          <label className="block font-semibold mb-1">Staff Attendees</label>
                          <input
                            type="text"
                            className="input input-bordered w-full"
                            placeholder="Search staff..."
                            value={rescheduleStaffSearch}
                            onFocus={() => setShowRescheduleStaffDropdown(true)}
                            onChange={(e) => { setRescheduleStaffSearch(e.target.value); setShowRescheduleStaffDropdown(true); }}
                          />
                          {showRescheduleStaffDropdown && (
                            <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                              {(() => {
                                const q = rescheduleStaffSearch.trim().toLowerCase();
                                const list = (allEmployees || []).filter((e: any) => !q || (e.display_name || '').toLowerCase().includes(q));
                                return list.length > 0 ? list.map((emp: any) => {
                                  const isSelected = rescheduleExternal.selectedStaffEmployeeIds.includes(Number(emp.id));
                                  return (
                                    <div
                                      key={emp.id}
                                      className={`px-4 py-2 cursor-pointer flex items-center justify-between ${isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-gray-100'}`}
                                      onClick={() => {
                                        setRescheduleExternal((prev) => ({
                                          ...prev,
                                          selectedStaffEmployeeIds: isSelected
                                            ? prev.selectedStaffEmployeeIds.filter((id) => id !== Number(emp.id))
                                            : [...prev.selectedStaffEmployeeIds, Number(emp.id)],
                                        }));
                                      }}
                                    >
                                      <span>{emp.display_name}</span>
                                      {isSelected && <span className="text-xs">Selected</span>}
                                    </div>
                                  );
                                }) : (
                                  <div className="px-4 py-2 text-gray-500 text-center">No employees found</div>
                                );
                              })()}
                            </div>
                          )}
                          {rescheduleExternal.selectedStaffEmployeeIds.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {rescheduleExternal.selectedStaffEmployeeIds.map((id) => {
                                const emp = (allEmployees || []).find((e: any) => Number(e.id) === id);
                                return (
                                  <span key={id} className="badge badge-outline gap-2">
                                    {emp?.display_name || id}
                                    <button
                                      type="button"
                                      className="text-gray-500 hover:text-gray-800"
                                      onClick={() => setRescheduleExternal((prev) => ({
                                        ...prev,
                                        selectedStaffEmployeeIds: prev.selectedStaffEmployeeIds.filter((x) => x !== id),
                                      }))}
                                    >×</button>
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        <div className="relative" ref={rescheduleFirmContactDropdownRef}>
                          <label className="block font-semibold mb-1">Firm Contacts</label>
                          <input
                            type="text"
                            className="input input-bordered w-full"
                            placeholder="Search firm contacts..."
                            value={rescheduleFirmContactSearch}
                            onFocus={() => setShowRescheduleFirmContactDropdown(true)}
                            onChange={(e) => { setRescheduleFirmContactSearch(e.target.value); setShowRescheduleFirmContactDropdown(true); }}
                          />
                          {showRescheduleFirmContactDropdown && (
                            <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                              {(() => {
                                const q = rescheduleFirmContactSearch.trim().toLowerCase();
                                const list = (q ? firmContacts.filter((c) => c.name.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q)) : firmContacts).slice(0, 50);
                                return list.length > 0 ? list.map((c) => {
                                  const isSelected = rescheduleExternal.selectedFirmContactIds.includes(c.id);
                                  return (
                                    <div
                                      key={c.id}
                                      className={`px-4 py-2 cursor-pointer flex items-center justify-between ${isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-gray-100'}`}
                                      onClick={() => {
                                        setRescheduleExternal((prev) => ({
                                          ...prev,
                                          selectedFirmContactIds: isSelected
                                            ? prev.selectedFirmContactIds.filter((id) => id !== c.id)
                                            : [...prev.selectedFirmContactIds, c.id],
                                        }));
                                      }}
                                    >
                                      <div className="min-w-0">
                                        <div className="font-semibold truncate">{c.name}</div>
                                        <div className="text-xs text-gray-500 truncate">{c.email || c.phone || ''}</div>
                                      </div>
                                      {isSelected && <span className="text-xs ml-2">Selected</span>}
                                    </div>
                                  );
                                }) : (
                                  <div className="px-4 py-2 text-gray-500 text-center">No matches</div>
                                );
                              })()}
                            </div>
                          )}
                          {rescheduleExternal.selectedFirmContactIds.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {rescheduleExternal.selectedFirmContactIds.map((id) => {
                                const c = firmContacts.find((x) => x.id === id);
                                if (!c) return null;
                                return (
                                  <span key={id} className="badge badge-outline gap-2">
                                    {c.name}
                                    <button
                                      type="button"
                                      className="text-gray-500 hover:text-gray-800"
                                      onClick={() => setRescheduleExternal((prev) => ({
                                        ...prev,
                                        selectedFirmContactIds: prev.selectedFirmContactIds.filter((x) => x !== id),
                                      }))}
                                    >×</button>
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        <div>
                          <label className="block font-semibold mb-1">Extern Participant</label>
                          <div className="grid grid-cols-1 gap-2">
                            <input
                              className="input input-bordered w-full"
                              placeholder="Name"
                              value={rescheduleExternal.freeDraft.name}
                              onChange={(e) => setRescheduleExternal((prev) => ({ ...prev, freeDraft: { ...prev.freeDraft, name: e.target.value } }))}
                            />
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              <input
                                className="input input-bordered w-full"
                                placeholder="Email (optional)"
                                value={rescheduleExternal.freeDraft.email || ''}
                                onChange={(e) => setRescheduleExternal((prev) => ({ ...prev, freeDraft: { ...prev.freeDraft, email: e.target.value } }))}
                              />
                              <input
                                className="input input-bordered w-full"
                                placeholder="Phone (optional)"
                                value={rescheduleExternal.freeDraft.phone || ''}
                                onChange={(e) => setRescheduleExternal((prev) => ({ ...prev, freeDraft: { ...prev.freeDraft, phone: e.target.value } }))}
                              />
                            </div>
                            <textarea
                              className="textarea textarea-bordered w-full"
                              placeholder="Notes (optional)"
                              value={rescheduleExternal.freeDraft.notes || ''}
                              onChange={(e) => setRescheduleExternal((prev) => ({ ...prev, freeDraft: { ...prev.freeDraft, notes: e.target.value } }))}
                            />
                            <button
                              type="button"
                              className="btn btn-sm btn-outline"
                              onClick={() => {
                                const name = (rescheduleExternal.freeDraft.name || '').trim();
                                if (!name) { toast.error('Extern participant name is required'); return; }
                                setRescheduleExternal((prev) => ({
                                  ...prev,
                                  freeParticipants: [
                                    ...prev.freeParticipants,
                                    {
                                      name,
                                      email: (prev.freeDraft.email || '').trim() || undefined,
                                      phone: (prev.freeDraft.phone || '').trim() || undefined,
                                      notes: (prev.freeDraft.notes || '').trim() || undefined,
                                    },
                                  ],
                                  freeDraft: { name: '', email: '', phone: '', notes: '' },
                                }));
                              }}
                            >
                              Add participant
                            </button>
                          </div>
                          {rescheduleExternal.freeParticipants.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {rescheduleExternal.freeParticipants.map((p, idx) => (
                                <span key={`${p.name}-${idx}`} className="badge badge-outline gap-2">
                                  {p.name}
                                  <button
                                    type="button"
                                    className="text-gray-500 hover:text-gray-800"
                                    onClick={() => setRescheduleExternal((prev) => ({
                                      ...prev,
                                      freeParticipants: prev.freeParticipants.filter((_, i) => i !== idx),
                                    }))}
                                  >×</button>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    {/* Meeting Brief (Optional) — always available */}
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

                    {/* Active-client-only fields: hidden for External Meeting */}
                    {rescheduleFormData.calendar !== 'external' && (
                      <>
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
                      custom_link: '',
                      custom_address: '',
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
        </div>,
        document.body
      )}

      {showCustomLocationModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowCustomLocationModal(false)} />
          <div className="relative w-full max-w-md rounded-xl bg-base-100 border border-base-300 shadow-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-bold">
                {customLocationMode === 'link' ? 'Custom Link' : 'Custom Address'}
              </h4>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle"
                onClick={() => setShowCustomLocationModal(false)}
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <input
              type={customLocationMode === 'link' ? 'url' : 'text'}
              className="input input-bordered w-full"
              value={customLocationDraft}
              onChange={(e) => setCustomLocationDraft(e.target.value)}
              placeholder={customLocationMode === 'link' ? 'https://example.com/meeting' : 'Enter address'}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setShowCustomLocationModal(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={handleSaveCustomLocationValue}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MeetingTab; 