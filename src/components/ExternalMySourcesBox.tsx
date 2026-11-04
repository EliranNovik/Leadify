import React, { useEffect, useState } from 'react';
import { ChevronDownIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
import {
  fetchMySourcesAllTimeStats,
  type MySourceAllTimeRow,
} from '../lib/externalMySourcesStats';

function fmtMoney(n: number) {
  return `₪ ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

type Props = {
  sourceIds: string[];
};

/**
 * Top-right "My Sources" control for external reports.
 * Shows all-time leads / invoiced / revenue per assigned source (not tied to report date filters).
 */
const ExternalMySourcesBox: React.FC<Props> = ({ sourceIds }) => {
  const [rows, setRows] = useState<MySourceAllTimeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await fetchMySourcesAllTimeStats(sourceIds);
        if (!cancelled) setRows(next);
      } catch (e) {
        console.error('[ExternalMySourcesBox]', e);
        if (!cancelled) {
          setError('Could not load source totals.');
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceIds.join('|')]);

  const totalLeads = rows.reduce((s, r) => s + r.leads, 0);

  return (
    <div className="dropdown dropdown-end">
      <div
        tabIndex={0}
        role="button"
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-2xl border border-base-300 bg-white px-4 py-2.5 text-sm font-semibold text-base-content shadow-sm transition hover:border-base-content/20 hover:shadow-md"
      >
        <Squares2X2Icon className="h-5 w-5 text-primary" aria-hidden />
        <span>My Sources</span>
        <span className="rounded-full bg-base-200 px-2 py-0.5 text-xs font-bold text-base-content/70">
          {sourceIds.length}
        </span>
        <ChevronDownIcon className="h-4 w-4 opacity-50" aria-hidden />
      </div>
      <div
        tabIndex={0}
        className="dropdown-content z-[60] mt-2 w-[min(100vw-2rem,28rem)] overflow-hidden rounded-2xl border border-base-300 bg-white shadow-xl"
      >
        <div className="border-b border-base-200 px-4 py-3">
          <p className="text-sm font-bold text-base-content">My Sources</p>
          <p className="mt-0.5 text-xs text-base-content/55">All-time totals · not filtered by report dates</p>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <span className="loading loading-spinner loading-md text-primary" />
          </div>
        ) : error ? (
          <p className="px-4 py-6 text-center text-sm text-error">{error}</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-base-content/55">No sources assigned.</p>
        ) : (
          <div className="max-h-[min(24rem,60vh)] overflow-y-auto">
            <table className="table table-sm">
              <thead className="sticky top-0 bg-base-100 text-[11px] uppercase tracking-wide text-base-content/50">
                <tr>
                  <th className="font-semibold">Source</th>
                  <th className="text-right font-semibold">Leads</th>
                  <th className="bg-base-200/70 text-right font-semibold">Invoiced</th>
                  <th className="bg-base-200/70 text-right font-semibold">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-base-200/80">
                    <td className="max-w-[11rem] whitespace-normal break-words text-sm font-medium leading-snug">
                      {r.name}
                    </td>
                    <td className="text-right tabular-nums text-sm">{r.leads.toLocaleString()}</td>
                    <td className="bg-base-200/50 text-right tabular-nums text-sm">{fmtMoney(r.invoicedNis)}</td>
                    <td className="bg-base-200/50 text-right tabular-nums text-sm font-medium text-green-600">
                      {fmtMoney(r.revenueNis)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-base-300 bg-base-200/60 font-bold">
                  <td className="text-sm">Total</td>
                  <td className="text-right tabular-nums text-sm">{totalLeads.toLocaleString()}</td>
                  <td className="bg-base-200 text-right tabular-nums text-sm">
                    {fmtMoney(rows.reduce((s, r) => s + r.invoicedNis, 0))}
                  </td>
                  <td className="bg-base-200 text-right tabular-nums text-sm text-green-600">
                    {fmtMoney(rows.reduce((s, r) => s + r.revenueNis, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExternalMySourcesBox;
