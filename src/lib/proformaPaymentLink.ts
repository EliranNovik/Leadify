import { supabase } from './supabase';
import {
  buildPaymentLinkLeadRef,
  isLegacyLeadRef,
  parseLegacyLeadNumericId,
} from './paymentLinkLeadRef';
import { insertPaymentLinkRecord } from './paymentLinkQueries';

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
  if (status === 'expired' || status === 'cancelled') return false;
  if (row.expires_at && status === 'pending') {
    const exp = new Date(row.expires_at).getTime();
    if (!Number.isNaN(exp) && exp < Date.now()) return false;
  }
  return true;
}

export const PAYMENT_LINK_TTL_DAYS = 30;

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
};

/** Pending/processing links that a client can still pay. */
export function isLiveCheckoutPaymentLink(row: LiveCheckoutLinkRow): boolean {
  const token = row.secure_token?.trim();
  if (!token) return false;
  const status = (row.status || 'pending').toLowerCase();
  if (status !== 'pending' && status !== 'processing') return false;
  if (row.expires_at) {
    const exp = new Date(row.expires_at).getTime();
    if (!Number.isNaN(exp) && exp < Date.now()) return false;
  }
  return true;
}

/** Latest unpaid checkout link for a payment plan row. */
export async function findLatestLivePaymentLink(options: {
  paymentPlanId: number;
  excludeToken?: string | null;
}): Promise<LiveCheckoutLinkRow | null> {
  const { data, error } = await supabase
    .from('payment_links')
    .select('id, secure_token, status, expires_at, created_at')
    .eq('payment_plan_id', options.paymentPlanId)
    .in('status', ['pending', 'processing'])
    .order('created_at', { ascending: false })
    .limit(20);

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
}): Promise<string | null> {
  const { paymentPlanId, leadClientId } = options;

  if (paymentPlanId != null && paymentPlanId !== '') {
    const { data, error } = await supabase
      .from('payment_links')
      .select('secure_token, status, expires_at, created_at')
      .eq('payment_plan_id', paymentPlanId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[proforma] payment_links by payment_plan_id:', error);
    } else {
      const url = pickBestPaymentLinkUrl(data);
      if (url) return url;
    }
  }

  if (leadClientId != null && leadClientId !== '') {
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

    if (paymentPlanId != null && paymentPlanId !== '') {
      query = query.eq('payment_plan_id', paymentPlanId);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[proforma] payment_links by lead ref:', error);
      return null;
    }
    return pickBestPaymentLinkUrl(data);
  }

  return null;
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
  value: number;
  valueVat: number;
  currency: string;
  order: string;
  clientName: string;
  leadNumber: string;
  /** Contact id from payment plan row (for per-contact payment history). */
  planContactId?: number | null;
};

/** Create a pending payment link when none exists yet (e.g. right after proforma creation). */
export async function ensureProformaPaymentLink(
  options: EnsureProformaPaymentLinkInput,
): Promise<{ url: string | null; created: boolean }> {
  const planRowId = Number(options.paymentPlanId);
  if (!Number.isFinite(planRowId)) {
    console.error('[ensureProformaPaymentLink] invalid payment plan id:', options.paymentPlanId);
    return { url: null, created: false };
  }

  const existing = await findLatestLivePaymentLink({ paymentPlanId: planRowId });
  if (existing?.secure_token?.trim()) {
    await supabase
      .from('payment_links')
      .update({ expires_at: paymentLinkExpiresAtIso() })
      .eq('id', existing.id);
    return { url: buildPaymentLinkPublicUrl(existing.secure_token.trim()), created: false };
  }

  const secureToken = `payment_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

  const { error } = await insertPaymentLinkRecord({
    paymentPlanId: planRowId,
    leadId: options.leadClientId,
    leadType: options.leadType,
    isLegacyPaymentPlan:
      options.isLegacyPaymentPlan ?? isLegacyLeadRef(options.leadType, options.leadClientId),
    planContactId: options.planContactId ?? null,
    secureToken,
    amount: options.value,
    vatAmount: options.valueVat,
    totalAmount: options.value + options.valueVat,
    currency: options.currency || '₪',
    description: `${options.order} - ${options.clientName} (#${options.leadNumber})`,
    expiresAt: paymentLinkExpiresAtIso(),
  });

  if (error) {
    console.error('[ensureProformaPaymentLink] insert failed:', error);
    return { url: null, created: false };
  }

  return { url: buildPaymentLinkPublicUrl(secureToken), created: true };
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
