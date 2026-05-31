const {
  reconcileStalePaymentLinks,
} = require('./pelecardPaymentReconciliationService');

const SCHEDULER_ENABLED =
  (process.env.ENABLE_PELECARD_RECONCILE_SCHEDULER || 'true').toLowerCase() !== 'false';

const TICK_MS = Number(process.env.PELECARD_RECONCILE_TICK_MS || String(5 * 60 * 1000));
const STARTUP_DELAY_MS = Number(process.env.PELECARD_RECONCILE_STARTUP_DELAY_MS || '45000');

let intervalHandle = null;
let isRunning = false;

async function runReconciliation(trigger = 'scheduled') {
  if (isRunning) {
    console.log('[Pelecard] Reconciliation already running, skipping…');
    return null;
  }
  isRunning = true;
  try {
    return await reconcileStalePaymentLinks({ trigger });
  } catch (error) {
    console.error('[Pelecard] Reconciliation scheduler error:', error.message || error);
    return { ok: false, error };
  } finally {
    isRunning = false;
  }
}

function startPelecardPaymentReconciliationScheduler() {
  if (!SCHEDULER_ENABLED) {
    console.log('[Pelecard] Reconciliation scheduler disabled (ENABLE_PELECARD_RECONCILE_SCHEDULER=false)');
    return;
  }

  console.log(
    `[Pelecard] Reconciliation scheduler: every ${Math.round(TICK_MS / 60000)} min (startup in ${STARTUP_DELAY_MS}ms)`,
  );

  setTimeout(() => {
    void runReconciliation('startup');
  }, STARTUP_DELAY_MS);

  intervalHandle = setInterval(() => {
    void runReconciliation('interval');
  }, TICK_MS);
}

function stopPelecardPaymentReconciliationScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = {
  startPelecardPaymentReconciliationScheduler,
  stopPelecardPaymentReconciliationScheduler,
  runReconciliation,
};
