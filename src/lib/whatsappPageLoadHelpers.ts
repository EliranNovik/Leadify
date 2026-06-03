import type { SupabaseClient } from '@supabase/supabase-js';

export const WHATSAPP_MESSAGE_INDEX_SELECT =
  'lead_id, contact_id, legacy_id, phone_number, sent_at, direction, is_read, message, message_type, caption, voice_note, media_filename';

export type WhatsAppMessagePreviewFields = {
  message?: string | null;
  message_type?: string | null;
  caption?: string | null;
  voice_note?: boolean | null;
  media_filename?: string | null;
};

export type WhatsAppLastMessagePreviewEntry = {
  text: string;
  direction?: 'in' | 'out';
  sentAt: string;
};

export function formatWhatsAppMessagePreview(msg: WhatsAppMessagePreviewFields): string {
  const type = String(msg.message_type || 'text').toLowerCase();
  const caption = String(msg.caption || '').trim();
  const body = String(msg.message || '').trim().replace(/\s+/g, ' ');
  const filename = String(msg.media_filename || '').trim();
  let text: string;
  if (type === 'image') text = caption || '📷 Photo';
  else if (type === 'video') text = caption || '🎥 Video';
  else if (type === 'audio' || msg.voice_note) text = '🎤 Voice message';
  else if (type === 'document') text = caption || filename || '📎 Document';
  else if (type === 'location') text = '📍 Location';
  else if (type === 'contact') text = '👤 Contact';
  else if (type === 'button_response' || type === 'list_response') text = body || 'Response';
  else text = body || 'Message';
  if (text.length > 120) return `${text.slice(0, 119)}…`;
  return text;
}

const MESSAGE_PAGE_SIZE = 1000;

/** Paginated lightweight index for building the conversation list (not full message bodies). */
export async function fetchWhatsAppMessageIndex(
  client: SupabaseClient,
): Promise<any[]> {
  const rows: any[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await client
      .from('whatsapp_messages')
      .select(WHATSAPP_MESSAGE_INDEX_SELECT)
      .range(page * MESSAGE_PAGE_SIZE, (page + 1) * MESSAGE_PAGE_SIZE - 1)
      .order('sent_at', { ascending: false });

    if (error) {
      console.error('WhatsApp: message index page error', page, error);
      break;
    }

    if (!data?.length) {
      hasMore = false;
      break;
    }

    rows.push(...data);
    hasMore = data.length >= MESSAGE_PAGE_SIZE;
    page += 1;
  }

  return rows;
}

/** tenants_employee.id is numeric — never pass legacy text/slug role values to .in('id', …). */
export function parseNumericEmployeeIds(values: unknown[]): number[] {
  return [
    ...new Set(
      values
        .map((v) => {
          if (v == null || v === '' || v === '\\N' || v === 'EMPTY') return NaN;
          if (typeof v === 'bigint') return Number(v);
          if (typeof v === 'number') return v;
          const s = String(v).trim();
          if (!/^\d+$/.test(s)) return NaN;
          return Number(s);
        })
        .filter((n): n is number => Number.isFinite(n) && n > 0),
    ),
  ];
}

export function normalizeUuidKey(v: unknown): string {
  return String(v ?? '')
    .trim()
    .replace(/-/g, '')
    .toLowerCase();
}

export function sameNewLeadId(a: unknown, b: unknown): boolean {
  const ka = normalizeUuidKey(a);
  const kb = normalizeUuidKey(b);
  return ka !== '' && ka === kb;
}

export function buildNormalizedNewLeadIdSet(leads: { id?: unknown }[]): Set<string> {
  const s = new Set<string>();
  for (const l of leads) {
    const k = normalizeUuidKey(l?.id);
    if (k) s.add(k);
  }
  return s;
}

export type WhatsAppConversationSummaryRow = {
  entity_type: string;
  entity_id: string;
  legacy_id: number | null;
  last_sent_at: string | null;
  unread_count: number | string | null;
  sort_rank?: number | string | null;
  last_message_preview?: string | null;
  last_message_direction?: string | null;
};

export type WhatsAppConversationEmployeeFilter = {
  employeeId?: number | null;
  employeeName?: string | null;
};

export type WhatsAppConversationIndexState = {
  uniqueLeadIds: Set<string>;
  uniqueContactIds: Set<number>;
  uniqueLegacyIdsFromMessages: Set<number>;
  contactToLegacyIdMap: Map<number, number>;
  unreadByLeadId: Map<string, number>;
  unreadByContactId: Map<number, number>;
  unreadByLegacyId: Map<number, number>;
  lastSentAtByLeadId: Map<string, string>;
  lastSentAtByContactId: Map<number, string>;
  lastSentAtByLegacyId: Map<number, string>;
  lastPreviewByLeadId: Map<string, WhatsAppLastMessagePreviewEntry>;
  lastPreviewByContactId: Map<number, WhatsAppLastMessagePreviewEntry>;
  lastPreviewByLegacyId: Map<number, WhatsAppLastMessagePreviewEntry>;
  /** DB sort order from whatsapp_conversation_summary (lower = higher in sidebar). */
  sortRankByEntityKey: Map<string, number>;
};

export function conversationSummaryEntityKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

/** Stable key matching whatsapp_conversation_summary entity_type/entity_id. */
export function clientConversationEntityKey(client: {
  isContact?: boolean;
  contact_id?: number | null;
  lead_type?: string;
  id?: unknown;
  lead_id?: unknown;
}): string {
  if (client.isContact && client.contact_id != null) {
    return conversationSummaryEntityKey('contact', String(client.contact_id));
  }
  if (client.lead_type === 'legacy' || String(client.id ?? '').startsWith('legacy_')) {
    const raw = String(client.id ?? '').replace('legacy_', '');
    return conversationSummaryEntityKey('legacy', raw);
  }
  const leadKey = String(client.lead_id || client.id || '');
  return conversationSummaryEntityKey('lead', leadKey);
}

function leadIndexLookupKeys(entityId: string): string[] {
  const id = String(entityId).trim();
  if (!id) return [];
  const nk = normalizeUuidKey(id);
  return nk && nk !== id ? [id, nk] : [id];
}

export function getEntitySortRank(
  index: WhatsAppConversationIndexState | null | undefined,
  client: {
    isContact?: boolean;
    contact_id?: number | null;
    lead_type?: string;
    id?: unknown;
    lead_id?: unknown;
  },
): number | undefined {
  if (!index?.sortRankByEntityKey.size) return undefined;
  const primary = index.sortRankByEntityKey.get(clientConversationEntityKey(client));
  if (primary != null) return primary;
  if (client.isContact || client.lead_type === 'legacy' || String(client.id ?? '').startsWith('legacy_')) {
    return undefined;
  }
  const raw = String(client.lead_id || client.id || '').trim();
  if (!raw) return undefined;
  for (const k of leadIndexLookupKeys(raw)) {
    const rank = index.sortRankByEntityKey.get(conversationSummaryEntityKey('lead', k));
    if (rank != null) return rank;
  }
  return undefined;
}

export type WhatsAppSidebarSortableClient = {
  isContact?: boolean;
  contact_id?: number | null;
  lead_type?: string;
  id?: unknown;
  lead_id?: unknown;
  unreadCount?: number;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  lastMessageDirection?: 'in' | 'out';
};

export type WhatsAppReadFilter = 'all' | 'unread' | 'read';

export function clientMatchesReadFilter(
  client: WhatsAppSidebarSortableClient,
  filter: WhatsAppReadFilter,
): boolean {
  if (filter === 'all') return true;
  const unread = Number(client.unreadCount) || 0;
  if (filter === 'unread') return unread > 0;
  return unread === 0 && !!client.lastMessageAt;
}

export function isSameWhatsAppSidebarClient(
  a: WhatsAppSidebarSortableClient & { id?: unknown; lead_id?: unknown },
  b: WhatsAppSidebarSortableClient & { id?: unknown; lead_id?: unknown },
): boolean {
  return clientConversationEntityKey(a) === clientConversationEntityKey(b);
}

/** Sets sidebar unread count for one conversation (optimistic mark-as-unread). */
export function markUnreadForClientInIndex(
  index: WhatsAppConversationIndexState,
  client: WhatsAppSidebarSortableClient & { lead_id?: unknown },
  count = 1,
): void {
  const n = Math.max(1, count);
  if (client.isContact && client.contact_id != null) {
    index.unreadByContactId.set(Number(client.contact_id), n);
    return;
  }
  if (client.lead_type === 'legacy' || String(client.id ?? '').startsWith('legacy_')) {
    const raw = String(client.id ?? '').replace('legacy_', '') || String(client.lead_id ?? '');
    const lid = Number(raw);
    if (!Number.isNaN(lid)) {
      index.unreadByLegacyId.set(lid, n);
    }
    for (const k of leadIndexLookupKeys(raw)) {
      index.unreadByLeadId.set(k, n);
      const nk = normalizeUuidKey(k);
      if (nk && nk !== k) index.unreadByLeadId.set(nk, n);
    }
    return;
  }
  const leadKey = String(client.lead_id || client.id || '');
  for (const k of leadIndexLookupKeys(leadKey)) {
    index.unreadByLeadId.set(k, n);
    const nk = normalizeUuidKey(k);
    if (nk && nk !== k) index.unreadByLeadId.set(nk, n);
  }
}

/** Clears sidebar unread counts for one conversation (optimistic, before DB mark-read completes). */
export function clearUnreadForClientInIndex(
  index: WhatsAppConversationIndexState,
  client: WhatsAppSidebarSortableClient & { lead_id?: unknown },
): void {
  if (client.isContact && client.contact_id != null) {
    index.unreadByContactId.delete(Number(client.contact_id));
    return;
  }
  if (client.lead_type === 'legacy' || String(client.id ?? '').startsWith('legacy_')) {
    const raw = String(client.id ?? '').replace('legacy_', '') || String(client.lead_id ?? '');
    const lid = Number(raw);
    if (!Number.isNaN(lid)) {
      index.unreadByLegacyId.delete(lid);
    }
    for (const k of leadIndexLookupKeys(raw)) {
      index.unreadByLeadId.delete(k);
      const nk = normalizeUuidKey(k);
      if (nk && nk !== k) index.unreadByLeadId.delete(nk);
    }
    return;
  }
  const leadKey = String(client.lead_id || client.id || '');
  for (const k of leadIndexLookupKeys(leadKey)) {
    index.unreadByLeadId.delete(k);
    const nk = normalizeUuidKey(k);
    if (nk && nk !== k) index.unreadByLeadId.delete(nk);
  }
}

export function incomingMessageBelongsToSidebarClient(
  msg: {
    direction?: string;
    is_read?: boolean | null;
    lead_id?: unknown;
    contact_id?: number | null;
    legacy_id?: number | null;
  },
  client: WhatsAppSidebarSortableClient & { lead_id?: unknown },
): boolean {
  if (msg.direction !== 'in') return false;
  if (client.isContact && client.contact_id != null) {
    return Number(msg.contact_id) === Number(client.contact_id);
  }
  if (client.lead_type === 'legacy' || String(client.id ?? '').startsWith('legacy_')) {
    const raw = String(client.id ?? '').replace('legacy_', '') || String(client.lead_id ?? '');
    const lid = Number(raw);
    if (!Number.isNaN(lid) && Number(msg.legacy_id) === lid) {
      return msg.contact_id == null || msg.contact_id === undefined;
    }
    const msgLead = String(msg.lead_id ?? '');
    for (const k of leadIndexLookupKeys(raw)) {
      if (msgLead === k || normalizeUuidKey(msgLead) === normalizeUuidKey(k)) {
        return msg.contact_id == null || msg.contact_id === undefined;
      }
    }
    return false;
  }
  if (msg.contact_id != null && msg.contact_id !== undefined) return false;
  const leadKey = String(client.lead_id || client.id || '');
  const msgLead = String(msg.lead_id ?? '');
  for (const k of leadIndexLookupKeys(leadKey)) {
    if (msgLead === k || normalizeUuidKey(msgLead) === normalizeUuidKey(k)) return true;
  }
  return false;
}

/** Newest message first; clients with no activity sink to the bottom. */
export function compareClientsForSidebar(
  a: WhatsAppSidebarSortableClient,
  b: WhatsAppSidebarSortableClient,
  index?: WhatsAppConversationIndexState | null,
): number {
  const sentA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
  const sentB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
  const validA = !Number.isNaN(sentA) && sentA > 0;
  const validB = !Number.isNaN(sentB) && sentB > 0;
  if (validA && !validB) return -1;
  if (validB && !validA) return 1;
  if (validA && validB && sentA !== sentB) return sentB - sentA;

  const rankA = getEntitySortRank(index, a);
  const rankB = getEntitySortRank(index, b);
  if (rankA != null && rankB != null && rankA !== rankB) return rankA - rankB;
  if (rankA != null && rankB == null) return -1;
  if (rankB != null && rankA == null) return 1;

  return 0;
}

export function sortClientsForSidebar<T extends WhatsAppSidebarSortableClient>(
  clients: T[],
  index?: WhatsAppConversationIndexState | null,
): T[] {
  return [...clients].sort((a, b) => compareClientsForSidebar(a, b, index));
}

/** @deprecated Use sortClientsForSidebar — kept for existing imports. */
export function sortClientsByDbConversationRank<T extends WhatsAppSidebarSortableClient>(
  clients: T[],
  index: WhatsAppConversationIndexState | null | undefined,
): T[] {
  return sortClientsForSidebar(clients, index);
}

export function emptyConversationIndexState(): WhatsAppConversationIndexState {
  return {
    uniqueLeadIds: new Set(),
    uniqueContactIds: new Set(),
    uniqueLegacyIdsFromMessages: new Set(),
    contactToLegacyIdMap: new Map(),
    unreadByLeadId: new Map(),
    unreadByContactId: new Map(),
    unreadByLegacyId: new Map(),
    lastSentAtByLeadId: new Map(),
    lastSentAtByContactId: new Map(),
    lastSentAtByLegacyId: new Map(),
    lastPreviewByLeadId: new Map(),
    lastPreviewByContactId: new Map(),
    lastPreviewByLegacyId: new Map(),
    sortRankByEntityKey: new Map(),
  };
}

function keepLatestSentAt(map: Map<string | number, string>, key: string | number, sentAt: string) {
  const prev = map.get(key);
  if (!prev || new Date(sentAt).getTime() > new Date(prev).getTime()) {
    map.set(key, sentAt);
  }
}

function keepLatestPreview<K extends string | number>(
  map: Map<K, WhatsAppLastMessagePreviewEntry>,
  key: K,
  sentAt: string,
  msg: WhatsAppMessagePreviewFields & { direction?: string | null },
) {
  if (!sentAt) return;
  const sentMs = new Date(sentAt).getTime();
  if (Number.isNaN(sentMs)) return;
  const prev = map.get(key);
  if (prev && new Date(prev.sentAt).getTime() >= sentMs) return;
  const direction = msg.direction === 'out' ? 'out' : msg.direction === 'in' ? 'in' : undefined;
  map.set(key, {
    text: formatWhatsAppMessagePreview(msg),
    direction,
    sentAt,
  });
}

function setPreviewFromSummary(
  state: WhatsAppConversationIndexState,
  entityType: 'lead' | 'contact' | 'legacy',
  entityId: string | number,
  sentAt: string,
  preview: string | null | undefined,
  direction: string | null | undefined,
) {
  if (!sentAt || !preview) return;
  const entry: WhatsAppLastMessagePreviewEntry = {
    text: preview,
    direction: direction === 'out' ? 'out' : direction === 'in' ? 'in' : undefined,
    sentAt,
  };
  if (entityType === 'lead') {
    for (const key of leadIndexLookupKeys(String(entityId))) {
      state.lastPreviewByLeadId.set(key, entry);
    }
  } else if (entityType === 'contact') {
    state.lastPreviewByContactId.set(Number(entityId), entry);
  } else {
    state.lastPreviewByLegacyId.set(Number(entityId), entry);
  }
}

export function applyMessageRowsToIndexState(messages: any[]): WhatsAppConversationIndexState {
  const state = emptyConversationIndexState();
  for (const msg of messages) {
    const sentAt = msg.sent_at ? String(msg.sent_at) : '';
    if (msg.lead_id) {
      const id = String(msg.lead_id);
      state.uniqueLeadIds.add(id);
      if (msg.contact_id == null || msg.contact_id === undefined) {
        if (sentAt) {
          for (const key of leadIndexLookupKeys(id)) {
            keepLatestSentAt(state.lastSentAtByLeadId, key, sentAt);
            keepLatestPreview(state.lastPreviewByLeadId, key, sentAt, msg);
          }
        }
        if (msg.direction === 'in' && !msg.is_read) {
          state.unreadByLeadId.set(id, (state.unreadByLeadId.get(id) || 0) + 1);
        }
      }
    }
    if (msg.contact_id) {
      const cid = Number(msg.contact_id);
      if (!Number.isNaN(cid)) {
        state.uniqueContactIds.add(cid);
        if (msg.legacy_id) {
          state.contactToLegacyIdMap.set(cid, Number(msg.legacy_id));
        }
        if (sentAt) {
          keepLatestSentAt(state.lastSentAtByContactId, cid, sentAt);
          keepLatestPreview(state.lastPreviewByContactId, cid, sentAt, msg);
        }
        if (msg.direction === 'in' && !msg.is_read) {
          state.unreadByContactId.set(cid, (state.unreadByContactId.get(cid) || 0) + 1);
        }
      }
    }
    if (msg.legacy_id && !msg.lead_id && !msg.contact_id) {
      const lid = Number(msg.legacy_id);
      if (!Number.isNaN(lid)) {
        state.uniqueLegacyIdsFromMessages.add(lid);
        if (sentAt) {
          keepLatestSentAt(state.lastSentAtByLegacyId, lid, sentAt);
          keepLatestPreview(state.lastPreviewByLegacyId, lid, sentAt, msg);
        }
        if (msg.direction === 'in' && !msg.is_read) {
          state.unreadByLegacyId.set(lid, (state.unreadByLegacyId.get(lid) || 0) + 1);
        }
      }
    }
  }
  return state;
}

export function applySummaryRowsToIndexState(
  rows: WhatsAppConversationSummaryRow[],
): WhatsAppConversationIndexState {
  const state = emptyConversationIndexState();
  rows.forEach((row, index) => {
    const unread = Number(row.unread_count) || 0;
    const sentAt = row.last_sent_at ? String(row.last_sent_at) : '';
    if (row.entity_type && row.entity_id) {
      const rank = Number(row.sort_rank) || index + 1;
      state.sortRankByEntityKey.set(
        conversationSummaryEntityKey(row.entity_type, row.entity_id),
        rank,
      );
    }
    if (row.entity_type === 'lead' && row.entity_id) {
      state.uniqueLeadIds.add(row.entity_id);
      if (sentAt) {
        for (const key of leadIndexLookupKeys(row.entity_id)) {
          keepLatestSentAt(state.lastSentAtByLeadId, key, sentAt);
        }
      }
      if (unread > 0) state.unreadByLeadId.set(row.entity_id, unread);
      setPreviewFromSummary(
        state,
        'lead',
        row.entity_id,
        sentAt,
        row.last_message_preview,
        row.last_message_direction,
      );
    } else if (row.entity_type === 'contact' && row.entity_id) {
      const cid = Number(row.entity_id);
      if (Number.isNaN(cid)) return;
      state.uniqueContactIds.add(cid);
      if (row.legacy_id != null && !Number.isNaN(Number(row.legacy_id))) {
        state.contactToLegacyIdMap.set(cid, Number(row.legacy_id));
      }
      if (sentAt) keepLatestSentAt(state.lastSentAtByContactId, cid, sentAt);
      if (unread > 0) state.unreadByContactId.set(cid, unread);
      setPreviewFromSummary(
        state,
        'contact',
        cid,
        sentAt,
        row.last_message_preview,
        row.last_message_direction,
      );
    } else if (row.entity_type === 'legacy' && row.entity_id) {
      const lid = Number(row.entity_id);
      if (Number.isNaN(lid)) return;
      state.uniqueLegacyIdsFromMessages.add(lid);
      if (sentAt) keepLatestSentAt(state.lastSentAtByLegacyId, lid, sentAt);
      if (unread > 0) state.unreadByLegacyId.set(lid, unread);
      setPreviewFromSummary(
        state,
        'legacy',
        lid,
        sentAt,
        row.last_message_preview,
        row.last_message_direction,
      );
    }
  });
  return state;
}

/** Fast path: one RPC instead of paginating every whatsapp_messages row. */
export async function fetchWhatsAppConversationSummary(
  client: SupabaseClient,
  employeeFilter?: WhatsAppConversationEmployeeFilter,
): Promise<WhatsAppConversationSummaryRow[] | null> {
  const employeeId =
    employeeFilter?.employeeId != null && Number.isFinite(Number(employeeFilter.employeeId))
      ? Number(employeeFilter.employeeId)
      : null;
  const employeeName = (employeeFilter?.employeeName || '').trim() || null;

  const { data, error } = await client.rpc('whatsapp_conversation_summary', {
    p_employee_id: employeeId,
    p_employee_name: employeeName,
  });
  if (error) {
    console.warn(
      'WhatsApp: conversation summary RPC unavailable, using message index fallback',
      error.message,
    );
    return null;
  }
  return (data || []) as WhatsAppConversationSummaryRow[];
}

export function maxSentAtMsFromConversationIndex(
  idx: WhatsAppConversationIndexState | null | undefined,
): number {
  if (!idx) return 0;
  let latest = 0;
  const consider = (sentAt: string | undefined) => {
    if (!sentAt) return;
    const t = new Date(sentAt).getTime();
    if (!Number.isNaN(t) && t > latest) latest = t;
  };
  for (const sentAt of idx.lastSentAtByLeadId.values()) consider(sentAt);
  for (const sentAt of idx.lastSentAtByContactId.values()) consider(sentAt);
  for (const sentAt of idx.lastSentAtByLegacyId.values()) consider(sentAt);
  return latest;
}

/** Fallback sort when RPC is missing: last message time only (client-side). */
export function applyFallbackSortRanks(state: WhatsAppConversationIndexState): void {
  type Row = { key: string; sentAt: number };
  const byKey = new Map<string, number>();
  const addRow = (entityType: string, entityId: string, sentAt: string) => {
    const key = conversationSummaryEntityKey(entityType, entityId);
    const ms = new Date(sentAt).getTime();
    if (Number.isNaN(ms)) return;
    const prev = byKey.get(key);
    if (prev == null || ms > prev) byKey.set(key, ms);
  };
  state.lastSentAtByLeadId.forEach((sentAt, id) => addRow('lead', id, sentAt));
  state.lastSentAtByContactId.forEach((sentAt, id) => addRow('contact', String(id), sentAt));
  state.lastSentAtByLegacyId.forEach((sentAt, id) => addRow('legacy', String(id), sentAt));
  const rows = [...byKey.entries()]
    .map(([key, sentAt]) => ({ key, sentAt }))
    .sort((a, b) => b.sentAt - a.sentAt);
  state.sortRankByEntityKey.clear();
  rows.forEach((r, i) => state.sortRankByEntityKey.set(r.key, i + 1));
}

export async function loadWhatsAppConversationIndexState(
  client: SupabaseClient,
  employeeFilter?: WhatsAppConversationEmployeeFilter,
): Promise<WhatsAppConversationIndexState> {
  const summary = await fetchWhatsAppConversationSummary(client, employeeFilter);
  if (summary?.length) {
    return applySummaryRowsToIndexState(summary);
  }
  const messages = await fetchWhatsAppMessageIndex(client);
  const state = applyMessageRowsToIndexState(messages);
  applyFallbackSortRanks(state);
  return state;
}

/** My Contacts: only load contacts linked to leads the user can see (not every WA contact_id). */
export async function fetchContactIdsLinkedToLeads(
  client: SupabaseClient,
  newLeadIds: string[],
  legacyLeadIds: number[],
): Promise<number[]> {
  const out = new Set<number>();
  const CHUNK = 80;

  const uniqNew = [...new Set(newLeadIds.map((x) => String(x).trim()).filter(Boolean))];
  for (let i = 0; i < uniqNew.length; i += CHUNK) {
    const chunk = uniqNew.slice(i, i + CHUNK);
    const { data, error } = await client
      .from('lead_leadcontact')
      .select('contact_id')
      .in('newlead_id', chunk);
    if (error) {
      console.error('WhatsApp: lead_leadcontact (newlead) batch error', error);
      continue;
    }
    for (const r of data || []) {
      if (r.contact_id != null) out.add(Number(r.contact_id));
    }
  }

  const uniqLegacy = [...new Set(legacyLeadIds.filter((n) => !Number.isNaN(n)))];
  for (let i = 0; i < uniqLegacy.length; i += CHUNK) {
    const chunk = uniqLegacy.slice(i, i + CHUNK);
    const { data, error } = await client
      .from('lead_leadcontact')
      .select('contact_id')
      .in('lead_id', chunk);
    if (error) {
      console.error('WhatsApp: lead_leadcontact (legacy) batch error', error);
      continue;
    }
    for (const r of data || []) {
      if (r.contact_id != null) out.add(Number(r.contact_id));
    }
  }

  return Array.from(out);
}
