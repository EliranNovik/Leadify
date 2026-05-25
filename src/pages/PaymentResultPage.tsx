import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { fetchPaymentStatus, type PaymentStatusResponse } from '../lib/pelecardPaymentApi';

type ResultVariant = 'success' | 'failed' | 'cancelled';

interface PaymentResultPageProps {
  variant: ResultVariant;
}

const PaymentResultPage: React.FC<PaymentResultPageProps> = ({ variant }) => {
  const [searchParams] = useSearchParams();
  const paymentId = searchParams.get('paymentId') || '';
  const [statusData, setStatusData] = useState<PaymentStatusResponse | null>(null);
  const [loading, setLoading] = useState(!!paymentId);

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
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [paymentId]);

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
              <p className="text-gray-600 mb-6">
                The payment was not completed. You can try again or contact the office for help.
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
