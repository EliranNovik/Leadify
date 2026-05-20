import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import html2pdf from 'html2pdf.js';
import { PaperAirplaneIcon, PencilSquareIcon, PrinterIcon, ShareIcon, TrashIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { shareProformaPublicLink } from '../lib/proformaPublicLink';
import { sendProformaInvoiceEmail } from '../lib/proformaSendEmail';
import { sendProformaInvoiceWhatsApp } from '../lib/proformaSendWhatsApp';
import { useMailboxReconnect } from '../contexts/MailboxReconnectContext';
import ProformaExchangeRateFooter from '../components/proforma/ProformaExchangeRateFooter';
import ProformaTotalInNis from '../components/proforma/ProformaTotalInNis';
import ProformaDocumentStamp from '../components/proforma/ProformaDocumentStamp';
import ProformaIssuedByFooter from '../components/proforma/ProformaIssuedByFooter';
import ProformaBankDetails from '../components/proforma/ProformaBankDetails';
import ProformaFromCompanyInfo from '../components/proforma/ProformaFromCompanyInfo';
import ProformaViewSideNotes from '../components/proforma/ProformaViewSideNotes';
import ProformaBackToLeadButton from '../components/proforma/ProformaBackToLeadButton';
import { buildClientFinancesTabPath } from '../lib/proformaClientNavigation';
import ProformaVatTotalsBlock from '../components/proforma/ProformaVatTotalsBlock';
import {
  applyResolvedVatToNewProforma,
  resolveNewProformaVat,
  type ResolvedProformaVat,
} from '../lib/proformaVat';
import { resolvePaymentPlanCurrency } from '../lib/paymentPlanCurrency';
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
  const [sending, setSending] = useState(false);
  const [contactIdForEmail, setContactIdForEmail] = useState<string | number | null>(null);
  const { showReconnectModal } = useMailboxReconnect();
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
  const [vatTotals, setVatTotals] = useState<ResolvedProformaVat | null>(null);

  useEffect(() => {
    const fetchProforma = async () => {
      setLoading(true);
      setError(null);
      // Fetch both proforma and client_id from payment plan
      const { data, error } = await supabase
        .from('payment_plans')
        .select('proforma, client_id, lead_id, paid, paid_at, currency, currency_id, value_vat, payment_order, due_date')
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
        let leadCurrencyId: number | string | null = null;
        let proposalCurrency: string | null = null;
        let balanceCurrency: string | null = null;
        if (data.lead_id) {
          const { data: leadRow } = await supabase
            .from('leads')
            .select('currency_id, proposal_currency, balance_currency')
            .eq('id', data.lead_id)
            .maybeSingle();
          if (leadRow) {
            leadCurrencyId = leadRow.currency_id ?? null;
            proposalCurrency = leadRow.proposal_currency ?? null;
            balanceCurrency = leadRow.balance_currency ?? null;
          }
        }

        const { displaySymbol: resolvedCurrency, currencyId: resolvedCurrencyId } =
          await resolvePaymentPlanCurrency({
            currency: data.currency,
            currency_id: data.currency_id,
            lead_currency_id: leadCurrencyId,
            proposal_currency: proposalCurrency,
            balance_currency: balanceCurrency,
          });

        parsed.currency = resolvedCurrency;
        parsed.paymentOrder = parsed.paymentOrder ?? data.payment_order;
        parsed.dueDate = parsed.dueDate ?? data.due_date;

        const resolvedVat = resolveNewProformaVat(parsed, {
          currency: resolvedCurrency,
          currency_id: data.currency_id ?? resolvedCurrencyId,
          value_vat: data.value_vat,
          payment_order: data.payment_order,
          due_date: data.due_date,
        });
        setVatTotals(resolvedVat);
        parsed = applyResolvedVatToNewProforma(parsed, resolvedVat);
        if (!parsed.bankAccountDetails && parsed.bankAccountId) {
          parsed.bankAccountDetails = await fetchBankAccountById(String(parsed.bankAccountId));
        }
        setContactIdForEmail(contactIdToUse ?? null);
        setProforma(parsed);
        setPaymentPlanMeta({
          paid: Boolean(data.paid),
          paid_at: data.paid_at ?? null,
          currency: resolvedCurrency,
          currency_id: data.currency_id ?? resolvedCurrencyId ?? null,
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
  }, [proforma, paymentPlanMeta, vatTotals]);

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

  const handleSend = async () => {
    if (!id || !proforma) return;
    setSending(true);
    try {
      const sendInput = {
        kind: 'new' as const,
        recordId: id,
        contactId: contactIdForEmail ?? proforma.contactId,
        contactEmail: proforma.email,
        contactPhone: proforma.phone,
        clientName: proforma.client || 'Client',
        leadNumber: formatLeadNumber(),
        leadId: proforma.clientId,
        isLegacyLead: false,
      };
      await sendProformaInvoiceEmail(sendInput);
      let whatsAppSent = false;
      let whatsAppPhone = '';
      try {
        const wa = await sendProformaInvoiceWhatsApp(sendInput);
        whatsAppSent = true;
        whatsAppPhone = wa.phoneNumber;
      } catch (whatsAppErr) {
        console.warn('[ProformaViewPage] WhatsApp send:', whatsAppErr);
        toast.error(
          whatsAppErr instanceof Error ? whatsAppErr.message : 'WhatsApp invoice was not sent.',
        );
      }
      toast.success(
        whatsAppSent
          ? `Invoice sent by email and WhatsApp (${whatsAppPhone}).`
          : 'Invoice sent by email.',
      );
    } catch (e: unknown) {
      const err = e as Error & { code?: string };
      if (err.code === 'MAILBOX_NOT_CONNECTED') {
        showReconnectModal('Connect Outlook to send invoices by email.');
        return;
      }
      toast.error(err.message || 'Failed to send invoice.');
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div className="p-8 text-center">Loading...</div>;
  if (error) return <div className="p-8 text-center text-red-600">{error}</div>;
  if (!proforma) return null;

  const displayNotes = (proforma.notes as string | undefined)?.trim() ?? '';
  const financesTabPath = buildClientFinancesTabPath({
    isLegacy: false,
    leadNumber: formatLeadNumber(),
    manualId: leadData?.manual_id,
    leadId: proforma.clientId ?? leadData?.id,
  });

  return (
    <div className="w-full min-h-0">
      <ProformaViewSideNotes notes={displayNotes || null} />
      {/* Fixed action bar — screen only, under header, clear of sidebar on md+ */}
      <div className="print-hide fixed top-[calc(env(safe-area-inset-top,0px)+2.75rem+0.5rem+0.75rem)] md:top-[calc(3rem+0.75rem)] left-0 md:left-24 right-0 z-30 flex items-center justify-between gap-4 border-b border-gray-200 bg-base-100 px-6 py-3 shadow-sm">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <ProformaBackToLeadButton href={financesTabPath} />
          <h1 className="min-w-0 truncate text-lg font-bold text-gray-900">
            Invoice - {formatLeadNumber()}
            {proforma.client ? ` - ${proforma.client}` : ''}
          </h1>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            className="btn btn-primary btn-sm gap-2"
            onClick={() => navigate(`/proforma/create/${id}`)}
            title="Edit proforma"
          >
            <PencilSquareIcon className="w-5 h-5" /> Edit
          </button>
          <button className="btn btn-outline btn-sm gap-2" onClick={handlePrint} title="Print"><PrinterIcon className="w-5 h-5" /> Print</button>
          <button
            className="btn btn-outline btn-sm gap-2"
            onClick={handleSend}
            disabled={sending}
            title="Send invoice to the linked contact by email (Outlook) and WhatsApp"
          >
            {sending ? <span className="loading loading-spinner loading-xs" /> : <PaperAirplaneIcon className="w-5 h-5" />} Send
          </button>
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
              <div className="text-sm text-gray-600 font-semibold">Case #: {formatLeadNumber()}</div>
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
            {vatTotals && (
              <ProformaVatTotalsBlock currencyLabel={proforma.currency || '₪'} resolved={vatTotals} />
            )}
            <ProformaTotalInNis info={exchangeInfo} loading={exchangeLoading} variant="card" />
          </div>
        </div>
        <ProformaBankDetails details={resolveBankAccountFromProforma(proforma)} variant="card" />
        <ProformaExchangeRateFooter info={exchangeInfo} loading={exchangeLoading} variant="card" />
        <ProformaIssuedByFooter name={proforma.createdBy} date={proforma.createdAt} />
        <ProformaDocumentStamp variant="card" />
      </div>
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