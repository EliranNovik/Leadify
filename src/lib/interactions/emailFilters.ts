/**
 * Email address matching helpers for the interactions / emails Supabase queries.
 * Kept out of InteractionsTab.tsx to shrink the component.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Max wait for address-only ilike matching (recipient_list scans are slow at scale). */
const EMAIL_ADDRESS_MATCH_TIMEOUT_MS = 3500;

/** Core columns only — no contact embed (contact_id may point at leads_contact or contacts). */
export const EMAIL_SELECT_CORE =
  'id, message_id, subject, sent_at, direction, sender_email, recipient_list, body_html, body_preview, attachments, contact_id, client_id, legacy_id';

export const EMAIL_TIMELINE_SELECT = EMAIL_SELECT_CORE;

export const EMAIL_MODAL_SELECT =
  'id, message_id, sender_name, sender_email, recipient_list, subject, body_html, body_preview, sent_at, direction, attachments, contact_id, client_id, legacy_id';

/** EmailThreadModal thread load (includes read state for mark-as-read). */
export const EMAIL_THREAD_MODAL_SELECT = `${EMAIL_MODAL_SELECT}, is_read`;

export const normalizeEmailForFilter = (value?: string | null) =>
  value ? value.trim().toLowerCase() : '';

export const sanitizeEmailForFilter = (value: string) =>
  value.replace(/[^a-z0-9@._+!~-]/g, '');

export const collectClientEmails = (client: any): string[] => {
  const emails: string[] = [];
  const pushEmail = (val?: string | null) => {
    const normalized = normalizeEmailForFilter(val);
    if (normalized) {
      emails.push(normalized);
    }
  };

  pushEmail(client?.email);

  const extraEmails = (client as any)?.emails;
  if (Array.isArray(extraEmails)) {
    extraEmails.forEach((entry: any) => {
      if (typeof entry === 'string') {
        pushEmail(entry);
      } else if (entry && typeof entry === 'object') {
        if (typeof entry.email === 'string') {
          pushEmail(entry.email);
        }
        if (typeof entry.value === 'string') {
          pushEmail(entry.value);
        }
        if (typeof entry.address === 'string') {
          pushEmail(entry.address);
        }
      }
    });
  }

  return Array.from(new Set(emails));
};

export const buildEmailFilterClauses = (params: {
  clientId?: string | null;
  legacyId?: number | null;
  emails: string[];
}) => {
  const clauses: string[] = [];

  if (params.legacyId !== undefined && params.legacyId !== null && !Number.isNaN(params.legacyId)) {
    clauses.push(`legacy_id.eq.${params.legacyId}`);
  }

  if (params.clientId) {
    clauses.push(`client_id.eq.${params.clientId}`);
  }

  params.emails.forEach((email) => {
    const sanitized = sanitizeEmailForFilter(email);
    if (sanitized) {
      clauses.push(`sender_email.ilike.${sanitized}`);
      clauses.push(`recipient_list.ilike.%${sanitized}%`);
    }
  });

  return clauses;
};

/**
 * Same lead-scope OR filter as InteractionsTab timeline and email modal.
 * Ensures rows tied to the lead via client_id/legacy_id are included together with sender/recipient address matches
 * (e.g. meeting invites sent from a mailbox before client_id was set).
 */
export function applyLeadEmailsOrFilterToQuery(
  emailQuery: { or: (filter: string) => any; eq: (column: string, value: unknown) => any },
  options: {
    isLegacyLead: boolean;
    legacyId: number | null;
    clientId: string | number | null | undefined;
    emailFilters: string[];
  }
): any {
  const { isLegacyLead, legacyId, clientId, emailFilters } = options;

  if (isLegacyLead && legacyId !== null) {
    const emailOnlyFilters = emailFilters.filter((f) => !f.startsWith('legacy_id.eq.'));
    if (emailOnlyFilters.length > 0) {
      return emailQuery.or(`legacy_id.eq.${legacyId},${emailOnlyFilters.join(',')}`);
    }
    return emailQuery.eq('legacy_id', legacyId);
  }

  if (!isLegacyLead && clientId) {
    const emailOnlyFilters = emailFilters.filter((f) => !f.startsWith('client_id.eq.'));
    if (emailOnlyFilters.length > 0) {
      return emailQuery.or(`client_id.eq.${clientId},${emailOnlyFilters.join(',')}`);
    }
    return emailQuery.eq('client_id', clientId);
  }

  if (emailFilters.length > 0) {
    return emailQuery.or(emailFilters.join(','));
  }

  return emailQuery;
}

/**
 * Stable id for UI + hydration: Graph message id when present, otherwise DB row id (string).
 * Meeting/calendar rows are often saved before message_id exists; timeline already uses this fallback.
 */
/** Whether an email row should appear on the interactions timeline (modal uses raw fetch; timeline must not over-filter). */
export function emailInteractionVisibleOnTimeline(interaction: {
  kind?: string;
  id?: unknown;
  subject?: string | null;
  content?: string | null;
}): boolean {
  if (interaction.kind !== 'email') return true;
  const id = interaction.id != null ? String(interaction.id) : '';
  if (id.startsWith('manual_')) return true;
  const subject = (interaction.subject || '').trim();
  const text = (interaction.content || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Boolean(subject || text);
}

export function stableEmailRowId(row: { message_id?: string | null; id?: string | number | null }): string {
  const mid = row.message_id;
  if (mid != null && String(mid).trim() !== '') {
    return String(mid);
  }
  if (row.id != null && String(row.id).trim() !== '') {
    return String(row.id);
  }
  return '';
}

function mergeEmailRowsById(primary: any[], secondary: any[], limit: number): any[] {
  const seen = new Set<string>();
  const merged: any[] = [];
  for (const row of [...primary, ...secondary]) {
    const key = row?.id != null ? String(row.id) : '';
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(row);
  }
  merged.sort((a, b) => {
    const ta = a.sent_at ? new Date(a.sent_at).getTime() : 0;
    const tb = b.sent_at ? new Date(b.sent_at).getTime() : 0;
    return tb - ta;
  });
  return merged.slice(0, limit);
}

function withQueryTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('email_query_timeout')), ms);
    }),
  ]);
}

/**
 * Fetch emails for a lead: indexed client_id/legacy_id first, then merge address matches
 * (sender/recipient ilike) with a short timeout so slow scans do not block the tab.
 */
export async function fetchLeadEmailsForTimeline(
  supabaseClient: SupabaseClient,
  options: {
    isLegacyLead: boolean;
    legacyId: number | null;
    clientId: string | number | null | undefined;
    emailFilters: string[];
    limit: number;
    select?: string;
    /** When true (default), also match contact/lead email addresses on sender/recipient. */
    matchByAddress?: boolean;
  }
): Promise<{ data: any[]; error: unknown }> {
  const {
    isLegacyLead,
    legacyId,
    clientId,
    emailFilters,
    limit,
    select = EMAIL_TIMELINE_SELECT,
    matchByAddress = true,
  } = options;

  const hasLeadScope =
    (isLegacyLead && legacyId != null && !Number.isNaN(legacyId)) ||
    (!isLegacyLead && clientId != null && clientId !== '');

  if (!hasLeadScope && emailFilters.length === 0) {
    return { data: [], error: null };
  }

  const buildBase = () =>
    supabaseClient.from('emails').select(select).limit(limit).order('sent_at', { ascending: false });

  let fastRows: any[] = [];
  let error: unknown = null;

  if (hasLeadScope) {
    let fastQuery = buildBase();
    if (isLegacyLead && legacyId != null && !Number.isNaN(legacyId)) {
      fastQuery = fastQuery.eq('legacy_id', legacyId);
    } else {
      fastQuery = fastQuery.eq('client_id', clientId as string);
    }
    const fastResult = await fastQuery;
    fastRows = fastResult.data || [];
    error = fastResult.error;
  }

  if (!matchByAddress) {
    return { data: fastRows, error };
  }

  if (emailFilters.length === 0) {
    return { data: fastRows, error };
  }

  let addressQuery = buildBase();
  addressQuery = applyLeadEmailsOrFilterToQuery(addressQuery, {
    isLegacyLead,
    legacyId,
    clientId,
    emailFilters,
  });

  try {
    const addressResult = await withQueryTimeout(addressQuery, EMAIL_ADDRESS_MATCH_TIMEOUT_MS);
    const addressRows = addressResult.data || [];
    if (!error && addressResult.error) {
      error = addressResult.error;
    }
    return {
      data: mergeEmailRowsById(fastRows, addressRows, limit),
      error,
    };
  } catch {
    return { data: fastRows, error };
  }
}
