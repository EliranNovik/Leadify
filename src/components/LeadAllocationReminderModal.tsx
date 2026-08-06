import React from 'react';
import { createPortal } from 'react-dom';
import {
  ClipboardDocumentListIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { formatLeadAllocationMissingDayLabel } from '../lib/employeeLeadReporting';

type Props = {
  isOpen: boolean;
  missingDates: string[];
  onClose: () => void;
  onGoToReport: () => void;
};

const LeadAllocationReminderModal: React.FC<Props> = ({
  isOpen,
  missingDates,
  onClose,
  onGoToReport,
}) => {
  if (!isOpen || typeof window === 'undefined' || missingDates.length === 0) return null;

  const preview = missingDates.slice(-5).reverse();
  const extra = Math.max(0, missingDates.length - preview.length);

  return createPortal(
    <div className="fixed inset-0 z-[10072] flex items-center justify-center bg-black/55 p-4">
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-alloc-reminder-title"
      >
        <div className="flex items-start justify-between gap-3 border-b border-base-200 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <ClipboardDocumentListIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3
                id="lead-alloc-reminder-title"
                className="text-lg font-semibold text-gray-900"
              >
                Past daily lead reports missing
              </h3>
              <p className="mt-0.5 text-sm text-gray-600">
                You have {missingDates.length} earlier day
                {missingDates.length === 1 ? '' : 's'} still to fill out.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle shrink-0"
            onClick={onClose}
            aria-label="Dismiss reminder"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="text-sm leading-relaxed text-gray-700">
            Please complete your daily lead allocation so hours can be attributed to the right
            leads. Open the latest missing day to get started.
          </p>

          <div className="flex flex-wrap gap-1.5">
            {preview.map((day) => (
              <span
                key={day}
                className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200"
              >
                {formatLeadAllocationMissingDayLabel(day)}
              </span>
            ))}
            {extra > 0 ? (
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">
                +{extra} more
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <button type="button" className="btn btn-ghost rounded-full px-4" onClick={onClose}>
              Later
            </button>
            <button
              type="button"
              className="btn btn-primary rounded-full px-5"
              onClick={onGoToReport}
            >
              Open daily report
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default LeadAllocationReminderModal;
