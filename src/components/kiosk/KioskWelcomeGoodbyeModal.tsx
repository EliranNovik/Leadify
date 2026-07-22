import React from 'react';
import { ClockIcon, UserGroupIcon, VideoCameraIcon, XMarkIcon } from '@heroicons/react/24/outline';
import type { ClockInKioskFlashAction, ClockInKioskWelcomeMeeting } from '../../lib/clockInKioskApi';
import './kiosk-welcome-goodbye.css';

export const KIOSK_WELCOME_DURATION_MS = 6_000;
export const KIOSK_WELCOME_DURATION_SEC = 6;

const MEETING_DOT_COLORS = ['#60a5fa', '#a78bfa', '#34d399', '#fb923c'];

function formatClock(value: Date) {
  return value.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function initialsFromName(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '•'
  );
}

export type KioskWelcomeGoodbyeModalProps = {
  action: ClockInKioskFlashAction;
  employeeName: string;
  photoUrl?: string | null;
  clockedAt: string | Date;
  meetings?: ClockInKioskWelcomeMeeting[];
  /** Meeting-aware line shown with Welcome / Goodbye. */
  remark?: string | null;
  secondsLeft: number;
  totalSeconds?: number;
  /** Live clock in the footer (defaults to now). */
  now?: Date;
  /** `overlay` = fixed over kiosk; `page` = fills phone QR result screen. */
  variant?: 'overlay' | 'page';
  /** Optional early dismiss (X). When set, shown so the employee can close before the timer. */
  onClose?: () => void;
};

/**
 * Shared Welcome / Goodbye modal used by the entry kiosk tablet and the QR clock-in phone page.
 */
export default function KioskWelcomeGoodbyeModal({
  action,
  employeeName,
  photoUrl,
  clockedAt,
  meetings = [],
  remark = null,
  secondsLeft,
  totalSeconds = KIOSK_WELCOME_DURATION_SEC,
  now = new Date(),
  variant = 'overlay',
  onClose,
}: KioskWelcomeGoodbyeModalProps) {
  const isOut = action === 'out';
  const clockedAtDate = clockedAt instanceof Date ? clockedAt : new Date(clockedAt);
  const ringProgress = Math.max(0, Math.min(1, secondsLeft / Math.max(1, totalSeconds)));
  const ringR = 26;
  const ringC = 2 * Math.PI * ringR;

  return (
    <div
      className={
        variant === 'page'
          ? 'kiosk-success-backdrop kiosk-success-backdrop--page'
          : 'kiosk-success-backdrop'
      }
      role="dialog"
      aria-live="polite"
      aria-label={isOut ? 'Employee clocked out' : 'Employee clocked in'}
    >
      <div className="kiosk-success-card">
        {onClose ? (
          <button
            type="button"
            className="kiosk-success-close"
            onClick={onClose}
            aria-label="Close"
          >
            <XMarkIcon className="h-6 w-6" aria-hidden />
          </button>
        ) : null}

        <div className="kiosk-success-waves" aria-hidden>
          <svg className="kiosk-wave kiosk-wave-1" viewBox="0 0 1440 200" preserveAspectRatio="none">
            <path
              fill="rgba(74, 120, 190, 0.22)"
              d="M0,120 C240,160 480,60 720,100 C960,140 1200,180 1440,120 L1440,200 L0,200 Z"
            />
          </svg>
          <svg className="kiosk-wave kiosk-wave-2" viewBox="0 0 1440 200" preserveAspectRatio="none">
            <path
              fill="rgba(100, 150, 210, 0.16)"
              d="M0,140 C320,90 560,170 800,130 C1040,90 1280,40 1440,90 L1440,200 L0,200 Z"
            />
          </svg>
          <svg className="kiosk-wave kiosk-wave-3" viewBox="0 0 1440 200" preserveAspectRatio="none">
            <path
              fill="rgba(50, 90, 160, 0.2)"
              d="M0,160 C280,120 520,180 760,150 C1000,120 1240,100 1440,140 L1440,200 L0,200 Z"
            />
          </svg>
        </div>

        <div className="kiosk-success-card-body">
          <div className="kiosk-success-photo-wrap">
            <span className="kiosk-success-dot" style={{ top: '8%', left: '4%', background: '#fb923c' }} />
            <span className="kiosk-success-dot" style={{ top: '2%', right: '18%', background: '#34d399' }} />
            <span className="kiosk-success-dot" style={{ bottom: '14%', left: '0%', background: '#60a5fa' }} />
            <span className="kiosk-success-dot" style={{ bottom: '6%', right: '6%', background: '#a78bfa' }} />
            {photoUrl ? (
              <img
                src={photoUrl}
                alt=""
                className="kiosk-success-photo"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  const fallback = e.currentTarget.nextElementSibling;
                  if (fallback instanceof HTMLElement) fallback.style.display = 'flex';
                }}
              />
            ) : null}
            <div
              className="kiosk-success-photo-fallback"
              style={photoUrl ? { display: 'none' } : undefined}
              aria-hidden={Boolean(photoUrl)}
            >
              {initialsFromName(employeeName || 'E')}
            </div>
          </div>

          <p className="kiosk-success-welcome" style={isOut ? { color: '#fbbf24' } : undefined}>
            {isOut ? 'Goodbye' : 'Welcome'}
          </p>
          <p className="kiosk-success-name">{employeeName || 'Employee'}</p>
          <p className="kiosk-success-clocked">
            <ClockIcon className="h-4 w-4" aria-hidden />
            <span>
              {isOut ? 'Clocked out at' : 'Clocked in at'}{' '}
              <strong style={isOut ? { color: '#fbbf24' } : undefined}>
                {formatClock(clockedAtDate)}
              </strong>
            </span>
          </p>

          {remark ? (
            <p className="kiosk-success-remark" role="status">
              {remark}
            </p>
          ) : null}

          {isOut ? (
            <>
              <hr className="kiosk-success-divider" />
              <p className="kiosk-success-footer-msg" style={{ marginTop: '0.35rem' }}>
                See you next time!
              </p>
            </>
          ) : (
            <>
              <hr className="kiosk-success-divider" />
              <p className="kiosk-success-meetings-label">Meetings today</p>
              {meetings.length > 0 ? (
                <div className="kiosk-success-meetings">
                  {meetings.map((m) => {
                    const MeetingIcon = m.isVirtual ? VideoCameraIcon : UserGroupIcon;
                    const dotColor = MEETING_DOT_COLORS[(m.colorIndex ?? 0) % MEETING_DOT_COLORS.length];
                    return (
                      <div key={m.id} className="kiosk-success-meeting">
                        <span className="kiosk-success-meeting-time">{m.time || '—'}</span>
                        <span className="kiosk-success-meeting-dot" style={{ background: dotColor }} />
                        <div className="kiosk-success-meeting-body">
                          <p className="kiosk-success-meeting-title">{m.title}</p>
                          {m.location ? <p className="kiosk-success-meeting-loc">{m.location}</p> : null}
                        </div>
                        <MeetingIcon className="kiosk-success-meeting-icon" aria-hidden />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="kiosk-success-empty-meetings">No meetings scheduled today</p>
              )}
              <p className="kiosk-success-footer-msg">Have a productive day!</p>
            </>
          )}

          <div className="kiosk-success-timer" aria-label={`${secondsLeft} seconds remaining`}>
            <div className="kiosk-success-timer-ring">
              <svg className="absolute inset-0 -rotate-90" viewBox="0 0 64 64" aria-hidden>
                <circle
                  cx="32"
                  cy="32"
                  r={ringR}
                  fill="none"
                  stroke="rgba(255,255,255,0.12)"
                  strokeWidth="4"
                />
                <circle
                  cx="32"
                  cy="32"
                  r={ringR}
                  fill="none"
                  stroke={isOut ? '#fbbf24' : '#34d399'}
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={ringC}
                  strokeDashoffset={ringC * (1 - ringProgress)}
                  style={{ transition: 'stroke-dashoffset 0.95s linear' }}
                />
              </svg>
              <span className="kiosk-success-timer-num">{secondsLeft}</span>
            </div>
            <span className="kiosk-success-timer-label">Closing</span>
          </div>

          <p className="kiosk-success-now">{formatClock(now)}</p>
        </div>
      </div>
    </div>
  );
}
