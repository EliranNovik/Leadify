import { supabase } from './supabase';
import { convertToNIS } from './currencyConversion';
import {
  buildLeadSourceOrFilterClause,
  buildLegacyLeadSourceIdOrFilterClause,
  type SourceRowLike,
} from './leadDateFilters';
import { fetchMiscLeadsourcesByIds } from './externalUserSources';
import { leadSourceIdToString } from './leadSourceId';
import {
  fetchAllRowsForLeadIds,
  isExpenseInstallmentRow,
  resolveLegacyPaymentCurrency,
} from './invoicedInstallments';
import { isPaymentPlanInvoiceSent } from './markPaymentPlanInvoiceSent';

export type MySourceAllTimeRow = {
  id: string;
  name: string;
  leads: number;
  invoicedNis: number;
  revenueNis: number;
};

const MARKETING_INVOICE_SENT_OR =
  'invoice_sent.eq.true,invoice_sent_at.not.is.null,invoice_send_automation_sent_at.not.is.null';

const SIGNED_STAGE = 60;

function paymentAmountToNis(value: unknown, currency: unknown): number {
  const raw = Number(value ?? 0);
  if (!raw || !Number.isFinite(raw)) return 0;
  try {
    return convertToNIS(raw, currency ?? '₪');
  } catch {
    return raw;
  }
}

function revenueNis(row: {
  balance?: unknown;
  proposal_total?: unknown;
  currency_id?: unknown;
  balance_currency?: unknown;
}): number {
  const raw = Number(row.balance ?? row.proposal_total ?? 0);
  if (!raw) return 0;
  const currency = row.currency_id ?? row.balance_currency ?? '₪';
  try {
    return convertToNIS(raw, currency);
  } catch {
    return raw;
  }
}

function parseStage(stage: unknown): number | null {
  if (stage == null) return null;
  const n = typeof stage === 'number' ? stage : Number(String(stage).trim());
  return Number.isFinite(n) ? n : null;
}

async function countLeadsForSource(
  sourceId: string,
  sources: SourceRowLike[],
): Promise<number> {
  const newOr = buildLeadSourceOrFilterClause([sourceId], sources);
  const legacyOr = buildLegacyLeadSourceIdOrFilterClause([sourceId], sources);

  let newCount = 0;
  let legacyCount = 0;

  if (newOr) {
    const { count, error } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .or(newOr);
    if (!error && count != null) newCount = count;
  }

  if (legacyOr) {
    const { count, error } = await supabase
      .from('leads_lead')
      .select('id', { count: 'exact', head: true })
      .or(legacyOr);
    if (!error && count != null) legacyCount = count;
  }

  return newCount + legacyCount;
}

async function fetchSignedLeadsForSources(
  sourceIds: string[],
  sources: SourceRowLike[],
): Promise<
  {
    id: string;
    source_id: string | null;
    source: string | null;
    balance: unknown;
    proposal_total: unknown;
    currency_id: unknown;
    balance_currency: unknown;
  }[]
> {
  if (sourceIds.length === 0) return [];
  const newOr = buildLeadSourceOrFilterClause(sourceIds, sources);
  const legacyOr = buildLegacyLeadSourceIdOrFilterClause(sourceIds, sources);
  const out: {
    id: string;
    source_id: string | null;
    source: string | null;
    balance: unknown;
    proposal_total: unknown;
    currency_id: unknown;
    balance_currency: unknown;
  }[] = [];

  if (newOr) {
    let offset = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('leads')
        .select('id, source_id, source, stage, balance, proposal_total, currency_id, balance_currency')
        .or(newOr)
        .order('created_at', { ascending: true })
        .range(offset, offset + 999);
      if (error) break;
      const batch = data || [];
      for (const row of batch) {
        const stage = parseStage((row as { stage?: unknown }).stage);
        if (stage == null || stage < SIGNED_STAGE || stage === 91) continue;
        out.push({
          id: String((row as { id: string }).id),
          source_id: leadSourceIdToString((row as { source_id?: unknown }).source_id),
          source: (row as { source?: string | null }).source ?? null,
          balance: (row as { balance?: unknown }).balance,
          proposal_total: (row as { proposal_total?: unknown }).proposal_total,
          currency_id: (row as { currency_id?: unknown }).currency_id,
          balance_currency: (row as { balance_currency?: unknown }).balance_currency,
        });
      }
      if (batch.length < 1000) break;
      offset += 1000;
      if (offset >= 40000) break;
    }
  }

  if (legacyOr) {
    let offset = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('leads_lead')
        .select('id, source_id, source, stage, balance, proposal_total, currency_id')
        .or(legacyOr)
        .order('id', { ascending: true })
        .range(offset, offset + 999);
      if (error) break;
      const batch = data || [];
      for (const row of batch) {
        const stage = parseStage((row as { stage?: unknown }).stage);
        if (stage == null || stage < SIGNED_STAGE || stage === 91) continue;
        out.push({
          id: `legacy-${(row as { id: number }).id}`,
          source_id: leadSourceIdToString((row as { source_id?: unknown }).source_id),
          source: (row as { source?: string | null }).source ?? null,
          balance: (row as { balance?: unknown }).balance,
          proposal_total: (row as { proposal_total?: unknown }).proposal_total,
          currency_id: (row as { currency_id?: unknown }).currency_id,
          balance_currency: null,
        });
      }
      if (batch.length < 1000) break;
      offset += 1000;
      if (offset >= 40000) break;
    }
  }

  return out;
}

async function fetchInvoicedNisByLeadId(
  newLeadIds: string[],
  legacyLeadNumericIds: number[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
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
      add(`legacy-${row.lead_id}`, paymentAmountToNis(row.value, resolveLegacyPaymentCurrency(row)));
    }
  }

  return map;
}

function resolveSourceId(
  lead: { source_id: string | null; source: string | null },
  sources: SourceRowLike[],
  locked: Set<string>,
): string | null {
  if (lead.source_id && locked.has(lead.source_id)) return lead.source_id;
  const name = (lead.source || '').trim().toLowerCase();
  if (!name) return lead.source_id && locked.has(String(lead.source_id)) ? String(lead.source_id) : null;
  const match = sources.find((s) => String(s.name || '').trim().toLowerCase() === name);
  if (match && locked.has(String(match.id))) return String(match.id);
  return lead.source_id && locked.has(String(lead.source_id)) ? String(lead.source_id) : null;
}

/** All-time leads / invoiced / revenue per assigned source — independent of report date filters. */
export async function fetchMySourcesAllTimeStats(sourceIds: string[]): Promise<MySourceAllTimeRow[]> {
  const unique = Array.from(new Set(sourceIds.map((id) => String(id).trim()).filter(Boolean)));
  if (unique.length === 0) return [];

  const sources = await fetchMiscLeadsourcesByIds(unique);
  const sourceRows: SourceRowLike[] = sources.map((s) => ({ id: s.id, name: s.name }));
  const locked = new Set(unique);

  const byId = new Map<string, MySourceAllTimeRow>();
  for (const id of unique) {
    const name = sources.find((s) => s.id === id)?.name || `Source #${id}`;
    byId.set(id, { id, name, leads: 0, invoicedNis: 0, revenueNis: 0 });
  }

  const counts = await Promise.all(unique.map((id) => countLeadsForSource(id, sourceRows)));
  unique.forEach((id, i) => {
    const row = byId.get(id);
    if (row) row.leads = counts[i] || 0;
  });

  const signed = await fetchSignedLeadsForSources(unique, sourceRows);
  const newIds = signed.filter((l) => !l.id.startsWith('legacy-')).map((l) => l.id);
  const legacyIds = signed
    .filter((l) => l.id.startsWith('legacy-'))
    .map((l) => Number(l.id.replace(/^legacy-/, '')))
    .filter((n) => Number.isFinite(n));
  const invoicedMap = await fetchInvoicedNisByLeadId(newIds, legacyIds);

  for (const lead of signed) {
    const sid = resolveSourceId(lead, sourceRows, locked);
    if (!sid) continue;
    const row = byId.get(sid);
    if (!row) continue;
    row.revenueNis += revenueNis(lead);
    row.invoicedNis += invoicedMap.get(lead.id) || 0;
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}
