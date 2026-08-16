const graphAuthService = require('../services/graphAuthService');

const FRONTEND_SUCCESS_URL = process.env.FRONTEND_AUTH_REDIRECT || process.env.FRONTEND_URL || 'http://localhost:5173';

const toRedirectUrl = (target, params = {}) => {
  const redirectUrl = new URL(target || FRONTEND_SUCCESS_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') {
      redirectUrl.searchParams.set(key, String(value));
    }
  });
  return redirectUrl.toString();
};

const authController = {
  async login(req, res) {
    try {
      const { userId, redirectTo, silent, loginHint } = req.query;
      if (!userId) {
        return res.status(400).json({ success: false, error: 'userId is required' });
      }

      const url = await graphAuthService.createAuthUrl(userId, redirectTo, {
        silent: silent === 'true' || silent === '1',
        loginHint,
      });
      return res.status(200).json({ success: true, url });
    } catch (error) {
      console.error('❌ Auth login error:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to generate auth URL' });
    }
  },

  async callback(req, res) {
    const fallbackTarget = FRONTEND_SUCCESS_URL;
    try {
      const { code, state, error, error_description } = req.query;
      if (error || !code || !state) {
        const stored = state ? graphAuthService.consumeAuthRedirectState(state) : null;
        const redirectTarget = stored?.redirectTo || fallbackTarget;
        const msal =
          error === 'login_required' || error === 'interaction_required' || error === 'consent_required'
            ? 'mailbox_needed'
            : 'error';
        return res.redirect(
          toRedirectUrl(redirectTarget, {
            msal,
            mailbox_error: error_description || error || 'Missing code or state',
          })
        );
      }

      const result = await graphAuthService.handleAuthCode(code, state);
      const redirectTarget = result.redirectTo || fallbackTarget;
      return res.redirect(
        toRedirectUrl(redirectTarget, {
          msal: 'success',
          mailbox: result.mailbox || '',
        })
      );
    } catch (error) {
      console.error('❌ Auth callback error:', error);
      const redirectTarget = error?.redirectTo || fallbackTarget;
      if (error?.code === 'MAILBOX_ACCOUNT_MISMATCH') {
        return res.redirect(
          toRedirectUrl(redirectTarget, {
            msal: 'mismatch',
            mailbox: error.mailbox || '',
            expected: error.expectedEmail || '',
          })
        );
      }
      return res.redirect(
        toRedirectUrl(redirectTarget, {
          msal: 'error',
          mailbox_error: error.message || 'Authentication failed',
        })
      );
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
