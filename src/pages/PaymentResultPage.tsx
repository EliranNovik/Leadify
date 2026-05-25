import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { fetchPaymentStatus, type PaymentStatusResponse } from '../lib/pelecardPaymentApi';
import { describePelecardFailure, logPelecardResult } from '../lib/pelecardErrors';

type ResultVariant = 'success' | 'failed' | 'cancelled';

interface PaymentResultPageProps {
  variant: ResultVariant;
}

const PaymentResultPage: React.FC<PaymentResultPageProps> = ({ variant }) => {
  const [searchParams] = useSearchParams();
  const paymentId = searchParams.get('paymentId') || '';
  const urlPelecardStatus = searchParams.get('pelecardStatus') || '';
  const urlPelecardMessage = searchParams.get('pelecardMessage') || '';
  const urlReason = searchParams.get('reason') || '';

  const [statusData, setStatusData] = useState<PaymentStatusResponse | null>(null);
  const [loading, setLoading] = useState(!!paymentId);

  const redirectMeta = useMemo(
    () => ({
      paymentId: paymentId || null,
      pelecardStatus: urlPelecardStatus || null,
      pelecardMessage: urlPelecardMessage || null,
      reason: urlReason || null,
    }),
    [paymentId, urlPelecardStatus, urlPelecardMessage, urlReason]
  );

  // After iframe checkout, Pelecard redirects inside the frame — break out to full page
  useEffect(() => {
    try {
      if (window.self !== window.top) {
        window.top!.location.replace(window.location.href);
      }
    } catch {
      /* cross-origin — ignore */
    }
  }, []);

  useEffect(() => {
    if (variant === 'failed' || variant === 'cancelled') {
      logPelecardResult('Result page opened (redirect)', {
        variant,
        ...redirectMeta,
        url: typeof window !== 'undefined' ? window.location.href : null,
      });
    }
  }, [variant, redirectMeta]);

  useEffect(() => {
    if (!paymentId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      const data = await fetchPaymentStatus(paymentId);
      if (!cancelled) {
        setStatusData(data);
        setLoading(false);

        logPelecardResult('Payment status from API', {
          variant,
          paymentId,
          success: data.success,
          status: data.status,
          pelecard_status_code: data.pelecard_status_code,
          pelecard_status_description: data.pelecard_status_description,
          pelecard_transaction_id: data.pelecard_transaction_id,
          error: data.error,
          redirect: redirectMeta,
        });

        if (variant === 'failed' && data.status === 'failed') {
          console.warn('[Pelecard] Payment failed', {
            paymentId,
            code:
              data.pelecard_status_code ||
              redirectMeta.pelecardStatus ||
              null,
            description:
              data.pelecard_status_description ||
              redirectMeta.pelecardMessage ||
              null,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [paymentId, variant, redirectMeta]);

  const pelecardStatusCode =
    statusData?.pelecard_status_code ||
    urlPelecardStatus ||
    null;
  const pelecardStatusDescription =
    statusData?.pelecard_status_description ||
    urlPelecardMessage ||
    null;

  const failureMessage = useMemo(() => {
    if (urlReason === 'server_error') {
      return 'Something went wrong while confirming your payment. Please try again or contact the office.';
    }
    if (urlReason === 'missing_payment_id') {
      return 'Payment reference was missing. Please use the original payment link.';
    }
    return describePelecardFailure(pelecardStatusCode, pelecardStatusDescription);
  }, [pelecardStatusCode, pelecardStatusDescription, urlReason]);

  const backendPaid = statusData?.status === 'paid';
  const showSuccess = variant === 'success' && backendPaid;
  const showFailed =
    variant === 'failed' || (variant === 'success' && !loading && !backendPaid);
  const showCancelled = variant === 'cancelled' && !backendPaid;

  const getCurrencySymbol = (currency: string | undefined) => {
    if (!currency) return '₪';
    if (currency === 'USD' || currency === '$') return '$';
    return currency;
  };

  const total = statusData?.total_amount;
  const currency = statusData?.currency;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-violet-50">
      <div className="w-full py-6 flex justify-center items-center">
        <span
          className="text-3xl font-extrabold tracking-tight"
          style={{ color: '#3b28c7', letterSpacing: '-0.03em' }}
        >
          RMQ 2.0
        </span>
      </div>

      <div className="flex flex-col items-center justify-center px-4 pb-12">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
          {loading ? (
            <div className="flex flex-col items-center gap-4 py-8">
              <span className="loading loading-spinner loading-lg text-primary" />
              <p className="text-sm text-gray-600">Verifying payment status…</p>
            </div>
          ) : showSuccess ? (
            <div className="text-center">
              <CheckCircleIcon
                className="w-20 h-20 mx-auto mb-6 text-primary"
                style={{ color: '#3b28c7' }}
              />
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Payment successful</h2>
              <p className="text-gray-600 mb-4">
                Thank you. Your payment has been received.
              </p>
              {total != null && (
                <p className="text-2xl font-bold text-green-600 mb-6">
                  {getCurrencySymbol(currency)}
                  {Number(total).toLocaleString()}
                </p>
              )}
              <p className="text-xs text-gray-500">You can safely close this window.</p>
            </div>
          ) : showCancelled ? (
            <div className="text-center">
              <XCircleIcon className="w-16 h-16 text-amber-500 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Payment cancelled</h2>
              <p className="text-gray-600 mb-6">
                You cancelled the payment. You can return to the payment link and try again.
              </p>
              {paymentId && (
                <Link to={`/payment/${paymentId}`} className="btn btn-primary w-full">
                  Back to payment
                </Link>
              )}
            </div>
          ) : showFailed ? (
            <div className="text-center">
              <ExclamationCircleIcon className="w-16 h-16 text-red-500 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Payment not completed</h2>
              <p className="text-gray-600 mb-4">{failureMessage}</p>
              {(pelecardStatusCode || pelecardStatusDescription) && (
                <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 mb-4 text-left text-sm text-red-900">
                  {pelecardStatusCode && (
                    <p>
                      <span className="font-semibold">Pelecard code:</span>{' '}
                      {pelecardStatusCode}
                    </p>
                  )}
                  {pelecardStatusDescription &&
                    pelecardStatusDescription !== failureMessage && (
                      <p className="mt-1 text-red-800">{pelecardStatusDescription}</p>
                    )}
                  {import.meta.env.DEV && paymentId && (
                    <p className="mt-2 text-xs text-red-700/80 font-mono break-all">
                      paymentId: {paymentId}
                    </p>
                  )}
                </div>
              )}
              <p className="text-xs text-gray-500 mb-6">
                Details are also logged in the browser console (search for{' '}
                <span className="font-mono">[Pelecard]</span>).
              </p>
              {paymentId && statusData?.status !== 'paid' && (
                <Link to={`/payment/${paymentId}`} className="btn btn-primary w-full">
                  Try again
                </Link>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default PaymentResultPage;

export const PaymentSuccessPage = () => <PaymentResultPage variant="success" />;
export const PaymentFailedPage = () => <PaymentResultPage variant="failed" />;
export const PaymentCancelledPage = () => <PaymentResultPage variant="cancelled" />;
