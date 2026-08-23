import { supabase } from './supabase';
import { getFrontendBaseUrl } from './api';
import { fetchStageActorInfo } from './leadStageManager';
import {
  buildCaseDocumentStoragePath,
  CASE_DOCUMENTS_STORAGE_BUCKET,
  resolveCaseDocumentUploadContentType,
} from './caseDocumentsStorage';
import { CLIENT_HEADER_ONEDRIVE_SUBFOLDER } from './leadOneDrivePaths';
import {
  CASE_DOCUMENT_CATEGORY_META,
  type CaseDocumentCategoryKey,
} from './sequenceOfEventsDocuments';
import {
  isContractClassification,
  isExpertClassification,
  isLegalClaimsClassification,
  isSequenceOfEventsClassification,
} from './staffMeetingDocuments';

export const WORD_DOC_EMPTY_CONTENT = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
} as const;

export type LeadWordDocumentRow = {
  id: string;
  lead_number: string;
  title: string;
  content: unknown;
  classification_key: CaseDocumentCategoryKey | null;
  public_token: string | null;
  case_document_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const SELECT_COLS =
  'id, lead_number, title, content, classification_key, public_token, case_document_id, created_by, created_at, updated_at';

function newPublicToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function buildWordDocumentPublicUrl(id: string, publicToken: string): string {
  return `${getFrontendBaseUrl()}/public-word-document/${id}/${publicToken}`;
}

export function wordDocumentFolderOptions(): Array<{
  key: CaseDocumentCategoryKey;
  title: string;
}> {
  return (Object.keys(CASE_DOCUMENT_CATEGORY_META) as CaseDocumentCategoryKey[]).map((key) => ({
    key,
    title: CASE_DOCUMENT_CATEGORY_META[key].title,
  }));
}

export async function fetchLeadWordDocument(id: string): Promise<LeadWordDocumentRow | null> {
  const { data, error } = await supabase.from('lead_word_documents').select(SELECT_COLS).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LeadWordDocumentRow | null) ?? null;
}

export async function fetchPublicLeadWordDocument(
  id: string,
  token: string,
): Promise<LeadWordDocumentRow | null> {
  const { data, error } = await supabase
    .from('lead_word_documents')
    .select(SELECT_COLS)
    .eq('id', id)
    .eq('public_token', token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LeadWordDocumentRow | null) ?? null;
}

export async function upsertLeadWordDocument(input: {
  id?: string | null;
  leadNumber: string;
  title: string;
  content: unknown;
  classificationKey?: CaseDocumentCategoryKey | null;
  caseDocumentId?: string | null;
  publicToken?: string | null;
}): Promise<LeadWordDocumentRow> {
  const actor = await fetchStageActorInfo();
  const payload = {
    lead_number: input.leadNumber,
    title: input.title.trim() || 'Untitled document',
    content: input.content ?? WORD_DOC_EMPTY_CONTENT,
    classification_key: input.classificationKey ?? null,
    case_document_id: input.caseDocumentId ?? null,
    public_token: input.publicToken ?? null,
    created_by: actor.fullName ?? null,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { data, error } = await supabase
      .from('lead_word_documents')
      .update(payload)
      .eq('id', input.id)
      .select(SELECT_COLS)
      .single();
    if (error) throw new Error(error.message);
    return data as LeadWordDocumentRow;
  }

  const { data, error } = await supabase
    .from('lead_word_documents')
    .insert(payload)
    .select(SELECT_COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as LeadWordDocumentRow;
}

export async function ensureWordDocumentPublicToken(row: LeadWordDocumentRow): Promise<LeadWordDocumentRow> {
  if (row.public_token) return row;
  const publicToken = newPublicToken();
  const { data, error } = await supabase
    .from('lead_word_documents')
    .update({ public_token: publicToken, updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .select(SELECT_COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as LeadWordDocumentRow;
}

async function resolveClassificationId(category: CaseDocumentCategoryKey): Promise<string> {
  const { data, error } = await supabase
    .from('case_document_classifications')
    .select('id, slug, label')
    .eq('is_active', true);
  if (error) throw new Error(error.message);

  const matcher =
    category === 'legal_claims'
      ? isLegalClaimsClassification
      : category === 'expert'
        ? isExpertClassification
        : category === 'contract'
          ? isContractClassification
          : isSequenceOfEventsClassification;

  const match = (data ?? []).find((row) => matcher(row));
  if (!match?.id) {
    throw new Error(`No case-document folder found for ${CASE_DOCUMENT_CATEGORY_META[category].title}`);
  }
  return String(match.id);
}

export async function uploadWordDocumentToCaseFolder(params: {
  leadNumber: string;
  file: File;
  category: CaseDocumentCategoryKey;
}): Promise<string> {
  const { leadNumber, file, category } = params;
  const classificationId = await resolveClassificationId(category);
  const storagePath = buildCaseDocumentStoragePath(
    leadNumber,
    CLIENT_HEADER_ONEDRIVE_SUBFOLDER,
    file.name,
  );
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
      onedrive_subfolder: CLIENT_HEADER_ONEDRIVE_SUBFOLDER,
      onedrive_item_id: null,
      storage_path: storagePath,
      file_name: file.name,
      file_size: file.size,
      mime_type: contentType,
      classification_id: classificationId,
      uploaded_by: actor.fullName ?? null,
      ai_summary_status: 'pending',
    })
    .select('id')
    .single();

  if (insErr || !inserted?.id) {
    await supabase.storage.from(CASE_DOCUMENTS_STORAGE_BUCKET).remove([storagePath]).catch(() => undefined);
    throw new Error(insErr?.message || 'Failed to save Word document to the case folder');
  }

  void supabase.functions
    .invoke('case-document-summarize', { body: { documentId: inserted.id } })
    .catch(() => undefined);

  return String(inserted.id);
}

export type WordPageLead = {
  id: string | number;
  name: string | null;
  lead_number: string | null;
  language?: string | null;
  category?: string | null;
  topic?: string | null;
  lead_type?: string | null;
};

export async function fetchLeadForWordPage(leadRef: string): Promise<WordPageLead | null> {
  const decoded = decodeURIComponent(leadRef).trim();
  if (!decoded) return null;

  const { data: byNumber } = await supabase
    .from('leads')
    .select('id, name, lead_number, language, category, topic')
    .eq('lead_number', decoded)
    .maybeSingle();
  if (byNumber) return { ...byNumber, lead_type: 'new' };

  if (/^\d+$/.test(decoded)) {
    const numericId = Number(decoded);
    const { data: byId } = await supabase
      .from('leads')
      .select('id, name, lead_number, language, category, topic')
      .eq('id', numericId)
      .maybeSingle();
    if (byId) return { ...byId, lead_type: 'new' };

    const { data: legacy } = await supabase
      .from('leads_lead')
      .select('id, name, lead_number')
      .eq('id', numericId)
      .maybeSingle();
    if (legacy) {
      return {
        ...legacy,
        lead_number: legacy.lead_number || String(legacy.id),
        lead_type: 'legacy',
      };
    }
  }

  const { data: byManual } = await supabase
    .from('leads_lead')
    .select('id, name, lead_number')
    .eq('manual_id', decoded)
    .maybeSingle();
  if (byManual) {
    return {
      ...byManual,
      lead_number: byManual.lead_number || String(byManual.id),
      lead_type: 'legacy',
    };
  }

  return null;
}
