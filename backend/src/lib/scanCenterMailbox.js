const SCAN_CENTER_EMAIL = String(process.env.SCAN_CENTER_EMAIL || 'scancenter@lawoffice.org.il')
  .trim()
  .toLowerCase();

const SCAN_CENTER_ALIASES = [
  ...new Set(
    [SCAN_CENTER_EMAIL, 'scan@lawoffice.org.il', 'scancenter@lawdecker.onmicrosoft.com']
      .concat(
        String(process.env.SCAN_CENTER_EMAIL_ALIASES || '')
          .split(',')
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean)
      )
  ),
];

const SCAN_CENTER_DELEGATE_EMAILS = [
  ...new Set(
    String(process.env.SCAN_CENTER_DELEGATE_EMAILS || 'eliran@lawoffice.org.il,irinab@lawoffice.org.il')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  ),
];

const SCAN_CENTER_SCANNER_NAME = 'Scan Center';
const SCAN_CENTER_CLIENT_STATE_PREFIX = 'scan-center:';

function normaliseEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isScanCenterAddress(email) {
  return SCAN_CENTER_ALIASES.includes(normaliseEmail(email));
}

function isScanCenterMailbox(mailboxAddress) {
  return isScanCenterAddress(mailboxAddress);
}

function scanCenterClientState(userId) {
  const id = String(userId || '').trim();
  return id ? `${SCAN_CENTER_CLIENT_STATE_PREFIX}${id}` : '';
}

function parseScanCenterClientState(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith(SCAN_CENTER_CLIENT_STATE_PREFIX)) return null;
  const id = raw.slice(SCAN_CENTER_CLIENT_STATE_PREFIX.length).trim();
  return id || null;
}

function isScanCenterGraphResource(resource) {
  const raw = decodeURIComponent(String(resource || '')).toLowerCase();
  if (!raw) return false;
  return SCAN_CENTER_ALIASES.some((addr) => addr && raw.includes(addr));
}

function involvesScanCenter({ senderEmail, recipientList, mailboxAddress } = {}) {
  if (isScanCenterMailbox(mailboxAddress)) return true;
  if (isScanCenterAddress(senderEmail)) return true;
  const list = String(recipientList || '').toLowerCase();
  return SCAN_CENTER_ALIASES.some((addr) => addr && list.includes(addr));
}

function ensureScanCenterRecipient(recipientList, mailboxAddress) {
  const marker = isScanCenterAddress(mailboxAddress) ? normaliseEmail(mailboxAddress) : SCAN_CENTER_EMAIL;
  const current = String(recipientList || '').trim();
  if (current.toLowerCase().includes(marker)) return current;
  return current ? `${current}, ${marker}` : marker;
}

function isHiddenScanAttachment(row = {}) {
  if (row.is_inline || row.isInline) return true;
  const name = String(row.name || '').trim();
  if (!name) return true;
  if (/^signature/i.test(name)) return true;
  if (/^image00\d+\.(png|jpe?g|gif|bmp)$/i.test(name)) return true;
  if (/^oledata\.mso$/i.test(name)) return true;
  return false;
}

function isScanDocumentAttachment(row = {}) {
  if (isHiddenScanAttachment(row)) return false;
  const name = String(row.name || '').toLowerCase();
  const type = String(row.content_type || row.contentType || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  if (type.includes('pdf') || type.includes('tiff')) return true;
  if (/\.(pdf|png|jpe?g|tif{1,2}|heic|webp)$/i.test(name)) return true;
  return false;
}

module.exports = {
  SCAN_CENTER_EMAIL,
  SCAN_CENTER_ALIASES,
  SCAN_CENTER_DELEGATE_EMAILS,
  SCAN_CENTER_SCANNER_NAME,
  SCAN_CENTER_CLIENT_STATE_PREFIX,
  normaliseEmail,
  isScanCenterMailbox,
  isScanCenterAddress,
  scanCenterClientState,
  parseScanCenterClientState,
  isScanCenterGraphResource,
  involvesScanCenter,
  ensureScanCenterRecipient,
  isHiddenScanAttachment,
  isScanDocumentAttachment,
};
