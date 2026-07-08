import { supabase } from './supabase';
import { consumeContractAiReviewSse } from './aiReviewStreaming';

export type LeadMeetingSummary = {
  id: number;
  meeting_date: string | null;
  meeting_time: string | null;
  meeting_location: string | null;
  summary: string;
};

type LeadRef = {
  id: string | number;
  lead_type?: string | null;
  name?: string | null;
  lead_number?: string | null;
};

type TiptapMark = { type: string; attrs?: Record<string, unknown> };
type TiptapNode = {
  type?: string;
  text?: string;
  marks?: TiptapMark[];
  content?: TiptapNode[];
  attrs?: Record<string, unknown>;
};
type TiptapDoc = { type: 'doc'; content: TiptapNode[] };

const B_OPEN = '[[B]]';
const B_CLOSE = '[[/B]]';
const I_OPEN = '[[I]]';
const I_CLOSE = '[[/I]]';
const U_OPEN = '[[U]]';
const U_CLOSE = '[[/U]]';
const S_OPEN = '[[S]]';
const S_CLOSE = '[[/S]]';

function isLegacyLead(client: LeadRef): boolean {
  const idStr = String(client.id);
  return idStr.startsWith('legacy_') || client.lead_type === 'legacy';
}

export async function fetchLeadMeetingSummaries(client: LeadRef): Promise<LeadMeetingSummary[]> {
  const base = supabase
    .from('meetings')
    .select('id, meeting_date, meeting_time, meeting_location, meeting_summary_notes')
    .not('meeting_summary_notes', 'is', null)
    .order('meeting_date', { ascending: true })
    .order('meeting_time', { ascending: true });

  const { data, error } = isLegacyLead(client)
    ? await base
        .eq('legacy_lead_id', String(client.id).replace(/^legacy_/, ''))
        .neq('meeting_summary_notes', '')
    : await base.eq('client_id', client.id).neq('meeting_summary_notes', '');

  if (error) {
    throw new Error(error.message || 'Failed to load meeting summaries');
  }

  return (data ?? [])
    .map((row) => ({
      id: row.id,
      meeting_date: row.meeting_date,
      meeting_time: row.meeting_time,
      meeting_location: row.meeting_location,
      summary: row.meeting_summary_notes?.trim() || '',
    }))
    .filter((row) => row.summary.length > 0);
}

export function formatMeetingSummariesForAi(summaries: LeadMeetingSummary[]): string {
  if (summaries.length === 0) return '';

  return summaries
    .map((m, index) => {
      const date = m.meeting_date || 'Unknown date';
      const time = m.meeting_time?.substring(0, 5) || '';
      const location = m.meeting_location?.trim() || '';
      const header = [`Meeting ${index + 1}`, date, time, location].filter(Boolean).join(' · ');
      return `${header}\n${m.summary}`;
    })
    .join('\n\n---\n\n');
}

function cloneDoc(doc: unknown): TiptapDoc {
  return JSON.parse(JSON.stringify(doc)) as TiptapDoc;
}

function serializeTextNode(node: TiptapNode): string {
  let text = node.text || '';
  if (!node.marks?.length) return text;

  for (const mark of node.marks) {
    if (mark.type === 'bold') text = `${B_OPEN}${text}${B_CLOSE}`;
    else if (mark.type === 'italic') text = `${I_OPEN}${text}${I_CLOSE}`;
    else if (mark.type === 'underline') text = `${U_OPEN}${text}${U_CLOSE}`;
    else if (mark.type === 'strike') text = `${S_OPEN}${text}${S_CLOSE}`;
    else if (mark.type === 'textStyle') {
      const fontSize = mark.attrs?.fontSize;
      const fontFamily = mark.attrs?.fontFamily;
      if (fontSize) text = `[[FS:${fontSize}]]${text}[[/FS]]`;
      else if (fontFamily) text = `[[FF:${String(fontFamily)}]]${text}[[/FF]]`;
    }
  }
  return text;
}

function serializeInline(content: TiptapNode[] | undefined): string {
  if (!content?.length) return '';
  return content
    .map((child) => {
      if (child.type === 'text') return serializeTextNode(child);
      if (child.type === 'hardBreak') return '\n';
      return serializeBlock(child);
    })
    .join('');
}

function serializeBlock(node: TiptapNode): string {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return serializeInline(node.content);
    case 'bulletList':
      return (node.content || [])
        .map((item) => `- ${serializeBlock(item).trim()}`)
        .join('\n');
    case 'orderedList':
      return (node.content || [])
        .map((item, index) => `${index + 1}. ${serializeBlock(item).trim()}`)
        .join('\n');
    case 'listItem':
      return serializeInline(node.content);
    case 'blockquote':
      return serializeInline(node.content);
    default:
      return serializeInline(node.content);
  }
}

/** Serialize TipTap JSON for AI while preserving inline formatting markers. */
export function tiptapJsonToAiText(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return '';
  const root = doc as TiptapDoc;
  if (root.type !== 'doc' || !Array.isArray(root.content)) return '';

  return root.content
    .map((block) => serializeBlock(block).trimEnd())
    .filter((block) => block.length > 0)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** @deprecated Use tiptapJsonToAiText — plain text drops formatting. */
export function tiptapJsonToPlainText(doc: unknown): string {
  return tiptapJsonToAiText(doc)
    .replace(/\[\[(?:\/)?[BIUS]|(?:\/)?FS:[^\]]+|(?:\/)?FF:[^\]]+\]\]/g, '')
    .replace(/\[\[\/(?:B|I|U|S|FS|FF)\]\]/g, '');
}

type MarkSpec = { type: string; attrs?: Record<string, unknown> };

function parseMarkedInline(text: string): TiptapNode[] {
  if (!text) return [];

  const nodes: TiptapNode[] = [];
  const markStack: MarkSpec[] = [];

  const tagPatterns: Array<{
    open: RegExp;
    close: RegExp;
    mark: (match: RegExpMatchArray) => MarkSpec;
  }> = [
    { open: /^\[\[B\]\]/, close: /^\[\[\/B\]\]/, mark: () => ({ type: 'bold' }) },
    { open: /^\[\[I\]\]/, close: /^\[\[\/I\]\]/, mark: () => ({ type: 'italic' }) },
    { open: /^\[\[U\]\]/, close: /^\[\[\/U\]\]/, mark: () => ({ type: 'underline' }) },
    { open: /^\[\[S\]\]/, close: /^\[\[\/S\]\]/, mark: () => ({ type: 'strike' }) },
    {
      open: /^\[\[FS:([^\]]+)\]\]/,
      close: /^\[\[\/FS\]\]/,
      mark: (m) => ({ type: 'textStyle', attrs: { fontSize: m[1] } }),
    },
    {
      open: /^\[\[FF:([^\]]+)\]\]/,
      close: /^\[\[\/FF\]\]/,
      mark: (m) => ({ type: 'textStyle', attrs: { fontFamily: m[1] } }),
    },
  ];

  const pushText = (value: string) => {
    if (!value) return;
    const node: TiptapNode = { type: 'text', text: value };
    if (markStack.length > 0) {
      node.marks = markStack.map((m) => ({
        ...m,
        attrs: m.attrs ? { ...m.attrs } : undefined,
      }));
    }
    nodes.push(node);
  };

  let i = 0;
  while (i < text.length) {
    if (text[i] === '\n') {
      nodes.push({ type: 'hardBreak' });
      i += 1;
      continue;
    }

    let matched = false;
    for (const pattern of tagPatterns) {
      const slice = text.slice(i);
      const closeMatch = slice.match(pattern.close);
      if (closeMatch && markStack.length > 0) {
        markStack.pop();
        i += closeMatch[0].length;
        matched = true;
        break;
      }
      const openMatch = slice.match(pattern.open);
      if (openMatch) {
        markStack.push(pattern.mark(openMatch));
        i += openMatch[0].length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    let nextSpecial = text.length;
    const specials = [
      '[[B]]', '[[/B]]', '[[I]]', '[[/I]]', '[[U]]', '[[/U]]', '[[S]]', '[[/S]]',
      '[[FS:', '[[/FS]]', '[[FF:', '[[/FF]]', '\n',
    ];
    for (const special of specials) {
      const idx = text.indexOf(special, i);
      if (idx !== -1 && idx < nextSpecial) nextSpecial = idx;
    }
    pushText(text.slice(i, nextSpecial));
    i = nextSpecial;
  }

  return nodes;
}

function parseBlockLine(line: string): TiptapNode | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const bulletMatch = trimmed.match(/^-\s+(.*)$/);
  if (bulletMatch) {
    const inline = parseMarkedInline(bulletMatch[1]);
    return {
      type: 'listItem',
      content: inline.length ? inline : [{ type: 'paragraph', content: [] }],
    };
  }

  const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
  if (orderedMatch) {
    const inline = parseMarkedInline(orderedMatch[1]);
    return {
      type: 'listItem',
      content: inline.length ? inline : [{ type: 'paragraph', content: [] }],
    };
  }

  return { type: 'paragraph', content: parseMarkedInline(trimmed) };
}

function markedAiTextToTiptapDoc(text: string): TiptapDoc {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return { type: 'doc', content: [{ type: 'paragraph' }] };

  const rawBlocks = normalized.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  const content: TiptapNode[] = [];

  for (const block of rawBlocks) {
    const lines = block.split('\n');
    const isBulletBlock = lines.every((line) => /^-\s+/.test(line.trim()));
    const isOrderedBlock = lines.every((line) => /^\d+\.\s+/.test(line.trim()));

    if (isBulletBlock || isOrderedBlock) {
      const items = lines
        .map((line) => parseBlockLine(line))
        .filter((node): node is TiptapNode => node !== null);
      content.push({
        type: isBulletBlock ? 'bulletList' : 'orderedList',
        content: items,
      });
      continue;
    }

    if (lines.length === 1) {
      const node = parseBlockLine(lines[0]);
      if (node) content.push(node);
    } else {
      const inlineParts: TiptapNode[] = [];
      lines.forEach((line, index) => {
        inlineParts.push(...parseMarkedInline(line));
        if (index < lines.length - 1) inlineParts.push({ type: 'hardBreak' });
      });
      content.push({ type: 'paragraph', content: inlineParts });
    }
  }

  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

function countMarkType(doc: unknown, markType: string): number {
  let count = 0;
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as TiptapNode;
    if (n.type === 'text' && n.marks?.some((m) => m.type === markType)) count += 1;
    n.content?.forEach(walk);
  };
  const root = doc as TiptapDoc;
  root.content?.forEach(walk);
  return count;
}

function extractMarkedPhrases(text: string, open: string, close: string): string[] {
  const phrases: string[] = [];
  const escapedOpen = open.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedClose = close.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${escapedOpen}([\\s\\S]*?)${escapedClose}`, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const phrase = match[1].trim();
    if (phrase) phrases.push(phrase);
  }
  return phrases;
}

function restoreFormattingMarkersFromOriginal(originalMarked: string, improved: string): string {
  let result = improved;
  const tagPairs: Array<[string, string]> = [
    [B_OPEN, B_CLOSE],
    [I_OPEN, I_CLOSE],
    [U_OPEN, U_CLOSE],
    [S_OPEN, S_CLOSE],
  ];

  for (const [open, close] of tagPairs) {
    const phrases = extractMarkedPhrases(originalMarked, open, close);
    for (const phrase of phrases.sort((a, b) => b.length - a.length)) {
      if (!phrase || result.includes(`${open}${phrase}${close}`)) continue;
      if (result.includes(phrase)) {
        result = result.replace(phrase, `${open}${phrase}${close}`);
      }
    }
  }

  const fsRegex = /\[\[FS:([^\]]+)\]\]([\s\S]*?)\[\[\/FS\]\]/g;
  let fsMatch: RegExpExecArray | null;
  while ((fsMatch = fsRegex.exec(originalMarked)) !== null) {
    const [, size, phrase] = fsMatch;
    const wrapped = `[[FS:${size}]]${phrase}[[/FS]]`;
    if (!result.includes(wrapped) && result.includes(phrase)) {
      result = result.replace(phrase, wrapped);
    }
  }

  return result;
}

function isInlineEditableBlock(node: TiptapNode): boolean {
  return node.type === 'paragraph' || node.type === 'heading' || node.type === 'blockquote';
}

function splitAiBlocks(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n\n+/)
    .map((b) => b.trim())
    .filter(Boolean);
}

function inlineNodesFromBlockText(blockText: string): TiptapNode[] {
  const lines = blockText.split('\n');
  const nodes: TiptapNode[] = [];
  lines.forEach((line, index) => {
    nodes.push(...parseMarkedInline(line));
    if (index < lines.length - 1) nodes.push({ type: 'hardBreak' });
  });
  return nodes;
}

/** Apply AI text while preserving the original TipTap block structure when possible. */
export function aiTextToTiptapDoc(aiText: string, originalDoc?: unknown): TiptapDoc {
  const originalMarked = originalDoc ? tiptapJsonToAiText(originalDoc) : '';
  const restoredText = originalMarked
    ? restoreFormattingMarkersFromOriginal(originalMarked, aiText)
    : aiText;

  if (originalDoc && typeof originalDoc === 'object') {
    const original = cloneDoc(originalDoc);
    const aiBlocks = splitAiBlocks(restoredText);
    const origBlocks = original.content || [];

    if (aiBlocks.length === origBlocks.length) {
      origBlocks.forEach((block, index) => {
        if (!isInlineEditableBlock(block)) return;
        block.content = inlineNodesFromBlockText(aiBlocks[index]);
      });
      return original;
    }
  }

  const parsed = markedAiTextToTiptapDoc(restoredText);

  if (originalDoc && countMarkType(parsed, 'bold') < countMarkType(originalDoc, 'bold')) {
    const doubleRestored = restoreFormattingMarkersFromOriginal(
      tiptapJsonToAiText(originalDoc),
      tiptapJsonToAiText(parsed),
    );
    return markedAiTextToTiptapDoc(doubleRestored);
  }

  return parsed;
}

/** @deprecated Use aiTextToTiptapDoc — strips formatting. */
export function plainTextToTiptapDoc(text: string): TiptapDoc {
  return markedAiTextToTiptapDoc(text);
}

export type ImproveContractInput = {
  leadId: string | number;
  currentContractText: string;
  meetingSummaries: string;
  clientName?: string | null;
  leadNumber?: string | null;
  userRemarks?: string | null;
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
};

export type ImproveContractResult = {
  intent: 'action';
  improvedContractText: string;
  changeSummary: string;
};

export type ContractAiQuestionResult = {
  intent: 'question';
  answer: string;
};

export type ContractAiChatResult = ImproveContractResult | ContractAiQuestionResult;

export async function improveContractWithMeetingSummaries(
  input: ImproveContractInput,
  onThinking?: (text: string) => void,
): Promise<ImproveContractResult> {
  const result = await invokeContractAi(input, onThinking);
  if (result.intent === 'question') {
    throw new Error('Expected contract changes but received a question response');
  }
  return result;
}

export async function sendContractAiChatMessage(
  input: ImproveContractInput & { userRemarks: string },
  onThinking?: (text: string) => void,
): Promise<ContractAiChatResult> {
  return invokeContractAi(input, onThinking);
}

function normalizeContractAiResult(data: Record<string, unknown>): ContractAiChatResult {
  if (data?.intent === 'question') {
    const answer =
      typeof data.answer === 'string' && data.answer.trim()
        ? data.answer.trim()
        : 'No answer returned.';
    return { intent: 'question', answer };
  }

  if (!data?.improvedContractText || typeof data.improvedContractText !== 'string') {
    throw new Error('AI returned an invalid contract');
  }

  const changeSummary =
    typeof data.changeSummary === 'string' && data.changeSummary.trim()
      ? data.changeSummary.trim()
      : 'Contract wording was improved based on meeting summaries.';

  return {
    intent: 'action',
    improvedContractText: data.improvedContractText.trim(),
    changeSummary,
  };
}

async function invokeContractAi(
  input: ImproveContractInput,
  onThinking?: (text: string) => void,
): Promise<ContractAiChatResult> {
  if (onThinking) {
    try {
      const data = await consumeContractAiReviewSse<Record<string, unknown>>(input, onThinking);
      if (data?.error) {
        throw new Error(String(data.error));
      }
      return normalizeContractAiResult(data);
    } catch (streamErr) {
      onThinking('Applying your changes…');
      console.warn('Contract AI streaming unavailable, falling back:', streamErr);
    }
  }

  const { data, error } = await supabase.functions.invoke('ai-contract-improvement', {
    body: input,
  });

  if (error) {
    throw new Error(error.message || 'Failed to improve contract with AI');
  }

  if (data?.error) {
    throw new Error(String(data.error));
  }

  return normalizeContractAiResult(data as Record<string, unknown>);
}
