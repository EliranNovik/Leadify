# Session Expiration Setup

## Overview

The application has been configured to use OAuth 2.0 refresh tokens with automatic token refresh for better security and user experience.

**Session Configuration:**

- **Access Token**: 1 hour (3600 seconds)
- **Refresh Token**: 24 hours (86400 seconds)
- **Auto-refresh**: Enabled
- **Token Rotation**: Enabled

## Changes Made

### 1. Supabase Client Configuration (`src/lib/supabase.ts`)

- **Enabled auto-refresh**: `autoRefreshToken: true`
- **Enhanced session manager**: The `getSession()` function now attempts refresh when sessions expire
- **Added refresh token utilities**: New functions to check refresh token availability and expiry times
- **Updated session monitoring**: Checks for expiration and attempts refresh automatically

### 2. App.tsx

- **Enabled automatic session refresh**: The periodic check now attempts refresh when sessions expire
- **Enhanced session monitoring**: Logs successful refreshes and monitors token expiry times
- **Better debugging**: Shows when sessions are refreshed successfully

### 3. useAuth Hook (`src/hooks/useAuth.ts`)

- **Enabled refresh token monitoring**: Periodically checks session status with refresh capability
- **Enhanced session monitoring**: Logs refresh token availability and access token expiry times
- **Improved error handling**: Better handling of refresh failures

### 4. SessionDebug Component

- **Enhanced debugging**: Shows refresh token availability and status
- **Better testing tools**: Tests refresh token behavior and monitoring
- **Clear indicators**: Shows when auto-refresh is enabled and refresh tokens are available

## How It Works

1. **Session Creation**: When users log in, they get an access token (1 hour) and refresh token (24 hours)
2. **Automatic Refresh**: The application automatically refreshes access tokens before they expire
3. **Expiration Detection**: The system periodically checks if access tokens are expired
4. **Refresh Attempt**: When access tokens expire, the system attempts to refresh using the refresh token
5. **Fallback Logout**: Only if refresh fails, users are logged out and redirected to login
6. **Token Rotation**: Refresh tokens are rotated for security

## Session Duration Configuration

The session duration is configured in your Supabase project settings:

### **Supabase Dashboard Configuration:**

1. Go to **Settings** → **API** in your Supabase dashboard
2. In the **JWT Settings** section:
   - **JWT Expiry**: `3600` seconds (1 hour)
   - **Refresh Token Reuse Interval**: `10` seconds
   - **Refresh Token Rotation**: Enabled
   - **Refresh Token Expiry**: `86400` seconds (24 hours)

### **Environment Variables (Alternative):**

```bash
JWT_EXPIRY=3600
REFRESH_TOKEN_REUSE_INTERVAL=10
REFRESH_TOKEN_ROTATION_ENABLED=true
```

## Testing

In development mode, you can use the SessionDebug component to:

- Monitor session status and refresh token availability
- Test expiration behavior and refresh attempts
- Manually refresh sessions
- Force logout
- Test session monitoring with refresh tokens

### **Testing Refresh Token Behavior:**

1. **Using the SessionDebug component** to monitor session status
2. **Testing refresh attempts** when access tokens expire
3. **Verifying token rotation** and security
4. **Using the test script** to verify configuration

## Benefits

1. **Security**: Short-lived access tokens (1 hour) with secure refresh mechanism
2. **User Experience**: Users stay logged in for 24 hours without interruption
3. **Industry Standard**: Follows OAuth 2.0 best practices
4. **Token Rotation**: Enhanced security with refresh token rotation
5. **Transparency**: Clear indication of session status and refresh token availability

## Configuration

To modify session duration, configure the JWT settings in your Supabase project dashboard under **Settings** → **API** → **JWT Settings**.

## Troubleshooting

If users are being logged out unexpectedly:

1. Check the SessionDebug component for session status and refresh token availability
2. Verify the session expiration times (access token: 1 hour, refresh token: 24 hours)
3. Ensure refresh tokens are being generated and stored properly
4. Check browser console for any auth-related errors
5. Verify JWT settings in Supabase dashboard
6. Check if refresh token rotation is working correctly
