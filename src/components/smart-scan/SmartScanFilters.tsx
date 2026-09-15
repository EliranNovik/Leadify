import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import {
  type SmartScanDatePreset,
  type SmartScanListFilters,
  type SmartScanSort,
} from '../../lib/smartScan/smartScanTypes';

type Props = {
  filters: SmartScanListFilters;
  onChange: (patch: Partial<SmartScanListFilters>) => void;
};

const inputClass =
  'h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-gray-300 focus:ring-2 focus:ring-gray-100';
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500';

export function SmartScanFilters({ filters, onChange }: Props) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
      <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-3">
        <label className="md:col-span-1">
          <span className={labelClass}>Search</span>
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              className={`${inputClass} pl-9`}
              placeholder="Lead #, client, filename"
              value={filters.search || ''}
              onChange={(event) => onChange({ search: event.target.value })}
            />
          </div>
        </label>
        <label>
          <span className={labelClass}>Date</span>
          <select
            className={inputClass}
            value={filters.datePreset || 'all'}
            onChange={(event) => onChange({ datePreset: event.target.value as SmartScanDatePreset })}
          >
            <option value="all">All dates</option>
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>
          <span className={labelClass}>Sort by</span>
          <select
            className={inputClass}
            value={filters.sort || 'newest'}
            onChange={(event) => onChange({ sort: event.target.value as SmartScanSort })}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </label>
      </div>
      {filters.datePreset === 'custom' ? (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label>
            <span className={labelClass}>From</span>
            <input
              type="date"
              className={inputClass}
              value={filters.customFrom || ''}
              onChange={(event) => onChange({ customFrom: event.target.value })}
            />
          </label>
          <label>
            <span className={labelClass}>To</span>
            <input
              type="date"
              className={inputClass}
              value={filters.customTo || ''}
              onChange={(event) => onChange({ customTo: event.target.value })}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
