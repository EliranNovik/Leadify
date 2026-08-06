import React from 'react';
import { CheckCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';

type LeadAllocationSavedModalProps = {
  open: boolean;
  employeeName?: string | null;
  onClose: () => void;
};

const LeadAllocationSavedModal: React.FC<LeadAllocationSavedModalProps> = ({
  open,
  employeeName,
  onClose,
}) => {
  if (!open) return null;

  const name = employeeName?.trim() || 'there';

  return (
    <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-allocation-saved-title"
        className="w-full max-w-md rounded-2xl border border-base-300 bg-base-100 p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircleIcon className="h-7 w-7" aria-hidden />
            </span>
            <div className="min-w-0 pt-0.5">
              <h3
                id="lead-allocation-saved-title"
                className="text-lg font-semibold text-base-content"
              >
                Thank you, {name}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-base-content/70">
                Your daily lead allocation has been saved. Have a great rest of your day — goodbye
                for now!
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 flex justify-end">
          <button type="button" className="btn btn-primary rounded-full px-6" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default LeadAllocationSavedModal;
