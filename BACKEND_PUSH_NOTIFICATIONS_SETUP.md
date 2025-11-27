# Backend Push Notifications Setup

## Overview

Push notifications are sent through your **Node.js backend** (deployed on Render), not Supabase Edge Functions.

## Step 1: Install Dependencies

In your `backend/` directory:

```bash
cd backend
npm install web-push
```

## Step 2: Configure VAPID Keys in Backend

Add to your `backend/.env` file:

```env
# VAPID Keys for Push Notifications
VAPID_PUBLIC_KEY=your_public_key_here
VAPID_PRIVATE_KEY=your_private_key_here
VAPID_CONTACT_EMAIL=support@yourdomain.com  # Optional, defaults to support@yourdomain.com
```

**Note**: You can use either `VAPID_*` or `VITE_VAPID_*` prefix - the code supports both.

## Step 3: Configure Frontend

Add to your frontend `.env.local` or `.env` file (in project root, not backend/):

```env
VITE_VAPID_PUBLIC_KEY=your_public_key_here
VITE_BACKEND_URL=https://your-render-backend.onrender.com
```

## Step 4: Deploy Backend

After adding the VAPID keys to your backend `.env`:

1. **If using Render**: Add the environment variables in Render dashboard:
   - Go to your Render service
   - Settings → Environment
   - Add:
     - `VAPID_PUBLIC_KEY`
     - `VAPID_PRIVATE_KEY`
     - `VAPID_CONTACT_EMAIL` (optional)

2. **Redeploy** your backend service

## Step 5: Test

1. Restart your frontend dev server (to load `VITE_VAPID_PUBLIC_KEY`)
2. Go to Settings → Notifications
3. Toggle "Push Notifications" ON
4. Grant permission
5. You should see "Push notifications enabled!" instead of an error

## API Endpoint

The backend exposes:

**POST** `/api/push/send`

Request body:
```json
{
  "userId": "user-uuid-here",
  "payload": {
    "title": "Notification Title",
    "body": "Notification body text",
    "icon": "/icon-192x192.png",
    "badge": "/icon-72x72.png",
    "url": "/dashboard",
    "type": "notification",
    "id": "123",
    "vibrate": [200, 100, 200]
  }
}
```

Response:
```json
{
  "success": true,
  "sent": 1,
  "total": 1
}
```

## How It Works

1. **Frontend**: User enables push notifications → Creates subscription → Saves to `push_subscriptions` table
2. **Frontend**: When notification needs to be sent → Calls `POST /api/push/send` on your backend
3. **Backend**: Fetches user's subscriptions from database → Sends push notification to all devices using `web-push` library

## Troubleshooting

### Error: "VAPID keys not configured on server"
- Make sure `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are in your backend `.env`
- If using Render, add them as environment variables in the dashboard
- Restart/redeploy your backend

### Error: "Failed to set up push notifications"
- Check browser console for specific error
- Make sure `VITE_VAPID_PUBLIC_KEY` is in frontend `.env`
- Restart frontend dev server after adding the key

### Notifications not being sent
- Check backend logs for errors
- Verify subscriptions exist in `push_subscriptions` table
- Check that backend can access Supabase (for reading subscriptions)

