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
}) => {
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
    payload.lead_id = typeof recordId === 'number' ? recordId : toNumeric(String(recordId));
  } else {
    payload.newlead_id = typeof recordId === 'string' ? recordId : String(recordId);
  }

  const { error } = await supabase.from('leads_leadstage').insert(payload);

  if (error) {
    // Handle duplicate key error gracefully (code 23505)
    // This can happen if the same stage change is recorded twice
    if (error.code === '23505') {
      console.warn('Duplicate stage change record detected, skipping insert:', {
        error,
        payload,
        stage,
        resolvedStageId,
      });
      // Don't throw - this is not a critical error
      return;
    }
    
    console.error('Error recording lead stage change:', {
      error,
      payload,
      stage,
      resolvedStageId,
    });
    throw error;
  }
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
 */
const triggerCelebrationIfNeeded = async (lead: CombinedLead, resolvedStageId: number | null) => {
  // Check if stage is 60 (Client signed agreement)
  if (resolvedStageId !== 60) return;
  
  try {
    // Get closer information
    let closerEmployeeId: number | null = null;
    let closerName: string | null = null;
    
    const isLegacy = lead.lead_type === 'legacy' || lead.id?.toString().startsWith('legacy_');
    
    // First, try to get creator_id from the most recent stage change for this lead
    let creatorId: number | null = null;
    const isLegacyForQuery = lead.lead_type === 'legacy' || lead.id?.toString().startsWith('legacy_');
    let stageHistoryQuery = supabase
      .from('leads_leadstage')
      .select('creator_id')
      .order('date', { ascending: false })
      .limit(1);
    
    if (isLegacyForQuery) {
      const legacyId = typeof lead.id === 'string' && lead.id.startsWith('legacy_')
        ? parseInt(lead.id.replace('legacy_', ''), 10)
        : typeof lead.id === 'number' ? lead.id : null;
      if (legacyId) {
        stageHistoryQuery = stageHistoryQuery.eq('lead_id', legacyId);
      }
    } else {
      stageHistoryQuery = stageHistoryQuery.eq('newlead_id', lead.id);
    }
    
    const { data: stageHistory } = await stageHistoryQuery.single();
    if (stageHistory?.creator_id) {
      creatorId = stageHistory.creator_id;
    }
    
    // If creator_id exists, use it
    if (creatorId) {
      closerEmployeeId = creatorId;
      closerName = await getEmployeeDisplayNameById(closerEmployeeId);
    }
    
    // If creator_id is empty, use the closer from the lead
    if (!closerName) {
      if (isLegacy) {
        // For legacy leads, get closer_id from lead data or query
        const closerId = (lead as any).closer_id;
        if (closerId) {
          closerEmployeeId = typeof closerId === 'number' ? closerId : parseInt(String(closerId), 10);
          closerName = await getEmployeeDisplayNameById(closerEmployeeId);
        } else {
          // Query if not in lead data
          const legacyId = typeof lead.id === 'string' && lead.id.startsWith('legacy_')
            ? parseInt(lead.id.replace('legacy_', ''), 10)
            : typeof lead.id === 'number' ? lead.id : null;
          
          if (legacyId) {
            const { data: legacyLead } = await supabase
              .from('leads_lead')
              .select('closer_id')
              .eq('id', legacyId)
              .single();
            
            if (legacyLead?.closer_id) {
              closerEmployeeId = legacyLead.closer_id;
              closerName = await getEmployeeDisplayNameById(closerEmployeeId);
            }
          }
        }
      } else {
        // For new leads, get closer (string) from lead data
        const closerString = (lead as any).closer;
        if (closerString && closerString.trim() && closerString !== '---') {
          closerName = closerString;
          // Try to find employee ID by name
          const { data: employee } = await supabase
            .from('tenants_employee')
            .select('id')
            .eq('display_name', closerString)
            .single();
          if (employee) {
            closerEmployeeId = employee.id;
          }
        } else {
          // If closer is not in lead data, query it
          const { data: newLead } = await supabase
            .from('leads')
            .select('closer')
            .eq('id', lead.id)
            .single();
          
          if (newLead?.closer && newLead.closer.trim() && newLead.closer !== '---') {
            closerName = newLead.closer;
            // Try to find employee ID by name
            const { data: employee } = await supabase
              .from('tenants_employee')
              .select('id')
              .eq('display_name', newLead.closer)
              .single();
            if (employee) {
              closerEmployeeId = employee.id;
            }
          }
        }
      }
    }
    
    // Trigger celebration via custom event (since we can't directly access context here)
    if (closerName) {
      // Use setTimeout to ensure the event is dispatched after the DOM is ready
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('celebrate-contract-signed', {
          detail: {
            employeeName: closerName,
            employeeId: closerEmployeeId,
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

  const { error } = await supabase
    .from(tableName)
    .update(updatePayload)
    .eq('id', recordId);

  if (error) {
    console.error('Error updating lead stage:', { error, tableName, recordId, updatePayload });
    throw error;
  }

  await recordLeadStageChange({ lead, stage, actor: stageActor, timestamp: effectiveTimestamp });
  
  // Trigger celebration if stage is 60 (Client signed agreement)
  await triggerCelebrationIfNeeded(lead, resolvedStageId);
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

