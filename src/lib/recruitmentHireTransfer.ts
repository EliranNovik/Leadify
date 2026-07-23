import { fetchContractTypeBySlug } from './contractTypes';
import {
  fetchHrDocumentTypes,
  uploadEmployeeHrDocument,
  type HrDocumentType,
} from './employeeHrDocuments';
import {
  fetchRecruitmentDocuments,
  RECRUITMENT_DOCUMENTS_BUCKET,
  type RecruitmentDocument,
} from './recruitmentDocuments';
import { supabase } from './supabase';

/** Map recruitment document type slugs → HR document type slugs. */
const RECRUITMENT_TO_HR_SLUG: Record<string, string> = {
  cv: 'cv',
  id: 'id',
  nda: 'contract',
  offer: 'contract',
  cover_letter: 'other',
  certificate: 'other',
  degree: 'other',
  references: 'other',
  portfolio: 'other',
  test_results: 'other',
  other: 'other',
};

export type RecruitmentHireTransferResult = {
  contractsPromoted: number;
  documentsCopied: number;
  documentFailures: number;
};

function resolveHrType(
  recruitmentSlug: string | null | undefined,
  hrTypesBySlug: Map<string, HrDocumentType>,
): HrDocumentType | null {
  const mapped = RECRUITMENT_TO_HR_SLUG[String(recruitmentSlug || '').trim()] || 'other';
  return hrTypesBySlug.get(mapped) || hrTypesBySlug.get('other') || null;
}

function buildCopiedNotes(
  doc: RecruitmentDocument,
  recruitmentSlug: string | null | undefined,
): string | null {
  const parts: string[] = [];
  const label = doc.document_type?.label || recruitmentSlug;
  if (label) parts.push(`From recruitment (${label})`);
  if (doc.notes?.trim()) parts.push(doc.notes.trim());
  return parts.length ? parts.join(' — ') : null;
}

async function promoteRecruitmentContracts(
  userId: string,
  employeeId: number,
): Promise<number> {
  const employeeType = await fetchContractTypeBySlug('employee_contract');
  if (!employeeType) return 0;

  const { data, error } = await supabase
    .from('contracts')
    .update({
      employee_id: employeeId,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('contract_type_id', employeeType.id)
    .is('employee_id', null)
    .select('id');

  if (error) throw error;
  return (data || []).length;
}

async function copyRecruitmentDocumentToEmployee(params: {
  doc: RecruitmentDocument;
  employeeId: number;
  hrType: HrDocumentType;
}): Promise<void> {
  const { doc, employeeId, hrType } = params;
  const path = doc.storage_path?.trim();
  if (!path || path === 'pending') {
    throw new Error(`Document ${doc.id} has no storage file`);
  }

  const { data: blob, error: downloadError } = await supabase.storage
    .from(RECRUITMENT_DOCUMENTS_BUCKET)
    .download(path);

  if (downloadError) throw downloadError;
  if (!blob) throw new Error(`Empty download for document ${doc.id}`);

  const mimeType = doc.mime_type || blob.type || 'application/octet-stream';
  const file = new File([blob], doc.file_name || 'file', { type: mimeType });

  await uploadEmployeeHrDocument({
    employeeId,
    documentTypeId: hrType.id,
    typeSlug: hrType.slug,
    file,
    notes: buildCopiedNotes(doc, doc.document_type?.slug),
  });
}

/**
 * After hire: attach recruitment digital contracts to the new employee and copy
 * recruitment files into employee HR documents (employee-hr-documents bucket).
 * Source recruitment rows are kept for history.
 */
export async function transferRecruitmentAssetsOnHire(params: {
  userId: string;
  employeeId: number;
}): Promise<RecruitmentHireTransferResult> {
  const { userId, employeeId } = params;
  if (!userId || !Number.isFinite(employeeId) || employeeId <= 0) {
    throw new Error('userId and employeeId are required to transfer hire assets');
  }

  const contractsPromoted = await promoteRecruitmentContracts(userId, employeeId);

  const [docs, hrTypes] = await Promise.all([
    fetchRecruitmentDocuments(userId),
    fetchHrDocumentTypes(),
  ]);

  const hrTypesBySlug = new Map(hrTypes.map((t) => [t.slug, t]));
  let documentsCopied = 0;
  let documentFailures = 0;

  for (const doc of docs) {
    const hrType = resolveHrType(doc.document_type?.slug, hrTypesBySlug);
    if (!hrType) {
      documentFailures += 1;
      console.warn(
        'No HR document type for recruitment slug',
        doc.document_type?.slug,
        doc.id,
      );
      continue;
    }
    try {
      await copyRecruitmentDocumentToEmployee({ doc, employeeId, hrType });
      documentsCopied += 1;
    } catch (err) {
      documentFailures += 1;
      console.error('Failed to copy recruitment document', doc.id, err);
    }
  }

  return { contractsPromoted, documentsCopied, documentFailures };
}
