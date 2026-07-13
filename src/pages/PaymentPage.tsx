import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { createPelecardPaymentSession, fetchBillingContact, fetchPaymentStatus } from '../lib/pelecardPaymentApi';
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
  lockedBoiChargeFromPaymentLinkRow,
  type ProformaExchangeRateInfo,
} from '../lib/proformaExchangeRate';
import { isLegacyPaymentLinkRow } from '../lib/paymentLinkLeadRef';
import { ensurePelecardClientSecureScript } from '../lib/pelecardWalletSetup';
import { runPelecardWalletDiagnostics } from '../lib/pelecardWalletDiagnostics';
import PaymentWalletDebugPanel from '../components/payment/PaymentWalletDebugPanel';
import { resolvePaymentPlanContact } from '../lib/resolvePaymentPlanContact';
import toast from 'react-hot-toast';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  InformationCircleIcon,
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

/** Gradient panel — credit card illustration from /public */
const CHECKOUT_DESKTOP_FOOTER_IMAGE = '/ChatGPT Image May 26, 2026, 09_41_00 AM.png';

const CHECKOUT_CARD_IMAGE_CLASS =
  'mt-8 w-full max-w-[520px] sm:max-w-[560px] xl:max-w-[600px] h-auto object-contain pointer-events-none select-none';

function CheckoutCardImage() {
  return (
    <img
      src={encodeURI(CHECKOUT_DESKTOP_FOOTER_IMAGE)}
      alt=""
      className={CHECKOUT_CARD_IMAGE_CLASS}
      draggable={false}
    />
  );
}

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
        <p className="text-base text-white/90 mb-6 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="font-mono text-[15px] font-medium text-white/80">Case #{summary.caseNumber}</span>
          <span className="text-white/40" aria-hidden>
            ·
          </span>
          <span className="text-[17px] font-semibold text-white">{summary.clientName}</span>
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
  plan_contact_id?: number | null;
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
  rate?: number | string | null;
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
      className={`inline-flex items-center justify-center rounded-full bg-white ${
        iconOnly ? 'p-2' : 'gap-1.5 px-3 py-1.5'
      }`}
      role="img"
      aria-label="Secured checkout"
    >
      <ShieldCheckIcon
        className={`shrink-0 text-emerald-600 ${iconOnly ? 'h-5 w-5' : 'h-4 w-4'}`}
        strokeWidth={2}
      />
      {!iconOnly && (
        <span className="text-xs font-medium text-gray-700">Secured</span>
      )}
    </div>
  );
}

function PaymentPassportIdNote({ className = '' }: { className?: string }) {
  return (
    <div
      className={`mt-5 rounded-lg bg-white/10 px-3 py-2 ${className}`.trim()}
      role="note"
      aria-label="ID or passport payment tip"
    >
      <div className="flex items-center justify-center gap-2 text-center">
        <InformationCircleIcon
          className="h-4 w-4 shrink-0 text-white/85"
          strokeWidth={1.75}
          aria-hidden
        />
        <p className="text-xs text-white/90 leading-snug text-center">
          Not Israeli? If payment fails, enter{' '}
          <span className="font-semibold text-white">0</span> in the ID / Passport field.
        </p>
      </div>
    </div>
  );
}

const PaymentPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const walletDebug = searchParams.get('walletDebug') === '1';
  const forceFreshSession = searchParams.get('fresh') === '1';

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

        // Billing contact from backend (service role) — anon cannot read leads_contact via Supabase RLS.
        try {
          const billing = await fetchBillingContact(token);
          if (billing.success && (billing.name || billing.email || billing.phone)) {
            enriched = {
              ...enriched,
              leads: {
                ...(enriched.leads || {}),
                name: billing.name || enriched.leads?.name || '',
                email: billing.email || enriched.leads?.email || '',
                phone: billing.phone || enriched.leads?.phone || '',
              },
            };
          } else {
            const leadId = isLegacyPaymentLink(enriched)
              ? enriched.legacy_id ?? null
              : enriched.client_id ?? null;
            const clientId =
              enriched.plan_contact_id != null
                ? Number(enriched.plan_contact_id)
                : isLegacyPaymentLink(enriched)
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
          }
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

  const loadCheckoutExchange = useCallback(
    async (options?: { forceBoiRefresh?: boolean }) => {
      if (!paymentLink) {
        setExchangeInfo(null);
        return;
      }

      const paid = isPaymentComplete(paymentLink);
      setExchangeLoading(true);
      try {
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
          paid,
          paidAt: getPaymentPaidAt(paymentLink),
          subtotal: Number(paymentLink.amount) || 0,
          vat: Number(paymentLink.vat_amount) || 0,
          total: Number(paymentLink.total_amount) || 0,
          paymentPlanId: paid ? paymentLink.payment_plan_id : null,
          lockedBoiCharge: paid ? lockedBoiChargeFromPaymentLinkRow(paymentLink) : null,
          useLatestBoiForUnpaid: !paid,
          forceLatestBoiRefresh: options?.forceBoiRefresh ?? !paid,
        });
        setExchangeInfo(info);
      } catch (err) {
        console.error('[PaymentPage] exchange rate:', err);
        setExchangeInfo(null);
      } finally {
        setExchangeLoading(false);
      }
    },
    [paymentLink],
  );

  useEffect(() => {
    void loadCheckoutExchange();
  }, [loadCheckoutExchange]);

  /** Pelecard Apple Pay / Google Pay: parent page must load ClientSecureV2 + host Apple domain file. */
  useEffect(() => {
    ensurePelecardClientSecureScript();
  }, []);

  useEffect(() => {
    if (!walletDebug) return;
    const timer = window.setTimeout(() => {
      void runPelecardWalletDiagnostics();
    }, 800);
    return () => window.clearTimeout(timer);
  }, [walletDebug]);

  const isAlreadyPaid = paymentLink ? isPaymentComplete(paymentLink) : false;
  const paidAt = paymentLink ? getPaymentPaidAt(paymentLink) : null;

  const canPay =
    paymentLink &&
    !isAlreadyPaid &&
    paymentLink.status !== 'expired' &&
    !(paymentLink.expires_at && new Date(paymentLink.expires_at) < new Date());

  const loadPelecardSession = useCallback(
    async (options?: { forceNew?: boolean }) => {
      if (!token || !paymentLink || !canPay) return;

      setSessionLoading(true);
      setSessionError(null);

      try {
        const result = await createPelecardPaymentSession(token, {
          forceNew: options?.forceNew ?? forceFreshSession,
        });
        if (result.alreadyPaid || result.status === 'paid') {
          navigate(`/payment/success?paymentId=${encodeURIComponent(token)}`);
          return;
        }
        if (!result.success || !result.paymentUrl) {
          throw new Error(result.error || 'Failed to create payment session');
        }
        await ensurePelecardClientSecureScript();
        setPaymentUrl(result.paymentUrl);
        await loadCheckoutExchange({ forceBoiRefresh: !result.reusedSession });
        if (forceFreshSession) {
          setSearchParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              next.delete('fresh');
              return next;
            },
            { replace: true },
          );
        }
      } catch (error) {
        console.error('[Pelecard] Session error:', error);
        const raw = error instanceof Error ? error.message : 'Could not start payment';
        setSessionError(raw);
      } finally {
        setSessionLoading(false);
      }
    },
    [
      token,
      paymentLink,
      canPay,
      forceFreshSession,
      navigate,
      loadCheckoutExchange,
      setSearchParams,
    ],
  );

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
      <div className="hidden lg:flex lg:w-[42%] lg:max-w-[520px] lg:shrink-0 lg:min-h-0 lg:self-stretch p-1 xl:p-1.5 box-border">
        <aside
          className="relative flex flex-1 flex-col w-full min-h-0 text-white overflow-hidden overflow-y-auto rounded-3xl"
          style={SUMMARY_GRADIENT_STYLE}
        >
          <PaymentSummaryGradientDecor />
          <div className="relative flex flex-col min-h-full p-10 xl:p-12 z-[1]">
          <div className="flex-1 flex flex-col">
            <CheckoutSummaryHeading
              summary={summaryData}
              titleClassName="text-xl xl:text-2xl font-semibold text-white leading-snug tracking-tight mb-2 max-w-sm"
            />
            {summaryData && (
              <PaymentSummaryCard
                summary={summaryData}
                exchangeInfo={exchangeInfo}
                exchangeLoading={exchangeLoading}
                variant="gradient"
              />
            )}
            <CheckoutCardImage />
            {isAlreadyPaid && <PaymentDoneStamp paidAt={paidAt} />}
            {canPay && <PaymentPassportIdNote className="lg:mt-auto lg:pt-10 xl:pt-12" />}
          </div>
          <p className="text-[11px] text-white/50 leading-relaxed max-w-xs shrink-0">
            Processed securely by Pelecard. Card details are not stored on our servers.
          </p>
          </div>
        </aside>
      </div>

      <main className="relative flex-1 flex flex-col w-full max-lg:overflow-visible lg:min-h-0 lg:overflow-y-auto lg:overflow-hidden bg-white">
        <div className="pointer-events-none absolute top-8 right-12 xl:right-16 z-20 hidden lg:block">
          <CheckoutSecuredStamp />
        </div>
        <div
          className="lg:hidden shrink-0 relative mx-1.5 mt-1.5 mb-0.5 overflow-hidden rounded-3xl text-white px-5 pt-8 pb-8"
          style={SUMMARY_GRADIENT_STYLE}
        >
          <PaymentSummaryGradientDecor />
          <div className="pointer-events-none absolute top-5 right-5 z-20">
            <CheckoutSecuredStamp iconOnly />
          </div>
          <div className="relative z-[1] pr-14">
            <CheckoutSummaryHeading
              summary={summaryData}
              titleClassName="text-xl font-semibold text-white leading-snug tracking-tight mb-2"
            />
            {summaryData && (
              <PaymentSummaryCard
                summary={summaryData}
                exchangeInfo={exchangeInfo}
                exchangeLoading={exchangeLoading}
                variant="gradient"
              />
            )}
            <CheckoutCardImage />
            {canPay && <PaymentPassportIdNote />}
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
              onRetry={() => loadPelecardSession({ forceNew: true })}
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
      {walletDebug && <PaymentWalletDebugPanel paymentUrl={paymentUrl} />}
    </div>
  );
};

export default PaymentPage;
