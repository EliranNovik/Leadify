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

module.exports = {
  pickWhatsAppPhoneFromContactFields,
  toWhatsAppApiLanguageCode,
  digitsOnlyPhone,
  canonicalWhatsAppPhone,
  normalizePhoneForWhatsApp,
};
