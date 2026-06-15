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

function normalizePhoneForWhatsApp(phone) {
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

module.exports = {
  pickWhatsAppPhoneFromContactFields,
  toWhatsAppApiLanguageCode,
  normalizePhoneForWhatsApp,
};
