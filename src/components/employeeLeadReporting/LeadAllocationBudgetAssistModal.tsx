import React from 'react';
import {
  ExclamationTriangleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  formatAllocationBudgetCapRule,
  formatAllocationCostNis,
  formatAllocationWorkedDuration,
  formatBudgetAllocationDuration,
  type LeadAllocationBudgetViolation,
} from '../../lib/leadAllocationBudget';

type LeadAllocationBudgetAssistModalProps = {
  open: boolean;
  violations: LeadAllocationBudgetViolation[];
  onClose: () => void;
  onApplyMaxAllowed: () => void;
};

export default function LeadAllocationBudgetAssistModal({
  open,
  violations,
  onClose,
  onApplyMaxAllowed,
}: LeadAllocationBudgetAssistModalProps) {
  if (!open || violations.length === 0) return null;

  return (
    <div className="modal modal-open z-[120]">
      <div className="modal-box flex max-h-[85vh] max-w-lg flex-col overflow-hidden p-0">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ExclamationTriangleIcon className="h-6 w-6 shrink-0 text-amber-600" />
              <h3 className="text-lg font-bold text-gray-900">Lead over budget</h3>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Employee case handling cost cannot exceed {formatAllocationBudgetCapRule()}. Lower the
              allocation to the max available, then save again.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle"
            onClick={onClose}
            aria-label="Close"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto px-6 py-4">
          {violations.map((v) => (
            <div key={v.key} className="rounded-2xl bg-amber-50 px-4 py-3">
              <p className="font-semibold text-gray-900">
                #{v.lead_number}{' '}
                <span className="font-normal text-gray-600">{v.client_name}</span>
              </p>
              <p className="mt-1 text-sm text-amber-900">
                You set <span className="font-semibold">{v.requestedPercent}%</span> (
                {formatAllocationWorkedDuration(v.requestedAllocatedMs)}), but only{' '}
                <span className="font-semibold">
                  {v.maxAllowedPercent > 0 && v.maxAllowedPercent < 1
                    ? v.maxAllowedPercent.toFixed(2)
                    : v.maxAllowedPercent}
                  %
                </span>
                {v.maxAllocatedMs > 0
                  ? ` (${formatBudgetAllocationDuration(v.maxAllocatedMs)})`
                  : ''}{' '}
                fits this lead&apos;s remaining budget.
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Remaining {formatAllocationCostNis(v.remainingCostNis)} of max{' '}
                {formatAllocationCostNis(v.maxAllowedCostNis)}
              </p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Adjust myself
          </button>
          <button type="button" className="btn btn-primary" onClick={onApplyMaxAllowed}>
            Set to max available
          </button>
        </div>
      </div>
      <button
        type="button"
        className="modal-backdrop bg-black/40"
        aria-label="Close"
        onClick={onClose}
      />
    </div>
  );
}
