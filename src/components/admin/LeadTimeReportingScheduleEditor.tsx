import React, { useMemo, useState } from 'react';
import {
  DEFAULT_LEAD_TIME_REPORTING_WEEKDAYS,
  normalizeLeadTimeReportingWeekdays,
  type LeadTimeReportingSchedule,
} from '../../lib/employeeLeadReporting';
import { parseDateKeyLocal } from '../../lib/employeeClockInFormat';

const WEEKDAY_LABELS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
] as const;

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function monthMatrix(year: number, monthIndex: number): (string | null)[] {
  const first = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const startPad = first.getDay(); // Sun=0
  const cells: (string | null)[] = [];
  for (let i = 0; i < startPad; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(toIsoDate(new Date(year, monthIndex, day)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export type LeadTimeReportingScheduleEditorProps = {
  value: any;
  onChange: (value: LeadTimeReportingSchedule) => void;
  record?: Record<string, any> | null;
  readOnly?: boolean;
};

/**
 * Weekday toggles + month calendar for excluded fill dates.
 * Value shape: { weekdays: number[], excluded_dates: string[] }
 */
const LeadTimeReportingScheduleEditor: React.FC<LeadTimeReportingScheduleEditorProps> = ({
  value,
  onChange,
  readOnly = false,
}) => {
  const schedule: LeadTimeReportingSchedule = useMemo(() => {
    const weekdays = normalizeLeadTimeReportingWeekdays(
      value?.weekdays ?? value?.lead_time_reporting_weekdays,
    );
    const excludedRaw = value?.excluded_dates ?? value?.lead_time_reporting_excluded_dates ?? [];
    const excluded_dates = Array.isArray(excludedRaw)
      ? excludedRaw.map((d) => String(d).slice(0, 10)).filter(Boolean)
      : [];
    return { weekdays, excluded_dates };
  }, [value]);

  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const excludedSet = useMemo(
    () => new Set(schedule.excluded_dates),
    [schedule.excluded_dates],
  );

  const cells = useMemo(
    () => monthMatrix(cursor.year, cursor.month),
    [cursor.year, cursor.month],
  );

  const monthLabel = useMemo(
    () =>
      new Date(cursor.year, cursor.month, 1).toLocaleDateString('en-GB', {
        month: 'long',
        year: 'numeric',
      }),
    [cursor.year, cursor.month],
  );

  const emit = (next: LeadTimeReportingSchedule) => {
    onChange({
      weekdays: normalizeLeadTimeReportingWeekdays(next.weekdays),
      excluded_dates: [...new Set(next.excluded_dates.map((d) => d.slice(0, 10)))].sort(),
    });
  };

  const toggleWeekday = (day: number) => {
    if (readOnly) return;
    const has = schedule.weekdays.includes(day);
    const weekdays = has
      ? schedule.weekdays.filter((d) => d !== day)
      : [...schedule.weekdays, day].sort((a, b) => a - b);
    emit({ ...schedule, weekdays });
  };

  const toggleExcludedDate = (iso: string) => {
    if (readOnly) return;
    const next = new Set(excludedSet);
    if (next.has(iso)) next.delete(iso);
    else next.add(iso);
    emit({ ...schedule, excluded_dates: Array.from(next).sort() });
  };

  const shiftMonth = (delta: number) => {
    setCursor((prev) => {
      const date = new Date(prev.year, prev.month + delta, 1);
      return { year: date.getFullYear(), month: date.getMonth() };
    });
  };

  return (
    <div className="space-y-4 rounded-xl border border-base-300/70 bg-base-100/80 p-3">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/55">
          Required weekdays
        </p>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAY_LABELS.map(({ value: day, label }) => {
            const active = schedule.weekdays.includes(day);
            return (
              <button
                key={day}
                type="button"
                disabled={readOnly}
                onClick={() => toggleWeekday(day)}
                className={`btn btn-xs rounded-full px-3 ${
                  active ? 'btn-primary' : 'btn-ghost border border-base-300'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-base-content/50">
          Default: Sun–Thu (excludes Friday & Saturday), from 6 Aug 2026 onward.
        </p>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-base-content/55">
            Exclude specific dates
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              disabled={readOnly}
              onClick={() => shiftMonth(-1)}
            >
              ‹
            </button>
            <span className="min-w-[8.5rem] text-center text-xs font-medium">{monthLabel}</span>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              disabled={readOnly}
              onClick={() => shiftMonth(1)}
            >
              ›
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-base-content/45">
          {WEEKDAY_LABELS.map(({ label }) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((iso, index) => {
            if (!iso) return <span key={`empty-${index}`} className="h-8" />;
            const dayNum = parseDateKeyLocal(iso).getDate();
            const weekday = parseDateKeyLocal(iso).getDay();
            const requiredByWeekday = schedule.weekdays.includes(weekday);
            const excluded = excludedSet.has(iso);
            return (
              <button
                key={iso}
                type="button"
                disabled={readOnly}
                title={
                  excluded
                    ? 'Excluded — click to require again'
                    : requiredByWeekday
                      ? 'Required fill day — click to exclude'
                      : 'Off by weekday — click to exclude anyway'
                }
                onClick={() => toggleExcludedDate(iso)}
                className={`h-8 rounded-lg text-xs transition ${
                  excluded
                    ? 'bg-rose-500/20 font-semibold text-rose-800 ring-1 ring-rose-400/50'
                    : requiredByWeekday
                      ? 'bg-emerald-500/15 font-medium text-emerald-900 hover:bg-emerald-500/25'
                      : 'bg-base-200/70 text-base-content/45 hover:bg-base-300/60'
                }`}
              >
                {dayNum}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-base-content/50">
          Green = fill required · Red = excluded · Grey = off by weekday.
          {schedule.excluded_dates.length > 0
            ? ` ${schedule.excluded_dates.length} excluded date(s).`
            : ''}
        </p>
      </div>
    </div>
  );
};

export function defaultLeadTimeReportingSchedule(): LeadTimeReportingSchedule {
  return {
    weekdays: [...DEFAULT_LEAD_TIME_REPORTING_WEEKDAYS],
    excluded_dates: [],
  };
}

export default LeadTimeReportingScheduleEditor;
