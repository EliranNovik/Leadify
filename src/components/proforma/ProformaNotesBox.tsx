import React from 'react';
import { DocumentTextIcon } from '@heroicons/react/24/outline';

type Props = {
  notes: string;
  className?: string;
};

const ProformaNotesBox: React.FC<Props> = ({ notes, className = '' }) => (
  <div
    className={`max-w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-amber-200/70 bg-gradient-to-br from-amber-50 via-white to-orange-50/90 shadow-lg shadow-amber-900/5 ring-1 ring-amber-100/80 backdrop-blur-sm md:max-w-xs ${className}`}
    role="note"
  >
    <div className="flex items-center gap-2 border-b border-amber-200/50 bg-amber-100/35 px-4 py-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 text-amber-800">
        <DocumentTextIcon className="h-4 w-4" aria-hidden />
      </span>
      <span className="text-xs font-semibold uppercase tracking-wider text-amber-900/85">Notes</span>
    </div>
    <div className="px-4 py-3.5">
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{notes}</p>
    </div>
  </div>
);

export default ProformaNotesBox;
