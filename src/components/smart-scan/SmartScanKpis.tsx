import {
  ArchiveBoxIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  DocumentPlusIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline';
import { PIPELINE_SUMMARY_GRADIENTS } from '../PipelineSummaryCards';
import type { SmartScanKpis, SmartScanTab } from '../../lib/smartScan/smartScanTypes';

type KpiKey = 'scannedToday' | SmartScanTab;

type Props = {
  kpis: SmartScanKpis;
  active: KpiKey | null;
  onSelect: (key: KpiKey) => void;
};

const CARDS: Array<{
  key: KpiKey;
  label: string;
  hint: string;
  valueKey: keyof SmartScanKpis;
  Icon: typeof DocumentPlusIcon;
  gradient: string;
}> = [
  {
    key: 'scannedToday',
    label: 'Scanned Today',
    hint: 'Documents received today',
    valueKey: 'scannedToday',
    Icon: DocumentPlusIcon,
    gradient: PIPELINE_SUMMARY_GRADIENTS.missed_interaction,
  },
  {
    key: 'matched',
    label: 'Matched',
    hint: 'AI suggested a lead — approve',
    valueKey: 'matched',
    Icon: CheckCircleIcon,
    gradient: PIPELINE_SUMMARY_GRADIENTS.high_value,
  },
  {
    key: 'unmatched',
    label: 'Unmatched',
    hint: 'No AI lead match yet',
    valueKey: 'unmatched',
    Icon: QuestionMarkCircleIcon,
    gradient: PIPELINE_SUMMARY_GRADIENTS.upcoming_meeting,
  },
  {
    key: 'processing',
    label: 'Processing',
    hint: 'AI is still working',
    valueKey: 'processing',
    Icon: ArrowPathIcon,
    gradient: PIPELINE_SUMMARY_GRADIENTS.lost_interaction,
  },
  {
    key: 'history',
    label: 'History',
    hint: 'Approved or assigned to a lead',
    valueKey: 'history',
    Icon: ArchiveBoxIcon,
    gradient: PIPELINE_SUMMARY_GRADIENTS.missed_followup,
  },
];

export function SmartScanKpis({ kpis, active, onSelect }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {CARDS.map((card) => {
        const isActive = active === card.key;
        const Icon = card.Icon;
        return (
          <button
            key={card.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(card.key)}
            className={`${card.gradient} flex flex-col rounded-2xl p-5 text-left text-white shadow-xl transition-all duration-300 hover:scale-105 hover:shadow-2xl ${
              isActive ? 'ring-4 ring-white/70 scale-[1.02]' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-5xl font-bold leading-none tabular-nums">{kpis[card.valueKey]}</p>
              <div className="-mt-1 shrink-0 rounded-full bg-white/20 p-3.5">
                <Icon className="h-9 w-9" aria-hidden />
              </div>
            </div>
            <div className="mt-3 min-w-0">
              <p className="text-lg font-semibold text-white/90">{card.label}</p>
              <p className="mt-0.5 truncate text-xs text-white/80">{card.hint}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
