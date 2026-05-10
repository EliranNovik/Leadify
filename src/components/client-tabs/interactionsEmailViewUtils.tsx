import React from 'react';
import sanitizeHtml from 'sanitize-html';
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

export const formatEmailHtmlForDisplay = (html: string | null | undefined): string => {
  if (!html) return '';

  let content = extractHtmlBody(html);

  content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  content = content.replace(/\n{3,}/g, '\n\n');

  const brPlaceholder = '__BR_PLACEHOLDER__';
  content = content.replace(/<br\s*\/?>/gi, brPlaceholder);
  content = content.replace(/\n\n/g, '__PARA_BREAK__');
  content = content.replace(/\n/g, '<br>');
  content = content.replace(/__PARA_BREAK__/g, '<br><br>');
  content = content.replace(new RegExp(brPlaceholder, 'g'), '<br>');
  content = content.replace(/<([^>]+)<br>([^>]*)>/gi, '<$1 $2>');
  content = content.replace(/<([^>]*)<br>([^>]+)>/gi, '<$1 $2>');
  content = content.replace(/>\s+/g, '>');
  content = content.replace(/\s+</g, '<');
  content = content.replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>');
  content = content.replace(/\n/g, ' ');
  content = content.replace(/(>)\s{2,}(<)/g, '$1 $2');
  content = content.trim();

  const hasDirection = /dir\s*=\s*["'](rtl|ltr|auto)["']/i.test(content);
  const hasWrapperDiv = /^<div[^>]*dir/i.test(content.trim());

  if (!hasDirection && !hasWrapperDiv) {
    content = `<div dir="auto" style="font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif;">${content}</div>`;
  }

  return content;
};

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
      className="prose prose-lg max-w-none text-gray-800 break-words email-content"
      style={{
        wordBreak: 'break-word',
        overflowWrap: 'anywhere',
        whiteSpace: 'normal',
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
