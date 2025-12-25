/**
 * Helper function to trigger stage evaluation after any interaction is saved
 * 
 * This is a convenience wrapper that can be called from anywhere after saving
 * an interaction (email, WhatsApp, call, manual interaction).
 * 
 * It automatically determines the lead ID and type from the saved interaction.
 */

import { evaluateAndUpdateStage } from './stageTransitionLogic';

/**
 * Trigger stage evaluation after an email is saved
 * 
 * @param clientId - UUID for new leads, or null for legacy leads
 * @param legacyId - Numeric ID for legacy leads, or null for new leads
 */
export async function triggerStageEvaluationAfterEmail(
  clientId: string | null,
  legacyId: number | null
): Promise<void> {
  if (!clientId && !legacyId) {
    console.warn('⚠️ [Stage Transition] No client_id or legacy_id provided for stage evaluation');
    return;
  }

  const isLegacyLead = !!legacyId;
  const leadId = isLegacyLead ? `legacy_${legacyId}` : (clientId || '');

  if (!leadId) {
    console.warn('⚠️ [Stage Transition] Could not determine lead ID for stage evaluation');
    return;
  }

  try {
    console.log('🔍 [Stage Transition Helper] Triggering evaluation after email save:', { clientId, legacyId, leadId, isLegacyLead });
    await evaluateAndUpdateStage(leadId, isLegacyLead, 1500); // Wait 1.5s for backend to save
  } catch (error) {
    console.error('❌ [Stage Transition Helper] Error evaluating stage after email:', error);
  }
}

/**
 * Trigger stage evaluation after a WhatsApp message is saved
 * 
 * @param leadId - UUID for new leads, or null for legacy leads
 * @param legacyId - Numeric ID for legacy leads, or null for new leads
 */
export async function triggerStageEvaluationAfterWhatsApp(
  leadId: string | null,
  legacyId: number | null
): Promise<void> {
  if (!leadId && !legacyId) {
    console.warn('⚠️ [Stage Transition] No lead_id or legacy_id provided for stage evaluation');
    return;
  }

  const isLegacyLead = !!legacyId;
  const leadIdForEvaluation = isLegacyLead ? `legacy_${legacyId}` : (leadId || '');

  if (!leadIdForEvaluation) {
    console.warn('⚠️ [Stage Transition] Could not determine lead ID for stage evaluation');
    return;
  }

  try {
    console.log('🔍 [Stage Transition Helper] Triggering evaluation after WhatsApp save:', { leadId, legacyId, leadIdForEvaluation, isLegacyLead });
    await evaluateAndUpdateStage(leadIdForEvaluation, isLegacyLead, 1000);
  } catch (error) {
    console.error('❌ [Stage Transition Helper] Error evaluating stage after WhatsApp:', error);
  }
}

/**
 * Trigger stage evaluation after a manual interaction is saved
 * 
 * @param leadId - UUID for new leads, or "legacy_<number>" for legacy leads
 * @param isLegacyLead - Whether this is a legacy lead
 */
export async function triggerStageEvaluationAfterManualInteraction(
  leadId: string,
  isLegacyLead: boolean
): Promise<void> {
  if (!leadId) {
    console.warn('⚠️ [Stage Transition] No lead ID provided for stage evaluation');
    return;
  }

  try {
    console.log('🔍 [Stage Transition Helper] Triggering evaluation after manual interaction save:', { leadId, isLegacyLead });
    await evaluateAndUpdateStage(leadId, isLegacyLead, 500); // Manual interactions are saved directly, less delay needed
  } catch (error) {
    console.error('❌ [Stage Transition Helper] Error evaluating stage after manual interaction:', error);
  }
}

/**
 * Trigger stage evaluation after a call is logged
 * 
 * @param leadId - Numeric ID for legacy leads, or UUID for new leads (from call_logs.lead_id)
 * @param isLegacyLead - Whether this is a legacy lead (call_logs.lead_id is numeric)
 */
export async function triggerStageEvaluationAfterCall(
  leadId: string | number | null,
  isLegacyLead: boolean
): Promise<void> {
  if (!leadId) {
    console.warn('⚠️ [Stage Transition] No lead ID provided for stage evaluation');
    return;
  }

  const leadIdForEvaluation = isLegacyLead ? `legacy_${leadId}` : String(leadId);

  try {
    console.log('🔍 [Stage Transition Helper] Triggering evaluation after call log save:', { leadId, leadIdForEvaluation, isLegacyLead });
    await evaluateAndUpdateStage(leadIdForEvaluation, isLegacyLead, 1000);
  } catch (error) {
    console.error('❌ [Stage Transition Helper] Error evaluating stage after call:', error);
  }
}

