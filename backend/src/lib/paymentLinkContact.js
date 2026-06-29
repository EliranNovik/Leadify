/**
 * Resolve billing contact fields from a payment_links row (new + legacy leads).
 */
const supabase = require('../config/supabase');
const { paymentOrderLabel } = require('./paymentOrderLabel');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isLegacyPaymentLink(paymentLink) {
  return (
    paymentLink?.legacy_id != null ||
    paymentLink?.is_legacy_payment_plan === true ||
    String(paymentLink?.client_id || '').startsWith('legacy_')
  );
}

function resolveClientName(paymentLink) {
  if (paymentLink.leads?.name?.trim()) return paymentLink.leads.name.trim();
  const desc = paymentLink.description || '';
  const match = desc.match(/^[^-]+-\s*(.+?)\s*\(#/);
  if (match?.[1]) return match[1].trim();
  return 'Client';
}

function resolvePaymentDescription(paymentLink) {
  if (paymentLink.payment_plans?.payment_order != null) {
    return paymentOrderLabel(paymentLink.payment_plans.payment_order);
  }
  if (paymentLink.legacy_payment_plan?.order != null) {
    return paymentOrderLabel(paymentLink.legacy_payment_plan.order);
  }
  const desc = paymentLink.description || '';
  const prefix = desc.split(' - ')[0]?.trim();
  return prefix ? paymentOrderLabel(prefix) : paymentLink.description || 'Payment';
}

async function resolveRecipientEmail(paymentLink) {
  const leadEmail = paymentLink.leads?.email?.trim();
  if (leadEmail && EMAIL_REGEX.test(leadEmail)) return leadEmail;

  const planId = paymentLink.payment_plan_id;
  if (!planId) return null;

  const legacy = isLegacyPaymentLink(paymentLink);

  if (legacy) {
    const { data: ppr } = await supabase
      .from('finances_paymentplanrow')
      .select('client_id')
      .eq('id', planId)
      .maybeSingle();
    if (ppr?.client_id) {
      const { data: contact } = await supabase
        .from('leads_contact')
        .select('email')
        .eq('id', ppr.client_id)
        .maybeSingle();
      const email = contact?.email?.trim();
      if (email && EMAIL_REGEX.test(email)) return email;
    }
  } else {
    const { data: plan } = await supabase
      .from('payment_plans')
      .select('client_id')
      .eq('id', planId)
      .maybeSingle();
    if (plan?.client_id) {
      const { data: contact } = await supabase
        .from('contacts')
        .select('email')
        .eq('id', plan.client_id)
        .maybeSingle();
      const email = contact?.email?.trim();
      if (email && EMAIL_REGEX.test(email)) return email;
    }
  }

  return null;
}

async function resolveRecipientPhone(paymentLink) {
  const leadPhone = paymentLink.leads?.phone?.trim();
  if (leadPhone) return leadPhone;

  const planId = paymentLink.payment_plan_id;
  if (!planId) return null;

  const legacy = isLegacyPaymentLink(paymentLink);

  if (legacy) {
    const { data: ppr } = await supabase
      .from('finances_paymentplanrow')
      .select('client_id')
      .eq('id', planId)
      .maybeSingle();
    if (ppr?.client_id) {
      const { data: contact } = await supabase
        .from('leads_contact')
        .select('phone, mobile')
        .eq('id', ppr.client_id)
        .maybeSingle();
      return contact?.mobile?.trim() || contact?.phone?.trim() || null;
    }
  } else {
    const { data: plan } = await supabase
      .from('payment_plans')
      .select('client_id')
      .eq('id', planId)
      .maybeSingle();
    if (plan?.client_id) {
      const { data: contact } = await supabase
        .from('contacts')
        .select('phone, mobile')
        .eq('id', plan.client_id)
        .maybeSingle();
      return contact?.mobile?.trim() || contact?.phone?.trim() || null;
    }
  }

  return null;
}

async function resolveContactIdNumber(paymentLink) {
  const planId = paymentLink.payment_plan_id;
  if (!planId) return null;

  const legacy = isLegacyPaymentLink(paymentLink);

  if (legacy) {
    const { data: ppr } = await supabase
      .from('finances_paymentplanrow')
      .select('client_id')
      .eq('id', planId)
      .maybeSingle();
    if (ppr?.client_id) {
      const { data: contact } = await supabase
        .from('leads_contact')
        .select('id_number')
        .eq('id', ppr.client_id)
        .maybeSingle();
      return contact?.id_number?.trim() || null;
    }
  } else {
    const { data: plan } = await supabase
      .from('payment_plans')
      .select('client_id')
      .eq('id', planId)
      .maybeSingle();
    if (plan?.client_id) {
      const { data: contact } = await supabase
        .from('contacts')
        .select('id_number')
        .eq('id', plan.client_id)
        .maybeSingle();
      return contact?.id_number?.trim() || null;
    }
  }

  return null;
}

module.exports = {
  isLegacyPaymentLink,
  resolveClientName,
  resolvePaymentDescription,
  resolveRecipientEmail,
  resolveRecipientPhone,
  resolveContactIdNumber,
};
