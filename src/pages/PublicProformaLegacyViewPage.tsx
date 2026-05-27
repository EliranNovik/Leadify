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
import { getPublicProformaMainLayoutClass } from '../lib/publicProformaLayout';
import { parseLegacyBankFromNotes, resolveBankAccountFromProforma } from '../lib/bankAccounts';
import { getPublicProformaDisplayNotes } from '../lib/proformaNotes';
import { shareCurrentPageUrl } from '../lib/proformaPublicLink';
import { fetchIssuerEmployee, type EmployeeProfile } from '../lib/fetchEmployeeProfile';
import ProformaVatTotalsBlock from '../components/proforma/ProformaVatTotalsBlock';
import { applyLegacyPaymentPlanAmountsToProforma } from '../lib/proformaPaymentPlanAmounts';
import type { ResolvedProformaVat } from '../lib/proformaVat';
import { proformaDisplayCurrency, resolveProformaCurrency } from '../lib/paymentPlanCurrency';
import {
  currencyInputFromLegacyProforma,
  fetchProformaExchangeRateInfo,
  type ProformaExchangeRateInfo,
} from '../lib/proformaExchangeRate';
import { useAuthContext } from '../contexts/AuthContext';
import { buildClientFinancesTabPath } from '../lib/proformaClientNavigation';

function getCurrencySymbol(
  currency: string | undefined,
  currencyId?: number | string | null,
): string {
  return proformaDisplayCurrency({ currency_code: currency, currency_id: currencyId });
}

const PublicProformaLegacyViewPage: React.FC = () => {
  const { id, token } = useParams<{ id: string; token: string }>();
  const { user } = useAuthContext();
  const [proforma, setProforma] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exchangeInfo, setExchangeInfo] = useState<ProformaExchangeRateInfo | null>(null);
  const [exchangeLoading, setExchangeLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [issuerEmployee, setIssuerEmployee] = useState<EmployeeProfile | null>(null);
  const [vatTotals, setVatTotals] = useState<ResolvedProformaVat | null>(null);

  useEffect(() => {
    const fetchProforma = async (options?: { silent?: boolean }) => {
      if (!id || !token) {
        setError('Invalid link.');
        setLoading(false);
        return null;
      }

      if (!options?.silent) {
        setLoading(true);
        setError(null);
      }

      const { data, error: rpcError } = await supabase.rpc('get_public_legacy_proforma', {
        p_proforma_id: Number(id),
        p_public_token: token,
      });

      if (rpcError || !data) {
        setError('Invoice not found or link is invalid.');
        if (!options?.silent) setLoading(false);
        return null;
      }

      const bankAccountDetails = parseLegacyBankFromNotes(data.notes) ?? null;

      const { displaySymbol: resolvedCurrency, currencyId: resolvedCurrencyId } =
        await resolveProformaCurrency({
          currency_id: data.currency_id,
          currency: data.currency_code,
        });

      const proformaPayload = {
        ...data,
        rows: data.rows || [],
        bankAccountDetails,
        currency_code: resolvedCurrency,
        currency_id: resolvedCurrencyId,
      };

      const paymentPlanVat =
        data.payment_plan_vat_value ?? data.paymentPlanVatValue ?? null;
      const paymentPlanValue =
        data.payment_plan_value ?? data.paymentPlanValue ?? null;

      const { proforma: syncedProforma, vatTotals: resolvedVat } = applyLegacyPaymentPlanAmountsToProforma(
        proformaPayload,
        {
          value: paymentPlanValue,
          vat_value: paymentPlanVat ?? data.vat_value,
          order: data.payment_order,
          currency_id: resolvedCurrencyId ?? data.currency_id,
        },
      );

      setVatTotals(resolvedVat);
      setProforma(syncedProforma);
      if (!options?.silent) setLoading(false);
      return data.ppr_id ?? null;
    };

    let pprChannel: ReturnType<typeof supabase.channel> | null = null;

    void fetchProforma().then((pprId) => {
      if (!pprId) return;
      pprChannel = supabase
        .channel(`public-legacy-proforma-ppr-${pprId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'finances_paymentplanrow',
            filter: `id=eq.${pprId}`,
          },
          () => {
            void fetchProforma({ silent: true });
          },
        )
        .subscribe();
    });

    return () => {
      if (pprChannel) void supabase.removeChannel(pprChannel);
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
        employeeId: proforma.issuer_employee_id ?? null,
        displayName: proforma.issuedBy ?? null,
      });
      if (!cancelled) setIssuerEmployee(profile);
    };

    void loadIssuer();
    return () => {
      cancelled = true;
    };
  }, [proforma?.issuer_employee_id, proforma?.issuedBy]);

  useEffect(() => {
    if (!proforma) {
      setExchangeInfo(null);
      return;
    }

    let cancelled = false;
    const loadExchange = async () => {
      setExchangeLoading(true);
      try {
        const resolved =
          vatTotals ??
          applyLegacyPaymentPlanAmountsToProforma(proforma, {
            value: proforma.payment_plan_value,
            vat_value: proforma.payment_plan_vat_value ?? proforma.vat_value,
            order: proforma.payment_order,
          }).vatTotals;
        const subtotal = resolved.subtotal;
        const vat = resolved.vat;
        const total = resolved.totalWithVat;
        const info = await fetchProformaExchangeRateInfo({
          currency: currencyInputFromLegacyProforma(proforma),
          paid: Boolean(proforma.paymentPaid),
          paidAt: proforma.paid_at ?? null,
          subtotal,
          vat,
          total,
        });
        if (!cancelled) setExchangeInfo(info);
      } catch (err) {
        console.error('[PublicProformaLegacyViewPage] exchange rate:', err);
        if (!cancelled) setExchangeInfo(null);
      } finally {
        if (!cancelled) setExchangeLoading(false);
      }
    };

    void loadExchange();
    return () => {
      cancelled = true;
    };
  }, [proforma, vatTotals]);

  const handlePrint = () => window.print();

  const handleShare = async () => {
    setSharing(true);
    try {
      await shareCurrentPageUrl({
        title: `Invoice — ${proforma?.client_name || 'Client'}`,
      });
    } catch (err) {
      console.error('[PublicProformaLegacyViewPage] share:', err);
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

  const currencySymbol = getCurrencySymbol(proforma.currency_code, proforma.currency_id);
  const displayNotes = getPublicProformaDisplayNotes(proforma.notes);
  const hasDesktopSidePanels = Boolean(proforma.lead_number || displayNotes);
  const legacyLeadNumber = proforma.lead_number?.trim() || '';
  const financesTabPath = user
    ? buildClientFinancesTabPath({
        isLegacy: true,
        leadId: proforma.lead_id,
        leadNumber: legacyLeadNumber || undefined,
        manualId: legacyLeadNumber.includes('/')
          ? legacyLeadNumber.split('/')[0]
          : undefined,
      })
    : null;

  return (
    <div className="min-h-screen bg-white md:bg-gray-50">
      <ProformaPublicContactButtons
        issuerEmployee={issuerEmployee}
        leadNumber={proforma.lead_number || null}
        notes={displayNotes || null}
        paid={proforma.paymentPaid}
        paymentPlanId={proforma.ppr_id}
        leadClientId={proforma.lead_id}
      />
      <ProformaPublicToolbar
        title={`Invoice — ${proforma.client_name || 'Client'}`}
        paid={proforma.paymentPaid}
        paidAt={proforma.paid_at}
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
            </div>
            <div className="flex flex-shrink-0 items-center justify-center">
              <img
                src="/DPL-LOGO1.png"
                alt="DPL Logo"
                className="h-12 w-auto max-w-[7rem] object-contain md:h-16 md:max-w-[9rem]"
              />
            </div>
          </div>

          <div className="proforma-from-bill-grid mb-8 grid grid-cols-1 gap-8 lg:grid-cols-2 print:grid-cols-2">
            <div>
              <ProformaFromCompanyInfo showFromLabel showPhoneLabel />
            </div>
            <div>
              <div className="mb-1 font-semibold text-gray-700">Bill To:</div>
              <div className="text-lg font-bold text-gray-900">{proforma.client_name}</div>
              {proforma.client_phone && <div className="text-sm text-gray-500">{proforma.client_phone}</div>}
              {proforma.client_email && <div className="text-sm text-gray-500">{proforma.client_email}</div>}
              {proforma.lead_number && (
                <div className="text-sm font-semibold text-gray-500">Case #: {proforma.lead_number}</div>
              )}
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
                {(proforma.rows || []).map((row: any, idx: number) => (
                  <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2 font-medium text-gray-900">{row.description}</td>
                    <td className="px-4 py-2 text-right">{row.qty}</td>
                    <td className="px-4 py-2 text-right">{currencySymbol} {row.rate}</td>
                    <td className="px-4 py-2 text-right font-bold">{currencySymbol} {row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mb-6 flex flex-col gap-4 md:flex-row md:justify-end">
            <div className="w-full rounded-xl border border-gray-200 bg-white p-6 md:w-1/2">
              {vatTotals && (
                <ProformaVatTotalsBlock currencyLabel={currencySymbol} resolved={vatTotals} />
              )}
              <ProformaTotalInNis info={exchangeInfo} loading={exchangeLoading} variant="card" />
            </div>
          </div>

          <ProformaBankDetails details={resolveBankAccountFromProforma(proforma)} variant="card" />
          <ProformaExchangeRateFooter info={exchangeInfo} loading={exchangeLoading} variant="card" />

          <ProformaIssuedByFooter
            name={proforma.issuedBy}
            date={proforma.issuedDate ?? proforma.cdate}
          />

          <ProformaDocumentStamp variant="card" />
        </div>
      </div>

      <ProformaPublicFooter />
    </div>
  );
};

export default PublicProformaLegacyViewPage;
