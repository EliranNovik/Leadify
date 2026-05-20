/**
 * Test / ops UI: preview BOI API, sync to boi_exchange_rates, view saved rows.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  CurrencyDollarIcon,
  GlobeAltIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import {
  DEFAULT_BASE_CURRENCIES,
  buildBoiExrUrl,
  parseBaseCurrenciesInput,
  type BoiRateRow,
} from '../lib/boiExchangeRates';
import toast from 'react-hot-toast';

export type BoiExchangeRateRow = {
  id: string;
  rate_date: string;
  base_currency: string;
  target_currency: string;
  rate: number;
  source: string;
  created_at: string;
};

function formatDt(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function formatRate(rate: number) {
  return Number(rate).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 });
}

const BoiExchangeRatesTestPage: React.FC = () => {
  const [currenciesInput, setCurrenciesInput] = useState(DEFAULT_BASE_CURRENCIES.join(', '));
  const [dbRows, setDbRows] = useState<BoiExchangeRateRow[]>([]);
  const [previewRows, setPreviewRows] = useState<BoiRateRow[]>([]);
  const [loadingDb, setLoadingDb] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filterDate, setFilterDate] = useState<string>('');
  const [lastApiUrl, setLastApiUrl] = useState<string | null>(null);
  const [lastResponseJson, setLastResponseJson] = useState<string | null>(null);
  const [responseModalOpen, setResponseModalOpen] = useState(false);

  const baseCurrencies = useMemo(
    () => parseBaseCurrenciesInput(currenciesInput),
    [currenciesInput],
  );

  useEffect(() => {
    setLastApiUrl(buildBoiExrUrl(baseCurrencies, 1));
  }, [baseCurrencies]);

  const loadFromDb = useCallback(async () => {
    setLoadingDb(true);
    try {
      let query = supabase
        .from('boi_exchange_rates')
        .select('id, rate_date, base_currency, target_currency, rate, source, created_at')
        .order('rate_date', { ascending: false })
        .order('base_currency', { ascending: true })
        .limit(500);

      if (filterDate) {
        query = query.eq('rate_date', filterDate);
      }

      const { data, error } = await query;
      if (error) throw error;
      setDbRows((data || []) as BoiExchangeRateRow[]);
    } catch (e: unknown) {
      console.error(e);
      toast.error((e as Error)?.message || 'Failed to load rates from database');
      setDbRows([]);
    } finally {
      setLoadingDb(false);
    }
  }, [filterDate]);

  useEffect(() => {
    void loadFromDb();
  }, [loadFromDb]);

  const availableDates = useMemo(() => {
    const dates = new Set(dbRows.map((r) => r.rate_date));
    return Array.from(dates).sort((a, b) => b.localeCompare(a));
  }, [dbRows]);

  const runEdgeSync = async (dryRun: boolean) => {
    setSyncing(true);
    setLastResponseJson(null);
    try {
      const { data, error } = await supabase.functions.invoke('boi-exchange-rates-sync', {
        body: { dryRun, currencies: baseCurrencies },
      });

      const snapshot = {
        data: data ?? null,
        invokeTransportError: error
          ? {
              message: (error as Error).message ?? String(error),
              name: (error as Error).name,
            }
          : null,
      };
      setLastResponseJson(JSON.stringify(snapshot, null, 2));

      if (error) {
        toast.error((error as Error).message || 'Sync failed');
        return;
      }

      const d = data as {
        success?: boolean;
        error?: string;
        dryRun?: boolean;
        fetched?: number;
        saved?: number;
        rates?: BoiRateRow[];
        apiUrl?: string;
      };

      if (d?.error || d?.success === false) {
        toast.error(d?.error || 'Sync failed');
        return;
      }

      if (d.apiUrl) setLastApiUrl(d.apiUrl);

      if (d.rates?.length) {
        setPreviewRows(d.rates);
      }

      if (dryRun) {
        toast.success(`Fetched ${d.fetched ?? 0} rate(s) from BOI via server (not saved).`);
      } else {
        toast.success(`Saved ${d.saved ?? d.fetched ?? 0} rate(s) to boi_exchange_rates.`);
        await loadFromDb();
      }
    } catch (e: unknown) {
      console.error(e);
      const msg = (e as Error)?.message || 'Sync failed';
      toast.error(
        msg.includes('Function not found') || msg.includes('404')
          ? `${msg} — deploy: supabase functions deploy boi-exchange-rates-sync`
          : msg,
      );
    } finally {
      setSyncing(false);
    }
  };

  const loadViaRpc = async () => {
    setLoadingDb(true);
    try {
      const { data, error } = await supabase.rpc('get_boi_exchange_rates_for_date', {
        p_rate_date: filterDate || null,
      });
      if (error) throw error;
      setDbRows((data || []) as BoiExchangeRateRow[]);
      toast.success(`Loaded ${(data || []).length} row(s) via RPC.`);
    } catch (e: unknown) {
      toast.error((e as Error)?.message || 'RPC failed');
    } finally {
      setLoadingDb(false);
    }
  };

  const displayRows = previewRows.length > 0 ? previewRows : null;

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex gap-3">
          <div className="rounded-xl bg-primary/10 p-3">
            <CurrencyDollarIcon className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">BOI exchange rates</h1>
            <p className="text-base-content/70 text-sm mt-1">
              Test Bank of Israel API and sync into <code className="text-xs">boi_exchange_rates</code>.
              BOI blocks browser calls (CORS); fetch runs on the Supabase edge function.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void loadFromDb()}
          disabled={loadingDb}
        >
          <ArrowPathIcon className={`h-5 w-5 ${loadingDb ? 'animate-spin' : ''}`} />
          Refresh DB
        </button>
      </div>

      <div className="card bg-base-100 border border-base-300 shadow-sm">
        <div className="card-body gap-4">
          <h2 className="card-title text-lg">API &amp; sync</h2>
          <label className="form-control w-full">
            <span className="label-text font-medium">Base currencies (comma-separated)</span>
            <input
              type="text"
              className="input input-bordered w-full font-mono text-sm"
              value={currenciesInput}
              onChange={(e) => setCurrenciesInput(e.target.value)}
              placeholder={DEFAULT_BASE_CURRENCIES.join(', ')}
            />
          </label>
          {lastApiUrl && (
            <p className="text-xs text-base-content/60 break-all">
              <GlobeAltIcon className="inline h-4 w-4 mr-1" />
              {lastApiUrl}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={syncing}
              onClick={() => void runEdgeSync(true)}
            >
              {syncing ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                <CloudArrowDownIcon className="h-5 w-5" />
              )}
              Fetch from BOI API
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={syncing}
              onClick={() => void runEdgeSync(false)}
            >
              {syncing ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                <CloudArrowUpIcon className="h-5 w-5" />
              )}
              Save to database
            </button>
            {lastResponseJson && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setResponseModalOpen(true)}
              >
                View last JSON
              </button>
            )}
          </div>
        </div>
      </div>

      {displayRows && (
        <div className="card bg-base-100 border border-warning/30 shadow-sm">
          <div className="card-body">
            <h2 className="card-title text-lg">API preview ({displayRows.length} rows)</h2>
            <div className="overflow-x-auto">
              <table className="table table-sm table-zebra">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Pair</th>
                    <th className="text-right">Rate (ILS per 1)</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((r) => (
                    <tr key={`${r.rate_date}-${r.base_currency}`}>
                      <td>{r.rate_date}</td>
                      <td>
                        {r.base_currency} → {r.target_currency}
                      </td>
                      <td className="text-right font-mono">{formatRate(r.rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="card bg-base-100 border border-base-300 shadow-sm">
        <div className="card-body gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="card-title text-lg">Saved in database</h2>
            <div className="flex flex-wrap gap-2 items-end">
              <label className="form-control">
                <span className="label-text text-xs">Rate date</span>
                <select
                  className="select select-bordered select-sm"
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                >
                  <option value="">All (latest 500)</option>
                  {availableDates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => void loadViaRpc()}>
                Load via RPC
              </button>
            </div>
          </div>

          {loadingDb ? (
            <div className="flex justify-center py-8">
              <span className="loading loading-spinner loading-lg text-primary" />
            </div>
          ) : dbRows.length === 0 ? (
            <p className="text-base-content/60 text-sm py-4">
              No rows yet. Run <strong>Sync to database</strong> after deploying the edge function and
              running <code className="text-xs">create_boi_exchange_rates_table.sql</code>.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm table-zebra">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Pair</th>
                    <th className="text-right">Rate</th>
                    <th>Source</th>
                    <th>Saved at</th>
                  </tr>
                </thead>
                <tbody>
                  {dbRows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.rate_date}</td>
                      <td>
                        {r.base_currency} → {r.target_currency}
                      </td>
                      <td className="text-right font-mono">{formatRate(r.rate)}</td>
                      <td className="text-xs">{r.source}</td>
                      <td className="text-xs whitespace-nowrap">{formatDt(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {responseModalOpen && lastResponseJson && (
        <div className="modal modal-open">
          <div className="modal-box max-w-4xl w-full">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-bold text-lg">Last API response</h3>
              <button
                type="button"
                className="btn btn-sm btn-circle btn-ghost"
                onClick={() => setResponseModalOpen(false)}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <pre className="bg-base-200 p-4 rounded-lg text-xs overflow-auto max-h-[60vh] whitespace-pre-wrap">
              {lastResponseJson}
            </pre>
            <div className="modal-action">
              <button type="button" className="btn" onClick={() => setResponseModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Close"
            onClick={() => setResponseModalOpen(false)}
          />
        </div>
      )}
    </div>
  );
};

export default BoiExchangeRatesTestPage;
