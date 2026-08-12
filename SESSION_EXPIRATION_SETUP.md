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

## Mobile (phone / QR clock-in)

Phones are the hardest case: the CRM tab is opened once a day (often only to scan the entry
QR), then the browser suspends or discards it, so `autoRefreshToken` gets almost no chance to
run. Two things keep the session alive there:

1. **Resume events** — the app refreshes on `visibilitychange`, `pageshow` (back/forward-cache
   restore) and `online`. Mobile Safari/Chrome often restore a tab without a visibility change,
   which previously left the tab running on a dead access token until a 401 forced a logout.
2. **Recovery instead of logout** — `resolveSessionWithRecovery()` (`authSessionKeepAlive.ts`)
   retries `getSession` / `refreshSession` with backoff and only reports "signed out" when
   localStorage has no auth keys or Supabase rejects the refresh token itself. The QR entry page
   (`/clock-in/entry`) uses it, so a slow cellular → office Wi-Fi handover no longer sends the
   employee to `/login`. Each scan also rotates the refresh token, pushing the stay-signed-in
   window forward for another day.

If phones still log out roughly every 24 hours, the cause is server-side: check
**Authentication → Sessions** in the Supabase dashboard for a **refresh token expiry of 24h**,
an **inactivity timeout**, or **time-boxed sessions**. With a 24h refresh-token lifetime a device
that is only used once a day sits right on the edge and will drop.

**Important:** JWT expiry (e.g. 86 hours) is **not** the stay-signed-in window. The **refresh
token** lifetime is. Set refresh token expiry to **at least 7 days** (`604800`) for daily QR
clock-in phones. Each successful scan also calls `refreshSession()` to rotate/extend that window.

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
2. Prefer **Inactivity timeout = 0** (disabled) for daily QR phones — an 80h inactivity box can still interact oddly with suspended tabs; the refresh-token lifetime should be the only long-lived control
3. Check that `localStorage` is available (private mode / IT policies)
4. Look for repeated `refreshSession` failures in the console (`VITE_DEBUG_AUTH=true` helps). With debug on, run `await probePersistedAuthSession()` in the phone browser console *before* re-logging in:
   - `hasAuthKeys: false` → storage was cleared (PWA / browser eviction)
   - `hasAuthKeys: true` + `refreshError` mentioning `already used` → rotation race (app now recovers instead of wiping)
   - `refreshError` mentioning expired / not found → server-side refresh TTL
5. Verify rotation + reuse interval are not fighting multi-tab refresh (reuse interval ≈ 10s is fine)

## App hardening (refresh races)

Forced logout no longer runs on the first failed refresh. The client:

- Coalesces refresh calls and waits for the “winning” session after `already used` errors
- Skips wiping `localStorage` on network / transient failures while auth keys remain
- Treats GoTrue `SIGNED_OUT` as recoverable when auth keys still contain a session
- Only redirects to `/login` after a **definitive** dead refresh token (or empty storage)
