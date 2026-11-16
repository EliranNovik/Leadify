const supabase = require('../config/supabase');
const { readBearerToken } = require('../lib/adminAuth');
const overtimeWhatsApp = require('../services/clockInOvertimeWhatsAppService');

async function requestOvertimeApproval(req, res) {
  try {
    const token = readBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user?.id) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const { data: userRow, error: userError } = await supabase
      .from('users')
      .select('employee_id, is_superuser, is_active')
      .eq('auth_id', authData.user.id)
      .maybeSingle();

    if (userError || !userRow) {
      return res.status(403).json({ error: 'User profile not found' });
    }
    if (userRow.is_active === false) {
      return res.status(403).json({ error: 'Account is inactive' });
    }

    const employeeId = Number(req.body?.employeeId);
    const ownsEmployee = Number(userRow.employee_id) === employeeId;
    const superuser = userRow.is_superuser === true || userRow.is_superuser === 'true';
    if (!ownsEmployee && !superuser) {
      return res.status(403).json({ error: 'You can only request overtime for your own hours' });
    }

    const result = await overtimeWhatsApp.sendOvertimeApprovalRequest({
      employeeId,
      reason: req.body?.reason,
      hours: req.body?.hours,
      workplace: req.body?.workplace,
      date: req.body?.date,
      clockInIds: req.body?.clockInIds,
    });

    return res.json({ success: true, ...result });
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    console.error('[ClockInOvertimeWhatsApp] request failed:', error?.message || error);
    return res.status(status).json({ error: error?.message || 'Could not send the overtime request' });
  }
}

module.exports = {
  requestOvertimeApproval,
};
