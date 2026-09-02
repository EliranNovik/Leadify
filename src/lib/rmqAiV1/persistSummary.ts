import { supabase } from '../supabase';
import { getRmqAiCurrentLead } from '../rmqAiChatContext';
import { heuristicChatSummary, serializeChatSummary, tagsFromSummary, type ChatSummary } from './chatSummary';
import { ingestMemoriesFromChat } from './memory';

export async function persistStructuredChatSummary(
  chatId: string,
  messages: Array<{ role?: string; content?: unknown }>,
  opts?: { attachOpenLead?: boolean },
): Promise<ChatSummary | null> {
  if (!chatId) return null;
  const attachOpenLead = opts?.attachOpenLead !== false;
  const summary = heuristicChatSummary(messages, { includeOpenLead: attachOpenLead });
  const tags = tagsFromSummary(summary);
  const open = attachOpenLead ? getRmqAiCurrentLead() : null;
  const openLeadNumber = open?.lead_number ? String(open.lead_number) : '';
  const mentionsOpenLead = !openLeadNumber || summary.leadNumbers.includes(openLeadNumber);
  const leadId =
    attachOpenLead &&
    mentionsOpenLead &&
    open?.id &&
    !String(open.id).startsWith('legacy_') &&
    String(open.id).includes('-')
      ? String(open.id)
      : null;
  const payload = serializeChatSummary(summary);

  const { error: rpcError } = await supabase.rpc('update_ai_chat_summary', {
    p_chat_id: chatId,
    p_summary: payload,
    p_tags: tags,
    p_lead_id: leadId,
  });
  if (rpcError) {
    await supabase
      .from('ai_chat_history')
      .update({
        summary: payload,
        tags,
        ...(leadId ? { lead_id: leadId } : {}),
      })
      .eq('id', chatId);
  }
  if (attachOpenLead) {
    void ingestMemoriesFromChat({
      messages,
      conversationId: chatId,
      workingNote: summary.summary,
    });
  }
  return summary;
}

export async function backfillMissingChatSummaries(limit = 40): Promise<number> {
  const { data, error } = await supabase
    .from('ai_chat_history')
    .select('id, messages, summary')
    .eq('is_archived', false)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error || !data) return 0;
  let written = 0;
  for (const row of data) {
    if (String(row.summary || '').trim()) continue;
    const messages = (row.messages || []) as Array<{ role?: string; content?: unknown }>;
    if (messages.length < 2) continue;
    const summary = await persistStructuredChatSummary(row.id, messages, { attachOpenLead: false });
    if (summary) written += 1;
  }
  return written;
}
