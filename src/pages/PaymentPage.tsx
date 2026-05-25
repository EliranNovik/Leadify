import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { createPelecardPaymentSession, fetchPaymentStatus } from '../lib/pelecardPaymentApi';
import PelecardCheckoutFrame from '../components/PelecardCheckoutFrame';
import PaymentSummaryCard from '../components/payment/PaymentSummaryCard';
import PublicContractFooter from '../components/public/PublicContractFooter';
import PublicPageContactButtons from '../components/public/PublicPageContactButtons';
import {
  currencyInputFromNewPayment,
  fetchProformaExchangeRateInfo,
  type ProformaExchangeRateInfo,
} from '../lib/proformaExchangeRate';
import toast from 'react-hot-toast';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';

const PAGE_BG_STYLE: React.CSSProperties = {
  background:
    'radial-gradient(circle at top right, rgba(79, 70, 229, 0.08), transparent 35%), linear-gradient(180deg, #f8fafc 0%, #ffffff 55%)',
};

interface PaymentLink {
  id: string;
  secure_token?: string;
  amount: number;
  vat_amount: number;
  total_amount: number;
  currency: string;
  description: string;
  status: string;
  expires_at: string;
  payment_plan_id: number;
  client_id: string;
  leads?: {
    lead_number?: string;
    topic?: string;
    name?: string;
    email?: string;
    phone?: string;
  };
  paid_at?: string | null;
  payment_plans?: {
    payment_order?: string;
    currency?: string | null;
    currency_id?: number | string | null;
  };
}

function getCurrencySymbol(currency: string | undefined) {
  if (!currency) return '₪';
  if (currency === 'USD' || currency === '$') return '$';
  if (currency === '₪') return '₪';
  return currency;
}

function clientDisplayName(paymentLink: PaymentLink): string {
  return (
    paymentLink.leads?.name?.trim() ||
    paymentLink.description?.split(' - ')[1]?.split(' (#')[0]?.trim() ||
    'there'
  );
}

const PaymentPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [paymentLink, setPaymentLink] = useState<PaymentLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [showThankYou, setShowThankYou] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [exchangeInfo, setExchangeInfo] = useState<ProformaExchangeRateInfo | null>(null);
  const [exchangeLoading, setExchangeLoading] = useState(false);

  useEffect(() => {
    const fetchPaymentLink = async () => {
      if (!token) {
        toast.error('Invalid payment link');
        return;
      }

      try {
        const { data, error } = await supabase
          .from('payment_links')
          .select(`
            *,
            leads!client_id(lead_number, topic, name, email, phone, currency_id, proposal_currency, balance_currency),
            payment_plans:payment_plan_id(payment_order, currency, currency_id)
          `)
          .eq('secure_token', token)
          .maybeSingle();

        if (error || !data) {
          console.error('Error fetching payment link:', error);
          setPageError('Payment link not found or invalid');
          return;
        }

        if (data.status === 'paid') {
          setPaymentLink(data);
          setShowThankYou(true);
          return;
        }

        if (data.expires_at && new Date(data.expires_at) < new Date()) {
          setPageError('This payment link has expired. Please contact the office for a new link.');
          return;
        }

        if (data.status === 'expired' || data.status === 'cancelled') {
          setPageError(
            data.status === 'cancelled'
              ? 'This payment was cancelled. You can open the link again to retry.'
              : 'This payment link has expired.'
          );
          if (data.status === 'cancelled') {
            setPaymentLink(data);
          }
          return;
        }

        setPaymentLink(data);
      } catch (error) {
        console.error('Error:', error);
        toast.error('Failed to load payment information');
      } finally {
        setLoading(false);
      }
    };

    fetchPaymentLink();
  }, [token]);

  useEffect(() => {
    if (!paymentLink) {
      setExchangeInfo(null);
      return;
    }

    let cancelled = false;
    const loadExchange = async () => {
      setExchangeLoading(true);
      try {
        const info = await fetchProformaExchangeRateInfo({
          currency: currencyInputFromNewPayment(
            {
              currency: paymentLink.currency,
              currency_id: paymentLink.payment_plans?.currency_id ?? null,
            },
            paymentLink.payment_plans?.currency,
          ),
          paid: paymentLink.status === 'paid',
          paidAt: paymentLink.paid_at ?? null,
          subtotal: Number(paymentLink.amount) || 0,
          vat: Number(paymentLink.vat_amount) || 0,
          total: Number(paymentLink.total_amount) || 0,
        });
        if (!cancelled) setExchangeInfo(info);
      } catch (err) {
        console.error('[PaymentPage] exchange rate:', err);
        if (!cancelled) setExchangeInfo(null);
      } finally {
        if (!cancelled) setExchangeLoading(false);
      }
    };

    void loadExchange();
    return () => {
      cancelled = true;
    };
  }, [paymentLink]);

  const canPay =
    paymentLink &&
    paymentLink.status !== 'paid' &&
    paymentLink.status !== 'expired' &&
    !(paymentLink.expires_at && new Date(paymentLink.expires_at) < new Date());

  const loadPelecardSession = async () => {
    if (!token || !paymentLink || !canPay) return;

    setSessionLoading(true);
    setSessionError(null);

    try {
      const result = await createPelecardPaymentSession(token);
      if (!result.success || !result.paymentUrl) {
        throw new Error(result.error || 'Failed to create payment session');
      }
      setPaymentUrl(result.paymentUrl);
    } catch (error) {
      console.error('[Pelecard] Session error:', error);
      const raw = error instanceof Error ? error.message : 'Could not start payment';
      setSessionError(raw);
    } finally {
      setSessionLoading(false);
    }
  };

  useEffect(() => {
    if (!canPay) {
      setPaymentUrl(null);
      return;
    }
    loadPelecardSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, canPay]);

  useEffect(() => {
    if (!token || !paymentUrl || sessionLoading || !canPay) return;

    let cancelled = false;
    const poll = async () => {
      const data = await fetchPaymentStatus(token);
      if (cancelled || !data.success) return;
      if (data.status === 'paid') {
        navigate(`/payment/success?paymentId=${encodeURIComponent(token)}`);
      } else if (data.status === 'failed') {
        const qs = new URLSearchParams({
          paymentId: token,
          ...(data.pelecard_status_code
            ? { pelecardStatus: data.pelecard_status_code }
            : {}),
          ...(data.pelecard_status_description
            ? { pelecardMessage: data.pelecard_status_description }
            : {}),
        });
        navigate(`/payment/failed?${qs.toString()}`);
      } else if (data.status === 'cancelled') {
        navigate(`/payment/cancelled?paymentId=${encodeURIComponent(token)}`);
      }
    };

    const interval = window.setInterval(poll, 3000);
    poll();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [token, paymentUrl, sessionLoading, canPay, navigate]);

  const summaryData = useMemo(() => {
    if (!paymentLink) return null;
    return {
      service: paymentLink.payment_plans?.payment_order || 'Payment',
      clientName:
        paymentLink.description?.split(' - ')[1]?.split(' (#')[0]?.trim() || 'Client',
      caseNumber: paymentLink.leads?.lead_number || '—',
      topic: paymentLink.leads?.topic?.trim() ? paymentLink.leads.topic : '--',
      currencySymbol: getCurrencySymbol(paymentLink.currency),
      subtotal: Number(paymentLink.amount) || 0,
      vat: Number(paymentLink.vat_amount) || 0,
      total: Number(paymentLink.total_amount) || 0,
    };
  }, [paymentLink]);

  const paymentHeader = (
    <header className="bg-white/90 backdrop-blur-sm border-b border-gray-100">
      <div className="max-w-[1160px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        <div>
          <p
            className="text-xl font-bold tracking-tight leading-none"
            style={{ color: '#3b28c7', letterSpacing: '-0.03em' }}
          >
            RMQ 2.0
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5 font-normal">Payment Portal</p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-50 px-2.5 py-1 text-emerald-800">
          <ShieldCheckIcon className="w-3.5 h-3.5 shrink-0" />
          <span className="text-[11px] font-medium whitespace-nowrap">Secure Payment</span>
        </div>
      </div>
    </header>
  );

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col" style={PAGE_BG_STYLE}>
        {paymentHeader}
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200 px-8 py-10 text-center">
            <span className="loading loading-spinner loading-lg text-primary" />
            <p className="mt-4 text-gray-600">Loading payment details…</p>
          </div>
        </div>
      </div>
    );
  }

  if (!paymentLink && pageError) {
    return (
      <div className="min-h-screen flex flex-col" style={PAGE_BG_STYLE}>
        {paymentHeader}
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 max-w-md w-full text-center">
            <ExclamationCircleIcon className="w-14 h-14 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">Unable to load payment</h2>
            <p className="text-gray-600 mb-6">{pageError}</p>
          </div>
        </div>
        <PublicContractFooter variant="payment" />
      </div>
    );
  }

  if (!paymentLink) {
    return (
      <div className="min-h-screen flex flex-col" style={PAGE_BG_STYLE}>
        {paymentHeader}
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 max-w-md w-full text-center">
            <ExclamationCircleIcon className="w-14 h-14 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-2">Payment link not found</h2>
            <p className="text-gray-600">
              This link is invalid, expired, or has already been used.
            </p>
          </div>
        </div>
        <PublicContractFooter variant="payment" />
      </div>
    );
  }

  if (showThankYou) {
    return (
      <div className="min-h-screen flex flex-col" style={PAGE_BG_STYLE}>
        {paymentHeader}
        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="bg-white rounded-[20px] shadow-[0_12px_35px_rgba(15,23,42,0.08)] border border-gray-200 p-8 max-w-md w-full text-center">
            <CheckCircleIcon className="w-16 h-16 mx-auto mb-6 text-[#3b28c7]" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Thank you, {clientDisplayName(paymentLink)}!
            </h2>
            <p className="text-lg text-gray-600 mb-4">Payment successful</p>
            <p className="text-2xl font-bold text-emerald-600 mb-6">
              {getCurrencySymbol(paymentLink.currency)}
              {paymentLink.total_amount.toLocaleString()}
            </p>
            <p className="text-sm text-gray-500">You can safely close this window.</p>
          </div>
        </div>
        <PublicContractFooter variant="payment" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={PAGE_BG_STYLE}>
      {paymentHeader}

      <main className="flex-1 w-full max-w-[1240px] mx-auto px-4 sm:px-6 pt-5 lg:pt-6 pb-6">
        <div className="payment-intro mx-auto max-w-[1180px] mb-[18px]">
          <h1 className="text-2xl font-semibold text-gray-900 mb-1">
            Hi, {clientDisplayName(paymentLink)}.
          </h1>
          <p className="text-sm text-gray-600 font-normal">
            When you&apos;re ready, complete your secure payment below.
          </p>
        </div>

        <div
          className="checkout-shell mx-auto w-full max-w-[1180px] grid grid-cols-1 lg:grid-cols-[340px_minmax(680px,1fr)] bg-white border border-gray-200 rounded-[28px] shadow-[0_24px_70px_rgba(15,23,42,0.08)] overflow-hidden"
        >
          {summaryData && (
            <div className="checkout-summary bg-[#fbfcff] border-b lg:border-b-0 lg:border-r border-gray-200 p-6 lg:p-8">
              <PaymentSummaryCard
                summary={summaryData}
                exchangeInfo={exchangeInfo}
                exchangeLoading={exchangeLoading}
              />
            </div>
          )}

          <div className="checkout-payment p-6 lg:p-8 min-w-0 flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-2">
              <h2 className="text-lg font-semibold text-gray-900">
                Complete your secure payment
              </h2>
              <span className="inline-flex shrink-0 items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[11px] text-gray-600 font-normal">
                Pelecard · PCI DSS
              </span>
            </div>
            <p className="text-sm text-gray-500 font-normal mb-4 max-w-lg">
              Card details are processed by Pelecard. We do not store card information.
            </p>

            <PelecardCheckoutFrame
              paymentUrl={paymentUrl}
              loading={sessionLoading}
              error={sessionError}
              onRetry={loadPelecardSession}
              onCheckoutNavigate={(path) => navigate(path)}
              title="Secure payment"
            />
          </div>
        </div>
      </main>

      <PublicContractFooter variant="payment" />
      <PublicPageContactButtons />
    </div>
  );
};

export default PaymentPage;
