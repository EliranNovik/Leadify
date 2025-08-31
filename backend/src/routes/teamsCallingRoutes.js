const express = require('express');
const teamsCallingController = require('../controllers/teamsCallingController');
require('dotenv').config();


const router = express.Router();

// Teams calling routes
router.post('/initiate', teamsCallingController.initiateCall);
router.delete('/:callId', teamsCallingController.endCall);
router.get('/:callId/status', teamsCallingController.getCallStatus);
router.post('/:callId/answer', teamsCallingController.answerCall);
router.post('/:callId/reject', teamsCallingController.rejectCall);
router.post('/:callId/mute', teamsCallingController.muteCall);

// Callback endpoint for Teams call events
router.post('/callbacks', teamsCallingController.handleCallback);

module.exports = router; 