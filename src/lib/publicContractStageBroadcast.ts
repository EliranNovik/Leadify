import { supabase } from './supabase';

export const PUBLIC_CONTRACT_STAGE_CHANNEL = 'public-contract-signed';
export const PUBLIC_CONTRACT_STAGE_EVENT = 'lead-stage';

export type PublicContractStagePayload = {
  stage: number;
  leadId?: string;
  legacyId?: number | string | null;
  newLeadId?: string | null;
};

function matchesOpenLead(openId: string, payload: PublicContractStagePayload): boolean {
  const id = String(openId);
  const leadId = String(payload.leadId ?? '');
  const legacyId = payload.legacyId == null ? '' : String(payload.legacyId);
  const newLeadId = String(payload.newLeadId ?? '').toLowerCase();
  if (leadId && leadId === id) return true;
  if (id.startsWith('legacy_') && legacyId && id.replace(/^legacy_/, '') === legacyId) return true;
  if (newLeadId && newLeadId === id.toLowerCase()) return true;
  return false;
}

export function openLeadMatchesPublicContractStage(openId: string, payload: PublicContractStagePayload): boolean {
  return matchesOpenLead(openId, payload);
}

/** Notify the open CRM tab that a public (often anon) sign wrote a new stage. */
export async function broadcastPublicContractStage(payload: PublicContractStagePayload): Promise<void> {
  const channel = supabase.channel(PUBLIC_CONTRACT_STAGE_CHANNEL);
  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(() => resolve(), 1200);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        window.clearTimeout(timer);
        resolve();
      }
    });
  });
  const leadId =
    payload.leadId ||
    (payload.legacyId != null && String(payload.legacyId) !== ''
      ? `legacy_${payload.legacyId}`
      : String(payload.newLeadId || ''));
  await channel.send({
    type: 'broadcast',
    event: PUBLIC_CONTRACT_STAGE_EVENT,
    payload: { ...payload, leadId, stage: payload.stage },
  });
  void supabase.removeChannel(channel);
}
