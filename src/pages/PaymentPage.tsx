import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { createPelecardPaymentSession, fetchPaymentStatus } from '../lib/pelecardPaymentApi';
import PelecardCheckoutFrame from '../components/PelecardCheckoutFrame';
import PaymentSummaryCard, {
  type PaymentSummaryData,
} from '../components/payment/PaymentSummaryCard';
import PaymentSummaryGradientDecor from '../components/payment/PaymentSummaryGradientDecor';
import PublicContractFooter from '../components/public/PublicContractFooter';
import PublicPageContactButtons from '../components/public/PublicPageContactButtons';
import {
  currencyInputFromLegacyProforma,
  currencyInputFromNewPayment,
  fetchProformaExchangeRateInfo,
  lockedBoiChargeFromPaymentLinkRaw,
  type ProformaExchangeRateInfo,
} from '../lib/proformaExchangeRate';
import { isLegacyPaymentLinkRow } from '../lib/paymentLinkLeadRef';
import { resolvePaymentPlanContact } from '../lib/resolvePaymentPlanContact';
import toast from 'react-hot-toast';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';

const PAGE_BG_STYLE: React.CSSProperties = {
  background: '#f3f4f6',
};

const SUMMARY_GRADIENT_STYLE: React.CSSProperties = {
  background:
    'linear-gradient(145deg, #312e81 0%, #5b21b6 22%, #7e22ce 48%, #a21caf 72%, #e11d48 100%)',
};

const CHECKOUT_LAW_OFFICE_TITLE = 'Decker, Pex & Co. Law Office';

/** Desktop gradient panel — served from /public */
const CHECKOUT_DESKTOP_FOOTER_IMAGE = '/ChatGPT Image May 26, 2026, 09_41_00 AM.png';

function CheckoutSummaryHeading({
  summary,
  titleClassName,
}: {
  summary?: PaymentSummaryData | null;
  titleClassName: string;
}) {
  return (
    <>
      <h1 className={titleClassName}>{CHECKOUT_LAW_OFFICE_TITLE}</h1>
      {summary && (
        <p className="text-sm text-white/90 mb-6 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-[12px] text-white/75">Case #{summary.caseNumber}</span>
          <span className="text-white/40" aria-hidden>
            ·
          </span>
          <span>{summary.clientName}</span>
        </p>
      )}
    </>
  );
}

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
  client_id: string | null;
  legacy_id?: number | null;
  is_legacy_payment_plan?: boolean;
  leads?: {
    lead_number?: string;
    topic?: string;
    name?: string;
    email?: string;
    phone?: string;
  };
  paid_at?: string | null;
  pelecard_raw_response?: {
    pelecardCharge?: {
      rateToIls?: number;
      rateDate?: string | null;
      chargeTotalNis?: number;
      lockedAt?: string | null;
      rateCreatedAt?: string | null;
    };
  } | null;
  payment_plans?: {
    payment_order?: string;
    currency?: string | null;
    currency_id?: number | string | null;
    client_id?: number | string | null;
    paid?: boolean | null;
    paid_at?: string | null;
  };
  legacy_payment_plan?: {
    order?: number | string | null;
    currency_id?: number | string | null;
    client_id?: number | string | null;
    actual_date?: string | null;
    accounting_currencies?: { name?: string | null; iso_code?: string | null } | null;
  } | null;
}

function isLegacyPaymentLink(link: PaymentLink): boolean {
  return isLegacyPaymentLinkRow(link);
}

function isLegacyPlanPaid(plan: PaymentLink['legacy_payment_plan']): boolean {
  return Boolean(plan?.actual_date);
}

function paymentOrderLabel(order: number | string | null | undefined): string {
  if (order == null || order === '') return 'Payment';
  if (typeof order === 'string') {
    const lower = order.toLowerCase();
    if (
      lower.includes('first') ||
      lower.includes('intermediate') ||
      lower.includes('final') ||
      lower.includes('single') ||
      lower.includes('expense')
    ) {
      return order;
    }
    const num = parseInt(order, 10);
    if (!Number.isNaN(num)) order = num;
    else return order;
  }
  if (typeof order === 'number') {
    switch (order) {
      case 1:
        return 'First Payment';
      case 5:
        return 'Intermediate Payment';
      case 9:
        return 'Final Payment';
      case 90:
        return 'Single Payment';
      case 99:
        return 'Expense (no VAT)';
      default:
        return 'Payment';
    }
  }
  return 'Payment';
}

function getCurrencySymbol(currency: string | undefined) {
  if (!currency) return '₪';
  if (currency === 'USD' || currency === '$') return '$';
  if (currency === '₪') return '₪';
  return currency;
}

function isPaymentComplete(paymentLink: PaymentLink): boolean {
  if (paymentLink.status === 'paid') return true;
  if (isLegacyPaymentLink(paymentLink)) {
    return isLegacyPlanPaid(paymentLink.legacy_payment_plan);
  }
  return paymentLink.payment_plans?.paid === true;
}

function getPaymentPaidAt(paymentLink: PaymentLink): string | null {
  if (paymentLink.paid_at) return paymentLink.paid_at;
  if (isLegacyPaymentLink(paymentLink)) {
    return paymentLink.legacy_payment_plan?.actual_date ?? null;
  }
  return paymentLink.payment_plans?.paid_at ?? null;
}

function formatPaidDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function PaymentDoneStamp({ paidAt }: { paidAt: string | null }) {
  const dateLabel = formatPaidDate(paidAt);

  return (
    <div
      className="mt-5 inline-flex max-w-[280px] -rotate-6 origin-left"
      role="status"
      aria-label={dateLabel ? `Payment done on ${dateLabel}` : 'Payment done'}
    >
      <div className="relative rounded-xl border-[3px] border-dashed border-emerald-200/90 bg-emerald-500/15 px-5 py-3.5 shadow-[0_10px_30px_-12px_rgba(16,185,129,0.55)] backdrop-blur-[2px]">
        <div className="absolute inset-1 rounded-lg border border-emerald-100/30 pointer-events-none" />
        <div className="relative flex items-center gap-3">
          <CheckCircleIcon className="h-8 w-8 shrink-0 text-emerald-100" strokeWidth={1.75} />
          <div className="text-left">
            <p className="text-[13px] font-extrabold uppercase tracking-[0.28em] text-emerald-50 leading-none">
              Payment done
            </p>
            {dateLabel ? (
              <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-100/90">
                {dateLabel}
              </p>
            ) : (
              <p className="mt-1.5 text-[11px] font-medium text-emerald-100/80">Completed</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckoutSecuredStamp({ iconOnly = false }: { iconOnly?: boolean }) {
  return (
    <div
      className={`inline-flex items-center justify-center rounded-md bg-emerald-600 shadow-sm ring-1 ring-emerald-700/10 ${
        iconOnly ? 'p-2' : 'gap-1.5 px-3 py-1.5'
      }`}
      role="img"
      aria-label="Secured checkout"
    >
      <ShieldCheckIcon
        className={`shrink-0 text-white ${iconOnly ? 'h-5 w-5' : 'h-4 w-4'}`}
        strokeWidth={2}
      />
      {!iconOnly && (
        <span className="text-xs font-semibold text-white tracking-wide">Secured</span>
      )}
    </div>
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
          .select('*')
          .eq('secure_token', token)
          .maybeSingle();

        if (error || !data) {
          console.error('Error fetching payment link:', error);
          setPageError('Payment link not found or invalid');
          return;
        }

        let enriched: PaymentLink = data as PaymentLink;

        if (enriched.client_id) {
          const { data: leadRow } = await supabase
            .from('leads')
            .select('lead_number, topic, name, email, phone, currency_id, proposal_currency, balance_currency')
            .eq('id', enriched.client_id)
            .maybeSingle();
          if (leadRow) {
            enriched = { ...enriched, leads: leadRow };
          }
        } else if (enriched.legacy_id) {
          const { data: legacyLead } = await supabase
            .from('leads_lead')
            .select('id, name, email, phone, topic')
            .eq('id', enriched.legacy_id)
            .maybeSingle();
          if (legacyLead) {
            enriched = {
              ...enriched,
              leads: {
                lead_number: String(legacyLead.id),
                name: legacyLead.name,
                email: legacyLead.email,
                phone: legacyLead.phone,
                topic: legacyLead.topic,
              },
            };
          }
        }

        if (isLegacyPaymentLink(enriched) && enriched.payment_plan_id) {
          const { data: legacyPlan, error: legacyPlanError } = await supabase
            .from('finances_paymentplanrow')
            .select(`
              id,
              order,
              client_id,
              currency_id,
              actual_date,
              accounting_currencies!finances_paymentplanrow_currency_id_fkey (
                name,
                iso_code
              )
            `)
            .eq('id', enriched.payment_plan_id)
            .maybeSingle();

          if (legacyPlanError) {
            console.error('Error fetching legacy payment plan:', legacyPlanError);
          } else if (legacyPlan) {
            const currencies = legacyPlan.accounting_currencies;
            const currencyRow = Array.isArray(currencies) ? currencies[0] : currencies;
            enriched = {
              ...enriched,
              legacy_payment_plan: {
                ...legacyPlan,
                accounting_currencies: currencyRow ?? null,
              },
            };
          }
        } else if (enriched.payment_plan_id) {
          const { data: planRow, error: planError } = await supabase
            .from('payment_plans')
            .select('payment_order, currency, currency_id, client_id, paid, paid_at')
            .eq('id', enriched.payment_plan_id)
            .maybeSingle();

          if (planError) {
            console.error('Error fetching payment plan:', planError);
          } else if (planRow) {
            enriched = { ...enriched, payment_plans: planRow };
          }
        }

        // Resolve billing contact (summary box should reflect invoice/payment-row contact, not lead main contact).
        // For legacy links: use finances_paymentplanrow.client_id when present; otherwise main contact.
        // For new links: use payment_plans.client_id when present; otherwise main contact.
        try {
          const leadId = isLegacyPaymentLink(enriched)
            ? enriched.legacy_id ?? null
            : enriched.client_id ?? null;
          const clientId = isLegacyPaymentLink(enriched)
            ? enriched.legacy_payment_plan?.client_id ?? null
            : enriched.payment_plans?.client_id ?? null;

          const resolved = await resolvePaymentPlanContact({
            leadId,
            clientId,
            clientNameFallback:
              enriched.description?.split(' - ')[1]?.split(' (#')[0]?.trim() ||
              enriched.leads?.name ||
              null,
            leadNameFallback: enriched.leads?.name || null,
          });

          enriched = {
            ...enriched,
            leads: {
              ...(enriched.leads || {}),
              name: resolved.name,
              email: resolved.email,
              phone: resolved.phone,
            },
          };
        } catch (err) {
          console.warn('[PaymentPage] billing contact resolution failed:', err);
        }

        const paymentComplete = isPaymentComplete(enriched);

        if (paymentComplete) {
          setPaymentLink(enriched);
          return;
        }

        if (enriched.expires_at && new Date(enriched.expires_at) < new Date()) {
          setPageError('This payment link has expired. Please contact the office for a new link.');
          return;
        }

        if (enriched.status === 'expired' || enriched.status === 'cancelled') {
          setPageError(
            enriched.status === 'cancelled'
              ? 'This payment was cancelled. You can open the link again to retry.'
              : 'This payment link has expired.'
          );
          if (enriched.status === 'cancelled') {
            setPaymentLink(enriched);
          }
          return;
        }

        setPaymentLink(enriched);
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
        const lockedBoiCharge = lockedBoiChargeFromPaymentLinkRaw(paymentLink.pelecard_raw_response);
        const info = await fetchProformaExchangeRateInfo({
          currency: isLegacyPaymentLink(paymentLink)
            ? currencyInputFromLegacyProforma({
                currency_id: paymentLink.legacy_payment_plan?.currency_id ?? null,
                currency_code:
                  paymentLink.legacy_payment_plan?.accounting_currencies?.name ||
                  paymentLink.currency,
              })
            : currencyInputFromNewPayment(
                {
                  currency: paymentLink.currency,
                  currency_id: paymentLink.payment_plans?.currency_id ?? null,
                },
                paymentLink.payment_plans?.currency,
              ),
          paid: isPaymentComplete(paymentLink),
          paidAt: getPaymentPaidAt(paymentLink),
          subtotal: Number(paymentLink.amount) || 0,
          vat: Number(paymentLink.vat_amount) || 0,
          total: Number(paymentLink.total_amount) || 0,
          paymentPlanId: paymentLink.payment_plan_id,
          lockedBoiCharge,
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

  const isAlreadyPaid = paymentLink ? isPaymentComplete(paymentLink) : false;
  const paidAt = paymentLink ? getPaymentPaidAt(paymentLink) : null;

  const canPay =
    paymentLink &&
    !isAlreadyPaid &&
    paymentLink.status !== 'expired' &&
    !(paymentLink.expires_at && new Date(paymentLink.expires_at) < new Date());

  const loadPelecardSession = async () => {
    if (!token || !paymentLink || !canPay) return;

    setSessionLoading(true);
    setSessionError(null);

    try {
      const result = await createPelecardPaymentSession(token);
      if (result.alreadyPaid || result.status === 'paid') {
        navigate(`/payment/success?paymentId=${encodeURIComponent(token)}`);
        return;
      }
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

  /** Mobile: start at summary; avoid restored scroll hiding it. */
  useEffect(() => {
    if (!paymentLink) return;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [paymentLink, paymentUrl]);

  const summaryData = useMemo(() => {
    if (!paymentLink) return null;
    const serviceLabel =
      paymentLink.description?.split(' - ')[0]?.trim() ||
      paymentOrderLabel(paymentLink.payment_plans?.payment_order) ||
      paymentOrderLabel(paymentLink.legacy_payment_plan?.order) ||
      'Payment';
    return {
      service: serviceLabel,
      clientName:
        paymentLink.leads?.name ||
        paymentLink.description?.split(' - ')[1]?.split(' (#')[0]?.trim() ||
        'Client',
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

  return (
    <div className="min-h-screen lg:h-screen flex flex-col lg:flex-row overflow-x-hidden lg:overflow-hidden bg-white">
      <aside
        className="hidden lg:flex lg:w-[42%] lg:max-w-[520px] lg:shrink-0 flex-col text-white relative overflow-y-auto"
        style={SUMMARY_GRADIENT_STYLE}
      >
        <PaymentSummaryGradientDecor />
        <div className="relative flex flex-col min-h-full p-10 xl:p-12 z-[1]">
          <div className="flex-1">
            <CheckoutSummaryHeading
              summary={summaryData}
              titleClassName="text-lg xl:text-xl font-semibold text-white leading-snug tracking-tight mb-2 max-w-sm"
            />
            {summaryData && (
              <PaymentSummaryCard
                summary={summaryData}
                exchangeInfo={exchangeInfo}
                exchangeLoading={exchangeLoading}
                variant="gradient"
              />
            )}
            <img
              src={encodeURI(CHECKOUT_DESKTOP_FOOTER_IMAGE)}
              alt=""
              className="mt-8 mb-2 w-full max-w-[400px] xl:max-w-[420px] h-auto object-contain pointer-events-none select-none"
              draggable={false}
            />
            {isAlreadyPaid && <PaymentDoneStamp paidAt={paidAt} />}
          </div>
          <p className="text-[11px] text-white/50 leading-relaxed max-w-xs shrink-0">
            Processed securely by Pelecard. Card details are not stored on our servers.
          </p>
        </div>
      </aside>

      <main className="relative flex-1 flex flex-col w-full max-lg:overflow-visible lg:min-h-0 lg:overflow-y-auto lg:overflow-hidden bg-white">
        <div className="pointer-events-none absolute top-8 right-12 xl:right-16 z-20 hidden lg:block">
          <CheckoutSecuredStamp />
        </div>
        <div
          className="lg:hidden shrink-0 relative overflow-x-hidden text-white px-5 pt-8 pb-8"
          style={SUMMARY_GRADIENT_STYLE}
        >
          <PaymentSummaryGradientDecor />
          <div className="pointer-events-none absolute top-5 right-5 z-20">
            <CheckoutSecuredStamp iconOnly />
          </div>
          <div className="relative z-[1] pr-14">
            <CheckoutSummaryHeading
              summary={summaryData}
              titleClassName="text-lg font-semibold text-white leading-snug tracking-tight mb-2"
            />
            {summaryData && (
              <PaymentSummaryCard
                summary={summaryData}
                exchangeInfo={exchangeInfo}
                exchangeLoading={exchangeLoading}
                variant="gradient"
              />
            )}
            {isAlreadyPaid && <PaymentDoneStamp paidAt={paidAt} />}
          </div>
        </div>

        <div className="checkout-payment relative max-lg:shrink-0 max-lg:flex-none flex flex-col w-full max-w-4xl mx-auto px-4 sm:px-6 lg:flex-1 lg:min-h-0 lg:max-w-none lg:mx-0 lg:px-12 xl:px-16 py-4 sm:py-6 lg:pt-6 lg:pb-2 max-lg:pb-8">
          <h2 className="hidden lg:block text-xl font-semibold text-gray-900 mb-4 tracking-tight shrink-0">
            Payment information
          </h2>
          {isAlreadyPaid ? (
            <div className="flex flex-1 items-center justify-center rounded-2xl border border-gray-100 bg-gray-50/60 px-6 py-16 text-center">
              <div>
                <CheckCircleIcon className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
                <p className="text-base font-semibold text-gray-900">Payment already completed</p>
                <p className="mt-2 text-sm text-gray-500">No further action is required.</p>
              </div>
            </div>
          ) : (
            <PelecardCheckoutFrame
              paymentUrl={paymentUrl}
              loading={sessionLoading}
              error={sessionError}
              onRetry={loadPelecardSession}
              onCheckoutNavigate={(path) => navigate(path)}
              title="Secure payment"
              shellClassName="max-lg:h-auto max-lg:flex-none lg:flex-1 lg:min-h-0 lg:h-full"
            />
          )}
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
