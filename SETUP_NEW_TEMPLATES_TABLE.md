# Setup Guide: New WhatsApp Templates Table

## Overview
This guide will help you set up the new simplified `whatsapp_templates` table with auto-incrementing IDs and automated template syncing.

## Step 1: Create New Table

Run the SQL script to create the new table:

```sql
\i sql/create_whatsapp_templates_new.sql
```

This creates:
- `whatsapp_templates` table with auto-incrementing `id` (1, 2, 3, 4...)
- `whatsapp_template_id` column stores the actual WhatsApp template ID from Meta API
- Essential columns only: id, whatsapp_template_id, name, language, content, params, active

## Step 2: Sync Templates from WhatsApp API

The new sync service will automatically:
1. Fetch templates from WhatsApp API
2. Store them in the new table with auto-incrementing IDs
3. Update existing templates or insert new ones

### Manual Sync (via API):
```bash
POST /api/whatsapp/templates/sync
```

### Automated Sync (Webhook/CRON):
You can set up a webhook or scheduled job to call this endpoint periodically.

## Step 3: Migrate Existing Data (Optional)

If you have existing templates in `whatsapp_whatsapptemplate`, migrate them:

```sql
\i sql/migrate_whatsapp_templates.sql
```

## Step 4: Update Foreign Key Constraint

Update the foreign key in `whatsapp_messages` to point to the new table:

```sql
\i sql/update_whatsapp_messages_fk.sql
```

## Step 5: Test

1. **Sync templates:**
   ```bash
   curl -X POST http://your-backend-url/api/whatsapp/templates/sync
   ```

2. **Check templates in database:**
   ```sql
   SELECT id, whatsapp_template_id, name, language, active FROM whatsapp_templates ORDER BY id;
   ```

3. **Send a template message** and verify `template_id` is saved correctly.

## How It Works

### Database Structure:
```
whatsapp_templates:
  id (BIGSERIAL) → 1, 2, 3, 4... (auto-incrementing)
  whatsapp_template_id (TEXT) → "123456789" (WhatsApp API ID)
  name (TEXT) → "email_request"
  language (TEXT) → "en_US"
  content (TEXT) → Template body text
  params (TEXT) → "0" or "1"
  active (BOOLEAN) → true/false
```

### Flow:
1. **Template Sync** (automated):
   - Fetches templates from WhatsApp API
   - Stores in `whatsapp_templates` with auto-incrementing `id`
   - Updates existing or inserts new

2. **Frontend Display**:
   - Fetches templates from `whatsapp_templates`
   - Shows in dropdown with database `id`

3. **Send Message**:
   - User selects template
   - Frontend sends `templateId: database_id` (e.g., 1, 2, 3)
   - Backend verifies ID exists
   - Saves `template_id: database_id` in `whatsapp_messages`

4. **WhatsApp API Call**:
   - Backend looks up template by database `id`
   - Gets `whatsapp_template_id`, `name`, `language`
   - Uses these to send via WhatsApp API

## Automated Sync Setup

### Option 1: Webhook from Meta (Recommended)
Set up a webhook in Meta Business Manager that triggers template sync when templates are created/updated.

### Option 2: Scheduled CRON Job
Set up a CRON job to call `/api/whatsapp/templates/sync` periodically (e.g., daily).

### Option 3: Manual Sync
Add a "Sync Templates" button in the admin page that calls the sync endpoint.

## Troubleshooting

### Templates not syncing:
- Check WhatsApp API credentials
- Verify WABA_ID is correct
- Check backend logs for errors

### Template ID not saving:
- Verify foreign key constraint is updated
- Check that template exists in `whatsapp_templates` table
- Ensure template `active = true`

### Wrong template sent:
- Verify `whatsapp_template_id` matches WhatsApp API template ID
- Check `name` and `language` fields are correct
- Ensure template is approved in Meta Business Manager

