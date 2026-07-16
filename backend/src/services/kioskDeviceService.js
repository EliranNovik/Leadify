const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');

const DEFAULT_LOCATION_ID = 1;
const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const DEVICE_TOKEN_BYTES = 32;
const BCRYPT_ROUNDS = 10;

function normalizeLocationId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LOCATION_ID;
  return Math.trunc(n);
}

function generatePairingCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateDeviceToken() {
  return crypto.randomBytes(DEVICE_TOKEN_BYTES).toString('base64url');
}

function slugifyName(name, locationId) {
  const base = String(name || 'kiosk')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base || 'kiosk'}-${locationId}-${suffix}`;
}

async function hashToken(rawToken) {
  return bcrypt.hash(rawToken, BCRYPT_ROUNDS);
}

async function verifyTokenHash(rawToken, tokenHash) {
  if (!rawToken || !tokenHash) return false;
  return bcrypt.compare(rawToken, tokenHash);
}

async function createPairingCode(locationIdInput = DEFAULT_LOCATION_ID) {
  const locationId = normalizeLocationId(locationIdInput);
  const code = generatePairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS).toISOString();

  const { data, error } = await supabase
    .from('kiosk_pairing_codes')
    .insert({
      code,
      location_id: locationId,
      expires_at: expiresAt,
    })
    .select('id, code, location_id, expires_at')
    .single();

  if (error) throw error;
  return data;
}

async function pairDevice({ code, name, locationId, pairedByUserId, slug }) {
  const location_id = normalizeLocationId(locationId);
  const pairingCode = String(code || '').trim();
  const deviceName = String(name || '').trim();

  if (!pairingCode || !deviceName) {
    const err = new Error('Pairing code and device name are required');
    err.statusCode = 400;
    throw err;
  }

  const { data: codeRow, error: codeError } = await supabase
    .from('kiosk_pairing_codes')
    .select('id, code, location_id, expires_at, consumed_at')
    .eq('code', pairingCode)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (codeError) throw codeError;
  if (!codeRow) {
    const err = new Error('Invalid or expired pairing code');
    err.statusCode = 400;
    throw err;
  }

  const rawToken = generateDeviceToken();
  const token_hash = await hashToken(rawToken);
  const deviceSlug = slug ? String(slug).trim() : slugifyName(deviceName, location_id);

  const { data: device, error: deviceError } = await supabase
    .from('kiosk_devices')
    .insert({
      slug: deviceSlug,
      name: deviceName,
      location_id,
      token_hash,
      status: 'active',
      paired_by: pairedByUserId || null,
      last_seen_at: new Date().toISOString(),
    })
    .select('id, slug, name, location_id, status, paired_at, last_seen_at')
    .single();

  if (deviceError) throw deviceError;

  await supabase
    .from('kiosk_pairing_codes')
    .update({
      consumed_at: new Date().toISOString(),
      device_id: device.id,
      pending_device_token: rawToken,
    })
    .eq('id', codeRow.id);

  return {
    device,
    deviceToken: rawToken,
  };
}

async function claimPairingDeviceToken(codeInput) {
  const code = String(codeInput || '').trim();
  if (!code) {
    const err = new Error('Pairing code is required');
    err.statusCode = 400;
    throw err;
  }

  const { data, error } = await supabase
    .from('kiosk_pairing_codes')
    .select('id, code, expires_at, consumed_at, pending_device_token, token_claimed_at, device_id')
    .eq('code', code)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    return { status: 'pending' };
  }

  if (new Date(data.expires_at).getTime() < Date.now()) {
    return { status: 'expired' };
  }

  if (!data.consumed_at || !data.pending_device_token) {
    return { status: 'pending' };
  }

  if (data.token_claimed_at) {
    return { status: 'claimed' };
  }

  const { error: claimError } = await supabase
    .from('kiosk_pairing_codes')
    .update({
      token_claimed_at: new Date().toISOString(),
      pending_device_token: null,
    })
    .eq('id', data.id);

  if (claimError) throw claimError;

  return {
    status: 'paired',
    deviceToken: data.pending_device_token,
    deviceId: data.device_id,
  };
}

async function verifyDeviceToken(rawToken) {
  if (!rawToken) return null;

  const { data: devices, error } = await supabase
    .from('kiosk_devices')
    .select('id, slug, name, location_id, token_hash, status, last_seen_at, paired_at')
    .eq('status', 'active');

  if (error) throw error;
  if (!devices?.length) return null;

  for (const device of devices) {
    const match = await verifyTokenHash(rawToken, device.token_hash);
    if (match) {
      const { token_hash: _omit, ...safe } = device;
      return safe;
    }
  }
  return null;
}

async function listDevices(locationIdInput) {
  let query = supabase
    .from('kiosk_devices')
    .select('id, slug, name, location_id, status, last_seen_at, paired_at, created_at')
    .order('name', { ascending: true });

  if (locationIdInput != null) {
    query = query.eq('location_id', normalizeLocationId(locationIdInput));
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function updateDevice(deviceId, { name, status }) {
  const patch = { updated_at: new Date().toISOString() };
  if (name != null) patch.name = String(name).trim();
  if (status != null) patch.status = status;

  const { data, error } = await supabase
    .from('kiosk_devices')
    .update(patch)
    .eq('id', deviceId)
    .select('id, slug, name, location_id, status, last_seen_at, paired_at')
    .single();

  if (error) throw error;
  return data;
}

async function heartbeat(deviceId) {
  const { data, error } = await supabase
    .from('kiosk_devices')
    .update({ last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', deviceId)
    .eq('status', 'active')
    .select('id, slug, name, location_id, status, last_seen_at')
    .single();

  if (error) throw error;
  return data;
}

async function getDeviceById(deviceId) {
  const { data, error } = await supabase
    .from('kiosk_devices')
    .select('id, slug, name, location_id, status, last_seen_at, paired_at')
    .eq('id', deviceId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

module.exports = {
  DEFAULT_LOCATION_ID,
  createPairingCode,
  pairDevice,
  claimPairingDeviceToken,
  verifyDeviceToken,
  listDevices,
  updateDevice,
  heartbeat,
  getDeviceById,
};
