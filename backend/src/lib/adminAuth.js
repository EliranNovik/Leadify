const supabase = require('../config/supabase');

function isTruthyFlag(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

function readBearerToken(req) {
  const header = req.headers.authorization;
  if (!header || !String(header).startsWith('Bearer ')) return null;
  return String(header).slice('Bearer '.length).trim();
}

async function requireSuperuser(req, res, next) {
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
      .select('id, auth_id, email, is_superuser, is_active')
      .eq('auth_id', authData.user.id)
      .maybeSingle();

    if (userError || !userRow) {
      return res.status(403).json({ success: false, error: 'User profile not found' });
    }

    if (userRow.is_active === false) {
      return res.status(403).json({ success: false, error: 'Account is inactive' });
    }

    if (!isTruthyFlag(userRow.is_superuser)) {
      return res.status(403).json({ success: false, error: 'Superuser access required' });
    }

    req.authUser = authData.user;
    req.adminUserRow = userRow;
    req.accessToken = token;
    return next();
  } catch (error) {
    console.error('Admin auth middleware failed:', error);
    return res.status(500).json({ success: false, error: 'Authentication check failed' });
  }
}

module.exports = {
  isTruthyFlag,
  readBearerToken,
  requireSuperuser,
};
