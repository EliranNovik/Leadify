const crypto = require('crypto');
const supabase = require('../config/supabase');

const ROTATE_MS = 15_000;
const GRACE_MS = 60_000;
const DEFAULT_LOCATION_ID = 1;

function getFrontendBaseUrl() {
  const candidates = [
    process.env.FRONTEND_BASE_URL,
    process.env.PUBLIC_FRONTEND_URL,
    process.env.FRONTEND_URL,
  ];
  for (const raw of candidates) {
    const value = String(raw || '').trim().replace(/\/$/, '');
    if (!value) continue;
    // Never encode localhost into phone QR codes.
    if (/localhost|127\.0\.0\.1/i.test(value)) continue;
    return value;
  }
  return 'https://rainmakerqueen.org';
}

function buildQrUrl(locationId, token) {
  const base = getFrontendBaseUrl();
  const params = new URLSearchParams({
    locationId: String(locationId),
    token: String(token),
  });
  return `${base}/clock-in/entry?${params.toString()}`;
}

function normalizeLocationId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

/**
 * Return current (or freshly minted) QR token for a kiosk location.
 * Rotates every 15s; each token remains valid for 60s (grace window).
 */
async function getCurrentToken(locationIdInput = DEFAULT_LOCATION_ID) {
  const locationId = normalizeLocationId(locationIdInput) ?? DEFAULT_LOCATION_ID;

  // v1: only Ramat Gan office (id 1)
  if (locationId !== DEFAULT_LOCATION_ID) {
    const err = new Error('Unsupported kiosk location');
    err.statusCode = 400;
    throw err;
  }

  const { data: location, error: locationError } = await supabase
    .from('clock_in_locations')
    .select('id, active')
    .eq('id', locationId)
    .maybeSingle();

  if (locationError) throw locationError;
  if (!location || location.active === false) {
    const err = new Error('Clock-in location is not available');
    err.statusCode = 404;
    throw err;
  }

  const now = Date.now();
  const { data: latestRows, error: latestError } = await supabase
    .from('clock_in_kiosk_tokens')
    .select('token, location_id, created_at, expires_at, revoked_at')
    .eq('location_id', locationId)
    .is('revoked_at', null)
    .gt('expires_at', new Date(now).toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  if (latestError) throw latestError;

  const latest = latestRows?.[0] ?? null;
  if (latest) {
    const createdAtMs = new Date(latest.created_at).getTime();
    const ageMs = now - createdAtMs;
    if (Number.isFinite(createdAtMs) && ageMs < ROTATE_MS) {
      const rotateInMs = Math.max(0, ROTATE_MS - ageMs);
      return {
        token: latest.token,
        locationId,
        expiresAt: latest.expires_at,
        rotateInMs,
        qrUrl: buildQrUrl(locationId, latest.token),
      };
    }
  }

  const token = crypto.randomUUID();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + GRACE_MS).toISOString();

  const { data: inserted, error: insertError } = await supabase
    .from('clock_in_kiosk_tokens')
    .insert({
      token,
      location_id: locationId,
      created_at: createdAt,
      expires_at: expiresAt,
    })
    .select('token, location_id, expires_at')
    .single();

  if (insertError) throw insertError;

  return {
    token: inserted.token,
    locationId,
    expiresAt: inserted.expires_at,
    rotateInMs: ROTATE_MS,
    qrUrl: buildQrUrl(locationId, inserted.token),
  };
}

/**
 * Validate a scanned QR token (accepts current + grace window of previous codes).
 */
async function validateToken(tokenInput, locationIdInput) {
  const token = String(tokenInput || '').trim();
  const locationId = normalizeLocationId(locationIdInput);

  if (!token) {
    const err = new Error('Missing token');
    err.statusCode = 400;
    throw err;
  }
  if (locationId == null) {
    const err = new Error('Missing or invalid locationId');
    err.statusCode = 400;
    throw err;
  }
  if (locationId !== DEFAULT_LOCATION_ID) {
    const err = new Error('Unsupported kiosk location');
    err.statusCode = 400;
    throw err;
  }

  const { data: row, error } = await supabase
    .from('clock_in_kiosk_tokens')
    .select('token, location_id, expires_at, revoked_at')
    .eq('token', token)
    .maybeSingle();

  if (error) throw error;

  if (!row) {
    const err = new Error('QR code is invalid');
    err.statusCode = 410;
    throw err;
  }
  if (Number(row.location_id) !== locationId) {
    const err = new Error('QR location mismatch');
    err.statusCode = 400;
    throw err;
  }
  if (row.revoked_at) {
    const err = new Error('QR code has been revoked');
    err.statusCode = 410;
    throw err;
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    const err = new Error('QR code expired — scan the screen again');
    err.statusCode = 410;
    throw err;
  }

  return {
    valid: true,
    locationId: Number(row.location_id),
  };
}

module.exports = {
  ROTATE_MS,
  GRACE_MS,
  DEFAULT_LOCATION_ID,
  getCurrentToken,
  validateToken,
  buildQrUrl,
};
