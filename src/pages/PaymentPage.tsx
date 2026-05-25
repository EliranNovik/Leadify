import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { createPelecardPaymentSession, fetchPaymentStatus } from '../lib/pelecardPaymentApi';
import PelecardCheckoutFrame from '../components/PelecardCheckoutFrame';
import PaymentSummaryCard from '../components/payment/PaymentSummaryCard';
import PaymentSummaryGradientDecor from '../components/payment/PaymentSummaryGradientDecor';
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
} from '@heroicons/react/24/outline';

const PAGE_BG_STYLE: React.CSSProperties = {
  background: '#f3f4f6',
};

const SUMMARY_GRADIENT_STYLE: React.CSSProperties = {
  background:
    'linear-gradient(145deg, #312e81 0%, #5b21b6 22%, #7e22ce 48%, #a21caf 72%, #e11d48 100%)',
};

const CHECKOUT_LAW_OFFICE_TITLE = 'Decker, Pex & Co. Law Office';

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

  if (loading) {
    return (
      <div className="h-screen flex flex-col overflow-hidden" style={PAGE_BG_STYLE}>
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
    <div className="h-screen flex flex-col lg:flex-row overflow-hidden bg-white">
      <aside
        className="hidden lg:flex lg:w-[42%] lg:max-w-[520px] lg:shrink-0 flex-col text-white relative overflow-y-auto"
        style={SUMMARY_GRADIENT_STYLE}
      >
        <PaymentSummaryGradientDecor />
        <div className="relative flex flex-col justify-between min-h-full p-10 xl:p-12 z-[1]">
          <div>
            <h1 className="text-lg xl:text-xl font-semibold text-white leading-snug tracking-tight mb-8 max-w-sm">
              {CHECKOUT_LAW_OFFICE_TITLE}
            </h1>
            {summaryData && (
              <PaymentSummaryCard
                summary={summaryData}
                exchangeInfo={exchangeInfo}
                exchangeLoading={exchangeLoading}
                variant="gradient"
              />
            )}
          </div>
          <p className="text-[11px] text-white/50 leading-relaxed mt-10 max-w-xs">
            Processed securely by Pelecard. Card details are not stored on our servers.
          </p>
        </div>
      </aside>

      <main className="flex-1 min-h-0 flex flex-col overflow-y-auto lg:overflow-hidden bg-white">
        <div
          className="lg:hidden relative overflow-hidden text-white px-5 pt-8 pb-7"
          style={SUMMARY_GRADIENT_STYLE}
        >
          <PaymentSummaryGradientDecor />
          <div className="relative z-[1]">
            <h1 className="text-lg font-semibold text-white leading-snug tracking-tight mb-6">
              {CHECKOUT_LAW_OFFICE_TITLE}
            </h1>
            {summaryData && (
              <PaymentSummaryCard
                summary={summaryData}
                exchangeInfo={exchangeInfo}
                exchangeLoading={exchangeLoading}
                variant="gradient"
              />
            )}
          </div>
        </div>

        <div className="checkout-payment lg:flex-1 lg:min-h-0 flex flex-col w-full max-w-4xl mx-auto px-6 sm:px-10 lg:max-w-none lg:mx-0 lg:px-12 xl:px-16 py-8 lg:py-12">
          <h2 className="hidden lg:block text-xl font-semibold text-gray-900 mb-6 tracking-tight shrink-0">
            Payment information
          </h2>
          <PelecardCheckoutFrame
            paymentUrl={paymentUrl}
            loading={sessionLoading}
            error={sessionError}
            onRetry={loadPelecardSession}
            onCheckoutNavigate={(path) => navigate(path)}
            title="Secure payment"
            shellClassName="lg:flex-1 lg:min-h-0"
          />
        </div>

        <div className="shrink-0">
          <PublicContractFooter variant="payment" />
        </div>
      </main>

      <PublicPageContactButtons />
    </div>
  );
};

export default PaymentPage;
