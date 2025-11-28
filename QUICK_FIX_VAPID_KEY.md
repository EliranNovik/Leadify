# Quick Fix: VAPID Key Error on iPhone

## Error Message
```
failed to create push subscription applicationserverkey must contain a valid P256 public key
```

## The Problem

The VAPID public key is either:
1. **Not set** in your frontend `.env` file
2. **Empty or invalid** format
3. **Not loaded** by Vite (need to restart dev server)

## Solution

### Step 1: Check if you have VAPID keys

If you haven't generated them yet:
```bash
npm install -g web-push
web-push generate-vapid-keys
```

You'll get output like:
```
Public Key: BEl62iUYgUivxIkv69yViEuiBIa40HI8F8j6K4...
Private Key: 8vdOrb70ZwJ8aw55a7hQv0f5zK2...
```

### Step 2: Add to Frontend `.env.local` file

**Important**: The frontend needs the PUBLIC key in a file called `.env.local` (or `.env`) in the **root of your project** (not in `backend/`).

Create or edit `.env.local` in the project root:

```env
VITE_VAPID_PUBLIC_KEY=your_public_key_here
```

**Make sure:**
- The key starts with `VITE_` prefix
- No quotes around the key value
- No spaces before/after the key
- The full key is on one line (they're long strings)

### Step 3: Restart Your Dev Server

**Critical**: After adding the environment variable, you MUST restart your Vite dev server:

```bash
# Stop the server (Ctrl+C)
# Then restart
npm run dev
```

Vite only loads environment variables on startup, so changes to `.env` files require a restart.

### Step 4: Verify in Browser Console

After restarting, open your browser console and you should see:
```
✅ VAPID public key loaded: BEl62iUYgUivxIkv69y... (length: 87)
```

If you see:
```
⚠️  VAPID public key not found. Set VITE_VAPID_PUBLIC_KEY in your .env file
```

Then the key is still not being loaded. Check:
- File is named `.env.local` or `.env` (not `.env.local.example`)
- File is in the project root (same level as `package.json`)
- Key name is exactly `VITE_VAPID_PUBLIC_KEY`
- No typos in the key value
- Restarted the dev server

### Step 5: Test Again

1. Go to Settings → Notifications
2. Toggle "Push Notifications" ON
3. Grant permission
4. Should work now!

## Common Mistakes

❌ **Wrong location**: Putting key in `backend/.env` (that's for backend only)
✅ **Correct**: Put in root `.env.local` (for frontend)

❌ **Wrong prefix**: Using `VAPID_PUBLIC_KEY` instead of `VITE_VAPID_PUBLIC_KEY`
✅ **Correct**: Must start with `VITE_` for Vite to expose it

❌ **Not restarting**: Adding key but not restarting dev server
✅ **Correct**: Always restart after changing `.env` files

❌ **Quotes around key**: `VITE_VAPID_PUBLIC_KEY="key"`
✅ **Correct**: `VITE_VAPID_PUBLIC_KEY=key` (no quotes)

## Still Not Working?

1. Check browser console for the log message about VAPID key
2. Verify the key length (should be around 87 characters)
3. Make sure you're using the PUBLIC key (not the private key)
4. Try regenerating keys if the current ones seem invalid

