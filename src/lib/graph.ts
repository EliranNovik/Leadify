// Microsoft Graph API utility for creating Teams meetings
// Usage: createTeamsMeeting(accessToken, meetingDetails)

export async function createTeamsMeeting(accessToken: string, meetingDetails: {
  subject: string;
  startDateTime: string; // ISO string
  endDateTime: string;   // ISO string
  attendees?: { email: string }[];
}) {
  const url = 'https://graph.microsoft.com/v1.0/me/onlineMeetings';
  const body = {
    subject: meetingDetails.subject,
    startDateTime: meetingDetails.startDateTime,
    endDateTime: meetingDetails.endDateTime,
    participants: {
      attendees: (meetingDetails.attendees || []).map(a => ({
        upn: a.email
      }))
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to create Teams meeting');
  }

  const data = await response.json();
  // data.joinUrl is the Teams meeting link
  return data;
}

// Teams Calling Functions
export async function initiateTeamsCall(accessToken: string, targetUserId: string, callType: 'audio' | 'video' = 'audio') {
  const url = 'https://graph.microsoft.com/v1.0/communications/calls';
  const body = {
    '@odata.type': '#microsoft.graph.call',
    callbackUri: `${window.location.origin}/api/callbacks`,
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
    tenantId: import.meta.env.VITE_MSAL_TENANT_ID
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to initiate Teams call');
  }

  return await response.json();
}

export async function getCallStatus(accessToken: string, callId: string) {
  const url = `https://graph.microsoft.com/v1.0/communications/calls/${callId}`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to get call status');
  }

  return await response.json();
}

export async function answerCall(accessToken: string, callId: string) {
  const url = `https://graph.microsoft.com/v1.0/communications/calls/${callId}/answer`;
  const body = {
    callbackUri: `${window.location.origin}/api/callbacks`,
    acceptedModalities: ['audio', 'video']
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to answer call');
  }

  return await response.json();
}

export async function rejectCall(accessToken: string, callId: string) {
  const url = `https://graph.microsoft.com/v1.0/communications/calls/${callId}/reject`;
  const body = {
    reason: 'busy'
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to reject call');
  }

  return await response.json();
}

export async function endCall(accessToken: string, callId: string) {
  const url = `https://graph.microsoft.com/v1.0/communications/calls/${callId}`;
  
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to end call');
  }

  return { success: true };
}

export async function muteCall(accessToken: string, callId: string, isMuted: boolean) {
  const url = `https://graph.microsoft.com/v1.0/communications/calls/${callId}/updateRecordingStatus`;
  const body = {
    isMuted: isMuted
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to update mute status');
  }

  return await response.json();
}

export const sendEmail = async (accessToken: string, email: {
  to: string;
  subject: string;
  body: string;
}) => {
  const emailToSend = {
    message: {
      subject: email.subject,
      body: {
        contentType: 'HTML',
        content: email.body,
      },
      toRecipients: [
        {
          emailAddress: {
            address: email.to,
          },
        },
      ],
    },
    saveToSentItems: 'true',
  };

  const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(emailToSend),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Graph API error sending email: ${error.error.message}`);
  }

  // sendMail does not return content, a 202 Accepted status is success
  return { status: response.status };
}; 