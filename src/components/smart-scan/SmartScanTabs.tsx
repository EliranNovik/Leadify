import type { SmartScanTab } from '../../lib/smartScan/smartScanTypes';

const TABS: Array<{ id: SmartScanTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'matched', label: 'Matched' },
  { id: 'unmatched', label: 'Unmatched' },
  { id: 'processing', label: 'Processing' },
  { id: 'history', label: 'History' },
];

type Props = {
  active: SmartScanTab;
  counts: Record<SmartScanTab, number>;
  onSelect: (tab: SmartScanTab) => void;
};

export function SmartScanTabs({ active, counts, onSelect }: Props) {
  return (
    <div className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-full bg-gray-200/70 p-1" role="tablist" aria-label="Scan status">
      {TABS.map((tab) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`rounded-full px-3.5 py-1.5 text-base font-semibold transition ${
              selected ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
            }`}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
            <span className="ml-1.5 text-xs font-medium text-gray-400">{counts[tab.id]}</span>
          </button>
        );
      })}
    </div>
  );
}
