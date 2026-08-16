import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAiMessageSuggestion } from '../lib/aiMessageSuggestion';
import { toast } from 'react-hot-toast';
import { buildOutgoingHtmlWithSignature } from '../lib/emailSignature';
import { convertBodyToHtml } from '../lib/emailBodyHtml';
import { sendEmailViaBackend, downloadAttachmentFromBackend, fetchEmailBodyFromBackend } from '../lib/mailboxApi';
import EmailSentSuccessModal from '../components/EmailSentSuccessModal';
import { ComposeSignaturePreview } from '../components/signature/ComposeSignaturePreview';
import { ComposeAttachmentPreviews } from '../components/signature/ComposeAttachmentPreviews';
import { fetchHeaderOfficeInboxUnreadEmails } from '../lib/headerEmailNotifications';
import { isUsableEmployeePhotoUrl, resolveEmployeePhotoUrl } from '../lib/employeePhotoUrl';
import { usePersistedState } from '../hooks/usePersistedState';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import {
  readEmailSidepanelCache,
  writeEmailSidepanelCache,
  invalidateEmailSidepanelCache,
} from '../lib/interactions/emailSidepanelCache';
import WhatsAppDoubleCheckIcon from '../components/whatsapp/WhatsAppDoubleCheckIcon';
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
  TrashIcon,
  InboxIcon,
} from '@heroicons/react/24/outline';
import {
  formatEmailHtmlForReadingPane,
  sanitizeEmailHtml,
} from '../components/client-tabs/interactionsEmailViewUtils';

type EmailReadFilter = 'all' | 'unread' | 'read';

const OFFICE_INBOX_EMAIL = 'office@lawoffice.org.il';
const OFFICE_INBOX_CACHE_KEY = 'office-inbox:leads';
const officeThreadCacheKey = (senderEmail: string) =>
  `office-thread:${String(senderEmail || '').toLowerCase().trim()}`;

function leadMatchesReadFilter(lead: { unread_count?: number }, filter: EmailReadFilter): boolean {
  if (filter === 'all') return true;
  const unread = lead.unread_count || 0;
  if (filter === 'unread') return unread > 0;
  return unread === 0;
}

function emailRowTouchesOfficeInbox(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  const recipients = String(row.recipient_list || '').toLowerCase();
  const sender = String(row.sender_email || '').toLowerCase();
  if (recipients.includes(OFFICE_INBOX_EMAIL)) return true;
  if (sender.endsWith('@lawoffice.org.il')) return true;
  return false;
}

function emailRowTouchesSender(
  row: Record<string, unknown> | null | undefined,
  senderEmail: string,
): boolean {
  const needle = String(senderEmail || '')
    .toLowerCase()
    .trim();
  if (!row || !needle) return false;
  const sender = String(row.sender_email || '')
    .toLowerCase()
    .trim();
  const recipients = String(row.recipient_list || '').toLowerCase();
  return sender === needle || recipients.includes(needle);
}

interface EmailLead {
  id: string;
  sender_name: string;
  sender_email: string;
  message_count: number;
  unread_count: number;
  last_message_at: string;
  last_subject: string;
  last_message_preview: string;
  /** Inbox rows for this sender from the sidepanel fetch (avoids re-querying emails). */
  recentEmails?: any[];
}

type OfficeInboxCache = {
  leads: EmailLead[];
  emails: any[];
};

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

/** Exact sender_email values for indexed lookups (never use ILIKE on this table). */
function senderEmailLookupValues(email: string | null | undefined): string[] {
  const raw = String(email || '').trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  return Array.from(new Set([raw, lower]));
}

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

function looksLikeEmailHtml(value: string | null | undefined): boolean {
  const s = String(value || '').trim();
  if (!s) return false;
  return /<\/?[a-z][\s\S]*>/i.test(s) || /&lt;\/?[a-z]/i.test(s);
}

function decodeBasicHtmlEntities(text: string): string {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function htmlOrTextToPlainLines(content: string): string {
  let s = String(content || '');
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeBasicHtmlEntities(s);
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Clean breaklines for sent/outgoing reading pane (collapse junk <br>, keep real paragraphs). */
function cleanOutgoingBreaklines(content: string): string {
  let s = String(content || '');
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Normalize break tags to newlines first
  s = s.replace(/<br\s*\/?\s*>/gi, '\n');
  s = s.replace(/<\/(p|div)>/gi, '\n');
  s = s.replace(/<(p|div)[^>]*>/gi, '');
  // If still mostly plain / lightly tagged, strip remaining tags for clean line layout
  if (!/<(table|img|ul|ol|a)\b/i.test(s)) {
    s = s.replace(/<[^>]+>/g, '');
  }
  s = decodeBasicHtmlEntities(s);
  // Collapse spaces on each line, then collapse 3+ newlines to a single blank line
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s;
}

function linkifyPlainUrls(text: string): string {
  return String(text || '').replace(
    /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi,
    (raw) => {
      let url = raw;
      let trailing = '';
      while (/[.,);:!?]$/.test(url)) {
        trailing = `${url.slice(-1)}${trailing}`;
        url = url.slice(0, -1);
      }
      const href = url.startsWith('http') ? url : `https://${url}`;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>${trailing}`;
    },
  );
}

/** Split free-text body from employee signature for reading-pane layout. */
function splitMessageBodyAndSignature(content: string): { body: string; signature: string | null } {
  const raw = String(content || '').trim();
  if (!raw) return { body: '', signature: null };

  const markerMatch = raw.match(
    /^([\s\S]*?)<div[^>]*data-email-signature=["']?1["']?[^>]*>([\s\S]*?)<\/div>\s*$/i,
  );
  if (markerMatch) {
    return {
      body: markerMatch[1].replace(/(?:<br\s*\/?>\s*)+$/i, '').trim(),
      signature: markerMatch[2].trim() || null,
    };
  }

  const plain = htmlOrTextToPlainLines(raw);
  const lines = plain.split('\n');
  let sigIdx = -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) {
      if (sigIdx !== -1) continue;
      break;
    }
    const looksLikeSigLine =
      /www\.lawoffice\.org\.il/i.test(line) ||
      /\+972[\d\s\-()]+/.test(line) ||
      /\b(Paralegal|Attorney|Advocate|Lawyer|Partner|Legal Assistant|Case Manager)\b/i.test(line) ||
      (/[-–—]/.test(line) && line.length < 70);

    if (looksLikeSigLine) {
      sigIdx = i;
      continue;
    }
    if (sigIdx !== -1) {
      // Include a short name line immediately above the signature block
      if (i >= sigIdx - 1 && line.length <= 60 && !/[.!?]$/.test(line)) {
        sigIdx = i;
        continue;
      }
      break;
    }
  }

  if (sigIdx > 0) {
    const body = lines.slice(0, sigIdx).join('\n').trim();
    const signature = lines.slice(sigIdx).join('\n').trim();
    if (body && signature) return { body, signature };
  }

  const parts = plain.split(/\n\s*\n/);
  if (parts.length >= 2) {
    const signature = parts[parts.length - 1].trim();
    const body = parts.slice(0, -1).join('\n\n').trim();
    if (
      body &&
      signature &&
      (/www\.lawoffice\.org\.il/i.test(signature) ||
        /\+972/.test(signature) ||
        /\b(Paralegal|Attorney|Advocate|Lawyer)\b/i.test(signature))
    ) {
      return { body, signature };
    }
  }

  return { body: raw, signature: null };
}

function plainTextToSafeHtml(text: string): string {
  const escaped = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return linkifyPlainUrls(escaped).replace(/\n/g, '<br>');
}

function renderableEmailHtml(htmlOrText: string | null | undefined): string {
  if (!htmlOrText) return '';
  let raw = String(htmlOrText);
  // Unescape common double-encoded HTML previews
  if (/&lt;\/?[a-z]/i.test(raw) && !/<\/?[a-z][\s\S]*>/i.test(raw)) {
    raw = raw
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }
  // Decode leftover &nbsp; entities that sometimes remain as visible text
  raw = raw.replace(/&nbsp;/gi, ' ').replace(/&#160;/g, ' ');
  return sanitizeEmailHtml(formatEmailHtmlForReadingPane(raw));
}

function getAttachmentMime(attachment: any): string {
  return String(attachment?.contentType || attachment?.content_type || attachment?.mimeType || '').toLowerCase();
}

function getAttachmentMediaKind(attachment: any): 'image' | 'video' | 'audio' | null {
  const mime = getAttachmentMime(attachment);
  const name = String(attachment?.name || '').toLowerCase();
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name)) return 'image';
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|m4v|avi)$/i.test(name)) return 'video';
  if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac)$/i.test(name)) return 'audio';
  return null;
}

function attachmentContentBytesToDataUrl(attachment: any): string | null {
  const bytes = attachment?.contentBytes || attachment?.content_bytes;
  if (!bytes) return null;
  if (String(bytes).startsWith('data:')) return String(bytes);
  const mime = getAttachmentMime(attachment) || 'application/octet-stream';
  return `data:${mime};base64,${bytes}`;
}

const EmailAttachmentMediaPreview: React.FC<{
  messageId: string;
  attachment: any;
  userId: string | null;
  isDownloading: boolean;
  onDownload: () => void;
}> = ({ messageId, attachment, userId, isDownloading, onDownload }) => {
  const kind = getAttachmentMediaKind(attachment);
  const attachmentId = attachment?.id ? String(attachment.id) : '';
  const contentBytesKey = String(attachment?.contentBytes || attachment?.content_bytes || '').slice(0, 32);
  const [previewUrl, setPreviewUrl] = useState<string | null>(() => attachmentContentBytesToDataUrl(attachment));
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fromBytes = attachmentContentBytesToDataUrl(attachment);
    if (fromBytes) {
      setPreviewUrl(fromBytes);
      setLoadFailed(false);
      setLoadingPreview(false);
      return;
    }
    if (!kind || !attachmentId || !userId || !messageId) return;

    setLoadingPreview(true);
    void (async () => {
      try {
        const { blob } = await downloadAttachmentFromBackend(userId, messageId, attachmentId);
        if (cancelled) return;
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setPreviewUrl(url);
        setLoadFailed(false);
      } catch (error) {
        console.warn('Failed to load attachment preview:', error);
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable keys only
  }, [attachmentId, contentBytesKey, kind, messageId, userId]);

  if (!kind) return null;

  const name = attachment.name || 'Media';

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      {loadingPreview && !previewUrl ? (
        <div className="flex h-36 items-center justify-center">
          <span className="loading loading-spinner loading-md text-blue-500" />
        </div>
      ) : loadFailed || !previewUrl ? (
        <button
          type="button"
          onClick={onDownload}
          disabled={isDownloading}
          className="flex h-28 w-full flex-col items-center justify-center gap-1 px-3 text-xs text-gray-500 hover:bg-slate-100 disabled:opacity-60"
        >
          <DocumentTextIcon className="h-6 w-6 text-gray-400" />
          <span className="max-w-full truncate">{name}</span>
          <span>Tap to download</span>
        </button>
      ) : kind === 'image' ? (
        <button
          type="button"
          onClick={onDownload}
          disabled={isDownloading}
          className="block w-full bg-white disabled:opacity-60"
          title={`Download ${name}`}
        >
          <img
            src={previewUrl}
            alt={name}
            className="max-h-64 w-full object-contain"
            loading="lazy"
            onError={() => setLoadFailed(true)}
          />
        </button>
      ) : kind === 'video' ? (
        <video
          src={previewUrl}
          controls
          preload="metadata"
          className="max-h-64 w-full bg-black"
        />
      ) : (
        <div className="px-3 py-3">
          <audio src={previewUrl} controls preload="metadata" className="w-full" />
        </div>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-white/90 px-2.5 py-1.5 text-[11px] text-gray-600">
        <span className="truncate font-medium">{name}</span>
        <button
          type="button"
          onClick={onDownload}
          disabled={isDownloading}
          className="shrink-0 font-medium text-blue-600 hover:underline disabled:opacity-60"
        >
          {isDownloading ? <span className="loading loading-spinner loading-xs text-blue-500" /> : 'Download'}
        </button>
      </div>
    </div>
  );
};

const EmailThreadLeadPage: React.FC = () => {
  const [leads, setLeads] = useState<EmailLead[]>(() => {
    return readEmailSidepanelCache<OfficeInboxCache>(OFFICE_INBOX_CACHE_KEY)?.leads || [];
  });
  const [loading, setLoading] = useState(() => {
    const cached = readEmailSidepanelCache<OfficeInboxCache>(OFFICE_INBOX_CACHE_KEY);
    return !(cached?.leads && cached.leads.length > 0);
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [readFilter, setReadFilter] = usePersistedState<EmailReadFilter>('email_leads_readFilter', 'all');
  const [selectedLead, setSelectedLead] = useState<EmailLead | null>(null);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  /** Recent office inbox rows from the sidepanel fetch — reuse so thread/open doesn't re-scan emails. */
  const inboxEmailsCacheRef = useRef<any[]>(
    readEmailSidepanelCache<OfficeInboxCache>(OFFICE_INBOX_CACHE_KEY)?.emails || [],
  );
  const selectedLeadEmailRef = useRef<string | null>(null);
  const fetchEmailLeadsRef = useRef<
    ((options?: { quiet?: boolean; bypassCache?: boolean }) => Promise<void>) | null
  >(null);
  const fetchMessagesRef = useRef<
    ((options?: { quiet?: boolean; bypassCache?: boolean }) => Promise<void>) | null
  >(null);


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
  const [isSending, setIsSending] = useState(false);
  const [showEmailSentModal, setShowEmailSentModal] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [threadLoadingMore, setThreadLoadingMore] = useState(false);
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
  const [currentUserPhotoUrl, setCurrentUserPhotoUrl] = useState<string | null>(null);
  /** Lowercased staff email → display name + photo for outgoing message headers */
  const [employeeProfileByEmail, setEmployeeProfileByEmail] = useState<
    Record<string, { name: string; photoUrl: string | null }>
  >({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const subjectInputRef = useRef<HTMLInputElement>(null);

  const dispatchEmailUnreadCount = useCallback(async () => {
    try {
      // Never use recipient_list ILIKE on emails (57014). Prefer badge RPC, else local inbox cache.
      const rpc = await supabase.rpc('header_office_inbox_unread_emails', {
        p_days: 7,
        p_limit: 80,
        p_scan_limit: 400,
      });

      let count = 0;
      if (!rpc.error) {
        count = asJsonArray(rpc.data).length;
      } else {
        count = (inboxEmailsCacheRef.current || []).filter((email: any) => {
          const unread = email.is_read === false || email.is_read == null;
          return unread && email.direction !== 'outgoing';
        }).length;
      }

      window.dispatchEvent(
        new CustomEvent<{ count: number }>('email:unread-count', {
          detail: { count },
        }),
      );
    } catch (error) {
      console.error('Unexpected error dispatching unread email count:', error);
    }
  }, []);

  const markEmailsAsRead = useCallback(
    async (senderEmail?: string | null) => {
      if (!senderEmail?.trim()) return;

      // Optimistic UI first (RPC may be slow under load).
      const normalizedEmail = senderEmail.toLowerCase();
      let localUnread = 0;
      setLeads((prev) => {
        const next = prev.map((lead) =>
          (lead.sender_email || '').toLowerCase() === normalizedEmail
            ? {
                ...lead,
                unread_count: 0,
                recentEmails: (lead.recentEmails || []).map((email: any) => ({
                  ...email,
                  is_read: true,
                })),
              }
            : lead,
        );
        localUnread = next.reduce((sum, lead) => sum + (lead.unread_count || 0), 0);
        inboxEmailsCacheRef.current = (inboxEmailsCacheRef.current || []).map((email: any) => {
          const sender = String(email.sender_email || '')
            .toLowerCase()
            .trim();
          if (sender !== normalizedEmail) return email;
          return { ...email, is_read: true };
        });
        writeEmailSidepanelCache(OFFICE_INBOX_CACHE_KEY, {
          leads: next,
          emails: inboxEmailsCacheRef.current,
        });
        return next;
      });
      // Defer Header update — never dispatch during render/setState updater.
      queueMicrotask(() => {
        window.dispatchEvent(
          new CustomEvent<{ count: number }>('email:unread-count', {
            detail: { count: localUnread },
          }),
        );
      });

      try {
        await supabase.rpc('email_office_mark_sender_read', {
          p_sender_email: senderEmail,
          p_days: 180,
        });
      } catch (error) {
        console.warn('Mark-as-read RPC failed (UI already updated):', error);
      }
    },
    [],
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
            .select('full_name, email, tenants_employee!users_employee_id_fkey(photo_url, photo, display_name)')
            .eq('auth_id', authUser.id)
            .maybeSingle();
          const empRaw = userRow?.tenants_employee as
            | { photo_url?: string | null; photo?: string | null; display_name?: string | null }
            | { photo_url?: string | null; photo?: string | null; display_name?: string | null }[]
            | null
            | undefined;
          const emp = Array.isArray(empRaw) ? empRaw[0] : empRaw;
          const photo = resolveEmployeePhotoUrl(emp?.photo_url, emp?.photo);
          setCurrentUserPhotoUrl(photo && isUsableEmployeePhotoUrl(photo) ? photo : null);
          if (emp?.display_name?.trim()) {
            setCurrentUserFullName(emp.display_name.trim());
          } else if (userRow?.full_name) {
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

  // Staff profiles for outgoing message avatars (email → photo)
  useEffect(() => {
    const loadEmployeeProfiles = async () => {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('full_name, email, tenants_employee!users_employee_id_fkey(photo_url, photo, display_name)')
          .not('email', 'is', null)
          .limit(500);
        if (error) {
          console.warn('Failed to load employee profiles:', error);
          return;
        }
        const next: Record<string, { name: string; photoUrl: string | null }> = {};
        (data || []).forEach((row: any) => {
          const email = String(row.email || '')
            .toLowerCase()
            .trim();
          if (!email) return;
          const empRaw = row.tenants_employee;
          const emp = Array.isArray(empRaw) ? empRaw[0] : empRaw;
          const photo = resolveEmployeePhotoUrl(emp?.photo_url, emp?.photo);
          next[email] = {
            name: String(emp?.display_name || row.full_name || email).trim(),
            photoUrl: photo && isUsableEmployeePhotoUrl(photo) ? photo : null,
          };
        });
        setEmployeeProfileByEmail(next);
      } catch (error) {
        console.warn('Failed to load employee profiles:', error);
      }
    };
    void loadEmployeeProfiles();
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

  // Fetch email leads (grouped by sender email) — cache-first, quiet refresh for live updates
  const fetchEmailLeads = useCallback(
    async (options?: { quiet?: boolean; bypassCache?: boolean }) => {
      const quiet = Boolean(options?.quiet);
      const bypassCache = Boolean(options?.bypassCache);

      if (!bypassCache) {
        const cached = readEmailSidepanelCache<OfficeInboxCache>(OFFICE_INBOX_CACHE_KEY);
        if (cached?.leads?.length) {
          setLeads(cached.leads);
          inboxEmailsCacheRef.current = cached.emails || [];
          setLoading(false);
          setSelectedLead((prev) => {
            if (!prev) return prev;
            return cached.leads.find((l) => l.id === prev.id) || prev;
          });
          void checkConnectionsForAllLeads(cached.leads, cached.emails || []);
          return;
        }
      }

      try {
        if (!quiet) setLoading(true);

        // Prefer sent_at-first RPC (no driving ILIKE). Also seed from Header unread office
        // RPC so senders visible in the bell are never missing from this page.
        const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        let emailsData: any[] | null = null;
        let emailsError: { message?: string; code?: string } | null = null;

        const [rpcResult, headerUnreadResult] = await Promise.all([
          supabase.rpc('email_office_inbox_recent', {
            p_days: 45,
            p_limit: 600,
          }),
          fetchHeaderOfficeInboxUnreadEmails({
            days: 7,
            limit: 80,
            scanLimit: 500,
          }),
        ]);

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
            .limit(2500);
          if (direct.error) {
            emailsError = direct.error;
          } else {
            emailsData = (direct.data || []).filter((email: any) =>
              String(email.recipient_list || '')
                .toLowerCase()
                .includes(OFFICE_INBOX_EMAIL),
            );
          }
        }

        // Merge Header unread office rows (may include senders starved out of the recent scan)
        if (!headerUnreadResult.error && headerUnreadResult.data?.length) {
          const byId = new Map<string, any>();
          (emailsData || []).forEach((email: any) => {
            const key = String(email.id ?? email.message_id ?? '');
            if (key) byId.set(key, email);
          });
          headerUnreadResult.data.forEach((row) => {
            const key = String(row.id ?? '');
            if (!key || byId.has(key)) return;
            byId.set(key, {
              id: row.id,
              message_id: null,
              sender_name: row.sender_name,
              sender_email: row.sender_email,
              recipient_list: row.recipient_list,
              subject: row.subject,
              body_preview: row.body_preview,
              sent_at: row.sent_at,
              direction: 'incoming',
              is_read: false,
              client_id: null,
              legacy_id: null,
              contact_id: null,
            });
          });
          emailsData = Array.from(byId.values()).sort(
            (a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime(),
          );
          if (emailsError && emailsData.length > 0) {
            emailsError = null;
          }
        }

        if (emailsError) {
          console.error('Error fetching emails:', emailsError);
          if (!quiet) toast.error('Failed to load email leads');
          return;
        }

        // Log summary to verify we're getting all emails
        const linkedCount = (emailsData || []).filter(e => e.client_id || e.legacy_id || e.contact_id).length;
        const unlinkedCount = (emailsData || []).filter(e => !e.client_id && !e.legacy_id && !e.contact_id).length;
        console.log(`📧 Fetched ${emailsData?.length || 0} emails to ${OFFICE_INBOX_EMAIL} (${linkedCount} linked, ${unlinkedCount} unlinked)`);

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
              recentEmails: [],
            });
          }

          const lead = leadsMap.get(senderEmail)!;
          lead.recentEmails = lead.recentEmails || [];
          lead.recentEmails.push(email);
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
        inboxEmailsCacheRef.current = emailsData || [];
        writeEmailSidepanelCache(OFFICE_INBOX_CACHE_KEY, {
          leads: leadsList,
          emails: emailsData || [],
        });
        setSelectedLead((prev) => {
          if (!prev) return prev;
          return leadsList.find((l) => l.id === prev.id) || prev;
        });

        // Check connections from the inbox rows we already fetched (no second scan)
        checkConnectionsForAllLeads(leadsList, emailsData || []);
      } catch (error) {
        console.error('Error fetching email leads:', error);
        if (!quiet) toast.error('Failed to load email leads');
      } finally {
        setLoading(false);
      }
    },
    [checkConnectionsForAllLeads],
  );

  fetchEmailLeadsRef.current = fetchEmailLeads;

  useEffect(() => {
    void fetchEmailLeads();
  }, [fetchEmailLeads]);

  // Filter leads based on search + read/unread
  const filteredLeads = leads.filter((lead) => {
    if (!leadMatchesReadFilter(lead, readFilter)) return false;
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return (
      lead.sender_name?.toLowerCase().includes(q) ||
      lead.sender_email?.toLowerCase().includes(q) ||
      lead.last_subject?.toLowerCase().includes(q)
    );
  });

  const fetchMessages = useCallback(async (options?: { quiet?: boolean; bypassCache?: boolean }) => {
    if (!selectedLead) {
      setMessages([]);
      setChatLoading(false);
      return;
    }

    const quiet = Boolean(options?.quiet);
    const bypassCache = Boolean(options?.bypassCache);
    const leadEmail = selectedLead.sender_email.toLowerCase().trim();
    const threadCacheKey = officeThreadCacheKey(leadEmail);

    try {
      if (!bypassCache) {
        const cachedThread = readEmailSidepanelCache<EmailMessage[]>(threadCacheKey);
        if (cachedThread && cachedThread.length > 0) {
          setMessages(cachedThread);
          setChatLoading(false);
          setThreadLoadingMore(false);
          stickToBottomRef.current = true;
          void markEmailsAsRead(selectedLead.sender_email);
          if (userId) {
            queueMicrotask(() => {
              void hydrateEmailBodies(cachedThread);
            });
          }
          return;
        }
      }

      if (!quiet) setChatLoading(true);

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
          body_html: email.body_html
            ? renderableEmailHtml(email.body_html)
            : looksLikeEmailHtml(email.body_preview)
              ? renderableEmailHtml(email.body_preview)
              : null,
          body_preview: email.body_preview || email.body_html || '',
          sender_name:
            email.sender_name ||
            (email.direction === 'outgoing' ? '' : selectedLead.sender_name),
          // Never fall back to the contact email for outgoing rows (breaks sent styling/filters)
          sender_email:
            email.sender_email ||
            (email.direction === 'outgoing' ? '' : selectedLead.sender_email),
          recipient_list: email.recipient_list || '',
          sent_at: email.sent_at,
          direction: String(email.direction || '').toLowerCase() === 'outgoing' ? 'outgoing' : 'incoming',
          attachments: parsedAttachments,
          db_id: dbId,
          _dbId: dbId,
        };
      };

      const dedupeMessages = (rows: any[], opts?: { trustInboxSource?: boolean }) => {
        const trustInboxSource = Boolean(opts?.trustInboxSource);
        const formattedMessages = (rows || []).map((email: any) => formatMessage(email, email.id));
        const messageMap = new Map<string, EmailMessage & { _dbId: string | number }>();

        formattedMessages.forEach((message) => {
          const sentAt = message.sent_at ? new Date(message.sent_at).toISOString() : '';
          const normalizedSender = (message.sender_email || '').toLowerCase().trim();
          const directionKey = message.direction || 'incoming';
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
          // Include direction so an outgoing reply cannot collapse into an incoming row
          const uniqueKey = `${directionKey}_${normalizedSender}_${timestampKey}_${message.message_id || message.id || ''}`;
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
              if (trustInboxSource) return true;
              const sender = (message.sender_email || '').toLowerCase().trim();
              if (sender === leadEmail) return true;
              return String(message.recipient_list || '')
                .toLowerCase()
                .includes(OFFICE_INBOX_EMAIL);
            }
            if (message.direction === 'outgoing') {
              const recipients = String(message.recipient_list || '').toLowerCase();
              // Accept any outgoing addressed to this contact
              if (!recipients.includes(leadEmail)) return false;
              const senderEmail = (message.sender_email || '').toLowerCase();
              // Prefer staff/current-user senders; still keep if sender missing (local optimistic)
              return (
                !senderEmail ||
                senderEmail.endsWith('@lawoffice.org.il') ||
                (userEmailLower.length > 0 && senderEmail === userEmailLower)
              );
            }
            return false;
          })
          .sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
      };

      // Instant: emails already attached to this lead from the sidepanel inbox fetch.
      const attached = Array.isArray(selectedLead.recentEmails) ? selectedLead.recentEmails : [];
      const fromCache = (inboxEmailsCacheRef.current || []).filter((email: any) => {
        const sender = String(email.sender_email || '')
          .toLowerCase()
          .trim();
        return sender === leadEmail;
      });
      const sourceRows = attached.length > 0 ? attached : fromCache;

      // Keep any already-loaded outgoing replies for this contact while RPCs reload
      setMessages((prev) => {
        const prevOutgoingRows = prev
          .filter(
            (m) =>
              m.direction === 'outgoing' &&
              String(m.recipient_list || '')
                .toLowerCase()
                .includes(leadEmail),
          )
          .map((m) => ({
            id: m.db_id ?? m.id,
            message_id: m.message_id,
            sender_name: m.sender_name,
            sender_email: m.sender_email,
            recipient_list: m.recipient_list,
            subject: m.subject,
            body_preview: m.body_preview,
            body_html: m.body_html,
            sent_at: m.sent_at,
            direction: m.direction,
            attachments: m.attachments,
          }));
        const preview = dedupeMessages([...sourceRows, ...prevOutgoingRows], { trustInboxSource: true });
        if (preview.length > 0) {
          writeEmailSidepanelCache(threadCacheKey, preview);
        }
        return preview;
      });
      setChatLoading(false);
      setThreadLoadingMore(true);
      stickToBottomRef.current = true;
      console.log(
        `📬 Thread preview from inbox cache: ${sourceRows.length} incoming row(s) for ${selectedLead.sender_email}`,
      );

      void markEmailsAsRead(selectedLead.sender_email);

      // Progressive full thread: incoming first (fast), then outgoing (sent replies).
      const openedFor = selectedLead.sender_email;
      const mergeIntoThread = (extraRows: any[], label: string) => {
        if (selectedLeadEmailRef.current !== openedFor) return;
        if (!extraRows.length) return;
        stickToBottomRef.current = true;
        setMessages((prev) => {
          const prevAsRows = prev.map((m) => ({
            id: m.db_id ?? m.id,
            message_id: m.message_id,
            sender_name: m.sender_name,
            sender_email: m.sender_email,
            recipient_list: m.recipient_list,
            subject: m.subject,
            body_preview: m.body_preview,
            body_html: m.body_html,
            sent_at: m.sent_at,
            direction: m.direction,
            attachments: m.attachments,
          }));
          const merged = dedupeMessages([...extraRows, ...prevAsRows, ...sourceRows], {
            trustInboxSource: true,
          });
          writeEmailSidepanelCache(threadCacheKey, merged);
          console.log(`📬 ${label}: now ${merged.length} message(s) for ${openedFor}`);
          return merged;
        });
      };

      const loadOutgoingFallback = async (): Promise<any[]> => {
        const sinceIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
        const linkedContactIds = Array.from(
          new Set(
            [...sourceRows, ...(inboxEmailsCacheRef.current || [])]
              .filter((e: any) => {
                const sender = String(e.sender_email || '')
                  .toLowerCase()
                  .trim();
                return sender === leadEmail && e.contact_id != null;
              })
              .map((e: any) => Number(e.contact_id))
              .filter((n) => Number.isFinite(n)),
          ),
        ).slice(0, 20);
        const linkedLegacyIds = Array.from(
          new Set(
            [...sourceRows, ...(inboxEmailsCacheRef.current || [])]
              .filter((e: any) => {
                const sender = String(e.sender_email || '')
                  .toLowerCase()
                  .trim();
                return sender === leadEmail && e.legacy_id != null;
              })
              .map((e: any) => Number(e.legacy_id))
              .filter((n) => Number.isFinite(n)),
          ),
        ).slice(0, 20);
        const linkedClientIds = Array.from(
          new Set(
            [...sourceRows, ...(inboxEmailsCacheRef.current || [])]
              .filter((e: any) => {
                const sender = String(e.sender_email || '')
                  .toLowerCase()
                  .trim();
                return sender === leadEmail && e.client_id;
              })
              .map((e: any) => String(e.client_id)),
          ),
        ).slice(0, 20);

        const byId = new Map<string, any>();
        const absorb = (rows: any[]) => {
          (rows || []).forEach((row) => {
            const key = String(row.id ?? row.message_id ?? '');
            if (key) byId.set(key, row);
          });
        };

        // Indexed FK lookups first (reliable when replies were linked to the lead/contact)
        const linkedQueries: Promise<void>[] = [];
        if (linkedContactIds.length > 0) {
          linkedQueries.push(
            (async () => {
              const { data } = await supabase
                .from('emails')
                .select(
                  'id, message_id, sender_name, sender_email, recipient_list, subject, body_preview, sent_at, direction, attachments, client_id, legacy_id, contact_id',
                )
                .eq('direction', 'outgoing')
                .in('contact_id', linkedContactIds)
                .gte('sent_at', sinceIso)
                .order('sent_at', { ascending: false })
                .limit(200);
              absorb(data || []);
            })(),
          );
        }
        if (linkedLegacyIds.length > 0) {
          linkedQueries.push(
            (async () => {
              const { data } = await supabase
                .from('emails')
                .select(
                  'id, message_id, sender_name, sender_email, recipient_list, subject, body_preview, sent_at, direction, attachments, client_id, legacy_id, contact_id',
                )
                .eq('direction', 'outgoing')
                .in('legacy_id', linkedLegacyIds)
                .gte('sent_at', sinceIso)
                .order('sent_at', { ascending: false })
                .limit(200);
              absorb(data || []);
            })(),
          );
        }
        if (linkedClientIds.length > 0) {
          linkedQueries.push(
            (async () => {
              const { data } = await supabase
                .from('emails')
                .select(
                  'id, message_id, sender_name, sender_email, recipient_list, subject, body_preview, sent_at, direction, attachments, client_id, legacy_id, contact_id',
                )
                .eq('direction', 'outgoing')
                .in('client_id', linkedClientIds)
                .gte('sent_at', sinceIso)
                .order('sent_at', { ascending: false })
                .limit(200);
              absorb(data || []);
            })(),
          );
        }
        await Promise.all(linkedQueries);

        // Bounded recent outgoing scan + recipient filter (best-effort for unlinked replies)
        try {
          const { data, error } = await supabase
            .from('emails')
            .select(
              'id, message_id, sender_name, sender_email, recipient_list, subject, body_preview, sent_at, direction, attachments, client_id, legacy_id, contact_id',
            )
            .eq('direction', 'outgoing')
            .gte('sent_at', sinceIso)
            .order('sent_at', { ascending: false })
            .limit(1200);
          if (!error) {
            const needle = leadEmail;
            absorb(
              (data || []).filter((row: any) =>
                String(row.recipient_list || '')
                  .toLowerCase()
                  .includes(needle),
              ),
            );
          } else {
            console.warn('Outgoing fallback scan failed:', error);
          }
        } catch (scanErr) {
          console.warn('Outgoing fallback scan failed:', scanErr);
        }

        return Array.from(byId.values()).sort(
          (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime(),
        );
      };

      void (async () => {
        try {
          const incomingRes = await supabase.rpc('email_office_thread_incoming_for_sender', {
            p_sender_email: openedFor,
            p_days: 180,
            p_limit: 300,
          });
          const incomingTimedOut =
            String(incomingRes.error?.code || '') === '57014' ||
            /statement timeout/i.test(String(incomingRes.error?.message || ''));
          if (incomingRes.error && !incomingTimedOut) {
            console.warn('Incoming thread RPC error:', incomingRes.error);
          } else {
            const incomingRows =
              incomingRes.error && !incomingTimedOut ? [] : asJsonArray<any>(incomingRes.data);
            mergeIntoThread(incomingRows, `Incoming loaded (${incomingRows.length})`);
            if (userId && incomingRows.length > 0 && selectedLeadEmailRef.current === openedFor) {
              setTimeout(() => {
                if (selectedLeadEmailRef.current !== openedFor) return;
                setMessages((curr) => {
                  void hydrateEmailBodies(curr);
                  return curr;
                });
              }, 0);
            }
          }
        } catch (err) {
          console.warn('Incoming thread load failed:', err);
        }

        try {
          let outgoingRows: any[] = [];
          let outgoingTimedOut = false;
          for (let attempt = 0; attempt < 2; attempt++) {
            const outgoingRes = await supabase.rpc('email_office_thread_outgoing_to_sender', {
              p_sender_email: openedFor,
              p_days: attempt === 0 ? 90 : 45,
              p_limit: attempt === 0 ? 200 : 100,
            });
            outgoingTimedOut =
              String(outgoingRes.error?.code || '') === '57014' ||
              /statement timeout/i.test(String(outgoingRes.error?.message || ''));
            if (outgoingRes.error && !outgoingTimedOut) {
              console.warn('Outgoing thread RPC error:', outgoingRes.error);
              break;
            }
            if (!outgoingTimedOut) {
              outgoingRows = asJsonArray<any>(outgoingRes.data);
              break;
            }
          }
          if (outgoingTimedOut || outgoingRows.length === 0) {
            const fallbackRows = await loadOutgoingFallback();
            if (fallbackRows.length > 0) {
              console.log(`📬 Outgoing fallback loaded ${fallbackRows.length} row(s)`);
              outgoingRows = fallbackRows;
            }
          }
          mergeIntoThread(outgoingRows, `Outgoing loaded (${outgoingRows.length})`);
        } catch (err) {
          console.warn('Outgoing thread load failed:', err);
          try {
            const fallbackRows = await loadOutgoingFallback();
            mergeIntoThread(fallbackRows, `Outgoing fallback (${fallbackRows.length})`);
          } catch (fallbackErr) {
            console.warn('Outgoing fallback also failed:', fallbackErr);
          }
        } finally {
          if (selectedLeadEmailRef.current === openedFor) {
            setThreadLoadingMore(false);
          }
        }
      })();
    } catch (error) {
      console.error('Error fetching messages:', error);
      setChatLoading(false);
      setThreadLoadingMore(false);
    }
    // hydrateEmailBodies is defined below; omit from deps to avoid TDZ on first render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLead, markEmailsAsRead, userEmail, userId]);

  fetchMessagesRef.current = fetchMessages;

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
            html: renderableEmailHtml(rawContent),
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
          const status = Number((err as any)?.statusCode || 0);
          const msg = String((err as any)?.message || err || '');
          if (status === 404 || /ErrorItemNotFound|not found in the store|ItemNotFound/i.test(msg)) {
            return;
          }
          console.warn('⚠️ Failed to hydrate email body from backend:', msg.slice(0, 180));
        }
      })
    );

    if (Object.keys(updates).length > 0) {
      setMessages(prev => {
        const next = prev.map(message => {
          const messageId = message.message_id || message.id;
          const update = updates[messageId];
          if (!update) return message;

          return {
            ...message,
            body_html: update.html,
            body_preview: update.preview,
            ...(update.attachments && update.attachments.length > 0 ? { attachments: update.attachments } : {}),
          };
        });
        const openSender = selectedLeadEmailRef.current;
        if (openSender) {
          writeEmailSidepanelCache(officeThreadCacheKey(openSender), next);
        }
        return next;
      });
    }
  }, [userId]);

  useEffect(() => {
    selectedLeadEmailRef.current = selectedLead?.sender_email ?? null;
  }, [selectedLead?.sender_email]);

  useEffect(() => {
    void fetchMessages();
  }, [fetchMessages]);

  // Live updates: subscribe table-wide and match office inbox / open sender in JS
  useRealtimeRefresh({
    channelName: 'email-office-leads',
    tables: [
      {
        table: 'emails',
        event: '*',
        match: (payload) => {
          const row =
            (payload.new as Record<string, unknown> | null | undefined) ||
            (payload.old as Record<string, unknown> | null | undefined);
          if (!row) return true;
          if (emailRowTouchesOfficeInbox(row)) return true;
          const openSender = selectedLeadEmailRef.current;
          if (openSender && emailRowTouchesSender(row, openSender)) return true;
          return false;
        },
      },
    ],
    debounceMs: 500,
    onChange: () => {
      void fetchEmailLeadsRef.current?.({ quiet: true, bypassCache: true });
      if (selectedLeadEmailRef.current) {
        void fetchMessagesRef.current?.({ quiet: true, bypassCache: true });
      }
    },
  });

  // Fetch connected leads and contacts for the selected email
  const fetchConnectedLeadsAndContacts = useCallback(async () => {
    if (!selectedLead?.sender_email) {
      setConnectedLeads([]);
      setConnectedContacts([]);
      return;
    }

    setIsLoadingConnections(true);
    try {
      let clientIds = new Set<string>();
      let legacyIds = new Set<number>();
      let contactIds = new Set<number>();
      const leadEmail = selectedLead.sender_email.toLowerCase().trim();

      const sourceRows =
        (Array.isArray(selectedLead.recentEmails) && selectedLead.recentEmails.length > 0
          ? selectedLead.recentEmails
          : inboxEmailsCacheRef.current || []
        ).filter((email: any) => {
          if (Array.isArray(selectedLead.recentEmails) && selectedLead.recentEmails.length > 0) {
            return true;
          }
          const sender = String(email.sender_email || '')
            .toLowerCase()
            .trim();
          return sender === leadEmail;
        });

      sourceRows.forEach((email: any) => {
        if (email.client_id) clientIds.add(String(email.client_id));
        if (email.legacy_id != null) {
          const n = Number(email.legacy_id);
          if (Number.isFinite(n)) legacyIds.add(n);
        }
        if (email.contact_id != null) {
          const n = Number(email.contact_id);
          if (Number.isFinite(n)) contactIds.add(n);
        }
      });

      if (clientIds.size === 0 && legacyIds.size === 0 && contactIds.size === 0) {
        setConnectedLeads([]);
        setConnectedContacts([]);
        return;
      }

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
      // Message loading is owned by fetchMessages — do NOT setChatLoading(true) here
      // (that races after fetchMessages and leaves the spinner stuck).
      setComposeToRecipients([selectedLead.sender_email].filter(Boolean));
      setComposeCcRecipients([]);
      if (textareaRef.current) {
        textareaRef.current.style.height = '40px';
      }
      setShowSubjectInput(false);
    } else {
      setMessages([]);
      setChatLoading(false);
      setThreadLoadingMore(false);
      setComposeToRecipients([]);
      setComposeCcRecipients([]);
    }
  }, [selectedLead]);

  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '40px';
    const maxHeight = isMobile ? 160 : 200;
    const next = Math.min(Math.max(textarea.scrollHeight, 40), maxHeight);
    textarea.style.height = `${next}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
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
      const result = await fetchAiMessageSuggestion({
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
      });
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
      const baseHtml = convertBodyToHtml(newMessage);
      const { html: htmlWithSignature, inlineAttachments } =
        await buildOutgoingHtmlWithSignature(baseHtml);
      const backendAttachments = [
        ...(attachments.length ? await mapAttachmentsForBackend(attachments) : []),
        ...inlineAttachments,
      ];

      await sendEmailViaBackend({
        userId,
        subject: finalSubject,
        bodyHtml: htmlWithSignature,
        to,
        cc: composeCcRecipients.length > 0 ? composeCcRecipients : undefined,
        attachments: backendAttachments.length ? backendAttachments : undefined,
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

      setMessages((prev) => {
        const next = [...prev, outgoingMessage];
        writeEmailSidepanelCache(officeThreadCacheKey(selectedLead.sender_email), next);
        return next;
      });
      setNewMessage('');
      setAttachments([]);
      setIsActionMenuOpen(false);
      setShowAISuggestions(false);
      setAiSuggestions([]);
      setComposeToRecipients([selectedLead.sender_email].filter(Boolean));
      setComposeCcRecipients([]);
      stickToBottomRef.current = true;
      setShowEmailSentModal(true);
      // Refresh in background but keep the optimistic sent bubble visible
      void fetchMessages({ quiet: true, bypassCache: true });
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

  // Jump to newest message instantly (no smooth scroll animation)
  useEffect(() => {
    if (chatLoading) return;
    if (!stickToBottomRef.current) return;
    const container = messagesContainerRef.current;
    if (!container) return;
    // Double rAF so layout has the latest message heights before jumping
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!stickToBottomRef.current || !messagesContainerRef.current) return;
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      });
    });
  }, [messages, chatLoading, threadLoadingMore]);

  useEffect(() => {
    stickToBottomRef.current = true;
  }, [selectedLead?.id]);

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

  const handleDeleteAllEmailsForSender = useCallback(async () => {
    if (!selectedLead?.sender_email) return;

    const senderEmail = selectedLead.sender_email.trim();
    const leadId = selectedLead.id;
    const confirmed = window.confirm(
      `Delete all emails from ${senderEmail} from the database?\n\nThis removes emails from this sender and cannot be undone.`,
    );
    if (!confirmed) return;

    const toNumericIds = (values: unknown[]): number[] =>
      Array.from(
        new Set(
          values
            .map((v) => {
              if (typeof v === 'number' && Number.isFinite(v)) return v;
              const s = String(v ?? '').trim();
              if (!s || s.startsWith('local-') || !/^\d+$/.test(s)) return null;
              const n = Number(s);
              return Number.isSafeInteger(n) ? n : null;
            })
            .filter((n): n is number => n != null),
        ),
      );

    const removeLeadFromUi = () => {
      setLeads((prev) => {
        const next = prev.filter((l) => l.id !== leadId);
        inboxEmailsCacheRef.current = (inboxEmailsCacheRef.current || []).filter((email: any) => {
          const sender = String(email.sender_email || '')
            .toLowerCase()
            .trim();
          return sender !== senderEmail.toLowerCase().trim();
        });
        writeEmailSidepanelCache(OFFICE_INBOX_CACHE_KEY, {
          leads: next,
          emails: inboxEmailsCacheRef.current,
        });
        return next;
      });
      invalidateEmailSidepanelCache(officeThreadCacheKey(senderEmail));
      setSelectedLead(null);
      setMessages([]);
      setShowChat(false);
      setShowActionDropdown(false);
    };

    try {
      setLoading(true);
      let totalDeleted = 0;

      // 1) Fast path: delete known row ids from this thread / inbox cache (PK only)
      const knownIds = toNumericIds([
        ...(selectedLead.recentEmails || []).map((e: any) => e?.id),
        ...messages.map((m) => m.db_id ?? m.id),
      ]);

      if (knownIds.length > 0) {
        // Chunk PK deletes so a single RPC stays small
        for (let i = 0; i < knownIds.length; i += 100) {
          const chunk = knownIds.slice(i, i + 100);
          const { data: deletedKnown, error: knownError } = await supabase.rpc('email_office_delete_ids', {
            p_ids: chunk,
          });
          if (knownError) throw knownError;
          totalDeleted += Number(deletedKnown) || 0;
        }
      }

      // Remove from UI as soon as known rows are gone (or even if none — residual may still run)
      removeLeadFromUi();

      // 2) Drain remaining by sender via indexed RPC (best-effort; don't fail UI on timeout)
      let residualDeleted = 0;
      try {
        for (let i = 0; i < 500; i++) {
          const { data: deletedBatch, error: batchError } = await supabase.rpc('email_office_delete_by_sender', {
            p_sender_email: senderEmail,
            p_limit: 50,
          });
          if (batchError) throw batchError;
          const n = Number(deletedBatch) || 0;
          residualDeleted += n;
          totalDeleted += n;
          if (n === 0) break;
        }
      } catch (residualError: any) {
        console.warn('Residual sender delete stopped:', residualError);
        const code = residualError?.code || residualError?.error_code;
        if (totalDeleted > 0) {
          toast.success(
            `Deleted ${totalDeleted}+ emails from ${senderEmail}. Some older rows may remain — run delete again if they reappear.`,
          );
          return;
        }
        if (code === '57014' || /statement timeout/i.test(String(residualError?.message || ''))) {
          toast.error('Delete timed out before any rows were removed. Try again in a moment.');
          return;
        }
        throw residualError;
      }

      toast.success(
        totalDeleted > 0
          ? `Deleted ${totalDeleted} email${totalDeleted === 1 ? '' : 's'} from ${senderEmail}`
          : `No emails found for ${senderEmail}`,
      );
    } catch (error: any) {
      console.error('Error deleting emails for sender:', error);
      const code = error?.code || error?.error_code;
      const msg =
        code === '57014' || /statement timeout/i.test(String(error?.message || ''))
          ? 'Delete timed out — try again (DB is busy). Partial deletes may have succeeded; refresh if the sender reappears.'
          : error instanceof Error
            ? error.message
            : error?.message || 'Failed to delete emails';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [selectedLead, messages]);

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
      <style>{`
        .email-content a,
        .email-content a:link,
        .email-content a:visited {
          color: #2563eb !important;
          text-decoration: underline !important;
          text-underline-offset: 2px;
        }
        .email-content a:hover {
          color: #1d4ed8 !important;
        }
        .email-content-outgoing,
        .email-content-outgoing * {
          color: #111827 !important;
          background: transparent !important;
          background-color: transparent !important;
        }
        .email-content-outgoing a,
        .email-content-outgoing a:link,
        .email-content-outgoing a:visited {
          color: #2563eb !important;
          text-decoration: underline !important;
          text-underline-offset: 2px;
        }
        .email-content-outgoing a:hover {
          color: #1d4ed8 !important;
        }
      `}</style>
      <div className="flex h-full min-h-0 overflow-hidden" style={{ height: '100vh', maxHeight: '100vh' }}>
          {/* Desktop: grey icon rail — All / Unread / Read (WhatsApp Leads style) */}
          {!isMobile && (
            <div className="flex h-full min-h-0 w-[4.5rem] flex-shrink-0 flex-col items-center border-r border-gray-200 bg-gray-50">
              <div className="flex w-full flex-col items-stretch gap-2 px-1 pt-4">
                {(
                  [
                    { filter: 'all' as const, label: 'All', Icon: ChatBubbleLeftRightIcon },
                    { filter: 'unread' as const, label: 'Unread', Icon: InboxIcon },
                    { filter: 'read' as const, label: 'Read', Icon: WhatsAppDoubleCheckIcon },
                  ] as const
                ).map(({ filter, label, Icon }) => {
                  const isActive = readFilter === filter;
                  return (
                    <button
                      key={filter}
                      type="button"
                      title={`${label} conversations`}
                      aria-label={`${label} conversations`}
                      aria-pressed={isActive}
                      onClick={() => setReadFilter(filter)}
                      className={`flex w-full flex-col items-center justify-center gap-0.5 rounded-lg border-0 py-1.5 outline-none ring-0 transition-colors ${
                        isActive ? 'bg-gray-300 text-gray-900' : 'text-gray-600 hover:bg-gray-300/70'
                      }`}
                    >
                      <Icon className="h-6 w-6 flex-shrink-0" />
                      <span className="text-[10px] font-medium leading-none">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Left Panel - Leads List (full height to top of screen) */}
          <div className={`${isMobile ? 'w-full' : 'w-96'} border-r border-gray-200 flex h-full min-h-0 shrink-0 flex-col ${isMobile && showChat ? 'hidden' : ''} overflow-hidden bg-white`}>
            {/* Mobile list header */}
            {isMobile && (
              <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <EnvelopeIcon className="h-5 w-5 shrink-0 text-blue-600" />
                  <h2 className="truncate text-base font-bold text-gray-900">Email Leads</h2>
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                    {filteredLeads.length}
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
            <div className="p-3.5 border-b border-gray-200 flex-shrink-0 bg-white">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by email or name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              {isMobile && (
                <div className="mt-3 flex gap-2">
                  {(['all', 'unread', 'read'] as const).map((filter) => {
                    const label = filter === 'all' ? 'All' : filter === 'unread' ? 'Unread' : 'Read';
                    const isActive = readFilter === filter;
                    return (
                      <button
                        key={filter}
                        type="button"
                        onClick={() => setReadFilter(filter)}
                        className={`flex-1 rounded-lg border-0 px-2 py-1.5 text-xs font-medium outline-none ring-0 transition-all ${
                          isActive
                            ? 'bg-gray-200 font-semibold text-gray-800'
                            : 'bg-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
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
                      className={`p-3 md:p-3.5 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors overflow-hidden ${isSelected ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                        }`}
                    >
                      <div className="flex items-start gap-3 min-w-0 w-full">
                        {/* Avatar */}
                        <div className="w-10 h-10 md:w-11 md:h-11 rounded-full flex items-center justify-center flex-shrink-0 relative border bg-blue-100 border-blue-200 text-blue-700">
                          {lead.sender_name && lead.sender_name !== lead.sender_email ? (
                            <span className="font-semibold text-sm md:text-base">
                              {lead.sender_name.charAt(0).toUpperCase()}
                            </span>
                          ) : (
                            <EnvelopeIcon className="w-5 h-5 text-blue-700" />
                          )}
                          {/* Connection indicator icon */}
                          {leadsWithConnections.get(lead.id) && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center shadow-sm" style={{ backgroundColor: '#4218cc' }}>
                              <LinkIcon className="w-2.5 h-2.5 text-white" />
                            </div>
                          )}
                        </div>

                        {/* Lead Info */}
                        <div className="flex-1 min-w-0 overflow-hidden">
                          <div className="flex items-center justify-between gap-2 mb-0.5 min-w-0">
                            <div className="flex flex-col min-w-0 flex-1">
                              <h3 className="font-semibold text-base text-gray-900 truncate">
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
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <span className="text-xs text-gray-500 whitespace-nowrap">
                                {formatTime(lead.last_message_at)}
                              </span>
                              <span className={`text-xs rounded-full px-1.5 py-0.5 min-w-[1.25rem] h-5 flex items-center justify-center flex-shrink-0 ${lead.unread_count && lead.unread_count > 0 ? 'bg-blue-500 text-white' : 'invisible'}`}>
                                {lead.unread_count && lead.unread_count > 0 ? lead.unread_count : '0'}
                              </span>
                            </div>
                          </div>

                          <p
                            dir={leadPreviewRtl ? 'rtl' : 'ltr'}
                            className="text-sm text-gray-600 truncate mb-0.5 font-medium text-start"
                            title={lead.last_subject || undefined}
                          >
                            {truncateSidepanelTitle(lead.last_subject, 28)}
                          </p>
                          <p
                            dir={leadPreviewRtl ? 'rtl' : 'ltr'}
                            className="text-sm text-gray-500 truncate text-start"
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
          <div className={`${isMobile ? 'w-full' : 'flex-1'} relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-slate-100 ${isMobile && !showChat ? 'hidden' : ''}`} style={isMobile ? { height: '100vh', overflow: 'hidden', position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40 } : {}}>
            {/* Page header — list title OR selected chat header (frosted) */}
            {!isMobile && (
              <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 border-b border-white/40 bg-white/55 px-4 py-3 shadow-sm backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/40 md:px-6 md:py-3">
                {selectedLead ? (
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100">
                        {selectedLead.sender_name && selectedLead.sender_name !== selectedLead.sender_email ? (
                          <span className="text-lg font-semibold text-blue-600">
                            {selectedLead.sender_name.charAt(0).toUpperCase()}
                          </span>
                        ) : (
                          <EnvelopeIcon className="h-5 w-5 text-blue-600" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold text-gray-900">
                          {selectedLead.sender_name && selectedLead.sender_name !== selectedLead.sender_email
                            ? selectedLead.sender_name
                            : selectedLead.sender_email || 'Unknown Sender'}
                        </h3>
                        {selectedLead.sender_name && selectedLead.sender_name !== selectedLead.sender_email && (
                          <p className="truncate text-sm text-gray-500">{selectedLead.sender_email}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {(connectedLeads.length > 0 || connectedContacts.length > 0 || isLoadingConnections) && (
                        <div className="relative">
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowConnectedLeadsDropdown(!showConnectedLeadsDropdown);
                              setShowActionDropdown(false);
                            }}
                          >
                            <LinkIcon className="mr-2 h-4 w-4" />
                            Connected Leads
                            <ChevronDownIcon className="ml-2 h-4 w-4" />
                          </button>
                          {showConnectedLeadsDropdown && (
                            <>
                              <div
                                className="fixed inset-0 z-40"
                                onClick={() => setShowConnectedLeadsDropdown(false)}
                              />
                              <ul
                                className="absolute right-0 top-full z-50 mt-2 menu max-h-[70vh] w-80 overflow-y-auto rounded-box border border-gray-200 bg-base-100 p-2 shadow-lg"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {isLoadingConnections ? (
                                  <li>
                                    <div className="flex items-center gap-2 py-2 text-sm text-gray-500">
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
                                          className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-gray-100"
                                        >
                                          <UserGroupIcon className="h-4 w-4 flex-shrink-0 text-blue-600" />
                                          <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-medium text-gray-900">{lead.name}</div>
                                            <div className="truncate text-xs text-gray-500">{lead.lead_number}</div>
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
                                          className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-gray-100"
                                        >
                                          <LinkIcon className="h-4 w-4 flex-shrink-0 text-purple-600" />
                                          <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-medium text-gray-900">{contact.name}</div>
                                            <div className="truncate text-xs text-gray-500">Lead: {contact.lead_number}</div>
                                          </div>
                                        </button>
                                      </li>
                                    ))}
                                    {connectedLeads.length === 0 && connectedContacts.length === 0 && !isLoadingConnections && (
                                      <li>
                                        <div className="py-2 text-center text-sm text-gray-500">No connected leads or contacts</div>
                                      </li>
                                    )}
                                  </>
                                )}
                              </ul>
                            </>
                          )}
                        </div>
                      )}
                      <span
                        className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-slate-200/90 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-700"
                        title="Messages"
                      >
                        {selectedLead.message_count}
                      </span>
                      <div className="relative">
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowActionDropdown(!showActionDropdown);
                            setShowConnectedLeadsDropdown(false);
                          }}
                        >
                          <UserPlusIcon className="mr-2 h-4 w-4" />
                          Actions
                          <ChevronDownIcon className="ml-2 h-4 w-4" />
                        </button>
                        {showActionDropdown && (
                          <>
                            <div
                              className="fixed inset-0 z-40"
                              onClick={() => setShowActionDropdown(false)}
                            />
                            <ul
                              className="absolute right-0 top-full z-50 mt-2 menu w-64 rounded-box border border-gray-200 bg-base-100 p-2 shadow-lg"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <li>
                                <button
                                  onClick={() => {
                                    setShowActionDropdown(false);
                                    handleConvertToLead(selectedLead);
                                  }}
                                  className="flex w-full items-center gap-2 text-left"
                                >
                                  <UserPlusIcon className="h-4 w-4" />
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
                                  className="flex w-full items-center gap-2 text-left"
                                >
                                  <UserGroupIcon className="h-4 w-4" />
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
                                  className="flex w-full items-center gap-2 text-left"
                                >
                                  <LinkIcon className="h-4 w-4" />
                                  <span>Add as Contact to Lead</span>
                                </button>
                              </li>
                              <li>
                                <button
                                  onClick={() => {
                                    setShowActionDropdown(false);
                                    void handleDeleteAllEmailsForSender();
                                  }}
                                  className="flex w-full items-center gap-2 text-left text-error hover:bg-error/10"
                                >
                                  <TrashIcon className="h-4 w-4" />
                                  <span>Delete all emails</span>
                                </button>
                              </li>
                            </ul>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-4">
                    <EnvelopeIcon className="h-6 w-6 shrink-0 text-blue-600 md:h-7 md:w-7" />
                    <h2 className="shrink-0 text-lg font-bold text-gray-900 md:text-2xl">Email Leads</h2>
                    <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                      {leads.length} Leads
                    </span>
                  </div>
                )}
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
                {/* Mobile Chat Header (frosted) */}
                {isMobile && (
                  <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 border-b border-white/40 bg-white/55 p-4 shadow-sm backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/40">
                    <button
                      onClick={() => setShowChat(false)}
                      className="btn btn-ghost btn-circle btn-sm flex-shrink-0"
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-100">
                        {selectedLead.sender_name && selectedLead.sender_name !== selectedLead.sender_email ? (
                          <span className="text-sm font-semibold text-blue-600">
                            {selectedLead.sender_name.charAt(0).toUpperCase()}
                          </span>
                        ) : (
                          <EnvelopeIcon className="h-4 w-4 text-blue-600" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-semibold text-gray-900">
                          {selectedLead.sender_name && selectedLead.sender_name !== selectedLead.sender_email
                            ? selectedLead.sender_name
                            : selectedLead.sender_email || 'Unknown Sender'}
                        </h3>
                        <p className="truncate text-xs text-gray-500">{selectedLead.sender_email}</p>
                      </div>
                      <span
                        className="inline-flex min-w-[1.5rem] shrink-0 items-center justify-center rounded-full bg-slate-200/90 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-700"
                        title="Messages"
                      >
                        {selectedLead.message_count}
                      </span>
                    </div>
                  </div>
                )}

                {/* Messages — padded so content can scroll under frosted header/compose */}
                <div
                  ref={messagesContainerRef}
                  className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-100 p-4 pt-24 pb-28 md:pt-28 md:pb-32"
                  style={isMobile ? { flex: '1 1 auto', WebkitOverflowScrolling: 'touch' } : undefined}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
                    stickToBottomRef.current = distanceFromBottom < 80;
                  }}
                >
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
                      {threadLoadingMore && (
                        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-blue-600">
                          <span className="loading loading-spinner loading-sm" />
                          Loading conversation…
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {threadLoadingMore && (
                        <div className="sticky top-0 z-10 flex justify-center py-1">
                          <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white/90 px-3 py-1.5 text-xs font-medium text-blue-700 shadow-sm backdrop-blur">
                            <span className="loading loading-spinner loading-xs text-blue-500" />
                            Loading more messages…
                          </div>
                        </div>
                      )}
                      {messages.map((message, index) => {
                      const showDateSeparator = index === 0 ||
                        new Date(message.sent_at).toDateString() !== new Date(messages[index - 1].sent_at).toDateString();
                      const senderEmailKey = (message.sender_email || '').toLowerCase().trim();
                      const staffProfile = senderEmailKey ? employeeProfileByEmail[senderEmailKey] : undefined;
                      const isOutgoing =
                        message.direction === 'outgoing' ||
                        Boolean(staffProfile) ||
                        senderEmailKey.endsWith('@lawoffice.org.il');
                      const messageRtl = emailContentLikelyHebrew(
                        message.subject,
                        message.body_preview,
                        message.body_html || undefined
                      );
                      const isCurrentUserOutgoing =
                        isOutgoing &&
                        !!userEmail &&
                        senderEmailKey === userEmail.toLowerCase().trim();
                      const outgoingDisplayName = isOutgoing
                        ? staffProfile?.name ||
                          message.sender_name ||
                          (isCurrentUserOutgoing ? currentUserFullName : null) ||
                          message.sender_email ||
                          'You'
                        : message.sender_name || selectedLead?.sender_name || 'Sender';
                      const outgoingPhotoUrl = isOutgoing
                        ? staffProfile?.photoUrl ||
                          (isCurrentUserOutgoing ? currentUserPhotoUrl : null)
                        : null;
                      const outgoingInitials = String(outgoingDisplayName || '?')
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((p) => p.charAt(0).toUpperCase())
                        .join('') || '?';

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
                            <div
                              className={`mb-1 flex max-w-full items-center gap-2 text-xs md:max-w-[70%] ${
                                isOutgoing ? 'flex-row-reverse text-right' : 'text-left'
                              }`}
                            >
                              {isOutgoing && (
                                <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-blue-200 bg-blue-100 text-[10px] font-semibold text-blue-800">
                                  {outgoingPhotoUrl ? (
                                    <img
                                      src={outgoingPhotoUrl}
                                      alt={outgoingDisplayName}
                                      className="h-full w-full object-cover"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <span>{outgoingInitials}</span>
                                  )}
                                </div>
                              )}
                              <span className={`font-semibold ${isOutgoing ? 'text-blue-800' : 'text-gray-600'}`}>
                                {outgoingDisplayName}
                              </span>
                              <span className="shrink-0 tabular-nums text-gray-400">
                                {new Date(message.sent_at).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                            <div
                              dir={messageRtl ? 'rtl' : 'ltr'}
                              className={`max-w-full md:max-w-[70%] rounded-2xl px-4 py-3 shadow-sm text-start border-0 outline-none ${
                                isOutgoing
                                  ? 'bg-blue-50 text-gray-900'
                                  : 'bg-white text-gray-900'
                              }`}
                              style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', unicodeBidi: 'plaintext' }}
                            >
                              <div className="mb-2">
                                <div className="text-sm font-semibold text-gray-900">
                                  {message.subject}
                                </div>
                              </div>

                              {(() => {
                                const rawBody = message.body_html || message.body_preview || '';
                                const { body: rawBodyPart, signature: rawSigPart } =
                                  splitMessageBodyAndSignature(rawBody);
                                const body = isOutgoing
                                  ? cleanOutgoingBreaklines(rawBodyPart)
                                  : rawBodyPart;
                                const signature = rawSigPart
                                  ? isOutgoing
                                    ? cleanOutgoingBreaklines(rawSigPart)
                                    : rawSigPart
                                  : null;
                                // Sent boxes: always render cleaned plain lines so original breaklines stay tidy
                                const bodyHtml = isOutgoing
                                  ? plainTextToSafeHtml(body)
                                  : looksLikeEmailHtml(body)
                                    ? renderableEmailHtml(body)
                                    : plainTextToSafeHtml(htmlOrTextToPlainLines(body));
                                const signatureHtml = signature
                                  ? plainTextToSafeHtml(htmlOrTextToPlainLines(signature))
                                  : '';

                                if (!bodyHtml && !signatureHtml) {
                                  return (
                                    <div className={`italic ${isOutgoing ? 'text-gray-500' : 'text-gray-500'}`}>
                                      No content available
                                    </div>
                                  );
                                }

                                return (
                                  <>
                                    {bodyHtml ? (
                                      <div
                                        dangerouslySetInnerHTML={{ __html: bodyHtml }}
                                        className={`prose prose-sm max-w-none break-words [&_*]:max-w-full email-content text-gray-800 [&_a]:text-blue-600 [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-blue-800 ${
                                          isOutgoing ? 'email-content-outgoing' : ''
                                        } ${messageRtl ? 'prose-headings:text-start prose-p:text-start' : ''}`}
                                        style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                                      />
                                    ) : null}
                                    {signatureHtml ? (
                                      <div
                                        dangerouslySetInnerHTML={{ __html: signatureHtml }}
                                        className={`prose prose-sm mt-3 max-w-none break-words border-t pt-3 text-gray-600 [&_*]:max-w-full email-content [&_a]:text-blue-600 [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-blue-800 ${
                                          isOutgoing
                                            ? 'email-content-outgoing border-blue-100/80'
                                            : 'border-gray-100'
                                        }`}
                                        style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                                      />
                                    ) : null}
                                  </>
                                );
                              })()}

                              {message.attachments && Array.isArray(message.attachments) && message.attachments.length > 0 && (
                                <div
                                  className={`mt-3 pt-3 text-start ${
                                    isOutgoing ? 'border-t border-blue-100/80' : 'border-t border-gray-100'
                                  }`}
                                >
                                  <div
                                    className={`mb-2 text-xs font-medium ${
                                      isOutgoing ? 'text-gray-600' : 'text-gray-600'
                                    }`}
                                  >
                                    Attachments ({message.attachments.length}):
                                  </div>
                                  <div className="space-y-2">
                                    {message.attachments.map((attachment: any, idx: number) => {
                                      if (!attachment || (!attachment.id && !attachment.name && !attachment.contentBytes)) {
                                        return null;
                                      }

                                      const attachmentKey = attachment.id || attachment.name || `${message.id}-${idx}`;
                                      const attachmentName = attachment.name || `Attachment ${idx + 1}`;
                                      const isDownloading =
                                        attachment.id && downloadingAttachments[attachment.id];
                                      const mediaKind = getAttachmentMediaKind(attachment);
                                      const messageId = String(message.message_id || message.id || '');

                                      if (mediaKind) {
                                        return (
                                          <EmailAttachmentMediaPreview
                                            key={attachmentKey}
                                            messageId={messageId}
                                            attachment={attachment}
                                            userId={userId}
                                            isDownloading={Boolean(isDownloading)}
                                            onDownload={() => handleAttachmentDownload(message, attachment)}
                                          />
                                        );
                                      }

                                      return (
                                        <button
                                          key={attachmentKey}
                                          type="button"
                                          className={`flex w-full items-center gap-2 text-xs font-medium text-blue-600 transition-colors hover:text-blue-800 ${messageRtl ? 'flex-row-reverse text-start' : 'text-start'}`}
                                          onClick={() => handleAttachmentDownload(message, attachment)}
                                          disabled={Boolean(isDownloading)}
                                        >
                                          {isDownloading ? (
                                            <span className="loading loading-spinner loading-xs" />
                                          ) : (
                                            <DocumentTextIcon className="h-4 w-4 flex-shrink-0" />
                                          )}
                                          <span className="flex-1 truncate">{attachmentName}</span>
                                          {attachment.size && (
                                            <span className="flex-shrink-0 text-xs text-gray-500">
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
                    })}
                    </>
                  )}
                  {!chatLoading && <div ref={messagesEndRef} />}
                </div>

                <div className="absolute inset-x-0 bottom-0 z-20 border-t border-white/40 bg-white/55 shadow-[0_-4px_24px_rgba(15,23,42,0.06)] backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/40">
                  <div className="space-y-2 px-3 py-2 md:px-4 md:py-2.5">

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

                    <ComposeAttachmentPreviews files={attachments} onRemove={removeAttachment} />

                    <div className="flex items-end gap-2">
                      <div className="relative shrink-0 self-end pb-0.5">
                        <button
                          type="button"
                          className="btn btn-ghost btn-circle btn-sm h-9 w-9 min-h-0 border border-gray-200"
                          onClick={() => setIsActionMenuOpen((prev) => !prev)}
                        >
                          <PlusIcon className="h-5 w-5 text-gray-700" />
                        </button>
                        {isActionMenuOpen && (
                          <div className="absolute bottom-11 left-0 z-30 w-48 rounded-xl border border-gray-200 bg-white shadow-lg">
                            <button
                              className="flex w-full items-center gap-2 px-4 py-3 text-sm hover:bg-gray-50"
                              onClick={() => {
                                setIsActionMenuOpen(false);
                                fileInputRef.current?.click();
                              }}
                            >
                              <PaperClipIcon className="h-4 w-4 text-gray-600" />
                              Add Attachment
                            </button>
                            <button
                              className="flex w-full items-center gap-2 px-4 py-3 text-sm hover:bg-gray-50"
                              onClick={() => {
                                setIsActionMenuOpen(false);
                                setShowSubjectInput(true);
                              }}
                            >
                              <DocumentTextIcon className="h-4 w-4 text-gray-600" />
                              Subject
                            </button>
                            <button
                              className="flex w-full items-center gap-2 px-4 py-3 text-sm hover:bg-gray-50"
                              onClick={handleAISuggestions}
                            >
                              <SparklesIcon className="h-4 w-4 text-gray-600" />
                              AI Suggestion
                            </button>
                          </div>
                        )}
                        {showSubjectInput && (
                          <>
                            <div
                              className="fixed inset-0 z-40"
                              onClick={() => setShowSubjectInput(false)}
                            />
                            <div className="absolute bottom-12 left-0 z-50 w-72 space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-xl">
                              <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold text-gray-900">Edit Subject</h4>
                                <button
                                  type="button"
                                  className="text-gray-400 hover:text-gray-600"
                                  onClick={() => setShowSubjectInput(false)}
                                >
                                  <XMarkIcon className="h-4 w-4" />
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
                        rows={1}
                        className="min-h-[40px] max-h-[200px] flex-1 resize-none rounded-full border border-gray-300 bg-slate-50 px-5 py-2.5 text-[15px] leading-5 text-gray-900 outline-none focus:border-[#4218CC] focus:bg-white focus:ring-1 focus:ring-[#4218CC]"
                        style={{ height: '40px', overflowY: 'hidden' }}
                      />

                      <button
                        className="btn btn-primary btn-circle mb-0.5 h-10 w-10 min-h-0 shrink-0"
                        onClick={handleSendEmail}
                        disabled={isSending || !newMessage.trim() || !selectedLead}
                      >
                        <PaperAirplaneIcon className="h-5 w-5" />
                        <span className="sr-only">Send</span>
                      </button>
                    </div>
                    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                      <ComposeSignaturePreview compact />
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
              <div className="flex flex-1 items-center justify-center pt-24 text-gray-500">
                <div className="text-center">
                  <EnvelopeIcon className="mx-auto mb-4 h-16 w-16 text-gray-300" />
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
      <EmailSentSuccessModal
        open={showEmailSentModal}
        onClose={() => setShowEmailSentModal(false)}
        recipient={selectedLead?.sender_email}
      />
    </div>
  );
};

export default EmailThreadLeadPage;

