# Zero-Click Meeting Summary Setup Guide

## Overview

This guide provides step-by-step instructions to set up the complete "zero-click" meeting summary workflow. Once configured, the system will automatically:

1. **Detect when Teams meetings end** via Microsoft Graph webhooks
2. **Fetch transcripts automatically** from Teams
3. **Generate bilingual summaries** using OpenAI
4. **Extract genealogical data** and persecution details
5. **Display results** in the client's meeting tab

## Prerequisites

- ✅ Supabase project with Edge Functions enabled
- ✅ Microsoft 365 tenant with Teams
- ✅ Azure AD app registration (see `MICROSOFT_GRAPH_SETUP.md`)
- ✅ OpenAI API key
- ✅ Teams transcription enabled

## Step 1: Environment Variables

Set these environment variables in your Supabase project:

### Required Variables

```bash
# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key

# Azure AD Configuration (from MICROSOFT_GRAPH_SETUP.md)
AZURE_CLIENT_ID=your_azure_app_client_id
AZURE_CLIENT_SECRET=your_azure_app_client_secret
AZURE_TENANT_ID=your_azure_tenant_id

# Webhook Configuration
GRAPH_WEBHOOK_URL=https://your-project.supabase.co/functions/v1/graph-webhook
GRAPH_WEBHOOK_CLIENT_STATE=leadify-crm-webhook-secret-2024

# Supabase Configuration (usually auto-set)
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Optional Variables

```bash
# Custom webhook client state (if you want to change the default)
GRAPH_WEBHOOK_CLIENT_STATE=your-custom-secret

# Custom webhook URL (if different from default)
GRAPH_WEBHOOK_URL=https://your-custom-domain.com/webhook
```

## Step 2: Deploy Edge Functions

Deploy the required Edge Functions to Supabase:

```bash
# Deploy the webhook endpoint
supabase functions deploy graph-webhook

# Deploy the subscription manager
supabase functions deploy graph-subscription-manager

# Deploy the meeting summary processor
supabase functions deploy meeting-summary
```

## Step 3: Database Setup

Run the SQL script to create the required tables:

```bash
# Execute the SQL file
psql -d your_database -f sql/create_meeting_summary_tables.sql
```

Or run it in the Supabase SQL editor.

## Step 4: Azure AD App Configuration

Follow the detailed guide in `MICROSOFT_GRAPH_SETUP.md` to:

1. **Create Azure AD application**
2. **Configure API permissions**:
   - `OnlineMeetingArtifact.Read.All` (Application)
   - `Files.Read.All` (Application)
   - `User.Read.All` (Application)
   - `Calendars.Read.All` (Application)
3. **Grant admin consent**
4. **Create client secret**

## Step 5: Teams Configuration

### Enable Transcription

1. Go to **Microsoft Teams Admin Center**
2. Navigate to **Meetings** → **Meeting policies**
3. Enable **Allow transcription**
4. Set **Who can start transcription** to **Organizer and coorganizers**

### Meeting Template (Optional)

Create a Teams meeting template named "Client Call (Auto-Summary)" with:

- Transcription enabled by default
- Subject pattern: `[#CLIENTID] Client Name – Topic`

## Step 6: Create Graph Subscription

### Option A: Using the Admin UI

1. Navigate to the admin page in your application
2. Go to **Graph Subscription Manager**
3. Click **Create Subscription**
4. Verify the subscription is active

### Option B: Using the API

```javascript
// In browser console
const response = await supabase.functions.invoke("graph-subscription-manager", {
  body: { action: "create" },
});
console.log(response);
```

### Option C: Manual Graph API Call

```bash
curl -X POST "https://graph.microsoft.com/v1.0/subscriptions" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "changeType": "created",
    "notificationUrl": "https://your-project.supabase.co/functions/v1/graph-webhook",
    "resource": "communications/onlineMeetings/getAllTranscripts",
    "expirationDateTime": "2024-01-01T12:00:00Z",
    "clientState": "leadify-crm-webhook-secret-2024",
    "includeResourceData": false
  }'
```

## Step 7: Testing the Setup

### Test Individual Components

Run the test script in your browser console:

```javascript
// Copy and paste the content of test-zero-click-workflow.js
// This will test all components of the system
```

### Test Complete Workflow

1. **Schedule a test meeting** with subject: `[#L2025001] Test Client - German Citizenship`
2. **Join the meeting** and enable transcription
3. **Speak for a few minutes** (Hebrew or English)
4. **End the meeting**
5. **Check the client page** - summary should appear automatically

## Step 8: Monitoring and Maintenance

### Subscription Management

Graph API subscriptions expire after 45-50 minutes. The system includes automatic renewal:

```javascript
// Check subscription status
const status = await supabase.functions.invoke("graph-subscription-manager", {
  body: { action: "status" },
});

// Auto-renew if needed
const renew = await supabase.functions.invoke("graph-subscription-manager", {
  body: { action: "auto-renew" },
});
```

### Function Logs

Monitor function logs in Supabase dashboard:

- `graph-webhook` - Webhook processing
- `graph-subscription-manager` - Subscription management
- `meeting-summary` - Transcript processing

### Health Checks

Regular health checks you should perform:

1. **Subscription Status**: Ensure subscription is active
2. **Webhook Endpoint**: Verify endpoint is accessible
3. **Meeting Processing**: Check that meetings are being processed
4. **Database Records**: Verify data is being saved correctly

## Troubleshooting

### Common Issues

#### 1. Subscription Creation Fails

**Error**: "Failed to create subscription"

**Solutions**:

- Verify Azure AD app permissions
- Check environment variables
- Ensure admin consent is granted
- Verify webhook URL is publicly accessible

#### 2. Webhook Not Receiving Notifications

**Error**: No webhook calls received

**Solutions**:

- Check subscription status
- Verify webhook URL is correct
- Ensure Teams transcription is enabled
- Check function logs for errors

#### 3. Meeting Processing Fails

**Error**: "Failed to process transcript"

**Solutions**:

- Check OpenAI API key
- Verify meeting has transcription enabled
- Check client ID mapping
- Review function logs

#### 4. Client Mapping Issues

**Error**: "Could not determine client ID"

**Solutions**:

- Ensure meeting subject contains `[#CLIENTID]`
- Verify client exists in database
- Check attendee email fallback

### Debug Commands

```javascript
// Check subscription status
await supabase.functions.invoke("graph-subscription-manager", {
  body: { action: "status" },
});

// Test webhook endpoint
fetch("/functions/v1/graph-webhook", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ validationToken: "test" }),
});

// Test meeting processing
await supabase.functions.invoke("meeting-summary", {
  body: {
    meetingId: "test",
    clientId: "test",
    transcriptText: "Test transcript",
    autoFetchTranscript: false,
  },
});
```

## Security Considerations

### Webhook Security

- **Client State**: Used to verify webhook authenticity
- **HTTPS Only**: Webhook endpoint must use HTTPS
- **Validation**: Graph API validates webhook endpoint

### Data Privacy

- **Transcript Retention**: Raw transcripts stored in database
- **Access Control**: RLS policies limit access to summaries
- **Consent**: Ensure clients consent to transcription

### API Security

- **Service Principal**: Uses Azure AD service principal
- **Least Privilege**: Minimal required permissions
- **Token Management**: Automatic token refresh

## Performance Optimization

### Large Transcripts

For very long meetings (>2 hours), consider:

- Chunking transcripts before processing
- Implementing progress indicators
- Adding timeout handling

### Rate Limiting

- **OpenAI API**: Monitor token usage
- **Graph API**: Respect rate limits
- **Database**: Optimize queries for large datasets

## Support and Maintenance

### Regular Tasks

1. **Daily**: Check subscription status
2. **Weekly**: Review function logs
3. **Monthly**: Monitor API usage and costs
4. **Quarterly**: Review and update permissions

### Updates and Upgrades

- **Function Updates**: Deploy updated functions
- **Permission Updates**: Review and update Azure AD permissions
- **Schema Updates**: Run database migrations as needed

## Success Metrics

Track these metrics to ensure the system is working correctly:

- **Subscription Uptime**: Should be >99%
- **Meeting Processing Rate**: Should be >95%
- **Summary Generation Time**: Should be <5 minutes
- **Error Rate**: Should be <1%

## Next Steps

Once the basic setup is complete, consider these enhancements:

1. **Automated Renewal**: Set up cron job for subscription renewal
2. **Monitoring Dashboard**: Create admin dashboard for system health
3. **Custom Prompts**: Implement per-meeting template prompts
4. **Speaker Attribution**: Add speaker identification
5. **Live Notes**: Implement real-time meeting notes

---

**Need Help?** Check the troubleshooting section above or review the function logs in your Supabase dashboard.
