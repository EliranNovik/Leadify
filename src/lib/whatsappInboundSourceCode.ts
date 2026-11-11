/** Landing-page WhatsApp text puts the misc_leadsource code in parentheses, e.g. (22018). */
export function extractParenthesizedSourceCode(text: string | null | undefined): number | null {
  if (text == null) return null;
  const matches = String(text).match(/\((\d{3,12})\)/g);
  if (!matches || matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const code = Number(last.slice(1, -1));
  return Number.isSafeInteger(code) ? code : null;
}

export function leadArrivedViaWhatsApp(utmParams: unknown): boolean {
  let value = utmParams;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return false;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return false;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return (value as { arrived_via_whatsapp?: unknown }).arrived_via_whatsapp === true;
}
