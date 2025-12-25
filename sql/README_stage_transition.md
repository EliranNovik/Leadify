# Stage Transition Logic - Database Triggers

This implementation uses PostgreSQL triggers to automatically evaluate and update lead stages based on interaction history.

## Files

1. **`stage_transition_function.sql`** - Main function that evaluates interactions and updates stages
2. **`stage_transition_triggers.sql`** - Triggers that call the function when interactions are saved

## Installation

Run these SQL files in order:

```sql
-- 1. First, create the function
\i sql/stage_transition_function.sql

-- 2. Then, create the triggers
\i sql/stage_transition_triggers.sql
```

## How It Works

### Stage 11 (Precommunication)

- **Conditions:**
  - Current stage must be 0 or 10
  - Any interaction exists (email, WhatsApp, call, or manual)
  - Only ONE direction (outbound OR inbound, not both)
  - No calls over 2 minutes duration

### Stage 15 (Communication Started)

- **Conditions:**
  - Current stage must be 0, 10, or 11
  - BOTH outbound AND inbound interactions exist
  - At least one call over 2 minutes duration

## Triggers

The following triggers automatically evaluate stages:

1. **`emails` table** - After INSERT or UPDATE
2. **`whatsapp_messages` table** - After INSERT or UPDATE
3. **`call_logs` table** - After INSERT or UPDATE
4. **`leads_leadinteractions` table** - After INSERT or UPDATE (legacy leads)
5. **`leads.manual_interactions`** - After UPDATE (new leads)

## Benefits

- **Automatic**: No need to call evaluation functions from frontend/backend
- **Consistent**: Works regardless of where interactions are saved
- **Reliable**: Database-level enforcement ensures stages are always up-to-date
- **Simple**: No need to remember to add evaluation calls everywhere

## Testing

After installing the triggers, test by:

1. Creating a lead in stage 0 or 10
2. Sending an email (outgoing)
3. The stage should automatically change to 11 (Precommunication)

Then:

1. Have the client reply (incoming email)
2. Log a call over 2 minutes
3. The stage should automatically change to 15 (Communication Started)
