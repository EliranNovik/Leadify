import { supabase } from './supabase';

export type AdvanceClientSignedResult = {
  advanced: boolean;
  rpcAvailable: boolean;
};

/**
 * DB-owned rule: if the lead is Client signed agreement (60) and a case
 * handler is assigned, advance to Handler Nominated / Handler Set (105).
 * Safe to call after signing or handler assignment; no-ops when conditions
 * are not met.
 */
export async function tryAdvanceClientSignedToHandlerSet(params: {
  leadId: string | number | null | undefined;
  isLegacy: boolean;
}): Promise<AdvanceClientSignedResult> {
  const raw = params.leadId == null ? '' : String(params.leadId).trim();
  if (!raw) return { advanced: false, rpcAvailable: true };

  const leadId = params.isLegacy ? raw.replace(/^legacy_/i, '') : raw;
  if (!leadId) return { advanced: false, rpcAvailable: true };

  try {
    const { data, error } = await supabase.rpc('try_advance_client_signed_to_handler_set', {
      p_is_legacy: params.isLegacy,
      p_lead_id: leadId,
    });
    if (error) {
      const missing =
        error.code === 'PGRST202' ||
        /does not exist/i.test(error.message || '') ||
        /could not find the function/i.test(error.message || '');
      console.warn('try_advance_client_signed_to_handler_set RPC failed:', error);
      return { advanced: false, rpcAvailable: !missing };
    }
    return { advanced: data === true, rpcAvailable: true };
  } catch (err) {
    console.warn('try_advance_client_signed_to_handler_set RPC exception:', err);
    return { advanced: false, rpcAvailable: false };
  }
}
