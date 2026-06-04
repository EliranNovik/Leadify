import { supabase } from './supabase';

export type LegacyDbKind = 'e' | 'c' | 'w' | 'EMPTY';

const UI_TO_DB_KIND: Record<string, LegacyDbKind> = {
  email: 'e',
  email_manual: 'e',
  call: 'c',
  call_log: 'c',
  whatsapp: 'w',
  whatsapp_manual: 'w',
  sms: 'EMPTY',
  office: 'EMPTY',
  note: 'EMPTY',
  meeting: 'EMPTY',
};

const DB_TO_UI_KIND: Record<string, string> = {
  e: 'email_manual',
  w: 'whatsapp_manual',
  c: 'call',
};

export function parseLegacyInteractionTimelineId(timelineId: string | number): number | null {
  const s = String(timelineId);
  if (!s.startsWith('legacy_')) return null;
  const n = parseInt(s.replace(/^legacy_/, ''), 10);
  return Number.isNaN(n) ? null : n;
}

export function legacyInteractionTimelineId(dbId: number): string {
  return `legacy_${dbId}`;
}

/** Numeric suffix shared by `manual_1995` (JSON) and `legacy_1995` (DB) — for dedupe on legacy leads. */
export function legacyInteractionNumericKey(
  timelineId: string | number | null | undefined,
): string | null {
  if (timelineId == null) return null;
  const s = String(timelineId);
  if (s.startsWith('legacy_')) {
    const n = s.replace(/^legacy_/, '').replace(/^pending_/, '');
    return /^\d+$/.test(n) ? n : null;
  }
  if (s.startsWith('manual_')) {
    const n = s.replace(/^manual_/, '');
    return /^\d+$/.test(n) ? n : null;
  }
  if (/^\d+$/.test(s)) return s;
  return null;
}

async function allocateLegacyLeadInteractionId(): Promise<number> {
  const { data, error } = await supabase
    .from('leads_leadinteractions')
    .select('id')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.id ?? 0) + 1;
}

export function isLegacyTimelineInteractionId(id: string | number | null | undefined): boolean {
  if (id == null) return false;
  const s = String(id);
  return s.startsWith('legacy_') || s.startsWith('legacy_pending_');
}

/** UI kinds stored in leads_leadinteractions (manual entry / editable in timeline). */
export function isLegacyManualInteractionKind(kind: string | null | undefined): boolean {
  if (!kind) return false;
  return [
    'email_manual',
    'whatsapp_manual',
    'email',
    'whatsapp',
    'call',
    'call_log',
    'sms',
    'office',
    'note',
    'meeting',
  ].includes(kind);
}

export function mapUiKindToLegacyDbKind(uiKind: string): LegacyDbKind {
  return UI_TO_DB_KIND[uiKind] || 'EMPTY';
}

export function mapLegacyDbKindToUiKind(dbKind: string | null, description?: string | null): string {
  const desc = description || '';
  if (dbKind === 'EMPTY') {
    if (desc.startsWith('METHOD:sms|')) return 'sms';
    if (desc.startsWith('METHOD:office|')) return 'office';
    return 'note';
  }
  return DB_TO_UI_KIND[dbKind || ''] || 'note';
}

export function buildLegacyDescription(observation: string | null | undefined, uiKind: string): string | null {
  let descriptionValue = observation || null;
  if (uiKind === 'sms') {
    return descriptionValue ? `METHOD:sms|${descriptionValue}` : 'METHOD:sms|';
  }
  if (uiKind === 'office') {
    return descriptionValue ? `METHOD:office|${descriptionValue}` : 'METHOD:office|';
  }
  return descriptionValue;
}

export function stripLegacyDescriptionPrefix(description: string | null | undefined): string {
  return (description || '').replace(/^METHOD:(sms|office)\|/, '');
}

export function formatLegacyInteractionDateForDb(
  displayDate: string | undefined,
  fallback: Date,
): string {
  if (!displayDate) return fallback.toISOString().split('T')[0];
  if (displayDate.includes('.')) {
    const dateParts = displayDate.split('.');
    if (dateParts.length === 3) {
      const day = dateParts[0].padStart(2, '0');
      const month = dateParts[1].padStart(2, '0');
      const year = dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2];
      return `${year}-${month}-${day}`;
    }
  }
  if (displayDate.includes('/')) {
    const dateParts = displayDate.split('/');
    if (dateParts.length === 3) {
      const [day, month, year] = dateParts;
      const fullYear = year.length === 2 ? `20${year}` : year;
      return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }
  if (displayDate.includes('-')) return displayDate;
  return fallback.toISOString().split('T')[0];
}

export function formatLegacyInteractionTimeForDb(
  displayTime: string | undefined,
  fallback: Date,
): string {
  if (!displayTime) return fallback.toTimeString().split(' ')[0];
  if (/^\d{2}:\d{2}$/.test(displayTime)) return `${displayTime}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(displayTime)) return displayTime;
  return fallback.toTimeString().split(' ')[0];
}

export type LegacyInteractionInsertInput = {
  leadId: number;
  uiKind: string;
  direction: 'in' | 'out';
  date?: string;
  time?: string;
  content?: string;
  observation?: string;
  lengthMinutes?: number | null;
  employeeId?: number | null;
  leadsContactId?: number | null;
};

export async function resolveLeadLeadcontactId(
  leadId: number,
  leadsContactId: number,
): Promise<number | null> {
  const { data, error } = await supabase
    .from('lead_leadcontact')
    .select('id')
    .eq('lead_id', leadId)
    .eq('contact_id', leadsContactId)
    .maybeSingle();
  if (error || !data?.id) return null;
  return data.id;
}

export async function insertLegacyLeadInteraction(
  input: LegacyInteractionInsertInput,
): Promise<{ dbId: number; row: Record<string, unknown> }> {
  const now = new Date();
  const dbKind = mapUiKindToLegacyDbKind(input.uiKind);
  const dbDirection = input.direction === 'out' ? 'o' : 'i';
  const interactionDate = formatLegacyInteractionDateForDb(input.date, now);
  const interactionTime = formatLegacyInteractionTimeForDb(input.time, now);

  const insertPayload: Record<string, unknown> = {
    cdate: now.toISOString(),
    udate: now.toISOString(),
    kind: dbKind,
    date: interactionDate,
    time: interactionTime,
    minutes: input.lengthMinutes ?? null,
    content: input.content || '',
    creator_id: input.employeeId != null ? String(input.employeeId) : null,
    lead_id: input.leadId,
    direction: dbDirection,
    description: buildLegacyDescription(input.observation, input.uiKind),
    employee_id: input.employeeId != null ? String(input.employeeId) : null,
  };

  if (input.leadsContactId != null && input.leadsContactId !== -1) {
    const leadContactId = await resolveLeadLeadcontactId(input.leadId, input.leadsContactId);
    if (leadContactId != null) insertPayload.contact_id = leadContactId;
  }

  const selectCols =
    'id, cdate, kind, date, time, minutes, content, direction, description, contact_id';

  let { data, error } = await supabase
    .from('leads_leadinteractions')
    .insert(insertPayload)
    .select(selectCols)
    .single();

  // Sequence can lag behind MAX(id) when rows were inserted with explicit ids historically
  if (error?.code === '23505') {
    const nextId = await allocateLegacyLeadInteractionId();
    const retry = await supabase
      .from('leads_leadinteractions')
      .insert({ ...insertPayload, id: nextId })
      .select(selectCols)
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) throw error;
  if (!data?.id) throw new Error('Insert returned no id');

  return { dbId: Number(data.id), row: data as Record<string, unknown> };
}

export type LegacyInteractionUpdateInput = {
  timelineId: string | number;
  uiKind: string;
  direction: 'in' | 'out';
  date: string;
  time: string;
  rawDate: string;
  content: string;
  observation: string;
  lengthMinutes?: number | null;
};

export async function updateLegacyLeadInteraction(
  input: LegacyInteractionUpdateInput,
): Promise<void> {
  const dbId = parseLegacyInteractionTimelineId(input.timelineId);
  if (dbId == null) throw new Error(`Invalid legacy interaction id: ${input.timelineId}`);

  const fallback = new Date(input.rawDate || Date.now());
  const dbKind = mapUiKindToLegacyDbKind(input.uiKind);
  const dbDirection = input.direction === 'out' ? 'o' : 'i';

  const { error } = await supabase
    .from('leads_leadinteractions')
    .update({
      udate: new Date().toISOString(),
      cdate: input.rawDate || fallback.toISOString(),
      kind: dbKind,
      date: formatLegacyInteractionDateForDb(input.date, fallback),
      time: formatLegacyInteractionTimeForDb(input.time, fallback),
      minutes: input.lengthMinutes ?? null,
      content: input.content || '',
      direction: dbDirection,
      description: buildLegacyDescription(input.observation, input.uiKind),
    })
    .eq('id', dbId);

  if (error) throw error;
}

export async function fetchLegacyLeadInteractionRow(
  timelineId: string | number,
): Promise<Record<string, unknown> | null> {
  const dbId = parseLegacyInteractionTimelineId(timelineId);
  if (dbId == null) return null;

  const { data, error } = await supabase
    .from('leads_leadinteractions')
    .select(
      'id, cdate, kind, date, time, minutes, content, creator_id, direction, employee_id, description, contact_id',
    )
    .eq('id', dbId)
    .maybeSingle();

  if (error) throw error;
  return data as Record<string, unknown> | null;
}
