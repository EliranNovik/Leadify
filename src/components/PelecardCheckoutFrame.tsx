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
  /** Desktop: stretch iframe to fill column height down to the footer. */
  fillColumn?: boolean;
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

/** Desktop: scrollable shell filling column; mobile: natural height, page scrolls. */
const IFRAME_SCROLL_SHELL_CLASS =
  'relative w-full max-lg:overflow-visible max-lg:h-auto max-lg:flex-none ' +
  'lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain lg:h-full';

/** Minimum iframe height before Pelecard reports content size. */
const IFRAME_CONTENT_HEIGHT = 920;
const IFRAME_CONTENT_HEIGHT_MOBILE = 1500;
const IFRAME_HEIGHT_MAX_MOBILE = 5000;
const IFRAME_HEIGHT_MAX_DESKTOP = 1400;
const IFRAME_HEIGHT_BUFFER_DESKTOP = 8;
const IFRAME_HEIGHT_BUFFER_MOBILE = 96;
/** Progressive mobile expansion when Pelecard does not postMessage document height. */
const MOBILE_HEIGHT_FALLBACK_STEPS = [1500, 1700, 1950] as const;

function isLgViewportNow(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
}

function useIsLgViewport(): boolean {
  const [isLg, setIsLg] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setIsLg(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isLg;
}

const PelecardCheckoutFrame: React.FC<PelecardCheckoutFrameProps> = ({
  paymentUrl,
  loading = false,
  error = null,
  onRetry,
  title = 'Payment',
  onCheckoutNavigate,
  shellClassName = '',
  fillColumn = false,
}) => {
  const isLgViewport = useIsLgViewport();
  const fillDesktop = fillColumn && isLgViewport;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeHeight, setIframeHeight] = useState(() =>
    isLgViewportNow() ? IFRAME_CONTENT_HEIGHT : IFRAME_CONTENT_HEIGHT_MOBILE,
  );

  useEffect(() => {
    setIframeHeight(isLgViewportNow() ? IFRAME_CONTENT_HEIGHT : IFRAME_CONTENT_HEIGHT_MOBILE);
    setIframeLoaded(false);
  }, [paymentUrl]);

  useEffect(() => {
    if (!paymentUrl || isLgViewport || loading || error) return;

    const timers = MOBILE_HEIGHT_FALLBACK_STEPS.map((height, index) =>
      window.setTimeout(() => {
        setIframeHeight((prev) => Math.max(prev, height));
      }, 350 + index * 750),
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [paymentUrl, isLgViewport, loading, error]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      let next: number | null = null;
      if (typeof data === 'number' && data > 400) next = data;
      else if (typeof data === 'string') {
        const parsed = Number(data);
        if (Number.isFinite(parsed) && parsed > 400) next = parsed;
      } else if (data && typeof data === 'object') {
        const record = data as Record<string, unknown>;
        const candidate =
          record.height ??
          record.frameHeight ??
          record.iframeHeight ??
          record.scrollHeight;
        const n = typeof candidate === 'number' ? candidate : Number(candidate);
        if (Number.isFinite(n) && n > 400) next = n;
      }
      if (next != null) {
        if (isLgViewportNow() && fillColumn) return;
        const isLg = isLgViewportNow();
        const cap = isLg ? IFRAME_HEIGHT_MAX_DESKTOP : IFRAME_HEIGHT_MAX_MOBILE;
        const buffer = isLg ? IFRAME_HEIGHT_BUFFER_DESKTOP : IFRAME_HEIGHT_BUFFER_MOBILE;
        const floor = isLg ? IFRAME_CONTENT_HEIGHT : IFRAME_CONTENT_HEIGHT_MOBILE;
        setIframeHeight((prev) => {
          const computed = Math.min(cap, Math.max(floor, Math.ceil(next + buffer)));
          return isLg ? computed : Math.max(prev, computed);
        });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [fillColumn]);

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
      className={`iframe-shell flex flex-col w-full border-0 bg-transparent max-lg:h-auto lg:min-h-0 lg:h-full ${shellClassName}`.trim()}
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
        <div className={`${IFRAME_SCROLL_SHELL_CLASS} ${fillDesktop ? 'lg:!h-full' : ''}`.trim()}>
          {showIframeLoading && (
            <div className="flex flex-col items-center justify-center px-4 sm:px-6 min-h-[280px] max-lg:min-h-[320px] bg-white lg:sticky lg:top-0 lg:z-10 lg:min-h-full">
              <CheckoutSkeleton />
              <p className="text-xs text-gray-500 mt-4">Connecting to Pelecard…</p>
            </div>
          )}
          <iframe
            ref={iframeRef}
            title={title}
            src={paymentUrl}
            className={`w-full border-0 bg-transparent block ${
              fillDesktop || isLgViewport ? 'lg:!h-full lg:!min-h-0' : 'max-lg:!min-h-0'
            }`}
            style={
              fillDesktop
                ? { height: '100%', minHeight: 0 }
                : isLgViewport
                  ? { height: iframeHeight, minHeight: 0 }
                  : { height: iframeHeight, minHeight: iframeHeight, maxHeight: 'none' }
            }
            scrolling={isLgViewport ? 'yes' : 'no'}
            allow="payment; publickey-credentials-get"
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={handleLoad}
          />
        </div>
      )}
    </div>
  );
};

export default PelecardCheckoutFrame;
