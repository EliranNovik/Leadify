import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  getCurrentUserEmailSignature,
  prefetchCurrentUserEmailSignature,
} from '../../lib/emailSignature';

if (typeof window !== 'undefined') {
  window.setTimeout(() => prefetchCurrentUserEmailSignature(), 0);
}

type ComposeSignaturePreviewProps = {
  compact?: boolean;
  className?: string;
};

const PREVIEW_WIDTH = 820;

export const COMPOSE_ACTION_BUTTON_CLASS =
  'btn btn-circle border-0 text-gray-600 hover:bg-gray-300 transition-all hover:scale-105';

export const COMPOSE_ACTION_BUTTON_STYLE: React.CSSProperties = {
  backgroundColor: '#E5E7EB',
  color: '#4B5563',
  width: 44,
  height: 44,
};

export const COMPOSE_SEND_BUTTON_CLASS =
  'btn h-11 min-h-11 rounded-full border-0 bg-[#4218CC] px-6 text-base font-semibold text-white hover:bg-[#3514a8] disabled:bg-gray-200 disabled:text-gray-400';

export const COMPOSE_CC_TOGGLE_CLASS =
  'shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500 hover:bg-gray-100 hover:text-gray-800';

function buildPreviewDocument(html: string, origin: string): string {
  const safeOrigin = origin.replace(/"/g, '');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <base href="${safeOrigin}/" />
  <style>
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      overflow: visible;
    }
    body { padding: 8px 0 10px; }
    img { max-width: none !important; }
    table { border-collapse: collapse; }
    a { text-decoration: none; }
  </style>
</head>
<body>${html}</body>
</html>`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read image'));
    reader.readAsDataURL(blob);
  });
}

/** srcDoc iframes often fail to load app-origin /signature-icons/ URLs. Embed small icons only. */
async function inlineLocalImagesForPreview(html: string): Promise<string> {
  if (typeof window === 'undefined' || !html) return html;
  const origin = window.location.origin;
  const srcs = [...html.matchAll(/\ssrc=(["'])([^"']+)\1/gi)].map((m) => m[2]);
  const unique = [...new Set(srcs)].filter((src) => {
    if (!src || src.startsWith('data:') || src.startsWith('cid:')) return false;
    return /\/signature-icons\//i.test(src);
  });
  if (unique.length === 0) return html;

  const replacements = new Map<string, string>();
  await Promise.all(
    unique.map(async (src) => {
      try {
        const absolute = /^https?:\/\//i.test(src)
          ? src
          : `${origin}${src.startsWith('/') ? src : `/${src}`}`;
        const res = await fetch(absolute);
        if (!res.ok) return;
        const dataUrl = await blobToDataUrl(await res.blob());
        if (dataUrl.startsWith('data:image')) replacements.set(src, dataUrl);
      } catch {
        /* preview-only; keep original src */
      }
    }),
  );

  let next = html;
  for (const [src, dataUrl] of replacements) {
    next = next.split(src).join(dataUrl);
  }
  return next;
}

let inlinedPreviewCache: { source: string; html: string } | null = null;

function loadInlinedSignatureHtml(source: string): Promise<string> {
  if (inlinedPreviewCache?.source === source) {
    return Promise.resolve(inlinedPreviewCache.html);
  }
  return inlineLocalImagesForPreview(source || '').then((html) => {
    inlinedPreviewCache = { source, html };
    return html;
  });
}

/** Read-only company signature shown under the compose box, like Outlook. */
export const ComposeSignaturePreview: React.FC<ComposeSignaturePreviewProps> = ({
  compact = false,
  className = '',
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(() => {
    let cancelled = false;
    void getCurrentUserEmailSignature().then((sig) => {
      if (cancelled || !sig) return;
      setHtml(sig);
      void loadInlinedSignatureHtml(sig).then((inlined) => {
        if (!cancelled && inlined) setHtml(inlined);
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const srcDoc = useMemo(
    () => (html ? buildPreviewDocument(html, origin) : ''),
    [html, origin],
  );

  const resizeIframe = () => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc?.body) return;
    const height = Math.max(
      doc.body.scrollHeight,
      doc.documentElement.scrollHeight,
      compact ? 120 : 160,
    );
    iframe.style.height = `${height + 8}px`;
  };

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const onLoad = () => {
      resizeIframe();
      const images = iframe.contentDocument?.querySelectorAll('img') || [];
      images.forEach((img) => {
        img.addEventListener('load', resizeIframe);
        img.addEventListener('error', resizeIframe);
      });
      window.setTimeout(resizeIframe, 50);
      window.setTimeout(resizeIframe, 250);
    };
    iframe.addEventListener('load', onLoad);
    return () => iframe.removeEventListener('load', onLoad);
  }, [srcDoc, compact]);

  if (!html) return null;

  return (
    <div className={`bg-white ${className}`}>
      <div className="overflow-x-auto px-4 pb-1 pt-2">
        <iframe
          ref={iframeRef}
          title="Your email signature"
          srcDoc={srcDoc}
          sandbox="allow-same-origin"
          onLoad={resizeIframe}
          className="pointer-events-none block border-0 bg-white"
          style={{ width: PREVIEW_WIDTH, minHeight: compact ? 120 : 160 }}
          tabIndex={-1}
        />
      </div>
    </div>
  );
};

type ComposeBodyWithSignatureProps = {
  children: React.ReactNode;
  className?: string;
  compact?: boolean;
  afterSignature?: React.ReactNode;
};

/** Outlook-style compose paper: message field on top, signature below. */
export const ComposeBodyWithSignature: React.FC<ComposeBodyWithSignatureProps> = ({
  children,
  className = '',
  compact = false,
  afterSignature,
}) => {
  return (
    <div
      className={`bg-white [&_textarea]:border-0 [&_textarea]:shadow-none [&_textarea]:outline-none [&_textarea]:ring-0 [&_textarea]:focus:border-0 [&_textarea]:focus:outline-none [&_textarea]:focus:ring-0 ${className}`}
    >
      <div>{children}</div>
      <ComposeSignaturePreview compact={compact} />
      {afterSignature}
    </div>
  );
};

export default ComposeSignaturePreview;
