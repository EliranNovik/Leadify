import { supabase } from './supabase';
import { toast } from 'react-hot-toast';

export type UserHighlightRow = {
  id: number;
  user_id: string;
  lead_id: number | null;
  new_lead_id: string | null;
  lead_number: string | null;
  created_at: string;
  comment: string | null;
  comment_updated_at: string | null;
};

export type HighlightLead = {
  id: string;
  lead_number: string;
  name: string;
  created_at: string;
  category: string | null;
  source: string | null;
  language: string | null;
  topic: string | null;
  stage: string | number | null;
  lead_type: 'new' | 'legacy';
  display_lead_number?: string;
  status?: number;
  comment?: string | null;
  comment_updated_at?: string | null;
  highlightId?: number;
  misc_category?: {
    name: string;
    misc_maincategory?: Array<{ name: string }>;
  };
};

const HIGHLIGHT_JOIN_SELECT = `
  id,
  user_id,
  lead_id,
  new_lead_id,
  lead_number,
  created_at,
  comment,
  comment_updated_at,
  leads:leads!user_highlights_new_lead_id_fkey(
    id,
    lead_number,
    name,
    created_at,
    topic,
    stage,
    misc_category(
      name,
      misc_maincategory(name)
    )
  ),
  leads_lead:leads_lead!user_highlights_lead_id_fkey(
    id,
    lead_number,
    name,
    cdate,
    topic,
    stage,
    status,
    category_id,
    source_id,
    language_id,
    misc_category:category_id(name,misc_maincategory(name)),
    misc_leadsource:source_id(name),
    misc_language!fk_leads_lead_language_id(name)
  )
`;

function toHighlightRow(row: any): UserHighlightRow {
  return {
    id: row.id,
    user_id: row.user_id,
    lead_id: row.lead_id,
    new_lead_id: row.new_lead_id,
    lead_number: row.lead_number,
    created_at: row.created_at,
    comment: row.comment ?? null,
    comment_updated_at: row.comment_updated_at ?? null,
  };
}

function leadFromJoinNew(row: any, leadNew: any): HighlightLead {
  const cat = Array.isArray(leadNew.misc_category) ? leadNew.misc_category[0] : leadNew.misc_category;
  return {
    id: leadNew.id,
    lead_number: leadNew.lead_number || '',
    name: leadNew.name || '',
    created_at: leadNew.created_at || '',
    category: (cat as any)?.name || null,
    source: null,
    language: null,
    topic: leadNew.topic || null,
    stage: leadNew.stage || null,
    lead_type: 'new',
    display_lead_number: leadNew.lead_number || '',
    misc_category: cat || undefined,
    comment: row.comment || null,
    comment_updated_at: row.comment_updated_at || null,
    highlightId: row.id,
  };
}

function leadFromJoinLegacy(row: any, leadLegacy: any): HighlightLead {
  const cat = Array.isArray(leadLegacy.misc_category) ? leadLegacy.misc_category[0] : leadLegacy.misc_category;
  return {
    id: `legacy_${leadLegacy.id}`,
    lead_number: leadLegacy.lead_number != null ? String(leadLegacy.lead_number) : String(leadLegacy.id),
    name: leadLegacy.name || '',
    created_at: leadLegacy.cdate || '',
    category: (cat as any)?.name || null,
    source: (leadLegacy.misc_leadsource as any)?.name || null,
    language:
      (leadLegacy.misc_language as any)?.name ??
      (Array.isArray(leadLegacy.misc_language) ? (leadLegacy.misc_language[0] as any)?.name : null),
    topic: leadLegacy.topic || null,
    stage: leadLegacy.stage || null,
    lead_type: 'legacy',
    display_lead_number:
      leadLegacy.lead_number != null ? String(leadLegacy.lead_number) : String(leadLegacy.id),
    status: leadLegacy.status ?? undefined,
    misc_category: cat || undefined,
    comment: row.comment || null,
    comment_updated_at: row.comment_updated_at || null,
    highlightId: row.id,
  };
}

function dispatchHighlightRemoved() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('highlights:removed'));
  }
}

/** Hydrate starred leads the same way as the header Highlights panel (join, then N+1 fallback). */
export async function fetchUserHighlightLeads(userId: string): Promise<{
  highlights: UserHighlightRow[];
  leads: HighlightLead[];
}> {
  const { data: joinData, error: joinError } = await supabase
    .from('user_highlights')
    .select(HIGHLIGHT_JOIN_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (!joinError && joinData && joinData.length > 0) {
    const normalized: HighlightLead[] = [];
    for (const row of joinData as any[]) {
      const leadNew = Array.isArray(row.leads) ? row.leads[0] : row.leads;
      const leadLegacy = Array.isArray(row.leads_lead) ? row.leads_lead[0] : row.leads_lead;
      if (leadNew) {
        normalized.push(leadFromJoinNew(row, leadNew));
      } else if (leadLegacy) {
        normalized.push(leadFromJoinLegacy(row, leadLegacy));
      }
    }

    const highlights = (joinData as any[]).map(toHighlightRow);
    if (normalized.length === joinData.length) {
      return { highlights, leads: normalized };
    }
  }

  const { data, error } = await supabase
    .from('user_highlights')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const highlights = (data || []).map(toHighlightRow);
  if (!data || data.length === 0) {
    return { highlights, leads: [] };
  }

  const leadsPromises = data.map(async (highlight: any) => {
    if (highlight.new_lead_id) {
      const { data: leadData, error: leadError } = await supabase
        .from('leads')
        .select(`
          id,
          lead_number,
          name,
          created_at,
          topic,
          stage,
          misc_category (
            name,
            misc_maincategory (
              name
            )
          )
        `)
        .eq('id', highlight.new_lead_id)
        .single();

      if (leadError || !leadData) return null;
      return leadFromJoinNew(highlight, leadData);
    }
    if (highlight.lead_id != null && highlight.lead_id !== '') {
      const legacyId = Number(highlight.lead_id);
      if (!Number.isNaN(legacyId)) {
        const { data: leadData, error: leadError } = await supabase
          .from('leads_lead')
          .select(`
            id,
            lead_number,
            name,
            cdate,
            topic,
            stage,
            status,
            misc_category!leads_lead_category_id_fkey ( name ),
            misc_leadsource!leads_lead_source_id_fkey ( name ),
            misc_language!leads_lead_language_id_fkey ( name )
          `)
          .eq('id', legacyId)
          .maybeSingle();

        if (leadError || !leadData) return null;
        return leadFromJoinLegacy(highlight, leadData);
      }
    }
    return null;
  });

  const leads = (await Promise.all(leadsPromises)).filter((l): l is HighlightLead => l !== null);
  return { highlights, leads };
}

export async function removeHighlightById(highlightId: number): Promise<boolean> {
  try {
    const { error } = await supabase.from('user_highlights').delete().eq('id', highlightId);
    if (error) throw error;
    toast.success('Removed from highlights');
    dispatchHighlightRemoved();
    return true;
  } catch (error: any) {
    console.error('Error removing highlight:', error);
    toast.error('Failed to remove highlight');
    return false;
  }
}

export async function saveHighlightComment(
  highlightId: number,
  commentText: string,
): Promise<boolean> {
  try {
    const commentValue = commentText.trim() || null;
    const { error } = await supabase
      .from('user_highlights')
      .update({
        comment: commentValue,
        comment_updated_at: commentValue ? new Date().toISOString() : null,
      })
      .eq('id', highlightId);

    if (error) throw error;
    toast.success('Comment saved');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('highlights:added'));
    }
    return true;
  } catch (error: any) {
    console.error('Error saving comment:', error);
    toast.error(`Failed to save comment: ${error.message || 'Unknown error'}`);
    return false;
  }
}

/** Resolve users.id for current auth user (auth_id first, then email fallback). */
export async function getCurrentUserId(): Promise<string | null> {
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

