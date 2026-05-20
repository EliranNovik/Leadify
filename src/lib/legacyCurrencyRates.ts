/**
 * Legacy manually-maintained exchange rates (public.currency_rates).
 * Used for paid payment plan rows / proformas — rate effective on or before payment date.
 */
import { supabase } from './supabase';
import { convertToNIS as convertToNISStatic } from './currencyConversion';
import { resolveCurrencyIsoCode, type CurrencyInput } from './boiCurrencyConversion';

export type LegacyCurrencyRate = {
  isoCode: string;
  rateToIls: number;
  /** YYYY-MM-DD from effective_date */
  effectiveDate: string;
  usedFallback: boolean;
};

const CACHE_TTL_MS = 60 * 60 * 1000;
const rateCache = new Map<string, { rate: LegacyCurrencyRate; loadedAt: number }>();
const ratePromises = new Map<string, Promise<LegacyCurrencyRate>>();

function toDateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/** End of calendar day UTC for Supabase timestamptz comparison */
function endOfDayUtcIso(dateOnly: string): string {
  return `${dateOnly}T23:59:59.999Z`;
}

function cacheKey(isoCode: string, dateOnly: string): string {
  return `${isoCode}:${dateOnly}`;
}

async function queryRateForDate(isoCode: string, dateOnly: string): Promise<LegacyCurrencyRate | null> {
  const { data, error } = await supabase
    .from('currency_rates')
    .select('rate_value, effective_date, currency_code')
    .eq('currency_code', isoCode)
    .eq('is_active', true)
    .lte('effective_date', endOfDayUtcIso(dateOnly))
    .order('effective_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load currency rate for ${isoCode} on ${dateOnly}: ${error.message}`);
  }

  if (!data?.rate_value) return null;

  const rate = Number(data.rate_value);
  if (!Number.isFinite(rate) || rate <= 0) return null;

  return {
    isoCode,
    rateToIls: rate,
    effectiveDate: String(data.effective_date).slice(0, 10),
    usedFallback: false,
  };
}

async function queryLatestRate(isoCode: string, usedFallback = true): Promise<LegacyCurrencyRate | null> {
  const { data, error } = await supabase
    .from('currency_rates')
    .select('rate_value, effective_date, currency_code')
    .eq('currency_code', isoCode)
    .eq('is_active', true)
    .order('effective_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load latest currency rate for ${isoCode}: ${error.message}`);
  }

  if (!data?.rate_value) return null;

  const rate = Number(data.rate_value);
  if (!Number.isFinite(rate) || rate <= 0) return null;

  return {
    isoCode,
    rateToIls: rate,
    effectiveDate: String(data.effective_date).slice(0, 10),
    usedFallback,
  };
}

/**
 * Rate from currency_rates effective on or before paymentDate (YYYY-MM-DD).
 * Falls back to latest active rate, then static rates in currencyConversion.ts.
 */
export async function loadLegacyCurrencyRateForPaymentDate(
  currency: CurrencyInput,
  paymentDate: string,
  force = false,
): Promise<LegacyCurrencyRate> {
  const isoCode = resolveCurrencyIsoCode(currency);
  const dateOnly = toDateOnly(paymentDate);
  if (!dateOnly) {
    throw new Error('Payment date required for legacy currency rate lookup');
  }

  const key = cacheKey(isoCode, dateOnly);
  if (!force) {
    const cached = rateCache.get(key);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
      return cached.rate;
    }
    const pending = ratePromises.get(key);
    if (pending) return pending;
  }

  const promise = (async () => {
    const onDate = await queryRateForDate(isoCode, dateOnly);
    if (onDate) {
      rateCache.set(key, { rate: onDate, loadedAt: Date.now() });
      ratePromises.delete(key);
      return onDate;
    }

    const latest = await queryLatestRate(isoCode);
    if (latest) {
      rateCache.set(key, { rate: latest, loadedAt: Date.now() });
      ratePromises.delete(key);
      return latest;
    }

    const staticNis = convertToNISStatic(1, currency);
    const fallback: LegacyCurrencyRate = {
      isoCode,
      rateToIls: staticNis > 0 ? staticNis : 1,
      effectiveDate: dateOnly,
      usedFallback: true,
    };
    rateCache.set(key, { rate: fallback, loadedAt: Date.now() });
    ratePromises.delete(key);
    return fallback;
  })();

  ratePromises.set(key, promise);
  return promise;
}

/** Latest active rate from currency_rates (when paid but no payment date). */
export async function loadLatestLegacyCurrencyRate(
  currency: CurrencyInput,
  force = false,
): Promise<LegacyCurrencyRate> {
  const isoCode = resolveCurrencyIsoCode(currency);
  const key = `${isoCode}:latest`;
  if (!force) {
    const cached = rateCache.get(key);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
      return cached.rate;
    }
    const pending = ratePromises.get(key);
    if (pending) return pending;
  }

  const promise = (async () => {
    const latest = await queryLatestRate(isoCode, false);
    if (latest) {
      rateCache.set(key, { rate: latest, loadedAt: Date.now() });
      ratePromises.delete(key);
      return latest;
    }

    const staticNis = convertToNISStatic(1, currency);
    const fallback: LegacyCurrencyRate = {
      isoCode,
      rateToIls: staticNis > 0 ? staticNis : 1,
      effectiveDate: new Date().toISOString().slice(0, 10),
      usedFallback: true,
    };
    rateCache.set(key, { rate: fallback, loadedAt: Date.now() });
    ratePromises.delete(key);
    return fallback;
  })();

  ratePromises.set(key, promise);
  return promise;
}

export function convertAmountWithLegacyRate(amount: number, rate: LegacyCurrencyRate): number {
  if (!amount || amount <= 0) return 0;
  return amount * rate.rateToIls;
}
