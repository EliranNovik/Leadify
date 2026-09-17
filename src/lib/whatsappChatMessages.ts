import type { SupabaseClient } from '@supabase/supabase-js';
import {
  canonicalWhatsAppPhone,
  collectWhatsAppPhoneVariants,
  whatsAppPhoneLookupNeedle,
  whatsAppPhonesMatch,
} from './whatsappPhone';

export const WHATSAPP_CHAT_MESSAGE_PAGE_SIZE = 20;

/** Extra rows fetched for contact threads that need client-side phone matching. */
const CONTACT_PHONE_MATCH_BUFFER = 15;

export type WhatsAppThreadPageQuery = {
  leadId?: string | null;
  legacyId?: number | null;
  contactId?: number | null;
  phones?: string[];
  beforeSentAt?: string | null;
  limit?: number;
};

function looksLikeUuid(value: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value || '').trim(),
  );
}

function applyThreadIdentityFilter(q: any, query: WhatsAppThreadPageQuery) {
  if (query.leadId && query.contactId != null) {
    return q.eq('lead_id', query.leadId).eq('contact_id', query.contactId);
  }
  if (query.legacyId != null && !Number.isNaN(query.legacyId) && query.contactId != null) {
    return q.eq('legacy_id', query.legacyId).eq('contact_id', query.contactId);
  }

  const parts: string[] = [];
  if (query.leadId) parts.push(`lead_id.eq.${query.leadId}`);
  if (query.legacyId != null && !Number.isNaN(query.legacyId)) {
    parts.push(`legacy_id.eq.${query.legacyId}`);
  }
  if (query.contactId != null) parts.push(`contact_id.eq.${query.contactId}`);
  const phones = [...new Set((query.phones || []).map((p) => String(p).trim()).filter(Boolean))];
  // Never OR phone with lead identity: copies on other leads that share the number
  // would all appear in this thread.
  if (parts.length === 0 && phones.length) {
    return q.in('phone_number', phones);
  }
  if (parts.length === 1) {
    if (query.leadId && parts[0].startsWith('lead_id.eq.')) return q.eq('lead_id', query.leadId);
    if (query.legacyId != null && parts[0].startsWith('legacy_id.eq.')) {
      return q.eq('legacy_id', query.legacyId);
    }
    if (query.contactId != null && parts[0].startsWith('contact_id.eq.')) {
      return q.eq('contact_id', query.contactId);
    }
  }
  if (parts.length > 1) return q.or(parts.join(','));
  return q;
}

/** Resolve DB filters for chat pagination (newest page first; older pages via beforeSentAt). */
export function buildWhatsAppThreadQuery(
  client: {
    id?: unknown;
    isContact?: boolean;
    contact_id?: number | null;
    lead_id?: unknown;
    lead_type?: string;
    phone?: string | null;
    mobile?: string | null;
  },
  opts?: { beforeSentAt?: string | null; limit?: number; extraPhones?: Array<string | null | undefined> },
): WhatsAppThreadPageQuery {
  const isLegacy =
    client.lead_type === 'legacy' || String(client.id ?? '').startsWith('legacy_');
  const phones = collectWhatsAppPhoneVariants([
    client.phone,
    client.mobile,
    ...(opts?.extraPhones || []),
  ]);

  if (client.isContact && client.contact_id != null) {
    const leadIdRaw = String(client.lead_id ?? '').replace(/^legacy_/i, '').trim();
    const uuidLead = looksLikeUuid(leadIdRaw);
    const legacyNum = Number(leadIdRaw);
    const useLegacy = !uuidLead && Number.isFinite(legacyNum) && isLegacy;
    return {
      leadId: uuidLead ? leadIdRaw : !useLegacy && leadIdRaw ? leadIdRaw : null,
      legacyId: useLegacy ? legacyNum : null,
      contactId: Number(client.contact_id),
      phones,
      beforeSentAt: opts?.beforeSentAt ?? null,
      limit: opts?.limit,
    };
  }

  if (isLegacy) {
    const legacyId = Number(String(client.id).replace(/^legacy_/i, ''));
    return {
      legacyId: Number.isNaN(legacyId) ? null : legacyId,
      phones,
      beforeSentAt: opts?.beforeSentAt ?? null,
      limit: opts?.limit,
    };
  }

  return {
    leadId: String(client.id ?? ''),
    phones,
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

  let q = applyThreadIdentityFilter(client.from('whatsapp_messages').select('*'), query);

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
  return canonicalWhatsAppPhone(phone) || String(phone || '').replace(/\D/g, '');
}

export function messageMatchesContactPhones(
  msg: { phone_number?: string | null; contact_id?: number | null },
  contactId: number,
  normalizedContactPhone: string,
  normalizedContactMobile: string,
): boolean {
  if (msg.contact_id != null && Number(msg.contact_id) === Number(contactId)) {
    return true;
  }
  if (!msg.phone_number) return false;
  return (
    whatsAppPhonesMatch(msg.phone_number, normalizedContactPhone) ||
    whatsAppPhonesMatch(msg.phone_number, normalizedContactMobile)
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

  let q = client.from('whatsapp_messages').select('*');
  q = applyThreadIdentityFilter(q, {
    leadId: params.leadId,
    legacyId: params.legacyId,
    contactId: params.contactId,
    phones: collectWhatsAppPhoneVariants([params.contactPhone, params.contactMobile]),
  });
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
  fallbackQ = applyThreadIdentityFilter(fallbackQ, {
    leadId: params.leadId,
    legacyId: params.legacyId,
    phones: collectWhatsAppPhoneVariants([params.contactPhone, params.contactMobile]),
  });
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

const LEAD_THREAD_PAGE = 1000;
const LEAD_THREAD_MAX = 4000;

/**
 * Load a lead/legacy thread newest-first in pages.
 * PostgREST defaults to 1000 rows; ordering ascending returns the oldest slice and hides new messages.
 */
export async function fetchWhatsAppRowsPaged(
  client: SupabaseClient,
  opts: {
    leadId?: string | null;
    legacyId?: number | null;
    phones?: string[] | null;
    pageSize?: number;
    maxRows?: number;
  },
): Promise<any[]> {
  const pageSize = opts.pageSize ?? LEAD_THREAD_PAGE;
  const maxRows = opts.maxRows ?? LEAD_THREAD_MAX;
  const phones = [...new Set((opts.phones || []).map((p) => String(p).trim()).filter(Boolean))];
  const rows: any[] = [];

  for (let from = 0; from < maxRows; from += pageSize) {
    let q = client.from('whatsapp_messages').select('*');
    if (opts.leadId) q = q.eq('lead_id', opts.leadId);
    else if (opts.legacyId != null && !Number.isNaN(Number(opts.legacyId))) {
      q = q.eq('legacy_id', opts.legacyId);
    }
    if (phones.length) q = q.in('phone_number', phones);
    if (!opts.leadId && (opts.legacyId == null || Number.isNaN(Number(opts.legacyId))) && !phones.length) {
      break;
    }

    const { data, error } = await q
      .order('sent_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) {
      console.error('WhatsApp: paged thread fetch error', error);
      break;
    }
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  return [...rows].reverse();
}

const PHONE_MATCH_PAGE = 1000;

function applyUnconnectedFilter(q: any, unconnectedOnly?: boolean) {
  if (!unconnectedOnly) return q;
  return q.is('lead_id', null).is('legacy_id', null);
}

/**
 * Find WhatsApp rows for a phone even when the stored value has dashes/spaces.
 * Combines variant `.in()` with a last-7 `ilike`, then confirms with `whatsAppPhonesMatch`.
 */
export async function findWhatsAppMessagesMatchingPhone(
  client: SupabaseClient,
  phone: string,
  opts?: {
    extraPhones?: Array<string | null | undefined>;
    unconnectedOnly?: boolean;
    select?: string;
    maxRows?: number;
  },
): Promise<any[]> {
  const select = opts?.select || 'id, phone_number, lead_id, legacy_id, contact_id';
  const maxRows = opts?.maxRows ?? 4000;
  const extraPhones = opts?.extraPhones || [];
  const variants = collectWhatsAppPhoneVariants([phone, ...extraPhones]);
  const needle = whatsAppPhoneLookupNeedle(phone);
  const byId = new Map<number, any>();

  const ingest = (batch: any[] | null | undefined) => {
    for (const row of batch || []) {
      const id = Number(row?.id);
      if (!Number.isFinite(id) || id <= 0 || byId.has(id)) continue;
      const stored = row?.phone_number;
      const matches =
        whatsAppPhonesMatch(stored, phone) ||
        extraPhones.some((candidate) => whatsAppPhonesMatch(stored, candidate));
      if (!matches) continue;
      byId.set(id, row);
    }
  };

  const fetchRange = async (build: () => any) => {
    for (let from = 0; from < maxRows; from += PHONE_MATCH_PAGE) {
      const { data, error } = await build().range(from, from + PHONE_MATCH_PAGE - 1);
      if (error) {
        console.error('WhatsApp: phone match fetch error', error);
        break;
      }
      const batch = data || [];
      ingest(batch);
      if (batch.length < PHONE_MATCH_PAGE) break;
    }
  };

  for (let i = 0; i < variants.length; i += 50) {
    const chunk = variants.slice(i, i + 50);
    await fetchRange(() =>
      applyUnconnectedFilter(
        client.from('whatsapp_messages').select(select).in('phone_number', chunk),
        opts?.unconnectedOnly,
      ),
    );
  }

  if (needle.length >= 6) {
    await fetchRange(() =>
      applyUnconnectedFilter(
        client.from('whatsapp_messages').select(select).ilike('phone_number', `%${needle}%`),
        opts?.unconnectedOnly,
      ),
    );
  }

  return Array.from(byId.values());
}

export async function linkUnconnectedWhatsAppMessagesToLead(
  client: SupabaseClient,
  phone: string,
  patch: {
    lead_id?: string | null;
    legacy_id?: number | null;
    contact_id?: number | null;
  },
  extraPhones?: Array<string | null | undefined>,
): Promise<{ updated: number; ids: number[]; error?: string }> {
  const rows = await findWhatsAppMessagesMatchingPhone(client, phone, {
    extraPhones,
    unconnectedOnly: true,
    select: 'id, phone_number, lead_id, legacy_id, contact_id',
  });
  const ids = [...new Set(rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return { updated: 0, ids: [] };

  let updated = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await client
      .from('whatsapp_messages')
      .update(patch)
      .in('id', chunk)
      .select('id');
    if (error) {
      return { updated, ids: ids.slice(0, updated), error: error.message };
    }
    updated += (data || []).length;
  }
  return { updated, ids };
}

/** Poll only messages newer than the newest loaded message in the open chat. */
export async function fetchWhatsAppThreadNewerThan(
  client: SupabaseClient,
  query: WhatsAppThreadPageQuery & { afterSentAt: string },
): Promise<any[]> {
  let q = applyThreadIdentityFilter(client.from('whatsapp_messages').select('*'), query);

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
