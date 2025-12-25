# Fix for Stage Transition Triggers

## Problem

The stage transition trigger for "Communication Started" (stage 15) was not working when outbound and inbound interactions were saved. This was happening because:

1. **Multiple trigger fires**: When an email is saved with multiple rows (one per lead/contact), the trigger fires multiple times for the same lead, potentially causing race conditions.

2. **NULL handling**: The function wasn't properly handling NULL values in boolean operations, which could cause the logic to fail silently.

## Solution

### 1. Updated Triggers (`sql/stage_transition_triggers.sql`)

**For emails table:**

- Changed from row-level only to **row-level + statement-level** triggers
- Row-level trigger collects all leads that need evaluation in a temp table
- Statement-level trigger processes all collected leads once per INSERT/UPDATE statement
- This ensures each lead is evaluated only once, even when multiple email rows are inserted for the same lead

**For WhatsApp messages:**

- Applied the same row-level + statement-level trigger pattern

### 2. Fixed NULL Handling (`sql/stage_transition_function.sql`)

- Initialized all temp boolean variables with `:= FALSE`
- Added `COALESCE()` to all `OR` operations to handle potential NULL values
- This ensures boolean logic works correctly even if queries return NULL

### 3. Diagnostic Tool (`sql/diagnose_stage_transition.sql`)

Created a diagnostic query to help debug stage transition issues for specific leads.

## Deployment Steps

1. **Deploy the updated function:**

   ```sql
   -- Run sql/stage_transition_function.sql
   ```

2. **Deploy the updated triggers:**

   ```sql
   -- Run sql/stage_transition_triggers.sql
   ```

3. **Test with a specific lead:**
   ```sql
   -- Use sql/diagnose_stage_transition.sql to check interactions
   -- Then manually test: SELECT evaluate_and_update_stage('lead_id', true/false);
   ```

## How It Works Now

1. When an email is inserted with multiple rows (one per lead):

   - Row-level trigger fires for each row and adds the lead to a temp table (deduplicated)
   - Statement-level trigger fires once after all rows are inserted
   - Statement-level trigger processes all unique leads from the temp table
   - Each lead is evaluated only once, seeing all interactions

2. The function now properly:
   - Aggregates all interactions across all tables
   - Handles NULL values correctly
   - Checks for both outbound AND inbound interactions
   - Checks for calls over 2 minutes
   - Transitions to stage 15 when all conditions are met

## Expected Behavior

- **Stage 15 (Communication Started)**: Triggered when:

  - Current stage is 0, 10, or 11
  - Has at least one outbound interaction (email, WhatsApp, call, or manual)
  - Has at least one inbound interaction (email, WhatsApp, call, or manual)
  - Has at least one call over 2 minutes duration

- **Stage 11 (Precommunication)**: Triggered when:
  - Current stage is 0 or 10
  - Has at least one interaction
  - Has only one direction (outbound OR inbound, not both)
  - Has NO calls over 2 minutes
