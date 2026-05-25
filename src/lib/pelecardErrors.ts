/** Pelecard codes that mean the hosted checkout session timed out or is no longer valid. */
export function isPelecardSessionExpiredCode(statusCode?: string | null): boolean {
  const code = (statusCode || '').trim();
  return code === '301' || code === '302' || code === '303';
}

/** Map Pelecard status codes to user-facing hints (no technical codes in copy). */
export function describePelecardFailure(
  statusCode?: string | null,
  statusDescription?: string | null
): string {
  const code = (statusCode || '').trim();

  if (code === '000') {
    return 'Payment approved.';
  }

  if (isPelecardSessionExpiredCode(code)) {
    return 'Your secure payment session has expired. Please try again.';
  }

  if (code === '002') {
    return 'Your card was declined. Please try another card or contact the office for help.';
  }

  if (code === '001' || code === '003') {
    return 'Your payment could not be completed. Please try another card or contact the office for help.';
  }

  return 'Your payment was not completed. Please try again or contact the office for help.';
}

export function logPelecardResult(
  context: string,
  payload: Record<string, unknown>
): void {
  if (import.meta.env.DEV) {
    console.info(`[Pelecard] ${context}`, payload);
  } else {
    console.warn(`[Pelecard] ${context}`, payload);
  }
}
