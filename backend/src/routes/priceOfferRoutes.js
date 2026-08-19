const express = require('express');
const leadPriceOfferService = require('../services/leadPriceOfferService');

const router = express.Router();

router.get('/price-offers', async (req, res) => {
  try {
    const data = await leadPriceOfferService.listPriceOffers({
      clientId: req.query.clientId,
      legacyId: req.query.legacyId,
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('❌ List price offers error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to list price offers' });
  }
});

router.post('/price-offers', async (req, res) => {
  try {
    const data = await leadPriceOfferService.insertPriceOffer(req.body || {});
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('❌ Save price offer error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to save price offer' });
  }
});

module.exports = router;
