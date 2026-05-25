import React, { useCallback, useState } from 'react';
import { ArrowPathIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';

interface PelecardCheckoutFrameProps {
  paymentUrl: string | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  title?: string;
}

const PelecardCheckoutFrame: React.FC<PelecardCheckoutFrameProps> = ({
  paymentUrl,
  loading = false,
  error = null,
  onRetry,
  title = 'Secure card checkout',
}) => {
  const [iframeLoaded, setIframeLoaded] = useState(false);

  const handleLoad = useCallback(() => {
    setIframeLoaded(true);
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 rounded-2xl border border-violet-100 bg-violet-50/40">
        <span className="loading loading-spinner loading-lg text-primary" />
        <p className="text-sm text-gray-600">Preparing secure checkout…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-center">
        <ExclamationCircleIcon className="w-10 h-10 text-red-500 mx-auto mb-3" />
        <p className="text-sm text-red-800 mb-4">{error}</p>
        {onRetry && (
          <button type="button" className="btn btn-primary btn-sm gap-2" onClick={onRetry}>
            <ArrowPathIcon className="w-4 h-4" />
            Try again
          </button>
        )}
      </div>
    );
  }

  if (!paymentUrl) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-gray-200 overflow-hidden bg-white shadow-inner">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-slate-50">
        <p className="text-sm font-semibold text-gray-800">{title}</p>
        {!iframeLoaded && (
          <span className="loading loading-spinner loading-sm text-primary" />
        )}
      </div>
      <iframe
        title={title}
        src={paymentUrl}
        className="w-full border-0 bg-white"
        style={{ minHeight: 720, height: '72vh', maxHeight: 900 }}
        allow="payment; publickey-credentials-get *"
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={handleLoad}
      />
      <p className="px-4 py-2 text-xs text-gray-500 border-t border-gray-100 bg-slate-50">
        Card details are entered on Pelecard&apos;s PCI-certified page. Apple Pay and Google Pay
        appear here when enabled on your device and merchant account.
      </p>
    </div>
  );
};

export default PelecardCheckoutFrame;
