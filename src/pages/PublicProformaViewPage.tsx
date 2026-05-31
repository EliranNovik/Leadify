import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import ProformaExchangeRateFooter from '../components/proforma/ProformaExchangeRateFooter';
import ProformaTotalInNis from '../components/proforma/ProformaTotalInNis';
import ProformaDocumentStamp from '../components/proforma/ProformaDocumentStamp';
import ProformaIssuedByFooter from '../components/proforma/ProformaIssuedByFooter';
import ProformaBankDetails from '../components/proforma/ProformaBankDetails';
import ProformaPublicToolbar from '../components/proforma/ProformaPublicToolbar';
import ProformaPublicContactButtons from '../components/proforma/ProformaPublicContactButtons';
import ProformaPublicFooter from '../components/proforma/ProformaPublicFooter';
import ProformaFromCompanyInfo from '../components/proforma/ProformaFromCompanyInfo';
import ProformaVatTotalsBlock from '../components/proforma/ProformaVatTotalsBlock';
import {
  applyNewPaymentPlanAmountsToProforma,
} from '../lib/proformaPaymentPlanAmounts';
import type { ResolvedProformaVat } from '../lib/proformaVat';
import { proformaDisplayCurrency, resolveProformaCurrency } from '../lib/paymentPlanCurrency';
import { getPublicProformaMainLayoutClass } from '../lib/publicProformaLayout';
import { resolveBankAccountFromProforma } from '../lib/bankAccounts';
import { shareCurrentPageUrl } from '../lib/proformaPublicLink';
import { fetchIssuerEmployee, type EmployeeProfile } from '../lib/fetchEmployeeProfile';
import {
  currencyInputFromNewPayment,
  fetchProformaExchangeRateInfo,
  type ProformaExchangeRateInfo,
} from '../lib/proformaExchangeRate';
import { useAuthContext } from '../contexts/AuthContext';
import { buildClientFinancesTabPath } from '../lib/proformaClientNavigation';

const PublicProformaViewPage: React.FC = () => {
  const { id, token } = useParams<{ id: string; token: string }>();
  const { user } = useAuthContext();
  const [proforma, setProforma] = useState<any>(null);
  const [paymentPlanMeta, setPaymentPlanMeta] = useState<{
    paid: boolean;
    paid_at: string | null;
    currency?: string | null;
    currency_id?: number | string | null;
    lead_id?: string | number | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exchangeInfo, setExchangeInfo] = useState<ProformaExchangeRateInfo | null>(null);
  const [exchangeLoading, setExchangeLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [issuerEmployee, setIssuerEmployee] = useState<EmployeeProfile | null>(null);
  const [publicLeadNumber, setPublicLeadNumber] = useState<string | null>(null);
  const [vatTotals, setVatTotals] = useState<ResolvedProformaVat | null>(null);

  useEffect(() => {
    const fetchProforma = async (options?: { silent?: boolean }) => {
      if (!id || !token) {
        setError('Invalid link.');
        setLoading(false);
        return;
      }

      if (!options?.silent) {
        setLoading(true);
        setError(null);
      }

      const { data, error: rpcError } = await supabase.rpc('get_public_new_proforma', {
        p_payment_plan_id: Number(id),
        p_public_token: token,
      });

      if (rpcError || !data) {
        setError('Invoice not found or link is invalid.');
        setLoading(false);
        return;
      }

      try {
        let parsed = data.proforma;
        if (typeof parsed === 'string') {
          parsed = JSON.parse(parsed);
        }

        const { displaySymbol: resolvedCurrency, currencyId: resolvedCurrencyId } =
          await resolveProformaCurrency({
            currency: parsed.currency ?? data.currency,
            currency_id: parsed.currency_id ?? data.currency_id,
          });

        parsed.currency = resolvedCurrency;
        parsed.currency_id = resolvedCurrencyId;
        parsed.paymentOrder = parsed.paymentOrder ?? data.payment_order;
        parsed.dueDate = parsed.dueDate ?? data.due_date;

        const { proforma: syncedProforma, vatTotals: resolvedVat } = applyNewPaymentPlanAmountsToProforma(parsed, {
          value: data.value,
          value_vat: data.value_vat,
          currency: resolvedCurrency,
          currency_id: resolvedCurrencyId,
          payment_order: data.payment_order ?? parsed.paymentOrder,
          due_date: data.due_date ?? parsed.dueDate,
        });
        parsed = syncedProforma;
        setVatTotals(resolvedVat);

        const resolvedLeadNumber =
          (typeof data.lead_number === 'string' && data.lead_number.trim()) ||
          (typeof parsed.lead_number === 'string' && parsed.lead_number.trim()) ||
          null;

        if (resolvedLeadNumber && !parsed.lead_number) {
          parsed.lead_number = resolvedLeadNumber;
        }

        setProforma(parsed);
        setPublicLeadNumber(resolvedLeadNumber);
        setPaymentPlanMeta({
          paid: Boolean(data.paid),
          paid_at: data.paid_at ?? null,
          currency: resolvedCurrency,
          currency_id: resolvedCurrencyId ?? null,
          lead_id: data.lead_id ?? parsed.clientId ?? null,
        });
      } catch {
        setError('Failed to load invoice.');
      } finally {
        if (!options?.silent) setLoading(false);
      }
    };

    void fetchProforma();

    const channel = supabase
      .channel(`public-proforma-payment-plan-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'payment_plans', filter: `id=eq.${id}` },
        () => {
          void fetchProforma({ silent: true });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, token]);

  useEffect(() => {
    if (!proforma) {
      setIssuerEmployee(null);
      return;
    }

    let cancelled = false;
    const loadIssuer = async () => {
      const profile = await fetchIssuerEmployee({
        displayName: proforma.createdBy ?? null,
      });
      if (!cancelled) setIssuerEmployee(profile);
    };

    void loadIssuer();
    return () => {
      cancelled = true;
    };
  }, [proforma?.createdBy]);

  useEffect(() => {
    if (!proforma || !paymentPlanMeta) {
      setExchangeInfo(null);
      return;
    }

    let cancelled = false;
    const loadExchange = async () => {
      setExchangeLoading(true);
      try {
        const subtotal = vatTotals?.subtotal ?? (Number(proforma.total) || 0);
        const vat = vatTotals?.vat ?? (Number(proforma.vat) || 0);
        const totalWithVat = vatTotals?.totalWithVat ?? (Number(proforma.totalWithVat) || subtotal + vat);
        const info = await fetchProformaExchangeRateInfo({
          currency: currencyInputFromNewPayment(paymentPlanMeta, proforma.currency),
          paid: paymentPlanMeta.paid,
          paidAt: paymentPlanMeta.paid_at,
          subtotal,
          vat,
          total: totalWithVat,
          paymentPlanId: id,
        });
        if (!cancelled) setExchangeInfo(info);
      } catch (err) {
        console.error('[PublicProformaViewPage] exchange rate:', err);
        if (!cancelled) setExchangeInfo(null);
      } finally {
        if (!cancelled) setExchangeLoading(false);
      }
    };

    void loadExchange();
    return () => {
      cancelled = true;
    };
  }, [proforma, paymentPlanMeta, vatTotals, id]);

  const handlePrint = () => window.print();

  const handleShare = async () => {
    setSharing(true);
    try {
      await shareCurrentPageUrl({
        title: `Invoice — ${proforma?.client || 'Client'}`,
      });
    } catch (err) {
      console.error('[PublicProformaViewPage] share:', err);
    } finally {
      setSharing(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-600">Loading invoice…</div>;
  }

  if (error || !proforma) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6 text-center text-red-600">
        {error || 'Invoice not found.'}
      </div>
    );
  }

  const currencyLabel = proformaDisplayCurrency({
    currency: proforma.currency,
    currency_id: proforma.currency_id ?? paymentPlanMeta?.currency_id,
  });
  const leadLabel = publicLeadNumber || proforma.lead_number || '—';
  const displayNotes = (proforma.notes as string | undefined)?.trim() ?? '';
  const hasDesktopSidePanels = Boolean(
    (leadLabel !== '—' ? leadLabel : '') || displayNotes,
  );
  const financesTabPath = user
    ? buildClientFinancesTabPath({
        isLegacy: false,
        leadNumber: leadLabel !== '—' ? leadLabel : proforma.lead_number,
        leadId: proforma.clientId,
      })
    : null;

  return (
    <div className="min-h-screen bg-white md:bg-gray-50">
      <ProformaPublicContactButtons
        issuerEmployee={issuerEmployee}
        leadNumber={leadLabel !== '—' ? leadLabel : null}
        notes={displayNotes || null}
        paid={paymentPlanMeta?.paid}
        paymentPlanId={id}
        leadClientId={paymentPlanMeta?.lead_id ?? proforma?.clientId ?? null}
      />
      <ProformaPublicToolbar
        title={`Invoice — ${proforma.client || 'Client'}`}
        paid={paymentPlanMeta?.paid}
        paidAt={paymentPlanMeta?.paid_at}
        onPrint={handlePrint}
        onShare={handleShare}
        sharing={sharing}
        backToLeadHref={financesTabPath}
      />

      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #invoice-print-area, #invoice-print-area * {
            visibility: visible !important;
            color: #222 !important;
          }
          #invoice-print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 20px !important;
            box-shadow: none !important;
            border: none !important;
          }
          .print-hide { display: none !important; }
        }
      `}</style>

      <div className={getPublicProformaMainLayoutClass(hasDesktopSidePanels)}>
        <div
          id="invoice-print-area"
          className="relative w-full overflow-hidden bg-white px-4 py-6 md:rounded-2xl md:border md:border-gray-200 md:p-8 md:shadow-sm"
        >
          <div className="mb-14 flex items-start justify-between gap-4">
            <div>
              <div className="text-2xl font-extrabold tracking-tight text-gray-900 md:text-3xl">Invoice</div>
              <div className="mt-1 text-base font-semibold text-gray-500">{proforma.proformaName}</div>
            </div>
            <div className="flex flex-shrink-0 items-center justify-center">
              <img
                src="/DPL-LOGO1.png"
                alt="DPL Logo"
                className="h-12 w-auto max-w-[7rem] object-contain md:h-16 md:max-w-[9rem]"
              />
            </div>
          </div>

          <div className="proforma-from-bill-grid mb-8 grid grid-cols-1 gap-8 md:grid-cols-2 print:grid-cols-2">
            <div>
              <ProformaFromCompanyInfo />
            </div>
            <div>
              <div className="mb-1 font-semibold text-gray-700">Bill To:</div>
              <div className="text-lg font-bold text-gray-900">{proforma.client}</div>
              {proforma.lead_number && (
                <div className="text-sm font-semibold text-gray-600">Case #: {leadLabel}</div>
              )}
              {proforma.phone && <div className="text-sm text-gray-500">{proforma.phone}</div>}
              {proforma.email && <div className="text-sm text-gray-500">{proforma.email}</div>}
            </div>
          </div>

          <div className="mb-8">
            <table className="min-w-full overflow-hidden rounded-xl border">
              <thead className="border-b bg-white">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-gray-700">Description</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-gray-700">Qty</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-gray-700">Rate</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-gray-700">Total</th>
                </tr>
              </thead>
              <tbody>
                {proforma.rows.map((row: any, idx: number) => (
                  <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2 font-medium text-gray-900">{row.description}</td>
                    <td className="px-4 py-2 text-right">{row.qty}</td>
                    <td className="px-4 py-2 text-right">{currencyLabel} {row.rate}</td>
                    <td className="px-4 py-2 text-right font-bold">{currencyLabel} {row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mb-6 flex flex-col gap-4 md:flex-row md:justify-end">
            <div className="w-full rounded-xl border border-gray-200 bg-white p-6 md:w-1/2">
              {vatTotals && (
                <ProformaVatTotalsBlock currencyLabel={currencyLabel} resolved={vatTotals} />
              )}
              <ProformaTotalInNis info={exchangeInfo} loading={exchangeLoading} variant="card" />
            </div>
          </div>

          <ProformaBankDetails details={resolveBankAccountFromProforma(proforma)} variant="card" />
          <ProformaExchangeRateFooter info={exchangeInfo} loading={exchangeLoading} variant="card" />

          <ProformaIssuedByFooter name={proforma.createdBy} date={proforma.createdAt} />

          <ProformaDocumentStamp variant="card" />
        </div>
      </div>

      <ProformaPublicFooter />
    </div>
  );
};

export default PublicProformaViewPage;
