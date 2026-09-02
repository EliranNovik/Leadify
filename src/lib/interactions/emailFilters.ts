/**
 * Email address matching helpers for the interactions / emails Supabase queries.
 * Kept out of InteractionsTab.tsx to shrink the component.
 *
 * Performance rules for the large `emails` table:
 * - Prefer indexed client_id / legacy_id lookups, or email_lead_timeline RPC.
 * - Never drive queries with recipient_list ILIKE (seq-scan / 57014).
 * - Never PostgREST-filter emails by sender_email: parameterized
 *   `sender_email = $1` cannot use idx_emails_sender_email_sent_at
 *   (partial: btrim(sender_email) <> '') and seq-scans ~5M rows.
 * - Address matching belongs in email_lead_timeline (predicates match the index).
 * - List fetches omit body_html; hydrate bodies on demand.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { interactionTimestampMs } from './timelineTimestamp';

/** Max wait for optional address matching (must not block the tab). */
const EMAIL_ADDRESS_MATCH_TIMEOUT_MS = 2500;

/** Default lookback for address / meta scans. */
const EMAIL_ADDRESS_LOOKBACK_DAYS = 365;

/** Core columns including body — use only when hydrating a single thread. */
export const EMAIL_SELECT_CORE =
  'id, message_id, subject, sent_at, direction, sender_email, recipient_list, body_html, body_preview, attachments, contact_id, client_id, legacy_id';

/** Fast list/timeline select — no body_html (hydrate later). */
export const EMAIL_LIST_SELECT =
  'id, message_id, subject, sent_at, direction, sender_email, recipient_list, body_preview, attachments, contact_id, client_id, legacy_id, sender_name';

export const EMAIL_TIMELINE_SELECT = EMAIL_LIST_SELECT;

export const EMAIL_BODY_HYDRATE_SELECT = 'id, body_html';

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

/**
 * Build PostgREST OR clauses for lead-scoped email fetch.
 * Address clauses use sender_email.eq only — never recipient_list.ilike.
 */
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
      clauses.push(`sender_email.eq.${sanitized}`);
    }
  });

  return clauses;
};

/**
 * Same lead-scope OR filter as InteractionsTab timeline and email modal.
 * Address matches are sender_email only (see buildEmailFilterClauses).
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

/** Strip Re:/Fwd: prefixes so related emails share one conversation key. */
export function normalizeEmailSubjectKey(subject?: string | null): string {
  let s = String(subject || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  // Repeat — subjects can be "Re: Re: Fwd: …"
  for (let i = 0; i < 8; i++) {
    const next = s.replace(/^(re|fw|fwd|aw|sv|vs|antw)\s*:\s*/i, '').trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

export function displayConversationSubject(subject?: string | null): string {
  let s = String(subject || '').trim();
  if (!s) return '(no subject)';
  for (let i = 0; i < 8; i++) {
    const next = s.replace(/^(re|fw|fwd|aw|sv|vs|antw)\s*:\s*/i, '').trim();
    if (next === s) break;
    s = next;
  }
  return s || '(no subject)';
}

/**
 * All emails that belong to the same subject conversation as `selected`,
 * oldest → newest for chat-style reading.
 * Empty / missing subjects never merge with other empties.
 */
export function emailsInSubjectThread<T extends Record<string, any>>(
  emails: T[],
  selected: T | null | undefined,
  opts?: {
    getSubject?: (row: T) => string | null | undefined;
    getDate?: (row: T) => string | null | undefined;
  },
): T[] {
  if (!selected) return [];
  const getSubject = opts?.getSubject || ((row: T) => row.subject);
  const getDate = opts?.getDate || ((row: T) => row.sent_at || row.date);
  const key = normalizeEmailSubjectKey(getSubject(selected));
  if (!key) return [selected];

  const selectedId = String(selected.id ?? '');
  const thread = emails.filter((row) => normalizeEmailSubjectKey(getSubject(row)) === key);
  const withSelected =
    selectedId && !thread.some((row) => String(row.id) === selectedId)
      ? [...thread, selected]
      : thread;

  return [...withSelected].sort((a, b) => {
    const ta = getDate(a) ? new Date(getDate(a) as string).getTime() : 0;
    const tb = getDate(b) ? new Date(getDate(b) as string).getTime() : 0;
    return tb - ta; // newest first
  });
}

export type SubjectConversationGroup<T extends Record<string, any>> = {
  key: string;
  latest: T;
  messages: T[];
  count: number;
};

/**
 * Collapse sidepanel list to one row per subject conversation (Re:/Fwd: stripped).
 * Empty subjects stay as individual rows.
 */
export function groupEmailsIntoSubjectConversations<T extends Record<string, any>>(
  emails: T[],
  opts?: {
    getSubject?: (row: T) => string | null | undefined;
    getDate?: (row: T) => string | null | undefined;
  },
): SubjectConversationGroup<T>[] {
  if (!Array.isArray(emails) || emails.length === 0) return [];

  const getSubject = opts?.getSubject || ((row: T) => row.subject);
  const getDate = opts?.getDate || ((row: T) => row.sent_at || row.date);
  const buckets = new Map<string, T[]>();

  for (const row of emails) {
    const subjectKey = normalizeEmailSubjectKey(getSubject(row));
    const key = subjectKey || `__id:${stableEmailRowId(row) || String(row.id ?? Math.random())}`;
    const list = buckets.get(key);
    if (list) list.push(row);
    else buckets.set(key, [row]);
  }

  const groups: SubjectConversationGroup<T>[] = [];
  for (const [key, rows] of buckets) {
    const messages = [...rows].sort((a, b) => {
      const ta = getDate(a) ? new Date(getDate(a) as string).getTime() : 0;
      const tb = getDate(b) ? new Date(getDate(b) as string).getTime() : 0;
      return ta - tb;
    });
    groups.push({
      key,
      messages,
      count: messages.length,
      latest: messages[messages.length - 1],
    });
  }

  groups.sort((a, b) => {
    const ta = getDate(a.latest) ? new Date(getDate(a.latest) as string).getTime() : 0;
    const tb = getDate(b.latest) ? new Date(getDate(b.latest) as string).getTime() : 0;
    return tb - ta;
  });

  return groups;
}

/** Sidepanel list sort / filter (next to search). */
export type EmailSidepanelListMode = 'newest' | 'oldest' | 'unreplied';

/**
 * Apply sidepanel list mode to subject conversation groups.
 * - newest: newest activity first (default)
 * - oldest: oldest activity first ("Latest emails" chronological)
 * - unreplied: conversations whose latest message is inbox (no reply yet)
 */
export function applyEmailSidepanelListMode<T extends Record<string, any>>(
  groups: SubjectConversationGroup<T>[],
  mode: EmailSidepanelListMode,
  opts: {
    isOutgoing: (message: T) => boolean;
    getDate?: (message: T) => string | null | undefined;
  },
): SubjectConversationGroup<T>[] {
  const getDate =
    opts.getDate || ((message: T) => (message.sent_at || message.date) as string | null | undefined);

  let result = groups;
  if (mode === 'unreplied') {
    result = groups.filter((group) => !opts.isOutgoing(group.latest));
  }

  return [...result].sort((a, b) => {
    const ta = getDate(a.latest) ? new Date(getDate(a.latest) as string).getTime() : 0;
    const tb = getDate(b.latest) ? new Date(getDate(b.latest) as string).getTime() : 0;
    return mode === 'oldest' ? ta - tb : tb - ta;
  });
}

function parseIsoTimestampMs(value?: string | null): number {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emailMinuteBucket(row: {
  sent_at?: string | null;
  date?: string | null;
  raw_date?: string | null;
  time?: string | null;
  kind?: string;
  id?: unknown;
  editable?: boolean;
}): number {
  const isoMs =
    parseIsoTimestampMs(row.sent_at) ||
    parseIsoTimestampMs(row.raw_date) ||
    parseIsoTimestampMs(row.date);
  if (isoMs) return Math.floor(isoMs / 60_000);

  const ms = interactionTimestampMs({
    kind: row.kind,
    id: row.id,
    editable: row.editable,
    date: row.date,
    time: row.time,
    raw_date: row.raw_date || row.sent_at || null,
  });
  return ms ? Math.floor(ms / 60_000) : 0;
}

function normalizeEmailSubjectForDedupe(subject?: string | null): string {
  return String(subject || '')
    .trim()
    .toLowerCase()
    .replace(/^(re|fw|fwd|aw|sv|vs|antw)\s*:\s*/i, '')
    .replace(/\s+/g, ' ');
}

function emailBodySnippet(row: {
  content?: string | null;
  body_html?: string | null;
  body_preview?: string | null;
  bodyPreview?: string | null;
}): string {
  return String(row.body_html || row.bodyPreview || row.body_preview || row.content || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 80);
}

function isSyncedEmailTimelineRow(row: { kind?: string; id?: unknown; editable?: boolean }): boolean {
  const id = String(row.id ?? '');
  const kind = String(row.kind || '');
  if (kind === 'email_manual') return false;
  if (row.editable === true) return false;
  if (id.startsWith('manual_') || id.startsWith('legacy_') || id.startsWith('temp_') || id.startsWith('optimistic_')) {
    return false;
  }
  return kind === 'email';
}

/** Same logical message often lands as multiple DB rows (multi-mailbox sync). */
export function emailContentFingerprint(row: {
  message_id?: string | null;
  id?: string | number | null;
  sent_at?: string | null;
  date?: string | null;
  raw_date?: string | null;
  time?: string | null;
  subject?: string | null;
  sender_email?: string | null;
  from?: string | null;
  sender_name?: string | null;
  sender_display_name?: string | null;
  recipient_list?: string | null;
  to?: string | null;
  direction?: string | null;
  kind?: string;
  editable?: boolean;
}): string {
  const minute = emailMinuteBucket(row);
  const subject = normalizeEmailSubjectForDedupe(row.subject);
  const from = String(
    row.sender_email ||
      row.from ||
      row.sender_display_name ||
      row.sender_name ||
      '',
  )
    .trim()
    .toLowerCase();
  // Direction omitted — mailbox copies of the same send often disagree on incoming/outgoing.
  return `${minute}|${subject}|${from}`;
}

function emailRowRichness(row: any): number {
  const bodyLen = String(
    row?.body_html || row?.bodyPreview || row?.body_preview || row?.content || '',
  ).length;
  const hasMessageId = row?.message_id != null && String(row.message_id).trim() !== '' ? 1_000_000 : 0;
  const hasAttachments = Array.isArray(row?.attachments) && row.attachments.length > 0 ? 10_000 : 0;
  const synced = isSyncedEmailTimelineRow(row) ? 50_000_000 : 0;
  return synced + hasMessageId + hasAttachments + bodyLen;
}

/**
 * Collapse duplicate sidepanel/timeline email rows by Graph message_id / DB id,
 * then by sender+subject+minute fingerprint (multi-mailbox sync duplicates).
 */
export function dedupeEmailsForSidepanel<T extends Record<string, any>>(rows: T[]): T[] {
  if (!Array.isArray(rows) || rows.length <= 1) return rows || [];

  const byStableId = new Map<string, T>();
  const withoutStableId: T[] = [];

  for (const row of rows) {
    const key = stableEmailRowId(row);
    if (!key) {
      withoutStableId.push(row);
      continue;
    }
    const existing = byStableId.get(key);
    if (!existing || emailRowRichness(row) > emailRowRichness(existing)) {
      byStableId.set(key, row);
    }
  }

  const byFingerprint = new Map<string, T>();
  for (const row of [...byStableId.values(), ...withoutStableId]) {
    const fp = emailContentFingerprint(row);
    const existing = byFingerprint.get(fp);
    if (!existing || emailRowRichness(row) > emailRowRichness(existing)) {
      byFingerprint.set(fp, row);
    }
  }

  // Soft pass: subject + minute only (handles missing/mismatched from across sync copies).
  // Empty subjects stay unique — collapsing them would merge unrelated emails in the same minute.
  // Unknown timestamps (minute 0) must not merge — that used to wipe inbox replies that share a subject.
  const bySoft = new Map<string, T>();
  for (const row of byFingerprint.values()) {
    const minute = emailMinuteBucket(row);
    const subject = normalizeEmailSubjectForDedupe(row.subject);
    const softKey =
      subject && minute
        ? `${minute}|${subject}`
        : `${minute || 0}|${subject || ''}|id:${stableEmailRowId(row) || String(row.id ?? '')}`;
    const existing = bySoft.get(softKey);
    if (!existing || emailRowRichness(row) > emailRowRichness(existing)) {
      bySoft.set(softKey, row);
    }
  }

  return Array.from(bySoft.values());
}

function timelineEmailFingerprintRow<T extends Record<string, any>>(row: T) {
  return {
    ...row,
    sent_at: row.sent_at || row.raw_date,
    subject: row.subject || row.observation || '',
    sender_email: row.sender_email,
    from: row.sender_email || row.from,
  };
}

/**
 * Collapse the same email that landed in `emails` AND `lead_manual_interactions`
 * (and/or legacy `leads_leadinteractions`) so the timeline shows it once.
 * Prefers the synced `emails` row when both exist.
 */
export function dedupeTimelineEmailLikeRows<T extends Record<string, any>>(rows: T[]): T[] {
  if (!Array.isArray(rows) || rows.length <= 1) return rows || [];

  const emails: T[] = [];
  const rest: T[] = [];
  for (const row of rows) {
    const kind = String(row.kind || '');
    if (kind === 'email' || kind === 'email_manual') emails.push(row);
    else rest.push(row);
  }

  if (emails.length <= 1) return rows;

  const mapped = emails.map((row) => timelineEmailFingerprintRow(row));
  const unique = dedupeEmailsForSidepanel(mapped);

  const bySnippet = new Map<string, T>();
  for (const row of unique) {
    const minute = emailMinuteBucket(row);
    const subject = normalizeEmailSubjectForDedupe(row.subject || row.observation);
    const snippet = emailBodySnippet(row);
    const key = subject
      ? `${minute}|${subject}`
      : snippet
        ? `${minute}|snip:${snippet}`
        : `${minute}|id:${String(row.id ?? '')}`;
    const existing = bySnippet.get(key);
    if (!existing || emailRowRichness(row) > emailRowRichness(existing)) {
      bySnippet.set(key, row);
    }
  }

  return [...Array.from(bySnippet.values()), ...rest];
}

function mergeEmailRowsById(primary: any[], secondary: any[], limit: number): any[] {
  const merged = dedupeEmailsForSidepanel([...primary, ...secondary]);
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

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Load full HTML bodies for timeline cards. List/RPC fetches omit body_html
 * for speed; without this, cards render flattened body_preview text.
 */
export async function fetchEmailBodiesByIds(
  supabaseClient: SupabaseClient,
  ids: Array<string | number | null | undefined>,
  limit = 40,
): Promise<Map<string, string>> {
  const unique = Array.from(
    new Set(
      ids
        .map((id) => (id == null ? '' : String(id).trim()))
        .filter(
          (id) =>
            Boolean(id) &&
            !id.startsWith('temp_') &&
            !id.startsWith('optimistic_') &&
            !id.startsWith('local-'),
        ),
    ),
  ).slice(0, Math.max(1, limit));

  const bodies = new Map<string, string>();
  if (unique.length === 0) return bodies;

  const numericIds = unique.filter((id) => /^\d+$/.test(id));
  const messageIds = unique.filter((id) => !/^\d+$/.test(id));

  const storeRows = (
    rows: Array<{ id?: string | number; message_id?: string | null; body_html?: string | null }>,
  ) => {
    for (const row of rows) {
      const html = typeof row?.body_html === 'string' ? row.body_html.trim() : '';
      if (!html) continue;
      if (row.id != null) bodies.set(String(row.id), row.body_html as string);
      if (row.message_id) bodies.set(String(row.message_id), row.body_html as string);
    }
  };

  for (const chunk of chunkArray(numericIds, 80)) {
    try {
      const { data, error } = await withQueryTimeout(
        supabaseClient.from('emails').select('id, message_id, body_html').in('id', chunk),
        4000,
      );
      if (!error && data) storeRows(data as any[]);
    } catch {
      /* keep whatever we already loaded */
    }
  }

  for (const chunk of chunkArray(messageIds, 40)) {
    try {
      const { data, error } = await withQueryTimeout(
        supabaseClient.from('emails').select('id, message_id, body_html').in('message_id', chunk),
        4000,
      );
      if (!error && data) storeRows(data as any[]);
    } catch {
      /* keep whatever we already loaded */
    }
  }

  return bodies;
}

/**
 * Fetch emails for a lead: prefer RPC (SECURITY DEFINER, indexed), then
 * direct client_id/legacy_id/contact_id. Never block the UI on sender_email scans.
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
    /** When true (default), also match contact/lead emails on sender_email. */
    matchByAddress?: boolean;
    /** Optional contact ids for indexed contact_id lookups. */
    contactIds?: Array<string | number | null | undefined>;
  }
): Promise<{ data: any[]; error: unknown }> {
  const {
    legacyId,
    clientId,
    emailFilters,
    limit,
    select = EMAIL_TIMELINE_SELECT,
    matchByAddress = true,
    contactIds = [],
  } = options;

  const normalizedContactIds = Array.from(
    new Set(
      contactIds
        .map((id) => (id == null || id === '' ? null : Number(id)))
        .filter((id): id is number => id != null && !Number.isNaN(id)),
    ),
  );

  const senderEmails = emailFilters
    .filter((f) => f.startsWith('sender_email.eq.'))
    .map((f) => f.slice('sender_email.eq.'.length).toLowerCase())
    .filter(Boolean);

  const uuidClientId =
    clientId != null &&
    clientId !== '' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(clientId),
    )
      ? String(clientId)
      : null;
  const hasClientScope = Boolean(uuidClientId);
  const hasLegacyScope = legacyId != null && !Number.isNaN(legacyId);
  const hasLeadScope = hasClientScope || hasLegacyScope;

  if (!hasLeadScope && normalizedContactIds.length === 0 && senderEmails.length === 0) {
    return { data: [], error: null };
  }

  // 1) Fast path: SECURITY DEFINER RPC (avoids PostgREST/RLS quirks on emails)
  try {
    const rpcArgs: Record<string, unknown> = {
      p_limit: limit,
      p_lookback_days: EMAIL_ADDRESS_LOOKBACK_DAYS,
      p_contact_ids: normalizedContactIds.length > 0 ? normalizedContactIds : null,
      // Always pass senders when available — RPC merges them with lead-scoped rows.
      p_sender_emails:
        matchByAddress && senderEmails.length > 0
          ? Array.from(new Set(senderEmails)).slice(0, 20)
          : null,
    };
    rpcArgs.p_client_id = uuidClientId;
    rpcArgs.p_legacy_id = hasLegacyScope ? legacyId : null;

    // Function statement_timeout is 20s; keep client wait slightly under that.
    const rpcResult = await withQueryTimeout(
      supabaseClient.rpc('email_lead_timeline', rpcArgs),
      Math.max(EMAIL_ADDRESS_MATCH_TIMEOUT_MS, 18000),
    );

    let rpcData: unknown = rpcResult?.data;
    if (!rpcResult?.error && typeof rpcData === 'string') {
      try {
        rpcData = JSON.parse(rpcData);
      } catch {
        rpcData = null;
      }
    }
    if (!rpcResult?.error && Array.isArray(rpcData)) {
      return { data: dedupeEmailsForSidepanel(rpcData).slice(0, limit), error: null };
    }
    if (!rpcResult?.error && rpcData && typeof rpcData === 'object' && Array.isArray((rpcData as any).emails)) {
      return { data: dedupeEmailsForSidepanel((rpcData as any).emails).slice(0, limit), error: null };
    }
  } catch {
    /* fall through to direct queries */
  }

  const buildBase = () =>
    supabaseClient.from('emails').select(select).limit(limit).order('sent_at', { ascending: false });

  let fastRows: any[] = [];
  let error: unknown = null;

  if (hasLeadScope) {
    let fastQuery = buildBase();
    if (hasClientScope && hasLegacyScope) {
      fastQuery = fastQuery.or(`client_id.eq.${uuidClientId},legacy_id.eq.${legacyId}`);
    } else if (hasLegacyScope) {
      fastQuery = fastQuery.eq('legacy_id', legacyId);
    } else {
      fastQuery = fastQuery.eq('client_id', uuidClientId);
    }
    try {
      const fastResult = await withQueryTimeout(fastQuery, EMAIL_ADDRESS_MATCH_TIMEOUT_MS);
      fastRows = fastResult.data || [];
      error = fastResult.error;
    } catch {
      /* keep empty */
    }
  }

  if (fastRows.length === 0 && normalizedContactIds.length > 0) {
    try {
      const contactResult = await withQueryTimeout(
        buildBase().in('contact_id', normalizedContactIds),
        EMAIL_ADDRESS_MATCH_TIMEOUT_MS,
      );
      if (!contactResult.error) {
        fastRows = mergeEmailRowsById(fastRows, contactResult.data || [], limit);
      }
    } catch {
      /* ignore */
    }
    try {
      const junction = await withQueryTimeout(
        supabaseClient
          .from('email_contacts')
          .select('email_id')
          .in('contact_id', normalizedContactIds)
          .limit(limit),
        EMAIL_ADDRESS_MATCH_TIMEOUT_MS,
      );
      const emailIds = [...new Set((junction.data || []).map((r: { email_id?: string }) => r.email_id).filter(Boolean))];
      if (emailIds.length > 0) {
        const linked = await withQueryTimeout(
          supabaseClient.from('emails').select(select).in('id', emailIds).order('sent_at', { ascending: false }).limit(limit),
          EMAIL_ADDRESS_MATCH_TIMEOUT_MS,
        );
        if (!linked.error) {
          fastRows = mergeEmailRowsById(fastRows, linked.data || [], limit);
        }
      }
    } catch {
      /* ignore if email_contacts is not migrated yet */
    }
  }

  // Do not fall back to PostgREST `.eq('sender_email')`. That query cannot use
  // the partial (sender_email, sent_at) index and seq-scans emails until 57014.
  // Address matching is already in email_lead_timeline when the RPC is healthy.
  return { data: dedupeEmailsForSidepanel(fastRows).slice(0, limit), error };
}

export type LeadEmailListMeta = {
  last_message_time: string | null;
  unread_count: number;
};

/**
 * Batch last-message + unread counts for many leads (EmailThreadModal contact list).
 * Uses indexed client_id / legacy_id lookups in chunks — avoids N+1.
 */
export async function batchLeadEmailListMeta(
  supabaseClient: SupabaseClient,
  options: {
    clientIds: string[];
    legacyIds: number[];
    unreadDays?: number;
    lookbackDays?: number;
  },
): Promise<{
  byClientId: Map<string, LeadEmailListMeta>;
  byLegacyId: Map<number, LeadEmailListMeta>;
}> {
  const unreadDays = options.unreadDays ?? 7;
  const lookbackDays = options.lookbackDays ?? 180;
  const unreadSince = new Date(Date.now() - unreadDays * 24 * 60 * 60 * 1000).getTime();
  const sinceIso = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  const byClientId = new Map<string, LeadEmailListMeta>();
  const byLegacyId = new Map<number, LeadEmailListMeta>();

  const absorb = (
    rows: Array<{
      id?: string | number;
      client_id?: string | null;
      legacy_id?: number | null;
      sent_at?: string | null;
      direction?: string | null;
      is_read?: boolean | null;
    }>,
  ) => {
    for (const row of rows) {
      const sentAt = row.sent_at || null;
      const sentMs = sentAt ? new Date(sentAt).getTime() : 0;
      const isUnreadIncoming =
        row.direction === 'incoming' &&
        row.is_read !== true &&
        sentMs >= unreadSince;

      if (row.client_id) {
        const key = String(row.client_id);
        const prev = byClientId.get(key) || { last_message_time: null, unread_count: 0 };
        const prevMs = prev.last_message_time ? new Date(prev.last_message_time).getTime() : 0;
        if (sentMs >= prevMs) {
          prev.last_message_time = sentAt;
        }
        if (isUnreadIncoming) prev.unread_count += 1;
        byClientId.set(key, prev);
      }

      if (row.legacy_id != null && !Number.isNaN(Number(row.legacy_id))) {
        const key = Number(row.legacy_id);
        const prev = byLegacyId.get(key) || { last_message_time: null, unread_count: 0 };
        const prevMs = prev.last_message_time ? new Date(prev.last_message_time).getTime() : 0;
        if (sentMs >= prevMs) {
          prev.last_message_time = sentAt;
        }
        if (isUnreadIncoming) prev.unread_count += 1;
        byLegacyId.set(key, prev);
      }
    }
  };

  const clientChunks = chunkArray(
    Array.from(new Set(options.clientIds.filter(Boolean))),
    80,
  );
  for (const chunk of clientChunks) {
    const { data, error } = await supabaseClient
      .from('emails')
      .select('id, client_id, legacy_id, sent_at, direction, is_read')
      .in('client_id', chunk)
      .gte('sent_at', sinceIso)
      .order('sent_at', { ascending: false })
      .limit(Math.min(chunk.length * 25, 1500));
    if (!error && data) absorb(data);
  }

  const legacyChunks = chunkArray(
    Array.from(new Set(options.legacyIds.filter((id) => !Number.isNaN(id)))),
    80,
  );
  for (const chunk of legacyChunks) {
    const { data, error } = await supabaseClient
      .from('emails')
      .select('id, client_id, legacy_id, sent_at, direction, is_read')
      .in('legacy_id', chunk)
      .gte('sent_at', sinceIso)
      .order('sent_at', { ascending: false })
      .limit(Math.min(chunk.length * 25, 1500));
    if (!error && data) absorb(data);
  }

  return { byClientId, byLegacyId };
}
