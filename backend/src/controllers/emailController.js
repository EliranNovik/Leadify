const graphMailboxSyncService = require('../services/graphMailboxSyncService');

const emailController = {
  async list(req, res) {
    try {
      const { userId, page, limit } = req.query;
      if (!userId) {
        return res.status(400).json({ success: false, error: 'userId query parameter is required' });
      }
      const data = await graphMailboxSyncService.listEmails(userId, {
        page: Number(page) || 1,
        pageSize: Number(limit) || 25,
      });
      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error('❌ List emails error:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to list emails' });
    }
  },

  async body(req, res) {
    try {
      const { userId } = req.query;
      const { id } = req.params;
      if (!userId) {
        return res.status(400).json({ success: false, error: 'userId query parameter is required' });
      }
      const html = await graphMailboxSyncService.getEmailBody(userId, id);
      res.status(200).json({ success: true, body: html });
    } catch (error) {
      console.error('❌ Get body error:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to load email body' });
    }
  },

  async downloadAttachment(req, res) {
    try {
      const { userId } = req.query;
      const { id, attachmentId } = req.params;
      if (!userId) {
        return res.status(400).json({ success: false, error: 'userId query parameter is required' });
      }
      const attachment = await graphMailboxSyncService.downloadAttachment(userId, id, attachmentId);
      res.setHeader('Content-Type', attachment.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${attachment.fileName}"`);
      res.send(attachment.buffer);
    } catch (error) {
      console.error('❌ Download attachment error:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to download attachment' });
    }
  },

  async toggleThread(req, res) {
    try {
      const { userId, track } = req.body;
      const { conversationId } = req.params;
      if (!userId || !conversationId) {
        return res.status(400).json({ success: false, error: 'userId and conversationId are required' });
      }
      await graphMailboxSyncService.toggleThreadTracking(userId, conversationId, Boolean(track));
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('❌ Toggle tracked thread error:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to update tracking' });
    }
  },

  async send(req, res) {
    try {
      const { userId, ...message } = req.body || {};
      if (!userId) {
        return res.status(400).json({ success: false, error: 'userId is required' });
      }

      const result = await graphMailboxSyncService.sendEmail(userId, message);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      console.error('❌ Send email error:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to send email' });
    }
  },
};

module.exports = emailController;


