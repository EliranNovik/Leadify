// Teams Calling API client for frontend
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

export interface TeamsCallingApi {
  initiateCall: (targetUserId: string, callType?: 'audio' | 'video') => Promise<any>;
  endCall: (callId: string) => Promise<any>;
  getCallStatus: (callId: string) => Promise<any>;
  answerCall: (callId: string) => Promise<any>;
  rejectCall: (callId: string) => Promise<any>;
  muteCall: (callId: string, isMuted: boolean) => Promise<any>;
}

class TeamsCallingApiClient implements TeamsCallingApi {
  private baseUrl: string;

  constructor() {
    this.baseUrl = `${BACKEND_URL}/api/teams`;
  }

  private async makeRequest(endpoint: string, options: RequestInit = {}) {
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async initiateCall(targetUserId: string, callType: 'audio' | 'video' = 'audio'): Promise<any> {
    return this.makeRequest('/initiate', {
      method: 'POST',
      body: JSON.stringify({
        targetUserId,
        callType,
      }),
    });
  }

  async endCall(callId: string): Promise<any> {
    return this.makeRequest(`/${callId}`, {
      method: 'DELETE',
    });
  }

  async getCallStatus(callId: string): Promise<any> {
    return this.makeRequest(`/${callId}/status`, {
      method: 'GET',
    });
  }

  async answerCall(callId: string): Promise<any> {
    return this.makeRequest(`/${callId}/answer`, {
      method: 'POST',
    });
  }

  async rejectCall(callId: string): Promise<any> {
    return this.makeRequest(`/${callId}/reject`, {
      method: 'POST',
    });
  }

  async muteCall(callId: string, isMuted: boolean): Promise<any> {
    return this.makeRequest(`/${callId}/mute`, {
      method: 'POST',
      body: JSON.stringify({
        isMuted,
      }),
    });
  }
}

export const teamsCallingApi = new TeamsCallingApiClient(); 