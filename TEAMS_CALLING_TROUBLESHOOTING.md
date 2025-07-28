# Teams Calling Troubleshooting Guide

## Current Issue: 7503 Error with Registered App

Your app is registered but still getting `7503: Application is not registered in our store` error.

## Possible Solutions

### 1. Check Application Type

Your app might be registered as a **SPA** but Teams calling requires a **Web application** or **Confidential client**.

**Fix:**

1. Go to Azure Portal → App registrations → Your app
2. Click **"Authentication"**
3. Check **"Platform configurations"**
4. If it shows **"Single-page application (SPA)"**, add **"Web"** platform
5. Add redirect URI: `https://yourdomain.com/api/teams/callbacks`

### 2. Verify Application Permissions

Ensure you have the **exact** permissions needed:

**Required Application Permissions:**

- `Calls.InitiateOutgoingCall.All`
- `Calls.JoinGroupCall.All`
- `Calls.AccessMedia.All`
- `Calls.InitiateGroupCall.All`

**Steps:**

1. Go to **API permissions**
2. Click **"Add a permission"**
3. Select **"Microsoft Graph"**
4. Choose **"Application permissions"**
5. Search for each permission above
6. **Grant admin consent** for all

### 3. Check App Manifest

Your app manifest might need specific Teams calling properties.

**Add to your app manifest:**

```json
{
  "requiredResourceAccess": [
    {
      "resourceAppId": "00000003-0000-0000-c000-000000000000",
      "resourceAccess": [
        {
          "id": "284383d3-0bb1-4e12-a028-c44c5326f112",
          "type": "Role"
        },
        {
          "id": "4dc6c2f7-7f1a-4c1a-8d21-3c4e0d3b3b3b",
          "type": "Role"
        }
      ]
    }
  ]
}
```

### 4. Alternative: Use Teams Bot Framework

If direct calling doesn't work, we can implement a Teams bot:

1. **Install Bot Framework SDK:**

   ```bash
   npm install @microsoft/botframework-sdk
   ```

2. **Create a bot endpoint** that handles calling
3. **Register the bot** with Microsoft Teams

### 5. Check Tenant Configuration

Your tenant might have restrictions on Teams calling.

**Check:**

1. Teams Admin Center → **Voice** → **Calling policies**
2. Ensure calling is enabled for your tenant
3. Check if there are any restrictions on external calling

### 6. Use Microsoft Graph PowerShell

Test with PowerShell to verify permissions:

```powershell
Connect-MgGraph -Scopes "Application.ReadWrite.All"
$app = Get-MgApplication -ApplicationId "e03ab8e9-4eb4-4bbc-8c6d-805021e089cd"
$app.RequiredResourceAccess
```

## Next Steps

1. **Try Solution 1** - Change app type to Web application
2. **Try Solution 2** - Verify all permissions are granted
3. **Try Solution 3** - Update app manifest
4. **If all fail** - Implement Teams bot approach

## Testing

After making changes, test with:

```bash
curl -X POST http://localhost:3001/api/teams/initiate \
  -H "Content-Type: application/json" \
  -d '{"targetUserId":"user@domain.com","callType":"audio"}'
```

## Debug Information

Your current app configuration:

- **App ID**: e03ab8e9-4eb4-4bbc-8c6d-805021e089cd
- **Tenant ID**: 899fa835-174e-49e1-93a3-292318f5ee84
- **Error**: 7503 - Application not registered in store

This suggests the app needs specific Teams calling registration beyond regular Azure AD registration.
