import { supabase } from './supabase';
import {
  buildPaymentLinkLeadRef,
  isLegacyLeadRef,
  parseLegacyLeadNumericId,
} from './paymentLinkLeadRef';

export type PaymentHistoryEntry = {
  id: string | number;
  created_at: string | null;
  amount: number | null;
  payment_method: string | null;
  status: string | null;
};

export type InsertPaymentLinkInput = {
  paymentPlanId: number;
  leadId: string | number;
  leadType?: string | null;
  isLegacyPaymentPlan?: boolean;
  /** Contact id from payment_plans.client_id / finances_paymentplanrow.client_id */
  planContactId?: number | null;
  secureToken: string;
  amount: number;
  vatAmount: number;
  totalAmount: number;
  currency: string;
  description: string;
  expiresAt: string;
  status?: string;
};

/** Insert payment_links with required lead ref (client_id or legacy_id) + plan_contact_id from payment plan row. */
export async function insertPaymentLinkRecord(input: InsertPaymentLinkInput) {
  const leadRef = buildPaymentLinkLeadRef({
    leadId: input.leadId,
    leadType: input.leadType,
    isLegacyPaymentPlan: input.isLegacyPaymentPlan,
  });

  if (!leadRef.client_id && leadRef.legacy_id == null) {
    throw new Error('Payment link requires lead id (client_id or legacy_id)');
  }

  let planContactId =
    input.planContactId != null ? Number(input.planContactId) : null;
  if (planContactId == null || !Number.isFinite(planContactId)) {
    const table = input.isLegacyPaymentPlan ? 'finances_paymentplanrow' : 'payment_plans';
    const { data: planRow } = await supabase
      .from(table)
      .select('client_id')
      .eq('id', input.paymentPlanId)
      .maybeSingle();
    const fromPlan = planRow?.client_id != null ? Number(planRow.client_id) : NaN;
    if (Number.isFinite(fromPlan)) {
      planContactId = fromPlan;
    }
  }

  const row: Record<string, unknown> = {
    payment_plan_id: input.paymentPlanId,
    ...leadRef,
    secure_token: input.secureToken,
    amount: input.amount,
    vat_amount: input.vatAmount,
    total_amount: input.totalAmount,
    currency: input.currency || '₪',
    description: input.description,
    status: input.status ?? 'pending',
    expires_at: input.expiresAt,
  };

  if (planContactId != null && Number.isFinite(planContactId)) {
    row.plan_contact_id = planContactId;
  }

  return supabase.from('payment_links').insert(row).select().single();
}

/** Paid payment plan ids from Pelecard links (by plan row ids + lead ref fallback). */
export async function loadPaidPaymentLinkPlanIds(options: {
  leadId: string | number;
  leadType?: string | null;
  paymentPlanIds?: Array<number | string>;
}): Promise<Set<number>> {
  const result = new Set<number>();
  const planIds = [
    ...new Set(
      (options.paymentPlanIds ?? [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id)),
    ),
  ];

  if (planIds.length) {
    const { data, error } = await supabase
      .from('payment_links')
      .select('payment_plan_id')
      .in('payment_plan_id', planIds)
      .eq('status', 'paid')
      .not('payment_plan_id', 'is', null);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.payment_plan_id != null) result.add(Number(row.payment_plan_id));
    }
  }

  const legacyId = parseLegacyLeadNumericId(options.leadId);
  let leadQuery = supabase
    .from('payment_links')
    .select('payment_plan_id')
    .eq('status', 'paid')
    .not('payment_plan_id', 'is', null);

  if (legacyId != null || isLegacyLeadRef(options.leadType, options.leadId)) {
    if (legacyId == null) return result;
    leadQuery = leadQuery.eq('legacy_id', legacyId);
  } else {
    leadQuery = leadQuery.eq('client_id', String(options.leadId));
  }

  const { data: leadRows, error: leadErr } = await leadQuery;
  if (leadErr) throw leadErr;
  for (const row of leadRows ?? []) {
    if (row.payment_plan_id != null) result.add(Number(row.payment_plan_id));
  }

  return result;
}

export type PaymentPlanTaxReceiptInfo = {
  payper_invoice_link: string | null;
  payper_invoice_number: string | null;
  payper_invoice_status: string | null;
  payper_invoice_created_at: string | null;
};

type TaxReceiptLinkRow = {
  payment_plan_id?: number | null;
  payper_invoice_link?: string | null;
  payper_invoice_number?: string | null;
  payper_invoice_status?: string | null;
  payper_invoice_created_at?: string | null;
  status?: string | null;
  paid_at?: string | null;
};

function pickPreferredTaxReceiptRow(
  current: TaxReceiptLinkRow | undefined,
  candidate: TaxReceiptLinkRow,
): TaxReceiptLinkRow {
  if (!current) return candidate;

  const currentSuccess = current.payper_invoice_status === 'success';
  const candidateSuccess = candidate.payper_invoice_status === 'success';
  if (candidateSuccess && !currentSuccess) return candidate;
  if (currentSuccess && !candidateSuccess) return current;

  const currentHasLink = Boolean(current.payper_invoice_link?.trim());
  const candidateHasLink = Boolean(candidate.payper_invoice_link?.trim());
  if (candidateHasLink && !currentHasLink) return candidate;
  if (currentHasLink && !candidateHasLink) return current;

  const currentPaid = current.paid_at ? new Date(current.paid_at).getTime() : 0;
  const candidatePaid = candidate.paid_at ? new Date(candidate.paid_at).getTime() : 0;
  return candidatePaid >= currentPaid ? candidate : current;
}

/** Latest Payper tax receipt per payment plan (from paid payment_links). */
export async function loadPaymentPlanTaxReceipts(options: {
  leadId: string | number;
  leadType?: string | null;
  paymentPlanIds?: Array<number | string>;
  /** When true and paymentPlanIds is non-empty, skip lead-scoped fallback query. */
  planIdsOnly?: boolean;
}): Promise<Map<number, PaymentPlanTaxReceiptInfo>> {
  const result = new Map<number, PaymentPlanTaxReceiptInfo>();
  const planIds = [
    ...new Set(
      (options.paymentPlanIds ?? [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id)),
    ),
  ];

  const selectCols =
    'payment_plan_id, payper_invoice_link, payper_invoice_number, payper_invoice_status, payper_invoice_created_at, status, paid_at';

  const rowByPlanId = new Map<number, TaxReceiptLinkRow>();

  const ingestRows = (rows: TaxReceiptLinkRow[] | null | undefined) => {
    for (const row of rows ?? []) {
      const planId = row.payment_plan_id != null ? Number(row.payment_plan_id) : NaN;
      if (!Number.isFinite(planId)) continue;
      rowByPlanId.set(planId, pickPreferredTaxReceiptRow(rowByPlanId.get(planId), row));
    }
  };

  if (planIds.length) {
    const { data, error } = await supabase
      .from('payment_links')
      .select(selectCols)
      .in('payment_plan_id', planIds)
      .eq('status', 'paid');
    if (error) throw error;
    ingestRows(data as TaxReceiptLinkRow[]);

    if (options.planIdsOnly) {
      for (const [planId, row] of rowByPlanId) {
        result.set(planId, {
          payper_invoice_link: row.payper_invoice_link ?? null,
          payper_invoice_number: row.payper_invoice_number ?? null,
          payper_invoice_status: row.payper_invoice_status ?? null,
          payper_invoice_created_at: row.payper_invoice_created_at ?? null,
        });
      }
      return result;
    }
  }

  const legacyId = parseLegacyLeadNumericId(options.leadId);
  let leadQuery = supabase
    .from('payment_links')
    .select(selectCols)
    .eq('status', 'paid')
    .not('payment_plan_id', 'is', null);

  if (legacyId != null || isLegacyLeadRef(options.leadType, options.leadId)) {
    if (legacyId == null) {
      for (const [planId, row] of rowByPlanId) {
        result.set(planId, {
          payper_invoice_link: row.payper_invoice_link ?? null,
          payper_invoice_number: row.payper_invoice_number ?? null,
          payper_invoice_status: row.payper_invoice_status ?? null,
          payper_invoice_created_at: row.payper_invoice_created_at ?? null,
        });
      }
      return result;
    }
    leadQuery = leadQuery.eq('legacy_id', legacyId);
  } else {
    leadQuery = leadQuery.eq('client_id', String(options.leadId));
  }

  const { data: leadRows, error: leadErr } = await leadQuery;
  if (leadErr) throw leadErr;
  ingestRows(leadRows as TaxReceiptLinkRow[]);

  for (const [planId, row] of rowByPlanId) {
    result.set(planId, {
      payper_invoice_link: row.payper_invoice_link ?? null,
      payper_invoice_number: row.payper_invoice_number ?? null,
      payper_invoice_status: row.payper_invoice_status ?? null,
      payper_invoice_created_at: row.payper_invoice_created_at ?? null,
    });
  }

  return result;
}

type PaymentLinkRow = {
  id: string | number;
  status?: string | null;
  paid_at?: string | null;
  total_amount?: number | null;
  payment_method?: string | null;
  created_at?: string | null;
  payment_plan_id?: number | null;
  plan_contact_id?: number | null;
};

/**
 * Payment history for one contact — uses payment_plan_id (primary) so links without
 * client_id still appear; optional plan_contact_id filter when column is populated.
 */
export async function fetchContactPaymentHistory(options: {
  paymentPlanIds: Array<number | string>;
  leadId: string | number;
  leadType?: string | null;
  planContactId?: number | null;
}): Promise<PaymentHistoryEntry[]> {
  const planIds = [
    ...new Set(
      options.paymentPlanIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)),
    ),
  ];
  const contactId =
    options.planContactId != null ? Number(options.planContactId) : null;

  const linkMap = new Map<string | number, PaymentLinkRow>();

  const selectCols =
    'id, status, paid_at, total_amount, payment_method, created_at, payment_plan_id, plan_contact_id';

  if (planIds.length) {
    const { data, error } = await supabase
      .from('payment_links')
      .select(selectCols)
      .in('payment_plan_id', planIds);
    if (error) throw error;
    for (const row of (data ?? []) as PaymentLinkRow[]) {
      linkMap.set(row.id, row);
    }
  }

  if (contactId != null && Number.isFinite(contactId)) {
    const legacyId = parseLegacyLeadNumericId(options.leadId);
    let contactQuery = supabase.from('payment_links').select(selectCols).eq('plan_contact_id', contactId);
    if (legacyId != null || isLegacyLeadRef(options.leadType, options.leadId)) {
      if (legacyId != null) contactQuery = contactQuery.eq('legacy_id', legacyId);
    } else {
      contactQuery = contactQuery.eq('client_id', String(options.leadId));
    }
    const { data: contactLinks, error: contactErr } = await contactQuery;
    if (contactErr) throw contactErr;
    for (const row of (contactLinks ?? []) as PaymentLinkRow[]) {
      linkMap.set(row.id, row);
    }
  }

  const links = [...linkMap.values()];
  if (!links.length) return [];

  const linkIds = links.map((l) => l.id);
  const { data: transactions, error: txError } = await supabase
    .from('payment_transactions')
    .select('*')
    .in('payment_link_id', linkIds)
    .order('created_at', { ascending: false });
  if (txError) throw txError;

  const txLinkIds = new Set((transactions ?? []).map((t) => t.payment_link_id));
  const synthetic: PaymentHistoryEntry[] = links
    .filter((l) => {
      const status = (l.status || '').toLowerCase();
      return (status === 'paid' || status === 'processing') && !txLinkIds.has(l.id);
    })
    .map((l) => ({
      id: `link-${l.id}`,
      created_at: l.paid_at || l.created_at || null,
      amount: l.total_amount != null ? Number(l.total_amount) : null,
      payment_method: l.payment_method || 'pelecard',
      status: l.status || 'paid',
    }));

  const merged: PaymentHistoryEntry[] = [
    ...((transactions ?? []) as PaymentHistoryEntry[]),
    ...synthetic,
  ];

  merged.sort((a, b) => {
    const aTs = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTs = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bTs - aTs;
  });

  return merged;
}
