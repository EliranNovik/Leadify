/**
 * Payper refund documents (Credit + Receipt) for Invoice-Receipt businesses.
 * Phase 2 — call after a Pelecard refund is processed.
 *
 * Flow per Pelecard docs:
 * 1. Credit — includes trxRecordId + reference_document_id (original invoice document_system_id)
 * 2. Receipt — must NOT include trxRecordId; reference_document_id = Credit document_system_id
 */
const pelecardService = require('./pelecardService');
const { profileFromPayment } = require('../lib/pelecardProfiles');
const { parsePayperDocumentSystemId } = require('../lib/pelecardTransactionFields');
const {
  resolveClientName,
  resolveRecipientEmail,
  resolveRecipientPhone,
} = require('../lib/paymentLinkContact');

const DEFAULT_PAYPER_PATH = 'PaymentGW/CreatePayperInvoice';

function getRefundConfig(paymentLink) {
  const config = pelecardService.getConfig(profileFromPayment(paymentLink));
  return {
    ...config,
    invoicePath: (process.env.PELECARD_PAYPER_INVOICE_PATH || DEFAULT_PAYPER_PATH).trim(),
    incomeId: Number(process.env.PAYPER_INCOME_ID || '-100000000'),
    includeVat: (process.env.PAYPER_INCLUDE_VAT || 'true').trim().toLowerCase() !== 'false',
  };
}

function formatIlsAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return '0';
  return String(Math.round(n * 100) / 100);
}

async function postPayperDocument(payload, paymentLink) {
  const config = getRefundConfig(paymentLink);
  pelecardService.assertCredentials(config);
  const { ok, data } = await pelecardService.pelecardPost(config.invoicePath, payload, config);
  const success =
    ok &&
    String(data?.StatusCode ?? '').trim() === '000' &&
    String(data?.PayperData?.InvoiceStatus ?? '').toLowerCase() === 'success';
  return { ok: success, data, config };
}

/**
 * Create Credit document linked to original Invoice-Receipt.
 */
async function createPayperCreditDocument(paymentLink, options = {}) {
  const config = getRefundConfig(paymentLink);
  const referenceDocumentId =
    options.referenceDocumentId ?? paymentLink.payper_document_system_id ?? null;
  const trxRecordId =
    options.trxRecordId ?? paymentLink.pelecard_transaction_id ?? null;
  const amount = formatIlsAmount(options.amount ?? paymentLink.pelecard_raw_response?.pelecardCharge?.chargeTotalNis ?? paymentLink.total_amount);
  const description = options.description || paymentLink.description || 'Refund';

  if (!referenceDocumentId) {
    throw new Error('Missing reference_document_id (original Payper document_system_id)');
  }
  if (!trxRecordId) {
    throw new Error('Missing trxRecordId for Payper Credit document');
  }

  const customerEmail = await resolveRecipientEmail(paymentLink);
  if (!customerEmail) throw new Error('Missing customer email for Payper Credit');

  const payload = {
    terminalNumber: config.terminal,
    user: config.user,
    password: config.password,
    trxRecordId: String(trxRecordId),
    PayperParameters: {
      typeDocument: 'Credit',
      DataPayper: {
        customer_unique_id: paymentLink.pelecard_customer_id || '000000000',
        customer_mail: customerEmail,
        customer_name: await resolveClientName(paymentLink),
        document_remarks: options.remarks || '',
        reference_document_id: String(referenceDocumentId),
        invoice_lines: [
          {
            description: description.slice(0, 500),
            quantity: '1',
            price_per_unit: amount,
            include_vat: config.includeVat ? 'true' : 'false',
            catalog_id: 'null',
          },
        ],
      },
    },
  };

  const result = await postPayperDocument(payload, paymentLink);
  if (!result.ok) {
    const err = new Error(result.data?.ErrorMessage || 'Payper Credit document failed');
    err.code = 'PAYPER_CREDIT_FAILED';
    err.payperResponse = result.data;
    throw err;
  }

  return {
    documentSystemId: parsePayperDocumentSystemId(result.data?.PayperData),
    invoiceLink: result.data?.PayperData?.InvoiceLink || null,
    invoiceNumber: result.data?.PayperData?.InvoiceNumber || null,
    raw: result.data,
  };
}

/**
 * Create Receipt document after Credit (no trxRecordId).
 */
async function createPayperReceiptDocument(paymentLink, options = {}) {
  const config = getRefundConfig(paymentLink);
  const referenceDocumentId = options.referenceDocumentId;
  const amount = formatIlsAmount(options.amount ?? paymentLink.pelecard_raw_response?.pelecardCharge?.chargeTotalNis ?? paymentLink.total_amount);
  const description = options.description || paymentLink.description || 'Refund receipt';

  if (!referenceDocumentId) {
    throw new Error('Missing reference_document_id (Credit document_system_id)');
  }

  const customerEmail = await resolveRecipientEmail(paymentLink);
  if (!customerEmail) throw new Error('Missing customer email for Payper Receipt');

  const receiptLines = options.receiptLines;
  if (!receiptLines?.length) {
    throw new Error('receipt_lines required for Payper Receipt document');
  }

  const payload = {
    terminalNumber: config.terminal,
    user: config.user,
    password: config.password,
    PayperParameters: {
      typeDocument: 'Receipt',
      DataPayper: {
        customer_unique_id: paymentLink.pelecard_customer_id || '000000000',
        customer_mail: customerEmail,
        customer_name: await resolveClientName(paymentLink),
        customer_mobile: (await resolveRecipientPhone(paymentLink)) || '',
        document_remarks: options.remarks || '',
        reference_document_id: String(referenceDocumentId),
        invoice_lines: [
          {
            description: description.slice(0, 500),
            quantity: '1',
            price_per_unit: amount,
            include_vat: config.includeVat ? 'true' : 'false',
            catalog_id: 'null',
          },
        ],
        receipt_lines: receiptLines,
      },
    },
  };

  const result = await postPayperDocument(payload, paymentLink);
  if (!result.ok) {
    const err = new Error(result.data?.ErrorMessage || 'Payper Receipt document failed');
    err.code = 'PAYPER_RECEIPT_FAILED';
    err.payperResponse = result.data;
    throw err;
  }

  return {
    documentSystemId: parsePayperDocumentSystemId(result.data?.PayperData),
    invoiceLink: result.data?.PayperData?.InvoiceLink || null,
    invoiceNumber: result.data?.PayperData?.InvoiceNumber || null,
    raw: result.data,
  };
}

/**
 * Full refund document chain: Credit then Receipt.
 */
async function createPayperRefundDocuments(paymentLink, options = {}) {
  const credit = await createPayperCreditDocument(paymentLink, options);
  const receipt = await createPayperReceiptDocument(paymentLink, {
    ...options,
    referenceDocumentId: credit.documentSystemId,
    receiptLines: options.receiptLines,
  });
  return { credit, receipt };
}

module.exports = {
  createPayperCreditDocument,
  createPayperReceiptDocument,
  createPayperRefundDocuments,
};
