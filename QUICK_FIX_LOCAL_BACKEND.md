# Quick Fix: Run Backend Locally

Since the remote backend doesn't have the sync endpoint yet, you can test locally:

## Step 1: Update Vite Config to Use Local Backend

Edit `vite.config.ts` - change the proxy target:

```typescript
proxy: {
  '/api': {
    target: 'http://localhost:3002', // Change from Render.com to local
    changeOrigin: true,
    secure: false
  }
}
```

## Step 2: Start Backend Locally

Open a new terminal and run:

```bash
cd backend
npm run dev
```

Or if you don't have `dev` script:

```bash
cd backend
node server.js
```

The backend should start on port 3002.

## Step 3: Restart Frontend Dev Server

Stop your frontend dev server (Ctrl+C) and restart:

```bash
npm run dev
```

## Step 4: Test Sync

Now try the sync again:
- Go to Admin → WhatsApp Templates
- Click "Fetch New Templates"

It should work now! 🎉

## Remember to Revert

After testing, change `vite.config.ts` back to point to Render.com if you want to use the remote backend.

