import { supabase } from '../supabase';

export type KnowledgeKind = 'fact' | 'procedure';
export type KnowledgeTopicScope = 'global' | 'country' | 'authority' | 'procedure' | 'case_type';

export type KnowledgeFileRow = {
  id: string;
  title: string;
  scope: 'firm' | 'user';
  status: 'draft' | 'approved' | 'superseded';
  owner?: string | null;
  version?: string | null;
  reviewed_at?: string | null;
  expires_at?: string | null;
  knowledge_kind?: KnowledgeKind | null;
  topic_scope?: KnowledgeTopicScope | null;
  country?: string | null;
  authority?: string | null;
  case_type?: string | null;
  verified_by?: string | null;
  verified_at?: string | null;
  last_checked_at?: string | null;
  review_after?: string | null;
  source_urls?: unknown;
  source_authority?: string | null;
  origin?: string | null;
};

export type KnowledgeHit = {
  title: string;
  content: string;
  documentVersion?: string;
  chunkId?: string;
  knowledgeKind?: KnowledgeKind;
  topicScope?: KnowledgeTopicScope;
  verifiedBy?: string;
  verifiedAt?: string;
  lastCheckedAt?: string;
  reviewAfter?: string;
  needsReverification?: boolean;
  sourceUrls?: string[];
  origin?: string;
};

function chunkText(text: string, size = 900): string[] {
  const clean = text.replace(/\r/g, '').trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    chunks.push(clean.slice(i, i + size));
    i += size - 80;
  }
  return chunks.filter((chunk) => chunk.trim().length > 20);
}


const KNOWLEDGE_STOP = new Set([
  'the', 'a', 'an', 'our', 'we', 'us', 'is', 'are', 'in', 'for', 'to', 'of', 'and', 'or', 'do',
  'i', 'you', 'what', 'where', 'how', 'again', 'check', 'please', 'me', 'my', 'from', 'this',
  'that', 'type', 'kind', 'any', 'have', 'has', 'with', 'about', 'your',
]);

const OFFICE_TERMS = [
  'office',
  'address',
  'location',
  'street',
  'ramat',
  'gan',
  'jerusalem',
  'phone',
  'tel',
  'משרד',
  'כתובת',
  'רמת',
  'גן',
  'ירושלים',
];

function knowledgeTerms(query: string): string[] {
  const raw = query.toLowerCase();
  const tokens = raw
    .split(/[^a-z0-9\u0590-\u05ff]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !KNOWLEDGE_STOP.has(token));
  const extra: string[] = [];
  if (/office|address|adress|location|where\b|משרד|כתובת/.test(raw)) {
    extra.push(...OFFICE_TERMS.map((term) => term.trim()));
  }
  if (/ramat|gan|רמת/.test(raw)) extra.push('ramat', 'gan', 'רמת', 'גן');
  if (/jerusalem|ירושל/.test(raw)) extra.push('jerusalem', 'ירושלים');
  return [...new Set([...tokens, ...extra])].slice(0, 16);
}

function isReviewDue(reviewAfter?: string | null): boolean {
  if (!reviewAfter) return false;
  const ts = Date.parse(reviewAfter);
  return Number.isFinite(ts) && ts <= Date.now();
}

function sourceUrlList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((item) => String(item || '')).filter(Boolean);
  return [];
}

function provenanceFromFile(file?: {
  knowledge_kind?: string | null;
  topic_scope?: string | null;
  verified_by?: string | null;
  verified_at?: string | null;
  last_checked_at?: string | null;
  review_after?: string | null;
  source_urls?: unknown;
  origin?: string | null;
} | null): Partial<KnowledgeHit> {
  if (!file) return {};
  return {
    knowledgeKind: file.knowledge_kind === 'procedure' ? 'procedure' : file.knowledge_kind === 'fact' ? 'fact' : undefined,
    topicScope:
      file.topic_scope === 'country' ||
      file.topic_scope === 'authority' ||
      file.topic_scope === 'procedure' ||
      file.topic_scope === 'case_type' ||
      file.topic_scope === 'global'
        ? file.topic_scope
        : undefined,
    verifiedBy: file.verified_by || undefined,
    verifiedAt: file.verified_at || undefined,
    lastCheckedAt: file.last_checked_at || undefined,
    reviewAfter: file.review_after || undefined,
    needsReverification: isReviewDue(file.review_after),
    sourceUrls: sourceUrlList(file.source_urls),
    origin: file.origin || undefined,
  };
}

function scoreKnowledgeText(title: string, content: string, terms: string[]): number {
  const hay = `${title}\n${content}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!term || !hay.includes(term.toLowerCase())) continue;
    score += term.length >= 4 ? 2 : 1;
  }
  return score;
}

function mapRpcHits(rows: unknown): KnowledgeHit[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row: Record<string, unknown>) => ({
      title: String(row.title || 'Knowledge'),
      content: String(row.content || ''),
      documentVersion: row.document_version ? String(row.document_version) : undefined,
      chunkId: row.chunk_id ? String(row.chunk_id) : undefined,
    }))
    .filter((hit) => hit.content.trim());
}

async function rpcKnowledgeHits(query: string, limit: number): Promise<KnowledgeHit[]> {
  const { data, error } = await supabase.rpc('search_firm_knowledge', {
    p_query: query,
    p_limit: limit,
  });
  if (error) return [];
  return mapRpcHits(data);
}

export async function searchFirmKnowledge(query: string, limit = 6): Promise<KnowledgeHit[]> {
  const q = query.trim();
  if (!q) return [];
  const terms = knowledgeTerms(q);
  const seen = new Map<string, KnowledgeHit>();
  const addHits = (hits: KnowledgeHit[]) => {
    for (const hit of hits) {
      const key = hit.chunkId || `${hit.title}:${hit.content.slice(0, 80)}`;
      if (!seen.has(key)) seen.set(key, hit);
    }
  };

  addHits(await rpcKnowledgeHits(q, limit));
  if (seen.size < limit) {
    const extraQueries = [...new Set([
      terms.includes('office') || terms.includes('address') || terms.includes('משרד') ? 'office address' : '',
      terms.includes('ramat') || terms.includes('gan') || terms.includes('רמת') ? 'Ramat Gan' : '',
      terms.includes('jerusalem') || terms.includes('ירושלים') ? 'Jerusalem office' : '',
      terms.includes('כתובת') || terms.includes('משרד') ? 'כתובת משרד' : '',
      ...terms.filter((term) => term.length >= 3).slice(0, 6),
    ].filter(Boolean))];
    for (const extra of extraQueries) {
      if (seen.size >= limit) break;
      addHits(await rpcKnowledgeHits(extra, limit));
    }
  }

  const { data: files } = await supabase
    .from('ai_knowledge_files')
    .select(
      'id, title, version, status, expires_at, knowledge_kind, topic_scope, verified_by, verified_at, last_checked_at, review_after, source_urls, origin',
    )
    .in('status', ['approved', 'draft'])
    .limit(40);
  const liveFiles = (files || []).filter((file) => !file.expires_at || Date.parse(file.expires_at) > Date.now());
  const fileIds = liveFiles.map((file) => file.id);
  const fileTitle = new Map(liveFiles.map((file) => [file.id, file]));

  if (fileIds.length && (seen.size < limit || terms.length)) {
    const chunkMap = new Map<string, { id: string; file_id: string; content: string }>();
    const searchTerms = (terms.length ? terms : [q]).filter((term) => term.length >= 2).slice(0, 8);
    for (const term of searchTerms) {
      const { data: chunks } = await supabase
        .from('ai_knowledge_chunks')
        .select('id, file_id, content')
        .in('file_id', fileIds)
        .ilike('content', `%${term.replace(/[%_]/g, '')}%`)
        .limit(30);
      for (const chunk of chunks || []) {
        chunkMap.set(String(chunk.id), chunk as { id: string; file_id: string; content: string });
      }
    }
    if (chunkMap.size === 0) {
      const { data: chunks } = await supabase
        .from('ai_knowledge_chunks')
        .select('id, file_id, content')
        .in('file_id', fileIds)
        .limit(200);
      for (const chunk of chunks || []) {
        chunkMap.set(String(chunk.id), chunk as { id: string; file_id: string; content: string });
      }
    }
    const scored = [...chunkMap.values()]
      .map((chunk) => {
        const file = fileTitle.get(chunk.file_id);
        const title = file?.title || 'Knowledge';
        return {
          title,
          content: String(chunk.content || '').slice(0, 800),
          documentVersion: file?.version || undefined,
          chunkId: chunk.id,
          ...provenanceFromFile(file),
          score:
            scoreKnowledgeText(title, String(chunk.content || ''), terms.length ? terms : [q.toLowerCase()]) +
            (file?.status === 'approved' ? 2 : 0) +
            (isReviewDue(file?.review_after) ? -2 : 1),
        };
      })
      .filter((row) => row.score > 0 || terms.length === 0)
      .sort((a, b) => b.score - a.score);
    addHits(scored);
  }

  const byTitle = new Map(liveFiles.map((file) => [String(file.title || ''), file]));
  const ranked = [...seen.values()]
    .map((hit) => {
      const file = byTitle.get(hit.title);
      return {
        ...hit,
        ...(!hit.verifiedBy ? provenanceFromFile(file) : {}),
        score:
          scoreKnowledgeText(hit.title, hit.content, terms.length ? terms : [q.toLowerCase()]) +
          (file && isReviewDue(file.review_after) ? -1 : 0),
      };
    })
    .sort((a, b) => b.score - a.score)
    .filter((hit) => hit.score > 0 || seen.size === 1)
    .slice(0, limit)
    .map(({ score: _score, ...hit }) => hit);

  return ranked;
}

export async function ingestKnowledgeText(input: {
  title: string;
  text: string;
  scope?: 'firm' | 'user';
}): Promise<{ fileId: string; chunks: number } | null> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return null;
  const chunks = chunkText(input.text);
  if (chunks.length === 0) return null;
  const { data: file, error } = await supabase
    .from('ai_knowledge_files')
    .insert({
      title: input.title.trim() || 'Untitled',
      scope: input.scope || 'user',
      user_id: input.scope === 'firm' ? null : user.id,
      status: input.scope === 'firm' ? 'draft' : 'approved',
      owner: user.email || user.id,
      version: '1',
      reviewed_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || !file) return null;
  const rows = chunks.map((content, chunk_index) => ({
    file_id: file.id,
    chunk_index,
    content,
  }));
  const { error: chunkError } = await supabase.from('ai_knowledge_chunks').insert(rows);
  if (chunkError) return { fileId: file.id, chunks: 0 };
  return { fileId: file.id, chunks: rows.length };
}

export async function listKnowledgeFiles(): Promise<KnowledgeFileRow[]> {
  const { data, error } = await supabase
    .from('ai_knowledge_files')
    .select(
      'id, title, scope, status, owner, version, reviewed_at, expires_at, knowledge_kind, topic_scope, country, authority, case_type, verified_by, verified_at, last_checked_at, review_after, source_urls, source_authority, origin',
    )
    .order('created_at', { ascending: false })
    .limit(40);
  if (error || !data) return [];
  return data as KnowledgeFileRow[];
}

export async function getKnowledgePreview(fileId: string): Promise<string> {
  const { data, error } = await supabase
    .from('ai_knowledge_chunks')
    .select('content, chunk_index')
    .eq('file_id', fileId)
    .order('chunk_index', { ascending: true })
    .limit(4);
  if (error || !data) return '';
  return data.map((row) => String(row.content || '')).join('\n\n').slice(0, 1600);
}

export async function promoteKnowledgeToFirm(fileId: string): Promise<boolean> {
  const { error } = await supabase
    .from('ai_knowledge_files')
    .update({
      scope: 'firm',
      user_id: null,
      status: 'approved',
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', fileId);
  return !error;
}

export async function setKnowledgeStatus(
  fileId: string,
  status: 'approved' | 'superseded',
): Promise<boolean> {
  const { error } = await supabase
    .from('ai_knowledge_files')
    .update({ status, reviewed_at: new Date().toISOString() })
    .eq('id', fileId);
  return !error;
}

export async function deleteKnowledgeFile(fileId: string): Promise<boolean> {
  const { error } = await supabase.from('ai_knowledge_files').delete().eq('id', fileId);
  return !error;
}

export function knowledgeNeedsReview(file: KnowledgeFileRow): boolean {
  return isReviewDue(file.review_after);
}

function asUrlList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return asUrlList(parsed);
    } catch {
      return value.trim() ? [value.trim()] : [];
    }
  }
  return [];
}

function normalizeMatchUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

function urlsOverlap(left: string[], right: string[]): boolean {
  if (!left.length || !right.length) return false;
  const set = new Set(left.map(normalizeMatchUrl));
  const hits = right.filter((url) => set.has(normalizeMatchUrl(url))).length;
  return hits >= (right.length >= 2 && left.length >= 2 ? 2 : 1);
}

export async function persistResearchFeedback(input: {
  conversationId?: string | null;
  messageId?: string | null;
  rating: 'useful' | 'wrong';
  summary?: string;
  sourceUrls?: string[];
}): Promise<boolean> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return false;
  const row = {
    user_id: user.id,
    conversation_id: input.conversationId || null,
    message_id: input.messageId || null,
    rating: input.rating,
    summary: (input.summary || '').slice(0, 2000) || null,
    source_urls: (input.sourceUrls || []).slice(0, 12),
  };
  if (input.messageId) {
    const { data: existing } = await supabase
      .from('rmq_ai_research_feedback')
      .select('id')
      .eq('user_id', user.id)
      .eq('message_id', input.messageId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      const { error } = await supabase.from('rmq_ai_research_feedback').update(row).eq('id', existing.id);
      return !error;
    }
  }
  const { error } = await supabase.from('rmq_ai_research_feedback').insert(row);
  return !error;
}

export async function loadResearchCardState(input: {
  conversationId?: string | null;
  messageId?: string | null;
  sourceUrls?: string[];
}): Promise<{ rating: 'useful' | 'wrong' | null; saved: boolean }> {
  const user = (await supabase.auth.getUser()).data.user;
  const sourceUrls = (input.sourceUrls || []).filter(Boolean).slice(0, 12);
  let rating: 'useful' | 'wrong' | null = null;
  let saved = false;

  if (user) {
    const pickRating = (rows: Array<{ rating?: string | null; source_urls?: unknown }> | null, requireUrls: boolean) => {
      const match = (rows || []).find((row) => {
        if (!requireUrls) return row.rating === 'useful' || row.rating === 'wrong';
        return urlsOverlap(asUrlList(row.source_urls), sourceUrls);
      });
      return match?.rating === 'useful' || match?.rating === 'wrong' ? match.rating : null;
    };

    if (input.messageId) {
      const { data } = await supabase
        .from('rmq_ai_research_feedback')
        .select('rating, source_urls, created_at')
        .eq('user_id', user.id)
        .eq('message_id', input.messageId)
        .order('created_at', { ascending: false })
        .limit(1);
      rating = pickRating(data, false);
    }
    if (!rating && input.conversationId) {
      const { data } = await supabase
        .from('rmq_ai_research_feedback')
        .select('rating, source_urls, created_at')
        .eq('user_id', user.id)
        .eq('conversation_id', input.conversationId)
        .order('created_at', { ascending: false })
        .limit(20);
      rating = pickRating(data, sourceUrls.length > 0);
    }
  }

  if (sourceUrls.length) {
    const { data: files } = await supabase
      .from('ai_knowledge_files')
      .select('source_urls')
      .eq('origin', 'web_research')
      .eq('status', 'approved')
      .order('verified_at', { ascending: false })
      .limit(40);
    saved = (files || []).some((file) => urlsOverlap(asUrlList(file.source_urls), sourceUrls));
  }

  return { rating, saved };
}

export async function promoteWebResearchToKnowledge(input: {
  title: string;
  summary: string;
  kind: KnowledgeKind;
  topicScope: KnowledgeTopicScope;
  country?: string;
  authority?: string;
  caseType?: string;
  reviewAfterDays: number;
  sources: Array<{ title?: string; url: string; domain?: string; authorityLevel?: string }>;
}): Promise<{ fileId: string } | null> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return null;
  const title = input.title.replace(/\bL\d{4,}(?:\/\d+)?\b/gi, '').replace(/\s+/g, ' ').trim() || 'Verified public research';
  const sources = input.sources.filter((src) => /^https?:\/\//i.test(src.url)).slice(0, 8);
  const sourceLines = sources
    .map((src) => `- ${src.title || src.domain || src.url} — ${src.url}${src.authorityLevel ? ` (${src.authorityLevel})` : ''}`)
    .join('\n');
  const now = new Date();
  const reviewAfter = new Date(now.getTime() + Math.max(30, input.reviewAfterDays) * 86400000);
  const text = [
    `KIND: ${input.kind === 'procedure' ? 'office procedure' : 'official fact'}`,
    `SCOPE: ${input.topicScope}`,
    input.country ? `COUNTRY: ${input.country.trim()}` : '',
    input.authority ? `AUTHORITY: ${input.authority.trim()}` : '',
    input.caseType ? `CASE TYPE: ${input.caseType.trim()}` : '',
    '',
    'This is verified firm knowledge from reviewed public research.',
    'It is not a legal opinion and not a case-specific strategy.',
    '',
    input.summary.trim(),
    '',
    sourceLines ? `OFFICIAL SOURCES\n${sourceLines}` : '',
    '',
    `Verified by: ${user.email || user.id}`,
    `Verified: ${now.toISOString().slice(0, 10)}`,
    `Review after: ${reviewAfter.toISOString().slice(0, 10)}`,
  ]
    .filter((line) => line !== '')
    .join('\n');

  const chunks = chunkText(text);
  if (chunks.length === 0) return null;
  const { data: file, error } = await supabase
    .from('ai_knowledge_files')
    .insert({
      title,
      scope: 'firm',
      user_id: null,
      status: 'approved',
      owner: user.email || user.id,
      version: '1',
      knowledge_kind: input.kind,
      topic_scope: input.topicScope,
      country: input.country?.trim() || null,
      authority: input.authority?.trim() || null,
      case_type: input.caseType?.trim() || null,
      verified_by: user.email || user.id,
      verified_at: now.toISOString(),
      last_checked_at: now.toISOString(),
      review_after: reviewAfter.toISOString(),
      source_urls: sources.map((src) => src.url),
      source_authority: sources[0]?.authorityLevel || null,
      origin: 'web_research',
      reviewed_at: now.toISOString(),
    })
    .select('id')
    .single();
  if (error || !file) return null;
  const { error: chunkError } = await supabase.from('ai_knowledge_chunks').insert(
    chunks.map((content, chunk_index) => ({ file_id: file.id, chunk_index, content })),
  );
  if (chunkError) return { fileId: file.id };
  return { fileId: file.id };
}
