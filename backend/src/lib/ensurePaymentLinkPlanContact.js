/**
 * Ensure payment_links.plan_contact_id + billing contact snapshot match the payment plan row.
 */
const supabase = require('../config/supabase');
const { lookupContactById, resolvePaymentPlanContact } = require('./resolvePaymentPlanContact');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isLegacyPaymentLink(paymentLink) {
  return (
    paymentLink?.legacy_id != null ||
    paymentLink?.is_legacy_payment_plan === true ||
    String(paymentLink?.client_id || '').startsWith('legacy_')
  );
}

function resolveLeadIdFromPaymentLink(paymentLink) {
  if (paymentLink?.legacy_id != null) return paymentLink.legacy_id;
  const clientId = paymentLink?.client_id;
  if (clientId && !String(clientId).startsWith('legacy_')) return clientId;
  const legacyFromClient = String(clientId || '').replace(/^legacy_/, '');
  if (legacyFromClient && /^\d+$/.test(legacyFromClient)) return legacyFromClient;
  return null;
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

async function lookupBillingFields(planContactId, paymentLink) {
  const leadId = resolveLeadIdFromPaymentLink(paymentLink);
  const numericLeadId =
    leadId != null && !String(leadId).includes('-') ? Number(leadId) : null;

  if (numericLeadId != null && planContactId === numericLeadId) {
    const resolved = await resolvePaymentPlanContact({
      leadId,
      clientId: planContactId,
      leadNameFallback: paymentLink.leads?.name,
      clientNameFallback: paymentLink.description?.split(' - ')[1]?.split(' (#')[0]?.trim() || null,
    });
    return {
      email: resolved.email?.trim() || '',
      name: resolved.name?.trim() || '',
    };
  }

  const direct = await lookupContactById(planContactId, '');
  return {
    email: direct?.email?.trim() || '',
    name: direct?.name?.trim() || '',
  };
}

function hasValidStoredEmail(paymentLink) {
  const stored = paymentLink?.billing_contact_email?.trim();
  return Boolean(stored && EMAIL_REGEX.test(stored));
}

/**
 * Persist plan_contact_id + billing snapshot when missing; returns updated row fields.
 */
async function ensurePaymentLinkPlanContact(paymentLink) {
  if (!paymentLink?.id) return paymentLink;

  let planContactId =
    paymentLink.plan_contact_id != null ? Number(paymentLink.plan_contact_id) : null;
  if (!Number.isFinite(planContactId) || planContactId <= 0) {
    planContactId = await fetchPlanContactIdFromPlanRow(paymentLink);
  }

  const updates = {};

  if (Number.isFinite(planContactId) && planContactId > 0) {
    if (paymentLink.plan_contact_id == null) {
      updates.plan_contact_id = planContactId;
    }

    if (!hasValidStoredEmail(paymentLink)) {
      const billing = await lookupBillingFields(planContactId, paymentLink);
      if (billing.email && EMAIL_REGEX.test(billing.email)) {
        updates.billing_contact_email = billing.email;
      }
      if (billing.name && !paymentLink.billing_contact_name?.trim()) {
        updates.billing_contact_name = billing.name;
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    if (Number.isFinite(planContactId) && planContactId > 0) {
      return { ...paymentLink, plan_contact_id: planContactId };
    }
    return paymentLink;
  }

  const { error } = await supabase.from('payment_links').update(updates).eq('id', paymentLink.id);

  if (error) {
    console.warn('[payment_links] failed to persist billing contact fields:', error.message || error);
    return { ...paymentLink, ...updates };
  }

  return { ...paymentLink, ...updates };
}

module.exports = {
  isLegacyPaymentLink,
  fetchPlanContactIdFromPlanRow,
  ensurePaymentLinkPlanContact,
};
