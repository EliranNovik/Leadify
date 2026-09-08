import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import { leadSourceIdToString } from '../../lib/leadSourceId';

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
  source: string | null;
  utmParams: Record<string, string> | null;
};

const EXPORT_SELECT =
  'id, destination, lead_id, lead_number, lead_name, gclid, conversion_name, conversion_time, conversion_value, conversion_currency, spreadsheet_id, created_at';

/** Google Ads ValueTrack / landing-page param labels. */
const GOOGLE_PARAM_LABELS: Record<string, string> = {
  gclid: 'Google Click ID',
  gad_source: 'Google Ads source',
  gad_campaignid: 'Campaign ID',
  campaignid: 'Campaign ID',
  adgroupid: 'Ad group ID',
  creative: 'Ad / creative ID',
  keyword: 'Keyword',
  matchtype: 'Match type',
  device: 'Device',
  network: 'Network',
  targetid: 'Target ID',
  target: 'Target',
  lpurl: 'Landing page',
  placement: 'Placement',
  adposition: 'Ad position',
  loc_physical_ms: 'Physical location ID',
  loc_interest_ms: 'Location of interest ID',
  extensionid: 'Extension ID',
  feeditemid: 'Feed item ID',
  subid: 'Sub ID',
  utm_source: 'UTM source',
  utm_medium: 'UTM medium',
  utm_campaign: 'UTM campaign',
  utm_term: 'UTM term',
  utm_content: 'UTM content',
};

const MATCH_TYPE_MEANING: Record<string, string> = {
  e: 'Exact',
  p: 'Phrase',
  b: 'Broad',
};

const DEVICE_MEANING: Record<string, string> = {
  m: 'Mobile',
  t: 'Tablet',
  c: 'Computer',
};

const NETWORK_MEANING: Record<string, string> = {
  g: 'Google Search',
  s: 'Search partners',
  d: 'Display',
};

const TARGET_ID_PREFIX: Record<string, string> = {
  kwd: 'Keyword',
  aud: 'Audience',
  pla: 'Shopping product',
  dsa: 'Dynamic search target',
  loc: 'Location',
};

export function formatConversionAmount(
  value: number | null | undefined,
  currencyCode: string | null | undefined,
): string {
  const amount = Number(value) || 0;
  const raw = String(currencyCode || 'ILS').trim().toUpperCase();
  const currency = raw === 'NIS' || raw === '₪' ? 'ILS' : raw || 'ILS';
  try {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString()} ${currency}`;
  }
}

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

function sourceLabel(source: string | null | undefined): string {
  const value = String(source || '').trim();
  return value || '—';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      try {
        const qs = trimmed.includes('?') ? trimmed.split('?').slice(1).join('?') : trimmed;
        const params = new URLSearchParams(qs);
        const obj: Record<string, unknown> = {};
        for (const [key, val] of params.entries()) {
          if (val.trim()) obj[key] = val.trim();
        }
        return Object.keys(obj).length ? obj : null;
      } catch {
        return { value: trimmed };
      }
    }
    return null;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function normalizeUtmParams(value: unknown): Record<string, string> | null {
  const record = asRecord(value);
  if (!record) return null;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (raw == null) continue;
    const text = String(raw).trim();
    if (!text) continue;
    out[key] = text;
  }
  return Object.keys(out).length ? out : null;
}

function paramLabel(key: string): string {
  return GOOGLE_PARAM_LABELS[key.toLowerCase()] || key;
}

function decodeTargetId(value: string): string {
  const match = value.match(/^([a-z]+)-(.+)$/i);
  if (!match) return value;
  const meaning = TARGET_ID_PREFIX[match[1].toLowerCase()];
  return meaning ? `${meaning} ${match[2]}` : value;
}

function paramDisplayValue(key: string, value: string): string {
  const k = key.toLowerCase();
  if (k === 'matchtype') return MATCH_TYPE_MEANING[value.toLowerCase()] || value;
  if (k === 'device') return DEVICE_MEANING[value.toLowerCase()] || value;
  if (k === 'network') return NETWORK_MEANING[value.toLowerCase()] || value;
  if (k === 'targetid') return decodeTargetId(value);
  return value;
}

function utmEntries(params: Record<string, string> | null): Array<{ key: string; label: string; value: string }> {
  if (!params) return [];
  return Object.entries(params)
    .filter(([key]) => key.toLowerCase() !== 'gclid')
    .sort(([a], [b]) => paramLabel(a).localeCompare(paramLabel(b)))
    .map(([key, value]) => ({
      key,
      label: paramLabel(key),
      value: paramDisplayValue(key, value),
    }));
}

export function campaignIdFromUtm(params: Record<string, string> | null): string | null {
  if (!params) return null;
  const match = Object.entries(params).find(([key]) => {
    const k = key.toLowerCase();
    return k === 'campaignid' || k === 'gad_campaignid';
  });
  return match?.[1] || null;
}

export type ConversionExportQuickFilter =
  | 'with_gclid'
  | 'missing_gclid'
  | 'this_month'
  | 'with_value';

export function conversionExportRowHasGclid(row: GoogleSheetConversionExportRow): boolean {
  return Boolean(String(row.gclid || '').trim());
}

export function conversionExportRowIsThisMonth(row: GoogleSheetConversionExportRow): boolean {
  const sent = new Date(row.created_at);
  if (Number.isNaN(sent.getTime())) return false;
  const now = new Date();
  return sent.getFullYear() === now.getFullYear() && sent.getMonth() === now.getMonth();
}

export function conversionExportRowHasValue(row: GoogleSheetConversionExportRow): boolean {
  return (Number(row.conversion_value) || 0) > 0;
}

function isCampaignIdKey(key: string): boolean {
  const k = key.toLowerCase();
  return k === 'campaignid' || k === 'gad_campaignid';
}

export function localYmdFromIso(iso: string): string {
  const sent = new Date(iso);
  if (Number.isNaN(sent.getTime())) return '';
  const y = sent.getFullYear();
  const m = String(sent.getMonth() + 1).padStart(2, '0');
  const day = String(sent.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function sentAtInLocalRange(iso: string, from: string, to: string): boolean {
  const ymd = localYmdFromIso(iso);
  if (!ymd) return false;
  if (from && ymd < from) return false;
  if (to && ymd > to) return false;
  return true;
}

function startOfLocalDayIso(ymd: string): string {
  return new Date(`${ymd}T00:00:00`).toISOString();
}

function endOfLocalDayIso(ymd: string): string {
  return new Date(`${ymd}T23:59:59.999`).toISOString();
}

export async function loadGoogleSheetConversionExports(
  destination: string,
  options?: { sentFrom?: string; sentTo?: string },
): Promise<GoogleSheetConversionExportRow[]> {
  const sentFrom = String(options?.sentFrom || '').trim();
  const sentTo = String(options?.sentTo || '').trim();
  let from = sentFrom;
  let to = sentTo;
  if (from && to && from > to) {
    const swapped = from;
    from = to;
    to = swapped;
  }

  let query = supabase
    .from('google_sheet_conversion_exports')
    .select(EXPORT_SELECT)
    .eq('destination', destination)
    .order('created_at', { ascending: false });

  if (from) query = query.gte('created_at', startOfLocalDayIso(from));
  if (to) query = query.lte('created_at', endOfLocalDayIso(to));
  query = query.limit(from || to ? 5000 : 500);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data || []) as Omit<GoogleSheetConversionExportRow, 'source' | 'utmParams'>[];
  const leadIds = [...new Set(rows.map((row) => row.lead_id).filter(Boolean))];
  if (!leadIds.length) {
    return rows.map((row) => ({ ...row, source: null, utmParams: null }));
  }

  const { data: leads, error: leadsError } = await supabase
    .from('leads')
    .select('id, source, source_id, utm_params')
    .in('id', leadIds);
  if (leadsError) throw leadsError;

  const sourceIds = [
    ...new Set(
      (leads || [])
        .map((lead) => leadSourceIdToString(lead.source_id))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const nameBySourceId = new Map<string, string>();
  if (sourceIds.length) {
    const { data: sources } = await supabase
      .from('misc_leadsource')
      .select('id, name')
      .in('id', sourceIds);
    for (const source of sources || []) {
      const id = leadSourceIdToString(source.id);
      const name = String(source.name || '').trim();
      if (id && name) nameBySourceId.set(id, name);
    }
  }

  const sourceByLeadId = new Map<string, string | null>();
  const utmByLeadId = new Map<string, Record<string, string> | null>();
  for (const lead of leads || []) {
    const fromCatalog = nameBySourceId.get(leadSourceIdToString(lead.source_id) || '') || null;
    const fromLead = String(lead.source || '').trim() || null;
    sourceByLeadId.set(String(lead.id), fromCatalog || fromLead);
    utmByLeadId.set(String(lead.id), normalizeUtmParams(lead.utm_params));
  }

  return rows.map((row) => {
    const utmParams = utmByLeadId.get(row.lead_id) || null;
    const gclid = String(row.gclid || '').trim() || utmParams?.gclid || '';
    return {
      ...row,
      gclid,
      source: sourceByLeadId.get(row.lead_id) || null,
      utmParams,
    };
  });
}

type GoogleSheetConversionExportTableProps = {
  rows: GoogleSheetConversionExportRow[];
  loading: boolean;
  quickFilter?: ConversionExportQuickFilter | null;
  sourceFilter?: string;
};

const GoogleSheetConversionExportTable: React.FC<GoogleSheetConversionExportTableProps> = ({
  rows,
  loading,
  quickFilter = null,
  sourceFilter = '',
}) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const filteredRows = useMemo(() => {
    let next = rows;
    if (sourceFilter) {
      next = next.filter((row) => String(row.source || '').trim() === sourceFilter);
    }
    if (quickFilter === 'with_gclid') {
      next = next.filter(conversionExportRowHasGclid);
    } else if (quickFilter === 'missing_gclid') {
      next = next.filter((row) => !conversionExportRowHasGclid(row));
    } else if (quickFilter === 'this_month') {
      next = next.filter(conversionExportRowIsThisMonth);
    } else if (quickFilter === 'with_value') {
      next = next.filter(conversionExportRowHasValue);
    }
    return next;
  }, [rows, sourceFilter, quickFilter]);

  const toggleRow = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
      <div className="overflow-x-auto">
        <table className="table w-full border-0 text-base [&_td]:border-0 [&_th]:border-0">
          <thead>
            <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-500">
              <th>Sent at</th>
              <th>Lead</th>
              <th>Source</th>
              <th>GCLID</th>
              <th>Campaign ID</th>
              <th>Conversion</th>
              <th>Lead time (UTC)</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="py-16 text-center">
                  <span className="loading loading-spinner loading-md text-primary" />
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-16 text-center text-sm text-gray-500">
                  No exported rows match these filters.
                </td>
              </tr>
            ) : (
              filteredRows.map((r) => {
                const adsParams = utmEntries(r.utmParams);
                const extraParams = adsParams.filter((entry) => !isCampaignIdKey(entry.key));
                const campaignId = campaignIdFromUtm(r.utmParams);
                const expanded = expandedIds.has(r.id);
                const canExpand = extraParams.length > 0;
                return (
                <React.Fragment key={r.id}>
                <tr
                  className={canExpand ? 'cursor-pointer hover:bg-gray-50' : ''}
                  onClick={() => {
                    if (canExpand) toggleRow(r.id);
                  }}
                  aria-expanded={canExpand ? expanded : undefined}
                >
                  <td className="whitespace-nowrap">{formatDt(r.created_at)}</td>
                  <td>
                    {r.lead_number ? (
                      <Link
                        to={`/clients/${encodeURIComponent(r.lead_number)}`}
                        className="link link-primary font-medium"
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                      >
                        #{r.lead_number}
                      </Link>
                    ) : (
                      '—'
                    )}
                    {r.lead_name ? (
                      <div className="text-sm text-gray-500">{r.lead_name}</div>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap">{sourceLabel(r.source)}</td>
                  <td className="max-w-[14rem] truncate" title={r.gclid}>
                    {r.gclid || '—'}
                  </td>
                  <td className="whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      {canExpand ? (
                        <ChevronRightIcon
                          className={`h-4 w-4 shrink-0 text-base-content/50 transition-transform ${expanded ? 'rotate-90' : ''}`}
                        />
                      ) : null}
                      {campaignId || '—'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap font-semibold tabular-nums text-emerald-600">
                    {formatConversionAmount(r.conversion_value, r.conversion_currency)}
                  </td>
                  <td className="whitespace-nowrap text-gray-500">{formatDt(r.conversion_time)}</td>
                </tr>
                {expanded && canExpand ? (
                  <tr className="bg-gray-50">
                    <td colSpan={7} className="py-3">
                      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {extraParams.map((entry) => (
                          <div key={`${r.id}-${entry.key}`} className="leading-snug">
                            <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">
                              {entry.label}
                            </dt>
                            <dd className="break-all text-sm text-gray-800" title={entry.value}>
                              {/^https?:\/\//i.test(entry.value) ? (
                                <a
                                  href={entry.value}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="link link-primary"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  {entry.value}
                                </a>
                              ) : (
                                entry.value
                              )}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </td>
                  </tr>
                ) : null}
                </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default GoogleSheetConversionExportTable;
