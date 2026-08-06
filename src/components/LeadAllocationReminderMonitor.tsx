import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { ClipboardDocumentListIcon, XMarkIcon } from '@heroicons/react/24/outline';
import LeadAllocationReminderModal from './LeadAllocationReminderModal';
import { useExternalUser } from '../hooks/useExternalUser';
import { getJerusalemTodayIsoDate } from '../lib/employeeLeadReporting';
import {
  getJerusalemHour,
  hasFiredLeadAllocationReminderSlot,
  LEAD_ALLOCATION_REMINDER_POLL_MS,
  LEAD_ALLOCATION_SAVED_EVENT,
  leadAllocationReminderCopy,
  leadTimeReportPathForDate,
  loadLeadAllocationReminderSnapshot,
  markLeadAllocationReminderModalDismissed,
  markLeadAllocationReminderModalShownForHour,
  markLeadAllocationReminderSlotFired,
  pastMissingLeadAllocationDates,
  resolveDueLeadAllocationReminderSlots,
  shouldOpenLeadAllocationBacklogModal,
  type LeadAllocationReminderSlot,
  type LeadAllocationReminderSnapshot,
} from '../lib/leadAllocationReminders';

const TOAST_ID_PREFIX = 'lead-alloc-reminder-';

function showLeadAllocationReminderToast(params: {
  slot: LeadAllocationReminderSlot;
  missingCount: number;
  onOpenReport: () => void;
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
            {params.missingCount > 1 ? (
              <p className="mt-1 text-xs font-medium text-amber-700">
                {params.missingCount} missing reports
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-primary btn-sm rounded-full px-4"
                onClick={() => {
                  toast.dismiss(t.id);
                  params.onOpenReport();
                }}
              >
                Open report
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
 * Modal + timed toast reminders for missing daily lead allocations.
 * Modal: past days only, once per Jerusalem hour. Never for today alone.
 * Toasts: still for today's missing report on the clocked-in / 16:00–17:00 schedule.
 */
const LeadAllocationReminderMonitor: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isExternalUser, isLoading: isLoadingExternal } = useExternalUser();
  const [snapshot, setSnapshot] = useState<LeadAllocationReminderSnapshot | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const onReportPage = location.pathname.startsWith('/lead-time-report');

  const pastMissingDates = useMemo(
    () => pastMissingLeadAllocationDates(snapshot?.missingDates || []),
    [snapshot?.missingDates],
  );

  const refresh = useCallback(async () => {
    if (isExternalUser || isLoadingExternal) {
      setSnapshot(null);
      setModalOpen(false);
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

  const goToReport = useCallback(
    (missingDates: string[]) => {
      const latest =
        missingDates.length > 0 ? missingDates[missingDates.length - 1] : getJerusalemTodayIsoDate();
      setModalOpen(false);
      navigate(leadTimeReportPathForDate(latest));
    },
    [navigate],
  );

  const evaluateToasts = useCallback(
    (snap: LeadAllocationReminderSnapshot) => {
      if (!snap.todayMissing || onReportPage) return;

      const dateKey = getJerusalemTodayIsoDate();
      const fired = (
        ['clocked_1h', 'clocked_15m', 'fixed_16', 'fixed_17'] as LeadAllocationReminderSlot[]
      ).filter((slot) => hasFiredLeadAllocationReminderSlot(snap.ctx.employeeId, slot, dateKey));

      const due = resolveDueLeadAllocationReminderSlots({
        dateKey,
        isClockedIn: snap.isClockedIn,
        clockInTimeIso: snap.clockInTimeIso,
        minHours: snap.ctx.minHours,
        firedSlots: fired,
      });

      for (const slot of due) {
        markLeadAllocationReminderSlotFired(snap.ctx.employeeId, slot, dateKey);
        showLeadAllocationReminderToast({
          slot,
          missingCount: snap.missingDates.length,
          onOpenReport: () => goToReport(snap.missingDates),
        });
      }
    },
    [goToReport, onReportPage],
  );

  const maybeOpenModal = useCallback(
    (snap: LeadAllocationReminderSnapshot) => {
      if (onReportPage || modalOpen) return;
      // Backlog only — never open for today's missing report.
      if (
        !shouldOpenLeadAllocationBacklogModal({
          employeeId: snap.ctx.employeeId,
          missingDates: snap.missingDates,
        })
      ) {
        return;
      }

      const dateKey = getJerusalemTodayIsoDate();
      const hour = getJerusalemHour();
      markLeadAllocationReminderModalShownForHour(snap.ctx.employeeId, hour, dateKey);
      window.setTimeout(() => setModalOpen(true), 900);
    },
    [onReportPage, modalOpen],
  );

  useEffect(() => {
    if (isExternalUser || isLoadingExternal) return undefined;

    let cancelled = false;
    const run = async () => {
      const snap = await refresh();
      if (cancelled || !snap) return;
      maybeOpenModal(snap);
      evaluateToasts(snap);
    };

    void run();
    const interval = window.setInterval(() => {
      void (async () => {
        const snap = await refresh();
        if (!snap) return;
        maybeOpenModal(snap);
        evaluateToasts(snap);
      })();
    }, LEAD_ALLOCATION_REMINDER_POLL_MS);

    const onSaved = () => {
      void refresh().then((snap) => {
        const past = pastMissingLeadAllocationDates(snap?.missingDates || []);
        if (past.length === 0) setModalOpen(false);
      });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };

    window.addEventListener(LEAD_ALLOCATION_SAVED_EVENT, onSaved);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onSaved);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener(LEAD_ALLOCATION_SAVED_EVENT, onSaved);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onSaved);
    };
  }, [
    isExternalUser,
    isLoadingExternal,
    refresh,
    maybeOpenModal,
    evaluateToasts,
  ]);

  useEffect(() => {
    if (onReportPage) setModalOpen(false);
  }, [onReportPage]);

  if (isExternalUser || isLoadingExternal || !snapshot) return null;

  return (
    <LeadAllocationReminderModal
      isOpen={modalOpen && pastMissingDates.length > 0}
      missingDates={pastMissingDates}
      onClose={() => {
        markLeadAllocationReminderModalDismissed(snapshot.ctx.employeeId);
        setModalOpen(false);
      }}
      onGoToReport={() => {
        markLeadAllocationReminderModalDismissed(snapshot.ctx.employeeId);
        goToReport(pastMissingDates);
      }}
    />
  );
};

export default LeadAllocationReminderMonitor;
