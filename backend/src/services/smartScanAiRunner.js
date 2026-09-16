let PDFDocument = null;
try {
  ({ PDFDocument } = require('pdf-lib'));
} catch {
  PDFDocument = null;
}
const supabase = require('../config/supabase');

const TABLE = 'smart_scan_documents';
const BUCKET = process.env.EMAIL_ATTACHMENTS_BUCKET || 'email-attachments';
const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const FILES_URL = 'https://api.openai.com/v1/files';

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
];

function getOpenAiKey() {
  return (process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || '').trim();
}

function resolveModel() {
  const dedicated = (process.env.SMART_SCAN_OPENAI_MODEL || process.env.OPENAI_VISION_MODEL || '').trim();
  if (dedicated) return dedicated;
  const shared = (process.env.OPENAI_CHAT_MODEL || '').trim();
  if (shared && !/sol|cursor/i.test(shared)) return shared;
  return 'gpt-4o';
}

function nowIso() {
  return new Date().toISOString();
}

function asActivity(value) {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === 'object') : [];
}

function pushActivity(existing, label) {
  return [...asActivity(existing), { at: nowIso(), label }];
}

function inferMime(fileName, fallback) {
  const given = String(fallback || '').toLowerCase().trim();
  if (given && given !== 'application/octet-stream') return given;
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'tif' || ext === 'tiff') return 'image/tiff';
  if (ext === 'heic') return 'image/heic';
  return given || 'application/octet-stream';
}

function isImageMime(mime) {
  return mime.startsWith('image/');
}

function isPdfMime(mime, fileName) {
  return mime.includes('pdf') || /\.pdf$/i.test(fileName);
}

function safeFileName(name, fallback = 'Document.pdf') {
  const trimmed = String(name || '')
    .replace(/[^\w.\-() ]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160);
  const base = trimmed || fallback;
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

function matchHebrewDocumentType(raw) {
  const text = String(raw || '');
  if (/תמצית\s*רישום|מרשם\s*האוכלוסין/.test(text)) return 'Population Registry Extract';
  if (/תעודת\s*זהות/.test(text)) return 'ID Card Copy';
  if (/תעודת\s*לידה/.test(text)) return 'Birth Certificate';
  if (/תעודת\s*נישואין/.test(text)) return 'Marriage Certificate';
  if (/תעודת\s*פטירה/.test(text)) return 'Death Certificate';
  if (/תעודת\s*גירושין/.test(text)) return 'Divorce Certificate';
  if (/ייפוי\s*כוח/.test(text)) return 'Power of Attorney';
  if (/דרכון/.test(text)) return 'Passport';
  if (/זימון\s*לדיון|בקשת\s*פירוק|פירוק\s*העמותה|רשות\s*התאגידים/.test(text)) {
    return 'Dissolution Hearing Summons';
  }
  return null;
}

function normalizeType(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Unknown';
  const hebrew = matchHebrewDocumentType(raw);
  if (hebrew) return hebrew;
  const exact = ALLOWED_TYPES.find((type) => type.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const compact = raw.toLowerCase().replace(/[^a-z]/g, '');
  const aliases = {
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

function isoDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n > 1 && n <= 100) return Math.round(n) / 100;
  return Math.max(0, Math.min(1, n));
}

function extractResponsesOutputText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const out = data?.output;
  if (!Array.isArray(out)) return '';
  const texts = [];
  for (const block of out) {
    if (!block || typeof block !== 'object') continue;
    const content = block.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type === 'output_text' && typeof part.text === 'string') texts.push(part.text);
    }
  }
  return texts.join('\n').trim();
}

function parseModelJson(text) {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Model did not return JSON');
  const parsed = JSON.parse(trimmed.slice(start, end + 1));
  const docs = Array.isArray(parsed.documents) ? parsed.documents : [];
  return {
    documents: docs.map((row) => {
      const item = row && typeof row === 'object' ? row : {};
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

function buildFilename(doc) {
  if (doc.suggestedFilename) return safeFileName(doc.suggestedFilename);
  const person = (doc.detectedPersonName || 'Unknown').trim().replace(/\s+/g, '_');
  const type = normalizeType(doc.documentType).replace(/\s+/g, '_');
  const date = doc.documentDate || 'undated';
  return safeFileName(`${person}_${type}_${date}.pdf`);
}

function normalizeRanges(docs, pageCount) {
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
  return docs
    .map((doc) => {
      const start = Math.min(pageCount, Math.max(1, Math.round(doc.pageStart) || 1));
      const end = Math.min(pageCount, Math.max(start, Math.round(doc.pageEnd) || start));
      return { ...doc, pageStart: start, pageEnd: end };
    })
    .sort((a, b) => a.pageStart - b.pageStart || a.pageEnd - b.pageEnd);
}

function classifyPrompt(fileName, pageCount) {
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

function issueFor(doc, splitUncertain, splitCount) {
  if (splitUncertain && splitCount > 1) return 'document_split_uncertain';
  if (normalizeType(doc.documentType) === 'Unknown' || doc.confidence < 0.7) return 'document_type_uncertain';
  return 'lead_not_found';
}

function statusFor(issue) {
  if (issue === 'document_split_uncertain' || issue === 'document_type_uncertain') {
    return { status: 'needs_review', classificationStatus: 'needs_review' };
  }
  return { status: 'unmatched', classificationStatus: 'classified' };
}

async function openaiJson(url, apiKey, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText || `OpenAI HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function uploadOpenAiFile(apiKey, buffer, fileName, mime) {
  const purposes = ['user_data', 'assistants'];
  let lastError = 'OpenAI file upload failed';
  for (const purpose of purposes) {
    const form = new FormData();
    form.append('purpose', purpose);
    form.append('file', new Blob([buffer], { type: mime }), fileName);
    const res = await fetch(FILES_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(120000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.id) return data.id;
    lastError = data?.error?.message || res.statusText || lastError;
  }
  throw new Error(lastError);
}

async function deleteOpenAiFile(apiKey, fileId) {
  if (!fileId) return;
  await fetch(`${FILES_URL}/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  }).catch(() => undefined);
}

async function classifyPdf(apiKey, model, buffer, fileName, pageCount) {
  const fileId = await uploadOpenAiFile(apiKey, buffer, safeFileName(fileName), 'application/pdf');
  try {
    const data = await openaiJson(RESPONSES_URL, apiKey, {
      model,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: classifyPrompt(fileName, pageCount) },
            { type: 'input_file', file_id: fileId },
          ],
        },
      ],
    });
    const text = extractResponsesOutputText(data);
    if (!text) throw new Error('Empty classification from model');
    return parseModelJson(text);
  } finally {
    await deleteOpenAiFile(apiKey, fileId);
  }
}

async function classifyImage(apiKey, model, buffer, mime, fileName) {
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
  const data = await openaiJson(CHAT_URL, apiKey, {
    model,
    temperature: 0.1,
    max_completion_tokens: 1200,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: classifyPrompt(fileName, 1) },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Classify this scanned page.' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('Empty classification from model');
  return parseModelJson(text);
}

async function splitPdf(buffer, start, end) {
  if (!PDFDocument) throw new Error('pdf-lib is not installed');
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const indexes = [];
  for (let page = start; page <= end; page += 1) indexes.push(page - 1);
  const copied = await out.copyPages(src, indexes);
  copied.forEach((page) => out.addPage(page));
  return Buffer.from(await out.save());
}

async function uploadPdf(path, bytes) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (error) throw new Error(error.message || 'Failed to upload split PDF');
}

async function deleteChildren(parentId) {
  const { data, error } = await supabase.from(TABLE).select('id, storage_path').eq('parent_id', parentId);
  if (error) throw new Error(error.message || 'Failed to list split documents');
  const paths = (data || []).map((row) => row.storage_path).filter(Boolean);
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
  if ((data || []).length) {
    const { error: delErr } = await supabase.from(TABLE).delete().eq('parent_id', parentId);
    if (delErr) throw new Error(delErr.message || 'Failed to remove previous splits');
  }
}

async function loadSourceRow(documentId) {
  const { data: rec, error } = await supabase.from(TABLE).select('*').eq('id', documentId).maybeSingle();
  if (error || !rec) throw new Error(error?.message || 'Document not found');
  if (!rec.parent_id) return rec;
  const { data: parent, error: parentErr } = await supabase.from(TABLE).select('*').eq('id', rec.parent_id).maybeSingle();
  if (parentErr || !parent) throw new Error(parentErr?.message || 'Source scan not found');
  return parent;
}

async function classifySmartScanDocument(documentId) {
  const apiKey = getOpenAiKey();
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY is not set on the backend');
    error.code = 'NO_OPENAI_KEY';
    throw error;
  }

  const src = await loadSourceRow(documentId);
  if (!src.storage_path?.trim()) throw new Error('No stored file for this scan');

  await supabase
    .from(TABLE)
    .update({
      status: 'processing',
      classification_status: 'processing',
      error: null,
      updated_at: nowIso(),
      activity: pushActivity(src.activity, 'AI classification started'),
    })
    .eq('id', src.id);

  const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(src.storage_path.trim());
  if (dlErr || !blob) throw new Error(dlErr?.message || 'Download failed');

  const buffer = Buffer.from(await blob.arrayBuffer());
  const fileName = src.original_filename || 'scan.pdf';
  const mime = inferMime(fileName, src.content_type);
  const model = resolveModel();
  console.log(`🧠 Smart Scan local classify ${src.id} file=${fileName} bytes=${buffer.length} model=${model}`);

  let pageCount = 1;
  let ai;
  if (isPdfMime(mime, fileName)) {
    if (PDFDocument) {
      try {
        const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
        pageCount = Math.max(1, pdf.getPageCount());
      } catch (error) {
        console.warn('⚠️  Smart Scan pdf-lib page count failed:', error.message || error);
      }
    }
    ai = await classifyPdf(apiKey, model, buffer, fileName, pageCount);
  } else if (isImageMime(mime)) {
    ai = await classifyImage(apiKey, model, buffer, mime, fileName);
  } else {
    throw new Error(`Unsupported scan type: ${mime}`);
  }

  let documents = normalizeRanges(ai.documents, pageCount);
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

  const doc = documents[0];
  const documentType = documents.length > 1 ? 'Unknown' : normalizeType(doc.documentType);
  const issue = issueFor(doc, ai.splitUncertain, documents.length);
  const statuses = statusFor(issue);
  const suggestedFilename = fileName;
  const classifiedLabel =
    documents.length > 1
      ? `AI found ${documents.length} documents — kept as one scan (${Math.round((doc.confidence || 0) * 100)}%)`
      : `AI classified as ${documentType} (${Math.round((doc.confidence || 0) * 100)}%) — ${buildFilename({ ...doc, documentType })}`;
  await supabase
    .from(TABLE)
    .update({
      ...shared,
      parent_id: null,
      page_count: pageCount,
      page_start: 1,
      page_end: pageCount,
      split_index: null,
      document_type: documentType,
      suggested_document_type: documents.length > 1 ? 'Unknown' : documentType,
      title: documents.length > 1 ? `Scan (${documents.length} documents)` : doc.title || documentType,
      suggested_filename: suggestedFilename,
      detected_person_name: doc.detectedPersonName,
      detected_country: doc.detectedCountry,
      document_date: doc.documentDate,
      expiry_date: doc.expiryDate,
      summary:
        documents.length > 1
          ? [ai.notes, doc.summary].filter(Boolean).join(' — ') || `${documents.length} documents in this scan`
          : doc.summary || ai.notes || null,
      confidence: doc.confidence,
      issue,
      status: statuses.status,
      classification_status: statuses.classificationStatus,
      activity: pushActivity(src.activity, classifiedLabel),
    })
    .eq('id', src.id);

  return {
    success: true,
    documentId: src.id,
    split: false,
    documentCount: documents.length,
    documentType,
    suggestedFilename,
  };
}

module.exports = {
  classifySmartScanDocument,
  splitPdf,
  normalizeRanges,
  buildFilename,
  normalizeType,
};
