import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useLeadContactSearch } from '../../hooks/useLeadContactSearch';
import LeadContactSearchResults from '../search/LeadContactSearchResults';
import type { CombinedLead } from '../../lib/legacyLeadsApi';
import { formatScanLongDateTime } from '../../lib/smartScan/smartScanFormat';
import {
  fetchSmartScanLeadCasePreview,
  type SmartScanLeadCasePreview,
} from '../../lib/smartScan/smartScanLeadPreview';
import type { SmartScanLeadRef } from '../../lib/smartScan/smartScanTypes';
import { getSoftStageBadgeStyle, getStageColour, getStageName } from '../../lib/stageUtils';

type Props = {
  possibleMatches?: SmartScanLeadRef[];
  assignedLead?: SmartScanLeadRef;
  variant?: 'default' | 'header' | 'menu';
  disabled?: boolean;
  autoFocus?: boolean;
  assignCount?: number;
  onChoose: (lead: SmartScanLeadRef) => void | Promise<void>;
};

function leadFromSearch(lead: CombinedLead): SmartScanLeadRef {
  return {
    id: String(lead.id),
    leadNumber: lead.lead_number || String(lead.id),
    name: lead.name || lead.contactName || 'Unknown',
  };
}

function AssignStageBadge({ stage }: { stage: string | null }) {
  const stageStr = String(stage || '').trim();
  if (!stageStr) return null;
  const stageName = /^\d+$/.test(stageStr) ? getStageName(stageStr) || stageStr : stageStr;
  const colour = (/^\d+$/.test(stageStr) ? getStageColour(stageStr) : '') || '#391BC8';
  const soft = getSoftStageBadgeStyle(colour, stageStr);
  return (
    <span
      className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ backgroundColor: soft.backgroundColor, color: soft.color }}
    >
      {stageName}
    </span>
  );
}

export function SmartScanLeadSelector({
  possibleMatches,
  assignedLead,
  variant = 'default',
  disabled,
  autoFocus,
  assignCount = 1,
  onChoose,
}: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { results, loading } = useLeadContactSearch(query, { minLength: 2, enabled: !disabled });
  const trimmed = query.trim();
  const showResults = open && trimmed.length >= 2;

  const [pendingLead, setPendingLead] = useState<SmartScanLeadRef | null>(null);
  const [casePreview, setCasePreview] = useState<SmartScanLeadCasePreview | null>(null);
  const [casePreviewLoading, setCasePreviewLoading] = useState(false);
  const [assigningLead, setAssigningLead] = useState(false);
  const [assigningTo, setAssigningTo] = useState<SmartScanLeadRef | null>(null);

  useEffect(() => {
    setQuery('');
    setOpen(false);
    setPendingLead(null);
    setCasePreview(null);
  }, [assignedLead?.id, assignedLead?.leadNumber]);

  useEffect(() => {
    if (!pendingLead) {
      setCasePreview(null);
      setCasePreviewLoading(false);
      return;
    }
    let cancelled = false;
    setCasePreviewLoading(true);
    void fetchSmartScanLeadCasePreview(pendingLead)
      .then((preview) => {
        if (!cancelled) setCasePreview(preview);
      })
      .finally(() => {
        if (!cancelled) setCasePreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pendingLead]);

  useEffect(() => {
    if (!showResults) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) return;
      if (searchWrapRef.current?.contains(event.target as Node)) return;
      const portal = document.getElementById('smart-scan-lead-search-portal');
      if (portal?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [showResults]);

  const pick = async (lead: SmartScanLeadRef) => {
    setAssigningTo(lead);
    setAssigningLead(true);
    try {
      await Promise.resolve(onChoose(lead));
      setQuery('');
      setOpen(false);
      setPendingLead(null);
      setCasePreview(null);
    } finally {
      setAssigningLead(false);
      setAssigningTo(null);
    }
  };

  const confirmSuggested = (lead: SmartScanLeadRef) => {
    setOpen(false);
    setPendingLead(lead);
  };

  const confirmModal =
    pendingLead && !assigningLead && typeof document !== 'undefined'
      ? createPortal(
          <div className="modal modal-open z-[260]">
            <div className="modal-box max-w-lg">
              <h3 className="text-lg font-semibold text-gray-900">Assign to this lead?</h3>
              <p className="mt-1 text-sm text-gray-600">
                Are you sure you want to assign {assignCount > 1 ? `${assignCount} documents` : 'this document'} to{' '}
                <span className="font-semibold text-gray-900">{pendingLead.leadNumber}</span>
                {pendingLead.name ? ` — ${pendingLead.name}` : ''}?
              </p>

              <div className="mt-4 space-y-3 rounded-2xl border border-gray-100/70 bg-[#fcfcfd] px-4 py-3">
                {casePreviewLoading ? (
                  <p className="text-sm text-gray-400">Loading case details…</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      {casePreview?.inactive ? (
                        <span className="inline-flex rounded-full bg-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600">
                          Inactive
                        </span>
                      ) : null}
                      <AssignStageBadge stage={casePreview?.stage ?? null} />
                      {casePreview?.category ? (
                        <span className="inline-flex rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800">
                          {casePreview.category}
                        </span>
                      ) : null}
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Quick summary</p>
                      <p className="mt-1 text-sm text-gray-800">
                        {casePreview?.summary || 'No summary on this case yet.'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Case handler</p>
                        <p className="mt-1 text-sm font-medium text-gray-900">
                          {casePreview?.handlerName || 'Not assigned'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Created at</p>
                        <p className="mt-1 text-sm font-medium text-gray-900">
                          {formatScanLongDateTime(casePreview?.createdAt || undefined)}
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="modal-action">
                <button
                  type="button"
                  className="rounded-full bg-transparent px-4 py-2 text-sm font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-800"
                  disabled={assigningLead}
                  onClick={() => {
                    setPendingLead(null);
                    setCasePreview(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary rounded-full px-6"
                  disabled={disabled || assigningLead}
                  onClick={() => void pick(pendingLead)}
                >
                  Assign
                </button>
              </div>
            </div>
            <button
              type="button"
              className="modal-backdrop bg-black/50"
              disabled={assigningLead}
              onClick={() => {
                if (assigningLead) return;
                setPendingLead(null);
                setCasePreview(null);
              }}
              aria-label="Close dialog"
            />
          </div>,
          document.body,
        )
      : null;

  const assigningModal =
    assigningLead && typeof document !== 'undefined'
      ? createPortal(
          <div className="modal modal-open z-[280]">
            <div className="modal-box max-w-sm rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-2xl">
              <div className="mx-auto flex h-16 w-16 items-center justify-center">
                <span className="relative block h-14 w-14">
                  <span className="absolute inset-0 rounded-full border-[3px] border-gray-100" />
                  <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-transparent border-t-gray-900 border-r-gray-400" />
                </span>
              </div>
              <p className="mt-5 text-base font-semibold text-gray-900">
                {assignCount > 1 ? `Assigning ${assignCount} documents` : 'Assigning document'}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {assigningTo
                  ? `Saving to ${assigningTo.leadNumber}${assigningTo.name ? ` — ${assigningTo.name}` : ''}`
                  : 'Saving to Sequence of Events…'}
              </p>
            </div>
            <div className="modal-backdrop bg-black/40" />
          </div>,
          document.body,
        )
      : null;

  if (variant === 'menu') {
    return (
      <div className="w-full space-y-2 p-2" data-sheet-no-drag>
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            ref={inputRef}
            className="h-9 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-gray-300 focus:ring-2 focus:ring-gray-100"
            placeholder="Search lead number"
            value={query}
            disabled={disabled || assigningLead}
            autoFocus={autoFocus}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
        </div>
        {possibleMatches && possibleMatches.length > 0 && !trimmed ? (
          <div>
            <p className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Suggested
            </p>
            <div className="flex flex-wrap gap-1.5">
              {possibleMatches.slice(0, 8).map((lead) => (
                <button
                  key={`${lead.leadNumber}-${lead.id || lead.name}`}
                  type="button"
                  className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  disabled={disabled || assigningLead}
                  title={`${lead.leadNumber} — ${lead.name}`}
                  onClick={() => confirmSuggested(lead)}
                >
                  {lead.leadNumber}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {trimmed.length >= 2 ? (
          <div className="max-h-52 overflow-y-auto rounded-xl border border-gray-100">
            <LeadContactSearchResults
              results={results}
              loading={loading}
              query={query}
              minLength={2}
              showTypeFilter={false}
              onSelect={(lead) => confirmSuggested(leadFromSearch(lead))}
            />
          </div>
        ) : null}
        {confirmModal}
        {assigningModal}
      </div>
    );
  }

  if (variant === 'header') {
    const rect = searchWrapRef.current?.getBoundingClientRect();
    return (
      <div ref={wrapRef} className="w-full" data-sheet-no-drag>
        <div className="flex min-w-0 items-center gap-2">
          <label className="block w-56 shrink-0">
            <span className="sr-only">Assign to a lead</span>
            <div ref={searchWrapRef} className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                ref={inputRef}
                className="h-8 w-full rounded-full border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-gray-300 focus:ring-2 focus:ring-gray-100"
                placeholder={assignedLead ? `${assignedLead.leadNumber} — ${assignedLead.name}` : 'Search lead to assign'}
                value={query}
                disabled={disabled}
                autoFocus={autoFocus}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
              />
            </div>
          </label>
          {possibleMatches && possibleMatches.length > 0 && !trimmed ? (
            <div className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto">
              {possibleMatches.slice(0, 6).map((lead) => (
                <button
                  key={`${lead.leadNumber}-${lead.id || lead.name}`}
                  type="button"
                  className="shrink-0 whitespace-nowrap rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  disabled={disabled}
                  title={`${lead.leadNumber} — ${lead.name}`}
                  onClick={() => confirmSuggested(lead)}
                >
                  {lead.leadNumber}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {showResults && rect && typeof document !== 'undefined'
          ? createPortal(
              <div
                id="smart-scan-lead-search-portal"
                className="z-[220] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl"
                style={{
                  position: 'fixed',
                  top: rect.bottom + 6,
                  left: rect.left,
                  width: rect.width,
                }}
              >
                <div className="max-h-72 overflow-y-auto">
                  <LeadContactSearchResults
                    results={results}
                    loading={loading}
                    query={query}
                    minLength={2}
                    showTypeFilter={false}
                    onSelect={(lead) => pick(leadFromSearch(lead))}
                  />
                </div>
              </div>,
              document.body,
            )
          : null}
        {confirmModal}
        {assigningModal}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {possibleMatches && possibleMatches.length > 0 ? (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Possible matches</p>
          <div className="flex flex-nowrap items-center gap-2 overflow-x-auto">
            {possibleMatches.map((lead) => (
              <div
                key={`${lead.leadNumber}-${lead.id || lead.name}`}
                className="flex shrink-0 items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5"
              >
                <p className="whitespace-nowrap text-sm font-medium text-gray-900">{lead.leadNumber}</p>
                <button type="button" className="btn btn-xs rounded-full" onClick={() => confirmSuggested(lead)}>
                  Choose
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-gray-500">Search leads</span>
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-gray-100"
            placeholder="Lead #, name, phone, email"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </label>
      <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-100">
        <LeadContactSearchResults
          results={results}
          loading={loading}
          query={query}
          minLength={2}
          showTypeFilter={false}
          onSelect={(lead) => pick(leadFromSearch(lead))}
        />
      </div>
      {confirmModal}
      {assigningModal}
    </div>
  );
}
