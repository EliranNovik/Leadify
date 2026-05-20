/** VAT rate by payment/proforma date for legacy leads (17% before 2025-01-01, 18% after). */
export function getVatRateForLegacyLead(dateString: string | null | undefined): number {
  if (!dateString) return 0.18;

  const paymentDate = new Date(dateString);
  if (isNaN(paymentDate.getTime())) return 0.18;

  const vatChangeDate = new Date('2025-01-01T00:00:00');
  return paymentDate < vatChangeDate ? 0.17 : 0.18;
}
