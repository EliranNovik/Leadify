/**
 * Pelecard Gateway 2.0 — IFrame/Redirect init + transaction validation.
 * Credentials only via environment variables (never expose to frontend).
 */

const PELECARD_INIT_PATH = 'PaymentGW/init';
const PELECARD_GET_TRANSACTION_PATH = 'PaymentGW/GetTransaction';

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

function buildCheckoutDisplayOptions(config, payment) {
  const cssUrl =
    process.env.PELECARD_CSS_URL || `${config.appPublicUrl}/pelecard-checkout.css`;
  const logoUrl =
    process.env.PELECARD_LOGO_URL || `${config.appPublicUrl}/RMQ_LOGO.png`;

  const options = {
    CssURL: cssUrl,
    LogoURL: logoUrl,
    HiddenPelecardLogo: 'True',
    TopText: (process.env.PELECARD_TOP_TEXT || 'RMQ Secure Checkout').slice(0, 200),
    BottomText: (
      process.env.PELECARD_BOTTOM_TEXT ||
      '256-bit encrypted payment · Powered by Pelecard'
    ).slice(0, 200),
    UseBuildInFeedbackPage: 'False',
    FeedbackOnTop: 'True',
    Language: process.env.PELECARD_CHECKOUT_LANGUAGE || 'en',
    CustomerIdField: 'must',
    Cvv2Field: 'must',
    EmailField: 'optional',
    TelField: 'hide',
    ShowSubmitButton: 'True',
  };

  const clientName =
    payment.description?.split(' - ')[1]?.split(' (#')[0]?.trim() || '';
  if (clientName) {
    options.CardHolderName = clientName.slice(0, 80);
  }

  const email = payment.leads?.email;
  if (email) {
    options.EmailField = 'must';
    options.UserData = { UserData1: String(email).slice(0, 200) };
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

  const totalAgorot = totalToAgorot(payment.total_amount);
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
    CreateToken: 'False',
    Language: 'en',
    FreeTotal: 'False',
    Details: (payment.description || 'CRM Payment').slice(0, 250),
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

  return {
    paymentUrl,
    confirmationKey: data.ConfirmationKey || data.confirmationKey || null,
    rawResponse: data,
  };
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
  if (code === '000') return true;
  if (resultData?.Status === 'Success') return true;
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
};
