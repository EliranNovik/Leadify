import { supabase } from './supabase';
import toast from 'react-hot-toast';

export const FIRM_TYPE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeFirmTypeIds(raw: unknown): string[] {
  if (raw == null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map((x) => String(x).trim())
    .filter((id) => FIRM_TYPE_UUID_RE.test(id));
}

/** Sync firm ↔ firm_types via firm_firm_type junction (matches admin FirmsManager). */
export async function syncFirmFirmTypes(firmId: string, typeIds: string[]): Promise<void> {
  if (!firmId) return;
  const { error: deleteError } = await supabase.from('firm_firm_type').delete().eq('firm_id', firmId);
  if (deleteError) throw deleteError;

  const clean = normalizeFirmTypeIds(typeIds);
  if (!clean.length) return;

  const rows = clean.map((firm_type_id) => ({ firm_id: firmId, firm_type_id }));
  const { error: insertError } = await supabase.from('firm_firm_type').insert(rows);
  if (insertError) throw insertError;
}

export async function fetchFirmTypeIdsForFirm(firmId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('firm_firm_type')
    .select('firm_type_id')
    .eq('firm_id', firmId);
  if (error) throw error;
  return normalizeFirmTypeIds((data || []).map((r) => r.firm_type_id));
}

export type FirmTypeEnrichment = {
  firm_type_ids?: string[];
  _firm_type_labels?: string[];
};

type FirmLike = { id: string; firm_type_id?: string | null } & FirmTypeEnrichment;

/** Attach firm_type_ids + labels from junction (and legacy firm_type_id). */
export async function enrichFirmsWithFirmTypes<T extends FirmLike>(firmRecords: T[]): Promise<void> {
  const firmIds = firmRecords.map((r) => r.id).filter(Boolean);
  if (!firmIds.length) return;

  const { data, error } = await supabase
    .from('firm_firm_type')
    .select('firm_id, firm_type_id, firm_types ( label )')
    .in('firm_id', firmIds);

  if (error) {
    console.error('Error fetching firm_firm_type:', error);
    return;
  }

  const byFirm = new Map<string, { ids: string[]; labels: string[] }>();
  (data || []).forEach((row: {
    firm_id: string;
    firm_type_id: string;
    firm_types?: { label: string | null } | { label: string | null }[] | null;
  }) => {
    const firmId = String(row.firm_id);
    if (!byFirm.has(firmId)) byFirm.set(firmId, { ids: [], labels: [] });
    const entry = byFirm.get(firmId)!;
    if (row.firm_type_id) entry.ids.push(String(row.firm_type_id));
    const nested = row.firm_types;
    const label = (Array.isArray(nested) ? nested[0]?.label : nested?.label)?.trim() || '';
    if (label) entry.labels.push(label);
  });

  const primaryOnlyTypeIds = new Set<string>();
  firmRecords.forEach((r) => {
    const entry = byFirm.get(String(r.id));
    if (entry?.ids.length) {
      r.firm_type_ids = entry.ids;
      r._firm_type_labels = entry.labels;
    } else if (r.firm_type_id && FIRM_TYPE_UUID_RE.test(String(r.firm_type_id))) {
      const tid = String(r.firm_type_id);
      r.firm_type_ids = [tid];
      r._firm_type_labels = [];
      primaryOnlyTypeIds.add(tid);
    } else {
      r.firm_type_ids = [];
      r._firm_type_labels = [];
    }
  });

  if (primaryOnlyTypeIds.size > 0) {
    const { data: typeRows } = await supabase
      .from('firm_types')
      .select('id, label')
      .in('id', [...primaryOnlyTypeIds]);
    const labelById = new Map(
      (typeRows || []).map((t: { id: string; label: string | null }) => [
        String(t.id),
        t.label?.trim() || 'Unnamed type',
      ]),
    );
    firmRecords.forEach((r) => {
      if (r._firm_type_labels?.length) return;
      const tid = r.firm_type_id ? String(r.firm_type_id) : '';
      const label = labelById.get(tid);
      if (label) r._firm_type_labels = [label];
    });
  }
}

export async function syncFirmFirmTypesWithToast(firmId: string, typeIds: string[]): Promise<boolean> {
  try {
    await syncFirmFirmTypes(firmId, typeIds);
    return true;
  } catch (error) {
    console.error('syncFirmFirmTypes:', error);
    toast.error('Firm saved, but linking firm types failed. Check permissions on firm_firm_type.');
    return false;
  }
}
