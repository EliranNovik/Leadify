const express = require('express');
const webhookController = require('../controllers/webhookController');
require('dotenv').config();
const router = express.Router();

// Webhook endpoint to receive form data and create new leads
router.post('/hook/catch', webhookController.catchFormData);

// Health check for webhook
router.get('/hook/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Webhook endpoint is active',
    timestamp: new Date().toISOString()
  });
});

module.exports = router; 