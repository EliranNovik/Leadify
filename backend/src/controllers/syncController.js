const graphMailboxSyncService = require('../services/graphMailboxSyncService');

const syncController = {
  async syncNow(req, res) {
    try {
      const { userId, reset } = req.body || req.query;
      if (!userId) {
        return res.status(400).json({ success: false, error: 'userId is required' });
      }
      const summary = await graphMailboxSyncService.syncMailboxForUser(userId, { reset: Boolean(reset) });
      res.status(200).json({ success: true, data: summary });
    } catch (error) {
      console.error('❌ Manual sync error:', error);
      // Return 401 for expired refresh tokens so frontend can prompt for reconnection
      const statusCode = error.message?.includes('expired') || error.message?.includes('reconnect') ? 401 : 500;
      res.status(statusCode).json({ success: false, error: error.message || 'Failed to sync mailbox' });
    }
  },
};

module.exports = syncController;


