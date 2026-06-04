import { supabase } from './supabase';

/** Stored interaction shape (JSON column + table payload). */
export type ManualInteractionRecord = {
  id: string | number;
  date?: string;
  time?: string;
  raw_date?: string;
  employee?: string;
  recipient_name?: string | null;
  direction?: 'in' | 'out' | string;
  kind?: string;
  length?: string;
  content?: string;
  observation?: string;
  editable?: boolean;
  contact_id?: number | null;
  contact_name?: string | null;
  minutes?: number | null;
  [key: string]: unknown;
};

export type LeadManualInteractionRow = {
  id: string;
  lead_id: string;
  kind: string;
  direction: string;
  interaction_date: string | null;
  interaction_time: string | null;
  raw_date: string;
  employee: string | null;
  recipient_name: string | null;
  contact_id: number | null;
  contact_name: string | null;
  content: string | null;
  observation: string | null;
  length: string | null;
  minutes: number | null;
  editable: boolean;
  payload: Record<string, unknown>;
};

const TABLE = 'lead_manual_interactions';

/** Canonical id: always `manual_<timestamp>` so JSON numeric ids dedupe with prefixed ids. */
export function normalizeManualInteractionId(id: string | number | null | undefined): string {
  if (id == null || id === '') return '';
  const s = String(id).trim();
  if (!s) return '';
  if (s.startsWith('manual_')) return s;
  if (/^\d+$/.test(s)) return `manual_${s}`;
  return s;
}

export function dedupeManualInteractionRecords(rows: ManualInteractionRecord[]): ManualInteractionRecord[] {
  const byId = new Map<string, ManualInteractionRecord>();
  for (const row of rows) {
    const key = normalizeManualInteractionId(row.id);
    if (!key) continue;
    const existing = byId.get(key);
    if (!existing) {
      byId.set(key, { ...row, id: key });
      continue;
    }
    const existingRaw = existing.raw_date ? new Date(existing.raw_date).getTime() : 0;
    const rowRaw = row.raw_date ? new Date(row.raw_date).getTime() : 0;
    if (rowRaw >= existingRaw) {
      byId.set(key, { ...existing, ...row, id: key });
    }
  }
  return Array.from(byId.values());
}

export function recordToTableRow(
  leadId: string,
  record: ManualInteractionRecord,
): Omit<LeadManualInteractionRow, 'created_at' | 'updated_at'> {
  const id = normalizeManualInteractionId(record.id);
  const {
    date,
    time,
    raw_date,
    employee,
    recipient_name,
    direction,
    kind,
    length,
    content,
    observation,
    editable,
    contact_id,
    contact_name,
    minutes,
    ...rest
  } = record;

  return {
    id,
    lead_id: leadId,
    kind: String(kind || 'call'),
    direction: direction === 'in' ? 'in' : 'out',
    interaction_date: date != null ? String(date) : null,
    interaction_time: time != null ? String(time) : null,
    raw_date: raw_date || new Date().toISOString(),
    employee: employee != null ? String(employee) : null,
    recipient_name: recipient_name != null ? String(recipient_name) : null,
    contact_id: contact_id != null ? Number(contact_id) : null,
    contact_name: contact_name != null ? String(contact_name) : null,
    content: content != null ? String(content) : null,
    observation: observation != null ? String(observation) : null,
    length: length != null ? String(length) : null,
    minutes: minutes != null ? Number(minutes) : null,
    editable: editable !== false,
    payload: rest as Record<string, unknown>,
  };
}

export function tableRowToRecord(row: LeadManualInteractionRow): ManualInteractionRecord {
  const payload = (row.payload || {}) as Record<string, unknown>;
  return {
    ...payload,
    id: row.id,
    date: row.interaction_date ?? undefined,
    time: row.interaction_time ?? undefined,
    raw_date: row.raw_date,
    employee: row.employee ?? undefined,
    recipient_name: row.recipient_name ?? undefined,
    direction: row.direction as 'in' | 'out',
    kind: row.kind,
    length: row.length ?? undefined,
    content: row.content ?? undefined,
    observation: row.observation ?? undefined,
    editable: row.editable,
    contact_id: row.contact_id,
    contact_name: row.contact_name,
    minutes: row.minutes,
  };
}

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    msg.includes('lead_manual_interactions') ||
    msg.includes('does not exist')
  );
}

async function fetchTableRows(leadId: string): Promise<ManualInteractionRecord[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('lead_id', leadId)
    .order('raw_date', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data || []).map((row) => tableRowToRecord(row as LeadManualInteractionRow));
}

/**
 * Merge table rows + legacy JSONB (deduped by normalized id; table wins on conflict).
 */
export async function fetchLeadManualInteractionsMerged(
  leadId: string,
  jsonFallback: ManualInteractionRecord[] | null | undefined,
): Promise<ManualInteractionRecord[]> {
  let tableRows: ManualInteractionRecord[] = [];
  try {
    tableRows = await fetchTableRows(leadId);
  } catch (e) {
    console.warn('[leadManualInteractions] table fetch failed, using JSON only:', e);
  }

  const jsonRows = Array.isArray(jsonFallback) ? jsonFallback : [];
  const tableIds = new Set(tableRows.map((r) => normalizeManualInteractionId(r.id)));
  const legacyOnly = jsonRows.filter((r) => {
    const key = normalizeManualInteractionId(r.id);
    return key && !tableIds.has(key);
  });

  return dedupeManualInteractionRecords([...tableRows, ...legacyOnly]);
}

/** Mirror merged manuals to leads.manual_interactions for stage triggers & legacy readers. */
export async function syncLeadManualInteractionsJsonColumn(
  leadId: string,
  records: ManualInteractionRecord[],
): Promise<void> {
  const deduped = dedupeManualInteractionRecords(records);
  const { error } = await supabase
    .from('leads')
    .update({
      manual_interactions: deduped,
      latest_interaction: new Date().toISOString(),
    })
    .eq('id', leadId);

  if (error) throw error;
}

export async function insertLeadManualInteraction(
  leadId: string,
  record: ManualInteractionRecord,
): Promise<ManualInteractionRecord[]> {
  const normalized = { ...record, id: normalizeManualInteractionId(record.id) };
  const row = recordToTableRow(leadId, normalized);

  const { error: upsertError } = await supabase.from(TABLE).upsert(row, { onConflict: 'id' });

  const { data: latestLead, error: fetchError } = await supabase
    .from('leads')
    .select('manual_interactions')
    .eq('id', leadId)
    .single();

  if (fetchError) throw fetchError;

  if (upsertError && isMissingTableError(upsertError)) {
    const merged = dedupeManualInteractionRecords([
      ...(latestLead?.manual_interactions || []),
      normalized,
    ]);
    await syncLeadManualInteractionsJsonColumn(leadId, merged);
    return merged;
  }

  if (upsertError) throw upsertError;

  const merged = await fetchLeadManualInteractionsMerged(leadId, latestLead?.manual_interactions);
  await syncLeadManualInteractionsJsonColumn(leadId, merged);
  return merged;
}

export async function replaceLeadManualInteractions(
  leadId: string,
  records: ManualInteractionRecord[],
): Promise<ManualInteractionRecord[]> {
  const deduped = dedupeManualInteractionRecords(
    records.map((r) => ({ ...r, id: normalizeManualInteractionId(r.id) })),
  );

  const { error: tableProbe } = await supabase.from(TABLE).select('id').eq('lead_id', leadId).limit(1);

  if (!tableProbe || !isMissingTableError(tableProbe)) {
    const { error: delError } = await supabase.from(TABLE).delete().eq('lead_id', leadId);
    if (delError && !isMissingTableError(delError)) throw delError;

    if (deduped.length > 0) {
      const rows = deduped.map((r) => recordToTableRow(leadId, r));
      const { error: upsertError } = await supabase.from(TABLE).upsert(rows, { onConflict: 'id' });
      if (upsertError && !isMissingTableError(upsertError)) throw upsertError;
    }
  }

  await syncLeadManualInteractionsJsonColumn(leadId, deduped);
  return deduped;
}

export function generateManualInteractionId(): string {
  return `manual_${Date.now()}`;
}
