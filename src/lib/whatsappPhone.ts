const INVALID_PHONE_MARKERS = new Set(['', '---', 'n/a', 'na']);

/** Same order as MeetingTab: prefer `phone`, then `mobile`. */
export function pickWhatsAppPhoneFromContactFields(
  phone: string | null | undefined,
  mobile: string | null | undefined,
): string {
  const p = phone?.trim();
  const m = mobile?.trim();
  const phoneOk = p && !INVALID_PHONE_MARKERS.has(p.toLowerCase());
  const mobileOk = m && !INVALID_PHONE_MARKERS.has(m.toLowerCase());
  return (phoneOk ? p : mobileOk ? m : '') || '';
}

/** Map DB language codes to Meta template language codes. */
export function toWhatsAppApiLanguageCode(lang: string | null | undefined): string {
  const code = (lang || 'en').trim();
  if (!code) return 'en_US';
  const lower = code.toLowerCase();
  if (lower === 'en') return 'en_US';
  if (lower.startsWith('en_')) return code;
  if (lower === 'he') return 'he';
  if (lower.startsWith('he_')) return code;
  return code;
}

/** Digits-only phone for WhatsApp Cloud API `to` field (Israel defaults to 972). */
export function normalizePhoneForWhatsApp(phone: string | null | undefined): string {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  if (digits.startsWith('0') && !digits.startsWith('00')) {
    digits = `972${digits.slice(1)}`;
  } else if (!digits.startsWith('972') && digits.length >= 9 && digits.length <= 10) {
    digits = `972${digits}`;
  }

  return digits;
}
