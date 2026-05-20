import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import html2pdf from 'html2pdf.js';
import { PencilSquareIcon, PrinterIcon, ShareIcon, TrashIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { shareProformaPublicLink } from '../lib/proformaPublicLink';
import ProformaExchangeRateFooter from '../components/proforma/ProformaExchangeRateFooter';
import ProformaTotalInNis from '../components/proforma/ProformaTotalInNis';
import ProformaDocumentStamp from '../components/proforma/ProformaDocumentStamp';
import ProformaBankDetails from '../components/proforma/ProformaBankDetails';
import ProformaFromCompanyInfo from '../components/proforma/ProformaFromCompanyInfo';
import ProformaViewSideNotes from '../components/proforma/ProformaViewSideNotes';
import { resolveBankAccountFromProforma, fetchBankAccountById } from '../lib/bankAccounts';
import {
  currencyInputFromNewPayment,
  fetchProformaExchangeRateInfo,
  type ProformaExchangeRateInfo,
} from '../lib/proformaExchangeRate';

const ProformaViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [proforma, setProforma] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const invoiceRef = useRef<HTMLDivElement>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [leadData, setLeadData] = useState<any>(null);
  const [subLeadsCount, setSubLeadsCount] = useState<number>(0);
  const [isMasterLead, setIsMasterLead] = useState<boolean>(false);
  const [exchangeInfo, setExchangeInfo] = useState<ProformaExchangeRateInfo | null>(null);
  const [exchangeLoading, setExchangeLoading] = useState(false);
  const [paymentPlanMeta, setPaymentPlanMeta] = useState<{
    paid: boolean;
    paid_at: string | null;
    currency?: string | null;
    currency_id?: number | string | null;
  } | null>(null);

  useEffect(() => {
    const fetchProforma = async () => {
      setLoading(true);
      setError(null);
      // Fetch both proforma and client_id from payment plan
      const { data, error } = await supabase
        .from('payment_plans')
        .select('proforma, client_id, paid, paid_at, currency, currency_id')
        .eq('id', id)
        .single();
      if (error || !data || !data.proforma) {
        setError('Proforma not found.');
        setLoading(false);
        return;
      }
      try {
        let parsed = JSON.parse(data.proforma);
        // Patch: If email/phone/name missing, fetch from the specific contact (client_id or contactId) that the payment plan is based on
        // Prefer contactId from parsed proforma data, then fallback to client_id from payment plan
        const contactIdToUse = parsed.contactId || data.client_id;
        if ((!parsed.email || !parsed.phone || !parsed.client) && contactIdToUse) {
          try {
            // Use contactId (from proforma data) or client_id (from payment plan) to get the correct contact
            // First try new contacts table
            const { data: newContactData } = await supabase
              .from('contacts')
              .select('name, email, phone')
              .eq('id', contactIdToUse)
              .single();

            if (newContactData) {
              if (!parsed.client) parsed.client = newContactData.name || '';
              if (!parsed.email) parsed.email = newContactData.email || '';
              if (!parsed.phone) parsed.phone = newContactData.phone || '';
            } else {
              // If not found in new contacts, try legacy leads_contact table
              const { data: legacyContactData } = await supabase
                .from('leads_contact')
                .select('name, email, phone')
                .eq('id', contactIdToUse)
                .single();

              if (legacyContactData) {
                if (!parsed.client) parsed.client = legacyContactData.name || '';
                if (!parsed.email) parsed.email = legacyContactData.email || '';
                if (!parsed.phone) parsed.phone = legacyContactData.phone || '';
              }
            }
          } catch (contactError) {
            console.error('Error fetching contact data:', contactError);
            // Error handling - contact data will remain null
          }
        } else if ((!parsed.email || !parsed.phone || !parsed.client) && parsed.clientId) {
          // Fallback: if no client_id, try to get main contact from lead (old behavior)
          try {
            // First, try to get the main contact
            const { data: leadContacts, error: leadContactsError } = await supabase
              .from('lead_leadcontact')
              .select(`
                main,
                contact_id
              `)
              .eq('newlead_id', parsed.clientId)
              .eq('main', 'true')
              .limit(1);

            let contactId = null;
            if (!leadContactsError && leadContacts && leadContacts.length > 0) {
              contactId = leadContacts[0].contact_id;
            } else {
              // Fallback: get any contact for this lead
              const { data: allContacts } = await supabase
                .from('lead_leadcontact')
                .select('contact_id')
                .eq('newlead_id', parsed.clientId)
                .limit(1);

              if (allContacts && allContacts.length > 0) {
                contactId = allContacts[0].contact_id;
              }
            }

            if (contactId) {
              const { data: contactData } = await supabase
                .from('contacts')
                .select('name, email, phone')
                .eq('id', contactId)
                .single();

              if (contactData) {
                if (!parsed.client) parsed.client = contactData.name || '';
                if (!parsed.email) parsed.email = contactData.email || '';
                if (!parsed.phone) parsed.phone = contactData.phone || '';
              }
            }
          } catch (contactError) {
            // Error handling - contact data will remain null
          }
        }

        // Fetch lead data for lead number formatting (including master_id, stage, subleads)
        if (parsed.clientId) {
          try {
            const { data: leadInfo } = await supabase
              .from('leads')
              .select('lead_number, manual_id, master_id, stage')
              .eq('id', parsed.clientId)
              .single();

            if (leadInfo) {
              setLeadData(leadInfo);

              // Check if it's a master lead (no master_id)
              const hasNoMasterId = !leadInfo.master_id || String(leadInfo.master_id).trim() === '';

              if (hasNoMasterId) {
                // Count subleads
                const { data: subLeads } = await supabase
                  .from('leads')
                  .select('id', { count: 'exact', head: false })
                  .eq('master_id', parsed.clientId);

                const subLeadsCountValue = subLeads?.length || 0;
                setSubLeadsCount(subLeadsCountValue);
                setIsMasterLead(subLeadsCountValue > 0);
              }

              // Set lead_number if missing
              if (!parsed.lead_number) {
                parsed.lead_number = leadInfo.lead_number || '';
              }
            }
          } catch (error) {
            console.error('Error fetching lead data:', error);
          }
        }
        // Patch: If addVat true, currency is NIS/ILS/₪, and vat is 0, recalc vat
        if (
          parsed.addVat &&
          (parsed.currency === '₪') &&
          (!parsed.vat || parsed.vat === 0)
        ) {
          parsed.vat = Math.round(parsed.total * 0.18 * 100) / 100;
          parsed.totalWithVat = parsed.total + parsed.vat;
        }
        if (!parsed.bankAccountDetails && parsed.bankAccountId) {
          parsed.bankAccountDetails = await fetchBankAccountById(String(parsed.bankAccountId));
        }
        setProforma(parsed);
        setPaymentPlanMeta({
          paid: Boolean(data.paid),
          paid_at: data.paid_at ?? null,
          currency: data.currency ?? null,
          currency_id: data.currency_id ?? null,
        });
      } catch (e) {
        setError('Failed to parse proforma data.');
      }
      setLoading(false);
    };
    if (id) fetchProforma();
  }, [id]);

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
        console.error('[ProformaViewPage] exchange rate:', err);
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

  // Format lead number using same logic as ClientHeader
  const formatLeadNumber = () => {
    if (!leadData) return proforma?.lead_number || '---';
    let displayNumber = leadData.lead_number || leadData.manual_id || '---';
    const displayStr = displayNumber.toString();
    const hasExistingSuffix = displayStr.includes('/');
    let baseNumber = hasExistingSuffix ? displayStr.split('/')[0] : displayStr;
    const existingSuffix = hasExistingSuffix ? displayStr.split('/').slice(1).join('/') : null;

    const isSuccessStage = leadData.stage === '100' || leadData.stage === 100;
    if (isSuccessStage && baseNumber && !baseNumber.toString().startsWith('C')) {
      baseNumber = baseNumber.toString().replace(/^L/, 'C');
    }

    // Add /1 suffix to master leads (frontend only)
    const hasNoMasterId = !leadData.master_id || String(leadData.master_id).trim() === '';
    const hasSubLeads = (subLeadsCount || 0) > 0;
    const isMasterWithSubLeads = hasNoMasterId && (isMasterLead || hasSubLeads);

    // Only add /1 to master leads that actually have subleads
    if (isMasterWithSubLeads && !hasExistingSuffix) {
      return `${baseNumber}/1`;
    } else if (hasExistingSuffix) {
      return `${baseNumber}/${existingSuffix}`;
    }
    return baseNumber;
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = () => {
    if (!invoiceRef.current) return;
    setPdfLoading(true);
    html2pdf(invoiceRef.current, {
      margin: 0,
      filename: `${proforma?.proformaName || 'proforma'}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: true },
      jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait' }
    }).then(() => setPdfLoading(false)).catch(() => setPdfLoading(false));
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this proforma?')) return;
    await supabase
      .from('payment_plans')
      .update({ proforma: null })
      .eq('id', id);
    navigate(-1);
  };

  const handleShare = async () => {
    if (!id) return;
    setSharing(true);
    try {
      await shareProformaPublicLink('new', id, { clientName: proforma?.client });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to share link.');
    } finally {
      setSharing(false);
    }
  };

  if (loading) return <div className="p-8 text-center">Loading...</div>;
  if (error) return <div className="p-8 text-center text-red-600">{error}</div>;
  if (!proforma) return null;

  const displayNotes = (proforma.notes as string | undefined)?.trim() ?? '';

  return (
    <div className="w-full min-h-0">
      <ProformaViewSideNotes notes={displayNotes || null} />
      {/* Fixed action bar — screen only, under header, clear of sidebar on md+ */}
      <div className="print-hide fixed top-[calc(env(safe-area-inset-top,0px)+2.75rem+0.5rem+0.75rem)] md:top-[calc(3rem+0.75rem)] left-0 md:left-24 right-0 z-30 flex items-center justify-between gap-4 border-b border-gray-200 bg-base-100 px-6 py-3 shadow-sm">
        <h1 className="text-lg font-bold text-gray-900 truncate min-w-0">
          Invoice - {formatLeadNumber()}
          {proforma.client ? ` - ${proforma.client}` : ''}
        </h1>
        <div className="flex shrink-0 gap-2">
          <button
            className="btn btn-primary btn-sm gap-2"
            onClick={() => navigate(`/proforma/create/${id}`)}
            title="Edit proforma"
          >
            <PencilSquareIcon className="w-5 h-5" /> Edit
          </button>
          <button className="btn btn-outline btn-sm gap-2" onClick={handlePrint} title="Print"><PrinterIcon className="w-5 h-5" /> Print</button>
          <button className="btn btn-outline btn-sm gap-2" onClick={handleShare} disabled={sharing} title="Share link with client">
            {sharing ? <span className="loading loading-spinner loading-xs" /> : <ShareIcon className="w-5 h-5" />} Share
          </button>
          <button className="btn btn-error btn-sm gap-2" onClick={handleDelete} title="Delete"><TrashIcon className="w-5 h-5" /> Delete</button>
        </div>
      </div>
      <div className="max-w-3xl mx-auto bg-white p-8 pt-16 print:bg-white print:pt-8 print:p-2">
      {/* Inline style override for html2pdf/html2canvas color compatibility */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #invoice-print-area, #invoice-print-area * {
            visibility: visible !important;
            color: #222 !important;
            background: transparent !important;
            background-color: transparent !important;
            box-shadow: none !important;
          }
          #invoice-print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100vw !important;
            min-height: 100vh !important;
            background: white !important;
            padding: 20px !important;
            margin: 0 !important;
          }
          #invoice-print-area .text-primary, #invoice-print-area .text-purple-700, #invoice-print-area .text-primary-content {
            color: #006BB1 !important;
          }
          #invoice-print-area .bg-primary, #invoice-print-area .bg-purple-700, #invoice-print-area .bg-primary-content {
            background: #006BB1 !important;
            background-color: #006BB1 !important;
          }
          #invoice-print-area .bg-gray-50 {
            background: #f9fafb !important;
            background-color: #f9fafb !important;
          }
          #invoice-print-area .border {
            border: 1px solid #e5e7eb !important;
          }
          #invoice-print-area .proforma-from-bill-grid {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            gap: 2rem !important;
          }
          .print-hide {
            display: none !important;
          }
        }
        @media screen {
          #invoice-print-area .text-primary, #invoice-print-area .text-purple-700, #invoice-print-area .text-primary-content {
            color: #006BB1 !important;
          }
          #invoice-print-area .bg-primary, #invoice-print-area .bg-purple-700, #invoice-print-area .bg-primary-content {
            background: #006BB1 !important;
            background-color: #006BB1 !important;
          }
        }
      `}</style>
      {/* Info section (PDF target) */}
      <div ref={invoiceRef} id="invoice-print-area" className="relative bg-white max-w-[1100px] w-full mx-auto p-8 overflow-hidden">
        {/* Logo and Title for print and PDF */}
        <div className="flex items-start justify-between gap-4 mb-14">
          <div>
            <div className="text-2xl font-extrabold tracking-tight leading-tight text-gray-900 md:text-3xl">Invoice</div>
            <div className="text-base text-gray-500 font-semibold mt-1">{proforma.proformaName}</div>
          </div>
          <div className="flex flex-shrink-0 items-center justify-center">
            <img
              src="/DPL-LOGO1.png"
              alt="DPL Logo"
              className="h-12 w-auto max-w-[7rem] object-contain md:h-16 md:max-w-[9rem]"
            />
          </div>
        </div>
        {/* End Logo and Title */}
        <div className="proforma-from-bill-grid grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-8 mb-8">
          {/* Company Info and Proforma Number/Date Row */}
          <div className="mb-4">
            <ProformaFromCompanyInfo />
            <div className="mb-12"></div>
          </div>
          <div>
            <div className="font-semibold text-gray-700 mb-1">Bill To:</div>
            <div className="text-lg font-bold text-gray-900">{proforma.client}</div>
            {proforma.lead_number && (
              <div className="text-sm text-gray-600 font-semibold">Lead #: {formatLeadNumber()}</div>
            )}
            {proforma.phone && (
              <div className="text-sm text-gray-500">{proforma.phone}</div>
            )}
            {proforma.email && (
              <div className="text-sm text-gray-500">{proforma.email}</div>
            )}
            {!(proforma.phone || proforma.email) && (
              <div className="text-xs text-red-400">No client phone/email saved in proforma.</div>
            )}
          </div>
        </div>
        {/* Table */}
        <div className="mb-8">
          <table className="min-w-full border rounded-xl overflow-hidden">
            <thead className="bg-white border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Description</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">Qty</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">Rate</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">Total</th>
              </tr>
            </thead>
            <tbody>
              {proforma.rows.map((row: any, idx: number) => (
                <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-2 text-gray-900 font-medium">{row.description}</td>
                  <td className="px-4 py-2 text-right">{row.qty}</td>
                  <td className="px-4 py-2 text-right">{proforma.currency} {row.rate}</td>
                  <td className="px-4 py-2 text-right font-bold">{proforma.currency} {row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Totals summary */}
        <div className="flex flex-col md:flex-row md:justify-end gap-4 mb-6">
          <div className="w-full md:w-1/2 bg-white rounded-xl p-6 border border-gray-200">
            <div className="flex justify-between text-lg mb-2">
              <span className="font-semibold text-gray-700">Subtotal</span>
              <span className="font-bold text-gray-900">{proforma.currency} {proforma.total}</span>
            </div>
            {proforma.addVat && (
              <div className="flex justify-between text-lg mb-2">
                <span className="font-semibold text-gray-700">VAT (18%)</span>
                <span className="font-bold text-gray-900">{proforma.currency} {(proforma.totalWithVat - proforma.total).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-xl mt-4 border-t pt-4 font-extrabold">
              <span>Total</span>
              <span className="text-primary">{proforma.currency} {proforma.totalWithVat}</span>
            </div>
            <ProformaTotalInNis info={exchangeInfo} loading={exchangeLoading} variant="card" />
          </div>
        </div>
        <ProformaBankDetails details={resolveBankAccountFromProforma(proforma)} variant="card" />
        <ProformaExchangeRateFooter info={exchangeInfo} loading={exchangeLoading} variant="card" />
        {/* Issued by and timestamp at bottom */}
        {proforma.createdBy && (
          <div className="mt-8 text-xs text-gray-500">
            <span className="font-semibold">Issued by:</span> <span>{proforma.createdBy}</span>
          </div>
        )}
        <ProformaDocumentStamp variant="card" />
      </div>
      {/* Created by, visible on screen only, hidden in print */}
      {proforma.createdBy && (
        <div className="mt-4 text-xs text-gray-400 text-left print-hide">
          Created by: {proforma.createdBy}
          {proforma.createdAt && (
            <> on {new Date(proforma.createdAt).toLocaleDateString()}, {new Date(proforma.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>
          )}
        </div>
      )}
      {pdfLoading && (
        <div className="fixed inset-0 bg-black bg-opacity-20 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-8 shadow-lg flex flex-col items-center">
            <span className="loading loading-spinner loading-lg text-primary mb-4"></span>
            <span className="text-lg font-medium text-gray-700">Generating PDF...</span>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default ProformaViewPage; 