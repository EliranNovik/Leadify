import { supabase } from '../supabase';

export type KnowledgeFileRow = {
  id: string;
  title: string;
  scope: 'firm' | 'user';
  status: 'draft' | 'approved' | 'superseded';
  owner?: string | null;
  version?: string | null;
  reviewed_at?: string | null;
  expires_at?: string | null;
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

type KnowledgeHit = { title: string; content: string; documentVersion?: string; chunkId?: string };

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
    .select('id, title, version, status, expires_at')
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
        const title = fileTitle.get(chunk.file_id)?.title || 'Knowledge';
        return {
          title,
          content: String(chunk.content || '').slice(0, 800),
          documentVersion: fileTitle.get(chunk.file_id)?.version || undefined,
          chunkId: chunk.id,
          score: scoreKnowledgeText(title, String(chunk.content || ''), terms.length ? terms : [q.toLowerCase()]),
        };
      })
      .filter((row) => row.score > 0 || terms.length === 0)
      .sort((a, b) => b.score - a.score);
    addHits(scored);
  }

  const ranked = [...seen.values()]
    .map((hit) => ({
      ...hit,
      score: scoreKnowledgeText(hit.title, hit.content, terms.length ? terms : [q.toLowerCase()]),
    }))
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
    .select('id, title, scope, status, owner, version, reviewed_at, expires_at')
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
