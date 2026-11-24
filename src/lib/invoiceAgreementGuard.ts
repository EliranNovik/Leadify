import { supabase } from './supabase';
import { getStageName, hasPassedSignedAgreementStage } from './stageUtils';

export const INVOICE_BLOCKED_BEFORE_SIGNED_AGREEMENT = 'AGREEMENT_NOT_SIGNED';

export class InvoiceBlockedBeforeSignedAgreementError extends Error {
  readonly code = INVOICE_BLOCKED_BEFORE_SIGNED_AGREEMENT;
  readonly stageName: string;

  constructor(stageName: string) {
    const where = stageName.trim()
      ? `This lead is still at ${stageName.trim()}`
      : 'This lead has not reached Client signed agreement';
    super(`${where}, so no invoice can be sent.`);
    this.name = 'InvoiceBlockedBeforeSignedAgreementError';
    this.stageName = stageName.trim();
  }
}

export function isInvoiceBlockedBeforeSignedAgreement(
  error: unknown,
): error is InvoiceBlockedBeforeSignedAgreementError {
  if (error instanceof InvoiceBlockedBeforeSignedAgreementError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === INVOICE_BLOCKED_BEFORE_SIGNED_AGREEMENT
  );
}

type LeadStageLookup = { found: boolean; stage: unknown };

function legacyLeadId(leadId: string | number): number | null {
  const id = Number(String(leadId).replace(/^legacy_?/i, ''));
  return Number.isFinite(id) ? id : null;
}

/** Current stage on the lead row. `found` is false when that id is not a lead. */
export async function lookupLeadStageForInvoice(
  leadId: string | number,
  isLegacy: boolean,
): Promise<LeadStageLookup> {
  if (isLegacy) {
    const id = legacyLeadId(leadId);
    if (id == null) return { found: false, stage: null };
    const { data, error } = await supabase
      .from('leads_lead')
      .select('stage')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { found: false, stage: null };
    return { found: true, stage: data.stage };
  }

  const id = String(leadId).replace(/^legacy_?/i, '').trim();
  if (!id) return { found: false, stage: null };
  const { data, error } = await supabase.from('leads').select('stage').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return { found: false, stage: null };
  return { found: true, stage: data.stage };
}

export type InvoiceAgreementBlock = {
  blocked: boolean;
  stageName: string;
};

/**
 * Live check against the lead row. A missing lead, a stage before 60, or a lookup
 * failure all block the send, so a stale screen cannot let an invoice out.
 */
export async function describeInvoiceAgreementBlock(
  leadId: string | number,
  isLegacy: boolean,
): Promise<InvoiceAgreementBlock> {
  try {
    const looked = await lookupLeadStageForInvoice(leadId, isLegacy);
    if (looked.found && hasPassedSignedAgreementStage(looked.stage)) {
      return { blocked: false, stageName: '' };
    }
    const stageName =
      looked.found && looked.stage != null && String(looked.stage).trim() !== ''
        ? getStageName(String(looked.stage))
        : '';
    return { blocked: true, stageName };
  } catch (error) {
    console.error('[invoiceAgreementGuard] stage lookup failed:', error);
    return { blocked: true, stageName: '' };
  }
}

export type InvoiceSendLeadHint = {
  leadId?: string | number | null;
  isLegacyLead?: boolean;
  kind?: 'new' | 'legacy';
  paymentPlanId?: string | number | null;
  recordId?: string | number | null;
};

async function resolveLeadForInvoiceSend(
  input: InvoiceSendLeadHint,
): Promise<{ leadId: string | number; isLegacy: boolean } | null> {
  const preferLegacy = Boolean(input.isLegacyLead) || input.kind === 'legacy';

  if (input.leadId != null && String(input.leadId).trim() !== '') {
    const primary = await lookupLeadStageForInvoice(input.leadId, preferLegacy);
    if (primary.found) return { leadId: input.leadId, isLegacy: preferLegacy };
    const other = await lookupLeadStageForInvoice(input.leadId, !preferLegacy);
    if (other.found) return { leadId: input.leadId, isLegacy: !preferLegacy };
  }

  if (!preferLegacy) {
    const planId = input.paymentPlanId ?? input.recordId;
    if (planId != null && String(planId).trim() !== '') {
      const { data, error } = await supabase
        .from('payment_plans')
        .select('lead_id')
        .eq('id', planId)
        .maybeSingle();
      if (error) throw error;
      if (data?.lead_id != null && String(data.lead_id).trim() !== '') {
        return { leadId: data.lead_id, isLegacy: false };
      }
    }
    return null;
  }

  if (input.paymentPlanId != null && String(input.paymentPlanId).trim() !== '') {
    const { data, error } = await supabase
      .from('finances_paymentplanrow')
      .select('lead_id')
      .eq('id', input.paymentPlanId)
      .maybeSingle();
    if (error) throw error;
    if (data?.lead_id != null && String(data.lead_id).trim() !== '') {
      return { leadId: data.lead_id, isLegacy: true };
    }
  }

  if (input.recordId != null && String(input.recordId).trim() !== '') {
    const { data, error } = await supabase
      .from('proformainvoice')
      .select('lead_id')
      .eq('id', input.recordId)
      .maybeSingle();
    if (error) throw error;
    if (data?.lead_id != null && String(data.lead_id).trim() !== '') {
      return { leadId: data.lead_id, isLegacy: true };
    }
  }

  return null;
}

export const AGREEMENT_NOT_SIGNED_EVENT = 'crm:agreement-not-signed';

/** Lets any open CRM page show the signed-agreement dialog. */
export function publishAgreementNotSigned(stageName: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(AGREEMENT_NOT_SIGNED_EVENT, {
      detail: { stageName: stageName.trim() },
    }),
  );
}

/**
 * Same rule as an invoice send, for anything that hands the client a payment link.
 * Paying that link creates the invoice, so the link itself is refused and the dialog opens.
 */
export async function assertPaymentLinkAllowed(input: InvoiceSendLeadHint): Promise<void> {
  try {
    await assertLeadMayReceiveInvoice(input);
  } catch (error) {
    if (isInvoiceBlockedBeforeSignedAgreement(error)) {
      const stageName =
        error instanceof InvoiceBlockedBeforeSignedAgreementError ? error.stageName : '';
      publishAgreementNotSigned(stageName);
    }
    throw error;
  }
}

/** Throws when this send must not reach the client. */
export async function assertLeadMayReceiveInvoice(input: InvoiceSendLeadHint): Promise<void> {
  try {
    const lead = await resolveLeadForInvoiceSend(input);
    if (!lead) throw new InvoiceBlockedBeforeSignedAgreementError('');
    const result = await describeInvoiceAgreementBlock(lead.leadId, lead.isLegacy);
    if (result.blocked) throw new InvoiceBlockedBeforeSignedAgreementError(result.stageName);
  } catch (error) {
    if (isInvoiceBlockedBeforeSignedAgreement(error)) throw error;
    console.error('[invoiceAgreementGuard] refusing invoice send:', error);
    throw new InvoiceBlockedBeforeSignedAgreementError('');
  }
}
