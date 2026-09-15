import type { SmartScanActivityEntry } from '../../lib/smartScan/smartScanTypes';
import { formatScanDateTime } from '../../lib/smartScan/smartScanFormat';

export function SmartScanActivity({ entries }: { entries?: SmartScanActivityEntry[] }) {
  if (!entries?.length) {
    return <p className="text-sm text-gray-400">No activity yet.</p>;
  }
  return (
    <ol className="space-y-3">
      {entries.map((entry, index) => (
        <li key={`${entry.at}-${index}`} className="flex gap-3">
          <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gray-300" />
          <div>
            <p className="text-xs text-gray-400">{formatScanDateTime(entry.at)}</p>
            <p className="text-sm text-gray-800">{entry.label}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
