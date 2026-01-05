# Migration Script: src_leads_leadinteractions → leads_leadinteractions

## Overview
This migration copies missing interaction entries from `src_leads_leadinteractions` to `leads_leadinteractions`, comparing entries based on `lead_id` and key fields to avoid duplicates.

## Files

1. **`compare_src_to_leads_leadinteractions.sql`** - Analysis script to preview missing entries
2. **`migrate_src_to_leads_leadinteractions.sql`** - Migration script to copy missing entries

## How It Works

### Comparison Logic
The scripts compare interactions using a "fingerprint" based on:
- `lead_id` (must match)
- `kind`
- `date`
- `time`
- `content`
- `cdate`

All fields are normalized (LOWER + TRIM) to handle case/whitespace differences.

### Data Type Conversions
- `id`: Auto-generated in target (not copied from source)
- `cdate`/`udate`: Text → TIMESTAMPTZ (with safe parsing)
- `minutes`: Text → BIGINT
- `creator_id`/`employee_id`: Text → BIGINT (NULL if empty)
- Other text fields: Copied as-is (NULL if empty)

## Usage Instructions

### Step 1: Analyze Missing Entries
Run the comparison script first to see what will be migrated:

```sql
-- Run: compare_src_to_leads_leadinteractions.sql
```

This will show:
- Total counts in both tables
- Number of missing entries per `lead_id`
- Sample of missing entries (first 50)

### Step 2: Review Results
Check the output to ensure:
- The counts look reasonable
- The sample entries appear correct
- No unexpected data is being included

### Step 3: Run Migration
Once satisfied with the analysis, run the migration:

```sql
-- Run: migrate_src_to_leads_leadinteractions.sql
```

This will:
1. Create a helper function for safe timestamp parsing
2. Identify missing entries
3. Insert them into `leads_leadinteractions`
4. Report the number of rows inserted

### Step 4: Verify
After migration, verify the results:

```sql
-- Check counts
SELECT COUNT(*) FROM leads_leadinteractions;

-- Check a sample lead_id
SELECT * FROM leads_leadinteractions 
WHERE lead_id = <some_lead_id> 
ORDER BY cdate DESC 
LIMIT 20;
```

## Notes

- Only numeric `lead_id` values are processed (regex filter: `^[0-9]+$`)
- Only interactions for `lead_id`s that already have at least one interaction in the target table are migrated (to ensure referential integrity)
- The `id` field is auto-generated (sequence), so source IDs are not preserved
- Timestamp parsing handles various formats gracefully (returns NULL if unparseable)
- Empty strings are converted to NULL for consistency

## Important Considerations

⚠️ **Before running the migration:**
1. Backup the `leads_leadinteractions` table
2. Test on a small subset first (you can add a `LIMIT` clause to the INSERT)
3. Verify the comparison logic works as expected
4. Check for any foreign key constraints or triggers that might affect the insert

## Troubleshooting

If you encounter errors:

1. **Timestamp parsing errors**: The `safe_parse_timestamp` function returns NULL for unparseable dates. This is expected and safe.

2. **Foreign key violations**: Ensure the `lead_id` values exist in the `leads_lead` table (or wherever the foreign key points).

3. **Duplicate key errors**: If you see duplicate key errors on `id`, it means the sequence needs to be updated. Run:
   ```sql
   SELECT setval('leads_leadinteractions_id_seq', (SELECT MAX(id) FROM leads_leadinteractions));
   ```

4. **RLS policy violations**: Ensure your user has INSERT permissions on `leads_leadinteractions`.

