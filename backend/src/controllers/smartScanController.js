const smartScanInboxService = require('../services/smartScanInboxService');
const scanCenterInboxScheduler = require('../services/scanCenterInboxScheduler');

const smartScanController = {
  async inbox(req, res) {
    try {
      const raw = String(req.query.sync ?? '0').trim().toLowerCase();
      const sync = raw === '1' || raw === 'true';
      const data = await smartScanInboxService.listInbox({ sync });
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.status(200).json({ success: true, ...data });
    } catch (error) {
      console.error('❌ Smart Scan inbox failed:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to load Scan Center documents',
      });
    }
  },

  async sync(req, res) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.status(202).json({ success: true, started: true });
    void scanCenterInboxScheduler.runSyncCycle('api').catch((error) => {
      console.error('❌ Smart Scan background sync failed:', error.message || error);
    });
  },

  async downloadAttachment(req, res) {
    try {
      const { emailId, attachmentId } = req.params;
      const attachment = await smartScanInboxService.downloadInboxAttachment(emailId, attachmentId);
      const fileName = String(attachment.fileName || 'scan.pdf').replace(/"/g, '');
      res.setHeader('Content-Type', attachment.contentType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      res.send(attachment.buffer);
    } catch (error) {
      console.error('❌ Smart Scan attachment download failed:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to download Scan Center attachment',
      });
    }
  },

  async process(req, res) {
    try {
      const id = String(req.body?.id || req.params?.id || '').trim();
      if (!id) {
        return res.status(400).json({ success: false, error: 'id is required' });
      }
      const data = await smartScanInboxService.processItem(id);
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.status(200).json({ success: true, ...data });
    } catch (error) {
      console.error('❌ Smart Scan process failed:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to process Scan Center document',
      });
    }
  },

  async assign(req, res) {
    try {
      const id = String(req.body?.id || req.params?.id || '').trim();
      const lead = req.body?.lead;
      if (!id) {
        return res.status(400).json({ success: false, error: 'id is required' });
      }
      if (!lead) {
        return res.status(400).json({ success: false, error: 'lead is required' });
      }
      await smartScanInboxService.assignLead(id, lead);
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('❌ Smart Scan assign failed:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to assign Scan Center document',
      });
    }
  },

  async approve(req, res) {
    try {
      const id = String(req.body?.id || req.params?.id || '').trim();
      if (!id) {
        return res.status(400).json({ success: false, error: 'id is required' });
      }
      await smartScanInboxService.approveItem(id);
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('❌ Smart Scan approve failed:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to approve Scan Center document',
      });
    }
  },

  async remove(req, res) {
    try {
      const id = String(req.body?.id || req.params?.id || '').trim();
      if (!id) {
        return res.status(400).json({ success: false, error: 'id is required' });
      }
      const data = await smartScanInboxService.removeItem(id);
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.status(200).json({ success: true, ...data });
    } catch (error) {
      console.error('❌ Smart Scan remove failed:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to remove Scan Center document',
      });
    }
  },

  async downloadDocument(req, res) {
    try {
      const documentId = String(req.params.documentId || '').trim();
      const file = await smartScanInboxService.downloadScanDocument(documentId);
      const fileName = String(file.fileName || 'scan.pdf').replace(/"/g, '');
      res.setHeader('Content-Type', file.contentType || 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      res.send(file.buffer);
    } catch (error) {
      console.error('❌ Smart Scan document download failed:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to download classified scan',
      });
    }
  },
};

module.exports = smartScanController;
