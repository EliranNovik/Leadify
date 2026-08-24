import { supabase } from './supabase';

/** Insert, update, or clear the logged-in user's personal follow-up for a lead. */
export async function upsertUserFollowUp(params: {
  userId: string;
  isLegacy: boolean;
  leadId: string;
  dateYmd: string | null;
}): Promise<void> {
  const { userId, isLegacy, leadId, dateYmd } = params;
  const hasDate = Boolean(dateYmd && dateYmd.trim());
  const dateValue = hasDate ? `${dateYmd}T00:00:00Z` : null;

  const existingQuery = isLegacy
    ? supabase
        .from('follow_ups')
        .select('id')
        .eq('user_id', userId)
        .eq('lead_id', Number(leadId))
        .is('new_lead_id', null)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()
    : supabase
        .from('follow_ups')
        .select('id')
        .eq('user_id', userId)
        .eq('new_lead_id', leadId)
        .is('lead_id', null)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();

  const { data: existingFollowUp, error: existingError } = await existingQuery;
  if (existingError) throw existingError;

  if (hasDate) {
    if (existingFollowUp?.id) {
      const { error } = await supabase.from('follow_ups').update({ date: dateValue }).eq('id', existingFollowUp.id);
      if (error) throw error;
      return;
    }
    const insertData: Record<string, unknown> = {
      user_id: userId,
      date: dateValue,
      created_at: new Date().toISOString(),
    };
    if (isLegacy) {
      insertData.lead_id = Number(leadId);
      insertData.new_lead_id = null;
    } else {
      insertData.new_lead_id = leadId;
      insertData.lead_id = null;
    }
    const { error } = await supabase.from('follow_ups').insert(insertData);
    if (error) throw error;
    return;
  }

  if (existingFollowUp?.id) {
    const { error } = await supabase.from('follow_ups').delete().eq('id', existingFollowUp.id);
    if (error) throw error;
  }
}
