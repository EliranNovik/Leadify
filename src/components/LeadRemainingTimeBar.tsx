import React, { useMemo } from 'react';
import { BanknotesIcon, ExclamationTriangleIcon } from '@heroicons/react/24/solid';
import type { LeadEmployeeCostSummary } from '../lib/leadEmployeeCost';
import {
  formatAllocationWorkedDuration,
  remainingTimeFromLeadCostSummary,
} from '../lib/leadEmployeeCost';

/** Matches the amber warning threshold used on the spent bar fill. */
const CLOSE_TO_BUDGET_PCT = 85;

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
  /** Open lead cost modal (or similar) when the bar / stats / status icon are clicked. */
  onClick?: () => void;
  /** Show lead-cost status icon left of the bar (red over budget, orange when close). */
  showStatusIcon?: boolean;
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

function LeadCostStatusIcon({
  exceeds,
  closeToOver,
  onClick,
}: {
  exceeds: boolean;
  closeToOver: boolean;
  onClick?: () => void;
}) {
  if (!exceeds && !closeToOver) return null;

  const Icon = exceeds ? ExclamationTriangleIcon : BanknotesIcon;
  const tone = exceeds
    ? 'text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300'
    : 'text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300';
  const label = exceeds ? 'Over budget — view lead cost' : 'Close to budget — view lead cost';

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-label={label}
        className={`inline-flex shrink-0 items-center justify-center rounded-full p-1 transition-colors ${tone}`}
      >
        <Icon className="h-5 w-5" aria-hidden />
      </button>
    );
  }

  return (
    <span className={`inline-flex shrink-0 items-center justify-center p-1 ${tone}`} title={label}>
      <Icon className="h-5 w-5" aria-hidden />
    </span>
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
  onClick,
  showStatusIcon = false,
}: LeadRemainingTimeBarProps) {
  const remaining = useMemo(
    () => (summary ? remainingTimeFromLeadCostSummary(summary) : null),
    [summary],
  );

  const rootAlign = align === 'end' ? 'self-end' : 'self-start';
  const barWidthClass = fullWidth ? 'w-full min-w-0' : 'w-[15.5rem] min-w-0 sm:w-[18rem]';

  const spentPctForIcon =
    remaining == null
      ? 0
      : remaining.totalBudgetWorkedMs != null && remaining.totalBudgetWorkedMs > 0
        ? Math.min(100, Math.max(0, (remaining.spentWorkedMs / remaining.totalBudgetWorkedMs) * 100))
        : Math.min(100, Math.max(0, remaining.utilizationPercent));
  const exceedsBudget = remaining?.exceeds === true;
  const closeToOver = !exceedsBudget && spentPctForIcon >= CLOSE_TO_BUDGET_PCT;
  const statusIcon =
    showStatusIcon && remaining ? (
      <LeadCostStatusIcon exceeds={exceedsBudget} closeToOver={closeToOver} onClick={onClick} />
    ) : null;
  const leftAccessory = leadingAccessory || statusIcon;

  if (loading && !summary) {
    return (
      <div className={[rootAlign, className].filter(Boolean).join(' ')}>
        {leftAccessory ? (
          <div className="grid w-fit grid-cols-[auto_minmax(15.5rem,18rem)] items-center gap-x-2.5">
            <div className="shrink-0 self-center">{leftAccessory}</div>
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
    if (!leftAccessory) return null;
    return (
      <div className={['flex items-center gap-2.5', rootAlign, className].filter(Boolean).join(' ')}>
        <div className="shrink-0">{leftAccessory}</div>
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
    : spentPct >= CLOSE_TO_BUDGET_PCT
      ? 'text-amber-700 dark:text-amber-300'
      : 'text-emerald-700 dark:text-emerald-300';
  const leftTone = remaining.exceeds
    ? 'text-amber-600 dark:text-amber-400'
    : 'text-gray-400 dark:text-gray-400';
  const spentDot = remaining.exceeds || spentPct >= CLOSE_TO_BUDGET_PCT ? 'bg-amber-500' : 'bg-emerald-500';
  const leftDot = remaining.exceeds ? 'bg-amber-400' : 'bg-gray-300';
  const spentBar = remaining.exceeds
    ? 'bg-gradient-to-r from-amber-500 to-amber-400'
    : spentPct >= CLOSE_TO_BUDGET_PCT
      ? 'bg-gradient-to-r from-amber-500 to-amber-400'
      : 'bg-gradient-to-r from-emerald-600 to-emerald-400';

  const title = `Spent ${spentLabel} · Left ${leftLabel} · Max total ${totalLabel}${
    onClick ? ' — view lead cost' : ''
  }`;

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

  const body = (
    <>
      {bar}
      {metrics}
    </>
  );

  const clickableClass =
    'cursor-pointer rounded-xl text-left transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1';

  const barBlock = onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={[barWidthClass, clickableClass, 'block border-0 bg-transparent p-0'].join(' ')}
      title={title}
      aria-label="View lead cost details"
    >
      {body}
    </button>
  ) : (
    <div className={barWidthClass} title={title}>
      {body}
    </div>
  );

  return (
    <div className={[rootAlign, className].filter(Boolean).join(' ')}>
      {leftAccessory ? (
        <div
          className={`grid w-fit items-start gap-x-2 ${
            fullWidth
              ? 'w-full grid-cols-[auto_minmax(0,1fr)]'
              : 'grid-cols-[auto_minmax(15.5rem,18rem)]'
          }`}
        >
          <div className="shrink-0 self-center pt-0.5">{leftAccessory}</div>
          <div className="min-w-0">{barBlock}</div>
        </div>
      ) : (
        barBlock
      )}
    </div>
  );
}
