import { supabase } from './supabase';

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
 * payment_links.client_id stores the CRM lead id; payment_plan_id is the plan row id.
 */
export async function resolveProformaPaymentLinkUrl(options: {
  paymentPlanId?: string | number | null;
  /** Lead id (payment_links.client_id) — fallback when plan id is missing */
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
    let query = supabase
      .from('payment_links')
      .select('secure_token, status, expires_at, created_at, payment_plan_id')
      .eq('client_id', String(leadClientId))
      .order('created_at', { ascending: false })
      .limit(30);

    if (paymentPlanId != null && paymentPlanId !== '') {
      query = query.eq('payment_plan_id', paymentPlanId);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[proforma] payment_links by client_id:', error);
      return null;
    }
    return pickBestPaymentLinkUrl(data);
  }

  return null;
}
