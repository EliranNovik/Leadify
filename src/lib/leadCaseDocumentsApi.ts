import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CASE_DOCUMENTS_SIGNED_URL_SECONDS,
  CASE_DOCUMENTS_STORAGE_BUCKET,
  buildCaseDocumentStoragePath,
  resolveCaseDocumentUploadContentType,
} from './caseDocumentsStorage';
import { supabase } from './supabase';
import { fetchStageActorInfo } from './leadStageManager';

export type LeadCaseDocumentType = {
  id: string;
  name: string;
  sort_order: number;
};

export type LeadCaseContactRow = {
  id: number;
  name: string;
  relationship: string;
  isMain: boolean;
};

export type LeadCaseDocumentRow = {
  id: string;
  lead_number: string;
  file_name: string;
  storage_path: string | null;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
  uploaded_by: string | null;
  contact_id: number | null;
  document_type_id: string | null;
  document_type_name?: string | null;
  signed_url?: string | null;
};

export function resolveLeadNumberFromClient(client: {
  lead_number?: string | null;
  id?: unknown;
}): string {
  const explicit = String(client.lead_number ?? '').trim();
  if (explicit) return explicit;
  const id = String(client.id ?? '').trim();
  if (id.startsWith('legacy_')) return id.replace('legacy_', '');
  return id;
}

export function isLegacyClient(client: { id?: unknown; lead_type?: string | null }): boolean {
  const id = String(client.id ?? '');
  return client.lead_type === 'legacy' || id.startsWith('legacy_');
}

export async function fetchLeadCaseDocumentTypes(
  client: SupabaseClient = supabase,
): Promise<LeadCaseDocumentType[]> {
  const { data, error } = await client
    .from('lead_case_document_types')
    .select('id, name, sort_order')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ''),
    sort_order: Number(row.sort_order ?? 0),
  }));
}

export async function fetchLeadContactsForDocuments(client: {
  id?: unknown;
  lead_type?: string | null;
  name?: string | null;
}): Promise<LeadCaseContactRow[]> {
  const isLegacy = isLegacyClient(client);
  const legacyId = isLegacy ? String(client.id).replace('legacy_', '') : null;
  const newLeadId = !isLegacy ? String(client.id ?? '') : null;

  let query = supabase
    .from('lead_leadcontact')
    .select(
      `
      id,
      main,
      contact_id,
      leads_contact (
        id,
        name
      )
    `,
    );

  if (legacyId) query = query.eq('lead_id', legacyId);
  else if (newLeadId) query = query.eq('newlead_id', newLeadId);
  else return [];

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as any[];
  const contacts: LeadCaseContactRow[] = [];

  for (const row of rows) {
    const lc = Array.isArray(row.leads_contact) ? row.leads_contact[0] : row.leads_contact;
    if (!lc?.id) continue;
    const isMain = row.main === true || row.main === 'true' || row.main === 't';
    contacts.push({
      id: Number(lc.id),
      name: String(lc.name ?? '—'),
      relationship: isMain ? 'Main applicant' : 'Applicant',
      isMain,
    });
  }

  contacts.sort((a, b) => {
    if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  if (!contacts.length && client.name) {
    contacts.push({
      id: 0,
      name: String(client.name),
      relationship: 'Main applicant',
      isMain: true,
    });
  }

  return contacts;
}

export async function fetchLeadCaseDocumentTypeAssignments(
  leadNumber: string,
): Promise<Array<{ document_type_id: string; sort_order: number }>> {
  const leadNum = String(leadNumber ?? '').trim();
  if (!leadNum) return [];

  const { data, error } = await supabase
    .from('lead_case_document_type_assignments')
    .select('document_type_id, sort_order')
    .eq('lead_number', leadNum)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => ({
    document_type_id: String((row as { document_type_id: unknown }).document_type_id),
    sort_order: Number((row as { sort_order?: unknown }).sort_order ?? 0),
  }));
}

export async function assignLeadCaseDocumentType(
  leadNumber: string,
  documentTypeId: string,
  sortOrder?: number,
): Promise<void> {
  const leadNum = String(leadNumber ?? '').trim();
  const typeId = String(documentTypeId ?? '').trim();
  if (!leadNum || !typeId) throw new Error('Lead and document type are required');

  const { data: existing } = await supabase
    .from('lead_case_document_type_assignments')
    .select('sort_order')
    .eq('lead_number', leadNum)
    .order('sort_order', { ascending: false })
    .limit(1);

  const nextSort =
    sortOrder ??
    (existing?.length ? Number((existing[0] as { sort_order?: number }).sort_order ?? 0) + 10 : 0);

  const { error } = await supabase.from('lead_case_document_type_assignments').upsert(
    {
      lead_number: leadNum,
      document_type_id: typeId,
      sort_order: nextSort,
    },
    { onConflict: 'lead_number,document_type_id' },
  );

  if (error) throw error;
}

/** Columns for the CRM grid: explicit per-lead assignments + types already used in uploads. */
export async function resolveLeadActiveDocumentTypes(
  leadNumber: string,
  catalog: LeadCaseDocumentType[],
): Promise<LeadCaseDocumentType[]> {
  const catalogById = new Map(catalog.map((t) => [t.id, t]));
  const orderedIds: string[] = [];
  const seen = new Set<string>();

  const assignments = await fetchLeadCaseDocumentTypeAssignments(leadNumber);
  for (const row of assignments) {
    if (!seen.has(row.document_type_id) && catalogById.has(row.document_type_id)) {
      seen.add(row.document_type_id);
      orderedIds.push(row.document_type_id);
    }
  }

  const leadNum = String(leadNumber ?? '').trim();
  if (leadNum) {
    const { data: docTypeRows, error } = await supabase
      .from('lead_case_documents')
      .select('document_type_id')
      .eq('lead_number', leadNum)
      .not('document_type_id', 'is', null);

    if (error) throw error;

    for (const row of docTypeRows ?? []) {
      const id = String((row as { document_type_id?: unknown }).document_type_id ?? '');
      if (id && !seen.has(id) && catalogById.has(id)) {
        seen.add(id);
        orderedIds.push(id);
      }
    }
  }

  return orderedIds
    .map((id) => catalogById.get(id))
    .filter((t): t is LeadCaseDocumentType => t != null);
}

export async function fetchLeadCaseDocumentsForGrid(
  leadNumber: string,
  documentTypes: LeadCaseDocumentType[],
): Promise<LeadCaseDocumentRow[]> {
  const leadNum = String(leadNumber ?? '').trim();
  if (!leadNum) return [];

  const typeById = new Map(documentTypes.map((t) => [t.id, t.name]));

  const { data, error } = await supabase
    .from('lead_case_documents')
    .select(
      'id, lead_number, file_name, storage_path, mime_type, file_size, created_at, uploaded_by, contact_id, document_type_id',
    )
    .eq('lead_number', leadNum)
    .not('storage_path', 'is', null)
    .not('contact_id', 'is', null)
    .not('document_type_id', 'is', null)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as LeadCaseDocumentRow[];
  const withUrls = await Promise.all(
    rows.map(async (row) => {
      const path = row.storage_path?.trim();
      let signed_url: string | null = null;
      if (path) {
        const { data: signed } = await supabase.storage
          .from(CASE_DOCUMENTS_STORAGE_BUCKET)
          .createSignedUrl(path, CASE_DOCUMENTS_SIGNED_URL_SECONDS);
        signed_url = signed?.signedUrl?.trim() || null;
      }
      return {
        ...row,
        contact_id: row.contact_id != null ? Number(row.contact_id) : null,
        document_type_id: row.document_type_id ? String(row.document_type_id) : null,
        document_type_name: row.document_type_id ? typeById.get(String(row.document_type_id)) ?? null : null,
        signed_url,
      };
    }),
  );

  return withUrls;
}

/** Latest document per contact + document type. */
export function indexLeadCaseDocumentsByContactAndType(
  rows: LeadCaseDocumentRow[],
): Map<string, LeadCaseDocumentRow> {
  const map = new Map<string, LeadCaseDocumentRow>();
  for (const row of rows) {
    if (row.contact_id == null || !row.document_type_id) continue;
    const key = `${row.contact_id}:${row.document_type_id}`;
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}

export async function uploadLeadCaseDocumentForContact(params: {
  leadNumber: string;
  contactId: number;
  documentTypeId: string;
  file: File;
}): Promise<LeadCaseDocumentRow> {
  const { leadNumber, contactId, documentTypeId, file } = params;
  const storagePath = buildCaseDocumentStoragePath(leadNumber, 'contact-documents', file.name);
  const contentType = resolveCaseDocumentUploadContentType(file);
  const actor = await fetchStageActorInfo();

  const { error: storageErr } = await supabase.storage
    .from(CASE_DOCUMENTS_STORAGE_BUCKET)
    .upload(storagePath, file, { contentType, upsert: false });

  if (storageErr) throw storageErr;

  const { data: inserted, error: insErr } = await supabase
    .from('lead_case_documents')
    .insert({
      lead_number: leadNumber,
      onedrive_subfolder: null,
      onedrive_item_id: null,
      storage_path: storagePath,
      file_name: file.name,
      file_size: file.size,
      mime_type: contentType,
      classification_id: null,
      uploaded_by: actor.fullName ?? null,
      ai_summary_status: 'pending',
      contact_id: contactId,
      document_type_id: documentTypeId,
    })
    .select(
      'id, lead_number, file_name, storage_path, mime_type, file_size, created_at, uploaded_by, contact_id, document_type_id',
    )
    .single();

  if (insErr) {
    await supabase.storage.from(CASE_DOCUMENTS_STORAGE_BUCKET).remove([storagePath]).catch(() => undefined);
    throw insErr;
  }

  const { data: signed } = await supabase.storage
    .from(CASE_DOCUMENTS_STORAGE_BUCKET)
    .createSignedUrl(storagePath, CASE_DOCUMENTS_SIGNED_URL_SECONDS);

  void supabase.functions
    .invoke('case-document-summarize', { body: { documentId: inserted.id } })
    .catch(() => undefined);

  return {
    ...(inserted as LeadCaseDocumentRow),
    contact_id: Number(inserted.contact_id),
    document_type_id: String(inserted.document_type_id),
    signed_url: signed?.signedUrl?.trim() || null,
  };
}
