import { supabase } from './supabase';

export type AiInputSuggestKind = 'phrase' | 'word' | 'employee' | 'office' | 'lead' | 'date' | 'history';

export type AiInputSuggestion = {
  id: string;
  label: string;
  hint: string;
  kind: AiInputSuggestKind;
  score: number;
  replace: 'token' | 'all';
};

const OFFICES = ['Ramat Gan', 'Jerusalem', 'Home', 'Ramat Gan office', 'Jerusalem office'];

const DATE_WORDS = [
  'today',
  'tomorrow',
  'yesterday',
  'this week',
  'last week',
  'this month',
  'last month',
  'last 7 days',
  'last 30 days',
];

const WORDS = [
  'available',
  'availability',
  'unavailable',
  'unavailability',
  'employees',
  'employee',
  'office',
  'clocked in',
  'clocked out',
  'clock in',
  'clock out',
  'excel',
  'spreadsheet',
  'export',
  'closer',
  'scheduler',
  'signed',
  'contracts',
  'meetings',
  'lead',
  'summarize',
  'Ramat Gan',
  'Jerusalem',
];

const PHRASES = [
  'who is available now in the Ramat Gan office',
  'who is available now in the Jerusalem office',
  'who is clocked in right now',
  'who clocked out today',
  'where did they clock in',
  'create an excel of who is available now in the Ramat Gan office',
  'export that list to excel',
  'how many signed today',
  'how many signed this week',
  'how many signed this month',
  'who closed deals today',
  'who has meetings today',
  'who has meetings tomorrow',
  'summarize this lead',
  'look up lead',
  'who is the handler of',
  'who is the case handler of',
  'where can I find',
  'where is the calendar',
  'where are working hours',
  'where do I add an expense',
  'take me to HR management',
];

const LEAD_RE = /\b([LC]\d+(?:\/\d+)?)|\b(\d{4,}\/\d+)|\b(\d{5,7})\b/g;

let employeeNameCache: string[] | null = null;
let employeeLoad: Promise<string[]> | null = null;

export async function loadAutocompleteEmployeeNames(): Promise<string[]> {
  if (employeeNameCache) return employeeNameCache;
  if (!employeeLoad) {
    employeeLoad = (async () => {
      const { data, error } = await supabase
        .from('tenants_employee')
        .select('display_name')
        .not('display_name', 'is', null)
        .limit(1500);
      if (error) {
        employeeLoad = null;
        return [];
      }
      employeeNameCache = Array.from(
        new Set(
          (data || [])
            .map((row: { display_name?: string | null }) => String(row.display_name || '').trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      return employeeNameCache;
    })();
  }
  return employeeLoad;
}

export function tokenRange(text: string, caret: number): { start: number; end: number; value: string } {
  const pos = Math.max(0, Math.min(caret, text.length));
  let start = pos;
  while (start > 0 && !/\s/.test(text[start - 1])) start -= 1;
  let end = pos;
  while (end < text.length && !/\s/.test(text[end])) end += 1;
  return { start, end, value: text.slice(start, end) };
}

export function extractConversationHints(
  messages: Array<{ role?: string; content?: unknown }>,
): { leads: string[]; names: string[] } {
  const leads = new Set<string>();
  const names = new Set<string>();
  for (const message of messages) {
    const text = messageText(message.content);
    if (!text) continue;
    const leadRe = new RegExp(LEAD_RE.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = leadRe.exec(text)) !== null) {
      const lead = String(match[1] || match[2] || match[3] || '').trim();
      if (lead) leads.add(lead);
    }
    if (message.role === 'assistant') {
      for (const line of text.split('\n')) {
        const person = line.match(/^\s*\d+\.\s+([A-Za-z][A-Za-z .'-]{1,40})(?:\s+[·(]|$)/);
        if (person?.[1]) names.add(person[1].trim());
      }
    }
  }
  return { leads: Array.from(leads).slice(0, 20), names: Array.from(names).slice(0, 20) };
}

export function applyAiInputSuggestion(
  input: string,
  caret: number,
  suggestion: AiInputSuggestion,
): { next: string; caret: number } {
  if (suggestion.replace === 'all') {
    return { next: suggestion.label, caret: suggestion.label.length };
  }
  const token = tokenRange(input, caret);
  const next = `${input.slice(0, token.start)}${suggestion.label}${input.slice(token.end)}`;
  const nextCaret = token.start + suggestion.label.length;
  return { next, caret: nextCaret };
}

export function ghostSuffixFor(input: string, caret: number, suggestion: AiInputSuggestion | null): string {
  if (!suggestion) return '';
  const trimmed = input.trimStart();
  if (suggestion.replace === 'all') {
    const prefix = input.slice(0, caret);
    if (suggestion.label.toLowerCase().startsWith(prefix.toLowerCase())) {
      return suggestion.label.slice(prefix.length);
    }
    if (suggestion.label.toLowerCase().startsWith(trimmed.toLowerCase()) && caret >= input.length) {
      return suggestion.label.slice(trimmed.length);
    }
    return '';
  }
  const token = tokenRange(input, caret);
  if (caret < token.end) return '';
  if (suggestion.label.toLowerCase().startsWith(token.value.toLowerCase()) && token.value) {
    return suggestion.label.slice(token.value.length);
  }
  return '';
}

export function scoreRmqAiInputSuggestions(args: {
  input: string;
  caret: number;
  employees: string[];
  conversationLeads?: string[];
  conversationNames?: string[];
  historyTitles?: string[];
  lastAssistant?: string;
}): AiInputSuggestion[] {
  const input = args.input;
  const caret = args.caret;
  const token = tokenRange(input, caret);
  const tokenNorm = normalize(token.value);
  const fullNorm = normalize(input.slice(0, caret).trim());
  if (tokenNorm.length < 2 && fullNorm.length < 2) return [];

  const lastAssistant = normalize(args.lastAssistant || '');
  const before = normalize(input.slice(0, token.start));
  const wantsName = /\b(by|closer|scheduler|employee|did|where)\b/.test(before);
  const wantsOffice = /\b(in|at|office|ramat|jerusalem|home)\b/.test(`${before} ${tokenNorm}`);
  const wantsDate = /\b(today|tomorrow|yesterday|week|month|signed|meetings|closed)\b/.test(`${before} ${fullNorm}`);
  const wantsExport = /\b(excel|spreadsheet|export|sheet|table)\b/.test(`${fullNorm} ${lastAssistant}`);
  const presenceContext = /\b(available|clock|office|presence|ramat|jerusalem)\b/.test(`${fullNorm} ${lastAssistant}`);
  const dealsContext = /\b(signed|closed|contract|closer)\b/.test(`${fullNorm} ${lastAssistant}`);
  const meetingContext = /\b(meeting|scheduler)\b/.test(`${fullNorm} ${lastAssistant}`);

  const scored: AiInputSuggestion[] = [];

  if (fullNorm.length >= 2) {
    for (const phrase of PHRASES) {
      const score = phraseScore(fullNorm, phrase);
      if (score < 62) continue;
      let boost = 0;
      if (presenceContext && /available|clock|office|excel/.test(phrase)) boost += 8;
      if (dealsContext && /signed|closed/.test(phrase)) boost += 8;
      if (meetingContext && /meeting/.test(phrase)) boost += 8;
      if (wantsExport && /excel|export/.test(phrase)) boost += 10;
      scored.push({
        id: `phrase:${phrase}`,
        label: phrase,
        hint: 'Ask',
        kind: 'phrase',
        score: score + boost,
        replace: 'all',
      });
    }
  }

  if (tokenNorm.length >= 2) {
    for (const word of WORDS) {
      const score = tokenScore(tokenNorm, word);
      if (score < 70) continue;
      scored.push({
        id: `word:${word}`,
        label: word,
        hint: 'Word',
        kind: 'word',
        score,
        replace: 'token',
      });
    }
    for (const office of OFFICES) {
      const score = tokenScore(tokenNorm, office) + (wantsOffice ? 10 : 0);
      if (score < 68) continue;
      scored.push({
        id: `office:${office}`,
        label: office,
        hint: 'Office',
        kind: 'office',
        score,
        replace: 'token',
      });
    }
    for (const date of DATE_WORDS) {
      const score = tokenScore(tokenNorm, date) + (wantsDate ? 8 : 0);
      if (score < 72) continue;
      scored.push({
        id: `date:${date}`,
        label: date,
        hint: 'Date',
        kind: 'date',
        score,
        replace: 'token',
      });
    }
    for (const name of args.employees) {
      const score = tokenScore(tokenNorm, name) + (wantsName ? 10 : 0);
      if (score < 76) continue;
      scored.push({
        id: `employee:${name}`,
        label: name,
        hint: 'Employee',
        kind: 'employee',
        score,
        replace: 'token',
      });
    }
    for (const name of args.conversationNames || []) {
      const score = tokenScore(tokenNorm, name) + 4;
      if (score < 74) continue;
      scored.push({
        id: `mentioned:${name}`,
        label: name,
        hint: 'In chat',
        kind: 'employee',
        score,
        replace: 'token',
      });
    }
    for (const lead of args.conversationLeads || []) {
      const score = tokenScore(tokenNorm, lead) + (lead.toLowerCase().startsWith(tokenNorm) ? 12 : 0);
      if (score < 70) continue;
      scored.push({
        id: `lead:${lead}`,
        label: lead,
        hint: 'Lead',
        kind: 'lead',
        score,
        replace: 'token',
      });
    }
  }

  if (fullNorm.length >= 3) {
    for (const title of args.historyTitles || []) {
      const score = phraseScore(fullNorm, title);
      if (score < 78) continue;
      scored.push({
        id: `history:${title}`,
        label: title,
        hint: 'Recent',
        kind: 'history',
        score,
        replace: 'all',
      });
    }
  }

  const unique = new Map<string, AiInputSuggestion>();
  for (const item of scored.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))) {
    const key = `${item.replace}:${normalize(item.label)}`;
    if (unique.has(key)) continue;
    if (item.replace === 'token' && normalize(item.label) === tokenNorm) continue;
    if (item.replace === 'all' && normalize(item.label) === fullNorm) continue;
    unique.set(key, item);
    if (unique.size >= 7) break;
  }
  return Array.from(unique.values());
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text || '') : ''))
    .join(' ');
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenScore(query: string, candidate: string): number {
  const target = normalize(candidate);
  if (!query || !target) return 0;
  if (target === query) return 100;
  if (target.startsWith(query)) return 92 - Math.min(10, target.length - query.length);
  const words = target.split(' ');
  if (words.some((word) => word.startsWith(query))) return 86;
  if (target.includes(query)) return 74;
  if (query.length >= 5 && editDistance(query, target) <= 1) return 84;
  if (query.length >= 5 && words.some((word) => word.length >= 5 && editDistance(query, word) <= 1)) return 80;
  return 0;
}

function phraseScore(query: string, phrase: string): number {
  const target = normalize(phrase);
  if (!query || !target) return 0;
  if (target === query) return 100;
  if (target.startsWith(query)) return 94 - Math.min(8, Math.floor((target.length - query.length) / 6));
  const qWords = query.split(' ').filter(Boolean);
  const tWords = target.split(' ');
  if (qWords.length && qWords.every((word, index) => tWords[index]?.startsWith(word) || tWords.includes(word))) {
    return 80;
  }
  if (target.includes(query)) return 70;
  return 0;
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 99;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const prev = new Array(cols).fill(0).map((_, i) => i);
  const next = new Array(cols).fill(0);
  for (let i = 1; i < rows; i += 1) {
    next[0] = i;
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(prev[j] + 1, next[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j < cols; j += 1) prev[j] = next[j];
  }
  return prev[b.length];
}
