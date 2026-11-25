import { supabase } from '../supabase';

export type ChatGuideCategory = 'rule' | 'behavior' | 'service';

export type ChatGuideRow = {
  id: string;
  category: ChatGuideCategory;
  title: string;
  body: string;
  is_active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
};

const GUIDE_LABEL: Record<ChatGuideCategory, string> = {
  rule: 'RULES — follow these on every reply',
  behavior: 'BEHAVIOUR — how to talk and decide',
  service: 'SERVICE — what this assistant is for',
};

export async function listChatGuides(): Promise<ChatGuideRow[]> {
  const { data, error } = await supabase
    .from('ai_chat_guides')
    .select('id, category, title, body, is_active, sort_order, created_at, updated_at')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return data as ChatGuideRow[];
}

export async function saveChatGuide(input: {
  id?: string | null;
  category: ChatGuideCategory;
  title: string;
  body: string;
}): Promise<{ ok: boolean; missingTable?: boolean }> {
  const title = input.title.replace(/\s+/g, ' ').trim();
  const body = input.body.trim();
  if (!title || !body) return { ok: false };
  const payload = {
    category: input.category,
    title: title.slice(0, 160),
    body: body.slice(0, 4000),
    updated_at: new Date().toISOString(),
  };
  const query = input.id
    ? supabase.from('ai_chat_guides').update(payload).eq('id', input.id)
    : supabase.from('ai_chat_guides').insert({ ...payload, is_active: true });
  const { error } = await query;
  if (!error) return { ok: true };
  const missing = /ai_chat_guides|schema cache|does not exist/i.test(error.message || '');
  console.error('ai_chat_guides save failed', error);
  return { ok: false, missingTable: missing };
}

export async function setChatGuideActive(id: string, isActive: boolean): Promise<boolean> {
  const { error } = await supabase
    .from('ai_chat_guides')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id);
  return !error;
}

export async function deleteChatGuide(id: string): Promise<boolean> {
  const { error } = await supabase.from('ai_chat_guides').delete().eq('id', id);
  return !error;
}

/** Active admin guides, ready to append to the chat system prompt. Empty when the table is missing. */
export async function activeChatGuidePrompt(): Promise<string> {
  const { data, error } = await supabase
    .from('ai_chat_guides')
    .select('category, title, body, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(40);
  if (error || !data || data.length === 0) return '';

  const sections = (['rule', 'behavior', 'service'] as const)
    .map((category) => {
      const rows = (data as Array<{ category: string; title: string; body: string }>).filter(
        (row) => row.category === category && String(row.body || '').trim(),
      );
      if (rows.length === 0) return '';
      const lines = rows.map((row) => `- ${String(row.title).trim()}: ${String(row.body).replace(/\s+/g, ' ').trim()}`);
      return `${GUIDE_LABEL[category]}\n${lines.join('\n')}`;
    })
    .filter(Boolean);

  if (sections.length === 0) return '';
  return [
    'ADMIN GUIDES FOR THIS ASSISTANT. Follow every active rule, behaviour note, and service description below on every reply. They control how you talk and what you offer. They do not replace CRM tools for live client facts, and they do not allow a write the tools refuse.',
    ...sections,
  ]
    .join('\n')
    .slice(0, 8000);
}
