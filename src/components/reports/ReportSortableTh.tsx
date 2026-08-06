import React from 'react';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ChevronUpDownIcon,
} from '@heroicons/react/24/outline';

export type ReportSortDir = 'asc' | 'desc';

type ReportSortableThProps = {
  label: string;
  sortKey: string;
  activeKey: string | null;
  direction: ReportSortDir;
  onSort: (key: string) => void;
  align?: 'left' | 'right';
  className?: string;
};

/** Clickable table header for numeric report columns (time / cost / max). */
export function ReportSortableTh({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  align = 'right',
  className = '',
}: ReportSortableThProps) {
  const active = activeKey === sortKey;
  const justify = align === 'right' ? 'justify-end' : 'justify-start';

  return (
    <th className={className} aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className={`inline-flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wider transition-colors ${justify} ${
          active ? 'text-primary' : 'text-gray-500 hover:text-gray-800'
        }`}
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        {active ? (
          direction === 'asc' ? (
            <ChevronUpIcon className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <ChevronDownIcon className="h-3.5 w-3.5" aria-hidden />
          )
        ) : (
          <ChevronUpDownIcon className="h-3.5 w-3.5 opacity-40" aria-hidden />
        )}
      </button>
    </th>
  );
}

export function toggleReportSort(
  currentKey: string | null,
  currentDir: ReportSortDir,
  nextKey: string,
): { key: string; dir: ReportSortDir } {
  if (currentKey === nextKey) {
    return { key: nextKey, dir: currentDir === 'asc' ? 'desc' : 'asc' };
  }
  return { key: nextKey, dir: 'desc' };
}

export function compareNullableNumbers(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: ReportSortDir,
): number {
  const aMissing = a == null || !Number.isFinite(a);
  const bMissing = b == null || !Number.isFinite(b);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  const cmp = (a as number) - (b as number);
  return dir === 'asc' ? cmp : -cmp;
}
