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
import { resolveBankAccountFromProforma } from '../lib/bankAccounts';
import { shareCurrentPageUrl } from '../lib/proformaPublicLink';
import { fetchIssuerEmployee, type EmployeeProfile } from '../lib/fetchEmployeeProfile';
import {
  currencyInputFromNewPayment,
  fetchProformaExchangeRateInfo,
  type ProformaExchangeRateInfo,
} from '../lib/proformaExchangeRate';

const PublicProformaViewPage: React.FC = () => {
  const { id, token } = useParams<{ id: string; token: string }>();
  const [proforma, setProforma] = useState<any>(null);
  const [paymentPlanMeta, setPaymentPlanMeta] = useState<{
    paid: boolean;
    paid_at: string | null;
    currency?: string | null;
    currency_id?: number | string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exchangeInfo, setExchangeInfo] = useState<ProformaExchangeRateInfo | null>(null);
  const [exchangeLoading, setExchangeLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [issuerEmployee, setIssuerEmployee] = useState<EmployeeProfile | null>(null);
  const [publicLeadNumber, setPublicLeadNumber] = useState<string | null>(null);

  useEffect(() => {
    const fetchProforma = async () => {
      if (!id || !token) {
        setError('Invalid link.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

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

        if (
          parsed.addVat &&
          parsed.currency === '₪' &&
          (!parsed.vat || parsed.vat === 0)
        ) {
          parsed.vat = Math.round(parsed.total * 0.18 * 100) / 100;
          parsed.totalWithVat = parsed.total + parsed.vat;
        }

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
          currency: data.currency ?? null,
          currency_id: data.currency_id ?? null,
        });
      } catch {
        setError('Failed to load invoice.');
      } finally {
        setLoading(false);
      }
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
        const subtotal = Number(proforma.total) || 0;
        const totalWithVat = Number(proforma.totalWithVat) || subtotal;
        const vat = Number(proforma.vat) || Math.max(0, totalWithVat - subtotal);
        const info = await fetchProformaExchangeRateInfo({
          currency: currencyInputFromNewPayment(paymentPlanMeta, proforma.currency),
          paid: paymentPlanMeta.paid,
          paidAt: paymentPlanMeta.paid_at,
          subtotal,
          vat,
          total: totalWithVat,
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
  }, [proforma, paymentPlanMeta]);

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

  const leadLabel = publicLeadNumber || proforma.lead_number || '—';
  const displayNotes = (proforma.notes as string | undefined)?.trim() ?? '';
  const hasDesktopSidePanels = Boolean(
    (leadLabel !== '—' ? leadLabel : '') || displayNotes,
  );

  return (
    <div className="min-h-screen bg-white md:bg-gray-50">
      <ProformaPublicContactButtons
        issuerEmployee={issuerEmployee}
        leadNumber={leadLabel !== '—' ? leadLabel : null}
        notes={displayNotes || null}
      />
      <ProformaPublicToolbar
        title={`Invoice — ${proforma.client || 'Client'}`}
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
                <div className="text-sm font-semibold text-gray-600">Lead #: {leadLabel}</div>
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
                    <td className="px-4 py-2 text-right">{proforma.currency} {row.rate}</td>
                    <td className="px-4 py-2 text-right font-bold">{proforma.currency} {row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mb-6 flex flex-col gap-4 md:flex-row md:justify-end">
            <div className="w-full rounded-xl border border-gray-200 bg-white p-6 md:w-1/2">
              <div className="mb-2 flex justify-between text-lg">
                <span className="font-semibold text-gray-700">Subtotal</span>
                <span className="font-bold text-gray-900">{proforma.currency} {proforma.total}</span>
              </div>
              {proforma.addVat && (
                <div className="mb-2 flex justify-between text-lg">
                  <span className="font-semibold text-gray-700">VAT (18%)</span>
                  <span className="font-bold text-gray-900">
                    {proforma.currency} {(proforma.totalWithVat - proforma.total).toFixed(2)}
                  </span>
                </div>
              )}
              <div className="mt-4 flex justify-between border-t pt-4 text-xl font-extrabold">
                <span>Total</span>
                <span className="text-primary">{proforma.currency} {proforma.totalWithVat}</span>
              </div>
              <ProformaTotalInNis info={exchangeInfo} loading={exchangeLoading} variant="card" />
            </div>
          </div>

          <ProformaBankDetails details={resolveBankAccountFromProforma(proforma)} variant="card" />
          <ProformaExchangeRateFooter info={exchangeInfo} loading={exchangeLoading} variant="card" />

          {proforma.createdBy && (
            <div className="mt-8 text-xs text-gray-500">
              <span className="font-semibold">Issued by:</span> {proforma.createdBy}
            </div>
          )}

          <ProformaDocumentStamp variant="card" />
        </div>
      </div>

      <ProformaPublicFooter />
    </div>
  );
};

export default PublicProformaViewPage;
