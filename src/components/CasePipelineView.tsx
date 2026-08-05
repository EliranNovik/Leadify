import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDaysIcon,
  ChatBubbleLeftRightIcon,
  ChevronDownIcon,
  ChevronUpDownIcon,
  EnvelopeIcon,
  MagnifyingGlassIcon,
  PhoneIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import {
  fetchStageNames,
  getSoftStageBadgeStyle,
  getStageColour,
  getStageName,
} from '../lib/stageUtils';
import {
  formatCategoryDisplayName,
  getCurrencySymbol as getCurrencySymbolFromMap,
} from '../lib/waitingForPriceOffer';
import {
  convertToNIS as convertToNisWithBoiRates,
  ensureBoiRatesReady,
  resolveCurrencyIsoCode,
} from '../lib/boiCurrencyConversion';
import {
  fetchLeadRecentInteractions,
  type LeadRecentInteractions,
  type RecentInteractionItem,
} from '../lib/leadActionCounts';
import {
  ACTIVE_MEETING_STATUS_FILTER,
  localTodayYmd,
} from '../lib/meetingRescheduleCancel';
import { getUSTimezoneFromPhone } from '../lib/timezoneHelpers';
import {
  createSnapshotStore,
  useRealtimeTables,
  useRevalidateOnVisible,
  useScrollRestoration,
  type RealtimeTableSubscription,
} from '../lib/pipelineLiveCache';
import PipelineSummaryCards from './PipelineSummaryCards';
import { openLeadFromRowClick } from '../lib/leadNavigation';
import {
  isPastMeetingDate,
  matchesQuickFilter,
  parseDateMs,
  startOfTodayMs,
  summarizePipelineRows,
  type PipelineQuickFilter,
} from '../lib/pipelineSummary';
import {
  chunkIds,
  fetchLatestTouchByRowId,
  fetchLatestTouchForLead,
  isAwaitingReply,
  touchToIso,
} from '../lib/leadLatestTouch';
import { fetchMeetingsByRowId, fetchNextMeetingForLead } from '../lib/pipelineLeadMetrics';

export type CasePipelineRoleTab = 'manager' | 'helper';
type RoleTab = CasePipelineRoleTab;
type SortColumn = 'created_at' | 'value' | 'follow_up' | 'last_interaction' | 'probability' | 'next_meeting';
type SortDirection = 'asc' | 'desc';
type QuickFilter = PipelineQuickFilter;

/** Pipeline starts at "Meeting scheduled" and stops at "Another meeting". */
const MIN_PIPELINE_STAGE_ID = 20;
const MAX_PIPELINE_STAGE_ID = 55;

/** Same sign mapping as the Total Value badge in Clients.tsx / ClientHeader. */
function toCurrencySign(currencyCode?: string | null): string {
  if (!currencyCode) return '₪';
  const strCode = String(currencyCode).trim();
  if (!strCode) return '₪';

  const symbols = [
    '₪',
    '$',
    '€',
    '£',
    'C$',
    'A$',
    '¥',
    'CHF',
    'SEK',
    'NOK',
    'DKK',
    'PLN',
    'CZK',
    'HUF',
    'RON',
    'BGN',
    'HRK',
    'RUB',
    'UAH',
    'TRY',
  ];
  if (symbols.includes(strCode)) return strCode;

  switch (strCode.toUpperCase()) {
    case 'USD':
    case 'US$':
      return '$';
    case 'EUR':
      return '€';
    case 'GBP':
      return '£';
    case 'ILS':
    case 'NIS':
      return '₪';
    case 'CAD':
      return 'C$';
    case 'AUD':
      return 'A$';
    case 'JPY':
      return '¥';
    case 'CHF':
      return 'CHF';
    default:
      if (strCode.length <= 3 && !/^[A-Z]{3}$/.test(strCode)) return strCode;
      return strCode;
  }
}

function formatValueWithSign(amount: number | null, currencyRaw?: string | null): string {
  if (amount == null || Number.isNaN(amount)) return '—';
  const sign = toCurrencySign(currencyRaw);
  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${sign}${formatted}`;
}

type CasePipelineRow = {
  id: string;
  lead_number: string;
  client_name: string;
  created_at: string | null;
  stage: string;
  stage_id: string;
  category: string;
  category_id: string | number | null;
  main_category: string;
  main_category_id: string | null;
  closer_name: string | null;
  closer_photo: string | null;
  value: number | null;
  value_display: string;
  value_nis: number;
  probability: number | null;
  last_interaction: string | null;
  /** Client's latest touch was inbound and we have not replied on any channel. */
  awaiting_reply: boolean;
  tags: string[];
  follow_up: string | null;
  /** Earliest upcoming non-canceled meeting; if none, the most recent past one. */
  next_meeting: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  /** Display name of the lead's country (new leads from `leads.country_id`, legacy from main contact). */
  country: string | null;
  country_id: number | null;
  /** IANA timezone used for the business-hours indicator next to the country name. */
  country_timezone: string | null;
  contact_names: string[];
  contact_phones: string[];
  contact_emails: string[];
  is_manager: boolean;
  is_helper: boolean;
  is_inactive: boolean;
  lead_type: 'new' | 'legacy';
  nav_id: string;
};

/** Inline so shared `.table` / theme rules can't tint the row cards. */
const ROW_CELL_STYLE: React.CSSProperties = { backgroundColor: '#ffffff' };

const STATUS_FILTER_OPTIONS: MultiSelectOption[] = [
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
];

const NEW_LEAD_SELECT = `
  id,
  lead_number,
  name,
  created_at,
  stage,
  category,
  category_id,
  manager,
  helper,
  closer,
  unactivated_at,
  probability,
  latest_interaction,
  balance,
  balance_currency,
  proposal_total,
  currency_id,
  phone,
  mobile,
  email,
  country_id,
  accounting_currencies!leads_currency_id_fkey (
    id,
    name,
    iso_code
  ),
  misc_country!country_id (
    id,
    name,
    timezone
  ),
  misc_category!fk_leads_category_id (
    id,
    name,
    parent_id,
    misc_maincategory!parent_id (
      id,
      name
    )
  )
`;

const LEGACY_LEAD_SELECT = `
  id,
  name,
  cdate,
  stage,
  category,
  category_id,
  meeting_manager_id,
  meeting_lawyer_id,
  closer_id,
  probability,
  latest_interaction,
  total,
  total_base,
  currency_id,
  phone,
  email,
  status,
  accounting_currencies!leads_lead_currency_id_fkey (
    id,
    name,
    iso_code
  ),
  misc_category!leads_lead_category_id_fkey (
    id,
    name,
    parent_id,
    misc_maincategory!parent_id (
      id,
      name
    )
  )
`;

/** Everything needed to map a single lead row, so realtime updates never require a full reload. */
type EmployeeProfile = { name: string; photo: string | null };

type PipelineContext = {
  userDbId: string | null;
  userEmployeeId: number | string | null;
  userDisplayName: string | null;
  employeeNames: Array<[string, string]>;
  employeeProfiles: Array<[string, EmployeeProfile]>;
  currencies: Array<[number, string]>;
  categories: any[];
  /** misc_leadtag id → name, so tags never depend on an embedded join. */
  tagNames: Array<[string, string]>;
};

function resolveCloser(
  ctx: PipelineContext,
  raw: any,
): { name: string | null; photo: string | null } {
  if (raw == null || raw === '' || raw === '---' || raw === '--') {
    return { name: null, photo: null };
  }
  const value = String(raw).trim();
  if (!value) return { name: null, photo: null };
  const profiles = new Map(ctx.employeeProfiles);
  if (/^\d+$/.test(value)) {
    const byId = profiles.get(value);
    if (byId) return { name: byId.name || value, photo: byId.photo };
    const name = new Map(ctx.employeeNames).get(value) || null;
    return { name, photo: null };
  }
  const byName = profiles.get(value.toLowerCase());
  if (byName) return { name: byName.name || value, photo: byName.photo };
  return { name: value, photo: null };
}


/** The logged-in user's personal follow-up date per row id (new + legacy in parallel). */
async function fetchFollowUpsMap(
  userDbId: string | null,
  newIds: string[],
  legacyIds: string[],
): Promise<Map<string, string>> {
  const followUpsMap = new Map<string, string>();
  if (!userDbId || (newIds.length === 0 && legacyIds.length === 0)) return followUpsMap;

  const [newFollowups, legacyFollowups] = await Promise.all([
    newIds.length > 0
      ? supabase
          .from('follow_ups')
          .select('new_lead_id, date')
          .eq('user_id', userDbId)
          .in('new_lead_id', newIds)
          .is('lead_id', null)
      : Promise.resolve({ data: [], error: null } as any),
    legacyIds.length > 0
      ? supabase
          .from('follow_ups')
          .select('lead_id, date')
          .eq('user_id', userDbId)
          .in('lead_id', legacyIds)
          .is('new_lead_id', null)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  (newFollowups.data || []).forEach((fu: any) => {
    if (!fu.new_lead_id || !fu.date) return;
    const key = toDateKey(fu.date);
    if (key) followUpsMap.set(String(fu.new_lead_id), key);
  });
  (legacyFollowups.data || []).forEach((fu: any) => {
    if (!fu.lead_id || !fu.date) return;
    const key = toDateKey(fu.date);
    if (key) followUpsMap.set(`legacy_${fu.lead_id}`, key);
  });
  return followUpsMap;
}


function matchesPipelineUser(ctx: PipelineContext, value: any): boolean {
  if (value == null || value === '' || value === '---' || value === '--') return false;
  const raw = String(value).trim();
  if (!raw) return false;
  if (ctx.userEmployeeId != null && String(ctx.userEmployeeId) === raw) return true;
  const displayName = ctx.userDisplayName?.trim().toLowerCase() || '';
  if (displayName && raw.toLowerCase() === displayName) return true;
  if (displayName && /^\d+$/.test(raw)) {
    const mapped = new Map(ctx.employeeNames).get(raw);
    if (mapped && mapped.trim().toLowerCase() === displayName) return true;
  }
  return false;
}

function resolveCategory(
  ctx: PipelineContext,
  lead: any,
): { label: string; mainName: string; mainId: string | null } {
  const categoryJoin = Array.isArray(lead.misc_category) ? lead.misc_category[0] : lead.misc_category;
  const main = categoryJoin?.misc_maincategory;
  const fallback = formatCategoryDisplayName(ctx.categories, lead.category_id, lead.category);
  return {
    label: (main?.name ? `${categoryJoin.name} (${main.name})` : categoryJoin?.name) || fallback,
    mainName: main?.name || '',
    mainId: main?.id != null ? String(main.id) : null,
  };
}

function countryFromJoin(lead: any): {
  name: string | null;
  id: number | null;
  timezone: string | null;
} {
  const join = Array.isArray(lead?.misc_country) ? lead.misc_country[0] : lead?.misc_country;
  const idRaw = join?.id ?? lead?.country_id;
  const id = idRaw == null || idRaw === '' ? null : Number(idRaw);
  return {
    name: join?.name ? String(join.name) : null,
    id: id != null && !Number.isNaN(id) ? id : null,
    timezone: join?.timezone ? String(join.timezone) : null,
  };
}

/** Same rules as PipelinePage: US uses area-code timezone, otherwise the country's timezone. */
function resolveCountryTimezone(
  countryId: number | null,
  timezone: string | null,
  phone?: string | null,
  mobile?: string | null,
): string | null {
  if (countryId === 249) {
    return getUSTimezoneFromPhone(phone, mobile) || timezone || 'America/New_York';
  }
  return timezone || null;
}

function businessHoursInfo(timezone: string | null): {
  isBusinessHours: boolean;
  localTime: string | null;
} {
  if (!timezone) return { isBusinessHours: false, localTime: null };
  try {
    const now = new Date();
    const localTime = now.toLocaleString('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const hour = parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false,
      })
        .formatToParts(now)
        .find((part) => part.type === 'hour')?.value || '0',
      10,
    );
    return { isBusinessHours: hour >= 8 && hour < 20, localTime };
  } catch {
    return { isBusinessHours: false, localTime: null };
  }
}

/** Stage ids are numeric strings; only "Meeting scheduled" (20) through "Another meeting" (55). */
function isPipelineStage(stageId: string): boolean {
  if (!/^\d+$/.test(stageId)) return false;
  const n = Number(stageId);
  return n >= MIN_PIPELINE_STAGE_ID && n <= MAX_PIPELINE_STAGE_ID;
}

function toNisValue(amount: number | null, currency: any): number {
  if (amount == null || Number.isNaN(amount) || amount <= 0) return 0;
  try {
    // Resolve to an ISO code first: the static fallback rates only know codes, not symbols.
    return convertToNisWithBoiRates(amount, resolveCurrencyIsoCode(currency));
  } catch {
    return 0;
  }
}

function mapNewLead(lead: any, ctx: PipelineContext): CasePipelineRow | null {
  const isManager = matchesPipelineUser(ctx, lead.manager);
  const isHelper = matchesPipelineUser(ctx, lead.helper);
  if (!isManager && !isHelper) return null;

  const currencyJoin = Array.isArray(lead.accounting_currencies)
    ? lead.accounting_currencies[0]
    : lead.accounting_currencies;
  // Same resolution order as ClientHeader Total Value badge: join name, then map by id.
  const currencyRaw =
    currencyJoin?.name ||
    lead.balance_currency ||
    getCurrencySymbolFromMap(new Map(ctx.currencies), lead.currency_id) ||
    currencyJoin?.iso_code ||
    '₪';
  const valueRaw = lead.balance ?? lead.proposal_total ?? null;
  const valueNum = valueRaw == null || valueRaw === '' ? null : Number(valueRaw);
  const value = valueNum != null && !Number.isNaN(valueNum) ? valueNum : null;
  const stageId = lead.stage != null ? String(lead.stage) : '';
  if (!isPipelineStage(stageId)) return null;
  const category = resolveCategory(ctx, lead);
  const probability = lead.probability == null || lead.probability === '' ? null : Number(lead.probability);
  const closer = resolveCloser(ctx, lead.closer);
  const country = countryFromJoin(lead);
  const phone = lead.phone || null;
  const mobile = lead.mobile || null;

  return {
    id: String(lead.id),
    lead_number: lead.lead_number || String(lead.id),
    client_name: lead.name || '',
    created_at: lead.created_at || null,
    stage: stageId ? getStageName(stageId) || stageId : '—',
    stage_id: stageId,
    category: category.label,
    category_id: lead.category_id ?? null,
    main_category: category.mainName,
    main_category_id: category.mainId,
    closer_name: closer.name,
    closer_photo: closer.photo,
    value,
    value_display: formatValueWithSign(value, currencyRaw),
    value_nis: toNisValue(value, lead.currency_id ?? currencyRaw),
    probability: probability != null && !Number.isNaN(probability) ? probability : null,
    last_interaction: lead.latest_interaction || null,
    awaiting_reply: false,
    tags: [],
    follow_up: null,
    next_meeting: null,
    phone,
    mobile,
    email: lead.email || null,
    country: country.name,
    country_id: country.id,
    country_timezone: resolveCountryTimezone(country.id, country.timezone, phone, mobile),
    contact_names: [],
    contact_phones: [],
    contact_emails: [],
    is_manager: isManager,
    is_helper: isHelper,
    is_inactive: lead.unactivated_at != null,
    lead_type: 'new',
    nav_id: lead.lead_number || String(lead.id),
  };
}

function mapLegacyLead(lead: any, ctx: PipelineContext): CasePipelineRow | null {
  const isManager = matchesPipelineUser(ctx, lead.meeting_manager_id);
  const isHelper = matchesPipelineUser(ctx, lead.meeting_lawyer_id);
  if (!isManager && !isHelper) return null;

  const currencyJoin = Array.isArray(lead.accounting_currencies)
    ? lead.accounting_currencies[0]
    : lead.accounting_currencies;
  const currencyId = Number(lead.currency_id) || 1;
  const currencyRaw =
    currencyJoin?.name ||
    getCurrencySymbolFromMap(new Map(ctx.currencies), currencyId) ||
    currencyJoin?.iso_code ||
    '₪';
  const valueRaw = currencyId === 1 ? lead.total_base ?? lead.total : lead.total;
  const valueNum = valueRaw == null || valueRaw === '' ? null : Number(valueRaw);
  const value = valueNum != null && !Number.isNaN(valueNum) ? valueNum : null;
  const stageId = lead.stage != null ? String(lead.stage) : '';
  if (!isPipelineStage(stageId)) return null;
  const category = resolveCategory(ctx, lead);
  const probability = lead.probability == null || lead.probability === '' ? null : Number(lead.probability);
  const closer = resolveCloser(ctx, lead.closer_id);

  return {
    id: `legacy_${lead.id}`,
    lead_number: String(lead.id),
    client_name: lead.name || '',
    created_at: lead.cdate || null,
    stage: stageId ? getStageName(stageId) || stageId : '—',
    stage_id: stageId,
    category: category.label,
    category_id: lead.category_id ?? null,
    main_category: category.mainName,
    main_category_id: category.mainId,
    closer_name: closer.name,
    closer_photo: closer.photo,
    value,
    value_display: formatValueWithSign(value, currencyRaw),
    value_nis: toNisValue(value, currencyId),
    probability: probability != null && !Number.isNaN(probability) ? probability : null,
    last_interaction: lead.latest_interaction || null,
    awaiting_reply: false,
    tags: [],
    follow_up: null,
    next_meeting: null,
    phone: lead.phone || null,
    mobile: null,
    email: lead.email || null,
    // Legacy leads store country on the main contact — filled in after the contact query.
    country: null,
    country_id: null,
    country_timezone: null,
    contact_names: [],
    contact_phones: [],
    contact_emails: [],
    is_manager: isManager,
    is_helper: isHelper,
    is_inactive: Number(lead.status) === 10,
    lead_type: 'legacy',
    nav_id: String(lead.id),
  };
}

type PipelineSnapshot = {
  rows: CasePipelineRow[];
  categoryOptions: MultiSelectOption[];
  tagOptions: MultiSelectOption[];
  stageOptions: MultiSelectOption[];
  context: PipelineContext | null;
  userDbId: string | null;
};

/** Bump when the row shape changes so an old in-memory snapshot is discarded. */
const PIPELINE_CACHE_VERSION = 7;
const PIPELINE_STALE_MS = 5 * 60 * 1000;

/**
 * Kept at module scope so returning to the page paints from memory instead of refetching.
 * Realtime patches keep it current; a silent revalidate only runs once it goes stale.
 */
const snapshotStore = createSnapshotStore<PipelineSnapshot>(PIPELINE_CACHE_VERSION);

type PipelineFilterState = {
  roleTab: RoleTab;
  search: string;
  categoryFilter: string[];
  tagFilter: string[];
  stageFilter: string[];
  statusFilter: string[];
  dateFrom: string;
  dateTo: string;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  quickFilter: QuickFilter;
};

const DEFAULT_FILTERS: PipelineFilterState = {
  roleTab: 'manager',
  search: '',
  categoryFilter: [],
  tagFilter: [],
  stageFilter: [],
  statusFilter: ['active'],
  dateFrom: '',
  dateTo: '',
  sortColumn: 'created_at',
  sortDirection: 'desc',
  quickFilter: null,
};

/** Filters live at module scope too, so leaving and returning keeps the current view. */
let pipelineFilters: PipelineFilterState = { ...DEFAULT_FILTERS };

type MultiSelectOption = { id: string; label: string };

function formatDisplayDate(value: string | null | undefined): string {
  const ms = parseDateMs(value);
  if (ms == null) return '—';
  return new Date(ms).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function toDateKey(value: string | null | undefined): string | null {
  const ms = parseDateMs(value);
  if (ms == null) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function toDateInputValue(value: string | null | undefined): string {
  return toDateKey(value) || '';
}

function normalizeSearch(value: string | null | undefined): string {
  return (value || '').toLowerCase().replace(/[\s\-()+/]/g, '');
}

function formatRelativeDays(value: string | null | undefined): string {
  const ms = parseDateMs(value);
  if (ms == null) return '';
  const days = Math.floor((startOfTodayMs() - new Date(ms).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(days / 365)}y ago`;
}

/**
 * Tag names per row id. `leads_lead_tags` has more than one FK to `misc_leadtag`, which makes an
 * embedded select ambiguous (PGRST201) and silently tagless — so resolve ids against the tag map.
 */
async function fetchTagsByRowId(
  newIds: string[],
  legacyIds: string[],
  tagNameById: Map<string, string>,
): Promise<Map<string, string[]>> {
  const tagsByRowId = new Map<string, string[]>();

  const addTag = (rowId: string, tagId: any) => {
    const name = tagNameById.get(String(tagId));
    if (!name) return;
    const list = tagsByRowId.get(rowId);
    if (list) {
      if (!list.includes(name)) list.push(name);
    } else {
      tagsByRowId.set(rowId, [name]);
    }
  };

  for (const chunk of chunkIds(newIds, 200)) {
    if (chunk.length === 0) continue;
    const { data, error } = await supabase
      .from('leads_lead_tags')
      .select('newlead_id, leadtag_id')
      .in('newlead_id', chunk)
      .limit(20000);
    if (error) {
      console.warn('Case pipeline: tags for new leads failed', error);
      continue;
    }
    (data || []).forEach((row: any) => {
      if (row.newlead_id) addTag(String(row.newlead_id), row.leadtag_id);
    });
  }

  for (const chunk of chunkIds(legacyIds, 200)) {
    if (chunk.length === 0) continue;
    const { data, error } = await supabase
      .from('leads_lead_tags')
      .select('lead_id, leadtag_id')
      .in('lead_id', chunk)
      .limit(20000);
    if (error) {
      console.warn('Case pipeline: tags for legacy leads failed', error);
      continue;
    }
    (data || []).forEach((row: any) => {
      if (row.lead_id != null) addTag(`legacy_${row.lead_id}`, row.leadtag_id);
    });
  }

  return tagsByRowId;
}

/** Same thresholds as the Probability column in PipelinePage. */
function probabilityTone(probability: number | null): string {
  const value = probability ?? 0;
  if (probability == null) return 'text-gray-400';
  if (value >= 80) return 'text-green-600';
  if (value >= 60) return 'text-yellow-600';
  if (value >= 40) return 'text-orange-600';
  return 'text-red-600';
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

function CloserCell({ name, photoUrl }: { name: string | null; photoUrl: string | null }) {
  const [imgErr, setImgErr] = useState(false);
  const display = (name || '').trim();
  if (!display) return <span className="text-sm text-gray-400">—</span>;

  const url = (photoUrl || '').trim();
  const showPhoto = url.length > 0 && !imgErr;

  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      {showPhoto ? (
        <img
          src={url}
          alt=""
          className="h-11 w-11 shrink-0 rounded-full object-cover"
          onError={() => setImgErr(true)}
        />
      ) : (
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-200 text-sm font-semibold text-gray-700"
          aria-hidden
        >
          {initialsFromName(display)}
        </span>
      )}
      <span className="min-w-0 truncate text-sm text-gray-800" title={display}>
        {display}
      </span>
    </span>
  );
}

function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  placeholder = 'All',
}: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  };

  const summary =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? options.find((o) => o.id === selected[0])?.label || `${selected.length} selected`
        : `${selected.length} selected`;

  return (
    <div className="relative w-full min-w-0" ref={rootRef}>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </label>
      {/* The field itself is the search input; typing filters the attached list. */}
      <div className="relative">
        <input
          type="text"
          className={`input input-bordered w-full rounded-xl border-gray-200 bg-white pr-9 text-sm ${
            selected.length
              ? 'placeholder:font-medium placeholder:text-gray-900'
              : 'placeholder:text-gray-400'
          }`}
          placeholder={summary}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
        />
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-400 transition hover:text-gray-700"
          aria-label={open ? `Close ${label} options` : `Open ${label} options`}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDownIcon className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} />
        </button>

        {/* Anchored to the field wrapper so the list sits flush against the input. */}
        {open ? (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
            <div className="max-h-56 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <p className="px-3 py-2 text-sm text-gray-400">No matches</p>
              ) : (
                filtered.map((opt) => {
                  const checked = selected.includes(opt.id);
                  return (
                    <label
                      key={opt.id}
                      className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm checkbox-primary"
                        checked={checked}
                        onChange={() => toggle(opt.id)}
                      />
                      <span className="min-w-0 truncate text-gray-800">{opt.label}</span>
                    </label>
                  );
                })
              )}
            </div>
            {selected.length > 0 ? (
              <div className="border-t border-gray-100 p-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs w-full rounded-lg text-gray-500"
                  onClick={() => onChange([])}
                >
                  Clear
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export type CasePipelineViewProps = {
  /**
   * Controlled role tab. When omitted the view keeps its own tab state and renders its own
   * switcher; a host page that shows the tabs itself passes this together with `showHeader`.
   */
  roleTab?: CasePipelineRoleTab;
  /** Header holds the page title and the Manager/Helper switcher. */
  showHeader?: boolean;
  /** Grey page background and padding; off when embedded in a page that supplies its own. */
  withPageChrome?: boolean;
  /** Lets a host page label its own tabs with the per-role row counts. */
  onCountsChange?: (counts: { manager: number; helper: number }) => void;
};

const CasePipelineView: React.FC<CasePipelineViewProps> = ({
  roleTab: controlledRoleTab,
  showHeader = true,
  withPageChrome = true,
  onCountsChange,
}) => {
  const navigate = useNavigate();
  const initialSnapshot = snapshotStore.get();
  const [uncontrolledRoleTab, setUncontrolledRoleTab] = useState<RoleTab>(
    () => pipelineFilters.roleTab,
  );
  const roleTab = controlledRoleTab ?? uncontrolledRoleTab;
  const setRoleTab = setUncontrolledRoleTab;
  const [loading, setLoading] = useState(() => initialSnapshot == null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRowsState] = useState<CasePipelineRow[]>(() => initialSnapshot?.rows || []);
  const [search, setSearch] = useState(() => pipelineFilters.search);
  const [categoryFilter, setCategoryFilter] = useState<string[]>(() => pipelineFilters.categoryFilter);
  const [tagFilter, setTagFilter] = useState<string[]>(() => pipelineFilters.tagFilter);
  const [stageFilter, setStageFilter] = useState<string[]>(() => pipelineFilters.stageFilter);
  const [statusFilter, setStatusFilter] = useState<string[]>(() => pipelineFilters.statusFilter);
  const [dateFrom, setDateFrom] = useState(() => pipelineFilters.dateFrom);
  const [dateTo, setDateTo] = useState(() => pipelineFilters.dateTo);
  const [sortColumn, setSortColumn] = useState<SortColumn>(() => pipelineFilters.sortColumn);
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    () => pipelineFilters.sortDirection,
  );
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(() => pipelineFilters.quickFilter);
  const [interactionsFor, setInteractionsFor] = useState<CasePipelineRow | null>(null);
  const [interactions, setInteractions] = useState<LeadRecentInteractions | null>(null);
  const [interactionsLoading, setInteractionsLoading] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState<MultiSelectOption[]>(
    () => initialSnapshot?.categoryOptions || [],
  );
  const [tagOptions, setTagOptions] = useState<MultiSelectOption[]>(
    () => initialSnapshot?.tagOptions || [],
  );
  const [stageOptions, setStageOptions] = useState<MultiSelectOption[]>(
    () => initialSnapshot?.stageOptions || [],
  );
  const [currentUserDbId, setCurrentUserDbId] = useState<string | null>(
    () => initialSnapshot?.userDbId || null,
  );
  const [editingFollowUp, setEditingFollowUp] = useState<CasePipelineRow | null>(null);
  const [followUpDraft, setFollowUpDraft] = useState('');
  const [savingFollowUp, setSavingFollowUp] = useState(false);

  const contextRef = useRef<PipelineContext | null>(initialSnapshot?.context || null);
  const rowIdsRef = useRef<Set<string>>(new Set((initialSnapshot?.rows || []).map((r) => r.id)));

  /** Single writer for rows so the module snapshot never drifts from what is rendered. */
  const setRows = useCallback(
    (updater: CasePipelineRow[] | ((prev: CasePipelineRow[]) => CasePipelineRow[])) => {
      setRowsState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        snapshotStore.update((snapshot) => ({ ...snapshot, rows: next }));
        rowIdsRef.current = new Set(next.map((r) => r.id));
        return next;
      });
    },
    [],
  );

  const loadData = useCallback(async (options: { silent?: boolean } = {}) => {
    const { silent = false } = options;
    if (!silent) setLoading(true);
    setError(null);
    // Interaction data is resolved in a second pass, so a reload would otherwise flash the
    // stale `latest_interaction` column values until that pass lands.
    const previousRowsById = new Map((snapshotStore.get()?.rows || []).map((r) => [r.id, r]));
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError('Please sign in to view your case pipeline.');
        setRows([]);
        return;
      }

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select(
          `
          id,
          employee_id,
          tenants_employee!employee_id(
            id,
            display_name
          )
        `,
        )
        .eq('auth_id', user.id)
        .maybeSingle();

      if (userError) throw userError;

      const userDbId = userData?.id ? String(userData.id) : null;
      setCurrentUserDbId(userDbId);
      const userEmployeeId = userData?.employee_id ?? null;
      const empJoin = userData?.tenants_employee as any;
      const userDisplayName = Array.isArray(empJoin)
        ? empJoin[0]?.display_name || null
        : empJoin?.display_name || null;

      if (!userEmployeeId && !userDisplayName) {
        setError('No employee profile is linked to your account.');
        setRows([]);
        return;
      }

      const [
        categoriesResult,
        employeesResult,
        currenciesResult,
        accountingCurrenciesResult,
        stagesMap,
        tagsResult,
      ] = await Promise.all([
          supabase
            .from('misc_category')
            .select(
              `
              id,
              name,
              parent_id,
              misc_maincategory!parent_id(
                id,
                name
              )
            `,
            )
            .order('name', { ascending: true }),
          supabase.from('tenants_employee').select('id, display_name, photo_url'),
          supabase.from('currencies').select('id, name, iso_code, front_name'),
          supabase.from('accounting_currencies').select('id, name, iso_code'),
          fetchStageNames(),
          // All tags (not only active) so ids on existing leads always resolve to a name.
          supabase.from('misc_leadtag').select('id, name, active').order('name', { ascending: true }),
          ensureBoiRatesReady().catch(() => null),
        ]);

      const allCategories = categoriesResult.data || [];
      // Categories are filtered by main category only, so collapse the sub-categories.
      const mainCategories = new Map<string, string>();
      allCategories.forEach((cat: any) => {
        const main = cat.misc_maincategory;
        if (main?.id == null || !main?.name) return;
        mainCategories.set(String(main.id), String(main.name));
      });
      const categoryOpts: MultiSelectOption[] = Array.from(mainCategories.entries())
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
      if (tagsResult.error) console.warn('Case pipeline: tag list failed', tagsResult.error);
      const tagNameById = new Map<string, string>();
      (tagsResult.data || []).forEach((t: any) => {
        const name = String(t.name ?? '').trim();
        if (t.id != null && name) tagNameById.set(String(t.id), name);
      });
      const tagOpts: MultiSelectOption[] = (tagsResult.data || [])
        .filter((t: any) => t.active !== false && String(t.name ?? '').trim())
        .map((t: any) => ({
          id: String(t.name).trim(),
          label: String(t.name).trim(),
        }));
      const stageOpts: MultiSelectOption[] = Object.entries(stagesMap)
        .filter(([id]) => isPipelineStage(String(id)))
        .map(([id, name]) => ({ id: String(id), label: String(name) }))
        .sort((a, b) => Number(a.id) - Number(b.id));

      setCategoryOptions(categoryOpts);
      setTagOptions(tagOpts);
      setStageOptions(stageOpts);

      const employeeNameMap = new Map<string, string>();
      const employeeProfiles = new Map<string, EmployeeProfile>();
      (employeesResult.data || []).forEach((emp: any) => {
        const id = String(emp.id);
        const name = emp.display_name || '';
        const photo = (emp.photo_url || '').trim() || null;
        employeeNameMap.set(id, name);
        employeeProfiles.set(id, { name, photo });
        if (name.trim()) {
          employeeProfiles.set(name.trim().toLowerCase(), { name, photo });
        }
      });

      const currencyMap = new Map<number, string>();
      const currencySource =
        currenciesResult.data && currenciesResult.data.length > 0
          ? currenciesResult.data
          : accountingCurrenciesResult.data || [];
      currencySource.forEach((curr: any) => {
        // Prefer accounting_currencies.name (often already a sign: ₪ / € / $), same as Clients badge.
        const symbol = curr.name || curr.front_name || curr.iso_code || '₪';
        const id = typeof curr.id === 'string' ? parseInt(curr.id, 10) || curr.id : curr.id;
        currencyMap.set(Number(id), symbol);
      });
      if (currencyMap.size === 0) {
        currencyMap.set(1, '₪');
        currencyMap.set(2, '€');
        currencyMap.set(3, '$');
        currencyMap.set(4, '£');
      }

      const ctx: PipelineContext = {
        userDbId,
        userEmployeeId,
        userDisplayName,
        employeeNames: Array.from(employeeNameMap.entries()),
        employeeProfiles: Array.from(employeeProfiles.entries()),
        currencies: Array.from(currencyMap.entries()),
        categories: allCategories,
        tagNames: Array.from(tagNameById.entries()),
      };
      contextRef.current = ctx;

      const escapeOrValue = (value: string) =>
        String(value).replace(/[,()"]/g, '').replace(/%/g, '');

      const newRoleClauses: string[] = [];
      const legacyRoleClauses: string[] = [];
      if (userEmployeeId != null) {
        newRoleClauses.push(`manager.eq.${userEmployeeId}`);
        newRoleClauses.push(`helper.eq.${userEmployeeId}`);
        legacyRoleClauses.push(`meeting_manager_id.eq.${userEmployeeId}`);
        legacyRoleClauses.push(`meeting_lawyer_id.eq.${userEmployeeId}`);
      }
      if (userDisplayName) {
        const safeName = escapeOrValue(userDisplayName.trim());
        if (safeName) {
          // Quoted so display names containing spaces survive the PostgREST or() parser.
          newRoleClauses.push(`manager.eq."${safeName}"`);
          newRoleClauses.push(`helper.eq."${safeName}"`);
        }
      }

      let newLeadsQuery = supabase
        .from('leads')
        .select(NEW_LEAD_SELECT)
        .gte('stage', MIN_PIPELINE_STAGE_ID)
        .lte('stage', MAX_PIPELINE_STAGE_ID)
        .order('created_at', { ascending: false })
        .limit(3000);

      if (newRoleClauses.length > 0) {
        newLeadsQuery = newLeadsQuery.or(newRoleClauses.join(','));
      }

      let legacyLeadsQuery = supabase
        .from('leads_lead')
        .select(LEGACY_LEAD_SELECT)
        .gte('stage', MIN_PIPELINE_STAGE_ID)
        .lte('stage', MAX_PIPELINE_STAGE_ID)
        .order('cdate', { ascending: false })
        .limit(3000);

      if (legacyRoleClauses.length > 0) {
        legacyLeadsQuery = legacyLeadsQuery.or(legacyRoleClauses.join(','));
      } else if (!userEmployeeId) {
        // Legacy roles are ID-only; without an employee id there are no legacy matches.
        legacyLeadsQuery = legacyLeadsQuery.eq('id', -1);
      }

      const [{ data: newLeadsData, error: newLeadsError }, { data: legacyLeadsData, error: legacyLeadsError }] =
        await Promise.all([newLeadsQuery, legacyLeadsQuery]);

      if (newLeadsError) throw newLeadsError;
      if (legacyLeadsError) throw legacyLeadsError;

      const mapped: CasePipelineRow[] = [];

      (newLeadsData || []).forEach((lead: any) => {
        const row = mapNewLead(lead, ctx);
        if (row) mapped.push(row);
      });

      (legacyLeadsData || []).forEach((lead: any) => {
        const row = mapLegacyLead(lead, ctx);
        if (row) mapped.push(row);
      });

      const newIds = mapped.filter((r) => r.lead_type === 'new').map((r) => r.id);
      const legacyIds = mapped
        .filter((r) => r.lead_type === 'legacy')
        .map((r) => r.id.replace(/^legacy_/, ''));

      // All row enrichment only depends on the lead id lists, so fan the queries out at once
      // instead of awaiting each in series — this is the bulk of the previous load time.
      const [tagsByRowId, meetingsByRowId, followUpsMap, newContactsResult, legacyContactsResult] =
        await Promise.all([
          fetchTagsByRowId(newIds, legacyIds, tagNameById),
          fetchMeetingsByRowId(newIds, legacyIds),
          fetchFollowUpsMap(userDbId, newIds, legacyIds),
          newIds.length > 0
            ? supabase
                .from('contacts')
                .select('lead_id, name, phone, mobile, email')
                .in('lead_id', newIds)
            : Promise.resolve({ data: [], error: null } as any),
          legacyIds.length > 0
            ? supabase
                .from('lead_leadcontact')
                .select(
                  `
                  lead_id,
                  main,
                  leads_contact (
                    name,
                    phone,
                    mobile,
                    email,
                    country_id,
                    misc_country (
                      id,
                      name,
                      timezone
                    )
                  )
                `,
                )
                .in('lead_id', legacyIds)
            : Promise.resolve({ data: [], error: null } as any),
        ]);

      mapped.forEach((row) => {
        row.tags = tagsByRowId.get(row.id) || [];
        row.next_meeting = meetingsByRowId.get(row.id) || null;
        // Only the logged-in user's personal follow-up from follow_ups — never lead.next_followup.
        row.follow_up = followUpsMap.get(row.id) || null;
      });

      const newContactsByLead = new Map<string, { names: string[]; phones: string[]; emails: string[] }>();
      (newContactsResult.data || []).forEach((c: any) => {
        const key = String(c.lead_id);
        const bucket = newContactsByLead.get(key) || { names: [], phones: [], emails: [] };
        if (c.name) bucket.names.push(String(c.name));
        if (c.phone) bucket.phones.push(String(c.phone));
        if (c.mobile) bucket.phones.push(String(c.mobile));
        if (c.email) bucket.emails.push(String(c.email));
        newContactsByLead.set(key, bucket);
      });

      const legacyContactsByLead = new Map<string, { names: string[]; phones: string[]; emails: string[] }>();
      const legacyCountryByLead = new Map<
        string,
        { name: string | null; id: number | null; timezone: string | null; phone: string | null; mobile: string | null }
      >();
      (legacyContactsResult.data || []).forEach((row: any) => {
        const contact = Array.isArray(row.leads_contact) ? row.leads_contact[0] : row.leads_contact;
        if (!contact) return;
        const key = `legacy_${row.lead_id}`;
        const bucket = legacyContactsByLead.get(key) || { names: [], phones: [], emails: [] };
        if (contact.name) bucket.names.push(String(contact.name));
        if (contact.phone) bucket.phones.push(String(contact.phone));
        if (contact.mobile) bucket.phones.push(String(contact.mobile));
        if (contact.email) bucket.emails.push(String(contact.email));
        legacyContactsByLead.set(key, bucket);

        // Prefer the main contact's country, same as PipelinePage.
        const isMain = row.main === true || row.main === 'true' || row.main === 1 || row.main === '1';
        if (!isMain && legacyCountryByLead.has(key)) return;
        const mc = Array.isArray(contact.misc_country) ? contact.misc_country[0] : contact.misc_country;
        const idRaw = mc?.id ?? contact.country_id;
        const id = idRaw == null || idRaw === '' ? null : Number(idRaw);
        legacyCountryByLead.set(key, {
          name: mc?.name ? String(mc.name) : null,
          id: id != null && !Number.isNaN(id) ? id : null,
          timezone: mc?.timezone ? String(mc.timezone) : null,
          phone: contact.phone || null,
          mobile: contact.mobile || null,
        });
      });

      mapped.forEach((row) => {
        const contacts =
          row.lead_type === 'new'
            ? newContactsByLead.get(row.id)
            : legacyContactsByLead.get(row.id);
        if (contacts) {
          row.contact_names = contacts.names;
          row.contact_phones = contacts.phones;
          row.contact_emails = contacts.emails;
        }
        if (row.lead_type === 'legacy') {
          const country = legacyCountryByLead.get(row.id);
          if (country) {
            row.country = country.name;
            row.country_id = country.id;
            row.country_timezone = resolveCountryTimezone(
              country.id,
              country.timezone,
              country.phone || row.phone,
              country.mobile,
            );
          }
        }
      });

      mapped.forEach((row) => {
        const previous = previousRowsById.get(row.id);
        if (!previous) return;
        const previousMs = parseDateMs(previous.last_interaction);
        const currentMs = parseDateMs(row.last_interaction);
        if (previousMs != null && (currentMs == null || previousMs > currentMs)) {
          row.last_interaction = previous.last_interaction;
        }
        row.awaiting_reply = previous.awaiting_reply;
        // Keep country on silent revalidates if the enrichment pass somehow missed it.
        if (!row.country && previous.country) {
          row.country = previous.country;
          row.country_id = previous.country_id;
          row.country_timezone = previous.country_timezone;
        }
      });

      snapshotStore.set({
        rows: mapped,
        categoryOptions: categoryOpts,
        tagOptions: tagOpts,
        stageOptions: stageOpts,
        context: ctx,
        userDbId,
      });
      setRows(mapped);

      // Real interaction data backs both the Last interaction column and the awaiting-reply
      // flag. It runs after the table is already visible so it never blocks first paint.
      void fetchLatestTouchByRowId(newIds, legacyIds)
        .then((latestByRow) => {
          setRows((prev) =>
            prev.map((row) => {
              const touch = latestByRow.get(row.id);
              return {
                ...row,
                awaiting_reply: isAwaitingReply(touch),
                last_interaction: touchToIso(touch, row.last_interaction),
              };
            }),
          );
        })
        .catch((e) => console.warn('Case pipeline: latest-interaction pass failed', e));
    } catch (e) {
      console.error('Case pipeline load failed:', e);
      if (silent) return; // Keep showing cached rows rather than emptying the table.
      snapshotStore.clear();
      setError(e instanceof Error ? e.message : 'Failed to load case pipeline');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [setRows]);

  useEffect(() => {
    if (!snapshotStore.get()) {
      void loadData();
      return;
    }
    // Paint instantly from the snapshot. Only refetch when it has aged out: remounting on every
    // tab switch would otherwise re-run the whole query, and realtime keeps rows patched while
    // this view is mounted.
    if (snapshotStore.isStale(PIPELINE_STALE_MS)) void loadData({ silent: true });
  }, [loadData]);

  // Same reasoning for a tab that sat in the background with the socket idle.
  useRevalidateOnVisible({
    isStale: () => snapshotStore.isStale(PIPELINE_STALE_MS),
    onRevalidate: () => void loadData({ silent: true }),
  });

  useScrollRestoration(snapshotStore, loading);

  const removeRow = useCallback(
    (rowId: string) => {
      setRows((prev) => (prev.some((r) => r.id === rowId) ? prev.filter((r) => r.id !== rowId) : prev));
    },
    [setRows],
  );

  /** Re-reads a single lead and patches it in place; never triggers a full table reload. */
  const syncLead = useCallback(
    async (leadType: 'new' | 'legacy', rawId: string) => {
      const ctx = contextRef.current;
      if (!ctx) return;
      const rowId = leadType === 'new' ? String(rawId) : `legacy_${rawId}`;

      try {
        const leadResult =
          leadType === 'new'
            ? await supabase.from('leads').select(NEW_LEAD_SELECT).eq('id', rawId).maybeSingle()
            : await supabase
                .from('leads_lead')
                .select(LEGACY_LEAD_SELECT)
                .eq('id', Number(rawId))
                .maybeSingle();

        if (leadResult.error) throw leadResult.error;
        const lead = leadResult.data as any;
        if (!lead) {
          removeRow(rowId);
          return;
        }

        const nextRow = leadType === 'new' ? mapNewLead(lead, ctx) : mapLegacyLead(lead, ctx);
        if (!nextRow) {
          // The manager/helper role moved to somebody else.
          removeRow(rowId);
          return;
        }

        const tagsQuery =
          leadType === 'new'
            ? supabase.from('leads_lead_tags').select('leadtag_id').eq('newlead_id', rawId)
            : supabase.from('leads_lead_tags').select('leadtag_id').eq('lead_id', Number(rawId));

        const followUpQuery = ctx.userDbId
          ? leadType === 'new'
            ? supabase
                .from('follow_ups')
                .select('date')
                .eq('user_id', ctx.userDbId)
                .eq('new_lead_id', rawId)
                .is('lead_id', null)
                .order('date', { ascending: false })
                .limit(1)
            : supabase
                .from('follow_ups')
                .select('date')
                .eq('user_id', ctx.userDbId)
                .eq('lead_id', Number(rawId))
                .is('new_lead_id', null)
                .order('date', { ascending: false })
                .limit(1)
          : Promise.resolve({ data: [], error: null } as any);

        const contactsQuery =
          leadType === 'new'
            ? supabase.from('contacts').select('name, phone, mobile, email').eq('lead_id', rawId)
            : supabase
                .from('lead_leadcontact')
                .select(
                  `
                  main,
                  leads_contact (
                    name,
                    phone,
                    mobile,
                    email,
                    country_id,
                    misc_country (
                      id,
                      name,
                      timezone
                    )
                  )
                `,
                )
                .eq('lead_id', Number(rawId));

        const [tagsResult, followUpResult, contactsResult, nextMeeting] = await Promise.all([
          tagsQuery,
          followUpQuery,
          contactsQuery,
          fetchNextMeetingForLead(leadType, String(rawId)),
        ]);

        const tagNameById = new Map(ctx.tagNames || []);
        nextRow.tags = Array.from(
          new Set(
            (tagsResult.data || [])
              .map((r: any) => tagNameById.get(String(r.leadtag_id)))
              .filter((name: string | undefined): name is string => Boolean(name)),
          ),
        );

        const followUpDate = (followUpResult.data || [])[0]?.date;
        nextRow.follow_up = followUpDate ? toDateKey(followUpDate) : null;
        nextRow.next_meeting = nextMeeting;

        const names: string[] = [];
        const phones: string[] = [];
        const emails: string[] = [];
        const legacyCountryHolder: {
          value: {
            name: string | null;
            id: number | null;
            timezone: string | null;
            phone: string | null;
            mobile: string | null;
          } | null;
        } = { value: null };
        (contactsResult.data || []).forEach((raw: any) => {
          const contact =
            leadType === 'new'
              ? raw
              : Array.isArray(raw.leads_contact)
                ? raw.leads_contact[0]
                : raw.leads_contact;
          if (!contact) return;
          if (contact.name) names.push(String(contact.name));
          if (contact.phone) phones.push(String(contact.phone));
          if (contact.mobile) phones.push(String(contact.mobile));
          if (contact.email) emails.push(String(contact.email));
          if (leadType === 'legacy') {
            const isMain =
              raw.main === true || raw.main === 'true' || raw.main === 1 || raw.main === '1';
            if (!isMain && legacyCountryHolder.value) return;
            const mc = Array.isArray(contact.misc_country)
              ? contact.misc_country[0]
              : contact.misc_country;
            const idRaw = mc?.id ?? contact.country_id;
            const id = idRaw == null || idRaw === '' ? null : Number(idRaw);
            legacyCountryHolder.value = {
              name: mc?.name ? String(mc.name) : null,
              id: id != null && !Number.isNaN(id) ? id : null,
              timezone: mc?.timezone ? String(mc.timezone) : null,
              phone: contact.phone || null,
              mobile: contact.mobile || null,
            };
          }
        });
        nextRow.contact_names = names;
        nextRow.contact_phones = phones;
        nextRow.contact_emails = emails;
        if (legacyCountryHolder.value) {
          nextRow.country = legacyCountryHolder.value.name;
          nextRow.country_id = legacyCountryHolder.value.id;
          nextRow.country_timezone = resolveCountryTimezone(
            legacyCountryHolder.value.id,
            legacyCountryHolder.value.timezone,
            legacyCountryHolder.value.phone || nextRow.phone,
            legacyCountryHolder.value.mobile,
          );
        }
        const latestTouch = await fetchLatestTouchForLead(leadType, String(rawId));
        nextRow.awaiting_reply = isAwaitingReply(latestTouch);
        nextRow.last_interaction = touchToIso(latestTouch, nextRow.last_interaction);

        setRows((prev) => {
          const index = prev.findIndex((r) => r.id === rowId);
          if (index < 0) return [nextRow, ...prev];
          const next = prev.slice();
          next[index] = nextRow;
          return next;
        });
      } catch (e) {
        console.warn('Case pipeline row sync failed:', e);
      }
    },
    [removeRow, setRows],
  );

  const pendingSyncRef = useRef(new Map<string, { leadType: 'new' | 'legacy'; rawId: string }>());
  const syncTimerRef = useRef<number | null>(null);

  /** Coalesces bursts of realtime events into one patch per lead. */
  const queueSync = useCallback(
    (leadType: 'new' | 'legacy', rawId: string) => {
      const rowId = leadType === 'new' ? String(rawId) : `legacy_${rawId}`;
      pendingSyncRef.current.set(rowId, { leadType, rawId });
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = window.setTimeout(() => {
        syncTimerRef.current = null;
        const pending = Array.from(pendingSyncRef.current.values());
        pendingSyncRef.current.clear();
        pending.forEach((item) => void syncLead(item.leadType, item.rawId));
      }, 400);
    },
    [syncLead],
  );

  useEffect(() => {
    return () => {
      if (syncTimerRef.current) {
        window.clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      pendingSyncRef.current.clear();
    };
  }, []);

  const realtimeSubscriptions = ((): RealtimeTableSubscription[] => {
    const handleLeadEvent = (leadType: 'new' | 'legacy') => (payload: any) => {
      const ctx = contextRef.current;
      if (!ctx) return;
      const record = payload?.new && Object.keys(payload.new).length > 0 ? payload.new : payload?.old;
      const rawId = record?.id;
      if (rawId == null) return;
      const rowId = leadType === 'new' ? String(rawId) : `legacy_${rawId}`;

      if (payload?.eventType === 'DELETE' || payload?.event === 'DELETE') {
        removeRow(rowId);
        return;
      }

      const mine =
        leadType === 'new'
          ? matchesPipelineUser(ctx, record?.manager) || matchesPipelineUser(ctx, record?.helper)
          : matchesPipelineUser(ctx, record?.meeting_manager_id) ||
            matchesPipelineUser(ctx, record?.meeting_lawyer_id);
      const listed = rowIdsRef.current.has(rowId);

      // Only touch leads that are already listed, or ones that just became mine in this pipeline.
      if (!listed) {
        if (!mine) return;
        if (record?.stage != null && !isPipelineStage(String(record.stage))) return;
      }
      queueSync(leadType, String(rawId));
    };

    const resolveLinkedLead = (record: any): { leadType: 'new' | 'legacy'; rawId: string } | null => {
      if (record?.new_lead_id) return { leadType: 'new', rawId: String(record.new_lead_id) };
      if (record?.newlead_id) return { leadType: 'new', rawId: String(record.newlead_id) };
      if (record?.client_id) return { leadType: 'new', rawId: String(record.client_id) };
      if (record?.legacy_id) return { leadType: 'legacy', rawId: String(record.legacy_id) };
      // WhatsApp new leads use lead_id as UUID; call_logs legacy use lead_id as int.
      if (record?.lead_id != null) {
        const raw = String(record.lead_id);
        if (/^\d+$/.test(raw)) return { leadType: 'legacy', rawId: raw };
        return { leadType: 'new', rawId: raw };
      }
      return null;
    };

    const refreshLatestTouch = (link: { leadType: 'new' | 'legacy'; rawId: string }) => {
      const rowId = link.leadType === 'new' ? link.rawId : `legacy_${link.rawId}`;
      if (!rowIdsRef.current.has(rowId)) return;
      void fetchLatestTouchForLead(link.leadType, link.rawId).then((touch) => {
        setRows((prev) =>
          prev.map((row) =>
            row.id === rowId
              ? {
                  ...row,
                  awaiting_reply: isAwaitingReply(touch),
                  last_interaction: touchToIso(touch, row.last_interaction),
                }
              : row,
          ),
        );
      });
    };

    const handleInteractionEvent = (payload: any) => {
      const record = payload?.new && Object.keys(payload.new).length > 0 ? payload.new : payload?.old;
      const link = resolveLinkedLead(record);
      if (!link) return;
      refreshLatestTouch(link);
    };

    const handleFollowUpEvent = (payload: any) => {
      const ctx = contextRef.current;
      if (!ctx?.userDbId) return;
      const record = payload?.new && Object.keys(payload.new).length > 0 ? payload.new : payload?.old;
      if (!record) return;
      if (record.user_id != null && String(record.user_id) !== ctx.userDbId) return;
      const link = resolveLinkedLead(record);
      if (!link) return;
      const rowId = link.leadType === 'new' ? link.rawId : `legacy_${link.rawId}`;
      if (!rowIdsRef.current.has(rowId)) return;

      const isDelete = payload?.eventType === 'DELETE' || payload?.event === 'DELETE';
      const nextValue = isDelete ? null : record.date ? toDateKey(record.date) : null;
      setRows((prev) =>
        prev.map((row) => (row.id === rowId ? { ...row, follow_up: nextValue } : row)),
      );
    };

    const handleTagEvent = (payload: any) => {
      const record = payload?.new && Object.keys(payload.new).length > 0 ? payload.new : payload?.old;
      const link = resolveLinkedLead(record);
      if (!link) return;
      const rowId = link.leadType === 'new' ? link.rawId : `legacy_${link.rawId}`;
      if (!rowIdsRef.current.has(rowId)) return;
      queueSync(link.leadType, link.rawId);
    };

    const handleMeetingEvent = (payload: any) => {
      const record = payload?.new && Object.keys(payload.new).length > 0 ? payload.new : payload?.old;
      if (!record) return;
      let link: { leadType: 'new' | 'legacy'; rawId: string } | null = null;
      if (record.client_id) link = { leadType: 'new', rawId: String(record.client_id) };
      else if (record.legacy_lead_id != null) {
        link = { leadType: 'legacy', rawId: String(record.legacy_lead_id) };
      }
      if (!link) return;
      const rowId = link.leadType === 'new' ? link.rawId : `legacy_${link.rawId}`;
      if (!rowIdsRef.current.has(rowId)) return;
      void fetchNextMeetingForLead(link.leadType, link.rawId).then((nextMeeting) => {
        setRows((prev) =>
          prev.map((row) => (row.id === rowId ? { ...row, next_meeting: nextMeeting } : row)),
        );
      });
    };

    return [
      { table: 'leads', handler: handleLeadEvent('new') },
      { table: 'leads_lead', handler: handleLeadEvent('legacy') },
      { table: 'follow_ups', handler: handleFollowUpEvent },
      { table: 'leads_lead_tags', handler: handleTagEvent },
      { table: 'meetings', handler: handleMeetingEvent },
      { table: 'whatsapp_messages', handler: handleInteractionEvent },
      { table: 'emails', handler: handleInteractionEvent },
      { table: 'call_logs', handler: handleInteractionEvent },
    ];
  })();

  // Rows are patched one at a time: a burst of writes never reloads the whole table.
  useRealtimeTables('case-pipeline:realtime', realtimeSubscriptions, {
    enabled: !loading && contextRef.current != null,
  });

  useEffect(() => {
    pipelineFilters = {
      roleTab,
      search,
      categoryFilter,
      tagFilter,
      stageFilter,
      statusFilter,
      dateFrom,
      dateTo,
      sortColumn,
      sortDirection,
      quickFilter,
    };
  }, [
    roleTab,
    search,
    categoryFilter,
    tagFilter,
    stageFilter,
    statusFilter,
    dateFrom,
    dateTo,
    sortColumn,
    sortDirection,
    quickFilter,
  ]);

  const openInteractions = (row: CasePipelineRow, e: React.MouseEvent) => {
    e.stopPropagation();
    setInteractionsFor(row);
  };

  useEffect(() => {
    if (!interactionsFor) {
      setInteractions(null);
      return;
    }
    let cancelled = false;
    setInteractionsLoading(true);
    setInteractions(null);
    fetchLeadRecentInteractions({
      id: interactionsFor.id,
      lead_type: interactionsFor.lead_type,
      lead_number: interactionsFor.lead_number,
    })
      .then((data) => {
        if (!cancelled) setInteractions(data);
      })
      .catch((e) => {
        console.error('Failed to load interactions:', e);
        if (!cancelled) setInteractions({ calls: [], emails: [], whatsapp: [] });
      })
      .finally(() => {
        if (!cancelled) setInteractionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [interactionsFor]);

  /** Inactive leads are hidden unless the status filter asks for them. */
  const matchesStatusFilter = useCallback(
    (row: CasePipelineRow) => {
      const wantActive = statusFilter.length === 0 || statusFilter.includes('active');
      const wantInactive = statusFilter.includes('inactive');
      return row.is_inactive ? wantInactive : wantActive;
    },
    [statusFilter],
  );

  const managerCount = useMemo(
    () => rows.filter((r) => r.is_manager && matchesStatusFilter(r)).length,
    [rows, matchesStatusFilter],
  );
  const helperCount = useMemo(
    () => rows.filter((r) => r.is_helper && matchesStatusFilter(r)).length,
    [rows, matchesStatusFilter],
  );

  const onCountsChangeRef = useRef(onCountsChange);
  onCountsChangeRef.current = onCountsChange;
  useEffect(() => {
    onCountsChangeRef.current?.({ manager: managerCount, helper: helperCount });
  }, [managerCount, helperCount]);

  /** Rows for the active role tab + status filter — the base set the summary boxes count. */
  const roleRows = useMemo(
    () =>
      rows.filter((r) => (roleTab === 'manager' ? r.is_manager : r.is_helper) && matchesStatusFilter(r)),
    [rows, roleTab, matchesStatusFilter],
  );

  const summary = useMemo(() => summarizePipelineRows(roleRows), [roleRows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = normalizeSearch(search);

    let list = roleRows;

    if (quickFilter) {
      list = list.filter((r) => matchesQuickFilter(r, quickFilter));
    }

    if (q) {
      list = list.filter((r) => {
        const haystack = [
          r.lead_number,
          r.client_name,
          r.email,
          ...r.contact_names,
          ...r.contact_emails,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (haystack.includes(q)) return true;

        if (qDigits) {
          const phones = [r.phone, r.mobile, ...r.contact_phones]
            .filter(Boolean)
            .map((p) => normalizeSearch(p));
          if (phones.some((p) => p.includes(qDigits))) return true;
        }
        return false;
      });
    }

    if (categoryFilter.length > 0) {
      list = list.filter((r) => r.main_category_id != null && categoryFilter.includes(r.main_category_id));
    }
    if (tagFilter.length > 0) {
      const wanted = new Set(tagFilter.map((t) => t.trim().toLowerCase()));
      list = list.filter((r) => r.tags.some((tag) => wanted.has(tag.trim().toLowerCase())));
    }
    if (stageFilter.length > 0) {
      list = list.filter((r) => stageFilter.includes(r.stage_id));
    }
    if (dateFrom) {
      list = list.filter((r) => {
        const key = toDateKey(r.created_at);
        return key != null && key >= dateFrom;
      });
    }
    if (dateTo) {
      list = list.filter((r) => {
        const key = toDateKey(r.created_at);
        return key != null && key <= dateTo;
      });
    }

    const sorted = [...list].sort((a, b) => {
      let av: number | null = null;
      let bv: number | null = null;
      if (sortColumn === 'created_at') {
        av = parseDateMs(a.created_at);
        bv = parseDateMs(b.created_at);
      } else if (sortColumn === 'follow_up') {
        av = parseDateMs(a.follow_up);
        bv = parseDateMs(b.follow_up);
      } else if (sortColumn === 'last_interaction') {
        av = parseDateMs(a.last_interaction);
        bv = parseDateMs(b.last_interaction);
      } else if (sortColumn === 'next_meeting') {
        av = parseDateMs(a.next_meeting);
        bv = parseDateMs(b.next_meeting);
      } else if (sortColumn === 'probability') {
        av = a.probability;
        bv = b.probability;
      } else {
        av = a.value;
        bv = b.value;
      }

      const aMissing = av == null;
      const bMissing = bv == null;
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;
      if (bMissing) return -1;
      if (av === bv) return 0;
      const cmp = (av as number) < (bv as number) ? -1 : 1;
      return sortDirection === 'asc' ? cmp : -cmp;
    });

    return sorted;
  }, [
    roleRows,
    quickFilter,
    search,
    categoryFilter,
    tagFilter,
    stageFilter,
    dateFrom,
    dateTo,
    sortColumn,
    sortDirection,
  ]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection(column === 'follow_up' || column === 'next_meeting' ? 'asc' : 'desc');
    }
  };

  const openFollowUpModal = (row: CasePipelineRow, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingFollowUp(row);
    setFollowUpDraft(toDateInputValue(row.follow_up));
  };

  const closeFollowUpModal = () => {
    if (savingFollowUp) return;
    setEditingFollowUp(null);
    setFollowUpDraft('');
  };

  const saveFollowUpDate = async () => {
    if (!editingFollowUp) return;
    if (!currentUserDbId) {
      toast.error('User not authenticated');
      return;
    }

    setSavingFollowUp(true);
    try {
      const isLegacy = editingFollowUp.lead_type === 'legacy';
      const actualLeadId = isLegacy
        ? editingFollowUp.id.replace(/^legacy_/, '')
        : editingFollowUp.id;
      const hasDate = Boolean(followUpDraft.trim());
      const dateValue = hasDate ? `${followUpDraft}T00:00:00Z` : null;

      const existingQuery = isLegacy
        ? supabase
            .from('follow_ups')
            .select('id')
            .eq('user_id', currentUserDbId)
            .eq('lead_id', Number(actualLeadId))
            .is('new_lead_id', null)
            .order('date', { ascending: false })
            .limit(1)
            .maybeSingle()
        : supabase
            .from('follow_ups')
            .select('id')
            .eq('user_id', currentUserDbId)
            .eq('new_lead_id', actualLeadId)
            .is('lead_id', null)
            .order('date', { ascending: false })
            .limit(1)
            .maybeSingle();

      const { data: existingFollowUp, error: existingError } = await existingQuery;
      if (existingError) throw existingError;

      if (hasDate) {
        if (existingFollowUp?.id) {
          const { error } = await supabase
            .from('follow_ups')
            .update({ date: dateValue })
            .eq('id', existingFollowUp.id);
          if (error) throw error;
          toast.success('Follow-up date updated');
        } else {
          const insertData: Record<string, unknown> = {
            user_id: currentUserDbId,
            date: dateValue,
            created_at: new Date().toISOString(),
          };
          if (isLegacy) {
            insertData.lead_id = Number(actualLeadId);
            insertData.new_lead_id = null;
          } else {
            insertData.new_lead_id = actualLeadId;
            insertData.lead_id = null;
          }
          const { error } = await supabase.from('follow_ups').insert(insertData);
          if (error) throw error;
          toast.success('Follow-up date saved');
        }

        setRows((prev) =>
          prev.map((row) =>
            row.id === editingFollowUp.id ? { ...row, follow_up: followUpDraft } : row,
          ),
        );
      } else if (existingFollowUp?.id) {
        const { error } = await supabase
          .from('follow_ups')
          .delete()
          .eq('id', existingFollowUp.id);
        if (error) throw error;
        toast.success('Follow-up removed');
        setRows((prev) =>
          prev.map((row) =>
            row.id === editingFollowUp.id ? { ...row, follow_up: null } : row,
          ),
        );
      }

      setEditingFollowUp(null);
      setFollowUpDraft('');
    } catch (e) {
      console.error('Error saving follow-up:', e);
      toast.error(e instanceof Error ? e.message : 'Failed to save follow-up');
    } finally {
      setSavingFollowUp(false);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setCategoryFilter([]);
    setTagFilter([]);
    setStageFilter([]);
    setStatusFilter(['active']);
    setDateFrom('');
    setDateTo('');
    setQuickFilter(null);
  };

  const hasActiveFilters =
    Boolean(search.trim()) ||
    categoryFilter.length > 0 ||
    tagFilter.length > 0 ||
    stageFilter.length > 0 ||
    statusFilter.length !== 1 ||
    statusFilter[0] !== 'active' ||
    Boolean(dateFrom) ||
    Boolean(dateTo) ||
    quickFilter != null;

  const SortHeader = ({
    column,
    children,
  }: {
    column: SortColumn;
    children: React.ReactNode;
  }) => {
    const active = sortColumn === column;
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 font-semibold text-gray-600 hover:text-gray-900"
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

  const followUpTone = (value: string | null): string => {
    const ms = parseDateMs(value);
    if (ms == null) return 'bg-gray-100 text-gray-500';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = new Date(ms);
    day.setHours(0, 0, 0, 0);
    const diff = Math.ceil((day.getTime() - today.getTime()) / 86400000);
    if (diff < 0) return 'bg-red-100 text-red-700';
    if (diff === 0) return 'bg-emerald-100 text-emerald-700';
    return 'bg-green-100 text-green-700';
  };

  const todayKey = localTodayYmd();

  return (
    <div
      className={
        withPageChrome ? 'min-h-full w-full bg-[#f3f4f6] px-4 py-6 sm:px-6 lg:px-8' : 'w-full'
      }
    >
      <div className="w-full space-y-5">
        {showHeader ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
              Case Pipeline
            </h1>
            <div className="inline-flex items-center gap-1 rounded-full bg-gray-200/70 p-1">
              {(
                [
                  { id: 'manager' as RoleTab, label: 'Manager', count: managerCount },
                  { id: 'helper' as RoleTab, label: 'Helper', count: helperCount },
                ]
              ).map((tab) => {
                const active = roleTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={active}
                    className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                      active
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-800'
                    }`}
                    onClick={() => setRoleTab(tab.id)}
                  >
                    {tab.label}
                    <span className={`ml-1.5 text-xs font-medium ${active ? 'text-gray-400' : 'text-gray-400'}`}>
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <PipelineSummaryCards
          counts={summary}
          quickFilter={quickFilter}
          onToggle={setQuickFilter}
        />

        {/* Filters sit inline on the page background, in one row, like the closer/scheduler pipeline */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative w-full min-w-0 sm:w-64">
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
          <div className="w-full min-w-0 sm:w-40">
            <MultiSelectFilter
              label="Status"
              options={STATUS_FILTER_OPTIONS}
              selected={statusFilter}
              onChange={setStatusFilter}
              placeholder="Active"
            />
          </div>
          <div className="w-full min-w-0 sm:w-44">
            <MultiSelectFilter
              label="Category"
              options={categoryOptions}
              selected={categoryFilter}
              onChange={setCategoryFilter}
            />
          </div>
          <div className="w-full min-w-0 sm:w-40">
            <MultiSelectFilter
              label="Tags"
              options={tagOptions}
              selected={tagFilter}
              onChange={setTagFilter}
            />
          </div>
          <div className="w-full min-w-0 sm:w-44">
            <MultiSelectFilter
              label="Stage"
              options={stageOptions}
              selected={stageFilter}
              onChange={setStageFilter}
            />
          </div>
          <div className="w-full min-w-0 sm:w-40">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Date from
            </label>
            <input
              type="date"
              className="input input-bordered w-full rounded-xl border-gray-200 bg-white text-sm"
              value={dateFrom}
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
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          {hasActiveFilters ? (
            <button
              type="button"
              className="inline-flex h-12 items-center gap-1 rounded-full px-3 text-xs font-medium text-gray-500 transition hover:bg-white hover:text-gray-800"
              onClick={clearFilters}
            >
              <XMarkIcon className="h-4 w-4" />
              Clear all
            </button>
          ) : null}
        </div>

        <div className="w-full">
          {error ? (
            <div className="rounded-xl border border-red-200 bg-white px-4 py-6 text-center text-sm text-red-600">
              {error}
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-20">
              <span className="loading loading-spinner loading-lg text-primary" />
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="w-full border-separate border-spacing-y-2 text-sm">
                <thead>
                  <tr className="text-left text-sm uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-2 font-semibold">Lead</th>
                    <th className="px-4 py-2 font-semibold">
                      <SortHeader column="created_at">Date created</SortHeader>
                    </th>
                    <th className="px-4 py-2 font-semibold">Stage</th>
                    <th className="px-4 py-2 font-semibold">Category</th>
                    <th className="px-4 py-2 font-semibold">Closer</th>
                    <th className="px-4 py-2 font-semibold">
                      <SortHeader column="value">Value</SortHeader>
                    </th>
                    <th className="px-4 py-2 font-semibold">
                      <SortHeader column="probability">Probability</SortHeader>
                    </th>
                    <th className="px-4 py-2 font-semibold">Tags</th>
                    <th className="px-4 py-2 font-semibold">
                      <SortHeader column="last_interaction">L. Interaction</SortHeader>
                    </th>
                    <th className="px-4 py-2 font-semibold">Country</th>
                    <th className="px-4 py-2 font-semibold">
                      <SortHeader column="next_meeting">Meeting</SortHeader>
                    </th>
                    <th className="px-4 py-2 font-semibold">
                      <SortHeader column="follow_up">Follow up</SortHeader>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={12}>
                        <div
                          className="rounded-xl bg-white px-4 py-12 text-center text-sm text-gray-500 shadow-sm"
                          style={ROW_CELL_STYLE}
                        >
                          No leads match your filters.
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => {
                      const soft = getSoftStageBadgeStyle(
                        getStageColour(row.stage_id),
                        row.stage_id,
                      );
                      return (
                        <tr
                          key={row.id}
                          className="cursor-pointer transition hover:-translate-y-[1px]"
                          onClick={(e) => openLeadFromRowClick(e, row.nav_id, navigate)}
                          onAuxClick={(e) => {
                            if (e.button === 1) openLeadFromRowClick(e, row.nav_id, navigate);
                          }}
                        >
                          <td
                            className="rounded-l-xl border border-r-0 border-gray-100 bg-white px-4 py-3.5 shadow-sm"
                            style={ROW_CELL_STYLE}
                          >
                            <div className="min-w-0">
                              <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                                #{row.lead_number}
                                {row.is_inactive ? (
                                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                    Inactive
                                  </span>
                                ) : null}
                              </p>
                              <p
                                className="line-clamp-3 max-w-[11rem] break-words text-sm leading-snug text-gray-600"
                                title={row.client_name}
                              >
                                {row.client_name || '—'}
                              </p>
                            </div>
                          </td>
                          <td
                            className="border-y border-gray-100 bg-white px-4 py-3.5 text-sm text-gray-700 shadow-sm"
                            style={ROW_CELL_STYLE}
                          >
                            {formatDisplayDate(row.created_at)}
                          </td>
                          <td
                            className="border-y border-gray-100 bg-white px-4 py-3.5 shadow-sm"
                            style={ROW_CELL_STYLE}
                          >
                            {row.stage_id ? (
                              <span
                                className="inline-flex max-w-[11rem] truncate rounded-full px-2.5 py-1 text-xs font-semibold"
                                style={{
                                  backgroundColor: soft.backgroundColor,
                                  color: soft.color,
                                }}
                                title={row.stage}
                              >
                                {row.stage}
                              </span>
                            ) : (
                              <span className="text-sm text-gray-400">—</span>
                            )}
                          </td>
                          <td
                            className="border-y border-gray-100 bg-white px-4 py-3.5 shadow-sm"
                            style={ROW_CELL_STYLE}
                          >
                            <span
                              className="block max-w-[11rem] break-words text-sm leading-snug text-gray-700 line-clamp-2"
                              title={row.category}
                            >
                              {row.category || '—'}
                            </span>
                          </td>
                          <td
                            className="border-y border-gray-100 bg-white px-4 py-3.5 shadow-sm"
                            style={ROW_CELL_STYLE}
                          >
                            <CloserCell name={row.closer_name} photoUrl={row.closer_photo} />
                          </td>
                          <td
                            className="border-y border-gray-100 bg-white px-4 py-3.5 text-sm font-semibold tabular-nums text-gray-900 shadow-sm"
                            style={ROW_CELL_STYLE}
                          >
                            {row.value_display}
                          </td>
                          <td
                            className="border-y border-gray-100 bg-white px-4 py-3.5 text-sm shadow-sm"
                            style={ROW_CELL_STYLE}
                          >
                            <span className={`font-bold ${probabilityTone(row.probability)}`}>
                              {row.probability != null ? `${row.probability}%` : '—'}
                            </span>
                          </td>
                          <td
                            className="border-y border-gray-100 bg-white px-4 py-3.5 shadow-sm"
                            style={ROW_CELL_STYLE}
                          >
                            {row.tags.length === 0 ? (
                              <span className="text-sm text-gray-400">—</span>
                            ) : (
                              <span
                                className="block max-w-[14rem] truncate text-sm text-gray-700"
                                title={row.tags.join(', ')}
                              >
                                {row.tags.join(', ')}
                              </span>
                            )}
                          </td>
                          <td
                            className="border-y border-gray-100 bg-white px-4 py-3.5 shadow-sm"
                            style={ROW_CELL_STYLE}
                          >
                            <button
                              type="button"
                              className="inline-flex flex-col items-start rounded-lg px-2 py-1 text-left transition hover:bg-gray-50"
                              title="Show the last interactions"
                              onClick={(e) => openInteractions(row, e)}
                            >
                              <span className="text-sm font-medium text-gray-800">
                                {row.last_interaction ? formatDisplayDate(row.last_interaction) : 'No contact'}
                              </span>
                              {row.last_interaction ? (
                                <span className="text-[11px] text-gray-400">
                                  {formatRelativeDays(row.last_interaction)}
                                </span>
                              ) : null}
                            </button>
                          </td>
                          <td
                            className="border-y border-gray-100 bg-white px-4 py-3.5 shadow-sm"
                            style={ROW_CELL_STYLE}
                          >
                            {/* Fixed-width name so the business-hours dot lines up down the column */}
                            <div className="flex items-center gap-1.5">
                              <span className="block w-24 truncate text-sm text-gray-700" title={row.country || undefined}>
                                {row.country || '—'}
                              </span>
                              <span className="flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                                {row.country_timezone
                                  ? (() => {
                                      const info = businessHoursInfo(row.country_timezone);
                                      return (
                                        <span
                                          className={`h-2.5 w-2.5 rounded-full ${
                                            info.isBusinessHours ? 'bg-green-500' : 'bg-red-500'
                                          }`}
                                          title={`${
                                            info.localTime
                                              ? `Local time: ${info.localTime}`
                                              : 'Time unavailable'
                                          } - ${
                                            info.isBusinessHours
                                              ? 'Business hours'
                                              : 'Outside business hours'
                                          } (${row.country_timezone})`}
                                        />
                                      );
                                    })()
                                  : null}
                              </span>
                            </div>
                          </td>
                          <td
                            className="border-y border-gray-100 bg-white px-4 py-3.5 shadow-sm"
                            style={ROW_CELL_STYLE}
                          >
                            {row.next_meeting ? (
                              <span
                                className={`text-sm font-medium ${
                                  isPastMeetingDate(row.next_meeting, todayKey)
                                    ? 'text-yellow-600'
                                    : 'text-indigo-600'
                                }`}
                              >
                                {formatDisplayDate(row.next_meeting)}
                              </span>
                            ) : (
                              <span className="text-sm text-gray-400">—</span>
                            )}
                          </td>
                          <td
                            className="rounded-r-xl border border-l-0 border-gray-100 bg-white px-4 py-3.5 shadow-sm"
                            style={ROW_CELL_STYLE}
                          >
                            <button
                              type="button"
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition hover:ring-2 hover:ring-primary/20 ${
                                row.follow_up
                                  ? followUpTone(row.follow_up)
                                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                              }`}
                              title="Edit your follow-up date"
                              onClick={(e) => openFollowUpModal(row, e)}
                            >
                              <CalendarDaysIcon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                              {row.follow_up ? formatDisplayDate(row.follow_up) : 'Set date'}
                            </button>
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
      </div>

      {editingFollowUp ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={closeFollowUpModal}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="case-pipeline-followup-title"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3
                  id="case-pipeline-followup-title"
                  className="text-lg font-bold text-gray-900"
                >
                  Follow-up date
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  #{editingFollowUp.lead_number}
                  {editingFollowUp.client_name ? ` · ${editingFollowUp.client_name}` : ''}
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  Saved only for your account
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle"
                onClick={closeFollowUpModal}
                disabled={savingFollowUp}
                aria-label="Close"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5">
              <label
                className="mb-1.5 block text-sm font-medium text-gray-700"
                htmlFor="case-pipeline-followup-date"
              >
                Date
              </label>
              <input
                id="case-pipeline-followup-date"
                type="date"
                className="input input-bordered w-full rounded-xl"
                value={followUpDraft}
                onChange={(e) => setFollowUpDraft(e.target.value)}
                disabled={savingFollowUp}
              />
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              {editingFollowUp.follow_up || followUpDraft ? (
                <button
                  type="button"
                  className="btn btn-ghost rounded-full"
                  disabled={savingFollowUp}
                  onClick={() => setFollowUpDraft('')}
                >
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost rounded-full"
                onClick={closeFollowUpModal}
                disabled={savingFollowUp}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary rounded-full"
                onClick={() => void saveFollowUpDate()}
                disabled={savingFollowUp}
              >
                {savingFollowUp ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    Saving…
                  </>
                ) : (
                  'Save'
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {interactionsFor ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={() => setInteractionsFor(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="case-pipeline-interactions-title"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3
                  id="case-pipeline-interactions-title"
                  className="text-lg font-bold text-gray-900"
                >
                  Last interactions
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  #{interactionsFor.lead_number}
                  {interactionsFor.client_name ? ` · ${interactionsFor.client_name}` : ''}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle"
                onClick={() => setInteractionsFor(null)}
                aria-label="Close"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {interactionsLoading ? (
              <div className="flex items-center justify-center py-16">
                <span className="loading loading-spinner loading-lg text-primary" />
              </div>
            ) : (
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <InteractionColumn
                  title="WhatsApp"
                  icon={ChatBubbleLeftRightIcon}
                  accent="text-emerald-600"
                  items={interactions?.whatsapp || []}
                />
                <InteractionColumn
                  title="Calls"
                  icon={PhoneIcon}
                  accent="text-sky-600"
                  items={interactions?.calls || []}
                />
                <InteractionColumn
                  title="Emails"
                  icon={EnvelopeIcon}
                  accent="text-violet-600"
                  items={interactions?.emails || []}
                />
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

function InteractionColumn({
  title,
  icon: Icon,
  accent,
  items,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  items: RecentInteractionItem[];
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-3">
      <div className="flex items-center gap-2 px-1 pb-2">
        <Icon className={`h-4 w-4 ${accent}`} />
        <span className="text-sm font-semibold text-gray-800">{title}</span>
        <span className="ml-auto text-xs text-gray-400">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="px-1 py-4 text-center text-xs text-gray-400">No {title.toLowerCase()} yet</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="rounded-xl bg-white p-2.5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {item.direction === 'in' ? 'Incoming' : item.direction === 'out' ? 'Outgoing' : '—'}
                </span>
                <span className="text-[11px] text-gray-400">{formatDisplayDate(item.at)}</span>
              </div>
              <p className="mt-1 break-words text-sm text-gray-800">{item.preview}</p>
              {item.meta ? (
                <p className="mt-0.5 truncate text-[11px] text-gray-400" title={item.meta}>
                  {item.meta}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default CasePipelineView;
