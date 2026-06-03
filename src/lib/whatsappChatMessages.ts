import type { SupabaseClient } from '@supabase/supabase-js';

export const WHATSAPP_CHAT_MESSAGE_PAGE_SIZE = 20;

/** Extra rows fetched for contact threads that need client-side phone matching. */
const CONTACT_PHONE_MATCH_BUFFER = 15;

export type WhatsAppThreadPageQuery = {
  leadId?: string | null;
  legacyId?: number | null;
  contactId?: number | null;
  beforeSentAt?: string | null;
  limit?: number;
};

/** Resolve DB filters for chat pagination (newest page first; older pages via beforeSentAt). */
export function buildWhatsAppThreadQuery(
  client: {
    id?: unknown;
    isContact?: boolean;
    contact_id?: number | null;
    lead_id?: unknown;
    lead_type?: string;
  },
  opts?: { beforeSentAt?: string | null; limit?: number },
): WhatsAppThreadPageQuery {
  const isLegacy =
    client.lead_type === 'legacy' || String(client.id ?? '').startsWith('legacy_');

  if (client.isContact && client.contact_id != null) {
    const leadIdForQuery = client.lead_id;
    const legacyIdForContact =
      isLegacy && leadIdForQuery
        ? Number(String(leadIdForQuery).replace('legacy_', ''))
        : NaN;
    return {
      leadId: isLegacy || Number.isNaN(legacyIdForContact) ? null : String(leadIdForQuery),
      legacyId: !Number.isNaN(legacyIdForContact) ? legacyIdForContact : null,
      contactId: Number(client.contact_id),
      beforeSentAt: opts?.beforeSentAt ?? null,
      limit: opts?.limit,
    };
  }

  if (isLegacy) {
    const legacyId = Number(String(client.id).replace('legacy_', ''));
    return {
      legacyId: Number.isNaN(legacyId) ? null : legacyId,
      beforeSentAt: opts?.beforeSentAt ?? null,
      limit: opts?.limit,
    };
  }

  return {
    leadId: String(client.id ?? ''),
    beforeSentAt: opts?.beforeSentAt ?? null,
    limit: opts?.limit,
  };
}

export type WhatsAppThreadPageResult = {
  rows: any[];
  hasMore: boolean;
};

/**
 * Fetch one page of messages (newest first in DB, returned oldest-first for chat UI).
 */
export async function fetchWhatsAppThreadPage(
  client: SupabaseClient,
  query: WhatsAppThreadPageQuery,
): Promise<WhatsAppThreadPageResult> {
  const pageSize = query.limit ?? WHATSAPP_CHAT_MESSAGE_PAGE_SIZE;
  const fetchLimit = pageSize + 1;

  let q = client.from('whatsapp_messages').select('*');

  if (query.legacyId != null && !Number.isNaN(query.legacyId)) {
    q = q.eq('legacy_id', query.legacyId);
  } else if (query.leadId) {
    q = q.eq('lead_id', query.leadId);
  }

  if (query.contactId != null) {
    q = q.eq('contact_id', query.contactId);
  }

  if (query.beforeSentAt) {
    q = q.lt('sent_at', query.beforeSentAt);
  }

  const { data, error } = await q.order('sent_at', { ascending: false }).limit(fetchLimit);

  if (error) {
    console.error('WhatsApp: thread page fetch error', error);
    return { rows: [], hasMore: false };
  }

  const batch = data || [];
  const hasMore = batch.length > pageSize;
  const slice = hasMore ? batch.slice(0, pageSize) : batch;
  return { rows: [...slice].reverse(), hasMore };
}

export function normalizePhoneDigits(phone: string): string {
  return phone ? phone.replace(/\D/g, '') : '';
}

export function messageMatchesContactPhones(
  msg: { phone_number?: string | null; contact_id?: number | null },
  contactId: number,
  normalizedContactPhone: string,
  normalizedContactMobile: string,
): boolean {
  if (msg.contact_id != null && Number(msg.contact_id) === contactId) {
    return true;
  }
  if (!msg.phone_number) return false;
  const normalizedMsgPhone = normalizePhoneDigits(msg.phone_number);
  const endsMatch = (a: string, b: string) =>
    a &&
    b &&
    ((a.length >= 8 && b.length >= 8 && (a.endsWith(b.slice(-8)) || b.endsWith(a.slice(-8)))) ||
      (a.length >= 4 && b.length >= 4 && (a.endsWith(b.slice(-4)) || b.endsWith(a.slice(-4)))) ||
      a === b);

  return (
    endsMatch(normalizedMsgPhone, normalizedContactPhone) ||
    endsMatch(normalizedMsgPhone, normalizedContactMobile)
  );
}

/**
 * Contact threads: paginate by lead/legacy, filter by phone/contact_id client-side on a small batch.
 */
export async function fetchWhatsAppContactThreadPage(
  client: SupabaseClient,
  params: {
    leadId?: string | null;
    legacyId?: number | null;
    contactId: number;
    contactPhone: string;
    contactMobile: string;
    beforeSentAt?: string | null;
    limit?: number;
  },
): Promise<WhatsAppThreadPageResult> {
  const pageSize = params.limit ?? WHATSAPP_CHAT_MESSAGE_PAGE_SIZE;
  const fetchLimit = pageSize + 1;

  let q = client.from('whatsapp_messages').select('*').eq('contact_id', params.contactId);
  if (params.legacyId != null && !Number.isNaN(params.legacyId)) {
    q = q.eq('legacy_id', params.legacyId);
  } else if (params.leadId) {
    q = q.eq('lead_id', params.leadId);
  }
  if (params.beforeSentAt) {
    q = q.lt('sent_at', params.beforeSentAt);
  }

  const { data, error } = await q.order('sent_at', { ascending: false }).limit(fetchLimit);
  if (!error && (data?.length ?? 0) > 0) {
    const batch = data || [];
    const hasMore = batch.length > pageSize;
    const slice = hasMore ? batch.slice(0, pageSize) : batch;
    return { rows: [...slice].reverse(), hasMore };
  }

  const dbLimit = pageSize + CONTACT_PHONE_MATCH_BUFFER + 1;
  let fallbackQ = client.from('whatsapp_messages').select('*');
  if (params.legacyId != null && !Number.isNaN(params.legacyId)) {
    fallbackQ = fallbackQ.eq('legacy_id', params.legacyId);
  } else if (params.leadId) {
    fallbackQ = fallbackQ.eq('lead_id', params.leadId);
  }
  if (params.beforeSentAt) {
    fallbackQ = fallbackQ.lt('sent_at', params.beforeSentAt);
  }

  const fallback = await fallbackQ.order('sent_at', { ascending: false }).limit(dbLimit);
  if (fallback.error) {
    console.error('WhatsApp: contact thread fallback error', fallback.error);
    return { rows: [], hasMore: false };
  }

  const normalizedContactPhone = normalizePhoneDigits(params.contactPhone);
  const normalizedContactMobile = normalizePhoneDigits(params.contactMobile);
  const matched = (fallback.data || []).filter((msg) =>
    messageMatchesContactPhones(msg, params.contactId, normalizedContactPhone, normalizedContactMobile),
  );

  const hasMore = (fallback.data?.length ?? 0) >= dbLimit || matched.length > pageSize;
  const page = matched.slice(0, pageSize);
  return { rows: [...page].reverse(), hasMore };
}

/** Poll only messages newer than the newest loaded message in the open chat. */
export async function fetchWhatsAppThreadNewerThan(
  client: SupabaseClient,
  query: WhatsAppThreadPageQuery & { afterSentAt: string },
): Promise<any[]> {
  let q = client.from('whatsapp_messages').select('*');

  if (query.legacyId != null && !Number.isNaN(query.legacyId)) {
    q = q.eq('legacy_id', query.legacyId);
  } else if (query.leadId) {
    q = q.eq('lead_id', query.leadId);
  }

  if (query.contactId != null) {
    q = q.eq('contact_id', query.contactId);
  }

  const { data, error } = await q
    .gt('sent_at', query.afterSentAt)
    .order('sent_at', { ascending: true })
    .limit(50);

  if (error) {
    console.error('WhatsApp: newer messages poll error', error);
    return [];
  }
  return data || [];
}
