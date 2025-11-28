import { supabase } from './supabase';

// VAPID public key - This should be generated and stored securely
// For production, you'll need to generate your own VAPID keys
const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY || '').trim();

// Log for debugging (only first 20 chars for security)
if (VAPID_PUBLIC_KEY) {
  console.log('✅ VAPID public key loaded:', `${VAPID_PUBLIC_KEY.substring(0, 20)}... (length: ${VAPID_PUBLIC_KEY.length})`);
} else {
  console.warn('⚠️  VAPID public key not found. Set VITE_VAPID_PUBLIC_KEY in your .env file');
}

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
    throw new Error('VAPID public key is not configured. Please set VITE_VAPID_PUBLIC_KEY in your environment variables.');
  }

  // Validate VAPID key format (should be base64 URL encoded, typically 87 characters)
  if (VAPID_PUBLIC_KEY.length < 80 || VAPID_PUBLIC_KEY.length > 100) {
    console.error('VAPID public key appears to be invalid length:', VAPID_PUBLIC_KEY.length);
    throw new Error('Invalid VAPID public key format. Please check your VITE_VAPID_PUBLIC_KEY.');
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      // Create new subscription
      try {
        // Convert VAPID key to Uint8Array
        const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
        
        // Validate the converted key (should be 65 bytes for P256)
        if (applicationServerKey.length !== 65) {
          console.error('Invalid VAPID key length after conversion:', applicationServerKey.length, 'Expected: 65');
          throw new Error('Invalid VAPID public key. The key must be a valid P256 public key.');
        }

        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey,
        });
      } catch (subscribeError: any) {
        console.error('Error subscribing to push:', subscribeError);
        console.error('VAPID_PUBLIC_KEY value:', VAPID_PUBLIC_KEY ? `${VAPID_PUBLIC_KEY.substring(0, 20)}...` : 'empty');
        
        // Provide more specific error messages
        if (subscribeError.message?.includes('Invalid key') || subscribeError.message?.includes('P256')) {
          throw new Error('Invalid VAPID public key. Please check that VITE_VAPID_PUBLIC_KEY is set correctly in your .env file.');
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
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) {
      console.error('Error getting user:', userError);
      throw new Error(`Authentication error: ${userError.message}`);
    }
    
    if (!user) {
      console.error('No user logged in');
      throw new Error('You must be logged in to enable push notifications');
    }

    console.log('💾 Saving push subscription:', {
      userId: user.id,
      endpoint: subscriptionData.endpoint.substring(0, 50) + '...',
      hasKeys: !!subscriptionData.keys.p256dh && !!subscriptionData.keys.auth
    });

    // Save subscription to database
    const { data, error } = await supabase
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
      )
      .select();

    if (error) {
      console.error('❌ Error saving push subscription:', error);
      console.error('Error details:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      
      // Provide more specific error messages
      if (error.code === '42P01') {
        throw new Error('Push subscriptions table does not exist. Please run the database migration.');
      } else if (error.code === '42501') {
        throw new Error('Permission denied. Please check database permissions.');
      } else if (error.message?.includes('violates foreign key')) {
        throw new Error('Invalid user ID. Please log out and log back in.');
      } else {
        throw new Error(`Database error: ${error.message || 'Unknown error'}`);
      }
    }

    console.log('✅ Push subscription saved successfully:', data);
    return true;
  } catch (error: any) {
    console.error('❌ Error saving push subscription:', error);
    // Re-throw with the error message so it can be displayed to the user
    throw error;
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
  if (!base64String || typeof base64String !== 'string') {
    throw new Error('VAPID key must be a non-empty string');
  }

  try {
    // Remove any whitespace
    const cleaned = base64String.trim();
    
    // Add padding if needed
    const padding = '='.repeat((4 - (cleaned.length % 4)) % 4);
    
    // Convert URL-safe base64 to standard base64
    const base64 = (cleaned + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    // Decode base64
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    
    return outputArray;
  } catch (error) {
    console.error('Error converting VAPID key:', error);
    throw new Error(`Invalid VAPID key format: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
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

