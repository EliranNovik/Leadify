import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BriefcaseIcon, PlusIcon } from '@heroicons/react/24/outline';
import {
  dailyAllocationGrandTotal,
  buildClientRouteFromAllocationRow,
  formatAllocationPercent,
  formatAllocationWorkedDuration,
  allocationPercentToWorkedMs,
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
  /** Per-lead cost-budget hints (14% of 87% of lead value). */
  budgetHintsByKey?: Record<string, LeadAllocationBudgetHint>;
  onApplyLeadMaxBudget?: (leadKey: string, maxAllowedPercent: number) => void;
};

const ALLOCATION_RANGE_CLASS =
  'allocation-range range flex-1 cursor-grab active:cursor-grabbing';

type AllocationPercentInputProps = {
  value: number;
  onChange: (percent: number) => void;
  readOnly?: boolean;
  allocatedLabel?: string | null;
};

function AllocationPercentInput({
  value,
  onChange,
  readOnly = false,
  allocatedLabel = null,
}: AllocationPercentInputProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const displayed = formatAllocationPercent(value);

  useEffect(() => {
    if (!editing) setDraft(displayed);
  }, [displayed, editing]);

  const commit = (raw: string) => {
    const parsed = Math.round(Number(raw));
    if (Number.isFinite(parsed)) {
      onChange(Math.max(0, Math.min(100, parsed)));
    }
    setEditing(false);
  };

  const timeBeside = allocatedLabel ? (
    <span className="text-[11px] font-medium tabular-nums text-gray-500">· {allocatedLabel}</span>
  ) : null;

  if (readOnly) {
    return (
      <span className="min-w-[5.5rem] shrink-0 whitespace-nowrap text-right text-sm font-semibold text-gray-800">
        {displayed}%{timeBeside}
      </span>
    );
  }

  if (editing) {
    return (
      <div className="flex min-w-[5.5rem] shrink-0 flex-col items-end gap-0.5">
        <div className="flex items-center justify-end gap-0.5">
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit(draft);
              }
              if (e.key === 'Escape') setEditing(false);
            }}
            className="input input-bordered input-sm h-8 w-12 min-h-8 px-1 text-right text-sm font-semibold text-gray-800"
          />
          <span className="text-sm font-semibold text-gray-500">%</span>
        </div>
        {allocatedLabel ? (
          <span className="text-[11px] font-medium tabular-nums text-gray-500">{allocatedLabel}</span>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(displayed);
        setEditing(true);
      }}
      className="min-w-[5.5rem] shrink-0 whitespace-nowrap rounded-md px-1 py-0.5 text-right text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-100 hover:text-primary"
      title="Click to edit percentage"
    >
      {displayed}%{timeBeside}
    </button>
  );
}

type AllocationPercentSliderProps = {
  value: number;
  onChange: (percent: number) => void;
  variant?: 'primary' | 'neutral';
  readOnly?: boolean;
  allocatedLabel?: string | null;
};

function AllocationPercentSlider({
  value,
  onChange,
  variant = 'primary',
  readOnly = false,
  allocatedLabel = null,
}: AllocationPercentSliderProps) {
  const roundedValue = Math.round(value);

  return (
    <div className="flex min-w-[240px] flex-1 max-w-lg items-center gap-4 py-1">
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={roundedValue}
        disabled={readOnly}
        onChange={(e) => onChange(Math.round(Number(e.target.value)))}
        className={`${ALLOCATION_RANGE_CLASS} ${variant === 'neutral' ? 'range-neutral' : 'range-primary'} ${
          readOnly ? 'pointer-events-none opacity-60' : ''
        }`}
      />
      <AllocationPercentInput
        value={roundedValue}
        onChange={onChange}
        readOnly={readOnly}
        allocatedLabel={allocatedLabel}
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
  budgetHintsByKey = {},
  onApplyLeadMaxBudget,
}) => {
  const includedRows = rows.filter((row) => row.included);
  const grandTotal = dailyAllocationGrandTotal(includedRows, otherWorkPercent);
  const isTotalValid = Math.abs(grandTotal - 100) <= 0.01;

  const allocatedTimeLabel = (percent: number) => {
    if (!(dayWorkedMs > 0) || !(percent > 0)) {
      return dayWorkedMs > 0 ? '0m' : null;
    }
    return formatAllocationWorkedDuration(
      allocationPercentToWorkedMs(dayWorkedMs, percent),
    );
  };

  const applyChange = (next: LeadAllocationChangeState) => {
    onChange(next);
  };

  const setOtherWork = (percent: number) => {
    applyChange(setOtherWorkAllocationPercent(rows, percent));
  };

  const setIncluded = (key: string, included: boolean) => {
    applyChange(toggleLeadAllocationIncluded(rows, key, included));
  };

  const setLeadPercent = (key: string, percent: number) => {
    applyChange(setLeadAllocationPercent(rows, key, percent));
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
              </span>
            </span>
          </div>
          <AllocationPercentSlider
            value={otherWorkPercent}
            onChange={setOtherWork}
            variant="neutral"
            readOnly={readOnly}
            allocatedLabel={allocatedTimeLabel(otherWorkPercent)}
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
                          Over budget — max{' '}
                          {budgetHint.maxAllowedPercent > 0 &&
                          budgetHint.maxAllowedPercent < 1
                            ? budgetHint.maxAllowedPercent.toFixed(2)
                            : formatAllocationPercent(budgetHint.maxAllowedPercent)}
                          %
                          {budgetHint.maxAllocatedMs > 0
                            ? ` (${formatBudgetAllocationDuration(budgetHint.maxAllocatedMs)})`
                            : ' (0m)'}
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
                      ) : null}
                    </span>
                  </label>

                  {row.included && (
                    <AllocationPercentSlider
                      value={row.percent}
                      onChange={(percent) => setLeadPercent(row.key, percent)}
                      readOnly={readOnly}
                      allocatedLabel={allocatedTimeLabel(row.percent)}
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
