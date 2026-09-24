import React from 'react';
import { createPortal } from 'react-dom';
import { ClockIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { formatDurationMs } from '../lib/employeeClockInOvertime';

interface NineHourOvertimeModalProps {
  isOpen: boolean;
  todayTotalMs: number;
  onClose: () => void;
}

const NineHourOvertimeModal: React.FC<NineHourOvertimeModalProps> = ({
  isOpen,
  todayTotalMs,
  onClose,
}) => {
  if (!isOpen || typeof window === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[10070] flex items-center justify-center bg-black/55 p-4">
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nine-hour-overtime-title"
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-base-200">
          <div className="flex items-start gap-3 min-w-0">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-full shrink-0 bg-amber-100 text-amber-700">
              <ClockIcon className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h3 id="nine-hour-overtime-title" className="text-lg font-semibold text-gray-900">
                9 hours reached
              </h3>
              <p className="text-sm text-gray-600 mt-0.5">
                Today&apos;s total: {formatDurationMs(todayTotalMs)}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-gray-700 leading-relaxed">
            You have reached 9 hours of work today. You can keep working. If you do not clock out,
            you will be clocked out automatically at 23:00 for your base hours.
          </p>
          <button type="button" className="btn btn-primary w-full" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default NineHourOvertimeModal;
