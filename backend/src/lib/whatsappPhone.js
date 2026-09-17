const INVALID_PHONE_MARKERS = new Set(['', '---', 'n/a', 'na']);

function pickWhatsAppPhoneFromContactFields(phone, mobile) {
  const p = phone?.trim();
  const m = mobile?.trim();
  const phoneOk = p && !INVALID_PHONE_MARKERS.has(p.toLowerCase());
  const mobileOk = m && !INVALID_PHONE_MARKERS.has(m.toLowerCase());
  return (phoneOk ? p : mobileOk ? m : '') || '';
}

function toWhatsAppApiLanguageCode(lang) {
  const code = lang != null ? String(lang).trim() : '';
  return code || 'en';
}

function digitsOnlyPhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function canonicalWhatsAppPhone(phone) {
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

function normalizePhoneForWhatsApp(phone) {
  return canonicalWhatsAppPhone(phone);
}

function israeliFormattedPhoneVariants(canonical) {
  if (!canonical.startsWith('972') || canonical.length < 11) return [];
  const national = canonical.slice(3);
  const local = `0${national}`;
  const variants = [];
  const push = (...vals) => {
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

/** Last 7 digits survive hyphens in values like `+97254-9760006` (last-8 would not). */
function whatsAppPhoneLookupNeedle(phone) {
  const canonical = canonicalWhatsAppPhone(phone);
  if (canonical.length >= 7) return canonical.slice(-7);
  const digits = digitsOnlyPhone(phone);
  return digits.length >= 7 ? digits.slice(-7) : digits;
}

function whatsAppPhoneVariants(phone) {
  const canonical = canonicalWhatsAppPhone(phone);
  if (!canonical) return [];
  const local = canonical.startsWith('972') ? `0${canonical.slice(3)}` : '';
  const extraZero = canonical.startsWith('972') ? `9720${canonical.slice(3)}` : '';
  const raw = String(phone || '').trim();
  return [...new Set(
    [
      canonical,
      `+${canonical}`,
      local,
      extraZero,
      raw,
      digitsOnlyPhone(raw),
      ...israeliFormattedPhoneVariants(canonical),
    ].filter(Boolean),
  )];
}

function collectWhatsAppPhoneVariants(phones) {
  return [...new Set((phones || []).flatMap((phone) => whatsAppPhoneVariants(phone)))];
}

module.exports = {
  pickWhatsAppPhoneFromContactFields,
  toWhatsAppApiLanguageCode,
  digitsOnlyPhone,
  canonicalWhatsAppPhone,
  normalizePhoneForWhatsApp,
  whatsAppPhoneLookupNeedle,
  whatsAppPhoneVariants,
  collectWhatsAppPhoneVariants,
};
