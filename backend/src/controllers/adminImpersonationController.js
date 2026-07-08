const { createWorkerLoginToken } = require('../services/adminImpersonationService');

async function impersonateWorker(req, res) {
  try {
    const targetUserId = req.body?.targetUserId || req.body?.userId;
    if (!targetUserId) {
      return res.status(400).json({
        success: false,
        error: 'targetUserId is required',
      });
    }

    const payload = await createWorkerLoginToken(targetUserId);
    return res.status(200).json({
      success: true,
      ...payload,
    });
  } catch (error) {
    console.error('Admin worker impersonation failed:', error);
    const message = error instanceof Error ? error.message : 'Impersonation failed';
    const status = message.includes('not found') ? 404 : 400;
    return res.status(status).json({
      success: false,
      error: message,
    });
  }
}

module.exports = {
  impersonateWorker,
};
