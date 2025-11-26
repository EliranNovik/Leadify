# Fix: Column "whatsapp_template_id" does not exist

## Problem
You're getting an error: `ERROR: 42703: column "whatsapp_template_id" does not exist`

## Why This Happens
This error occurs when:
1. The `whatsapp_templates` table doesn't exist yet
2. The table exists but was created incorrectly (missing the column)
3. A query is trying to access the old `whatsapp_whatsapptemplate` table which doesn't have this column

## Solution

### Step 1: Check if table exists
Run this query in your database:
```sql
SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'whatsapp_templates'
) AS table_exists;
```

### Step 2: Create the table
Run the safe setup script:
```sql
\i sql/check_and_create_whatsapp_templates.sql
```

Or manually create it:
```sql
CREATE TABLE IF NOT EXISTS whatsapp_templates (
    id BIGSERIAL PRIMARY KEY,
    whatsapp_template_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'en_US',
    content TEXT,
    params TEXT NOT NULL DEFAULT '0',
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_whatsapp_id ON whatsapp_templates(whatsapp_template_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_name_language ON whatsapp_templates(name, language);
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_active ON whatsapp_templates(active);
```

### Step 3: Verify table structure
```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'whatsapp_templates'
ORDER BY ordinal_position;
```

You should see:
- id (bigint)
- whatsapp_template_id (text)
- name (text)
- language (text)
- content (text)
- params (text)
- active (boolean)
- created_at (timestamp with time zone)
- updated_at (timestamp with time zone)

### Step 4: If table exists but is wrong
If the table exists but has the wrong structure, you can drop and recreate:

```sql
-- Backup data first if needed
-- CREATE TABLE whatsapp_templates_backup AS SELECT * FROM whatsapp_templates;

-- Drop the incorrect table
DROP TABLE IF EXISTS whatsapp_templates CASCADE;

-- Recreate with correct structure (use Step 2 above)
```

### Step 5: Sync templates
Once the table is created correctly, sync templates:
```bash
POST /api/whatsapp/templates/sync
```

## Common Issues

### Issue 1: Running migration before creating table
**Solution**: Always run `check_and_create_whatsapp_templates.sql` BEFORE running migration scripts.

### Issue 2: Query hitting old table
**Solution**: Make sure backend code checks for new table first (which it does with fallback).

### Issue 3: Column name typo
**Solution**: Double-check the column name is `whatsapp_template_id` (not `whatsappTemplateId` or `number_id`).

## Verification Checklist

- [ ] Table `whatsapp_templates` exists
- [ ] Column `whatsapp_template_id` exists
- [ ] Column `id` is BIGSERIAL (auto-incrementing)
- [ ] Indexes are created
- [ ] Can query: `SELECT * FROM whatsapp_templates LIMIT 1;`

After completing these steps, the error should be resolved!

