import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BellIcon,
  DocumentTextIcon,
  DocumentDuplicateIcon,
  UserPlusIcon,
  CalendarDaysIcon,
  ArrowUpTrayIcon,
  FlagIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import {
  portalGetNotifications,
  type PortalNotificationRow,
  type PortalNotificationType,
} from '../../../lib/portalApi';

type Props = {
  onNavigate: (tab: string) => void;
  storageKey?: string | null;
  dropUp?: boolean;
  align?: 'left' | 'right';
  onDark?: boolean;
};

type IconMeta = { icon: React.ComponentType<{ className?: string }>; chip: string };

const TYPE_META: Record<string, IconMeta> = {
  poa_new: { icon: DocumentTextIcon, chip: 'bg-blue-50 text-blue-700' },
  poa_signed: { icon: CheckCircleIcon, chip: 'bg-blue-50 text-blue-700' },
  contract_new: { icon: DocumentDuplicateIcon, chip: 'bg-sky-50 text-sky-600' },
  contract_signed: { icon: CheckCircleIcon, chip: 'bg-blue-50 text-blue-700' },
  contact_new: { icon: UserPlusIcon, chip: 'bg-emerald-50 text-emerald-600' },
  meeting_new: { icon: CalendarDaysIcon, chip: 'bg-amber-50 text-amber-600' },
  document_new: { icon: ArrowUpTrayIcon, chip: 'bg-teal-50 text-teal-600' },
  status_new: { icon: FlagIcon, chip: 'bg-rose-50 text-rose-600' },
  status_updated: { icon: FlagIcon, chip: 'bg-rose-50 text-rose-500' },
};

function metaFor(type: PortalNotificationType): IconMeta {
  return TYPE_META[type] || { icon: BellIcon, chip: 'bg-gray-100 text-gray-500' };
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

const PortalNotifications: React.FC<Props> = ({
  onNavigate,
  storageKey,
  dropUp = false,
  align = 'right',
  onDark = false,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PortalNotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSeen, setLastSeen] = useState<number>(0);

  const [dismissedUntil, setDismissedUntil] = useState<number>(0);

  const seenKey = useMemo(
    () => `portal_notifications_seen::${storageKey || 'case'}`,
    [storageKey],
  );
  const dismissedKey = useMemo(
    () => `portal_notifications_dismissed::${storageKey || 'case'}`,
    [storageKey],
  );

  useEffect(() => {
    let stored = 0;
    try {
      const raw = localStorage.getItem(seenKey);
      if (raw) stored = Number(raw) || 0;
    } catch {
      /* localStorage unavailable */
    }
    // First visit: treat the last 14 days as "new" so the bell is useful,
    // without flagging the client's entire history.
    setLastSeen(stored || Date.now() - 14 * 24 * 60 * 60 * 1000);
  }, [seenKey]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(dismissedKey);
      setDismissedUntil(raw ? Number(raw) || 0 : 0);
    } catch {
      setDismissedUntil(0);
    }
  }, [dismissedKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await portalGetNotifications(50);
        if (!cancelled) setItems(rows);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleItems = useMemo(
    () => items.filter((n) => new Date(n.ts).getTime() > dismissedUntil),
    [items, dismissedUntil],
  );

  const unreadCount = useMemo(
    () => visibleItems.filter((n) => new Date(n.ts).getTime() > lastSeen).length,
    [visibleItems, lastSeen],
  );

  const dismissAll = useCallback(() => {
    const now = Date.now();
    setDismissedUntil(now);
    try {
      localStorage.setItem(dismissedKey, String(now));
    } catch {
      /* ignore */
    }
  }, [dismissedKey]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const markAllSeen = useCallback(() => {
    const now = Date.now();
    setLastSeen(now);
    try {
      localStorage.setItem(seenKey, String(now));
    } catch {
      /* ignore */
    }
  }, [seenKey]);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next) markAllSeen();
      return next;
    });
  }, [markAllSeen]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        className={`relative inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
          onDark
            ? 'text-primary-content hover:bg-white/15'
            : 'text-primary hover:bg-primary/10'
        }`}
        aria-label="Notifications"
        aria-expanded={open}
      >
        <BellIcon className="h-6 w-6" />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white shadow-sm">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className={`absolute z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl ${
            align === 'left' ? 'left-0' : 'right-0'
          } ${dropUp ? 'bottom-[calc(100%+0.625rem)]' : 'top-[calc(100%+0.625rem)]'}`}
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <p className="text-sm font-semibold text-gray-900">Notifications</p>
            {visibleItems.length > 0 ? (
              <button
                type="button"
                onClick={dismissAll}
                className="text-xs font-semibold text-primary transition-colors hover:text-primary/80"
              >
                Dismiss all
              </button>
            ) : null}
          </div>

          <div className="max-h-[min(26rem,70vh)] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <span className="loading loading-spinner loading-md text-primary" />
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-gray-400">
                You&apos;re all caught up.
              </div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {visibleItems.map((n) => {
                  const { icon: Icon, chip } = metaFor(n.type);
                  const isUnread = new Date(n.ts).getTime() > lastSeen;
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onNavigate(n.tab);
                          setOpen(false);
                        }}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
                          isUnread ? 'bg-primary/[0.04]' : ''
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${chip}`}
                        >
                          <Icon className="h-5 w-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">
                              {n.title}
                            </span>
                            {isUnread ? (
                              <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                            ) : null}
                          </span>
                          {n.subtitle ? (
                            <span className="mt-0.5 block truncate text-xs text-gray-500">
                              {n.subtitle}
                            </span>
                          ) : null}
                          <span className="mt-0.5 block text-[11px] font-medium text-gray-400">
                            {relativeTime(n.ts)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default PortalNotifications;
