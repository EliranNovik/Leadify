import React, { useEffect, useMemo, useState } from 'react';
import { DocumentTextIcon, EnvelopeIcon, InboxIcon, MagnifyingGlassIcon, PaperAirplaneIcon, XMarkIcon } from '@heroicons/react/24/outline';
import {
  applyEmailSidepanelListMode,
  dedupeEmailsForSidepanel,
  emailsInSubjectThread,
  groupEmailsIntoSubjectConversations,
  normalizeEmailSubjectKey,
  type EmailSidepanelListMode,
} from '../lib/interactions/emailFilters';
import { ensureFormattedEmailHtml } from './client-tabs/interactionsEmailViewUtils';
import { EmailMessageActionsDropdown } from './client-tabs/EmailMessageActionsDropdown';
import { EmailMessageComments } from './client-tabs/EmailMessageComments';
import { EmailSidepanelListMenu } from './client-tabs/EmailSidepanelListMenu';
import type { EmailComment } from '../lib/interactions/emailComments';
import { fetchEmailCommentsByEmailIds } from '../lib/interactions/emailComments';

export type ThreadEmailMessage = {
  id: string;
  subject: string;
  body_preview?: string;
  body_html?: string;
  sender_email: string;
  sender_name?: string;
  recipient_list?: string;
  sent_at: string;
  direction: 'incoming' | 'outgoing';
  attachments?: any[];
};

type Filter = 'all' | 'incoming' | 'outgoing';

function previewText(message: ThreadEmailMessage): string {
  const raw = message.body_html || message.body_preview || '';
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function initialsFromName(name: string): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
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
  messages: ThreadEmailMessage[],
  opts: {
    contactName: string;
    getIsOutgoing: (message: ThreadEmailMessage) => boolean;
  },
): Array<{ key: string; name: string; email: string; outgoing: boolean }> {
  const byKey = new Map<string, { key: string; name: string; email: string; outgoing: boolean }>();
  for (const message of messages) {
    const email = String(message.sender_email || '')
      .trim()
      .toLowerCase();
    if (!email) continue;
    const outgoing = opts.getIsOutgoing(message);
    const name = outgoing
      ? String(message.sender_name || message.sender_email || 'Team').trim()
      : String(opts.contactName || message.sender_name || email).trim();
    if (!byKey.has(email)) {
      byKey.set(email, { key: email, name: name || email, email, outgoing });
    }
  }
  return Array.from(byKey.values());
}

type Props = {
  emails: ThreadEmailMessage[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: Filter;
  onFilterChange: (f: Filter) => void;
  isLoading: boolean;
  isMobile: boolean;
  showReadingPane: boolean;
  onBackToList: () => void;
  contactName: string;
  formatTime: (iso: string) => string;
  downloadingAttachments: Record<string, boolean>;
  onDownloadAttachment: (messageId: string, attachment: any) => void;
  getIsOutgoing: (message: ThreadEmailMessage) => boolean;
  onReplyMessage?: (message: ThreadEmailMessage) => void;
  onForwardMessage?: (message: ThreadEmailMessage) => void;
  onDeleteMessage?: (message: ThreadEmailMessage) => void;
};

export default function EmailGmailSplitPane({
  emails,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
  isLoading,
  isMobile,
  showReadingPane,
  onBackToList,
  contactName,
  formatTime,
  downloadingAttachments,
  onDownloadAttachment,
  getIsOutgoing,
  onReplyMessage,
  onForwardMessage,
  onDeleteMessage,
}: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [listMode, setListMode] = useState<EmailSidepanelListMode>('newest');
  const [conversationDirectionFilter, setConversationDirectionFilter] = useState<
    'all' | 'incoming' | 'outgoing'
  >('all');
  const [commentsByEmailId, setCommentsByEmailId] = useState<Record<string, EmailComment[]>>({});
  const [commentComposerEmailId, setCommentComposerEmailId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = dedupeEmailsForSidepanel(emails).filter((m) => {
      if (filter === 'all') {
        // keep
      } else {
        const outgoing = getIsOutgoing(m);
        if (filter === 'outgoing' ? !outgoing : outgoing) return false;
      }
      if (!q) return true;
      const haystack = [
        m.subject,
        m.sender_name,
        m.sender_email,
        m.recipient_list,
        previewText(m),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
    return [...list].sort(
      (a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime(),
    );
  }, [emails, filter, getIsOutgoing, searchQuery]);

  const selected = filtered.find((m) => String(m.id) === String(selectedId)) || filtered[0] || null;

  const conversationEmails = useMemo(() => {
    if (!selected) return [];
    return emailsInSubjectThread(dedupeEmailsForSidepanel(emails), selected, {
      getSubject: (e) => e.subject,
      getDate: (e) => e.sent_at,
    });
  }, [emails, selected]);

  const visibleConversationEmails = useMemo(() => {
    if (conversationDirectionFilter === 'all') return conversationEmails;
    return conversationEmails.filter((m) => {
      const outgoing = getIsOutgoing(m);
      return conversationDirectionFilter === 'outgoing' ? outgoing : !outgoing;
    });
  }, [conversationEmails, conversationDirectionFilter, getIsOutgoing]);

  useEffect(() => {
    setConversationDirectionFilter('all');
    setCommentComposerEmailId(null);
  }, [selected?.id, selected?.subject]);

  useEffect(() => {
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

  const handleCommentsChange = (emailId: string, next: EmailComment[]) => {
    setCommentsByEmailId((prev) => ({ ...prev, [emailId]: next }));
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <div className="loading loading-spinner loading-lg text-blue-500" />
        <p className="text-sm text-gray-600">Loading emails for {contactName}…</p>
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-gray-500">
        <div className="text-center px-4">
          <p className="text-lg font-medium">No emails available</p>
          <p className="text-sm mt-1">No emails found for {contactName}.</p>
        </div>
      </div>
    );
  }

  const listPane = (
    <aside
      className={`${
        isMobile ? (showReadingPane ? 'hidden' : 'w-full') : 'w-[22rem] xl:w-96'
      } flex h-full min-h-0 shrink-0 flex-col border-r border-slate-200 bg-white`}
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
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 flex items-center pr-2.5"
                aria-label="Clear search"
              >
                <XMarkIcon className="h-4 w-4 text-gray-400 hover:text-gray-600" />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {(() => {
          const conversationGroups = applyEmailSidepanelListMode(
            groupEmailsIntoSubjectConversations(filtered, {
              getSubject: (e) => e.subject,
              getDate: (e) => e.sent_at,
            }),
            listMode,
            {
              isOutgoing: getIsOutgoing,
              getDate: (e) => e.sent_at,
            },
          );
          if (conversationGroups.length === 0) {
            return (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-slate-500">
                <MagnifyingGlassIcon className="h-8 w-8 text-slate-300" />
                <p className="text-sm">
                  {listMode === 'unreplied' ? 'No unreplied inbox emails' : 'No emails in this folder'}
                </p>
              </div>
            );
          }
          return (
          <ul className="divide-y divide-slate-200/80">
            {conversationGroups.map((group) => {
              const message = group.latest;
              const outgoing = getIsOutgoing(message);
              const isSelected = Boolean(
                selected &&
                  (group.messages.some((m) => String(m.id) === String(selected.id)) ||
                    (normalizeEmailSubjectKey(selected.subject) || `__id:${selected.id}`) ===
                      group.key),
              );
              const preview = previewText(message) || '—';
              const displayName = outgoing
                ? message.recipient_list?.split(/[,;]/)[0]?.trim() || 'Recipient'
                : message.sender_name || message.sender_email || 'Sender';
              const initials = initialsFromName(displayName);
              return (
                <li key={group.key}>
                  <button
                    type="button"
                    onClick={() => onSelect(String(message.id))}
                    className={`relative flex w-full gap-2 px-3 pb-8 pt-2.5 text-left transition ${
                      isSelected
                        ? 'border-l-[3px] border-l-[#4218CC] bg-[#4218CC]/12 shadow-[inset_0_0_0_1px_rgba(66,24,204,0.12)]'
                        : 'border-l-[3px] border-l-transparent hover:bg-slate-50'
                    }`}
                  >
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-bold uppercase tracking-wide text-white ${
                        outgoing ? 'bg-[#4218CC]' : 'bg-emerald-600'
                      }`}
                      aria-hidden
                    >
                      {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                          {displayName}
                        </span>
                        <time className="shrink-0 text-[11px] tabular-nums text-slate-400">
                          {formatTime(message.sent_at)}
                        </time>
                        <span
                          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${
                            group.count > 1 ? 'bg-slate-100 text-slate-600' : 'invisible'
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
                      <p className="mt-0.5 max-w-[11rem] truncate text-sm font-bold text-slate-800 sm:max-w-[13rem] md:max-w-[14rem]">
                        {displayConversationSubject(message.subject)}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">{preview}</p>
                    </div>
                    <span
                      className={`pointer-events-none absolute bottom-1.5 left-2.5 inline-flex items-center justify-center ${
                        outgoing ? 'text-blue-600' : 'text-emerald-600'
                      }`}
                      title={outgoing ? 'Sent' : 'Inbox'}
                      aria-label={outgoing ? 'Sent' : 'Inbox'}
                    >
                      {outgoing ? (
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
        })()}
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
              onClick={() => onFilterChange(key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                filter === key
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
  );

  const readingPane = (
    <section
      className={`${
        isMobile ? (showReadingPane ? 'flex w-full' : 'hidden') : 'flex flex-1'
      } min-h-0 min-w-0 flex-col overflow-hidden bg-white`}
    >
      {isMobile && showReadingPane && (
        <div className="flex items-center gap-2 border-b border-white/40 bg-white/55 px-3 py-2 shadow-sm backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/40">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBackToList}>
            ← Back
          </button>
        </div>
      )}
      {!selected ? (
        <div className="flex flex-1 items-center justify-center bg-slate-100 text-sm text-slate-400">
          Select an email to read
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-100">
          <header className="z-10 shrink-0 border-b border-white/40 bg-white/55 px-4 py-3 shadow-sm backdrop-blur-xl backdrop-saturate-150 md:px-6 md:py-3.5 supports-[backdrop-filter]:bg-white/40">
            <div className="mx-auto flex w-full max-w-4xl items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2
                  className="truncate text-base font-bold text-slate-900 md:text-lg"
                  dir="auto"
                  title={displayConversationSubject(selected.subject)}
                >
                  {displayConversationSubject(selected.subject)}
                </h2>
                <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-slate-500">
                  <span className="shrink-0 font-semibold text-slate-600">Participants:</span>
                  <span className="min-w-0 truncate font-medium text-slate-700" dir="auto">
                    {collectConversationParticipants(conversationEmails, {
                      contactName,
                      getIsOutgoing,
                    })
                      .map((participant) => participant.name)
                      .join(', ') || '—'}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {(() => {
                  const sentCount = conversationEmails.filter((m) => getIsOutgoing(m)).length;
                  const inboxCount = conversationEmails.length - sentCount;
                  const inboxActive = conversationDirectionFilter === 'incoming';
                  const sentActive = conversationDirectionFilter === 'outgoing';
                  return (
                    <>
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
                    </>
                  );
                })()}
              </div>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
              {visibleConversationEmails.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 px-4 py-10 text-center text-sm text-slate-500">
                  No {conversationDirectionFilter === 'outgoing' ? 'sent' : 'inbox'} messages in this
                  conversation.
                </div>
              ) : null}
              {visibleConversationEmails.map((message, index) => {
                const outgoing = getIsOutgoing(message);
                const personName = outgoing
                  ? message.sender_name || message.sender_email || 'Team'
                  : contactName || message.sender_name || message.sender_email || 'Client';
                const initials = initialsFromName(personName);
                const bodyHtml = ensureFormattedEmailHtml(
                  message.body_html || message.body_preview || '',
                );

                return (
                  <article
                    key={message.id || index}
                    className="rounded-xl border border-slate-200/80 bg-white px-3 py-4 shadow-sm md:px-5 md:py-5"
                  >
                    <div className="mb-3 flex items-start gap-2.5">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-bold uppercase tracking-wide text-white shadow-sm ring-1 ring-white/90 ${
                          outgoing ? 'bg-[#4218CC]' : 'bg-emerald-600'
                        }`}
                        aria-hidden
                      >
                        {initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900" dir="auto">
                            {personName}
                          </span>
                          <div className="ml-auto flex shrink-0 items-center gap-1.5">
                            <span
                              className={`inline-flex shrink-0 items-center justify-center ${
                                outgoing ? 'text-blue-600' : 'text-emerald-600'
                              }`}
                              title={outgoing ? 'Sent' : 'Inbox'}
                              aria-label={outgoing ? 'Sent' : 'Inbox'}
                            >
                              {outgoing ? (
                                <PaperAirplaneIcon className="h-5 w-5" />
                              ) : (
                                <InboxIcon className="h-5 w-5" />
                              )}
                            </span>
                            <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold tabular-nums text-slate-600">
                              {formatTime(message.sent_at)}
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
                          {message.sender_email && (
                            <span
                              className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600 sm:max-w-[18rem]"
                              dir="ltr"
                              title={message.sender_email}
                            >
                              <span className="shrink-0 font-semibold text-slate-500">From</span>
                              <a
                                href={`mailto:${message.sender_email}`}
                                className="truncate text-blue-600 underline underline-offset-2 hover:text-blue-800"
                              >
                                {message.sender_email}
                              </a>
                            </span>
                          )}
                          {message.recipient_list && (
                            <span
                              className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600 sm:max-w-[18rem]"
                              dir="ltr"
                              title={message.recipient_list}
                            >
                              <span className="shrink-0 font-semibold text-slate-500">To</span>
                              <span className="truncate">
                                {message.recipient_list
                                  .split(/[,;]/)
                                  .map((r) => r.trim())
                                  .filter(Boolean)
                                  .map((recipient, idx, arr) => (
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

                    {bodyHtml ? (
                      <div
                        dangerouslySetInnerHTML={{ __html: bodyHtml }}
                        className="email-content mt-4 max-w-none break-words text-slate-700 [&_a]:text-blue-600 [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-blue-800 [&_.timeline-prewrap]:whitespace-normal"
                        style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}
                        dir="auto"
                      />
                    ) : (
                      <div className="mt-4 italic text-slate-400">No content available</div>
                    )}

                    {Array.isArray(message.attachments) && message.attachments.length > 0 && (
                      <div className="mt-4 border-t border-slate-100 pt-3">
                        <p className="mb-2 text-xs font-semibold text-slate-600">
                          Attachments ({message.attachments.length})
                        </p>
                        <div className="space-y-1">
                          {message.attachments.map((attachment: any, idx: number) => {
                            if (!attachment || (!attachment.id && !attachment.name)) return null;
                            const key = attachment.id || attachment.name || `${message.id}-${idx}`;
                            const name = attachment.name || `Attachment ${idx + 1}`;
                            const downloading = attachment.id && downloadingAttachments[attachment.id];
                            return (
                              <button
                                key={key}
                                type="button"
                                className="flex w-full items-center gap-2 text-left text-xs font-medium text-blue-600 hover:text-blue-800"
                                onClick={() => onDownloadAttachment(message.id, attachment)}
                                disabled={Boolean(downloading)}
                              >
                                {downloading ? (
                                  <span className="loading loading-spinner loading-xs" />
                                ) : (
                                  <DocumentTextIcon className="h-4 w-4 shrink-0" />
                                )}
                                <span className="truncate">{name}</span>
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
                    />
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {listPane}
      {readingPane}
    </div>
  );
}
