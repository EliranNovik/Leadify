import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDownIcon, ClockIcon } from '@heroicons/react/24/outline';

export interface TimePickerProps {
  /** Format HH:MM (24h). */
  value: string;
  onChange: (time: string) => void;
  meetingCounts?: Record<string, number>;
  disabled?: boolean;
  label?: string;
  labelClassName?: string;
  /** Dropdown trigger vs always-visible wheels (better in drawers). */
  variant?: 'dropdown' | 'inline';
  minuteStep?: number;
  minHour?: number;
  maxHour?: number;
}

function snapMinute(minute: number, step: number): number {
  if (step <= 1) return minute;
  return Math.min(59, Math.round(minute / step) * step);
}

function parseTime(value: string | undefined, step: number, minHour: number, maxHour: number) {
  let hour = 9;
  let minute = 0;
  if (value && /^\d{1,2}:\d{2}$/.test(value)) {
    const [h, m] = value.split(':').map(Number);
    if (Number.isFinite(h)) hour = h;
    if (Number.isFinite(m)) minute = snapMinute(m, step);
  }
  hour = Math.min(maxHour, Math.max(minHour, hour));
  return { hour, minute };
}

function formatTime(hour: number, minute: number) {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

const TimePicker: React.FC<TimePickerProps> = ({
  value,
  onChange,
  meetingCounts = {},
  disabled = false,
  label = 'Time',
  labelClassName = 'block font-semibold mb-1',
  variant = 'dropdown',
  minuteStep = 1,
  minHour = 8,
  maxHour = 23,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hourScrollRef = useRef<HTMLDivElement>(null);
  const minuteScrollRef = useRef<HTMLDivElement>(null);

  const parsed = parseTime(value, minuteStep, minHour, maxHour);
  const [selectedHour, setSelectedHour] = useState(parsed.hour);
  const [selectedMinute, setSelectedMinute] = useState(parsed.minute);

  const hours = useMemo(() => {
    const list: number[] = [];
    for (let h = minHour; h <= maxHour; h += 1) list.push(h);
    return list;
  }, [minHour, maxHour]);

  const minutes = useMemo(() => {
    const list: number[] = [];
    for (let m = 0; m < 60; m += minuteStep) list.push(m);
    return list;
  }, [minuteStep]);

  const emitChange = useCallback(
    (hour: number, minute: number) => {
      onChange(formatTime(hour, minute));
    },
    [onChange],
  );

  useEffect(() => {
    const next = parseTime(value, minuteStep, minHour, maxHour);
    setSelectedHour(next.hour);
    setSelectedMinute(next.minute);
  }, [value, minuteStep, minHour, maxHour]);

  const scrollSelectedIntoView = useCallback(() => {
    requestAnimationFrame(() => {
      const hourIdx = hours.indexOf(selectedHour);
      const minuteIdx = minutes.indexOf(selectedMinute);
      if (hourScrollRef.current && hourIdx >= 0) {
        const el = hourScrollRef.current.children[hourIdx] as HTMLElement | undefined;
        el?.scrollIntoView({ block: 'center' });
      }
      if (minuteScrollRef.current && minuteIdx >= 0) {
        const el = minuteScrollRef.current.children[minuteIdx] as HTMLElement | undefined;
        el?.scrollIntoView({ block: 'center' });
      }
    });
  }, [hours, minutes, selectedHour, selectedMinute]);

  useEffect(() => {
    if (variant === 'inline' || isOpen) scrollSelectedIntoView();
  }, [variant, isOpen, scrollSelectedIntoView, selectedHour, selectedMinute]);

  useEffect(() => {
    if (variant !== 'dropdown') return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, variant]);

  const handleHourChange = (hour: number) => {
    setSelectedHour(hour);
    emitChange(hour, selectedMinute);
  };

  const handleMinuteChange = (minute: number) => {
    setSelectedMinute(minute);
    emitChange(selectedHour, minute);
  };

  const getBadgeClass = (count: number) => {
    if (count === 0) return 'badge badge-ghost badge-sm';
    if (count <= 2) return 'badge badge-success badge-sm';
    if (count <= 5) return 'badge badge-warning badge-sm';
    return 'badge badge-error badge-sm';
  };

  const currentTimeStr = formatTime(selectedHour, selectedMinute);
  const currentCount = meetingCounts[currentTimeStr] || 0;

  const wheelItemClass = (selected: boolean) =>
    `w-full rounded-lg px-2 py-2.5 text-center text-sm font-medium transition-all ${
      selected
        ? 'bg-primary text-primary-content shadow-sm scale-[1.02]'
        : 'text-base-content/70 hover:bg-base-200/80 hover:text-base-content'
    }`;

  const wheels = (
    <div className="flex items-stretch justify-center gap-1 sm:gap-2">
      <div className="flex min-w-0 flex-1 flex-col items-center">
        <span className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-base-content/45">
          Hour
        </span>
        <div
          ref={hourScrollRef}
          className="time-picker-scroll h-44 w-full overflow-y-auto overscroll-contain px-1 py-2"
        >
          {hours.map((hour) => (
            <button
              key={hour}
              type="button"
              disabled={disabled}
              className={wheelItemClass(hour === selectedHour)}
              onClick={() => handleHourChange(hour)}
            >
              {hour.toString().padStart(2, '0')}
            </button>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center self-center pt-5 text-2xl font-bold text-base-content/30">
        :
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-center">
        <span className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-base-content/45">
          Min
        </span>
        <div
          ref={minuteScrollRef}
          className="time-picker-scroll h-44 w-full overflow-y-auto overscroll-contain px-1 py-2"
        >
          {minutes.map((minute) => (
            <button
              key={minute}
              type="button"
              disabled={disabled}
              className={wheelItemClass(minute === selectedMinute)}
              onClick={() => handleMinuteChange(minute)}
            >
              {minute.toString().padStart(2, '0')}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const summaryRow = (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-base-content">
        <ClockIcon className="h-4 w-4 text-primary" aria-hidden />
        <span>{currentTimeStr}</span>
      </div>
      {currentCount > 0 ? (
        <span className={getBadgeClass(currentCount)}>
          {currentCount} meeting{currentCount !== 1 ? 's' : ''} at this hour
        </span>
      ) : (
        <span className="text-xs text-base-content/45">No other meetings at this time</span>
      )}
    </div>
  );

  if (variant === 'inline') {
    return (
      <div className={`${disabled ? 'opacity-50 pointer-events-none' : ''}`} ref={containerRef}>
        {label ? <label className={labelClassName}>{label}</label> : null}
        {wheels}
        {summaryRow}
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      {label ? <label className={labelClassName}>{label}</label> : null}
      <button
        type="button"
        disabled={disabled}
        className="input input-bordered flex h-12 min-h-12 w-full cursor-pointer items-center justify-between gap-2 text-left"
        onClick={() => !disabled && setIsOpen((o) => !o)}
      >
        <div className="flex min-w-0 items-center gap-2">
          <ClockIcon className="h-5 w-5 shrink-0 text-primary" aria-hidden />
          <span className="font-semibold tabular-nums">{currentTimeStr}</span>
          {currentCount > 0 && <span className={getBadgeClass(currentCount)}>{currentCount}</span>}
        </div>
        <ChevronDownIcon
          className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-2xl border border-base-300/80 bg-base-100 shadow-xl dark:border-base-content/10">
          <div className="px-3 pb-2 pt-3">{wheels}</div>
          {summaryRow}
        </div>
      )}
      <style>{`
        .time-picker-scroll::-webkit-scrollbar {
          width: 5px;
        }
        .time-picker-scroll::-webkit-scrollbar-thumb {
          background: color-mix(in oklab, var(--color-base-content) 25%, transparent);
          border-radius: 999px;
        }
      `}</style>
    </div>
  );
};

export default TimePicker;
