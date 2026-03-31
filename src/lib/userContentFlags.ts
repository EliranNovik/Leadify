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
  externalIds: string[]
): Promise<Map<string, ContentFlagMeta>> {
  const unique = [...new Set(externalIds.filter(Boolean))];
  const keys = new Map<string, ContentFlagMeta>();
  if (unique.length === 0) return keys;

  const batchSize = 200;
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    const { data, error } = await supabase
      .from('user_content_flags')
      .select('conversation_channel, external_id, created_at, flag_type')
      .eq('user_id', userId)
      .eq('flag_kind', 'conversation')
      .in('external_id', batch);
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
          keys.set(k, {
            createdAt: r.created_at,
            flagTypeId: Number.isFinite(fid) ? fid : FLAG_TYPE_PROBABILITY,
          });
        }
      }
    );
  }
  return keys;
}

export async function setConversationFlagged(
  supabase: SupabaseClient,
  userId: string,
  target: ConversationFlagTarget,
  flagged: boolean,
  flagTypeIdWhenInsert: number = FLAG_TYPE_PROBABILITY
): Promise<{ error: Error | null }> {
  if (flagged) {
    const { error } = await supabase.from('user_content_flags').insert({
      user_id: userId,
      flag_kind: 'conversation',
      conversation_channel: target.conversation_channel,
      external_id: target.external_id,
      lead_field_key: null,
      new_lead_id: null,
      legacy_lead_id: null,
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
  opts: { newLeadId?: string | null; legacyLeadId?: number | null }
): Promise<Map<string, ContentFlagMeta>> {
  const keys = new Map<string, ContentFlagMeta>();
  const rowToMeta = (r: {
    lead_field_key: string;
    created_at: string;
    flag_type: number | string;
  }) => {
    if (!r.lead_field_key) return;
    const fid =
      typeof r.flag_type === 'string' ? parseInt(r.flag_type, 10) : Number(r.flag_type);
    keys.set(r.lead_field_key, {
      createdAt: r.created_at,
      flagTypeId: Number.isFinite(fid) ? fid : FLAG_TYPE_PROBABILITY,
    });
  };
  if (opts.newLeadId) {
    const { data, error } = await supabase
      .from('user_content_flags')
      .select('lead_field_key, created_at, flag_type')
      .eq('user_id', userId)
      .eq('flag_kind', 'lead_field')
      .eq('new_lead_id', opts.newLeadId);
    if (!error && data) data.forEach(rowToMeta);
  }
  if (opts.legacyLeadId != null) {
    const { data, error } = await supabase
      .from('user_content_flags')
      .select('lead_field_key, created_at, flag_type')
      .eq('user_id', userId)
      .eq('flag_kind', 'lead_field')
      .eq('legacy_lead_id', opts.legacyLeadId);
    if (!error && data) data.forEach(rowToMeta);
  }
  return keys;
}
