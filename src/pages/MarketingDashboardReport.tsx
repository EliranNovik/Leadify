/** Marketing performance dashboard — see “About this report” next to the title. */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  ENGRAVED_FILTER_CONTROL_CLASSES,
} from '../components/EngravedFilterPanel';
import { ChannelLabel } from '../components/ChannelLabel';
import MarketingDashboardLeadBreakdownModal from '../components/MarketingDashboardLeadBreakdownModal';
import {
  buildDealsBreakdownTitle,
  filterLeadsForMarketingBreakdown,
  formatMarketingCategoryDisplay,
  resolveMarketingMainCategoryId,
  type MarketingLeadBreakdownRow,
  type MiscCategoryJoin,
  isMarketingStage91,
  leadCountsAsMarketingMeeting,
  STAGE_DROPPED_SPAM,
} from '../lib/marketingDashboardBreakdown';
import { fetchStageNames, getStageName } from '../lib/stageUtils';
import { convertToNIS, getCurrencySymbol } from '../lib/currencyConversion';
import {
  buildJerusalemEndOfDayIso,
  buildJerusalemStartOfDayIso,
  buildLegacyLeadSourceIdOrFilterClause,
  buildLeadSourceOrFilterClause,
  resolveEffectiveSourceIdsForFetch,
  isFirmOnlyReportScope,
  resolveSourceFilterNames,
  timestampInCalendarRange,
  type SourceRowLike,
} from '../lib/leadDateFilters';
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
type CountryRow = { id: number; name: string; phone_code?: string | null };
type MainCategoryRow = { id: string; name: string };

type LeadRow = {
  id: string;
  created_at: string;
  lead_number: string | null;
  name: string | null;
  category: string | null;
  /** misc_maincategory.id from category join (for main-category filter). */
  main_category_id: string | null;
  /** Display name of scheduler (match tenants_employee.display_name); primary for CTI match */
  scheduler: string | null;
  /** Fallback when scheduler text does not resolve */
  meeting_scheduler_id: number | null;
  stage: string | number | null;
  source: string | null;
  /** bigint in DB; treat as string to avoid int8 precision issues */
  source_id: string | null;
  status: string | number | null;
  eligible: boolean | null;
  eligibility_status: string | null;
  unactivated_at: string | null;
  unactivation_reason: string | null;
  balance: number | null;
  proposal_total: number | null;
  balance_currency: string | null;
  probability: number | null;
  country_id: number | null;
  /** Legacy leads_lead.currency_id — used for NIS revenue conversion */
  currency_id?: number | null;
  phone?: string | null;
  mobile?: string | null;
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
  meeting_rescheduled: 21,
  client_signed: 60,
  client_declined: 0,
  lead_summary: 55,
  unactivated: 0,
  unactivate_spam: 91,
  dropped_spam: 91,
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
  if (lead.status === 'inactive' || lead.status === '10' || lead.status === 10) return true;
  if (isMarketingStage91(lead)) return true;
  return false;
}

/** Simplified eligibility vs boss spec — extend when stage_history + inactive reasons are modeled. */
function isEligibleLead(lead: LeadRow): boolean {
  if (isInactiveLead(lead)) {
    const reason = (lead.unactivation_reason || '').toLowerCase();
    if (reason.includes('no legal') || reason.includes('eligib')) return false;
    return false;
  }
  if (lead.eligible === true) return true;
  const r = stageRank(lead);
  if (r >= HIST_STAGE.offer) return true;
  if (lead.eligibility_status && String(lead.eligibility_status).toLowerCase().includes('eligible')) return true;
  if (r >= HIST_STAGE.meeting) return true;
  return false;
}

/** Offer-stage lead; never counts stage 91 (91 ≥ offer threshold numerically). */
function hasOfferOrBeyond(lead: LeadRow): boolean {
  if (isMarketingStage91(lead)) return false;
  const r = stageRank(lead);
  if (r === STAGE_DROPPED_SPAM) return false;
  return r >= HIST_STAGE.offer;
}

function isCanceledMeetingStatus(status: string | null | undefined): boolean {
  const s = String(status ?? '').trim().toLowerCase();
  return s === 'canceled' || s === 'cancelled';
}

type MeetingLinkRow = {
  client_id: string | null;
  legacy_lead_id: number | null;
  status: string | null;
};

/** Lead ids (UUID or legacy-{n}) that have at least one non-canceled row in public.meetings. */
async function fetchLeadIdsWithMeetingsFromTable(
  newLeadIds: string[],
  legacyLeadNumericIds: number[],
): Promise<{ leadIds: Set<string>; error: string | null }> {
  const leadIds = new Set<string>();
  const chunkSize = 100;

  const leadIdFromMeetingRow = (m: MeetingLinkRow): string | null => {
    if (m.client_id) return String(m.client_id);
    if (m.legacy_lead_id != null && Number.isFinite(Number(m.legacy_lead_id))) {
      return `legacy-${m.legacy_lead_id}`;
    }
    return null;
  };

  const appendBatch = (rows: MeetingLinkRow[]) => {
    for (const m of rows) {
      if (isCanceledMeetingStatus(m.status)) continue;
      const id = leadIdFromMeetingRow(m);
      if (id) leadIds.add(id);
    }
  };

  for (let i = 0; i < newLeadIds.length; i += chunkSize) {
    const chunk = newLeadIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('meetings')
      .select('client_id, legacy_lead_id, status')
      .in('client_id', chunk);
    if (error) return { leadIds, error: error.message };
    appendBatch((data || []) as MeetingLinkRow[]);
  }

  for (let i = 0; i < legacyLeadNumericIds.length; i += chunkSize) {
    const chunk = legacyLeadNumericIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('meetings')
      .select('client_id, legacy_lead_id, status')
      .in('legacy_lead_id', chunk);
    if (error) return { leadIds, error: error.message };
    appendBatch((data || []) as MeetingLinkRow[]);
  }

  return { leadIds, error: null };
}

function hasSignedDeal(lead: LeadRow): boolean {
  if (isMarketingStage91(lead)) return false;
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

/** Calendar months (YYYY-MM-01) overlapping the report date range. Empty when no dates set. */
function listExpenseMonthsInRange(fromDate: string, toDate: string): string[] {
  const from = (fromDate || toDate || '').trim();
  const to = (toDate || fromDate || '').trim();
  if (!from && !to) return [];

  const parseYm = (s: string) => {
    const [y, m] = s.split('-').map(Number);
    return { y: y || 2000, m: m || 1 };
  };

  let { y: y1, m: m1 } = parseYm(from || to);
  let { y: y2, m: m2 } = parseYm(to || from);
  if (y1 > y2 || (y1 === y2 && m1 > m2)) {
    [y1, m1, y2, m2] = [y2, m2, y1, m1];
  }

  const out: string[] = [];
  let y = y1;
  let m = m1;
  for (;;) {
    out.push(`${y}-${String(m).padStart(2, '0')}-01`);
    if (y === y2 && m === m2) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

async function fetchMediaExpensesBySource(
  fromDate: string,
  toDate: string,
): Promise<Record<string, number>> {
  const monthKeys = listExpenseMonthsInRange(fromDate, toDate);
  let q = supabase.from('source_media_expense').select('lead_source_id, amount');
  if (monthKeys.length > 0) {
    q = q.in('expense_month', monthKeys);
  }
  const { data, error } = await q;
  if (error) {
    console.warn('source_media_expense:', error.message);
    return {};
  }
  const bySource: Record<string, number> = {};
  for (const row of data || []) {
    const sid = String(row.lead_source_id);
    bySource[sid] = (bySource[sid] || 0) + (Number(row.amount) || 0);
  }
  return bySource;
}

function managementAmountToNis(amount: unknown, currency: string | null | undefined): number {
  const raw = Number(amount);
  if (!Number.isFinite(raw) || raw === 0) return 0;
  const sym = (currency || 'ILS').trim();
  try {
    return convertToNIS(raw, sym === 'ILS' ? '₪' : sym);
  } catch {
    return raw;
  }
}

async function fetchManagementExpensesByFirm(
  fromDate: string,
  toDate: string,
): Promise<Record<string, number>> {
  const monthKeys = listExpenseMonthsInRange(fromDate, toDate);
  let q = supabase.from('firm_management_costs').select('firm_id, amount, currency');
  if (monthKeys.length > 0) {
    q = q.in('billing_month', monthKeys);
  }
  const { data, error } = await q;
  if (error) {
    console.warn('firm_management_costs:', error.message);
    return {};
  }
  const byFirm: Record<string, number> = {};
  for (const row of data || []) {
    const firmId = String(row.firm_id);
    byFirm[firmId] = (byFirm[firmId] || 0) + managementAmountToNis(row.amount, row.currency);
  }
  return byFirm;
}

function extractCountryCodeFromPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const normalized = phone.replace(/[\s\-()]/g, '');
  if (normalized.startsWith('+')) {
    if (normalized.length > 4) {
      const threeDigit = normalized.substring(1, 4);
      if (/^97[0-9]$/.test(threeDigit) || /^35[0-9]$/.test(threeDigit) || /^90[0-9]$/.test(threeDigit)) {
        return `+${threeDigit}`;
      }
    }
    if (normalized.length > 3) {
      const twoDigit = normalized.substring(1, 3);
      if (/^[2-9][0-9]$/.test(twoDigit)) return `+${twoDigit}`;
    }
    if (normalized.startsWith('+1') && normalized.length > 2) return '+1';
  }
  if (normalized.startsWith('00')) {
    if (normalized.length > 5) {
      const threeDigit = normalized.substring(2, 5);
      if (/^97[0-9]$/.test(threeDigit) || /^35[0-9]$/.test(threeDigit) || /^90[0-9]$/.test(threeDigit)) {
        return `+${threeDigit}`;
      }
    }
    if (normalized.length > 4) {
      const twoDigit = normalized.substring(2, 4);
      if (/^[2-9][0-9]$/.test(twoDigit)) return `+${twoDigit}`;
    }
    if (normalized.startsWith('001') && normalized.length > 3) return '+1';
  }
  if (normalized.length > 2) {
    const threeDigit = normalized.substring(0, 3);
    if (/^97[0-9]$/.test(threeDigit) || /^35[0-9]$/.test(threeDigit) || /^90[0-9]$/.test(threeDigit)) {
      return `+${threeDigit}`;
    }
  }
  if (normalized.length > 1) {
    const twoDigit = normalized.substring(0, 2);
    if (/^[2-9][0-9]$/.test(twoDigit)) return `+${twoDigit}`;
    if (normalized.startsWith('1') && normalized.length > 1) return '+1';
  }
  return null;
}

function normalizeSourceName(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function buildSourceLookupMaps(allSources: SourceRow[]) {
  const sourceNameToRow = new Map<string, SourceRow>();
  const sourceIdToRow = new Map<string, SourceRow>();
  for (const s of allSources) {
    const key = normalizeSourceName(s.name);
    if (key && !sourceNameToRow.has(key)) sourceNameToRow.set(key, s);
    sourceIdToRow.set(String(s.id), s);
  }
  return { sourceNameToRow, sourceIdToRow };
}

function resolveLeadSourceRow(
  lead: LeadRow,
  sourceNameToRow: Map<string, SourceRow>,
  sourceIdToRow: Map<string, SourceRow>,
): SourceRow | null {
  if (lead.misc_leadsource) {
    return {
      id: String(lead.misc_leadsource.id),
      name: lead.misc_leadsource.name,
      channel_id: lead.misc_leadsource.channel_id,
    };
  }
  const sid = lead.source_id != null && String(lead.source_id).trim() !== '' ? String(lead.source_id) : null;
  if (sid && sourceIdToRow.has(sid)) return sourceIdToRow.get(sid)!;
  const key = normalizeSourceName(lead.source);
  return key ? sourceNameToRow.get(key) || null : null;
}

function leadChannelId(
  lead: LeadRow,
  sourceNameToRow: Map<string, SourceRow>,
  sourceIdToRow: Map<string, SourceRow>,
): string | null {
  if (lead.misc_leadsource?.channel_id) return lead.misc_leadsource.channel_id;
  return resolveLeadSourceRow(lead, sourceNameToRow, sourceIdToRow)?.channel_id ?? null;
}

function buildSelectedPhoneCodes(countryIds: string[], countries: CountryRow[]): Set<string> {
  const selectedCountryIds = new Set(
    countryIds.map((c) => parseInt(c, 10)).filter((n) => Number.isFinite(n)),
  );
  const codes = new Set<string>();
  for (const country of countries) {
    if (!selectedCountryIds.has(country.id)) continue;
    const raw = country.phone_code?.trim();
    if (!raw) continue;
    codes.add(raw.startsWith('+') ? raw : `+${raw}`);
  }
  return codes;
}

function leadMatchesSourceFilter(
  lead: LeadRow,
  selectedSourceIds: string[],
  allSources: SourceRow[],
  sourceNameToRow: Map<string, SourceRow>,
  sourceIdToRow: Map<string, SourceRow>,
): boolean {
  if (selectedSourceIds.length === 0) return true;
  const selectedIdSet = new Set(selectedSourceIds.map(String));
  const selectedNames = new Set(
    allSources.filter((s) => selectedIdSet.has(String(s.id))).map((s) => normalizeSourceName(s.name)),
  );
  // Lead Search resolves source names -> all matching misc_leadsource ids (.in('name', ...)).
  const allowedIds = new Set(selectedSourceIds.map(String));
  for (const s of allSources) {
    const name = normalizeSourceName(s.name);
    if (name && selectedNames.has(name)) allowedIds.add(String(s.id));
  }

  const sourceText = normalizeSourceName(lead.source);
  const joinedText = normalizeSourceName(lead.misc_leadsource?.name);
  if (sourceText && selectedNames.has(sourceText)) return true;
  if (joinedText && selectedNames.has(joinedText)) return true;

  const candidates = new Set<string>();
  if (lead.source_id != null && String(lead.source_id).trim() !== '') candidates.add(String(lead.source_id));
  if (lead.misc_leadsource?.id != null) candidates.add(String(lead.misc_leadsource.id));
  const resolved = resolveLeadSourceRow(lead, sourceNameToRow, sourceIdToRow);
  if (resolved?.id) candidates.add(String(resolved.id));
  for (const id of candidates) {
    if (allowedIds.has(id)) return true;
  }
  return false;
}

function leadMatchesMainCategoryFilter(lead: LeadRow, mainCategoryIds: string[]): boolean {
  if (mainCategoryIds.length === 0) return true;
  const id = lead.main_category_id;
  if (!id) return false;
  return mainCategoryIds.includes(String(id));
}

function leadMatchesCountryFilter(lead: LeadRow, countryIds: string[], countries: CountryRow[]): boolean {
  if (countryIds.length === 0) return true;
  const ok = new Set(countryIds.map((c) => parseInt(c, 10)).filter((n) => Number.isFinite(n)));
  if (lead.country_id != null && ok.has(lead.country_id)) return true;
  const phoneCodes = buildSelectedPhoneCodes(countryIds, countries);
  const phoneCode = extractCountryCodeFromPhone(lead.phone);
  if (phoneCode && phoneCodes.has(phoneCode)) return true;
  const mobileCode = extractCountryCodeFromPhone(lead.mobile);
  if (mobileCode && phoneCodes.has(mobileCode)) return true;
  return false;
}

function leadMatchesFirmFilter(
  lead: LeadRow,
  firmIds: string[],
  firmIdToSourceIds: Map<string, string[]>,
  sourceIdToFirmIds: Map<string, string[]>,
  allSources: SourceRow[],
  sourceNameToRow: Map<string, SourceRow>,
  sourceIdToRow: Map<string, SourceRow>,
): boolean {
  if (firmIds.length === 0) return true;
  const selectedFirms = new Set(firmIds.map(String));

  const resolved = resolveLeadSourceRow(lead, sourceNameToRow, sourceIdToRow);
  const candidateSourceIds = new Set<string>();
  if (resolved?.id) candidateSourceIds.add(String(resolved.id));
  if (lead.source_id != null && String(lead.source_id).trim() !== '') {
    candidateSourceIds.add(String(lead.source_id));
  }
  if (lead.misc_leadsource?.id != null) {
    candidateSourceIds.add(String(lead.misc_leadsource.id));
  }

  for (const sid of candidateSourceIds) {
    const linkedFirms = sourceIdToFirmIds.get(sid) || [];
    if (linkedFirms.some((f) => selectedFirms.has(String(f)))) return true;
  }

  const allowedSourceIds: string[] = [];
  for (const firmId of firmIds) {
    allowedSourceIds.push(...(firmIdToSourceIds.get(firmId) || []));
  }
  if (allowedSourceIds.length === 0) return false;
  return leadMatchesSourceFilter(
    lead,
    [...new Set(allowedSourceIds)],
    allSources,
    sourceNameToRow,
    sourceIdToRow,
  );
}

function isLegacyLeadId(id: string): boolean {
  return id.startsWith('legacy-');
}

function legacyLeadNumericId(lead: LeadRow): number | null {
  if (!isLegacyLeadId(lead.id)) return null;
  const n = parseInt(lead.id.slice('legacy-'.length), 10);
  return Number.isFinite(n) ? n : null;
}

function parseLegacyTriState(value: unknown): boolean | null {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return null;
}

function legacyBalanceAndCurrency(raw: Record<string, unknown>): {
  balance: number | null;
  proposal_total: number | null;
  balance_currency: string;
  currency_id: number | null;
} {
  const currencyJoin = raw.accounting_currencies as
    | { id?: number; name?: string | null }
    | { id?: number; name?: string | null }[]
    | null
    | undefined;
  const currencyRec = Array.isArray(currencyJoin) ? currencyJoin[0] : currencyJoin;
  let currencyId = raw.currency_id != null ? Number(raw.currency_id) : NaN;
  if (!Number.isFinite(currencyId)) currencyId = currencyRec?.id != null ? Number(currencyRec.id) : 1;
  if (!Number.isFinite(currencyId)) currencyId = 1;

  const balance =
    currencyId === 1
      ? raw.total_base != null
        ? Number(raw.total_base)
        : null
      : raw.total != null
        ? Number(raw.total)
        : raw.total_base != null
          ? Number(raw.total_base)
          : null;

  const proposal_total = raw.proposal != null ? Number(raw.proposal) : null;
  const balance_currency = (currencyRec?.name || getCurrencySymbol(currencyId)).trim() || '₪';

  return { balance, proposal_total, balance_currency, currency_id: currencyId };
}

type LeadRowWithCategoryJoin = LeadRow & {
  misc_category?: MiscCategoryJoin | MiscCategoryJoin[] | null;
};

function enrichLeadCategoryName(row: LeadRowWithCategoryJoin): LeadRow {
  const category = formatMarketingCategoryDisplay(row.misc_category, row.category);
  const main_category_id = resolveMarketingMainCategoryId(row.misc_category);
  const { misc_category: _omit, ...rest } = row;
  return {
    ...rest,
    category: category === '—' ? null : category,
    main_category_id,
  };
}

function mapLegacyLeadToRow(raw: Record<string, unknown>): LeadRow {
  const srcJoin = raw.misc_leadsource as
    | { id: number; name: string; channel_id?: string | null }
    | { id: number; name: string; channel_id?: string | null }[]
    | null
    | undefined;
  const src = Array.isArray(srcJoin) ? srcJoin[0] : srcJoin;
  const schedJoin = raw.scheduler_employee as { display_name?: string | null } | { display_name?: string | null }[] | null | undefined;
  const sched = Array.isArray(schedJoin) ? schedJoin[0] : schedJoin;
  const cdate = raw.cdate != null ? String(raw.cdate) : '';
  const createdAt = cdate || new Date().toISOString();
  const legacyStatus = raw.status;
  const isLegacyInactive = legacyStatus === 10 || legacyStatus === '10';
  const eligibleRaw = raw.eligibile ?? raw.eligible;
  const { balance, proposal_total, balance_currency, currency_id } = legacyBalanceAndCurrency(raw);

  const catJoin = raw.misc_category as MiscCategoryJoin | MiscCategoryJoin[] | null | undefined;
  const categoryRaw = raw.category != null ? String(raw.category) : null;
  const categoryFormatted = formatMarketingCategoryDisplay(catJoin, categoryRaw);
  const category = categoryFormatted === '—' ? null : categoryFormatted;
  const main_category_id = resolveMarketingMainCategoryId(catJoin);

  return {
    id: `legacy-${raw.id}`,
    created_at: createdAt,
    lead_number: raw.lead_number != null ? String(raw.lead_number) : String(raw.id),
    name: raw.name != null ? String(raw.name) : null,
    category,
    main_category_id,
    scheduler: sched?.display_name?.trim() || null,
    meeting_scheduler_id:
      raw.meeting_scheduler_id != null && !Number.isNaN(Number(raw.meeting_scheduler_id))
        ? Number(raw.meeting_scheduler_id)
        : null,
    stage: (raw.stage as string | number | null) ?? null,
    source: src?.name ?? (raw.source_external_id != null ? String(raw.source_external_id) : null),
    source_id: raw.source_id != null ? String(raw.source_id) : null,
    status: isLegacyInactive ? 'inactive' : legacyStatus != null ? legacyStatus : null,
    eligible: parseLegacyTriState(eligibleRaw),
    eligibility_status:
      raw.eligibility_status != null ? String(raw.eligibility_status) : null,
    unactivated_at: isLegacyInactive ? createdAt : null,
    unactivation_reason: null,
    balance,
    proposal_total,
    balance_currency,
    currency_id,
    probability: raw.probability != null ? Number(raw.probability) : null,
    country_id: null,
    phone: raw.phone != null ? String(raw.phone) : null,
    mobile: raw.mobile != null ? String(raw.mobile) : null,
    misc_leadsource: src
      ? { id: src.id, name: src.name, channel_id: src.channel_id ?? null }
      : null,
  };
}

async function paginateLegacyLeadQuery(
  buildQuery: () => ReturnType<ReturnType<typeof supabase.from>['select']>,
  maxRows: number,
): Promise<Record<string, unknown>[]> {
  const pageSize = 1000;
  const combined: Record<string, unknown>[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await buildQuery().order('cdate', { ascending: false }).range(offset, offset + pageSize - 1);
    if (error) throw error;
    const batch = (data || []) as Record<string, unknown>[];
    combined.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
    if (combined.length >= maxRows) break;
  }
  return combined;
}

async function fetchLegacyLeadMainContactCountryIds(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('lead_leadcontact')
      .select(
        `
        lead_id,
        leads_contact (
          country_id
        )
      `,
      )
      .eq('main', true)
      .range(offset, offset + 999);
    if (error) throw error;
    const batch = data || [];
    for (const row of batch) {
      const leadId = row.lead_id != null ? String(row.lead_id) : '';
      if (!leadId) continue;
      const contact = row.leads_contact as { country_id?: number | null } | { country_id?: number | null }[] | null;
      const c = Array.isArray(contact) ? contact[0] : contact;
      const countryId = c?.country_id;
      if (countryId != null && Number.isFinite(Number(countryId))) {
        map.set(leadId, Number(countryId));
      }
    }
    if (batch.length < 1000) break;
    offset += 1000;
  }
  return map;
}

async function fetchLegacyLeadRows(
  fromDate: string,
  toDate: string,
  maxRows: number,
  allSources: SourceRow[],
  sourceIdsForSql: string[] | null,
): Promise<LeadRow[]> {
  if (sourceIdsForSql !== null && sourceIdsForSql.length === 0) return [];
  const legacySelect = `
    *,
    misc_leadsource!leads_lead_source_id_fkey(id, name, channel_id),
    misc_category!leads_lead_category_id_fkey ( name, parent_id, misc_maincategory!parent_id ( id, name ) ),
    scheduler_employee:tenants_employee!fk_leads_lead_meeting_scheduler_id(id, display_name),
    accounting_currencies!leads_lead_currency_id_fkey(id, name, iso_code)
  `;

  const applyDateFilters = (q: ReturnType<ReturnType<typeof supabase.from>['select']>) => {
    let next = q;
    if (fromDate) next = next.gte('cdate', fromDate);
    if (toDate) next = next.lte('cdate', `${toDate}T23:59:59`);
    return next;
  };

  const selectedSourceNames =
    sourceIdsForSql === null
      ? []
      : resolveSourceFilterNames(sourceIdsForSql, allSources as SourceRowLike[]);
  const byId = new Map<string, Record<string, unknown>>();

  const mergeBatch = (batch: Record<string, unknown>[]) => {
    for (const raw of batch) {
      byId.set(String(raw.id), raw);
    }
  };

  try {
    if (selectedSourceNames.length === 0 && sourceIdsForSql === null) {
      mergeBatch(
        await paginateLegacyLeadQuery(
          () => applyDateFilters(supabase.from('leads_lead').select(legacySelect)),
          maxRows,
        ),
      );
    } else if (sourceIdsForSql != null) {
      const sourceOr = buildLegacyLeadSourceIdOrFilterClause(
        sourceIdsForSql,
        allSources as SourceRowLike[],
      );

      if (sourceOr) {
        mergeBatch(
          await paginateLegacyLeadQuery(
            () => applyDateFilters(supabase.from('leads_lead').select(legacySelect)).or(sourceOr),
            maxRows,
          ),
        );
      } else {
        const nums = sourceIdsForSql.map((id) => Number(id)).filter((n) => Number.isFinite(n));
        if (nums.length === 1) {
          mergeBatch(
            await paginateLegacyLeadQuery(
              () =>
                applyDateFilters(supabase.from('leads_lead').select(legacySelect)).eq('source_id', nums[0]),
              maxRows,
            ),
          );
        } else if (nums.length > 1) {
          mergeBatch(
            await paginateLegacyLeadQuery(
              () =>
                applyDateFilters(supabase.from('leads_lead').select(legacySelect)).in('source_id', nums),
              maxRows,
            ),
          );
        }
      }

      // Same fallback as Lead Search — catches rows where source_id is stale but join name matches.
      if (selectedSourceNames.length === 1) {
        mergeBatch(
          await paginateLegacyLeadQuery(
            () =>
              applyDateFilters(supabase.from('leads_lead').select(legacySelect)).eq(
                'misc_leadsource.name',
                selectedSourceNames[0],
              ),
            maxRows,
          ),
        );
      } else if (selectedSourceNames.length > 1) {
        mergeBatch(
          await paginateLegacyLeadQuery(
            () =>
              applyDateFilters(supabase.from('leads_lead').select(legacySelect)).in(
                'misc_leadsource.name',
                selectedSourceNames,
              ),
            maxRows,
          ),
        );
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
    console.warn('leads_lead:', msg, error);
    return [];
  }

  return [...byId.values()].map(mapLegacyLeadToRow);
}

async function fetchPaginatedNewLeads(
  fromDate: string,
  toDate: string,
  maxRows: number,
  allSources: SourceRow[],
  sourceIdsForSql: string[] | null,
): Promise<{ rows: LeadRow[]; truncated: boolean }> {
  if (sourceIdsForSql !== null && sourceIdsForSql.length === 0) {
    return { rows: [], truncated: false };
  }
  let q = supabase.from('leads').select(`
    id,
    created_at,
    lead_number,
    name,
    category,
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
    currency_id,
    phone,
    mobile,
    misc_country!country_id ( id, name ),
    misc_leadsource!fk_leads_source_id ( id, name, channel_id ),
    misc_category!category_id ( name, parent_id, misc_maincategory!parent_id ( id, name ) )
  `);

  if (fromDate) q = q.gte('created_at', buildJerusalemStartOfDayIso(fromDate));
  if (toDate) q = q.lte('created_at', buildJerusalemEndOfDayIso(toDate));

  const selectedSourceNames =
    sourceIdsForSql === null
      ? []
      : resolveSourceFilterNames(sourceIdsForSql, allSources as SourceRowLike[]);
  if (sourceIdsForSql != null && sourceIdsForSql.length > 0) {
    const sourceOr = buildLeadSourceOrFilterClause(sourceIdsForSql, allSources as SourceRowLike[]);
    if (sourceOr) {
      q = q.or(sourceOr);
    }
  }

  const pageSize = 1000;
  const combined: LeadRow[] = [];
  let offset = 0;
  let truncated = false;
  for (;;) {
    const { data, error } = await q.order('created_at', { ascending: false }).range(offset, offset + pageSize - 1);
    if (error) throw error;
    const batch = ((data || []) as unknown as LeadRow[]).map(enrichLeadCategoryName);
    combined.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
    if (combined.length >= maxRows) {
      truncated = true;
      break;
    }
  }
  const rows = combined;
  return { rows, truncated };
}

async function fetchCallLogsPaged(
  applyLeadFilter: (q: ReturnType<typeof supabase.from>) => ReturnType<typeof supabase.from>,
  callFrom?: string,
  callTo?: string,
): Promise<{ rows: CallLogRow[]; error: string | null }> {
  const combined: CallLogRow[] = [];
  let offset = 0;
  for (;;) {
    let qCalls = applyLeadFilter(
      supabase.from('call_logs').select('id, employee_id, lead_id, client_id, duration, cdate'),
    );
    if (callFrom) qCalls = qCalls.gte('cdate', callFrom);
    if (callTo) qCalls = qCalls.lte('cdate', callTo);
    const { data, error } = await qCalls.order('cdate', { ascending: true }).range(offset, offset + 999);
    if (error) return { rows: combined, error: error.message };
    const batch = (data || []) as CallLogRow[];
    combined.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  return { rows: combined, error: null };
}

async function fetchCallLogsForCohort(
  newLeadIds: string[],
  legacyLeadNumericIds: number[],
  callFrom?: string,
  callTo?: string,
): Promise<{ rows: CallLogRow[]; error: string | null }> {
  const chunkSize = 100;
  const combined: CallLogRow[] = [];
  const seen = new Set<number | string>();

  const appendUnique = (rows: CallLogRow[]) => {
    for (const c of rows) {
      const key = c.id != null ? c.id : `${c.cdate}|${c.duration}|${c.client_id ?? c.lead_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(c);
    }
  };

  for (let i = 0; i < newLeadIds.length; i += chunkSize) {
    const chunk = newLeadIds.slice(i, i + chunkSize);
    const { rows, error } = await fetchCallLogsPaged((q) => q.in('client_id', chunk), callFrom, callTo);
    if (error) return { rows: combined, error };
    appendUnique(rows);
  }

  for (let i = 0; i < legacyLeadNumericIds.length; i += chunkSize) {
    const chunk = legacyLeadNumericIds.slice(i, i + chunkSize);
    const { rows, error } = await fetchCallLogsPaged((q) => q.in('lead_id', chunk), callFrom, callTo);
    if (error) return { rows: combined, error };
    appendUnique(rows);
  }

  return { rows: combined, error: null };
}

function applyMarketingLeadFilters(
  rows: LeadRow[],
  opts: {
    fromDate: string;
    toDate: string;
    channelIds: string[];
    sourceIdsForSql: string[] | null;
    countryIds: string[];
    firmIds: string[];
    mainCategoryIds: string[];
    allSources: SourceRow[];
    countries: CountryRow[];
    firmIdToSourceIds: Map<string, string[]>;
    sourceIdToFirmIds: Map<string, string[]>;
  },
): LeadRow[] {
  const lookup = buildSourceLookupMaps(opts.allSources);
  return rows.filter((lead) => {
    if (!timestampInCalendarRange(lead.created_at, opts.fromDate, opts.toDate)) return false;
    if (!leadMatchesMainCategoryFilter(lead, opts.mainCategoryIds)) return false;
    if (opts.channelIds.length > 0) {
      const cid = leadChannelId(lead, lookup.sourceNameToRow, lookup.sourceIdToRow);
      if (!cid || !opts.channelIds.includes(cid)) return false;
    }
    if (
      opts.sourceIdsForSql != null &&
      opts.sourceIdsForSql.length > 0 &&
      !leadMatchesSourceFilter(
        lead,
        opts.sourceIdsForSql,
        opts.allSources,
        lookup.sourceNameToRow,
        lookup.sourceIdToRow,
      )
    ) {
      return false;
    }
    if (!leadMatchesCountryFilter(lead, opts.countryIds, opts.countries)) return false;
    if (
      !leadMatchesFirmFilter(
        lead,
        opts.firmIds,
        opts.firmIdToSourceIds,
        opts.sourceIdToFirmIds,
        opts.allSources,
        lookup.sourceNameToRow,
        lookup.sourceIdToRow,
      )
    ) {
      return false;
    }
    return true;
  });
}

function average(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Digits-only number from lead_number — fallback when call_logs.lead_id stores lead number digits. */
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
  const currency = lead.currency_id ?? lead.balance_currency ?? '₪';
  try {
    return convertToNIS(raw, currency);
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
  /** Denominator for Lead→Offer % and Lead→Deal % (excludes stage 91). */
  leadsExclStage91: number;
  /** Internal: stage-91 count (stripped before display). */
  stage91?: number;
  revenueNis: number;
  inactive: number;
  notEligible: number;
  mediaNis: number;
  managementNis: number;
  /** Internal aggregation helper (stripped before display). */
  _providerNames?: Set<string>;
  _sourceIds?: Set<string>;
  _firmIds?: Set<string>;
  /** One meeting count per lead id within this aggregate row. */
  _countedMeetingLeadIds?: Set<string>;
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

function macroPct(numerator: number, denominator: number): string {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(d) || d <= 0) return '—';
  return ((n / d) * 100).toFixed(1);
}

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
      return r.leadsExclStage91 > 0 ? r.offers / r.leadsExclStage91 : -1;
    case 'pctDeal':
      return r.leadsExclStage91 > 0 ? r.deals / r.leadsExclStage91 : -1;
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
  align = 'end',
}: {
  sortKey: MacroSortKey;
  activeKey: MacroSortKey;
  dir: 'asc' | 'desc';
  onSort: (k: MacroSortKey) => void;
  children: React.ReactNode;
  /** Accessible name for the sort control (column title). */
  sortLabel: string;
  className?: string;
  align?: 'start' | 'center' | 'end';
}) {
  const active = activeKey === sortKey;
  const nextToggle = active && dir === 'asc' ? 'descending' : 'ascending';
  const justifyClass =
    align === 'center' ? 'justify-center' : align === 'start' ? 'justify-start' : 'justify-end';
  return (
    <th scope="col" className={className} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className={`inline-flex w-full items-center gap-1 rounded-lg px-0.5 py-0.5 text-inherit hover:bg-base-200/60 hover:text-base-content/80 dark:hover:bg-base-content/10 ${justifyClass}`}
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
  'mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-base-content/55';

/** Filter column — full grid cell width so labels and placeholders are not truncated. */
const FILTER_COL_CLASS = 'w-full min-w-0';

/** Grey titles: card/section headings (h3) and table column headers (with global `.table th` override). */
const REPORT_SECTION_TITLE_CLASS = 'text-base-content/55';

const MARKETING_REPORT_INTRO = (
  <>
    Compare lead volume and funnel conversion by <strong>source</strong> or <strong>channel</strong> for leads
    created in the date range you choose (calendar dates in Asia/Jerusalem, same as Lead Search). The cohort
    includes new leads and legacy leads (including subleads). Use the filters, then click{' '}
    <strong>go</strong> to load results.
  </>
);

const MARKETING_REPORT_INTRO_DETAILS = (
  <>
    The macro table shows leads, eligible, meetings, offers, signed deals, revenue (NIS), inactive leads, and
    media/management cost columns. <strong>Meetings</strong> are active leads with at least one non-canceled
    meeting in the meetings table (one per lead); stage 21 (meeting rescheduling) is not counted.{' '}
    <strong>Offers</strong>, <strong>deals</strong>, and Lead→Offer / Lead→Deal % exclude stage 91 (dropped
    spam). Click a deals number to open the signed-deal list. Provider (firm) comes from source–firm links in
    Admin. Funnel timing uses stage history; sales behaviour uses scheduler-matched call logs for qualified
    leads before offer stage.
  </>
);
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
  wide = false,
}: {
  label: string;
  placeholder: string;
  options: MultiFilterOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Merged onto the search input (e.g. {@link ENGRAVED_FILTER_CONTROL_CLASSES}). */
  inputClassName?: string;
  /** Wider dropdown panel and full option labels (external reports). */
  wide?: boolean;
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
            className={`absolute left-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-xl border border-black/[0.08] bg-base-100 text-base shadow-[0_10px_28px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.85)] dark:border-white/[0.12] dark:bg-base-200 dark:shadow-[0_12px_32px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.06)] ${
              wide ? 'min-w-full w-max max-w-md overflow-x-visible' : 'right-0 overflow-x-hidden'
            }`}
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
                        <span className={wide ? 'whitespace-normal break-words' : 'truncate'}>{opt.label}</span>
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

async function fetchAllSourceFirmLinks(): Promise<
  {
    firm_id: string;
    source_id: number | string;
    firms: { name: string }[] | { name: string } | null;
  }[]
> {
  const combined: {
    firm_id: string;
    source_id: number | string;
    firms: { name: string }[] | { name: string } | null;
  }[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('sources_firms')
      .select('firm_id, source_id, firms ( name )')
      .range(offset, offset + 999);
    if (error) throw error;
    const batch = data || [];
    combined.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  return combined;
}

const GROUP_BY_TOGGLE_CLASS =
  'min-w-[7rem] cursor-pointer rounded-[0.65rem] px-4 py-2 text-sm font-bold tracking-tight transition-colors duration-200 ease-out outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0';

export type MarketingDashboardReportProps = {
  docsOpen?: boolean;
  onDocsOpenChange?: (open: boolean) => void;
  /** Staff (default) vs simplified external-firm view. */
  variant?: 'staff' | 'external';
  /** When variant=external, only these misc_leadsource ids are shown and queried. */
  lockedSourceIds?: string[];
};

const MarketingDashboardReport: React.FC<MarketingDashboardReportProps> = ({
  docsOpen: docsOpenProp,
  onDocsOpenChange,
  variant = 'staff',
  lockedSourceIds,
}) => {
  const isExternalVariant = variant === 'external';
  const lockedSourceIdSet = useMemo(
    () => new Set((lockedSourceIds ?? []).map((id) => String(id)).filter(Boolean)),
    [lockedSourceIds],
  );
  const macroSortAlign: 'center' | 'end' = 'center';
  const macroCellAlign = 'text-center';
  const macroLabelAlign = 'text-left';
  const macroLabelColClass = `macro-label-col ${macroLabelAlign} w-[7rem] max-w-[7rem] sm:w-[8rem] sm:max-w-[8rem] whitespace-normal break-words align-top leading-snug`;
  const macroTableClass = `${REPORT_TABLE_CLASS} table-fixed w-full min-w-0 border-0 bg-white [&_th]:whitespace-nowrap [&_th.macro-label-col]:whitespace-normal [&_th.macro-label-col]:break-words [&_td:not(.macro-label-col)]:whitespace-nowrap [&_th]:border-0 [&_td]:border-0 [&_thead_tr]:border-0 [&_tbody_tr]:border-0 [&_thead_tr]:bg-white [&_tbody_tr]:bg-white [&_th]:bg-white [&_td]:bg-white`;
  const filterColClass = FILTER_COL_CLASS;
  const macroTableScrollRef = useRef<HTMLDivElement | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [countryIds, setCountryIds] = useState<string[]>([]);
  const [firmIds, setFirmIds] = useState<string[]>([]);
  const [mainCategoryIds, setMainCategoryIds] = useState<string[]>([]);
  const [groupMode, setGroupMode] = useState<GroupMode>('source');
  const [macroSort, setMacroSort] = useState<{ key: MacroSortKey; dir: 'asc' | 'desc' }>({
    key: 'leads',
    dir: 'desc',
  });
  const [macroAtRightEdge, setMacroAtRightEdge] = useState(false);
  const [docsOpenLocal, setDocsOpenLocal] = useState(false);
  const docsControlled = onDocsOpenChange != null;
  const docsOpen = docsControlled ? Boolean(docsOpenProp) : docsOpenLocal;
  const setDocsOpen = (open: boolean) => {
    if (docsControlled) onDocsOpenChange(open);
    else setDocsOpenLocal(open);
  };

  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [allSources, setAllSources] = useState<SourceRow[]>([]);
  const [firms, setFirms] = useState<FirmRow[]>([]);
  /** firm ↔ sources from public.sources_firms (for provider filter + labels). */
  const [sourceFirmLinks, setSourceFirmLinks] = useState<
    { firm_id: string; source_id: string; firm_name: string }[]
  >([]);
  const [countries, setCountries] = useState<CountryRow[]>([]);
  const [mainCategories, setMainCategories] = useState<MainCategoryRow[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** history rows grouped by lead id (new UUID + legacy-* ids). */
  const [historyByLead, setHistoryByLead] = useState<Map<string, HistoryLeadRow[]>>(new Map());
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [callLogsRows, setCallLogsRows] = useState<CallLogRow[]>([]);
  const [callLogsError, setCallLogsError] = useState<string | null>(null);
  /** Lead ids in the report cohort with ≥1 non-canceled row in public.meetings. */
  const [leadIdsWithMeeting, setLeadIdsWithMeeting] = useState<Set<string>>(() => new Set());
  const [meetingsError, setMeetingsError] = useState<string | null>(null);
  const [schedulerDisplayNames, setSchedulerDisplayNames] = useState<Record<string, string>>({});
  const [employeeIdToPhotoUrl, setEmployeeIdToPhotoUrl] = useState<Record<string, string>>({});
  /** tenants_employee: normalized display_name → id (for leads.scheduler CTI match). */
  const [employeeDisplayNameToId, setEmployeeDisplayNameToId] = useState<Map<string, number>>(() => new Map());
  /** Sum of source_media_expense.amount per lead_source_id for months in the report date range. */
  const [mediaExpenseBySourceId, setMediaExpenseBySourceId] = useState<Record<string, number>>({});
  /** Sum of firm_management_costs.amount per firm_id for months in the report date range. */
  const [managementExpenseByFirmId, setManagementExpenseByFirmId] = useState<Record<string, number>>({});
  const [fetchTruncated, setFetchTruncated] = useState(false);
  const [leadBreakdownModal, setLeadBreakdownModal] = useState<{
    open: boolean;
    title: string;
    rows: MarketingLeadBreakdownRow[];
  }>({ open: false, title: '', rows: [] });

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

  const sourceIdToFirmIds = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of sourceFirmLinks) {
      const sid = String(r.source_id);
      const existing = m.get(sid) || [];
      if (!existing.includes(r.firm_id)) existing.push(r.firm_id);
      m.set(sid, existing);
    }
    return m;
  }, [sourceFirmLinks]);

  const loadReferenceData = useCallback(async () => {
    const [ch, src, fr, co, mc] = await Promise.all([
      // Load ALL channels so sources linked to inactive channels still resolve (avoid "Unassigned channel").
      // We’ll filter inactive channels out of the filter dropdown UI separately.
      supabase.from('channels').select('id, code, label, is_active').order('sort_order'),
      supabase.from('misc_leadsource').select('id, name, channel_id, active').order('name'),
      supabase.from('firms').select('id, name').eq('is_active', true).order('name'),
      supabase.from('misc_country').select('id, name, phone_code').order('name'),
      supabase.from('misc_maincategory').select('id, name').order('name'),
    ]);
    let sfRows: Awaited<ReturnType<typeof fetchAllSourceFirmLinks>> = [];
    try {
      sfRows = await fetchAllSourceFirmLinks();
    } catch (sfErr) {
      console.warn('sources_firms load (provider filter):', sfErr);
    }
    if (!ch.error && ch.data) {
      const next = ch.data as ChannelRow[];
      // Guard: never clobber a populated mapping with an empty set (can happen under RLS/policies on refetch).
      setChannels((prev) => (next.length > 0 ? next : prev));
    }
    if (!src.error && src.data) {
      const rawRows = src.data as { id: number | string; name: string; channel_id: string | null; active?: boolean }[];
      let rows = rawRows.map((r) => ({
        id: String(r.id),
        name: r.name,
        channel_id: r.channel_id,
      }));
      if (isExternalVariant && lockedSourceIdSet.size > 0) {
        rows = rows.filter((r) => lockedSourceIdSet.has(String(r.id)));
      }
      setAllSources(rows);
      setSources(rows.filter((r) => {
        const raw = rawRows.find((x) => String(x.id) === r.id);
        return raw?.active !== false;
      }));
    }
    if (!isExternalVariant && !fr.error && fr.data) setFirms(fr.data as FirmRow[]);
    if (!co.error && co.data) setCountries(co.data as CountryRow[]);
    if (!mc.error && mc.data) {
      setMainCategories(
        (mc.data as { id: number | string; name: string }[]).map((r) => ({
          id: String(r.id),
          name: r.name,
        })),
      );
    }
    if (sfRows.length > 0) {
      const rows = sfRows.map((r) => ({
        firm_id: r.firm_id,
        source_id: String(r.source_id),
        firm_name: (
          (Array.isArray(r.firms) ? r.firms[0]?.name : r.firms?.name) || ''
        ).trim() || '—',
      }));
      setSourceFirmLinks(rows);
    }
  }, [isExternalVariant, lockedSourceIdSet]);

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
    setFetchTruncated(false);
    try {
      const maxRows = 30000;
      const scopedSourceIds =
        isExternalVariant && lockedSourceIdSet.size > 0
          ? sourceIds.length > 0
            ? sourceIds.filter((id) => lockedSourceIdSet.has(String(id)))
            : Array.from(lockedSourceIdSet)
          : sourceIds;
      const scopedFirmIds = isExternalVariant ? [] : firmIds;
      const effectiveSourceIds = resolveEffectiveSourceIdsForFetch(
        scopedSourceIds,
        channelIds,
        scopedFirmIds,
        allSources,
        firmIdToSourceIds,
      );
      const sourceIdsForSql = isFirmOnlyReportScope(scopedSourceIds, channelIds, scopedFirmIds)
        ? null
        : effectiveSourceIds;

      let legacyContactCountryIds = new Map<string, number>();
      if (countryIds.length > 0) {
        try {
          legacyContactCountryIds = await fetchLegacyLeadMainContactCountryIds();
        } catch (e) {
          console.warn('lead_leadcontact country lookup:', e);
        }
      }

      const [{ rows: newLeadRows, truncated: newTruncated }, legacyLeadRowsRaw] = await Promise.all([
        fetchPaginatedNewLeads(fromDate, toDate, maxRows, allSources, sourceIdsForSql),
        fetchLegacyLeadRows(fromDate, toDate, maxRows, allSources, sourceIdsForSql),
      ]);

      const legacyLeadRows = legacyLeadRowsRaw.map((lead) => {
        const numericId = legacyLeadNumericId(lead);
        if (numericId == null) return lead;
        const contactCountryId = legacyContactCountryIds.get(String(numericId));
        if (contactCountryId == null) return lead;
        return { ...lead, country_id: contactCountryId };
      });

      let rows = applyMarketingLeadFilters([...newLeadRows, ...legacyLeadRows], {
        fromDate,
        toDate,
        channelIds,
        sourceIdsForSql,
        countryIds,
        firmIds: scopedFirmIds,
        mainCategoryIds,
        allSources,
        countries,
        firmIdToSourceIds,
        sourceIdToFirmIds,
      });

      setFetchTruncated(newTruncated || legacyLeadRows.length >= maxRows);

      const lookup = buildSourceLookupMaps(allSources);
      const resolveSourceRow = (l: LeadRow) =>
        resolveLeadSourceRow(l, lookup.sourceNameToRow, lookup.sourceIdToRow);

      // Debug: what do leads say for source_id "39"?
      if (import.meta.env.DEV) {
        const TARGET_SOURCE_ID = '39';
        const TARGET_SOURCE_NAME = 'PPC World GER-AUS';
        const combined = rows;
        const bySourceId = combined.filter((l) => String(l.source_id ?? '') === TARGET_SOURCE_ID);
        const byEmbeddedSourceId = combined.filter(
          (l) => String(l.misc_leadsource?.id ?? '') === TARGET_SOURCE_ID
        );
        const bySourceTextOnly = combined.filter((l) => {
          const txt = String(l.source || '').trim().toLowerCase();
          return (l.source_id == null || String(l.source_id) === '') && txt === TARGET_SOURCE_NAME.toLowerCase();
        });

        const summarize = (debugRows: LeadRow[]) => ({
          count: debugRows.length,
          distinctEmbeddedChannelIds: Array.from(
            new Set(debugRows.map((l) => String(l.misc_leadsource?.channel_id ?? 'null')))
          ),
          sample: debugRows[0]
            ? {
                id: debugRows[0].id,
                created_at: debugRows[0].created_at,
                source_id: debugRows[0].source_id,
                source: debugRows[0].source,
                misc_leadsource: debugRows[0].misc_leadsource ?? null,
              }
            : null,
        });

        // eslint-disable-next-line no-console
        console.log('[MarketingDashboardReport][debug] source 39 lead matching', {
          dateRange: { fromDate, toDate },
          combinedCount: combined.length,
          newLeadCount: newLeadRows.length,
          legacyLeadCount: legacyLeadRows.length,
          bySourceId: summarize(bySourceId),
          byEmbeddedSourceId: summarize(byEmbeddedSourceId),
          bySourceTextOnly: summarize(bySourceTextOnly),
        });
      }

      setLeads(rows);
      if (!isExternalVariant) {
        const [mediaBySource, managementByFirm] = await Promise.all([
          fetchMediaExpensesBySource(fromDate, toDate),
          fetchManagementExpensesByFirm(fromDate, toDate),
        ]);
        setMediaExpenseBySourceId(mediaBySource);
        setManagementExpenseByFirmId(managementByFirm);
      } else {
        setMediaExpenseBySourceId({});
        setManagementExpenseByFirmId({});
      }

      setCallLogsError(null);
      setCallLogsRows([]);
      setMeetingsError(null);
      setLeadIdsWithMeeting(new Set());
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

      const newLeadIds = rows.filter((r) => !isLegacyLeadId(r.id)).map((r) => r.id).filter(Boolean);
      const legacyLeadNumericIds = rows
        .map((r) => legacyLeadNumericId(r))
        .filter((n): n is number => n != null);

      if (newLeadIds.length > 0 || legacyLeadNumericIds.length > 0) {
        let callFrom =
          fromDate != null && fromDate !== ''
            ? buildJerusalemStartOfDayIso(fromDate)
            : rows.length > 0
              ? new Date(Math.min(...rows.map((r) => new Date(r.created_at).getTime()))).toISOString()
              : undefined;
        let callTo =
          toDate != null && toDate !== ''
            ? buildJerusalemEndOfDayIso(toDate)
            : rows.length > 0
              ? new Date(Math.max(...rows.map((r) => new Date(r.created_at).getTime()))).toISOString()
              : undefined;
        if (callFrom && callTo && new Date(callFrom) > new Date(callTo)) {
          const t = callFrom;
          callFrom = callTo;
          callTo = t;
        }
        const [{ rows: callRows, error: cErr }, { leadIds: meetingLeadIds, error: mErr }] =
          await Promise.all([
            fetchCallLogsForCohort(newLeadIds, legacyLeadNumericIds, callFrom, callTo),
            fetchLeadIdsWithMeetingsFromTable(newLeadIds, legacyLeadNumericIds),
          ]);
        if (cErr) {
          setCallLogsError(cErr);
        } else {
          setCallLogsRows(callRows);
        }
        if (mErr) {
          setMeetingsError(mErr);
        } else {
          setLeadIdsWithMeeting(meetingLeadIds);
        }
      }

      setHistoryError(null);
      setHistoryByLead(new Map());

      const loadHistoryChunk = async (
        table: 'history_leads' | 'history_leads_lead',
        ids: string[],
        selectFields: string,
      ) => {
        const combined: HistoryLeadRow[] = [];
        let histErr: string | null = null;
        const chunkSize = 100;
        for (let i = 0; i < ids.length; i += chunkSize) {
          const chunk = ids.slice(i, i + chunkSize);
          let offset = 0;
          for (;;) {
            const { data: hist, error: hError } = await supabase
              .from(table)
              .select(selectFields)
              .in('original_id', chunk)
              .order('changed_at', { ascending: true })
              .range(offset, offset + 999);
            if (hError) {
              histErr = hError.message;
              console.warn(`${table}:`, hError);
              break;
            }
            const batch = (hist || []) as unknown as HistoryLeadRow[];
            combined.push(...batch);
            if (batch.length < 1000) break;
            offset += 1000;
          }
          if (histErr) break;
        }
        return { combined, histErr };
      };

      if (newLeadIds.length > 0 || legacyLeadNumericIds.length > 0) {
        const [newHist, legacyHist] = await Promise.all([
          newLeadIds.length > 0
            ? loadHistoryChunk(
                'history_leads',
                newLeadIds,
                'original_id, stage, changed_at, communication_started_at',
              )
            : Promise.resolve({ combined: [] as HistoryLeadRow[], histErr: null }),
          legacyLeadNumericIds.length > 0
            ? loadHistoryChunk(
                'history_leads_lead',
                legacyLeadNumericIds.map(String),
                'original_id, stage, changed_at',
              )
            : Promise.resolve({ combined: [] as HistoryLeadRow[], histErr: null }),
        ]);

        const histErr = newHist.histErr || legacyHist.histErr;
        if (histErr) {
          setHistoryError(histErr);
        } else {
          const map = new Map<string, HistoryLeadRow[]>();
          for (const h of newHist.combined) {
            const oid = String(h.original_id);
            if (!map.has(oid)) map.set(oid, []);
            map.get(oid)!.push(h);
          }
          for (const h of legacyHist.combined) {
            const oid = `legacy-${h.original_id}`;
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
      setMediaExpenseBySourceId({});
      setManagementExpenseByFirmId({});
      setFetchTruncated(false);
      setHistoryByLead(new Map());
      setHistoryError(null);
      setCallLogsRows([]);
      setCallLogsError(null);
      setLeadIdsWithMeeting(new Set());
      setMeetingsError(null);
      setSchedulerDisplayNames({});
      setEmployeeDisplayNameToId(new Map());
      setFetchTruncated(false);
    } finally {
      setLoading(false);
    }
  }, [
    fromDate,
    toDate,
    channelIds,
    sourceIds,
    countryIds,
    firmIds,
    mainCategoryIds,
    firmIdToSourceIds,
    sourceIdToFirmIds,
    allSources,
    countries,
    isExternalVariant,
    lockedSourceIdSet,
  ]);

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'source_media_expense' }, scheduleReportRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'firm_management_costs' }, scheduleReportRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, scheduleReportRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads_lead' }, scheduleReportRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings' }, scheduleReportRefresh)
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
    const lookup = buildSourceLookupMaps(allSources);

    const resolveSourceRow = (l: LeadRow): SourceRow | null =>
      resolveLeadSourceRow(l, lookup.sourceNameToRow, lookup.sourceIdToRow);

    const channelLabel = (cid: string | null | undefined) => {
      if (!cid) return '—';
      const c = channels.find((x) => x.id === cid);
      if (!c) return 'Unknown channel';
      const base = c.label || c.code || 'Channel';
      return c.is_active ? base : `${base} (inactive)`;
    };

    const getChannelLabel = (l: LeadRow) =>
      channelLabel(leadChannelId(l, lookup.sourceNameToRow, lookup.sourceIdToRow));
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
          leadsExclStage91: 0,
          stage91: 0,
          revenueNis: 0,
          inactive: 0,
          notEligible: 0,
          mediaNis: 0,
          managementNis: 0,
          _providerNames: new Set<string>(),
          _sourceIds: new Set<string>(),
          _firmIds: new Set<string>(),
          _countedMeetingLeadIds: new Set<string>(),
        });
      }
      const row = map.get(key)!;
      const srcRow = resolveSourceRow(l);
      const trackSourceId = (sourceId: string) => {
        row._sourceIds!.add(sourceId);
        for (const firmId of sourceIdToFirmIds.get(sourceId) || []) {
          row._firmIds!.add(firmId);
        }
      };
      if (srcRow?.id) trackSourceId(String(srcRow.id));
      else if (l.source_id != null && String(l.source_id).trim() !== '') {
        trackSourceId(String(l.source_id));
      }
      const firmSourceId = srcRow?.id ?? (l.source_id != null ? String(l.source_id) : null);
      if (firmSourceId) {
        const pname = sourceIdToFirmName.get(String(firmSourceId));
        if (pname && row._providerNames) row._providerNames.add(pname);
      }
      row.leads += 1;
      if (isMarketingStage91(l)) row.stage91 = (row.stage91 ?? 0) + 1;
      if (isInactiveLead(l)) row.inactive += 1;
      if (isEligibleLead(l)) row.eligible += 1;
      else row.notEligible += 1;
      if (
        leadCountsAsMarketingMeeting(l, leadIdsWithMeeting) &&
        !row._countedMeetingLeadIds!.has(l.id)
      ) {
        row._countedMeetingLeadIds!.add(l.id);
        row.meetings += 1;
      }
      if (hasOfferOrBeyond(l)) row.offers += 1;
      if (hasSignedDeal(l)) {
        row.deals += 1;
        row.revenueNis += leadRevenueNis(l);
      }
    }

    // Firm filter: show every source linked to the selected firm(s), even with 0 leads in range.
    if (firmIds.length > 0 && groupMode === 'source') {
      const linkedSourceIds = new Set<string>();
      for (const firmId of firmIds) {
        for (const sid of firmIdToSourceIds.get(firmId) || []) {
          linkedSourceIds.add(String(sid));
        }
      }
      for (const sid of linkedSourceIds) {
        const srcRow = lookup.sourceIdToRow.get(sid);
        const channel = channelLabel(srcRow?.channel_id ?? null);
        const source = srcRow?.name || `Source #${sid}`;
        const key = `${channel}|||${source}`;
        if (map.has(key)) continue;
        const providerName = sourceIdToFirmName.get(sid) || '—';
        map.set(key, {
          key,
          channel,
          source,
          provider: '—',
          leads: 0,
          eligible: 0,
          meetings: 0,
          offers: 0,
          deals: 0,
          leadsExclStage91: 0,
          stage91: 0,
          revenueNis: 0,
          inactive: 0,
          notEligible: 0,
          mediaNis: 0,
          managementNis: 0,
          _providerNames: new Set(providerName !== '—' ? [providerName] : []),
          _sourceIds: new Set([sid]),
          _firmIds: new Set(sourceIdToFirmIds.get(sid) || []),
          _countedMeetingLeadIds: new Set<string>(),
        });
      }
    }

    return Array.from(map.values()).map((r) => {
      const names = r._providerNames;
      let provider = '—';
      if (names && names.size === 1) provider = [...names][0];
      else if (names && names.size > 1) provider = 'Multiple providers';
      const mediaNis = [...(r._sourceIds || [])].reduce(
        (sum, sourceId) => sum + (mediaExpenseBySourceId[sourceId] || 0),
        0,
      );
      const managementNis = [...(r._firmIds || [])].reduce(
        (sum, firmId) => sum + (managementExpenseByFirmId[firmId] || 0),
        0,
      );
      const stage91 = r.stage91 ?? 0;
      const leadsExclStage91 = Math.max(0, r.leads - stage91);
      const {
        _providerNames,
        _sourceIds,
        _firmIds,
        _countedMeetingLeadIds: _mtgIds,
        stage91: _s91,
        ...rest
      } = r;
      return { ...rest, provider, mediaNis, managementNis, leadsExclStage91 };
    });
  }, [leads, leadIdsWithMeeting, groupMode, channels, firmIds, firmIdToSourceIds, sourceIdToFirmName, sourceIdToFirmIds, mediaExpenseBySourceId, managementExpenseByFirmId, allSources]);

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

  const openDealsBreakdown = useCallback(
    (agg: AggRow) => {
      if (agg.deals <= 0) return;
      const rows = filterLeadsForMarketingBreakdown({
        leads,
        agg: { key: agg.key, channel: agg.channel, source: agg.source },
        groupMode,
        channels,
        allSources,
        metric: 'deals',
      });
      setLeadBreakdownModal({
        open: true,
        title: buildDealsBreakdownTitle(
          { key: agg.key, channel: agg.channel, source: agg.source },
          groupMode,
        ),
        rows,
      });
    },
    [leads, groupMode, channels, allSources],
  );

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
   * Calls linked via call_logs.client_id; attributed to the lead's scheduler for aggregation.
   */
  const salesBehaviourStats = useMemo(() => {
    const qualified = leads.filter((l) => !isInactiveLead(l) && stageRank(l) < 45);
    const callsByClientId = new Map<string, CallLogRow[]>();
    const callsByLeadNumberId = new Map<number, CallLogRow[]>();
    for (const c of callLogsRows) {
      if (c.client_id) {
        const k = String(c.client_id);
        if (!callsByClientId.has(k)) callsByClientId.set(k, []);
        callsByClientId.get(k)!.push(c);
      }
      if (c.lead_id != null && !Number.isNaN(Number(c.lead_id))) {
        const n = Number(c.lead_id);
        if (!callsByLeadNumberId.has(n)) callsByLeadNumberId.set(n, []);
        callsByLeadNumberId.get(n)!.push(c);
      }
    }
    const bySched = new Map<number, { sec: number; n: number; answered: number; missed: number }>();
    let totalSec = 0;
    let totalN = 0;
    let totalAnswered = 0;
    let totalMissed = 0;
    const seenCallIds = new Set<number | string>();
    for (const lead of qualified) {
      const schedEmpId = resolveSchedulerEmployeeId(lead, employeeDisplayNameToId);
      if (schedEmpId == null) continue;
      const legacyId = legacyLeadNumericId(lead);
      const leadNumId = leadNumberAsCallLeadId(lead);
      const fromClient = legacyId == null ? callsByClientId.get(String(lead.id)) || [] : [];
      const fromLegacy =
        legacyId != null
          ? [
              ...(callsByLeadNumberId.get(legacyId) || []),
              ...(leadNumId != null && leadNumId !== legacyId
                ? callsByLeadNumberId.get(leadNumId) || []
                : []),
            ]
          : [];
      const fromNum = legacyId == null && leadNumId != null ? callsByLeadNumberId.get(leadNumId) || [] : [];
      for (const c of [...fromClient, ...fromLegacy, ...fromNum]) {
        const cid = c.id != null ? c.id : `${c.cdate}|${c.duration}|${c.client_id ?? c.lead_id}`;
        if (seenCallIds.has(cid)) continue;
        seenCallIds.add(cid);
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
    <div className={`${isExternalVariant ? 'space-y-8' : 'space-y-4'} pb-12 relative w-full min-w-0 max-w-full ${isExternalVariant ? 'bg-white' : ''}`}>
      {loading && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-3">
            <span className="loading loading-spinner w-16 h-16 text-primary" />
            <div className="text-sm font-semibold text-base-content/70">Running report…</div>
          </div>
        </div>
      )}
      {docsOpen && !isExternalVariant && (
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
            <div className="space-y-4 text-sm leading-relaxed text-base-content/80">
              <p>{MARKETING_REPORT_INTRO}</p>
              <p>{MARKETING_REPORT_INTRO_DETAILS}</p>
              <p className="text-base-content/60">
                Media and management costs use Admin marketing expenses and firm management costs for calendar
                months overlapping your date range. Large cohorts may stop at 30,000 leads—narrow dates or filters if
                you see a truncation warning.
              </p>
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

      <div className={`flex w-full flex-col items-start ${isExternalVariant ? 'gap-6' : 'gap-3'}`}>
        <div className={`flex flex-wrap items-end ${isExternalVariant ? 'gap-3 sm:gap-4' : 'gap-2 sm:gap-3'}`}>
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
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
                className={`${GROUP_BY_TOGGLE_CLASS} ${
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
                className={`${GROUP_BY_TOGGLE_CLASS} ${
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
          <button
            type="button"
            className="btn btn-circle h-12 w-12 min-h-12 shrink-0 rounded-full border-0 bg-black text-sm font-bold lowercase tracking-tight text-white shadow-sm hover:bg-neutral-800 disabled:opacity-50"
            onClick={() => void runReport()}
            disabled={loading}
            aria-label="Run report"
          >
            {loading ? <span className="loading loading-spinner loading-sm text-white" /> : 'go'}
          </button>
        </div>
        <div
          className={
            isExternalVariant
              ? 'grid w-full grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-3 lg:grid-cols-3'
              : 'grid w-full grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-3 lg:grid-cols-4'
          }
        >
          <label className={`form-control ${filterColClass}`}>
            <span className={FILTER_FIELD_LABEL_CLASS}>From</span>
            <input
              type="date"
              className={`input input-md min-h-12 w-full text-base ${ENGRAVED_FILTER_CONTROL_CLASSES}`}
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </label>
          <label className={`form-control ${filterColClass}`}>
            <span className={FILTER_FIELD_LABEL_CLASS}>To</span>
            <input
              type="date"
              className={`input input-md min-h-12 w-full text-base ${ENGRAVED_FILTER_CONTROL_CLASSES}`}
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>
          <div className={filterColClass}>
            <MarketingSearchMultiFilter
              label="Main category"
              placeholder="Search main categories…"
              options={mainCategories.map((c) => ({ id: c.id, label: c.name }))}
              selected={mainCategoryIds}
              onChange={setMainCategoryIds}
              inputClassName={ENGRAVED_FILTER_CONTROL_CLASSES}
              wide
            />
          </div>
          <div className={filterColClass}>
            <MarketingSearchMultiFilter
              label="Channel"
              placeholder="Search channels…"
              options={channels.filter((c) => c.is_active).map((c) => ({ id: c.id, label: c.label }))}
              selected={channelIds}
              onChange={setChannelIds}
              inputClassName={ENGRAVED_FILTER_CONTROL_CLASSES}
              wide
            />
          </div>
          <div className={filterColClass}>
            <MarketingSearchMultiFilter
              label="Source"
              placeholder="Search sources…"
              options={sources.map((s) => ({ id: String(s.id), label: s.name }))}
              selected={sourceIds}
              onChange={setSourceIds}
              inputClassName={ENGRAVED_FILTER_CONTROL_CLASSES}
              wide
            />
          </div>
          {!isExternalVariant && (
            <div className={filterColClass}>
              <MarketingSearchMultiFilter
                label="Provider (firm)"
                placeholder="Search firms…"
                options={firms.map((f) => ({ id: f.id, label: f.name }))}
                selected={firmIds}
                onChange={setFirmIds}
                inputClassName={ENGRAVED_FILTER_CONTROL_CLASSES}
                wide
              />
            </div>
          )}
          <div className={filterColClass}>
            <MarketingSearchMultiFilter
              label="Country"
              placeholder="Search countries…"
              options={countries.map((c) => ({ id: String(c.id), label: c.name }))}
              selected={countryIds}
              onChange={setCountryIds}
              inputClassName={ENGRAVED_FILTER_CONTROL_CLASSES}
              wide
            />
          </div>
        </div>
      </div>

      {loadError && (
        <div className="alert alert-error text-sm">
          <span>{loadError}</span>
        </div>
      )}

      {meetingsError && !loadError && (
        <div className="alert alert-warning text-sm">
          <span>Meetings could not be loaded: {meetingsError} (check RLS / meetings table access).</span>
        </div>
      )}

      {fetchTruncated && !loadError && (
        <div className="alert alert-warning text-sm">
          <span>
            Results may be incomplete: the report stopped at 30,000 leads per table. Narrow the date range or filters.
          </span>
        </div>
      )}

      {searched && !loading && (
        <>
          {!isExternalVariant && (
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
          )}

          {/* Main macro table */}
          <div
            id="marketing-kpi-macro"
            ref={macroTableScrollRef}
            className="scroll-mt-24 w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain bg-white"
            onScroll={(e) => {
              const el = e.currentTarget;
              const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
              const nearRight = el.scrollLeft >= maxLeft - 2;
              setMacroAtRightEdge(nearRight);
            }}
          >
            <h3 className="mb-5 text-base font-bold text-base-content">
              Macro performance (by {groupMode})
            </h3>
            <table className={macroTableClass}>
              <thead>
                <tr className="border-b border-base-300 bg-base-100 text-[11px] uppercase tracking-wide">
                  <th
                    colSpan={(groupMode === 'source' ? 2 : 1) + (isExternalVariant ? 0 : 1)}
                    className="text-center text-base-content/50"
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
                  {!isExternalVariant && (
                    <th
                      colSpan={4}
                      className="text-center text-base-content/60"
                      style={{ letterSpacing: '0.08em' }}
                    >
                      Cost
                    </th>
                  )}
                </tr>
                <tr className="border-b border-base-300 bg-base-100 text-xs uppercase md:text-sm">
                  <th scope="col" className="text-center">Channel</th>
                  {groupMode === 'source' && (
                    <th scope="col" className={macroLabelColClass}>Source</th>
                  )}
                  {!isExternalVariant && <th scope="col" className={macroLabelColClass}>Provider</th>}
                  <MacroSortableTh
                    sortKey="leads"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Leads"
                    align={macroSortAlign}
                    className={macroCellAlign}
                  >
                    Leads
                  </MacroSortableTh>
                  <MacroSortableTh
                    sortKey="eligible"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Eligible"
                    align={macroSortAlign}
                    className={macroCellAlign}
                  >
                    Eligible
                  </MacroSortableTh>
                  <MacroSortableTh
                    sortKey="meetings"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Meetings"
                    align={macroSortAlign}
                    className={macroCellAlign}
                  >
                    Meetings
                  </MacroSortableTh>
                  <MacroSortableTh
                    sortKey="offers"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Offers"
                    align={macroSortAlign}
                    className={macroCellAlign}
                  >
                    Offers
                  </MacroSortableTh>
                  <MacroSortableTh
                    sortKey="deals"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Deals"
                    align={macroSortAlign}
                    className={macroCellAlign}
                  >
                    Deals
                  </MacroSortableTh>
                  <MacroSortableTh
                    sortKey="pctElig"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Lead to eligible percent"
                    align={macroSortAlign}
                    className={macroCellAlign}
                  >
                    Lead→Elig %
                  </MacroSortableTh>
                  <MacroSortableTh
                    sortKey="pctMtg"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Lead to meeting percent"
                    align={macroSortAlign}
                    className={macroCellAlign}
                  >
                    Lead→Mtg %
                  </MacroSortableTh>
                  <MacroSortableTh
                    sortKey="pctOffer"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Lead to offer percent"
                    align={macroSortAlign}
                    className={macroCellAlign}
                  >
                    Lead→Offer %
                  </MacroSortableTh>
                  <MacroSortableTh
                    sortKey="pctDeal"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Lead to deal percent"
                    align={macroSortAlign}
                    className={macroCellAlign}
                  >
                    Lead→Deal %
                  </MacroSortableTh>
                  <MacroSortableTh
                    sortKey="revenue"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Revenue NIS"
                    align={macroSortAlign}
                    className={macroCellAlign}
                  >
                    Revenue
                  </MacroSortableTh>
                  <MacroSortableTh
                    sortKey="inactive"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Inactive"
                    align={macroSortAlign}
                    className={macroCellAlign}
                  >
                    Inactive
                  </MacroSortableTh>
                  {!isExternalVariant && (
                    <>
                      <th className="text-center">Media</th>
                      <th className="text-center">Management</th>
                      <th className="text-center">Total</th>
                      <th className="text-center">% leads</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {sortedAggregates.map((r) => {
                  const pctLeads = totals.leads ? ((r.leads / totals.leads) * 100).toFixed(1) : '0.0';
                  const offerDealDenom = r.leadsExclStage91;
                  const totalCostNis = r.mediaNis + r.managementNis;
                  return (
                    <tr key={r.key}>
                      <td className={`whitespace-nowrap ${macroCellAlign}`}>
                        <div className="flex justify-center">
                          <ChannelLabel
                            label={r.channel}
                            seed={r.channel}
                            inactive={r.channel.toLowerCase().includes('(inactive)')}
                          />
                        </div>
                      </td>
                      {groupMode === 'source' && (
                        <td className={macroLabelColClass}>
                          {r.source}
                        </td>
                      )}
                      {!isExternalVariant && <td className={`text-base-content/50 ${macroLabelColClass}`}>{r.provider}</td>}
                      <td className={macroCellAlign}>{r.leads}</td>
                      <td className={macroCellAlign}>{r.eligible}</td>
                      <td className={macroCellAlign}>{r.meetings}</td>
                      <td className={macroCellAlign}>{r.offers}</td>
                      <td className={macroCellAlign}>
                        {r.deals > 0 ? (
                          <button
                            type="button"
                            className="inline border-0 bg-transparent p-0 text-inherit text-sm md:text-base font-normal leading-normal cursor-pointer rounded-sm hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-base-content/30"
                            onClick={() => openDealsBreakdown(r)}
                            title="View signed deals for this row"
                          >
                            {r.deals}
                          </button>
                        ) : (
                          r.deals
                        )}
                      </td>
                      <td className={macroCellAlign}>{macroPct(r.eligible, r.leads)}</td>
                      <td className={macroCellAlign}>{macroPct(r.meetings, r.leads)}</td>
                      <td className={macroCellAlign}>{macroPct(r.offers, offerDealDenom)}</td>
                      <td className={macroCellAlign}>{macroPct(r.deals, offerDealDenom)}</td>
                      <td className={`${macroCellAlign} text-sm font-semibold`}>{fmtMoney(r.revenueNis)}</td>
                      <td className={macroCellAlign}>{r.inactive}</td>
                      {!isExternalVariant && (
                        <>
                          <td className={macroCellAlign}>{r.mediaNis > 0 ? fmtMoney(r.mediaNis) : '—'}</td>
                          <td className={macroCellAlign}>{r.managementNis > 0 ? fmtMoney(r.managementNis) : '—'}</td>
                          <td className={macroCellAlign}>{totalCostNis > 0 ? fmtMoney(totalCostNis) : '—'}</td>
                          <td className={macroCellAlign}>{pctLeads}%</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Quick horizontal navigation for the macro table */}
          {!isExternalVariant && (
          <button
            type="button"
            onClick={() => {
              const el = macroTableScrollRef.current;
              if (!el) return;
              const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
              const nextLeft = macroAtRightEdge ? 0 : maxLeft;
              el.scrollTo({ left: nextLeft, behavior: 'smooth' });
            }}
            className="fixed bottom-5 right-3 z-[80] h-10 w-10 rounded-full border border-white/10 bg-black/35 text-white shadow-xl backdrop-blur-xl transition hover:bg-black/55 focus:outline-none"
            aria-label={macroAtRightEdge ? 'Scroll macro table to start' : 'Scroll macro table to end'}
            title={macroAtRightEdge ? 'Scroll to start' : 'Scroll to end'}
          >
            <span className="text-xl leading-none">{macroAtRightEdge ? '←' : '→'}</span>
          </button>
          )}

          {/* Funnel chart */}
          <div
            id="marketing-kpi-funnel"
            className={`scroll-mt-24 ${isExternalVariant ? 'pt-2' : ''}`}
          >
            <h3 className={`${isExternalVariant ? 'mb-4' : 'mb-2'} text-base font-bold ${REPORT_SECTION_TITLE_CLASS}`}>Funnel snapshot</h3>
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

          {!isExternalVariant && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div
              id="marketing-kpi-timing"
              className="scroll-mt-24"
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
              className="scroll-mt-24"
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
                      <code className="text-xs">client_id</code>).
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
          )}

          {/* Cost breakdown table removed — columns moved into Macro table above. */}
        </>
      )}

      {!searched && (
        <div className="rounded-2xl border border-dashed border-base-300/70 bg-base-200/25 px-4 py-10 text-center dark:border-base-content/15 dark:bg-base-300/10">
          <p className="text-base leading-relaxed text-base-content/55">
            Set your filters above, then click <span className="font-semibold text-base-content/75">go</span> to
            load results.
          </p>
        </div>
      )}

      <MarketingDashboardLeadBreakdownModal
        isOpen={leadBreakdownModal.open}
        onClose={() => setLeadBreakdownModal((prev) => ({ ...prev, open: false }))}
        title={leadBreakdownModal.title}
        rows={leadBreakdownModal.rows}
        formatMoney={fmtMoney}
      />
    </div>
  );
};

export default MarketingDashboardReport;
