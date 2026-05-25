import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowPathIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import { paymentFormErrorCopy } from '../lib/paymentPageUtils';

interface PelecardCheckoutFrameProps {
  paymentUrl: string | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  title?: string;
  onCheckoutNavigate?: (pathWithQuery: string) => void;
  /** Extra classes on the iframe shell (e.g. full-bleed on mobile). */
  shellClassName?: string;
}

function CheckoutSkeleton() {
  return (
    <div className="space-y-3 py-2 animate-pulse w-full max-w-sm mx-auto" aria-hidden>
      <div className="h-3 bg-gray-100 rounded w-1/3" />
      <div className="h-10 bg-gray-100 rounded-xl w-full" />
      <div className="grid grid-cols-2 gap-2">
        <div className="h-10 bg-gray-100 rounded-xl" />
        <div className="h-10 bg-gray-100 rounded-xl" />
      </div>
      <div className="h-10 bg-gray-100 rounded-xl w-2/5" />
    </div>
  );
}

/** Fits typical Pelecard form; postMessage may adjust further. */
const DEFAULT_IFRAME_HEIGHT = 620;
const MIN_IFRAME_HEIGHT = 480;
const MAX_IFRAME_HEIGHT = 1200;

function parseIframeHeightMessage(data: unknown): number | null {
  if (typeof data === 'number' && data > MIN_IFRAME_HEIGHT) return data;
  if (typeof data === 'string') {
    const parsed = Number(data);
    if (parsed > MIN_IFRAME_HEIGHT) return parsed;
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const candidate =
    record.height ??
    record.frameHeight ??
    record.iframeHeight ??
    record.scrollHeight ??
    (record.data as Record<string, unknown> | undefined)?.height;
  const n = typeof candidate === 'number' ? candidate : Number(candidate);
  return Number.isFinite(n) && n > MIN_IFRAME_HEIGHT ? n : null;
}

const PelecardCheckoutFrame: React.FC<PelecardCheckoutFrameProps> = ({
  paymentUrl,
  loading = false,
  error = null,
  onRetry,
  title = 'Payment',
  onCheckoutNavigate,
  shellClassName = '',
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeHeight, setIframeHeight] = useState(DEFAULT_IFRAME_HEIGHT);

  useEffect(() => {
    setIframeHeight(DEFAULT_IFRAME_HEIGHT);
    setIframeLoaded(false);
  }, [paymentUrl]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const next = parseIframeHeightMessage(event.data);
      if (next == null) return;
      setIframeHeight(Math.min(MAX_IFRAME_HEIGHT, Math.max(MIN_IFRAME_HEIGHT, Math.ceil(next + 4))));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const handleLoad = useCallback(() => {
    setIframeLoaded(true);
    if (!onCheckoutNavigate || !iframeRef.current) return;
    try {
      const href = iframeRef.current.contentWindow?.location.href;
      if (!href) return;
      const url = new URL(href);
      if (
        url.pathname.startsWith('/payment/success') ||
        url.pathname.startsWith('/payment/failed') ||
        url.pathname.startsWith('/payment/cancelled')
      ) {
        onCheckoutNavigate(`${url.pathname}${url.search}`);
      }
    } catch {
      /* cross-origin */
    }
  }, [onCheckoutNavigate]);

  const showIframeLoading = paymentUrl && !iframeLoaded && !loading && !error;
  const errCopy = paymentFormErrorCopy(error);

  if (error) {
    console.error('[Pelecard] Payment form error:', error);
  }

  return (
    <div
      className={`iframe-shell flex flex-col w-full border-0 bg-transparent ${shellClassName}`.trim()}
    >
      {loading && (
        <div className="flex flex-col items-center justify-center text-center py-14 px-6 w-full min-h-[480px]">
          <CheckoutSkeleton />
          <p className="text-sm font-medium text-gray-700 mt-6">Loading secure payment form…</p>
          <p className="text-xs text-gray-500 mt-1">This may take a few seconds.</p>
        </div>
      )}

      {error && !loading && (
        <div className="flex items-center justify-center py-10 px-4 sm:px-6">
          <div className="text-center max-w-sm bg-gray-50 border border-gray-100 rounded-2xl px-6 py-8">
            <ExclamationCircleIcon className="w-10 h-10 text-amber-500 mx-auto mb-3" />
            <p className="text-base font-semibold text-gray-800">{errCopy.title}</p>
            <p className="text-sm text-gray-500 mt-2 font-normal">{errCopy.subtext}</p>
            {onRetry && (
              <button
                type="button"
                className="btn btn-primary btn-sm mt-5 gap-2 rounded-xl"
                onClick={onRetry}
              >
                <ArrowPathIcon className="w-4 h-4" />
                Try again
              </button>
            )}
          </div>
        </div>
      )}

      {paymentUrl && !loading && !error && (
        <div className="relative w-full" style={{ height: iframeHeight }}>
          {showIframeLoading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-4 sm:px-6 min-h-[480px]">
              <CheckoutSkeleton />
              <p className="text-xs text-gray-500 mt-4">Connecting to Pelecard…</p>
            </div>
          )}
          <iframe
            ref={iframeRef}
            title={title}
            src={paymentUrl}
            className="w-full border-0 bg-transparent block"
            style={{ height: iframeHeight }}
            scrolling="no"
            allow="payment; publickey-credentials-get *"
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={handleLoad}
          />
        </div>
      )}
    </div>
  );
};

export default PelecardCheckoutFrame;
