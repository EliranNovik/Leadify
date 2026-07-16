/** Pelecard codes that mean the hosted checkout iframe session timed out (not terminal permission errors). */
export function isPelecardSessionExpiredCode(statusCode?: string | null): boolean {
  const code = (statusCode || '').trim();
  return code === '301' || code === '302';
}

/** Terminal / acquirer permission — transaction type or CNP settings on the Pelecard terminal. */
export function isPelecardTerminalConfigCode(statusCode?: string | null): boolean {
  const code = (statusCode || '').trim();
  return code === '113' || code === '303';
}

export interface PelecardFailureCopy {
  title: string;
  explanation: string;
  actions: string[];
}

type FailureCopyInput = {
  statusCode?: string | null;
  statusDescription?: string | null;
  urlReason?: string | null;
  variant?: 'success' | 'failed' | 'cancelled';
};

/** User-facing title + explanation + next steps for a failed or incomplete payment. */
export function getPelecardFailureCopy(input: FailureCopyInput): PelecardFailureCopy {
  const code = (input.statusCode || '').trim();
  const reason = (input.urlReason || '').trim();

  if (reason === 'server_error') {
    return {
      title: 'Could not confirm payment',
      explanation:
        'Your card may have been charged, but we could not save the confirmation in our system. Do not pay again until we verify the status.',
      actions: [
        'Wait a few minutes and refresh this page.',
        'If the problem continues, contact our office with your case number.',
        'Do not start a new payment until we confirm whether the charge went through.',
      ],
    };
  }

  if (reason === 'missing_payment_id' || reason === 'payment_not_found') {
    return {
      title: 'Payment link problem',
      explanation: 'We could not match this page to a payment request.',
      actions: [
        'Open the payment link from the original email or message we sent you.',
        'If the link still does not work, contact our office for a new link.',
      ],
    };
  }

  if (code === '000') {
    return {
      title: 'Payment approved',
      explanation: 'Your payment was approved.',
      actions: [],
    };
  }

  if (isPelecardSessionExpiredCode(code)) {
    return {
      title: 'Checkout session expired',
      explanation:
        'The secure payment form is no longer active. This often happens if the payment page was open in more than one tab or browser, or was left open for a long time before submitting.',
      actions: [
        'Close any other tabs or windows with this payment link.',
        'Use only one browser window to complete the payment.',
        'Click “Try again” below and enter your card details in the new form.',
      ],
    };
  }

  if (code === '113') {
    return {
      title: 'Payment could not be completed',
      explanation:
        'Pelecard or the card network rejected this charge before approval. This often means the terminal is missing acquirer configuration for internet checkout (Shva vector 41 / CNP), not a problem with the card details you entered.',
      actions: [
        'Check that card number, expiry, and CVV are entered correctly, then try again in one browser tab.',
        'Contact our office if the problem continues — Pelecard may need to enable internet/CNP on the terminal.',
      ],
    };
  }

  if (code === '303') {
    return {
      title: 'Internet payment not enabled',
      explanation:
        'The payment terminal is not configured to process this card-not-present (internet/e-commerce) transaction. The checkout reached Pelecard, but the acquirer declined it because the terminal lacks permission for this transaction class.',
      actions: [
        'Try again later or with a different card.',
        'Contact our office — Pelecard or the acquiring bank may need to enable internet/CNP transactions on the terminal.',
      ],
    };
  }

  if (code === '002') {
    return {
      title: 'Card declined',
      explanation:
        'Your bank or card issuer declined this transaction. The charge was not completed and no money was taken.',
      actions: [
        'Try a different credit or debit card.',
        'Contact your bank to approve online or international payments.',
        'Contact our office if you need help completing the payment.',
      ],
    };
  }

  if (code === '004') {
    return {
      title: 'Payment could not be processed',
      explanation:
        'The card network or bank could not complete the charge. This can happen due to a temporary issue, incorrect card details, or bank security rules.',
      actions: [
        'Check that the card number, expiry date, and security code (CVV) are correct.',
        'Try again in a few minutes or use another card.',
        'Contact your bank if the problem continues.',
      ],
    };
  }

  if (code === '001' || code === '003') {
    return {
      title: 'Payment not approved',
      explanation:
        'The transaction was not approved. No payment was completed.',
      actions: [
        'Try again with another card.',
        'Make sure online payments are enabled for your card.',
        'Contact our office if you need assistance.',
      ],
    };
  }

  if (code === '005') {
    return {
      title: 'Insufficient funds',
      explanation: 'The card does not have enough available balance for this payment.',
      actions: [
        'Try another card or payment method.',
        'Contact your bank if you believe this message is incorrect.',
      ],
    };
  }

  if (code === '006') {
    return {
      title: 'Card expired',
      explanation: 'The card you used has expired.',
      actions: ['Use a valid, non-expired card and try again.'],
    };
  }

  if (code === '555' || input.variant === 'cancelled') {
    return getPelecardCancelledCopy();
  }

  const description = (input.statusDescription || '').trim();
  if (description) {
    return {
      title: 'Payment not completed',
      explanation: description,
      actions: [
        'Try again with another card or contact your bank.',
        'Contact our office if you need help.',
      ],
    };
  }

  return {
    title: 'Payment not completed',
    explanation: 'The payment was not completed. No charge was made.',
    actions: [
      'Click “Try again” below and complete the form in a single browser window.',
      'Try another card if the problem continues.',
      'Contact our office for assistance.',
    ],
  };
}

export function getPelecardCancelledCopy(): PelecardFailureCopy {
  return {
    title: 'Payment cancelled',
    explanation: 'You left the payment form before completing the transaction. No charge was made.',
    actions: [
      'Click “Back to payment” when you are ready to try again.',
      'Complete the form in one browser window — avoid opening the link in multiple tabs.',
    ],
  };
}

/** @deprecated Use getPelecardFailureCopy().explanation */
export function describePelecardFailure(
  statusCode?: string | null,
  statusDescription?: string | null,
): string {
  return getPelecardFailureCopy({ statusCode, statusDescription }).explanation;
}

export function logPelecardResult(
  context: string,
  payload: Record<string, unknown>,
): void {
  if (import.meta.env.DEV) {
    console.info(`[Pelecard] ${context}`, payload);
  } else {
    console.warn(`[Pelecard] ${context}`, payload);
  }
}
