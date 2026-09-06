import React from 'react';
import sanitizeHtml from '../../lib/sanitizeHtml';
import { interactionsDevLog } from '../../lib/interactions/devLog';
import { isCrmComposeEmailHtml, splitEmailBodyAndSignature, escapeHtml } from '../../lib/emailBodyHtml';
import {
  applyContractLinkPreviewHtml,
  extractContractPreviewTables,
  restoreContractPreviewTables,
} from '../../lib/leadContractLink';

const extractHtmlBody = (html: string) => {
  if (!html) return html;
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : html;
};

const EMAIL_SIGNATURE_SPLIT_HTML =
  '<div class="email-signature-split" style="margin:16px 0 14px;border-top:1px solid #E5E7EB;padding-top:14px;"><div style="width:48px;height:4px;background-color:#C4A574;border-radius:2px;"></div></div>';

export function isAssembledEmailDisplayHtml(html: string | null | undefined): boolean {
  return /class=["'][^"']*\bemail-signature-block\b/i.test(String(html || ''));
}

function decodeDisplayEntities(text: string): string {
  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
  }
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

/** Strip photos/logos/tables from a company signature for CRM cards and modals. */
function signatureHtmlToPlainLines(signatureHtml: string): string[] {
  let content = String(signatureHtml || '');
  content = content
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|table|blockquote)>/gi, '\n')
    .replace(/<\/td>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  content = decodeDisplayEntities(content).replace(/\u00a0/g, ' ');

  const lines: string[] = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/[ \t]+/g, ' ').trim();
    if (!line) continue;
    if (lines[lines.length - 1] === line) continue;
    lines.push(line);
  }
  return lines;
}

function wrapSignatureHtml(signatureHtml: string): string {
  const lines = signatureHtmlToPlainLines(signatureHtml);
  if (lines.length === 0) return '';
  const inner = linkifyEmailHtml(
    lines.map((line) => `<div>${escapeHtml(line)}</div>`).join(''),
  );
  return `${EMAIL_SIGNATURE_SPLIT_HTML}<div class="email-signature-block email-signature-plain" style="font-family:'Segoe UI',Arial,'Helvetica Neue',sans-serif;color:#4B5563;font-size:13px;line-height:1.55;">${inner}</div>`;
}

function flattenAssembledSignature(html: string): string {
  const source = String(html || '');
  const splitAt = source.search(
    /<div\b[^>]*class=["'][^"']*\bemail-signature-(?:split|block)\b/i,
  );
  if (splitAt < 0) return source;
  const signaturePart = source.slice(splitAt);
  if (!/<table\b/i.test(signaturePart) && !/<img\b/i.test(signaturePart)) {
    return source;
  }
  const blockMatch = signaturePart.match(
    /<div\b[^>]*class=["'][^"']*\bemail-signature-block\b[^>]*>([\s\S]*)<\/div>\s*$/i,
  );
  const signatureHtml = blockMatch ? blockMatch[1] : signaturePart;
  return `${source.slice(0, splitAt)}${wrapSignatureHtml(signatureHtml)}`;
}

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

const SIGNATURE_FILE_NAME_RE =
  /^(signature-icon[-_]?\d+|signature[-_]?\d+|signature-image[-_]?\d+)\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;

function attachmentName(att: any): string {
  return String(att?.name || att?.filename || att?.fileName || att?.Name || '').trim();
}

function attachmentContentId(att: any): string {
  return String(att?.contentId || att?.content_id || att?.contentID || '')
    .replace(/^<|>$/g, '')
    .trim();
}

function attachmentContentType(att: any): string {
  return String(att?.contentType || att?.content_type || att?.mimeType || '').toLowerCase();
}

function isTruthyInlineFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

/** Signature CID icons and other inline images must not appear as downloadable files. */
export function isSignatureOrInlineEmailAttachment(att: any): boolean {
  if (!att) return false;
  if (isTruthyInlineFlag(att.isInline) || isTruthyInlineFlag(att.is_inline)) return true;

  const name = attachmentName(att);
  if (SIGNATURE_FILE_NAME_RE.test(name) || /signature-icon/i.test(name)) return true;

  const cid = attachmentContentId(att);
  if (/^signature-(icon|image)[-_]/i.test(cid)) return true;

  const contentType = attachmentContentType(att);
  const looksLikeImage =
    contentType.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(name);
  if (cid && looksLikeImage) return true;

  return false;
}

export function fileAttachmentsForUi(attachments: any[]): any[] {
  return (attachments || []).filter(
    (att: any) => att && !isSignatureOrInlineEmailAttachment(att) && (att.name || att.id),
  );
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
  const raw = extractHtmlBody(String(htmlOrText));
  if (isAssembledEmailDisplayHtml(raw)) {
    // #region agent log
    fetch('http://127.0.0.1:7270/ingest/eeb50a38-afe4-4c94-8d17-bf7f20d90d0c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7db878'},body:JSON.stringify({sessionId:'7db878',runId:'pre-fix',hypothesisId:'H1',location:'interactionsEmailViewUtils.tsx:formatEmailBodyForTimeline',message:'assembled-html skip',data:{inLen:raw.length,inBr:(raw.match(/<br\s*\/?>/gi)||[]).length,inNl:(raw.match(/\n/g)||[]).length,inDiv:(raw.match(/<\/div>/gi)||[]).length,inP:(raw.match(/<\/p>/gi)||[]).length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return flattenAssembledSignature(raw);
  }

  const { body, signature } = splitEmailBodyAndSignature(raw);
  // #region agent log
  fetch('http://127.0.0.1:7270/ingest/eeb50a38-afe4-4c94-8d17-bf7f20d90d0c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7db878'},body:JSON.stringify({sessionId:'7db878',runId:'pre-fix',hypothesisId:'H5',location:'interactionsEmailViewUtils.tsx:formatEmailBodyForTimeline',message:'split body/signature',data:{rawLen:raw.length,bodyLen:body.length,sigLen:signature.length,wholeAsSig:body.trim().length===0&&signature.length>0},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  const withCards = applyContractLinkPreviewHtml(body);
  const contractPreviews = extractContractPreviewTables(withCards);
  const formattedBody = restoreContractPreviewTables(
    formatEmailBodyInner(contractPreviews.text),
    contractPreviews.blocks,
  );
  if (!signature.trim()) return formattedBody;
  return `${formattedBody}${wrapSignatureHtml(signature)}`;
}

function formatEmailBodyInner(htmlOrText: string | null | undefined): string {
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
      // Opening block tags also imply a line break (Gmail often uses <div>per line</div>).
      .replace(/<(div|p|tr|li|h[1-6]|blockquote|hr)(\s[^>]*)?>/gi, '\n')
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

  const afterStripNl = (content.match(/\n/g) || []).length;
  const afterStripLen = content.length;
  const httpGlued = /[^\s]https?:\/\//i.test(content);
  content = restoreFlattenedEmailLineBreaks(content);
  content = stripEmailQuoteMarkers(content);
  // #region agent log
  fetch('http://127.0.0.1:7270/ingest/eeb50a38-afe4-4c94-8d17-bf7f20d90d0c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7db878'},body:JSON.stringify({sessionId:'7db878',runId:'pre-fix',hypothesisId:'H2',location:'interactionsEmailViewUtils.tsx:formatEmailBodyInner',message:'after strip+restore',data:{afterStripLen,afterStripNl,afterRestoreNl:(content.match(/\n/g)||[]).length,httpGlued,hasHttp:/https?:\/\//i.test(content),hasShalom:/שלום/.test(content)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  const escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Use real <br> tags (not only pre-wrap + \n). pre-wrap was flashing then collapsing when
  // parent CSS / re-renders reset white-space. <br> survives those races.
  const withBreaks = escaped.replace(/\n/g, '<br />');

  return `<div dir="auto" class="timeline-prewrap" style="font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif; white-space: normal; line-height: 1.55;">${withBreaks}</div>`;
}

/** Remove leading `>` / `>>` quote markers from each line (keep the quoted text). */
function stripEmailQuoteMarkers(text: string): string {
  return String(text || '')
    .split('\n')
    .map((line) => line.replace(/^(?:[ \t]*>[ \t]*)+/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Restore breaks when Graph/HTML flattened an email into one run-on line. */
function restoreFlattenedEmailLineBreaks(text: string): string {
  let content = text;
  const hadNewlines = content.includes('\n');
  // #region agent log
  fetch('http://127.0.0.1:7270/ingest/eeb50a38-afe4-4c94-8d17-bf7f20d90d0c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7db878'},body:JSON.stringify({sessionId:'7db878',runId:'pre-fix',hypothesisId:'H2',location:'interactionsEmailViewUtils.tsx:restoreFlattenedEmailLineBreaks',message:'restore entry',data:{hadNewlines,len:content.length,nl:(content.match(/\n/g)||[]).length,skipGreeting:hadNewlines},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

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
    '-----Original Message-----',
    'Begin forwarded message:',
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
    'From:',
    'Sent:',
    'To:',
    'Cc:',
    'Subject:',
  ];

  // Always restore Gmail/Outlook quote markers — these are the lines that "flash then flatten".
  content = content
    .replace(/\s+(On\s+.+?wrote:)/gi, '\n\n$1')
    .replace(/\s+(-----Original Message-----)/gi, '\n\n$1')
    .replace(/\s+(Begin forwarded message:)/gi, '\n\n$1')
    // " > quoted" / " > > quoted" markers that got smashed onto one line
    .replace(/([^\n])[ \t]+(>+)(?=[ \t]|[A-Za-zא-ת"']|$)/g, '$1\n$2');
  // Company signature fields mashed into one preview line
  content = content
    .replace(/\s+(\+?972[\d\s\-]+|\b0\d[\d\s\-]{7,}\d)\b/g, '\n$1')
    .replace(/\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '\n$1')
    .replace(/\s+(https?:\/\/[^\s]+)/gi, '\n$1')
    .replace(/\s+(www\.[^\s]+)/gi, '\n$1');
  // Split stacked quote markers: "> > Hi" → ">\n> Hi" (spaces/tabs only — not newlines)
  content = content.replace(/(>)[ \t]+(?=>)/g, '$1\n');

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
    // …and still split flattened inline labels (bank details / quote headers often stay on one line).
    content = applyLabeledBreaks(
      content,
      '\\s+',
      [
        'שם החשבון:?',
        'בברכה,?',
        'ניתן לשלם',
        'מצורף',
        'אנא עדכנו',
        '-----Original Message-----',
        'Begin forwarded message:',
      ],
      [
        'מספר בנק:?',
        'סניף:?',
        'מספר חשבון:?',
        'Bank(?:\\s+number)?:?',
        'Branch:?',
        'Account(?:\\s+number)?:?',
        'SWIFT:?',
        'IBAN:?',
        'From:',
        'Sent:',
        'To:',
        'Cc:',
        'Subject:',
      ],
    );
  }

  return content.replace(/\n{3,}/g, '\n\n').trim();
}

/** Reading-pane / modal email body: preserve breaks + clickable links. */
export function formatEmailHtmlForReadingPane(htmlOrText: string | null | undefined): string {
  if (!htmlOrText) return '';
  return linkifyEmailHtml(formatEmailBodyForTimeline(htmlOrText));
}

/** True when HTML is already our pre-wrap reading/timeline wrapper. */
export function isTimelinePrewrapHtml(html: string | null | undefined): boolean {
  return /class=["'][^"']*\btimeline-prewrap\b/i.test(String(html || ''));
}

/** Extract plain text (+ newlines) from an existing timeline-prewrap body. */
export function extractTimelinePrewrapText(html: string): string {
  const contractPreviews = extractContractPreviewTables(String(html || ''));
  let content = contractPreviews.text;
  content = content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n');
  // Drop the wrapper / remaining tags
  content = content.replace(/<[^>]+>/g, '');
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
  return restoreContractPreviewTables(
    content.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim(),
    contractPreviews.blocks,
  );
}

/** Count visual line breaks — used to avoid replacing a well-broken body with a flatter one. */
export function countEmailBreakSignals(htmlOrText: string | null | undefined): number {
  const s = String(htmlOrText || '');
  return (
    (s.match(/<br\s*\/?>/gi) || []).length +
    (s.match(/\n/g) || []).length +
    (s.match(/<\/div>/gi) || []).length
  );
}

/**
 * Idempotent display formatter. Always rebuilds from text so we never keep a
 * "timeline-prewrap" wrapper that lost its breaks after a state race.
 */
export function ensureFormattedEmailHtml(htmlOrText: string | null | undefined): string {
  if (!htmlOrText) return '';
  const raw = String(htmlOrText);
  // Keep already-assembled timeline HTML (body + signature table). Re-extracting
  // tags here used to flatten the signature back into one paragraph.
  if (isAssembledEmailDisplayHtml(raw)) {
    const assembledOut = sanitizeEmailHtml(flattenAssembledSignature(raw));
    // #region agent log
    fetch('http://127.0.0.1:7270/ingest/eeb50a38-afe4-4c94-8d17-bf7f20d90d0c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7db878'},body:JSON.stringify({sessionId:'7db878',runId:'pre-fix',hypothesisId:'H1',location:'interactionsEmailViewUtils.tsx:ensureFormattedEmailHtml',message:'assembled branch',data:{inLen:raw.length,inBr:(raw.match(/<br\s*\/?>/gi)||[]).length,outBr:(assembledOut.match(/<br\s*\/?>/gi)||[]).length,outDiv:(assembledOut.match(/<\/div>/gi)||[]).length,prewrap:/timeline-prewrap/i.test(raw)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return assembledOut;
  }
  const prepared = applyContractLinkPreviewHtml(raw);
  const contractPreviews = extractContractPreviewTables(prepared);
  const source = isTimelinePrewrapHtml(contractPreviews.text)
    ? extractTimelinePrewrapText(contractPreviews.text)
    : contractPreviews.text;
  if (!source.trim() && contractPreviews.blocks.length === 0) return '';
  const out = sanitizeEmailHtml(
    restoreContractPreviewTables(formatEmailHtmlForReadingPane(source), contractPreviews.blocks),
  );
  // #region agent log
  fetch('http://127.0.0.1:7270/ingest/eeb50a38-afe4-4c94-8d17-bf7f20d90d0c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'7db878'},body:JSON.stringify({sessionId:'7db878',runId:'pre-fix',hypothesisId:'H3',location:'interactionsEmailViewUtils.tsx:ensureFormattedEmailHtml',message:'rebuild branch',data:{inLen:raw.length,inBr:(raw.match(/<br\s*\/?>/gi)||[]).length,inNl:(raw.match(/\n/g)||[]).length,usedPrewrapExtract:isTimelinePrewrapHtml(contractPreviews.text),outLen:out.length,outBr:(out.match(/<br\s*\/?>/gi)||[]).length,outNl:(out.match(/\n/g)||[]).length},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return out;
}

/** Visible plain-text length — used to prefer hydrated full bodies over short list previews. */
export function emailBodyPlainTextLength(htmlOrText: string | null | undefined): number {
  if (!htmlOrText) return 0;
  return String(htmlOrText)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

/**
 * Body is stable enough to show in the reading pane without a late reformat flash.
 * Short list previews are NOT stable — wait for hydrate so formatting does not snap ~2s later.
 */
export function emailBodyLooksStableForReading(htmlOrText: string | null | undefined): boolean {
  const raw = String(htmlOrText || '').trim();
  if (!raw) return false;
  // CRM compose HTML is the full body we generated — show it; do not wait for Graph hydrate.
  if (isCrmComposeEmailHtml(raw)) return true;
  if (isAssembledEmailDisplayHtml(raw)) return true;
  const len = emailBodyPlainTextLength(raw);
  const plain = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // List/Graph truncations — never treat as final reading body
  if (/…|\.\.\.\s*$/.test(plain)) return false;
  if (len < 12) return false;

  const breaks = countEmailBreakSignals(raw);
  // Full-ish bodies
  if (len >= 200) return true;
  if (isTimelinePrewrapHtml(raw) && breaks >= 1 && len >= 100) return true;
  if (breaks >= 2 && len >= 120) return true;
  // Short complete replies ("Thanks!", "OK") already formatted — OK to show immediately
  if (isTimelinePrewrapHtml(raw) && len < 80 && breaks <= 4) return true;
  return false;
}

/**
 * When refetching the email list (no/short body), keep a richer hydrated body already in state.
 * Prefer bodies with more line-break signals so formatting does not "flash then disappear".
 */
export function mergeEmailBodyPreferRicher<T extends Record<string, any>>(
  incoming: T,
  existing: T | undefined | null,
): T {
  if (!existing) return incoming;

  const incomingHtml = incoming.body_html || incoming.bodyPreview || incoming.body_preview || '';
  const existingHtml = existing.body_html || existing.bodyPreview || existing.body_preview || '';
  const incomingLen = emailBodyPlainTextLength(incomingHtml);
  const existingLen = emailBodyPlainTextLength(existingHtml);
  const incomingBreaks = countEmailBreakSignals(incomingHtml);
  const existingBreaks = countEmailBreakSignals(existingHtml);

  const existingIsFormatted = isTimelinePrewrapHtml(existingHtml);
  const incomingIsFormatted = isTimelinePrewrapHtml(incomingHtml);
  const existingRicher = existingLen > incomingLen + 40;
  const existingDensity = existingBreaks / Math.max(existingLen, 1);
  const incomingDensity = incomingBreaks / Math.max(incomingLen, 1);
  const existingBetterBroken =
    existingIsFormatted &&
    existingBreaks >= 2 &&
    (existingBreaks > incomingBreaks || existingDensity > incomingDensity * 1.8);
  const keepExistingBody =
    existingRicher ||
    existingBetterBroken ||
    (!incomingHtml && !!existingHtml) ||
    (existingIsFormatted && !incomingIsFormatted && existingLen >= incomingLen);

  if (!keepExistingBody) return incoming;

  return {
    ...incoming,
    body_html: existing.body_html || incoming.body_html || null,
    bodyPreview:
      existing.bodyPreview || existing.body_preview || incoming.bodyPreview || incoming.body_preview,
    body_preview:
      existing.body_preview || existing.bodyPreview || incoming.body_preview || incoming.bodyPreview,
    attachments:
      fileAttachmentsForUi(parseEmailAttachmentsFromDb(existing.attachments)).length >
      fileAttachmentsForUi(parseEmailAttachmentsFromDb(incoming.attachments)).length
        ? existing.attachments
        : incoming.attachments ?? existing.attachments,
  };
}

function emailSidepanelKey(email: Record<string, any> | null | undefined): string {
  if (!email) return '';
  const mid = email.message_id != null ? String(email.message_id).trim() : '';
  if (mid) return mid;
  return email.id != null ? String(email.id) : '';
}

/** Union two sidepanel lists. Never drop already-visible rows when a later fetch returns empty/partial. */
export function mergeEmailSidepanelLists<T extends Record<string, any>>(
  prev: T[] | null | undefined,
  incoming: T[] | null | undefined,
): T[] {
  const existing = Array.isArray(prev) ? prev : [];
  const next = Array.isArray(incoming) ? incoming : [];
  if (next.length === 0) return existing;
  if (existing.length === 0) return next;

  const byKey = new Map<string, T>();
  const unmatched: T[] = [];

  for (const row of existing) {
    const key = emailSidepanelKey(row);
    if (key) byKey.set(key, row);
    else unmatched.push(row);
  }
  for (const row of next) {
    const key = emailSidepanelKey(row);
    if (!key) {
      unmatched.push(row);
      continue;
    }
    const current = byKey.get(key);
    byKey.set(key, current ? mergeEmailBodyPreferRicher(row, current) : row);
  }

  return [...byKey.values(), ...unmatched];
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
      className="email-content max-w-none break-words text-gray-800 [&_a]:text-blue-600 [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-blue-800 [&_table[data-contract-preview]_a]:text-white [&_table[data-contract-preview]_a]:no-underline hover:[&_table[data-contract-preview]_a]:text-white [&_.timeline-prewrap]:whitespace-normal [&_.email-signature-block]:overflow-x-auto [&_.email-signature-block_table]:w-auto [&_.email-signature-block_img]:max-w-none"
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
      a: ['href', 'target', 'rel', 'style', 'class'],
      span: ['style', 'dir', 'class', 'data-icon'],
      div: [
        'style',
        'dir',
        'class',
        'data-email-signature',
        'data-contract-preview',
        'data-href',
        'data-signed',
        'data-lead-number',
      ],
      p: ['style', 'dir', 'class'],
      body: ['style', 'dir'],
      img: ['src', 'alt', 'style', 'width', 'height', 'border', 'crossorigin', 'class'],
      td: [
        'style',
        'dir',
        'colspan',
        'rowspan',
        'align',
        'valign',
        'width',
        'height',
        'bgcolor',
        'data-signature-gold',
      ],
      th: ['style', 'dir', 'colspan', 'rowspan', 'align', 'valign', 'width', 'height', 'bgcolor'],
      tr: ['style'],
      table: [
        'style',
        'width',
        'height',
        'border',
        'cellpadding',
        'cellspacing',
        'role',
        'align',
        'bgcolor',
        'data-email-signature',
        'data-contract-preview',
        'data-href',
        'data-signed',
        'data-lead-number',
      ],
      '*': ['style', 'dir'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'data', 'cid'],
    disallowedTagsMode: 'discard',
    textFilter: (text) => text,
  });
}
