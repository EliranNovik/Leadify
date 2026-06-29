/**
 * Pelecard payment persistence + reconciliation.
 * Ensures charges confirmed by Pelecard are eventually reflected in payment_links / payment_plans
 * even when callbacks, redirects, or partial DB failures occur.
 */
const supabase = require('../config/supabase');
const pelecardService = require('./pelecardService');
const { profileFromPayment } = require('../lib/pelecardProfiles');
const { rateFromPelecardRawResponse } = require('../lib/paymentLinkExchangeRate');
const { chargeAmountFromPayment } = require('./paymentChargeAmountService');
const { sendPaymentConfirmationEmail } = require('./paymentConfirmationEmailService');
const { extractPelecardCustomerId } = require('../lib/pelecardTransactionFields');
const { createPayperInvoiceForPayment } = require('./payperInvoiceService');

const DB_RETRY_ATTEMPTS = Number(process.env.PELECARD_DB_RETRY_ATTEMPTS || '3');
const DB_RETRY_DELAY_MS = Number(process.env.PELECARD_DB_RETRY_DELAY_MS || '300');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logSupabaseError(context, error) {
  if (error) {
    console.error(`[Pelecard] ${context}:`, error.message || error);
  }
}

function isSessionExpiredCode(statusCode) {
  const code = String(statusCode || '').trim();
  return code === '301' || code === '302' || code === '303';
}

function extractPelecardMeta(data = {}) {
  const statusCode = String(
    data.PelecardStatusCode || data.StatusCode || data.statusCode || '',
  ).trim();
  const statusDescription = String(
    data.StatusDescription ||
      data.statusDescription ||
      data.ErrorMessage ||
      data.errorMessage ||
      '',
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
    raw.callback?.ErrorMessage ||
    null
  );
}

function getStoredTransactionId(payment) {
  if (!payment) return null;
  return (
    payment.pelecard_transaction_id ||
    payment.pelecard_raw_response?.callback?.PelecardTransactionId ||
    payment.pelecard_raw_response?.callback?.TransactionId ||
    null
  );
}

async function withDbRetry(label, fn) {
  let lastError = null;
  for (let attempt = 1; attempt <= DB_RETRY_ATTEMPTS; attempt += 1) {
    const result = await fn();
    if (result?.ok !== false) {
      return result;
    }
    lastError = result.error;
    if (attempt < DB_RETRY_ATTEMPTS) {
      console.warn(`[Pelecard] ${label} failed (attempt ${attempt}/${DB_RETRY_ATTEMPTS}), retrying…`);
      await sleep(DB_RETRY_DELAY_MS * attempt);
    }
  }
  logSupabaseError(`${label} failed after ${DB_RETRY_ATTEMPTS} attempts`, lastError);
  return { ok: false, error: lastError };
}

async function fetchPaymentByToken(secureToken) {
  const { data, error } = await supabase
    .from('payment_links')
    .select(`
      *,
      leads:client_id(lead_number, topic, name, email, phone)
    `)
    .eq('secure_token', secureToken)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  let enriched = data;

  if (!enriched.leads && enriched.legacy_id) {
    const { data: legacyLead } = await supabase
      .from('leads_lead')
      .select('id, name, email, phone, topic')
      .eq('id', enriched.legacy_id)
      .maybeSingle();

    if (legacyLead) {
      enriched = {
        ...enriched,
        leads: {
          lead_number: String(legacyLead.id),
          name: legacyLead.name,
          email: legacyLead.email,
          phone: legacyLead.phone,
          topic: legacyLead.topic,
        },
      };
    }
  }

  const isLegacy =
    enriched.legacy_id != null ||
    enriched.is_legacy_payment_plan === true ||
    String(enriched.client_id || '').startsWith('legacy_');

  if (isLegacy && enriched.payment_plan_id) {
    const { data: legacyPlan } = await supabase
      .from('finances_paymentplanrow')
      .select(`
        id, order, currency_id, actual_date, client_id,
        accounting_currencies!finances_paymentplanrow_currency_id_fkey (name, iso_code)
      `)
      .eq('id', enriched.payment_plan_id)
      .maybeSingle();
    if (legacyPlan) enriched = { ...enriched, legacy_payment_plan: legacyPlan };
  } else if (enriched.payment_plan_id) {
    const { data: planRow } = await supabase
      .from('payment_plans')
      .select('payment_order, currency, currency_id, client_id, paid, paid_at')
      .eq('id', enriched.payment_plan_id)
      .maybeSingle();
    if (planRow) enriched = { ...enriched, payment_plans: planRow };
  }

  return enriched;
}

function isPlanMarkedPaid(payment) {
  if (!payment?.payment_plan_id) return true;
  const isLegacy =
    payment.legacy_id != null ||
    payment.is_legacy_payment_plan === true ||
    String(payment.client_id || '').startsWith('legacy_');
  if (isLegacy) {
    return Boolean(payment.legacy_payment_plan?.actual_date);
  }
  return payment.payment_plans?.paid === true;
}

async function markPaymentPlanPaid(paymentLink) {
  if (!paymentLink?.payment_plan_id) return { ok: true };

  const isLegacy =
    paymentLink.legacy_id != null ||
    paymentLink.is_legacy_payment_plan === true ||
    String(paymentLink.client_id || '').startsWith('legacy_');

  if (isLegacy) {
    const paidDate = new Date().toISOString().split('T')[0];
    const { error } = await supabase
      .from('finances_paymentplanrow')
      .update({ actual_date: paidDate })
      .eq('id', paymentLink.payment_plan_id);
    if (error) return { ok: false, error };
    return { ok: true };
  }

  const email = paymentLink.leads?.email || null;
  const { error } = await supabase
    .from('payment_plans')
    .update({
      paid: true,
      paid_at: new Date().toISOString(),
      ...(email ? { paid_by: email } : {}),
    })
    .eq('id', paymentLink.payment_plan_id);

  if (error) return { ok: false, error };
  return { ok: true };
}

async function recordTransaction(paymentLinkId, status, amount, method, extra = {}) {
  const { error } = await supabase.from('payment_transactions').insert({
    payment_link_id: paymentLinkId,
    status,
    payment_method: method,
    amount,
    completed_at: status === 'success' ? new Date().toISOString() : null,
    transaction_reference: extra.transactionReference || null,
    error_message: extra.errorMessage || null,
  });
  if (error) logSupabaseError('Failed to insert payment_transactions row', error);
  return { ok: !error, error };
}

/**
 * Always persist callback payload + transaction id immediately (audit + reconciliation input).
 */
async function persistCallbackSnapshot(payment, callbackData, extraRaw = {}) {
  if (!payment?.id) return { ok: false };

  const previousRaw =
    payment.pelecard_raw_response && typeof payment.pelecard_raw_response === 'object'
      ? payment.pelecard_raw_response
      : {};

  const { transactionId, statusCode } = extractPelecardMeta(callbackData);
  const customerId = extractPelecardCustomerId(callbackData, previousRaw?.pelecard);

  const update = {
    pelecard_raw_response: {
      ...previousRaw,
      ...extraRaw,
      callback: callbackData,
      callbackReceivedAt: new Date().toISOString(),
    },
    ...(transactionId ? { pelecard_transaction_id: String(transactionId) } : {}),
    ...(statusCode ? { pelecard_status_code: statusCode } : {}),
    ...(customerId ? { pelecard_customer_id: customerId } : {}),
  };

  const { error } = await supabase.from('payment_links').update(update).eq('id', payment.id);
  if (error) {
    logSupabaseError('Failed to persist callback snapshot', error);
    return { ok: false, error };
  }
  return { ok: true };
}

async function verifyPelecardTransaction(transactionId, callbackData, profile = 'production') {
  let resolvedStatusCode = extractPelecardMeta(callbackData).statusCode;
  let verifyPayload = { callback: callbackData };
  let resultData = callbackData;

  if (transactionId) {
    try {
      const tx = await pelecardService.getTransaction(String(transactionId), profile);
      verifyPayload.pelecard = tx.raw;
      resultData = tx.result || {};
      resolvedStatusCode = String(
        resultData.StatusCode || resultData.statusCode || resolvedStatusCode || '',
      ).trim();
    } catch (verifyErr) {
      console.error('[Pelecard] GetTransaction failed:', verifyErr.message || verifyErr);
    }
  }

  const verified = pelecardService.isSuccessfulStatus(resolvedStatusCode, resultData);
  return {
    verified,
    resolvedStatusCode,
    verifyPayload,
    resultData,
    getTransactionAttempted: Boolean(transactionId),
  };
}

async function persistPaymentSuccess(payment, secureToken, callbackData, verifyResult) {
  const { resolvedStatusCode, verifyPayload } = verifyResult;
  const transactionId =
    extractPelecardMeta(callbackData).transactionId || getStoredTransactionId(payment);
  const previousRaw =
    payment.pelecard_raw_response && typeof payment.pelecard_raw_response === 'object'
      ? payment.pelecard_raw_response
      : {};

  const wasAlreadyPaid = payment.status === 'paid';
  const paidAt = new Date().toISOString();
  const txRef = transactionId ? String(transactionId) : `PELE_${Date.now()}`;
  const paidRate =
    rateFromPelecardRawResponse(previousRaw) ??
    (payment.rate != null && Number.isFinite(Number(payment.rate)) && Number(payment.rate) > 0
      ? Number(payment.rate)
      : null);

  const customerId = extractPelecardCustomerId(callbackData, verifyPayload);

  const linkResult = await withDbRetry('payment_links paid update', async () => {
    const { error: linkError } = await supabase
      .from('payment_links')
      .update({
        status: 'paid',
        paid_at: paidAt,
        payment_method: 'pelecard',
        transaction_reference: txRef,
        ...(paidRate != null ? { rate: paidRate } : {}),
        pelecard_transaction_id: transactionId ? String(transactionId) : null,
        ...(customerId ? { pelecard_customer_id: customerId } : {}),
        payper_invoice_status:
          payment.payper_invoice_status === 'success' ||
          payment.payper_invoice_status === 'failed' ||
          payment.payper_invoice_status === 'skipped_no_email' ||
          payment.payper_invoice_status === 'skipped'
            ? payment.payper_invoice_status
            : 'pending',
        pelecard_confirmation_key:
          callbackData.ConfirmationKey ||
          callbackData.confirmationKey ||
          payment.pelecard_confirmation_key,
        pelecard_voucher_id: callbackData.VoucherId || callbackData.voucherId || null,
        pelecard_auth_number:
          callbackData.AuthorizationNumber ||
          callbackData.DebitApproveNumber ||
          callbackData.ApprovalNo ||
          null,
        pelecard_status_code: resolvedStatusCode,
        pelecard_raw_response: {
          ...previousRaw,
          callback: callbackData,
          pelecard: verifyPayload?.pelecard ?? verifyPayload,
          reconciledAt: new Date().toISOString(),
          reconcilePlanPending: false,
        },
      })
      .eq('id', payment.id);

    if (linkError) return { ok: false, error: linkError };
    return { ok: true };
  });

  if (!linkResult.ok) {
    return linkResult;
  }

  const planResult = await withDbRetry('payment plan paid update', () =>
    markPaymentPlanPaid(payment),
  );

  if (!planResult.ok) {
    await supabase
      .from('payment_links')
      .update({
        pelecard_raw_response: {
          ...previousRaw,
          callback: callbackData,
          pelecard: verifyPayload?.pelecard ?? verifyPayload,
          reconciledAt: new Date().toISOString(),
          reconcilePlanPending: true,
        },
      })
      .eq('id', payment.id);
    console.error('[Pelecard] CRITICAL: link marked paid but payment plan update failed — scheduler will retry');
  }

  await recordTransaction(payment.id, 'success', chargeAmountFromPayment(payment), 'pelecard', {
    transactionReference: txRef,
  });

  console.info('[Pelecard] Payment recorded as paid', {
    paymentId: secureToken,
    statusCode: resolvedStatusCode || '(empty)',
    transactionId: transactionId || null,
    planSynced: planResult.ok,
    pelecardStatus: verifyResult.resultData?.Status ?? verifyResult.resultData?.Result ?? null,
  });

  if (!wasAlreadyPaid && planResult.ok) {
    setImmediate(async () => {
      try {
        const paidPayment = {
          ...payment,
          status: 'paid',
          paid_at: paidAt,
          pelecard_transaction_id: transactionId ? String(transactionId) : payment.pelecard_transaction_id,
          pelecard_customer_id: customerId || payment.pelecard_customer_id,
          pelecard_raw_response: {
            ...previousRaw,
            callback: callbackData,
            pelecard: verifyPayload?.pelecard ?? verifyPayload,
          },
        };

        const invoiceResult = await createPayperInvoiceForPayment(paidPayment, {
          callbackData,
          verifyPayload,
        });

        const fresh = await fetchPaymentByToken(secureToken);
        await sendPaymentConfirmationEmail(fresh || paidPayment, {
          paidAt,
          invoiceLink:
            fresh?.payper_invoice_link ||
            invoiceResult.invoiceLink ||
            null,
          invoiceNumber:
            fresh?.payper_invoice_number ||
            invoiceResult.invoiceNumber ||
            null,
        });
      } catch (postPaidErr) {
        console.error('[Pelecard] Post-payment Payper/email step failed:', postPaidErr.message || postPaidErr);
        try {
          await sendPaymentConfirmationEmail(payment, { paidAt });
        } catch (emailErr) {
          console.error('[PaymentConfirmationEmail] Fallback send failed:', emailErr.message || emailErr);
        }
      }
    });
  }

  return { ok: true, planSynced: planResult.ok };
}

async function persistPaymentFailure(payment, secureToken, callbackData, verifyResult, failMessage) {
  const { resolvedStatusCode, verifyPayload } = verifyResult;
  const transactionId = extractPelecardMeta(callbackData).transactionId;
  const previousRaw =
    payment.pelecard_raw_response && typeof payment.pelecard_raw_response === 'object'
      ? payment.pelecard_raw_response
      : {};

  await withDbRetry('payment_links failed update', async () => {
    const { error: linkError } = await supabase
      .from('payment_links')
      .update({
        status: 'failed',
        pelecard_status_code: resolvedStatusCode || extractPelecardMeta(callbackData).statusCode,
        pelecard_raw_response: {
          ...previousRaw,
          callback: callbackData,
          pelecard: verifyPayload?.pelecard ?? verifyPayload,
        },
        ...(transactionId ? { pelecard_transaction_id: String(transactionId) } : {}),
      })
      .eq('id', payment.id);

    if (linkError) return { ok: false, error: linkError };
    return { ok: true };
  });

  await recordTransaction(payment.id, 'failed', chargeAmountFromPayment(payment), 'pelecard', {
    transactionReference: transactionId ? String(transactionId) : null,
    errorMessage: String(failMessage).slice(0, 500),
  });

  console.warn('[Pelecard] Payment recorded as failed', {
    paymentId: secureToken,
    statusCode: resolvedStatusCode,
    message: failMessage,
  });
}

async function handleSessionExpired(payment, callbackData) {
  const previousRaw =
    payment.pelecard_raw_response && typeof payment.pelecard_raw_response === 'object'
      ? payment.pelecard_raw_response
      : {};
  const { statusCode, transactionId } = extractPelecardMeta(callbackData);

  const { error } = await supabase
    .from('payment_links')
    .update({
      status: 'pending',
      pelecard_status_code: statusCode,
      pelecard_raw_response: { ...previousRaw, callback: callbackData, sessionExpired: true },
      ...(transactionId ? { pelecard_transaction_id: String(transactionId) } : {}),
    })
    .eq('id', payment.id);

  if (error) logSupabaseError('session expired reset to pending failed', error);
}

/** Retry payment_plans / legacy row when link is paid but plan was not updated. */
async function reconcilePaidLinkPlan(payment) {
  if (!payment || payment.status !== 'paid') return { ok: true, changed: false };
  if (isPlanMarkedPaid(payment)) {
    if (payment.pelecard_raw_response?.reconcilePlanPending) {
      const previousRaw = payment.pelecard_raw_response;
      await supabase
        .from('payment_links')
        .update({
          pelecard_raw_response: { ...previousRaw, reconcilePlanPending: false },
        })
        .eq('id', payment.id);
    }
    return { ok: true, changed: false };
  }

  const fresh = await fetchPaymentByToken(payment.secure_token);
  const planResult = await withDbRetry('payment plan reconcile', () => markPaymentPlanPaid(fresh || payment));
  return { ok: planResult.ok, changed: planResult.ok, error: planResult.error };
}

/**
 * Reconcile one link via GetTransaction (status poll, callbacks, scheduler).
 */
async function tryReconcilePaymentLink(payment) {
  if (!payment?.secure_token) return payment;

  const full = await fetchPaymentByToken(payment.secure_token);
  if (!full) return payment;

  if (full.status === 'paid') {
    await reconcilePaidLinkPlan(full);
    const withInvoice = await tryCreatePayperInvoiceForPaidLink(full);
    return fetchPaymentByToken(withInvoice?.secure_token || full.secure_token);
  }

  const transactionId = getStoredTransactionId(full);
  if (!transactionId) return full;

  // Only reconcile from polling when we have a callback for this attempt (not a stale tx id alone).
  const callbackData = full.pelecard_raw_response?.callback;
  if (!callbackData || typeof callbackData !== 'object') return full;

  const verifyResult = await verifyPelecardTransaction(transactionId, {
    ...callbackData,
    PelecardTransactionId: transactionId,
  }, profileFromPayment(full));

  if (verifyResult.verified) {
    await persistPaymentSuccess(
      full,
      full.secure_token,
      { ...callbackData, PelecardTransactionId: transactionId },
      verifyResult,
    );
    return fetchPaymentByToken(full.secure_token);
  }

  return full;
}

async function reconcilePaymentBySecureToken(secureToken, options = {}) {
  let payment = await fetchPaymentByToken(secureToken);
  if (!payment && secureToken) {
    const { data: partialRows } = await supabase
      .from('payment_links')
      .select('secure_token')
      .like('secure_token', `${secureToken}%`)
      .order('created_at', { ascending: false })
      .limit(2);
    if (partialRows?.length === 1) {
      payment = await fetchPaymentByToken(partialRows[0].secure_token);
    }
  }
  if (!payment) return { ok: false, error: 'not_found' };

  const transactionId = options.transactionId || getStoredTransactionId(payment);
  if (options.transactionId && !getStoredTransactionId(payment)) {
    await persistCallbackSnapshot(payment, {
      ParamX: payment.secure_token,
      PelecardTransactionId: String(options.transactionId),
      ...(options.authNumber ? { AuthorizationNumber: String(options.authNumber) } : {}),
      manualReconcile: true,
    });
  }

  const updated = await tryReconcilePaymentLink(payment);
  return {
    ok: true,
    paymentId: updated?.secure_token || payment.secure_token,
    status: updated?.status,
    paid: updated?.status === 'paid',
    pelecard_transaction_id: updated?.pelecard_transaction_id || null,
    planSynced: updated?.status === 'paid' ? isPlanMarkedPaid(updated) : undefined,
  };
}

/**
 * Batch reconcile stuck links (processing / failed with tx id, or paid without plan sync).
 */
async function reconcileStalePaymentLinks(options = {}) {
  const lookbackHours = Number(options.lookbackHours || process.env.PELECARD_RECONCILE_LOOKBACK_HOURS || '168');
  const limit = Number(options.limit || process.env.PELECARD_RECONCILE_BATCH_SIZE || '40');
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from('payment_links')
    .select('id, secure_token, status, pelecard_transaction_id, pelecard_raw_response, updated_at')
    .in('status', ['processing', 'failed', 'paid'])
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) {
    logSupabaseError('reconcileStalePaymentLinks query failed', error);
    return { ok: false, error, reconciled: 0, checked: 0 };
  }

  let reconciled = 0;
  let checked = 0;

  for (const row of rows || []) {
    const hasTx = Boolean(getStoredTransactionId(row));
    const planPending =
      row.status === 'paid' &&
      (row.pelecard_raw_response?.reconcilePlanPending || !isPlanMarkedPaid(row));

    if (!hasTx && !planPending) continue;

    checked += 1;
    const before = row.status;
    const updated = await tryReconcilePaymentLink(row);
    if (updated?.status === 'paid' && before !== 'paid') {
      reconciled += 1;
    } else if (before === 'paid' && planPending && isPlanMarkedPaid(updated)) {
      reconciled += 1;
    }
  }

  if (checked > 0) {
    console.info('[Pelecard] Reconciliation batch complete', { checked, reconciled });
  }

  return { ok: true, checked, reconciled };
}

async function tryCreatePayperInvoiceForPaidLink(payment) {
  if (!payment || payment.status !== 'paid') return payment;
  if (payment.payper_invoice_status === 'success' && payment.payper_invoice_link) return payment;
  if (payment.payper_invoice_status === 'failed') return payment;

  const { ensurePaymentLinkPlanContact } = require('../lib/ensurePaymentLinkPlanContact');
  payment = await ensurePaymentLinkPlanContact(payment);

  const callbackData = payment.pelecard_raw_response?.callback || {};
  const verifyPayload = payment.pelecard_raw_response?.pelecard || {};
  await createPayperInvoiceForPayment(payment, { callbackData, verifyPayload });
  return fetchPaymentByToken(payment.secure_token);
}

module.exports = {
  extractPelecardMeta,
  isSessionExpiredCode,
  pelecardDescriptionFromRaw,
  fetchPaymentByToken,
  persistCallbackSnapshot,
  verifyPelecardTransaction,
  persistPaymentSuccess,
  persistPaymentFailure,
  handleSessionExpired,
  tryReconcilePaymentLink,
  reconcilePaymentBySecureToken,
  reconcileStalePaymentLinks,
  reconcilePaidLinkPlan,
  getStoredTransactionId,
  tryCreatePayperInvoiceForPaidLink,
};
