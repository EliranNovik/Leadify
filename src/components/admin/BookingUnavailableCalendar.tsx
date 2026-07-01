import React, { useMemo, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_LABELS_FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export type BookingUnavailableCalendarProps = {
  selectedDates: string[];
  onChange: (dates: string[]) => void;
  className?: string;
  /** Compact mini calendar for admin side panels */
  compact?: boolean;
};

const BookingUnavailableCalendar: React.FC<BookingUnavailableCalendarProps> = ({
  selectedDates,
  onChange,
  className = '',
  compact = false,
}) => {
  const [viewMonth, setViewMonth] = useState(() => new Date());
  const selectedSet = useMemo(() => new Set(selectedDates), [selectedDates]);

  const cells = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const result: Array<{ date: string | null; day: number | null }> = [];

    for (let i = 0; i < firstDay; i += 1) {
      result.push({ date: null, day: null });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      result.push({ date: toDateKey(year, month, day), day });
    }
    return result;
  }, [viewMonth]);

  const toggleDate = (date: string) => {
    if (selectedSet.has(date)) {
      onChange(selectedDates.filter((d) => d !== date).sort());
    } else {
      onChange([...selectedDates, date].sort());
    }
  };

  const monthLabel = viewMonth.toLocaleDateString(undefined, {
    month: compact ? 'short' : 'long',
    year: 'numeric',
  });

  const dayLabels = compact ? DAY_LABELS : DAY_LABELS_FULL;

  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white shadow-sm ${
        compact ? 'inline-block w-[17.5rem] max-w-full p-3' : 'bg-gray-50/60 p-4'
      } ${className}`}
    >
      <div className={`flex items-center justify-between ${compact ? 'mb-2' : 'mb-3'}`}>
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-circle"
          onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
          aria-label="Previous month"
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" />
        </button>
        <span className={`font-semibold text-gray-800 ${compact ? 'text-xs' : 'text-sm'}`}>
          {monthLabel}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-circle"
          onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
          aria-label="Next month"
        >
          <ChevronRightIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      <div
        className={`grid grid-cols-7 text-center font-semibold uppercase tracking-wide text-base-content/40 ${
          compact ? 'gap-0.5 text-[9px]' : 'gap-1 text-[10px]'
        }`}
      >
        {dayLabels.map((d, i) => (
          <div key={`${d}-${i}`} className={compact ? 'py-0.5' : 'py-1'}>
            {d}
          </div>
        ))}
      </div>

      <div className={`grid grid-cols-7 ${compact ? 'mt-0.5 gap-0.5' : 'mt-1 gap-1'}`}>
        {cells.map((cell, idx) => {
          if (!cell.date || cell.day == null) {
            return <div key={`empty-${idx}`} className={compact ? 'h-7' : ''} />;
          }
          const isBlocked = selectedSet.has(cell.date);
          return (
            <button
              key={cell.date}
              type="button"
              onClick={() => toggleDate(cell.date!)}
              className={`flex items-center justify-center rounded-md font-medium transition-colors ${
                compact ? 'h-7 w-7 text-[11px]' : 'aspect-square rounded-lg text-xs'
              } ${
                isBlocked
                  ? 'bg-error/15 text-error ring-1 ring-error/30'
                  : 'text-gray-700 hover:bg-gray-50 hover:ring-1 hover:ring-gray-200'
              }`}
              title={isBlocked ? 'Unavailable — click to allow' : 'Click to mark unavailable'}
            >
              {cell.day}
            </button>
          );
        })}
      </div>

      {selectedDates.length > 0 ? (
        <div
          className={`mt-2 flex flex-wrap gap-1 ${
            compact ? 'max-h-20 overflow-y-auto' : 'mt-3 gap-1.5'
          }`}
        >
          {selectedDates.map((date) => (
            <button
              key={date}
              type="button"
              className="badge badge-xs gap-0.5 border-error/20 bg-error/10 text-error"
              onClick={() => toggleDate(date)}
            >
              {date}
              <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      ) : (
        <p className={`text-base-content/45 ${compact ? 'mt-2 text-[10px]' : 'mt-3 text-xs'}`}>
          Click dates to block booking.
        </p>
      )}
    </div>
  );
};

export default BookingUnavailableCalendar;
