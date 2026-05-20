/**
 * Public share links for proforma invoices (read-only client preview).
 */
import toast from 'react-hot-toast';
import { supabase } from './supabase';

export type ProformaLinkKind = 'new' | 'legacy';

function newPublicToken(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function buildPublicProformaUrl(kind: ProformaLinkKind, id: string | number, token: string): string {
  const path =
    kind === 'legacy'
      ? `/public-proforma-legacy/${id}/${token}`
      : `/public-proforma/${id}/${token}`;
  return `${window.location.origin}${path}`;
}

export async function ensureNewProformaPublicToken(paymentPlanId: string | number): Promise<string> {
  const { data, error } = await supabase
    .from('payment_plans')
    .select('public_token')
    .eq('id', paymentPlanId)
    .single();

  if (error) {
    throw new Error(error.message || 'Failed to load proforma link');
  }

  if (data?.public_token) {
    return data.public_token;
  }

  const token = newPublicToken();
  const { error: updateError } = await supabase
    .from('payment_plans')
    .update({ public_token: token })
    .eq('id', paymentPlanId);

  if (updateError) {
    throw new Error(updateError.message || 'Failed to create share link');
  }

  return token;
}

export async function ensureLegacyProformaPublicToken(proformaId: string | number): Promise<string> {
  const { data, error } = await supabase
    .from('proformainvoice')
    .select('public_token')
    .eq('id', proformaId)
    .single();

  if (error) {
    throw new Error(error.message || 'Failed to load proforma link');
  }

  if (data?.public_token) {
    return data.public_token;
  }

  const token = newPublicToken();
  const { error: updateError } = await supabase
    .from('proformainvoice')
    .update({ public_token: token })
    .eq('id', proformaId);

  if (updateError) {
    throw new Error(updateError.message || 'Failed to create share link');
  }

  return token;
}

export async function shareProformaPublicLink(
  kind: ProformaLinkKind,
  id: string | number,
  options?: { clientName?: string },
): Promise<string> {
  const token =
    kind === 'legacy'
      ? await ensureLegacyProformaPublicToken(id)
      : await ensureNewProformaPublicToken(id);

  const url = buildPublicProformaUrl(kind, id, token);
  const clientName = options?.clientName?.trim() || 'Client';
  const title = `Invoice — ${clientName}`;
  const text = `Your proforma invoice from Decker Pex Levi Law Offices.`;

  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      toast.success('Link shared');
      return url;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return url;
      }
    }
  }

  await navigator.clipboard.writeText(url);
  toast.success('Link copied to clipboard');
  return url;
}

export async function shareCurrentPageUrl(options?: { title?: string; text?: string }): Promise<void> {
  const url = window.location.href;
  const title = options?.title ?? 'Invoice';
  const text = options?.text ?? 'Your proforma invoice from Decker Pex Levi Law Offices.';

  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
    }
  }

  await navigator.clipboard.writeText(url);
  toast.success('Link copied to clipboard');
}
