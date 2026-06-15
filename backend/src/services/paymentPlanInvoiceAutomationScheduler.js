const paymentPlanInvoiceAutomationService = require('./paymentPlanInvoiceAutomationService');

const SCHEDULER_ENABLED =
  (process.env.ENABLE_PAYMENT_PLAN_INVOICE_AUTOMATION_SCHEDULER || 'true').toLowerCase() !== 'false';

/** Hour in Asia/Jerusalem when due-date sends may run (default 8). */
const RUN_HOUR = Number(process.env.PAYMENT_PLAN_INVOICE_AUTOMATION_HOUR_JERUSALEM || '8');
/** End of daily send window in Asia/Jerusalem (default 11). */
const RUN_END_HOUR = Number(process.env.PAYMENT_PLAN_INVOICE_AUTOMATION_END_HOUR_JERUSALEM || '11');
const TICK_MS = 60 * 1000;
const STARTUP_DELAY_MS = 20 * 1000;

let intervalHandle = null;
let isRunning = false;
/** Jerusalem calendar date (YYYY-MM-DD) when automation last completed successfully. */
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

function shouldRunDailyAutomation() {
  const { dateKey, hour } = getJerusalemDateParts();
  if (lastSuccessDateKey === dateKey) return false;
  if (hour < RUN_HOUR) return false;
  if (hour > RUN_END_HOUR) return false;
  return true;
}

const runAutomation = async (trigger = 'scheduled', options = {}) => {
  if (isRunning) {
    console.log('⏸️  Payment plan invoice automation already running, skipping...');
    return null;
  }

  isRunning = true;
  try {
    const result = await paymentPlanInvoiceAutomationService.processDueInvoiceAutomations(options);
    const { dateKey } = getJerusalemDateParts();
    if (!options.dryRun && result.errors.length === 0) {
      lastSuccessDateKey = dateKey;
    }
    console.log(
      `📨 Invoice automation (${trigger}) due=${result.dueDate} modern=${result.pendingModern} legacy=${result.pendingLegacy} sent=${result.sent} errors=${result.errors.length}`,
    );
    return result;
  } catch (error) {
    console.error('❌ Payment plan invoice automation failed:', error.message || error);
    throw error;
  } finally {
    isRunning = false;
  }
};

const tick = async () => {
  if (!shouldRunDailyAutomation()) return;
  try {
    await runAutomation('daily-jerusalem');
  } catch {
    // logged in runAutomation; retry on next tick until success
  }
};

const runStartupAutomation = async () => {
  try {
    const { dateKey, hour } = getJerusalemDateParts();
    const inWindow = hour >= RUN_HOUR && hour <= RUN_END_HOUR;
    if (inWindow && lastSuccessDateKey !== dateKey) {
      await runAutomation('startup-daily');
    }
  } catch {
    // logged in runAutomation
  }
};

function startPaymentPlanInvoiceAutomationScheduler() {
  if (!SCHEDULER_ENABLED) {
    console.log(
      '⏸️  Payment plan invoice automation scheduler disabled (ENABLE_PAYMENT_PLAN_INVOICE_AUTOMATION_SCHEDULER=false)',
    );
    return;
  }

  console.log(
    `⏰ Payment plan invoice automation: daily between ${RUN_HOUR}:00–${RUN_END_HOUR}:59 Asia/Jerusalem`,
  );

  setTimeout(() => {
    void runStartupAutomation();
  }, STARTUP_DELAY_MS);

  intervalHandle = setInterval(() => {
    void tick();
  }, TICK_MS);
}

function stopPaymentPlanInvoiceAutomationScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('⏹️  Payment plan invoice automation scheduler stopped');
  }
}

module.exports = {
  startPaymentPlanInvoiceAutomationScheduler,
  stopPaymentPlanInvoiceAutomationScheduler,
  _internal: { runAutomation, shouldRunDailyAutomation, getJerusalemDateParts },
};
