import { sendProformaInvoiceEmail, type ProformaSendEmailInput } from './proformaSendEmail';
import { sendProformaInvoiceWhatsApp } from './proformaSendWhatsApp';

export type ProformaSendBundleResult = {
  whatsAppSent: boolean;
  whatsAppPhone: string;
  whatsAppError: Error | null;
};

/** Send invoice email, then WhatsApp (email failure blocks both). */
export async function sendProformaInvoiceBundle(
  input: ProformaSendEmailInput,
): Promise<ProformaSendBundleResult> {
  await sendProformaInvoiceEmail(input);

  try {
    const wa = await sendProformaInvoiceWhatsApp(input);
    return { whatsAppSent: true, whatsAppPhone: wa.phoneNumber, whatsAppError: null };
  } catch (err) {
    console.warn('[sendProformaInvoiceBundle] WhatsApp:', err);
    return {
      whatsAppSent: false,
      whatsAppPhone: '',
      whatsAppError: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
