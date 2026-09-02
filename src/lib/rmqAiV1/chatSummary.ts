import { getRmqAiCurrentLead } from '../rmqAiChatContext';
import type { ChatSummary } from './types';

const LEAD_NUMBER_RE = /\bL?\d{5,}(?:\/\d+)?\b/gi;

export function parseChatSummary(raw: unknown): ChatSummary | null {
  if (!raw) return null;
  if (typeof raw === 'object' && raw && 'summary' in raw) {
    const row = raw as ChatSummary;
    return {
      summary: String(row.summary || ''),
      leadNumbers: Array.isArray(row.leadNumbers) ? row.leadNumbers.map(String) : [],
      people: Array.isArray(row.people) ? row.people.map(String) : [],
      topics: Array.isArray(row.topics) ? row.topics.map(String) : [],
      userGoal: row.userGoal ? String(row.userGoal) : undefined,
      decisions: Array.isArray(row.decisions) ? row.decisions.map(String) : undefined,
      unresolved: Array.isArray(row.unresolved) ? row.unresolved.map(String) : undefined,
    };
  }
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  if (text.startsWith('{')) {
    try {
      return parseChatSummary(JSON.parse(text));
    } catch {
      /* fall through */
    }
  }
  return {
    summary: text,
    leadNumbers: extractLeadNumbers(text),
    people: [],
    topics: [],
  };
}

export function formatChatHistoryPreview(raw: unknown, fallback = ''): string {
  const parsed = parseChatSummary(raw);
  let text = parsed?.summary || (typeof raw === 'string' ? raw : '') || fallback;
  text = text
    .replace(/^\s*\{[\s\S]*?"summary"\s*:\s*"/i, '')
    .replace(/[{}[\]"]/g, ' ')
    .replace(/\b(summary|leadNumbers|people|topics|userGoal|decisions|unresolved)\s*:/gi, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,:;]+|[\s.,:;]+$/g, '')
    .trim();
  return text;
}

export function serializeChatSummary(summary: ChatSummary): string {
  return JSON.stringify(summary);
}

export function chatSummarySearchText(summary: ChatSummary | string | null | undefined): string {
  const parsed = typeof summary === 'string' ? parseChatSummary(summary) : summary;
  if (!parsed) return '';
  return [
    parsed.summary,
    parsed.leadNumbers.join(' '),
    parsed.people.join(' '),
    parsed.topics.join(' '),
    parsed.userGoal,
    (parsed.decisions || []).join(' '),
    (parsed.unresolved || []).join(' '),
  ]
    .filter(Boolean)
    .join(' ');
}

export function extractLeadNumbers(text: string): string[] {
  const found = text.match(LEAD_NUMBER_RE) || [];
  return [...new Set(found.map((item) => item.replace(/^l/i, 'L')))];
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part: { text?: string }) => part?.text || '').join(' ');
  }
  return '';
}

function isGreetingText(text: string): boolean {
  return /^(hi|hello)\b.{0,80}how can i help/i.test(text);
}

function firstClause(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const beforeTool = clean.split(/\bCall\b|\.\s+Use CRM\b|\.\s+Read the full/i)[0]?.trim() || clean;
  const sentence = beforeTool.split(/(?<=[.!?])\s+/)[0] || beforeTool;
  return sentence.replace(/[.]+$/, '').slice(0, max);
}

function userAskLabel(text: string): string {
  return firstClause(text, 90);
}

function collectTopics(blob: string): string[] {
  const topics: string[] = [];
  if (/\bmeeting\b/i.test(blob)) topics.push('meeting');
  if (/\bcontract|sign|unsigned\b/i.test(blob)) topics.push('contract');
  if (/\bfollow[- ]?up|reminder\b/i.test(blob)) topics.push('follow-up');
  if (/\bdraft|email|whatsapp\b/i.test(blob)) topics.push('draft');
  if (/\b(clock|presence|available|office)\b/i.test(blob)) topics.push('presence');
  if (/\b(signed today|deals signed|who signed)\b/i.test(blob)) topics.push('signed');
  if (/\b(payment|proforma|invoice|paid)\b/i.test(blob)) topics.push('payment');
  if (/\b(expense|receipt)\b/i.test(blob)) topics.push('expenses');
  if (/\b(calendar|today'?s meetings)\b/i.test(blob)) topics.push('calendar');
  return topics;
}

export function heuristicChatSummary(
  messages: Array<{ role?: string; content?: unknown }>,
  opts?: { includeOpenLead?: boolean },
): ChatSummary {
  const includeOpenLead = opts?.includeOpenLead !== false;
  const texts: string[] = [];
  const userTexts: string[] = [];
  const assistantTexts: string[] = [];
  for (const message of messages) {
    const clean = messageText(message.content).replace(/\s+/g, ' ').trim();
    if (!clean || clean === 'AI is thinking...' || clean === 'Looking up CRM data...') continue;
    if (clean.startsWith('THINKING:')) continue;
    if (isGreetingText(clean)) continue;
    if (message.role === 'user') userTexts.push(clean);
    if (message.role === 'assistant') assistantTexts.push(clean);
    if (message.role === 'user' || message.role === 'assistant') texts.push(clean);
  }
  const blob = texts.join('\n');
  const open = includeOpenLead ? getRmqAiCurrentLead() : null;
  const leadNumbers = [
    ...extractLeadNumbers(blob),
    ...(open?.lead_number ? [String(open.lead_number)] : []),
  ];
  const people = open?.name ? [String(open.name)] : [];
  const asks = [...new Set(userTexts.map(userAskLabel).filter(Boolean))];
  const leadBit = [leadNumbers[0], people[0]].filter(Boolean).join(' ');
  const askBit = asks.slice(0, 3).join('; ') || firstClause(texts[0] || 'Conversation', 90);
  const summary = [leadBit, askBit].filter(Boolean).join(' — ').slice(0, 240);
  return {
    summary,
    leadNumbers: [...new Set(leadNumbers)].slice(0, 8),
    people: people.slice(0, 6),
    topics: collectTopics(blob).slice(0, 8),
    userGoal: (asks[asks.length - 1] || asks[0])?.slice(0, 160),
    unresolved: /\bunsigned|missing|didn't|cannot|can't\b/i.test(blob)
      ? ['Some items may still be open — confirm in CRM']
      : undefined,
  };
}

export function tagsFromSummary(summary: ChatSummary): string[] {
  return [...new Set([...summary.leadNumbers, ...summary.people, ...summary.topics])]
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function shouldRefreshChatSummary(input: {
  visibleMessageCount: number;
  lastSummarizedCount: number;
  idleMs: number;
  closed?: boolean;
  force?: boolean;
  subjectChanged?: boolean;
}): boolean {
  if (input.visibleMessageCount < 2) return false;
  const newMessages = input.visibleMessageCount - input.lastSummarizedCount;
  if (input.force && newMessages > 0) return true;
  if (input.closed && newMessages > 0) return true;
  if (input.subjectChanged && newMessages > 0) return true;
  if (newMessages >= 2) return true;
  if (newMessages > 0 && input.idleMs >= 4_000) return true;
  return false;
}

export function subjectChanged(
  previous: ChatSummary | null,
  messages: Array<{ role?: string; content?: unknown }>,
): boolean {
  if (!previous) return false;
  const next = heuristicChatSummary(messages);
  const prevLead = previous.leadNumbers[0] || '';
  const nextLead = next.leadNumbers[0] || '';
  return Boolean(prevLead && nextLead && prevLead !== nextLead);
}
