import { supabase } from '../supabase';
import type { MemoryDurability, MemoryPolicy, UserMemoryCategory } from './types';

export type AiUserMemoryRow = {
  id: string;
  fact: string;
  category: UserMemoryCategory;
  source_type?: string;
  confidence?: number;
  evidence_count?: number;
  durability?: MemoryDurability;
  expires_at?: string | null;
  active?: boolean;
  supersedes_memory_id?: string | null;
};

const MEMORY_POLICY_BY_CATEGORY: Record<UserMemoryCategory, MemoryPolicy> = {
  tone: 'allowed',
  language: 'allowed',
  format: 'allowed',
  workflow: 'allowed',
  preference: 'allowed',
};

export function memoryPolicyFor(category: UserMemoryCategory): MemoryPolicy {
  return MEMORY_POLICY_BY_CATEGORY[category] || 'explicit_only';
}

function normalizeFact(fact: string): string {
  return fact.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function similarFacts(a: string, b: string): boolean {
  const left = new Set(normalizeFact(a).split(' ').filter((word) => word.length > 3));
  const right = new Set(normalizeFact(b).split(' ').filter((word) => word.length > 3));
  if (left.size === 0 || right.size === 0) return normalizeFact(a) === normalizeFact(b);
  let overlap = 0;
  for (const word of left) if (right.has(word)) overlap += 1;
  return overlap / Math.min(left.size, right.size) >= 0.7;
}

export async function listActiveUserMemories(limit = 12): Promise<AiUserMemoryRow[]> {
  const { data, error } = await supabase
    .from('ai_user_memory')
    .select('id, fact, category, source_type, confidence, evidence_count, durability, expires_at, active, supersedes_memory_id')
    .eq('active', true)
    .order('updated_at', { ascending: false })
    .limit(40);
  if (error || !data) return [];
  const now = Date.now();
  return (data as AiUserMemoryRow[])
    .filter((row) => !row.expires_at || Date.parse(row.expires_at) > now)
    .slice(0, limit);
}

export async function upsertUserMemory(input: {
  fact: string;
  category: UserMemoryCategory;
  sourceType?: string;
  sourceConversationId?: string;
  sourceMessageId?: string;
  durability?: MemoryDurability;
  expiresAt?: string | null;
  explicit?: boolean;
  supersedesMemoryId?: string | null;
}): Promise<{ id: string; reinforced?: boolean } | null> {
  const policy = memoryPolicyFor(input.category);
  if (policy === 'blocked') return null;
  if (policy === 'explicit_only' && !input.explicit) return null;

  const existing = await listActiveUserMemories(40);
  const match = existing.find((row) => similarFacts(row.fact, input.fact));
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return null;

  if (match) {
    await supabase
      .from('ai_user_memory')
      .update({
        evidence_count: (match.evidence_count || 1) + 1,
        confidence: Math.min(1, (match.confidence || 0.5) + 0.05),
        updated_at: new Date().toISOString(),
      })
      .eq('id', match.id);
    return { id: match.id, reinforced: true };
  }

  if (input.supersedesMemoryId) {
    await supabase
      .from('ai_user_memory')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', input.supersedesMemoryId);
  } else {
    const opposite = existing.find(
      (row) =>
        row.category === input.category &&
        /concise|short|brief/.test(input.fact.toLowerCase()) &&
        /detail|long|thorough/.test(row.fact.toLowerCase()),
    );
    if (opposite) {
      await supabase
        .from('ai_user_memory')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('id', opposite.id);
      input = { ...input, supersedesMemoryId: opposite.id };
    }
  }

  const { data, error } = await supabase
    .from('ai_user_memory')
    .insert({
      user_id: user.id,
      fact: input.fact.trim(),
      category: input.category,
      source_type: input.sourceType || 'explicit_user',
      source_conversation_id: input.sourceConversationId || null,
      source_message_id: input.sourceMessageId || null,
      confidence: 0.7,
      evidence_count: 1,
      durability: input.durability || 'long_term',
      expires_at: input.expiresAt || null,
      active: true,
      supersedes_memory_id: input.supersedesMemoryId || null,
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('ai_user_memory insert failed', error);
    return null;
  }
  return { id: data.id };
}

export async function forgetUserMemory(query: string): Promise<number> {
  const memories = await listActiveUserMemories(40);
  const needle = query.toLowerCase();
  const matches = memories.filter(
    (row) => row.fact.toLowerCase().includes(needle) || similarFacts(row.fact, query),
  );
  if (matches.length === 0) return 0;
  const { error } = await supabase
    .from('ai_user_memory')
    .update({ active: false, updated_at: new Date().toISOString() })
    .in(
      'id',
      matches.map((row) => row.id),
    );
  return error ? 0 : matches.length;
}

export function isForgetMemoryRequest(text: string): boolean {
  return /\b(don'?t remember|do not remember|forget (that|this|the) preference|forget that|stop remembering)\b/i.test(
    text,
  );
}

export async function proposeFirmLesson(fact: string): Promise<void> {
  const clean = fact.trim();
  if (clean.length < 12) return;
  const { data } = await supabase
    .from('ai_firm_lesson_candidates')
    .select('id, evidence_count, fact')
    .eq('status', 'pending')
    .limit(40);
  const match = (data || []).find((row) => similarFacts(String(row.fact), clean));
  if (match) {
    await supabase
      .from('ai_firm_lesson_candidates')
      .update({ evidence_count: (match.evidence_count || 1) + 1, updated_at: new Date().toISOString() })
      .eq('id', match.id);
    return;
  }
  const { error: candidateError } = await supabase
    .from('ai_firm_lesson_candidates')
    .insert({ fact: clean, evidence_count: 1, status: 'pending' });
  if (candidateError) console.error('ai_firm_lesson_candidates insert failed', candidateError);

  const { data: existingFirm } = await supabase
    .from('ai_firm_memory')
    .select('id, fact')
    .eq('active', false)
    .limit(40);
  const firmMatch = (existingFirm || []).find((row) => similarFacts(String(row.fact), clean));
  if (firmMatch) return;
  const { error: firmError } = await supabase.from('ai_firm_memory').insert({
    fact: clean,
    category: 'lesson',
    source_type: 'chat',
    active: false,
    confidence: 0.4,
    evidence_count: 1,
  });
  if (firmError) console.error('ai_firm_memory insert failed', firmError);
}

export async function listFirmLessonCandidates() {
  const { data, error } = await supabase
    .from('ai_firm_lesson_candidates')
    .select('id, fact, evidence_count, status, created_at')
    .eq('status', 'pending')
    .order('evidence_count', { ascending: false })
    .limit(20);
  if (error || !data) return [];
  return data as Array<{ id: string; fact: string; evidence_count: number; status: string }>;
}

export async function reviewFirmLesson(id: string, status: 'approved' | 'rejected', fact?: string) {
  await supabase
    .from('ai_firm_lesson_candidates')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (status === 'approved') {
    const approvedFact = (fact || '').trim() || 'Approved lesson';
    const { data: pending } = await supabase
      .from('ai_firm_memory')
      .select('id, fact')
      .eq('active', false)
      .limit(40);
    const match = (pending || []).find((row) => similarFacts(String(row.fact), approvedFact));
    if (match) {
      await supabase
        .from('ai_firm_memory')
        .update({
          active: true,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', match.id);
    } else {
      await supabase.from('ai_firm_memory').insert({
        fact: approvedFact,
        source_type: 'admin',
        active: true,
        approved_at: new Date().toISOString(),
      });
    }
  }
}

function categorizeMemory(raw: string): UserMemoryCategory {
  if (/hebrew|english|german|language|עברית|deutsch/i.test(raw)) return 'language';
  if (/short|concise|brief|long|detail|bullet|format/i.test(raw)) return 'format';
  if (/tone|formal|friendly|warm|casual|polite/i.test(raw)) return 'tone';
  if (/follow[- ]?up|workflow|after meeting|when i/i.test(raw)) return 'workflow';
  return 'preference';
}

export function isFirmWideLesson(text: string): string | null {
  const raw = text.trim();
  if (
    !/\b(we always|our (team|firm|process|policy)|everyone (should|must)|the (standard|policy|rule) is|company (policy|rule)|rmq always)\b/i.test(
      raw,
    )
  ) {
    return null;
  }
  return raw.slice(0, 220);
}

function isCannedAsk(text: string): boolean {
  return /\bCall [a-z_]+\b/.test(text) || /\bUse CRM tools\b/i.test(text);
}

function userTextsFromMessages(messages: Array<{ role?: string; content?: unknown }>): string[] {
  const texts: string[] = [];
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const content = message.content;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map((part: { text?: string }) => part?.text || '').join(' ')
          : '';
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean) texts.push(clean);
  }
  return texts;
}

function styleMemoriesFromText(text: string): Array<{ fact: string; category: UserMemoryCategory }> {
  if (isCannedAsk(text)) return [];
  const found: Array<{ fact: string; category: UserMemoryCategory }> = [];
  if (/\b(long (reply|draft|email)|profesional|professional reply|formal reply)\b/i.test(text)) {
    found.push({ fact: 'Prefers long professional client replies', category: 'tone' });
  }
  if (/\b(short|concise|brief)\b/i.test(text) && /\b(reply|draft|email|answer)\b/i.test(text)) {
    found.push({ fact: 'Prefers short concise replies', category: 'format' });
  }
  if (/\b(hebrew|עברית)\b/i.test(text) && /\b(reply|draft|email|write|whatsapp)\b/i.test(text)) {
    found.push({ fact: 'Prefers Hebrew for client drafts', category: 'language' });
  }
  if (/\bwhatsapp\b/i.test(text) && /\b(draft|reply|send|write)\b/i.test(text)) {
    found.push({ fact: 'Prefers WhatsApp for client replies', category: 'workflow' });
  }
  return found;
}

export function isPreferenceCorrection(text: string): { fact: string; category: UserMemoryCategory } | null {
  const raw = text.trim();
  if (raw.length < 8 || isForgetMemoryRequest(raw)) return null;
  const fact = raw.replace(/^(hey[, ]+|please\s+)/i, '').slice(0, 180);

  if (/\b(don'?t|never|stop) (write|use|say|start with).{8,}/i.test(raw)) {
    return { fact, category: 'tone' };
  }
  if (
    /\b(remember( that| this| to)?|please remember|keep in mind|note that|don'?t forget|from now on|going forward)\b/i.test(
      raw,
    )
  ) {
    return { fact, category: categorizeMemory(raw) };
  }
  if (/\b(i prefer|i want you to|i always want)\b.{6,}/i.test(raw)) {
    return { fact, category: categorizeMemory(raw) };
  }
  if (
    /\b(always|never)\b.{6,}/i.test(raw) &&
    /\b(write|draft|use|say|keep|start|reply|answer|hebrew|english|german|short|concise|brief|formal|friendly)\b/i.test(
      raw,
    )
  ) {
    return { fact, category: categorizeMemory(raw) };
  }
  const style = styleMemoriesFromText(raw)[0];
  if (style) return style;
  return null;
}

export async function ingestMemoriesFromChat(input: {
  messages: Array<{ role?: string; content?: unknown }>;
  conversationId?: string | null;
  workingNote?: string | null;
}): Promise<void> {
  const userTexts = userTextsFromMessages(input.messages);
  const lastUser = userTexts[userTexts.length - 1] || '';
  const seen = new Set<string>();

  const add = async (
    fact: string,
    category: UserMemoryCategory,
    extra?: { sourceType?: string; durability?: MemoryDurability; expiresAt?: string | null; explicit?: boolean },
  ) => {
    const key = fact.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    await upsertUserMemory({
      fact,
      category,
      sourceType: extra?.sourceType || 'inferred',
      sourceConversationId: input.conversationId || undefined,
      durability: extra?.durability,
      expiresAt: extra?.expiresAt,
      explicit: extra?.explicit,
    });
  };

  const preference = lastUser ? isPreferenceCorrection(lastUser) : null;
  if (preference) {
    await add(preference.fact, preference.category, { sourceType: 'feedback', explicit: true });
  }
  for (const text of userTexts.slice(-4)) {
    for (const style of styleMemoriesFromText(text)) {
      await add(style.fact, style.category, { sourceType: 'inferred' });
    }
  }
  const note = String(input.workingNote || '').replace(/\s+/g, ' ').trim();
  if (note.length >= 12) {
    const expires = new Date();
    expires.setDate(expires.getDate() + 30);
    await add(`Recent work: ${note.slice(0, 180)}`, 'workflow', {
      sourceType: 'chat_summary',
      durability: 'temporary',
      expiresAt: expires.toISOString(),
    });
  }
  if (lastUser) {
    const firm = isFirmWideLesson(lastUser);
    if (firm) await proposeFirmLesson(firm);
  }
}
