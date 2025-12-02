# Email Webhook Troubleshooting Guide

## Recent Changes

I've added comprehensive logging and manual sync endpoints to help debug email fetching issues.

## Enhanced Logging

The webhook endpoints now log:

- **GET requests** (validation): Full request details including IP, User-Agent, query params
- **POST requests** (notifications): Full request details including headers, body structure, and notification count
- **Sync operations**: Detailed logs when emails are being synced, including counts of synced/inserted/skipped emails

## New Endpoints

### 1. Test Webhook Accessibility

```bash
curl https://leadify-crm-backend.onrender.com/api/graph/webhook/test
```

This verifies the webhook endpoint is accessible and shows the configured webhook URL.

### 2. Manual Sync All Mailboxes

```bash
curl -X POST https://leadify-crm-backend.onrender.com/api/graph/emails/sync-all
```

This manually triggers email sync for all connected mailboxes. Useful for:

- Testing if email fetching works at all
- Syncing emails immediately without waiting for webhook notifications
- Debugging sync issues

### 3. Manual Sync Single User

```bash
curl -X POST https://leadify-crm-backend.onrender.com/api/hook/graph/emails/sync \
  -H "Content-Type: application/json" \
  -d '{"userId": "YOUR_USER_ID"}'
```

### 4. Check Subscription Status

```bash
curl https://leadify-crm-backend.onrender.com/api/graph/subscriptions/status
```

Shows which mailboxes have active subscriptions and which are expired/missing.

## Troubleshooting Steps

### Step 1: Verify Webhook is Accessible

```bash
curl https://leadify-crm-backend.onrender.com/api/graph/webhook/test
```

Expected response:

```json
{
  "success": true,
  "message": "Graph webhook endpoint is accessible",
  "webhookUrl": "https://leadify-crm-backend.onrender.com/api/graph/webhook"
}
```

### Step 2: Check Subscription Status

```bash
curl https://leadify-crm-backend.onrender.com/api/graph/subscriptions/status
```

Look for:

- Active subscriptions (should show subscription IDs and expiry dates)
- Expired subscriptions (need to be renewed)
- Missing subscriptions (need to be created)

### Step 3: Test Manual Email Sync

```bash
curl -X POST https://leadify-crm-backend.onrender.com/api/graph/emails/sync-all
```

This will:

- Fetch emails for all connected mailboxes
- Show detailed logs in the backend console
- Return a summary of synced emails

If this works, email fetching is functional. The issue is likely with webhook notifications.

### Step 4: Check Backend Logs

After deploying, check your backend logs for:

- `🔍🔍🔍 GRAPH WEBHOOK GET REQUEST RECEIVED` - Shows Microsoft Graph is validating your webhook
- `📨📨📨 GRAPH WEBHOOK POST REQUEST RECEIVED` - Shows Microsoft Graph is sending notifications
- `📨 Graph webhook queued mailbox sync` - Shows notifications are being processed
- `🔄 Starting webhook-triggered sync` - Shows sync is starting
- `✅ Webhook sync completed` - Shows sync finished successfully

### Step 5: Verify Azure Configuration

1. **Check Webhook URL in Azure Portal**:

   - Go to Azure Portal → App Registrations → Your App
   - Check that the webhook URL matches: `https://leadify-crm-backend.onrender.com/api/graph/webhook`

2. **Check Subscriptions in Microsoft Graph**:
   - Subscriptions expire after 48 hours
   - They need to be renewed periodically
   - The system should auto-renew them, but you can manually refresh:
     ```bash
     curl -X POST https://leadify-crm-backend.onrender.com/api/graph/subscriptions/refresh
     ```

## Common Issues

### Issue 1: No Webhook Requests in Logs

**Symptoms**: No GET or POST requests to `/api/graph/webhook` in logs

**Possible Causes**:

- Webhook URL not configured in Azure/Microsoft Graph
- Subscriptions expired and not renewed
- Webhook URL not publicly accessible

**Solutions**:

1. Verify `GRAPH_WEBHOOK_NOTIFICATION_URL` is set in environment variables
2. Check Azure Portal to ensure webhook URL is registered
3. Manually refresh subscriptions: `POST /api/graph/subscriptions/refresh`
4. Test webhook accessibility: `GET /api/graph/webhook/test`

### Issue 2: Webhook Receives Requests But No Emails Synced

**Symptoms**: See webhook requests in logs but no email sync happens

**Possible Causes**:

- `clientState` missing from notifications (user ID not passed)
- Sync failing silently
- No emails to sync

**Solutions**:

1. Check logs for `⚠️ Graph notification missing clientState`
2. Check logs for `❌ Webhook sync failed`
3. Manually trigger sync to test: `POST /api/graph/emails/sync-all`

### Issue 3: Manual Sync Works But Webhook Doesn't

**Symptoms**: Manual sync fetches emails, but webhook notifications don't trigger sync

**Possible Causes**:

- Notification processing failing
- Debounce queue not flushing
- User ID mismatch

**Solutions**:

1. Check logs for notification processing errors
2. Verify `clientState` in notifications matches user IDs in database
3. Check notification service logs for queue flush errors

## Next Steps

1. **Deploy the updated backend** with enhanced logging
2. **Check logs** after deployment to see if webhook requests are coming in
3. **Test manual sync** to verify email fetching works
4. **Check subscription status** to see if subscriptions are active
5. **Review logs** to identify where the process is failing

## Monitoring

After deployment, monitor these log patterns:

- **Webhook validation**: Look for `🔍🔍🔍 GRAPH WEBHOOK GET REQUEST RECEIVED`
- **Webhook notifications**: Look for `📨📨📨 GRAPH WEBHOOK POST REQUEST RECEIVED`
- **Email sync**: Look for `📥 Initiating Graph sync` and `✅ Webhook sync completed`
- **Errors**: Look for `❌` prefixed messages
