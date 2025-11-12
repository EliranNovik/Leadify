const emailSyncService = require('../services/emailSyncService');

const graphEmailController = {
  async syncEmails(req, res) {
    try {
      const { lookbackDays, top, mailbox, mailboxes } = req.body || {};

      const result = await emailSyncService.syncEmails({
        lookbackDays,
        top,
        mailbox,
        mailboxes,
      });

      res.status(200).json({
        success: true,
        message: 'Email sync executed successfully',
        data: result,
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
      message: 'Graph email sync webhook is available',
      mailbox: emailSyncService.mailboxUser || null,
      configured: Boolean(emailSyncService.mailboxUser),
    });
  },
};

module.exports = graphEmailController;


