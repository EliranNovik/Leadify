export type RmqAiCurrentLead = {
  id?: string | number | null;
  lead_number?: string | null;
  name?: string | null;
  lead_type?: string | null;
  email?: string | null;
  phone?: string | null;
  language?: string | null;
};

export type RmqAiDraftMeta = {
  channel: 'email' | 'whatsapp' | 'sms';
  leadNumber?: string;
  leadId?: string;
  email?: string;
};

let currentLead: RmqAiCurrentLead | null = null;
let lastDraftMeta: RmqAiDraftMeta | null = null;

export function setRmqAiCurrentLead(lead: RmqAiCurrentLead | null) {
  currentLead = lead && (lead.id != null || lead.lead_number) ? lead : null;
}

export function getRmqAiCurrentLead(): RmqAiCurrentLead | null {
  return currentLead;
}

export function currentLeadAsToolArgs(): { query?: string; lead_id?: string; is_legacy?: boolean } {
  if (!currentLead) return {};
  const isLegacy =
    currentLead.lead_type === 'legacy' || String(currentLead.id || '').startsWith('legacy_');
  if (currentLead.id != null && String(currentLead.id).trim() !== '') {
    return {
      lead_id: String(currentLead.id),
      is_legacy: isLegacy,
      query: String(currentLead.lead_number || currentLead.name || '').trim() || undefined,
    };
  }
  if (currentLead.lead_number) return { query: String(currentLead.lead_number) };
  return {};
}

export function describeCurrentLeadForPrompt(): string {
  if (!currentLead) return '';
  const number = currentLead.lead_number ? String(currentLead.lead_number) : '';
  const name = currentLead.name ? String(currentLead.name) : '';
  const id = currentLead.id != null ? String(currentLead.id) : '';
  const bits = [number && `lead ${number}`, name, id && `id ${id}`].filter(Boolean);
  return bits.length
    ? `The user is currently viewing this client in the CRM: ${bits.join(' · ')}. If they say this client / this lead / draft a message without a lead number, use this lead.`
    : '';
}

export function rememberRmqAiDraftMeta(meta: RmqAiDraftMeta) {
  lastDraftMeta = meta;
}

export function takeRmqAiDraftMeta(): RmqAiDraftMeta | null {
  const value = lastDraftMeta;
  lastDraftMeta = null;
  return value;
}
