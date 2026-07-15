import React from 'react';
import {
  BanknotesIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/solid';
import type { LeadEmployeeCostSummary } from '../lib/leadEmployeeCost';
import { formatAllocationCostNis } from '../lib/leadEmployeeCost';

type LeadEmployeeCostBadgesProps = {
  summary: LeadEmployeeCostSummary | null;
  loading?: boolean;
  onOpenOverview: () => void;
  onOpenWarning: () => void;
  className?: string;
  isSuperuser?: boolean;
};

/**
 * Oval "Lead Cost" chip next to the Total label.
 * Amber when employee cost exceeds 14% of 87% of lead value; emerald otherwise.
 */
export default function LeadEmployeeCostBadges({
  summary,
  loading = false,
  onOpenOverview,
  onOpenWarning,
  className = '',
  isSuperuser = false,
}: LeadEmployeeCostBadgesProps) {
  const exceeds = summary?.exceedsCap === true;

  const title = exceeds
    ? isSuperuser
      ? `Employee cost over max (${formatAllocationCostNis(summary?.totalCostNis)} / ${formatAllocationCostNis(summary?.maxAllowedCostNis)})`
      : 'Lead time/cost over max'
    : summary && isSuperuser
      ? `Lead cost: ${formatAllocationCostNis(summary.totalCostNis)} · max ${formatAllocationCostNis(summary.maxAllowedCostNis)}`
      : 'Lead cost on this case';

  const Icon = exceeds ? ExclamationTriangleIcon : BanknotesIcon;

  return (
    <button
      type="button"
      onClick={() => (exceeds ? onOpenWarning() : onOpenOverview())}
      disabled={loading && !summary}
      title={title}
      aria-label={exceeds ? 'Lead cost overrun' : 'View lead cost'}
      className={[
        'inline-flex items-center justify-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide transition-colors disabled:opacity-50',
        exceeds
          ? 'bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-900/35 dark:text-amber-200'
          : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/35 dark:text-emerald-200',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {loading && !summary ? (
        <span className="loading loading-spinner loading-xs" />
      ) : (
        <>
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Lead Cost
        </>
      )}
    </button>
  );
}
