const supabase = require('../config/supabase');
const kioskDeviceService = require('../services/kioskDeviceService');
const { readBearerToken } = require('./adminAuth');

const DEVICE_TOKEN_HEADER = 'x-kiosk-device-token';

function readDeviceToken(req) {
  const raw = req.headers[DEVICE_TOKEN_HEADER] || req.headers[DEVICE_TOKEN_HEADER.toLowerCase()];
  return raw ? String(raw).trim() : null;
}

async function requireCrmUser(req, res, next) {
  try {
    const token = readBearerToken(req);
    if (!token) {
      return res.status(401).json({ success: false, error: 'Authorization required' });
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user?.id) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }

    const { data: userRow, error: userError } = await supabase
      .from('users')
      .select('id, auth_id, email, is_active, is_superuser')
      .eq('auth_id', authData.user.id)
      .maybeSingle();

    if (userError || !userRow) {
      return res.status(403).json({ success: false, error: 'User profile not found' });
    }

    if (userRow.is_active === false) {
      return res.status(403).json({ success: false, error: 'Account is inactive' });
    }

    req.authUser = authData.user;
    req.crmUser = userRow;
    req.accessToken = token;
    return next();
  } catch (error) {
    console.error('CRM auth middleware failed:', error);
    return res.status(500).json({ success: false, error: 'Authentication check failed' });
  }
}

async function requireKioskDevice(req, res, next) {
  try {
    const rawToken = readDeviceToken(req);
    if (!rawToken) {
      return res.status(401).json({ success: false, error: 'Kiosk device token required' });
    }

    const device = await kioskDeviceService.verifyDeviceToken(rawToken);
    if (!device) {
      return res.status(401).json({ success: false, error: 'Invalid or revoked kiosk device' });
    }

    req.kioskDevice = device;
    req.kioskDeviceToken = rawToken;
    return next();
  } catch (error) {
    console.error('Kiosk device auth failed:', error);
    return res.status(500).json({ success: false, error: 'Device authentication failed' });
  }
}

module.exports = {
  DEVICE_TOKEN_HEADER,
  readDeviceToken,
  requireCrmUser,
  requireKioskDevice,
};
