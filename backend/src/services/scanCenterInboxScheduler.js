const smartScanInboxService = require('./smartScanInboxService');
const graphMailboxSyncService = require('./graphMailboxSyncService');

const SCHEDULER_ENABLED =
  String(process.env.ENABLE_SCAN_CENTER_SYNC_SCHEDULER || 'true').toLowerCase() !== 'false';
const WEBHOOK_URL = String(process.env.GRAPH_WEBHOOK_NOTIFICATION_URL || '').trim();

function resolveIntervalMs() {
  const minutes = Number.parseInt(process.env.SCAN_CENTER_SYNC_INTERVAL_MINUTES || '', 10);
  if (Number.isFinite(minutes) && minutes > 0) return minutes * 60 * 1000;
  const seconds = Number.parseInt(process.env.SCAN_CENTER_SYNC_INTERVAL_SECONDS || '', 10);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  // With a webhook configured, push delivers new mail and this loop is only a safety
  // net: it renews the Graph subscription (capped at ~2.9 days) and recovers
  // notifications dropped while the instance was spun down. Every cycle costs a
  // mailbox_tokens read plus a delta round trip, so keep it slow.
  if (WEBHOOK_URL) return 15 * 60 * 1000;
  // No webhook means this poll is the only way new mail arrives.
  return 20 * 1000;
}

let schedulerHandle = null;
let isRunning = false;
let lastFingerprint = '';

function fingerprint(items = []) {
  return items
    .map((item) => `${item.id}:${item.status}:${item.processedAt || ''}`)
    .sort()
    .join('|');
}

async function runSyncCycle(trigger = 'scheduled') {
  if (isRunning) return { skipped: true };
  isRunning = true;
  try {
    if (trigger !== 'webhook') {
      const push = await graphMailboxSyncService.ensureScanCenterPush().catch((error) => {
        console.warn('⚠️  Scan Center Graph subscription ensure failed:', error.message || error);
        return null;
      });
      if (push && !push.skipped) {
        console.log(
          `🔔 Scan Center Graph push ${push.created ? 'created' : push.renewed ? 'renewed' : 'ready'}`
        );
      }
    }

    const data = await smartScanInboxService.listInbox({ sync: true });
    const items = data?.items || [];
    const next = fingerprint(items);
    if (next !== lastFingerprint) {
      lastFingerprint = next;
      const processing = items.filter((item) => item.status === 'processing').length;
      console.log(
        `📎 Scan Center auto-fetch (${trigger}) items=${items.length} processing=${processing}`,
      );
    }
    return { skipped: false, items: items.length };
  } catch (error) {
    console.error('❌ Scan Center auto-fetch failed:', error.message || error);
    return { skipped: false, error: error.message || String(error) };
  } finally {
    isRunning = false;
  }
}

function startScanCenterInboxScheduler() {
  if (!SCHEDULER_ENABLED) {
    console.log('⏸️  Scan Center auto-fetch disabled (ENABLE_SCAN_CENTER_SYNC_SCHEDULER=false)');
    return;
  }

  const intervalMs = resolveIntervalMs();
  const intervalLabel =
    intervalMs >= 60_000
      ? `${Math.round(intervalMs / 60_000)}m`
      : `${Math.round(intervalMs / 1000)}s`;
  let webhookHost = '';
  try {
    webhookHost = WEBHOOK_URL ? new URL(WEBHOOK_URL).host : '';
  } catch {
    webhookHost = WEBHOOK_URL;
  }
  if (WEBHOOK_URL) {
    console.log(
      `⏰ Scan Center auto-fetch: Graph delta every ${intervalLabel}; webhook host=${webhookHost}`
    );
  } else {
    console.log(
      `⏰ Scan Center auto-fetch: GRAPH_WEBHOOK_NOTIFICATION_URL unset, polling every ${intervalLabel}`
    );
  }

  setTimeout(() => {
    void runSyncCycle('initial');
  }, 8 * 1000);
  schedulerHandle = setInterval(() => {
    void runSyncCycle('interval');
  }, intervalMs);
}

function stopScanCenterInboxScheduler() {
  if (!schedulerHandle) return;
  clearInterval(schedulerHandle);
  schedulerHandle = null;
  console.log('⏹️  Scan Center auto-fetch stopped');
}

module.exports = {
  startScanCenterInboxScheduler,
  stopScanCenterInboxScheduler,
  runSyncCycle,
};
