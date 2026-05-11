/**
 * Marketing: leads appended to the BadLeads Google Sheet (export log).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ArrowPathIcon, CloudArrowUpIcon, TableCellsIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

const EXPORT_DESTINATION = 'bad_leads_capital_firm';

export type GoogleSheetConversionExportRow = {
  id: string;
  destination: string;
  lead_id: string;
  lead_number: string | null;
  lead_name: string | null;
  gclid: string;
  conversion_name: string;
  conversion_time: string;
  conversion_value: number;
  conversion_currency: string;
  spreadsheet_id: string | null;
  created_at: string;
};

function formatDt(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

const BadLeadsGoogleSheetExportReport: React.FC = () => {
  const [rows, setRows] = useState<GoogleSheetConversionExportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [includeDebug, setIncludeDebug] = useState(false);
  const [lastResponseJson, setLastResponseJson] = useState<string | null>(null);
  const [responseModalOpen, setResponseModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('google_sheet_conversion_exports')
        .select(
          'id, destination, lead_id, lead_number, lead_name, gclid, conversion_name, conversion_time, conversion_value, conversion_currency, spreadsheet_id, created_at',
        )
        .eq('destination', EXPORT_DESTINATION)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      setRows((data || []) as GoogleSheetConversionExportRow[]);
    } catch (e: unknown) {
      console.error(e);
      toast.error((e as Error)?.message || 'Failed to load export log');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runSync = async (dryRun: boolean) => {
    setSyncing(true);
    setLastResponseJson(null);
    try {
      const { data, error } = await supabase.functions.invoke('google-sheets-bad-leads-sync', {
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
        console.info('[BadLeadsGoogleSheetExportReport] function response', data);
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

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <TableCellsIcon className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-base-content">Bad leads → Google Sheet</h2>
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:items-end">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-base-content/70">
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
              className="btn btn-outline btn-sm gap-1"
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
              Sync to sheet
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={lastResponseJson == null}
              onClick={() => lastResponseJson != null && setResponseModalOpen(true)}
            >
              Last response
            </button>
          </div>
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
            <pre className="mt-4 max-h-[min(70vh,28rem)] overflow-auto rounded-lg bg-base-200 p-4 text-xs leading-relaxed">
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

      <div className="overflow-x-auto rounded-xl border border-base-300 bg-base-100">
        <table className="table table-zebra table-sm">
          <thead>
            <tr className="text-xs uppercase text-base-content/50">
              <th>Sent at</th>
              <th>Lead</th>
              <th>GCLID</th>
              <th>Conversion</th>
              <th>Lead time (UTC)</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="py-12 text-center">
                  <span className="loading loading-spinner loading-md text-primary" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center text-sm text-base-content/40">
                  —
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-sm">{formatDt(r.created_at)}</td>
                  <td>
                    {r.lead_number ? (
                      <Link
                        to={`/clients/${encodeURIComponent(r.lead_number)}`}
                        className="link link-primary font-medium"
                        target="_blank"
                        rel="noreferrer"
                      >
                        #{r.lead_number}
                      </Link>
                    ) : (
                      '—'
                    )}
                    {r.lead_name ? (
                      <div className="text-xs text-base-content/50">{r.lead_name}</div>
                    ) : null}
                  </td>
                  <td className="max-w-[14rem] truncate font-mono text-xs" title={r.gclid}>
                    {r.gclid}
                  </td>
                  <td className="text-sm">
                    {r.conversion_name}{' '}
                    <span className="text-base-content/40">
                      ({r.conversion_value} {r.conversion_currency})
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-xs text-base-content/60">{formatDt(r.conversion_time)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default BadLeadsGoogleSheetExportReport;
