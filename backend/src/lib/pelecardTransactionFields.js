/**
 * Extract customer + card metadata from Pelecard callback / GetTransaction payloads
 * for Payper invoice-receipt receipt_lines.
 */

function pickFirst(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    const val = obj[key];
    if (val != null && String(val).trim() !== '') return String(val).trim();
  }
  return null;
}

function flattenPelecardSources(callbackData, verifyPayload) {
  const sources = [];
  if (callbackData && typeof callbackData === 'object') sources.push(callbackData);
  const pelecard = verifyPayload?.pelecard;
  if (pelecard && typeof pelecard === 'object') {
    sources.push(pelecard);
    const resultData = pelecard.ResultData || pelecard.resultData;
    if (resultData && typeof resultData === 'object') sources.push(resultData);
  }
  const resultData = verifyPayload?.resultData;
  if (resultData && typeof resultData === 'object') sources.push(resultData);
  return sources;
}

function extractPelecardCustomerId(callbackData, verifyPayload) {
  const keys = [
    'CustomerId',
    'customerId',
    'MyId',
    'myId',
    'IdNumber',
    'idNumber',
    'CardHolderID',
    'cardHolderID',
    'TZ',
    'tz',
  ];
  for (const src of flattenPelecardSources(callbackData, verifyPayload)) {
    const val = pickFirst(src, keys);
    if (val) return val.replace(/\D/g, '').slice(0, 20) || val;
  }
  return null;
}

function extractCardLastFour(callbackData, verifyPayload) {
  const keys = [
    'CreditCardNumber',
    'creditCardNumber',
    'CardNumber',
    'cardNumber',
    'Last4',
    'last4',
    'CreditCard4Digits',
    'creditCard4Digits',
  ];
  for (const src of flattenPelecardSources(callbackData, verifyPayload)) {
    const raw = pickFirst(src, keys);
    if (!raw) continue;
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 4) return digits.slice(-4);
    if (digits.length > 0) return digits.padStart(4, '0');
  }
  return '0000';
}

function extractCardValidity(callbackData, verifyPayload) {
  const keys = [
    'CreditCardExpDate',
    'creditCardExpDate',
    'ExpDate',
    'expDate',
    'CardExp',
    'cardExp',
    'CreditCardValidity',
    'creditCardValidity',
  ];
  for (const src of flattenPelecardSources(callbackData, verifyPayload)) {
    const raw = pickFirst(src, keys);
    if (!raw) continue;
    const m = raw.match(/(\d{1,2})\s*[\/\-]\s*(\d{2,4})/);
    if (m) {
      const month = m[1].padStart(2, '0');
      let year = m[2];
      if (year.length === 2) year = `20${year}`;
      return `${month}/${year}`;
    }
    const compact = raw.match(/^(\d{2})(\d{2,4})$/);
    if (compact) {
      const month = compact[1];
      let year = compact[2];
      if (year.length === 2) year = `20${year}`;
      return `${month}/${year}`;
    }
  }
  return null;
}

function parseMaybeJson(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function extractGetTransactionResultData(verifyPayload) {
  if (!verifyPayload || typeof verifyPayload !== 'object') return null;

  const candidates = [
    verifyPayload.resultData,
    verifyPayload.ResultData,
    verifyPayload.pelecard?.resultData,
    verifyPayload.pelecard?.ResultData,
  ];

  for (const candidate of candidates) {
    const parsed = parseMaybeJson(candidate) ?? candidate;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;

    const inner = parsed.ResultData || parsed.resultData;
    const innerParsed = parseMaybeJson(inner) ?? inner;
    if (innerParsed && typeof innerParsed === 'object' && !Array.isArray(innerParsed)) {
      return innerParsed;
    }
    return parsed;
  }

  return null;
}

function findTotalAgorotDeep(root, depth = 0) {
  if (!root || depth > 5) return null;
  const obj = parseMaybeJson(root) ?? root;
  if (!obj || typeof obj !== 'object') return null;

  const totalKeys = [
    'Total',
    'total',
    'DebitTotal',
    'debitTotal',
    'TransactionTotal',
    'transactionTotal',
    'CreditCardTotal',
    'creditCardTotal',
  ];
  const direct = pickFirst(obj, totalKeys);
  if (direct) {
    const agorot = Number(String(direct).replace(/[^\d]/g, ''));
    if (Number.isFinite(agorot) && agorot > 0) return Math.round(agorot);
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      const nested = findTotalAgorotDeep(value, depth + 1);
      if (nested != null) return nested;
    }
    if (typeof value === 'string' && (value.includes('Total') || value.includes('total'))) {
      const parsed = parseMaybeJson(value);
      if (parsed) {
        const nested = findTotalAgorotDeep(parsed, depth + 1);
        if (nested != null) return nested;
      }
    }
  }
  return null;
}

/** Pelecard Gateway Total is in agorot (885000 = ₪8850). Prefer GetTransaction ResultData. */
function extractTransactionTotalAgorot(callbackData, verifyPayload) {
  const resultData = extractGetTransactionResultData(verifyPayload);
  if (resultData) {
    const fromResult = findTotalAgorotDeep(resultData, 0);
    if (fromResult != null) return fromResult;
  }

  const roots = [
    verifyPayload?.pelecard,
    verifyPayload,
    callbackData,
  ].filter(Boolean);
  for (const root of roots) {
    const found = findTotalAgorotDeep(root, 0);
    if (found != null) return found;
  }
  return null;
}

function summarizePelecardTotalDebug(callbackData, verifyPayload) {
  const resultData = extractGetTransactionResultData(verifyPayload);
  if (!resultData) return { resultData: null };
  return {
    Total: resultData.Total ?? resultData.total ?? null,
    DebitTotal: resultData.DebitTotal ?? resultData.debitTotal ?? null,
    TransactionPelecardId:
      resultData.TransactionPelecardId ?? resultData.transactionPelecardId ?? null,
    PaymentsNumber: resultData.PaymentsNumber ?? resultData.paymentsNumber ?? null,
    callbackTotal: callbackData?.Total ?? callbackData?.total ?? null,
  };
}

/** Charged amount in ILS from Pelecard Total field (agorot → shekels). */
function extractTransactionTotalIls(callbackData, verifyPayload) {
  const agorot = extractTransactionTotalAgorot(callbackData, verifyPayload);
  if (agorot == null) return null;
  return Math.round(agorot) / 100;
}

/** Numeric Pelecard record id for Payper trxRecordId (TransactionPelecardId from GetTransaction). */
function extractTrxRecordId(callbackData, verifyPayload) {
  const keys = [
    'TransactionPelecardId',
    'transactionPelecardId',
    'TrxRecordId',
    'trxRecordId',
    'RecordId',
    'recordId',
  ];
  const resultData = extractGetTransactionResultData(verifyPayload);
  if (resultData) {
    const fromTx = pickFirst(resultData, keys);
    if (fromTx) {
      const digits = String(fromTx).replace(/\D/g, '');
      if (digits) return digits;
    }
  }
  for (const src of flattenPelecardSources(callbackData, verifyPayload)) {
    if (resultData && src === resultData) continue;
    const raw = pickFirst(src, keys);
    if (!raw) continue;
    const digits = String(raw).replace(/\D/g, '');
    if (digits) return digits;
  }
  return null;
}

function extractTransactionUuid(callbackData, verifyPayload, paymentLink) {
  const keys = ['PelecardTransactionId', 'pelecardTransactionId', 'TransactionId', 'transactionId'];
  for (const src of flattenPelecardSources(callbackData, verifyPayload)) {
    const val = pickFirst(src, keys);
    if (val) return val;
  }
  const stored = paymentLink?.pelecard_transaction_id;
  return stored ? String(stored).trim() : null;
}

/** Pelecard cc_type codes: 1 Visa, 2 MC, 3 Amex, 4 Diners, etc. */
function extractCardTypeCode(callbackData, verifyPayload) {
  const keys = [
    'CreditCardCompany',
    'creditCardCompany',
    'CreditCardBrand',
    'creditCardBrand',
    'CardType',
    'cardType',
    'CreditCardType',
    'creditCardType',
    'cc_type',
  ];
  for (const src of flattenPelecardSources(callbackData, verifyPayload)) {
    const raw = pickFirst(src, keys);
    if (!raw) continue;
    if (/^\d+$/.test(raw)) return raw;
    const lower = raw.toLowerCase();
    if (lower.includes('visa')) return '1';
    if (lower.includes('master') || lower.includes('mc')) return '2';
    if (lower.includes('amex') || lower.includes('american')) return '3';
    if (lower.includes('diners')) return '4';
    if (lower.includes('isra')) return '5';
  }
  return '1';
}

function extractNumOfPayments(callbackData, verifyPayload) {
  const keys = [
    'PaymentsNumber',
    'paymentsNumber',
    'NumberOfPayments',
    'numberOfPayments',
    'NumOfPayments',
    'numOfPayments',
    'TotalPayments',
    'totalPayments',
  ];
  for (const src of flattenPelecardSources(callbackData, verifyPayload)) {
    const raw = pickFirst(src, keys);
    if (raw && /^\d+$/.test(raw)) return raw;
  }
  return '1';
}

function extractCcPaymentType(callbackData, verifyPayload) {
  const num = extractNumOfPayments(callbackData, verifyPayload);
  return num !== '1' ? '2' : '1';
}

function formatPayperReceiptDate(paidAt) {
  const date = paidAt ? new Date(paidAt) : new Date();
  if (Number.isNaN(date.getTime())) return formatPayperReceiptDate(new Date().toISOString());
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(date);
  const day = parts.find((p) => p.type === 'day')?.value || '01';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const year = parts.find((p) => p.type === 'year')?.value || '2026';
  return `${day}-${month}-${year}`;
}

function parsePayperDocumentSystemId(payperData) {
  if (!payperData || typeof payperData !== 'object') return null;
  const direct = payperData.document_system_id ?? payperData.documentSystemId;
  if (direct != null && Number.isFinite(Number(direct))) return Number(direct);

  const raw = payperData.RawResponse || payperData.rawResponse;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.document_system_id != null && Number.isFinite(Number(parsed.document_system_id))) {
        return Number(parsed.document_system_id);
      }
    } catch {
      /* ignore */
    }
  }
  if (raw && typeof raw === 'object' && raw.document_system_id != null) {
    return Number(raw.document_system_id);
  }
  return null;
}

module.exports = {
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
  flattenPelecardSources,
};
