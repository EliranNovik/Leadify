const supabase = require('../config/supabase');
const graphMailboxSyncService = require('./graphMailboxSyncService');
const emailAttachmentStorage = require('./emailAttachmentStorageService');
const smartScanClassifyService = require('./smartScanClassifyService');
const {
  SCAN_CENTER_EMAIL,
  SCAN_CENTER_SCANNER_NAME,
  isScanDocumentAttachment,
  involvesScanCenter,
} = require('../lib/scanCenterMailbox');

const EMAIL_HEADERS_TABLE = process.env.EMAIL_HEADERS_TABLE || 'emails';
const EMAIL_ATTACHMENTS_TABLE = process.env.EMAIL_ATTACHMENTS_TABLE || 'email_attachments';

async function listAttachmentsForEmails(emailIds = []) {
  const ids = [...new Set(emailIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)))];
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from(EMAIL_ATTACHMENTS_TABLE)
    .select('id, email_id, graph_attachment_id, name, content_type, size_bytes, is_inline, storage_path, created_at')
    .in('email_id', ids);

  if (error) {
    throw new Error(error.message || 'Failed to list Scan Center attachments');
  }
  return data || [];
}

async function listRecentScanCenterViaAttachments() {
  const { data: attachments, error } = await supabase
    .from(EMAIL_ATTACHMENTS_TABLE)
    .select('id, email_id, graph_attachment_id, name, content_type, size_bytes, is_inline, storage_path, created_at')
    .order('created_at', { ascending: false })
    .limit(400);
  if (error) {
    throw new Error(error.message || 'Failed to list Scan Center attachments');
  }

  const emailIds = [
    ...new Set((attachments || []).map((row) => Number(row.email_id)).filter((id) => Number.isFinite(id))),
  ];
  if (!emailIds.length) return { emails: [], attachments: [] };

  const { data: emails, error: emailError } = await supabase
    .from(EMAIL_HEADERS_TABLE)
    .select('id, subject, sender_email, sender_name, recipient_list, sent_at, client_id, legacy_id, message_id')
    .in('id', emailIds);
  if (emailError) {
    throw new Error(emailError.message || 'Failed to list Scan Center emails');
  }

  const scanEmails = (emails || []).filter((row) =>
    involvesScanCenter({
      senderEmail: row.sender_email,
      recipientList: row.recipient_list,
    })
  );
  const scanIds = new Set(scanEmails.map((row) => Number(row.id)));
  return {
    emails: scanEmails,
    attachments: (attachments || []).filter((row) => scanIds.has(Number(row.email_id))),
  };
}

function toSmartScanItem(email, attachment) {
  const graphId = String(attachment.graph_attachment_id || attachment.id);
  const filename = String(attachment.name || 'scan.pdf');
  const createdAt = attachment.created_at || email.sent_at || new Date().toISOString();
  return {
    id: `email-att:${email.id}:${graphId}`,
    batchId: String(email.subject || '').trim() || `SCN-${email.id}`,
    createdAt,
    scannerName: SCAN_CENTER_SCANNER_NAME,
    pageCount: 1,
    leadMatchStatus: 'unmatched',
    classificationStatus: 'needs_review',
    documentType: 'Unknown',
    suggestedDocumentType: 'Unknown',
    title: filename.replace(/\.[^.]+$/, '') || filename,
    originalFilename: filename,
    status: 'unmatched',
    issue: 'lead_not_found',
    confidence: 0,
    summary: `Received via ${SCAN_CENTER_EMAIL}`,
    activity: [{ at: createdAt, label: `Received in ${SCAN_CENTER_EMAIL}` }],
    storagePath: attachment.storage_path || null,
    contentType: attachment.content_type || 'application/octet-stream',
    emailId: Number(email.id),
    attachmentId: graphId,
  };
}

function mapItems(emails, attachments) {
  const emailById = new Map(emails.map((row) => [Number(row.id), row]));
  return attachments
    .filter((row) => isScanDocumentAttachment(row))
    .map((row) => {
      const email = emailById.get(Number(row.email_id));
      if (!email) return null;
      return { email, attachment: row };
    })
    .filter(Boolean);
}

async function listEmailsByIds(emailIds = []) {
  const ids = [...new Set(emailIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)))];
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from(EMAIL_HEADERS_TABLE)
    .select('id, subject, sender_email, sender_name, recipient_list, sent_at, client_id, legacy_id, message_id')
    .in('id', ids);
  if (error) {
    throw new Error(error.message || 'Failed to list Scan Center emails');
  }
  return data || [];
}

function mergeEmailAttachmentSet(emails, attachments, extra) {
  const nextEmails = Array.isArray(emails) ? emails : [];
  const nextAttachments = Array.isArray(attachments) ? attachments : [];
  const emailById = new Map(nextEmails.map((row) => [Number(row.id), row]));
  for (const row of extra?.emails || []) {
    if (!emailById.has(Number(row.id))) {
      nextEmails.push(row);
      emailById.set(Number(row.id), row);
    }
  }
  if (extra?.attachments?.length) {
    const seen = new Set(nextAttachments.map((row) => `${row.email_id}:${row.graph_attachment_id || row.id}`));
    for (const row of extra.attachments) {
      const key = `${row.email_id}:${row.graph_attachment_id || row.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      nextAttachments.push(row);
    }
  }
  return { emails: nextEmails, attachments: nextAttachments };
}

async function listInbox({ sync = true } = {}) {
  if (!sync) {
    const queued = await smartScanClassifyService.listQueueItems();
    return {
      items: queued,
      mailbox: SCAN_CENTER_EMAIL,
      synced: false,
    };
  }

  const loaded = await graphMailboxSyncService.loadScanCenterInbox({ persistAttachments: true });
  let emails = (loaded.emails || []).filter((row) => row?.id);
  let attachments = emails.length ? await listAttachmentsForEmails(emails.map((row) => row.id)) : [];

  if (emails.length && loaded.accessToken && !attachments.some((row) => isScanDocumentAttachment(row))) {
    for (const email of emails) {
      if (!email.message_id) continue;
      try {
        const metas = await graphMailboxSyncService.persistGraphAttachmentsForEmail({
          emailId: email.id,
          messageId: email.message_id,
          accessToken: loaded.accessToken,
          mailboxAddress: loaded.mailbox || SCAN_CENTER_EMAIL,
        });
        if (!attachments.length && Array.isArray(metas) && metas.length) {
          attachments = metas.map((meta) => ({
            email_id: email.id,
            graph_attachment_id: meta.id,
            name: meta.name,
            content_type: meta.contentType || meta.content_type,
            is_inline: Boolean(meta.isInline || meta.is_inline),
            storage_path: meta.storage_path || null,
            created_at: email.sent_at,
          }));
        }
      } catch (error) {
        console.warn(`⚠️  Scan Center attachment backfill failed for email ${email.id}:`, error.message || error);
      }
    }
    const stored = await listAttachmentsForEmails(emails.map((row) => row.id));
    if (stored.length) attachments = stored;
  }

  if (!attachments.length) {
    const recentIds = await smartScanClassifyService.loadRecentEmailIds();
    if (recentIds.length) {
      const storedEmails = await listEmailsByIds(recentIds);
      const storedAttachments = await listAttachmentsForEmails(recentIds);
      ({ emails, attachments } = mergeEmailAttachmentSet(emails, attachments, {
        emails: storedEmails,
        attachments: storedAttachments,
      }));
    }
  }

  if (!attachments.length) {
    const fallback = await listRecentScanCenterViaAttachments();
    ({ emails, attachments } = mergeEmailAttachmentSet(emails, attachments, fallback));
  }

  console.log(
    `📎 Scan Center queue emails=${emails.length} attachments=${attachments.length} docs=${
      attachments.filter((row) => isScanDocumentAttachment(row)).length
    }`
  );

  if (!emails.length || !attachments.length) {
    const queued = await smartScanClassifyService.listQueueItems();
    if (queued.length) {
      return {
        items: queued,
        mailbox: loaded.mailbox || SCAN_CENTER_EMAIL,
        synced: Boolean(loaded.synced),
      };
    }
    return {
      items: [],
      mailbox: loaded.mailbox || SCAN_CENTER_EMAIL,
      synced: Boolean(loaded.synced),
      warning: loaded.warning || `No documents in ${SCAN_CENTER_EMAIL} yet.`,
    };
  }

  const removedRefs = await smartScanClassifyService.loadRemovedRefs();
  attachments = attachments.filter(
    (row) => !removedRefs.attachmentIds.has(String(row.graph_attachment_id || row.id)),
  );
  if (!attachments.length) {
    const queued = await smartScanClassifyService.listQueueItems();
    return {
      items: queued,
      mailbox: loaded.mailbox || SCAN_CENTER_EMAIL,
      synced: Boolean(loaded.synced),
    };
  }

  const baseItems = mapItems(emails, attachments)
    .map(({ email, attachment }) => toSmartScanItem(email, attachment))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  await smartScanClassifyService.attachAndEnqueue(baseItems, { auto: true });
  const items = await smartScanClassifyService.listQueueItems();

  return {
    items,
    mailbox: loaded.mailbox || SCAN_CENTER_EMAIL,
    synced: Boolean(loaded.synced),
    warning: items.length ? undefined : loaded.warning || 'Scan Center mail was found, but no PDF/image attachments were stored.',
  };
}

async function downloadInboxAttachment(emailId, attachmentId) {
  const stored = await emailAttachmentStorage.downloadStoredAttachment(emailId, attachmentId);
  if (stored) return stored;

  const access = await graphMailboxSyncService.resolveScanCenterAccess();
  if (!access?.userId) {
    throw new Error(`Scan Center mailbox ${SCAN_CENTER_EMAIL} is not connected`);
  }
  return graphMailboxSyncService.downloadAttachment(access.userId, emailId, attachmentId);
}

async function processItem(id) {
  return smartScanClassifyService.processByItemId(id, { force: true });
}

async function assignLead(id, lead) {
  return smartScanClassifyService.assignLeadByItemId(id, lead);
}

async function approveItem(id) {
  return smartScanClassifyService.approveByItemId(id);
}

async function removeItem(id) {
  return smartScanClassifyService.removeByItemId(id);
}

async function downloadScanDocument(documentId) {
  return smartScanClassifyService.downloadScanDocument(documentId);
}

module.exports = {
  listInbox,
  downloadInboxAttachment,
  processItem,
  assignLead,
  approveItem,
  removeItem,
  downloadScanDocument,
};
