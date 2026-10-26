import { useEffect, useState } from 'react';
import { ArrowDownTrayIcon, PaperClipIcon } from '@heroicons/react/24/outline';
import sanitizeHtml from '../lib/sanitizeHtml';
import {
  parseOutlookMsg,
  type OutlookMsgAttachment,
  type OutlookMsgEmail,
} from '../lib/outlookMsgFile';

/** A message this large is a sign of something other than mail, and is left to the download. */
const SIZE_LIMIT = 64 * 1024 * 1024;

/**
 * The body is somebody else's HTML, written years ago by whichever mail program sent it, so it is
 * cut back to what a letter needs. Images are the one place a local address is allowed, since the
 * pictures inside a message are handed over as blobs from the file itself.
 */
function sanitiseMessageHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'b', 'i', 'u', 's', 'strong', 'em', 'br', 'hr', 'a', 'span', 'div', 'pre', 'blockquote',
      'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td',
      'th', 'caption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'font', 'sub', 'sup', 'small',
    ],
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel', 'style', 'title'],
      img: ['src', 'alt', 'title', 'width', 'height', 'style', 'border'],
      font: ['color', 'face', 'size'],
      table: ['style', 'width', 'border', 'cellpadding', 'cellspacing', 'align', 'dir', 'bgcolor'],
      td: ['style', 'colspan', 'rowspan', 'align', 'valign', 'width', 'height', 'dir', 'bgcolor'],
      th: ['style', 'colspan', 'rowspan', 'align', 'valign', 'width', 'dir', 'bgcolor'],
      tr: ['style', 'align', 'valign', 'dir', 'bgcolor'],
      '*': ['style', 'dir', 'lang'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'data', 'blob'] },
    transformTags: {
      // A link out of a saved message opens away from the CRM, never in place of it.
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' },
      }),
    },
  });
}

function blobFor(attachment: OutlookMsgAttachment): Blob | null {
  if (!attachment.bytes) return null;
  return new Blob([attachment.bytes], {
    type: attachment.mimeType || 'application/octet-stream',
  });
}

function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AddressLine({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-14 shrink-0 text-slate-400">{label}</span>
      <span className="min-w-0 flex-1 break-words text-slate-700" dir="auto">
        {value}
      </span>
    </div>
  );
}

/**
 * An Outlook message shown as the letter it is, rather than as a file that cannot be previewed.
 * Everything is read in the browser out of the `.msg` itself: nothing is uploaded or sent anywhere
 * to be converted.
 */
export default function OutlookMsgView({
  url,
  fileName,
  onDownloadOriginal,
}: {
  url: string;
  fileName: string;
  onDownloadOriginal?: () => void;
}) {
  const [mail, setMail] = useState<OutlookMsgEmail | null>(null);
  const [bodyHtml, setBodyHtml] = useState<string | null>(null);
  const [inlineNames, setInlineNames] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailure(null);
    setMail(null);
    void (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`The file could not be read (${response.status})`);
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > SIZE_LIMIT) throw new Error('This message is too large to open here');
        const parsed = await parseOutlookMsg(new Uint8Array(buffer));
        if (!cancelled) setMail(parsed);
      } catch (cause) {
        if (!cancelled) {
          setFailure(cause instanceof Error ? cause.message : 'This message could not be read');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    if (!mail?.bodyHtml) {
      setBodyHtml(null);
      setInlineNames([]);
      return;
    }
    // Pictures inside the message are addressed by content id. Each one is handed to the browser
    // as a blob from the file's own bytes, and let go of again when the message is closed.
    const handed: string[] = [];
    const shownInBody: string[] = [];
    let html = mail.bodyHtml;
    for (const attachment of mail.attachments) {
      const reference = attachment.contentId ? `cid:${attachment.contentId}` : null;
      const blob = reference && html.includes(reference) ? blobFor(attachment) : null;
      if (!reference || !blob) continue;
      const href = URL.createObjectURL(blob);
      handed.push(href);
      shownInBody.push(attachment.name);
      html = html.split(reference).join(href);
    }
    setBodyHtml(sanitiseMessageHtml(html));
    setInlineNames(shownInBody);
    return () => {
      handed.forEach((href) => URL.revokeObjectURL(href));
    };
  }, [mail]);

  const saveAttachment = (attachment: OutlookMsgAttachment) => {
    const blob = blobFor(attachment);
    if (!blob) return;
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = attachment.name;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked late: Safari reads the blob after the click has already returned.
    window.setTimeout(() => URL.revokeObjectURL(href), 20000);
  };

  if (loading) {
    return (
      <div
        data-doc-viewer-backdrop
        className="flex min-h-0 w-full flex-1 items-center justify-center text-white/80"
      >
        <div className="text-center">
          <span className="loading loading-spinner loading-lg" />
          <p className="mt-4 text-sm opacity-80">Opening message…</p>
        </div>
      </div>
    );
  }

  if (failure || !mail) {
    return (
      <div data-doc-viewer-backdrop className="flex min-h-0 w-full flex-1 items-center justify-center p-6">
        <div className="max-w-md text-center text-white/80">
          <p className="text-lg font-semibold">This message could not be opened</p>
          <p className="mt-2 text-sm opacity-80">{failure}</p>
          {onDownloadOriginal ? (
            <button type="button" className="btn btn-primary btn-sm mt-4" onClick={onDownloadOriginal}>
              Download
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  // Pictures the body already shows are not listed a second time beneath the subject.
  const listedAttachments = mail.attachments.filter(
    (attachment) => !inlineNames.includes(attachment.name),
  );
  const sentLabel = mail.sentAt
    ? mail.sentAt.toLocaleString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  return (
    // The space either side of the letter is the viewer's backdrop, and closes it when clicked.
    <div data-doc-viewer-backdrop className="min-h-0 w-full flex-1 overflow-auto p-3 md:p-6">
      <article className="mx-auto w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="border-b border-slate-200 px-5 py-4 md:px-7 md:py-5">
          <h1 className="text-lg font-semibold text-slate-900 md:text-xl" dir="auto">
            {mail.subject || fileName}
          </h1>
          <div className="mt-3 space-y-1">
            <AddressLine
              label="From"
              value={[mail.fromName, mail.fromEmail].filter(Boolean).join(' · ')}
            />
            <AddressLine label="To" value={mail.to} />
            <AddressLine label="Cc" value={mail.cc} />
            <AddressLine label="Sent" value={sentLabel} />
          </div>

          {listedAttachments.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {listedAttachments.map((attachment, index) => (
                <button
                  key={`${attachment.name}-${index}`}
                  type="button"
                  className="flex max-w-full items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 disabled:opacity-60"
                  onClick={() => saveAttachment(attachment)}
                  disabled={!attachment.bytes}
                  title={
                    attachment.bytes
                      ? `Save ${attachment.name}`
                      : 'A message attached to a message cannot be saved from here'
                  }
                >
                  <PaperClipIcon className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 truncate font-medium" dir="auto">
                    {attachment.name}
                  </span>
                  {attachment.size > 0 ? (
                    <span className="shrink-0 text-slate-400">{fileSizeLabel(attachment.size)}</span>
                  ) : null}
                  {attachment.bytes ? (
                    <ArrowDownTrayIcon className="h-4 w-4 shrink-0 text-slate-400" />
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </header>

        <div className="px-5 py-5 md:px-7 md:py-6">
          {bodyHtml ? (
            <div
              className="msg-body max-w-none break-words text-[15px] leading-relaxed text-slate-800 [&_a]:text-blue-600 [&_a]:underline [&_img]:max-w-full [&_table]:max-w-full"
              style={{ overflowWrap: 'anywhere' }}
              dir="auto"
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          ) : mail.bodyText ? (
            <div
              className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-800"
              dir="auto"
            >
              {mail.bodyText}
            </div>
          ) : (
            <p className="text-sm text-slate-500">This message has no text of its own.</p>
          )}
          {mail.bodyFromRtf ? (
            <p className="mt-6 border-t border-slate-200 pt-3 text-xs text-slate-400">
              This message was stored in Outlook's own format, so it is shown as plain text.
            </p>
          ) : null}
        </div>
      </article>
    </div>
  );
}
