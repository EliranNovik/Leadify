import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { BriefcaseIcon, ChevronDownIcon, ClockIcon, PlusIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import { fetchSubEffortsForMiscCategory } from '../../lib/leadSubEfforts';
import {
  allocationOverflowPercent,
  dailyAllocationGrandTotal,
  buildClientRouteFromAllocationRow,
  formatAllocationPercent,
  formatAllocationWorkedDuration,
  allocationPercentToWorkedMs,
  snapAllocationPercent,
  setLeadAllocationPercentDraft,
  setOtherWorkAllocationPercentDraft,
  setAllLeadsIncludedDraft,
  toggleLeadAllocationIncludedDraft,
  type LeadAllocationRowState,
} from '../../lib/employeeLeadReporting';
import type { LeadAllocationBudgetHint } from '../../lib/leadAllocationBudget';
import { formatBudgetAllocationDuration } from '../../lib/leadAllocationBudget';
import {
  getSoftStageBadgeStyle,
  getStageColour,
  getStageName,
} from '../../lib/stageUtils';

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
  /** Share of the whole day, Handling plus every other area. */
  dayTotalPercent?: number;
  /** Lead keys that had a meeting this day, and how to label it. */
  meetingMarkByKey?: Record<string, 'meeting' | 'no_show' | 'away'>;
  onSubEffortsChange?: (key: string, ids: number[]) => void;
};

const ALLOCATION_RANGE_CLASS =
  'allocation-range range min-w-0 flex-1 cursor-grab active:cursor-grabbing';

const TIME_BADGE_CLASS =
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums';
const TIME_BADGE_ACTIVE_CLASS = 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-sm';
const TIME_BADGE_EMPTY_CLASS = 'bg-gray-100 text-gray-400';

const subEffortOptionsCache = new Map<number, { id: number; name: string }[]>();

function AllocationSubEffortsField({
  categoryId,
  selectedIds,
  readOnly,
  onChange,
}: {
  categoryId: number | null;
  selectedIds: number[];
  readOnly: boolean;
  onChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<{ id: number; name: string }[]>(
    categoryId ? subEffortOptionsCache.get(categoryId) ?? [] : [],
  );
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (!categoryId) {
      setOptions([]);
      return;
    }
    const cached = subEffortOptionsCache.get(categoryId);
    if (cached) {
      setOptions(cached);
      return;
    }
    let cancelled = false;
    void fetchSubEffortsForMiscCategory(supabase, categoryId)
      .then((items) => {
        const next = items.map((item) => ({ id: item.id, name: item.name }));
        subEffortOptionsCache.set(categoryId, next);
        if (!cancelled) setOptions(next);
      })
      .catch((error) => {
        console.error('[AllocationSubEffortsField] catalog failed:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  useEffect(() => {
    if (!open) return;
    const placeMenu = () => {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const width = Math.max(rect.width, 256);
      const gap = 4;
      const estimatedHeight = 256;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openAbove = spaceBelow < 180 && rect.top > spaceBelow;
      setMenuStyle({
        position: 'fixed',
        left: Math.min(rect.left, window.innerWidth - width - 8),
        width,
        top: openAbove ? undefined : rect.bottom + gap,
        bottom: openAbove ? window.innerHeight - rect.top + gap : undefined,
        maxHeight: openAbove
          ? Math.max(120, rect.top - gap - 8)
          : Math.max(120, Math.min(estimatedHeight, spaceBelow - gap - 8)),
        zIndex: 80,
      });
    };
    placeMenu();
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('resize', placeMenu);
    window.addEventListener('scroll', placeMenu, true);
    document.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('resize', placeMenu);
      window.removeEventListener('scroll', placeMenu, true);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const names = new Map(options.map((option) => [option.id, option.name]));
  const chosen = selectedIds.map((id) => names.get(id) || `Sub effort #${id}`);
  const summary = chosen.length === 0 ? 'Choose' : chosen.length === 1 ? chosen[0] : `${chosen[0]} +${chosen.length - 1}`;

  const toggle = (id: number) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  };

  return (
    <div className="min-w-0">
      <button
        ref={buttonRef}
        type="button"
        disabled={readOnly || !categoryId}
        aria-expanded={open}
        title={chosen.length > 0 ? chosen.join(', ') : categoryId ? 'Choose sub efforts' : 'This lead has no category'}
        className="inline-flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-[12px] bg-gray-50 px-2.5 text-left text-sm text-gray-800 ring-1 ring-gray-200 hover:bg-white disabled:opacity-60"
        onClick={() => setOpen((current) => !current)}
      >
        <span className={`truncate ${chosen.length === 0 ? 'text-gray-400' : ''}`}>{summary}</span>
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
      </button>
      {open && !readOnly && menuStyle
        ? createPortal(
            <ul
              ref={menuRef}
              style={menuStyle}
              className="overflow-y-auto rounded-2xl bg-white p-1 shadow-xl ring-1 ring-black/10"
            >
              {options.length === 0 ? (
                <li className="px-2 py-1.5 text-sm text-gray-400">No sub efforts for this category.</li>
              ) : (
                options.map((option) => (
                  <li key={option.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-gray-50">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-primary checkbox-xs"
                        checked={selectedIds.includes(option.id)}
                        onChange={() => toggle(option.id)}
                      />
                      <span className="min-w-0 truncate">{option.name}</span>
                    </label>
                  </li>
                ))
              )}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
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

function workedMsToAllocationPercent(totalWorkedMs: number, workedMs: number): number {
  if (!(totalWorkedMs > 0)) return 0;
  return (Math.max(0, workedMs) / totalWorkedMs) * 100;
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
  const replaceHoursRef = useRef(true);
  const replaceMinutesRef = useRef(true);
  const displayed = formatAllocationPercent(value);
  const clampedMax = Math.max(0, Math.min(100, maxPercent));
  const clampedMin = Math.max(0, Math.min(clampedMax, minPercent));
  const allocatedMs =
    dayWorkedMs > 0 ? allocationPercentToWorkedMs(dayWorkedMs, value) : 0;
  const allocatedLabel = formatAllocationWorkedDuration(allocatedMs);
  const showTimeBadge = dayWorkedMs > 0;
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
    const nextPercent = snapAllocationPercent(
      workedMsToAllocationPercent(dayWorkedMs, nextMs),
      dayWorkedMs,
      clampedMin,
      clampedMax,
    );
    onChange(nextPercent);
    setEditingTime(false);
  };

  const handleHoursChange = (raw: string) => {
    const digits = takeTypedDigits(hoursDraft, raw, replaceHoursRef.current).slice(0, 2);
    replaceHoursRef.current = false;
    setHoursDraft(digits);
    // Once no further digit could fit under the day's max, jump straight to minutes.
    const typed = Number(digits || '0');
    if (digits.length > 0 && (digits.length >= 2 || typed * 10 > maxHours)) {
      window.requestAnimationFrame(() => {
        minutesRef.current?.focus();
        minutesRef.current?.select();
      });
    }
  };

  const handleMinutesChange = (raw: string) => {
    const digits = takeTypedDigits(minutesDraft, raw, replaceMinutesRef.current).slice(0, 2);
    replaceMinutesRef.current = false;
    setMinutesDraft(digits);
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
    <span className="relative inline-flex shrink-0 items-center justify-end gap-2 whitespace-nowrap">
      <span className="text-xs font-semibold tabular-nums text-gray-600">{displayed}%</span>
      {showTimeBadge ? (
        <button
          ref={badgeRef}
          type="button"
          disabled={!canEdit}
          onClick={startEditTime}
          className={`${TIME_BADGE_CLASS} ${
            allocatedMs > 0 ? TIME_BADGE_ACTIVE_CLASS : TIME_BADGE_EMPTY_CLASS
          } ${
            canEdit
              ? 'cursor-pointer transition hover:brightness-105 active:scale-[0.98]'
              : 'cursor-default'
          }`}
          title={canEdit ? 'Click to edit allocated time' : undefined}
        >
          {allocatedLabel}
        </button>
      ) : null}

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
                onFocus={(e) => {
                  replaceHoursRef.current = true;
                  e.currentTarget.select();
                }}
                onMouseUp={(e) => e.preventDefault()}
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
                onFocus={(e) => {
                  replaceMinutesRef.current = true;
                  e.currentTarget.select();
                }}
                onMouseUp={(e) => e.preventDefault()}
                onChange={(e) => handleMinutesChange(e.target.value)}
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
  className?: string;
  /** Put % + time badge under the slider so they stay visible in tight columns. */
  stackDisplay?: boolean;
  /** Optional left-aligned content on the same row as % / time badge (stackDisplay only). */
  metaLeft?: React.ReactNode;
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
  className = 'flex min-w-[240px] flex-1 max-w-lg items-center gap-4 py-1',
  stackDisplay = false,
  metaLeft,
}: AllocationPercentSliderProps) {
  const clampedMax = Math.max(0, Math.min(100, maxPercent));
  const clampedMin = Math.max(0, Math.min(clampedMax, minPercent));
  const snappedValue = snapAllocationPercent(value, dayWorkedMs, clampedMin, clampedMax);

  const rangeInput = (
    <input
      type="range"
      min={fullRangeTrack ? 0 : clampedMin}
      max={fullRangeTrack ? 100 : clampedMax}
      step="any"
      value={snappedValue}
      disabled={readOnly}
      onChange={(e) => {
        const next = Number(e.target.value);
        if (!Number.isFinite(next)) return;
        onChange(snapAllocationPercent(next, dayWorkedMs, clampedMin, clampedMax));
      }}
      className={`${ALLOCATION_RANGE_CLASS} ${variant === 'neutral' ? 'range-neutral' : 'range-primary'} ${
        readOnly ? 'pointer-events-none opacity-60' : ''
      } ${stackDisplay ? '!w-full !flex-none' : ''}`}
    />
  );

  const percentDisplay = (
    <AllocationPercentDisplay
      value={snappedValue}
      onChange={(next) => {
        onChange(snapAllocationPercent(next, dayWorkedMs, clampedMin, clampedMax));
      }}
      readOnly={readOnly}
      dayWorkedMs={dayWorkedMs}
      maxPercent={clampedMax}
      minPercent={clampedMin}
    />
  );

  if (stackDisplay) {
    return (
      <div className="w-full min-w-0 space-y-1.5">
        {rangeInput}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1 text-left text-xs text-gray-400">
            {metaLeft || null}
          </div>
          <div className="shrink-0">{percentDisplay}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {rangeInput}
      {percentDisplay}
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

/** Shared column template so header + every lead row stay aligned. */
const LEAD_TABLE_GRID =
  'grid grid-cols-[2rem_minmax(7rem,1fr)_minmax(7rem,11rem)_minmax(7rem,10rem)_minmax(7rem,1fr)_minmax(18rem,26rem)] gap-x-3';

const LEAD_TABLE_HEADER_CELL =
  'flex items-center text-sm font-semibold tracking-wide text-gray-600';

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
  dayTotalPercent,
  meetingMarkByKey = {},
  onSubEffortsChange,
}) => {
  const includedRows = rows.filter((row) => row.included);
  const allSelected = rows.length > 0 && includedRows.length === rows.length;
  const someSelected = includedRows.length > 0 && !allSelected;
  const grandTotal = dailyAllocationGrandTotal(includedRows, otherWorkPercent);
  const shownTotal = dayTotalPercent ?? grandTotal;
  const isTotalValid = Math.abs(shownTotal - 100) <= 0.01;
  /*
   * Over 100% is a different thing from under it: under, saving balances the day up, while over is
   * refused — so it gets its own colour and label instead of the amber "will balance".
   */
  const overAllocatedBy = allocationOverflowPercent(includedRows, otherWorkPercent);
  const isOverAllocated =
    dayTotalPercent != null ? shownTotal > 100.01 : overAllocatedBy > 0;
  const otherWorkCap = Math.max(0, Math.min(100, Math.round(otherWorkMaxPercent)));

  const applyChange = (next: LeadAllocationChangeState) => {
    onChange(next);
  };

  const setOtherWork = (percent: number) => {
    applyChange(setOtherWorkAllocationPercentDraft(rows, percent, otherWorkCap));
  };

  const setIncluded = (key: string, included: boolean) => {
    applyChange(
      toggleLeadAllocationIncludedDraft(rows, otherWorkPercent, key, included, otherWorkCap),
    );
  };

  const setAllIncluded = (included: boolean) => {
    applyChange(setAllLeadsIncludedDraft(rows, otherWorkPercent, included, otherWorkCap));
  };

  const setLeadPercent = (key: string, percent: number) => {
    applyChange(setLeadAllocationPercentDraft(rows, otherWorkPercent, key, percent));
  };

  return (
    <div className="space-y-0">
      <div className="grid grid-cols-1 items-stretch lg:grid-cols-2">
        <div className="flex flex-wrap items-center justify-start gap-2 border-b border-gray-100 px-5 py-3.5">
          {dayWorkedMs > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
              <ClockIcon className="h-4 w-4" />
              {formatAllocationWorkedDuration(dayWorkedMs)}
            </span>
          ) : null}
          <div
            className={`inline-flex items-center gap-2.5 rounded-full pl-2.5 pr-4 py-1.5 shadow-sm ${
              isOverAllocated
                ? 'bg-gradient-to-r from-rose-500 to-red-600 text-white'
                : isTotalValid
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white'
                  : 'bg-gradient-to-r from-amber-400 to-orange-500 text-white'
            }`}
            title={
              isOverAllocated
                ? `${formatAllocationPercent(shownTotal)}% allocated across every area — the maximum is 100%`
                : isTotalValid
                  ? 'Every area together is 100%'
                  : `Every area together is ${formatAllocationPercent(shownTotal)}%`
            }
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-xs font-bold">
              {isTotalValid ? '✓' : '!'}
            </span>
            <span className="leading-tight">
              <span className="block text-[10px] font-semibold uppercase tracking-wider opacity-90">
                {isOverAllocated ? 'Over the day' : 'Day total'}
              </span>
              <span className="text-base font-bold">
                {formatAllocationPercent(shownTotal)}%
              </span>
            </span>
          </div>
        </div>

        <div className="border-b border-gray-100 px-5 py-3.5 lg:border-l">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600">
                <BriefcaseIcon className="w-6 h-6" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="font-semibold text-gray-900">Other work</span>
              </span>
            </div>
            <AllocationPercentSlider
              value={Math.min(otherWorkPercent, otherWorkCap)}
              onChange={setOtherWork}
              variant="neutral"
              readOnly={readOnly}
              dayWorkedMs={dayWorkedMs}
              maxPercent={Math.min(
                otherWorkCap,
                otherWorkPercent + Math.max(0, 100 - shownTotal),
              )}
              minPercent={0}
              className="flex min-w-[200px] max-w-sm flex-1 items-center gap-3 py-0.5"
            />
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-6 text-center text-sm text-gray-600 space-y-3">
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
        <div className="space-y-2">
          <div className="px-5 py-1.5" role="row">
            <div className={`${LEAD_TABLE_GRID} items-center`}>
              <label
                className={`flex items-center justify-center ${readOnly || rows.length === 0 ? '' : 'cursor-pointer'}`}
              >
                <input
                  type="checkbox"
                  className="checkbox checkbox-primary checkbox-sm"
                  checked={allSelected}
                  disabled={readOnly || rows.length === 0}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={(e) => setAllIncluded(e.target.checked)}
                  aria-label="Select all leads"
                />
              </label>
              <span className={LEAD_TABLE_HEADER_CELL}>Lead</span>
              <span className={LEAD_TABLE_HEADER_CELL}>Category</span>
              <span className={LEAD_TABLE_HEADER_CELL}>Stage</span>
              <span className={LEAD_TABLE_HEADER_CELL}>Sub effort</span>
              <span className={`${LEAD_TABLE_HEADER_CELL} justify-between gap-2`}>
                <span>Allocation</span>
                {onAddLead && !readOnly ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                    onClick={onAddLead}
                  >
                    <PlusIcon className="w-4 h-4" />
                    Add lead
                  </button>
                ) : null}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto divide-y divide-gray-100">
            {rows.map((row) => {
              const route = buildClientRouteFromAllocationRow(row);
              const viewedLabel = formatViewedAt(row.last_viewed_at);
              const budgetHint = budgetHintsByKey[row.key];
              const overBudget = Boolean(row.included && budgetHint?.overBudget);
              const stageLabel = row.stage_id
                ? getStageName(row.stage_id) || row.stage_id
                : null;
              const hasViewMeta = row.view_count != null || Boolean(viewedLabel);

              return (
                <div
                  key={row.key}
                  className={`px-5 py-3.5 transition-colors ${
                    overBudget
                      ? 'bg-amber-50/70'
                      : row.included
                        ? 'bg-white'
                        : 'bg-gray-50/80 opacity-80'
                  }`}
                >
                  <div className={`${LEAD_TABLE_GRID} items-start`}>
                    <label
                      className={`flex items-center justify-center ${readOnly ? '' : 'cursor-pointer'}`}
                    >
                      <input
                        type="checkbox"
                        className="checkbox checkbox-primary checkbox-sm"
                        checked={row.included}
                        disabled={readOnly}
                        onChange={(e) => setIncluded(row.key, e.target.checked)}
                        aria-label={`Include lead ${row.lead_number}`}
                      />
                    </label>

                    <div className="min-w-0">
                      {route ? (
                        <Link
                          to={route}
                          className="font-semibold text-primary hover:underline tabular-nums"
                        >
                          #{row.lead_number}
                        </Link>
                      ) : (
                        <span className="font-semibold text-gray-900 tabular-nums">
                          #{row.lead_number}
                        </span>
                      )}
                      <span
                        className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-gray-600"
                        title={row.client_name}
                      >
                        <span className="truncate">{row.client_name}</span>
                        {meetingMarkByKey[row.key] === 'meeting' ? (
                          <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800">
                            Meeting
                          </span>
                        ) : meetingMarkByKey[row.key] === 'no_show' ? (
                          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                            No show
                          </span>
                        ) : meetingMarkByKey[row.key] === 'away' ? (
                          <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                            Didn't attend
                          </span>
                        ) : null}
                      </span>
                    </div>

                    <div className="min-w-0">
                      {row.category_main || row.category_sub ? (
                        <>
                          {row.category_main ? (
                            <span
                              className="block truncate text-sm font-medium text-gray-800"
                              title={row.category_main}
                            >
                              {row.category_main}
                            </span>
                          ) : null}
                          {row.category_sub ? (
                            <span
                              className="mt-0.5 block truncate text-sm text-gray-500"
                              title={row.category_sub}
                            >
                              {row.category_sub}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-sm text-gray-300">—</span>
                      )}
                    </div>

                    <div className="min-w-0">
                      {stageLabel && row.stage_id ? (
                        <span
                          className="inline-flex max-w-full truncate rounded-full px-3 py-1 text-sm font-semibold"
                          style={getSoftStageBadgeStyle(
                            getStageColour(String(row.stage_id)),
                            row.stage_id,
                          )}
                          title={stageLabel}
                        >
                          {stageLabel}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-300">—</span>
                      )}
                    </div>

                    <AllocationSubEffortsField
                      categoryId={row.category_id ?? null}
                      selectedIds={row.subEffortIds ?? []}
                      readOnly={readOnly}
                      onChange={(ids) => onSubEffortsChange?.(row.key, ids)}
                    />

                      <div className="min-w-0">
                      {row.included ? (
                        <AllocationPercentSlider
                          value={row.percent}
                          onChange={(percent) => setLeadPercent(row.key, percent)}
                          readOnly={readOnly}
                          dayWorkedMs={dayWorkedMs}
                          minPercent={0}
                          maxPercent={Math.min(
                            100,
                            row.percent + Math.max(0, 100 - shownTotal),
                          )}
                          fullRangeTrack
                          stackDisplay
                          metaLeft={
                            hasViewMeta ? (
                              <>
                                {row.view_count != null
                                  ? `${row.view_count} view${row.view_count === 1 ? '' : 's'}`
                                  : ''}
                                {row.view_count != null && viewedLabel ? ' · ' : ''}
                                {viewedLabel ? `Last ${viewedLabel}` : ''}
                              </>
                            ) : null
                          }
                        />
                      ) : (
                        <>
                          <span className="text-sm text-gray-300">—</span>
                          {hasViewMeta ? (
                            <span className="mt-1 block text-xs text-gray-400">
                              {row.view_count != null
                                ? `${row.view_count} view${row.view_count === 1 ? '' : 's'}`
                                : ''}
                              {row.view_count != null && viewedLabel ? ' · ' : ''}
                              {viewedLabel ? `Last ${viewedLabel}` : ''}
                            </span>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>

                  {overBudget && budgetHint ? (
                    <div className="mt-2 pl-11 text-xs font-medium text-amber-700">
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
                      {budgetHint.maxAllowedPercent > 0 && budgetHint.maxAllowedPercent < 1
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
                    </div>
                  ) : budgetHint &&
                    row.included &&
                    row.percent > 0 &&
                    budgetHint.remainingWorkedMs != null &&
                    !budgetHint.overBudget ? (
                    <div className="mt-2 pl-11 text-xs text-gray-500">
                      <span className="font-medium text-gray-700">
                        {formatAllocationWorkedDuration(budgetHint.remainingWorkedMs)}
                      </span>{' '}
                      left on lead
                      {budgetHint.leadWorkedMs > 0 ? (
                        <>
                          {' '}
                          · spent {formatAllocationWorkedDuration(budgetHint.leadWorkedMs)}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <style>{`
        .allocation-range {
          --range-thumb: #ffffff;
          --range-thumb-size: 1.125rem;
          --range-bg: #e8ecf0;
          --range-p: 3px;
          --radius-selector: 9999px;
          width: auto;
          min-width: 0;
          flex: 1 1 0%;
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
