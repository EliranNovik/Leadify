# Fix for Foreign Key Constraint Error

## Problem

The error was:

```
insert or update on table "whatsapp_messages" violates foreign key constraint "whatsapp_messages_template_id_fkey"
Key (template_id)=(20) is not present in table "whatsapp_whatsapptemplate"
```

## Root Cause

1. Frontend fetches templates from WhatsApp API
2. Templates are assigned fake sequential IDs (`id: index + 1`)
3. These fake IDs don't match actual database IDs
4. When saving, the foreign key constraint fails

## Solution Implemented

### Frontend (`src/lib/whatsappTemplates.ts`)

- ✅ Fetches templates from database to get real IDs
- ✅ Matches API templates to database templates by `name360 + language`
- ✅ Uses real database ID if found, otherwise placeholder (negative ID)

### Backend (`backend/src/controllers/whatsappController.js`)

- ✅ Verifies template exists in database by ID first
- ✅ If ID lookup fails, looks up by `name360 + language`
- ✅ Falls back to lookup by `name360` only
- ✅ Only saves `template_id` if a valid database ID is found
- ✅ Saves `NULL` if template not found (foreign key allows NULL)

## Foreign Key Constraint

The SQL already allows NULL:

```sql
ALTER TABLE whatsapp_messages
ADD COLUMN IF NOT EXISTS template_id BIGINT
REFERENCES whatsapp_whatsapptemplate(id) ON DELETE SET NULL;
```

The `ON DELETE SET NULL` means NULL is allowed.

## Next Steps

1. **Deploy backend changes** to Render.com
2. **Test sending a template message**
3. The backend will now:
   - Look up the correct database template ID by name+language
   - Save it if found
   - Save NULL if not found (avoiding foreign key errors)

## What Changed

**Before:**

- Frontend sends fake ID (20)
- Backend tries to save ID 20
- Foreign key error ❌

**After:**

- Frontend sends fake ID (20) OR real database ID
- Backend looks up template by name+language
- Backend finds real database ID
- Backend saves real database ID ✅
- OR saves NULL if template not in database yet ✅
