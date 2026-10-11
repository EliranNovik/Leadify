/**
 * When a payment row's paperwork actually went out: the proforma invoice, and the tax receipt.
 *
 * Both answers live in columns the due-date measures never look at, and the tax receipt's lives in
 * another table entirely, so neither can be expressed as a filter on `payment_plans.due_date`. Each
 * function here works out which rows qualify in a window and which day to file them under, and
 * returns that as an `InstallmentEventScope` for `fetchInvoicedInstallments` to value and attribute.
 * Keeping it that way around means the money, department and subcontractor-fee logic is not
 * reimplemented per measure, which is how the invoiced and contribution numbers drifted apart before.
 */

import { supabase } from './supabase';
import {
  fetchAllPagedRows,
  installmentEventKey,
  type InstallmentEventScope,
} from './invoicedInstallments';

export type PaymentEventWindow = {
  /** Inclusive YYYY-MM-DD. */
  from: string;
  to: string;
};

/**
 * The day an event timestamp belongs to.
 *
 * Takes the date straight off the stored ISO string, the same way the due-date measures and the
 * Dashboard's own period boundaries do, so a row cannot land one day either side of where the
 * scoreboard looks for it.
 */
function eventDayKey(value: unknown): string | null {
  if (value == null || value === '') return null;
  const day = String(value).trim().split('T')[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** An `or` branch matching rows whose `column` falls inside the window. */
function withinWindow(column: string, window: PaymentEventWindow): string {
  return `and(${column}.gte.${window.from},${column}.lte.${window.to}T23:59:59)`;
}

function emptyScope(): InstallmentEventScope {
  return { newIds: [], legacyIds: [], eventDateByRow: new Map() };
}

function isValidWindow(window: PaymentEventWindow): boolean {
  return Boolean(window.from && window.to && window.from <= window.to);
}

/**
 * Payment rows whose proforma invoice was sent in the window, dated by when it went out.
 *
 * A manual send and the send automation each stamp their own column; the manual one wins where both
 * are set, matching how the collection report decides when an invoice was sent. Rows flagged
 * `invoice_sent` with neither timestamp are left out — there is no day to file them under, and
 * guessing one from the due date would report sends that never happened on days they did not.
 */
export async function fetchInvoiceSentEvents(
  window: PaymentEventWindow,
): Promise<InstallmentEventScope> {
  if (!isValidWindow(window)) return emptyScope();

  const sentFilter = `${withinWindow('invoice_sent_at', window)},${withinWindow(
    'invoice_send_automation_sent_at',
    window,
  )}`;

  const [newRows, legacyRows] = await Promise.all([
    fetchAllPagedRows<any>((from, to) =>
      supabase
        .from('payment_plans')
        .select('id, invoice_sent_at, invoice_send_automation_sent_at')
        .is('cancel_date', null)
        .or(sentFilter)
        .order('id', { ascending: true })
        .range(from, to),
    ).catch((err) => {
      console.error('[payment events] invoice sends (new) failed:', err);
      return [] as any[];
    }),
    fetchAllPagedRows<any>((from, to) =>
      supabase
        .from('finances_paymentplanrow')
        .select('id, invoice_sent_at, invoice_send_automation_sent_at')
        .is('cancel_date', null)
        .or(sentFilter)
        .order('id', { ascending: true })
        .range(from, to),
    ).catch((err) => {
      console.error('[payment events] invoice sends (legacy) failed:', err);
      return [] as any[];
    }),
  ]);

  const scope = emptyScope();
  const collect = (rows: any[], source: 'new' | 'legacy', ids: Array<string | number>) => {
    for (const row of rows) {
      const day =
        eventDayKey(row.invoice_sent_at) || eventDayKey(row.invoice_send_automation_sent_at);
      // The `or` above widens to the row, but only one of its two timestamps may be in range.
      if (!day || day < window.from || day > window.to) continue;
      scope.eventDateByRow.set(installmentEventKey(source, row.id), day);
      ids.push(row.id);
    }
  };
  collect(newRows, 'new', scope.newIds);
  collect(legacyRows, 'legacy', scope.legacyIds);
  return scope;
}

/** Payper rows worth counting: a pending or failed attempt put nothing in the client's hands. */
const PAYPER_RECEIPT_ISSUED = 'payper_invoice_status.eq.success,payper_invoice_link.not.is.null';

/**
 * Payment rows whose tax receipt went out in the window, by either route, dated by when it went out.
 *
 * Automatic receipts come from Payper against a payment link; manual ones are the mark recorded in
 * the client's Finances tab. Where a row has both, the Payper date wins, because it is the moment the
 * document was actually issued rather than the day someone recorded having sent it.
 *
 * Payper links point at either payment table and the two id spaces overlap, so the link's
 * `is_legacy_payment_plan` flag is what decides which row a receipt belongs to; matching on the id
 * alone would credit a legacy payment's receipt to whichever new payment shared its number.
 */
export async function fetchTaxReceiptSentEvents(
  window: PaymentEventWindow,
): Promise<InstallmentEventScope> {
  if (!isValidWindow(window)) return emptyScope();

  const manualFilter = withinWindow('tax_invoice_sent_at', window);

  const [payperLinks, manualNew, manualLegacy] = await Promise.all([
    fetchAllPagedRows<any>((from, to) =>
      supabase
        .from('payment_links')
        .select('payment_plan_id, is_legacy_payment_plan, payper_invoice_created_at')
        .not('payment_plan_id', 'is', null)
        .gte('payper_invoice_created_at', window.from)
        .lte('payper_invoice_created_at', `${window.to}T23:59:59`)
        .or(PAYPER_RECEIPT_ISSUED)
        .order('id', { ascending: true })
        .range(from, to),
    ).catch((err) => {
      console.error('[payment events] payper receipts failed:', err);
      return [] as any[];
    }),
    fetchAllPagedRows<any>((from, to) =>
      supabase
        .from('payment_plans')
        .select('id, tax_invoice_sent_at')
        .is('cancel_date', null)
        .or(manualFilter)
        .order('id', { ascending: true })
        .range(from, to),
    ).catch((err) => {
      console.error('[payment events] manual tax receipts (new) failed:', err);
      return [] as any[];
    }),
    fetchAllPagedRows<any>((from, to) =>
      supabase
        .from('finances_paymentplanrow')
        .select('id, tax_invoice_sent_at')
        .is('cancel_date', null)
        .or(manualFilter)
        .order('id', { ascending: true })
        .range(from, to),
    ).catch((err) => {
      console.error('[payment events] manual tax receipts (legacy) failed:', err);
      return [] as any[];
    }),
  ]);

  // Manual marks go in first so a Payper date can overwrite them, per the precedence above.
  const dayByKey = new Map<string, string>();
  const idsBySource = { new: new Set<string>(), legacy: new Set<string>() };

  const addManual = (rows: any[], source: 'new' | 'legacy') => {
    for (const row of rows) {
      const day = eventDayKey(row.tax_invoice_sent_at);
      if (!day || day < window.from || day > window.to) continue;
      dayByKey.set(installmentEventKey(source, row.id), day);
      idsBySource[source].add(String(row.id));
    }
  };
  addManual(manualNew, 'new');
  addManual(manualLegacy, 'legacy');

  for (const link of payperLinks) {
    const day = eventDayKey(link.payper_invoice_created_at);
    if (!day || day < window.from || day > window.to) continue;
    const source: 'new' | 'legacy' = link.is_legacy_payment_plan ? 'legacy' : 'new';
    dayByKey.set(installmentEventKey(source, link.payment_plan_id), day);
    idsBySource[source].add(String(link.payment_plan_id));
  }

  return {
    newIds: [...idsBySource.new],
    legacyIds: [...idsBySource.legacy].map((id) => Number(id)),
    eventDateByRow: dayByKey,
  };
}
