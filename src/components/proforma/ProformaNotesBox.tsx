import React from 'react';

type Props = {
  notes: string;
  className?: string;
};

const ProformaNotesBox: React.FC<Props> = ({ notes, className = '' }) => (
  <div
    className={`max-w-[min(18rem,calc(100vw-2rem))] rounded-lg border-l-4 border-yellow-400 bg-yellow-50 px-3 py-2 text-sm text-gray-700 shadow-lg md:max-w-xs md:px-4 md:py-3 ${className}`}
    role="note"
  >
    <div className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-yellow-800">Notes</div>
    <p className="whitespace-pre-wrap break-words leading-snug">{notes}</p>
  </div>
);

export default ProformaNotesBox;
