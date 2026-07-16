/**
 * Reuse an active Pelecard checkout URL instead of calling init again.
 * Prevents invalidating an in-progress iframe (Pelecard status 301) when the
 * payment page is refreshed or opened in a second tab.
 */

const DEFAULT_REUSE_MINUTES = 20;

function sessionCreatedAt(payment) {
  const raw = payment?.pelecard_raw_response;
  if (raw && typeof raw === 'object' && raw.sessionCreatedAt) {
    return raw.sessionCreatedAt;
  }
  return payment?.updated_at || null;
}

function sessionAgeMs(payment) {
  const createdAt = sessionCreatedAt(payment);
  if (!createdAt) return Number.POSITIVE_INFINITY;
  const ts = new Date(createdAt).getTime();
  if (!Number.isFinite(ts)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Date.now() - ts);
}

function canReusePelecardSession(payment, profile, options = {}) {
  const forceNew = Boolean(options.forceNew);
  if (forceNew) return false;
  if (!payment || payment.status !== 'processing') return false;

  const paymentUrl = (payment.pelecard_session_url || '').trim();
  if (!paymentUrl) return false;

  const sessionProfile = (payment.pelecard_profile || 'production').trim() || 'production';
  const requestedProfile = (profile || 'production').trim() || 'production';
  if (sessionProfile !== requestedProfile) return false;

  const reuseMinutes = Number(
    process.env.PELECARD_SESSION_REUSE_MINUTES || String(DEFAULT_REUSE_MINUTES),
  );
  if (!Number.isFinite(reuseMinutes) || reuseMinutes <= 0) return false;

  const maxAgeMs = reuseMinutes * 60 * 1000;
  if (sessionAgeMs(payment) > maxAgeMs) return false;

  const statusCode = String(payment.pelecard_status_code || '').trim();
  if (statusCode === '301' || statusCode === '302') return false;

  const raw = payment.pelecard_raw_response;
  if (raw && typeof raw === 'object' && raw.sessionExpired === true) return false;

  // Do not reuse a hosted page built with a different CustomerIdField mode
  // (e.g. old "must" sessions after switching to "hide").
  const { getCustomerIdFieldMode } = require('../services/pelecardService');
  const currentIdField = getCustomerIdFieldMode();
  const storedIdField =
    raw && typeof raw === 'object' && raw.customerIdField != null
      ? String(raw.customerIdField).trim().toLowerCase()
      : null;
  if (storedIdField) {
    if (storedIdField !== currentIdField) return false;
  } else if (currentIdField !== 'must') {
    // Legacy sessions (before we persisted customerIdField) assumed must.
    return false;
  }

  return true;
}

function buildReusedSessionResponse(payment, paymentId, profile) {
  const raw = payment.pelecard_raw_response;
  const init = raw && typeof raw === 'object' ? raw.init : null;
  const cssUrl =
    init && typeof init === 'object'
      ? init.CssURL || init.cssUrl || null
      : null;
  const { getCustomerIdFieldMode } = require('../services/pelecardService');

  return {
    success: true,
    paymentUrl: payment.pelecard_session_url,
    paymentId,
    pelecardProfile: payment.pelecard_profile || profile,
    cssUrl,
    reusedSession: true,
    customerIdField: getCustomerIdFieldMode(),
  };
}

module.exports = {
  canReusePelecardSession,
  buildReusedSessionResponse,
  sessionAgeMs,
  sessionCreatedAt,
};
