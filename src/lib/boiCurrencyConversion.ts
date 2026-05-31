/**
 * Global currency conversion using Bank of Israel daily rates (boi_exchange_rates).
 *
 * Use this module for invoices, payment plans, signed deals, reports, etc.
 * Legacy hardcoded rates remain in currencyConversion.ts until callers migrate here.
 *
 * Typical usage:
 *   await ensureBoiRatesReady();
 *   const nis = convertToNIS(1000, lead.currency_id);
 *   // or with preloaded snapshot in a batch:
 *   const snap = await loadBoiExchangeRates();
 *   rows.map(r => convertToNIS(r.amount, r.currency_id, snap));
 */
import { supabase } from './supabase';
import {
  convertToNIS as convertToNISLegacy,
  getCurrencyCode as getCurrencyCodeLegacy,
  getCurrencySymbol as getCurrencySymbolLegacy,
} from './currencyConversion';

export const BOI_TARGET_CURRENCY = 'ILS';
const CACHE_TTL_MS = 60 * 60 * 1000;

const ILS_ISO_ALIASES = new Set(['ILS', 'NIS']);

export type CurrencyInput =
  | number
  | string
  | null
  | undefined
  | { id?: number | string | null; iso_code?: string | null; name?: string | null };

export type BoiRatesSnapshot = {
  /** Latest rate_date in boi_exchange_rates used for this snapshot */
  rateDate: string;
  /** ILS per 1 unit of base currency (e.g. USD -> 3.42) */
  ratesToIls: Record<string, number>;
  loadedAt: number;
};

export type CurrencyMeta = {
  displaySymbol: string;
  isoCode: string;
  currencyId: number | null;
};

export type ConversionResult = {
  amountNIS: number;
  originalAmount: number;
  isoCode: string;
  rate: number;
  rateDate: string;
  usedLegacyFallback: boolean;
};

let ratesSnapshot: BoiRatesSnapshot | null = null;
let ratesLoadPromise: Promise<BoiRatesSnapshot> | null = null;
const ratesByDateCache = new Map<string, BoiRatesSnapshot>();
const ratesByDatePromises = new Map<string, Promise<BoiRatesSnapshot>>();
const ratesByAsOfCache = new Map<string, BoiRatesSnapshot>();
const ratesByAsOfPromises = new Map<string, Promise<BoiRatesSnapshot>>();

let boiCoverageStartDate: { value: string | null; loadedAt: number } | null = null;
let boiCoverageStartPromise: Promise<string | null> | null = null;

let currencyIdToIso: Map<number, string> | null = null;
let currencyIsoToSymbol: Map<string, string> | null = null;
let currencyMapLoadedAt = 0;
let currencyMapPromise: Promise<void> | null = null;

const ISO_TO_SYMBOL: Record<string, string> = {
  ILS: '₪',
  NIS: '₪',
  USD: '$',
  EUR: '€',
  GBP: '£',
  CHF: 'CHF',
  CAD: 'C$',
  AUD: 'A$',
};

function normalizeIsoCode(raw: string | null | undefined): string {
  if (!raw) return BOI_TARGET_CURRENCY;
  const upper = String(raw).trim().toUpperCase();
  if (upper === 'NIS') return BOI_TARGET_CURRENCY;
  if (upper === '₪') return BOI_TARGET_CURRENCY;
  return upper;
}

function parseCurrencyId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Resolve ISO code from currency_id, iso string, symbol, or accounting_currencies-shaped object.
 */
export function resolveCurrencyIsoCode(currency: CurrencyInput): string {
  if (currency === null || currency === undefined) return BOI_TARGET_CURRENCY;

  if (typeof currency === 'object') {
    if (currency.iso_code) return normalizeIsoCode(currency.iso_code);
    const id = parseCurrencyId(currency.id);
    if (id != null && currencyIdToIso?.has(id)) {
      return currencyIdToIso.get(id)!;
    }
  }

  if (typeof currency === 'number' || (typeof currency === 'string' && /^\d+$/.test(currency.trim()))) {
    const id = parseCurrencyId(currency);
    if (id != null && currencyIdToIso?.has(id)) {
      return currencyIdToIso.get(id)!;
    }
    return normalizeIsoCode(getCurrencyCodeLegacy(currency));
  }

  if (typeof currency === 'string') {
    const t = currency.trim();
    if (!t) return BOI_TARGET_CURRENCY;
    const upper = t.toUpperCase();
    if (ILS_ISO_ALIASES.has(upper) || t === '₪') return BOI_TARGET_CURRENCY;
    if (/^[A-Z]{3}$/.test(upper)) return upper;
    if (t === '$') return 'USD';
    if (t === '€') return 'EUR';
    if (t === '£') return 'GBP';
    return normalizeIsoCode(t);
  }

  return BOI_TARGET_CURRENCY;
}

export function isLocalCurrency(isoCode: string): boolean {
  return ILS_ISO_ALIASES.has(normalizeIsoCode(isoCode));
}

export function getDisplaySymbolForIso(isoCode: string): string {
  const iso = normalizeIsoCode(isoCode);
  if (currencyIsoToSymbol?.has(iso)) return currencyIsoToSymbol.get(iso)!;
  return ISO_TO_SYMBOL[iso] ?? iso;
}

/**
 * Build display + ISO metadata (similar to buildCurrencyMeta in salesContributionCalculator).
 */
export function buildCurrencyMetaFromId(...candidates: CurrencyInput[]): CurrencyMeta {
  for (const c of candidates) {
    if (c === null || c === undefined) continue;
    const iso = resolveCurrencyIsoCode(c);
    const id =
      typeof c === 'object' && c !== null
        ? parseCurrencyId(c.id)
        : typeof c === 'number'
          ? parseCurrencyId(c)
          : null;
    if (iso !== BOI_TARGET_CURRENCY || id != null) {
      return {
        displaySymbol: getDisplaySymbolForIso(iso),
        isoCode: iso,
        currencyId: id,
      };
    }
  }
  return { displaySymbol: '₪', isoCode: BOI_TARGET_CURRENCY, currencyId: null };
}

export function invalidateBoiCurrencyCache(): void {
  ratesSnapshot = null;
  ratesLoadPromise = null;
  ratesByDateCache.clear();
  ratesByDatePromises.clear();
  ratesByAsOfCache.clear();
  ratesByAsOfPromises.clear();
  boiCoverageStartDate = null;
  boiCoverageStartPromise = null;
  currencyIdToIso = null;
  currencyIsoToSymbol = null;
  currencyMapLoadedAt = 0;
  currencyMapPromise = null;
}

/** YYYY-MM-DD in Asia/Jerusalem (for "today's" BOI rate on unpaid proformas). */
export function getJerusalemTodayIsoDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Calendar date in Asia/Jerusalem for a payment timestamp (matches Pelecard charge day logic). */
export function getJerusalemDateFromTimestamp(timestamp: string | null | undefined): string {
  if (timestamp != null && String(timestamp).trim()) {
    const s = String(timestamp).trim();
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s)
      ? new Date(`${s}T12:00:00`)
      : new Date(s.includes(' ') ? s.replace(' ', 'T') : s);
    if (!Number.isNaN(d.getTime())) {
      return getJerusalemTodayIsoDate(d);
    }
  }
  return getJerusalemTodayIsoDate();
}

function snapshotFromRows(rows: Array<{
  rate_date: string;
  base_currency: string;
  target_currency: string;
  rate: number | string;
}>): BoiRatesSnapshot {
  if (rows.length === 0) {
    throw new Error('No BOI exchange rate rows');
  }
  const rateDate = String(rows[0].rate_date);
  const ratesToIls: Record<string, number> = {};
  for (const row of rows) {
    const base = normalizeIsoCode(row.base_currency);
    const target = normalizeIsoCode(row.target_currency);
    const rate = Number(row.rate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    if (target === BOI_TARGET_CURRENCY) {
      ratesToIls[base] = rate;
    }
  }
  return { rateDate, ratesToIls, loadedAt: Date.now() };
}

/**
 * Load accounting_currencies id → iso_code (and symbol from name when present).
 */
export async function loadAccountingCurrenciesMap(force = false): Promise<void> {
  const stale = Date.now() - currencyMapLoadedAt > CACHE_TTL_MS;
  if (!force && currencyIdToIso && !stale) return;
  if (!force && currencyMapPromise) return currencyMapPromise;

  currencyMapPromise = (async () => {
    const idMap = new Map<number, string>();
    const symMap = new Map<string, string>();

    const { data, error } = await supabase
      .from('accounting_currencies')
      .select('id, iso_code, name')
      .order('id');

    if (error) {
      console.warn('[boiCurrencyConversion] accounting_currencies load failed:', error.message);
    } else {
      for (const row of data ?? []) {
        const id = parseCurrencyId(row.id);
        const iso = normalizeIsoCode(row.iso_code);
        if (id == null || !iso) continue;
        idMap.set(id, iso);
        const sym = row.name?.trim();
        if (sym) symMap.set(iso, sym);
      }
    }

    currencyIdToIso = idMap;
    currencyIsoToSymbol = symMap;
    currencyMapLoadedAt = Date.now();
    currencyMapPromise = null;
  })();

  return currencyMapPromise;
}

/**
 * Load latest BOI rates snapshot (most recent rate_date in boi_exchange_rates).
 */
export async function loadBoiExchangeRates(force = false): Promise<BoiRatesSnapshot> {
  const stale = ratesSnapshot && Date.now() - ratesSnapshot.loadedAt > CACHE_TTL_MS;
  if (!force && ratesSnapshot && !stale) return ratesSnapshot;
  if (!force && ratesLoadPromise) return ratesLoadPromise;

  ratesLoadPromise = (async () => {
    await loadAccountingCurrenciesMap(force);

    const { data, error } = await supabase.rpc('get_boi_exchange_rates_for_date', {
      p_rate_date: null,
    });

    if (error) {
      ratesLoadPromise = null;
      throw new Error(`Failed to load BOI exchange rates: ${error.message}`);
    }

    const rows = (data ?? []) as Array<{
      rate_date: string;
      base_currency: string;
      target_currency: string;
      rate: number | string;
    }>;

    if (rows.length === 0) {
      ratesLoadPromise = null;
      throw new Error(
        'No BOI exchange rates in database. Sync via Admin → Currency rates or boi-exchange-rates-sync.',
      );
    }

    ratesSnapshot = snapshotFromRows(rows);
    ratesLoadPromise = null;
    return ratesSnapshot;
  })();

  return ratesLoadPromise;
}

/**
 * BOI rates for a specific calendar date (YYYY-MM-DD).
 * Uses that date if present; otherwise the latest stored rate_date on or before that day.
 */
export async function loadBoiExchangeRatesForDate(
  rateDate: string,
  force = false,
): Promise<BoiRatesSnapshot> {
  const dateOnly = rateDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    return loadBoiExchangeRates(force);
  }

  if (!force && ratesByDateCache.has(dateOnly)) {
    return ratesByDateCache.get(dateOnly)!;
  }
  if (!force && ratesByDatePromises.has(dateOnly)) {
    return ratesByDatePromises.get(dateOnly)!;
  }

  const promise = (async () => {
    await loadAccountingCurrenciesMap(force);

    let { data, error } = await supabase.rpc('get_boi_exchange_rates_for_date', {
      p_rate_date: dateOnly,
    });

    if (error) {
      throw new Error(`Failed to load BOI rates for ${dateOnly}: ${error.message}`);
    }

    let rows = (data ?? []) as Array<{
      rate_date: string;
      base_currency: string;
      target_currency: string;
      rate: number | string;
    }>;

    if (rows.length === 0) {
      const { data: nearestDateRow, error: nearestErr } = await supabase
        .from('boi_exchange_rates')
        .select('rate_date')
        .lte('rate_date', dateOnly)
        .order('rate_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (nearestErr) throw nearestErr;
      if (!nearestDateRow?.rate_date) {
        return loadBoiExchangeRates(force);
      }

      const res = await supabase.rpc('get_boi_exchange_rates_for_date', {
        p_rate_date: nearestDateRow.rate_date,
      });
      if (res.error) throw res.error;
      rows = (res.data ?? []) as typeof rows;
    }

    if (rows.length === 0) {
      return loadBoiExchangeRates(force);
    }

    const snap = snapshotFromRows(rows);
    ratesByDateCache.set(dateOnly, snap);
    ratesByDatePromises.delete(dateOnly);
    return snap;
  })();

  ratesByDatePromises.set(dateOnly, promise);
  return promise;
}

/**
 * Resolve an as-of timestamp for BOI lookups.
 * Full ISO/datetime strings use the exact instant; date-only is a last-resort fallback (noon Jerusalem).
 * Prefer payment_links.pelecardCharge.lockedAt or payment_links.paid_at when available.
 */
export function resolveBoiAsOfTimestamp(
  timestamp: string | null | undefined,
): string {
  if (timestamp != null && String(timestamp).trim()) {
    const s = String(timestamp).trim();
    if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) {
      const d = new Date(s.includes(' ') ? s.replace(' ', 'T') : s);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return jerusalemNoonIso(s);
    }
  }
  return new Date().toISOString();
}

function jerusalemNoonIso(dateOnly: string): string {
  for (const offset of ['+03:00', '+02:00']) {
    const candidate = `${dateOnly}T12:00:00${offset}`;
    const d = new Date(candidate);
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
    if (formatted === dateOnly) return d.toISOString();
  }
  return new Date(`${dateOnly}T12:00:00+03:00`).toISOString();
}

/** Direct table query when as-of RPC is missing or returns empty (respects created_at). */
async function loadBoiExchangeRateRowsAsOfDirect(asOfIso: string): Promise<
  Array<{
    rate_date: string;
    base_currency: string;
    target_currency: string;
    rate: number | string;
    created_at?: string;
  }>
> {
  const { data, error } = await supabase
    .from('boi_exchange_rates')
    .select('rate_date, base_currency, target_currency, rate, created_at')
    .lte('created_at', asOfIso)
    .order('rate_date', { ascending: false });

  if (error || !data?.length) return [];

  const maxRateDate = data.reduce(
    (max, row) => (row.rate_date > max ? row.rate_date : max),
    data[0].rate_date,
  );
  return data.filter((row) => row.rate_date === maxRateDate);
}

function normalizeAsOfCacheKey(asOf: string | Date): string {
  const iso =
    typeof asOf === 'string' ? resolveBoiAsOfTimestamp(asOf) : asOf.toISOString();
  return iso.slice(0, 19);
}

/**
 * BOI snapshot available at a specific moment — only rows with created_at <= asOf.
 * Uses the latest rate_date among those eligible rows (matches PaymentPage charge logic).
 */
export async function loadBoiExchangeRatesAsOf(
  asOf: string | Date = new Date(),
  force = false,
): Promise<BoiRatesSnapshot> {
  const cacheKey = normalizeAsOfCacheKey(asOf);
  const asOfIso =
    typeof asOf === 'string' ? resolveBoiAsOfTimestamp(asOf) : asOf.toISOString();

  if (!force && ratesByAsOfCache.has(cacheKey)) {
    return ratesByAsOfCache.get(cacheKey)!;
  }
  if (!force && ratesByAsOfPromises.has(cacheKey)) {
    return ratesByAsOfPromises.get(cacheKey)!;
  }

  const promise = (async () => {
    await loadAccountingCurrenciesMap(force);

    let rows: Array<{
      rate_date: string;
      base_currency: string;
      target_currency: string;
      rate: number | string;
      created_at?: string;
    }> = [];

    const { data, error } = await supabase.rpc('get_boi_exchange_rates_as_of', {
      p_as_of: asOfIso,
    });

    if (error) {
      console.warn('[boiCurrencyConversion] as-of RPC failed, using direct query:', error.message);
      rows = await loadBoiExchangeRateRowsAsOfDirect(asOfIso);
    } else {
      rows = (data ?? []) as typeof rows;
      if (rows.length === 0) {
        rows = await loadBoiExchangeRateRowsAsOfDirect(asOfIso);
      }
    }

    if (rows.length === 0) {
      ratesByAsOfPromises.delete(cacheKey);
      throw new Error(
        `No BOI exchange rates available as of ${asOfIso}. Sync BOI rates in admin.`,
      );
    }

    const snap = snapshotFromRows(rows);
    ratesByAsOfCache.set(cacheKey, snap);
    ratesByAsOfPromises.delete(cacheKey);
    return snap;
  })();

  ratesByAsOfPromises.set(cacheKey, promise);
  return promise;
}

export async function ensureBoiRatesReady(): Promise<BoiRatesSnapshot> {
  return loadBoiExchangeRates(false);
}

/**
 * Earliest date (YYYY-MM-DD) available in boi_exchange_rates.
 * Used to decide whether a paid invoice should prefer BOI rates (when payment date is within BOI coverage).
 */
export async function getBoiCoverageStartDate(force = false): Promise<string | null> {
  const stale = boiCoverageStartDate && Date.now() - boiCoverageStartDate.loadedAt > CACHE_TTL_MS;
  if (!force && boiCoverageStartDate && !stale) return boiCoverageStartDate.value;
  if (!force && boiCoverageStartPromise) return boiCoverageStartPromise;

  boiCoverageStartPromise = (async () => {
    const { data, error } = await supabase
      .from('boi_exchange_rates')
      .select('rate_date')
      .order('rate_date', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('[boiCurrencyConversion] failed to read BOI coverage start date:', error.message);
      boiCoverageStartDate = { value: null, loadedAt: Date.now() };
      boiCoverageStartPromise = null;
      return null;
    }

    const value = data?.rate_date ? String(data.rate_date).slice(0, 10) : null;
    boiCoverageStartDate = { value, loadedAt: Date.now() };
    boiCoverageStartPromise = null;
    return value;
  })();

  return boiCoverageStartPromise;
}

/**
 * ILS per 1 unit of foreign currency for the snapshot's rate date (today's published BOI rate).
 */
export function getBoiRateToIls(
  isoCode: string,
  snapshot: BoiRatesSnapshot = ratesSnapshot!,
): number | null {
  const iso = normalizeIsoCode(isoCode);
  if (isLocalCurrency(iso)) return 1;
  const rate = snapshot.ratesToIls[iso];
  return rate != null && Number.isFinite(rate) && rate > 0 ? rate : null;
}

export function getLoadedRatesSnapshot(): BoiRatesSnapshot | null {
  return ratesSnapshot;
}

/**
 * Convert amount to NIS using BOI rates. Call ensureBoiRatesReady() or pass snapshot.
 * Falls back to legacy currencyConversion if BOI rate missing.
 */
export function convertToNIS(
  amount: number,
  currency: CurrencyInput,
  snapshot?: BoiRatesSnapshot,
): number {
  return convertToNISWithMeta(amount, currency, snapshot).amountNIS;
}

export function convertToNISWithMeta(
  amount: number,
  currency: CurrencyInput,
  snapshot?: BoiRatesSnapshot,
): ConversionResult {
  const originalAmount = !amount || amount <= 0 ? 0 : amount;
  const isoCode = resolveCurrencyIsoCode(currency);

  if (originalAmount <= 0) {
    return {
      amountNIS: 0,
      originalAmount: 0,
      isoCode,
      rate: 1,
      rateDate: snapshot?.rateDate ?? '',
      usedLegacyFallback: false,
    };
  }

  if (isLocalCurrency(isoCode)) {
    return {
      amountNIS: originalAmount,
      originalAmount,
      isoCode: BOI_TARGET_CURRENCY,
      rate: 1,
      rateDate: snapshot?.rateDate ?? '',
      usedLegacyFallback: false,
    };
  }

  const snap = snapshot ?? ratesSnapshot;
  if (snap) {
    const rate = getBoiRateToIls(isoCode, snap);
    if (rate != null) {
      return {
        amountNIS: originalAmount * rate,
        originalAmount,
        isoCode,
        rate,
        rateDate: snap.rateDate,
        usedLegacyFallback: false,
      };
    }
  }

  const legacyNis = convertToNISLegacy(originalAmount, currency);
  console.warn(
    `[boiCurrencyConversion] No BOI rate for ${isoCode}; using legacy static rate. Load rates via ensureBoiRatesReady().`,
  );
  return {
    amountNIS: legacyNis,
    originalAmount,
    isoCode,
    rate: legacyNis / originalAmount,
    rateDate: snap?.rateDate ?? '',
    usedLegacyFallback: true,
  };
}

/** Async convert — loads BOI rates and currency map if needed. */
export async function convertToNISAsync(
  amount: number,
  currency: CurrencyInput,
): Promise<ConversionResult> {
  const snapshot = await loadBoiExchangeRates();
  return convertToNISWithMeta(amount, currency, snapshot);
}

export async function calculateTotalInNIS(
  items: Array<{ amount: number; currency?: CurrencyInput }>,
): Promise<number> {
  const snapshot = await loadBoiExchangeRates();
  return items.reduce((sum, item) => sum + convertToNIS(item.amount, item.currency, snapshot), 0);
}

export function formatCurrencyDisplay(amount: number, symbol: string): string {
  const rounded = Math.round(amount);
  return `${symbol}${rounded.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/**
 * Format with NIS conversion using BOI rates (requires snapshot or prior load).
 */
export function formatAmountWithBoiConversion(
  amount: number,
  currency: CurrencyInput,
  options?: { showOriginal?: boolean; snapshot?: BoiRatesSnapshot },
): string {
  const meta = buildCurrencyMetaFromId(currency);
  const conv = convertToNISWithMeta(amount, currency, options?.snapshot);
  const nisDisplay = formatCurrencyDisplay(conv.amountNIS, '₪');
  if (options?.showOriginal && !isLocalCurrency(conv.isoCode)) {
    const origDisplay = formatCurrencyDisplay(amount, meta.displaySymbol);
    return `${nisDisplay} (${origDisplay})`;
  }
  return nisDisplay;
}

/** Re-export legacy helpers until all callers use ISO from accounting_currencies. */
export function getCurrencySymbol(currencyId: string | number | null | undefined): string {
  const id = parseCurrencyId(currencyId);
  if (id != null && currencyIdToIso?.has(id)) {
    return getDisplaySymbolForIso(currencyIdToIso.get(id)!);
  }
  return getCurrencySymbolLegacy(currencyId);
}

export function getCurrencyCode(currencyId: string | number | null | undefined): string {
  const id = parseCurrencyId(currencyId);
  if (id != null && currencyIdToIso?.has(id)) {
    return currencyIdToIso.get(id)!;
  }
  return normalizeIsoCode(getCurrencyCodeLegacy(currencyId));
}

/** Normalize any date string to YYYY-MM-DD for BOI snapshot lookup. */
export function toDateOnlyKey(date: string | null | undefined): string | null {
  if (!date || !String(date).trim()) return null;
  const s = String(date).trim().split('T')[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export type BoiDateRateConverter = {
  /**
   * Convert using BOI rows with created_at <= as-of moment.
   * @param asOfInput - full ISO timestamp, or YYYY-MM-DD (Jerusalem noon on that day)
   */
  toNis: (amount: number, currency: CurrencyInput, asOfInput: string | null) => Promise<number>;
};

/** Rate lookup instant for payment-plan rows (paid → payment time; else due date). */
export function resolvePaymentPlanBoiAsOfInput(payment: {
  paid?: boolean | null;
  paid_at?: string | null;
  due_date?: string | null;
  actual_date?: string | null;
}): string | null {
  if (payment.paid_at) return payment.paid_at;
  if (payment.actual_date) return payment.actual_date;
  return toDateOnlyKey(payment.due_date);
}

/**
 * Cached as-of BOI snapshots for batch reports (sign date, due date, payment date, etc.).
 * Uses created_at <= as-of — not calendar rate_date lookup (avoids post-sync drift).
 */
export async function createBoiDateRateConverter(): Promise<BoiDateRateConverter> {
  const boiStart = await getBoiCoverageStartDate();
  const latestBoiSnap = await loadBoiExchangeRates();
  const snapByKey = new Map<string, Promise<BoiRatesSnapshot>>();

  const getSnap = (asOfInput: string | null): Promise<BoiRatesSnapshot> => {
    if (!asOfInput) {
      const key = '__now__';
      if (!snapByKey.has(key)) {
        snapByKey.set(key, loadBoiExchangeRatesAsOf(new Date()).catch(() => latestBoiSnap));
      }
      return snapByKey.get(key)!;
    }

    const dateOnly = toDateOnlyKey(asOfInput);
    if (dateOnly && boiStart && dateOnly < boiStart) {
      return Promise.resolve(latestBoiSnap);
    }

    const asOfIso = resolveBoiAsOfTimestamp(asOfInput);
    const cacheKey = asOfIso.slice(0, 19);
    if (!snapByKey.has(cacheKey)) {
      snapByKey.set(cacheKey, loadBoiExchangeRatesAsOf(asOfIso).catch(() => latestBoiSnap));
    }
    return snapByKey.get(cacheKey)!;
  };

  return {
    toNis: async (amount, currency, asOfInput) => {
      const snap = await getSnap(asOfInput);
      return convertToNISWithMeta(amount, currency, snap).amountNIS;
    },
  };
}
