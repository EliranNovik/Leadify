import { supabase } from './supabase';

/**
 * DB-owned rule: if the lead is Handler Nominated/Set (105) and has a paid
 * payment plan row, advance to Handler Started (110).
 * Safe to call after any mark-as-paid; no-ops when conditions are not met.
 */
export async function tryAdvanceHandlerStartedAfterPayment(params: {
  leadId: string | number | null | undefined;
  isLegacy: boolean;
}): Promise<boolean> {
  const raw = params.leadId == null ? '' : String(params.leadId).trim();
  if (!raw) return false;

  const leadId = params.isLegacy ? raw.replace(/^legacy_/i, '') : raw;
  if (!leadId) return false;

  try {
    const { data, error } = await supabase.rpc('try_advance_handler_set_to_started', {
      p_is_legacy: params.isLegacy,
      p_lead_id: leadId,
    });
    if (error) {
      console.warn('try_advance_handler_set_to_started RPC failed:', error);
      return false;
    }
    return data === true;
  } catch (err) {
    console.warn('try_advance_handler_set_to_started RPC exception:', err);
    return false;
  }
}
