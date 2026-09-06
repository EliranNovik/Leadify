const handlerNewCasesDigestService = require('./handlerNewCasesDigestService');

const SCHEDULER_ENABLED =
  (process.env.ENABLE_HANDLER_NEW_CASES_DIGEST_SCHEDULER || 'true').toLowerCase() !== 'false';

/** Hour in Asia/Jerusalem when the daily digest may run (default 10). */
const RUN_HOUR = Number(process.env.HANDLER_NEW_CASES_DIGEST_HOUR_JERUSALEM || '10');
/** End of daily send window in Asia/Jerusalem (default 11, same catch-up window as invoice automation). */
const RUN_END_HOUR = Number(process.env.HANDLER_NEW_CASES_DIGEST_END_HOUR_JERUSALEM || '11');
const TICK_MS = 60 * 1000;
const STARTUP_DELAY_MS = 25 * 1000;

let intervalHandle = null;
let isRunning = false;
/** Jerusalem calendar date (YYYY-MM-DD) when digest last completed with no send errors. */
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

function shouldRunDailyDigest() {
  const { dateKey, hour } = getJerusalemDateParts();
  if (lastSuccessDateKey === dateKey) return false;
  if (hour < RUN_HOUR) return false;
  if (hour > RUN_END_HOUR) return false;
  return true;
}

const runDigest = async (trigger = 'scheduled', options = {}) => {
  if (isRunning) {
    console.log('⏸️  Handler new-cases digest already running, skipping...');
    return null;
  }

  isRunning = true;
  try {
    const result = await handlerNewCasesDigestService.processHandlerNewCasesDigest(options);
    const { dateKey } = getJerusalemDateParts();
    if (!options.dryRun && result.errors.length === 0) {
      lastSuccessDateKey = dateKey;
    }
    console.log(
      `📨 Handler new-cases digest (${trigger}) date=${result.digestDate} handlers=${result.handlersChecked} withCases=${result.handlersWithCases} sent=${result.sent} errors=${result.errors.length}`,
    );
    return result;
  } catch (error) {
    console.error('❌ Handler new-cases digest failed:', error.message || error);
    throw error;
  } finally {
    isRunning = false;
  }
};

const tick = async () => {
  if (!shouldRunDailyDigest()) return;
  try {
    await runDigest('daily-jerusalem-10am');
  } catch {
    // logged in runDigest; retry on next tick until success
  }
};

const runStartupDigest = async () => {
  try {
    const { dateKey, hour } = getJerusalemDateParts();
    const inWindow = hour >= RUN_HOUR && hour <= RUN_END_HOUR;
    if (inWindow && lastSuccessDateKey !== dateKey) {
      await runDigest('startup-daily');
    }
  } catch {
    // logged in runDigest
  }
};

function startHandlerNewCasesDigestScheduler() {
  if (!SCHEDULER_ENABLED) {
    console.log(
      '⏸️  Handler new-cases digest scheduler disabled (ENABLE_HANDLER_NEW_CASES_DIGEST_SCHEDULER=false)',
    );
    return;
  }

  console.log(
    `⏰ Handler new-cases digest: daily between ${RUN_HOUR}:00–${RUN_END_HOUR}:59 Asia/Jerusalem`,
  );

  setTimeout(() => {
    void handlerNewCasesDigestService
      .getDigestRuntimeStatus()
      .then((status) => {
        console.log('📬 Handler new-cases digest ready', status);
      })
      .catch((error) => {
        console.warn(
          '⚠️  Handler new-cases digest readiness check failed:',
          error.message || error,
        );
      });
    void runStartupDigest();
  }, STARTUP_DELAY_MS);

  intervalHandle = setInterval(() => {
    void tick();
  }, TICK_MS);
}

function stopHandlerNewCasesDigestScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('⏹️  Handler new-cases digest scheduler stopped');
  }
}

module.exports = {
  startHandlerNewCasesDigestScheduler,
  stopHandlerNewCasesDigestScheduler,
  _internal: { runDigest, shouldRunDailyDigest, getJerusalemDateParts },
};
