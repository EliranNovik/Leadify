/**
 * Payper tax invoice-receipt via Pelecard CreatePayperInvoice API.
 * Called after successful online payment (J4). Never throws — payment must not be affected.
 */
const supabase = require('../config/supabase');
const pelecardService = require('./pelecardService');
const { chargeAmountFromPayment } = require('./paymentChargeAmountService');
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
  formatPayperReceiptDate,
  parsePayperDocumentSystemId,
} = require('../lib/pelecardTransactionFields');
const { profileFromPayment } = require('../lib/pelecardProfiles');

const DEFAULT_PAYPER_PATH = 'PaymentGW/CreatePayperInvoice';

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

function buildReceiptLines(paymentLink, callbackData, verifyPayload, paidAt) {
  const amount = formatIlsAmount(chargeAmountFromPayment(paymentLink));
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

async function buildCreatePayperInvoicePayload(paymentLink, callbackData, verifyPayload) {
  const config = getPayperConfig(paymentLink);
  pelecardService.assertCredentials(config);

  const trxRecordId =
    paymentLink.pelecard_transaction_id ||
    callbackData?.PelecardTransactionId ||
    callbackData?.TransactionId ||
    null;

  if (!trxRecordId) {
    const err = new Error('Missing Pelecard transaction id for Payper invoice');
    err.code = 'PAYPER_MISSING_TRX';
    throw err;
  }

  const customerEmail = await resolveRecipientEmail(paymentLink);
  if (!customerEmail) {
    const err = new Error('Missing customer email for Payper invoice');
    err.code = 'PAYPER_MISSING_EMAIL';
    throw err;
  }

  const customerName = resolveClientName(paymentLink);
  const customerMobile = (await resolveRecipientPhone(paymentLink)) || '';
  const customerUniqueId = await resolveCustomerUniqueId(paymentLink, callbackData, verifyPayload);
  const ilsAmount = formatIlsAmount(chargeAmountFromPayment(paymentLink));
  const description = buildInvoiceDescription(paymentLink);

  return {
    terminalNumber: config.terminal,
    user: config.user,
    password: config.password,
    trxRecordId: String(trxRecordId),
    PayperParameters: {
      typeDocument: 'Invoice-Receipt',
      DataPayper: {
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
            price_per_unit: ilsAmount,
            include_vat: config.includeVat ? 'true' : 'false',
            catalog_id: 'null',
            currency_symbol: 'ILS',
          },
        ],
        receipt_lines: buildReceiptLines(
          paymentLink,
          callbackData,
          verifyPayload,
          paymentLink.paid_at,
        ),
      },
    },
  };
}

function isPayperSuccess(data) {
  const statusCode = String(data?.StatusCode ?? data?.statusCode ?? '').trim();
  const invoiceStatus = String(data?.PayperData?.InvoiceStatus ?? '').trim();
  return statusCode === '000' && invoiceStatus.toLowerCase() === 'success';
}

async function persistPayperInvoiceResult(paymentLinkId, payload, responseData, status) {
  const payperData = responseData?.PayperData || {};
  const documentSystemId = parsePayperDocumentSystemId(payperData);
  const createdAt = status === 'success' ? new Date().toISOString() : null;

  const update = {
    payper_invoice_status: status,
    payper_raw_response: {
      request: {
        trxRecordId: payload.trxRecordId,
        typeDocument: payload.PayperParameters?.typeDocument,
        customer_mail: payload.PayperParameters?.DataPayper?.customer_mail,
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
async function createPayperInvoiceForPayment(paymentLink, { callbackData = {}, verifyPayload = {} } = {}) {
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

    const config = getPayperConfig(paymentLink);
    try {
      pelecardService.assertCredentials(config);
    } catch {
      console.warn('[Payper] Pelecard credentials missing — skipping invoice');
      await persistPayperInvoiceResult(paymentLink.id, {}, { error: 'not_configured' }, 'skipped');
      return { skipped: true, reason: 'not_configured' };
    }

    const payload = await buildCreatePayperInvoicePayload(paymentLink, callbackData, verifyPayload);
    const { ok, data } = await pelecardService.pelecardPost(config.invoicePath, payload, config);

    if (!ok || !isPayperSuccess(data)) {
      const message =
        data?.ErrorMessage ||
        data?.PayperData?.InvoiceStatus ||
        data?.error ||
        'CreatePayperInvoice failed';
      console.error('[Payper] Invoice creation failed', {
        paymentLinkId: paymentLink.id,
        statusCode: data?.StatusCode,
        message,
      });
      await persistPayperInvoiceResult(paymentLink.id, payload, data || {}, 'failed');
      return { failed: true, reason: message };
    }

    await persistPayperInvoiceResult(paymentLink.id, payload, data, 'success');
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
    console.error('[Payper] Invoice creation error (payment unaffected):', error.message || error);
    if (paymentLink?.id) {
      await persistPayperInvoiceResult(
        paymentLink.id,
        {},
        { error: String(error.message || error) },
        'failed',
      );
    }
    return { failed: true, reason: error.message || String(error) };
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
