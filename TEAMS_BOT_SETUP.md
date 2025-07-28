# Teams Bot Setup Guide

This guide will help you set up the Teams bot for calling functionality.

## Prerequisites

1. **Azure AD App Registration** (already configured)
2. **Microsoft Teams Admin Center** access
3. **Bot Framework** account (optional)

## Step 1: Register Bot with Microsoft Teams

### Option A: Using Teams Admin Center

1. Go to [Microsoft Teams Admin Center](https://admin.teams.microsoft.com/)
2. Navigate to **Teams apps** → **Manage apps**
3. Click **"Submit a custom app"**
4. Upload the `teams-bot-manifest.json` file
5. Fill in the required information:
   - **App name**: Teams Meeting App
   - **Version**: 1.0.0
   - **Description**: Teams calling application
6. Click **"Submit"**

### Option B: Using Teams Toolkit (Recommended)

1. Install [Teams Toolkit](https://marketplace.visualstudio.com/items?itemName=TeamsDevApp.ms-teams-vscode-extension)
2. Open VS Code with Teams Toolkit
3. Create a new Teams app project
4. Replace the manifest with our `teams-bot-manifest.json`
5. Deploy using Teams Toolkit

## Step 2: Configure Bot Endpoints

Update your Azure AD app registration:

1. Go to **Azure Portal** → **Azure Active Directory** → **App registrations** → **Your app**
2. Click **"Authentication"**
3. Add these redirect URIs:
   - `https://yourdomain.com/api/teams/bot/callbacks`
   - `http://localhost:3001/api/teams/bot/callbacks` (for development)
4. Click **"Save"**

## Step 3: Add Bot Permissions

1. Go to **API permissions**
2. Click **"Add a permission"**
3. Select **"Microsoft Graph"**
4. Choose **"Application permissions"**
5. Add these permissions:
   - `Calls.InitiateOutgoingCall.All`
   - `Calls.JoinGroupCall.All`
   - `Calls.AccessMedia.All`
   - `Calls.InitiateGroupCall.All`
6. Click **"Grant admin consent"**

## Step 4: Environment Variables

Add these to your `.env` file:

```env
# Bot Configuration
BOT_APP_ID=e03ab8e9-4eb4-4bbc-8c6d-805021e089cd
BOT_APP_PASSWORD=your_bot_password
BOT_ENDPOINT=https://yourdomain.com/api/teams/bot

# Azure AD Configuration
VITE_MSAL_CLIENT_ID=e03ab8e9-4eb4-4bbc-8c6d-805021e089cd
VITE_MSAL_TENANT_ID=your_tenant_id
AZURE_CLIENT_SECRET=your_client_secret

# Server Configuration
PORT=3001
BACKEND_URL=http://localhost:3001
CORS_ORIGIN=http://localhost:5173
```

## Step 5: Test the Bot

1. **Start the backend server:**

   ```bash
   cd backend
   npm run dev
   ```

2. **Test the bot endpoints:**

   ```bash
   curl -X POST http://localhost:3001/api/teams/bot/initiate \
     -H "Content-Type: application/json" \
     -d '{"targetUserId":"user@domain.com","callType":"audio"}'
   ```

3. **Check the logs** for any errors

## Troubleshooting

### Error: "Bot not properly registered"

**Solution:**

1. Make sure the bot is registered in Teams Admin Center
2. Verify the bot ID matches your Azure AD app ID
3. Check that all permissions are granted

### Error: "7503 - Application not registered"

**Solution:**

1. Ensure the app is registered with Microsoft Teams
2. Verify Application permissions are granted
3. Check that admin consent is provided

### Error: "Invalid bot endpoint"

**Solution:**

1. Verify the bot endpoint URL is accessible
2. Check that the callback URL is properly configured
3. Ensure HTTPS is used in production

## Bot Commands

The bot supports these commands:

- `/call @username` - Initiate a call with a user
- `/endcall` - End the current call
- `/status` - Get call status
- `/mute` - Mute/unmute the call

## API Endpoints

- `POST /api/teams/bot/initiate` - Start a call
- `DELETE /api/teams/bot/:callId` - End a call
- `GET /api/teams/bot/:callId/status` - Get call status
- `POST /api/teams/bot/:callId/answer` - Answer a call
- `POST /api/teams/bot/:callId/reject` - Reject a call
- `POST /api/teams/bot/:callId/mute` - Mute/unmute call
- `POST /api/teams/bot/callbacks` - Bot callback endpoint

## Next Steps

1. **Deploy to production** with proper HTTPS endpoints
2. **Add more bot commands** for enhanced functionality
3. **Implement call recording** features
4. **Add call analytics** and reporting

## Support

If you encounter issues:

1. Check the backend logs for detailed error messages
2. Verify all environment variables are set correctly
3. Ensure the bot is properly registered with Teams
4. Test with the Teams Toolkit for easier debugging
