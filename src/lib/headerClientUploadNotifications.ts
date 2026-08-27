import { supabase } from './supabase';
import { CASE_DOCUMENTS_STORAGE_BUCKET } from './caseDocumentsStorage';

const LOOKBACK_DAYS = 30;
const MAX_ASSIGNED_LEADS = 200;
const MAX_DOCUMENTS = 150;
const LEAD_NUMBER_CHUNK = 80;

export const CLIENT_UPLOAD_NOTIF_SEEN_KEY = 'client_upload_notif_seen_v1';

export type ClientUploadLeadNotification = {
  key: string;
  leadNumber: string;
  leadRouteId: string;
  leadName: string | null;
  contactNames: string[];
  documentCount: number;
  documentTypes: string[];
  latestAt: string;
  documentIds: string[];
  /** Present when this lead has exactly one unseen portal upload. */
  singleDocument: {
    id: string;
    fileName: string;
    storagePath: string;
    mimeType: string | null;
    fileSize: number | null;
  } | null;
};

/** Handler, expert, meeting manager. Retention is assignment-based (no dedicated bonuses code). */
export function isClientUploadNotificationRole(bonusesRole: string | null | undefined): boolean {
  const code = String(bonusesRole ?? '').trim().toLowerCase();
  return code === 'h' || code === 'e' || code === 'z' || code === 'm';
}

export function buildClientUploadsDeepLink(leadRouteId: string): string {
  const id = String(leadRouteId ?? '').trim();
  if (!id) return '/clients';
  return `/clients/${id}?subEfforts=1&clientUploads=1`;
}

export function readSeenClientUploadDocumentIds(userId: string): Set<string> {
  if (typeof window === 'undefined' || !userId) return new Set();
  try {
    const raw = localStorage.getItem(`${CLIENT_UPLOAD_NOTIF_SEEN_KEY}:${userId}`);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((id) => String(id)).filter(Boolean));
  } catch {
    return new Set();
  }
}

export function rememberSeenClientUploadDocumentIds(userId: string, ids: string[]): Set<string> {
  const next = readSeenClientUploadDocumentIds(userId);
  for (const id of ids) {
    if (id) next.add(id);
  }
  if (typeof window !== 'undefined' && userId) {
    try {
      localStorage.setItem(`${CLIENT_UPLOAD_NOTIF_SEEN_KEY}:${userId}`, JSON.stringify([...next]));
    } catch {
      // ignore quota
    }
  }
  return next;
}

export async function downloadClientUploadNotificationFile(params: {
  fileName: string;
  storagePath: string;
}): Promise<void> {
  const path = String(params.storagePath ?? '').trim().replace(/^\/+/, '');
  if (!path) throw new Error('Missing file path');

  const { data, error } = await supabase.storage
    .from(CASE_DOCUMENTS_STORAGE_BUCKET)
    .createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) {
    throw error ?? new Error('Could not download file');
  }

  const fileName = params.fileName.trim() || 'document';
  const response = await fetch(data.signedUrl);
  if (!response.ok) throw new Error('Could not download file');
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

type AssignedLead = {
  leadNumber: string;
  leadRouteId: string;
  leadName: string | null;
};

function leadRouteIdFromRow(row: { lead_number?: unknown; id?: unknown; manual_id?: unknown }, table: 'legacy' | 'new'): string {
  const leadNumber = String(row.lead_number ?? '').trim();
  if (leadNumber) return leadNumber;
  if (table === 'legacy') {
    const id = String(row.id ?? '').trim();
    if (id) return id;
  }
  const manual = String(row.manual_id ?? '').trim();
  return manual;
}

function chunk<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function fetchAssignedLeadsForClientUploads(params: {
  employeeId: string;
  displayNames: string[];
}): Promise<AssignedLead[]> {
  const numericId = String(params.employeeId).trim();
  if (!numericId) return [];

  const names = [...new Set(params.displayNames.map((n) => n.trim()).filter(Boolean))];
  const quotedNames = names.map((n) => n.replace(/"/g, '\\"'));

  const legacyParts = [
    `case_handler_id.eq.${numericId}`,
    `expert_id.eq.${numericId}`,
    `meeting_manager_id.eq.${numericId}`,
    `retainer_handler_id.eq.${numericId}`,
  ];
  const newParts = [
    `case_handler_id.eq.${numericId}`,
    `expert.eq.${numericId}`,
    `manager.eq.${numericId}`,
    `meeting_manager_id.eq.${numericId}`,
    `retainer_handler_id.eq.${numericId}`,
    `handler.eq.${numericId}`,
  ];
  for (const name of quotedNames) {
    newParts.push(`handler.eq."${name}"`);
  }

  const [legacyResult, newResult] = await Promise.all([
    supabase
      .from('leads_lead')
      .select('id, lead_number, manual_id, name, case_handler_id, expert_id, meeting_manager_id, retainer_handler_id')
      .or(legacyParts.join(','))
      .limit(MAX_ASSIGNED_LEADS),
    supabase
      .from('leads')
      .select('id, lead_number, manual_id, name, handler, case_handler_id, expert, manager, meeting_manager_id, retainer_handler_id')
      .or(newParts.join(','))
      .limit(MAX_ASSIGNED_LEADS),
  ]);

  if (legacyResult.error) {
    console.warn('Client upload notifications: legacy leads', legacyResult.error);
  }
  if (newResult.error) {
    console.warn('Client upload notifications: new leads', newResult.error);
  }

  const byNumber = new Map<string, AssignedLead>();
  const pushRow = (row: Record<string, unknown> | null | undefined, table: 'legacy' | 'new') => {
    if (!row) return;
    const leadRouteId = leadRouteIdFromRow(row, table);
    if (!leadRouteId) return;
    const leadNumber = String(row.lead_number ?? leadRouteId).trim() || leadRouteId;
    const leadName = String(row.name ?? '').trim() || null;
    if (!byNumber.has(leadNumber)) {
      byNumber.set(leadNumber, { leadNumber, leadRouteId, leadName });
    }
  };

  for (const row of (legacyResult.data ?? []) as Record<string, unknown>[]) {
    pushRow(row, 'legacy');
  }
  for (const row of (newResult.data ?? []) as Record<string, unknown>[]) {
    pushRow(row, 'new');
  }

  return [...byNumber.values()];
}

export async function fetchClientUploadLeadNotifications(params: {
  employeeId: string;
  displayNames: string[];
  bonusesRole?: string | null;
  seenDocumentIds: Set<string>;
}): Promise<ClientUploadLeadNotification[]> {
  const employeeId = String(params.employeeId ?? '').trim();
  if (!employeeId) return [];

  const assigned = await fetchAssignedLeadsForClientUploads({
    employeeId,
    displayNames: params.displayNames,
  });
  if (assigned.length === 0) return [];

  const assignedByNumber = new Map(assigned.map((row) => [row.leadNumber, row]));
  const leadNumbers = assigned.map((row) => row.leadNumber).filter(Boolean);
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  type DocRow = {
    id: string;
    lead_number: string | null;
    contact_id: number | null;
    document_type_id: string | null;
    created_at: string | null;
    uploaded_by: string | null;
    file_name: string | null;
    storage_path: string | null;
    mime_type: string | null;
    file_size: number | null;
  };

  const docs: DocRow[] = [];
  for (const batch of chunk(leadNumbers, LEAD_NUMBER_CHUNK)) {
    const { data, error } = await supabase
      .from('lead_case_documents')
      .select('id, lead_number, contact_id, document_type_id, created_at, uploaded_by, file_name, storage_path, mime_type, file_size')
      .not('contact_id', 'is', null)
      .in('lead_number', batch)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(MAX_DOCUMENTS);

    if (error) {
      console.warn('Client upload notifications: documents', error);
      continue;
    }
    docs.push(...((data ?? []) as DocRow[]));
  }

  const unseen = docs.filter((row) => row.id && !params.seenDocumentIds.has(String(row.id)));
  if (unseen.length === 0) return [];

  const contactIds = [
    ...new Set(
      unseen
        .map((row) => (row.contact_id != null ? Number(row.contact_id) : NaN))
        .filter((id) => Number.isFinite(id)),
    ),
  ];
  const typeIds = [
    ...new Set(
      unseen
        .map((row) => (typeof row.document_type_id === 'string' ? row.document_type_id.trim() : ''))
        .filter(Boolean),
    ),
  ];

  const contactNameById = new Map<number, string>();
  const typeNameById = new Map<string, string>();

  await Promise.all([
    contactIds.length > 0
      ? supabase
          .from('leads_contact')
          .select('id, name')
          .in('id', contactIds)
          .then(({ data }) => {
            for (const c of (data ?? []) as { id: number; name: string | null }[]) {
              const n = c.name?.trim();
              if (n) contactNameById.set(Number(c.id), n);
            }
          })
      : Promise.resolve(),
    typeIds.length > 0
      ? supabase
          .from('lead_case_document_types')
          .select('id, name')
          .in('id', typeIds)
          .then(({ data }) => {
            for (const t of (data ?? []) as { id: string; name: string | null }[]) {
              const n = t.name?.trim();
              if (n) typeNameById.set(String(t.id), n);
            }
          })
      : Promise.resolve(),
  ]);

  const grouped = new Map<
    string,
    {
      documentIds: string[];
      contactNames: Set<string>;
      documentTypes: Set<string>;
      latestAt: string;
      latestFileName: string | null;
      latestStoragePath: string | null;
      latestMimeType: string | null;
      latestFileSize: number | null;
    }
  >();

  for (const row of unseen) {
    const leadNumber = String(row.lead_number ?? '').trim();
    if (!leadNumber || !assignedByNumber.has(leadNumber)) continue;
    const id = String(row.id);
    const created = row.created_at || new Date().toISOString();
    const fileName = String(row.file_name ?? '').trim() || null;
    const storagePath = String(row.storage_path ?? '').trim() || null;
    const mimeType = String(row.mime_type ?? '').trim() || null;
    const fileSize = typeof row.file_size === 'number' && Number.isFinite(row.file_size) ? row.file_size : null;
    let group = grouped.get(leadNumber);
    if (!group) {
      group = {
        documentIds: [],
        contactNames: new Set(),
        documentTypes: new Set(),
        latestAt: created,
        latestFileName: fileName,
        latestStoragePath: storagePath,
        latestMimeType: mimeType,
        latestFileSize: fileSize,
      };
      grouped.set(leadNumber, group);
    }
    group.documentIds.push(id);
    if (created > group.latestAt) {
      group.latestAt = created;
      group.latestFileName = fileName;
      group.latestStoragePath = storagePath;
      group.latestMimeType = mimeType;
      group.latestFileSize = fileSize;
    }
    const contactName =
      row.contact_id != null ? contactNameById.get(Number(row.contact_id)) : null;
    if (contactName) group.contactNames.add(contactName);
    else if (row.uploaded_by?.trim()) group.contactNames.add(row.uploaded_by.trim());
    const typeId = typeof row.document_type_id === 'string' ? row.document_type_id.trim() : '';
    const typeName = typeId ? typeNameById.get(typeId) : null;
    if (typeName) group.documentTypes.add(typeName);
  }

  const notifications: ClientUploadLeadNotification[] = [];
  for (const [leadNumber, group] of grouped) {
    const assignedLead = assignedByNumber.get(leadNumber);
    if (!assignedLead) continue;
    const contactNames = [...group.contactNames];
    notifications.push({
      key: `client-upload:${leadNumber}:${group.latestAt}`,
      leadNumber,
      leadRouteId: assignedLead.leadRouteId,
      leadName: assignedLead.leadName || contactNames[0] || null,
      contactNames,
      documentCount: group.documentIds.length,
      documentTypes: [...group.documentTypes],
      latestAt: group.latestAt,
      documentIds: group.documentIds,
      singleDocument:
        group.documentIds.length === 1 && group.latestStoragePath
          ? {
              id: group.documentIds[0],
              fileName: group.latestFileName || 'Document',
              storagePath: group.latestStoragePath,
              mimeType: group.latestMimeType,
              fileSize: group.latestFileSize,
            }
          : null,
    });
  }

  notifications.sort((a, b) => (a.latestAt < b.latestAt ? 1 : -1));
  return notifications.slice(0, 20);
}
