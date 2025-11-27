import { supabase } from './supabase';

// VAPID public key - This should be generated and stored securely
// For production, you'll need to generate your own VAPID keys
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * Check if push notifications are supported
 */
export function isPushNotificationSupported(): boolean {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Check current notification permission status
 */
export async function getNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    return 'denied';
  }
  return Notification.permission;
}

/**
 * Request notification permission from user
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    throw new Error('This browser does not support notifications');
  }

  const permission = await Notification.requestPermission();
  return permission;
}

/**
 * Get or create push subscription
 */
export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushNotificationSupported()) {
    console.warn('Push notifications are not supported');
    return null;
  }

  // Check if VAPID key is configured
  if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.trim() === '') {
    console.error('VAPID public key is not configured. Please set VITE_VAPID_PUBLIC_KEY in your environment variables.');
    throw new Error('VAPID public key is not configured. Please contact your administrator.');
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      // Create new subscription
      try {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      } catch (subscribeError: any) {
        console.error('Error subscribing to push:', subscribeError);
        // Provide more specific error messages
        if (subscribeError.message?.includes('Invalid key')) {
          throw new Error('Invalid VAPID key. Please check your configuration.');
        } else if (subscribeError.message?.includes('permission')) {
          throw new Error('Notification permission is required. Please grant permission and try again.');
        } else {
          throw new Error(`Failed to create push subscription: ${subscribeError.message || 'Unknown error'}`);
        }
      }
    }

    return subscription;
  } catch (error: any) {
    console.error('Error getting push subscription:', error);
    // Re-throw with better error message
    throw error;
  }
}

/**
 * Unsubscribe from push notifications
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      await subscription.unsubscribe();
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error unsubscribing from push:', error);
    return false;
  }
}

/**
 * Save push subscription to database
 */
export async function savePushSubscription(
  subscription: PushSubscription
): Promise<boolean> {
  try {
    const subscriptionData: PushSubscriptionData = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: arrayBufferToBase64(subscription.getKey('p256dh')!),
        auth: arrayBufferToBase64(subscription.getKey('auth')!),
      },
    };

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.error('No user logged in');
      return false;
    }

    // Save subscription to database
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          user_id: user.id,
          endpoint: subscriptionData.endpoint,
          p256dh_key: subscriptionData.keys.p256dh,
          auth_key: subscriptionData.keys.auth,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,endpoint',
        }
      );

    if (error) {
      console.error('Error saving push subscription:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error saving push subscription:', error);
    return false;
  }
}

/**
 * Remove push subscription from database
 */
export async function removePushSubscription(
  endpoint: string
): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return false;
    }

    const { error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', user.id)
      .eq('endpoint', endpoint);

    if (error) {
      console.error('Error removing push subscription:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error removing push subscription:', error);
    return false;
  }
}

/**
 * Send a test notification
 */
export async function sendTestNotification(): Promise<void> {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    throw new Error('Notification permission not granted');
  }

  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification('Test Notification', {
    body: 'Push notifications are working!',
    icon: '/icon-192x192.png',
    badge: '/icon-72x72.png',
    tag: 'test-notification',
    vibrate: [200, 100, 200],
  });
}

/**
 * Convert VAPID key from base64 URL to Uint8Array
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

