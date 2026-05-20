import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import ProformaExchangeRateFooter from '../components/proforma/ProformaExchangeRateFooter';
import ProformaTotalInNis from '../components/proforma/ProformaTotalInNis';
import ProformaDocumentStamp from '../components/proforma/ProformaDocumentStamp';
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
import { getVatRateForLegacyLead } from '../lib/legacyProformaVat';
import {
  currencyInputFromLegacyProforma,
  fetchProformaExchangeRateInfo,
  type ProformaExchangeRateInfo,
} from '../lib/proformaExchangeRate';

function getCurrencySymbol(currency: string | undefined): string {
  if (!currency) return '₪';
  if (currency === 'ILS' || currency === '₪') return '₪';
  if (currency === 'USD' || currency === '$') return '$';
  if (currency === 'EUR' || currency === '€') return '€';
  if (currency === 'GBP' || currency === '£') return '£';
  if (currency.length <= 2 && !/^[A-Z]{3}$/.test(currency)) return currency;
  return currency;
}

const PublicProformaLegacyViewPage: React.FC = () => {
  const { id, token } = useParams<{ id: string; token: string }>();
  const [proforma, setProforma] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exchangeInfo, setExchangeInfo] = useState<ProformaExchangeRateInfo | null>(null);
  const [exchangeLoading, setExchangeLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [issuerEmployee, setIssuerEmployee] = useState<EmployeeProfile | null>(null);

  useEffect(() => {
    const fetchProforma = async () => {
      if (!id || !token) {
        setError('Invalid link.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const { data, error: rpcError } = await supabase.rpc('get_public_legacy_proforma', {
        p_proforma_id: Number(id),
        p_public_token: token,
      });

      if (rpcError || !data) {
        setError('Invoice not found or link is invalid.');
        setLoading(false);
        return;
      }

      const bankAccountDetails = parseLegacyBankFromNotes(data.notes) ?? null;

      setProforma({
        ...data,
        rows: data.rows || [],
        bankAccountDetails,
      });
      setLoading(false);
    };

    void fetchProforma();
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
        const subtotal = Number(proforma.sub_total || proforma.total_base || 0);
        const vat = Number(proforma.vat_value || 0);
        const total = Number(proforma.total || 0);
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
  }, [proforma]);

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

  const currencySymbol = getCurrencySymbol(proforma.currency_code);
  const vatDate = proforma.paymentPlanDate || proforma.cdate || null;
  const vatRate = getVatRateForLegacyLead(vatDate);
  const vatPercentage = Math.round(vatRate * 100);
  const displayNotes = getPublicProformaDisplayNotes(proforma.notes);
  const hasDesktopSidePanels = Boolean(proforma.lead_number || displayNotes);

  return (
    <div className="min-h-screen bg-white md:bg-gray-50">
      <ProformaPublicContactButtons
        issuerEmployee={issuerEmployee}
        leadNumber={proforma.lead_number || null}
        notes={displayNotes || null}
      />
      <ProformaPublicToolbar
        title={`Invoice — ${proforma.client_name || 'Client'}`}
        onPrint={handlePrint}
        onShare={handleShare}
        sharing={sharing}
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
                <div className="text-sm font-semibold text-gray-500">Lead #: {proforma.lead_number}</div>
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
              <div className="mb-2 flex justify-between text-lg">
                <span className="font-semibold text-gray-700">Subtotal</span>
                <span className="font-bold text-gray-900">
                  {currencySymbol} {Number(proforma.sub_total || proforma.total_base || 0).toFixed(2)}
                </span>
              </div>
              {proforma.add_vat === 't' && (
                <div className="mb-2 flex justify-between text-lg">
                  <span className="font-semibold text-gray-700">VAT ({vatPercentage}%)</span>
                  <span className="font-bold text-gray-900">
                    {currencySymbol} {Number(proforma.vat_value || 0).toFixed(2)}
                  </span>
                </div>
              )}
              <div className="mt-4 flex justify-between border-t pt-4 text-xl font-extrabold">
                <span>Total</span>
                <span style={{ color: '#006BB1' }}>
                  {currencySymbol} {Number(proforma.total || 0).toFixed(2)}
                </span>
              </div>
              <ProformaTotalInNis info={exchangeInfo} loading={exchangeLoading} variant="card" />
            </div>
          </div>

          <ProformaBankDetails details={resolveBankAccountFromProforma(proforma)} variant="card" />
          <ProformaExchangeRateFooter info={exchangeInfo} loading={exchangeLoading} variant="card" />

          {proforma.issuedBy && (
            <div className="mt-8 text-xs text-gray-500">
              <span className="font-semibold">Issued by:</span> {proforma.issuedBy}
            </div>
          )}

          <ProformaDocumentStamp variant="card" />
        </div>
      </div>

      <ProformaPublicFooter />
    </div>
  );
};

export default PublicProformaLegacyViewPage;
