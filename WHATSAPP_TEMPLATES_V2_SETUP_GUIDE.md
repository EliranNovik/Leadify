# WhatsApp Templates V2 Setup - Next Steps

## ✅ What's Done
- ✅ Created new `whatsapp_templates_v2` table with proper structure
- ✅ Updated all code to use the new table
- ✅ Added `content` column to store template text

## 📋 Next Steps

### Step 1: Create the Table (If Not Done Yet)
Run this SQL in Supabase SQL Editor:

```sql
CREATE TABLE whatsapp_templates_v2 (
    id BIGSERIAL PRIMARY KEY,
    whatsapp_template_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'en_US',
    content TEXT NOT NULL,
    params TEXT NOT NULL DEFAULT '0',
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_whatsapp_templates_v2_whatsapp_id ON whatsapp_templates_v2(whatsapp_template_id);
CREATE INDEX idx_whatsapp_templates_v2_name_language ON whatsapp_templates_v2(name, language);
CREATE INDEX idx_whatsapp_templates_v2_active ON whatsapp_templates_v2(active);
```

### Step 2: Update Foreign Key (Optional but Recommended)
Run this to link `whatsapp_messages.template_id` to the new table:

```sql
ALTER TABLE whatsapp_messages 
DROP CONSTRAINT IF EXISTS whatsapp_messages_template_id_fkey;

ALTER TABLE whatsapp_messages 
ADD CONSTRAINT whatsapp_messages_template_id_fkey 
FOREIGN KEY (template_id) 
REFERENCES whatsapp_templates_v2(id) 
ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_template_id ON whatsapp_messages(template_id);
```

### Step 3: Sync Templates from WhatsApp API
You have two options:

#### Option A: Using Admin Page (Easiest)
1. Go to **Admin → WhatsApp Templates** page
2. Click the **"Fetch New Templates"** button
3. Wait for templates to sync from WhatsApp API to `whatsapp_templates_v2` table

#### Option B: Using API Endpoint Directly
Call the sync endpoint:
```bash
POST /api/whatsapp/templates/sync
```

### Step 4: Verify Templates Were Synced
Check the table in Supabase:
```sql
SELECT id, name, language, whatsapp_template_id, active 
FROM whatsapp_templates_v2 
ORDER BY id;
```

You should see all your templates with auto-incrementing IDs (1, 2, 3, 4...)

### Step 5: Test Sending a Template Message
1. Go to **WhatsApp** page
2. Select a contact
3. Choose a template from the dropdown
4. Send the message
5. Check that `template_id` is saved correctly in `whatsapp_messages` table

### Step 6: Verify Template Matching
When you send a template message:
- Frontend sends `templateId` (the database `id` from `whatsapp_templates_v2`)
- Backend verifies it exists in `whatsapp_templates_v2`
- Backend saves `template_id` to `whatsapp_messages`
- Messages should display correct template content

## 🎯 Expected Result
- ✅ Templates synced to `whatsapp_templates_v2` table
- ✅ Template IDs are auto-incrementing (1, 2, 3, 4...)
- ✅ `template_id` saved correctly when sending messages
- ✅ Template content displays correctly in chat
- ✅ No more language/content mismatches

## 🔧 Troubleshooting

### If templates don't sync:
- Check backend logs for errors
- Verify WhatsApp API credentials are set
- Check that `/api/whatsapp/templates/sync` endpoint exists

### If template_id is NULL:
- Verify foreign key constraint is set correctly
- Check that `whatsapp_templates_v2` table has data
- Verify frontend is sending `templateId` correctly

### If wrong template content shows:
- Verify `content` column is populated in database
- Check that `template_id` matches the correct template in `whatsapp_templates_v2`

