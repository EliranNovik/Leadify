import React from 'react';
import { EllipsisVerticalIcon, HashtagIcon } from '@heroicons/react/24/outline';
import ProformaNotesBox from './ProformaNotesBox';

type CaseBoxProps = {
  leadNumber: string;
};

export const ProformaPublicCaseReferenceBox: React.FC<CaseBoxProps> = ({ leadNumber }) => (
  <div
    className="w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50 via-white to-slate-100/90 shadow-lg shadow-slate-900/5 ring-1 ring-slate-200/60 backdrop-blur-sm md:max-w-xs"
    role="note"
  >
    <div className="flex items-center gap-2 border-b border-slate-200/60 bg-slate-100/50 px-4 py-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-500/10 text-slate-700">
        <HashtagIcon className="h-4 w-4" aria-hidden />
      </span>
      <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
        Payment reference
      </span>
    </div>
    <div className="px-4 py-3.5">
      <p className="font-mono text-lg font-bold tracking-tight text-slate-900 tabular-nums">
        Case {leadNumber}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-slate-600 sm:text-sm">
        Please use this number when making your payment.
      </p>
    </div>
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
          className="print-hide fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-[2px] md:hidden"
          aria-label="Close"
          onClick={onToggle}
        />
      )}
      {open && (
        <div
          className="print-hide fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-50 max-h-[55vh] overflow-y-auto px-4 pb-2 md:hidden"
          role="dialog"
          aria-label="Case and notes"
        >
          <div className="mx-auto flex max-w-lg flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-2xl shadow-slate-900/10 ring-1 ring-slate-100 backdrop-blur-md">
            <p className="text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
              Invoice details
            </p>
            {caseLeadNumber && <ProformaPublicCaseReferenceBox leadNumber={caseLeadNumber} />}
            {displayNotes && (
              <ProformaNotesBox notes={displayNotes} className="max-w-none shadow-none ring-0" />
            )}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex h-11 w-11 min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-transparent text-slate-900 transition active:scale-95 hover:bg-slate-900/5"
        title={open ? 'Close case and notes' : 'Case and notes'}
        aria-expanded={open}
        aria-label="Case and notes"
      >
        <EllipsisVerticalIcon className="h-8 w-8" aria-hidden />
      </button>
    </>
  );
};

export default ProformaPublicCaseReferenceBox;
