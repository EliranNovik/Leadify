const express = require('express');
const router = express.Router();
const pushNotificationController = require('../controllers/pushNotificationController');

// Send push notification
router.post('/push/send', pushNotificationController.sendPushNotification);
router.post('/push/rmq/send', pushNotificationController.sendRmqNotification);

module.exports = router;

