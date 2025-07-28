const express = require('express');
const teamsBotController = require('../controllers/teamsBotController');

const router = express.Router();

// Teams bot calling routes
router.post('/initiate', teamsBotController.initiateCall);
router.delete('/:callId', teamsBotController.endCall);
router.get('/:callId/status', teamsBotController.getCallStatus);
router.post('/:callId/answer', teamsBotController.answerCall);
router.post('/:callId/reject', teamsBotController.rejectCall);
router.post('/:callId/mute', teamsBotController.muteCall);

// Bot callback endpoint for Teams call events
router.post('/callbacks', teamsBotController.handleBotCallback);

module.exports = router; 