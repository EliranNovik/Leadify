/**
 * Keep one public payment URL alive for the life of an unpaid invoice.
 * Date expiry / cancel / fail must not force the office to mint a new token.
 */

const PAYMENT_LINK_TTL_DAYS = 180;
const RETRYABLE_STATUSES = new Set(['pending', 'processing', 'failed', 'cancelled', 'expired']);

function paymentLinkExpiresAtIso(from = new Date()) {
  const expiresAt = new Date(from);
  expiresAt.setDate(expiresAt.getDate() + PAYMENT_LINK_TTL_DAYS);
  return expiresAt.toISOString();
}

function isPaidStatus(status) {
  return String(status || '').toLowerCase() === 'paid';
}

function isOpenFinancePending(payment) {
  if (!payment || isPaidStatus(payment.status)) return false;
  if (String(payment.status || '').toLowerCase() !== 'processing') return false;
  const raw = payment.pelecard_raw_response;
  if (raw && typeof raw === 'object' && raw.openFinancePending === true) return true;
  const code = String(payment.pelecard_status_code || '').trim();
  return code === '665';
}

function withOpenFinanceFlag(raw, pending) {
  const previous = raw && typeof raw === 'object' ? raw : {};
  return { ...previous, openFinancePending: Boolean(pending) };
}

async function reviveUnpaidPaymentLink(supabase, payment) {
  if (!payment?.id || isPaidStatus(payment.status)) return payment;

  const status = String(payment.status || 'pending').toLowerCase();
  if (!RETRYABLE_STATUSES.has(status)) return payment;

  const updates = {
    expires_at: paymentLinkExpiresAtIso(),
  };

  if (status === 'expired' || status === 'cancelled' || status === 'failed') {
    updates.status = 'pending';
    updates.pelecard_raw_response = withOpenFinanceFlag(payment.pelecard_raw_response, false);
  }

  const { error } = await supabase.from('payment_links').update(updates).eq('id', payment.id);
  if (error) {
    console.error('[payment-link] revive unpaid link failed', error);
    return payment;
  }

  return { ...payment, ...updates };
}

module.exports = {
  PAYMENT_LINK_TTL_DAYS,
  RETRYABLE_STATUSES,
  paymentLinkExpiresAtIso,
  isPaidStatus,
  isOpenFinancePending,
  withOpenFinanceFlag,
  reviveUnpaidPaymentLink,
};
