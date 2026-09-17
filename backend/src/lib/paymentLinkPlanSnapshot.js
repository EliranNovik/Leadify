/**
 * Keep unpaid payment_links amounts/labels aligned with the Finances installment row.
 * payment_links stores a denormalized snapshot; reusing a live token after the plan
 * row was edited (or after an ID collision) must not charge the wrong installment.
 */

const { isExpenseNoVatPayment, isLegacyPaymentPlanLink, paymentOrderLabel } = require('./paymentPlanOrder');

const PAYMENT_AMOUNT_MATCH_EPS = 0.009;

function roundPaymentMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function paymentAmountsEqual(a, b) {
  return Math.abs(roundPaymentMoney(a) - roundPaymentMoney(b)) <= PAYMENT_AMOUNT_MATCH_EPS;
}

function isIsraeliShekelCurrency(currency, currencyId) {
  if (currencyId != null && currencyId !== '' && Number(currencyId) === 1) return true;
  if (!currency) return false;
  const c = String(currency).trim();
  return c === '₪' || c === 'ILS' || c === 'NIS' || c === '?';
}

function getVatRateForDate(dateString) {
  if (!dateString) return 0.18;
  const paymentDate = new Date(dateString);
  if (Number.isNaN(paymentDate.getTime())) return 0.18;
  return paymentDate < new Date('2025-01-01T00:00:00') ? 0.17 : 0.18;
}

function readPlanVat(row, isLegacy) {
  const raw = isLegacy ? row?.vat_value : row?.value_vat;
  if (raw != null && raw !== '' && Number.isFinite(Number(raw))) {
    return Number(raw) || 0;
  }
  const value = Number(row?.value) || 0;
  const order = isLegacy ? row?.order : row?.payment_order;
  if (isExpenseNoVatPayment(order)) return 0;
  const dueDate = isLegacy ? row?.date ?? row?.due_date : row?.due_date;
  if (isIsraeliShekelCurrency(row?.currency, row?.currency_id)) {
    return roundPaymentMoney(value * getVatRateForDate(dueDate));
  }
  return 0;
}

function snapshotFromNewPlanRow(row) {
  if (!row) return null;
  const amount = roundPaymentMoney(Number(row.value) || 0);
  const vatAmount = roundPaymentMoney(readPlanVat(row, false));
  return {
    amount,
    vatAmount,
    totalAmount: roundPaymentMoney(amount + vatAmount),
    orderLabel: paymentOrderLabel(row.payment_order),
    currency: row.currency || '₪',
    paid: Boolean(row.paid),
  };
}

function snapshotFromLegacyPlanRow(row) {
  if (!row) return null;
  const amount = roundPaymentMoney(Number(row.value) || 0);
  const vatAmount = roundPaymentMoney(readPlanVat(row, true));
  const currencyName = row.accounting_currencies?.name || row.accounting_currencies?.iso_code;
  return {
    amount,
    vatAmount,
    totalAmount: roundPaymentMoney(amount + vatAmount),
    orderLabel: paymentOrderLabel(row.order),
    currency: currencyName || '₪',
    paid: Boolean(row.actual_date),
  };
}

function paymentLinkMatchesSnapshot(link, snapshot) {
  if (!link || !snapshot) return false;
  if (!paymentAmountsEqual(Number(link.amount) || 0, snapshot.amount)) return false;
  if (!paymentAmountsEqual(Number(link.vat_amount) || 0, snapshot.vatAmount)) return false;
  if (!paymentAmountsEqual(Number(link.total_amount) || 0, snapshot.totalAmount)) return false;
  const prefix = String(link.description || '')
    .split(' - ')[0]
    ?.trim();
  if (prefix && prefix !== snapshot.orderLabel) return false;
  return true;
}

function applySnapshotToPaymentLink(link, snapshot) {
  const description = String(link?.description || '');
  const nextDescription = description.includes(' - ')
    ? `${snapshot.orderLabel} - ${description.split(' - ').slice(1).join(' - ')}`
    : snapshot.orderLabel;
  return {
    ...link,
    amount: snapshot.amount,
    vat_amount: snapshot.vatAmount,
    total_amount: snapshot.totalAmount,
    currency: snapshot.currency || link?.currency || '₪',
    description: nextDescription,
  };
}

async function loadPlanSnapshot(supabase, payment) {
  const planId = Number(payment?.payment_plan_id);
  if (!Number.isFinite(planId)) return null;

  if (isLegacyPaymentPlanLink(payment)) {
    const { data, error } = await supabase
      .from('finances_paymentplanrow')
      .select(
        `
        id, value, vat_value, order, currency_id, date, actual_date,
        accounting_currencies!finances_paymentplanrow_currency_id_fkey (name, iso_code)
      `,
      )
      .eq('id', planId)
      .maybeSingle();
    if (error) {
      console.error('[payment-link] load legacy plan snapshot:', error);
      return null;
    }
    const currencies = data?.accounting_currencies;
    const currencyRow = Array.isArray(currencies) ? currencies[0] : currencies;
    return snapshotFromLegacyPlanRow(data ? { ...data, accounting_currencies: currencyRow || null } : null);
  }

  const { data, error } = await supabase
    .from('payment_plans')
    .select('id, value, value_vat, payment_order, currency, currency_id, due_date, paid')
    .eq('id', planId)
    .maybeSingle();
  if (error) {
    console.error('[payment-link] load plan snapshot:', error);
    return null;
  }
  return snapshotFromNewPlanRow(data);
}

function isOpenFinancePending(payment) {
  if (!payment || String(payment.status || '').toLowerCase() === 'paid') return false;
  if (String(payment.status || '').toLowerCase() !== 'processing') return false;
  const raw = payment.pelecard_raw_response;
  if (raw && typeof raw === 'object' && raw.openFinancePending === true) return true;
  return String(payment.pelecard_status_code || '').trim() === '665';
}

/**
 * Overwrite denormalized checkout amounts from the installment row.
 * Skips paid links and in-flight Open Finance transfers.
 */
async function syncUnpaidPaymentLinkToPlan(supabase, payment) {
  if (!payment?.id) return payment;
  if (String(payment.status || '').toLowerCase() === 'paid') return payment;
  if (isOpenFinancePending(payment)) return payment;

  const snapshot = await loadPlanSnapshot(supabase, payment);
  if (!snapshot || snapshot.paid) return payment;
  if (snapshot.totalAmount <= 0 && Number(payment.total_amount) > 0) return payment;
  if (paymentLinkMatchesSnapshot(payment, snapshot)) {
    return applySnapshotToPaymentLink(payment, snapshot);
  }

  const next = applySnapshotToPaymentLink(payment, snapshot);
  const updates = {
    amount: next.amount,
    vat_amount: next.vat_amount,
    total_amount: next.total_amount,
    currency: next.currency,
    description: next.description,
    pelecard_session_url: null,
    pelecard_confirmation_key: null,
  };
  const status = String(payment.status || 'pending').toLowerCase();
  if (status === 'processing' || status === 'failed' || status === 'cancelled' || status === 'expired') {
    updates.status = 'pending';
  }

  const { error } = await supabase.from('payment_links').update(updates).eq('id', payment.id);
  if (error) {
    console.error('[payment-link] sync unpaid link to plan failed', error);
    return next;
  }

  console.info('[payment-link] synced checkout amounts to installment row', {
    paymentLinkId: payment.id,
    paymentPlanId: payment.payment_plan_id,
    fromTotal: payment.total_amount,
    toTotal: next.total_amount,
    orderLabel: snapshot.orderLabel,
  });

  return { ...next, ...updates };
}

module.exports = {
  roundPaymentMoney,
  paymentAmountsEqual,
  snapshotFromNewPlanRow,
  snapshotFromLegacyPlanRow,
  paymentLinkMatchesSnapshot,
  applySnapshotToPaymentLink,
  loadPlanSnapshot,
  syncUnpaidPaymentLinkToPlan,
};
