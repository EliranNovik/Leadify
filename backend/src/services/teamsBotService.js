const axios = require('axios');
const { ConfidentialClientApplication } = require('@azure/msal-node');

class TeamsBotService {
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
            console.log(`[Teams Bot] ${message}`);
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
      console.error('[Teams Bot] Error getting access token:', error);
      throw new Error('Failed to get access token for Teams bot');
    }
  }

  async initiateCallViaBot(targetUserId, callType = 'audio') {
    try {
      const accessToken = await this.getAccessToken();

      // Use the Teams bot API to initiate calls
      const botCallData = {
        '@odata.type': '#microsoft.graph.call',
        callbackUri: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/teams/bot/callbacks`,
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
        // Bot-specific properties
        source: {
          '@odata.type': '#microsoft.graph.participantInfo',
          identity: {
            '@odata.type': '#microsoft.graph.identitySet',
            application: {
              '@odata.type': '#microsoft.graph.identity',
              id: process.env.VITE_MSAL_CLIENT_ID
            }
          }
        }
      };

      const result = await this.botFrameworkService.initiateCall(botCallData);
      return result;
    } catch (error) {
      console.error('[Teams Bot Service] Error initiating call:', error);
      throw error;
    }
  }

  async endCallViaBot(callId) {
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
      console.error('[Teams Bot] Error ending call:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || 'Failed to end Teams call via bot');
    }
  }

  async getCallStatusViaBot(callId) {
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
      console.error('[Teams Bot] Error getting call status:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || 'Failed to get call status via bot');
    }
  }

  async answerCallViaBot(callId) {
    try {
      const accessToken = await this.getAccessToken();

      const answerData = {
        callbackUri: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/teams/bot/callbacks`,
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
      console.error('[Teams Bot] Error answering call:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || 'Failed to answer Teams call via bot');
    }
  }

  async rejectCallViaBot(callId) {
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
      console.error('[Teams Bot] Error rejecting call:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || 'Failed to reject Teams call via bot');
    }
  }

  async muteCallViaBot(callId, isMuted) {
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
      console.error('[Teams Bot] Error updating mute status:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || 'Failed to update mute status via bot');
    }
  }
}

module.exports = new TeamsBotService(); 