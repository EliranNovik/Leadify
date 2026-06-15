const express = require('express');
const paymentPlanInvoiceAutomationService = require('../services/paymentPlanInvoiceAutomationService');

const router = express.Router();

function cronAuthorized(req) {
  const secret = process.env.PAYMENT_PLAN_INVOICE_AUTOMATION_CRON_SECRET;
  if (!secret) return false;
  return req.headers['x-cron-secret'] === secret;
}

/** GET /api/payment-plan-invoice-automation/status — diagnostics (no auth). */
router.get('/status', async (req, res) => {
  try {
    const dueDate = paymentPlanInvoiceAutomationService.getJerusalemDateKey();
    res.json({
      success: true,
      dueDateJerusalem: dueDate,
      schedulerEnabled:
        (process.env.ENABLE_PAYMENT_PLAN_INVOICE_AUTOMATION_SCHEDULER || 'true').toLowerCase() !==
        'false',
      cronSecretConfigured: Boolean(process.env.PAYMENT_PLAN_INVOICE_AUTOMATION_CRON_SECRET),
      publicUrl: process.env.CRM_PUBLIC_URL || process.env.FRONTEND_URL || null,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Status check failed' });
  }
});

/**
 * POST /api/payment-plan-invoice-automation/run
 * Sends due-date invoice email + WhatsApp. Requires x-cron-secret header.
 * Body: { dryRun?: boolean, dueDate?: "YYYY-MM-DD" }
 */
router.post('/run', async (req, res) => {
  if (!cronAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const dryRun = Boolean(req.body?.dryRun);
    const dueDate = req.body?.dueDate || undefined;
    const result = await paymentPlanInvoiceAutomationService.processDueInvoiceAutomations({
      dryRun,
      dueDate,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('POST payment-plan-invoice-automation/run failed:', error);
    res.status(500).json({ success: false, error: error.message || 'Automation run failed' });
  }
});

module.exports = router;
