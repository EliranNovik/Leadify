/** Outgoing message bubble — teal gradient aligned with WhatsApp avatar branding. */
export const WHATSAPP_OUTGOING_MESSAGE_GRADIENT =
  'linear-gradient(135deg, #40B5C1 0%, #1E7D84 100%)';

export const WHATSAPP_OUTGOING_BUBBLE_CLASS = 'text-white border border-transparent';

export const WHATSAPP_OUTGOING_TEXT_COLOR = '#ffffff';

export const WHATSAPP_OUTGOING_VOICE_PLAYER_CLASS = 'bg-white/20';

/** Links inside teal outgoing bubbles — light blue for contrast. */
export const WHATSAPP_OUTGOING_LINK_COLOR = '#b3e5fc';

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
