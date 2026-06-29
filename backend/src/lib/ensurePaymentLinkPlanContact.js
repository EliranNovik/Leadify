/**
 * Ensure payment_links.plan_contact_id matches the payment plan row's client_id.
 */
const supabase = require('../config/supabase');

function isLegacyPaymentLink(paymentLink) {
  return (
    paymentLink?.legacy_id != null ||
    paymentLink?.is_legacy_payment_plan === true ||
    String(paymentLink?.client_id || '').startsWith('legacy_')
  );
}

async function fetchPlanContactIdFromPlanRow(paymentLink) {
  const planId = paymentLink?.payment_plan_id;
  if (!planId) return null;

  const table = isLegacyPaymentLink(paymentLink) ? 'finances_paymentplanrow' : 'payment_plans';
  const { data, error } = await supabase.from(table).select('client_id').eq('id', planId).maybeSingle();
  if (error) {
    console.warn('[payment_links] failed to read plan client_id:', error.message || error);
    return null;
  }

  const clientId = data?.client_id;
  if (clientId == null) return null;
  const n = Number(clientId);
  return Number.isFinite(n) ? n : null;
}

/**
 * Persist plan_contact_id on the payment link when missing; returns updated row fields.
 */
async function ensurePaymentLinkPlanContact(paymentLink) {
  if (!paymentLink?.id) return paymentLink;

  const existing = paymentLink.plan_contact_id != null ? Number(paymentLink.plan_contact_id) : null;
  if (Number.isFinite(existing) && existing > 0) {
    return { ...paymentLink, plan_contact_id: existing };
  }

  const fromPlan = await fetchPlanContactIdFromPlanRow(paymentLink);
  if (!Number.isFinite(fromPlan) || fromPlan <= 0) {
    return paymentLink;
  }

  const { error } = await supabase
    .from('payment_links')
    .update({ plan_contact_id: fromPlan })
    .eq('id', paymentLink.id);

  if (error) {
    console.warn('[payment_links] failed to persist plan_contact_id:', error.message || error);
    return { ...paymentLink, plan_contact_id: fromPlan };
  }

  return { ...paymentLink, plan_contact_id: fromPlan };
}

module.exports = {
  isLegacyPaymentLink,
  fetchPlanContactIdFromPlanRow,
  ensurePaymentLinkPlanContact,
};
