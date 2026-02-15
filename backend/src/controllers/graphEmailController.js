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
      // Return 401 for expired refresh tokens so frontend can prompt for reconnection
      const statusCode = error.message?.includes('expired') || error.message?.includes('reconnect') ? 401 : 500;
      res.status(statusCode).json({
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
    // Log ALL incoming GET requests to help debug
    console.log('='.repeat(80));
    console.log('🔍🔍🔍 GRAPH WEBHOOK GET REQUEST RECEIVED 🔍🔍🔍');
    console.log('🔍 Timestamp:', new Date().toISOString());
    console.log('🔍 Method:', req.method);
    console.log('🔍 URL:', req.url);
    console.log('🔍 IP:', req.ip || req.connection.remoteAddress);
    console.log('🔍 User-Agent:', req.get('User-Agent'));
    console.log('🔍 Query:', JSON.stringify(req.query, null, 2));
    console.log('='.repeat(80));

    // Microsoft Graph sends validation token in query string (GET) or sometimes in POST body
    const token = req.query?.validationtoken || 
                  req.query?.validationToken || 
                  req.body?.validationToken ||
                  req.body?.validationtoken;
    
    if (!token) {
      console.warn('⚠️  Graph webhook validation attempt without token', {
        method: req.method,
        query: req.query,
        bodyKeys: req.body ? Object.keys(req.body) : [],
      });
      return res.status(400).send('Missing validation token');
    }

    res.set('Content-Type', 'text/plain');
    console.log('✅ Responding to Microsoft Graph webhook validation request with token:', token.substring(0, 20) + '...');
    return res.status(200).send(token);
  },

  async webhookNotification(req, res) {
    try {
      // Log ALL incoming requests to help debug
      console.log('='.repeat(80));
      console.log('📨📨📨 GRAPH WEBHOOK POST REQUEST RECEIVED 📨📨📨');
      console.log('📨 Timestamp:', new Date().toISOString());
      console.log('📨 Method:', req.method);
      console.log('📨 URL:', req.url);
      console.log('📨 IP:', req.ip || req.connection.remoteAddress);
      console.log('📨 Headers:', JSON.stringify(req.headers, null, 2));
      console.log('📨 Query:', JSON.stringify(req.query, null, 2));
      console.log('📨 Body exists:', !!req.body);
      console.log('📨 Body type:', typeof req.body);
      console.log('📨 Body keys:', req.body ? Object.keys(req.body) : []);
      console.log('='.repeat(80));

      // Check if this is actually a validation request (sometimes sent as POST)
      // MUST check BEFORE sending 202, as validation requires 200 response
      const validationToken = req.query?.validationtoken || 
                              req.query?.validationToken || 
                              req.body?.validationToken ||
                              req.body?.validationtoken;
      
      if (validationToken) {
        console.log('✅ Received validation token in POST request, responding...');
        res.set('Content-Type', 'text/plain');
        return res.status(200).send(validationToken);
      }

      // Graph requires an immediate 202 for actual notifications (even if we perform async work later)
      res.sendStatus(202);

      console.log('📨 Graph webhook notification received:', {
        timestamp: new Date().toISOString(),
        method: req.method,
        hasBody: !!req.body,
        bodyType: typeof req.body,
        bodyKeys: req.body ? Object.keys(req.body) : [],
        valueCount: Array.isArray(req.body?.value) ? req.body.value.length : 0,
        rawBody: JSON.stringify(req.body).substring(0, 1000), // First 1000 chars for debugging
      });

      const notifications = Array.isArray(req.body?.value) ? req.body.value : [];
      if (!notifications.length) {
        console.warn('⚠️  Received Graph webhook with empty payload', {
          body: req.body,
          bodyString: JSON.stringify(req.body),
        });
        return;
      }

      console.log(`📨 Processing ${notifications.length} notification(s)`);

      for (const notification of notifications) {
        const userId = notification?.clientState;
        if (!userId) {
          console.warn('⚠️  Graph notification missing clientState. Notification ignored.', {
            notification: JSON.stringify(notification),
          });
          continue;
        }

        console.log(`✅ Processing Graph webhook notification for user ${userId}`, {
          subscriptionId: notification?.subscriptionId,
          resource: notification?.resource,
          changeType: notification?.changeType,
        });

        graphNotificationService.enqueueUserSync(userId, {
          subscriptionId: notification?.subscriptionId,
          resource: notification?.resource,
          changeType: notification?.changeType,
        });
      }
    } catch (error) {
      console.error('❌ Webhook notification processing error:', error);
      console.error('❌ Error stack:', error.stack);
    }
  },

  async refreshSubscriptions(req, res) {
    try {
      console.log('🔄 Refreshing Graph webhook subscriptions for all users...');
      const summary = await graphMailboxSyncService.refreshAllSubscriptions();
      res.status(200).json({
        success: true,
        message: 'Subscriptions refreshed',
        data: summary,
      });
    } catch (error) {
      console.error('❌ Failed to refresh subscriptions:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to refresh subscriptions',
      });
    }
  },

  async checkSubscriptions(req, res) {
    try {
      const status = await graphMailboxSyncService.checkSubscriptionsStatus();
      res.status(200).json({
        success: true,
        data: status,
      });
    } catch (error) {
      console.error('❌ Failed to check subscriptions:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to check subscriptions',
      });
    }
  },

  async syncAllMailboxes(req, res) {
    try {
      console.log('🔄 Manual sync all mailboxes requested...');
      const summary = await graphMailboxSyncService.syncAllMailboxes({
        trigger: 'manual',
      });
      res.status(200).json({
        success: true,
        message: 'All mailboxes synced',
        data: summary,
      });
    } catch (error) {
      console.error('❌ Failed to sync all mailboxes:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to sync all mailboxes',
      });
    }
  },
};

module.exports = graphEmailController;

