const boiExchangeRatesService = require('./boiExchangeRatesService');

const SCHEDULER_ENABLED =
  (process.env.ENABLE_BOI_RATES_SCHEDULER || 'true').toLowerCase() !== 'false';

/** Hour in Asia/Jerusalem when the daily sync may run (default 6). */
const RUN_HOUR = Number(process.env.BOI_RATES_SYNC_HOUR_JERUSALEM || '6');
/** Hour in Asia/Jerusalem when the daily sync window ends (default 10). */
const RUN_END_HOUR = Number(process.env.BOI_RATES_SYNC_END_HOUR_JERUSALEM || '10');
const TICK_MS = 60 * 1000;
const STARTUP_DELAY_MS = 15 * 1000;

let intervalHandle = null;
let isRunning = false;
/** Jerusalem calendar date (YYYY-MM-DD) when sync last succeeded. */
let lastSuccessDateKey = null;

function getJerusalemDateParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
  };
}

function shouldRunDailySync() {
  const { dateKey, hour } = getJerusalemDateParts();
  if (lastSuccessDateKey === dateKey) return false;
  if (hour < RUN_HOUR) return false;
  if (hour > RUN_END_HOUR) return false;
  return true;
}

const runSync = async (trigger = 'scheduled') => {
  if (isRunning) {
    console.log('⏸️  BOI exchange rates sync already running, skipping...');
    return null;
  }

  isRunning = true;
  try {
    const result = await boiExchangeRatesService.syncBoiExchangeRates();
    const { dateKey } = getJerusalemDateParts();
    lastSuccessDateKey = dateKey;
    const pubDate = result.boiPublicationDate || 'unknown';
    console.log(
      `💱 BOI rates sync (${trigger}) OK: fetched=${result.fetched} saved=${result.saved} boiDate=${pubDate}`,
    );
    return result;
  } catch (error) {
    console.error('❌ BOI exchange rates sync failed:', error.message || error);
    throw error;
  } finally {
    isRunning = false;
  }
};

const tick = async () => {
  if (!shouldRunDailySync()) return;
  try {
    await runSync('daily-jerusalem');
  } catch {
    // logged in runSync; retry on next tick until success sets lastSuccessDateKey
  }
};

const runStartupSync = async () => {
  try {
    const status = await boiExchangeRatesService.getSyncStatus();
    // Restrict scheduler-driven BOI fetching to the morning window, to avoid unpredictable
    // daytime syncs that can affect payments/plans.
    const { dateKey, hour } = getJerusalemDateParts();
    const inWindow = hour >= RUN_HOUR && hour <= RUN_END_HOUR;

    if (status.needsSync && inWindow) {
      console.log(
        `💱 BOI startup sync: DB=${status.dbLatestDate || 'empty'} BOI=${status.boiLatestDate || 'unknown'}`,
      );
      await runSync('startup-stale');
      return;
    }

    if (inWindow && lastSuccessDateKey !== dateKey) {
      await runSync('startup-daily');
    }
  } catch {
    // logged in runSync
  }
};

function startBoiExchangeRatesScheduler() {
  if (!SCHEDULER_ENABLED) {
    console.log('⏸️  BOI exchange rates scheduler disabled (ENABLE_BOI_RATES_SCHEDULER=false)');
    return;
  }

  console.log(
    `⏰ BOI exchange rates scheduler: daily between ${RUN_HOUR}:00–${RUN_END_HOUR}:59 Asia/Jerusalem + stale check on startup`,
  );

  setTimeout(() => {
    void runStartupSync();
  }, STARTUP_DELAY_MS);

  intervalHandle = setInterval(() => {
    void tick();
  }, TICK_MS);
}

function stopBoiExchangeRatesScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('⏹️  BOI exchange rates scheduler stopped');
  }
}

module.exports = {
  startBoiExchangeRatesScheduler,
  stopBoiExchangeRatesScheduler,
  _internal: { runSync, shouldRunDailySync, getJerusalemDateParts, runStartupSync },
};
