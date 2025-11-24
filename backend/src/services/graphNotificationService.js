const graphMailboxSyncService = require('./graphMailboxSyncService');

/**
 * Lightweight in-memory queue that coalesces webhook notifications per user.
 * Microsoft Graph can deliver multiple notifications for the same mailbox in
 * quick succession, so we keep a short-lived buffer and run at most one sync
 * per user at a time.
 */
class GraphNotificationService {
  constructor() {
    this.pendingUsers = new Set();
    this.activeUsers = new Set();
    this.flushTimer = null;
    this.defaultDebounceMs = Number(process.env.GRAPH_WEBHOOK_DEBOUNCE_MS || 1500);
  }

  /**
     * Queue a mailbox sync for a user. Multiple notifications within the debounce
     * window will be coalesced into a single execution.
     * @param {string|number} userId
     * @param {object} meta
     */
  enqueueUserSync(userId, meta = {}) {
    if (!userId) {
      return;
      }
    const key = String(userId);
    if (!this.pendingUsers.has(key) && !this.activeUsers.has(key)) {
      console.log(`📨 Graph webhook queued mailbox sync for user ${key}`, meta);
    } else {
      console.log(`⏳ Graph webhook coalescing additional event for user ${key}`);
    }
    this.pendingUsers.add(key);
    this._scheduleFlush();
  }

  _scheduleFlush() {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this._flushQueue().catch((err) =>
        console.error('❌ Graph notification queue flush failed:', err)
      );
    }, this.defaultDebounceMs);
  }

  async _flushQueue() {
    const usersToProcess = Array.from(this.pendingUsers);
    this.pendingUsers.clear();

    for (const userId of usersToProcess) {
      if (this.activeUsers.has(userId)) {
        // Already running; leave it queued so it runs again afterwards
        this.pendingUsers.add(userId);
        continue;
      }

      this.activeUsers.add(userId);
      this._runUserSync(userId)
        .catch((err) =>
          console.error(`❌ Graph webhook sync failed for user ${userId}:`, err.message || err)
        )
        .finally(() => {
          this.activeUsers.delete(userId);
          if (this.pendingUsers.has(userId)) {
            this._scheduleFlush();
          }
        });
    }
  }

  async _runUserSync(userId) {
    await graphMailboxSyncService.syncMailboxForUser(userId, { trigger: 'webhook' });
  }
}

module.exports = new GraphNotificationService();


