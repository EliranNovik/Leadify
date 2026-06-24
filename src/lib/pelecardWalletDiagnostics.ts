export type PelecardWalletDiagnostics = {
  domainAssociationFile: { ok: boolean; status: number | null; error?: string };
  clientSecureScriptPresent: boolean;
  secureContext: boolean;
  userAgent: string;
  applePayApiAvailable: boolean;
  applePayCanMakePayments: boolean | null;
  paymentRequestAvailable: boolean;
  notes: string[];
};

/** Run on /payment/...?walletDebug=1 only — logs wallet prerequisites (parent page). */
export async function runPelecardWalletDiagnostics(): Promise<PelecardWalletDiagnostics> {
  const notes: string[] = [];
  const w = typeof window !== 'undefined' ? window : null;
  const ApplePaySessionCtor = w ? (w as Window & { ApplePaySession?: { canMakePayments?: () => boolean } }).ApplePaySession : undefined;

  let domainAssociationFile: PelecardWalletDiagnostics['domainAssociationFile'] = {
    ok: false,
    status: null,
  };
  try {
    const res = await fetch('/.well-known/apple-developer-merchantid-domain-association.txt', {
      method: 'HEAD',
      cache: 'no-store',
    });
    domainAssociationFile = { ok: res.ok, status: res.status };
    if (!res.ok) {
      notes.push('Apple domain association file did not return HTTP 200.');
    }
  } catch (err) {
    domainAssociationFile = {
      ok: false,
      status: null,
      error: err instanceof Error ? err.message : String(err),
    };
    notes.push('Could not reach /.well-known/apple-developer-merchantid-domain-association.txt');
  }

  const applePayApiAvailable = Boolean(ApplePaySessionCtor);
  let applePayCanMakePayments: boolean | null = null;
  if (applePayApiAvailable && typeof ApplePaySessionCtor?.canMakePayments === 'function') {
    try {
      applePayCanMakePayments = ApplePaySessionCtor.canMakePayments();
    } catch {
      applePayCanMakePayments = null;
    }
  }

  if (!applePayApiAvailable) {
    notes.push(
      'ApplePaySession is not available in this browser (use Safari on iPhone/Mac with a card in Wallet).',
    );
  } else if (applePayCanMakePayments === false) {
    notes.push('This device/browser reports Apple Pay is not set up (no card in Wallet).');
  }

  const paymentRequestAvailable = Boolean(w && 'PaymentRequest' in w);
  if (!paymentRequestAvailable) {
    notes.push('Payment Request API unavailable — Google Pay may not appear in this browser.');
  }

  const clientSecureScriptPresent = Boolean(
    typeof document !== 'undefined' && document.getElementById('pelecard-client-secure-v2'),
  );
  if (!clientSecureScriptPresent) {
    notes.push('Pelecard ClientSecureV2.js is not loaded on this page yet.');
  }

  notes.push(
    'Wallet buttons are rendered by Pelecard inside the iframe — only if Pelecard enabled Apple/Google Pay on your terminal.',
  );
  notes.push(
    'Hosting the domain file is step 1; Pelecard/Apple must still complete merchant domain verification.',
  );

  const result: PelecardWalletDiagnostics = {
    domainAssociationFile,
    clientSecureScriptPresent,
    secureContext: Boolean(w?.isSecureContext),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    applePayApiAvailable,
    applePayCanMakePayments,
    paymentRequestAvailable,
    notes,
  };

  console.group('[Pelecard wallet diagnostics]');
  console.table({
    domainFileOk: result.domainAssociationFile.ok,
    domainFileStatus: result.domainAssociationFile.status,
    clientSecureV2: result.clientSecureScriptPresent,
    secureContext: result.secureContext,
    applePayApi: result.applePayApiAvailable,
    applePayCanPay: result.applePayCanMakePayments,
    paymentRequestApi: result.paymentRequestAvailable,
  });
  for (const note of result.notes) console.info('•', note);
  if (result.applePayApiAvailable && result.applePayCanMakePayments && result.clientSecureScriptPresent) {
    console.warn(
      '[Pelecard wallet] This device is ready. If Apple Pay is still missing inside the Pelecard form, Pelecard has not enabled wallets on your terminal — contact Pelecard support.',
    );
  }
  console.groupEnd();

  return result;
}
