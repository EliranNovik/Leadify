const walletPassService = require('../services/walletPassService');

function sendError(res, err) {
  const status = err.status || 500;
  const payload = {
    error: err.message || 'Wallet pass error',
    code: err.code || undefined,
  };
  if (status >= 500 && !err.status) {
    console.error('[wallet]', err);
  }
  return res.status(status).json(payload);
}

exports.status = async (_req, res) => {
  try {
    return res.json(walletPassService.getWalletStatus());
  } catch (err) {
    return sendError(res, err);
  }
};

/** GET /api/wallet/business-card/:employeeId/apple — returns .pkpass */
exports.applePass = async (req, res) => {
  try {
    const { buffer, fileName } = await walletPassService.buildApplePkPassBuffer(
      req.params.employeeId,
    );
    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(buffer);
  } catch (err) {
    return sendError(res, err);
  }
};

/** GET /api/wallet/business-card/:employeeId/google — JSON with saveUrl */
exports.googlePass = async (req, res) => {
  try {
    const result = await walletPassService.buildGoogleWalletSaveUrl(req.params.employeeId);
    return res.json({
      saveUrl: result.saveUrl,
      cardUrl: result.cardUrl,
      name: result.profile.official_name,
    });
  } catch (err) {
    return sendError(res, err);
  }
};

/**
 * GET /api/wallet/business-card/:employeeId/google/redirect
 * Redirects straight to Google’s “Add to Wallet” URL (handy for <a href>).
 */
exports.googlePassRedirect = async (req, res) => {
  try {
    const result = await walletPassService.buildGoogleWalletSaveUrl(req.params.employeeId);
    return res.redirect(302, result.saveUrl);
  } catch (err) {
    return sendError(res, err);
  }
};
