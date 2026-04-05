import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { flagTypeLabel } from './userContentFlags';

export type RmqMessageLeadFlagRow = {
  id: string;
  user_id: string;
  message_id: number;
  conversation_id: number;
  new_lead_id: string | null;
  legacy_lead_id: number | null;
  flag_type: number;
  created_at: string;
  /** Filled client-side for UI (lead_number from leads / leads_lead). */
  _leadNum?: string;
  flagger?: {
    full_name?: string | null;
    tenants_employee?: { display_name?: string | null } | null;
  } | null;
};

export function rmqFlaggerDisplayName(row: RmqMessageLeadFlagRow): string {
  const te = row.flagger?.tenants_employee?.display_name;
  const fn = row.flagger?.full_name;
  return (te && te.trim()) || (fn && fn.trim()) || 'User';
}

export function rmqFlagLeadLabel(
  row: Pick<RmqMessageLeadFlagRow, 'new_lead_id' | 'legacy_lead_id'>,
  leadNumber?: string | null
): string {
  if (leadNumber) return `#${leadNumber}`;
  if (row.new_lead_id) return 'Lead';
  if (row.legacy_lead_id != null) return `Legacy #${row.legacy_lead_id}`;
  return 'Lead';
}

/** All flags in a conversation (every participant's flags), with flagger display name. */
export async function fetchRmqMessageFlagsForConversation(
  supabase: SupabaseClient,
  conversationId: number
): Promise<RmqMessageLeadFlagRow[]> {
  const { data, error } = await supabase
    .from('rmq_message_lead_flags')
    .select('id, user_id, message_id, conversation_id, new_lead_id, legacy_lead_id, flag_type, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('fetchRmqMessageFlagsForConversation', error);
    return [];
  }
  const rows = data || [];
  const userIds = [...new Set(rows.map((r: { user_id: string }) => r.user_id).filter(Boolean))];
  let userMap = new Map<string, RmqMessageLeadFlagRow['flagger']>();
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, full_name, tenants_employee!users_employee_id_fkey(display_name)')
      .in('id', userIds);
    (users || []).forEach((u: any) => {
      userMap.set(u.id, {
        full_name: u.full_name,
        tenants_employee: u.tenants_employee,
      });
    });
  }
  return rows.map((r: any) => ({
    ...r,
    flagger: userMap.get(r.user_id) ?? null,
  })) as RmqMessageLeadFlagRow[];
}

export async function insertRmqMessageLeadFlag(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    messageId: number;
    conversationId: number;
    newLeadId: string | null;
    legacyLeadId: number | null;
    flagTypeId: number;
  }
): Promise<{ error: PostgrestError | Error | null }> {
  if ((opts.newLeadId == null) === (opts.legacyLeadId == null)) {
    return { error: new Error('Exactly one of new or legacy lead id required') };
  }
  const { error } = await supabase.from('rmq_message_lead_flags').insert({
    user_id: opts.userId,
    message_id: opts.messageId,
    conversation_id: opts.conversationId,
    new_lead_id: opts.newLeadId,
    legacy_lead_id: opts.legacyLeadId,
    flag_type: opts.flagTypeId,
  });
  return { error };
}

export async function deleteRmqMessageLeadFlag(
  supabase: SupabaseClient,
  flagRowId: string
): Promise<{ error: PostgrestError | null }> {
  const { error } = await supabase.from('rmq_message_lead_flags').delete().eq('id', flagRowId);
  return { error };
}

/** Total RMQ message flags linked to this lead (all users). Uses SECURITY DEFINER RPC. */
export async function fetchRmqFlagCountForLead(
  supabase: SupabaseClient,
  opts: { newLeadId?: string | null; legacyLeadId?: number | null }
): Promise<number> {
  const { data, error } = await supabase.rpc('rmq_flag_count_for_lead', {
    p_new_lead_id: opts.newLeadId ?? null,
    p_legacy_lead_id: opts.legacyLeadId ?? null,
  });
  if (error) {
    console.warn('fetchRmqFlagCountForLead', error);
    return 0;
  }
  const n = typeof data === 'number' ? data : Number(data);
  return Number.isFinite(n) ? n : 0;
}

export type RmqMessageLeadFlagWithPreview = RmqMessageLeadFlagRow & {
  _messagePreview?: string | null;
};

/** All RMQ message flags linked to a lead (every user’s flags). Enriched with flagger names and message text preview. */
export async function fetchRmqMessageFlagsForLead(
  supabase: SupabaseClient,
  opts: { newLeadId?: string | null; legacyLeadId?: number | null }
): Promise<RmqMessageLeadFlagWithPreview[]> {
  let q = supabase
    .from('rmq_message_lead_flags')
    .select('id, user_id, message_id, conversation_id, new_lead_id, legacy_lead_id, flag_type, created_at');
  if (opts.newLeadId) {
    q = q.eq('new_lead_id', opts.newLeadId);
  } else if (opts.legacyLeadId != null && !Number.isNaN(opts.legacyLeadId)) {
    q = q.eq('legacy_lead_id', opts.legacyLeadId);
  } else {
    return [];
  }
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) {
    console.warn('fetchRmqMessageFlagsForLead', error);
    return [];
  }
  const rows = (data || []) as Omit<RmqMessageLeadFlagRow, 'flagger'>[];
  const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
  let userMap = new Map<string, RmqMessageLeadFlagRow['flagger']>();
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, full_name, tenants_employee!users_employee_id_fkey(display_name)')
      .in('id', userIds);
    (users || []).forEach((u: any) => {
      userMap.set(u.id, {
        full_name: u.full_name,
        tenants_employee: u.tenants_employee,
      });
    });
  }
  const messageIds = [...new Set(rows.map(r => r.message_id).filter((id): id is number => id != null))];
  let contentByMessageId = new Map<number, string>();
  if (messageIds.length > 0) {
    const { data: msgs } = await supabase.from('messages').select('id, content').in('id', messageIds);
    (msgs || []).forEach((m: { id: number; content?: string | null }) => {
      contentByMessageId.set(m.id, (m.content && String(m.content).trim()) || '');
    });
  }
  return rows.map((r: any) => ({
    ...r,
    flagger: userMap.get(r.user_id) ?? null,
    _messagePreview: contentByMessageId.get(r.message_id) ?? null,
  })) as RmqMessageLeadFlagWithPreview[];
}

export { flagTypeLabel };
