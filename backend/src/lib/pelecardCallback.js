const PENDING_OPEN_FINANCE_STATUSES = new Set([
  'INIT',
  'RCVD',
  'PATC',
  'PENDING',
  'PDNG',
]);

// Final successful statuses documented by the Open Finance provider.
// Masav may finish at ACTC/ACWC/ACSP; fast payments usually finish at ACSC.
const SUCCESSFUL_OPEN_FINANCE_STATUSES = new Set([
  'ACCC',
  'ACSC',
  'ACSP',
  'ACTC',
  'ACWC',
  'ACFC',
]);

function flattenCallbackSource(source, into = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return into;

  for (const [key, value] of Object.entries(source)) {
    if (value == null || key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    // When URL-encoded parsing turns the entire JSON payload into a field name,
    // do not retain that huge raw key; mergeCallbackData parses it separately.
    if (key.trim().startsWith('{') && parseJsonObject(key)) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      // Pelecard payloads vary between flat fields and nested ResultData /
      // OpenFinanceData objects. Flatten all plain nested objects so both forms work.
      flattenCallbackSource(value, into);
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      into[key] = value;
    }
  }

  return into;
}

function parseJsonObject(raw) {
  if (typeof raw !== 'string' || !raw.trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Pelecard sometimes labels a raw JSON POST as application/x-www-form-urlencoded.
 * Express then parses the complete JSON string as one field name with an empty value:
 *   { '{"StatusCode":"665",...}': '' }
 */
function mergeCallbackData(req = {}) {
  const merged = {};
  flattenCallbackSource(req.query || {}, merged);
  flattenCallbackSource(req.body || {}, merged);

  if (typeof req.body === 'string') {
    const parsedBody = parseJsonObject(req.body);
    if (parsedBody) flattenCallbackSource(parsedBody, merged);
  }

  // Standard wrappers used by gateways.
  for (const key of ['data', 'payload', 'json', 'ResultData']) {
    const raw = req.body?.[key];
    const parsed = parseJsonObject(raw);
    if (parsed) {
      flattenCallbackSource(parsed, merged);
    } else if (raw && typeof raw === 'object') {
      flattenCallbackSource(raw, merged);
    }
  }

  // Malformed content type case: the JSON itself became the URL-encoded field name.
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    for (const rawKey of Object.keys(req.body)) {
      const parsed = parseJsonObject(rawKey);
      if (parsed) flattenCallbackSource(parsed, merged);
    }
  }

  return merged;
}

function openFinanceStatus(data = {}) {
  return String(
    data.BankTransferStatus ||
      data.bankTransferStatus ||
      data.OpenFinanceStatus ||
      data.openFinanceStatus ||
      data.OpenFinanceData?.BankTransferStatus ||
      data.openFinanceData?.bankTransferStatus ||
      '',
  )
    .trim()
    .toUpperCase();
}

function isSuccessfulOpenFinanceStatus(data = {}) {
  return SUCCESSFUL_OPEN_FINANCE_STATUSES.has(openFinanceStatus(data));
}

function isPendingOpenFinanceCallback(data = {}) {
  const status = openFinanceStatus(data);
  if (PENDING_OPEN_FINANCE_STATUSES.has(status)) return true;

  const code = String(
    data.StatusCode || data.statusCode || data.ShvaResult || data.shvaResult || '',
  ).trim();
  const description = String(
    data.ErrorMessage || data.errorMessage || data.StatusDescription || '',
  ).trim();

  // Pelecard Open Finance uses 665 while the receiving bank is still processing.
  return code === '665' && (
    /^RCVD\b/i.test(description) ||
    /payment initiation has been received/i.test(description)
  );
}

module.exports = {
  flattenCallbackSource,
  mergeCallbackData,
  openFinanceStatus,
  isSuccessfulOpenFinanceStatus,
  isPendingOpenFinanceCallback,
};
