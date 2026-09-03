import { supabase } from './supabase';
import { getRmqAiCurrentLead } from './rmqAiChatContext';

export type WebSearchCategory =
  | 'law'
  | 'archive'
  | 'government'
  | 'news'
  | 'address'
  | 'currency'
  | 'general';

export type WebSearchSource = {
  id: string;
  title: string;
  url: string;
  domain: string;
  sourceType?: string;
  authorityLevel?: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'X';
  publishedAt?: string | null;
  accessedAt?: string;
};

export type WebSearchCardData = {
  kind: 'web_search';
  untrusted: true;
  summary: string;
  confidence: 'confirmed' | 'strong' | 'uncertain';
  unresolvedQuestions: string[];
  sources: WebSearchSource[];
  category?: WebSearchCategory;
};

export function blockedTermsFromOpenLead(): string[] {
  const open = getRmqAiCurrentLead();
  if (!open) return [];
  const terms: string[] = [];
  const name = String(open.name || '').trim();
  if (name) {
    terms.push(name);
    for (const part of name.split(/\s+/)) {
      if (part.length >= 4) terms.push(part);
    }
  }
  if (open.email) terms.push(String(open.email));
  if (open.phone) terms.push(String(open.phone).replace(/\s+/g, ''));
  if (open.lead_number) terms.push(String(open.lead_number));
  return [...new Set(terms.map((item) => item.trim()).filter((item) => item.length >= 4))].slice(0, 16);
}

function normalizeSourceUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return url.split('#')[0].replace(/\/+$/, '');
  }
}

function titleLooksLikeDomain(title: string, domain: string): boolean {
  const cleanTitle = title.trim().toLowerCase().replace(/^www\./, '');
  const cleanDomain = domain.trim().toLowerCase().replace(/^www\./, '');
  return !cleanTitle || cleanTitle === cleanDomain;
}

function pageLabelFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    if (!last) return '';
    return decodeURIComponent(last)
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[-_]+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

/** One row per distinct page; collapse identical domain+title repeats. */
export function uniqueWebSources(sources: WebSearchSource[]): WebSearchSource[] {
  const byUrl = new Map<string, WebSearchSource>();
  for (const src of sources) {
    const key = normalizeSourceUrl(src.url);
    if (!byUrl.has(key)) byUrl.set(key, src);
  }

  const byLook = new Map<string, WebSearchSource>();
  for (const src of byUrl.values()) {
    const host = (src.domain || src.url.replace(/^https?:\/\//, '').split('/')[0] || '').toLowerCase();
    const title = titleLooksLikeDomain(src.title, host) ? pageLabelFromUrl(src.url) || host : src.title.trim();
    const lookKey = `${host}::${title.toLowerCase()}`;
    if (byLook.has(lookKey)) continue;
    byLook.set(lookKey, { ...src, title, domain: src.domain || host });
  }
  return [...byLook.values()];
}

export function parseWebSearchCard(raw: string): WebSearchCardData | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.error === 'WEB_SEARCH_CONTAINS_POSSIBLE_CLIENT_DATA') return null;
    const sources = Array.isArray(parsed.sources) ? parsed.sources : [];
    if (!parsed.untrusted && sources.length === 0 && !parsed.summary) return null;
    const category = String(parsed.category || '');
    const mapped = sources
      .map((row, index) => {
        if (!row || typeof row !== 'object') return null;
        const src = row as Record<string, unknown>;
        const url = String(src.url || '').trim();
        if (!url) return null;
        return {
          id: String(src.id || `src_${index + 1}`),
          title: String(src.title || src.domain || url),
          url,
          domain: String(src.domain || ''),
          sourceType: src.sourceType ? String(src.sourceType) : undefined,
          authorityLevel:
            src.authorityLevel === 'A' ||
            src.authorityLevel === 'B' ||
            src.authorityLevel === 'C' ||
            src.authorityLevel === 'D' ||
            src.authorityLevel === 'E' ||
            src.authorityLevel === 'F' ||
            src.authorityLevel === 'X'
              ? src.authorityLevel
              : undefined,
          publishedAt: typeof src.publishedAt === 'string' ? src.publishedAt : null,
          accessedAt: typeof src.accessedAt === 'string' ? src.accessedAt : undefined,
        };
      })
      .filter((row): row is WebSearchSource => Boolean(row));
    return {
      kind: 'web_search',
      untrusted: true,
      summary: String(parsed.summary || '').trim(),
      category:
        category === 'law' ||
        category === 'archive' ||
        category === 'government' ||
        category === 'news' ||
        category === 'address' ||
        category === 'currency' ||
        category === 'general'
          ? category
          : undefined,
      confidence:
        parsed.confidence === 'confirmed' || parsed.confidence === 'strong' || parsed.confidence === 'uncertain'
          ? parsed.confidence
          : 'uncertain',
      unresolvedQuestions: Array.isArray(parsed.unresolvedQuestions)
        ? parsed.unresolvedQuestions.map((item) => String(item)).filter(Boolean)
        : [],
      sources: uniqueWebSources(mapped),
    };
  } catch {
    return null;
  }
}

export async function executeWebSearch(args: {
  query?: string;
  reason?: string;
  category?: string;
  freshness?: string;
  requested_domains?: unknown;
  allowed_domains?: unknown;
}): Promise<string> {
  const query = String(args.query || '').trim();
  if (!query) {
    return JSON.stringify({
      error: 'WEB_SEARCH_MISSING_QUERY',
      instruction: 'Provide a public-facts query with no client identity.',
    });
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY;
  const open = getRmqAiCurrentLead();
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/web-search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query,
      reason: String(args.reason || '').slice(0, 240),
      category: args.category || 'general',
      freshness: args.freshness,
      requested_domains: args.requested_domains ?? args.allowed_domains,
      blocked_terms: blockedTermsFromOpenLead(),
      lead_id: open?.id != null ? String(open.id) : null,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const statusHint =
      response.status === 404
        ? 'The web-search function is not deployed.'
        : (data as { error?: string }).error || `Web search failed (${response.status})`;
    return JSON.stringify({
      error: statusHint,
      instruction: 'Say you could not verify the public fact. Do not invent sources.',
    });
  }
  const payload =
    data && typeof data === 'object' ? { ...(data as Record<string, unknown>), category: args.category || 'general' } : data;
  return JSON.stringify(payload);
}
