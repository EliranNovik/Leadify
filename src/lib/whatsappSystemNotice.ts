/** Sender stored on rows Meta delivered as a system notice, not a person chatting. */
export const WHATSAPP_SYSTEM_NOTICE_SENDER = 'WhatsApp notice';

export function isWhatsAppSystemNotice(message: { sender_name?: string | null } | null | undefined): boolean {
  return String(message?.sender_name || '').trim() === WHATSAPP_SYSTEM_NOTICE_SENDER;
}
