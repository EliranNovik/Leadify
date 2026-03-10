import { supabase } from './supabase';
import { toast } from 'react-hot-toast';

/** Resolve users.id for current auth user (auth_id first, then email fallback). */
async function getCurrentUserId(): Promise<string | null> {
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser?.id) return null;
  let res = await supabase.from('users').select('id').eq('auth_id', authUser.id).maybeSingle();
  if (res.data?.id) return res.data.id;
  if (authUser.email) {
    res = await supabase.from('users').select('id').eq('email', authUser.email).maybeSingle();
    if (res.data?.id) return res.data.id;
  }
  return null;
}

/**
 * Add a lead to user's highlights
 * @param leadId - The lead ID (can be UUID for new leads or number for legacy leads)
 * @param leadNumber - The lead number for display purposes
 * @param isLegacy - Whether this is a legacy lead (from leads_lead table)
 */
export const addToHighlights = async (
  leadId: string | number,
  leadNumber?: string,
  isLegacy: boolean = false
): Promise<boolean> => {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      toast.error('You must be logged in to add highlights');
      return false;
    }

    // Check if highlight already exists
    const checkQuery = isLegacy
      ? supabase
          .from('user_highlights')
          .select('id')
          .eq('user_id', userId)
          .eq('lead_id', leadId)
          .is('new_lead_id', null)
          .maybeSingle()
      : supabase
          .from('user_highlights')
          .select('id')
          .eq('user_id', userId)
          .eq('new_lead_id', leadId)
          .is('lead_id', null)
          .maybeSingle();

    const { data: existing } = await checkQuery;

    if (existing) {
      toast.error('Lead is already in your highlights');
      return false;
    }

    // Insert new highlight
    const insertData = isLegacy
      ? {
          user_id: userId,
          lead_id: leadId,
          new_lead_id: null,
          lead_number: leadNumber || String(leadId),
        }
      : {
          user_id: userId,
          lead_id: null,
          new_lead_id: leadId,
          lead_number: leadNumber || String(leadId),
        };

    const { error: insertError } = await supabase
      .from('user_highlights')
      .insert(insertData);

    if (insertError) {
      // Check if it's a unique constraint violation
      if (insertError.code === '23505') {
        toast.error('Lead is already in your highlights');
        return false;
      }
      throw insertError;
    }

    toast.success('Added to highlights');
    
    // Dispatch event to refresh highlights panel if open
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('highlights:added'));
    }

    return true;
  } catch (error: any) {
    console.error('Error adding to highlights:', error);
    toast.error('Failed to add to highlights');
    return false;
  }
};

/**
 * Remove a lead from user's highlights
 * @param leadId - The lead ID (can be UUID for new leads or number for legacy leads)
 * @param isLegacy - Whether this is a legacy lead (from leads_lead table)
 */
export const removeFromHighlights = async (
  leadId: string | number,
  isLegacy: boolean = false
): Promise<boolean> => {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      toast.error('You must be logged in to remove highlights');
      return false;
    }

    const deleteQuery = isLegacy
      ? supabase
          .from('user_highlights')
          .delete()
          .eq('user_id', userId)
          .eq('lead_id', leadId)
          .is('new_lead_id', null)
      : supabase
          .from('user_highlights')
          .delete()
          .eq('user_id', userId)
          .eq('new_lead_id', leadId)
          .is('lead_id', null);

    const { error: deleteError } = await deleteQuery;

    if (deleteError) {
      throw deleteError;
    }

    toast.success('Removed from highlights');
    
    // Dispatch event to refresh highlights panel if open
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('highlights:removed'));
    }

    return true;
  } catch (error: any) {
    console.error('Error removing from highlights:', error);
    toast.error('Failed to remove from highlights');
    return false;
  }
};

/**
 * Check if a lead is in user's highlights
 * @param leadId - The lead ID (can be UUID for new leads or number for legacy leads)
 * @param isLegacy - Whether this is a legacy lead (from leads_lead table)
 */
export const isInHighlights = async (
  leadId: string | number,
  isLegacy: boolean = false
): Promise<boolean> => {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return false;

    const checkQuery = isLegacy
      ? supabase
          .from('user_highlights')
          .select('id')
          .eq('user_id', userId)
          .eq('lead_id', leadId)
          .is('new_lead_id', null)
          .maybeSingle()
      : supabase
          .from('user_highlights')
          .select('id')
          .eq('user_id', userId)
          .eq('new_lead_id', leadId)
          .is('lead_id', null)
          .maybeSingle();

    const { data } = await checkQuery;
    return !!data;
  } catch (error: any) {
    console.error('Error checking highlights:', error);
    return false;
  }
};

