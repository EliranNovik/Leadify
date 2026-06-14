import React from 'react';
import { createPortal } from 'react-dom';
import { ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { unavailabilityDateLabel } from '../../lib/employeeUnavailabilities';
import type { HolidayDateWarning } from '../../lib/israeliJewishHolidays';

interface HolidayEntryWarningModalProps {
  isOpen: boolean;
  warnings: HolidayDateWarning[];
  onCancel: () => void;
  onContinue: () => void;
  continuing?: boolean;
}

const HolidayEntryWarningModal: React.FC<HolidayEntryWarningModalProps> = ({
  isOpen,
  warnings,
  onCancel,
  onContinue,
  continuing = false,
}) => {
  if (!isOpen || warnings.length === 0 || typeof window === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[10060] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-base-200">
          <div className="flex items-start gap-3 min-w-0">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-violet-100 text-violet-700 shrink-0">
              <ExclamationTriangleIcon className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-gray-900">Jewish / Israeli holiday</h3>
              <p className="text-sm text-gray-600 mt-0.5">
                You are adding an entry on a holiday date.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle shrink-0"
            onClick={onCancel}
            disabled={continuing}
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-3">
          {warnings.map((row) => (
            <div
              key={row.date}
              className="rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2.5"
            >
              <p className="text-sm font-semibold text-violet-900">
                {unavailabilityDateLabel(row.date)}
              </p>
              <ul className="mt-1 space-y-0.5">
                {row.holidays.map((name) => (
                  <li key={`${row.date}-${name}`} className="text-sm text-violet-800">
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-base-200">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={continuing}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onContinue}
            disabled={continuing}
          >
            {continuing ? (
              <span className="loading loading-spinner loading-sm" />
            ) : (
              'Continue anyway'
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default HolidayEntryWarningModal;
