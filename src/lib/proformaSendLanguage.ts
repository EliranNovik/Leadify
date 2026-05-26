/** Language chosen before sending proforma invoice by email + WhatsApp. */
export type ProformaSendLanguage = 'en' | 'he';

export const PROFORMA_EMAIL_TEMPLATE_ID_EN = 180;
export const PROFORMA_EMAIL_TEMPLATE_ID_HE = 179;

export const PROFORMA_WHATSAPP_TEMPLATE_ID_EN_DEFAULT = 38;
export const PROFORMA_WHATSAPP_TEMPLATE_ID_HE = 40;

export function getProformaEmailTemplateId(language: ProformaSendLanguage = 'en'): number {
  return language === 'he' ? PROFORMA_EMAIL_TEMPLATE_ID_HE : PROFORMA_EMAIL_TEMPLATE_ID_EN;
}

/** English WhatsApp id: env override, else 38. Hebrew: always 40. */
export function getProformaWhatsAppTemplateId(language: ProformaSendLanguage = 'en'): number {
  if (language === 'he') return PROFORMA_WHATSAPP_TEMPLATE_ID_HE;
  const fromEnv = Number(import.meta.env.VITE_PROFORMA_WHATSAPP_TEMPLATE_ID || '');
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return PROFORMA_WHATSAPP_TEMPLATE_ID_EN_DEFAULT;
}

export function proformaSendLanguageLabel(language: ProformaSendLanguage): string {
  return language === 'he' ? 'Hebrew' : 'English';
}

/** Anchor text for {{link}} in proforma invoice emails. */
export function getProformaInvoiceLinkLabel(language: ProformaSendLanguage = 'en'): string {
  return language === 'he' ? 'קישור לחשבונית' : 'Your invoice link';
}

/** Anchor text for {{payment_link}} in proforma invoice emails. */
export function getProformaPaymentLinkLabel(language: ProformaSendLanguage = 'en'): string {
  return language === 'he' ? 'לתשלום מקוון' : 'Pay online';
}
