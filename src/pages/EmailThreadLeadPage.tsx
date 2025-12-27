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
} from '@heroicons/react/24/outline';

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
  const [showLeadSearchModal, setShowLeadSearchModal] = useState(false);
  const [leadSearchQuery, setLeadSearchQuery] = useState('');
  const [leadSearchResults, setLeadSearchResults] = useState<any[]>([]);
  const [isSearchingLeads, setIsSearchingLeads] = useState(false);
  const [actionType, setActionType] = useState<'sublead' | 'contact' | null>(null);

  // Composer state
  const [newMessage, setNewMessage] = useState('');
  const [subject, setSubject] = useState('');
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
      // Count ALL unread incoming emails to office@lawoffice.org.il
      // IMPORTANT: We do NOT filter by client_id, legacy_id, or contact_id
      // This count includes ALL emails sent to office@lawoffice.org.il, regardless of link status
      const { count, error } = await supabase
        .from('emails')
        .select('id', { count: 'exact', head: true })
        .eq('direction', 'incoming')
        .or('is_read.is.null,is_read.eq.false')
        .ilike('recipient_list', '%office@lawoffice.org.il%');

      if (error) {
        console.error('Error fetching unread email count:', error);
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
        // Mark ALL incoming emails to office@lawoffice.org.il as read for this sender
        // IMPORTANT: We do NOT filter by client_id, legacy_id, or contact_id
        // This updates ALL emails sent to office@lawoffice.org.il from this sender, regardless of link status
        const { error } = await supabase
          .from('emails')
          .update({
            is_read: true,
            read_at: new Date().toISOString(),
            read_by: null,
          })
          .eq('direction', 'incoming')
          .ilike('sender_email', senderEmail)
          .ilike('recipient_list', '%office@lawoffice.org.il%')
          .or('is_read.is.null,is_read.eq.false');

        if (error) {
          // Handle permission errors gracefully - these can occur due to database triggers
          // The UI will still update correctly even if the database update fails
          if (error.code === '42501' && error.message?.includes('pending_stage_evaluations')) {
            // This is a known issue with database triggers - log as warning, not error
            console.warn('⚠️ Could not mark emails as read in database (trigger permission issue), but UI will update correctly');
          } else {
            console.error('Error marking emails as read:', error);
          }
          // Continue with UI update even if database update fails
        }

        // Update UI regardless of database update success
        const normalizedEmail = senderEmail.toLowerCase();
        setLeads(prev =>
          prev.map(lead =>
            (lead.sender_email || '').toLowerCase() === normalizedEmail
              ? { ...lead, unread_count: 0 }
              : lead
          )
        );
        dispatchEmailUnreadCount();
      } catch (error) {
        console.error('Unexpected error marking emails as read:', error);
        // Still update UI even on unexpected errors
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

  // Fetch email leads (grouped by sender email)
  useEffect(() => {
    const fetchEmailLeads = async () => {
      try {
        setLoading(true);
        
        // Fetch ALL incoming emails to office@lawoffice.org.il
        // IMPORTANT: We do NOT filter by client_id, legacy_id, or contact_id
        // This query returns ALL emails sent to office@lawoffice.org.il, regardless of:
        // - Whether they are linked to a lead (client_id or legacy_id)
        // - Whether they are linked to a contact (contact_id)
        // - Whether they have no links at all (all ID fields are null)
        // Note: Using limit() to fetch more than default 1000 emails
        const { data: emailsData, error: emailsError } = await supabase
          .from('emails')
          .select('id, message_id, sender_name, sender_email, recipient_list, subject, body_html, body_preview, sent_at, direction, is_read, client_id, legacy_id, contact_id')
          .eq('direction', 'incoming')
          .ilike('recipient_list', '%office@lawoffice.org.il%')
          .order('sent_at', { ascending: false })
          .limit(10000); // Fetch up to 10,000 emails (adjust if needed)

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
              last_message_preview: email.body_preview || email.body_html || '',
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
      } catch (error) {
        console.error('Error fetching email leads:', error);
        toast.error('Failed to load email leads');
      } finally {
        setLoading(false);
      }
    };

    fetchEmailLeads();
  }, []);

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

    try {
      setChatLoading(true);
      
      // Fetch ALL incoming messages to office@lawoffice.org.il from this sender
      // IMPORTANT: We do NOT filter by client_id, legacy_id, or contact_id
      // This query returns ALL emails sent to office@lawoffice.org.il from this sender, regardless of:
      // - Whether they are linked to a lead (client_id or legacy_id)
      // - Whether they are linked to a contact (contact_id)
      // - Whether they have no links at all (all ID fields are null)
      const incomingPromise = supabase
        .from('emails')
        .select(
          'id, message_id, sender_name, sender_email, recipient_list, subject, body_html, body_preview, sent_at, direction, attachments, client_id, legacy_id, contact_id'
        )
        .eq('direction', 'incoming')
        .ilike('recipient_list', '%office@lawoffice.org.il%')
        .eq('sender_email', selectedLead.sender_email)
        .order('sent_at', { ascending: true })
        .limit(200);

      // Fetch outgoing messages
      const outgoingPromise = userEmail
        ? supabase
            .from('emails')
            .select(
              'id, message_id, sender_name, sender_email, recipient_list, subject, body_html, body_preview, sent_at, direction, attachments'
            )
            .eq('direction', 'outgoing')
            .eq('sender_email', userEmail)
            .ilike('recipient_list', `%${selectedLead.sender_email}%`)
            .order('sent_at', { ascending: true })
            .limit(200)
        : Promise.resolve({ data: [], error: null });

      const [{ data: incomingData, error: incomingError }, { data: outgoingRaw, error: outgoingError }] =
        await Promise.all([incomingPromise, outgoingPromise]);

      if (incomingError) {
        console.error('Error fetching incoming messages:', incomingError);
        return;
      }
      if (outgoingError) {
        console.error('Error fetching outgoing messages:', outgoingError);
      }

      const outgoingData = outgoingRaw || [];

      const formatMessage = (email: any, dbId: string | number): EmailMessage & { _dbId: string | number } => {
        // Parse attachments from JSONB - it might be a string or already an array
        let parsedAttachments: any[] = [];
        if (email.attachments) {
          try {
            // If it's a string, parse it
            if (typeof email.attachments === 'string') {
              parsedAttachments = JSON.parse(email.attachments);
            } 
            // If it's already an array, use it directly
            else if (Array.isArray(email.attachments)) {
              parsedAttachments = email.attachments;
            }
            // If it's an object with a value property (Graph API format), extract the array
            else if (email.attachments.value && Array.isArray(email.attachments.value)) {
              parsedAttachments = email.attachments.value;
            }
            // If it's a single object, wrap it in an array
            else if (typeof email.attachments === 'object') {
              parsedAttachments = [email.attachments];
            }
          } catch (e) {
            console.error('Error parsing attachments:', e, email.attachments);
            parsedAttachments = [];
          }
        }
        
        // Filter out inline attachments that shouldn't be displayed as separate attachments
        parsedAttachments = parsedAttachments.filter((att: any) => {
          // Only show non-inline attachments or if isInline is false/undefined
          return att && !att.isInline && att.name;
        });

        return {
          id: email.message_id || email.id,
          message_id: email.message_id || email.id,
          subject: email.subject || 'No Subject',
          body_html: email.body_html,
          body_preview: email.body_preview || email.body_html,
          sender_name: email.sender_name || selectedLead.sender_name,
          sender_email: email.sender_email || selectedLead.sender_email,
          recipient_list: email.recipient_list || '',
          sent_at: email.sent_at,
          direction: email.direction === 'outgoing' ? 'outgoing' : 'incoming',
          attachments: parsedAttachments,
          _dbId: dbId, // Store database ID for deduplication
        };
      };

      const formattedMessages = [
        ...(incomingData || []).map((email: any) => formatMessage(email, email.id)),
        ...(outgoingData || []).map((email: any) => formatMessage(email, email.id))
      ];

      // Deduplicate messages - prioritize same timestamp + sender as duplicate
      // Primary key: sender_email + sent_at (same sender + same time = duplicate)
      // Secondary: message_id (if available)
      const messageMap = new Map<string, EmailMessage & { _dbId: string | number }>();
      const duplicateLog: Array<{ key: string; count: number; message_ids: string[] }> = [];
      
      formattedMessages.forEach((message) => {
        // Create a unique key for deduplication
        // PRIMARY: Use sender_email + sent_at (normalized timestamp) as the main deduplication key
        // This ensures same sender + same time = same email, regardless of message_id
        const sentAt = message.sent_at ? new Date(message.sent_at).toISOString() : '';
        const normalizedSender = (message.sender_email || '').toLowerCase().trim();
        
        // Primary deduplication key: sender + timestamp
        // Round timestamp to nearest second to handle microsecond differences
        let timestampKey = sentAt;
        if (sentAt) {
          try {
            const date = new Date(sentAt);
            // Round to nearest second
            date.setMilliseconds(0);
            timestampKey = date.toISOString();
          } catch (e) {
            // Keep original if parsing fails
            timestampKey = sentAt;
          }
        }
        
        const uniqueKey = `${normalizedSender}_${timestampKey}`;
        
        // Track duplicates for logging
        const existingMessage = messageMap.get(uniqueKey);
        if (existingMessage) {
          const existingEntry = duplicateLog.find(d => d.key === uniqueKey);
          if (existingEntry) {
            existingEntry.count++;
            existingEntry.message_ids.push(String(message._dbId));
          } else {
            duplicateLog.push({
              key: uniqueKey,
              count: 2,
              message_ids: [String(existingMessage._dbId), String(message._dbId)]
            });
          }
        }
        
        // If we already have this message (same sender + timestamp), keep the one with more complete data
        if (!existingMessage) {
          messageMap.set(uniqueKey, message);
        } else {
          // Prefer message with message_id, or with more complete body_html
          const existingHasMessageId = existingMessage.message_id && existingMessage.message_id.trim();
          const currentHasMessageId = message.message_id && message.message_id.trim();
          
          if (currentHasMessageId && !existingHasMessageId) {
            messageMap.set(uniqueKey, message);
          } else if (existingHasMessageId && !currentHasMessageId) {
            // Keep existing
          } else {
            // Both have or don't have message_id, prefer the one with more complete body
            const existingBodyLength = (existingMessage.body_html || existingMessage.body_preview || '').length;
            const currentBodyLength = (message.body_html || message.body_preview || '').length;
            
            // If body lengths are equal, prefer the one with later database ID (more recent insert)
            if (currentBodyLength > existingBodyLength) {
              messageMap.set(uniqueKey, message);
            } else if (currentBodyLength === existingBodyLength) {
              // Compare database IDs - keep the one with higher ID (more recent)
              const existingDbId = typeof existingMessage._dbId === 'string' ? parseInt(existingMessage._dbId) : existingMessage._dbId;
              const currentDbId = typeof message._dbId === 'string' ? parseInt(message._dbId) : message._dbId;
              if (currentDbId > existingDbId) {
                messageMap.set(uniqueKey, message);
              }
            }
            // Otherwise keep existing
          }
        }
      });

      // Remove _dbId before setting state (it's only for deduplication)
      const combinedMessages = Array.from(messageMap.values())
        .map(({ _dbId, ...message }) => message as EmailMessage)
        .sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());

      // Debug: Log messages with attachments
      const messagesWithAttachments = combinedMessages.filter(msg => msg.attachments && msg.attachments.length > 0);
      if (messagesWithAttachments.length > 0) {
        console.log('📎 Messages with attachments found:', messagesWithAttachments.length);
        messagesWithAttachments.forEach((msg, idx) => {
          if (idx < 3) { // Only log first 3
            console.log(`  Message ${idx + 1}:`, {
              subject: msg.subject,
              attachments: msg.attachments,
              attachmentCount: msg.attachments.length
            });
          }
        });
      } else {
        console.log('📎 No messages with attachments found. Sample email data:', incomingData?.[0]);
      }

      // Log deduplication info with details
      if (formattedMessages.length !== combinedMessages.length) {
        console.log(`🔍 Deduplicated ${formattedMessages.length} messages down to ${combinedMessages.length} unique messages`);
        if (duplicateLog.length > 0) {
          console.log('📋 Duplicate details:', duplicateLog);
          duplicateLog.forEach(dup => {
            console.log(`  - Found ${dup.count} duplicates for key: ${dup.key.substring(0, 50)}... (DB IDs: ${dup.message_ids.join(', ')})`);
          });
        }
      }
      
      // Also log if we see duplicate message_ids in the raw data
      const messageIdCounts = new Map<string, number>();
      formattedMessages.forEach(msg => {
        if (msg.message_id) {
          messageIdCounts.set(msg.message_id, (messageIdCounts.get(msg.message_id) || 0) + 1);
        }
      });
      const duplicateMessageIds = Array.from(messageIdCounts.entries()).filter(([_, count]) => count > 1);
      if (duplicateMessageIds.length > 0) {
        console.warn(`⚠️ Found ${duplicateMessageIds.length} message_id(s) with duplicates in database:`, duplicateMessageIds.map(([id, count]) => `${id.substring(0, 30)}... (${count}x)`));
      }

      setMessages(combinedMessages);
      await markEmailsAsRead(selectedLead.sender_email);
      
      // Hydrate email bodies if they're missing or truncated
      if (userId && combinedMessages.length > 0) {
        hydrateEmailBodies(combinedMessages);
      }
    } catch (error) {
      console.error('Error fetching messages:', error);
    } finally {
      setChatLoading(false);
    }
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

    const updates: Record<string, { html: string; preview: string }> = {};

    await Promise.all(
      requiresHydration.map(async message => {
        const messageId = message.message_id || message.id;
        if (!messageId) return;
        
        try {
          const rawContent = await fetchEmailBodyFromBackend(userId, messageId);
          if (!rawContent || typeof rawContent !== 'string') return;

          // Store the raw content as both html and preview
          updates[messageId] = {
            html: rawContent,
            preview: rawContent,
          };

          // Update the database
          await supabase
            .from('emails')
            .update({ body_html: rawContent, body_preview: rawContent })
            .eq('message_id', messageId);

          console.log(`✅ Hydrated body for message: ${message.subject?.substring(0, 50)}...`);
        } catch (err) {
          console.warn('⚠️ Failed to hydrate email body from backend:', err);
        }
      })
    );

    // Update the messages state with hydrated bodies
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
          };
        })
      );
    }
  }, [userId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    if (selectedLead) {
      setSubject(selectedLead.last_subject ? `Re: ${selectedLead.last_subject}` : '');
      setNewMessage('');
      setAttachments([]);
      setShowAISuggestions(false);
      setAiSuggestions([]);
      setMessages([]);
      setChatLoading(true);
      if (textareaRef.current) {
        textareaRef.current.style.height = '100px';
      }
      setShowSubjectInput(false);
    } else {
      setMessages([]);
      setChatLoading(false);
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

  const handleSendEmail = async () => {
    if (!selectedLead || !userId || !newMessage.trim()) {
      toast.error('Please enter a message before sending');
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
        to: [selectedLead.sender_email],
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
        recipient_list: selectedLead.sender_email,
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
      <div className="h-full flex flex-col overflow-hidden" style={{ height: '100vh', maxHeight: '100vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
            <EnvelopeIcon className="w-6 h-6 md:w-8 md:h-8 text-blue-600 flex-shrink-0" />
            <h2 className="text-lg md:text-2xl font-bold text-gray-900 flex-shrink-0">Email Leads</h2>
            <div className="flex items-center gap-2">
              <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full">
                {leads.length} Leads
              </span>
            </div>
          </div>
          <button
            onClick={() => window.history.back()}
            className="btn btn-ghost btn-circle flex-shrink-0"
          >
            <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel - Leads List */}
          <div className={`${isMobile ? 'w-full' : 'w-80'} border-r border-gray-200 flex flex-col ${isMobile && showChat ? 'hidden' : ''} overflow-hidden`}>
            {/* Search Bar */}
            <div className="p-3 border-b border-gray-200 flex-shrink-0">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by email or name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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

                  return (
                    <div
                      key={lead.id}
                      onClick={() => {
                        setSelectedLead(lead);
                        if (isMobile) {
                          setShowChat(true);
                        }
                      }}
                      className={`p-3 md:p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors overflow-hidden ${
                        isSelected ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-0 w-full">
                        {/* Avatar */}
                        <div className="w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center flex-shrink-0 relative border bg-blue-100 border-blue-200 text-blue-700">
                          {lead.sender_name && lead.sender_name !== lead.sender_email ? (
                            <span className="font-semibold text-sm md:text-lg">
                              {lead.sender_name.charAt(0).toUpperCase()}
                            </span>
                          ) : (
                            <EnvelopeIcon className="w-5 h-5 md:w-6 md:h-6 text-blue-700" />
                          )}
                        </div>

                        {/* Lead Info */}
                        <div className="flex-1 min-w-0 overflow-hidden">
                          <div className="flex items-center justify-between gap-2 mb-1 min-w-0">
                            <div className="flex flex-col min-w-0 flex-1">
                              <h3 className="font-semibold text-gray-900 truncate">
                                {lead.sender_name && lead.sender_name !== lead.sender_email 
                                  ? lead.sender_name 
                                  : lead.sender_email || 'Unknown Sender'}
                              </h3>
                              {lead.sender_name && lead.sender_name !== lead.sender_email && (
                                <p className="text-xs text-gray-500 truncate">
                                  {lead.sender_email}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <span className="text-xs text-gray-500 whitespace-nowrap">
                                {formatTime(lead.last_message_at)}
                              </span>
                              <span className={`text-xs rounded-full px-1.5 py-0.5 min-w-[20px] h-5 flex items-center justify-center flex-shrink-0 ${lead.unread_count && lead.unread_count > 0 ? 'bg-blue-500 text-white' : 'invisible'}`}>
                                {lead.unread_count && lead.unread_count > 0 ? lead.unread_count : '0'}
                              </span>
                            </div>
                          </div>
                          
                          <p className="text-sm text-gray-600 truncate mb-1 font-medium">
                            {lead.last_subject}
                          </p>
                          <p className="text-sm text-gray-600 truncate">
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

          {/* Right Panel - Chat */}
          <div className={`${isMobile ? 'w-full' : 'flex-1'} flex flex-col bg-white ${isMobile && !showChat ? 'hidden' : ''}`} style={isMobile ? { height: '100vh', overflow: 'hidden', position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40 } : {}}>
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
                      {/* Action Dropdown */}
                      <div className="relative">
                        <button
                          className="btn btn-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowActionDropdown(!showActionDropdown);
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
                              className="max-w-full md:max-w-[70%] rounded-2xl px-4 py-2 shadow-sm border border-gray-200 bg-white text-gray-900"
                              style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
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
                                  className="prose prose-sm max-w-none text-gray-700 break-words"
                                  style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                                />
                              ) : message.body_preview ? (
                                <div
                                  className="text-gray-700 whitespace-pre-wrap break-words"
                                  style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                                >
                                  {message.body_preview}
                                </div>
                              ) : (
                                <div className="text-gray-500 italic">No content available</div>
                              )}

                              {message.attachments && Array.isArray(message.attachments) && message.attachments.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-gray-200">
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
                                          className="flex items-center gap-2 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors w-full text-left"
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
                            {lead.isLegacy && (
                              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Legacy</span>
                            )}
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

