import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BriefcaseIcon, PlusIcon } from '@heroicons/react/24/outline';
import {
  dailyAllocationGrandTotal,
  buildClientRouteFromAllocationRow,
  formatAllocationPercent,
  formatAllocationWorkedDuration,
  allocationPercentToWorkedMs,
  maxLeadAllocationPercent,
  minLeadAllocationPercent,
  setLeadAllocationPercent,
  setOtherWorkAllocationPercent,
  toggleLeadAllocationIncluded,
  type LeadAllocationRowState,
} from '../../lib/employeeLeadReporting';
import type { LeadAllocationBudgetHint } from '../../lib/leadAllocationBudget';
import { formatBudgetAllocationDuration } from '../../lib/leadAllocationBudget';

export type LeadAllocationRow = LeadAllocationRowState;

export type LeadAllocationChangeState = {
  rows: LeadAllocationRow[];
  otherWorkPercent: number;
};

type LeadAllocationSlidersProps = {
  rows: LeadAllocationRow[];
  otherWorkPercent: number;
  onChange: (state: LeadAllocationChangeState) => void;
  onAddLead?: () => void;
  readOnly?: boolean;
  /** Total clocked-in ms for the work day; used to show allocated time next to %. */
  dayWorkedMs?: number;
  /** Cap for Other Work slider (30% at/below base, 10% with overtime). */
  otherWorkMaxPercent?: number;
  /** Per-lead cost-budget hints (14% of 87% of lead value). */
  budgetHintsByKey?: Record<string, LeadAllocationBudgetHint>;
  onApplyLeadMaxBudget?: (leadKey: string, maxAllowedPercent: number) => void;
};

const ALLOCATION_RANGE_CLASS =
  'allocation-range range flex-1 cursor-grab active:cursor-grabbing';

const TIME_BADGE_CLASS =
  'inline-flex items-center rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 px-2.5 py-0.5 text-base font-semibold tabular-nums text-white shadow-sm';

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

function workedMsToAllocationPercent(totalWorkedMs: number, workedMs: number): number {
  if (!(totalWorkedMs > 0)) return 0;
  return Math.round((Math.max(0, workedMs) / totalWorkedMs) * 100);
}

type AllocationPercentDisplayProps = {
  value: number;
  onChange: (percent: number) => void;
  readOnly?: boolean;
  dayWorkedMs?: number;
  maxPercent?: number;
  minPercent?: number;
};

function AllocationPercentDisplay({
  value,
  onChange,
  readOnly = false,
  dayWorkedMs = 0,
  maxPercent = 100,
  minPercent = 0,
}: AllocationPercentDisplayProps) {
  const [editingTime, setEditingTime] = useState(false);
  const [placeAbove, setPlaceAbove] = useState(false);
  const [hoursDraft, setHoursDraft] = useState('0');
  const [minutesDraft, setMinutesDraft] = useState('0');
  const badgeRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const minutesRef = useRef<HTMLInputElement | null>(null);
  const displayed = formatAllocationPercent(value);
  const clampedMax = Math.max(0, Math.min(100, Math.round(maxPercent)));
  const clampedMin = Math.max(0, Math.min(clampedMax, Math.round(minPercent)));
  const allocatedMs =
    dayWorkedMs > 0 ? allocationPercentToWorkedMs(dayWorkedMs, value) : 0;
  const allocatedLabel =
    dayWorkedMs > 0 ? formatAllocationWorkedDuration(allocatedMs) : null;
  const maxAllowedMs = allocationPercentToWorkedMs(dayWorkedMs, clampedMax);
  const minAllowedMs = allocationPercentToWorkedMs(dayWorkedMs, clampedMin);
  const maxHours = Math.floor(maxAllowedMs / 3_600_000);
  const canEdit = !readOnly && dayWorkedMs > 0;

  useEffect(() => {
    if (editingTime) return;
    const parts = msToHoursMinutes(allocatedMs);
    setHoursDraft(String(parts.hours));
    setMinutesDraft(String(parts.minutes));
  }, [allocatedMs, editingTime]);

  useEffect(() => {
    if (!editingTime) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (badgeRef.current?.contains(target)) return;
      setEditingTime(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [editingTime]);

  const startEditTime = () => {
    if (!canEdit) return;
    const parts = msToHoursMinutes(allocatedMs);
    setHoursDraft(String(parts.hours));
    setMinutesDraft(String(parts.minutes));
    // Flip above the badge when the row sits low on screen, so the popover stays reachable.
    const rect = badgeRef.current?.getBoundingClientRect();
    setPlaceAbove(Boolean(rect && window.innerHeight - rect.bottom < 190));
    setEditingTime(true);
  };

  const commitTime = () => {
    const hours = Math.max(0, Math.round(Number(hoursDraft)) || 0);
    const minutes = Math.max(0, Math.min(59, Math.round(Number(minutesDraft)) || 0));
    const nextMs = hoursMinutesToMs(hours, minutes);
    const nextPercent = workedMsToAllocationPercent(dayWorkedMs, nextMs);
    onChange(Math.max(clampedMin, Math.min(clampedMax, nextPercent)));
    setEditingTime(false);
  };

  const handleHoursChange = (raw: string) => {
    const digits = raw.replace(/[^\d]/g, '');
    setHoursDraft(digits);
    // Once no further digit could fit under the day's max, jump straight to minutes.
    const typed = Number(digits || '0');
    if (digits.length > 0 && (digits.length >= 2 || typed * 10 > maxHours)) {
      minutesRef.current?.focus();
      minutesRef.current?.select();
    }
  };

  const timeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitTime();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setEditingTime(false);
    }
  };

  const timeInputClass =
    'input input-bordered h-11 w-full min-h-11 rounded-[12px] px-2 text-center text-lg font-semibold tabular-nums text-gray-800';

  return (
    <span className="relative inline-flex min-w-[5.5rem] shrink-0 items-center justify-end whitespace-nowrap text-sm font-semibold text-gray-800">
      {displayed}%
      {allocatedLabel == null ? null : (
        <button
          ref={badgeRef}
          type="button"
          disabled={!canEdit}
          onClick={startEditTime}
          className={`${TIME_BADGE_CLASS} ml-2 ${
            canEdit
              ? 'cursor-pointer transition hover:brightness-105 active:scale-[0.98]'
              : 'cursor-default'
          }`}
          title={canEdit ? 'Click to edit allocated time' : undefined}
        >
          {allocatedLabel}
        </button>
      )}

      {editingTime && canEdit ? (
        <div
          ref={popoverRef}
          className={`absolute right-0 z-30 w-56 rounded-[16px] bg-white p-3.5 text-left shadow-xl ring-1 ring-black/5 ${
            placeAbove ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Allocated time
          </p>
          <div className="flex items-end gap-2">
            <label className="flex-1">
              <span className="mb-1 block text-[11px] font-medium text-gray-500">Hours</span>
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                value={hoursDraft}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => handleHoursChange(e.target.value)}
                onKeyDown={timeKeyDown}
                className={timeInputClass}
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
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setMinutesDraft(e.target.value.replace(/[^\d]/g, ''))}
                onKeyDown={timeKeyDown}
                className={timeInputClass}
              />
            </label>
          </div>
          <p className="mt-2 text-[11px] text-gray-500">
            {minAllowedMs > 0
              ? `${formatAllocationWorkedDuration(minAllowedMs)} – ${formatAllocationWorkedDuration(maxAllowedMs)} available`
              : `Up to ${formatAllocationWorkedDuration(maxAllowedMs)} available`}
          </p>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm rounded-full px-3"
              onClick={() => setEditingTime(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm rounded-full px-4"
              onClick={commitTime}
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </span>
  );
}

type AllocationPercentSliderProps = {
  value: number;
  onChange: (percent: number) => void;
  variant?: 'primary' | 'neutral';
  readOnly?: boolean;
  dayWorkedMs?: number;
  maxPercent?: number;
  minPercent?: number;
  /**
   * Lead limits shift while dragging, so their tracks stay on a plain 0–100 scale and the thumb
   * simply stops at the limit instead of rescaling the bar under the user's finger.
   */
  fullRangeTrack?: boolean;
};

function AllocationPercentSlider({
  value,
  onChange,
  variant = 'primary',
  readOnly = false,
  dayWorkedMs = 0,
  maxPercent = 100,
  minPercent = 0,
  fullRangeTrack = false,
}: AllocationPercentSliderProps) {
  const clampedMax = Math.max(0, Math.min(100, Math.round(maxPercent)));
  const clampedMin = Math.max(0, Math.min(clampedMax, Math.round(minPercent)));
  const roundedValue = Math.min(Math.max(Math.round(value), clampedMin), clampedMax);

  return (
    <div className="flex min-w-[240px] flex-1 max-w-lg items-center gap-4 py-1">
      <input
        type="range"
        min={fullRangeTrack ? 0 : clampedMin}
        max={fullRangeTrack ? 100 : clampedMax}
        step={1}
        value={roundedValue}
        disabled={readOnly}
        onChange={(e) => onChange(Math.round(Number(e.target.value)))}
        className={`${ALLOCATION_RANGE_CLASS} ${variant === 'neutral' ? 'range-neutral' : 'range-primary'} ${
          readOnly ? 'pointer-events-none opacity-60' : ''
        }`}
      />
      <AllocationPercentDisplay
        value={roundedValue}
        onChange={onChange}
        readOnly={readOnly}
        dayWorkedMs={dayWorkedMs}
        maxPercent={clampedMax}
        minPercent={clampedMin}
      />
    </div>
  );
}

function formatViewedAt(iso?: string): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

const LeadAllocationSliders: React.FC<LeadAllocationSlidersProps> = ({
  rows,
  otherWorkPercent,
  onChange,
  onAddLead,
  readOnly = false,
  dayWorkedMs = 0,
  otherWorkMaxPercent = 100,
  budgetHintsByKey = {},
  onApplyLeadMaxBudget,
}) => {
  const includedRows = rows.filter((row) => row.included);
  const grandTotal = dailyAllocationGrandTotal(includedRows, otherWorkPercent);
  const isTotalValid = Math.abs(grandTotal - 100) <= 0.01;
  const otherWorkCap = Math.max(0, Math.min(100, Math.round(otherWorkMaxPercent)));

  const applyChange = (next: LeadAllocationChangeState) => {
    onChange(next);
  };

  const setOtherWork = (percent: number) => {
    applyChange(setOtherWorkAllocationPercent(rows, percent, otherWorkCap));
  };

  const setIncluded = (key: string, included: boolean) => {
    applyChange(toggleLeadAllocationIncluded(rows, key, included, otherWorkCap));
  };

  const setLeadPercent = (key: string, percent: number) => {
    applyChange(setLeadAllocationPercent(rows, key, percent, otherWorkCap));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-white px-5 py-3.5 shadow-sm">
        <p className="text-sm text-gray-600">
          Allocate your day across other work and leads.
          {dayWorkedMs > 0 ? (
            <span className="ml-1 text-gray-400">
              · Clocked {formatAllocationWorkedDuration(dayWorkedMs)} today
            </span>
          ) : null}
        </p>
        <div
          className={`inline-flex items-center gap-2.5 rounded-full pl-2.5 pr-4 py-1.5 shadow-sm ${
            isTotalValid
              ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white'
              : 'bg-gradient-to-r from-amber-400 to-orange-500 text-white'
          }`}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-xs font-bold">
            {isTotalValid ? '✓' : '!'}
          </span>
          <span className="leading-tight">
            <span className="block text-[10px] font-semibold uppercase tracking-wider opacity-90">
              Total
            </span>
            <span className="text-base font-bold">
              {formatAllocationPercent(grandTotal)}%
            </span>
          </span>
        </div>
      </div>

      <div className="rounded-[18px] bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3.5 flex-1 min-w-[220px]">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600">
              <BriefcaseIcon className="w-7 h-7" aria-hidden />
            </span>
            <span>
              <span className="font-semibold text-gray-900">Other work</span>
              <span className="block text-xs text-gray-500 mt-1">
                Tasks not tied to a specific lead
                {otherWorkCap < 100 ? (
                  <>
                    {' '}
                    · Max {otherWorkCap}% when{' '}
                    {otherWorkCap <= 10 ? 'over base hours' : 'at or below base hours'}, so leads
                    must cover at least {100 - otherWorkCap}%
                  </>
                ) : null}
              </span>
            </span>
          </div>
          <AllocationPercentSlider
            value={otherWorkPercent}
            onChange={setOtherWork}
            variant="neutral"
            readOnly={readOnly}
            dayWorkedMs={dayWorkedMs}
            maxPercent={otherWorkCap}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-[18px] border border-dashed border-gray-200 bg-white px-5 py-6 text-center text-sm text-gray-600 shadow-sm space-y-3">
          <p>
            No leads recorded for this day yet. You can still save 100% as other work, search for a lead
            to add, or open leads from the Clients page.
          </p>
          {onAddLead && !readOnly && (
            <button type="button" className="btn btn-outline btn-primary btn-sm" onClick={onAddLead}>
              <PlusIcon className="w-4 h-4" />
              Add lead
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3 px-1">
            <h3 className="text-sm font-semibold text-gray-700">Leads you opened</h3>
            {onAddLead && !readOnly && (
              <button
                type="button"
                className="btn btn-ghost btn-sm h-8 min-h-8 gap-1.5 rounded-full bg-white px-3 text-primary shadow-sm hover:bg-gray-50"
                onClick={onAddLead}
              >
                <PlusIcon className="w-4 h-4" />
                Add lead
              </button>
            )}
          </div>
          {rows.map((row) => {
            const route = buildClientRouteFromAllocationRow(row);
            const viewedLabel = formatViewedAt(row.last_viewed_at);
            const budgetHint = budgetHintsByKey[row.key];
            const overBudget = Boolean(row.included && budgetHint?.overBudget);
            return (
              <div
                key={row.key}
                className={`rounded-[18px] bg-white px-5 py-4 shadow-sm transition-all ${
                  overBudget
                    ? 'ring-2 ring-amber-300/80'
                    : row.included
                      ? row.pinned
                        ? 'ring-2 ring-primary/20'
                        : 'ring-2 ring-primary/15'
                      : 'opacity-80'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <label className={`flex items-start gap-3 flex-1 min-w-[220px] ${readOnly ? '' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      className="checkbox checkbox-primary mt-1"
                      checked={row.included}
                      disabled={readOnly}
                      onChange={(e) => setIncluded(row.key, e.target.checked)}
                    />
                    <span>
                      {route ? (
                        <Link to={route} className="font-semibold text-primary hover:underline">
                          #{row.lead_number}
                        </Link>
                      ) : (
                        <span className="font-semibold text-gray-900">#{row.lead_number}</span>
                      )}
                      <span className="text-gray-700 ml-2">{row.client_name}</span>
                      {(row.view_count != null || viewedLabel) && (
                        <span className="block text-xs text-gray-400 mt-1">
                          {row.view_count != null
                            ? `${row.view_count} view${row.view_count === 1 ? '' : 's'}`
                            : ''}
                          {row.view_count != null && viewedLabel ? ' · ' : ''}
                          {viewedLabel ? `Last ${viewedLabel}` : ''}
                        </span>
                      )}
                      {overBudget && budgetHint ? (
                        <span className="mt-1.5 block text-xs font-medium text-amber-700">
                          Over budget
                          {budgetHint.remainingWorkedMs != null ? (
                            <>
                              {' '}
                              —{' '}
                              <span className="font-semibold">
                                {formatAllocationWorkedDuration(budgetHint.remainingWorkedMs)}
                              </span>{' '}
                              left on lead
                            </>
                          ) : null}
                          {' · '}
                          max{' '}
                          {budgetHint.maxAllowedPercent > 0 &&
                          budgetHint.maxAllowedPercent < 1
                            ? budgetHint.maxAllowedPercent.toFixed(2)
                            : formatAllocationPercent(budgetHint.maxAllowedPercent)}
                          %
                          {budgetHint.maxAllocatedMs > 0
                            ? ` (${formatBudgetAllocationDuration(budgetHint.maxAllocatedMs)})`
                            : ' (0m)'}{' '}
                          today
                          {!readOnly && onApplyLeadMaxBudget ? (
                            <>
                              {' · '}
                              <button
                                type="button"
                                className="underline hover:text-amber-900"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onApplyLeadMaxBudget(row.key, budgetHint.maxAllowedPercent);
                                }}
                              >
                                Set to max
                              </button>
                            </>
                          ) : null}
                        </span>
                      ) : budgetHint &&
                        row.included &&
                        row.percent > 0 &&
                        budgetHint.remainingWorkedMs != null &&
                        !budgetHint.overBudget ? (
                        <span className="mt-1.5 block text-xs text-gray-500">
                          <span className="font-medium text-gray-700">
                            {formatAllocationWorkedDuration(budgetHint.remainingWorkedMs)}
                          </span>{' '}
                          left on lead
                          {budgetHint.leadWorkedMs > 0 ? (
                            <>
                              {' '}
                              · spent{' '}
                              {formatAllocationWorkedDuration(budgetHint.leadWorkedMs)}
                            </>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                  </label>

                  {row.included && (
                    <AllocationPercentSlider
                      value={row.percent}
                      onChange={(percent) => setLeadPercent(row.key, percent)}
                      readOnly={readOnly}
                      dayWorkedMs={dayWorkedMs}
                      minPercent={minLeadAllocationPercent(rows, row.key, otherWorkCap)}
                      maxPercent={maxLeadAllocationPercent(rows, row.key)}
                      fullRangeTrack
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <style>{`
        .allocation-range {
          --range-thumb: #ffffff;
          --range-thumb-size: 1.125rem;
          --range-bg: #e8ecf0;
          --range-p: 3px;
          --radius-selector: 9999px;
          width: 100%;
          touch-action: pan-x;
        }
        .allocation-range.range-primary {
          --range-bg: #dbe4f5;
          color: var(--color-primary);
        }
        .allocation-range.range-neutral {
          --range-bg: #e5e7eb;
          color: #64748b;
        }
        .allocation-range::-webkit-slider-runnable-track {
          box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.06);
        }
        .allocation-range::-moz-range-track {
          box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.06);
        }
        .allocation-range::-webkit-slider-thumb {
          border-radius: 9999px;
          transition:
            transform 0.22s cubic-bezier(0.4, 0, 0.2, 1),
            filter 0.22s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .allocation-range:hover::-webkit-slider-thumb {
          transform: translateY(-50%) scale(1.05);
          filter: drop-shadow(0 2px 5px rgba(15, 23, 42, 0.18));
        }
        .allocation-range:active::-webkit-slider-thumb {
          transform: translateY(-50%) scale(1.08);
          filter: drop-shadow(0 3px 8px rgba(15, 23, 42, 0.22));
        }
        .allocation-range::-moz-range-thumb {
          border-radius: 9999px;
          transition:
            transform 0.22s cubic-bezier(0.4, 0, 0.2, 1),
            filter 0.22s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .allocation-range:hover::-moz-range-thumb {
          transform: scale(1.05);
          filter: drop-shadow(0 2px 5px rgba(15, 23, 42, 0.18));
        }
        .allocation-range:active::-moz-range-thumb {
          transform: scale(1.08);
          filter: drop-shadow(0 3px 8px rgba(15, 23, 42, 0.22));
        }
        .allocation-range:focus-visible {
          outline: 2px solid color-mix(in oklab, currentColor 35%, transparent);
          outline-offset: 3px;
        }
      `}</style>
    </div>
  );
};

export default LeadAllocationSliders;
