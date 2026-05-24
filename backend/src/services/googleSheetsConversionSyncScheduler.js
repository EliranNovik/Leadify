/**
 * Invokes BadLeads, QLeads, and HQLeads Google Sheet edge functions on a schedule.
 */
const DEFAULT_INTERVAL_MINUTES = Number(process.env.GOOGLE_SHEETS_CONVERSION_SYNC_INTERVAL_MINUTES || '60');
const SCHEDULER_ENABLED =
  (process.env.ENABLE_GOOGLE_SHEETS_CONVERSION_SYNC_SCHEDULER || 'true').toLowerCase() !== 'false';

let schedulerHandle = null;
let isRunning = false;

function resolveCronSecret() {
  return (
    process.env.GOOGLE_SHEETS_SYNC_CRON_SECRET?.trim() ||
    process.env.BAD_LEADS_SYNC_CRON_SECRET?.trim() ||
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

async function runSyncCycle(trigger = 'scheduled') {
  if (isRunning) {
    console.log('⏸️  Google Sheets conversion sync already running, skipping...');
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const cronSecret = resolveCronSecret();
  const invokeKey = resolveSupabaseInvokeKey();

  if (!supabaseUrl) {
    console.error('❌ Google Sheets conversion sync: SUPABASE_URL is not configured');
    return;
  }
  if (!invokeKey) {
    console.error(
      '❌ Google Sheets conversion sync: set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)',
    );
    return;
  }
  if (!cronSecret) {
    console.error(
      '❌ Google Sheets conversion sync: set GOOGLE_SHEETS_SYNC_CRON_SECRET (or BAD_LEADS_SYNC_CRON_SECRET)',
    );
    return;
  }

  isRunning = true;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/google-sheets-conversion-sync-all`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${invokeKey}`,
        apikey: invokeKey,
        'x-cron-secret': cronSecret,
      },
      body: JSON.stringify({ limit: 200 }),
    });

    const text = await res.text();
    let payload = {};
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text.slice(0, 300) };
    }

    if (!res.ok) {
      console.error(`❌ Google Sheets conversion sync (${trigger}) HTTP ${res.status}:`, payload);
      return;
    }

    console.log(
      `📊 Google Sheets conversion sync (${trigger}) OK: totalAppended=${payload.totalAppended ?? 0}`,
      payload.results?.map?.((r) => `${r.label}:${r.appended ?? 0}`).join(', ') ?? '',
    );
    return payload;
  } catch (error) {
    console.error('❌ Google Sheets conversion sync failed:', error.message || error);
    throw error;
  } finally {
    isRunning = false;
  }
}

function startGoogleSheetsConversionSyncScheduler() {
  if (!SCHEDULER_ENABLED) {
    console.log(
      '⏸️  Google Sheets conversion sync scheduler disabled (ENABLE_GOOGLE_SHEETS_CONVERSION_SYNC_SCHEDULER=false)',
    );
    return;
  }

  const intervalMinutes =
    Number.isFinite(DEFAULT_INTERVAL_MINUTES) && DEFAULT_INTERVAL_MINUTES > 0
      ? DEFAULT_INTERVAL_MINUTES
      : 60;
  const intervalMs = intervalMinutes * 60 * 1000;

  console.log(
    `⏰ Google Sheets conversion sync scheduler: every ${intervalMinutes} minute(s) (BadLeads + QLeads + HQLeads)`,
  );

  setTimeout(() => runSyncCycle('initial'), 30 * 1000);
  schedulerHandle = setInterval(() => runSyncCycle('interval'), intervalMs);
}

function stopGoogleSheetsConversionSyncScheduler() {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
    console.log('⏹️  Google Sheets conversion sync scheduler stopped');
  }
}

module.exports = {
  startGoogleSheetsConversionSyncScheduler,
  stopGoogleSheetsConversionSyncScheduler,
  _internal: { runSyncCycle },
};
