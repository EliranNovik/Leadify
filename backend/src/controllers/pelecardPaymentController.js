const supabase = require('../config/supabase');
const pelecardService = require('../services/pelecardService');
const reconciliation = require('../services/pelecardPaymentReconciliationService');

function appRedirect(path, query = {}) {
  const { appPublicUrl } = pelecardService.getConfig();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null && String(value).trim() !== '') {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return `${appPublicUrl}${path}${qs ? `?${qs}` : ''}`;
}

function mergeCallbackData(req) {
  return { ...(req.query || {}), ...(req.body || {}) };
}

function hasCallbackIdentity(data) {
  return Boolean(
    data.ParamX ||
      data.paramX ||
      data.paymentId ||
      data.PelecardTransactionId ||
      data.pelecardTransactionId ||
      data.TransactionId,
  );
}

function sendNoCacheJson(res, payload) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.removeHeader('ETag');
  return res.json(payload);
}

/**
 * POST /api/payments/pelecard/create-payment-session
 */
async function createPaymentSession(req, res) {
  try {
    const paymentId = req.body?.paymentId || req.body?.secureToken;
    if (!paymentId) {
      return res.status(400).json({ success: false, error: 'Missing paymentId' });
    }

    let payment = await reconciliation.fetchPaymentByToken(paymentId);
    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    if (payment.status === 'paid') {
      return res.status(400).json({ success: false, error: 'Payment already paid' });
    }

    // Recover charges that succeeded at Pelecard but were not saved on a prior attempt.
    if (payment.status === 'processing' || payment.status === 'failed') {
      payment = (await reconciliation.tryReconcilePaymentLink(payment)) || payment;
      if (payment.status === 'paid') {
        return res.json({
          success: true,
          alreadyPaid: true,
          paymentId,
          status: 'paid',
        });
      }
    }

    if (payment.expires_at && new Date(payment.expires_at) < new Date()) {
      await supabase
        .from('payment_links')
        .update({ status: 'expired' })
        .eq('id', payment.id);
      return res.status(400).json({ success: false, error: 'Payment link expired' });
    }

    const session = await pelecardService.createPaymentSession(payment, paymentId);

    const { error: updateError } = await supabase
      .from('payment_links')
      .update({
        status: 'processing',
        pelecard_session_url: session.paymentUrl,
        pelecard_confirmation_key: session.confirmationKey,
        pelecard_raw_response: {
          init: session.rawResponse,
          pelecardCharge: session.charge,
        },
      })
      .eq('id', payment.id);

    if (updateError) {
      console.error('Failed to save Pelecard session on payment_links:', updateError);
    }

    return res.json({
      success: true,
      paymentUrl: session.paymentUrl,
      paymentId,
      cssUrl: session.cssUrl,
      cssApplied: session.cssApplied,
    });
  } catch (error) {
    console.error('Create Pelecard payment session error:', error);
    if (error.code === 'PELECARD_NOT_CONFIGURED') {
      return res.status(503).json({ success: false, error: 'Payment gateway is not configured' });
    }
    if (error.code === 'EXCHANGE_RATE_UNAVAILABLE') {
      return res.status(503).json({
        success: false,
        error: error.message || 'Exchange rate unavailable',
      });
    }
    if (error.code === 'PELECARD_INIT_FAILED' || error.code === 'PELECARD_NO_URL') {
      return res.status(502).json({
        success: false,
        error: 'Could not start secure payment',
      });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * GET /api/payments/pelecard/status/:paymentId
 */
async function getPaymentStatus(req, res) {
  try {
    const paymentId = req.params.paymentId;
    if (!paymentId) {
      return sendNoCacheJson(res, { success: false, error: 'Missing paymentId' });
    }

    let payment = await reconciliation.fetchPaymentByToken(paymentId);
    if (!payment) {
      return sendNoCacheJson(res, { success: false, error: 'Payment not found' });
    }

    if (payment.status === 'processing' || payment.status === 'failed' || payment.status === 'paid') {
      payment = (await reconciliation.tryReconcilePaymentLink(payment)) || payment;
    }

    return sendNoCacheJson(res, {
      success: true,
      paymentId: payment.secure_token,
      status: payment.status,
      amount: payment.amount,
      vat_amount: payment.vat_amount,
      total_amount: payment.total_amount,
      currency: payment.currency,
      description: payment.description,
      paid_at: payment.paid_at || null,
      expires_at: payment.expires_at || null,
      pelecard_transaction_id: payment.pelecard_transaction_id || null,
      pelecard_status_code: payment.pelecard_status_code || null,
      pelecard_status_description: reconciliation.pelecardDescriptionFromRaw(
        payment.pelecard_raw_response,
      ),
      confirmation_email_sent: Boolean(payment.payment_confirmation_email_sent_at),
    });
  } catch (error) {
    console.error('Get payment status error:', error);
    return sendNoCacheJson(res, { success: false, error: 'Internal server error' });
  }
}

/**
 * POST /api/payments/pelecard/reconcile/:paymentId
 * Manual / ops recovery for a single payment link.
 */
async function reconcilePayment(req, res) {
  try {
    const paymentId = req.params.paymentId;
    if (!paymentId) {
      return sendNoCacheJson(res, { success: false, error: 'Missing paymentId' });
    }

    const transactionId =
      req.body?.transactionId ||
      req.body?.pelecardTransactionId ||
      req.query?.transactionId ||
      null;
    const authNumber =
      req.body?.authNumber ||
      req.body?.authorizationNumber ||
      req.query?.authNumber ||
      null;

    const result = await reconciliation.reconcilePaymentBySecureToken(paymentId, {
      transactionId: transactionId ? String(transactionId) : null,
      authNumber: authNumber ? String(authNumber) : null,
    });
    if (!result.ok && result.error === 'not_found') {
      return sendNoCacheJson(res, { success: false, error: 'Payment not found' });
    }

    return sendNoCacheJson(res, { success: true, ...result });
  } catch (error) {
    console.error('Reconcile payment error:', error);
    return sendNoCacheJson(res, { success: false, error: 'Internal server error' });
  }
}

/**
 * Shared Pelecard return handler (success / error / cancel).
 */
async function handlePelecardReturn(req, res, outcome) {
  let secureToken = null;
  let payment = null;
  let data = {};

  try {
    data = mergeCallbackData(req);
    const { statusCode, statusDescription, transactionId } = reconciliation.extractPelecardMeta(data);
    secureToken = data.ParamX || data.paramX || data.paymentId || req.query.paymentId;

    console.info('[Pelecard] Return callback', {
      outcome,
      method: req.method,
      paymentId: secureToken || null,
      statusCode: statusCode || null,
      statusDescription: statusDescription || null,
      transactionId: transactionId || null,
      hasBody: Boolean(req.body && Object.keys(req.body).length),
      hasQuery: Boolean(req.query && Object.keys(req.query).length),
    });

    if (!hasCallbackIdentity(data)) {
      if (req.method === 'POST') {
        return res.status(200).send('OK');
      }
      return res.redirect(appRedirect('/payment/failed', { reason: 'missing_payment_id' }));
    }

    if (!secureToken) {
      return res.redirect(appRedirect('/payment/failed', { reason: 'missing_payment_id' }));
    }

    payment = await reconciliation.fetchPaymentByToken(secureToken);
    if (!payment) {
      return res.redirect(
        appRedirect('/payment/failed', { paymentId: secureToken, reason: 'payment_not_found' }),
      );
    }

    // Save callback + transaction id immediately — survives later verification/DB failures.
    await reconciliation.persistCallbackSnapshot(payment, data, { returnOutcome: outcome });

    if (payment.status === 'paid') {
      return res.redirect(appRedirect('/payment/success', { paymentId: secureToken }));
    }

    const failedRedirectQuery = {
      paymentId: secureToken,
      ...(statusCode ? { pelecardStatus: statusCode } : {}),
      ...(statusDescription ? { pelecardMessage: statusDescription.slice(0, 300) } : {}),
    };

    if (outcome === 'cancel') {
      const previousRaw =
        payment.pelecard_raw_response && typeof payment.pelecard_raw_response === 'object'
          ? payment.pelecard_raw_response
          : {};
      await supabase
        .from('payment_links')
        .update({
          status: 'cancelled',
          pelecard_raw_response: { ...previousRaw, callback: data },
        })
        .eq('id', payment.id);
      return res.redirect(appRedirect('/payment/cancelled', { paymentId: secureToken }));
    }

    if (reconciliation.isSessionExpiredCode(statusCode)) {
      await reconciliation.handleSessionExpired(payment, data);
      return res.redirect(
        appRedirect('/payment/failed', {
          ...failedRedirectQuery,
          pelecardStatus: statusCode,
          pelecardMessage: 'Your secure payment session has expired. Please try again.',
        }),
      );
    }

    const verifyResult = await reconciliation.verifyPelecardTransaction(transactionId, data);

    if (verifyResult.verified) {
      const persistResult = await reconciliation.persistPaymentSuccess(
        payment,
        secureToken,
        data,
        verifyResult,
      );
      if (!persistResult.ok) {
        console.error('[Pelecard] CRITICAL: verified paid but DB persist failed', {
          paymentId: secureToken,
          transactionId: transactionId || null,
        });
        return res.redirect(
          appRedirect('/payment/failed', {
            paymentId: secureToken,
            reason: 'server_error',
          }),
        );
      }
      return res.redirect(appRedirect('/payment/success', { paymentId: secureToken }));
    }

    const failDesc =
      reconciliation.pelecardDescriptionFromRaw(verifyResult.verifyPayload) ||
      statusDescription ||
      (verifyResult.resolvedStatusCode
        ? `Declined (${verifyResult.resolvedStatusCode})`
        : 'Payment not completed');

    await reconciliation.persistPaymentFailure(payment, secureToken, data, verifyResult, failDesc);

    return res.redirect(
      appRedirect('/payment/failed', {
        ...failedRedirectQuery,
        pelecardStatus: verifyResult.resolvedStatusCode || failedRedirectQuery.pelecardStatus,
        pelecardMessage: String(failDesc).slice(0, 300),
      }),
    );
  } catch (error) {
    console.error('Pelecard return handler error:', error);

    if (payment && secureToken && data && Object.keys(data).length) {
      await reconciliation.persistCallbackSnapshot(payment, data, {
        returnOutcome: outcome,
        handlerError: String(error.message || error).slice(0, 500),
      });
      void reconciliation.tryReconcilePaymentLink(payment);
    }

    return res.redirect(
      appRedirect('/payment/failed', {
        ...(secureToken ? { paymentId: secureToken } : {}),
        reason: 'server_error',
      }),
    );
  }
}

function returnSuccess(req, res) {
  return handlePelecardReturn(req, res, 'success');
}

function returnError(req, res) {
  return handlePelecardReturn(req, res, 'error');
}

function returnCancel(req, res) {
  return handlePelecardReturn(req, res, 'cancel');
}

async function getCheckoutCssInfo(req, res) {
  try {
    const info = pelecardService.getCheckoutCssDebugInfo();
    const probe = await pelecardService.probeTerminalCssUrlSupport();
    return res.json({
      success: true,
      ...info,
      ...probe,
    });
  } catch (error) {
    console.error('Pelecard CSS info error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to probe Pelecard CSS',
      ...pelecardService.getCheckoutCssDebugInfo(),
    });
  }
}

module.exports = {
  createPaymentSession,
  getPaymentStatus,
  reconcilePayment,
  getCheckoutCssInfo,
  returnSuccess,
  returnError,
  returnCancel,
};
