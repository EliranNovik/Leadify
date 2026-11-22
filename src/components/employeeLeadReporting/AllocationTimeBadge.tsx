import React, { useEffect, useRef, useState } from 'react';
import {
  allocationPercentToWorkedMs,
  formatAllocationPercent,
  formatAllocationWorkedDuration,
  snapAllocationPercent,
} from '../../lib/employeeLeadReporting';

type Props = {
  percent: number;
  dayWorkedMs: number;
  readOnly?: boolean;
  maxPercent?: number;
  onChange: (percent: number) => void;
  className: string;
};

function takeTypedDigits(previous: string, incoming: string, replaceAll: boolean): string {
  const digits = incoming.replace(/[^\d]/g, '');
  if (!replaceAll) return digits;
  if (previous && digits.length > previous.length && digits.startsWith(previous)) {
    return digits.slice(previous.length);
  }
  if (previous && digits.length > previous.length && digits.endsWith(previous)) {
    return digits.slice(0, digits.length - previous.length);
  }
  return digits;
}

function msToHoursMinutes(ms: number): { hours: number; minutes: number } {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  return {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  };
}

function hoursMinutesToMs(hours: number, minutes: number): number {
  return Math.max(0, hours) * 3_600_000 + Math.max(0, minutes) * 60_000;
}

const AllocationTimeBadge: React.FC<Props> = ({
  percent,
  dayWorkedMs,
  readOnly = false,
  maxPercent = 100,
  onChange,
  className,
}) => {
  const hasDay = dayWorkedMs > 0;
  const allocatedMs = hasDay ? allocationPercentToWorkedMs(dayWorkedMs, percent) : 0;
  const label = hasDay
    ? formatAllocationWorkedDuration(allocatedMs)
    : `${formatAllocationPercent(percent)}%`;
  const [open, setOpen] = useState(false);
  const [placeAbove, setPlaceAbove] = useState(false);
  const [hoursDraft, setHoursDraft] = useState('0');
  const [minutesDraft, setMinutesDraft] = useState('0');
  const [percentDraft, setPercentDraft] = useState('0');
  const badgeRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const minutesRef = useRef<HTMLInputElement | null>(null);
  const replaceHoursRef = useRef(true);
  const replaceMinutesRef = useRef(true);
  const canEdit = !readOnly;
  const hasTime = hasDay ? allocatedMs > 0 : Number(percent) > 0;
  const toneClass = hasTime
    ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-sm'
    : 'bg-gray-100 text-gray-400';
  const maxHours = hasDay
    ? Math.floor(allocationPercentToWorkedMs(dayWorkedMs, Math.min(100, Math.max(0, maxPercent))) / 3_600_000)
    : 0;

  const focusMinutes = () => {
    window.requestAnimationFrame(() => {
      minutesRef.current?.focus();
      minutesRef.current?.select();
    });
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (badgeRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  const start = () => {
    if (!canEdit) return;
    const parts = msToHoursMinutes(allocatedMs);
    setHoursDraft(String(parts.hours));
    setMinutesDraft(String(parts.minutes));
    setPercentDraft(formatAllocationPercent(percent));
    const rect = badgeRef.current?.getBoundingClientRect();
    setPlaceAbove(Boolean(rect && window.innerHeight - rect.bottom < 220));
    setOpen(true);
  };

  const commit = () => {
    if (hasDay) {
      const hours = Math.max(0, Math.round(Number(hoursDraft)) || 0);
      const minutes = Math.max(0, Math.min(59, Math.round(Number(minutesDraft)) || 0));
      const cap = Math.min(100, Math.max(0, maxPercent));
      const nextMs = Math.min(dayWorkedMs, hoursMinutesToMs(hours, minutes));
      const nextPercent = snapAllocationPercent((nextMs / dayWorkedMs) * 100, dayWorkedMs, 0, cap);
      onChange(nextPercent);
    } else {
      const next = Math.round(Number(percentDraft));
      const cap = Math.min(100, Math.max(0, Math.round(maxPercent)));
      onChange(Number.isFinite(next) ? Math.min(cap, Math.max(0, next)) : 0);
    }
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  const fieldClass =
    'input input-bordered h-11 w-full min-h-11 rounded-[12px] px-2 text-center text-lg font-semibold tabular-nums text-gray-800';

  return (
    <span className="relative inline-flex shrink-0">
      <button
        ref={badgeRef}
        type="button"
        disabled={!canEdit}
        onClick={start}
        title={canEdit ? (hasDay ? 'Click to change the time' : 'Click to change the share') : undefined}
        className={`${className} ${toneClass} ${canEdit ? 'cursor-pointer transition hover:brightness-105 active:scale-[0.98]' : 'cursor-default'}`}
      >
        {label}
      </button>
      {open && canEdit ? (
        <div
          ref={panelRef}
          className={`absolute right-0 z-40 w-56 rounded-[16px] bg-white p-3.5 text-left shadow-xl ring-1 ring-black/5 ${
            placeAbove ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {hasDay ? 'Allocated time' : 'Share of the day'}
          </p>
          {hasDay ? (
            <div className="flex items-end gap-2">
              <label className="flex-1">
                <span className="mb-1 block text-[11px] font-medium text-gray-500">Hours</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  value={hoursDraft}
                  onFocus={(event) => {
                    replaceHoursRef.current = true;
                    event.currentTarget.select();
                  }}
                  onMouseUp={(event) => event.preventDefault()}
                  onChange={(event) => {
                    const digits = takeTypedDigits(hoursDraft, event.target.value, replaceHoursRef.current).slice(0, 2);
                    replaceHoursRef.current = false;
                    setHoursDraft(digits);
                    const typed = Number(digits || '0');
                    if (digits.length > 0 && (digits.length >= 2 || typed * 10 > maxHours)) {
                      focusMinutes();
                    }
                  }}
                  onKeyDown={onKeyDown}
                  className={fieldClass}
                />
              </label>
              <span className="pb-3 text-lg font-semibold text-gray-400">:</span>
              <label className="flex-1">
                <span className="mb-1 block text-[11px] font-medium text-gray-500">Minutes</span>
                <input
                  ref={minutesRef}
                  type="text"
                  inputMode="numeric"
                  value={minutesDraft}
                  onFocus={(event) => {
                    replaceMinutesRef.current = true;
                    event.currentTarget.select();
                  }}
                  onMouseUp={(event) => event.preventDefault()}
                  onChange={(event) => {
                    const digits = takeTypedDigits(minutesDraft, event.target.value, replaceMinutesRef.current).slice(0, 2);
                    replaceMinutesRef.current = false;
                    setMinutesDraft(digits);
                  }}
                  onKeyDown={onKeyDown}
                  className={fieldClass}
                />
              </label>
            </div>
          ) : (
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-500">Percent</span>
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                value={percentDraft}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setPercentDraft(event.target.value.replace(/[^\d]/g, ''))}
                onKeyDown={onKeyDown}
                className={fieldClass}
              />
            </label>
          )}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button type="button" className="btn btn-ghost btn-sm rounded-full px-3" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm rounded-full px-3" onClick={commit}>
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </span>
  );
};

export default AllocationTimeBadge;
