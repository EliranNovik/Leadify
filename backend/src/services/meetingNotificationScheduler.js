const meetingNotificationService = require('./meetingNotificationService');

const DEFAULT_INTERVAL_MINUTES = Number(process.env.MEETING_NOTIFICATION_INTERVAL_MINUTES || '5');
const SCHEDULER_ENABLED = (process.env.ENABLE_MEETING_NOTIFICATION_SCHEDULER || 'true').toLowerCase() !== 'false';

let schedulerHandle = null;
let isRunning = false;

const runNotificationCheck = async (trigger = 'scheduled') => {
  if (isRunning) {
    console.log('⏸️  Meeting notification check already running, skipping...');
    return;
  }

  isRunning = true;
  try {
    const result = await meetingNotificationService.checkAndNotifyMeetings();
    if (result) {
      console.log(
        `🔔 Meeting notification check (${trigger}) completed: checked=${result.checked} notified=${result.notified}`
      );
    }
  } catch (error) {
    console.error('❌ Meeting notification check failed:', error.message || error);
  } finally {
    isRunning = false;
  }
};

function startMeetingNotificationScheduler() {
  if (!SCHEDULER_ENABLED) {
    console.log('⏸️  Meeting notification scheduler disabled via configuration');
    return;
  }

  const intervalMinutes = Number.isFinite(DEFAULT_INTERVAL_MINUTES) && DEFAULT_INTERVAL_MINUTES > 0
    ? DEFAULT_INTERVAL_MINUTES
    : 5;
  const intervalMs = intervalMinutes * 60 * 1000;

  console.log(`⏰ Meeting notification scheduler starting: interval=${intervalMinutes} minute(s)`);

  // Run initial check after 30 seconds (to let server start up)
  setTimeout(() => runNotificationCheck('initial'), 30 * 1000);
  
  // Then run every X minutes
  schedulerHandle = setInterval(() => runNotificationCheck('interval'), intervalMs);
}

function stopMeetingNotificationScheduler() {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
    console.log('⏹️  Meeting notification scheduler stopped');
  }
}

module.exports = {
  startMeetingNotificationScheduler,
  stopMeetingNotificationScheduler,
  _internal: {
    runNotificationCheck,
  },
};

