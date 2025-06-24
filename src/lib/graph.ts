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