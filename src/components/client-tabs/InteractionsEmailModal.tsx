import React from 'react';
import {
  DocumentTextIcon,
  EnvelopeIcon,
  InboxIcon,
  MagnifyingGlassIcon,
  PaperAirplaneIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { ContactInfo } from '../../lib/contactHelpers';
import {
  applyEmailSidepanelListMode,
  dedupeEmailsForSidepanel,
  emailsInSubjectThread,
  groupEmailsIntoSubjectConversations,
  normalizeEmailSubjectKey,
  type EmailSidepanelListMode,
} from '../../lib/interactions/emailFilters';
import {
  EmailContentWithErrorHandling,
  fileAttachmentsForUi,
  formatEmailHtmlForReadingPane,
  isOfficeEmail,
  parseEmailAttachmentsFromDb,
  processEmailHtmlWithInlineImages,
  sanitizeEmailHtml,
} from './interactionsEmailViewUtils';
import { EmailMessageActionsDropdown } from './EmailMessageActionsDropdown';
import { EmailMessageComments } from './EmailMessageComments';
import { EmailSidepanelListMenu } from './EmailSidepanelListMenu';
import type { EmailComment } from '../../lib/interactions/emailComments';
import { fetchEmailCommentsByEmailIds } from '../../lib/interactions/emailComments';

/** Stable palette — looks varied but does not flicker on re-render */
const CLIENT_AVATAR_BACKGROUNDS = [
  'bg-emerald-500',
  'bg-teal-500',
  'bg-sky-500',
  'bg-indigo-500',
  'bg-violet-600',
  'bg-fuchsia-600',
  'bg-rose-500',
  'bg-orange-500',
  'bg-amber-600',
  'bg-cyan-600',
  'bg-blue-600',
  'bg-lime-600',
] as const;

function hashString(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getClientAvatarBgClass(stableKey: string): string {
  const idx = hashString(stableKey) % CLIENT_AVATAR_BACKGROUNDS.length;
  return `${CLIENT_AVATAR_BACKGROUNDS[idx]} shadow-sm ring-2 ring-white/90`;
}

function initialsFromName(name: string): string {
  const t = name.trim();
  if (!t) return '?';
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0][0] || '';
    const b = parts[parts.length - 1][0] || '';
    return (a + b).toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

function resolveEmployeePhotoUrl(
  photoMap: Map<string, string> | undefined,
  displayName: string,
  senderEmail?: string | null
): string | null {
  if (!photoMap) return null;
  if (displayName?.trim()) {
    const t = displayName.trim();
    if (photoMap.has(t)) return photoMap.get(t)!;
    const lower = t.toLowerCase();
    for (const [name, url] of photoMap) {
      if (name.includes('@')) continue;
      if (name.trim().toLowerCase() === lower) return url;
    }
  }
  const em = senderEmail?.trim().toLowerCase();
  if (em && photoMap.has(em)) return photoMap.get(em)!;
  return null;
}

function TeamAvatar({
  photoUrl,
  initials,
  name,
  size = 'sm',
}: {
  photoUrl: string | null;
  initials: string;
  name: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [imgError, setImgError] = React.useState(false);
  const sizeClass =
    size === 'lg'
      ? 'h-10 w-10 text-[0.7rem]'
      : size === 'md'
        ? 'h-9 w-9 text-[0.6rem]'
        : 'h-7 w-7 text-[0.55rem]';
  if (photoUrl && !imgError) {
    return (
      <img
        src={photoUrl}
        alt={name}
        className={`${sizeClass} shrink-0 rounded-full object-cover shadow-sm ring-1 ring-white/90`}
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <div
      className={`flex ${sizeClass} shrink-0 items-center justify-center rounded-full bg-[#4218CC] font-bold uppercase tracking-wide text-white shadow-sm ring-1 ring-white/90`}
      title={name}
      aria-hidden
    >
      {initials}
    </div>
  );
}

function displayConversationSubject(subject?: string | null): string {
  let s = String(subject || '').trim();
  if (!s) return '(no subject)';
  for (let i = 0; i < 8; i++) {
    const next = s.replace(/^(re|fw|fwd|aw|sv|vs|antw)\s*:\s*/i, '').trim();
    if (next === s) break;
    s = next;
  }
  return s || '(no subject)';
}

function collectConversationParticipants(
  messages: any[],
  opts: {
    currentUserFullName: string | null;
    clientName: string;
    contactName?: string | null;
  },
): Array<{ key: string; name: string; email: string; isOutgoing: boolean }> {
  const byKey = new Map<string, { key: string; name: string; email: string; isOutgoing: boolean }>();
  for (const message of messages) {
    const email = String(message.from || '')
      .trim()
      .toLowerCase();
    if (!email) continue;
    const isOutgoing = isOfficeEmail(email) || message.direction === 'outgoing';
    const name = isOutgoing
      ? String(
          message.sender_display_name || opts.currentUserFullName || message.sender_name || 'Team',
        ).trim()
      : String(opts.contactName || opts.clientName || message.sender_name || email).trim();
    if (!byKey.has(email)) {
      byKey.set(email, { key: email, name: name || email, email, isOutgoing });
    }
  }
  return Array.from(byKey.values());
}

export type SelectedContactForEmail = {
  contact: ContactInfo;
  leadId: string | number;
  leadType: 'legacy' | 'new';
} | null;

export type InteractionsEmailModalClientSlice = {
  name: string;
  lead_number: string;
};

export type InteractionsEmailModalProps = {
  client: InteractionsEmailModalClientSlice;
  selectedContactForEmail: SelectedContactForEmail;
  isMobile: boolean;
  showEmailDetail: boolean;
  setShowEmailDetail: (v: boolean) => void;
  setSelectedEmailForView: (v: any | null) => void;
  setIsEmailModalOpen: (v: boolean) => void;
  setEmailSearchQuery: (v: string) => void;
  emailSearchQuery: string;
  mailboxStatus: { connected: boolean };
  formattedLastSync: string | null;
  mailboxError: string | null;
  handleMailboxConnect: () => void;
  isMailboxLoading: boolean;
  userId: string | null;
  emailsLoading: boolean;
  emails: any[];
  selectedEmailForView: any | null;
  hydrateEmailBodies: (messages: any[]) => void;
  ensureAttachmentsIfNeeded: (message: any) => void;
  currentUserFullName: string | null;
  formatTime: (date: string) => string;
  downloadingAttachments: Record<string, boolean>;
  handleDownloadAttachment: (emailId: string, attachment: any) => void;
  /** display_name and work email (lowercase) → photo_url; used for team/outgoing rows */
  employeePhotoMap?: Map<string, string>;
  onReplyMessage?: (message: any) => void;
  onForwardMessage?: (message: any) => void;
  onDeleteMessage?: (message: any) => void;
  children: React.ReactNode;
};

export function InteractionsEmailModal({
  client,
  selectedContactForEmail,
  isMobile,
  showEmailDetail,
  setShowEmailDetail,
  setSelectedEmailForView,
  setIsEmailModalOpen,
  setEmailSearchQuery,
  emailSearchQuery,
  mailboxStatus,
  formattedLastSync,
  mailboxError,
  handleMailboxConnect,
  isMailboxLoading,
  userId,
  emailsLoading,
  emails,
  selectedEmailForView,
  hydrateEmailBodies,
  ensureAttachmentsIfNeeded,
  currentUserFullName,
  formatTime,
  downloadingAttachments,
  handleDownloadAttachment,
  employeePhotoMap,
  onReplyMessage,
  onForwardMessage,
  onDeleteMessage,
  children,
}: InteractionsEmailModalProps) {
  const [listFilter, setListFilter] = React.useState<'all' | 'incoming' | 'outgoing'>('all');
  const [listMode, setListMode] = React.useState<EmailSidepanelListMode>('newest');
  const [conversationDirectionFilter, setConversationDirectionFilter] = React.useState<
    'all' | 'incoming' | 'outgoing'
  >('all');
  const [commentsByEmailId, setCommentsByEmailId] = React.useState<Record<string, EmailComment[]>>(
    {},
  );
  const [commentComposerEmailId, setCommentComposerEmailId] = React.useState<string | null>(null);

  const conversationEmails = React.useMemo(() => {
    if (!selectedEmailForView) return [];
    return emailsInSubjectThread(dedupeEmailsForSidepanel(emails), selectedEmailForView, {
      getSubject: (e) => e.subject,
      getDate: (e) => e.date,
    });
  }, [emails, selectedEmailForView]);

  const visibleConversationEmails = React.useMemo(() => {
    if (conversationDirectionFilter === 'all') return conversationEmails;
    return conversationEmails.filter((m) => {
      const outgoing = isOfficeEmail(m.from) || m.direction === 'outgoing';
      return conversationDirectionFilter === 'outgoing' ? outgoing : !outgoing;
    });
  }, [conversationEmails, conversationDirectionFilter]);

  React.useEffect(() => {
    setConversationDirectionFilter('all');
    setCommentComposerEmailId(null);
  }, [selectedEmailForView?.id, selectedEmailForView?.subject]);

  React.useEffect(() => {
    if (conversationEmails.length === 0) return;
    hydrateEmailBodies(conversationEmails);
    conversationEmails.forEach((message) => {
      void ensureAttachmentsIfNeeded(message);
    });
  }, [conversationEmails, hydrateEmailBodies, ensureAttachmentsIfNeeded]);

  React.useEffect(() => {
    const ids = conversationEmails.map((m) => String(m.id)).filter(Boolean);
    if (ids.length === 0) {
      setCommentsByEmailId({});
      return;
    }
    let cancelled = false;
    void fetchEmailCommentsByEmailIds(ids)
      .then((map) => {
        if (!cancelled) setCommentsByEmailId(map);
      })
      .catch((err) => {
        console.error('Failed to load email comments', err);
        if (!cancelled) setCommentsByEmailId({});
      });
    return () => {
      cancelled = true;
    };
  }, [conversationEmails]);

  const handleCommentsChange = React.useCallback((emailId: string, next: EmailComment[]) => {
    setCommentsByEmailId((prev) => ({ ...prev, [emailId]: next }));
  }, []);

  return (
    <div className="fixed inset-0 bg-white z-[9999]">
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
            .email-content {
              max-width: none !important;
              overflow: visible !important;
              word-wrap: break-word !important;
            }
            .email-content * {
              max-width: none !important;
              overflow: visible !important;
            }
            .email-content img {
              max-width: 100% !important;
              height: auto !important;
              display: inline-block !important;
              object-fit: contain !important;
            }
            .email-content img[src^="data:"] {
              max-width: 100% !important;
              height: auto !important;
              display: inline-block !important;
            }
            .email-content img[data-load-error="true"] {
              display: none !important;
            }
            .email-content table {
              width: 100% !important;
              border-collapse: collapse !important;
            }
            .email-content p, 
            .email-content div, 
            .email-content span {
              word-wrap: break-word !important;
            }
            .email-content [dir] {
            }
            .email-content [dir="auto"] {
              unicode-bidi: plaintext;
            }
            .email-content [dir="rtl"] {
              text-align: right;
            }
            .email-content [dir="ltr"] {
              text-align: left;
            }
          `}</style>
      <div className="flex h-full min-h-0 overflow-hidden">
          <aside
            className={`${isMobile && showEmailDetail ? 'hidden' : isMobile ? 'w-full' : 'w-[22rem] md:w-96'} flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-slate-200/90 bg-white`}
          >
            <div className="shrink-0 bg-white px-3 py-2">
              <div className="flex items-center gap-1.5">
                <EmailSidepanelListMenu value={listMode} onChange={setListMode} />
                <div className="relative min-w-0 flex-1">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5">
                    <MagnifyingGlassIcon className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    className="block w-full rounded-full border border-gray-300 bg-white py-1.5 pl-9 pr-9 text-left text-sm leading-5 placeholder-gray-400 focus:border-[#4218CC] focus:outline-none focus:ring-1 focus:ring-[#4218CC]"
                    placeholder="Search emails…"
                    value={emailSearchQuery}
                    onChange={(e) => setEmailSearchQuery(e.target.value)}
                  />
                  {emailSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setEmailSearchQuery('')}
                      className="absolute inset-y-0 right-0 flex items-center pr-2.5"
                      aria-label="Clear search"
                    >
                      <XMarkIcon className="h-4 w-4 text-gray-400 hover:text-gray-600" />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {emailsLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="loading loading-spinner loading-lg text-purple-500"></div>
                </div>
              ) : emails.length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-500 p-4">
                  <div className="text-center">
                    <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                    <p className="text-sm font-medium">No emails</p>
                    <p className="text-xs text-gray-400 mt-1">Try syncing emails</p>
                  </div>
                </div>
              ) : (
                (() => {
                  const filteredEmails = dedupeEmailsForSidepanel([...emails]).filter((message) => {
                    const senderEmail = message.from || '';
                    const isFromOffice = isOfficeEmail(senderEmail);
                    const isOutgoing = isFromOffice ? true : message.direction === 'outgoing';
                    if (listFilter === 'incoming' && isOutgoing) return false;
                    if (listFilter === 'outgoing' && !isOutgoing) return false;

                    if (selectedContactForEmail) {
                      const contactId = Number(selectedContactForEmail.contact.id);
                      const contactEmail = selectedContactForEmail.contact.email?.toLowerCase().trim();

                      if (message.contact_id !== null && message.contact_id !== undefined) {
                        const emailContactId = Number(message.contact_id);
                        if (emailContactId !== contactId) {
                          return false;
                        }
                      } else {
                        if (contactEmail) {
                          const messageFrom = message.from?.toLowerCase().trim();
                          const messageTo = message.to?.toLowerCase().trim() || '';
                          const recipients = messageTo.split(/[,;]/).map((r: string) => r.trim());
                          const matchesContact =
                            messageFrom === contactEmail || recipients.includes(contactEmail);

                          if (!matchesContact) {
                            return false;
                          }
                        } else {
                          return false;
                        }
                      }
                    }

                    if (!emailSearchQuery.trim()) return true;

                    const searchTerm = emailSearchQuery.toLowerCase();

                    if (message.subject && message.subject.toLowerCase().includes(searchTerm)) return true;
                    if (message.bodyPreview && message.bodyPreview.toLowerCase().includes(searchTerm)) return true;
                    if (message.from && message.from.toLowerCase().includes(searchTerm)) return true;
                    if (message.to && message.to.toLowerCase().includes(searchTerm)) return true;

                    const isTeamEmail = isFromOffice || message.direction === 'outgoing';
                    const senderName = isTeamEmail
                      ? ((message as any).sender_display_name || currentUserFullName || 'Team')
                      : selectedContactForEmail?.contact.name || client.name || 'Client';
                    if (senderName.toLowerCase().includes(searchTerm)) return true;

                    return false;
                  });

                  if (
                    filteredEmails.length === 0 &&
                    (emailSearchQuery.trim() || listFilter !== 'all' || listMode !== 'newest')
                  ) {
                    return (
                      <div className="flex items-center justify-center h-full text-gray-500 p-4">
                        <div className="text-center">
                          <MagnifyingGlassIcon className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                          <p className="text-sm font-medium">No emails found</p>
                          <p className="text-xs text-gray-400 mt-1">
                            {emailSearchQuery.trim()
                              ? `No emails match "${emailSearchQuery}"`
                              : listMode === 'unreplied'
                                ? 'No unreplied inbox emails'
                                : 'No emails in this folder'}
                          </p>
                          <button
                            onClick={() => {
                              setEmailSearchQuery('');
                              setListFilter('all');
                              setListMode('newest');
                            }}
                            className="mt-3 text-xs text-purple-600 hover:text-purple-800 underline"
                          >
                            Clear filters
                          </button>
                        </div>
                      </div>
                    );
                  }

                  const conversationGroups = applyEmailSidepanelListMode(
                    groupEmailsIntoSubjectConversations(filteredEmails, {
                      getSubject: (e) => e.subject,
                      getDate: (e) => e.date,
                    }),
                    listMode,
                    {
                      isOutgoing: (message) => {
                        const senderEmail = message.from || '';
                        return isOfficeEmail(senderEmail)
                          ? true
                          : message.direction === 'outgoing';
                      },
                      getDate: (e) => e.date,
                    },
                  );

                  if (conversationGroups.length === 0) {
                    return (
                      <div className="flex items-center justify-center h-full text-gray-500 p-4">
                        <div className="text-center">
                          <MagnifyingGlassIcon className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                          <p className="text-sm font-medium">No emails found</p>
                          <p className="text-xs text-gray-400 mt-1">
                            {listMode === 'unreplied'
                              ? 'No unreplied inbox emails'
                              : 'No emails match this filter'}
                          </p>
                          <button
                            onClick={() => setListMode('newest')}
                            className="mt-3 text-xs text-purple-600 hover:text-purple-800 underline"
                          >
                            Clear filters
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <ul className="divide-y divide-slate-200/80">
                      {conversationGroups.map((group) => {
                          const message = group.latest;
                          const senderEmail = message.from || '';
                          const isFromOffice = isOfficeEmail(senderEmail);
                          const isOutgoing = isFromOffice ? true : message.direction === 'outgoing';
                          const senderDisplayName = isOutgoing
                            ? ((message as any).sender_display_name || currentUserFullName || 'Team')
                            : selectedContactForEmail?.contact.name || client.name || 'Client';
                          const selectedKey = selectedEmailForView
                            ? normalizeEmailSubjectKey(selectedEmailForView.subject) ||
                              `__id:${selectedEmailForView.id}`
                            : null;
                          const groupKey =
                            normalizeEmailSubjectKey(message.subject) || `__id:${message.id}`;
                          const isSelected = Boolean(
                            selectedEmailForView &&
                              (selectedKey === group.key ||
                                group.messages.some(
                                  (m) => String(m.id) === String(selectedEmailForView.id),
                                )),
                          );

                          const contentForPreview =
                            (message as any).body_html || message.bodyPreview || (message as any).body_preview || '';
                          const previewText = contentForPreview
                            ? contentForPreview
                                .replace(/<[^>]*>/g, '')
                                .replace(/&nbsp;/g, ' ')
                                .replace(/\s+/g, ' ')
                                .trim()
                            : '';

                          const subjectLine = displayConversationSubject(message.subject);
                          const previewOneLine = previewText || '—';

                          const initials = initialsFromName(senderDisplayName);
                          const avatarColorKey = `${senderDisplayName}|${senderEmail}|${message.contact_id ?? ''}`;
                          const avatarBg = getClientAvatarBgClass(avatarColorKey);
                          const teamPhotoUrl = isOutgoing
                            ? resolveEmployeePhotoUrl(employeePhotoMap, (message as any).sender_display_name || senderDisplayName, senderEmail)
                            : null;

                          return (
                            <li key={group.key || groupKey}>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedEmailForView(message);
                                  hydrateEmailBodies(group.messages);
                                  group.messages.forEach((m) => {
                                    void ensureAttachmentsIfNeeded(m);
                                  });
                                  if (isMobile) {
                                    setShowEmailDetail(true);
                                  }
                                }}
                                className={`group relative flex w-full gap-2 px-3 pb-8 pt-2.5 text-left transition-colors md:px-3.5 ${
                                  isSelected
                                    ? 'border-l-[3px] border-l-[#4218CC] bg-[#4218CC]/12 shadow-[inset_0_0_0_1px_rgba(66,24,204,0.12)]'
                                    : 'border-l-[3px] border-l-transparent hover:bg-slate-50 active:bg-slate-100'
                                }`}
                              >
                                {isOutgoing ? (
                                  <TeamAvatar
                                    photoUrl={teamPhotoUrl}
                                    initials={initials}
                                    name={senderDisplayName}
                                    size="md"
                                  />
                                ) : (
                                  <div
                                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-bold uppercase tracking-wide text-white ${avatarBg}`}
                                    aria-hidden
                                  >
                                    {initials}
                                  </div>
                                )}
                                <div className="min-w-0 flex-1 py-0.5">
                                  <div className="flex items-center gap-2">
                                    <span
                                      className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 group-hover:text-slate-950"
                                      dir="auto"
                                    >
                                      {senderDisplayName}
                                    </span>
                                    <time
                                      className="shrink-0 text-[11px] font-medium tabular-nums text-slate-400 group-hover:text-slate-500"
                                      dateTime={message.date}
                                    >
                                      {formatTime(message.date)}
                                    </time>
                                    <span
                                      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${
                                        group.count > 1
                                          ? 'bg-slate-100 text-slate-600'
                                          : 'invisible'
                                      }`}
                                      title={
                                        group.count > 1
                                          ? `${group.count} messages in this conversation`
                                          : undefined
                                      }
                                      aria-hidden={group.count <= 1}
                                    >
                                      {group.count > 1 ? group.count : 0}
                                    </span>
                                  </div>
                                  <p className="mt-0.5 max-w-[11rem] truncate text-sm font-bold text-slate-800 sm:max-w-[13rem] md:max-w-[14rem]" dir="auto">
                                    {subjectLine}
                                  </p>
                                  <p className="mt-0.5 truncate text-xs leading-snug text-slate-500" dir="auto">
                                    {previewOneLine}
                                  </p>
                                </div>
                                <span
                                  className={`pointer-events-none absolute bottom-1.5 left-2.5 inline-flex items-center justify-center ${
                                    isOutgoing ? 'text-blue-600' : 'text-emerald-600'
                                  }`}
                                  title={isOutgoing ? 'Sent' : 'Inbox'}
                                  aria-label={isOutgoing ? 'Sent' : 'Inbox'}
                                >
                                  {isOutgoing ? (
                                    <PaperAirplaneIcon className="h-5 w-5" />
                                  ) : (
                                    <InboxIcon className="h-5 w-5" />
                                  )}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                    </ul>
                  );
                })()
              )}
            </div>
            <div className="shrink-0 bg-white p-2">
              <div className="flex gap-1">
                {(
                  [
                    ['all', 'All', EnvelopeIcon],
                    ['incoming', 'Inbox', InboxIcon],
                    ['outgoing', 'Sent', PaperAirplaneIcon],
                  ] as const
                ).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setListFilter(key)}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                      listFilter === key
                        ? 'bg-[#4218CC] text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <section
            className={`${isMobile && !showEmailDetail ? 'hidden' : 'flex-1'} relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-slate-100`}
          >
            <header className="absolute inset-x-0 top-0 z-20 border-b border-white/40 bg-white/55 px-3 py-2.5 shadow-sm backdrop-blur-xl backdrop-saturate-150 md:px-4 md:py-3 supports-[backdrop-filter]:bg-white/40">
              <div className="flex items-start gap-2 md:gap-3">
                {isMobile && showEmailDetail && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowEmailDetail(false);
                      setSelectedEmailForView(null);
                    }}
                    className="btn btn-ghost btn-circle btn-sm mt-0.5 shrink-0"
                    aria-label="Back to list"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  {selectedEmailForView ? (
                    <>
                      <h2
                        className="truncate text-base font-bold text-slate-900 md:text-lg"
                        dir="auto"
                        title={displayConversationSubject(selectedEmailForView.subject)}
                      >
                        {displayConversationSubject(selectedEmailForView.subject)}
                      </h2>
                      <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-slate-500">
                        <span className="shrink-0 font-semibold text-slate-600">Participants:</span>
                        <span className="min-w-0 truncate font-medium text-slate-700" dir="auto">
                          {collectConversationParticipants(conversationEmails, {
                            currentUserFullName,
                            clientName: client.name,
                            contactName: selectedContactForEmail?.contact.name,
                          })
                            .map((participant) => participant.name)
                            .join(', ') || '—'}
                        </span>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm font-medium text-slate-500">Select an email to read</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
                  {selectedEmailForView &&
                    (() => {
                      const sentCount = conversationEmails.filter(
                        (m) => isOfficeEmail(m.from) || m.direction === 'outgoing',
                      ).length;
                      const inboxCount = conversationEmails.length - sentCount;
                      const inboxActive = conversationDirectionFilter === 'incoming';
                      const sentActive = conversationDirectionFilter === 'outgoing';
                      return (
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setConversationDirectionFilter((prev) =>
                                prev === 'incoming' ? 'all' : 'incoming',
                              )
                            }
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums transition md:gap-2 md:px-3 md:py-1.5 md:text-sm ${
                              inboxActive
                                ? 'bg-emerald-600 text-white ring-2 ring-emerald-600/30 ring-offset-1'
                                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            }`}
                            title={inboxActive ? 'Show all messages' : 'Show inbox only'}
                            aria-pressed={inboxActive}
                          >
                            <InboxIcon className="h-4 w-4 md:h-5 md:w-5" />
                            {inboxCount}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setConversationDirectionFilter((prev) =>
                                prev === 'outgoing' ? 'all' : 'outgoing',
                              )
                            }
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums transition md:gap-2 md:px-3 md:py-1.5 md:text-sm ${
                              sentActive
                                ? 'bg-blue-600 text-white ring-2 ring-blue-600/30 ring-offset-1'
                                : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                            }`}
                            title={sentActive ? 'Show all messages' : 'Show sent only'}
                            aria-pressed={sentActive}
                          >
                            <PaperAirplaneIcon className="h-4 w-4 md:h-5 md:w-5" />
                            {sentCount}
                          </button>
                        </div>
                      );
                    })()}
                  <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
                    {!isMobile && (
                      <>
                        <span
                          className={`hidden max-w-[10rem] truncate sm:inline-flex md:max-w-none items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                            mailboxStatus.connected
                              ? 'bg-emerald-50 text-emerald-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                          title={formattedLastSync ? `Last sync: ${formattedLastSync}` : undefined}
                        >
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" />
                          {mailboxStatus.connected ? 'Connected' : 'Disconnected'}
                        </span>
                        {!mailboxStatus.connected && (
                          <button
                            type="button"
                            className="btn btn-primary btn-xs shrink-0 px-2"
                            onClick={handleMailboxConnect}
                            disabled={isMailboxLoading || !userId}
                          >
                            Connect
                          </button>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setIsEmailModalOpen(false);
                        setSelectedEmailForView(null);
                        setEmailSearchQuery('');
                        setShowEmailDetail(false);
                      }}
                      className="btn btn-ghost btn-circle btn-sm shrink-0 md:btn-md"
                      aria-label="Close"
                    >
                      <XMarkIcon className="h-5 w-5 md:h-6 md:w-6" />
                    </button>
                  </div>
                </div>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-100 px-3 pb-24 pt-[5.5rem] sm:px-4 md:px-5 md:pb-28 md:pt-[6.25rem]">
              {selectedEmailForView ? (
                <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
                  {visibleConversationEmails.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 px-4 py-10 text-center text-sm text-slate-500">
                      No {conversationDirectionFilter === 'outgoing' ? 'sent' : 'inbox'} messages
                      in this conversation.
                    </div>
                  ) : null}
                  {visibleConversationEmails.map((message, index) => {
                      const isOutgoing =
                        isOfficeEmail(message.from) || message.direction === 'outgoing';
                      const personName = isOutgoing
                        ? ((message as any).sender_display_name || currentUserFullName || 'Team')
                        : selectedContactForEmail?.contact.name || client.name || 'Client';
                      const personEmail = isOutgoing
                        ? message.from
                        : selectedContactForEmail?.contact.email || message.from;
                      const initials = initialsFromName(personName);
                      const teamPhotoUrl = isOutgoing
                        ? resolveEmployeePhotoUrl(
                            employeePhotoMap,
                            (message as any).sender_display_name || personName,
                            message.from,
                          )
                        : null;
                      const clientAvatarBg = getClientAvatarBgClass(
                        `${personName}|${personEmail || ''}|${message.contact_id ?? ''}`,
                      );

                      let emailContent =
                        message.body_html || message.bodyPreview || message.body_preview;
                      if (emailContent) {
                        const attachments = parseEmailAttachmentsFromDb(message.attachments);
                        emailContent = processEmailHtmlWithInlineImages(emailContent, attachments);
                        // Bodies are stored reading-pane-formatted; only reformat raw/unprocessed HTML.
                        const alreadyFormatted = /timeline-prewrap/i.test(String(emailContent));
                        if (!alreadyFormatted) {
                          emailContent = formatEmailHtmlForReadingPane(emailContent);
                          emailContent = sanitizeEmailHtml(emailContent);
                        }
                      }
                      const fileAtt = fileAttachmentsForUi(
                        parseEmailAttachmentsFromDb(message.attachments),
                      );

                      return (
                        <article
                          key={message.id || index}
                          id={`email-msg-${message.id}`}
                          className="rounded-xl border border-slate-200/80 bg-white px-3 py-4 shadow-sm md:px-5 md:py-5"
                        >
                          <div className="mb-3 flex items-start gap-2.5">
                            {isOutgoing ? (
                              <TeamAvatar
                                photoUrl={teamPhotoUrl}
                                initials={initials}
                                name={personName}
                                size="lg"
                              />
                            ) : (
                              <div
                                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-bold uppercase tracking-wide text-white ${clientAvatarBg}`}
                                aria-hidden
                              >
                                {initials}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-gray-900" dir="auto">
                                  {personName}
                                </span>
                                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                                  <span
                                    className={`inline-flex shrink-0 items-center justify-center ${
                                      isOutgoing ? 'text-blue-600' : 'text-emerald-600'
                                    }`}
                                    title={isOutgoing ? 'Sent' : 'Inbox'}
                                    aria-label={isOutgoing ? 'Sent' : 'Inbox'}
                                  >
                                    {isOutgoing ? (
                                      <PaperAirplaneIcon className="h-5 w-5" />
                                    ) : (
                                      <InboxIcon className="h-5 w-5" />
                                    )}
                                  </span>
                                  <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold tabular-nums text-slate-600">
                                    {formatTime(message.date)}
                                  </span>
                                  <EmailMessageActionsDropdown
                                    onReply={() => onReplyMessage?.(message)}
                                    onForward={() => onForwardMessage?.(message)}
                                    onComment={() => setCommentComposerEmailId(String(message.id))}
                                    onDelete={() => onDeleteMessage?.(message)}
                                  />
                                </div>
                              </div>
                              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
                                {message.from && (
                                  <span
                                    className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600 sm:max-w-[18rem]"
                                    dir="ltr"
                                    title={message.from}
                                  >
                                    <span className="shrink-0 font-semibold text-slate-500">From</span>
                                    <a
                                      href={`mailto:${message.from}`}
                                      className="truncate text-blue-600 underline underline-offset-2 hover:text-blue-800"
                                    >
                                      {message.from}
                                    </a>
                                  </span>
                                )}
                                {message.to && (
                                  <span
                                    className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600 sm:max-w-[18rem]"
                                    dir="ltr"
                                    title={String(message.to)}
                                  >
                                    <span className="shrink-0 font-semibold text-slate-500">To</span>
                                    <span className="truncate">
                                      {String(message.to)
                                        .split(/[,;]/)
                                        .map((r: string) => r.trim())
                                        .filter(Boolean)
                                        .map((recipient: string, idx: number, arr: string[]) => (
                                          <span key={`${recipient}-${idx}`}>
                                            <a
                                              href={`mailto:${recipient}`}
                                              className="text-blue-600 underline underline-offset-2 hover:text-blue-800"
                                            >
                                              {recipient}
                                            </a>
                                            {idx < arr.length - 1 && ', '}
                                          </span>
                                        ))}
                                    </span>
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {emailContent ? (
                            <div className="mt-4">
                              <EmailContentWithErrorHandling html={emailContent} emailId={message.id} />
                            </div>
                          ) : (
                            <div className="mt-4 py-4 text-center text-sm italic text-gray-500">
                              Loading email content…
                              <div className="mt-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    hydrateEmailBodies([message]);
                                    void ensureAttachmentsIfNeeded(message);
                                  }}
                                  className="btn btn-sm btn-outline"
                                >
                                  Fetch Full Content
                                </button>
                              </div>
                            </div>
                          )}

                          {fileAtt.length > 0 && (
                            <div className="mt-4 border-t border-gray-100 pt-3">
                              <h3 className="mb-2 text-xs font-semibold text-gray-600">
                                Attachments ({fileAtt.length})
                              </h3>
                              <div className="space-y-2">
                                {fileAtt.map((attachment: any, idx: number) => {
                                  if (!attachment || (!attachment.id && !attachment.name)) return null;
                                  const attachmentKey =
                                    attachment.id || attachment.name || `${message.id}-${idx}`;
                                  const attachmentName = attachment.name || `Attachment ${idx + 1}`;
                                  const isDownloading =
                                    attachment.id && downloadingAttachments[attachment.id];
                                  return (
                                    <button
                                      key={attachmentKey}
                                      type="button"
                                      className="flex w-full items-center gap-3 rounded-lg border border-gray-200 p-2.5 text-left transition-colors hover:border-gray-300 hover:bg-gray-50"
                                      onClick={() => handleDownloadAttachment(message.id, attachment)}
                                      disabled={Boolean(isDownloading)}
                                    >
                                      {isDownloading ? (
                                        <span className="loading loading-spinner loading-sm text-blue-500" />
                                      ) : (
                                        <DocumentTextIcon className="h-5 w-5 flex-shrink-0 text-blue-600" />
                                      )}
                                      <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-medium text-gray-900">
                                          {attachmentName}
                                        </div>
                                        {(attachment.sizeInBytes || attachment.size) && (
                                          <div className="text-xs text-gray-500">
                                            {(
                                              (attachment.sizeInBytes || attachment.size) / 1024
                                            ).toFixed(1)}{' '}
                                            KB
                                          </div>
                                        )}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          <EmailMessageComments
                            emailId={String(message.id)}
                            comments={commentsByEmailId[String(message.id)] || []}
                            onCommentsChange={handleCommentsChange}
                            composerOpen={commentComposerEmailId === String(message.id)}
                            onComposerClose={() =>
                              setCommentComposerEmailId((prev) =>
                                prev === String(message.id) ? null : prev,
                              )
                            }
                            currentUserName={currentUserFullName}
                            currentUserPhotoUrl={
                              currentUserFullName
                                ? employeePhotoMap?.get(currentUserFullName) || null
                                : null
                            }
                          />
                        </article>
                      );
                    })}
                </div>
              ) : (
                <div className="flex min-h-[min(20rem,calc(100vh-14rem))] flex-col items-center justify-center px-4 py-16 text-slate-500">
                  <div className="text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-sm">
                      <svg className="h-8 w-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                    <p className="text-lg font-medium text-slate-700">Select an email</p>
                    <p className="mt-1 text-sm text-slate-400">Choose an email from the list to view its content</p>
                  </div>
                </div>
              )}
            </div>
            <div className="absolute inset-x-0 bottom-0 z-20 shrink-0 border-t border-white/40 bg-white/55 shadow-[0_-4px_24px_rgba(15,23,42,0.06)] backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/40">
              {children}
            </div>
          </section>
      </div>
    </div>
  );
}
