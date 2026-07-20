# Session Expiration Setup

## Overview

The application uses OAuth 2.0 refresh tokens with automatic token refresh for security and a smooth UX.

**Recommended session configuration (Supabase Auth):**

- **Access Token (JWT Expiry)**: 1 hour (`3600` seconds) — short-lived; refreshed automatically
- **Refresh Token Expiry**: **7 days** (`604800` seconds) recommended for desktop + mobile continuity  
  (legacy docs used 24 hours; raise this in the dashboard if users are logged out overnight/weekend)
- **Auto-refresh**: Enabled in the app (`autoRefreshToken: true`)
- **Token Rotation**: Enabled

## App keep-alive (continuous use)

While a user keeps using the CRM (clicks, typing, scrolling, returning to the tab):

1. Activity is tracked (`src/lib/authSessionKeepAlive.ts`)
2. Access tokens refresh earlier (≈3 minutes before expiry when active)
3. At most about every **25 minutes** of active use, the session is refreshed so refresh-token **rotation** renews the long-lived session
4. Forced logout still requires **confirmed** refresh failure (not a single flaky network blip); active users get a slightly higher failure threshold

This does **not** remove auth expiry. It only keeps the session healthy while someone is actually using the product.

Idle / closed tabs still expire when the Supabase **refresh token** lifetime ends.

## Changes in code

### Supabase client (`src/lib/supabase.ts`)

- `autoRefreshToken: true`, `persistSession: true`, `localStorage`
- Global fetch retries once on 401 after a coalesced refresh
- `tryRefreshThenExpire` / `handleSessionExpiration` for unrecoverable cases

### Auth context (`src/contexts/AuthContext.tsx`)

- Visibility / resume refresh
- 2-minute session watchdog
- Activity tracking + keep-alive refresh (desktop and mobile)

### Keep-alive helper (`src/lib/authSessionKeepAlive.ts`)

- Marks activity from pointer / keyboard / touch / scroll
- Refreshes near access-token expiry or periodically while recently active

## How it works

1. Login issues an access token (~1h) and a refresh token (dashboard TTL)
2. Supabase + app watchdog refresh the access token before it expires
3. Continuous use periodically rotates the refresh token (extends the “stay signed in” window)
4. Only a failed refresh with no recoverable session sends the user to `/login`

## Supabase Dashboard configuration

1. Open **Authentication** → **Providers** / **Settings** (or **Project Settings** → **Auth**)
2. JWT / refresh settings:
   - **JWT expiry**: `3600`
   - **Refresh token reuse interval**: `10` (seconds)
   - **Refresh token rotation**: Enabled
   - **Refresh token expiry**: `604800` (7 days) — or `1209600` (14 days) if you need longer weekends away

> Exact labels vary by Supabase UI version; look for JWT expiry and refresh token lifetime.

## Security notes

- Keep access tokens short (1 hour)
- Prefer refresh-token rotation
- Do not store CRM auth in `sessionStorage` (breaks mobile resume)
- Clock-out / clock-in gate does **not** clear the CRM session
- MSAL (Microsoft Graph) is separate from CRM login; Graph re-auth must not force CRM logout

## Troubleshooting unexpected logouts

1. Confirm refresh token expiry in the Supabase dashboard (raise above 24h if needed)
2. Check that `localStorage` is available (private mode / IT policies)
3. Look for repeated `refreshSession` failures in the console (`VITE_DEBUG_AUTH=true` helps)
4. Verify rotation + reuse interval are not fighting multi-tab refresh
