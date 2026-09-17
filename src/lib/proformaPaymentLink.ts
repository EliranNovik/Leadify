import { supabase } from './supabase';
import {
  buildPaymentLinkLeadRef,
  isLegacyLeadRef,
  parseLegacyLeadNumericId,
} from './paymentLinkLeadRef';
import { insertPaymentLinkRecord } from './paymentLinkQueries';
import {
  applyCheckoutSnapshotToPaymentLink,
  buildPaymentLinkDescription,
  fetchPaymentPlanCheckoutSnapshot,
  paymentLinkMatchesSnapshot,
  roundPaymentMoney,
  type PaymentPlanCheckoutSnapshot,
} from './paymentLinkPlanSnapshot';
import { paymentOrderLabel } from './paymentPlanOrderLabel';

type PaymentLinkRow = {
  secure_token?: string | null;
  status?: string | null;
  expires_at?: string | null;
};

export function buildPaymentLinkPublicUrl(secureToken: string): string {
  const token = secureToken.trim();
  if (!token) return '';
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/payment/${token}`;
  }
  return `/payment/${token}`;
}

/** Same route as PaymentPage (`/payment/:token`). */
export function buildPaymentPagePath(secureToken: string): string {
  const token = secureToken.trim();
  if (!token) return '';
  return `/payment/${encodeURIComponent(token)}`;
}

export function paymentPagePathFromPaymentUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const match = url.trim().match(/\/payment\/([^/?#]+)/);
  if (!match?.[1]) return null;
  try {
    return `/payment/${encodeURIComponent(decodeURIComponent(match[1]))}`;
  } catch {
    return `/payment/${match[1]}`;
  }
}

function isLinkUsable(row: PaymentLinkRow): boolean {
  const token = row.secure_token?.trim();
  if (!token) return false;
  const status = (row.status || '').toLowerCase();
  return status !== 'paid';
}

export const PAYMENT_LINK_TTL_DAYS = 180;

export function paymentLinkExpiresAtIso(from = new Date()): string {
  const expiresAt = new Date(from);
  expiresAt.setDate(expiresAt.getDate() + PAYMENT_LINK_TTL_DAYS);
  return expiresAt.toISOString();
}

type LiveCheckoutLinkRow = {
  id: string | number;
  secure_token?: string | null;
  status?: string | null;
  expires_at?: string | null;
  amount?: number | null;
  vat_amount?: number | null;
  total_amount?: number | null;
  description?: string | null;
  currency?: string | null;
  client_id?: string | null;
  legacy_id?: number | null;
  is_legacy_payment_plan?: boolean | null;
  pelecard_status_code?: string | null;
  pelecard_raw_response?: { openFinancePending?: boolean } | null;
};

/** Unpaid links that a client can still pay on the original URL. */
export function isLiveCheckoutPaymentLink(row: LiveCheckoutLinkRow): boolean {
  const token = row.secure_token?.trim();
  if (!token) return false;
  const status = (row.status || 'pending').toLowerCase();
  return status !== 'paid';
}

function isOpenFinancePendingLink(row: LiveCheckoutLinkRow): boolean {
  if ((row.status || '').toLowerCase() !== 'processing') return false;
  if (row.pelecard_raw_response?.openFinancePending === true) return true;
  return String(row.pelecard_status_code || '').trim() === '665';
}

/** Latest unpaid checkout link for a payment plan row (same lead + legacy flag). */
export async function findLatestLivePaymentLink(options: {
  paymentPlanId: number;
  excludeToken?: string | null;
  isLegacyPaymentPlan?: boolean;
  clientId?: string | null;
  legacyId?: number | null;
}): Promise<LiveCheckoutLinkRow | null> {
  let query = supabase
    .from('payment_links')
    .select(
      'id, secure_token, status, expires_at, created_at, amount, vat_amount, total_amount, description, currency, client_id, legacy_id, is_legacy_payment_plan, pelecard_status_code, pelecard_raw_response',
    )
    .eq('payment_plan_id', options.paymentPlanId)
    .in('status', ['pending', 'processing', 'failed', 'cancelled', 'expired'])
    .order('created_at', { ascending: false })
    .limit(20);

  if (options.isLegacyPaymentPlan != null) {
    query = query.eq('is_legacy_payment_plan', options.isLegacyPaymentPlan);
  }
  if (options.legacyId != null) {
    query = query.eq('legacy_id', options.legacyId);
  } else if (options.clientId) {
    query = query.eq('client_id', options.clientId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[payment-link] findLatestLivePaymentLink:', error);
    return null;
  }
  const exclude = options.excludeToken?.trim();
  return (
    (data || []).find((row) => {
      if (exclude && row.secure_token?.trim() === exclude) return false;
      return isLiveCheckoutPaymentLink(row);
    }) ?? null
  );
}

function pickBestPaymentLinkUrl(rows: PaymentLinkRow[] | null | undefined): string | null {
  if (!rows?.length) return null;
  const usable = rows.filter(isLinkUsable);
  const pending = usable.find((r) => (r.status || '').toLowerCase() === 'pending');
  const chosen = pending || usable[0];
  if (!chosen?.secure_token) return null;
  return buildPaymentLinkPublicUrl(chosen.secure_token);
}

/**
 * Resolve the public payment URL for a proforma’s payment plan row.
 * New leads: payment_links.client_id (UUID). Legacy: payment_links.legacy_id (leads_lead.id).
 */
export async function resolveProformaPaymentLinkUrl(options: {
  paymentPlanId?: string | number | null;
  /** Lead id — UUID for new leads, numeric or legacy_123 for legacy */
  leadClientId?: string | number | null;
  isLegacyPaymentPlan?: boolean;
}): Promise<string | null> {
  const { paymentPlanId, leadClientId } = options;
  const hasPlanId = paymentPlanId != null && paymentPlanId !== '';

  if (hasPlanId) {
    let query = supabase
      .from('payment_links')
      .select('secure_token, status, expires_at, created_at, payment_plan_id')
      .eq('payment_plan_id', paymentPlanId)
      .order('created_at', { ascending: false });

    if (options.isLegacyPaymentPlan != null) {
      query = query.eq('is_legacy_payment_plan', options.isLegacyPaymentPlan);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[proforma] payment_links by payment_plan_id:', error);
    } else {
      const url = pickBestPaymentLinkUrl(data);
      if (url) return url;
    }
  }

  // Never fall back to another installment when a plan row id was specified.
  if (hasPlanId) return null;
  if (leadClientId == null || leadClientId === '') return null;

  const legacyId = parseLegacyLeadNumericId(leadClientId);
  let query = supabase
    .from('payment_links')
    .select('secure_token, status, expires_at, created_at, payment_plan_id')
    .order('created_at', { ascending: false })
    .limit(30);

  if (legacyId != null) {
    query = query.eq('legacy_id', legacyId);
  } else {
    query = query.eq('client_id', String(leadClientId));
  }

  const { data, error } = await query;
  if (error) {
    console.error('[proforma] payment_links by lead ref:', error);
    return null;
  }
  return pickBestPaymentLinkUrl(data);
}

/** Resolve `/payment/:token` for the invoice payment plan row (PaymentPage route). */
export async function resolveProformaPaymentPagePath(options: {
  paymentPlanId?: string | number | null;
  leadClientId?: string | number | null;
}): Promise<string | null> {
  const url = await resolveProformaPaymentLinkUrl(options);
  return paymentPagePathFromPaymentUrl(url);
}

export type EnsureProformaPaymentLinkInput = {
  paymentPlanId: string | number;
  /** Lead id — UUID for new leads, numeric or legacy_123 for legacy */
  leadClientId: string | number;
  leadType?: string | null;
  isLegacyPaymentPlan?: boolean;
  value?: number;
  valueVat?: number;
  currency?: string;
  order?: string;
  clientName: string;
  leadNumber: string;
  /** Contact id from payment plan row (for per-contact payment history). */
  planContactId?: number | null;
};

function snapshotFromEnsureInput(
  options: EnsureProformaPaymentLinkInput,
): PaymentPlanCheckoutSnapshot {
  const amount = roundPaymentMoney(Number(options.value) || 0);
  const vatAmount = roundPaymentMoney(Number(options.valueVat) || 0);
  return {
    amount,
    vatAmount,
    totalAmount: roundPaymentMoney(amount + vatAmount),
    orderLabel: paymentOrderLabel(options.order) || options.order || 'Payment',
    currency: options.currency || '₪',
    paid: false,
  };
}

async function persistLiveLinkSnapshot(
  existing: LiveCheckoutLinkRow,
  snapshot: PaymentPlanCheckoutSnapshot,
  description: string,
): Promise<void> {
  const updates: Record<string, unknown> = {
    expires_at: paymentLinkExpiresAtIso(),
  };

  if (!paymentLinkMatchesSnapshot(existing, snapshot, description) && !isOpenFinancePendingLink(existing)) {
    const next = applyCheckoutSnapshotToPaymentLink(existing, snapshot, description);
    updates.amount = next.amount;
    updates.vat_amount = next.vat_amount;
    updates.total_amount = next.total_amount;
    updates.currency = next.currency;
    updates.description = next.description;
    updates.pelecard_session_url = null;
    updates.pelecard_confirmation_key = null;
    const status = (existing.status || 'pending').toLowerCase();
    if (status === 'processing' || status === 'failed' || status === 'cancelled' || status === 'expired') {
      updates.status = 'pending';
    }
  }

  const { error } = await supabase.from('payment_links').update(updates).eq('id', existing.id);
  if (error) {
    console.error('[ensureProformaPaymentLink] update live link failed:', error);
  }
}

/** Create or refresh a pending payment link from the Finances installment row. */
export async function ensureProformaPaymentLink(
  options: EnsureProformaPaymentLinkInput,
): Promise<{ url: string | null; created: boolean }> {
  const planRowId = Number(options.paymentPlanId);
  if (!Number.isFinite(planRowId)) {
    console.error('[ensureProformaPaymentLink] invalid payment plan id:', options.paymentPlanId);
    return { url: null, created: false };
  }

  const isLegacyPaymentPlan =
    options.isLegacyPaymentPlan ?? isLegacyLeadRef(options.leadType, options.leadClientId);
  const leadRef = buildPaymentLinkLeadRef({
    leadId: options.leadClientId,
    leadType: options.leadType,
    isLegacyPaymentPlan,
  });
  const dbSnapshot = await fetchPaymentPlanCheckoutSnapshot(planRowId, isLegacyPaymentPlan);
  const inputSnapshot = snapshotFromEnsureInput(options);
  const snapshot =
    dbSnapshot && (dbSnapshot.totalAmount > 0 || inputSnapshot.totalAmount <= 0)
      ? dbSnapshot
      : inputSnapshot;
  const description = buildPaymentLinkDescription(
    snapshot.orderLabel,
    options.clientName,
    options.leadNumber,
  );

  let existing = await findLatestLivePaymentLink({
    paymentPlanId: planRowId,
    isLegacyPaymentPlan,
    clientId: leadRef.client_id,
    legacyId: leadRef.legacy_id ?? null,
  });
  if (!existing) {
    existing = await findLatestLivePaymentLink({
      paymentPlanId: planRowId,
      clientId: leadRef.client_id,
      legacyId: leadRef.legacy_id ?? null,
    });
  }
  if (existing?.secure_token?.trim()) {
    await persistLiveLinkSnapshot(existing, snapshot, description);
    return { url: buildPaymentLinkPublicUrl(existing.secure_token.trim()), created: false };
  }

  const secureToken = `payment_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

  const { error } = await insertPaymentLinkRecord({
    paymentPlanId: planRowId,
    leadId: options.leadClientId,
    leadType: options.leadType,
    isLegacyPaymentPlan,
    planContactId: options.planContactId ?? null,
    secureToken,
    amount: snapshot.amount,
    vatAmount: snapshot.vatAmount,
    totalAmount: snapshot.totalAmount,
    currency: snapshot.currency || '₪',
    description,
    expiresAt: paymentLinkExpiresAtIso(),
  });

  if (error) {
    console.error('[ensureProformaPaymentLink] insert failed:', error);
    return { url: null, created: false };
  }

  return { url: buildPaymentLinkPublicUrl(secureToken), created: true };
}

/** Ensure the public payment URL for an invoice send matches this installment row. */
export async function ensurePaymentLinkUrlForInvoice(options: {
  paymentPlanId?: string | number | null;
  leadId?: string | number | null;
  isLegacyLead?: boolean;
  kind?: 'legacy' | 'new';
  clientName: string;
  leadNumber: string;
  contactId?: string | number | null;
}): Promise<string | null> {
  const isLegacy = options.kind === 'legacy' || Boolean(options.isLegacyLead);
  if (options.paymentPlanId != null && options.paymentPlanId !== '' && options.leadId != null && options.leadId !== '') {
    const ensured = await ensureProformaPaymentLink({
      paymentPlanId: options.paymentPlanId,
      leadClientId: options.leadId,
      leadType: isLegacy ? 'legacy' : 'new',
      isLegacyPaymentPlan: isLegacy,
      clientName: options.clientName,
      leadNumber: options.leadNumber,
      planContactId:
        options.contactId != null && options.contactId !== ''
          ? Number(options.contactId)
          : null,
    });
    if (ensured.url) return ensured.url;
  }
  return resolveProformaPaymentLinkUrl({
    paymentPlanId: options.paymentPlanId,
    leadClientId: options.leadId,
    isLegacyPaymentPlan: options.kind === 'legacy' || options.isLegacyLead ? true : undefined,
  });
}

/** Token for `/payment/:token` — reuses a live pending/processing link instead of minting a new one. */
export async function getOrCreatePaymentLinkToken(
  options: EnsureProformaPaymentLinkInput,
): Promise<string | null> {
  const result = await ensureProformaPaymentLink(options);
  if (!result.url) return null;
  const path = paymentPagePathFromPaymentUrl(result.url);
  if (!path) return null;
  const token = path.replace(/^\/payment\//, '');
  try {
    return decodeURIComponent(token);
  } catch {
    return token;
  }
}
