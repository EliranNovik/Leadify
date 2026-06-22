const nineHourAutoClockOutService = require('./nineHourAutoClockOutService');

const SCHEDULER_ENABLED =
  (process.env.ENABLE_NINE_HOUR_AUTO_CLOCKOUT_SCHEDULER || 'true').toLowerCase() !== 'false';
const DEFAULT_INTERVAL_MINUTES = Number(process.env.NINE_HOUR_AUTO_CLOCKOUT_INTERVAL_MINUTES || '1');

let schedulerHandle = null;
let isRunning = false;

const runAutoClockOut = async (trigger = 'scheduled') => {
  if (isRunning) {
    console.log('⏸️  Nine-hour auto clock-out already running, skipping...');
    return null;
  }

  isRunning = true;
  try {
    const result = await nineHourAutoClockOutService.runNineHourAutoClockOut();
    if (result.checked > 0 || result.clockedOut > 0 || result.errors.length > 0) {
      console.log(
        `⏱️  Nine-hour auto clock-out (${trigger}): checked=${result.checked} clockedOut=${result.clockedOut} signedOut=${result.signedOut} whatsappSent=${result.whatsappSent ?? 0} skipped=${result.skipped} errors=${result.errors.length}`,
      );
    }
    return result;
  } catch (error) {
    console.error('❌ Nine-hour auto clock-out failed:', error.message || error);
    return null;
  } finally {
    isRunning = false;
  }
};

function startNineHourAutoClockOutScheduler() {
  if (!SCHEDULER_ENABLED) {
    console.log('⏸️  Nine-hour auto clock-out scheduler disabled (ENABLE_NINE_HOUR_AUTO_CLOCKOUT_SCHEDULER=false)');
    return;
  }

  const intervalMinutes =
    Number.isFinite(DEFAULT_INTERVAL_MINUTES) && DEFAULT_INTERVAL_MINUTES > 0
      ? DEFAULT_INTERVAL_MINUTES
      : 1;
  const intervalMs = intervalMinutes * 60 * 1000;

  console.log(`⏰ Nine-hour auto clock-out scheduler: every ${intervalMinutes} minute(s)`);

  setTimeout(() => runAutoClockOut('initial'), 30 * 1000);
  schedulerHandle = setInterval(() => runAutoClockOut('interval'), intervalMs);
}

function stopNineHourAutoClockOutScheduler() {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
    console.log('⏹️  Nine-hour auto clock-out scheduler stopped');
  }
}

module.exports = {
  startNineHourAutoClockOutScheduler,
  stopNineHourAutoClockOutScheduler,
  _internal: {
    runAutoClockOut,
  },
};
