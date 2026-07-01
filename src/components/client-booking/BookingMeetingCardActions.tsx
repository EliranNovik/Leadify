import React from 'react';
import {
  CalendarDaysIcon,
  ClipboardDocumentIcon,
  ShareIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import {
  buildGoogleCalendarUrl,
  copyTextToClipboard,
  meetingShareText,
  shareMeetingLink,
} from '../../lib/meetingCalendarShare';
import { BUSINESS_TZ } from '../../lib/bookingTimezone';

const MEETING_ACTION_BTN_CLASS =
  'inline-flex h-10 min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-800 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50';

export type BookingMeetingCardActionsProps = {
  title: string;
  meetingDate?: string | null;
  meetingTime?: string | null;
  meetingLocation?: string | null;
  joinUrl?: string | null;
  durationMinutes?: number;
  timeZone?: string;
  className?: string;
};

export function BookingMeetingCardActions({
  title,
  meetingDate,
  meetingTime,
  meetingLocation,
  joinUrl,
  durationMinutes = 30,
  timeZone = BUSINESS_TZ,
  className = '',
}: BookingMeetingCardActionsProps) {
  const url = joinUrl?.trim() || '';
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const googleCalendarUrl =
    meetingDate && meetingTime
      ? buildGoogleCalendarUrl({
          title,
          date: meetingDate,
          time: meetingTime,
          location: meetingLocation,
          joinUrl: url || null,
          durationMinutes,
          timeZone,
        })
      : null;

  const handleCopyLink = async () => {
    if (!url) {
      toast.error('No meeting link available');
      return;
    }
    const ok = await copyTextToClipboard(url);
    if (ok) toast.success('Meeting link copied');
    else toast.error('Could not copy link');
  };

  const handleShare = async () => {
    if (!url) {
      toast.error('No meeting link available');
      return;
    }
    const result = await shareMeetingLink({
      title,
      url,
      text: meetingShareText(title, meetingDate, meetingTime),
    });
    if (result === 'copied') toast.success('Meeting link copied');
    else if (result === 'failed') toast.error('Could not share meeting link');
  };

  if (!url && !googleCalendarUrl) return null;

  return (
    <div className={`mt-auto border-t border-gray-100 pt-4 ${className}`.trim()}>
      <div className="flex flex-wrap gap-2">
        {url ? (
          <>
            <button type="button" className={MEETING_ACTION_BTN_CLASS} onClick={() => void handleCopyLink()}>
              <ClipboardDocumentIcon className="h-4 w-4 shrink-0 text-gray-500" />
              Copy link
            </button>
            {canShare ? (
              <button type="button" className={MEETING_ACTION_BTN_CLASS} onClick={() => void handleShare()}>
                <ShareIcon className="h-4 w-4 shrink-0 text-gray-500" />
                Share
              </button>
            ) : null}
          </>
        ) : null}
        {googleCalendarUrl ? (
          <a
            href={googleCalendarUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={MEETING_ACTION_BTN_CLASS}
          >
            <CalendarDaysIcon className="h-4 w-4 shrink-0 text-gray-500" />
            Google Calendar
          </a>
        ) : null}
      </div>
    </div>
  );
}
