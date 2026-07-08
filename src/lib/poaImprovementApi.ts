import { supabase } from './supabase';
import { consumePoaAiReviewSse } from './aiReviewStreaming';
import {
  fetchLeadMeetingSummaries,
  formatMeetingSummariesForAi,
  type LeadMeetingSummary,
} from './contractImprovementApi';
import type { PoaEditData } from './poaApi';

export { fetchLeadMeetingSummaries, formatMeetingSummariesForAi, type LeadMeetingSummary };

const POA_MARK_PAIRS: Array<[string, string]> = [
  ['**', '**'],
  ['__', '__'],
  ['++', '++'],
  ['==', '=='],
];

function extractPoaMarkedPhrases(text: string, open: string, close: string): string[] {
  const phrases: string[] = [];
  const escapedOpen = open.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedClose = close.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${escapedOpen}([^\\n]*?)${escapedClose}`, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const phrase = match[1].trim();
    if (phrase) phrases.push(phrase);
  }
  return phrases;
}

function restorePoaFormattingMarkersFromOriginal(original: string, improved: string): string {
  let result = improved;
  for (const [open, close] of POA_MARK_PAIRS) {
    const phrases = extractPoaMarkedPhrases(original, open, close);
    for (const phrase of phrases.sort((a, b) => b.length - a.length)) {
      if (!phrase || result.includes(`${open}${phrase}${close}`)) continue;
      if (result.includes(phrase)) {
        result = result.replace(phrase, `${open}${phrase}${close}`);
      }
    }
  }
  return result;
}

/** Serialize POA body for AI (plain text with inline markers and {{field}} tokens). */
export function poaBodyToAiText(body: string): string {
  return body.replace(/\r\n/g, '\n').trim();
}

/** Apply AI output back to stored POA markup. */
export function aiTextToPoaBody(aiText: string, originalBody?: string): string {
  const normalized = aiText.replace(/\r\n/g, '\n').trim();
  if (!originalBody?.trim()) return normalized;
  return restorePoaFormattingMarkersFromOriginal(originalBody, normalized);
}

const EXPLICIT_END_RE =
  /at the end|end of (the )?(document|poa|page)|bottom|after signature|בסוף|בסוף המסמך/i;

const CLOSING_SECTION_MARKERS = [
  '{{signature}}',
  '{{place_date}}',
  '{{date}}',
  'Signature:',
  'Place and date:',
  'Place & date:',
  'חתימה',
  'מקום ותאריך',
];

function normalizeAnchorText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
}

/** Locate an anchor phrase in POA body — exact match first, then fuzzy. */
export function findAnchorInPoaBody(
  body: string,
  find: string,
): { index: number; length: number } | null {
  const needle = find.trim();
  if (!needle) return null;

  const direct = body.indexOf(needle);
  if (direct >= 0) return { index: direct, length: needle.length };

  const collapsedBody = body.replace(/\s+/g, ' ');
  const collapsedNeedle = needle.replace(/\s+/g, ' ');
  const collapsedIdx = collapsedBody.indexOf(collapsedNeedle);
  if (collapsedIdx >= 0) {
    let pos = 0;
    let collapsedPos = 0;
    while (collapsedPos < collapsedIdx && pos < body.length) {
      if (/\s/.test(body[pos]) && /\s/.test(body[pos + 1] || ' ')) {
        while (pos < body.length && /\s/.test(body[pos])) pos += 1;
        collapsedPos += 1;
      } else {
        pos += 1;
        collapsedPos += 1;
      }
    }
    return { index: pos, length: needle.length };
  }

  for (const len of [needle.length, 80, 50, 30]) {
    const sub = needle.slice(0, len).trim();
    if (sub.length < 10) break;
    const idx = body.indexOf(sub);
    if (idx >= 0) return { index: idx, length: sub.length };
  }

  const words = normalizeAnchorText(needle)
    .split(' ')
    .filter((w) => w.length > 2);
  if (words.length >= 2) {
    const lines = body.split('\n');
    let offset = 0;
    for (const line of lines) {
      const lineNorm = normalizeAnchorText(line);
      if (words.every((w) => lineNorm.includes(w))) {
        return { index: offset, length: line.length };
      }
      offset += line.length + 1;
    }
  }

  return null;
}

function findClosingSectionIndex(body: string): number | null {
  let best: number | null = null;
  for (const marker of CLOSING_SECTION_MARKERS) {
    const idx = body.indexOf(marker);
    if (idx >= 0 && (best == null || idx < best)) best = idx;
  }
  return best;
}

function separatorBeforeInsert(body: string, pos: number, patchText: string): string {
  if (pos <= 0) return '';
  if (patchText.startsWith('\n')) return '';
  const prev = body[pos - 1];
  if (prev === '\n') {
    return body[pos - 2] === '\n' ? '' : '\n';
  }
  return '\n\n';
}

function insertPatchAt(body: string, pos: number, patchText: string): string {
  const sep = separatorBeforeInsert(body, pos, patchText);
  return body.slice(0, pos) + sep + patchText + body.slice(pos);
}

function shouldAppendAtEnd(editKind: PoaAiEditKind, userRemarks?: string | null): boolean {
  if (editKind === 'append') return true;
  if (userRemarks && EXPLICIT_END_RE.test(userRemarks)) return true;
  return false;
}

/** Merge a patch response into the existing POA body. */
export function applyPoaAiEditResult(
  originalBody: string,
  result: ImprovePoaResult,
  userRemarks?: string | null,
): string {
  const kind = result.editKind || 'full';
  const patchText = result.text?.trim() || '';

  if (kind !== 'full' && patchText) {
    const body = originalBody.replace(/\r\n/g, '\n');
    const find = result.find?.trim();

    if (kind === 'prepend') {
      return patchText + (body.length ? `\n\n${body}` : '');
    }

    if (kind === 'replace' && find) {
      const anchor = findAnchorInPoaBody(body, find);
      if (anchor) {
        return body.slice(0, anchor.index) + patchText + body.slice(anchor.index + anchor.length);
      }
    }

    if (kind === 'insert_after' && find) {
      const anchor = findAnchorInPoaBody(body, find);
      if (anchor) {
        const pos = anchor.index + anchor.length;
        return insertPatchAt(body, pos, patchText);
      }
    }

    if (shouldAppendAtEnd(kind, userRemarks)) {
      const sep = body.length && !body.endsWith('\n') ? '\n\n' : '';
      return body + sep + patchText;
    }

    const closingIdx = findClosingSectionIndex(body);
    if (closingIdx != null && closingIdx > 0) {
      return insertPatchAt(body, closingIdx, patchText);
    }

    const sep = body.length && !body.endsWith('\n') ? '\n\n' : '';
    return body + sep + patchText;
  }

  if (result.improvedPoaText?.trim()) {
    return aiTextToPoaBody(result.improvedPoaText, originalBody);
  }

  return originalBody;
}

/** Heuristic: only very narrow single-insert edits use the fast patch path. */
export function shouldPreferFastPoaEdit(userRemarks: string, currentPoaText: string): boolean {
  if (!currentPoaText.trim()) return false;
  const msg = userRemarks.trim();
  if (
    /rewrite|entire|whole|full document|improve all|reformat|what else|what can|add what|needed|missing|please add|make sure|place it|כל המסמך|לשכתב|שכתב מחדש|הוסף|שפר|מה עוד/i.test(
      msg,
    )
  ) {
    return false;
  }
  if (
    /after (the |this )?(sentence|paragraph|line|clause)|replace .+ with|insert after/i.test(msg) &&
    msg.length < 220
  ) {
    return true;
  }
  return false;
}

export function leadRefFromPoaData(data: PoaEditData) {
  if (data.lead.new_lead_id) {
    return { id: data.lead.new_lead_id, name: data.contact.name, lead_type: 'new' as const };
  }
  if (data.lead.legacy_lead_id != null) {
    return {
      id: `legacy_${data.lead.legacy_lead_id}`,
      name: data.contact.name,
      lead_type: 'legacy' as const,
    };
  }
  return { id: data.contact.id, name: data.contact.name };
}

export type PoaAiEditKind = 'append' | 'prepend' | 'insert_after' | 'replace' | 'full';

export type ImprovePoaInput = {
  currentPoaText: string;
  meetingSummaries: string;
  clientName?: string | null;
  documentName?: string | null;
  documentDescription?: string | null;
  language?: string | null;
  direction?: string | null;
  userRemarks?: string | null;
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  preferFastEdit?: boolean;
};

export type ImprovePoaResult = {
  intent: 'action';
  improvedPoaText: string;
  changeSummary: string;
  editKind?: PoaAiEditKind;
  text?: string;
  find?: string;
};

export type PoaAiQuestionResult = {
  intent: 'question';
  answer: string;
};

export type PoaAiChatResult = ImprovePoaResult | PoaAiQuestionResult;

export async function improvePoaWithMeetingSummaries(
  input: ImprovePoaInput,
  onThinking?: (text: string) => void,
): Promise<ImprovePoaResult> {
  const result = await invokePoaAi(input, onThinking);
  if (result.intent === 'question') {
    throw new Error('Expected POA changes but received a question response');
  }
  return result;
}

export async function sendPoaAiChatMessage(
  input: ImprovePoaInput & { userRemarks: string },
  onThinking?: (text: string) => void,
): Promise<PoaAiChatResult> {
  return invokePoaAi(input, onThinking);
}

function normalizePoaAiResult(data: Record<string, unknown>): PoaAiChatResult {
  const patchText = typeof data.text === 'string' ? data.text.trim() : '';
  const improvedPoaText = typeof data.improvedPoaText === 'string' ? data.improvedPoaText.trim() : '';
  const hasEditPayload = Boolean(patchText || improvedPoaText);

  if (data?.intent === 'question' && !hasEditPayload) {
    const answer =
      typeof data.answer === 'string' && data.answer.trim()
        ? data.answer.trim()
        : 'No answer returned.';
    return { intent: 'question', answer };
  }

  const changeSummary =
    typeof data.changeSummary === 'string' && data.changeSummary.trim()
      ? data.changeSummary.trim()
      : 'POA wording was improved based on meeting summaries.';

  const editKind = data.editKind as PoaAiEditKind | undefined;
  const find = typeof data.find === 'string' ? data.find.trim() : undefined;

  if (editKind && editKind !== 'full' && patchText) {
    return {
      intent: 'action',
      improvedPoaText: '',
      changeSummary,
      editKind,
      text: patchText,
      find,
    };
  }

  if (improvedPoaText) {
    return {
      intent: 'action',
      improvedPoaText,
      changeSummary,
      editKind: 'full',
    };
  }

  if (patchText) {
    return {
      intent: 'action',
      improvedPoaText: '',
      changeSummary,
      editKind: editKind || 'insert_after',
      text: patchText,
      find,
    };
  }

  throw new Error('AI returned an invalid POA');
}

async function invokePoaAi(
  input: ImprovePoaInput,
  onThinking?: (text: string) => void,
): Promise<PoaAiChatResult> {
  onThinking?.('Connecting to AI…');

  if (onThinking) {
    try {
      const data = await consumePoaAiReviewSse<Record<string, unknown>>(input, onThinking);
      if (data?.error) {
        throw new Error(String(data.error));
      }
      return normalizePoaAiResult(data);
    } catch (streamErr) {
      onThinking('Applying your changes…');
      console.warn('POA AI streaming unavailable, falling back:', streamErr);
    }
  }

  const { data, error } = await supabase.functions.invoke('ai-poa-improvement', {
    body: input,
  });

  if (error) {
    throw new Error(error.message || 'Failed to improve POA with AI');
  }

  if (data?.error) {
    throw new Error(String(data.error));
  }

  return normalizePoaAiResult(data as Record<string, unknown>);
}
