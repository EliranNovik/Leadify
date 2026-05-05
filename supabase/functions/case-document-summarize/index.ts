import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { encode as base64Encode } from 'https://deno.land/std@0.177.0/encoding/base64.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.8';
import { corsHeaders } from '../_shared/cors.ts';
import { supabase as supabaseService } from '../_shared/supabase-client.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const CASE_DOCS_BUCKET = 'lead-sub-efforts-documents';
const CASE_DOC_SUMMARY_SECRET = Deno.env.get('CASE_DOC_SUMMARY_SECRET') || '';

type SummarizeBody = { documentId?: string; force?: boolean };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function inferMimeFromFileName(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    txt: 'text/plain',
    csv: 'text/csv',
    md: 'text/markdown',
    json: 'application/json',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return map[ext] ?? 'application/octet-stream';
}

function safeFileName(name: string): string {
  const n = name.trim().replace(/[^\w.\-()\s]/g, '_').slice(0, 200);
  return n || 'document';
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

/** Types OpenAI Responses `input_file` accepts (plus plain text we send as file). */
function supportsResponsesFile(mime: string): boolean {
  if (mime === 'application/pdf') return true;
  if (mime === 'text/plain' || mime === 'text/csv' || mime === 'text/markdown') return true;
  if (
    mime === 'application/msword' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return true;
  }
  if (
    mime === 'application/vnd.ms-excel' ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return true;
  }
  if (
    mime === 'application/vnd.ms-powerpoint' ||
    mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    return true;
  }
  return false;
}

function extractResponsesOutputText(data: Record<string, unknown>): string {
  const direct = data.output_text;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const out = data.output;
  if (!Array.isArray(out)) return '';
  const texts: string[] = [];
  for (const block of out) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    const content = b.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;
      if (p.type === 'output_text' && typeof p.text === 'string') texts.push(p.text);
    }
  }
  return texts.join('\n').trim();
}

const SUMMARY_SYSTEM =
  'You summarize documents for a legal and immigration CRM. Be accurate, neutral, and concise. ' +
  'Use plain text only: short paragraphs, no markdown, no bullet symbols. ' +
  'Cover: what the document is, key facts, dates and parties if visible, and any action items. ' +
  'If the content is illegible or empty, say so briefly.';

const SUMMARY_USER_PREFIX =
  'Summarize the attached document for a case file. Title/filename for context: ';

async function summarizeImage(bytes: Uint8Array, mime: string, fileName: string): Promise<string> {
  const b64 = base64Encode(bytes);
  const dataUrl = `data:${mime};base64,${b64}`;
  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0.25,
      max_tokens: 1200,
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: `${SUMMARY_USER_PREFIX}"${fileName}".` },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: { message?: string } })?.error?.message || res.statusText;
    throw new Error(`OpenAI chat: ${msg}`);
  }
  const text = (data as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message
    ?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('Empty summary from model');
  return text.trim();
}

async function summarizeWithResponses(bytes: Uint8Array, mime: string, fileName: string): Promise<string> {
  const b64 = base64Encode(bytes);
  const dataUrl = `data:${mime};base64,${b64}`;
  const fname = safeFileName(fileName);

  const res = await fetch(RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                `${SUMMARY_SYSTEM}\n\n${SUMMARY_USER_PREFIX}"${fileName}". Provide the summary now.`,
            },
            { type: 'input_file', filename: fname, file_data: dataUrl },
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
  if (!text) throw new Error('Empty summary from model (responses)');
  return text;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (!OPENAI_API_KEY) {
    return json({ error: 'Server misconfigured: missing OPENAI_API_KEY' }, 500);
  }

  const authHeader = req.headers.get('Authorization') || '';
  const secretHeader = req.headers.get('x-case-doc-summary-secret') || '';
  const isServiceRequest =
    CASE_DOC_SUMMARY_SECRET &&
    secretHeader &&
    secretHeader === CASE_DOC_SUMMARY_SECRET;

  if (!isServiceRequest && !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Missing or invalid authorization' }, 401);
  }

  let body: SummarizeBody;
  try {
    body = (await req.json()) as SummarizeBody;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const documentId = typeof body.documentId === 'string' ? body.documentId.trim() : '';
  if (!documentId) return json({ error: 'documentId is required' }, 400);
  const force = body.force === true;

  const supabaseUser = isServiceRequest
    ? supabaseService
    : (() => {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
        if (!supabaseUrl || !supabaseAnon) {
          throw new Error('Server misconfigured: Supabase env');
        }
        return createClient(supabaseUrl, supabaseAnon, {
          global: { headers: { Authorization: authHeader } },
        });
      })();

  const { data: row, error: rowErr } = await supabaseUser
    .from('lead_case_documents')
    .select(
      'id, storage_path, file_name, mime_type, ai_summary_status',
    )
    .eq('id', documentId)
    .maybeSingle();

  if (rowErr || !row) {
    return json({ error: rowErr?.message || 'Document not found' }, 404);
  }

  const rec = row as {
    id: string;
    storage_path: string | null;
    file_name: string;
    mime_type: string | null;
    ai_summary_status: string | null;
  };

  if (!rec.storage_path?.trim()) {
    return json({ error: 'No storage file for this record' }, 400);
  }

  if (rec.ai_summary_status === 'ready' && !force) {
    return json({ success: true, cached: true });
  }

  const nowIso = new Date().toISOString();

  await supabaseUser
    .from('lead_case_documents')
    .update({
      ai_summary_status: 'pending',
      ai_summary_error: null,
      ai_summary_at: nowIso,
    })
    .eq('id', documentId);

  try {
    const { data: blob, error: dlErr } = await supabaseUser.storage
      .from(CASE_DOCS_BUCKET)
      .download(rec.storage_path.trim());

    if (dlErr || !blob) {
      throw new Error(dlErr?.message || 'Download failed');
    }

    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);

    let mime =
      (typeof rec.mime_type === 'string' && rec.mime_type.trim()) ||
      inferMimeFromFileName(rec.file_name || '');
    mime = mime.toLowerCase();

    if (mime === 'application/octet-stream') {
      mime = inferMimeFromFileName(rec.file_name || '');
    }

    let summary: string;

    if (isImageMime(mime)) {
      summary = await summarizeImage(bytes, mime, rec.file_name || 'image');
    } else if (supportsResponsesFile(mime)) {
      summary = await summarizeWithResponses(bytes, mime, rec.file_name || 'document');
    } else {
      await supabaseUser
        .from('lead_case_documents')
        .update({
          ai_summary: null,
          ai_summary_status: 'skipped',
          ai_summary_error: 'This file type is not supported for automatic AI summary.',
          ai_summary_at: new Date().toISOString(),
        })
        .eq('id', documentId);
      return json({ success: true, skipped: true });
    }

    await supabaseUser
      .from('lead_case_documents')
      .update({
        ai_summary: summary,
        ai_summary_status: 'ready',
        ai_summary_error: null,
        ai_summary_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    return json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabaseUser
      .from('lead_case_documents')
      .update({
        ai_summary_status: 'failed',
        ai_summary_error: msg.slice(0, 2000),
        ai_summary_at: new Date().toISOString(),
      })
      .eq('id', documentId);
    return json({ success: false, error: msg }, 500);
  }
});
