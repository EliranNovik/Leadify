/** Outgoing message bubble — WhatsApp-style light green with black text. */
export const WHATSAPP_OUTGOING_MESSAGE_GRADIENT = '#DCF8C6';

export const WHATSAPP_OUTGOING_BUBBLE_CLASS = 'text-black border border-transparent';

export const WHATSAPP_OUTGOING_TEXT_COLOR = '#000000';

export const WHATSAPP_OUTGOING_VOICE_PLAYER_CLASS = 'bg-black/10';

/** Links inside light-green outgoing bubbles. */
export const WHATSAPP_OUTGOING_LINK_COLOR = '#1d4ed8';

/** Double-check (read) receipt on outgoing bubbles — dark green. */
export const WHATSAPP_READ_RECEIPT_COLOR = '#166534';

/** Sent / delivered ticks — muted grey so they stay visible on light green. */
export const WHATSAPP_SENT_RECEIPT_COLOR = '#667781';

/** Edit textarea inside an outgoing bubble. */
export const WHATSAPP_OUTGOING_EDIT_TEXTAREA_CLASS =
  'text-black placeholder-black/50';

/** Chat-area top header — frosted glass over the message thread. */
export const WHATSAPP_CHAT_HEADER_GLASS_CLASS =
  'bg-white/50 backdrop-blur-xl supports-[backdrop-filter]:bg-white/35 border-b border-white/40 shadow-[0_8px_24px_rgba(15,23,42,0.06)]';

export type WhatsAppMessageLinkStyle = 'default' | 'neon' | 'outgoing';

export function whatsAppMessageLinkColor(style: WhatsAppMessageLinkStyle): string {
  if (style === 'neon') return '#39ff14';
  if (style === 'outgoing') return WHATSAPP_OUTGOING_LINK_COLOR;
  return '#2563eb';
}

export function whatsAppMessageLinkFontWeight(style: WhatsAppMessageLinkStyle): number {
  return style === 'neon' ? 600 : 400;
}

/** WhatsApp *bold* markers — softer than font-black (900). */
export const WHATSAPP_MESSAGE_BOLD_FONT_WEIGHT = 600;
