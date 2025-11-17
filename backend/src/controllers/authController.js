const graphAuthService = require('../services/graphAuthService');

const FRONTEND_SUCCESS_URL = process.env.FRONTEND_AUTH_REDIRECT || process.env.FRONTEND_URL || 'http://localhost:5173';

const authController = {
  async login(req, res) {
    try {
      const { userId, redirectTo } = req.query;
      if (!userId) {
        return res.status(400).json({ success: false, error: 'userId is required' });
      }

      const url = await graphAuthService.createAuthUrl(userId, redirectTo);
      return res.status(200).json({ success: true, url });
    } catch (error) {
      console.error('❌ Auth login error:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to generate auth URL' });
    }
  },

  async callback(req, res) {
    try {
      const { code, state } = req.query;
      if (!code || !state) {
        return res.status(400).send('Missing code or state');
      }

      const result = await graphAuthService.handleAuthCode(code, state);
      const redirectTarget = result.redirectTo || FRONTEND_SUCCESS_URL;
      const redirectUrl = new URL(redirectTarget);
      redirectUrl.searchParams.set('msal', 'success');
      redirectUrl.searchParams.set('mailbox', result.mailbox || '');
      res.redirect(redirectUrl.toString());
    } catch (error) {
      console.error('❌ Auth callback error:', error);
      res.status(500).send(error.message || 'Authentication failed');
    }
  },

  async status(req, res) {
    try {
      const { userId } = req.query;
      if (!userId) {
        return res.status(400).json({ success: false, error: 'userId is required' });
      }

      const status = await graphAuthService.getConnectionStatus(userId);
      res.status(200).json({ success: true, data: status });
    } catch (error) {
      console.error('❌ Auth status error:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to load status' });
    }
  },

  async disconnect(req, res) {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ success: false, error: 'userId is required' });
      }
      await graphAuthService.disconnect(userId);
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('❌ Disconnect error:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to disconnect mailbox' });
    }
  },
};

module.exports = authController;


