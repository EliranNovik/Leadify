import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDownIcon, ChevronUpDownIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import { resolvePipelineIdentity } from '../../lib/resolvePipelineIdentity';
import type { PipelineViewAs } from '../../lib/resolvePipelineIdentity';
import { convertToNIS } from '../../lib/currencyConversion';
import { localTodayYmd } from '../../lib/meetingRescheduleCancel';
import { HIGH_VALUE_NIS_THRESHOLD } from '../../lib/pipelineSummary';
import {
  getSoftStageBadgeStyle,
  getStageColour,
  getStageName,
  initializeStageNames,
} from '../../lib/stageUtils';
import { openLeadFromRowClick } from '../../lib/leadNavigation';
import {
  createSnapshotStore,
  pipelineViewIdentityKey,
  useRevalidateOnVisible,
  useScrollRestoration,
} from '../../lib/pipelineLiveCache';
import ExpertSummaryCards, {
  type ExpertQuickFilter,
  type ExpertSummaryCounts,
} from './ExpertSummaryCards';
import { uniqueSorted } from './HandlerPipelineFilterBar';
import {
  handlePipelineRowPick,
  isPipelineLeadPicked,
  toPipelineActionLead,
  type PipelineLeadSelectProps,
} from './pipelineActions';
import {
  PipelineRowPickCell,
  PipelineRowPickHeader,
} from './PipelineRowPickCell';
import {
  PIPELINE_CELL_FIRST,
  PIPELINE_CELL_LAST,
  PIPELINE_CELL_MID,
  PIPELINE_CELL_STYLE,
  PIPELINE_TABLE_CLASS,
  PIPELINE_THEAD_CLASS,
  formatPipelineCategory,
  formatPipelineMoney,
  pipelineMainCategory,
  pipelineProbabilityTone,
  pipelineRowClassName,
} from './pipelineUi';
import { loadPipelineFilters, savePipelineFilters } from './pipelineFilterPersist';

type ExpertPipelineRow = {
  id: string;
  navId: string;
  lead_number: string;
  name: string;
  created_at: string;
  stage: string;
  category: string;
  mainCategory: string;
  meeting_date: string | null;
  meetingYmds: string[];
  probability: number | null;
  applicants: number | null;
  value: number | null;
  currency: string | null;
  valueNis: number;
  phone: string | null;
  mobile: string | null;
  email: string | null;
};

const EXPERT_RESULT_STATUSES = ['feasible_no_check', 'feasible_check', 'not_feasible'];

function toYmd(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = String(value).trim().split(/[ T]/)[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function meetingYmdsFrom(meetings: Array<{ meeting_date?: string | null }> | null | undefined): string[] {
  const keys = new Set<string>();
  (meetings || []).forEach((meeting) => {
    const ymd = toYmd(meeting.meeting_date);
    if (ymd) keys.add(ymd);
  });
  return Array.from(keys);
}

function localMonthStartYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function isInCurrentMonth(value: string | null | undefined, monthStart: string): boolean {
  const ymd = toYmd(value);
  return Boolean(ymd && ymd >= monthStart);
}

function valueToNis(amount: number | null | undefined, currency: string | null | undefined): number {
  const symbolMap: Record<string, string> = { '₪': 'NIS', '€': 'EUR', '$': 'USD', '£': 'GBP' };
  const code = currency ? symbolMap[currency] || currency : 'NIS';
  return convertToNIS(Number(amount) || 0, code);
}

type Props = {
  onCountChange?: (count: number) => void;
  viewAs?: PipelineViewAs | null;
} & PipelineLeadSelectProps;

function latestMeetingDate(meetings: Array<{ meeting_date?: string | null }> | null | undefined): string | null {
  if (!meetings || meetings.length === 0) return null;
  let latest: string | null = null;
  let latestMs = -Infinity;
  for (const meeting of meetings) {
    const ymd = toYmd(meeting.meeting_date);
    if (!ymd) continue;
    const ms = Date.parse(ymd);
    if (!Number.isFinite(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latest = meeting.meeting_date || ymd;
    }
  }
  return latest;
}

function meetingIn2025OrLater(meetings: Array<{ meeting_date?: string | null }> | null | undefined): boolean {
  return meetingYmdsFrom(meetings).some((ymd) => Number(ymd.slice(0, 4)) >= 2025);
}

function assignedDays(createdAt: string): number {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return -1;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(created);
  start.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function daysSinceAssigned(createdAt: string): string {
  const days = assignedDays(createdAt);
  if (days < 0) return '—';
  if (days <= 0) return 'Today';
  return `${days} day${days === 1 ? '' : 's'}`;
}

type ExpertSortColumn = 'assigned_since' | 'probability';
type ExpertHighValueFilter = '' | 'high';

type ExpertFilterState = {
  search: string;
  categoryFilter: string;
  stageFilter: string;
  highValueFilter: ExpertHighValueFilter;
  dateFrom: string;
  dateTo: string;
  sortColumn: ExpertSortColumn;
  sortDirection: 'asc' | 'desc';
  quickFilter: ExpertQuickFilter;
};

const DEFAULT_EXPERT_FILTERS: ExpertFilterState = {
  search: '',
  categoryFilter: '',
  stageFilter: '',
  highValueFilter: '',
  dateFrom: '',
  dateTo: '',
  sortColumn: 'assigned_since',
  sortDirection: 'asc',
  quickFilter: null,
};

type ExpertSnapshot = {
  identityKey: string;
  rows: ExpertPipelineRow[];
  resultsThisMonth: number;
};

const EXPERT_CACHE_VERSION = 1;
const EXPERT_STALE_MS = 5 * 60 * 1000;
const snapshotStore = createSnapshotStore<ExpertSnapshot>(EXPERT_CACHE_VERSION);

function matchingExpertSnapshot(viewAs: PipelineViewAs | null): ExpertSnapshot | null {
  const snapshot = snapshotStore.get();
  if (!snapshot || snapshot.identityKey !== pipelineViewIdentityKey(viewAs)) return null;
  return snapshot;
}

const SELECT_CLASS = 'select select-bordered w-full rounded-xl border-gray-200 bg-white text-sm';

const ExpertPipelineView: React.FC<Props> = ({
  onCountChange,
  viewAs = null,
  selectedLeadId = null,
  selectedLeadIds,
  picking = false,
  multiSelect = false,
  onSelectLead,
  refreshToken = 0,
}) => {
  const navigate = useNavigate();
  const initialSnapshot = matchingExpertSnapshot(viewAs);
  const [loading, setLoading] = useState(() => initialSnapshot == null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ExpertPipelineRow[]>(() => initialSnapshot?.rows || []);
  const [search, setSearch] = useState(() => loadPipelineFilters('expert', DEFAULT_EXPERT_FILTERS).search);
  const [categoryFilter, setCategoryFilter] = useState(
    () => loadPipelineFilters('expert', DEFAULT_EXPERT_FILTERS).categoryFilter,
  );
  const [stageFilter, setStageFilter] = useState(
    () => loadPipelineFilters('expert', DEFAULT_EXPERT_FILTERS).stageFilter,
  );
  const [highValueFilter, setHighValueFilter] = useState<ExpertHighValueFilter>(
    () => loadPipelineFilters('expert', DEFAULT_EXPERT_FILTERS).highValueFilter,
  );
  const [dateFrom, setDateFrom] = useState(() => loadPipelineFilters('expert', DEFAULT_EXPERT_FILTERS).dateFrom);
  const [dateTo, setDateTo] = useState(() => loadPipelineFilters('expert', DEFAULT_EXPERT_FILTERS).dateTo);
  const [sortColumn, setSortColumn] = useState<ExpertSortColumn>(
    () => loadPipelineFilters('expert', DEFAULT_EXPERT_FILTERS).sortColumn,
  );
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(
    () => loadPipelineFilters('expert', DEFAULT_EXPERT_FILTERS).sortDirection,
  );
  const [quickFilter, setQuickFilter] = useState<ExpertQuickFilter>(
    () => loadPipelineFilters('expert', DEFAULT_EXPERT_FILTERS).quickFilter,
  );
  const [resultsThisMonth, setResultsThisMonth] = useState(
    () => initialSnapshot?.resultsThisMonth || 0,
  );

  useEffect(() => {
    savePipelineFilters('expert', {
      search,
      categoryFilter,
      stageFilter,
      highValueFilter,
      dateFrom,
      dateTo,
      sortColumn,
      sortDirection,
      quickFilter,
    } satisfies ExpertFilterState);
  }, [
    search,
    categoryFilter,
    stageFilter,
    highValueFilter,
    dateFrom,
    dateTo,
    sortColumn,
    sortDirection,
    quickFilter,
  ]);

  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    const { silent = false } = options;
    if (!silent) setLoading(true);
    setError(null);
    try {
      await initializeStageNames();
      const identity = await resolvePipelineIdentity(viewAs);
      const employeeId = identity.employeeId;

      const monthStart = localMonthStartYmd();
      const [newResult, legacyResult, newResultsMonth, legacyResultsMonth] = await Promise.all([
        supabase
          .from('leads')
          .select(`
            id, lead_number, name, created_at, expert, topic, category_id, category, stage,
            probability, number_of_applicants_meeting, balance, balance_currency,
            proposal_total, proposal_currency, phone, mobile, email,
            meetings ( meeting_date ),
            misc_category!category_id (
              id, name, parent_id,
              misc_maincategory!parent_id ( id, name )
            )
          `)
          .eq('expert', employeeId)
          .or('eligibility_status.is.null,eligibility_status.eq.""')
          .is('unactivated_at', null)
          .gte('stage', 20)
          .or('stage.lt.50,stage.eq.55')
          .neq('stage', 35)
          .order('created_at', { ascending: false }),
        supabase
          .from('leads_lead')
          .select(`
            id, name, cdate, expert_id, topic, category_id, category, stage, probability,
            no_of_applicants, meeting_date, meeting_time, expert_examination,
            total_base, currency_id, proposal,
            misc_category!category_id (
              id, name, parent_id,
              misc_maincategory!parent_id ( id, name )
            )
          `)
          .eq('expert_id', employeeId)
          .or('expert_examination.eq.0,expert_examination.is.null')
          .eq('status', 0)
          .gte('stage', 20)
          .or('stage.lt.50,stage.eq.55')
          .neq('stage', 35)
          .order('cdate', { ascending: false }),
        supabase
          .from('leads')
          .select('id, eligibility_status, eligibility_status_timestamp, created_at')
          .eq('expert', employeeId)
          .in('eligibility_status', EXPERT_RESULT_STATUSES)
          .or(`eligibility_status_timestamp.gte.${monthStart},created_at.gte.${monthStart}`),
        supabase
          .from('leads_lead')
          .select('id, expert_examination, cdate, eligibility_status_timestamp, eligibilty_date')
          .eq('expert_id', employeeId)
          .not('expert_examination', 'is', null)
          .neq('expert_examination', '0')
          .neq('expert_examination', '')
          .or(`eligibility_status_timestamp.gte.${monthStart},eligibilty_date.gte.${monthStart},cdate.gte.${monthStart}`),
      ]);

      if (newResult.error) throw newResult.error;
      if (legacyResult.error) throw legacyResult.error;

      let newMonthData = newResultsMonth.error ? [] : newResultsMonth.data || [];
      let legacyMonthData = legacyResultsMonth.error ? [] : legacyResultsMonth.data || [];
      if (newResultsMonth.error) {
        console.warn('Expert results this month (new):', newResultsMonth.error.message);
        const fallback = await supabase
          .from('leads')
          .select('id, eligibility_status, created_at')
          .eq('expert', employeeId)
          .in('eligibility_status', EXPERT_RESULT_STATUSES)
          .gte('created_at', monthStart);
        if (!fallback.error) newMonthData = (fallback.data || []) as typeof newMonthData;
      }
      if (legacyResultsMonth.error) {
        console.warn('Expert results this month (legacy):', legacyResultsMonth.error.message);
        const fallback = await supabase
          .from('leads_lead')
          .select('id, expert_examination, cdate')
          .eq('expert_id', employeeId)
          .not('expert_examination', 'is', null)
          .neq('expert_examination', '0')
          .neq('expert_examination', '')
          .gte('cdate', monthStart);
        if (!fallback.error) legacyMonthData = (fallback.data || []) as typeof legacyMonthData;
      }
      const monthCount = [...newMonthData, ...legacyMonthData].filter((lead: any) => {
        const stamped =
          lead.eligibility_status_timestamp || lead.eligibilty_date || lead.created_at || lead.cdate;
        return isInCurrentMonth(stamped, monthStart);
      }).length;
      setResultsThisMonth(monthCount);

      const legacyIds = (legacyResult.data || []).map((lead) => lead.id);
      const meetingsByLegacyId: Record<number, Array<{ meeting_date: string }>> = {};
      if (legacyIds.length > 0) {
        const { data: meetingsData, error: meetingsError } = await supabase
          .from('meetings')
          .select('legacy_lead_id, meeting_date')
          .in('legacy_lead_id', legacyIds);
        if (meetingsError) throw meetingsError;
        (meetingsData || []).forEach((meeting) => {
          if (!meeting.legacy_lead_id || !meeting.meeting_date) return;
          const list = meetingsByLegacyId[meeting.legacy_lead_id] || [];
          list.push({ meeting_date: meeting.meeting_date });
          meetingsByLegacyId[meeting.legacy_lead_id] = list;
        });
      }

      const newRows: ExpertPipelineRow[] = [];
      for (const lead of newResult.data || []) {
        const meetings = (lead.meetings || []) as Array<{ meeting_date?: string | null }>;
        if (!meetingIn2025OrLater(meetings)) continue;
        const currency = lead.balance_currency || lead.proposal_currency || '₪';
        const value = lead.balance ?? lead.proposal_total ?? null;
        newRows.push({
          id: String(lead.id),
          navId: String(lead.lead_number || lead.id),
          lead_number: String(lead.lead_number || lead.id),
          name: lead.name || '—',
          created_at: lead.created_at,
          stage: String(lead.stage ?? ''),
          category: formatPipelineCategory(lead.misc_category, lead.category || lead.topic),
          mainCategory: pipelineMainCategory(lead.misc_category),
          meeting_date: latestMeetingDate(meetings),
          meetingYmds: meetingYmdsFrom(meetings),
          probability: lead.probability != null ? Number(lead.probability) : null,
          applicants: lead.number_of_applicants_meeting ?? null,
          value,
          currency,
          valueNis: valueToNis(value, currency),
          phone: lead.phone || null,
          mobile: lead.mobile || null,
          email: lead.email || null,
        });
      }

      const legacyRows: ExpertPipelineRow[] = [];
      for (const lead of legacyResult.data || []) {
        const meetings: Array<{ meeting_date?: string | null }> = [];
        if (lead.meeting_date) {
          meetings.push({
            meeting_date: lead.meeting_time
              ? `${lead.meeting_date} ${lead.meeting_time}`
              : lead.meeting_date,
          });
        }
        const extraMeetings = meetingsByLegacyId[lead.id] || [];
        meetings.push(...extraMeetings);
        if (meetings.length === 0) continue;
        if (!meetingIn2025OrLater(meetings) && extraMeetings.length === 0) continue;
        const currencyId = Number(lead.currency_id);
        const currency =
          currencyId === 2 ? '€' : currencyId === 3 ? '$' : currencyId === 4 ? '£' : '₪';
        const value = lead.total_base ?? lead.proposal ?? null;
        legacyRows.push({
          id: `legacy_${lead.id}`,
          navId: String(lead.id),
          lead_number: String(lead.id),
          name: lead.name || '—',
          created_at: lead.cdate || new Date().toISOString(),
          stage: String(lead.stage ?? ''),
          category: formatPipelineCategory(lead.misc_category, lead.category || lead.topic),
          mainCategory: pipelineMainCategory(lead.misc_category),
          meeting_date: latestMeetingDate(meetings),
          meetingYmds: meetingYmdsFrom(meetings),
          probability: lead.probability != null ? Number(lead.probability) : null,
          applicants: lead.no_of_applicants ?? null,
          value,
          currency,
          valueNis: valueToNis(value, currency),
          phone: null,
          mobile: null,
          email: null,
        });
      }

      const combined = [...newRows, ...legacyRows].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      setRows(combined);
      snapshotStore.set({
        identityKey: pipelineViewIdentityKey(viewAs),
        rows: combined,
        resultsThisMonth: monthCount,
      });
    } catch (err) {
      console.error('Expert pipeline load:', err);
      if (silent) return;
      snapshotStore.clear();
      setError(err instanceof Error ? err.message : 'Failed to load expert pipeline');
      setRows([]);
      setResultsThisMonth(0);
    } finally {
      setLoading(false);
    }
  }, [viewAs]);

  useEffect(() => {
    if (matchingExpertSnapshot(viewAs)) {
      void load({ silent: true });
      return;
    }
    void load();
  }, [load, viewAs]);

  useEffect(() => {
    if (!refreshToken) return;
    void load({ silent: true });
  }, [refreshToken, load]);

  useRevalidateOnVisible({
    isStale: () => snapshotStore.isStale(EXPERT_STALE_MS),
    onRevalidate: () => void load({ silent: true }),
  });
  useScrollRestoration(snapshotStore, loading);

  useEffect(() => {
    onCountChange?.(rows.length);
  }, [onCountChange, rows.length]);

  const summaryCounts: ExpertSummaryCounts = useMemo(() => {
    const today = localTodayYmd();
    let upcomingMeeting = 0;
    let missingToday = 0;
    let highValue = 0;
    rows.forEach((row) => {
      if (row.meetingYmds.some((ymd) => ymd >= today)) upcomingMeeting += 1;
      if (row.meetingYmds.includes(today)) missingToday += 1;
      if (row.valueNis > HIGH_VALUE_NIS_THRESHOLD) highValue += 1;
    });
    return {
      upcomingMeeting,
      resultsThisMonth,
      missingToday,
      highValue,
    };
  }, [rows, resultsThisMonth]);

  const filterOptions = useMemo(() => {
    const stageMap = new Map<string, string>();
    rows.forEach((row) => {
      if (!row.stage) return;
      stageMap.set(row.stage, getStageName(row.stage) || row.stage);
    });
    return {
      categories: uniqueSorted(rows.map((row) => row.mainCategory)),
      stages: Array.from(stageMap.entries())
        .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }))
        .map(([id, name]) => ({ id, name })),
    };
  }, [rows]);

  const tableFiltersActive = Boolean(categoryFilter || stageFilter || highValueFilter || dateFrom || dateTo);

  const handleSort = (column: ExpertSortColumn) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortColumn(column);
    setSortDirection(column === 'probability' ? 'desc' : 'asc');
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const today = localTodayYmd();
    const next = rows.filter((row) => {
      if (quickFilter === 'upcoming_meeting' && !row.meetingYmds.some((ymd) => ymd >= today)) return false;
      if (quickFilter === 'missing_today' && !row.meetingYmds.includes(today)) return false;
      if (
        (quickFilter === 'high_value' || highValueFilter === 'high') &&
        row.valueNis <= HIGH_VALUE_NIS_THRESHOLD
      ) {
        return false;
      }
      if (categoryFilter && row.mainCategory !== categoryFilter) return false;
      if (stageFilter && row.stage !== stageFilter) return false;
      if (dateFrom || dateTo) {
        const meetingKey = toYmd(row.meeting_date) || row.meetingYmds.slice().sort().at(-1) || null;
        if (!meetingKey) return false;
        if (dateFrom && meetingKey < dateFrom) return false;
        if (dateTo && meetingKey > dateTo) return false;
      }
      if (!q) return true;
      return [row.lead_number, row.name, row.category, getStageName(row.stage)]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });

    const dir = sortDirection === 'asc' ? 1 : -1;
    next.sort((a, b) => {
      if (sortColumn === 'probability') {
        const av = a.probability ?? -1;
        const bv = b.probability ?? -1;
        if (av === bv) return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        return (av - bv) * dir;
      }
      const av = assignedDays(a.created_at);
      const bv = assignedDays(b.created_at);
      if (av === bv) return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return (av - bv) * dir;
    });
    return next;
  }, [rows, search, quickFilter, categoryFilter, stageFilter, highValueFilter, dateFrom, dateTo, sortColumn, sortDirection]);

  const SortHeader = ({
    column,
    children,
  }: {
    column: ExpertSortColumn;
    children: React.ReactNode;
  }) => {
    const active = sortColumn === column;
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 font-semibold hover:text-gray-800"
        onClick={() => handleSort(column)}
      >
        {children}
        {active ? (
          <ChevronDownIcon
            className={`h-3.5 w-3.5 text-primary transition ${sortDirection === 'asc' ? 'rotate-180' : ''}`}
          />
        ) : (
          <ChevronUpDownIcon className="h-3.5 w-3.5 text-gray-300" />
        )}
      </button>
    );
  };

  return (
    <div className="w-full space-y-5">
      <ExpertSummaryCards
        counts={summaryCounts}
        quickFilter={quickFilter}
        onToggle={setQuickFilter}
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative w-full min-w-0 sm:w-56">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Search
          </label>
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-[2.15rem] z-10 h-4 w-4 text-gray-400" />
          <input
            type="text"
            className="input input-bordered w-full rounded-xl border-gray-200 bg-white !pl-9 text-sm"
            placeholder="search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-full min-w-0 sm:w-44">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Category
          </label>
          <select
            className={SELECT_CLASS}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">All</option>
            {filterOptions.categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
        <div className="w-full min-w-0 sm:w-44">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Stage
          </label>
          <select
            className={SELECT_CLASS}
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
          >
            <option value="">All</option>
            {filterOptions.stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
        </div>
        <div className="w-full min-w-0 sm:w-40">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            High value
          </label>
          <select
            className={SELECT_CLASS}
            value={highValueFilter}
            onChange={(e) => setHighValueFilter(e.target.value as ExpertHighValueFilter)}
          >
            <option value="">All</option>
            <option value="high">High value</option>
          </select>
        </div>
        <div className="w-full min-w-0 sm:w-40">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Date from
          </label>
          <input
            type="date"
            className="input input-bordered w-full rounded-xl border-gray-200 bg-white text-sm"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="w-full min-w-0 sm:w-40">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Date to
          </label>
          <input
            type="date"
            className="input input-bordered w-full rounded-xl border-gray-200 bg-white text-sm"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        {tableFiltersActive ? (
          <button
            type="button"
            className="inline-flex h-12 items-center gap-1 rounded-full px-3 text-xs font-medium text-gray-500 transition hover:bg-white hover:text-gray-800"
            onClick={() => {
              setCategoryFilter('');
              setStageFilter('');
              setHighValueFilter('');
              setDateFrom('');
              setDateTo('');
            }}
          >
            <XMarkIcon className="h-4 w-4" />
            Clear
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-white px-4 py-6 text-center text-sm text-red-600">
          {error}
        </div>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className={PIPELINE_TABLE_CLASS}>
            <thead className={PIPELINE_THEAD_CLASS}>
              <tr>
                <PipelineRowPickHeader visible={picking} />
                <th className="px-4 py-3 text-left font-semibold">Lead</th>
                <th className="px-4 py-3 text-left font-semibold">
                  <SortHeader column="assigned_since">Assigned since</SortHeader>
                </th>
                <th className="px-4 py-3 text-left font-semibold">Meeting</th>
                <th className="px-4 py-3 text-left font-semibold">Stage</th>
                <th className="px-4 py-3 text-left font-semibold">Category</th>
                <th className="px-4 py-3 text-left font-semibold">Date created</th>
                <th className="px-4 py-3 text-left font-semibold">
                  <SortHeader column="probability">Probability</SortHeader>
                </th>
                <th className="px-4 py-3 text-left font-semibold">Applicants</th>
                <th className="px-4 py-3 text-left font-semibold">Value</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={9 + (picking ? 1 : 0)} className="bg-white py-16 text-center">
                    <span className="loading loading-spinner loading-lg text-primary" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={9 + (picking ? 1 : 0)}
                    className="bg-white px-4 py-12 text-center text-sm text-gray-500"
                    style={PIPELINE_CELL_STYLE}
                  >
                    No expert leads match your filters.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const soft = getSoftStageBadgeStyle(getStageColour(row.stage), row.stage);
                  return (
                    <tr
                      key={row.id}
                      className={pipelineRowClassName(isPipelineLeadPicked(row.id, selectedLeadId, selectedLeadIds))}
                      onClick={(e) =>
                        handlePipelineRowPick(
                          e,
                          toPipelineActionLead({ ...row, isNewLead: !row.id.startsWith('legacy_') }),
                          navigate,
                          { multiSelect, onSelectLead },
                        )
                      }
                      onAuxClick={(e) => {
                        if (e.button === 1) openLeadFromRowClick(e, row.navId, navigate);
                      }}
                    >
                      <PipelineRowPickCell
                        visible={picking}
                        selected={isPipelineLeadPicked(row.id, selectedLeadId, selectedLeadIds)}
                        name={row.name}
                        onPick={(e) =>
                          onSelectLead?.(
                            toPipelineActionLead({ ...row, isNewLead: !row.id.startsWith('legacy_') }),
                            e,
                          )
                        }
                      />
                      <td className={PIPELINE_CELL_FIRST} style={PIPELINE_CELL_STYLE}>
                        <p className="font-mono text-xs font-bold text-gray-500">#{row.lead_number}</p>
                        <button
                          type="button"
                          className="text-left font-semibold text-gray-900 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            openLeadFromRowClick(e, row.navId, navigate);
                          }}
                        >
                          {row.name}
                        </button>
                      </td>
                      <td className={PIPELINE_CELL_MID} style={PIPELINE_CELL_STYLE}>
                        {daysSinceAssigned(row.created_at)}
                      </td>
                      <td className={`${PIPELINE_CELL_MID} text-gray-700`} style={PIPELINE_CELL_STYLE}>
                        {row.meeting_date
                          ? new Date(row.meeting_date).toLocaleDateString('en-GB')
                          : '—'}
                      </td>
                      <td className={PIPELINE_CELL_MID} style={PIPELINE_CELL_STYLE}>
                        {row.stage ? (
                          <span
                            className="inline-flex max-w-[11rem] truncate rounded-full px-2.5 py-1 text-xs font-semibold"
                            style={{ backgroundColor: soft.backgroundColor, color: soft.color }}
                          >
                            {getStageName(row.stage)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={`${PIPELINE_CELL_MID} max-w-[12rem] text-gray-700`} style={PIPELINE_CELL_STYLE}>
                        {row.category}
                      </td>
                      <td className={`${PIPELINE_CELL_MID} text-gray-700`} style={PIPELINE_CELL_STYLE}>
                        {row.created_at ? new Date(row.created_at).toLocaleDateString('en-GB') : '—'}
                      </td>
                      <td className={PIPELINE_CELL_MID} style={PIPELINE_CELL_STYLE}>
                        <span className={`font-bold ${pipelineProbabilityTone(row.probability)}`}>
                          {row.probability != null ? `${row.probability}%` : '—'}
                        </span>
                      </td>
                      <td className={`${PIPELINE_CELL_MID} text-gray-700`} style={PIPELINE_CELL_STYLE}>
                        {row.applicants ?? '—'}
                      </td>
                      <td className={`${PIPELINE_CELL_LAST} font-semibold text-gray-800`} style={PIPELINE_CELL_STYLE}>
                        {formatPipelineMoney(row.value, row.currency)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ExpertPipelineView;
