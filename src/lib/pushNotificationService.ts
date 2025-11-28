import { supabase } from './supabase';

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  url?: string;
  type?: 'notification' | 'celebration' | 'lead' | 'meeting' | 'agreement';
  id?: string | number;
  vibrate?: number[];
  requireInteraction?: boolean;
  silent?: boolean;
  sound?: string;
}

/**
 * Send push notification to user
 * Calls the Node.js backend API to send push notifications
 */
export async function sendPushNotification(
  userId: string,
  payload: PushNotificationPayload
): Promise<boolean> {
  try {
    // Get backend URL from environment
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
    const apiUrl = `${backendUrl}/api/push/send`;

    // Call backend endpoint to send push notification
    // The backend will fetch the user's subscriptions and send to all devices
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId,
        payload,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('Error sending push notification:', errorData);
      return false;
    }

    const result = await response.json();
    return result.success === true;
  } catch (error) {
    console.error('Error sending push notification:', error);
    return false;
  }
}

/**
 * Send push notification for bell icon notifications
 */
export async function sendBellNotification(
  userId: string,
  notification: {
    id: string;
    title: string;
    body: string;
    url?: string;
    icon?: string;
  }
): Promise<void> {
  await sendPushNotification(userId, {
    title: notification.title,
    body: notification.body,
    icon: notification.icon || '/icon-192x192.png',
    badge: '/icon-72x72.png',
    tag: `notification-${notification.id}`,
    url: notification.url || '/',
    type: 'notification',
    id: notification.id,
    vibrate: [200, 100, 200],
  });
}

/**
 * Send push notification for signed agreement celebration
 */
export async function sendAgreementCelebrationNotification(
  userId: string,
  employeeName: string,
  employeeId: number | null
): Promise<void> {
  await sendPushNotification(userId, {
    title: '🎉 Agreement Signed!',
    body: `${employeeName} has signed an agreement!`,
    icon: '/icon-192x192.png',
    badge: '/icon-72x72.png',
    tag: `celebration-${employeeId || Date.now()}`,
    url: '/dashboard',
    type: 'celebration',
    id: employeeId,
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: false,
  });
}

/**
 * Send push notification for new lead
 */
export async function sendNewLeadNotification(
  userId: string,
  lead: {
    id: string;
    name: string;
    lead_number: string;
  }
): Promise<void> {
  await sendPushNotification(userId, {
    title: '🆕 New Lead',
    body: `New lead: ${lead.name} (${lead.lead_number})`,
    icon: '/icon-192x192.png',
    badge: '/icon-72x72.png',
    tag: `lead-${lead.id}`,
    url: `/clients/${lead.lead_number}`,
    type: 'lead',
    id: lead.id,
    vibrate: [200, 100, 200],
  });
}

/**
 * Send push notification for meeting reminder
 */
export async function sendMeetingReminderNotification(
  userId: string,
  meeting: {
    id: string;
    title: string;
    date: string;
    time: string;
  }
): Promise<void> {
  await sendPushNotification(userId, {
    title: '📅 Meeting Reminder',
    body: `${meeting.title} - ${meeting.date} at ${meeting.time}`,
    icon: '/icon-192x192.png',
    badge: '/icon-72x72.png',
    tag: `meeting-${meeting.id}`,
    url: '/calendar',
    type: 'meeting',
    id: meeting.id,
    vibrate: [200, 100, 200],
  });
}

