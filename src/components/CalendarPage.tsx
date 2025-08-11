import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarIcon, FunnelIcon, UserIcon, CurrencyDollarIcon, VideoCameraIcon, ChevronDownIcon, DocumentArrowUpIcon, FolderIcon, ClockIcon, ChevronLeftIcon, ChevronRightIcon, AcademicCapIcon, QuestionMarkCircleIcon, XMarkIcon, PaperAirplaneIcon, FaceSmileIcon, PaperClipIcon, Bars3Icon, Squares2X2Icon, UserGroupIcon } from '@heroicons/react/24/outline';
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
  const signature = `<br><br>Best regards,<br>${senderName}<br>Decker Pex Levi Law Offices`;
  const fullBody = body + signature;

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

// Department mapping: department name to categories
const DEPARTMENT_CATEGORIES = [
  {
    name: 'Austria/Undefined',
    categories: ['Austrian Citizenship', 'Austrian Passport'],
  },
  {
    name: 'Germany/Undefined',
    categories: ['German Citizenship'],
  },
  {
    name: 'Germany/Lived bef 1933,le af',
    categories: ['Germany/Lived bef 1933,le af'],
  },
  {
    name: 'Immigration Israel/Joint life/Family r',
    categories: ['Immigration Israel/Joint life/Family r'],
  },
  {
    name: 'Immigration Israel/Entry into Israel',
    categories: ['Immigration Israel/Entry into Israel'],
  },
  {
    name: 'USA/Citiz. f gr+children',
    categories: ['USA/Citiz. f gr+children'],
  },
  {
    name: 'USA/Citiz. f grandchild',
    categories: ['USA/Citiz. f grandchild'],
  },
  {
    name: 'USA/Green Cards',
    categories: ['USA/Green Cards'],
  },
  {
    name: 'Commer/Civil/Adm/Fam/Inheritance',
    categories: ['Commer/Civil/Adm/Fam/Inheritance'],
  },
  {
    name: 'Eligibility Checker/German/Austria',
    categories: ['Eligibility Checker/German/Austria'],
  },
];

// Helper: group meetings by department
function groupMeetingsByDepartment(meetings: any[]) {
  const grouped: { [key: string]: any[] } = {};
  for (const dept of DEPARTMENT_CATEGORIES) {
    grouped[dept.name] = [];
  }
  for (const meeting of meetings) {
    const lead = meeting.lead || {};
    const category = lead.category || meeting.category || '';
    // Map category to department
    let dept = DEPARTMENT_CATEGORIES.find(d => d.categories.includes(category));
    // Special logic for German Citizenship and Austrian Citizenship/Passport
    if (category === 'German Citizenship') {
      dept = DEPARTMENT_CATEGORIES.find(d => d.name === 'Germany/Undefined');
    } else if (category === 'Austrian Citizenship' || category === 'Austrian Passport') {
      dept = DEPARTMENT_CATEGORIES.find(d => d.name === 'Austria/Undefined');
    }
    if (dept) {
      grouped[dept.name].push(meeting);
    }
  }
  return grouped;
}

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
  // Accordion state for departments
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  const navigate = useNavigate();

  // WhatsApp functionality
  const [isWhatsAppOpen, setIsWhatsAppOpen] = useState(false);
  const [whatsAppInput, setWhatsAppInput] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('list');
  // WhatsApp chat messages for the chat box (from selectedLead.manual_interactions)
  const [selectedLeadForWhatsApp, setSelectedLeadForWhatsApp] = useState<any>(null);
  const { instance, accounts } = useMsal();

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
      // Fetch all meetings, including correct join to leads table
      const { data: meetingsData, error: meetingsError } = await supabase
        .from('meetings')
        .select('*, lead:leads!client_id(id, name, lead_number, onedrive_folder_link, stage, manager, category, balance, balance_currency, expert_notes, expert, probability, phone, email, manual_interactions)')
        .or('status.is.null,status.neq.canceled')
        .order('meeting_date', { ascending: false });
      
      if (meetingsError) {
        console.error('Error fetching meetings:', meetingsError);
      } else {
        // Debug: Log the first few meetings to check data structure
        console.log('Fetched meetings data:', meetingsData?.slice(0, 3));
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

    // Calculate total NIS balance for the day
    const totalNIS = filtered.reduce((acc, meeting) => {
      const lead = meeting.lead || {};
              if (typeof lead.balance === 'number' && (lead.balance_currency === '₪' || !lead.balance_currency)) {
        return acc + lead.balance;
      }
      return acc;
    }, 0);
    setTotalAmount(totalNIS);

  }, [selectedDate, selectedStaff, meetings]);

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

  const getStageBadge = (stage: string) => {
    if (!stage || typeof stage !== 'string' || !stage.trim()) {
      return (
        <span
          className="btn btn-primary btn-sm pointer-events-none font-semibold whitespace-nowrap"
          style={{ background: '#3b28c7' }}
        >
          No Stage
        </span>
      );
    }
    return (
      <span
        className="btn btn-primary btn-sm pointer-events-none font-semibold whitespace-nowrap"
        style={{ background: '#3b28c7' }}
      >
        {stage.replace(/_/g, ' ')}
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
    console.log('Email button clicked for:', {
      lead,
      meetingId: meeting.id,
      leadNumber: lead.lead_number,
      meetingLeadNumber: meeting.lead_number
    });
    
    // Set the selected lead for email and open the modal
    setSelectedLeadForEmail(lead);
    setIsEmailModalOpen(true);
  };

  // Helper function to handle WhatsApp button click
  const handleWhatsAppClick = (lead: any, meeting: any) => {
    // Debug: Log the lead data to ensure it's correct
    console.log('WhatsApp button clicked for:', {
      lead,
      meetingId: meeting.id,
      leadNumber: lead.lead_number,
      meetingLeadNumber: meeting.lead_number,
      leadId: lead.id,
      meetingLeadId: meeting.lead_id
    });
    
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
      // Get today and next 7 days
      const today = new Date().toISOString().split('T')[0];
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];
      
      // Initialize modal date to today if not set
      if (!modalSelectedDate) {
        setModalSelectedDate(today);
      }

      // Fetch meetings for today and next 7 days
      const { data: meetingsData, error: meetingsError } = await supabase
        .from('meetings')
        .select('*, lead:leads!client_id(id, name, lead_number, stage, manager, category, balance, balance_currency, expert_notes, expert, probability, phone, email, language)')
        .gte('meeting_date', today)
        .lte('meeting_date', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
        .or('status.is.null,status.neq.canceled')
        .order('meeting_date', { ascending: true })
        .order('meeting_time', { ascending: true });

      if (meetingsError) throw meetingsError;

      // Fetch available staff
      const { data: staffData, error: staffError } = await supabase
        .from('users')
        .select('full_name, email')
        .eq('is_active', true)
        .order('full_name');

      if (staffError) throw staffError;

      const staffNames = staffData?.map(user => user.full_name || user.email).filter(Boolean) || [];

      setAssignStaffMeetings(meetingsData || []);
      setAvailableStaff(staffNames);
    } catch (error) {
      console.error('Error fetching assign staff data:', error);
      toast.error('Failed to load meetings data');
    } finally {
      setAssignStaffLoading(false);
    }
  };

  const handleAssignStaff = async (meetingId: number, field: 'meeting_manager' | 'helper', value: string) => {
    try {
      // Find the meeting to get the client_id
      const meeting = assignStaffMeetings.find(m => m.id === meetingId);
      if (!meeting || !meeting.client_id) {
        throw new Error('Meeting or client_id not found');
      }

      // Update meetings table
      const { error: meetingError } = await supabase
        .from('meetings')
        .update({ [field]: value })
        .eq('id', meetingId);

      if (meetingError) throw meetingError;

      // Update leads table - map meeting_manager to manager, helper to helper
      const leadField = field === 'meeting_manager' ? 'manager' : 'helper';
      const { error: leadError } = await supabase
        .from('leads')
        .update({ [leadField]: value })
        .eq('id', meeting.client_id);

      if (leadError) throw leadError;

      // Update local state
      setAssignStaffMeetings(prev => 
        prev.map(meeting => 
          meeting.id === meetingId 
            ? { 
                ...meeting, 
                [field]: value,
                lead: {
                  ...meeting.lead,
                  [leadField]: value
                }
              }
            : meeting
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
  };

  // Helper function to get available dates from meetings
  const getAvailableDates = () => {
    const dates = [...new Set(assignStaffMeetings.map(m => m.meeting_date))].sort();
    return dates;
  };

  // Helper function to filter meetings by date and staff
  const getFilteredMeetings = () => {
    let filtered = assignStaffMeetings.filter(m => m.meeting_date === modalSelectedDate);
    
    if (selectedStaffFilter) {
      filtered = filtered.filter(m => {
        const lead = m.lead || {};
        return (
          lead.manager === selectedStaffFilter ||
          lead.helper === selectedStaffFilter ||
          m.meeting_manager === selectedStaffFilter ||
          m.helper === selectedStaffFilter
        );
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
    const hasExpertNotes = Array.isArray(lead.expert_notes) ? lead.expert_notes.length > 0 : false;
    const probability = lead.probability ?? meeting.probability;
    let probabilityColor = 'text-red-600';
    if (probability >= 80) probabilityColor = 'text-green-600';
    else if (probability >= 60) probabilityColor = 'text-yellow-600';
    else if (probability >= 40) probabilityColor = 'text-orange-600';

    return (
      <div key={meeting.id} className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 border border-gray-100 group flex flex-col justify-between h-full min-h-[340px] relative pb-16 md:text-lg md:leading-relaxed">
        <div onClick={() => setExpandedMeetingId(expandedMeetingId === meeting.id ? null : meeting.id)} className="flex-1 cursor-pointer flex flex-col">
          {/* Lead Number and Name */}
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs md:text-base font-semibold text-gray-400 tracking-widest">{lead.lead_number || meeting.lead_number}</span>
            <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
            <h3 className="text-lg md:text-2xl font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{lead.name || meeting.name}</h3>
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
              {lead.stage || meeting.stage ? (lead.stage || meeting.stage).replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : 'N/A'}
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

            {/* Manager */}
            <div className="flex justify-between items-center py-1">
              <span className="text-xs md:text-base font-semibold text-gray-500">Manager</span>
              <span className="text-sm md:text-lg font-bold text-gray-800 ml-2">
                {lead.manager || meeting.meeting_manager || '---'}
              </span>
            </div>

            {/* Helper */}
            <div className="flex justify-between items-center py-1">
              <span className="text-xs md:text-base font-semibold text-gray-500">Helper</span>
              <span className="text-sm md:text-lg font-bold text-gray-800 ml-2">
                {lead.helper || meeting.helper || '---'}
              </span>
            </div>

            {/* Category */}
            <div className="flex justify-between items-center py-1">
              <span className="text-xs md:text-base font-semibold text-gray-500">Category</span>
              <span className="text-sm md:text-lg font-bold text-gray-800 ml-2">{lead.category || meeting.category || 'N/A'}</span>
            </div>

            {/* Amount */}
            <div className="flex justify-between items-center py-1">
              <span className="text-xs md:text-base font-semibold text-gray-500">Amount</span>
              <span className="text-sm md:text-lg font-bold text-gray-800 ml-2">
                {typeof lead.balance === 'number'
                  ? `${getCurrencySymbol(lead.balance_currency)}${lead.balance.toLocaleString()}`
                  : (typeof meeting.meeting_amount === 'number' ? `${getCurrencySymbol(meeting.meeting_currency)}${meeting.meeting_amount.toLocaleString()}` : '₪0')}
              </span>
            </div>

            {/* Expert */}
            <div className="flex justify-between items-center py-1">
              <span className="text-xs md:text-base font-semibold text-gray-500">Expert</span>
              <span className="text-sm md:text-lg font-bold text-gray-800 ml-2">
                {lead.expert || meeting.expert || 'N/A'}
              </span>
            </div>

            {/* Location */}
            <div className="flex justify-between items-center py-1">
              <span className="text-xs md:text-base font-semibold text-gray-500">Location</span>
              <span className="text-sm md:text-lg font-bold text-gray-800 ml-2">
                {meeting.location || meeting.meeting_location || 'N/A'}
              </span>
            </div>

            {/* Probability */}
            <div className="flex justify-between items-center py-1">
              <span className="text-xs md:text-base font-semibold text-gray-500">Probability</span>
              <span className={`text-sm md:text-lg font-bold ml-2 ${probabilityColor}`}>
                {typeof probability === 'number' ? `${probability}%` : 'N/A'}
              </span>
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
            {lead.phone && (
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
            {(lead.lead_number || meeting.lead_number) && (
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
    const hasExpertNotes = Array.isArray(lead.expert_notes) ? lead.expert_notes.length > 0 : false;
    const probability = lead.probability ?? meeting.probability;
    let probabilityColor = 'text-red-600';
    if (probability >= 80) probabilityColor = 'text-green-600';
    else if (probability >= 60) probabilityColor = 'text-yellow-600';
    else if (probability >= 40) probabilityColor = 'text-orange-600';
    
    return (
      <React.Fragment key={meeting.id}>
        <tr className="hover:bg-base-200/50">
          <td className="font-bold">
            <Link to={`/clients/${lead.lead_number || meeting.lead_number}`} className="text-black hover:opacity-75">
              {lead.name || meeting.name} ({lead.lead_number || meeting.lead_number})
            </Link>
          </td>
          <td>{meeting.meeting_time ? meeting.meeting_time.slice(0,5) : ''}</td>
          <td>{lead.manager || meeting.meeting_manager || '---'}</td>
          <td>{lead.helper || meeting.helper || '---'}</td>
          <td>{lead.category || meeting.category || 'N/A'}</td>
          <td>
            {typeof lead.balance === 'number'
              ? `${getCurrencySymbol(lead.balance_currency)}${lead.balance.toLocaleString()}`
              : (typeof meeting.meeting_amount === 'number' ? `${getCurrencySymbol(meeting.meeting_currency)}${meeting.meeting_amount.toLocaleString()}` : '0')}
          </td>
          <td>
            <span className="inline-flex items-center">
              {hasExpertNotes ? (
                <AcademicCapIcon className="w-5 h-5 text-green-500 mr-1" title="Expert opinion exists" />
              ) : (
                <QuestionMarkCircleIcon className="w-5 h-5 text-yellow-400 mr-1" title="No expert opinion" />
              )}
              {lead.expert || meeting.expert || <span className="text-gray-400">N/A</span>}
            </span>
          </td>
          <td>{meeting.location || meeting.meeting_location || 'N/A'}</td>
          <td>
            <span className={`font-bold ${probabilityColor}`}>
              {typeof probability === 'number' ? `${probability}%` : 'N/A'}
            </span>
          </td>
          <td>{getStageBadge(lead.stage || meeting.stage)}</td>
          <td>
            <div className="flex flex-row items-center gap-2">
              <button 
                className="btn btn-primary btn-sm"
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
                <VideoCameraIcon className="w-4 h-4" />
              </button>
              {lead.phone && (
                <button
                  className="btn btn-success btn-sm"
                  title="WhatsApp"
                  onClick={() => handleWhatsAppClick(lead, meeting)}
                >
                  <FaWhatsapp className="w-4 h-4" />
                </button>
              )}
              {(lead.lead_number || meeting.lead_number) && (
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

  // After the main table, render department tables
  const departmentMeetings = groupMeetingsByDepartment(filteredMeetings);

  return (
    <div className="p-4 md:p-6 lg:p-8 text-base">
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
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <CalendarIcon className="w-8 h-8 text-primary" />
            <span className="text-3xl">Calendar</span>
          </h1>
          <button
            className="btn btn-primary btn-lg flex items-center gap-2"
            onClick={openAssignStaffModal}
          >
            <UserGroupIcon className="w-5 h-5" />
            Assign Staff
          </button>
        </div>

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

      {/* View Toggle Button */}
      <div className="flex justify-end mb-4">
        <button
          className="btn btn-outline btn-primary btn-sm flex items-center gap-2"
          onClick={() => setViewMode(viewMode === 'cards' ? 'list' : 'cards')}
          title={viewMode === 'cards' ? 'Switch to List View' : 'Switch to Card View'}
        >
          {viewMode === 'cards' ? (
            <Bars3Icon className="w-5 h-5" />
          ) : (
            <Squares2X2Icon className="w-5 h-5" />
          )}
          <span className="hidden md:inline">{viewMode === 'cards' ? 'List View' : 'Card View'}</span>
        </button>
      </div>

      {/* Meetings List */}
      <div className="bg-base-100 rounded-lg shadow-lg overflow-x-auto">
        {/* Desktop Table - Show when viewMode is 'list' */}
        {viewMode === 'list' && (
          <table className="table w-full text-base">
            <thead>
              <tr className="bg-base-200 text-lg">
                <th>Lead</th>
                <th>Time</th>
                <th>Manager</th>
                <th>Helper</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Expert</th>
                <th>Location</th>
                <th>Probability</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={11} className="text-center p-8 text-lg">Loading meetings...</td></tr>
              ) : filteredMeetings.length > 0 ? (
                filteredMeetings.map(renderMeetingRow)
              ) : (
                <tr><td colSpan={11} className="text-center p-8 text-lg">No meetings found for the selected filters.</td></tr>
              )}
            </tbody>
          </table>
        )}
        
        {/* Cards View - Show when viewMode is 'cards' */}
        {viewMode === 'cards' && (
          <div>
            {isLoading ? (
              <div className="text-center p-8">
                <div className="loading loading-spinner loading-lg"></div>
                <p className="mt-4 text-base-content/60">Loading meetings...</p>
              </div>
            ) : filteredMeetings.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6 p-6">
                {filteredMeetings.map(renderMeetingCard)}
              </div>
            ) : (
              <div className="text-center p-8">
                <div className="text-base-content/60">
                  <CalendarIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium">No meetings found</p>
                  <p className="text-sm">Try adjusting your search or filters</p>
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

      {/* Department Tables - Accordion Style */}
      {DEPARTMENT_CATEGORIES.map(({ name: deptName }) => {
        const deptMeetings = departmentMeetings[deptName] || [];
        const totalAmount = deptMeetings.reduce((sum: number, meeting: any) => {
          const lead = meeting.lead || {};
          if (typeof lead.balance === 'number') {
            return sum + lead.balance;
          }
          return sum;
        }, 0);
        const isExpanded = expandedDept === deptName;
        return (
          <div key={deptName} className="mt-6 bg-base-100 rounded-lg shadow-lg overflow-x-auto border border-base-200">
            {/* Header row with chevron */}
            <button
              className="w-full flex items-center justify-between px-6 py-3 bg-base-200 rounded-t-lg focus:outline-none cursor-pointer"
              onClick={() => setExpandedDept(isExpanded ? null : deptName)}
              aria-expanded={isExpanded}
            >
              <span className="text-lg font-bold text-gray-800 flex items-center gap-2">
                {deptName}
                <span className="ml-2 text-base-content/60 font-semibold">({deptMeetings.length})</span>
                {totalAmount > 0 && (
                  <span className="ml-2 text-sm text-primary font-semibold">₪{totalAmount.toLocaleString()}</span>
                )}
              </span>
              <ChevronDownIcon className={`w-6 h-6 text-gray-700 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
            {/* Content */}
            {isExpanded && (
              <div className="p-4">
                {/* Desktop Table - Show when viewMode is 'list' */}
                {viewMode === 'list' && (
                  <table className="table w-full text-base">
                    <thead>
                      <tr className="bg-base-200 text-lg">
                        <th>Lead</th>
                        <th>Time</th>
                        <th>Manager</th>
                        <th>Helper</th>
                        <th>Category</th>
                        <th>Amount</th>
                        <th>Expert</th>
                        <th>Location</th>
                        <th>Probability</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deptMeetings.map(renderMeetingRow)}
                    </tbody>
                  </table>
                )}
                {/* Cards View - Show when viewMode is 'cards' */}
                {viewMode === 'cards' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6">
                    {deptMeetings.map(renderMeetingCard)}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

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
                                  console.log('Failed to load image:', message.media_url);
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
                                console.log('Failed to load video:', message.media_url);
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
            <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <UserGroupIcon className="w-8 h-8" />
                  <h2 className="text-2xl font-bold">Assign Staff to Meetings</h2>
                </div>
                <button
                  onClick={() => setIsAssignStaffModalOpen(false)}
                  className="btn btn-ghost btn-circle text-white hover:bg-white hover:bg-opacity-20"
                >
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>
              <p className="text-purple-100 mt-2">Assign managers and helpers to meetings</p>
              
              {/* Filters */}
              <div className="mt-4 flex flex-col md:flex-row gap-4">
                {/* Date Selector */}
                <div className="flex items-center gap-2">
                  <label className="text-sm font-semibold">Date:</label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const currentDate = new Date(modalSelectedDate);
                        currentDate.setDate(currentDate.getDate() - 1);
                        setModalSelectedDate(currentDate.toISOString().split('T')[0]);
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
                        const currentDate = new Date(modalSelectedDate);
                        currentDate.setDate(currentDate.getDate() + 1);
                        setModalSelectedDate(currentDate.toISOString().split('T')[0]);
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
                    {availableStaff.map(staff => (
                      <option key={staff} value={staff}>{staff}</option>
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
                        <div className="grid gap-4">
                          {filteredMeetings.map((meeting) => (
                            <div key={meeting.id} className="bg-white rounded-xl p-4 border border-gray-200 shadow-lg hover:shadow-xl transition-shadow duration-200">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {/* Meeting Info */}
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-gray-600">Lead:</span>
                                    <Link 
                                      to={`/clients/${meeting.lead?.lead_number || meeting.lead_number}`}
                                      className="text-sm font-bold text-blue-600 hover:text-blue-800 hover:underline truncate"
                                    >
                                      {meeting.lead?.lead_number || meeting.lead_number} - {meeting.lead?.name || 'N/A'}
                                    </Link>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-gray-600">Time:</span>
                                    <span className="text-sm font-bold text-gray-900">{meeting.meeting_time || 'No time'}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-gray-600">Location:</span>
                                    <span className="text-sm font-bold text-gray-900 truncate">{meeting.meeting_location || 'N/A'}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-gray-600">Category:</span>
                                    <span className="text-sm font-bold text-gray-900 truncate">{meeting.lead?.category || 'N/A'}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-gray-600">Expert:</span>
                                    <div className="flex items-center gap-1">
                                      <span className="text-sm font-bold text-gray-900 truncate">{meeting.lead?.expert || 'N/A'}</span>
                                      {meeting.lead?.expert_notes ? (
                                        <AcademicCapIcon className="w-4 h-4 text-green-600 flex-shrink-0" title="Expert search completed" />
                                      ) : (
                                        <QuestionMarkCircleIcon className="w-4 h-4 text-yellow-600 flex-shrink-0" title="Expert search pending" />
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-gray-600">Language:</span>
                                    <span className="text-sm font-bold text-gray-900 truncate">{meeting.lead?.language || 'N/A'}</span>
                                  </div>
                                </div>

                                {/* Manager Assignment */}
                                <div className="space-y-2">
                                  <label className="text-sm font-semibold text-gray-600">Manager</label>
                                  <div className="relative">
                                    {(() => {
                                      const state = getMeetingDropdownState(meeting.id);
                                      return (
                                        <>
                                          <input
                                            type="text"
                                            placeholder={meeting.meeting_manager || "Select manager..."}
                                            className="input input-bordered w-full pr-10 cursor-pointer"
                                            value={state.managerSearch}
                                            onChange={(e) => updateMeetingDropdownState(meeting.id, { managerSearch: e.target.value })}
                                            onFocus={() => {
                                              updateMeetingDropdownState(meeting.id, { showManagerDropdown: true, managerSearch: '' });
                                            }}
                                            onBlur={() => setTimeout(() => updateMeetingDropdownState(meeting.id, { showManagerDropdown: false }), 200)}
                                            readOnly={!state.showManagerDropdown}
                                          />
                                          <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                                            <ChevronDownIcon className="w-4 h-4 text-gray-400" />
                                          </div>
                                          {state.showManagerDropdown && (
                                            <div className="absolute z-10 w-full max-h-32 overflow-y-auto border border-gray-200 rounded-lg bg-white shadow-lg">
                                              <div
                                                className="px-3 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-100"
                                                onClick={() => {
                                                  handleAssignStaff(meeting.id, 'meeting_manager', '');
                                                  updateMeetingDropdownState(meeting.id, { managerSearch: '', showManagerDropdown: false });
                                                }}
                                              >
                                                <span className="text-sm text-gray-600">Clear assignment</span>
                                              </div>
                                              {availableStaff
                                                .filter(staff => staff.toLowerCase().includes(state.managerSearch.toLowerCase()))
                                                .map((staff) => (
                                                  <div
                                                    key={staff}
                                                    className="px-3 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-100"
                                                    onClick={() => {
                                                      handleAssignStaff(meeting.id, 'meeting_manager', staff);
                                                      updateMeetingDropdownState(meeting.id, { managerSearch: '', showManagerDropdown: false });
                                                    }}
                                                  >
                                                    <span className="text-sm">{staff}</span>
                                                  </div>
                                                ))}
                                            </div>
                                          )}
                                        </>
                                      );
                                    })()}
                                  </div>
                                </div>

                                {/* Helper Assignment */}
                                <div className="space-y-2">
                                  <label className="text-sm font-semibold text-gray-600">Helper</label>
                                  <div className="relative">
                                    {(() => {
                                      const state = getMeetingDropdownState(meeting.id);
                                      return (
                                        <>
                                          <input
                                            type="text"
                                            placeholder={meeting.helper || "Select helper..."}
                                            className="input input-bordered w-full pr-10 cursor-pointer"
                                            value={state.helperSearch}
                                            onChange={(e) => updateMeetingDropdownState(meeting.id, { helperSearch: e.target.value })}
                                            onFocus={() => {
                                              updateMeetingDropdownState(meeting.id, { showHelperDropdown: true, helperSearch: '' });
                                            }}
                                            onBlur={() => setTimeout(() => updateMeetingDropdownState(meeting.id, { showHelperDropdown: false }), 200)}
                                            readOnly={!state.showHelperDropdown}
                                          />
                                          <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                                            <ChevronDownIcon className="w-4 h-4 text-gray-400" />
                                          </div>
                                          {state.showHelperDropdown && (
                                            <div className="absolute z-10 w-full max-h-32 overflow-y-auto border border-gray-200 rounded-lg bg-white shadow-lg">
                                              <div
                                                className="px-3 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-100"
                                                onClick={() => {
                                                  handleAssignStaff(meeting.id, 'helper', '');
                                                  updateMeetingDropdownState(meeting.id, { helperSearch: '', showHelperDropdown: false });
                                                }}
                                              >
                                                <span className="text-sm text-gray-600">Clear assignment</span>
                                              </div>
                                              {availableStaff
                                                .filter(staff => staff.toLowerCase().includes(state.helperSearch.toLowerCase()))
                                                .map((staff) => (
                                                  <div
                                                    key={staff}
                                                    className="px-3 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-100"
                                                    onClick={() => {
                                                      handleAssignStaff(meeting.id, 'helper', staff);
                                                      updateMeetingDropdownState(meeting.id, { helperSearch: '', showHelperDropdown: false });
                                                    }}
                                                  >
                                                    <span className="text-sm">{staff}</span>
                                                  </div>
                                                ))}
                                            </div>
                                          )}
                                        </>
                                      );
                                    })()}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
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
    </div>
  );
};

export default CalendarPage; 