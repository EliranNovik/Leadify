import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDaysIcon,
  MapPinIcon,
  VideoCameraIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { UpcomingMeetingReminder } from '../hooks/useUpcomingMeetingReminder';

type Props = {
  open: boolean;
  onClose: () => void;
  meetings: UpcomingMeetingReminder[];
};

const UpcomingMeetingsModal: React.FC<Props> = ({ open, onClose, meetings }) => {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (open) {
      setVisible(true);
      const id = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => setEntered(true));
      });
      return () => window.cancelAnimationFrame(id);
    }
    setEntered(false);
    const t = window.setTimeout(() => setVisible(false), 220);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!visible || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[12000] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button
        type="button"
        aria-label="Close"
        className={[
          'absolute inset-0 bg-slate-900/45 backdrop-blur-[2px] transition-opacity duration-200',
          entered ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upcoming-meetings-title"
        className={[
          'relative z-10 flex w-full max-h-[88vh] flex-col overflow-hidden',
          'rounded-t-2xl sm:rounded-2xl bg-base-100 shadow-2xl ring-1 ring-base-300/70',
          'sm:max-w-3xl transition-all duration-200 ease-out',
          entered
            ? 'opacity-100 translate-y-0 sm:scale-100'
            : 'opacity-0 translate-y-6 sm:translate-y-2 sm:scale-[0.97]',
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-3 border-b border-base-200 px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
                <CalendarDaysIcon className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h2 id="upcoming-meetings-title" className="text-base font-semibold text-base-content">
                  Upcoming meetings
                </h2>
                <p className="text-xs text-base-content/60">
                  Starting within the next hour
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-square rounded-lg"
            onClick={onClose}
            aria-label="Close"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-5 sm:py-4">
          {meetings.length === 0 ? (
            <p className="py-10 text-center text-sm text-base-content/60">No upcoming meetings.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-base-200">
              <table className="table w-full text-base">
                <thead className="bg-base-200/60 text-base-content/70 text-sm">
                  <tr>
                    <th className="whitespace-nowrap">Time</th>
                    <th>Meeting</th>
                    <th className="hidden sm:table-cell">Location</th>
                    <th className="whitespace-nowrap text-right">In</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {meetings.map((meeting) => {
                    const signedMinutes = Math.floor(
                      (meeting.meetingDateTime.getTime() - Date.now()) / 60_000,
                    );
                    const minutesLabel =
                      signedMinutes < 0
                        ? `${Math.abs(signedMinutes)}m ago`
                        : signedMinutes < 1
                          ? 'now'
                          : `${signedMinutes}m`;
                    return (
                      <tr key={meeting.id} className="hover:bg-base-200/40">
                        <td className="align-middle text-base font-semibold tabular-nums whitespace-nowrap">
                          {meeting.timeLabel}
                        </td>
                        <td className="align-middle min-w-[10rem]">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2 min-w-0">
                              {meeting.kind === 'im' ? (
                                <span className="inline-flex shrink-0 items-center rounded-md bg-amber-500 px-1.5 py-0.5 text-xs md:text-sm font-bold uppercase tracking-wide text-white">
                                  IM
                                </span>
                              ) : meeting.leadNumber ? (
                                <span className="shrink-0 text-sm font-semibold tabular-nums text-primary">
                                  #{meeting.leadNumber}
                                </span>
                              ) : null}
                              <span className="truncate font-medium text-base">{meeting.label}</span>
                            </div>
                            {meeting.kind === 'client' && meeting.leadRouteId != null ? (
                              <button
                                type="button"
                                className="w-fit text-left text-sm text-primary/80 hover:underline"
                                onClick={() => {
                                  onClose();
                                  navigate(`/clients/${meeting.leadRouteId}`);
                                }}
                              >
                                Open lead
                              </button>
                            ) : null}
                            <div className="sm:hidden text-sm text-base-content/55 flex items-center gap-1">
                              <MapPinIcon className="h-4 w-4 shrink-0" aria-hidden />
                              <span className="truncate">{meeting.location || '—'}</span>
                            </div>
                          </div>
                        </td>
                        <td className="align-middle hidden sm:table-cell text-base text-base-content/70">
                          <span className="inline-flex items-center gap-1.5 max-w-[14rem]">
                            <MapPinIcon className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
                            <span className="truncate">{meeting.location || '—'}</span>
                          </span>
                        </td>
                        <td className="align-middle text-right">
                          <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-sm font-bold tabular-nums text-amber-900 dark:bg-amber-500/20 dark:text-amber-100">
                            {minutesLabel}
                          </span>
                        </td>
                        <td className="align-middle text-right">
                          {meeting.canJoin && meeting.joinUrl ? (
                            <a
                              href={meeting.joinUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-primary btn-circle h-11 w-11 min-h-11 border-0"
                              title="Join meeting"
                              aria-label="Join meeting"
                            >
                              <VideoCameraIcon className="h-6 w-6" aria-hidden />
                            </a>
                          ) : (
                            <span className="text-sm text-base-content/45 whitespace-nowrap">
                              In person
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default UpcomingMeetingsModal;
