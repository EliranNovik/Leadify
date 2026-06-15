const PROFORMA_EMAIL_TEMPLATE_ID_EN = 180;
const PROFORMA_EMAIL_TEMPLATE_ID_HE = 179;
const PROFORMA_WHATSAPP_TEMPLATE_ID_EN_DEFAULT = 41;
const PROFORMA_WHATSAPP_TEMPLATE_ID_HE = 40;

function getProformaEmailTemplateId(language = 'en') {
  return language === 'he' ? PROFORMA_EMAIL_TEMPLATE_ID_HE : PROFORMA_EMAIL_TEMPLATE_ID_EN;
}

function getProformaWhatsAppTemplateId(language = 'en') {
  if (language === 'he') return PROFORMA_WHATSAPP_TEMPLATE_ID_HE;
  const fromEnv = Number(process.env.PROFORMA_WHATSAPP_TEMPLATE_ID || '');
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return PROFORMA_WHATSAPP_TEMPLATE_ID_EN_DEFAULT;
}

function getProformaInvoiceLinkLabel(language = 'en') {
  return language === 'he' ? 'קישור לחשבונית' : 'Your invoice link';
}

function getProformaPaymentLinkLabel(language = 'en') {
  return language === 'he' ? 'לתשלום מקוון' : 'Pay online';
}

module.exports = {
  getProformaEmailTemplateId,
  getProformaWhatsAppTemplateId,
  getProformaInvoiceLinkLabel,
  getProformaPaymentLinkLabel,
};
