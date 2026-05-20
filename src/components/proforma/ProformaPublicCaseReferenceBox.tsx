import React from 'react';
import { EllipsisHorizontalIcon } from '@heroicons/react/24/outline';
import ProformaNotesBox from './ProformaNotesBox';

type CaseBoxProps = {
  leadNumber: string;
};

export const ProformaPublicCaseReferenceBox: React.FC<CaseBoxProps> = ({ leadNumber }) => (
  <div
    className="w-full rounded-lg border-l-4 border-primary bg-blue-50 px-3 py-2 text-sm text-gray-700 md:max-w-xs md:px-4 md:py-3"
    role="note"
  >
    <div className="text-xs font-semibold uppercase tracking-wide text-primary">Case {leadNumber}</div>
    <p className="mt-1.5 text-xs leading-snug text-gray-600 md:text-sm">
      Please use this number for payment reference.
    </p>
  </div>
);

type MobileMoreMenuProps = {
  open: boolean;
  onToggle: () => void;
  leadNumber?: string | null;
  notes?: string | null;
};

/** Mobile bottom bar control — opens case + notes above the fixed footer. */
export const ProformaPublicMobileMoreMenu: React.FC<MobileMoreMenuProps> = ({
  open,
  onToggle,
  leadNumber,
  notes,
}) => {
  const caseLeadNumber = leadNumber?.trim() ?? '';
  const displayNotes = notes?.trim() ?? '';
  const hasContent = Boolean(caseLeadNumber || displayNotes);

  if (!hasContent) return null;

  return (
    <>
      {open && (
        <button
          type="button"
          className="print-hide fixed inset-0 z-40 bg-black/25 md:hidden"
          aria-label="Close"
          onClick={onToggle}
        />
      )}
      {open && (
        <div
          className="print-hide fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-50 max-h-[50vh] overflow-y-auto px-4 pb-2 md:hidden"
          role="dialog"
          aria-label="Case and notes"
        >
          <div className="mx-auto flex max-w-lg flex-col gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
            {caseLeadNumber && <ProformaPublicCaseReferenceBox leadNumber={caseLeadNumber} />}
            {displayNotes && <ProformaNotesBox notes={displayNotes} className="max-w-none shadow-none" />}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={onToggle}
        className={`btn btn-circle h-12 w-12 min-h-12 min-w-12 border-none shadow-lg transition-transform hover:scale-105 ${
          open ? 'bg-gray-700 text-white' : 'bg-amber-500 text-white hover:bg-amber-600'
        }`}
        title={open ? 'Close case and notes' : 'Case and notes'}
        aria-expanded={open}
        aria-label="Case and notes"
      >
        <EllipsisHorizontalIcon className="h-6 w-6" />
      </button>
    </>
  );
};

export default ProformaPublicCaseReferenceBox;
