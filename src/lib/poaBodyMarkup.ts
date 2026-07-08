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

const INLINE_MARK_RE =
  /(\*\*[^*\n]+\*\*|__[^_\n]+__|\+\+[^+\n]+\+\+|==[^=\n]+==)/g;

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
  if (token.startsWith('**') && token.endsWith('**')) {
    return { kind: 'bold', inner: token.slice(2, -2) };
  }
  if (token.startsWith('__') && token.endsWith('__')) {
    return { kind: 'underline', inner: token.slice(2, -2) };
  }
  if (token.startsWith('++') && token.endsWith('++')) {
    return { kind: 'outline', inner: token.slice(2, -2) };
  }
  if (token.startsWith('==') && token.endsWith('==')) {
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

function inlineMarkupToHtml(text: string): string {
  const parts: string[] = [];
  let lastIndex = 0;
  INLINE_MARK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = INLINE_MARK_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(escapeHtml(text.slice(lastIndex, match.index)));
    }
    const parsed = stripMark(match[0]);
    if (parsed) {
      const inner = inlineMarkupToHtml(parsed.inner);
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
      parts.push(escapeHtml(match[0]));
    }
    lastIndex = match.index + match[0].length;
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
  const lines = body.replace(/\r\n/g, '\n').split('\n');
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

  if (tag === 'strong' || tag === 'b') return `**${inner}**`;
  if (tag === 'u') return `__${inner}__`;
  if (tag === 'mark') return `==${inner}==`;
  if (el.getAttribute('data-poa-outline') === '1' || el.classList.contains('poa-outline')) {
    return `++${inner}++`;
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
  if (paragraphs.length === 0) {
    return walkHtmlToMarkup(doc.body);
  }
  return paragraphs.map((p) => walkHtmlToMarkup(p)).join('\n');
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
export function renderPoaInlineMarkup(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_MARK_RE.lastIndex = 0;
  let partIndex = 0;

  while ((match = INLINE_MARK_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const parsed = stripMark(match[0]);
    if (parsed) {
      const cls = POA_TEXT_MARKS[parsed.kind].className;
      nodes.push(
        React.createElement(
          'span',
          { key: `${keyPrefix}-m-${partIndex++}`, className: cls },
          renderPoaInlineMarkup(parsed.inner, `${keyPrefix}-i-${partIndex}`),
        ),
      );
    } else {
      nodes.push(match[0]);
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}
