import React from 'react';
import { PrinterIcon, ShareIcon } from '@heroicons/react/24/outline';

type Props = {
  title: string;
  onPrint: () => void;
  onShare: () => void;
  sharing?: boolean;
};

const ProformaPublicToolbar: React.FC<Props> = ({ title, onPrint, onShare, sharing }) => (
  <div className="print-hide fixed inset-x-0 top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur-sm md:sticky">
    <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
      <div className="min-w-0">
        <div className="truncate text-lg font-bold text-gray-900">{title}</div>
        <div className="text-xs text-gray-500">Decker Pex Levi Law Offices</div>
      </div>
      <div className="flex shrink-0 gap-1 md:gap-2">
        <button
          type="button"
          className="btn btn-circle h-11 w-11 min-h-11 min-w-11 border-none bg-transparent text-gray-900 shadow-none hover:bg-gray-100 md:btn-md md:rounded-lg md:border md:border-gray-300 md:bg-transparent md:px-4 md:btn-outline md:gap-2 md:hover:bg-gray-50"
          onClick={onPrint}
          title="Print"
          aria-label="Print"
        >
          <PrinterIcon className="h-7 w-7 stroke-[1.75] md:h-5 md:w-5 md:stroke-2" />
          <span className="hidden md:inline">Print</span>
        </button>
        <button
          type="button"
          className="btn btn-circle h-11 w-11 min-h-11 min-w-11 border-none bg-transparent text-gray-900 shadow-none hover:bg-gray-100 disabled:opacity-50 md:btn-md md:rounded-lg md:border md:border-gray-300 md:bg-transparent md:px-4 md:btn-outline md:gap-2 md:text-gray-900 md:hover:bg-gray-50"
          onClick={onShare}
          disabled={sharing}
          title="Share link"
          aria-label="Share"
        >
          {sharing ? (
            <span className="loading loading-spinner loading-sm text-gray-900 md:loading-xs" />
          ) : (
            <ShareIcon className="h-7 w-7 stroke-[1.75] md:h-5 md:w-5 md:stroke-2" />
          )}
          <span className="hidden md:inline">Share</span>
        </button>
      </div>
    </div>
  </div>
);

export default ProformaPublicToolbar;
