import { supabase } from './supabase';
import {
  DOCUMENT_INDEX_SOURCES,
  DOCUMENT_SOURCE_LABELS,
  fetchDocumentIndex,
  fetchDocumentIndexRow,
  formatDocumentSize,
  type DocumentIndexRow,
  type DocumentIndexSource,
} from './documentIndex';
import { requestManualCaseDocumentSummary } from './caseDocumentSummaryPolicy';
import { getRmqAiCurrentLead } from './rmqAiChatContext';
import { getRmqAiDriveDocument, getRmqAiDriveView } from './rmqAiDriveContext';
import { resolveCrmLead } from './rmqAiLeadResolver';

/**
 * The chat's reading of the documents drive: what files exist, whose case they belong to, when
 * they arrived and who put them there, and what any one of them says.
 *
 * Everything goes through `document_index`, the same security_invoker view the drive reads, so the
 * chat can never show a file the signed-in person could not open themselves.
 */

/** Enough rows to answer "what documents does this case have" without flooding the model. */
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 80;

/** How long to wait for a summary of a file that has never been read before. */
const SUMMARY_TIMEOUT_MS = 90_000;

type ListArgs = {
  query?: string;
  lead?: string;
  section?: string;
  category?: string;
  uploaded_by?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
};

type SummarizeArgs = {
  document_id?: string;
  file_name?: string;
  lead?: string;
  force?: boolean;
};

function dayOf(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function sectionOf(raw: string | undefined): DocumentIndexSource[] | undefined {
  const want = String(raw || '').trim().toLowerCase();
  if (!want) return undefined;
  const bySource = DOCUMENT_INDEX_SOURCES.find((source) => source === want);
  if (bySource) return [bySource];
  const byLabel = DOCUMENT_INDEX_SOURCES.find(
    (source) => DOCUMENT_SOURCE_LABELS[source].toLowerCase() === want,
  );
  if (byLabel) return [byLabel];
  // The words people actually use for these sections.
  if (/^(case|cases|client|clients|lead|leads)$/.test(want)) return ['lead'];
  if (/^(meeting|meetings|staff meeting)$/.test(want)) return ['staff_meeting'];
  if (/^(office|organisation|organization|department)$/.test(want)) return ['office'];
  if (/^(my space|personal|mine)$/.test(want)) return ['personal'];
  if (/^(hr|human resources)$/.test(want)) return ['hr'];
  return undefined;
}

/**
 * The case the question is about, when the model says "this one" rather than naming it: the case
 * folder open in the drive first, then the client whose page the chat is on.
 */
function openCaseKey(): string {
  const view = getRmqAiDriveView();
  if (view?.caseKey) return view.caseKey;
  const lead = getRmqAiCurrentLead();
  const number = String(lead?.lead_number || '').trim();
  if (number) return number;
  return String(lead?.id || '').trim();
}

function resolveLeadArg(raw: string): string {
  const value = raw.trim();
  if (/^(this_case|this_client|this|open|current)$/i.test(value)) return openCaseKey();
  return value;
}

/** Every scope key a lead's case documents could be filed under, new and legacy alike. */
async function caseScopeKeys(lead: string): Promise<{ keys: string[]; label: string } | null> {
  const resolution = await resolveCrmLead({ query: lead });
  if (resolution.status !== 'resolved') return null;
  const found = resolution.lead;
  const keys = new Set<string>();
  if (found.leadNumber) keys.add(found.leadNumber);
  // Legacy cases are filed under the legacy id when the row carries no lead number of its own.
  if (found.legacyLeadId) keys.add(String(found.legacyLeadId));
  if (found.isLegacy && found.leadId) keys.add(String(found.leadId).replace(/^legacy_/i, ''));
  return { keys: [...keys], label: `${found.leadNumber} ${found.displayName}`.trim() };
}

function documentLine(row: DocumentIndexRow, index: number): string {
  const bits = [
    row.file_name,
    row.category ? `type ${row.category}` : '',
    row.source === 'lead'
      ? `case ${row.scope_key || '—'}`
      : `${DOCUMENT_SOURCE_LABELS[row.source]}${row.scope_label ? ` ${row.scope_label}` : ''}`,
    row.folder_path ? `folder ${row.folder_path}` : '',
    dayOf(row.created_at) ? `uploaded ${dayOf(row.created_at)}` : '',
    row.uploaded_by ? `by ${row.uploaded_by}` : 'uploader not recorded',
    formatDocumentSize(row.file_size),
    row.ai_summary ? 'summary available' : '',
  ];
  return `${index + 1}. ${bits.filter(Boolean).join(' | ')} [id ${row.source}:${row.row_id}]`;
}

export async function executeListDriveDocuments(args: ListArgs): Promise<string> {
  const limit = Math.min(Math.max(1, Number(args.limit) || DEFAULT_LIMIT), MAX_LIMIT);
  const sources = sectionOf(args.section);
  let scopeKey: string[] | null = null;
  let scopeLabel = '';

  const wantedLead = resolveLeadArg(args.lead || '');
  if (wantedLead) {
    const scope = await caseScopeKeys(wantedLead);
    if (!scope) {
      // A case folder can be open on a lead the CRM cannot resolve — legacy rows with no lead
      // number of their own — and its files are still listed under that key.
      scopeKey = [wantedLead];
      scopeLabel = wantedLead;
    } else {
      scopeKey = scope.keys;
      scopeLabel = scope.label;
    }
  }

  const { rows, total } = await fetchDocumentIndex({
    sources: scopeKey ? ['lead'] : sources,
    scopeKey,
    search: args.query?.trim() || undefined,
    category: args.category?.trim() || null,
    createdFrom: args.date_from?.trim() || null,
    createdTo: args.date_to?.trim() || null,
    sort: 'created_at',
    ascending: false,
    pageSize: limit,
  });

  // An uploader filter is applied here rather than in the query: the view stores whatever name
  // the upload recorded, so a partial match is the only thing that reliably hits.
  const wantUploader = args.uploaded_by?.trim().toLowerCase() || '';
  const listed = wantUploader
    ? rows.filter((row) => (row.uploaded_by || '').toLowerCase().includes(wantUploader))
    : rows;

  const scope = [
    scopeLabel ? `case ${scopeLabel}` : '',
    sources ? DOCUMENT_SOURCE_LABELS[sources[0]] : '',
    args.category ? `type ${args.category}` : '',
    args.query ? `matching "${args.query}"` : '',
    wantUploader ? `uploaded by ${args.uploaded_by}` : '',
    args.date_from || args.date_to
      ? `between ${args.date_from || 'the start'} and ${args.date_to || 'today'}`
      : '',
  ]
    .filter(Boolean)
    .join(', ');

  if (listed.length === 0) {
    return `No documents in the drive${scope ? ` for ${scope}` : ''}.`;
  }

  const header = `${total} document${total === 1 ? '' : 's'} in the drive${
    scope ? ` for ${scope}` : ''
  }${total > listed.length ? `, newest ${listed.length} listed` : ''}:`;

  return [
    header,
    ...listed.map((row, index) => documentLine(row, index)),
    'Tell the user the file names with the date each one was uploaded and who uploaded it. Do not show the ids.',
  ].join('\n');
}

/** The drive row a summary was asked for, by id, by name, or whatever the drive has focused. */
async function findDocumentForSummary(args: SummarizeArgs): Promise<DocumentIndexRow | null> {
  const wanted = String(args.document_id || '').trim();
  const focused = getRmqAiDriveDocument();
  const key = wanted || (args.file_name ? '' : focused?.key || '');

  if (key) {
    const [source, ...rest] = key.split(':');
    const rowId = rest.join(':');
    if (source && rowId) {
      const row = await fetchDocumentIndexRow(source, rowId).catch(() => null);
      if (row) return row;
    }
  }

  const name = String(args.file_name || '').trim();
  if (!name) return null;

  let scopeKey: string[] | null = null;
  const wantedLead = resolveLeadArg(args.lead || '');
  if (wantedLead) {
    const scope = await caseScopeKeys(wantedLead);
    scopeKey = scope ? scope.keys : [wantedLead];
  }
  const { rows } = await fetchDocumentIndex({
    scopeKey,
    search: name,
    sort: 'created_at',
    ascending: false,
    pageSize: 5,
  });
  return rows[0] ?? null;
}

/** The stored summary, once the worker has had a chance to write one. */
async function waitForCaseSummary(rowId: string): Promise<{ summary: string; note: string }> {
  const deadline = Date.now() + SUMMARY_TIMEOUT_MS;
  // Asked for by a person, so it runs whatever the automatic-summary switch says. The summary is
  // written onto the document itself, which is where the case drawer and the drive read it from —
  // so this is read back from the row, and nobody pays to summarise the same file twice.
  await requestManualCaseDocumentSummary(rowId);

  while (Date.now() < deadline) {
    const { data } = await supabase
      .from('lead_case_documents')
      .select('ai_summary, ai_summary_status, ai_summary_error')
      .eq('id', rowId)
      .maybeSingle();
    const status = String(data?.ai_summary_status || '');
    const summary = String(data?.ai_summary || '').trim();
    if (summary) return { summary, note: '' };
    if (status === 'failed' || status === 'skipped') {
      return { summary: '', note: String(data?.ai_summary_error || '').trim() };
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  return { summary: '', note: 'The file is still being read.' };
}

export async function executeSummarizeDriveDocument(args: SummarizeArgs): Promise<string> {
  const row = await findDocumentForSummary(args);
  if (!row) {
    return 'I could not work out which document that is. Ask the user to click the file in the drive, or give its name.';
  }

  const about = [
    `Document: ${row.file_name}`,
    row.category ? `Type: ${row.category}` : '',
    row.source === 'lead'
      ? `Case: ${row.scope_key || '—'}`
      : `Section: ${DOCUMENT_SOURCE_LABELS[row.source]}${row.scope_label ? ` — ${row.scope_label}` : ''}`,
    row.folder_path ? `Folder: ${row.folder_path}` : '',
    dayOf(row.created_at) ? `Uploaded: ${dayOf(row.created_at)}` : '',
    row.uploaded_by ? `Uploaded by: ${row.uploaded_by}` : '',
    `Size: ${formatDocumentSize(row.file_size)}`,
  ]
    .filter(Boolean)
    .join('\n');

  const existing = String(row.ai_summary || '').trim();
  if (existing && args.force !== true) {
    return `${about}\n\nWhat the document says:\n${existing}`;
  }

  if (row.source !== 'lead') {
    return [
      about,
      '',
      'This file sits outside the case documents, and only case documents can be read automatically.',
      'Tell the user what the file is from its name, type and folder, and that you cannot read inside it.',
    ].join('\n');
  }

  const { summary, note } = await waitForCaseSummary(row.row_id);
  if (summary) return `${about}\n\nWhat the document says:\n${summary}`;
  return [
    about,
    '',
    `This document could not be read${note ? `: ${note}` : '.'}`,
    'Say so plainly and describe what the file is from its name, type and case instead.',
  ].join('\n');
}
