/**
 * Single source of truth for "Invoiced" money: which payment installments count, what each is worth
 * in NIS, and which scoreboard department it belongs to.
 *
 * The Dashboard Invoiced scoreboard and the contribution report's "Total income" both read from
 * here. They previously carried independent copies of this logic and had drifted far apart — the
 * report was missing roughly half the money because its `payment_plans` query was unpaginated
 * (silently capped at one PostgREST page) and because it discarded any installment whose category
 * did not resolve to a scoreboard department instead of bucketing it into "Other".
 *
 * Amounts are ex-VAT and net of an allocated share of the lead's subcontractor fee. Both paid and
 * unpaid installments count — this is "invoiced", not "collected".
 */

import { supabase } from './supabase';
import {
  createBoiDateRateConverter,
  resolvePaymentPlanBoiAsOfInput,
  toDateOnlyKey,
  type BoiDateRateConverter,
} from './boiCurrencyConversion';
import {
  canonicalizeScoreboardDepartment,
  buildCategoryNameToDataMap,
  fetchCategoriesWithDepartments,
  resolveCategoryAndDepartment,
} from './resolveCategoryDepartment';
import {
  applySubcontractorFeeTotalsToLeads,
  fetchSubcontractorFeeTotalsByLeadIds,
  resolveLeadSubcontractorFeeAmount,
  type LeadSubcontractorFeeTotalsMaps,
} from './leadSubcontractorFees';
import { isPaymentPlanInvoiceSent } from './markPaymentPlanInvoiceSent';

/** The three columns that each record an invoice having been sent, as a PostgREST `or` list. */
const INVOICE_SENT_OR_FILTER =
  'invoice_sent.eq.true,invoice_sent_at.not.is.null,invoice_send_automation_sent_at.not.is.null';

export const INVOICED_PAGE_SIZE = 1000;
const INVOICED_FETCH_CONCURRENCY = 6;

type PagedQueryResult<T> = { data: T[] | null; error: any };

export function dedupeRowsById<T extends { id?: string | number | null }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (row?.id == null) continue;
    const id = String(row.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

export function parsePaymentDuePercent(value: unknown): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value.replace(/%/g, '').trim());
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

export function normalizeInvoicedCurrency(raw: unknown): string {
  const c = (raw != null && String(raw).trim() !== '' ? String(raw) : 'NIS').trim();
  if (c === '₪') return 'NIS';
  if (c === '€') return 'EUR';
  if (c === '$') return 'USD';
  if (c === '£') return 'GBP';
  return c;
}

/** Legacy rows carry currency via a joined row, else a numeric id. */
export function resolveLegacyPaymentCurrency(payment: any): string {
  const accountingCurrency: any = payment?.accounting_currencies
    ? (Array.isArray(payment.accounting_currencies)
        ? payment.accounting_currencies[0]
        : payment.accounting_currencies)
    : null;

  if (accountingCurrency?.name) return normalizeInvoicedCurrency(accountingCurrency.name);
  if (accountingCurrency?.iso_code) return normalizeInvoicedCurrency(accountingCurrency.iso_code);

  switch (payment?.currency_id) {
    case 2:
      return 'EUR';
    case 3:
      return 'USD';
    case 4:
      return 'GBP';
    default:
      return 'NIS';
  }
}

/** Allocate a lead's subcontractor fee onto one installment (prefer due_percent, else amount share). */
export function allocateInvoicedSubcontractorFeeNis(params: {
  feeTotalNis: number;
  rowAmountNis: number;
  leadPlanTotalNis: number;
  duePercent: number;
}): number {
  const fee = params.feeTotalNis || 0;
  if (fee <= 0) return 0;
  if (params.duePercent > 0) return fee * (params.duePercent / 100);
  if (params.leadPlanTotalNis > 0) return fee * (params.rowAmountNis / params.leadPlanTotalNis);
  return 0;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

/** Fetch rows in id-chunks so PostgREST `.in()` never blows past URL/body limits. */
export async function fetchByIdChunks<T>(
  ids: Array<string | number>,
  chunkSize: number,
  fetchChunk: (chunk: Array<string | number>) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const chunks: Array<Array<string | number>> = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    chunks.push(ids.slice(i, i + chunkSize));
  }
  const pages = await mapWithConcurrency(chunks, INVOICED_FETCH_CONCURRENCY, async (chunk) => {
    const { data, error } = await fetchChunk(chunk);
    if (error) throw error;
    return data || [];
  });
  return pages.flat();
}

/**
 * Page through PostgREST results; after a full first page, remaining pages load in parallel.
 * Every installment query must go through this — a bare select is capped at one page.
 */
export async function fetchAllPagedRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PagedQueryResult<T>>,
  pageSize = INVOICED_PAGE_SIZE,
): Promise<T[]> {
  const first = await fetchPage(0, pageSize - 1);
  if (first.error) throw first.error;
  const rows = [...(first.data || [])];
  if (rows.length < pageSize) return rows;

  let offset = pageSize;
  while (true) {
    const starts = [0, 1, 2, 3].map((i) => offset + i * pageSize);
    const pages = await Promise.all(starts.map((from) => fetchPage(from, from + pageSize - 1)));
    let short = false;
    for (const page of pages) {
      if (page.error) throw page.error;
      const batch = page.data || [];
      rows.push(...batch);
      if (batch.length < pageSize) {
        short = true;
        break;
      }
    }
    if (short) break;
    offset += starts.length * pageSize;
  }
  return rows;
}

/**
 * Lead ids per `.in()` request. Keeps the query string well inside PostgREST's URL limit while
 * still being few enough round trips to stay fast.
 */
export const LEAD_ID_CHUNK_SIZE = 300;

/**
 * Every matching row for a set of lead ids — id-chunked so the URL cannot overflow, and paged so
 * the 1000-row cap cannot silently truncate.
 *
 * `buildQuery` gets one chunk of ids and must apply all of its own filters; this adds the ORDER BY
 * and the range. Both are required: a bare select returns at most one page, and without an ORDER BY
 * *which* page comes back is arbitrary, so totals come out short in a way that looks plausible.
 *
 * Throws on the first query error rather than returning partial rows — a short total is worse than
 * a visible failure when the number is money.
 */
export async function fetchAllRowsForLeadIds<T>(
  leadIds: Array<string | number>,
  buildQuery: (chunk: Array<string | number>) => any,
  orderColumn = 'id',
): Promise<T[]> {
  if (leadIds.length === 0) return [];

  const chunks: Array<Array<string | number>> = [];
  for (let i = 0; i < leadIds.length; i += LEAD_ID_CHUNK_SIZE) {
    chunks.push(leadIds.slice(i, i + LEAD_ID_CHUNK_SIZE));
  }

  const pages = await mapWithConcurrency(chunks, INVOICED_FETCH_CONCURRENCY, (chunk) =>
    fetchAllPagedRows<T>((from, to) =>
      buildQuery(chunk).order(orderColumn, { ascending: true }).range(from, to),
    ),
  );
  return pages.flat();
}

export type InvoicedDepartmentTarget = {
  id: number;
  name: string;
  min_income?: string | number | null;
  important?: string | null;
  [key: string]: any;
};

/**
 * The departments that get their own scoreboard column. Department 20 is surfaced as
 * "Commercial & Civil" and its duplicate rows are dropped so the two names cannot both appear.
 */
export async function fetchInvoicedDepartmentTargets(): Promise<{
  departmentTargets: InvoicedDepartmentTarget[];
  departmentIds: number[];
}> {
  const { data: allDepartments, error } = await supabase
    .from('tenant_departement')
    .select('id, name, min_income, important')
    .eq('important', 't')
    .order('id');
  if (error) throw error;

  const deptTargets = (allDepartments || []).filter((dept: any) => {
    if (dept.id === 20) return true;
    if (dept.name === 'Commercial - Sales' || dept.name?.includes('Commercial - Sales')) return false;
    const hasDept20 = (allDepartments || []).some((d: any) => d.id === 20);
    if (hasDept20 && (dept.name === 'Commercial & Civil' || dept.name?.includes('Commercial & Civil'))) {
      return false;
    }
    return true;
  });

  const departmentTargets = deptTargets.map((dept: any) =>
    dept.id === 20 ? { ...dept, name: 'Commercial & Civil' } : dept,
  ) as InvoicedDepartmentTarget[];

  return { departmentTargets, departmentIds: departmentTargets.map((d) => d.id) };
}

const NEW_PAYMENT_SELECT = `
  id,
  lead_id,
  value,
  value_vat,
  currency,
  due_date,
  due_percent,
  cancel_date,
  ready_to_pay,
  paid,
  paid_at
`;

const LEGACY_PAYMENT_SELECT = `
  id,
  lead_id,
  client_id,
  value,
  value_base,
  vat_value,
  currency_id,
  due_date,
  due_percent,
  date,
  cancel_date,
  ready_to_pay,
  actual_date,
  accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)
`;

const NEW_LEAD_SELECT = `
  id, lead_number, name, handler, closer, category_id, category, subcontractor_fee
`;

const LEGACY_LEAD_SELECT = `
  id, lead_number, name, case_handler_id, closer_id, category_id, category, subcontractor_fee,
  handler_employee:tenants_employee!fk_leads_lead_case_handler_id(id, display_name)
`;

export type InvoicedInstallment = {
  source: 'new' | 'legacy';
  paymentId: string | number;
  /** Raw lead row, for callers that need names / roles / category labels. */
  lead: any;
  leadKey: string;
  leadNumber: string;
  /** YYYY-MM-DD. */
  dueDate: string;
  /** Ex-VAT value converted to NIS, before the subcontractor fee share. */
  amountNisGross: number;
  subcontractorFeeNis: number;
  /** What the scoreboard and income totals count: gross minus the allocated fee share. */
  amountNis: number;
  duePercent: number;
  contactName: string | null;
  departmentId: number | null;
  departmentName: string;
  mainCategoryId: number | null;
  mainCategoryName: string | null;
  currency: string;
  rateAsOf: string | null;
  /** Whether an invoice was actually sent for this row, by any of the three columns that record it. */
  invoiceSent: boolean;
  /**
   * Whether the row reached finance and so belongs in the due-based total.
   *
   * Separate from `invoiceSent` because the two measures diverge: a legacy row can be invoiced while
   * still carrying no due date, which makes it income but never makes it due.
   */
  countsAsDue: boolean;
};

export type FetchInvoicedInstallmentsOptions = {
  /** Inclusive YYYY-MM-DD window on `due_date`. Widen it to cover every bucket you need. */
  dueFrom: string;
  dueTo: string;
  /** Accepts a pending converter so callers can load BOI rates alongside the payment queries. */
  boiConverter?: BoiDateRateConverter | PromiseLike<BoiDateRateConverter>;
  departmentTargets?: InvoicedDepartmentTarget[];
  allCategoriesData?: any[] | null;
  categoryNameToDataMap?: Map<string, any>;
  /** Contact names cost two extra queries and are only needed for the deals modal. */
  includeContactNames?: boolean;
  /**
   * Also fetch rows that were invoiced but never reached finance.
   *
   * Only the Simple Contribution report's income measure wants these. The Dashboard scoreboard and
   * `SalesContributionPage` must keep the pure due-based set, so this stays off by default.
   */
  includeInvoiceSentNotReadyToPay?: boolean;
};

export type FetchInvoicedInstallmentsResult = {
  installments: InvoicedInstallment[];
  departmentTargets: InvoicedDepartmentTarget[];
  departmentIds: number[];
  allCategoriesData: any[] | null;
  categoryNameToDataMap: Map<string, any>;
};

/**
 * Fetch every invoiced installment due in [dueFrom, dueTo] and normalise it: NIS conversion at the
 * Bank of Israel rate as of payment (paid → paid date, otherwise due date), scoreboard department,
 * and the installment's share of its lead's subcontractor fee.
 *
 * Duplicate installments (pagination overlap, or the same plan present in both the new and legacy
 * tables) are collapsed on lead number + due date + rounded amount.
 */
export async function fetchInvoicedInstallments(
  options: FetchInvoicedInstallmentsOptions,
): Promise<FetchInvoicedInstallmentsResult> {
  const dueFrom = String(options.dueFrom || '').split('T')[0];
  const dueTo = String(options.dueTo || '').split('T')[0];
  if (!dueFrom || !dueTo || dueFrom > dueTo) {
    return {
      installments: [],
      departmentTargets: options.departmentTargets || [],
      departmentIds: (options.departmentTargets || []).map((d) => d.id),
      allCategoriesData: options.allCategoriesData ?? null,
      categoryNameToDataMap: options.categoryNameToDataMap ?? new Map(),
    };
  }

  const boiPromise = options.boiConverter
    ? Promise.resolve(options.boiConverter)
    : createBoiDateRateConverter();

  const departmentsPromise = options.departmentTargets
    ? Promise.resolve({
        departmentTargets: options.departmentTargets,
        departmentIds: options.departmentTargets.map((d) => d.id),
      })
    : fetchInvoicedDepartmentTargets();

  const categoriesPromise = options.allCategoriesData
    ? Promise.resolve(options.allCategoriesData)
    : fetchCategoriesWithDepartments(supabase).catch((err) => {
        console.error('[invoiced] categories fetch failed:', err);
        return null;
      });

  const [
    { departmentTargets, departmentIds },
    allCategoriesData,
    newPaymentsRaw,
    legacyPaymentsRaw,
    legacyInvoicedNoDueDateRaw,
  ] = await Promise.all([
      departmentsPromise,
      categoriesPromise,
      fetchAllPagedRows((from, to) => {
        const query = supabase
          .from('payment_plans')
          .select(NEW_PAYMENT_SELECT)
          .not('due_date', 'is', null)
          .is('cancel_date', null)
          .gte('due_date', dueFrom)
          .lte('due_date', dueTo)
          .order('id', { ascending: true })
          .range(from, to);
        // For the invoiced measure a row counts once its invoice went out, which does not reliably set
        // `ready_to_pay`; `countsAsDue` below still keeps those rows out of the due-based total.
        return options.includeInvoiceSentNotReadyToPay
          ? query.or(`ready_to_pay.eq.true,${INVOICE_SENT_OR_FILTER}`)
          : query.eq('ready_to_pay', true);
      }),
      fetchAllPagedRows((from, to) =>
        supabase
          .from('finances_paymentplanrow')
          .select(LEGACY_PAYMENT_SELECT)
          .not('due_date', 'is', null)
          .is('cancel_date', null)
          .gte('due_date', dueFrom)
          .lte('due_date', dueTo)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      /*
       * Legacy rows invoiced in the window that never got a due date.
       *
       * A legacy row keeps `due_date` NULL until someone sends it to finance, holding only the planned
       * `date`. Those rows are invisible to the query above, yet an invoice really was sent for them,
       * so for the invoiced measure they are income. Anchored on `date`, which is where the period
       * lives while `due_date` is still NULL.
       *
       * Only fetched for the widened (invoiced) measure — the due-based total must keep counting
       * exactly the rows it always did.
       */
      options.includeInvoiceSentNotReadyToPay
        ? fetchAllPagedRows((from, to) =>
            supabase
              .from('finances_paymentplanrow')
              .select(LEGACY_PAYMENT_SELECT)
              .is('due_date', null)
              .is('cancel_date', null)
              .not('date', 'is', null)
              .gte('date', dueFrom)
              .lte('date', dueTo)
              .or(INVOICE_SENT_OR_FILTER)
              .order('id', { ascending: true })
              .range(from, to),
          )
        : Promise.resolve([] as any[]),
    ]);

  const categoryNameToDataMap =
    options.categoryNameToDataMap ?? buildCategoryNameToDataMap(allCategoriesData);

  const newPayments = dedupeRowsById((newPaymentsRaw || []).filter((p: any) => !p.cancel_date));
  const legacyPayments = dedupeRowsById(
    [...(legacyPaymentsRaw || []), ...(legacyInvoicedNoDueDateRaw || [])].filter((p: any) => !p.cancel_date),
  );

  const newLeadIds = Array.from(new Set(newPayments.map((p: any) => p.lead_id).filter(Boolean)));
  const legacyLeadIds = Array.from(
    new Set(legacyPayments.map((p: any) => p.lead_id).filter(Boolean)),
  )
    .map((id) => Number(id))
    .filter((id) => !Number.isNaN(id));
  const legacyContactIds = Array.from(
    new Set(
      legacyPayments
        .map((p: any) => p.client_id)
        .filter(Boolean)
        .map((id: any) => Number(id))
        .filter((id: number) => !Number.isNaN(id)),
    ),
  );

  const wantContacts = options.includeContactNames === true;

  const [newLeadsRows, legacyLeadsRows, feeMaps, newMainContacts, newFallbackContacts, legacyContactRows] =
    await Promise.all([
      fetchByIdChunks(newLeadIds as Array<string | number>, 500, (chunk) =>
        supabase.from('leads').select(NEW_LEAD_SELECT).in('id', chunk as string[]),
      ).catch((err) => {
        console.error('[invoiced] new leads fetch failed:', err);
        return [] as any[];
      }),
      fetchByIdChunks(legacyLeadIds, 500, (chunk) =>
        supabase.from('leads_lead').select(LEGACY_LEAD_SELECT).in('id', chunk as number[]),
      ).catch((err) => {
        console.error('[invoiced] legacy leads fetch failed:', err);
        return [] as any[];
      }),
      fetchSubcontractorFeeTotalsByLeadIds({
        newLeadIds: newLeadIds as string[],
        legacyLeadIds,
      }).catch((err) => {
        console.warn('[invoiced] subcontractor fee totals failed:', err);
        return {
          byNewLeadId: new Map<string, number>(),
          byLegacyLeadId: new Map<number, number>(),
        } as LeadSubcontractorFeeTotalsMaps;
      }),
      wantContacts
        ? fetchByIdChunks(newLeadIds as Array<string | number>, 500, (chunk) =>
            supabase
              .from('lead_leadcontact')
              .select('newlead_id, main, leads_contact:contact_id(name)')
              .eq('main', 'true')
              .in('newlead_id', chunk as string[]),
          ).catch(() => [] as any[])
        : Promise.resolve([] as any[]),
      wantContacts
        ? fetchByIdChunks(newLeadIds as Array<string | number>, 500, (chunk) =>
            supabase
              .from('contacts')
              .select('id, name, lead_id')
              .in('lead_id', chunk as string[])
              .eq('is_persecuted', false),
          ).catch(() => [] as any[])
        : Promise.resolve([] as any[]),
      wantContacts
        ? fetchByIdChunks(legacyContactIds, 1000, (chunk) =>
            supabase.from('leads_contact').select('id, name').in('id', chunk as number[]),
          ).catch((err) => {
            console.error('[invoiced] legacy contacts fetch failed:', err);
            return [] as any[];
          })
        : Promise.resolve([] as any[]),
    ]);

  const newLeadsMap = new Map<any, any>();
  newLeadsRows.forEach((lead: any) => newLeadsMap.set(lead.id, lead));

  const legacyLeadsMap = new Map<any, any>();
  legacyLeadsRows.forEach((lead: any) => {
    const key = lead.id?.toString() || String(lead.id);
    legacyLeadsMap.set(key, lead);
    if (typeof lead.id === 'number') legacyLeadsMap.set(lead.id, lead);
  });

  applySubcontractorFeeTotalsToLeads(
    Array.from(
      new Map(Array.from(newLeadsMap.values()).map((l: any) => [String(l.id), l])).values(),
    ) as any[],
    feeMaps,
    'new',
  );
  applySubcontractorFeeTotalsToLeads(
    Array.from(
      new Map(
        Array.from(legacyLeadsMap.values()).map((l: any) => [
          String(l.id).replace(/^legacy_/i, ''),
          l,
        ]),
      ).values(),
    ) as any[],
    feeMaps,
    'legacy',
  );

  const newLeadContactByLeadId = new Map<string, string>();
  newMainContacts.forEach((entry: any) => {
    const leadId = entry.newlead_id != null ? String(entry.newlead_id) : '';
    const contactRel = Array.isArray(entry.leads_contact) ? entry.leads_contact[0] : entry.leads_contact;
    const contactName = (contactRel?.name || '').toString().trim();
    if (leadId && contactName) newLeadContactByLeadId.set(leadId, contactName);
  });
  newFallbackContacts.forEach((contact: any) => {
    const leadId = contact.lead_id != null ? String(contact.lead_id) : '';
    const contactName = (contact.name || '').toString().trim();
    if (leadId && contactName && !newLeadContactByLeadId.has(leadId)) {
      newLeadContactByLeadId.set(leadId, contactName);
    }
  });
  const legacyContactById = new Map<number, string>();
  legacyContactRows.forEach((contact: any) => {
    if (contact.id != null && contact.name) {
      legacyContactById.set(Number(contact.id), String(contact.name).trim());
    }
  });

  const boiConverter = await boiPromise;

  const leadDisplayNumber = (lead: any, isNewLead: boolean): string => {
    if (!lead) return '';
    if (lead.lead_number != null && String(lead.lead_number).trim()) return String(lead.lead_number);
    if (lead.display_lead_number != null && String(lead.display_lead_number).trim()) {
      return String(lead.display_lead_number);
    }
    return isNewLead ? `L${lead.id}` : String(lead.id ?? '');
  };

  const seen = new Set<string>();
  const installments: InvoicedInstallment[] = [];
  const leadPlanTotalNis = new Map<string, number>();
  const leadFeeNis = new Map<string, number>();

  const prepare = async (
    payment: any,
    lead: any,
    source: 'new' | 'legacy',
    currency: string,
    rateAsOfInput: string | null,
    value: number,
    contactName: string | null,
  ) => {
    /*
     * Which period this installment belongs to.
     *
     * Legacy rows fall back to the planned `date`, because `due_date` stays NULL until someone sends
     * the row to finance — an invoice can be sent well before that, and it still has to land in the
     * month it went out. New-lead rows always carry a `due_date`, so the fallback never applies.
     */
    const dueDate =
      toDateOnlyKey(payment.due_date) ||
      (source === 'legacy' ? toDateOnlyKey(payment.date) : null);
    if (!dueDate) return;

    const rateAsOf = rateAsOfInput;
    const amountNisGross = await boiConverter.toNis(value, currency, rateAsOf);
    const leadNumber = leadDisplayNumber(lead, source === 'new');

    const key = `${leadNumber}|${dueDate}|${Math.round(amountNisGross || 0)}`;
    if (seen.has(key)) return;
    seen.add(key);

    const leadKey = String(payment.lead_id || lead.id);
    leadPlanTotalNis.set(leadKey, (leadPlanTotalNis.get(leadKey) || 0) + amountNisGross);
    if (!leadFeeNis.has(leadKey)) {
      const feeRaw = resolveLeadSubcontractorFeeAmount(lead, feeMaps, source);
      leadFeeNis.set(
        leadKey,
        feeRaw > 0 ? await boiConverter.toNis(feeRaw, currency, rateAsOf) : 0,
      );
    }

    const resolved = canonicalizeScoreboardDepartment(
      resolveCategoryAndDepartment(
        lead.category,
        lead.category_id,
        lead.misc_category,
        allCategoriesData,
        categoryNameToDataMap,
      ),
      departmentTargets,
    );

    installments.push({
      source,
      paymentId: payment.id,
      lead,
      leadKey,
      leadNumber,
      dueDate,
      amountNisGross,
      subcontractorFeeNis: 0,
      amountNis: amountNisGross,
      duePercent: parsePaymentDuePercent(payment.due_percent),
      contactName,
      departmentId: resolved.departmentId,
      departmentName: resolved.departmentName,
      mainCategoryId: resolved.mainCategoryId,
      mainCategoryName: resolved.mainCategoryName,
      currency,
      rateAsOf,
      invoiceSent: isPaymentPlanInvoiceSent(payment),
      // A legacy row with no `due_date` never fell due, so it must not reach the due-based total even
      // though the widened fetch pulled it in for the invoiced one.
      countsAsDue:
        source === 'legacy' ? Boolean(toDateOnlyKey(payment.due_date)) : Boolean(payment.ready_to_pay),
    });
  };

  for (const payment of newPayments as any[]) {
    const lead = newLeadsMap.get(payment.lead_id);
    if (!lead) continue;
    await prepare(
      payment,
      lead,
      'new',
      normalizeInvoicedCurrency(payment.currency),
      toDateOnlyKey(
        resolvePaymentPlanBoiAsOfInput({
          paid: payment.paid,
          paid_at: payment.paid_at,
          due_date: payment.due_date,
        }),
      ),
      Number(payment.value || 0),
      newLeadContactByLeadId.get(String(payment.lead_id || lead.id)) || null,
    );
  }

  for (const payment of legacyPayments as any[]) {
    const leadIdKey = payment.lead_id?.toString() || String(payment.lead_id);
    const leadIdNum = typeof payment.lead_id === 'number' ? payment.lead_id : Number(payment.lead_id);
    const lead = legacyLeadsMap.get(leadIdKey) || legacyLeadsMap.get(leadIdNum);
    if (!lead) continue;

    const contactId = payment.client_id != null ? Number(payment.client_id) : null;
    await prepare(
      payment,
      lead,
      'legacy',
      resolveLegacyPaymentCurrency(payment),
      toDateOnlyKey(
        resolvePaymentPlanBoiAsOfInput({
          actual_date: payment.actual_date,
          // Falls back to the planned date so a row still awaiting finance converts at its own date
          // rather than at today's rate.
          due_date: payment.due_date ?? payment.date,
        }),
      ),
      Number(payment.value || payment.value_base || 0),
      contactId != null && !Number.isNaN(contactId) ? legacyContactById.get(contactId) || null : null,
    );
  }

  // Fee allocation needs each lead's full plan total, so it can only run once every row is known.
  for (const row of installments) {
    row.subcontractorFeeNis = allocateInvoicedSubcontractorFeeNis({
      feeTotalNis: leadFeeNis.get(row.leadKey) || 0,
      rowAmountNis: row.amountNisGross,
      leadPlanTotalNis: leadPlanTotalNis.get(row.leadKey) || 0,
      duePercent: row.duePercent,
    });
    row.amountNis = row.amountNisGross - row.subcontractorFeeNis;
  }

  return {
    installments,
    departmentTargets,
    departmentIds,
    allCategoriesData,
    categoryNameToDataMap,
  };
}

/** Inclusive sum of `amountNis` for installments due in [from, to]. Matches the scoreboard Total. */
export function sumInvoicedNisInRange(
  installments: InvoicedInstallment[],
  from: string,
  to: string,
): number {
  const start = String(from || '').split('T')[0];
  const end = String(to || '').split('T')[0];
  if (!start || !end || start > end) return 0;
  let sum = 0;
  for (const row of installments) {
    // Invoiced-but-never-due rows are income, not due money — see `countsAsDue`.
    if (!row.countsAsDue) continue;
    if (row.dueDate >= start && row.dueDate <= end) sum += row.amountNis;
  }
  return Math.ceil(sum);
}

/**
 * The day the contribution report's income measure switches from "fell due" to "invoice was sent".
 *
 * Before this date the only signal available was the due date, so re-deciding history on invoice data
 * that was never recorded would silently rewrite every past month's numbers.
 */
export const INVOICE_SENT_INCOME_START_DATE = '2026-10-01';

/**
 * Whether one installment counts as contribution income.
 *
 * Split out from the sum so the per-employee Due / Invoiced column and the report total cannot drift:
 * both ask this same question of each row.
 */
export function contributionIncomeCountsRow(
  row: Pick<InvoicedInstallment, 'dueDate' | 'invoiceSent' | 'countsAsDue'>,
  invoiceSentFrom: string = INVOICE_SENT_INCOME_START_DATE,
): boolean {
  const cutover = String(invoiceSentFrom || '').split('T')[0];
  if (cutover && row.dueDate >= cutover) return row.invoiceSent;
  return row.countsAsDue;
}

/**
 * Contribution income in a window: due-based before the cutover, invoice-based from it.
 *
 * A window spanning the cutover sums each half on its own basis rather than picking one rule for the
 * whole range, so a report covering September and October stays correct for both.
 *
 * Sums `amountNisGross`, not `amountNis`, and that difference is the point. The contribution report's
 * Total income has to be the plain sum of the rows its per-employee Due / Invoiced column counts, and
 * that column never deducts the subcontractor fee. Summing the net figure here made the report header
 * quietly smaller than the column beneath it. The Dashboard scoreboard keeps the net measure through
 * `sumInvoicedNisInRange`.
 */
export function sumContributionIncomeNisInRange(
  installments: InvoicedInstallment[],
  from: string,
  to: string,
  invoiceSentFrom: string = INVOICE_SENT_INCOME_START_DATE,
): number {
  const start = String(from || '').split('T')[0];
  const end = String(to || '').split('T')[0];
  if (!start || !end || start > end) return 0;
  const cutover = String(invoiceSentFrom || '').split('T')[0];
  let sum = 0;
  for (const row of installments) {
    if (row.dueDate < start || row.dueDate > end) continue;
    if (!contributionIncomeCountsRow(row, cutover)) continue;
    sum += row.amountNisGross;
  }
  return Math.ceil(sum);
}
