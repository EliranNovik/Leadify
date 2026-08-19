import type { SupabaseClient } from '@supabase/supabase-js';

export const PINNED_INTERACTIONS_CHANGED_EVENT = 'lead:pinned-interactions-changed';
export const SCROLL_TO_PINNED_INTERACTION_EVENT = 'lead:scroll-to-pinned-interaction';

export type PinnedInteractionChannel = 'email' | 'whatsapp';

export type LeadPinnedIdentity = {
  newLeadId?: string | null;
  legacyLeadId?: number | null;
};

export function displayNameNotEmail(
  raw: string | null | undefined,
  fallback?: string | null,
): string {
  const fromValue = (value: string | null | undefined): string => {
    const s = String(value || '').trim();
    if (!s) return '';
    const angled = s.match(/^(?:"?([^"<]*)"?\s*)<([^>]+@[^>]+)>$/);
    if (angled) {
      const name = (angled[1] || '').trim();
      if (name && !name.includes('@')) return name;
    }
    if (!s.includes('@')) return s;
    return '';
  };
  return fromValue(raw) || fromValue(fallback) || '';
}

export type LeadPinnedInteractionRow = {
  id: string;
  new_lead_id: string | null;
  legacy_lead_id: number | null;
  channel: PinnedInteractionChannel;
  external_id: string;
  subject: string | null;
  preview: string | null;
  direction: 'in' | 'out' | null;
  party_name: string | null;
  occurred_at: string | null;
  pinned_by: string | null;
  pinned_by_name: string | null;
  pinned_at: string;
};

export type PinInteractionInput = {
  channel: PinnedInteractionChannel;
  externalId: string;
  subject?: string | null;
  preview?: string | null;
  direction?: 'in' | 'out' | null;
  partyName?: string | null;
  occurredAt?: string | null;
  pinnedBy: string;
  pinnedByName?: string | null;
};

export function pinnedInteractionKey(channel: string, externalId: string): string {
  return `${channel}\t${externalId}`;
}

export function resolveLeadPinnedIdentity(client: {
  id?: string | number | null;
  lead_type?: string | null;
}): LeadPinnedIdentity | null {
  if (client?.id == null || String(client.id).trim() === '') return null;
  const isLegacy =
    client.lead_type === 'legacy' || String(client.id).startsWith('legacy_');
  if (isLegacy) {
    const legacyLeadId = Number.parseInt(String(client.id).replace(/^legacy_/, ''), 10);
    if (!Number.isFinite(legacyLeadId)) return null;
    return { newLeadId: null, legacyLeadId };
  }
  return { newLeadId: String(client.id), legacyLeadId: null };
}

export function previewTextFromInteractionContent(
  htmlOrText: string | null | undefined,
  max = 280,
): string {
  const raw = String(htmlOrText || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return '';
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max)}…`;
}

export function dispatchPinnedInteractionsChanged(leadKey?: string | number | null): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(PINNED_INTERACTIONS_CHANGED_EVENT, {
      detail: { leadKey: leadKey != null ? String(leadKey) : null },
    }),
  );
}

export function dispatchScrollToPinnedInteraction(
  channel: PinnedInteractionChannel,
  externalId: string,
): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(SCROLL_TO_PINNED_INTERACTION_EVENT, {
      detail: { channel, externalId },
    }),
  );
}

function applyLeadFilter(query: any, identity: LeadPinnedIdentity) {
  if (identity.newLeadId) {
    return query.eq('new_lead_id', identity.newLeadId);
  }
  if (identity.legacyLeadId != null) {
    return query.eq('legacy_lead_id', identity.legacyLeadId);
  }
  return query;
}

const PIN_SELECT =
  'id, new_lead_id, legacy_lead_id, channel, external_id, subject, preview, direction, party_name, occurred_at, pinned_by, pinned_by_name, pinned_at';

function mapPinRow(row: any): LeadPinnedInteractionRow {
  return {
    id: String(row.id),
    new_lead_id: row.new_lead_id ?? null,
    legacy_lead_id: row.legacy_lead_id != null ? Number(row.legacy_lead_id) : null,
    channel: row.channel === 'whatsapp' ? 'whatsapp' : 'email',
    external_id: String(row.external_id || ''),
    subject: row.subject ?? null,
    preview: row.preview ?? null,
    direction: row.direction === 'in' || row.direction === 'out' ? row.direction : null,
    party_name: displayNameNotEmail(row.party_name) || null,
    occurred_at: row.occurred_at ?? null,
    pinned_by: row.pinned_by ?? null,
    pinned_by_name: row.pinned_by_name ?? null,
    pinned_at: row.pinned_at,
  };
}

export async function fetchLeadPinnedInteractions(
  supabase: SupabaseClient,
  identity: LeadPinnedIdentity,
): Promise<LeadPinnedInteractionRow[]> {
  if (!identity.newLeadId && identity.legacyLeadId == null) return [];
  const runSelect = (columns: string) => {
    let query = supabase
      .from('lead_pinned_interactions')
      .select(columns)
      .order('pinned_at', { ascending: false });
    return applyLeadFilter(query, identity);
  };
  let { data, error } = await runSelect(PIN_SELECT);
  if (error && /party_name/i.test(error.message || '')) {
    ({ data, error } = await runSelect(
      'id, new_lead_id, legacy_lead_id, channel, external_id, subject, preview, direction, occurred_at, pinned_by, pinned_by_name, pinned_at',
    ));
  }
  if (error) {
    console.warn('leadPinnedInteractions: fetch failed', error);
    return [];
  }
  const rows = (data || []).map(mapPinRow).filter((row) => row.external_id);
  const emailsMissingName = rows.filter(
    (row) => row.channel === 'email' && !row.party_name && row.external_id,
  );
  if (emailsMissingName.length > 0) {
    const ids = emailsMissingName.map((row) => row.external_id);
    const nameById = new Map<string, string>();
    const addEmailName = (email: {
      id?: string | number | null;
      message_id?: string | null;
      sender_name?: string | null;
      sender_email?: string | null;
      sender_display_name?: string | null;
    }) => {
      const name = displayNameNotEmail(
        email.sender_display_name || email.sender_name,
        email.sender_email,
      );
      if (!name) return;
      if (email.message_id) nameById.set(String(email.message_id), name);
      if (email.id != null) nameById.set(String(email.id), name);
    };
    const { data: byMessageId } = await supabase
      .from('emails')
      .select('id, message_id, sender_name, sender_email')
      .in('message_id', ids);
    (byMessageId || []).forEach(addEmailName);
    // emails.id is bigint — Graph/Outlook ids (AAMk…) must not be sent as id=.
    const numericIds = ids
      .map((raw) => String(raw).trim())
      .filter((raw) => /^\d+$/.test(raw))
      .map((raw) => Number(raw));
    if (numericIds.length > 0) {
      const { data: byRowId } = await supabase
        .from('emails')
        .select('id, message_id, sender_name, sender_email')
        .in('id', numericIds);
      (byRowId || []).forEach(addEmailName);
    }
    for (const row of rows) {
      if (row.channel !== 'email' || row.party_name) continue;
      row.party_name = nameById.get(row.external_id) || null;
    }
  }
  const waMissingName = rows.filter(
    (row) => row.channel === 'whatsapp' && !row.party_name && row.external_id,
  );
  if (waMissingName.length > 0) {
    const ids = waMissingName
      .map((row) => String(row.external_id).trim())
      .filter((raw) => /^\d+$/.test(raw))
      .map((raw) => Number(raw));
    if (ids.length === 0) {
      return rows;
    }
    const { data: waRows } = await supabase
      .from('whatsapp_messages')
      .select('id, sender_name')
      .in('id', ids);
    const nameById = new Map<string, string>();
    for (const msg of waRows || []) {
      const name = displayNameNotEmail(msg.sender_name);
      if (name && msg.id != null) nameById.set(String(msg.id), name);
    }
    for (const row of rows) {
      if (row.channel !== 'whatsapp' || row.party_name) continue;
      row.party_name = nameById.get(row.external_id) || null;
    }
  }
  return rows;
}

export async function pinLeadInteraction(
  supabase: SupabaseClient,
  identity: LeadPinnedIdentity,
  input: PinInteractionInput,
): Promise<{ error: string | null }> {
  const externalId = String(input.externalId || '').trim();
  if (!externalId) return { error: 'Missing interaction id' };
  if (!identity.newLeadId && identity.legacyLeadId == null) {
    return { error: 'Missing lead' };
  }

  const { error } = await supabase.from('lead_pinned_interactions').insert({
    new_lead_id: identity.newLeadId || null,
    legacy_lead_id: identity.legacyLeadId ?? null,
    channel: input.channel,
    external_id: externalId,
    subject: input.subject?.trim() || null,
    preview: input.preview?.trim() || null,
    direction: input.direction === 'in' || input.direction === 'out' ? input.direction : null,
    party_name: displayNameNotEmail(input.partyName) || null,
    occurred_at: input.occurredAt || null,
    pinned_by: input.pinnedBy,
    pinned_by_name: input.pinnedByName?.trim() || null,
  });

  if (error) {
    if (error.code === '23505') return { error: null };
    console.warn('leadPinnedInteractions: pin failed', error);
    if (/lead_pinned_interactions/i.test(error.message || '') && /does not exist|schema cache/i.test(error.message || '')) {
      return { error: 'Saved interactions require the DB migration (sql/2026-08-19_lead_pinned_interactions.sql).' };
    }
    return { error: error.message || 'Could not save interaction' };
  }
  return { error: null };
}

export async function unpinLeadInteraction(
  supabase: SupabaseClient,
  identity: LeadPinnedIdentity,
  channel: PinnedInteractionChannel,
  externalId: string,
): Promise<{ error: string | null }> {
  const id = String(externalId || '').trim();
  if (!id) return { error: 'Missing interaction id' };
  let query = supabase
    .from('lead_pinned_interactions')
    .delete()
    .eq('channel', channel)
    .eq('external_id', id);
  query = applyLeadFilter(query, identity);
  const { error } = await query;
  if (error) {
    console.warn('leadPinnedInteractions: unpin failed', error);
    return { error: error.message || 'Could not remove saved interaction' };
  }
  return { error: null };
}

export async function unpinLeadInteractionById(
  supabase: SupabaseClient,
  pinId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('lead_pinned_interactions').delete().eq('id', pinId);
  if (error) {
    console.warn('leadPinnedInteractions: unpin by id failed', error);
    return { error: error.message || 'Could not remove saved interaction' };
  }
  return { error: null };
}
