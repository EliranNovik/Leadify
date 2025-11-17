const graphMailboxSyncService = require('../services/graphMailboxSyncService');

const graphEmailController = {
  async syncEmails(req, res) {
    try {
      const { userId, reset } = req.body || {};
      if (!userId) {
        return res.status(400).json({ success: false, error: 'userId is required' });
      }
      const summary = await graphMailboxSyncService.syncMailboxForUser(userId, { reset: Boolean(reset) });
      res.status(200).json({
        success: true,
        message: 'Mailbox synced successfully',
        data: summary,
      });
    } catch (error) {
      console.error('❌ Graph email sync failed:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to sync emails from Microsoft Graph',
      });
    }
  },

  async health(req, res) {
    res.status(200).json({
      success: true,
      message: 'Graph email integration is online',
    });
  },

  async webhookValidation(req, res) {
    const token = req.query && req.query.validationtoken;
    if (token) {
      res.set('Content-Type', 'text/plain');
      return res.status(200).send(token);
    }
    return res.status(400).send('Missing validation token');
  },

  async webhookNotification(req, res) {
    try {
      const notifications = req.body?.value || [];
      res.sendStatus(202);
      for (const notification of notifications) {
        const userId = notification.clientState;
        if (!userId) continue;
        graphMailboxSyncService
          .syncMailboxForUser(userId)
          .catch((error) => console.error('❌ Failed to sync mailbox from webhook:', error));
      }
    } catch (error) {
      console.error('❌ Webhook notification error:', error);
      res.sendStatus(202);
    }
  },
};

module.exports = graphEmailController;

