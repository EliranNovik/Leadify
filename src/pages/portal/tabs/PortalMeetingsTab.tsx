import React, { useMemo } from 'react';
import {
  CalendarDaysIcon,
  ChevronDownIcon,
  ClockIcon,
  MapPinIcon,
  PlusIcon,
  VideoCameraIcon,
} from '@heroicons/react/24/outline';
import type { PortalMeetingRequestRow, PortalMeetingRow } from '../../../lib/portalApi';
import {
  EntityAvatar,
  getPortalTabHeaderCoverImage,
  PortalCard,
  PortalSectionLabel,
  PortalTabFrame,
} from '../components/portalTheme';

function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return d;
  }
}

function formatTime(t: string | null | undefined): string {
  if (!t) return '';
  const raw = t.trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (match) return `${match[1].padStart(2, '0')}:${match[2]}`;
  return raw;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function meetingSortKey(m: PortalMeetingRow): number {
  const date = m.meeting_date ? new Date(m.meeting_date).getTime() : 0;
  const time = m.meeting_time ? formatTime(m.meeting_time) : '00:00';
  const [h, min] = time.split(':').map(Number);
  return date + (h || 0) * 3600000 + (min || 0) * 60000;
}

function ColoredBadge({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  return (
    <span className={`inline-flex rounded-full px-3.5 py-1 text-sm font-semibold ${className}`}>
      {children}
    </span>
  );
}

function RequestStatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  if (normalized === 'confirmed') {
    return <ColoredBadge className="bg-emerald-500/15 text-emerald-800">Confirmed</ColoredBadge>;
  }
  if (normalized === 'cancelled') {
    return <ColoredBadge className="bg-neutral-500/15 text-neutral-700">Cancelled</ColoredBadge>;
  }
  return <ColoredBadge className="bg-amber-500/15 text-amber-800">Pending</ColoredBadge>;
}

function MeetingStatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  if (normalized === 'completed') {
    return <ColoredBadge className="bg-emerald-500/15 text-emerald-800">Completed</ColoredBadge>;
  }
  if (normalized === 'canceled' || normalized === 'cancelled') {
    return <ColoredBadge className="bg-neutral-500/15 text-neutral-700">Cancelled</ColoredBadge>;
  }
  return <ColoredBadge className="bg-primary/15 text-primary">Scheduled</ColoredBadge>;
}

type MeetingManagerInfo = {
  name: string | null | undefined;
  photoUrl?: string | null;
};

function MeetingManagerRow({ manager }: { manager: MeetingManagerInfo }) {
  const displayName = manager.name?.trim() || '';
  const assigned = Boolean(displayName && displayName !== '—' && displayName !== 'Not assigned');

  return (
    <div className="mt-4 flex items-center gap-2.5 border-t border-gray-100 pt-3">
      <EntityAvatar
        name={assigned ? displayName : 'Meeting manager'}
        imageUrl={manager.photoUrl || undefined}
        stableKey={`portal-meeting-manager::${displayName || 'unassigned'}`}
        className="h-9 w-9 shrink-0 text-xs"
      />
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wide text-base-content/40">Meeting manager</p>
        <p className="truncate text-sm font-medium text-gray-800">
          {assigned ? displayName : 'Not assigned yet'}
        </p>
      </div>
    </div>
  );
}

type Props = {
  meetings: PortalMeetingRow[];
  requests: PortalMeetingRequestRow[];
  meetingManager: MeetingManagerInfo;
  onRequestMeeting: () => void;
};

const PortalMeetingsTab: React.FC<Props> = ({
  meetings,
  requests,
  meetingManager,
  onRequestMeeting,
}) => {
  const { upcoming, past } = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const upcomingList: PortalMeetingRow[] = [];
    const pastList: PortalMeetingRow[] = [];

    for (const m of meetings) {
      const d = m.meeting_date ? new Date(m.meeting_date) : null;
      if (d) d.setHours(0, 0, 0, 0);
      const isPast =
        m.status?.toLowerCase() === 'completed' ||
        m.status?.toLowerCase() === 'canceled' ||
        m.status?.toLowerCase() === 'cancelled' ||
        (d !== null && d.getTime() < now.getTime());

      if (isPast) pastList.push(m);
      else upcomingList.push(m);
    }

    upcomingList.sort((a, b) => meetingSortKey(a) - meetingSortKey(b));
    pastList.sort((a, b) => meetingSortKey(b) - meetingSortKey(a));
    return { upcoming: upcomingList, past: pastList };
  }, [meetings]);

  const renderMeetingCard = (m: PortalMeetingRow) => {
    const time = formatTime(m.meeting_time);
    const title = m.meeting_subject || 'Meeting';

    return (
      <PortalCard key={String(m.id)}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-gray-900">{title}</p>
            <div className="mt-2 space-y-1 text-sm text-gray-600">
              <p className="flex items-center gap-2">
                <CalendarDaysIcon className="h-4 w-4 shrink-0 text-gray-400" />
                {formatDate(m.meeting_date)}
                {time ? ` · ${time}` : ''}
              </p>
              {m.meeting_location && (
                <p className="flex items-center gap-2">
                  <MapPinIcon className="h-4 w-4 shrink-0 text-gray-400" />
                  {m.meeting_location}
                </p>
              )}
            </div>
          </div>
          <MeetingStatusBadge status={m.status || 'scheduled'} />
        </div>
        {m.join_url && (
          <a
            href={m.join_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-sm btn-primary mt-3 gap-1.5"
          >
            <VideoCameraIcon className="h-4 w-4" />
            Join meeting
          </a>
        )}
        <MeetingManagerRow manager={meetingManager} />
      </PortalCard>
    );
  };

  return (
    <PortalTabFrame
      title="Meetings"
      subtitle="Scheduled appointments and your meeting requests."
      headerCoverImage={getPortalTabHeaderCoverImage('meetings')}
    >
      <div className="-mt-2 flex justify-end">
        <button type="button" className="btn btn-primary btn-sm gap-1.5 rounded-full" onClick={onRequestMeeting}>
          <PlusIcon className="h-4 w-4" />
          Request meeting
        </button>
      </div>

      <section className="space-y-5">
        <PortalSectionLabel>Upcoming</PortalSectionLabel>
        {upcoming.length === 0 ? (
          <PortalCard>
            <p className="text-sm text-base-content/45">
              No upcoming meetings scheduled. Use &quot;Request meeting&quot; to ask our team for a time.
            </p>
          </PortalCard>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {upcoming.map(renderMeetingCard)}
          </div>
        )}
      </section>

      <section className="space-y-5">
        <PortalSectionLabel>Your requests</PortalSectionLabel>
        {requests.length === 0 ? (
          <PortalCard>
            <p className="text-sm text-base-content/45">You have not submitted any meeting requests yet.</p>
          </PortalCard>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {requests.map((req) => (
              <PortalCard key={req.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium text-gray-900">
                      <CalendarDaysIcon className="h-4 w-4 shrink-0 text-gray-400" />
                      Preferred {formatDate(req.preferred_date)}
                    </p>
                    {req.preferred_time_range && (
                      <p className="mt-1 flex items-center gap-2 text-sm text-gray-600">
                        <ClockIcon className="h-4 w-4 shrink-0 text-gray-400" />
                        {req.preferred_time_range}
                      </p>
                    )}
                    {req.notes && (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-gray-500">{req.notes}</p>
                    )}
                    <p className="mt-2 text-xs text-gray-400">Submitted {formatDateTime(req.created_at)}</p>
                  </div>
                  <RequestStatusBadge status={req.status} />
                </div>
                {req.status === 'pending' && (
                  <p className="mt-2 text-xs text-amber-700/90">Request being reviewed.</p>
                )}
                {req.status === 'confirmed' && (
                  <p className="mt-2 text-xs text-emerald-700/90">
                    Your request was accepted. Check scheduled meetings above for the confirmed time.
                  </p>
                )}
                <MeetingManagerRow manager={meetingManager} />
              </PortalCard>
            ))}
          </div>
        )}
      </section>

      {past.length > 0 && (
        <section className="space-y-5">
          <PortalCard padding="p-0" className="overflow-hidden">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 md:px-6 [&::-webkit-details-marker]:hidden">
                <PortalSectionLabel>Past</PortalSectionLabel>
                <span className="flex items-center gap-2 text-sm font-medium text-base-content/45">
                  {past.length}
                  <ChevronDownIcon className="h-5 w-5 transition-transform group-open:rotate-180" />
                </span>
              </summary>
              <div className="border-t border-gray-100 px-4 pb-4 pt-2 md:px-6 md:pb-6">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {past.map(renderMeetingCard)}
                </div>
              </div>
            </details>
          </PortalCard>
        </section>
      )}
    </PortalTabFrame>
  );
};

export default PortalMeetingsTab;
