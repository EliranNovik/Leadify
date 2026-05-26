const supabase = require('../config/supabase');
const graphMailboxSyncService = require('./graphMailboxSyncService');
const { paymentOrderLabel } = require('../lib/paymentOrderLabel');
const {
  parseEmailTemplateContent,
  escapeHtml,
  formatPlainEmailHtml,
  stripRemainingBraces,
} = require('../lib/emailTemplateContent');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_TEMPLATE_ID = 184;

function getTemplateId() {
  const raw = process.env.PAYMENT_CONFIRMATION_EMAIL_TEMPLATE_ID || String(DEFAULT_TEMPLATE_ID);
  const id = parseInt(raw, 10);
  return Number.isFinite(id) ? id : DEFAULT_TEMPLATE_ID;
}

function getMailboxUserId() {
  return (process.env.PAYMENT_CONFIRMATION_MAILBOX_USER_ID || '').trim();
}

function isLegacyPaymentLink(paymentLink) {
  return (
    paymentLink?.legacy_id != null ||
    paymentLink?.is_legacy_payment_plan === true ||
    String(paymentLink?.client_id || '').startsWith('legacy_')
  );
}

function getCurrencySymbol(currency) {
  if (!currency) return '₪';
  if (currency === 'USD' || currency === '$') return '$';
  if (currency === '₪' || currency === 'ILS' || currency === 'NIS') return '₪';
  if (currency === 'EUR' || currency === '€') return '€';
  if (currency === 'GBP') return '£';
  return currency;
}

function formatPaidTotal(paymentLink) {
  const amount = Number(paymentLink.total_amount ?? paymentLink.amount ?? 0);
  const symbol = getCurrencySymbol(paymentLink.currency);
  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${formatted}`;
}

function formatPaymentDate(paidAt) {
  const date = paidAt ? new Date(paidAt) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
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
  return prefix ? paymentOrderLabel(prefix) : 'Payment';
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

async function fetchEmailTemplate(templateId) {
  const { data, error } = await supabase
    .from('misc_emailtemplate')
    .select('name, content')
    .eq('id', templateId)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Payment confirmation email template (${templateId}) was not found.`);
  }

  return {
    name: (data.name || 'Payment confirmation').trim(),
    content: parseEmailTemplateContent(data.content),
  };
}

function applyPaymentConfirmationPlaceholders(content, vars) {
  const safe = {
    client: escapeHtml(vars.client),
    total: escapeHtml(vars.total),
    payment_date: escapeHtml(vars.payment_date),
    description: escapeHtml(vars.description),
  };

  return stripRemainingBraces(
    content
      .replace(/\{\{\s*client\s*\}\}/gi, safe.client)
      .replace(/\{\s*client\s*\}/gi, safe.client)
      .replace(/\{\{\s*total\s*\}\}/gi, safe.total)
      .replace(/\{\s*total\s*\}/gi, safe.total)
      .replace(/\{\{\s*payment_date\s*\}\}/gi, safe.payment_date)
      .replace(/\{\s*payment_date\s*\}/gi, safe.payment_date)
      .replace(/\{\{\s*description\s*\}\}/gi, safe.description)
      .replace(/\{\s*description\s*\}/gi, safe.description),
  );
}

function buildSubject(templateName, vars) {
  const base =
    applyPaymentConfirmationPlaceholders(templateName, vars).trim() || 'Payment confirmation';
  return base;
}

/**
 * Send payment confirmation email to the client after a successful online payment.
 * Uses misc_emailtemplate id 184 (override via PAYMENT_CONFIRMATION_EMAIL_TEMPLATE_ID).
 * Sends via Microsoft Graph using PAYMENT_CONFIRMATION_MAILBOX_USER_ID (connected mailbox).
 * Never throws — payment flow must not be affected by mail failures.
 */
async function sendPaymentConfirmationEmail(paymentLink, { paidAt } = {}) {
  try {
    const mailboxUserId = getMailboxUserId();
    if (!mailboxUserId) {
      console.warn(
        '[PaymentConfirmationEmail] PAYMENT_CONFIRMATION_MAILBOX_USER_ID is not set — skipping client email',
      );
      return { skipped: true, reason: 'no_mailbox_user' };
    }

    const recipient = await resolveRecipientEmail(paymentLink);
    if (!recipient) {
      console.warn('[PaymentConfirmationEmail] No valid client email for payment link', paymentLink.id);
      return { skipped: true, reason: 'no_recipient' };
    }

    const { data: existingRow, error: existingError } = await supabase
      .from('payment_links')
      .select('payment_confirmation_email_sent_at')
      .eq('id', paymentLink.id)
      .maybeSingle();

    if (existingError && existingError.code !== 'PGRST204') {
      console.error('[PaymentConfirmationEmail] Failed to read send status:', existingError);
      return { skipped: true, reason: 'read_error' };
    }

    if (existingRow?.payment_confirmation_email_sent_at) {
      return { skipped: true, reason: 'already_sent' };
    }

    const templateId = getTemplateId();
    const legacy = isLegacyPaymentLink(paymentLink);
    const vars = {
      client: resolveClientName(paymentLink),
      total: formatPaidTotal(paymentLink),
      payment_date: formatPaymentDate(paidAt || paymentLink.paid_at),
      description: resolvePaymentDescription(paymentLink),
    };

    const template = await fetchEmailTemplate(templateId);
    const plainBody = applyPaymentConfirmationPlaceholders(template.content, vars);
    const bodyHtml = formatPlainEmailHtml(plainBody);
    const subject = buildSubject(template.name, vars);

    await graphMailboxSyncService.sendEmail(mailboxUserId, {
      subject,
      bodyHtml,
      bodyContentType: 'HTML',
      to: [recipient],
      context: {
        clientId: legacy ? null : paymentLink.client_id || null,
        legacyLeadId: legacy ? paymentLink.legacy_id : null,
        leadType: legacy ? 'legacy' : null,
        contactEmail: recipient,
        contactName: vars.client,
        userInternalId: mailboxUserId,
      },
    });

    const sentAt = new Date().toISOString();
    const { error: markSentError } = await supabase
      .from('payment_links')
      .update({ payment_confirmation_email_sent_at: sentAt })
      .eq('id', paymentLink.id)
      .is('payment_confirmation_email_sent_at', null);

    if (markSentError && markSentError.code !== 'PGRST204') {
      console.warn('[PaymentConfirmationEmail] Email sent but failed to record sent_at:', markSentError);
    }

    console.info('[PaymentConfirmationEmail] Sent confirmation email', {
      paymentLinkId: paymentLink.id,
      recipient,
      templateId,
    });

    return { sent: true, recipient };
  } catch (error) {
    console.error('[PaymentConfirmationEmail] Send failed (payment unaffected):', error.message || error);
    return { failed: true, error: error.message || String(error) };
  }
}

module.exports = {
  sendPaymentConfirmationEmail,
};
