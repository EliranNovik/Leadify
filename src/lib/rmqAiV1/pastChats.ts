import { supabase } from '../supabase';
import { getRmqAiCurrentLead } from '../rmqAiChatContext';
import {
  chatSummarySearchText,
  parseChatSummary,
} from './chatSummary';
import type { ChatSummary, PastChatHit } from './types';

type HistoryRow = {
  id: string;
  title?: string;
  summary?: string | null;
  tags?: string[] | null;
  lead_id?: string | null;
  updated_at?: string;
  created_at?: string;
  messages?: Array<{ role?: string; content?: unknown }>;
};

function messageBlob(messages: HistoryRow['messages']): string {
  return (messages || [])
    .map((message) => {
      if (typeof message.content === 'string') return message.content;
      if (Array.isArray(message.content)) {
        return message.content.map((part: { text?: string }) => part?.text || '').join(' ');
      }
      return '';
    })
    .join(' ');
}

function snippetAround(text: string, query: string, max = 180): string {
  const hay = text.replace(/\s+/g, ' ').trim();
  if (!hay) return '';
  const needle = query.trim();
  const index = needle ? hay.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (index < 0) return hay.slice(0, max);
  const start = Math.max(0, index - 40);
  return `${start > 0 ? '…' : ''}${hay.slice(start, start + max)}${hay.length > start + max ? '…' : ''}`;
}

function scoreRow(row: HistoryRow, query: string, activeLeadId?: string | null, activeLeadNumber?: string): {
  score: number;
  matchReason: PastChatHit['matchReason'];
  snippet: string;
} {
  const title = String(row.title || '');
  const summary = parseChatSummary(row.summary);
  const summaryText = chatSummarySearchText(summary || row.summary);
  const messages = messageBlob(row.messages);
  const q = query.trim().toLowerCase();
  const leadNumber = summary?.leadNumbers?.[0] || '';

  if (activeLeadId && row.lead_id && String(row.lead_id) === String(activeLeadId)) {
    return { score: 100, matchReason: 'lead', snippet: summary?.summary || title };
  }
  if (activeLeadNumber && (leadNumber === activeLeadNumber || summaryText.includes(activeLeadNumber) || title.includes(activeLeadNumber))) {
    return { score: 90, matchReason: 'lead', snippet: summary?.summary || title };
  }
  if (q && title.toLowerCase().includes(q)) {
    return { score: 70, matchReason: 'title', snippet: snippetAround(title, query) };
  }
  if (q && summaryText.toLowerCase().includes(q)) {
    return { score: 60, matchReason: 'summary', snippet: snippetAround(summaryText, query) };
  }
  if (q && messages.toLowerCase().includes(q)) {
    return { score: 40, matchReason: 'message', snippet: snippetAround(messages, query) };
  }
  if (!q && (activeLeadId || activeLeadNumber)) {
    return { score: 10, matchReason: 'summary', snippet: summary?.summary || title };
  }
  return { score: 0, matchReason: 'message', snippet: '' };
}

export async function searchMyPastChats(input: {
  query?: string;
  conversationId?: string;
  limit?: number;
}): Promise<PastChatHit[]> {
  const open = getRmqAiCurrentLead();
  const activeLeadId = open?.id != null ? String(open.id) : null;
  const activeLeadNumber = open?.lead_number ? String(open.lead_number) : '';
  const query = String(input.query || '').trim();
  const limit = Math.min(8, Math.max(1, input.limit || 5));

  // Embeddings are deferred until this FTS / lead-first ranking is not enough.
  const { data: rpcData, error: rpcError } = await supabase.rpc('search_my_past_chats', {
    p_query: query,
    p_lead_id: activeLeadId && !String(activeLeadId).startsWith('legacy_') ? activeLeadId : null,
    p_lead_number: activeLeadNumber || null,
    p_limit: limit,
  });

  if (!rpcError && Array.isArray(rpcData) && rpcData.length > 0) {
    return rpcData.map((row: Record<string, unknown>) => ({
      date: String(row.updated_at || row.created_at || ''),
      title: String(row.title || 'Untitled'),
      summary: parseChatSummary(row.summary) || String(row.summary || ''),
      matchingSnippet: String(row.matching_snippet || row.snippet || ''),
      conversationId: String(row.id),
      leadNumber: row.lead_number ? String(row.lead_number) : undefined,
      matchReason: (row.match_reason as PastChatHit['matchReason']) || 'summary',
    }));
  }

  let request = supabase
    .from('ai_chat_history')
    .select('id, title, summary, tags, lead_id, updated_at, created_at, messages')
    .eq('is_archived', false)
    .order('updated_at', { ascending: false })
    .limit(40);

  if (input.conversationId) {
    request = request.eq('id', input.conversationId);
  }

  const { data, error } = await request;
  if (error || !data) return [];

  return (data as HistoryRow[])
    .map((row) => {
      const scored = scoreRow(row, query, activeLeadId, activeLeadNumber);
      const summary = parseChatSummary(row.summary);
      return {
        date: String(row.updated_at || row.created_at || ''),
        title: String(row.title || 'Untitled'),
        summary: summary || String(row.summary || ''),
        matchingSnippet: scored.snippet,
        conversationId: row.id,
        leadNumber: summary?.leadNumbers?.[0],
        matchReason: scored.matchReason,
        _score: scored.score,
      };
    })
    .filter((row) => row._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score, ...hit }) => hit);
}

export async function getPastChat(conversationId: string): Promise<{
  conversationId: string;
  title: string;
  summary: ChatSummary | string | null;
  messages: Array<{ role: string; content: string }>;
} | null> {
  const id = String(conversationId || '').trim();
  if (!id) return null;
  const { data, error } = await supabase
    .from('ai_chat_history')
    .select('id, title, summary, messages')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  const messages = ((data.messages as Array<{ role?: string; content?: unknown }>) || [])
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: String(message.role),
      content:
        typeof message.content === 'string'
          ? message.content
          : Array.isArray(message.content)
            ? message.content.map((part: { text?: string }) => part?.text || '').join('\n')
            : '',
    }))
    .filter((message) => message.content && !['AI is thinking...', 'Looking up CRM data...'].includes(message.content));
  return {
    conversationId: data.id,
    title: String(data.title || 'Untitled'),
    summary: parseChatSummary(data.summary) || data.summary || null,
    messages,
  };
}

export async function fetchRelatedChatForOpenLead(): Promise<PastChatHit | null> {
  const open = getRmqAiCurrentLead();
  if (!open?.id && !open?.lead_number) return null;
  const hits = await searchMyPastChats({ query: String(open.lead_number || ''), limit: 1 });
  return hits[0] || null;
}
