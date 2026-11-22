import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PencilSquareIcon } from '@heroicons/react/24/outline';
import {
  canAccessLeadTimeReport,
  fetchCurrentEmployeeContext,
  fetchMissingLeadAllocationDates,
  latestMissingLeadAllocationDate,
  leadTimeReportPathForDate,
  LEAD_ALLOCATION_SAVED_EVENT,
} from '../lib/employeeLeadReporting';

type Props = {
  className?: string;
  compact?: boolean;
};

/**
 * Header badge for employees with lead time reporting enabled: count of missing
 * daily lead allocation reports since the reporting start date. Click opens the latest missing day.
 */
const MissingLeadAllocationHeaderBadge: React.FC<Props> = ({
  className = '',
  compact = false,
}) => {
  const navigate = useNavigate();
  const [missingDates, setMissingDates] = useState<string[]>([]);
  const [allowed, setAllowed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const ctx = await fetchCurrentEmployeeContext();
      const canSee = canAccessLeadTimeReport({
        leadTimeReportingEnabled: ctx?.leadTimeReportingEnabled,
      });
      setAllowed(canSee);
      if (!canSee || !ctx?.employeeId) {
        setMissingDates([]);
        return;
      }
      const missing = await fetchMissingLeadAllocationDates(ctx.employeeId, {
        weekdays: ctx.leadTimeReportingWeekdays,
        excludedDates: ctx.leadTimeReportingExcludedDates,
      });
      setMissingDates(missing);
    } catch (error) {
      console.error('[MissingLeadAllocationHeaderBadge] refresh failed:', error);
    }
  }, []);

  useEffect(() => {
    void refresh();

    const onSaved = () => {
      void refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };

    window.addEventListener(LEAD_ALLOCATION_SAVED_EVENT, onSaved);
    window.addEventListener('focus', onSaved);
    document.addEventListener('visibilitychange', onVisible);
    const interval = window.setInterval(() => {
      void refresh();
    }, 5 * 60_000);

    return () => {
      window.removeEventListener(LEAD_ALLOCATION_SAVED_EVENT, onSaved);
      window.removeEventListener('focus', onSaved);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(interval);
    };
  }, [refresh]);

  if (!allowed || missingDates.length === 0) return null;

  const latest = latestMissingLeadAllocationDate(missingDates);
  const count = missingDates.length;
  const countLabel = count > 9 ? '9+' : String(count);

  return (
    <div className={['relative inline-flex shrink-0', className].filter(Boolean).join(' ')}>
      <button
        type="button"
        onClick={() => {
          if (!latest) return;
          navigate(leadTimeReportPathForDate(latest));
        }}
        title={`${count} missing daily lead allocation${count === 1 ? '' : 's'} — open latest`}
        aria-label={`${count} reports due`}
        className={[
          'inline-flex items-center justify-center rounded-full',
          'border-0 bg-amber-500 text-white shadow-sm',
          compact ? 'h-9 w-9' : 'h-10 w-10',
          'hover:bg-amber-600 transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50',
        ].join(' ')}
      >
        <PencilSquareIcon className={compact ? 'h-5 w-5' : 'h-6 w-6'} aria-hidden />
      </button>
      <span
        className={[
          'absolute -top-1 -right-1 z-10',
          'bg-red-500 text-white font-bold rounded-full',
          'min-w-[1.25rem] h-5 px-1',
          'flex items-center justify-center',
          'text-[10px] leading-none tabular-nums',
          'shadow-sm',
        ].join(' ')}
      >
        {countLabel}
      </span>
    </div>
  );
};

export default MissingLeadAllocationHeaderBadge;
