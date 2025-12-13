# OneCom Webhook Setup Guide

This guide explains how to configure OneCom PBX to automatically send call logs to the CRM via webhook.

## Overview

Instead of manually syncing call logs, OneCom can be configured to automatically POST call log data to the CRM when calls are completed. This ensures real-time call log synchronization.

## Webhook Endpoint

**URL:** `https://leadify-crm-backend.onrender.com/api/onecom/webhook`

**Method:** POST

**Content-Type:** application/json

## OneCom PBX Configuration

### Step 1: Access OneCom Admin Panel

1. Log into your OneCom PBX admin panel
2. Navigate to **Configuration → Webhooks** (or similar section)
3. Look for webhook/CDR (Call Detail Record) forwarding options

### Step 2: Configure Webhook

1. **Webhook URL:** 
   ```
   https://leadify-crm-backend.onrender.com/api/onecom/webhook
   ```

2. **HTTP Method:** Select `POST`

3. **Content-Type:** `application/json`

4. **Event Type:** Select "CDR" or "Call Complete" events

5. **Data Format:** The webhook should send JSON data with the following structure:
   ```json
   {
     "uniqueid": "1234567890.123",
     "call_id": "1234567890",
     "start": "2024-01-15 10:30:00",
     "src": "101",
     "realsrc": "101",
     "dst": "0501234567",
     "lastdst": "0501234567",
     "clid": "\"Name\" <0501234567>",
     "duration": 120,
     "disposition": "ANSWERED",
     "dcontext": "from-outside"
   }
   ```

   Or for batch format:
   ```json
   [
     {
       "uniqueid": "1234567890.123",
       "call_id": "1234567890",
       ...
     },
     {
       "uniqueid": "1234567891.124",
       ...
     }
   ]
   ```

### Step 3: Test Webhook

1. Make a test call through the PBX
2. Check backend logs to verify webhook is received
3. Check the database to confirm call log was saved

## Webhook Endpoint Features

### Automatic Processing

- ✅ Receives call logs in real-time
- ✅ Checks for duplicates (prevents duplicate entries)
- ✅ Automatically maps to employees and leads
- ✅ Saves to database immediately
- ✅ Returns 202 Accepted immediately (non-blocking)

### Error Handling

- Logs all webhook requests for debugging
- Handles both single and batch formats
- Continues processing even if individual records fail
- Detailed error logging for troubleshooting

## Testing the Webhook

### Manual Test

You can test the webhook endpoint manually using curl:

```bash
curl -X POST https://leadify-crm-backend.onrender.com/api/onecom/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "uniqueid": "1234567890.123",
    "call_id": "1234567890",
    "start": "2024-01-15 10:30:00",
    "src": "101",
    "dst": "0501234567",
    "duration": 120,
    "disposition": "ANSWERED"
  }'
```

### Verify Webhook Status

Visit: `GET https://leadify-crm-backend.onrender.com/api/onecom/webhook`

This will return webhook configuration information and setup instructions.

## Troubleshooting

### Webhook Not Received

1. Check OneCom webhook configuration
2. Verify webhook URL is accessible from OneCom servers
3. Check backend logs for incoming requests
4. Verify firewall/security settings allow OneCom IPs

### Call Logs Not Saved

1. Check backend logs for processing errors
2. Verify database connection
3. Check that call log format matches expected structure
4. Look for duplicate detection messages (existing records are skipped)

### Webhook Format Issues

If OneCom sends data in a different format, you may need to adjust the webhook handler in `backend/src/routes/onecomRoutes.js` to transform the data before processing.

## Manual Sync (Fallback)

If webhook is not available or fails, you can still use manual sync:

- **Sync Today:** `POST /api/onecom/sync/today`
- **Sync Date Range:** `POST /api/onecom/sync` with `startDate` and `endDate`
- **Sync Last Week:** `POST /api/onecom/sync/last-week`

Manual sync is still useful for:
- Historical data import
- Backfilling missing records
- One-time bulk imports

## Security Considerations

1. **IP Whitelisting:** Consider restricting webhook endpoint to OneCom IP addresses
2. **Authentication:** Add API key or token validation if OneCom supports it
3. **HTTPS:** Always use HTTPS for webhook endpoint
4. **Rate Limiting:** Consider adding rate limiting if needed

## Support

For issues or questions:
1. Check backend logs in `/api/onecom/webhook` endpoint
2. Verify OneCom webhook configuration
3. Test webhook manually using curl
4. Check database for saved records

