import { supabase } from './supabase';
import { fetchStageNames, normalizeStageName, areStagesEquivalent } from './stageUtils';
import type { CombinedLead } from './legacyLeadsApi';

export interface StageActorInfo {
  fullName: string;
  employeeId: number | null;
}

interface LeadIdentity {
  isLegacy: boolean;
  recordId: string | number;
  tableName: 'leads' | 'leads_lead';
}

const LEGACY_PREFIX = 'legacy_';

/**
 * Helper to determine if a value can be safely converted to a finite number.
 */
const toNumeric = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
};

/**
 * Resolves the identity of a lead, providing table name, record ID, and legacy flag.
 */
const getLeadIdentity = (lead: CombinedLead): LeadIdentity => {
  const idAsString = lead.id?.toString() ?? '';
  const isLegacy = lead.lead_type === 'legacy' || idAsString.startsWith(LEGACY_PREFIX);

  if (isLegacy) {
    const numericPart = idAsString.startsWith(LEGACY_PREFIX)
      ? idAsString.substring(LEGACY_PREFIX.length)
      : idAsString;
    const parsed = parseInt(numericPart, 10);
    return {
      isLegacy: true,
      tableName: 'leads_lead',
      recordId: Number.isNaN(parsed) ? numericPart : parsed,
    };
  }

  return {
    isLegacy: false,
    tableName: 'leads',
    recordId: lead.id,
  };
};

/**
 * Attempts to resolve a stage identifier (string or number) into a numeric stage ID.
 * Falls back to null if no numeric mapping can be determined.
 */
const resolveStageId = async (stage: string | number | null | undefined): Promise<number | null> => {
  if (stage === null || stage === undefined) {
    return null;
  }

  if (typeof stage === 'number') {
    return Number.isFinite(stage) ? stage : null;
  }

  const stageStr = stage.trim();

  if (stageStr === '') {
    return null;
  }

  // Direct numeric match
  const numericDirect = toNumeric(stageStr);
  if (numericDirect !== null) {
    return numericDirect;
  }

  // Fetch stage names from cache/database
  const stageNames = await fetchStageNames();

  // If the stage string itself is a known ID in the table, attempt to convert it
  if (stageNames[stageStr]) {
    const numericFromId = toNumeric(stageStr);
    if (numericFromId !== null) {
      return numericFromId;
    }
  }

  // Try to match by normalized name or alternative forms
  const normalizedTarget = normalizeStageName(stageStr);

  for (const [id, name] of Object.entries(stageNames)) {
    if (!name) continue;

    const normalizedId = normalizeStageName(id);
    const normalizedName = normalizeStageName(name);

    if (
      normalizedId === normalizedTarget ||
      normalizedName === normalizedTarget ||
      areStagesEquivalent(name, stageStr)
    ) {
      const numericFromMapping = toNumeric(id);
      if (numericFromMapping !== null) {
        return numericFromMapping;
      }
    }
  }

  return null;
};

/**
 * Fetches the current user's display name (prefer employee display name, fallback to full name/email)
 * and associated employee_id for creator attribution.
 */
export const fetchStageActorInfo = async (): Promise<StageActorInfo> => {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData?.user;

  let fullName = 'Unknown User';
  let employeeId: number | null = null;

  if (user) {
    const { data: userData } = await supabase
      .from('users')
      .select(`
        full_name,
        email,
        employee_id,
        tenants_employee!employee_id(
          id,
          display_name
        )
      `)
      .eq('auth_id', user.id)
      .single();

    if (userData) {
      const employeeRecord = (userData as any).tenants_employee;
      fullName =
        employeeRecord?.display_name ||
        userData.full_name ||
        userData.email ||
        user.email ||
        fullName;

      if (userData.employee_id !== undefined && userData.employee_id !== null) {
        employeeId = Number(userData.employee_id);
      }
    } else if (user.email) {
      fullName = user.email;
    }
  }

  return { fullName, employeeId };
};

/**
 * Records a stage change entry for the supplied lead.
 * The stage value is resolved to a numeric ID when possible.
 */
export const recordLeadStageChange = async ({
  lead,
  stage,
  actor,
  timestamp,
}: {
  lead: CombinedLead;
  stage: string | number;
  actor?: StageActorInfo;
  timestamp?: string;
}): Promise<boolean> => {
  const stageActor = actor ?? (await fetchStageActorInfo());
  const resolvedStageId = await resolveStageId(stage);
  const effectiveTimestamp = timestamp ?? new Date().toISOString();
  const { isLegacy, recordId } = getLeadIdentity(lead);

  const payload: {
    stage: number | null;
    date: string;
    cdate: string;
    udate: string;
    creator_id: number | null;
    lead_id?: number | string | null;
    newlead_id?: string | null;
  } = {
    stage: resolvedStageId,
    date: effectiveTimestamp,
    cdate: effectiveTimestamp,
    udate: effectiveTimestamp,
    creator_id: stageActor.employeeId,
  };

  if (isLegacy) {
    // For legacy leads, ensure lead_id is a number
    const legacyId = typeof recordId === 'number' 
      ? recordId 
      : toNumeric(String(recordId));
    
    if (legacyId === null) {
      console.error('Unable to convert legacy lead ID to number:', {
        lead,
        recordId,
        leadId: lead.id,
        isLegacy,
      });
      throw new Error(`Unable to determine numeric ID for legacy lead: ${lead.id}`);
    }
    
    payload.lead_id = legacyId;
    console.log('📝 Recording stage change for legacy lead:', {
      leadId: lead.id,
      numericId: legacyId,
      stage: resolvedStageId,
      payload,
    });
  } else {
    payload.newlead_id = typeof recordId === 'string' ? recordId : String(recordId);
    console.log('📝 Recording stage change for new lead:', {
      leadId: lead.id,
      stage: resolvedStageId,
      payload,
    });
  }

  // Check for very recent duplicates (within 1 second) to prevent true double-clicks
  // But allow legitimate stage changes even if the same stage was set before
  const duplicateCheckColumn = isLegacy ? 'lead_id' : 'newlead_id';
  const duplicateCheckValue = isLegacy ? payload.lead_id : payload.newlead_id;
  
  if (duplicateCheckValue !== null && duplicateCheckValue !== undefined) {
    const oneSecondAgo = new Date(Date.now() - 1000).toISOString(); // Only check last 1 second for true duplicates
    
    const { data: recentRecords, error: checkError } = await supabase
      .from('leads_leadstage')
      .select('id, date, cdate, stage, creator_id')
      .eq(duplicateCheckColumn, duplicateCheckValue)
      .eq('stage', payload.stage)
      .eq('creator_id', payload.creator_id)
      .gte('cdate', oneSecondAgo) // Check cdate, very short window (1 second) for true duplicates only
      .order('cdate', { ascending: false })
      .limit(1);
    
    if (checkError) {
      console.warn('⚠️ Error checking for duplicates (continuing with insert anyway):', checkError);
    } else if (recentRecords && recentRecords.length > 0) {
      // Only skip if it's a true duplicate within 1 second (double-click scenario)
      const timeDiff = Date.now() - new Date(recentRecords[0].date || recentRecords[0].cdate).getTime();
      if (timeDiff < 1000) {
        console.warn('⚠️ Duplicate stage change detected (true duplicate within 1 second), skipping insert:', {
          leadId: lead.id,
          stage: resolvedStageId,
          lastRecordDate: recentRecords[0].date || recentRecords[0].cdate,
          timeDiffMs: timeDiff,
          message: 'This appears to be a true duplicate (double-click) - same stage change was just recorded.',
        });
        return false; // Return false to indicate the insert was skipped
      }
      // Otherwise, continue with the insert - it's a legitimate stage change
    }
  }

  // Ensure we're not including an 'id' field in the payload - let Supabase auto-generate it via bigserial
  // Also ensure we're not accidentally including any other fields that might cause issues
  const insertPayload: Record<string, any> = {
    stage: payload.stage,
    date: payload.date,
    cdate: payload.cdate,
    udate: payload.udate,
    creator_id: payload.creator_id,
  };
  
  // Only include lead_id or newlead_id, not both
  if (isLegacy && payload.lead_id !== null && payload.lead_id !== undefined) {
    insertPayload.lead_id = payload.lead_id;
  } else if (!isLegacy && payload.newlead_id !== null && payload.newlead_id !== undefined) {
    insertPayload.newlead_id = payload.newlead_id;
  }

  // Explicitly do NOT include 'id' - let the database auto-generate it via bigserial
  console.log('📤 Inserting stage change record (id will be auto-generated):', {
    payload: insertPayload,
    hasId: 'id' in insertPayload,
  });

  const { error, data } = await supabase.from('leads_leadstage').insert(insertPayload).select('id');

  if (error) {
    // Handle duplicate key error gracefully (code 23505)
    // This could be a true duplicate (same stage change in quick succession)
    // or a legitimate stage change that happens to match a constraint
    if (error.code === '23505') {
      // Check if it's a primary key violation (sequence out of sync)
      const isPrimaryKeyViolation = error.message?.includes('leads_leadstage_pkey') || 
                                     error.message?.includes('duplicate key value violates unique constraint');
      
      if (isPrimaryKeyViolation) {
        // If sequence is out of sync, try to fix it using the RPC function
        // Then retry the insert once
        try {
          console.warn('📊 Sequence out of sync detected, attempting to fix...');
          
          // Call the RPC function to fix the sequence
          const { data: fixResult, error: fixError } = await supabase
            .rpc('fix_leads_leadstage_sequence');
          
          if (fixError) {
            console.error('❌ Failed to fix sequence via RPC:', fixError);
          } else {
            console.log('✅ Sequence fixed successfully, new value:', fixResult);
            
            // Retry the insert once after fixing the sequence
            const { error: retryError, data: retryData } = await supabase
              .from('leads_leadstage')
              .insert(insertPayload)
              .select('id');
            
            if (!retryError && retryData) {
              console.log('✅ Stage change history recorded successfully after sequence fix');
              return true; // Success!
            } else if (retryError) {
              console.error('❌ Retry insert failed after sequence fix:', retryError);
            }
          }
        } catch (fixAttemptError) {
          console.error('❌ Error attempting to fix sequence:', fixAttemptError);
        }
        
        console.error('❌ Primary key violation on leads_leadstage - sequence may be out of sync:', {
          error: error.message,
          errorCode: error.code,
          errorDetails: error.details,
          insertPayload,
          stage: resolvedStageId,
          leadId: lead.id,
          message: 'The database sequence (bigserial) for id generation may be out of sync. The stage update succeeded, but history recording failed. Run the SQL script: sql/fix_leads_leadstage_sequence.sql',
        });
        
        // Return false - can't insert due to sequence issue
        return false;
      } else {
        // Other unique constraint violations
        console.error('❌ Duplicate stage change record blocked by unique constraint:', {
          error: error.message,
          errorCode: error.code,
          errorDetails: error.details,
          insertPayload,
          stage: resolvedStageId,
          leadId: lead.id,
          message: 'The database has a unique constraint preventing this insert. The stage update succeeded, but history recording failed.',
        });
      }
      
      // Return false to indicate failure
      return false;
    }
    
    console.error('❌ Error recording lead stage change:', {
      error,
      payload,
      stage,
      resolvedStageId,
      isLegacy,
      recordId,
      leadId: lead.id,
    });
    throw error;
  }
  
  console.log('✅ Successfully recorded stage change:', {
    isLegacy,
    leadId: lead.id,
    stage: resolvedStageId,
    insertedId: data?.[0]?.id,
  });
  
  return true; // Return true to indicate success
};

/**
 * Fetches employee display name by employee ID
 */
const getEmployeeDisplayNameById = async (employeeId: number | null): Promise<string | null> => {
  if (!employeeId) return null;
  
  try {
    const { data, error } = await supabase
      .from('tenants_employee')
      .select('display_name')
      .eq('id', employeeId)
      .single();
    
    if (error) {
      console.error('Error fetching employee name:', error);
      return null;
    }
    
    return data?.display_name || null;
  } catch (error) {
    console.error('Error in getEmployeeDisplayNameById:', error);
    return null;
  }
};

/**
 * Triggers celebration for client signed agreement (stage 60)
 * Uses the actor who made the stage change (currently signed-in user)
 */
const triggerCelebrationIfNeeded = async (
  lead: CombinedLead, 
  resolvedStageId: number | null,
  actor?: StageActorInfo
) => {
  // Check if stage is 60 (Client signed agreement)
  if (resolvedStageId !== 60) return;
  
  try {
    // Use the actor who made the stage change (currently signed-in user)
    const stageActor = actor ?? (await fetchStageActorInfo());
    
    // Get employee display name if we have an employee ID
    let employeeName = stageActor.fullName;
    if (stageActor.employeeId) {
      const displayName = await getEmployeeDisplayNameById(stageActor.employeeId);
      if (displayName) {
        employeeName = displayName;
      }
    }
    
    console.log('🎉 Triggering celebration for stage 60:', {
      employeeName,
      employeeId: stageActor.employeeId,
      fullName: stageActor.fullName,
    });
    
    // Trigger celebration via custom event
    if (employeeName) {
      // Use setTimeout to ensure the event is dispatched after the DOM is ready
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('celebrate-contract-signed', {
          detail: {
            employeeName: employeeName,
            employeeId: stageActor.employeeId,
          }
        }));
      }, 100);
    }
  } catch (error) {
    console.error('Error triggering celebration:', error);
    // Don't throw - celebration is non-critical
  }
};

/**
 * Applies a stage update to the correct lead table and logs history.
 * Accepts optional additional update fields to merge into the update payload.
 */
export const updateLeadStageWithHistory = async ({
  lead,
  stage,
  additionalFields = {},
  actor,
  timestamp,
}: {
  lead: CombinedLead;
  stage: string | number;
  additionalFields?: Record<string, any>;
  actor?: StageActorInfo;
  timestamp?: string;
}) => {
  const stageActor = actor ?? (await fetchStageActorInfo());
  const effectiveTimestamp = timestamp ?? new Date().toISOString();
  const { tableName, recordId } = getLeadIdentity(lead);
  
  const resolvedStageId = await resolveStageId(stage);

  const updatePayload: Record<string, any> = {
    stage: resolvedStageId ?? stage,
    stage_changed_by: stageActor.fullName,
    stage_changed_at: effectiveTimestamp,
    ...additionalFields,
  };

  console.log('📝 Updating lead stage:', {
    tableName,
    recordId,
    resolvedStageId,
    stage,
    leadId: lead.id,
    isLegacy: lead.lead_type === 'legacy' || lead.id?.toString().startsWith('legacy_'),
  });

  const { error } = await supabase
    .from(tableName)
    .update(updatePayload)
    .eq('id', recordId);

  if (error) {
    console.error('❌ Error updating lead stage:', { error, tableName, recordId, updatePayload });
    throw error;
  }

  console.log('✅ Lead stage updated successfully, now recording stage change history...');
  
  try {
    const recordSuccess = await recordLeadStageChange({ lead, stage, actor: stageActor, timestamp: effectiveTimestamp });
    if (recordSuccess) {
      console.log('✅ Stage change history recorded successfully');
    } else {
      console.warn('⚠️ Stage change history recording was skipped (likely duplicate)');
    }
  } catch (recordError) {
    console.error('❌ Error recording stage change history:', recordError);
    // Don't throw - we want the stage update to succeed even if history recording fails
    // But log it prominently so we can debug
  }
  
  // Trigger celebration if stage is 60 (Client signed agreement)
  // Pass the actor so celebration shows the currently signed-in user
  try {
    await triggerCelebrationIfNeeded(lead, resolvedStageId, stageActor);
  } catch (celebrationError) {
    console.error('❌ Error triggering celebration:', celebrationError);
    // Don't throw - celebration is non-critical
  }
};

/**
 * Retrieves the most recent stage that occurred before the specified target stage
 * (defaults to stage ID 91 - unactivated) for the given lead.
 */
export const getLatestStageBeforeStage = async (
  lead: CombinedLead,
  targetStageId: number = 91
): Promise<number | null> => {
  const { isLegacy, recordId } = getLeadIdentity(lead);

  let eqValue: number | string | null;
  if (isLegacy) {
    if (typeof recordId === 'number') {
      eqValue = recordId;
    } else {
      eqValue = toNumeric(String(recordId));
    }
  } else {
    eqValue = typeof recordId === 'string' ? recordId : String(recordId);
  }

  if (eqValue === null || eqValue === undefined) {
    console.warn('Unable to resolve lead identity for stage history lookup', { lead, recordId });
    return null;
  }

  const column = isLegacy ? 'lead_id' : 'newlead_id';

  try {
    const { data, error } = await supabase
      .from('leads_leadstage')
      .select('stage, cdate')
      .eq(column, eqValue)
      .order('cdate', { ascending: true })
      .limit(500);

    if (error) {
      console.error('Error fetching stage history for lead:', { error, leadId: eqValue, column });
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    let previousStage: number | null = null;
    let stageBeforeTarget: number | null = null;

    for (const entry of data) {
      const stageValue = toNumeric((entry as any).stage);
      if (stageValue === null) {
        continue;
      }

      if (stageValue === targetStageId) {
        stageBeforeTarget = previousStage;
      }

      previousStage = stageValue;
    }

    return stageBeforeTarget ?? previousStage ?? null;
  } catch (error) {
    console.error('Exception while fetching stage history:', error);
    return null;
  }
};

