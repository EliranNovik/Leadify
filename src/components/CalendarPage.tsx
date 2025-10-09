import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarIcon, FunnelIcon, UserIcon, CurrencyDollarIcon, VideoCameraIcon, ChevronDownIcon, DocumentArrowUpIcon, FolderIcon, ClockIcon, ChevronLeftIcon, ChevronRightIcon, AcademicCapIcon, QuestionMarkCircleIcon, XMarkIcon, PaperAirplaneIcon, FaceSmileIcon, PaperClipIcon, Bars3Icon, Squares2X2Icon, UserGroupIcon, TruckIcon, BookOpenIcon, FireIcon, PencilIcon } from '@heroicons/react/24/outline';
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
import { fetchStageNames, getStageName, refreshStageNames } from '../lib/stageUtils';
import TeamsMeetingModal from './TeamsMeetingModal';
import StaffMeetingEditModal from './StaffMeetingEditModal';
import DepartmentList from './DepartmentList';

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
    }
  }>({});
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<any>(null);
  const navigate = useNavigate();

  // WhatsApp functionality
  const [isWhatsAppOpen, setIsWhatsAppOpen] = useState(false);
  const [whatsAppInput, setWhatsAppInput] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('list');
  // WhatsApp chat messages for the chat box (from selectedLead.manual_interactions)
  const [selectedLeadForWhatsApp, setSelectedLeadForWhatsApp] = useState<any>(null);
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

  // Email functionality
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [selectedLeadForEmail, setSelectedLeadForEmail] = useState<any>(null);
  const [emails, setEmails] = useState<any[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [sending, setSending] = useState(false);
  const [composeAttachments, setComposeAttachments] = useState<{ name: string; contentType: string; contentBytes: string }[]>([]);
  const [downloadingAttachments, setDownloadingAttachments] = useState<Record<string, boolean>>({});
  const [activeEmailId, setActiveEmailId] = useState<string | null>(null);
  const [bodyFocused, setBodyFocused] = useState(false);
  const [currentUserFullName, setCurrentUserFullName] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<{url: string, type: 'image' | 'video', caption?: string} | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const quillRef = useRef<ReactQuill>(null);

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

  // 1. Add state for WhatsApp messages and input
  const [whatsAppChatMessages, setWhatsAppChatMessages] = useState<any[]>([]);
  const [isWhatsAppLoading, setIsWhatsAppLoading] = useState(false);

  // State to store all employees and categories for name lookup
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [allCategories, setAllCategories] = useState<any[]>([]);
  
  // State to track legacy loading failures
  const [legacyLoadingDisabled, setLegacyLoadingDisabled] = useState(false);
  
  // Meeting type filter state
  const [selectedMeetingType, setSelectedMeetingType] = useState<'all' | 'potential' | 'active' | 'staff'>('all');
  
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
      const { data: legacyData, error: legacyError } = await supabase
        .from('leads_lead')
        .select(`
          id, name, meeting_date, meeting_time, lead_number, category, category_id, stage, 
          meeting_manager_id, meeting_lawyer_id, total, meeting_total_currency_id, expert_id, 
          probability, phone, email, mobile, meeting_location_id, expert_examination,
          misc_category!category_id(
            id, name, parent_id,
            misc_maincategory!parent_id(
              id, name, department_id,
              tenant_departement!department_id(id, name)
            )
          )
        `)
        .gte('meeting_date', fromDate)
        .lte('meeting_date', toDate)
        .not('meeting_date', 'is', null)
        .not('name', 'is', null);

      if (legacyError) {
        // Don't return, just continue with empty data
        return;
      }

      if (legacyData && legacyData.length > 0) {
        
        // Get unique location IDs from legacy data
        const locationIds = [...new Set(legacyData
          .map((lead: any) => lead.meeting_location_id)
          .filter((id: any) => id !== null && id !== undefined)
        )];
        
        // Fetch location names from tenants_meetinglocation table
        let locationMap: { [key: number]: string } = {};
        if (locationIds.length > 0) {
          try {
            const { data: locationData, error: locationError } = await supabase
              .from('tenants_meetinglocation')
              .select('id, name')
              .in('id', locationIds);
            
            if (!locationError && locationData) {
              locationMap = locationData.reduce((acc: { [key: number]: string }, loc: any) => {
                acc[loc.id] = loc.name;
                return acc;
              }, {});
            } else {
            }
          } catch (error) {
          }
        }
        
        // Process legacy meetings for this specific date
        const processedLegacyMeetings = legacyData.map((legacyLead: any) => {
          const meeting = {
            id: `legacy_${legacyLead.id}`,
            created_at: legacyLead.meeting_date || new Date().toISOString(),
            meeting_date: legacyLead.meeting_date,
            meeting_time: legacyLead.meeting_time || '09:00',
            meeting_manager: legacyLead.meeting_manager_id,
            helper: legacyLead.meeting_lawyer_id,
            meeting_location: legacyLead.meeting_location_id ? 
              (locationMap[legacyLead.meeting_location_id] || 'Unknown Location') : 'Teams',
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
                manager: legacyLead.meeting_manager_id,
                helper: legacyLead.meeting_lawyer_id,
                balance: parseFloat(legacyLead.total || '0'),
                balance_currency: legacyLead.meeting_total_currency_id === 1 ? 'NIS' : 
                                 legacyLead.meeting_total_currency_id === 2 ? 'USD' : 
                                 legacyLead.meeting_total_currency_id === 3 ? 'EUR' : 'NIS',
                expert: legacyLead.expert_id,
                expert_examination: legacyLead.expert_examination,
                probability: parseFloat(legacyLead.probability || '0'),
                category: legacyLead.category || legacyLead.category_id,
                language: null,
                onedrive_folder_link: '',
                expert_notes: '',
                manual_interactions: [],
                lead_type: 'legacy' as const,
                // Add department info from JOINs
                department_name: legacyLead.misc_category?.misc_maincategory?.tenant_departement?.name || 'Unassigned',
                department_id: legacyLead.misc_category?.misc_maincategory?.department_id
              }
          };
          return meeting;
        });

        // Add legacy meetings to the current meetings
        setMeetings(prevMeetings => {
          // Remove any existing legacy meetings for this date range first
          const filteredMeetings = prevMeetings.filter(meeting => 
            !(meeting.lead?.lead_type === 'legacy' && meeting.meeting_date >= fromDate && meeting.meeting_date <= toDate)
          );
          
          // Add new legacy meetings
          const allMeetings = [...filteredMeetings, ...processedLegacyMeetings];
          
          
          return allMeetings;
        });
      } else {
      }
    } catch (error) {
      // Disable legacy loading after multiple failures to prevent repeated timeouts
      if (error instanceof Error && error.message.includes('timeout')) {
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
        // Fetch all employees for name lookup
        const { data: employeesData, error: employeesError } = await supabase
          .from('tenants_employee')
          .select('id, display_name, bonuses_role')
          .order('display_name', { ascending: true });
        
        if (!employeesError && employeesData) {
          setAllEmployees(employeesData);
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
        
        // Load today's meetings with department JOINs - prioritize regular meetings, legacy as optional
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
        
        // Debug: Check legacy_lead_id values
        if (todayMeetingsData && todayMeetingsData.length > 0) {
          const legacyLeadIds = todayMeetingsData
            .filter(m => m.legacy_lead_id)
            .map(m => ({ id: m.id, legacy_lead_id: m.legacy_lead_id, type: typeof m.legacy_lead_id }));
          console.log('🔍 Legacy lead IDs found:', legacyLeadIds);
        }
        
        // Debug: Check if there are any meetings with legacy_lead_id but no legacy_lead data
        if (todayMeetingsData && todayMeetingsData.length > 0) {
          const meetingsWithLegacyId = todayMeetingsData.filter(m => m.legacy_lead_id && !m.legacy_lead);
          if (meetingsWithLegacyId.length > 0) {
            console.log('🔍 Meetings with legacy_lead_id but no legacy_lead data:', meetingsWithLegacyId.map(m => ({
              id: m.id,
              legacy_lead_id: m.legacy_lead_id,
              calendar_type: m.calendar_type
            })));
          }
        }

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
          
          // Debug: Check specific meetings that are causing issues
          const problematicMeetings = todayMeetingsData?.filter(m => m.calendar_type === 'potential_client' && !m.legacy_lead);
          if (problematicMeetings && problematicMeetings.length > 0) {
            console.log('🔍 Problematic meetings (potential_client without legacy_lead):', problematicMeetings.map(m => ({
              id: m.id,
              legacy_lead_id: m.legacy_lead_id,
              client_id: m.client_id
            })));
          }
          
          // Debug: Check all potential_client meetings
          const potentialClientMeetings = todayMeetingsData?.filter(m => m.calendar_type === 'potential_client');
          if (potentialClientMeetings && potentialClientMeetings.length > 0) {
            console.log('🔍 All potential_client meetings:', potentialClientMeetings.map(m => ({
              id: m.id,
              legacy_lead_id: m.legacy_lead_id,
              client_id: m.client_id,
              hasLegacyLead: !!m.legacy_lead,
              legacyLeadName: (m.legacy_lead as any)?.name
            })));
          }
          
          const startTime = performance.now();
          
          // Quick processing for today's meetings with department data
          const todayProcessedMeetings = (todayMeetingsData || []).map((meeting: any) => ({
            ...meeting,
            // Map location ID to location name using universal function
            meeting_location: getMeetingLocationName(meeting.meeting_location),
            lead: meeting.legacy_lead ? {
                ...meeting.legacy_lead,
                lead_type: 'legacy',
                manager: meeting.legacy_lead.meeting_manager_id,
                helper: meeting.legacy_lead.meeting_lawyer_id,
                balance: meeting.legacy_lead.total,
                balance_currency: meeting.legacy_lead.meeting_total_currency_id,
                expert: meeting.legacy_lead.expert_id,
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
        
        // Load all regular meetings with department JOINs - INCLUDING LEGACY JOINS
        const { data: meetingsData, error: meetingsError } = await supabase
          .from('meetings')
          .select(`
            id, meeting_date, meeting_time, meeting_manager, helper, meeting_location, teams_meeting_url,
            meeting_amount, meeting_currency, status, client_id, legacy_lead_id,
            attendance_probability, complexity, car_number, calendar_type,
            lead:leads!client_id(
              id, name, lead_number, onedrive_folder_link, stage, manager, category, category_id,
              balance, balance_currency, expert_notes, expert, probability, phone, email, 
              manual_interactions, number_of_applicants_meeting,
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
                  manager: meeting.legacy_lead.meeting_manager_id,
                  helper: meeting.legacy_lead.meeting_lawyer_id,
                  balance: meeting.legacy_lead.total,
                  balance_currency: meeting.legacy_lead.meeting_total_currency_id,
                  expert: meeting.legacy_lead.expert_id,
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
        
        const { data, error } = await supabase
          .from(tableName)
          .select('expert_notes,handler_notes')
          .eq('id', leadId)
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

  // Load legacy meetings and staff meetings when applied date range changes
  useEffect(() => {
    // Only fetch data when both applied dates are set and user has manually set them
    if (appliedFromDate && appliedToDate && appliedFromDate.trim() !== '' && appliedToDate.trim() !== '' && datesManuallySet) {
      // Reset loading state when date range changes
      setIsLegacyLoading(true);
      loadLegacyForDateRange(appliedFromDate, appliedToDate);
      // Also load staff meetings for the date range
      fetchStaffMeetings(appliedFromDate, appliedToDate);
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

  useEffect(() => {
    const fetchEmails = async () => {
      setEmailsLoading(true);
      const { data, error } = await supabase
        .from('emails')
        .select('*')
        .order('sent_at', { ascending: false });
      
      if (error) {
        console.error('Error fetching emails:', error);
        setEmailsLoading(false);
        return;
      }
      setEmails(data || []);
      setEmailsLoading(false);
    };

    fetchEmails();
  }, []);

  // Sync emails when email modal opens
  useEffect(() => {
    const syncEmailsForClient = async () => {
      if (!isEmailModalOpen || !selectedLeadForEmail || !instance || !accounts[0]) return;
      
      setEmailsLoading(true);
      try {
        const tokenResponse = await acquireToken(instance, accounts[0]);
        await syncClientEmails(tokenResponse.accessToken, selectedLeadForEmail);
        
        // Fetch updated emails from database
        const { data, error } = await supabase
          .from('emails')
          .select('*')
          .eq('client_id', selectedLeadForEmail.id)
          .order('sent_at', { ascending: false });
        
        if (error) {
          console.error('Error fetching emails after sync:', error);
        } else {
          setEmails(data || []);
        }
      } catch (e) {
        console.error("Email sync failed:", e);
        toast.error("Failed to sync emails from server.");
      } finally {
        setEmailsLoading(false);
      }
    };

    syncEmailsForClient();
  }, [isEmailModalOpen, selectedLeadForEmail, instance, accounts]);

  // Set the subject when the email modal opens (if not already set by user)
  useEffect(() => {
    if (isEmailModalOpen && selectedLeadForEmail) {
      const defaultSubject = `[${selectedLeadForEmail.lead_number}] - ${selectedLeadForEmail.name} - ${selectedLeadForEmail.topic || ''}`;
      setComposeSubject(prev => prev && prev.trim() ? prev : defaultSubject);
    }
  }, [isEmailModalOpen, selectedLeadForEmail]);

  const getStageBadge = (stage: string | number) => {
    if (!stage || (typeof stage === 'string' && !stage.trim())) {
      return (
        <span
          className="btn btn-primary btn-sm pointer-events-none font-semibold whitespace-nowrap"
          style={{ background: '#3b28c7' }}
        >
          No Stage
        </span>
      );
    }
    
    // Temporary hardcoded mapping for immediate testing
    const tempStageMapping: { [key: string]: string } = {
      '50': 'Meeting Scheduled',
      '105': 'Success',
      '35': 'Meeting Irrelevant',
      '91': 'Dropped (Spam/Irrelevant)',
      '51': 'Client declined price offer',
      '10': 'Scheduler assigned',
      '20': 'Meeting scheduled',
      'meeting_scheduled': 'Meeting Scheduled',
      'scheduler_assigned': 'Scheduler assigned'
    };
    
    const stageStr = String(stage);
    const stageName = tempStageMapping[stageStr] || getStageName(stageStr);
    
    console.log('🔍 Calendar - Stage badge:', { 
      stage, 
      stageName, 
      stageType: typeof stage,
      stageString: stageStr,
      tempMapping: tempStageMapping[stageStr]
    });
    
    return (
      <span
        className="btn btn-primary btn-sm pointer-events-none font-semibold whitespace-nowrap"
        style={{ background: '#3b28c7' }}
      >
        {stageName}
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

  // Helper function to handle Email button click
  const handleEmailClick = (lead: any, meeting: any) => {
    // Debug: Log the lead data to ensure it's correct
    
    // Set the selected lead for email and open the modal
    setSelectedLeadForEmail(lead);
    setIsEmailModalOpen(true);
  };

  // Helper function to handle WhatsApp button click
  const handleWhatsAppClick = (lead: any, meeting: any) => {
    // Debug: Log the lead data to ensure it's correct
    
    // Set the selected lead for WhatsApp and open the modal
    setSelectedLeadForWhatsApp(lead);
    setIsWhatsAppOpen(true);
  };

  // 2. Fetch WhatsApp messages when modal opens or selectedLeadForWhatsApp changes
  useEffect(() => {
    async function fetchWhatsAppMessages() {
      if (!selectedLeadForWhatsApp?.id) return;
      setIsWhatsAppLoading(true);
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('lead_id', selectedLeadForWhatsApp.id)
        .order('sent_at', { ascending: true });
      if (!error && data) {
        setWhatsAppChatMessages(data);
      } else {
        setWhatsAppChatMessages([]);
      }
      setIsWhatsAppLoading(false);
    }
    if (isWhatsAppOpen && selectedLeadForWhatsApp) {
      fetchWhatsAppMessages();
    }
  }, [isWhatsAppOpen, selectedLeadForWhatsApp]);

  // 3. Handle sending WhatsApp message
  const handleSendWhatsAppMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!whatsAppInput.trim() || !selectedLeadForWhatsApp?.id) return;
    let senderId = null;
    let senderName = 'You';
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id) {
        const { data: userRow, error: userLookupError } = await supabase
          .from('users')
          .select('id, full_name, email')
          .eq('auth_id', user.id)
          .single();
        if (!userLookupError && userRow) {
          senderId = userRow.id;
          senderName = userRow.full_name || userRow.email || 'You';
        }
      }
      const now = new Date();
      const { error: insertError } = await supabase
        .from('whatsapp_messages')
        .insert([
          {
            lead_id: selectedLeadForWhatsApp.id,
            sender_id: senderId,
            sender_name: senderName,
            direction: 'out',
            message: whatsAppInput,
            sent_at: now.toISOString(),
            status: 'sent',
          }
        ]);
      if (insertError) {
        alert('Failed to send WhatsApp message: ' + insertError.message);
        return;
      }
      setWhatsAppInput('');
      // Refetch messages
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('lead_id', selectedLeadForWhatsApp.id)
        .order('sent_at', { ascending: true });
      if (!error && data) {
        setWhatsAppChatMessages(data);
      }
    } catch (err) {
      alert('Unexpected error sending WhatsApp message.');
    }
  };

  // Helper function to render WhatsApp-style message status
  const renderMessageStatus = (status?: string) => {
    if (!status) return null;
    
    const baseClasses = "w-7 h-7";
    
    switch (status) {
      case 'sent':
        return (
          <svg className={baseClasses} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'delivered':
        return (
          <svg className={`${baseClasses} text-gray-500`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l4 4L11 8" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l4 4L17 8" />
          </svg>
        );
      case 'read':
        return (
          <svg className={`${baseClasses} text-black`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l4 4L11 8" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l4 4L17 8" />
          </svg>
        );
      default:
        return null;
    }
  };

  // Handle file selection for WhatsApp
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  // Send media message via WhatsApp
  const handleSendMedia = async () => {
    if (!selectedFile || !selectedLeadForWhatsApp) return;

    setUploadingMedia(true);
    try {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('leadId', selectedLeadForWhatsApp.id);

      // Upload media to WhatsApp
      const uploadResponse = await fetch(buildApiUrl('/api/whatsapp/upload-media'), {
        method: 'POST',
        body: formData,
      });

      const uploadResult = await uploadResponse.json();

      if (!uploadResponse.ok) {
        throw new Error(uploadResult.error || 'Failed to upload media');
      }

      // Send media message
      const mediaType = selectedFile.type.startsWith('image/') ? 'image' : 'document';
      const senderName = currentUserFullName || 'You';
      const response = await fetch(buildApiUrl('/api/whatsapp/send-media'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          leadId: selectedLeadForWhatsApp.id,
          mediaUrl: uploadResult.mediaId,
          mediaType: mediaType,
          caption: whatsAppInput.trim() || undefined,
          phoneNumber: selectedLeadForWhatsApp.phone || selectedLeadForWhatsApp.mobile,
          sender_name: senderName
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send media');
      }

      // Add message to local state
      const newMsg = {
        id: Date.now(),
        lead_id: selectedLeadForWhatsApp.id,
        sender_id: null,
        sender_name: senderName,
        direction: 'out',
        message: whatsAppInput.trim() || `${mediaType} message`,
        sent_at: new Date().toISOString(),
        status: 'sent',
        message_type: mediaType,
        whatsapp_status: 'sent',
        whatsapp_message_id: result.messageId,
        media_url: uploadResult.mediaId,
        caption: whatsAppInput.trim() || undefined
      };

      setWhatsAppChatMessages(prev => [...prev, newMsg]);
      setWhatsAppInput('');
      setSelectedFile(null);
      toast.success('Media sent via WhatsApp!');
    } catch (error) {
      console.error('Error sending media:', error);
      toast.error('Failed to send media: ' + (error as Error).message);
    } finally {
      setUploadingMedia(false);
    }
  };

  // Handle WhatsApp modal close
  const handleWhatsAppClose = () => {
    setIsWhatsAppOpen(false);
    setSelectedLeadForWhatsApp(null);
    setWhatsAppInput("");
  };

  // Email functionality
  const handleEmailClose = () => {
    setIsEmailModalOpen(false);
    setSelectedLeadForEmail(null);
    setComposeSubject('');
    setComposeBody('');
    setComposeAttachments([]);
  };

  const handleSendEmail = async () => {
    if (!selectedLeadForEmail?.email) return;
    setSending(true);
    try {
      const account = instance.getAllAccounts()[0];
      if (!account) {
        toast.error('You must be signed in to send an email.');
        setSending(false);
        return;
      }
      let senderName = account.name || 'Current User';
      try {
        const response = await instance.acquireTokenSilent({ ...loginRequest, account });
        const accessToken = response.accessToken;
        await sendClientEmail(accessToken, composeSubject, composeBody, selectedLeadForEmail, senderName, composeAttachments);
        toast.success('Email sent successfully!');
        
        // Sync emails after sending
        await syncClientEmails(accessToken, selectedLeadForEmail);
        
        // Fetch updated emails from database
        const { data, error } = await supabase
          .from('emails')
          .select('*')
          .eq('client_id', selectedLeadForEmail.id)
          .order('sent_at', { ascending: false });
        
        if (!error && data) {
          setEmails(data);
        }
        
        // Clear form
        setComposeBody('');
        setComposeSubject('');
        setComposeAttachments([]);
      } catch (error) {
        if (error instanceof Error && error.name === 'InteractionRequiredAuthError') {
          const response = await instance.acquireTokenPopup(loginRequest);
          const accessToken = response.accessToken;
          await sendClientEmail(accessToken, composeSubject, composeBody, selectedLeadForEmail, senderName, composeAttachments);
          toast.success('Email sent successfully!');
          
          // Sync emails after sending
          await syncClientEmails(accessToken, selectedLeadForEmail);
          
          // Fetch updated emails from database
          const { data, error } = await supabase
            .from('emails')
            .select('*')
            .eq('client_id', selectedLeadForEmail.id)
            .order('sent_at', { ascending: false });
          
          if (!error && data) {
            setEmails(data);
          }
          
          // Clear form
          setComposeBody('');
          setComposeSubject('');
          setComposeAttachments([]);
        } else {
          throw error;
        }
      }
    } catch (e) {
      toast.error('Failed to send email.');
    }
    setSending(false);
  };

  const handleDownloadAttachment = async (messageId: string, attachment: any) => {
    setDownloadingAttachments(prev => ({ ...prev, [attachment.id]: true }));
    try {
      const account = instance.getAllAccounts()[0];
      if (!account) {
        toast.error('You must be signed in to download attachments.');
        return;
      }
      const response = await instance.acquireTokenSilent({ ...loginRequest, account });
      const accessToken = response.accessToken;
      
      const downloadResponse = await fetch(attachment.contentUrl, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!downloadResponse.ok) throw new Error('Download failed');
      
      const blob = await downloadResponse.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = attachment.name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success('Attachment downloaded!');
    } catch (error) {
      toast.error('Failed to download attachment.');
    } finally {
      setDownloadingAttachments(prev => ({ ...prev, [attachment.id]: false }));
    }
  };

  const handleAttachmentUpload = async (files: FileList) => {
    const newAttachments: { name: string; contentType: string; contentBytes: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const contentBytes = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]); // Remove data URL prefix
        };
        reader.readAsDataURL(file);
      });
      newAttachments.push({
        name: file.name,
        contentType: file.type,
        contentBytes: contentBytes,
      });
    }
    setComposeAttachments(prev => [...prev, ...newAttachments]);
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

      // Fetch meetings for the extended date range
      const { data: meetingsData, error: meetingsError } = await supabase
        .from('meetings')
        .select(`
          *, 
          attendance_probability, complexity, car_number, calendar_type,
          lead:leads!client_id(
            id, name, lead_number, stage, manager, category, category_id, balance, balance_currency, 
            expert_notes, expert, probability, phone, email, language, number_of_applicants_meeting
          ),
          legacy_lead:leads_lead!legacy_lead_id(
            id, name, lead_number, stage, meeting_manager_id, meeting_lawyer_id, category, category_id, total, meeting_total_currency_id, 
            expert_notes, expert_id, probability, phone, email, language_id, no_of_applicants
          )
        `)
        .gte('meeting_date', sevenDaysAgo)
        .lte('meeting_date', thirtyDaysFromNow)
        .or('status.is.null,status.neq.canceled')
        .order('meeting_date', { ascending: true })
        .order('meeting_time', { ascending: true });

      // Fetch legacy meetings for the extended date range
      const { data: legacyMeetingsData, error: legacyMeetingsError } = await supabase
        .from('leads_lead')
        .select(`
          id, name, lead_number, stage, meeting_manager_id, meeting_lawyer_id, category, category_id,
          total, meeting_total_currency_id, expert_notes, expert_id, probability, phone, email, mobile, topic, language_id,
          meeting_date, meeting_time, meeting_brief, meeting_location_old, meeting_url, meeting_total,
          meeting_paid, meeting_confirmation, meeting_scheduling_notes, onedrive_folder_link,
          meeting_complexity, meeting_location_id, meeting_car_no
        `)
        .not('meeting_date', 'is', null)
        .gte('meeting_date', sevenDaysAgo)
        .lte('meeting_date', thirtyDaysFromNow)
        .order('meeting_date', { ascending: true })
        .order('meeting_time', { ascending: true });

      if (meetingsError) throw meetingsError;
      if (legacyMeetingsError) throw legacyMeetingsError;


      // Process the regular meetings to combine lead data from both tables
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
        // Determine which lead data to use
        let leadData = null;
        
        if (meeting.legacy_lead) {
          // Use legacy lead data and map column names to match new leads structure
          leadData = {
            ...meeting.legacy_lead,
            lead_type: 'legacy',
            // Map legacy column names to new structure
            manager: meeting.legacy_lead.meeting_manager_id,
            helper: meeting.legacy_lead.lawyer_id,
            balance: meeting.legacy_lead.total,
            balance_currency: meeting.legacy_lead.meeting_total_currency_id,
            expert: meeting.legacy_lead.expert_id,
            // Use category_id if category is null
            category: meeting.legacy_lead.category || meeting.legacy_lead.category_id,
            // Map language_id to language for consistency
            language: meeting.legacy_lead.language_id,
            // For legacy leads, use the ID as lead_number (as done in the integration view)
            lead_number: meeting.legacy_lead.id?.toString(),
            // Set default values for missing fields
            manual_interactions: []
          };
        } else if (meeting.lead) {
          // Use new lead data (leads table doesn't have lead_type, so we set it to 'new')
          leadData = {
            ...meeting.lead,
            lead_type: 'new'
          };
        }
        
        return {
          ...meeting,
          lead: leadData
        };
      });

      // Process legacy meetings for assign staff modal
      const processedLegacyMeetings = (legacyMeetingsData || [])
        .filter(legacyLead => {
          // Filter out meetings with invalid or null dates
          if (!legacyLead.meeting_date) {
            return false;
          }
          
          // Validate date format
          const date = new Date(legacyLead.meeting_date);
          if (isNaN(date.getTime())) {
            return false;
          }
          
          return true;
        })
        .map(legacyLead => {
          // Create a meeting object from legacy lead data
          const meeting = {
            id: `legacy_${legacyLead.id}`,
            created_at: legacyLead.meeting_date || new Date().toISOString(),
            meeting_date: legacyLead.meeting_date,
            meeting_time: legacyLead.meeting_time,
            meeting_manager: legacyLead.meeting_manager_id,
            helper: legacyLead.meeting_lawyer_id,
            meeting_location: legacyLead.meeting_location_old || getLegacyMeetingLocation(legacyLead.meeting_location_id) || 'Teams',
            meeting_location_id: legacyLead.meeting_location_id,
            teams_meeting_url: legacyLead.meeting_url,
            meeting_brief: legacyLead.meeting_brief,
            meeting_amount: parseFloat(legacyLead.meeting_total || '0'),
            meeting_currency: legacyLead.meeting_total_currency_id ? 
              (legacyLead.meeting_total_currency_id === 1 ? 'NIS' : 
               legacyLead.meeting_total_currency_id === 2 ? 'USD' : 
               legacyLead.meeting_total_currency_id === 3 ? 'EUR' : 'NIS') : 'NIS',
            meeting_complexity: legacyLead.meeting_complexity,
            meeting_car_no: legacyLead.meeting_car_no,
            meeting_paid: legacyLead.meeting_paid,
            meeting_confirmation: legacyLead.meeting_confirmation,
            meeting_scheduling_notes: legacyLead.meeting_scheduling_notes,
            status: null,
            // Lead data
            lead: {
              id: `legacy_${legacyLead.id}`,
              lead_number: legacyLead.id?.toString(),
              name: legacyLead.name || '',
              email: legacyLead.email || '',
              phone: legacyLead.phone || '',
              mobile: legacyLead.mobile || '',
              topic: legacyLead.topic || '',
              stage: legacyLead.stage,
              manager: legacyLead.meeting_manager_id,
              helper: legacyLead.meeting_lawyer_id,
              balance: parseFloat(legacyLead.total || '0'),
              balance_currency: legacyLead.meeting_total_currency_id ? 
                (legacyLead.meeting_total_currency_id === 1 ? 'NIS' : 
                 legacyLead.meeting_total_currency_id === 2 ? 'USD' : 
                 legacyLead.meeting_total_currency_id === 3 ? 'EUR' : 'NIS') : 'NIS',
              expert: legacyLead.expert_id,
              probability: parseFloat(legacyLead.probability || '0'),
              category: legacyLead.category || legacyLead.category_id,
              language: legacyLead.language_id,
              onedrive_folder_link: legacyLead.onedrive_folder_link,
              expert_notes: legacyLead.expert_notes,
              manual_interactions: [],
              lead_type: 'legacy' as const
            }
          };
          
          return meeting;
        });

      // Combine regular meetings and legacy meetings
      const allMeetings = [...processedMeetings, ...processedLegacyMeetings];

      // Fetch available staff from tenants_employee table
      const { data: staffData, error: staffError } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .order('display_name');

      if (staffError) throw staffError;

      const staffNames = staffData?.map(employee => employee.display_name).filter(Boolean) || [];

      // Fetch all staff from tenants_employee table
      const { data: allStaffData, error: allStaffError } = await supabase
        .from('tenants_employee')
        .select('display_name')
        .not('display_name', 'is', null);

      if (allStaffError) {
        console.error('Error fetching all staff:', allStaffError);
      }

      const allStaffNames = allStaffData?.map(employee => employee.display_name).filter(Boolean) || [];
      const uniqueStaffNames = [...new Set([...staffNames, ...allStaffNames])];


      setAssignStaffMeetings(allMeetings);
      setAvailableStaff(uniqueStaffNames);
    } catch (error) {
      console.error('Error fetching assign staff data:', error);
      toast.error('Failed to load meetings data');
    } finally {
      setAssignStaffLoading(false);
    }
  };

  // Fetch employee availability data
  const fetchMeetingLocations = async () => {
    try {
      const { data: locationsData, error } = await supabase
        .from('tenants_meetinglocation')
        .select('id, name');

      if (error) throw error;

      const locationsMap: {[locationId: number]: string} = {};
      locationsData?.forEach(location => {
        locationsMap[location.id] = location.name;
      });

      setMeetingLocations(locationsMap);
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

  // Mobile-friendly meeting card component
  const renderMeetingCard = (meeting: any) => {
    const lead = meeting.lead || {};
    const isExpanded = expandedMeetingId === meeting.id;
    const expandedData = expandedMeetingData[meeting.id] || {};
    // For legacy leads, check expert_examination column (0 = not checked/question mark, 5/8 = checked/graduation cap)
    // For new leads, check expert_notes array
    const hasExpertNotes = meeting.calendar_type === 'staff' ? false : 
      (lead.lead_type === 'legacy' && lead.expert_examination !== undefined && lead.expert_examination !== null ? 
        (String(lead.expert_examination).trim() !== '0' && String(lead.expert_examination).trim() !== '') : 
        (Array.isArray(lead.expert_notes) ? lead.expert_notes.length > 0 : false));
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

    return (
      <div key={meeting.id} className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 border border-gray-100 group flex flex-col justify-between h-full min-h-[340px] relative pb-16 md:text-lg md:leading-relaxed">
        <div onClick={() => setExpandedMeetingId(expandedMeetingId === meeting.id ? null : meeting.id)} className="flex-1 cursor-pointer flex flex-col">
          {/* Lead Number and Name */}
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs md:text-base font-semibold text-gray-400 tracking-widest">
              {meeting.calendar_type === 'staff' ? 'STAFF' : (lead.lead_number || meeting.lead_number)}
            </span>
            <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
            <h3 className="text-lg md:text-2xl font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{lead.name || meeting.name}</h3>
            {/* Calendar type badge */}
            {meeting.calendar_type && (
              <span className={`badge badge-sm ${
                meeting.calendar_type === 'active_client' 
                  ? 'badge-success' 
                  : meeting.calendar_type === 'staff'
                  ? 'badge-warning'
                  : 'badge-info'
              }`}>
                {meeting.calendar_type === 'active_client' ? 'Active' : 
                 meeting.calendar_type === 'staff' ? 'Staff' : 'Potential'}
              </span>
            )}
            {/* Expert status indicator */}
            {hasExpertNotes ? (
              <AcademicCapIcon className="w-6 h-6 md:w-7 md:h-7 text-green-400 ml-4" title="Expert opinion exists" />
            ) : (
              <QuestionMarkCircleIcon className="w-6 h-6 md:w-7 md:h-7 text-yellow-400 ml-2" title="No expert opinion" />
            )}
          </div>

          {/* Stage */}
          <div className="flex justify-between items-center py-1">
            <span className="text-xs md:text-base font-semibold text-gray-500">Stage</span>
            <span className="text-xs md:text-base font-bold ml-2 px-2 py-1 rounded bg-[#3b28c7] text-white">
              {lead.stage || meeting.stage ? String(lead.stage || meeting.stage).replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : 'N/A'}
            </span>
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

            {/* Info Column - Probability, Complexity, Car, Flame */}
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
        <div className="mt-4 flex flex-row gap-2 justify-end">
            {/* Only show join button if location is Teams OR it's a staff meeting */}
            {(meeting.meeting_location === 'Teams' || meeting.location === 'Teams' || meeting.calendar_type === 'staff') && (
              <button
                className="btn btn-outline btn-primary btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  const url = getValidTeamsLink(meeting.teams_meeting_url);
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
            {/* Only show WhatsApp and Email buttons for non-staff meetings */}
            {meeting.calendar_type !== 'staff' && lead.phone && (
              <button
                className="btn btn-outline btn-success btn-sm"
                title="WhatsApp"
                onClick={(e) => {
                  e.stopPropagation();
                  handleWhatsAppClick(lead, meeting);
                }}
              >
                <FaWhatsapp className="w-4 h-4" />
              </button>
            )}
            {meeting.calendar_type !== 'staff' && (lead.lead_number || meeting.lead_number) && (
              <button
                className="btn btn-outline btn-info btn-sm"
                title="Email"
                onClick={(e) => {
                  e.stopPropagation();
                  handleEmailClick(lead, meeting);
                }}
              >
                <EnvelopeIcon className="w-4 h-4" />
              </button>
            )}
            <button
              className="btn btn-outline btn-warning btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                setExpandedMeetingId(expandedMeetingId === meeting.id ? null : meeting.id);
              }}
            >
              {isExpanded ? 'Show Less' : 'Show More'}
              <ChevronDownIcon className={`w-4 h-4 ml-1 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
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
                <div className="flex justify-center">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedMeeting(meeting);
                      setIsDocumentModalOpen(true);
                    }}
                    className={`btn btn-outline bg-white shadow-sm ${!meeting.lead.onedrive_folder_link ? 'btn-disabled' : ''}`}
                    style={{ borderColor: '#3b28c7', color: '#3b28c7' }}
                    onMouseEnter={(e) => {
                      if (!e.currentTarget.disabled) {
                        e.currentTarget.style.backgroundColor = '#f3f0ff';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!e.currentTarget.disabled) {
                        e.currentTarget.style.backgroundColor = 'white';
                      }
                    }}
                    disabled={!meeting.lead.onedrive_folder_link}
                  >
                    <FolderIcon className="w-4 h-4" />
                    Documents
                    <span className="badge text-white ml-1" style={{ backgroundColor: '#3b28c7' }}>3</span>
                  </button>
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
    // For legacy leads, check expert_examination column (0 = not checked/question mark, 5/8 = checked/graduation cap)
    // For new leads, check expert_notes array
    const hasExpertNotes = meeting.calendar_type === 'staff' ? false : 
      (lead.lead_type === 'legacy' && lead.expert_examination !== undefined && lead.expert_examination !== null ? 
        (String(lead.expert_examination).trim() !== '0' && String(lead.expert_examination).trim() !== '') : 
        (Array.isArray(lead.expert_notes) ? lead.expert_notes.length > 0 : false));
    const probability = lead.probability ?? meeting.probability;
    // Convert probability to number if it's a string
    const probabilityNumber = typeof probability === 'string' ? parseFloat(probability) : probability;
    let probabilityColor = 'text-red-600';
    if (probabilityNumber >= 80) probabilityColor = 'text-green-600';
    else if (probabilityNumber >= 60) probabilityColor = 'text-yellow-600';
    else if (probabilityNumber >= 40) probabilityColor = 'text-orange-600';
    
    
    return (
      <React.Fragment key={meeting.id}>
        <tr className="hover:bg-base-200/50">
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
              {meeting.calendar_type && (
                <span className={`badge badge-xs sm:badge-sm ${
                  meeting.calendar_type === 'active_client' 
                    ? 'badge-success' 
                    : meeting.calendar_type === 'staff'
                    ? 'badge-warning'
                    : 'badge-info'
                }`}>
                  {meeting.calendar_type === 'active_client' ? 'Active' : 
                   meeting.calendar_type === 'staff' ? 'Staff' : 'Potential'}
                </span>
              )}
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
            <span className="inline-flex items-center">
              {hasExpertNotes ? (
                <AcademicCapIcon className="w-4 h-4 sm:w-5 sm:h-5 text-green-500 mr-1" title="Expert opinion exists" />
              ) : (
                <QuestionMarkCircleIcon className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-400 mr-1" title="No expert opinion" />
              )}
              <span className="text-xs sm:text-sm">{getEmployeeDisplayName(lead.expert || meeting.expert) || <span className="text-gray-400">N/A</span>}</span>
            </span>
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
              {/* Only show join button if location is Teams OR it's a staff meeting */}
              {(meeting.meeting_location === 'Teams' || meeting.location === 'Teams' || meeting.calendar_type === 'staff') && (
                <button 
                  className="btn btn-primary btn-xs sm:btn-sm"
                  onClick={() => {
                    const url = getValidTeamsLink(meeting.teams_meeting_url);
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
                  onClick={() => {
                    setSelectedStaffMeeting(meeting);
                    setIsStaffMeetingEditModalOpen(true);
                  }}
                >
                  <PencilIcon className="w-4 h-4" />
                </button>
              )}
              {/* Only show WhatsApp and Email buttons for non-staff meetings */}
              {meeting.calendar_type !== 'staff' && lead.phone && (
                <button
                  className="btn btn-success btn-sm"
                  title="WhatsApp"
                  onClick={() => handleWhatsAppClick(lead, meeting)}
                >
                  <FaWhatsapp className="w-4 h-4" />
                </button>
              )}
              {meeting.calendar_type !== 'staff' && (lead.lead_number || meeting.lead_number) && (
                <button
                  className="btn btn-info btn-sm"
                  title="Email"
                  onClick={() => handleEmailClick(lead, meeting)}
                >
                  <EnvelopeIcon className="w-4 h-4" />
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
                        className={`btn btn-outline bg-white shadow-sm flex items-center gap-2 px-4 py-2 text-base font-semibold rounded-lg transition-colors ${!meeting.lead.onedrive_folder_link ? 'btn-disabled' : ''}`}
                        style={{ borderColor: '#3b28c7', color: '#3b28c7' }}
                        onMouseEnter={(e) => {
                          if (!e.currentTarget.disabled) {
                            e.currentTarget.style.backgroundColor = '#f3f0ff';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!e.currentTarget.disabled) {
                            e.currentTarget.style.backgroundColor = 'white';
                          }
                        }}
                        disabled={!meeting.lead.onedrive_folder_link}
                      >
                        <FolderIcon className="w-5 h-5" />
                        Documents
                        <span className="badge text-white ml-2" style={{ backgroundColor: '#3b28c7' }}>3</span>
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
          <td colSpan={10} className="p-0">
            <button
              className="bg-base-200 hover:bg-base-300 cursor-pointer transition-colors p-2 text-center w-full block text-primary font-medium flex items-center justify-center gap-2"
              style={{ border: 'none', outline: 'none' }}
              onClick={() => setExpandedMeetingId(expandedMeetingId === meeting.id ? null : meeting.id)}
            >
              <span>{expandedMeetingId === meeting.id ? 'Show Less' : 'Show More'}</span>
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
          <span className="text-lg font-semibold">
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
      <div className="mb-6 flex flex-col md:flex-row gap-4 w-full justify-center items-center">
        <div className="flex items-center gap-2">
          <FunnelIcon className="w-5 h-5 text-gray-500" />
          <div className="flex items-center gap-2">
            <input 
              type="date" 
              className="input input-bordered w-full md:w-auto"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
              }}
              title="From Date"
            />
            <span className="text-gray-500">to</span>
            <input 
              type="date" 
              className="input input-bordered w-full md:w-auto"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
              }}
              title="To Date"
            />
            <button
              onClick={handleShowButton}
              className="btn btn-primary btn-sm"
              title="Apply Date Filter"
            >
              Show
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <UserIcon className="w-5 h-5 text-gray-500" />
          <select 
            className="select select-bordered w-full md:w-auto"
            value={selectedStaff}
            onChange={(e) => setSelectedStaff(e.target.value)}
          >
            <option value="">All Staff</option>
            {staff.map((s, index) => <option key={`${s}-${index}`} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-5 h-5 text-gray-500" />
          <select 
            className="select select-bordered w-full md:w-auto"
            value={selectedMeetingType}
            onChange={(e) => setSelectedMeetingType(e.target.value as 'all' | 'potential' | 'active' | 'staff')}
          >
            <option value="all">All Meetings</option>
            <option value="potential">Potential Clients</option>
            <option value="active">Active Clients</option>
            <option value="staff">Staff Meetings</option>
          </select>
        </div>
      </div>


      {/* Action Buttons Row */}
      <div className="mb-6 flex flex-row items-center justify-between gap-2 w-full">
        <div className="flex flex-row items-center gap-2">
          <div className="btn btn-xs sm:btn-sm flex items-center gap-2 bg-base-200 border-base-300 hover:bg-base-300">
            <span className="text-xs font-medium text-base-content/70">Total Meetings:</span>
            <span className="text-sm font-bold text-primary">{filteredMeetings.length}</span>
          </div>
          <button
            className="btn btn-primary btn-xs sm:btn-sm flex items-center gap-2"
            onClick={openAssignStaffModal}
          >
            <UserGroupIcon className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="text-xs sm:text-sm">Assign Staff</span>
          </button>
        </div>
        <div className="flex flex-row items-center gap-2">
          <button
            className="btn btn-primary btn-xs sm:btn-sm flex items-center gap-2"
            onClick={() => {
              setSelectedDateForMeeting(new Date());
              setSelectedTimeForMeeting('09:00');
              setIsTeamsMeetingModalOpen(true);
            }}
            title="Create Teams Meeting"
          >
            <VideoCameraIcon className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="text-xs sm:text-sm hidden md:inline">Create Teams Meeting</span>
          </button>
          <button
            className="btn btn-outline btn-primary btn-xs sm:btn-sm flex items-center gap-2"
            onClick={() => setViewMode(viewMode === 'cards' ? 'list' : 'cards')}
            title={viewMode === 'cards' ? 'Switch to List View' : 'Switch to Card View'}
          >
            {viewMode === 'cards' ? (
              <Bars3Icon className="w-3 h-3 sm:w-4 sm:h-4" />
            ) : (
              <Squares2X2Icon className="w-3 h-3 sm:w-4 sm:h-4" />
            )}
            <span className="text-xs sm:text-sm hidden md:inline">{viewMode === 'cards' ? 'List View' : 'Card View'}</span>
          </button>
        </div>
      </div>




      {/* Meetings List */}
      <div className="mt-6 bg-base-100 rounded-lg shadow-lg overflow-x-auto">
        {/* Desktop Table - Show when viewMode is 'list' */}
        {viewMode === 'list' && (
          <table className="table w-full text-xs sm:text-sm md:text-base">
            <thead>
              <tr className="bg-base-200 text-sm sm:text-base md:text-lg">
                <th>Lead</th>
                <th>Time</th>
                <th className="hidden sm:table-cell">Manager</th>
                <th className="hidden md:table-cell">Helper</th>
                <th className="hidden lg:table-cell">Category</th>
                <th className="hidden sm:table-cell">Value</th>
                <th className="hidden lg:table-cell">Expert</th>
                <th className="hidden md:table-cell">Location</th>
                <th>Info</th>
                <th className="hidden sm:table-cell">Status</th>
                <th>Actions</th>
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
      {isWhatsAppOpen && selectedLeadForWhatsApp && createPortal(
        <div className="fixed inset-0 bg-white z-[9999]">
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 md:p-6 border-b border-gray-200">
              <div className="flex items-center gap-2 md:gap-4">
                <FaWhatsapp className="w-6 h-6 md:w-8 md:h-8 text-green-600 flex-shrink-0" />
                <h2 className="text-lg md:text-2xl font-bold text-gray-900">WhatsApp</h2>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse flex-shrink-0"></div>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-lg font-semibold text-gray-900 truncate">
                      {selectedLeadForWhatsApp.name}
                    </span>
                    <span className="text-sm text-gray-500 font-mono flex-shrink-0">
                      ({selectedLeadForWhatsApp.lead_number})
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={handleWhatsAppClose}
                className="btn btn-ghost btn-circle flex-shrink-0"
              >
                <XMarkIcon className="w-5 h-5 md:w-6 md:h-6" />
              </button>
            </div>

            {/* Messages - Scrollable */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {isWhatsAppLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="loading loading-spinner loading-lg text-green-500"></div>
                </div>
              ) : whatsAppChatMessages.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <FaWhatsapp className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p className="text-lg font-medium">No messages yet</p>
                  <p className="text-sm">Start the conversation with {selectedLeadForWhatsApp.name}</p>
                </div>
              ) : (
                whatsAppChatMessages.map((message, index) => (
                  <div
                    key={message.id || index}
                    className={`flex flex-col ${message.direction === 'out' ? 'items-end' : 'items-start'}`}
                  >
                    {message.direction === 'out' && (
                      <span className="text-xs text-gray-500 mb-1 mr-2">
                        {message.sender_name || 'You'}
                      </span>
                    )}
                    {message.direction === 'in' && (
                      <span className="text-xs text-gray-500 mb-1 ml-2">
                        {message.sender_name || selectedLeadForWhatsApp.name}
                      </span>
                    )}
                    <div
                      className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-2 shadow-sm ${
                        message.direction === 'out'
                          ? 'bg-green-600 text-white'
                          : 'bg-white text-gray-900 border border-gray-200'
                      }`}
                    >
                      {/* Message content based on type */}
                      {message.message_type === 'text' && (
                        <p className="text-sm break-words">{message.message}</p>
                      )}
                      
                      {message.message_type === 'image' && (
                        <div>
                          {message.media_url && (
                            <div className="relative inline-block">
                              <img 
                                src={message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`)}
                                alt="Image"
                                className="max-w-full md:max-w-[700px] max-h-[300px] md:max-h-[600px] object-cover rounded-lg mb-2 shadow-sm cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => message.media_url && setSelectedMedia({
                                  url: message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`),
                                  type: 'image',
                                  caption: message.caption
                                })}
                                onError={(e) => {
                                  e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik01MCAxMDAgTDEwMCA1MCBMMTUwIDEwMCBMMTAwIDE1MCBMNTAgMTAwWiIgZmlsbD0iI0QxRDVEMCIvPgo8dGV4dCB4PSIxMDAiIHk9IjExMCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE0IiBmaWxsPSIjNjc3NDhCIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5JbWFnZSBVbmF2YWlsYWJsZTwvdGV4dD4KPC9zdmc+';
                                  e.currentTarget.style.border = '1px solid #e5e7eb';
                                  e.currentTarget.style.borderRadius = '0.5rem';
                                }}
                              />
                              <button
                                onClick={() => {
                                  if (!message.media_url) return;
                                  const url = message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`);
                                  const link = document.createElement('a');
                                  link.href = url;
                                  link.download = `image_${Date.now()}.jpg`;
                                  link.click();
                                }}
                                className="absolute top-2 right-2 btn btn-ghost btn-xs bg-black bg-opacity-50 text-white hover:bg-opacity-70"
                                title="Download"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                              </button>
                            </div>
                          )}
                          {message.caption && (
                            <p className="text-sm break-words">{message.caption}</p>
                          )}
                        </div>
                      )}
                      
                      {message.message_type === 'video' && (
                        <div>
                          {message.media_url && (
                            <video 
                              controls
                              className="max-w-full md:max-w-[700px] max-h-[300px] md:max-h-[600px] object-cover rounded-lg mb-2 shadow-sm cursor-pointer hover:opacity-90 transition-opacity"
                              onClick={() => message.media_url && setSelectedMedia({
                                url: message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`),
                                type: 'video',
                                caption: message.caption
                              })}
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                const errorDiv = document.createElement('div');
                                errorDiv.className = 'text-center text-gray-500 p-4 border border-gray-200 rounded-lg bg-gray-50';
                                errorDiv.innerHTML = `
                                  <FilmIcon class="w-12 h-12 mx-auto mb-2 text-gray-400" />
                                  <p class="text-xs font-medium">Video Unavailable</p>
                                  <p class="text-xs opacity-70">Media may have expired</p>
                                `;
                                e.currentTarget.parentNode?.appendChild(errorDiv);
                              }}
                            >
                              <source src={message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`)} />
                              Your browser does not support the video tag.
                            </video>
                          )}
                          {message.caption && (
                            <p className="text-sm break-words">{message.caption}</p>
                          )}
                        </div>
                      )}

                      {/* Message status and time */}
                      <div className="flex items-center gap-1 mt-1 text-xs opacity-70 justify-end">
                        <span>
                          {new Date(message.sent_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                        {message.direction === 'out' && (
                          <span className="inline-block align-middle text-current">
                            {renderMessageStatus(message.whatsapp_status)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Message Input - Fixed */}
            <div className="flex-shrink-0 p-4 bg-white border-t border-gray-200">
              <form onSubmit={handleSendWhatsAppMessage} className="flex items-center gap-2">
                <button type="button" className="btn btn-ghost btn-circle">
                  <FaceSmileIcon className="w-6 h-6 text-gray-500" />
                </button>
                
                {/* File upload button */}
                <label className="btn btn-ghost btn-circle cursor-pointer">
                  <PaperClipIcon className="w-6 h-6 text-gray-500" />
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,audio/*,video/*"
                    onChange={handleFileSelect}
                    disabled={uploadingMedia}
                  />
                </label>

                {/* Selected file preview */}
                {selectedFile && (
                  <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-1">
                    <span className="text-xs text-gray-600">{selectedFile.name}</span>
                    <button
                      type="button"
                      onClick={() => setSelectedFile(null)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <XMarkIcon className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <input
                  type="text"
                  value={whatsAppInput}
                  onChange={(e) => setWhatsAppInput(e.target.value)}
                  placeholder={selectedFile ? "Add a caption..." : "Type a message..."}
                  className="flex-1 input input-bordered rounded-full"
                  disabled={sending || uploadingMedia}
                />
                
                {selectedFile ? (
                  <button
                    type="button"
                    onClick={handleSendMedia}
                    disabled={uploadingMedia}
                    className="btn btn-primary btn-circle"
                  >
                    {uploadingMedia ? (
                      <div className="loading loading-spinner loading-sm"></div>
                    ) : (
                      <PaperAirplaneIcon className="w-5 h-5" />
                    )}
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!whatsAppInput.trim() || sending}
                    className="btn btn-primary btn-circle"
                  >
                    {sending ? (
                      <div className="loading loading-spinner loading-sm"></div>
                    ) : (
                      <PaperAirplaneIcon className="w-5 h-5" />
                    )}
                  </button>
                )}
              </form>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Email Thread Modal */}
      {isEmailModalOpen && selectedLeadForEmail && createPortal(
        <div className="fixed inset-0 bg-white z-[9999]">
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 md:p-6 border-b border-gray-200">
              <div className="flex items-center gap-2 md:gap-4">
                <h2 className="text-lg md:text-2xl font-bold text-gray-900">Email Thread</h2>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-gray-600">
                    {selectedLeadForEmail.name} ({selectedLeadForEmail.lead_number})
                  </span>
                </div>
              </div>
              <button
                onClick={handleEmailClose}
                className="btn btn-ghost btn-circle"
              >
                <XMarkIcon className="w-5 h-5 md:w-6 md:h-6" />
              </button>
            </div>

            {/* Email Thread */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6">
              {emailsLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="loading loading-spinner loading-lg text-blue-500"></div>
                </div>
              ) : emails.length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-500">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <p className="text-lg font-medium">No messages yet</p>
                    <p className="text-sm">Start a conversation with {selectedLeadForEmail.name}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {[...emails]
                    .sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime())
                    .map((message, index) => (
                      <div
                        key={message.message_id}
                        data-email-id={message.message_id}
                        className={`flex flex-col ${message.direction === 'outgoing' ? 'items-end' : 'items-start'}`}
                      >
                        {/* Message Label */}
                        <div className={`mb-2 px-3 py-1 rounded-full text-xs font-semibold ${
                          message.direction === 'outgoing'
                            ? 'bg-gradient-to-r from-blue-500 via-purple-500 to-purple-600 text-white'
                            : 'bg-gradient-to-r from-pink-500 via-purple-500 to-purple-600 text-white'
                        }`}>
                          {message.direction === 'outgoing' ? 'Team' : 'Client'}
                        </div>
                        
                        {/* Message Bubble */}
                        <div
                          className={`max-w-[85%] md:max-w-md lg:max-w-lg xl:max-w-xl ${
                            message.direction === 'outgoing'
                              ? 'bg-[#3E28CD] text-white'
                              : 'bg-gray-100 text-gray-900'
                          } rounded-2xl px-4 py-3 shadow-sm`}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-semibold text-sm">
                              {message.direction === 'outgoing' ? (currentUserFullName || 'You') : selectedLeadForEmail.name}
                            </span>
                            <span className="text-xs opacity-70">
                              {new Date(message.sent_at).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
                          </div>
                          {message.subject && (
                            <div className="font-medium mb-2">
                              {message.subject}
                            </div>
                          )}
                          <div className="text-sm whitespace-pre-wrap">
                            <div dangerouslySetInnerHTML={{ 
                              __html: sanitizeHtml(stripSignatureAndQuotedText(message.body_preview || '')) 
                            }} />
                          </div>
                          {/* Attachments */}
                          {message.attachments && message.attachments.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-200">
                              <div className="text-xs opacity-70 mb-2">Attachments:</div>
                              <div className="flex flex-wrap gap-2">
                                {message.attachments.map((attachment: any, idx: number) => (
                                  <button 
                                    key={attachment.id}
                                    className="btn btn-outline btn-xs gap-1"
                                    onClick={() => handleDownloadAttachment(message.message_id, attachment)}
                                    disabled={downloadingAttachments[attachment.id]}
                                  >
                                    {downloadingAttachments[attachment.id] ? (
                                      <span className="loading loading-spinner loading-xs" />
                                    ) : (
                                      <PaperClipIcon className="w-3 h-3" />
                                    )}
                                    <span className="truncate max-w-[100px]">{attachment.name}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Compose Area */}
            <div className="border-t border-gray-200 p-4 md:p-6">
              {showCompose ? (
                <div className="space-y-4">
                  <input
                    type="text"
                    placeholder="Subject"
                    value={composeSubject}
                    onChange={(e) => setComposeSubject(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <textarea
                    placeholder="Type your message..."
                    value={composeBody}
                    onChange={(e) => setComposeBody(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    rows={4}
                  />
                  
                  {/* Attachments */}
                  {composeAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {composeAttachments.map((file, index) => (
                        <div key={index} className="flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-lg">
                          <PaperClipIcon className="w-4 h-4 text-gray-500" />
                          <span className="text-sm">{file.name}</span>
                          <button
                            onClick={() => setComposeAttachments(prev => prev.filter((_, i) => i !== index))}
                            className="text-red-500 hover:text-red-700"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="btn btn-ghost btn-sm"
                      >
                        <PaperClipIcon className="w-4 h-4" />
                        Attach
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        onChange={(e) => e.target.files && handleAttachmentUpload(e.target.files)}
                        className="hidden"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowCompose(false)}
                        className="btn btn-outline btn-sm"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSendEmail}
                        disabled={sending || !composeBody.trim()}
                        className="btn btn-primary btn-sm"
                      >
                        {sending ? (
                          <div className="loading loading-spinner loading-xs"></div>
                        ) : (
                          <>
                            <PaperAirplaneIcon className="w-4 h-4" />
                            Send
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowCompose(true)}
                  className="w-full btn btn-primary"
                >
                  <PaperAirplaneIcon className="w-4 h-4 mr-2" />
                  Compose Message
                </button>
              )}
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
                                    <div className="flex items-center gap-1">
                                      <span>{meeting.lead?.expert || 'N/A'}</span>
                                      {meeting.lead?.expert_notes ? (
                                        <AcademicCapIcon className="w-4 h-4 text-green-600 flex-shrink-0" title="Expert search completed" />
                                      ) : (
                                        <QuestionMarkCircleIcon className="w-4 h-4 text-yellow-600 flex-shrink-0" title="Expert search pending" />
                                      )}
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

      {/* Document Modal */}
      <DocumentModal
        isOpen={isDocumentModalOpen}
        onClose={() => setIsDocumentModalOpen(false)}
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