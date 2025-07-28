const teamsCallingService = require('../services/teamsCallingService');

class TeamsCallingController {
  async initiateCall(req, res) {
    try {
      const { targetUserId, callType = 'audio' } = req.body;

      if (!targetUserId) {
        return res.status(400).json({
          success: false,
          error: 'targetUserId is required'
        });
      }

      // Use backend client credentials for Application permissions
      const callResult = await teamsCallingService.initiateCall(targetUserId, callType);

      res.status(200).json({
        success: true,
        data: callResult,
        message: `Initiating ${callType} call`
      });
    } catch (error) {
      console.error('[Teams Calling Controller] Error initiating call:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to initiate call'
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

      const result = await teamsCallingService.endCall(callId);

      res.status(200).json({
        success: true,
        data: result,
        message: 'Call ended successfully'
      });
    } catch (error) {
      console.error('[Teams Calling Controller] Error ending call:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to end call'
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

      const callStatus = await teamsCallingService.getCallStatus(callId);

      res.status(200).json({
        success: true,
        data: callStatus
      });
    } catch (error) {
      console.error('[Teams Calling Controller] Error getting call status:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get call status'
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

      const result = await teamsCallingService.answerCall(callId);

      res.status(200).json({
        success: true,
        data: result,
        message: 'Call answered successfully'
      });
    } catch (error) {
      console.error('[Teams Calling Controller] Error answering call:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to answer call'
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

      const result = await teamsCallingService.rejectCall(callId);

      res.status(200).json({
        success: true,
        data: result,
        message: 'Call rejected successfully'
      });
    } catch (error) {
      console.error('[Teams Calling Controller] Error rejecting call:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to reject call'
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

      const result = await teamsCallingService.muteCall(callId, isMuted);

      res.status(200).json({
        success: true,
        data: result,
        message: isMuted ? 'Call muted successfully' : 'Call unmuted successfully'
      });
    } catch (error) {
      console.error('[Teams Calling Controller] Error updating mute status:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to update mute status'
      });
    }
  }

  // Callback endpoint for Teams call events
  async handleCallCallback(req, res) {
    try {
      console.log('[Teams Calling] Callback received:', req.body);

      // Handle different call events
      const { resourceData, resourceUri, changeType } = req.body;

      if (changeType === 'created') {
        console.log('[Teams Calling] Call created:', resourceUri);
      } else if (changeType === 'updated') {
        console.log('[Teams Calling] Call updated:', resourceUri);
      } else if (changeType === 'deleted') {
        console.log('[Teams Calling] Call deleted:', resourceUri);
      }

      // Always respond with 200 to acknowledge receipt
      res.status(200).json({
        success: true,
        message: 'Callback received'
      });
    } catch (error) {
      console.error('[Teams Calling Controller] Error handling callback:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to handle callback'
      });
    }
  }
}

module.exports = new TeamsCallingController(); 