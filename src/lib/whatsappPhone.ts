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

/** Pass through Meta template language code as stored in whatsapp_templates_v2. */
export function toWhatsAppApiLanguageCode(lang: string | null | undefined): string {
  const code = lang != null ? String(lang).trim() : '';
  return code || 'en';
}

export function digitsOnlyPhone(phone: string | null | undefined): string {
  return String(phone || '').replace(/\D/g, '');
}

/**
 * Canonical WhatsApp digits (Israel defaults to 972).
 * Collapses the common extra trunk zero: 9720507825939 → 972507825939.
 */
export function canonicalWhatsAppPhone(phone: string | null | undefined): string {
  let digits = digitsOnlyPhone(phone);
  if (!digits) return '';

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  if (digits.startsWith('9720') && digits.length >= 13) {
    digits = `972${digits.slice(4)}`;
  } else if (digits.startsWith('0')) {
    digits = `972${digits.slice(1)}`;
  } else if (!digits.startsWith('972') && digits.length >= 9 && digits.length <= 10) {
    digits = `972${digits}`;
  }

  return digits;
}

/**
 * Display spellings CRM often stores with dashes/spaces, e.g. `+97254-9760006`
 * or `054-9760006`. Canonical-digit `.in()` queries miss these.
 */
function israeliFormattedPhoneVariants(canonical: string): string[] {
  if (!canonical.startsWith('972') || canonical.length < 11) return [];
  const national = canonical.slice(3);
  const local = `0${national}`;
  const variants: string[] = [];
  const push = (...vals: string[]) => {
    for (const value of vals) {
      if (value) variants.push(value);
    }
  };

  if (local.length >= 4) {
    push(`${local.slice(0, 3)}-${local.slice(3)}`);
  }
  if (local.length === 10) {
    push(`${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`);
  }
  if (national.length >= 3) {
    const ndc = national.slice(0, 2);
    const rest = national.slice(2);
    push(
      `+972${ndc}-${rest}`,
      `972${ndc}-${rest}`,
      `+972-${ndc}-${rest}`,
      `972-${ndc}-${rest}`,
      `+972 ${ndc}-${rest}`,
      `+972 ${ndc} ${rest}`,
    );
  }

  return variants;
}

/** Last 7 digits: survives hyphens in values like `+97254-9760006` (last-8 would not). */
export function whatsAppPhoneLookupNeedle(phone: string | null | undefined): string {
  const canonical = canonicalWhatsAppPhone(phone);
  if (canonical.length >= 7) return canonical.slice(-7);
  const digits = digitsOnlyPhone(phone);
  return digits.length >= 7 ? digits.slice(-7) : digits;
}

/** Spellings this number may have been saved as on `whatsapp_messages.phone_number`. */
export function whatsAppPhoneVariants(phone: string | null | undefined): string[] {
  const canonical = canonicalWhatsAppPhone(phone);
  if (!canonical) return [];
  const local = canonical.startsWith('972') ? `0${canonical.slice(3)}` : '';
  const extraZero = canonical.startsWith('972') ? `9720${canonical.slice(3)}` : '';
  const raw = String(phone || '').trim();
  return [
    ...new Set(
      [
        canonical,
        `+${canonical}`,
        local,
        extraZero,
        raw,
        digitsOnlyPhone(raw),
        ...israeliFormattedPhoneVariants(canonical),
      ].filter(Boolean),
    ),
  ];
}

export function collectWhatsAppPhoneVariants(phones: Array<string | null | undefined>): string[] {
  return [...new Set(phones.flatMap((phone) => whatsAppPhoneVariants(phone)))];
}

export function whatsAppPhonesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ca = canonicalWhatsAppPhone(a);
  const cb = canonicalWhatsAppPhone(b);
  if (ca && cb && ca === cb) return true;
  const da = digitsOnlyPhone(a);
  const db = digitsOnlyPhone(b);
  if (!da || !db) return false;
  if (da === db) return true;
  return (
    da.length >= 8 &&
    db.length >= 8 &&
    (da.endsWith(db.slice(-8)) || db.endsWith(da.slice(-8)))
  );
}

export function whatsAppPhoneMatchesSearch(
  phone: string | null | undefined,
  term: string,
): boolean {
  const rawTerm = String(term || '').trim();
  if (!rawTerm) return false;
  const rawPhone = String(phone || '');
  if (rawPhone.toLowerCase().includes(rawTerm.toLowerCase())) return true;
  const termDigits = digitsOnlyPhone(rawTerm);
  if (!termDigits || termDigits.length < 4) return false;
  const canonPhone = canonicalWhatsAppPhone(phone);
  const canonTerm = canonicalWhatsAppPhone(rawTerm);
  if (canonPhone && canonTerm && (canonPhone === canonTerm || canonPhone.endsWith(termDigits))) {
    return true;
  }
  const blob = `${canonPhone}${digitsOnlyPhone(phone)}`;
  return blob.includes(termDigits);
}

/** Digits-only phone for WhatsApp Cloud API `to` field (Israel defaults to 972). */
export function normalizePhoneForWhatsApp(phone: string | null | undefined): string {
  return canonicalWhatsAppPhone(phone);
}
