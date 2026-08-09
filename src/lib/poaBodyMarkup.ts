import React from 'react';
import { Mark, mergeAttributes } from '@tiptap/core';

/** Inline markers embedded in POA template body plain text. */
export const POA_TEXT_MARKS = {
  bold: { open: '**', close: '**', className: 'font-bold' },
  underline: { open: '__', close: '__', className: 'underline' },
  outline: { open: '++', close: '++', className: 'rounded-sm border border-gray-800 px-0.5' },
  highlight: { open: '==', close: '==', className: 'bg-yellow-200' },
} as const;

export type PoaTextMarkKind = keyof typeof POA_TEXT_MARKS;

/** Source only (no /g) — callers must `new RegExp(..., 'g')` per invocation. */
const INLINE_MARK_SOURCE =
  '(\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__|\\+\\+[^+\\n]+\\+\\+|==[^=\\n]+==)';

/**
 * Toggle a marker around the current textarea selection (or unwrap if already marked).
 * Kept for plain-text callers; TipTap editor uses visual marks instead.
 */
export function togglePoaTextMark(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  kind: PoaTextMarkKind,
): { next: string; selectionStart: number; selectionEnd: number } | null {
  const { open } = POA_TEXT_MARKS[kind];
  const marker = open;
  const selected = value.slice(selectionStart, selectionEnd);
  if (!selected) return null;

  const beforeSel = value.slice(Math.max(0, selectionStart - marker.length), selectionStart);
  const afterSel = value.slice(selectionEnd, selectionEnd + marker.length);

  if (beforeSel === marker && afterSel === marker) {
    const next =
      value.slice(0, selectionStart - marker.length) + selected + value.slice(selectionEnd + marker.length);
    return {
      next,
      selectionStart: selectionStart - marker.length,
      selectionEnd: selectionEnd - marker.length,
    };
  }

  const next = value.slice(0, selectionStart) + marker + selected + marker + value.slice(selectionEnd);
  return {
    next,
    selectionStart: selectionStart + marker.length,
    selectionEnd: selectionEnd + marker.length,
  };
}

function stripMark(token: string): { kind: PoaTextMarkKind; inner: string } | null {
  if (token.startsWith('**') && token.endsWith('**') && token.length >= 4) {
    return { kind: 'bold', inner: token.slice(2, -2) };
  }
  if (token.startsWith('__') && token.endsWith('__') && token.length >= 4) {
    return { kind: 'underline', inner: token.slice(2, -2) };
  }
  if (token.startsWith('++') && token.endsWith('++') && token.length >= 4) {
    return { kind: 'outline', inner: token.slice(2, -2) };
  }
  if (token.startsWith('==') && token.endsWith('==') && token.length >= 4) {
    return { kind: 'highlight', inner: token.slice(2, -2) };
  }
  return null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Wrap each non-empty line with mark delimiters so bold/etc. never spans a newline.
 * TipTap often emits <strong>text<br></strong> which would otherwise become **text\n**
 * and show literal asterisks in view mode (line-based parsers can't close the mark).
 */
function applyMarkToLines(inner: string, open: string, close: string): string {
  if (!inner) return '';
  if (!inner.includes('\n')) return `${open}${inner}${close}`;
  return inner
    .split('\n')
    .map((line) => (line ? `${open}${line}${close}` : ''))
    .join('\n');
}

/**
 * Repair stored markup where a mark crosses newlines (e.g. **title\n**).
 * Safe to run before line-based HTML/React rendering.
 */
export function normalizePoaInlineMarks(body: string): string {
  let result = body.replace(/\r\n/g, '\n');
  for (const { open, close } of Object.values(POA_TEXT_MARKS)) {
    const escOpen = open.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escClose = close.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escOpen}([\\s\\S]*?)${escClose}`, 'g');
    result = result.replace(re, (_match, inner: string) => applyMarkToLines(inner, open, close));
  }
  return result;
}

function inlineMarkupToHtml(text: string, depth = 0): string {
  if (!text || depth > 32) return escapeHtml(text || '');

  // Fresh regex each call — a shared /g RegExp's lastIndex is clobbered by recursion
  // and rematches the same token forever (browser "Script terminated by timeout").
  const re = new RegExp(INLINE_MARK_SOURCE, 'g');
  const parts: string[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(re)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push(escapeHtml(text.slice(lastIndex, index)));
    }
    const parsed = stripMark(token);
    if (parsed && parsed.inner !== token) {
      const inner = inlineMarkupToHtml(parsed.inner, depth + 1);
      switch (parsed.kind) {
        case 'bold':
          parts.push(`<strong>${inner}</strong>`);
          break;
        case 'underline':
          parts.push(`<u>${inner}</u>`);
          break;
        case 'outline':
          parts.push(`<span data-poa-outline="1">${inner}</span>`);
          break;
        case 'highlight':
          parts.push(`<mark>${inner}</mark>`);
          break;
      }
    } else {
      parts.push(escapeHtml(token));
    }
    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(escapeHtml(text.slice(lastIndex)));
  }

  return parts.join('');
}

/** Convert stored POA markup body into TipTap-friendly HTML. */
export function poaMarkupToHtml(body: string): string {
  if (!body) return '<p></p>';
  // Match admin textarea + preview pre-wrap: every newline is a soft line break.
  const normalized = normalizePoaInlineMarks(body);
  const lines = normalized.split('\n');
  const html = lines.map((line) => inlineMarkupToHtml(line)).join('<br>');
  return `<p>${html || '<br>'}</p>`;
}

function walkHtmlToMarkup(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (tag === 'br') return '\n';

  const inner = Array.from(el.childNodes).map(walkHtmlToMarkup).join('');

  if (tag === 'strong' || tag === 'b') return applyMarkToLines(inner, '**', '**');
  if (tag === 'u') return applyMarkToLines(inner, '__', '__');
  if (tag === 'mark') return applyMarkToLines(inner, '==', '==');
  if (el.getAttribute('data-poa-outline') === '1' || el.classList.contains('poa-outline')) {
    return applyMarkToLines(inner, '++', '++');
  }
  if (el.getAttribute('data-poa-ai-added') === '1' || el.classList.contains('poa-ai-added')) {
    return inner;
  }
  if (el.getAttribute('data-poa-ai-changed') === '1' || el.classList.contains('poa-ai-changed')) {
    return inner;
  }
  if (tag === 'p') return inner;
  return inner;
}

/** Convert TipTap/HTML body back to stored POA markup. */
export function poaHtmlToMarkup(html: string): string {
  if (!html || typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const paragraphs = Array.from(doc.body.querySelectorAll(':scope > p'));
  const raw =
    paragraphs.length === 0
      ? walkHtmlToMarkup(doc.body)
      : paragraphs.map((p) => walkHtmlToMarkup(p)).join('\n');
  return normalizePoaInlineMarks(raw);
}

/** TipTap mark for the outline style (`++text++` in storage). */
export const PoaOutline = Mark.create({
  name: 'poaOutline',
  inclusive: false,
  parseHTML() {
    return [{ tag: 'span[data-poa-outline]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-poa-outline': '1',
        class: 'poa-outline rounded-sm border border-gray-800 px-0.5',
      }),
      0,
    ];
  },
  addCommands() {
    return {
      togglePoaOutline:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    poaOutline: {
      togglePoaOutline: () => ReturnType;
    };
    poaAiAdded: {
      setPoaAiAdded: () => ReturnType;
      unsetPoaAiAdded: () => ReturnType;
    };
    poaAiChanged: {
      setPoaAiChanged: () => ReturnType;
      unsetPoaAiChanged: () => ReturnType;
    };
  }
}

/** Ephemeral staff-editor mark for AI-inserted text (not saved to POA body). */
export const PoaAiAdded = Mark.create({
  name: 'poaAiAdded',
  inclusive: false,
  parseHTML() {
    return [{ tag: 'span[data-poa-ai-added]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-poa-ai-added': '1',
        class: 'poa-ai-added',
      }),
      0,
    ];
  },
});

/** Ephemeral staff-editor mark for AI-replaced text (not saved to POA body). */
export const PoaAiChanged = Mark.create({
  name: 'poaAiChanged',
  inclusive: false,
  parseHTML() {
    return [{ tag: 'span[data-poa-ai-changed]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-poa-ai-changed': '1',
        class: 'poa-ai-changed',
      }),
      0,
    ];
  },
});

/** Render inline POA body markup inside a text segment. */
export function renderPoaInlineMarkup(
  text: string,
  keyPrefix: string,
  depth = 0,
): React.ReactNode[] {
  if (!text) return [''];
  // Only normalize at the top level — nested calls receive mark contents without delimiters.
  const source = depth === 0 ? normalizePoaInlineMarks(text) : text;
  if (!source || depth > 32) return [source || ''];

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let partIndex = 0;
  const re = new RegExp(INLINE_MARK_SOURCE, 'g');

  for (const match of source.matchAll(re)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(source.slice(lastIndex, index));
    }
    const parsed = stripMark(token);
    if (parsed && parsed.inner !== token) {
      const cls = POA_TEXT_MARKS[parsed.kind].className;
      nodes.push(
        React.createElement(
          'span',
          { key: `${keyPrefix}-m-${partIndex++}`, className: cls },
          renderPoaInlineMarkup(parsed.inner, `${keyPrefix}-i-${partIndex}`, depth + 1),
        ),
      );
    } else {
      nodes.push(token);
    }
    lastIndex = index + token.length;
  }

  if (lastIndex < source.length) {
    nodes.push(source.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [source];
}
