import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { ClipboardDocumentListIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useExternalUser } from '../hooks/useExternalUser';
import { getJerusalemTodayIsoDate } from '../lib/employeeLeadReporting';
import {
  hasFiredLeadAllocationReminderSlot,
  LEAD_ALLOCATION_REMINDER_POLL_MS,
  LEAD_ALLOCATION_SAVED_EVENT,
  leadAllocationReminderCopy,
  leadTimeReportPathForDate,
  loadLeadAllocationReminderSnapshot,
  markLeadAllocationReminderSlotFired,
  resolveDueLeadAllocationReminderSlots,
  type LeadAllocationReminderSlot,
  type LeadAllocationReminderSnapshot,
} from '../lib/leadAllocationReminders';

const TOAST_ID_PREFIX = 'lead-alloc-reminder-';

function showLeadAllocationTodayReminderToast(params: {
  slot: LeadAllocationReminderSlot;
  onOpenTodayReport: () => void;
}): void {
  const copy = leadAllocationReminderCopy(params.slot);
  const toastId = `${TOAST_ID_PREFIX}-${params.slot}`;

  toast.custom(
    (t) => (
      <div
        className={`${
          t.visible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
        } pointer-events-auto w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-black/5 transition duration-300`}
      >
        <div className="flex items-start gap-3 p-4">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <ClipboardDocumentListIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">{copy.title}</p>
            <p className="mt-1 text-sm text-gray-600">{copy.body}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-primary btn-sm rounded-full px-4"
                onClick={() => {
                  toast.dismiss(t.id);
                  params.onOpenTodayReport();
                }}
              >
                Open today’s report
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm rounded-full px-3"
                onClick={() => toast.dismiss(t.id)}
              >
                Dismiss
              </button>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-circle shrink-0"
            aria-label="Dismiss"
            onClick={() => toast.dismiss(t.id)}
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    ),
    {
      id: toastId,
      position: 'top-right',
      duration: 20_000,
    },
  );
}

/**
 * Toast reminder for today’s report, only when lead-time reporting is turned on
 * for that employee. Clock-in does not decide who sees it or when it fires.
 * The past-days backlog modal is paused.
 *
 * Weekday schedule, excluded dates, and approved sick/vacation still apply.
 * Fired state lives in localStorage.
 */
const LeadAllocationReminderMonitor: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isExternalUser, isLoading: isLoadingExternal } = useExternalUser();
  const [snapshot, setSnapshot] = useState<LeadAllocationReminderSnapshot | null>(null);
  const onReportPage = location.pathname.startsWith('/lead-time-report');

  const refresh = useCallback(async () => {
    if (isExternalUser || isLoadingExternal) {
      setSnapshot(null);
      return null;
    }
    try {
      const next = await loadLeadAllocationReminderSnapshot();
      setSnapshot(next);
      return next;
    } catch (error) {
      console.error('[LeadAllocationReminderMonitor] refresh failed:', error);
      return null;
    }
  }, [isExternalUser, isLoadingExternal]);

  const goToTodayReport = useCallback(() => {
    navigate(leadTimeReportPathForDate(getJerusalemTodayIsoDate()));
  }, [navigate]);

  const evaluateReminders = useCallback(
    (snap: LeadAllocationReminderSnapshot) => {
      if (onReportPage) return;

      const dateKey = getJerusalemTodayIsoDate();
      const firedToastSlots = (
        ['clocked_1h', 'clocked_15m', 'fixed_16', 'fixed_17'] as LeadAllocationReminderSlot[]
      ).filter((slot) => hasFiredLeadAllocationReminderSlot(snap.ctx.employeeId, slot, dateKey));

      const slotBase = {
        dateKey,
        isClockedIn: false,
        clockInTimeIso: null,
        minHours: snap.ctx.minHours,
        weekdays: snap.ctx.leadTimeReportingWeekdays,
        excludedDates: snap.effectiveExcludedDates,
      };

      // Toast for today only, and only when today is a required reporting day.
      if (snap.todayMissing) {
        const dueToday = resolveDueLeadAllocationReminderSlots({
          ...slotBase,
          firedSlots: firedToastSlots,
          requireExpectedWorkday: true,
        });
        for (const slot of dueToday) {
          markLeadAllocationReminderSlotFired(snap.ctx.employeeId, slot, dateKey);
          showLeadAllocationTodayReminderToast({
            slot,
            onOpenTodayReport: goToTodayReport,
          });
        }
      }

      // Past-days backlog modal is paused. The toast above is the only reminder.
    },
    [goToTodayReport, onReportPage],
  );

  useEffect(() => {
    if (isExternalUser || isLoadingExternal) return undefined;

    let cancelled = false;
    const run = async () => {
      const snap = await refresh();
      if (cancelled || !snap) return;
      evaluateReminders(snap);
    };

    void run();
    const interval = window.setInterval(() => {
      void (async () => {
        const snap = await refresh();
        if (!snap) return;
        evaluateReminders(snap);
      })();
    }, LEAD_ALLOCATION_REMINDER_POLL_MS);

    const onSaved = () => {
      void refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };

    window.addEventListener(LEAD_ALLOCATION_SAVED_EVENT, onSaved);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener(LEAD_ALLOCATION_SAVED_EVENT, onSaved);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isExternalUser, isLoadingExternal, refresh, evaluateReminders]);

  if (isExternalUser || isLoadingExternal || !snapshot) return null;

  // Past-days backlog modal is paused.
  return null;
};

export default LeadAllocationReminderMonitor;
