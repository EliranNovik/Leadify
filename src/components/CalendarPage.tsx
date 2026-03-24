import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Link, useNavigate, useNavigationType, useLocation } from 'react-router-dom';
import { useCachedFetch } from '../hooks/useCachedFetch';
import { usePersistedState } from '../hooks/usePersistedState';
import { CalendarIcon, FunnelIcon, UserIcon, CurrencyDollarIcon, VideoCameraIcon, MapPinIcon, ChevronDownIcon, DocumentArrowUpIcon, FolderIcon, ClockIcon, ChevronLeftIcon, ChevronRightIcon, AcademicCapIcon, QuestionMarkCircleIcon, XMarkIcon, PaperAirplaneIcon, FaceSmileIcon, PaperClipIcon, Bars3Icon, Squares2X2Icon, UserGroupIcon, TruckIcon, BookOpenIcon, FireIcon, PencilIcon, PhoneIcon, EyeIcon, PencilSquareIcon, CheckIcon, CheckBadgeIcon, XCircleIcon, CheckCircleIcon, ExclamationTriangleIcon, EllipsisVerticalIcon, PlusIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import DocumentModal from './DocumentModal';
import { FaWhatsapp } from 'react-icons/fa';
import { EnvelopeIcon } from '@heroicons/react/24/outline';
import { createPortal } from 'react-dom';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../msalConfig';
import { toast } from 'react-hot-toast';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import sanitizeHtml from 'sanitize-html';
import { buildApiUrl } from '../lib/api';
import { fetchStageNames, getStageName, refreshStageNames, getStageColour } from '../lib/stageUtils';
import TeamsMeetingModal from './TeamsMeetingModal';
import StaffMeetingEditModal from './StaffMeetingEditModal';
import DepartmentList from './DepartmentList';
import SchedulerWhatsAppModal from './SchedulerWhatsAppModal';
import SchedulerEmailThreadModal from './SchedulerEmailThreadModal';

// Email templates
const emailTemplates = [
  {
    name: 'Document Reminder',
    subject: 'Reminder: Required Documents for Your Application',
    body: `Dear {client_name},\n\nAs part of your application process, we kindly remind you to upload the required documents to your client portal.\n\nThis will help us proceed without delays. If you need assistance or are unsure which documents are still needed, please contact us.\n\nYou can upload documents here: {upload_link}\n\nThank you for your cooperation.`,
  },
  {
    name: 'Application Submission Confirmation',
    subject: 'Confirmation: Your Application Has Been Submitted',
    body: `Dear {client_name},\n\nWe're pleased to inform you that your application has been successfully submitted to the relevant authorities.\n\nYou will be notified once there are any updates or additional requirements. Please note that processing times may vary depending on the case.\n\nIf you have any questions or wish to discuss the next steps, feel free to contact your case manager.`,
  },
];

// Helper to get current user's full name from Supabase (auth_id first, then email fallback)
async function fetchCurrentUserFullName() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  let data: { full_name: string } | null = null;
  const byAuth = await supabase.from('users').select('full_name').eq('auth_id', user.id).maybeSingle();
  if (byAuth.data?.full_name) data = byAuth.data;
  else if (user.email) {
    const byEmail = await supabase.from('users').select('full_name').eq('email', user.email).maybeSingle();
    if (byEmail.data?.full_name) data = byEmail.data;
  }
  return data?.full_name ?? null;
}

// Helper to acquire token, falling back to popup if needed
const acquireToken = async (instance: any, account: any) => {
  try {
    return await instance.acquireTokenSilent({ ...loginRequest, account });
  } catch (error) {
    if (error instanceof Error && error.name === 'InteractionRequiredAuthError') {
      toast('Your session has expired. Please sign in again.', { icon: '🔑' });
      return await instance.acquireTokenPopup({ ...loginRequest, account });
    }
    throw error;
  }
};

// Microsoft Graph API: Send email
async function sendClientEmail(token: string, subject: string, body: string, client: any, senderName: string, attachments: { name: string; contentType: string; contentBytes: string }[]) {
  // Get the user's email signature from the database
  const { getCurrentUserEmailSignature } = await import('../lib/emailSignature');
  const userSignature = await getCurrentUserEmailSignature();

  // Handle signature (HTML or plain text)
  let signatureHtml = '';
  if (userSignature) {
    // Check if signature is already HTML
    if (userSignature.includes('<') && userSignature.includes('>')) {
      signatureHtml = `<br><br>${userSignature}`;
    } else {
      // Convert plain text to HTML
      signatureHtml = `<br><br>${userSignature.replace(/\n/g, '<br>')}`;
    }
  } else {
    // Fallback to default signature
    signatureHtml = `<br><br>Best regards,<br>${senderName}<br>Decker Pex Levi Law Offices`;
  }

  const fullBody = body + signatureHtml;

  const messageAttachments = attachments.map(att => ({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: att.name,
    contentType: att.contentType,
    contentBytes: att.contentBytes,
  }));

  const message = {
    subject: subject,
    body: {
      contentType: 'HTML',
      content: fullBody,
    },
    toRecipients: [
      {
        emailAddress: {
          address: client.email,
        },
      },
    ],
    attachments: messageAttachments,
  };

  const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to send email: ${errorText}`);
  }
}

// Microsoft Graph API: Fetch emails for a client and sync to DB
async function syncClientEmails(token: string, client: any) {
  if (!client.email || !client.lead_number) return;

  // Use $search for a more robust query. It searches across common fields.
  // The search term should be enclosed in quotes for Graph API.
  const searchQuery = `"${client.lead_number}" OR "${client.email}"`;

  const url = `https://graph.microsoft.com/v1.0/me/messages?$search=${encodeURIComponent(searchQuery)}&$top=50&$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,conversationId,hasAttachments`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      ConsistencyLevel: 'eventual' // Required for $search
    }
  });
  if (!res.ok) {
    const errorText = await res.text();
    console.error("Microsoft Graph API error:", errorText);
    // Try to parse for a more specific error from Graph
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson?.error?.message) {
        throw new Error(`Graph API Error: ${errorJson.error.message}`);
      }
    } catch (e) { }
    throw new Error('Failed to fetch from Microsoft Graph');
  }

  const json = await res.json();
  const messages = json.value || [];

  // With a broad search, the client-side safeguard is even more important.
  const clientMessages = messages.filter((msg: any) =>
    (msg.subject && msg.subject.includes(client.lead_number!)) ||
    (msg.from?.emailAddress?.address.toLowerCase() === client.email!.toLowerCase()) ||
    (msg.toRecipients || []).some((r: any) => r.emailAddress.address.toLowerCase() === client.email!.toLowerCase()) ||
    (msg.ccRecipients || []).some((r: any) => r.emailAddress.address.toLowerCase() === client.email!.toLowerCase())
  );

  if (clientMessages.length === 0) {
    console.log("No relevant emails found after filtering.");
    return;
  }

  // Sort the messages by date on the client side.
  clientMessages.sort((a: any, b: any) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime());

  // Fetch attachments for messages that have them
  for (const msg of clientMessages) {
    if (msg.hasAttachments) {
      const attachmentsUrl = `https://graph.microsoft.com/v1.0/me/messages/${msg.id}/attachments?$select=id,name,contentType,size,isInline`;
      const attachmentsRes = await fetch(attachmentsUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (attachmentsRes.ok) {
        const attachmentsJson = await attachmentsRes.json();
        msg.attachments = (attachmentsJson.value || []).map((att: any) => ({
          ...att,
          sizeInBytes: att.size // Correcting the property name from sizeInBytes to size
        }));
      }
    }
  }

  // 4. Prepare data for Supabase (upsert to avoid duplicates)
  const emailsToUpsert = clientMessages.map((msg: any) => {
    const isOutgoing = msg.from?.emailAddress?.address.toLowerCase().includes('lawoffice.org.il');
    const originalBody = msg.body?.content || '';
    const processedBody = !isOutgoing ? stripSignatureAndQuotedText(originalBody) : originalBody;

    return {
      message_id: msg.id,
      client_id: client.id,
      thread_id: msg.conversationId,
      sender_name: msg.from?.emailAddress?.name,
      sender_email: msg.from?.emailAddress?.address,
      recipient_list: (msg.toRecipients || []).map((r: any) => r.emailAddress.address).join(', '),
      subject: msg.subject,
      body_preview: processedBody,
      sent_at: msg.receivedDateTime,
      direction: isOutgoing ? 'outgoing' : 'incoming',
      attachments: msg.attachments || null,
    };
  });

  // 5. Upsert into our database
  await supabase.from('emails').upsert(emailsToUpsert, { onConflict: 'message_id' });
}

// Helper function to strip signatures and quoted text from emails
const stripSignatureAndQuotedText = (html: string): string => {
  if (!html) return '';

  // Remove HTML tags
  const text = html.replace(/<[^>]*>/g, '');

  // Remove common email signatures and quoted text
  const lines = text.split('\n');
  const cleanedLines = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip signature lines
    if (trimmed.startsWith('--') ||
      trimmed.startsWith('Best regards') ||
      trimmed.startsWith('Sincerely') ||
      trimmed.startsWith('Thank you') ||
      trimmed.includes('Decker Pex Levi Law Offices') ||
      trimmed.includes('lawoffice.org.il')) {
      break;
    }

    // Skip quoted text (lines starting with >)
    if (trimmed.startsWith('>')) {
      continue;
    }

    cleanedLines.push(line);
  }

  return cleanedLines.join('\n').trim();
};

// Add a helper for currency symbol
const getCurrencySymbol = (currency?: string) => {
  switch (currency) {
    case 'USD': return '$';
    case 'EUR': return '€';
    case 'NIS':
    default: return '₪';
  }
};

// Department mapping is now loaded dynamically from database


const CalendarPage: React.FC = () => {
  // Persist meetings state so they're preserved when navigating back
  const [meetings, setMeetings] = usePersistedState<any[]>('calendar-meetings', [], {
    storage: 'sessionStorage',
  });
  const [filteredMeetings, setFilteredMeetings] = useState<any[]>([]);
  const [staff, setStaff] = useState<string[]>([]);

  // Persist date filters so they're preserved when navigating back
  const [fromDate, setFromDate] = usePersistedState('calendar-fromDate', new Date().toISOString().split('T')[0], {
    storage: 'sessionStorage',
  });
  const [toDate, setToDate] = usePersistedState('calendar-toDate', new Date().toISOString().split('T')[0], {
    storage: 'sessionStorage',
  });
  const [appliedFromDate, setAppliedFromDate] = usePersistedState('calendar-appliedFromDate', new Date().toISOString().split('T')[0], {
    storage: 'sessionStorage',
  });
  const [appliedToDate, setAppliedToDate] = usePersistedState('calendar-appliedToDate', new Date().toISOString().split('T')[0], {
    storage: 'sessionStorage',
  });
  const [datesManuallySet, setDatesManuallySet] = usePersistedState('calendar-datesManuallySet', false, {
    storage: 'sessionStorage',
  });
  const [meetingsRefreshTrigger, setMeetingsRefreshTrigger] = useState(0);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [staffSearchTerm, setStaffSearchTerm] = useState('');
  const [showStaffDropdown, setShowStaffDropdown] = useState(false);
  const [totalAmount, setTotalAmount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isBackgroundLoading, setIsBackgroundLoading] = useState(false);
  const [isLegacyLoading, setIsLegacyLoading] = useState(false);
  const [expandedMeetingId, setExpandedMeetingId] = useState<number | null>(null);
  const [expandedMeetingData, setExpandedMeetingData] = useState<{
    [meetingId: number]: {
      loading: boolean;
      expert_notes?: any;
      handler_notes?: any;
      facts?: string;
    }
  }>({});
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<any>(null);
  const [leadsWithPastStages, setLeadsWithPastStages] = useState<Set<string>>(new Set());
  const navigate = useNavigate();
  const navType = useNavigationType();

  // Row selection and action menu state
  const [selectedRowId, setSelectedRowId] = useState<string | number | null>(null);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [selectedLeadForActions, setSelectedLeadForActions] = useState<any>(null);

  // WhatsApp functionality
  const [isWhatsAppOpen, setIsWhatsAppOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('list');
  const [selectedClientForWhatsApp, setSelectedClientForWhatsApp] = useState<{
    id: string;
    name: string;
    lead_number: string;
    phone?: string;
    mobile?: string;
    lead_type?: string;
  } | null>(null);
  const { instance, accounts } = useMsal();

  // Currency conversion rates (same as DepartmentList)
  const currencyRates = {
    'USD': 3.7,  // 1 USD = 3.7 NIS (approximate)
    'EUR': 4.0,  // 1 EUR = 4.0 NIS (approximate)
    'GBP': 4.7,  // 1 GBP = 4.7 NIS (approximate)
    'NIS': 1,    // 1 NIS = 1 NIS
    '₪': 1,      // 1 ₪ = 1 NIS
    'ILS': 1     // 1 ILS = 1 NIS
  };

  // Helper function to convert any currency amount to NIS
  const convertToNIS = (amount: number, currency: string): number => {
    if (!amount || amount <= 0) return 0;

    const normalizedCurrency = currency?.toUpperCase().trim();
    const rate = currencyRates[normalizedCurrency as keyof typeof currencyRates] || 1;

    return amount * rate;
  };

  // Set default view mode based on screen size
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        // Mobile: default to cards view
        setViewMode('cards');
      } else {
        // Desktop: default to list view
        setViewMode('list');
      }
    };

    // Set initial view mode
    handleResize();

    // Add event listener for window resize
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const fetchCurrentEmployeeMetadata = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.id) return;
        let data: { employee_id: number | null; full_name: string; email?: string } | null = null;
        const byAuth = await supabase
          .from('users')
          .select('employee_id, full_name, email')
          .eq('auth_id', user.id)
          .maybeSingle();
        if (byAuth.data) data = byAuth.data;
        else if (user.email) {
          const byEmail = await supabase
            .from('users')
            .select('employee_id, full_name, email')
            .eq('email', user.email)
            .maybeSingle();
          if (byEmail.data) data = byEmail.data;
        }
        if (!data) return;
        if (data.employee_id != null && !Number.isNaN(Number(data.employee_id))) {
          setCurrentEmployeeId(Number(data.employee_id));
        }
        setCurrentEmployeeName(data.full_name || user.email || '');
      } catch (error) {
        console.warn('CalendarPage: failed to load current employee metadata', error);
      }
    };

    fetchCurrentEmployeeMetadata();
  }, []);

  useEffect(() => {
    setStaffSearchTerm(selectedStaff);
  }, [selectedStaff]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const inMain = staffDropdownRef.current?.contains(target);
      const inModal = staffDropdownModalRef.current?.contains(target);
      if (showStaffDropdown && !inMain && !inModal) {
        setShowStaffDropdown(false);
      }
    };

    if (showStaffDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showStaffDropdown]);

  // Email functionality
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [selectedClientForEmail, setSelectedClientForEmail] = useState<{
    id: string;
    name: string;
    lead_number: string;
    email?: string;
    lead_type?: string;
    topic?: string;
    user_internal_id?: string | number | null;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const quillRef = useRef<ReactQuill>(null);
  const staffDropdownRef = useRef<HTMLDivElement | null>(null);
  const staffDropdownModalRef = useRef<HTMLDivElement | null>(null);
  const actionMenuDropdownRef = useRef<HTMLDivElement | null>(null);

  // Assign Staff Modal State
  const [isAssignStaffModalOpen, setIsAssignStaffModalOpen] = useState(false);
  const [assignStaffMeetings, setAssignStaffMeetings] = useState<any[]>([]);
  const [assignStaffLoading, setAssignStaffLoading] = useState(false);
  const [availableStaff, setAvailableStaff] = useState<string[]>([]);
  const [modalSelectedDate, setModalSelectedDate] = useState<string>('');
  const [selectedStaffFilter, setSelectedStaffFilter] = useState<string>('');
  const [allLanguages, setAllLanguages] = useState<Array<{ id: number; name: string }>>([]);

  // Guest Selection Modal State
  const [isGuestSelectionModalOpen, setIsGuestSelectionModalOpen] = useState(false);
  const [selectedMeetingForGuest, setSelectedMeetingForGuest] = useState<any>(null);
  const [guestSelectionType, setGuestSelectionType] = useState<'extern1' | 'extern2' | null>(null);
  const [guestSearchTerm, setGuestSearchTerm] = useState('');

  // Notes Modal State
  const [isNotesModalOpen, setIsNotesModalOpen] = useState(false);
  const [selectedMeetingForNotes, setSelectedMeetingForNotes] = useState<any>(null);

  // Employee Availability State
  const [employeeAvailability, setEmployeeAvailability] = useState<{ [key: string]: any[] }>({});
  const [unavailableEmployees, setUnavailableEmployees] = useState<{ [key: string]: any[] }>({});
  const [showMoreUnavailableDropdown, setShowMoreUnavailableDropdown] = useState(false);
  const [meetingCounts, setMeetingCounts] = useState<{ [clientId: string]: number }>({});
  const [previousManagers, setPreviousManagers] = useState<{ [meetingId: number]: string }>({});
  const [meetingLocations, setMeetingLocations] = useState<{ [locationId: number]: string }>({});
  // Map of meeting location name -> default_link (from tenants_meetinglocation)
  const [meetingLocationLinks, setMeetingLocationLinks] = useState<{ [locationName: string]: string }>({});
  // Map of meeting location name -> location ID (for reverse lookup)
  const [meetingLocationNameToId, setMeetingLocationNameToId] = useState<{ [locationName: string]: number }>({});
  // Set of location IDs that should show a meeting link button (from tenants_meetinglocation with default_link)
  const meetingLocationIdsWithLink = new Set([3, 4, 15, 16, 17, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
  const [dropdownPosition, setDropdownPosition] = useState<{ x: number; y: number; width: number; openUpward?: boolean } | null>(null);
  const [activeDropdown, setActiveDropdown] = useState<{ meetingId: string | number; type: 'manager' | 'helper' } | null>(null);
  const [dropdownStates, setDropdownStates] = useState<{
    [meetingId: string | number]: {
      managerSearch: string;
      helperSearch: string;
      showManagerDropdown: boolean;
      showHelperDropdown: boolean;
    };
  }>({});


  // State to store all employees and categories for name lookup
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [currentEmployeeId, setCurrentEmployeeId] = useState<number | null>(null);
  // On-demand display name cache when allEmployees not yet loaded (avoids console spam and shows names after fetch)
  const [employeeNameCache, setEmployeeNameCache] = useState<Record<string, string>>({});
  const emptyEmployeesLoggedRef = useRef(false);
  const pendingNameFetchesRef = useRef<Set<string>>(new Set());
  const [currentEmployeeName, setCurrentEmployeeName] = useState<string>('');
  const [meetingConfirmationLoadingId, setMeetingConfirmationLoadingId] = useState<string | number | null>(null);

  // State to track legacy loading failures
  const [legacyLoadingDisabled, setLegacyLoadingDisabled] = useState(false);

  // Meeting type filter state
  const [selectedMeetingType, setSelectedMeetingType] = useState<
    'all' | 'potential' | 'active' | 'staff' | 'paid'
  >('all');

  // Staff meetings state
  const [staffMeetings, setStaffMeetings] = useState<any[]>([]);
  const [isStaffMeetingsLoading, setIsStaffMeetingsLoading] = useState(false);

  // Teams meeting modal state
  const [isTeamsMeetingModalOpen, setIsTeamsMeetingModalOpen] = useState(false);
  const [selectedDateForMeeting, setSelectedDateForMeeting] = useState<Date | null>(null);
  const [selectedTimeForMeeting, setSelectedTimeForMeeting] = useState<string>('');

  // Staff meeting edit modal state
  const [isStaffMeetingEditModalOpen, setIsStaffMeetingEditModalOpen] = useState(false);
  const [selectedStaffMeeting, setSelectedStaffMeeting] = useState<any>(null);
  const [stageNamesLoaded, setStageNamesLoaded] = useState(false);

  // Action menu dropdown state
  const [showActionMenuDropdown, setShowActionMenuDropdown] = useState(false);
  const [actionDropdownPosition, setActionDropdownPosition] = useState<{ top: number; right: number } | null>(null);

  // Mobile filters modal (date, staff, meeting type)
  const [showMobileFiltersModal, setShowMobileFiltersModal] = useState(false);
  const [isCustomAddressModalOpen, setIsCustomAddressModalOpen] = useState(false);
  const [selectedCustomAddress, setSelectedCustomAddress] = useState('');

  // Unavailable staff section collapse state
  const [isUnavailableStaffExpanded, setIsUnavailableStaffExpanded] = useState(false);

  // Handle clicking outside action menu dropdown (trigger or portaled menu)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (actionMenuDropdownRef.current?.contains(target)) return;
      if ((target as Element).closest?.('[data-action-dropdown]')) return;
      setShowActionMenuDropdown(false);
    };

    if (showActionMenuDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showActionMenuDropdown]);

  // Position the action dropdown when it opens (for portal) - useLayoutEffect so position is set before paint
  useLayoutEffect(() => {
    if (!showActionMenuDropdown || !actionMenuDropdownRef.current) {
      setActionDropdownPosition(null);
      return;
    }
    const rect = actionMenuDropdownRef.current.getBoundingClientRect();
    setActionDropdownPosition({
      top: rect.bottom + 8,
      right: window.innerWidth - rect.right,
    });
  }, [showActionMenuDropdown]);

  // Helper function to get employee display name from ID
  const getEmployeeDisplayName = (employeeId: string | number | null | undefined) => {
    if (!employeeId || employeeId === '---' || employeeId === '--') return '--';

    const idStr = String(employeeId).trim();
    if (!idStr || idStr === '') return '--';

    // When allEmployees not yet loaded: use cache or trigger on-demand fetch (avoids console spam)
    if (allEmployees.length === 0) {
      if (employeeNameCache[idStr]) return employeeNameCache[idStr];
      if (!emptyEmployeesLoggedRef.current) {
        emptyEmployeesLoggedRef.current = true;
        console.warn('⚠️ CalendarPage - getEmployeeDisplayName called while allEmployees is empty. Fetching names on demand.');
      }
      const numericId = Number(idStr);
      if (!pendingNameFetchesRef.current.has(idStr) && !isNaN(numericId) && numericId > 0) {
        pendingNameFetchesRef.current.add(idStr);
        void supabase
          .from('tenants_employee')
          .select('id, display_name')
          .eq('id', numericId)
          .maybeSingle()
          .then(
            ({ data }) => {
              pendingNameFetchesRef.current.delete(idStr);
              if (data?.display_name) {
                setEmployeeNameCache((prev) => ({ ...prev, [idStr]: data.display_name }));
              }
            },
            () => { pendingNameFetchesRef.current.delete(idStr); }
          );
      }
      return employeeNameCache[idStr] ?? idStr;
    }

    // Find employee in the loaded employees array
    const employee = allEmployees.find((emp: any) => {
      return emp.id.toString() === idStr ||
        emp.id === employeeId ||
        String(emp.id) === idStr ||
        Number(emp.id) === Number(employeeId);
    });

    return employee ? employee.display_name : (employeeNameCache[idStr] ?? idStr);
  };

  // Helper function to get employee object by ID or display name
  const getEmployeeById = (employeeIdOrName: string | number | null | undefined) => {
    if (!employeeIdOrName || employeeIdOrName === '---' || employeeIdOrName === '--') {
      return null;
    }

    // First, try to match by ID (for legacy leads and new leads with ID fields)
    const employeeById = allEmployees.find((emp: any) => {
      const empId = typeof emp.id === 'bigint' ? Number(emp.id) : emp.id;
      const searchId = typeof employeeIdOrName === 'string' ? parseInt(employeeIdOrName, 10) : employeeIdOrName;

      // Skip if searchId is NaN (not a valid number)
      if (isNaN(Number(searchId))) return false;

      // Try exact match
      if (empId.toString() === searchId.toString()) return true;
      if (Number(empId) === Number(searchId)) return true;

      return false;
    });

    if (employeeById) {
      return employeeById;
    }

    // If not found by ID, try to match by display name (for new leads where display_name is saved)
    if (typeof employeeIdOrName === 'string') {
      const employeeByName = allEmployees.find((emp: any) => {
        if (!emp.display_name) return false;
        // Case-insensitive match, trim whitespace
        return emp.display_name.trim().toLowerCase() === employeeIdOrName.trim().toLowerCase();
      });

      if (employeeByName) {
        return employeeByName;
      }
    }

    return null;
  };

  // Helper function to get employee initials
  const getEmployeeInitials = (name: string) => {
    if (!name) return '--';
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Track image errors per employee to prevent flickering (persists across re-renders)
  const imageErrorCache = useRef<Map<string | number, boolean>>(new Map());

  // Track previous fetch deps so we don't refetch when navigating back with cached meetings
  const prevFetchDepsRef = useRef({
    pathname: location.pathname,
    appliedFromDate,
    appliedToDate,
    datesManuallySet,
    meetingsRefreshTrigger,
  });

  // Helper component for employee avatar with image error fallback (like CallsLedgerPage)
  const EmployeeAvatar: React.FC<{
    employeeId: string | number | null | undefined;
    size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
    showPlaceholder?: boolean; // If false, return null when no employee (for unassigned roles)
  }> = ({ employeeId, size = 'md', showPlaceholder = false }) => {
    const [imageError, setImageError] = useState(false);
    const employee = getEmployeeById(employeeId);

    // Check cache first to prevent flickering
    const cacheKey = employeeId?.toString() || '';
    const cachedError = imageErrorCache.current.get(cacheKey) || false;

    if (!employee) {
      // Return null if no placeholder should be shown (for unassigned roles)
      if (!showPlaceholder) {
        return null;
      }
      // Return placeholder only if showPlaceholder is true
      const sizeMap = {
        'sm': 'w-8 h-8 text-xs',
        'md': 'w-10 h-10 text-sm',
        'lg': 'w-14 h-14 text-base',
        'xl': 'w-20 h-20 text-lg',
        '2xl': 'w-28 h-28 text-xl'
      };
      return (
        <div className={`${sizeMap[size]} rounded-full flex items-center justify-center bg-gray-200 text-gray-500 font-semibold flex-shrink-0`}>
          --
        </div>
      );
    }

    const photoUrl = employee.photo_url || employee.photo;
    const initials = getEmployeeInitials(employee.display_name);
    const sizeMap = {
      'sm': 'w-8 h-8 text-xs',
      'md': 'w-10 h-10 text-sm',
      'lg': 'w-14 h-14 text-base',
      'xl': 'w-20 h-20 text-lg',
      '2xl': 'w-28 h-28 text-xl'
    };
    const sizeClasses = sizeMap[size];

    // Use cached error if available, otherwise use state
    const hasError = cachedError || imageError;

    // If we know there's no photo URL or we have a cached error, show initials immediately
    if (hasError || !photoUrl) {
      return (
        <div className={`${sizeClasses} rounded-full flex items-center justify-center bg-green-100 text-green-700 font-semibold flex-shrink-0`}>
          {initials}
        </div>
      );
    }

    // Try to render image
    return (
      <img
        src={photoUrl}
        alt={employee.display_name}
        className={`${sizeClasses} rounded-full object-cover flex-shrink-0`}
        onError={(e) => {
          // Cache the error to prevent flickering on re-renders
          if (cacheKey) {
            imageErrorCache.current.set(cacheKey, true);
          }
          setImageError(true);
        }}
      />
    );
  };

  // Helper function to render employee avatar (wrapper for backward compatibility)
  const renderEmployeeAvatar = (employeeId: string | number | null | undefined, size: 'sm' | 'md' | 'lg' | 'xl' | '2xl' = 'md', showPlaceholder: boolean = false) => {
    return <EmployeeAvatar employeeId={employeeId} size={size} showPlaceholder={showPlaceholder} />;
  };

  // Helper function to get role display name
  const getRoleDisplayName = (roleCode: string | null | undefined): string => {
    if (!roleCode) return 'N/A';

    const roleMap: { [key: string]: string } = {
      'c': 'Closer',
      's': 'Scheduler',
      'h': 'Handler',
      'n': 'No role',
      'e': 'Expert',
      'z': 'Manager',
      'Z': 'Manager',
      'p': 'Partner',
      'm': 'Manager',
      'dm': 'Department Manager',
      'pm': 'Project Manager',
      'se': 'Secretary',
      'b': 'Book keeper',
      'partners': 'Partners',
      'dv': 'Developer',
      'ma': 'Marketing',
      'P': 'Partner',
      'M': 'Manager',
      'DM': 'Department Manager',
      'PM': 'Project Manager',
      'SE': 'Secretary',
      'B': 'Book keeper',
      'Partners': 'Partners',
      'd': 'Diverse',
      'f': 'Finance',
      'col': 'Collection',
      'lawyer': 'Helper Closer'
    };

    return roleMap[roleCode] || roleCode || 'N/A';
  };

  const handleStaffSelect = (name: string) => {
    setSelectedStaff(name);
    setStaffSearchTerm(name);
    setShowStaffDropdown(false);
  };

  const filteredStaffOptions = staff.filter(option =>
    option.toLowerCase().includes((staffSearchTerm || '').toLowerCase())
  );

  const parseMeetingConfirmationValue = (value: any): boolean | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const trimmed = value.toLowerCase().trim();
      if (trimmed === 'true') return true;
      if (trimmed === 'false') return false;
      const parsedDate = Date.parse(value);
      if (!Number.isNaN(parsedDate)) return true;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    return null;
  };

  const getMeetingConfirmationState = (meeting: any): boolean => {
    if (!meeting) return false;
    if (meeting.legacy_lead) {
      const legacyValue = parseMeetingConfirmationValue(meeting.legacy_lead.meeting_confirmation);
      if (legacyValue !== null) return legacyValue;
    }
    if (meeting.lead) {
      const leadValue = parseMeetingConfirmationValue(meeting.lead.meeting_confirmation);
      if (leadValue !== null) return leadValue;
    }
    if (meeting.meeting_confirmation !== undefined) {
      const directValue = parseMeetingConfirmationValue(meeting.meeting_confirmation);
      if (directValue !== null) return directValue;
    }
    return false;
  };

  // Send notification message to employee when added as guest
  const sendGuestNotification = async (employeeId: string | number, meeting: any, guestType: 'extern1' | 'extern2') => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return;

      let currentUserData: { id: string } | null = null;
      const byAuth = await supabase.from('users').select('id').eq('auth_id', user.id).maybeSingle();
      if (byAuth.data) currentUserData = byAuth.data;
      else if (user.email) {
        const byEmail = await supabase.from('users').select('id').eq('email', user.email).maybeSingle();
        if (byEmail.data) currentUserData = byEmail.data;
      }
      if (!currentUserData?.id) return;

      // Get target employee's user_id from users table
      const { data: targetUserData } = await supabase
        .from('users')
        .select('id')
        .eq('employee_id', employeeId)
        .single();

      if (!targetUserData?.id) {
        console.error('Target employee not found in users table');
        return;
      }

      // Format meeting date as dd/mm/yyyy
      const formatDate = (dateString: string): string => {
        if (!dateString) return 'TBD';
        try {
          const date = new Date(dateString);
          const day = String(date.getDate()).padStart(2, '0');
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const year = date.getFullYear();
          return `${day}/${month}/${year}`;
        } catch (error) {
          return dateString;
        }
      };

      // Format meeting time without seconds
      const formatTime = (timeString: string): string => {
        if (!timeString) return 'TBD';
        // If time includes seconds (HH:MM:SS), remove them
        if (timeString.includes(':') && timeString.split(':').length === 3) {
          return timeString.substring(0, 5); // Return HH:MM
        }
        return timeString;
      };

      // Get meeting details for the message
      const meetingDate = formatDate(meeting.meeting_date || '');
      const meetingTime = formatTime(meeting.meeting_time || '');
      const clientName = meeting.lead?.name || meeting.legacy_lead?.name || 'Client';
      const leadNumber = meeting.lead?.lead_number || meeting.legacy_lead?.lead_number || '';
      const location = meeting.meeting_location || meeting.location || 'TBD';

      // Create or find direct conversation
      const { data: conversationId, error: convError } = await supabase.rpc(
        'create_direct_conversation',
        {
          user1_uuid: currentUserData.id,
          user2_uuid: targetUserData.id
        }
      );

      if (convError) {
        console.error('Error creating conversation:', convError);
        return;
      }

      // Wait a bit for conversation to be created
      await new Promise(resolve => setTimeout(resolve, 500));

      // Create notification message with icons
      const guestNumber = guestType === 'extern1' ? '1' : '2';
      const messageContent = `You've been added as Guest ${guestNumber} to a meeting!\n\n` +
        `📅 Date: ${meetingDate}\n` +
        `🕐 Time: ${meetingTime}\n` +
        `👥 Client: ${clientName}${leadNumber ? ` (${leadNumber})` : ''}\n` +
        `📍 Location: ${location}\n\n` +
        `Please check your calendar for more details.`;

      // Insert message into database
      const { error: messageError } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: currentUserData.id,
          content: messageContent,
          message_type: 'text'
        });

      if (messageError) {
        console.error('Error sending notification message:', messageError);
      }
    } catch (error) {
      console.error('Error in sendGuestNotification:', error);
      // Don't show error to user as this is a background notification
    }
  };

  const handleSaveGuest = async (meetingId: string | number, guestType: 'extern1' | 'extern2', employeeId: string | number) => {
    try {
      const { error } = await supabase
        .from('meetings')
        .update({ [guestType]: employeeId.toString() })
        .eq('id', meetingId);

      if (error) {
        console.error('Error saving guest:', error);
        toast.error('Failed to save guest');
        return;
      }

      // Get the meeting object for notification
      const meeting = meetings.find(m => m.id === meetingId);

      // Update local state
      setMeetings(prev =>
        prev.map(m => {
          if (m.id === meetingId) {
            return {
              ...m,
              [guestType]: employeeId.toString(),
            };
          }
          return m;
        })
      );

      // Send notification message
      if (meeting) {
        sendGuestNotification(employeeId, meeting, guestType);
      }

      toast.success(`Guest ${guestType === 'extern1' ? '1' : '2'} added successfully`);
      setIsGuestSelectionModalOpen(false);
      setSelectedMeetingForGuest(null);
      setGuestSelectionType(null);
      setGuestSearchTerm('');
    } catch (error) {
      console.error('Error saving guest:', error);
      toast.error('Failed to save guest');
    }
  };

  const handleRemoveGuest = async (meetingId: string | number, guestType: 'extern1' | 'extern2') => {
    try {
      const { error } = await supabase
        .from('meetings')
        .update({ [guestType]: null })
        .eq('id', meetingId);

      if (error) {
        console.error('Error removing guest:', error);
        toast.error('Failed to remove guest');
        return;
      }

      // Update local state
      setMeetings(prev =>
        prev.map(m => {
          if (m.id === meetingId) {
            return {
              ...m,
              [guestType]: null,
            };
          }
          return m;
        })
      );

      toast.success(`Guest ${guestType === 'extern1' ? '1' : '2'} removed successfully`);
    } catch (error) {
      console.error('Error removing guest:', error);
      toast.error('Failed to remove guest');
    }
  };

  const handleMeetingConfirmationToggle = async (meeting: any) => {
    if (!meeting || meeting.calendar_type === 'staff') return;
    const meetingId = meeting.id;
    const currentValue = getMeetingConfirmationState(meeting);
    const newValue = !currentValue;
    setMeetingConfirmationLoadingId(meetingId);

    let employeeIdToUse = currentEmployeeId;

    try {
      if (employeeIdToUse === null || !currentEmployeeName) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.id) {
          let userRecord: { employee_id: number | null; full_name: string; email?: string } | null = null;
          const byAuth = await supabase.from('users').select('employee_id, full_name, email').eq('auth_id', user.id).maybeSingle();
          if (byAuth.data) userRecord = byAuth.data;
          else if (user.email) {
            const byEmail = await supabase.from('users').select('employee_id, full_name, email').eq('email', user.email).maybeSingle();
            if (byEmail.data) userRecord = byEmail.data;
          }
          if (userRecord) {
            if (employeeIdToUse === null && userRecord.employee_id != null && !Number.isNaN(Number(userRecord.employee_id))) {
              employeeIdToUse = Number(userRecord.employee_id);
              setCurrentEmployeeId(Number(userRecord.employee_id));
            }
            if (!currentEmployeeName) {
              setCurrentEmployeeName(userRecord.full_name || user.email || '');
            }
          }
        }
      }

      const isLegacyMeeting = !!meeting.legacy_lead;
      const targetTable = isLegacyMeeting ? 'leads_lead' : 'leads';
      const targetId = isLegacyMeeting
        ? (meeting.legacy_lead?.id ??
          (typeof meeting.id === 'string' && meeting.id.startsWith('legacy_')
            ? meeting.id.replace('legacy_', '')
            : meeting.legacy_lead_id))
        : meeting.lead?.id || meeting.client_id;

      if (!targetId) {
        throw new Error('Missing lead ID for meeting confirmation update');
      }

      const updatePayload = {
        meeting_confirmation: newValue,
        meeting_confirmation_by: newValue ? employeeIdToUse : null,
      };
      const fallbackPayload = {
        meeting_confirmation: newValue ? new Date().toISOString() : null,
        meeting_confirmation_by: newValue ? employeeIdToUse : null,
      };

      const { error } = await supabase
        .from(targetTable)
        .update(updatePayload)
        .eq('id', targetId);

      if (error) {
        if (error.code === '22007') {
          const { error: fallbackError } = await supabase
            .from(targetTable)
            .update(fallbackPayload)
            .eq('id', targetId);
          if (fallbackError) {
            throw fallbackError;
          }
        } else {
          throw error;
        }
      }

      setMeetings(prev =>
        prev.map(m => {
          if (m.id !== meetingId) return m;
          if (isLegacyMeeting) {
            return {
              ...m,
              meeting_confirmation: newValue,
              legacy_lead: m.legacy_lead
                ? {
                  ...m.legacy_lead,
                  meeting_confirmation: newValue,
                  meeting_confirmation_by: newValue ? employeeIdToUse : null,
                }
                : m.legacy_lead,
            };
          }
          return {
            ...m,
            meeting_confirmation: newValue,
            lead: m.lead
              ? {
                ...m.lead,
                meeting_confirmation: newValue,
                meeting_confirmation_by: newValue ? employeeIdToUse : null,
              }
              : m.lead,
          };
        })
      );

      toast.success(newValue ? 'Meeting confirmed' : 'Meeting confirmation cleared');
    } catch (error) {
      console.error('Failed to update meeting confirmation from calendar:', error);
      toast.error('Failed to update meeting confirmation');
    } finally {
      setMeetingConfirmationLoadingId(null);
    }
  };

  // Helper function to get category name from ID or name with main category
  const getCategoryName = (categoryId: string | number | null | undefined, fallbackCategory?: string | number) => {

    if (!categoryId || categoryId === '---' || categoryId === '--') {
      // If no category_id but we have a fallback category, try to find it in the loaded categories
      if (fallbackCategory && String(fallbackCategory).trim() !== '') {

        // Try to find the fallback category in the loaded categories
        // First try by ID if fallbackCategory is a number
        let foundCategory = null;
        if (typeof fallbackCategory === 'number') {
          foundCategory = allCategories.find((cat: any) =>
            cat.id.toString() === fallbackCategory.toString()
          );
        }

        // If not found by ID, try by name
        if (!foundCategory) {
          foundCategory = allCategories.find((cat: any) =>
            cat.name.toLowerCase().trim() === String(fallbackCategory).toLowerCase().trim()
          );
        }

        if (foundCategory) {
          // Return category name with main category in parentheses
          if (foundCategory.misc_maincategory?.name) {
            return `${foundCategory.name} (${foundCategory.misc_maincategory.name})`;
          } else {
            return foundCategory.name; // Fallback if no main category
          }
        } else {
          return String(fallbackCategory); // Use as-is if not found in loaded categories
        }
      }
      return '--';
    }

    // If allCategories is not loaded yet, prefer plain text from leads.category when present
    if (!allCategories || allCategories.length === 0) {
      if (fallbackCategory && String(fallbackCategory).trim() !== '') {
        return String(fallbackCategory).trim();
      }
      return categoryId != null && String(categoryId).trim() !== '' ? String(categoryId) : '--';
    }

    // First try to find by ID
    const categoryById = allCategories.find((cat: any) => cat.id.toString() === categoryId.toString());
    if (categoryById) {

      // Return category name with main category in parentheses
      if (categoryById.misc_maincategory?.name) {
        return `${categoryById.name} (${categoryById.misc_maincategory.name})`;
      } else {
        return categoryById.name; // Fallback if no main category
      }
    }

    // If not found by ID, try to find by name (in case it's already a name)
    const categoryByName = allCategories.find((cat: any) => cat.name === categoryId);
    if (categoryByName) {

      // Return category name with main category in parentheses
      if (categoryByName.misc_maincategory?.name) {
        return `${categoryByName.name} (${categoryByName.misc_maincategory.name})`;
      } else {
        return categoryByName.name; // Fallback if no main category
      }
    }

    // New leads: no valid category_id join but category (text) saved on leads row
    if (fallbackCategory && String(fallbackCategory).trim() !== '') {
      return String(fallbackCategory).trim();
    }

    return String(categoryId); // Fallback to original value if not found
  };

  // Format category from joined misc_category (avoids waiting for allCategories / extra lookups)
  const getCategoryDisplayFromJoin = (lead: any): string | null => {
    const cat = lead?.misc_category;
    if (!cat || !cat.name) return null;
    const main = Array.isArray(cat.misc_maincategory) ? cat.misc_maincategory[0] : cat.misc_maincategory;
    return main?.name ? `${cat.name} (${main.name})` : (cat.name || null);
  };
  // Format source from joined misc_leadsource
  const getSourceDisplayFromJoin = (lead: any): string | null => {
    const src = lead?.misc_leadsource;
    if (!src || !src.name) return null;
    return typeof src.name === 'string' ? src.name.trim() || null : null;
  };
  // Format language from joined misc_language
  const getLanguageDisplayFromJoin = (lead: any): string | null => {
    const lang = lead?.misc_language;
    if (!lang) return null;
    const record = Array.isArray(lang) ? lang[0] : lang;
    return record?.name && typeof record.name === 'string' ? record.name.trim() || null : null;
  };

  // Navigation functions for date range switching
  const goToPreviousDay = () => {
    const fromDateObj = new Date(appliedFromDate);
    const toDateObj = new Date(appliedToDate);
    if (!isNaN(fromDateObj.getTime()) && !isNaN(toDateObj.getTime())) {
      fromDateObj.setDate(fromDateObj.getDate() - 1);
      toDateObj.setDate(toDateObj.getDate() - 1);
      const newFromDate = fromDateObj.toISOString().split('T')[0];
      const newToDate = toDateObj.toISOString().split('T')[0];
      setFromDate(newFromDate);
      setToDate(newToDate);
      setAppliedFromDate(newFromDate);
      setAppliedToDate(newToDate);
      setDatesManuallySet(true);
    }
  };

  const goToNextDay = () => {
    const fromDateObj = new Date(appliedFromDate);
    const toDateObj = new Date(appliedToDate);
    if (!isNaN(fromDateObj.getTime()) && !isNaN(toDateObj.getTime())) {
      fromDateObj.setDate(fromDateObj.getDate() + 1);
      toDateObj.setDate(toDateObj.getDate() + 1);
      const newFromDate = fromDateObj.toISOString().split('T')[0];
      const newToDate = toDateObj.toISOString().split('T')[0];
      setFromDate(newFromDate);
      setToDate(newToDate);
      setAppliedFromDate(newFromDate);
      setAppliedToDate(newToDate);
      setDatesManuallySet(true);
    }
  };

  const goToToday = () => {
    const today = new Date().toISOString().split('T')[0];
    setFromDate(today);
    setToDate(today);
    setAppliedFromDate(today);
    setAppliedToDate(today);
    setDatesManuallySet(true);
  };

  const handleShowButton = () => {
    setAppliedFromDate(fromDate);
    setAppliedToDate(toDate);
    setDatesManuallySet(true);
    // Trigger legacy meeting fetch when Show button is clicked
    if (fromDate && toDate) {
      setIsLegacyLoading(true);
      loadLegacyForDateRange(fromDate, toDate);
    }
  };

  // Helper function to get employee display name from ID (local version that takes employees array)
  const getEmployeeDisplayNameLocal = (employeeId: string | number | null | undefined, employees: any[]) => {
    if (!employeeId || employeeId === '---' || employeeId === '--') return '--';
    // Find employee in the provided employees array
    // Convert both to string for comparison since employeeId might be bigint
    const employee = employees.find((emp: any) => emp.id.toString() === employeeId.toString());
    return employee ? employee.display_name : employeeId.toString(); // Fallback to ID if not found
  };

  // Helper function to fetch legacy meetings and return them (doesn't update state)
  const fetchLegacyMeetingsForDateRange = async (fromDate: string, toDate: string, employees: any[] = []): Promise<any[]> => {
    console.log('🔍 [fetchLegacyMeetingsForDateRange] Called with:', { fromDate, toDate, legacyLoadingDisabled, employeesCount: employees.length });

    if (!fromDate || !toDate || legacyLoadingDisabled) {
      console.warn('🔍 [fetchLegacyMeetingsForDateRange] Early return:', { fromDate: !!fromDate, toDate: !!toDate, legacyLoadingDisabled });
      return [];
    }

    try {
      // Limit date range to max 7 days to prevent timeouts on large tables
      const from = new Date(fromDate);
      const to = new Date(toDate);
      const daysDiff = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));

      console.log('🔍 [fetchLegacyMeetingsForDateRange] Date range check:', { daysDiff, from: fromDate, to: toDate });

      if (daysDiff > 7) {
        console.warn('Date range too large for legacy meetings, limiting to 7 days');
        const limitedTo = new Date(from);
        limitedTo.setDate(limitedTo.getDate() + 7);
        toDate = limitedTo.toISOString().split('T')[0];
      }

      if (daysDiff > 14) {
        console.warn('Date range too large, skipping legacy meeting fetch');
        return [];
      }

      // Fetch legacy leads with minimal fields
      console.log('🔍 [fetchLegacyMeetingsForDateRange] Querying leads_lead table...');
      const { data: legacyData, error: legacyError } = await supabase
        .from('leads_lead')
        .select(`
          id, name, meeting_date, meeting_time, lead_number, category, category_id, stage, 
          meeting_manager_id, meeting_lawyer_id, meeting_scheduler_id, total, total_base, currency_id, meeting_total_currency_id, 
          expert_id, probability, phone, email, mobile, meeting_location_id, expert_examination, language_id, case_handler_id,
          accounting_currencies!leads_lead_currency_id_fkey (
            id,
            name,
            iso_code
          ),
          misc_language!leads_lead_language_id_fkey ( id, name ),
          misc_category!leads_lead_category_id_fkey ( id, name, parent_id, misc_maincategory!parent_id ( id, name ) ),
          misc_leadsource!leads_lead_source_id_fkey ( id, name )
        `)
        .gte('meeting_date', fromDate)
        .lte('meeting_date', toDate)
        .not('meeting_date', 'is', null)
        .limit(1000)
        .order('meeting_date', { ascending: true });

      console.log('🔍 [fetchLegacyMeetingsForDateRange] Query result:', {
        dataCount: legacyData?.length || 0,
        error: legacyError?.message || null,
        sampleIds: legacyData?.slice(0, 3).map((l: any) => l.id) || []
      });

      if (legacyError) {
        console.error('Error fetching legacy leads:', legacyError);
        if (legacyError.code === '57014' || legacyError.message?.includes('timeout')) {
          console.warn('Legacy query timed out');
        }
        return [];
      }

      if (!legacyData || legacyData.length === 0) {
        console.warn('🔍 [fetchLegacyMeetingsForDateRange] No legacy data found for date range:', { fromDate, toDate });
        return [];
      }

      // Filter out inactive leads (status = 10 means inactive/spam, stage 91 = inactive/dropped) - do this client-side to avoid query issues
      const activeLegacyData = legacyData.filter((lead: any) => {
        const status = lead.status;
        const stage = lead.stage;
        // Exclude if status is 10 (inactive/spam) or stage is 91 (inactive/dropped)
        if (status === 10 || status === '10') return false;
        if (stage === 91 || stage === '91') return false;
        // Include if status is 0, null, or undefined (active leads)
        return status === null || status === undefined || status === 0 || status === '0';
      });

      console.log('🔍 [fetchLegacyMeetingsForDateRange] After status filter:', {
        beforeFilter: legacyData.length,
        afterFilter: activeLegacyData.length
      });

      if (activeLegacyData.length === 0) {
        console.warn('🔍 [fetchLegacyMeetingsForDateRange] No active legacy leads after status filter');
        return [];
      }

      // Process legacy data: currency from join only (same as Clients.tsx total value badge)
      activeLegacyData.forEach((legacyLead: any) => {
        const currencyRecord = legacyLead.accounting_currencies
          ? (Array.isArray(legacyLead.accounting_currencies) ? legacyLead.accounting_currencies[0] : legacyLead.accounting_currencies)
          : null;
        if (currencyRecord) {
          legacyLead.balance_currency = (currencyRecord.name || currencyRecord.iso_code || '₪').trim() || '₪';
        } else {
          legacyLead.balance_currency = legacyLead.balance_currency || '₪';
        }
      });

      // Process legacy meetings
      const processedLegacyMeetings = legacyData.map((legacyLead: any) => {
        const languageName = getLanguageDisplayFromJoin(legacyLead) ?? '';
        const categoryDisplay = getCategoryDisplayFromJoin(legacyLead) ?? getCategoryName(legacyLead.category_id, legacyLead.category) ?? legacyLead.category ?? 'Unassigned';

        const meeting = {
          id: `legacy_${legacyLead.id}`,
          created_at: legacyLead.meeting_date || new Date().toISOString(),
          meeting_date: legacyLead.meeting_date,
          meeting_time: legacyLead.meeting_time || '09:00',
          meeting_manager: getEmployeeDisplayNameLocal(legacyLead.meeting_manager_id, employees),
          helper: getEmployeeDisplayNameLocal(legacyLead.meeting_lawyer_id, employees),
          scheduler: getEmployeeDisplayNameLocal(legacyLead.meeting_scheduler_id, employees),
          meeting_location: getLegacyMeetingLocation(legacyLead.meeting_location_id) || 'Teams',
          meeting_location_id: legacyLead.meeting_location_id,
          teams_meeting_url: null,
          custom_link: null,
          custom_address: null,
          meeting_brief: null,
          meeting_amount: parseFloat(legacyLead.total || '0'),
          // Use balance_currency that's already set to a symbol from JOIN processing above
          meeting_currency: legacyLead.balance_currency || '₪',
          meeting_complexity: 'Simple',
          meeting_car_no: null,
          meeting_paid: false,
          meeting_confirmation: false,
          meeting_scheduling_notes: '',
          status: null,
          lead: {
            id: `legacy_${legacyLead.id}`,
            lead_number: legacyLead.lead_number || legacyLead.id?.toString() || 'Unknown',
            name: legacyLead.name || 'Legacy Lead',
            email: legacyLead.email || '',
            phone: legacyLead.phone || '',
            mobile: legacyLead.mobile || '',
            topic: '',
            stage: legacyLead.stage || 'Unknown',
            manager: getEmployeeDisplayNameLocal(legacyLead.meeting_manager_id, employees),
            helper: getEmployeeDisplayNameLocal(legacyLead.meeting_lawyer_id, employees),
            scheduler: getEmployeeDisplayNameLocal(legacyLead.meeting_scheduler_id, employees),
            scheduler_id: legacyLead.meeting_scheduler_id,
            handler_id: legacyLead.case_handler_id,
            handler: legacyLead.case_handler_id
              ? getEmployeeDisplayNameLocal(legacyLead.case_handler_id, employees)
              : '--',
            balance: parseFloat(legacyLead.total || '0'),
            // balance_currency is already set to a symbol (₪, $, €, £, etc.) from the JOIN processing above
            // Use it directly (same as Clients.tsx balance badge which uses selectedClient.balance_currency)
            balance_currency: legacyLead.balance_currency || '₪',
            expert: getEmployeeDisplayNameLocal(legacyLead.expert_id, employees),
            expert_examination: legacyLead.expert_examination || '',
            probability: parseFloat(legacyLead.probability || '0'),
            category_id: legacyLead.category_id || null,
            category: categoryDisplay,
            language: languageName || null,
            language_id: legacyLead.language_id || null,
            onedrive_folder_link: '',
            expert_notes: '',
            manual_interactions: [],
            lead_type: 'legacy' as const,
            department_name: 'Unassigned',
            department_id: null
          }
        };
        return meeting;
      });

      console.log('🔍 [fetchLegacyMeetingsForDateRange] Processed legacy meetings:', {
        count: processedLegacyMeetings.length,
        sampleIds: processedLegacyMeetings.slice(0, 3).map((m: any) => m.id)
      });

      return processedLegacyMeetings;
    } catch (error: any) {
      console.error('Error in fetchLegacyMeetingsForDateRange:', error);
      return [];
    }
  };

  // Helper function to combine meetings without duplicates
  const dedupeMeetingsByLeadAndDate = (items: any[]): any[] => {
    const byLeadAndDate = new Map<string, any>();
    const passthrough: any[] = [];

    const getDateKey = (value: any): string | null => {
      if (!value) return null;
      if (typeof value === 'string') return value.split('T')[0];
      const d = new Date(value);
      if (isNaN(d.getTime())) return null;
      return d.toISOString().split('T')[0];
    };

    const getLeadKey = (meeting: any): string | null => {
      const legacyId = meeting?.legacy_lead_id ?? (typeof meeting?.id === 'string' && meeting.id.startsWith('legacy_')
        ? meeting.id.replace('legacy_', '')
        : null);
      if (legacyId != null && legacyId !== '') return `legacy:${legacyId}`;
      const clientId = meeting?.client_id ?? meeting?.lead?.id;
      if (clientId != null && clientId !== '') return `new:${clientId}`;
      return null;
    };

    const getCreatedRank = (meeting: any): number => {
      const created = meeting?.created_at ? new Date(meeting.created_at).getTime() : 0;
      return Number.isFinite(created) ? created : 0;
    };

    const getIdRank = (meeting: any): number => {
      const raw = String(meeting?.id ?? '');
      const parsed = Number(raw.replace(/[^\d]/g, ''));
      return Number.isFinite(parsed) ? parsed : 0;
    };

    items.forEach((meeting) => {
      const leadKey = getLeadKey(meeting);
      const dateKey = getDateKey(meeting?.meeting_date);

      // Keep non-lead or invalid-date meetings untouched (e.g., staff meetings)
      if (!leadKey || !dateKey) {
        passthrough.push(meeting);
        return;
      }

      const dedupeKey = `${leadKey}|${dateKey}`;
      const existing = byLeadAndDate.get(dedupeKey);
      if (!existing) {
        byLeadAndDate.set(dedupeKey, meeting);
        return;
      }

      const existingCreated = getCreatedRank(existing);
      const currentCreated = getCreatedRank(meeting);
      if (currentCreated > existingCreated) {
        byLeadAndDate.set(dedupeKey, meeting);
        return;
      }

      if (currentCreated === existingCreated && getIdRank(meeting) > getIdRank(existing)) {
        byLeadAndDate.set(dedupeKey, meeting);
      }
    });

    return [...passthrough, ...Array.from(byLeadAndDate.values())];
  };

  const combineMeetingsWithoutDuplicates = (regularMeetings: any[], legacyMeetings: any[]): any[] => {
    // Build a Set of existing meeting IDs to prevent duplicates
    const existingMeetingIds = new Set<string | number>();
    const existingLegacyLeadIds = new Set<string>();

    regularMeetings.forEach(meeting => {
      existingMeetingIds.add(meeting.id);
      if (meeting.legacy_lead_id) {
        existingLegacyLeadIds.add(String(meeting.legacy_lead_id));
      }
      if (typeof meeting.id === 'string' && meeting.id.startsWith('legacy_')) {
        const legacyLeadId = meeting.id.replace('legacy_', '');
        existingLegacyLeadIds.add(legacyLeadId);
      }
    });

    // Filter out legacy meetings that already exist
    const newLegacyMeetings = legacyMeetings.filter((legacyMeeting: any) => {
      const legacyLeadId = legacyMeeting.id?.toString().replace('legacy_', '');
      const isDuplicate = existingMeetingIds.has(legacyMeeting.id) || existingLegacyLeadIds.has(legacyLeadId);
      if (isDuplicate) {
        console.log('🔍 [combineMeetingsWithoutDuplicates] Filtering out duplicate legacy meeting:', {
          id: legacyMeeting.id,
          legacyLeadId,
          reason: existingMeetingIds.has(legacyMeeting.id) ? 'existingMeetingIds' : 'existingLegacyLeadIds'
        });
      }
      return !isDuplicate;
    });

    console.log('🔍 [combineMeetingsWithoutDuplicates] Combining:', {
      regularCount: regularMeetings.length,
      legacyInputCount: legacyMeetings.length,
      legacyAfterFilterCount: newLegacyMeetings.length,
      totalOutput: regularMeetings.length + newLegacyMeetings.length
    });

    // Combine all meetings and enforce one meeting per lead/date (latest created wins)
    return dedupeMeetingsByLeadAndDate([...regularMeetings, ...newLegacyMeetings]);
  };

  // Function to load legacy meetings for a specific date
  // Fetch staff meetings from shared-staffcalendar@lawoffice.org.il
  const fetchStaffMeetings = async (fromDate: string, toDate: string) => {
    setIsStaffMeetingsLoading(true);

    try {
      // Fetch staff meetings from database for date range
      const { data: allMeetings, error: allMeetingsError } = await supabase
        .from('outlook_teams_meetings')
        .select('*')
        .order('start_date_time');

      // Filter by date range manually
      const staffMeetingsData = allMeetings?.filter(meeting => {
        const meetingDate = new Date(meeting.start_date_time).toISOString().split('T')[0];
        return meetingDate >= fromDate && meetingDate <= toDate;
      }) || [];

      if (allMeetingsError) {
        console.error('Error fetching staff meetings from database:', allMeetingsError);
        return;
      }


      if (staffMeetingsData && staffMeetingsData.length > 0) {
        // Fetch all employees and users to match emails with display names
        const [employeesResult, usersResult] = await Promise.all([
          supabase
            .from('tenants_employee')
            .select('id, display_name')
            .not('display_name', 'is', null),
          supabase
            .from('users')
            .select('employee_id, email')
            .not('email', 'is', null)
        ]);

        if (employeesResult.error || usersResult.error) {
          console.error('Error fetching employees/users for email mapping:', employeesResult.error || usersResult.error);
          return;
        }

        // Create employee_id to email mapping from users table
        const employeeIdToEmail = new Map<number, string>();
        usersResult.data?.forEach((user: any) => {
          if (user.employee_id && user.email) {
            employeeIdToEmail.set(user.employee_id, user.email.toLowerCase());
          }
        });

        // Create email to display name mapping
        const emailToNameMap = new Map<string, string>();
        employeesResult.data?.forEach((emp: any) => {
          if (!emp.display_name) return;

          // Method 1: Use email from users table (employee_id match)
          const emailFromUsers = employeeIdToEmail.get(emp.id);
          if (emailFromUsers) {
            emailToNameMap.set(emailFromUsers, emp.display_name);
          }

          // Method 2: Use pattern matching (display_name.toLowerCase().replace(/\s+/g, '.') + '@lawoffice.org.il')
          const patternEmail = `${emp.display_name.toLowerCase().replace(/\s+/g, '.')}@lawoffice.org.il`;
          emailToNameMap.set(patternEmail, emp.display_name);
        });

        const formattedStaffMeetings = staffMeetingsData.map((meeting: any) => {
          // Extract attendees from JSONB
          const attendees = meeting.attendees || [];

          // Convert attendee emails to display names
          const attendeeNames = attendees.map((email: string) => {
            // Normalize email to lowercase for matching
            const normalizedEmail = email.toLowerCase();
            return emailToNameMap.get(normalizedEmail) || email;
          }).filter(Boolean);

          // Create display text for attendees
          let attendeesDisplay = '--';
          if (attendeeNames.length > 0) {
            if (attendeeNames.length > 10) {
              attendeesDisplay = 'All Staff';
            } else if (attendeeNames.length === 1) {
              attendeesDisplay = attendeeNames[0];
            } else if (attendeeNames.length <= 3) {
              attendeesDisplay = attendeeNames.join(', ');
            } else {
              attendeesDisplay = `${attendeeNames.slice(0, 2).join(', ')} +${attendeeNames.length - 2} more`;
            }
          }

          // Parse the start_date_time to get time
          const startDate = new Date(meeting.start_date_time);
          const time = `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`;

          return {
            id: `staff-${meeting.teams_meeting_id}`,
            meeting_date: new Date(meeting.start_date_time).toISOString().split('T')[0],
            meeting_time: time,
            meeting_manager: attendeesDisplay,
            helper: '--',
            meeting_location: meeting.location || 'Teams',
            teams_meeting_url: meeting.teams_join_url || '',
            custom_link: null,
            custom_address: null,
            meeting_amount: '--',
            meeting_currency: '',
            status: 'scheduled',
            client_id: null,
            legacy_lead_id: null,
            calendar_type: 'staff',
            teams_meeting_id: meeting.teams_meeting_id,
            attendees: attendeeNames, // Store display names instead of emails
            description: meeting.description || '',
            lead: {
              id: `staff-${meeting.teams_meeting_id}`,
              name: meeting.subject || 'Staff Meeting',
              lead_number: 'STAFF',
              stage: 'Staff Meeting',
              manager: attendeesDisplay,
              category: '--',
              balance: '--',
              balance_currency: '',
              expert: '--',
              probability: '--',
              phone: '--',
              email: '--'
            }
          };
        });

        setStaffMeetings(formattedStaffMeetings);
      }
    } catch (error) {
      console.error('Error fetching staff meetings:', error);
    } finally {
      setIsStaffMeetingsLoading(false);
    }
  };

  const loadLegacyForDateRange = async (fromDate: string, toDate: string) => {
    if (!fromDate || !toDate || legacyLoadingDisabled) return;

    setIsLegacyLoading(true);

    try {
      // Fetch legacy meetings using the helper function
      const legacyMeetings = await fetchLegacyMeetingsForDateRange(fromDate, toDate, allEmployees);

      if (legacyMeetings.length > 0) {
        // Add legacy meetings to the current meetings (without duplicates)
        setMeetings(prevMeetings => {
          return combineMeetingsWithoutDuplicates(prevMeetings, legacyMeetings);
        });
      }
    } catch (error: any) {
      console.error('Error in loadLegacyForDateRange:', error);
      const message = typeof error?.message === 'string' ? error.message : '';
      const code = error?.code;
      // If we hit a statement timeout, permanently disable legacy loading
      if (message.includes('timeout') || code === '57014') {
        setLegacyLoadingDisabled(true);
      }
    } finally {
      setIsLegacyLoading(false);
    }
  };

  // Cache employees and categories data to prevent refetches when navigating back
  // Changed cache key to force refresh with new photo_url fetching
  const { data: employeesAndCategoriesData } = useCachedFetch(
    'calendar-employees-categories-v3',
    async () => {
      // Fetch employees directly from tenants_employee table (like CallsLedgerPage does)
      // This ensures we get photo_url and photo fields correctly
      const { data: allEmployeesData, error: allEmployeesError } = await supabase
        .from('tenants_employee')
        .select('id, display_name, user_id, photo_url, photo, bonuses_role')
        .not('display_name', 'is', null)
        .order('display_name', { ascending: true });

      if (allEmployeesError) {
        console.error('❌ CalendarPage - Error fetching all employees:', allEmployeesError);
        throw allEmployeesError;
      }

      if (!allEmployeesData || allEmployeesData.length === 0) {
        console.log('⚠️ CalendarPage - No employees found in tenants_employee table');
        return { employees: [], categories: [] };
      }

      console.log('🔍 CalendarPage - Fetched', allEmployeesData.length, 'employees from tenants_employee');
      if (allEmployeesData && allEmployeesData.length > 0) {
        console.log('🔍 CalendarPage - Sample employee (first):', JSON.stringify(allEmployeesData[0], null, 2));
        console.log('🔍 CalendarPage - Sample employee photo_url:', allEmployeesData[0]?.photo_url);
        console.log('🔍 CalendarPage - Sample employee photo:', allEmployeesData[0]?.photo);
        // Check a few employees for photos
        const employeesWithPhotos = allEmployeesData.filter((e: any) => e.photo_url || e.photo);
        console.log('🔍 CalendarPage - Employees with photos in raw data:', employeesWithPhotos.length, 'out of', allEmployeesData.length);
        if (employeesWithPhotos.length > 0) {
          console.log('🔍 CalendarPage - Sample employee WITH photo:', JSON.stringify(employeesWithPhotos[0], null, 2));
        }
      }

      // Get employee IDs for querying users table to filter by active users
      const employeeIds = allEmployeesData
        .map((emp: any) => emp.id)
        .filter((id: any) => id !== null && id !== undefined);

      if (employeeIds.length === 0) {
        return { employees: [], categories: [] };
      }

      // Fetch active staff users by employee_id to filter employees (is_staff = true for attendees dropdown)
      const { data: activeUsers, error: usersError } = await supabase
        .from('users')
        .select('employee_id, is_active, is_staff')
        .in('employee_id', employeeIds)
        .eq('is_active', true)
        .eq('is_staff', true);

      let uniqueEmployees;

      if (usersError) {
        console.error('❌ CalendarPage - Error fetching active users:', usersError);
        // Fallback: return all employees if user check fails
        const allEmployees = allEmployeesData.map((emp: any) => ({
          id: emp.id,
          display_name: emp.display_name,
          bonuses_role: emp.bonuses_role,
          photo_url: emp.photo_url || null,
          photo: emp.photo || null
        }));
        console.log('⚠️ CalendarPage - Using all employees (user check failed), count:', allEmployees.length);
        uniqueEmployees = allEmployees.sort((a, b) => a.display_name.localeCompare(b.display_name));
      } else {
        // Create a set of active employee IDs for quick lookup
        const activeEmployeeIds = new Set(
          (activeUsers || []).map((user: any) => user.employee_id?.toString())
        );
        // Filter employees to only those with active staff users (is_staff = true)
        const activeEmployees = allEmployeesData
          .filter((emp: any) => activeEmployeeIds.has(emp.id.toString()))
          .map((emp: any) => ({
            id: emp.id,
            display_name: emp.display_name,
            bonuses_role: emp.bonuses_role,
            photo_url: emp.photo_url || null,
            photo: emp.photo || null
          }));

        console.log('✅ CalendarPage - Active staff employees:', activeEmployees.length);
        console.log('🔍 CalendarPage - Employees with photos:', activeEmployees.filter(e => e.photo_url || e.photo).length);
        if (activeEmployees.length > 0) {
          console.log('🔍 CalendarPage - Sample active employee:', activeEmployees[0]);
        }

        const processedEmployees = activeEmployees.sort((a, b) => a.display_name.localeCompare(b.display_name));

        console.log('🔍 CalendarPage - Processed employees:', processedEmployees.length, 'items');
        console.log('🔍 CalendarPage - Employees with photos:', processedEmployees.filter(e => e.photo_url || e.photo).length);

        // Deduplicate by employee ID to prevent duplicates
        const uniqueEmployeesMap = new Map();
        processedEmployees.forEach(emp => {
          if (!uniqueEmployeesMap.has(emp.id)) {
            uniqueEmployeesMap.set(emp.id, emp);
          }
        });
        uniqueEmployees = Array.from(uniqueEmployeesMap.values());
      }

      // Fetch all categories with their parent main category names using JOINs
      const { data: categoriesData, error: categoriesError } = await supabase
        .from('misc_category')
        .select(`
          id,
          name,
          parent_id,
          misc_maincategory!parent_id (
            id,
            name
          )
        `)
        .order('name', { ascending: true });

      if (categoriesError) throw categoriesError;

      return {
        employees: uniqueEmployees,
        categories: categoriesData || []
      };
    }
  );

  // Reset "empty" log flag when employees load so we can log again if list becomes empty later
  useEffect(() => {
    if (allEmployees.length > 0) emptyEmployeesLoggedRef.current = false;
  }, [allEmployees.length]);

  // Update state when cached data is available
  useEffect(() => {
    if (employeesAndCategoriesData) {
      console.log('🔍 CalendarPage - Setting employees from cache:', employeesAndCategoriesData.employees.length);
      setAllEmployees(employeesAndCategoriesData.employees);
      setAllCategories(employeesAndCategoriesData.categories);
    } else {
      // If cached data is not available, fetch employees directly as fallback
      console.warn('⚠️ CalendarPage - No cached employee data, fetching directly...');
      const fetchEmployeesFallback = async () => {
        try {
          const { data: allEmployeesData, error: allEmployeesError } = await supabase
            .from('tenants_employee')
            .select('id, display_name, user_id, photo_url, photo, bonuses_role')
            .not('display_name', 'is', null)
            .order('display_name', { ascending: true });

          if (allEmployeesError) {
            console.error('❌ CalendarPage - Error fetching employees (fallback):', allEmployeesError);
            return;
          }

          if (allEmployeesData && allEmployeesData.length > 0) {
            const employeeIds = allEmployeesData.map((e: any) => e.id).filter((id: any) => id != null);
            const { data: staffUsers } = await supabase
              .from('users')
              .select('employee_id')
              .in('employee_id', employeeIds)
              .eq('is_active', true)
              .eq('is_staff', true);
            const staffEmployeeIds = new Set((staffUsers || []).map((u: any) => u.employee_id?.toString()));
            const employees = allEmployeesData
              .filter((emp: any) => staffEmployeeIds.has(emp.id?.toString()))
              .map((emp: any) => ({
                id: emp.id,
                display_name: emp.display_name,
                bonuses_role: emp.bonuses_role,
                photo_url: emp.photo_url || null,
                photo: emp.photo || null
              }));
            console.log('✅ CalendarPage - Fetched staff employees (fallback):', employees.length);
            setAllEmployees(employees);
          }
        } catch (error) {
          console.error('❌ CalendarPage - Error in fetchEmployeesFallback:', error);
        }
      };
      fetchEmployeesFallback();
    }
  }, [employeesAndCategoriesData]);

  useEffect(() => {
    const prev = prevFetchDepsRef.current;
    const pathname = location.pathname;
    const depsUnchanged =
      prev.appliedFromDate === appliedFromDate &&
      prev.appliedToDate === appliedToDate &&
      prev.datesManuallySet === datesManuallySet &&
      prev.meetingsRefreshTrigger === meetingsRefreshTrigger &&
      prev.pathname === pathname;

    // If we have cached meetings and no fetch-relevant dep changed, skip refetch (preserve state when navigating back)
    if (meetings.length > 0 && depsUnchanged) {
      setIsLoading(false);
      return;
    }
    // If this is a back/forward navigation (POP) and we have cached meetings, skip the fetch
    if (navType === 'POP' && meetings.length > 0) {
      setIsLoading(false);
      return;
    }

    prevFetchDepsRef.current = { pathname, appliedFromDate, appliedToDate, datesManuallySet, meetingsRefreshTrigger };

    const fetchMeetingsAndStaff = async () => {
      setIsLoading(true);

      try {
        const today = new Date().toISOString().split('T')[0];
        const dateRangeFrom = appliedFromDate || today;
        const dateRangeTo = appliedToDate || today;

        // Helper to get category name from allCategories (from useCachedFetch)
        const getCategoryNameFromData = (categoryId: string | number | null | undefined) => {
          if (!categoryId || categoryId === '---') return '';
          const categoryById = allCategories.find((cat: any) => cat.id.toString() === categoryId.toString());
          if (categoryById) return categoryById.name;
          const categoryByName = allCategories.find((cat: any) => cat.name === categoryId);
          if (categoryByName) return categoryByName.name;
          return String(categoryId);
        };

        // Process a single lead's currency/category/language from joins only (no client-side currency_id mapping)
        const processLeadFromJoin = (lead: any) => {
          if (!lead) return;
          const currencyRecord = lead.accounting_currencies
            ? (Array.isArray(lead.accounting_currencies) ? lead.accounting_currencies[0] : lead.accounting_currencies)
            : null;
          if (currencyRecord) {
            lead.balance_currency = (currencyRecord.name || currencyRecord.iso_code || '₪').trim() || '₪';
          } else {
            lead.balance_currency = lead.balance_currency || '₪';
          }
          lead.category = getCategoryDisplayFromJoin(lead) ?? getCategoryName(lead.category_id, lead.category) ?? lead.category;
          lead.language = getLanguageDisplayFromJoin(lead) ?? lead.language;
        };

        // Fetch past stages (small query)
        const fetchPastStagesData = async () => {
          try {
            const [legacyRes, newRes] = await Promise.all([
              supabase.from('leads_leadstage').select('lead_id').in('stage', [35, 40]).not('lead_id', 'is', null),
              supabase.from('leads_leadstage').select('newlead_id').in('stage', [35, 40]).not('newlead_id', 'is', null)
            ]);
            const leadIds = new Set<string>();
            (legacyRes.data || []).forEach((e: any) => { if (e.lead_id) leadIds.add(`legacy_${e.lead_id}`); });
            (newRes.data || []).forEach((e: any) => { if (e.newlead_id) leadIds.add(e.newlead_id); });
            return leadIds;
          } catch {
            return new Set<string>();
          }
        };

        // Build meetings query WITH joins so one round-trip gets meetings + leads (no separate lead fetches)
        const meetingsSelect = `
          id, created_at, meeting_date, meeting_time, meeting_manager, helper, meeting_location, teams_meeting_url, custom_link, custom_address,
          meeting_amount, meeting_currency, status, client_id, legacy_lead_id,
          attendance_probability, complexity, car_number, calendar_type, extern1, extern2,
          leads!meetings_client_id_fkey (
            id, name, lead_number, manual_id, master_id, onedrive_folder_link, stage, manager, helper, scheduler, category, category_id,
            balance, balance_currency, currency_id, expert_notes, expert, probability, phone, email, language, language_id,
            meeting_confirmation, meeting_confirmation_by, eligibility_status, unactivated_at,
            manual_interactions, number_of_applicants_meeting, meeting_collection_id,
            meeting_manager_id, meeting_lawyer_id, handler, case_handler_id,
            accounting_currencies!leads_currency_id_fkey (id, name, iso_code),
            misc_category!fk_leads_category_id (id, name, parent_id, misc_maincategory!parent_id (id, name, department_id, tenant_departement!department_id (id, name))),
            misc_leadsource!fk_leads_source_id (id, name),
            misc_language!fk_leads_language_id (id, name)
          ),
          leads_lead!meetings_legacy_lead_id_fkey (
            id, name, lead_number, master_id, stage, meeting_manager_id, meeting_lawyer_id, meeting_scheduler_id, category, category_id,
            total, total_base, currency_id, meeting_total_currency_id, expert_id, probability, phone, email, no_of_applicants, expert_examination,
            meeting_location_id, meeting_collection_id, meeting_confirmation, meeting_confirmation_by, case_handler_id, status,
            accounting_currencies!leads_lead_currency_id_fkey (id, name, iso_code),
            misc_category!leads_lead_category_id_fkey (id, name, parent_id, misc_maincategory!parent_id (id, name, department_id, tenant_departement!department_id (id, name))),
            misc_leadsource!leads_lead_source_id_fkey (id, name),
            misc_language!leads_lead_language_id_fkey (id, name)
          )
        `;

        let regularMeetingsQuery = supabase
          .from('meetings')
          .select(meetingsSelect)
          .or('status.is.null,status.neq.canceled');

        if (datesManuallySet && dateRangeFrom && dateRangeTo) {
          regularMeetingsQuery = regularMeetingsQuery
            .gte('meeting_date', dateRangeFrom)
            .lte('meeting_date', dateRangeTo);
        }

        // Run stage names, past stages, and meetings (with joins) in parallel so nothing blocks "today's meetings"
        const [, { data: allMeetingsData, error: allMeetingsError }, pastStagesData] = await Promise.all([
          (async () => {
            const stageNames = await fetchStageNames();
            if (!stageNames || Object.keys(stageNames).length === 0) await refreshStageNames();
            setStageNamesLoaded(true);
          })(),
          regularMeetingsQuery.order('meeting_date', { ascending: false }),
          fetchPastStagesData()
        ]);

        setLeadsWithPastStages(pastStagesData);

        let allProcessedMeetings: any[] = [];

        if (!allMeetingsError && allMeetingsData && allMeetingsData.length > 0) {
          const newLeadsMap = new Map<string | number, any>();
          const legacyLeadsMap = new Map<string | number, any>();

          // Build lead maps from joined data (no extra fetches); currency from accounting_currencies join only
          allMeetingsData.forEach((row: any) => {
            const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads;
            const legacyLead = Array.isArray(row.leads_lead) ? row.leads_lead[0] : row.leads_lead;
            if (lead && lead.id != null) {
              if (!newLeadsMap.has(lead.id)) {
                processLeadFromJoin(lead);
                newLeadsMap.set(lead.id, lead);
              }
            }
            if (legacyLead && legacyLead.id != null) {
              const key = legacyLead.id;
              if (!legacyLeadsMap.has(key)) {
                processLeadFromJoin(legacyLead);
                legacyLeadsMap.set(key, legacyLead);
                legacyLeadsMap.set(String(key), legacyLead);
              }
            }
          });

          // Combine meetings with their lead data from joins (no separate lead fetches)
          const allMeetingsWithLeads = allMeetingsData.map((row: any) => {
            const lead = row.client_id ? (newLeadsMap.get(row.client_id) ?? (Array.isArray(row.leads) ? row.leads[0] : row.leads)) : null;
            const legacyLead = row.legacy_lead_id
              ? ((legacyLeadsMap.get(row.legacy_lead_id) || legacyLeadsMap.get(String(row.legacy_lead_id)) || legacyLeadsMap.get(Number(row.legacy_lead_id))) ?? (Array.isArray(row.leads_lead) ? row.leads_lead[0] : row.leads_lead))
              : null;
            return { ...row, lead, legacy_lead: legacyLead };
          });

          // Process ALL meetings at once
          allProcessedMeetings = allMeetingsWithLeads
            .filter((meeting: any) => {
              if (!meeting.meeting_date) return false;
              const date = new Date(meeting.meeting_date);
              if (isNaN(date.getTime())) return false;

              // Filter out meetings with inactive leads early
              // Staff meetings are always allowed
              if (meeting.calendar_type === 'staff') {
                return true;
              }

              const lead = meeting.lead || {};
              const legacyLead = meeting.legacy_lead || {};

              // If meeting has a client_id or legacy_lead_id but no lead data, exclude it
              // This means the lead was filtered out as inactive
              if ((meeting.client_id || meeting.legacy_lead_id) && !lead.id && !legacyLead.id) {
                return false;
              }

              // Check for new leads - exclude if stage is 91 or unactivated_at is set
              if (lead.id && !lead.id.toString().startsWith('legacy_')) {
                if (lead.stage === 91 || lead.stage === '91') return false;
                if (lead.unactivated_at) return false;
              }

              // Check for legacy leads - exclude if stage is 91 or status is 10
              if (legacyLead.id || lead.id?.toString().startsWith('legacy_')) {
                const stage = legacyLead.stage || lead.stage;
                const status = legacyLead.status || lead.status;
                if (stage === 91 || stage === '91') return false;
                if (status === 10 || status === '10') return false;
              }

              return true;
            })
            .map((meeting: any) => {
              let leadData = null;

              if (meeting.legacy_lead) {
                // Format lead_number for legacy subleads (similar to CollectionDueReportPage)
                const actualLegacyLeadNumber = meeting.legacy_lead.lead_number || meeting.legacy_lead.id?.toString() || '';
                let displayLegacyLeadNumber = actualLegacyLeadNumber;
                if (meeting.legacy_lead.master_id) {
                  // It's a sublead - format appropriately
                  if (displayLegacyLeadNumber && displayLegacyLeadNumber.includes('/')) {
                    // lead_number already has /, use it as is
                    displayLegacyLeadNumber = displayLegacyLeadNumber;
                  } else {
                    // Find master lead number to format properly
                    const masterLegacyLead = legacyLeadsMap.get(meeting.legacy_lead.master_id) || legacyLeadsMap.get(String(meeting.legacy_lead.master_id)) || legacyLeadsMap.get(Number(meeting.legacy_lead.master_id));
                    const masterLegacyLeadNumber = masterLegacyLead?.lead_number || meeting.legacy_lead.master_id?.toString() || '';
                    displayLegacyLeadNumber = `${masterLegacyLeadNumber}/2`; // Default to /2
                  }
                }

                leadData = {
                  ...meeting.legacy_lead,
                  lead_type: 'legacy',
                  name: meeting.legacy_lead.name || '',
                  stage: meeting.legacy_lead.stage || null,
                  // Store original IDs for employee lookup (for avatars)
                  manager_id: meeting.legacy_lead.meeting_manager_id,
                  helper_id: meeting.legacy_lead.meeting_lawyer_id,
                  scheduler_id: meeting.legacy_lead.meeting_scheduler_id,
                  expert_id: meeting.legacy_lead.expert_id,
                  handler_id: meeting.legacy_lead.case_handler_id,
                  // Convert IDs to display names for display
                  manager: getEmployeeDisplayName(meeting.legacy_lead.meeting_manager_id),
                  helper: getEmployeeDisplayName(meeting.legacy_lead.meeting_lawyer_id),
                  scheduler: getEmployeeDisplayName(meeting.legacy_lead.meeting_scheduler_id),
                  handler: meeting.legacy_lead.case_handler_id
                    ? getEmployeeDisplayName(meeting.legacy_lead.case_handler_id)
                    : '--',
                  // Store total_base and total for balance logic
                  total_base: meeting.legacy_lead.total_base ?? null,
                  total: meeting.legacy_lead.total ?? null,
                  currency_id: meeting.legacy_lead.currency_id ?? null,
                  // Calculate balance based on currency_id (same logic as Clients.tsx)
                  balance: (() => {
                    const currencyId = meeting.legacy_lead.currency_id;
                    let numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
                    if (!numericCurrencyId || isNaN(numericCurrencyId)) {
                      numericCurrencyId = 1; // Default to NIS
                    }
                    if (numericCurrencyId === 1) {
                      return meeting.legacy_lead.total_base ?? null;
                    } else {
                      return meeting.legacy_lead.total ?? null;
                    }
                  })(),
                  // balance_currency is already set to a symbol (₪, $, €, £, etc.) from the JOIN processing above
                  // Use it directly (same as Clients.tsx balance badge which uses selectedClient.balance_currency)
                  balance_currency: meeting.legacy_lead.balance_currency || '₪',
                  expert: getEmployeeDisplayName(meeting.legacy_lead.expert_id),
                  category: meeting.legacy_lead.category || meeting.legacy_lead.category_id,
                  // Store formatted lead_number for display (with sublead suffix if applicable)
                  lead_number: displayLegacyLeadNumber,
                  manual_interactions: [],
                  department_name: meeting.legacy_lead.misc_category?.misc_maincategory?.tenant_departement?.name || 'Unassigned',
                  department_id: meeting.legacy_lead.misc_category?.misc_maincategory?.department_id
                };
              } else if (meeting.lead) {
                // Format lead_number for subleads (similar to CollectionDueReportPage)
                // Keep the actual lead_number for navigation, but format for display if it's a sublead
                const actualLeadNumber = meeting.lead.lead_number || meeting.lead.id?.toString() || '';
                let displayLeadNumber = actualLeadNumber;
                if (meeting.lead.master_id) {
                  // It's a sublead - format appropriately for display
                  if (displayLeadNumber && displayLeadNumber.includes('/')) {
                    // lead_number already has /, use it as is
                    displayLeadNumber = displayLeadNumber;
                  } else {
                    // Find master lead number to format properly
                    // For new leads subleads, use manual_id first, then lead_number, then master_id
                    const masterLead = newLeadsMap.get(meeting.lead.master_id);
                    const masterLeadNumber = masterLead?.manual_id || masterLead?.lead_number || meeting.lead.master_id?.toString() || '';
                    displayLeadNumber = `${masterLeadNumber}/2`; // Default to /2
                  }
                }

                // Get full lead data from newLeadsMap to ensure we have manual_id
                const fullLeadData = newLeadsMap.get(meeting.lead.id) || meeting.lead;

                leadData = {
                  ...meeting.lead,
                  ...fullLeadData, // Merge full data to ensure manual_id is included
                  lead_type: 'new',
                  // Store original IDs for employee lookup (for avatars)
                  manager_id: meeting.lead.meeting_manager_id || meeting.lead.manager,
                  helper_id: meeting.lead.meeting_lawyer_id || meeting.lead.helper,
                  scheduler_id: meeting.lead.scheduler,
                  expert_id: meeting.lead.expert,
                  handler_id: meeting.lead.case_handler_id,
                  // Convert IDs to display names for display
                  manager: meeting.lead.meeting_manager_id
                    ? getEmployeeDisplayName(meeting.lead.meeting_manager_id)
                    : (meeting.lead.manager || '--'),
                  helper: meeting.lead.meeting_lawyer_id
                    ? getEmployeeDisplayName(meeting.lead.meeting_lawyer_id)
                    : (meeting.lead.helper || '--'),
                  scheduler: meeting.lead.scheduler
                    ? (typeof meeting.lead.scheduler === 'number' || (typeof meeting.lead.scheduler === 'string' && !isNaN(Number(meeting.lead.scheduler))))
                      ? getEmployeeDisplayName(meeting.lead.scheduler)
                      : meeting.lead.scheduler
                    : '--',
                  expert: meeting.lead.expert
                    ? (typeof meeting.lead.expert === 'number' || (typeof meeting.lead.expert === 'string' && !isNaN(Number(meeting.lead.expert))))
                      ? getEmployeeDisplayName(meeting.lead.expert)
                      : meeting.lead.expert
                    : '--',
                  handler: meeting.lead.case_handler_id
                    ? getEmployeeDisplayName(meeting.lead.case_handler_id)
                    : (meeting.lead.handler || '--'),
                  // Language: preserve from meeting.lead (spread above) and also store language_id if available
                  language: meeting.lead.language || null,
                  language_id: meeting.lead.language_id || null,
                  // Store formatted lead_number for display (with sublead suffix if applicable)
                  lead_number: displayLeadNumber,
                  // Keep original lead_number for navigation (buildClientRoute uses lead_number which should have / if sublead)
                  // Store currency_id for reference
                  currency_id: meeting.lead.currency_id ?? null,
                  // balance_currency is already set to a symbol (₪, $, €, £, etc.) from the JOIN processing above
                  // Use it directly (same as Clients.tsx balance badge which uses selectedClient.balance_currency)
                  balance_currency: meeting.lead.balance_currency || '₪',
                  department_name: meeting.lead.misc_category?.misc_maincategory?.tenant_departement?.name || 'Unassigned',
                  department_id: meeting.lead.misc_category?.misc_maincategory?.department_id
                };
              }

              return {
                ...meeting,
                meeting_confirmation: getMeetingConfirmationState(meeting),
                meeting_location: getMeetingLocationName(meeting.meeting_location),
                lead: leadData
              };
            });
        }

        // Set meetings immediately so the calendar renders without waiting for legacy
        setMeetings(dedupeMeetingsByLeadAndDate(allProcessedMeetings));
        setIsLoading(false);
        setIsBackgroundLoading(false);

        // Load legacy meetings in background and merge when ready (don't block initial paint)
        const employeesForLegacy = allEmployees.length > 0 ? allEmployees : (employeesAndCategoriesData?.employees || []);
        fetchLegacyMeetingsForDateRange(dateRangeFrom, dateRangeTo, employeesForLegacy)
          .then(legacyMeetings => {
            if (legacyMeetings.length > 0) {
              setMeetings(prev => combineMeetingsWithoutDuplicates(prev, legacyMeetings));
            }
          })
          .catch(err => {
            console.error('Background legacy meetings fetch failed:', err);
            const msg = typeof err?.message === 'string' ? err.message : '';
            if (msg.includes('timeout') || err?.code === '57014') setLegacyLoadingDisabled(true);
          });

        // Fetch staff meetings for today
        await fetchStaffMeetings(today, today);

        // Fetch all staff from tenants_employee table for the main calendar filter
        const { data: allStaffData, error: allStaffError } = await supabase
          .from('tenants_employee')
          .select('display_name')
          .not('display_name', 'is', null)
          .order('display_name');

        if (allStaffError) {
          console.error('Error fetching all staff:', allStaffError);
          setStaff([]);
        } else {
          const allStaffNames = allStaffData?.map(employee => employee.display_name).filter(Boolean) || [];
          setStaff(allStaffNames);
        }

        // Note: Past stages data is now fetched in parallel with legacy meetings above
        // This ensures it's available before meetings are displayed
      } catch (error) {
        console.error('Error in fetchMeetingsAndStaff:', error);
        setMeetings([]);
        setStaff([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMeetingsAndStaff();
    fetchMeetingLocations();

    // DISABLED: Meeting counts query removed to prevent timeouts
    // fetchMeetingCountsAndPreviousManagers().catch(error => {
    // });
  }, [location.pathname, appliedFromDate, appliedToDate, datesManuallySet, meetingsRefreshTrigger]); // Run when pathname/date range changes or when explicitly refreshed (e.g. after Teams modal close)

  // Re-render when categories are loaded to update category names
  useEffect(() => {
    if (allCategories.length > 0) {
      // Force a re-render by updating a dummy state or just let React handle it
    }
  }, [allCategories]);

  // Fetch latest notes from leads table when a meeting is expanded
  useEffect(() => {
    const fetchExpandedMeetingData = async (meeting: any) => {
      setExpandedMeetingData(prev => ({
        ...prev,
        [meeting.id]: { ...prev[meeting.id], loading: true }
      }));
      try {
        // Determine which table to query based on lead type
        const tableName = meeting.lead?.lead_type === 'legacy' ? 'leads_lead' : 'leads';
        let leadId;

        if (meeting.lead?.lead_type === 'legacy') {
          // For legacy meetings, extract the original ID from the prefixed ID
          leadId = meeting.id.startsWith('legacy_') ? meeting.id.replace('legacy_', '') : meeting.legacy_lead_id;
        } else {
          leadId = meeting.client_id;
        }

        if (!leadId) {
          throw new Error('Missing lead ID');
        }

        // Fetch expert_notes, handler_notes, and facts/description
        const fieldsToSelect = meeting.lead?.lead_type === 'legacy'
          ? 'expert_notes,handler_notes,description'
          : 'expert_notes,handler_notes,facts';

        const { data, error } = await supabase
          .from(tableName)
          .select(fieldsToSelect)
          .eq('id', leadId)
          .single();
        if (error) throw error;
        setExpandedMeetingData(prev => ({
          ...prev,
          [meeting.id]: {
            loading: false,
            expert_notes: data.expert_notes,
            handler_notes: data.handler_notes,
            facts: meeting.lead?.lead_type === 'legacy' ? (data as any).description : (data as any).facts
          }
        }));
      } catch (error) {
        setExpandedMeetingData(prev => ({
          ...prev,
          [meeting.id]: { ...prev[meeting.id], loading: false }
        }));
        console.error('Failed to load meeting details:', error);
      }
    };

    // Fetch when meeting is expanded
    if (expandedMeetingId) {
      const meeting = meetings.find(m => m.id === expandedMeetingId);
      if (meeting && meeting.lead && meeting.lead.id) {
        fetchExpandedMeetingData(meeting);
      }
    }

    // Fetch when notes modal opens if not already loaded
    if (isNotesModalOpen && selectedMeetingForNotes) {
      const meetingNotes = expandedMeetingData[selectedMeetingForNotes.id];
      // If notes haven't been loaded yet, trigger the fetch
      if (!meetingNotes || meetingNotes.loading === undefined) {
        fetchExpandedMeetingData(selectedMeetingForNotes);
      }
    }
  }, [expandedMeetingId, meetings, isNotesModalOpen, selectedMeetingForNotes]);

  // Load staff meetings and legacy meetings when applied date range changes
  useEffect(() => {
    // Only fetch data when both applied dates are set and user has manually set them
    if (appliedFromDate && appliedToDate && appliedFromDate.trim() !== '' && appliedToDate.trim() !== '' && datesManuallySet) {
      // Always load staff meetings for the date range
      fetchStaffMeetings(appliedFromDate, appliedToDate);
      // Load legacy meetings automatically when date range changes
      loadLegacyForDateRange(appliedFromDate, appliedToDate);
    }
  }, [appliedFromDate, appliedToDate, datesManuallySet]);

  useEffect(() => {
    // Combine regular meetings and staff meetings, with deduplication by ID
    const meetingsMap = new Map<string | number, any>();

    // Add regular meetings first
    meetings.forEach(meeting => {
      meetingsMap.set(meeting.id, meeting);
    });

    // Add staff meetings (they should have different IDs, but deduplicate anyway)
    staffMeetings.forEach(meeting => {
      if (!meetingsMap.has(meeting.id)) {
        meetingsMap.set(meeting.id, meeting);
      }
    });

    const allMeetings = Array.from(meetingsMap.values());
    let filtered = allMeetings;

    if (appliedFromDate && appliedToDate) {
      const beforeFilter = filtered.length;
      filtered = filtered.filter(m => m.meeting_date >= appliedFromDate && m.meeting_date <= appliedToDate);
    }

    if (selectedStaff) {
      const beforeFilter = filtered.length;
      // Normalize selectedStaff for comparison (trim and lowercase)
      const normalizedSelectedStaff = selectedStaff.trim().toLowerCase();

      // Helper function to convert ID to display name if needed
      const getDisplayNameOrValue = (value: any): string => {
        if (!value || value === '---' || value === '--') return '';
        const valueStr = value.toString().trim();
        // Check if it's a numeric ID
        if (!isNaN(Number(valueStr)) && Number(valueStr) > 0) {
          // Try to convert ID to display name
          const employee = allEmployees.find((emp: any) => emp.id.toString() === valueStr);
          if (employee) {
            return employee.display_name;
          }
        }
        // Return as-is (already a display name)
        return valueStr;
      };

      filtered = filtered.filter(m => {
        const lead = m.lead || {};

        // Get display names (convert IDs if needed)
        const managerDisplayName = getDisplayNameOrValue(lead.manager);
        const helperDisplayName = getDisplayNameOrValue(lead.helper);
        const schedulerDisplayName = getDisplayNameOrValue(lead.scheduler || lead.scheduler_id);
        const expertDisplayName = getDisplayNameOrValue(lead.expert);
        const meetingManagerDisplayName = getDisplayNameOrValue(m.meeting_manager);
        const meetingHelperDisplayName = getDisplayNameOrValue(m.helper);
        const meetingSchedulerDisplayName = getDisplayNameOrValue(m.scheduler || (m as any).scheduler_id);
        const meetingExpertDisplayName = getDisplayNameOrValue(m.expert);

        // Normalize all fields for comparison (trim and lowercase)
        const normalizedManager = managerDisplayName.toLowerCase();
        const normalizedHelper = helperDisplayName.toLowerCase();
        const normalizedScheduler = schedulerDisplayName.toLowerCase();
        const normalizedExpert = expertDisplayName.toLowerCase();
        const normalizedMeetingManager = meetingManagerDisplayName.toLowerCase();
        const normalizedMeetingHelper = meetingHelperDisplayName.toLowerCase();
        const normalizedMeetingScheduler = meetingSchedulerDisplayName.toLowerCase();
        const normalizedMeetingExpert = meetingExpertDisplayName.toLowerCase();

        const matches = (
          normalizedManager === normalizedSelectedStaff ||
          normalizedHelper === normalizedSelectedStaff ||
          normalizedScheduler === normalizedSelectedStaff ||
          normalizedMeetingManager === normalizedSelectedStaff ||
          normalizedMeetingHelper === normalizedSelectedStaff ||
          normalizedMeetingScheduler === normalizedSelectedStaff ||
          normalizedExpert === normalizedSelectedStaff ||
          normalizedMeetingExpert === normalizedSelectedStaff
        );

        return matches;
      });
    }

    // Filter by meeting type
    if (selectedMeetingType !== 'all') {
      const beforeFilter = filtered.length;
      filtered = filtered.filter(m => {
        if (selectedMeetingType === 'potential' && m.calendar_type !== 'potential_client') {
          return false;
        }
        if (selectedMeetingType === 'active' && m.calendar_type !== 'active_client') {
          return false;
        }
        if (selectedMeetingType === 'staff' && m.calendar_type !== 'staff') {
          return false;
        }
        if (selectedMeetingType === 'paid') {
          const lead = m.lead || {};
          const hasPaidMarker =
            (lead && lead.meeting_collection_id) ||
            m.legacy_lead?.meeting_collection_id;
          if (!hasPaidMarker) {
            return false;
          }
        }
        return true;
      });
    }

    // Final filter: Exclude inactive leads (stage 91 or unactivated_at is not null)
    // Also exclude meetings that have a client_id or legacy_lead_id but no lead (because lead was filtered out as inactive)
    filtered = filtered.filter(m => {
      // Staff meetings are always allowed (they don't have leads)
      if (m.calendar_type === 'staff') {
        return true;
      }

      const lead = m.lead || {};
      const legacyLead = m.legacy_lead || {};

      // If meeting has a client_id or legacy_lead_id but no lead data, exclude it
      // This means the lead was filtered out as inactive
      if ((m.client_id || m.legacy_lead_id) && !lead.id && !legacyLead.id) {
        return false;
      }

      // Check for new leads
      if (lead.id && !lead.id.toString().startsWith('legacy_')) {
        // Exclude if stage is 91 or unactivated_at is set
        if (lead.stage === 91 || lead.stage === '91') return false;
        if (lead.unactivated_at) return false;
      }

      // Check for legacy leads
      if (legacyLead.id || lead.id?.toString().startsWith('legacy_')) {
        // Exclude if stage is 91 or status is 10
        const stage = legacyLead.stage || lead.stage;
        const status = legacyLead.status || lead.status;
        if (stage === 91 || stage === '91') return false;
        if (status === 10 || status === '10') return false;
      }

      return true;
    });

    // Sort meetings by time (earliest first)
    filtered = filtered.sort((a, b) => {
      const timeA = a.meeting_time || '';
      const timeB = b.meeting_time || '';

      // If both have times, compare them
      if (timeA && timeB) {
        return timeA.localeCompare(timeB);
      }

      // If only one has time, prioritize the one with time
      if (timeA && !timeB) return -1;
      if (!timeA && timeB) return 1;

      // If neither has time, keep original order
      return 0;
    });

    setFilteredMeetings(filtered);

    // Calculate total balance for the day - include both regular and legacy meetings
    // Convert all currencies to NIS and sum them up
    const totalAmountInNIS = filtered.reduce((sum, meeting) => {
      const lead = meeting.lead || {};
      let amount = 0;
      let currency = 'NIS'; // Default currency
      let source = 'none';

      // Determine if this is a legacy lead
      const isLegacy = lead.lead_type === 'legacy' || lead.id?.toString().startsWith('legacy_');

      // Get balance value using same logic as balance badge
      if (isLegacy) {
        // For legacy leads: if currency_id is 1 (NIS/ILS), use total_base; otherwise use total
        const currencyId = (lead as any).currency_id;
        let numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
        if (!numericCurrencyId || isNaN(numericCurrencyId)) {
          numericCurrencyId = 1; // Default to NIS
        }
        if (numericCurrencyId === 1) {
          amount = (lead as any).total_base ?? 0;
        } else {
          amount = (lead as any).total ?? 0;
        }
        // Get currency symbol - balance_currency should already be set from JOIN
        currency = lead.balance_currency || '₪';
        source = isLegacy ? 'legacy_lead.total_base_or_total' : 'lead.balance';
      } else if (typeof lead.balance === 'number' && lead.balance > 0) {
        // For new leads, use balance
        amount = lead.balance;
        currency = lead.balance_currency || '₪';
        source = 'lead.balance';
      } else if ((lead as any).proposal_total && typeof (lead as any).proposal_total === 'number') {
        // Fallback to proposal_total for new leads
        amount = (lead as any).proposal_total;
        currency = (lead as any).proposal_currency || lead.balance_currency || '₪';
        source = 'lead.proposal_total';
      }
      // Fallback to meeting_amount if lead balance is not available
      else if (typeof meeting.meeting_amount === 'number' && meeting.meeting_amount > 0) {
        amount = meeting.meeting_amount;
        currency = meeting.meeting_currency || 'NIS';
        source = 'meeting.meeting_amount';
      }
      // Handle "--" values for staff meetings
      else if (lead.balance === '--' || meeting.meeting_amount === '--') {
        amount = 0; // Don't include in total calculation
        currency = 'NIS';
        source = 'staff_meeting';
      }

      // Normalize currency symbol to code for conversion
      let currencyCode = currency;
      if (currency === '₪') currencyCode = 'NIS';
      else if (currency === '€') currencyCode = 'EUR';
      else if (currency === '$') currencyCode = 'USD';
      else if (currency === '£') currencyCode = 'GBP';
      else if (currency === 'ILS') currencyCode = 'NIS';

      // Convert to NIS and add to total
      const amountInNIS = convertToNIS(amount, currencyCode);
      return sum + amountInNIS;
    }, 0);

    setTotalAmount(totalAmountInNIS);


  }, [appliedFromDate, appliedToDate, selectedStaff, selectedMeetingType, meetings, staffMeetings]);



  const FALLBACK_STAGE_COLOR = '#3b28c7';
  const NEUTRAL_STAGE_BG = '#f3f4f6';
  const NEUTRAL_STAGE_TEXT = '#374151';

  const getContrastingTextColor = (hexColor?: string | null) => {
    if (!hexColor) return '#1f2937';
    const color = hexColor.replace('#', '');
    if (color.length !== 6) return '#1f2937';

    const r = parseInt(color.substring(0, 2), 16);
    const g = parseInt(color.substring(2, 4), 16);
    const b = parseInt(color.substring(4, 6), 16);

    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? '#111827' : '#ffffff';
  };

  const resolveStageColour = (stageValue: string | number | null | undefined) => {
    if (stageValue === null || stageValue === undefined) {
      return '';
    }

    const raw = String(stageValue).trim();
    if (!raw) return '';

    const candidates = [raw];
    const numericCandidate = Number(raw);
    if (!Number.isNaN(numericCandidate)) {
      candidates.push(String(numericCandidate));
    }
    const lower = raw.toLowerCase();
    if (lower !== raw) {
      candidates.push(lower);
    }

    for (const candidate of candidates) {
      const colour = getStageColour(candidate);
      if (colour) {
        return colour;
      }
    }

    return '';
  };

  const getStageBadge = (stage: string | number | null | undefined) => {
    const label = formatStageLabel(stage);
    const hasStage = label && label !== 'No Stage';

    if (!hasStage) {
      return (
        <span
          className="inline-flex items-center px-1.5 py-0.5 sm:px-2 sm:py-0.5 rounded-md text-[10px] sm:text-xs font-semibold border"
          style={{ backgroundColor: NEUTRAL_STAGE_BG, color: NEUTRAL_STAGE_TEXT, borderColor: '#e5e7eb' }}
        >
          No Stage
        </span>
      );
    }

    const stageColour = resolveStageColour(stage) || FALLBACK_STAGE_COLOR;
    const textColour = getContrastingTextColor(stageColour);

    return (
      <span
        className="inline-flex items-center px-1.5 py-0.5 sm:px-2 sm:py-0.5 rounded-md text-[10px] sm:text-xs font-semibold shadow-sm"
        style={{ backgroundColor: stageColour, color: textColour, border: `1px solid ${stageColour}` }}
      >
        {label}
      </span>
    );
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

  // Helper function to build client route (similar to SchedulerToolPage and Clients.tsx)
  const buildClientRoute = (lead: any): string => {
    if (!lead) return '/clients';

    // For new leads
    if (lead.lead_type === 'new' && lead.lead_number) {
      const isSubLead = lead.lead_number.includes('/');
      if (isSubLead) {
        // Sublead: use manual_id first if available, otherwise use base lead_number
        // For new leads subleads, prefer manual_id over lead_number for the path
        const manualId = lead.manual_id || null;
        if (manualId) {
          // Sublead with manual_id: use query parameter format like /clients/2104625?lead=L210764%2F3
          return `/clients/${encodeURIComponent(manualId)}?lead=${encodeURIComponent(lead.lead_number)}`;
        } else {
          // Sublead without manual_id: extract base from lead_number
          const baseLeadNumber = lead.lead_number.split('/')[0];
          return `/clients/${encodeURIComponent(baseLeadNumber)}?lead=${encodeURIComponent(lead.lead_number)}`;
        }
      } else {
        // Regular new lead: use manual_id if available, otherwise use lead_number
        const identifier = lead.manual_id || lead.lead_number || '';
        return `/clients/${encodeURIComponent(identifier)}`;
      }
    }
    // For legacy leads
    else if (lead.lead_type === 'legacy' || lead.id?.toString().startsWith('legacy_')) {
      const legacyId = lead.id?.toString().replace('legacy_', '') || lead.id;
      const isSubLead = lead.lead_number && lead.lead_number.includes('/');

      if (isSubLead) {
        // Legacy sublead: use numeric ID in path, formatted lead_number in query
        return `/clients/${encodeURIComponent(legacyId)}?lead=${encodeURIComponent(lead.lead_number)}`;
      } else {
        // Legacy master lead: use numeric ID
        return `/clients/${encodeURIComponent(legacyId)}`;
      }
    }
    // Fallback: check if lead_number contains '/' (sublead pattern)
    else if (lead.lead_number) {
      const isSubLead = lead.lead_number.includes('/');
      if (isSubLead) {
        const baseLeadNumber = lead.lead_number.split('/')[0];
        return `/clients/${encodeURIComponent(baseLeadNumber)}?lead=${encodeURIComponent(lead.lead_number)}`;
      } else {
        return `/clients/${encodeURIComponent(lead.lead_number)}`;
      }
    }

    return '/clients';
  };

  // Handle row selection (for action menu)
  const handleRowSelect = (meetingId: string | number) => {
    setSelectedRowId(meetingId);
    setShowActionMenu(true);
    const meeting = meetings.find(m => m.id === meetingId) || filteredMeetings.find(m => m.id === meetingId);
    if (meeting && meeting.lead) {
      setSelectedLeadForActions(meeting.lead);
    }
  };

  // Action handlers
  const handleCall = (lead: any) => {
    const phoneNumber = lead.phone || lead.mobile;
    if (phoneNumber) {
      window.open(`tel:${phoneNumber}`, '_self');
    } else {
      toast.error('No phone number available for this lead');
    }
  };

  const handleViewClient = (lead: any, event?: React.MouseEvent) => {
    const isNewTab = event?.metaKey || event?.ctrlKey;
    const navigationUrl = buildClientRoute(lead);

    if (isNewTab) {
      // Open in new tab
      window.open(navigationUrl, '_blank');
      return;
    }

    // Normal navigation in same tab
    navigate(navigationUrl);
  };

  const handleEmail = (lead: any, meeting: any) => {
    handleEmailClick(lead, meeting);
  };

  const handleWhatsApp = (lead: any, meeting: any) => {
    handleWhatsAppClick(lead, meeting);
  };

  const handleTimeline = (lead: any) => {
    const baseUrl = buildClientRoute(lead);
    // Add tab parameter if baseUrl already has query params, otherwise use &
    const separator = baseUrl.includes('?') ? '&' : '?';
    navigate(`${baseUrl}${separator}tab=interactions`);
  };

  const handleEditLead = (lead: any) => {
    const baseUrl = buildClientRoute(lead);
    // Add tab parameter if baseUrl already has query params, otherwise use &
    const separator = baseUrl.includes('?') ? '&' : '?';
    navigate(`${baseUrl}${separator}tab=info`);
  };

  const handleDocuments = (lead: any, meeting: any) => {
    setSelectedMeeting(meeting);
    setIsDocumentModalOpen(true);
  };

  // Helper function to handle Email button click
  const handleEmailClick = (lead: any, meeting: any) => {
    // Format lead as client object for SchedulerEmailThreadModal
    // For new leads: id is UUID string, for legacy: id is number
    const isLegacy = lead.lead_type === 'legacy' ||
      (typeof lead.id === 'string' && lead.id.startsWith('legacy_')) ||
      (meeting.legacy_lead_id && !meeting.client_id);

    let clientId: string;
    if (isLegacy) {
      // For legacy leads, use the numeric ID (remove 'legacy_' prefix if present)
      const legacyId = typeof lead.id === 'string' && lead.id.startsWith('legacy_')
        ? lead.id.replace('legacy_', '')
        : (meeting.legacy_lead_id || lead.id || '').toString();
      clientId = legacyId;
    } else {
      // For new leads, use the UUID
      clientId = lead.id || meeting.client_id || '';
    }

    const client = {
      id: clientId,
      name: lead.name || '',
      lead_number: lead.lead_number || (isLegacy ? clientId : ''),
      email: lead.email || '',
      lead_type: isLegacy ? 'legacy' : 'new',
      topic: lead.topic || '',
      user_internal_id: lead.user_internal_id || null
    };
    setSelectedClientForEmail(client);
    setIsEmailModalOpen(true);
  };

  // Helper function to handle WhatsApp button click
  const handleWhatsAppClick = (lead: any, meeting: any) => {
    // Format lead as client object for SchedulerWhatsAppModal
    // For new leads: id is UUID string, for legacy: id is number
    const isLegacy = lead.lead_type === 'legacy' ||
      (typeof lead.id === 'string' && lead.id.startsWith('legacy_')) ||
      (meeting.legacy_lead_id && !meeting.client_id);

    let clientId: string;
    if (isLegacy) {
      // For legacy leads, use the numeric ID (remove 'legacy_' prefix if present)
      const legacyId = typeof lead.id === 'string' && lead.id.startsWith('legacy_')
        ? lead.id.replace('legacy_', '')
        : (meeting.legacy_lead_id || lead.id || '').toString();
      clientId = legacyId;
    } else {
      // For new leads, use the UUID
      clientId = lead.id || meeting.client_id || '';
    }

    const client = {
      id: clientId,
      name: lead.name || '',
      lead_number: lead.lead_number || (isLegacy ? clientId : ''),
      phone: lead.phone || '',
      mobile: lead.mobile || '',
      lead_type: isLegacy ? 'legacy' : 'new'
    };
    setSelectedClientForWhatsApp(client);
    setIsWhatsAppOpen(true);
  };



  // Assign Staff Modal Functions
  const fetchAssignStaffData = async () => {
    setAssignStaffLoading(true);
    try {
      // Get date range: 7 days ago to 30 days in the future
      const today = new Date().toISOString().split('T')[0];
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Initialize modal date to today if not set
      if (!modalSelectedDate) {
        setModalSelectedDate(today);
      }

      // Step 1: Fetch only basic meeting data from meetings table (no joins)
      // Only select minimal fields that definitely exist - we'll get the rest from leads/leads_lead tables
      const { data: meetingsData, error: meetingsError } = await supabase
        .from('meetings')
        .select(`
          id, created_at, meeting_date, meeting_time, meeting_manager, helper, meeting_location, 
          teams_meeting_url, custom_link, custom_address, meeting_brief, status, client_id, legacy_lead_id
        `)
        .gte('meeting_date', sevenDaysAgo)
        .lte('meeting_date', thirtyDaysFromNow)
        .or('status.is.null,status.neq.canceled')
        .order('meeting_date', { ascending: true })
        .order('meeting_time', { ascending: true })
        .limit(500);

      if (meetingsError) {
        if (meetingsError.code === '57014' || meetingsError.message?.includes('timeout')) {
          console.warn('Meetings query timeout');
          toast.error('Loading meetings timed out. Please try again.');
          setAssignStaffLoading(false);
          return;
        }
        throw meetingsError;
      }

      // Step 2: Fetch additional lead data separately (both new and legacy) based on IDs we just fetched
      const clientIds = (meetingsData || [])
        .map(m => m.client_id)
        .filter(id => !!id) as string[];
      const legacyLeadIds = (meetingsData || [])
        .map(m => m.legacy_lead_id)
        .filter(id => !!id) as (string | number)[];

      const uniqueClientIds = Array.from(new Set(clientIds));
      const uniqueLegacyLeadIds = Array.from(new Set(legacyLeadIds));

      const leadsMap: Record<string, any> = {};
      if (uniqueClientIds.length > 0) {
        const { data: leadsData, error: leadsError } = await supabase
          .from('leads')
          .select(`
            id, name, lead_number, stage, manager, helper, scheduler, category, category_id, balance, balance_currency, 
            expert_notes, expert, probability, phone, email, language, language_id, number_of_applicants_meeting, eligibility_status,
            currency_id,
            accounting_currencies!leads_currency_id_fkey (
              id,
              name,
              iso_code
            ),
            misc_category!fk_leads_category_id ( id, name, parent_id, misc_maincategory!parent_id ( id, name ) ),
            misc_leadsource!fk_leads_source_id ( id, name ),
            misc_language!fk_leads_language_id ( id, name )
          `)
          .in('id', uniqueClientIds)
          .is('unactivated_at', null) // Filter out inactive leads
          .neq('stage', 91) // Filter out stage 91 (inactive/dropped leads)
          .limit(500);

        if (leadsError) {
          console.error('Error fetching leads:', leadsError);
        } else if (leadsData) {
          leadsData.forEach((lead: any) => {
            const currencyRecord = lead.accounting_currencies
              ? (Array.isArray(lead.accounting_currencies) ? lead.accounting_currencies[0] : lead.accounting_currencies)
              : null;
            if (currencyRecord) {
              lead.balance_currency = (currencyRecord.name || currencyRecord.iso_code || '₪').trim() || '₪';
            } else {
              lead.balance_currency = lead.balance_currency || '₪';
            }

            lead.category = getCategoryDisplayFromJoin(lead) ?? getCategoryName(lead.category_id, lead.category) ?? lead.category;
            lead.language = getLanguageDisplayFromJoin(lead) ?? lead.language;
            leadsMap[lead.id] = lead;
          });
        }
      }

      const legacyLeadsMap: Record<string, any> = {};
      if (uniqueLegacyLeadIds.length > 0) {
        const { data: legacyLeadsData, error: legacyLeadsError } = await supabase
          .from('leads_lead')
          .select(`
            id, name, lead_number, stage, meeting_manager_id, meeting_lawyer_id, meeting_scheduler_id, category, category_id, 
            total, total_base, currency_id, meeting_total_currency_id, probability, phone, email, mobile, topic, language_id,
            accounting_currencies!leads_lead_currency_id_fkey (
              id,
              name,
              iso_code
            ),
            misc_category!leads_lead_category_id_fkey ( id, name, parent_id, misc_maincategory!parent_id ( id, name ) ),
            misc_leadsource!leads_lead_source_id_fkey ( id, name ),
            misc_language!leads_lead_language_id_fkey ( id, name )
          `)
          .in('id', uniqueLegacyLeadIds)
          .or('status.eq.0,status.is.null') // Filter out inactive leads
          .neq('stage', 91) // Filter out stage 91 (inactive/dropped leads)
          .limit(500);

        if (legacyLeadsError) {
          console.error('Error fetching legacy leads:', legacyLeadsError);
        } else if (legacyLeadsData) {
          legacyLeadsData.forEach((legacyLead: any) => {
            // Extract currency data from joined table and convert to symbol
            const currencyRecord = legacyLead.accounting_currencies
              ? (Array.isArray(legacyLead.accounting_currencies) ? legacyLead.accounting_currencies[0] : legacyLead.accounting_currencies)
              : null;

            if (currencyRecord) {
              // Convert iso_code to symbol
              const currencySymbol = (() => {
                if (currencyRecord.iso_code) {
                  const isoCode = currencyRecord.iso_code.toUpperCase();
                  if (isoCode === 'ILS' || isoCode === 'NIS') return '₪';
                  if (isoCode === 'USD') return '$';
                  if (isoCode === 'EUR') return '€';
                  if (isoCode === 'GBP') return '£';
                  if (isoCode === 'CAD') return 'C$';
                  if (isoCode === 'AUD') return 'A$';
                  if (isoCode === 'JPY') return '¥';
                  return currencyRecord.name || isoCode || '₪';
                }
                if (legacyLead.currency_id) {
                  const currencyId = Number(legacyLead.currency_id);
                  switch (currencyId) {
                    case 1: return '₪'; break;
                    case 2: return '€'; break;
                    case 3: return '$'; break;
                    case 4: return '£'; break;
                    default: return '₪';
                  }
                }
                return '₪';
              })();
              legacyLead.balance_currency = currencySymbol;
            } else if (legacyLead.currency_id) {
              const currencyId = Number(legacyLead.currency_id);
              switch (currencyId) {
                case 1: legacyLead.balance_currency = '₪'; break;
                case 2: legacyLead.balance_currency = '€'; break;
                case 3: legacyLead.balance_currency = '$'; break;
                case 4: legacyLead.balance_currency = '£'; break;
                default: legacyLead.balance_currency = '₪';
              }
            } else {
              legacyLead.balance_currency = '₪';
            }

            legacyLead.category = getCategoryDisplayFromJoin(legacyLead) ?? getCategoryName(legacyLead.category_id, legacyLead.category) ?? legacyLead.category;
            legacyLead.language = getLanguageDisplayFromJoin(legacyLead) ?? legacyLead.language;
            legacyLeadsMap[String(legacyLead.id)] = legacyLead;
          });
        }
      }

      // Step 2.5: Fetch legacy leads that have meetings directly in leads_lead table (not in meetings table)
      // Get IDs of legacy leads that are already in meetings table to exclude them
      const existingLegacyLeadIds = new Set(uniqueLegacyLeadIds.map(id => String(id)));

      let directLegacyMeetings: any[] = [];
      const { data: directLegacyMeetingsData, error: directLegacyError } = await supabase
        .from('leads_lead')
        .select(`
          id, name, meeting_date, meeting_time, lead_number, category, category_id, stage, 
          meeting_manager_id, meeting_lawyer_id, meeting_scheduler_id, total, total_base, currency_id, meeting_total_currency_id, 
          expert_id, probability, phone, email, mobile, meeting_location_id, expert_examination, topic, language_id,
          accounting_currencies!leads_lead_currency_id_fkey (
            id,
            name,
            iso_code
          ),
          misc_category!leads_lead_category_id_fkey ( id, name, parent_id, misc_maincategory!parent_id ( id, name ) ),
          misc_leadsource!leads_lead_source_id_fkey ( id, name ),
          misc_language!leads_lead_language_id_fkey ( id, name )
        `)
        .gte('meeting_date', sevenDaysAgo)
        .lte('meeting_date', thirtyDaysFromNow)
        .not('meeting_date', 'is', null)
        .not('name', 'is', null)
        .or('status.eq.0,status.is.null') // Filter out inactive leads
        .neq('stage', 91) // Filter out stage 91 (inactive/dropped leads)
        .limit(500);

      // Process direct legacy meetings and convert currency to symbols
      if (directLegacyMeetingsData && directLegacyMeetingsData.length > 0) {
        directLegacyMeetingsData.forEach((legacyLead: any) => {
          // Extract currency data from joined table and convert to symbol
          const currencyRecord = legacyLead.accounting_currencies
            ? (Array.isArray(legacyLead.accounting_currencies) ? legacyLead.accounting_currencies[0] : legacyLead.accounting_currencies)
            : null;

          if (currencyRecord) {
            // Convert iso_code to symbol
            const currencySymbol = (() => {
              if (currencyRecord.iso_code) {
                const isoCode = currencyRecord.iso_code.toUpperCase();
                if (isoCode === 'ILS' || isoCode === 'NIS') return '₪';
                if (isoCode === 'USD') return '$';
                if (isoCode === 'EUR') return '€';
                if (isoCode === 'GBP') return '£';
                if (isoCode === 'CAD') return 'C$';
                if (isoCode === 'AUD') return 'A$';
                if (isoCode === 'JPY') return '¥';
                return currencyRecord.name || isoCode || '₪';
              }
              if (legacyLead.currency_id) {
                const currencyId = Number(legacyLead.currency_id);
                switch (currencyId) {
                  case 1: return '₪'; break;
                  case 2: return '€'; break;
                  case 3: return '$'; break;
                  case 4: return '£'; break;
                  default: return '₪';
                }
              }
              return '₪';
            })();
            legacyLead.balance_currency = currencySymbol;
          } else if (legacyLead.currency_id) {
            const currencyId = Number(legacyLead.currency_id);
            switch (currencyId) {
              case 1: legacyLead.balance_currency = '₪'; break;
              case 2: legacyLead.balance_currency = '€'; break;
              case 3: legacyLead.balance_currency = '$'; break;
              case 4: legacyLead.balance_currency = '£'; break;
              default: legacyLead.balance_currency = '₪';
            }
          } else {
            legacyLead.balance_currency = '₪';
          }
        });
      }

      if (directLegacyError) {
        console.error('Error fetching direct legacy meetings:', directLegacyError);
        // Continue without direct legacy meetings if there's an error
      } else {
        // Filter out legacy leads that already have entries in meetings table
        directLegacyMeetings = (directLegacyMeetingsData || []).filter((legacyLead: any) => {
          return !existingLegacyLeadIds.has(String(legacyLead.id));
        });
      }

      // Process direct legacy meetings into meeting format
      const processedDirectLegacyMeetings = (directLegacyMeetings || []).map((legacyLead: any) => {
        const meeting = {
          id: `legacy_${legacyLead.id}`,
          created_at: legacyLead.meeting_date || new Date().toISOString(),
          meeting_date: legacyLead.meeting_date,
          meeting_time: legacyLead.meeting_time || '09:00',
          meeting_manager: getEmployeeDisplayName(legacyLead.meeting_manager_id),
          helper: getEmployeeDisplayName(legacyLead.meeting_lawyer_id),
          scheduler: getEmployeeDisplayName(legacyLead.meeting_scheduler_id),
          meeting_location: getLegacyMeetingLocation(legacyLead.meeting_location_id) || 'Teams',
          meeting_location_id: legacyLead.meeting_location_id,
          teams_meeting_url: null,
          custom_link: null,
          custom_address: null,
          meeting_brief: null,
          status: null,
          client_id: null,
          legacy_lead_id: legacyLead.id,
          lead: {
            id: `legacy_${legacyLead.id}`,
            lead_number: legacyLead.lead_number || legacyLead.id?.toString() || 'Unknown',
            name: legacyLead.name || '', // Ensure name is set, empty string if missing
            stage: legacyLead.stage || null, // Ensure stage is preserved
            email: legacyLead.email || '',
            phone: legacyLead.phone || '',
            mobile: legacyLead.mobile || '',
            topic: legacyLead.topic || '',
            manager: getEmployeeDisplayName(legacyLead.meeting_manager_id),
            helper: getEmployeeDisplayName(legacyLead.meeting_lawyer_id),
            scheduler: getEmployeeDisplayName(legacyLead.meeting_scheduler_id),
            scheduler_id: legacyLead.meeting_scheduler_id,
            // Store total_base and total for balance logic
            total_base: legacyLead.total_base ?? null,
            total: legacyLead.total ?? null,
            currency_id: legacyLead.currency_id ?? null,
            // Calculate balance based on currency_id (same logic as Clients.tsx)
            balance: (() => {
              const currencyId = legacyLead.currency_id;
              let numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
              if (!numericCurrencyId || isNaN(numericCurrencyId)) {
                numericCurrencyId = 1; // Default to NIS
              }
              if (numericCurrencyId === 1) {
                return legacyLead.total_base ?? null;
              } else {
                return legacyLead.total ?? null;
              }
            })(),
            // balance_currency is already set to a symbol (₪, $, €, £, etc.) from the JOIN processing above
            // Use it directly (same as Clients.tsx balance badge which uses selectedClient.balance_currency)
            balance_currency: legacyLead.balance_currency || '₪',
            expert: getEmployeeDisplayName(legacyLead.expert_id),
            expert_examination: legacyLead.expert_examination || '',
            probability: parseFloat(legacyLead.probability || '0'),
            category_id: legacyLead.category_id || null,
            category: getCategoryDisplayFromJoin(legacyLead) ?? getCategoryName(legacyLead.category_id, legacyLead.category) ?? legacyLead.category ?? 'Unassigned',
            language: getLanguageDisplayFromJoin(legacyLead) ?? 'N/A',
            lead_type: 'legacy' as const
          }
        };
        return meeting;
      });

      // Step 3: Process meetings and attach lead data from the separately fetched map
      const processedMeetings = (meetingsData || [])
        .filter(meeting => {
          // Filter out meetings with invalid or null dates
          if (!meeting.meeting_date) {
            return false;
          }

          // Validate date format
          const date = new Date(meeting.meeting_date);
          if (isNaN(date.getTime())) {
            return false;
          }

          return true;
        })
        .map(meeting => {
          // Get lead data from the separately fetched map
          let leadData = null;

          if (meeting.client_id && leadsMap[meeting.client_id]) {
            // Use new lead data from the map (category and language already set from join)
            const lead = leadsMap[meeting.client_id];
            const language = lead.language || 'N/A';

            // Convert manager, helper, scheduler, expert IDs to display names if they're numeric
            let manager = lead.manager || '--';
            if (manager && manager !== '--') {
              if (typeof manager === 'number' || (typeof manager === 'string' && !isNaN(Number(manager)))) {
                manager = getEmployeeDisplayName(manager) || '--';
              }
            }

            let helper = lead.helper || '--';
            if (helper && helper !== '--') {
              if (typeof helper === 'number' || (typeof helper === 'string' && !isNaN(Number(helper)))) {
                helper = getEmployeeDisplayName(helper) || '--';
              }
            }

            let scheduler = lead.scheduler || '--';
            if (scheduler && scheduler !== '--') {
              if (typeof scheduler === 'number' || (typeof scheduler === 'string' && !isNaN(Number(scheduler)))) {
                scheduler = getEmployeeDisplayName(scheduler) || '--';
              }
            }

            let expert = lead.expert || '--';
            if (expert && expert !== '--') {
              if (typeof expert === 'number' || (typeof expert === 'string' && !isNaN(Number(expert)))) {
                expert = getEmployeeDisplayName(expert) || '--';
              }
            }

            leadData = {
              ...lead,
              lead_type: 'new',
              manager: manager,
              helper: helper,
              scheduler: scheduler,
              expert: expert,
              language: language
            };
          } else if (meeting.legacy_lead_id && legacyLeadsMap[String(meeting.legacy_lead_id)]) {
            const legacyLead = legacyLeadsMap[String(meeting.legacy_lead_id)];
            // category and language already set from join when building legacyLeadsMap

            leadData = {
              ...legacyLead,
              lead_type: 'legacy',
              manager: getEmployeeDisplayName(legacyLead.meeting_manager_id),
              helper: getEmployeeDisplayName(legacyLead.meeting_lawyer_id),
              scheduler: getEmployeeDisplayName(legacyLead.meeting_scheduler_id),
              expert: getEmployeeDisplayName(legacyLead.expert_id),
              balance: legacyLead.total,
              balance_currency: legacyLead.balance_currency || legacyLead.meeting_total_currency_id,
              language: legacyLead.language || 'N/A',
              phone: legacyLead.phone || legacyLead.mobile || '',
              lead_number: legacyLead.lead_number || legacyLead.id?.toString()
            };
          }

          // Convert meeting_manager and helper on the meeting object itself from IDs to display names
          let meetingManager = meeting.meeting_manager || '--';
          if (meetingManager && meetingManager !== '--') {
            if (typeof meetingManager === 'number' || (typeof meetingManager === 'string' && !isNaN(Number(meetingManager)))) {
              meetingManager = getEmployeeDisplayName(meetingManager) || '--';
            }
          }

          let meetingHelper = meeting.helper || '--';
          if (meetingHelper && meetingHelper !== '--') {
            if (typeof meetingHelper === 'number' || (typeof meetingHelper === 'string' && !isNaN(Number(meetingHelper)))) {
              meetingHelper = getEmployeeDisplayName(meetingHelper) || '--';
            }
          }

          // Convert scheduler from leadData to meeting object for filtering (works for both new and legacy leads)
          // Get scheduler from leadData (which is set for both new and legacy leads) or from meeting if it exists
          const schedulerFromLead = leadData?.scheduler;
          const schedulerFromMeeting = (meeting as any).scheduler;
          let meetingScheduler = schedulerFromLead || schedulerFromMeeting || '--';
          if (meetingScheduler && meetingScheduler !== '--') {
            // If it's already a display name (string that's not a number), use it as is
            // If it's a number/ID, convert it to display name
            if (typeof meetingScheduler === 'number' || (typeof meetingScheduler === 'string' && !isNaN(Number(meetingScheduler)))) {
              meetingScheduler = getEmployeeDisplayName(meetingScheduler) || '--';
            }
          }

          return {
            ...meeting,
            meeting_manager: meetingManager,
            helper: meetingHelper,
            scheduler: meetingScheduler,
            lead: leadData
          };
        });

      // Combine regular meetings with direct legacy meetings
      const allMeetings = [...processedMeetings, ...processedDirectLegacyMeetings];

      // Step 4: Fetch available staff from tenants_employee table
      const { data: staffData, error: staffError } = await supabase
        .from('tenants_employee')
        .select('display_name')
        .not('display_name', 'is', null)
        .order('display_name')
        .limit(200);

      if (staffError) {
        console.error('Error fetching staff:', staffError);
        // Continue with empty staff list rather than failing
      }

      const uniqueStaffNames = staffData?.map(employee => employee.display_name).filter(Boolean) || [];


      console.log('🔍 [fetchAssignStaffData] ⭐ Setting assignStaffMeetings:', allMeetings.length, 'meetings');
      console.log('🔍 [fetchAssignStaffData] ⭐ Setting availableStaff:', uniqueStaffNames.length, 'staff members');
      setAssignStaffMeetings(allMeetings);
      setAvailableStaff(uniqueStaffNames);
    } catch (error: any) {
      console.error('Error fetching assign staff data:', error);

      // Handle timeout errors specifically
      if (error?.code === '57014' || error?.message?.includes('timeout')) {
        toast.error('Request timed out. Please try again.');
      } else {
        toast.error('Failed to load meetings data. Please try again.');
      }
    } finally {
      setAssignStaffLoading(false);
    }
  };

  // Fetch employee availability data
  const fetchMeetingLocations = async () => {
    try {
      const { data: locationsData, error } = await supabase
        .from('tenants_meetinglocation')
        .select('id, name, default_link');

      if (error) throw error;

      const locationsMap: { [locationId: number]: string } = {};
      const linksMap: { [locationName: string]: string } = {};
      const nameToIdMap: { [locationName: string]: number } = {};
      locationsData?.forEach(location => {
        locationsMap[location.id] = location.name;
        if (location.name) {
          nameToIdMap[location.name] = location.id;
          if (location.default_link) {
            linksMap[location.name] = location.default_link;
          }
        }
      });

      setMeetingLocations(locationsMap);
      setMeetingLocationLinks(linksMap);
      setMeetingLocationNameToId(nameToIdMap);
    } catch (error) {
      console.error('Error fetching meeting locations:', error);
    }
  };

  const fetchMeetingCountsAndPreviousManagers = async () => {
    try {
      // Reduce date range to 3 months to prevent timeout
      const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Meeting counts query timeout')), 5000)
      );

      const queryPromise = (async () => {
        // Get all meetings for the date range to calculate counts and previous managers
        const { data: allMeetings, error } = await supabase
          .from('meetings')
          .select(`
            id, client_id, meeting_date, meeting_manager,
            lead:leads!client_id(id, lead_number),
            legacy_lead:leads_lead!legacy_lead_id(id, lead_number)
          `)
          .gte('meeting_date', threeMonthsAgo)
          .lte('meeting_date', thirtyDaysFromNow)
          .order('meeting_date', { ascending: true })
          .order('meeting_time', { ascending: true });

        if (error) throw error;

        // Also get legacy meetings from leads_lead table
        const { data: legacyMeetings, error: legacyError } = await supabase
          .from('leads_lead')
          .select('id, meeting_date, meeting_manager_id')
          .not('meeting_date', 'is', null)
          .gte('meeting_date', threeMonthsAgo)
          .lte('meeting_date', thirtyDaysFromNow)
          .or('status.eq.0,status.is.null') // Filter out inactive leads
          .neq('stage', 91) // Filter out stage 91 (inactive/dropped leads)
          .order('meeting_date', { ascending: true })
          .order('meeting_time', { ascending: true });

        if (legacyError) throw legacyError;

        return { allMeetings, legacyMeetings };
      })();

      const { allMeetings, legacyMeetings } = await Promise.race([queryPromise, timeoutPromise]) as any;

      // Combine all meetings for counting
      const allMeetingsCombined = [
        ...(allMeetings || []).map((m: any) => ({
          id: m.id,
          client_id: m.client_id || (m.legacy_lead as any)?.id || (m.lead as any)?.id,
          meeting_date: m.meeting_date,
          meeting_manager: m.meeting_manager
        })),
        ...(legacyMeetings || []).map((m: any) => ({
          id: `legacy_${m.id}`,
          client_id: m.id,
          meeting_date: m.meeting_date,
          meeting_manager: m.meeting_manager_id
        }))
      ].sort((a, b) => {
        const dateA = new Date(a.meeting_date);
        const dateB = new Date(b.meeting_date);
        return dateA.getTime() - dateB.getTime();
      });

      // Calculate meeting counts per client
      const counts: { [clientId: string]: number } = {};
      const prevManagers: { [meetingId: number]: string } = {};

      allMeetingsCombined.forEach((meeting, index) => {
        const clientId = meeting.client_id;
        if (clientId) {
          counts[clientId] = (counts[clientId] || 0) + 1;

          // Find previous meeting for the same client
          const previousMeeting = allMeetingsCombined
            .slice(0, index)
            .reverse()
            .find(m => m.client_id === clientId);

          if (previousMeeting && previousMeeting.meeting_manager) {
            prevManagers[meeting.id] = previousMeeting.meeting_manager;
          }
        }
      });


      setMeetingCounts(counts);
      setPreviousManagers(prevManagers);
    } catch (error) {
      console.error('Error fetching meeting counts and previous managers:', error);
    }
  };

  const fetchEmployeeAvailability = async () => {
    try {
      const { data: employeesData, error } = await supabase
        .from('tenants_employee')
        .select(`
          id, 
          display_name, 
          unavailable_times, 
          unavailable_ranges,
          bonuses_role,
          department_id,
          photo_url,
          photo,
          tenant_departement!department_id(id, name)
        `)
        .not('unavailable_times', 'is', null);

      if (error) throw error;

      const availabilityMap: { [key: string]: any[] } = {};
      const unavailableMap: { [key: string]: any[] } = {};

      employeesData?.forEach(employee => {
        const departmentName = (employee.tenant_departement as any)?.name || 'N/A';
        const role = getRoleDisplayName(employee.bonuses_role);

        // Process unavailable times (existing functionality)
        if (employee.unavailable_times && Array.isArray(employee.unavailable_times)) {
          employee.unavailable_times.forEach((unavailableTime: any) => {
            const date = unavailableTime.date;
            if (!availabilityMap[date]) {
              availabilityMap[date] = [];
            }
            if (!unavailableMap[date]) {
              unavailableMap[date] = [];
            }

            const timeEntry = {
              employeeId: employee.id,
              employeeName: employee.display_name,
              role: role,
              department: departmentName,
              photo_url: employee.photo_url || null,
              photo: employee.photo || null,
              time: `${unavailableTime.startTime} - ${unavailableTime.endTime}`,
              ...unavailableTime
            };

            availabilityMap[date].push(timeEntry);
            unavailableMap[date].push(timeEntry);
          });
        }

        // Process unavailable ranges (new functionality)
        if (employee.unavailable_ranges && Array.isArray(employee.unavailable_ranges)) {
          employee.unavailable_ranges.forEach((range: any) => {
            const startDate = new Date(range.startDate);
            const endDate = new Date(range.endDate);

            // Generate all dates in the range
            const currentDate = new Date(startDate);
            while (currentDate <= endDate) {
              const dateString = currentDate.toISOString().split('T')[0];

              if (!availabilityMap[dateString]) {
                availabilityMap[dateString] = [];
              }
              if (!unavailableMap[dateString]) {
                unavailableMap[dateString] = [];
              }

              const startDateFormatted = new Date(range.startDate).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: '2-digit'
              });
              const endDateFormatted = new Date(range.endDate).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: '2-digit'
              });

              // Add range as all-day unavailable
              const rangeUnavailable = {
                employeeId: employee.id,
                employeeName: employee.display_name,
                role: role,
                department: departmentName,
                photo_url: employee.photo_url || null,
                photo: employee.photo || null,
                date: `${startDateFormatted} to ${endDateFormatted}`,
                startTime: 'All Day',
                endTime: 'All Day',
                time: 'All Day',
                reason: range.reason,
                isRange: true,
                rangeId: range.id
              };

              availabilityMap[dateString].push(rangeUnavailable);
              unavailableMap[dateString].push(rangeUnavailable);

              // Move to next day
              currentDate.setDate(currentDate.getDate() + 1);
            }
          });
        }
      });

      setEmployeeAvailability(availabilityMap);
      setUnavailableEmployees(unavailableMap);

    } catch (error) {
      console.error('Error fetching employee availability:', error);
    }
  };

  // Get available staff for a specific date and time
  const getAvailableStaffForDateTime = (date: string, time: string) => {
    const unavailableForDate = unavailableEmployees[date] || [];
    const meetingTime = time;

    return availableStaff.filter(staff => {
      // Check if staff is unavailable at this time
      const isUnavailable = unavailableForDate.some(unavailable => {
        if (unavailable.employeeName === staff) {
          const unavailableStart = unavailable.startTime;
          const unavailableEnd = unavailable.endTime;
          return meetingTime >= unavailableStart && meetingTime <= unavailableEnd;
        }
        return false;
      });

      return !isUnavailable;
    });
  };

  // Check if a staff member is unavailable at a specific date and time
  const isStaffUnavailable = (staffName: string, date: string, time: string) => {
    const unavailableForDate = unavailableEmployees[date] || [];
    const result = unavailableForDate.some(unavailable => {
      if (unavailable.employeeName === staffName) {
        // If it's a range (all-day unavailable), always return true
        if (unavailable.isRange || unavailable.startTime === 'All Day') {
          return true;
        }

        // For specific time slots, check time overlap
        const unavailableStart = unavailable.startTime;
        const unavailableEnd = unavailable.endTime;
        const isTimeConflict = time >= unavailableStart && time <= unavailableEnd;

        if (isTimeConflict) {
        }

        return isTimeConflict;
      }
      return false;
    });

    return result;
  };

  // Get unavailable info for a staff member at a specific date and time
  const isNotFirstMeeting = (meeting: any) => {
    // For legacy meetings, check if stage is 55
    if (typeof meeting.id === 'string' && meeting.id.startsWith('legacy_')) {
      const isLegacyStage55 = meeting.lead?.stage === 55;


      return isLegacyStage55;
    }

    // For regular meetings, use the meeting count logic if available
    const clientId = meeting.client_id || (meeting.legacy_lead as any)?.id || (meeting.lead as any)?.id;

    // If meeting counts are loaded, use them
    if (Object.keys(meetingCounts).length > 0) {
      const isNotFirst = clientId && meetingCounts[clientId] > 1;


      return isNotFirst;
    }

    // Fallback: If meeting counts are not loaded, use a simple heuristic
    // Show flame icon for meetings that are not today (likely past meetings)
    const today = new Date().toISOString().split('T')[0];
    const isPastMeeting = meeting.meeting_date && meeting.meeting_date < today;


    return isPastMeeting;
  };

  const getStaffUnavailableInfo = (staffName: string, date: string, time: string) => {
    const unavailableForDate = unavailableEmployees[date] || [];
    const unavailable = unavailableForDate.find(unavailable => {
      if (unavailable.employeeName === staffName) {
        // If it's a range (all-day unavailable), always return true
        if (unavailable.isRange || unavailable.startTime === 'All Day') {
          return true;
        }

        // For specific time slots, check time overlap
        const unavailableStart = unavailable.startTime;
        const unavailableEnd = unavailable.endTime;
        return time >= unavailableStart && time <= unavailableEnd;
      }
      return false;
    });

    return unavailable || null;
  };

  // Format time without seconds
  const formatTime = (timeString: string) => {
    if (!timeString) return 'No time';
    return timeString.slice(0, 5); // Remove seconds (HH:MM:SS -> HH:MM)
  };

  // Get currency symbol helper
  const getLegacyMeetingComplexity = (complexityNumber?: number) => {
    if (complexityNumber === 3) return 'Simple';
    if (complexityNumber === 5) return 'Complex';
    return 'Simple'; // Default to Simple if not specified
  };

  const getLegacyMeetingLocation = (locationId?: number | string) => {
    if (!locationId) {
      return 'N/A';
    }
    // Convert to number if it's a string
    const numericId = typeof locationId === 'string' ? parseInt(locationId, 10) : locationId;
    const location = meetingLocations[numericId];

    // Fallback mapping for common location IDs if meetingLocations is not loaded yet
    if (!location && numericId) {
      const fallbackMap: { [key: number]: string } = {
        1: 'TLV',
        2: 'JRSLM',
        3: 'Office Zoom 4',
        4: 'Office Zoom 6',
        5: 'Zoom - assign later',
        6: 'Zoom - indvidual',
        8: 'TLV with parking',
        9: 'Teams',
        10: 'WhatsApp Video',
        11: 'Phone call',
        12: 'Nirit Flaishman office',
        13: 'Facetime',
        15: 'Office Zoom 7',
        16: 'Google meet-2',
        17: 'Office Zoom 5',
        18: 'e-mail meeting',
        19: 'Office Zoom 1',
        21: 'Office Zoom 2',
        22: 'Office Zoom 3',
        23: 'Google meet-1',
        24: 'Google meet-3',
        25: 'Google meet-4',
        26: 'Google meet-5',
        27: 'Room Meeting 101',
        28: 'Room Meeting 102',
        29: 'Room Meeting 103'
      };
      return fallbackMap[numericId] || `Location ${numericId}`;
    }

    return location || 'N/A';
  };

  // New function to handle both legacy and new meeting locations
  const getMeetingLocationName = (location?: number | string) => {
    if (!location) {
      return 'N/A';
    }

    // If it's already a string name (like "Teams"), return it as is
    if (typeof location === 'string' && !location.match(/^\d+$/)) {
      return location;
    }

    // If it's a numeric ID (number or string that's all digits), map it
    const numericId = typeof location === 'string' ? parseInt(location, 10) : location;

    // First try the meetingLocations state
    const locationFromState = meetingLocations[numericId];
    if (locationFromState) {
      return locationFromState;
    }

    // Fallback mapping for common location IDs
    const fallbackMap: { [key: number]: string } = {
      1: 'TLV',
      2: 'JRSLM',
      3: 'Office Zoom 4',
      4: 'Office Zoom 6',
      5: 'Zoom - assign later',
      6: 'Zoom - indvidual',
      8: 'TLV with parking',
      9: 'Teams',
      10: 'WhatsApp Video',
      11: 'Phone call',
      12: 'Nirit Flaishman office',
      13: 'Facetime',
      15: 'Office Zoom 7',
      16: 'Google meet-2',
      17: 'Office Zoom 5',
      18: 'e-mail meeting',
      19: 'Office Zoom 1',
      21: 'Office Zoom 2',
      22: 'Office Zoom 3',
      23: 'Google meet-1',
      24: 'Google meet-3',
      25: 'Google meet-4',
      26: 'Google meet-5',
      27: 'Room Meeting 101',
      28: 'Room Meeting 102',
      29: 'Room Meeting 103'
    };

    return fallbackMap[numericId] || `Location ${numericId}`;
  };

  const getCalendarTypeBadgeStyles = (calendarType?: string) => {
    if (!calendarType) return null;
    if (calendarType === 'staff') {
      return {
        label: 'Staff',
        backgroundColor: '#fdf5d9',
        textColor: '#a16207',
        borderColor: '#facc15'
      };
    }
    if (calendarType === 'active_client') {
      return {
        label: 'A',
        backgroundColor: '#ffffff',
        textColor: '#15803d',
        borderColor: '#15803d'
      };
    }
    return {
      label: 'P',
      backgroundColor: '#ffffff',
      textColor: '#1d4ed8',
      borderColor: '#1d4ed8'
    };
  };

  // Helper function to check if location is online/teams/zoom
  const isOnlineLocation = (location: string | undefined): boolean => {
    if (!location) return false;
    const locationLower = location.toLowerCase().trim();
    return locationLower === 'online' || locationLower === 'teams' || locationLower === 'zoom';
  };

  const getLegacyCarNumber = (meeting: any) => {
    // For legacy meetings, use meeting_car_no from the lead data
    if (typeof meeting.id === 'string' && meeting.id.startsWith('legacy_')) {
      return meeting.meeting_car_no || null;
    }
    // For regular meetings, use car_number
    return meeting.car_number || null;
  };

  const getCurrencySymbol = (currencyCode?: string) => {
    if (!currencyCode) return '₪';
    const symbols: { [key: string]: string } = {
      'ILS': '₪',
      'NIS': '₪',
      'USD': '$',
      'EUR': '€',
      'GBP': '£'
    };
    return symbols[currencyCode] || currencyCode;
  };

  // Handle dropdown positioning
  const handleDropdownOpen = (meetingId: string | number, type: 'manager' | 'helper', inputRef: HTMLInputElement) => {
    const rect = inputRef.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const estimatedDropdownHeight = 200; // Approximate height of dropdown with max-h-32 (128px) + some padding

    // If there's not enough space below but enough space above, open upward
    const openUpward = spaceBelow < estimatedDropdownHeight && spaceAbove > estimatedDropdownHeight;

    setDropdownPosition({
      x: rect.left,
      y: openUpward
        ? rect.top // For upward: store top position of input (will be used as bottom value)
        : rect.bottom + window.scrollY, // For downward: use top positioning (distance from top of document)
      width: rect.width,
      openUpward: openUpward
    });
    setActiveDropdown({ meetingId, type });
  };

  const handleDropdownClose = () => {
    setActiveDropdown(null);
    setDropdownPosition(null);
  };

  const handleAssignStaff = async (meetingId: string | number, field: 'meeting_manager' | 'helper', value: string) => {
    try {
      // Find the meeting to get the client_id
      const meeting = assignStaffMeetings.find(m => m.id === meetingId);
      if (!meeting) {
        throw new Error('Meeting not found');
      }

      // Check if the staff member is unavailable at this meeting time
      if (value && isStaffUnavailable(value, meeting.meeting_date, meeting.meeting_time)) {
        const unavailableInfo = getStaffUnavailableInfo(value, meeting.meeting_date, meeting.meeting_time);
        const reason = unavailableInfo?.reason ? ` (${unavailableInfo.reason})` : '';
        const type = (unavailableInfo?.isRange || unavailableInfo?.startTime === 'All Day') ? 'all day' : `at ${meeting.meeting_time}`;

        // Show confirmation dialog instead of blocking
        const confirmed = window.confirm(
          `${value} is unavailable ${type} on ${new Date(meeting.meeting_date).toLocaleDateString('en-GB')}${reason}.\n\nThis employee is unavailable for this time. Are you sure to pick him anyway?`
        );

        if (!confirmed) {
          return;
        }
      }

      // Determine if this is a legacy meeting stored in leads_lead (not in meetings table)
      const isLegacyMeetingInLeadsLead = typeof meetingId === 'string' && meetingId.startsWith('legacy_') && !meeting.client_id && meeting.legacy_lead_id;

      // Only update meetings table if the meeting exists in the meetings table (not legacy-only in leads_lead)
      if (!isLegacyMeetingInLeadsLead && typeof meetingId === 'number') {
        const { error: meetingError } = await supabase
          .from('meetings')
          .update({ [field]: value })
          .eq('id', meetingId);

        if (meetingError) throw meetingError;
      }

      // Update the appropriate lead table based on lead type
      if (meeting.lead?.lead_type === 'legacy' || isLegacyMeetingInLeadsLead) {
        // For legacy leads, update leads_lead table
        let leadId: number;
        if (typeof meetingId === 'string' && meetingId.startsWith('legacy_')) {
          // Extract original ID from prefixed ID and convert to number
          const idString = meetingId.replace('legacy_', '');
          leadId = parseInt(idString, 10);
          if (isNaN(leadId)) {
            throw new Error(`Invalid legacy lead ID: ${idString}`);
          }
        } else if (meeting.legacy_lead_id) {
          leadId = typeof meeting.legacy_lead_id === 'number' ? meeting.legacy_lead_id : parseInt(String(meeting.legacy_lead_id), 10);
        } else {
          throw new Error('No legacy lead ID found for legacy meeting');
        }

        // Get employee ID from display name (required for legacy leads)
        // If value is empty string, set to null to clear the assignment
        let employeeId: number | null = null;
        if (value && value.trim() !== '') {
          const employee = allEmployees.find(emp => emp.display_name === value);
          if (employee) {
            employeeId = employee.id;
          } else {
            // Try to find employee in database if not in allEmployees
            const { data: employeeData, error: empError } = await supabase
              .from('tenants_employee')
              .select('id')
              .eq('display_name', value)
              .maybeSingle();

            if (!empError && employeeData) {
              employeeId = employeeData.id;
            } else {
              throw new Error(`Employee not found for display name: ${value}`);
            }
          }
        }
        // If value is empty, employeeId remains null which will clear the assignment

        const updateField = field === 'meeting_manager' ? 'meeting_manager_id' : 'meeting_lawyer_id';

        const { error: leadError } = await supabase
          .from('leads_lead')
          .update({ [updateField]: employeeId })
          .eq('id', leadId);

        if (leadError) throw leadError;
      } else if (meeting.lead?.lead_type === 'new') {
        // For new leads, update leads table
        const leadId = meeting.client_id;
        const updateField = field === 'meeting_manager' ? 'manager' : 'helper';

        const { error: leadError } = await supabase
          .from('leads')
          .update({ [updateField]: value })
          .eq('id', leadId);

        if (leadError) throw leadError;
      }

      // Update local state
      setAssignStaffMeetings(prev =>
        prev.map(m =>
          m.id === meetingId
            ? {
              ...m,
              [field]: value,
              lead: {
                ...m.lead,
                [field === 'meeting_manager' ? 'manager' : 'helper']: value
              }
            }
            : m
        )
      );

      toast.success(`${field === 'meeting_manager' ? 'Manager' : 'Helper'} assigned successfully`);
    } catch (error) {
      console.error('Error assigning staff:', error);
      toast.error('Failed to assign staff');
    }
  };

  const openAssignStaffModal = async () => {
    setIsAssignStaffModalOpen(true);

    // Initialize modal date to today if not set
    const today = new Date().toISOString().split('T')[0];
    if (!modalSelectedDate) {
      setModalSelectedDate(today);
    }

    // Fetch fresh data for the assign staff modal
    // This ensures we have all meetings for the date range (7 days ago to 30 days in the future)
    // regardless of what was loaded on the calendar page
    await fetchAssignStaffData();

    fetchEmployeeAvailability();
    // DISABLED: fetchMeetingCountsAndPreviousManagers(); // causing timeouts
  };

  // Helper function to get available dates from meetings
  const getAvailableDates = () => {
    const dates = [...new Set(assignStaffMeetings.map(m => m.meeting_date))].sort();
    return dates;
  };


  // Helper function to normalize employee value (ID or name) to display name for comparison
  const normalizeEmployeeValue = (value: any): string => {
    if (!value || value === '--' || value === '---') return '--';

    // If it's a number or numeric string, convert to display name
    if (typeof value === 'number' || (typeof value === 'string' && !isNaN(Number(value)))) {
      const displayName = getEmployeeDisplayName(value);
      console.log(`🔍 [normalizeEmployeeValue] Converted ID ${value} to display name:`, displayName);
      return displayName || '--';
    }

    // If it's already a string that's not a number, it might be:
    // 1. A display name (use as-is)
    // 2. A partial name that needs to be matched to an employee
    if (typeof value === 'string') {
      const stringValue = value.trim();

      // Try to find employee by name (case-insensitive partial match)
      const matchingEmployee = allEmployees.find((emp: any) => {
        const empName = emp.display_name || emp.name || '';
        return empName.toLowerCase().includes(stringValue.toLowerCase()) ||
          stringValue.toLowerCase().includes(empName.toLowerCase());
      });

      if (matchingEmployee) {
        const displayName = matchingEmployee.display_name || matchingEmployee.name || stringValue;
        console.log(`🔍 [normalizeEmployeeValue] Matched text "${stringValue}" to employee display name:`, displayName);
        return displayName;
      }

      // If no match found, return as-is (might already be a display name)
      console.log(`🔍 [normalizeEmployeeValue] Using text value as-is (no employee match):`, stringValue);
      return stringValue;
    }

    return String(value);
  };

  // Helper function to filter meetings by date and staff (for assign staff modal)
  const getFilteredMeetings = () => {
    console.log('🔍🔍🔍 [getFilteredMeetings] ⭐⭐ FUNCTION CALLED ⭐⭐');
    console.log('🔍 [getFilteredMeetings] selectedStaffFilter:', selectedStaffFilter);
    console.log('🔍 [getFilteredMeetings] modalSelectedDate:', modalSelectedDate);
    console.log('🔍 [getFilteredMeetings] assignStaffMeetings count:', assignStaffMeetings.length);
    console.log('🔍 [getFilteredMeetings] isAssignStaffModalOpen:', isAssignStaffModalOpen);

    let filtered = assignStaffMeetings.filter(m => m.meeting_date === modalSelectedDate);
    console.log('🔍 [getFilteredMeetings] After date filter:', filtered.length, 'meetings');

    if (selectedStaffFilter) {
      const beforeCount = filtered.length;
      console.log('🔍 [getFilteredMeetings] ⭐ FILTER IS ACTIVE - Filtering by staff:', selectedStaffFilter, 'Total meetings before filter:', beforeCount);

      filtered = filtered.filter((m, index) => {
        const lead = m.lead || {};

        // Debug: Log raw scheduler values
        const rawSchedulerLead = lead.scheduler;
        const rawSchedulerMeeting = m.scheduler;
        const rawSchedulerIdLead = lead.scheduler_id;
        const rawSchedulerIdMeeting = (m as any).scheduler_id;

        console.log(`🔍 [getFilteredMeetings] Meeting ${index} (ID: ${m.id}):`, {
          leadType: lead.lead_type,
          rawSchedulerLead,
          rawSchedulerMeeting,
          rawSchedulerIdLead,
          rawSchedulerIdMeeting,
          leadSchedulerType: typeof rawSchedulerLead,
          meetingSchedulerType: typeof rawSchedulerMeeting,
          fullLead: lead,
          fullMeeting: m
        });

        // Normalize all employee values to display names for consistent comparison
        const normalizedManager = normalizeEmployeeValue(lead.manager || m.meeting_manager);
        const normalizedHelper = normalizeEmployeeValue(lead.helper || m.helper);
        const normalizedScheduler = normalizeEmployeeValue(lead.scheduler || m.scheduler || lead.scheduler_id || (m as any).scheduler_id);
        const normalizedExpert = normalizeEmployeeValue(lead.expert || m.expert);

        console.log(`🔍 [getFilteredMeetings] Meeting ${index} normalized values:`, {
          normalizedManager,
          normalizedHelper,
          normalizedScheduler,
          normalizedExpert,
          selectedStaffFilter
        });

        const matches = (
          normalizedManager === selectedStaffFilter ||
          normalizedHelper === selectedStaffFilter ||
          normalizedScheduler === selectedStaffFilter ||
          normalizedExpert === selectedStaffFilter
        );

        console.log(`🔍 [getFilteredMeetings] Meeting ${index} match result:`, matches);

        return matches;
      });

      console.log('🔍 [getFilteredMeetings] ⭐ FILTER COMPLETE - Filtered meetings count:', filtered.length, 'out of', beforeCount);
    } else {
      console.log('🔍 [getFilteredMeetings] No staff filter selected - showing all meetings for date');
    }

    // Sort by meeting time (earliest first)
    filtered = filtered.sort((a, b) => {
      const timeA = a.meeting_time || '';
      const timeB = b.meeting_time || '';

      // If both have times, compare them
      if (timeA && timeB) {
        return timeA.localeCompare(timeB);
      }

      // If only one has time, prioritize the one with time
      if (timeA && !timeB) return -1;
      if (!timeA && timeB) return 1;

      // If neither has time, keep original order
      return 0;
    });

    return filtered;
  };

  // Helper function to check if selected date has any meetings
  const hasMeetingsForDate = (date: string) => {
    return assignStaffMeetings.some(m => m.meeting_date === date);
  };

  // Reset search states when modal opens/closes
  useEffect(() => {
    if (!isAssignStaffModalOpen) {
      setDropdownStates({});
    }
  }, [isAssignStaffModalOpen]);

  // Refresh employee availability when modal date changes
  useEffect(() => {
    if (isAssignStaffModalOpen && modalSelectedDate) {
      fetchEmployeeAvailability();
    }
  }, [modalSelectedDate, isAssignStaffModalOpen]);

  // Close "More" dropdown and staff assignment dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;

      if (showMoreUnavailableDropdown && !target.closest('.more-unavailable-dropdown')) {
        setShowMoreUnavailableDropdown(false);
      }

      // Only close dropdown if clicking outside both the input and the portal dropdown
      if (activeDropdown && !target.closest('.staff-dropdown-input') && !target.closest('[data-portal-dropdown]')) {
        handleDropdownClose();
      }
    };

    if (showMoreUnavailableDropdown || activeDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showMoreUnavailableDropdown, activeDropdown]);

  // Helper functions to manage dropdown states
  const getMeetingDropdownState = (meetingId: string | number) => {
    return dropdownStates[meetingId] || {
      managerSearch: '',
      helperSearch: '',
      showManagerDropdown: false,
      showHelperDropdown: false
    };
  };

  const updateMeetingDropdownState = (meetingId: string | number, updates: Partial<{
    managerSearch: string;
    helperSearch: string;
    showManagerDropdown: boolean;
    showHelperDropdown: boolean;
  }>) => {
    setDropdownStates(prev => ({
      ...prev,
      [meetingId]: {
        ...getMeetingDropdownState(meetingId),
        ...updates
      }
    }));
  };

  const formatStageLabel = (stageValue: string | number | null | undefined) => {
    if (stageValue === null || stageValue === undefined || stageValue === '') {
      return 'No Stage';
    }

    const raw = String(stageValue).trim();
    const numericCandidate = Number(raw);
    const resolved =
      getStageName(raw) ||
      (!Number.isNaN(numericCandidate) ? getStageName(String(numericCandidate)) : '') ||
      getStageName(raw.toLowerCase());

    if (resolved && resolved.trim()) {
      return resolved;
    }

    return raw
      .replace(/_/g, ' ')
      .replace(/\b\w/g, char => char.toUpperCase());
  };

  // Helper function to get expert status icon and color (small version for card view)
  const getExpertStatusIcon = (lead: any, meeting: any, size: 'small' | 'large' = 'large') => {
    if (meeting.calendar_type === 'staff') {
      return null;
    }

    const sizeClasses = size === 'small'
      ? 'w-5 h-5 rounded-full text-white inline-flex items-center justify-center font-semibold shadow-sm'
      : 'w-10 h-10 rounded-full text-white ml-2 inline-flex items-center justify-center font-semibold shadow-md';
    const iconSize = size === 'small' ? 'w-3 h-3' : 'w-6 h-6';

    // For NEW leads: use eligibility_status field (text values)
    // For LEGACY leads: use expert_examination field (numeric values)
    if (lead.lead_type !== 'legacy') {
      const eligibilityStatus = lead.eligibility_status;

      if (!eligibilityStatus || eligibilityStatus === '') {
        return (
          <span className={`${sizeClasses} bg-gray-400`} title="Expert opinion not checked">
            <QuestionMarkCircleIcon className={iconSize} />
          </span>
        );
      }

      if (eligibilityStatus === 'not_feasible') {
        return (
          <span className={`${sizeClasses} bg-red-500`} title="Not Feasible">
            <XCircleIcon className={iconSize} />
          </span>
        );
      } else if (eligibilityStatus === 'feasible_no_check') {
        return (
          <span className={`${sizeClasses} bg-green-500`} title="Feasible (no check)">
            <CheckCircleIcon className={iconSize} />
          </span>
        );
      } else if (eligibilityStatus === 'feasible_with_check') {
        return (
          <span className={`${sizeClasses} bg-orange-500`} title="Feasible (with check)">
            <ExclamationTriangleIcon className={iconSize} />
          </span>
        );
      }

      return (
        <span className={`${sizeClasses} bg-gray-400`} title="Expert opinion not checked">
          <QuestionMarkCircleIcon className={iconSize} />
        </span>
      );
    }

    // For legacy leads, check expert_examination field with numeric values
    // 0 = Not checked, 1 = Not Feasible, 5 = Feasible (further check), 8 = Feasible (no check)
    const expertExamination = lead.expert_examination;

    if (!expertExamination || expertExamination === 0 || expertExamination === '0') {
      return (
        <span className={`${sizeClasses} bg-gray-400`} title="Expert opinion not checked">
          <QuestionMarkCircleIcon className={iconSize} />
        </span>
      );
    }

    if (expertExamination === 1 || expertExamination === '1') {
      return (
        <span className={`${sizeClasses} bg-red-500`} title="Not Feasible">
          <XCircleIcon className={iconSize} />
        </span>
      );
    } else if (expertExamination === 5 || expertExamination === '5') {
      return (
        <span className={`${sizeClasses} bg-orange-500`} title="Feasible (further check)">
          <ExclamationTriangleIcon className={iconSize} />
        </span>
      );
    } else if (expertExamination === 8 || expertExamination === '8') {
      return (
        <span className={`${sizeClasses} bg-green-500`} title="Feasible (no check)">
          <CheckCircleIcon className={iconSize} />
        </span>
      );
    }

    return (
      <span className={`${sizeClasses} bg-gray-400`} title="Expert opinion status unknown">
        <QuestionMarkCircleIcon className={iconSize} />
      </span>
    );
  };

  // Mobile-friendly meeting card component
  const renderMeetingCard = (meeting: any) => {
    const lead = meeting.lead || {};
    const isExpanded = expandedMeetingId === meeting.id;
    const expandedData = expandedMeetingData[meeting.id] || {};
    const probability = lead.probability ?? meeting.probability;
    // Convert probability to number if it's a string
    const probabilityNumber = typeof probability === 'string' ? parseFloat(probability) : probability;

    // For legacy leads, convert numeric probability to L/M/H/VH format
    const getLegacyProbabilityLetter = (prob: number) => {
      if (prob >= 80) return 'VH';
      if (prob >= 60) return 'H';
      if (prob >= 40) return 'M';
      return 'L';
    };

    let probabilityColor = 'text-red-600';
    if (probabilityNumber >= 80) probabilityColor = 'text-green-600';
    else if (probabilityNumber >= 60) probabilityColor = 'text-yellow-600';
    else if (probabilityNumber >= 40) probabilityColor = 'text-orange-600';

    // Check if meeting should show green indicator:
    // 1. For potential_client: if lead has passed stage 20 (21 and higher) BUT NOT stage 55
    // 2. For active_client: if 2 hours have passed after meeting time
    const hasPassedStage = (() => {
      // For potential_client meetings: check if stage > 20 and stage is not 55
      if (meeting.calendar_type === 'potential_client') {
        const leadStage = lead.stage ? Number(lead.stage) : null;
        const meetingStage = meeting.stage ? Number(meeting.stage) : null;
        const currentStage = leadStage || meetingStage;

        // Stage must be > 20 AND not equal to 55
        return currentStage !== null && currentStage > 20 && currentStage !== 55;
      }

      // For active_client meetings: check if 2 hours have passed after meeting time
      if (meeting.calendar_type === 'active_client' && meeting.meeting_date && meeting.meeting_time) {
        try {
          const meetingDateTime = new Date(`${meeting.meeting_date}T${meeting.meeting_time}`);
          const now = new Date();
          const hoursPassed = (now.getTime() - meetingDateTime.getTime()) / (1000 * 60 * 60);
          return hoursPassed >= 2;
        } catch (error) {
          console.error('Error calculating meeting time:', error);
          return false;
        }
      }

      return false;
    })();

    // Same dark green as meeting time badge for "meeting ended" – bottom-right corner indicator
    const meetingScheduledColor = resolveStageColour('20') || getStageColour('20') || '#10b981';

    return (
      <div
        key={meeting.id}
        className={`rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 border border-gray-100 group flex flex-col justify-between h-full min-h-[340px] relative pb-16 md:text-lg md:leading-relaxed bg-white overflow-hidden ${selectedRowId === meeting.id ? 'ring-2 ring-primary ring-offset-2' : ''}`}
      >
        {/* Bottom-right green corner with white check when meeting ended */}
        {hasPassedStage && (
          <div
            className="absolute right-0 bottom-0 w-14 h-14 z-10 flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, transparent 50%, ${meetingScheduledColor} 50%)` }}
          >
            <CheckCircleIcon className="w-7 h-7 text-white drop-shadow-sm absolute right-1 bottom-1" strokeWidth={2.5} />
          </div>
        )}
        <div
          onClick={(e) => {
            if (meeting.calendar_type !== 'staff' && meeting.lead) {
              e.stopPropagation();
              handleRowSelect(meeting.id);
            } else {
              setExpandedMeetingId(expandedMeetingId === meeting.id ? null : meeting.id);
            }
          }}
          className="flex-1 cursor-pointer flex flex-col relative"
        >
          {/* Header with Name, Badge */}
          <div className="mb-3 flex items-start justify-between gap-2 relative">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-xs md:text-base font-semibold text-gray-400 tracking-widest">
                {meeting.calendar_type === 'staff' ? 'STAFF' : (lead.lead_number || meeting.lead_number)}
              </span>
              <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
              <h3 className="text-xs md:text-sm font-extrabold text-gray-900 group-hover:text-primary transition-colors flex-1 break-words line-clamp-2">{lead.name || meeting.name}</h3>
              {/* Calendar type badge - next to client name */}
              {(() => {
                const badge = getCalendarTypeBadgeStyles(meeting.calendar_type);
                if (!badge) return null;
                return (
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border flex-shrink-0"
                    style={{
                      backgroundColor: badge.backgroundColor,
                      color: badge.textColor,
                      borderColor: badge.borderColor
                    }}
                  >
                    {badge.label}
                  </span>
                );
              })()}
            </div>
          </div>

          {/* Meeting Time and Stage Badge - Same row */}
          {meeting.meeting_time && (() => {
            const textColor = getContrastingTextColor(meetingScheduledColor);
            return (
              <div className="mt-4 mb-3 flex items-center justify-between">
                <div
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
                  style={{
                    backgroundColor: meetingScheduledColor,
                    color: textColor,
                  }}
                >
                  <ClockIcon className="w-4 h-4" />
                  <span className="text-sm font-semibold">
                    {meeting.meeting_time.slice(0, 5)}
                  </span>
                </div>
                <div className="ml-auto">
                  {getStageBadge(lead.stage ?? meeting.stage)}
                </div>
              </div>
            );
          })()}

          <div className="space-y-2 divide-y divide-gray-100">

            {/* Handler - only show for active_client meetings. Fixed w-16 so all employee avatars align across rows. */}
            {meeting.calendar_type === 'active_client' && (
              <div className="flex justify-between items-center py-1">
                <span className="text-xs md:text-base font-semibold text-gray-500">Handler</span>
                <div className="flex flex-col items-center gap-0.5 w-16 flex-shrink-0">
                  {renderEmployeeAvatar(lead.handler_id || lead.handler, 'lg', false)}
                  <span className="text-xs font-bold text-gray-800 text-center leading-tight">
                    {getEmployeeDisplayName(lead.handler || meeting.handler) || '---'}
                  </span>
                </div>
              </div>
            )}

            {/* Manager, Helper - show for potential_client and other non-active_client meetings */}
            {meeting.calendar_type !== 'active_client' && meeting.calendar_type !== 'staff' && (
              <>
                {/* Manager */}
                <div className="flex justify-between items-center py-1">
                  <span className="text-xs md:text-base font-semibold text-gray-500">Manager</span>
                  <div className="flex flex-col items-center gap-0.5 w-16 flex-shrink-0">
                    {renderEmployeeAvatar(lead.manager_id || lead.manager || meeting.meeting_manager_id || meeting.meeting_manager, 'lg', false)}
                    <span className="text-xs font-bold text-gray-800 text-center leading-tight">
                      {getEmployeeDisplayName(lead.manager || meeting.meeting_manager) || '---'}
                    </span>
                  </div>
                </div>

                {/* Helper */}
                <div className="flex justify-between items-center py-1">
                  <span className="text-xs md:text-base font-semibold text-gray-500">Helper</span>
                  <div className="flex flex-col items-center gap-0.5 w-16 flex-shrink-0">
                    {renderEmployeeAvatar(lead.helper_id || lead.helper || meeting.helper, 'lg', false)}
                    <span className="text-xs font-bold text-gray-800 text-center leading-tight">
                      {getEmployeeDisplayName(lead.helper || meeting.helper) || '---'}
                    </span>
                  </div>
                </div>

              </>
            )}

            {/* Staff Meeting Attendees */}
            {meeting.calendar_type === 'staff' && (
              <div className="flex items-center justify-between gap-2 py-1">
                <span className="text-xs md:text-base font-semibold text-gray-500">Attendees</span>
                <div className="text-sm md:text-lg font-bold text-gray-800 break-words text-right">
                  {meeting.meeting_manager || 'No attendees'}
                </div>
              </div>
            )}

            {/* Guest 1 and Guest 2 - show for active_client and potential_client meetings */}
            {(meeting.calendar_type === 'active_client' || meeting.calendar_type === 'potential_client') && (
              <>
                {/* Guest 1 */}
                {meeting.extern1 && meeting.extern1 !== '--' && meeting.extern1 !== '' && (
                  <div className="flex justify-between items-center py-1">
                    <span className="text-xs md:text-base font-semibold text-gray-500">Guest 1</span>
                    <div className="flex flex-col items-center gap-0.5 w-16 flex-shrink-0">
                      {renderEmployeeAvatar(meeting.extern1, 'lg', false)}
                      <span className="text-xs font-bold text-gray-800 text-center leading-tight">
                        {getEmployeeDisplayName(meeting.extern1) || '---'}
                      </span>
                    </div>
                  </div>
                )}
                {/* Guest 2 */}
                {meeting.extern2 && meeting.extern2 !== '--' && meeting.extern2 !== '' && (
                  <div className="flex justify-between items-center py-1">
                    <span className="text-xs md:text-base font-semibold text-gray-500">Guest 2</span>
                    <div className="flex flex-col items-center gap-0.5 w-16 flex-shrink-0">
                      {renderEmployeeAvatar(meeting.extern2, 'lg', false)}
                      <span className="text-xs font-bold text-gray-800 text-center leading-tight">
                        {getEmployeeDisplayName(meeting.extern2) || '---'}
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Category */}
            <div className="flex justify-between items-center py-1">
              <span className="text-xs md:text-base font-semibold text-gray-500">Category</span>
              <span className="text-xs md:text-sm font-bold text-gray-800">{getCategoryName(lead.category_id, lead.category || meeting.category) || 'N/A'}</span>
            </div>

            {/* Amount */}
            <div className="flex justify-between items-center py-1">
              <span className="text-xs md:text-base font-semibold text-gray-500">Value</span>
              <span className="text-sm md:text-lg font-bold text-gray-800">
                {(() => {
                  // Same logic as Clients.tsx balance badge
                  const isLegacy = lead.lead_type === 'legacy' || lead.id?.toString().startsWith('legacy_');
                  let balanceValue: any;

                  if (isLegacy) {
                    // For legacy leads: if currency_id is 1 (NIS/ILS), use total_base; otherwise use total
                    const currencyId = (lead as any).currency_id;
                    let numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
                    if (!numericCurrencyId || isNaN(numericCurrencyId)) {
                      numericCurrencyId = 1; // Default to NIS
                    }
                    if (numericCurrencyId === 1) {
                      balanceValue = (lead as any).total_base ?? null;
                    } else {
                      balanceValue = (lead as any).total ?? null;
                    }
                  } else {
                    balanceValue = lead.balance || (lead as any).proposal_total;
                  }

                  // Currency from join (accounting_currencies) only, same as Clients.tsx total value badge
                  let balanceCurrency = lead.balance_currency || meeting.meeting_currency || 'NIS';

                  // Fallback to meeting amount if no balance
                  if (!balanceValue && meeting.meeting_amount) {
                    balanceValue = meeting.meeting_amount;
                    balanceCurrency = meeting.meeting_currency || balanceCurrency || 'NIS';
                  }

                  if (balanceValue === '--' || meeting.meeting_amount === '--') {
                    return '--';
                  }

                  // Ensure we have a currency (default to NIS)
                  if (!balanceCurrency) {
                    balanceCurrency = 'NIS';
                  }

                  // Handle 0 values - show currency symbol
                  if (balanceValue === 0 || balanceValue === '0' || Number(balanceValue) === 0) {
                    return `${getCurrencySymbol(balanceCurrency)}0`;
                  }

                  if (balanceValue && (Number(balanceValue) > 0 || balanceValue !== '0')) {
                    const formattedValue = typeof balanceValue === 'number'
                      ? balanceValue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
                      : Number(balanceValue).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
                    return `${getCurrencySymbol(balanceCurrency)}${formattedValue}`;
                  }

                  if (typeof meeting.meeting_amount === 'number' && meeting.meeting_amount > 0) {
                    return `${getCurrencySymbol(meeting.meeting_currency || 'NIS')}${meeting.meeting_amount.toLocaleString()}`;
                  }

                  // Default: show 0 with NIS symbol
                  return `${getCurrencySymbol(balanceCurrency)}0`;
                })()}
              </span>
            </div>

            {/* Location */}
            <div className="flex justify-between items-center py-1">
              <span className="text-xs md:text-base font-semibold text-gray-500">Location</span>
              <span className="text-sm md:text-lg font-bold text-gray-800">
                {meeting.location || meeting.meeting_location ||
                  (meeting.meeting_location_id ? getLegacyMeetingLocation(meeting.meeting_location_id) : null) ||
                  'N/A'}
              </span>
            </div>

            {/* Info Column - Probability, Complexity, Car, Flame, Paid marker */}
            <div className="flex justify-between items-center py-1">
              <span className="text-xs md:text-base font-semibold text-gray-500">Info</span>
              <div className="flex items-center gap-2 ml-2">
                {/* Probability Display */}
                {meeting.attendance_probability ? (
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-bold text-gray-800">
                      {meeting.attendance_probability === 'Low' ? 'L' :
                        meeting.attendance_probability === 'Medium' ? 'M' :
                          meeting.attendance_probability === 'High' ? 'H' :
                            meeting.attendance_probability === 'Very High' ? 'VH' :
                              meeting.attendance_probability}
                    </span>
                    {typeof probabilityNumber === 'number' && !isNaN(probabilityNumber) && (
                      <span className="text-xs text-gray-500">({probabilityNumber}%)</span>
                    )}
                  </div>
                ) : typeof probabilityNumber === 'number' && !isNaN(probabilityNumber) ? (
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-bold text-gray-800">
                      {getLegacyProbabilityLetter(probabilityNumber)}
                    </span>
                    <span className="text-xs text-gray-500">({probabilityNumber}%)</span>
                  </div>
                ) : (
                  <span className="text-sm text-gray-500">N/A</span>
                )}

                {/* Complexity Icon */}
                {(meeting.complexity === 'Complex' || getLegacyMeetingComplexity(meeting.meeting_complexity) === 'Complex') && (
                  <BookOpenIcon className="w-5 h-5 text-blue-500" title="Complex meeting" />
                )}

                {/* Car Icon */}
                {(meeting.location?.toLowerCase().includes('tlv with parking') ||
                  meeting.meeting_location?.toLowerCase().includes('tlv with parking')) && (
                    <TruckIcon
                      className="w-5 h-5 text-green-500"
                      title={getLegacyCarNumber(meeting) || "TLV with parking location"}
                    />
                  )}

                {/* Paid meeting indicator based on meeting_collection_id on lead */}
                {((meeting.lead && meeting.lead.meeting_collection_id) ||
                  meeting.legacy_lead?.meeting_collection_id) && (
                    <CurrencyDollarIcon
                      className="w-5 h-5 text-green-600"
                      title={`Paid meeting / ${meeting.meeting_amount
                        ? `${getCurrencySymbol(meeting.meeting_currency || 'NIS')}${meeting.meeting_amount.toLocaleString()}`
                        : 'no amount set'
                        }`}
                    />
                  )}

                {/* Flame Icon */}
                {isNotFirstMeeting(meeting) && (
                  <FireIcon className="w-5 h-5 text-orange-500" title="Another meeting" />
                )}
              </div>
            </div>
          </div>

          {/* Meeting Date (if available) */}
          {lead.meetings && lead.meetings.length > 0 && (
            <div className="mt-3 flex items-center gap-2 text-xs md:text-base text-gray-500">
              <CalendarIcon className="w-4 h-4 md:w-5 md:h-5" />
              <span>Meeting: {lead.meetings[0].meeting_date}</span>
            </div>
          )}
        </div>

        {/* Toggle and Join link - bottom left corner (box view) */}
        <div className="absolute bottom-3 left-3 flex items-center gap-2" onClick={e => e.stopPropagation()}>
          {meeting.calendar_type !== 'staff' && (
            <label className="cursor-pointer" title="Toggle meeting confirmation">
              <input
                type="checkbox"
                className={`toggle toggle-primary toggle-sm ${meetingConfirmationLoadingId === meeting.id ? 'opacity-60' : ''}`}
                checked={getMeetingConfirmationState(meeting)}
                onChange={e => {
                  e.stopPropagation();
                  handleMeetingConfirmationToggle(meeting);
                }}
                disabled={meetingConfirmationLoadingId === meeting.id}
                aria-label="Meeting confirmed"
              />
            </label>
          )}
          {(() => {
            let locationIdNum: number | null = null;
            if (meeting.meeting_location_id) {
              locationIdNum = typeof meeting.meeting_location_id === 'string'
                ? parseInt(meeting.meeting_location_id, 10)
                : (typeof meeting.meeting_location_id === 'number' ? meeting.meeting_location_id : null);
            }
            const locationName = getMeetingLocationName(meeting.meeting_location || meeting.location);
            if (locationIdNum === null && locationName && locationName !== 'N/A') {
              locationIdNum = meetingLocationNameToId[locationName] || null;
            }
            const hasAllowedLocationId = locationIdNum !== null && meetingLocationIdsWithLink.has(locationIdNum);
            const isTeamsWithUrl = locationName && locationName.toLowerCase() === 'teams' && !!meeting.teams_meeting_url;
            const hasCustomLink = !!meeting.custom_link;
            const hasCustomAddress = !!meeting.custom_address;
            const isStaffMeeting = meeting.calendar_type === 'staff';
            return hasAllowedLocationId || isTeamsWithUrl || isStaffMeeting || hasCustomLink || hasCustomAddress;
          })() && (
            <>
              <button
                className="btn btn-outline btn-primary btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  const locationName = getMeetingLocationName(meeting.meeting_location || meeting.location);
                  const defaultLink = meetingLocationLinks[locationName] || '';
                  const url = getValidTeamsLink(meeting.custom_link || meeting.teams_meeting_url || defaultLink);
                  if (url) window.open(url, '_blank');
                  else alert('No meeting URL available');
                }}
                title="Meeting Link"
              >
                <VideoCameraIcon className="w-4 h-4" />
              </button>
              {meeting.custom_address && (
                <button
                  className="btn btn-outline btn-secondary btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedCustomAddress(meeting.custom_address);
                    setIsCustomAddressModalOpen(true);
                  }}
                  title="View Custom Address"
                >
                  <MapPinIcon className="w-4 h-4" />
                </button>
              )}
            </>
          )}
          {/* Add guest plus button - active_client and potential_client only */}
          {(meeting.calendar_type === 'active_client' || meeting.calendar_type === 'potential_client') && (
            <button
              className="btn btn-outline btn-primary btn-sm"
              title="Add Guest"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedMeetingForGuest(meeting);
                const hasGuest1 = meeting.extern1 && meeting.extern1 !== '--' && meeting.extern1 !== '';
                const hasGuest2 = meeting.extern2 && meeting.extern2 !== '--' && meeting.extern2 !== '';
                if (!hasGuest1) {
                  setGuestSelectionType('extern1');
                } else if (!hasGuest2) {
                  setGuestSelectionType('extern2');
                } else {
                  setGuestSelectionType('extern1');
                }
                setIsGuestSelectionModalOpen(true);
              }}
            >
              <PlusIcon className="w-4 h-4" />
            </button>
          )}
          <button
            className="btn btn-ghost btn-circle btn-sm text-primary"
            title={isExpanded ? 'Hide Details' : 'Show More'}
            aria-label={isExpanded ? 'Hide Details' : 'Show More'}
            onClick={(e) => {
              e.stopPropagation();
              setExpandedMeetingId(expandedMeetingId === meeting.id ? null : meeting.id);
            }}
          >
            <ChevronDownIcon className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Show edit button for staff meetings (at bottom) */}
        {meeting.calendar_type === 'staff' && (
          <div className="mt-4 flex flex-row gap-2 justify-end items-center">
            <button
              className="btn btn-outline btn-warning btn-sm"
              title="Edit Staff Meeting"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedStaffMeeting(meeting);
                setIsStaffMeetingEditModalOpen(true);
              }}
            >
              <PencilIcon className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Expanded Details */}
        {isExpanded && (
          <div className="mt-4 p-4 border-t border-gray-100 bg-gray-50 rounded-lg">
            {expandedData.loading ? (
              <div className="flex justify-center items-center py-4">
                <span className="loading loading-spinner loading-md"></span>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-white p-4 rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <h6 className="font-semibold text-base text-gray-800">Expert Notes</h6>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedMeetingForNotes(meeting);
                        setIsNotesModalOpen(true);
                      }}
                      className="btn btn-sm btn-outline btn-primary"
                    >
                      View All
                    </button>
                  </div>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {Array.isArray(expandedData.expert_notes) && expandedData.expert_notes.length > 0 ? (
                      <>
                        {expandedData.expert_notes.slice(0, 2).map((note: any) => (
                          <div key={note.id} className="bg-gray-50 p-3 rounded text-sm">
                            <div className="flex items-center gap-1 text-gray-500 mb-1">
                              <ClockIcon className="w-4 h-4" />
                              <span className="text-sm">{note.timestamp}</span>
                            </div>
                            <p className="text-gray-700 whitespace-pre-wrap line-clamp-2">{note.content}</p>
                          </div>
                        ))}
                        {expandedData.expert_notes.length > 2 && (
                          <p className="text-sm text-gray-500 italic">+{expandedData.expert_notes.length - 2} more notes</p>
                        )}
                      </>
                    ) : (
                      <p className="text-base text-gray-500">
                        {expandedData.expert_notes || 'No expert notes yet.'}
                      </p>
                    )}
                  </div>
                </div>
                <div className="bg-white p-4 rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <h6 className="font-semibold text-base text-gray-800">Handler Notes</h6>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedMeetingForNotes(meeting);
                        setIsNotesModalOpen(true);
                      }}
                      className="btn btn-sm btn-outline btn-primary"
                    >
                      View All
                    </button>
                  </div>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {Array.isArray(expandedData.handler_notes) && expandedData.handler_notes.length > 0 ? (
                      <>
                        {expandedData.handler_notes.slice(0, 2).map((note: any) => (
                          <div key={note.id} className="bg-gray-50 p-3 rounded text-sm">
                            <div className="flex items-center gap-1 text-gray-500 mb-1">
                              <ClockIcon className="w-4 h-4" />
                              <span className="text-sm">{note.timestamp}</span>
                            </div>
                            <p className="text-gray-700 whitespace-pre-wrap line-clamp-2">{note.content}</p>
                          </div>
                        ))}
                        {expandedData.handler_notes.length > 2 && (
                          <p className="text-sm text-gray-500 italic">+{expandedData.handler_notes.length - 2} more notes</p>
                        )}
                      </>
                    ) : (
                      <p className="text-base text-gray-500">
                        {expandedData.handler_notes || 'No handler notes yet.'}
                      </p>
                    )}
                  </div>
                </div>
                <div className="bg-white p-4 rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <h6 className="font-semibold text-base text-gray-800">Facts of Case</h6>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedMeetingForNotes(meeting);
                        setIsNotesModalOpen(true);
                      }}
                      className="btn btn-sm btn-outline btn-primary"
                    >
                      View All
                    </button>
                  </div>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {expandedData.facts ? (
                      <p className="text-base text-gray-700 whitespace-pre-wrap line-clamp-3">{expandedData.facts}</p>
                    ) : (
                      <p className="text-base text-gray-500">No facts of case available.</p>
                    )}
                  </div>
                </div>
                {meeting.calendar_type !== 'staff' && (
                  <div className="bg-white p-3 rounded-lg">
                    <h6 className="font-semibold text-gray-800 mb-2">Staff</h6>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-600">Scheduler:</span>
                      <div className="flex flex-col items-center gap-0.5 w-16 flex-shrink-0">
                        {renderEmployeeAvatar(lead.scheduler_id || lead.scheduler || meeting.scheduler, 'lg', false)}
                        <span className="text-xs text-gray-800 font-medium text-center leading-tight">
                          {getEmployeeDisplayName(lead.scheduler || meeting.scheduler) || '---'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // Desktop table row component (for department tables)
  const renderMeetingRow = (meeting: any) => {
    const lead = meeting.lead || {};
    const isExpanded = expandedMeetingId === meeting.id;
    const expandedData = expandedMeetingData[meeting.id] || {};
    const probability = lead.probability ?? meeting.probability;
    // Convert probability to number if it's a string
    const probabilityNumber = typeof probability === 'string' ? parseFloat(probability) : probability;
    let probabilityColor = 'text-red-600';
    if (probabilityNumber >= 80) probabilityColor = 'text-green-600';
    else if (probabilityNumber >= 60) probabilityColor = 'text-yellow-600';
    else if (probabilityNumber >= 40) probabilityColor = 'text-orange-600';

    // Check if meeting should show green indicator:
    // 1. For potential_client: if lead has passed stage 20 (21 and higher) BUT NOT stage 55
    // 2. For active_client: if 2 hours have passed after meeting time
    const hasPassedStage = (() => {
      // For potential_client meetings: check if stage > 20 and stage is not 55
      if (meeting.calendar_type === 'potential_client') {
        const leadStage = lead.stage ? Number(lead.stage) : null;
        const meetingStage = meeting.stage ? Number(meeting.stage) : null;
        const currentStage = leadStage || meetingStage;

        // Stage must be > 20 AND not equal to 55
        return currentStage !== null && currentStage > 20 && currentStage !== 55;
      }

      // For active_client meetings: check if 2 hours have passed after meeting time
      if (meeting.calendar_type === 'active_client' && meeting.meeting_date && meeting.meeting_time) {
        try {
          const meetingDateTime = new Date(`${meeting.meeting_date}T${meeting.meeting_time}`);
          const now = new Date();
          const hoursPassed = (now.getTime() - meetingDateTime.getTime()) / (1000 * 60 * 60);
          return hoursPassed >= 2;
        } catch (error) {
          console.error('Error calculating meeting time:', error);
          return false;
        }
      }

      return false;
    })();

    return (
      <React.Fragment key={meeting.id}>
        <tr
          className={`relative z-10 bg-white hover:bg-base-200/50 ${selectedRowId === meeting.id ? 'bg-primary/5 ring-2 ring-primary ring-offset-1' : ''} ${hasPassedStage ? 'border-l-4 border-l-green-500' : ''}`}
          onClick={() => {
            if (meeting.calendar_type !== 'staff' && meeting.lead) {
              handleRowSelect(meeting.id);
            }
          }}
          style={{ cursor: meeting.calendar_type !== 'staff' && meeting.lead ? 'pointer' : 'default' }}
        >
          {/* TYPE Column - fixed-width icon slot so badge is always aligned */}
          <td className="w-10">
            <div className="flex items-center gap-1 sm:gap-2">
              <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
                {hasPassedStage ? <CheckCircleIcon className="w-4 h-4 sm:w-5 sm:h-5 text-green-500" /> : null}
              </span>
              <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-bold border whitespace-nowrap" style={{
                backgroundColor: getCalendarTypeBadgeStyles(meeting.calendar_type)?.backgroundColor,
                color: getCalendarTypeBadgeStyles(meeting.calendar_type)?.textColor,
                borderColor: getCalendarTypeBadgeStyles(meeting.calendar_type)?.borderColor
              }}>
                {getCalendarTypeBadgeStyles(meeting.calendar_type)?.label || meeting.calendar_type}
              </span>
            </div>
          </td>

          {/* Time Column - Second */}
          <td className="text-sm sm:text-base">
            <span
              className="inline-flex items-center px-2 py-1 rounded-md text-white font-medium"
              style={{ backgroundColor: 'rgb(25, 49, 31)' }}
            >
              {meeting.meeting_time ? meeting.meeting_time.slice(0, 5) : ''}
            </span>
          </td>
          {/* Lead Column - Second */}
          <td className="font-bold">
            <div className="flex items-center gap-1 sm:gap-2">
              {meeting.calendar_type === 'staff' ? (
                <>
                  <span className="text-black text-sm sm:text-base break-words line-clamp-2">
                    {lead.name || meeting.name}
                  </span>
                </>
              ) : (
                <>
                  <div className="flex flex-col min-w-0 flex-1">
                    <Link
                      to={buildClientRoute(lead)}
                      className="hover:opacity-80 text-sm sm:text-base break-words line-clamp-2"
                      style={{ color: '#3b28c7' }}
                    >
                      {lead.name || meeting.name}
                    </Link>
                    <span className="text-xs sm:text-sm text-gray-500 font-semibold whitespace-nowrap">
                      ({lead.lead_number || meeting.lead_number})
                    </span>
                  </div>
                </>
              )}
            </div>
          </td>
          {/* Category Column */}
          <td className="text-xs sm:text-sm">
            {getCategoryName(lead.category_id, lead.category || meeting.category) || 'N/A'}
          </td>
          {/* Value Column - Third */}
          <td className="text-sm sm:text-base">
            {(() => {
              // Same logic as Clients.tsx balance badge
              const isLegacy = lead.lead_type === 'legacy' || lead.id?.toString().startsWith('legacy_');
              let balanceValue: any;

              if (isLegacy) {
                // For legacy leads: if currency_id is 1 (NIS/ILS), use total_base; otherwise use total
                const currencyId = (lead as any).currency_id;
                let numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
                if (!numericCurrencyId || isNaN(numericCurrencyId)) {
                  numericCurrencyId = 1; // Default to NIS
                }
                if (numericCurrencyId === 1) {
                  balanceValue = (lead as any).total_base ?? null;
                } else {
                  balanceValue = (lead as any).total ?? null;
                }
              } else {
                balanceValue = lead.balance || (lead as any).proposal_total;
              }

              // Currency from join (accounting_currencies) only, same as Clients.tsx total value badge
              let balanceCurrency = lead.balance_currency || meeting.meeting_currency || 'NIS';

              // Fallback to meeting amount if no balance
              if (!balanceValue && meeting.meeting_amount) {
                balanceValue = meeting.meeting_amount;
                balanceCurrency = meeting.meeting_currency || balanceCurrency || 'NIS';
              }

              if (balanceValue === '--' || meeting.meeting_amount === '--') {
                return '--';
              }

              // Ensure we have a currency (default to NIS)
              if (!balanceCurrency) {
                balanceCurrency = 'NIS';
              }

              // Handle 0 values - show currency symbol
              if (balanceValue === 0 || balanceValue === '0' || Number(balanceValue) === 0) {
                return `${getCurrencySymbol(balanceCurrency)}0`;
              }

              if (balanceValue && (Number(balanceValue) > 0 || balanceValue !== '0')) {
                const formattedValue = typeof balanceValue === 'number'
                  ? balanceValue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
                  : Number(balanceValue).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
                return `${getCurrencySymbol(balanceCurrency)}${formattedValue}`;
              }

              if (typeof meeting.meeting_amount === 'number' && meeting.meeting_amount > 0) {
                return `${getCurrencySymbol(meeting.meeting_currency || 'NIS')}${meeting.meeting_amount.toLocaleString()}`;
              }

              // Default: show 0 with NIS symbol
              return `${getCurrencySymbol(balanceCurrency)}0`;
            })()}
          </td>
          {/* Participants Column - Fourth: fixed width so employee avatars align across all rows */}
          <td className="w-20 min-w-[5rem]">
            {meeting.calendar_type === 'staff' ? (
              <div className="max-w-xs">
                <div className="text-xs font-medium text-gray-700">Attendees:</div>
                <div className="text-xs font-semibold text-gray-800 break-words">
                  {meeting.meeting_manager || 'No attendees'}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2 py-1">
                {/* Handler - only show for active_client meetings */}
                {meeting.calendar_type === 'active_client' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 flex-shrink-0" style={{ writingMode: 'vertical-rl' }}>Handler</span>
                    <div className="hidden md:flex flex-col items-center gap-0.5 w-14 flex-shrink-0">
                      {renderEmployeeAvatar(lead.handler_id || lead.handler, 'lg', false)}
                      <span className="text-xs text-center leading-tight">{getEmployeeDisplayName(lead.handler || meeting.handler)}</span>
                    </div>
                    <span className="md:hidden text-xs">{getEmployeeDisplayName(lead.handler || meeting.handler)}</span>
                  </div>
                )}
                {/* Manager, Helper - show for potential_client and other non-active_client meetings */}
                {meeting.calendar_type !== 'active_client' && meeting.calendar_type !== 'staff' && (
                  <>
                    {/* Manager */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 flex-shrink-0" style={{ writingMode: 'vertical-rl' }}>Manager</span>
                      <div className="hidden md:flex flex-col items-center gap-0.5 w-14 flex-shrink-0">
                        {renderEmployeeAvatar(lead.manager_id || lead.manager || meeting.meeting_manager_id || meeting.meeting_manager, 'lg', false)}
                        <span className="text-xs text-center leading-tight">{getEmployeeDisplayName(lead.manager || meeting.meeting_manager)}</span>
                      </div>
                      <span className="md:hidden text-xs">{getEmployeeDisplayName(lead.manager || meeting.meeting_manager)}</span>
                    </div>
                    {/* Helper - only show if helper exists and is not "--" */}
                    {(() => {
                      const helperId = lead.helper_id || lead.helper || meeting.helper;
                      return helperId && helperId !== '--' && helperId !== 'N/A' && helperId !== 'Not_assigned' && helperId !== '---';
                    })() && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 flex-shrink-0" style={{ writingMode: 'vertical-rl' }}>Helper</span>
                          <div className="hidden md:flex flex-col items-center gap-0.5 w-14 flex-shrink-0">
                            {renderEmployeeAvatar(lead.helper_id || lead.helper || meeting.helper, 'lg', false)}
                            <span className="text-xs text-center leading-tight">{getEmployeeDisplayName(lead.helper || meeting.helper)}</span>
                          </div>
                          <span className="md:hidden text-xs">{getEmployeeDisplayName(lead.helper || meeting.helper)}</span>
                        </div>
                      )}
                  </>
                )}
                {/* Guest 1 and Guest 2 - show for active_client and potential_client meetings */}
                {(meeting.calendar_type === 'active_client' || meeting.calendar_type === 'potential_client') && (
                  <>
                    {/* Guest 1 */}
                    {meeting.extern1 && meeting.extern1 !== '--' && meeting.extern1 !== '' && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 flex-shrink-0" style={{ writingMode: 'vertical-rl' }}>Guest 1</span>
                        <div className="hidden md:flex flex-col items-center gap-0.5 w-14 flex-shrink-0">
                          {renderEmployeeAvatar(meeting.extern1, 'lg', false)}
                          <span className="text-xs text-center leading-tight">{getEmployeeDisplayName(meeting.extern1)}</span>
                        </div>
                        <span className="md:hidden text-xs">{getEmployeeDisplayName(meeting.extern1)}</span>
                      </div>
                    )}
                    {/* Guest 2 */}
                    {meeting.extern2 && meeting.extern2 !== '--' && meeting.extern2 !== '' && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 flex-shrink-0" style={{ writingMode: 'vertical-rl' }}>Guest 2</span>
                        <div className="hidden md:flex flex-col items-center gap-0.5 w-14 flex-shrink-0">
                          {renderEmployeeAvatar(meeting.extern2, 'lg', false)}
                          <span className="text-xs text-center leading-tight">{getEmployeeDisplayName(meeting.extern2)}</span>
                        </div>
                        <span className="md:hidden text-xs">{getEmployeeDisplayName(meeting.extern2)}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </td>
          <td className="text-sm sm:text-base">{meeting.calendar_type === 'staff' ? meeting.meeting_location : (meeting.meeting_location === '--' ? '--' : (meeting.location || meeting.meeting_location || getLegacyMeetingLocation(meeting.meeting_location_id) || 'N/A'))}</td>
          <td className="text-sm sm:text-base">{meeting.custom_address || '--'}</td>
          <td>
            <div className="flex items-center justify-center">
              {getStageBadge(lead.stage ?? meeting.stage)}
            </div>
          </td>
          <td>
            <div className="flex flex-row items-center gap-1 sm:gap-2">
              {meeting.calendar_type !== 'staff' && (
                <label
                  className="cursor-pointer"
                  onClick={e => e.stopPropagation()}
                  title="Toggle meeting confirmation"
                >
                  <input
                    type="checkbox"
                    className={`toggle toggle-primary toggle-xs sm:toggle-sm ${meetingConfirmationLoadingId === meeting.id ? 'opacity-60' : ''}`}
                    checked={getMeetingConfirmationState(meeting)}
                    onChange={e => {
                      e.stopPropagation();
                      handleMeetingConfirmationToggle(meeting);
                    }}
                    disabled={meetingConfirmationLoadingId === meeting.id}
                    aria-label="Meeting confirmed"
                  />
                </label>
              )}
              {/* Only show join button if location ID is in the allowed list from SQL file, OR if it's Teams with teams_meeting_url */}
              {(() => {
                // Get location ID - try meeting_location_id first (for legacy leads), then look up by name
                let locationIdNum: number | null = null;
                if (meeting.meeting_location_id) {
                  locationIdNum = typeof meeting.meeting_location_id === 'string'
                    ? parseInt(meeting.meeting_location_id, 10)
                    : (typeof meeting.meeting_location_id === 'number' ? meeting.meeting_location_id : null);
                }
                // If no ID, try to look up by location name
                const locationName = getMeetingLocationName(meeting.meeting_location || meeting.location);
                if (locationIdNum === null && locationName && locationName !== 'N/A') {
                  locationIdNum = meetingLocationNameToId[locationName] || null;
                }

                // Check if location ID is in the allowed list
                const hasAllowedLocationId = locationIdNum !== null && meetingLocationIdsWithLink.has(locationIdNum);

                // Also show for Teams meetings that have a teams_meeting_url
                const isTeamsWithUrl = locationName && locationName.toLowerCase() === 'teams' && !!meeting.teams_meeting_url;
                const hasCustomLink = !!meeting.custom_link;
                const hasCustomAddress = !!meeting.custom_address;

                // Also show for staff meetings (they have teams_meeting_url)
                const isStaffMeeting = meeting.calendar_type === 'staff';

                return hasAllowedLocationId || isTeamsWithUrl || isStaffMeeting || hasCustomLink || hasCustomAddress;
              })() && (
                  <>
                    <button
                      className="btn btn-primary btn-xs sm:btn-sm"
                      onClick={() => {
                        // Use custom_link first, then teams/default links
                        const locationName = getMeetingLocationName(meeting.meeting_location || meeting.location);
                        const defaultLink = meetingLocationLinks[locationName] || '';
                        const url = getValidTeamsLink(meeting.custom_link || meeting.teams_meeting_url || defaultLink);
                        if (url) {
                          window.open(url, '_blank');
                        } else {
                          alert('No meeting URL available');
                        }
                      }}
                      title="Meeting Link"
                    >
                      <VideoCameraIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                    </button>
                    {meeting.custom_address && (
                      <button
                        className="btn btn-outline btn-secondary btn-xs sm:btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCustomAddress(meeting.custom_address);
                          setIsCustomAddressModalOpen(true);
                        }}
                        title="View Custom Address"
                      >
                        <MapPinIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                      </button>
                    )}
                  </>
                )}
              {/* Show edit button for staff meetings */}
              {meeting.calendar_type === 'staff' && (
                <button
                  className="btn btn-warning btn-xs sm:btn-sm"
                  title="Edit Staff Meeting"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedStaffMeeting(meeting);
                    setIsStaffMeetingEditModalOpen(true);
                  }}
                >
                  <PencilIcon className="w-4 h-4" />
                </button>
              )}
              {/* Add guest button for active_client and potential_client meetings */}
              {(meeting.calendar_type === 'active_client' || meeting.calendar_type === 'potential_client') && (
                <button
                  className="btn btn-outline btn-primary btn-xs sm:btn-sm"
                  title="Add Guest"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedMeetingForGuest(meeting);
                    // Determine which guest slot to fill (extern1 or extern2)
                    const hasGuest1 = meeting.extern1 && meeting.extern1 !== '--' && meeting.extern1 !== '';
                    const hasGuest2 = meeting.extern2 && meeting.extern2 !== '--' && meeting.extern2 !== '';
                    if (!hasGuest1) {
                      setGuestSelectionType('extern1');
                    } else if (!hasGuest2) {
                      setGuestSelectionType('extern2');
                    } else {
                      // Both slots filled, allow replacing either
                      setGuestSelectionType('extern1'); // Default to Guest 1
                    }
                    setIsGuestSelectionModalOpen(true);
                  }}
                >
                  <PlusIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                </button>
              )}
              <button
                className="btn btn-ghost btn-circle btn-xs sm:btn-sm text-primary"
                title={isExpanded ? 'Hide Details' : 'Show More'}
                aria-label={isExpanded ? 'Hide Details' : 'Show More'}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedMeetingId(expandedMeetingId === meeting.id ? null : meeting.id);
                }}
              >
                <ChevronDownIcon className={`w-4 h-4 sm:w-5 sm:h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
              </button>
            </div>
          </td>
        </tr>

        {/* Expanded Details Row */}
        {
          isExpanded && (
            <tr>
              <td colSpan={9} className="p-0">
                <div className="bg-base-100/50 p-4 border-t border-base-200">
                  {expandedData.loading ? (
                    <div className="flex justify-center items-center py-4">
                      <span className="loading loading-spinner loading-md"></span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Staff */}
                      {meeting.calendar_type !== 'staff' && (
                        <div className="bg-base-200/50 p-4 rounded-lg">
                          <h5 className="font-semibold text-base text-base-content/90 mb-3">Staff</h5>
                          <div className="space-y-3">
                            <div className="flex items-center gap-2">
                              <span className="text-base text-base-content/70">Scheduler:</span>
                              <div className="flex items-center gap-2">
                                {renderEmployeeAvatar(lead.scheduler_id || lead.scheduler || meeting.scheduler, 'sm', false)}
                                <span className="text-base text-base-content/90 font-medium">
                                  {getEmployeeDisplayName(lead.scheduler || meeting.scheduler) || '---'}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-base text-base-content/70">Expert:</span>
                              <div className="flex items-center gap-2">
                                {renderEmployeeAvatar(lead.expert_id || lead.expert || meeting.expert, 'sm', false)}
                                <span className="text-base text-base-content/90 font-medium">
                                  {(() => {
                                    const expertId = lead.expert_id || meeting.expert_id || meeting.expert;
                                    const expertDisplayName = expertId ? getEmployeeDisplayName(expertId) : null;
                                    if (expertDisplayName && expertDisplayName !== expertId?.toString() && expertDisplayName !== '--') {
                                      return expertDisplayName;
                                    }
                                    return lead.expert && typeof lead.expert === 'string' && isNaN(Number(lead.expert))
                                      ? lead.expert
                                      : (expertDisplayName || '---');
                                  })()}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {/* Info */}
                      <div className="bg-base-200/50 p-5 rounded-lg">
                        <h5 className="font-semibold text-lg text-base-content/90 mb-3">Info</h5>
                        <div className="flex flex-col gap-3">
                          {/* Expert Opinion Status */}
                          {meeting.calendar_type !== 'staff' && (() => {
                            // For NEW leads: use eligibility_status field (text values)
                            // For LEGACY leads: use expert_examination field (numeric values)
                            if (lead.lead_type !== 'legacy') {
                              const eligibilityStatus = lead.eligibility_status;

                              if (!eligibilityStatus || eligibilityStatus === '') {
                                return (
                                  <div className="flex items-center gap-2">
                                    <span className="w-7 h-7 rounded-full bg-gray-400 text-white inline-flex items-center justify-center font-semibold shadow-sm" title="Expert opinion not checked">
                                      <QuestionMarkCircleIcon className="w-5 h-5" />
                                    </span>
                                    <span className="text-base">Expert opinion not checked</span>
                                  </div>
                                );
                              }

                              if (eligibilityStatus === 'not_feasible') {
                                return (
                                  <div className="flex items-center gap-2">
                                    <span className="w-7 h-7 rounded-full bg-red-500 text-white inline-flex items-center justify-center font-semibold shadow-sm" title="Not Feasible">
                                      <XCircleIcon className="w-5 h-5" />
                                    </span>
                                    <span className="text-base">Not Feasible</span>
                                  </div>
                                );
                              } else if (eligibilityStatus === 'feasible_no_check') {
                                return (
                                  <div className="flex items-center gap-2">
                                    <span className="w-7 h-7 rounded-full bg-green-500 text-white inline-flex items-center justify-center font-semibold shadow-sm" title="Feasible (no check)">
                                      <CheckCircleIcon className="w-5 h-5" />
                                    </span>
                                    <span className="text-base">Feasible (no check)</span>
                                  </div>
                                );
                              } else if (eligibilityStatus === 'feasible_with_check') {
                                return (
                                  <div className="flex items-center gap-2">
                                    <span className="w-7 h-7 rounded-full bg-orange-500 text-white inline-flex items-center justify-center font-semibold shadow-sm" title="Feasible (with check)">
                                      <ExclamationTriangleIcon className="w-5 h-5" />
                                    </span>
                                    <span className="text-base">Feasible (with check)</span>
                                  </div>
                                );
                              }

                              return (
                                <div className="flex items-center gap-2">
                                  <span className="w-5 h-5 rounded-full bg-gray-400 text-white inline-flex items-center justify-center font-semibold shadow-sm" title="Expert opinion not checked">
                                    <QuestionMarkCircleIcon className="w-3 h-3" />
                                  </span>
                                  <span className="text-sm">Expert opinion not checked</span>
                                </div>
                              );
                            }

                            const expertExamination = lead.expert_examination;

                            if (!expertExamination || expertExamination === 0 || expertExamination === '0') {
                              return (
                                <div className="flex items-center gap-2">
                                  <span className="w-5 h-5 rounded-full bg-gray-400 text-white inline-flex items-center justify-center font-semibold shadow-sm" title="Expert opinion not checked">
                                    <QuestionMarkCircleIcon className="w-3 h-3" />
                                  </span>
                                  <span className="text-sm">Expert opinion not checked</span>
                                </div>
                              );
                            }

                            if (expertExamination === 1 || expertExamination === '1') {
                              return (
                                <div className="flex items-center gap-2">
                                  <span className="w-7 h-7 rounded-full bg-red-500 text-white inline-flex items-center justify-center font-semibold shadow-sm" title="Not Feasible">
                                    <XCircleIcon className="w-5 h-5" />
                                  </span>
                                  <span className="text-sm">Not Feasible</span>
                                </div>
                              );
                            } else if (expertExamination === 5 || expertExamination === '5') {
                              return (
                                <div className="flex items-center gap-2">
                                  <span className="w-7 h-7 rounded-full bg-orange-500 text-white inline-flex items-center justify-center font-semibold shadow-sm" title="Feasible (further check)">
                                    <ExclamationTriangleIcon className="w-5 h-5" />
                                  </span>
                                  <span className="text-base">Feasible (further check)</span>
                                </div>
                              );
                            } else if (expertExamination === 8 || expertExamination === '8') {
                              return (
                                <div className="flex items-center gap-2">
                                  <span className="w-7 h-7 rounded-full bg-green-500 text-white inline-flex items-center justify-center font-semibold shadow-sm" title="Feasible (no check)">
                                    <CheckCircleIcon className="w-5 h-5" />
                                  </span>
                                  <span className="text-sm">Feasible (no check)</span>
                                </div>
                              );
                            }

                            return (
                              <div className="flex items-center gap-2">
                                <span className="w-7 h-7 rounded-full bg-gray-400 text-white inline-flex items-center justify-center font-semibold shadow-sm" title="Expert opinion status unknown">
                                  <QuestionMarkCircleIcon className="w-5 h-5" />
                                </span>
                                <span className="text-base">Expert opinion status unknown</span>
                              </div>
                            );
                          })()}
                          {isNotFirstMeeting(meeting) && (
                            <div className="flex items-center gap-2">
                              <FireIcon className="w-5 h-5 text-orange-500" />
                              <span className="text-base">Another meeting</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <span className={`font-bold text-base ${probabilityColor}`}>
                              {(() => {
                                if (meeting.attendance_probability && ['Low', 'Medium', 'High', 'Very High'].includes(meeting.attendance_probability)) {
                                  return meeting.attendance_probability;
                                }
                                else if (typeof probabilityNumber === 'number' && !isNaN(probabilityNumber)) {
                                  if (probabilityNumber >= 80) return 'Very High';
                                  else if (probabilityNumber >= 60) return 'High';
                                  else if (probabilityNumber >= 40) return 'Medium';
                                  else return 'Low';
                                }
                                return 'N/A';
                              })()}
                              {typeof probabilityNumber === 'number' && !isNaN(probabilityNumber) ? ` (${probabilityNumber}%)` : ''}
                            </span>
                          </div>
                          {((meeting.location || meeting.meeting_location || getLegacyMeetingLocation(meeting.meeting_location_id))?.toLowerCase().includes('tlv with parking')) && (
                            <div className="flex items-center gap-2">
                              <TruckIcon className="w-5 h-5 text-blue-600" />
                              <span className="text-base">{getLegacyCarNumber(meeting) ? `Car: ${getLegacyCarNumber(meeting)}` : 'TLV with parking'}</span>
                            </div>
                          )}
                          {((meeting.lead && meeting.lead.meeting_collection_id) || meeting.legacy_lead?.meeting_collection_id) && (
                            <div className="flex items-center gap-2">
                              <CurrencyDollarIcon className="w-5 h-5 text-green-600" />
                              <span className="text-base">Paid meeting</span>
                            </div>
                          )}
                          {(meeting.complexity === 'Complex' || getLegacyMeetingComplexity(meeting.meeting_complexity) === 'Complex') && (
                            <div className="flex items-center gap-2">
                              <BookOpenIcon className="w-5 h-5 text-purple-600" />
                              <span className="text-base">Complex</span>
                            </div>
                          )}
                        </div>
                      </div>
                      {/* Notes */}
                      <div className="bg-base-200/50 p-5 rounded-lg">
                        <div className="flex items-center justify-between mb-3">
                          <h5 className="font-semibold text-lg text-base-content/90">Notes</h5>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedMeetingForNotes(meeting);
                              setIsNotesModalOpen(true);
                            }}
                            className="btn btn-sm btn-outline btn-primary"
                          >
                            View All
                          </button>
                        </div>
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                          {Array.isArray(expandedData.expert_notes) && expandedData.expert_notes.length > 0 ? (
                            <div>
                              <h6 className="text-sm font-semibold text-base-content/70 mb-2">Expert Notes</h6>
                              {expandedData.expert_notes.slice(0, 2).map((note: any) => (
                                <div key={note.id} className="bg-base-200 p-2 rounded text-sm mb-1">
                                  <p className="text-base-content/90 whitespace-pre-wrap line-clamp-2">{note.content}</p>
                                </div>
                              ))}
                              {expandedData.expert_notes.length > 2 && (
                                <p className="text-sm text-base-content/60 italic">+{expandedData.expert_notes.length - 2} more notes</p>
                              )}
                            </div>
                          ) : null}
                          {Array.isArray(expandedData.handler_notes) && expandedData.handler_notes.length > 0 ? (
                            <div>
                              <h6 className="text-sm font-semibold text-base-content/70 mb-2">Handler Notes</h6>
                              {expandedData.handler_notes.slice(0, 2).map((note: any) => (
                                <div key={note.id} className="bg-base-200 p-2 rounded text-sm mb-1">
                                  <p className="text-base-content/90 whitespace-pre-wrap line-clamp-2">{note.content}</p>
                                </div>
                              ))}
                              {expandedData.handler_notes.length > 2 && (
                                <p className="text-sm text-base-content/60 italic">+{expandedData.handler_notes.length - 2} more notes</p>
                              )}
                            </div>
                          ) : null}
                          {expandedData.facts ? (
                            <div>
                              <h6 className="text-sm font-semibold text-base-content/70 mb-2">Facts of Case</h6>
                              <p className="text-sm text-base-content/90 whitespace-pre-wrap line-clamp-3">{expandedData.facts}</p>
                            </div>
                          ) : null}
                          {!expandedData.expert_notes?.length && !expandedData.handler_notes?.length && !expandedData.facts && (
                            <p className="text-base text-base-content/70">No notes available.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </td>
            </tr>
          )
        }

      </React.Fragment >
    );
  };


  return (
    <div className="p-4 md:p-6 lg:p-8 text-base">
      <style>
        {`
          .hide-scrollbar {
            -ms-overflow-style: none;  /* Internet Explorer 10+ */
            scrollbar-width: none;  /* Firefox */
          }
          .hide-scrollbar::-webkit-scrollbar { 
            display: none;  /* Safari and Chrome */
          }
          @media (max-width: 767px) {
            .calendar-action-fixed-mobile {
              bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));
            }
          }
          @media (min-width: 768px) {
            .calendar-action-fixed-mobile {
              bottom: auto;
            }
          }
        `}
      </style>
      {/* Date Navigation - count left, arrows center, actions dropdown right (no z-index so it doesn't overlay filters) */}
      <div
        className="flex items-center justify-between gap-2 md:gap-4 mb-6 md:mb-6 rounded-full bg-white/60 dark:bg-base-300/50 backdrop-blur-xl border border-white/30 dark:border-base-content/10 shadow-xl px-4 py-3 md:px-6 md:py-3.5 md:rounded-none md:bg-transparent md:backdrop-blur-none md:border-0 md:shadow-none fixed left-1/2 -translate-x-1/2 z-40 md:static md:left-auto md:translate-x-0 md:top-auto w-[calc(100%-2rem)] md:w-full max-w-4xl md:max-w-none mx-auto"
        style={{
          top: 'max(4.75rem, calc(76px + env(safe-area-inset-top, 0px)))',
          paddingTop: 'max(0.25rem, env(safe-area-inset-top, 0px))'
        }}
      >
        <div className="flex-shrink-0 flex items-center">
          <span className="md:hidden inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 rounded-full text-sm font-bold text-white" style={{ backgroundColor: '#3b28c7' }}>
            {filteredMeetings.length}
          </span>
          <span className="hidden md:inline text-sm md:text-base font-bold" style={{ color: '#3b28c7' }}>
            {filteredMeetings.length} meetings
          </span>
        </div>

        <div className="flex items-center justify-center gap-2 md:gap-4 flex-1 min-w-0">
          <button
            onClick={goToPreviousDay}
            className="btn btn-circle btn-outline btn-primary btn-md md:btn-md flex-shrink-0"
            title="Previous Day"
          >
            <ChevronLeftIcon className="w-6 h-6 md:w-6 md:h-6" />
          </button>
          <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1 justify-center md:flex-initial">
            <span className="text-sm font-semibold text-center sm:text-base md:text-lg md:text-left truncate max-w-[45vw] md:max-w-none">
              {appliedFromDate === appliedToDate ? (
                (() => {
                  const d = new Date(appliedFromDate);
                  const day = String(d.getDate()).padStart(2, '0');
                  const monthNum = String(d.getMonth() + 1).padStart(2, '0');
                  const weekdayLong = d.toLocaleDateString('en-US', { weekday: 'long' });
                  const weekdayShort = d.toLocaleDateString('en-US', { weekday: 'short' });
                  const monthLong = d.toLocaleDateString('en-US', { month: 'long' });
                  const year = String(d.getFullYear()).slice(-2);
                  return (
                    <>
                      <span className="md:hidden">{weekdayShort}, {day}.{monthNum}.{year}</span>
                      <span className="hidden md:inline">{weekdayLong}, {day}. {monthLong} {year}</span>
                    </>
                  );
                })()
              ) : (
                (() => {
                  const fmt = (dateStr: string, short: boolean) => {
                    const d = new Date(dateStr);
                    const day = String(d.getDate()).padStart(2, '0');
                    const monthNum = String(d.getMonth() + 1).padStart(2, '0');
                    const year = String(d.getFullYear()).slice(-2);
                    if (short) return `${day}/${monthNum}/${year}`;
                    const month = d.toLocaleDateString('en-US', { month: 'long' });
                    return `${day}. ${month} ${year}`;
                  };
                  return (
                    <>
                      <span className="md:hidden">{fmt(appliedFromDate, true)} – {fmt(appliedToDate, true)}</span>
                      <span className="hidden md:inline">{fmt(appliedFromDate, false)} - {fmt(appliedToDate, false)}</span>
                    </>
                  );
                })()
              )}
            </span>
            <button
              onClick={goToToday}
              className="hidden md:inline-flex btn btn-sm btn-primary flex-shrink-0"
              title="Go to Today"
            >
              Today
            </button>
          </div>
          <button
            onClick={goToNextDay}
            className="btn btn-circle btn-outline btn-primary btn-md md:btn-md flex-shrink-0"
            title="Next Day"
          >
            <ChevronRightIcon className="w-6 h-6 md:w-6 md:h-6" />
          </button>
        </div>

        <div className="flex-shrink-0" ref={actionMenuDropdownRef}>
          <button
            className="btn btn-circle btn-md md:btn-lg bg-white border-2 hover:bg-gray-50 shadow-md hover:shadow-lg transition-all duration-200"
            style={{ borderColor: '#3b28c7', color: '#3b28c7' }}
            title="Actions"
            onClick={(e) => {
              e.stopPropagation();
              setShowActionMenuDropdown(!showActionMenuDropdown);
            }}
          >
            <EllipsisVerticalIcon className="w-5 h-5 md:w-6 md:h-6" />
          </button>
        </div>
      </div>

      {/* Action dropdown portal - overlays filters/table without date bar covering filters */}
      {showActionMenuDropdown && actionDropdownPosition && createPortal(
        <div
          data-action-dropdown
          className="w-56 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden"
          style={{
            position: 'fixed',
            top: actionDropdownPosition.top,
            right: actionDropdownPosition.right,
            zIndex: 9999,
          }}
        >
          <div className="py-2">
            <button
              className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors flex items-center gap-3"
              onClick={() => {
                openAssignStaffModal();
                setShowActionMenuDropdown(false);
              }}
            >
              <UserGroupIcon className="w-5 h-5" style={{ color: '#3b28c7' }} />
              <span className="text-sm font-semibold text-gray-700">Assign Staff</span>
            </button>
            <button
              className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors flex items-center gap-3"
              onClick={() => {
                setSelectedDateForMeeting(new Date());
                setSelectedTimeForMeeting('09:00');
                setIsTeamsMeetingModalOpen(true);
                setShowActionMenuDropdown(false);
              }}
            >
              <VideoCameraIcon className="w-5 h-5" style={{ color: '#3b28c7' }} />
              <span className="text-sm font-semibold text-gray-700">Create Teams Meeting</span>
            </button>
            <button
              className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors flex items-center gap-3"
              onClick={() => {
                setViewMode(viewMode === 'cards' ? 'list' : 'cards');
                setShowActionMenuDropdown(false);
              }}
            >
              {viewMode === 'cards' ? (
                <Bars3Icon className="w-5 h-5" style={{ color: '#3b28c7' }} />
              ) : (
                <Squares2X2Icon className="w-5 h-5" style={{ color: '#3b28c7' }} />
              )}
              <span className="text-sm font-semibold text-gray-700">{viewMode === 'cards' ? 'Switch to List View' : 'Switch to Card View'}</span>
            </button>
            <button
              className="md:hidden w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors flex items-center gap-3"
              onClick={() => {
                setShowMobileFiltersModal(true);
                setShowActionMenuDropdown(false);
              }}
            >
              <FunnelIcon className="w-5 h-5" style={{ color: '#3b28c7' }} />
              <span className="text-sm font-semibold text-gray-700">Filters</span>
            </button>
          </div>
        </div>,
        document.body
      )}

      {isCustomAddressModalOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setIsCustomAddressModalOpen(false)}
          />
          <div className="relative w-full max-w-xl bg-base-100 rounded-xl border border-base-300 shadow-2xl p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold">Custom Address</h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle"
                onClick={() => setIsCustomAddressModalOpen(false)}
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="text-base whitespace-pre-wrap break-words text-gray-800">
              {selectedCustomAddress || 'No address provided'}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setIsCustomAddressModalOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Spacer on mobile so content starts below the fixed date bar (under header) */}
      <div className="h-32 flex-shrink-0 md:hidden" aria-hidden="true" />

      {/* Filters - desktop only; on mobile moved to modal */}
      <div className="mb-6 w-full hidden md:block">
        <div className="flex flex-wrap gap-4 w-full">
          <div className="flex flex-1 min-w-[260px] items-center gap-3 bg-white border border-base-200 rounded-xl p-3 shadow-sm">
            <FunnelIcon className="w-5 h-5 text-gray-500" />
            <div className="flex flex-wrap items-center gap-2 flex-1">
              <input
                type="date"
                className="input input-bordered flex-1 min-w-[120px]"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                }}
                title="From Date"
              />
              <span className="text-gray-400 font-semibold">to</span>
              <input
                type="date"
                className="input input-bordered flex-1 min-w-[120px]"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                }}
                title="To Date"
              />
              <button
                onClick={handleShowButton}
                className="btn btn-primary btn-sm w-full sm:w-auto"
                title="Apply Date Filter and Load Legacy Meetings"
              >
                Show
              </button>
            </div>
          </div>
          <div className="flex flex-1 min-w-[220px] items-center gap-3 bg-white border border-base-200 rounded-xl p-3 shadow-sm">
            <UserIcon className="w-5 h-5 text-gray-500" />
            <div className="relative flex-1" ref={staffDropdownRef}>
              <input
                type="text"
                className="input input-bordered w-full"
                placeholder="All staff"
                value={staffSearchTerm}
                onFocus={() => setShowStaffDropdown(true)}
                onChange={(e) => {
                  const value = e.target.value;
                  setStaffSearchTerm(value);
                  setShowStaffDropdown(true);
                  if (!value.trim()) {
                    setSelectedStaff('');
                  }
                }}
              />
              {showStaffDropdown && (
                <div className="absolute z-30 mt-2 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-auto">
                  <button
                    type="button"
                    className="w-full text-left px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
                    onClick={() => {
                      setSelectedStaff('');
                      setStaffSearchTerm('');
                      setShowStaffDropdown(false);
                    }}
                  >
                    All Staff
                  </button>
                  {filteredStaffOptions.length > 0 ? (
                    filteredStaffOptions.map((staffName, index) => (
                      <button
                        key={`${staffName}-${index}`}
                        type="button"
                        className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
                        onClick={() => handleStaffSelect(staffName)}
                      >
                        {staffName}
                      </button>
                    ))
                  ) : (
                    <div className="px-4 py-3 text-sm text-gray-500">
                      No matches
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-1 min-w-[220px] items-center gap-3 bg-white border border-base-200 rounded-xl p-3 shadow-sm">
            <CalendarIcon className="w-5 h-5 text-gray-500" />
            <select
              className="select select-bordered flex-1"
              value={selectedMeetingType}
              onChange={(e) => setSelectedMeetingType(e.target.value as 'all' | 'potential' | 'active' | 'staff' | 'paid')}
            >
              <option value="all">All Meetings</option>
              <option value="potential">Potential Clients</option>
              <option value="active">Active Clients</option>
              <option value="staff">Staff Meetings</option>
              <option value="paid">Paid Meetings</option>
            </select>
          </div>
        </div>
      </div>

      {/* Mobile: filter FAB hidden - filters opened via action dropdown (action button is stacked on this spot) */}

      {/* Mobile: filters modal (date, staff, meeting type) */}
      {showMobileFiltersModal && (
        <div
          className="fixed inset-0 z-[100] md:hidden"
          aria-modal="true"
          role="dialog"
          aria-labelledby="mobile-filters-title"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowMobileFiltersModal(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 max-h-[85vh] overflow-y-auto bg-base-100 rounded-2xl shadow-xl border border-base-200 p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-base-200 pb-3">
              <h2 id="mobile-filters-title" className="text-lg font-semibold text-base-content">Filters</h2>
              <button
                type="button"
                className="btn btn-ghost btn-circle btn-sm"
                onClick={() => setShowMobileFiltersModal(false)}
                aria-label="Close filters"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            {/* Date filter */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-base-content/70">Date range</span>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  className="input input-bordered flex-1 min-w-0"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  title="From Date"
                />
                <span className="text-gray-400 font-semibold">to</span>
                <input
                  type="date"
                  className="input input-bordered flex-1 min-w-0"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  title="To Date"
                />
              </div>
              <button
                onClick={() => {
                  handleShowButton();
                  setShowMobileFiltersModal(false);
                }}
                className="btn btn-primary btn-sm w-full"
              >
                Show
              </button>
            </div>
            {/* Staff filter */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-base-content/70">Staff</span>
              <div className="relative" ref={staffDropdownModalRef}>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  placeholder="All staff"
                  value={staffSearchTerm}
                  onFocus={() => setShowStaffDropdown(true)}
                  onChange={(e) => {
                    const value = e.target.value;
                    setStaffSearchTerm(value);
                    setShowStaffDropdown(true);
                    if (!value.trim()) setSelectedStaff('');
                  }}
                />
                {showStaffDropdown && (
                  <div className="absolute z-10 mt-2 w-full bg-base-100 border border-base-200 rounded-xl shadow-lg max-h-48 overflow-auto">
                    <button
                      type="button"
                      className="w-full text-left px-4 py-2 text-sm hover:bg-base-200"
                      onClick={() => {
                        setSelectedStaff('');
                        setStaffSearchTerm('');
                        setShowStaffDropdown(false);
                      }}
                    >
                      All Staff
                    </button>
                    {filteredStaffOptions.length > 0 ? (
                      filteredStaffOptions.map((staffName, index) => (
                        <button
                          key={`modal-${staffName}-${index}`}
                          type="button"
                          className="w-full text-left px-4 py-2 text-sm hover:bg-base-200"
                          onClick={() => {
                            handleStaffSelect(staffName);
                          }}
                        >
                          {staffName}
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-3 text-sm text-base-content/60">No matches</div>
                    )}
                  </div>
                )}
              </div>
            </div>
            {/* Meeting type filter */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-base-content/70">Meeting type</span>
              <select
                className="select select-bordered w-full"
                value={selectedMeetingType}
                onChange={(e) => setSelectedMeetingType(e.target.value as 'all' | 'potential' | 'active' | 'staff' | 'paid')}
              >
                <option value="all">All Meetings</option>
                <option value="potential">Potential Clients</option>
                <option value="active">Active Clients</option>
                <option value="staff">Staff Meetings</option>
                <option value="paid">Paid Meetings</option>
              </select>
            </div>
          </div>
        </div>
      )}


      {/* Meetings List */}
      <div className="mt-6 bg-base-100 rounded-lg shadow-lg overflow-x-auto">
        {/* Desktop Table - Show when viewMode is 'list' */}
        {viewMode === 'list' && (
          <table className="table w-full text-sm sm:text-base md:text-lg">
            <thead>
              <tr className="bg-white text-sm sm:text-base">
                <th className="text-gray-500">Type</th>
                <th className="text-gray-500">Time</th>
                <th className="text-gray-500">Lead</th>
                <th className="text-gray-500">Category</th>
                <th className="text-gray-500">Value</th>
                <th className="text-gray-500 w-20 min-w-[5rem]">Participants</th>
                <th className="text-gray-500">Location</th>
                <th className="text-gray-500">Address</th>
                <th className="text-gray-500">Status</th>
                <th className="text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={10} className="text-center p-8 text-lg">Loading meetings...</td></tr>
              ) : filteredMeetings.length > 0 ? (
                (() => {
                  const todayStr = new Date().toISOString().split('T')[0];
                  const now = new Date();
                  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                  const showNowLine = appliedFromDate && appliedToDate && appliedFromDate <= todayStr && todayStr <= appliedToDate;
                  const CurrentTimeRow = () => (
                    <tr className="relative z-0 bg-transparent hover:bg-transparent border-0">
                      <td colSpan={10} className="p-0 align-middle border-0 relative">
                        <div className="relative flex items-center gap-3 py-1.5">
                          <span className="relative z-10 bg-white px-1.5 py-0.5 text-xs font-semibold text-red-600 whitespace-nowrap tabular-nums rounded" style={{ minWidth: '3.5rem' }}>
                            {currentTime}
                          </span>
                          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5 bg-red-500 rounded-full z-0 pointer-events-none" style={{ boxShadow: '0 0 6px rgba(239,68,68,0.4)' }} />
                        </div>
                      </td>
                    </tr>
                  );
                  if (!showNowLine) return filteredMeetings.map(renderMeetingRow);
                  const result: React.ReactNode[] = [];
                  let nowInserted = false;
                  filteredMeetings.forEach((meeting) => {
                    const time = (meeting.meeting_time || '').slice(0, 5);
                    if (!nowInserted && time > currentTime) {
                      result.push(<CurrentTimeRow key="current-time" />);
                      nowInserted = true;
                    }
                    result.push(renderMeetingRow(meeting));
                  });
                  if (!nowInserted) result.push(<CurrentTimeRow key="current-time" />);
                  return result;
                })()
              ) : isLegacyLoading ? (
                <tr><td colSpan={10} className="text-center p-8 text-lg">
                  <div className="flex items-center justify-center gap-2">
                    <span className="loading loading-spinner loading-sm"></span>
                    Loading meetings...
                  </div>
                </td></tr>
              ) : (
                <tr><td colSpan={10} className="text-center p-8 text-lg">No meetings found for the selected filters.</td></tr>
              )}
            </tbody>
          </table>
        )}

        {/* Cards View - Show when viewMode is 'cards' */}
        {viewMode === 'cards' && (
          <div>
            {isLoading || !stageNamesLoaded ? (
              <div className="text-center p-8">
                <div className="loading loading-spinner loading-lg"></div>
                <p className="mt-4 text-base-content/60">
                  {isLoading ? 'Loading meetings...' : 'Loading stage names...'}
                </p>
              </div>
            ) : filteredMeetings.length > 0 ? (
              <>
                {/* Mobile: Horizontal Scrolling */}
                <div className="md:hidden">
                  <div className="flex gap-4 p-4 overflow-x-auto snap-x snap-mandatory hide-scrollbar">
                    {filteredMeetings.map((meeting) => (
                      <div key={meeting.id} className="flex-shrink-0 w-80 snap-start">
                        {renderMeetingCard(meeting)}
                      </div>
                    ))}
                  </div>
                  {/* Scroll indicator */}
                  {filteredMeetings.length > 1 && (
                    <div className="flex justify-center mt-2 gap-1">
                      <div className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                        Swipe to see more cards ({filteredMeetings.length} total)
                      </div>
                    </div>
                  )}
                </div>

                {/* Desktop: Grid Layout */}
                <div className="hidden md:block">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6 p-6">
                    {filteredMeetings.map(renderMeetingCard)}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center p-8">
                <div className="text-base-content/60">
                  {isLegacyLoading ? (
                    <>
                      <span className="loading loading-spinner loading-lg mx-auto mb-4"></span>
                      <p className="text-lg font-medium">Loading legacy meetings...</p>
                      <p className="text-sm">Please wait while we fetch the data</p>
                    </>
                  ) : (
                    <>
                      <CalendarIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
                      <p className="text-lg font-medium">No meetings found</p>
                      <p className="text-sm">Try adjusting your search or filters</p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Total Amount - move this up above department tables */}
      <div className="mt-6 flex justify-end">
        <div className="card bg-primary text-primary-content p-4 shadow-lg text-base">
          <div className="flex items-center gap-3">
            <CurrencyDollarIcon className="w-7 h-7" />
            <div>
              <div className="text-lg font-bold">Total Balance</div>
              <div className="text-2xl font-extrabold">₪{totalAmount.toLocaleString()}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Department List Component */}
      <DepartmentList
        meetings={filteredMeetings}
        viewMode={viewMode}
        renderMeetingCard={renderMeetingCard}
        renderMeetingRow={renderMeetingRow}
      />

      {/* WhatsApp Modal */}
      <SchedulerWhatsAppModal
        isOpen={isWhatsAppOpen}
        onClose={() => {
          setIsWhatsAppOpen(false);
          setSelectedClientForWhatsApp(null);
        }}
        client={selectedClientForWhatsApp || undefined}
        hideContactSelector={true}
      />

      {/* Email Thread Modal */}
      <SchedulerEmailThreadModal
        isOpen={isEmailModalOpen}
        onClose={() => {
          setIsEmailModalOpen(false);
          setSelectedClientForEmail(null);
        }}
        client={selectedClientForEmail || undefined}
      />

      {/* Guest Selection Modal */}
      {isGuestSelectionModalOpen && selectedMeetingForGuest && guestSelectionType && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 p-6 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-black">Select Guest {guestSelectionType === 'extern1' ? '1' : '2'}</h2>
                <p className="text-sm text-gray-500 mt-1">Choose an employee to add as a guest participant</p>
              </div>
              <button
                onClick={() => {
                  setIsGuestSelectionModalOpen(false);
                  setSelectedMeetingForGuest(null);
                  setGuestSelectionType(null);
                }}
                className="btn btn-ghost btn-sm btn-circle"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Search employees */}
            <div className="px-6 pt-2 pb-2 border-b border-gray-100">
              <label className="sr-only" htmlFor="guest-employee-search">Search employees</label>
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  id="guest-employee-search"
                  type="text"
                  placeholder="Search by name or department..."
                  value={guestSearchTerm}
                  onChange={(e) => setGuestSearchTerm(e.target.value)}
                  className="input input-bordered w-full pl-10 pr-4"
                />
              </div>
            </div>

            {/* Employee List */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {allEmployees
                  .filter((employee: any) => {
                    if (!guestSearchTerm.trim()) return true;
                    const q = guestSearchTerm.trim().toLowerCase();
                    const name = (employee.display_name || '').toLowerCase();
                    const dept = (employee.tenant_departement?.name || '').toLowerCase();
                    return name.includes(q) || dept.includes(q);
                  })
                  .map((employee: any) => {
                  const isSelected = selectedMeetingForGuest[guestSelectionType] === employee.id.toString();
                  return (
                    <button
                      key={employee.id}
                      onClick={() => {
                        if (isSelected) {
                          handleRemoveGuest(selectedMeetingForGuest.id, guestSelectionType);
                        } else {
                          handleSaveGuest(selectedMeetingForGuest.id, guestSelectionType, employee.id);
                        }
                      }}
                      className={`flex flex-row items-center gap-4 p-4 rounded-lg border-2 transition-all text-left ${isSelected
                        ? 'border-primary bg-primary/10'
                        : 'border-gray-200 hover:border-primary hover:bg-gray-50'
                        }`}
                    >
                      <div className="flex-shrink-0">
                        {renderEmployeeAvatar(employee.id, 'lg', false)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-gray-900 text-base">{employee.display_name}</div>
                        {employee.tenant_departement?.name && (
                          <div className="text-xs text-gray-500 mt-0.5">{employee.tenant_departement.name}</div>
                        )}
                      </div>
                      {isSelected && (
                        <CheckIcon className="w-5 h-5 text-primary flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="bg-gray-50 border-t border-gray-200 p-4 flex justify-end">
              <button
                onClick={() => {
                  setIsGuestSelectionModalOpen(false);
                  setSelectedMeetingForGuest(null);
                  setGuestSelectionType(null);
                }}
                className="btn btn-ghost"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Notes Modal */}
      {isNotesModalOpen && selectedMeetingForNotes && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 p-6 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-black">Notes</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {selectedMeetingForNotes.lead?.name || selectedMeetingForNotes.name || 'Meeting Notes'}
                  {selectedMeetingForNotes.lead?.lead_number && ` (${selectedMeetingForNotes.lead.lead_number})`}
                </p>
              </div>
              <button
                onClick={() => {
                  setIsNotesModalOpen(false);
                  setSelectedMeetingForNotes(null);
                }}
                className="btn btn-ghost btn-sm btn-circle"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Notes Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {(() => {
                const meetingNotes = expandedMeetingData[selectedMeetingForNotes.id];
                if (meetingNotes?.loading) {
                  return (
                    <div className="flex justify-center items-center py-12">
                      <span className="loading loading-spinner loading-lg"></span>
                    </div>
                  );
                }
                return (
                  <>
                    {/* Expert Notes */}
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">Expert Notes</h3>
                      {(() => {
                        const expertNotes = meetingNotes?.expert_notes;
                        if (Array.isArray(expertNotes) && expertNotes.length > 0) {
                          return (
                            <div className="space-y-3">
                              {expertNotes.map((note: any) => (
                                <div key={note.id} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                                  {note.timestamp && (
                                    <div className="flex items-center gap-2 text-gray-500 mb-2">
                                      <ClockIcon className="w-4 h-4" />
                                      <span className="text-sm">{note.timestamp}</span>
                                    </div>
                                  )}
                                  <p className="text-base text-gray-800 whitespace-pre-wrap">{note.content}</p>
                                </div>
                              ))}
                            </div>
                          );
                        }
                        return (
                          <p className="text-base text-gray-500 italic">No expert notes available.</p>
                        );
                      })()}
                    </div>

                    {/* Handler Notes */}
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">Handler Notes</h3>
                      {(() => {
                        const handlerNotes = meetingNotes?.handler_notes;
                        if (Array.isArray(handlerNotes) && handlerNotes.length > 0) {
                          return (
                            <div className="space-y-3">
                              {handlerNotes.map((note: any) => (
                                <div key={note.id} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                                  {note.timestamp && (
                                    <div className="flex items-center gap-2 text-gray-500 mb-2">
                                      <ClockIcon className="w-4 h-4" />
                                      <span className="text-sm">{note.timestamp}</span>
                                    </div>
                                  )}
                                  <p className="text-base text-gray-800 whitespace-pre-wrap">{note.content}</p>
                                </div>
                              ))}
                            </div>
                          );
                        }
                        return (
                          <p className="text-base text-gray-500 italic">No handler notes available.</p>
                        );
                      })()}
                    </div>

                    {/* Facts of Case */}
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">Facts of Case</h3>
                      {(() => {
                        const facts = meetingNotes?.facts;
                        if (facts) {
                          return (
                            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                              <p className="text-base text-gray-800 whitespace-pre-wrap">{facts}</p>
                            </div>
                          );
                        }
                        return (
                          <p className="text-base text-gray-500 italic">No facts of case available.</p>
                        );
                      })()}
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Footer */}
            <div className="bg-gray-50 border-t border-gray-200 p-4 flex justify-end">
              <button
                onClick={() => {
                  setIsNotesModalOpen(false);
                  setSelectedMeetingForNotes(null);
                }}
                className="btn btn-primary"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Assign Staff Modal */}
      {isAssignStaffModalOpen && createPortal(
        <div className="fixed inset-0 bg-white z-50">
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <span className="text-3xl font-extrabold tracking-tight" style={{ color: '#3b28c7', letterSpacing: '-0.03em' }}>RMQ 2.0</span>
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-bold text-black">Assign Staff</h2>
                  </div>

                </div>
                <button
                  onClick={() => setIsAssignStaffModalOpen(false)}
                  className="btn btn-ghost btn-circle text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                >
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>

              {/* Unavailable Employees for Selected Date */}
              {unavailableEmployees[modalSelectedDate] && unavailableEmployees[modalSelectedDate].length > 0 && (
                <div className="mt-4 bg-white rounded-xl shadow-md border border-gray-200">
                  <div
                    className="flex items-center justify-between px-4 py-2 border-b border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => setIsUnavailableStaffExpanded(!isUnavailableStaffExpanded)}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-gradient-to-tr from-purple-500 to-blue-600 rounded-lg flex items-center justify-center">
                        <UserGroupIcon className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-gray-900">Unavailable Staff</h3>
                        <p className="text-xs text-gray-500">
                          {new Date(modalSelectedDate).toLocaleDateString('en-US', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })}
                        </p>
                      </div>
                    </div>
                    <ChevronDownIcon
                      className={`w-5 h-5 text-gray-500 transition-transform ${isUnavailableStaffExpanded ? 'rotate-180' : ''}`}
                    />
                  </div>

                  {isUnavailableStaffExpanded ? (
                    // Expanded view - Full cards
                    <div className="px-4 pb-3 pt-3">
                      <div className="flex overflow-x-auto gap-3 pb-2 -mx-4 px-4 sm:grid sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 sm:overflow-x-visible sm:pb-0 sm:-mx-0 sm:px-0">
                        {unavailableEmployees[modalSelectedDate].map((item, index) => {
                          // Deduplicate by employeeId - keep only first occurrence
                          const isFirstOccurrence = unavailableEmployees[modalSelectedDate].findIndex(
                            (emp: any) => emp.employeeId === item.employeeId
                          ) === index;

                          if (!isFirstOccurrence) return null;

                          const employeeInitials = item.employeeName
                            .split(' ')
                            .map((n: string) => n[0])
                            .join('')
                            .toUpperCase()
                            .slice(0, 2);

                          const timeDisplay = item.isRange || item.startTime === 'All Day'
                            ? 'All Day'
                            : `${item.startTime} - ${item.endTime}`;

                          return (
                            <div
                              key={`${item.employeeId}-${index}`}
                              className="relative overflow-hidden rounded-lg border border-gray-300 bg-white min-h-[140px] flex-shrink-0 w-[150px] sm:w-auto sm:max-w-[150px]"
                              style={{
                                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
                              }}
                            >
                              {/* Background Image with Overlay */}
                              {item.photo && (
                                <div
                                  className="absolute inset-0 bg-cover bg-center bg-no-repeat"
                                  style={{ backgroundImage: `url(${item.photo})` }}
                                >
                                  <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black/70"></div>
                                </div>
                              )}

                              {/* Role Badge - Top Right Corner */}
                              {item.role && (
                                <div className="absolute top-1 right-1 z-20">
                                  <span className="badge badge-xs px-1.5 py-0.5 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-0 text-[10px] font-semibold shadow-md">
                                    {item.role}
                                  </span>
                                </div>
                              )}

                              {/* Content */}
                              <div className={`relative z-10 p-2.5 flex flex-col h-full ${item.photo ? 'text-white' : 'text-gray-900'}`}>
                                {/* Top Row: Profile Image (Left), Time Range (Center), Role Badge (Right - already positioned) */}
                                <div className="flex items-start justify-between mb-1.5">
                                  {/* Left Side: Profile Image and Name */}
                                  <div className="flex-shrink-0 flex flex-col items-center">
                                    {/* Profile Image or Initials Circle */}
                                    {item.photo_url ? (
                                      <img
                                        src={item.photo_url}
                                        alt={item.employeeName}
                                        className="w-12 h-12 rounded-full object-cover shadow-md mb-1"
                                        onError={(e) => {
                                          const target = e.target as HTMLImageElement;
                                          const targetParent = target.parentElement;
                                          if (targetParent) {
                                            target.style.display = 'none';
                                            const fallback = document.createElement('div');
                                            fallback.className = `w-12 h-12 rounded-full flex items-center justify-center shadow-md mb-1 ${item.photo ? 'bg-primary/90' : 'bg-primary'} text-white text-xs font-bold`;
                                            fallback.textContent = employeeInitials;
                                            targetParent.insertBefore(fallback, target);
                                          }
                                        }}
                                      />
                                    ) : (
                                      <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-md mb-1 ${item.photo ? 'bg-primary/90' : 'bg-primary'} text-white text-xs font-bold`}>
                                        {employeeInitials}
                                      </div>
                                    )}
                                    {/* Employee Name - Always shown under the circle */}
                                    <h4 className={`text-xs font-semibold text-center truncate max-w-[70px] ${item.photo ? 'text-white drop-shadow-lg' : 'text-gray-900'}`}>
                                      {item.employeeName}
                                    </h4>
                                  </div>

                                  {/* Spacer for right side (role badge) */}
                                  <div className="w-12 flex-shrink-0"></div>
                                </div>

                                {/* Center: Time Range */}
                                <div className="flex-1 text-center px-1 mb-2">
                                  <div className={`text-xs font-semibold ${item.photo ? 'text-white' : 'text-gray-800'}`}>
                                    {timeDisplay}
                                  </div>
                                  {/* Date Range - only if it's a range */}
                                  {item.date && item.date.includes('to') && (
                                    <div className={`text-[10px] font-medium mt-0.5 ${item.photo ? 'text-white/90' : 'text-gray-700'}`}>
                                      {item.date}
                                    </div>
                                  )}
                                </div>

                                {/* Department */}
                                {item.department && (
                                  <div className="text-center mb-2">
                                    <div className={`text-xs font-medium ${item.photo ? 'text-white/90' : 'text-gray-600'}`}>
                                      {item.department}
                                    </div>
                                  </div>
                                )}

                                {/* Reason */}
                                <div className={`border-t pt-1.5 mt-auto ${item.photo ? 'border-white/30' : 'border-gray-300'}`}>
                                  {item.reason && (
                                    <div className={`text-[10px] text-center px-1.5 py-0.5 rounded truncate ${item.photo ? 'text-white/90 bg-white/20' : 'text-gray-600 bg-gray-100'}`} title={item.reason}>
                                      {item.reason}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    // Collapsed view - Just name and time
                    <div className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {unavailableEmployees[modalSelectedDate].map((item, index) => {
                          // Deduplicate by employeeId - keep only first occurrence
                          const isFirstOccurrence = unavailableEmployees[modalSelectedDate].findIndex(
                            (emp: any) => emp.employeeId === item.employeeId
                          ) === index;

                          if (!isFirstOccurrence) return null;

                          const timeDisplay = item.isRange || item.startTime === 'All Day'
                            ? 'All Day'
                            : `${item.startTime} - ${item.endTime}`;

                          return (
                            <div
                              key={`${item.employeeId}-${index}`}
                              className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg"
                            >
                              <span className="text-sm font-semibold text-gray-700">{item.employeeName}</span>
                              <span className="text-xs text-gray-500">•</span>
                              <span className="text-xs text-gray-600">{timeDisplay}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Filters */}
              <div className="mt-4 flex flex-col md:flex-row gap-4">
                {/* Date Selector */}
                <div className="flex items-center gap-2">
                  <label className="text-sm font-semibold">Date:</label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const baseDate = modalSelectedDate || new Date().toISOString().split('T')[0];
                        const currentDate = new Date(baseDate);
                        if (!isNaN(currentDate.getTime())) {
                          currentDate.setDate(currentDate.getDate() - 1);
                          setModalSelectedDate(currentDate.toISOString().split('T')[0]);
                        }
                      }}
                      className="btn btn-sm btn-circle bg-white text-gray-800 hover:bg-gray-100"
                    >
                      <ChevronLeftIcon className="w-4 h-4" />
                    </button>
                    <input
                      type="date"
                      value={modalSelectedDate}
                      onChange={(e) => setModalSelectedDate(e.target.value)}
                      className="input bg-white text-gray-800 border-0 focus:outline-none focus:ring-2 focus:ring-purple-500 w-48"
                      min={new Date().toISOString().split('T')[0]}
                      max={new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                    />
                    <button
                      onClick={() => {
                        const baseDate = modalSelectedDate || new Date().toISOString().split('T')[0];
                        const currentDate = new Date(baseDate);
                        if (!isNaN(currentDate.getTime())) {
                          currentDate.setDate(currentDate.getDate() + 1);
                          setModalSelectedDate(currentDate.toISOString().split('T')[0]);
                        }
                      }}
                      className="btn btn-sm btn-circle bg-white text-gray-800 hover:bg-gray-100"
                    >
                      <ChevronRightIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Staff Filter */}
                <div className="flex items-center gap-2">
                  <label className="text-sm font-semibold">Filter by Staff:</label>
                  <select
                    value={selectedStaffFilter}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      console.log('🔍 [Staff Filter Dropdown] Changed to:', newValue);
                      setSelectedStaffFilter(newValue);
                    }}
                    className="select bg-white text-gray-800 border-0 focus:outline-none w-48"
                  >
                    <option value="">All Staff</option>
                    {availableStaff.map((staff, index) => (
                      <option key={`${staff}-${index}`} value={staff}>{staff}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto flex-1">
              {assignStaffLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="loading loading-spinner loading-lg text-purple-600"></div>
                  <span className="ml-4 text-lg">Loading meetings...</span>
                </div>
              ) : getAvailableDates().length === 0 ? (
                <div className="text-center py-12">
                  <CalendarIcon className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                  <h3 className="text-xl font-semibold text-gray-600 mb-2">No Meetings Found</h3>
                  <p className="text-gray-500">No meetings scheduled for the selected period.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Selected Date Meetings */}
                  {(() => {
                    const filteredMeetings = getFilteredMeetings();
                    return filteredMeetings.length > 0 ? (
                      <div>
                        <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                          <CalendarIcon className="w-6 h-6 text-blue-600" />
                          {new Date(modalSelectedDate).toLocaleDateString('en-US', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })} ({filteredMeetings.length} meetings)
                        </h3>
                        {/* Table View */}
                        <div className="overflow-x-auto overflow-y-visible">
                          <table className="table w-full overflow-visible">
                            <thead>
                              <tr>
                                <th className="text-left text-sm font-semibold text-gray-500">Lead</th>
                                <th className="text-left text-sm font-semibold text-gray-500">Time</th>
                                <th className="text-left text-sm font-semibold text-gray-500">Location</th>
                                <th className="text-left text-sm font-semibold text-gray-500">Address</th>
                                <th className="text-left text-sm font-semibold text-gray-500">Category</th>
                                <th className="text-left text-sm font-semibold text-gray-500">Expert</th>
                                <th className="text-left text-sm font-semibold text-gray-500">Language</th>
                                <th className="text-left text-sm font-semibold text-gray-500">Value</th>
                                <th className="text-left text-sm font-semibold text-gray-500">Info</th>
                                <th className="text-left text-sm font-semibold text-gray-500">
                                  <div className="flex items-center gap-2">
                                    <span>Manager</span>
                                    {(() => {
                                      const meeting = filteredMeetings.find(m => previousManagers[m.id]);
                                      return meeting && previousManagers[meeting.id] ? (
                                        <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-full animate-pulse">
                                          Prev: {previousManagers[meeting.id]}
                                        </span>
                                      ) : null;
                                    })()}
                                  </div>
                                </th>
                                <th className="text-left text-sm font-semibold text-gray-500">Helper</th>
                                <th className="text-left text-sm font-semibold text-gray-500">Scheduler</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredMeetings.map((meeting) => {
                                const lead = meeting.lead || {};

                                // Check if meeting should show green indicator:
                                // 1. For potential_client: if lead has passed stage 20 (21 and higher) BUT NOT stage 55
                                // 2. For active_client: if 2 hours have passed after meeting time
                                const hasPassedStage = (() => {
                                  // For potential_client meetings: check if stage > 20 and stage is not 55
                                  if (meeting.calendar_type === 'potential_client') {
                                    const leadStage = lead.stage ? Number(lead.stage) : null;
                                    const meetingStage = meeting.stage ? Number(meeting.stage) : null;
                                    const currentStage = leadStage || meetingStage;

                                    // Stage must be > 20 AND not equal to 55
                                    return currentStage !== null && currentStage > 20 && currentStage !== 55;
                                  }

                                  // For active_client meetings: check if 2 hours have passed after meeting time
                                  if (meeting.calendar_type === 'active_client' && meeting.meeting_date && meeting.meeting_time) {
                                    try {
                                      const meetingDateTime = new Date(`${meeting.meeting_date}T${meeting.meeting_time}`);
                                      const now = new Date();
                                      const hoursPassed = (now.getTime() - meetingDateTime.getTime()) / (1000 * 60 * 60);
                                      return hoursPassed >= 2;
                                    } catch (error) {
                                      console.error('Error calculating meeting time:', error);
                                      return false;
                                    }
                                  }

                                  return false;
                                })();

                                return (
                                  <tr key={meeting.id} className={`hover:bg-gray-50 ${hasPassedStage ? 'border-l-4 border-l-green-500' : ''}`}>
                                    {/* Lead */}
                                    <td className="text-base">
                                      <div className="flex items-center gap-1 sm:gap-2">
                                        {hasPassedStage && (
                                          <CheckCircleIcon className="w-4 h-4 sm:w-5 sm:h-5 text-green-500 flex-shrink-0" />
                                        )}
                                        <div className="flex flex-col">
                                          {meeting.calendar_type === 'staff' ? (
                                            <span className="font-medium">
                                              {meeting.lead?.name || 'N/A'}
                                            </span>
                                          ) : (
                                            <>
                                              <Link
                                                to={buildClientRoute(meeting.lead)}
                                                className="hover:opacity-80 font-medium"
                                                style={{ color: '#3b28c7' }}
                                                onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
                                                onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                                              >
                                                {meeting.lead?.name || 'N/A'}
                                              </Link>
                                              <span className="text-xs text-gray-500">
                                                ({meeting.lead?.lead_number || meeting.lead_number})
                                              </span>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    </td>

                                    {/* Time */}
                                    <td className="font-medium text-base">
                                      {meeting.meeting_time ? (
                                        <div
                                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
                                          style={{
                                            backgroundColor: resolveStageColour('20') || getStageColour('20') || '#10b981',
                                            color: getContrastingTextColor(resolveStageColour('20') || getStageColour('20') || '#10b981'),
                                          }}
                                        >
                                          <ClockIcon className="w-4 h-4" />
                                          <span className="text-sm font-semibold">
                                            {formatTime(meeting.meeting_time)}
                                          </span>
                                        </div>
                                      ) : (
                                        'N/A'
                                      )}
                                    </td>

                                    {/* Location */}
                                    <td className="text-base">{meeting.calendar_type === 'staff' ? meeting.meeting_location : (meeting.meeting_location === '--' ? '--' : (meeting.meeting_location || getLegacyMeetingLocation(meeting.meeting_location_id) || 'N/A'))}</td>

                                    {/* Address */}
                                    <td className="text-base">{meeting.custom_address || '--'}</td>

                                    {/* Category */}
                                    <td className="text-base">
                                      {(() => {
                                        const categoryText = getCategoryName(meeting.lead?.category_id, meeting.lead?.category || meeting.category) || 'N/A';
                                        // Split category name and main category (in parentheses) into two rows
                                        const match = categoryText.match(/^(.+?)\s*\((.+?)\)$/);
                                        if (match) {
                                          const [, categoryName, mainCategory] = match;
                                          return (
                                            <div className="flex flex-col">
                                              <span>{categoryName}</span>
                                              <span className="text-xs text-gray-500">({mainCategory})</span>
                                            </div>
                                          );
                                        }
                                        // If no parentheses, just show the text
                                        return <span>{categoryText}</span>;
                                      })()}
                                    </td>

                                    {/* Expert */}
                                    <td className="text-base">
                                      <div className="flex flex-col gap-2">
                                        <span>{meeting.expert || meeting.lead?.expert || 'N/A'}</span>
                                        {(() => {
                                          if (meeting.calendar_type === 'staff') {
                                            return null;
                                          }

                                          const lead = meeting.lead || {};

                                          // For NEW leads: use eligibility_status field (text values)
                                          // For LEGACY leads: use expert_examination field (numeric values)
                                          if (lead.lead_type !== 'legacy') {
                                            const eligibilityStatus = lead.eligibility_status;

                                            if (!eligibilityStatus || eligibilityStatus === '') {
                                              return (
                                                <span className="w-9 h-9 rounded-full bg-gray-400 text-white inline-flex items-center justify-center font-semibold shadow-md" title="Expert opinion not checked">
                                                  <QuestionMarkCircleIcon className="w-5 h-5" />
                                                </span>
                                              );
                                            }

                                            if (eligibilityStatus === 'not_feasible') {
                                              return (
                                                <span className="w-9 h-9 rounded-full bg-red-500 text-white inline-flex items-center justify-center font-semibold shadow-md" title="Not Feasible">
                                                  <XCircleIcon className="w-5 h-5" />
                                                </span>
                                              );
                                            } else if (eligibilityStatus === 'feasible_no_check') {
                                              return (
                                                <span className="w-9 h-9 rounded-full bg-green-500 text-white inline-flex items-center justify-center font-semibold shadow-md" title="Feasible (no check)">
                                                  <CheckCircleIcon className="w-5 h-5" />
                                                </span>
                                              );
                                            } else if (eligibilityStatus === 'feasible_with_check') {
                                              return (
                                                <span className="w-9 h-9 rounded-full bg-orange-500 text-white inline-flex items-center justify-center font-semibold shadow-md" title="Feasible (with check)">
                                                  <ExclamationTriangleIcon className="w-5 h-5" />
                                                </span>
                                              );
                                            }

                                            return (
                                              <span className="w-9 h-9 rounded-full bg-gray-400 text-white inline-flex items-center justify-center font-semibold shadow-md" title="Expert opinion not checked">
                                                <QuestionMarkCircleIcon className="w-5 h-5" />
                                              </span>
                                            );
                                          }

                                          const expertExamination = lead.expert_examination;

                                          if (!expertExamination || expertExamination === 0 || expertExamination === '0') {
                                            return (
                                              <span className="w-9 h-9 rounded-full bg-gray-400 text-white inline-flex items-center justify-center font-semibold shadow-md" title="Expert opinion not checked">
                                                <QuestionMarkCircleIcon className="w-5 h-5" />
                                              </span>
                                            );
                                          }

                                          if (expertExamination === 1 || expertExamination === '1') {
                                            return (
                                              <span className="w-9 h-9 rounded-full bg-red-500 text-white inline-flex items-center justify-center font-semibold shadow-md" title="Not Feasible">
                                                <XCircleIcon className="w-5 h-5" />
                                              </span>
                                            );
                                          } else if (expertExamination === 5 || expertExamination === '5') {
                                            return (
                                              <span className="w-9 h-9 rounded-full bg-orange-500 text-white inline-flex items-center justify-center font-semibold shadow-md" title="Feasible (further check)">
                                                <ExclamationTriangleIcon className="w-5 h-5" />
                                              </span>
                                            );
                                          } else if (expertExamination === 8 || expertExamination === '8') {
                                            return (
                                              <span className="w-9 h-9 rounded-full bg-green-500 text-white inline-flex items-center justify-center font-semibold shadow-md" title="Feasible (no check)">
                                                <CheckCircleIcon className="w-5 h-5" />
                                              </span>
                                            );
                                          }

                                          return (
                                            <span className="px-2 py-1 rounded-full bg-gray-400 text-white gap-1 inline-flex items-center font-semibold shadow-md text-xs" title="Expert opinion status unknown">
                                              <QuestionMarkCircleIcon className="w-3 h-3" />
                                              Unknown
                                            </span>
                                          );
                                        })()}
                                      </div>
                                    </td>

                                    {/* Language */}
                                    <td className="text-base">{meeting.language || meeting.lead?.language || 'N/A'}</td>

                                    {/* Value */}
                                    <td className="font-medium text-base">
                                      {(() => {
                                        // Same logic as calendar page (lines 4567-4649)
                                        const lead = meeting.lead || {};
                                        const isLegacy = lead.lead_type === 'legacy' || lead.id?.toString().startsWith('legacy_');
                                        let balanceValue: any;

                                        if (isLegacy) {
                                          // For legacy leads: if currency_id is 1 (NIS/ILS), use total_base; otherwise use total
                                          const currencyId = (lead as any).currency_id;
                                          let numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
                                          if (!numericCurrencyId || isNaN(numericCurrencyId)) {
                                            numericCurrencyId = 1; // Default to NIS
                                          }
                                          if (numericCurrencyId === 1) {
                                            balanceValue = (lead as any).total_base ?? null;
                                          } else {
                                            balanceValue = (lead as any).total ?? null;
                                          }
                                        } else {
                                          balanceValue = lead.balance || (lead as any).proposal_total;
                                        }

                                        // Currency from join (accounting_currencies) only, same as Clients.tsx total value badge
                                        let balanceCurrency = lead.balance_currency || meeting.meeting_currency || 'NIS';

                                        // Fallback to meeting amount if no balance
                                        if (!balanceValue && meeting.meeting_amount) {
                                          balanceValue = meeting.meeting_amount;
                                          balanceCurrency = meeting.meeting_currency || balanceCurrency || 'NIS';
                                        }

                                        if (balanceValue === '--' || meeting.meeting_amount === '--') {
                                          return '--';
                                        }

                                        // Ensure we have a currency (default to NIS)
                                        if (!balanceCurrency) {
                                          balanceCurrency = 'NIS';
                                        }

                                        // Handle 0 values - show currency symbol
                                        if (balanceValue === 0 || balanceValue === '0' || Number(balanceValue) === 0) {
                                          return `${getCurrencySymbol(balanceCurrency)}0`;
                                        }

                                        if (balanceValue && (Number(balanceValue) > 0 || balanceValue !== '0')) {
                                          const formattedValue = typeof balanceValue === 'number'
                                            ? balanceValue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
                                            : Number(balanceValue).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
                                          return `${getCurrencySymbol(balanceCurrency)}${formattedValue}`;
                                        }

                                        if (typeof meeting.meeting_amount === 'number' && meeting.meeting_amount > 0) {
                                          return `${getCurrencySymbol(meeting.meeting_currency || 'NIS')}${meeting.meeting_amount.toLocaleString()}`;
                                        }

                                        // Default: show 0 with NIS symbol
                                        return `${getCurrencySymbol(balanceCurrency)}0`;
                                      })()}
                                    </td>

                                    {/* Info */}
                                    <td className="text-base">
                                      <div className="flex items-center gap-1">
                                        {isNotFirstMeeting(meeting) && (
                                          <FireIcon className="w-6 h-6 text-orange-500" title="Another meeting" />
                                        )}
                                        <span className={`font-bold ${(() => {
                                          const probability = meeting.lead?.probability ?? meeting.probability;
                                          const probabilityNumber = typeof probability === 'string' ? parseFloat(probability) : probability;
                                          let probabilityColor = 'text-red-600';
                                          if (probabilityNumber >= 80) probabilityColor = 'text-green-600';
                                          else if (probabilityNumber >= 60) probabilityColor = 'text-yellow-600';
                                          else if (probabilityNumber >= 40) probabilityColor = 'text-orange-600';
                                          return probabilityColor;
                                        })()}`}>
                                          {(() => {
                                            const probability = meeting.lead?.probability ?? meeting.probability;
                                            const probabilityNumber = typeof probability === 'string' ? parseFloat(probability) : probability;

                                            // For new meetings, use attendance_probability
                                            if (meeting.attendance_probability && ['Low', 'Medium', 'High', 'Very High'].includes(meeting.attendance_probability)) {
                                              const letter = meeting.attendance_probability === 'Low' ? 'L' :
                                                meeting.attendance_probability === 'Medium' ? 'M' :
                                                  meeting.attendance_probability === 'High' ? 'H' : 'VH';
                                              const title = `${meeting.attendance_probability} Attendance Probability`;
                                              return <span title={title}>{letter}</span>;
                                            }
                                            // For legacy meetings, convert probability number to letter
                                            else if (typeof probabilityNumber === 'number' && !isNaN(probabilityNumber)) {
                                              let letter, title;
                                              if (probabilityNumber >= 80) { letter = 'VH'; title = 'Very High Attendance Probability'; }
                                              else if (probabilityNumber >= 60) { letter = 'H'; title = 'High Attendance Probability'; }
                                              else if (probabilityNumber >= 40) { letter = 'M'; title = 'Medium Attendance Probability'; }
                                              else { letter = 'L'; title = 'Low Attendance Probability'; }
                                              return <span title={title}>{letter}</span>;
                                            }
                                            return 'N/A';
                                          })()}
                                          {(() => {
                                            const probability = meeting.lead?.probability ?? meeting.probability;
                                            const probabilityNumber = typeof probability === 'string' ? parseFloat(probability) : probability;
                                            return typeof probabilityNumber === 'number' && !isNaN(probabilityNumber) ? ` ${probabilityNumber}%` : '';
                                          })()}
                                        </span>
                                        {((meeting.meeting_location || meeting.location || getLegacyMeetingLocation(meeting.meeting_location_id))?.toLowerCase().includes('tlv with parking')) && (
                                          <TruckIcon
                                            className="w-6 h-6 text-blue-600 cursor-help"
                                            title={getLegacyCarNumber(meeting) ? `Car Number: ${getLegacyCarNumber(meeting)}` : 'TLV with parking location'}
                                          />
                                        )}
                                        {(meeting.complexity === 'Complex' || getLegacyMeetingComplexity(meeting.meeting_complexity) === 'Complex') && (
                                          <BookOpenIcon
                                            className="w-6 h-6 text-purple-600"
                                            title="Complex Meeting"
                                          />
                                        )}
                                      </div>
                                    </td>

                                    {/* Manager Assignment */}
                                    <td className="overflow-visible text-base">
                                      <div className="relative">
                                        {(() => {
                                          const state = getMeetingDropdownState(meeting.id);
                                          const hasManager = meeting.meeting_manager && meeting.meeting_manager !== '--' && meeting.meeting_manager.trim() !== '';
                                          return (
                                            <>
                                              <div className="flex items-center gap-2">
                                                <input
                                                  type="text"
                                                  placeholder={meeting.meeting_manager || "Select manager..."}
                                                  className={`input input-md input-bordered w-full pr-8 cursor-pointer staff-dropdown-input ${!hasManager ? 'border-red-500 bg-red-50' : ''}`}
                                                  value={state.managerSearch}
                                                  onChange={(e) => updateMeetingDropdownState(meeting.id, { managerSearch: e.target.value })}
                                                  onFocus={(e) => {
                                                    updateMeetingDropdownState(meeting.id, { showManagerDropdown: true, managerSearch: '' });
                                                    handleDropdownOpen(meeting.id, 'manager', e.target);
                                                  }}
                                                  onBlur={() => setTimeout(() => {
                                                    updateMeetingDropdownState(meeting.id, { showManagerDropdown: false });
                                                    handleDropdownClose();
                                                  }, 500)}
                                                />
                                                <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                                                  <ChevronDownIcon className="w-4 h-4 text-gray-400" />
                                                </div>
                                              </div>
                                            </>
                                          );
                                        })()}
                                      </div>
                                    </td>

                                    {/* Helper Assignment */}
                                    <td className="overflow-visible text-base">
                                      <div className="relative">
                                        {(() => {
                                          const state = getMeetingDropdownState(meeting.id);
                                          return (
                                            <>
                                              <div className="flex items-center gap-2">
                                                <input
                                                  type="text"
                                                  placeholder={meeting.helper || "Select helper..."}
                                                  className="input input-md input-bordered w-full pr-8 cursor-pointer staff-dropdown-input"
                                                  value={state.helperSearch}
                                                  onChange={(e) => updateMeetingDropdownState(meeting.id, { helperSearch: e.target.value })}
                                                  onFocus={(e) => {
                                                    updateMeetingDropdownState(meeting.id, { showHelperDropdown: true, helperSearch: '' });
                                                    handleDropdownOpen(meeting.id, 'helper', e.target);
                                                  }}
                                                  onBlur={() => setTimeout(() => {
                                                    updateMeetingDropdownState(meeting.id, { showHelperDropdown: false });
                                                    handleDropdownClose();
                                                  }, 500)}
                                                />
                                                <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                                                  <ChevronDownIcon className="w-4 h-4 text-gray-400" />
                                                </div>
                                              </div>
                                            </>
                                          );
                                        })()}
                                      </div>
                                    </td>

                                    {/* Scheduler */}
                                    <td className="text-base w-20 min-w-[5rem]">
                                      {meeting.calendar_type === 'staff' ? (
                                        null
                                      ) : (
                                        <div className="flex flex-col items-center gap-0.5 w-14 flex-shrink-0">
                                          {renderEmployeeAvatar(lead.scheduler_id || lead.scheduler || meeting.scheduler, 'lg', false)}
                                          <span className="text-xs text-center leading-tight">{getEmployeeDisplayName(lead.scheduler || meeting.scheduler)}</span>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <CalendarIcon className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                        <h3 className="text-lg font-semibold text-gray-600 mb-2">No Meetings Found</h3>
                        <p className="text-gray-500">
                          {hasMeetingsForDate(modalSelectedDate)
                            ? "No meetings match the selected staff filter for this date."
                            : `No meetings scheduled for ${new Date(modalSelectedDate).toLocaleDateString('en-US', {
                              weekday: 'long',
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric'
                            })}.`
                          }
                        </p>
                        {!hasMeetingsForDate(modalSelectedDate) && (
                          <div className="mt-4">
                            <p className="text-sm text-gray-400 mb-2">Available dates with meetings:</p>
                            <div className="flex flex-wrap gap-2 justify-center">
                              {getAvailableDates().slice(0, 5).map(date => (
                                <button
                                  key={date}
                                  onClick={() => setModalSelectedDate(date)}
                                  className="btn btn-xs btn-outline text-gray-600 hover:bg-gray-100"
                                >
                                  {new Date(date).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric'
                                  })}
                                </button>
                              ))}
                              {getAvailableDates().length > 5 && (
                                <span className="text-xs text-gray-400 self-center">
                                  +{getAvailableDates().length - 5} more
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}


                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Floating Action Buttons - Fixed position on right side */}
      {selectedRowId && (() => {
        const selectedMeetingForActions = meetings.find(m => m.id === selectedRowId) || filteredMeetings.find(m => m.id === selectedRowId);
        if (!selectedMeetingForActions || !selectedMeetingForActions.lead || selectedMeetingForActions.calendar_type === 'staff') return null;
        const lead = selectedMeetingForActions.lead;

        return (
          <>
            {/* Overlay to close buttons */}
            <div
              className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
              onClick={() => {
                setShowActionMenu(false);
                setSelectedRowId(null);
                setSelectedLeadForActions(null);
              }}
            />

            {/* Floating Action Buttons - Centered vertically on right side */}
            <div className="fixed right-6 top-1/2 -translate-y-1/2 z-50 flex flex-col items-end gap-3">
              {/* Call Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">Call</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCall(lead);
                    setShowActionMenu(false);
                    setSelectedRowId(null);
                    setSelectedLeadForActions(null);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="Call"
                >
                  <PhoneIcon className="w-6 h-6" />
                </button>
              </div>

              {/* Email Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">Email</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEmail(lead, selectedMeetingForActions);
                    setShowActionMenu(false);
                    setSelectedRowId(null);
                    setSelectedLeadForActions(null);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="Email"
                >
                  <EnvelopeIcon className="w-6 h-6" />
                </button>
              </div>

              {/* WhatsApp Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">WhatsApp</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleWhatsApp(lead, selectedMeetingForActions);
                    setShowActionMenu(false);
                    setSelectedRowId(null);
                    setSelectedLeadForActions(null);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="WhatsApp"
                >
                  <FaWhatsapp className="w-6 h-6" />
                </button>
              </div>

              {/* Timeline Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">Timeline</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTimeline(lead);
                    setShowActionMenu(false);
                    setSelectedRowId(null);
                    setSelectedLeadForActions(null);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="Timeline"
                >
                  <ClockIcon className="w-6 h-6" />
                </button>
              </div>

              {/* Edit Lead Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">Edit Lead</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEditLead(lead);
                    setShowActionMenu(false);
                    setSelectedRowId(null);
                    setSelectedLeadForActions(null);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="Edit Lead"
                >
                  <PencilSquareIcon className="w-6 h-6" />
                </button>
              </div>

              {/* View Client Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">View Client</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleViewClient(lead);
                    setShowActionMenu(false);
                    setSelectedRowId(null);
                    setSelectedLeadForActions(null);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="View Client"
                >
                  <EyeIcon className="w-6 h-6" />
                </button>
              </div>

              {/* Documents Button */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-lg bg-black/50 px-3 py-1 rounded-lg">Documents</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDocuments(lead, selectedMeetingForActions);
                    setShowActionMenu(false);
                    setSelectedRowId(null);
                    setSelectedLeadForActions(null);
                  }}
                  className="btn btn-circle btn-lg shadow-2xl btn-primary hover:scale-110 transition-all duration-300"
                  title="Documents"
                >
                  <FolderIcon className="w-6 h-6" />
                </button>
              </div>
            </div>
          </>
        );
      })()}

      {/* Document Modal */}
      <DocumentModal
        isOpen={isDocumentModalOpen}
        onClose={() => {
          setIsDocumentModalOpen(false);
          setSelectedMeeting(null);
        }}
        leadNumber={selectedMeeting?.lead?.lead_number || selectedMeeting?.lead_number || ''}
        clientName={selectedMeeting?.lead?.name || selectedMeeting?.name || ''}
        onDocumentCountChange={() => { }}
      />


      {/* Portal-based Dropdown */}
      {activeDropdown && createPortal(
        <div
          data-portal-dropdown
          className="fixed z-[9999] max-h-32 overflow-y-auto border border-gray-200 rounded-lg bg-white shadow-lg"
          style={{
            left: dropdownPosition?.x || 0,
            ...(dropdownPosition?.openUpward
              ? { bottom: window.innerHeight - (dropdownPosition.y || 0), top: 'auto' }
              : { top: dropdownPosition?.y || 0, bottom: 'auto' }
            ),
            width: dropdownPosition?.width || 200,
            minWidth: '200px'
          }}
        >
          <div
            className="px-3 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-100"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleAssignStaff(activeDropdown.meetingId, activeDropdown.type === 'manager' ? 'meeting_manager' : 'helper', '');
              updateMeetingDropdownState(activeDropdown.meetingId, {
                [activeDropdown.type === 'manager' ? 'managerSearch' : 'helperSearch']: '',
                [activeDropdown.type === 'manager' ? 'showManagerDropdown' : 'showHelperDropdown']: false
              });
              handleDropdownClose();
            }}
          >
            <span className="text-sm text-gray-600">Clear assignment</span>
          </div>
          {availableStaff
            .filter(staff => {
              const state = getMeetingDropdownState(activeDropdown.meetingId);
              const searchTerm = activeDropdown.type === 'manager' ? state.managerSearch : state.helperSearch;
              return staff.toLowerCase().includes(searchTerm.toLowerCase());
            })
            .map((staff, index) => {
              const meeting = assignStaffMeetings.find(m => m.id === activeDropdown.meetingId);
              const isUnavailable = meeting ? isStaffUnavailable(staff, meeting.meeting_date, meeting.meeting_time) : false;
              return (
                <div
                  key={`${staff}-${index}-${activeDropdown.meetingId}-${activeDropdown.type}`}
                  className={`px-3 py-2 border-b border-gray-100 ${isUnavailable
                    ? 'bg-red-50 text-red-600 hover:bg-red-100'
                    : 'hover:bg-gray-100'
                    } cursor-pointer`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Always allow assignment - confirmation dialog will handle unavailability
                    handleAssignStaff(activeDropdown.meetingId, activeDropdown.type === 'manager' ? 'meeting_manager' : 'helper', staff);
                    updateMeetingDropdownState(activeDropdown.meetingId, {
                      [activeDropdown.type === 'manager' ? 'managerSearch' : 'helperSearch']: '',
                      [activeDropdown.type === 'manager' ? 'showManagerDropdown' : 'showHelperDropdown']: false
                    });
                    handleDropdownClose();
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm">{staff}</span>
                    {isUnavailable && (
                      <div className="flex items-center gap-1">
                        <ClockIcon className="w-3 h-3" />
                        <span className="text-xs">Unavailable</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </div>,
        document.body
      )}

      {/* Teams Meeting Modal */}
      <TeamsMeetingModal
        isOpen={isTeamsMeetingModalOpen}
        onClose={() => {
          setIsTeamsMeetingModalOpen(false);
          // Refetch after a short delay so the new meeting is committed before we query (avoids "appears then disappears")
          setTimeout(() => setMeetingsRefreshTrigger(prev => prev + 1), 400);
        }}
        selectedDate={selectedDateForMeeting || undefined}
        selectedTime={selectedTimeForMeeting}
        staffEmployees={allEmployees}
      />

      {/* Staff Meeting Edit Modal */}
      <StaffMeetingEditModal
        isOpen={isStaffMeetingEditModalOpen}
        onClose={() => setIsStaffMeetingEditModalOpen(false)}
        meeting={selectedStaffMeeting}
        onUpdate={() => {
          // Refresh staff meetings when updated
          if (appliedFromDate && appliedToDate) {
            fetchStaffMeetings(appliedFromDate, appliedToDate);
          }
        }}
        onDelete={() => {
          // Refresh staff meetings when deleted
          if (appliedFromDate && appliedToDate) {
            fetchStaffMeetings(appliedFromDate, appliedToDate);
          }
        }}
      />
    </div>
  );
};

export default CalendarPage; 