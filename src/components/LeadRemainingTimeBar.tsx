import React, { useMemo } from 'react';
import type { LeadEmployeeCostSummary } from '../lib/leadEmployeeCost';
import { formatAllocationWorkedDuration } from '../lib/leadEmployeeCost';

type LeadRemainingTimeBarProps = {
  summary: LeadEmployeeCostSummary | null;
  loading?: boolean;
  className?: string;
  /** Align under a right-side stage badge */
  align?: 'start' | 'end';
};

function remainingFromSummary(summary: LeadEmployeeCostSummary): {
  remainingCostNis: number;
  remainingWorkedMs: number | null;
  utilizationPercent: number;
  exceeds: boolean;
} {
  const exceeds = summary.exceedsCap === true;
  const remainingCostNis = Math.max(
    0,
    Math.round((summary.maxAllowedCostNis - summary.totalCostNis) * 100) / 100,
  );
  const hoursWorked = summary.totalWorkedMs > 0 ? summary.totalWorkedMs / (60 * 60 * 1000) : 0;
  let hourRateNis: number | null = null;
  if (hoursWorked > 0.001 && summary.totalCostNis > 0) {
    hourRateNis = summary.totalCostNis / hoursWorked;
  } else {
    const rates = summary.employees
      .map((e) => e.hourRateNis)
      .filter((r): r is number => r != null && r > 0);
    if (rates.length > 0) {
      hourRateNis = rates.reduce((sum, r) => sum + r, 0) / rates.length;
    }
  }
  const remainingWorkedMs =
    !exceeds && hourRateNis != null && hourRateNis > 0
      ? Math.round((remainingCostNis / hourRateNis) * 60 * 60 * 1000)
      : exceeds
        ? 0
        : null;

  return {
    remainingCostNis,
    remainingWorkedMs,
    utilizationPercent: summary.utilizationPercent,
    exceeds,
  };
}

/**
 * Compact remaining-time bar shown under the stage badge in ClientHeader.
 */
export default function LeadRemainingTimeBar({
  summary,
  loading = false,
  className = '',
  align = 'end',
}: LeadRemainingTimeBarProps) {
  const remaining = useMemo(
    () => (summary ? remainingFromSummary(summary) : null),
    [summary],
  );

  if (loading && !summary) {
    return (
      <div
        className={[
          'w-[7.5rem] sm:w-36',
          align === 'end' ? 'self-end' : 'self-start',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="h-1.5 overflow-hidden rounded-full bg-base-200">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-base-300" />
        </div>
        <p className="mt-1 text-[10px] text-base-content/40">Loading…</p>
      </div>
    );
  }

  if (!remaining) return null;

  const width = Math.min(100, Math.max(0, remaining.utilizationPercent));
  const label = remaining.exceeds
    ? 'No time left'
    : remaining.remainingWorkedMs != null
      ? `${formatAllocationWorkedDuration(remaining.remainingWorkedMs)} left`
      : '—';

  return (
    <div
      className={[
        'w-[7.5rem] sm:w-36',
        align === 'end' ? 'self-end text-right' : 'self-start text-left',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      title={
        remaining.exceeds
          ? 'Employee budget fully used'
          : remaining.remainingWorkedMs != null
            ? `${formatAllocationWorkedDuration(remaining.remainingWorkedMs)} remaining until max budget`
            : 'Remaining time unavailable'
      }
    >
      <div className="h-1.5 overflow-hidden rounded-full bg-base-200">
        <div
          className={`h-full rounded-full transition-all ${
            remaining.exceeds
              ? 'bg-amber-500'
              : width >= 85
                ? 'bg-amber-400'
                : 'bg-emerald-500'
          }`}
          style={{ width: `${Math.max(width, remaining.exceeds ? 100 : 0)}%` }}
        />
      </div>
      <p
        className={`mt-1 text-[10px] font-semibold leading-tight tracking-wide ${
          remaining.exceeds ? 'text-amber-700' : 'text-base-content/60'
        }`}
      >
        {label}
      </p>
    </div>
  );
}
