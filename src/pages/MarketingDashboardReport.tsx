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
import { fetchMiscLeadsourcesByIds } from '../lib/externalUserSources';
import { leadSourceIdToString } from '../lib/leadSourceId';
import {
  fetchStage60RecordsInRange,
  resolveStage60SignTimestamp,
} from '../lib/stage60SignDate';
import {
  fetchAllRowsForLeadIds,
  isExpenseInstallmentRow,
  resolveLegacyPaymentCurrency,
} from '../lib/invoicedInstallments';
import { isPaymentPlanInvoiceSent } from '../lib/markPaymentPlanInvoiceSent';
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
  DocumentTextIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { ChartBar, Search } from 'lucide-react';

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
  /** Stage-60 Client signed agreement timestamp (when loaded for signed-in-range deals). */
  signed_at?: string | null;
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

const NEW_LEAD_MARKETING_SELECT = `
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
  `;

const LEGACY_LEAD_MARKETING_SELECT = `
    *,
    misc_leadsource!leads_lead_source_id_fkey(id, name, channel_id),
    misc_category!leads_lead_category_id_fkey ( name, parent_id, misc_maincategory!parent_id ( id, name ) ),
    scheduler_employee:tenants_employee!fk_leads_lead_meeting_scheduler_id(id, display_name),
    accounting_currencies!leads_lead_currency_id_fkey(id, name, iso_code)
  `;

/** Load lead rows by id (new UUID + legacy numeric) for marketing deal attribution. */
async function fetchMarketingLeadsByIds(
  newLeadIds: string[],
  legacyLeadNumericIds: number[],
): Promise<LeadRow[]> {
  const combined: LeadRow[] = [];
  const chunkSize = 100;

  for (let i = 0; i < newLeadIds.length; i += chunkSize) {
    const chunk = newLeadIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('leads')
      .select(NEW_LEAD_MARKETING_SELECT)
      .in('id', chunk);
    if (error) throw error;
    combined.push(...((data || []) as unknown as LeadRow[]).map(enrichLeadCategoryName));
  }

  for (let i = 0; i < legacyLeadNumericIds.length; i += chunkSize) {
    const chunk = legacyLeadNumericIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('leads_lead')
      .select(LEGACY_LEAD_MARKETING_SELECT)
      .in('id', chunk);
    if (error) throw error;
    for (const raw of (data || []) as Record<string, unknown>[]) {
      combined.push(mapLegacyLeadToRow(raw));
    }
  }

  return combined;
}

/**
 * Leads that hit Client signed agreement (stage 60) with sign date in range
 * (same calendar logic as Signed Sales / Dashboard). Caller applies marketing filters
 * without created_at — deals are attributed by sign date, not lead creation.
 */
async function fetchSignedDealLeadRowsInRange(fromDate: string, toDate: string): Promise<LeadRow[]> {
  if (!fromDate && !toDate) return [];
  const stageRows = await fetchStage60RecordsInRange(fromDate || undefined, toDate || undefined);
  const newIds: string[] = [];
  const legacyIds: number[] = [];
  const seen = new Set<string>();
  const signedAtByLeadId = new Map<string, string>();
  for (const r of stageRows) {
    const ts = resolveStage60SignTimestamp(r);
    if (r.newlead_id) {
      const id = String(r.newlead_id);
      if (ts) {
        const prev = signedAtByLeadId.get(id);
        if (!prev || ts > prev) signedAtByLeadId.set(id, ts);
      }
      if (seen.has(id)) continue;
      seen.add(id);
      newIds.push(id);
    } else if (r.lead_id != null && Number.isFinite(Number(r.lead_id))) {
      const id = `legacy-${r.lead_id}`;
      if (ts) {
        const prev = signedAtByLeadId.get(id);
        if (!prev || ts > prev) signedAtByLeadId.set(id, ts);
      }
      if (seen.has(id)) continue;
      seen.add(id);
      legacyIds.push(Number(r.lead_id));
    }
  }
  if (newIds.length === 0 && legacyIds.length === 0) return [];
  const leads = await fetchMarketingLeadsByIds(newIds, legacyIds);
  return leads.map((l) => ({
    ...l,
    signed_at: signedAtByLeadId.get(l.id) ?? null,
  }));
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
    /** When false, skip created_at range (used for deals signed in range). Default true. */
    requireCreatedInRange?: boolean;
  },
): LeadRow[] {
  const lookup = buildSourceLookupMaps(opts.allSources);
  const requireCreatedInRange = opts.requireCreatedInRange !== false;
  return rows.filter((lead) => {
    if (requireCreatedInRange && !timestampInCalendarRange(lead.created_at, opts.fromDate, opts.toDate)) {
      return false;
    }
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

const MARKETING_INVOICE_SENT_OR =
  'invoice_sent.eq.true,invoice_sent_at.not.is.null,invoice_send_automation_sent_at.not.is.null';

function paymentAmountToNis(value: unknown, currency: unknown): number {
  const raw = Number(value ?? 0);
  if (!raw || !Number.isFinite(raw)) return 0;
  try {
    return convertToNIS(raw, currency ?? '₪');
  } catch {
    return raw;
  }
}

/**
 * Sum of invoiced payment-plan installments (ex-VAT `value`, expenses excluded) per signed-deal lead.
 * Keys match LeadRow.id (UUID or `legacy-{n}`).
 */
async function fetchInvoicedNisByDealLeadId(
  newLeadIds: string[],
  legacyLeadNumericIds: number[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (newLeadIds.length === 0 && legacyLeadNumericIds.length === 0) return map;

  const add = (leadKey: string, nis: number) => {
    if (!leadKey || !(nis > 0)) return;
    map.set(leadKey, (map.get(leadKey) || 0) + nis);
  };

  if (newLeadIds.length > 0) {
    const rows = await fetchAllRowsForLeadIds<Record<string, unknown>>(newLeadIds, (chunk) =>
      supabase
        .from('payment_plans')
        .select(
          'id, lead_id, value, currency, cancel_date, payment_order, invoice_sent, invoice_sent_at, invoice_send_automation_sent_at',
        )
        .is('cancel_date', null)
        .or(MARKETING_INVOICE_SENT_OR)
        .in('lead_id', chunk as string[]),
    );
    for (const row of rows) {
      if (!isPaymentPlanInvoiceSent(row as any)) continue;
      if (isExpenseInstallmentRow(row, 'new')) continue;
      add(String(row.lead_id ?? ''), paymentAmountToNis(row.value, row.currency));
    }
  }

  if (legacyLeadNumericIds.length > 0) {
    const rows = await fetchAllRowsForLeadIds<Record<string, unknown>>(legacyLeadNumericIds, (chunk) =>
      supabase
        .from('finances_paymentplanrow')
        .select(
          'id, lead_id, value, currency_id, cancel_date, order, invoice_sent, invoice_sent_at, invoice_send_automation_sent_at, accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)',
        )
        .is('cancel_date', null)
        .or(MARKETING_INVOICE_SENT_OR)
        .in('lead_id', chunk as number[]),
    );
    for (const row of rows) {
      if (!isPaymentPlanInvoiceSent(row as any)) continue;
      if (isExpenseInstallmentRow(row, 'legacy')) continue;
      const currency = resolveLegacyPaymentCurrency(row);
      add(`legacy-${row.lead_id}`, paymentAmountToNis(row.value, currency));
    }
  }

  return map;
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
  /** Invoiced installment total (NIS) for signed-in-range deals. */
  invoicedNis: number;
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
  | 'invoiced'
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
    case 'invoiced':
      return r.invoicedNis;
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
    <strong>Search</strong> to load results.
  </>
);

const MARKETING_REPORT_INTRO_DETAILS = (
  <>
    The macro table shows leads, eligible, meetings, offers, signed deals, invoiced (NIS), revenue (NIS), inactive
    leads, and media/management cost columns. <strong>Meetings</strong> are active leads with at least one non-canceled
    meeting in the meetings table (one per lead); stage 21 (meeting rescheduling) is not counted.{' '}
    <strong>Offers</strong> use the created-in-range cohort (current stage). <strong>Deals</strong>,{' '}
    <strong>invoiced</strong>, and <strong>revenue</strong> use Client signed agreement (stage 60) by{' '}
    <em>sign date</em> in the same range (leads_leadstage), attributed to the lead&apos;s source—even when the
    lead was created earlier. <strong>Invoiced</strong> sums payment-plan installments with an invoice sent
    (ex-VAT, expenses excluded). <strong>Revenue</strong> is the deal balance/proposal in NIS. Lead→Offer % is
    cohort-based; Lead→Deal % is signed-in-range deals ÷ cohort leads (excl. stage 91). Click a deals number to
    open the signed-deal list. Provider (firm) comes from source–firm links in Admin. Funnel timing uses stage
    history; sales behaviour uses scheduler-matched call logs for qualified leads before offer stage.
  </>
);
const REPORT_TABLE_CLASS =
  'table text-sm md:text-base [&_thead_th]:!text-base-content/55';

/** Grey-page white panels — same shell as Handler Management / conversion export reports. */
const REPORT_WHITE_PANEL =
  'rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100 sm:p-5';

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
  'min-w-[7rem] cursor-pointer rounded-full px-4 py-2 text-sm font-bold tracking-tight transition-colors duration-200 ease-out outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0';

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
  const filterColClass = FILTER_COL_CLASS;
  const macroTableScrollRef = useRef<HTMLDivElement | null>(null);
  const macroTableSectionRef = useRef<HTMLDivElement | null>(null);
  const macroBottomScrollbarRef = useRef<HTMLDivElement | null>(null);
  /** Prevents table↔bottom scroll sync from fighting while the user drags either scrollbar. */
  const macroHScrollLockRef = useRef<'table' | 'bottom' | null>(null);
  const macroBottomDraggingRef = useRef(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [countryIds, setCountryIds] = useState<string[]>([]);
  const [firmIds, setFirmIds] = useState<string[]>([]);
  const [mainCategoryIds, setMainCategoryIds] = useState<string[]>([]);
  const [groupMode, setGroupMode] = useState<GroupMode>('source');
  const showSourceCol = groupMode === 'source';
  const showProviderCol = !isExternalVariant;
  /** Sticky left columns: Channel → Source → Provider; metrics scroll underneath. */
  const stickyEdgeClass =
    'border-r border-base-300 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.12)]';
  const stickyChannelClass =
    'macro-sticky-col sticky left-0 z-[22] min-w-[8rem] w-[8rem] bg-white';
  const stickySourceClass =
    'macro-sticky-col macro-label-col sticky left-[8rem] z-[22] min-w-[8.5rem] w-[8.5rem] bg-white';
  const stickyProviderLeftClass = showSourceCol
    ? 'sticky left-[16.5rem]'
    : 'sticky left-[8rem]';
  const stickyProviderClass = `macro-sticky-col macro-label-col ${stickyProviderLeftClass} z-[22] min-w-[8.5rem] w-[8.5rem] bg-white`;
  const channelIsLastSticky = !showSourceCol && !showProviderCol;
  const sourceIsLastSticky = showSourceCol && !showProviderCol;
  const providerIsLastSticky = showProviderCol;
  const macroLabelColClass = `${macroLabelAlign} whitespace-normal break-words [overflow-wrap:anywhere] align-middle leading-snug`;
  const macroLabelTextClass =
    'block break-words [overflow-wrap:anywhere] leading-snug line-clamp-2';
  const macroTableClass = `${REPORT_TABLE_CLASS} table-fixed !border-separate border-spacing-0 w-full min-w-[67rem] border-0 bg-white [&_th]:whitespace-nowrap [&_th.macro-label-col]:whitespace-normal [&_th.macro-label-col]:break-words [&_td:not(.macro-label-col)]:whitespace-nowrap [&_thead_th]:border-0 [&_thead_th]:border-b [&_thead_th]:border-base-300 [&_tbody_td]:border-0 [&_tbody_td]:border-b [&_tbody_td]:border-base-200 [&_tfoot_td]:border-0 [&_tfoot_td]:border-t-2 [&_tfoot_td]:border-base-300 [&_thead_tr]:bg-white [&_tbody_tr]:bg-white [&_tfoot_tr]:bg-base-200 [&_th]:bg-white [&_td]:bg-white [&_tfoot_td]:bg-base-200`;
  const macroColGroup = (
    <colgroup>
      <col className="w-[8rem]" />
      {showSourceCol ? <col className="w-[8.5rem]" /> : null}
      {showProviderCol ? <col className="w-[8.5rem]" /> : null}
      <col className="w-[4.5rem]" />
      <col className="w-[4.5rem]" />
      <col className="w-[5rem]" />
      <col className="w-[4.5rem]" />
      <col className="w-[4.5rem]" />
      <col className="w-[5.25rem]" />
      <col className="w-[5.25rem]" />
      <col className="w-[5.5rem]" />
      <col className="w-[5.5rem]" />
      <col className="w-[6.5rem]" />
      <col className="w-[6.5rem]" />
      <col className="w-[4.5rem]" />
      {showProviderCol ? (
        <>
          <col className="w-[6.5rem]" />
          <col className="w-[7rem]" />
          <col className="w-[6.5rem]" />
          <col className="w-[4.75rem]" />
        </>
      ) : null}
    </colgroup>
  );
  const [macroSort, setMacroSort] = useState<{ key: MacroSortKey; dir: 'asc' | 'desc' }>({
    key: 'leads',
    dir: 'desc',
  });
  const [macroNeedsHScroll, setMacroNeedsHScroll] = useState(false);
  const [macroTableOnScreen, setMacroTableOnScreen] = useState(false);
  const [macroScrollWidth, setMacroScrollWidth] = useState(0);
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
  /** Leads that reached stage 60 (Client signed agreement) with sign date in the report range. */
  const [signedDealLeads, setSignedDealLeads] = useState<LeadRow[]>([]);
  /** Invoiced installment NIS totals keyed by LeadRow.id for signedDealLeads. */
  const [invoicedNisByLeadId, setInvoicedNisByLeadId] = useState<Map<string, number>>(() => new Map());
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
    const lockedIds = Array.from(lockedSourceIdSet);
    // External: fetch assigned sources by id (chunked). A full-table select is capped ~1000 rows
    // by PostgREST, so many assigned sources (often large bigint ids) never appeared after client filter.
    const sourcePromise =
      isExternalVariant && lockedIds.length > 0
        ? fetchMiscLeadsourcesByIds(lockedIds).then((rows) => ({ data: rows, error: null as Error | null }))
        : supabase.from('misc_leadsource').select('id, name, channel_id, active').order('name');

    const [ch, src, fr, co, mc] = await Promise.all([
      // Load ALL channels so sources linked to inactive channels still resolve (avoid "Unassigned channel").
      // We’ll filter inactive channels out of the filter dropdown UI separately.
      supabase.from('channels').select('id, code, label, is_active').order('sort_order'),
      sourcePromise,
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
      let rows = rawRows
        .map((r) => {
          const id = leadSourceIdToString(r.id);
          if (!id) return null;
          return {
            id,
            name: r.name,
            channel_id: r.channel_id,
            active: r.active,
          };
        })
        .filter((r): r is { id: string; name: string; channel_id: string | null; active?: boolean } => Boolean(r));
      if (isExternalVariant && lockedSourceIdSet.size > 0) {
        rows = rows.filter((r) => lockedSourceIdSet.has(r.id));
      }
      setAllSources(rows.map(({ id, name, channel_id }) => ({ id, name, channel_id })));
      // External: show all assigned sources (incl. inactive). Staff: active only in the filter UI.
      setSources(
        isExternalVariant
          ? rows.map(({ id, name, channel_id }) => ({ id, name, channel_id }))
          : rows
              .filter((r) => r.active !== false)
              .map(({ id, name, channel_id }) => ({ id, name, channel_id })),
      );
    }
    if (!isExternalVariant && !fr.error && fr.data) setFirms(fr.data as FirmRow[]);
    if (!co.error && co.data) setCountries(co.data as CountryRow[]);
    if (!mc.error && mc.data) {
      setMainCategories(
        (mc.data as { id: number | string; name: string }[])
          .map((r) => {
            const id = leadSourceIdToString(r.id);
            if (!id) return null;
            return { id, name: r.name };
          })
          .filter((r): r is { id: string; name: string } => Boolean(r)),
      );
    }
    if (sfRows.length > 0) {
      const rows = sfRows.map((r) => ({
        firm_id: r.firm_id,
        source_id: leadSourceIdToString(r.source_id) || String(r.source_id),
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

      const marketingFilterOpts = {
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
      };

      let rows = applyMarketingLeadFilters([...newLeadRows, ...legacyLeadRows], marketingFilterOpts);

      let signedDealRows: LeadRow[] = [];
      try {
        if (fromDate || toDate) {
          let signedRaw = await fetchSignedDealLeadRowsInRange(fromDate, toDate);
          if (legacyContactCountryIds.size > 0) {
            signedRaw = signedRaw.map((lead) => {
              const numericId = legacyLeadNumericId(lead);
              if (numericId == null) return lead;
              const contactCountryId = legacyContactCountryIds.get(String(numericId));
              if (contactCountryId == null) return lead;
              return { ...lead, country_id: contactCountryId };
            });
          }
          signedDealRows = applyMarketingLeadFilters(signedRaw, {
            ...marketingFilterOpts,
            requireCreatedInRange: false,
          }).filter((l) => !isMarketingStage91(l));
        } else {
          // No date range: fall back to cohort leads currently at/after signed.
          signedDealRows = rows.filter((l) => !isMarketingStage91(l) && stageRank(l) >= HIST_STAGE.signed);
        }
      } catch (e) {
        console.warn('signed deal (stage 60) fetch:', e);
        signedDealRows = [];
      }

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

      let invoicedByLead = new Map<string, number>();
      try {
        const signedNewIds = signedDealRows.filter((r) => !isLegacyLeadId(r.id)).map((r) => r.id);
        const signedLegacyIds = signedDealRows
          .map((r) => legacyLeadNumericId(r))
          .filter((n): n is number => n != null);
        invoicedByLead = await fetchInvoicedNisByDealLeadId(signedNewIds, signedLegacyIds);
      } catch (e) {
        console.warn('signed deal invoiced amounts:', e);
        invoicedByLead = new Map();
      }

      setLeads(rows);
      setSignedDealLeads(signedDealRows);
      setInvoicedNisByLeadId(invoicedByLead);
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
      setSignedDealLeads([]);
      setInvoicedNisByLeadId(new Map());
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads_leadstage' }, scheduleReportRefresh)
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
          invoicedNis: 0,
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
    }

    // Deals / invoiced / revenue: sign date in range (stage 60), attributed to source — may include leads created earlier.
    const countedDealIds = new Set<string>();
    for (const l of signedDealLeads) {
      if (countedDealIds.has(l.id)) continue;
      countedDealIds.add(l.id);
      const channel = getChannelLabel(l);
      const source = getSourceLabel(l);
      const key = groupMode === 'channel' ? channel : `${channel}|||${source}`;
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
          invoicedNis: 0,
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
      if (srcRow?.id) {
        row._sourceIds!.add(String(srcRow.id));
        for (const firmId of sourceIdToFirmIds.get(String(srcRow.id)) || []) {
          row._firmIds!.add(firmId);
        }
      } else if (l.source_id != null && String(l.source_id).trim() !== '') {
        const sid = String(l.source_id);
        row._sourceIds!.add(sid);
        for (const firmId of sourceIdToFirmIds.get(sid) || []) {
          row._firmIds!.add(firmId);
        }
      }
      const firmSourceId = srcRow?.id ?? (l.source_id != null ? String(l.source_id) : null);
      if (firmSourceId) {
        const pname = sourceIdToFirmName.get(String(firmSourceId));
        if (pname && row._providerNames) row._providerNames.add(pname);
      }
      row.deals += 1;
      row.invoicedNis += invoicedNisByLeadId.get(l.id) || 0;
      row.revenueNis += leadRevenueNis(l);
    }

    const seedEmptySourceRow = (sid: string) => {
      const srcRow = lookup.sourceIdToRow.get(sid);
      const channel = channelLabel(srcRow?.channel_id ?? null);
      const source = srcRow?.name || `Source #${sid}`;
      const key = `${channel}|||${source}`;
      if (map.has(key)) return;
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
        invoicedNis: 0,
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
    };

    // Firm filter: show every source linked to the selected firm(s), even with 0 leads in range.
    if (firmIds.length > 0 && groupMode === 'source') {
      const linkedSourceIds = new Set<string>();
      for (const firmId of firmIds) {
        for (const sid of firmIdToSourceIds.get(firmId) || []) {
          linkedSourceIds.add(String(sid));
        }
      }
      for (const sid of linkedSourceIds) seedEmptySourceRow(sid);
    }

    // External: always list every assigned source (incl. 0 leads), matching the user's extern_source_id set.
    if (isExternalVariant && lockedSourceIdSet.size > 0 && groupMode === 'source') {
      for (const sid of lockedSourceIdSet) {
        if (sourceIds.length > 0 && !sourceIds.includes(sid)) continue;
        if (channelIds.length > 0) {
          const srcRow = lookup.sourceIdToRow.get(sid);
          const cid = srcRow?.channel_id ? String(srcRow.channel_id) : '';
          if (!cid || !channelIds.includes(cid)) continue;
        }
        seedEmptySourceRow(sid);
      }
    }

    // Management cost is attached after sort (top visible row per firm) — keep _firmIds here.
    return Array.from(map.values()).map((r) => {
      const names = r._providerNames;
      let provider = '—';
      if (names && names.size === 1) provider = [...names][0];
      else if (names && names.size > 1) provider = 'Multiple providers';
      const mediaNis = [...(r._sourceIds || [])].reduce(
        (sum, sourceId) => sum + (mediaExpenseBySourceId[sourceId] || 0),
        0,
      );
      const stage91 = r.stage91 ?? 0;
      const leadsExclStage91 = Math.max(0, r.leads - stage91);
      const {
        _providerNames,
        _sourceIds,
        _countedMeetingLeadIds: _mtgIds,
        stage91: _s91,
        ...rest
      } = r;
      return {
        ...rest,
        provider,
        mediaNis,
        managementNis: 0,
        leadsExclStage91,
        _firmIds: r._firmIds,
      };
    });
  }, [
    leads,
    signedDealLeads,
    invoicedNisByLeadId,
    leadIdsWithMeeting,
    groupMode,
    channels,
    firmIds,
    firmIdToSourceIds,
    sourceIdToFirmName,
    sourceIdToFirmIds,
    mediaExpenseBySourceId,
    allSources,
    isExternalVariant,
    lockedSourceIdSet,
    sourceIds,
    channelIds,
  ]);

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
    // Firm management cost once per provider — show on the topmost visible row for that firm.
    const firmAssigned = new Set<string>();
    return rows.map((r) => {
      let managementNis = 0;
      for (const firmId of r._firmIds || []) {
        if (firmAssigned.has(firmId)) continue;
        firmAssigned.add(firmId);
        managementNis += managementExpenseByFirmId[firmId] || 0;
      }
      const { _firmIds: _omitFirms, ...rest } = r;
      return { ...rest, managementNis };
    });
  }, [aggregates, macroSort, managementExpenseByFirmId]);

  const toggleMacroSort = useCallback((key: MacroSortKey) => {
    setMacroSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' },
    );
  }, []);

  const openDealsBreakdown = useCallback(
    (agg: AggRow) => {
      if (agg.deals <= 0) return;
      const rows = filterLeadsForMarketingBreakdown({
        leads: signedDealLeads,
        agg: { key: agg.key, channel: agg.channel, source: agg.source },
        groupMode,
        channels,
        allSources,
        metric: 'signedInRange',
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
    [signedDealLeads, groupMode, channels, allSources],
  );

  const totals = useMemo(() => {
    const t = {
      leads: 0,
      eligible: 0,
      meetings: 0,
      offers: 0,
      deals: 0,
      invoiced: 0,
      revenue: 0,
      inactive: 0,
      leadsExclStage91: 0,
      mediaNis: 0,
      managementNis: 0,
    };
    for (const r of sortedAggregates) {
      t.leads += r.leads;
      t.eligible += r.eligible;
      t.meetings += r.meetings;
      t.offers += r.offers;
      t.deals += r.deals;
      t.invoiced += r.invoicedNis;
      t.revenue += r.revenueNis;
      t.inactive += r.inactive;
      t.leadsExclStage91 += r.leadsExclStage91;
      t.mediaNis += r.mediaNis;
      t.managementNis += r.managementNis;
    }
    return t;
  }, [sortedAggregates]);

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

  const clearMacroHScrollLock = useCallback((source: 'table' | 'bottom') => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (macroBottomDraggingRef.current && source === 'bottom') return;
        if (macroHScrollLockRef.current === source) {
          macroHScrollLockRef.current = null;
        }
      });
    });
  }, []);

  const updateMacroScrollState = useCallback(() => {
    const el = macroTableScrollRef.current;
    if (!el) {
      setMacroNeedsHScroll(false);
      setMacroScrollWidth(0);
      return;
    }
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    setMacroNeedsHScroll(maxLeft > 4);
    const bottom = macroBottomScrollbarRef.current;
    // Bottom bar is viewport-wide; table scroller is narrower (sidebar/padding).
    // Spacer = tableMaxScroll + bottomClient so both share the same max scrollLeft.
    const bottomClient = bottom?.clientWidth || window.innerWidth || el.clientWidth;
    setMacroScrollWidth(maxLeft + bottomClient);
    // Never push table → bottom while the user is dragging the fixed scrollbar
    // (or while a bottom-driven sync is in flight); that fight cancels click-drag.
    if (
      bottom &&
      !macroBottomDraggingRef.current &&
      macroHScrollLockRef.current !== 'bottom' &&
      bottom.scrollLeft !== el.scrollLeft
    ) {
      macroHScrollLockRef.current = 'table';
      bottom.scrollLeft = el.scrollLeft;
      clearMacroHScrollLock('table');
    }
  }, [clearMacroHScrollLock]);

  const updateMacroTableOnScreen = useCallback(() => {
    const section = macroTableSectionRef.current;
    if (!section) {
      setMacroTableOnScreen(false);
      return;
    }
    const rect = section.getBoundingClientRect();
    const vh = window.innerHeight || 0;
    // Visible while the table is on screen; hide once scrolled fully past it.
    setMacroTableOnScreen(rect.top < vh - 48 && rect.bottom > 72);
  }, []);

  const syncMacroHScrollFromBottom = useCallback(() => {
    const bottom = macroBottomScrollbarRef.current;
    const el = macroTableScrollRef.current;
    if (!bottom || !el) return;
    if (macroHScrollLockRef.current === 'table' && !macroBottomDraggingRef.current) return;
    macroHScrollLockRef.current = 'bottom';
    el.scrollLeft = bottom.scrollLeft;
    clearMacroHScrollLock('bottom');
  }, [clearMacroHScrollLock]);

  const onMacroBottomPointerDown = useCallback(() => {
    macroBottomDraggingRef.current = true;
    macroHScrollLockRef.current = 'bottom';
  }, []);

  const onMacroBottomPointerUp = useCallback(() => {
    macroBottomDraggingRef.current = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!macroBottomDraggingRef.current && macroHScrollLockRef.current === 'bottom') {
          macroHScrollLockRef.current = null;
        }
      });
    });
  }, []);

  useEffect(() => {
    updateMacroScrollState();
    updateMacroTableOnScreen();
    const onWin = () => {
      updateMacroScrollState();
      updateMacroTableOnScreen();
    };
    window.addEventListener('resize', onWin, { passive: true });
    window.addEventListener('scroll', onWin, { passive: true, capture: true });
    const el = macroTableScrollRef.current;
    const section = macroTableSectionRef.current;
    let ro: ResizeObserver | null = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => updateMacroScrollState());
      ro.observe(el);
    }
    const io =
      typeof IntersectionObserver !== 'undefined' && section
        ? new IntersectionObserver(() => updateMacroTableOnScreen(), {
            root: null,
            threshold: [0, 0.01, 0.1, 1],
          })
        : null;
    if (io && section) io.observe(section);
    return () => {
      window.removeEventListener('resize', onWin);
      window.removeEventListener('scroll', onWin, true);
      ro?.disconnect();
      io?.disconnect();
    };
  }, [
    updateMacroScrollState,
    updateMacroTableOnScreen,
    searched,
    loading,
    sortedAggregates.length,
    groupMode,
    isExternalVariant,
  ]);

  useEffect(() => {
    if (!macroNeedsHScroll || !macroTableOnScreen) return;
    // Remeasure after the fixed bar mounts so spacer width uses its real clientWidth.
    const id = requestAnimationFrame(() => updateMacroScrollState());
    return () => cancelAnimationFrame(id);
  }, [macroNeedsHScroll, macroTableOnScreen, updateMacroScrollState]);

  useEffect(() => {
    const endDrag = () => {
      if (!macroBottomDraggingRef.current) return;
      macroBottomDraggingRef.current = false;
      if (macroHScrollLockRef.current === 'bottom') macroHScrollLockRef.current = null;
    };
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, []);

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

  /** Same sticky Channel/Source/Provider cells as the main table so the floating total aligns. */
  const macroTotalTextClass = 'text-sm md:text-base font-bold';
  const renderMacroStickyTotalLabelCells = (bgClass: string) => (
    <>
      <td
        className={`whitespace-nowrap ${macroTotalTextClass} ${macroCellAlign} ${stickyChannelClass} ${bgClass}${channelIsLastSticky ? ` ${stickyEdgeClass}` : ''}`}
      >
        Total
      </td>
      {showSourceCol && (
        <td
          className={`${stickySourceClass} ${macroLabelColClass} ${bgClass}${sourceIsLastSticky ? ` ${stickyEdgeClass}` : ''}`}
          aria-hidden
        />
      )}
      {showProviderCol && (
        <td
          className={`${stickyProviderClass} ${macroLabelColClass} ${bgClass}${providerIsLastSticky ? ` ${stickyEdgeClass}` : ''}`}
          aria-hidden
        />
      )}
    </>
  );

  const macroMetricCell = `${macroCellAlign} min-w-[4.25rem]`;
  const macroMoneyCell = `${macroCellAlign} min-w-[6.5rem]`;
  const macroPctCell = `${macroCellAlign} min-w-[4.75rem] !text-gray-400`;

  const renderMacroTotalMetricCells = () => (
    <>
      <td className={`${macroMetricCell} ${macroTotalTextClass}`}>{totals.leads}</td>
      <td className={`${macroMetricCell} ${macroTotalTextClass}`}>{totals.eligible}</td>
      <td className={`${macroMetricCell} ${macroTotalTextClass}`}>{totals.meetings}</td>
      <td className={`${macroMetricCell} ${macroTotalTextClass}`}>{totals.offers}</td>
      <td className={`${macroMetricCell} ${macroTotalTextClass} text-blue-600`}>{totals.deals}</td>
      <td className={`${macroPctCell} ${macroTotalTextClass}`}>{macroPct(totals.eligible, totals.leads)}</td>
      <td className={`${macroPctCell} ${macroTotalTextClass}`}>{macroPct(totals.meetings, totals.leads)}</td>
      <td className={`${macroPctCell} ${macroTotalTextClass}`}>{macroPct(totals.offers, totals.leadsExclStage91)}</td>
      <td className={`${macroPctCell} ${macroTotalTextClass}`}>{macroPct(totals.deals, totals.leadsExclStage91)}</td>
      <td className={`${macroMoneyCell} ${macroTotalTextClass}`}>{fmtMoney(totals.invoiced)}</td>
      <td className={`${macroMoneyCell} ${macroTotalTextClass} !text-green-600`}>{fmtMoney(totals.revenue)}</td>
      <td className={`${macroMetricCell} ${macroTotalTextClass}`}>{totals.inactive}</td>
      {!isExternalVariant && (
        <>
          <td className={`${macroMoneyCell} ${macroTotalTextClass}`}>
            {totals.mediaNis > 0 ? fmtMoney(totals.mediaNis) : '—'}
          </td>
          <td className={`${macroMoneyCell} ${macroTotalTextClass}`}>
            {totals.managementNis > 0 ? fmtMoney(totals.managementNis) : '—'}
          </td>
          <td className={`${macroMoneyCell} ${macroTotalTextClass}`}>
            {totals.mediaNis + totals.managementNis > 0
              ? fmtMoney(totals.mediaNis + totals.managementNis)
              : '—'}
          </td>
          <td className={`${macroPctCell} ${macroTotalTextClass}`}>100.0%</td>
        </>
      )}
    </>
  );

  const panelClass = isExternalVariant ? '' : REPORT_WHITE_PANEL;

  return (
    <div className={`${isExternalVariant ? 'space-y-8' : 'space-y-5'} pb-12 relative w-full min-w-0 max-w-full ${isExternalVariant ? 'bg-white' : ''}`}>
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
                months overlapping your date range. Management cost is counted once per provider (shown on the
                topmost table row for that firm after sorting), so multi-source firms are not multiplied in Total.
                Large cohorts may stop at 30,000 leads—narrow dates or filters if you see a truncation warning.
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

      <div className={`flex w-full flex-col items-start ${isExternalVariant ? 'gap-6' : `gap-4 ${panelClass}`}`}>
        <div className={`flex flex-wrap items-end ${isExternalVariant ? 'gap-3 sm:gap-4' : 'gap-2 sm:gap-3'}`}>
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-base-content/55">
              Group by
            </span>
            <div
              className={
                'inline-flex rounded-full p-1 ' +
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
            className="btn h-12 min-h-12 shrink-0 gap-2 rounded-full border-0 bg-black px-5 text-sm font-semibold text-white shadow-sm hover:bg-neutral-800 disabled:opacity-50"
            onClick={() => void runReport()}
            disabled={loading}
            aria-label={loading ? 'Searching…' : 'Search'}
            aria-busy={loading}
          >
            {loading ? (
              <span className="loading loading-spinner loading-sm text-white" />
            ) : (
              <Search className="h-5 w-5" strokeWidth={2} aria-hidden />
            )}
            Search
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

      {loading && (
        <div
          className="flex flex-col items-center justify-center gap-6 px-6 py-20 min-h-[min(70vh,32rem)]"
          aria-busy="true"
          aria-live="polite"
        >
          <div className="relative flex h-28 w-28 items-center justify-center">
            <span className="absolute inset-0 rounded-full bg-primary opacity-30 animate-ping" aria-hidden />
            <span
              className="absolute inset-2 rounded-full border-[3px] border-transparent border-t-primary border-r-primary/40 animate-spin"
              aria-hidden
            />
            <span
              className="absolute inset-5 rounded-full border-2 border-transparent border-b-primary/70 animate-spin [animation-direction:reverse] [animation-duration:1.1s]"
              aria-hidden
            />
            <ChartBar className="relative h-9 w-9 text-primary" strokeWidth={2} aria-hidden />
          </div>
          <div className="text-center space-y-1.5">
            <p className="text-xl font-semibold tracking-tight text-base-content">Running report</p>
            <p className="text-sm text-base-content/55">Matching your filters…</p>
          </div>
        </div>
      )}

      {searched && !loading && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
                targetId: isExternalVariant ? 'marketing-kpi-macro' : 'marketing-kpi-timing',
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
                targetId: isExternalVariant ? 'marketing-kpi-macro' : 'marketing-kpi-sales',
                className:
                  'bg-gradient-to-tr from-emerald-500 via-teal-500 to-cyan-400 text-white',
              },
              {
                label: 'Invoiced (NIS)',
                value: fmtMoney(totals.invoiced),
                icon: DocumentTextIcon,
                targetId: 'marketing-kpi-macro',
                className:
                  'bg-gradient-to-tr from-amber-500 via-orange-500 to-rose-400 text-white',
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
                className={`rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl shadow-xl relative overflow-hidden p-5 min-h-[7.5rem] text-left flex flex-col ${k.className}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 text-left">
                    <div className="text-3xl font-extrabold text-white leading-none break-words">
                      {k.value}
                    </div>
                    <div className="mt-0.5 text-base font-semibold text-white/90 leading-tight">
                      {k.label}
                    </div>
                  </div>
                  <div className="flex items-center justify-center w-14 h-14 shrink-0 -mt-1 -mr-1 rounded-full bg-white/20 shadow">
                    <k.icon className="w-8 h-8 text-white opacity-95" />
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Main macro table — Channel/Source/Provider stay pinned; metrics scroll horizontally */}
          <div
            id="marketing-kpi-macro"
            ref={macroTableSectionRef}
            className={`scroll-mt-24 w-full max-w-full min-w-0 ${
              isExternalVariant
                ? 'bg-white'
                : 'rounded-2xl bg-white px-1 py-2 shadow-sm ring-1 ring-gray-100 sm:px-1.5 sm:py-2.5'
            }`}
          >
            <div
              ref={macroTableScrollRef}
              className="scrollbar-hide w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain"
              onScroll={() => updateMacroScrollState()}
            >
            <table className={macroTableClass}>
              {macroColGroup}
              <thead>
                <tr className="border-b border-base-300 bg-base-100 text-[11px] uppercase tracking-wide">
                  <th
                    colSpan={(showSourceCol ? 2 : 1) + (showProviderCol ? 1 : 0)}
                    className={`sticky left-0 z-[23] bg-white ${stickyEdgeClass}`}
                    aria-hidden
                  />
                  <th
                    colSpan={9}
                    className="text-center text-base-content/50"
                    style={{ letterSpacing: '0.08em' }}
                  >
                    Performance
                  </th>
                  <th
                    colSpan={3}
                    className="text-center text-base-content/50"
                    style={{ letterSpacing: '0.08em' }}
                  >
                    Revenue
                  </th>
                  {showProviderCol && (
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
                  <th
                    scope="col"
                    className={`text-center ${stickyChannelClass}${channelIsLastSticky ? ` ${stickyEdgeClass}` : ''}`}
                  >
                    Channel
                  </th>
                  {showSourceCol && (
                    <th
                      scope="col"
                      className={`${stickySourceClass} ${macroLabelColClass}${sourceIsLastSticky ? ` ${stickyEdgeClass}` : ''}`}
                    >
                      Source
                    </th>
                  )}
                  {showProviderCol && (
                    <th
                      scope="col"
                      className={`${stickyProviderClass} ${macroLabelColClass}${providerIsLastSticky ? ` ${stickyEdgeClass}` : ''}`}
                    >
                      Provider
                    </th>
                  )}
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
                    <span className="inline-flex flex-col items-center leading-tight">
                      <span>Lead→Elig</span>
                      <span>%</span>
                    </span>
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
                    <span className="inline-flex flex-col items-center leading-tight">
                      <span>Lead→Mtg</span>
                      <span>%</span>
                    </span>
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
                    <span className="inline-flex flex-col items-center leading-tight">
                      <span>Lead→Offer</span>
                      <span>%</span>
                    </span>
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
                    <span className="inline-flex flex-col items-center leading-tight">
                      <span>Lead→Deal</span>
                      <span>%</span>
                    </span>
                  </MacroSortableTh>
                  <MacroSortableTh
                    sortKey="invoiced"
                    activeKey={macroSort.key}
                    dir={macroSort.dir}
                    onSort={toggleMacroSort}
                    sortLabel="Invoiced NIS"
                    align={macroSortAlign}
                    className={macroCellAlign}
                  >
                    Invoiced
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
                      <td
                        className={`whitespace-nowrap ${macroCellAlign} ${stickyChannelClass}${channelIsLastSticky ? ` ${stickyEdgeClass}` : ''}`}
                      >
                        <div className="flex justify-center">
                          <ChannelLabel
                            label={r.channel}
                            seed={r.channel}
                            inactive={r.channel.toLowerCase().includes('(inactive)')}
                          />
                        </div>
                      </td>
                      {showSourceCol && (
                        <td
                          className={`${stickySourceClass} ${macroLabelColClass}${sourceIsLastSticky ? ` ${stickyEdgeClass}` : ''}`}
                        >
                          <span className={macroLabelTextClass} title={r.source}>
                            {r.source}
                          </span>
                        </td>
                      )}
                      {showProviderCol && (
                        <td
                          className={`text-base-content/50 ${stickyProviderClass} ${macroLabelColClass}${providerIsLastSticky ? ` ${stickyEdgeClass}` : ''}`}
                        >
                          <span className={macroLabelTextClass} title={r.provider}>
                            {r.provider}
                          </span>
                        </td>
                      )}
                      <td className={macroCellAlign}>{r.leads}</td>
                      <td className={macroCellAlign}>{r.eligible}</td>
                      <td className={macroCellAlign}>{r.meetings}</td>
                      <td className={macroCellAlign}>{r.offers}</td>
                      <td className={`${macroCellAlign} text-blue-600`}>
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
                      <td className={`${macroCellAlign} !text-gray-400`}>{macroPct(r.eligible, r.leads)}</td>
                      <td className={`${macroCellAlign} !text-gray-400`}>{macroPct(r.meetings, r.leads)}</td>
                      <td className={`${macroCellAlign} !text-gray-400`}>{macroPct(r.offers, offerDealDenom)}</td>
                      <td className={`${macroCellAlign} !text-gray-400`}>{macroPct(r.deals, offerDealDenom)}</td>
                      <td className={macroCellAlign}>{fmtMoney(r.invoicedNis)}</td>
                      <td className={`${macroCellAlign} !text-green-600`}>{fmtMoney(r.revenueNis)}</td>
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
              {sortedAggregates.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-base-300 bg-base-200 text-sm md:text-base">
                    {renderMacroStickyTotalLabelCells('!bg-base-200')}
                    {renderMacroTotalMetricCells()}
                  </tr>
                </tfoot>
              )}
            </table>
            </div>
          </div>

          {macroNeedsHScroll && macroTableOnScreen && (
            <div
              className="fixed inset-x-0 bottom-0 z-[80] hidden border-t border-gray-200/80 bg-[#f3f4f6]/95 backdrop-blur-sm md:block"
              aria-hidden={false}
            >
              <div
                ref={macroBottomScrollbarRef}
                className="h-4 w-full overflow-x-auto overflow-y-hidden overscroll-x-contain"
                onScroll={syncMacroHScrollFromBottom}
                onPointerDown={onMacroBottomPointerDown}
                onPointerUp={onMacroBottomPointerUp}
                onPointerCancel={onMacroBottomPointerUp}
                aria-label="Table horizontal scrollbar"
              >
                <div style={{ width: macroScrollWidth, height: '100%' }} />
              </div>
            </div>
          )}

          {/* Funnel chart */}
          <div
            id="marketing-kpi-funnel"
            className={`scroll-mt-24 ${isExternalVariant ? 'pt-2' : REPORT_WHITE_PANEL}`}
          >
            <h3 className={`${isExternalVariant ? 'mb-4' : 'mb-4'} text-base font-bold ${REPORT_SECTION_TITLE_CLASS}`}>Funnel snapshot</h3>
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
          <div className="grid gap-5 lg:grid-cols-2">
            <div
              id="marketing-kpi-timing"
              className={`scroll-mt-24 ${REPORT_WHITE_PANEL}`}
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
              className={`scroll-mt-24 ${REPORT_WHITE_PANEL}`}
            >
              <h3 className={`text-base font-bold ${REPORT_SECTION_TITLE_CLASS}`}>Sales behaviour / quality</h3>
              {callLogsError && (
                <p className="mt-2 text-sm text-error">call_logs: {callLogsError}</p>
              )}
              {!callLogsError && leads.length > 0 && (
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap gap-3 text-sm">
                    <span className="rounded-lg bg-gray-100 px-2 py-1 text-gray-700">
                      Qualified leads: <strong>{salesBehaviourStats.qualifiedCount}</strong>
                    </span>
                    <span className="rounded-lg bg-gray-100 px-2 py-1 text-gray-700">
                      Matched calls: <strong>{salesBehaviourStats.totalMatchedCalls}</strong>
                    </span>
                    <span className="rounded-lg bg-gray-100 px-2 py-1 text-gray-700">
                      Answered: <strong>{salesBehaviourStats.totalAnsweredCalls}</strong>
                    </span>
                    <span className="rounded-lg bg-gray-100 px-2 py-1 text-gray-700">
                      Not answered: <strong>{salesBehaviourStats.totalMissedCalls}</strong>
                    </span>
                    <span className="rounded-lg bg-gray-100 px-2 py-1 text-gray-700">
                      Avg call (matched):{' '}
                      <strong>
                        {salesBehaviourStats.overallAvgSec != null
                          ? fmtDurationMinSec(salesBehaviourStats.overallAvgSec)
                          : '—'}
                      </strong>
                    </span>
                    <span className="rounded-lg bg-gray-100 px-2 py-1 text-gray-700">
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
        <div className="px-4 py-10 text-center">
          <p className="text-base leading-relaxed text-base-content/55">
            Set your filters above, then click <span className="font-semibold text-base-content/75">Search</span> to
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
        disableLeadLinks={isExternalVariant}
      />
    </div>
  );
};

export default MarketingDashboardReport;
