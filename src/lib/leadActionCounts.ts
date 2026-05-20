import { supabase } from './supabase';

export type LeadActionCounts = {
  calls: number;
  emails: number;
  whatsapp: number;
  documents: number;
};

export function resolveLeadIdsForCounts(lead: {
  id?: string | number | null;
  lead_type?: string | null;
  lead_number?: string | null;
} | null | undefined): {
  isLegacy: boolean;
  legacyId: number | null;
  clientId: string | null;
  leadNumber: string;
} {
  const isLegacy =
    lead?.lead_type === 'legacy' || String(lead?.id ?? '').startsWith('legacy_');

  let legacyId: number | null = null;
  let clientId: string | null = null;

  if (isLegacy) {
    const raw = String(lead?.id ?? '').replace(/^legacy_/, '');
    const n = Number.parseInt(raw, 10);
    legacyId = Number.isFinite(n) ? n : null;
  } else if (lead?.id != null && String(lead.id).trim()) {
    clientId = String(lead.id).trim();
  }

  return {
    isLegacy,
    legacyId,
    clientId,
    leadNumber: String(lead?.lead_number ?? '').trim(),
  };
}

/** Counts for calendar row action badges (calls, emails, WhatsApp, documents). */
export async function fetchLeadActionCounts(lead: {
  id?: string | number | null;
  lead_type?: string | null;
  lead_number?: string | null;
}): Promise<LeadActionCounts> {
  const { isLegacy, legacyId, clientId, leadNumber } = resolveLeadIdsForCounts(lead);
  const empty: LeadActionCounts = { calls: 0, emails: 0, whatsapp: 0, documents: 0 };

  const tasks: Promise<void>[] = [];

  let calls = 0;
  let emails = 0;
  let whatsapp = 0;
  let documents = 0;

  if (isLegacy && legacyId != null) {
    tasks.push(
      supabase
        .from('call_logs')
        .select('id', { count: 'exact', head: true })
        .eq('lead_id', legacyId)
        .then(({ count, error }) => {
          if (!error) calls = count ?? 0;
        }),
    );
    tasks.push(
      supabase
        .from('emails')
        .select('id', { count: 'exact', head: true })
        .eq('legacy_id', legacyId)
        .then(({ count, error }) => {
          if (!error) emails = count ?? 0;
        }),
    );
    tasks.push(
      supabase
        .from('whatsapp_messages')
        .select('id', { count: 'exact', head: true })
        .eq('legacy_id', legacyId)
        .then(({ count, error }) => {
          if (!error) whatsapp = count ?? 0;
        }),
    );
  } else if (clientId) {
    tasks.push(
      supabase
        .from('call_logs')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .then(({ count, error }) => {
          if (!error) calls = count ?? 0;
        }),
    );
    tasks.push(
      supabase
        .from('emails')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .then(({ count, error }) => {
          if (!error) emails = count ?? 0;
        }),
    );
    tasks.push(
      supabase
        .from('whatsapp_messages')
        .select('id', { count: 'exact', head: true })
        .eq('lead_id', clientId)
        .then(({ count, error }) => {
          if (!error) whatsapp = count ?? 0;
        }),
    );
  }

  if (leadNumber) {
    tasks.push(
      supabase
        .from('lead_case_documents')
        .select('id', { count: 'exact', head: true })
        .eq('lead_number', leadNumber)
        .not('storage_path', 'is', null)
        .then(({ count, error }) => {
          if (!error) documents = count ?? 0;
        }),
    );
  }

  if (tasks.length === 0) return empty;

  await Promise.all(tasks);
  return { calls, emails, whatsapp, documents };
}

export type RecentInteractionKind = 'call' | 'email' | 'whatsapp';

export type RecentInteractionItem = {
  kind: RecentInteractionKind;
  id: string;
  at: string;
  preview: string;
  direction: 'in' | 'out' | 'unknown';
  meta?: string;
  /** Call logs: employee who handled the call */
  employeeName?: string;
  employeePhotoUrl?: string | null;
};

export type LeadRecentInteractions = {
  calls: RecentInteractionItem[];
  emails: RecentInteractionItem[];
  whatsapp: RecentInteractionItem[];
};

const RECENT_PER_CHANNEL = 3;

function normalizeDirection(raw: string | null | undefined): 'in' | 'out' | 'unknown' {
  const d = (raw || '').toLowerCase();
  if (d === 'inbound' || d === 'in' || d === 'incoming') return 'in';
  if (d === 'outbound' || d === 'out' || d === 'outgoing') return 'out';
  return 'unknown';
}

function formatCallDuration(seconds: number | string | null | undefined): string | null {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

function callLogIso(row: { cdate?: string | null; time?: string | null }): string {
  const date = (row.cdate || '').trim();
  if (!date) return '';
  const time = (row.time || '00:00:00').trim().substring(0, 8);
  return `${date}T${time || '00:00:00'}`;
}

function truncatePreview(text: string, max = 72): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function resolveEmployeeFromJoin(
  employee:
    | { display_name?: string | null; photo_url?: string | null; photo?: string | null }
    | { display_name?: string | null; photo_url?: string | null; photo?: string | null }[]
    | null
    | undefined,
): { name: string; photoUrl: string | null } {
  const row = Array.isArray(employee) ? employee[0] : employee;
  const name = (row?.display_name || '').trim();
  const photoUrl = (row?.photo_url || row?.photo || '').trim() || null;
  return { name, photoUrl };
}

function mapCallRow(row: {
  id: number | string;
  cdate?: string | null;
  time?: string | null;
  direction?: string | null;
  status?: string | null;
  duration?: number | string | null;
  tenants_employee?:
    | { display_name?: string | null; photo_url?: string | null; photo?: string | null }
    | { display_name?: string | null; photo_url?: string | null; photo?: string | null }[]
    | null;
}): RecentInteractionItem {
  const dir = normalizeDirection(row.direction);
  const duration = formatCallDuration(row.duration);
  const status = (row.status || '').trim();
  const { name: employeeName, photoUrl: employeePhotoUrl } = resolveEmployeeFromJoin(row.tenants_employee);
  const previewParts = [duration, status].filter(Boolean);
  return {
    kind: 'call',
    id: String(row.id),
    at: callLogIso(row),
    preview: previewParts.length > 0 ? previewParts.join(' · ') : 'Phone call',
    direction: dir,
    employeeName: employeeName || undefined,
    employeePhotoUrl: employeePhotoUrl || undefined,
    meta: employeeName || undefined,
  };
}

function mapEmailRow(row: {
  id: number | string;
  sent_at?: string | null;
  subject?: string | null;
  direction?: string | null;
  body_preview?: string | null;
  sender_email?: string | null;
}): RecentInteractionItem {
  const subject = (row.subject || '').trim();
  const preview = truncatePreview(subject || row.body_preview || 'Email');
  const sender = (row.sender_email || '').trim();
  return {
    kind: 'email',
    id: String(row.id),
    at: row.sent_at || '',
    preview,
    direction: normalizeDirection(row.direction),
    meta: sender ? truncatePreview(sender, 40) : undefined,
  };
}

function mapWhatsAppRow(row: {
  id: number | string;
  sent_at?: string | null;
  message?: string | null;
  direction?: string | null;
  sender_name?: string | null;
}): RecentInteractionItem {
  const preview = truncatePreview((row.message || '').trim() || 'WhatsApp message');
  return {
    kind: 'whatsapp',
    id: String(row.id),
    at: row.sent_at || '',
    preview,
    direction: normalizeDirection(row.direction),
    meta: (row.sender_name || '').trim() || undefined,
  };
}

/** Latest calls, emails, and WhatsApp messages for the calendar action modal. */
export async function fetchLeadRecentInteractions(
  lead: {
    id?: string | number | null;
    lead_type?: string | null;
    lead_number?: string | null;
  },
  limit = RECENT_PER_CHANNEL,
): Promise<LeadRecentInteractions> {
  const { isLegacy, legacyId, clientId } = resolveLeadIdsForCounts(lead);
  const empty: LeadRecentInteractions = { calls: [], emails: [], whatsapp: [] };

  const tasks: Promise<void>[] = [];
  let calls: RecentInteractionItem[] = [];
  let emails: RecentInteractionItem[] = [];
  let whatsapp: RecentInteractionItem[] = [];

  if (isLegacy && legacyId != null) {
    tasks.push(
      supabase
        .from('call_logs')
        .select(
          'id, cdate, time, direction, status, duration, tenants_employee!employee_id(display_name, photo_url, photo)',
        )
        .eq('lead_id', legacyId)
        .order('cdate', { ascending: false })
        .limit(limit)
        .then(({ data, error }) => {
          if (!error && data) calls = data.map(mapCallRow);
        }),
    );
    tasks.push(
      supabase
        .from('emails')
        .select('id, sent_at, subject, direction, body_preview, sender_email')
        .eq('legacy_id', legacyId)
        .order('sent_at', { ascending: false })
        .limit(limit)
        .then(({ data, error }) => {
          if (!error && data) emails = data.map(mapEmailRow);
        }),
    );
    tasks.push(
      supabase
        .from('whatsapp_messages')
        .select('id, sent_at, message, direction, sender_name')
        .eq('legacy_id', legacyId)
        .order('sent_at', { ascending: false })
        .limit(limit)
        .then(({ data, error }) => {
          if (!error && data) whatsapp = data.map(mapWhatsAppRow);
        }),
    );
  } else if (clientId) {
    tasks.push(
      supabase
        .from('call_logs')
        .select(
          'id, cdate, time, direction, status, duration, tenants_employee!employee_id(display_name, photo_url, photo)',
        )
        .eq('client_id', clientId)
        .order('cdate', { ascending: false })
        .limit(limit)
        .then(({ data, error }) => {
          if (!error && data) calls = data.map(mapCallRow);
        }),
    );
    tasks.push(
      supabase
        .from('emails')
        .select('id, sent_at, subject, direction, body_preview, sender_email')
        .eq('client_id', clientId)
        .order('sent_at', { ascending: false })
        .limit(limit)
        .then(({ data, error }) => {
          if (!error && data) emails = data.map(mapEmailRow);
        }),
    );
    tasks.push(
      supabase
        .from('whatsapp_messages')
        .select('id, sent_at, message, direction, sender_name')
        .eq('lead_id', clientId)
        .order('sent_at', { ascending: false })
        .limit(limit)
        .then(({ data, error }) => {
          if (!error && data) whatsapp = data.map(mapWhatsAppRow);
        }),
    );
  }

  if (tasks.length === 0) return empty;
  await Promise.all(tasks);
  return { calls, emails, whatsapp };
}

export async function fetchLeadActionPanelData(lead: {
  id?: string | number | null;
  lead_type?: string | null;
  lead_number?: string | null;
}): Promise<{ counts: LeadActionCounts; recent: LeadRecentInteractions }> {
  const [counts, recent] = await Promise.all([
    fetchLeadActionCounts(lead),
    fetchLeadRecentInteractions(lead),
  ]);
  return { counts, recent };
}
