import { useState } from 'react';
import { ArrowPathIcon, Cog6ToothIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import { SmartScanHelpModal } from './SmartScanHelpModal';

const TITLE_ICON = '/smart-scan/smart-scan-title-icon.png';

type Props = {
  onRefresh: () => void;
  refreshing?: boolean;
};

export function SmartScanHeader({ onRefresh, refreshing }: Props) {
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <img
            src={TITLE_ICON}
            alt=""
            className="h-12 w-12 rounded-2xl object-cover shadow-sm ring-1 ring-gray-100 md:h-14 md:w-14"
          />
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 md:text-3xl">Smart Scan</h1>
          <button
            type="button"
            className="btn btn-ghost btn-circle btn-sm text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            title="How to use Smart Scan"
            aria-label="How to use Smart Scan"
            onClick={() => setHelpOpen(true)}
          >
            <QuestionMarkCircleIcon className="h-6 w-6" />
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="btn btn-sm rounded-xl border-gray-200 bg-white"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <ArrowPathIcon className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button type="button" className="btn btn-sm rounded-xl" disabled title="Scan settings will be available in a later phase">
            <Cog6ToothIcon className="h-4 w-4" />
            Scan Settings
          </button>
        </div>
      </div>
      <SmartScanHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
