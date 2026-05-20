const boiExchangeRatesService = require('./boiExchangeRatesService');

const SCHEDULER_ENABLED =
  (process.env.ENABLE_BOI_RATES_SCHEDULER || 'true').toLowerCase() !== 'false';

/** Hour in Asia/Jerusalem when the daily sync runs (default 6). */
const RUN_HOUR = Number(process.env.BOI_RATES_SYNC_HOUR_JERUSALEM || '6');
const RUN_MINUTE_WINDOW = 5;

let intervalHandle = null;
let isRunning = false;
let lastRunDateKey = null;

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

function shouldRunNow() {
  const { dateKey, hour, minute } = getJerusalemDateParts();
  if (lastRunDateKey === dateKey) return false;
  if (hour !== RUN_HOUR) return false;
  if (minute >= RUN_MINUTE_WINDOW) return false;
  return true;
}

const runSync = async (trigger = 'scheduled') => {
  if (isRunning) {
    console.log('⏸️  BOI exchange rates sync already running, skipping...');
    return;
  }

  isRunning = true;
  try {
    const result = await boiExchangeRatesService.syncBoiExchangeRates();
    const { dateKey } = getJerusalemDateParts();
    lastRunDateKey = dateKey;
    console.log(
      `💱 BOI rates sync (${trigger}) OK: fetched=${result.fetched} saved=${result.saved} date=${dateKey}`,
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
  if (!shouldRunNow()) return;
  try {
    await runSync('daily-6am-jerusalem');
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
    `⏰ BOI exchange rates scheduler: daily ~${RUN_HOUR}:00 Asia/Jerusalem (checks every 60s)`,
  );

  intervalHandle = setInterval(() => tick(), 60 * 1000);
  setTimeout(() => tick(), 15 * 1000);
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
  _internal: { runSync, shouldRunNow, getJerusalemDateParts },
};
