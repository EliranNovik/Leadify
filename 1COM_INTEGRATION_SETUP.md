# 1com Call Recording Integration Setup

This document explains how to set up the 1com call recording integration for the Leadify CRM system.

## Prerequisites

1. **1com PBX System**: You need access to a 1com PBX system
2. **API Key**: You need to generate an API key from your 1com Configuration/Settings page
3. **Tenant Name**: You need to know your tenant name (usually provided by 1com)

## Step 1: Get Your 1com API Key

1. Log into your 1com PBX system
2. Navigate to **Configuration/Settings**
3. Look for **API Key** or **Proxyapi** settings
4. Generate a new API key with **Read/Write** access (or at least **Read** access for recordings)
5. Note down your **tenant name** (usually something like "decker", "demo", etc.)

## Step 2: Configure Backend Environment

Add these environment variables to your backend `.env` file:

```bash
# 1com API Configuration
ONECOM_API_KEY=your_actual_api_key_here
ONECOM_TENANT=your_tenant_name_here
```

## Step 3: Test the API Key

You can test your API key using the 1com API directly:

```bash
# Test with curl (replace with your actual values)
curl "https://pbx6webserver.1com.co.il/pbx/proxyapi.php?key=YOUR_API_KEY&reqtype=INFO&info=CDRS&tenant=YOUR_TENANT&start=2024-01-01&end=2024-12-31"
```

## Step 4: Verify Call Logs Integration

1. Make sure your `call_logs` table has the correct `url` field populated with 1com recording URLs
2. The URLs should be in this format:
   ```
   https://pbx6webserver.1com.co.il/pbx/proxyapi.php?reqtype=INFO&info=playrecording&id=pbx24-1740917387.14030184&key=YOUR_KEY&tenant=YOUR_TENANT
   ```

## Step 5: Test Recording Playback

1. Start your backend server: `npm run dev` (from the backend directory)
2. Open the CRM system
3. Navigate to a client with call logs
4. Click on a call interaction
5. Click the "Play Recording" button
6. Check the browser console and backend logs for any errors

## Troubleshooting

### Common Issues

1. **"API key not configured" error**

   - Make sure `ONECOM_API_KEY` is set in your backend `.env` file
   - Restart your backend server after adding the environment variable

2. **"Recording not available" error**

   - Check if the call ID exists in the 1com system
   - Verify the tenant name is correct
   - Test the API key directly with curl

3. **CORS errors**

   - The backend proxy should handle CORS issues
   - Make sure your backend server is running and accessible

4. **Invalid recording URL format**
   - Check that the `url` field in `call_logs` contains the full 1com API URL
   - The URL should include `reqtype=INFO&info=playrecording&id=CALL_ID`

### Debug Information

Check the backend logs for these messages:

- `🎵 Proxying call recording request for call ID: ...`
- `🎵 Constructed 1com URL: ...`
- `🎵 1com API response status: ...`

## API Documentation Reference

For more information about the 1com Proxyapi, see:

- [1com Proxyapi Documentation](https://pbx6webserver.1com.co.il/pbx/proxyapi.php?key=YOUR_KEY&reqtype=HELP)

### Key API Endpoints Used

- **Get Call Records**: `reqtype=INFO&info=CDRS`
- **Play Recording**: `reqtype=INFO&info=playrecording&id=CALL_ID`

## Security Notes

- Keep your API key secure and never commit it to version control
- Use environment variables for all sensitive configuration
- Consider using read-only API keys for production if you only need to play recordings
- Monitor API usage to avoid hitting rate limits
