import { supabase } from './supabase';

export type RmqAiLeadRow = {
  id?: unknown;
  name?: unknown;
  lead_number?: unknown;
  manual_id?: unknown;
};

export function pickJoinedRow<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] || null : value;
}

export function clickableLeadNumber(row: RmqAiLeadRow | null | undefined): string {
  if (!row) return '';
  const number = String(row.lead_number || '').trim();
  if (number && !/^unnamed/i.test(number) && number.toUpperCase() !== 'STAFF') return number;
  const manual = String(row.manual_id || '').trim();
  if (manual && !/^unnamed/i.test(manual)) return manual;
  const id = String(row.id || '')
    .replace(/^legacy_/i, '')
    .trim();
  if (/^\d{4,}$/.test(id)) return id;
  return '';
}

export function leadDisplayName(row: RmqAiLeadRow | null | undefined): string {
  const name = String(row?.name || '').trim();
  if (!name || /^unnamed/i.test(name)) return '';
  return name;
}

export function leadChatLabel(row: RmqAiLeadRow | null | undefined, fallback = ''): string {
  const number = clickableLeadNumber(row);
  const name = leadDisplayName(row);
  if (number && name) return `${number} ${name}`;
  if (number) return number;
  const id = String(row?.id || '').trim();
  if (name && id) return `[${name}](/clients/${encodeURIComponent(id)})`;
  if (name) return name;
  return fallback;
}

export async function lookupLeadsByIds(
  newIds: Array<string | null | undefined>,
  legacyIds: Array<string | number | null | undefined>,
): Promise<{
  newById: Map<string, RmqAiLeadRow>;
  legacyById: Map<string, RmqAiLeadRow>;
}> {
  const uniqNew = [...new Set(newIds.map((id) => String(id || '').trim()).filter(Boolean))];
  const uniqLegacy = [
    ...new Set(
      legacyIds
        .map((id) => String(id || '').replace(/^legacy_/i, '').trim())
        .filter((id) => id && id !== 'null' && id !== 'undefined'),
    ),
  ];
  const [newRes, legacyRes] = await Promise.all([
    uniqNew.length
      ? supabase.from('leads').select('id, name, lead_number, manual_id').in('id', uniqNew)
      : Promise.resolve({ data: [] as RmqAiLeadRow[] }),
    uniqLegacy.length
      ? supabase.from('leads_lead').select('id, name, lead_number, manual_id').in('id', uniqLegacy)
      : Promise.resolve({ data: [] as RmqAiLeadRow[] }),
  ]);
  const newById = new Map<string, RmqAiLeadRow>();
  const legacyById = new Map<string, RmqAiLeadRow>();
  for (const row of newRes.data || []) {
    newById.set(String(row.id), row);
  }
  for (const row of legacyRes.data || []) {
    legacyById.set(String(row.id), row);
  }
  return { newById, legacyById };
}

export function resolveMeetingLead(meeting: {
  client_id?: unknown;
  legacy_lead_id?: unknown;
  lead?: RmqAiLeadRow | RmqAiLeadRow[] | null;
  leads?: RmqAiLeadRow | RmqAiLeadRow[] | null;
  legacy_lead?: RmqAiLeadRow | RmqAiLeadRow[] | null;
  leads_lead?: RmqAiLeadRow | RmqAiLeadRow[] | null;
  maps?: { newById: Map<string, RmqAiLeadRow>; legacyById: Map<string, RmqAiLeadRow> };
}): Promise<{ lead: RmqAiLeadRow | null; isLegacy: boolean }> {
  const embeddedNew = pickJoinedRow(meeting.lead) || pickJoinedRow(meeting.leads);
  const embeddedLegacy = pickJoinedRow(meeting.legacy_lead) || pickJoinedRow(meeting.leads_lead);
  if (clickableLeadNumber(embeddedNew) || leadDisplayName(embeddedNew)) {
    return { lead: embeddedNew, isLegacy: false };
  }
  if (clickableLeadNumber(embeddedLegacy) || leadDisplayName(embeddedLegacy)) {
    return { lead: embeddedLegacy, isLegacy: true };
  }
  const maps = meeting.maps;
  if (maps) {
    if (meeting.client_id) {
      const hit = maps.newById.get(String(meeting.client_id));
      if (hit) return { lead: hit, isLegacy: false };
    }
    if (meeting.legacy_lead_id != null && String(meeting.legacy_lead_id).trim() !== '') {
      const hit = maps.legacyById.get(String(meeting.legacy_lead_id).replace(/^legacy_/i, ''));
      if (hit) return { lead: hit, isLegacy: true };
    }
  }
  return { lead: embeddedNew || embeddedLegacy, isLegacy: Boolean(meeting.legacy_lead_id) };
}
