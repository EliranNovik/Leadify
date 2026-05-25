const supabase = require('../config/supabase');
const pelecardService = require('../services/pelecardService');
const { chargeAmountFromPayment } = require('../services/paymentChargeAmountService');

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

/** Normalize Pelecard callback query/body fields. */
function extractPelecardMeta(data = {}) {
  const statusCode = String(
    data.PelecardStatusCode ||
      data.StatusCode ||
      data.statusCode ||
      ''
  ).trim();
  const statusDescription = String(
    data.StatusDescription ||
      data.statusDescription ||
      ''
  ).trim();
  const transactionId =
    data.PelecardTransactionId ||
    data.pelecardTransactionId ||
    data.TransactionId ||
    null;
  return { statusCode, statusDescription, transactionId };
}

function pelecardDescriptionFromRaw(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return (
    raw.StatusDescription ||
    raw.statusDescription ||
    raw.callback?.StatusDescription ||
    null
  );
}

async function fetchPaymentByToken(secureToken) {
  const { data, error } = await supabase
    .from('payment_links')
    .select(`
      *,
      leads:client_id(lead_number, topic, name, email, phone),
      payment_plans:payment_plan_id(payment_order, currency, currency_id)
    `)
    .eq('secure_token', secureToken)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function markPaymentPlanPaid(paymentLink) {
  if (!paymentLink?.payment_plan_id) return;
  const email = paymentLink.leads?.email || null;
  await supabase
    .from('payment_plans')
    .update({
      paid: true,
      paid_at: new Date().toISOString(),
      ...(email ? { paid_by: email } : {}),
    })
    .eq('id', paymentLink.payment_plan_id);
}

async function recordTransaction(paymentLinkId, status, amount, method, extra = {}) {
  await supabase.from('payment_transactions').insert({
    payment_link_id: paymentLinkId,
    status,
    payment_method: method,
    amount,
    completed_at: status === 'success' ? new Date().toISOString() : null,
    transaction_reference: extra.transactionReference || null,
    error_message: extra.errorMessage || null,
  });
}

/**
 * POST /api/payments/pelecard/create-payment-session
 * Body: { paymentId } — paymentId is payment_links.secure_token
 */
async function createPaymentSession(req, res) {
  try {
    const paymentId = req.body?.paymentId || req.body?.secureToken;
    if (!paymentId) {
      return res.status(400).json({ success: false, error: 'Missing paymentId' });
    }

    const payment = await fetchPaymentByToken(paymentId);
    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    if (payment.status === 'paid') {
      return res.status(400).json({ success: false, error: 'Payment already paid' });
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
      return res.status(400).json({ success: false, error: 'Missing paymentId' });
    }

    const payment = await fetchPaymentByToken(paymentId);
    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    return res.json({
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
      pelecard_status_description: pelecardDescriptionFromRaw(payment.pelecard_raw_response),
    });
  } catch (error) {
    console.error('Get payment status error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * Shared Pelecard return handler (success / error / cancel)
 */
async function handlePelecardReturn(req, res, outcome) {
  try {
    const data = { ...req.query, ...req.body };
    const { statusCode, statusDescription, transactionId: metaTxId } = extractPelecardMeta(data);
    const secureToken =
      data.ParamX ||
      data.paramX ||
      data.paymentId ||
      req.query.paymentId;

    const transactionId =
      metaTxId ||
      data.PelecardTransactionId ||
      data.pelecardTransactionId ||
      data.TransactionId;

    console.info('[Pelecard] Return callback', {
      outcome,
      paymentId: secureToken,
      statusCode,
      statusDescription,
      transactionId: transactionId || null,
    });

    if (!secureToken) {
      return res.redirect(appRedirect('/payment/failed', { reason: 'missing_payment_id' }));
    }

    const payment = await fetchPaymentByToken(secureToken);
    if (!payment) {
      return res.redirect(appRedirect('/payment/failed', { paymentId: secureToken, reason: 'payment_not_found' }));
    }

    const failedRedirectQuery = {
      paymentId: secureToken,
      ...(statusCode ? { pelecardStatus: statusCode } : {}),
      ...(statusDescription ? { pelecardMessage: statusDescription.slice(0, 300) } : {}),
    };

    if (outcome === 'cancel') {
      await supabase
        .from('payment_links')
        .update({
          status: 'cancelled',
          pelecard_raw_response: data,
        })
        .eq('id', payment.id);
      return res.redirect(appRedirect('/payment/cancelled', { paymentId: secureToken }));
    }

    if (outcome === 'error') {
      const failMessage =
        statusDescription ||
        (statusCode ? `Pelecard declined (${statusCode})` : 'Payment not completed at Pelecard');

      await supabase
        .from('payment_links')
        .update({
          status: 'failed',
          pelecard_status_code: statusCode || String(data.StatusCode || data.statusCode || ''),
          pelecard_raw_response: data,
          ...(transactionId ? { pelecard_transaction_id: String(transactionId) } : {}),
        })
        .eq('id', payment.id);

      await recordTransaction(payment.id, 'failed', chargeAmountFromPayment(payment), 'pelecard', {
        transactionReference: transactionId ? String(transactionId) : null,
        errorMessage: failMessage.slice(0, 500),
      });

      console.warn('[Pelecard] Payment failed (error return)', {
        paymentId: secureToken,
        statusCode,
        statusDescription,
      });

      return res.redirect(appRedirect('/payment/failed', failedRedirectQuery));
    }

    // success — verify server-side when we have a transaction id
    let verified = false;
    let verifyPayload = data;
    let resolvedStatusCode = statusCode;

    if (transactionId) {
      try {
        const tx = await pelecardService.getTransaction(String(transactionId));
        verifyPayload = { callback: data, pelecard: tx.raw };
        const result = tx.result || {};
        resolvedStatusCode = String(result.StatusCode || resolvedStatusCode || '');
        verified = pelecardService.isSuccessfulStatus(resolvedStatusCode, result);
      } catch (verifyErr) {
        console.error('Pelecard GetTransaction failed:', verifyErr);
        verified = pelecardService.isSuccessfulStatus(resolvedStatusCode, data);
      }
    } else {
      verified = pelecardService.isSuccessfulStatus(resolvedStatusCode, data);
    }

    if (verified) {
      const paidAt = new Date().toISOString();
      const txRef = transactionId ? String(transactionId) : `PELE_${Date.now()}`;

      await supabase
        .from('payment_links')
        .update({
          status: 'paid',
          paid_at: paidAt,
          payment_method: 'pelecard',
          transaction_reference: txRef,
          pelecard_transaction_id: transactionId ? String(transactionId) : null,
          pelecard_confirmation_key: data.ConfirmationKey || data.confirmationKey || payment.pelecard_confirmation_key,
          pelecard_voucher_id: data.VoucherId || data.voucherId || null,
          pelecard_auth_number: data.AuthorizationNumber || data.DebitApproveNumber || null,
          pelecard_status_code: resolvedStatusCode,
          pelecard_raw_response: verifyPayload,
        })
        .eq('id', payment.id);

      await markPaymentPlanPaid(payment);
      await recordTransaction(payment.id, 'success', chargeAmountFromPayment(payment), 'pelecard', {
        transactionReference: txRef,
      });

      console.info('[Pelecard] Payment succeeded', { paymentId: secureToken, statusCode: resolvedStatusCode });

      return res.redirect(appRedirect('/payment/success', { paymentId: secureToken }));
    }

    const failDesc =
      pelecardDescriptionFromRaw(verifyPayload) ||
      statusDescription ||
      (resolvedStatusCode ? `Declined (${resolvedStatusCode})` : 'Verification failed');

    await supabase
      .from('payment_links')
      .update({
        status: 'failed',
        pelecard_status_code: resolvedStatusCode,
        pelecard_raw_response: verifyPayload,
        ...(transactionId ? { pelecard_transaction_id: String(transactionId) } : {}),
      })
      .eq('id', payment.id);

    await recordTransaction(payment.id, 'failed', chargeAmountFromPayment(payment), 'pelecard', {
      transactionReference: transactionId ? String(transactionId) : null,
      errorMessage: String(failDesc).slice(0, 500),
    });

    console.warn('[Pelecard] Payment failed (success return, not verified)', {
      paymentId: secureToken,
      statusCode: resolvedStatusCode,
      statusDescription: failDesc,
    });

    return res.redirect(
      appRedirect('/payment/failed', {
        ...failedRedirectQuery,
        pelecardStatus: resolvedStatusCode || failedRedirectQuery.pelecardStatus,
        pelecardMessage: String(failDesc).slice(0, 300),
      })
    );
  } catch (error) {
    console.error('Pelecard return handler error:', error);
    return res.redirect(appRedirect('/payment/failed', { reason: 'server_error' }));
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

module.exports = {
  createPaymentSession,
  getPaymentStatus,
  returnSuccess,
  returnError,
  returnCancel,
};
