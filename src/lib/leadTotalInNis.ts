/**
 * Lead header NIS total = sum of each proforma's Total (NIS), same as ProformaView / ProformaLegacyView.
 */
import { supabase } from './supabase';
import type { CurrencyInput } from './boiCurrencyConversion';
import { loadAccountingCurrenciesMap } from './boiCurrencyConversion';
import {
  currencyInputFromLegacyProforma,
  currencyInputFromNewPayment,
  fetchProformaExchangeRateInfo,
} from './proformaExchangeRate';
import { isLegacyPlanRowPaid, isNewPlanRowPaid } from './financeUnpaidTotal';

export type LeadTotalNisResult = {
  /** Sum of proforma Total (NIS) lines */
  totalNis: number;
  isLocalCurrency: boolean;
  proformaCount: number;
};

function parseNewLeadProforma(proformaRaw: unknown): Record<string, unknown> | null {
  if (proformaRaw == null) return null;
  try {
    const parsed =
      typeof proformaRaw === 'string' ? JSON.parse(proformaRaw) : (proformaRaw as Record<string, unknown>);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Match PublicProformaViewPage / ProformaViewPage amount normalization */
function amountsFromNewProforma(parsed: Record<string, unknown>): {
  subtotal: number;
  vat: number;
  total: number;
  currency: string | null;
} {
  let subtotal = Number(parsed.total) || 0;
  let totalWithVat = Number(parsed.totalWithVat) || subtotal;
  let vat = Number(parsed.vat) || Math.max(0, totalWithVat - subtotal);
  const currency = (parsed.currency as string) ?? null;

  if (
    parsed.addVat &&
    currency === '₪' &&
    (!parsed.vat || Number(parsed.vat) === 0)
  ) {
    vat = Math.round(subtotal * 0.18 * 100) / 100;
    totalWithVat = subtotal + vat;
  }

  return { subtotal, vat, total: totalWithVat, currency };
}

function hasBillableNewProforma(parsed: Record<string, unknown>): boolean {
  const { total } = amountsFromNewProforma(parsed);
  return total > 0 || Number(parsed.total) > 0;
}

/** Active payment row — not soft-deleted (cancel_date set). */
function isActivePaymentPlanRow(row: { cancel_date?: string | null }): boolean {
  const cd = row.cancel_date;
  return cd == null || String(cd).trim() === '';
}

/** Active legacy proforma — not cancelled (cxd_date = cancellation date). */
function isActiveLegacyProforma(pf: { cxd_date?: string | null }): boolean {
  const cd = pf.cxd_date;
  return cd == null || String(cd).trim() === '';
}

async function exchangeTotalNisForNewProforma(
  parsed: Record<string, unknown>,
  paymentRow: {
    paid?: boolean | null;
    paid_at?: string | null;
    currency?: string | null;
    currency_id?: number | string | null;
  },
): Promise<{ totalNis: number; isLocalCurrency: boolean } | null> {
  const { subtotal, vat, total, currency } = amountsFromNewProforma(parsed);
  const rec = paymentRow as Record<string, unknown>;

  const info = await fetchProformaExchangeRateInfo({
    currency: currencyInputFromNewPayment(
      { currency: paymentRow.currency, currency_id: paymentRow.currency_id },
      currency,
    ),
    paid: isNewPlanRowPaid(rec),
    paidAt: paymentRow.paid_at ?? null,
    subtotal,
    vat,
    total,
  });

  if (!info) return null;
  return { totalNis: info.totalNis, isLocalCurrency: info.isLocalCurrency };
}

async function fetchNewLeadProformasTotalNis(
  clientId: string | number,
): Promise<{ totalNis: number; isLocalCurrency: boolean; proformaCount: number }> {
  const { data, error } = await supabase
    .from('payment_plans')
    .select('proforma, paid, paid_at, currency, currency_id, cancel_date')
    .eq('lead_id', clientId)
    .is('cancel_date', null);

  if (error || !data?.length) {
    return { totalNis: 0, isLocalCurrency: true, proformaCount: 0 };
  }

  let totalNis = 0;
  let proformaCount = 0;
  let allLocal = true;

  for (const row of data) {
    if (!isActivePaymentPlanRow(row)) continue;

    const parsed = parseNewLeadProforma(row.proforma);
    if (!parsed || !hasBillableNewProforma(parsed)) continue;

    const converted = await exchangeTotalNisForNewProforma(parsed, row);
    if (!converted) continue;

    proformaCount += 1;
    totalNis += converted.totalNis;
    if (!converted.isLocalCurrency) allLocal = false;
  }

  return {
    totalNis: Math.round(totalNis),
    isLocalCurrency: proformaCount > 0 ? allLocal : true,
    proformaCount,
  };
}

async function fetchLegacyProformasTotalNis(
  legacyId: number,
): Promise<{ totalNis: number; isLocalCurrency: boolean; proformaCount: number }> {
  const { data: proformas, error } = await supabase
    .from('proformainvoice')
    .select('id, sub_total, total_base, vat_value, total, currency_id, ppr_id, cxd_date')
    .eq('lead_id', legacyId)
    .is('cxd_date', null);

  if (error || !proformas?.length) {
    return { totalNis: 0, isLocalCurrency: true, proformaCount: 0 };
  }

  const pprIds = proformas
    .map((p) => p.ppr_id)
    .filter((id): id is number => id != null && !Number.isNaN(Number(id)))
    .map((id) => Number(id));

  const paymentByPprId = new Map<
    number,
    { actual_date: string | null; currency_id: number | null; cancel_date: string | null }
  >();
  if (pprIds.length > 0) {
    const { data: pprs } = await supabase
      .from('finances_paymentplanrow')
      .select('id, actual_date, currency_id, cancel_date')
      .in('id', pprIds)
      .is('cancel_date', null);

    for (const ppr of pprs ?? []) {
      if (!isActivePaymentPlanRow(ppr)) continue;
      paymentByPprId.set(Number(ppr.id), {
        actual_date: ppr.actual_date ?? null,
        currency_id: ppr.currency_id != null ? Number(ppr.currency_id) : null,
        cancel_date: ppr.cancel_date ?? null,
      });
    }
  }

  let totalNis = 0;
  let proformaCount = 0;
  let allLocal = true;

  for (const pf of proformas) {
    if (!isActiveLegacyProforma(pf)) continue;

    const subtotal = Number(pf.sub_total ?? pf.total_base ?? 0);
    const vat = Number(pf.vat_value ?? 0);
    const total = Number(pf.total ?? 0);
    if (total <= 0 && subtotal <= 0) continue;

    const pprId = pf.ppr_id != null ? Number(pf.ppr_id) : null;
    // Skip proforma tied to a cancelled payment plan row
    if (pprId != null && !paymentByPprId.has(pprId)) continue;

    const ppr = pprId != null ? paymentByPprId.get(pprId) : undefined;
    const paid = ppr ? ppr.actual_date != null && String(ppr.actual_date).trim() !== '' : false;
    const paidAt = paid ? String(ppr!.actual_date) : null;

    const currencyInput: CurrencyInput =
      ppr?.currency_id != null
        ? ppr.currency_id
        : currencyInputFromLegacyProforma({
            currency_id: pf.currency_id,
            currency_code: null,
          });

    const info = await fetchProformaExchangeRateInfo({
      currency: currencyInput,
      paid,
      paidAt,
      subtotal,
      vat,
      total,
    });

    if (!info) continue;

    proformaCount += 1;
    totalNis += info.totalNis;
    if (!info.isLocalCurrency) allLocal = false;
  }

  return {
    totalNis: Math.round(totalNis),
    isLocalCurrency: proformaCount > 0 ? allLocal : true,
    proformaCount,
  };
}

/**
 * Sum Total (NIS) from every non-cancelled proforma on the lead (matches proforma preview pages).
 * - New: payment_plans.cancel_date must be null
 * - Legacy: proformainvoice.cxd_date must be null; linked payment row cancel_date must be null
 */
export async function fetchLeadGrossTotalInNis(
  clientId: string | number,
  leadType: string | null | undefined,
  _currencyInput?: CurrencyInput,
  _fallback?: { subtotal: number; vat: number; total: number },
): Promise<LeadTotalNisResult | null> {
  await loadAccountingCurrenciesMap();

  const idStr = String(clientId);
  const isLegacy = leadType === 'legacy' || idStr.startsWith('legacy_');

  let result: { totalNis: number; isLocalCurrency: boolean; proformaCount: number };
  if (isLegacy) {
    const legacyId = parseInt(idStr.replace(/^legacy_/, ''), 10);
    if (!legacyId || Number.isNaN(legacyId)) return null;
    result = await fetchLegacyProformasTotalNis(legacyId);
  } else {
    result = await fetchNewLeadProformasTotalNis(clientId);
  }

  if (result.proformaCount === 0) {
    return null;
  }

  return {
    totalNis: result.totalNis,
    isLocalCurrency: result.isLocalCurrency,
    proformaCount: result.proformaCount,
  };
}
