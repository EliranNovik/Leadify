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
import { isPaymentPlanInvoiceSent, resolveInvoiceSentAt } from './markPaymentPlanInvoiceSent';

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

/*
 * The three invoice_sent columns are load-bearing, not informational.
 *
 * From the October cutover, `contributionIncomeCountsRow` counts a row only if an invoice was sent, so
 * omitting them makes `isPaymentPlanInvoiceSent` false for every row and Total income exactly zero —
 * with no error, because the `or` filter that widens the fetch is evaluated server-side and does not
 * need them selected. Listed inline rather than imported from `contributionDueInvoiced`, which imports
 * from this module.
 */
const INVOICE_SENT_SELECT_COLUMNS = 'invoice_sent, invoice_sent_at, invoice_send_automation_sent_at';

/** Exported for the test that asserts the invoice_sent columns stay in both selects. */
export const INVOICED_SELECTS_FOR_TEST = {
  get new() {
    return NEW_PAYMENT_SELECT;
  },
  get legacy() {
    return LEGACY_PAYMENT_SELECT;
  },
};

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
  paid_at,
  ${INVOICE_SENT_SELECT_COLUMNS}
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
  ${INVOICE_SENT_SELECT_COLUMNS},
  accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)
`;

const NEW_LEAD_SELECT = `
  id, lead_number, name, handler, closer, category_id, category, subcontractor_fee
`;

const LEGACY_LEAD_SELECT = `
  id, lead_number, name, case_handler_id, closer_id, category_id, category, subcontractor_fee,
  handler_employee:tenants_employee!fk_leads_lead_case_handler_id(id, display_name)
`;

/**
 * Restricts a fetch to named payment rows and supplies the day each one belongs to.
 *
 * The due-date measures can find their own rows and date them from `due_date`, but measures built on
 * an event — an invoice going out, a tax receipt being issued — cannot: the date lives on another
 * column or another table entirely. Those callers work out which rows qualify and when, and hand the
 * result here so that the money, department and subcontractor-fee logic below stays in one place
 * rather than being reimplemented per measure.
 */
export type InstallmentEventScope = {
  /** `payment_plans` ids to include. */
  newIds: Array<string | number>;
  /** `finances_paymentplanrow` ids to include. */
  legacyIds: Array<string | number>;
  /** Event day as YYYY-MM-DD, keyed by `installmentEventKey`. Rows missing an entry are dropped. */
  eventDateByRow: Map<string, string>;
};

/** Key into `InstallmentEventScope.eventDateByRow`, which spans both payment tables. */
export function installmentEventKey(
  source: 'new' | 'legacy',
  paymentId: string | number,
): string {
  return `${source}:${paymentId}`;
}

export type InvoicedInstallment = {
  source: 'new' | 'legacy';
  paymentId: string | number;
  /** Raw lead row, for callers that need names / roles / category labels. */
  lead: any;
  leadKey: string;
  leadNumber: string;
  /** YYYY-MM-DD. */
  dueDate: string;
  /**
   * The day this row belongs to. Equals `dueDate` for the due-based measures, and the supplied event
   * day under `eventScope`, where the due date may be absent or irrelevant.
   */
  eventDate: string;
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
   * The day the invoice went out as YYYY-MM-DD, or null when nothing recorded one.
   *
   * Null is not the same as `invoiceSent === false`: a row can be flagged sent by the boolean alone,
   * with no timestamp to date it. Those keep their due date — see `contributionIncomeDate`.
   */
  invoiceSentDate: string | null;
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
  /**
   * Also fetch rows whose invoice went out inside [dueFrom, dueTo] but that fall due outside it.
   *
   * Required by the income measure, which dates a row by the day its invoice was sent — an installment
   * invoiced in October and due next March is October income, and a due-date-selected fetch cannot see
   * it. Off for the due-based measures, which must keep selecting exactly the rows they always did.
   */
  includeInvoiceSentInWindow?: boolean;
  /**
   * Fetch exactly these rows and date them as given, instead of selecting by due date.
   *
   * `dueFrom` / `dueTo` are then no longer applied as filters — the caller has already decided
   * membership — though they are still required, so an empty window short-circuits as usual.
   */
  eventScope?: InstallmentEventScope;
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

  /*
   * Set only for the income measure, which dates a row by the day its invoice went out and so has to
   * accept rows falling due outside the window. Null leaves the queries on their plain due-date range.
   */
  const incomeWindow = options.includeInvoiceSentInWindow
    ? incomeWindowOrFilter('due_date', dueFrom, dueTo)
    : null;

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
      options.eventScope
        ? fetchByIdChunks<any>(options.eventScope.newIds, LEAD_ID_CHUNK_SIZE, (chunk) =>
            supabase
              .from('payment_plans')
              .select(NEW_PAYMENT_SELECT)
              .is('cancel_date', null)
              .in('id', chunk as string[]),
          )
        : fetchAllPagedRows((from, to) => {
            const base = supabase
              .from('payment_plans')
              .select(NEW_PAYMENT_SELECT)
              .not('due_date', 'is', null)
              .is('cancel_date', null);
            const query = (
              incomeWindow ? base.or(incomeWindow) : base.gte('due_date', dueFrom).lte('due_date', dueTo)
            )
              .order('id', { ascending: true })
              .range(from, to);
            // For the invoiced measure a row counts once its invoice went out, which does not reliably set
            // `ready_to_pay`; `countsAsDue` below still keeps those rows out of the due-based total.
            return options.includeInvoiceSentNotReadyToPay
              ? query.or(`ready_to_pay.eq.true,${INVOICE_SENT_OR_FILTER}`)
              : query.eq('ready_to_pay', true);
          }),
      options.eventScope
        ? fetchByIdChunks<any>(options.eventScope.legacyIds, LEAD_ID_CHUNK_SIZE, (chunk) =>
            supabase
              .from('finances_paymentplanrow')
              .select(LEGACY_PAYMENT_SELECT)
              .is('cancel_date', null)
              .in('id', chunk as number[]),
          )
        : fetchAllPagedRows((from, to) => {
            const base = supabase
              .from('finances_paymentplanrow')
              .select(LEGACY_PAYMENT_SELECT)
              .not('due_date', 'is', null)
              .is('cancel_date', null);
            return (
              incomeWindow ? base.or(incomeWindow) : base.gte('due_date', dueFrom).lte('due_date', dueTo)
            )
              .order('id', { ascending: true })
              .range(from, to);
          }),
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
      options.includeInvoiceSentNotReadyToPay && !options.eventScope
        ? fetchAllPagedRows((from, to) => {
            const base = supabase
              .from('finances_paymentplanrow')
              .select(LEGACY_PAYMENT_SELECT)
              .is('due_date', null)
              .is('cancel_date', null)
              .not('date', 'is', null)
              .or(INVOICE_SENT_OR_FILTER);
            // `date` stands in for the due date on these rows, which have none yet.
            const plannedDateWindow = options.includeInvoiceSentInWindow
              ? incomeWindowOrFilter('date', dueFrom, dueTo)
              : null;
            return (
              plannedDateWindow
                ? base.or(plannedDateWindow)
                : base.gte('date', dueFrom).lte('date', dueTo)
            )
              .order('id', { ascending: true })
              .range(from, to);
          })
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

    /*
     * Which period this row lands in.
     *
     * Under `eventScope` that is the day the caller recorded, and the due date is allowed to be
     * missing entirely — a row can have an invoice sent against it before it ever falls due.
     */
    const eventDate = options.eventScope
      ? options.eventScope.eventDateByRow.get(installmentEventKey(source, payment.id)) || null
      : dueDate;
    if (!eventDate) return;

    const rateAsOf = rateAsOfInput;
    const amountNisGross = await boiConverter.toNis(value, currency, rateAsOf);
    const leadNumber = leadDisplayNumber(lead, source === 'new');

    const key = `${leadNumber}|${eventDate}|${Math.round(amountNisGross || 0)}`;
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
      dueDate: dueDate || '',
      eventDate,
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
      invoiceSentDate: toDateOnlyKey(resolveInvoiceSentAt(payment)) || null,
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

/** Date-only form of a window bound, which callers pass as either an ISO timestamp or YYYY-MM-DD. */
function boundDay(value?: string | null): string {
  return String(value || '').slice(0, 10);
}

/**
 * A PostgREST `or` filter selecting rows whose income date falls in [from, to].
 *
 * The income measure cannot be expressed as a range on one column: from the cutover a row belongs to
 * the window because its *invoice* went out inside it, and its due date may be years away. So this
 * accepts either anchor, which makes it a deliberate superset — `contributionIncomeCountsRow` and
 * `dueInvoicedFilter` settle which of the returned rows actually count.
 *
 * `dueColumn` is `due_date` for both payment tables, or `date` for legacy rows that never reached
 * finance and so have no due date yet.
 *
 * Returns null for an unbounded window, where there is nothing to filter.
 */
export function incomeWindowOrFilter(
  dueColumn: string,
  from?: string | null,
  to?: string | null,
  invoiceSentFrom: string = INVOICE_SENT_INCOME_START_DATE,
): string | null {
  /*
   * An unbounded window has nothing to filter on, and must not fall through to the invoice-date arms
   * below: on their own they would exclude every row never invoiced since the cutover.
   */
  if (!from && !to) return null;

  const between = (column: string, start: string, end: string): string | null => {
    const parts: string[] = [];
    if (start) parts.push(`${column}.gte.${start}`);
    if (end) parts.push(`${column}.lte.${end}`);
    if (!parts.length) return null;
    return parts.length > 1 ? `and(${parts.join(',')})` : parts[0];
  };

  const cutover = boundDay(invoiceSentFrom);
  /*
   * The invoice-date arms start no earlier than the cutover: a row invoiced before it is still dated
   * by its due date, which the due arm already covers. A window closing before the cutover therefore
   * gets no invoice arms at all.
   */
  const sentFrom =
    cutover && (!from || boundDay(from) < cutover) ? cutover : String(from || '');
  const invoiceArms =
    cutover && to && boundDay(to) < cutover
      ? []
      : [
          between('invoice_sent_at', sentFrom, String(to || '')),
          between('invoice_send_automation_sent_at', sentFrom, String(to || '')),
        ];

  const arms = [
    between(dueColumn, String(from || ''), String(to || '')),
    ...invoiceArms,
  ].filter((arm): arm is string => Boolean(arm));

  return arms.length ? arms.join(',') : null;
}

/**
 * The day an installment's income falls on.
 *
 * From the cutover that is the day its invoice went out, the same day the Dashboard Invoiced
 * scoreboard files it under, because income is recognised when the client is billed rather than when
 * the installment comes due. A row invoiced before the cutover keeps its due date: re-dating it would
 * move it into a period that was closed on the due-date rule, where nothing would count it.
 *
 * The raw-row twin of this is `dueInvoicedIncomeDate` in `utils/contributionDueInvoiced`, which the
 * report's per-employee column uses. The two must agree; they are kept apart only because that module
 * already imports the cutover from here.
 */
export function contributionIncomeDate(
  row: Pick<InvoicedInstallment, 'dueDate' | 'invoiceSentDate'>,
  invoiceSentFrom: string = INVOICE_SENT_INCOME_START_DATE,
): string {
  const cutover = String(invoiceSentFrom || '').split('T')[0];
  const sent = row.invoiceSentDate || '';
  if (sent && cutover && sent >= cutover) return sent;
  return row.dueDate;
}

/**
 * Whether one installment counts as contribution income, ignoring the window.
 *
 * Split out from the sum so the per-employee Due / Invoiced column and the report total cannot drift:
 * both ask this same question of each row.
 */
export function contributionIncomeCountsRow(
  row: Pick<InvoicedInstallment, 'dueDate' | 'invoiceSent' | 'countsAsDue' | 'invoiceSentDate'>,
  invoiceSentFrom: string = INVOICE_SENT_INCOME_START_DATE,
): boolean {
  const cutover = String(invoiceSentFrom || '').split('T')[0];
  // Dated by the day its invoice went out, so having been sent is the entire condition.
  const sent = row.invoiceSentDate || '';
  if (sent && cutover && sent >= cutover) return true;
  if (cutover && row.dueDate >= cutover) return row.invoiceSent;
  return row.countsAsDue;
}

/**
 * Contribution income in a window: due-based before the cutover, invoice-based from it.
 *
 * Windowed on `contributionIncomeDate`, not on the due date. From the cutover a row belongs to the
 * month its invoice went out, so an installment invoiced in October and falling due next March is
 * October income — which is exactly what makes this figure comparable with the Dashboard Invoiced
 * scoreboard. A window spanning the cutover sums each half on its own basis rather than picking one
 * rule for the whole range, so a report covering September and October stays correct for both.
 *
 * Only sees rows the caller fetched. A due-date-selected fetch cannot contain everything invoiced in
 * the window, which is why `fetchContributionIncomeBreakdownNisForDateRange` widens its own queries.
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
    const incomeDate = contributionIncomeDate(row, cutover);
    if (!incomeDate || incomeDate < start || incomeDate > end) continue;
    if (!contributionIncomeCountsRow(row, cutover)) continue;
    sum += row.amountNisGross;
  }
  return Math.ceil(sum);
}
