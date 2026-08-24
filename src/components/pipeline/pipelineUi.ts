import type { CSSProperties } from 'react';

export type PipelineRoleTab =
  | 'closer'
  | 'scheduler'
  | 'manager'
  | 'helper'
  | 'expert'
  | 'handler'
  | 'retention';

export const PIPELINE_TAB_LABELS: Record<PipelineRoleTab, string> = {
  closer: 'Closer',
  scheduler: 'Scheduler',
  manager: 'Manager',
  helper: 'Helper',
  expert: 'Expert',
  handler: 'Handler',
  retention: 'Retention Handler',
};

export type { PipelineViewAs } from '../../lib/resolvePipelineIdentity';

export const PIPELINE_TABLE_CLASS =
  'pipeline-flat-table w-full table-auto border-separate border-spacing-0 text-sm';

export const PIPELINE_THEAD_CLASS =
  'sticky top-0 z-10 bg-[#f3f4f6] text-sm uppercase tracking-wide text-gray-500';

export const PIPELINE_ROW_CLASS = 'pipeline-flat-row cursor-pointer';

export function pipelineRowClassName(selected?: boolean): string {
  return selected ? `${PIPELINE_ROW_CLASS} pipeline-flat-row-selected` : PIPELINE_ROW_CLASS;
}

export const PIPELINE_CELL_STYLE: CSSProperties = { backgroundColor: '#ffffff' };

const PIPELINE_CELL_BASE = 'px-4 py-3.5 border-b border-gray-100';

export const PIPELINE_CELL_FIRST = PIPELINE_CELL_BASE;
export const PIPELINE_CELL_MID = PIPELINE_CELL_BASE;
export const PIPELINE_CELL_LAST = PIPELINE_CELL_BASE;

export function pipelineFollowUpColor(followUpDateStr: string | null | undefined): string {
  if (!followUpDateStr) return 'text-gray-500';
  const followUpDate = new Date(followUpDateStr);
  if (Number.isNaN(followUpDate.getTime())) return 'text-gray-500';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(followUpDate);
  start.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((start.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'text-red-600';
  if (diffDays === 0) return 'text-green-600';
  return 'text-yellow-600';
}

export function pipelineMainCategory(miscCategory: unknown): string {
  const cat = Array.isArray(miscCategory) ? miscCategory[0] : miscCategory;
  if (cat && typeof cat === 'object') {
    const rec = cat as { misc_maincategory?: { name?: string } | { name?: string }[] };
    const main = Array.isArray(rec.misc_maincategory) ? rec.misc_maincategory[0] : rec.misc_maincategory;
    const name = String(main?.name || '').trim();
    if (name) return name;
  }
  return '';
}

export function formatPipelineCategory(miscCategory: unknown, fallback?: string | null): string {
  const cat = Array.isArray(miscCategory) ? miscCategory[0] : miscCategory;
  if (cat && typeof cat === 'object') {
    const rec = cat as { name?: string; misc_maincategory?: { name?: string } | { name?: string }[] };
    const main = Array.isArray(rec.misc_maincategory) ? rec.misc_maincategory[0] : rec.misc_maincategory;
    if (rec.name && main?.name) return `${rec.name} (${main.name})`;
    if (rec.name) return rec.name;
  }
  const text = String(fallback || '').trim();
  return text || '—';
}

export function pipelineProbabilityTone(probability: number | null | undefined): string {
  if (probability == null) return 'text-gray-400';
  if (probability >= 80) return 'text-green-600';
  if (probability >= 60) return 'text-yellow-600';
  if (probability >= 40) return 'text-orange-600';
  return 'text-red-600';
}

export function formatPipelineMoney(
  amount: number | string | null | undefined,
  currency?: string | null,
): string {
  if (amount == null || amount === '') return '—';
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  const symbol = !currency || currency === 'ILS' || currency === 'NIS' || currency === '1' ? '₪' : currency;
  return `${symbol}${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
