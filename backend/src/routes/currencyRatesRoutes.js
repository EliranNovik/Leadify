const express = require('express');
const boiExchangeRatesService = require('../services/boiExchangeRatesService');

const router = express.Router();

function cronAuthorized(req) {
  const secret = process.env.BOI_RATES_SYNC_CRON_SECRET;
  if (!secret) return false;
  return req.headers['x-cron-secret'] === secret;
}

/** GET /api/currency-rates — latest saved rates (all pairs for latest date). */
router.get('/', async (req, res) => {
  try {
    const rateDate = req.query.date || null;
    const rates = await boiExchangeRatesService.getLatestRates(rateDate);
    res.json({ success: true, count: rates.length, rates });
  } catch (error) {
    console.error('GET currency-rates failed:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to load rates' });
  }
});

/** GET /api/currency-rates/status — DB vs BOI publication dates (diagnostics). */
router.get('/status', async (req, res) => {
  try {
    const status = await boiExchangeRatesService.getSyncStatus();
    res.json({ success: true, ...status });
  } catch (error) {
    console.error('GET currency-rates/status failed:', error);
    res.status(500).json({ success: false, error: error.message || 'Status check failed' });
  }
});

/**
 * POST /api/currency-rates/sync
 * Triggers BOI fetch + DB upsert. Requires x-cron-secret or BOI_RATES_SYNC_CRON_SECRET.
 */
router.post('/sync', async (req, res) => {
  if (!cronAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const dryRun = Boolean(req.body?.dryRun);
    const currencies = req.body?.currencies;
    const result = await boiExchangeRatesService.syncBoiExchangeRates({ dryRun, currencies });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('POST currency-rates/sync failed:', error);
    res.status(500).json({ success: false, error: error.message || 'Sync failed' });
  }
});

module.exports = router;
