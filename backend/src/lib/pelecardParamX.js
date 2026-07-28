/**
 * Pelecard ParamX is free text capped at ~19 characters (AdditionalDetailsParamX).
 * Our public secure_token is longer, so we must send a short ParamX and map it back.
 */

const PELECARD_PARAM_X_MAX = 19;

function clipParamX(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  return value.slice(0, PELECARD_PARAM_X_MAX);
}

function generatePelecardParamX() {
  // e.g. p lkz1abc xyz12ab — always ≤ 19 chars
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return clipParamX(`p${stamp}${rand}`);
}

function readStoredParamX(payment) {
  const raw = payment?.pelecard_raw_response;
  if (!raw || typeof raw !== 'object') return null;
  return clipParamX(raw.paramX || raw.initParamX || null);
}

/**
 * Prefer a short stored ParamX; never send a long secure_token (Pelecard truncates ~19).
 */
function resolvePelecardParamX(payment, secureToken) {
  const stored = readStoredParamX(payment);
  if (stored) return stored;

  const token = String(secureToken || payment?.secure_token || '').trim();
  if (token && token.length <= PELECARD_PARAM_X_MAX) return token;

  // Long public tokens must get a dedicated short ParamX (stored on session create).
  return generatePelecardParamX();
}

function withParamXInRaw(payment, paramX) {
  const previous =
    payment?.pelecard_raw_response && typeof payment.pelecard_raw_response === 'object'
      ? payment.pelecard_raw_response
      : {};
  return {
    ...previous,
    paramX,
    initParamX: paramX,
  };
}

module.exports = {
  PELECARD_PARAM_X_MAX,
  clipParamX,
  generatePelecardParamX,
  readStoredParamX,
  resolvePelecardParamX,
  withParamXInRaw,
};
