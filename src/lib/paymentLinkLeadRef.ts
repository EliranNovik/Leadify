/** Map CRM lead id → payment_links.client_id (UUID) or payment_links.legacy_id (leads_lead.id). */

export type PaymentLinkLeadRef = {
  client_id: string | null;
  legacy_id?: number;
  is_legacy_payment_plan?: boolean;
};

export function isLegacyLeadRef(
  leadType?: string | null,
  leadId?: string | number | null,
): boolean {
  if (leadType === 'legacy') return true;
  return String(leadId ?? '').startsWith('legacy_');
}

export function parseLegacyLeadNumericId(leadId?: string | number | null): number | null {
  if (leadId == null || leadId === '') return null;
  const raw = String(leadId).trim().replace(/^legacy_/, '');
  if (!/^\d+$/.test(raw)) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function buildPaymentLinkLeadRef(options: {
  leadId: string | number;
  leadType?: string | null;
  isLegacyPaymentPlan?: boolean;
}): PaymentLinkLeadRef {
  const { leadId, leadType, isLegacyPaymentPlan = true } = options;

  if (isLegacyLeadRef(leadType, leadId)) {
    const legacyId = parseLegacyLeadNumericId(leadId);
    if (legacyId == null) {
      throw new Error('Invalid legacy lead id');
    }
    return {
      client_id: null,
      legacy_id: legacyId,
      is_legacy_payment_plan: isLegacyPaymentPlan,
    };
  }

  return { client_id: String(leadId) };
}

export function isLegacyPaymentLinkRow(row: {
  legacy_id?: number | string | null;
  is_legacy_payment_plan?: boolean | null;
  client_id?: string | null;
}): boolean {
  if (row.legacy_id != null && row.legacy_id !== '') return true;
  if (row.is_legacy_payment_plan === true) return true;
  return String(row.client_id || '').startsWith('legacy_');
}
