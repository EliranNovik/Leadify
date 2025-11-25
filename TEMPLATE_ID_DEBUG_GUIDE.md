# Template ID Not Saving - Debug Guide

## Issue

The `template_id` is not being saved to the database when sending WhatsApp template messages. After refresh, it's NULL.

## Changes Made

### Backend (`backend/src/controllers/whatsappController.js`)

1. ✅ Added comprehensive logging to track `templateId` through the entire flow
2. ✅ Added conversion of `templateId` to number before saving
3. ✅ Added verification after insert to confirm `template_id` was saved
4. ✅ Added error handling if insert fails

### Frontend

1. ✅ Updated `src/pages/WhatsAppPage.tsx` to send `templateId` as number
2. ✅ Updated `src/pages/WhatsAppLeadsPage.tsx` to send `templateId` as number
3. ✅ Updated `src/components/SchedulerWhatsAppModal.tsx` to send `templateId` as number

## How to Debug

### Step 1: Restart Backend Server

**IMPORTANT**: The backend server must be restarted for the code changes to take effect!

```bash
# Stop the backend server (Ctrl+C)
# Then restart it
cd backend
npm start
# or whatever command you use to start the backend
```

### Step 2: Check Backend Server Logs

When you send a template message, you should see these logs in your **backend server terminal** (NOT browser console):

```
📨 ===== SEND MESSAGE REQUEST RECEIVED =====
📨 Template ID in request: 13 (type: number)
🔍 After destructuring - templateId: 13 (type: number)
✅ Template ID converted to number: 13 (original: 13)
💾 ===== ABOUT TO INSERT MESSAGE =====
💾 Template ID value: 13 (type: number)
✅ ===== INSERT RESULT =====
✅ Template ID saved in database: 13 (expected: 13)
✅ SUCCESS: Template ID correctly saved as 13
```

### Step 3: If template_id is still NULL

Check the backend logs for:

- ❌ Any INSERT ERROR messages
- ❌ CRITICAL ERROR messages about template_id being NULL
- ⚠️ WARNING messages about template ID mismatch

### Step 4: Verify Database Column

Make sure the SQL migration was run:

```sql
-- Run this in Supabase SQL Editor to verify column exists:
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'whatsapp_messages'
AND column_name = 'template_id';
```

Expected result:

- `column_name`: template_id
- `data_type`: bigint
- `is_nullable`: YES

### Step 5: Test Insert Manually

Try inserting a test message directly in Supabase to verify the column works:

```sql
INSERT INTO whatsapp_messages (
  lead_id,
  contact_id,
  phone_number,
  sender_name,
  direction,
  message,
  template_id,
  sent_at,
  whatsapp_message_id,
  whatsapp_status,
  message_type
) VALUES (
  'your-lead-id',
  192978,
  '972507825939',
  'Test User',
  'out',
  'Test message',
  13,  -- template_id
  NOW(),
  'test_' || EXTRACT(EPOCH FROM NOW())::text,
  'pending',
  'text'
);

-- Check if it saved:
SELECT id, template_id FROM whatsapp_messages
WHERE whatsapp_message_id LIKE 'test_%'
ORDER BY sent_at DESC
LIMIT 1;
```

## Next Steps

1. **Restart backend server** - This is critical!
2. **Send a template message** from the frontend
3. **Check backend server logs** (not browser console)
4. **Share the backend logs** if template_id is still NULL

The comprehensive logging will help us identify exactly where the issue is occurring.
