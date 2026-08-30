import {
  applyContractLinkPreviewHtml,
  extractContractPreviewTables,
  restoreContractPreviewTables,
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

function wrapOutlookBody(innerHtml: string): string {
  if (containsRtl(innerHtml)) {
    return `<div ${CRM_COMPOSE_ATTR} dir="rtl" style="text-align: right; direction: rtl; ${FONT_STYLE}">${innerHtml}</div>`;
  }
  return `<div ${CRM_COMPOSE_ATTR} dir="ltr" style="text-align: left; direction: ltr; ${FONT_STYLE}">${innerHtml}</div>`;
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

  const finish = (html: string) =>
    restoreContractPreviewTables(html, contractPreviews.blocks) + signature;

  if (isDivPerLineFragment(content)) {
    return finish(wrapOutlookBody(content));
  }

  if (options?.markdownLinks) {
    content = markdownLinksToAnchors(content);
  }

  const withoutAnchors = content.replace(ANCHOR_RE, '');
  const hasOtherHtml = /<[a-z][\s\S]*>/i.test(withoutAnchors);
  const hasStructuredHtml = /<(table|thead|tbody|tr|td|th|ul|ol|li|p|h[1-6]|blockquote|section|article|img|hr)\b/i.test(
    withoutAnchors,
  );

  if (!hasOtherHtml) {
    content = withProtectedAnchors(content, escapeAndLinkify);
  } else if (hasStructuredHtml) {
    content = withProtectedAnchors(content, linkifyUrlsOutsideTags);
    return finish(wrapOutlookBody(content));
  } else {
    content = content.replace(/<br\s*\/?>/gi, '\n');
    content = withProtectedAnchors(content, linkifyUrlsOutsideTags);
  }

  return finish(wrapOutlookBody(linesToOutlookDivs(content)));
}
