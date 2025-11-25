# WhatsApp Template Matching Fix - Summary

## Problem
WhatsApp templates were being matched by name, but multiple templates can have the same name in different languages. This caused the UI to display the wrong template content (e.g., showing French instead of English).

## Solution
Changed template matching from name-based to ID-based matching using the database template ID from `whatsapp_whatsapptemplate.id`.

## Changes Made

### 1. Database Schema
**File: `sql/add_template_id_to_whatsapp_messages.sql`**
- Added `template_id` column (BIGINT) to `whatsapp_messages` table
- Added foreign key reference to `whatsapp_whatsapptemplate(id)`
- Added index for performance

**⚠️ ACTION REQUIRED:** Run this SQL migration:
```sql
-- Run this SQL script to add the template_id column
\i sql/add_template_id_to_whatsapp_messages.sql
```

### 2. Backend Changes
**File: `backend/src/controllers/whatsappController.js`**
- Updated `sendMessage` function to accept `templateId` in request body
- Added logic to look up template details by ID from database
- Store `template_id` when saving messages to database
- Still supports template name/language for WhatsApp API call (fetched from DB by ID)

### 3. Frontend Changes

#### WhatsAppPage.tsx
- Updated to send `templateId` when sending template messages
- Updated `WhatsAppMessage` interface to include `template_id?: number`
- Updated `processTemplateMessage` to prioritize matching by `template_id`, with fallback to name matching for legacy messages

#### WhatsAppLeadsPage.tsx
- Updated to send `templateId` when sending template messages
- Updated `processTemplateMessage` to prioritize matching by `template_id`, with fallback to name matching for legacy messages

#### SchedulerWhatsAppModal.tsx
- Updated to send `templateId` when sending template messages
- Updated `processTemplateMessage` to prioritize matching by `template_id`, with fallback to name matching for legacy messages

## How It Works

### Sending Templates
1. User selects a template in the UI
2. Frontend sends `templateId` (database ID) along with `templateName` and `templateLanguage` to backend
3. Backend looks up template by ID to get the correct `name360` and `language` for WhatsApp API
4. Backend stores `template_id` in `whatsapp_messages` table

### Displaying Templates
1. When displaying messages, check if `template_id` exists
2. If `template_id` exists, match by ID (most reliable)
3. If `template_id` is missing (legacy messages), fall back to name matching for backward compatibility

## Migration Notes

### Existing Messages
- Existing messages without `template_id` will continue to work using the name-based fallback matching
- New messages will have `template_id` stored and will match correctly

### No Breaking Changes
- All changes are backward compatible
- Legacy messages without `template_id` will still display (using name matching)
- New messages will have more accurate matching

## Testing Checklist
- [ ] Run SQL migration to add `template_id` column
- [ ] Send a new template message and verify it stores `template_id`
- [ ] Verify template content displays correctly in all WhatsApp pages/modals
- [ ] Verify legacy messages still display correctly (name-based fallback)
- [ ] Test with templates that have the same name in different languages

