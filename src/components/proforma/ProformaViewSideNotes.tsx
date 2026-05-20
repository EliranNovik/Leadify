import React from 'react';
import ProformaNotesBox from './ProformaNotesBox';

type Props = {
  notes?: string | null;
};

/** Fixed notes panel on the side of internal proforma view pages (hidden when empty / on print). */
const ProformaViewSideNotes: React.FC<Props> = ({ notes }) => {
  const displayNotes = notes?.trim() ?? '';
  if (!displayNotes) return null;

  return (
    <>
      <div className="print-hide fixed right-4 top-28 z-20 max-w-[min(14rem,calc(100vw-2rem))] md:hidden">
        <ProformaNotesBox notes={displayNotes} />
      </div>
      <div className="print-hide fixed right-4 top-1/2 z-20 hidden -translate-y-1/2 md:right-6 md:block">
        <ProformaNotesBox notes={displayNotes} />
      </div>
    </>
  );
};

export default ProformaViewSideNotes;
