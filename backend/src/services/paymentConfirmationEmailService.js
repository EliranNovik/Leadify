const supabase = require('../config/supabase');
const graphMailboxSyncService = require('./graphMailboxSyncService');
const {
  resolveClientName,
  resolvePaymentDescription,
  resolveRecipientEmail,
} = require('../lib/paymentLinkContact');
const {
  parseEmailTemplateContent,
  escapeHtml,
  formatPlainEmailHtml,
  stripRemainingBraces,
} = require('../lib/emailTemplateContent');

const DEFAULT_TEMPLATE_ID = 184;

function getTemplateId() {
  const raw = process.env.PAYMENT_CONFIRMATION_EMAIL_TEMPLATE_ID || String(DEFAULT_TEMPLATE_ID);
  const id = parseInt(raw, 10);
  return Number.isFinite(id) ? id : DEFAULT_TEMPLATE_ID;
}

function getMailboxUserId() {
  return (process.env.PAYMENT_CONFIRMATION_MAILBOX_USER_ID || '').trim();
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
    invoice_link: escapeHtml(vars.invoice_link),
    invoice_number: escapeHtml(vars.invoice_number),
  };

  let result = content
    .replace(/\{\{\s*client\s*\}\}/gi, safe.client)
    .replace(/\{\s*client\s*\}/gi, safe.client)
    .replace(/\{\{\s*total\s*\}\}/gi, safe.total)
    .replace(/\{\s*total\s*\}/gi, safe.total)
    .replace(/\{\{\s*payment_date\s*\}\}/gi, safe.payment_date)
    .replace(/\{\s*payment_date\s*\}/gi, safe.payment_date)
    .replace(/\{\{\s*description\s*\}\}/gi, safe.description)
    .replace(/\{\s*description\s*\}/gi, safe.description)
    .replace(/\{\{\s*invoice_link\s*\}\}/gi, safe.invoice_link)
    .replace(/\{\s*invoice_link\s*\}/gi, safe.invoice_link)
    .replace(/\{\{\s*invoice_number\s*\}\}/gi, safe.invoice_number)
    .replace(/\{\s*invoice_number\s*\}/gi, safe.invoice_number);

  return stripRemainingBraces(result);
}

function buildSubject(templateName, vars) {
  const base =
    applyPaymentConfirmationPlaceholders(templateName, vars).trim() || 'Payment confirmation';
  return base;
}

function appendInvoiceBlock(bodyHtml, invoiceLink, invoiceNumber) {
  if (!invoiceLink) return bodyHtml;
  const label = invoiceNumber
    ? `Tax invoice-receipt #${escapeHtml(String(invoiceNumber))}`
    : 'View tax invoice-receipt';
  const block = `<p style="margin-top:16px"><a href="${escapeHtml(invoiceLink)}" style="color:#3b28c7;font-weight:600">${label}</a></p>`;
  if (bodyHtml.includes('</body>')) {
    return bodyHtml.replace('</body>', `${block}</body>`);
  }
  return `${bodyHtml}${block}`;
}

/**
 * Send payment confirmation email to the client after a successful online payment.
 * Uses misc_emailtemplate id 184 (override via PAYMENT_CONFIRMATION_EMAIL_TEMPLATE_ID).
 * Sends via Microsoft Graph using PAYMENT_CONFIRMATION_MAILBOX_USER_ID (connected mailbox).
 * Never throws — payment flow must not be affected by mail failures.
 */
async function sendPaymentConfirmationEmail(
  paymentLink,
  { paidAt, invoiceLink, invoiceNumber, force = false } = {},
) {
  try {
    const mailboxUserId = getMailboxUserId();
    if (!mailboxUserId) {
      console.warn(
        '[PaymentConfirmationEmail] PAYMENT_CONFIRMATION_MAILBOX_USER_ID is not set — skipping client email',
      );
      return { skipped: true, reason: 'no_mailbox_user' };
    }

    const recipient = await resolveRecipientEmail(paymentLink, { allowLeadFallback: true });
    if (!recipient) {
      console.warn('[PaymentConfirmationEmail] No valid client email for payment link', {
        paymentLinkId: paymentLink.id,
        planContactId: paymentLink.plan_contact_id ?? null,
        billingContactEmail: paymentLink.billing_contact_email ?? null,
        leadEmail: paymentLink.leads?.email ?? null,
      });
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

    if (existingRow?.payment_confirmation_email_sent_at && !force) {
      return { skipped: true, reason: 'already_sent' };
    }

    const templateId = getTemplateId();
    const resolvedInvoiceLink =
      invoiceLink || paymentLink.payper_invoice_link || null;
    const resolvedInvoiceNumber =
      invoiceNumber || paymentLink.payper_invoice_number || null;

    const vars = {
      client: await resolveClientName(paymentLink),
      total: formatPaidTotal(paymentLink),
      payment_date: formatPaymentDate(paidAt || paymentLink.paid_at),
      description: resolvePaymentDescription(paymentLink),
      invoice_link: resolvedInvoiceLink || '',
      invoice_number: resolvedInvoiceNumber || '',
    };

    const template = await fetchEmailTemplate(templateId);
    let plainBody = applyPaymentConfirmationPlaceholders(template.content, vars);
    let bodyHtml = formatPlainEmailHtml(plainBody);

    if (resolvedInvoiceLink && !plainBody.includes(resolvedInvoiceLink)) {
      bodyHtml = appendInvoiceBlock(bodyHtml, resolvedInvoiceLink, resolvedInvoiceNumber);
    }

    const subject = buildSubject(template.name, vars);

    await graphMailboxSyncService.sendEmail(mailboxUserId, {
      subject,
      bodyHtml,
      bodyContentType: 'HTML',
      to: [recipient],
      context: {
        clientId: paymentLink.client_id || null,
        legacyLeadId: paymentLink.legacy_id || null,
        leadType: paymentLink.legacy_id != null ? 'legacy' : null,
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
      hasInvoiceLink: Boolean(resolvedInvoiceLink),
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
