/**
 * Payper tax invoice-receipt via Pelecard CreatePayperInvoice API.
 * Called after successful online payment (J4). Never throws — payment must not be affected.
 */
const supabase = require('../config/supabase');
const pelecardService = require('./pelecardService');
const {
  chargeAmountFromPayment,
  resolvePaymentIsoCode,
} = require('./paymentChargeAmountService');
const {
  resolveClientName,
  resolvePaymentDescription,
  resolveRecipientEmail,
  resolveRecipientPhone,
  resolveContactIdNumber,
} = require('../lib/paymentLinkContact');
const {
  extractPelecardCustomerId,
  extractCardLastFour,
  extractCardValidity,
  extractCardTypeCode,
  extractNumOfPayments,
  extractCcPaymentType,
  extractTrxRecordId,
  extractTransactionTotalAgorot,
  extractTransactionTotalIls,
  extractTransactionUuid,
  summarizePelecardTotalDebug,
  formatPayperReceiptDate,
  parsePayperDocumentSystemId,
} = require('../lib/pelecardTransactionFields');
const { ensurePaymentLinkPlanContact } = require('../lib/ensurePaymentLinkPlanContact');
const { profileFromPayment } = require('../lib/pelecardProfiles');

const DEFAULT_PAYPER_PATH = 'services/CreatePayperInvoice';
const PAYPER_PATH_FALLBACKS = [
  'services/CreatePayperInvoice',
  'PaymentGW/CreatePayperInvoice',
];

function isPayperEnabled() {
  const flag = (process.env.ENABLE_PAYPER_INVOICE || 'true').trim().toLowerCase();
  return flag !== 'false' && flag !== '0';
}

function getPayperConfig(paymentLink) {
  const config = pelecardService.getConfig(profileFromPayment(paymentLink));
  return {
    ...config,
    invoicePath: (process.env.PELECARD_PAYPER_INVOICE_PATH || DEFAULT_PAYPER_PATH).trim(),
    incomeId: Number(process.env.PAYPER_INCOME_ID || '-100000000'),
    sendByMail: (process.env.PAYPER_SEND_BY_MAIL || 'true').trim().toLowerCase() !== 'false',
    documentNoVat: (process.env.PAYPER_DOCUMENT_NO_VAT || 'false').trim().toLowerCase() === 'true',
    documentRounded: (process.env.PAYPER_DOCUMENT_ROUNDED || 'false').trim().toLowerCase() === 'true',
    includeVat: (process.env.PAYPER_INCLUDE_VAT || 'true').trim().toLowerCase() !== 'false',
  };
}

function formatIlsAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return '0';
  return String(Math.round(n * 100) / 100);
}

function buildInvoiceDescription(paymentLink) {
  const order = resolvePaymentDescription(paymentLink);
  const base = paymentLink.description?.trim();
  if (base && base !== order) return base.slice(0, 500);
  return order.slice(0, 500);
}

async function resolveCustomerUniqueId(paymentLink, callbackData, verifyPayload) {
  if (paymentLink.pelecard_customer_id?.trim()) {
    return paymentLink.pelecard_customer_id.trim();
  }
  const fromTx = extractPelecardCustomerId(callbackData, verifyPayload);
  if (fromTx) return fromTx;
  const fromContact = await resolveContactIdNumber(paymentLink);
  if (fromContact) return fromContact.replace(/\D/g, '').slice(0, 20) || fromContact;
  return '000000000';
}

function agorotToIls(agorot) {
  return Math.round(Number(agorot)) / 100;
}

function resolveChargedAgorot(paymentLink, callbackData, verifyPayload) {
  const fromTx = extractTransactionTotalAgorot(callbackData, verifyPayload);
  if (fromTx != null) return fromTx;

  const chargeNis = chargeAmountFromPayment(paymentLink);
  if (Number.isFinite(chargeNis) && chargeNis > 0) {
    return Math.round(chargeNis * 100);
  }
  return null;
}

function getVatRateForPayment(paymentLink) {
  const netIls = Number(paymentLink.amount) || 0;
  const vatIls = Number(paymentLink.vat_amount) || 0;
  if (netIls > 0 && vatIls > 0) return vatIls / netIls;
  const paidAt = paymentLink.paid_at || paymentLink.created_at;
  const date = paidAt ? new Date(paidAt) : new Date();
  return date < new Date('2025-01-01T00:00:00') ? 0.17 : 0.18;
}

function deriveNetAgorotFromGross(grossAgorot, paymentLink) {
  const netIls = Number(paymentLink.amount) || 0;
  const vatIls = Number(paymentLink.vat_amount) || 0;
  const expectedGrossAgorot = Math.round((netIls + vatIls) * 100);
  if (netIls > 0 && vatIls > 0 && Math.abs(expectedGrossAgorot - grossAgorot) <= 1) {
    return Math.round(netIls * 100);
  }
  const rate = getVatRateForPayment(paymentLink);
  return Math.round(grossAgorot / (1 + rate));
}

function isIsraeliIlsPayment(paymentLink) {
  return resolvePaymentIsoCode(paymentLink) === 'ILS';
}

function buildPayperAmountStrategy(paymentLink, grossAgorot, config, mode = 'auto') {
  const grossAmount = formatIlsAmount(agorotToIls(grossAgorot));
  const isIls = isIsraeliIlsPayment(paymentLink);

  if (mode === 'gross_no_vat') {
    return {
      invoiceUnitPrice: grossAmount,
      receiptAmount: grossAmount,
      includeVat: false,
      amountMode: 'gross_no_vat',
    };
  }

  if (isIls && config.includeVat && !config.documentNoVat) {
    const netAgorot = deriveNetAgorotFromGross(grossAgorot, paymentLink);
    const netIls = Number(paymentLink.amount) || 0;
    const vatIls = Number(paymentLink.vat_amount) || 0;
    const expectedGrossAgorot = Math.round((netIls + vatIls) * 100);
    const amountMode =
      netIls > 0 &&
      vatIls > 0 &&
      Math.abs(expectedGrossAgorot - grossAgorot) <= 1
        ? 'crm_net_gross'
        : 'ils_derived_net_gross';

    return {
      invoiceUnitPrice: formatIlsAmount(agorotToIls(netAgorot)),
      receiptAmount: grossAmount,
      includeVat: true,
      amountMode,
    };
  }

  return {
    invoiceUnitPrice: grossAmount,
    receiptAmount: grossAmount,
    includeVat: false,
    amountMode: 'gross_no_vat',
  };
}

function resolvePayperLineAmounts(paymentLink, callbackData, verifyPayload, config) {
  const grossAgorot = resolveChargedAgorot(paymentLink, callbackData, verifyPayload);
  if (grossAgorot == null) {
    const fallback = formatIlsAmount(chargeAmountFromPayment(paymentLink));
    return {
      invoiceUnitPrice: fallback,
      receiptAmount: fallback,
      includeVat: false,
      amountMode: 'fallback',
      pelecardTotalAgorot: null,
    };
  }

  const strategy = buildPayperAmountStrategy(paymentLink, grossAgorot, config);
  return {
    ...strategy,
    pelecardTotalAgorot: grossAgorot,
  };
}

function payperInvoiceFallbackAttempts(paymentLink, grossAgorot, config, primaryMode) {
  if (grossAgorot == null) return [];

  const attempts = [];
  const push = (strategy, omitReceiptLines = false) => {
    if (strategy.amountMode === primaryMode && !omitReceiptLines) return;
    attempts.push({
      lineAmounts: { ...strategy, pelecardTotalAgorot: grossAgorot },
      omitReceiptLines,
    });
  };

  const isIls = isIsraeliIlsPayment(paymentLink);

  if (isIls && config.includeVat && !config.documentNoVat) {
    push(buildPayperAmountStrategy(paymentLink, grossAgorot, config), true);
  } else {
    push(buildPayperAmountStrategy(paymentLink, grossAgorot, config, 'gross_no_vat'));
  }

  const seen = new Set();
  return attempts.filter((attempt) => {
    const key = `${attempt.lineAmounts.amountMode}:${attempt.omitReceiptLines}:${attempt.lineAmounts.invoiceUnitPrice}:${attempt.lineAmounts.receiptAmount}:${attempt.lineAmounts.includeVat}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isPayperTotalMismatchError(data) {
  const message = String(data?.ErrorMessage ?? data?.error ?? '').toLowerCase();
  return message.includes('total') && message.includes('receipt');
}

function buildReceiptLines(paymentLink, callbackData, verifyPayload, paidAt, receiptAmount) {
  const amount =
    receiptAmount ?? formatIlsAmount(chargeAmountFromPayment(paymentLink));
  const validity = extractCardValidity(callbackData, verifyPayload) || '12/2030';
  return [
    {
      payment_type: 'Cc',
      date: formatPayperReceiptDate(paidAt || paymentLink.paid_at),
      cc_num: extractCardLastFour(callbackData, verifyPayload),
      cc_payment_type: extractCcPaymentType(callbackData, verifyPayload),
      cc_validity: validity,
      cc_type: extractCardTypeCode(callbackData, verifyPayload),
      num_of_payments: extractNumOfPayments(callbackData, verifyPayload),
      amount,
      currency_symbol: 'ILS',
    },
  ];
}

async function enrichVerifyPayloadForPayper(paymentLink, callbackData, verifyPayload = {}) {
  const merged = {
    ...(verifyPayload && typeof verifyPayload === 'object' ? verifyPayload : {}),
  };

  const transactionUuid = extractTransactionUuid(callbackData, merged, paymentLink);
  if (!transactionUuid) {
    return merged;
  }

  const profile = profileFromPayment(paymentLink);
  try {
    const tx = await pelecardService.getTransaction(String(transactionUuid), profile);
    merged.pelecard = tx.raw;
    merged.resultData = tx.result;
  } catch (err) {
    console.warn('[Payper] GetTransaction before invoice failed:', err.message || err);
  }

  return merged;
}

async function resolveTrxRecordId(paymentLink, callbackData, verifyPayload) {
  const fromPayload = extractTrxRecordId(callbackData, verifyPayload);
  if (fromPayload) return fromPayload;

  const stored = paymentLink?.pelecard_transaction_id;
  if (stored && /^\d+$/.test(String(stored).trim())) {
    return String(stored).trim();
  }

  return null;
}

async function buildPayperInvoiceAttempt(
  paymentLink,
  callbackData,
  verifyPayload,
  lineAmountsOverride = null,
  options = {},
) {
  const config = getPayperConfig(paymentLink);
  pelecardService.assertCredentials(config);

  const enrichedVerify = await enrichVerifyPayloadForPayper(
    paymentLink,
    callbackData,
    verifyPayload,
  );

  const trxRecordId = await resolveTrxRecordId(paymentLink, callbackData, enrichedVerify);

  if (!trxRecordId) {
    const err = new Error('Missing Pelecard trxRecordId (TransactionPelecardId) for Payper invoice');
    err.code = 'PAYPER_MISSING_TRX';
    err.transactionUuid = extractTransactionUuid(callbackData, enrichedVerify, paymentLink);
    throw err;
  }

  const customerEmail = await resolveRecipientEmail(paymentLink);
  if (!customerEmail) {
    const err = new Error('Missing customer email for Payper invoice');
    err.code = 'PAYPER_MISSING_EMAIL';
    err.planContactId = paymentLink.plan_contact_id ?? null;
    err.paymentPlanId = paymentLink.payment_plan_id ?? null;
    err.billingContactEmail = paymentLink.billing_contact_email ?? null;
    throw err;
  }

  const customerName = await resolveClientName(paymentLink);
  const customerMobile = (await resolveRecipientPhone(paymentLink)) || '';
  const customerUniqueId = await resolveCustomerUniqueId(paymentLink, callbackData, enrichedVerify);
  const lineAmounts =
    lineAmountsOverride ??
    resolvePayperLineAmounts(paymentLink, callbackData, enrichedVerify, config);
  const description = buildInvoiceDescription(paymentLink);
  const omitReceiptLines = Boolean(options.omitReceiptLines);

  const dataPayper = {
    customer_unique_id: customerUniqueId,
    customer_mail: customerEmail,
    customer_name: customerName,
    discount_with_vat: '0',
    customer_mobile: customerMobile,
    document_no_vat: config.documentNoVat,
    document_rounded: config.documentRounded,
    send_by_mail: config.sendByMail,
    income_id: config.incomeId,
    invoice_lines: [
      {
        description,
        quantity: '1',
        price_per_unit: lineAmounts.invoiceUnitPrice,
        include_vat: lineAmounts.includeVat ? 'true' : 'false',
        catalog_id: 'null',
        currency_symbol: 'ILS',
      },
    ],
  };

  if (!omitReceiptLines) {
    dataPayper.receipt_lines = buildReceiptLines(
      paymentLink,
      callbackData,
      enrichedVerify,
      paymentLink.paid_at,
      lineAmounts.receiptAmount,
    );
  }

  const payload = {
    terminalNumber: config.terminal,
    user: config.user,
    password: config.password,
    trxRecordId: String(trxRecordId),
    PayperParameters: {
      typeDocument: 'Invoice-Receipt',
      DataPayper: dataPayper,
    },
  };

  return {
    payload,
    config,
    enrichedVerify,
    lineAmounts,
    callbackData,
    verifyPayload,
    omitReceiptLines,
  };
}

async function buildCreatePayperInvoicePayload(
  paymentLink,
  callbackData,
  verifyPayload,
  lineAmountsOverride = null,
  options = {},
) {
  const attempt = await buildPayperInvoiceAttempt(
    paymentLink,
    callbackData,
    verifyPayload,
    lineAmountsOverride,
    options,
  );
  return attempt.payload;
}

function isHtmlNotFoundResponse(data) {
  const raw = data?.raw;
  return typeof raw === 'string' && /not found|error code:\s*404/i.test(raw);
}

function payperInvoicePaths(config) {
  const configured = (config.invoicePath || DEFAULT_PAYPER_PATH).trim();
  return [...new Set([configured, ...PAYPER_PATH_FALLBACKS])];
}

async function postCreatePayperInvoice(payload, config) {
  const paths = payperInvoicePaths(config);
  let last = null;

  for (const path of paths) {
    const result = await pelecardService.pelecardPost(path, payload, config);
    last = { ...result, invoicePath: path };

    if (!isHtmlNotFoundResponse(result.data)) {
      return last;
    }

    console.warn('[Payper] CreatePayperInvoice path returned HTML 404, trying next', {
      path,
      baseUrl: config.baseUrl,
    });
  }

  return last;
}

function summarizePelecardResponse(data) {
  if (!data || typeof data !== 'object') return data;
  if (data.raw) {
    return { raw: String(data.raw).replace(/\s+/g, ' ').slice(0, 400) };
  }
  return {
    StatusCode: data.StatusCode ?? data.statusCode ?? null,
    ErrorMessage: data.ErrorMessage ?? data.error ?? null,
    InvoiceStatus: data.PayperData?.InvoiceStatus ?? null,
  };
}

function isPayperSuccess(data) {
  const statusCode = String(data?.StatusCode ?? data?.statusCode ?? '').trim();
  const invoiceStatus = String(data?.PayperData?.InvoiceStatus ?? '').trim();
  return statusCode === '000' && invoiceStatus.toLowerCase() === 'success';
}

async function persistPayperInvoiceResult(
  paymentLinkId,
  payload,
  responseData,
  status,
  paymentLink = null,
) {
  const payperData = responseData?.PayperData || {};
  const documentSystemId = parsePayperDocumentSystemId(payperData);
  const createdAt = status === 'success' ? new Date().toISOString() : null;

  const transactionUuid = paymentLink
    ? extractTransactionUuid(
        paymentLink.pelecard_raw_response?.callback || {},
        paymentLink.pelecard_raw_response?.pelecard || {},
        paymentLink,
      )
    : null;

  const update = {
    payper_invoice_status: status,
    payper_raw_response: {
      request: {
        trxRecordId: payload.trxRecordId ?? null,
        transactionUuid,
        typeDocument: payload.PayperParameters?.typeDocument ?? null,
        customer_mail: payload.PayperParameters?.DataPayper?.customer_mail ?? null,
        invoiceUnitPrice:
          payload.PayperParameters?.DataPayper?.invoice_lines?.[0]?.price_per_unit ?? null,
        receiptAmount:
          payload.PayperParameters?.DataPayper?.receipt_lines?.[0]?.amount ?? null,
      },
      response: responseData,
      createdAt: new Date().toISOString(),
    },
    ...(status === 'success'
      ? {
          payper_invoice_link: payperData.InvoiceLink || null,
          payper_invoice_number: payperData.InvoiceNumber || null,
          payper_document_system_id: documentSystemId,
          payper_invoice_created_at: createdAt,
        }
      : {}),
  };

  const { error } = await supabase.from('payment_links').update(update).eq('id', paymentLinkId);
  if (error) {
    console.error('[Payper] Failed to persist invoice result:', error.message || error);
    return { ok: false, error };
  }
  return { ok: true };
}

/**
 * Create Payper Invoice-Receipt for a paid payment link. Idempotent.
 * @returns {Promise<{ skipped?: boolean, success?: boolean, failed?: boolean, reason?: string, invoiceLink?: string }>}
 */
async function createPayperInvoiceForPayment(
  paymentLink,
  { callbackData = {}, verifyPayload = {}, forceRetry = false } = {},
) {
  try {
    if (!isPayperEnabled()) {
      return { skipped: true, reason: 'disabled' };
    }

    if (!paymentLink?.id) {
      return { skipped: true, reason: 'missing_payment' };
    }

    if (paymentLink.status !== 'paid') {
      return { skipped: true, reason: 'not_paid' };
    }

    if (paymentLink.payper_invoice_status === 'success' && paymentLink.payper_invoice_link) {
      return {
        skipped: true,
        reason: 'already_created',
        invoiceLink: paymentLink.payper_invoice_link,
        invoiceNumber: paymentLink.payper_invoice_number,
      };
    }

    if (paymentLink.payper_invoice_status === 'skipped_no_email' && !forceRetry) {
      return { skipped: true, reason: 'no_email' };
    }

    paymentLink = await ensurePaymentLinkPlanContact(paymentLink);

    const config = getPayperConfig(paymentLink);
    try {
      pelecardService.assertCredentials(config);
    } catch {
      console.warn('[Payper] Pelecard credentials missing — skipping invoice');
      await persistPayperInvoiceResult(
        paymentLink.id,
        {},
        { error: 'not_configured' },
        'skipped',
        paymentLink,
      );
      return { skipped: true, reason: 'not_configured' };
    }

    const attempt = await buildPayperInvoiceAttempt(paymentLink, callbackData, verifyPayload);
    let { payload, lineAmounts, enrichedVerify, omitReceiptLines } = attempt;
    let { ok, status: httpStatus, data, invoicePath } = await postCreatePayperInvoice(payload, config);

    if ((!ok || !isPayperSuccess(data)) && isPayperTotalMismatchError(data)) {
      const fallbacks = payperInvoiceFallbackAttempts(
        paymentLink,
        lineAmounts.pelecardTotalAgorot,
        config,
        lineAmounts.amountMode,
      );
      for (const fallback of fallbacks) {
        console.info('[Payper] Retrying invoice with alternate amount strategy', {
          paymentLinkId: paymentLink.id,
          from: lineAmounts.amountMode,
          to: fallback.lineAmounts.amountMode,
          omitReceiptLines: fallback.omitReceiptLines,
          invoiceUnitPrice: fallback.lineAmounts.invoiceUnitPrice,
          receiptAmount: fallback.lineAmounts.receiptAmount,
          includeVat: fallback.lineAmounts.includeVat,
          pelecardTotalAgorot: fallback.lineAmounts.pelecardTotalAgorot,
        });
        const retryAttempt = await buildPayperInvoiceAttempt(
          paymentLink,
          callbackData,
          enrichedVerify,
          fallback.lineAmounts,
          { omitReceiptLines: fallback.omitReceiptLines },
        );
        payload = retryAttempt.payload;
        lineAmounts = retryAttempt.lineAmounts;
        omitReceiptLines = retryAttempt.omitReceiptLines;
        ({ ok, status: httpStatus, data, invoicePath } = await postCreatePayperInvoice(payload, config));
        if (ok && isPayperSuccess(data)) break;
      }
    }

    if (!ok || !isPayperSuccess(data)) {
      const message =
        data?.ErrorMessage ||
        data?.PayperData?.InvoiceStatus ||
        data?.error ||
        (data?.raw ? 'Non-JSON response from Pelecard' : 'CreatePayperInvoice failed');
      console.error('[Payper] Invoice creation failed', {
        paymentLinkId: paymentLink.id,
        planContactId: paymentLink.plan_contact_id ?? null,
        paymentPlanId: paymentLink.payment_plan_id ?? null,
        pelecardProfile: config.profile,
        invoicePath: invoicePath || config.invoicePath,
        incomeId: config.incomeId,
        trxRecordId: payload.trxRecordId,
        transactionUuid: extractTransactionUuid(callbackData, enrichedVerify, paymentLink),
        pelecardTotalAgorot: lineAmounts.pelecardTotalAgorot ?? null,
        amountMode: lineAmounts.amountMode ?? null,
        omitReceiptLines,
        pelecardTotalDebug: summarizePelecardTotalDebug(callbackData, enrichedVerify),
        numOfPayments: extractNumOfPayments(callbackData, enrichedVerify),
        invoiceUnitPrice:
          payload.PayperParameters?.DataPayper?.invoice_lines?.[0]?.price_per_unit ?? null,
        receiptAmount:
          payload.PayperParameters?.DataPayper?.receipt_lines?.[0]?.amount ?? null,
        includeVat:
          payload.PayperParameters?.DataPayper?.invoice_lines?.[0]?.include_vat ?? null,
        customerMail: payload.PayperParameters?.DataPayper?.customer_mail,
        httpStatus,
        statusCode: data?.StatusCode ?? data?.statusCode ?? null,
        response: summarizePelecardResponse(data),
        message,
      });
      await persistPayperInvoiceResult(
        paymentLink.id,
        payload,
        data || {},
        'failed',
        paymentLink,
      );
      return { failed: true, reason: message };
    }

    await persistPayperInvoiceResult(paymentLink.id, payload, data, 'success', paymentLink);
    console.info('[Payper] Invoice created', {
      paymentLinkId: paymentLink.id,
      invoiceNumber: data?.PayperData?.InvoiceNumber,
      invoiceLink: data?.PayperData?.InvoiceLink,
    });

    return {
      success: true,
      invoiceLink: data?.PayperData?.InvoiceLink || null,
      invoiceNumber: data?.PayperData?.InvoiceNumber || null,
      documentSystemId: parsePayperDocumentSystemId(data?.PayperData),
    };
  } catch (error) {
    const isMissingEmail = error.code === 'PAYPER_MISSING_EMAIL';
    console.error('[Payper] Invoice creation error (payment unaffected):', error.message || error, {
      paymentLinkId: paymentLink?.id ?? null,
      planContactId: paymentLink?.plan_contact_id ?? error.planContactId ?? null,
      paymentPlanId: paymentLink?.payment_plan_id ?? error.paymentPlanId ?? null,
      billingContactEmail: paymentLink?.billing_contact_email ?? error.billingContactEmail ?? null,
      code: error.code ?? null,
    });
    if (paymentLink?.id) {
      await persistPayperInvoiceResult(
        paymentLink.id,
        {},
        { error: String(error.message || error), code: error.code ?? null },
        isMissingEmail ? 'skipped_no_email' : 'failed',
        paymentLink,
      );
    }
    return { failed: true, reason: error.message || String(error), skipped: isMissingEmail };
  }
}

/**
 * Retry invoice creation for paid links missing a successful Payper invoice.
 */
async function reconcilePendingPayperInvoices(options = {}) {
  const limit = Number(options.limit || process.env.PAYPER_RECONCILE_BATCH_SIZE || '20');
  const lookbackHours = Number(options.lookbackHours || process.env.PAYPER_RECONCILE_LOOKBACK_HOURS || '168');
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from('payment_links')
    .select('*')
    .eq('status', 'paid')
    .eq('payment_method', 'pelecard')
    .or('payper_invoice_status.is.null,payper_invoice_status.eq.failed,payper_invoice_status.eq.pending')
    .gte('paid_at', since)
    .order('paid_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[Payper] reconcile query failed:', error.message || error);
    return { ok: false, error, processed: 0 };
  }

  let processed = 0;
  let succeeded = 0;

  for (const row of rows || []) {
    if (!row.pelecard_transaction_id) continue;
    processed += 1;
    const callbackData = row.pelecard_raw_response?.callback || {};
    const verifyPayload = row.pelecard_raw_response?.pelecard || {};
    const result = await createPayperInvoiceForPayment(row, { callbackData, verifyPayload });
    if (result.success) succeeded += 1;
  }

  if (processed > 0) {
    console.info('[Payper] Reconciliation batch', { processed, succeeded });
  }

  return { ok: true, processed, succeeded };
}

module.exports = {
  isPayperEnabled,
  getPayperConfig,
  createPayperInvoiceForPayment,
  reconcilePendingPayperInvoices,
  buildCreatePayperInvoicePayload,
};
