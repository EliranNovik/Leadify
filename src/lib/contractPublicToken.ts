import { v4 as uuidv4 } from 'uuid';
import { supabase } from './supabase';

/**
 * Read or mint `contracts.public_token`, and only return a token that is
 * confirmed present on the row. Never trust local React state alone — a copied
 * URL with a token that never landed in the DB produces
 * "Invalid or expired contract link".
 */
export async function persistContractPublicToken(
  contractId: string,
  preferredToken?: string | null,
): Promise<string> {
  if (!contractId) throw new Error('Missing contract id');

  const { data: row, error: readError } = await supabase
    .from('contracts')
    .select('public_token')
    .eq('id', contractId)
    .maybeSingle();
  if (readError) throw new Error(readError.message || 'Failed to load contract link');

  const existing = String(row?.public_token || '').trim();
  if (existing) return existing;

  const next = String(preferredToken || '').trim() || uuidv4();
  const { data: updated, error: updateError } = await supabase
    .from('contracts')
    .update({ public_token: next })
    .eq('id', contractId)
    .select('public_token')
    .maybeSingle();
  if (updateError) throw new Error(updateError.message || 'Failed to create public contract link');

  const saved = String(updated?.public_token || '').trim();
  if (!saved) {
    // Classic silent RLS miss: UPDATE matches 0 rows, error is null.
    throw new Error('Failed to save public contract link. Please try again.');
  }

  const { data: verified, error: verifyError } = await supabase
    .from('contracts')
    .select('public_token')
    .eq('id', contractId)
    .maybeSingle();
  if (verifyError) throw new Error(verifyError.message || 'Failed to verify contract link');

  const verifiedToken = String(verified?.public_token || '').trim();
  if (!verifiedToken || verifiedToken !== saved) {
    throw new Error('Failed to verify public contract link. Please try again.');
  }

  return verifiedToken;
}
