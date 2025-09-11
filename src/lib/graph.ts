// Microsoft Graph API utility for creating Teams meetings
// Usage: createTeamsMeeting(accessToken, meetingDetails)

export async function createTeamsMeeting(accessToken: string, meetingDetails: {
  subject: string;
  startDateTime: string; // ISO string
  endDateTime: string;   // ISO string
  attendees?: { email: string }[];
}) {
  // Create meeting in potential clients calendar instead of personal calendar
  const potentialClientsCalendarEmail = 'shared-potentialclients@lawoffice.org.il';
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(potentialClientsCalendarEmail)}/calendar/events`;
  
  const body = {
    subject: meetingDetails.subject,
    start: {
      dateTime: meetingDetails.startDateTime,
      timeZone: 'UTC'
    },
    end: {
      dateTime: meetingDetails.endDateTime,
      timeZone: 'UTC'
    },
    attendees: (meetingDetails.attendees || []).map(a => ({
      emailAddress: {
        address: a.email
      },
      type: 'required'
    })),
    isOnlineMeeting: true,
    onlineMeetingProvider: 'teamsForBusiness'
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
    console.error('Teams meeting creation error:', error);
    throw new Error(error.error?.message || 'Failed to create Teams meeting');
  }

  const data = await response.json();
  
  // Return the online meeting URL if available, otherwise the join URL
  return {
    joinUrl: data.onlineMeeting?.joinUrl || data.webLink,
    id: data.id,
    onlineMeeting: data.onlineMeeting
  };
}

export async function createStaffTeamsMeeting(
  accessToken: string,
  meetingDetails: {
    subject: string;
    startDateTime: string;
    endDateTime: string;
    attendees?: { email: string }[];
  }
) {
  // Create meeting in staff calendar
  const staffCalendarEmail = 'shared-staffcalendar@lawoffice.org.il';
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(staffCalendarEmail)}/calendar/events`;
  
  const body = {
    subject: meetingDetails.subject,
    start: {
      dateTime: meetingDetails.startDateTime,
      timeZone: 'UTC'
    },
    end: {
      dateTime: meetingDetails.endDateTime,
      timeZone: 'UTC'
    },
    attendees: (meetingDetails.attendees || []).map(a => ({
      emailAddress: {
        address: a.email
      },
      type: 'required'
    })),
    isOnlineMeeting: true,
    onlineMeetingProvider: 'teamsForBusiness'
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
    console.error('Staff Teams meeting creation error:', error);
    throw new Error(error.error?.message || 'Failed to create Staff Teams meeting');
  }

  const data = await response.json();
  
  // Return the online meeting URL if available, otherwise the join URL
  return {
    joinUrl: data.onlineMeeting?.joinUrl || data.webLink,
    id: data.id,
    onlineMeeting: data.onlineMeeting
  };
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
  // Get the user's email signature from the database
  const { getCurrentUserEmailSignature } = await import('./emailSignature');
  const userSignature = await getCurrentUserEmailSignature();
  
  // Handle signature (HTML or plain text)
  let fullBody = email.body;
  if (userSignature) {
    // Check if signature is already HTML
    if (userSignature.includes('<') && userSignature.includes('>')) {
      fullBody = email.body + `<br><br>${userSignature}`;
    } else {
      // Convert plain text to HTML
      const signatureHtml = `<br><br>${userSignature.replace(/\n/g, '<br>')}`;
      fullBody = email.body + signatureHtml;
    }
  }

  const emailToSend = {
    message: {
      subject: email.subject,
      body: {
        contentType: 'HTML',
        content: fullBody,
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