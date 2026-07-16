const kioskDeviceService = require('../services/kioskDeviceService');
const kioskDisplaySessionService = require('../services/kioskDisplaySessionService');

const pairingCreateHits = new Map();
const pairingClaimHits = new Map();
const PAIRING_WINDOW_MS = 60_000;
const PAIRING_CREATE_MAX_HITS = 12;
const PAIRING_CLAIM_MAX_HITS = 120;

function pruneHits(map, now) {
  for (const [key, bucket] of map) {
    if (now - bucket.windowStart > PAIRING_WINDOW_MS) map.delete(key);
  }
}

function allowHit(map, ip, max) {
  const now = Date.now();
  pruneHits(map, now);
  const key = ip || 'unknown';
  const bucket = map.get(key);
  if (!bucket || now - bucket.windowStart > PAIRING_WINDOW_MS) {
    map.set(key, { windowStart: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= max;
}

async function createPairingCode(req, res) {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
    if (!allowHit(pairingCreateHits, String(ip), PAIRING_CREATE_MAX_HITS)) {
      return res.status(429).json({ success: false, error: 'Too many pairing requests' });
    }

    const locationId = req.body?.locationId ?? req.query?.locationId ?? kioskDeviceService.DEFAULT_LOCATION_ID;
    const row = await kioskDeviceService.createPairingCode(locationId);
    res.json({
      success: true,
      code: row.code,
      locationId: row.location_id,
      expiresAt: row.expires_at,
    });
  } catch (error) {
    console.error('POST /api/kiosk/pairing-codes failed:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to create pairing code' });
  }
}

async function claimPairingCode(req, res) {
  try {
    const code = String(req.body?.code ?? req.params?.code ?? '').trim();
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
    const rateKey = code ? `${String(ip)}:${code}` : String(ip);
    if (!allowHit(pairingClaimHits, rateKey, PAIRING_CLAIM_MAX_HITS)) {
      return res.status(429).json({ success: false, error: 'Too many pairing requests' });
    }

    const result = await kioskDeviceService.claimPairingDeviceToken(code);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('POST /api/kiosk/pairing-codes/claim failed:', error);
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, error: error.message || 'Failed to claim pairing' });
  }
}

async function pairDevice(req, res) {
  try {
    const { code, name, locationId, slug } = req.body || {};
    const result = await kioskDeviceService.pairDevice({
      code,
      name,
      locationId,
      slug,
      pairedByUserId: req.authUser?.id || null,
    });

    res.json({
      success: true,
      device: result.device,
      deviceToken: result.deviceToken,
    });
  } catch (error) {
    console.error('POST /api/kiosk/pair failed:', error);
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, error: error.message || 'Failed to pair device' });
  }
}

async function listDevices(req, res) {
  try {
    const locationId = req.query.locationId;
    const devices = await kioskDeviceService.listDevices(locationId);
    const enriched = await Promise.all(
      devices.map(async (device) => {
        const session = await kioskDisplaySessionService.getActiveSessionForDevice(device.id);
        return {
          ...device,
          activeSession: session
            ? {
                id: session.id,
                resourceType: session.resource_type,
                status: session.status,
                expiresAt: session.expires_at,
              }
            : null,
        };
      }),
    );
    res.json({ success: true, devices: enriched });
  } catch (error) {
    console.error('GET /api/kiosk/devices failed:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to list devices' });
  }
}

async function updateDevice(req, res) {
  try {
    const { id } = req.params;
    const { name, status } = req.body || {};
    const device = await kioskDeviceService.updateDevice(id, { name, status });
    if (status === 'revoked') {
      await kioskDisplaySessionService.cancelActiveSessionsForDevice(id, req.authUser?.id || null);
    }
    res.json({ success: true, device });
  } catch (error) {
    console.error('PATCH /api/kiosk/devices/:id failed:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to update device' });
  }
}

async function getState(req, res) {
  try {
    const state = await kioskDisplaySessionService.getDeviceState(req.kioskDevice);
    res.json({ success: true, ...state });
  } catch (error) {
    console.error('GET /api/kiosk/state failed:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to load kiosk state' });
  }
}

async function heartbeat(req, res) {
  try {
    const device = await kioskDeviceService.heartbeat(req.kioskDevice.id);
    const state = await kioskDisplaySessionService.getDeviceState(device);
    res.json({ success: true, device, ...state });
  } catch (error) {
    console.error('POST /api/kiosk/heartbeat failed:', error);
    res.status(500).json({ success: false, error: error.message || 'Heartbeat failed' });
  }
}

async function createDisplaySession(req, res) {
  try {
    const { kioskDeviceId, resourceType, resourceId, resourceToken, allowedActions } = req.body || {};
    if (!kioskDeviceId || !resourceType || (!resourceId && !resourceToken)) {
      return res.status(400).json({
        success: false,
        error: 'kioskDeviceId, resourceType, and resourceId or resourceToken are required',
      });
    }

    const session = await kioskDisplaySessionService.createDisplaySession({
      kioskDeviceId,
      resourceType,
      resourceId,
      resourceToken,
      requestedBy: req.authUser?.id || null,
      allowedActions,
    });

    res.json({ success: true, session });
  } catch (error) {
    console.error('POST /api/kiosk/display-sessions failed:', error);
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, error: error.message || 'Failed to create display session' });
  }
}

async function cancelDisplaySession(req, res) {
  try {
    const { id } = req.params;
    const session = await kioskDisplaySessionService.cancelSession(id, {
      cancelledBy: req.authUser?.id || null,
    });
    res.json({ success: true, session });
  } catch (error) {
    console.error('DELETE /api/kiosk/display-sessions/:id failed:', error);
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, error: error.message || 'Failed to cancel session' });
  }
}

async function getSessionAccess(req, res) {
  try {
    const { id } = req.params;
    const access = await kioskDisplaySessionService.getSessionAccess(id, req.kioskDevice.id);
    res.json({ success: true, access });
  } catch (error) {
    console.error('GET /api/kiosk/display-sessions/:id/access failed:', error);
    const status = error.statusCode || 410;
    res.status(status).json({ success: false, error: error.message || 'Session access denied' });
  }
}

async function completeDisplaySession(req, res) {
  try {
    const { id } = req.params;
    const session = await kioskDisplaySessionService.completeSession(id, req.kioskDevice.id);
    res.json({ success: true, session });
  } catch (error) {
    console.error('POST /api/kiosk/display-sessions/:id/complete failed:', error);
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, error: error.message || 'Failed to complete session' });
  }
}

async function cancelDisplaySessionFromDevice(req, res) {
  try {
    const { id } = req.params;
    const session = await kioskDisplaySessionService.cancelSession(id, {
      kioskDeviceId: req.kioskDevice.id,
    });
    res.json({ success: true, session });
  } catch (error) {
    console.error('POST /api/kiosk/display-sessions/:id/cancel failed:', error);
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, error: error.message || 'Failed to cancel session' });
  }
}

module.exports = {
  createPairingCode,
  claimPairingCode,
  pairDevice,
  listDevices,
  updateDevice,
  getState,
  heartbeat,
  createDisplaySession,
  cancelDisplaySession,
  getSessionAccess,
  completeDisplaySession,
  cancelDisplaySessionFromDevice,
};
