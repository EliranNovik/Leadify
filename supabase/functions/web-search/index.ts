import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  detectPossibleClientData,
  isWebSearchCategory,
  PII_REJECT,
  resolveEffectiveDomains,
  runIsolatedWebSearch,
  runIsolatedWebSearchStream,
  type WebSearchCategory,
  type WebSearchFreshness,
  type WebSearchProgress,
} from '../_shared/webSearch.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_WEB_SEARCH_MODEL = Deno.env.get('OPENAI_WEB_SEARCH_MODEL') || 'gpt-5.6-sol';

type SearchBody = {
  query?: unknown;
  reason?: unknown;
  category?: unknown;
  freshness?: unknown;
  requested_domains?: unknown;
  allowed_domains?: unknown;
  blocked_terms?: unknown;
  lead_id?: unknown;
  /** Opt-in: stream page-by-page progress as SSE instead of returning one JSON body. */
  stream?: unknown;
};

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Wraps a producer in an SSE response. The status is always 200: the stream has already started by
 * the time a search can fail, so failures are reported as an `error` event instead of a status code.
 */
function sse(produce: (send: (event: string, data: unknown) => void) => void | Promise<void>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        await produce(send);
      } catch (error) {
        console.error('web-search sse producer failed', error);
        send('error', { error: error instanceof Error ? error.message : String(error) });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

function blockedTermsFrom(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => String(item || '').trim())
    .filter((item) => item.length >= 4 && item.length <= 80)
    .slice(0, 16);
}

async function userIdFromRequest(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') || '';
  const url = Deno.env.get('SUPABASE_URL') || '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!url || !anon || !auth) return null;
  try {
    const client = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data } = await client.auth.getUser();
    return data.user?.id || null;
  } catch {
    return null;
  }
}

async function logSearch(row: Record<string, unknown>) {
  const url = Deno.env.get('SUPABASE_URL') || '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !service) return;
  try {
    const admin = createClient(url, service);
    await admin.from('rmq_ai_web_search_log').insert(row);
  } catch (error) {
    console.error('web-search log failed', error);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }
  if (!OPENAI_API_KEY) {
    return json(500, { error: 'Server misconfigured: missing OPENAI_API_KEY' });
  }

  let body: SearchBody;
  try {
    body = (await req.json()) as SearchBody;
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const query = String(body.query || '').replace(/\s+/g, ' ').trim();
  const reason = String(body.reason || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  const category: WebSearchCategory = isWebSearchCategory(body.category) ? body.category : 'general';
  const freshness = (['current', 'recent', 'any'] as const).includes(body.freshness as WebSearchFreshness)
    ? (body.freshness as WebSearchFreshness)
    : undefined;
  const requested = body.requested_domains ?? body.allowed_domains;
  const effectiveDomains = resolveEffectiveDomains(category, requested, query);
  const blockedTerms = blockedTermsFrom(body.blocked_terms);
  const userId = await userIdFromRequest(req);
  const leadId = typeof body.lead_id === 'string' && body.lead_id.trim() ? body.lead_id.trim().slice(0, 80) : null;

  const wantsStream =
    body.stream === true || (req.headers.get('Accept') || '').includes('text/event-stream');

  const auditRow = (extra: Record<string, unknown>) => ({
    user_id: userId,
    lead_id: leadId,
    sanitized_query: query.slice(0, 400),
    reason: reason || null,
    category,
    requested_domains: Array.isArray(requested) ? requested.map(String).slice(0, 20) : [],
    effective_domains: effectiveDomains,
    pii_result: 'allow',
    pii_reason: null,
    ...extra,
  });

  const pii = detectPossibleClientData(query, blockedTerms);
  if (!pii.ok) {
    await logSearch({
      user_id: userId,
      lead_id: leadId,
      sanitized_query: query.slice(0, 400),
      reason: reason || null,
      category,
      requested_domains: Array.isArray(requested) ? requested.map(String).slice(0, 20) : [],
      effective_domains: effectiveDomains,
      pii_result: 'reject',
      pii_reason: pii.reason,
      source_urls: [],
      source_count: 0,
      search_count: 0,
      confidence: null,
      error: PII_REJECT.error,
    });
    // Streaming callers still expect their payload on the `result` event, not as a plain body.
    return wantsStream ? sse((send) => send('result', PII_REJECT)) : json(200, PII_REJECT);
  }

  if (wantsStream) {
    return sse(async (send) => {
      const runSearch = async () => {
        try {
          return await runIsolatedWebSearchStream({
            apiKey: OPENAI_API_KEY,
            query,
            category,
            freshness,
            effectiveDomains,
            model: OPENAI_WEB_SEARCH_MODEL,
            onProgress: (progress: WebSearchProgress) => send('progress', progress),
          });
        } catch (streamError) {
          // Streaming is a presentation upgrade, never a reason to lose the answer. Anything the
          // stream cannot deliver — an API that rejects `stream`, a dropped connection, a frame we
          // cannot parse — falls back to the request shape that was already in production.
          console.error('web-search stream failed, falling back', streamError);
          return await runIsolatedWebSearch({
            apiKey: OPENAI_API_KEY,
            query,
            category,
            freshness,
            effectiveDomains,
            model: OPENAI_WEB_SEARCH_MODEL,
          });
        }
      };
      try {
        const { result, searchCount } = await runSearch();
        await logSearch(
          auditRow({
            source_urls: result.sources.map((src) => src.url).slice(0, 20),
            source_count: result.sources.length,
            search_count: searchCount,
            confidence: result.confidence,
            error: null,
          }),
        );
        send('result', result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await logSearch(
          auditRow({
            source_urls: [],
            source_count: 0,
            search_count: 0,
            confidence: null,
            error: message.slice(0, 400),
          }),
        );
        send('error', { error: message });
      }
    });
  }

  try {
    const { result, searchCount } = await runIsolatedWebSearch({
      apiKey: OPENAI_API_KEY,
      query,
      category,
      freshness,
      effectiveDomains,
      model: OPENAI_WEB_SEARCH_MODEL,
    });
    await logSearch({
      user_id: userId,
      lead_id: leadId,
      sanitized_query: query.slice(0, 400),
      reason: reason || null,
      category,
      requested_domains: Array.isArray(requested) ? requested.map(String).slice(0, 20) : [],
      effective_domains: effectiveDomains,
      pii_result: 'allow',
      pii_reason: null,
      source_urls: result.sources.map((src) => src.url).slice(0, 20),
      source_count: result.sources.length,
      search_count: searchCount,
      confidence: result.confidence,
      error: null,
    });
    return json(200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logSearch({
      user_id: userId,
      lead_id: leadId,
      sanitized_query: query.slice(0, 400),
      reason: reason || null,
      category,
      requested_domains: Array.isArray(requested) ? requested.map(String).slice(0, 20) : [],
      effective_domains: effectiveDomains,
      pii_result: 'allow',
      pii_reason: null,
      source_urls: [],
      source_count: 0,
      search_count: 0,
      confidence: null,
      error: message.slice(0, 400),
    });
    return json(500, { error: message });
  }
});
