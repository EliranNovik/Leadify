import React, { useState } from 'react';
import {
  PhoneIcon,
  EnvelopeIcon,
  ClockIcon,
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
} from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import type { LeadRecentInteractions, RecentInteractionItem } from '../../lib/leadActionCounts';

type Props = {
  recent: LeadRecentInteractions | null;
  loading: boolean;
  onOpenTimeline?: () => void;
};

const HEBREW_RE = /[\u0590-\u05FF]/;

function containsHebrew(text: string): boolean {
  return HEBREW_RE.test(text);
}

function formatWhen(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function initialsFromName(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

function ProfileAvatar({
  name,
  photoUrl,
  size = 'md',
}: {
  name?: string;
  photoUrl?: string | null;
  size?: 'md' | 'sm';
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const dim = size === 'sm' ? 'h-7 w-7 text-[10px]' : 'h-9 w-9 text-xs';
  const label = name?.trim() || 'User';
  const showImage = Boolean(photoUrl) && !imgFailed;

  return (
    <span
      className={`${dim} shrink-0 rounded-full ring-2 ring-white shadow-sm overflow-hidden inline-flex items-center justify-center bg-gray-200 text-gray-600 font-bold`}
      title={label}
    >
      {showImage ? (
        <img
          src={photoUrl!}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setImgFailed(true)}
        />
      ) : (
        initialsFromName(label)
      )}
    </span>
  );
}

function DirectionIconBadge({ direction }: { direction: RecentInteractionItem['direction'] }) {
  if (direction === 'in') {
    return (
      <span
        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 shadow-sm"
        title="Incoming"
        aria-label="Incoming"
      >
        <ArrowDownLeftIcon className="w-4 h-4" strokeWidth={2.5} />
      </span>
    );
  }
  if (direction === 'out') {
    return (
      <span
        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-sky-100 text-sky-700 shadow-sm"
        title="Outgoing"
        aria-label="Outgoing"
      >
        <ArrowUpRightIcon className="w-4 h-4" strokeWidth={2.5} />
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-500"
      title="Unknown direction"
      aria-label="Unknown direction"
    >
      <PhoneIcon className="w-3.5 h-3.5" />
    </span>
  );
}

function RtlText({
  children,
  className = '',
}: {
  children: string;
  className?: string;
}) {
  const rtl = containsHebrew(children);
  return (
    <p
      className={`${className} ${rtl ? 'text-right' : 'text-left'}`}
      dir={rtl ? 'rtl' : 'ltr'}
    >
      {children}
    </p>
  );
}

function InteractionCard({ item }: { item: RecentInteractionItem }) {
  const showEmployee = item.kind === 'call' && Boolean(item.employeeName);
  const showSender =
    !showEmployee &&
    Boolean(item.meta) &&
    (item.kind === 'whatsapp' || item.kind === 'email');

  return (
    <li className="group rounded-xl border border-white/80 bg-white/90 p-3 shadow-sm transition-all duration-200 hover:border-gray-200 hover:shadow-md">
      <div className="flex items-center justify-between gap-2 mb-2">
        <DirectionIconBadge direction={item.direction} />
        <time className="text-[10px] font-medium text-gray-400 tabular-nums shrink-0">
          {formatWhen(item.at)}
        </time>
      </div>

      {showEmployee ? (
        <div className="flex items-center gap-2 mb-1.5 min-w-0">
          <ProfileAvatar name={item.employeeName} photoUrl={item.employeePhotoUrl} />
          <RtlText className="text-sm font-bold text-gray-900 truncate flex-1 min-w-0">
            {item.employeeName!}
          </RtlText>
        </div>
      ) : null}

      {showSender ? (
        <div className="flex items-center gap-2 mb-1.5 min-w-0">
          <ProfileAvatar name={item.meta} photoUrl={null} size="sm" />
          <RtlText className="text-xs font-semibold text-gray-700 truncate flex-1 min-w-0">
            {item.meta!}
          </RtlText>
        </div>
      ) : null}

      <RtlText className="text-sm font-medium text-gray-900 leading-snug line-clamp-2">
        {item.preview}
      </RtlText>

      {item.meta && !showEmployee && !showSender ? (
        <RtlText className="mt-1 text-[11px] text-gray-500 truncate">{item.meta}</RtlText>
      ) : null}
    </li>
  );
}

function ChannelColumn({
  title,
  accentClass,
  headerBg,
  icon,
  items,
  loading,
  emptyLabel,
}: {
  title: string;
  accentClass: string;
  headerBg: string;
  icon: React.ReactNode;
  items: RecentInteractionItem[];
  loading: boolean;
  emptyLabel: string;
}) {
  return (
    <div
      className={`flex flex-col min-h-[140px] rounded-2xl border border-gray-100 overflow-hidden bg-gradient-to-b ${headerBg} to-white shadow-inner`}
    >
      <div className={`flex items-center gap-2 px-4 py-3 border-b border-gray-100/80 ${accentClass}`}>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 shadow-sm text-current">
          {icon}
        </span>
        <span className="text-sm font-bold tracking-tight">{title}</span>
        {!loading && items.length > 0 ? (
          <span className="ml-auto text-xs font-semibold opacity-70">{items.length}</span>
        ) : null}
      </div>
      <ul className="flex flex-col gap-2 p-3 flex-1">
        {loading ? (
          <>
            {[0, 1, 2].map((i) => (
              <li key={i} className="rounded-xl bg-gray-100/80 h-16 animate-pulse" />
            ))}
          </>
        ) : items.length === 0 ? (
          <li className="flex flex-1 items-center justify-center py-6 text-center text-xs text-gray-400">
            {emptyLabel}
          </li>
        ) : (
          items.map((item) => <InteractionCard key={`${item.kind}-${item.id}`} item={item} />)
        )}
      </ul>
    </div>
  );
}

const CalendarLeadRecentInteractions: React.FC<Props> = ({ recent, loading, onOpenTimeline }) => {
  const calls = recent?.calls ?? [];
  const emails = recent?.emails ?? [];
  const whatsapp = recent?.whatsapp ?? [];
  const hasAny = calls.length > 0 || emails.length > 0 || whatsapp.length > 0;

  return (
    <div className="mt-8 pt-6 border-t border-gray-100">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-md">
            <ClockIcon className="w-5 h-5" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-gray-900">Recent activity</h3>
            <p className="text-xs text-gray-500">Latest calls, emails & WhatsApp</p>
          </div>
        </div>
        {onOpenTimeline && !loading && hasAny ? (
          <button
            type="button"
            onClick={onOpenTimeline}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline shrink-0"
          >
            View full timeline →
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <ChannelColumn
          title="Calls"
          accentClass="text-gray-900"
          headerBg="from-gray-50"
          icon={<PhoneIcon className="w-4 h-4" />}
          items={calls}
          loading={loading}
          emptyLabel="No recent calls"
        />
        <ChannelColumn
          title="Email"
          accentClass="text-blue-700"
          headerBg="from-blue-50"
          icon={<EnvelopeIcon className="w-4 h-4" />}
          items={emails}
          loading={loading}
          emptyLabel="No recent emails"
        />
        <ChannelColumn
          title="WhatsApp"
          accentClass="text-[#128C7E]"
          headerBg="from-emerald-50"
          icon={<FaWhatsapp className="w-4 h-4" />}
          items={whatsapp}
          loading={loading}
          emptyLabel="No recent messages"
        />
      </div>
    </div>
  );
};

export default CalendarLeadRecentInteractions;
