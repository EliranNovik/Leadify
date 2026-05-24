-- =============================================================================
-- Schedule automatic Google Sheets conversion exports (BadLeads, QLeads, HQLeads)
-- =============================================================================
-- Prerequisites:
--   1. Deploy edge function: google-sheets-conversion-sync-all
--   2. Set GOOGLE_SHEETS_SYNC_CRON_SECRET in Supabase Edge Function secrets
--   3. Store project URL + cron secret in Vault (recommended)
--
-- Alternative: backend scheduler (Render) — ENABLE_GOOGLE_SHEETS_CONVERSION_SYNC_SCHEDULER=true
-- =============================================================================

-- Enable extensions (safe if already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- One-time Vault setup (run manually with your values; do NOT commit secrets):
-- SELECT vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'google_sheets_project_url');
-- SELECT vault.create_secret('YOUR_GOOGLE_SHEETS_SYNC_CRON_SECRET', 'google_sheets_sync_cron_secret');
-- SELECT vault.create_secret('YOUR_SUPABASE_SERVICE_ROLE_KEY', 'google_sheets_supabase_service_role_key');

-- Remove previous job if re-applying
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'google-sheets-conversion-sync-all';

-- Every hour: invoke orchestrator edge function
SELECT cron.schedule(
  'google-sheets-conversion-sync-all',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'google_sheets_project_url'
    ) || '/functions/v1/google-sheets-conversion-sync-all',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'google_sheets_supabase_service_role_key'
      ),
      'apikey', (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'google_sheets_supabase_service_role_key'
      ),
      'x-cron-secret', (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'google_sheets_sync_cron_secret'
      )
    ),
    body := '{"limit":200}'::jsonb,
    timeout_milliseconds := 120000
  ) AS request_id;
  $$
);

COMMENT ON EXTENSION pg_cron IS 'Used for scheduled Google Sheets conversion sync (see schedule_google_sheets_conversion_sync_cron.sql).';
