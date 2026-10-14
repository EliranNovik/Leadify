/**
 * What a client-facing URL is called when it appears inside a WhatsApp message bubble.
 *
 * Raw links are replaced with a label because the real ones carry a UUID token and are far too long
 * to sit in a bubble without wrapping into a wall of characters.
 *
 * The rule this replaces labelled *every* URL over fifty characters "Meeting Link", so a payment
 * page, a contract and a proforma all went out to clients described as a meeting. Length alone
 * cannot tell those apart; the route can, because each kind of link has its own public route.
 *
 * Labels match the wording already used elsewhere: `labelForContractLink` in leadContractLink and
 * the WhatsApp template parameter list in ParameterMappingEditor. Those constants are not imported
 * from here on purpose — leadContractLink reaches for the Supabase client and `window` at import
 * time, which would make this module unsafe to pull into a unit test.
 */

export const WHATSAPP_MEETING_LINK_LABEL = 'Meeting Link';
export const WHATSAPP_CONTRACT_LINK_LABEL = 'Contract Link';
export const WHATSAPP_PAYMENT_LINK_LABEL = 'Payment Link';
export const WHATSAPP_PROFORMA_LINK_LABEL = 'Proforma Link';

/**
 * For a long URL of no recognised kind. Still better than the address itself, which would wrap
 * across several lines, and honest in a way that naming it a meeting was not.
 */
export const WHATSAPP_GENERIC_LINK_LABEL = 'Link';

/** Beyond this, a URL is wide enough to distort the bubble, so it gets labelled whatever it is. */
const LONG_URL_LENGTH = 50;

/*
 * Ordered most specific first, since one URL can satisfy several patterns — the booking page lives
 * under a token like every other link, and the loose `meeting` catch-all at the end would otherwise
 * claim anything with the word anywhere in it.
 */
const LINK_RULES: { label: string; pattern: RegExp }[] = [
  // Contracts: /public-contract plus the firm, HR, recruitment and legacy variants of the route.
  { label: WHATSAPP_CONTRACT_LINK_LABEL, pattern: /\/public-(?:legacy-|firm-|hr-|recruitment-)?contract\//i },
  { label: WHATSAPP_CONTRACT_LINK_LABEL, pattern: /\/contract\/[^/\s]/i },

  // Proformas, before payment: a proforma is shared read-only and is not a page that takes money.
  { label: WHATSAPP_PROFORMA_LINK_LABEL, pattern: /\/public-proforma(?:-legacy)?\//i },
  { label: WHATSAPP_PROFORMA_LINK_LABEL, pattern: /\/proforma(?:-legacy)?\//i },

  { label: WHATSAPP_PAYMENT_LINK_LABEL, pattern: /\/payment\/[^/\s]/i },

  // Online meetings, then our own booking page.
  {
    label: WHATSAPP_MEETING_LINK_LABEL,
    pattern: /teams\.microsoft\.com|meetup-join|zoom\.us|meet\.google\.com|whereby\.com/i,
  },
  { label: WHATSAPP_MEETING_LINK_LABEL, pattern: /\/book\/[^/\s]/i },
  { label: WHATSAPP_MEETING_LINK_LABEL, pattern: /meeting/i },
];

/**
 * The label to show instead of `href`, or null to leave the URL visible.
 *
 * `displayText` is what the message actually contained, which is what decides whether a link of no
 * known kind is long enough to need hiding — the href can differ, since a bare address has a scheme
 * added to it before it becomes a link.
 */
export function whatsAppMessageLinkLabel(
  href: string,
  displayText?: string,
): string | null {
  const url = String(href || '');
  // Email addresses are short and worth reading, and are the one link a client may want to copy.
  if (!/^https?:\/\//i.test(url)) return null;

  for (const rule of LINK_RULES) {
    if (rule.pattern.test(url)) return rule.label;
  }

  const shown = displayText == null ? url : String(displayText);
  return shown.length > LONG_URL_LENGTH ? WHATSAPP_GENERIC_LINK_LABEL : null;
}
