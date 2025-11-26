# Test Template Sync Locally

I've updated `vite.config.ts` to use your local backend. Now follow these steps:

## Step 1: Start Backend Server

Open a new terminal window and run:

```bash
cd backend
npm run dev
```

Or if that doesn't work:

```bash
cd backend
node server.js
```

The backend should start on `http://localhost:3002`

## Step 2: Restart Frontend Dev Server

Stop your frontend dev server (press `Ctrl+C`) and restart it:

```bash
npm run dev
```

## Step 3: Test Sync

1. Go to **Admin → WhatsApp Templates** page
2. Click **"Fetch New Templates"** button
3. It should now work! 🎉

The sync endpoint will:
- Fetch templates from WhatsApp API
- Save them to `whatsapp_templates_v2` table
- Return success message

## When Done Testing

After you're done testing, you have two options:

### Option A: Deploy Backend to Render.com
Commit and push your backend changes so Render.com has the sync endpoint:
```bash
git add backend/
git commit -m "Add WhatsApp templates sync for whatsapp_templates_v2"
git push
```

### Option B: Revert to Remote Backend
Change `vite.config.ts` back to:
```typescript
target: 'https://leadify-crm-backend.onrender.com',
```

