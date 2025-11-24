const graphMailboxSyncService = require('../services/graphMailboxSyncService');
const graphNotificationService = require('../services/graphNotificationService');

const graphEmailController = {
  async syncEmails(req, res) {
    try {
      const { userId, reset } = req.body || {};
      if (!userId) {
        return res.status(400).json({ success: false, error: 'userId is required' });
      }
      const summary = await graphMailboxSyncService.syncMailboxForUser(userId, {
        reset: Boolean(reset),
        trigger: 'api',
      });
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
    const token = req.query && (req.query.validationtoken || req.query['validationtoken']);
    if (!token) {
      console.warn('⚠️  Graph webhook validation attempt without token');
      return res.status(400).send('Missing validation token');
    }

    res.set('Content-Type', 'text/plain');
    console.log('✅ Responding to Microsoft Graph webhook validation request');
    return res.status(200).send(token);
  },

  async webhookNotification(req, res) {
    // Graph requires an immediate 202 even if we perform async work later
    res.sendStatus(202);

    try {
      const notifications = Array.isArray(req.body?.value) ? req.body.value : [];
      if (!notifications.length) {
        console.warn('⚠️  Received Graph webhook with empty payload');
        return;
      }

      for (const notification of notifications) {
        const userId = notification?.clientState;
        if (!userId) {
          console.warn('⚠️  Graph notification missing clientState. Notification ignored.');
          continue;
        }

        graphNotificationService.enqueueUserSync(userId, {
          subscriptionId: notification?.subscriptionId,
          resource: notification?.resource,
          changeType: notification?.changeType,
        });
      }
    } catch (error) {
      console.error('❌ Webhook notification processing error:', error);
    }
  },
};

module.exports = graphEmailController;

