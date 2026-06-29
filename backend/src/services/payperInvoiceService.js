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
  const profile = profileFromPayment(paymentLink);
  const productionIncomeId = Number(process.env.PAYPER_INCOME_ID || '-100000000');
  const sandboxIncomeId = process.env.PAYPER_SANDBOX_INCOME_ID
    ? Number(process.env.PAYPER_SANDBOX_INCOME_ID)
    : productionIncomeId;
  return {
    ...config,
    profile,
    invoicePath: (process.env.PELECARD_PAYPER_INVOICE_PATH || DEFAULT_PAYPER_PATH).trim(),
    incomeId: profile === 'sandbox' ? sandboxIncomeId : productionIncomeId,
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

/** Only apply include_vat when the payment plan actually has VAT (vat_amount > 0). */
function paymentHasIsraeliVat(paymentLink) {
  if (!isIsraeliIlsPayment(paymentLink)) return false;
  return (Number(paymentLink.vat_amount) || 0) > 0;
}

/**
 * income_id 599 applies VAT at document level when document_no_vat is false — even if
 * include_vat is "false" on the line (invoice total becomes price × 1.18 ≠ receipt).
 * No-VAT payments must send document_no_vat: true.
 */
function resolveDocumentNoVat(paymentLink, config) {
  if (config.documentNoVat) return true;
  return !paymentHasIsraeliVat(paymentLink);
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

function crmGrossAgorot(paymentLink) {
  const netIls = Number(paymentLink.amount) || 0;
  const vatIls = Number(paymentLink.vat_amount) || 0;
  if (vatIls > 0 && netIls > 0) return Math.round((netIls + vatIls) * 100);
  const totalIls = Number(paymentLink.total_amount);
  if (Number.isFinite(totalIls) && totalIls > 0) return Math.round(totalIls * 100);
  return null;
}

/** Pelecard charges whole shekels for ILS (Math.round); CRM may keep agorot (e.g. 35.4 vs 35). */
function chargeMatchesCrmGross(paymentLink, grossAgorot) {
  const crmGross = crmGrossAgorot(paymentLink);
  if (crmGross == null || grossAgorot == null) return true;
  return Math.abs(crmGross - grossAgorot) <= 2;
}

function resolveNetAgorotForPayper(paymentLink, grossAgorot) {
  const vatRate = getVatRateForPayment(paymentLink);
  const crmNetAgorot = Math.round(Number(paymentLink.amount) * 100);
  const crmGross = crmGrossAgorot(paymentLink);
  if (
    crmNetAgorot > 0 &&
    crmGross != null &&
    Math.abs(crmGross - grossAgorot) <= 2 &&
    crmNetAgorot + Math.round(crmNetAgorot * vatRate) === grossAgorot
  ) {
    return crmNetAgorot;
  }
  return findNetAgorotForGross(grossAgorot, vatRate);
}

function buildChargedNetExclusiveLineAmounts(paymentLink, grossAgorot, grossAmount, vatLineMode) {
  const netAgorot = resolveNetAgorotForPayper(paymentLink, grossAgorot);
  return buildLineAmounts(grossAgorot, grossAmount, {
    invoiceUnitPrice: formatIlsFromAgorot(netAgorot),
    receiptAmount: grossAmount,
    includeVat: false,
    documentNoVat: false,
    vatLineMode,
  });
}

function buildLineAmounts(grossAgorot, grossAmount, overrides = {}) {
  return {
    invoiceUnitPrice: grossAmount,
    receiptAmount: grossAmount,
    includeVat: true,
    documentNoVat: false,
    omitReceiptLines: false,
    minimalReceiptLines: false,
    pelecardTotalAgorot: grossAgorot,
    ...overrides,
  };
}

function estimateInvoiceTotalAgorot(unitPriceStr, lineAmounts, vatRate) {
  const unitAgorot = Math.round(Number.parseFloat(unitPriceStr) * 100);
  if (!Number.isFinite(unitAgorot) || unitAgorot <= 0) return null;
  if (lineAmounts.documentNoVat || !lineAmounts.includeVat) {
    if (!lineAmounts.includeVat && !lineAmounts.documentNoVat) {
      return unitAgorot + Math.round(unitAgorot * vatRate);
    }
    return unitAgorot;
  }

  const receiptAgorot = lineAmounts.pelecardTotalAgorot;
  if (receiptAgorot != null && unitAgorot < receiptAgorot - 2) {
    const withVat = unitAgorot + Math.round(unitAgorot * vatRate);
    if (Math.abs(withVat - receiptAgorot) <= 2) return withVat;
  }
  return unitAgorot;
}

/**
 * No-VAT: document_no_vat true + include_vat false + minimal receipt (isolate Payper totals).
 * VAT: net invoice line + include_vat true when Payper adds VAT to net (receipt = gross charge).
 * Fallbacks try gross/inclusive (Pelecard demo) and trx-only (no duplicate receipt_lines).
 */
function resolvePayperLineAmounts(paymentLink, callbackData, verifyPayload, config) {
  const grossAgorot = resolveChargedAgorot(paymentLink, callbackData, verifyPayload);
  const grossAmount =
    grossAgorot != null
      ? formatIlsFromAgorot(grossAgorot)
      : formatIlsAmount(chargeAmountFromPayment(paymentLink));

  if (!isIsraeliIlsPayment(paymentLink)) {
    return buildLineAmounts(grossAgorot, grossAmount, {
      includeVat: false,
      documentNoVat: true,
      vatLineMode: 'foreign_gross_no_vat',
    });
  }

  if (!paymentHasIsraeliVat(paymentLink)) {
    return buildLineAmounts(grossAgorot, grossAmount, {
      documentNoVat: true,
      includeVat: false,
      minimalReceiptLines: true,
      vatLineMode: 'no_vat_minimal',
    });
  }

  if (!chargeMatchesCrmGross(paymentLink, grossAgorot)) {
    return buildChargedNetExclusiveLineAmounts(
      paymentLink,
      grossAgorot,
      grossAmount,
      'rounded_charge_net_exclusive',
    );
  }

  const netAgorot = resolveNetAgorotForPayper(paymentLink, grossAgorot);
  return buildLineAmounts(grossAgorot, grossAmount, {
    invoiceUnitPrice: formatIlsFromAgorot(netAgorot),
    receiptAmount: grossAmount,
    vatLineMode: 'vat_net_inclusive_add',
  });
}

function buildTrxOnlyFallback(primary, grossAgorot, grossAmount) {
  return {
    ...primary,
    omitReceiptLines: true,
    pelecardTotalAgorot: grossAgorot,
    invoiceUnitPrice: primary.invoiceUnitPrice ?? grossAmount,
    receiptAmount: primary.receiptAmount ?? grossAmount,
    vatLineMode: 'trx_only_doc_sample',
  };
}

function buildFallbackLineAmounts(paymentLink, grossAgorot, primary) {
  if (grossAgorot == null) return [];

  const grossAmount = formatIlsFromAgorot(grossAgorot);
  const noVat = !paymentHasIsraeliVat(paymentLink);
  const strategies = [];

  if (noVat) {
    if (primary.vatLineMode !== 'trx_only_no_vat') {
      strategies.push(
        buildLineAmounts(grossAgorot, grossAmount, {
          documentNoVat: true,
          includeVat: false,
          omitReceiptLines: true,
          vatLineMode: 'trx_only_no_vat',
        }),
      );
    }
    if (primary.vatLineMode !== 'no_vat_full_receipt') {
      strategies.push(
        buildLineAmounts(grossAgorot, grossAmount, {
          documentNoVat: true,
          includeVat: false,
          minimalReceiptLines: false,
          vatLineMode: 'no_vat_full_receipt',
        }),
      );
    }
  } else {
    const netAgorot = resolveNetAgorotForPayper(paymentLink, grossAgorot);
    if (primary.vatLineMode !== 'pelecard_doc_sample') {
      strategies.push(
        buildLineAmounts(grossAgorot, grossAmount, {
          vatLineMode: 'pelecard_doc_sample',
        }),
      );
    }
    if (primary.vatLineMode !== 'trx_only_doc_sample') {
      strategies.push(buildTrxOnlyFallback(primary, grossAgorot, grossAmount));
    }
    if (primary.vatLineMode !== 'rounded_charge_net_exclusive') {
      strategies.push(
        buildChargedNetExclusiveLineAmounts(
          paymentLink,
          grossAgorot,
          grossAmount,
          'rounded_charge_net_exclusive',
        ),
      );
    }
    if (primary.vatLineMode !== 'vat_net_inclusive_add') {
      strategies.push(
        buildLineAmounts(grossAgorot, grossAmount, {
          invoiceUnitPrice: formatIlsFromAgorot(netAgorot),
          receiptAmount: grossAmount,
          vatLineMode: 'vat_net_inclusive_add',
        }),
      );
    }
    if (primary.vatLineMode !== 'charged_net_inclusive_add') {
      strategies.push(
        buildLineAmounts(grossAgorot, grossAmount, {
          invoiceUnitPrice: formatIlsFromAgorot(netAgorot),
          receiptAmount: grossAmount,
          vatLineMode: 'charged_net_inclusive_add',
        }),
      );
    }
  }

  const lineKey = (item) =>
    `${item.invoiceUnitPrice}|${item.receiptAmount}|${item.includeVat}|${item.documentNoVat}|${item.omitReceiptLines}|${item.minimalReceiptLines}`;
  const seen = new Set([lineKey(primary)]);
  return strategies.filter((item) => {
    const key = lineKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseShekelAmountToAgorot(amountStr) {
  const n = Number.parseFloat(String(amountStr).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** Validate invoice/receipt totals before calling Payper. */
function validateInvoiceReceiptPayload(payload, lineAmounts, paymentLink) {
  if (payload.PayperParameters?.typeDocument !== 'Invoice-Receipt') return;

  if (!payload.trxRecordId) {
    const err = new Error('Invoice-Receipt requires trxRecordId');
    err.code = 'PAYPER_MISSING_TRX';
    throw err;
  }

  const dataPayper = payload.PayperParameters.DataPayper;
  const includeVatStr = dataPayper?.invoice_lines?.[0]?.include_vat;
  if (dataPayper?.document_no_vat && includeVatStr === 'true') {
    const err = new Error('Invalid Payper payload: document_no_vat=true but include_vat=true');
    err.code = 'PAYPER_INVALID_VAT_FLAGS';
    throw err;
  }

  if (lineAmounts.omitReceiptLines) {
    return;
  }
  const receiptLines = dataPayper?.receipt_lines;
  if (!Array.isArray(receiptLines) || receiptLines.length === 0) {
    const err = new Error('Invoice-Receipt requires receipt_lines');
    err.code = 'PAYPER_MISSING_RECEIPT_LINES';
    throw err;
  }

  const receiptAgorot = parseShekelAmountToAgorot(receiptLines[0]?.amount);
  if (receiptAgorot == null || receiptAgorot <= 0) {
    const err = new Error('Invoice-Receipt receipt_lines[0].amount is missing or invalid');
    err.code = 'PAYPER_INVALID_RECEIPT_AMOUNT';
    throw err;
  }

  const invoicePriceStr = dataPayper?.invoice_lines?.[0]?.price_per_unit;
  const catalogId = dataPayper?.invoice_lines?.[0]?.catalog_id;
  if (catalogId === 'null') {
    const err = new Error('Invalid Payper payload: catalog_id is string "null". Omit it or use real null.');
    err.code = 'PAYPER_INVALID_CATALOG_ID';
    throw err;
  }

  const vatRate = getVatRateForPayment(paymentLink);
  const invoiceTotalAgorot = estimateInvoiceTotalAgorot(invoicePriceStr, lineAmounts, vatRate);

  if (invoiceTotalAgorot != null && invoiceTotalAgorot !== receiptAgorot) {
    const err = new Error(
      `Invoice total ${invoiceTotalAgorot} agorot does not equal receipt ${receiptAgorot} agorot`,
    );
    err.code = 'PAYPER_LOCAL_AMOUNT_MISMATCH';
    err.invoiceTotalAgorot = invoiceTotalAgorot;
    err.receiptAgorot = receiptAgorot;
    throw err;
  }
}

function payperErrorText(data) {
  return [data?.ErrorMessage, data?.PayperData?.InvoiceStatus, data?.error]
    .filter(Boolean)
    .join(' ');
}

function isPayperTotalMismatchError(data) {
  const message = payperErrorText(data);
  const lower = message.toLowerCase();
  return (
    (lower.includes('total') && lower.includes('receipt')) ||
    message.includes('חוסר התאמה') ||
    message.includes('סכום התקבולים') ||
    message.includes('סכום התשלומים') ||
    lower.includes('not equal to receipt')
  );
}

function buildReceiptLines(
  paymentLink,
  callbackData,
  verifyPayload,
  paidAt,
  receiptAmount,
  { minimal = false } = {},
) {
  const amount =
    receiptAmount ?? formatIlsAmount(chargeAmountFromPayment(paymentLink));

  if (minimal) {
    return [
      {
        payment_type: 'Cc',
        amount,
        cc_num: extractCardLastFour(callbackData, verifyPayload),
        num_of_payments: extractNumOfPayments(callbackData, verifyPayload),
        currency_symbol: 'ILS',
      },
    ];
  }

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

function sumInvoiceLinesShekels(invoiceLines) {
  if (!Array.isArray(invoiceLines)) return 0;
  return invoiceLines.reduce((sum, line) => {
    const price = Number.parseFloat(line?.price_per_unit);
    const qty = Number.parseFloat(line?.quantity || '1');
    if (!Number.isFinite(price) || !Number.isFinite(qty)) return sum;
    return sum + price * qty;
  }, 0);
}

function sumReceiptLinesShekels(receiptLines) {
  if (!Array.isArray(receiptLines)) return 0;
  return receiptLines.reduce((sum, line) => {
    const amount = Number.parseFloat(line?.amount);
    if (!Number.isFinite(amount)) return sum;
    return sum + amount;
  }, 0);
}

function logPayperAttemptResult(paymentLinkId, lineAmounts, payload, data, phase) {
  const dataPayper = payload.PayperParameters?.DataPayper;
  console.info(`[Payper] Attempt ${phase}`, {
    paymentLinkId,
    vatLineMode: lineAmounts.vatLineMode ?? null,
    success: isPayperSuccess(data),
    statusCode: data?.StatusCode ?? null,
    documentNoVat: dataPayper?.document_no_vat ?? null,
    includeVat: dataPayper?.invoice_lines?.[0]?.include_vat ?? null,
    omitReceiptLines: lineAmounts.omitReceiptLines ?? false,
    incomeId: dataPayper?.income_id ?? null,
    error: data?.ErrorMessage ?? data?.PayperData?.InvoiceStatus ?? null,
  });
}

function logPayperTotalsBeforeSend(payload, lineAmounts, paymentLinkId) {
  const dataPayper = payload.PayperParameters?.DataPayper;
  const invoiceLines = dataPayper?.invoice_lines ?? [];
  const receiptLines = dataPayper?.receipt_lines ?? [];
  const documentNoVat = dataPayper?.document_no_vat ?? null;
  const includeVat = invoiceLines[0]?.include_vat ?? null;
  const invoiceUnit = Number(invoiceLines[0]?.price_per_unit);
  const qty = Number(invoiceLines[0]?.quantity || 1);
  const receiptAmount = Number(receiptLines[0]?.amount);
  const invoiceRawTotal = Number.isFinite(invoiceUnit) ? invoiceUnit * qty : null;

  console.info('[Payper] Totals before send', {
    paymentLinkId,
    vatLineMode: lineAmounts.vatLineMode ?? null,
    documentNoVat,
    includeVat,
    omitReceiptLines: lineAmounts.omitReceiptLines ?? false,
    minimalReceiptLines: lineAmounts.minimalReceiptLines ?? false,
    invoiceRawTotal,
    receiptAmount: Number.isFinite(receiptAmount) ? receiptAmount : null,
    difference:
      invoiceRawTotal != null && Number.isFinite(receiptAmount)
        ? invoiceRawTotal - receiptAmount
        : null,
    invoiceLinesTotal: sumInvoiceLinesShekels(invoiceLines),
    receiptLinesTotal: sumReceiptLinesShekels(receiptLines),
    invoiceLines,
    receiptLines,
  });
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
  const lineAmounts =
    lineAmountsOverride ??
    resolvePayperLineAmounts(paymentLink, callbackData, enrichedVerify, config);

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
  const description = buildInvoiceDescription(paymentLink);

  const documentNoVat =
    lineAmounts.documentNoVat ?? resolveDocumentNoVat(paymentLink, config);

  let includeVatFlag = lineAmounts.includeVat;
  if (documentNoVat && !paymentHasIsraeliVat(paymentLink)) {
    includeVatFlag = false;
  }

  const dataPayper = {
    customer_unique_id: customerUniqueId,
    customer_mail: customerEmail,
    customer_name: customerName,
    discount_with_vat: '0',
    customer_mobile: customerMobile,
    document_no_vat: documentNoVat,
    document_rounded: config.documentRounded,
    send_by_mail: config.sendByMail,
    income_id: config.incomeId,
    invoice_lines: [
      {
        description,
        quantity: '1',
        price_per_unit: lineAmounts.invoiceUnitPrice,
        include_vat: includeVatFlag ? 'true' : 'false',
        currency_symbol: 'ILS',
      },
    ],
  };

  if (!lineAmounts.omitReceiptLines) {
    dataPayper.receipt_lines = buildReceiptLines(
      paymentLink,
      callbackData,
      enrichedVerify,
      paymentLink.paid_at,
      lineAmounts.receiptAmount,
      { minimal: lineAmounts.minimalReceiptLines },
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

  validateInvoiceReceiptPayload(payload, { ...lineAmounts, includeVat: includeVatFlag }, paymentLink);

  return {
    payload,
    config,
    enrichedVerify,
    lineAmounts: { ...lineAmounts, includeVat: includeVatFlag, documentNoVat },
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
    if (config.profile === 'sandbox' && config.incomeId === PAYPER_SAMPLE_INCOME_ID) {
      console.warn(
        '[Payper] Sandbox uses demo income_id -100000000; use PAYPER_INCOME_ID=599 from your Payper הכנסות and remove PAYPER_SANDBOX_INCOME_ID',
      );
    }
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

    let attempt = await buildPayperInvoiceAttempt(paymentLink, callbackData, verifyPayload);
    let { payload, lineAmounts, enrichedVerify } = attempt;
    logPayperTotalsBeforeSend(payload, lineAmounts, paymentLink.id);
    let { ok, status: httpStatus, data, invoicePath } = await postCreatePayperInvoice(payload, config);
    logPayperAttemptResult(paymentLink.id, lineAmounts, payload, data, 'primary');

    if ((!ok || !isPayperSuccess(data)) && isPayperTotalMismatchError(data)) {
      const fallbacks = buildFallbackLineAmounts(
        paymentLink,
        lineAmounts.pelecardTotalAgorot,
        lineAmounts,
      );
      for (const fallbackAmounts of fallbacks) {
        console.info('[Payper] Total mismatch — trying alternate line amounts', {
          paymentLinkId: paymentLink.id,
          from: lineAmounts.vatLineMode,
          to: fallbackAmounts.vatLineMode,
          invoiceUnitPrice: fallbackAmounts.invoiceUnitPrice,
          receiptAmount: fallbackAmounts.receiptAmount,
          includeVat: fallbackAmounts.includeVat,
          documentNoVat: fallbackAmounts.documentNoVat,
          omitReceiptLines: fallbackAmounts.omitReceiptLines,
          minimalReceiptLines: fallbackAmounts.minimalReceiptLines,
        });
        try {
          attempt = await buildPayperInvoiceAttempt(
            paymentLink,
            callbackData,
            enrichedVerify,
            fallbackAmounts,
          );
        } catch (buildErr) {
          if (
            buildErr.code === 'PAYPER_LOCAL_AMOUNT_MISMATCH' ||
            buildErr.code === 'PAYPER_MISSING_RECEIPT_LINES' ||
            buildErr.code === 'PAYPER_INVALID_RECEIPT_AMOUNT' ||
            buildErr.code === 'PAYPER_INVALID_VAT_FLAGS' ||
            buildErr.code === 'PAYPER_INVALID_CATALOG_ID'
          ) {
            console.warn('[Payper] Skipping invalid fallback payload', {
              paymentLinkId: paymentLink.id,
              vatLineMode: fallbackAmounts.vatLineMode,
              message: buildErr.message,
            });
            continue;
          }
          throw buildErr;
        }
        payload = attempt.payload;
        lineAmounts = attempt.lineAmounts;
        logPayperTotalsBeforeSend(payload, lineAmounts, paymentLink.id);
        ({ ok, status: httpStatus, data, invoicePath } = await postCreatePayperInvoice(
          payload,
          config,
        ));
        logPayperAttemptResult(
          paymentLink.id,
          lineAmounts,
          payload,
          data,
          `fallback:${fallbackAmounts.vatLineMode}`,
        );
        if (ok && isPayperSuccess(data)) break;
        if (!isPayperTotalMismatchError(data)) break;
      }
    }

    if (!ok || !isPayperSuccess(data)) {
      const vatRate = getVatRateForPayment(paymentLink);
      const invoiceTotalAgorot = estimateInvoiceTotalAgorot(
        payload.PayperParameters?.DataPayper?.invoice_lines?.[0]?.price_per_unit,
        lineAmounts,
        vatRate,
      );
      const receiptAgorot =
        parseShekelAmountToAgorot(
          payload.PayperParameters?.DataPayper?.receipt_lines?.[0]?.amount,
        ) ?? lineAmounts.pelecardTotalAgorot;
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
        crmGrossAgorot: crmGrossAgorot(paymentLink),
        chargeMatchesCrm: chargeMatchesCrmGross(paymentLink, lineAmounts.pelecardTotalAgorot),
        crmAmounts: {
          amount: paymentLink.amount ?? null,
          vat_amount: paymentLink.vat_amount ?? null,
          total_amount: paymentLink.total_amount ?? null,
        },
        vatLineMode: lineAmounts.vatLineMode ?? null,
        omitReceiptLines: lineAmounts.omitReceiptLines ?? false,
        minimalReceiptLines: lineAmounts.minimalReceiptLines ?? false,
        invoiceTotalAgorot,
        receiptAgorot,
        pelecardTotalDebug: summarizePelecardTotalDebug(callbackData, enrichedVerify),
        requestPayload: {
          trxRecordId: payload.trxRecordId,
          typeDocument: payload.PayperParameters?.typeDocument,
          incomeId: payload.PayperParameters?.DataPayper?.income_id,
          documentNoVat: payload.PayperParameters?.DataPayper?.document_no_vat ?? null,
          omitReceiptLines: lineAmounts.omitReceiptLines ?? false,
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
