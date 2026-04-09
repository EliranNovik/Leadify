/** Marketing performance dashboard — see “About this report” in the UI for methodology. */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fetchStageNames, getStageName } from '../lib/stageUtils';
import { convertToNIS } from '../lib/currencyConversion';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { MegaphoneIcon } from '@heroicons/react/24/solid';
import { ChevronDownIcon, InformationCircleIcon } from '@heroicons/react/24/outline';

type ChannelRow = { id: string; code: string; label: string };
type SourceRow = { id: number; name: string; channel_id: string | null };
type FirmRow = { id: string; name: string };
type CountryRow = { id: number; name: string };

type LeadRow = {
  id: string;
  created_at: string;
  lead_number: string | null;
  /** Display name of scheduler (match tenants_employee.display_name); primary for CTI match */
  scheduler: string | null;
  /** Fallback when scheduler text does not resolve */
  meeting_scheduler_id: number | null;
  stage: string | number | null;
  source: string | null;
  source_id: number | null;
  status: string | null;
  eligible: boolean | null;
  eligibility_status: string | null;
  unactivated_at: string | null;
  unactivation_reason: string | null;
  balance: number | null;
  proposal_total: number | null;
  balance_currency: string | null;
  probability: number | null;
  country_id: number | null;
  misc_country?: { id: number; name: string } | null;
  misc_leadsource?: {
    id: number;
    name: string;
    channel_id: string | null;
  } | null;
};

/** Rows from call_logs (scheduler calls tied to lead via client_id and/or lead_id + employee_id). */
type CallLogRow = {
  id?: number;
  employee_id: number | null;
  lead_id: number | null;
  client_id: string | null;
  duration: number | null;
  cdate: string | null;
};

type GroupMode = 'source' | 'channel';

const STRING_STAGE_RANK: Record<string, number> = {
  created: 0,
  scheduler_assigned: 10,
  meeting_scheduled: 20,
  meeting_paid: 22,
  communication_started: 25,
  another_meeting: 28,
  revised_offer: 40,
  offer_sent: 45,
  waiting_for_mtng_sum: 48,
  meeting_ended: 49,
  meeting_rescheduled: 20,
  client_signed: 60,
  client_declined: 0,
  lead_summary: 55,
  unactivated: 0,
  payment_request_sent: 70,
  finances_and_payments_plan: 75,
};

function stageRank(lead: LeadRow): number {
  const s = lead.stage;
  if (s === null || s === undefined) return 0;
  if (typeof s === 'number' && !Number.isNaN(s)) return s;
  const str = String(s).trim();
  const asNum = parseInt(str, 10);
  if (!Number.isNaN(asNum) && String(asNum) === str) return asNum;
  const low = str.toLowerCase().replace(/\s+/g, '_');
  if (STRING_STAGE_RANK[low] !== undefined) return STRING_STAGE_RANK[low];
  return 0;
}

function isInactiveLead(lead: LeadRow): boolean {
  if (lead.unactivated_at) return true;
  if (lead.status === 'inactive') return true;
  const r = stageRank(lead);
  if (r === 91) return true;
  return false;
}

/** Simplified eligibility vs boss spec — extend when stage_history + inactive reasons are modeled. */
function isEligibleLead(lead: LeadRow): boolean {
  if (isInactiveLead(lead)) {
    const reason = (lead.unactivation_reason || '').toLowerCase();
    if (reason.includes('no legal') || reason.includes('eligib')) return false;
  }
  const r = stageRank(lead);
  if (r >= 45) return true;
  if (lead.eligible === true) return true;
  if (lead.eligibility_status && String(lead.eligibility_status).toLowerCase().includes('eligible')) return true;
  if (r >= 20 && !isInactiveLead(lead)) return true;
  return false;
}

function hasMeetingOrBeyond(lead: LeadRow): boolean {
  return stageRank(lead) >= 20;
}

function hasOfferOrBeyond(lead: LeadRow): boolean {
  return stageRank(lead) >= 45;
}

function hasSignedDeal(lead: LeadRow): boolean {
  const r = stageRank(lead);
  if (r >= 60) return true;
  const name = getStageName(String(lead.stage ?? '')).toLowerCase();
  return name.includes('signed') && name.includes('client');
}

/** Numeric stage ids aligned with Scheduled report / pipeline (history_leads.stage is bigint). */
const HIST_STAGE = {
  communication: 15,
  meeting: 20,
  offer: 45,
  signed: 60,
  payment: 70,
} as const;

type HistoryLeadRow = {
  original_id: string;
  stage: number | string | null;
  changed_at: string | null;
  communication_started_at: string | null;
};

function parseHistStage(stage: unknown): number | null {
  if (stage === null || stage === undefined) return null;
  const n = typeof stage === 'number' ? stage : Number(String(stage).trim());
  return Number.isFinite(n) ? n : null;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Earliest changed_at when stage first satisfies predicate (history sorted chronologically). */
function firstChangedAtWhenStage(
  rows: HistoryLeadRow[],
  pred: (stage: number) => boolean
): number | null {
  const sorted = [...rows].sort(
    (a, b) => (ms(a.changed_at) ?? 0) - (ms(b.changed_at) ?? 0)
  );
  for (const r of sorted) {
    const st = parseHistStage(r.stage);
    if (st !== null && pred(st)) return ms(r.changed_at);
  }
  return null;
}

/** Earliest non-null communication_started_at on any snapshot. */
function earliestCommunicationField(rows: HistoryLeadRow[]): number | null {
  let best: number | null = null;
  for (const r of rows) {
    const t = ms(r.communication_started_at);
    if (t != null && (best === null || t < best)) best = t;
  }
  return best;
}

/** First “communication started” time: stage ≥15 snapshot or communication_started_at field. */
function firstCommunicationAt(rows: HistoryLeadRow[], leadCreatedMs: number): number | null {
  const byStage = firstChangedAtWhenStage(rows, (s) => s >= HIST_STAGE.communication);
  const byField = earliestCommunicationField(rows);
  const candidates = [byStage, byField].filter((x): x is number => x != null && x >= leadCreatedMs);
  if (!candidates.length) return null;
  return Math.min(...candidates);
}

function daysBetween(fromMs: number | null, toMs: number | null): number | null {
  if (fromMs == null || toMs == null) return null;
  if (toMs < fromMs) return null;
  return (toMs - fromMs) / (1000 * 60 * 60 * 24);
}

function average(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Digits-only number from lead_number — legacy CTI may store this in call_logs.lead_id; new leads use client_id. */
function leadNumberAsCallLeadId(lead: LeadRow): number | null {
  const raw = String(lead.lead_number ?? '').replace(/\D/g, '');
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Normalize scheduler display string for lookup (trim, lower, collapse spaces). */
function normalizeSchedulerDisplayKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Resolve tenants_employee.id for call_logs: use `scheduler` name first, then meeting_scheduler_id.
 */
function resolveSchedulerEmployeeId(
  lead: LeadRow,
  displayNameToEmployeeId: Map<string, number>
): number | null {
  const label = (lead.scheduler || '').trim();
  if (label && label !== '---') {
    const k = normalizeSchedulerDisplayKey(label);
    if (k) {
      const fromName = displayNameToEmployeeId.get(k);
      if (fromName != null) return fromName;
    }
  }
  if (lead.meeting_scheduler_id != null && !Number.isNaN(Number(lead.meeting_scheduler_id))) {
    return Number(lead.meeting_scheduler_id);
  }
  return null;
}

function leadRevenueNis(lead: LeadRow): number {
  const raw = Number(lead.balance ?? lead.proposal_total ?? 0);
  if (!raw) return 0;
  const sym = lead.balance_currency || '₪';
  try {
    return convertToNIS(raw, sym);
  } catch {
    return raw;
  }
}

type AggRow = {
  key: string;
  channel: string;
  source: string;
  provider: string;
  leads: number;
  eligible: number;
  meetings: number;
  offers: number;
  deals: number;
  revenueNis: number;
  inactive: number;
  notEligible: number;
};

type MultiFilterOption = { id: string; label: string };

/**
 * Search input + multi-select list. Selected rows are checked; order is fixed while open (selected-first snapshot
 * when the menu opens) so toggling does not re-sort or scroll-jump. Empty selection = all (no filter).
 */
function MarketingSearchMultiFilter({
  label,
  placeholder,
  options,
  selected,
  onChange,
}: {
  label: string;
  placeholder: string;
  options: MultiFilterOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(false);
  /** Row id order for the open menu — frozen when the dropdown opens; filter only narrows, does not re-sort. */
  const [frozenIds, setFrozenIds] = useState<string[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** False again after the menu closes — used so we snapshot row order once per open, not on every checkbox toggle. */
  const wasOpenRef = useRef(false);

  useLayoutEffect(() => {
    if (!open) {
      setFrozenIds(null);
      wasOpenRef.current = false;
      return;
    }
    if (options.length === 0) return;

    if (!wasOpenRef.current || frozenIds == null) {
      const sel = new Set(selected);
      const sorted = [...options].sort((a, b) => {
        const aOn = sel.has(a.id);
        const bOn = sel.has(b.id);
        if (aOn !== bOn) return aOn ? -1 : 1;
        return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
      });
      setFrozenIds(sorted.map((o) => o.id));
    }
    wasOpenRef.current = true;
  }, [open, options, selected, frozenIds]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const idToOption = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);

  const q = filter.trim().toLowerCase();
  const displayOptions = useMemo(() => {
    const matches = (o: MultiFilterOption) => !q || o.label.toLowerCase().includes(q);
    if (open && frozenIds && frozenIds.length > 0) {
      return frozenIds
        .map((id) => idToOption.get(id))
        .filter((o): o is MultiFilterOption => !!o && matches(o));
    }
    const base = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : [...options];
    const sel = new Set(selected);
    return [...base].sort((a, b) => {
      const aOn = sel.has(a.id);
      const bOn = sel.has(b.id);
      if (aOn !== bOn) return aOn ? -1 : 1;
      return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    });
  }, [open, frozenIds, q, options, selected, idToOption]);

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((x) => x !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  const inputPlaceholder =
    selected.length > 0 ? `${selected.length} selected · type to filter` : placeholder;

  return (
    <div className="form-control min-w-0" ref={containerRef}>
      <span className="label-text mb-1 text-xs font-semibold">{label}</span>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          className={`input input-bordered input-sm w-full pr-[4.5rem] ${
            open ? 'border-primary ring-1 ring-primary/30' : ''
          }`}
          placeholder={inputPlaceholder}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
          autoComplete="off"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={selected.length > 0 ? `${label}: ${selected.length} selected` : label}
        />

        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          {selected.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-xs h-6 min-h-0 px-1.5 text-[10px] font-normal"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange([]);
                inputRef.current?.focus();
              }}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            className="rounded p-0.5 text-base-content/50 hover:bg-base-200 hover:text-base-content"
            tabIndex={-1}
            aria-label={open ? 'Close list' : 'Open list'}
            onMouseDown={(e) => {
              e.preventDefault();
              setOpen((o) => !o);
              inputRef.current?.focus();
            }}
          >
            <ChevronDownIcon className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {open && (
          <div
            className="absolute left-0 right-0 top-full z-40 mt-1 max-h-48 overflow-y-auto overflow-x-hidden rounded-lg border border-base-300 bg-base-100 shadow-lg"
            style={{ overflowAnchor: 'none' } as React.CSSProperties}
            role="listbox"
            aria-multiselectable
          >
            {displayOptions.length === 0 ? (
              <div className="px-3 py-3 text-xs text-base-content/60">No matches.</div>
            ) : (
              <ul className="py-1">
                {displayOptions.map((opt) => {
                  const isOn = selected.includes(opt.id);
                  return (
                    <li key={opt.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isOn}
                        className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-base-200 ${
                          isOn ? 'bg-primary/10 text-primary' : ''
                        }`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          toggle(opt.id);
                        }}
                      >
                        <span
                          className={`flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded border ${
                            isOn ? 'border-primary bg-primary' : 'border-base-300'
                          }`}
                        >
                          {isOn && <span className="text-[8px] leading-none text-white">✓</span>}
                        </span>
                        <span className="truncate">{opt.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const MarketingDashboardReport: React.FC = () => {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [countryIds, setCountryIds] = useState<string[]>([]);
  const [firmIds, setFirmIds] = useState<string[]>([]);
  const [groupMode, setGroupMode] = useState<GroupMode>('source');
  const [includeHrCost, setIncludeHrCost] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);

  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [firms, setFirms] = useState<FirmRow[]>([]);
  /** firm ↔ sources from public.sources_firms (for provider filter + labels). */
  const [sourceFirmLinks, setSourceFirmLinks] = useState<
    { firm_id: string; source_id: number; firm_name: string }[]
  >([]);
  const [countries, setCountries] = useState<CountryRow[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** history_leads rows grouped by original_id (new leads only). */
  const [historyByLead, setHistoryByLead] = useState<Map<string, HistoryLeadRow[]>>(new Map());
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [callLogsRows, setCallLogsRows] = useState<CallLogRow[]>([]);
  const [callLogsError, setCallLogsError] = useState<string | null>(null);
  const [schedulerDisplayNames, setSchedulerDisplayNames] = useState<Record<string, string>>({});
  /** tenants_employee: normalized display_name → id (for leads.scheduler CTI match). */
  const [employeeDisplayNameToId, setEmployeeDisplayNameToId] = useState<Map<string, number>>(() => new Map());

  useEffect(() => {
    void fetchStageNames();
  }, []);

  const firmIdToSourceIds = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const r of sourceFirmLinks) {
      if (!m.has(r.firm_id)) m.set(r.firm_id, []);
      m.get(r.firm_id)!.push(r.source_id);
    }
    return m;
  }, [sourceFirmLinks]);

  const sourceIdToFirmName = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of sourceFirmLinks) {
      if (!m.has(r.source_id)) m.set(r.source_id, r.firm_name);
    }
    return m;
  }, [sourceFirmLinks]);

  useEffect(() => {
    const boot = async () => {
      const [ch, src, fr, co, sf] = await Promise.all([
        supabase.from('channels').select('id, code, label').eq('is_active', true).order('sort_order'),
        supabase.from('misc_leadsource').select('id, name, channel_id').eq('active', true).order('name'),
        supabase.from('firms').select('id, name').eq('is_active', true).order('name'),
        supabase.from('misc_country').select('id, name').order('name'),
        supabase.from('sources_firms').select('firm_id, source_id, firms ( name )'),
      ]);
      if (!ch.error && ch.data) setChannels(ch.data as ChannelRow[]);
      if (!src.error && src.data) setSources(src.data as unknown as SourceRow[]);
      if (!fr.error && fr.data) setFirms(fr.data as FirmRow[]);
      if (!co.error && co.data) setCountries(co.data as CountryRow[]);
      if (!sf.error && sf.data) {
        const rows = (sf.data as { firm_id: string; source_id: number; firms: { name: string } | null }[]).map(
          (r) => ({
            firm_id: r.firm_id,
            source_id: r.source_id,
            firm_name: (r.firms?.name || '').trim() || '—',
          })
        );
        setSourceFirmLinks(rows);
      } else if (sf.error) {
        console.warn('sources_firms load (provider filter):', sf.error.message);
        setSourceFirmLinks([]);
      }
    };
    void boot();
  }, []);

  const runReport = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setSearched(true);
    try {
      let q = supabase.from('leads').select(`
        id,
        created_at,
        lead_number,
        scheduler,
        meeting_scheduler_id,
        stage,
        source,
        source_id,
        status,
        eligible,
        eligibility_status,
        unactivated_at,
        unactivation_reason,
        balance,
        proposal_total,
        balance_currency,
        probability,
        country_id,
        misc_country!country_id ( id, name ),
        misc_leadsource!fk_leads_source_id ( id, name, channel_id )
      `);

      if (fromDate) q = q.gte('created_at', `${fromDate}T00:00:00`);
      if (toDate) q = q.lte('created_at', `${toDate}T23:59:59`);

      const { data, error } = await q.order('created_at', { ascending: false }).limit(8000);

      if (error) throw error;

      let rows = (data || []) as unknown as LeadRow[];

      if (channelIds.length > 0) {
        const ok = new Set(channelIds);
        rows = rows.filter((l) => l.misc_leadsource?.channel_id != null && ok.has(l.misc_leadsource.channel_id));
      }
      if (sourceIds.length > 0) {
        const ok = new Set(sourceIds.map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n)));
        rows = rows.filter((l) => l.source_id != null && ok.has(l.source_id));
      }
      if (countryIds.length > 0) {
        const ok = new Set(countryIds.map((c) => parseInt(c, 10)).filter((n) => Number.isFinite(n)));
        rows = rows.filter((l) => l.country_id != null && ok.has(l.country_id));
      }
      if (firmIds.length > 0) {
        const allowed = new Set<number>();
        for (const fid of firmIds) {
          const arr = firmIdToSourceIds.get(fid);
          if (arr) arr.forEach((sid) => allowed.add(sid));
        }
        if (allowed.size > 0) {
          rows = rows.filter((l) => l.source_id != null && allowed.has(l.source_id));
        } else {
          rows = [];
        }
      }

      setLeads(rows);

      setCallLogsError(null);
      setCallLogsRows([]);
      setSchedulerDisplayNames({});
      setEmployeeDisplayNameToId(new Map());

      const { data: allEmployees } = await supabase.from('tenants_employee').select('id, display_name');
      const nameToId = new Map<string, number>();
      const idToName: Record<string, string> = {};
      for (const e of allEmployees || []) {
        const row = e as { id: number; display_name: string | null };
        const id = Number(row.id);
        idToName[String(id)] = (row.display_name || '').trim() || `Employee #${id}`;
        const key = normalizeSchedulerDisplayKey(String(row.display_name || ''));
        if (key && !nameToId.has(key)) nameToId.set(key, id);
      }
      setEmployeeDisplayNameToId(new Map(nameToId));
      setSchedulerDisplayNames(idToName);

      const schedulerIds = [
        ...new Set(
          rows
            .map((r) => resolveSchedulerEmployeeId(r, nameToId))
            .filter((x): x is number => x != null && !Number.isNaN(x))
        ),
      ];
      if (schedulerIds.length > 0) {
        let callFrom =
          fromDate != null && fromDate !== ''
            ? `${fromDate}T00:00:00`
            : rows.length > 0
              ? new Date(Math.min(...rows.map((r) => new Date(r.created_at).getTime()))).toISOString()
              : undefined;
        let callTo =
          toDate != null && toDate !== ''
            ? `${toDate}T23:59:59`
            : rows.length > 0
              ? new Date(Math.max(...rows.map((r) => new Date(r.created_at).getTime()))).toISOString()
              : undefined;
        if (callFrom && callTo && new Date(callFrom) > new Date(callTo)) {
          const t = callFrom;
          callFrom = callTo;
          callTo = t;
        }
        const combinedCalls: CallLogRow[] = [];
        let offset = 0;
        let cErr: string | null = null;
        for (;;) {
          let qCalls = supabase
            .from('call_logs')
            .select('id, employee_id, lead_id, client_id, duration, cdate')
            .in('employee_id', schedulerIds);
          if (callFrom) qCalls = qCalls.gte('cdate', callFrom);
          if (callTo) qCalls = qCalls.lte('cdate', callTo);
          const { data: cData, error: cError } = await qCalls.order('cdate', { ascending: true }).range(offset, offset + 999);
          if (cError) {
            cErr = cError.message;
            console.warn('call_logs:', cError);
            break;
          }
          const batch = (cData || []) as CallLogRow[];
          combinedCalls.push(...batch);
          if (batch.length < 1000) break;
          offset += 1000;
        }
        if (cErr) {
          setCallLogsError(cErr);
        } else {
          setCallLogsRows(combinedCalls);
        }
      }

      setHistoryError(null);
      setHistoryByLead(new Map());
      const leadIds = rows.map((r) => r.id).filter(Boolean) as string[];
      if (leadIds.length > 0) {
        const combined: HistoryLeadRow[] = [];
        const chunkSize = 100;
        let histErr: string | null = null;
        for (let i = 0; i < leadIds.length; i += chunkSize) {
          const chunk = leadIds.slice(i, i + chunkSize);
          let offset = 0;
          for (;;) {
            const { data: hist, error: hError } = await supabase
              .from('history_leads')
              .select('original_id, stage, changed_at, communication_started_at')
              .in('original_id', chunk)
              .order('changed_at', { ascending: true })
              .range(offset, offset + 999);
            if (hError) {
              histErr = hError.message;
              console.warn('history_leads:', hError);
              break;
            }
            const batch = (hist || []) as HistoryLeadRow[];
            combined.push(...batch);
            if (batch.length < 1000) break;
            offset += 1000;
          }
          if (histErr) break;
        }
        if (histErr) {
          setHistoryError(histErr);
        } else {
          const map = new Map<string, HistoryLeadRow[]>();
          for (const h of combined) {
            const oid = String(h.original_id);
            if (!map.has(oid)) map.set(oid, []);
            map.get(oid)!.push(h);
          }
          setHistoryByLead(map);
        }
      }
    } catch (e: any) {
      console.error(e);
      setLoadError(e?.message || 'Failed to load leads');
      setLeads([]);
      setHistoryByLead(new Map());
      setHistoryError(null);
      setCallLogsRows([]);
      setCallLogsError(null);
      setSchedulerDisplayNames({});
      setEmployeeDisplayNameToId(new Map());
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, channelIds, sourceIds, countryIds, firmIds, firmIdToSourceIds]);

  const aggregates = useMemo(() => {
    const map = new Map<string, AggRow>();
    const channelLabel = (cid: string | null | undefined) => {
      if (!cid) return 'Unassigned channel';
      const c = channels.find((x) => x.id === cid);
      return c?.label || c?.code || 'Channel';
    };

    const getChannelLabel = (l: LeadRow) => channelLabel(l.misc_leadsource?.channel_id ?? null);
    const getSourceLabel = (l: LeadRow) =>
      l.misc_leadsource?.name || l.source?.trim() || `Source #${l.source_id ?? '?'}`;

    for (const l of leads) {
      const channel = getChannelLabel(l);
      const source = getSourceLabel(l);
      const key =
        groupMode === 'channel'
          ? channel
          : `${channel}|||${source}`;

      if (!map.has(key)) {
        map.set(key, {
          key,
          channel,
          source: groupMode === 'channel' ? '—' : source,
          provider: '—',
          leads: 0,
          eligible: 0,
          meetings: 0,
          offers: 0,
          deals: 0,
          revenueNis: 0,
          inactive: 0,
          notEligible: 0,
          _providerNames: new Set<string>(),
        });
      }
      const row = map.get(key)!;
      const sid = l.source_id;
      if (sid != null) {
        const pname = sourceIdToFirmName.get(sid);
        if (pname && row._providerNames) row._providerNames.add(pname);
      }
      row.leads += 1;
      if (isInactiveLead(l)) row.inactive += 1;
      if (isEligibleLead(l)) row.eligible += 1;
      else row.notEligible += 1;
      if (hasMeetingOrBeyond(l) && !isInactiveLead(l)) row.meetings += 1;
      if (hasOfferOrBeyond(l)) row.offers += 1;
      if (hasSignedDeal(l)) {
        row.deals += 1;
        row.revenueNis += leadRevenueNis(l);
      }
    }

    return Array.from(map.values())
      .map((r) => {
        const names = r._providerNames;
        let provider = '—';
        if (names && names.size === 1) provider = [...names][0];
        else if (names && names.size > 1) provider = 'Multiple providers';
        const { _providerNames, ...rest } = r;
        return { ...rest, provider };
      })
      .sort((a, b) => b.leads - a.leads);
  }, [leads, groupMode, channels, sourceIdToFirmName]);

  const totals = useMemo(() => {
    const t = {
      leads: 0,
      eligible: 0,
      meetings: 0,
      offers: 0,
      deals: 0,
      revenue: 0,
      inactive: 0,
    };
    for (const r of aggregates) {
      t.leads += r.leads;
      t.eligible += r.eligible;
      t.meetings += r.meetings;
      t.offers += r.offers;
      t.deals += r.deals;
      t.revenue += r.revenueNis;
      t.inactive += r.inactive;
    }
    return t;
  }, [aggregates]);

  const funnelData = useMemo(() => {
    return [
      { name: 'Leads', value: totals.leads },
      { name: 'Eligible (approx.)', value: totals.eligible },
      { name: 'Meetings', value: totals.meetings },
      { name: 'Offers', value: totals.offers },
      { name: 'Deals', value: totals.deals },
    ];
  }, [totals]);

  const costPlaceholder = useMemo(() => {
    return aggregates.map((r) => ({
      source: r.source,
      channel: r.channel,
      media: 0,
      management: 0,
      hr: 0,
      total: 0,
      pct: totals.leads ? ((r.leads / totals.leads) * 100).toFixed(1) : '0',
    }));
  }, [aggregates, totals.leads]);

  /** Avg days between milestones from history_leads (see HIST_STAGE thresholds). */
  const funnelTimingRows = useMemo(() => {
    const seg = {
      createToComm: [] as number[],
      commToMeet: [] as number[],
      meetToOffer: [] as number[],
      offerToSigned: [] as number[],
      signedToPay: [] as number[],
    };
    for (const lead of leads) {
      const rows = historyByLead.get(lead.id) || [];
      const t0 = ms(lead.created_at);
      if (t0 == null) continue;
      const tComm = firstCommunicationAt(rows, t0);
      const tMeet = firstChangedAtWhenStage(rows, (s) => s >= HIST_STAGE.meeting);
      const tOffer = firstChangedAtWhenStage(rows, (s) => s >= HIST_STAGE.offer);
      const tSign = firstChangedAtWhenStage(rows, (s) => s >= HIST_STAGE.signed);
      const tPay = firstChangedAtWhenStage(rows, (s) => s >= HIST_STAGE.payment);

      const d1 = daysBetween(t0, tComm);
      if (d1 != null) seg.createToComm.push(d1);
      const d2 = daysBetween(tComm, tMeet);
      if (d2 != null) seg.commToMeet.push(d2);
      const d3 = daysBetween(tMeet, tOffer);
      if (d3 != null) seg.meetToOffer.push(d3);
      const d4 = daysBetween(tOffer, tSign);
      if (d4 != null) seg.offerToSigned.push(d4);
      const d5 = daysBetween(tSign, tPay);
      if (d5 != null) seg.signedToPay.push(d5);
    }
    const row = (label: string, arr: number[]) => ({
      label,
      avgDays: arr.length ? average(arr) : null,
      n: arr.length,
    });
    return [
      row('Creation → communication started', seg.createToComm),
      row('Communication → meeting scheduled', seg.commToMeet),
      row('Meeting → price offer', seg.meetToOffer),
      row('Price offer → client signed', seg.offerToSigned),
      row('Signed → payment stage', seg.signedToPay),
    ];
  }, [leads, historyByLead]);

  /**
   * Qualified = active & stage before price offer (rank &lt; 45).
   * Calls: same employee as scheduler; match lead via call_logs.client_id = leads.id or legacy lead_id vs lead_number digits.
   */
  const salesBehaviourStats = useMemo(() => {
    const qualified = leads.filter((l) => !isInactiveLead(l) && stageRank(l) < 45);
    const index = new Map<string, CallLogRow[]>();
    const push = (k: string, c: CallLogRow) => {
      if (!index.has(k)) index.set(k, []);
      index.get(k)!.push(c);
    };
    for (const c of callLogsRows) {
      if (c.employee_id == null) continue;
      const e = Number(c.employee_id);
      if (c.client_id) push(`${e}|c:${c.client_id}`, c);
      if (c.lead_id != null && !Number.isNaN(Number(c.lead_id))) push(`${e}|n:${Number(c.lead_id)}`, c);
    }
    const bySched = new Map<number, { sec: number; n: number }>();
    let totalSec = 0;
    let totalN = 0;
    for (const lead of qualified) {
      const schedEmpId = resolveSchedulerEmployeeId(lead, employeeDisplayNameToId);
      if (schedEmpId == null) continue;
      const n = leadNumberAsCallLeadId(lead);
      const fromClient = index.get(`${schedEmpId}|c:${lead.id}`) || [];
      const fromNum = n != null ? index.get(`${schedEmpId}|n:${n}`) || [] : [];
      const seen = new Set<number | string>();
      const calls: CallLogRow[] = [];
      for (const c of [...fromClient, ...fromNum]) {
        const cid = c.id != null ? c.id : `${c.cdate}|${c.duration}`;
        if (seen.has(cid)) continue;
        seen.add(cid);
        calls.push(c);
      }
      for (const c of calls) {
        const d = Number(c.duration) || 0;
        totalSec += d;
        totalN += 1;
        const cur = bySched.get(schedEmpId) || { sec: 0, n: 0 };
        cur.sec += d;
        cur.n += 1;
        bySched.set(schedEmpId, cur);
      }
    }
    const probs = qualified
      .map((l) => l.probability)
      .filter((p): p is number => p != null && Number.isFinite(Number(p)));
    const avgProb = probs.length ? average(probs.map((p) => Number(p))) : null;
    const byScheduler = [...bySched.entries()]
      .map(([id, v]) => ({
        id,
        name: schedulerDisplayNames[String(id)] || `Employee #${id}`,
        avgSec: v.n ? v.sec / v.n : 0,
        calls: v.n,
      }))
      .sort((a, b) => b.calls - a.calls);
    return {
      qualifiedCount: qualified.length,
      totalMatchedCalls: totalN,
      overallAvgSec: totalN ? totalSec / totalN : null,
      avgProbability: avgProb,
      byScheduler,
    };
  }, [leads, callLogsRows, schedulerDisplayNames, employeeDisplayNameToId]);

  const fmtMoney = (n: number) =>
    `₪${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <div className="space-y-6 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-base-300 bg-base-200/40 px-4 py-3 backdrop-blur-sm">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <MegaphoneIcon className="h-8 w-8 shrink-0 text-primary" />
          <div>
            <h2 className="text-lg font-bold tracking-tight">Marketing dashboard</h2>
            <p className="text-xs text-base-content/50">Performance overview · new leads in scope</p>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm gap-2 border border-base-300 bg-base-100/80 shadow-sm"
          onClick={() => setDocsOpen(true)}
          aria-expanded={docsOpen}
          aria-controls="marketing-report-docs-modal"
        >
          <InformationCircleIcon className="h-5 w-5 shrink-0" />
          About this report
        </button>
      </div>

      {docsOpen && (
        <div
          className="modal modal-open z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="marketing-report-docs-title"
          id="marketing-report-docs-modal"
        >
          <div className="modal-box max-h-[min(90vh,720px)] w-full max-w-2xl overflow-y-auto p-6">
            <div className="mb-4 flex items-start justify-between gap-2">
              <h3 id="marketing-report-docs-title" className="pr-8 text-lg font-bold leading-tight">
                About this report
              </h3>
              <button
                type="button"
                className="btn btn-sm btn-circle btn-ghost shrink-0"
                onClick={() => setDocsOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="space-y-5 text-sm leading-relaxed text-base-content/90">
            <section>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-base-content/50">Scope & data</h4>
              <p>
                This dashboard uses <strong>new leads only</strong>. Funnel timing comes from{' '}
                <code className="rounded bg-base-200 px-1 text-[11px]">history_leads</code>. Call-based behaviour uses{' '}
                <code className="rounded bg-base-200 px-1 text-[11px]">scheduler</code> with{' '}
                <code className="rounded bg-base-200 px-1 text-[11px]">call_logs</code> (employee + lead linkage). Legacy{' '}
                <code className="rounded bg-base-200 px-1 text-[11px]">leads_lead</code>, marketing invoices, and HR from
                contribution are not included until wired separately.
              </p>
            </section>

            <section>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-base-content/50">Not in this version</h4>
              <ul className="list-inside list-disc space-y-1 text-base-content/80">
                <li>Department filter (no department on the lead row)</li>
                <li>
                  Legacy <code className="rounded bg-base-200 px-1 text-[11px]">leads_lead</code> +{' '}
                  <code className="rounded bg-base-200 px-1 text-[11px]">history_leads_lead</code>
                </li>
                <li>Per-source media / management invoices</li>
                <li>HR cost from contribution report</li>
                <li>Follow-up counts beyond calls</li>
                <li>Multi-factor probability breakdown</li>
                <li>Exact “boss eligibility” vs inactive reason (needs consistent reason codes)</li>
              </ul>
              <p className="mt-2 text-xs text-base-content/60">
                <strong>Provider (firm)</strong> uses <code className="rounded bg-base-200 px-1 text-[11px]">sources_firms</code> — configure under Admin → Firms → Lead sources.
              </p>
            </section>

            <section>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-base-content/50">Macro table · CPL columns</h4>
              <p>
                <strong>CPL</strong> and <strong>cost / eligible</strong> need a media + management cost table; values show “—” until that exists. The optional HR column is only a layout placeholder when enabled — no HR data is loaded yet.
              </p>
            </section>

            <section>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-base-content/50">Funnel timing (avg. days)</h4>
              <p>
                Derived from <code className="rounded bg-base-200 px-1 text-[11px]">history_leads</code>: stage ≥15 = communication, ≥20 meeting, ≥45 offer, ≥60 signed, ≥70 payment. Communication time also uses{' '}
                <code className="rounded bg-base-200 px-1 text-[11px]">communication_started_at</code> when set. A segment only counts when both endpoints exist.
              </p>
              <p className="mt-2 text-xs text-base-content/60">
                If timing fails to load, check RLS and table access for <code className="rounded bg-base-200 px-1 text-[11px]">history_leads</code> (errors appear on the main screen).
              </p>
            </section>

            <section>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-base-content/50">Sales behaviour / quality</h4>
              <p>
                <strong>Cohort:</strong> active leads with stage before price offer (rank &lt; 45).{' '}
                <code className="rounded bg-base-200 px-1 text-[11px]">call_logs.employee_id</code> is matched to the lead’s scheduler via{' '}
                <code className="rounded bg-base-200 px-1 text-[11px]">leads.scheduler</code> (same as{' '}
                <code className="rounded bg-base-200 px-1 text-[11px]">tenants_employee.display_name</code>, case-insensitive), or{' '}
                <code className="rounded bg-base-200 px-1 text-[11px]">meeting_scheduler_id</code> if scheduler is empty or “---”. Lead linkage:{' '}
                <code className="rounded bg-base-200 px-1 text-[11px]">call_logs.client_id</code> = lead UUID (1com sync), or legacy{' '}
                <code className="rounded bg-base-200 px-1 text-[11px]">lead_id</code> vs digits from{' '}
                <code className="rounded bg-base-200 px-1 text-[11px]">lead_number</code>. Durations are seconds (CTI).
              </p>
              <p className="mt-2 text-xs text-base-content/60">
                If no calls match, verify scheduler names on leads and that 1com sync populated <code className="rounded bg-base-200 px-1 text-[11px]">client_id</code> or legacy <code className="rounded bg-base-200 px-1 text-[11px]">lead_id</code>.
              </p>
            </section>

            <section>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-base-content/50">Cost & profitability</h4>
              <p>
                The cost table is a <strong>placeholder</strong>. When media, management, and optional HR costs exist per source, you can compute <code className="rounded bg-base-200 px-1 text-[11px]">Revenue − Total cost</code> and ROI with and without HR (dual columns as in your spec).
              </p>
            </section>
          </div>

            <div className="modal-action mt-6 border-t border-base-200 pt-4">
              <button type="button" className="btn btn-primary" onClick={() => setDocsOpen(false)}>
                Close
              </button>
            </div>
          </div>
          <div className="modal-backdrop bg-black/40" onClick={() => setDocsOpen(false)} aria-hidden />
        </div>
      )}

      {/* Sticky filters */}
      <div className="sticky top-0 z-20 -mx-1 overflow-visible rounded-xl border border-base-300 bg-base-100/95 px-4 py-3 shadow-sm backdrop-blur-md">
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <label className="form-control">
            <span className="label-text text-xs font-semibold">From</span>
            <input
              type="date"
              className="input input-bordered input-sm"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </label>
          <label className="form-control">
            <span className="label-text text-xs font-semibold">To</span>
            <input
              type="date"
              className="input input-bordered input-sm"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>
          <MarketingSearchMultiFilter
            label="Channel"
            placeholder="Search channels…"
            options={channels.map((c) => ({ id: c.id, label: c.label }))}
            selected={channelIds}
            onChange={setChannelIds}
          />
          <MarketingSearchMultiFilter
            label="Source"
            placeholder="Search sources…"
            options={sources.map((s) => ({ id: String(s.id), label: s.name }))}
            selected={sourceIds}
            onChange={setSourceIds}
          />
          <MarketingSearchMultiFilter
            label="Country"
            placeholder="Search countries…"
            options={countries.map((c) => ({ id: String(c.id), label: c.name }))}
            selected={countryIds}
            onChange={setCountryIds}
          />
          <MarketingSearchMultiFilter
            label="Provider (firm)"
            placeholder="Search firms…"
            options={firms.map((f) => ({ id: f.id, label: f.name }))}
            selected={firmIds}
            onChange={setFirmIds}
          />
          <div className="form-control justify-end">
            <span className="label-text text-xs font-semibold opacity-0">Run</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void runReport()} disabled={loading}>
              {loading ? <span className="loading loading-spinner loading-sm" /> : 'Run report'}
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <span className="font-semibold">Group:</span>
          <label className="flex cursor-pointer items-center gap-1">
            <input
              type="radio"
              name="grp"
              checked={groupMode === 'source'}
              onChange={() => setGroupMode('source')}
            />
            By source
          </label>
          <label className="flex cursor-pointer items-center gap-1">
            <input
              type="radio"
              name="grp"
              checked={groupMode === 'channel'}
              onChange={() => setGroupMode('channel')}
            />
            By channel
          </label>
          <label className="ml-4 flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={includeHrCost}
              onChange={(e) => setIncludeHrCost(e.target.checked)}
            />
            HR cost column (placeholder)
          </label>
        </div>
      </div>

      {loadError && (
        <div className="alert alert-error text-sm">
          <span>{loadError}</span>
        </div>
      )}

      {searched && !loading && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {[
              { label: 'Leads', value: totals.leads },
              { label: 'Eligible (approx.)', value: totals.eligible },
              { label: 'Meetings (excl. inactive)', value: totals.meetings },
              { label: 'Deals (signed)', value: totals.deals },
              { label: 'Revenue (NIS, approx.)', value: fmtMoney(totals.revenue) },
            ].map((k) => (
              <div key={k.label} className="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wide text-base-content/50">{k.label}</p>
                <p className="text-xl font-bold">{k.value}</p>
              </div>
            ))}
          </div>

          {/* Main macro table */}
          <div className="overflow-x-auto rounded-xl border border-base-300 bg-base-100 shadow-sm">
            <h3 className="border-b border-base-300 px-4 py-3 text-sm font-bold">Macro performance (by {groupMode})</h3>
            <table className="table table-sm">
              <thead>
                <tr className="bg-base-200 text-[10px] uppercase">
                  <th>Channel</th>
                  {groupMode === 'source' && <th>Source</th>}
                  <th>Provider</th>
                  <th className="text-right">Leads</th>
                  <th className="text-right">Eligible</th>
                  <th className="text-right">Meetings</th>
                  <th className="text-right">Offers</th>
                  <th className="text-right">Deals</th>
                  <th className="text-right">Lead→Elig %</th>
                  <th className="text-right">Lead→Mtg %</th>
                  <th className="text-right">Lead→Offer %</th>
                  <th className="text-right">Lead→Deal %</th>
                  <th className="text-right">Revenue ₪</th>
                  <th className="text-right">Inactive</th>
                  <th className="text-right">CPL*</th>
                  <th className="text-right">Cost/elig*</th>
                </tr>
              </thead>
              <tbody>
                {aggregates.map((r) => {
                  const pct = (a: number, b: number) => (b > 0 ? ((a / b) * 100).toFixed(1) : '—');
                  return (
                    <tr key={r.key}>
                      <td className="whitespace-nowrap">{r.channel}</td>
                      {groupMode === 'source' && <td className="max-w-[10rem] truncate">{r.source}</td>}
                      <td className="text-base-content/50">{r.provider}</td>
                      <td className="text-right">{r.leads}</td>
                      <td className="text-right">{r.eligible}</td>
                      <td className="text-right">{r.meetings}</td>
                      <td className="text-right">{r.offers}</td>
                      <td className="text-right">{r.deals}</td>
                      <td className="text-right">{pct(r.eligible, r.leads)}</td>
                      <td className="text-right">{pct(r.meetings, r.leads)}</td>
                      <td className="text-right">{pct(r.offers, r.leads)}</td>
                      <td className="text-right">{pct(r.deals, r.leads)}</td>
                      <td className="text-right font-mono text-xs">{fmtMoney(r.revenueNis)}</td>
                      <td className="text-right">{r.inactive}</td>
                      <td className="text-right text-base-content/40">—</td>
                      <td className="text-right text-base-content/40">—</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Funnel chart */}
          <div className="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
            <h3 className="mb-2 text-sm font-bold">Funnel snapshot</h3>
            <div className="h-64 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-40" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="value" name="Count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Timing from history_leads */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
              <h3 className="text-sm font-bold">Funnel timing (avg. days)</h3>
              {historyError && (
                <p className="mt-2 text-xs text-error">
                  History could not be loaded: {historyError} (check RLS / table access).
                </p>
              )}
              {!historyError && leads.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr className="bg-base-200 text-[10px] uppercase">
                        <th>Segment</th>
                        <th className="text-right">Avg days</th>
                        <th className="text-right">Leads counted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {funnelTimingRows.map((r) => (
                        <tr key={r.label}>
                          <td className="text-xs">{r.label}</td>
                          <td className="text-right font-mono text-xs">
                            {r.avgDays != null ? r.avgDays.toFixed(1) : '—'}
                          </td>
                          <td className="text-right text-xs">{r.n}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
              <h3 className="text-sm font-bold">Sales behaviour / quality</h3>
              {callLogsError && (
                <p className="mt-2 text-xs text-error">call_logs: {callLogsError}</p>
              )}
              {!callLogsError && leads.length > 0 && (
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap gap-3 text-xs">
                    <span className="rounded-lg bg-base-200 px-2 py-1">
                      Qualified leads: <strong>{salesBehaviourStats.qualifiedCount}</strong>
                    </span>
                    <span className="rounded-lg bg-base-200 px-2 py-1">
                      Matched calls: <strong>{salesBehaviourStats.totalMatchedCalls}</strong>
                    </span>
                    <span className="rounded-lg bg-base-200 px-2 py-1">
                      Avg call (matched):{' '}
                      <strong>
                        {salesBehaviourStats.overallAvgSec != null
                          ? `${salesBehaviourStats.overallAvgSec.toFixed(0)}s`
                          : '—'}
                      </strong>
                    </span>
                    <span className="rounded-lg bg-base-200 px-2 py-1">
                      Avg probability (cohort):{' '}
                      <strong>
                        {salesBehaviourStats.avgProbability != null
                          ? `${salesBehaviourStats.avgProbability.toFixed(0)}%`
                          : '—'}
                      </strong>
                    </span>
                  </div>
                  {salesBehaviourStats.byScheduler.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="table table-sm">
                        <thead>
                          <tr className="bg-base-200 text-[10px] uppercase">
                            <th>Scheduler</th>
                            <th className="text-right">Calls</th>
                            <th className="text-right">Avg duration</th>
                          </tr>
                        </thead>
                        <tbody>
                          {salesBehaviourStats.byScheduler.map((r) => (
                            <tr key={r.id}>
                              <td className="max-w-[10rem] truncate text-xs">{r.name}</td>
                              <td className="text-right text-xs">{r.calls}</td>
                              <td className="text-right font-mono text-xs">{r.avgSec.toFixed(0)}s</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-xs text-base-content/60">
                      No calls matched (check scheduler on leads; 1com sync should set{' '}
                      <code className="text-[10px]">client_id</code> or legacy <code className="text-[10px]">lead_id</code>).
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Cost breakdown */}
          <div className="overflow-x-auto rounded-xl border border-base-300 bg-base-100 shadow-sm">
            <h3 className="border-b border-base-300 px-4 py-3 text-sm font-bold">Cost breakdown (placeholder)</h3>
            <table className="table table-sm">
              <thead>
                <tr className="bg-base-200 text-[10px] uppercase">
                  <th>Channel</th>
                  <th>Source</th>
                  <th className="text-right">Media</th>
                  <th className="text-right">Management</th>
                  <th className="text-right">HR</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">% leads</th>
                </tr>
              </thead>
              <tbody>
                {costPlaceholder.map((c, i) => (
                  <tr key={i}>
                    <td>{c.channel}</td>
                    <td className="max-w-[8rem] truncate">{c.source}</td>
                    <td className="text-right">—</td>
                    <td className="text-right">—</td>
                    <td className="text-right">—</td>
                    <td className="text-right">—</td>
                    <td className="text-right">{c.pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!searched && (
        <p className="text-center text-sm text-base-content/50">Set filters and click &quot;Run report&quot;.</p>
      )}
    </div>
  );
};

export default MarketingDashboardReport;
