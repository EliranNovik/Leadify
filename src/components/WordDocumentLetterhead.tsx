import React from 'react';
import { formatWordDocumentHeaderDate, type WordLetterhead } from '../lib/wordDocumentDocx';

type Props = {
  letterhead: WordLetterhead;
  showPageHint?: boolean;
};

const WordDocumentLetterhead: React.FC<Props> = ({ letterhead }) => (
  <div className="word-doc-letterhead mb-8 border-b border-[#e7e5e4] pb-4">
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        {letterhead.logoUrl ? (
          <img
            src={letterhead.logoUrl}
            alt=""
            className="h-10 w-auto object-contain"
          />
        ) : null}
        <p className="truncate text-[11pt] font-semibold tracking-tight text-[#1c1917] [font-family:Arial,Helvetica,sans-serif]">
          {letterhead.companyName}
        </p>
      </div>
      <p className="shrink-0 text-[10pt] text-[#57534e] [font-family:Arial,Helvetica,sans-serif]">
        {formatWordDocumentHeaderDate()}
      </p>
    </div>
  </div>
);

export const WordDocumentFooterBar: React.FC<Props> = ({ letterhead, showPageHint = true }) => (
  <div className="word-doc-letterhead-footer mt-auto shrink-0 border-t border-[#e7e5e4] pt-3 text-center text-[8pt] text-[#78716c] [font-family:Arial,Helvetica,sans-serif]">
    {[letterhead.address, letterhead.website].filter(Boolean).join('  ·  ')}
    {showPageHint ? <span className="print:inline hidden">  ·  Page </span> : null}
  </div>
);

export default WordDocumentLetterhead;
