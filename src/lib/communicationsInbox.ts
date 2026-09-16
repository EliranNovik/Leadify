import { supabase } from './supabase';
import { resolveSessionUser } from './resolveSessionUser';
import { employeeHasAnySalesRoleOnLeadBundle } from '../utils/rolePercentageCalculator';
import { fetchHeaderUnreadEmailsForBadge } from './headerEmailNotifications';
import { htmlToPlainEmail } from './emailBodyHtml';
import { fetchContactIdsLinkedToLeads } from './whatsappPageLoadHelpers';

const LOOKBACK_DAYS = 90;
const MAX_ASSIGNED_LEADS = 200;
const ID_CHUNK = 40;
const MSG_PER_CHUNK = 80;
const QUERY_CONCURRENCY = 3;
const THREAD_LIMIT = 80;
const CACHE_MS = 45_000;
const CACHE_VERSION = 6;
const LATEST_WA_LIMIT = 500;
const WA_SELECT =
  'id, lead_id, legacy_id, contact_id, sender_id, sender_name, message, sent_at, direction, is_read, phone_number';

export type InboxChannel = 'whatsapp' | 'email';
export type InboxQueueTab = 'all' | 'inbox' | 'needs_reply' | 'waiting' | 'unread';
export type InboxContactScope = 'all' | 'mine';
export type InboxConversationState = 'needs_reply' | 'waiting';

export type InboxActor = {
  authUserId: string;
  userRowId: string | null;
  employeeId: number | null;
  displayName: string;
};

export type InboxConversation = {
  key: string;
  leadType: 'new' | 'legacy';
  newLeadId: string | null;
  legacyLeadId: number | null;
  leadName: string;
  leadNumber: string | null;
  leadIdentifier: string;
  stage: string | null;
  category: string | null;
  email: string | null;
  phone: string | null;
  lastSnippet: string;
  lastChannel: InboxChannel;
  lastAt: string;
  lastDirection: 'in' | 'out';
  unreadCount: number;
  needsReply: boolean;
  state: InboxConversationState;
  waitingMs: number | null;
  channels: InboxChannel[];
  isMine: boolean;
};

export type InboxCounts = {
  needsReply: number;
  unread: number;
  waiting: number;
};

export type InboxThreadItem = {
  id: string;
  channel: InboxChannel;
  direction: 'in' | 'out';
  sentAt: string;
  sender: string;
  content: string;
  isRead: boolean;
};

type EmailRow = {
  id: string;
  client_id?: string | null;
  legacy_id?: number | string | null;
  sender_name?: string | null;
  sender_email?: string | null;
  subject?: string | null;
  body_preview?: string | null;
  body_html?: string | null;
  sent_at?: string | null;
  direction?: string | null;
  is_read?: boolean | null;
};

type WhatsAppRow = {
  id: number | string;
  lead_id?: string | null;
  legacy_id?: number | string | null;
  contact_id?: number | string | null;
  sender_id?: string | null;
  sender_name?: string | null;
  message?: string | null;
  sent_at?: string | null;
  direction?: string | null;
  is_read?: boolean | null;
  phone_number?: string | null;
};

const NEW_LEAD_SELECT = `
  id,
  name,
  lead_number,
  stage,
  topic,
  email,
  phone,
  mobile,
  closer,
  scheduler,
  handler,
  case_handler_id,
  manager,
  expert,
  expert_id,
  helper,
  meeting_lawyer_id,
  lawyer,
  retainer_handler_id,
  meeting_collection_id,
  marketing_officer_id,
  meeting_manager_id
`;

const LEGACY_LEAD_SELECT = `
  id,
  name,
  lead_number,
  stage,
  topic,
  email,
  phone,
  mobile,
  closer_id,
  meeting_scheduler_id,
  meeting_manager_id,
  meeting_lawyer_id,
  case_handler_id,
  expert_id,
  retainer_handler_id,
  meeting_collection_id,
  marketing_officer_id
`;

function lookbackIso(days = LOOKBACK_DAYS): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function asLegacyId(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/^legacy_?/i, ''));
  return Number.isFinite(n) ? n : null;
}

function isInboundEmail(direction?: string | null): boolean {
  return String(direction || '').toLowerCase() === 'incoming';
}

function isInboundWhatsApp(direction?: string | null): boolean {
  return String(direction || '').toLowerCase() === 'in';
}

function preserveOriginalBreaks(text: string): string {
  let s = String(text || '');
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!s.includes('\n') && /\\n/.test(s)) s = s.replace(/\\n/g, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function emailBodyText(row: EmailRow): string {
  const html = String(row.body_html || '').trim();
  if (html) return htmlToPlainEmail(html);
  return preserveOriginalBreaks(row.body_preview || '');
}

function snippetFromEmail(row: EmailRow): string {
  const subject = String(row.subject || '').trim();
  const preview = emailBodyText(row);
  if (subject && preview && preview !== subject) return `${subject}\n${preview}`;
  return subject || preview || '(email)';
}

function snippetFromWhatsApp(row: WhatsAppRow): string {
  return preserveOriginalBreaks(row.message || '') || '(WhatsApp)';
}

function emailThreadContent(row: EmailRow): string {
  const subject = String(row.subject || '').trim();
  const body = emailBodyText(row);
  if (subject && body && !body.startsWith(subject)) return `${subject}\n\n${body}`;
  return body || subject || '(email)';
}

function whatsappThreadContent(row: WhatsAppRow): string {
  return preserveOriginalBreaks(row.message || '') || '(WhatsApp)';
}

type QueryError = { code?: string; message?: string } | null;

function isTimeoutError(error: QueryError): boolean {
  if (!error) return false;
  const code = String(error.code || '');
  const message = String(error.message || '').toLowerCase();
  return code === '57014' || message.includes('statement timeout') || message.includes('canceling statement');
}

function chunkIds<T>(ids: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}

async function fetchEqRows<T>(
  table: string,
  select: string,
  column: string,
  value: string | number | null | undefined,
): Promise<T[]> {
  if (value == null || value === '') return [];
  const { data, error } = await supabase.from(table).select(select).eq(column, value).limit(MAX_ASSIGNED_LEADS);
  if (error) {
    console.warn(`[communicationsInbox] ${table}.${column} lookup failed`, error.message);
    return [];
  }
  return (data || []) as T[];
}

async function fetchRowsByIds<T>(
  table: string,
  column: string,
  ids: Array<string | number>,
  select: string,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const chunks = chunkIds(ids, ID_CHUNK);
  const rows: T[] = [];
  for (let i = 0; i < chunks.length; i += QUERY_CONCURRENCY) {
    const wave = chunks.slice(i, i + QUERY_CONCURRENCY);
    const pages = await Promise.all(
      wave.map(async (idsChunk) => {
        const query: any = supabase.from(table).select(select).in(column, idsChunk);
        const { data, error } = await query;
        if (error) {
          if (isTimeoutError(error)) {
            console.warn(`[communicationsInbox] timeout ${table}.${column}`, error);
            return [] as T[];
          }
          throw error;
        }
        return (data || []) as T[];
      }),
    );
    rows.push(...pages.flat());
  }
  return rows;
}

async function fetchRecentByColumn<T>(
  table: 'emails' | 'whatsapp_messages',
  column: string,
  ids: Array<string | number>,
  select: string,
  since: string,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const chunks = chunkIds(ids, ID_CHUNK);
  const rows: T[] = [];
  for (let i = 0; i < chunks.length; i += QUERY_CONCURRENCY) {
    const wave = chunks.slice(i, i + QUERY_CONCURRENCY);
    const pages = await Promise.all(
      wave.map(async (idsChunk) => {
        const { data, error } = await supabase
          .from(table)
          .select(select)
          .in(column, idsChunk)
          .gte('sent_at', since)
          .order('sent_at', { ascending: false })
          .limit(MSG_PER_CHUNK);
        if (error) {
          if (isTimeoutError(error)) {
            console.warn(`[communicationsInbox] timeout ${table}.${column} messages`, error);
            return [] as T[];
          }
          throw error;
        }
        return (data || []) as T[];
      }),
    );
    rows.push(...pages.flat());
  }
  return rows;
}

async function fetchLatestWhatsAppRows(): Promise<WhatsAppRow[]> {
  const run = (limit: number) =>
    supabase
      .from('whatsapp_messages')
      .select(WA_SELECT)
      .order('sent_at', { ascending: false })
      .limit(limit);

  const { data, error } = await run(LATEST_WA_LIMIT);
  if (!error) return (data || []) as WhatsAppRow[];
  if (isTimeoutError(error)) {
    console.warn('[communicationsInbox] timeout whatsapp latest, retrying smaller page', error);
    const retry = await run(120);
    if (retry.error) {
      console.warn('[communicationsInbox] timeout whatsapp latest retry', retry.error);
      return [];
    }
    return (retry.data || []) as WhatsAppRow[];
  }
  throw error;
}

type InboxCache = {
  actorKey: string;
  at: number;
  conversations: InboxConversation[];
};

let inboxCache: InboxCache | null = null;
let inboxInflight: Promise<InboxConversation[]> | null = null;

function actorCacheKey(actor: InboxActor): string {
  return `${CACHE_VERSION}:${actor.authUserId}:${actor.employeeId ?? ''}:${actor.displayName}`;
}

function readInboxCache(actor: InboxActor): InboxConversation[] | null {
  if (!inboxCache) return null;
  if (inboxCache.actorKey !== actorCacheKey(actor)) return null;
  if (Date.now() - inboxCache.at > CACHE_MS) return null;
  if (inboxCache.conversations.some((row) => typeof row.isMine !== 'boolean')) return null;
  return inboxCache.conversations;
}

function writeInboxCache(actor: InboxActor, conversations: InboxConversation[]): void {
  if (conversations.length === 0) return;
  inboxCache = { actorKey: actorCacheKey(actor), at: Date.now(), conversations };
}

export function invalidateInboxCache(): void {
  inboxCache = null;
}

const NEW_LEAD_ID_ROLE_COLS = [
  'case_handler_id',
  'expert_id',
  'meeting_lawyer_id',
  'meeting_manager_id',
  'retainer_handler_id',
  'meeting_collection_id',
  'marketing_officer_id',
] as const;

const NEW_LEAD_TEXT_ROLE_COLS = [
  'closer',
  'scheduler',
  'handler',
  'helper',
  'expert',
  'manager',
  'lawyer',
] as const;

const LEGACY_LEAD_ID_ROLE_COLS = [
  'closer_id',
  'meeting_scheduler_id',
  'meeting_manager_id',
  'meeting_lawyer_id',
  'expert_id',
  'case_handler_id',
  'retainer_handler_id',
  'meeting_collection_id',
  'marketing_officer_id',
] as const;

export async function fetchAssignedLeads(actor: {
  employeeId: number | null;
  displayName: string;
}): Promise<{
  newById: Map<string, any>;
  legacyById: Map<number, any>;
}> {
  const employeeId = actor.employeeId;
  const displayName = (actor.displayName || '').trim();
  const firstName = displayName.split(/\s+/).filter(Boolean)[0] || '';
  const nameValues = [displayName, firstName].filter((name, index, all) => name && all.indexOf(name) === index);

  const newJobs: Array<Promise<any[]>> = [];
  const legacyJobs: Array<Promise<any[]>> = [];
  if (employeeId != null) {
    for (const col of NEW_LEAD_ID_ROLE_COLS) {
      newJobs.push(fetchEqRows('leads', NEW_LEAD_SELECT, col, employeeId));
    }
    for (const col of NEW_LEAD_TEXT_ROLE_COLS) {
      newJobs.push(fetchEqRows('leads', NEW_LEAD_SELECT, col, employeeId));
      newJobs.push(fetchEqRows('leads', NEW_LEAD_SELECT, col, String(employeeId)));
    }
    for (const col of LEGACY_LEAD_ID_ROLE_COLS) {
      legacyJobs.push(fetchEqRows('leads_lead', LEGACY_LEAD_SELECT, col, employeeId));
    }
  }
  for (const name of nameValues) {
    for (const col of NEW_LEAD_TEXT_ROLE_COLS) {
      newJobs.push(fetchEqRows('leads', NEW_LEAD_SELECT, col, name));
    }
  }

  const [newRows, legacyRows] = await Promise.all([
    Promise.all(newJobs).then((pages) => pages.flat()),
    Promise.all(legacyJobs).then((pages) => pages.flat()),
  ]);

  const newById = new Map<string, any>();
  for (const lead of newRows) {
    if (lead?.id == null) continue;
    newById.set(String(lead.id), lead);
  }

  const legacyById = new Map<number, any>();
  for (const lead of legacyRows) {
    const id = asLegacyId(lead?.id);
    if (id != null) legacyById.set(id, lead);
  }

  return { newById, legacyById };
}

export async function resolveInboxActor(): Promise<InboxActor | null> {
  const user = await resolveSessionUser();
  if (!user?.id) return null;

  let { data: userRow, error } = await supabase
    .from('users')
    .select(`
      id,
      employee_id,
      full_name,
      tenants_employee!employee_id(id, display_name)
    `)
    .eq('auth_id', user.id)
    .maybeSingle();

  if ((!userRow || error) && user.email) {
    const retry = await supabase
      .from('users')
      .select(`
        id,
        employee_id,
        full_name,
        tenants_employee!employee_id(id, display_name)
      `)
      .eq('email', user.email)
      .maybeSingle();
    userRow = retry.data;
  }

  if (!userRow) {
    return {
      authUserId: user.id,
      userRowId: null,
      employeeId: null,
      displayName: user.email || '',
    };
  }

  const emp = Array.isArray((userRow as any).tenants_employee)
    ? (userRow as any).tenants_employee[0]
    : (userRow as any).tenants_employee;
  const displayName = String(emp?.display_name || userRow.full_name || user.email || '').trim();
  const employeeId =
    userRow.employee_id != null && userRow.employee_id !== ''
      ? Number(userRow.employee_id)
      : null;

  return {
    authUserId: user.id,
    userRowId: userRow.id != null ? String(userRow.id) : null,
    employeeId: Number.isFinite(employeeId as number) ? employeeId : null,
    displayName,
  };
}

function resolveMessageLead(
  row: {
    newLeadId?: string | null;
    legacyLeadId?: number | null;
  },
  newById: Map<string, any>,
  newByLegacyId: Map<number, any>,
): {
  newLead: any | null;
  legacyId: number | null;
} {
  if (row.newLeadId && newById.has(row.newLeadId)) {
    return { newLead: newById.get(row.newLeadId), legacyId: row.legacyLeadId ?? null };
  }
  if (row.legacyLeadId != null && newByLegacyId.has(row.legacyLeadId)) {
    return { newLead: newByLegacyId.get(row.legacyLeadId), legacyId: row.legacyLeadId };
  }
  return { newLead: null, legacyId: row.legacyLeadId ?? null };
}

function conversationKey(newLeadId: string | null, legacyLeadId: number | null): string | null {
  if (newLeadId) return `new:${newLeadId}`;
  if (legacyLeadId != null) return `legacy:${legacyLeadId}`;
  return null;
}

export function formatInboxWait(ms: number | null): string | null {
  if (ms == null || ms < 0) return null;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rem = minutes % 60;
    return rem ? `${hours}h ${rem}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function inboxCountsFromConversations(conversations: InboxConversation[]): InboxCounts {
  return {
    needsReply: conversations.filter((c) => c.needsReply).length,
    unread: conversations.filter((c) => c.unreadCount > 0).length,
    waiting: conversations.filter((c) => c.state === 'waiting').length,
  };
}

export function conversationInQueue(conversation: InboxConversation, tab: InboxQueueTab): boolean {
  if (tab === 'all') return true;
  if (tab === 'inbox') return conversation.unreadCount > 0 || conversation.needsReply;
  if (tab === 'needs_reply') return conversation.needsReply;
  if (tab === 'waiting') return conversation.state === 'waiting';
  return conversation.unreadCount > 0;
}

export function conversationMatchesScope(conversation: InboxConversation, scope: InboxContactScope): boolean {
  if (scope === 'all') return true;
  return conversation.isMine;
}

export function conversationMatchesChannel(conversation: InboxConversation, channel: InboxChannel | 'all'): boolean {
  if (channel === 'all') return true;
  return conversation.channels.includes(channel);
}

export function conversationMatchesSearch(conversation: InboxConversation, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    conversation.leadName,
    conversation.leadNumber,
    conversation.leadIdentifier,
    conversation.email,
    conversation.phone,
    conversation.lastSnippet,
    conversation.category,
    conversation.stage,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

async function fetchContactParentLeadIds(contactIds: Array<string | number>): Promise<{
  newIds: string[];
  legacyIds: number[];
  contactToNew: Map<number, string>;
  contactToLegacy: Map<number, number>;
}> {
  const uniq = [...new Set(contactIds.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0))];
  const newIds = new Set<string>();
  const legacyIds = new Set<number>();
  const contactToNew = new Map<number, string>();
  const contactToLegacy = new Map<number, number>();
  if (uniq.length === 0) {
    return { newIds: [], legacyIds: [], contactToNew, contactToLegacy };
  }
  const chunks = chunkIds(uniq, ID_CHUNK);
  for (const chunk of chunks) {
    const { data, error } = await supabase
      .from('lead_leadcontact')
      .select('contact_id, newlead_id, lead_id')
      .in('contact_id', chunk);
    if (error) {
      if (isTimeoutError(error)) {
        console.warn('[communicationsInbox] timeout lead_leadcontact', error);
        continue;
      }
      throw error;
    }
    for (const row of data || []) {
      const contactId = Number(row?.contact_id);
      if (row?.newlead_id) {
        const id = String(row.newlead_id);
        newIds.add(id);
        if (Number.isFinite(contactId)) contactToNew.set(contactId, id);
      }
      const legacyId = asLegacyId(row?.lead_id);
      if (legacyId != null) {
        legacyIds.add(legacyId);
        if (Number.isFinite(contactId)) contactToLegacy.set(contactId, legacyId);
      }
    }
  }
  return { newIds: Array.from(newIds), legacyIds: Array.from(legacyIds), contactToNew, contactToLegacy };
}

async function loadInboxConversations(actor: InboxActor): Promise<InboxConversation[]> {
  const [whatsappLatest, unreadEmails, assigned] = await Promise.all([
    fetchLatestWhatsAppRows(),
    fetchHeaderUnreadEmailsForBadge({ days: 2, limit: 80 }).then((res) => res.data || []).catch(() => [] as Array<{ id?: string | number; client_id?: string | null; legacy_id?: number | null }>),
    fetchAssignedLeads(actor),
  ]);

  const assignedNewIds = Array.from(assigned.newById.keys());
  const assignedLegacyIds = Array.from(assigned.legacyById.keys());
  const assignedContactIds = await fetchContactIdsLinkedToLeads(supabase, assignedNewIds, assignedLegacyIds);

  const extraWhatsapp = (
    await Promise.all([
      fetchRecentByColumn<WhatsAppRow>('whatsapp_messages', 'lead_id', assignedNewIds, WA_SELECT, lookbackIso()),
      fetchRecentByColumn<WhatsAppRow>('whatsapp_messages', 'legacy_id', assignedLegacyIds, WA_SELECT, lookbackIso()),
      fetchRecentByColumn<WhatsAppRow>(
        'whatsapp_messages',
        'contact_id',
        assignedContactIds.slice(0, 400),
        WA_SELECT,
        lookbackIso(),
      ),
    ])
  ).flat();

  const whatsappById = new Map<string, WhatsAppRow>();
  for (const row of [...whatsappLatest, ...extraWhatsapp]) {
    if (row?.id == null) continue;
    whatsappById.set(String(row.id), row);
  }
  const whatsapp = Array.from(whatsappById.values());

  const leadIds = new Set<string>();
  const legacyIds = new Set<number>();
  const contactIds: number[] = [];
  for (const id of assignedNewIds) leadIds.add(id);
  for (const id of assignedLegacyIds) legacyIds.add(id);
  for (const row of whatsapp) {
    if (row.lead_id) leadIds.add(String(row.lead_id));
    const legacyId = asLegacyId(row.legacy_id);
    if (legacyId != null) legacyIds.add(legacyId);
    const contactId = Number(row.contact_id);
    if (Number.isFinite(contactId) && contactId > 0) contactIds.push(contactId);
  }
  for (const row of unreadEmails) {
    if (row.client_id) leadIds.add(String(row.client_id));
    const legacyId = asLegacyId(row.legacy_id);
    if (legacyId != null) legacyIds.add(legacyId);
  }

  const contactParents = await fetchContactParentLeadIds(contactIds);
  for (const id of contactParents.newIds) leadIds.add(id);
  for (const id of contactParents.legacyIds) legacyIds.add(id);

  const unreadEmailIds = unreadEmails.map((row) => row.id).filter((id) => id != null && id !== '');

  const [newLeads, legacyLeads, emailsById] = await Promise.all([
    fetchRowsByIds<any>('leads', 'id', Array.from(leadIds).slice(0, MAX_ASSIGNED_LEADS * 2), NEW_LEAD_SELECT),
    fetchRowsByIds<any>('leads_lead', 'id', Array.from(legacyIds).slice(0, MAX_ASSIGNED_LEADS * 2), LEGACY_LEAD_SELECT),
    fetchRowsByIds<EmailRow>(
      'emails',
      'id',
      unreadEmailIds.slice(0, 80),
      'id, client_id, legacy_id, sender_name, sender_email, subject, body_preview, sent_at, direction, is_read',
    ),
  ]);
  const newById = new Map<string, any>(assigned.newById);
  const legacyById = new Map<number, any>(assigned.legacyById);
  for (const lead of newLeads) {
    if (lead?.id != null) newById.set(String(lead.id), lead);
  }
  for (const lead of legacyLeads) {
    const id = asLegacyId(lead?.id);
    if (id != null) legacyById.set(id, lead);
  }

  const emails = emailsById;

  if (emails.length === 0 && whatsapp.length === 0) return [];

  const newByLegacyId = new Map<number, any>();
  for (const row of emails) {
    const newId = row.client_id ? String(row.client_id) : null;
    const legacyId = asLegacyId(row.legacy_id);
    if (newId && legacyId != null && newById.has(newId)) newByLegacyId.set(legacyId, newById.get(newId));
  }
  for (const row of whatsapp) {
    const newId = row.lead_id ? String(row.lead_id) : null;
    const legacyId = asLegacyId(row.legacy_id);
    if (newId && legacyId != null && newById.has(newId)) newByLegacyId.set(legacyId, newById.get(newId));
  }

  type Acc = {
    key: string;
    newLeadId: string | null;
    legacyLeadId: number | null;
    newLead: any | null;
    legacyLead: any | null;
    lastAt: string;
    lastDirection: 'in' | 'out';
    lastChannel: InboxChannel;
    lastSnippet: string;
    lastInboundAt: string | null;
    unreadCount: number;
    channels: Set<InboxChannel>;
    phone: string | null;
    email: string | null;
  };

  const groups = new Map<string, Acc>();

  const touch = (opts: {
    newLeadId: string | null;
    legacyLeadId: number | null;
    channel: InboxChannel;
    inbound: boolean;
    unread: boolean;
    sentAt: string;
    snippet: string;
    phone?: string | null;
  }) => {
    const resolved = resolveMessageLead(
      { newLeadId: opts.newLeadId, legacyLeadId: opts.legacyLeadId },
      newById,
      newByLegacyId,
    );
    const newLead = resolved.newLead;
    const legacyId = resolved.legacyId;
    const newLeadId = newLead?.id != null ? String(newLead.id) : opts.newLeadId && newById.has(opts.newLeadId) ? opts.newLeadId : null;
    const key = conversationKey(newLeadId, legacyId);
    if (!key) return;

    const legacyLead = legacyId != null ? legacyById.get(legacyId) || null : null;

    const sentAt = opts.sentAt;
    if (!sentAt) return;
    const direction: 'in' | 'out' = opts.inbound ? 'in' : 'out';
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        key,
        newLeadId,
        legacyLeadId: legacyId,
        newLead,
        legacyLead,
        lastAt: sentAt,
        lastDirection: direction,
        lastChannel: opts.channel,
        lastSnippet: opts.snippet,
        lastInboundAt: opts.inbound ? sentAt : null,
        unreadCount: 0,
        channels: new Set(),
        phone: opts.phone || null,
        email: null,
      };
      groups.set(key, acc);
    }
    acc.channels.add(opts.channel);
    if (opts.unread && opts.inbound) acc.unreadCount += 1;
    if (opts.phone && !acc.phone) acc.phone = opts.phone;
    if (new Date(sentAt).getTime() >= new Date(acc.lastAt).getTime()) {
      acc.lastAt = sentAt;
      acc.lastDirection = direction;
      acc.lastChannel = opts.channel;
      acc.lastSnippet = opts.snippet;
    }
    if (opts.inbound) {
      if (!acc.lastInboundAt || new Date(sentAt).getTime() > new Date(acc.lastInboundAt).getTime()) {
        acc.lastInboundAt = sentAt;
      }
    }
  };

  for (const row of emails) {
    const sentAt = row.sent_at ? String(row.sent_at) : '';
    if (!sentAt) continue;
    const inbound = isInboundEmail(row.direction);
    touch({
      newLeadId: row.client_id ? String(row.client_id) : null,
      legacyLeadId: asLegacyId(row.legacy_id),
      channel: 'email',
      inbound,
      unread: inbound && (row.is_read == null || row.is_read === false),
      sentAt,
      snippet: snippetFromEmail(row),
    });
  }

  for (const row of whatsapp) {
    const sentAt = row.sent_at ? String(row.sent_at) : '';
    if (!sentAt) continue;
    const inbound = isInboundWhatsApp(row.direction);
    const contactId = Number(row.contact_id);
    const parentNew = Number.isFinite(contactId) ? contactParents.contactToNew.get(contactId) : null;
    const parentLegacy = Number.isFinite(contactId) ? contactParents.contactToLegacy.get(contactId) : null;
    touch({
      newLeadId: row.lead_id ? String(row.lead_id) : parentNew || null,
      legacyLeadId: asLegacyId(row.legacy_id) ?? parentLegacy ?? null,
      channel: 'whatsapp',
      inbound,
      unread: inbound && (row.is_read == null || row.is_read === false),
      sentAt,
      snippet: snippetFromWhatsApp(row),
      phone: row.phone_number || null,
    });
  }

  const now = Date.now();
  const conversations: InboxConversation[] = [];
  for (const acc of groups.values()) {
    const lead = acc.newLead || acc.legacyLead;
    const leadType: 'new' | 'legacy' = acc.newLeadId ? 'new' : 'legacy';
    const leadNumber = lead?.lead_number != null ? String(lead.lead_number) : acc.newLeadId || (acc.legacyLeadId != null ? String(acc.legacyLeadId) : null);
    const leadIdentifier = acc.newLeadId
      ? String(lead?.lead_number || acc.newLeadId)
      : acc.legacyLeadId != null
        ? String(acc.legacyLeadId)
        : acc.key;
    const needsReply = acc.lastDirection === 'in';
    const waitingMs = needsReply && acc.lastInboundAt ? Math.max(0, now - new Date(acc.lastInboundAt).getTime()) : null;
    const isMine =
      (acc.newLeadId != null && assigned.newById.has(acc.newLeadId)) ||
      (acc.legacyLeadId != null && assigned.legacyById.has(acc.legacyLeadId)) ||
      employeeHasAnySalesRoleOnLeadBundle(
        acc.newLead,
        acc.legacyLead,
        actor.employeeId,
        actor.displayName,
      );
    conversations.push({
      key: acc.key,
      leadType,
      newLeadId: acc.newLeadId,
      legacyLeadId: acc.legacyLeadId,
      leadName: String(lead?.name || 'Unknown').trim() || 'Unknown',
      leadNumber,
      leadIdentifier,
      stage: lead?.stage != null ? String(lead.stage) : null,
      category: lead?.topic != null ? String(lead.topic) : lead?.category != null ? String(lead.category) : null,
      email: lead?.email != null ? String(lead.email) : acc.email,
      phone: acc.phone || lead?.phone || lead?.mobile || null,
      lastSnippet: acc.lastSnippet,
      lastChannel: acc.lastChannel,
      lastAt: acc.lastAt,
      lastDirection: acc.lastDirection,
      unreadCount: acc.unreadCount,
      needsReply,
      state: needsReply ? 'needs_reply' : 'waiting',
      waitingMs,
      channels: Array.from(acc.channels),
      isMine,
    });
  }

  conversations.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  return conversations;
}

export async function fetchInboxConversations(): Promise<InboxConversation[]> {
  const actor = await resolveInboxActor();
  if (!actor) return [];

  const cached = readInboxCache(actor);
  if (cached) return cached;
  if (inboxInflight) return inboxInflight;

  inboxInflight = (async () => {
    try {
      const conversations = await loadInboxConversations(actor);
      writeInboxCache(actor, conversations);
      return conversations;
    } finally {
      inboxInflight = null;
    }
  })();

  return inboxInflight;
}

export function inboxLoadErrorMessage(error: unknown): string {
  const raw = error && typeof error === 'object' && 'message' in error ? String((error as { message?: string }).message || '') : String(error || '');
  if (isTimeoutError({ message: raw, code: error && typeof error === 'object' && 'code' in error ? String((error as { code?: string }).code || '') : '' })) {
    return 'Inbox is taking too long to load. Try again in a moment.';
  }
  return raw || 'Failed to load inbox';
}

export async function fetchInboxCounts(): Promise<InboxCounts> {
  const conversations = await fetchInboxConversations();
  return inboxCountsFromConversations(conversations.filter((row) => row.isMine));
}

export async function fetchConversationThread(conversation: InboxConversation): Promise<InboxThreadItem[]> {
  const items: InboxThreadItem[] = [];
  const emailSelect = 'id, sender_name, sender_email, subject, body_preview, body_html, sent_at, direction, is_read';
  const waSelect = 'id, sender_name, message, sent_at, direction, is_read';
  const jobs: Array<Promise<{ channel: InboxChannel; data: any[]; error: any }>> = [];

  const addEmail = (column: 'client_id' | 'legacy_id', value: string | number) => {
    jobs.push(
      supabase
        .from('emails')
        .select(emailSelect)
        .eq(column, value)
        .gte('sent_at', lookbackIso(180))
        .order('sent_at', { ascending: false })
        .limit(THREAD_LIMIT)
        .then(({ data, error }) => ({ channel: 'email' as const, data: data || [], error })),
    );
  };
  const addWhatsApp = (column: 'lead_id' | 'legacy_id', value: string | number) => {
    jobs.push(
      supabase
        .from('whatsapp_messages')
        .select(waSelect)
        .eq(column, value)
        .gte('sent_at', lookbackIso(180))
        .order('sent_at', { ascending: false })
        .limit(THREAD_LIMIT)
        .then(({ data, error }) => ({ channel: 'whatsapp' as const, data: data || [], error })),
    );
  };

  if (conversation.newLeadId) {
    addEmail('client_id', conversation.newLeadId);
    addWhatsApp('lead_id', conversation.newLeadId);
  }
  if (conversation.legacyLeadId != null) {
    addEmail('legacy_id', conversation.legacyLeadId);
    addWhatsApp('legacy_id', conversation.legacyLeadId);
  }

  const results = await Promise.all(jobs);
  const seen = new Set<string>();
  for (const result of results) {
    if (result.error) {
      if (isTimeoutError(result.error)) {
        console.warn('[communicationsInbox] thread timeout', result.channel, result.error);
        continue;
      }
      throw result.error;
    }
    for (const row of result.data) {
      if (!row.sent_at) continue;
      const itemId = `${result.channel}-${row.id}`;
      if (seen.has(itemId)) continue;
      seen.add(itemId);
      if (result.channel === 'email') {
        items.push({
          id: itemId,
          channel: 'email',
          direction: isInboundEmail(row.direction) ? 'in' : 'out',
          sentAt: String(row.sent_at),
          sender: String(row.sender_name || row.sender_email || 'Email'),
          content: emailThreadContent(row),
          isRead: row.is_read === true,
        });
      } else {
        items.push({
          id: itemId,
          channel: 'whatsapp',
          direction: isInboundWhatsApp(row.direction) ? 'in' : 'out',
          sentAt: String(row.sent_at),
          sender: String(row.sender_name || 'WhatsApp'),
          content: whatsappThreadContent(row),
          isRead: row.is_read === true,
        });
      }
    }
  }

  items.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
  return items;
}

export async function markConversationRead(conversation: InboxConversation): Promise<void> {
  const actor = await resolveInboxActor();
  const now = new Date().toISOString();
  const emailReadBy = actor?.userRowId || actor?.authUserId || null;
  const waReadBy = actor?.authUserId || null;

  const emailUpdates: PromiseLike<any>[] = [];
  const waUpdates: PromiseLike<any>[] = [];

  const markEmails = (column: 'client_id' | 'legacy_id', value: string | number) => {
    let q = supabase
      .from('emails')
      .update({
        is_read: true,
        read_at: now,
        ...(emailReadBy ? { read_by: emailReadBy } : {}),
      })
      .eq(column, value)
      .eq('direction', 'incoming')
      .gte('sent_at', lookbackIso(30))
      .or('is_read.is.null,is_read.eq.false');
    emailUpdates.push(q);
  };

  const markWhatsApp = (column: 'lead_id' | 'legacy_id', value: string | number) => {
    let q = supabase
      .from('whatsapp_messages')
      .update({
        is_read: true,
        read_at: now,
        ...(waReadBy ? { read_by: waReadBy } : {}),
      })
      .eq(column, value)
      .eq('direction', 'in')
      .gte('sent_at', lookbackIso(30))
      .or('is_read.is.null,is_read.eq.false');
    waUpdates.push(q);
  };

  if (conversation.newLeadId) {
    markEmails('client_id', conversation.newLeadId);
    markWhatsApp('lead_id', conversation.newLeadId);
  }
  if (conversation.legacyLeadId != null) {
    markEmails('legacy_id', conversation.legacyLeadId);
    markWhatsApp('legacy_id', conversation.legacyLeadId);
  }

  const results = await Promise.all([...emailUpdates, ...waUpdates]);
  for (const result of results) {
    if (result?.error) throw result.error;
  }
  invalidateInboxCache();
}
