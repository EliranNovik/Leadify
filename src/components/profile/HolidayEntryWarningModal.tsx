import React from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { unavailabilityDateLabel } from '../../lib/employeeUnavailabilities';
import type { HolidayDateWarning } from '../../lib/israeliJewishHolidays';
import ProfileBottomSheetModal, { PROFILE_STACKED_MODAL_Z_INDEX } from './ProfileBottomSheetModal';

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
  if (!isOpen || warnings.length === 0) return null;

  return (
    <ProfileBottomSheetModal
      open={isOpen}
      onClose={onCancel}
      title={
        <span className="flex items-start gap-3">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-violet-100 text-violet-700 shrink-0">
            <ExclamationTriangleIcon className="w-5 h-5" />
          </span>
          <span>
            Jewish / Israeli holiday
            <span className="block text-sm font-normal text-base-content/55 mt-0.5">
              You are adding an entry on a holiday date.
            </span>
          </span>
        </span>
      }
      saveLabel="Continue anyway"
      cancelLabel="Cancel"
      zIndex={PROFILE_STACKED_MODAL_Z_INDEX}
      headerClassName="!border-b-0"
      footerClassName="!border-t-0"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 md:flex-row md:justify-end md:gap-3">
          <button
            type="button"
            className="btn btn-ghost border-none shadow-none flex-1 md:min-w-[6.5rem] md:flex-none max-md:min-h-12 text-base-content/70 hover:bg-base-200 hover:text-base-content"
            onClick={onCancel}
            disabled={continuing}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary rounded-full px-8 flex-1 md:min-w-[6.5rem] md:flex-none max-md:min-h-12"
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
      }
    >
      <div className="space-y-3 -mt-1">
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
    </ProfileBottomSheetModal>
  );
};

export default HolidayEntryWarningModal;
