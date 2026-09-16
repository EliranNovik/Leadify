import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  CheckIcon,
  EnvelopeIcon,
  InboxIcon,
  MagnifyingGlassIcon,
  UserGroupIcon,
  UserIcon,
  WrenchScrewdriverIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  conversationInQueue,
  conversationMatchesChannel,
  conversationMatchesScope,
  conversationMatchesSearch,
  fetchConversationThread,
  fetchInboxConversations,
  inboxLoadErrorMessage,
  invalidateInboxCache,
  formatInboxWait,
  inboxCountsFromConversations,
  markConversationRead,
  type InboxChannel,
  type InboxContactScope,
  type InboxConversation,
  type InboxQueueTab,
  type InboxThreadItem,
} from '../lib/communicationsInbox';

const CONTACT_SCOPES: Array<{ id: InboxContactScope; label: string }> = [
  { id: 'all', label: 'All contacts' },
  { id: 'mine', label: 'My contacts' },
];

const QUEUE_TABS: Array<{ id: InboxQueueTab; label: string }> = [
  { id: 'all', label: 'Recent' },
  { id: 'inbox', label: 'Needs attention' },
  { id: 'needs_reply', label: 'Needs reply' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'unread', label: 'Unread' },
];

const CHANNELS: Array<{ id: InboxChannel | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'email', label: 'Email' },
];

function hasHebrew(text: string | null | undefined): boolean {
  return /[\u0590-\u05FF]/.test(String(text || ''));
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const CommunicationsInboxPage: React.FC = () => {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contactScope, setContactScope] = useState<InboxContactScope>('all');
  const [tab, setTab] = useState<InboxQueueTab>('all');
  const [channel, setChannel] = useState<InboxChannel | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [thread, setThread] = useState<InboxThreadItem[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const [showReworkModal, setShowReworkModal] = useState(false);

  useEffect(() => {
    if (!showReworkModal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowReworkModal(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showReworkModal]);

  const loadInbox = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchInboxConversations();
      setConversations(rows);
      setSelectedKey((prev) => {
        if (prev && rows.some((row) => row.key === prev)) return prev;
        return rows[0]?.key ?? null;
      });
    } catch (err: any) {
      setError(inboxLoadErrorMessage(err));
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  const scopedConversations = useMemo(
    () => conversations.filter((row) => conversationMatchesScope(row, contactScope)),
    [conversations, contactScope],
  );

  const counts = useMemo(
    () => inboxCountsFromConversations(scopedConversations),
    [scopedConversations],
  );

  const mineCount = useMemo(
    () => conversations.filter((row) => row.isMine).length,
    [conversations],
  );

  const visible = useMemo(() => {
    return scopedConversations.filter(
      (row) =>
        conversationInQueue(row, tab) &&
        conversationMatchesChannel(row, channel) &&
        conversationMatchesSearch(row, search),
    );
  }, [scopedConversations, tab, channel, search]);

  useEffect(() => {
    if (selectedKey && visible.some((row) => row.key === selectedKey)) return;
    setSelectedKey(visible[0]?.key ?? null);
  }, [visible, selectedKey]);

  const selected = useMemo(
    () => visible.find((row) => row.key === selectedKey) || visible[0] || null,
    [visible, selectedKey],
  );

  useEffect(() => {
    if (!selected) {
      setThread([]);
      return;
    }
    let cancelled = false;
    setThreadLoading(true);
    void fetchConversationThread(selected)
      .then((items) => {
        if (!cancelled) setThread(items);
      })
      .catch(() => {
        if (!cancelled) setThread([]);
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.key]);

  const handleMarkRead = async () => {
    if (!selected) return;
    setMarkingRead(true);
    try {
      await markConversationRead(selected);
      setConversations((prev) =>
        prev.map((row) =>
          row.key === selected.key ? { ...row, unreadCount: 0 } : row,
        ),
      );
      setThread((prev) => prev.map((item) => ({ ...item, isRead: true })));
    } catch (err: any) {
      setError(err?.message || 'Failed to mark as read');
    } finally {
      setMarkingRead(false);
    }
  };

  const openLead = () => {
    if (!selected?.leadIdentifier) return;
    navigate(`/clients/${encodeURIComponent(selected.leadIdentifier)}?tab=interactions`);
  };

  const openWhatsApp = () => {
    if (!selected) return;
    const params = new URLSearchParams({ tab: contactScope === 'mine' ? 'my' : 'all' });
    if (selected.newLeadId) params.set('leadId', selected.newLeadId);
    if (selected.legacyLeadId != null) params.set('legacyId', String(selected.legacyLeadId));
    navigate(`/whatsapp?${params.toString()}`);
  };

  const openEmail = () => {
    if (!selected?.leadIdentifier) return;
    navigate(`/clients/${encodeURIComponent(selected.leadIdentifier)}?tab=interactions`);
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4 md:p-6">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3 text-gray-900">
            <div className="flex flex-wrap items-center gap-2">
              <InboxIcon className="h-7 w-7" />
              <h1 className="text-2xl font-bold">Communication Inbox</h1>
              <button
                type="button"
                onClick={() => setShowReworkModal(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800 shadow-sm transition hover:border-amber-300 hover:bg-amber-100"
              >
                <WrenchScrewdriverIcon className="h-3.5 w-3.5" />
                Under construction
              </button>
            </div>
            <div className="flex rounded-xl bg-gray-200 p-1">
              {CONTACT_SCOPES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
                    contactScope === item.id
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  onClick={() => setContactScope(item.id)}
                >
                  {item.id === 'all' ? <UserGroupIcon className="h-6 w-6" /> : <UserIcon className="h-6 w-6" />}
                  {item.label}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      contactScope === item.id ? 'bg-gray-100 text-gray-700' : 'text-gray-500'
                    }`}
                  >
                    {item.id === 'all' ? conversations.length : mineCount}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {contactScope === 'mine'
              ? 'Leads where you have a saved role'
              : 'Recent WhatsApp and email across all contacts'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-4 rounded-2xl bg-white px-4 py-2 text-sm shadow-sm">
            <div>
              <div className="text-lg font-bold text-gray-900">{counts.needsReply}</div>
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Needs reply</div>
            </div>
            <div>
              <div className="text-lg font-bold text-gray-900">{counts.unread}</div>
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Unread</div>
            </div>
            <div>
              <div className="text-lg font-bold text-gray-900">{counts.waiting}</div>
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Waiting</div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              invalidateInboxCache();
              void loadInbox();
            }}
            disabled={loading}
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {QUEUE_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                tab === item.id ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="relative w-full max-w-md">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, lead #, phone, email, message"
            className="input input-bordered h-11 w-full rounded-full bg-white pl-10"
          />
        </label>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {CHANNELS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              channel === item.id ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
            onClick={() => setChannel(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="grid min-h-[70vh] grid-cols-1 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm lg:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)]">
        <div className="border-b border-gray-100 lg:border-b-0 lg:border-r">
          <div className="border-b border-gray-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Conversations
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-16">
                <span className="loading loading-spinner loading-md text-primary" />
              </div>
            ) : visible.length === 0 ? (
              <div className="px-6 py-16 text-center text-sm text-gray-500">
                No conversations in this view. Switch to All contacts, or open WhatsApp if you expect threads there.
              </div>
            ) : (
              visible.map((row) => {
                const active = selected?.key === row.key;
                return (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => setSelectedKey(row.key)}
                    className={`block w-full border-b border-gray-50 px-4 py-3 text-left transition ${
                      active ? 'bg-indigo-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-gray-900">{row.leadName}</div>
                        <div className="mt-0.5 truncate text-xs text-gray-500">
                          {row.lastChannel === 'email' ? 'Email' : 'WhatsApp'}
                          {row.leadNumber ? ` • #${row.leadNumber}` : ''}
                        </div>
                      </div>
                      <div className="shrink-0 text-xs text-gray-400">{formatWhen(row.lastAt)}</div>
                    </div>
                    <p
                      className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-gray-600"
                      dir={hasHebrew(row.lastSnippet) ? 'rtl' : 'ltr'}
                      style={{ textAlign: hasHebrew(row.lastSnippet) ? 'right' : 'left' }}
                    >
                      {row.lastSnippet}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                      {row.unreadCount > 0 ? (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">
                          {row.unreadCount} new
                        </span>
                      ) : null}
                      {row.needsReply ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">Needs reply</span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">Waiting</span>
                      )}
                      {row.needsReply && formatInboxWait(row.waitingMs) ? (
                        <span className="text-gray-500">{formatInboxWait(row.waitingMs)}</span>
                      ) : null}
                      {contactScope === 'all' && row.isMine ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">Mine</span>
                      ) : null}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="flex min-h-[70vh] flex-col">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
              Select a conversation
            </div>
          ) : (
            <>
              <div className="border-b border-gray-100 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{selected.leadName}</h2>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
                      {selected.leadNumber ? <span>#{selected.leadNumber}</span> : null}
                      {selected.category ? <span className="rounded-full bg-gray-100 px-2 py-0.5">{selected.category}</span> : null}
                      {selected.stage ? <span className="rounded-full bg-gray-100 px-2 py-0.5">{selected.stage}</span> : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void handleMarkRead()}
                      disabled={markingRead || selected.unreadCount === 0}
                    >
                      <CheckIcon className="h-4 w-4" />
                      Mark read
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={openLead}>
                      Open lead
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={openWhatsApp}>
                      <ChatBubbleLeftRightIcon className="h-4 w-4" />
                      WhatsApp
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={openEmail}>
                      <EnvelopeIcon className="h-4 w-4" />
                      Email
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {threadLoading ? (
                  <div className="flex justify-center py-16">
                    <span className="loading loading-spinner loading-md text-primary" />
                  </div>
                ) : thread.length === 0 ? (
                  <div className="py-16 text-center text-sm text-gray-500">No messages in this conversation.</div>
                ) : (
                  <div className="space-y-3">
                    {thread.map((item) => {
                      const rtl = hasHebrew(item.content);
                      return (
                      <div
                        key={item.id}
                        className={`max-w-2xl rounded-2xl px-4 py-3 ${
                          item.direction === 'in' ? 'bg-gray-50 text-gray-800' : 'ml-auto bg-indigo-50 text-gray-800'
                        }`}
                      >
                        <div className="mb-1 flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                          <span>
                            {item.channel === 'email' ? 'Email' : 'WhatsApp'} • {item.sender}
                          </span>
                          <span>{formatWhen(item.sentAt)}</span>
                        </div>
                        <p
                          className="whitespace-pre-wrap break-words text-sm leading-relaxed"
                          dir={rtl ? 'rtl' : 'ltr'}
                          style={{ textAlign: rtl ? 'right' : 'left' }}
                        >
                          {item.content}
                        </p>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="border-t border-gray-100 px-5 py-3 text-xs text-gray-500">
                Reply in{' '}
                <Link className="font-semibold text-indigo-600 no-underline" to={`/whatsapp?tab=${contactScope === 'mine' ? 'my' : 'all'}${selected.newLeadId ? `&leadId=${encodeURIComponent(selected.newLeadId)}` : ''}${selected.legacyLeadId != null ? `&legacyId=${selected.legacyLeadId}` : ''}`}>
                  WhatsApp
                </Link>{' '}
                or the lead interactions tab.
              </div>
            </>
          )}
        </div>
      </div>

      {showReworkModal ? (
        <dialog className="modal modal-open" aria-labelledby="inbox-rework-title">
          <div className="modal-box max-w-lg overflow-hidden p-0">
            <button
              type="button"
              className="btn btn-circle btn-ghost btn-sm absolute right-3 top-3 z-10 bg-white/80"
              onClick={() => setShowReworkModal(false)}
              aria-label="Close"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
            <img
              src="/communications-inbox-under-construction.png"
              alt=""
              className="h-56 w-full object-cover object-center"
            />
            <div className="space-y-3 px-6 py-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Under construction</p>
              <h3 id="inbox-rework-title" className="text-xl font-bold text-gray-900">
                This inbox is being reworked
              </h3>
              <p className="text-sm leading-relaxed text-gray-600">
                Communication Inbox is getting a new layout and faster queues for WhatsApp and email.
                You can still use it, but some views may change while we rebuild it.
              </p>
              <div className="pt-1">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowReworkModal(false)}>
                  Got it
                </button>
              </div>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button type="button" onClick={() => setShowReworkModal(false)}>
              close
            </button>
          </form>
        </dialog>
      ) : null}
    </div>
  );
};

export default CommunicationsInboxPage;
