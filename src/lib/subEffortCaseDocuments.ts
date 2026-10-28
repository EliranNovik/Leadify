import { CLIENT_HEADER_ONEDRIVE_SUBFOLDER } from './leadOneDrivePaths';
import { subEffortDocUploadedAt } from './subEffortDocumentAttach';
import { supabase } from './supabase';

/**
 * Sub-effort uploads recorded as case documents.
 *
 * `lead_case_documents` is the only table the documents drive, the client portal and the document
 * counts read, so a file known to its sub-effort alone is visible nowhere but the case documents
 * drawer — that drawer reads `lead_sub_efforts.document_url` as a second source. Each upload is
 * therefore recorded in both places, pointing at the one stored object: nothing is copied.
 *
 * The drawer prefers the case row when a path appears in both, so this adds no duplicates.
 */

export type SubEffortCaseDocumentItem = {
  /** Object path inside `lead-sub-efforts-documents`. */
  path: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
};

/**
 * The `lead_case_documents.lead_number` a sub-effort's files belong under.
 *
 * A legacy lead is addressed by its `leads_lead.id`: that is what the scan centre files its
 * documents under and what the sub-effort's own storage paths read, and many legacy rows carry no
 * lead number at all.
 */
export async function resolveSubEffortCaseLeadNumber(params: {
  leadNumber?: string | null;
  legacyLeadId?: number | string | null;
  newLeadId?: string | null;
}): Promise<string> {
  const explicit = String(params.leadNumber ?? '').trim();
  if (explicit) return explicit;

  const legacy = String(params.legacyLeadId ?? '').trim();
  if (legacy) return legacy;

  const newLeadId = String(params.newLeadId ?? '').trim();
  if (!newLeadId) return '';
  const { data } = await supabase
    .from('leads')
    .select('lead_number')
    .eq('id', newLeadId)
    .maybeSingle();
  return String((data as { lead_number?: unknown } | null)?.lead_number ?? '').trim();
}

/** The case document category the sub-effort's files are filed under, when it has one. */
export async function fetchSubEffortCaseClassificationId(
  subEffortId: number | string | null | undefined,
): Promise<string | null> {
  const id = String(subEffortId ?? '').trim();
  if (!id) return null;
  const { data } = await supabase
    .from('sub_efforts')
    .select('case_document_classification_id')
    .eq('id', id)
    .maybeSingle();
  const value = (data as { case_document_classification_id?: unknown } | null)
    ?.case_document_classification_id;
  return value ? String(value) : null;
}

/**
 * Keeps the case document row's name in step when the file is renamed on its sub-effort. Best
 * effort: a file that was never mirrored simply matches nothing. The storage path identifies the
 * object on its own, so no lead number is needed.
 */
export async function renameSubEffortCaseDocument(storagePath: string, fileName: string): Promise<void> {
  const path = String(storagePath ?? '').trim();
  const name = String(fileName ?? '').trim();
  if (!path || !name) return;
  await supabase.from('lead_case_documents').update({ file_name: name }).eq('storage_path', path);
}

/** Returns how many rows were added; files already known as case documents are left alone. */
export async function registerSubEffortDocumentsAsCaseDocuments(params: {
  leadNumber: string;
  items: SubEffortCaseDocumentItem[];
  classificationId?: string | null;
  uploadedBy?: string | null;
  /** Mirrors the sub-effort's own visibility, so hiding a stage hides its files from the portal. */
  clientVisible?: boolean;
}): Promise<number> {
  const lead = String(params.leadNumber ?? '').trim();
  const items = params.items
    .map((item) => ({ ...item, path: String(item.path ?? '').trim() }))
    .filter((item) => item.path);
  if (!lead || items.length === 0) return 0;

  // Attaching a file that is already a case document is routine, and the unique index behind this
  // is partial, so the duplicates have to be read rather than upserted on.
  const { data: known } = await supabase
    .from('lead_case_documents')
    .select('storage_path')
    .eq('lead_number', lead)
    .in(
      'storage_path',
      items.map((item) => item.path),
    );
  const alreadyFiled = new Set(
    ((known ?? []) as { storage_path: string | null }[])
      .map((row) => String(row.storage_path ?? '').trim())
      .filter(Boolean),
  );

  const rows = items
    .filter((item) => !alreadyFiled.has(item.path))
    .map((item) => ({
      lead_number: lead,
      onedrive_subfolder: CLIENT_HEADER_ONEDRIVE_SUBFOLDER,
      onedrive_item_id: null,
      storage_path: item.path,
      file_name: item.name?.trim() || item.path.split('/').pop() || 'Document',
      file_size: item.size ?? null,
      mime_type: item.mimeType?.trim() || null,
      classification_id: params.classificationId ?? null,
      uploaded_by: params.uploadedBy ?? null,
      // Deliberately not summarised: the sub-effort upload never offered a summary, and a batch of
      // scans would otherwise queue one each.
      ai_summary_status: 'skipped',
      // The object name carries the upload time; the row would otherwise be dated to this mirror.
      created_at: subEffortDocUploadedAt({ path: item.path }) ?? undefined,
      client_visible: params.clientVisible,
    }));
  if (rows.length === 0) return 0;

  const { error } = await supabase.from('lead_case_documents').insert(rows);
  if (error) {
    // Client visibility arrived late (sql/2026-10-28_client_visible_documents.sql); without the
    // column the file is still worth listing.
    if (/client_visible/i.test(error.message || '')) {
      const { error: retryError } = await supabase
        .from('lead_case_documents')
        .insert(rows.map(({ client_visible: _ignored, ...row }) => row));
      if (retryError) throw retryError;
      return rows.length;
    }
    throw error;
  }
  return rows.length;
}
