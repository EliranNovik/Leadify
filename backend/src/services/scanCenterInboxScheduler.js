const smartScanInboxService = require('./smartScanInboxService');

const SCHEDULER_ENABLED =
  String(process.env.ENABLE_SCAN_CENTER_SYNC_SCHEDULER || 'true').toLowerCase() !== 'false';
const INTERVAL_SECONDS = Number(process.env.SCAN_CENTER_SYNC_INTERVAL_SECONDS || '20');

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

  const seconds = Number.isFinite(INTERVAL_SECONDS) && INTERVAL_SECONDS > 0 ? INTERVAL_SECONDS : 20;
  console.log(`⏰ Scan Center auto-fetch starting: interval=${seconds}s`);

  setTimeout(() => {
    void runSyncCycle('initial');
  }, 8 * 1000);
  schedulerHandle = setInterval(() => {
    void runSyncCycle('interval');
  }, seconds * 1000);
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
