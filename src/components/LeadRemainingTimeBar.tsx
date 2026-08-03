import React, { useMemo } from 'react';
import type { LeadEmployeeCostSummary } from '../lib/leadEmployeeCost';
import {
  formatAllocationWorkedDuration,
  remainingTimeFromLeadCostSummary,
} from '../lib/leadEmployeeCost';

type LeadRemainingTimeBarProps = {
  summary: LeadEmployeeCostSummary | null;
  loading?: boolean;
  className?: string;
  /** Align under a right-side stage badge */
  align?: 'start' | 'end';
  /** Shown left of the progress bar (vertically centered with the bar, not the labels). */
  leadingAccessory?: React.ReactNode;
  /** Stretch bar to container width (leads management detail, etc.) */
  fullWidth?: boolean;
};

function MetricCell({
  label,
  value,
  align = 'start',
  tone,
  dotClass,
}: {
  label: string;
  value: string;
  align?: 'start' | 'center' | 'end';
  tone: string;
  dotClass: string;
}) {
  const alignClass =
    align === 'center' ? 'items-center text-center' : align === 'end' ? 'items-end text-right' : 'items-start text-left';
  const justify =
    align === 'center' ? 'justify-center' : align === 'end' ? 'justify-end' : 'justify-start';

  return (
    <div className={`flex min-w-0 flex-col gap-1 ${alignClass}`}>
      <div className={`flex items-center gap-1.5 ${justify}`}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden />
        <span className="text-[10px] font-medium tracking-wide text-gray-400 dark:text-gray-500">
          {label}
        </span>
      </div>
      <span className={`text-[13px] font-semibold tabular-nums tracking-tight sm:text-sm ${tone}`}>
        {value}
      </span>
    </div>
  );
}

/**
 * Compact spent / left / total budget time bar (lead employee cost).
 */
export default function LeadRemainingTimeBar({
  summary,
  loading = false,
  className = '',
  align = 'end',
  leadingAccessory,
  fullWidth = false,
}: LeadRemainingTimeBarProps) {
  const remaining = useMemo(
    () => (summary ? remainingTimeFromLeadCostSummary(summary) : null),
    [summary],
  );

  const rootAlign = align === 'end' ? 'self-end' : 'self-start';
  const barWidthClass = fullWidth ? 'w-full min-w-0' : 'w-[15.5rem] min-w-0 sm:w-[18rem]';

  if (loading && !summary) {
    return (
      <div className={[rootAlign, className].filter(Boolean).join(' ')}>
        {leadingAccessory ? (
          <div className="grid w-fit grid-cols-[auto_minmax(15.5rem,18rem)] items-center gap-x-2.5">
            <div className="shrink-0 self-center">{leadingAccessory}</div>
            <div className="h-3 overflow-hidden rounded-full bg-base-200/70">
              <div className="h-full w-2/5 animate-pulse rounded-full bg-base-300/80" />
            </div>
            <div className="col-start-2 mt-2 grid grid-cols-3 gap-2">
              <div className="h-8 animate-pulse rounded-md bg-base-200/60" />
              <div className="h-8 animate-pulse rounded-md bg-base-200/60" />
              <div className="h-8 animate-pulse rounded-md bg-base-200/60" />
            </div>
          </div>
        ) : (
          <div className={barWidthClass}>
            <div className="h-3 overflow-hidden rounded-full bg-base-200/70">
              <div className="h-full w-2/5 animate-pulse rounded-full bg-base-300/80" />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div className="h-8 animate-pulse rounded-md bg-base-200/60" />
              <div className="h-8 animate-pulse rounded-md bg-base-200/60" />
              <div className="h-8 animate-pulse rounded-md bg-base-200/60" />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!remaining) {
    if (!leadingAccessory) return null;
    return (
      <div className={['flex items-center gap-2.5', rootAlign, className].filter(Boolean).join(' ')}>
        <div className="shrink-0">{leadingAccessory}</div>
      </div>
    );
  }

  const spentMs = remaining.spentWorkedMs;
  const leftMs = remaining.remainingWorkedMs;
  const totalMs = remaining.totalBudgetWorkedMs;
  const spentPct =
    totalMs != null && totalMs > 0
      ? Math.min(100, Math.max(0, (spentMs / totalMs) * 100))
      : Math.min(100, Math.max(0, remaining.utilizationPercent));
  const leftPct =
    totalMs != null && totalMs > 0 && leftMs != null
      ? Math.min(100 - spentPct, Math.max(0, (leftMs / totalMs) * 100))
      : Math.max(0, 100 - spentPct);

  const spentLabel = formatAllocationWorkedDuration(spentMs);
  const leftLabel =
    remaining.exceeds
      ? '0h 0m'
      : leftMs != null
        ? formatAllocationWorkedDuration(leftMs)
        : '—';
  const totalLabel =
    totalMs != null ? formatAllocationWorkedDuration(totalMs) : '—';

  const spentTone = remaining.exceeds
    ? 'text-amber-700 dark:text-amber-300'
    : spentPct >= 85
      ? 'text-amber-700 dark:text-amber-300'
      : 'text-emerald-700 dark:text-emerald-300';
  const leftTone = remaining.exceeds
    ? 'text-amber-600 dark:text-amber-400'
    : 'text-gray-400 dark:text-gray-400';
  const spentDot = remaining.exceeds || spentPct >= 85 ? 'bg-amber-500' : 'bg-emerald-500';
  const leftDot = remaining.exceeds ? 'bg-amber-400' : 'bg-gray-300';
  const spentBar = remaining.exceeds
    ? 'bg-gradient-to-r from-amber-500 to-amber-400'
    : spentPct >= 85
      ? 'bg-gradient-to-r from-amber-500 to-amber-400'
      : 'bg-gradient-to-r from-emerald-600 to-emerald-400';

  const bar = (
    <div
      className="relative h-3 min-w-0 overflow-hidden rounded-full bg-base-200/70 dark:bg-base-300/35"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(remaining.exceeds ? 100 : spentPct)}
      aria-label={`Budget time used ${Math.round(remaining.exceeds ? 100 : spentPct)} percent`}
    >
      <div
        className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out ${spentBar}`}
        style={{ width: `${remaining.exceeds ? 100 : spentPct}%` }}
      />
      {!remaining.exceeds && leftPct > 0 ? (
        <div
          className="absolute inset-y-0 rounded-full bg-gray-200 transition-[left,width] duration-500 ease-out dark:bg-gray-600/40"
          style={{ left: `${spentPct}%`, width: `${leftPct}%` }}
        />
      ) : null}
    </div>
  );

  const metrics = (
    <div className="mt-2 grid grid-cols-3 gap-x-2">
      <MetricCell
        label="Spent"
        value={spentLabel}
        align="start"
        tone={spentTone}
        dotClass={spentDot}
      />
      <MetricCell
        label="Left"
        value={leftLabel}
        align="center"
        tone={leftTone}
        dotClass={leftDot}
      />
      <MetricCell
        label="Max total"
        value={totalLabel}
        align="end"
        tone="text-base-content/80"
        dotClass="bg-base-content/30"
      />
    </div>
  );

  return (
    <div
      className={[rootAlign, className].filter(Boolean).join(' ')}
      title={`Spent ${spentLabel} · Left ${leftLabel} · Max total ${totalLabel}`}
    >
      {leadingAccessory ? (
        <div
          className={`grid w-fit items-center gap-x-2.5 ${
            fullWidth
              ? 'w-full grid-cols-[auto_minmax(0,1fr)]'
              : 'grid-cols-[auto_minmax(15.5rem,18rem)]'
          }`}
        >
          <div className="shrink-0 self-center">{leadingAccessory}</div>
          {bar}
          <div className="col-start-2">{metrics}</div>
        </div>
      ) : (
        <div className={barWidthClass}>
          {bar}
          {metrics}
        </div>
      )}
    </div>
  );
}
