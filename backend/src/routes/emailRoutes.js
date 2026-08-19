const express = require('express');
const emailController = require('../controllers/emailController');

const router = express.Router();

router.get('/emails', emailController.list);
router.get('/emails/offers', emailController.listOffers);
router.get('/emails/:id/body', emailController.body);
router.get('/emails/:id/attachments/:attachmentId', emailController.downloadAttachment);
router.post('/emails/:conversationId/track', emailController.toggleThread);
router.post('/emails/send', emailController.send);
router.post('/emails/record', emailController.record);

module.exports = router;


