import { confidenceBand, confidencePercent } from '../../lib/smartScan/smartScanTypes';

const BAND_CLASS = {
  high: 'text-emerald-700',
  medium: 'text-amber-700',
  low: 'text-rose-600',
} as const;

const BAND_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;

export function SmartScanConfidenceBadge({ value }: { value?: number }) {
  const band = confidenceBand(value);
  const pct = confidencePercent(value);
  if (!band || pct == null) {
    return <span className="text-sm text-gray-400">—</span>;
  }
  return (
    <span className={`text-sm font-semibold ${BAND_CLASS[band]}`}>
      {BAND_LABEL[band]} · {pct}%
    </span>
  );
}
