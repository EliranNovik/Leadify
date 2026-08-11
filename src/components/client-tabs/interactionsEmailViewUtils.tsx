import React from 'react';
import sanitizeHtml from '../../lib/sanitizeHtml';
import { interactionsDevLog } from '../../lib/interactions/devLog';

const extractHtmlBody = (html: string) => {
  if (!html) return html;
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : html;
};

/** Normalise emails.attachments (jsonb / string / Graph shape) to an array */
export function parseEmailAttachmentsFromDb(raw: unknown): any[] {
  if (raw == null) return [];
  try {
    if (typeof raw === 'string') {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) return p;
      if (p && typeof p === 'object' && Array.isArray((p as any).value)) return (p as any).value;
      return [];
    }
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'object' && raw !== null && Array.isArray((raw as any).value)) {
      return (raw as any).value;
    }
    if (typeof raw === 'object' && raw !== null) return [raw];
  } catch {
    return [];
  }
  return [];
}

export function fileAttachmentsForUi(attachments: any[]): any[] {
  return attachments.filter((att: any) => att && !att.isInline && (att.name || att.id));
}

export const processEmailHtmlWithInlineImages = (html: string, attachments: any[] = []): string => {
  if (!html || !attachments || attachments.length === 0) return html;

  const inlineAttachments = attachments.filter((att: any) => {
    if (!att) return false;
    const hasContentId = !!(att.contentId || att.content_id || att.contentID);
    const isInline = att.isInline === true;
    const hasContentBytes = !!(att.contentBytes || att.content_bytes || att.contentBytesBase64);
    return (hasContentId || isInline) && hasContentBytes;
  });

  if (inlineAttachments.length === 0) return html;

  const cidToDataUrl = new Map<string, string>();

  inlineAttachments.forEach((att: any) => {
    try {
      const contentId = att.contentId || att.content_id || att.contentID;
      const contentBytes = att.contentBytes || att.content_bytes || att.contentBytesBase64;

      if (!contentId || !contentBytes) return;

      let base64Data = contentBytes;
      if (contentBytes.startsWith('data:')) {
        base64Data = contentBytes;
      } else {
        const contentType = att.contentType || att.content_type || att.mimeType || 'image/png';
        base64Data = `data:${contentType};base64,${contentBytes}`;
      }

      const cidValue = contentId.replace(/^<|>$/g, '').trim();
      cidToDataUrl.set(`cid:${cidValue}`, base64Data);
      cidToDataUrl.set(`<cid:${cidValue}>`, base64Data);
      cidToDataUrl.set(`cid:<${cidValue}>`, base64Data);
      cidToDataUrl.set(cidValue, base64Data);
    } catch (error) {
      console.error('Error processing inline attachment:', error, att);
    }
  });

  if (cidToDataUrl.size === 0) return html;

  let processedHtml = html;

  processedHtml = processedHtml.replace(/<img([^>]*?)src\s*=\s*["'](cid:[^"']+)["']([^>]*?)>/gi, (match, before, cidRef, after) => {
    const cidValue = cidRef.replace(/^cid:/i, '').replace(/^<|>$/g, '').trim();
    const dataUrl =
      cidToDataUrl.get(`cid:${cidValue}`) ||
      cidToDataUrl.get(`<cid:${cidValue}>`) ||
      cidToDataUrl.get(`cid:<${cidValue}>`) ||
      cidToDataUrl.get(cidValue);

    if (dataUrl) {
      return `<img${before}src="${dataUrl}"${after}>`;
    }
    return match;
  });

  cidToDataUrl.forEach((dataUrl, cidKey) => {
    const escapedCid = cidKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(src=["'])${escapedCid}(["'])`, 'gi');
    processedHtml = processedHtml.replace(regex, `$1${dataUrl}$2`);
  });

  return processedHtml;
};

/** Plain-text snippet for email lists (strips HTML from preview/html bodies). */
export function formatEmailPlainTextPreview(
  preview?: string | null,
  html?: string | null,
  maxLength = 200,
): string | null {
  const raw = (preview || html || '').trim();
  if (!raw) return null;

  let text = raw;
  if (/<[a-z][\s\S]*>/i.test(text)) {
    text = text
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
  }

  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    text = textarea.value;
  } else {
    text = text
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
  }

  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length > maxLength) {
    return `${text.slice(0, maxLength - 1)}…`;
  }
  return text;
}

/**
 * Convert email HTML/plain body into display HTML that keeps original line breaks
 * for Interactions timeline cards (avoids one long run-on paragraph).
 * Uses real newlines + white-space:pre-wrap (not <br>) so blank lines render correctly.
 */
export function formatEmailBodyForTimeline(htmlOrText: string | null | undefined): string {
  if (!htmlOrText) return '';

  let content = extractHtmlBody(htmlOrText);
  // Real newlines + escaped sequences sometimes stored in DB / Graph payloads
  content = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n');

  const looksLikeHtml = /<[a-z][\s\S]*>/i.test(content);
  if (looksLikeHtml) {
    content = content
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<\/(div|li|tr|table|section|header|footer|blockquote)>/gi, '\n')
      .replace(/<\/td>/gi, ' ')
      .replace(/<o:p[^>]*>/gi, '')
      .replace(/<\/o:p>/gi, '')
      .replace(/<[^>]+>/g, '');
  }

  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = content;
    content = textarea.value;
  } else {
    content = content
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
  }

  content = content.replace(/\u00a0/g, ' ');
  content = content.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n');
  content = content.replace(/[ \t]{2,}/g, ' ');
  content = content.replace(/\n{3,}/g, '\n\n').trim();

  content = restoreFlattenedEmailLineBreaks(content);

  const escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Keep literal newlines — TruncatedContent / reading pane use white-space: pre-wrap.
  return `<div dir="auto" class="timeline-prewrap" style="font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif; white-space: pre-wrap; line-height: 1.55;">${escaped}</div>`;
}

/** Restore breaks when Graph/HTML flattened an email into one run-on line. */
function restoreFlattenedEmailLineBreaks(text: string): string {
  let content = text;
  const hadNewlines = content.includes('\n');

  const applyLabeledBreaks = (src: string, leading: string, paragraphLabels: string[], lineLabels: string[]) => {
    let out = src;
    for (const label of paragraphLabels) {
      out = out.replace(new RegExp(`${leading}(${label})`, 'gi'), '\n\n$1');
    }
    for (const label of lineLabels) {
      out = out.replace(new RegExp(`${leading}(${label})`, 'gi'), '\n$1');
    }
    return out;
  };

  const paragraphLabels = [
    'Date:',
    'Looking forward',
    'If you experience',
    'DPL Law Office',
    'שם החשבון:?',
    'בברכה,?',
    'Best regards,?',
    'Regards,?',
    'Kind regards,?',
    'ניתן לשלם',
    'מצורף',
    'אנא עדכנו',
    'Please (?:update|let us know|find|see)',
    'Attached',
  ];
  const lineLabels = [
    'Time:',
    'Place:',
    'Link:',
    'Google maps link:',
    'lawoffice\\.org\\.il',
    'מספר בנק:?',
    'סניף:?',
    'מספר חשבון:?',
    'Bank(?:\\s+number)?:?',
    'Branch:?',
    'Account(?:\\s+number)?:?',
    'SWIFT:?',
    'IBAN:?',
    'משרד עורכי דין',
  ];

  if (!hadNewlines && content.length > 80) {
    content = applyLabeledBreaks(content, '\\s+', paragraphLabels, lineLabels);
    content = content
      .replace(new RegExp(`${'\\s+'}(\\+972[\\d\\s\\-]+)`, 'g'), '\n$1')
      .replace(new RegExp(`${'\\s+'}(office@[^\\s]+)`, 'gi'), '\n$1');
    content = content
      .replace(/^(שלום[^\n,]{0,80},)\s+/u, '$1\n\n')
      .replace(/^(Hi[^\n,]{0,80},)\s+/i, '$1\n\n')
      .replace(/^(Hello[^\n,]{0,80},)\s+/i, '$1\n\n')
      .replace(/^(Dear[^\n,]{0,80},)\s+/i, '$1\n\n');
  } else {
    // Keep paragraph spacing for known section starts on their own lines…
    content = applyLabeledBreaks(content, '\\n', paragraphLabels, []);
    // …and still split flattened inline labels (bank details often stay on one line).
    content = applyLabeledBreaks(content, '\\s+', ['שם החשבון:?', 'בברכה,?', 'ניתן לשלם', 'מצורף', 'אנא עדכנו'], [
      'מספר בנק:?',
      'סניף:?',
      'מספר חשבון:?',
      'Bank(?:\\s+number)?:?',
      'Branch:?',
      'Account(?:\\s+number)?:?',
      'SWIFT:?',
      'IBAN:?',
    ]);
  }

  return content.replace(/\n{3,}/g, '\n\n').trim();
}

/** Reading-pane / modal email body: preserve breaks + clickable links. */
export function formatEmailHtmlForReadingPane(htmlOrText: string | null | undefined): string {
  if (!htmlOrText) return '';
  return linkifyEmailHtml(formatEmailBodyForTimeline(htmlOrText));
}

/** Format WhatsApp / plain timeline text while preserving blank lines. */
export function formatPlainBodyForTimeline(text: string | null | undefined): string {
  if (!text) return '';
  let content = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  content = content.replace(/<br\s*\/?>/gi, '\n');
  // If somehow HTML slipped in, strip tags after converting block ends.
  if (/<[a-z][\s\S]*>/i.test(content)) {
    content = content
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '');
  }
  content = content.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return content;
}

export const formatEmailHtmlForDisplay = (html: string | null | undefined): string => {
  if (!html) return '';

  let content = extractHtmlBody(html);

  content = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n');
  content = content.replace(/\n{3,}/g, '\n\n');

  const brPlaceholder = '__BR_PLACEHOLDER__';
  content = content.replace(/<br\s*\/?>/gi, brPlaceholder);
  content = content.replace(/\n\n/g, '__PARA_BREAK__');
  content = content.replace(/\n/g, '<br>');
  content = content.replace(/__PARA_BREAK__/g, '<br><br>');
  content = content.replace(new RegExp(brPlaceholder, 'g'), '<br>');
  content = content.replace(/<([^>]+)<br>([^>]*)>/gi, '<$1 $2>');
  content = content.replace(/<([^>]*)<br>([^>]+)>/gi, '<$1 $2>');
  // Do NOT strip whitespace between tags — that collapses email layout.
  content = content.replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>');
  content = content.trim();

  const hasDirection = /dir\s*=\s*["'](rtl|ltr|auto)["']/i.test(content);
  const hasWrapperDiv = /^<div[^>]*dir/i.test(content.trim());

  if (!hasDirection && !hasWrapperDiv) {
    content = `<div dir="auto" style="font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif; white-space: pre-wrap; line-height: 1.6;">${content}</div>`;
  }

  return linkifyEmailHtml(content);
};

/** Turn bare URLs / emails in HTML text nodes into clickable anchors. */
export function linkifyEmailHtml(html: string): string {
  if (!html) return html;

  const anchors: string[] = [];
  let out = html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (match) => {
    const idx = anchors.length;
    anchors.push(match);
    return `\u0000ANCHOR${idx}\u0000`;
  });

  const tags: string[] = [];
  out = out.replace(/<[^>]+>/g, (match) => {
    const idx = tags.length;
    tags.push(match);
    return `\u0000TAG${idx}\u0000`;
  });

  out = out.replace(/(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi, (raw) => {
    let url = raw;
    let trailing = '';
    while (/[.,);:!?]$/.test(url)) {
      trailing = `${url.slice(-1)}${trailing}`;
      url = url.slice(0, -1);
    }
    if (!url) return raw;
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>${trailing}`;
  });

  out = out.replace(
    /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
    (email) => `<a href="mailto:${email}">${email}</a>`,
  );

  out = out.replace(/\u0000TAG(\d+)\u0000/g, (_, i) => tags[Number(i)] || '');
  out = out.replace(/\u0000ANCHOR(\d+)\u0000/g, (_, i) => anchors[Number(i)] || '');
  return out;
}

export const isOfficeEmail = (email: string | null | undefined): boolean => {
  if (!email) return false;
  return email.toLowerCase().endsWith('@lawoffice.org.il');
};

export const EmailContentWithErrorHandling: React.FC<{ html: string; emailId: string }> = ({ html, emailId }) => {
  const contentRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!contentRef.current) return;

    const images = contentRef.current.querySelectorAll('img');

    const handleImageError = (img: HTMLImageElement) => {
      interactionsDevLog('Removing broken image:', img.src);
      img.remove();
    };

    images.forEach((img) => {
      if (!img.hasAttribute('data-error-handled')) {
        img.setAttribute('data-error-handled', 'true');
        img.addEventListener('error', () => handleImageError(img), { once: true });
      }
    });

    const iframes = contentRef.current.querySelectorAll('iframe, video, embed, object');
    iframes.forEach((element) => {
      if (!element.hasAttribute('data-error-handled')) {
        element.setAttribute('data-error-handled', 'true');
        element.addEventListener(
          'error',
          () => {
            interactionsDevLog('Removing broken embedded content:', element.tagName);
            element.remove();
          },
          { once: true }
        );
      }
    });

    return () => {
      images.forEach((img) => {
        const handler = () => handleImageError(img);
        img.removeEventListener('error', handler);
      });
    };
  }, [html, emailId]);

  return (
    <div
      ref={contentRef}
      dangerouslySetInnerHTML={{ __html: html }}
      className="prose prose-lg email-content max-w-none break-words text-gray-800 whitespace-pre-wrap [&_a]:text-blue-600 [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-blue-800 [&_.timeline-prewrap]:whitespace-pre-wrap"
      style={{
        wordBreak: 'break-word',
        overflowWrap: 'anywhere',
        whiteSpace: 'pre-wrap',
        lineHeight: '1.8',
        fontSize: '15px',
      }}
      dir="auto"
    />
  );
};

export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'b',
      'i',
      'u',
      'ul',
      'ol',
      'li',
      'br',
      'strong',
      'em',
      'a',
      'span',
      'div',
      'body',
      'img',
      'table',
      'tbody',
      'tr',
      'td',
      'th',
      'thead',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel', 'style'],
      span: ['style', 'dir', 'class', 'data-icon'],
      div: ['style', 'dir', 'class'],
      p: ['style', 'dir', 'class'],
      body: ['style', 'dir'],
      img: ['src', 'alt', 'style', 'width', 'height', 'crossorigin', 'class'],
      td: ['style', 'dir', 'colspan', 'rowspan', 'align'],
      th: ['style', 'dir', 'colspan', 'rowspan', 'align'],
      tr: ['style'],
      table: ['style', 'width', 'border', 'cellpadding', 'cellspacing'],
      '*': ['style', 'dir'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'data'],
    disallowedTagsMode: 'discard',
    textFilter: (text) => text,
  });
}
