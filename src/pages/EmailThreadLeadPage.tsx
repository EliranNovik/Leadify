import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { appendEmailSignature } from '../lib/emailSignature';
import { sendEmailViaBackend, downloadAttachmentFromBackend, fetchEmailBodyFromBackend } from '../lib/mailboxApi';
import {
  MagnifyingGlassIcon,
  XMarkIcon,
  PhoneIcon,
  UserPlusIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  DocumentTextIcon,
  ChevronDownIcon,
  UserGroupIcon,
  LinkIcon,
  EnvelopeIcon,
  PaperAirplaneIcon,
  PaperClipIcon,
  PlusIcon,
  SparklesIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import {
  buildComposeDraft,
  resolveEmailDeleteFilter,
  type EmailComposeMode,
} from '../lib/interactions/emailComposeActions';

interface EmailLead {
  id: string;
  sender_name: string;
  sender_email: string;
  message_count: number;
  unread_count: number;
  last_message_at: string;
  last_subject: string;
  last_message_preview: string;
}

interface EmailMessage {
  id: string;
  message_id: string;
  db_id?: string | number;
  subject: string;
  body_html: string | null;
  body_preview: string | null;
  sender_name: string;
  sender_email: string;
  recipient_list: string;
  sent_at: string;
  direction: 'incoming' | 'outgoing';
  attachments?: any[];
}

/** Hebrew + common Hebrew presentation forms in HTML email */
const HEBREW_CHAR_RE = /[\u0590-\u05FF\uFB1D-\uFB4F]/;

function stripTagsForRtl(text: string) {
  return (text || '').replace(/<[^>]*>/g, ' ');
}

/** True if any snippet contains Hebrew — used for RTL / logical end alignment of email boxes */
function emailContentLikelyHebrew(...parts: (string | null | undefined)[]) {
  const combined = parts.filter(Boolean).join('\n');
  const plain = stripTagsForRtl(combined);
  return plain.trim().length > 0 && HEBREW_CHAR_RE.test(plain);
}

/** Sidepanel subject line — keep list scannable */
function truncateSidepanelTitle(value: string | null | undefined, max = 20): string {
  const text = String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'No Subject';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

const OFFICE_THREAD_LIST_SELECT =
  'id, message_id, sender_name, sender_email, recipient_list, subject, body_preview, sent_at, direction, attachments, client_id, legacy_id, contact_id';

function asJsonArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

const EmailThreadLeadPage: React.FC = () => {
  const [leads, setLeads] = useState<EmailLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLead, setSelectedLead] = useState<EmailLead | null>(null);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Dropdown and lead selection state
  const [showActionDropdown, setShowActionDropdown] = useState(false);
  const [showConnectedLeadsDropdown, setShowConnectedLeadsDropdown] = useState(false);
  const [showLeadSearchModal, setShowLeadSearchModal] = useState(false);
  const [leadSearchQuery, setLeadSearchQuery] = useState('');
  const [leadSearchResults, setLeadSearchResults] = useState<any[]>([]);
  const [isSearchingLeads, setIsSearchingLeads] = useState(false);
  const [actionType, setActionType] = useState<'sublead' | 'contact' | null>(null);

  // Connected leads and contacts state
  const [connectedLeads, setConnectedLeads] = useState<Array<{ id: string; lead_number: string; name: string; isLegacy: boolean }>>([]);
  const [connectedContacts, setConnectedContacts] = useState<Array<{ id: number; name: string; lead_number: string; isLegacy: boolean }>>([]);
  const [isLoadingConnections, setIsLoadingConnections] = useState(false);
  // Map to track which leads have connections (email -> boolean)
  const [leadsWithConnections, setLeadsWithConnections] = useState<Map<string, boolean>>(new Map());

  // Composer state
  const [newMessage, setNewMessage] = useState('');
  const [subject, setSubject] = useState('');
  const [composeToRecipients, setComposeToRecipients] = useState<string[]>([]);
  const [composeCcRecipients, setComposeCcRecipients] = useState<string[]>([]);
  const [composeMode, setComposeMode] = useState<EmailComposeMode | 'reply'>('reply');
  const [isSending, setIsSending] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [showAISuggestions, setShowAISuggestions] = useState(false);
  const [showSubjectInput, setShowSubjectInput] = useState(false);
  const [downloadingAttachments, setDownloadingAttachments] = useState<Record<string, boolean>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>('');
  const [currentUserFullName, setCurrentUserFullName] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const subjectInputRef = useRef<HTMLInputElement>(null);

  const dispatchEmailUnreadCount = useCallback(async () => {
    try {
      // Bounded count — full-table ilike+count times out on large emails tables.
      const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { count, error } = await supabase
        .from('emails')
        .select('id', { count: 'exact', head: true })
        .eq('direction', 'incoming')
        .is('is_read', false)
        .ilike('recipient_list', '%office@lawoffice.org.il%')
        .gte('sent_at', sinceIso);

      if (error) {
        // null unread (is_read IS NULL) — try IS NOT TRUE via or, still date-bounded
        const { count: count2, error: error2 } = await supabase
          .from('emails')
          .select('id', { count: 'exact', head: true })
          .eq('direction', 'incoming')
          .or('is_read.is.null,is_read.eq.false')
          .ilike('recipient_list', '%office@lawoffice.org.il%')
          .gte('sent_at', sinceIso);
        if (error2) {
          console.error('Error fetching unread email count:', error2);
          return;
        }
        window.dispatchEvent(
          new CustomEvent<{ count: number }>('email:unread-count', {
            detail: { count: count2 || 0 },
          })
        );
        return;
      }

      window.dispatchEvent(
        new CustomEvent<{ count: number }>('email:unread-count', {
          detail: { count: count || 0 },
        })
      );
    } catch (error) {
      console.error('Unexpected error dispatching unread email count:', error);
    }
  }, []);

  const markEmailsAsRead = useCallback(
    async (senderEmail?: string | null) => {
      if (!senderEmail) return;

      try {
        // Indexed sender_email only — never recipient_list ILIKE (times out on this table).
        const { error } = await supabase
          .from('emails')
          .update({
            is_read: true,
            read_at: new Date().toISOString(),
            read_by: null,
          })
          .eq('direction', 'incoming')
          .ilike('sender_email', senderEmail)
          .or('is_read.is.null,is_read.eq.false');

        if (error) {
          if (error.code === '42501' && error.message?.includes('pending_stage_evaluations')) {
            console.warn('⚠️ Could not mark emails as read in database (trigger permission issue), but UI will update correctly');
          } else {
            console.error('Error marking emails as read:', error);
          }
        }

        const normalizedEmail = senderEmail.toLowerCase();
        setLeads(prev =>
          prev.map(lead =>
            (lead.sender_email || '').toLowerCase() === normalizedEmail
              ? { ...lead, unread_count: 0 }
              : lead
          )
        );
        void dispatchEmailUnreadCount();
      } catch (error) {
        console.error('Unexpected error marking emails as read:', error);
        const normalizedEmail = senderEmail.toLowerCase();
        setLeads(prev =>
          prev.map(lead =>
            (lead.sender_email || '').toLowerCase() === normalizedEmail
              ? { ...lead, unread_count: 0 }
              : lead
          )
        );
      }
    },
    [dispatchEmailUnreadCount]
  );

  const readFileAsBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        if (!base64) {
          reject(new Error(`Failed to encode ${file.name}`));
          return;
        }
        resolve(base64);
      };
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsDataURL(file);
    });

  const mapAttachmentsForBackend = async (files: File[]) => {
    const encoded: { name: string; contentType?: string; contentBytes: string }[] = [];
    for (const file of files) {
      const contentBytes = await readFileAsBase64(file);
      encoded.push({
        name: file.name,
        contentType: file.type || 'application/octet-stream',
        contentBytes,
      });
    }
    return encoded;
  };

  // Mobile detection
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const loadCurrentUser = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const authUser = data?.user;
        if (authUser) {
          setUserId(authUser.id);
          setUserEmail(authUser.email || '');
          const { data: userRow } = await supabase
            .from('users')
            .select('full_name')
            .eq('auth_id', authUser.id)
            .maybeSingle();
          if (userRow?.full_name) {
            setCurrentUserFullName(userRow.full_name);
          } else if (authUser.user_metadata?.full_name) {
            setCurrentUserFullName(authUser.user_metadata.full_name);
          } else if (authUser.email) {
            setCurrentUserFullName(authUser.email);
          }
        }
      } catch (error) {
        console.error('Failed to load user info:', error);
      }
    };
    loadCurrentUser();
  }, []);

  // Blocked sender emails to ignore
  const BLOCKED_SENDER_EMAILS = new Set([
    'wordpress@german-and-austrian-citizenship.lawoffice.org.il',
    'wordpress@insolvency-law.com',
    'wordpress@citizenship-for-children.usa-immigration.lawyer',
    'lawoffic@israel160.jetserver.net',
    'list@wordfence.com',
    'wordpress@usa-immigration.lawyer',
    'wordpress@heritage-based-european-citizenship.lawoffice.org.il',
    'wordpress@heritage-based-european-citizenship-heb.lawoffice.org.il',
    'no-reply@lawzana.com',
    'support@lawfirms1.com',
    'no-reply@zoom.us',
    'info@israel-properties.com',
    'notifications@invoice4u.co.il',
    'isetbeforeyou@yahoo.com',
    'no-reply@support.microsoft.com',
    'ivy@pipe.hnssd.com',
    'no-reply@mail.instagram.com',
    'no_reply@email.apple.com',
    'noreplay@maskyoo.co.il',
    'email@german-and-austrian-citizenship.lawoffice.org.il',
    'noreply@mobilepunch.com',
    'notification@facebookmail.com',
    'news@events.imhbusiness.com',
    'khawaish@usareaimmigrationservices.com',
    'message@shidurit.com',
    'contact@legalimmigrationisrael.com',
    'sales@newfrontiersenergy.com',
    'marketing@unsplash.com',
    'info@citizensinternational.com',
    'ir@2961969.brevosend.com',
    'marketing@crocoblock.com',
    'info@crocoblock.com',
    'artalegal@googlegroups.com',
    'alljobs@alljob.co.il',
    'jay@tlvsalon.com',
  ]);

  // Blocked domains to ignore (add domain names here, e.g., 'example.com')
  const BLOCKED_DOMAINS: string[] = [
    'lawoffice.org.il',
  ];

  // Helper function to check if an email should be blocked
  const isEmailBlocked = (email: string): boolean => {
    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail) return true;

    // Check if email is in blocked list
    if (BLOCKED_SENDER_EMAILS.has(normalizedEmail)) {
      return true;
    }

    // Check if email domain is blocked
    const emailDomain = normalizedEmail.split('@')[1];
    if (emailDomain && BLOCKED_DOMAINS.some(domain => emailDomain === domain || emailDomain.endsWith(`.${domain}`))) {
      return true;
    }

    return false;
  };

  // Derive connection badges from data we already have (no extra emails table scan).
  const checkConnectionsForAllLeads = useCallback(async (leadsList: EmailLead[], emailsSnapshot?: any[]) => {
    if (!leadsList || leadsList.length === 0) return;

    try {
      const connectionsMap = new Map<string, boolean>();

      if (Array.isArray(emailsSnapshot) && emailsSnapshot.length > 0) {
        const linkedSenders = new Set<string>();
        emailsSnapshot.forEach((email: any) => {
          const sender = String(email.sender_email || '').toLowerCase().trim();
          if (!sender) return;
          if (email.client_id || email.legacy_id || email.contact_id) {
            linkedSenders.add(sender);
          }
        });
        leadsList.forEach((lead) => {
          const key = lead.sender_email?.toLowerCase() || lead.id;
          connectionsMap.set(lead.id, linkedSenders.has(key));
        });
      } else {
        // Lightweight fallback: indexed sender_email only (no recipient_list ILIKE).
        const senderEmails = Array.from(
          new Set(leadsList.map((lead) => lead.sender_email).filter(Boolean)),
        ).slice(0, 40);
        if (senderEmails.length === 0) return;

        const sinceIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
        const { data: emailsData, error: emailsError } = await supabase
          .from('emails')
          .select('sender_email, client_id, legacy_id, contact_id')
          .in('sender_email', senderEmails)
          .gte('sent_at', sinceIso)
          .limit(800);

        if (emailsError) {
          console.error('Error checking connections for leads:', emailsError);
          return;
        }

        const linkedSenders = new Set<string>();
        (emailsData || []).forEach((email: any) => {
          if (!(email.client_id || email.legacy_id || email.contact_id)) return;
          const sender = String(email.sender_email || '').toLowerCase().trim();
          if (sender) linkedSenders.add(sender);
        });
        leadsList.forEach((lead) => {
          const key = lead.sender_email?.toLowerCase() || lead.id;
          connectionsMap.set(lead.id, linkedSenders.has(key));
        });
      }

      setLeadsWithConnections((prev) => {
        const merged = new Map(prev);
        connectionsMap.forEach((hasConnections, leadId) => {
          merged.set(leadId, hasConnections);
        });
        return merged;
      });
    } catch (error) {
      console.error('Error checking connections for all leads:', error);
    }
  }, []);

  // Fetch email leads (grouped by sender email)
  useEffect(() => {
    const fetchEmailLeads = async () => {
      try {
        setLoading(true);

        // Prefer sent_at-first RPC (no driving ILIKE). Fallback: recent incoming, filter office@ in JS.
        const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        let emailsData: any[] | null = null;
        let emailsError: { message?: string; code?: string } | null = null;

        const rpcResult = await supabase.rpc('email_office_inbox_recent', {
          p_days: 30,
          p_limit: 400,
        });

        const rpcTimedOut =
          String(rpcResult.error?.code || '') === '57014' ||
          String(rpcResult.error?.message || '').toLowerCase().includes('statement timeout');

        if (!rpcResult.error) {
          if (Array.isArray(rpcResult.data)) {
            emailsData = rpcResult.data;
          } else if (typeof rpcResult.data === 'string') {
            try {
              const parsed = JSON.parse(rpcResult.data);
              emailsData = Array.isArray(parsed) ? parsed : [];
            } catch {
              emailsData = [];
            }
          } else {
            emailsData = [];
          }
        } else if (rpcTimedOut) {
          emailsError = rpcResult.error;
        } else {
          const direct = await supabase
            .from('emails')
            .select(
              'id, message_id, sender_name, sender_email, recipient_list, subject, body_preview, sent_at, direction, is_read, client_id, legacy_id, contact_id'
            )
            .eq('direction', 'incoming')
            .gte('sent_at', sinceIso)
            .order('sent_at', { ascending: false })
            .limit(2000);
          if (direct.error) {
            emailsError = direct.error;
          } else {
            emailsData = (direct.data || []).filter((email: any) =>
              String(email.recipient_list || '')
                .toLowerCase()
                .includes('office@lawoffice.org.il'),
            );
          }
        }

        if (emailsError) {
          console.error('Error fetching emails:', emailsError);
          toast.error('Failed to load email leads');
          return;
        }

        // Log summary to verify we're getting all emails
        const linkedCount = (emailsData || []).filter(e => e.client_id || e.legacy_id || e.contact_id).length;
        const unlinkedCount = (emailsData || []).filter(e => !e.client_id && !e.legacy_id && !e.contact_id).length;
        console.log(`📧 Fetched ${emailsData?.length || 0} emails to office@lawoffice.org.il (${linkedCount} linked, ${unlinkedCount} unlinked)`);

        // Group emails by sender_email
        const leadsMap = new Map<string, EmailLead>();
        let blockedCount = 0;
        let noSenderCount = 0;
        const blockedSenders = new Map<string, number>(); // Track which senders are being blocked

        (emailsData || []).forEach((email: any) => {
          const senderEmail = email.sender_email?.toLowerCase() || '';
          if (!senderEmail) {
            noSenderCount++;
            return;
          }

          // Skip blocked sender emails and domains
          if (isEmailBlocked(senderEmail)) {
            blockedCount++;
            const domain = senderEmail.split('@')[1] || 'unknown';
            blockedSenders.set(domain, (blockedSenders.get(domain) || 0) + 1);
            return;
          }

          if (!leadsMap.has(senderEmail)) {
            leadsMap.set(senderEmail, {
              id: senderEmail,
              sender_name: email.sender_name || senderEmail.split('@')[0],
              sender_email: email.sender_email || senderEmail,
              message_count: 0,
              unread_count: 0,
              last_message_at: email.sent_at,
              last_subject: email.subject || 'No Subject',
              last_message_preview: email.body_preview || '',
            });
          }

          const lead = leadsMap.get(senderEmail)!;
          lead.message_count++;
          if (!email.is_read) {
            lead.unread_count++;
          }

          // Update last message if this is more recent
          if (new Date(email.sent_at) > new Date(lead.last_message_at)) {
            lead.last_message_at = email.sent_at;
            lead.last_subject = email.subject || 'No Subject';
            lead.last_message_preview = email.body_preview || email.body_html || '';
          }
        });

        const leadsList = Array.from(leadsMap.values())
          .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());

        console.log(`📊 Email grouping summary: ${leadsList.length} unique senders, ${blockedCount} blocked, ${noSenderCount} no sender email`);
        console.log(`📊 Total processed: ${leadsList.length} leads from ${emailsData?.length || 0} emails`);

        // Log blocked domains to help debug
        if (blockedCount > 0) {
          const topBlockedDomains = Array.from(blockedSenders.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
          console.log(`🚫 Top blocked domains:`, topBlockedDomains.map(([domain, count]) => `${domain}: ${count}`).join(', '));
        }

        setLeads(leadsList);

        // Check connections from the inbox rows we already fetched (no second scan)
        checkConnectionsForAllLeads(leadsList, emailsData || []);
      } catch (error) {
        console.error('Error fetching email leads:', error);
        toast.error('Failed to load email leads');
      } finally {
        setLoading(false);
      }
    };

    fetchEmailLeads();
  }, [checkConnectionsForAllLeads]);

  // Filter leads based on search
  const filteredLeads = leads.filter(lead =>
    lead.sender_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lead.sender_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lead.last_subject?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const fetchMessages = useCallback(async () => {
    if (!selectedLead) {
      setMessages([]);
      setChatLoading(false);
      return;
    }

    const leadEmail = selectedLead.sender_email.toLowerCase().trim();

    try {
      setChatLoading(true);
      setMessages([]);

      const formatMessage = (email: any, dbId: string | number): EmailMessage & { _dbId: string | number } => {
        let parsedAttachments: any[] = [];
        if (email.attachments) {
          try {
            if (typeof email.attachments === 'string') {
              parsedAttachments = JSON.parse(email.attachments);
            } else if (Array.isArray(email.attachments)) {
              parsedAttachments = email.attachments;
            } else if (email.attachments.value && Array.isArray(email.attachments.value)) {
              parsedAttachments = email.attachments.value;
            } else if (typeof email.attachments === 'object') {
              parsedAttachments = [email.attachments];
            }
          } catch (e) {
            console.error('Error parsing attachments:', e, email.attachments);
            parsedAttachments = [];
          }
        }

        parsedAttachments = parsedAttachments.filter((att: any) => att && !att.isInline && att.name);

        return {
          id: email.message_id || email.id,
          message_id: email.message_id || email.id,
          subject: email.subject || 'No Subject',
          body_html: email.body_html || null,
          body_preview: email.body_preview || email.body_html || '',
          sender_name: email.sender_name || selectedLead.sender_name,
          sender_email: email.sender_email || selectedLead.sender_email,
          recipient_list: email.recipient_list || '',
          sent_at: email.sent_at,
          direction: email.direction === 'outgoing' ? 'outgoing' : 'incoming',
          attachments: parsedAttachments,
          db_id: dbId,
          _dbId: dbId,
        };
      };

      const dedupeAndFilter = (rows: any[]) => {
        const formattedMessages = (rows || []).map((email: any) => formatMessage(email, email.id));
        const messageMap = new Map<string, EmailMessage & { _dbId: string | number }>();

        formattedMessages.forEach((message) => {
          const sentAt = message.sent_at ? new Date(message.sent_at).toISOString() : '';
          const normalizedSender = (message.sender_email || '').toLowerCase().trim();
          let timestampKey = sentAt;
          if (sentAt) {
            try {
              const date = new Date(sentAt);
              date.setMilliseconds(0);
              timestampKey = date.toISOString();
            } catch {
              timestampKey = sentAt;
            }
          }
          const uniqueKey = `${normalizedSender}_${timestampKey}`;
          const existingMessage = messageMap.get(uniqueKey);
          if (!existingMessage) {
            messageMap.set(uniqueKey, message);
            return;
          }
          const existingHasMessageId = existingMessage.message_id && existingMessage.message_id.trim();
          const currentHasMessageId = message.message_id && message.message_id.trim();
          if (currentHasMessageId && !existingHasMessageId) {
            messageMap.set(uniqueKey, message);
            return;
          }
          if (existingHasMessageId && !currentHasMessageId) return;
          const existingBodyLength = (existingMessage.body_html || existingMessage.body_preview || '').length;
          const currentBodyLength = (message.body_html || message.body_preview || '').length;
          if (currentBodyLength > existingBodyLength) {
            messageMap.set(uniqueKey, message);
          } else if (currentBodyLength === existingBodyLength) {
            const existingDbId =
              typeof existingMessage._dbId === 'string' ? parseInt(existingMessage._dbId, 10) : existingMessage._dbId;
            const currentDbId = typeof message._dbId === 'string' ? parseInt(message._dbId, 10) : message._dbId;
            if (currentDbId > existingDbId) messageMap.set(uniqueKey, message);
          }
        });

        const userEmailLower = (userEmail || '').toLowerCase();
        return Array.from(messageMap.values())
          .map(({ _dbId, ...message }) => ({ ...message, db_id: message.db_id ?? _dbId }) as EmailMessage)
          .filter((message) => {
            if (message.direction === 'incoming') {
              return String(message.recipient_list || '')
                .toLowerCase()
                .includes('office@lawoffice.org.il');
            }
            if (message.direction === 'outgoing') {
              const senderEmail = (message.sender_email || '').toLowerCase();
              const recipients = String(message.recipient_list || '').toLowerCase();
              const fromOffice =
                senderEmail.includes('office@lawoffice.org.il') ||
                (userEmailLower && senderEmail === userEmailLower);
              return fromOffice && recipients.includes(leadEmail);
            }
            return false;
          })
          .sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
      };

      // Prefer SECURITY DEFINER RPC (no body_html, indexed sender path).
      let combinedMessages: EmailMessage[] | null = null;
      const rpcResult = await supabase.rpc('email_office_thread_for_sender', {
        p_sender_email: selectedLead.sender_email,
        p_days: 365,
        p_limit: 400,
      });

      if (!rpcResult.error) {
        combinedMessages = dedupeAndFilter(asJsonArray(rpcResult.data));
      } else {
        console.warn('email_office_thread_for_sender RPC unavailable, using fallback:', rpcResult.error.message);
      }

      // Fallback: indexed sender_email lookups, NO body_html (hydrate later).
      if (combinedMessages === null) {
        const sinceIso = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
        const outgoingSenders = Array.from(
          new Set(
            ['office@lawoffice.org.il', userEmail]
              .filter(Boolean)
              .map((e) => String(e).toLowerCase()),
          ),
        );

        const withTimeout = <T,>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> =>
          Promise.race([
            Promise.resolve(promise),
            new Promise<T>((_, reject) =>
              setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
            ),
          ]);

        const incomingPromise = supabase
          .from('emails')
          .select(OFFICE_THREAD_LIST_SELECT)
          .eq('direction', 'incoming')
          .ilike('sender_email', selectedLead.sender_email)
          .gte('sent_at', sinceIso)
          .order('sent_at', { ascending: true })
          .limit(400);

        // Cap office outbound scan — filter recipient in JS (never recipient_list ILIKE).
        const outgoingPromise =
          outgoingSenders.length > 0
            ? supabase
                .from('emails')
                .select(OFFICE_THREAD_LIST_SELECT)
                .eq('direction', 'outgoing')
                .in('sender_email', outgoingSenders)
                .gte('sent_at', sinceIso)
                .order('sent_at', { ascending: false })
                .limit(1200)
            : Promise.resolve({ data: [] as any[], error: null });

        const [incomingSettled, outgoingSettled] = await Promise.allSettled([
          withTimeout(incomingPromise, 12000, 'incoming thread'),
          withTimeout(outgoingPromise, 12000, 'outgoing thread'),
        ]);

        const incomingRaw =
          incomingSettled.status === 'fulfilled' ? (incomingSettled.value as any)?.data || [] : [];
        const outgoingRaw =
          outgoingSettled.status === 'fulfilled' ? (outgoingSettled.value as any)?.data || [] : [];

        if (incomingSettled.status === 'rejected') {
          console.error('Error fetching incoming messages:', incomingSettled.reason);
        } else if ((incomingSettled.value as any)?.error) {
          console.error('Error fetching incoming messages:', (incomingSettled.value as any).error);
        }
        if (outgoingSettled.status === 'rejected') {
          console.error('Error fetching outgoing messages:', outgoingSettled.reason);
        } else if ((outgoingSettled.value as any)?.error) {
          console.error('Error fetching outgoing messages:', (outgoingSettled.value as any).error);
        }

        const incomingData = (incomingRaw || []).filter((email: any) =>
          String(email.recipient_list || '')
            .toLowerCase()
            .includes('office@lawoffice.org.il'),
        );
        const outgoingData = (outgoingRaw || []).filter((email: any) =>
          String(email.recipient_list || '')
            .toLowerCase()
            .includes(leadEmail),
        );

        combinedMessages = dedupeAndFilter([...(incomingData || []), ...(outgoingData || [])]);
      }

      setMessages(combinedMessages);
      setChatLoading(false);

      // Non-blocking: never keep the spinner waiting on mark-read / hydrate
      void markEmailsAsRead(selectedLead.sender_email);
      if (userId && combinedMessages.length > 0) {
        void hydrateEmailBodies(combinedMessages);
      }
    } catch (error) {
      console.error('Error fetching messages:', error);
      setChatLoading(false);
    }
    // hydrateEmailBodies is stable enough; defined below — omit from deps to avoid TDZ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLead, markEmailsAsRead, userEmail, userId]);

  // Hydrate email bodies that are missing or truncated
  const hydrateEmailBodies = useCallback(async (messages: EmailMessage[]) => {
    if (!messages || messages.length === 0) return;
    if (!userId) return;

    // Check which messages need hydration (empty body_html or truncated body_preview)
    const requiresHydration = messages.filter(message => {
      const body = (message.body_html || '').trim();
      const preview = (message.body_preview || '').trim();

      // If both are empty or very short, need hydration
      if (!body && !preview) return true;

      // If body_html is empty and preview is short or matches subject, need hydration
      if (!body && preview) {
        const normalised = preview.replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/g, ' ').trim();
        // If preview is too short or just the subject, fetch full body
        if (normalised.length < 50 || normalised === message.subject || preview.endsWith('...') || preview.endsWith('…')) {
          return true;
        }
      }

      return false;
    });

    if (requiresHydration.length === 0) return;

    console.log(`📧 Hydrating ${requiresHydration.length} email body(ies)...`);

    const updates: Record<string, { html: string; preview: string; attachments?: any[] }> = {};

    await Promise.all(
      requiresHydration.map(async message => {
        const messageId = message.message_id || message.id;
        if (!messageId) return;

        try {
          const { body: rawContent, attachments } = await fetchEmailBodyFromBackend(userId, messageId);
          if (!rawContent || typeof rawContent !== 'string') return;

          updates[messageId] = {
            html: rawContent,
            preview: rawContent,
            attachments: Array.isArray(attachments) ? attachments : undefined,
          };

          await supabase
            .from('emails')
            .update({
              body_html: rawContent,
              body_preview: rawContent,
              ...(Array.isArray(attachments) && attachments.length > 0 ? { attachments } : {}),
            })
            .eq('message_id', messageId);

          console.log(`✅ Hydrated body for message: ${message.subject?.substring(0, 50)}...`);
        } catch (err) {
          console.warn('⚠️ Failed to hydrate email body from backend:', err);
        }
      })
    );

    if (Object.keys(updates).length > 0) {
      setMessages(prev =>
        prev.map(message => {
          const messageId = message.message_id || message.id;
          const update = updates[messageId];
          if (!update) return message;

          return {
            ...message,
            body_html: update.html,
            body_preview: update.preview,
            ...(update.attachments && update.attachments.length > 0 ? { attachments: update.attachments } : {}),
          };
        })
      );
    }
  }, [userId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Fetch connected leads and contacts for the selected email
  const fetchConnectedLeadsAndContacts = useCallback(async () => {
    if (!selectedLead?.sender_email) {
      setConnectedLeads([]);
      setConnectedContacts([]);
      return;
    }

    setIsLoadingConnections(true);
    try {
      // Indexed sender_email lookup only — filter linked ids in JS (no OR IS NOT NULL).
      const sinceIso = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString();
      const { data: emailsData, error: emailsError } = await supabase
        .from('emails')
        .select('client_id, legacy_id, contact_id')
        .eq('sender_email', selectedLead.sender_email)
        .gte('sent_at', sinceIso)
        .limit(300);

      if (emailsError) {
        console.error('Error fetching connected emails:', emailsError);
        setConnectedLeads([]);
        setConnectedContacts([]);
        return;
      }

      // Get unique client_ids and legacy_ids
      const clientIds = new Set<string>();
      const legacyIds = new Set<number>();
      const contactIds = new Set<number>();

      (emailsData || []).forEach((email: any) => {
        if (email.client_id) clientIds.add(email.client_id);
        if (email.legacy_id) legacyIds.add(email.legacy_id);
        if (email.contact_id) contactIds.add(email.contact_id);
      });

      // Fetch leads from new leads table
      const leadsPromises: Promise<any>[] = [];
      if (clientIds.size > 0) {
        leadsPromises.push(
          supabase
            .from('leads')
            .select('id, lead_number, name')
            .in('id', Array.from(clientIds))
        );
      }

      // Fetch leads from legacy leads table
      if (legacyIds.size > 0) {
        leadsPromises.push(
          supabase
            .from('leads_lead')
            .select('id, name, master_id')
            .in('id', Array.from(legacyIds))
        );
      }

      const [newLeadsResult, legacyLeadsResult] = await Promise.all(leadsPromises);

      const leadsList: Array<{ id: string; lead_number: string; name: string; isLegacy: boolean }> = [];

      // Process new leads
      if (newLeadsResult?.data) {
        newLeadsResult.data.forEach((lead: any) => {
          leadsList.push({
            id: lead.id,
            lead_number: lead.lead_number || lead.id,
            name: lead.name || 'Unknown',
            isLegacy: false,
          });
        });
      }

      // Process legacy leads
      if (legacyLeadsResult?.data) {
        for (const lead of legacyLeadsResult.data) {
          let leadNumber: string;
          if (lead.master_id) {
            // It's a sublead - calculate suffix
            const { data: subleads } = await supabase
              .from('leads_lead')
              .select('id')
              .eq('master_id', lead.master_id)
              .not('master_id', 'is', null)
              .order('id', { ascending: true });

            if (subleads) {
              const suffix = subleads.findIndex((sub: any) => sub.id === lead.id) + 2;
              leadNumber = `${lead.master_id}/${suffix}`;
            } else {
              leadNumber = `${lead.master_id}/?`;
            }
          } else {
            // Master lead - use id as lead_number
            leadNumber = String(lead.id);
          }

          leadsList.push({
            id: String(lead.id),
            lead_number: leadNumber,
            name: lead.name || 'Unknown',
            isLegacy: true,
          });
        }
      }

      // Fetch contacts and their associated leads
      const contactsList: Array<{ id: number; name: string; lead_number: string; isLegacy: boolean }> = [];
      if (contactIds.size > 0) {
        const { data: contactsData, error: contactsError } = await supabase
          .from('leads_contact')
          .select('id, name, newlead_id, lead_id')
          .in('id', Array.from(contactIds));

        if (!contactsError && contactsData) {
          for (const contact of contactsData) {
            let leadNumber: string | null = null;
            let isLegacy = false;

            // Check if contact is linked to a new lead
            if (contact.newlead_id) {
              const { data: newLead } = await supabase
                .from('leads')
                .select('lead_number')
                .eq('id', contact.newlead_id)
                .maybeSingle();

              if (newLead) {
                leadNumber = newLead.lead_number || contact.newlead_id;
                isLegacy = false;
              }
            }

            // Check if contact is linked to a legacy lead
            if (!leadNumber && contact.lead_id) {
              const { data: legacyLead } = await supabase
                .from('leads_lead')
                .select('id, master_id')
                .eq('id', contact.lead_id)
                .maybeSingle();

              if (legacyLead) {
                if (legacyLead.master_id) {
                  // Sublead
                  const { data: subleads } = await supabase
                    .from('leads_lead')
                    .select('id')
                    .eq('master_id', legacyLead.master_id)
                    .not('master_id', 'is', null)
                    .order('id', { ascending: true });

                  if (subleads) {
                    const suffix = subleads.findIndex((sub: any) => sub.id === legacyLead.id) + 2;
                    leadNumber = `${legacyLead.master_id}/${suffix}`;
                  } else {
                    leadNumber = `${legacyLead.master_id}/?`;
                  }
                } else {
                  leadNumber = String(legacyLead.id);
                }
                isLegacy = true;
              }
            }

            if (leadNumber) {
              contactsList.push({
                id: contact.id,
                name: contact.name || 'Unknown Contact',
                lead_number: leadNumber,
                isLegacy,
              });
            }
          }
        }
      }

      // Deduplicate leads by lead_number
      const uniqueLeads = leadsList.filter((lead, index, self) =>
        index === self.findIndex((l) => l.lead_number === lead.lead_number)
      );

      setConnectedLeads(uniqueLeads);
      setConnectedContacts(contactsList);
    } catch (error) {
      console.error('Error fetching connected leads and contacts:', error);
      setConnectedLeads([]);
      setConnectedContacts([]);
    } finally {
      setIsLoadingConnections(false);
    }
  }, [selectedLead?.sender_email]);

  // Fetch connected leads/contacts when selectedLead changes
  useEffect(() => {
    fetchConnectedLeadsAndContacts();
  }, [fetchConnectedLeadsAndContacts]);

  useEffect(() => {
    if (selectedLead) {
      setSubject(selectedLead.last_subject ? `Re: ${selectedLead.last_subject}` : '');
      setNewMessage('');
      setAttachments([]);
      setShowAISuggestions(false);
      setAiSuggestions([]);
      setMessages([]);
      setChatLoading(true);
      setComposeMode('reply');
      setComposeToRecipients([selectedLead.sender_email].filter(Boolean));
      setComposeCcRecipients([]);
      if (textareaRef.current) {
        textareaRef.current.style.height = '100px';
      }
      setShowSubjectInput(false);
    } else {
      setMessages([]);
      setChatLoading(false);
      setComposeToRecipients([]);
      setComposeCcRecipients([]);
    }
  }, [selectedLead]);

  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const maxHeight = isMobile ? 500 : 320;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, [isMobile]);

  useEffect(() => {
    adjustTextareaHeight();
  }, [newMessage, isMobile, adjustTextareaHeight]);

  useEffect(() => {
    if (showSubjectInput) {
      subjectInputRef.current?.focus();
    }
  }, [showSubjectInput]);

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length) {
      setAttachments((prev) => [...prev, ...files]);
    }
    event.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAISuggestions = async () => {
    if (!selectedLead || isLoadingAI) return;

    setIsActionMenuOpen(false);
    setIsLoadingAI(true);
    setShowAISuggestions(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-ai-suggestions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          currentMessage: newMessage.trim(),
          conversationHistory: messages.map((msg) => ({
            id: msg.id,
            direction: msg.direction === 'outgoing' ? 'out' : 'in',
            message: msg.body_preview || msg.body_html || '',
            sent_at: msg.sent_at,
            sender_name: msg.sender_name || msg.sender_email,
          })),
          clientName: selectedLead.sender_name,
          requestType: newMessage.trim() ? 'improve' : 'suggest',
        }),
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const result = await response.json();
      if (result.success) {
        setAiSuggestions(result.suggestion ? [result.suggestion.trim()] : []);
      } else {
        throw new Error(result.error || 'Failed to get AI suggestions');
      }
    } catch (error) {
      console.error('Error getting AI suggestions:', error);
      toast.error('Failed to get AI suggestions');
      setAiSuggestions(['AI suggestions are temporarily unavailable.']);
    } finally {
      setIsLoadingAI(false);
    }
  };

  const applyAISuggestion = (suggestion: string) => {
    setNewMessage(suggestion);
    setShowAISuggestions(false);
    setAiSuggestions([]);
  };

  const getActiveLeadMessage = useCallback((): EmailMessage | null => {
    if (!messages.length) return null;
    return [...messages].sort(
      (a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime(),
    )[0] || null;
  }, [messages]);

  const applyComposeAction = useCallback(
    (mode: EmailComposeMode) => {
      if (!selectedLead) return;
      const active = getActiveLeadMessage();
      if (!active && mode !== 'reply') {
        toast.error('No email selected in this conversation yet');
        return;
      }
      const draft = buildComposeDraft(active, mode, {
        userEmail,
        fallbackTo: selectedLead.sender_email,
      });
      setComposeMode(mode);
      setComposeToRecipients(
        draft.to.length > 0 ? draft.to : [selectedLead.sender_email].filter(Boolean),
      );
      setComposeCcRecipients(draft.cc);
      setSubject(draft.subject || (selectedLead.last_subject ? `Re: ${selectedLead.last_subject}` : ''));
      setNewMessage(draft.body);
      if (mode === 'forward') {
        toast('Add recipients, then send the forward');
      }
    },
    [selectedLead, getActiveLeadMessage, userEmail],
  );

  const handleDeleteActiveLeadEmail = useCallback(async () => {
    const active = getActiveLeadMessage();
    if (!active) {
      toast.error('No email to delete');
      return;
    }
    if (!window.confirm('Delete this email from the CRM? This cannot be undone.')) return;
    const filter = resolveEmailDeleteFilter(active);
    if (!filter) {
      toast.error('Could not resolve email id for delete');
      return;
    }
    try {
      let query = supabase.from('emails').delete();
      query = filter.by === 'id' ? query.eq('id', filter.value) : query.eq('message_id', filter.value);
      const { error } = await query;
      if (error) throw error;
      setMessages((prev) => prev.filter((m) => String(m.id) !== String(active.id)));
      toast.success('Email deleted');
    } catch (error) {
      console.error('Error deleting email:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete email');
    }
  }, [getActiveLeadMessage]);

  const handleSendEmail = async () => {
    if (!selectedLead || !userId || !newMessage.trim()) {
      toast.error('Please enter a message before sending');
      return;
    }

    const to =
      composeToRecipients.length > 0
        ? composeToRecipients
        : [selectedLead.sender_email].filter(Boolean);
    if (to.length === 0) {
      toast.error('Add at least one recipient');
      return;
    }

    try {
      setIsSending(true);
      const finalSubject =
        subject.trim() || (selectedLead.last_subject ? `Re: ${selectedLead.last_subject}` : 'Email Response');
      const baseHtml = newMessage.replace(/\n/g, '<br>');
      const htmlWithSignature = await appendEmailSignature(baseHtml);
      const backendAttachments = attachments.length ? await mapAttachmentsForBackend(attachments) : undefined;

      await sendEmailViaBackend({
        userId,
        subject: finalSubject,
        bodyHtml: htmlWithSignature,
        to,
        cc: composeCcRecipients.length > 0 ? composeCcRecipients : undefined,
        attachments: backendAttachments,
        context: {
          contactEmail: selectedLead.sender_email,
          contactName: selectedLead.sender_name,
          leadNumber: selectedLead.id,
        },
      });

      const outgoingMessage: EmailMessage = {
        id: `local-${Date.now()}`,
        message_id: '',
        subject: finalSubject,
        body_html: baseHtml,
        body_preview: newMessage,
        sender_name: currentUserFullName || userEmail || 'You',
        sender_email: userEmail || '',
        recipient_list: [...to, ...composeCcRecipients].join(', '),
        sent_at: new Date().toISOString(),
        direction: 'outgoing',
        attachments: backendAttachments,
      };

      setMessages((prev) => [...prev, outgoingMessage]);
      setNewMessage('');
      setAttachments([]);
      setIsActionMenuOpen(false);
      setShowAISuggestions(false);
      setAiSuggestions([]);
      setComposeMode('reply');
      setComposeToRecipients([selectedLead.sender_email].filter(Boolean));
      setComposeCcRecipients([]);
      toast.success('Email sent');
      await fetchMessages();
    } catch (error) {
      console.error('Error sending email:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to send email');
    } finally {
      setIsSending(false);
    }
  };

  const handleMessageChange = (value: string) => {
    setNewMessage(value);
  };

  const handleAttachmentDownload = async (message: EmailMessage, attachment: any) => {
    if (!attachment) return;
    const messageId = message.message_id || message.id;
    const attachmentName = attachment.name || 'attachment';

    const triggerBrowserDownload = (blob: Blob, fileName: string) => {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    };

    if (attachment.contentBytes) {
      try {
        const byteCharacters = atob(attachment.contentBytes);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: attachment.contentType || 'application/octet-stream' });
        triggerBrowserDownload(blob, attachmentName);
        toast.success(`Downloaded ${attachmentName}`);
      } catch (error) {
        console.error('Error downloading inline attachment:', error);
        toast.error('Failed to download attachment');
      }
      return;
    }

    if (!attachment.id) {
      toast.error('Attachment is not available yet. Please try again later.');
      return;
    }
    if (!userId) {
      toast.error('Please sign in to download attachments.');
      return;
    }
    if (downloadingAttachments[attachment.id]) {
      return;
    }

    setDownloadingAttachments((prev) => ({ ...prev, [attachment.id]: true }));
    toast.loading(`Downloading ${attachmentName}...`, { id: attachment.id });

    try {
      const { blob, fileName } = await downloadAttachmentFromBackend(userId, messageId, attachment.id);
      triggerBrowserDownload(blob, fileName || attachmentName);
      toast.success(`Downloaded ${attachmentName}`, { id: attachment.id });
    } catch (error) {
      console.error('Error downloading attachment via backend:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to download attachment', { id: attachment.id });
    } finally {
      setDownloadingAttachments((prev) => {
        const next = { ...prev };
        delete next[attachment.id];
        return next;
      });
    }
  };

  // Auto-scroll to bottom when new messages arrive or finish loading
  useEffect(() => {
    if (chatLoading) return;
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  }, [messages, chatLoading]);

  // Format time
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffTime = now.getTime() - date.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays <= 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  // Format date separator
  const formatDateSeparator = (timestamp: string) => {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    }
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    const diffTime = today.getTime() - date.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 7) {
      return date.toLocaleDateString('en-US', { weekday: 'long' });
    }
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  // Get message preview
  const getMessagePreview = (message: string) => {
    if (!message) return 'No preview';
    const text = message.replace(/<[^>]*>/g, '').trim();
    return text.length > 50 ? text.substring(0, 50) + '...' : text;
  };

  // Search leads from both leads and leads_lead tables
  const searchLeadsForSelection = async (query: string) => {
    if (!query.trim() || query.length < 2) {
      setLeadSearchResults([]);
      return;
    }

    setIsSearchingLeads(true);
    try {
      // Search in leads table (new leads)
      const { data: leadsData, error: leadsError } = await supabase
        .from('leads')
        .select(`
          id,
          lead_number,
          name,
          email,
          phone,
          mobile,
          stage
        `)
        .or(`lead_number.ilike.%${query}%,name.ilike.%${query}%,email.ilike.%${query}%`)
        .limit(10);

      // Search in leads_lead table (legacy leads)
      const { data: legacyLeadsData, error: legacyError } = await supabase
        .from('leads_lead')
        .select(`
          id,
          lead_number,
          name,
          email,
          phone,
          mobile,
          stage
        `)
        .or(`lead_number.ilike.%${query}%,name.ilike.%${query}%,email.ilike.%${query}%`)
        .limit(10);

      if (leadsError) console.error('Error searching leads:', leadsError);
      if (legacyError) console.error('Error searching legacy leads:', legacyError);

      // Combine and format results
      const allLeads = [
        ...(leadsData || []).map(lead => ({ ...lead, isLegacy: false })),
        ...(legacyLeadsData || []).map(lead => ({ ...lead, isLegacy: true }))
      ];

      // Deduplicate by lead_number
      const uniqueLeads = allLeads.filter((lead, index, self) =>
        index === self.findIndex(l => l.lead_number === lead.lead_number)
      );

      setLeadSearchResults(uniqueLeads.slice(0, 10));
    } catch (error) {
      console.error('Error in lead search:', error);
      setLeadSearchResults([]);
    } finally {
      setIsSearchingLeads(false);
    }
  };

  // Handle lead search input change
  useEffect(() => {
    if (showLeadSearchModal && leadSearchQuery) {
      const timeoutId = setTimeout(() => {
        searchLeadsForSelection(leadSearchQuery);
      }, 300);
      return () => clearTimeout(timeoutId);
    } else {
      setLeadSearchResults([]);
    }
  }, [leadSearchQuery, showLeadSearchModal]);

  // Handle convert to lead
  const handleConvertToLead = async (lead: EmailLead) => {
    try {
      setLoading(true);
      console.log('🔄 Converting email lead to new lead:', lead);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        toast.error('User not authenticated');
        return;
      }

      const leadName = lead.sender_name?.trim() || lead.sender_email.split('@')[0] || 'Email Lead';

      const { data, error } = await supabase.rpc('create_new_lead_v3', {
        p_lead_name: leadName,
        p_lead_email: lead.sender_email,
        p_lead_phone: null,
        p_lead_topic: 'Email Inquiry',
        p_lead_language: 'English',
        p_lead_source: 'Email',
        p_created_by: user.email,
        p_balance_currency: 'NIS',
        p_proposal_currency: 'NIS'
      });

      if (error) {
        console.error('Error creating lead:', error);
        toast.error('Failed to create lead');
        return;
      }

      const newLead = data?.[0];
      if (!newLead) {
        toast.error('Could not create lead');
        return;
      }

      // Update emails to link them to the new lead
      const { error: updateError } = await supabase
        .from('emails')
        .update({
          client_id: newLead.id,
          legacy_id: null
        })
        .eq('sender_email', lead.sender_email)
        .eq('direction', 'incoming')
        .ilike('recipient_list', '%office@lawoffice.org.il%');

      if (updateError) {
        console.error('Error linking emails to lead:', updateError);
      }

      toast.success(`Lead ${newLead.lead_number} created successfully!`);

      setLeads(prevLeads => prevLeads.filter(l => l.id !== lead.id));
      setSelectedLead(null);
      window.location.href = `/clients/${newLead.lead_number}`;

    } catch (error) {
      console.error('Error converting lead:', error);
      toast.error('Failed to convert lead');
    } finally {
      setLoading(false);
    }
  };

  // Handle create sublead
  const handleCreateSublead = async (parentLead: any) => {
    if (!selectedLead) return;

    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        toast.error('User not authenticated');
        return;
      }

      const leadName = selectedLead.sender_name?.trim() || selectedLead.sender_email.split('@')[0] || 'Email Lead';
      const parentLeadNumber = parentLead.lead_number;

      // Generate sublead number
      const { data: existingSubLeads } = await supabase
        .from('leads')
        .select('lead_number')
        .like('lead_number', `${parentLeadNumber}/%`)
        .order('lead_number', { ascending: false })
        .limit(1);

      let subNumber = 1;
      if (existingSubLeads && existingSubLeads.length > 0) {
        const lastSubLead = existingSubLeads[0].lead_number;
        const match = lastSubLead.match(/\/(\d+)$/);
        if (match) {
          subNumber = parseInt(match[1], 10) + 1;
        }
      }

      const subLeadNumber = `${parentLeadNumber}/${subNumber}`;

      // Get parent lead's master_id and manual_id
      let masterId: string | number = parentLead.id;
      let manualId: string = parentLead.lead_number;

      if (!parentLead.isLegacy) {
        const { data: parentLeadData } = await supabase
          .from('leads')
          .select('master_id, manual_id')
          .eq('id', parentLead.id)
          .maybeSingle();

        if (parentLeadData?.master_id) {
          masterId = parentLeadData.master_id;
        }
        if (parentLeadData?.manual_id) {
          manualId = parentLeadData.manual_id;
        } else {
          const { data: maxLeadData } = await supabase
            .from('leads')
            .select('manual_id')
            .not('manual_id', 'is', null)
            .order('manual_id', { ascending: false })
            .limit(1)
            .single();

          if (maxLeadData?.manual_id) {
            const maxId = BigInt(String(maxLeadData.manual_id));
            manualId = (maxId + BigInt(1)).toString();
          } else {
            manualId = Date.now().toString();
          }
        }
      } else {
        const numericMatch = parentLead.lead_number.match(/\d+/);
        if (numericMatch) {
          masterId = parseInt(numericMatch[0], 10);
          manualId = parentLead.lead_number;
        }
      }

      const subLeadData: Record<string, any> = {
        lead_number: subLeadNumber,
        master_id: masterId,
        manual_id: manualId,
        name: leadName,
        email: selectedLead.sender_email,
        phone: null,
        mobile: null,
        topic: 'Email Inquiry',
        language: 'English',
        source: 'Email',
        stage: 0,
        status: 'new',
        created_at: new Date().toISOString(),
        created_by: user.email,
        balance_currency: 'NIS',
        proposal_currency: 'NIS'
      };

      const { data: insertedSubLead, error: subLeadError } = await supabase
        .from('leads')
        .insert([subLeadData])
        .select('id')
        .single();

      if (subLeadError) {
        console.error('Error creating sublead:', subLeadError);
        toast.error('Failed to create sublead');
        return;
      }

      // Create contact for the sublead
      if (insertedSubLead?.id) {
        const { data: maxContactId } = await supabase
          .from('leads_contact')
          .select('id')
          .order('id', { ascending: false })
          .limit(1)
          .single();

        const newContactId = maxContactId ? maxContactId.id + 1 : 1;
        const currentDate = new Date().toISOString().split('T')[0];

        const { error: contactError } = await supabase
          .from('leads_contact')
          .insert([{
            id: newContactId,
            name: leadName,
            mobile: null,
            phone: null,
            email: selectedLead.sender_email,
            newlead_id: insertedSubLead.id,
            cdate: currentDate,
            udate: currentDate
          }]);

        if (contactError) {
          console.error('Error creating contact:', contactError);
        } else {
          const { data: maxRelationshipId } = await supabase
            .from('lead_leadcontact')
            .select('id')
            .order('id', { ascending: false })
            .limit(1)
            .single();

          const newRelationshipId = maxRelationshipId ? maxRelationshipId.id + 1 : 1;

          const { error: relationshipError } = await supabase
            .from('lead_leadcontact')
            .insert([{
              id: newRelationshipId,
              contact_id: newContactId,
              newlead_id: insertedSubLead.id,
              main: 'true'
            }]);

          if (relationshipError) {
            console.error('Error creating contact relationship:', relationshipError);
          }
        }
      }

      // Update emails to link them to the sublead
      const { error: updateError } = await supabase
        .from('emails')
        .update({
          client_id: insertedSubLead.id,
          legacy_id: null
        })
        .eq('sender_email', selectedLead.sender_email)
        .eq('direction', 'incoming')
        .ilike('recipient_list', '%office@lawoffice.org.il%');

      if (updateError) {
        console.error('Error linking emails to sublead:', updateError);
      }

      toast.success(`Sublead ${subLeadNumber} created successfully!`);

      setLeads(prevLeads => prevLeads.filter(l => l.id !== selectedLead.id));
      setSelectedLead(null);
      setShowLeadSearchModal(false);
      setShowActionDropdown(false);

      window.location.href = `/clients/${subLeadNumber}`;

    } catch (error) {
      console.error('Error creating sublead:', error);
      toast.error('Failed to create sublead');
    } finally {
      setLoading(false);
    }
  };

  // Handle navigation to client page
  const handleNavigateToClient = (leadNumber: string, event: React.MouseEvent) => {
    const url = `/clients/${leadNumber}`;

    if (event.ctrlKey || event.metaKey) {
      // Open in new tab
      window.open(url, '_blank');
    } else {
      // Navigate in current tab
      window.location.href = url;
    }
  };

  // Handle add as contact to lead
  const handleAddAsContact = async (targetLead: any) => {
    if (!selectedLead) return;

    try {
      setLoading(true);
      const leadName = selectedLead.sender_name?.trim() || selectedLead.sender_email.split('@')[0] || 'Email Contact';
      const targetLeadId = targetLead.id;
      const isLegacyLead = targetLead.isLegacy;

      if (isLegacyLead) {
        const { data: maxContactId } = await supabase
          .from('leads_contact')
          .select('id')
          .order('id', { ascending: false })
          .limit(1)
          .single();

        const newContactId = maxContactId ? maxContactId.id + 1 : 1;
        const currentDate = new Date().toISOString().split('T')[0];

        let contactResult = await supabase
          .from('leads_contact')
          .insert([{
            id: newContactId,
            name: leadName,
            mobile: null,
            phone: null,
            email: selectedLead.sender_email,
            cdate: currentDate,
            udate: currentDate
          }])
          .select('id')
          .single();

        if (contactResult.error && contactResult.error.code === '23505') {
          const { data: maxIdData } = await supabase
            .from('leads_contact')
            .select('id')
            .order('id', { ascending: false })
            .limit(1)
            .single();

          const nextId = maxIdData ? maxIdData.id + 1 : 1;
          contactResult = await supabase
            .from('leads_contact')
            .insert([{
              id: nextId,
              name: leadName,
              mobile: null,
              phone: null,
              email: selectedLead.sender_email,
              cdate: currentDate,
              udate: currentDate
            }])
            .select('id')
            .single();
        }

        if (contactResult.error || !contactResult.data) {
          console.error('Error creating contact:', contactResult.error);
          toast.error('Failed to create contact');
          return;
        }

        const finalContactId = contactResult.data.id;

        const { data: maxRelationshipId } = await supabase
          .from('lead_leadcontact')
          .select('id')
          .order('id', { ascending: false })
          .limit(1)
          .single();

        const newRelationshipId = maxRelationshipId ? maxRelationshipId.id + 1 : 1;

        let relationshipResult = await supabase
          .from('lead_leadcontact')
          .insert([{
            id: newRelationshipId,
            contact_id: finalContactId,
            lead_id: targetLeadId,
            main: 'false'
          }]);

        if (relationshipResult.error && relationshipResult.error.code === '23505') {
          const { data: maxRelIdData } = await supabase
            .from('lead_leadcontact')
            .select('id')
            .order('id', { ascending: false })
            .limit(1)
            .single();

          const nextRelId = maxRelIdData ? maxRelIdData.id + 1 : 1;
          relationshipResult = await supabase
            .from('lead_leadcontact')
            .insert([{
              id: nextRelId,
              contact_id: finalContactId,
              lead_id: targetLeadId,
              main: 'false'
            }]);
        }

        if (relationshipResult.error) {
          console.error('Error creating contact relationship:', relationshipResult.error);
          toast.error('Failed to link contact to lead');
          return;
        }
      } else {
        const { data: maxContactId } = await supabase
          .from('leads_contact')
          .select('id')
          .order('id', { ascending: false })
          .limit(1)
          .single();

        const newContactId = maxContactId ? maxContactId.id + 1 : 1;
        const currentDate = new Date().toISOString().split('T')[0];

        const { error: contactError } = await supabase
          .from('leads_contact')
          .insert([{
            id: newContactId,
            name: leadName,
            mobile: null,
            phone: null,
            email: selectedLead.sender_email,
            newlead_id: targetLeadId,
            cdate: currentDate,
            udate: currentDate
          }]);

        if (contactError) {
          console.error('Error creating contact:', contactError);
          toast.error('Failed to create contact');
          return;
        }

        const { data: maxRelationshipId } = await supabase
          .from('lead_leadcontact')
          .select('id')
          .order('id', { ascending: false })
          .limit(1)
          .single();

        const newRelationshipId = maxRelationshipId ? maxRelationshipId.id + 1 : 1;

        const { error: relationshipError } = await supabase
          .from('lead_leadcontact')
          .insert([{
            id: newRelationshipId,
            contact_id: newContactId,
            newlead_id: targetLeadId,
            main: 'false'
          }]);

        if (relationshipError) {
          console.error('Error creating contact relationship:', relationshipError);
          toast.error('Failed to link contact to lead');
          return;
        }
      }

      // Update emails to link them to the target lead
      const { error: updateError } = await supabase
        .from('emails')
        .update({
          client_id: isLegacyLead ? null : targetLeadId,
          legacy_id: isLegacyLead ? targetLeadId : null
        })
        .eq('sender_email', selectedLead.sender_email)
        .eq('direction', 'incoming')
        .ilike('recipient_list', '%office@lawoffice.org.il%');

      if (updateError) {
        console.error('Error linking emails to lead:', updateError);
      }

      toast.success(`Contact added to lead ${targetLead.lead_number} successfully!`);

      setLeads(prevLeads => prevLeads.filter(l => l.id !== selectedLead.id));
      setSelectedLead(null);
      setShowLeadSearchModal(false);
      setShowActionDropdown(false);

      window.location.href = `/clients/${targetLead.lead_number}`;

    } catch (error) {
      console.error('Error adding contact:', error);
      toast.error('Failed to add contact');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-white z-[9999] overflow-hidden">
      <div className="flex h-full min-h-0 overflow-hidden" style={{ height: '100vh', maxHeight: '100vh' }}>
          {/* Left Panel - Leads List (full height to top of screen) */}
          <div className={`${isMobile ? 'w-full' : 'w-80'} border-r border-gray-200 flex h-full min-h-0 shrink-0 flex-col ${isMobile && showChat ? 'hidden' : ''} overflow-hidden bg-white`}>
            {/* Mobile list header */}
            {isMobile && (
              <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <EnvelopeIcon className="h-5 w-5 shrink-0 text-blue-600" />
                  <h2 className="truncate text-base font-bold text-gray-900">Email Leads</h2>
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-800">
                    {leads.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => window.history.back()}
                  className="btn btn-ghost btn-circle btn-sm shrink-0"
                  aria-label="Close"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
            {/* Search Bar */}
            <div className="p-3 border-b border-gray-200 flex-shrink-0 bg-white">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by email or name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Leads List */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              {loading ? (
                <div className="flex items-center justify-center h-32">
                  <div className="loading loading-spinner loading-lg text-blue-600"></div>
                </div>
              ) : filteredLeads.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <EnvelopeIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p className="text-lg font-medium">No email leads found</p>
                  <p className="text-sm">
                    {searchTerm ? 'No leads match your search criteria' : 'New leads will appear here when emails are received at office@lawoffice.org.il'}
                  </p>
                </div>
              ) : (
                filteredLeads.map((lead) => {
                  const isSelected = selectedLead?.id === lead.id;
                  const leadPreviewRtl = emailContentLikelyHebrew(lead.last_subject, lead.last_message_preview);

                  return (
                    <div
                      key={lead.id}
                      onClick={() => {
                        setSelectedLead(lead);
                        if (isMobile) {
                          setShowChat(true);
                        }
                      }}
                      className={`p-2.5 md:p-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors overflow-hidden ${isSelected ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                        }`}
                    >
                      <div className="flex items-start gap-2 min-w-0 w-full">
                        {/* Avatar */}
                        <div className="w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center flex-shrink-0 relative border bg-blue-100 border-blue-200 text-blue-700">
                          {lead.sender_name && lead.sender_name !== lead.sender_email ? (
                            <span className="font-semibold text-xs md:text-sm">
                              {lead.sender_name.charAt(0).toUpperCase()}
                            </span>
                          ) : (
                            <EnvelopeIcon className="w-3.5 h-3.5 md:w-4 md:h-4 text-blue-700" />
                          )}
                          {/* Connection indicator icon */}
                          {leadsWithConnections.get(lead.id) && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 md:w-4 md:h-4 rounded-full border-2 border-white flex items-center justify-center shadow-sm" style={{ backgroundColor: '#4218cc' }}>
                              <LinkIcon className="w-2 h-2 md:w-2.5 md:h-2.5 text-white" />
                            </div>
                          )}
                        </div>

                        {/* Lead Info */}
                        <div className="flex-1 min-w-0 overflow-hidden">
                          <div className="flex items-center justify-between gap-2 mb-0.5 min-w-0">
                            <div className="flex flex-col min-w-0 flex-1">
                              <h3 className="font-semibold text-sm text-gray-900 truncate">
                                {lead.sender_name && lead.sender_name !== lead.sender_email
                                  ? lead.sender_name
                                  : lead.sender_email || 'Unknown Sender'}
                              </h3>
                              {lead.sender_name && lead.sender_name !== lead.sender_email && (
                                <p className="text-[11px] text-gray-500 truncate">
                                  {lead.sender_email}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <span className="text-[11px] text-gray-500 whitespace-nowrap">
                                {formatTime(lead.last_message_at)}
                              </span>
                              <span className={`text-[11px] rounded-full px-1.5 py-0.5 min-w-[18px] h-4 flex items-center justify-center flex-shrink-0 ${lead.unread_count && lead.unread_count > 0 ? 'bg-blue-500 text-white' : 'invisible'}`}>
                                {lead.unread_count && lead.unread_count > 0 ? lead.unread_count : '0'}
                              </span>
                            </div>
                          </div>

                          <p
                            dir={leadPreviewRtl ? 'rtl' : 'ltr'}
                            className="text-xs text-gray-600 truncate mb-0.5 font-medium text-start"
                            title={lead.last_subject || undefined}
                          >
                            {truncateSidepanelTitle(lead.last_subject, 20)}
                          </p>
                          <p
                            dir={leadPreviewRtl ? 'rtl' : 'ltr'}
                            className="text-xs text-gray-500 truncate text-start"
                          >
                            {getMessagePreview(lead.last_message_preview)}
                          </p>

                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Panel - Chat (header only above main content) */}
          <div className={`${isMobile ? 'w-full' : 'flex-1'} flex min-h-0 min-w-0 flex-col bg-white ${isMobile && !showChat ? 'hidden' : ''}`} style={isMobile ? { height: '100vh', overflow: 'hidden', position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40 } : {}}>
            {/* Page header — main content only */}
            {!isMobile && (
              <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-3 md:px-6 md:py-4">
                <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-4">
                  <EnvelopeIcon className="h-6 w-6 shrink-0 text-blue-600 md:h-7 md:w-7" />
                  <h2 className="shrink-0 text-lg font-bold text-gray-900 md:text-2xl">Email Leads</h2>
                  <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                    {leads.length} Leads
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => window.history.back()}
                  className="btn btn-ghost btn-circle shrink-0"
                  aria-label="Close"
                >
                  <svg className="h-5 w-5 md:h-6 md:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
            {selectedLead ? (
              <>
                {/* Mobile Chat Header */}
                {isMobile && (
                  <div className="flex-none flex items-center gap-2 p-4 border-b border-gray-200 bg-white" style={{ zIndex: 40 }}>
                    <button
                      onClick={() => setShowChat(false)}
                      className="btn btn-ghost btn-circle btn-sm flex-shrink-0"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                        {selectedLead.sender_name && selectedLead.sender_name !== selectedLead.sender_email ? (
                          <span className="text-blue-600 font-semibold text-sm">
                            {selectedLead.sender_name.charAt(0).toUpperCase()}
                          </span>
                        ) : (
                          <EnvelopeIcon className="w-4 h-4 text-blue-600" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-gray-900 text-sm truncate">
                          {selectedLead.sender_name && selectedLead.sender_name !== selectedLead.sender_email
                            ? selectedLead.sender_name
                            : selectedLead.sender_email || 'Unknown Sender'}
                        </h3>
                        <p className="text-xs text-gray-500 truncate">
                          {selectedLead.sender_email}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {selectedLead.message_count} messages
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Desktop Header */}
                {!isMobile && (
                  <div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b border-gray-200 bg-white">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                        {selectedLead.sender_name && selectedLead.sender_name !== selectedLead.sender_email ? (
                          <span className="text-blue-600 font-semibold text-lg">
                            {selectedLead.sender_name.charAt(0).toUpperCase()}
                          </span>
                        ) : (
                          <EnvelopeIcon className="w-5 h-5 text-blue-600" />
                        )}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">
                          {selectedLead.sender_name && selectedLead.sender_name !== selectedLead.sender_email
                            ? selectedLead.sender_name
                            : selectedLead.sender_email || 'Unknown Sender'}
                        </h3>
                        {selectedLead.sender_name && selectedLead.sender_name !== selectedLead.sender_email && (
                          <p className="text-sm text-gray-500">
                            {selectedLead.sender_email}
                          </p>
                        )}
                        <p className="text-sm text-gray-500">
                          {selectedLead.message_count} messages • Last message {formatTime(selectedLead.last_message_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Connected Leads Dropdown - Only show if there are connected leads/contacts */}
                      {(connectedLeads.length > 0 || connectedContacts.length > 0 || isLoadingConnections) && (
                        <div className="relative">
                          <button
                            className="btn btn-outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowConnectedLeadsDropdown(!showConnectedLeadsDropdown);
                              setShowActionDropdown(false);
                            }}
                          >
                            <LinkIcon className="w-4 h-4 mr-2" />
                            Connected Leads
                            <ChevronDownIcon className="w-4 h-4 ml-2" />
                          </button>
                          {showConnectedLeadsDropdown && (
                            <>
                              <div
                                className="fixed inset-0 z-40"
                                onClick={() => setShowConnectedLeadsDropdown(false)}
                              />
                              <ul
                                className="absolute right-0 top-full mt-2 menu p-2 shadow-lg bg-base-100 rounded-box w-80 max-h-[70vh] overflow-y-auto z-50 border border-gray-200"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {isLoadingConnections ? (
                                  <li>
                                    <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                                      <span className="loading loading-spinner loading-xs"></span>
                                      <span>Loading connections...</span>
                                    </div>
                                  </li>
                                ) : (
                                  <>
                                    {connectedLeads.map((lead) => (
                                      <li key={`lead-${lead.id}`}>
                                        <button
                                          onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setShowConnectedLeadsDropdown(false);
                                            handleNavigateToClient(lead.lead_number, e);
                                          }}
                                          className="flex items-center gap-2 w-full text-left hover:bg-gray-100 rounded px-2 py-2"
                                        >
                                          <UserGroupIcon className="w-4 h-4 text-blue-600 flex-shrink-0" />
                                          <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium text-gray-900 truncate">{lead.name}</div>
                                            <div className="text-xs text-gray-500 truncate">
                                              {lead.lead_number}
                                            </div>
                                          </div>
                                        </button>
                                      </li>
                                    ))}
                                    {connectedContacts.map((contact) => (
                                      <li key={`contact-${contact.id}`}>
                                        <button
                                          onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setShowConnectedLeadsDropdown(false);
                                            handleNavigateToClient(contact.lead_number, e);
                                          }}
                                          className="flex items-center gap-2 w-full text-left hover:bg-gray-100 rounded px-2 py-2"
                                        >
                                          <LinkIcon className="w-4 h-4 text-purple-600 flex-shrink-0" />
                                          <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium text-gray-900 truncate">{contact.name}</div>
                                            <div className="text-xs text-gray-500 truncate">
                                              Lead: {contact.lead_number}
                                            </div>
                                          </div>
                                        </button>
                                      </li>
                                    ))}
                                    {connectedLeads.length === 0 && connectedContacts.length === 0 && !isLoadingConnections && (
                                      <li>
                                        <div className="text-sm text-gray-500 py-2 text-center">No connected leads or contacts</div>
                                      </li>
                                    )}
                                  </>
                                )}
                              </ul>
                            </>
                          )}
                        </div>
                      )}

                      {/* Action Dropdown */}
                      <div className="relative">
                        <button
                          className="btn btn-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowActionDropdown(!showActionDropdown);
                            setShowConnectedLeadsDropdown(false);
                          }}
                        >
                          <UserPlusIcon className="w-4 h-4 mr-2" />
                          Actions
                          <ChevronDownIcon className="w-4 h-4 ml-2" />
                        </button>
                        {showActionDropdown && (
                          <>
                            <div
                              className="fixed inset-0 z-40"
                              onClick={() => setShowActionDropdown(false)}
                            />
                            <ul
                              className="absolute right-0 top-full mt-2 menu p-2 shadow-lg bg-base-100 rounded-box w-64 z-50 border border-gray-200"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <li>
                                <button
                                  onClick={() => {
                                    setShowActionDropdown(false);
                                    handleConvertToLead(selectedLead);
                                  }}
                                  className="flex items-center gap-2 w-full text-left"
                                >
                                  <UserPlusIcon className="w-4 h-4" />
                                  <span>Convert to Lead</span>
                                </button>
                              </li>
                              <li>
                                <button
                                  onClick={() => {
                                    setShowActionDropdown(false);
                                    setActionType('sublead');
                                    setShowLeadSearchModal(true);
                                    setLeadSearchQuery('');
                                    setLeadSearchResults([]);
                                  }}
                                  className="flex items-center gap-2 w-full text-left"
                                >
                                  <UserGroupIcon className="w-4 h-4" />
                                  <span>Create a Sublead</span>
                                </button>
                              </li>
                              <li>
                                <button
                                  onClick={() => {
                                    setShowActionDropdown(false);
                                    setActionType('contact');
                                    setShowLeadSearchModal(true);
                                    setLeadSearchQuery('');
                                    setLeadSearchResults([]);
                                  }}
                                  className="flex items-center gap-2 w-full text-left"
                                >
                                  <LinkIcon className="w-4 h-4" />
                                  <span>Add as Contact to Lead</span>
                                </button>
                              </li>
                            </ul>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0 overscroll-contain" style={isMobile ? { flex: '1 1 auto', paddingBottom: '120px', WebkitOverflowScrolling: 'touch' } : {}}>
                  {chatLoading ? (
                    <div className="flex items-center justify-center h-full text-gray-500">
                      <div className="flex flex-col items-center gap-3">
                        <span className="loading loading-spinner loading-lg text-blue-500" />
                        <p className="text-sm">Loading conversation…</p>
                      </div>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <EnvelopeIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p className="text-lg font-medium">No messages yet</p>
                      <p className="text-sm">Messages from this sender will appear here</p>
                    </div>
                  ) : (
                    messages.map((message, index) => {
                      const showDateSeparator = index === 0 ||
                        new Date(message.sent_at).toDateString() !== new Date(messages[index - 1].sent_at).toDateString();
                      const isOutgoing = message.direction === 'outgoing';
                      const messageRtl = emailContentLikelyHebrew(
                        message.subject,
                        message.body_preview,
                        message.body_html || undefined
                      );

                      // Create a unique key combining message_id, direction, and sent_at to ensure uniqueness
                      const uniqueKey = `${message.message_id || message.id || 'msg'}_${message.direction}_${message.sent_at}_${index}`;

                      return (
                        <React.Fragment key={uniqueKey}>
                          {showDateSeparator && (
                            <div className="flex justify-center my-4">
                              <div className="bg-white border border-gray-200 text-gray-600 text-sm font-medium px-3 py-1.5 rounded-full shadow-sm">
                                {formatDateSeparator(message.sent_at)}
                              </div>
                            </div>
                          )}

                          <div className={`flex flex-col ${isOutgoing ? 'items-end' : 'items-start'}`}>
                            <div className={`text-xs font-semibold mb-1 ${isOutgoing ? 'text-blue-600 text-right' : 'text-gray-600 text-left'}`}>
                              {isOutgoing ? (currentUserFullName || userEmail || 'You') : (message.sender_name || selectedLead?.sender_name || 'Sender')}
                            </div>
                            <div
                              dir={messageRtl ? 'rtl' : 'ltr'}
                              className="max-w-full md:max-w-[70%] rounded-2xl px-4 py-2 shadow-sm border border-gray-200 bg-white text-gray-900 text-start"
                              style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', unicodeBidi: 'plaintext' }}
                            >
                              <div className="mb-2">
                                <div className="text-sm font-semibold text-gray-900">{message.subject}</div>
                                <div className="text-xs text-gray-500 mt-1">
                                  {new Date(message.sent_at).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  })}
                                </div>
                              </div>

                              {message.body_html ? (
                                <div
                                  dangerouslySetInnerHTML={{ __html: message.body_html }}
                                  className={`prose prose-sm max-w-none text-gray-700 break-words [&_*]:max-w-full ${messageRtl ? 'prose-headings:text-start prose-p:text-start' : ''}`}
                                  style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                                />
                              ) : message.body_preview ? (
                                <div
                                  className="text-gray-700 whitespace-pre-wrap break-words text-start"
                                  style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                                >
                                  {message.body_preview}
                                </div>
                              ) : (
                                <div className="text-gray-500 italic">No content available</div>
                              )}

                              {message.attachments && Array.isArray(message.attachments) && message.attachments.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-gray-200 text-start">
                                  <div className="text-xs font-medium text-gray-600 mb-2">
                                    Attachments ({message.attachments.length}):
                                  </div>
                                  <div className="space-y-1">
                                    {message.attachments.map((attachment: any, idx: number) => {
                                      if (!attachment || (!attachment.id && !attachment.name)) {
                                        return null; // Skip invalid attachments
                                      }

                                      const attachmentKey = attachment.id || attachment.name || `${message.id}-${idx}`;
                                      const attachmentName = attachment.name || `Attachment ${idx + 1}`;
                                      const isDownloading =
                                        attachment.id && downloadingAttachments[attachment.id];

                                      return (
                                        <button
                                          key={attachmentKey}
                                          type="button"
                                          className={`flex items-center gap-2 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors w-full ${messageRtl ? 'flex-row-reverse text-start' : 'text-start'}`}
                                          onClick={() => handleAttachmentDownload(message, attachment)}
                                          disabled={Boolean(isDownloading)}
                                        >
                                          {isDownloading ? (
                                            <span className="loading loading-spinner loading-xs text-blue-500" />
                                          ) : (
                                            <DocumentTextIcon className="w-4 h-4 flex-shrink-0" />
                                          )}
                                          <span className="truncate flex-1">
                                            {attachmentName}
                                          </span>
                                          {attachment.size && (
                                            <span className="text-xs text-gray-500 flex-shrink-0">
                                              ({(attachment.size / 1024).toFixed(1)} KB)
                                            </span>
                                          )}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </React.Fragment>
                      );
                    })
                  )}
                  {!chatLoading && <div ref={messagesEndRef} />}
                </div>

                <div className="border-t border-gray-200 bg-white">
                  <div className="p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm gap-1.5"
                        onClick={() => applyComposeAction('reply')}
                      >
                        <ArrowUturnLeftIcon className="h-4 w-4" />
                        Reply
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm gap-1.5"
                        onClick={() => applyComposeAction('reply_all')}
                        disabled={messages.length === 0}
                      >
                        <ArrowUturnLeftIcon className="h-4 w-4" />
                        Reply all
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm gap-1.5"
                        onClick={() => applyComposeAction('forward')}
                        disabled={messages.length === 0}
                      >
                        <ArrowUturnRightIcon className="h-4 w-4" />
                        Forward
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm gap-1.5 text-error"
                        onClick={() => void handleDeleteActiveLeadEmail()}
                        disabled={messages.length === 0}
                      >
                        <TrashIcon className="h-4 w-4" />
                        Delete
                      </button>
                    </div>

                    {(composeToRecipients.length > 0 || composeCcRecipients.length > 0) && (
                      <div className="space-y-1 text-xs text-gray-600">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="font-semibold text-gray-700">To:</span>
                          {composeToRecipients.length === 0 ? (
                            <span className="text-gray-400">Add recipients for forward…</span>
                          ) : (
                            composeToRecipients.map((email) => (
                              <span
                                key={email}
                                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5"
                              >
                                {email}
                                <button
                                  type="button"
                                  className="text-gray-400 hover:text-gray-700"
                                  onClick={() =>
                                    setComposeToRecipients((prev) => prev.filter((e) => e !== email))
                                  }
                                  aria-label={`Remove ${email}`}
                                >
                                  ×
                                </button>
                              </span>
                            ))
                          )}
                          {composeMode === 'forward' && (
                            <input
                              type="email"
                              className="input input-bordered input-xs w-48"
                              placeholder="Add recipient…"
                              onKeyDown={(e) => {
                                if (e.key !== 'Enter') return;
                                e.preventDefault();
                                const value = (e.target as HTMLInputElement).value.trim().toLowerCase();
                                if (!value.includes('@')) return;
                                setComposeToRecipients((prev) =>
                                  prev.includes(value) ? prev : [...prev, value],
                                );
                                (e.target as HTMLInputElement).value = '';
                              }}
                            />
                          )}
                        </div>
                        {composeCcRecipients.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="font-semibold text-gray-700">Cc:</span>
                            {composeCcRecipients.map((email) => (
                              <span
                                key={email}
                                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5"
                              >
                                {email}
                                <button
                                  type="button"
                                  className="text-gray-400 hover:text-gray-700"
                                  onClick={() =>
                                    setComposeCcRecipients((prev) => prev.filter((e) => e !== email))
                                  }
                                  aria-label={`Remove ${email}`}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {showAISuggestions && (
                      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-2 relative">
                        <div className="flex items-center gap-2 text-sm font-semibold text-blue-700 pr-8">
                          <SparklesIcon className="w-4 h-4" />
                          <span>AI Suggestions</span>
                          <button
                            type="button"
                            className="ml-auto text-blue-500 hover:text-blue-700 transition-colors"
                            onClick={() => {
                              setShowAISuggestions(false);
                              setAiSuggestions([]);
                            }}
                          >
                            <XMarkIcon className="w-4 h-4" />
                          </button>
                        </div>
                        {isLoadingAI ? (
                          <p className="text-sm text-blue-600 animate-pulse">Generating suggestions...</p>
                        ) : aiSuggestions.length > 0 ? (
                          aiSuggestions.map((suggestion, idx) => (
                            <button
                              key={idx}
                              className="w-full text-left text-sm text-gray-800 bg-white border border-blue-100 rounded-lg p-2 hover:bg-blue-50 transition"
                              onClick={() => applyAISuggestion(suggestion)}
                            >
                              {suggestion}
                            </button>
                          ))
                        ) : (
                          <p className="text-sm text-blue-600">No suggestions available.</p>
                        )}
                      </div>
                    )}

                    {attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {attachments.map((file, index) => (
                          <div
                            key={`${file.name}-${index}`}
                            className="flex items-center gap-2 bg-gray-100 border border-gray-200 rounded-full px-3 py-1 text-sm"
                          >
                            <PaperClipIcon className="w-4 h-4 text-gray-500" />
                            <span className="max-w-[140px] truncate">{file.name}</span>
                            <button
                              className="text-gray-400 hover:text-gray-600"
                              onClick={() => removeAttachment(index)}
                            >
                              <XMarkIcon className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex items-end gap-3 flex-wrap">
                      <div className="flex flex-col items-center gap-3 relative">
                        <button
                          type="button"
                          className="btn btn-outline btn-sm rounded-full px-4"
                          onClick={() => setShowSubjectInput(true)}
                        >
                          S
                        </button>
                        <div className="relative">
                          <button
                            type="button"
                            className="btn btn-circle btn-ghost border border-gray-200"
                            onClick={() => setIsActionMenuOpen((prev) => !prev)}
                          >
                            <PlusIcon className="w-5 h-5 text-gray-700" />
                          </button>
                          {isActionMenuOpen && (
                            <div className="absolute bottom-14 left-0 bg-white border border-gray-200 rounded-xl shadow-lg w-48 z-30">
                              <button
                                className="w-full flex items-center gap-2 px-4 py-3 text-sm hover:bg-gray-50"
                                onClick={() => {
                                  setIsActionMenuOpen(false);
                                  fileInputRef.current?.click();
                                }}
                              >
                                <PaperClipIcon className="w-4 h-4 text-gray-600" />
                                Add Attachment
                              </button>
                              <button
                                className="w-full flex items-center gap-2 px-4 py-3 text-sm hover:bg-gray-50"
                                onClick={handleAISuggestions}
                              >
                                <SparklesIcon className="w-4 h-4 text-gray-600" />
                                AI Suggestion
                              </button>
                            </div>
                          )}
                        </div>
                        {showSubjectInput && (
                          <>
                            <div
                              className="fixed inset-0 z-40"
                              onClick={() => setShowSubjectInput(false)}
                            />
                            <div className="absolute bottom-32 left-0 z-50 bg-white border border-gray-200 rounded-xl shadow-xl w-72 p-4 space-y-3">
                              <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold text-gray-900">Edit Subject</h4>
                                <button
                                  type="button"
                                  className="text-gray-400 hover:text-gray-600"
                                  onClick={() => setShowSubjectInput(false)}
                                >
                                  <XMarkIcon className="w-4 h-4" />
                                </button>
                              </div>
                              <input
                                ref={subjectInputRef}
                                type="text"
                                dir={emailContentLikelyHebrew(subject) ? 'rtl' : 'ltr'}
                                value={subject}
                                onChange={(e) => setSubject(e.target.value)}
                                placeholder="Subject"
                                className="input input-bordered w-full"
                              />
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => setShowSubjectInput(false)}
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  onClick={() => setShowSubjectInput(false)}
                                >
                                  Done
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>

                      <textarea
                        ref={textareaRef}
                        dir={emailContentLikelyHebrew(newMessage) ? 'rtl' : 'ltr'}
                        value={newMessage}
                        onChange={(e) => handleMessageChange(e.target.value)}
                        placeholder="Write your reply..."
                        className="textarea textarea-bordered flex-1 w-full text-base"
                        rows={3}
                        style={{ minHeight: '120px', overflowY: 'auto', resize: 'none' }}
                      />

                      <button
                        className="btn btn-primary btn-circle h-12 w-12 flex items-center justify-center"
                        onClick={handleSendEmail}
                        disabled={isSending || !newMessage.trim() || !selectedLead}
                      >
                        <PaperAirplaneIcon className="w-5 h-5" />
                        <span className="sr-only">Send</span>
                      </button>
                    </div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFileInputChange}
                  />
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <EnvelopeIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                  <p className="text-lg font-medium">Select an email lead</p>
                  <p className="text-sm">Choose a lead from the list to view their email thread</p>
                </div>
              </div>
            )}
          </div>
      </div>

      {/* Lead Search Modal */}
      {showLeadSearchModal && (
        <div className="fixed inset-0 z-[9999] bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                {actionType === 'sublead' ? 'Select Parent Lead for Sublead' : 'Select Lead to Add Contact'}
              </h3>
              <button
                onClick={() => {
                  setShowLeadSearchModal(false);
                  setLeadSearchQuery('');
                  setLeadSearchResults([]);
                  setActionType(null);
                }}
                className="btn btn-ghost btn-sm btn-circle"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Search Input */}
            <div className="p-4 border-b border-gray-200">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by lead number, name, or email..."
                  value={leadSearchQuery}
                  onChange={(e) => setLeadSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoFocus
                />
              </div>
            </div>

            {/* Search Results */}
            <div className="flex-1 overflow-y-auto p-4">
              {isSearchingLeads ? (
                <div className="flex items-center justify-center py-8">
                  <div className="loading loading-spinner loading-lg text-blue-600"></div>
                </div>
              ) : leadSearchResults.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  {leadSearchQuery.length >= 2 ? (
                    <>
                      <p className="text-lg font-medium">No leads found</p>
                      <p className="text-sm">Try a different search term</p>
                    </>
                  ) : (
                    <>
                      <MagnifyingGlassIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p className="text-lg font-medium">Search for a lead</p>
                      <p className="text-sm">Enter at least 2 characters to search</p>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {leadSearchResults.map((lead) => (
                    <button
                      key={`${lead.id}-${lead.isLegacy}`}
                      onClick={() => {
                        if (actionType === 'sublead') {
                          handleCreateSublead(lead);
                        } else if (actionType === 'contact') {
                          handleAddAsContact(lead);
                        }
                      }}
                      className="w-full text-left p-4 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-blue-300 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-gray-900">{lead.lead_number}</span>
                          </div>
                          <p className="text-sm font-medium text-gray-700 truncate">{lead.name || 'No name'}</p>
                          {lead.email && (
                            <p className="text-xs text-gray-500 truncate">{lead.email}</p>
                          )}
                          {(lead.phone || lead.mobile) && (
                            <p className="text-xs text-gray-500 truncate">{lead.phone || lead.mobile}</p>
                          )}
                        </div>
                        <div className="ml-4 flex-shrink-0">
                          {actionType === 'sublead' ? (
                            <UserGroupIcon className="w-5 h-5 text-blue-600" />
                          ) : (
                            <LinkIcon className="w-5 h-5 text-blue-600" />
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailThreadLeadPage;

