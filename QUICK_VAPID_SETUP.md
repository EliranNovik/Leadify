# Quick VAPID Key Setup for Push Notifications

## Step 1: Generate VAPID Keys

Install web-push globally (if not already installed):
```bash
npm install -g web-push
```

Generate VAPID keys:
```bash
web-push generate-vapid-keys
```

This will output something like:
```
Public Key: BEl62iUYgUivxIkv69yViEuiBIa40HI8F8j6K4...
Private Key: 8vdOrb70ZwJ8aw55a7hQv0f5zK2...
```

## Step 2: Add Public Key to Frontend

Add to your `.env.local` or `.env` file:
```env
VITE_VAPID_PUBLIC_KEY=your_public_key_here
```

**Important**: Only the PUBLIC key goes in the frontend `.env` file. Never commit the private key to your frontend code.

## Step 3: Add Private Key to Supabase Edge Function

Set the private key as a Supabase secret:
```bash
supabase secrets set VAPID_PRIVATE_KEY=your_private_key_here
supabase secrets set VAPID_PUBLIC_KEY=your_public_key_here
```

Or if using Supabase Dashboard:
1. Go to Project Settings → Edge Functions → Secrets
2. Add `VAPID_PRIVATE_KEY` with your private key
3. Add `VAPID_PUBLIC_KEY` with your public key

## Step 4: Restart Development Server

After adding the environment variable, restart your Vite dev server:
```bash
# Stop the server (Ctrl+C) and restart
npm run dev
```

## Step 5: Test Again

1. Go to Settings → Notifications
2. Toggle "Push Notifications" ON
3. Grant permission when prompted
4. You should see "Push notifications enabled!" instead of an error

## Troubleshooting

### Error: "VAPID public key is not configured"
- Make sure `VITE_VAPID_PUBLIC_KEY` is in your `.env.local` file
- Restart your dev server after adding the variable
- Check browser console for the exact error

### Error: "Invalid VAPID key"
- Make sure you copied the full key (they're long strings)
- Check for any extra spaces or line breaks
- Regenerate keys if needed

### iOS Specific Issues
- Make sure the app is added to home screen (PWA installation)
- iOS 16.4+ is required
- Must be using HTTPS (not HTTP) - localhost works for development
- Safari must have notification permissions enabled

### Test Notification Works But Setup Fails
- This means permission is granted but VAPID key is missing/invalid
- Follow steps above to add VAPID keys
- The test notification is local and doesn't need VAPID keys

