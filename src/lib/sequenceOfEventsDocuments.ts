import {
  CASE_DOCUMENTS_SIGNED_URL_SECONDS,
  CASE_DOCUMENTS_STORAGE_BUCKET,
} from './caseDocumentsStorage';
import {
  leadSubEffortSavedUpdatedAt,
  leadSubEffortSavedUpdatedBy,
  resolveLeadSubEffortIdentityFromRefs,
} from './leadSubEfforts';
import {
  isContractClassification,
  isExpertClassification,
  isLegalClaimsClassification,
  isSequenceOfEventsClassification,
  mergeContractClassifications,
  mergeExpertClassifications,
  mergeLegalClaimsClassifications,
  mergeSequenceOfEventsClassifications,
} from './staffMeetingDocuments';
import { supabase } from './supabase';
import { resolveUploaderDisplayByKey } from './uploaderDisplay';

export type CaseCategoryDocument = {
  id: string;
  name: string;
  url: string;
  fileType: string;
  lastModified: string;
  storagePath: string | null;
  uploadedByName: string | null;
  /** True when uploaded via client portal (contact name), not staff. */
  isClientPortalUpload: boolean;
};

/** @deprecated Prefer CaseCategoryDocument */
export type SequenceOfEventsDocument = CaseCategoryDocument;

export type CaseDocumentCategoryKey =
  | 'sequence_of_events'
  | 'legal_claims'
  | 'expert'
  | 'contract';

export const CASE_DOCUMENT_CATEGORY_META: Record<
  CaseDocumentCategoryKey,
  { title: string; emptyLabel: string }
> = {
  sequence_of_events: {
    title: 'Sequence of Events',
    emptyLabel: 'No Sequence of Events documents for this lead.',
  },
  legal_claims: {
    title: 'Legal Claims',
    emptyLabel: 'No Legal Claims documents for this lead.',
  },
  expert: {
    title: 'Expert',
    emptyLabel: 'No Expert documents for this lead.',
  },
  contract: {
    title: 'Contract',
    emptyLabel: 'No Contract documents for this lead.',
  },
};

type ClassificationRow = { id: string; slug: string; label: string; sort_order?: number };

type CaseDocRow = {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  uploaded_by: string | null;
  contact_id: number | null;
  created_at: string;
  onedrive_subfolder: string | null;
  classification_id: string | null;
};

function categoryMatchers(category: CaseDocumentCategoryKey) {
  switch (category) {
    case 'legal_claims':
      return { isMatch: isLegalClaimsClassification, merge: mergeLegalClaimsClassifications };
    case 'expert':
      return { isMatch: isExpertClassification, merge: mergeExpertClassifications };
    case 'contract':
      return { isMatch: isContractClassification, merge: mergeContractClassifications };
    case 'sequence_of_events':
    default:
      return {
        isMatch: isSequenceOfEventsClassification,
        merge: mergeSequenceOfEventsClassifications,
      };
  }
}

async function fetchCategoryClassificationMeta(category: CaseDocumentCategoryKey): Promise<{
  classificationIds: string[];
  canonicalIdByAlias: Map<string, string>;
}> {
  const { isMatch, merge } = categoryMatchers(category);
  const { data, error } = await supabase
    .from('case_document_classifications')
    .select('id, slug, label, sort_order');
  if (error) throw error;

  const rows = ((data ?? []) as ClassificationRow[]).filter((r) => isMatch(r));
  const merged = merge(rows);
  const classificationIds = [...new Set(rows.map((r) => r.id))];
  return { classificationIds, canonicalIdByAlias: merged.canonicalIdByAlias };
}

function inferMime(name: string, fallback?: string | null): string {
  const t = (fallback || '').trim();
  if (t) return t;
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return 'application/octet-stream';
}

function normalizeDocItems(
  raw: unknown,
): { path?: string; url?: string; name?: string; mimeType?: string }[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as any[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as any[];
    } catch {
      /* ignore */
    }
    return [{ url: raw }];
  }
  if (typeof raw === 'object') return [raw as any];
  return [];
}

function isInternalFolder(onedriveSubfolder: string | null | undefined): boolean {
  const sub = (onedriveSubfolder || '').trim();
  return Boolean(sub && sub.toLowerCase().includes('internal'));
}

async function fetchCaseCategoryRows(leadNumber: string, classificationIds: string[]): Promise<CaseDocRow[]> {
  const { data: rows, error } = await supabase
    .from('lead_case_documents')
    .select(
      'id, storage_path, file_name, mime_type, uploaded_by, contact_id, created_at, onedrive_subfolder, classification_id',
    )
    .eq('lead_number', leadNumber)
    .in('classification_id', classificationIds)
    .not('storage_path', 'is', null)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return ((rows ?? []) as CaseDocRow[]).filter((r) => !isInternalFolder(r.onedrive_subfolder));
}

async function mapCaseRowsToDocuments(list: CaseDocRow[]): Promise<CaseCategoryDocument[]> {
  const contactIds = [
    ...new Set(
      list
        .map((r) => r.contact_id)
        .filter((id): id is number => id != null && Number.isFinite(Number(id))),
    ),
  ];
  const contactNameById = new Map<number, string>();
  if (contactIds.length > 0) {
    const { data: contacts } = await supabase
      .from('leads_contact')
      .select('id, name')
      .in('id', contactIds);
    for (const c of (contacts ?? []) as { id: number; name: string | null }[]) {
      const n = c.name?.trim();
      if (n) contactNameById.set(Number(c.id), n);
    }
  }

  const uploaderKeys = [...new Set(list.map((r) => r.uploaded_by?.trim()).filter(Boolean))] as string[];
  const uploaderMap = await resolveUploaderDisplayByKey(uploaderKeys);

  return Promise.all(
    list.map(async (r) => {
      const { data: signed } = await supabase.storage
        .from(CASE_DOCUMENTS_STORAGE_BUCKET)
        .createSignedUrl(r.storage_path, CASE_DOCUMENTS_SIGNED_URL_SECONDS);
      const url = signed?.signedUrl?.trim() || '';
      const rawUploader = r.uploaded_by?.trim() || null;
      const fromContact =
        r.contact_id != null ? contactNameById.get(Number(r.contact_id)) ?? null : null;
      const resolved = rawUploader ? uploaderMap.get(rawUploader) : undefined;
      const staffMatched = Boolean(resolved?.matched);
      const isClientPortalUpload = Boolean(fromContact) || Boolean(rawUploader && !staffMatched);
      const uploadedByName = fromContact || resolved?.name || rawUploader || null;

      return {
        id: r.id,
        name: r.file_name,
        url,
        fileType: inferMime(r.file_name, r.mime_type),
        lastModified: r.created_at || new Date().toISOString(),
        storagePath: r.storage_path,
        uploadedByName,
        isClientPortalUpload,
      };
    }),
  );
}

async function collectSubEffortCategoryItems(params: {
  classificationIds: Set<string>;
  canonicalIdByAlias: Map<string, string>;
  clientId?: string | null;
  leadNumber: string;
}): Promise<
  {
    id: string;
    name: string;
    path: string | null;
    url: string | null;
    mimeType: string | null;
    lastModified: string;
    uploadedByName: string | null;
  }[]
> {
  const { legacyLeadId, newLeadId } = await resolveLeadSubEffortIdentityFromRefs(supabase, {
    clientId: params.clientId,
    leadNumber: params.leadNumber,
  });
  if (!newLeadId && !legacyLeadId) return [];

  let q = supabase
    .from('lead_sub_efforts')
    .select(
      `id, created_at, created_by, updated_by, updated_at, document_url,
       sub_efforts ( id, name, case_document_classification_id )`,
    )
    .order('created_at', { ascending: false })
    .limit(200);

  if (legacyLeadId) q = q.eq('legacy_lead_id', legacyLeadId);
  else if (newLeadId) q = q.eq('new_lead_id', newLeadId);

  const { data: seRows, error } = await q;
  if (error) {
    console.warn('case category sub-efforts fetch:', error.message);
    return [];
  }

  const seUploaderKeys = [
    ...new Set(
      ((seRows || []) as any[])
        .map((r) => leadSubEffortSavedUpdatedBy(r) || String(r?.created_by ?? '').trim() || '')
        .filter(Boolean),
    ),
  ];
  const seUploaderMap = await resolveUploaderDisplayByKey(seUploaderKeys);
  const out: {
    id: string;
    name: string;
    path: string | null;
    url: string | null;
    mimeType: string | null;
    lastModified: string;
    uploadedByName: string | null;
  }[] = [];

  for (const r of (seRows || []) as any[]) {
    const rawCategoryId = r?.sub_efforts?.case_document_classification_id ?? null;
    if (!rawCategoryId) continue;
    const categoryId = params.canonicalIdByAlias.get(rawCategoryId) ?? rawCategoryId;
    if (!params.classificationIds.has(String(rawCategoryId)) && !params.classificationIds.has(categoryId)) {
      continue;
    }

    const whoRaw = leadSubEffortSavedUpdatedBy(r) || String(r?.created_by ?? '').trim() || null;
    const resolvedWho = whoRaw ? seUploaderMap.get(whoRaw) : undefined;
    const who = resolvedWho?.name ?? whoRaw;
    const createdAt =
      leadSubEffortSavedUpdatedAt(r) || r?.created_at || new Date().toISOString();
    const items = normalizeDocItems(r?.document_url);

    for (const it of items) {
      const path = typeof (it as any)?.path === 'string' ? String((it as any).path).trim() : '';
      const rawUrl = typeof (it as any)?.url === 'string' ? String((it as any).url).trim() : '';
      if (!path && !rawUrl) continue;
      const name =
        ((it as any)?.name as string | undefined)?.trim() ||
        (path ? path.split('/').pop() : rawUrl ? rawUrl.split('/').pop() : '') ||
        'Document';

      out.push({
        id: `subeffort:${String(r?.id ?? '')}:${path || rawUrl}`,
        name,
        path: path || null,
        url: rawUrl || null,
        mimeType: ((it as any)?.mimeType as string | null | undefined) ?? null,
        lastModified: createdAt,
        uploadedByName: who ? String(who) : null,
      });
    }
  }

  return out;
}

export async function fetchCaseCategoryDocumentCount(
  category: CaseDocumentCategoryKey,
  leadNumber: string,
  clientId?: string | null,
): Promise<number> {
  const lead = leadNumber.trim();
  if (!lead) return 0;

  const { classificationIds, canonicalIdByAlias } = await fetchCategoryClassificationMeta(category);
  if (classificationIds.length === 0) return 0;

  const caseRows = await fetchCaseCategoryRows(lead, classificationIds);
  const casePaths = new Set(caseRows.map((r) => r.storage_path.trim()).filter(Boolean));

  const subItems = await collectSubEffortCategoryItems({
    classificationIds: new Set(classificationIds),
    canonicalIdByAlias,
    clientId,
    leadNumber: lead,
  });
  const uniqueSub = subItems.filter((d) => {
    const p = d.path?.trim();
    if (p && casePaths.has(p)) return false;
    return true;
  });

  return caseRows.length + uniqueSub.length;
}

export async function fetchCaseCategoryDocuments(
  category: CaseDocumentCategoryKey,
  leadNumber: string,
  clientId?: string | null,
): Promise<CaseCategoryDocument[]> {
  const lead = leadNumber.trim();
  if (!lead) return [];

  const { classificationIds, canonicalIdByAlias } = await fetchCategoryClassificationMeta(category);
  if (classificationIds.length === 0) return [];

  const caseRows = await fetchCaseCategoryRows(lead, classificationIds);
  const caseDocs = await mapCaseRowsToDocuments(caseRows);

  const subItems = await collectSubEffortCategoryItems({
    classificationIds: new Set(classificationIds),
    canonicalIdByAlias,
    clientId,
    leadNumber: lead,
  });

  const casePaths = new Set(
    caseDocs.map((d) => d.storagePath?.trim()).filter(Boolean) as string[],
  );

  const subEffortDocs: CaseCategoryDocument[] = [];
  for (const it of subItems) {
    const p = it.path?.trim();
    if (p && casePaths.has(p)) continue;

    let signedUrl = '';
    if (p) {
      const { data: signed } = await supabase.storage
        .from(CASE_DOCUMENTS_STORAGE_BUCKET)
        .createSignedUrl(p, CASE_DOCUMENTS_SIGNED_URL_SECONDS);
      signedUrl = signed?.signedUrl?.trim() || '';
    } else if (it.url) {
      signedUrl = it.url.trim();
    }
    if (!signedUrl) continue;

    subEffortDocs.push({
      id: it.id,
      name: it.name,
      url: signedUrl,
      fileType: inferMime(it.name, it.mimeType),
      lastModified: it.lastModified,
      storagePath: p || null,
      uploadedByName: it.uploadedByName,
      isClientPortalUpload: false,
    });
  }

  return [...caseDocs, ...subEffortDocs].sort(
    (a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
  );
}

export async function fetchSequenceOfEventsDocumentCount(
  leadNumber: string,
  clientId?: string | null,
): Promise<number> {
  return fetchCaseCategoryDocumentCount('sequence_of_events', leadNumber, clientId);
}

export async function fetchSequenceOfEventsDocuments(
  leadNumber: string,
  clientId?: string | null,
): Promise<CaseCategoryDocument[]> {
  return fetchCaseCategoryDocuments('sequence_of_events', leadNumber, clientId);
}

export async function fetchLegalClaimsDocumentCount(
  leadNumber: string,
  clientId?: string | null,
): Promise<number> {
  return fetchCaseCategoryDocumentCount('legal_claims', leadNumber, clientId);
}

export async function fetchLegalClaimsDocuments(
  leadNumber: string,
  clientId?: string | null,
): Promise<CaseCategoryDocument[]> {
  return fetchCaseCategoryDocuments('legal_claims', leadNumber, clientId);
}

export async function fetchExpertDocumentCount(
  leadNumber: string,
  clientId?: string | null,
): Promise<number> {
  return fetchCaseCategoryDocumentCount('expert', leadNumber, clientId);
}

export async function fetchExpertDocuments(
  leadNumber: string,
  clientId?: string | null,
): Promise<CaseCategoryDocument[]> {
  return fetchCaseCategoryDocuments('expert', leadNumber, clientId);
}

export async function fetchContractDocumentCount(
  leadNumber: string,
  clientId?: string | null,
): Promise<number> {
  return fetchCaseCategoryDocumentCount('contract', leadNumber, clientId);
}

export async function fetchContractDocuments(
  leadNumber: string,
  clientId?: string | null,
): Promise<CaseCategoryDocument[]> {
  return fetchCaseCategoryDocuments('contract', leadNumber, clientId);
}
