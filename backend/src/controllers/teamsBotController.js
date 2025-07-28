const teamsBotService = require('../services/teamsBotService');

class TeamsBotController {
  async initiateCall(req, res) {
    try {
      const { targetUserId, callType = 'audio' } = req.body;

      if (!targetUserId) {
        return res.status(400).json({
          success: false,
          error: 'targetUserId is required'
        });
      }

      // Use bot service for calling
      const callResult = await teamsBotService.initiateCallViaBot(targetUserId, callType);

      res.status(200).json({
        success: true,
        data: callResult,
        message: `Initiating ${callType} call via Teams bot`
      });
    } catch (error) {
      console.error('[Teams Bot Controller] Error initiating call:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to initiate call via bot'
      });
    }
  }

  async endCall(req, res) {
    try {
      const { callId } = req.params;

      if (!callId) {
        return res.status(400).json({
          success: false,
          error: 'callId is required'
        });
      }

      const result = await teamsBotService.endCallViaBot(callId);

      res.status(200).json({
        success: true,
        data: result,
        message: 'Call ended successfully via bot'
      });
    } catch (error) {
      console.error('[Teams Bot Controller] Error ending call:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to end call via bot'
      });
    }
  }

  async getCallStatus(req, res) {
    try {
      const { callId } = req.params;

      if (!callId) {
        return res.status(400).json({
          success: false,
          error: 'callId is required'
        });
      }

      const callStatus = await teamsBotService.getCallStatusViaBot(callId);

      res.status(200).json({
        success: true,
        data: callStatus
      });
    } catch (error) {
      console.error('[Teams Bot Controller] Error getting call status:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get call status via bot'
      });
    }
  }

  async answerCall(req, res) {
    try {
      const { callId } = req.params;

      if (!callId) {
        return res.status(400).json({
          success: false,
          error: 'callId is required'
        });
      }

      const result = await teamsBotService.answerCallViaBot(callId);

      res.status(200).json({
        success: true,
        data: result,
        message: 'Call answered successfully via bot'
      });
    } catch (error) {
      console.error('[Teams Bot Controller] Error answering call:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to answer call via bot'
      });
    }
  }

  async rejectCall(req, res) {
    try {
      const { callId } = req.params;

      if (!callId) {
        return res.status(400).json({
          success: false,
          error: 'callId is required'
        });
      }

      const result = await teamsBotService.rejectCallViaBot(callId);

      res.status(200).json({
        success: true,
        data: result,
        message: 'Call rejected successfully via bot'
      });
    } catch (error) {
      console.error('[Teams Bot Controller] Error rejecting call:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to reject call via bot'
      });
    }
  }

  async muteCall(req, res) {
    try {
      const { callId } = req.params;
      const { isMuted } = req.body;

      if (!callId) {
        return res.status(400).json({
          success: false,
          error: 'callId is required'
        });
      }

      if (typeof isMuted !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'isMuted must be a boolean'
        });
      }

      const result = await teamsBotService.muteCallViaBot(callId, isMuted);

      res.status(200).json({
        success: true,
        data: result,
        message: isMuted ? 'Call muted successfully via bot' : 'Call unmuted successfully via bot'
      });
    } catch (error) {
      console.error('[Teams Bot Controller] Error updating mute status:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to update mute status via bot'
      });
    }
  }

  // Bot callback endpoint for Teams call events
  async handleBotCallback(req, res) {
    try {
      console.log('[Teams Bot] Callback received:', req.body);

      // Handle different call events
      const { resourceData, resourceUri, changeType } = req.body;

      if (changeType === 'created') {
        console.log('[Teams Bot] Call created:', resourceUri);
      } else if (changeType === 'updated') {
        console.log('[Teams Bot] Call updated:', resourceUri);
      } else if (changeType === 'deleted') {
        console.log('[Teams Bot] Call deleted:', resourceUri);
      }

      // Always respond with 200 to acknowledge receipt
      res.status(200).json({
        success: true,
        message: 'Bot callback received'
      });
    } catch (error) {
      console.error('[Teams Bot Controller] Error handling callback:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to handle bot callback'
      });
    }
  }
}

module.exports = new TeamsBotController(); 