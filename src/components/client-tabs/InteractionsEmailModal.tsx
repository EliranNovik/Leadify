import React from 'react';
import {
  ChatBubbleLeftRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { ContactInfo } from '../../lib/contactHelpers';
import {
  EmailContentWithErrorHandling,
  fileAttachmentsForUi,
  formatEmailHtmlForDisplay,
  isOfficeEmail,
  parseEmailAttachmentsFromDb,
  processEmailHtmlWithInlineImages,
  sanitizeEmailHtml,
} from './interactionsEmailViewUtils';

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
}: {
  photoUrl: string | null;
  initials: string;
  name: string;
}) {
  const [imgError, setImgError] = React.useState(false);
  if (photoUrl && !imgError) {
    return (
      <img
        src={photoUrl}
        alt={name}
        className="h-12 w-12 shrink-0 rounded-full object-cover shadow-sm ring-2 ring-white/90"
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#4218CC] text-[0.7rem] font-bold uppercase tracking-wide text-white shadow-sm ring-2 ring-white/90"
      title={name}
      aria-hidden
    >
      {initials}
    </div>
  );
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
  isSearchBarOpen: boolean;
  setIsSearchBarOpen: (v: boolean) => void;
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
  isSearchBarOpen,
  setIsSearchBarOpen,
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
  children,
}: InteractionsEmailModalProps) {
  return (
    <div className="fixed inset-0 bg-white z-[9999]">
      <style>{`
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
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-slate-200/90 bg-white px-3 py-2.5 md:gap-3 md:px-4 md:py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-2.5">
            {isMobile && showEmailDetail && (
              <button
                type="button"
                onClick={() => {
                  setShowEmailDetail(false);
                  setSelectedEmailForView(null);
                }}
                className="btn btn-ghost btn-circle btn-sm shrink-0"
                aria-label="Back to list"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100">
              <ChatBubbleLeftRightIcon className="h-5 w-5 text-slate-600" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h1 className="text-lg font-semibold tracking-tight text-slate-900 md:text-xl">Interactions</h1>
                <span className="hidden text-slate-300 sm:inline" aria-hidden>
                  ·
                </span>
                <span className="flex min-w-0 max-w-full items-center gap-1.5 text-sm text-slate-600">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                  <span className="truncate font-medium">
                    {selectedContactForEmail ? selectedContactForEmail.contact.name : client.name} ({client.lead_number})
                  </span>
                </span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
            {!isMobile && (
              <>
                <span
                  className={`hidden max-w-[10rem] truncate sm:inline-flex md:max-w-none items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    mailboxStatus.connected ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'
                  }`}
                  title={formattedLastSync ? `Last sync: ${formattedLastSync}` : undefined}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" />
                  {mailboxStatus.connected ? 'Connected' : 'Disconnected'}
                </span>
                {formattedLastSync && (
                  <span className="hidden text-[11px] text-slate-400 lg:inline max-w-[9rem] truncate xl:max-w-none" title={formattedLastSync}>
                    {formattedLastSync}
                  </span>
                )}
                {mailboxError && <span className="hidden max-w-[6rem] truncate text-[11px] text-error md:inline">{mailboxError}</span>}
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
        </header>

        <div className="border-b border-gray-200 bg-white">
          <div className="px-4 md:px-6 py-2 flex items-center justify-between">
            <button
              onClick={() => setIsSearchBarOpen(!isSearchBarOpen)}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <span>Search emails</span>
              {isSearchBarOpen ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
            </button>
            {emailSearchQuery && (
              <span className="text-xs text-gray-500">
                {emailSearchQuery.length} character{emailSearchQuery.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {isSearchBarOpen && (
            <div className="px-4 md:px-6 pb-3 transition-all duration-200">
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
                  autoFocus
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
          )}
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside
            className={`${isMobile && showEmailDetail ? 'hidden' : isMobile ? 'w-full' : 'w-[22rem] md:w-96'} flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-slate-200/90 bg-white`}
          >
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
                  const filteredEmails = [...emails].filter((message) => {
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

                    const isFromOffice = isOfficeEmail(message.from);
                    const isTeamEmail = isFromOffice || message.direction === 'outgoing';
                    const senderName = isTeamEmail
                      ? ((message as any).sender_display_name || currentUserFullName || 'Team')
                      : selectedContactForEmail?.contact.name || client.name || 'Client';
                    if (senderName.toLowerCase().includes(searchTerm)) return true;

                    return false;
                  });

                  if (filteredEmails.length === 0 && emailSearchQuery.trim()) {
                    return (
                      <div className="flex items-center justify-center h-full text-gray-500 p-4">
                        <div className="text-center">
                          <MagnifyingGlassIcon className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                          <p className="text-sm font-medium">No emails found</p>
                          <p className="text-xs text-gray-400 mt-1">No emails match "{emailSearchQuery}"</p>
                          <button
                            onClick={() => setEmailSearchQuery('')}
                            className="mt-3 text-xs text-purple-600 hover:text-purple-800 underline"
                          >
                            Clear search
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <ul className="divide-y divide-slate-200/80">
                      {filteredEmails
                        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                        .map((message, index) => {
                          const senderEmail = message.from || '';
                          const isFromOffice = isOfficeEmail(senderEmail);
                          const isOutgoing = isFromOffice ? true : message.direction === 'outgoing';
                          const senderDisplayName = isOutgoing
                            ? ((message as any).sender_display_name || currentUserFullName || 'Team')
                            : selectedContactForEmail?.contact.name || client.name || 'Client';
                          const isSelected = selectedEmailForView?.id === message.id;

                          const contentForPreview =
                            (message as any).body_html || message.bodyPreview || (message as any).body_preview || '';
                          const previewText = contentForPreview
                            ? contentForPreview
                                .replace(/<[^>]*>/g, '')
                                .replace(/&nbsp;/g, ' ')
                                .replace(/\s+/g, ' ')
                                .trim()
                            : '';

                          const subjectLine = (message.subject || '(no subject)').trim();
                          const previewOneLine = previewText || '—';

                          const initials = initialsFromName(senderDisplayName);
                          const avatarColorKey = `${senderDisplayName}|${senderEmail}|${message.contact_id ?? ''}`;
                          const avatarBg = getClientAvatarBgClass(avatarColorKey);
                          const teamPhotoUrl = isOutgoing
                            ? resolveEmployeePhotoUrl(employeePhotoMap, (message as any).sender_display_name || senderDisplayName, senderEmail)
                            : null;

                          return (
                            <li key={message.id || index}>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedEmailForView(message);
                                  hydrateEmailBodies([message]);
                                  void ensureAttachmentsIfNeeded(message);
                                  if (isMobile) {
                                    setShowEmailDetail(true);
                                  }
                                }}
                                className={`group flex w-full gap-3 px-3 py-3 text-left transition-colors md:px-4 ${
                                  isSelected
                                    ? 'bg-violet-50/95 border-l-[3px] border-l-[#4218CC]'
                                    : 'border-l-[3px] border-l-transparent hover:bg-white/90 active:bg-white'
                                }`}
                              >
                                {isOutgoing ? (
                                  <TeamAvatar
                                    photoUrl={teamPhotoUrl}
                                    initials={initials}
                                    name={senderDisplayName}
                                  />
                                ) : (
                                  <div
                                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-bold uppercase tracking-wide text-white ${avatarBg}`}
                                    aria-hidden
                                  >
                                    {initials}
                                  </div>
                                )}
                                <div className="min-w-0 flex-1 py-0.5">
                                  <div className="flex items-baseline justify-between gap-2">
                                    <span
                                      className="truncate text-sm font-semibold text-slate-900 group-hover:text-slate-950"
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
                                  </div>
                                  <p className="mt-0.5 truncate text-sm font-medium text-slate-800" dir="auto">
                                    {subjectLine}
                                  </p>
                                  <p className="mt-0.5 truncate text-xs leading-snug text-slate-500" dir="auto">
                                    {previewOneLine}
                                  </p>
                                </div>
                              </button>
                            </li>
                          );
                        })}
                    </ul>
                  );
                })()
              )}
            </div>
          </aside>

          <section
            className={`${isMobile && !showEmailDetail ? 'hidden' : 'flex-1'} flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white`}
          >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-4 md:px-5 md:py-5">
              {selectedEmailForView ? (
                <div className="w-full max-w-none">
                  <div className="border-b border-gray-200 pb-4 mb-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <h2 className="text-xl font-bold text-gray-900 mb-2" dir="auto">
                          {selectedEmailForView.subject || '(no subject)'}
                        </h2>
                        <div className="flex items-center gap-2 mb-3">
                          <div
                            className={`px-2 py-1 rounded text-xs font-semibold ${
                              isOfficeEmail(selectedEmailForView.from) || selectedEmailForView.direction === 'outgoing'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-pink-100 text-pink-700'
                            }`}
                          >
                            {isOfficeEmail(selectedEmailForView.from) || selectedEmailForView.direction === 'outgoing'
                              ? 'Team'
                              : 'Client'}
                          </div>
                          <span className="text-sm font-semibold text-gray-700" dir="auto">
                            {isOfficeEmail(selectedEmailForView.from) || selectedEmailForView.direction === 'outgoing'
                              ? ((selectedEmailForView as any).sender_display_name || currentUserFullName || 'Team')
                              : selectedContactForEmail?.contact.name || client.name || 'Client'}
                          </span>
                        </div>
                      </div>
                      <div className="text-sm text-gray-500">{formatTime(selectedEmailForView.date)}</div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="font-semibold text-gray-600">From:</span>
                        <span className="ml-2 text-gray-900" dir="ltr">
                          {selectedEmailForView.from || 'Unknown'}
                        </span>
                      </div>
                      {selectedEmailForView.to &&
                        (() => {
                          const recipients = selectedEmailForView.to
                            .split(/[,;]/)
                            .map((r: string) => r.trim())
                            .filter((r: string) => r);
                          return (
                            <div>
                              <span className="font-semibold text-gray-600">To:</span>
                              <span className="ml-2 text-gray-900" dir="ltr">
                                {recipients.map((recipient: string, idx: number) => (
                                  <span key={idx}>
                                    {recipient}
                                    {idx < recipients.length - 1 && ', '}
                                  </span>
                                ))}
                              </span>
                            </div>
                          );
                        })()}
                    </div>
                  </div>

                  <div className="mb-6">
                    {(() => {
                      let emailContent =
                        selectedEmailForView.body_html ||
                        selectedEmailForView.bodyPreview ||
                        selectedEmailForView.body_preview;

                      if (emailContent) {
                        const attachments = parseEmailAttachmentsFromDb(selectedEmailForView.attachments);
                        emailContent = processEmailHtmlWithInlineImages(emailContent, attachments);
                        emailContent = formatEmailHtmlForDisplay(emailContent);
                        emailContent = sanitizeEmailHtml(emailContent);

                        return (
                          <EmailContentWithErrorHandling html={emailContent} emailId={selectedEmailForView.id} />
                        );
                      }
                      return (
                        <div className="text-gray-500 italic py-8 text-center">
                          Loading email content...
                          <div className="mt-2">
                            <button
                              onClick={() => {
                                if (selectedEmailForView) {
                                  hydrateEmailBodies([selectedEmailForView]);
                                  void ensureAttachmentsIfNeeded(selectedEmailForView);
                                }
                              }}
                              className="btn btn-sm btn-outline"
                            >
                              Fetch Full Content
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {(() => {
                    const fileAtt = fileAttachmentsForUi(
                      parseEmailAttachmentsFromDb(selectedEmailForView.attachments)
                    );
                    if (fileAtt.length === 0) return null;
                    return (
                      <div className="border-t border-gray-200 pt-6">
                        <h3 className="text-sm font-semibold text-gray-700 mb-3">Attachments ({fileAtt.length})</h3>
                        <div className="space-y-2">
                          {fileAtt.map((attachment: any, idx: number) => {
                            if (!attachment || (!attachment.id && !attachment.name)) return null;

                            const attachmentKey = attachment.id || attachment.name || `${selectedEmailForView.id}-${idx}`;
                            const attachmentName = attachment.name || `Attachment ${idx + 1}`;
                            const isDownloading = attachment.id && downloadingAttachments[attachment.id];

                            return (
                              <button
                                key={attachmentKey}
                                type="button"
                                className="flex items-center gap-3 w-full p-3 rounded-lg border border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-colors text-left"
                                onClick={() => handleDownloadAttachment(selectedEmailForView.id, attachment)}
                                disabled={Boolean(isDownloading)}
                              >
                                {isDownloading ? (
                                  <span className="loading loading-spinner loading-sm text-blue-500" />
                                ) : (
                                  <DocumentTextIcon className="w-5 h-5 text-blue-600 flex-shrink-0" />
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-gray-900 truncate">{attachmentName}</div>
                                  {(attachment.sizeInBytes || attachment.size) && (
                                    <div className="text-xs text-gray-500">
                                      {((attachment.sizeInBytes || attachment.size) / 1024).toFixed(1)} KB
                                    </div>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="flex min-h-[min(20rem,calc(100vh-14rem))] flex-col items-center justify-center px-4 py-16 text-slate-500">
                  <div className="text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
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
            <div className="shrink-0 border-t border-slate-200/90 bg-white">{children}</div>
          </section>
        </div>
      </div>
    </div>
  );
}
