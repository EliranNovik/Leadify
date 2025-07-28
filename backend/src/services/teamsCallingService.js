const axios = require('axios');
const { ConfidentialClientApplication } = require('@azure/msal-node');
require('dotenv').config();

class TeamsCallingService {
  constructor() {
    this.msalConfig = {
      auth: {
        clientId: process.env.VITE_MSAL_CLIENT_ID,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
        authority: `https://login.microsoftonline.com/${process.env.VITE_MSAL_TENANT_ID}`,
      },
      system: {
        loggerOptions: {
          loggerCallback: (level, message, containsPii) => {
            if (containsPii) {
              return;
            }
            console.log(`[Teams Calling] ${message}`);
          },
          logLevel: 3,
        }
      }
    };

    this.confidentialClient = new ConfidentialClientApplication(this.msalConfig);
  }

  async getAccessToken() {
    try {
      const clientCredentialRequest = {
        scopes: [
          'https://graph.microsoft.com/.default'
        ]
      };

      const response = await this.confidentialClient.acquireTokenByClientCredential(clientCredentialRequest);
      return response.accessToken;
    } catch (error) {
      console.error('[Teams Calling] Error getting access token:', error);
      throw new Error('Failed to get access token for Teams calling');
    }
  }

  async initiateCall(targetUserId, callType = 'audio') {
    try {
      const accessToken = await this.getAccessToken();

      // Try using the communications API with a different approach for SPAs
      const callData = {
        '@odata.type': '#microsoft.graph.call',
        callbackUri: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/teams/callbacks`,
        targets: [
          {
            '@odata.type': '#microsoft.graph.invitationParticipantInfo',
            identity: {
              '@odata.type': '#microsoft.graph.identitySet',
              user: {
                '@odata.type': '#microsoft.graph.identity',
                id: targetUserId
              }
            }
          }
        ],
        requestedModalities: [callType],
        tenantId: process.env.VITE_MSAL_TENANT_ID,
        // Try without source property for SPA
        '@odata.context': 'https://graph.microsoft.com/v1.0/$metadata#communications/calls/$entity'
      };

      console.log('[Teams Calling] Initiating call with SPA approach:', JSON.stringify(callData, null, 2));

      const response = await axios.post(
        'https://graph.microsoft.com/v1.0/communications/calls',
        callData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('[Teams Calling] Error initiating call:', error.response?.data || error.message);
      
      if (error.response?.data?.error?.code === '7503') {
        throw new Error('SPA apps cannot initiate Teams calls directly. Please add Web platform to your Azure AD app or use Teams Bot Framework.');
      }
      
      throw new Error(error.response?.data?.error?.message || 'Failed to initiate Teams call');
    }
  }

  async endCall(callId) {
    try {
      const accessToken = await this.getAccessToken();

      await axios.delete(
        `https://graph.microsoft.com/v1.0/communications/calls/${callId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return { success: true };
    } catch (error) {
      console.error('[Teams Calling] Error ending call:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || 'Failed to end Teams call');
    }
  }

  async getCallStatus(callId) {
    try {
      const accessToken = await this.getAccessToken();

      const response = await axios.get(
        `https://graph.microsoft.com/v1.0/communications/calls/${callId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('[Teams Calling] Error getting call status:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || 'Failed to get call status');
    }
  }

  async answerCall(callId) {
    try {
      const accessToken = await this.getAccessToken();

      const answerData = {
        callbackUri: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/teams/callbacks`,
        acceptedModalities: ['audio', 'video']
      };

      const response = await axios.post(
        `https://graph.microsoft.com/v1.0/communications/calls/${callId}/answer`,
        answerData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('[Teams Calling] Error answering call:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || 'Failed to answer Teams call');
    }
  }

  async rejectCall(callId) {
    try {
      const accessToken = await this.getAccessToken();

      const rejectData = {
        reason: 'busy'
      };

      const response = await axios.post(
        `https://graph.microsoft.com/v1.0/communications/calls/${callId}/reject`,
        rejectData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('[Teams Calling] Error rejecting call:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || 'Failed to reject Teams call');
    }
  }

  async muteCall(callId, isMuted) {
    try {
      const accessToken = await this.getAccessToken();

      const muteData = {
        isMuted: isMuted
      };

      const response = await axios.post(
        `https://graph.microsoft.com/v1.0/communications/calls/${callId}/updateRecordingStatus`,
        muteData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('[Teams Calling] Error updating mute status:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || 'Failed to update mute status');
    }
  }
}

module.exports = new TeamsCallingService(); 