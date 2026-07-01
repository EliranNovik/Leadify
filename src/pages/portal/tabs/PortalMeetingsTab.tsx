import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDaysIcon,
  ChevronDownIcon,
  VideoCameraIcon,
} from '@heroicons/react/24/outline';
import ClientBookingScheduler from '../../../components/client-booking/ClientBookingScheduler';
import { BookingMeetingCardActions } from '../../../components/client-booking/BookingMeetingCardActions';
import { portalGetBookingAccess, type PortalMeetingRow } from '../../../lib/portalApi';
import {
  getPortalTabHeaderCoverImage,
  PortalCard,
  PortalLoading,
  PortalSectionLabel,
  PortalTabFrame,
} from '../components/portalTheme';
import PortalMeetingLocationLines from '../components/PortalMeetingLocationLines';

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

function formatTime12h(t: string | null | undefined): string {
  const raw = formatTime(t);
  if (!raw) return '';
  const [hStr, mStr] = raw.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h)) return raw;
  const period = h >= 12 ? 'pm' : 'am';
  const hour12 = h % 12 || 12;
  return m ? `${hour12}:${String(m).padStart(2, '0')}${period}` : `${hour12}${period}`;
}

function formatMeetingTitle(date: string | null | undefined, time: string | null | undefined): string {
  if (!date) return formatTime12h(time) || 'Meeting';
  try {
    const d = new Date(`${date.includes('T') ? date : `${date}T12:00:00`}`);
    const dateLabel = d.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const timeLabel = formatTime12h(time);
    return timeLabel ? `${dateLabel} · ${timeLabel}` : dateLabel;
  } catch {
    const timeLabel = formatTime12h(time);
    return timeLabel ? `${formatDate(date)} · ${timeLabel}` : formatDate(date);
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

function MeetingCardActions({ meeting, title }: { meeting: PortalMeetingRow; title: string }) {
  return (
    <BookingMeetingCardActions
      title={title}
      meetingDate={meeting.meeting_date}
      meetingTime={meeting.meeting_time}
      meetingLocation={meeting.meeting_location}
      joinUrl={meeting.join_url}
    />
  );
}

function PortalMeetingCard({
  meeting,
  muted = false,
}: {
  meeting: PortalMeetingRow;
  muted?: boolean;
}) {
  const title = formatMeetingTitle(meeting.meeting_date, meeting.meeting_time);
  const isTeams = (meeting.meeting_location || '').toLowerCase() === 'teams';

  return (
    <article
      className={`group relative flex h-full flex-col overflow-hidden rounded-[20px] border border-gray-100/90 bg-white shadow-[0_2px_14px_rgba(15,23,42,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(15,23,42,0.09)] ${
        muted ? 'opacity-80' : ''
      }`}
    >
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 gap-3">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                muted ? 'bg-neutral-100 text-neutral-500' : 'bg-primary/10 text-primary'
              }`}
            >
              <CalendarDaysIcon className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-bold leading-snug tracking-tight text-gray-900 md:text-[1.05rem]">
                {title}
              </h3>
              <PortalMeetingLocationLines
                location={meeting.meeting_location}
                isPhysicalMeeting={meeting.is_physical_meeting}
                meetingAddress={meeting.meeting_address}
              />
            </div>
          </div>
          <MeetingStatusBadge status={meeting.status || 'scheduled'} />
        </div>

        {meeting.join_url ? (
          <a
            href={meeting.join_url}
            target="_blank"
            rel="noopener noreferrer"
            className={`btn btn-sm mt-5 w-full gap-2 rounded-lg border-0 font-semibold shadow-sm ${
              isTeams ? 'btn-primary' : 'btn-outline'
            }`}
          >
            <VideoCameraIcon className="h-4 w-4" />
            Join meeting
          </a>
        ) : null}

        <MeetingCardActions meeting={meeting} title={title} />
      </div>
    </article>
  );
}

type Props = {
  meetings: PortalMeetingRow[];
  sessionContactId?: number | null;
  onMeetingsChange?: () => void;
};

const PortalMeetingsTab: React.FC<Props> = ({
  meetings,
  sessionContactId = null,
  onMeetingsChange,
}) => {
  const [bookingToken, setBookingToken] = useState<string | null>(null);
  const [bookingAccessLoading, setBookingAccessLoading] = useState(true);
  const [bookingAccessError, setBookingAccessError] = useState<string | null>(null);

  useEffect(() => {
    setBookingAccessLoading(true);
    void portalGetBookingAccess()
      .then((result) => {
        if (result?.ok && result.booking_token) {
          setBookingToken(result.booking_token);
          setBookingAccessError(null);
        } else {
          setBookingToken(null);
          setBookingAccessError(result?.error || 'Self-scheduling is not available for your case.');
        }
      })
      .catch((e) => {
        setBookingToken(null);
        setBookingAccessError(e instanceof Error ? e.message : 'Could not load scheduling');
      })
      .finally(() => setBookingAccessLoading(false));
  }, []);

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

  const renderMeetingCard = (m: PortalMeetingRow, muted = false) => (
    <PortalMeetingCard key={String(m.id)} meeting={m} muted={muted} />
  );

  const pastMeetingsSection =
    past.length > 0 ? (
      <section className="mt-10 space-y-5">
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
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                {past.map((m) => renderMeetingCard(m, true))}
              </div>
            </div>
          </details>
        </PortalCard>
      </section>
    ) : null;

  if (bookingAccessLoading) {
    return (
      <PortalTabFrame
        title="Meetings"
        subtitle="Schedule appointments and view your upcoming meetings."
        headerCoverImage={getPortalTabHeaderCoverImage('meetings')}
      >
        <PortalLoading className="py-16" />
      </PortalTabFrame>
    );
  }

  if (bookingToken) {
    return (
      <>
        <ClientBookingScheduler
          bookingToken={bookingToken}
          variant="public"
          inClientPortal
          defaultContactId={sessionContactId}
          onBooked={onMeetingsChange}
        />
        {pastMeetingsSection}
      </>
    );
  }

  return (
    <PortalTabFrame
      title="Meetings"
      subtitle="Schedule appointments and view your upcoming meetings."
      headerCoverImage={getPortalTabHeaderCoverImage('meetings')}
    >
      <section className="space-y-5">
        <PortalSectionLabel>Upcoming</PortalSectionLabel>
        {upcoming.length === 0 ? (
          <PortalCard>
            <p className="text-sm text-base-content/45">
              No upcoming meetings scheduled.
              {bookingAccessError ? ` ${bookingAccessError}` : ''}
            </p>
          </PortalCard>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((m) => renderMeetingCard(m))}
          </div>
        )}
      </section>

      {bookingAccessError ? (
        <section className="space-y-5">
          <PortalCard>
            <p className="text-sm text-base-content/55">{bookingAccessError}</p>
          </PortalCard>
        </section>
      ) : null}

      {pastMeetingsSection}
    </PortalTabFrame>
  );
};

export default PortalMeetingsTab;
