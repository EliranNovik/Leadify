# Push Notifications Setup Guide

This guide explains how to set up push notifications for the RMQ 2.0 PWA on both iOS and Android.

## Overview

Push notifications are now integrated into the application for:
- **Bell icon notifications** (WhatsApp messages, RMQ messages, email leads)
- **Signed agreement celebrations** (when a client signs an agreement)

## Prerequisites

1. **VAPID Keys**: You need to generate VAPID (Voluntary Application Server Identification) keys for web push notifications.

### Generating VAPID Keys

You can generate VAPID keys using Node.js:

```bash
npm install -g web-push
web-push generate-vapid-keys
```

This will output:
- **Public Key**: Use this as `VITE_VAPID_PUBLIC_KEY` in your frontend `.env`
- **Private Key**: Use this as `VAPID_PRIVATE_KEY` in your Supabase Edge Function secrets

## Setup Steps

### 1. Database Setup

Run the SQL migration to create the `push_subscriptions` table:

```bash
# Execute the SQL file in your Supabase SQL editor
sql/create_push_subscriptions_table.sql
```

### 2. Frontend Environment Variables

Add to your `.env` file:

```env
VITE_VAPID_PUBLIC_KEY=your_vapid_public_key_here
```

### 3. Supabase Edge Function Setup

1. **Deploy the Edge Function**:
   ```bash
   supabase functions deploy send-push-notification
   ```

2. **Set Environment Variables**:
   ```bash
   supabase secrets set VAPID_PUBLIC_KEY=your_vapid_public_key
   supabase secrets set VAPID_PRIVATE_KEY=your_vapid_private_key
   ```

### 4. User Setup

Users can enable push notifications in the Settings page:
1. Go to **Settings** → **Notifications** tab
2. Toggle **Push Notifications** to ON
3. Grant permission when prompted by the browser
4. Test with the "Send Test Notification" button

## How It Works

### Frontend Flow

1. **Permission Request**: When user toggles push notifications ON, the app requests browser permission
2. **Subscription**: If granted, the app creates a push subscription using the VAPID public key
3. **Storage**: The subscription is saved to the `push_subscriptions` table in Supabase
4. **Service Worker**: The service worker (`public/sw.js`) handles incoming push notifications

### Backend Flow

1. **Notification Trigger**: When an event occurs (new message, signed agreement), the frontend calls the `send-push-notification` Edge Function
2. **Subscription Lookup**: The function fetches all push subscriptions for the target user
3. **Notification Delivery**: The function sends push notifications to all of the user's devices using the Web Push API

## iOS Specific Notes

iOS Safari requires additional setup for push notifications:

1. **Apple Developer Account**: You need an Apple Developer account
2. **APNs Certificate**: Generate an Apple Push Notification service (APNs) certificate
3. **Service Worker**: iOS 16.4+ supports web push notifications through service workers

For iOS, users must:
- Add the PWA to their home screen
- Grant notification permissions when prompted
- Keep the app installed (not just bookmarked)

## Android Specific Notes

Android Chrome/Edge fully supports web push notifications:
- Works in both browser and installed PWA
- No additional setup required beyond VAPID keys
- Supports rich notifications with icons, badges, and actions

## Testing

### Test Push Notifications

1. Enable push notifications in Settings
2. Click "Send Test Notification" button
3. You should receive a notification on your device

### Test Bell Icon Notifications

1. Enable push notifications
2. Receive a new WhatsApp message or RMQ message
3. You should receive a push notification even if the app is in the background

### Test Celebration Notifications

1. Enable push notifications
2. Sign an agreement (stage 60)
3. You should receive a celebration push notification

## Troubleshooting

### Notifications Not Appearing

1. **Check Permissions**: Ensure browser notification permission is granted
2. **Check Service Worker**: Verify service worker is registered and active
3. **Check Subscription**: Verify subscription exists in `push_subscriptions` table
4. **Check VAPID Keys**: Ensure VAPID keys are correctly set in both frontend and backend

### iOS Notifications Not Working

1. **iOS Version**: Ensure iOS 16.4 or later
2. **PWA Installation**: App must be added to home screen
3. **Safari Settings**: Check Safari → Settings → Websites → Notifications

### Android Notifications Not Working

1. **Browser**: Ensure using Chrome or Edge (not Firefox)
2. **Permissions**: Check browser notification permissions
3. **Service Worker**: Verify service worker is active

## Security Considerations

- **VAPID Keys**: Keep private key secure, never expose in frontend code
- **User Privacy**: Only send notifications to users who have explicitly enabled them
- **Subscription Management**: Users can disable notifications at any time in Settings

## Files Modified/Created

### New Files
- `src/lib/pushNotifications.ts` - Push notification utilities
- `src/lib/pushNotificationService.ts` - Service for sending notifications
- `src/hooks/usePushNotifications.ts` - React hook for push notifications
- `sql/create_push_subscriptions_table.sql` - Database schema
- `supabase/functions/send-push-notification/index.ts` - Edge function

### Modified Files
- `src/pages/SettingsPage.tsx` - Added push notification toggle
- `src/components/Header.tsx` - Integrated push notifications for bell icon
- `src/contexts/CelebrationContext.tsx` - Integrated push notifications for celebrations
- `public/sw.js` - Enhanced push notification handling

## Next Steps

1. Generate VAPID keys
2. Run database migration
3. Set environment variables
4. Deploy Edge Function
5. Test with users

For production, consider:
- Setting up monitoring for notification delivery rates
- Implementing notification preferences (types of notifications to receive)
- Adding notification history/logging

