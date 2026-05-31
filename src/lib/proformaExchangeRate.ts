/**
 * Proforma / payment NIS conversion — bulletproof rules:
 * 1) Unpaid / checkout preview → pelecardCharge lock when session exists
 * 2) Paid → BOI rows with created_at <= payment instant (link_paid_at / paid_at)
 * 3) Paid + lock rateDate matches payment-time BOI → use chargeTotalNis for exact Pelecard total
 */
import { supabase } from './supabase';
import {
  type BoiRatesSnapshot,
  type CurrencyInput,
  buildCurrencyMetaFromId,
  convertToNISWithMeta,
  getBoiCoverageStartDate,
  getJerusalemDateFromTimestamp,
  getJerusalemTodayIsoDate,
  isLocalCurrency,
  loadAccountingCurrenciesMap,
  loadBoiExchangeRatesAsOf,
  loadBoiExchangeRatesForDate,
  resolveBoiAsOfTimestamp,
  resolveCurrencyIsoCode,
} from './boiCurrencyConversion';
import {
  convertAmountWithLegacyRate,
  loadLatestLegacyCurrencyRate,
  loadLegacyCurrencyRateForPaymentDate,
} from './legacyCurrencyRates';

export type ProformaExchangeRateLabel = 'today' | 'payment_date';
export type ProformaRateSource = 'boi' | 'legacy';

export type ProformaExchangeRateInfo = {
  isoCode: string;
  displaySymbol: string;
  rateToIls: number;
  /** Publication / effective date used for the rate */
  rateDate: string;
  rateLabel: ProformaExchangeRateLabel;
  rateSource: ProformaRateSource;
  isLocalCurrency: boolean;
  paid: boolean;
  paidAt: string | null;
  subtotalNis: number;
  vatNis: number;
  totalNis: number;
  usedLegacyFallback: boolean;
};

/** Rate locked when Pelecard session is created (matches backend charge). */
export type LockedBoiChargeSnapshot = {
  rateToIls: number;
  rateDate: string;
  chargeTotalNis?: number;
  /** Moment used for BOI as-of lookup at checkout (ISO). */
  lockedAt?: string;
  /** boi_exchange_rates.created_at of the row used for charge. */
  rateCreatedAt?: string;
};

export type FetchProformaExchangeRateParams = {
  currency: CurrencyInput;
  paid?: boolean;
  paidAt?: string | null;
  subtotal: number;
  vat?: number;
  total: number;
  /** finances_paymentplanrow.id or payment_plans.id — used to load Pelecard charge / payment timestamps. */
  paymentPlanId?: number | string | null;
  /** Skip RPC when caller already loaded exchange context (batch reports). */
  preloadedExchangeContext?: PaymentPlanExchangeContext | null;
  /** When set, skips live BOI lookup and uses the checkout charge snapshot. */
  lockedBoiCharge?: LockedBoiChargeSnapshot | null;
};

export type PaymentPlanExchangeContext = {
  pelecardCharge: LockedBoiChargeSnapshot | null;
  linkPaidAt: string | null;
  lockedAt: string | null;
};

function toDateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function parseLockedBoiCharge(raw: unknown): LockedBoiChargeSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const charge = raw as Record<string, unknown>;
  const rateToIls = Number(charge.rateToIls);
  const rateDateRaw = charge.rateDate;
  const rateDate =
    rateDateRaw != null && String(rateDateRaw).trim()
      ? String(rateDateRaw).slice(0, 10)
      : null;
  if (!rateDate || !Number.isFinite(rateToIls) || rateToIls <= 0) return null;
  const chargeTotalNis = charge.chargeTotalNis != null ? Number(charge.chargeTotalNis) : undefined;
  const lockedAt =
    charge.lockedAt != null && String(charge.lockedAt).trim()
      ? String(charge.lockedAt)
      : undefined;
  const rateCreatedAt =
    charge.rateCreatedAt != null && String(charge.rateCreatedAt).trim()
      ? String(charge.rateCreatedAt)
      : undefined;
  return {
    rateToIls,
    rateDate,
    ...(Number.isFinite(chargeTotalNis) ? { chargeTotalNis } : {}),
    ...(lockedAt ? { lockedAt } : {}),
    ...(rateCreatedAt ? { rateCreatedAt } : {}),
  };
}

export function lockedBoiChargeFromPaymentLinkRaw(
  pelecardRawResponse: unknown,
): LockedBoiChargeSnapshot | null {
  if (!pelecardRawResponse || typeof pelecardRawResponse !== 'object') return null;
  const raw = pelecardRawResponse as Record<string, unknown>;
  return parseLockedBoiCharge(raw.pelecardCharge);
}

function parsePaymentPlanId(raw: number | string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const id = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  return Number.isFinite(id) ? id : null;
}

function parsePaymentPlanExchangeContext(raw: unknown): PaymentPlanExchangeContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  return {
    pelecardCharge: parseLockedBoiCharge(obj.pelecard_charge ?? obj.pelecardCharge),
    linkPaidAt:
      obj.link_paid_at != null && String(obj.link_paid_at).trim()
        ? String(obj.link_paid_at)
        : null,
    lockedAt:
      obj.locked_at != null && String(obj.locked_at).trim() ? String(obj.locked_at) : null,
  };
}

export async function fetchPaymentPlanExchangeContext(
  paymentPlanId: number | string,
): Promise<PaymentPlanExchangeContext | null> {
  const planId = parsePaymentPlanId(paymentPlanId);
  if (planId == null) return null;

  const { data, error } = await supabase.rpc('get_payment_plan_exchange_context', {
    p_payment_plan_id: planId,
  });

  if (error) {
    console.warn('[proformaExchangeRate] fetchPaymentPlanExchangeContext RPC:', error.message);
    return fetchPaymentPlanExchangeContextDirect(planId);
  }

  return enrichExchangeContextWithLockedCharge(planId, parsePaymentPlanExchangeContext(data));
}

async function fetchPaymentPlanExchangeContextDirect(
  planId: number,
): Promise<PaymentPlanExchangeContext | null> {
  const { data: rows, error: directError } = await supabase
    .from('payment_links')
    .select('paid_at, pelecard_raw_response, updated_at')
    .eq('payment_plan_id', planId)
    .in('status', ['processing', 'paid'])
    .order('updated_at', { ascending: false })
    .limit(10);

  if (directError || !rows?.length) return null;

  const withCharge = rows.find((row) =>
    Boolean(lockedBoiChargeFromPaymentLinkRaw(row.pelecard_raw_response)),
  );
  const row = withCharge ?? rows[0];
  const charge = lockedBoiChargeFromPaymentLinkRaw(row.pelecard_raw_response);
  return enrichExchangeContextWithLockedCharge(planId, {
    pelecardCharge: charge,
    linkPaidAt: row.paid_at ?? null,
    lockedAt: charge?.lockedAt ?? null,
  });
}

async function enrichExchangeContextWithLockedCharge(
  planId: number,
  ctx: PaymentPlanExchangeContext | null,
): Promise<PaymentPlanExchangeContext | null> {
  if (!ctx) return null;
  if (ctx.pelecardCharge) return ctx;

  const { data: chargeData, error: chargeErr } = await supabase.rpc(
    'get_locked_pelecard_charge_for_payment_plan',
    { p_payment_plan_id: planId },
  );

  if (chargeErr || !chargeData) return ctx;

  const charge = parseLockedBoiCharge(chargeData);
  if (!charge) return ctx;

  return {
    ...ctx,
    pelecardCharge: charge,
    lockedAt: charge.lockedAt ?? ctx.lockedAt,
  };
}

export async function fetchPaymentPlanExchangeContexts(
  paymentPlanIds: Array<number | string>,
): Promise<Map<number, PaymentPlanExchangeContext>> {
  const ids = [
    ...new Set(
      paymentPlanIds
        .map((id) => parsePaymentPlanId(id))
        .filter((id): id is number => id != null),
    ),
  ];
  if (!ids.length) return new Map();

  const { data, error } = await supabase.rpc('get_payment_plan_exchange_contexts', {
    p_payment_plan_ids: ids,
  });

  if (error) {
    console.warn('[proformaExchangeRate] fetchPaymentPlanExchangeContexts:', error.message);
    return new Map();
  }

  const map = new Map<number, PaymentPlanExchangeContext>();
  const obj = (data ?? {}) as Record<string, unknown>;
  for (const [key, rawCtx] of Object.entries(obj)) {
    const planId = parseInt(key, 10);
    if (!Number.isFinite(planId)) continue;
    const ctx = parsePaymentPlanExchangeContext(rawCtx);
    if (ctx) map.set(planId, ctx);
  }

  const missingChargeIds = [...map.entries()]
    .filter(([, ctx]) => !ctx.pelecardCharge)
    .map(([id]) => id);
  if (missingChargeIds.length) {
    const { data: chargesData, error: chargesErr } = await supabase.rpc(
      'get_locked_pelecard_charges_for_payment_plans',
      { p_payment_plan_ids: missingChargeIds },
    );
    if (!chargesErr && chargesData && typeof chargesData === 'object') {
      for (const [key, rawCharge] of Object.entries(chargesData as Record<string, unknown>)) {
        const planId = parseInt(key, 10);
        if (!Number.isFinite(planId)) continue;
        const charge = parseLockedBoiCharge(rawCharge);
        const ctx = map.get(planId);
        if (charge && ctx) {
          map.set(planId, {
            ...ctx,
            pelecardCharge: charge,
            lockedAt: charge.lockedAt ?? ctx.lockedAt,
          });
        }
      }
    }
  }

  return map;
}

/** Payment instant for as-of BOI lookup (created_at <= this moment). */
export function resolvePaymentBoiAsOf(
  paid: boolean,
  paidAt: string | null | undefined,
  ctx: PaymentPlanExchangeContext | null | undefined,
): string {
  if (paid && ctx?.linkPaidAt) return resolveBoiAsOfTimestamp(ctx.linkPaidAt);
  if (paid && paidAt) return resolveBoiAsOfTimestamp(paidAt);
  if (ctx?.pelecardCharge?.lockedAt) {
    return resolveBoiAsOfTimestamp(ctx.pelecardCharge.lockedAt);
  }
  return new Date().toISOString();
}

/** Lock applies to paid totals only when checkout used the same BOI rate_date as payment-time lookup. */
export function chargeLockMatchesBoiSnapshot(
  locked: LockedBoiChargeSnapshot | null | undefined,
  snap: BoiRatesSnapshot,
): boolean {
  if (!locked) return false;
  return locked.rateDate.slice(0, 10) === snap.rateDate.slice(0, 10);
}

export function applyLockedChargeTotalIfMatching(
  locked: LockedBoiChargeSnapshot | null | undefined,
  snap: BoiRatesSnapshot,
  subtotalNis: number,
  vatNis: number,
  totalNis: number,
): { subtotalNis: number; vatNis: number; totalNis: number } {
  if (
    !locked ||
    !chargeLockMatchesBoiSnapshot(locked, snap) ||
    locked.chargeTotalNis == null ||
    !Number.isFinite(locked.chargeTotalNis)
  ) {
    return { subtotalNis, vatNis, totalNis };
  }

  return {
    subtotalNis,
    vatNis,
    totalNis: Math.round(locked.chargeTotalNis),
  };
}

/** Calendar day in Jerusalem — used for unpaid display / new checkout init only. */
export function resolvePaymentBoiRateDate(
  paid: boolean,
  paidAt: string | null | undefined,
  ctx: PaymentPlanExchangeContext | null | undefined,
): string {
  if (paid) {
    if (ctx?.linkPaidAt) return getJerusalemDateFromTimestamp(ctx.linkPaidAt);
    if (paidAt) return getJerusalemDateFromTimestamp(paidAt);
  }
  return getJerusalemTodayIsoDate();
}

async function loadBoiSnapshotForPaidFallback(
  paidAt: string | null | undefined,
  exchangeCtx: PaymentPlanExchangeContext | null,
): Promise<BoiRatesSnapshot> {
  const asOf = resolvePaymentBoiAsOf(true, paidAt, exchangeCtx);
  // Never fall back to calendar-day lookup for paid rows — after sync that can pick a
  // rate_date row that did not exist in DB at payment time (May 29 paid 08:49 → May 28).
  return loadBoiExchangeRatesAsOf(asOf);
}

async function resolveLockedBoiChargeForParams(
  params: FetchProformaExchangeRateParams,
  exchangeCtx: PaymentPlanExchangeContext | null,
): Promise<LockedBoiChargeSnapshot | null> {
  if (params.lockedBoiCharge) return params.lockedBoiCharge;
  if (exchangeCtx?.pelecardCharge) return exchangeCtx.pelecardCharge;
  return null;
}

export async function fetchLockedBoiChargeForPaymentPlan(
  paymentPlanId: number | string,
): Promise<LockedBoiChargeSnapshot | null> {
  const ctx = await fetchPaymentPlanExchangeContext(paymentPlanId);
  return ctx?.pelecardCharge ?? null;
}

export async function fetchLockedBoiChargesByPaymentPlanIds(
  paymentPlanIds: Array<number | string>,
): Promise<Map<number, LockedBoiChargeSnapshot>> {
  const contexts = await fetchPaymentPlanExchangeContexts(paymentPlanIds);
  const map = new Map<number, LockedBoiChargeSnapshot>();
  for (const [planId, ctx] of contexts) {
    if (ctx.pelecardCharge) map.set(planId, ctx.pelecardCharge);
  }
  return map;
}

/** Parse `new-123` / `legacy-456` collection report row ids. */
export function parsePaymentPlanIdFromCollectionRowId(rowId: string): number | null {
  const match = /^(?:new|legacy)-(\d+)$/.exec(rowId);
  return match ? parseInt(match[1], 10) : null;
}

export function convertAmountsWithLockedBoiCharge(
  locked: LockedBoiChargeSnapshot,
  subtotal: number,
  vat: number,
  total: number,
): { subtotalNis: number; vatNis: number; totalNis: number; rateDate: string } {
  const rate = locked.rateToIls;
  const subtotalNis = Math.round(subtotal * rate);
  const vatNis = Math.round(vat * rate);
  const totalNis =
    locked.chargeTotalNis != null && Number.isFinite(locked.chargeTotalNis)
      ? Math.round(locked.chargeTotalNis)
      : Math.round(total * rate);
  return { subtotalNis, vatNis, totalNis, rateDate: locked.rateDate };
}

function buildInfoFromLockedCharge(
  params: FetchProformaExchangeRateParams,
  isoCode: string,
  displaySymbol: string,
  locked: LockedBoiChargeSnapshot,
): ProformaExchangeRateInfo {
  const { paid = false, paidAt = null, subtotal, vat = 0, total } = params;
  const payDate = paid && paidAt ? toDateOnly(paidAt) : null;
  const amounts = convertAmountsWithLockedBoiCharge(locked, subtotal, vat, total);

  return {
    isoCode,
    displaySymbol,
    rateToIls: locked.rateToIls,
    rateDate: locked.rateDate,
    rateLabel: paid && payDate ? 'payment_date' : 'today',
    rateSource: 'boi',
    isLocalCurrency: false,
    paid,
    paidAt: payDate,
    subtotalNis: amounts.subtotalNis,
    vatNis: amounts.vatNis,
    totalNis: amounts.totalNis,
    usedLegacyFallback: false,
  };
}

export async function fetchProformaExchangeRateInfo(
  params: FetchProformaExchangeRateParams,
): Promise<ProformaExchangeRateInfo | null> {
  const {
    currency,
    paid = false,
    paidAt = null,
    subtotal,
    vat = 0,
    total,
    paymentPlanId = null,
  } = params;

  await loadAccountingCurrenciesMap();

  const meta = buildCurrencyMetaFromId(currency);
  const isoCode = meta.isoCode;

  if (isLocalCurrency(isoCode)) {
    return {
      isoCode: 'ILS',
      displaySymbol: '₪',
      rateToIls: 1,
      rateDate: getJerusalemTodayIsoDate(),
      rateLabel: paid && paidAt ? 'payment_date' : 'today',
      rateSource: 'legacy',
      isLocalCurrency: true,
      paid,
      paidAt,
      subtotalNis: subtotal,
      vatNis: vat,
      totalNis: total,
      usedLegacyFallback: false,
    };
  }

  const planId = parsePaymentPlanId(paymentPlanId);
  const exchangeCtx =
    params.preloadedExchangeContext !== undefined
      ? params.preloadedExchangeContext
      : planId != null
        ? await fetchPaymentPlanExchangeContext(planId)
        : null;
  const lockedBoiCharge = await resolveLockedBoiChargeForParams(params, exchangeCtx);

  // Checkout preview — show the rate/amount locked when Pelecard session was opened.
  if (lockedBoiCharge && !paid) {
    return buildInfoFromLockedCharge(params, isoCode, meta.displaySymbol, lockedBoiCharge);
  }

  const payDate = paid && paidAt ? toDateOnly(paidAt) : null;

  if (paid) {
    if (payDate) {
      const boiStart = await getBoiCoverageStartDate();
      if (boiStart && payDate >= boiStart) {
        const snap = await loadBoiSnapshotForPaidFallback(paidAt, exchangeCtx);
        const subConv = convertToNISWithMeta(subtotal, currency, snap);
        const vatConv = convertToNISWithMeta(vat, currency, snap);
        const totalConv = convertToNISWithMeta(total, currency, snap);

        const needsLegacyFallback =
          subConv.usedLegacyFallback || vatConv.usedLegacyFallback || totalConv.usedLegacyFallback;

        if (!needsLegacyFallback) {
          const amounts = applyLockedChargeTotalIfMatching(
            lockedBoiCharge,
            snap,
            subConv.amountNIS,
            vatConv.amountNIS,
            totalConv.amountNIS,
          );

          return {
            isoCode,
            displaySymbol: meta.displaySymbol,
            rateToIls: subConv.rate,
            rateDate: snap.rateDate,
            rateLabel: 'payment_date',
            rateSource: 'boi',
            isLocalCurrency: false,
            paid,
            paidAt: payDate,
            subtotalNis: amounts.subtotalNis,
            vatNis: amounts.vatNis,
            totalNis: amounts.totalNis,
            usedLegacyFallback: false,
          };
        }
      }
    }

    const legacyRate = payDate
      ? await loadLegacyCurrencyRateForPaymentDate(currency, payDate)
      : await loadLatestLegacyCurrencyRate(currency);

    return {
      isoCode,
      displaySymbol: meta.displaySymbol,
      rateToIls: legacyRate.rateToIls,
      rateDate: legacyRate.effectiveDate,
      rateLabel: payDate ? 'payment_date' : 'today',
      rateSource: 'legacy',
      isLocalCurrency: false,
      paid,
      paidAt: payDate,
      subtotalNis: convertAmountWithLegacyRate(subtotal, legacyRate),
      vatNis: convertAmountWithLegacyRate(vat, legacyRate),
      totalNis: convertAmountWithLegacyRate(total, legacyRate),
      usedLegacyFallback: legacyRate.usedFallback,
    };
  }

  const conv = await convertUnpaidToNisBoiToday(currency, subtotal, vat);

  return {
    isoCode,
    displaySymbol: meta.displaySymbol,
    rateToIls: conv.rateToIls,
    rateDate: conv.rateDate,
    rateLabel: 'today',
    rateSource: 'boi',
    isLocalCurrency: conv.isLocalCurrency,
    paid,
    paidAt: null,
    subtotalNis: conv.subtotalNis,
    vatNis: conv.vatNis,
    totalNis: conv.totalNis,
    usedLegacyFallback: conv.usedLegacyFallback,
  };
}

/**
 * Unpaid amounts — BOI rows available now (created_at <= now), same as checkout session init.
 */
export async function convertUnpaidToNisBoiToday(
  currency: CurrencyInput,
  subtotal: number,
  vat = 0,
  preloadedSnapshot?: BoiRatesSnapshot,
): Promise<{
  subtotalNis: number;
  vatNis: number;
  totalNis: number;
  rateToIls: number;
  rateDate: string;
  usedLegacyFallback: boolean;
  isLocalCurrency: boolean;
}> {
  await loadAccountingCurrenciesMap();
  const meta = buildCurrencyMetaFromId(currency);
  const total = subtotal + vat;

  if (isLocalCurrency(meta.isoCode)) {
    return {
      subtotalNis: subtotal,
      vatNis: vat,
      totalNis: total,
      rateToIls: 1,
      rateDate: getJerusalemTodayIsoDate(),
      usedLegacyFallback: false,
      isLocalCurrency: true,
    };
  }

  const snap = preloadedSnapshot ?? (await loadBoiExchangeRatesAsOf(new Date()));
  const subConv = convertToNISWithMeta(subtotal, currency, snap);
  const vatConv = convertToNISWithMeta(vat, currency, snap);
  const totalConv = convertToNISWithMeta(total, currency, snap);

  return {
    subtotalNis: subConv.amountNIS,
    vatNis: vatConv.amountNIS,
    totalNis: totalConv.amountNIS,
    rateToIls: subConv.rate,
    rateDate: snap.rateDate,
    usedLegacyFallback:
      subConv.usedLegacyFallback || vatConv.usedLegacyFallback || totalConv.usedLegacyFallback,
    isLocalCurrency: false,
  };
}

export function formatProformaRateDate(isoDate: string): string {
  try {
    return new Date(`${isoDate}T12:00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' });
  } catch {
    return isoDate;
  }
}

export function formatIlsAmount(amount: number): string {
  return `₪${Math.round(amount).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/** Human-readable lines for the invoice footer */
export function buildProformaExchangeFooterLines(info: ProformaExchangeRateInfo): string[] {
  if (info.isLocalCurrency) {
    return [];
  }

  const rateStr = info.rateToIls.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
  const rateDateFmt = formatProformaRateDate(info.rateDate);

  const lines: string[] = [];

  if (info.rateLabel === 'payment_date' && info.paidAt) {
    if (info.rateSource === 'boi') {
      lines.push(
        `Representative exchange rate (Bank of Israel) on payment date ${formatProformaRateDate(info.paidAt)} — BOI rate date ${rateDateFmt}:`,
      );
    } else {
      lines.push(`Exchange rate on payment date ${formatProformaRateDate(info.paidAt)}:`);
    }
  } else if (info.rateSource === 'boi') {
    lines.push(`Representative exchange rate (Bank of Israel) for today — BOI rate date ${rateDateFmt}:`);
  } else {
    lines.push('Exchange rate:');
  }

  lines.push(`1 ${info.isoCode} = ${rateStr} ₪`);

  return lines;
}

/** Resolve currency input from new-lead payment plan + proforma JSON */
export function currencyInputFromNewPayment(
  payment: { currency?: string | null; currency_id?: number | string | null },
  proformaCurrency?: string | null,
): CurrencyInput {
  if (payment.currency_id != null) return payment.currency_id;
  return proformaCurrency || payment.currency || '₪';
}

/** Resolve currency input from legacy proforma row */
export function currencyInputFromLegacyProforma(proforma: {
  currency_id?: number | string | null;
  currency_code?: string | null;
}): CurrencyInput {
  if (proforma.currency_id != null) return proforma.currency_id;
  return resolveCurrencyIsoCode(proforma.currency_code || '₪');
}
