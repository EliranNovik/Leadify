import { CASE_DOCUMENTS_SIGNED_URL_SECONDS } from './caseDocumentsStorage';
import { resolveLeadSubEffortIdentityFromRefs } from './leadSubEfforts';
import { supabase } from './supabase';

export const EMAIL_ATTACHMENTS_STORAGE_BUCKET = 'email-attachments' as const;
export const EMAIL_ATTACHMENT_DOC_ID_PREFIX = 'email-att:';

export type LeadEmailAttachment = {
  id: string;
  emailId: number;
  name: string;
  fileType: string;
  size: number;
  lastModified: string;
  storagePath: string;
  url: string;
  subject: string | null;
};

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

export function isLeadEmailAttachmentId(id?: string | null): boolean {
  return String(id ?? '').startsWith(EMAIL_ATTACHMENT_DOC_ID_PREFIX);
}

export function isEmailAttachmentsBucket(bucket?: string | null): boolean {
  return String(bucket ?? '').trim() === EMAIL_ATTACHMENTS_STORAGE_BUCKET;
}

/** Hide Graph inline/signature images from case-document lists. */
export function isHiddenEmailAttachment(row: {
  is_inline?: boolean | null;
  name?: string | null;
}): boolean {
  if (row.is_inline) return true;
  const name = String(row.name ?? '').trim();
  if (!name) return true;
  if (/^signature/i.test(name)) return true;
  if (/^image00\d+\.(png|jpe?g|gif|bmp)$/i.test(name)) return true;
  if (/^oledata\.mso$/i.test(name)) return true;
  return false;
}

export async function createStorageSignedUrlMap(
  bucket: string,
  paths: string[],
  expiresIn = CASE_DOCUMENTS_SIGNED_URL_SECONDS,
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.map((p) => String(p ?? '').trim()).filter(Boolean))];
  const out = new Map<string, string>();
  if (!unique.length) return out;

  const storageBucket: any = supabase.storage.from(bucket) as any;
  const CHUNK = 80;

  if (typeof storageBucket.createSignedUrls === 'function') {
    for (let i = 0; i < unique.length; i += CHUNK) {
      const chunk = unique.slice(i, i + CHUNK);
      const { data, error } = await storageBucket.createSignedUrls(chunk, expiresIn);
      if (error) {
        console.warn(`createSignedUrls (${bucket}):`, error.message);
        continue;
      }
      for (const item of data ?? []) {
        const path = typeof item?.path === 'string' ? item.path.trim() : '';
        const url = typeof item?.signedUrl === 'string' ? item.signedUrl.trim() : '';
        if (path && url) out.set(path, url);
      }
    }
    return out;
  }

  const results = await Promise.all(
    unique.map(async (p) => {
      const { data } = await storageBucket.createSignedUrl(p, expiresIn);
      return [p, data?.signedUrl?.trim() || ''] as const;
    }),
  );
  for (const [p, url] of results) {
    if (url) out.set(p, url);
  }
  return out;
}

async function resolveLeadEmailIds(params: {
  clientId?: string | null;
  leadNumber?: string | null;
}): Promise<number[]> {
  const { legacyLeadId, newLeadId } = await resolveLeadSubEffortIdentityFromRefs(supabase, {
    clientId: params.clientId,
    leadNumber: params.leadNumber,
  });
  if (!legacyLeadId && !newLeadId) return [];

  const ids = new Set<number>();
  const takeIds = (rows: Array<{ id?: unknown }> | null | undefined) => {
    for (const row of rows ?? []) {
      const n = Number(row?.id);
      if (Number.isFinite(n) && n > 0) ids.add(n);
    }
  };

  if (newLeadId) {
    const { data, error } = await supabase
      .from('emails')
      .select('id')
      .eq('client_id', newLeadId)
      .limit(800);
    if (error) {
      console.warn('lead email ids (client_id):', error.message);
    } else {
      takeIds(data as Array<{ id?: unknown }>);
    }
  }

  if (legacyLeadId) {
    const { data, error } = await supabase
      .from('emails')
      .select('id')
      .eq('legacy_id', legacyLeadId)
      .limit(800);
    if (error) {
      console.warn('lead email ids (legacy_id):', error.message);
    } else {
      takeIds(data as Array<{ id?: unknown }>);
    }
  }

  return [...ids];
}

type EmailAttachmentFileRow = {
  id: number;
  email_id: number;
  name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  is_inline: boolean | null;
  storage_path: string | null;
  created_at: string | null;
};

async function loadLeadEmailAttachmentRows(params: {
  clientId?: string | null;
  leadNumber?: string | null;
}): Promise<EmailAttachmentFileRow[]> {
  const emailIds = await resolveLeadEmailIds(params);
  if (!emailIds.length) return [];

  const files: EmailAttachmentFileRow[] = [];
  const FILE_CHUNK = 200;
  for (let i = 0; i < emailIds.length; i += FILE_CHUNK) {
    const chunk = emailIds.slice(i, i + FILE_CHUNK);
    const { data, error } = await supabase
      .from('email_attachments')
      .select('id, email_id, name, content_type, size_bytes, is_inline, storage_path, created_at')
      .in('email_id', chunk)
      .not('storage_path', 'is', null);
    if (error) {
      console.warn('email_attachments fetch:', error.message);
      continue;
    }
    files.push(...((data ?? []) as EmailAttachmentFileRow[]));
  }

  return files.filter(
    (row) => String(row.storage_path ?? '').trim() && !isHiddenEmailAttachment(row),
  );
}

export async function fetchLeadEmailAttachmentStoragePaths(params: {
  clientId?: string | null;
  leadNumber?: string | null;
}): Promise<string[]> {
  const rows = await loadLeadEmailAttachmentRows(params);
  return [
    ...new Set(rows.map((row) => String(row.storage_path ?? '').trim()).filter(Boolean)),
  ];
}

export async function fetchLeadEmailAttachments(params: {
  clientId?: string | null;
  leadNumber?: string | null;
}): Promise<LeadEmailAttachment[]> {
  const usable = await loadLeadEmailAttachmentRows(params);
  if (!usable.length) return [];

  const FILE_CHUNK = 200;

  const subjectByEmailId = new Map<number, string | null>();
  const uniqueEmailIds = [...new Set(usable.map((r) => Number(r.email_id)).filter((n) => n > 0))];
  for (let i = 0; i < uniqueEmailIds.length; i += FILE_CHUNK) {
    const chunk = uniqueEmailIds.slice(i, i + FILE_CHUNK);
    const { data, error } = await supabase.from('emails').select('id, subject').in('id', chunk);
    if (error) {
      console.warn('email subjects fetch:', error.message);
      continue;
    }
    for (const row of (data ?? []) as Array<{ id: number; subject: string | null }>) {
      const subject = typeof row.subject === 'string' ? row.subject.trim() : '';
      subjectByEmailId.set(Number(row.id), subject || null);
    }
  }

  const signedByPath = await createStorageSignedUrlMap(
    EMAIL_ATTACHMENTS_STORAGE_BUCKET,
    usable.map((r) => String(r.storage_path)),
  );

  const out: LeadEmailAttachment[] = [];
  for (const row of usable) {
    const storagePath = String(row.storage_path ?? '').trim();
    const url = signedByPath.get(storagePath) || '';
    if (!url) continue;
    const name = String(row.name ?? '').trim() || storagePath.split('/').pop() || 'Attachment';
    out.push({
      id: `${EMAIL_ATTACHMENT_DOC_ID_PREFIX}${row.id}`,
      emailId: Number(row.email_id),
      name,
      fileType: inferMime(name, row.content_type),
      size: typeof row.size_bytes === 'number' && Number.isFinite(row.size_bytes) ? row.size_bytes : 0,
      lastModified: row.created_at || new Date().toISOString(),
      storagePath,
      url,
      subject: subjectByEmailId.get(Number(row.email_id)) ?? null,
    });
  }

  return out.sort(
    (a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
  );
}

export function emailAttachmentUploaderLabel(subject?: string | null): string {
  const s = subject?.trim();
  return s ? `Email · ${s}` : 'Email';
}
