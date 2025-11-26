# Deploy Backend Changes to Render.com

The `/api/whatsapp/templates/sync` endpoint exists locally but needs to be deployed to Render.com.

## Option 1: Auto-Deploy (If GitHub Connected)

If your Render.com backend is connected to GitHub:
1. Commit and push your backend changes:
   ```bash
   git add backend/
   git commit -m "Add WhatsApp templates sync endpoint for whatsapp_templates_v2"
   git push
   ```
2. Render.com will automatically deploy (if auto-deploy is enabled)
3. Wait 2-5 minutes for deployment to complete

## Option 2: Manual Deploy via Render Dashboard

1. Go to [Render.com Dashboard](https://dashboard.render.com)
2. Find your backend service: `leadify-crm-backend`
3. Click "Manual Deploy" → "Deploy latest commit"
4. Wait for deployment to complete

## Option 3: Run Backend Locally (For Testing)

If you want to test immediately without deploying:

### Step 1: Update Vite Proxy to Point to Local Backend

Update `vite.config.ts`:
```typescript
proxy: {
  '/api': {
    target: 'http://localhost:3002', // Change to local backend
    changeOrigin: true,
    secure: false
  }
}
```

### Step 2: Start Local Backend

```bash
cd backend
npm install  # if needed
npm run dev  # or npm start
```

The backend will run on `http://localhost:3002`

### Step 3: Test Sync Endpoint

The sync should now work:
- Admin → WhatsApp Templates → "Fetch New Templates"

## Verify Deployment

After deployment, test the endpoint:
```bash
curl -X POST https://leadify-crm-backend.onrender.com/api/whatsapp/templates/sync
```

Or check in browser console:
```javascript
fetch('/api/whatsapp/templates/sync', { method: 'POST' })
  .then(r => r.json())
  .then(console.log)
```

## Files That Need Deployment

Make sure these files are deployed:
- ✅ `backend/src/routes/whatsappRoutes.js` (has `/templates/sync` route)
- ✅ `backend/src/controllers/whatsappController.js` (has `syncTemplates` function)
- ✅ `backend/src/services/whatsappTemplateSyncService.js` (syncs to `whatsapp_templates_v2`)

