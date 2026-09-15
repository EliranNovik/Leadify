import { SparklesIcon } from '@heroicons/react/24/solid';
import type { SmartScanQueue } from '../../lib/smartScan/smartScanTypes';

const STYLES: Record<SmartScanQueue, { label: string; className: string; pulse?: boolean }> = {
  matched: {
    label: 'Matched',
    className: 'bg-emerald-50 text-emerald-800',
  },
  unmatched: {
    label: 'Unmatched',
    className: 'bg-violet-50 text-violet-800',
  },
  processing: {
    label: 'Processing',
    className: 'bg-sky-50 text-sky-800',
    pulse: true,
  },
  history: {
    label: 'History',
    className: 'bg-slate-100 text-slate-700',
  },
};

type Props = {
  status: SmartScanQueue;
  hasSuggestions?: boolean;
};

export function SmartScanStatusBadge({ status, hasSuggestions }: Props) {
  const style = STYLES[status];
  const showSuggestionMark = Boolean(hasSuggestions) && status === 'unmatched';

  return (
    <span className="relative inline-flex">
      <span
        className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${style.className} ${
          style.pulse ? 'animate-pulse' : ''
        }`}
      >
        {style.label}
      </span>
      {showSuggestionMark ? (
        <span
          className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm ring-2 ring-white"
          title="Lead suggestions available"
          aria-label="Lead suggestions available"
        >
          <SparklesIcon className="h-3.5 w-3.5" />
        </span>
      ) : null}
    </span>
  );
}
