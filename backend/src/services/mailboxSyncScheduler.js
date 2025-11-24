const graphMailboxSyncService = require('./graphMailboxSyncService');

const DEFAULT_INTERVAL_MINUTES = Number(process.env.MAILBOX_SYNC_INTERVAL_MINUTES || '10');
const SCHEDULER_ENABLED = (process.env.ENABLE_MAILBOX_SCHEDULER || 'true').toLowerCase() !== 'false';

let schedulerHandle = null;
let isRunning = false;

const runSyncCycle = async (trigger = 'scheduled') => {
  if (isRunning) {
    return;
  }

  isRunning = true;
  try {
    const summary = await graphMailboxSyncService.syncAllMailboxes({ trigger });
    if (summary) {
      console.log(
        `📬 Mailbox scheduler run (${trigger}) completed: processed=${summary.processed} success=${summary.successful} failed=${summary.failed}`
      );
    }
  } catch (error) {
    console.error('❌ Mailbox scheduler run failed:', error.message || error);
  } finally {
    isRunning = false;
  }
};

function startMailboxSyncScheduler() {
  if (!SCHEDULER_ENABLED) {
    console.log('⏸️  Mailbox scheduler disabled via configuration');
    return;
  }

  const intervalMinutes = Number.isFinite(DEFAULT_INTERVAL_MINUTES) && DEFAULT_INTERVAL_MINUTES > 0
    ? DEFAULT_INTERVAL_MINUTES
    : 5;
  const intervalMs = intervalMinutes * 60 * 1000;

  console.log(`⏰ Mailbox scheduler starting: interval=${intervalMinutes} minute(s)`);

  setTimeout(() => runSyncCycle('initial'), 10 * 1000);
  schedulerHandle = setInterval(() => runSyncCycle('interval'), intervalMs);
}

function stopMailboxSyncScheduler() {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
    console.log('⏹️  Mailbox scheduler stopped');
  }
}

module.exports = {
  startMailboxSyncScheduler,
  stopMailboxSyncScheduler,
  _internal: {
    runSyncCycle,
  },
};

