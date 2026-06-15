const {
  parseEmailTemplateContent,
  escapeHtml,
  formatPlainEmailHtml,
  stripRemainingBraces,
} = require('./emailTemplateContent');
const {
  getProformaInvoiceLinkLabel,
  getProformaPaymentLinkLabel,
} = require('./proformaSendLanguage');

function applyProformaPlaceholders(content, vars, options = {}) {
  const language = options.language ?? 'en';
  const linkLabel = getProformaInvoiceLinkLabel(language);
  const linkHtml = vars.publicUrl
    ? `<a href="${escapeHtml(vars.publicUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkLabel)}</a>`
    : '';
  const linkValue = linkHtml || linkLabel;

  const paymentLinkLabel = getProformaPaymentLinkLabel(language);
  const paymentLinkHtml = vars.paymentLinkUrl
    ? `<a href="${escapeHtml(vars.paymentLinkUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(paymentLinkLabel)}</a>`
    : '';
  const paymentLinkValue = paymentLinkHtml || paymentLinkLabel;

  const includeLeadAndClient = options.includeLeadAndClient !== false;

  let result = content
    .replace(/\{\{\s*link\s*\}\}/gi, linkValue)
    .replace(/\{\s*link\s*\}/gi, linkValue)
    .replace(/\{\{\s*payment_link\s*\}\}/gi, paymentLinkValue)
    .replace(/\{\s*payment_link\s*\}/gi, paymentLinkValue);

  if (includeLeadAndClient) {
    result = result
      .replace(/\{\{\s*lead_number\s*\}\}/gi, vars.leadNumber)
      .replace(/\{\{\s*client_name\s*\}\}/gi, vars.clientName)
      .replace(/\{\s*lead_number\s*\}/gi, vars.leadNumber)
      .replace(/\{\s*client_name\s*\}/gi, vars.clientName);
  } else {
    result = result
      .replace(/\{\{\s*lead_number\s*\}\}/gi, '')
      .replace(/\{\{\s*client_name\s*\}\}/gi, '')
      .replace(/\{\s*lead_number\s*\}/gi, '')
      .replace(/\{\s*client_name\s*\}/gi, '');
  }

  return stripRemainingBraces(result);
}

function buildProformaEmailSubject(templateName, vars, language = 'en') {
  const base =
    applyProformaPlaceholders(templateName, vars, { includeLeadAndClient: false, language }).trim() ||
    'Invoice';
  return [base, vars.leadNumber, vars.clientName].filter((part) => part.length > 0).join(' — ');
}

module.exports = {
  parseEmailTemplateContent,
  formatPlainEmailHtml,
  applyProformaPlaceholders,
  buildProformaEmailSubject,
};
