/**
 * Pulls new Facebook leads by invoking the fb-leads-import edge function.
 * The export secret is read from FB_LEADS_EXPORT_SECRET and forwarded only after
 * the cron secret check inside that function.
 */
const DEFAULT_INTERVAL_MINUTES = Number(process.env.FB_LEADS_IMPORT_INTERVAL_MINUTES || '5');
const SCHEDULER_ENABLED =
  (process.env.ENABLE_FB_LEADS_IMPORT_SCHEDULER || 'true').toLowerCase() !== 'false';

let schedulerHandle = null;
let isRunning = false;

function resolveCronSecret() {
  return (
    process.env.FB_LEADS_IMPORT_CRON_SECRET?.trim() ||
    process.env.GOOGLE_SHEETS_SYNC_CRON_SECRET?.trim() ||
    process.env.PAYMENT_PLAN_INVOICE_AUTOMATION_CRON_SECRET?.trim() ||
    null
  );
}

function resolveSupabaseInvokeKey() {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim() ||
    null
  );
}

async function runImportCycle(trigger = 'scheduled') {
  if (isRunning) {
    console.log('⏸️  Facebook lead import already running, skipping...');
    return null;
  }

  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const cronSecret = resolveCronSecret();
  const invokeKey = resolveSupabaseInvokeKey();
  const exportSecret = process.env.FB_LEADS_EXPORT_SECRET?.trim();

  if (!supabaseUrl) {
    console.error('❌ Facebook lead import: SUPABASE_URL is not configured');
    return null;
  }
  if (!invokeKey) {
    console.error('❌ Facebook lead import: set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)');
    return null;
  }
  if (!cronSecret) {
    console.error('❌ Facebook lead import: set FB_LEADS_IMPORT_CRON_SECRET or GOOGLE_SHEETS_SYNC_CRON_SECRET');
    return null;
  }
  if (!exportSecret) {
    console.error('❌ Facebook lead import: FB_LEADS_EXPORT_SECRET is not set');
    return null;
  }

  const limit = Number(process.env.FB_LEADS_IMPORT_LIMIT || '100');
  isRunning = true;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/fb-leads-import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${invokeKey}`,
        apikey: invokeKey,
        'x-cron-secret': cronSecret,
      },
      body: JSON.stringify({
        limit: Number.isFinite(limit) ? limit : 100,
        exportSecret,
        exportUrl: process.env.FB_LEADS_EXPORT_URL?.trim() || undefined,
        defaultSourceCode: process.env.FACEBOOK_DEFAULT_SOURCE_CODE || null,
        formSourceCodes: process.env.FACEBOOK_FORM_SOURCE_CODES || null,
      }),
    });

    const text = await res.text();
    let payload = {};
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text.slice(0, 300) };
    }

    if (!res.ok) {
      console.error(`❌ Facebook lead import (${trigger}) HTTP ${res.status}:`, payload.error || payload);
      return payload;
    }

    console.log(
      `📥 Facebook lead import (${trigger}) OK: created=${payload.created ?? 0} duplicates=${payload.duplicates ?? 0} skipped=${payload.skipped ?? 0} pages=${payload.pages ?? 0}`,
    );
    return payload;
  } catch (error) {
    console.error('❌ Facebook lead import failed:', error.message || error);
    return null;
  } finally {
    isRunning = false;
  }
}

function startFbLeadsImportScheduler() {
  if (!SCHEDULER_ENABLED) {
    console.log('⏸️  Facebook lead import scheduler disabled (ENABLE_FB_LEADS_IMPORT_SCHEDULER=false)');
    return;
  }

  if (!process.env.FB_LEADS_EXPORT_SECRET?.trim()) {
    console.log('⏸️  Facebook lead import waiting: set FB_LEADS_EXPORT_SECRET in backend/.env, then restart the backend');
    return;
  }

  const intervalMinutes =
    Number.isFinite(DEFAULT_INTERVAL_MINUTES) && DEFAULT_INTERVAL_MINUTES > 0
      ? DEFAULT_INTERVAL_MINUTES
      : 5;
  const intervalMs = intervalMinutes * 60 * 1000;

  console.log(`⏰ Facebook lead import scheduler: every ${intervalMinutes} minute(s)`);

  setTimeout(() => {
    void runImportCycle('initial').catch((error) => {
      console.error('❌ Facebook lead import initial run failed:', error?.message || error);
    });
  }, 30 * 1000);
  schedulerHandle = setInterval(() => {
    void runImportCycle('interval').catch((error) => {
      console.error('❌ Facebook lead import interval failed:', error?.message || error);
    });
  }, intervalMs);
}

function stopFbLeadsImportScheduler() {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
    console.log('⏹️  Facebook lead import scheduler stopped');
  }
}

module.exports = {
  startFbLeadsImportScheduler,
  stopFbLeadsImportScheduler,
  _internal: { runImportCycle },
};
