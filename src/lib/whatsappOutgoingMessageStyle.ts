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
 * Column layout keeps the timestamp on its own row at the bottom-right.
 */
export const WHATSAPP_CHAT_BUBBLE_WIDTH_CLASS =
  'flex flex-col w-fit max-w-[min(85%,28rem)] box-border overflow-hidden';

export function whatsAppChatBubbleAlignClass(direction: 'in' | 'out'): string {
  return direction === 'out' ? 'self-end ml-auto' : 'self-start';
}

/** Time + ticks — always physical bottom-right, even when the message is RTL. */
export const WHATSAPP_CHAT_BUBBLE_META_CLASS =
  'mt-1 ml-auto flex items-center justify-end gap-0.5 text-[11px] leading-none whitespace-nowrap opacity-70 shrink-0 [direction:ltr]';

/** Message body — block so Hebrew `dir`/`text-start` actually align the text. */
export const WHATSAPP_BUBBLE_TEXT_CLASS =
  'block w-full max-w-full min-w-0 break-words whitespace-pre-wrap text-start [unicode-bidi:plaintext]';

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
  'textarea flex-1 min-w-0 resize-none overflow-hidden border-0 bg-transparent shadow-none focus:outline-none focus:border-0 focus:shadow-none px-1 py-2 min-h-0 h-auto leading-normal text-start [unicode-bidi:plaintext]';

export const WHATSAPP_COMPOSER_MIN_HEIGHT_PX = 40;
export const WHATSAPP_COMPOSER_MAX_HEIGHT_PX = 280;

const HEBREW_CHAR = /[\u0590-\u05FF]/;

export function whatsAppTextContainsHebrew(text: string): boolean {
  return HEBREW_CHAR.test(text || '');
}

export function whatsAppComposerDir(text: string): 'rtl' | 'ltr' | 'auto' {
  if (!text?.trim()) return 'auto';
  return whatsAppTextContainsHebrew(text) ? 'rtl' : 'ltr';
}

export function whatsAppComposerMaxHeightPx(selectedTemplate?: { params?: string } | null): number {
  if (selectedTemplate && selectedTemplate.params === '0') return 400;
  return WHATSAPP_COMPOSER_MAX_HEIGHT_PX;
}

export function growWhatsAppComposerTextarea(
  el: HTMLTextAreaElement | null,
  options?: { minPx?: number; maxPx?: number },
): void {
  if (!el) return;
  const minPx = options?.minPx ?? WHATSAPP_COMPOSER_MIN_HEIGHT_PX;
  const maxPx = options?.maxPx ?? WHATSAPP_COMPOSER_MAX_HEIGHT_PX;
  el.style.height = 'auto';
  const contentHeight = el.scrollHeight;
  const next = Math.min(Math.max(contentHeight, minPx), maxPx);
  el.style.height = `${next}px`;
  el.style.overflowY = contentHeight > maxPx ? 'auto' : 'hidden';
}

export const WHATSAPP_COMPOSER_TOOLS_BTN_CLASS =
  'btn btn-circle border border-gray-200 bg-white text-gray-700 hover:bg-white hover:border-gray-300 shadow-sm flex-shrink-0 disabled:opacity-50';

export const WHATSAPP_COMPOSER_SEND_BTN_CLASS =
  'btn btn-circle text-white shadow-md hover:shadow-lg transition-shadow disabled:opacity-50 flex-shrink-0';
