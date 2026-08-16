import type { CompanySignatureSettings, SignaturePerson } from './companyEmailSignature';
import { generateEmailSignatureHtml } from './generateEmailSignatureHtml';

function signatureOrigin(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

export function buildOutlookSignatureHtml(
  person: SignaturePerson,
  settings: CompanySignatureSettings,
): string {
  return generateEmailSignatureHtml(person, settings, {
    origin: signatureOrigin(),
    force: true,
  }).trim();
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|table)>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function outlookClipboardDocument(html: string): string {
  return `<!DOCTYPE html><html><body><!--StartFragment-->${html}<!--EndFragment--></body></html>`;
}

function copyHtmlViaContentEditable(html: string): boolean {
  const host = document.createElement('div');
  host.contentEditable = 'true';
  host.style.position = 'fixed';
  host.style.left = '-9999px';
  host.style.top = '0';
  host.innerHTML = html;
  document.body.appendChild(host);

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(host);
  selection?.removeAllRanges();
  selection?.addRange(range);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  selection?.removeAllRanges();
  document.body.removeChild(host);
  return ok;
}

/** Copy signature HTML so Outlook's signature editor can paste it formatted. */
export async function copyOutlookSignatureToClipboard(html: string): Promise<void> {
  const trimmed = String(html || '').trim();
  if (!trimmed) {
    throw new Error('This employee does not have a signature to copy yet.');
  }

  const plain = htmlToPlainText(trimmed);
  const wrapped = outlookClipboardDocument(trimmed);

  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([wrapped], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ]);
      return;
    } catch {
      /* fall through */
    }
  }

  if (copyHtmlViaContentEditable(trimmed)) return;

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(trimmed);
    return;
  }

  throw new Error('Could not copy the signature. Allow clipboard access and try again.');
}

export async function copyOutlookSignatureHtmlSource(html: string): Promise<void> {
  const trimmed = String(html || '').trim();
  if (!trimmed) {
    throw new Error('This employee does not have a signature to copy yet.');
  }
  if (!navigator.clipboard?.writeText) {
    throw new Error('Could not copy the signature HTML.');
  }
  await navigator.clipboard.writeText(trimmed);
}
