import React from 'react';
import { ClockIcon } from '@heroicons/react/24/outline';

export const MEETING_DURATION_OPTIONS_MINUTES = [
  15, 30, 45, 60, 90, 120, 150, 180, 210, 240,
] as const;

export const DEFAULT_MEETING_DURATION_MINUTES = 60;

export function normalizeMeetingDurationMinutes(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MEETING_DURATION_MINUTES;
  return Math.round(n);
}

/** Add minutes to HH:mm (or HH:mm:ss); wraps within 24h. */
export function addMinutesToHhMm(time: string, minutes: number): string {
  const match = String(time || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return time;
  const start = Number(match[1]) * 60 + Number(match[2]);
  const total = ((start + minutes) % (24 * 60) + 24 * 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatMeetingDurationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  if (minutes % 30 === 0) {
    const hours = minutes / 60;
    return `${hours} hours`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

type MeetingDurationFieldProps = {
  value: number;
  onChange: (minutes: number) => void;
  startTime?: string;
  disabled?: boolean;
  className?: string;
};

/** Duration dropdown with from→to preview for schedule drawers. */
export function MeetingDurationField({
  value,
  onChange,
  startTime,
  disabled = false,
  className = '',
}: MeetingDurationFieldProps) {
  const duration = normalizeMeetingDurationMinutes(value);
  const knownValues = MEETING_DURATION_OPTIONS_MINUTES as readonly number[];
  const selectValue = knownValues.includes(duration)
    ? duration
    : DEFAULT_MEETING_DURATION_MINUTES;
  const endTime =
    startTime && /^\d{1,2}:\d{2}/.test(startTime)
      ? addMinutesToHhMm(startTime, duration)
      : null;

  return (
    <div className={className}>
      <label className="mb-1 flex items-center gap-2 font-semibold">
        <ClockIcon className="h-5 w-5 shrink-0 opacity-60" aria-hidden />
        <span>Duration</span>
      </label>
      <select
        className="select select-bordered w-full"
        value={selectValue}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {MEETING_DURATION_OPTIONS_MINUTES.map((mins) => (
          <option key={mins} value={mins}>
            {formatMeetingDurationLabel(mins)}
          </option>
        ))}
      </select>
      {startTime && endTime ? (
        <p className="mt-2 text-sm text-base-content/60">
          From <span className="font-semibold text-base-content/80">{startTime.substring(0, 5)}</span>
          {' '}to{' '}
          <span className="font-semibold text-base-content/80">{endTime}</span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-base-content/45">Select a start time to see the end time.</p>
      )}
    </div>
  );
}

export default MeetingDurationField;
