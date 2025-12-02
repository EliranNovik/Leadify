const express = require('express');
const webhookController = require('../controllers/webhookController');
const graphEmailController = require('../controllers/graphEmailController');
require('dotenv').config();
const router = express.Router();

// Webhook endpoint to receive form data and create new leads
router.post('/hook/catch', webhookController.catchFormData);

// Facebook lead webhook (verification + payload)
router.get('/hook/facebook', (req, res, next) => {
  console.log('🔔 GET /hook/facebook called at:', new Date().toISOString());
  console.log('🔔 Query params:', req.query);
  next();
}, webhookController.verifyFacebookWebhook);

router.post('/hook/facebook', (req, res, next) => {
  console.log('='.repeat(80));
  console.log('🔔🔔🔔 POST /hook/facebook ROUTE MIDDLEWARE TRIGGERED 🔔🔔🔔');
  console.log('🔔 Time:', new Date().toISOString());
  console.log('🔔 Request IP:', req.ip || req.connection.remoteAddress);
  console.log('🔔 User-Agent:', req.get('User-Agent'));
  console.log('🔔 Request body exists:', !!req.body);
  console.log('🔔 Request body keys:', req.body ? Object.keys(req.body) : 'no body');
  console.log('='.repeat(80));
  next();
}, webhookController.handleFacebookLead);

// Microsoft Graph email sync webhook (legacy manual trigger)
router.post('/hook/graph/emails/sync', graphEmailController.syncEmails);
router.get('/hook/graph/emails/health', graphEmailController.health);

// Microsoft Graph push notifications
router.get('/graph/webhook', graphEmailController.webhookValidation);
router.post('/graph/webhook', graphEmailController.webhookNotification);

// Graph subscription management
router.post('/graph/subscriptions/refresh', graphEmailController.refreshSubscriptions);
router.get('/graph/subscriptions/status', graphEmailController.checkSubscriptions);

// Health check for webhook
router.get('/hook/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Webhook endpoint is active',
    timestamp: new Date().toISOString()
  });
});

module.exports = router; 