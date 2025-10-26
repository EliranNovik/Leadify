const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');

// Import multer middleware
const multer = require('multer');
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 } // 16MB limit
});

// WhatsApp webhook verification
router.get('/webhook', whatsappController.verifyWebhook);

// WhatsApp webhook for receiving messages
router.post('/webhook', whatsappController.handleWebhook);

// Send WhatsApp message
router.post('/send-message', whatsappController.sendMessage);

// Send WhatsApp media (image, document, etc.)
router.post('/send-media', whatsappController.sendMedia);

// Edit WhatsApp message
router.post('/edit-message', whatsappController.editMessage);

// Delete WhatsApp message
router.post('/delete-message', whatsappController.deleteMessage);

// Get message status
router.get('/message-status/:messageId', whatsappController.getMessageStatus);

// Get conversation history
router.get('/conversation/:leadId', whatsappController.getConversation);

// Debug endpoint to find leads by phone number
router.get('/find-leads/:phoneNumber', whatsappController.findLeadsByPhone);

// Upload media to WhatsApp
router.post('/upload-media', upload.single('file'), whatsappController.uploadMedia);

// Get media from WhatsApp
router.get('/media/:mediaId', whatsappController.getMedia);

// Handle OPTIONS requests for media endpoint (CORS preflight)
router.options('/media/:mediaId', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  res.sendStatus(200);
});

// Test endpoint to verify API is accessible
router.get('/test', (req, res) => {
  res.json({ 
    message: 'WhatsApp API is accessible',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Test webhook endpoint to simulate status updates
router.post('/test-webhook', (req, res) => {
  console.log('🧪 Test webhook received:', req.body);
  
  // Simulate a status update
  const mockStatus = {
    id: req.body.messageId || 'test_message_id',
    status: req.body.status || 'delivered',
    timestamp: Math.floor(Date.now() / 1000)
  };
  
  // Call the updateMessageStatus function
  const whatsappController = require('../controllers/whatsappController');
  whatsappController.updateMessageStatus(mockStatus);
  
  res.json({ 
    message: 'Test webhook processed',
    status: mockStatus
  });
});

module.exports = router; 