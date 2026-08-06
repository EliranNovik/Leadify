import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardDocumentListIcon } from '@heroicons/react/24/outline';
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
 * Header badge for handlers / DMs / superusers: count of missing daily lead
 * allocation reports since the reporting start date. Click opens the latest missing day.
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
        isSuperUser: ctx?.isSuperUser,
        bonusesRole: ctx?.bonusesRole,
      });
      setAllowed(canSee);
      if (!canSee || !ctx?.employeeId) {
        setMissingDates([]);
        return;
      }
      const missing = await fetchMissingLeadAllocationDates(ctx.employeeId);
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
        className={[
          'group inline-flex items-center gap-1.5 rounded-full',
          'border-0 bg-amber-500 text-white shadow-sm',
          'px-2.5 py-1.5 md:px-3 md:py-1.5',
          'hover:bg-amber-600 transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50',
        ].join(' ')}
      >
        <ClipboardDocumentListIcon
          className={compact ? 'h-5 w-5 shrink-0' : 'h-6 w-6 shrink-0'}
          aria-hidden
        />
        <span
          className={[
            'hidden sm:inline font-semibold leading-tight',
            compact ? 'text-[10px]' : 'text-[11px] md:text-xs',
          ].join(' ')}
        >
          Reports due
        </span>
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
