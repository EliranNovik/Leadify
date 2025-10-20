import React, { useState, useEffect, useCallback, Fragment, useMemo } from 'react';
import { ClientTabProps } from '../../types/client';
import TimelineHistoryButtons from './TimelineHistoryButtons';
import EmojiPicker from 'emoji-picker-react';
import {
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
  PhoneIcon,
  ArrowUturnRightIcon,
  ArrowUturnLeftIcon,
  PencilSquareIcon,
  PaperClipIcon,
  XMarkIcon,
  UserIcon,
  PaperAirplaneIcon,
  FaceSmileIcon,
  ChevronDownIcon,
  SparklesIcon,
  ExclamationTriangleIcon,
  PlayIcon,
  StopIcon,
  SpeakerWaveIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../../msalConfig';
import { supabase } from '../../lib/supabase';
import { toast } from 'react-hot-toast';
import { InteractionRequiredAuthError, type IPublicClientApplication, type AccountInfo } from '@azure/msal-browser';
import { createPortal } from 'react-dom';
import AISummaryPanel from './AISummaryPanel';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import sanitizeHtml from 'sanitize-html';
import { buildApiUrl } from '../../lib/api';
import { fetchLegacyInteractions, testLegacyInteractionsAccess } from '../../lib/legacyInteractionsApi';
import { appendEmailSignature } from '../../lib/emailSignature';

interface Attachment {
  id: string;
  name: string;
  contentType: string;
  sizeInBytes: number;
  isInline: boolean;
  contentUrl?: string; // For download
}

interface CallLog {
  id: number;
  cdate: string;
  udate?: string;
  direction?: string;
  date?: string;
  time?: string;
  source?: string;
  incomingdid?: string;
  destination?: string;
  status?: string;
  url?: string;
  call_id?: string;
  action?: string;
  duration?: number;
  lead_id?: number;
  lead_interaction_id?: number;
  employee_id?: number;
}

interface Interaction {
  id: string | number;
  date: string;
  time: string;
  raw_date: string;
  employee: string;
  direction: 'in' | 'out';
  kind: string;
  length: string;
  content: string;
  observation: string;
  editable: boolean;
  status?: string;
  subject?: string;
  error_message?: string; // Add error message field for WhatsApp failures
  call_log?: CallLog; // Add call log data for call interactions
  recording_url?: string; // Add recording URL for call interactions
  call_duration?: number; // Add call duration for call interactions
}

const contactMethods = [
  { value: 'email', label: 'E-mail' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'call', label: 'Call' },
  { value: 'call_log', label: 'Call Log' },
  { value: 'sms', label: 'SMS' },
  { value: 'office', label: 'In Office' },
];

// Function to strip signatures while preserving HTML formatting
const stripSignatureAndQuotedTextPreserveHtml = (html: string): string => {
  if (!html) return '';
  
  // Don't remove HTML tags, just work with the HTML content
  let text = html;
  
  // Decode HTML entities that might be in signatures
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  
  // Enhanced markers for Outlook signatures, timestamps, and quoted text
  const markers = [
    // Reply/Forward indicators
    '-------- Original Message --------',
    '________________________________',
    '-----Original Message-----',
    
    // Headers
    'From:',
    'Sent:',
    'Date:',
    'To:',
    'Cc:',
    'Subject:',
    'Reply-To:',
    
    // Signatures and footers
    'Best regards,',
    'Kind regards,',
    'Sincerely,',
    'Thank you,',
    'Thanks,',
    'Decker Pex Levi Law Offices',
    'Law Office',
    'Attorney',
    'Confidentiality Notice',
    'This email is confidential',
    'Please consider the environment',
    
    // Outlook automatic additions
    'Sent from my iPhone',
    'Sent from my iPad',
    'Sent from Outlook',
    'Get Outlook for',
    
    // Signature patterns (more aggressive)
    'Paralegal',
    'WE Tower TLV',
    '150 Begin Rd.',
    'Tel Aviv',
    'www.lawoffice.org.il',
    '(+972)',
    'lawoffice.org.il',
    'Eliran Novik',
    '73-3656037',
    '8th floor',
    'Begin Rd',
    
    // Time-based patterns (regex-like matching for common timestamp formats)
  ];

  // Find the earliest marker position for quick truncation (case-insensitive)
  let earliestPos = -1;
  for (const marker of markers) {
    const pos = text.toLowerCase().indexOf(marker.toLowerCase());
    if (pos !== -1 && (earliestPos === -1 || pos < earliestPos)) {
      earliestPos = pos;
    }
  }

  let cleanedText = earliestPos !== -1 ? text.substring(0, earliestPos).trim() : text;
  
  // Remove common timestamp patterns
  const timestampPatterns = [
    /On\s+\w{3},?\s+\w{3}\s+\d{1,2},?\s+\d{4}\s+at\s+\d{1,2}:\d{2}\s*(AM|PM)/gi,
    /Am\s+\w+\.?,?\s+\d{1,2}\.\s+\w+\s+\d{4}\s+um\s+\d{1,2}:\d{2}/gi,
    
    // French patterns - "Le ven. 11 juil. 2025 à 18:24"
    /Le\s+\w{3}\.?\s+\d{1,2}\s+\w{4}\.?\s+\d{4}\s+à\s+\d{1,2}:\d{2}/gi,
    
    // Spanish patterns - "El vie, 11 jul 2025 a las 18:24"
    /El\s+\w{3},?\s+\d{1,2}\s+\w{3}\s+\d{4}\s+a\s+las\s+\d{1,2}:\d{2}/gi,
    
    // Generic date-time patterns
    /\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*(AM|PM)?/gi,
    /\d{1,2}-\d{1,2}-\d{4}\s+\d{1,2}:\d{2}/gi,
    /\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}/gi,
    
    // "wrote:" patterns in multiple languages
    /.*wrote:\s*$/gmi,
    /.*schrieb:\s*$/gmi,
    /.*écrit\s*:\s*$/gmi,
    /.*escribió:\s*$/gmi,
    
    // Email signature indicators with Unicode characters
    /‪.*?‬/g,  // Remove Unicode directional markers
    /[\u200E\u200F\u202A-\u202E]/g,  // Remove other Unicode direction markers
  ];

  // Apply timestamp pattern removal
  for (const pattern of timestampPatterns) {
    cleanedText = cleanedText.replace(pattern, '');
  }

  // Additional cleaning for specific cases (HTML-aware)
  cleanedText = cleanedText
    // Remove HTML elements that contain signature patterns
    .replace(/<[^>]*>.*?(Paralegal|WE Tower TLV|150 Begin Rd\.|Tel Aviv|www\.lawoffice\.org\.il|\(\+972\)|lawoffice\.org\.il|Eliran Novik|73-3656037|8th floor|Begin Rd).*?<\/[^>]*>/gi, '')
    // Remove lines that start with common quote indicators (including HTML)
    .replace(/<[^>]*>[\s]*[>|]+.*?<\/[^>]*>/gi, '')
    // Remove "Von:" (German) / "From:" patterns in HTML
    .replace(/<[^>]*>(Von|From|Gesendet|Sent|An|To|Betreff|Subject):\s*.*?<\/[^>]*>/gi, '')
    // Remove signature patterns more aggressively (HTML-aware)
    .replace(/<[^>]*>.*?Paralegal.*?<\/[^>]*>/gi, '')
    .replace(/<[^>]*>.*?WE Tower TLV.*?<\/[^>]*>/gi, '')
    .replace(/<[^>]*>.*?150 Begin Rd\..*?<\/[^>]*>/gi, '')
    .replace(/<[^>]*>.*?Tel Aviv.*?<\/[^>]*>/gi, '')
    .replace(/<[^>]*>.*?www\.lawoffice\.org\.il.*?<\/[^>]*>/gi, '')
    .replace(/<[^>]*>.*?\(\+972\).*?<\/[^>]*>/gi, '')
    .replace(/<[^>]*>.*?lawoffice\.org\.il.*?<\/[^>]*>/gi, '')
    .replace(/<[^>]*>.*?Eliran Novik.*?<\/[^>]*>/gi, '')
    .replace(/<[^>]*>.*?73-3656037.*?<\/[^>]*>/gi, '')
    .replace(/<[^>]*>.*?8th floor.*?<\/[^>]*>/gi, '')
    .replace(/<[^>]*>.*?Begin Rd.*?<\/[^>]*>/gi, '')
    // Remove phone number patterns in HTML
    .replace(/<[^>]*>.*?\(\+972\)\d{2}-\d{3}\d{4}.*?<\/[^>]*>/gi, '')
    .replace(/<[^>]*>.*?\(\+972\)\d{2}-\d{3}-\d{4}.*?<\/[^>]*>/gi, '')
    .replace(/<[^>]*>.*?\d{2}-\d{3}\d{4}.*?<\/[^>]*>/gi, '') // Catch 73-3656037 pattern
    // Remove signature blocks that start with names (HTML-aware)
    .replace(/<[^>]*>.*?[A-Za-z]+\s+[A-Za-z]+\s*-\s*Paralegal.*?<\/[^>]*>/gi, '')
    .replace(/<[^>]*>.*?[A-Za-z]+\s+[A-Za-z]+\s*&nbsp;.*?<\/[^>]*>/gi, '')
    // Remove Unicode directional text markers
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    // Clean up multiple spaces and newlines (but preserve HTML structure)
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();

  return cleanedText;
};

// Helper to acquire token, falling back to popup if needed
const acquireToken = async (instance: IPublicClientApplication, account: AccountInfo) => {
  try {
    return await instance.acquireTokenSilent({ ...loginRequest, account });
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      toast('Your session has expired. Please sign in again.', { icon: '🔑' });
      return await instance.acquireTokenPopup({ ...loginRequest, account });
    }
    throw error;
  }
};

// Microsoft Graph API: Fetch emails for a client and sync to DB
async function syncClientEmails(token: string, client: ClientTabProps['client']) {
  if (!client.email || !client.lead_number) return;

  // Use $search for a more robust query. It searches across common fields.
  // The search term should be enclosed in quotes for Graph API.
  const searchQuery = `"${client.lead_number}" OR "${client.email}"`;
  
  // Optimize: Only fetch recent emails (last 30 days) and limit to 30 results
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const url = `https://graph.microsoft.com/v1.0/me/messages?$search=${encodeURIComponent(searchQuery)}&$top=30&$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,conversationId,hasAttachments&$filter=receivedDateTime ge ${thirtyDaysAgo.toISOString()}`;
  
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

  // Optimize: Skip attachment fetching for now (can be added later as needed)
  // This significantly reduces API calls and processing time
  // TODO: Add lazy loading for attachments when needed

  // 4. Prepare data for Supabase (upsert to avoid duplicates)
  const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
  const emailsToUpsert = clientMessages.map((msg: any) => {
    const isOutgoing = msg.from?.emailAddress?.address.toLowerCase().includes('lawoffice.org.il');
    const originalBody = msg.body?.content || '';
    const processedBody = !isOutgoing ? stripSignatureAndQuotedTextPreserveHtml(originalBody) : originalBody;

    return {
      message_id: msg.id,
      client_id: isLegacyLead ? null : client.id, // Set to null for legacy leads
      legacy_id: isLegacyLead ? parseInt(client.id.replace('legacy_', '')) : null, // Set legacy_id for legacy leads
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
  console.log('📧 Syncing emails to database:', {
    isLegacyLead,
    clientId: client.id,
    legacyId: isLegacyLead ? parseInt(client.id.replace('legacy_', '')) : null,
    emailCount: emailsToUpsert.length
  });
  
  if (emailsToUpsert.length > 0) {
    console.log('📧 Sample email data:', emailsToUpsert[0]);
  }
  
  const { data: syncData, error: syncError } = await supabase.from('emails').upsert(emailsToUpsert, { onConflict: 'message_id' });
  
  if (syncError) {
    console.error('❌ Error syncing emails to database:', syncError);
  } else {
    console.log('✅ Emails synced to database successfully');
  }
}

// Microsoft Graph API: Send email (as a new message or reply)
async function sendClientEmail(token: string, subject: string, body: string, client: ClientTabProps['client'], senderName: string, attachments: { name: string; contentType: string; contentBytes: string }[]) {
  // Get the user's email signature from the database
  const { getCurrentUserEmailSignature } = await import('../../lib/emailSignature');
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
    contentBytes: att.contentBytes
  }));

  const draftMessage = {
    subject,
    body: { contentType: 'HTML', content: fullBody },
    toRecipients: [{ emailAddress: { address: client.email! } }],
    attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
  };

  // 1. Create a draft message to get its ID
  const createDraftUrl = `https://graph.microsoft.com/v1.0/me/messages`;
  const draftRes = await fetch(createDraftUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(draftMessage),
  });

  if (!draftRes.ok) {
    console.error("Graph API Error creating draft:", await draftRes.text());
    throw new Error('Failed to create email draft.');
  }
  const createdDraft = await draftRes.json();
  const messageId = createdDraft.id;

  if (!messageId) {
    throw new Error('Could not get message ID from draft.');
  }

  // 2. Send the draft message
  const sendUrl = `https://graph.microsoft.com/v1.0/me/messages/${messageId}/send`;
  const sendRes = await fetch(sendUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!sendRes.ok) {
    console.error("Graph API Error sending draft:", await sendRes.text());
    throw new Error('Failed to send email.');
  }

  // 3. Return the created message object so we can save it to our DB.
  return createdDraft;
}

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
// Join users.employee_id with tenants_employee.id to get display_name
async function fetchCurrentUserFullName() {
  const { data: { user } } = await supabase.auth.getUser();
  if (user && user.id) {
    const { data, error } = await supabase
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
    if (!error && data) {
      // Return display_name from tenants_employee if available, otherwise full_name
      const employee = Array.isArray(data.tenants_employee) ? data.tenants_employee[0] : data.tenants_employee;
      return employee?.display_name || data.full_name;
    }
  }
  return null;
}

// Utility to sanitize email HTML for modal view
function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'b', 'i', 'u', 'ul', 'ol', 'li', 'br', 'strong', 'em', 'a'
    ],
    allowedAttributes: {
      'a': ['href', 'target', 'rel']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard',
    allowedStyles: {},
  });
}

const InteractionsTab: React.FC<ClientTabProps> = ({ client, onClientUpdate }) => {
  if (!client) {
    return <div className="flex justify-center items-center h-32"><span className="loading loading-spinner loading-md text-primary"></span></div>;
  }
  
  // Determine if this is a legacy lead
  const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
  
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [editIndex, setEditIndex] = useState<number|null>(null);
  const [editData, setEditData] = useState({ date: '', time: '', content: '', observation: '', length: '' });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [contactDrawerOpen, setContactDrawerOpen] = useState(false);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [newContact, setNewContact] = useState({
    method: 'email',
    date: '',
    time: '',
    length: '',
    content: '',
    observation: '',
  });
  const { instance, accounts } = useMsal();
  const [emails, setEmails] = useState<any[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [emailSearchQuery, setEmailSearchQuery] = useState('');
  const [interactionsLoading, setInteractionsLoading] = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [sending, setSending] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [composeAttachments, setComposeAttachments] = useState<{ name: string; contentType: string; contentBytes: string }[]>([]);
  const [downloadingAttachments, setDownloadingAttachments] = useState<Record<string, boolean>>({});
  const [activeEmailId, setActiveEmailId] = useState<string | null>(null);
  const [activeInteraction, setActiveInteraction] = useState<Interaction | null>(null);
  const [detailsDrawerOpen, setDetailsDrawerOpen] = useState(false);
  const [isWhatsAppOpen, setIsWhatsAppOpen] = useState(false);
  const [whatsAppInput, setWhatsAppInput] = useState("");
  const [currentUserFullName, setCurrentUserFullName] = useState<string | null>(null);
  const userFullNameLoadedRef = useRef(false);
  const [bodyFocused, setBodyFocused] = useState(false);
  const [footerHeight, setFooterHeight] = useState(72);
  const [composeOverlayOpen, setComposeOverlayOpen] = useState(false);
  const quillRef = useRef<ReactQuill>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeWhatsAppId, setActiveWhatsAppId] = useState<string | null>(null);
  const [selectedMedia, setSelectedMedia] = useState<{url: string, type: 'image' | 'video', caption?: string} | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  // Debug selectedFile state changes
  useEffect(() => {
    console.log('📁 selectedFile state changed:', selectedFile);
  }, [selectedFile]);
  const [showAiSummary, setShowAiSummary] = useState(false);
  const location = useLocation();
  const lastEmailRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  // 1. Add state for WhatsApp messages from DB
  const [whatsAppMessages, setWhatsAppMessages] = useState<any[]>([]);
  
  // Emoji picker state
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  
  // Audio playback state for call recordings
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioRef, setAudioRef] = useState<HTMLAudioElement | null>(null);

  // Audio playback functions
  const handlePlayRecording = async (recordingUrl: string, callId: string) => {
    let hasShownError = false; // Flag to prevent duplicate toast notifications
    
    try {
      
      // Stop current audio if playing
      if (audioRef && !audioRef.paused) {
        audioRef.pause();
        audioRef.currentTime = 0;
      }

      // Validate and clean the recording URL
      let cleanUrl = recordingUrl;
      
      // Check if URL is absolute (handle both encoded and unencoded URLs)
      let decodedUrl = recordingUrl;
      try {
        // Try to decode the URL first
        decodedUrl = decodeURIComponent(recordingUrl);
      } catch (error) {
        // If decoding fails, use the original URL
        decodedUrl = recordingUrl;
      }
      const isAbsolute = decodedUrl.startsWith('http://') || decodedUrl.startsWith('https://');
      
      if (!isAbsolute) {
        console.error('Invalid recording URL:', recordingUrl);
        toast.error('Invalid recording URL');
        return;
      }

      // For 1com URLs, extract call ID and use our proxy endpoint
      if (decodedUrl.includes('pbx6webserver.1com.co.il')) {
        try {
          // Extract call ID from the URL
          const urlParams = new URL(decodedUrl).searchParams;
          const callId = urlParams.get('id');
          const tenant = urlParams.get('tenant');
          
          if (!callId) {
            console.error('Could not extract call ID from URL:', decodedUrl);
            toast.error('Invalid recording URL format');
            return;
          }
          
          // Use our backend proxy to avoid CORS issues
          const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
          cleanUrl = `${backendUrl}/api/call-recording/${callId}${tenant ? `?tenant=${tenant}` : ''}`;
        } catch (error) {
          console.error('Error parsing 1com URL:', error);
          toast.error('Failed to parse recording URL');
          return;
        }
      }

      // First, check if this is a 2024 recording that might not be available
      const isOldRecording = callId.startsWith('pbx24-') || decodedUrl.includes('pbx24-');
      if (isOldRecording) {
        // Make a GET request to check if the recording is available
        try {
          const checkResponse = await fetch(cleanUrl);
          if (!checkResponse.ok) {
            const errorData = await checkResponse.json().catch(() => null);
            if (errorData?.isOldRecording) {
              if (!hasShownError) {
                hasShownError = true;
                toast.error('This recording is from 2024 and may no longer be accessible. 1com typically archives older recordings.');
              }
              return;
            }
          } else {
            // Check if the response is actually audio
            const contentType = checkResponse.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
              // The backend returned JSON instead of audio, likely an error
              const errorData = await checkResponse.json().catch(() => null);
              if (errorData?.isOldRecording) {
                if (!hasShownError) {
                  hasShownError = true;
                  toast.error('This recording is from 2024 and may no longer be accessible. 1com typically archives older recordings.');
                }
                return;
              }
            }
          }
        } catch (checkError) {
          // Continue with normal playback attempt
        }
      }

      // Create new audio element
      const audio = new Audio(cleanUrl);
      setAudioRef(audio);
      setPlayingAudioId(callId);

      audio.onended = () => {
        setPlayingAudioId(null);
        setAudioRef(null);
      };

      audio.onerror = (error) => {
        console.error('Audio playback error:', error);
        console.error('Failed URL:', cleanUrl);
        if (!hasShownError) {
          hasShownError = true;
          // Check if this is a 2024 recording for a more specific error message
          if (isOldRecording) {
            toast.error('This recording is from 2024 and may no longer be accessible. 1com typically archives older recordings.');
          } else {
            toast.error('Recording is not available');
          }
        }
        setPlayingAudioId(null);
        setAudioRef(null);
      };


      await audio.play();
    } catch (error) {
      console.error('Error playing recording:', error);
      if (!hasShownError) {
        hasShownError = true;
        toast.error('Recording is not available');
      }
      setPlayingAudioId(null);
      setAudioRef(null);
    }
  };

  const handleStopRecording = () => {
    if (audioRef && !audioRef.paused) {
      audioRef.pause();
      audioRef.currentTime = 0;
    }
    setPlayingAudioId(null);
    setAudioRef(null);
  };
  // Add state for WhatsApp error messages
  const [whatsAppError, setWhatsAppError] = useState<string | null>(null);
  
  // Debug: Log when whatsAppError changes
  useEffect(() => {
    console.log('🔍 WhatsApp error state changed:', whatsAppError);
  }, [whatsAppError]);

  // Find the index of the last email in the sorted interactions - memoized to prevent recalculation
  const sortedInteractions = useMemo(() => 
    [...interactions].sort((a, b) => new Date(b.raw_date).getTime() - new Date(a.raw_date).getTime()),
    [interactions]
  );
  const lastEmailIdx = useMemo(() => 
    sortedInteractions.map(row => row.kind).lastIndexOf('email'),
    [sortedInteractions]
  );

  // --- Add: handler for clicking an interaction to jump to message in modal ---
  const handleInteractionClick = (row: Interaction, idx: number) => {
    if (row.kind === 'email') {
      setIsEmailModalOpen(true);
      setActiveEmailId(row.id.toString());
      setTimeout(() => {
        const el = document.querySelector(`[data-email-id="${row.id}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-2', 'ring-primary');
          setTimeout(() => el.classList.remove('ring-2', 'ring-primary'), 1200);
        }
      }, 300);
    } else if (row.kind === 'whatsapp') {
      setIsWhatsAppOpen(true);
      setActiveWhatsAppId(row.id.toString());
    } else {
      openEditDrawer(idx);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('focus') === 'email' && lastEmailIdx !== -1) {
      // Open the email modal for the last email
      setIsEmailModalOpen(true);
      setActiveEmailId(sortedInteractions[lastEmailIdx].id.toString());
      // Scroll to the last email
      setTimeout(() => {
        lastEmailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [location.search, lastEmailIdx, sortedInteractions]); // Now safe to include these memoized values

  // Handle email modal opening from localStorage flag
  useEffect(() => {
    if (localStorage.getItem('openEmailModal') === 'true') {
      // Wait for interactions to be loaded and emails to be available
      if (interactions.length > 0 && emails.length > 0) {
        if (lastEmailIdx !== -1) {
          setIsEmailModalOpen(true);
          setActiveEmailId(sortedInteractions[lastEmailIdx].id.toString());
          setTimeout(() => {
            lastEmailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
        }
        localStorage.removeItem('openEmailModal');
      } else {
        // If emails aren't loaded yet, wait a bit and try again
        const timeoutId = setTimeout(() => {
          if (localStorage.getItem('openEmailModal') === 'true') {
            if (interactions.length > 0 && emails.length > 0 && lastEmailIdx !== -1) {
              setIsEmailModalOpen(true);
              setActiveEmailId(sortedInteractions[lastEmailIdx].id.toString());
              setTimeout(() => {
                lastEmailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 100);
            }
            localStorage.removeItem('openEmailModal');
          }
        }, 2000); // Wait 2 seconds for emails to load
        
        return () => clearTimeout(timeoutId);
      }
    }
  }, [client.id, interactions.length, emails.length, lastEmailIdx, sortedInteractions]); // Include necessary dependencies

  // Handle WhatsApp modal opening from localStorage flag
  useEffect(() => {
    if (localStorage.getItem('openWhatsAppModal') === 'true') {
      // Wait for interactions to be loaded
      if (interactions.length > 0) {
        setIsWhatsAppOpen(true);
        localStorage.removeItem('openWhatsAppModal');
      } else {
        // If interactions aren't loaded yet, wait a bit and try again
        const timeoutId = setTimeout(() => {
          if (localStorage.getItem('openWhatsAppModal') === 'true') {
            if (interactions.length > 0) {
              setIsWhatsAppOpen(true);
            }
            localStorage.removeItem('openWhatsAppModal');
          }
        }, 2000); // Wait 2 seconds for interactions to load
        
        return () => clearTimeout(timeoutId);
      }
    }
  }, [client.id, interactions.length]); // Include interactions.length since we need to check it



  // Close WhatsApp modal when client changes
  useEffect(() => {
    setIsWhatsAppOpen(false);
    // Clear any stale flags when client changes
    localStorage.removeItem('openWhatsAppModal');
    localStorage.removeItem('whatsAppFromCalendar');
  }, [client.id]);

  // Handle click outside to close emoji picker
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isEmojiPickerOpen) {
        const target = event.target as HTMLElement;
        if (!target.closest('.emoji-picker-container') && !target.closest('button[type="button"]')) {
          setIsEmojiPickerOpen(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isEmojiPickerOpen]);

  // Handle WhatsApp modal close and navigation back to Calendar
  const handleWhatsAppClose = () => {
    setIsWhatsAppOpen(false);
    setWhatsAppInput('');
    setSelectedFile(null);
    setSelectedMedia(null);
    setActiveWhatsAppId(null);
    setWhatsAppError(null); // Clear any error messages when closing
    
    // Check if WhatsApp was opened from Calendar
    if (localStorage.getItem('whatsAppFromCalendar') === 'true') {
      localStorage.removeItem('whatsAppFromCalendar');
      navigate('/calendar');
    }
  };

  // 2. Fetch WhatsApp messages from DB when WhatsApp modal opens or client changes
  useEffect(() => {
    async function fetchWhatsAppMessages() {
      if (!client?.id) return;
      
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      let query = supabase.from('whatsapp_messages').select('*');
      
      if (isLegacyLead) {
        const legacyId = parseInt(client.id.replace('legacy_', ''));
        query = query.eq('legacy_id', legacyId);
      } else {
        query = query.eq('lead_id', client.id);
      }
      
      const { data, error } = await query.order('sent_at', { ascending: true });
      if (!error && data) {
        setWhatsAppMessages(data);
      } else {
        setWhatsAppMessages([]);
      }
    }
    if (isWhatsAppOpen) {
      fetchWhatsAppMessages();
    }
  }, [isWhatsAppOpen, client.id]);

  // 3. Periodically check status of pending messages
  useEffect(() => {
    if (!isWhatsAppOpen || !client?.id) return;

    const interval = setInterval(async () => {
      // Check if there are any pending messages
      const hasPendingMessages = whatsAppMessages.some(msg => msg.whatsapp_status === 'pending');
      
      if (hasPendingMessages) {
        // Refetch messages to get updated statuses
        const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
        let query = supabase.from('whatsapp_messages').select('*');
        
        if (isLegacyLead) {
          const legacyId = parseInt(client.id.replace('legacy_', ''));
          query = query.eq('legacy_id', legacyId);
        } else {
          query = query.eq('lead_id', client.id);
        }
        
        const { data, error } = await query.order('sent_at', { ascending: true });
        if (!error && data) {
          setWhatsAppMessages(data);
        }
      }
    }, 5000); // Check every 5 seconds

    return () => clearInterval(interval);
  }, [isWhatsAppOpen, client.id, whatsAppMessages]);

  // 3. On send, save to DB and refetch messages
  const handleSendWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!whatsAppInput.trim()) return;

    // Clear any previous errors
    setWhatsAppError(null);

    // Check if client has phone number
    console.log('🔍 Checking phone numbers:', { phone: client.phone, mobile: client.mobile });
    if (!client.phone && !client.mobile) {
      console.log('❌ No phone number found, setting error');
      setWhatsAppError('❌ No phone number available for this client. Please add a phone number first.');
      // Add a small delay to ensure the error is displayed
      setTimeout(() => {
        console.log('🔍 Error should be visible now');
      }, 100);
      return;
    }

    // Validate phone number format
    const phoneNumber = client.phone || client.mobile;
    console.log('🔍 Phone number to use:', phoneNumber);
    if (!phoneNumber || phoneNumber.trim() === '') {
      console.log('❌ Phone number is empty, setting error');
      setWhatsAppError('❌ No phone number available for this client. Please add a phone number first.');
      return;
    }
    
    const now = new Date();
    let senderName = 'You';
    let whatsappStatus = 'sent';
    let errorMessage = null;
    
    try {
      // Get current user's full name from users table with employee join
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id) {
        const { data: userRow, error: userLookupError } = await supabase
          .from('users')
          .select(`
            full_name,
            email,
            employee_id,
            tenants_employee!employee_id(
              display_name
            )
          `)
          .eq('auth_id', user.id)
          .single();
        if (!userLookupError && userRow) {
          // Use display_name from tenants_employee if available, otherwise full_name
          const employee = Array.isArray(userRow.tenants_employee) ? userRow.tenants_employee[0] : userRow.tenants_employee;
          senderName = employee?.display_name || userRow.full_name || userRow.email || 'You';
        }
      }
      
      // Try to send via WhatsApp API first
      const response = await fetch(buildApiUrl('/api/whatsapp/send-message'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          leadId: client.id,
          message: whatsAppInput.trim(),
          phoneNumber: client.phone || client.mobile,
          sender_name: senderName
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        let errorMessage = '';
        if (result.code === 'RE_ENGAGEMENT_REQUIRED') {
          errorMessage = '⚠️ WhatsApp 24-Hour Rule: You can only send template messages after 24 hours of customer inactivity. The customer needs to reply first to reset the timer.';
        } else if (result.error?.includes('phone') || result.error?.includes('invalid') || result.error?.includes('format')) {
          errorMessage = '❌ Invalid phone number format. Please check the client\'s phone number.';
        } else if (result.error?.includes('not found') || result.error?.includes('404')) {
          errorMessage = '❌ Phone number not found or not registered on WhatsApp.';
        } else {
          errorMessage = `❌ WhatsApp API Error: ${result.error || 'Unknown error'}`;
        }
        
        setWhatsAppError(errorMessage);
        return; // Don't save to database if API call failed
      }
      
      // Message sent successfully via WhatsApp API - backend will save to database
      console.log('✅ WhatsApp message sent successfully, backend will save to database');
      
      setWhatsAppInput('');
      
      // Refetch messages - handle both new and legacy leads
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      let query = supabase.from('whatsapp_messages').select('*');
      if (isLegacyLead) {
        const legacyId = parseInt(client.id.replace('legacy_', ''));
        query = query.eq('legacy_id', legacyId);
      } else {
        query = query.eq('lead_id', client.id);
      }
      
      const { data, error } = await query.order('sent_at', { ascending: true });
      if (!error && data) {
        setWhatsAppMessages(data);
      }
      
      // Optionally, update interactions timeline
      if (onClientUpdate) await onClientUpdate();
      
      // Clear any previous errors and show success
      setWhatsAppError(null);
      
    } catch (err) {
      console.error('Unexpected error sending WhatsApp message:', err);
      setWhatsAppError('Unexpected error sending WhatsApp message: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  // Helper function to render WhatsApp-style message status
  const renderMessageStatus = (status?: string, errorMessage?: string) => {
    if (!status) return null;
    
    const baseClasses = "w-7 h-7";
    
    switch (status) {
      case 'sent':
        return (
          <svg className={baseClasses} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'pending':
        return (
          <svg className={`${baseClasses} text-gray-400 animate-pulse`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
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
      case 'failed':
        return (
          <div className="relative group">
            <svg className={`${baseClasses} text-red-500`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {errorMessage && (
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-red-600 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50 max-w-xs">
                {errorMessage}
                <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-red-600"></div>
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  // Handle file selection for WhatsApp
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    console.log('📁 File selected:', file);
    if (file) {
      console.log('📁 File details:', {
        name: file.name,
        size: file.size,
        type: file.type
      });
      setSelectedFile(file);
    }
  };

  // Handle emoji selection
  const handleEmojiClick = (emojiObject: any) => {
    const emoji = emojiObject.emoji;
    setWhatsAppInput(prev => prev + emoji);
    setIsEmojiPickerOpen(false);
  };

  // Helper function to detect if message contains only emojis
  const isEmojiOnly = (text: string): boolean => {
    // Simple approach: check if the text length is very short and contains emoji-like characters
    const cleanText = text.trim();
    if (cleanText.length === 0) return false;
    
    // Check if the message is very short (likely emoji-only) and contains non-ASCII characters
    const hasNonAscii = /[^\x00-\x7F]/.test(cleanText);
    const isShort = cleanText.length <= 5; // Most emojis are 1-3 characters
    
    return hasNonAscii && isShort;
  };

  // Send media message via WhatsApp
  const handleSendMedia = async () => {
    if (!selectedFile || !client) {
      console.log('❌ Cannot send media - missing file or client:', { selectedFile, client });
      return;
    }

    console.log('📤 Starting to send media:', {
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
      fileType: selectedFile.type,
      clientId: client.id,
      clientName: client.name
    });

    // Clear any previous errors
    setWhatsAppError(null);

    // Check if client has phone number
    console.log('🔍 Media: Checking phone numbers:', { phone: client.phone, mobile: client.mobile });
    if (!client.phone && !client.mobile) {
      console.log('❌ Media: No phone number found, setting error');
      setWhatsAppError('❌ No phone number available for this client. Please add a phone number first.');
      // Add a small delay to ensure the error is displayed
      setTimeout(() => {
        console.log('🔍 Media: Error should be visible now');
      }, 100);
      return;
    }

    setUploadingMedia(true);
    let whatsappStatus = 'sent';
    let errorMessage = null;
    
    try {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('leadId', client.id);

      // Upload media to WhatsApp
      const uploadResponse = await fetch(buildApiUrl('/api/whatsapp/upload-media'), {
        method: 'POST',
        body: formData,
      });

      const uploadResult = await uploadResponse.json();

      if (!uploadResponse.ok) {
        errorMessage = uploadResult.error || 'Failed to upload media';
        whatsappStatus = 'failed';
        throw new Error(errorMessage);
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
          leadId: client.id,
          mediaUrl: uploadResult.mediaId,
          mediaType: mediaType,
          caption: whatsAppInput.trim() || undefined,
          phoneNumber: client.phone || client.mobile,
          sender_name: senderName
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        if (result.code === 'RE_ENGAGEMENT_REQUIRED') {
          errorMessage = '⚠️ WhatsApp 24-Hour Rule: You can only send template messages after 24 hours of customer inactivity.';
          whatsappStatus = 'failed';
        } else if (result.error?.includes('phone') || result.error?.includes('invalid') || result.error?.includes('format')) {
          errorMessage = '❌ Invalid phone number format. Please check the client\'s phone number.';
          whatsappStatus = 'failed';
        } else if (result.error?.includes('not found') || result.error?.includes('404')) {
          errorMessage = '❌ Phone number not found or not registered on WhatsApp.';
          whatsappStatus = 'failed';
        } else {
          errorMessage = result.error || 'Failed to send media';
          whatsappStatus = 'failed';
        }
        throw new Error(errorMessage);
      }

      // Media sent successfully - clear any previous errors
      setWhatsAppError(null);
      
    } catch (apiError) {
      // API call failed - don't save to database
      console.error('WhatsApp Media API Error:', apiError);
      const errorMessage = apiError instanceof Error ? apiError.message : 'Unknown API error';
      setWhatsAppError('Failed to send media: ' + errorMessage);
      setUploadingMedia(false);
      return; // Don't save to database if API call failed
    }

    // Media sent successfully - backend will save to database
    console.log('✅ WhatsApp media sent successfully, backend will save to database');
    
    setWhatsAppInput('');
    setSelectedFile(null);
    setUploadingMedia(false);
    
    // Refetch messages to update the display
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
    let query = supabase.from('whatsapp_messages').select('*');
    if (isLegacyLead) {
      const legacyId = parseInt(client.id.replace('legacy_', ''));
      query = query.eq('legacy_id', legacyId);
    } else {
      query = query.eq('lead_id', client.id);
    }
    
    const { data, error } = await query.order('sent_at', { ascending: true });
    if (!error && data) {
      setWhatsAppMessages(data);
    }
    
    // Optionally, update interactions timeline
    if (onClientUpdate) await onClientUpdate();
  };

  // 4. Use whatsAppMessages for chat display
  // Replace whatsAppChatMessages with whatsAppMessages in the modal rendering
  // 5. In the timeline, merge WhatsApp messages from DB with other interactions
  // In fetchAndCombineInteractions, fetch WhatsApp messages from DB and merge with manual_interactions and emails
  useEffect(() => {
    let isMounted = true;
    async function fetchAndCombineInteractions() {
      const startTime = performance.now();
      console.log('🚀 Starting InteractionsTab fetch...');
      setInteractionsLoading(true);
      try {
        // Ensure currentUserFullName is set before mapping emails
        let userFullName = currentUserFullName;
        if (!userFullName && !userFullNameLoadedRef.current) {
          const { data: { user } } = await supabase.auth.getUser();
          if (user && user.id) {
            const { data, error } = await supabase
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
            if (!error && data) {
              // Use display_name from tenants_employee if available, otherwise full_name
              const employee = Array.isArray(data.tenants_employee) ? data.tenants_employee[0] : data.tenants_employee;
              userFullName = employee?.display_name || data.full_name;
              if (isMounted) {
                setCurrentUserFullName(userFullName);
                userFullNameLoadedRef.current = true;
              }
            }
          }
        }

        // Prepare parallel queries for better performance
        const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
        const legacyId = isLegacyLead ? parseInt(client.id.replace('legacy_', '')) : null;

        // Execute all database queries in parallel with aggressive limits
        const [whatsAppResult, callLogsResult, legacyResult] = await Promise.all([
          // WhatsApp messages query - only fetch essential fields
          client?.id ? (async () => {
            let query = supabase
              .from('whatsapp_messages')
              .select('id, sent_at, sender_name, direction, message, whatsapp_status, error_message')
              .limit(20); // Reduced from 100 to 20
            
            if (isLegacyLead) {
              query = query.eq('legacy_id', legacyId);
            } else {
              query = query.eq('lead_id', client.id);
            }
            
            const { data, error } = await query.order('sent_at', { ascending: false });
            return { data, error };
          })() : Promise.resolve({ data: [], error: null }),

          // Call logs query - only fetch essential fields
          client?.id ? (async () => {
            try {
              let query = supabase
                .from('call_logs')
                .select(`
                  id,
                  cdate,
                  time,
                  source,
                  destination,
                  status,
                  duration,
                  url,
                  direction,
                  tenants_employee!employee_id (
                    display_name
                  )
                `)
                .limit(10); // Reduced from 50 to 10
              
              if (isLegacyLead) {
                query = query.eq('lead_id', legacyId);
              } else {
                // Skip client_id query if column doesn't exist
                query = query.eq('lead_id', client.id);
              }
              
              const { data, error } = await query.order('cdate', { ascending: false });
              return { data, error };
            } catch (error) {
              return { data: [], error };
            }
          })() : Promise.resolve({ data: [], error: null }),

          // Legacy interactions query - only for legacy leads, with limit
          isLegacyLead && client?.id ? (async () => {
            try {
              const interactions = await fetchLegacyInteractions(client.id, client.name);
              return interactions.slice(0, 10); // Limit to 10 most recent
            } catch (error) {
              return [];
            }
          })() : Promise.resolve([])
        ]);

        // Process results from parallel queries
        const [whatsAppDbMessages, callLogInteractions, legacyInteractions] = [
          // Process WhatsApp messages
          whatsAppResult.data?.map((msg: any) => ({
            id: msg.id,
            date: new Date(msg.sent_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }),
            time: new Date(msg.sent_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            raw_date: msg.sent_at,
            employee: msg.sender_name || 'You',
            direction: msg.direction,
            kind: 'whatsapp',
            length: '',
            content: msg.message,
            observation: msg.error_message || '',
            editable: false,
            status: msg.whatsapp_status,
            error_message: msg.error_message,
          })) || [],

          // Process call logs
          callLogsResult.data?.map((callLog: any) => {
            const callDate = new Date(callLog.cdate);
            const callTime = callLog.time || '00:00';
            const direction = callLog.direction?.toLowerCase().includes('incoming') ? 'in' : 'out';
            
            // Get employee name from JOIN or fallback
            let employeeName = client.name;
            if (direction === 'out' && callLog.tenants_employee) {
              const employee = Array.isArray(callLog.tenants_employee) ? callLog.tenants_employee[0] : callLog.tenants_employee;
              employeeName = employee?.display_name || userFullName || 'You';
            } else if (direction === 'out') {
              employeeName = userFullName || 'You';
            }
            
            const duration = callLog.duration ? `${Math.floor(callLog.duration / 60)}:${(callLog.duration % 60).toString().padStart(2, '0')}` : '0:00';
            
            let content = '';
            if (callLog.source && callLog.destination) {
              content = `From: ${callLog.source}, To: ${callLog.destination}`;
            } else if (callLog.source) {
              content = `From: ${callLog.source}`;
            } else if (callLog.destination) {
              content = `To: ${callLog.destination}`;
            } else {
              content = 'Call logged';
            }
            
            return {
              id: `call_${callLog.id}`,
              date: callDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }),
              time: callTime,
              raw_date: callLog.cdate,
              employee: employeeName,
              direction: direction,
              kind: 'call',
              length: duration,
              content: content,
              observation: '',
              editable: false,
              status: callLog.status,
              call_log: callLog,
              recording_url: callLog.url,
              call_duration: callLog.duration,
              employee_data: callLog.tenants_employee
            };
          }) || [],

          // Process legacy interactions (filter out calls)
          Array.isArray(legacyResult) ? legacyResult.filter((interaction: any) => interaction.kind !== 'call') : []
        ];

        // 1. Manual interactions (excluding WhatsApp) - fast client-side processing
        const manualInteractions = (client.manual_interactions || []).filter((i: any) => i.kind !== 'whatsapp').map((i: any) => ({
          ...i,
          employee: i.direction === 'out' ? (userFullName || 'You') : i.employee || client.name,
        }));

        // 2. Email interactions - use client emails from props for now (will be updated by separate email fetch)
        const clientEmails = (client as any).emails || [];
        
        // Skip complex deduplication for small datasets
        const uniqueEmails = clientEmails.length > 20 
          ? clientEmails.filter((email: any, index: number, self: any[]) => {
              const emailKey = email.message_id || email.id;
              return index === self.findIndex((e: any) => (e.message_id || e.id) === emailKey);
            })
          : clientEmails; // Skip deduplication for small datasets
        
        const emailInteractions = uniqueEmails.slice(0, 10).map((e: any) => { // Reduced from 50 to 10
          const emailDate = new Date(e.sent_at);
          
          // Use body_html instead of body_preview for better content
          let body = e.subject || 'Email received';
          if (e.body_html && e.body_html.length > 0) {
            body = e.body_html;
          } else if (e.body_preview && e.body_preview.length > 0 && e.body_preview.length < 200) {
            body = e.body_preview;
          }
          
          return {
            id: e.message_id,
            date: emailDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }),
            time: emailDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            raw_date: e.sent_at,
            employee: e.direction === 'outgoing' ? (userFullName || 'You') : client.name,
            direction: e.direction === 'outgoing' ? 'out' : 'in',
            kind: 'email',
            length: '',
            content: body,
            subject: e.subject || '',
            observation: e.observation || '',
            editable: true,
            status: e.status,
          };
        });
      
        // Combine all interactions
        const combined = [...manualInteractions, ...emailInteractions, ...whatsAppDbMessages, ...callLogInteractions, ...legacyInteractions];
        
        // Simple deduplication by ID (no need for complex call log deduplication anymore)
        const uniqueInteractions = combined.filter((interaction: any, index: number, self: any[]) => 
          index === self.findIndex((i: any) => i.id === interaction.id)
        );
        
        // Removed debug logging for performance
        
        const sorted = uniqueInteractions.sort((a, b) => new Date(b.raw_date).getTime() - new Date(a.raw_date).getTime());
        if (isMounted) {
          setInteractions(sorted as Interaction[]);
          
          // Performance logging
          const endTime = performance.now();
          const duration = Math.round(endTime - startTime);
          console.log(`✅ InteractionsTab loaded in ${duration}ms with ${sorted.length} interactions`);
        }
        
        // Also update the local emails state for the modal - use the same deduplicated emails
        const formattedEmailsForModal = uniqueEmails.slice(0, 10).map((e: any) => ({ // Limit emails for modal too
          id: e.message_id,
          subject: e.subject,
          from: e.sender_email,
          to: e.recipient_list,
          date: e.sent_at,
          bodyPreview: e.body_html || e.body_preview || e.subject, // Use body_html first, then body_preview
          direction: e.direction,
          attachments: e.attachments,
        }));
        if (isMounted) setEmails(formattedEmailsForModal);
      } catch (error) {
        console.error('Error in fetchAndCombineInteractions:', error);
        if (isMounted) {
          setInteractions([]);
          setEmails([]);
        }
      } finally {
        if (isMounted) setInteractionsLoading(false);
      }
    }
    fetchAndCombineInteractions();
    return () => { isMounted = false; };
  }, [client.id]); // Only run when client changes


  // Function to fetch emails from database for the modal
  const fetchEmailsForModal = useCallback(async () => {
    if (!client.id) return;
    
    setEmailsLoading(true);
    try {
      // Fetch emails from database for this specific client
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      let emailQuery;
      
      if (isLegacyLead) {
        const legacyId = parseInt(client.id.replace('legacy_', ''));
        emailQuery = supabase
          .from('emails')
          .select('id, message_id, sender_name, sender_email, recipient_list, subject, body_html, sent_at, direction, attachments')
          .eq('legacy_id', legacyId)
          .order('sent_at', { ascending: true });
      } else {
        emailQuery = supabase
          .from('emails')
          .select('id, message_id, sender_name, sender_email, recipient_list, subject, body_html, sent_at, direction, attachments')
          .eq('client_id', client.id)
          .order('sent_at', { ascending: true });
      }
      
      const { data: emailData, error: emailError } = await emailQuery;
      
      if (emailError) {
        console.error('❌ Error fetching emails for InteractionsTab:', emailError);
      } else {
        const clientEmails = emailData || [];
        console.log(`📧 InteractionsTab fetched ${clientEmails.length} emails for client ${client.id}`);
        
        // Format emails for modal display
        const formattedEmailsForModal = clientEmails.map((e: any) => ({
          id: e.message_id,
          subject: e.subject,
          from: e.sender_email,
          to: e.recipient_list,
          date: e.sent_at,
          bodyPreview: e.body_html || e.body_preview || e.subject,
          direction: e.direction,
          attachments: e.attachments,
        }));
        
        setEmails(formattedEmailsForModal);
      }
    } catch (error) {
      console.error('❌ Error in fetchEmailsForModal:', error);
      setEmails([]);
    } finally {
      setEmailsLoading(false);
    }
  }, [client]);

  // This function now ONLY syncs with Graph and then triggers a full refresh
  const runGraphSync = useCallback(async () => {
    if (!client.email || !instance || !accounts[0]) return;
    
    setEmailsLoading(true);

    try {
      const tokenResponse = await acquireToken(instance, accounts[0]);
      await syncClientEmails(tokenResponse.accessToken, client);
      console.log('📧 Graph sync completed, triggering client update...');
      if (onClientUpdate) {
        await onClientUpdate(); // Refresh all client data from parent
        console.log('📧 Client update completed');
      }
      // Also refresh the emails in the modal
      await fetchEmailsForModal();
    } catch (e) {
      console.error("Graph sync failed:", e);
      toast.error("Failed to sync new emails from server.");
    } finally {
      setEmailsLoading(false);
    }
  }, [client, instance, accounts, onClientUpdate]);

  // Effect to run the slow sync only once when the component mounts
  // DISABLED: Graph sync is too slow and blocks UI loading
  // Run Graph sync only on explicit user action (like clicking refresh)
  useEffect(() => {
    // Skip automatic Graph sync for now - it's causing the 4-second delay
    // Users can manually sync emails if needed
    console.log('InteractionsTab mounted - skipping automatic Graph sync for performance');
  }, [client.id]);

  const handleSendEmail = async () => {
    if (!client.email || !instance || !accounts[0]) return;
    setSending(true);
    const account = accounts[0];

    try {
      const tokenResponse = await acquireToken(instance, account);
      const senderName = account?.name || 'Your Team';

      // 1. Add signature to email content
      const emailContentWithSignature = await appendEmailSignature(composeBody);

      // 2. Send email via Graph API.
      const sentEmail = await sendClientEmail(
        tokenResponse.accessToken, 
        composeSubject, 
        emailContentWithSignature, 
        client, 
        senderName,
        composeAttachments
      );
      
      console.log('📧 Email sent via Graph API:', sentEmail.id);
      
      // 3. Immediately save the sent email to our database
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      const emailToSave = {
        message_id: sentEmail.id,
        client_id: isLegacyLead ? null : client.id,
        legacy_id: isLegacyLead ? parseInt(client.id.replace('legacy_', '')) : null,
        thread_id: sentEmail.conversationId,
        sender_name: senderName,
        sender_email: account?.username || 'unknown@lawoffice.org.il',
        recipient_list: client.email,
        subject: composeSubject,
        body_html: emailContentWithSignature, // Use body_html with signature
        sent_at: new Date().toISOString(),
        direction: 'outgoing',
        attachments: composeAttachments.length > 0 ? composeAttachments.map(att => ({
          id: `temp_${Date.now()}`,
          name: att.name,
          contentType: att.contentType,
          sizeInBytes: 0,
          isInline: false
        })) : null,
      };
      
      const { error: saveError } = await supabase.from('emails').upsert(emailToSave, { onConflict: 'message_id' });
      if (saveError) {
        console.error('❌ Error saving sent email to database:', saveError);
      } else {
        console.log('✅ Sent email saved to database');
      }
      
      toast.success('Email sent and saved!');

      // 4. Trigger a sync to get any other new emails from Graph
      setTimeout(async () => {
        await runGraphSync();
      }, 1000); // Reduced wait time since we already saved the email
      
      // 5. Force refresh the client data to get updated emails
      if (onClientUpdate) {
        console.log('🔄 Triggering client data refresh after email send');
        await onClientUpdate();
      }

      // Clear the body input after sending
      setComposeBody('');
      setComposeAttachments([]);
    } catch (e) {
      console.error("Error in handleSendEmail:", e);
      toast.error(e instanceof Error ? e.message : "Failed to send email.");
    }
    setSending(false);
  };

  const handleDownloadAttachment = async (messageId: string, attachment: Attachment) => {
    if (downloadingAttachments[attachment.id]) return; // Don't download if already in progress

    setDownloadingAttachments(prev => ({ ...prev, [attachment.id]: true }));
    toast.loading(`Downloading ${attachment.name}...`, { id: attachment.id });

    try {
      const tokenResponse = await acquireToken(instance, accounts[0]);
      const url = `https://graph.microsoft.com/v1.0/me/messages/${messageId}/attachments/${attachment.id}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${tokenResponse.accessToken}` } });

      if (!res.ok) throw new Error('Failed to fetch attachment content.');
      
      const attachmentData = await res.json();
      const base64 = attachmentData.contentBytes;

      // Decode base64 and trigger download
      const byteCharacters = atob(base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: attachmentData.contentType });

      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = attachment.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      toast.success(`${attachment.name} downloaded.`, { id: attachment.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed.', { id: attachment.id });
    } finally {
      setDownloadingAttachments(prev => ({ ...prev, [attachment.id]: false }));
    }
  };

  const handleAttachmentUpload = async (files: FileList) => {
    if (!files || files.length === 0) return;
    
    for (const file of Array.from(files)) {
      if (file.size > 4 * 1024 * 1024) { // 4MB limit
        toast.error(`${file.name} is too large. Please choose files under 4MB.`);
        continue;
      }
      
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const base64Content = content.split(',')[1];
          if (!base64Content) throw new Error('Could not read file content.');

          setComposeAttachments(prev => [...prev, {
            name: file.name,
            contentType: file.type,
            contentBytes: base64Content
          }]);
          toast.success(`${file.name} attached.`);
        } catch (err) {
          toast.error(`Error processing ${file.name}.`);
        }
      };
      reader.onerror = () => {
        toast.error(`Failed to read ${file.name}.`);
      };
      reader.readAsDataURL(file);
    }
  };

  // Set the subject when the email modal opens (if not already set by user)
  useEffect(() => {
    if (isEmailModalOpen) {
      const defaultSubject = `[${client.lead_number}] - ${client.name} - ${client.topic || ''}`;
      setComposeSubject(prev => prev && prev.trim() ? prev : defaultSubject);
      
      // Fetch emails when modal opens (like EmailThreadModal)
      console.log('📧 Email modal opened, fetching emails...');
      fetchEmailsForModal();
    }
  }, [isEmailModalOpen, client, fetchEmailsForModal]);

  // Update openEditDrawer to return a Promise and always fetch latest data for manual interactions
  const openEditDrawer = async (idx: number) => {
    const row = interactions[idx];
    let latestRow = row;
    if (row.id && row.id.toString().startsWith('manual_')) {
      const { data, error } = await supabase
        .from('leads')
        .select('manual_interactions')
        .eq('id', client.id)
        .single();
      if (!error && data?.manual_interactions) {
        const found = data.manual_interactions.find((i: any) => i.id === row.id || i.id === Number(row.id));
        if (found) {
          latestRow = { ...row, ...found };
        }
      }
    }
    setActiveInteraction(latestRow);
    setEditData({
      date: latestRow.date || '',
      time: latestRow.time || '',
      content: latestRow.content || '',
      observation: latestRow.observation || '',
      length: latestRow.length ? String(latestRow.length).replace(/m$/, '') : '',
    });
    setDetailsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDetailsDrawerOpen(false);
    setActiveInteraction(null);
  };

  const handleEditChange = (field: string, value: string) => {
    setEditData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!activeInteraction) return;
    
    const isManual = activeInteraction.id.toString().startsWith('manual_');

    // --- Optimistic Update ---
    const previousInteractions = [...interactions];
    const updatedInteractions = interactions.map((interaction) => {
      if (interaction.id === activeInteraction.id) {
        return {
          ...interaction,
          date: editData.date,
          time: editData.time,
          content: editData.content,
          observation: editData.observation,
          length: editData.length ? `${editData.length}m` : '',
        };
      }
      return interaction;
    });
    setInteractions(updatedInteractions);
    closeDrawer();
    // --- End Optimistic Update ---

    try {
      if (isManual) {
        const updatedManualInteraction = updatedInteractions.find(i => i.id === activeInteraction.id);
        if (updatedManualInteraction) {
          const allManualInteractions = updatedInteractions.filter(i => i.id.toString().startsWith('manual_'));
          
          // Update manual_interactions and latest_interaction timestamp for new leads
          const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
          if (!isLegacyLead) {
            const { error } = await supabase
              .from('leads')
              .update({ 
                manual_interactions: allManualInteractions,
                latest_interaction: new Date().toISOString()
              })
              .eq('id', client.id);
            if (error) throw error;
          } else {
            const { error } = await supabase
              .from('leads')
              .update({ manual_interactions: allManualInteractions })
              .eq('id', client.id);
            if (error) throw error;
          }
        }
      } else {
        const { error } = await supabase
          .from('emails')
          .update({ observation: editData.observation })
          .eq('message_id', activeInteraction.id);
        if (error) throw error;
      }
      
      toast.success('Interaction updated!');
      if (onClientUpdate) await onClientUpdate(); // Silently refresh data
    } catch (error) {
      toast.error('Update failed. Reverting changes.');
      setInteractions(previousInteractions); // Revert on failure
      console.error(error);
    }
  };

  const openContactDrawer = () => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear().toString().slice(-2)}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    setNewContact({
      method: 'email',
      date,
      time,
      length: '',
      content: '',
      observation: '',
    });
    setContactDrawerOpen(true);
  };

  const closeContactDrawer = () => {
    setContactDrawerOpen(false);
  };

  const handleNewContactChange = (field: string, value: string) => {
    setNewContact((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveContact = async () => {
    if (!client) return;

    // Ensure we have the current user's full name
    let userFullName = currentUserFullName;
    if (!userFullName) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.id) {
          const { data: userData } = await supabase
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
          if (userData) {
            // Use display_name from tenants_employee if available, otherwise full_name
            const employee = Array.isArray(userData.tenants_employee) ? userData.tenants_employee[0] : userData.tenants_employee;
            userFullName = employee?.display_name || userData.full_name;
          }
        }
      } catch (error) {
        console.error('Error fetching user info:', error);
      }
    }

    const now = new Date();
    const newInteraction: Interaction = {
      id: `manual_${now.getTime()}`,
      date: newContact.date || now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }),
      time: newContact.time || now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      raw_date: now.toISOString(),
      employee: userFullName || 'You',
      direction: 'out',
      kind: newContact.method,
      length: newContact.length ? `${newContact.length}m` : '',
      content: newContact.content,
      observation: newContact.observation,
      editable: true,
    };

    // --- Optimistic Update ---
    const previousInteractions = [...interactions];
    const newInteractions = [newInteraction, ...interactions].sort((a, b) => new Date(b.raw_date).getTime() - new Date(a.raw_date).getTime());
    setInteractions(newInteractions);
    closeContactDrawer();
    // --- End Optimistic Update ---

    try {
      if (newContact.method === 'call_log') {
        // Get current user's employee ID for the call log
        let employeeId = null;
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user?.id) {
            const { data: userData } = await supabase
              .from('users')
              .select('employee_id')
              .eq('auth_id', user.id)
              .single();
            if (userData?.employee_id) {
              employeeId = userData.employee_id;
            }
          }
        } catch (error) {
          console.log('Could not fetch employee_id for call log:', error);
        }

        // Save to call_logs table
        const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
        const callLogData: any = {
          cdate: now.toISOString().split('T')[0],
          direction: 'Manual Entry',
          date: newContact.date ? new Date(newContact.date).toISOString().split('T')[0] : now.toISOString().split('T')[0],
          time: newContact.time || now.toTimeString().split(' ')[0].substring(0, 5),
          status: 'ANSWERED', // Default for manual entries
          duration: newContact.length ? parseInt(newContact.length) * 60 : 0, // Convert minutes to seconds
          employee_id: employeeId, // Include employee_id for JOIN queries
          action: ''
        };
        
        if (isLegacyLead) {
          const legacyId = parseInt(client.id.replace('legacy_', ''));
          callLogData.lead_id = legacyId;
        } else {
          callLogData.client_id = client.id;
        }
        
        const { error: callLogError } = await supabase
          .from('call_logs')
          .insert(callLogData);

        if (callLogError) throw callLogError;
        
        toast.success('Call log saved!');
        if (onClientUpdate) await onClientUpdate(); // Silently refresh data
      } else {
        // Save to manual_interactions
        const existingInteractions = client.manual_interactions || [];
        const updatedInteractions = [...existingInteractions, newInteraction];

        // Update manual_interactions and latest_interaction timestamp
        const { error: updateError } = await supabase
          .from('leads')
          .update({ 
            manual_interactions: updatedInteractions,
            latest_interaction: now.toISOString()
          })
          .eq('id', client.id);

        if (updateError) throw updateError;
        
        toast.success('Interaction saved!');
        if (onClientUpdate) await onClientUpdate(); // Silently refresh data
      }

    } catch (error) {
      toast.error('Save failed. Reverting changes.');
      setInteractions(previousInteractions); // Revert on failure
      console.error(error);
    }
  };

  // Combine emails and WhatsApp messages for AI summary
  const aiSummaryMessages = [
    // Emails
    ...emails.map(email => ({
      type: 'email',
      direction: email.direction === 'outgoing' ? 'out' : 'in',
      from: email.from,
      to: email.to,
      date: email.date,
      content: email.bodyPreview,
      subject: email.subject,
    })),
    // WhatsApp messages
    ...whatsAppMessages.map(msg => ({
      type: 'whatsapp',
      direction: msg.direction === 'out' ? 'out' : 'in',
      from: msg.sender_name || 'You',
      to: client.name,
      date: msg.date,
      content: msg.content,
    })),
  ].sort((a, b) => {
    // Sort by date descending (emails have full date, WhatsApp only time)
    const aDate = new Date(a.date);
    const bDate = new Date(b.date);
    return bDate.getTime() - aDate.getTime();
  });

  useEffect(() => {
    // Set default font size and family for new content
    const quillEditor = document.querySelector('.ql-editor');
    if (quillEditor) {
      (quillEditor as HTMLElement).style.fontSize = '16px';
      (quillEditor as HTMLElement).style.fontFamily = 'system-ui, Arial, sans-serif';
      (quillEditor as HTMLElement).style.lineHeight = '1.7';
      (quillEditor as HTMLElement).style.padding = '18px 16px';
    }
  }, []);

  useEffect(() => {
    if (isWhatsAppOpen) {
      console.log('WhatsApp client.id:', client.id);
      console.log('WhatsApp messages:', whatsAppMessages);
    }
  }, [isWhatsAppOpen, client.id]); // Removed whatsAppMessages dependency

  // Effect: when WhatsApp modal opens and activeWhatsAppId is set, scroll to and highlight the message
  React.useEffect(() => {
    if (isWhatsAppOpen && activeWhatsAppId) {
      setTimeout(() => {
        const el = document.querySelector(`[data-whatsapp-id="${activeWhatsAppId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          (el.firstChild as HTMLElement)?.classList?.add('ring-2', 'ring-primary');
          setTimeout(() => (el.firstChild as HTMLElement)?.classList?.remove('ring-2', 'ring-primary'), 1200);
        }
      }, 300);
    }
  }, [isWhatsAppOpen, activeWhatsAppId]);

  return (
    <div className="p-4 md:p-6 lg:p-8 flex flex-col xl:flex-row gap-6 md:gap-8 lg:gap-12 items-start min-h-screen max-w-7xl mx-auto">
      <div className="relative w-full flex-1 min-w-0">
        {/* Loading indicator */}
        {interactionsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="loading loading-spinner loading-lg text-primary"></div>
            <span className="ml-3 text-lg">Loading interactions...</span>
          </div>
        ) : (
          <>
            {/* Header with Contact Client Dropdown and AI Smart Recap */}
            <div className="w-full flex flex-col sm:flex-row items-stretch sm:items-center gap-4 mb-8 md:mb-12">
              <div className="dropdown">
                <label tabIndex={0} className="btn btn-outline btn-primary flex items-center gap-2 cursor-pointer w-full sm:w-auto justify-center">
                  <UserIcon className="w-5 h-5" /> Contact Client <ChevronDownIcon className="w-4 h-4 ml-1" />
                </label>
                <ul tabIndex={0} className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52 mt-2 z-[100]">
                  <li>
                    <button className="flex gap-2 items-center" onClick={() => { setIsEmailModalOpen(true); }}>
                      <EnvelopeIcon className="w-5 h-5" /> Email
                    </button>
                  </li>
                  <li>
                    <button className="flex gap-2 items-center" onClick={() => setIsWhatsAppOpen(true)}>
                      <FaWhatsapp className="w-5 h-5" /> WhatsApp
                    </button>
                  </li>
                  <li>
                    <button className="flex gap-2 items-center" onClick={openContactDrawer}>
                      <ChatBubbleLeftRightIcon className="w-5 h-5" /> Contact
                    </button>
                  </li>
                </ul>
              </div>
              
              {/* AI Smart Recap Button */}
              <button 
                className="btn bg-gradient-to-r from-purple-600 to-indigo-600 text-white border-none hover:from-purple-700 hover:to-indigo-700 shadow-lg w-full sm:w-auto justify-center"
                onClick={() => {
                  // Toggle AI summary panel on mobile, or show/hide it on desktop
                  if (window.innerWidth < 1024) {
                    // Mobile: show drawer with AI summary
                    setAiDrawerOpen(true);
                  } else {
                    // Desktop: toggle AI panel visibility
                    setShowAiSummary(!showAiSummary);
                  }
                }}
              >
                <SparklesIcon className="w-5 h-5" />
                AI Smart Recap
              </button>
              
            </div>
            
            {/* Timeline container with improved spacing */}
            <div className="relative max-w-5xl">
              {/* Timeline line */}
              <div className="absolute left-8 sm:left-12 md:left-16 top-0 bottom-0 w-1 bg-gradient-to-b from-primary via-accent to-secondary shadow-lg" style={{ zIndex: 0 }} />
              
              <div className="space-y-8 md:space-y-10 lg:space-y-12">
            {sortedInteractions.map((row, idx) => {
              // Date formatting
              const dateObj = new Date(row.raw_date);
              const day = dateObj.getDate().toString().padStart(2, '0');
              const month = dateObj.toLocaleString('en', { month: 'short' });
              const time = dateObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
              
              // Icon and color
              let icon, iconBg, cardBg, textGradient, avatarBg;
              if (row.direction === 'out') {
                // Employee (Outgoing)
                if (row.kind === 'sms') {
                  icon = <ChatBubbleLeftRightIcon className="w-4 h-4 md:w-5 md:h-5 !text-purple-600 drop-shadow-sm" style={{color: '#9333ea'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-purple-200';
                } else if (row.kind === 'call') {
                  // Different colors based on call status
                  if (row.status === 'ANSWERED') {
                    icon = <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 !text-emerald-600 drop-shadow-sm" style={{color: '#059669'}} />;
                    iconBg = 'bg-white shadow-lg border-2 border-emerald-200';
                  } else if (row.status === 'NO+ANSWER' || row.status === 'NO ANSWER') {
                    icon = <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 !text-red-600 drop-shadow-sm" style={{color: '#dc2626'}} />;
                    iconBg = 'bg-white shadow-lg border-2 border-red-200';
                  } else if (row.status === 'MISSED') {
                    icon = <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 !text-orange-600 drop-shadow-sm" style={{color: '#ea580c'}} />;
                    iconBg = 'bg-white shadow-lg border-2 border-orange-200';
                  } else {
                    icon = <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 !text-blue-600 drop-shadow-sm" style={{color: '#2563eb'}} />;
                    iconBg = 'bg-white shadow-lg border-2 border-blue-200';
                  }
                } else if (row.kind === 'whatsapp') {
                  icon = <FaWhatsapp className="w-4 h-4 md:w-5 md:h-5 !text-green-600 drop-shadow-sm" style={{color: '#16a34a'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-green-200';
                } else if (row.kind === 'email') {
                  icon = <EnvelopeIcon className="w-4 h-4 md:w-5 md:h-5 !text-blue-600 drop-shadow-sm" style={{color: '#2563eb'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-blue-200';
                } else if (row.kind === 'office') {
                  icon = <UserIcon className="w-4 h-4 md:w-5 md:h-5 !text-orange-600 drop-shadow-sm" style={{color: '#ea580c'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-orange-200';
                } else {
                  icon = <UserIcon className="w-4 h-4 md:w-5 md:h-5 !text-gray-600 drop-shadow-sm" style={{color: '#4b5563'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-gray-200';
                }
                cardBg = 'bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600';
                textGradient = 'bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 bg-clip-text text-transparent';
                avatarBg = 'bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white';
              } else {
                // Client (Ingoing)
                if (row.kind === 'sms') {
                  icon = <ChatBubbleLeftRightIcon className="w-4 h-4 md:w-5 md:h-5 !text-indigo-600 drop-shadow-sm" style={{color: '#4f46e5'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-indigo-200';
                } else if (row.kind === 'call') {
                  // Different colors based on call status
                  if (row.status === 'ANSWERED') {
                    icon = <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 !text-teal-600 drop-shadow-sm" style={{color: '#0d9488'}} />;
                    iconBg = 'bg-white shadow-lg border-2 border-teal-200';
                  } else if (row.status === 'NO+ANSWER' || row.status === 'NO ANSWER') {
                    icon = <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 !text-rose-600 drop-shadow-sm" style={{color: '#e11d48'}} />;
                    iconBg = 'bg-white shadow-lg border-2 border-rose-200';
                  } else if (row.status === 'MISSED') {
                    icon = <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 !text-amber-600 drop-shadow-sm" style={{color: '#d97706'}} />;
                    iconBg = 'bg-white shadow-lg border-2 border-amber-200';
                  } else {
                    icon = <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 !text-cyan-600 drop-shadow-sm" style={{color: '#0891b2'}} />;
                    iconBg = 'bg-white shadow-lg border-2 border-cyan-200';
                  }
                } else if (row.kind === 'whatsapp') {
                  icon = <FaWhatsapp className="w-4 h-4 md:w-5 md:h-5 !text-green-600 drop-shadow-sm" style={{color: '#16a34a'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-green-200';
                } else if (row.kind === 'email') {
                  icon = <EnvelopeIcon className="w-4 h-4 md:w-5 md:h-5 !text-cyan-600 drop-shadow-sm" style={{color: '#0891b2'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-cyan-200';
                } else if (row.kind === 'office') {
                  icon = <UserIcon className="w-4 h-4 md:w-5 md:h-5 !text-amber-600 drop-shadow-sm" style={{color: '#d97706'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-amber-200';
                } else {
                  icon = <UserIcon className="w-4 h-4 md:w-5 md:h-5 !text-slate-600 drop-shadow-sm" style={{color: '#475569'}} />;
                  iconBg = 'bg-white shadow-lg border-2 border-slate-200';
                }
                cardBg = 'bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400';
                textGradient = 'bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 bg-clip-text text-transparent';
                avatarBg = 'bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white';
              }
              
              // Initials
              const initials = row.employee.split(' ').map(n => n[0]).join('').toUpperCase();
              
              return (
                <div
                  key={row.id}
                  ref={idx === lastEmailIdx ? lastEmailRef : null}
                  className="relative pl-16 sm:pl-20 md:pl-24 cursor-pointer group"
                  onClick={() => handleInteractionClick(row, idx)}
                >
                  {/* Timeline dot and icon, large, left-aligned */}
                  <div className="absolute -left-6 sm:-left-8 md:-left-10 top-0" style={{ zIndex: 2 }}>
                    <div className={`w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center shadow-xl ring-4 ring-white ${iconBg}`}>
                      {React.cloneElement(icon, { className: 'w-5 h-5 sm:w-6 sm:h-6 md:w-8 md:h-8' })}
                    </div>
                  </div>
                  
                  {/* Main content container with better spacing */}
                  <div className="flex flex-col lg:flex-row lg:items-start gap-4 lg:gap-6">
                    {/* Timestamp and metadata */}
                    <div className="flex-shrink-0 lg:w-32">
                      <div className="text-sm md:text-base font-semibold text-gray-700 mb-1">{day} {month}</div>
                      <div className="text-xs md:text-sm text-gray-500">{time}</div>
                      {row.length && row.length !== 'm' && (
                        <div className="text-xs text-gray-400 mt-1">{row.length}</div>
                      )}
                    </div>
                    
                    {/* Main content card */}
                    <div className="flex-1 min-w-0">
                      <div className={`p-[2px] rounded-2xl ${cardBg} shadow-xl hover:shadow-2xl transition-all duration-300 group-hover:scale-[1.02]`}>
                        <div className="bg-white rounded-2xl p-4 sm:p-5 md:p-6">
                          {/* Header section with employee info and status */}
                          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
                            <div className="flex items-center gap-3">
                              <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-bold ${avatarBg} text-sm sm:text-base`}>
                                {initials}
                              </div>
                              <div className={`font-semibold text-sm sm:text-base md:text-lg ${textGradient}`}>
                                {row.employee}
                              </div>
                            </div>
                            
                            {/* Status badges */}
                            <div className="flex flex-wrap gap-2">
                              {/* Show status badge for WhatsApp and Call interactions */}
                              {row.kind === 'whatsapp' && row.status && (
                                <span className={`px-3 py-1 rounded-full font-medium shadow-sm ${cardBg} text-white text-xs ${row.status.toLowerCase().includes('not') ? 'opacity-80' : ''}`}>
                                  {row.status}
                                </span>
                              )}
                              {/* Call status badge - always show for calls */}
                              {row.kind === 'call' && (
                                <span className={`px-3 py-1 rounded-full font-medium shadow-sm text-xs ${
                                  row.status && row.status.toLowerCase() === 'answered' ? 'bg-green-500 text-white' :
                                  row.status && (row.status.toLowerCase() === 'no+answer' || row.status.toLowerCase() === 'no answer') ? 'bg-red-500 text-white' :
                                  row.status && row.status.toLowerCase() === 'failed' ? 'bg-red-500 text-white' :
                                  row.status && row.status.toLowerCase() === 'busy' ? 'bg-yellow-500 text-white' :
                                  'bg-gray-600 text-white'
                                }`}>
                                  {row.status === 'NO+ANSWER' ? 'NO ANSWER' : (row.status === 'unread' ? 'UNKNOWN' : (row.status || 'UNKNOWN'))}
                                </span>
                              )}
                              {row.length && row.length !== 'm' && (
                                <span className={`px-3 py-1 rounded-full font-medium shadow-sm ${cardBg} text-white text-xs`}>
                                  {row.length}
                                </span>
                              )}

                              {/* WhatsApp status indicator */}
                              {row.kind === 'whatsapp' && row.status && (
                                <div className="flex items-center gap-1">
                                  {renderMessageStatus(row.status, (row as any).error_message)}
                                  {row.status === 'failed' && (
                                    <span className="px-2 py-1 rounded-full font-medium shadow-sm bg-red-100 text-red-700 text-xs">
                                      Failed
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        
                          {/* Content section - hide content for calls since status is shown in badge */}
                          {row.content && row.kind !== 'call' && (
                            <div className="text-sm sm:text-base text-gray-700 break-words mb-4">
                              {/* Subject in bold with colon, then body with spacing */}
                              {row.subject ? (
                                <>
                                  <div className="font-bold text-base sm:text-lg mb-2 text-gray-900">{row.subject}</div>
                                  <div 
                                    className="max-w-none whitespace-pre-wrap overflow-visible"
                                    style={{ lineHeight: '1.6', maxHeight: 'none' }}
                                    dangerouslySetInnerHTML={{ 
                                      __html: sanitizeEmailHtml(
                                        stripSignatureAndQuotedTextPreserveHtml(
                                          typeof row.content === 'string'
                                            ? row.content.replace(new RegExp(`^${row.subject}\s*:?[\s\-]*`, 'i'), '').trim()
                                            : row.content
                                        )
                                      )
                                    }} 
                                  />
                                </>
                              ) : (
                                <div 
                                  className="max-w-none whitespace-pre-wrap overflow-visible"
                                  style={{ lineHeight: '1.6', maxHeight: 'none' }}
                                  dangerouslySetInnerHTML={{ 
                                    __html: sanitizeEmailHtml(
                                      stripSignatureAndQuotedTextPreserveHtml(row.content)
                                    ) 
                                  }} 
                                />
                              )}
                            </div>
                          )}
                          
                          {/* Call recording playback controls */}
                          {row.kind === 'call' && (
                            <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3 mb-4">
                              <div className="flex items-center gap-2">
                                <SpeakerWaveIcon className="w-5 h-5 text-gray-500" />
                                <div className="flex flex-col">
                                  <span className="text-sm font-medium text-gray-700">
                                    {row.recording_url ? 'Call Recording' : 'Recording not available'}
                                  </span>
                                </div>
                              </div>
                              {row.recording_url && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (playingAudioId === row.id) {
                                      handleStopRecording();
                                    } else {
                                      handlePlayRecording(row.recording_url!, row.id.toString());
                                    }
                                  }}
                                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                                    playingAudioId === row.id
                                      ? 'bg-red-500 text-white hover:bg-red-600 shadow-md'
                                      : 'bg-purple-500 text-white hover:bg-purple-600 shadow-md'
                                  }`}
                                >
                                  {playingAudioId === row.id ? (
                                    <>
                                      <StopIcon className="w-4 h-4" />
                                      Stop
                                    </>
                                  ) : (
                                    <>
                                      <PlayIcon className="w-4 h-4" />
                                      Play
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                          )}

                          {/* Observation/Notes */}
                          {row.observation && row.observation !== 'call-ended' && (
                            <div className="bg-purple-50 border-l-4 border-purple-400 p-3 rounded-r-lg">
                              <div className="flex items-start gap-2">
                                <div className="w-2 h-2 bg-purple-400 rounded-full mt-2 flex-shrink-0"></div>
                                <div>
                                  <div className="text-sm font-medium text-purple-900 mb-1">Note</div>
                                  <div className="text-sm text-purple-800 break-words">{row.observation}</div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
              </div>
            </div>
            
            {/* Timeline and History Buttons at bottom */}
            <div className="mt-8 md:mt-12 pt-6 md:pt-8 border-t border-base-200">
              <TimelineHistoryButtons client={client} />
            </div>
          </>
        )}
      </div>
      {/* Right-side AI summary panel (hidden on mobile, conditional on desktop) */}
      {showAiSummary && (
        <div className="hidden xl:block w-full max-w-md ai-summary-panel">
          <div className="sticky top-8">
            <AISummaryPanel messages={aiSummaryMessages} />
          </div>
        </div>
      )}
      {/* Email Thread Modal */}
      {isEmailModalOpen && createPortal(
        <div className="fixed inset-0 bg-white z-[9999]">
          {/* CSS to ensure email content displays fully */}
          <style>{`
            .email-content .email-body {
              max-width: none !important;
              overflow: visible !important;
              word-wrap: break-word !important;
              white-space: pre-wrap !important;
            }
            .email-content .email-body * {
              max-width: none !important;
              overflow: visible !important;
            }
            .email-content .email-body img {
              max-width: 100% !important;
              height: auto !important;
            }
            .email-content .email-body table {
              width: 100% !important;
              border-collapse: collapse !important;
            }
            .email-content .email-body p, 
            .email-content .email-body div, 
            .email-content .email-body span {
              white-space: pre-wrap !important;
              word-wrap: break-word !important;
            }
          `}</style>
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 md:p-6 border-b border-gray-200">
              <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
                <h2 className="text-lg md:text-2xl font-bold text-gray-900">Email Thread</h2>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0"></div>
                  <span className="text-gray-600 text-sm md:text-base truncate">
                    {client.name} ({client.lead_number})
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsEmailModalOpen(false)}
                  className="btn btn-ghost btn-circle"
                >
                  <XMarkIcon className="w-5 h-5 md:w-6 md:h-6" />
                </button>
              </div>
            </div>

            {/* Search Bar */}
            <div className="px-4 md:px-6 py-3 border-b border-gray-200 bg-gray-50">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  placeholder="Search emails by keywords, sender name, or recipient..."
                  value={emailSearchQuery}
                  onChange={(e) => setEmailSearchQuery(e.target.value)}
                />
                {emailSearchQuery && (
                  <button
                    onClick={() => setEmailSearchQuery('')}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  >
                    <XMarkIcon className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                  </button>
                )}
              </div>
            </div>

            {/* Email Thread */}
            <div className="flex-1 overflow-y-auto p-3 md:p-6 bg-white">
              {emailsLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="loading loading-spinner loading-lg text-purple-500"></div>
                </div>
              ) : emails.length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-500">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <p className="text-lg font-medium">No emails available</p>
                    <p className="text-sm">No emails found for {client.name}. Try syncing or send a new email.</p>
                  </div>
                </div>
              ) : emails.filter((message) => {
                if (!emailSearchQuery.trim()) return true;
                
                const searchTerm = emailSearchQuery.toLowerCase();
                
                // Search in subject
                if (message.subject && message.subject.toLowerCase().includes(searchTerm)) return true;
                
                // Search in email body content
                if (message.bodyPreview && message.bodyPreview.toLowerCase().includes(searchTerm)) return true;
                
                // Search in sender name (from field)
                if (message.from && message.from.toLowerCase().includes(searchTerm)) return true;
                
                // Search in recipient (to field)
                if (message.to && message.to.toLowerCase().includes(searchTerm)) return true;
                
                // Search in sender name (display name)
                const senderName = message.direction === 'outgoing' ? (currentUserFullName || 'Team') : client.name;
                if (senderName.toLowerCase().includes(searchTerm)) return true;
                
                return false;
              }).length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-500">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <MagnifyingGlassIcon className="w-8 h-8 text-gray-400" />
                    </div>
                    <p className="text-lg font-medium">No emails found</p>
                    <p className="text-sm">No emails match your search for "{emailSearchQuery}". Try a different search term.</p>
                    <button
                      onClick={() => setEmailSearchQuery('')}
                      className="mt-2 text-sm text-purple-600 hover:text-purple-800 underline"
                    >
                      Clear search
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {[...emails]
                    .filter((message) => {
                      if (!emailSearchQuery.trim()) return true;
                      
                      const searchTerm = emailSearchQuery.toLowerCase();
                      
                      // Search in subject
                      if (message.subject && message.subject.toLowerCase().includes(searchTerm)) return true;
                      
                      // Search in email body content
                      if (message.bodyPreview && message.bodyPreview.toLowerCase().includes(searchTerm)) return true;
                      
                      // Search in sender name (from field)
                      if (message.from && message.from.toLowerCase().includes(searchTerm)) return true;
                      
                      // Search in recipient (to field)
                      if (message.to && message.to.toLowerCase().includes(searchTerm)) return true;
                      
                      // Search in sender name (display name)
                      const senderName = message.direction === 'outgoing' ? (currentUserFullName || 'Team') : client.name;
                      if (senderName.toLowerCase().includes(searchTerm)) return true;
                      
                      return false;
                    })
                    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                    .map((message, index) => (
                      <div key={message.id} className="space-y-2">
                        {/* Email Header */}
                        <div className="flex items-center gap-3">
                          <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            message.direction === 'outgoing'
                              ? 'bg-blue-100 text-blue-700 border border-blue-200'
                              : 'bg-pink-100 text-pink-700 border border-pink-200'
                          }`}>
                            {message.direction === 'outgoing' ? 'Team' : 'Client'}
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900 text-sm">
                              {message.direction === 'outgoing' ? (currentUserFullName || 'Team') : client.name}
                            </div>
                            <div className="text-xs text-gray-500">
                              {new Date(message.date).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </div>
                          </div>
                        </div>
                        
                        {/* Complete Email Content */}
                        <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-lg hover:shadow-xl transition-shadow duration-300" style={{
                          boxShadow: '0 10px 25px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05), 0 0 0 1px rgba(0, 0, 0, 0.05)'
                        }}>
                          {/* Email Header */}
                          <div className="mb-4 pb-4 border-b border-gray-200">
                            <div className="text-sm text-gray-600 space-y-1">
                              <div><strong>From:</strong> {message.direction === 'outgoing' ? (currentUserFullName || 'Team') : client.name} &lt;{message.from}&gt;</div>
                              <div><strong>To:</strong> {message.to || (message.direction === 'outgoing' ? `${client.name} <${client.email}>` : `eliran@lawoffice.org.il`)}</div>
                              <div><strong>Date:</strong> {new Date(message.date).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}</div>
                              {message.subject && (
                                <div><strong>Subject:</strong> {message.subject}</div>
                              )}
                            </div>
                          </div>
                          
                          {/* Complete Email Body - Full Content */}
                          <div className="email-content">
                            {message.bodyPreview ? (
                              <div 
                                dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(message.bodyPreview) }}
                                className="prose prose-sm max-w-none email-body"
                                style={{
                                  fontFamily: 'inherit',
                                  lineHeight: '1.6',
                                  color: '#374151'
                                }}
                              />
                            ) : (
                              <div className="text-gray-500 italic p-4 bg-gray-50 rounded">
                                No email content available
                              </div>
                            )}
                          </div>
                          
                          {/* Attachments */}
                          {message.attachments && message.attachments.length > 0 && (
                            <div className="mt-6 pt-4 border-t border-gray-200">
                              <div className="text-sm font-medium text-gray-700 mb-3">Attachments:</div>
                              <div className="space-y-2">
                                {message.attachments.map((attachment: Attachment, idx: number) => (
                                  <div key={attachment.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                                    <PaperClipIcon className="w-5 h-5 text-gray-400" />
                                    <div className="flex-1">
                                      <div className="font-medium text-gray-900">{attachment.name}</div>
                                      {attachment.sizeInBytes && (
                                        <div className="text-sm text-gray-500">
                                          {(attachment.sizeInBytes / 1024).toFixed(1)} KB
                                        </div>
                                      )}
                                      {attachment.contentType && (
                                        <div className="text-xs text-gray-400">
                                          {attachment.contentType}
                                        </div>
                                      )}
                                    </div>
                                    <button
                                      onClick={() => handleDownloadAttachment(message.id, attachment)}
                                      disabled={downloadingAttachments[attachment.id]}
                                      className="btn btn-sm btn-outline btn-primary"
                                      title="Download attachment"
                                    >
                                      {downloadingAttachments[attachment.id] ? (
                                        <span className="loading loading-spinner loading-xs" />
                                      ) : (
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                      )}
                                      Download
                                    </button>
                                  </div>
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
            <div className="border-t border-gray-200 p-3 md:p-6">
              {showCompose ? (
                <div className="space-y-4">
                  <input
                    type="text"
                    placeholder="Subject"
                    value={composeSubject}
                    onChange={(e) => setComposeSubject(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <textarea
                    placeholder="Type your message..."
                    value={composeBody}
                    onChange={(e) => setComposeBody(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
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
                  
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="btn btn-ghost btn-sm"
                      >
                        <PaperClipIcon className="w-4 h-4" />
                        <span className="hidden sm:inline">Attach</span>
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
                        className="btn btn-outline btn-sm flex-1 sm:flex-none"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSendEmail}
                        disabled={sending || !composeBody.trim()}
                        className="btn btn-primary btn-sm flex-1 sm:flex-none"
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
      {contactDrawerOpen && createPortal(
        <div className="fixed inset-0 z-[999] flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30" onClick={closeContactDrawer} />
          {/* Drawer */}
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-[999]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">Contact Client</h3>
              <button className="btn btn-ghost btn-sm" onClick={closeContactDrawer}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-4 flex-1">
              <div>
                <label className="block font-semibold mb-1">How to contact</label>
                <select
                  className="select select-bordered w-full"
                  value={newContact.method}
                  onChange={e => handleNewContactChange('method', e.target.value)}
                >
                  {contactMethods.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Date</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={newContact.date}
                  onChange={e => handleNewContactChange('date', e.target.value)}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Time</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={newContact.time}
                  onChange={e => handleNewContactChange('time', e.target.value)}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Minutes</label>
                <input
                  type="number"
                  min="0"
                  className="input input-bordered w-full"
                  value={newContact.length}
                  onChange={e => handleNewContactChange('length', e.target.value)}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Content</label>
                <textarea
                  className="textarea textarea-bordered w-full min-h-[80px]"
                  value={newContact.content}
                  onChange={e => handleNewContactChange('content', e.target.value)}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Observation</label>
                <textarea
                  className="textarea textarea-bordered w-full min-h-[60px]"
                  value={newContact.observation}
                  onChange={e => handleNewContactChange('observation', e.target.value)}
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button className="btn btn-primary px-8" onClick={handleSaveContact}>
                Save
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {/* WhatsApp Modal */}
      {isWhatsAppOpen && createPortal(
        <div className="fixed inset-0 bg-white z-[9999]">
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 md:p-6 border-b border-gray-200">
              <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
                <FaWhatsapp className="w-6 h-6 md:w-8 md:h-8 text-green-600 flex-shrink-0" />
                <h2 className="text-lg md:text-2xl font-bold text-gray-900">WhatsApp</h2>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse flex-shrink-0"></div>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm md:text-lg font-semibold text-gray-900 truncate">
                      {client.name}
                    </span>
                    <span className="text-xs md:text-sm text-gray-500 font-mono flex-shrink-0">
                      ({client.lead_number})
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
              {whatsAppMessages.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <FaWhatsapp className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p className="text-lg font-medium">No messages yet</p>
                  <p className="text-sm">Start the conversation with {client.name}</p>
                </div>
              ) : (
                whatsAppMessages.map((message, index) => (
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
                        {message.sender_name || client.name}
                      </span>
                    )}
                    <div
                      className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-2 shadow-sm ${
                        message.direction === 'out'
                          ? isEmojiOnly(message.message)
                            ? 'bg-white text-gray-900'
                            : 'bg-green-600 text-white'
                          : 'bg-white text-gray-900 border border-gray-200'
                      }`}
                    >
                      {/* Message content based on type */}
                      {message.message_type === 'text' && (
                        <p className={`break-words ${
                          isEmojiOnly(message.message) ? 'text-6xl leading-tight' : 'text-base'
                        }`}>
                          {message.message}
                        </p>
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
                            {renderMessageStatus(message.whatsapp_status, message.error_message)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Error Display Area */}
            {whatsAppError && (
              <div className="flex-shrink-0 p-4 bg-red-50 border-t border-red-200">
                <div className="flex items-center gap-2 p-3 bg-red-100 border border-red-300 rounded-lg">
                  <ExclamationTriangleIcon className="w-5 h-5 text-red-600 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm text-red-800 font-medium">{whatsAppError}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWhatsAppError(null)}
                    className="text-red-600 hover:text-red-800"
                  >
                    <XMarkIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Message Input - Fixed */}
            <div className="flex-shrink-0 p-4 bg-white border-t border-gray-200">
              <form onSubmit={handleSendWhatsApp} className="flex items-center gap-2">
                <div className="relative">
                  <button 
                    type="button" 
                    onClick={() => setIsEmojiPickerOpen(!isEmojiPickerOpen)}
                    className="btn btn-ghost btn-circle"
                  >
                    <FaceSmileIcon className="w-6 h-6 text-gray-500" />
                  </button>
                  
                  {/* Emoji Picker */}
                  {isEmojiPickerOpen && (
                    <div className="absolute bottom-12 left-0 z-50 emoji-picker-container">
                      <EmojiPicker
                        onEmojiClick={handleEmojiClick}
                        width={350}
                        height={400}
                        skinTonesDisabled={false}
                        searchDisabled={false}
                        previewConfig={{
                          showPreview: true,
                          defaultEmoji: '1f60a',
                          defaultCaption: 'Choose your emoji!'
                        }}
                        lazyLoadEmojis={false}
                      />
                    </div>
                  )}
                </div>
                
                {/* File upload button */}
                <label 
                  className="btn btn-ghost btn-circle cursor-pointer"
                  onClick={() => console.log('📁 File upload button clicked')}
                >
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
      {/* Details Drawer for Interactions */}
      {detailsDrawerOpen && activeInteraction && createPortal(
        <div className="fixed inset-0 z-[999] flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30" onClick={() => setDetailsDrawerOpen(false)} />
          {/* Drawer */}
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-[999]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">Interaction Details</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setDetailsDrawerOpen(false)}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-4 flex-1">
              <div><span className="font-semibold">Type:</span> {activeInteraction.kind}</div>
              <div><span className="font-semibold">Date:</span> {activeInteraction.date} {activeInteraction.time}</div>
              <div><span className="font-semibold">Employee:</span> {activeInteraction.employee}</div>
              {activeInteraction.kind === 'call' && activeInteraction.editable && (
                <>
                  <div>
                    <label className="block font-semibold mb-1">Minutes</label>
                    <input
                      type="number"
                      className="input input-bordered w-full"
                      value={editData.length}
                      onChange={e => handleEditChange('length', e.target.value)}
                      min={0}
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Content</label>
                    <textarea
                      className="textarea textarea-bordered w-full min-h-[80px]"
                      value={editData.content}
                      onChange={e => handleEditChange('content', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Observation</label>
                    <textarea
                      className="textarea textarea-bordered w-full min-h-[60px]"
                      value={editData.observation}
                      onChange={e => handleEditChange('observation', e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2 justify-end mt-4">
                    <button className="btn btn-primary" onClick={handleSave}>Save</button>
                    <button className="btn btn-ghost" onClick={closeDrawer}>Cancel</button>
                  </div>
                </>
              )}
              {/* Show non-editable fields for other types or non-editable interactions */}
              {!(activeInteraction.kind === 'call' && activeInteraction.editable) && (
                <>
                  <div><span className="font-semibold">Content:</span> {activeInteraction.content}</div>
                  <div><span className="font-semibold">Observation:</span> {activeInteraction.observation}</div>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
      {/* AI Smart Recap Drawer for Mobile */}
      {aiDrawerOpen && createPortal(
        <div className="fixed inset-0 z-[999] flex lg:hidden">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/50" onClick={() => setAiDrawerOpen(false)} />
          {/* Drawer */}
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl flex flex-col animate-slideInRight z-[999]">
            <div className="flex items-center justify-between p-6 border-b border-base-300 bg-gradient-to-r from-purple-600 to-indigo-600">
              <div className="flex items-center gap-3">
                <SparklesIcon className="w-6 h-6 text-white" />
                <h3 className="text-xl font-bold text-white saira-regular">AI Smart Recap</h3>
              </div>
              <button className="btn btn-ghost btn-sm text-white hover:bg-white/20" onClick={() => setAiDrawerOpen(false)}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <AISummaryPanel messages={aiSummaryMessages} />
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default InteractionsTab; 