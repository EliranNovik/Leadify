/** Map Pelecard status codes to user-facing hints (sandbox + common declines). */
export function describePelecardFailure(
  statusCode?: string | null,
  statusDescription?: string | null
): string {
  const code = (statusCode || '').trim();
  const desc = (statusDescription || '').trim();

  if (code === '000') {
    return 'Payment approved.';
  }
  if (code === '002') {
    return (
      desc ||
      'Card declined (002). In sandbox this often means the test card number was rejected — use Pelecard’s approved test card, or enable QA mode for simulated success.'
    );
  }
  if (code === '001' || code === '003') {
    return desc || `Payment declined (code ${code}). Please try another card or contact the office.`;
  }
  if (desc) return desc;
  if (code) return `Payment declined (Pelecard code ${code}).`;
  return 'The payment was not completed. You can try again or contact the office for help.';
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
