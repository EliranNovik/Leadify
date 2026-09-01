import { supabase } from './supabase';

export type RmqAiCurrentLead = {
  id?: string | number | null;
  lead_number?: string | null;
  name?: string | null;
  lead_type?: string | null;
  email?: string | null;
  phone?: string | null;
  language?: string | null;
  handler?: string | number | null;
  case_handler_id?: string | number | null;
  expert?: string | number | null;
  expert_id?: string | number | null;
  closer?: string | number | null;
  closer_id?: string | number | null;
  scheduler?: string | number | null;
  meeting_scheduler_id?: string | number | null;
  manager?: string | number | null;
  meeting_manager_id?: string | number | null;
  helper?: string | number | null;
  meeting_lawyer_id?: string | number | null;
  retainer_handler_id?: string | number | null;
};

export type RmqAiDraftMeta = {
  channel: 'email' | 'whatsapp' | 'sms';
  leadNumber?: string;
  leadId?: string;
  email?: string;
};

let currentLead: RmqAiCurrentLead | null = null;
let lastDraftMeta: RmqAiDraftMeta | null = null;

function slimRoleField(value: unknown): string | number | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw || raw === '---' || raw === '--' || /^not[_ ]assigned$/i.test(raw)) return null;
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

function roleName(value: unknown): string | null {
  const slim = slimRoleField(value);
  if (slim == null) return null;
  if (typeof slim === 'number') return null;
  if (/^\d+$/.test(slim)) return null;
  return slim;
}

const ROLE_ID_KEYS = [
  'handler',
  'case_handler_id',
  'expert',
  'expert_id',
  'closer',
  'closer_id',
  'scheduler',
  'meeting_scheduler_id',
  'manager',
  'meeting_manager_id',
  'helper',
  'meeting_lawyer_id',
  'retainer_handler_id',
] as const;

export async function hydrateRmqAiRoleNames(lead: RmqAiCurrentLead): Promise<RmqAiCurrentLead> {
  const ids = new Set<number>();
  for (const key of ROLE_ID_KEYS) {
    const value = lead[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) ids.add(value);
  }
  if (ids.size === 0) return lead;
  const { data } = await supabase.from('tenants_employee').select('id, display_name').in('id', [...ids]);
  const names = new Map<number, string>();
  for (const row of data || []) {
    const id = Number(row.id);
    const name = String(row.display_name || '').trim();
    if (!Number.isFinite(id) || !name || /^not[_ ]assigned$/i.test(name)) continue;
    names.set(id, name);
  }
  const resolve = (value: string | number | null | undefined): string | number | null => {
    if (value == null) return null;
    if (typeof value === 'number') return names.get(value) || value;
    if (/^\d+$/.test(value)) return names.get(Number(value)) || value;
    return value;
  };
  return {
    ...lead,
    handler: resolve(lead.handler) ?? resolve(lead.case_handler_id),
    expert: resolve(lead.expert) ?? resolve(lead.expert_id),
    closer: resolve(lead.closer) ?? resolve(lead.closer_id),
    scheduler: resolve(lead.scheduler) ?? resolve(lead.meeting_scheduler_id),
    manager: resolve(lead.manager) ?? resolve(lead.meeting_manager_id),
    helper: resolve(lead.helper) ?? resolve(lead.meeting_lawyer_id),
  };
}

export function slimRmqAiCurrentLead(lead: unknown): RmqAiCurrentLead | null {
  if (!lead || typeof lead !== 'object') return null;
  const row = lead as Record<string, unknown>;
  const id = row.id ?? null;
  const leadNumber = row.lead_number ?? row.manual_id ?? null;
  if (id == null && (leadNumber == null || String(leadNumber).trim() === '')) return null;
  return {
    id,
    lead_number: leadNumber != null ? String(leadNumber) : null,
    name: row.name != null ? String(row.name) : null,
    lead_type:
      row.lead_type != null
        ? String(row.lead_type)
        : String(id || '').startsWith('legacy_')
          ? 'legacy'
          : 'new',
    email: row.email != null ? String(row.email) : null,
    phone: row.phone != null ? String(row.phone) : row.mobile != null ? String(row.mobile) : null,
    language: row.language != null ? String(row.language) : null,
    handler: slimRoleField(row.handler),
    case_handler_id: slimRoleField(row.case_handler_id),
    expert: slimRoleField(row.expert),
    expert_id: slimRoleField(row.expert_id),
    closer: slimRoleField(row.closer),
    closer_id: slimRoleField(row.closer_id),
    scheduler: slimRoleField(row.scheduler),
    meeting_scheduler_id: slimRoleField(row.meeting_scheduler_id),
    manager: slimRoleField(row.manager),
    meeting_manager_id: slimRoleField(row.meeting_manager_id),
    helper: slimRoleField(row.helper ?? row.meeting_lawyer_id),
    meeting_lawyer_id: slimRoleField(row.meeting_lawyer_id),
    retainer_handler_id: slimRoleField(row.retainer_handler_id),
  };
}

export function leadNumberFromClientsPath(pathname: string, search = ''): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const fromQuery = String(params.get('lead') || '').trim();
  if (fromQuery) return fromQuery;

  const parts = String(pathname || '').split('/').filter(Boolean);
  if (parts[0]?.toLowerCase() !== 'clients' || !parts[1]) return null;
  let first = parts[1];
  try {
    first = decodeURIComponent(first);
  } catch {
    /* keep raw */
  }
  const value = first.trim();
  if (!value || value === 'new' || value === 'undefined') return null;
  const suffix = parts[2] && /^\d{1,3}$/.test(parts[2]) ? parts[2] : '';
  return suffix ? `${value.replace(/\/$/, '')}/${suffix}` : value;
}

export function normalizeLeadNumberToken(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/^legacy_/i, '')
    .replace(/^[lc]/i, '')
    .toLowerCase();
}

export function queryMatchesOpenLead(
  query: unknown,
  open: { query?: string; lead_id?: string } | null | undefined,
): boolean {
  const raw = String(query ?? '').trim();
  const token = normalizeLeadNumberToken(raw);
  if (!token) return true;
  if (!open) return false;
  const openNumber = normalizeLeadNumberToken(open.query);
  const openId = normalizeLeadNumberToken(open.lead_id);
  if ((openNumber && token === openNumber) || (openId && token === openId)) return true;
  if (openNumber && raw.toLowerCase().includes(String(open.query || '').toLowerCase())) return true;
  const mentioned = raw.match(/\bL\d{4,}(?:\/\d+)?\b/gi) || [];
  if (openNumber && mentioned.some((item) => normalizeLeadNumberToken(item) === openNumber)) return true;
  const openName = String(getRmqAiCurrentLead()?.name || '').trim().toLowerCase();
  const queryName = raw.toLowerCase().replace(/['’]s$/u, '');
  return Boolean(openName && queryName && openName === queryName);
}

export function isThisClientQuery(value: unknown): boolean {
  const query = String(value ?? '').trim().toLowerCase();
  if (!query) return true;
  if (/^(this|the|current|open)\s+(client|lead|one|page|case|person)$/.test(query)) return true;
  if (/^(this|the)\s+same\s+(client|lead)$/.test(query)) return true;
  if (query === 'this' || query === 'here' || query === 'this client' || query === 'this lead') return true;
  return /\b(this|the|current|open)\s+(same\s+)?(client|lead|one|page|case|person)\b/.test(query);
}

export function isOpenClientRoleQuestion(query: string, fallback: { query?: string; lead_id?: string } | null | undefined): boolean {
  const raw = String(query || '').trim();
  if (!raw) return false;
  if (!fallback?.lead_id && !fallback?.query) return false;
  if (isThisClientQuery(raw) || queryMatchesOpenLead(raw, fallback)) return true;
  const otherNumber = (raw.match(/\bL\d{4,}(?:\/\d+)?\b/gi) || []).find(
    (item) => normalizeLeadNumberToken(item) !== normalizeLeadNumberToken(fallback.query),
  );
  if (otherNumber) return false;
  return /\b(handler|expert|manager|closer|scheduler|helper|eligible|eligibility|opinion)\b/i.test(raw)
    || /^(who|what|and|the)\b/i.test(raw);
}

export function setRmqAiCurrentLead(lead: RmqAiCurrentLead | null) {
  currentLead = lead && (lead.id != null || lead.lead_number) ? lead : null;
}

export function getRmqAiCurrentLead(): RmqAiCurrentLead | null {
  return currentLead;
}

export function currentLeadAsToolArgs(): { query?: string; lead_id?: string; is_legacy?: boolean } {
  if (!currentLead) return {};
  const isLegacy =
    currentLead.lead_type === 'legacy' || String(currentLead.id || '').startsWith('legacy_');
  if (currentLead.id != null && String(currentLead.id).trim() !== '') {
    return {
      lead_id: String(currentLead.id),
      is_legacy: isLegacy,
      query: String(currentLead.lead_number || currentLead.name || '').trim() || undefined,
    };
  }
  if (currentLead.lead_number) return { query: String(currentLead.lead_number) };
  return {};
}

export function describeCurrentLeadForPrompt(): string {
  if (!currentLead) return '';
  const number = currentLead.lead_number ? String(currentLead.lead_number) : '';
  const name = currentLead.name ? String(currentLead.name) : '';
  const hasSlash = number.includes('/');
  const legacy =
    currentLead.lead_type === 'legacy' || String(currentLead.id || '').startsWith('legacy_');
  const entityType = hasSlash ? 'sublead' : legacy ? 'legacy_lead' : 'lead';
  const master = hasSlash ? number.split('/')[0] : '';
  const handler = roleName(currentLead.handler);
  const expert = roleName(currentLead.expert);
  const closer = roleName(currentLead.closer);
  const scheduler = roleName(currentLead.scheduler);
  const manager = roleName(currentLead.manager);
  const roleParts = [
    handler && `Handler=${handler}`,
    expert && `Expert=${expert}`,
    manager && `Manager=${manager}`,
    closer && `Closer=${closer}`,
    scheduler && `Scheduler=${scheduler}`,
  ].filter(Boolean);
  return [
    'OPEN CLIENT (authoritative — do not ask for a lead number while this block is present):',
    name && `name: ${name}`,
    number && `lead_number: ${number}`,
    `type: ${entityType}`,
    master && `master_lead_number: ${master}`,
    roleParts.length > 0 && `Roles tab: ${roleParts.join('; ')}`,
    'If they say this client / this lead / the meeting / next meeting / the brief / the summary without naming a different lead, use this client.',
    'When they ask who the handler / expert / manager / closer / scheduler is, copy that Roles tab name if it is listed. If that role is not listed, ALWAYS call get_lead_case_file and use ASSIGNED ROLES. Never say unassigned just because a role is missing from this block.',
    'For this client’s next meeting, brief, or AI summary, call list_client_meetings. list_calendar_day is only for a calendar day across people, not one client.',
  ]
    .filter(Boolean)
    .join(' ');
}

export function rememberRmqAiDraftMeta(meta: RmqAiDraftMeta) {
  lastDraftMeta = meta;
}

export function takeRmqAiDraftMeta(): RmqAiDraftMeta | null {
  const value = lastDraftMeta;
  lastDraftMeta = null;
  return value;
}
