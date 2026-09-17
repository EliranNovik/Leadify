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

/** Message list pane — one step darker than the surrounding chrome. */
export const WHATSAPP_CHAT_THREAD_BG_CLASS = 'bg-gray-100';

/**
 * Incoming and outgoing bubbles share the same max width.
 * `w-fit` keeps short messages compact so the time sits next to the text
 * instead of across an empty row.
 */
export const WHATSAPP_CHAT_BUBBLE_WIDTH_CLASS =
  'w-fit max-w-[min(85%,28rem)] box-border overflow-hidden';

export function whatsAppChatBubbleAlignClass(direction: 'in' | 'out'): string {
  return direction === 'out' ? 'self-end ml-auto' : 'self-start';
}

/** Time + ticks — floats to the last line, next to the text. */
export const WHATSAPP_CHAT_BUBBLE_META_CLASS =
  'float-right ml-2 mt-0.5 inline-flex items-center gap-0.5 text-[11px] leading-none whitespace-nowrap opacity-70';

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

/** Composer: tools + textarea + send sit inside one input field. */
export const WHATSAPP_COMPOSER_FIELD_CLASS =
  'flex items-end w-full min-w-0 rounded-2xl border border-white/40 bg-white/90 shadow-[0_2px_8px_rgba(0,0,0,0.08)] backdrop-blur-md px-1 py-1 gap-1';

export const WHATSAPP_COMPOSER_TEXTAREA_CLASS =
  'textarea flex-1 min-w-0 resize-none border-0 bg-transparent shadow-none focus:outline-none focus:border-0 focus:shadow-none px-1 py-2 min-h-0';

export const WHATSAPP_COMPOSER_TOOLS_BTN_CLASS =
  'btn btn-circle border border-gray-200 bg-white text-gray-700 hover:bg-white hover:border-gray-300 shadow-sm flex-shrink-0 disabled:opacity-50';

export const WHATSAPP_COMPOSER_SEND_BTN_CLASS =
  'btn btn-circle text-white shadow-md hover:shadow-lg transition-shadow disabled:opacity-50 flex-shrink-0';
