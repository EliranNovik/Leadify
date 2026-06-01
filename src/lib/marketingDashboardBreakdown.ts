import { getStageName } from './stageUtils';
import { convertToNIS } from './currencyConversion';

/** Minimal lead shape for marketing dashboard breakdown (matches report LeadRow). */
export type MarketingBreakdownLead = {
  id: string;
  lead_number: string | null;
  name: string | null;
  category: string | null;
  stage: string | number | null;
  status: string | number | null;
  unactivated_at: string | null;
  unactivation_reason: string | null;
  eligible: boolean | null;
  eligibility_status: string | null;
  balance: number | null;
  proposal_total: number | null;
  balance_currency: string | null;
  currency_id?: number | null;
  source: string | null;
  source_id: string | null;
  misc_leadsource?: {
    id: number;
    name: string;
    channel_id: string | null;
  } | null;
};

export type MarketingLeadBreakdownRow = {
  leadId: string;
  leadNumber: string;
  clientName: string;
  /** Main category · subcategory (from misc_category + misc_maincategory). */
  category: string;
  totalValueNis: number;
};

export type MiscCategoryJoin = {
  name?: string | null;
  parent_id?: number | string | null;
  misc_maincategory?:
    | { id?: number | string | null; name?: string | null }
    | { id?: number | string | null; name?: string | null }[]
    | null;
};

/** misc_maincategory.id (or misc_category.parent_id) as string for filters. */
export function resolveMarketingMainCategoryId(
  catJoin: MiscCategoryJoin | MiscCategoryJoin[] | null | undefined,
): string | null {
  const cat = Array.isArray(catJoin) ? catJoin[0] : catJoin;
  if (!cat) return null;
  const main = Array.isArray(cat.misc_maincategory) ? cat.misc_maincategory[0] : cat.misc_maincategory;
  if (main?.id != null && String(main.id).trim() !== '') return String(main.id);
  if (cat.parent_id != null && String(cat.parent_id).trim() !== '') return String(cat.parent_id);
  return null;
}

/** Main category (parent) plus subcategory (misc_category.name). */
export function formatMarketingCategoryDisplay(
  catJoin: MiscCategoryJoin | MiscCategoryJoin[] | null | undefined,
  fallbackCategory?: string | null,
): string {
  const cat = Array.isArray(catJoin) ? catJoin[0] : catJoin;
  const fallback = fallbackCategory?.trim() || '';
  if (!cat?.name) return fallback || '—';
  const main = Array.isArray(cat.misc_maincategory) ? cat.misc_maincategory[0] : cat.misc_maincategory;
  const mainName = main?.name?.trim() || '';
  const subName = String(cat.name).trim();
  if (mainName && subName) return `${mainName} · ${subName}`;
  if (mainName) return mainName;
  if (subName) return subName;
  return fallback || '—';
}

export type MarketingBreakdownMetric = 'deals';

type SourceRow = { id: string; name: string; channel_id: string | null };
type ChannelRow = { id: string; label: string; code: string; is_active: boolean };

export type MarketingAggRowKey = {
  key: string;
  channel: string;
  source: string;
};

const STRING_STAGE_RANK: Record<string, number> = {
  created: 0,
  scheduler_assigned: 10,
  meeting_scheduled: 20,
  meeting_paid: 22,
  communication_started: 25,
  another_meeting: 28,
  revised_offer: 40,
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

function stageRank(lead: MarketingBreakdownLead): number {
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

export const STAGE_DROPPED_SPAM = 91;
/** Meeting rescheduling — not a held meeting (CRM stage 21). */
export const STAGE_MEETING_RESCHEDULING = 21;

function normalizeDroppedSpamDisplayName(display: string): string {
  return display
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[_/-]/g, '');
}

/**
 * Dropped (Spam/Irrelevant) — stage id 91 and explicit slug/display names only.
 * Do not use areStagesEquivalent: it groups generic "inactive"/"unactivated" with spam.
 */
export function isMarketingStage91(lead: { stage: string | number | null }): boolean {
  if (stageRank(lead) === STAGE_DROPPED_SPAM) return true;
  const raw = String(lead.stage ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/\//g, '_');
  if (raw === '91' || raw === 'unactivate_spam' || raw === 'dropped_spam') return true;
  const display = getStageName(String(lead.stage ?? '')).trim();
  const norm = normalizeDroppedSpamDisplayName(display);
  return norm === 'droppedspamirrelevant' || norm === 'unactivatespam';
}

function isDroppedSpamStage(lead: MarketingBreakdownLead): boolean {
  return isMarketingStage91(lead);
}

function normalizeMeetingStageDisplayName(display: string): string {
  return display
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[_/-]/g, '');
}

/** Stage 21 / meeting rescheduling — canceled slot, not a completed meeting. */
export function isMarketingMeetingReschedulingStage(lead: {
  stage: string | number | null;
}): boolean {
  if (stageRank(lead) === STAGE_MEETING_RESCHEDULING) return true;
  const raw = String(lead.stage ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/\//g, '_');
  if (raw === '21' || raw === 'meeting_rescheduled' || raw === 'meeting_rescheduling') return true;
  const display = getStageName(String(lead.stage ?? '')).trim();
  const norm = normalizeMeetingStageDisplayName(display);
  return norm === 'meetingrescheduling' || norm === 'meetingrescheduled';
}

/** At least one non-canceled meetings row; excludes stage 21 and inactive leads. */
export function leadCountsAsMarketingMeeting(
  lead: MarketingBreakdownLead,
  leadIdsWithMeeting: Set<string>,
): boolean {
  if (isMarketingMeetingReschedulingStage(lead)) return false;
  if (lead.unactivated_at) return false;
  if (lead.status === 'inactive' || lead.status === '10' || lead.status === 10) return false;
  if (isMarketingStage91(lead)) return false;
  return leadIdsWithMeeting.has(lead.id);
}

export function hasSignedDeal(lead: MarketingBreakdownLead): boolean {
  if (isDroppedSpamStage(lead)) return false;
  const r = stageRank(lead);
  if (r >= 60) return true;
  const name = getStageName(String(lead.stage ?? '')).toLowerCase();
  return name.includes('signed') && name.includes('client');
}

export function leadRevenueNis(lead: MarketingBreakdownLead): number {
  const raw = Number(lead.balance ?? lead.proposal_total ?? 0);
  if (!raw) return 0;
  const currency = lead.currency_id ?? lead.balance_currency ?? '₪';
  try {
    return convertToNIS(raw, currency);
  } catch {
    return raw;
  }
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
  lead: MarketingBreakdownLead,
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
  lead: MarketingBreakdownLead,
  sourceNameToRow: Map<string, SourceRow>,
  sourceIdToRow: Map<string, SourceRow>,
): string | null {
  if (lead.misc_leadsource?.channel_id) return lead.misc_leadsource.channel_id;
  return resolveLeadSourceRow(lead, sourceNameToRow, sourceIdToRow)?.channel_id ?? null;
}

function leadMatchesAggRow(
  lead: MarketingBreakdownLead,
  agg: MarketingAggRowKey,
  groupMode: 'source' | 'channel',
  channels: ChannelRow[],
  allSources: SourceRow[],
): boolean {
  const lookup = buildSourceLookupMaps(allSources);
  const channelLabel = (cid: string | null | undefined) => {
    if (!cid) return '—';
    const c = channels.find((x) => x.id === cid);
    if (!c) return 'Unknown channel';
    const base = c.label || c.code || 'Channel';
    return c.is_active ? base : `${base} (inactive)`;
  };
  const channel = channelLabel(leadChannelId(lead, lookup.sourceNameToRow, lookup.sourceIdToRow));
  const source =
    resolveLeadSourceRow(lead, lookup.sourceNameToRow, lookup.sourceIdToRow)?.name ||
    lead.source?.trim() ||
    `Source #${lead.source_id ?? '?'}`;
  const key = groupMode === 'channel' ? channel : `${channel}|||${source}`;
  return key === agg.key;
}

function leadMatchesMetric(lead: MarketingBreakdownLead, metric: MarketingBreakdownMetric): boolean {
  switch (metric) {
    case 'deals':
      return hasSignedDeal(lead);
    default:
      return false;
  }
}

export function leadToBreakdownRow(lead: MarketingBreakdownLead): MarketingLeadBreakdownRow {
  return {
    leadId: lead.id,
    leadNumber: lead.lead_number?.trim() || lead.id,
    clientName: lead.name?.trim() || '—',
    category: lead.category?.trim() || '—',
    totalValueNis: leadRevenueNis(lead),
  };
}

export function filterLeadsForMarketingBreakdown(opts: {
  leads: MarketingBreakdownLead[];
  agg: MarketingAggRowKey;
  groupMode: 'source' | 'channel';
  channels: ChannelRow[];
  allSources: SourceRow[];
  metric: MarketingBreakdownMetric;
}): MarketingLeadBreakdownRow[] {
  const { leads, agg, groupMode, channels, allSources, metric } = opts;
  return leads
    .filter(
      (l) => leadMatchesAggRow(l, agg, groupMode, channels, allSources) && leadMatchesMetric(l, metric),
    )
    .map(leadToBreakdownRow)
    .sort((a, b) => a.leadNumber.localeCompare(b.leadNumber));
}

export function buildDealsBreakdownTitle(
  agg: MarketingAggRowKey,
  groupMode: 'source' | 'channel',
): string {
  if (groupMode === 'source') {
    return `Deals (signed) — ${agg.channel} / ${agg.source}`;
  }
  return `Deals (signed) — ${agg.channel}`;
}
