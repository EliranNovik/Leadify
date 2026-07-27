// Microsoft Graph API utility for creating Teams meetings
// Usage: createTeamsMeeting(accessToken, meetingDetails)

import { IPublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';
import { extractTeamsJoinUrlFromGraphPayload } from './meetingJoinLink';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a Teams online meeting via the Online Meetings API (returns joinWebUrl reliably).
 * Prefer this when calendar event POST leaves onlineMeeting null (common on shared mailboxes).
 */
export async function createOnlineMeetingJoinUrl(
  accessToken: string,
  meetingDetails: {
    subject: string;
    startDateTime: string;
    endDateTime: string;
  },
  /** Mailbox UPN/email, or omit / use 'me' for the signed-in user */
  mailboxEmail?: string | 'me'
): Promise<string> {
  const path =
    !mailboxEmail || mailboxEmail === 'me'
      ? 'https://graph.microsoft.com/v1.0/me/onlineMeetings'
      : `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxEmail)}/onlineMeetings`;

  const response = await fetch(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      startDateTime: meetingDetails.startDateTime,
      endDateTime: meetingDetails.endDateTime,
      subject: meetingDetails.subject,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    console.warn('onlineMeetings create failed:', mailboxEmail || 'me', error);
    return '';
  }

  const data = await response.json();
  return extractTeamsJoinUrlFromGraphPayload(data);
}

/**
 * After creating a calendar event with isOnlineMeeting, Graph often returns onlineMeeting: null
 * (especially on shared calendars). Poll GET, then fall back to Online Meetings API.
 * Never returns Outlook webLink — that is a calendar item URL, not a Teams join link.
 */
export async function resolveTeamsJoinUrlForEvent(
  accessToken: string,
  options: {
    calendarUserEmail: string;
    eventId: string;
    eventData: unknown;
    subject: string;
    startDateTime: string;
    endDateTime: string;
  }
): Promise<{ joinUrl: string; onlineMeeting: unknown }> {
  let onlineMeeting =
    options.eventData &&
    typeof options.eventData === 'object' &&
    'onlineMeeting' in options.eventData
      ? (options.eventData as { onlineMeeting?: unknown }).onlineMeeting
      : null;

  let joinUrl = extractTeamsJoinUrlFromGraphPayload(options.eventData);

  if (!joinUrl && options.eventId) {
    const basePath =
      !options.calendarUserEmail || options.calendarUserEmail === 'me'
        ? 'https://graph.microsoft.com/v1.0/me'
        : `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(options.calendarUserEmail)}`;
    const getUrl =
      `${basePath}/events/${encodeURIComponent(options.eventId)}` +
      `?$select=id,isOnlineMeeting,onlineMeetingProvider,onlineMeeting`;

    for (let attempt = 0; attempt < 4 && !joinUrl; attempt++) {
      await sleep(400 * (attempt + 1));
      try {
        const res = await fetch(getUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) continue;
        const refreshed = await res.json();
        onlineMeeting = refreshed.onlineMeeting ?? onlineMeeting;
        joinUrl = extractTeamsJoinUrlFromGraphPayload(refreshed);
      } catch (err) {
        console.warn('Failed to refresh event for Teams join URL:', err);
      }
    }
  }

  if (!joinUrl) {
    const mailbox =
      !options.calendarUserEmail || options.calendarUserEmail === 'me'
        ? undefined
        : options.calendarUserEmail;
    joinUrl =
      (await createOnlineMeetingJoinUrl(
        accessToken,
        {
          subject: options.subject,
          startDateTime: options.startDateTime,
          endDateTime: options.endDateTime,
        },
        mailbox
      )) ||
      (await createOnlineMeetingJoinUrl(accessToken, {
        subject: options.subject,
        startDateTime: options.startDateTime,
        endDateTime: options.endDateTime,
      }));
  }

  if (!joinUrl) {
    console.warn(
      'Teams join URL could not be resolved; refusing to use Outlook webLink as a meeting link.'
    );
  }

  return { joinUrl, onlineMeeting };
}

/** Thrown when popup auth fails (blocked, iframe, mobile) so UI can offer redirect. */
export class AuthPopupBlockedError extends Error {
  constructor(message: string = 'Popup sign-in was blocked or unavailable.') {
    super(message);
    this.name = 'AuthPopupBlockedError';
  }
}

/** True when popup is often blocked: embedded in iframe or mobile. */
export function isPopupUnreliable(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const inIframe = window.self !== window.top;
    const isMobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    return inIframe || isMobile;
  } catch {
    return true; // e.g. same-origin check throws in some contexts
  }
}

/** Returns true if the error indicates popup was blocked or failed to open. */
function isPopupBlockedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /popup_window_error|empty_window_error|popup.*blocked|window\.open.*null/i.test(msg) ||
    /Error opening popup window/i.test(msg)
  );
}

/** Trigger redirect-based sign-in (page will navigate away; user creates meeting again after return). */
export async function triggerTokenRedirect(
  instance: IPublicClientApplication,
  loginRequest: any,
  account: any
): Promise<void> {
  await instance.acquireTokenRedirect({ ...loginRequest, account });
}

// Utility function to get access token with fallback
export async function getAccessTokenWithFallback(
  instance: IPublicClientApplication,
  loginRequest: any,
  account: any,
  onInteractiveAuth?: () => void
): Promise<string | null> {
  try {
    // Try silent token acquisition first
    const response = await instance.acquireTokenSilent({
      ...loginRequest,
      account,
    });
    return response.accessToken;
  } catch (error) {
    console.log('Silent token acquisition failed, trying interactive:', error);
    const requestWithAccount = { ...loginRequest, account };

    // In iframe or on mobile, popup is unreliable; use redirect so user can sign in and return
    if (isPopupUnreliable()) {
      console.log('Using redirect flow (iframe or mobile).');
      if (onInteractiveAuth) onInteractiveAuth();
      await instance.acquireTokenRedirect(requestWithAccount);
      return null; // Page is navigating away
    }

    try {
      console.log('Opening Microsoft authentication popup...');
      if (onInteractiveAuth) onInteractiveAuth();
      const response = await instance.acquireTokenPopup(loginRequest);
      console.log('Interactive authentication successful');
      return response.accessToken;
    } catch (popupError) {
      console.error('Interactive token acquisition also failed:', popupError);
      if (popupError instanceof Error) {
        console.error('Error details:', popupError.message);
      }
      if (isPopupBlockedError(popupError)) {
        throw new AuthPopupBlockedError(
          'Sign-in window was blocked or could not open. Please allow popups for this site, or use "Sign in (this tab)" below.'
        );
      }
      return null;
    }
  }
}

export async function createTeamsMeeting(accessToken: string, meetingDetails: {
  subject: string;
  startDateTime: string; // ISO string
  endDateTime: string;   // ISO string
  manager?: string;
  helper?: string;
  brief?: string;
  attendance_probability?: string;
  complexity?: string;
  car_number?: string;
  expert?: string;
  amount?: number;
  currency?: string;
}) {
  // Create meeting in potential clients calendar instead of personal calendar
  const potentialClientsCalendarEmail = 'shared-potentialclients@lawoffice.org.il';
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(potentialClientsCalendarEmail)}/calendar/events`;
  
  // Create detailed description with meeting information
  const description = [
    'Meeting Details:',
    `Manager: ${meetingDetails.manager || 'Not specified'}`,
    `Helper: ${meetingDetails.helper || 'Not specified'}`,
    `Expert: ${meetingDetails.expert || 'Not specified'}`,
    `Amount: ${meetingDetails.currency || '₪'}${meetingDetails.amount || 0}`,
    `Attendance Probability: ${meetingDetails.attendance_probability || 'Not specified'}`,
    `Complexity: ${meetingDetails.complexity || 'Not specified'}`,
    meetingDetails.car_number ? `Car Number: ${meetingDetails.car_number}` : '',
    meetingDetails.brief ? `Brief: ${meetingDetails.brief}` : '',
    '',
    'Generated by RMQ 2.0 System'
  ].filter(line => line !== '').join('\n');

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
    body: {
      contentType: 'text',
      content: description
    },
    // Removed attendees to prevent automatic email invitations
    // attendees: (meetingDetails.attendees || []).map(a => ({
    //   emailAddress: {
    //     address: a.email
    //   },
    //   type: 'required'
    // })),
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
  const resolved = await resolveTeamsJoinUrlForEvent(accessToken, {
    calendarUserEmail: potentialClientsCalendarEmail,
    eventId: data.id,
    eventData: data,
    subject: meetingDetails.subject,
    startDateTime: meetingDetails.startDateTime,
    endDateTime: meetingDetails.endDateTime,
  });

  return {
    joinUrl: resolved.joinUrl,
    id: data.id,
    onlineMeeting: resolved.onlineMeeting || data.onlineMeeting
  };
}

export async function createStaffTeamsMeeting(
  accessToken: string,
  meetingDetails: {
    subject: string;
    startDateTime: string;
    endDateTime: string;
    attendees?: { email: string }[];
    isRecurring?: boolean;
    recurrencePattern?: 'daily' | 'weekly' | 'monthly';
    recurrenceInterval?: number;
    recurrenceEndDate?: string | null;
  }
) {
  // Create meeting in staff calendar
  const staffCalendarEmail = 'shared-staffcalendar@lawoffice.org.il';
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(staffCalendarEmail)}/calendar/events`;
  
  const body: any = {
    subject: meetingDetails.subject,
    start: {
      dateTime: meetingDetails.startDateTime,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    },
    end: {
      dateTime: meetingDetails.endDateTime,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    },
    // Removed attendees to prevent automatic email invitations
    // attendees: (meetingDetails.attendees || []).map(a => ({
    //   emailAddress: {
    //     address: a.email
    //   },
    //   type: 'required'
    // })),
    isOnlineMeeting: true,
    onlineMeetingProvider: 'teamsForBusiness'
  };

  // Add recurrence if specified
  if (meetingDetails.isRecurring) {
    const startDate = new Date(meetingDetails.startDateTime);
    const dayOfWeek = startDate.getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    // Map JavaScript day numbers to Microsoft Graph day names
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayOfWeekName = dayNames[dayOfWeek];
    
    const recurrence: any = {
      pattern: {
        type: meetingDetails.recurrencePattern || 'weekly',
        interval: meetingDetails.recurrenceInterval || 1
      },
      range: {
        type: meetingDetails.recurrenceEndDate ? 'endDate' : 'noEnd',
        startDate: meetingDetails.startDateTime.split('T')[0],
        ...(meetingDetails.recurrenceEndDate && {
          endDate: meetingDetails.recurrenceEndDate.split('T')[0]
        })
      }
    };

    // Add daysOfWeek for weekly pattern
    if (meetingDetails.recurrencePattern === 'weekly') {
      recurrence.pattern.daysOfWeek = [dayOfWeekName];
    }
    
    // Add dayOfMonth for monthly pattern
    if (meetingDetails.recurrencePattern === 'monthly') {
      recurrence.pattern.dayOfMonth = startDate.getDate();
    }

    body.recurrence = recurrence;
  }


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
    throw new Error(error.error?.message || `Failed to create Staff Teams meeting: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const resolved = await resolveTeamsJoinUrlForEvent(accessToken, {
    calendarUserEmail: staffCalendarEmail,
    eventId: data.id,
    eventData: data,
    subject: meetingDetails.subject,
    startDateTime: meetingDetails.startDateTime,
    endDateTime: meetingDetails.endDateTime,
  });

  return {
    joinUrl: resolved.joinUrl,
    id: data.id,
    onlineMeeting: resolved.onlineMeeting || data.onlineMeeting
  };
}

/**
 * Create a regular (non-Teams) event in the shared staff calendar.
 * We intentionally omit attendees to prevent automatic email invitations.
 */
export async function createStaffCalendarEvent(
  accessToken: string,
  eventDetails: {
    subject: string;
    startDateTime: string;
    endDateTime: string;
    locationName?: string | null;
    description?: string | null;
    attendeesEmails?: string[];
    isRecurring?: boolean;
    recurrencePattern?: 'daily' | 'weekly' | 'monthly';
    recurrenceInterval?: number;
    recurrenceEndDate?: string | null;
  }
) {
  const staffCalendarEmail = 'shared-staffcalendar@lawoffice.org.il';
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(staffCalendarEmail)}/calendar/events`;

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const descLines: string[] = [];
  if (eventDetails.description) descLines.push(String(eventDetails.description));
  if (eventDetails.attendeesEmails && eventDetails.attendeesEmails.length > 0) {
    descLines.push('');
    descLines.push(`Participants (no invites): ${eventDetails.attendeesEmails.join(', ')}`);
  }

  const body: any = {
    subject: eventDetails.subject,
    start: { dateTime: eventDetails.startDateTime, timeZone: tz },
    end: { dateTime: eventDetails.endDateTime, timeZone: tz },
    body: {
      contentType: 'text',
      content: descLines.filter(Boolean).join('\n').trim() || ''
    },
    location: eventDetails.locationName ? { displayName: eventDetails.locationName } : undefined,
    isOnlineMeeting: false
  };

  if (eventDetails.isRecurring) {
    const startDate = new Date(eventDetails.startDateTime);
    const dayOfWeek = startDate.getDay();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayOfWeekName = dayNames[dayOfWeek];

    const recurrence: any = {
      pattern: {
        type: eventDetails.recurrencePattern || 'weekly',
        interval: eventDetails.recurrenceInterval || 1
      },
      range: {
        type: eventDetails.recurrenceEndDate ? 'endDate' : 'noEnd',
        startDate: eventDetails.startDateTime.split('T')[0],
        ...(eventDetails.recurrenceEndDate && {
          endDate: eventDetails.recurrenceEndDate.split('T')[0]
        })
      }
    };

    if (eventDetails.recurrencePattern === 'weekly') {
      recurrence.pattern.daysOfWeek = [dayOfWeekName];
    }
    if (eventDetails.recurrencePattern === 'monthly') {
      recurrence.pattern.dayOfMonth = startDate.getDate();
    }

    body.recurrence = recurrence;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error?.error?.message || `Failed to create staff calendar event: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  return { id: data.id as string, webLink: data.webLink as string | undefined };
}

/** Local wall-clock string for Graph `dateTime` (paired with `timeZone`, not UTC Z). */
export function formatLocalDateTimeForGraph(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

export function buildStaffMeetingWindow(
  date: string,
  time: string,
  durationMinutes: number
): { start: Date; end: Date; graphStart: string; graphEnd: string } {
  const timeNorm = time.trim().length === 5 ? `${time.trim()}:00` : time.trim();
  const start = new Date(`${date}T${timeNorm}`);
  const dur = Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : 60;
  const end = new Date(start.getTime() + dur * 60000);
  return {
    start,
    end,
    graphStart: formatLocalDateTimeForGraph(start),
    graphEnd: formatLocalDateTimeForGraph(end),
  };
}

/**
 * PATCH an event in the shared staff calendar. `eventId` must be URL-encoded in the path.
 */
export async function updateStaffCalendarEvent(
  accessToken: string,
  eventId: string,
  eventDetails: {
    subject: string;
    startDateTime: string;
    endDateTime: string;
    locationName?: string | null;
    description?: string | null;
  }
): Promise<void> {
  const staffCalendarEmail = 'shared-staffcalendar@lawoffice.org.il';
  const encodedId = encodeURIComponent(eventId);
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(staffCalendarEmail)}/calendar/events/${encodedId}`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subject: eventDetails.subject,
      start: { dateTime: eventDetails.startDateTime, timeZone: tz },
      end: { dateTime: eventDetails.endDateTime, timeZone: tz },
      body: {
        contentType: 'text',
        content: eventDetails.description || '',
      },
      location: eventDetails.locationName
        ? { displayName: eventDetails.locationName }
        : undefined,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const err = new Error(
      `Failed to update staff calendar event: ${response.status} ${response.statusText} ${errorText}`
    );
    (err as Error & { status?: number }).status = response.status;
    throw err;
  }
}

export function isOutlookEventNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { status?: number }).status;
  if (status === 404) return true;
  const msg = error instanceof Error ? error.message : String(error);
  return /ErrorItemNotFound|not found in the store|404/i.test(msg);
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
  to: string | string[];
  subject: string;
  body: string;
  skipSignature?: boolean;
  cc?: string[];
  attachments?: Array<{
    name: string;
    contentBytes: string; // Base64 encoded content
    contentType?: string;
  }>;
}) => {
  // Get the user's email signature from the database
  const { getCurrentUserEmailSignature } = await import('./emailSignature');
  const userSignature = await getCurrentUserEmailSignature();
  
  let fullBody = email.body;
  
  // If we have a database signature, use it (unless explicitly skipped)
  if (!email.skipSignature && userSignature) {
    // Signature is already sanitized by getCurrentUserEmailSignature
    // Check if signature is already HTML
    if (userSignature.includes('<') && userSignature.includes('>')) {
      // Wrap signature in a div for better email client compatibility
      fullBody = email.body + `<div style="margin-top: 1em;">${userSignature}</div>`;
    } else {
      // Convert plain text to HTML
      const signatureHtml = `<div style="margin-top: 1em;">${userSignature.replace(/\n/g, '<br>')}</div>`;
      fullBody = email.body + signatureHtml;
    }
  }
  // If no database signature and not skipped, let Outlook add its automatic signature

  const normaliseRecipients = (value: string | string[] | undefined) => {
    if (!value) return [] as string[];
    if (Array.isArray(value)) {
      return value
        .map(recipient => recipient.trim())
        .filter(recipient => recipient.length > 0);
    }
    return value.trim().length > 0 ? [value.trim()] : [];
  };

  const toRecipients = normaliseRecipients(email.to);
  if (toRecipients.length === 0) {
    throw new Error('No recipient specified for the email.');
  }

  const ccRecipients = normaliseRecipients(email.cc);

  const emailToSend: any = {
    message: {
      subject: email.subject,
      body: {
        contentType: 'HTML',
        content: fullBody,
      },
      toRecipients: toRecipients.map(address => ({
        emailAddress: { address },
      })),
      ...(ccRecipients.length > 0
        ? {
            ccRecipients: ccRecipients.map(address => ({
              emailAddress: { address },
            })),
          }
        : {}),
      ...(email.attachments && email.attachments.length > 0
        ? {
            attachments: email.attachments.map(att => ({
              '@odata.type': '#microsoft.graph.fileAttachment',
              name: att.name,
              contentBytes: att.contentBytes,
              contentType: att.contentType || 'application/octet-stream',
            })),
          }
        : {}),
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
  // sendMail does not return content, a 202 Accepted status is success
  return { status: response.status };
};

/**
 * Creates a calendar event with attendees using Microsoft Graph API
 * This sends a proper calendar invitation that email clients recognize automatically
 */
export async function createCalendarEventWithAttendee(accessToken: string, eventDetails: {
  subject: string;
  startDateTime: string; // ISO string
  endDateTime: string;   // ISO string
  location?: string;
  description?: string;
  attendeeEmail: string;
  attendeeName?: string;
  organizerEmail?: string;
  organizerName?: string;
  teamsJoinUrl?: string;
  timeZone?: string;
}) {
  const {
    subject,
    startDateTime,
    endDateTime,
    location,
    description,
    attendeeEmail,
    attendeeName,
    organizerEmail,
    organizerName,
    teamsJoinUrl,
    timeZone = 'Asia/Jerusalem'
  } = eventDetails;

  // Graph interprets dateTime as local wall-clock for the given timeZone.
  // Never pass toISOString() (UTC/Z) with Asia/Jerusalem — that shifts the meeting.
  const normalizeGraphLocal = (value: string): string => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return trimmed;
    if (/Z$|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
      return formatLocalDateTimeForGraph(new Date(trimmed));
    }
    return trimmed.length >= 19 ? trimmed.slice(0, 19) : trimmed;
  };

  const localStart = normalizeGraphLocal(startDateTime);
  const localEnd = normalizeGraphLocal(endDateTime);

  const eventBody: any = {
    subject: subject,
    start: {
      dateTime: localStart,
      timeZone: timeZone
    },
    end: {
      dateTime: localEnd,
      timeZone: timeZone
    },
    attendees: [
      {
        emailAddress: {
          address: attendeeEmail,
          name: attendeeName || attendeeEmail
        },
        type: 'required'
      }
    ],
    body: {
      contentType: 'HTML',
      content: description || ''
    },
    ...(location ? { location: { displayName: location } } : {})
  };

  // Reuse an existing Teams join URL in the body only. Setting isOnlineMeeting here
  // would mint a *second* Teams meeting whose Join button disagrees with CRM/email.
  if (teamsJoinUrl) {
    if (description && !description.includes(teamsJoinUrl)) {
      eventBody.body.content += `<br><br><strong>Join Teams Meeting:</strong> <a href="${teamsJoinUrl}">${teamsJoinUrl}</a>`;
    }
  } else if (location?.toLowerCase().includes('teams')) {
    eventBody.isOnlineMeeting = true;
    eventBody.onlineMeetingProvider = 'teamsForBusiness';
  }

  const url = 'https://graph.microsoft.com/v1.0/me/calendar/events';
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(eventBody)
  });

  if (!response.ok) {
    const error = await response.json();
    console.error('Calendar event creation error:', error);
    throw new Error(error.error?.message || 'Failed to create calendar event');
  }

  const data = await response.json();
  let joinUrl = teamsJoinUrl || extractTeamsJoinUrlFromGraphPayload(data) || '';

  if (!joinUrl && eventBody.isOnlineMeeting) {
    const resolved = await resolveTeamsJoinUrlForEvent(accessToken, {
      calendarUserEmail: 'me',
      eventId: data.id,
      eventData: data,
      subject,
      startDateTime: localStart,
      endDateTime: localEnd,
    });
    joinUrl = resolved.joinUrl;
  }

  return {
    id: data.id,
    joinUrl,
    webLink: data.webLink
  };
} 