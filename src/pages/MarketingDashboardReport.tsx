/** Marketing performance dashboard — see “About this report” in the UI for methodology. */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  ENGRAVED_FILTER_CONTROL_CLASSES,
  ENGRAVED_FILTER_PRIMARY_BUTTON_CLASSES,
} from '../components/EngravedFilterPanel';
import { ChannelLabel } from '../components/ChannelLabel';
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
import {
  ArrowsUpDownIcon,
  BanknotesIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';

type ChannelRow = { id: string; code: string; label: string; is_active: boolean };
/** misc_leadsource.id is bigint: keep as string to avoid precision loss */
type SourceRow = { id: string; name: string; channel_id: string | null };
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
  /** bigint in DB; treat as string to avoid int8 precision issues */
  source_id: string | null;
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
  // NOTE: Your pipeline uses stage 50 for offer; stage 45 does not exist.
  offer_sent: 50,
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
  if (r >= HIST_STAGE.offer) return true;
  if (lead.eligible === true) return true;
  if (lead.eligibility_status && String(lead.eligibility_status).toLowerCase().includes('eligible')) return true;
  if (r >= 20 && !isInactiveLead(lead)) return true;
  return false;
}

function hasMeetingOrBeyond(lead: LeadRow): boolean {
  return stageRank(lead) >= 20;
}

function hasOfferOrBeyond(lead: LeadRow): boolean {
  return stageRank(lead) >= HIST_STAGE.offer;
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
  offer: 50,
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

// Align date filtering with LeadSearchPage: interpret YYYY-MM-DD as local day, then convert to UTC ISO.
function buildUtcStartOfDay(dateStr: string) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const local = new Date(year, (month || 1) - 1, day || 1, 0, 0, 0, 0);
  return local.toISOString();
}
function buildUtcEndOfDay(dateStr: string) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const local = new Date(year, (month || 1) - 1, day || 1, 23, 59, 59, 999);
  return local.toISOString();
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

function fmtDurationMinSec(totalSeconds: number | null | undefined): string {
  const s = Number(totalSeconds);
  if (!Number.isFinite(s) || s < 0) return '—';
  const rounded = Math.round(s);
  const m = Math.floor(rounded / 60);
  const sec = rounded % 60;
  if (m <= 0) return `${sec}s`;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
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

/** Sortable macro table columns (excludes Channel, Source, Provider). */
type MacroSortKey =
  | 'leads'
  | 'eligible'
  | 'meetings'
  | 'offers'
  | 'deals'
  | 'pctElig'
  | 'pctMtg'
  | 'pctOffer'
  | 'pctDeal'
  | 'revenue'
  | 'inactive';

function macroSortValue(r: AggRow, key: MacroSortKey): number {
  switch (key) {
    case 'leads':
      return r.leads;
    case 'eligible':
      return r.eligible;
    case 'meetings':
      return r.meetings;
    case 'offers':
      return r.offers;
    case 'deals':
      return r.deals;
    case 'revenue':
      return r.revenueNis;
    case 'inactive':
      return r.inactive;
    case 'pctElig':
      return r.leads > 0 ? r.eligible / r.leads : -1;
    case 'pctMtg':
      return r.leads > 0 ? r.meetings / r.leads : -1;
    case 'pctOffer':
      return r.leads > 0 ? r.offers / r.leads : -1;
    case 'pctDeal':
      return r.leads > 0 ? r.deals / r.leads : -1;
    default:
      return 0;
  }
}

function MacroSortableTh({
  sortKey,
  activeKey,
  dir,
  onSort,
  children,
  sortLabel,
  className = '',
}: {
  sortKey: MacroSortKey;
  activeKey: MacroSortKey;
  dir: 'asc' | 'desc';
  onSort: (k: MacroSortKey) => void;
  children: React.ReactNode;
  /** Accessible name for the sort control (column title). */
  sortLabel: string;
  className?: string;
}) {
  const active = activeKey === sortKey;
  const nextToggle = active && dir === 'asc' ? 'descending' : 'ascending';
  return (
    <th scope="col" className={className} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className="inline-flex w-full items-center justify-end gap-1 rounded-lg px-0.5 py-0.5 text-inherit hover:bg-base-200/60 hover:text-base-content/80 dark:hover:bg-base-content/10"
        aria-label={
          active ? `Sorted ${dir === 'asc' ? 'ascending' : 'descending'}. Activate to sort ${nextToggle}.` : `Sort by ${sortLabel}`
        }
        onClick={() => onSort(sortKey)}
      >
        <span>{children}</span>
        {active ? (
          dir === 'asc' ? (
            <ChevronUpIcon className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
          ) : (
            <ChevronDownIcon className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
          )
        ) : (
          <ArrowsUpDownIcon className="h-3.5 w-3.5 shrink-0 opacity-35" aria-hidden />
        )}
      </button>
    </th>
  );
}

type MultiFilterOption = { id: string; label: string };

/** Shared label style above engraved fields — spacing + hierarchy without crowding the control. */
const FILTER_FIELD_LABEL_CLASS =
  'mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em] text-base-content/55';

/** Grey titles: card/section headings (h3) and table column headers (with global `.table th` override). */
const REPORT_SECTION_TITLE_CLASS = 'text-base-content/55';
const REPORT_TABLE_CLASS =
  'table text-sm md:text-base [&_thead_th]:!text-base-content/55';

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
  inputClassName = '',
}: {
  label: string;
  placeholder: string;
  options: MultiFilterOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Merged onto the search input (e.g. {@link ENGRAVED_FILTER_CONTROL_CLASSES}). */
  inputClassName?: string;
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
      <span className={FILTER_FIELD_LABEL_CLASS}>{label}</span>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          className={`input input-md min-h-12 w-full pr-[4.75rem] text-base ${inputClassName} ${
            open ? 'shadow-[inset_0_4px_12px_rgba(0,0,0,0.14)] dark:shadow-[inset_0_4px_16px_rgba(0,0,0,0.5)]' : ''
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
              className="btn btn-ghost btn-sm h-8 min-h-0 px-2 text-xs font-normal"
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
            <ChevronDownIcon className={`h-5 w-5 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {open && (
          <div
            className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto overflow-x-hidden rounded-xl border border-black/[0.08] bg-base-100 text-base shadow-[0_10px_28px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.85)] dark:border-white/[0.12] dark:bg-base-200 dark:shadow-[0_12px_32px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.06)]"
            style={{ overflowAnchor: 'none' } as React.CSSProperties}
            role="listbox"
            aria-multiselectable
          >
            {displayOptions.length === 0 ? (
              <div className="px-3 py-3 text-sm text-base-content/60">No matches.</div>
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
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-base-200 ${
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

export type MarketingDashboardReportProps = {
  /** When set with `onDocsOpenChange`, modal open state is controlled by the parent (e.g. Reports shell title bar). */
  docsOpen?: boolean;
  onDocsOpenChange?: (open: boolean) => void;
};

const MarketingDashboardReport: React.FC<MarketingDashboardReportProps> = ({
  docsOpen: docsOpenProp,
  onDocsOpenChange,
}) => {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [countryIds, setCountryIds] = useState<string[]>([]);
  const [firmIds, setFirmIds] = useState<string[]>([]);
  const [groupMode, setGroupMode] = useState<GroupMode>('source');
  const [macroSort, setMacroSort] = useState<{ key: MacroSortKey; dir: 'asc' | 'desc' }>({
    key: 'leads',
    dir: 'desc',
  });
  const [includeHrCost, setIncludeHrCost] = useState(false);
  const [docsOpenLocal, setDocsOpenLocal] = useState(false);
  const docsControlled = onDocsOpenChange != null;
  const docsOpen = docsControlled ? Boolean(docsOpenProp) : docsOpenLocal;
  const setDocsOpen = (open: boolean) => {
    if (docsControlled) onDocsOpenChange(open);
    else setDocsOpenLocal(open);
  };

  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [firms, setFirms] = useState<FirmRow[]>([]);
  /** firm ↔ sources from public.sources_firms (for provider filter + labels). */
  const [sourceFirmLinks, setSourceFirmLinks] = useState<
    { firm_id: string; source_id: string; firm_name: string }[]
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
  const [employeeIdToPhotoUrl, setEmployeeIdToPhotoUrl] = useState<Record<string, string>>({});
  /** tenants_employee: normalized display_name → id (for leads.scheduler CTI match). */
  const [employeeDisplayNameToId, setEmployeeDisplayNameToId] = useState<Map<string, number>>(() => new Map());

  // Targeted debug for a known failing source↔channel link.
  const didDebugSource39Ref = useRef(false);

  const runReportRef = useRef<() => Promise<void>>(async () => {});
  const searchedRef = useRef(false);
  const realtimeDebounceRef = useRef<{ ref: number | null; report: number | null }>({ ref: null, report: null });

  useEffect(() => {
    void fetchStageNames();
  }, []);

  const firmIdToSourceIds = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of sourceFirmLinks) {
      if (!m.has(r.firm_id)) m.set(r.firm_id, []);
      m.get(r.firm_id)!.push(r.source_id);
    }
    return m;
  }, [sourceFirmLinks]);

  const sourceIdToFirmName = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of sourceFirmLinks) {
      if (!m.has(r.source_id)) m.set(r.source_id, r.firm_name);
    }
    return m;
  }, [sourceFirmLinks]);

  const loadReferenceData = useCallback(async () => {
    const [ch, src, fr, co, sf] = await Promise.all([
      // Load ALL channels so sources linked to inactive channels still resolve (avoid "Unassigned channel").
      // We’ll filter inactive channels out of the filter dropdown UI separately.
      supabase.from('channels').select('id, code, label, is_active').order('sort_order'),
      supabase.from('misc_leadsource').select('id, name, channel_id').eq('active', true).order('name'),
      supabase.from('firms').select('id, name').eq('is_active', true).order('name'),
      supabase.from('misc_country').select('id, name').order('name'),
      supabase.from('sources_firms').select('firm_id, source_id, firms ( name )'),
    ]);
    if (!ch.error && ch.data) {
      const next = ch.data as ChannelRow[];
      // Guard: never clobber a populated mapping with an empty set (can happen under RLS/policies on refetch).
      setChannels((prev) => (next.length > 0 ? next : prev));
    }
    if (!src.error && src.data) {
      const rows = (src.data as { id: number | string; name: string; channel_id: string | null }[]).map((r) => ({
        id: String(r.id),
        name: r.name,
        channel_id: r.channel_id,
      }));
      setSources(rows);
    }
    if (!fr.error && fr.data) setFirms(fr.data as FirmRow[]);
    if (!co.error && co.data) setCountries(co.data as CountryRow[]);
    if (!sf.error && sf.data) {
      const rows = (
        sf.data as {
          firm_id: string;
          source_id: number | string;
          firms: { name: string } | null;
        }[]
      ).map((r) => ({
        firm_id: r.firm_id,
        source_id: String(r.source_id),
        firm_name: (r.firms?.name || '').trim() || '—',
      }));
      setSourceFirmLinks(rows);
    } else if (sf.error) {
      console.warn('sources_firms load (provider filter):', sf.error.message);
      setSourceFirmLinks([]);
    }
  }, []);

  useEffect(() => {
    void loadReferenceData();
  }, [loadReferenceData]);

  // Debug: why source_id "39" isn't resolving its channel in the UI.
  useEffect(() => {
    if (didDebugSource39Ref.current) return;
    if (!sources.length || !channels.length) return;
    didDebugSource39Ref.current = true;

    const targetSourceId = '39';
    const expectedChannelId = '3262d16f-d591-4b30-8f67-20c85bf3b621';
    const src = sources.find((s) => String(s.id) === targetSourceId);
    const ch = channels.find((c) => c.id === expectedChannelId);

    // eslint-disable-next-line no-console
    console.log('[MarketingDashboardReport][debug] source 39 mapping', {
      sourceRow: src || null,
      expectedChannelId,
      channelLoaded: Boolean(ch),
      channelRow: ch || null,
      channelsCount: channels.length,
      sourcesCount: sources.length,
    });
  }, [sources, channels]);

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

      if (fromDate) q = q.gte('created_at', buildUtcStartOfDay(fromDate));
      if (toDate) q = q.lte('created_at', buildUtcEndOfDay(toDate));

      // IMPORTANT: avoid undercounting due to a hard cap. Fetch in pages.
      const pageSize = 1000;
      const maxRows = 30000; // safety cap to avoid runaway loads
      const combined: LeadRow[] = [];
      let offset = 0;
      for (;;) {
        const { data, error } = await q
          .order('created_at', { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        const batch = (data || []) as unknown as LeadRow[];
        combined.push(...batch);
        if (batch.length < pageSize) break;
        offset += pageSize;
        if (combined.length >= maxRows) break;
      }

      let rows = combined;

      const normalizeSourceName = (s: string | null | undefined) =>
        String(s || '').trim().toLowerCase();
      const sourceNameToRow = new Map<string, SourceRow>();
      for (const s of sources) {
        const key = normalizeSourceName(s.name);
        if (key && !sourceNameToRow.has(key)) sourceNameToRow.set(key, s);
      }
      const resolveSourceRow = (l: LeadRow): SourceRow | null => {
        if (l.misc_leadsource) {
          return {
            id: String(l.misc_leadsource.id),
            name: l.misc_leadsource.name,
            channel_id: l.misc_leadsource.channel_id,
          };
        }
        const key = normalizeSourceName(l.source);
        return key ? sourceNameToRow.get(key) || null : null;
      };

      // Debug: what do leads say for source_id "39"?
      if (import.meta.env.DEV) {
        const TARGET_SOURCE_ID = '39';
        const TARGET_SOURCE_NAME = 'PPC World GER-AUS';
        const bySourceId = combined.filter((l) => String(l.source_id ?? '') === TARGET_SOURCE_ID);
        const byEmbeddedSourceId = combined.filter(
          (l) => String(l.misc_leadsource?.id ?? '') === TARGET_SOURCE_ID
        );
        const bySourceTextOnly = combined.filter((l) => {
          const txt = String(l.source || '').trim().toLowerCase();
          return (l.source_id == null || String(l.source_id) === '') && txt === TARGET_SOURCE_NAME.toLowerCase();
        });

        const summarize = (rows: LeadRow[]) => ({
          count: rows.length,
          distinctEmbeddedChannelIds: Array.from(
            new Set(rows.map((l) => String(l.misc_leadsource?.channel_id ?? 'null')))
          ),
          sample: rows[0]
            ? {
                id: rows[0].id,
                created_at: rows[0].created_at,
                source_id: rows[0].source_id,
                source: rows[0].source,
                misc_leadsource: rows[0].misc_leadsource ?? null,
              }
            : null,
        });

        // eslint-disable-next-line no-console
        console.log('[MarketingDashboardReport][debug] source 39 lead matching', {
          dateRange: { fromDate, toDate },
          combinedCount: combined.length,
          bySourceId: summarize(bySourceId),
          byEmbeddedSourceId: summarize(byEmbeddedSourceId),
          bySourceTextOnly: summarize(bySourceTextOnly),
        });
      }

      if (channelIds.length > 0) {
        const ok = new Set(channelIds);
        rows = rows.filter((l) => {
          const cid = resolveSourceRow(l)?.channel_id;
          return cid != null && ok.has(cid);
        });
      }
      if (sourceIds.length > 0) {
        const ok = new Set(sourceIds);
        rows = rows.filter((l) => {
          const sid = resolveSourceRow(l)?.id || (l.source_id != null ? String(l.source_id) : null);
          return sid != null && ok.has(sid);
        });
      }
      if (countryIds.length > 0) {
        const ok = new Set(countryIds.map((c) => parseInt(c, 10)).filter((n) => Number.isFinite(n)));
        rows = rows.filter((l) => l.country_id != null && ok.has(l.country_id));
      }
      if (firmIds.length > 0) {
        const allowed = new Set<string>();
        for (const fid of firmIds) {
          const arr = firmIdToSourceIds.get(fid);
          if (arr) arr.forEach((sid) => allowed.add(String(sid)));
        }
        if (allowed.size > 0) {
          rows = rows.filter((l) => {
            const sid = resolveSourceRow(l)?.id || (l.source_id != null ? String(l.source_id) : null);
            return sid != null && allowed.has(sid);
          });
        } else {
          rows = [];
        }
      }

      setLeads(rows);

      setCallLogsError(null);
      setCallLogsRows([]);
      setSchedulerDisplayNames({});
      setEmployeeDisplayNameToId(new Map());

      const { data: allEmployees } = await supabase
        .from('tenants_employee')
        .select('id, display_name, photo_url, photo');
      const nameToId = new Map<string, number>();
      const idToName: Record<string, string> = {};
      const idToPhoto: Record<string, string> = {};
      for (const e of allEmployees || []) {
        const row = e as { id: number; display_name: string | null; photo_url?: string | null; photo?: any };
        const id = Number(row.id);
        idToName[String(id)] = (row.display_name || '').trim() || `Employee #${id}`;
        const photoUrl = (row.photo_url || '').trim();
        // Some deployments store a data-url-ish blob in `photo`; use it only if it's already a string URL.
        const photoFallback = typeof row.photo === 'string' ? row.photo.trim() : '';
        if (photoUrl) idToPhoto[String(id)] = photoUrl;
        else if (photoFallback && (photoFallback.startsWith('data:') || photoFallback.startsWith('http'))) {
          idToPhoto[String(id)] = photoFallback;
        }
        const key = normalizeSchedulerDisplayKey(String(row.display_name || ''));
        if (key && !nameToId.has(key)) nameToId.set(key, id);
      }
      setEmployeeDisplayNameToId(new Map(nameToId));
      setSchedulerDisplayNames(idToName);
      setEmployeeIdToPhotoUrl(idToPhoto);

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
            ? buildUtcStartOfDay(fromDate)
            : rows.length > 0
              ? new Date(Math.min(...rows.map((r) => new Date(r.created_at).getTime()))).toISOString()
              : undefined;
        let callTo =
          toDate != null && toDate !== ''
            ? buildUtcEndOfDay(toDate)
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

  useEffect(() => {
    runReportRef.current = runReport;
  }, [runReport]);

  searchedRef.current = searched;

  // Live updates: filters/metadata (channels, sources, firms, links) + optional report refresh when already loaded.
  useEffect(() => {
    const scheduleRefetch = () => {
      if (typeof window === 'undefined') return;
      if (realtimeDebounceRef.current.ref != null) window.clearTimeout(realtimeDebounceRef.current.ref);
      realtimeDebounceRef.current.ref = window.setTimeout(() => {
        realtimeDebounceRef.current.ref = null;
        void loadReferenceData();
      }, 400);
    };

    const scheduleReportRefresh = () => {
      if (typeof window === 'undefined') return;
      if (!searchedRef.current) return;
      if (realtimeDebounceRef.current.report != null) window.clearTimeout(realtimeDebounceRef.current.report);
      realtimeDebounceRef.current.report = window.setTimeout(() => {
        realtimeDebounceRef.current.report = null;
        void runReportRef.current();
      }, 1200);
    };

    const channel = supabase
      .channel('marketing-dashboard-report:realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'misc_leadsource' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'firms' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'misc_country' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sources_firms' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, scheduleReportRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'history_leads' }, scheduleReportRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_logs' }, scheduleReportRefresh)
      .subscribe();

    return () => {
      if (realtimeDebounceRef.current.ref != null && typeof window !== 'undefined') {
        window.clearTimeout(realtimeDebounceRef.current.ref);
      }
      if (realtimeDebounceRef.current.report != null && typeof window !== 'undefined') {
        window.clearTimeout(realtimeDebounceRef.current.report);
      }
      void supabase.removeChannel(channel);
    };
  }, [loadReferenceData]);

  const aggregates = useMemo(() => {
    const map = new Map<string, AggRow>();
    const normalizeSourceName = (s: string | null | undefined) =>
      String(s || '').trim().toLowerCase();
    const sourceNameToRow = new Map<string, SourceRow>();
    for (const s of sources) {
      const key = normalizeSourceName(s.name);
      if (key && !sourceNameToRow.has(key)) sourceNameToRow.set(key, s);
    }

    const resolveSourceRow = (l: LeadRow): SourceRow | null => {
      if (l.misc_leadsource) {
        return {
          id: String(l.misc_leadsource.id),
          name: l.misc_leadsource.name,
          channel_id: l.misc_leadsource.channel_id,
        };
      }
      const key = normalizeSourceName(l.source);
      return key ? sourceNameToRow.get(key) || null : null;
    };

    const channelLabel = (cid: string | null | undefined) => {
      if (!cid) return '—';
      const c = channels.find((x) => x.id === cid);
      if (!c) return 'Unknown channel';
      const base = c.label || c.code || 'Channel';
      return c.is_active ? base : `${base} (inactive)`;
    };

    const getChannelLabel = (l: LeadRow) =>
      channelLabel(resolveSourceRow(l)?.channel_id ?? null);
    const getSourceLabel = (l: LeadRow) =>
      resolveSourceRow(l)?.name || l.source?.trim() || `Source #${l.source_id ?? '?'}`;

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
        const pname = sourceIdToFirmName.get(String(sid));
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

    return Array.from(map.values()).map((r) => {
      const names = r._providerNames;
      let provider = '—';
      if (names && names.size === 1) provider = [...names][0];
      else if (names && names.size > 1) provider = 'Multiple providers';
      const { _providerNames, ...rest } = r;
      return { ...rest, provider };
    });
  }, [leads, groupMode, channels, sourceIdToFirmName]);

  const sortedAggregates = useMemo(() => {
    const rows = [...aggregates];
    const { key, dir } = macroSort;
    const sign = dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const va = macroSortValue(a, key);
      const vb = macroSortValue(b, key);
      if (va !== vb) return sign * (va < vb ? -1 : 1);
      return a.key.localeCompare(b.key);
    });
    return rows;
  }, [aggregates, macroSort]);

  const toggleMacroSort = useCallback((key: MacroSortKey) => {
    setMacroSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' },
    );
  }, []);

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
      { name: 'Eligible', value: totals.eligible },
      { name: 'Meetings', value: totals.meetings },
      { name: 'Offers', value: totals.offers },
      { name: 'Deals', value: totals.deals },
    ];
  }, [totals]);

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
    const row = (fromStage: string | number, toStage: string | number, arr: number[]) => ({
      key: `${fromStage}→${toStage}`,
      fromStage,
      toStage,
      avgDays: arr.length ? average(arr) : null,
      n: arr.length,
    });
    return [
      row('created', HIST_STAGE.communication, seg.createToComm),
      row(HIST_STAGE.communication, HIST_STAGE.meeting, seg.commToMeet),
      row(HIST_STAGE.meeting, HIST_STAGE.offer, seg.meetToOffer),
      row(HIST_STAGE.offer, HIST_STAGE.signed, seg.offerToSigned),
      row(HIST_STAGE.signed, HIST_STAGE.payment, seg.signedToPay),
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
    const bySched = new Map<number, { sec: number; n: number; answered: number; missed: number }>();
    let totalSec = 0;
    let totalN = 0;
    let totalAnswered = 0;
    let totalMissed = 0;
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
        const answered = d > 0;
        totalSec += d;
        totalN += 1;
        if (answered) totalAnswered += 1;
        else totalMissed += 1;
        const cur = bySched.get(schedEmpId) || { sec: 0, n: 0, answered: 0, missed: 0 };
        cur.sec += d;
        cur.n += 1;
        if (answered) cur.answered += 1;
        else cur.missed += 1;
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
        answered: v.answered,
        missed: v.missed,
      }))
      .sort((a, b) => b.calls - a.calls);
    return {
      qualifiedCount: qualified.length,
      totalMatchedCalls: totalN,
      totalAnsweredCalls: totalAnswered,
      totalMissedCalls: totalMissed,
      overallAvgSec: totalN ? totalSec / totalN : null,
      avgProbability: avgProb,
      byScheduler,
    };
  }, [leads, callLogsRows, schedulerDisplayNames, employeeDisplayNameToId]);

  const fmtMoney = (n: number) =>
    `₪ ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  const initialsFromName = (name: string) => {
    const parts = String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const a = parts[0]?.[0] || '?';
    const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : '';
    return (a + b).toUpperCase();
  };

  const SchedulerAvatar: React.FC<{ employeeId: string | number; name: string }> = ({ employeeId, name }) => {
    const url = employeeIdToPhotoUrl[String(employeeId)];
    const [errored, setErrored] = useState(false);
    const showImg = Boolean(url) && !errored;
    return showImg ? (
      <img
        src={url}
        alt={name}
        className="h-9 w-9 rounded-full object-cover ring-1 ring-base-300"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setErrored(true)}
      />
    ) : (
      <div className="h-9 w-9 rounded-full bg-base-200 text-base-content/70 ring-1 ring-base-300 flex items-center justify-center text-[12px] font-extrabold">
        {initialsFromName(name)}
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-16 relative">
      {loading && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-3">
            <span className="loading loading-spinner w-16 h-16 text-primary" />
            <div className="text-sm font-semibold text-base-content/70">Running report…</div>
          </div>
        </div>
      )}
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
              <h3
                id="marketing-report-docs-title"
                className={`pr-8 text-lg font-bold leading-tight ${REPORT_SECTION_TITLE_CLASS}`}
              >
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
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-base-content/55">Scope & data</h4>
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
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-base-content/55">Not in this version</h4>
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
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-base-content/55">Macro table · CPL columns</h4>
              <p>
                <strong>CPL</strong> and <strong>cost / eligible</strong> need a media + management cost table; values show “—” until that exists. The optional HR column is only a layout placeholder when enabled — no HR data is loaded yet.
              </p>
            </section>

            <section>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-base-content/55">Funnel timing (avg. days)</h4>
              <p>
                Derived from <code className="rounded bg-base-200 px-1 text-[11px]">history_leads</code>: stage ≥15 = communication, ≥20 meeting, ≥45 offer, ≥60 signed, ≥70 payment. Communication time also uses{' '}
                <code className="rounded bg-base-200 px-1 text-[11px]">communication_started_at</code> when set. A segment only counts when both endpoints exist.
              </p>
              <p className="mt-2 text-xs text-base-content/60">
                If timing fails to load, check RLS and table access for <code className="rounded bg-base-200 px-1 text-[11px]">history_leads</code> (errors appear on the main screen).
              </p>
            </section>

            <section>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-base-content/55">Sales behaviour / quality</h4>
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
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-base-content/55">Cost & profitability</h4>
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

      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
          <label className="form-control min-w-0 xl:col-span-1">
            <span className={FILTER_FIELD_LABEL_CLASS}>From</span>
            <input
              type="date"
              className={`input input-md min-h-12 w-full text-base ${ENGRAVED_FILTER_CONTROL_CLASSES}`}
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </label>
          <label className="form-control min-w-0 xl:col-span-1">
            <span className={FILTER_FIELD_LABEL_CLASS}>To</span>
            <input
              type="date"
              className={`input input-md min-h-12 w-full text-base ${ENGRAVED_FILTER_CONTROL_CLASSES}`}
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>
          <div className="min-w-0 xl:col-span-1">
            <MarketingSearchMultiFilter
              label="Channel"
              placeholder="Search channels…"
              options={channels.filter((c) => c.is_active).map((c) => ({ id: c.id, label: c.label }))}
              selected={channelIds}
              onChange={setChannelIds}
              inputClassName={ENGRAVED_FILTER_CONTROL_CLASSES}
            />
          </div>
          <div className="min-w-0 xl:col-span-1">
            <MarketingSearchMultiFilter
              label="Source"
              placeholder="Search sources…"
              options={sources.map((s) => ({ id: String(s.id), label: s.name }))}
              selected={sourceIds}
              onChange={setSourceIds}
              inputClassName={ENGRAVED_FILTER_CONTROL_CLASSES}
            />
          </div>
          <div className="min-w-0 xl:col-span-1">
            <MarketingSearchMultiFilter
              label="Country"
              placeholder="Search countries…"
              options={countries.map((c) => ({ id: String(c.id), label: c.name }))}
              selected={countryIds}
              onChange={setCountryIds}
              inputClassName={ENGRAVED_FILTER_CONTROL_CLASSES}
            />
          </div>
          <div className="min-w-0 xl:col-span-1">
            <MarketingSearchMultiFilter
              label="Provider (firm)"
              placeholder="Search firms…"
              options={firms.map((f) => ({ id: f.id, label: f.name }))}
              selected={firmIds}
              onChange={setFirmIds}
              inputClassName={ENGRAVED_FILTER_CONTROL_CLASSES}
            />
          </div>
          <div className="flex min-w-0 flex-col items-end justify-end xl:col-span-1">
            <span className={`${FILTER_FIELD_LABEL_CLASS} w-full`}>Action</span>
            <button
              type="button"
              className={`btn btn-primary min-h-12 h-12 w-auto shrink-0 px-5 text-base font-semibold ${ENGRAVED_FILTER_PRIMARY_BUTTON_CLASSES}`}
              onClick={() => void runReport()}
              disabled={loading}
            >
              {loading ? <span className="loading loading-spinner loading-md" /> : 'Run report'}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-base-content/55">
              Group by
            </span>
            <div
              className={
                'inline-flex rounded-2xl p-1 ' +
                'border border-base-content/[0.08] bg-base-300/45 dark:border-white/[0.06] dark:bg-base-content/[0.1] ' +
                'shadow-[inset_0_4px_14px_rgba(0,0,0,0.11),inset_0_2px_4px_rgba(0,0,0,0.05),0_1px_0_rgba(255,255,255,0.35)] ' +
                'dark:shadow-[inset_0_5px_18px_rgba(0,0,0,0.52),inset_0_1px_0_rgba(255,255,255,0.05)]'
              }
              role="group"
              aria-label="Group table by source or channel"
            >
              <button
                type="button"
                aria-pressed={groupMode === 'source'}
                className={`min-w-[7rem] cursor-pointer rounded-[0.65rem] px-4 py-2 text-sm font-bold tracking-tight transition-colors duration-200 ease-out outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 ${
                  groupMode === 'source'
                    ? 'bg-primary text-primary-content shadow-[inset_0_3px_10px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.14)] dark:shadow-[inset_0_4px_14px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.08)]'
                    : 'text-base-content/55 shadow-[inset_0_2px_6px_rgba(0,0,0,0.05)] hover:bg-black/[0.04] hover:text-base-content/90 dark:shadow-[inset_0_2px_8px_rgba(0,0,0,0.25)] dark:hover:bg-white/[0.05]'
                }`}
                onClick={() => setGroupMode('source')}
              >
                Source
              </button>
              <button
                type="button"
                aria-pressed={groupMode === 'channel'}
                className={`min-w-[7rem] cursor-pointer rounded-[0.65rem] px-4 py-2 text-sm font-bold tracking-tight transition-colors duration-200 ease-out outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 ${
                  groupMode === 'channel'
                    ? 'bg-primary text-primary-content shadow-[inset_0_3px_10px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.14)] dark:shadow-[inset_0_4px_14px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.08)]'
                    : 'text-base-content/55 shadow-[inset_0_2px_6px_rgba(0,0,0,0.05)] hover:bg-black/[0.04] hover:text-base-content/90 dark:shadow-[inset_0_2px_8px_rgba(0,0,0,0.25)] dark:hover:bg-white/[0.05]'
                }`}
                onClick={() => setGroupMode('channel')}
              >
                Channel
              </button>
            </div>
          </div>
          <label className="label cursor-pointer justify-start gap-2.5 py-0 sm:justify-end">
            <input
              type="checkbox"
              className="checkbox checkbox-sm checkbox-primary"
              checked={includeHrCost}
              onChange={(e) => setIncludeHrCost(e.target.checked)}
            />
            <span className="label-text text-sm text-base-content/55">HR cost column (placeholder)</span>
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[
              {
                label: 'Leads',
                value: totals.leads,
                icon: UserGroupIcon,
                targetId: 'marketing-kpi-macro',
                className:
                  'bg-gradient-to-tr from-purple-600 via-blue-600 to-blue-500 text-white',
              },
              {
                label: 'Eligible',
                value: totals.eligible,
                icon: CheckCircleIcon,
                targetId: 'marketing-kpi-timing',
                className:
                  'bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white',
              },
              {
                label: 'Meetings (excl. inactive)',
                value: totals.meetings,
                icon: CalendarDaysIcon,
                targetId: 'marketing-kpi-funnel',
                className:
                  'bg-gradient-to-tr from-fuchsia-500 via-rose-500 to-orange-400 text-white',
              },
              {
                label: 'Deals (signed)',
                value: totals.deals,
                icon: CheckCircleIcon,
                targetId: 'marketing-kpi-sales',
                className:
                  'bg-gradient-to-tr from-emerald-500 via-teal-500 to-cyan-400 text-white',
              },
              {
                label: 'Revenue (NIS)',
                value: fmtMoney(totals.revenue),
                icon: BanknotesIcon,
                targetId: 'marketing-kpi-macro',
                className:
                  'bg-gradient-to-tr from-indigo-600 via-violet-600 to-fuchsia-500 text-white',
              },
            ].map((k) => (
              <button
                key={k.label}
                type="button"
                onClick={() => {
                  const el = document.getElementById(k.targetId);
                  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className={`rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl shadow-xl relative overflow-hidden p-6 min-h-[7.5rem] text-left ${k.className}`}
              >
                <div className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/20 shadow">
                    <k.icon className="w-7 h-7 text-white opacity-95" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white/85">{k.label}</div>
                    <div className="text-3xl font-extrabold text-white leading-tight">{k.value}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Main macro table */}
          <div
            id="marketing-kpi-macro"
            className="scroll-mt-24 overflow-x-auto rounded-xl border border-base-300 bg-base-100 shadow-sm"
          >
            <h3
              className={`border-b border-base-300 px-4 py-3 text-base font-bold ${REPORT_SECTION_TITLE_CLASS}`}
            >
              Macro performance (by {groupMode})
            </h3>
            <table className={REPORT_TABLE_CLASS}>
              <thead>
                <tr className="border-b border-base-300 bg-base-100 text-[11px] uppercase tracking-wide">
                  <th
                    colSpan={groupMode === 'source' ? 3 : 2}
                    className="text-left text-base-content/50"
                    style={{ letterSpacing: '0.08em' }}
                  >
                    Performance
                  </th>
                  <th
                    colSpan={9}
                    className="text-center text-base-content/50"
                    style={{ letterSpacing: '0.08em' }}
                  >
                    Funnel
                  </th>
                  <th
                    colSpan={2}
                    className="text-center text-base-content/50"
                    style={{ letterSpacing: '0.08em' }}
                  >
                    Revenue
                  </th>
                  <th
                    colSpan={includeHrCost ? 5 : 4}
                    className="text-center text-base-content/60"
                    style={{ letterSpacing: '0.08em' }}
                  >
                    Cost
                  </th>
                </tr>
                <tr className="border-b border-base-300 bg-base-100 text-xs uppercase md:text-sm">
                  <th scope="col">Channel</th>
                  {groupMode === 'source' && <th scope="col">Source</th>}
                  <th scope="col">Provider</th>
                  <MacroSortableTh
                    sortKey="leads"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Leads"
                    className="text-right"
                  >
                    Leads
                  </MacroSortableTh>
                  <MacroSortableTh
                    sortKey="eligible"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Eligible"
                    className="text-right"
                  >
                    Eligible
                  </MacroSortableTh>
                  <MacroSortableTh
                    sortKey="meetings"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Meetings"
                    className="text-right"
                  >
                    Meetings
                  </MacroSortableTh>
                  <MacroSortableTh
                    sortKey="offers"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Offers"
                    className="text-right"
                  >
                    Offers
                  </MacroSortableTh>
                  <MacroSortableTh
                    sortKey="deals"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Deals"
                    className="text-right"
                  >
                    Deals
                  </MacroSortableTh>
                  <MacroSortableTh
                    sortKey="pctElig"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Lead to eligible percent"
                    className="text-right"
                  >
                    Lead→Elig %
                  </MacroSortableTh>
                  <MacroSortableTh
                    sortKey="pctMtg"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Lead to meeting percent"
                    className="text-right"
                  >
                    Lead→Mtg %
                  </MacroSortableTh>
                  <MacroSortableTh
                    sortKey="pctOffer"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Lead to offer percent"
                    className="text-right"
                  >
                    Lead→Offer %
                  </MacroSortableTh>
                  <MacroSortableTh
                    sortKey="pctDeal"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Lead to deal percent"
                    className="text-right"
                  >
                    Lead→Deal %
                  </MacroSortableTh>
                  <MacroSortableTh
                    sortKey="revenue"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Revenue NIS"
                    className="text-right"
                  >
                    Revenue
                  </MacroSortableTh>
                  <MacroSortableTh
                    sortKey="inactive"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Inactive"
                    className="text-right"
                  >
                    Inactive
                  </MacroSortableTh>
                  <th className="text-right">Media</th>
                  <th className="text-right">Management</th>
                  {includeHrCost && <th className="text-right">HR</th>}
                  <th className="text-right">Total</th>
                  <th className="text-right">% leads</th>
                </tr>
              </thead>
              <tbody>
                {sortedAggregates.map((r) => {
                  const pct = (a: number, b: number) => (b > 0 ? ((a / b) * 100).toFixed(1) : '—');
                  const pctLeads = totals.leads ? ((r.leads / totals.leads) * 100).toFixed(1) : '0.0';
                  return (
                    <tr key={r.key}>
                      <td className="whitespace-nowrap">
                        <ChannelLabel
                          label={r.channel}
                          seed={r.channel}
                          inactive={r.channel.toLowerCase().includes('(inactive)')}
                        />
                      </td>
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
                      <td className="text-right text-sm font-semibold">{fmtMoney(r.revenueNis)}</td>
                      <td className="text-right">{r.inactive}</td>
                      <td className="text-right">—</td>
                      <td className="text-right">—</td>
                      {includeHrCost && <td className="text-right">—</td>}
                      <td className="text-right">—</td>
                      <td className="text-right">{pctLeads}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Funnel chart */}
          <div
            id="marketing-kpi-funnel"
            className="scroll-mt-24 rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm"
          >
            <h3 className={`mb-2 text-base font-bold ${REPORT_SECTION_TITLE_CLASS}`}>Funnel snapshot</h3>
            <div className="h-64 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-40" />
                  <XAxis dataKey="name" tick={{ fontSize: 13 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 13 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="value" name="Count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Timing from history_leads */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div
              id="marketing-kpi-timing"
              className="scroll-mt-24 rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm"
            >
              <h3 className={`text-base font-bold ${REPORT_SECTION_TITLE_CLASS}`}>Funnel timing (avg. days)</h3>
              {historyError && (
                <p className="mt-2 text-sm text-error">
                  History could not be loaded: {historyError} (check RLS / table access).
                </p>
              )}
              {!historyError && leads.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className={REPORT_TABLE_CLASS}>
                    <thead>
                      <tr className="border-b border-base-300 bg-base-100 text-xs uppercase md:text-sm">
                        <th>Segment</th>
                        <th className="text-right">Avg days</th>
                        <th className="text-right">Leads counted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {funnelTimingRows.map((r) => (
                        <tr key={r.key}>
                          <td className="text-sm">
                            <div className="flex flex-col leading-snug">
                              <div className="font-semibold">
                                {getStageName(String(r.fromStage))}
                              </div>
                              <div className="text-gray-500">
                                <span className="inline-block w-4 text-center">↳</span>
                                {getStageName(String(r.toStage))}
                              </div>
                            </div>
                          </td>
                          <td className="text-right font-mono text-sm">
                            {r.avgDays != null ? r.avgDays.toFixed(1) : '—'}
                          </td>
                          <td className="text-right text-sm">{r.n}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div
              id="marketing-kpi-sales"
              className="scroll-mt-24 rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm"
            >
              <h3 className={`text-base font-bold ${REPORT_SECTION_TITLE_CLASS}`}>Sales behaviour / quality</h3>
              {callLogsError && (
                <p className="mt-2 text-sm text-error">call_logs: {callLogsError}</p>
              )}
              {!callLogsError && leads.length > 0 && (
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap gap-3 text-sm">
                    <span className="rounded-lg bg-base-200 px-2 py-1">
                      Qualified leads: <strong>{salesBehaviourStats.qualifiedCount}</strong>
                    </span>
                    <span className="rounded-lg bg-base-200 px-2 py-1">
                      Matched calls: <strong>{salesBehaviourStats.totalMatchedCalls}</strong>
                    </span>
                    <span className="rounded-lg bg-base-200 px-2 py-1">
                      Answered: <strong>{salesBehaviourStats.totalAnsweredCalls}</strong>
                    </span>
                    <span className="rounded-lg bg-base-200 px-2 py-1">
                      Not answered: <strong>{salesBehaviourStats.totalMissedCalls}</strong>
                    </span>
                    <span className="rounded-lg bg-base-200 px-2 py-1">
                      Avg call (matched):{' '}
                      <strong>
                        {salesBehaviourStats.overallAvgSec != null
                          ? fmtDurationMinSec(salesBehaviourStats.overallAvgSec)
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
                      <table className={REPORT_TABLE_CLASS}>
                        <thead>
                          <tr className="border-b border-base-300 bg-base-100 text-xs uppercase md:text-sm">
                            <th>Scheduler</th>
                            <th className="text-right">Calls</th>
                            <th className="text-right">Answered</th>
                            <th className="text-right">Not answered</th>
                            <th className="text-right">Avg duration</th>
                          </tr>
                        </thead>
                        <tbody>
                          {salesBehaviourStats.byScheduler.map((r) => (
                            <tr key={r.id}>
                              <td className="max-w-[14rem]">
                                <div className="flex items-center gap-2 min-w-0">
                                  <SchedulerAvatar employeeId={r.id} name={r.name} />
                                  <span className="truncate">{r.name}</span>
                                </div>
                              </td>
                              <td className="text-right">{r.calls}</td>
                              <td className="text-right">{r.answered}</td>
                              <td className="text-right">{r.missed}</td>
                              <td className="text-right font-mono text-sm">{fmtDurationMinSec(r.avgSec)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-base-content/60">
                      No calls matched (check scheduler on leads; 1com sync should set{' '}
                      <code className="text-xs">client_id</code> or legacy <code className="text-xs">lead_id</code>).
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Cost breakdown table removed — columns moved into Macro table above. */}
        </>
      )}

      {!searched && (
        <div className="rounded-2xl border border-dashed border-base-300/70 bg-base-200/25 px-6 py-14 text-center dark:border-base-content/15 dark:bg-base-300/10">
          <p className="text-base leading-relaxed text-base-content/55">
            Set your filters above, then click <span className="font-semibold text-base-content/75">Run report</span> to
            load results.
          </p>
        </div>
      )}
    </div>
  );
};

export default MarketingDashboardReport;
