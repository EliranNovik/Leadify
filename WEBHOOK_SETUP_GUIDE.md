# Graph Webhook Setup Guide

## Current Configuration

✅ **Webhook URL**: `https://leadify-crm-backend.onrender.com/api/graph/webhook`
✅ **Environment Variable**: `GRAPH_WEBHOOK_NOTIFICATION_URL` is set

## How It Works

1. **Subscription Creation**: When a user syncs their mailbox, the system automatically creates a Microsoft Graph subscription pointing to your webhook URL
2. **Webhook Validation**: Microsoft Graph validates the webhook by sending a GET request with a validation token
3. **Notifications**: When emails change, Microsoft Graph sends POST requests to your webhook
4. **Email Sync**: The webhook triggers an email sync for the affected user

## Testing Your Setup

### 1. Verify Webhook Endpoint is Accessible

Test the webhook validation endpoint:

```bash
curl "https://leadify-crm-backend.onrender.com/api/graph/webhook?validationtoken=test123"
```

Expected response: `test123` (the validation token echoed back)

### 2. Check Subscription Status

```bash
curl https://leadify-crm-backend.onrender.com/api/graph/subscriptions/status
```

This will show:

- Which mailboxes have active subscriptions
- Which subscriptions are expired or missing
- The webhook URL configuration

### 3. Refresh All Subscriptions

To create/renew subscriptions for all connected mailboxes:

```bash
curl -X POST https://leadify-crm-backend.onrender.com/api/graph/subscriptions/refresh
```

### 4. Trigger a Manual Sync (This Will Also Create Subscriptions)

When a user manually syncs their mailbox or when the system syncs, subscriptions are automatically created/renewed.

## Important Notes

1. **Subscriptions Expire**: Graph subscriptions expire after 48 hours. The system automatically renews them when:

   - A user syncs their mailbox
   - You call the refresh endpoint
   - A subscription is about to expire (within 24 hours)

2. **Webhook URL Must Be Public**: Your webhook URL (`https://leadify-crm-backend.onrender.com/api/graph/webhook`) must be publicly accessible. Microsoft Graph cannot reach localhost URLs.

3. **Azure Redirect URIs**: The webhook URL does NOT need to be in Azure's Redirect URIs. Those are only for OAuth authentication flows.

## Troubleshooting

### Webhook Not Receiving Notifications

1. **Check subscription status**:

   ```bash
   curl https://leadify-crm-backend.onrender.com/api/graph/subscriptions/status
   ```

2. **Verify subscriptions exist**: If subscriptions are missing or expired, refresh them:

   ```bash
   curl -X POST https://leadify-crm-backend.onrender.com/api/graph/subscriptions/refresh
   ```

3. **Check server logs**: Look for webhook notification logs when emails arrive. You should see:

   ```
   📨 Graph webhook notification received: ...
   ✅ Processing Graph webhook notification for user ...
   ```

4. **Verify webhook URL is correct**: Make sure `GRAPH_WEBHOOK_NOTIFICATION_URL` matches your actual deployed backend URL.

### Subscriptions Not Being Created

- Ensure users have connected their mailboxes (OAuth flow completed)
- Check that `GRAPH_WEBHOOK_NOTIFICATION_URL` is set in your environment variables
- Verify the backend server logs show the webhook URL is configured on startup

## Next Steps

1. **Restart your backend server** to ensure the environment variable is loaded
2. **Check startup logs** - you should see: `✅ Graph webhook URL configured: https://leadify-crm-backend.onrender.com/api/graph/webhook`
3. **Refresh subscriptions** for all users: `POST /api/graph/subscriptions/refresh`
4. **Monitor logs** - when emails arrive, you should see webhook notifications in your server logs
