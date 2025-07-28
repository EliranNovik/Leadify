# Backend Teams Calling Setup Guide

This guide will help you configure your backend server for Teams calling functionality.

## Prerequisites

1. **Azure AD App Registration** with Teams calling permissions
2. **Backend server** running on Node.js/Express
3. **Environment variables** configured

## Step 1: Azure AD Configuration

### 1.1 Add Application Permissions

In your Azure AD app registration, add these **Application permissions** (not Delegated):

- `Calls.InitiateOutgoingCall`
- `Calls.JoinGroupCall.All`
- `Calls.AccessMedia.All`
- `Calls.InitiateGroupCall.All`

### 1.2 Grant Admin Consent

1. Go to Azure Portal → Azure Active Directory → App registrations
2. Find your app: "Teams Meeting App" (ID: e03ab8e9-4eb4-4bbc-8c6d-805021e089cd)
3. Go to "API permissions" tab
4. Click "Grant admin consent for [Your Organization]"
5. Confirm the consent

### 1.3 Create Client Secret

1. Go to "Certificates & secrets" tab
2. Click "New client secret"
3. Add description and set expiration
4. **Copy the secret value** (you won't see it again)

## Step 2: Backend Environment Variables

Create a `.env` file in your `backend` directory with these variables:

```env
# Server Configuration
PORT=3001
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
BACKEND_URL=http://localhost:3001

# Supabase Configuration
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Azure AD Configuration for Teams Calling
VITE_MSAL_CLIENT_ID=your_azure_client_id
VITE_MSAL_TENANT_ID=your_azure_tenant_id
AZURE_CLIENT_SECRET=your_azure_client_secret

# JWT Configuration
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=24h
```

## Step 3: Install Dependencies

```bash
cd backend
npm install @azure/msal-node axios
```

## Step 4: Start the Backend Server

```bash
cd backend
npm run dev
```

## Step 5: Test the API

### Test the health endpoint:

```bash
curl http://localhost:3001/health
```

### Test Teams calling endpoint:

```bash
curl -X POST http://localhost:3001/api/teams/initiate \
  -H "Content-Type: application/json" \
  -d '{"targetUserId":"user-id-here","callType":"audio"}'
```

## API Endpoints

### Teams Calling Endpoints

- `POST /api/teams/initiate` - Initiate a call
- `DELETE /api/teams/:callId` - End a call
- `GET /api/teams/:callId/status` - Get call status
- `POST /api/teams/:callId/answer` - Answer a call
- `POST /api/teams/:callId/reject` - Reject a call
- `POST /api/teams/:callId/mute` - Mute/unmute call
- `POST /api/teams/callbacks` - Callback for Teams events

## Troubleshooting

### Common Issues

1. **"Application is not registered in our store"**

   - Ensure you have the correct Application permissions
   - Grant admin consent for your organization

2. **"Invalid client secret"**

   - Check that `AZURE_CLIENT_SECRET` is correct
   - Ensure the secret hasn't expired

3. **"CORS error"**

   - Check that `CORS_ORIGIN` matches your frontend URL
   - Ensure backend is running on the correct port

4. **"Failed to get access token"**
   - Verify all Azure AD environment variables
   - Check that the app registration has the correct permissions

### Debug Steps

1. Check backend logs for detailed error messages
2. Verify environment variables are loaded correctly
3. Test Azure AD authentication separately
4. Check network connectivity to Microsoft Graph API

## Security Notes

- Keep your `AZURE_CLIENT_SECRET` secure
- Use environment variables, never hardcode secrets
- Consider using Azure Key Vault for production
- Implement proper authentication for your API endpoints

## Next Steps

1. Test the calling functionality from the frontend
2. Implement proper error handling
3. Add call status monitoring
4. Implement call recording if needed
5. Add call analytics and logging
