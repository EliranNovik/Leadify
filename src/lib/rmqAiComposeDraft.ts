export const RMQ_AI_COMPOSE_DRAFT_KEY = 'rmqAiComposeDraft';
export const RMQ_AI_COMPOSE_DRAFT_EVENT = 'rmq-ai-compose-draft';

export type RmqAiComposeDraft = {
  channel: 'email' | 'whatsapp' | 'sms';
  text: string;
  leadNumber?: string;
  leadId?: string;
  email?: string;
};

export function stashRmqAiComposeDraft(draft: RmqAiComposeDraft) {
  try {
    sessionStorage.setItem(RMQ_AI_COMPOSE_DRAFT_KEY, JSON.stringify(draft));
    window.dispatchEvent(new CustomEvent(RMQ_AI_COMPOSE_DRAFT_EVENT, { detail: draft.channel }));
  } catch {
    /* ignore */
  }
}

export function takeRmqAiComposeDraft(channel?: 'email' | 'whatsapp'): RmqAiComposeDraft | null {
  try {
    const raw = sessionStorage.getItem(RMQ_AI_COMPOSE_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RmqAiComposeDraft;
    if (channel === 'email' && parsed.channel !== 'email') return null;
    if (channel === 'whatsapp' && parsed.channel !== 'whatsapp' && parsed.channel !== 'sms') return null;
    sessionStorage.removeItem(RMQ_AI_COMPOSE_DRAFT_KEY);
    return parsed;
  } catch {
    return null;
  }
}
