/**
 * Billing contact fields from payment_links.plan_contact_id (payment plan row contact).
 */
const supabase = require('../config/supabase');
const { paymentOrderLabel } = require('./paymentOrderLabel');
const { ensurePaymentLinkPlanContact } = require('./ensurePaymentLinkPlanContact');
const { resolvePaymentPlanContact } = require('./resolvePaymentPlanContact');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return Boolean(email && EMAIL_REGEX.test(String(email).trim()));
}

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

function resolveClientNameFromDescription(paymentLink) {
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

/**
 * Resolve billing contact strictly from plan_contact_id (ensured from payment plan row).
 */
async function resolvePlanBillingContact(paymentLink) {
  const link = await ensurePaymentLinkPlanContact(paymentLink);
  const contactId =
    link.plan_contact_id != null ? Number(link.plan_contact_id) : null;

  if (!Number.isFinite(contactId) || contactId <= 0) {
    return null;
  }

  const leadId = resolveLeadIdFromPaymentLink(link);
  const numericLeadId =
    leadId != null && !String(leadId).includes('-') ? Number(leadId) : null;

  // Legacy main-client rows store lead_id as client_id — resolve via lead_leadcontact.
  if (numericLeadId != null && contactId === numericLeadId) {
    return resolvePaymentPlanContact({
      leadId,
      clientId: contactId,
      clientNameFallback: resolveClientNameFromDescription(link),
      leadNameFallback: link.leads?.name,
    });
  }

  const { data: row, error } = await supabase
    .from('leads_contact')
    .select('name, email, phone, mobile, id_passport')
    .eq('id', contactId)
    .maybeSingle();

  if (error) {
    console.warn('[payment_links] leads_contact lookup failed:', error.message || error);
    return null;
  }

  if (!row) {
    return resolvePaymentPlanContact({
      leadId,
      clientId: contactId,
      clientNameFallback: resolveClientNameFromDescription(link),
      leadNameFallback: link.leads?.name,
    });
  }

  return {
    name: row.name?.trim() || resolveClientNameFromDescription(link),
    email: row.email?.trim() || '',
    phone: row.mobile?.trim() || row.phone?.trim() || '',
    idNumber: row.id_passport?.trim() || '',
    contactId,
  };
}

async function resolveRecipientEmail(paymentLink) {
  const contact = await resolvePlanBillingContact(paymentLink);
  const email = contact?.email?.trim();
  return isValidEmail(email) ? email : null;
}

async function resolveRecipientPhone(paymentLink) {
  const contact = await resolvePlanBillingContact(paymentLink);
  return contact?.phone?.trim() || null;
}

async function resolveContactIdNumber(paymentLink) {
  const contact = await resolvePlanBillingContact(paymentLink);
  return contact?.idNumber?.trim() || null;
}

async function resolveClientName(paymentLink) {
  const contact = await resolvePlanBillingContact(paymentLink);
  return contact?.name?.trim() || resolveClientNameFromDescription(paymentLink);
}

/** @deprecated sync helper — prefer resolveClientName (async) */
function resolveClientNameSync(paymentLink) {
  return resolveClientNameFromDescription(paymentLink);
}

module.exports = {
  isLegacyPaymentLink,
  resolveClientName,
  resolveClientNameSync,
  resolvePaymentDescription,
  resolvePlanBillingContact,
  resolveRecipientEmail,
  resolveRecipientPhone,
  resolveContactIdNumber,
};
