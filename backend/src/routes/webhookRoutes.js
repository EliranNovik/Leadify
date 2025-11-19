const express = require('express');
const webhookController = require('../controllers/webhookController');
const graphEmailController = require('../controllers/graphEmailController');
require('dotenv').config();
const router = express.Router();

// Webhook endpoint to receive form data and create new leads
router.post('/hook/catch', webhookController.catchFormData);

// Facebook lead webhook (verification + payload)
router.get('/hook/facebook', webhookController.verifyFacebookWebhook);
router.post('/hook/facebook', webhookController.handleFacebookLead);

// Microsoft Graph email sync webhook (legacy manual trigger)
router.post('/hook/graph/emails/sync', graphEmailController.syncEmails);
router.get('/hook/graph/emails/health', graphEmailController.health);

// Microsoft Graph push notifications
router.get('/graph/webhook', graphEmailController.webhookValidation);
router.post('/graph/webhook', graphEmailController.webhookNotification);

// Health check for webhook
router.get('/hook/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Webhook endpoint is active',
    timestamp: new Date().toISOString()
  });
});

module.exports = router; 