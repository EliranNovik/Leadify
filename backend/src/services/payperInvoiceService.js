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
const PAYPER_SAMPLE_INCOME_ID = Number(process.env.PAYPER_SAMPLE_INCOME_ID || '-100000000');

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

function resolveChargedAgorot(paymentLink, callbackData, verifyPayload) {
  const fromTx = extractTransactionTotalAgorot(callbackData, verifyPayload);
  if (fromTx != null) return fromTx;

  const chargeNis = chargeAmountFromPayment(paymentLink);
  if (Number.isFinite(chargeNis) && chargeNis > 0) {
    return Math.round(chargeNis * 100);
  }
  return null;
}

function isIsraeliIlsPayment(paymentLink) {
  return resolvePaymentIsoCode(paymentLink) === 'ILS';
}

function formatIlsFromAgorot(agorot) {
  const n = Math.round(Number(agorot));
  if (!Number.isFinite(n) || n <= 0) return '0';
  const shekels = Math.floor(n / 100);
  const cents = Math.abs(n % 100);
  if (cents === 0) return String(shekels);
  return `${shekels}.${String(cents).padStart(2, '0')}`;
}

function getVatRateForPayment(paymentLink) {
  const netIls = Number(paymentLink.amount) || 0;
  const vatIls = Number(paymentLink.vat_amount) || 0;
  if (netIls > 0 && vatIls > 0) return vatIls / netIls;
  const paidAt = paymentLink.paid_at || paymentLink.created_at;
  const date = paidAt ? new Date(paidAt) : new Date();
  return date < new Date('2025-01-01T00:00:00') ? 0.17 : 0.18;
}

/** Net agorot where net + round(net * vatRate) === gross (Payper exclusive-VAT invoice line). */
function findNetAgorotForGross(grossAgorot, vatRate) {
  const gross = Math.round(Number(grossAgorot));
  if (!Number.isFinite(gross) || gross <= 0) return null;

  let netAgorot = Math.round(gross / (1 + vatRate));
  for (let delta = -50; delta <= 50; delta += 1) {
    const tryNet = netAgorot + delta;
    if (tryNet <= 0) continue;
    if (tryNet + Math.round(tryNet * vatRate) === gross) return tryNet;
  }
  return netAgorot;
}

function estimateInvoiceTotalAgorot(unitPriceStr, includeVat, vatRate) {
  const unitAgorot = Math.round(Number.parseFloat(unitPriceStr) * 100);
  if (!Number.isFinite(unitAgorot) || unitAgorot <= 0) return null;
  if (!includeVat) return unitAgorot;
  return unitAgorot + Math.round(unitAgorot * vatRate);
}

/**
 * Pelecard doc sample (income_id -100000000): same gross on invoice + receipt, include_vat "true".
 * Production income types (e.g. 599): include_vat "true" means unit price is BEFORE VAT — invoice net,
 * receipt gross (DebitTotal), so Payper document total equals receipt sum.
 */
function resolvePayperLineAmounts(paymentLink, callbackData, verifyPayload, config) {
  const grossAgorot = resolveChargedAgorot(paymentLink, callbackData, verifyPayload);
  const grossAmount =
    grossAgorot != null
      ? formatIlsFromAgorot(grossAgorot)
      : formatIlsAmount(chargeAmountFromPayment(paymentLink));
  const taxableIls =
    config.includeVat && !config.documentNoVat && isIsraeliIlsPayment(paymentLink);

  if (!taxableIls) {
    return {
      invoiceUnitPrice: grossAmount,
      receiptAmount: grossAmount,
      includeVat: false,
      vatLineMode: 'no_vat',
      pelecardTotalAgorot: grossAgorot,
    };
  }

  if (config.incomeId === PAYPER_SAMPLE_INCOME_ID) {
    return {
      invoiceUnitPrice: grossAmount,
      receiptAmount: grossAmount,
      includeVat: true,
      vatLineMode: 'sample_same_gross',
      pelecardTotalAgorot: grossAgorot,
    };
  }

  const netIls = Number(paymentLink.amount) || 0;
  const vatIls = Number(paymentLink.vat_amount) || 0;
  const crmGrossAgorot = Math.round((netIls + vatIls) * 100);
  const vatRate = getVatRateForPayment(paymentLink);
  let netAgorot = null;

  if (netIls > 0 && grossAgorot != null && Math.abs(crmGrossAgorot - grossAgorot) <= 1) {
    netAgorot = Math.round(netIls * 100);
  } else if (grossAgorot != null) {
    netAgorot = findNetAgorotForGross(grossAgorot, vatRate);
  }

  if (netAgorot == null) {
    return {
      invoiceUnitPrice: grossAmount,
      receiptAmount: grossAmount,
      includeVat: false,
      vatLineMode: 'fallback_gross_no_vat',
      pelecardTotalAgorot: grossAgorot,
    };
  }

  return {
    invoiceUnitPrice: formatIlsFromAgorot(netAgorot),
    receiptAmount: grossAmount,
    includeVat: true,
    vatLineMode: 'exclusive_net_invoice',
    pelecardTotalAgorot: grossAgorot,
  };
}

function buildLineAmountsOverride(paymentLink, grossAgorot, mode) {
  const grossAmount = formatIlsFromAgorot(grossAgorot);
  if (mode === 'gross_no_vat') {
    return {
      invoiceUnitPrice: grossAmount,
      receiptAmount: grossAmount,
      includeVat: false,
      vatLineMode: 'retry_gross_no_vat',
      pelecardTotalAgorot: grossAgorot,
    };
  }
  return resolvePayperLineAmounts(paymentLink, {}, {}, getPayperConfig(paymentLink));
}

function isPayperTotalMismatchError(data) {
  const message = String(data?.ErrorMessage ?? data?.error ?? '');
  const lower = message.toLowerCase();
  return (
    (lower.includes('total') && lower.includes('receipt')) ||
    message.includes('חוסר התאמה') ||
    message.includes('סכום התקבולים')
  );
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

  dataPayper.receipt_lines = buildReceiptLines(
    paymentLink,
    callbackData,
    enrichedVerify,
    paymentLink.paid_at,
    lineAmounts.receiptAmount,
  );

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
  };
}

async function buildCreatePayperInvoicePayload(
  paymentLink,
  callbackData,
  verifyPayload,
  lineAmountsOverride = null,
) {
  const attempt = await buildPayperInvoiceAttempt(
    paymentLink,
    callbackData,
    verifyPayload,
    lineAmountsOverride,
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
        include_vat:
          payload.PayperParameters?.DataPayper?.invoice_lines?.[0]?.include_vat ?? null,
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

    if (paymentLink.payper_invoice_status === 'failed' && !forceRetry) {
      return { skipped: true, reason: 'failed_use_manual_retry' };
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
    let { payload, lineAmounts, enrichedVerify } = attempt;
    let { ok, status: httpStatus, data, invoicePath } = await postCreatePayperInvoice(payload, config);

    if (
      forceRetry &&
      (!ok || !isPayperSuccess(data)) &&
      isPayperTotalMismatchError(data) &&
      lineAmounts.includeVat &&
      lineAmounts.vatLineMode !== 'retry_gross_no_vat'
    ) {
      console.info('[Payper] Manual retry: trying include_vat false with same gross', {
        paymentLinkId: paymentLink.id,
        from: lineAmounts.vatLineMode,
      });
      const fallbackAmounts = buildLineAmountsOverride(
        paymentLink,
        lineAmounts.pelecardTotalAgorot,
        'gross_no_vat',
      );
      const retryAttempt = await buildPayperInvoiceAttempt(
        paymentLink,
        callbackData,
        enrichedVerify,
        fallbackAmounts,
      );
      payload = retryAttempt.payload;
      lineAmounts = retryAttempt.lineAmounts;
      ({ ok, status: httpStatus, data, invoicePath } = await postCreatePayperInvoice(payload, config));
    }

    if (!ok || !isPayperSuccess(data)) {
      const vatRate = getVatRateForPayment(paymentLink);
      const invoiceTotalAgorot = estimateInvoiceTotalAgorot(
        payload.PayperParameters?.DataPayper?.invoice_lines?.[0]?.price_per_unit,
        lineAmounts.includeVat,
        vatRate,
      );
      const receiptAgorot = lineAmounts.pelecardTotalAgorot;
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
        vatLineMode: lineAmounts.vatLineMode ?? null,
        invoiceTotalAgorot,
        receiptAgorot,
        pelecardTotalDebug: summarizePelecardTotalDebug(callbackData, enrichedVerify),
        requestPayload: {
          trxRecordId: payload.trxRecordId,
          typeDocument: payload.PayperParameters?.typeDocument,
          incomeId: payload.PayperParameters?.DataPayper?.income_id,
          invoiceLine: payload.PayperParameters?.DataPayper?.invoice_lines?.[0],
          receiptLine: payload.PayperParameters?.DataPayper?.receipt_lines?.[0],
        },
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
    .or('payper_invoice_status.is.null,payper_invoice_status.eq.pending')
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
