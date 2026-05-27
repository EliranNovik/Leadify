import React from 'react';
import { PrinterIcon, ShareIcon } from '@heroicons/react/24/outline';
import ProformaBackToLeadButton from './ProformaBackToLeadButton';
import ProformaPaidBadge from './ProformaPaidBadge';

type Props = {
  title: string;
  onPrint: () => void;
  onShare: () => void;
  sharing?: boolean;
  paid?: boolean | null;
  paidAt?: string | null;
  /** Shown only when set (e.g. signed-in staff on public invoice link). */
  backToLeadHref?: string | null;
};

const iconClass = 'h-5 w-5 shrink-0 md:h-4 md:w-4';

const ProformaPublicToolbar: React.FC<Props> = ({
  title,
  onPrint,
  onShare,
  sharing,
  paid,
  paidAt,
  backToLeadHref,
}) => (
  <div className="print-hide fixed inset-x-0 top-0 z-40 border-0 bg-white/45 shadow-none backdrop-blur-2xl backdrop-saturate-150 md:sticky md:bg-white/95 md:backdrop-blur-sm">
    <div className="flex w-full items-center justify-between gap-3 py-2.5 pl-3 pr-4 sm:pl-4 sm:pr-6 sm:py-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 justify-start">
        <ProformaBackToLeadButton href={backToLeadHref ?? null} />
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="truncate text-base font-bold text-gray-900 sm:text-lg">{title}</div>
            <ProformaPaidBadge paid={paid} paidAt={paidAt} />
          </div>
          <div className="text-xs text-slate-500">Decker Pex Levi Law Offices</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-500 text-white shadow-sm transition hover:bg-green-600 active:scale-[0.98] md:h-10 md:w-auto md:gap-2 md:px-5 md:text-sm md:font-semibold"
          onClick={onPrint}
          title="Print"
          aria-label="Print"
        >
          <PrinterIcon className={iconClass} />
          <span className="hidden md:inline">Print</span>
        </button>

        <button
          type="button"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-500 text-white shadow-sm transition hover:bg-green-600 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 md:h-10 md:w-auto md:gap-2 md:px-5 md:text-sm md:font-semibold"
          onClick={onShare}
          disabled={sharing}
          title="Share link"
          aria-label="Share"
        >
          {sharing ? (
            <span className="loading loading-spinner loading-xs text-white" />
          ) : (
            <ShareIcon className={iconClass} />
          )}
          <span className="hidden md:inline">Share</span>
        </button>
      </div>
    </div>
  </div>
);

export default ProformaPublicToolbar;
