const supabase = require('../config/supabase');

const TABLE = process.env.EMAIL_ATTACHMENTS_TABLE || 'email_attachments';
const BUCKET = process.env.EMAIL_ATTACHMENTS_BUCKET || 'email-attachments';
const MAX_BYTES = Number.parseInt(process.env.EMAIL_ATTACHMENT_MAX_BYTES || '', 10) || 25 * 1024 * 1024;

// Keep this narrow: a broad match swallows real errors (not-null violations mention
// "relation", missing columns mention "does not exist") and the sync then looks healthy.
const tableMissing = (error) => {
  const code = String(error?.code || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return /Could not find the table|relation "[^"]+" does not exist/i.test(
    String(error?.message || error || '')
  );
};

const columnMissing = (error) => {
  const code = String(error?.code || '');
  if (code === 'PGRST204' || code === '42703') return true;
  return /Could not find the '[^']+' column|column "[^"]+" (of relation "[^"]+" )?does not exist/i.test(
    String(error?.message || error || '')
  );
};

// Older databases created email_attachments with NOT NULL attachment_id / file_name.
// Write them alongside the current columns; drop them if this DB never had them.
let legacyColumnsSupported = null;

function withLegacyColumns(payload) {
  if (legacyColumnsSupported === false) return payload;
  return {
    ...payload,
    attachment_id: payload.graph_attachment_id,
    file_name: payload.name,
  };
}

async function writeAttachmentRow(existingId, payload) {
  const run = (row) =>
    existingId
      ? supabase.from(TABLE).update(row).eq('id', existingId)
      : supabase.from(TABLE).insert(row);

  const first = await run(withLegacyColumns(payload));
  if (!first.error || legacyColumnsSupported === false) return first;
  if (!columnMissing(first.error)) return first;

  legacyColumnsSupported = false;
  return run(payload);
}

const safeSegment = (value, max = 80) =>
  String(value || 'file')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max) || 'file';

const buildStoragePath = (emailId, attachmentId, name) =>
  `${emailId}/${safeSegment(attachmentId, 90)}-${safeSegment(name, 120)}`;

const toMeta = (att, extras = {}) => {
  if (!att) return null;
  const id = att.id || att.graph_attachment_id;
  if (!id) return null;
  const size =
    extras.size ||
    att.size_bytes ||
    (typeof att.size === 'number' ? att.size : 0) ||
    0;
  return {
    id: String(id),
    name: att.name || 'attachment',
    contentType: att.contentType || att.content_type || 'application/octet-stream',
    size,
    isInline: Boolean(att.isInline ?? att.is_inline),
    contentId: att.contentId || att.content_id || null,
    storage_path: extras.storage_path || att.storage_path || null,
    stored: Boolean(extras.storage_path || att.storage_path),
  };
};

const storedRowToMeta = (row) =>
  toMeta(
    {
      id: row.graph_attachment_id,
      name: row.name,
      contentType: row.content_type,
      size: row.size_bytes,
      isInline: row.is_inline,
      contentId: row.content_id,
      storage_path: row.storage_path,
    },
    { storage_path: row.storage_path, size: row.size_bytes }
  );

async function listStoredForEmail(emailId) {
  if (!emailId) return [];
  const { data, error } = await supabase.from(TABLE).select('*').eq('email_id', Number(emailId));
  if (error) {
    if (!tableMissing(error)) {
      console.warn('⚠️  email_attachments list failed:', error.message || error);
    }
    return [];
  }
  return (data || []).map(storedRowToMeta).filter(Boolean);
}

async function findStoredRow(emailId, attachmentId) {
  if (!attachmentId) return null;
  const graphId = String(attachmentId);

  if (emailId && /^\d+$/.test(String(emailId))) {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('email_id', Number(emailId))
      .eq('graph_attachment_id', graphId)
      .maybeSingle();
    if (!error && data) return data;
    if (error && !tableMissing(error)) {
      console.warn('⚠️  email_attachments lookup failed:', error.message || error);
    }
  }

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('graph_attachment_id', graphId)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (!tableMissing(error)) {
      console.warn('⚠️  email_attachments graph-id lookup failed:', error.message || error);
    }
    return null;
  }
  return data || null;
}

async function downloadStoredAttachment(emailId, attachmentId) {
  const row = await findStoredRow(emailId, attachmentId);
  if (!row?.storage_path) return null;

  const { data, error } = await supabase.storage.from(BUCKET).download(row.storage_path);
  if (error || !data) {
    console.warn('⚠️  email-attachments storage download failed:', error?.message || 'empty object');
    return null;
  }

  const arrayBuffer = await data.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    fileName: row.name || 'attachment',
    contentType: row.content_type || data.type || 'application/octet-stream',
  };
}

async function saveAttachmentBuffer({ emailId, messageId, attachment, buffer }) {
  if (!emailId || !attachment?.id || !buffer?.length) return toMeta(attachment);
  if (buffer.length > MAX_BYTES) {
    console.warn(
      `⚠️  Skipping oversized email attachment ${attachment.name || attachment.id} (${buffer.length} bytes)`
    );
    return toMeta(attachment);
  }

  const path = buildStoragePath(emailId, attachment.id, attachment.name);
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: attachment.contentType || attachment.content_type || 'application/octet-stream',
    upsert: true,
  });
  if (uploadError) {
    console.warn('⚠️  email-attachments upload failed:', uploadError.message || uploadError);
    return toMeta(attachment);
  }

  const payload = {
    email_id: Number(emailId),
    message_id: messageId || null,
    graph_attachment_id: String(attachment.id),
    name: attachment.name || 'attachment',
    content_type: attachment.contentType || attachment.content_type || 'application/octet-stream',
    size_bytes: buffer.length,
    is_inline: Boolean(attachment.isInline),
    content_id: attachment.contentId || attachment.content_id || null,
    storage_path: path,
    updated_at: new Date().toISOString(),
  };

  const existing = await findStoredRow(emailId, attachment.id);
  const { error: dbError } = await writeAttachmentRow(existing?.id || null, payload);
  if (dbError && !tableMissing(dbError)) {
    console.warn(
      `⚠️  email_attachments save failed for email ${emailId} (${attachment.name || attachment.id}):`,
      dbError.message || dbError
    );
  }

  return toMeta(attachment, { storage_path: path, size: buffer.length });
}

function mergeAttachmentLists(primary = [], stored = []) {
  const byId = new Map();
  for (const att of [...stored, ...primary]) {
    const meta = toMeta(att);
    if (!meta) continue;
    const prev = byId.get(meta.id);
    byId.set(meta.id, prev ? { ...prev, ...meta, stored: Boolean(prev.stored || meta.stored) } : meta);
  }
  return Array.from(byId.values());
}

async function emailHasStoredAttachments(emailId) {
  if (!emailId) return false;
  const { count, error } = await supabase
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('email_id', Number(emailId));
  if (error) return false;
  return Number(count) > 0;
}

module.exports = {
  BUCKET,
  TABLE,
  MAX_BYTES,
  toMeta,
  listStoredForEmail,
  findStoredRow,
  downloadStoredAttachment,
  saveAttachmentBuffer,
  mergeAttachmentLists,
  emailHasStoredAttachments,
};
