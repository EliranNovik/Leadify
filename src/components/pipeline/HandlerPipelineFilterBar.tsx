import React from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { HandlerPipelineRow } from './handlerTypes';
import { rowAssignmentFlags } from './HandlerAssignedDateBadge';

export type HandlerPaidFilter = '' | 'paid' | 'not_paid';
export type HandlerAssignmentFilter = '' | 'new' | 'reassigned';
export type HandlerEmailSentFilter = '' | 'sent' | 'not_sent';

export type HandlerTableFilters = {
  paid: HandlerPaidFilter;
  assignment: HandlerAssignmentFilter;
  emailSent: HandlerEmailSentFilter;
  category: string;
  language: string;
  country: string;
};

export const EMPTY_HANDLER_TABLE_FILTERS: HandlerTableFilters = {
  paid: '',
  assignment: '',
  emailSent: '',
  category: '',
  language: '',
  country: '',
};

export function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => String(value || '').trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function matchesHandlerTableFilters(row: HandlerPipelineRow, filters: HandlerTableFilters): boolean {
  if (filters.paid === 'paid' && !row.isFirstPaymentPaid) return false;
  if (filters.paid === 'not_paid' && row.isFirstPaymentPaid) return false;
  const emailSent = Boolean(row.emailFlag5);
  if (filters.emailSent === 'sent' && !emailSent) return false;
  if (filters.emailSent === 'not_sent' && emailSent) return false;
  if (filters.assignment) {
    const flags = rowAssignmentFlags(row);
    if (filters.assignment === 'new' && (!flags.isNew || flags.isReassigned)) return false;
    if (filters.assignment === 'reassigned' && !flags.isReassigned) return false;
  }
  if (filters.category && (row.mainCategory || '') !== filters.category) return false;
  if (filters.language && (row.language || '') !== filters.language) return false;
  if (filters.country && (row.country || '') !== filters.country) return false;
  return true;
}

export function handlerTableFiltersActive(filters: HandlerTableFilters): boolean {
  return Boolean(
    filters.paid || filters.assignment || filters.emailSent || filters.category || filters.language || filters.country,
  );
}

const selectClass = 'select select-bordered w-full rounded-xl border-gray-200 bg-white text-sm';

type Props = {
  filters: HandlerTableFilters;
  onChange: (next: HandlerTableFilters) => void;
  categories: string[];
  languages: string[];
  countries: string[];
  showAssignmentFilter?: boolean;
};

const HandlerPipelineFilterBar: React.FC<Props> = ({
  filters,
  onChange,
  categories,
  languages,
  countries,
  showAssignmentFilter = false,
}) => {
  const patch = (partial: Partial<HandlerTableFilters>) => onChange({ ...filters, ...partial });
  const hasFilters = handlerTableFiltersActive(filters);

  return (
    <>
      <div className="w-full min-w-0 sm:w-40">
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Paid
        </label>
        <select
          className={selectClass}
          value={filters.paid}
          onChange={(e) => patch({ paid: e.target.value as HandlerPaidFilter })}
        >
          <option value="">All</option>
          <option value="paid">Paid</option>
          <option value="not_paid">Not paid</option>
        </select>
      </div>
      <div className="w-full min-w-0 sm:w-40">
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Email sent
        </label>
        <select
          className={selectClass}
          value={filters.emailSent}
          title="Sent = blue envelope (flagged email). Not sent = grey envelope."
          onChange={(e) => patch({ emailSent: e.target.value as HandlerEmailSentFilter })}
        >
          <option value="">All</option>
          <option value="sent">Sent</option>
          <option value="not_sent">Not sent</option>
        </select>
      </div>
      {showAssignmentFilter ? (
        <div className="w-full min-w-0 sm:w-44">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Assignment
          </label>
          <select
            className={selectClass}
            value={filters.assignment}
            onChange={(e) => patch({ assignment: e.target.value as HandlerAssignmentFilter })}
          >
            <option value="">All</option>
            <option value="new">New</option>
            <option value="reassigned">Re-assigned</option>
          </select>
        </div>
      ) : null}
      <div className="w-full min-w-0 sm:w-44">
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Category
        </label>
        <select
          className={selectClass}
          value={filters.category}
          onChange={(e) => patch({ category: e.target.value })}
        >
          <option value="">All</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>
      <div className="w-full min-w-0 sm:w-40">
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Language
        </label>
        <select
          className={selectClass}
          value={filters.language}
          onChange={(e) => patch({ language: e.target.value })}
        >
          <option value="">All</option>
          {languages.map((language) => (
            <option key={language} value={language}>
              {language}
            </option>
          ))}
        </select>
      </div>
      <div className="w-full min-w-0 sm:w-40">
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Country
        </label>
        <select
          className={selectClass}
          value={filters.country}
          onChange={(e) => patch({ country: e.target.value })}
        >
          <option value="">All</option>
          {countries.map((country) => (
            <option key={country} value={country}>
              {country}
            </option>
          ))}
        </select>
      </div>
      {hasFilters ? (
        <button
          type="button"
          className="inline-flex h-12 items-center gap-1 rounded-full px-3 text-xs font-medium text-gray-500 transition hover:bg-white hover:text-gray-800"
          onClick={() => onChange(EMPTY_HANDLER_TABLE_FILTERS)}
        >
          <XMarkIcon className="h-4 w-4" />
          Clear
        </button>
      ) : null}
    </>
  );
};

export default HandlerPipelineFilterBar;
