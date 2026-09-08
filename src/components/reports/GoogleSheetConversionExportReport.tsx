import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  BanknotesIcon,
  CalendarDaysIcon,
  CloudArrowUpIcon,
  CursorArrowRaysIcon,
  ExclamationTriangleIcon,
  InboxStackIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import {
  GradientSummaryCard,
  REPORT_SUMMARY_GRADIENTS,
} from './GradientSummaryCard';
import GoogleSheetConversionExportTable, {
  campaignIdFromUtm,
  conversionExportRowHasGclid,
  conversionExportRowHasValue,
  conversionExportRowIsThisMonth,
  formatConversionAmount,
  loadGoogleSheetConversionExports,
  sentAtInLocalRange,
  type ConversionExportQuickFilter,
  type GoogleSheetConversionExportRow,
} from './GoogleSheetConversionExportTable';

export const GOOGLE_SHEET_CONVERSION_EXPORT_TABS = [
  { destination: 'bad_leads_capital_firm', label: 'Bad leads → Google Sheet', short: 'Bad leads' },
  { destination: 'q_leads_capital_firm', label: 'QLeads → Google Sheet', short: 'QLeads' },
  { destination: 'hq_leads_capital_firm', label: 'HQLeads → Google Sheet', short: 'HQLeads' },
  { destination: 'sales_leads_capital_firm', label: 'SalesLeads → Google Sheet', short: 'SalesLeads' },
] as const;

export const GOOGLE_SHEET_CONVERSION_EXPORT_REPORT_LABELS = GOOGLE_SHEET_CONVERSION_EXPORT_TABS.map(
  (tab) => tab.label,
);

export function isGoogleSheetConversionExportReport(label: string | undefined): boolean {
  return Boolean(
    label &&
      (GOOGLE_SHEET_CONVERSION_EXPORT_REPORT_LABELS as readonly string[]).includes(label),
  );
}

export function GoogleSheetConversionExportTabs({
  activeLabel,
  onSelect,
}: {
  activeLabel?: string;
  onSelect?: (label: string) => void;
}) {
  const navigate = useNavigate();

  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-full bg-gray-200/70 p-1">
      {GOOGLE_SHEET_CONVERSION_EXPORT_TABS.map((tab) => {
        const active = tab.label === activeLabel;
        return (
          <button
            key={tab.destination}
            type="button"
            aria-pressed={active}
            className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
              active
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
            onClick={() => {
              if (active) return;
              if (onSelect) {
                onSelect(tab.label);
                return;
              }
              navigate(`/reports?report=${encodeURIComponent(tab.label)}`);
            }}
          >
            {tab.short}
          </button>
        );
      })}
    </div>
  );
}

type GoogleSheetConversionExportReportProps = {
  destination: string;
  description?: string;
  syncFunction: string;
  logTag: string;
};

function formatConversionSum(rows: GoogleSheetConversionExportRow[]): string {
  const sum = rows.reduce((acc, row) => acc + (Number(row.conversion_value) || 0), 0);
  const currency = rows.find((row) => row.conversion_currency)?.conversion_currency || 'ILS';
  return formatConversionAmount(sum, currency);
}

function currentMonthSentRange(): { from: string; to: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = String(new Date(year, now.getMonth() + 1, 0).getDate()).padStart(2, '0');
  return { from: `${year}-${month}-01`, to: `${year}-${month}-${lastDay}` };
}

function formatLastSent(iso: string | undefined): string {
  if (!iso) return 'No exports yet';
  try {
    return `Last ${new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })}`;
  } catch {
    return `Last ${iso}`;
  }
}

const GoogleSheetConversionExportReport: React.FC<GoogleSheetConversionExportReportProps> = ({
  destination,
  description,
  syncFunction,
  logTag,
}) => {
  const [rows, setRows] = useState<GoogleSheetConversionExportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [includeDebug, setIncludeDebug] = useState(false);
  const [lastResponseJson, setLastResponseJson] = useState<string | null>(null);
  const [responseModalOpen, setResponseModalOpen] = useState(false);
  const [quickFilter, setQuickFilter] = useState<ConversionExportQuickFilter | null>(null);
  const [sentFrom, setSentFrom] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadGoogleSheetConversionExports(destination, {
        sentFrom: sentFrom || undefined,
        sentTo: sentTo || undefined,
      });
      setRows(data);
    } catch (e: unknown) {
      console.error(e);
      toast.error((e as Error)?.message || 'Failed to load export log');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [destination, sentFrom, sentTo]);

  useEffect(() => {
    void load();
  }, [load]);

  const runSync = async (dryRun: boolean) => {
    setSyncing(true);
    setLastResponseJson(null);
    try {
      const { data, error } = await supabase.functions.invoke(syncFunction, {
        body: { dryRun, limit: 200, debug: includeDebug },
      });

      const errMeta =
        error != null
          ? {
              message: (error as Error).message ?? String(error),
              name: (error as Error).name,
              context: (error as { context?: unknown }).context,
            }
          : null;
      const snapshot = {
        data: data ?? null,
        invokeTransportError: errMeta,
      };
      setLastResponseJson(JSON.stringify(snapshot, null, 2));

      if (error) {
        toast.error((error as Error).message || 'Sync failed');
        return;
      }

      const d = data as {
        ok?: boolean;
        error?: string;
        candidateCount?: number;
        appended?: number;
        wouldAppend?: number;
        message?: string;
        debug?: unknown;
        sheets?: { updatedRange?: string; updatedRows?: number };
      };
      if (includeDebug && data != null) {
        console.info(`[${logTag}] function response`, data);
      }
      if (d?.error) {
        toast.error(d.error);
        return;
      }
      if (dryRun) {
        const would = d.wouldAppend ?? d.appended ?? 0;
        toast.success(
          `Dry run: ${d.candidateCount ?? 0} RPC row(s); ${would} would append (no Sheet write, no DB log).`,
        );
        return;
      }

      const appended = d.appended ?? 0;
      if (d.ok && appended === 0) {
        toast.success('Synced — no new leads were matched and sent.');
      } else {
        toast.success(
          `Exported ${appended} row(s) to Google Sheet (${d.candidateCount ?? 0} RPC rows).` +
            (d.sheets?.updatedRange ? ` Range: ${d.sheets.updatedRange}` : ''),
        );
      }
      await load();
    } catch (e: unknown) {
      console.error(e);
      const msg = (e as Error)?.message || 'Sync failed';
      toast.error(msg);
      setLastResponseJson((prev) =>
        prev ??
        JSON.stringify({ data: null, invokeTransportError: null, catchError: msg }, null, 2),
      );
    } finally {
      setSyncing(false);
    }
  };

  const scopedRows = useMemo(
    () => rows.filter((row) => sentAtInLocalRange(row.created_at, sentFrom, sentTo)),
    [rows, sentFrom, sentTo],
  );

  const sourceOptions = useMemo(() => {
    const names = new Set<string>();
    for (const row of scopedRows) {
      const name = String(row.source || '').trim();
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [scopedRows]);

  useEffect(() => {
    if (sourceFilter && !sourceOptions.includes(sourceFilter)) {
      setSourceFilter('');
    }
  }, [sourceFilter, sourceOptions]);

  const summary = useMemo(() => {
    const withGclid = scopedRows.filter(conversionExportRowHasGclid).length;
    const missingGclid = scopedRows.length - withGclid;
    const thisMonth = scopedRows.filter(conversionExportRowIsThisMonth).length;
    const sources = new Set(
      scopedRows.map((row) => String(row.source || '').trim()).filter(Boolean),
    ).size;
    const campaigns = new Set(
      scopedRows.map((row) => campaignIdFromUtm(row.utmParams)).filter(Boolean),
    ).size;
    const withValue = scopedRows.filter(conversionExportRowHasValue).length;
    return {
      total: scopedRows.length,
      withGclid,
      missingGclid,
      thisMonth,
      sources,
      campaigns,
      withValue,
      conversionSum: formatConversionSum(scopedRows),
      lastSent: formatLastSent(scopedRows[0]?.created_at),
    };
  }, [scopedRows]);

  const toggleFilter = (next: ConversionExportQuickFilter) => {
    setQuickFilter((prev) => (prev === next ? null : next));
  };

  const monthRange = currentMonthSentRange();
  const thisMonthDatesActive = sentFrom === monthRange.from && sentTo === monthRange.to;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <GradientSummaryCard
          label="Exported"
          value={loading ? '—' : summary.total}
          hint={
            summary.sources
              ? `${summary.sources} source${summary.sources === 1 ? '' : 's'} · ${summary.lastSent}`
              : summary.lastSent
          }
          icon={InboxStackIcon}
          gradientClassName={REPORT_SUMMARY_GRADIENTS[4]}
          active={quickFilter == null}
          onClick={() => setQuickFilter(null)}
        />
        <GradientSummaryCard
          label="With GCLID"
          value={loading ? '—' : summary.withGclid}
          hint="Ready for Google Ads upload"
          icon={CursorArrowRaysIcon}
          gradientClassName={REPORT_SUMMARY_GRADIENTS[1]}
          active={quickFilter === 'with_gclid'}
          onClick={() => toggleFilter('with_gclid')}
        />
        <GradientSummaryCard
          label="Missing GCLID"
          value={loading ? '—' : summary.missingGclid}
          hint="Sheet cell left empty"
          icon={ExclamationTriangleIcon}
          gradientClassName={REPORT_SUMMARY_GRADIENTS[0]}
          active={quickFilter === 'missing_gclid'}
          onClick={() => toggleFilter('missing_gclid')}
        />
        <GradientSummaryCard
          label="This month"
          value={loading ? '—' : summary.thisMonth}
          hint="Exported in the current month"
          icon={CalendarDaysIcon}
          gradientClassName={REPORT_SUMMARY_GRADIENTS[3]}
          active={thisMonthDatesActive || quickFilter === 'this_month'}
          onClick={() => {
            if (thisMonthDatesActive) {
              setSentFrom('');
              setSentTo('');
            } else {
              setSentFrom(monthRange.from);
              setSentTo(monthRange.to);
            }
            setQuickFilter((prev) => (prev === 'this_month' ? null : prev));
          }}
        />
        <GradientSummaryCard
          label="Conversion value"
          value={loading ? '—' : summary.conversionSum}
          hint={
            summary.campaigns
              ? `${summary.withValue} with value · ${summary.campaigns} campaign ID${summary.campaigns === 1 ? '' : 's'}`
              : `${summary.withValue} with a conversion value`
          }
          icon={BanknotesIcon}
          gradientClassName={REPORT_SUMMARY_GRADIENTS[2]}
          active={quickFilter === 'with_value'}
          onClick={() => toggleFilter('with_value')}
        />
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        {description ? (
          <p className="max-w-3xl text-sm text-gray-500">{description}</p>
        ) : (
          <p className="max-w-3xl text-sm text-gray-500">
            Export log of leads sent to the Google Sheet. Click a summary box to filter the table.
          </p>
        )}
        <div className="flex shrink-0 flex-col items-stretch gap-3 sm:items-end">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              className="checkbox checkbox-sm checkbox-primary"
              checked={includeDebug}
              onChange={(e) => setIncludeDebug(e.target.checked)}
            />
            Debug
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-outline btn-sm gap-1 bg-white"
              disabled={syncing}
              onClick={() => void runSync(true)}
            >
              {syncing ? <span className="loading loading-spinner loading-sm" /> : <ArrowPathIcon className="h-4 w-4" />}
              Dry run
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm gap-1"
              disabled={syncing}
              onClick={() => void runSync(false)}
            >
              {syncing ? <span className="loading loading-spinner loading-sm" /> : <CloudArrowUpIcon className="h-4 w-4" />}
              Sync now
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm bg-white"
              disabled={lastResponseJson == null}
              onClick={() => lastResponseJson != null && setResponseModalOpen(true)}
            >
              Last response
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 items-end gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100 sm:grid-cols-2 xl:grid-cols-4">
        <label className="block min-w-0">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
            Sent from
          </span>
          <input
            type="date"
            className="input input-bordered h-10 min-h-10 w-full bg-white"
            value={sentFrom}
            max={sentTo || undefined}
            onChange={(event) => setSentFrom(event.target.value)}
          />
        </label>
        <label className="block min-w-0">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
            Sent to
          </span>
          <input
            type="date"
            className="input input-bordered h-10 min-h-10 w-full bg-white"
            value={sentTo}
            min={sentFrom || undefined}
            onChange={(event) => setSentTo(event.target.value)}
          />
        </label>
        <label className="block min-w-0">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
            Source
          </span>
          <select
            id="conversion-export-source-filter"
            className="select select-bordered h-10 min-h-10 w-full bg-white"
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
          >
            <option value="">All sources</option>
            {sourceOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center">
          <button
            type="button"
            className="btn btn-ghost btn-sm h-10 min-h-10 text-gray-600"
            disabled={!sentFrom && !sentTo && !sourceFilter}
            onClick={() => {
              setSentFrom('');
              setSentTo('');
              setSourceFilter('');
            }}
          >
            Clear filters
          </button>
        </div>
      </div>

      {responseModalOpen && (
        <div className="modal modal-open z-[200]">
          <div className="modal-box max-w-3xl">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-lg font-bold">Last function response</h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-square shrink-0"
                aria-label="Close"
                onClick={() => setResponseModalOpen(false)}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <pre className="mt-4 max-h-[min(70vh,28rem)] overflow-auto rounded-lg bg-gray-100 p-4 text-xs leading-relaxed">
              {lastResponseJson ?? '—'}
            </pre>
            <div className="modal-action">
              <button type="button" className="btn btn-primary" onClick={() => setResponseModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
          <button
            type="button"
            className="modal-backdrop bg-black/50"
            aria-label="Close"
            onClick={() => setResponseModalOpen(false)}
          />
        </div>
      )}

      <GoogleSheetConversionExportTable
        rows={scopedRows}
        loading={loading}
        quickFilter={quickFilter}
        sourceFilter={sourceFilter}
      />
    </div>
  );
};

export default GoogleSheetConversionExportReport;
