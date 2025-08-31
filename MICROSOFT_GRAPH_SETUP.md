# Microsoft Graph API Setup for Teams Transcript Fetching

This guide explains how to set up Microsoft Graph API integration to automatically fetch Teams meeting transcripts.

## Required Microsoft Graph API Permissions

### Application Permissions (Admin Consent Required)

```json
{
  "permissions": [
    "OnlineMeetingArtifact.Read.All",
    "Files.Read.All",
    "User.Read.All",
    "Calendars.Read.All"
  ]
}
```

### Delegated Permissions (User Consent)

```json
{
  "permissions": [
    "OnlineMeetingArtifact.Read.All",
    "Files.Read.All",
    "User.Read",
    "Calendars.Read"
  ]
}
```

## Azure AD App Registration Setup

### 1. Create Azure AD Application

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** → **App registrations**
3. Click **New registration**
4. Fill in the details:
   - **Name**: `Teams Transcript Fetcher`
   - **Supported account types**: `Accounts in this organizational directory only`
   - **Redirect URI**: `https://your-domain.com/auth/callback`

### 2. Configure API Permissions

1. Go to **API permissions**
2. Click **Add a permission**
3. Select **Microsoft Graph**
4. Choose **Application permissions** (for service-to-service) or **Delegated permissions** (for user context)
5. Add the required permissions:
   - `OnlineMeetingArtifact.Read.All`
   - `Files.Read.All`
   - `User.Read` (or `User.Read.All` for app permissions)
   - `Calendars.Read` (or `Calendars.Read.All` for app permissions)

### 3. Grant Admin Consent

1. Click **Grant admin consent for [Your Organization]**
2. Confirm the permissions

### 4. Create Client Secret

1. Go to **Certificates & secrets**
2. Click **New client secret**
3. Add description and select expiration
4. **Copy the secret value** (you won't see it again)

### 5. Get Application ID

1. Copy the **Application (client) ID** from the Overview page

## Environment Variables

Add these to your Supabase environment:

```bash
# Azure AD Configuration
AZURE_CLIENT_ID=your-application-id
AZURE_CLIENT_SECRET=your-client-secret
AZURE_TENANT_ID=your-tenant-id

# Microsoft Graph API
GRAPH_API_BASE=https://graph.microsoft.com/v1.0
```

## Teams Meeting Transcription Setup

### 1. Enable Meeting Transcription

1. Go to **Microsoft Teams Admin Center**
2. Navigate to **Meetings** → **Meeting policies**
3. Create or edit a policy
4. Enable **Allow transcription**
5. Set **Who can start transcription** to **Organizer and coorganizers**

### 2. Meeting Template (Optional)

Create a meeting template with transcription enabled:

```json
{
  "displayName": "Client Call (Auto-Summary)",
  "description": "Meeting template with transcription enabled for automatic summary generation",
  "settings": {
    "allowTranscription": true,
    "allowMeetingChat": true,
    "allowMeetingRegistration": false
  }
}
```

## Authentication Flow

### Option 1: Service-to-Service (Recommended)

For automatic transcript fetching without user interaction:

```typescript
// Get access token using client credentials
async function getServiceToken(): Promise<string> {
  const tokenResponse = await fetch(
    `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: AZURE_CLIENT_ID,
        client_secret: AZURE_CLIENT_SECRET,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    }
  );

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}
```

### Option 2: User Delegated (For User-Specific Access)

For user-specific transcript access:

```typescript
// Get access token for specific user
async function getUserToken(userId: string): Promise<string> {
  // This requires the user to have previously authenticated
  // and granted consent for the required permissions

  const {
    data: { user },
    error,
  } = await supabase.auth.admin.getUserById(userId);
  if (error || !user) {
    throw new Error("User not found");
  }

  // Get the access token from user metadata
  const accessToken = user.user_metadata?.microsoft_access_token;
  if (!accessToken) {
    throw new Error("No Microsoft access token available");
  }

  return accessToken;
}
```

## Usage Examples

### 1. Automatic Transcript Fetching

```typescript
import { processMeetingSummaryWithTeamsFetch } from "../lib/meetingSummaryApi";

// Automatically fetch transcript from Teams
const result = await processMeetingSummaryWithTeamsFetch(
  "teams-meeting-id",
  "client-id",
  "user-id",
  {
    autoFetchTranscript: true,
  }
);

console.log("Transcript source:", result.transcriptSource); // 'teams' | 'manual' | 'none'
```

### 2. Manual Transcript with Fallback

```typescript
// Try to fetch from Teams, fallback to manual transcript
const result = await processMeetingSummaryWithTeamsFetch(
  "teams-meeting-id",
  "client-id",
  "user-id",
  {
    transcriptText: "fallback transcript text",
    autoFetchTranscript: true,
  }
);
```

### 3. Manual Transcript Only

```typescript
// Use only manual transcript
const result = await processMeetingSummaryWithTeamsFetch(
  "teams-meeting-id",
  "client-id",
  "user-id",
  {
    transcriptText: "manual transcript text",
    autoFetchTranscript: false,
  }
);
```

## Graph API Endpoints Used

### 1. Get Meeting Details

```http
GET https://graph.microsoft.com/v1.0/communications/callRecords/{meetingId}
Authorization: Bearer {access_token}
```

### 2. Get Meeting Artifacts

```http
GET https://graph.microsoft.com/v1.0/communications/callRecords/{meetingId}/artifacts
Authorization: Bearer {access_token}
```

### 3. Download Transcript Content

```http
GET https://graph.microsoft.com/v1.0/communications/callRecords/{meetingId}/artifacts/{artifactId}/content
Authorization: Bearer {access_token}
```

## Error Handling

### Common Issues

1. **401 Unauthorized**

   - Check access token validity
   - Verify permissions are granted
   - Ensure admin consent is provided

2. **403 Forbidden**

   - Verify the required permissions are assigned
   - Check if the user has access to the meeting

3. **404 Not Found**

   - Meeting ID might be incorrect
   - Meeting might not have transcription enabled
   - Meeting might be too old (transcripts expire)

4. **No Transcript Available**
   - Transcription might not have been enabled during the meeting
   - Meeting might not have been recorded
   - Transcript processing might still be in progress

## Testing

### Test Script

```javascript
// Test Graph API integration
const testGraphAPI = async () => {
  try {
    const result = await processMeetingSummaryWithTeamsFetch(
      "test-meeting-id",
      "test-client-id",
      "test-user-id",
      { autoFetchTranscript: true }
    );

    console.log("Result:", result);
    console.log("Transcript source:", result.transcriptSource);
  } catch (error) {
    console.error("Test failed:", error);
  }
};

testGraphAPI();
```

## Security Considerations

1. **Access Token Storage**: Store tokens securely, never in client-side code
2. **Permission Scope**: Use least privilege principle
3. **Token Expiration**: Handle token refresh automatically
4. **Audit Logging**: Log all transcript access for compliance
5. **Data Retention**: Implement appropriate data retention policies

## Troubleshooting

### Debug Mode

Enable debug logging in the edge function:

```typescript
console.log("Fetching transcript for meeting:", meetingId);
console.log("Meeting artifacts:", artifacts);
console.log("Transcript content length:", transcriptContent.length);
```

### Common Solutions

1. **Permission Issues**: Grant admin consent for all required permissions
2. **Token Issues**: Implement proper token refresh logic
3. **Meeting Access**: Ensure the user has access to the meeting
4. **Transcription**: Verify transcription was enabled during the meeting

## Support

For issues with Microsoft Graph API:

1. Check [Microsoft Graph documentation](https://docs.microsoft.com/en-us/graph/)
2. Review [Teams API documentation](https://docs.microsoft.com/en-us/graph/api/resources/teams-api-overview)
3. Check [Azure AD troubleshooting](https://docs.microsoft.com/en-us/azure/active-directory/develop/troubleshoot-permissions)
4. Review function logs in Supabase dashboard
