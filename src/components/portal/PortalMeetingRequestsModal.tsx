import React, { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarDaysIcon,
  ClockIcon,
  MapPinIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import ClientPortalBookingBadge from '../client-booking/ClientPortalBookingBadge';
import {
  buildClientPortalBookedMeetingTabRoute,
  formatPortalPreferredDate,
  getClientPortalBookedMeetingLeadNumber,
  resolveClientPortalBookedMeetingLead,
  type ClientPortalBookedMeeting,
} from '../../lib/portalMeetingRequests';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  requests: ClientPortalBookedMeeting[];
  loading: boolean;
  onUpdated?: () => void;
};

function formatMeetingTime(value: string | null | undefined): string {
  if (!value) return '';
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return value;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

const PortalMeetingRequestsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  requests: meetings,
  loading,
}) => {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const sortedMeetings = useMemo(() => {
    return [...meetings].sort((a, b) => {
      const dateCmp = (a.meeting_date || '').localeCompare(b.meeting_date || '');
      if (dateCmp !== 0) return dateCmp;
      return (a.meeting_time || '').localeCompare(b.meeting_time || '');
    });
  }, [meetings]);

  const handleOpenMeetingTab = (meeting: ClientPortalBookedMeeting) => {
    navigate(buildClientPortalBookedMeetingTabRoute(meeting));
    onClose();
  };

  if (!isOpen || typeof window === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-base-100"
      role="dialog"
      aria-modal="true"
      aria-labelledby="portal-meeting-requests-title"
    >
      <div className="flex items-start justify-between gap-4 px-5 py-4 shrink-0 bg-base-100 border-b border-base-200/80">
        <div>
          <h2 id="portal-meeting-requests-title" className="text-xl font-bold flex items-center gap-2">
            <CalendarDaysIcon className="w-6 h-6 text-primary" />
            Client bookings
          </h2>
          <p className="text-sm text-base-content/60 mt-1">
            {loading
              ? 'Loading…'
              : sortedMeetings.length === 0
                ? 'No upcoming client bookings'
                : `${sortedMeetings.length} upcoming · today and later`}
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm btn-circle" onClick={onClose} aria-label="Close">
          <XMarkIcon className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-auto px-5 py-4 space-y-4 min-h-0 bg-[#ececec]">
        {loading ? (
          <div className="flex justify-center py-16">
            <span className="loading loading-spinner loading-lg text-primary" />
          </div>
        ) : sortedMeetings.length === 0 ? (
          <div className="text-center py-16 text-base-content/50">
            No active meetings booked by clients from today onward.
          </div>
        ) : (
          <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 md:grid-cols-2">
            {sortedMeetings.map((meeting) => {
              const resolved = resolveClientPortalBookedMeetingLead(meeting);
              const leadName = resolved?.lead.name?.trim() || 'Unknown client';
              const leadNumber = getClientPortalBookedMeetingLeadNumber(meeting);
              const timeLabel = formatMeetingTime(meeting.meeting_time);
              const locationLabel = (meeting.meeting_location || '').trim() || '—';
              const joinUrl = meeting.teams_meeting_url || meeting.custom_link || null;

              return (
                <article
                  key={meeting.id}
                  className="flex flex-col gap-3 rounded-[18px] bg-white px-4 py-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold text-base-content">{leadName}</p>
                      <p className="mt-0.5 text-sm font-medium text-base-content/50">{leadNumber}</p>
                    </div>
                    <ClientPortalBookingBadge />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700">
                      <CalendarDaysIcon className="h-3.5 w-3.5" aria-hidden />
                      {formatPortalPreferredDate(meeting.meeting_date)}
                    </span>
                    {timeLabel ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700">
                        <ClockIcon className="h-3.5 w-3.5" aria-hidden />
                        {timeLabel}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700">
                      <MapPinIcon className="h-3.5 w-3.5" aria-hidden />
                      {locationLabel}
                    </span>
                  </div>

                  {meeting.meeting_subject?.trim() ? (
                    <p className="text-sm text-base-content/65">{meeting.meeting_subject.trim()}</p>
                  ) : null}

                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm rounded-full px-4"
                      onClick={() => handleOpenMeetingTab(meeting)}
                    >
                      Open meeting tab
                    </button>
                    {joinUrl ? (
                      <a
                        href={joinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost btn-sm rounded-full"
                      >
                        Join link
                      </a>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default PortalMeetingRequestsModal;
