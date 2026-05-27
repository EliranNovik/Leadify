import {
  resolveProformaContactEmail,
  sendProformaInvoiceEmail,
  type ProformaSendEmailInput,
} from './proformaSendEmail';
import {
  resolveProformaContactPhone,
  sendProformaInvoiceWhatsApp,
} from './proformaSendWhatsApp';
import type { ProformaSendLanguage } from './proformaSendLanguage';
import { proformaSendLanguageLabel } from './proformaSendLanguage';

export type ProformaSendBundleResult = {
  emailSent: boolean;
  emailError: Error | null;
  whatsAppSent: boolean;
  whatsAppPhone: string;
  whatsAppError: Error | null;
};

/** Send invoice by email and/or WhatsApp, using whichever contact channels are available. */
export async function sendProformaInvoiceBundle(
  input: ProformaSendEmailInput,
): Promise<ProformaSendBundleResult> {
  const [resolvedEmail, resolvedPhone] = await Promise.all([
    resolveProformaContactEmail(input.contactId, input.contactEmail),
    resolveProformaContactPhone(input),
  ]);

  if (!resolvedEmail && !resolvedPhone) {
    throw new Error(
      'No email or phone number found for this proforma contact. Add contact details before sending.',
    );
  }

  let emailSent = false;
  let emailError: Error | null = null;
  if (resolvedEmail) {
    try {
      await sendProformaInvoiceEmail({
        ...input,
        contactEmail: resolvedEmail,
      });
      emailSent = true;
    } catch (err) {
      emailError = err instanceof Error ? err : new Error(String(err));
      console.warn('[sendProformaInvoiceBundle] Email:', emailError);
    }
  }

  let whatsAppSent = false;
  let whatsAppPhone = '';
  let whatsAppError: Error | null = null;
  if (resolvedPhone) {
    try {
      const wa = await sendProformaInvoiceWhatsApp({
        ...input,
        contactPhone: resolvedPhone,
      });
      whatsAppSent = true;
      whatsAppPhone = wa.phoneNumber;
    } catch (err) {
      whatsAppError = err instanceof Error ? err : new Error(String(err));
      console.warn('[sendProformaInvoiceBundle] WhatsApp:', whatsAppError);
    }
  }

  if (!emailSent && !whatsAppSent) {
    const primary = emailError || whatsAppError;
    if (primary) throw primary;
    throw new Error('Failed to send invoice.');
  }

  return {
    emailSent,
    emailError,
    whatsAppSent,
    whatsAppPhone,
    whatsAppError,
  };
}

export function buildProformaSendSuccessMessage(
  result: ProformaSendBundleResult,
  language: ProformaSendLanguage,
): string {
  const langLabel = proformaSendLanguageLabel(language);
  if (result.emailSent && result.whatsAppSent) {
    return `Invoice sent in ${langLabel} by email and WhatsApp (${result.whatsAppPhone}).`;
  }
  if (result.emailSent) {
    return `Invoice sent in ${langLabel} by email.`;
  }
  return `Invoice sent in ${langLabel} by WhatsApp (${result.whatsAppPhone}).`;
}

export function collectProformaSendPartialErrors(result: ProformaSendBundleResult): string[] {
  const errors: string[] = [];
  if (result.emailError) {
    const code = (result.emailError as Error & { code?: string }).code;
    const isMailbox =
      code === 'MAILBOX_NOT_CONNECTED' || result.emailError.message === 'MAILBOX_NOT_CONNECTED';
    if (!isMailbox) {
      errors.push(result.emailError.message || 'Invoice email was not sent.');
    }
  }
  if (result.whatsAppError) {
    errors.push(result.whatsAppError.message || 'Invoice WhatsApp was not sent.');
  }
  return errors;
}
