import type { SupabaseClient } from '@supabase/supabase-js';

/** Matches sql/create_flag_types.sql seed ids */
export const FLAG_TYPE_PROBABILITY = 1;
export const FLAG_TYPE_REFERRAL = 2;

export type FlagTypeRow = { id: number; code: string; label: string };

/** Stored per flagged item (conversation or lead field). */
export type ContentFlagMeta = { createdAt: string; flagTypeId: number };

/** Matches sql/create_user_content_flags.sql — conversation_channel CHECK */
export type ConversationChannel = 'email' | 'whatsapp' | 'phone' | 'manual' | 'legacy_interaction';

export type ConversationFlagTarget = {
  conversation_channel: ConversationChannel;
  external_id: string;
};

export function conversationFlagKey(t: ConversationFlagTarget): string {
  return `${t.conversation_channel}\t${t.external_id}`;
}

/** Display local time for a flag row (ISO from DB). */
export function formatFlaggedAt(iso: string | undefined | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

/** Flagged-item modals: View action — white fill; border matches label; hover = solid purple + white label. */
export const flaggedModalViewButtonClass =
  'btn btn-sm shrink-0 border-2 border-purple-700 bg-white text-purple-700 hover:bg-purple-700 hover:border-purple-700 hover:text-white dark:border-purple-200 dark:bg-base-200 dark:text-purple-200 dark:hover:bg-purple-600 dark:hover:border-purple-600 dark:hover:text-white';

const BASE_BADGE = 'badge badge-sm font-semibold px-3 py-2 text-white border-0';

// Used for any future flag types beyond Probability/Referral.
// Deterministic mapping: when new types are added, they get the next palette color by id order.
const EXTRA_TYPE_BG = [
  'bg-fuchsia-600',
  'bg-cyan-600',
  'bg-rose-600',
  'bg-violet-600',
  'bg-teal-600',
  'bg-orange-600',
  'bg-indigo-600',
  'bg-lime-600',
] as const;

/** Tailwind classes: probability = blue, referral = green, others = palette-based. */
export function flagTypeBadgeClass(typeId: number, rows?: FlagTypeRow[] | null): string {
  if (typeId === FLAG_TYPE_REFERRAL) return `${BASE_BADGE} bg-green-600`;
  if (typeId === FLAG_TYPE_PROBABILITY) return `${BASE_BADGE} bg-blue-600`;

  const extras = (rows || [])
    .map((r) => ({ id: Number(r.id) }))
    .filter((r) => Number.isFinite(r.id) && r.id !== FLAG_TYPE_PROBABILITY && r.id !== FLAG_TYPE_REFERRAL)
    .sort((a, b) => a.id - b.id);

  const idx = extras.findIndex((r) => r.id === Number(typeId));
  const paletteIndex = idx >= 0 ? idx % EXTRA_TYPE_BG.length : Math.abs(Number(typeId)) % EXTRA_TYPE_BG.length;
  return `${BASE_BADGE} ${EXTRA_TYPE_BG[paletteIndex]}`;
}

export function flagTypeLabel(flagTypeId: number, rows?: FlagTypeRow[] | null): string {
  const r = rows?.find((x) => Number(x.id) === Number(flagTypeId));
  if (r?.label) return r.label;
  if (Number(flagTypeId) === FLAG_TYPE_PROBABILITY) return 'Probability';
  if (Number(flagTypeId) === FLAG_TYPE_REFERRAL) return 'Referral';
  return String(flagTypeId);
}

export async function fetchFlagTypes(supabase: SupabaseClient): Promise<FlagTypeRow[]> {
  const { data, error } = await supabase.from('flag_types').select('id, code, label').order('id');
  if (error) {
    console.warn('userContentFlags: fetch flag_types failed', error);
    return [];
  }
  return (data || []).map((r: { id: number | string; code: string; label: string }) => ({
    id: typeof r.id === 'string' ? parseInt(r.id, 10) : Number(r.id),
    code: String(r.code),
    label: String(r.label),
  }));
}

export function conversationChannelLabel(ch: ConversationChannel): string {
  const labels: Record<ConversationChannel, string> = {
    email: 'Email',
    whatsapp: 'WhatsApp',
    phone: 'Phone / call',
    manual: 'Manual',
    legacy_interaction: 'Legacy',
  };
  return labels[ch] ?? ch;
}

/** Map a timeline row from InteractionsTab to a persistable flag target, or null if not supported. */
export function interactionRowToConversationFlag(
  row: {
    id?: string | number | null;
    kind?: string;
    editable?: boolean;
    call_log?: { id?: string | number | null } | null;
  },
  isLegacyLead?: boolean
): ConversationFlagTarget | null {
  const id = row.id;
  if (id === undefined || id === null || String(id).trim() === '') return null;
  const sid = String(id);
  if (sid.includes('optimistic_')) return null;

  const kind = row.kind || '';

  if (kind === 'email') {
    return { conversation_channel: 'email', external_id: sid };
  }
  if (kind === 'whatsapp') {
    return { conversation_channel: 'whatsapp', external_id: sid };
  }
  if (kind === 'call' || kind === 'call_log') {
    const callId = row.call_log?.id ?? id;
    return { conversation_channel: 'phone', external_id: String(callId) };
  }

  if (sid.startsWith('legacy_')) {
    const rest = sid.replace(/^legacy_/, '');
    return { conversation_channel: 'legacy_interaction', external_id: rest || sid };
  }

  if (row.editable) {
    return { conversation_channel: 'manual', external_id: sid };
  }

  if (isLegacyLead) {
    return { conversation_channel: 'legacy_interaction', external_id: sid };
  }

  return { conversation_channel: 'manual', external_id: sid };
}

export async function fetchPublicUserId(supabase: SupabaseClient, authUserId: string): Promise<string | null> {
  const { data, error } = await supabase.from('users').select('id').eq('auth_id', authUserId).maybeSingle();
  if (error) {
    console.warn('userContentFlags: users lookup failed', error);
    return null;
  }
  return data?.id ?? null;
}

/** Map conversationFlagKey → metadata (created_at + flag_type id). */
export async function fetchConversationFlagsForUser(
  supabase: SupabaseClient,
  userId: string,
  externalIds: string[],
  opts?: { allUsers?: boolean }
): Promise<Map<string, ContentFlagMeta>> {
  const unique = [...new Set(externalIds.filter(Boolean))];
  const keys = new Map<string, ContentFlagMeta>();
  if (unique.length === 0) return keys;
  const allUsers = Boolean(opts?.allUsers);
  if (!allUsers && !userId) return keys;

  const batchSize = 200;
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    let q = supabase
      .from('user_content_flags')
      .select('conversation_channel, external_id, created_at, flag_type')
      .eq('flag_kind', 'conversation')
      .in('external_id', batch);
    if (!allUsers) {
      q = q.eq('user_id', userId);
    }
    const { data, error } = await q;
    if (error) {
      console.warn('userContentFlags: fetch conversation flags failed', error);
      continue;
    }
    (data || []).forEach(
      (r: {
        conversation_channel: string;
        external_id: string;
        created_at: string;
        flag_type: number | string;
      }) => {
        if (r.conversation_channel && r.external_id) {
          const k = conversationFlagKey({
            conversation_channel: r.conversation_channel as ConversationChannel,
            external_id: r.external_id,
          });
          const fid =
            typeof r.flag_type === 'string' ? parseInt(r.flag_type, 10) : Number(r.flag_type);
          const meta: ContentFlagMeta = {
            createdAt: r.created_at,
            flagTypeId: Number.isFinite(fid) ? fid : FLAG_TYPE_PROBABILITY,
          };
          const prev = keys.get(k);
          // Prefer newest when multiple users flagged the same conversation.
          if (!prev || String(meta.createdAt) > String(prev.createdAt)) {
            keys.set(k, meta);
          }
        }
      }
    );
  }
  return keys;
}

export type ConversationFlagLeadRef = {
  newLeadId?: string | null;
  legacyLeadId?: number | null;
};

export async function setConversationFlagged(
  supabase: SupabaseClient,
  userId: string,
  target: ConversationFlagTarget,
  flagged: boolean,
  flagTypeIdWhenInsert: number = FLAG_TYPE_PROBABILITY,
  leadRef?: ConversationFlagLeadRef
): Promise<{ error: Error | null }> {
  if (flagged) {
    const legacyLeadId =
      leadRef?.legacyLeadId != null && Number.isFinite(Number(leadRef.legacyLeadId))
        ? Number(leadRef.legacyLeadId)
        : null;
    const newLeadId =
      !legacyLeadId && leadRef?.newLeadId ? String(leadRef.newLeadId) : null;
    const { error } = await supabase.from('user_content_flags').insert({
      user_id: userId,
      flag_kind: 'conversation',
      conversation_channel: target.conversation_channel,
      external_id: target.external_id,
      lead_field_key: null,
      new_lead_id: newLeadId,
      legacy_lead_id: legacyLeadId,
      flag_type: flagTypeIdWhenInsert,
    });
    return { error: error ? new Error(error.message) : null };
  }
  const { error } = await supabase
    .from('user_content_flags')
    .delete()
    .eq('user_id', userId)
    .eq('flag_kind', 'conversation')
    .eq('conversation_channel', target.conversation_channel)
    .eq('external_id', target.external_id);
  return { error: error ? new Error(error.message) : null };
}

/**
 * Delete conversation flags for ALL users for this item.
 * Requires RLS policy allowing authenticated deletes across rows.
 */
export async function deleteConversationFlagsForAllUsers(
  supabase: SupabaseClient,
  target: ConversationFlagTarget
): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from('user_content_flags')
    .delete()
    .eq('flag_kind', 'conversation')
    .eq('conversation_channel', target.conversation_channel)
    .eq('external_id', target.external_id);
  return { error: error ? new Error(error.message) : null };
}

/** Lead column flags (expert_opinion, facts, …) — new lead UUID */
export async function setLeadFieldFlagged(
  supabase: SupabaseClient,
  userId: string,
  newLeadId: string,
  leadFieldKey: string,
  flagged: boolean,
  flagTypeIdWhenInsert: number = FLAG_TYPE_PROBABILITY
): Promise<{ error: Error | null }> {
  if (flagged) {
    const { error } = await supabase.from('user_content_flags').insert({
      user_id: userId,
      flag_kind: 'lead_field',
      conversation_channel: null,
      external_id: null,
      lead_field_key: leadFieldKey,
      new_lead_id: newLeadId,
      legacy_lead_id: null,
      flag_type: flagTypeIdWhenInsert,
    });
    return { error: error ? new Error(error.message) : null };
  }
  const { error } = await supabase
    .from('user_content_flags')
    .delete()
    .eq('user_id', userId)
    .eq('flag_kind', 'lead_field')
    .eq('new_lead_id', newLeadId)
    .eq('lead_field_key', leadFieldKey);
  return { error: error ? new Error(error.message) : null };
}

/**
 * Delete lead-field flags for ALL users for this lead field (new lead).
 * Requires RLS policy allowing authenticated deletes across rows.
 */
export async function deleteLeadFieldFlagsForAllUsers(
  supabase: SupabaseClient,
  opts: { newLeadId?: string; legacyLeadId?: number },
  leadFieldKey: string
): Promise<{ error: Error | null }> {
  let q = supabase.from('user_content_flags').delete().eq('flag_kind', 'lead_field').eq('lead_field_key', leadFieldKey);
  if (opts.newLeadId) q = q.eq('new_lead_id', opts.newLeadId);
  if (opts.legacyLeadId != null) q = q.eq('legacy_lead_id', opts.legacyLeadId);
  const { error } = await q;
  return { error: error ? new Error(error.message) : null };
}

/** Lead column flags — legacy numeric lead id */
export async function setLegacyLeadFieldFlagged(
  supabase: SupabaseClient,
  userId: string,
  legacyLeadId: number,
  leadFieldKey: string,
  flagged: boolean,
  flagTypeIdWhenInsert: number = FLAG_TYPE_PROBABILITY
): Promise<{ error: Error | null }> {
  if (flagged) {
    const { error } = await supabase.from('user_content_flags').insert({
      user_id: userId,
      flag_kind: 'lead_field',
      conversation_channel: null,
      external_id: null,
      lead_field_key: leadFieldKey,
      new_lead_id: null,
      legacy_lead_id: legacyLeadId,
      flag_type: flagTypeIdWhenInsert,
    });
    return { error: error ? new Error(error.message) : null };
  }
  const { error } = await supabase
    .from('user_content_flags')
    .delete()
    .eq('user_id', userId)
    .eq('flag_kind', 'lead_field')
    .eq('legacy_lead_id', legacyLeadId)
    .eq('lead_field_key', leadFieldKey);
  return { error: error ? new Error(error.message) : null };
}

/** Map lead_field_key → metadata. */
export async function fetchLeadFieldFlagsForLead(
  supabase: SupabaseClient,
  userId: string,
  opts: { newLeadId?: string | null; legacyLeadId?: number | null; allUsers?: boolean }
): Promise<Map<string, ContentFlagMeta>> {
  const keys = new Map<string, ContentFlagMeta>();
  const allUsers = Boolean(opts.allUsers);
  if (!allUsers && !userId) return keys;

  const rowToMeta = (r: {
    lead_field_key: string;
    created_at: string;
    flag_type: number | string;
  }) => {
    if (!r.lead_field_key) return;
    const fid =
      typeof r.flag_type === 'string' ? parseInt(r.flag_type, 10) : Number(r.flag_type);
    const meta: ContentFlagMeta = {
      createdAt: r.created_at,
      flagTypeId: Number.isFinite(fid) ? fid : FLAG_TYPE_PROBABILITY,
    };
    const prev = keys.get(r.lead_field_key);
    if (!prev || String(meta.createdAt) > String(prev.createdAt)) {
      keys.set(r.lead_field_key, meta);
    }
  };
  if (opts.newLeadId) {
    let q = supabase
      .from('user_content_flags')
      .select('lead_field_key, created_at, flag_type')
      .eq('flag_kind', 'lead_field')
      .eq('new_lead_id', opts.newLeadId);
    if (!allUsers) q = q.eq('user_id', userId);
    const { data, error } = await q;
    if (!error && data) data.forEach(rowToMeta);
  }
  if (opts.legacyLeadId != null) {
    let q = supabase
      .from('user_content_flags')
      .select('lead_field_key, created_at, flag_type')
      .eq('flag_kind', 'lead_field')
      .eq('legacy_lead_id', opts.legacyLeadId);
    if (!allUsers) q = q.eq('user_id', userId);
    const { data, error } = await q;
    if (!error && data) data.forEach(rowToMeta);
  }
  return keys;
}

/**
 * Clients-style flag check for a list of leads (same direction as InteractionsTab):
 * lead → interaction external_ids → match against user_content_flags.
 * Also includes lead_field flags (new_lead_id / legacy_lead_id).
 *
 * @param opts.allUsers — when true, include every user's flags (Super Pipeline team view).
 *   Requires RLS SELECT for authenticated (see sql/2026-07-20_user_content_flags_select_all_authenticated.sql).
 */
export async function filterLeadsByUserContentFlags<T extends {
  id?: string | number | null;
  lead_type?: string | null;
  manual_interactions?: unknown;
}>(
  supabase: SupabaseClient,
  userId: string,
  leads: T[],
  flagTypeIds: number[],
  opts?: { allUsers?: boolean }
): Promise<T[]> {
  if (!userId || leads.length === 0) return [];
  const typeIdSet = new Set(
    (flagTypeIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id))
  );
  if (typeIdSet.size === 0) return leads;
  const allUsers = Boolean(opts?.allUsers);

  const flaggedConversationKeys = new Set<string>();
  const flaggedExternalIds = new Set<string>();
  const leadFieldNew = new Set<string>();
  const leadFieldLegacy = new Set<number>();
  const conversationFkNew = new Set<string>();
  const conversationFkLegacy = new Set<number>();
  /** leadKey / conversationKey / externalId → flag type ids */
  const leadFieldNewTypes = new Map<string, Set<number>>();
  const leadFieldLegacyTypes = new Map<number, Set<number>>();
  const conversationFkNewTypes = new Map<string, Set<number>>();
  const conversationFkLegacyTypes = new Map<number, Set<number>>();
  const conversationKeyToTypes = new Map<string, Set<number>>();
  const externalIdToTypes = new Map<string, Set<number>>();
  let flagsLoadedForUser = 0;
  const flagsByType: Record<string, number> = {};
  const flagsByChannel: Record<string, number> = {};

  const addToTypeMap = <K,>(map: Map<K, Set<number>>, key: K, typeId: number) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(typeId);
  };

  const PAGE_SIZE = 1000;
  let from = 0;
  for (;;) {
    let q = supabase
      .from('user_content_flags')
      .select(
        'flag_kind, conversation_channel, external_id, new_lead_id, legacy_lead_id, flag_type, lead_field_key'
      )
      .in('flag_type', [...typeIdSet])
      .range(from, from + PAGE_SIZE - 1);
    if (!allUsers) {
      q = q.eq('user_id', userId);
    }
    const { data, error } = await q;
    if (error) {
      console.warn('userContentFlags: filterLeadsByUserContentFlags load failed', error);
      break;
    }
    const rows = data || [];
    rows.forEach((r: any) => {
      const fid = Number(r.flag_type);
      if (!typeIdSet.has(fid)) return;
      flagsLoadedForUser += 1;
      flagsByType[String(fid)] = (flagsByType[String(fid)] || 0) + 1;

      if (r.flag_kind === 'lead_field') {
        if (r.new_lead_id) {
          leadFieldNew.add(String(r.new_lead_id));
          addToTypeMap(leadFieldNewTypes, String(r.new_lead_id), fid);
        }
        if (r.legacy_lead_id != null && Number.isFinite(Number(r.legacy_lead_id))) {
          const lid = Number(r.legacy_lead_id);
          leadFieldLegacy.add(lid);
          addToTypeMap(leadFieldLegacyTypes, lid, fid);
        }
        return;
      }

      if (r.flag_kind === 'conversation') {
        const channel = r.conversation_channel as ConversationChannel | null;
        if (channel) {
          flagsByChannel[channel] = (flagsByChannel[channel] || 0) + 1;
        }
        if (r.new_lead_id) {
          conversationFkNew.add(String(r.new_lead_id));
          addToTypeMap(conversationFkNewTypes, String(r.new_lead_id), fid);
        }
        if (r.legacy_lead_id != null && Number.isFinite(Number(r.legacy_lead_id))) {
          const lid = Number(r.legacy_lead_id);
          conversationFkLegacy.add(lid);
          addToTypeMap(conversationFkLegacyTypes, lid, fid);
        }
        const externalId = r.external_id != null ? String(r.external_id).trim() : '';
        if (channel && externalId) {
          const ckey = conversationFlagKey({
            conversation_channel: channel,
            external_id: externalId,
          });
          flaggedConversationKeys.add(ckey);
          flaggedExternalIds.add(externalId);
          addToTypeMap(conversationKeyToTypes, ckey, fid);
          addToTypeMap(externalIdToTypes, externalId, fid);
        }
      }
    });
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  console.log('🔍 DEBUG: Flags loaded for pipeline filter', {
    allUsers,
    userId,
    selectedFlagTypeIds: [...typeIdSet],
    flagsLoaded: flagsLoadedForUser,
    flagsByType,
    flagsByChannel,
    uniqueConversationKeys: flaggedConversationKeys.size,
  });

  const toLegacyNumericId = (lead: T): number | null => {
    const raw = String(lead.id ?? '');
    const isLegacy =
      lead.lead_type === 'legacy' || raw.startsWith('legacy_') || (/^\d+$/.test(raw) && !raw.includes('-'));
    if (!isLegacy) return null;
    const n = Number(raw.replace(/^legacy_/, ''));
    return Number.isFinite(n) ? n : null;
  };

  const toNewUuid = (lead: T): string | null => {
    if (toLegacyNumericId(lead) != null) return null;
    const raw = String(lead.id ?? '');
    return raw.includes('-') ? raw : null;
  };

  const matchedKeys = new Set<string>();
  const flagTypesByLeadKey = new Map<string, Set<number>>();
  const mergeLeadTypes = (leadKey: string, types?: Set<number> | null) => {
    if (!types || types.size === 0) return;
    if (!flagTypesByLeadKey.has(leadKey)) flagTypesByLeadKey.set(leadKey, new Set());
    types.forEach((t) => flagTypesByLeadKey.get(leadKey)!.add(t));
  };

  const leadKeyOf = (lead: T) => {
    const legacyId = toLegacyNumericId(lead);
    if (legacyId != null) return `legacy:${legacyId}`;
    return `new:${String(lead.id)}`;
  };

  const annotateMatchedLeads = (source: T[]): T[] =>
    source
      .filter((l) => matchedKeys.has(leadKeyOf(l)))
      .map((lead) => {
        const types = [...(flagTypesByLeadKey.get(leadKeyOf(lead)) || [])].sort((a, b) => a - b);
        return { ...lead, content_flag_type_ids: types };
      });

  leads.forEach((lead) => {
    const legacyId = toLegacyNumericId(lead);
    const newId = toNewUuid(lead);
    const lk = leadKeyOf(lead);
    if (legacyId != null) {
      if (leadFieldLegacy.has(legacyId) || conversationFkLegacy.has(legacyId)) {
        matchedKeys.add(lk);
        mergeLeadTypes(lk, leadFieldLegacyTypes.get(legacyId));
        mergeLeadTypes(lk, conversationFkLegacyTypes.get(legacyId));
      }
    } else if (newId) {
      if (leadFieldNew.has(newId) || conversationFkNew.has(newId)) {
        matchedKeys.add(lk);
        mergeLeadTypes(lk, leadFieldNewTypes.get(newId));
        mergeLeadTypes(lk, conversationFkNewTypes.get(newId));
      }
    }
  });

  // No conversation flags to match via timeline → return FK matches only
  if (flaggedConversationKeys.size === 0 && flaggedExternalIds.size === 0) {
    const out = annotateMatchedLeads(leads);
    console.log('🔍 DEBUG: Clients-style flag filter (lead_field/FK only)', {
      input: leads.length,
      output: out.length,
      leadFieldNew: leadFieldNew.size,
      leadFieldLegacy: leadFieldLegacy.size,
    });
    return out;
  }

  const unmatched = leads.filter((l) => !matchedKeys.has(leadKeyOf(l)));
  // Load timeline for all candidate leads so FK-matched rows also pick up conversation flag types.
  const newLeadIds = leads.map(toNewUuid).filter((id): id is string => Boolean(id));
  const legacyLeadIds = leads
    .map(toLegacyNumericId)
    .filter((id): id is number => id != null);

  /** leadKey → conversation flag keys present on that lead's timeline */
  const timelineKeysByLead = new Map<string, Set<string>>();
  const addTimelineKey = (leadKey: string, channel: ConversationChannel, externalId: string) => {
    const sid = String(externalId || '').trim();
    if (!sid) return;
    if (!timelineKeysByLead.has(leadKey)) timelineKeysByLead.set(leadKey, new Set());
    timelineKeysByLead.get(leadKey)!.add(
      conversationFlagKey({ conversation_channel: channel, external_id: sid })
    );
    // Also store bare external id marker for channel-mismatch fallback
    timelineKeysByLead.get(leadKey)!.add(`*\t${sid}`);
  };

  const chunkArray = <U,>(arr: U[], size: number) => {
    const out: U[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  // emails (same id convention as interactionRowToConversationFlag / stableEmailRowId)
  for (const chunk of chunkArray(newLeadIds, 200)) {
    const { data, error } = await supabase
      .from('emails')
      .select('client_id, message_id, id')
      .in('client_id', chunk);
    if (error) {
      console.warn('userContentFlags: clients-style email(new) failed', error);
      continue;
    }
    (data || []).forEach((row: any) => {
      const lk = `new:${row.client_id}`;
      const ext =
        row.message_id != null && String(row.message_id).trim() !== ''
          ? String(row.message_id)
          : row.id != null
            ? String(row.id)
            : '';
      addTimelineKey(lk, 'email', ext);
    });
  }
  for (const chunk of chunkArray(legacyLeadIds, 200)) {
    const { data, error } = await supabase
      .from('emails')
      .select('legacy_id, message_id, id')
      .in('legacy_id', chunk);
    if (error) {
      console.warn('userContentFlags: clients-style email(legacy) failed', error);
      continue;
    }
    (data || []).forEach((row: any) => {
      const lk = `legacy:${row.legacy_id}`;
      const ext =
        row.message_id != null && String(row.message_id).trim() !== ''
          ? String(row.message_id)
          : row.id != null
            ? String(row.id)
            : '';
      addTimelineKey(lk, 'email', ext);
    });
  }

  // whatsapp
  for (const chunk of chunkArray(newLeadIds, 200)) {
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('lead_id, id')
      .in('lead_id', chunk);
    if (error) {
      console.warn('userContentFlags: clients-style whatsapp(new) failed', error);
      continue;
    }
    (data || []).forEach((row: any) => addTimelineKey(`new:${row.lead_id}`, 'whatsapp', String(row.id)));
  }
  for (const chunk of chunkArray(legacyLeadIds, 200)) {
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('legacy_id, id')
      .in('legacy_id', chunk);
    if (error) {
      console.warn('userContentFlags: clients-style whatsapp(legacy) failed', error);
      continue;
    }
    (data || []).forEach((row: any) =>
      addTimelineKey(`legacy:${row.legacy_id}`, 'whatsapp', String(row.id))
    );
  }

  // phone / call_logs
  for (const chunk of chunkArray(newLeadIds, 200)) {
    const { data, error } = await supabase
      .from('call_logs')
      .select('client_id, id')
      .in('client_id', chunk);
    if (error) {
      console.warn('userContentFlags: clients-style phone(new) failed', error);
      continue;
    }
    (data || []).forEach((row: any) => addTimelineKey(`new:${row.client_id}`, 'phone', String(row.id)));
  }
  for (const chunk of chunkArray(legacyLeadIds, 200)) {
    const { data, error } = await supabase
      .from('call_logs')
      .select('lead_id, id')
      .in('lead_id', chunk);
    if (error) {
      console.warn('userContentFlags: clients-style phone(legacy) failed', error);
      continue;
    }
    (data || []).forEach((row: any) => addTimelineKey(`legacy:${row.lead_id}`, 'phone', String(row.id)));
  }

  // manual (new leads table)
  for (const chunk of chunkArray(newLeadIds, 200)) {
    const { data, error } = await supabase
      .from('lead_manual_interactions')
      .select('lead_id, id')
      .in('lead_id', chunk);
    if (error) {
      console.warn('userContentFlags: clients-style manual table failed', error);
      continue;
    }
    (data || []).forEach((row: any) => addTimelineKey(`new:${row.lead_id}`, 'manual', String(row.id)));
  }

  // manual JSON on lead objects (when present)
  leads.forEach((lead) => {
    const newId = toNewUuid(lead);
    if (!newId) return;
    const manuals = Array.isArray(lead.manual_interactions) ? lead.manual_interactions : [];
    manuals.forEach((m: any) => {
      if (m?.id != null) addTimelineKey(`new:${newId}`, 'manual', String(m.id));
    });
  });

  // legacy interactions
  for (const chunk of chunkArray(legacyLeadIds, 200)) {
    const { data, error } = await supabase
      .from('leads_leadinteractions')
      .select('lead_id, id')
      .in('lead_id', chunk);
    if (error) {
      console.warn('userContentFlags: clients-style legacy_interaction failed', error);
      continue;
    }
    (data || []).forEach((row: any) => {
      addTimelineKey(`legacy:${row.lead_id}`, 'legacy_interaction', String(row.id));
    });
  }

  leads.forEach((lead) => {
    const lk = leadKeyOf(lead);
    const keys = timelineKeysByLead.get(lk);
    if (!keys) return;
    for (const k of keys) {
      if (k.startsWith('*\t')) {
        const ext = k.slice(2);
        if (flaggedExternalIds.has(ext)) {
          matchedKeys.add(lk);
          mergeLeadTypes(lk, externalIdToTypes.get(ext));
        }
      } else if (flaggedConversationKeys.has(k)) {
        matchedKeys.add(lk);
        mergeLeadTypes(lk, conversationKeyToTypes.get(k));
      }
    }
  });

  const out = annotateMatchedLeads(leads);
  console.log('🔍 DEBUG: Clients-style flag filter', {
    input: leads.length,
    output: out.length,
    conversationFlags: flaggedConversationKeys.size,
    leadFieldNew: leadFieldNew.size,
    leadFieldLegacy: leadFieldLegacy.size,
    timelineLeadsChecked: unmatched.length,
  });
  return out;
}

/**
 * Lead IDs from the current user's content flags (conversation + lead_field).
 * Uses new_lead_id / legacy_lead_id when set; otherwise resolves conversation
 * flags via external_id + conversation_channel (historical rows often lack lead FKs).
 * When flagTypeIds is empty/omitted, any flag type is included.
 */
export async function fetchFlaggedLeadIdsForUser(
  supabase: SupabaseClient,
  userId: string,
  flagTypeIds?: number[],
  opts?: { allUsers?: boolean }
): Promise<{ newLeadIds: Set<string>; legacyLeadIds: Set<number> }> {
  const newLeadIds = new Set<string>();
  const legacyLeadIds = new Set<number>();
  if (!userId && !opts?.allUsers) return { newLeadIds, legacyLeadIds };

  const typeIds = (flagTypeIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));
  const allUsers = Boolean(opts?.allUsers);

  type FlagRow = {
    flag_kind?: string | null;
    conversation_channel?: string | null;
    external_id?: string | null;
    new_lead_id?: string | null;
    legacy_lead_id?: number | null;
  };

  const unresolvedByChannel: Record<ConversationChannel, string[]> = {
    email: [],
    whatsapp: [],
    phone: [],
    manual: [],
    legacy_interaction: [],
  };

  const PAGE_SIZE = 1000;
  let from = 0;
  for (;;) {
    let q = supabase
      .from('user_content_flags')
      .select('flag_kind, conversation_channel, external_id, new_lead_id, legacy_lead_id')
      .range(from, from + PAGE_SIZE - 1);

    if (!allUsers) {
      q = q.eq('user_id', userId);
    }
    if (typeIds.length > 0) {
      q = q.in('flag_type', typeIds);
    }

    const { data, error } = await q;
    if (error) {
      console.warn('userContentFlags: fetchFlaggedLeadIdsForUser failed', error);
      break;
    }
    const rows = (data || []) as FlagRow[];
    rows.forEach((r) => {
      if (r.new_lead_id) newLeadIds.add(String(r.new_lead_id));
      if (r.legacy_lead_id != null) {
        const id = Number(r.legacy_lead_id);
        if (Number.isFinite(id)) legacyLeadIds.add(id);
      }
      if (r.new_lead_id || r.legacy_lead_id != null) return;

      const channel = r.conversation_channel as ConversationChannel | null;
      const externalId = r.external_id?.trim();
      if (
        r.flag_kind === 'conversation' &&
        channel &&
        externalId &&
        channel in unresolvedByChannel
      ) {
        unresolvedByChannel[channel].push(externalId);
      }
    });
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  await resolveConversationExternalIdsToLeads(supabase, unresolvedByChannel, newLeadIds, legacyLeadIds);

  console.log('🔍 DEBUG: Flagged lead resolve summary', {
    channels: {
      email: unresolvedByChannel.email.length,
      whatsapp: unresolvedByChannel.whatsapp.length,
      phone: unresolvedByChannel.phone.length,
      manual: unresolvedByChannel.manual.length,
      legacy_interaction: unresolvedByChannel.legacy_interaction.length,
    },
    newLeadIds: newLeadIds.size,
    legacyLeadIds: legacyLeadIds.size,
  });

  return { newLeadIds, legacyLeadIds };
}

async function resolveContactIdsToLeads(
  supabase: SupabaseClient,
  contactIds: Array<string | number>,
  addNew: (id: unknown) => void,
  addLegacy: (id: unknown) => void
): Promise<void> {
  const ids = [...new Set(contactIds.map((c) => Number(c)).filter((n) => Number.isFinite(n)))];
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const { data, error } = await supabase
      .from('lead_leadcontact')
      .select('newlead_id, lead_id')
      .in('contact_id', batch);
    if (error) {
      console.warn('userContentFlags: contact→lead resolve failed', error);
      continue;
    }
    (data || []).forEach((row: any) => {
      addNew(row.newlead_id);
      addLegacy(row.lead_id);
    });
  }
}

async function resolveConversationExternalIdsToLeads(
  supabase: SupabaseClient,
  byChannel: Record<ConversationChannel, string[]>,
  newLeadIds: Set<string>,
  legacyLeadIds: Set<number>
): Promise<void> {
  const addNew = (id: unknown) => {
    if (id == null || id === '') return;
    newLeadIds.add(String(id));
  };
  const addLegacy = (id: unknown) => {
    const n = Number(id);
    if (Number.isFinite(n)) legacyLeadIds.add(n);
  };

  const unique = (ids: string[]) => [...new Set(ids.filter(Boolean))];
  const isIntegerId = (s: string) => /^\d+$/.test(String(s).trim());
  const stripLegacyPrefix = (s: string) => String(s).replace(/^legacy_/, '').trim();

  const extraLegacyInteractionIds: number[] = [];
  const pendingContactIds: number[] = [];

  // email → emails by message_id / integer id → client_id, legacy_id, contact_id
  {
    const ids = unique(byChannel.email);
    for (let i = 0; i < ids.length; i += 40) {
      const batch = ids.slice(i, i + 40);
      const integerIds = batch.filter(isIntegerId);

      // Prefer eq() over in() for Graph message ids (special chars / encoding).
      const messageRows = (
        await Promise.all(
          batch.map(async (externalId) => {
            const { data, error } = await supabase
              .from('emails')
              .select('client_id, legacy_id, contact_id')
              .eq('message_id', externalId)
              .limit(5);
            if (error) {
              console.warn('userContentFlags: email message_id resolve failed', error);
              return [] as any[];
            }
            return data || [];
          })
        )
      ).flat();

      let idRows: any[] = [];
      if (integerIds.length > 0) {
        const { data, error } = await supabase
          .from('emails')
          .select('client_id, legacy_id, contact_id')
          .in('id', integerIds);
        if (error) console.warn('userContentFlags: email id resolve failed', error);
        else idRows = data || [];
      }

      [...messageRows, ...idRows].forEach((row: any) => {
        addNew(row.client_id);
        addLegacy(row.legacy_id);
        if (row.contact_id != null) pendingContactIds.push(Number(row.contact_id));
      });
    }
  }

  // whatsapp → whatsapp_messages.id → lead_id / legacy_id / contact_id
  {
    const ids = unique(byChannel.whatsapp);
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('lead_id, legacy_id, contact_id')
        .in('id', batch);
      if (error) {
        console.warn('userContentFlags: whatsapp resolve failed', error);
        continue;
      }
      (data || []).forEach((row: any) => {
        addNew(row.lead_id);
        addLegacy(row.legacy_id);
        if (row.contact_id != null) pendingContactIds.push(Number(row.contact_id));
      });
    }
  }

  // phone → call_logs; unmatched integer ids → legacy interactions
  {
    const callLogIds: string[] = [];
    for (const raw of unique(byChannel.phone)) {
      const id = String(raw).replace(/^call_/, '').trim();
      if (id.startsWith('legacy_')) {
        const n = Number(stripLegacyPrefix(id));
        if (Number.isFinite(n)) extraLegacyInteractionIds.push(n);
        continue;
      }
      if (isIntegerId(id)) callLogIds.push(id);
    }
    for (let i = 0; i < callLogIds.length; i += 200) {
      const batch = callLogIds.slice(i, i + 200);
      const { data, error } = await supabase
        .from('call_logs')
        .select('id, client_id, lead_id')
        .in('id', batch);
      if (error) {
        console.warn('userContentFlags: phone resolve failed', error);
        // Fall back: treat all as possible legacy interaction ids
        batch.forEach((id) => {
          const n = Number(id);
          if (Number.isFinite(n)) extraLegacyInteractionIds.push(n);
        });
        continue;
      }
      const found = new Set<string>();
      (data || []).forEach((row: any) => {
        found.add(String(row.id));
        addNew(row.client_id);
        addLegacy(row.lead_id);
      });
      batch.forEach((id) => {
        if (!found.has(String(id))) {
          const n = Number(id);
          if (Number.isFinite(n)) extraLegacyInteractionIds.push(n);
        }
      });
    }
  }

  // manual → lead_manual_interactions + leads.manual_interactions JSON
  {
    const ids = unique(byChannel.manual).map((id) =>
      id.startsWith('manual_') || !isIntegerId(id) ? id : `manual_${id}`
    );
    const found = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      const { data, error } = await supabase
        .from('lead_manual_interactions')
        .select('lead_id, id')
        .in('id', batch);
      if (error) {
        console.warn('userContentFlags: manual table resolve failed', error);
      } else {
        (data || []).forEach((row: any) => {
          addNew(row.lead_id);
          if (row.id) found.add(String(row.id));
        });
      }
    }
    const missing = ids.filter((id) => !found.has(id));
    for (let i = 0; i < missing.length; i += 10) {
      const chunk = missing.slice(i, i + 10);
      await Promise.all(
        chunk.map(async (externalId) => {
          const variants = [externalId];
          const bare = externalId.startsWith('manual_') ? externalId.slice('manual_'.length) : null;
          if (bare && isIntegerId(bare)) {
            variants.push(bare);
            variants.push(Number(bare) as unknown as string);
          }

          for (const variant of variants) {
            const { data, error } = await supabase
              .from('leads')
              .select('id')
              .contains('manual_interactions', [{ id: variant }])
              .limit(20);
            if (!error && data?.length) {
              data.forEach((row: any) => addNew(row.id));
              found.add(externalId);
              return;
            }
          }
        })
      );
    }
  }

  // legacy_interaction (+ phone fallbacks) → leads_leadinteractions.id → lead_id
  {
    const ids = unique([
      ...byChannel.legacy_interaction,
      ...extraLegacyInteractionIds.map(String),
    ])
      .map((id) => Number(stripLegacyPrefix(id)))
      .filter((id) => Number.isFinite(id));
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      const { data, error } = await supabase
        .from('leads_leadinteractions')
        .select('lead_id')
        .in('id', batch);
      if (error) {
        console.warn('userContentFlags: legacy_interaction resolve failed', error);
        continue;
      }
      (data || []).forEach((row: any) => addLegacy(row.lead_id));
    }
  }

  if (pendingContactIds.length > 0) {
    await resolveContactIdsToLeads(supabase, pendingContactIds, addNew, addLegacy);
  }
}
