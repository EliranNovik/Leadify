import { supabase } from './supabase';
import { CASE_DOCUMENTS_STORAGE_BUCKET } from './caseDocumentsStorage';

export const RECRUITMENT_DOCUMENTS_BUCKET = 'recruitment-documents' as const;

export type RecruitmentDocumentType = {
  id: number;
  slug: string;
  label: string;
  sort_order: number;
  is_active: boolean;
};

export type RecruitmentDocument = {
  id: number;
  user_id: string;
  candidate_id: number | null;
  document_type_id: number;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  notes: string | null;
  version: number;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  document_type?: RecruitmentDocumentType | null;
};

const TYPE_SELECT = 'id, slug, label, sort_order, is_active';
const DOC_SELECT = `
  id,
  user_id,
  candidate_id,
  document_type_id,
  storage_path,
  file_name,
  mime_type,
  notes,
  version,
  uploaded_by,
  created_at,
  updated_at,
  document_type:recruitment_document_types (
    id, slug, label, sort_order, is_active
  )
`;

function guessMimeType(fileName: string, fallback?: string | null): string {
  if (fallback?.trim()) return fallback.trim();
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return map[ext] || 'application/octet-stream';
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-()+ ]/g, '_').slice(0, 180) || 'file';
}

export function buildRecruitmentDocumentStoragePath(
  userId: string,
  typeSlug: string,
  documentId: number,
  originalFileName: string,
): string {
  const safeType = typeSlug.replace(/[^\w\-]/g, '_').slice(0, 60) || 'doc';
  const safeName = sanitizeFileName(originalFileName);
  return `recruitment/${userId}/${safeType}/${documentId}_${Date.now()}_${safeName}`;
}

export async function fetchRecruitmentDocumentTypes(): Promise<RecruitmentDocumentType[]> {
  const { data, error } = await supabase
    .from('recruitment_document_types')
    .select(TYPE_SELECT)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return (data || []) as RecruitmentDocumentType[];
}

function mapDoc(row: any): RecruitmentDocument {
  return {
    ...row,
    id: Number(row.id),
    candidate_id: row.candidate_id != null ? Number(row.candidate_id) : null,
    document_type_id: Number(row.document_type_id),
    version: Number(row.version) || 1,
    document_type: Array.isArray(row.document_type)
      ? row.document_type[0] ?? null
      : row.document_type ?? null,
  } as RecruitmentDocument;
}

export async function fetchRecruitmentDocuments(userId: string): Promise<RecruitmentDocument[]> {
  const { data, error } = await supabase
    .from('recruitment_documents')
    .select(DOC_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(mapDoc);
}

export async function uploadRecruitmentDocument(params: {
  userId: string;
  candidateId?: number | null;
  documentTypeId: number;
  typeSlug: string;
  file: File;
  notes?: string | null;
}): Promise<RecruitmentDocument> {
  const { userId, candidateId, documentTypeId, typeSlug, file, notes } = params;
  const mimeType = guessMimeType(file.name, file.type);
  const fileName = sanitizeFileName(file.name);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: inserted, error: insertError } = await supabase
    .from('recruitment_documents')
    .insert({
      user_id: userId,
      candidate_id: candidateId ?? null,
      document_type_id: documentTypeId,
      storage_path: 'pending',
      file_name: fileName,
      mime_type: mimeType,
      notes: notes?.trim() || null,
      version: 1,
      uploaded_by: user?.id ?? null,
    })
    .select('id')
    .single();

  if (insertError) throw insertError;
  const documentId = Number(inserted.id);
  const storagePath = buildRecruitmentDocumentStoragePath(
    userId,
    typeSlug,
    documentId,
    fileName,
  );

  const { error: uploadError } = await supabase.storage
    .from(RECRUITMENT_DOCUMENTS_BUCKET)
    .upload(storagePath, file, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) {
    await supabase.from('recruitment_documents').delete().eq('id', documentId);
    throw uploadError;
  }

  const { data: updated, error: updateError } = await supabase
    .from('recruitment_documents')
    .update({
      storage_path: storagePath,
      updated_at: new Date().toISOString(),
    })
    .eq('id', documentId)
    .select(DOC_SELECT)
    .single();

  if (updateError) throw updateError;
  return mapDoc(updated);
}

export async function deleteRecruitmentDocument(
  document: Pick<RecruitmentDocument, 'id' | 'storage_path'>,
): Promise<void> {
  const path = document.storage_path?.trim();
  if (path && path !== 'pending') {
    const { error: storageError } = await supabase.storage
      .from(RECRUITMENT_DOCUMENTS_BUCKET)
      .remove([path]);
    if (storageError) {
      console.warn('recruitmentDocuments storage remove:', storageError);
    }
  }

  const { error } = await supabase
    .from('recruitment_documents')
    .delete()
    .eq('id', document.id);

  if (error) throw error;
}

export async function getRecruitmentDocumentSignedUrl(
  storagePath: string,
  expiresIn = 3600,
): Promise<string | null> {
  if (!storagePath || storagePath === 'pending') return null;
  const { data, error } = await supabase.storage
    .from(RECRUITMENT_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, expiresIn);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

/** Interview docs uploaded via calendar internal-meeting DocumentModal (`staff_meeting_documents`). */
export type RecruitmentInterviewDocument = {
  id: string;
  dbId: number;
  meeting_id: number;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  created_at: string;
  meeting_date: string | null;
  meeting_subject: string | null;
  source: 'interview';
};

export async function fetchRecruitmentInterviewDocuments(
  userId: string,
): Promise<RecruitmentInterviewDocument[]> {
  const { data: meetings, error: meetingsError } = await supabase
    .from('meetings')
    .select('id, meeting_date, meeting_subject')
    .eq('user_id', userId)
    .eq('calendar_type', 'recruitment');
  if (meetingsError) throw meetingsError;
  const meetingRows = meetings || [];
  if (meetingRows.length === 0) return [];

  const meetingIds = meetingRows.map((m: any) => Number(m.id)).filter((id) => Number.isFinite(id));
  const meetingMeta = new Map(
    meetingRows.map((m: any) => [
      Number(m.id),
      {
        meeting_date: m.meeting_date ?? null,
        meeting_subject: m.meeting_subject ?? null,
      },
    ]),
  );

  const { data: docs, error: docsError } = await supabase
    .from('staff_meeting_documents')
    .select('id, meeting_id, storage_path, file_name, mime_type, created_at')
    .in('meeting_id', meetingIds)
    .order('created_at', { ascending: false });
  if (docsError) throw docsError;

  return (docs || []).map((d: any) => {
    const meta = meetingMeta.get(Number(d.meeting_id));
    return {
      id: `interview-${d.id}`,
      dbId: Number(d.id),
      meeting_id: Number(d.meeting_id),
      storage_path: String(d.storage_path || ''),
      file_name: String(d.file_name || 'Document'),
      mime_type: d.mime_type ?? null,
      created_at: String(d.created_at || ''),
      meeting_date: meta?.meeting_date ?? null,
      meeting_subject: meta?.meeting_subject ?? null,
      source: 'interview' as const,
    };
  });
}

export async function getStaffMeetingDocumentSignedUrl(
  storagePath: string,
  expiresIn = 3600,
): Promise<string | null> {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage
    .from(CASE_DOCUMENTS_STORAGE_BUCKET)
    .createSignedUrl(storagePath, expiresIn);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

