const express = require('express');
const handlerNewCasesDigestService = require('../services/handlerNewCasesDigestService');

const router = express.Router();

function cronAuthorized(req) {
  const secret =
    process.env.HANDLER_NEW_CASES_DIGEST_CRON_SECRET ||
    process.env.PAYMENT_PLAN_INVOICE_AUTOMATION_CRON_SECRET;
  if (!secret) return false;
  return req.headers['x-cron-secret'] === secret;
}

/** GET /api/handler-new-cases-digest/status */
router.get('/status', async (req, res) => {
  try {
    const runtime = await handlerNewCasesDigestService.getDigestRuntimeStatus();
    res.json({
      success: true,
      dateJerusalem: handlerNewCasesDigestService.getJerusalemDateKey(),
      schedulerEnabled:
        (process.env.ENABLE_HANDLER_NEW_CASES_DIGEST_SCHEDULER || 'true').toLowerCase() !== 'false',
      runHourJerusalem: Number(process.env.HANDLER_NEW_CASES_DIGEST_HOUR_JERUSALEM || '10'),
      runEndHourJerusalem: Number(process.env.HANDLER_NEW_CASES_DIGEST_END_HOUR_JERUSALEM || '11'),
      cronSecretConfigured: Boolean(
        process.env.HANDLER_NEW_CASES_DIGEST_CRON_SECRET ||
          process.env.PAYMENT_PLAN_INVOICE_AUTOMATION_CRON_SECRET,
      ),
      mailboxConfigured: Boolean(process.env.PAYMENT_CONFIRMATION_MAILBOX_USER_ID),
      templateId: Number(process.env.HANDLER_NEW_CASES_TEMPLATE_ID || 194),
      publicUrl: process.env.CRM_PUBLIC_URL || process.env.FRONTEND_URL || null,
      ...runtime,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Status check failed' });
  }
});

/**
 * POST /api/handler-new-cases-digest/run
 * Body: {
 *   dryRun?: boolean,
 *   employeeId?: number,
 *   email?: string,
 *   force?: boolean,   // ignore already-sent log
 *   sendTo?: string    // override recipient (useful for a one-person test)
 * }
 */
router.post('/run', async (req, res) => {
  if (!cronAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const dryRun = Boolean(req.body?.dryRun);
    const force = Boolean(req.body?.force);
    const employeeId = req.body?.employeeId ?? req.body?.employee_id ?? null;
    const email = req.body?.email || null;
    const sendTo = req.body?.sendTo || req.body?.send_to || null;
    const result = await handlerNewCasesDigestService.processHandlerNewCasesDigest({
      dryRun,
      force,
      employeeId,
      email,
      sendTo,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('POST handler-new-cases-digest/run failed:', error);
    res.status(500).json({ success: false, error: error.message || 'Digest run failed' });
  }
});

module.exports = router;
