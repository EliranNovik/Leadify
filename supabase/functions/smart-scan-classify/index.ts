import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { encode as base64Encode } from 'https://deno.land/std@0.177.0/encoding/base64.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { supabase } from '../_shared/supabase-client.ts';
import {
  OPENAI_CHAT_COMPLETIONS_URL,
  OPENAI_CHAT_MODEL,
  buildChatCompletionBody,
} from '../_shared/openaiModels.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const BUCKET = Deno.env.get('EMAIL_ATTACHMENTS_BUCKET') || 'email-attachments';
const CLASSIFY_SECRET = Deno.env.get('SMART_SCAN_CLASSIFY_SECRET') || '';

const ALLOWED_TYPES = [
  'Passport',
  'Passport Copy',
  'ID Card Copy',
  'Birth Certificate',
  'Marriage Certificate',
  'Death Certificate',
  'Divorce Certificate',
  'Population Registry Extract',
  'Apostille',
  'Police Certificate',
  'Proof of Address',
  'Power of Attorney',
  'Contract',
  'Translation',
  'Naturalization Certificate',
  'Military Records',
  'Dissolution Hearing Summons',
  'Other',
  'Unknown',
] as const;

type AllowedType = (typeof ALLOWED_TYPES)[number];

type ClassifyBody = { documentId?: string; force?: boolean };

type AiDocument = {
  pageStart: number;
  pageEnd: number;
  documentType: string;
  title: string;
  suggestedFilename: string;
  detectedPersonName: string | null;
  detectedCountry: string | null;
  documentDate: string | null;
  expiryDate: string | null;
  summary: string;
  confidence: number;
};

type AiResult = {
  documents: AiDocument[];
  splitUncertain: boolean;
  notes: string;
};

type ScanRow = {
  id: string;
  parent_id: string | null;
  source_email_id: number;
  source_graph_attachment_id: string;
  storage_path: string | null;
  content_type: string | null;
  original_filename: string | null;
  activity: unknown;
  status: string;
};

const extraCors = {
  ...corsHeaders,
  'Access-Control-Allow-Headers': `${corsHeaders['Access-Control-Allow-Headers']}, x-smart-scan-secret`,
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...extraCors, 'Content-Type': 'application/json' },
  });
}

function nowIso() {
  return new Date().toISOString();
}

function asActivity(value: unknown): { at: string; label: string }[] {
  return Array.isArray(value)
    ? value.filter((entry) => entry && typeof entry === 'object') as { at: string; label: string }[]
    : [];
}

function pushActivity(existing: unknown, label: string) {
  return [...asActivity(existing), { at: nowIso(), label }];
}

function inferMime(fileName: string, fallback?: string | null): string {
  const given = String(fallback || '').toLowerCase().trim();
  if (given && given !== 'application/octet-stream') return given;
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'tif' || ext === 'tiff') return 'image/tiff';
  if (ext === 'heic') return 'image/heic';
  return given || 'application/octet-stream';
}

function isImageMime(mime: string) {
  return mime.startsWith('image/');
}

function isPdfMime(mime: string, fileName: string) {
  return mime.includes('pdf') || /\.pdf$/i.test(fileName);
}

function safeFileName(name: string, fallback = 'Document.pdf') {
  const trimmed = String(name || '')
    .replace(/[^\w.\-() ]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160);
  const base = trimmed || fallback;
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

function matchHebrewDocumentType(raw: string): AllowedType | null {
  if (/תמצית\s*רישום|מרשם\s*האוכלוסין/.test(raw)) return 'Population Registry Extract';
  if (/תעודת\s*זהות/.test(raw)) return 'ID Card Copy';
  if (/תעודת\s*לידה/.test(raw)) return 'Birth Certificate';
  if (/תעודת\s*נישואין/.test(raw)) return 'Marriage Certificate';
  if (/תעודת\s*פטירה/.test(raw)) return 'Death Certificate';
  if (/תעודת\s*גירושין/.test(raw)) return 'Divorce Certificate';
  if (/ייפוי\s*כוח/.test(raw)) return 'Power of Attorney';
  if (/דרכון/.test(raw)) return 'Passport';
  if (/זימון\s*לדיון|בקשת\s*פירוק|פירוק\s*העמותה|רשות\s*התאגידים/.test(raw)) {
    return 'Dissolution Hearing Summons';
  }
  return null;
}

function normalizeType(value: string | null | undefined): AllowedType {
  const raw = String(value || '').trim();
  if (!raw) return 'Unknown';
  const hebrew = matchHebrewDocumentType(raw);
  if (hebrew) return hebrew;
  const exact = ALLOWED_TYPES.find((type) => type.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const compact = raw.toLowerCase().replace(/[^a-z]/g, '');
  const aliases: Record<string, AllowedType> = {
    passport: 'Passport',
    passportcopy: 'Passport Copy',
    id: 'ID Card Copy',
    idcard: 'ID Card Copy',
    identitycard: 'ID Card Copy',
    teudatzehut: 'ID Card Copy',
    birthcertificate: 'Birth Certificate',
    marriagecertificate: 'Marriage Certificate',
    deathcertificate: 'Death Certificate',
    divorcecertificate: 'Divorce Certificate',
    populationregistryextract: 'Population Registry Extract',
    populationregistry: 'Population Registry Extract',
    civilregistryextract: 'Population Registry Extract',
    registryextract: 'Population Registry Extract',
    extractofregistration: 'Population Registry Extract',
    tamzitrishum: 'Population Registry Extract',
    tamtzitrishum: 'Population Registry Extract',
    tatzritrishum: 'Population Registry Extract',
    apostille: 'Apostille',
    police: 'Police Certificate',
    policecertificate: 'Police Certificate',
    proofofaddress: 'Proof of Address',
    utilitybill: 'Proof of Address',
    poa: 'Power of Attorney',
    powerofattorney: 'Power of Attorney',
    contract: 'Contract',
    agreement: 'Contract',
    translation: 'Translation',
    naturalization: 'Naturalization Certificate',
    military: 'Military Records',
    dissolutionhearingsummons: 'Dissolution Hearing Summons',
    dissolutionsummons: 'Dissolution Hearing Summons',
    windingupsummons: 'Dissolution Hearing Summons',
    corporationsauthoritysummons: 'Dissolution Hearing Summons',
    other: 'Other',
  };
  return aliases[compact] || 'Other';
}

function isoDate(value: unknown): string | null {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
}

function clampConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n > 1 && n <= 100) return Math.round(n) / 100;
  return Math.max(0, Math.min(1, n));
}

function extractResponsesOutputText(data: Record<string, unknown>): string {
  const direct = data.output_text;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const out = data.output;
  if (!Array.isArray(out)) return '';
  const texts: string[] = [];
  for (const block of out) {
    if (!block || typeof block !== 'object') continue;
    const content = (block as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;
      if (p.type === 'output_text' && typeof p.text === 'string') texts.push(p.text);
    }
  }
  return texts.join('\n').trim();
}

function parseModelJson(text: string): AiResult {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Model did not return JSON');
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  const docs = Array.isArray(parsed.documents) ? parsed.documents : [];
  return {
    documents: docs.map((row) => {
      const item = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
      return {
        pageStart: Number(item.pageStart) || 1,
        pageEnd: Number(item.pageEnd) || Number(item.pageStart) || 1,
        documentType: String(item.documentType || 'Unknown'),
        title: String(item.title || item.documentType || 'Document'),
        suggestedFilename: String(item.suggestedFilename || ''),
        detectedPersonName: item.detectedPersonName ? String(item.detectedPersonName) : null,
        detectedCountry: item.detectedCountry ? String(item.detectedCountry) : null,
        documentDate: isoDate(item.documentDate),
        expiryDate: isoDate(item.expiryDate),
        summary: String(item.summary || '').trim(),
        confidence: clampConfidence(item.confidence),
      };
    }),
    splitUncertain: parsed.splitUncertain === true,
    notes: String(parsed.notes || '').trim(),
  };
}

function buildFilename(doc: AiDocument) {
  if (doc.suggestedFilename) return safeFileName(doc.suggestedFilename);
  const person = (doc.detectedPersonName || 'Unknown').trim().replace(/\s+/g, '_');
  const type = normalizeType(doc.documentType).replace(/\s+/g, '_');
  const date = doc.documentDate || 'undated';
  return safeFileName(`${person}_${type}_${date}.pdf`);
}

function normalizeRanges(docs: AiDocument[], pageCount: number): AiDocument[] {
  if (!docs.length) {
    return [{
      pageStart: 1,
      pageEnd: pageCount,
      documentType: 'Unknown',
      title: 'Scanned document',
      suggestedFilename: '',
      detectedPersonName: null,
      detectedCountry: null,
      documentDate: null,
      expiryDate: null,
      summary: '',
      confidence: 0,
    }];
  }
  const clamped = docs
    .map((doc) => {
      const start = Math.min(pageCount, Math.max(1, Math.round(doc.pageStart) || 1));
      const end = Math.min(pageCount, Math.max(start, Math.round(doc.pageEnd) || start));
      return { ...doc, pageStart: start, pageEnd: end };
    })
    .sort((a, b) => a.pageStart - b.pageStart || a.pageEnd - b.pageEnd);
  return clamped;
}

function classifyPrompt(fileName: string, pageCount: number) {
  return [
    'You classify citizenship and immigration scans for a law-office CRM.',
    'The attached file is a scanner output. It may contain ONE legal document or SEVERAL stacked in the same scan.',
    `Original filename: "${fileName}". ${pageCount > 0 ? `Page count: ${pageCount}.` : 'Count the pages from the attached file.'} Pages are 1-indexed.`,
    'Split only when a new document clearly starts (new certificate, passport, ID, contract, apostille, translation).',
    'Do not split pages that belong to the same document (passport data page + visa page, multi-page certificate).',
    'Skip blank separator pages. Cover every non-blank page without overlapping ranges.',
    `documentType MUST be one of: ${ALLOWED_TYPES.join(', ')}.`,
    'Read Hebrew, Arabic, and English titles. Common Israeli documents:',
    'תמצית רישום / תמצית רישום ממרשם האוכלוסין / Ministry of Interior population extract = Population Registry Extract (not Unknown, not Other).',
    'תעודת זהות = ID Card Copy. תעודת לידה = Birth Certificate. תעודת נישואין = Marriage Certificate. תעודת פטירה = Death Certificate. תעודת גירושין = Divorce Certificate. דרכון = Passport. ייפוי כוח = Power of Attorney.',
    'רשות התאגידים / Israeli Corporations Authority / יחידת אכיפה ובקרה letter titled זימון לדיון or בקשת פירוק (association or company winding-up hearing summons) = Dissolution Hearing Summons (not Other, not Contract, not Unknown). Use the letter date as documentDate. Put hearing date, court, case number, and association/company name in summary.',
    'suggestedFilename: PersonName_DocumentType_YYYY-MM-DD.pdf using underscores. Use undated if no date.',
    'confidence is 0 to 1. Set splitUncertain true if boundaries are unclear.',
    'Return JSON only, no markdown:',
    '{"documents":[{"pageStart":1,"pageEnd":1,"documentType":"Passport","title":"","suggestedFilename":"","detectedPersonName":null,"detectedCountry":null,"documentDate":null,"expiryDate":null,"summary":"","confidence":0.0}],"splitUncertain":false,"notes":""}',
  ].join('\n');
}

async function uploadOpenAiFile(blob: Blob, fileName: string): Promise<string> {
  const purposes = ['user_data', 'assistants'];
  let lastError = 'OpenAI file upload failed';
  for (const purpose of purposes) {
    const form = new FormData();
    form.append('purpose', purpose);
    form.append('file', blob, safeFileName(fileName));
    const res = await fetch('https://api.openai.com/v1/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && typeof data.id === 'string') return data.id;
    lastError = (data.error as { message?: string } | undefined)?.message || res.statusText || lastError;
  }
  throw new Error(lastError);
}

async function deleteOpenAiFile(fileId: string) {
  await fetch(`https://api.openai.com/v1/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
  }).catch(() => undefined);
}

async function classifyPdf(blob: Blob, fileName: string, pageCount: number): Promise<AiResult> {
  const fileId = await uploadOpenAiFile(blob, fileName);
  try {
    const res = await fetch(RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_CHAT_MODEL,
        reasoning: { effort: 'low' },
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: classifyPrompt(fileName, pageCount) },
              { type: 'input_file', file_id: fileId },
            ],
          },
        ],
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg = (data.error as { message?: string } | undefined)?.message || res.statusText;
      throw new Error(`OpenAI responses: ${msg}`);
    }
    const text = extractResponsesOutputText(data);
    if (!text) throw new Error('Empty classification from model');
    return parseModelJson(text);
  } finally {
    await deleteOpenAiFile(fileId);
  }
}

async function classifyImage(bytes: Uint8Array, mime: string, fileName: string): Promise<AiResult> {
  const b64 = base64Encode(bytes);
  const dataUrl = `data:${mime};base64,${b64}`;
  const messages = [
    { role: 'system', content: classifyPrompt(fileName, 1) },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Classify this scanned page.' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ];
  const request = async (withJsonFormat: boolean) => {
    const res = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        buildChatCompletionBody({
          temperature: 0.1,
          maxTokens: 1200,
          response_format: withJsonFormat ? { type: 'json_object' } : undefined,
          messages,
        }),
      ),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data as { error?: { message?: string } })?.error?.message || res.statusText;
      throw new Error(`OpenAI chat: ${msg}`);
    }
    const text = (data as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('Empty classification from model');
    return parseModelJson(text);
  };
  try {
    return await request(true);
  } catch {
    return await request(false);
  }
}

async function loadPdfLib() {
  const { PDFDocument } = await import('npm:pdf-lib@1.17.1');
  return PDFDocument;
}

async function splitPdf(bytes: Uint8Array, start: number, end: number): Promise<Uint8Array> {
  const PDFDocument = await loadPdfLib();
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const indexes = [];
  for (let page = start; page <= end; page += 1) indexes.push(page - 1);
  const copied = await out.copyPages(src, indexes);
  copied.forEach((page) => out.addPage(page));
  return await out.save();
}

async function uploadPdf(path: string, bytes: Uint8Array) {
  const body = new Blob([bytes], { type: 'application/pdf' });
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (error) throw new Error(error.message || 'Failed to upload split PDF');
}

async function deleteChildren(parentId: string) {
  const { data, error } = await supabase
    .from('smart_scan_documents')
    .select('id, storage_path')
    .eq('parent_id', parentId);
  if (error) throw new Error(error.message || 'Failed to list split documents');
  const paths = (data || []).map((row) => row.storage_path).filter((path): path is string => Boolean(path));
  if (paths.length) {
    await supabase.storage.from(BUCKET).remove(paths);
  }
  if ((data || []).length) {
    const { error: delErr } = await supabase.from('smart_scan_documents').delete().eq('parent_id', parentId);
    if (delErr) throw new Error(delErr.message || 'Failed to remove previous splits');
  }
}

function issueFor(doc: AiDocument, splitUncertain: boolean, splitCount: number, matchedLead: boolean) {
  if (splitUncertain && splitCount > 1) return 'document_split_uncertain';
  if (normalizeType(doc.documentType) === 'Unknown' || doc.confidence < 0.7) return 'document_type_uncertain';
  if (!matchedLead) return 'lead_not_found';
  return null;
}

function statusFor(issue: string | null, matchedLead: boolean) {
  if (issue === 'document_split_uncertain' || issue === 'document_type_uncertain') {
    return { status: 'needs_review', classificationStatus: 'needs_review' as const };
  }
  if (!matchedLead || issue === 'lead_not_found') {
    return { status: 'unmatched', classificationStatus: 'classified' as const };
  }
  return { status: 'needs_review', classificationStatus: 'classified' as const };
}

async function markFailed(id: string, activity: unknown, message: string) {
  await supabase
    .from('smart_scan_documents')
    .update({
      status: 'failed',
      classification_status: 'failed',
      issue: 'ai_processing_failed',
      error: message.slice(0, 2000),
      processed_at: nowIso(),
      updated_at: nowIso(),
      activity: pushActivity(activity, `AI classification failed: ${message.slice(0, 180)}`),
    })
    .eq('id', id);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: extraCors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!OPENAI_API_KEY) return json({ error: 'Server misconfigured: missing OPENAI_API_KEY' }, 500);

  const authHeader = req.headers.get('Authorization') || '';
  const secretHeader = req.headers.get('x-smart-scan-secret') || '';
  const isServiceRequest = Boolean(CLASSIFY_SECRET && secretHeader && secretHeader === CLASSIFY_SECRET);
  if (!isServiceRequest && !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Missing or invalid authorization' }, 401);
  }

  let body: ClassifyBody;
  try {
    body = (await req.json()) as ClassifyBody;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const documentId = typeof body.documentId === 'string' ? body.documentId.trim() : '';
  if (!documentId) return json({ error: 'documentId is required' }, 400);

  const { data: row, error: rowErr } = await supabase
    .from('smart_scan_documents')
    .select(
      'id, parent_id, source_email_id, source_graph_attachment_id, storage_path, content_type, original_filename, activity, status',
    )
    .eq('id', documentId)
    .maybeSingle();

  if (rowErr || !row) return json({ error: rowErr?.message || 'Document not found' }, 404);

  const rec = row as ScanRow;
  const sourceId = rec.parent_id || rec.id;

  const { data: source, error: sourceErr } = rec.parent_id
    ? await supabase
      .from('smart_scan_documents')
      .select(
        'id, parent_id, source_email_id, source_graph_attachment_id, storage_path, content_type, original_filename, activity, status',
      )
      .eq('id', sourceId)
      .maybeSingle()
    : { data: rec, error: null };

  if (sourceErr || !source) return json({ error: sourceErr?.message || 'Source scan not found' }, 404);
  const src = source as ScanRow;

  if (!src.storage_path?.trim()) {
    await markFailed(src.id, src.activity, 'No stored file for this scan');
    return json({ error: 'No stored file for this scan' }, 400);
  }

  await supabase
    .from('smart_scan_documents')
    .update({
      status: 'processing',
      classification_status: 'processing',
      error: null,
      updated_at: nowIso(),
      activity: pushActivity(src.activity, 'AI classification started'),
    })
    .eq('id', src.id);

  try {
    const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(src.storage_path.trim());
    if (dlErr || !blob) throw new Error(dlErr?.message || 'Download failed');

    const fileName = src.original_filename || 'scan.pdf';
    const mime = inferMime(fileName, src.content_type);
    const matchedLead = false;
    console.log(`smart-scan-classify ${src.id} file=${fileName} size=${blob.size} mime=${mime}`);

    let pageCount = 1;
    let ai: AiResult;
    let bytes: Uint8Array | null = null;

    if (isPdfMime(mime, fileName)) {
      ai = await classifyPdf(blob, fileName, 0);
      pageCount = Math.max(
        1,
        ...ai.documents.map((doc) => Math.max(doc.pageStart || 1, doc.pageEnd || 1)),
      );
    } else if (isImageMime(mime)) {
      bytes = new Uint8Array(await blob.arrayBuffer());
      pageCount = 1;
      ai = await classifyImage(bytes, mime, fileName);
    } else {
      throw new Error(`Unsupported scan type: ${mime}`);
    }

    let documents = normalizeRanges(ai.documents, pageCount);
    const wantsSplit = isPdfMime(mime, fileName) && documents.length > 1;
    if (wantsSplit) {
      try {
        bytes = bytes || new Uint8Array(await blob.arrayBuffer());
        const PDFDocument = await loadPdfLib();
        const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
        pageCount = Math.max(1, pdf.getPageCount());
        documents = normalizeRanges(ai.documents, pageCount);
      } catch (splitErr) {
        console.error('pdf-lib load failed; keeping as a single document', splitErr);
      }
    }
    const shouldSplit = Boolean(bytes) && wantsSplit && documents.length > 1 && pageCount > 1;
    await deleteChildren(src.id);

    const shared = {
      source_email_id: src.source_email_id,
      source_graph_attachment_id: src.source_graph_attachment_id,
      original_filename: fileName,
      ai_raw: ai,
      processed_at: nowIso(),
      updated_at: nowIso(),
      error: null,
      ignored: false,
    };

    if (!shouldSplit) {
      const doc = documents[0];
      const documentType = normalizeType(doc.documentType);
      const issue = issueFor(doc, ai.splitUncertain, 1, matchedLead);
      const statuses = statusFor(issue, matchedLead);
      const suggestedFilename = buildFilename({ ...doc, documentType });
      await supabase
        .from('smart_scan_documents')
        .update({
          ...shared,
          parent_id: null,
          page_count: pageCount,
          page_start: 1,
          page_end: pageCount,
          split_index: null,
          document_type: documentType,
          suggested_document_type: documentType,
          title: doc.title || documentType,
          suggested_filename: suggestedFilename,
          detected_person_name: doc.detectedPersonName,
          detected_country: doc.detectedCountry,
          document_date: doc.documentDate,
          expiry_date: doc.expiryDate,
          summary: doc.summary || ai.notes || null,
          confidence: doc.confidence,
          issue,
          status: statuses.status,
          classification_status: statuses.classificationStatus,
          activity: pushActivity(
            src.activity,
            `AI classified as ${documentType} (${Math.round(doc.confidence * 100)}%) — ${suggestedFilename}`,
          ),
        })
        .eq('id', src.id);

      return json({
        success: true,
        documentId: src.id,
        split: false,
        documentType,
        suggestedFilename,
      });
    }

    const childPayloads = [];
    for (let index = 0; index < documents.length; index += 1) {
      const doc = documents[index];
      const documentType = normalizeType(doc.documentType);
      const suggestedFilename = buildFilename({ ...doc, documentType });
      const issue = issueFor(doc, ai.splitUncertain, documents.length, matchedLead);
      const statuses = statusFor(issue, matchedLead);
      const pages = doc.pageEnd - doc.pageStart + 1;
      const splitBytes = await splitPdf(bytes as Uint8Array, doc.pageStart, doc.pageEnd);
      const storagePath = `smart-scan/${src.source_email_id}/${src.id}/${index + 1}-${safeFileName(suggestedFilename)}`;
      await uploadPdf(storagePath, splitBytes);
      childPayloads.push({
        ...shared,
        parent_id: src.id,
        storage_path: storagePath,
        content_type: 'application/pdf',
        page_count: pages,
        page_start: doc.pageStart,
        page_end: doc.pageEnd,
        split_index: index + 1,
        document_type: documentType,
        suggested_document_type: documentType,
        title: doc.title || documentType,
        suggested_filename: suggestedFilename,
        detected_person_name: doc.detectedPersonName,
        detected_country: doc.detectedCountry,
        document_date: doc.documentDate,
        expiry_date: doc.expiryDate,
        summary: doc.summary || null,
        confidence: doc.confidence,
        issue,
        status: statuses.status,
        classification_status: statuses.classificationStatus,
        activity: [
          { at: nowIso(), label: `Split from ${fileName} pages ${doc.pageStart}–${doc.pageEnd}` },
          { at: nowIso(), label: `AI classified as ${documentType} (${Math.round(doc.confidence * 100)}%) — ${suggestedFilename}` },
        ],
      });
    }

    const { error: insertErr } = await supabase.from('smart_scan_documents').insert(childPayloads);
    if (insertErr) throw new Error(insertErr.message || 'Failed to save split documents');

    await supabase
      .from('smart_scan_documents')
      .update({
        ...shared,
        ignored: true,
        page_count: pageCount,
        page_start: 1,
        page_end: pageCount,
        document_type: 'Unknown',
        suggested_document_type: 'Unknown',
        title: `Split into ${documents.length} documents`,
        suggested_filename: fileName,
        summary: ai.notes || `Split into ${documents.length} documents`,
        confidence: null,
        issue: ai.splitUncertain ? 'document_split_uncertain' : null,
        status: 'completed',
        classification_status: 'classified',
        activity: pushActivity(src.activity, `AI split scan into ${documents.length} PDFs`),
      })
      .eq('id', src.id);

    return json({
      success: true,
      documentId: src.id,
      split: true,
      count: documents.length,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await markFailed(src.id, src.activity, msg);
    return json({ success: false, error: msg }, 500);
  }
});
