/**
 * Pelecard terminal profiles — production vs sandbox/test credentials.
 *
 * Production: PELECARD_TERMINAL, PELECARD_USER, PELECARD_PASSWORD
 * Sandbox:    PELECARD_SANDBOX_TERMINAL, PELECARD_SANDBOX_USER, PELECARD_SANDBOX_PASSWORD
 *
 * Sandbox profile is selected when create-payment-session is called from an Origin/Referer
 * listed in PELECARD_SANDBOX_FRONTEND_ORIGINS. The chosen profile is stored on payment_links
 * so Pelecard callbacks and GetTransaction use the same terminal.
 */

const VALID_PROFILES = new Set(['production', 'sandbox']);

/** Only this staging frontend uses the test terminal when sandbox credentials are set. */
const DEFAULT_SANDBOX_FRONTEND_ORIGINS = ['https://rainmakerqueen.onrender.com'];
const DEFAULT_SANDBOX_APP_PUBLIC_URL = 'https://rainmakerqueen.onrender.com';

function normalizeProfile(raw) {
  const value = String(raw || 'production').trim().toLowerCase();
  return VALID_PROFILES.has(value) ? value : 'production';
}

function normalizeOriginUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return null;
  }
}

function parseSandboxFrontendOrigins() {
  const raw = process.env.PELECARD_SANDBOX_FRONTEND_ORIGINS;
  const parts =
    raw != null && String(raw).trim() !== ''
      ? String(raw).split(',')
      : DEFAULT_SANDBOX_FRONTEND_ORIGINS;

  return [
    ...new Set(
      parts.map((part) => normalizeOriginUrl(part)).filter(Boolean),
    ),
  ];
}

function isSandboxProfileConfigured() {
  return Boolean(
    process.env.PELECARD_SANDBOX_TERMINAL &&
      process.env.PELECARD_SANDBOX_USER &&
      process.env.PELECARD_SANDBOX_PASSWORD,
  );
}

function getSharedUrls() {
  const baseUrl = (process.env.PELECARD_BASE_URL || 'https://gateway20.pelecard.biz').replace(/\/$/, '');
  const backendPublicUrl = (
    process.env.BACKEND_PUBLIC_URL ||
    process.env.API_PUBLIC_URL ||
    process.env.APP_PUBLIC_URL ||
    'http://localhost:5173'
  ).replace(/\/$/, '');
  return { baseUrl, backendPublicUrl };
}

/**
 * @param {'production'|'sandbox'} profile
 */
function getPelecardConfig(profile = 'production') {
  const normalized = normalizeProfile(profile);
  const { baseUrl, backendPublicUrl } = getSharedUrls();
  const defaultAppPublicUrl = (process.env.APP_PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '');

  if (normalized === 'sandbox') {
    const sandboxAppPublicUrl = (
      process.env.PELECARD_SANDBOX_APP_PUBLIC_URL || DEFAULT_SANDBOX_APP_PUBLIC_URL
    ).replace(/\/$/, '');

    return {
      profile: 'sandbox',
      baseUrl,
      terminal: process.env.PELECARD_SANDBOX_TERMINAL,
      user: process.env.PELECARD_SANDBOX_USER,
      password: process.env.PELECARD_SANDBOX_PASSWORD,
      appPublicUrl: sandboxAppPublicUrl,
      backendPublicUrl,
      // Sandbox test terminal — always auto-approve in QA when supported
      sandboxMode: true,
    };
  }

  return {
    profile: 'production',
    baseUrl,
    terminal: process.env.PELECARD_TERMINAL,
    user: process.env.PELECARD_USER,
    password: process.env.PELECARD_PASSWORD,
    appPublicUrl: defaultAppPublicUrl,
    backendPublicUrl,
    sandboxMode:
      process.env.PELECARD_SANDBOX === 'true' || process.env.PELECARD_ENV === 'sandbox',
  };
}

function profileFromPayment(payment) {
  return normalizeProfile(payment?.pelecard_profile);
}

function assertCredentials(config) {
  if (!config?.terminal || !config?.user || !config?.password) {
    const label = config?.profile === 'sandbox' ? 'sandbox' : 'production';
    const prefix = label === 'sandbox' ? 'PELECARD_SANDBOX_' : 'PELECARD_';
    const err = new Error(
      `Pelecard ${label} profile is not configured (missing ${prefix}TERMINAL, ${prefix}USER, or ${prefix}PASSWORD)`,
    );
    err.code = 'PELECARD_NOT_CONFIGURED';
    err.profile = label;
    throw err;
  }
}

function collectRequestOrigins(req) {
  const origins = [];
  const origin = normalizeOriginUrl(req?.headers?.origin);
  const referer = normalizeOriginUrl(req?.headers?.referer);
  if (origin) origins.push(origin);
  if (referer) origins.push(referer);
  return origins;
}

function originMatchesSandboxAllowlist(origins) {
  const allowlist = parseSandboxFrontendOrigins();
  if (!allowlist.length) return false;
  return origins.some((origin) => allowlist.includes(origin));
}

/**
 * Pick terminal profile for a new checkout session.
 * Sandbox is only used when sandbox credentials exist AND the browser Origin/Referer is allowlisted.
 */
function resolvePelecardProfileFromRequest(req) {
  if (!isSandboxProfileConfigured()) {
    return 'production';
  }

  const origins = collectRequestOrigins(req);
  if (originMatchesSandboxAllowlist(origins)) {
    return 'sandbox';
  }

  return 'production';
}

function getProfilesStatus() {
  const production = getPelecardConfig('production');
  const sandbox = getPelecardConfig('sandbox');
  return {
    production: {
      configured: Boolean(production.terminal && production.user && production.password),
      terminal: production.terminal || null,
      appPublicUrl: production.appPublicUrl,
      sandboxMode: production.sandboxMode,
    },
    sandbox: {
      configured: isSandboxProfileConfigured(),
      terminal: sandbox.terminal || null,
      appPublicUrl: sandbox.appPublicUrl,
      sandboxMode: sandbox.sandboxMode,
      frontendOrigins: parseSandboxFrontendOrigins(),
    },
  };
}

module.exports = {
  VALID_PROFILES,
  normalizeProfile,
  parseSandboxFrontendOrigins,
  isSandboxProfileConfigured,
  getPelecardConfig,
  profileFromPayment,
  assertCredentials,
  resolvePelecardProfileFromRequest,
  getProfilesStatus,
};
