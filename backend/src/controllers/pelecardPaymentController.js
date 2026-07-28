const supabase = require('../config/supabase');
const pelecardService = require('../services/pelecardService');
const reconciliation = require('../services/pelecardPaymentReconciliationService');
const {
  canReusePelecardSession,
  buildReusedSessionResponse,
  sessionAgeMs,
} = require('../lib/pelecardSessionReuse');
const payperInvoiceService = require('../services/payperInvoiceService');
const { sendPaymentConfirmationEmail } = require('../services/paymentConfirmationEmailService');
const {
  resolvePlanBillingContact,
} = require('../lib/paymentLinkContact');
const { ensurePaymentLinkPlanContact } = require('../lib/ensurePaymentLinkPlanContact');
const {
  resolvePelecardProfileFromRequest,
  profileFromPayment,
  getProfilesStatus,
} = require('../lib/pelecardProfiles');

function appRedirect(path, query = {}, profile = 'production') {
  const { appPublicUrl } = pelecardService.getConfig(profile);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null && String(value).trim() !== '') {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return `${appPublicUrl}${path}${qs ? `?${qs}` : ''}`;
}

function flattenCallbackSource(source, into = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return into;
  for (const [key, value] of Object.entries(source)) {
    if (value == null) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      // Pelecard sometimes nests ResultData / UserData
      if (key === 'ResultData' || key === 'resultData' || key === 'UserData' || key === 'userData') {
        flattenCallbackSource(value, into);
      }
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      into[key] = value;
    }
  }
  return into;
}

function mergeCallbackData(req) {
  const merged = {
    ...flattenCallbackSource(req.query || {}),
    ...flattenCallbackSource(req.body || {}),
  };

  // Some gateways post a JSON string in a single field
  for (const key of ['data', 'payload', 'json', 'ResultData']) {
    const raw = req.body?.[key];
    if (typeof raw === 'string' && raw.trim().startsWith('{')) {
      try {
        flattenCallbackSource(JSON.parse(raw), merged);
      } catch {
        /* ignore */
      }
    } else if (raw && typeof raw === 'object') {
      flattenCallbackSource(raw, merged);
    }
  }

  return merged;
}

function hasCallbackIdentity(data) {
  return Boolean(
    data.ParamX ||
      data.paramX ||
      data.AdditionalDetailsParamX ||
      data.paymentId ||
      data.PelecardTransactionId ||
      data.pelecardTransactionId ||
      data.TransactionId ||
      data.TransactionPelecardId,
  );
}

function summarizeCallbackForLog(data, req) {
  const keys = Object.keys(data || {}).slice(0, 40);
  const bodyKeys = req?.body && typeof req.body === 'object' ? Object.keys(req.body).slice(0, 40) : [];
  return { keys, bodyKeys, contentType: req?.headers?.['content-type'] || null };
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

    const forceNew = Boolean(req.body?.forceNew);
    const pelecardProfile = resolvePelecardProfileFromRequest(req);

    if (canReusePelecardSession(payment, pelecardProfile, { forceNew })) {
      console.info('[Pelecard] Reusing checkout session', {
        paymentId,
        ageMs: sessionAgeMs(payment),
      });
      return res.json(buildReusedSessionResponse(payment, paymentId, pelecardProfile));
    }

    payment = await ensurePaymentLinkPlanContact(payment);
    const session = await pelecardService.createPaymentSession(payment, paymentId, pelecardProfile);

    const sessionRate =
      session.charge?.rateToIls != null && Number.isFinite(Number(session.charge.rateToIls))
        ? Number(session.charge.rateToIls)
        : null;

    const previousRaw =
      payment.pelecard_raw_response && typeof payment.pelecard_raw_response === 'object'
        ? payment.pelecard_raw_response
        : {};

    const { error: updateError } = await supabase
      .from('payment_links')
      .update({
        status: 'processing',
        pelecard_profile: session.profile || pelecardProfile,
        pelecard_session_url: session.paymentUrl,
        pelecard_confirmation_key: session.confirmationKey,
        // New checkout session — drop prior attempt ids so polling won't reconcile the wrong tx
        pelecard_transaction_id: null,
        pelecard_status_code: null,
        pelecard_auth_number: null,
        pelecard_voucher_id: null,
        ...(sessionRate != null ? { rate: sessionRate } : {}),
        pelecard_raw_response: {
          ...previousRaw,
          init: session.rawResponse,
          pelecardCharge: session.charge,
          paramX: session.paramX,
          initParamX: session.paramX,
          customerIdField: pelecardService.getCustomerIdFieldMode(),
          sessionCreatedAt: new Date().toISOString(),
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
      pelecardProfile: session.profile || pelecardProfile,
      cssUrl: session.cssUrl,
      cssApplied: session.cssApplied,
      customerIdField: pelecardService.getCustomerIdFieldMode(),
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

    let payment = await reconciliation.fetchPaymentByCallbackRef(paymentId);
    if (!payment) {
      return sendNoCacheJson(res, { success: false, error: 'Payment not found' });
    }

    if (payment.status === 'processing' || payment.status === 'failed' || payment.status === 'paid' || payment.status === 'pending') {
      payment = (await reconciliation.tryReconcilePaymentLink(payment)) || payment;
    }

    if (
      payperInvoiceService.isAutomatedInvoiceEnabled() &&
      payment.status === 'paid' &&
      payment.payper_invoice_status !== 'success' &&
      payment.payper_invoice_status !== 'failed' &&
      payment.payper_invoice_status !== 'skipped' &&
      payment.payper_invoice_status !== 'skipped_no_email'
    ) {
      payment = (await reconciliation.tryCreatePayperInvoiceForPaidLink(payment)) || payment;
    }

    if (payment.status === 'paid' && !payment.payment_confirmation_email_sent_at) {
      payment = await ensurePaymentLinkPlanContact(payment);
      await sendPaymentConfirmationEmail(payment, {
        paidAt: payment.paid_at,
        invoiceLink: payment.payper_invoice_link || null,
        invoiceNumber: payment.payper_invoice_number || null,
      });
      payment = (await reconciliation.fetchPaymentByToken(paymentId)) || payment;
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
      payper_invoice_link: payment.payper_invoice_link || null,
      payper_invoice_number: payment.payper_invoice_number || null,
      payper_invoice_status: payment.payper_invoice_status || null,
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
      forcePaid: Boolean(req.body?.forcePaid || req.query?.forcePaid),
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
  let redirectProfile = 'production';

  try {
    data = mergeCallbackData(req);
    const { statusCode, statusDescription, transactionId } = reconciliation.extractPelecardMeta(data);
    secureToken =
      data.ParamX ||
      data.paramX ||
      data.AdditionalDetailsParamX ||
      data.paymentId ||
      req.query.paymentId ||
      null;

    console.info('[Pelecard] Return callback', {
      outcome,
      method: req.method,
      paymentId: secureToken || null,
      statusCode: statusCode || null,
      statusDescription: statusDescription || null,
      transactionId: transactionId || null,
      hasBody: Boolean(req.body && Object.keys(req.body).length),
      hasQuery: Boolean(req.query && Object.keys(req.query).length),
      ...summarizeCallbackForLog(data, req),
    });

    if (!hasCallbackIdentity(data)) {
      console.error('[Pelecard] Incomplete callback — missing ParamX/transaction id', {
        outcome,
        method: req.method,
        ...summarizeCallbackForLog(data, req),
      });
      // Best-effort: recover any recent processing charges Pelecard completed without notifying us.
      setImmediate(() => {
        void reconciliation.recoverRecentProcessingPayments({ lookbackMinutes: 45, limit: 20 });
      });
      if (req.method === 'POST') {
        return res.status(200).send('OK');
      }
      return res.redirect(appRedirect('/payment/failed', { reason: 'missing_payment_id' }));
    }

    if (!secureToken && transactionId) {
      // Identity is only a transaction id — still attempt recovery of recent processing links.
      setImmediate(() => {
        void reconciliation.recoverRecentProcessingPayments({ lookbackMinutes: 45, limit: 20 });
      });
    }

    if (!secureToken) {
      return res.redirect(appRedirect('/payment/failed', { reason: 'missing_payment_id' }));
    }

    payment = await reconciliation.fetchPaymentByCallbackRef(secureToken);
    if (!payment) {
      console.error('[Pelecard] Callback ParamX did not match a payment_links row', {
        paramX: secureToken,
        outcome,
      });
      setImmediate(() => {
        void reconciliation.recoverRecentProcessingPayments({ lookbackMinutes: 45, limit: 20 });
      });
      return res.redirect(
        appRedirect('/payment/failed', { paymentId: secureToken, reason: 'payment_not_found' }, redirectProfile),
      );
    }

    secureToken = payment.secure_token;
    redirectProfile = profileFromPayment(payment);

    // Save callback + transaction id immediately — survives later verification/DB failures.
    await reconciliation.persistCallbackSnapshot(payment, data, { returnOutcome: outcome });

    if (payment.status === 'paid') {
      return res.redirect(appRedirect('/payment/success', { paymentId: secureToken }, redirectProfile));
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
      return res.redirect(appRedirect('/payment/cancelled', { paymentId: secureToken }, redirectProfile));
    }

    if (reconciliation.isSessionExpiredCode(statusCode)) {
      await reconciliation.handleSessionExpired(payment, data);
      return res.redirect(
        appRedirect('/payment/failed', {
          ...failedRedirectQuery,
          pelecardStatus: statusCode,
          pelecardMessage: 'Your secure payment session has expired. Please try again.',
        }, redirectProfile),
      );
    }

    const verifyResult = await reconciliation.verifyPelecardTransaction(
      transactionId,
      data,
      redirectProfile,
    );

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
          }, redirectProfile),
        );
      }
      return res.redirect(appRedirect('/payment/success', { paymentId: secureToken }, redirectProfile));
    }

    // Success feedback without verify, OR error feedback after a real charge (digital transfer etc.)
    const reconciled = await reconciliation.tryReconcilePaymentLink(
      await reconciliation.fetchPaymentByToken(secureToken),
      { transactionId: transactionId ? String(transactionId) : null },
    );
    if (reconciled?.status === 'paid') {
      return res.redirect(appRedirect('/payment/success', { paymentId: secureToken }, redirectProfile));
    }

    // Browser/server hit ErrorURL but Pelecard may still have charged — don't hard-fail the row yet.
    // Send the client to the thank-you/verifying page so they are not stuck on an error screen.
    if (outcome === 'error' && !verifyResult.verified) {
      const hardDecline =
        Boolean(statusCode) &&
        statusCode !== '000' &&
        !reconciliation.isSessionExpiredCode(statusCode);

      if (!hardDecline) {
        console.warn('[Pelecard] Soft error callback — redirecting client to confirming/thank-you', {
          paymentId: secureToken,
          statusCode: statusCode || null,
          method: req.method,
        });
        // Server-side feedback only (no browser): acknowledge and recover in background.
        const isBrowserReturn =
          req.method === 'GET' ||
          Boolean(req.headers.accept && String(req.headers.accept).includes('text/html'));
        if (!isBrowserReturn && req.method === 'POST') {
          setImmediate(() => {
            void reconciliation.tryReconcilePaymentLink(
              { secure_token: secureToken },
              { transactionId: transactionId ? String(transactionId) : null },
            );
          });
          return res.status(200).send('OK');
        }
        return res.redirect(
          appRedirect('/payment/success', {
            paymentId: secureToken,
            confirming: '1',
          }, redirectProfile),
        );
      }
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
      }, redirectProfile),
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
      }, redirectProfile),
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
    const profile = pelecardService.normalizeProfile(req.query?.profile);
    const info = pelecardService.getCheckoutCssDebugInfo(profile);
    const probe = await pelecardService.probeTerminalCssUrlSupport(profile);
    return res.json({
      success: true,
      ...info,
      ...probe,
      profiles: getProfilesStatus(),
    });
  } catch (error) {
    console.error('Pelecard CSS info error:', error);
    const profile = pelecardService.normalizeProfile(req.query?.profile);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to probe Pelecard CSS',
      ...pelecardService.getCheckoutCssDebugInfo(profile),
      profiles: getProfilesStatus(),
    });
  }
}

async function getBillingContact(req, res) {
  try {
    const paymentId = req.params.paymentId;
    if (!paymentId) {
      return sendNoCacheJson(res, { success: false, error: 'Missing paymentId' });
    }

    let payment = await reconciliation.fetchPaymentByToken(paymentId);
    if (!payment) {
      return sendNoCacheJson(res, { success: false, error: 'Payment not found' });
    }

    payment = await ensurePaymentLinkPlanContact(payment);
    const contact = await resolvePlanBillingContact(payment);

    return sendNoCacheJson(res, {
      success: true,
      name: contact?.name || payment.billing_contact_name || null,
      email:
        payment.billing_contact_email ||
        contact?.email ||
        payment.leads?.email ||
        null,
      phone: contact?.phone || null,
      planContactId: payment.plan_contact_id ?? null,
    });
  } catch (error) {
    console.error('Get billing contact error:', error);
    return sendNoCacheJson(res, { success: false, error: 'Internal server error' });
  }
}

async function createPayperInvoice(req, res) {
  try {
    const paymentId = req.params.paymentId;
    const authUserId = req.body?.userId || req.body?.authUserId || req.query?.userId;
    if (!paymentId) {
      return sendNoCacheJson(res, { success: false, error: 'Missing paymentId' });
    }

    const { canRetryPayperInvoice } = require('../lib/payperInvoicePermissions');
    if (!(await canRetryPayperInvoice(authUserId))) {
      return res.status(403).json({
        success: false,
        error: 'Tax receipt retry is only available for superusers or collection staff',
        reason: 'payper_retry_forbidden',
      });
    }

    let payment = await reconciliation.fetchPaymentByToken(paymentId);
    if (!payment) {
      return sendNoCacheJson(res, { success: false, error: 'Payment not found' });
    }

    if (payment.status !== 'paid') {
      return sendNoCacheJson(res, { success: false, error: 'Payment is not paid' });
    }

    payment = await ensurePaymentLinkPlanContact(payment);

    if (
      payment.payper_invoice_status === 'failed' ||
      payment.payper_invoice_status === 'skipped_no_email'
    ) {
      const lastAttemptAt = payment.payper_raw_response?.createdAt;
      if (lastAttemptAt) {
        const elapsedMs = Date.now() - new Date(lastAttemptAt).getTime();
        if (elapsedMs >= 0 && elapsedMs < 15_000) {
          return sendNoCacheJson(res, {
            success: false,
            error: 'Please wait 15 seconds between tax receipt retries',
            reason: 'retry_cooldown',
          });
        }
      }

      await supabase
        .from('payment_links')
        .update({ payper_invoice_status: null })
        .eq('id', payment.id);
      payment.payper_invoice_status = null;
    }

    const callbackData = payment.pelecard_raw_response?.callback || {};
    const verifyPayload = payment.pelecard_raw_response?.pelecard || {};
    const result = await payperInvoiceService.createPayperInvoiceForPayment(payment, {
      callbackData,
      verifyPayload,
      forceRetry: true,
    });

    payment = (await reconciliation.fetchPaymentByToken(paymentId)) || payment;

    const emailResult = await sendPaymentConfirmationEmail(payment, {
      paidAt: payment.paid_at,
      invoiceLink: payment.payper_invoice_link || result.invoiceLink || null,
      invoiceNumber: payment.payper_invoice_number || result.invoiceNumber || null,
      force: true,
    });

    payment = (await reconciliation.fetchPaymentByToken(paymentId)) || payment;

    return sendNoCacheJson(res, {
      success: Boolean(result.success),
      ...result,
      payper_invoice_link: payment.payper_invoice_link || result.invoiceLink || null,
      payper_invoice_number: payment.payper_invoice_number || result.invoiceNumber || null,
      payper_invoice_status: payment.payper_invoice_status || null,
      confirmation_email_sent: Boolean(payment.payment_confirmation_email_sent_at),
      confirmation_email: emailResult,
    });
  } catch (error) {
    console.error('Create Payper invoice error:', error);
    return sendNoCacheJson(res, { success: false, error: 'Internal server error' });
  }
}

module.exports = {
  createPaymentSession,
  getPaymentStatus,
  getBillingContact,
  reconcilePayment,
  createPayperInvoice,
  getCheckoutCssInfo,
  returnSuccess,
  returnError,
  returnCancel,
};
