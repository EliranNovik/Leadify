const express = require('express');
const nineHourAutoClockOutService = require('../services/nineHourAutoClockOutService');

const router = express.Router();

function cronAuthorized(req) {
  const secret = process.env.NINE_HOUR_AUTO_CLOCKOUT_CRON_SECRET;
  if (!secret) return false;
  return req.headers['x-cron-secret'] === secret;
}

/** POST /api/nine-hour-auto-clock-out/run — manual/cron trigger. */
router.post('/run', async (req, res) => {
  if (!cronAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const result = await nineHourAutoClockOutService.runNineHourAutoClockOut();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('POST nine-hour-auto-clock-out/run failed:', error);
    res.status(500).json({ success: false, error: error.message || 'Run failed' });
  }
});

module.exports = router;
