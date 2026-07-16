const clockInKioskTokenService = require('../services/clockInKioskTokenService');
const clockInKioskEvents = require('../services/clockInKioskEvents');
const entryKioskDisplayService = require('../services/entryKioskDisplayService');

/** Simple in-memory rate limit for validate / announce (per IP). */
const validateHits = new Map();
const VALIDATE_WINDOW_MS = 60_000;
const VALIDATE_MAX_HITS = 60;
const announceHits = new Map();
const ANNOUNCE_WINDOW_MS = 60_000;
const ANNOUNCE_MAX_HITS = 40;

function pruneValidateHits(now) {
  for (const [key, bucket] of validateHits) {
    if (now - bucket.windowStart > VALIDATE_WINDOW_MS) {
      validateHits.delete(key);
    }
  }
}

function allowValidate(ip) {
  const now = Date.now();
  pruneValidateHits(now);
  const key = ip || 'unknown';
  const bucket = validateHits.get(key);
  if (!bucket || now - bucket.windowStart > VALIDATE_WINDOW_MS) {
    validateHits.set(key, { windowStart: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= VALIDATE_MAX_HITS;
}

function pruneAnnounceHits(now) {
  for (const [key, bucket] of announceHits) {
    if (now - bucket.windowStart > ANNOUNCE_WINDOW_MS) {
      announceHits.delete(key);
    }
  }
}

function allowAnnounce(ip) {
  const now = Date.now();
  pruneAnnounceHits(now);
  const key = ip || 'unknown';
  const bucket = announceHits.get(key);
  if (!bucket || now - bucket.windowStart > ANNOUNCE_WINDOW_MS) {
    announceHits.set(key, { windowStart: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= ANNOUNCE_MAX_HITS;
}

async function getCurrent(req, res) {
  try {
    const locationId = req.query.locationId ?? clockInKioskTokenService.DEFAULT_LOCATION_ID;
    const result = await clockInKioskTokenService.getCurrentToken(locationId);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('GET /api/clock-in-kiosk/current failed:', error);
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      error: error.message || 'Failed to load kiosk QR token',
    });
  }
}

async function validate(req, res) {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
    if (!allowValidate(String(ip))) {
      return res.status(429).json({
        success: false,
        valid: false,
        error: 'Too many validation requests — try again shortly',
      });
    }

    const { token, locationId } = req.body || {};
    const result = await clockInKioskTokenService.validateToken(token, locationId);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('POST /api/clock-in-kiosk/validate failed:', error);
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      valid: false,
      error: error.message || 'Failed to validate QR token',
    });
  }
}

async function announce(req, res) {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
    if (!allowAnnounce(String(ip))) {
      return res.status(429).json({
        success: false,
        error: 'Too many announce requests — try again shortly',
      });
    }

    const { locationId, employeeName, photoUrl, employeeId, action } = req.body || {};
    const event = await clockInKioskEvents.announce({
      locationId,
      employeeName,
      photoUrl,
      employeeId,
      action,
    });
    res.json({ success: true, event });
  } catch (error) {
    console.error('POST /api/clock-in-kiosk/announce failed:', error);
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      error: error.message || 'Failed to announce clock-in',
    });
  }
}

async function recentEvent(req, res) {
  try {
    const locationId = req.query.locationId ?? clockInKioskTokenService.DEFAULT_LOCATION_ID;
    const event = await clockInKioskEvents.getRecent(locationId);
    res.json({ success: true, event: event || null });
  } catch (error) {
    console.error('GET /api/clock-in-kiosk/recent-event failed:', error);
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      error: error.message || 'Failed to load recent kiosk event',
    });
  }
}

async function display(req, res) {
  try {
    const locationId = req.query.locationId ?? entryKioskDisplayService.DEFAULT_LOCATION_ID;
    const bundle = await entryKioskDisplayService.getDisplayBundle(locationId);
    res.json({ success: true, ...bundle });
  } catch (error) {
    console.error('GET /api/clock-in-kiosk/display failed:', error);
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      error: error.message || 'Failed to load kiosk display',
    });
  }
}

async function meetingsToday(req, res) {
  try {
    const locationId = req.query.locationId ?? entryKioskDisplayService.DEFAULT_LOCATION_ID;
    const bundle = await entryKioskDisplayService.getMeetingsTodayBundle(locationId);
    res.json({ success: true, ...bundle });
  } catch (error) {
    console.error('GET /api/clock-in-kiosk/meetings-today failed:', error);
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      error: error.message || 'Failed to load meetings today',
    });
  }
}

module.exports = {
  getCurrent,
  validate,
  announce,
  recentEvent,
  display,
  meetingsToday,
};
