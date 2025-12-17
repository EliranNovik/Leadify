import { supabase } from './supabase';

/**
 * Save or update a follow-up date for a lead
 * @param leadId - The ID of the lead (can be legacy or new)
 * @param date - The follow-up date
 * @param userId - The user setting the follow-up (optional, will use current user if not provided)
 */
export async function saveFollowUp(
  leadId: string | number,
  date: string | null,
  userId?: string
): Promise<{ error: any; data: any }> {
  try {
    console.log('📝 saveFollowUp called with:', { leadId, date, userId });
    
    // Determine if this is a legacy lead or new lead
    const isLegacyLead = String(leadId).startsWith('legacy_');
    const actualLeadId = isLegacyLead ? String(leadId).replace('legacy_', '') : leadId;
    
    console.log('🔍 Lead type:', { isLegacyLead, actualLeadId });

    // Get current user if not provided
    let currentUserId = userId;
    if (!currentUserId) {
      // First get the auth user
      const { data: { user: authUser } } = await supabase.auth.getUser();
      console.log('👤 Fetched auth user:', authUser?.id);
      
      // Then get the corresponding user from the users table
      if (authUser?.id) {
        const { data: appUser, error: userError } = await supabase
          .from('users')
          .select('id')
          .eq('auth_id', authUser.id)
          .single();
        
        if (userError) {
          console.error('❌ Error fetching user from users table:', userError);
          // Fall back to auth user ID if we can't find the app user
          currentUserId = authUser.id;
        } else if (appUser) {
          currentUserId = appUser.id;
          console.log('👤 Found user in users table:', currentUserId);
        }
      }
    }

    if (!date) {
      console.log('🗑️ Date is null, deleting existing follow-ups');
      // If date is null, delete existing follow-ups
      const deleteQuery = supabase.from('follow_ups').delete();
      
      if (isLegacyLead) {
        deleteQuery.eq('lead_id', actualLeadId);
      } else {
        deleteQuery.eq('new_lead_id', actualLeadId);
      }
      
      const { error } = await deleteQuery;
      return { error, data: null };
    }

    // Check if a follow-up already exists for this lead (regardless of user)
    console.log('🔎 Checking for existing follow-up...');
    let existingQuery = supabase
      .from('follow_ups')
      .select('id');

    if (isLegacyLead) {
      existingQuery = existingQuery.eq('lead_id', actualLeadId);
    } else {
      existingQuery = existingQuery.eq('new_lead_id', actualLeadId);
    }

    // Get the most recent follow-up
    existingQuery = existingQuery.order('created_at', { ascending: false }).limit(1);

    const { data: existingArray, error: queryError } = await existingQuery;
    if (queryError) {
      console.error('❌ Error querying for existing follow-up:', queryError);
    }
    const existing = existingArray && existingArray.length > 0 ? existingArray[0] : null;
    console.log('📊 Existing follow-up found:', existing);

    if (existing) {
      // Update existing follow-up
      console.log('♻️ Updating existing follow-up with ID:', existing.id);
      const updatePayload = { 
        date, 
        user_id: currentUserId,
        created_at: new Date().toISOString() 
      };
      console.log('📤 Update payload:', updatePayload);
      
      const { data, error } = await supabase
        .from('follow_ups')
        .update(updatePayload)
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        console.error('❌ Error updating follow-up:', error);
      } else {
        console.log('✅ Follow-up updated successfully:', data);
      }
      return { data, error };
    } else {
      // Insert new follow-up
      console.log('➕ Creating new follow-up');
      const insertData: any = {
        date,
        user_id: currentUserId,
      };

      if (isLegacyLead) {
        insertData.lead_id = Number(actualLeadId);
      } else {
        insertData.new_lead_id = actualLeadId;
      }
      
      console.log('📤 Insert payload:', insertData);

      const { data, error } = await supabase
        .from('follow_ups')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        console.error('❌ Error inserting follow-up:', error);
      } else {
        console.log('✅ Follow-up inserted successfully:', data);
      }
      return { data, error };
    }
  } catch (error) {
    console.error('Error saving follow-up:', error);
    return { error, data: null };
  }
}

/**
 * Get the latest follow-up for a lead
 * @param leadId - The ID of the lead (can be legacy or new)
 */
export async function getFollowUp(leadId: string | number): Promise<string | null> {
  try {
    const isLegacyLead = String(leadId).startsWith('legacy_');
    const actualLeadId = isLegacyLead ? String(leadId).replace('legacy_', '') : leadId;

    const query = supabase
      .from('follow_ups')
      .select('date')
      .order('created_at', { ascending: false })
      .limit(1);

    if (isLegacyLead) {
      query.eq('lead_id', actualLeadId);
    } else {
      query.eq('new_lead_id', actualLeadId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      console.error('Error fetching follow-up:', error);
      return null;
    }

    return data?.date || null;
  } catch (error) {
    console.error('Error fetching follow-up:', error);
    return null;
  }
}

/**
 * Get all follow-ups for a lead (for history)
 * @param leadId - The ID of the lead (can be legacy or new)
 */
export async function getFollowUpHistory(leadId: string | number): Promise<any[]> {
  try {
    const isLegacyLead = String(leadId).startsWith('legacy_');
    const actualLeadId = isLegacyLead ? String(leadId).replace('legacy_', '') : leadId;

    const query = supabase
      .from('follow_ups')
      .select(`
        *,
        users!user_id (
          full_name,
          email
        )
      `)
      .order('created_at', { ascending: false });

    if (isLegacyLead) {
      query.eq('lead_id', actualLeadId);
    } else {
      query.eq('new_lead_id', actualLeadId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching follow-up history:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching follow-up history:', error);
    return [];
  }
}

/**
 * Delete all follow-ups for a lead
 * @param leadId - The ID of the lead (can be legacy or new)
 */
export async function deleteFollowUps(leadId: string | number): Promise<{ error: any }> {
  try {
    const isLegacyLead = String(leadId).startsWith('legacy_');
    const actualLeadId = isLegacyLead ? String(leadId).replace('legacy_', '') : leadId;

    const query = supabase.from('follow_ups').delete();

    if (isLegacyLead) {
      query.eq('lead_id', actualLeadId);
    } else {
      query.eq('new_lead_id', actualLeadId);
    }

    const { error } = await query;
    return { error };
  } catch (error) {
    console.error('Error deleting follow-ups:', error);
    return { error };
  }
}

