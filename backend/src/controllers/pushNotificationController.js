const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Configure VAPID keys
// Support both VAPID_* and VITE_VAPID_* for flexibility
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || process.env.VITE_VAPID_PRIVATE_KEY;

// Contact email for VAPID (should be your support/contact email)
const VAPID_CONTACT_EMAIL = process.env.VAPID_CONTACT_EMAIL || 'support@yourdomain.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${VAPID_CONTACT_EMAIL}`,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
  console.log('✅ VAPID keys configured for push notifications');
} else {
  console.warn('⚠️  VAPID keys not configured. Push notifications will not work.');
  console.warn('   Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in your .env file');
}

/**
 * Send push notification to a user
 * POST /api/push/send
 * Body: { userId: string, payload: { title, body, icon, badge, url, etc. } }
 */
const sendPushNotification = async (req, res) => {
  try {
    const { userId, payload } = req.body;

    if (!userId || !payload) {
      return res.status(400).json({
        success: false,
        error: 'Missing userId or payload'
      });
    }

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return res.status(500).json({
        success: false,
        error: 'VAPID keys not configured on server'
      });
    }

    // Fetch user's push subscriptions from database
    const { data: subscriptions, error } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh_key, auth_key')
      .eq('user_id', userId);

    if (error) {
      console.error('Error fetching push subscriptions:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch push subscriptions'
      });
    }

    if (!subscriptions || subscriptions.length === 0) {
      return res.status(200).json({
        success: true,
        sent: 0,
        total: 0,
        message: 'No push subscriptions found for user'
      });
    }

    // Prepare notification payload
    const notificationPayload = JSON.stringify({
      title: payload.title || 'RMQ 2.0',
      body: payload.body || 'You have a new notification',
      icon: payload.icon || '/icon-192x192.png',
      badge: payload.badge || '/icon-72x72.png',
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

    // Send notification to all subscriptions
    const sendPromises = subscriptions.map(async (subscription) => {
      try {
        const pushSubscription = {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh_key,
            auth: subscription.auth_key,
          }
        };

        await webpush.sendNotification(pushSubscription, notificationPayload);
        return { success: true, endpoint: subscription.endpoint };
      } catch (error) {
        console.error('Error sending push notification to subscription:', error);
        // If subscription is invalid, remove it from database
        if (error.statusCode === 410 || error.statusCode === 404) {
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', subscription.endpoint);
        }
        return { success: false, endpoint: subscription.endpoint, error: error.message };
      }
    });

    const results = await Promise.allSettled(sendPromises);
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;

    return res.status(200).json({
      success: true,
      sent: successCount,
      total: subscriptions.length,
      results: results.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason })
    });
  } catch (error) {
    console.error('Error in sendPushNotification:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to send push notification'
    });
  }
};

module.exports = {
  sendPushNotification,
};

