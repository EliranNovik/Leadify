import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarIcon, FunnelIcon, UserIcon, CurrencyDollarIcon, VideoCameraIcon, ChevronDownIcon, DocumentArrowUpIcon, FolderIcon, ClockIcon, ChevronLeftIcon, ChevronRightIcon, AcademicCapIcon, QuestionMarkCircleIcon, XMarkIcon, PaperAirplaneIcon, FaceSmileIcon, PaperClipIcon, Bars3Icon, Squares2X2Icon, UserGroupIcon, TruckIcon, BookOpenIcon, FireIcon, PencilIcon, PhoneIcon, EyeIcon, PencilSquareIcon, CheckIcon, CheckBadgeIcon, XCircleIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import DocumentModal from './DocumentModal';
import { FaWhatsapp } from 'react-icons/fa';
import { EnvelopeIcon } from '@heroicons/react/24/outline';
import { createPortal } from 'react-dom';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../msalConfig';
import { toast } from 'react-hot-toast';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { useRef } from 'react';
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

// Helper to get current user's full name from Supabase
async function fetchCurrentUserFullName() {
  const { data: { user } } = await supabase.auth.getUser();
  if (user && user.email) {
    const { data, error } = await supabase
      .from('users')
      .select('full_name')
      .eq('email', user.email)
      .single();
    if (!error && data?.full_name) {
      return data.full_name;
    }
  }
  return null;
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
    } catch (e) {}
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
  const [meetings, setMeetings] = useState<any[]>([]);
  const [filteredMeetings, setFilteredMeetings] = useState<any[]>([]);
  const [staff, setStaff] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState(new Date().toISOString().split('T')[0]);
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]);
  const [appliedFromDate, setAppliedFromDate] = useState(new Date().toISOString().split('T')[0]);
  const [appliedToDate, setAppliedToDate] = useState(new Date().toISOString().split('T')[0]);
  const [datesManuallySet, setDatesManuallySet] = useState(false);
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
        if (!user?.id) {
          return;
        }
        const { data, error } = await supabase
          .from('users')
          .select('employee_id, full_name, email')
          .eq('auth_id', user.id)
          .single();
        if (error || !data) {
          return;
        }
        if (data.employee_id !== null && data.employee_id !== undefined && !Number.isNaN(Number(data.employee_id))) {
          setCurrentEmployeeId(Number(data.employee_id));
        }
        setCurrentEmployeeName(data.full_name || user.email || '');
      } catch (error) {
        console.error('Failed to load current employee info for meeting confirmation toggle:', error);
      }
    };

    fetchCurrentEmployeeMetadata();
  }, []);

  useEffect(() => {
    setStaffSearchTerm(selectedStaff);
  }, [selectedStaff]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        staffDropdownRef.current &&
        !staffDropdownRef.current.contains(event.target as Node)
      ) {
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

  // Assign Staff Modal State
  const [isAssignStaffModalOpen, setIsAssignStaffModalOpen] = useState(false);
  const [assignStaffMeetings, setAssignStaffMeetings] = useState<any[]>([]);
  const [assignStaffLoading, setAssignStaffLoading] = useState(false);
  const [availableStaff, setAvailableStaff] = useState<string[]>([]);
  const [modalSelectedDate, setModalSelectedDate] = useState<string>('');
  const [selectedStaffFilter, setSelectedStaffFilter] = useState<string>('');
  
  // Employee Availability State
  const [employeeAvailability, setEmployeeAvailability] = useState<{[key: string]: any[]}>({});
  const [unavailableEmployees, setUnavailableEmployees] = useState<{[key: string]: any[]}>({});
  const [showMoreUnavailableDropdown, setShowMoreUnavailableDropdown] = useState(false);
  const [meetingCounts, setMeetingCounts] = useState<{[clientId: string]: number}>({});
  const [previousManagers, setPreviousManagers] = useState<{[meetingId: number]: string}>({});
  const [meetingLocations, setMeetingLocations] = useState<{[locationId: number]: string}>({});
  // Map of meeting location name -> default_link (from tenants_meetinglocation)
  const [meetingLocationLinks, setMeetingLocationLinks] = useState<{[locationName: string]: string}>({});
  const [dropdownPosition, setDropdownPosition] = useState<{ x: number; y: number; width: number } | null>(null);
  const [activeDropdown, setActiveDropdown] = useState<{ meetingId: number; type: 'manager' | 'helper' } | null>(null);
  const [dropdownStates, setDropdownStates] = useState<{
    [meetingId: number]: {
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
  

  // Helper function to get employee display name from ID
  const getEmployeeDisplayName = (employeeId: string | number | null | undefined) => {
    if (!employeeId || employeeId === '---' || employeeId === '--') return '--';
    // Find employee in the loaded employees array
    // Convert both to string for comparison since employeeId might be bigint
    const employee = allEmployees.find((emp: any) => emp.id.toString() === employeeId.toString());
    return employee ? employee.display_name : employeeId.toString(); // Fallback to ID if not found
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
          const { data: userRecord, error: userError } = await supabase
            .from('users')
            .select('employee_id, full_name, email')
            .eq('auth_id', user.id)
            .single();
          if (!userError && userRecord) {
            if (employeeIdToUse === null && userRecord.employee_id !== null && userRecord.employee_id !== undefined) {
              const parsedId = Number(userRecord.employee_id);
              if (!Number.isNaN(parsedId)) {
                employeeIdToUse = parsedId;
                setCurrentEmployeeId(parsedId);
              }
            }
            if (!currentEmployeeName) {
              const resolvedName = userRecord.full_name || user.email || '';
              setCurrentEmployeeName(resolvedName);
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
    
    // If allCategories is not loaded yet, return the original value
    if (!allCategories || allCategories.length === 0) {
      return String(categoryId);
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
    
    return String(categoryId); // Fallback to original value if not found
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
        // Fetch all employees to match emails with display names
        const { data: employeesData, error: employeesError } = await supabase
          .from('tenants_employee')
          .select('id, display_name')
          .not('display_name', 'is', null);

        if (employeesError) {
          console.error('Error fetching employees:', employeesError);
          return;
        }

        // Create email to display name mapping
        const emailToNameMap = new Map();
        if (employeesData) {
          employeesData.forEach(emp => {
            const email = `${emp.display_name.toLowerCase().replace(/\s+/g, '.')}@lawoffice.org.il`;
            emailToNameMap.set(email, emp.display_name);
          });
        }

        const formattedStaffMeetings = staffMeetingsData.map((meeting: any) => {
          // Extract attendees from JSONB
          const attendees = meeting.attendees || [];
          
          // Convert attendee emails to display names
          const attendeeNames = attendees.map((email: string) => {
            return emailToNameMap.get(email) || email;
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
            meeting_amount: '--',
            meeting_currency: '',
            status: 'scheduled',
            client_id: null,
            legacy_lead_id: null,
            calendar_type: 'staff',
            teams_meeting_id: meeting.teams_meeting_id,
            attendees: attendees,
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
      // Limit date range to max 7 days to prevent timeouts on large tables
      const from = new Date(fromDate);
      const to = new Date(toDate);
      const daysDiff = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysDiff > 7) {
        console.warn('Date range too large for legacy meetings, limiting to 7 days');
        const limitedTo = new Date(from);
        limitedTo.setDate(limitedTo.getDate() + 7);
        toDate = limitedTo.toISOString().split('T')[0];
        toast.error('Legacy meetings limited to 7 days to prevent timeouts. Please use a smaller date range for better performance.');
      }
      
      if (daysDiff > 14) {
        // If range is still too large, skip legacy loading entirely
        console.warn('Date range too large, skipping legacy meeting fetch');
        toast.error('Date range too large for legacy meetings. Please select a range of 14 days or less.');
        setIsLegacyLoading(false);
        return;
      }
      
      console.log('🔍 Fetching legacy leads for date range:', fromDate, 'to', toDate);
      
      // Fetch legacy leads with minimal fields - use the most selective filters first
      // Try to use indexed columns (meeting_date should be indexed)
      const { data: legacyData, error: legacyError } = await supabase
        .from('leads_lead')
        .select('id, name, meeting_date, meeting_time, lead_number, category, category_id, stage, meeting_manager_id, meeting_lawyer_id, total, meeting_total_currency_id, expert_id, probability, phone, email, mobile, meeting_location_id, expert_examination')
        .gte('meeting_date', fromDate)
        .lte('meeting_date', toDate)
        .not('meeting_date', 'is', null)
        .not('name', 'is', null)
        .limit(30) // Reduced limit to prevent timeouts
        .order('meeting_date', { ascending: true });
      
      console.log('🔍 Legacy query result:', { dataCount: legacyData?.length, error: legacyError });

      if (legacyError) {
        console.error('Error fetching legacy leads:', legacyError);
        if (legacyError.code === '57014' || legacyError.message?.includes('timeout')) {
          console.warn('Legacy query timed out - disabling legacy loading');
          setLegacyLoadingDisabled(true);
          toast.error('Loading legacy meetings timed out. Please try a smaller date range.');
        }
        setIsLegacyLoading(false);
        return;
      }

      if (legacyData && legacyData.length > 0) {
        console.log('🔍 Processing legacy data without JOINs...');
        
        // Process legacy meetings using helper functions (no JOINs to prevent timeouts)
        const processedLegacyMeetings = legacyData.map((legacyLead: any) => {
          const meeting = {
            id: `legacy_${legacyLead.id}`,
            created_at: legacyLead.meeting_date || new Date().toISOString(),
            meeting_date: legacyLead.meeting_date,
            meeting_time: legacyLead.meeting_time || '09:00',
            meeting_manager: getEmployeeDisplayName(legacyLead.meeting_manager_id),
            helper: getEmployeeDisplayName(legacyLead.meeting_lawyer_id),
            meeting_location: getLegacyMeetingLocation(legacyLead.meeting_location_id) || 'Teams',
            meeting_location_id: legacyLead.meeting_location_id,
            teams_meeting_url: null,
            meeting_brief: null,
            meeting_amount: parseFloat(legacyLead.total || '0'),
            meeting_currency: legacyLead.meeting_total_currency_id === 1 ? 'NIS' : 
                             legacyLead.meeting_total_currency_id === 2 ? 'USD' : 
                             legacyLead.meeting_total_currency_id === 3 ? 'EUR' : 'NIS',
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
              manager: getEmployeeDisplayName(legacyLead.meeting_manager_id),
              helper: getEmployeeDisplayName(legacyLead.meeting_lawyer_id),
              balance: parseFloat(legacyLead.total || '0'),
              balance_currency: legacyLead.meeting_total_currency_id === 1 ? 'NIS' : 
                               legacyLead.meeting_total_currency_id === 2 ? 'USD' : 
                               legacyLead.meeting_total_currency_id === 3 ? 'EUR' : 'NIS',
              expert: getEmployeeDisplayName(legacyLead.expert_id),
              expert_examination: legacyLead.expert_examination || '',
              probability: parseFloat(legacyLead.probability || '0'),
              category_id: legacyLead.category_id || null, // CRITICAL: Set category_id for grouping
              category: getCategoryName(legacyLead.category_id) || legacyLead.category || 'Unassigned',
              language: null,
              onedrive_folder_link: '',
              expert_notes: '',
              manual_interactions: [],
              lead_type: 'legacy' as const,
              department_name: 'Unassigned', // Will be populated by DepartmentList grouping logic
              department_id: null
            }
          };
          return meeting;
        });

        // Add legacy meetings to the current meetings
        setMeetings(prevMeetings => {
          const filteredMeetings = prevMeetings.filter(meeting => 
            !(meeting.lead?.lead_type === 'legacy' && meeting.meeting_date >= fromDate && meeting.meeting_date <= toDate)
          );
          const allMeetings = [...filteredMeetings, ...processedLegacyMeetings];
          return allMeetings;
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

  useEffect(() => {
    console.log('🔍 CalendarPage useEffect: useEffect triggered');
    const fetchMeetingsAndStaff = async () => {
      console.log('🔍 CalendarPage useEffect: fetchMeetingsAndStaff started');
      setIsLoading(true);
      
      try {
        // Fetch all employees for name lookup - only active users
        const { data: employeesData, error: employeesError } = await supabase
          .from('users')
          .select(`
            id,
            full_name,
            email,
            employee_id,
            is_active,
            tenants_employee!employee_id(
              id,
              display_name,
              bonuses_role
            )
          `)
          .not('employee_id', 'is', null)
          .eq('is_active', true);
        
        if (!employeesError && employeesData) {
          // Process the data to match the expected format
          const processedEmployees = employeesData
            .filter(user => user.tenants_employee && user.email)
            .map(user => {
              const employee = user.tenants_employee as any;
              return {
                id: employee.id,
                display_name: employee.display_name,
                bonuses_role: employee.bonuses_role
              };
            })
            .sort((a, b) => a.display_name.localeCompare(b.display_name));

          // Deduplicate by employee ID to prevent duplicates
          const uniqueEmployeesMap = new Map();
          processedEmployees.forEach(emp => {
            if (!uniqueEmployeesMap.has(emp.id)) {
              uniqueEmployeesMap.set(emp.id, emp);
            }
          });
          const uniqueEmployees = Array.from(uniqueEmployeesMap.values());
          
          setAllEmployees(uniqueEmployees);
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
        
        if (!categoriesError && categoriesData) {
          setAllCategories(categoriesData);
        }


        // Initialize stage names cache
        const stageNames = await fetchStageNames();
        console.log('🔍 Calendar - Stage names fetched:', stageNames);
        
        // If no stage names were fetched, try to refresh the cache
        if (!stageNames || Object.keys(stageNames).length === 0) {
          console.log('🔍 Calendar - No stage names found, refreshing cache...');
          const refreshedStageNames = await refreshStageNames();
          console.log('🔍 Calendar - Refreshed stage names:', refreshedStageNames);
        }
        
        // Mark stage names as loaded
        setStageNamesLoaded(true);

        // Create a helper function to get category name using the loaded data
        const getCategoryNameFromData = (categoryId: string | number | null | undefined) => {
          if (!categoryId || categoryId === '---') return '';
          
          // Use the categories data directly instead of state
          const categoryById = categoriesData?.find((cat: any) => cat.id.toString() === categoryId.toString());
          if (categoryById) return categoryById.name;
          
          const categoryByName = categoriesData?.find((cat: any) => cat.name === categoryId);
          if (categoryByName) return categoryByName.name;
          
          return String(categoryId);
        };

        // First, load today's meetings for immediate display - MINIMAL DATA ONLY
        const today = new Date().toISOString().split('T')[0];
        console.log('🔍 CalendarPage: Starting fetchMeetingsAndStaff for date:', today);
        
        // Load today's meetings with department JOINs - include legacy_lead join for meetings with legacy_lead_id
        console.log('🔍 Executing JOIN query for meetings on date:', today);
        const { data: todayMeetingsData, error: todayMeetingsError } = await supabase
        .from('meetings')
        .select(`
          id, meeting_date, meeting_time, meeting_manager, helper, meeting_location, teams_meeting_url,
          meeting_amount, meeting_currency, status, client_id, legacy_lead_id,
          attendance_probability, complexity, car_number, calendar_type,
          lead:leads!client_id(
            id, name, lead_number, stage, manager, category, category_id, balance, balance_currency, 
            expert, probability, phone, email, number_of_applicants_meeting,
            meeting_confirmation, meeting_confirmation_by, eligibility_status,
            misc_category!category_id(
              id, name, parent_id,
              misc_maincategory!parent_id(
                id, name, department_id,
                tenant_departement!department_id(id, name)
              )
            )
          ),
          legacy_lead:leads_lead!legacy_lead_id(
            id, name, lead_number, stage, meeting_manager_id, meeting_lawyer_id, category, category_id,
            total, meeting_total_currency_id, expert_id, probability, phone, email, no_of_applicants, expert_examination,
            meeting_location_id, meeting_confirmation, meeting_confirmation_by,
            misc_category!category_id(
              id, name, parent_id,
              misc_maincategory!parent_id(
                id, name, department_id,
                tenant_departement!department_id(id, name)
              )
            )
          )
        `)
          .eq('meeting_date', today)
          .or('status.is.null,status.neq.canceled')
          .order('meeting_time', { ascending: true });
          
        console.log('🔍 JOIN query result:', { 
          dataCount: todayMeetingsData?.length, 
          error: todayMeetingsError,
          sampleData: todayMeetingsData?.slice(0, 2)
        });
        

        // DISABLED: Today's legacy loading removed to prevent timeouts
        let todayLegacyMeetingsData = [];
        let todayLegacyMeetingsError = null;

        // Process today's meetings immediately - SIMPLIFIED FOR SPEED
        if (!todayMeetingsError) {
          // Debug: Log raw meeting data to understand JOIN issues
          console.log('🔍 Raw meetings from database:', todayMeetingsData?.map((m: any) => ({
            id: m.id,
            calendar_type: m.calendar_type,
            legacy_lead_id: m.legacy_lead_id,
            client_id: m.client_id,
            hasLegacyLead: !!m.legacy_lead,
            hasLead: !!m.lead,
              legacyLeadName: (m.legacy_lead as any)?.name,
            legacyLeadCategory: m.legacy_lead?.category,
            legacyLeadCategoryId: m.legacy_lead?.category_id
          })));
          
          
          const startTime = performance.now();
          
          // Quick processing for today's meetings with department data
          const todayProcessedMeetings = (todayMeetingsData || []).map((meeting: any) => ({
            ...meeting,
            meeting_confirmation: getMeetingConfirmationState(meeting),
            // Map location ID to location name using universal function
            meeting_location: getMeetingLocationName(meeting.meeting_location),
            lead: meeting.legacy_lead ? {
                ...meeting.legacy_lead,
                lead_type: 'legacy',
                manager: getEmployeeDisplayName(meeting.legacy_lead.meeting_manager_id),
                helper: getEmployeeDisplayName(meeting.legacy_lead.meeting_lawyer_id),
                balance: meeting.legacy_lead.total,
                balance_currency: meeting.legacy_lead.meeting_total_currency_id,
                expert: getEmployeeDisplayName(meeting.legacy_lead.expert_id),
                category: meeting.legacy_lead.category || meeting.legacy_lead.category_id,
                lead_number: meeting.legacy_lead.id?.toString(),
                manual_interactions: [],
                // Add department info from JOINs
                department_name: meeting.legacy_lead.misc_category?.misc_maincategory?.tenant_departement?.name || 'Unassigned',
                department_id: meeting.legacy_lead.misc_category?.misc_maincategory?.department_id
            } : meeting.lead ? {
              ...meeting.lead,
              lead_type: 'new',
              // Add department info from JOINs
              department_name: meeting.lead.misc_category?.misc_maincategory?.tenant_departement?.name || 'Unassigned',
              department_id: meeting.lead.misc_category?.misc_maincategory?.department_id
            } : null
          }));

          // DISABLED: Legacy processing removed from today's meetings
          const todayProcessedLegacyMeetings: any[] = [];

          const todayAllMeetings = [...todayProcessedMeetings, ...todayProcessedLegacyMeetings];
          const loadTime = performance.now() - startTime;
          
          
          setMeetings(todayAllMeetings);
          setIsLoading(false);
        } else if (todayMeetingsError) {
          console.error('Error fetching today\'s meetings:', todayMeetingsError);
          setMeetings([]);
          setIsLoading(false);
        } else {
          // Fallback: show empty state
          setMeetings([]);
          setIsLoading(false);
        }

        // Now load all other meetings in the background - OPTIMIZED
        setIsBackgroundLoading(true);
        
        // Load all regular meetings with department JOINs - include legacy_lead join for meetings with legacy_lead_id
        const { data: meetingsData, error: meetingsError } = await supabase
        .from('meetings')
        .select(`
          id, meeting_date, meeting_time, meeting_manager, helper, meeting_location, teams_meeting_url,
          meeting_amount, meeting_currency, status, client_id, legacy_lead_id,
          attendance_probability, complexity, car_number, calendar_type,
          lead:leads!client_id(
            id, name, lead_number, onedrive_folder_link, stage, manager, category, category_id,
            balance, balance_currency, expert_notes, expert, probability, phone, email, 
            meeting_confirmation, meeting_confirmation_by, eligibility_status,
            manual_interactions, number_of_applicants_meeting, meeting_collection_id,
            misc_category!category_id(
              id, name, parent_id,
              misc_maincategory!parent_id(
                id, name, department_id,
                tenant_departement!department_id(id, name)
              )
            )
          ),
          legacy_lead:leads_lead!legacy_lead_id(
            id, name, lead_number, stage, meeting_manager_id, meeting_lawyer_id, category, category_id,
            total, meeting_total_currency_id, expert_id, probability, phone, email, no_of_applicants, expert_examination,
            meeting_location_id, meeting_collection_id, meeting_confirmation, meeting_confirmation_by,
            misc_category!category_id(
              id, name, parent_id,
              misc_maincategory!parent_id(
                id, name, department_id,
                tenant_departement!department_id(id, name)
              )
            )
          )
        `)
          .or('status.is.null,status.neq.canceled')
          .order('meeting_date', { ascending: false });

        // DISABLED: Background legacy loading removed to prevent timeouts

        // For now, set empty legacy data so we don't block the main flow
        let legacyMeetingsData = [];
        let legacyMeetingsError = null;
        
        // Process all meetings in the background
        if (meetingsError) {
          console.error('Error fetching all meetings:', meetingsError);
        } else {
          // Process regular meetings only - NO LEGACY PROCESSING to prevent duplicates
          const processedMeetings = (meetingsData || [])
            .filter((meeting: any) => {
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
            .map((meeting: any) => {
              // Process both regular and legacy meetings with department data
              let leadData = null;
              
              if (meeting.legacy_lead) {
                // Use legacy lead data with department info from JOINs
                leadData = {
                  ...meeting.legacy_lead,
                  lead_type: 'legacy',
                  manager: getEmployeeDisplayName(meeting.legacy_lead.meeting_manager_id),
                  helper: getEmployeeDisplayName(meeting.legacy_lead.meeting_lawyer_id),
                  balance: meeting.legacy_lead.total,
                  balance_currency: meeting.legacy_lead.meeting_total_currency_id,
                  expert: getEmployeeDisplayName(meeting.legacy_lead.expert_id),
                  category: meeting.legacy_lead.category || meeting.legacy_lead.category_id,
                  lead_number: meeting.legacy_lead.id?.toString(),
                  // Add department info from JOINs
                  department_name: meeting.legacy_lead.misc_category?.misc_maincategory?.tenant_departement?.name || 'Unassigned',
                  department_id: meeting.legacy_lead.misc_category?.misc_maincategory?.department_id
                };
              } else if (meeting.lead) {
                // Use new lead data with department info from JOINs
                leadData = {
                  ...meeting.lead,
                  lead_type: 'new',
                  // Add department info from JOINs
                  department_name: meeting.lead.misc_category?.misc_maincategory?.tenant_departement?.name || 'Unassigned',
                  department_id: meeting.lead.misc_category?.misc_maincategory?.department_id
                };
              }
              
              return {
                ...meeting,
                meeting_confirmation: getMeetingConfirmationState(meeting),
                // Map location ID to location name using universal function
                meeting_location: getMeetingLocationName(meeting.meeting_location),
                lead: leadData
              };
            });
          
          // Count both regular and legacy meetings
          const newCount = processedMeetings.filter(m => m.lead?.lead_type === 'new').length;
          const legacyCount = processedMeetings.filter(m => m.lead?.lead_type === 'legacy').length;
          
          
          
          
          // Update meetings state with regular meetings only
          setMeetings(processedMeetings);
          setIsBackgroundLoading(false);
        }

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

        // Fetch leads that have passed stage 40 (Waiting for Mtng sum) or 35 (Meeting Irrelevant)
        const fetchLeadsWithPastStages = async () => {
          try {
            // Query for legacy leads (using lead_id)
            const { data: legacyStageData, error: legacyError } = await supabase
              .from('leads_leadstage')
              .select('lead_id')
              .in('stage', [35, 40])
              .not('lead_id', 'is', null);

            // Query for new leads (using newlead_id)
            const { data: newStageData, error: newError } = await supabase
              .from('leads_leadstage')
              .select('newlead_id')
              .in('stage', [35, 40])
              .not('newlead_id', 'is', null);

            const leadIds = new Set<string>();

            // Add legacy lead IDs
            if (!legacyError && legacyStageData) {
              legacyStageData.forEach((entry: any) => {
                if (entry.lead_id) {
                  leadIds.add(`legacy_${entry.lead_id}`);
                }
              });
            }

            // Add new lead IDs
            if (!newError && newStageData) {
              newStageData.forEach((entry: any) => {
                if (entry.newlead_id) {
                  leadIds.add(entry.newlead_id);
                }
              });
            }

            setLeadsWithPastStages(leadIds);
            console.log('✅ Calendar: Loaded leads with past stages (40 or 35):', leadIds.size);
          } catch (error) {
            console.error('Error fetching leads with past stages:', error);
          }
        };

        await fetchLeadsWithPastStages();
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
  }, []);

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
        const tableName = meeting.lead.lead_type === 'legacy' ? 'leads_lead' : 'leads';
        let leadId;
        
        if (meeting.lead.lead_type === 'legacy') {
          // For legacy meetings, extract the original ID from the prefixed ID
          leadId = meeting.id.startsWith('legacy_') ? meeting.id.replace('legacy_', '') : meeting.legacy_lead_id;
        } else {
          leadId = meeting.client_id;
        }
        
        // Fetch expert_notes, handler_notes, and facts/description
        const fieldsToSelect = meeting.lead.lead_type === 'legacy' 
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
            facts: meeting.lead.lead_type === 'legacy' ? (data as any).description : (data as any).facts
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
    if (expandedMeetingId) {
      const meeting = meetings.find(m => m.id === expandedMeetingId);
      if (meeting && meeting.lead && meeting.lead.id) {
        fetchExpandedMeetingData(meeting);
      }
    }
  }, [expandedMeetingId, meetings]);

  // Load staff meetings when applied date range changes (but NOT legacy meetings - those are only loaded via Show button)
  useEffect(() => {
    // Only fetch data when both applied dates are set and user has manually set them
    if (appliedFromDate && appliedToDate && appliedFromDate.trim() !== '' && appliedToDate.trim() !== '' && datesManuallySet) {
      // Always load staff meetings for the date range
      fetchStaffMeetings(appliedFromDate, appliedToDate);
      // Legacy meetings are NOT loaded here - only when Show button is clicked
    }
  }, [appliedFromDate, appliedToDate, datesManuallySet]);

  useEffect(() => {
    // Combine regular meetings and staff meetings
    const allMeetings = [...meetings, ...staffMeetings];
    let filtered = allMeetings;

    if (appliedFromDate && appliedToDate) {
      const beforeFilter = filtered.length;
      filtered = filtered.filter(m => m.meeting_date >= appliedFromDate && m.meeting_date <= appliedToDate);
    }

    if (selectedStaff) {
      const beforeFilter = filtered.length;
      filtered = filtered.filter(m => {
        const lead = m.lead || {};
        const matches = (
          lead.manager === selectedStaff ||
          lead.helper === selectedStaff ||
          m.meeting_manager === selectedStaff ||
          m.helper === selectedStaff ||
          m.expert === selectedStaff ||
          lead.expert === selectedStaff
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
      
      // First try to get amount from lead.balance
      if (typeof lead.balance === 'number' && lead.balance > 0) {
        amount = lead.balance;
        currency = lead.balance_currency || 'NIS';
        source = 'lead.balance';
      }
      // Fallback to meeting_amount if lead.balance is not available
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
      
      
      // Convert to NIS and add to total
      const amountInNIS = convertToNIS(amount, currency);
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
          className="inline-flex items-center px-1.5 py-0.5 sm:px-2 sm:py-0.5 md:px-3 md:py-1 rounded-md sm:rounded-lg text-[10px] sm:text-xs md:text-sm font-semibold border"
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
        className="inline-flex items-center px-1.5 py-0.5 sm:px-2 sm:py-0.5 md:px-3 md:py-1 rounded-md sm:rounded-lg text-[10px] sm:text-xs md:text-sm font-semibold shadow-sm"
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

  const handleViewClient = (lead: any) => {
    navigate(`/clients/${lead.lead_number}`);
  };

  const handleEmail = (lead: any, meeting: any) => {
    handleEmailClick(lead, meeting);
  };

  const handleWhatsApp = (lead: any, meeting: any) => {
    handleWhatsAppClick(lead, meeting);
  };

  const handleTimeline = (lead: any) => {
    navigate(`/clients/${lead.lead_number}?tab=interactions`);
  };

  const handleEditLead = (lead: any) => {
    navigate(`/clients/${lead.lead_number}?tab=info`);
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
          teams_meeting_url, meeting_brief, status, client_id, legacy_lead_id
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
          .select('id, name, lead_number, stage, manager, category, category_id, balance, balance_currency, expert_notes, expert, probability, phone, email, language, number_of_applicants_meeting, eligibility_status')
          .in('id', uniqueClientIds)
          .limit(500);

        if (leadsError) {
          console.error('Error fetching leads:', leadsError);
        } else if (leadsData) {
          leadsData.forEach(lead => {
            leadsMap[lead.id] = lead;
          });
        }
      }

      const legacyLeadsMap: Record<string, any> = {};
      if (uniqueLegacyLeadIds.length > 0) {
        const { data: legacyLeadsData, error: legacyLeadsError } = await supabase
          .from('leads_lead')
          .select('id, name, lead_number, stage, meeting_manager_id, meeting_lawyer_id, category, category_id, total, meeting_total_currency_id, probability, phone, email, mobile, topic, language_id')
          .in('id', uniqueLegacyLeadIds)
          .limit(500);

        if (legacyLeadsError) {
          console.error('Error fetching legacy leads:', legacyLeadsError);
        } else if (legacyLeadsData) {
          legacyLeadsData.forEach(legacyLead => {
            legacyLeadsMap[String(legacyLead.id)] = legacyLead;
          });
        }
      }


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
            // Use new lead data from the map
            const lead = leadsMap[meeting.client_id];
            leadData = {
              ...lead,
              lead_type: 'new'
            };
          } else if (meeting.legacy_lead_id && legacyLeadsMap[String(meeting.legacy_lead_id)]) {
            const legacyLead = legacyLeadsMap[String(meeting.legacy_lead_id)];
            leadData = {
              ...legacyLead,
              lead_type: 'legacy',
              manager: getEmployeeDisplayName(legacyLead.meeting_manager_id),
              helper: getEmployeeDisplayName(legacyLead.meeting_lawyer_id),
              balance: legacyLead.total,
              balance_currency: legacyLead.meeting_total_currency_id,
              language: legacyLead.language_id,
              phone: legacyLead.phone || legacyLead.mobile || '',
              lead_number: legacyLead.lead_number || legacyLead.id?.toString()
            };
          }
          
          return {
            ...meeting,
            lead: leadData
          };
        });

      const allMeetings = processedMeetings;

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

      const locationsMap: {[locationId: number]: string} = {};
      const linksMap: {[locationName: string]: string} = {};
      locationsData?.forEach(location => {
        locationsMap[location.id] = location.name;
        if (location.name && location.default_link) {
          linksMap[location.name] = location.default_link;
        }
      });

      setMeetingLocations(locationsMap);
      setMeetingLocationLinks(linksMap);
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
      const counts: {[clientId: string]: number} = {};
      const prevManagers: {[meetingId: number]: string} = {};

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
        .select('id, display_name, unavailable_times, unavailable_ranges')
        .not('unavailable_times', 'is', null);

      if (error) throw error;

      const availabilityMap: {[key: string]: any[]} = {};
      const unavailableMap: {[key: string]: any[]} = {};

      employeesData?.forEach(employee => {
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
            
            availabilityMap[date].push({
              employeeId: employee.id,
              employeeName: employee.display_name,
              ...unavailableTime
            });
            
            unavailableMap[date].push({
              employeeId: employee.id,
              employeeName: employee.display_name,
              ...unavailableTime
            });
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
              
              // Add range as all-day unavailable
              const rangeUnavailable = {
                employeeId: employee.id,
                employeeName: employee.display_name,
                date: dateString,
                startTime: 'All Day',
                endTime: 'All Day',
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
      const fallbackMap: {[key: number]: string} = {
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
    const fallbackMap: {[key: number]: string} = {
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
  const handleDropdownOpen = (meetingId: number, type: 'manager' | 'helper', inputRef: HTMLInputElement) => {
    const rect = inputRef.getBoundingClientRect();
    setDropdownPosition({
      x: rect.left,
      y: rect.bottom + window.scrollY,
      width: rect.width
    });
    setActiveDropdown({ meetingId, type });
  };

  const handleDropdownClose = () => {
    setActiveDropdown(null);
    setDropdownPosition(null);
  };

  const handleAssignStaff = async (meetingId: number, field: 'meeting_manager' | 'helper', value: string) => {
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


      // Update meetings table
      const { error: meetingError } = await supabase
        .from('meetings')
        .update({ [field]: value })
        .eq('id', meetingId);

      if (meetingError) throw meetingError;

      // Update the appropriate lead table based on lead type
      if (meeting.lead?.lead_type === 'legacy') {
        // For legacy leads, update leads_lead table
        let leadId;
        if (meeting.id.startsWith('legacy_')) {
          // Extract original ID from prefixed ID
          leadId = meeting.id.replace('legacy_', '');
        } else {
          leadId = meeting.legacy_lead_id;
        }
        
        const updateField = field === 'meeting_manager' ? 'meeting_manager_id' : 'meeting_lawyer_id';
        
        const { error: leadError } = await supabase
          .from('leads_lead')
          .update({ [updateField]: value })
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

  const openAssignStaffModal = () => {
    setIsAssignStaffModalOpen(true);
    fetchAssignStaffData();
    fetchEmployeeAvailability();
    // DISABLED: fetchMeetingCountsAndPreviousManagers(); // causing timeouts
  };

  // Helper function to get available dates from meetings
  const getAvailableDates = () => {
    const dates = [...new Set(assignStaffMeetings.map(m => m.meeting_date))].sort();
    return dates;
  };


  // Helper function to filter meetings by date and staff (for assign staff modal)
  const getFilteredMeetings = () => {
    
    let filtered = assignStaffMeetings.filter(m => m.meeting_date === modalSelectedDate);
    
    
    if (selectedStaffFilter) {
      const beforeCount = filtered.length;
      filtered = filtered.filter(m => {
        const lead = m.lead || {};
        const matches = (
          lead.manager === selectedStaffFilter ||
          lead.helper === selectedStaffFilter ||
          m.meeting_manager === selectedStaffFilter ||
          m.helper === selectedStaffFilter ||
          m.expert === selectedStaffFilter ||
          lead.expert === selectedStaffFilter
        );
        return matches;
      });
      
    }
    
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
  const getMeetingDropdownState = (meetingId: number) => {
    return dropdownStates[meetingId] || {
      managerSearch: '',
      helperSearch: '',
      showManagerDropdown: false,
      showHelperDropdown: false
    };
  };

  const updateMeetingDropdownState = (meetingId: number, updates: Partial<{
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

  // Helper function to get expert status icon and color
  const getExpertStatusIcon = (lead: any, meeting: any) => {
    if (meeting.calendar_type === 'staff') {
      return null;
    }

    // For NEW leads: use eligibility_status field (text values)
    // For LEGACY leads: use expert_examination field (numeric values)
    if (lead.lead_type !== 'legacy') {
      const eligibilityStatus = lead.eligibility_status;
      
      if (!eligibilityStatus || eligibilityStatus === '') {
        return (
          <span className="w-10 h-10 rounded-full bg-gray-400 text-white ml-2 inline-flex items-center justify-center font-semibold shadow-md" title="Expert opinion not checked">
            <QuestionMarkCircleIcon className="w-6 h-6" />
          </span>
        );
      }

      if (eligibilityStatus === 'not_feasible') {
        return (
          <span className="w-10 h-10 rounded-full bg-red-500 text-white ml-2 inline-flex items-center justify-center font-semibold shadow-md" title="Not Feasible">
            <XCircleIcon className="w-6 h-6" />
          </span>
        );
      } else if (eligibilityStatus === 'feasible_no_check') {
        return (
          <span className="w-10 h-10 rounded-full bg-green-500 text-white ml-2 inline-flex items-center justify-center font-semibold shadow-md" title="Feasible (no check)">
            <CheckCircleIcon className="w-6 h-6" />
          </span>
        );
      } else if (eligibilityStatus === 'feasible_with_check') {
        return (
          <span className="w-10 h-10 rounded-full bg-orange-500 text-white ml-2 inline-flex items-center justify-center font-semibold shadow-md" title="Feasible (with check)">
            <ExclamationTriangleIcon className="w-6 h-6" />
          </span>
        );
      }

      return (
        <span className="w-10 h-10 rounded-full bg-gray-400 text-white ml-2 inline-flex items-center justify-center font-semibold shadow-md" title="Expert opinion not checked">
          <QuestionMarkCircleIcon className="w-6 h-6" />
        </span>
      );
    }

    // For legacy leads, check expert_examination field with numeric values
    // 0 = Not checked, 1 = Not Feasible, 5 = Feasible (further check), 8 = Feasible (no check)
    const expertExamination = lead.expert_examination;

    if (!expertExamination || expertExamination === 0 || expertExamination === '0') {
      return (
        <span className="w-10 h-10 rounded-full bg-gray-400 text-white ml-2 inline-flex items-center justify-center font-semibold shadow-md" title="Expert opinion not checked">
          <QuestionMarkCircleIcon className="w-6 h-6" />
        </span>
      );
    }

    if (expertExamination === 1 || expertExamination === '1') {
      return (
        <span className="w-10 h-10 rounded-full bg-red-500 text-white ml-2 inline-flex items-center justify-center font-semibold shadow-md" title="Not Feasible">
          <XCircleIcon className="w-6 h-6" />
        </span>
      );
    } else if (expertExamination === 5 || expertExamination === '5') {
      return (
        <span className="w-10 h-10 rounded-full bg-orange-500 text-white ml-2 inline-flex items-center justify-center font-semibold shadow-md" title="Feasible (further check)">
          <ExclamationTriangleIcon className="w-6 h-6" />
        </span>
      );
    } else if (expertExamination === 8 || expertExamination === '8') {
      return (
        <span className="w-10 h-10 rounded-full bg-green-500 text-white ml-2 inline-flex items-center justify-center font-semibold shadow-md" title="Feasible (no check)">
          <CheckCircleIcon className="w-6 h-6" />
        </span>
      );
    }

    return (
      <span className="w-10 h-10 rounded-full bg-gray-400 text-white ml-2 inline-flex items-center justify-center font-semibold shadow-md" title="Expert opinion status unknown">
        <QuestionMarkCircleIcon className="w-6 h-6" />
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

    // Check if lead has passed stage 40 or 35
    const leadIdentifier = lead.lead_type === 'legacy' 
      ? (lead.id ? `legacy_${lead.id}` : meeting.legacy_lead_id ? `legacy_${meeting.legacy_lead_id}` : null)
      : (lead.id || meeting.client_id);
    const hasPassedStage = leadIdentifier && leadsWithPastStages ? leadsWithPastStages.has(String(leadIdentifier)) : false;

    return (
      <div key={meeting.id} className={`rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 border border-gray-100 group flex flex-col justify-between h-full min-h-[340px] relative pb-16 md:text-lg md:leading-relaxed ${hasPassedStage ? 'bg-green-50' : 'bg-white'} ${selectedRowId === meeting.id ? 'ring-2 ring-primary ring-offset-2' : ''}`}>
        <div 
          onClick={(e) => {
            if (meeting.calendar_type !== 'staff' && meeting.lead) {
              e.stopPropagation();
              handleRowSelect(meeting.id);
            } else {
              setExpandedMeetingId(expandedMeetingId === meeting.id ? null : meeting.id);
            }
          }} 
          className="flex-1 cursor-pointer flex flex-col"
        >
          {/* Lead Number and Name */}
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs md:text-base font-semibold text-gray-400 tracking-widest">
              {meeting.calendar_type === 'staff' ? 'STAFF' : (lead.lead_number || meeting.lead_number)}
            </span>
            <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
            <h3 className="text-lg md:text-2xl font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{lead.name || meeting.name}</h3>
            {/* Calendar type badge */}
            {(() => {
              const badge = getCalendarTypeBadgeStyles(meeting.calendar_type);
              if (!badge) return null;
              return (
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border"
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
            {/* Expert status indicator */}
            {getExpertStatusIcon(lead, meeting)}
          </div>

          {/* Stage */}
          <div className="flex justify-between items-center py-1 gap-2">
            <span className="text-xs md:text-base font-semibold text-gray-500">Stage</span>
            <div className="ml-auto">
              {getStageBadge(lead.stage ?? meeting.stage)}
            </div>
          </div>

          <div className="space-y-2 divide-y divide-gray-100">
            {/* Time */}
            <div className="flex justify-between items-center py-1">
              <span className="text-xs md:text-base font-semibold text-gray-500">Time</span>
              <span className="text-sm md:text-lg font-bold text-gray-800 ml-2">
                {meeting.meeting_time ? meeting.meeting_time.slice(0,5) : 'No time'}
              </span>
            </div>

            {/* Manager / Attendees */}
            <div className="flex justify-between items-center py-1">
              <span className="text-xs md:text-base font-semibold text-gray-500">
                {meeting.calendar_type === 'staff' ? 'Attendees' : 'Manager'}
              </span>
              <span className="text-sm md:text-lg font-bold text-gray-800 ml-2">
                {meeting.calendar_type === 'staff' ? (
                  <div className="text-right max-w-xs">
                    <div className="text-sm md:text-lg font-bold text-gray-800 break-words">
                      {meeting.meeting_manager || 'No attendees'}
                    </div>
                  </div>
                ) : (
                  getEmployeeDisplayName(lead.manager || meeting.meeting_manager) || '---'
                )}
              </span>
            </div>

            {/* Helper */}
            <div className="flex justify-between items-center py-1">
              <span className="text-xs md:text-base font-semibold text-gray-500">Helper</span>
              <span className="text-sm md:text-lg font-bold text-gray-800 ml-2">
                {meeting.calendar_type === 'staff' ? (
                  null
                ) : (
                  getEmployeeDisplayName(lead.helper || meeting.helper) || '---'
                )}
              </span>
            </div>

            {/* Category */}
            <div className="flex justify-between items-center py-1">
              <span className="text-xs md:text-base font-semibold text-gray-500">Category</span>
              <span className="text-sm md:text-lg font-bold text-gray-800 ml-2">{getCategoryName(lead.category_id, lead.category || meeting.category) || 'N/A'}</span>
            </div>

            {/* Amount */}
            <div className="flex justify-between items-center py-1">
              <span className="text-xs md:text-base font-semibold text-gray-500">Value</span>
              <span className="text-sm md:text-lg font-bold text-gray-800 ml-2">
                {lead.balance === '--' || meeting.meeting_amount === '--' 
                  ? '--'
                  : typeof lead.balance === 'number'
                  ? `${getCurrencySymbol(lead.balance_currency)}${lead.balance.toLocaleString()}`
                  : (typeof meeting.meeting_amount === 'number' ? `${getCurrencySymbol(meeting.meeting_currency)}${meeting.meeting_amount.toLocaleString()}` : '₪0')}
              </span>
            </div>

            {/* Expert */}
            <div className="flex justify-between items-center py-1">
              <span className="text-xs md:text-base font-semibold text-gray-500">Expert</span>
              <span className="text-sm md:text-lg font-bold text-gray-800 ml-2">
                {getEmployeeDisplayName(lead.expert || meeting.expert) || 'N/A'}
              </span>
            </div>

            {/* Location */}
            <div className="flex justify-between items-center py-1">
              <span className="text-xs md:text-base font-semibold text-gray-500">Location</span>
              <span className="text-sm md:text-lg font-bold text-gray-800 ml-2">
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
                    title={`Paid meeting / ${
                      meeting.meeting_amount
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

        {/* Action Buttons */}
        <div className="mt-4 flex flex-row gap-2 justify-end items-center">
          {meeting.calendar_type !== 'staff' && (
            <label
              className="cursor-pointer"
              onClick={e => e.stopPropagation()}
              title="Toggle meeting confirmation"
            >
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
            {/* Only show join button if there is a valid link and either:
                - the location is online/Teams, or
                - the location has a default_link configured,
                OR it's a staff meeting */}
            {(() => {
              const locationName = getMeetingLocationName(meeting.meeting_location || meeting.location);
              const fallbackLink = meetingLocationLinks[locationName] || '';
              const url = getValidTeamsLink(meeting.teams_meeting_url || fallbackLink);
              const hasLink = !!url;
              const hasDefaultForLocation = !!meetingLocationLinks[locationName];
              const isTeamsLike = isOnlineLocation(locationName || '');
              return hasLink && (isTeamsLike || hasDefaultForLocation || meeting.calendar_type === 'staff');
            })() && (
              <button
                className="btn btn-outline btn-primary btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  const locationName = getMeetingLocationName(meeting.meeting_location || meeting.location);
                  const fallbackLink = meetingLocationLinks[locationName] || '';
                  const url = getValidTeamsLink(meeting.teams_meeting_url || fallbackLink);
                  if (url) {
                    window.open(url, '_blank');
                  } else {
                    alert('No meeting URL available');
                  }
                }}
                title="Teams Meeting"
              >
                <VideoCameraIcon className="w-4 h-4" />
              </button>
            )}
            {/* Show edit button for staff meetings */}
            {meeting.calendar_type === 'staff' && (
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
            )}
        </div>

        {/* Expanded Details */}
        {isExpanded && (
          <div className="mt-4 p-4 border-t border-gray-100 bg-gray-50 rounded-lg">
            {expandedData.loading ? (
              <div className="flex justify-center items-center py-4">
                <span className="loading loading-spinner loading-md"></span>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-white p-3 rounded-lg">
                  <h6 className="font-semibold text-gray-800 mb-2">Expert Notes</h6>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {Array.isArray(expandedData.expert_notes) && expandedData.expert_notes.length > 0 ? (
                      expandedData.expert_notes.map((note: any) => (
                        <div key={note.id} className="bg-gray-50 p-2 rounded text-xs">
                          <div className="flex items-center gap-1 text-gray-500 mb-1">
                            <ClockIcon className="w-3 h-3" />
                            <span>{note.timestamp}</span>
                          </div>
                          <p className="text-gray-700 whitespace-pre-wrap">{note.content}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-gray-500">
                        {expandedData.expert_notes || 'No expert notes yet.'}
                      </p>
                    )}
                  </div>
                </div>
                <div className="bg-white p-3 rounded-lg">
                  <h6 className="font-semibold text-gray-800 mb-2">Handler Notes</h6>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {Array.isArray(expandedData.handler_notes) && expandedData.handler_notes.length > 0 ? (
                      expandedData.handler_notes.map((note: any) => (
                        <div key={note.id} className="bg-gray-50 p-2 rounded text-xs">
                          <div className="flex items-center gap-1 text-gray-500 mb-1">
                            <ClockIcon className="w-3 h-3" />
                            <span>{note.timestamp}</span>
                          </div>
                          <p className="text-gray-700 whitespace-pre-wrap">{note.content}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-gray-500">
                        {expandedData.handler_notes || 'No handler notes yet.'}
                      </p>
                    )}
                  </div>
                </div>
                <div className="bg-white p-3 rounded-lg">
                  <h6 className="font-semibold text-gray-800 mb-2">Facts of Case</h6>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {expandedData.facts ? (
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{expandedData.facts}</p>
                    ) : (
                      <p className="text-sm text-gray-500">No facts of case available.</p>
                    )}
                  </div>
                </div>
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
    
    // Check if lead has passed stage 40 or 35
    const leadIdentifier = lead.lead_type === 'legacy' 
      ? (lead.id ? `legacy_${lead.id}` : meeting.legacy_lead_id ? `legacy_${meeting.legacy_lead_id}` : null)
      : (lead.id || meeting.client_id);
    const hasPassedStage = leadIdentifier && leadsWithPastStages ? leadsWithPastStages.has(String(leadIdentifier)) : false;
    
    return (
      <React.Fragment key={meeting.id}>
        <tr 
          className={`hover:bg-base-200/50 ${hasPassedStage ? 'bg-green-50' : ''} ${selectedRowId === meeting.id ? 'bg-primary/5 ring-2 ring-primary ring-offset-1' : ''}`}
          onClick={() => {
            if (meeting.calendar_type !== 'staff' && meeting.lead) {
              handleRowSelect(meeting.id);
            }
          }}
          style={{ cursor: meeting.calendar_type !== 'staff' && meeting.lead ? 'pointer' : 'default' }}
        >
          <td className="font-bold">
            <div className="flex items-center gap-1 sm:gap-2">
              {meeting.calendar_type === 'staff' ? (
                <span className="text-black text-xs sm:text-sm">
                  {lead.name || meeting.name}
                </span>
              ) : (
                <Link to={`/clients/${lead.lead_number || meeting.lead_number}`} className="text-black hover:opacity-75 text-xs sm:text-sm">
                  {lead.name || meeting.name} ({lead.lead_number || meeting.lead_number})
                </Link>
              )}
              {(() => {
                const badge = getCalendarTypeBadgeStyles(meeting.calendar_type);
                if (!badge) return null;
                return (
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-bold border"
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
          </td>
          <td className="text-xs sm:text-sm">{meeting.meeting_time ? meeting.meeting_time.slice(0,5) : ''}</td>
          <td className="hidden sm:table-cell">
            {meeting.calendar_type === 'staff' ? (
              <div className="max-w-xs">
                <div className="text-xs font-medium text-gray-700">Attendees:</div>
                <div className="text-sm font-semibold text-gray-800 break-words">
                  {meeting.meeting_manager || 'No attendees'}
                </div>
              </div>
            ) : (
              <span className="text-xs sm:text-sm">{getEmployeeDisplayName(lead.manager || meeting.meeting_manager)}</span>
            )}
          </td>
          <td className="hidden md:table-cell">
            {meeting.calendar_type === 'staff' ? (
              null
            ) : (
              <span className="text-xs sm:text-sm">{getEmployeeDisplayName(lead.helper || meeting.helper)}</span>
            )}
          </td>
          <td className="hidden lg:table-cell text-xs sm:text-sm">{getCategoryName(lead.category_id, lead.category || meeting.category) || 'N/A'}</td>
          <td className="hidden sm:table-cell text-xs sm:text-sm">
            {lead.balance === '--' || meeting.meeting_amount === '--' 
              ? '--'
              : typeof lead.balance === 'number'
              ? `${getCurrencySymbol(lead.balance_currency)}${lead.balance.toLocaleString()}`
              : (typeof meeting.meeting_amount === 'number' ? `${getCurrencySymbol(meeting.meeting_currency)}${meeting.meeting_amount.toLocaleString()}` : '0')}
          </td>
          <td className="hidden lg:table-cell">
            <div className="flex flex-col gap-1">
              <span className="text-xs sm:text-sm">{getEmployeeDisplayName(lead.expert || meeting.expert) || <span className="text-gray-400">N/A</span>}</span>
              {(() => {
                if (meeting.calendar_type === 'staff') {
                  return null;
                }

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
          <td className="hidden md:table-cell text-xs sm:text-sm">{meeting.calendar_type === 'staff' ? meeting.meeting_location : (meeting.meeting_location === '--' ? '--' : (meeting.location || meeting.meeting_location || getLegacyMeetingLocation(meeting.meeting_location_id) || 'N/A'))}</td>
          <td>
            <div className="flex items-center gap-1">
              {isNotFirstMeeting(meeting) && (
                <FireIcon className="w-4 h-4 sm:w-6 sm:h-6 text-orange-500" title="Another meeting" />
              )}
            <span className={`font-bold text-xs sm:text-sm ${probabilityColor}`}>
                {(() => {
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
                {typeof probabilityNumber === 'number' && !isNaN(probabilityNumber) ? ` ${probabilityNumber}%` : ''}
            </span>
              {((meeting.location || meeting.meeting_location || getLegacyMeetingLocation(meeting.meeting_location_id))?.toLowerCase().includes('tlv with parking')) && (
                <TruckIcon 
                  className="w-4 h-4 sm:w-6 sm:h-6 text-blue-600 cursor-help" 
                  title={getLegacyCarNumber(meeting) ? `Car Number: ${getLegacyCarNumber(meeting)}` : 'TLV with parking location'}
                />
              )}

              {/* Paid meeting indicator based on meeting_collection_id on lead */}
              {((meeting.lead && meeting.lead.meeting_collection_id) ||
                meeting.legacy_lead?.meeting_collection_id) && (
                <CurrencyDollarIcon
                  className="w-4 h-4 sm:w-5 sm:h-5 text-green-600"
                  title={`Paid meeting / ${
                    meeting.meeting_amount
                      ? `${getCurrencySymbol(meeting.meeting_currency || 'NIS')}${meeting.meeting_amount.toLocaleString()}`
                      : 'no amount set'
                  }`}
                />
              )}

              {(meeting.complexity === 'Complex' || getLegacyMeetingComplexity(meeting.meeting_complexity) === 'Complex') && (
                <BookOpenIcon 
                  className="w-4 h-4 sm:w-6 sm:h-6 text-purple-600" 
                  title="Complex Meeting"
                />
              )}
            </div>
          </td>
          <td className="hidden sm:table-cell">{getStageBadge(lead.stage || meeting.stage)}</td>
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
              {/* Only show join button if there is a valid link and either:
                  - the location is online/Teams, or
                  - the location has a default_link configured,
                  OR it's a staff meeting */}
              {(() => {
                const locationName = getMeetingLocationName(meeting.meeting_location || meeting.location);
                const fallbackLink = meetingLocationLinks[locationName] || '';
                const url = getValidTeamsLink(meeting.teams_meeting_url || fallbackLink);
                const hasLink = !!url;
                const hasDefaultForLocation = !!meetingLocationLinks[locationName];
                const isTeamsLike = isOnlineLocation(locationName || '');
                return hasLink && (isTeamsLike || hasDefaultForLocation || meeting.calendar_type === 'staff');
              })() && (
                <button 
                  className="btn btn-primary btn-xs sm:btn-sm"
                  onClick={() => {
                    const locationName = getMeetingLocationName(meeting.meeting_location || meeting.location);
                    const fallbackLink = meetingLocationLinks[locationName] || '';
                    const url = getValidTeamsLink(meeting.teams_meeting_url || fallbackLink);
                    if (url) {
                      window.open(url, '_blank');
                    } else {
                      alert('No meeting URL available');
                    }
                  }}
                  title="Teams Meeting"
                >
                  <VideoCameraIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                </button>
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
            </div>
          </td>
        </tr>
        
        {/* Expanded Details Row */}
        {isExpanded && (
          <tr>
            <td colSpan={11} className="p-0">
              <div className="bg-base-100/50 p-4 border-t border-base-200">
                {expandedData.loading ? (
                  <div className="flex justify-center items-center py-4">
                    <span className="loading loading-spinner loading-md"></span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                    <div className="bg-base-200/50 p-4 rounded-lg">
                      <h5 className="font-semibold text-base-content/90 mb-2">Facts of Case</h5>
                      <div className="space-y-3 max-h-60 overflow-y-auto">
                        {expandedData.facts ? (
                          <p className="text-sm text-base-content/90 whitespace-pre-wrap">{expandedData.facts}</p>
                        ) : (
                          <p className="text-sm text-base-content/70">No facts of case available.</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </td>
          </tr>
        )}
        
        {/* Toggle Row */}
        <tr>
          <td colSpan={10} className="p-0">
            <button
              className="bg-white hover:bg-gray-50 cursor-pointer transition-colors p-2 text-center w-full block text-primary font-medium flex items-center justify-center gap-2 shadow-sm"
              style={{ border: 'none', outline: 'none' }}
              onClick={() => setExpandedMeetingId(expandedMeetingId === meeting.id ? null : meeting.id)}
            >
              <span className="text-sm">{expandedMeetingId === meeting.id ? 'Show Less' : 'Show More'}</span>
              <ChevronDownIcon className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
          </td>
        </tr>
      </React.Fragment>
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
        `}
      </style>
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
          <span className="text-sm font-semibold text-center sm:text-lg sm:text-left">
            {appliedFromDate === appliedToDate ? (
              new Date(appliedFromDate).toLocaleDateString('en-US', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              })
            ) : (
              `${new Date(appliedFromDate).toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric' 
              })} - ${new Date(appliedToDate).toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric', 
                year: 'numeric' 
              })}`
            )}
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

      {/* Filters */}
      <div className="mb-6 w-full">
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


      {/* Action Buttons Row */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 w-full">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm md:text-base font-medium text-gray-700">Total Meetings:</span>
            <span className="text-base md:text-lg font-bold" style={{ color: '#3b28c7' }}>{filteredMeetings.length}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn btn-sm md:btn-md flex items-center gap-2 px-3 md:px-4 bg-white border-2 hover:bg-gray-50"
            style={{ borderColor: '#3b28c7', color: '#3b28c7' }}
            onClick={openAssignStaffModal}
            title="Assign Staff"
          >
            <UserGroupIcon className="w-4 h-4 md:w-5 md:h-5" />
            <span className="hidden md:inline text-sm md:text-base font-semibold">Assign Staff</span>
          </button>
          <button
            className="btn btn-sm md:btn-md flex items-center gap-2 px-3 md:px-4 bg-white border-2 hover:bg-gray-50"
            style={{ borderColor: '#3b28c7', color: '#3b28c7' }}
            onClick={() => {
              setSelectedDateForMeeting(new Date());
              setSelectedTimeForMeeting('09:00');
              setIsTeamsMeetingModalOpen(true);
            }}
            title="Create Teams Meeting"
          >
            <VideoCameraIcon className="w-4 h-4 md:w-5 md:h-5" />
            <span className="hidden md:inline text-sm md:text-base font-semibold">Create Teams Meeting</span>
          </button>
          <button
            className="btn btn-sm md:btn-md flex items-center gap-2 px-3 md:px-4 bg-white border-2 hover:bg-gray-50"
            style={{ borderColor: '#3b28c7', color: '#3b28c7' }}
            onClick={() => setViewMode(viewMode === 'cards' ? 'list' : 'cards')}
            title={viewMode === 'cards' ? 'Switch to List View' : 'Switch to Card View'}
          >
            {viewMode === 'cards' ? (
              <Bars3Icon className="w-4 h-4 md:w-5 md:h-5" />
            ) : (
              <Squares2X2Icon className="w-4 h-4 md:w-5 md:h-5" />
            )}
            <span className="hidden md:inline text-sm md:text-base font-semibold">{viewMode === 'cards' ? 'List View' : 'Card View'}</span>
          </button>
        </div>
      </div>




      {/* Meetings List */}
      <div className="mt-6 bg-base-100 rounded-lg shadow-lg overflow-x-auto">
        {/* Desktop Table - Show when viewMode is 'list' */}
        {viewMode === 'list' && (
          <table className="table w-full text-xs sm:text-sm md:text-base">
            <thead>
              <tr className="bg-white text-sm sm:text-base md:text-lg">
                <th className="text-gray-900">Lead</th>
                <th className="text-gray-900">Time</th>
                <th className="hidden sm:table-cell text-gray-900">Manager</th>
                <th className="hidden md:table-cell text-gray-900">Helper</th>
                <th className="hidden lg:table-cell text-gray-900">Category</th>
                <th className="hidden sm:table-cell text-gray-900">Value</th>
                <th className="hidden lg:table-cell text-gray-900">Expert</th>
                <th className="hidden md:table-cell text-gray-900">Location</th>
                <th className="text-gray-900">Info</th>
                <th className="hidden sm:table-cell text-gray-900">Status</th>
                <th className="text-gray-900">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={11} className="text-center p-8 text-lg">Loading meetings...</td></tr>
              ) : filteredMeetings.length > 0 ? (
                filteredMeetings.map(renderMeetingRow)
              ) : isLegacyLoading ? (
                <tr><td colSpan={11} className="text-center p-8 text-lg">
                  <div className="flex items-center justify-center gap-2">
                    <span className="loading loading-spinner loading-sm"></span>
                    Loading meetings...
                  </div>
                </td></tr>
              ) : (
                <tr><td colSpan={11} className="text-center p-8 text-lg">No meetings found for the selected filters.</td></tr>
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
                <div className="mt-6 p-5 bg-gradient-to-r from-purple-50 to-purple-100 border-l-4 rounded-lg shadow-sm" style={{ borderLeftColor: '#3b28c7' }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full" style={{ backgroundColor: 'rgba(59, 40, 199, 0.1)' }}>
                        <ClockIcon className="w-5 h-5" style={{ color: '#3b28c7' }} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-base" style={{ color: '#3b28c7' }}>Unavailable Staff</h3>
                        <p className="text-sm" style={{ color: '#3b28c7' }}>{new Date(modalSelectedDate).toLocaleDateString('en-GB')}</p>
                      </div>
                    </div>
                    {unavailableEmployees[modalSelectedDate].length > 3 && (
                      <div className="relative more-unavailable-dropdown">
                        <button
                          onClick={() => setShowMoreUnavailableDropdown(!showMoreUnavailableDropdown)}
                          className="btn btn-sm border hover:bg-opacity-20"
                          style={{ 
                            backgroundColor: 'rgba(59, 40, 199, 0.1)', 
                            borderColor: '#3b28c7', 
                            color: '#3b28c7' 
                          }}
                        >
                          More ({unavailableEmployees[modalSelectedDate].length - 3})
                          <ChevronDownIcon className="w-4 h-4 ml-1" />
                        </button>
                        {showMoreUnavailableDropdown && (
                          <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
                            <div className="p-3">
                              <div className="text-sm font-semibold text-gray-700 mb-2">All Unavailable Staff</div>
                              <div className="space-y-2">
                                {unavailableEmployees[modalSelectedDate].map((unavailable, index) => (
                                  <div key={index} className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                                    <div className="flex items-center justify-between">
                                      <span className="text-red-800 text-sm font-medium">{unavailable.employeeName}</span>
                                      <span className="text-red-600 text-xs">
                                        {unavailable.isRange || unavailable.startTime === 'All Day' ? 'All Day' : `${unavailable.startTime} - ${unavailable.endTime}`}
                                      </span>
                                    </div>
                                    {unavailable.reason && (
                                      <div className="text-red-600 text-xs mt-1">({unavailable.reason})</div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {unavailableEmployees[modalSelectedDate].slice(0, 3).map((unavailable, index) => (
                      <div key={index} className="bg-white border rounded-full px-4 py-2 shadow-sm hover:shadow-md transition-shadow" style={{ borderColor: '#3b28c7' }}>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#3b28c7' }}></div>
                          <span className="text-sm font-semibold" style={{ color: '#3b28c7' }}>{unavailable.employeeName}</span>
                        </div>
                        <div className="text-xs mt-1 ml-4" style={{ color: '#3b28c7' }}>
                          {unavailable.isRange || unavailable.startTime === 'All Day' ? 'All Day' : `${unavailable.startTime} - ${unavailable.endTime}`}
                          {unavailable.reason && (
                            <span className="ml-1">• {unavailable.reason}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
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
                    onChange={(e) => setSelectedStaffFilter(e.target.value)}
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
                          <table className="table table-zebra w-full overflow-visible">
                            <thead>
                              <tr>
                                <th className="text-left text-base font-semibold">Lead</th>
                                <th className="text-left text-base font-semibold">Time</th>
                                <th className="text-left text-base font-semibold">Location</th>
                                <th className="text-left text-base font-semibold">Category</th>
                                <th className="text-left text-base font-semibold">Expert</th>
                                <th className="text-left text-base font-semibold">Language</th>
                                <th className="text-left text-base font-semibold">Balance</th>
                                <th className="text-left text-base font-semibold">Info</th>
                                <th className="text-left text-base font-semibold">
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
                                <th className="text-left text-base font-semibold">Helper</th>
                              </tr>
                            </thead>
                            <tbody>
                          {filteredMeetings.map((meeting) => (
                                <tr key={meeting.id} className="hover:bg-gray-50">
                                  {/* Lead */}
                                  <td className="text-base">
                                    {meeting.calendar_type === 'staff' ? (
                                      <span className="font-medium">
                                        {meeting.lead?.name || 'N/A'}
                                      </span>
                                    ) : (
                                      <Link 
                                        to={`/clients/${meeting.lead?.lead_number || meeting.lead_number}`}
                                        className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                                      >
                                        {meeting.lead?.lead_number || meeting.lead_number} - {meeting.lead?.name || 'N/A'}
                                      </Link>
                                    )}
                                  </td>
                                  
                                  {/* Time */}
                                  <td className="font-medium text-base">{formatTime(meeting.meeting_time)}</td>
                                  
                                  {/* Location */}
                                  <td className="text-base">{meeting.calendar_type === 'staff' ? meeting.meeting_location : (meeting.meeting_location === '--' ? '--' : (meeting.meeting_location || getLegacyMeetingLocation(meeting.meeting_location_id) || 'N/A'))}</td>
                                  
                                  {/* Category */}
                                  <td className="text-base">{getCategoryName(meeting.lead?.category_id, meeting.lead?.category) || 'N/A'}</td>
                                  
                                  {/* Expert */}
                                  <td className="text-base">
                                    <div className="flex flex-col gap-2">
                                      <span>{meeting.lead?.expert || 'N/A'}</span>
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
                                  <td className="text-base">{meeting.lead?.language || 'N/A'}</td>
                                  
                                  {/* Balance */}
                                  <td className="font-medium text-base">
                                    {meeting.lead?.balance ? 
                                      `${getCurrencySymbol(meeting.lead?.balance_currency)}${meeting.lead.balance.toLocaleString()}` : 
                                      'N/A'
                                    }
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
                                      return (
                                        <>
                                            <div className="flex items-center gap-2">
                                          <input
                                            type="text"
                                            placeholder={meeting.meeting_manager || "Select manager..."}
                                                className="input input-sm input-bordered w-full pr-8 cursor-pointer staff-dropdown-input"
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
                                                <ChevronDownIcon className="w-3 h-3 text-gray-400" />
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
                                                className="input input-sm input-bordered w-full pr-8 cursor-pointer staff-dropdown-input"
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
                                                <ChevronDownIcon className="w-3 h-3 text-gray-400" />
                                          </div>
                                              </div>
                                        </>
                                      );
                                    })()}
                                  </div>
                                  </td>
                                </tr>
                          ))}
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

            {/* Footer */}
            <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
              <div className="flex justify-between items-center">
                <div className="text-sm text-gray-600">
                  Total meetings: {getFilteredMeetings().length}
                </div>
                <button
                  onClick={() => setIsAssignStaffModalOpen(false)}
                  className="btn btn-primary"
                >
                  Done
                </button>
              </div>
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
        onDocumentCountChange={() => {}}
      />


      {/* Portal-based Dropdown */}
      {activeDropdown && createPortal(
        <div
          data-portal-dropdown
          className="fixed z-[9999] max-h-32 overflow-y-auto border border-gray-200 rounded-lg bg-white shadow-lg"
          style={{
            left: dropdownPosition?.x || 0,
            top: dropdownPosition?.y || 0,
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
                  className={`px-3 py-2 border-b border-gray-100 ${
                    isUnavailable 
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
          // Refresh meetings when modal closes
          window.location.reload();
        }}
        selectedDate={selectedDateForMeeting || undefined}
        selectedTime={selectedTimeForMeeting}
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