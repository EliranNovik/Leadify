# Template Matching Fix - Using WhatsApp Template ID (number_id)

## Problem

Templates were being matched by name and language, which is unreliable because:

1. Multiple templates can have the same name in different languages
2. Name matching can fail if names don't match exactly
3. The WhatsApp template ID (`number_id`) is the unique identifier we should use

## Solution

Match templates by WhatsApp template ID (`number_id`) which is stored in the database and comes from the WhatsApp API template `id` field.

## How It Works

### Database Structure

- `id` = Database primary key (bigint)
- `number_id` = WhatsApp template ID from API (bigint, unique)
- `name360` = Template name
- `language` = Template language code

### Frontend Matching (`src/lib/whatsappTemplates.ts`)

1. Fetch templates from both API and database
2. **PRIMARY MATCH**: Match API templates to database templates by WhatsApp template ID
   - API template `id` field = Database `number_id` field
   - This is the most reliable way to match
3. **FALLBACK**: If not found by WhatsApp ID, match by name+language
4. Return database `id` (primary key) to use when sending messages

### Backend Matching (`backend/src/controllers/whatsappController.js`)

1. **PRIORITY 1**: Look up by database `id` (from frontend)
2. **PRIORITY 2**: Look up by `name360 + language`
3. **FALLBACK**: Try various name/language combinations
4. Save `template_id` as database `id` if found, otherwise NULL

## Key Changes

### Frontend

- ✅ Match API templates to database templates by WhatsApp template ID (`number_id`)
- ✅ Store `number_id` in template object
- ✅ Return database `id` (primary key) for template matching

### Backend

- ✅ Look up templates by database `id` first
- ✅ Fall back to name+language matching
- ✅ Better logging for debugging template matching issues

## Next Steps

After deploying:

1. Test sending a template message
2. Check logs to see if templates are matched correctly
3. Verify `template_id` is saved in `whatsapp_messages` table
