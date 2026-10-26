import { DOCUMENT_SOURCE_LABELS, type DocumentIndexRow } from './documentIndex';
import type { DocumentShareLocator } from './documentShares';

/**
 * One document, described in the terms sharing needs: where its bytes are, what to call it, and
 * what the Outlook draft should say. Anything shareable — a scan, a drive file — is turned into
 * one of these, so the share menu itself knows nothing about where the document came from.
 */
export type DocumentShareTarget = {
  /** Where the bytes live, in the form the share row stores and the resolver understands. */
  locator: DocumentShareLocator;
  /** Used only when the locator cannot produce a URL of its own. */
  fallbackUrl?: string | null;
  /** The name the attachment is sent under. */
  fileName: string;
  /** What kind of document it is, as the recipient's bell and the subject line read it. */
  documentType: string;
  contentType: string | null;
  leadNumber: string | null;
  leadName: string | null;
  /** Subject and body for the Outlook draft, given whoever is sending it. */
  message: (senderName?: string) => { subject: string; bodyHtml: string };
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The covering note of a shared document: what it is, who it is about, and a few facts. */
export function buildDocumentShareMessage(params: {
  label: string;
  fileName: string;
  /** Who the document is about, which goes in the subject after the label. */
  party?: string | null;
  facts?: Array<[string, string]>;
  senderName?: string;
}): { subject: string; bodyHtml: string } {
  const party = (params.party || '').trim();
  const subject = party
    ? `${params.label} — ${party}`
    : `${params.label} — ${params.fileName}`;

  const rows = (params.facts || [])
    .filter(([, value]) => !!String(value || '').trim())
    .map(
      ([name, value]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#6b7280;">${escapeHtml(name)}</td>` +
        `<td style="padding:2px 0;color:#111827;">${escapeHtml(value)}</td></tr>`,
    )
    .join('');

  const intro = party
    ? `Please find attached the ${escapeHtml(params.label.toLowerCase())} for ${escapeHtml(party)}.`
    : `Please find attached the ${escapeHtml(params.label.toLowerCase())}.`;
  const signOff = params.senderName ? `Best regards,<br />${escapeHtml(params.senderName)}` : 'Best regards,';

  const bodyHtml =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;">` +
    `<p>Hello,</p>` +
    `<p>${intro}</p>` +
    (rows ? `<table style="border-collapse:collapse;font-size:13px;margin:12px 0;">${rows}</table>` : '') +
    `<p>${signOff}</p>` +
    `</div>`;

  return { subject, bodyHtml };
}

function driveDocumentLabel(row: DocumentIndexRow): string {
  return (row.category || '').trim() || DOCUMENT_SOURCE_LABELS[row.source] || 'Document';
}

/** A drive document, ready to share. Only case documents carry a lead to name. */
export function documentIndexShareTarget(row: DocumentIndexRow): DocumentShareTarget {
  const fileName = (row.file_name || '').trim() || 'document';
  const label = driveDocumentLabel(row);
  const leadNumber = row.source === 'lead' ? row.scope_key : null;
  const leadName = row.source === 'lead' ? row.scope_label : null;
  const party = row.source === 'lead' ? [leadNumber, leadName].filter(Boolean).join(' ') : '';

  return {
    locator: {
      storageBucket: row.storage_bucket || null,
      storagePath: row.storage_path || null,
      scanDocumentId: null,
    },
    fileName,
    documentType: label,
    contentType: row.mime_type || null,
    leadNumber,
    leadName,
    message: (senderName) =>
      buildDocumentShareMessage({
        label,
        fileName,
        party,
        facts: [
          ['Document', fileName],
          ['Where it is filed', [row.scope_label, row.folder_path].filter(Boolean).join(' / ')],
          ['Category', row.category || ''],
        ],
        senderName,
      }),
  };
}
