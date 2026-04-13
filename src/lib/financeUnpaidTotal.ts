/**
 * Unpaid payment totals — same row rules as FinancesTab:
 * - per row: base = value, VAT = value_vat / vat_value (legacy may auto-fill VAT for NIS when vat_value missing)
 * - gross = base + VAT
 * - exclude paid rows (legacy: actual_date set; new: paid === true)
 * - exclude canceled rows (cancel_date set)
 */
import { supabase } from './supabase';

function getVatRateForLegacyLead(dateString: string | null | undefined): number {
  if (!dateString) return 0.18;
  const paymentDate = new Date(dateString);
  if (isNaN(paymentDate.getTime())) return 0.18;
  const vatChangeDate = new Date('2025-01-01T00:00:00');
  return paymentDate < vatChangeDate ? 0.17 : 0.18;
}

export function legacyPlanBaseAndVat(plan: Record<string, unknown>): { base: number; vat: number } {
  const base = Number(plan.value ?? 0);
  let vat = Number(plan.vat_value ?? 0);
  const currencyId =
    plan.currency_id != null
      ? Number(plan.currency_id)
      : Number((plan as { accounting_currencies?: { id?: number } }).accounting_currencies?.id ?? 0);

  if (currencyId === 1 && (vat === 0 || plan.vat_value == null || plan.vat_value === '')) {
    const paymentDate = (plan.date as string) || (plan.due_date as string);
    const vatRate = getVatRateForLegacyLead(paymentDate);
    vat = Math.round(base * vatRate * 100) / 100;
  }
  return { base, vat };
}

export function legacyPlanGross(plan: Record<string, unknown>): number {
  const { base, vat } = legacyPlanBaseAndVat(plan);
  return base + vat;
}

export function newPlanBaseAndVat(plan: Record<string, unknown>): { base: number; vat: number } {
  return {
    base: Number(plan.value ?? 0),
    vat: Number(plan.value_vat ?? 0),
  };
}

export function newPlanGross(plan: Record<string, unknown>): number {
  const { base, vat } = newPlanBaseAndVat(plan);
  return base + vat;
}

export function isLegacyPlanRowPaid(plan: Record<string, unknown>): boolean {
  return !!plan.actual_date;
}

export function isNewPlanRowPaid(plan: Record<string, unknown>): boolean {
  return !!plan.paid;
}

/** Sum unpaid (gross) from normalized FinancesTab payment rows — same as DB fetch when data is in sync. */
export function sumUnpaidFromFinancePlanPayments(
  payments: Array<{ value: number; valueVat: number; paid?: boolean }>
): number {
  return payments.reduce((sum, p) => {
    if (p.paid) return sum;
    return sum + p.value + p.valueVat;
  }, 0);
}

/** Unpaid gross per currency symbol (matches FinancesTab payment rows). */
export function sumUnpaidByCurrencyFromPayments(
  payments: Array<{ value: number; valueVat: number; paid?: boolean; currency?: string }>
): Record<string, number> {
  const by = sumUnpaidBaseAndVatByCurrencyFromPayments(payments);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(by)) {
    out[k] = v.base + v.vat;
  }
  return out;
}

/** Unpaid base + VAT per currency (for display aligned with Total Value). */
export function sumUnpaidBaseAndVatByCurrencyFromPayments(
  payments: Array<{ value: number; valueVat: number; paid?: boolean; currency?: string }>
): Record<string, { base: number; vat: number }> {
  return payments.reduce<Record<string, { base: number; vat: number }>>((acc, p) => {
    if (p.paid) return acc;
    const c = (p.currency && String(p.currency).trim()) || '₪';
    if (!acc[c]) acc[c] = { base: 0, vat: 0 };
    acc[c].base += p.value;
    acc[c].vat += p.valueVat;
    return acc;
  }, {});
}

function currencyKeyFromLegacyPlan(plan: Record<string, unknown>): string {
  const ac = plan.accounting_currencies as { name?: string } | undefined;
  if (ac?.name && String(ac.name).trim()) return String(ac.name).trim();
  const id = Number(plan.currency_id ?? 0);
  if (id === 2) return '€';
  if (id === 3) return '$';
  if (id === 4) return '£';
  return '₪';
}

export type UnpaidByCurrencyMap = Record<string, { base: number; vat: number }>;

/**
 * Fetch all non-canceled payment rows for the lead and sum base + VAT per currency for rows that are not paid.
 */
export async function fetchUnpaidTotalsByCurrency(
  clientId: string | number,
  leadType: string | null | undefined
): Promise<UnpaidByCurrencyMap> {
  const idStr = String(clientId);
  const isLegacy = leadType === 'legacy' || idStr.startsWith('legacy_');
  const acc: UnpaidByCurrencyMap = {};

  const add = (key: string, base: number, vat: number) => {
    if (!acc[key]) acc[key] = { base: 0, vat: 0 };
    acc[key].base += base;
    acc[key].vat += vat;
  };

  if (isLegacy) {
    const legacyIdStr = idStr.replace(/^legacy_/, '');
    const legacyId = parseInt(legacyIdStr, 10);
    if (!legacyId || Number.isNaN(legacyId)) return acc;

    const { data, error } = await supabase
      .from('finances_paymentplanrow')
      .select(
        `
          *,
          accounting_currencies!finances_paymentplanrow_currency_id_fkey (
            id,
            name,
            iso_code
          )
        `
      )
      .eq('lead_id', legacyId)
      .is('cancel_date', null);

    if (error || !data?.length) return acc;

    for (const plan of data) {
      if (Number(plan.lead_id) !== legacyId) continue;
      if (isLegacyPlanRowPaid(plan as Record<string, unknown>)) continue;
      const key = currencyKeyFromLegacyPlan(plan as Record<string, unknown>);
      const { base, vat } = legacyPlanBaseAndVat(plan as Record<string, unknown>);
      add(key, base, vat);
    }
    return acc;
  }

  const { data, error } = await supabase
    .from('payment_plans')
    .select('*')
    .eq('lead_id', clientId)
    .is('cancel_date', null);

  if (error || !data?.length) return acc;

  for (const plan of data) {
    const pid = plan.lead_id != null ? String(plan.lead_id) : '';
    if (pid !== String(clientId)) continue;
    if (isNewPlanRowPaid(plan as Record<string, unknown>)) continue;
    const key = ((plan.currency as string) || '₪').trim() || '₪';
    const { base, vat } = newPlanBaseAndVat(plan as Record<string, unknown>);
    add(key, base, vat);
  }
  return acc;
}

function normCurrencyKey(s: string): string {
  return s
    .replace(/\s/g, '')
    .toUpperCase()
    .replace('ILS', '₪')
    .replace('USD', '$')
    .replace('EUR', '€')
    .replace('GBP', '£');
}

/** Resolve unpaid base + VAT for the header using the same currency label as Total Value. */
export function pickUnpaidBaseAndVatForCurrency(
  byCurrency: UnpaidByCurrencyMap | null,
  currencyLabel: string
): { base: number; vat: number } | null {
  if (!byCurrency || Object.keys(byCurrency).length === 0) return null;
  if (byCurrency[currencyLabel]) return { ...byCurrency[currencyLabel] };
  const target = normCurrencyKey(currencyLabel);
  for (const [k, v] of Object.entries(byCurrency)) {
    if (normCurrencyKey(k) === target) return { ...v };
  }
  let base = 0;
  let vat = 0;
  for (const v of Object.values(byCurrency)) {
    base += v.base;
    vat += v.vat;
  }
  return { base, vat };
}

/** Gross unpaid for matched currency (base + vat). */
export function pickUnpaidAmountForCurrency(
  byCurrency: UnpaidByCurrencyMap | null,
  currencyLabel: string
): number {
  const pair = pickUnpaidBaseAndVatForCurrency(byCurrency, currencyLabel);
  if (!pair) return 0;
  return pair.base + pair.vat;
}

/**
 * Batch-fetch unpaid base+VAT per currency for many leads (same row rules as fetchUnpaidTotalsByCurrency).
 * Map keys: `new:<leads.id uuid>` | `legacy:<leads_lead.id number>`
 */
export async function fetchUnpaidTotalsBatchByLeadKey(
  newLeadIds: string[],
  legacyLeadIds: number[]
): Promise<Map<string, UnpaidByCurrencyMap>> {
  const out = new Map<string, UnpaidByCurrencyMap>();

  const merge = (leadKey: string, currencyKey: string, base: number, vat: number) => {
    if (!out.has(leadKey)) out.set(leadKey, {});
    const acc = out.get(leadKey)!;
    if (!acc[currencyKey]) acc[currencyKey] = { base: 0, vat: 0 };
    acc[currencyKey].base += base;
    acc[currencyKey].vat += vat;
  };

  const uniqLegacy = [...new Set(legacyLeadIds.filter((n) => n != null && !Number.isNaN(Number(n))))].map(Number);
  if (uniqLegacy.length > 0) {
    const { data, error } = await supabase
      .from('finances_paymentplanrow')
      .select(
        `
          lead_id,
          value,
          vat_value,
          actual_date,
          date,
          due_date,
          currency_id,
          accounting_currencies!finances_paymentplanrow_currency_id_fkey (
            id,
            name,
            iso_code
          )
        `
      )
      .in('lead_id', uniqLegacy)
      .is('cancel_date', null);

    if (!error && data?.length) {
      for (const plan of data) {
        const lid = Number((plan as { lead_id?: number }).lead_id);
        if (!lid || Number.isNaN(lid)) continue;
        if (isLegacyPlanRowPaid(plan as Record<string, unknown>)) continue;
        const ckey = currencyKeyFromLegacyPlan(plan as Record<string, unknown>);
        const { base, vat } = legacyPlanBaseAndVat(plan as Record<string, unknown>);
        merge(`legacy:${lid}`, ckey, base, vat);
      }
    }
  }

  const uniqNew = [...new Set(newLeadIds.filter((id) => id && String(id).trim() !== ''))];
  if (uniqNew.length > 0) {
    const { data, error } = await supabase
      .from('payment_plans')
      .select('lead_id, value, value_vat, paid, currency, cancel_date')
      .in('lead_id', uniqNew)
      .is('cancel_date', null);

    if (!error && data?.length) {
      for (const plan of data) {
        const pid = plan.lead_id != null ? String(plan.lead_id) : '';
        if (!pid) continue;
        if (isNewPlanRowPaid(plan as Record<string, unknown>)) continue;
        const ckey = ((plan.currency as string) || '₪').trim() || '₪';
        const { base, vat } = newPlanBaseAndVat(plan as Record<string, unknown>);
        merge(`new:${pid}`, ckey, base, vat);
      }
    }
  }

  return out;
}
