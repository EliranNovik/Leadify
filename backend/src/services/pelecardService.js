/**
 * Pelecard Gateway 2.0 — IFrame/Redirect init + transaction validation.
 * Credentials only via environment variables (never expose to frontend).
 */

const PELECARD_INIT_PATH = 'PaymentGW/init';
const PELECARD_GET_TRANSACTION_PATH = 'PaymentGW/GetTransaction';
const { resolvePelecardChargeAmount } = require('./paymentChargeAmountService');

function getConfig() {
  const baseUrl = (process.env.PELECARD_BASE_URL || 'https://gateway20.pelecard.biz').replace(/\/$/, '');
  const terminal = process.env.PELECARD_TERMINAL;
  const user = process.env.PELECARD_USER;
  const password = process.env.PELECARD_PASSWORD;
  const appPublicUrl = (process.env.APP_PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '');
  const backendPublicUrl = (process.env.BACKEND_PUBLIC_URL || process.env.API_PUBLIC_URL || appPublicUrl).replace(/\/$/, '');
  const sandboxMode = process.env.PELECARD_SANDBOX === 'true' || process.env.PELECARD_ENV === 'sandbox';

  return { baseUrl, terminal, user, password, appPublicUrl, backendPublicUrl, sandboxMode };
}

function assertCredentials(config) {
  if (!config.terminal || !config.user || !config.password) {
    const err = new Error('Pelecard is not configured on the server (missing PELECARD_TERMINAL, PELECARD_USER, or PELECARD_PASSWORD)');
    err.code = 'PELECARD_NOT_CONFIGURED';
    throw err;
  }
}

function isLocalUrl(url) {
  return /localhost|127\.0\.0\.1/i.test(url || '');
}

function appendCssVersion(url, version) {
  if (!url) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${encodeURIComponent(version)}`;
}

const PELECARD_BUILTIN_VARIANTS = {
  en: [1, 4],
  he: [1, 2, 3, 4],
};

function normalizeCheckoutLanguage(raw) {
  const lang = (raw || 'en').trim().toLowerCase();
  if (lang.startsWith('he') || lang === 'iw') return 'he';
  return 'en';
}

function parsePelecardCssVariant(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > 4) {
    console.warn(`[Pelecard] PELECARD_CSS_VARIANT must be 1–4, got: ${JSON.stringify(raw)}`);
    return null;
  }
  return n;
}

/** Pelecard-hosted themes from the merchant portal “Select CSS” list — these work without external whitelist. */
function buildBuiltinPelecardCssUrl(baseUrl, language, variant) {
  const lang = normalizeCheckoutLanguage(language);
  const allowed = PELECARD_BUILTIN_VARIANTS[lang] || PELECARD_BUILTIN_VARIANTS.en;
  const v = allowed.includes(variant) ? variant : allowed[allowed.length - 1];
  if (v !== variant) {
    console.warn(
      `[Pelecard] variant-${lang}-${variant}.css is not available; using variant-${lang}-${v}.css`,
    );
  }
  const root = (baseUrl || 'https://gateway20.pelecard.biz').replace(/\/$/, '');
  return `${root}/Content/Css/variant-${lang}-${v}.css`;
}

function isExternalCustomCssUrl(cssUrl) {
  try {
    return !new URL(cssUrl).hostname.toLowerCase().includes('pelecard.biz');
  } catch {
    return true;
  }
}

/** rainmakerqueen.org does not serve /public static files; Render URL does. */
function cssBaseFromAppPublicUrl(appPublicUrl) {
  const base = (appPublicUrl || '').replace(/\/$/, '');
  if (!base) return base;
  try {
    const host = new URL(base).hostname.toLowerCase();
    if (host === 'rainmakerqueen.org' || host === 'www.rainmakerqueen.org') {
      return 'https://rainmakerqueen.onrender.com';
    }
  } catch {
    /* ignore */
  }
  return base;
}

function parseHttpsUrl(raw, label) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') {
      console.warn(`[Pelecard] ${label} must be HTTPS, got: ${trimmed}`);
      return null;
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    console.warn(`[Pelecard] Invalid ${label}: ${JSON.stringify(raw)}`);
    return null;
  }
}

/** Pelecard fetches CssURL from their servers — localhost URLs never work. */
function resolvePelecardCssUrl(config) {
  const language = normalizeCheckoutLanguage(process.env.PELECARD_CHECKOUT_LANGUAGE);
  const cssVariant = parsePelecardCssVariant(process.env.PELECARD_CSS_VARIANT);

  // Built-in gateway themes (recommended — external custom URLs need Pelecard whitelist)
  if (cssVariant !== null || process.env.PELECARD_USE_BUILTIN_CSS === 'true') {
    const variant = cssVariant ?? 4;
    return buildBuiltinPelecardCssUrl(config.baseUrl, language, variant);
  }

  const cssVersion = (process.env.PELECARD_CSS_VERSION || '10').trim();
  const explicit = parseHttpsUrl(process.env.PELECARD_CSS_URL, 'PELECARD_CSS_URL');
  if (explicit) {
    const cssPath = explicit.endsWith('.css') ? explicit : `${explicit}/pelecard-checkout.css`;
    return appendCssVersion(cssPath, cssVersion);
  }

  // Default: variant 4 (cleaner layout than legacy variant-en-1)
  return buildBuiltinPelecardCssUrl(config.baseUrl, language, 4);
}

function paymentPageUsesRequestedCss(html, cssUrl) {
  if (!html || !cssUrl) return false;
  try {
    const parsed = new URL(cssUrl);
    const fileName = parsed.pathname.split('/').pop();
    if (fileName && html.includes(fileName)) return true;
    return html.includes(parsed.pathname);
  } catch {
    return html.includes('pelecard-checkout.css') || /variant-(en|he)-\d+\.css/i.test(html);
  }
}

async function verifyCssAppliedOnPaymentPage(paymentUrl, cssUrl) {
  if (!paymentUrl || !cssUrl) return false;
  try {
    const html = await fetch(paymentUrl, {
      headers: { Accept: 'text/html,application/xhtml+xml' },
    }).then((r) => r.text());
    return paymentPageUsesRequestedCss(html, cssUrl);
  } catch (err) {
    console.warn('[Pelecard] Could not verify CssURL on payment page:', err.message);
    return false;
  }
}

function analyzeCheckoutHtmlForWallets(html) {
  if (!html || typeof html !== 'string') {
    return {
      applePayMentioned: false,
      googlePayMentioned: false,
      walletScriptUrls: [],
      pelecardPaymentScripts: [],
      pelecardWalletsLikelyEnabled: false,
    };
  }
  const walletScriptUrls = [];
  const pelecardPaymentScripts = [];
  for (const match of html.matchAll(/src=["']([^"']+)["']/gi)) {
    const src = match[1] || '';
    const lower = src.toLowerCase();
    if (/apple|google|wallet|gpay/.test(lower)) walletScriptUrls.push(src);
    if (/payment\/.*\.js/i.test(src)) pelecardPaymentScripts.push(src);
  }
  const applePayMentioned = /apple[\s-]?pay|applepaysession|apple-pay-button/i.test(html);
  const googlePayMentioned = /google[\s-]?pay|gpay/i.test(html);
  return {
    applePayMentioned,
    googlePayMentioned,
    walletScriptUrls,
    pelecardPaymentScripts,
    pelecardWalletsLikelyEnabled: applePayMentioned || googlePayMentioned || walletScriptUrls.length > 0,
  };
}

function getCheckoutCssDebugInfo() {
  const config = getConfig();
  const cssUrl = resolvePelecardCssUrl(config);
  const language = normalizeCheckoutLanguage(process.env.PELECARD_CHECKOUT_LANGUAGE);
  const cssVariant = parsePelecardCssVariant(process.env.PELECARD_CSS_VARIANT);
  const builtin = !isExternalCustomCssUrl(cssUrl);
  return {
    cssUrl,
    cssMode: builtin ? 'pelecard-builtin' : 'external-custom',
    cssVariant: cssVariant ?? (builtin ? 4 : null),
    checkoutLanguage: language,
    availableBuiltinVariants: PELECARD_BUILTIN_VARIANTS,
    sandboxMode: config.sandboxMode,
    appPublicUrl: config.appPublicUrl,
    backendPublicUrl: config.backendPublicUrl,
    explicitCssUrl: (process.env.PELECARD_CSS_URL || '').trim() || null,
    cssVersion: (process.env.PELECARD_CSS_VERSION || '10').trim(),
    terminal: config.terminal || null,
    cssUrlSupportNote: builtin
      ? 'Using Pelecard gateway CSS (variant). Set PELECARD_CSS_VARIANT=1–4 and PELECARD_CHECKOUT_LANGUAGE=en|he. English: variants 1 and 4 only.'
      : 'External CssURL requires Pelecard to whitelist your domain. Prefer PELECARD_CSS_VARIANT=4 instead.',
    note: 'Create a new payment session after CSS changes. CssURL is baked into the iframe at init time.',
  };
}

async function probeTerminalCssUrlSupport() {
  const config = getConfig();
  assertCredentials(config);
  const cssUrl = resolvePelecardCssUrl(config);
  const payload = {
    terminal: config.terminal,
    user: config.user,
    password: config.password,
    Total: '100',
    Currency: '1',
    ActionType: 'J4',
    ParamX: `css_probe_${Date.now()}`,
    GoodURL: `${config.appPublicUrl}/payment/success`,
    ErrorURL: `${config.appPublicUrl}/payment/failed`,
    CancelURL: `${config.appPublicUrl}/payment/cancelled`,
    Language: process.env.PELECARD_CHECKOUT_LANGUAGE || 'en',
    CssURL: cssUrl,
  };
  if (config.sandboxMode) payload.QAResultStatus = '000';

  const { ok, data } = await pelecardPost(PELECARD_INIT_PATH, payload);
  const paymentUrl = extractPaymentUrl(data);
  if (!ok || !paymentUrl || !pelecardErrorOk(data)) {
    return { cssUrl, cssApplied: false, probeError: 'Could not create probe session' };
  }
  const cssApplied = await verifyCssAppliedOnPaymentPage(paymentUrl, cssUrl);
  let variantStylesheet = null;
  let walletProbe = null;
  try {
    const html = await fetch(paymentUrl).then((r) => r.text());
    const match = html.match(/href=["']([^"']*variant-[^"']+\.css[^"']*)["']/i);
    variantStylesheet = match?.[1] || null;
    const walletSignals = analyzeCheckoutHtmlForWallets(html);
    walletProbe = {
      probePaymentUrlHost: (() => {
        try {
          return new URL(paymentUrl).hostname;
        } catch {
          return null;
        }
      })(),
      ...walletSignals,
      interpretation: walletSignals.pelecardWalletsLikelyEnabled
        ? 'Pelecard checkout HTML references wallet UI — terminal may have wallets enabled; test on Safari with a card in Wallet.'
        : 'Pelecard checkout HTML has no Apple/Google Pay markup — wallets are likely NOT enabled on this terminal (contact Pelecard).',
    };
  } catch {
    /* ignore */
  }
  return { cssUrl, cssApplied, variantStylesheet, walletProbe };
}

function buildCheckoutDisplayOptions(config, payment) {
  const cssUrl = resolvePelecardCssUrl(config);
  console.info('[Pelecard] Checkout CssURL:', cssUrl);
  const logoUrl = (process.env.PELECARD_LOGO_URL || '').trim();

  const topText = (process.env.PELECARD_TOP_TEXT || '').trim().slice(0, 200);

  const options = {
    CssURL: cssUrl,
    HiddenPelecardLogo: 'True',
    BottomText: (
      process.env.PELECARD_BOTTOM_TEXT ||
      '256-bit encrypted payment · Powered by Pelecard'
    ).slice(0, 200),
    UseBuildInFeedbackPage: 'False',
    // Must be False for embedded iframe — True makes Pelecard set Target=_top, which browsers block cross-origin
    FeedbackOnTop: 'False',
    Target: '_self',
    Language: process.env.PELECARD_CHECKOUT_LANGUAGE || 'en',
    CustomerIdField: 'must',
    Cvv2Field: 'must',
    EmailField: 'hide',
    TelField: 'hide',
    ShowSubmitButton: 'True',
  };

  if (topText) {
    options.TopText = topText;
  }

  if (logoUrl) {
    options.LogoURL = logoUrl;
  }

  const clientName =
    payment.description?.split(' - ')[1]?.split(' (#')[0]?.trim() || '';
  if (clientName) {
    options.CardHolderName = clientName.slice(0, 80);
  }

  return options;
}

function totalToAgorot(totalAmount) {
  const n = Number(totalAmount);
  if (!Number.isFinite(n) || n <= 0) {
    const err = new Error('Invalid payment amount');
    err.code = 'INVALID_AMOUNT';
    throw err;
  }
  return Math.round(n * 100);
}

function extractPaymentUrl(pelecardData) {
  if (!pelecardData || typeof pelecardData !== 'object') return null;
  return (
    pelecardData.URL ||
    pelecardData.Url ||
    pelecardData.IframeUrl ||
    pelecardData.RedirectUrl ||
    null
  );
}

function pelecardErrorOk(pelecardData) {
  const err = pelecardData?.Error;
  if (!err) return true;
  const code = err.ErrCode ?? err.Code ?? err.code;
  return code === 0 || code === '0';
}

async function pelecardPost(path, body) {
  const { baseUrl } = getConfig();
  const url = `${baseUrl}/${path.replace(/^\//, '')}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: response.ok, status: response.status, data };
}

/**
 * @param {object} payment - payment_links row
 * @param {string} secureToken - ParamX reference
 */
async function createPaymentSession(payment, secureToken) {
  const config = getConfig();
  assertCredentials(config);

  const charge = await resolvePelecardChargeAmount(payment);
  const totalAgorot = totalToAgorot(charge.chargeTotalNis);
  const paymentRef = secureToken || payment.secure_token;

  const returnBase = `${config.backendPublicUrl}/api/payments/pelecard/return`;
  const payload = {
    terminal: config.terminal,
    user: config.user,
    password: config.password,
    Total: String(totalAgorot),
    Currency: '1',
    ActionType: 'J4',
    ParamX: paymentRef,
    GoodURL: `${returnBase}/success`,
    ErrorURL: `${returnBase}/error`,
    CancelURL: `${returnBase}/cancel`,
    ServerSideGoodFeedbackURL: `${returnBase}/success`,
    ServerSideErrorFeedbackURL: `${returnBase}/error`,
    CreateToken: 'False',
    Language: 'en',
    FreeTotal: 'False',
    Details: buildPelecardDetails(payment, charge),
  };

  if (config.sandboxMode) {
    payload.QAResultStatus = '000';
  }

  Object.assign(payload, buildCheckoutDisplayOptions(config, payment));

  const { ok, data } = await pelecardPost(PELECARD_INIT_PATH, payload);

  if (!ok || !pelecardErrorOk(data)) {
    const err = new Error('Pelecard session creation failed');
    err.code = 'PELECARD_INIT_FAILED';
    err.pelecardResponse = data;
    throw err;
  }

  const paymentUrl = extractPaymentUrl(data);
  if (!paymentUrl) {
    const err = new Error('Pelecard did not return a payment URL');
    err.code = 'PELECARD_NO_URL';
    err.pelecardResponse = data;
    throw err;
  }

  const cssUrl = resolvePelecardCssUrl(config);
  const cssApplied = await verifyCssAppliedOnPaymentPage(paymentUrl, cssUrl);
  if (!cssApplied && isExternalCustomCssUrl(cssUrl)) {
    console.warn(
      `[Pelecard] External CssURL was sent (${cssUrl}) but checkout still uses default CSS. ` +
        `Use PELECARD_CSS_VARIANT=4 for Pelecard built-in themes, or ask Pelecard to whitelist your URL.`,
    );
  } else if (!cssApplied) {
    console.warn(
      `[Pelecard] Requested CssURL (${cssUrl}) was not found on the checkout page — try another PELECARD_CSS_VARIANT.`,
    );
  }

  return {
    paymentUrl,
    cssUrl,
    cssApplied,
    confirmationKey: data.ConfirmationKey || data.confirmationKey || null,
    rawResponse: data,
    charge,
  };
}

function buildPelecardDetails(payment, charge) {
  const base = (payment.description || 'CRM Payment').slice(0, 200);
  if (!charge.converted) return base.slice(0, 250);
  const note = ` (${charge.originalCurrency} ${charge.originalTotal} @ BOI ${charge.rateToIls})`;
  return `${base}${note}`.slice(0, 250);
}

async function getTransaction(transactionId) {
  const config = getConfig();
  assertCredentials(config);

  const { ok, data } = await pelecardPost(PELECARD_GET_TRANSACTION_PATH, {
    terminal: config.terminal,
    user: config.user,
    password: config.password,
    TransactionId: transactionId,
  });

  if (!ok) {
    const err = new Error('Pelecard transaction lookup failed');
    err.code = 'PELECARD_VALIDATE_FAILED';
    err.pelecardResponse = data;
    throw err;
  }

  const resultData = data?.ResultData || data?.resultData || data;
  return { raw: data, result: resultData };
}

function isSuccessfulStatus(statusCode, resultData) {
  const code = String(statusCode ?? resultData?.StatusCode ?? resultData?.statusCode ?? '').trim();

  // Explicit Pelecard approval
  if (code === '000') return true;

  // Any other non-empty status code is not a successful charge
  if (code) return false;

  if (resultData?.Status === 'Success' || resultData?.Result === 'Success') return true;

  // Do not treat "approval field present but no status code" as paid — that caused false positives.
  return false;
}

module.exports = {
  getConfig,
  assertCredentials,
  totalToAgorot,
  createPaymentSession,
  getTransaction,
  isSuccessfulStatus,
  extractPaymentUrl,
  resolvePelecardCssUrl,
  buildBuiltinPelecardCssUrl,
  getCheckoutCssDebugInfo,
  probeTerminalCssUrlSupport,
  verifyCssAppliedOnPaymentPage,
};
