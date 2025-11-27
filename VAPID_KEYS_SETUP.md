# VAPID Keys Setup Guide

## Architecture Overview

For push notifications, you have **two places** to configure VAPID keys:

1. **Frontend** (React/Vite app) - Needs PUBLIC key only
2. **Supabase Edge Function** - Needs BOTH public and private keys

## Step 1: Generate VAPID Keys

```bash
npm install -g web-push
web-push generate-vapid-keys
```

You'll get output like:
```
Public Key: BEl62iUYgUivxIkv69yViEuiBIa40HI8F8j6K4...
Private Key: 8vdOrb70ZwJ8aw55a7hQv0f5zK2...
```

## Step 2: Frontend Configuration

Add to your `.env.local` or `.env` file (in the root of your project, not in `backend/`):

```env
VITE_VAPID_PUBLIC_KEY=your_public_key_here
```

**Important**: 
- Only the PUBLIC key goes here
- Restart your dev server after adding this
- This is used to create push subscriptions in the browser

## Step 3: Supabase Edge Function Configuration

The Supabase Edge Function (`send-push-notification`) is what actually **sends** the push notifications. It needs both keys.

### Option A: Using Supabase CLI

```bash
supabase secrets set VAPID_PUBLIC_KEY=your_public_key
supabase secrets set VAPID_PRIVATE_KEY=your_private_key
```

### Option B: Using Supabase Dashboard

1. Go to your Supabase project dashboard
2. Navigate to **Project Settings** → **Edge Functions** → **Secrets**
3. Add two secrets:
   - `VAPID_PUBLIC_KEY` = your public key
   - `VAPID_PRIVATE_KEY` = your private key

## Step 4: Optional - Node.js Backend

If you want to send push notifications from your Node.js backend (`/backend` folder) in the future, you would also add them there:

Add to `backend/.env`:
```env
VAPID_PUBLIC_KEY=your_public_key
VAPID_PRIVATE_KEY=your_private_key
```

**However**, the current implementation uses Supabase Edge Functions, so this is optional unless you plan to add push notification sending to your Node.js backend.

## Summary

| Location | What to Add | Why |
|----------|-------------|-----|
| Frontend `.env` | `VITE_VAPID_PUBLIC_KEY` (public only) | To create push subscriptions in browser |
| Supabase Edge Function Secrets | Both `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` | To send push notifications |
| Node.js Backend `.env` (optional) | Both keys | Only if you want to send from Node.js backend |

## Testing

After setting up:
1. Restart your frontend dev server
2. Go to Settings → Notifications
3. Toggle "Push Notifications" ON
4. You should see "Push notifications enabled!" instead of an error

## Security Notes

- ✅ **Public key** can be safely exposed in frontend code
- ❌ **Private key** must NEVER be in frontend code or committed to git
- ✅ Private key should only be in:
  - Supabase Edge Function secrets
  - Backend `.env` files (if using Node.js backend)
  - Server environment variables

