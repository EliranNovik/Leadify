import React from 'react';
import { CalendarDaysIcon } from '@heroicons/react/24/outline';
import type { UpcomingMeetingReminder } from '../hooks/useUpcomingMeetingReminder';

type Props = {
  reminder: UpcomingMeetingReminder;
  onClick?: () => void;
  className?: string;
  compact?: boolean;
};

/**
 * Compact header badge for the next meeting within the hour.
 * Client: lead # + name. IM: IM pill + title. Minutes as red count badge.
 */
const UpcomingMeetingHeaderBadge: React.FC<Props> = ({
  reminder,
  onClick,
  className = '',
  compact = false,
}) => {
  const minutesLabel = reminder.minutesLeft < 1 ? 'now' : `${reminder.minutesLeft}m`;
  const title =
    reminder.kind === 'im'
      ? `IM · ${reminder.label} · ${minutesLabel}`
      : `#${reminder.leadNumber || '—'} ${reminder.label} · ${minutesLabel}`;

  return (
    <div className={['relative inline-flex shrink-0', className].filter(Boolean).join(' ')}>
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={[
          'group inline-flex max-w-[min(52vw,20rem)] md:max-w-[22rem] items-center gap-1.5 rounded-full',
          'border-0 bg-green-600 text-white shadow-sm animate-pulse',
          'dark:bg-green-600 dark:text-white',
          'px-2.5 py-1.5 md:px-3 md:py-1.5',
          'hover:bg-green-700 hover:animate-none dark:hover:bg-green-500 transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400/50',
        ].join(' ')}
      >
        <CalendarDaysIcon
          className={compact ? 'h-5 w-5 shrink-0' : 'h-6 w-6 shrink-0'}
          aria-hidden
        />
        {reminder.kind === 'im' ? (
          <span className="inline-flex shrink-0 items-center rounded-md bg-white/25 px-1.5 py-0.5 text-[11px] md:text-xs font-bold uppercase tracking-wide text-white">
            IM
          </span>
        ) : null}
        <span
          className={[
            'min-w-0 truncate font-semibold leading-tight',
            compact ? 'text-[10px]' : 'text-[11px] md:text-xs',
          ].join(' ')}
        >
          {reminder.kind === 'im' ? (
            reminder.label
          ) : (
            <>
              {reminder.leadNumber ? (
                <span className="tabular-nums text-white/95">#{reminder.leadNumber}</span>
              ) : null}
              {reminder.leadNumber ? ' ' : null}
              <span>{reminder.label}</span>
            </>
          )}
        </span>
      </button>
      <span
        className={[
          'absolute -top-1 -right-1 z-10',
          'bg-red-500 text-white font-bold rounded-full',
          'min-w-[1.25rem] h-5 px-1',
          'flex items-center justify-center',
          'text-[10px] leading-none tabular-nums',
          'shadow-sm',
        ].join(' ')}
      >
        {minutesLabel}
      </span>
    </div>
  );
};

export default UpcomingMeetingHeaderBadge;
