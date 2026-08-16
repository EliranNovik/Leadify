import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardDocumentIcon, CodeBracketIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import type { CompanySignatureSettings, SignaturePerson } from '../../lib/companyEmailSignature';
import { generateEmailSignatureHtml } from '../../lib/generateEmailSignatureHtml';
import {
  copyOutlookSignatureHtmlSource,
  copyOutlookSignatureToClipboard,
} from '../../lib/copyOutlookSignature';

type SignaturePreviewProps = {
  user: SignaturePerson;
  companySettings: CompanySignatureSettings;
  className?: string;
  showCopyActions?: boolean;
};

const PREVIEW_WIDTH = 820;

function buildPreviewDocument(html: string, origin?: string): string {
  const base = origin ? `<base href="${origin.replace(/"/g, '')}/" />` : '';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  ${base}
  <style>
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      overflow: visible;
    }
    body { padding: 8px 0 24px; }
    img {
      max-width: none !important;
    }
    table {
      border-collapse: collapse;
    }
    a { text-decoration: none; }
  </style>
</head>
<body>${html}</body>
</html>`;
}

const SignaturePreview: React.FC<SignaturePreviewProps> = ({
  user,
  companySettings,
  className = '',
  showCopyActions = true,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [copying, setCopying] = useState<'outlook' | 'html' | null>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : undefined;
  const html = generateEmailSignatureHtml(user, companySettings, { origin, force: true });
  const srcDoc = useMemo(() => (html ? buildPreviewDocument(html, origin) : ''), [html, origin]);

  const disabled = !companySettings.signature_enabled || !user.signatureEnabled;

  const resizeIframe = () => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc?.body) return;
    const height = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, 180);
    iframe.style.height = `${height}px`;
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
    };
    iframe.addEventListener('load', onLoad);
    return () => iframe.removeEventListener('load', onLoad);
  }, [srcDoc]);

  const handleCopyOutlook = async () => {
    setCopying('outlook');
    try {
      await copyOutlookSignatureToClipboard(html);
      toast.success('Signature copied. Paste it in Outlook: File → Options → Mail → Signatures.');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Could not copy signature');
    } finally {
      setCopying(null);
    }
  };

  const handleCopyHtml = async () => {
    setCopying('html');
    try {
      await copyOutlookSignatureHtmlSource(html);
      toast.success('HTML copied. Paste into Outlook’s HTML signature source.');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Could not copy HTML');
    } finally {
      setCopying(null);
    }
  };

  return (
    <div className={`rounded-[18px] border border-gray-100 bg-white shadow-sm ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-50 px-5 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Live preview</p>
          <p className="text-sm font-medium text-gray-800">How the signature looks in outgoing email</p>
        </div>
        {showCopyActions && html ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-sm rounded-full"
              disabled={copying !== null}
              onClick={() => void handleCopyOutlook()}
            >
              <ClipboardDocumentIcon className="h-4 w-4" />
              {copying === 'outlook' ? 'Copying…' : 'Copy for Outlook'}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost rounded-full"
              disabled={copying !== null}
              onClick={() => void handleCopyHtml()}
            >
              <CodeBracketIcon className="h-4 w-4" />
              {copying === 'html' ? 'Copying…' : 'Copy HTML'}
            </button>
          </div>
        ) : null}
      </div>
      <div className="bg-[#f7f7f8] px-5 py-6">
        {disabled ? (
          <p className="mb-4 text-sm text-gray-500">
            This signature is turned off
            {!companySettings.signature_enabled ? ' for the whole company' : ' for this employee'}
            {showCopyActions && html ? ' — you can still copy it for Outlook.' : '.'}
          </p>
        ) : null}
        {html ? (
          <div className="overflow-x-auto rounded-xl bg-white p-4 shadow-sm">
            <iframe
              ref={iframeRef}
              title="Email signature preview"
              srcDoc={srcDoc}
              sandbox="allow-same-origin"
              onLoad={resizeIframe}
              className="block border-0 bg-white"
              style={{ width: PREVIEW_WIDTH, minHeight: 180 }}
            />
          </div>
        ) : (
          <p className="text-sm text-gray-500">Add a name or contact details to see the signature.</p>
        )}
      </div>
    </div>
  );
};

export default SignaturePreview;
