import {
  DOCUMENT_SOURCE_LABELS,
  formatDocumentSize,
  stableRowKey,
  type DocumentIndexRow,
  type DocumentIndexSource,
} from './documentIndex';

/**
 * What the documents drive is showing right now, so the chat can talk about the file in front of
 * the user without being told which one it is.
 *
 * Module state rather than React context: the chat window lives at the top of the app, far above
 * the drive, and the AI tools are plain functions with no component around them. The same shape as
 * `rmqAiChatContext`, which carries the open client the same way.
 */

export type RmqAiDriveDocument = {
  /** `source:row_id`, which is how the drive and the view identify one file. */
  key: string;
  source: DocumentIndexSource;
  rowId: string;
  fileName: string;
  mimeType: string | null;
  fileSize: number | null;
  category: string | null;
  /** The case number, meeting id or space the file belongs to. */
  scopeKey: string | null;
  scopeLabel: string | null;
  folderPath: string | null;
  uploadedBy: string | null;
  createdAt: string;
  /** Whether a summary has already been written for this file. */
  hasSummary: boolean;
  /** 'open' while the file is up in the viewer, 'selected' when its row was only clicked. */
  state: 'selected' | 'open';
};

/** Where the drive is: the section being browsed, and the case it is inside. */
export type RmqAiDriveView = {
  source: DocumentIndexSource | 'all';
  /** The case number whose folder is open, when the drive is inside one. */
  caseKey: string | null;
  /** The client behind that case, when the drive has looked them up. */
  caseLabel: string | null;
  folderPath: string | null;
};

/** Fires whenever the drive's focused document changes, so the chat can offer to explain it. */
export const RMQ_AI_DRIVE_DOCUMENT_EVENT = 'rmq-ai-drive-document';

let driveDocument: RmqAiDriveDocument | null = null;
let driveView: RmqAiDriveView | null = null;

export function rmqAiDriveDocumentFromRow(
  row: DocumentIndexRow,
  state: RmqAiDriveDocument['state'],
): RmqAiDriveDocument {
  return {
    key: stableRowKey(row),
    source: row.source,
    rowId: row.row_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    category: row.category,
    scopeKey: row.scope_key,
    scopeLabel: row.scope_label,
    folderPath: row.folder_path,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    hasSummary: Boolean(row.ai_summary && row.ai_summary.trim()),
    state,
  };
}

function sameDocument(a: RmqAiDriveDocument | null, b: RmqAiDriveDocument | null): boolean {
  if (!a || !b) return a === b;
  return a.key === b.key && a.state === b.state && a.hasSummary === b.hasSummary;
}

export function setRmqAiDriveDocument(next: RmqAiDriveDocument | null) {
  if (sameDocument(driveDocument, next)) return;
  driveDocument = next;
  try {
    window.dispatchEvent(new CustomEvent(RMQ_AI_DRIVE_DOCUMENT_EVENT));
  } catch {
    /* the state is still set; only the live update is lost */
  }
}

export function getRmqAiDriveDocument(): RmqAiDriveDocument | null {
  return driveDocument;
}

export function setRmqAiDriveView(next: RmqAiDriveView | null) {
  driveView = next;
}

export function getRmqAiDriveView(): RmqAiDriveView | null {
  return driveView;
}

export function subscribeRmqAiDriveDocument(listener: () => void): () => void {
  window.addEventListener(RMQ_AI_DRIVE_DOCUMENT_EVENT, listener);
  return () => window.removeEventListener(RMQ_AI_DRIVE_DOCUMENT_EVENT, listener);
}

function uploadedLine(doc: RmqAiDriveDocument): string {
  const when = doc.createdAt
    ? new Date(doc.createdAt).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '';
  const parts = [when ? `uploaded ${when}` : '', doc.uploadedBy ? `by ${doc.uploadedBy}` : ''];
  return parts.filter(Boolean).join(' ');
}

/** One line for a document, the way the chat should name it back to the user. */
export function describeRmqAiDriveDocument(doc: RmqAiDriveDocument): string {
  const bits = [
    doc.fileName,
    doc.category ? `category ${doc.category}` : '',
    doc.source === 'lead' && doc.scopeKey ? `case ${doc.scopeKey}` : doc.scopeLabel || '',
    doc.folderPath ? `folder ${doc.folderPath}` : '',
    uploadedLine(doc),
    doc.fileSize ? formatDocumentSize(doc.fileSize) : '',
  ];
  return bits.filter(Boolean).join(', ');
}

/**
 * The drive's focused file, as a system prompt line.
 *
 * It says which document the user is looking at and how to talk about it, so "what is this?" or
 * "summarise it" needs no file name from them.
 */
export function describeRmqAiDriveDocumentForPrompt(): string {
  const lines = [describeDriveViewForPrompt(), describeFocusedDocumentForPrompt()];
  return lines.filter(Boolean).join(' ');
}

function describeDriveViewForPrompt(): string {
  const view = driveView;
  if (!view) return '';
  const section =
    view.source === 'all' ? 'all documents' : DOCUMENT_SOURCE_LABELS[view.source] || view.source;
  const bits = [
    `THE USER IS ON THE DOCUMENTS DRIVE, in ${section}`,
    view.caseKey ? `inside case ${view.caseKey}${view.caseLabel ? ` (${view.caseLabel})` : ''}` : '',
    view.folderPath ? `in the folder ${view.folderPath}` : '',
  ].filter(Boolean);
  return [
    `${bits.join(', ')}.`,
    'Use list_drive_documents for what files exist, when they were uploaded and by whom.',
    view.caseKey
      ? `Pass lead "${view.caseKey}" when they mean this case, or lead "this_case" for whatever case is open.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function describeFocusedDocumentForPrompt(): string {
  const doc = driveDocument;
  if (!doc) return '';
  const where = DOCUMENT_SOURCE_LABELS[doc.source] || doc.source;
  const opening =
    doc.state === 'open'
      ? 'DOCUMENT OPEN IN THE DRIVE VIEWER RIGHT NOW'
      : 'DOCUMENT PICKED OUT IN THE DRIVE RIGHT NOW';
  return [
    `${opening} (${where}): ${describeRmqAiDriveDocument(doc)}.`,
    `Its drive id is ${doc.key}.`,
    'When the user says this document, this file, it, or asks what it is about, they mean that file.',
    'Call summarize_drive_document with document_id set to that id to read it — never guess what a file says from its name.',
    doc.hasSummary
      ? 'A summary of it already exists, so the tool answers immediately.'
      : 'No summary exists yet, so the tool reads the file itself and that takes a few seconds.',
  ].join(' ');
}
