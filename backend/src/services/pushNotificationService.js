const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('⚠️  Supabase credentials missing for push notifications service');
}

const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || process.env.VITE_VAPID_PRIVATE_KEY || '';
const VAPID_CONTACT_EMAIL = process.env.VAPID_CONTACT_EMAIL || 'support@rmq-crm.app';

let vapidConfigured = false;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(
      `mailto:${VAPID_CONTACT_EMAIL}`,
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );
    vapidConfigured = true;
    console.log('✅ Push notification service configured with VAPID keys');
  } catch (error) {
    console.error('❌ Failed to configure VAPID keys for push notifications:', error);
  }
} else {
  console.warn('⚠️  VAPID keys not configured. Push notifications will not work.');
}

// Get frontend URL from environment or default
const FRONTEND_URL = process.env.FRONTEND_URL || process.env.VITE_FRONTEND_URL || 'https://rmq-crm.app';

/**
 * Convert relative icon path to absolute URL
 * Push notifications require absolute URLs for icons
 */
const getAbsoluteIconUrl = (iconPath) => {
  if (!iconPath) {
    return `${FRONTEND_URL}/icon-192x192.png`;
  }
  
  // If already an absolute URL, return as-is
  if (iconPath.startsWith('http://') || iconPath.startsWith('https://')) {
    return iconPath;
  }
  
  // Convert relative path to absolute URL
  const baseUrl = FRONTEND_URL.replace(/\/$/, ''); // Remove trailing slash
  const iconUrl = iconPath.startsWith('/') ? iconPath : `/${iconPath}`;
  
  return `${baseUrl}${iconUrl}`;
};

const buildNotificationPayload = (payload = {}) => ({
  title: payload.title || 'RMQ 2.0',
  body: payload.body || 'You have a new notification',
  icon: getAbsoluteIconUrl(payload.icon) || `${FRONTEND_URL}/icon-192x192.png`,
  badge: getAbsoluteIconUrl(payload.badge) || `${FRONTEND_URL}/icon-72x72.png`,
  tag: payload.tag || 'rmq-notification',
  data: {
    url: payload.url || '/',
    type: payload.type || 'notification',
    id: payload.id || null,
  },
  vibrate: payload.vibrate || [200, 100, 200],
  requireInteraction: payload.requireInteraction || false,
  silent: payload.silent || false,
});

const fetchSubscriptions = async (filter = {}) => {
  if (!supabase) {
    throw new Error('Supabase client not configured');
  }

  let query = supabase
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh_key, auth_key');

  if (filter.userId) {
    query = query.eq('user_id', filter.userId);
    console.log(`🔍 Querying push subscriptions for user_id: ${filter.userId}`);
  } else {
    console.log(`🔍 Querying all push subscriptions`);
  }

  const { data, error } = await query;

  if (error) {
    console.error(`❌ Error fetching push subscriptions:`, error);
    throw new Error(error.message || 'Failed to fetch push subscriptions');
  }

  const count = data ? data.length : 0;
  if (filter.userId) {
    console.log(`📋 Found ${count} push subscription(s) for user ${filter.userId}`);
  } else {
    console.log(`📋 Found ${count} total push subscription(s)`);
  }

  return data || [];
};

const deleteSubscription = async (endpoint) => {
  if (!supabase) return;
  await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint);
};

const sendNotificationToSubscriptions = async (subscriptions = [], payload = {}) => {
  if (!vapidConfigured) {
    throw new Error('VAPID keys not configured on server');
  }

  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    return { sent: 0, total: 0 };
  }

  const notificationPayload = JSON.stringify(buildNotificationPayload(payload));

  const results = await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      const pushSubscription = {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh_key,
          auth: subscription.auth_key,
        },
      };

      try {
        await webpush.sendNotification(pushSubscription, notificationPayload);
        return { success: true, endpoint: subscription.endpoint, userId: subscription.user_id };
      } catch (error) {
        console.error('❌ Error sending push notification:', error);
        // Remove invalid subscriptions
        if (error.statusCode === 410 || error.statusCode === 404) {
          await deleteSubscription(subscription.endpoint);
        }
        return { success: false, endpoint: subscription.endpoint, error: error.message };
      }
    })
  );

  const sent = results.filter(result => result.status === 'fulfilled' && result.value.success).length;
  return {
    sent,
    total: subscriptions.length,
    results: results.map(result => result.status === 'fulfilled' ? result.value : { success: false, error: result.reason }),
  };
};

const sendNotificationToUser = async (userId, payload = {}) => {
  if (!userId) {
    throw new Error('Missing userId for push notification');
  }

  console.log(`📤 Attempting to send push notification to user: ${userId}`);
  const subscriptions = await fetchSubscriptions({ userId });
  
  if (subscriptions.length === 0) {
    console.warn(`⚠️ No push subscriptions found for user ${userId}. User may need to enable push notifications in settings.`);
    return { success: true, sent: 0, total: 0, message: 'No push subscriptions for user' };
  }

  console.log(`✅ Found ${subscriptions.length} subscription(s) for user ${userId}, sending notifications...`);
  const result = await sendNotificationToSubscriptions(subscriptions, payload);
  console.log(`📱 Notification send result for user ${userId}:`, {
    sent: result.sent,
    total: result.total,
    success: result.sent > 0
  });
  
  return {
    success: true,
    ...result,
  };
};

const sendNotificationToAll = async (payload = {}) => {
  const subscriptions = await fetchSubscriptions();
  if (subscriptions.length === 0) {
    return { success: true, sent: 0, total: 0, message: 'No push subscriptions found' };
  }

  const result = await sendNotificationToSubscriptions(subscriptions, payload);
  return {
    success: true,
    ...result,
  };
};

module.exports = {
  sendNotificationToUser,
  sendNotificationToAll,
};

