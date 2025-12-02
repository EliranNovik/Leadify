# Deploy list-lead-documents Function

## Prerequisites

1. **Supabase CLI installed**

   ```bash
   npm install -g supabase
   ```

2. **Login to Supabase**

   ```bash
   supabase login
   ```

3. **Link your project**

   ```bash
   supabase link --project-ref your-project-ref
   ```

   To find your project ref:

   - Go to your Supabase Dashboard
   - Settings → General
   - Copy the "Reference ID"

## Step 2: Set Environment Variables

In your Supabase Dashboard, go to **Edge Functions** → **list-lead-documents** → **Settings** and add:

```
MSAL_TENANT_ID=your-tenant-id
MSAL_CLIENT_ID=your-client-id
CLIENT_SECRET=your-client-secret
USER_ID=your-user-id
```

Or set them via CLI:

```bash
supabase secrets set MSAL_TENANT_ID=your-tenant-id
supabase secrets set MSAL_CLIENT_ID=your-client-id
supabase secrets set CLIENT_SECRET=your-client-secret
supabase secrets set USER_ID=your-user-id
```

## Step 3: Deploy the Function

```bash
supabase functions deploy list-lead-documents
```

## Step 4: Verify Deployment

1. Check the function in Supabase Dashboard under **Edge Functions**
2. Test it by calling it from your frontend
3. Check logs:
   ```bash
   supabase functions logs list-lead-documents
   ```

## Troubleshooting

- **"Cannot find project ref"**: Run `supabase link --project-ref your-project-ref`
- **"Function not found"**: Make sure you're in the project root directory
- **Environment variables not working**: Verify secrets are set correctly in Dashboard
