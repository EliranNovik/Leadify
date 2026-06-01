/** Dispatched after a new email/WhatsApp row is saved so InteractionsTab refetches the timeline. */
export const INTERACTIONS_TIMELINE_INVALIDATE_EVENT = 'crm:interactions-timeline-invalidate';

export function invalidateInteractionsTimeline(leadId: string | number | null | undefined): void {
  if (leadId == null || String(leadId).trim() === '') return;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(INTERACTIONS_TIMELINE_INVALIDATE_EVENT, {
      detail: { leadId: String(leadId) },
    }),
  );
}
