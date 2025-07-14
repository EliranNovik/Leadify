import React, { useState, useEffect, useCallback, Fragment } from 'react';
import { ClientTabProps } from '../../types/client';
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

interface Attachment {
  id: string;
  name: string;
  contentType: string;
  sizeInBytes: number;
  isInline: boolean;
  contentUrl?: string; // For download
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
  subject?: string; // <-- add this line
}

const contactMethods = [
  { value: 'email', label: 'E-mail' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'call', label: 'Call' },
  { value: 'sms', label: 'SMS' },
  { value: 'office', label: 'In Office' },
];

const stripSignatureAndQuotedText = (html: string): string => {
  if (!html) return '';
  
  // Convert HTML to plain text first for better processing
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  let text = tempDiv.textContent || tempDiv.innerText || '';
  
  // Enhanced markers for Outlook signatures, timestamps, and quoted text
  const markers = [
    // Outlook/Exchange specific
    '<div id="divRplyFwdMsg"',
    'class="gmail_quote"',
    '<div class="WordSection1"',
    '<div class="OutlookMessageHeader"',
    'x-apple-data-detectors',
    'class="Apple-interchange-newline"',
    
    // Reply/Forward indicators
    '<hr',
    '-------- Original Message --------',
    '________________________________',
    '-----Original Message-----',
    
    // Headers
    '<strong>From:</strong>',
    '<b>From:</b>',
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
    
    // Time-based patterns (regex-like matching for common timestamp formats)
  ];

  // First pass: Find the earliest marker position in HTML
  let earliestPos = -1;
  for (const marker of markers) {
    const pos = html.toLowerCase().indexOf(marker.toLowerCase());
    if (pos !== -1 && (earliestPos === -1 || pos < earliestPos)) {
      earliestPos = pos;
    }
  }

  let cleanedHtml = earliestPos !== -1 ? html.substring(0, earliestPos).trim() : html;
  
  // Second pass: Remove common timestamp patterns from text
  const timestampPatterns = [
    // English patterns
    /On\s+\w{3},?\s+\w{3}\s+\d{1,2},?\s+\d{4}\s+at\s+\d{1,2}:\d{2}\s*(AM|PM)/gi,
    /On\s+\w+\s+\d{1,2},?\s+\d{4},?\s+at\s+\d{1,2}:\d{2}\s*(AM|PM)/gi,
    /Sent:\s*\w+,?\s+\w+\s+\d{1,2},?\s+\d{4}\s+\d{1,2}:\d{2}\s*(AM|PM)/gi,
    
    // German Outlook patterns - "Am Fr., 11. Juli 2025 um 18:24 Uhr schrieb"
    /Am\s+\w{2,3}\.?,?\s+\d{1,2}\.\s+\w+\s+\d{4}\s+um\s+\d{1,2}:\d{2}\s+Uhr\s+schrieb/gi,
    // "Am Freitag, 11. Juli 2025 um 18:24 schrieb"
    /Am\s+\w+,?\s+\d{1,2}\.\s+\w+\s+\d{4}\s+um\s+\d{1,2}:\d{2}\s*(Uhr\s+)?schrieb/gi,
    // Generic German date patterns
    /\d{1,2}\.\s*\w+\s+\d{4}\s+um\s+\d{1,2}:\d{2}/gi,
    
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
    cleanedHtml = cleanedHtml.replace(pattern, '');
  }

  // Additional cleaning for specific cases like your example
  cleanedHtml = cleanedHtml
    // Remove quoted email content that starts with email addresses
    .replace(/<[^@\s]+@[^@\s>]+\.[^@\s>]+>/g, '')
    // Remove everything after email addresses in angle brackets followed by text
    .replace(/<.*?@.*?>/g, '')
    // Remove lines that start with common quote indicators
    .replace(/^[\s]*[>|]+.*$/gm, '')
    // Remove "Von:" (German) / "From:" patterns
    .replace(/Von:\s*.*$/gmi, '')
    // Remove "Gesendet:" (German) / "Sent:" patterns  
    .replace(/Gesendet:\s*.*$/gmi, '')
    // Remove "An:" (German) / "To:" patterns
    .replace(/An:\s*.*$/gmi, '')
    // Remove "Betreff:" (German) / "Subject:" patterns
    .replace(/Betreff:\s*.*$/gmi, '')
    // Remove anything that looks like quoted email headers
    .replace(/^\s*(Von|From|Gesendet|Sent|An|To|Betreff|Subject):\s*.*$/gmi, '')
    // Remove Unicode directional text markers more aggressively
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    // Remove the specific pattern from your example more aggressively
    .replace(/Am\s+\w+\.?,?\s+\d{1,2}\.\s+\w+\s+\d{4}\s+um\s+\d{1,2}:\d{2}.*?schrieb\s*‫.*?‬\s*<.*?>/gi, '')
    // Remove everything after patterns that indicate quoted content
    .split(/(?:Am\s+\w+\.?,?\s+\d{1,2}\.\s+\w+\s+\d{4}|On\s+\w+,?\s+\w+\s+\d{1,2})/i)[0]
    // Remove empty paragraphs and divs
    .replace(/<p[^>]*>\s*<\/p>/gi, '')
    .replace(/<div[^>]*>\s*<\/div>/gi, '')
    .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '<br>')
    // Clean up multiple spaces and newlines
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();

  return cleanedHtml;
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

// Microsoft Graph API: Send email (as a new message or reply)
async function sendClientEmail(token: string, subject: string, body: string, client: ClientTabProps['client'], senderName: string, attachments: { name: string; contentType: string; contentBytes: string }[]) {
  const signature = `<br><br>Best regards,<br>${senderName}<br>Decker Pex Levi Law Offices`;
  const fullBody = body + signature;

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
  const [bodyFocused, setBodyFocused] = useState(false);
  const [footerHeight, setFooterHeight] = useState(72);
  const [composeOverlayOpen, setComposeOverlayOpen] = useState(false);
  const quillRef = useRef<ReactQuill>(null);
  const [activeWhatsAppId, setActiveWhatsAppId] = useState<string | null>(null);
  const location = useLocation();
  const lastEmailRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  // 1. Add state for WhatsApp messages from DB
  const [whatsAppMessages, setWhatsAppMessages] = useState<any[]>([]);

  // Find the index of the last email in the sorted interactions
  const sortedInteractions = [...interactions].sort((a, b) => new Date(b.raw_date).getTime() - new Date(a.raw_date).getTime());
  const lastEmailIdx = sortedInteractions.map(row => row.kind).lastIndexOf('email');

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
  }, [location.search, interactions.length]);

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
  }, [interactions.length, emails.length, lastEmailIdx, sortedInteractions]);

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
  }, [interactions.length, client.id]); // Add client.id dependency

  // Close WhatsApp modal when client changes
  useEffect(() => {
    setIsWhatsAppOpen(false);
    // Clear any stale flags when client changes
    localStorage.removeItem('openWhatsAppModal');
    localStorage.removeItem('whatsAppFromCalendar');
  }, [client.id]);

  // Handle WhatsApp modal close and navigation back to Calendar
  const handleWhatsAppClose = () => {
    setIsWhatsAppOpen(false);
    
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
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('lead_id', client.id)
        .order('sent_at', { ascending: true });
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

  // 3. On send, save to DB and refetch messages
  const handleSendWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!whatsAppInput.trim()) return;
    const now = new Date();
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
      const { error: insertError } = await supabase
        .from('whatsapp_messages')
        .insert([
          {
            lead_id: client.id,
            sender_id: senderId,
            sender_name: senderName,
            direction: 'out',
            message: whatsAppInput,
            sent_at: now.toISOString(),
            status: 'sent',
          }
        ]);
      if (insertError) {
        toast.error('Failed to save WhatsApp message: ' + insertError.message);
        return;
      }
      setWhatsAppInput('');
      // Refetch messages
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('lead_id', client.id)
        .order('sent_at', { ascending: true });
      if (!error && data) {
        setWhatsAppMessages(data);
      }
      // Optionally, update interactions timeline
      if (onClientUpdate) await onClientUpdate();
    } catch (err) {
      toast.error('Unexpected error saving WhatsApp message.');
    }
  };

  // 4. Use whatsAppMessages for chat display
  // Replace whatsAppChatMessages with whatsAppMessages in the modal rendering
  // 5. In the timeline, merge WhatsApp messages from DB with other interactions
  // In fetchAndCombineInteractions, fetch WhatsApp messages from DB and merge with manual_interactions and emails
  useEffect(() => {
    let isMounted = true;
    async function fetchAndCombineInteractions() {
      // Ensure currentUserFullName is set before mapping emails
      let userFullName = currentUserFullName;
      if (!userFullName) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user && user.email) {
          const { data, error } = await supabase
            .from('users')
            .select('full_name')
            .eq('email', user.email)
            .single();
          if (!error && data?.full_name) {
            userFullName = data.full_name;
            if (isMounted) setCurrentUserFullName(data.full_name);
          }
        }
      }
      // 1. Manual interactions (excluding WhatsApp)
      const manualInteractions = (client.manual_interactions || []).filter((i: any) => i.kind !== 'whatsapp').map((i: any) => ({
        ...i,
        employee: i.direction === 'out' ? (userFullName || 'You') : i.employee || client.name,
      }));
      // 2. Email interactions
      const clientEmails = (client as any).emails || [];
      const emailInteractions = clientEmails.map((e: any) => {
        const emailDate = new Date(e.sent_at);
        
        // Enhanced email body processing
        function cleanEmailBody(htmlContent: string): string {
          if (!htmlContent) return '';
          // First apply the signature and quoted text removal
          let cleanedHtml = stripSignatureAndQuotedText(htmlContent);
          // Additional aggressive cleaning for timeline
          cleanedHtml = cleanedHtml
            // Split at common quoted content indicators and take only the first part
            .split(/(?:Am\s+\w+\.?\,?\s+\d{1,2}\.\s+\w+\s+\d{4})/i)[0]
            .split(/(?:On\s+\w+,?\s+\w+\s+\d{1,2})/i)[0]
            .split(/(?:‪Am\s+)/i)[0]  // Handle Unicode marker
            .split(/(?:Von:|From:|Gesendet:|Sent:)/i)[0]
            // Remove any remaining quoted indicators
            .replace(/‪.*?‬/g, '')  // Unicode directional markers
            .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')  // All Unicode direction markers
            .replace(/<.*?@.*?>/g, '')  // Email addresses in brackets
            .trim();
          // --- FINAL STRIP: Remove any remaining HTML tags using DOMParser ---
          if (typeof window !== 'undefined' && cleanedHtml.match(/<[^>]+>/)) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = cleanedHtml;
            cleanedHtml = tempDiv.textContent || tempDiv.innerText || '';
          } else {
            // Fallback for SSR or if no tags
            cleanedHtml = cleanedHtml.replace(/<[^>]+>/g, '');
          }
          // Remove all HTML comments
          cleanedHtml = cleanedHtml.replace(/<!--([\s\S]*?)-->/g, '');
          // Additional cleaning for timeline display
          cleanedHtml = cleanedHtml
            // Remove excessive whitespace
            .replace(/\s+/g, ' ')
            // Remove common Outlook artifacts
            .replace(/\[cid:.*?\]/g, '')
            // Remove email addresses that might still be there
            .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
            // Remove URLs for cleaner timeline view
            .replace(/https?:\/\/[^\s]+/g, '[link]')
            // Remove phone numbers in common formats
            .replace(/\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, '[phone]')
            // Remove German/international artifacts
            .replace(/Von:\s*/gi, '')
            .replace(/Gesendet:\s*/gi, '')
            .replace(/An:\s*/gi, '')
            .replace(/Betreff:\s*/gi, '')
            // Clean up punctuation
            .replace(/[.]{3,}/g, '...')
            // Remove standalone punctuation
            .replace(/^\s*[.,;:]\s*/g, '')
            .trim();
          return cleanedHtml;
        }
        
        let body = e.body_preview || e.bodyPreview || '';
        
        // If we have HTML content, clean it properly
        if (body) {
          body = cleanEmailBody(body);
        }
        
        // Fallback to subject if no body content
        if (!body || body.trim().length === 0) {
          body = e.subject || 'Email received';
        }
        
        // Truncate for timeline display
        if (body.length > 150) {
          body = body.slice(0, 150) + '...';
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
          subject: e.subject || '', // <-- add subject here
          observation: e.observation || '',
          editable: true,
          status: e.status,
        };
      });
      // 3. WhatsApp messages from DB
      let whatsAppDbMessages: any[] = [];
      if (client?.id) {
        const { data, error } = await supabase
          .from('whatsapp_messages')
          .select('*')
          .eq('lead_id', client.id)
          .order('sent_at', { ascending: true });
        if (!error && data) {
          whatsAppDbMessages = data.map((msg: any) => ({
            id: msg.id,
            date: new Date(msg.sent_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }),
            time: new Date(msg.sent_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            raw_date: msg.sent_at,
            employee: msg.sender_name || 'You',
            direction: msg.direction,
            kind: 'whatsapp',
            length: '',
            content: msg.message,
            observation: '',
            editable: false,
          }));
        }
      }
      // Combine all
      const combined = [...manualInteractions, ...emailInteractions, ...whatsAppDbMessages];
      const sorted = combined.sort((a, b) => new Date(b.raw_date).getTime() - new Date(a.raw_date).getTime());
      if (isMounted) setInteractions(sorted as Interaction[]);
      // Also update the local emails state for the modal
      const formattedEmailsForModal = clientEmails.map((e: any) => ({
        id: e.message_id,
        subject: e.subject,
        from: e.sender_email,
        to: e.recipient_list,
        date: e.sent_at,
        bodyPreview: e.body_preview || e.subject,
        direction: e.direction,
        attachments: e.attachments,
      }));
      if (isMounted) setEmails(formattedEmailsForModal);
    }
    fetchAndCombineInteractions();
    return () => { isMounted = false; };
  }, [client, currentUserFullName, whatsAppMessages.length]);

  // This function now ONLY syncs with Graph and then triggers a full refresh
  const runGraphSync = useCallback(async () => {
    if (!client.email || !instance || !accounts[0]) return;
    
    setEmailsLoading(true);

    try {
      const tokenResponse = await acquireToken(instance, accounts[0]);
      await syncClientEmails(tokenResponse.accessToken, client);
      if (onClientUpdate) {
        await onClientUpdate(); // Refresh all client data from parent
      }
    } catch (e) {
      console.error("Graph sync failed:", e);
      toast.error("Failed to sync new emails from server.");
    } finally {
      setEmailsLoading(false);
    }
  }, [client, instance, accounts, onClientUpdate]);

  // Effect to run the slow sync only once when the component mounts
  useEffect(() => {
    runGraphSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only once

  const handleSendEmail = async () => {
    if (!client.email || !instance || !accounts[0]) return;
    setSending(true);
    const account = accounts[0];

    try {
      const tokenResponse = await acquireToken(instance, account);
      const senderName = account?.name || 'Your Team';

      // 1. Send email via Graph API.
      await sendClientEmail(
        tokenResponse.accessToken, 
        composeSubject, 
        composeBody, 
        client, 
        senderName,
        composeAttachments
      );
      toast.success('Email sent and saved!');
      
      // After sending, trigger a sync to get the new email
      await runGraphSync();

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
    }
  }, [isEmailModalOpen, client]);

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
          
          const { error } = await supabase
            .from('leads')
            .update({ manual_interactions: allManualInteractions })
            .eq('id', client.id);
          if (error) throw error;
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

    const now = new Date();
    const newInteraction: Interaction = {
      id: `manual_${now.getTime()}`,
      date: newContact.date || now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }),
      time: newContact.time || now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      raw_date: now.toISOString(),
      employee: currentUserFullName || 'You',
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
      const existingInteractions = client.manual_interactions || [];
      const updatedInteractions = [...existingInteractions, newInteraction];

      const { error: updateError } = await supabase
        .from('leads')
        .update({ manual_interactions: updatedInteractions })
        .eq('id', client.id);

      if (updateError) throw updateError;
      
      toast.success('Interaction saved!');
      if (onClientUpdate) await onClientUpdate(); // Silently refresh data

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
  }, [isWhatsAppOpen, whatsAppMessages, client.id]);


  return (
    <div className="p-3 md:p-8 flex flex-col lg:flex-row gap-4 md:gap-8 items-start min-h-screen">
      <div className="relative w-full flex-1 min-w-0">
        {/* Header with Contact Client Dropdown and AI Smart Recap */}
        <div className="w-full flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-8">
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
              // Toggle AI summary panel on mobile, or scroll to it on desktop
              if (window.innerWidth < 1024) {
                // Mobile: show drawer with AI summary
                setAiDrawerOpen(true);
              } else {
                // Desktop: scroll to AI panel
                const aiPanel = document.querySelector('.ai-summary-panel');
                if (aiPanel) {
                  aiPanel.scrollIntoView({ behavior: 'smooth' });
                }
              }
            }}
          >
            <SparklesIcon className="w-5 h-5" />
            AI Smart Recap
          </button>
        </div>
        
        {/* Timeline container with proper mobile layout */}
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-6 md:left-8 top-0 bottom-0 w-0.5 md:w-1 bg-gradient-to-b from-primary via-accent to-secondary" style={{ zIndex: 0 }} />
          
          <div className="space-y-8 md:space-y-12">
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
                  icon = <ChatBubbleLeftRightIcon className="w-4 h-4 md:w-5 md:h-5 text-white" />;
                  iconBg = 'bg-purple-300';
                } else if (row.kind === 'call') {
                  icon = <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 text-yellow-700" />;
                  iconBg = 'bg-yellow-100';
                } else if (row.kind === 'whatsapp') {
                  icon = <FaWhatsapp className="w-4 h-4 md:w-5 md:h-5 text-green-700" />;
                  iconBg = 'bg-green-100';
                } else if (row.kind === 'email') {
                  icon = <EnvelopeIcon className="w-4 h-4 md:w-5 md:h-5 text-blue-700" />;
                  iconBg = 'bg-blue-100';
                } else if (row.kind === 'office') {
                  icon = <UserIcon className="w-4 h-4 md:w-5 md:h-5 text-orange-700" />;
                  iconBg = 'bg-orange-100';
                } else {
                  icon = <UserIcon className="w-4 h-4 md:w-5 md:h-5 text-gray-500" />;
                  iconBg = 'bg-gray-200';
                }
                cardBg = 'bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600';
                textGradient = 'bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 bg-clip-text text-transparent';
                avatarBg = 'bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white';
              } else {
                // Client (Ingoing)
                if (row.kind === 'sms') {
                  icon = <ChatBubbleLeftRightIcon className="w-4 h-4 md:w-5 md:h-5 text-white" />;
                  iconBg = 'bg-purple-300';
                } else if (row.kind === 'call') {
                  icon = <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 text-yellow-700" />;
                  iconBg = 'bg-yellow-100';
                } else if (row.kind === 'whatsapp') {
                  icon = <FaWhatsapp className="w-4 h-4 md:w-5 md:h-5 text-green-700" />;
                  iconBg = 'bg-green-100';
                } else if (row.kind === 'email') {
                  icon = <EnvelopeIcon className="w-4 h-4 md:w-5 md:h-5 text-blue-700" />;
                  iconBg = 'bg-blue-100';
                } else if (row.kind === 'office') {
                  icon = <UserIcon className="w-4 h-4 md:w-5 md:h-5 text-orange-700" />;
                  iconBg = 'bg-orange-100';
                } else {
                  icon = <UserIcon className="w-4 h-4 md:w-5 md:h-5 text-gray-500" />;
                  iconBg = 'bg-gray-200';
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
                  className="relative pl-16 md:pl-20 cursor-pointer group"
                  onClick={async () => { await openEditDrawer(idx); }}
                >
                  {/* Timeline dot and icon, large, left-aligned */}
                  <div className="absolute -left-6 md:-left-8 top-0" style={{ zIndex: 2 }}>
                    <div className={`w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center shadow-lg ring-2 ring-white ${iconBg}`}>
                      {React.cloneElement(icon, { className: 'w-6 h-6 md:w-8 md:h-8' })}
                    </div>
                  </div>
                  {/* Timestamp above the card */}
                  <div className="mb-2">
                    <div className="text-xs md:text-sm font-semibold text-gray-600">{day} {month}, {time}</div>
                  </div>
                  {/* Card - Mobile optimized */}
                  <div className="w-full pr-3 md:pr-6">
                    <div className={`p-[1px] rounded-xl ${cardBg} shadow-xl hover:shadow-2xl transition-all duration-200`}>
                      <div className="bg-white rounded-xl p-3 md:p-4">
                        <div className="flex items-center gap-3 mb-2">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${avatarBg} text-sm`}>
                            {initials}
                          </div>
                          <div className={`font-semibold text-sm md:text-base ${textGradient} truncate`}>
                            {row.employee}
                          </div>
                        </div>
                        
                        <div className="flex flex-wrap gap-1 text-xs mb-2">
                          {row.status && (
                            <span className={`px-2 py-1 rounded-full font-medium shadow-sm ${cardBg} text-white ${row.status.toLowerCase().includes('not') ? 'opacity-80' : ''}`}>
                              {row.status}
                            </span>
                          )}
                          {row.length && row.length !== 'm' && (
                            <span className={`px-2 py-1 rounded-full font-medium shadow-sm ${cardBg} text-white`}>
                              {row.length}
                            </span>
                          )}
                        </div>
                        
                        {row.content && (
                          <div className="text-xs md:text-sm text-gray-700 break-words overflow-hidden">
                            {/* Subject in bold with colon, then body with spacing */}
                            {row.subject ? (
                              <>
                                <span className="font-bold mr-1">{row.subject}:</span>
                                <br />
                                <span className="ml-1">
                                  {typeof row.content === 'string'
                                    ? row.content.replace(new RegExp(`^${row.subject}\s*:?[\s\-]*`, 'i'), '').trim()
                                    : row.content}
                                </span>
                              </>
                            ) : (
                              <span>{row.content}</span>
                            )}
                          </div>
                        )}
                        
                        {row.observation && (
                          <div className="mt-2 text-xs text-gray-500 break-words overflow-hidden">
                            <span className="font-medium">Note:</span> <span className="line-clamp-1">{row.observation}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {/* Right-side AI summary panel (hidden on mobile, sticky on desktop) */}
      <div className="hidden lg:block w-full max-w-sm ai-summary-panel">
        <AISummaryPanel messages={aiSummaryMessages} />
      </div>
      {/* Email Thread Modal (mobile-friendly) */}
      {isEmailModalOpen && createPortal(
        <div className="fixed inset-0 bg-black/50 z-[999] flex items-start justify-center">
          <div className="bg-base-100 w-screen h-screen max-w-none max-h-none flex flex-col overflow-hidden">
            {/* Header - Mobile optimized */}
            <div className="flex flex-col gap-3 p-3 md:p-4 border-b border-base-300 bg-white">
              <div className="flex items-center justify-between">
                <h3 className="text-lg md:text-xl font-bold truncate">Email Thread with {client.name}</h3>
                <button className="btn btn-ghost btn-sm btn-circle" onClick={() => setIsEmailModalOpen(false)}>
                  <XMarkIcon className="w-5 h-5 md:w-6 md:h-6" />
                </button>
              </div>
              
              {/* Subject input - Full width on mobile */}
              <input
                type="text"
                className="input input-bordered w-full text-sm md:text-base"
                value={composeSubject}
                onChange={e => setComposeSubject(e.target.value)}
                placeholder="Subject"
              />
              
              {/* Templates - Scrollable on mobile */}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {emailTemplates.map(template => (
                  <button
                    key={template.name}
                    className="btn btn-outline btn-xs md:btn-sm whitespace-nowrap flex-shrink-0"
                    onClick={() => {
                      const uploadLink = 'https://portal.example.com/upload'; // Placeholder
                      const processedBody = template.body
                          .replace(/{client_name}/g, client.name)
                          .replace(/{upload_link}/g, uploadLink);
                      const newSubject = `[${client.lead_number}] - ${client.name} - ${client.topic || ''}`;
                      setComposeBody(processedBody);
                      setComposeSubject(newSubject);
                    }}
                  >
                    {template.name}
                  </button>
                ))}
              </div>
            </div>
            {/* Conversation Body - Mobile optimized */}
            <div ref={(el) => {
              if (el && activeEmailId) {
                const targetEmail = el.querySelector(`[data-email-id="${activeEmailId}"]`);
                if (targetEmail) {
                  targetEmail.classList.add('ring-2', 'ring-primary');
                  targetEmail.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  setTimeout(() => targetEmail.classList.remove('ring-2', 'ring-primary'), 1200);
                }
                setActiveEmailId(null); // Reset after scrolling
              }
            }} className="flex-1 overflow-y-auto p-3 md:p-6 space-y-4 md:space-y-6">
              {emailsLoading ? (
                <div className="text-center p-8">Loading email history...</div>
              ) : emails.length === 0 ? (
                <div className="text-center p-8 text-base-content/70">No emails found for this client.</div>
              ) : (
                [...emails]
                  .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                  .map(email => (
                    <div 
                      key={email.id} 
                      data-email-id={email.id}
                      className={`flex items-end gap-2 md:gap-3 ${email.direction === 'outgoing' ? 'flex-row-reverse' : ''}`}
                    >
                      <div className={`avatar placeholder ${email.direction === 'outgoing' ? 'hidden' : ''}`}>
                        <div className="bg-neutral-focus text-neutral-content rounded-full w-8 h-8 md:w-10 md:h-10">
                          <span className="text-xs md:text-sm">{client.name.charAt(0)}</span>
                        </div>
                      </div>
                      <div className={`max-w-[85%] md:max-w-2xl break-words rounded-2xl p-3 md:p-4 ${email.direction === 'outgoing' ? 'bg-primary text-white' : 'bg-base-200'}`}>
                        <div className="flex flex-col md:flex-row md:justify-between md:items-center text-xs opacity-70 mb-2 gap-1">
                          <span className="font-bold truncate">{email.from}</span>
                          <span className="text-xs">{new Date(email.date).toLocaleDateString()} {new Date(email.date).toLocaleTimeString()}</span>
                        </div>
                        <div className="font-bold mb-2 text-sm md:text-base">{email.subject}</div>
                        <div className="prose prose-sm md:prose max-w-none text-xs md:text-sm" dangerouslySetInnerHTML={{ 
                          __html: sanitizeEmailHtml(stripSignatureAndQuotedText(email.bodyPreview || '')) 
                        }} />
                        {/* Attachments */}
                        {email.attachments && email.attachments.length > 0 && (
                          <div className="mt-3 pt-2 border-t border-black/10">
                            <h4 className="font-semibold text-xs mb-2">Attachments:</h4>
                            <div className="flex flex-wrap gap-1 md:gap-2">
                              {email.attachments.map((att: Attachment) => (
                                <button 
                                  key={att.id}
                                  className="btn btn-outline btn-xs gap-1 text-xs"
                                  onClick={() => handleDownloadAttachment(email.id, att)}
                                  disabled={downloadingAttachments[att.id]}
                                >
                                  {downloadingAttachments[att.id] ? (
                                    <span className="loading loading-spinner loading-xs" />
                                  ) : (
                                    <PaperClipIcon className="w-3 h-3" />
                                  )}
                                  <span className="truncate max-w-[100px]">{att.name}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
              )}
            </div>
            
            {/* Mobile-friendly compose form */}
            <form
              className="flex flex-col gap-3 p-3 md:p-4 border-t border-gray-200 bg-white"
              onSubmit={e => { e.preventDefault(); handleSendEmail(); setBodyFocused(false); }}
            >
              {/* To field - hidden on mobile, visible on desktop */}
              <div className="hidden md:block">
                <input type="text" className="input input-bordered w-full" value={client.email} disabled />
              </div>
              
              {/* Compose editor */}
              <div className="flex-1">
                <ReactQuill
                  ref={quillRef}
                  value={composeBody}
                  onChange={setComposeBody}
                  onFocus={() => setBodyFocused(true)}
                  onBlur={() => setBodyFocused(false)}
                  placeholder="Write your email here..."
                  style={{
                    minHeight: bodyFocused ? 200 : 100,
                    maxHeight: 300,
                    background: 'white',
                    borderRadius: 12,
                    border: '1.5px solid #e3dbfa',
                    boxShadow: bodyFocused ? '0 0 0 2px #a78bfa, 0 2px 16px 0 rgba(59,40,199,0.08)' : 'none',
                    fontSize: 14,
                    fontFamily: 'system-ui, Arial, sans-serif',
                    lineHeight: 1.6,
                  }}
                  modules={{
                    toolbar: [
                      ['bold', 'italic', 'underline'],
                      [{ list: 'ordered' }, { list: 'bullet' }],
                      ['link'],
                      ['clean'],
                    ],
                  }}
                  theme="snow"
                />
              </div>
              
              {/* Attachments and send */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <label htmlFor="file-upload" className="btn btn-outline btn-sm">
                    <PaperClipIcon className="w-4 h-4" />
                    <span className="hidden md:inline ml-1">Attach</span>
                  </label>
                  <input id="file-upload" type="file" className="hidden" onChange={e => e.target.files && handleAttachmentUpload(e.target.files)} />
                  
                  {/* Show attached files count on mobile */}
                  {composeAttachments.length > 0 && (
                    <span className="text-xs text-gray-500">
                      {composeAttachments.length} file{composeAttachments.length > 1 ? 's' : ''} attached
                    </span>
                  )}
                </div>
                
                <button type="submit" className="btn btn-primary" disabled={sending}>
                  {sending ? (
                    <>
                      <span className="loading loading-spinner loading-sm"></span>
                      <span className="hidden md:inline ml-2">Sending...</span>
                    </>
                  ) : (
                    <>
                      <PaperAirplaneIcon className="w-4 h-4" />
                      <span className="hidden md:inline ml-2">Send</span>
                    </>
                  )}
                </button>
              </div>
              
              {/* Show attached files on desktop */}
              {composeAttachments.length > 0 && (
                <div className="hidden md:flex flex-wrap gap-2">
                  {composeAttachments.map((att, index) => (
                    <div key={index} className="flex items-center gap-2 text-xs bg-base-200 rounded-lg px-3 py-2">
                      <span className="truncate max-w-[200px]">{att.name}</span>
                      <button type="button" className="btn btn-ghost btn-xs p-0" onClick={() => setComposeAttachments(prev => prev.filter(a => a.name !== att.name))}>
                        <XMarkIcon className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </form>
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
      {isWhatsAppOpen && createPortal(
        <div className="fixed inset-0 z-[999] flex flex-col bg-white w-full h-full max-w-none max-h-none">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-base-200 bg-white">
            <h3 className="text-xl font-bold">WhatsApp Chat with {client.name}</h3>
            <button className="btn btn-ghost btn-sm" onClick={handleWhatsAppClose}>
              <XMarkIcon className="w-6 h-6" />
            </button>
          </div>
          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto flex flex-col w-full min-h-20 p-8">
            {whatsAppMessages.length === 0 ? (
              <div className="text-center p-8 text-base-content/70">
                No WhatsApp messages found for this client.<br/>
                <span className="text-xs text-error">(Debug: client.id = {client.id})</span>
              </div>
            ) : (
              whatsAppMessages.map((msg: any, idx: number) => (
                <div key={msg.id || idx} className={`flex ${msg.direction === 'out' ? 'justify-end' : 'justify-start'} w-full mb-2`}>
                  <div className={
                    `rounded-2xl px-6 py-3 shadow text-base max-w-[70%] break-words ` +
                    (msg.direction === 'out'
                      ? 'bg-primary text-white self-end'
                      : 'bg-base-200 text-black self-start border border-base-200')
                  }>
                    {msg.message}
                    <div className="flex items-center gap-1 mt-2 text-xs opacity-70 justify-end">
                      <span>{msg.time || (msg.sent_at ? new Date(msg.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')}</span>
                      {msg.direction === 'out' && (
                        <span className="inline-block align-middle">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-blue-200" style={{ display: 'inline' }}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          {/* Input Area */}
          <form className="flex items-center gap-2 px-6 py-4 border-t border-base-200 bg-white" style={{ minHeight: 72 }} onSubmit={handleSendWhatsApp}>
            <button type="button" className="btn btn-ghost btn-circle">
              <FaceSmileIcon className="w-6 h-6 text-gray-500" />
            </button>
            <button type="button" className="btn btn-ghost btn-circle">
              <PaperClipIcon className="w-6 h-6 text-gray-500" />
            </button>
            <input
              type="text"
              className="input input-bordered flex-1 rounded-full"
              placeholder="Type your message..."
              value={whatsAppInput}
              onChange={e => setWhatsAppInput(e.target.value)}
            />
            <button type="submit" className="btn btn-primary btn-circle">
              <PaperAirplaneIcon className="w-6 h-6" />
            </button>
          </form>
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