const supabase = require('../config/supabase');
const { getPublicAppOrigin } = require('./proformaPublicLink');

function parseLegacyLeadNumericId(leadClientId) {
  if (leadClientId == null || leadClientId === '') return null;
  const raw = String(leadClientId).replace(/^legacy_/, '');
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function buildPaymentLinkPublicUrl(secureToken) {
  const token = String(secureToken || '').trim();
  if (!token) return '';
  return `${getPublicAppOrigin()}/payment/${encodeURIComponent(token)}`;
}

function isLinkUsable(row) {
  const token = row?.secure_token?.trim();
  if (!token) return false;
  const status = (row.status || '').toLowerCase();
  if (status === 'expired' || status === 'cancelled') return false;
  if (row.expires_at && status === 'pending') {
    const exp = new Date(row.expires_at).getTime();
    if (!Number.isNaN(exp) && exp < Date.now()) return false;
  }
  return true;
}

function pickBestPaymentLinkUrl(rows) {
  if (!rows?.length) return null;
  const usable = rows.filter(isLinkUsable);
  const pending = usable.find((r) => (r.status || '').toLowerCase() === 'pending');
  const chosen = pending || usable[0];
  if (!chosen?.secure_token) return null;
  return buildPaymentLinkPublicUrl(chosen.secure_token);
}

async function resolveProformaPaymentLinkUrl({ paymentPlanId, leadClientId }) {
  if (paymentPlanId != null && paymentPlanId !== '') {
    const { data, error } = await supabase
      .from('payment_links')
      .select('secure_token, status, expires_at, created_at')
      .eq('payment_plan_id', paymentPlanId)
      .order('created_at', { ascending: false });

    if (!error) {
      const url = pickBestPaymentLinkUrl(data);
      if (url) return url;
    }
  }

  if (leadClientId == null || leadClientId === '') return null;

  const legacyId = parseLegacyLeadNumericId(leadClientId);
  let query = supabase
    .from('payment_links')
    .select('secure_token, status, expires_at, created_at, payment_plan_id')
    .order('created_at', { ascending: false })
    .limit(30);

  if (legacyId != null) {
    query = query.eq('legacy_id', legacyId);
  } else {
    query = query.eq('client_id', String(leadClientId));
  }

  if (paymentPlanId != null && paymentPlanId !== '') {
    query = query.eq('payment_plan_id', paymentPlanId);
  }

  const { data, error } = await query;
  if (error) return null;
  return pickBestPaymentLinkUrl(data);
}

module.exports = {
  resolveProformaPaymentLinkUrl,
  parseLegacyLeadNumericId,
};
