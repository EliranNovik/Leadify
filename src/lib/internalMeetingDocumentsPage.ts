import { supabase } from './supabase';
import {
  CASE_DOCUMENTS_STORAGE_BUCKET,
  CASE_DOCUMENTS_SIGNED_URL_SECONDS,
} from './caseDocumentsStorage';
import { guessMimeTypeFromFileName } from './firmManagementCostDocuments';
import {
  resolveStaffMeetingDocumentsContext,
  resolveStaffMeetingLinkedLead,
  type StaffMeetingDocumentsContext,
} from './staffMeetingDocuments';
import { resolveUploaderDisplayByKey } from './uploaderDisplay';

export type InternalMeetingDocumentItem = {
  id: string;
  dbId: string;
  storagePath: string;
  name: string;
  downloadUrl: string;
  fileType: string;
  lastModified: string;
  uploadedBy: string | null;
  uploadedByName: string | null;
  uploadedByPhotoUrl: string | null;
  source: 'meeting' | 'lead_sequence';
};

export type InternalMeetingDocumentGroup = {
  meetingId: number;
  meetingDate: string;
  meetingTime: string;
  subject: string;
  location: string | null;
  typeLabel: string | null;
  typeCode: string | null;
  internalMeetingTypeId: number | null;
  leadNumber: string | null;
  leadName: string | null;
  documentsContext: StaffMeetingDocumentsContext | null;
  documents: InternalMeetingDocumentItem[];
};

export type InternalMeetingTypeOption = {
  id: number;
  code: string;
  label: string;
};

function relOne<T>(rel: T | T[] | null | undefined): T | null {
  if (rel == null) return null;
  return Array.isArray(rel) ? rel[0] ?? null : rel;
}

async function getSequenceClassificationIds(): Promise<string[]> {
  const { data } = await supabase
    .from('case_document_classifications')
    .select('id')
    .in('slug', ['sequence_of_events', 'sequence-of-events']);
  return (data || []).map((r: { id: string }) => r.id);
}

async function signStoragePaths(paths: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  const out = new Map<string, string>();
  await Promise.all(
    unique.map(async (path) => {
      const { data, error } = await supabase.storage
        .from(CASE_DOCUMENTS_STORAGE_BUCKET)
        .createSignedUrl(path, CASE_DOCUMENTS_SIGNED_URL_SECONDS);
      if (!error && data?.signedUrl) {
        out.set(path, data.signedUrl.trim());
      }
    }),
  );
  return out;
}

type StaffDocRow = {
  id: string;
  meeting_id: number;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  uploaded_by: string | null;
  created_at: string;
};

type LeadDocRow = {
  id: string;
  lead_number: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  uploaded_by: string | null;
  created_at: string;
};

export async function fetchInternalMeetingTypes(): Promise<InternalMeetingTypeOption[]> {
  const { data, error } = await supabase
    .from('internal_meeting_types')
    .select('id, code, label, sort_order')
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true });
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: Number(r.id),
    code: String(r.code ?? ''),
    label: String(r.label ?? r.code ?? ''),
  }));
}

export async function fetchInternalMeetingDocumentGroups(params: {
  dateFrom: string;
  dateTo: string;
  internalMeetingTypeId: number | null;
}): Promise<InternalMeetingDocumentGroup[]> {
  let mq = supabase
    .from('meetings')
    .select(
      `id, meeting_date, meeting_time, meeting_subject, meeting_location,
      client_id, legacy_lead_id, internal_meeting_type_id,
      internal_meeting_types ( id, code, label ),
      leads!meetings_client_id_fkey ( id, name, lead_number, email ),
      leads_lead!meetings_legacy_lead_id_fkey ( id, name, lead_number, email )`,
    )
    .eq('calendar_type', 'staff')
    .or('status.is.null,status.neq.canceled');

  if (params.dateFrom) mq = mq.gte('meeting_date', params.dateFrom);
  if (params.dateTo) mq = mq.lte('meeting_date', params.dateTo);
  if (params.internalMeetingTypeId != null) {
    mq = mq.eq('internal_meeting_type_id', params.internalMeetingTypeId);
  }

  const { data: meetings, error } = await mq
    .order('meeting_date', { ascending: false })
    .order('meeting_time', { ascending: false });

  if (error) throw error;
  if (!meetings?.length) return [];

  const meetingIds = meetings.map((m: any) => Number(m.id)).filter((id) => Number.isFinite(id));
  const meetingContexts = new Map<number, ReturnType<typeof resolveStaffMeetingDocumentsContext>>();
  const leadNumbersForDocs = new Set<string>();
  const staffMeetingIds = new Set<number>();

  for (const m of meetings) {
    const lead = relOne((m as any).leads);
    const legacyLead = relOne((m as any).leads_lead);
    const meetingRow = { ...m, lead, legacy_lead: legacyLead };
    const ctx = resolveStaffMeetingDocumentsContext(meetingRow, Number(m.id));
    meetingContexts.set(Number(m.id), ctx);
    if (ctx?.mode === 'meeting') {
      staffMeetingIds.add(Number(m.id));
    } else if (ctx?.mode === 'lead') {
      leadNumbersForDocs.add(ctx.leadNumber);
    }
  }

  let staffDocs: StaffDocRow[] = [];
  if (staffMeetingIds.size > 0) {
    const { data, error: staffErr } = await supabase
      .from('staff_meeting_documents')
      .select('id, meeting_id, storage_path, file_name, mime_type, uploaded_by, created_at')
      .in('meeting_id', Array.from(staffMeetingIds))
      .order('created_at', { ascending: false });
    if (staffErr) throw staffErr;
    staffDocs = (data || []) as StaffDocRow[];
  }

  const seqIds = await getSequenceClassificationIds();
  let leadDocs: LeadDocRow[] = [];
  if (leadNumbersForDocs.size > 0 && seqIds.length > 0) {
    const { data, error: leadErr } = await supabase
      .from('lead_case_documents')
      .select('id, lead_number, storage_path, file_name, mime_type, uploaded_by, created_at')
      .in('lead_number', Array.from(leadNumbersForDocs))
      .in('classification_id', seqIds)
      .not('storage_path', 'is', null)
      .order('created_at', { ascending: false });
    if (leadErr) throw leadErr;
    leadDocs = (data || []) as LeadDocRow[];
  }

  const staffByMeeting = new Map<number, StaffDocRow[]>();
  for (const d of staffDocs) {
    const mid = Number(d.meeting_id);
    if (!staffByMeeting.has(mid)) staffByMeeting.set(mid, []);
    staffByMeeting.get(mid)!.push(d);
  }

  const leadByNumber = new Map<string, LeadDocRow[]>();
  for (const d of leadDocs) {
    const ln = String(d.lead_number);
    if (!leadByNumber.has(ln)) leadByNumber.set(ln, []);
    leadByNumber.get(ln)!.push(d);
  }

  const allPaths = [
    ...staffDocs.map((d) => d.storage_path),
    ...leadDocs.map((d) => d.storage_path),
  ];
  const signedUrls = await signStoragePaths(allPaths);

  const allUploaderKeys = [
    ...staffDocs.map((d) => d.uploaded_by?.trim()).filter(Boolean),
    ...leadDocs.map((d) => d.uploaded_by?.trim()).filter(Boolean),
  ] as string[];
  const uploaderMap = await resolveUploaderDisplayByKey(allUploaderKeys);

  const groups: InternalMeetingDocumentGroup[] = [];

  for (const m of meetings) {
    const mid = Number(m.id);
    const typeRow = relOne((m as any).internal_meeting_types);
    const lead = relOne((m as any).leads);
    const legacyLead = relOne((m as any).leads_lead);
    const meetingRow = { ...m, lead, legacy_lead: legacyLead };
    const linked = resolveStaffMeetingLinkedLead(meetingRow);
    const ctx = meetingContexts.get(mid);

    const docItems: InternalMeetingDocumentItem[] = [];

    if (ctx?.mode === 'meeting') {
      for (const d of staffByMeeting.get(mid) || []) {
        const rawUploader = d.uploaded_by?.trim() || null;
        const resolved = rawUploader ? uploaderMap.get(rawUploader) : undefined;
        docItems.push({
          id: `staff-${d.id}`,
          dbId: d.id,
          storagePath: d.storage_path,
          name: d.file_name,
          downloadUrl: signedUrls.get(d.storage_path) || '',
          fileType: d.mime_type?.trim() || guessMimeTypeFromFileName(d.file_name),
          lastModified: d.created_at,
          uploadedBy: rawUploader,
          uploadedByName: resolved?.name ?? rawUploader,
          uploadedByPhotoUrl: resolved?.photoUrl ?? null,
          source: 'meeting',
        });
      }
    } else if (ctx?.mode === 'lead') {
      for (const d of leadByNumber.get(ctx.leadNumber) || []) {
        const rawUploader = d.uploaded_by?.trim() || null;
        const resolved = rawUploader ? uploaderMap.get(rawUploader) : undefined;
        docItems.push({
          id: `lead-${d.id}`,
          dbId: d.id,
          storagePath: d.storage_path,
          name: d.file_name,
          downloadUrl: signedUrls.get(d.storage_path) || '',
          fileType: d.mime_type?.trim() || guessMimeTypeFromFileName(d.file_name),
          lastModified: d.created_at,
          uploadedBy: rawUploader,
          uploadedByName: resolved?.name ?? rawUploader,
          uploadedByPhotoUrl: resolved?.photoUrl ?? null,
          source: 'lead_sequence',
        });
      }
    }

    docItems.sort(
      (a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
    );

    groups.push({
      meetingId: mid,
      meetingDate: String(m.meeting_date ?? ''),
      meetingTime: String(m.meeting_time ?? '').slice(0, 5),
      subject: String(m.meeting_subject || '').trim() || '—',
      location: m.meeting_location ? String(m.meeting_location) : null,
      typeLabel: typeRow?.label ? String(typeRow.label) : null,
      typeCode: typeRow?.code ? String(typeRow.code) : null,
      internalMeetingTypeId:
        m.internal_meeting_type_id != null ? Number(m.internal_meeting_type_id) : null,
      leadNumber: linked?.lead_number != null ? String(linked.lead_number) : null,
      leadName: linked?.name ? String(linked.name) : null,
      documentsContext: ctx ?? null,
      documents: docItems,
    });
  }

  return groups;
}

export function filterInternalMeetingDocumentGroups(
  groups: InternalMeetingDocumentGroup[],
  searchQuery: string,
  onlyWithDocuments: boolean,
): InternalMeetingDocumentGroup[] {
  const q = searchQuery.trim().toLowerCase();
  return groups.filter((group) => {
    if (onlyWithDocuments && group.documents.length === 0) return false;
    if (!q) return true;

    const haystack = [
      group.subject,
      group.location,
      group.typeLabel,
      group.typeCode,
      group.leadNumber,
      group.leadName,
      group.meetingDate,
      ...group.documents.map((d) => d.name),
      ...group.documents.map((d) => d.uploadedBy || ''),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(q);
  });
}

export async function deleteInternalMeetingDocument(
  doc: Pick<InternalMeetingDocumentItem, 'dbId' | 'source' | 'storagePath'>,
): Promise<void> {
  const path = doc.storagePath?.trim();
  if (!path) throw new Error('Missing storage path for this document.');

  const { error: rmErr } = await supabase.storage.from(CASE_DOCUMENTS_STORAGE_BUCKET).remove([path]);
  if (rmErr) throw rmErr;

  if (doc.source === 'meeting') {
    const { error } = await supabase.from('staff_meeting_documents').delete().eq('id', doc.dbId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('lead_case_documents').delete().eq('id', doc.dbId);
    if (error) throw error;
  }
}
