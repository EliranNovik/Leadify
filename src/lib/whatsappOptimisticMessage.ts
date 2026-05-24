import type { WhatsAppTemplate } from './whatsappTemplates';

export type OutgoingWhatsAppMessageDraft = {
  id: number;
  lead_id?: string | number | null;
  sender_id?: string;
  sender_name: string;
  direction: 'out';
  message: string;
  sent_at: string;
  status: string;
  message_type: 'text';
  whatsapp_status?: 'sent' | 'delivered' | 'read' | 'failed';
  whatsapp_message_id?: string;
  template_id?: number;
  contact_id?: number | null;
  phone_number?: string | null;
};

/** Negative numeric ids mark optimistic rows until the server confirms. */
export function isOptimisticWhatsAppMessage(msg: {
  id?: number;
  whatsapp_message_id?: string | null;
}): boolean {
  if (typeof msg.id === 'number' && msg.id < 0) return true;
  return Boolean(msg.whatsapp_message_id?.startsWith('pending-'));
}

export function resolveOutgoingTemplateDisplayMessage(
  template: WhatsAppTemplate,
  filledContent: string | null | undefined,
  newMessageText: string,
): string {
  const payloadText = (filledContent || '').trim();
  if (
    payloadText &&
    !payloadText.includes('TEMPLATE_MARKER:') &&
    !payloadText.startsWith('[Template:')
  ) {
    return payloadText;
  }

  const templateContent = (template.content || '').trim();
  if (templateContent) return templateContent;

  const typed = newMessageText.trim();
  if (typed) return typed;

  return `Template: ${template.title}`;
}

export function createOptimisticOutgoingWhatsAppMessage(
  draft: Omit<OutgoingWhatsAppMessageDraft, 'id' | 'direction' | 'status' | 'message_type'> & {
    message: string;
  },
): OutgoingWhatsAppMessageDraft {
  const now = Date.now();
  return {
    id: -now,
    direction: 'out',
    status: 'sent',
    message_type: 'text',
    whatsapp_status: 'sent',
    whatsapp_message_id: `pending-${now}`,
    ...draft,
  };
}

export function sortWhatsAppMessagesBySentAt<T extends { sent_at: string }>(messages: T[]): T[] {
  return [...messages].sort(
    (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime(),
  );
}

export function mergeWhatsAppMessagesWithPendingOutgoing<T extends {
  id?: number;
  direction?: string;
  sent_at: string;
  whatsapp_message_id?: string | null;
  message?: string;
}>(fetched: T[], previous: T[]): T[] {
  const fetchedWaIds = new Set(
    fetched
      .map((m) => m.whatsapp_message_id)
      .filter((id): id is string => Boolean(id)),
  );

  const pendingFromPrevious = previous.filter((m) => {
    if (m.direction !== 'out') return false;

    if (isOptimisticWhatsAppMessage(m)) return true;

    if (m.whatsapp_message_id && !fetchedWaIds.has(m.whatsapp_message_id)) {
      const ageMs = Date.now() - new Date(m.sent_at).getTime();
      return ageMs < 120_000;
    }

    return false;
  });

  const merged = [...fetched, ...pendingFromPrevious];
  const deduped: T[] = [];
  const seenWaIds = new Set<string>();
  const seenLocalIds = new Set<number>();

  for (let i = merged.length - 1; i >= 0; i -= 1) {
    const msg = merged[i];
    const waId = msg.whatsapp_message_id;

    if (waId) {
      if (seenWaIds.has(waId)) continue;
      seenWaIds.add(waId);
      deduped.unshift(msg);
      continue;
    }

    if (typeof msg.id === 'number') {
      if (seenLocalIds.has(msg.id)) continue;
      seenLocalIds.add(msg.id);
    }

    deduped.unshift(msg);
  }

  return sortWhatsAppMessagesBySentAt(deduped);
}

export function applyWhatsAppFetchedMessages<T extends {
  id?: number;
  direction?: string;
  sent_at: string;
  whatsapp_message_id?: string | null;
  message?: string;
  whatsapp_status?: string;
}>(fetched: T[], previous: T[], isPolling: boolean): T[] {
  const merged = mergeWhatsAppMessagesWithPendingOutgoing(fetched, previous);
  if (!isPolling) return merged;

  const hasChanges =
    merged.length !== previous.length ||
    merged.some((msg, index) => {
      const prev = previous[index];
      return (
        !prev ||
        msg.id !== prev.id ||
        msg.message !== prev.message ||
        msg.whatsapp_status !== prev.whatsapp_status
      );
    });

  return hasChanges ? merged : previous;
}
