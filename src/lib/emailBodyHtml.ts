import {
  applyContractLinkPreviewHtml,
  extractAllBalancedTables,
  extractContractPreviewTables,
  restoreContractPreviewTables,
  toContractLinkPreviewEditorHtml,
} from './leadContractLink';

/**
 * Convert compose/template text into Outlook-safe HTML.
 *
 * Outlook desktop (Word HTML) treats `<br>` inside a single wrapping `<div>` as a
 * soft wrap and often unwraps it into one line. One block `<div>` per line is the
 * format Gmail/Apple Mail send and the one Word keeps as real paragraphs.
 */

export type ConvertBodyToHtmlOptions = {
  /** Convert markdown `[label](url)` to anchors (price-offer compose). */
  markdownLinks?: boolean;
  /** Force outgoing direction instead of inferring from Hebrew/Arabic. */
  direction?: 'ltr' | 'rtl';
};

const FONT_STYLE = "font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif;";
const CRM_COMPOSE_ATTR = 'data-crm-compose="1"';
const ANCHOR_RE = /<a\s+[^>]*href=["'][^"']+["'][^>]*>[\s\S]*?<\/a>/gi;
const RTL_RE = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F]/;
const WRAPPER_RE =
  /^<div\b[^>]*\bdir=(["']?)(rtl|ltr|auto)\1[^>]*>([\s\S]*)<\/div>\s*$/i;

/** True when this HTML was built by convertBodyToHtml (complete compose body, not a Graph preview). */
export function isCrmComposeEmailHtml(html: string | null | undefined): boolean {
  const s = String(html || '');
  if (/data-crm-compose=["']?1["']?/i.test(s)) return true;
  // HTML produced before the data-crm-compose marker existed
  return (
    /<div\b[^>]*\bdir=(["']?)(rtl|ltr)\1[^>]*font-family:\s*'Segoe UI'/i.test(s) &&
    /<div>\s*(?:<br\s*\/?>|[^<])/i.test(s)
  );
}

export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function containsRtl(text: string): boolean {
  return RTL_RE.test(text.replace(/<[^>]*>/g, ''));
}

function wrapOutlookBody(innerHtml: string, direction?: 'ltr' | 'rtl'): string {
  const rtl = direction === 'rtl' ? true : direction === 'ltr' ? false : containsRtl(innerHtml);
  if (rtl) {
    return `<div ${CRM_COMPOSE_ATTR} dir="rtl" style="text-align: right; direction: rtl; ${FONT_STYLE}">${innerHtml}</div>`;
  }
  return `<div ${CRM_COMPOSE_ATTR} dir="ltr" style="text-align: left; direction: ltr; ${FONT_STYLE}">${innerHtml}</div>`;
}

/** TipTap / Outlook HTML → plain email text with real newlines. */
export function htmlToPlainEmail(html: string): string {
  return String(html || '')
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function isComposeBodyEmpty(html: string): boolean {
  return !htmlToPlainEmail(html);
}

const EMAIL_GREETING_RE =
  /^(Dear\b[^,\n]{0,80},|Hi\b[^,\n]{0,80},|Hello\b[^,\n]{0,80},|שלום(?:\s+[^,\n]{1,80})?,)/iu;
const EMAIL_SIGNOFF_RE =
  /[ \t\n]+((?:Best regards|Kind regards|Warm regards|With regards|With best regards|Regards|Sincerely|Yours sincerely|Yours truly|Thanks|Thank you|בברכה רבה|בברכה|בכבוד רב)\s*,?)\s*$/iu;

const ORPHAN_TABLE_CLOSE_RE = /(?:^|\n)\s*<\/(?:td|tr|th|table)>\s*(?=\n|$)/gi;

function stashHtmlBlocks(text: string): { text: string; blocks: string[] } {
  const tables = extractAllBalancedTables(String(text || ''), 'EMAILBLOCK');
  const blocks = [...tables.blocks];
  const stash = (html: string) => {
    const token = `@@EMAILBLOCK${blocks.length}@@`;
    blocks.push(html);
    return token;
  };
  const next = tables.text
    .replace(/@@EMAILBLOCK(\d+)@@/g, '\n\n@@EMAILBLOCK$1@@\n\n')
    .replace(/<a\s+[^>]*>[\s\S]*?<\/a>/gi, (m) => stash(m));
  return { text: next, blocks };
}

function restoreHtmlBlocks(text: string, blocks: string[]): string {
  let next = text;
  blocks.forEach((html, index) => {
    next = next.replace(`@@EMAILBLOCK${index}@@`, html);
  });
  return next;
}

/**
 * Turn a flattened AI / compose draft into a readable email:
 * greeting, blank line, short paragraphs, blank line, sign-off.
 */
export function formatPlainEmailParagraphs(text: string): string {
  let source = String(text || '').replace(/\r\n/g, '\n');
  if (!source.trim()) return '';
  if (!source.includes('\n') && /\\n/.test(source)) {
    source = source.replace(/\\n/g, '\n');
  }

  const stashed = stashHtmlBlocks(source);
  let next = stashed.text.replace(ORPHAN_TABLE_CLOSE_RE, '\n');
  if (/<[a-z][\s\S]*>/i.test(next)) {
    next = htmlToPlainEmail(next);
  }
  next = next.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').trim();

  const greeting = next.match(EMAIL_GREETING_RE);
  if (greeting) {
    next = `${greeting[1]}\n\n${next.slice(greeting[0].length).replace(/^[ \t\n]+/, '')}`;
  }

  next = next.replace(EMAIL_SIGNOFF_RE, '\n\n$1');
  next = next.replace(/[ \t]+(https?:\/\/[^\s<]+)/g, '\n\n$1');
  next = next.replace(/(https?:\/\/[^\s<]+)[ \t]+(?=\S)/g, '$1\n\n');

  next = next
    .split(/\n{2,}/)
    .map((para) => {
      if (para.startsWith('@@EMAILBLOCK') || para.length < 110 || para.includes('\n')) return para;
      return para.replace(/([.!?])["']?[ \t]+(?=[A-Z\u0590-\u05FF])/g, (match, punct: string, offset: number, whole: string) => {
        const prev = whole.slice(Math.max(0, offset - 10), offset);
        if (/\b(?:Mr|Mrs|Ms|Dr|Prof|Jr|Sr|vs)\.?$/i.test(prev)) return match;
        return `${punct}\n\n`;
      });
    })
    .join('\n\n');

  return restoreHtmlBlocks(next.replace(/\n{3,}/g, '\n\n').trim(), stashed.blocks);
}

/** Plain email text (and mixed anchors/tables) → TipTap paragraph HTML. */
export function plainTextToEditorHtml(text: string): string {
  const source = String(text || '').replace(/\r\n/g, '\n');
  if (!source.trim()) return '';
  if (/<(p|div|ul|ol|h[1-6])\b/i.test(source)) return source;

  const stashed = stashHtmlBlocks(source);
  return stashed.text
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => {
      const tokenOnly = para.match(/^@@EMAILBLOCK(\d+)@@$/);
      if (tokenOnly) {
        const block = stashed.blocks[Number(tokenOnly[1])] || '';
        return /data-contract-preview/i.test(block) ? toContractLinkPreviewEditorHtml(block) : block;
      }
      const withBreaks = para
        .replace(/@@EMAILBLOCK(\d+)@@/g, (_m, n) => `@@KEEP${n}@@`)
        .split('\n')
        .filter((line) => !/^\s*<\/(?:td|tr|th|table)>\s*$/i.test(line))
        .map((line) => escapeHtml(line))
        .join('<br>')
        .replace(/@@KEEP(\d+)@@/g, (_m, n) => {
          const block = stashed.blocks[Number(n)] || '';
          return /data-contract-preview/i.test(block) ? toContractLinkPreviewEditorHtml(block) : block;
        });
      return `<p>${withBreaks}</p>`;
    })
    .join('');
}

export function splitEmailBodyAndSignature(html: string): { body: string; signature: string } {
  const source = String(html || '');
  if (!source) return { body: '', signature: '' };

  const divMatch = source.match(
    /((?:<div>\s*<br\s*\/?>\s*<\/div>\s*)*<div\b[^>]*data-email-signature[\s\S]*)$/i,
  );
  if (divMatch && divMatch.index != null) {
    return { body: source.slice(0, divMatch.index), signature: divMatch[1] };
  }

  const tableMatch = source.match(/(<table\b[^>]*data-email-signature[\s\S]*)$/i);
  if (tableMatch && tableMatch.index != null) {
    return { body: source.slice(0, tableMatch.index), signature: tableMatch[1] };
  }

  // Graph/Outlook often strips data-* attributes. Fall back to the company gold-bar table.
  const goldIdx = source.search(/<table\b[^>]*>[\s\S]*?(?:#C4A574|data-signature-gold)/i);
  if (goldIdx >= 0) {
    return { body: source.slice(0, goldIdx), signature: source.slice(goldIdx) };
  }

  return { body: source, signature: '' };
}

function peelSignatureHtml(html: string): { body: string; signature: string } {
  return splitEmailBodyAndSignature(html);
}

function unwrapExistingOutlookWrapper(html: string): string {
  const trimmed = html.trim();
  const match = trimmed.match(WRAPPER_RE);
  return match ? match[3] : html;
}

function unwrapSingleOuterDivIfNeeded(html: string): string {
  const trimmed = html.trim();
  const match = trimmed.match(/^<div\b[^>]*>([\s\S]*)<\/div>\s*$/i);
  if (!match) return html;
  const inner = match[1];
  if (/<\/div>/i.test(inner)) return html;
  return inner;
}

/** True when fragment is already one block `<div>` per line (no leftover raw text). */
function isDivPerLineFragment(html: string): boolean {
  const trimmed = html.trim();
  if (!trimmed || !/^<div\b/i.test(trimmed)) return false;
  const withoutBlankBreaks = trimmed.replace(/<div>\s*<br\s*\/?>\s*<\/div>/gi, '');
  if (/<br\s*\/?>/i.test(withoutBlankBreaks)) return false;
  let remaining = trimmed;
  let prev = '';
  while (remaining !== prev) {
    prev = remaining;
    remaining = remaining.replace(/<div\b[^>]*>(?:(?!<div\b)[\s\S])*?<\/div>/gi, '');
  }
  return remaining.replace(/\s+/g, '') === '';
}

function withProtectedAnchors(text: string, transform: (withoutAnchors: string) => string): string {
  const placeholders: string[] = [];
  const withPlaceholders = text.replace(ANCHOR_RE, (match) => {
    const token = `@@EMAILANCHOR${placeholders.length}@@`;
    placeholders.push(match);
    return token;
  });
  let result = transform(withPlaceholders);
  placeholders.forEach((anchor, index) => {
    result = result.replace(`@@EMAILANCHOR${index}@@`, anchor);
  });
  return result;
}

function markdownLinksToAnchors(text: string): string {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => {
    let finalUrl = String(url).trim();
    if (!/^https?:\/\//i.test(finalUrl) && !/^mailto:/i.test(finalUrl)) {
      finalUrl = `https://${finalUrl}`;
    }
    const safeUrl = finalUrl.replace(/"/g, '&quot;');
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  });
}

function linkifyPlainUrls(text: string): string {
  return text.replace(/\b(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+)/gi, (url) => {
    const safeHref = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}

/** Escape text and wrap bare URLs, without double-encoding `&` in hrefs. */
function escapeAndLinkify(plain: string): string {
  const parts = plain.split(/\b(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+)/gi);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) {
        const safeHref = part.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${escapeHtml(part)}</a>`;
      }
      return escapeHtml(part);
    })
    .join('');
}

function linkifyUrlsOutsideTags(html: string): string {
  if (!/\bhttps?:\/\//i.test(html) && !/\bmailto:/i.test(html)) return html;
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (!part || part.startsWith('<')) return part;
      return linkifyPlainUrls(part);
    })
    .join('');
}

function linesToOutlookDivs(htmlWithNewlines: string): string {
  const lines = htmlWithNewlines.split('\n');
  return lines
    .map((line) => {
      const isBlank = line.replace(/&nbsp;/gi, ' ').replace(/<br\s*\/?>/gi, '').trim() === '';
      if (isBlank) return '<div><br></div>';
      return `<div>${line}</div>`;
    })
    .join('');
}

/**
 * Convert textarea / template body text to HTML that Outlook will not flatten.
 * Safe to call on already-converted output (idempotent).
 */
export function convertBodyToHtml(text: string, options?: ConvertBodyToHtmlOptions): string {
  if (!text) return '';

  let content = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const { body, signature } = peelSignatureHtml(content);
  content = applyContractLinkPreviewHtml(body);
  content = unwrapExistingOutlookWrapper(content);
  content = unwrapSingleOuterDivIfNeeded(content);
  const contractPreviews = extractContractPreviewTables(content);
  content = contractPreviews.text;

  const wrap = (inner: string) => wrapOutlookBody(inner, options?.direction);
  const finish = (html: string) =>
    restoreContractPreviewTables(html, contractPreviews.blocks) + signature;

  if (isDivPerLineFragment(content)) {
    return finish(wrap(content));
  }

  if (options?.markdownLinks) {
    content = markdownLinksToAnchors(content);
  }

  const withoutAnchors = content.replace(ANCHOR_RE, '');
  const hasOtherHtml = /<[a-z][\s\S]*>/i.test(withoutAnchors);
  const hasHeavyHtml = /<(table|thead|tbody|tr|td|th|ul|ol|li|h[1-6]|blockquote|section|article|img|hr)\b/i.test(
    withoutAnchors,
  );
  const hasParagraphHtml = /<p\b/i.test(withoutAnchors);

  if (!hasOtherHtml) {
    content = withProtectedAnchors(content, escapeAndLinkify);
  } else if (hasParagraphHtml && !hasHeavyHtml) {
    content = content
      .replace(/<\/p>\s*<p\b[^>]*>/gi, '\n\n')
      .replace(/<\/?p\b[^>]*>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n');
    content = withProtectedAnchors(content, linkifyUrlsOutsideTags);
  } else if (hasHeavyHtml) {
    content = withProtectedAnchors(content, linkifyUrlsOutsideTags);
    return finish(wrap(content));
  } else {
    content = content.replace(/<br\s*\/?>/gi, '\n');
    content = withProtectedAnchors(content, linkifyUrlsOutsideTags);
  }

  return finish(wrap(linesToOutlookDivs(content)));
}
