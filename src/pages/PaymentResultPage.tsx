import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CheckCircleIcon,
  DocumentTextIcon,
  ExclamationCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { fetchPaymentStatus, type PaymentStatusResponse } from '../lib/pelecardPaymentApi';
import {
  getPelecardFailureCopy,
  getPelecardCancelledCopy,
  logPelecardResult,
} from '../lib/pelecardErrors';

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
  /** True while polling the backend for a final status (paid / failed / cancelled). */
  const [verifying, setVerifying] = useState(!!paymentId);
  const [confirmationEmailSent, setConfirmationEmailSent] = useState(false);
  const [invoiceLink, setInvoiceLink] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null);

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
      setVerifying(false);
      return;
    }

    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    const maxAttempts = variant === 'success' ? 25 : 12;
    const intervalMs = 2000;

    const applyStatus = (data: PaymentStatusResponse) => {
      setStatusData(data);
      if (data.confirmation_email_sent) {
        setConfirmationEmailSent(true);
      }
      if (data.payper_invoice_link) {
        setInvoiceLink(data.payper_invoice_link);
      }
      if (data.payper_invoice_number) {
        setInvoiceNumber(data.payper_invoice_number);
      }
    };

    const isFinalStatus = (status?: PaymentStatusResponse['status']) => {
      if (status === 'paid') return true;
      if (variant === 'success') {
        return status === 'failed' || status === 'cancelled' || status === 'expired';
      }
      if (variant === 'failed') {
        return status === 'failed' || status === 'cancelled' || status === 'expired';
      }
      return status === 'cancelled' || status === 'expired';
    };

    const poll = async () => {
      const data = await fetchPaymentStatus(paymentId);
      if (cancelled) return;

      applyStatus(data);
      attempts += 1;

      if (attempts === 1) {
        logPelecardResult('Payment status from API', {
          variant,
          paymentId,
          success: data.success,
          status: data.status,
          pelecard_status_code: data.pelecard_status_code,
          pelecard_status_description: data.pelecard_status_description,
          pelecard_transaction_id: data.pelecard_transaction_id,
          confirmation_email_sent: data.confirmation_email_sent,
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

      if (isFinalStatus(data.status) || attempts >= maxAttempts) {
        setVerifying(false);
        if (timer) {
          window.clearInterval(timer);
          timer = null;
        }
      }
    };

    setVerifying(true);
    void poll();
    timer = window.setInterval(() => {
      if (cancelled || attempts >= maxAttempts) {
        if (timer) window.clearInterval(timer);
        return;
      }
      void poll();
    }, intervalMs);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [paymentId, variant, redirectMeta]);

  // Email + tax invoice are created asynchronously after redirect — poll briefly
  useEffect(() => {
    if (variant !== 'success' || !paymentId || verifying || statusData?.status !== 'paid') {
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 15;
    const intervalMs = 2000;

    const timer = window.setInterval(async () => {
      if (cancelled) return;
      attempts += 1;
      const data = await fetchPaymentStatus(paymentId);
      if (cancelled) return;
      if (data.confirmation_email_sent) {
        setConfirmationEmailSent(true);
      }
      if (data.payper_invoice_link) {
        setInvoiceLink(data.payper_invoice_link);
      }
      if (data.payper_invoice_number) {
        setInvoiceNumber(data.payper_invoice_number);
      }
      const invoiceDone =
        Boolean(data.payper_invoice_link) ||
        data.payper_invoice_status === 'failed' ||
        data.payper_invoice_status === 'skipped' ||
        data.payper_invoice_status === 'skipped_no_email';
      if ((data.confirmation_email_sent && invoiceDone) || attempts >= maxAttempts) {
        window.clearInterval(timer);
      }
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [variant, paymentId, verifying, statusData?.status]);

  const pelecardStatusCode =
    statusData?.pelecard_status_code ||
    urlPelecardStatus ||
    null;
  const pelecardStatusDescription =
    statusData?.pelecard_status_description ||
    urlPelecardMessage ||
    null;

  const failureCopy = useMemo(
    () =>
      getPelecardFailureCopy({
        statusCode: pelecardStatusCode,
        statusDescription: pelecardStatusDescription,
        urlReason,
        variant,
      }),
    [pelecardStatusCode, pelecardStatusDescription, urlReason, variant],
  );

  const cancelledCopy = useMemo(() => getPelecardCancelledCopy(), []);

  const backendPaid = statusData?.status === 'paid';
  const resolvedCancelled = statusData?.status === 'cancelled';
  const showSuccess = backendPaid;
  const showCancelled = !verifying && !backendPaid && (variant === 'cancelled' || resolvedCancelled);
  const showFailed =
    !verifying && !backendPaid && !showCancelled && (variant === 'failed' || variant === 'success');

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
          {verifying ? (
            <div className="flex flex-col items-center gap-4 py-8">
              <span className="loading loading-spinner loading-lg text-primary" />
              <p className="text-sm text-gray-600">Verifying payment status…</p>
              <p className="text-xs text-gray-400">This usually takes a few seconds.</p>
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
              {confirmationEmailSent && (
                <p className="text-sm text-gray-600 mb-4 rounded-lg bg-violet-50 px-4 py-3 border border-violet-100">
                  A confirmation email has been sent to your email address.
                </p>
              )}
              {invoiceLink && (
                <a
                  href={invoiceLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline btn-primary w-full mb-4 gap-2"
                >
                  <DocumentTextIcon className="w-5 h-5" />
                  {invoiceNumber ? `View tax invoice #${invoiceNumber}` : 'View tax invoice-receipt'}
                </a>
              )}
              {!invoiceLink && statusData?.payper_invoice_status === 'pending' && (
                <p className="text-sm text-gray-500 mb-4">Preparing your tax invoice…</p>
              )}
              <p className="text-xs text-gray-500">You can safely close this window.</p>
            </div>
          ) : showCancelled ? (
            <div className="text-center">
              <XCircleIcon className="w-16 h-16 text-amber-500 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-gray-900 mb-2">{cancelledCopy.title}</h2>
              <p className="text-gray-600 mb-4 leading-relaxed">{cancelledCopy.explanation}</p>
              {cancelledCopy.actions.length > 0 && (
                <ul className="text-sm text-gray-600 text-left mb-6 space-y-2 list-disc pl-5">
                  {cancelledCopy.actions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              )}
              {paymentId && (
                <Link to={`/payment/${paymentId}?fresh=1`} className="btn btn-primary w-full">
                  Back to payment
                </Link>
              )}
            </div>
          ) : showFailed ? (
            <div className="text-center">
              <ExclamationCircleIcon className="w-16 h-16 text-amber-500 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-gray-900 mb-2">{failureCopy.title}</h2>
              <p className="text-gray-600 mb-4 leading-relaxed">{failureCopy.explanation}</p>
              {failureCopy.actions.length > 0 && (
                <ul className="text-sm text-gray-600 text-left mb-6 space-y-2 list-disc pl-5">
                  {failureCopy.actions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              )}
              {paymentId && statusData?.status !== 'paid' && (
                <Link
                  to={`/payment/${paymentId}?fresh=1`}
                  className="btn btn-primary w-full rounded-xl"
                >
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
