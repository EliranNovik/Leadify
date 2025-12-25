import { supabase } from './supabase';

/**
 * Stage Transition Logic for Communication Stages
 * 
 * Stage 11 (Precommunication): 
 * - Triggered when any communication/interaction is initiated but no response received
 * - Only applies if current stage is 0 or 10
 * 
 * Stage 15 (Communication Started):
 * - Triggered when bidirectional communication exists with a call over 2 minutes
 * - Only applies if current stage is 0, 10, or 11
 */

interface InteractionSummary {
  hasOutbound: boolean;
  hasInbound: boolean;
  hasCallOver2Min: boolean;
  hasAnyInteraction: boolean;
}

const PRECOMMUNICATION_STAGE_ID = 11;
const COMMUNICATION_STARTED_STAGE_ID = 15;

/**
 * Check if a lead should transition to stage 11 (Precommunication)
 * 
 * Conditions:
 * - Any communication/interaction record exists (email, WhatsApp, call, or manual)
 * - Only one direction communicated (outbound OR inbound, but not both)
 * - For calls: duration must be under 2 minutes
 * - Current stage must be 0 or 10
 */
export async function shouldTransitionToPrecommunication(
  leadId: string,
  isLegacyLead: boolean,
  currentStage: number | null
): Promise<boolean> {
  console.log('🔍 [Stage Transition] Checking Precommunication (11):', {
    leadId,
    isLegacyLead,
    currentStage,
  });

  // Only transition if current stage is 0 or 10
  if (currentStage !== 0 && currentStage !== 10) {
    console.log('❌ [Stage Transition] Current stage is not 0 or 10, skipping Precommunication check');
    return false;
  }

  const summary = await getInteractionSummary(leadId, isLegacyLead);
  console.log('📊 [Stage Transition] Interaction Summary:', summary);

  // Must have at least one interaction
  if (!summary.hasAnyInteraction) {
    console.log('❌ [Stage Transition] No interactions found');
    return false;
  }

  // Must have ONLY one direction (outbound OR inbound, but not both)
  const hasOnlyOneDirection = (summary.hasOutbound && !summary.hasInbound) || 
                              (!summary.hasOutbound && summary.hasInbound);

  console.log('🔍 [Stage Transition] Has only one direction?', hasOnlyOneDirection, {
    hasOutbound: summary.hasOutbound,
    hasInbound: summary.hasInbound,
  });

  if (!hasOnlyOneDirection) {
    console.log('❌ [Stage Transition] Both directions exist, skipping Precommunication');
    return false;
  }

  // If there's a call, it must be under 2 minutes
  // We check this by ensuring no call over 2 minutes exists
  if (summary.hasCallOver2Min) {
    console.log('❌ [Stage Transition] Call over 2 minutes exists, skipping Precommunication');
    return false;
  }

  console.log('✅ [Stage Transition] Should transition to Precommunication (11)');
  return true;
}

/**
 * Check if a lead should transition to stage 15 (Communication Started)
 * 
 * Conditions:
 * - Must have both outbound AND inbound interactions
 * - Must have at least one call over 2 minutes duration
 * - Current stage must be 0, 10, or 11
 */
export async function shouldTransitionToCommunicationStarted(
  leadId: string,
  isLegacyLead: boolean,
  currentStage: number | null
): Promise<boolean> {
  // Only transition if current stage is 0, 10, or 11
  if (currentStage !== 0 && currentStage !== 10 && currentStage !== 11) {
    return false;
  }

  const summary = await getInteractionSummary(leadId, isLegacyLead);

  // Must have both outbound and inbound interactions
  if (!summary.hasOutbound || !summary.hasInbound) {
    return false;
  }

  // Must have at least one call over 2 minutes
  if (!summary.hasCallOver2Min) {
    return false;
  }

  return true;
}

/**
 * Get summary of interactions for a lead
 */
async function getInteractionSummary(
  leadId: string,
  isLegacyLead: boolean
): Promise<InteractionSummary> {
  const summary: InteractionSummary = {
    hasOutbound: false,
    hasInbound: false,
    hasCallOver2Min: false,
    hasAnyInteraction: false,
  };

  if (isLegacyLead) {
    await checkLegacyInteractions(leadId, summary);
  } else {
    await checkNewLeadInteractions(leadId, summary);
  }

  return summary;
}

/**
 * Check interactions for legacy leads
 */
async function checkLegacyInteractions(
  leadId: string,
  summary: InteractionSummary
): Promise<void> {
  const numericId = parseInt(leadId.replace('legacy_', ''), 10);
  if (Number.isNaN(numericId)) {
    return;
  }

  // Check emails
  const { data: emails } = await supabase
    .from('emails')
    .select('direction')
    .eq('legacy_id', numericId);

  if (emails && emails.length > 0) {
    summary.hasAnyInteraction = true;
    emails.forEach((email: any) => {
      if (email.direction === 'outgoing') {
        summary.hasOutbound = true;
      } else if (email.direction === 'incoming') {
        summary.hasInbound = true;
      }
    });
  }

  // Check WhatsApp messages
  const { data: whatsappMessages } = await supabase
    .from('whatsapp_messages')
    .select('direction')
    .eq('legacy_id', numericId);

  if (whatsappMessages && whatsappMessages.length > 0) {
    summary.hasAnyInteraction = true;
    whatsappMessages.forEach((msg: any) => {
      if (msg.direction === 'out') {
        summary.hasOutbound = true;
      } else if (msg.direction === 'in') {
        summary.hasInbound = true;
      }
    });
  }

  // Check leads_leadinteractions (calls, emails, WhatsApp, manual)
  const { data: interactions } = await supabase
    .from('leads_leadinteractions')
    .select('direction, kind, minutes')
    .eq('lead_id', numericId);

  if (interactions && interactions.length > 0) {
    summary.hasAnyInteraction = true;
    interactions.forEach((interaction: any) => {
      const direction = interaction.direction;
      const kind = interaction.kind;
      const minutes = interaction.minutes || 0;

      // Check direction
      if (direction === 'o') {
        summary.hasOutbound = true;
      } else if (direction === 'i') {
        summary.hasInbound = true;
      }

      // Check for calls over 2 minutes
      if (kind === 'c' && minutes > 2) {
        summary.hasCallOver2Min = true;
      }
    });
  }

  // Check call_logs for legacy leads
  const { data: callLogs } = await supabase
    .from('call_logs')
    .select('direction, duration')
    .eq('lead_id', numericId);

  if (callLogs && callLogs.length > 0) {
    summary.hasAnyInteraction = true;
    callLogs.forEach((call: any) => {
      const duration = call.duration || 0; // duration in seconds
      const direction = call.direction?.toLowerCase() || '';

      // Check direction
      if (direction.includes('outgoing') || direction === 'out') {
        summary.hasOutbound = true;
      } else if (direction.includes('incoming') || direction === 'in') {
        summary.hasInbound = true;
      }

      // Check for calls over 2 minutes (120 seconds)
      if (duration > 120) {
        summary.hasCallOver2Min = true;
      }
    });
  }
}

/**
 * Check interactions for new leads
 */
async function checkNewLeadInteractions(
  leadId: string,
  summary: InteractionSummary
): Promise<void> {
  console.log('🔍 [Stage Transition] Checking new lead interactions for:', leadId);

  // Check emails - for new leads, use client_id (UUID)
  const { data: emails, error: emailError } = await supabase
    .from('emails')
    .select('direction, client_id, legacy_id')
    .eq('client_id', leadId);

  if (emailError) {
    console.error('❌ [Stage Transition] Error fetching emails:', emailError);
  } else {
    console.log('📧 [Stage Transition] Found emails:', emails?.length || 0, emails);
    if (emails && emails.length > 0) {
      console.log('📧 [Stage Transition] Email details:', emails.map(e => ({ direction: e.direction, client_id: e.client_id, legacy_id: e.legacy_id })));
    }
  }

  if (emails && emails.length > 0) {
    summary.hasAnyInteraction = true;
    emails.forEach((email: any) => {
      if (email.direction === 'outgoing') {
        summary.hasOutbound = true;
        console.log('📤 [Stage Transition] Found outgoing email');
      } else if (email.direction === 'incoming') {
        summary.hasInbound = true;
        console.log('📥 [Stage Transition] Found incoming email');
      }
    });
  }

  // Check WhatsApp messages
  const { data: whatsappMessages } = await supabase
    .from('whatsapp_messages')
    .select('direction')
    .eq('lead_id', leadId);

  if (whatsappMessages && whatsappMessages.length > 0) {
    summary.hasAnyInteraction = true;
    whatsappMessages.forEach((msg: any) => {
      if (msg.direction === 'out') {
        summary.hasOutbound = true;
      } else if (msg.direction === 'in') {
        summary.hasInbound = true;
      }
    });
  }

  // Check call_logs
  // Note: call_logs.lead_id is BIGINT and only stores legacy lead IDs
  // For new leads, skip this query as call_logs doesn't support UUID lead_ids
  // New leads' call data would be in manual_interactions or not in call_logs at all
  // This query is skipped for new leads to avoid type mismatch errors

  // Check manual_interactions from leads table (JSONB array)
  const { data: leadData } = await supabase
    .from('leads')
    .select('manual_interactions')
    .eq('id', leadId)
    .single();

  if (leadData && leadData.manual_interactions) {
    const manualInteractions = leadData.manual_interactions;
    if (Array.isArray(manualInteractions) && manualInteractions.length > 0) {
      summary.hasAnyInteraction = true;
      manualInteractions.forEach((interaction: any) => {
        const direction = interaction.direction;
        const kind = interaction.kind;
        const length = interaction.length || '';

        // Check direction
        if (direction === 'out') {
          summary.hasOutbound = true;
        } else if (direction === 'in') {
          summary.hasInbound = true;
        }

        // Check for calls over 2 minutes
        // Length format might be "5m" or "5 min" or "5:30" or just "5"
        if (kind === 'call' || kind === 'phone') {
          const minutes = parseCallDuration(length);
          if (minutes > 2) {
            summary.hasCallOver2Min = true;
          }
        }
      });
    }
  }
}

/**
 * Parse call duration from various formats
 * Examples: "5m", "5 min", "5:30", "5", "120s"
 */
function parseCallDuration(length: string): number {
  if (!length) return 0;

  const str = length.trim().toLowerCase();

  // Format: "5m" or "5 min"
  const minutesMatch = str.match(/(\d+)\s*(?:min|m)/);
  if (minutesMatch) {
    return parseInt(minutesMatch[1], 10);
  }

  // Format: "5:30" (minutes:seconds)
  const timeMatch = str.match(/(\d+):(\d+)/);
  if (timeMatch) {
    const minutes = parseInt(timeMatch[1], 10);
    const seconds = parseInt(timeMatch[2], 10);
    return minutes + seconds / 60; // Convert to decimal minutes
  }

  // Format: "120s" (seconds)
  const secondsMatch = str.match(/(\d+)\s*s/);
  if (secondsMatch) {
    return parseInt(secondsMatch[1], 10) / 60; // Convert to minutes
  }

  // Format: just a number (assume minutes)
  const numberMatch = str.match(/(\d+)/);
  if (numberMatch) {
    return parseInt(numberMatch[1], 10);
  }

  return 0;
}

/**
 * Evaluate and update stage for a lead based on interaction history
 * 
 * This function queries the database tables directly to check for interactions:
 * - emails table
 * - whatsapp_messages table
 * - call_logs table
 * - leads_leadinteractions table (for legacy leads)
 * - leads.manual_interactions (JSONB array for new leads)
 * 
 * This should be called after any interaction is saved to the database.
 * It will automatically determine if the stage should change based on the current state.
 * 
 * @param leadId - The lead ID (UUID string for new leads, or "legacy_<number>" for legacy leads)
 * @param isLegacyLead - Whether this is a legacy lead
 * @param delayMs - Optional delay in milliseconds to wait before checking (default: 1000ms)
 *                  This ensures the database transaction is committed
 */
export async function evaluateAndUpdateStage(
  leadId: string,
  isLegacyLead: boolean,
  delayMs: number = 1000
): Promise<{ updated: boolean; newStage: number | null }> {
  console.log('🚀 [Stage Transition] Starting evaluation for:', { leadId, isLegacyLead });
  
  // Wait a bit to ensure the database transaction is committed
  if (delayMs > 0) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  
  try {
    // Fetch current stage
    const tableName = isLegacyLead ? 'leads_lead' : 'leads';
    const idField = isLegacyLead ? 'id' : 'id';
    const clientId = isLegacyLead 
      ? parseInt(leadId.replace('legacy_', ''), 10)
      : leadId;

    console.log('🔍 [Stage Transition] Fetching current stage from:', { tableName, idField, clientId });

    const { data: leadData, error: fetchError } = await supabase
      .from(tableName)
      .select('stage')
      .eq(idField, clientId)
      .single();

    if (fetchError || !leadData) {
      console.error('❌ [Stage Transition] Error fetching current stage:', fetchError);
      return { updated: false, newStage: null };
    }

    const currentStage = typeof leadData.stage === 'string' 
      ? parseInt(leadData.stage, 10) 
      : (leadData.stage as number);

    console.log('📊 [Stage Transition] Current stage:', currentStage);

    // Check if should transition to Communication Started (15) first
    // (higher priority - if both conditions are met, prefer 15)
    if (await shouldTransitionToCommunicationStarted(leadId, isLegacyLead, currentStage)) {
      console.log('✅ [Stage Transition] Transitioning to Communication Started (15)');
      const { error: updateError } = await supabase
        .from(tableName)
        .update({ stage: COMMUNICATION_STARTED_STAGE_ID })
        .eq(idField, clientId);

      if (updateError) {
        console.error('❌ [Stage Transition] Error updating stage to 15:', updateError);
        return { updated: false, newStage: null };
      }

      console.log('✅ [Stage Transition] Successfully updated to stage 15');
      return { updated: true, newStage: COMMUNICATION_STARTED_STAGE_ID };
    }

    // Check if should transition to Precommunication (11)
    if (await shouldTransitionToPrecommunication(leadId, isLegacyLead, currentStage)) {
      console.log('✅ [Stage Transition] Transitioning to Precommunication (11)');
      const { error: updateError } = await supabase
        .from(tableName)
        .update({ stage: PRECOMMUNICATION_STAGE_ID })
        .eq(idField, clientId);

      if (updateError) {
        console.error('❌ [Stage Transition] Error updating stage to 11:', updateError);
        return { updated: false, newStage: null };
      }

      console.log('✅ [Stage Transition] Successfully updated to stage 11');
      return { updated: true, newStage: PRECOMMUNICATION_STAGE_ID };
    }

    console.log('ℹ️ [Stage Transition] No stage transition needed');
    return { updated: false, newStage: currentStage };
  } catch (error) {
    console.error('❌ [Stage Transition] Error evaluating stage transition:', error);
    return { updated: false, newStage: null };
  }
}

