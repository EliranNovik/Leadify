import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import html2pdf from 'html2pdf.js';
import toast from 'react-hot-toast';
import { shareProformaPublicLink } from '../lib/proformaPublicLink';
import { sendProformaInvoiceBundle, buildProformaSendSuccessMessage, collectProformaSendPartialErrors } from '../lib/proformaSendInvoice';
import type { ProformaSendLanguage } from '../lib/proformaSendLanguage';
import { useMailboxReconnect } from '../contexts/MailboxReconnectContext';
import ProformaSendLanguageModal from '../components/proforma/ProformaSendLanguageModal';
import ProformaViewActionButtons from '../components/proforma/ProformaViewActionButtons';
import ProformaExchangeRateFooter from '../components/proforma/ProformaExchangeRateFooter';
import ProformaTotalInNis from '../components/proforma/ProformaTotalInNis';
import ProformaDocumentStamp from '../components/proforma/ProformaDocumentStamp';
import ProformaIssuedByFooter from '../components/proforma/ProformaIssuedByFooter';
import ProformaBankDetails from '../components/proforma/ProformaBankDetails';
import ProformaFromCompanyInfo from '../components/proforma/ProformaFromCompanyInfo';
import {
  fetchBankAccountById,
  parseLegacyBankFromNotes,
  resolveBankAccountFromProforma,
} from '../lib/bankAccounts';
import {
  currencyInputFromLegacyProforma,
  fetchProformaExchangeRateInfo,
  type ProformaExchangeRateInfo,
} from '../lib/proformaExchangeRate';

import ProformaVatTotalsBlock from '../components/proforma/ProformaVatTotalsBlock';
import { applyLegacyPaymentPlanAmountsToProforma } from '../lib/proformaPaymentPlanAmounts';
import type { ResolvedProformaVat } from '../lib/proformaVat';
import { proformaDisplayCurrency, resolveProformaCurrency } from '../lib/paymentPlanCurrency';
import { getPublicProformaDisplayNotes } from '../lib/proformaNotes';
import ProformaViewSideNotes from '../components/proforma/ProformaViewSideNotes';
import ProformaBackToLeadButton from '../components/proforma/ProformaBackToLeadButton';
import ProformaPaidBadge from '../components/proforma/ProformaPaidBadge';
import { buildClientFinancesTabPath } from '../lib/proformaClientNavigation';
import { fetchLeadContacts } from '../lib/contactHelpers';
import { pickWhatsAppPhoneFromContactFields } from '../lib/whatsappPhone';
import { resolvePaymentPlanContact } from '../lib/resolvePaymentPlanContact';

const ProformaLegacyViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [proforma, setProforma] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const invoiceRef = useRef<HTMLDivElement>(null);
  const legacyPprChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendLanguageModalOpen, setSendLanguageModalOpen] = useState(false);
  const [contactIdForEmail, setContactIdForEmail] = useState<number | null>(null);
  const { showReconnectModal } = useMailboxReconnect();
  const [leadData, setLeadData] = useState<any>(null);
  const [subLeadsCount, setSubLeadsCount] = useState<number>(0);
  const [isMasterLead, setIsMasterLead] = useState<boolean>(false);
  const [exchangeInfo, setExchangeInfo] = useState<ProformaExchangeRateInfo | null>(null);
  const [exchangeLoading, setExchangeLoading] = useState(false);
  const [vatTotals, setVatTotals] = useState<ResolvedProformaVat | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchProforma = async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setLoading(true);
        setError(null);
      }

      // Guard: some entry points may accidentally pass a legacy payment-plan-row id (ppr_id)
      // instead of the proformainvoice.id.
      //
      // IMPORTANT: If the invoice id exists, we must NOT redirect — invoice ids and ppr_ids can
      // collide numerically, and redirecting would open the wrong invoice (wrong lead/contact).
      if (id) {
        const { data: byInvoiceId, error: byInvoiceIdErr } = await supabase
          .from('proformainvoice')
          .select('id')
          .eq('id', id)
          .maybeSingle();

        // Only if invoice id does not exist, try resolving by ppr_id.
        if (!cancelled && !byInvoiceIdErr && !byInvoiceId) {
          const { data: byPprId, error: byPprErr } = await supabase
            .from('proformainvoice')
            .select('id')
            .eq('ppr_id', id)
            .order('cdate', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!byPprErr && byPprId?.id != null) {
            navigate(`/proforma-legacy/${byPprId.id}`, { replace: true });
            return null;
          }
        }
      }

      // Variables to store issued by information
      let issuedBy: string | null = null;
      let issuedDate: string | null = null;

      // Try fetching from the view first
      let { data, error } = await supabase
        .from('proforma_with_rows')
        .select('*')
        .eq('id', id)
        .single();

      // Fetch invoice meta (including client_id + ppr_id) from proformainvoice table.
      const { data: proformaData, error: proformaError } = await supabase
        .from('proformainvoice')
        .select('cxd_by_id, creator_id, cxd_date, cdate, ppr_id, currency_id, client_id, lead_id')
        .eq('id', id)
        .single();

      // Fetch payment plan row date and client_id if ppr_id exists.
      let paymentPlanDate: string | null = null;
      // Prefer invoice.client_id (when present), otherwise use payment plan row client_id, otherwise main contact fallback.
      let paymentPlanClientId: number | null =
        proformaData?.client_id != null ? Number(proformaData.client_id) : null;
      let paymentPlanOrder: string | number | null = null;
      let paymentPlanValue: number | string | null = null;
      let paymentPlanVatValue: number | string | null = null;
      let paymentPaid = false;
      let paymentPaidAt: string | null = null;
      let paymentCurrencyId: number | string | null = proformaData?.currency_id ?? null;
      if (!proformaError && proformaData?.ppr_id) {
        const { data: pprData } = await supabase
          .from('finances_paymentplanrow')
          .select('date, due_date, client_id, actual_date, currency_id, order, value, vat_value')
          .eq('id', proformaData.ppr_id)
          .single();

        if (pprData) {
          paymentPlanDate = pprData.date || pprData.due_date || null;
          if (paymentPlanClientId == null && pprData.client_id != null) {
            paymentPlanClientId = Number(pprData.client_id);
          }
          paymentPlanOrder = pprData.order ?? null;
          paymentPlanValue = pprData.value ?? null;
          paymentPlanVatValue = pprData.vat_value ?? null;
          paymentPaid = Boolean(pprData.actual_date);
          paymentPaidAt = pprData.actual_date || null;
          if (pprData.currency_id != null) paymentCurrencyId = pprData.currency_id;
        }
      }

      if (!proformaError && proformaData) {
        // Use cdate (creation date) as issued date (cxd_date is cancellation date, which is NULL for active proformas)
        issuedDate = proformaData.cdate || null;

        // Try cxd_by_id first (cancelled by), then creator_id (created by) to get employee display_name
        const employeeId = proformaData.cxd_by_id || proformaData.creator_id;
        if (employeeId) {
          const { data: employeeData, error: employeeError } = await supabase
            .from('tenants_employee')
            .select('display_name')
            .eq('id', employeeId)
            .single();

          if (!employeeError && employeeData?.display_name) {
            issuedBy = employeeData.display_name;
          }
        }
      }

      // Resolve the billing contact the SAME way the create page does (resolvePaymentPlanContact).
      // The raw client_id may be a real leads_contact id, the numeric lead id (legacy / sub-lead
      // main-client rows), or missing. A naive `leads_contact.eq('id', client_id)` lookup would
      // otherwise return an unrelated contact that happens to share that id (the "random contact" bug).
      if (!error && data && data.lead_id) {
        try {
          const resolvedContact = await resolvePaymentPlanContact({
            leadId: data.lead_id,
            clientId: paymentPlanClientId,
            clientNameFallback: data.client_name,
          });

          data.client_name = resolvedContact.name || data.client_name || 'Client';
          data.client_email = resolvedContact.email || data.client_email || '';
          data.client_phone =
            pickWhatsAppPhoneFromContactFields(resolvedContact.phone, '') ||
            data.client_phone ||
            '';
        } catch (contactError) {
          console.error('Error fetching contact data:', contactError);
          // Error handling - contact data will remain null
        }
      }

      // If view fails, try direct table fetch
      if (error || !data) {
        const { data: directData, error: directError } = await supabase
          .from('proformainvoice')
          .select(`
            *,
            proformainvoicerow(*)
          `)
          .eq('id', id)
          .single();

        if (directError) {
          setError(`Error fetching proforma: ${directError.message}`);
          if (!options?.silent) setLoading(false);
          return null;
        }

        if (!directData) {
          setError('Proforma not found.');
          if (!options?.silent) setLoading(false);
          return null;
        }

        // Fetch client information from contact (not lead)
        let clientName = 'Client';
        let clientEmail = '';
        let clientPhone = '';

        if (directData.lead_id) {
          // Resolve the billing contact via the shared helper so this fallback path matches both
          // the create page and the primary path above (avoids the "random contact" id collision).
          try {
            const resolvedContact = await resolvePaymentPlanContact({
              leadId: directData.lead_id,
              clientId: paymentPlanClientId,
            });

            clientName = resolvedContact.name || 'Client';
            clientEmail = resolvedContact.email || '';
            clientPhone =
              pickWhatsAppPhoneFromContactFields(resolvedContact.phone, '') || '';
          } catch (contactError) {
            // Error handling - contact data will remain null
          }
        }

        // Transform direct table data to match view format
        data = {
          ...directData,
          rows: directData.proformainvoicerow || [],
          client_name: clientName,
          client_email: clientEmail,
          client_phone: clientPhone,
          currency_name: 'Israeli Shekel',
          currency_code: proformaDisplayCurrency({ currency_id: directData.currency_id }),
          lead_number: directData.lead_id?.toString() || '',
          issuedBy: issuedBy,
          issuedDate: issuedDate
        };

        // Fetch lead data for lead number formatting (for legacy leads)
        if (directData.lead_id) {
          try {
            const { data: leadInfo } = await supabase
              .from('leads_lead')
              .select('id, master_id, stage')
              .eq('id', directData.lead_id)
              .single();

            if (leadInfo) {
              setLeadData(leadInfo);

              const masterId = leadInfo.master_id;
              const leadId = String(leadInfo.id);

              // If master_id exists, it's a sub-lead - calculate suffix based on existing sub-leads with same master_id
              if (masterId && String(masterId).trim() !== '') {
                // Fetch all subleads with the same master_id, sorted by ID
                const { data: allSubLeads } = await supabase
                  .from('leads_lead')
                  .select('id')
                  .eq('master_id', masterId)
                  .order('id', { ascending: true });

                if (allSubLeads && allSubLeads.length > 0) {
                  // Find the index of current lead in the sorted list
                  const currentIndex = allSubLeads.findIndex((sub: any) => String(sub.id) === leadId);
                  // Suffix starts from 2 (master is /1, first sublead is /2, etc.)
                  const suffix = currentIndex >= 0 ? currentIndex + 2 : allSubLeads.length + 2;
                  // Store the suffix for formatting
                  setSubLeadsCount(suffix);
                } else {
                  setSubLeadsCount(2); // Default to /2 if no other subleads found
                }
              } else {
                // It's a master lead - count subleads to determine if it has subleads
                const { data: subLeads } = await supabase
                  .from('leads_lead')
                  .select('id', { count: 'exact', head: false })
                  .eq('master_id', leadInfo.id);

                const subLeadsCountValue = subLeads?.length || 0;
                setSubLeadsCount(subLeadsCountValue);
                setIsMasterLead(subLeadsCountValue > 0);
              }
            }
          } catch (error) {
            console.error('Error fetching lead data:', error);
          }
        }
      } else {
        // Add issued by information and payment plan date to view data
        if (data) {
          data.issuedBy = issuedBy;
          data.issuedDate = issuedDate;
          data.paymentPlanDate = paymentPlanDate; // Store payment plan date for VAT rate display

          // Fetch lead data for lead number formatting (for legacy leads)
          if (data.lead_id) {
            try {
              const { data: leadInfo } = await supabase
                .from('leads_lead')
                .select('id, master_id, stage')
                .eq('id', data.lead_id)
                .single();

              if (leadInfo) {
                setLeadData(leadInfo);

                const masterId = leadInfo.master_id;
                const leadId = String(leadInfo.id);

                // If master_id exists, it's a sub-lead - calculate suffix based on existing sub-leads with same master_id
                if (masterId && String(masterId).trim() !== '') {
                  // Fetch all subleads with the same master_id, sorted by ID
                  const { data: allSubLeads } = await supabase
                    .from('leads_lead')
                    .select('id')
                    .eq('master_id', masterId)
                    .order('id', { ascending: true });

                  if (allSubLeads && allSubLeads.length > 0) {
                    // Find the index of current lead in the sorted list
                    const currentIndex = allSubLeads.findIndex((sub: any) => String(sub.id) === leadId);
                    // Suffix starts from 2 (master is /1, first sublead is /2, etc.)
                    const suffix = currentIndex >= 0 ? currentIndex + 2 : allSubLeads.length + 2;
                    // Store the suffix for formatting
                    setSubLeadsCount(suffix);
                  } else {
                    setSubLeadsCount(2); // Default to /2 if no other subleads found
                  }
                } else {
                  // It's a master lead - count subleads to determine if it has subleads
                  const { data: subLeads } = await supabase
                    .from('leads_lead')
                    .select('id', { count: 'exact', head: false })
                    .eq('master_id', leadInfo.id);

                  const subLeadsCountValue = subLeads?.length || 0;
                  setSubLeadsCount(subLeadsCountValue);
                  setIsMasterLead(subLeadsCountValue > 0);
                }
              }
            } catch (error) {
              console.error('Error fetching lead data:', error);
            }
          }
        }
      }

      if (error && !data) {
        setError(`Error fetching proforma: ${error.message}`);
        if (!options?.silent) setLoading(false);
        return null;
      }

      if (!data) {
        setError('Proforma not found.');
        if (!options?.silent) setLoading(false);
        return null;
      }

      let bankAccountDetails =
        parseLegacyBankFromNotes(data.notes) ?? null;
      if (!bankAccountDetails && data.bank_account_id) {
        const bankId = String(data.bank_account_id);
        if (/^[0-9a-f-]{36}$/i.test(bankId)) {
          bankAccountDetails = await fetchBankAccountById(bankId);
        }
      }

      const enriched = {
        ...data,
        currency_id: paymentCurrencyId ?? data.currency_id,
        paymentPaid,
        paid_at: paymentPaidAt,
        paymentPlanDate,
        paymentOrder: paymentPlanOrder,
        ppr_id: proformaData?.ppr_id ?? null,
        bankAccountDetails,
      };
      const { displaySymbol: resolvedCurrency, currencyId: resolvedCurrencyId } =
        await resolveProformaCurrency({
          currency_id: enriched.currency_id ?? paymentCurrencyId,
          currency: enriched.currency_code,
        });
      enriched.currency_code = resolvedCurrency;
      enriched.currency_id = resolvedCurrencyId;

      const { proforma: syncedProforma, vatTotals: resolvedVat } = applyLegacyPaymentPlanAmountsToProforma(enriched, {
        value: paymentPlanValue,
        vat_value: paymentPlanVatValue,
        order: paymentPlanOrder,
        currency_id: resolvedCurrencyId,
      });
      setVatTotals(resolvedVat);

      // Contact resolution: match FinancesTab behavior. If the payment plan row doesn't have a client_id,
      // use the lead's main contact (and always prefer a contact row over stale proforma fields).
      const resolvedBillingContact = await resolvePaymentPlanContact({
        leadId: data.lead_id,
        clientId: paymentPlanClientId ?? null,
        clientNameFallback: (data as any)?.client_name ?? null,
        leadNameFallback: (data as any)?.lead_name ?? (data as any)?.name ?? null,
      });

      (syncedProforma as any).client_name = resolvedBillingContact.name || (syncedProforma as any).client_name;
      (syncedProforma as any).client_email = resolvedBillingContact.email || (syncedProforma as any).client_email;
      (syncedProforma as any).client_phone = resolvedBillingContact.phone || (syncedProforma as any).client_phone;

      let contactIdForSend: number | null = paymentPlanClientId;
      if (!contactIdForSend && data?.lead_id) {
        const contacts = await fetchLeadContacts(data.lead_id, true);
        const main = contacts.find((c) => c.isMain) || contacts[0];
        if (main?.id) contactIdForSend = main.id;
      }
      setContactIdForEmail(contactIdForSend);
      if (!cancelled) setProforma(syncedProforma);
      if (!options?.silent) setLoading(false);
      return proformaData?.ppr_id ?? null;
    };

    const setup = async () => {
      const pprId = await fetchProforma();
      if (cancelled || !pprId) return;

      if (legacyPprChannelRef.current) {
        void supabase.removeChannel(legacyPprChannelRef.current);
      }

      legacyPprChannelRef.current = supabase
        .channel(`legacy-proforma-ppr-${pprId}`)
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
    };

    if (id) void setup();

    return () => {
      cancelled = true;
      if (legacyPprChannelRef.current) {
        void supabase.removeChannel(legacyPprChannelRef.current);
        legacyPprChannelRef.current = null;
      }
    };
  }, [id]);

  useEffect(() => {
    if (!proforma) {
      setExchangeInfo(null);
      return;
    }

    let cancelled = false;
    const loadExchange = async () => {
      setExchangeLoading(true);
      try {
        const subtotal = vatTotals?.subtotal ?? Number(proforma.sub_total || proforma.total_base || 0);
        const vat = vatTotals?.vat ?? 0;
        const total = vatTotals?.totalWithVat ?? Number(proforma.total || 0);
        const paymentPlanRowId = proforma.ppr_id ?? null;
        const info = await fetchProformaExchangeRateInfo({
          currency: currencyInputFromLegacyProforma(proforma),
          paid: Boolean(proforma.paymentPaid),
          paidAt: proforma.paid_at ?? null,
          subtotal,
          vat,
          total,
          paymentPlanId: paymentPlanRowId,
        });
        if (!cancelled) setExchangeInfo(info);
      } catch (err) {
        console.error('[ProformaLegacyViewPage] exchange rate:', err);
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

  // Format lead number using same logic as Clients.tsx formatLegacyLeadNumber (for legacy leads)
  const formatLeadNumber = () => {
    if (!leadData) return proforma?.lead_number || '---';

    const masterId = leadData.master_id;
    const leadId = String(leadData.id || proforma?.lead_number || '---');

    // If master_id is null/empty, it's a master lead - return just the ID (no /1 suffix for legacy leads)
    if (!masterId || String(masterId).trim() === '') {
      // For legacy leads, add "C" prefix for success stage (stage 100)
      const isSuccessStage = leadData.stage === 100 || leadData.stage === '100';
      if (isSuccessStage && leadId && !leadId.toString().startsWith('C')) {
        return `C${leadId}`;
      }
      return leadId;
    }

    // If master_id exists, it's a sub-lead - format as masterId/suffix
    // Use the calculated suffix from subLeadsCount (which stores the suffix, not count)
    const suffix = subLeadsCount > 0 ? subLeadsCount : 2; // Default to /2 if not calculated
    const formattedNumber = `${masterId}/${suffix}`;

    // For legacy leads, add "C" prefix for success stage (stage 100)
    const isSuccessStage = leadData.stage === 100 || leadData.stage === '100';
    if (isSuccessStage && !formattedNumber.startsWith('C')) {
      // Replace L prefix with C if success stage, or add C prefix to masterId
      return formattedNumber.replace(/^L/, 'C').replace(/^(\d+)/, 'C$1');
    }

    return formattedNumber;
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = () => {
    if (!invoiceRef.current) return;
    setPdfLoading(true);
    html2pdf(invoiceRef.current, {
      margin: 0,
      filename: `proforma-legacy-${proforma?.id || 'proforma'}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: true },
      jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait' }
    }).then(() => setPdfLoading(false)).catch(() => setPdfLoading(false));
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this proforma?')) return;
    try {
      // Delete rows first
      const { error: rowsError } = await supabase
        .from('proformainvoicerow')
        .delete()
        .eq('invoice_id', id);

      if (rowsError) throw rowsError;

      // Delete proforma
      const { error: proformaError } = await supabase
        .from('proformainvoice')
        .delete()
        .eq('id', id);

      if (proformaError) throw proformaError;

      toast.success('Proforma deleted successfully!');
      navigate(-1);
    } catch (error) {
      console.error('Error deleting proforma:', error);
      toast.error('Failed to delete proforma.');
    }
  };

  const handleShare = async () => {
    if (!id) return;
    setSharing(true);
    try {
      await shareProformaPublicLink('legacy', id, { clientName: proforma?.client_name });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to share link.');
    } finally {
      setSharing(false);
    }
  };

  const buildSendInput = (language: ProformaSendLanguage) => ({
    kind: 'legacy' as const,
    recordId: id!,
    paymentPlanId: proforma.ppr_id ?? null,
    contactId: contactIdForEmail,
    contactEmail: proforma.client_email,
    contactPhone: proforma.client_phone,
    clientName: proforma.client_name || 'Client',
    leadNumber: formatLeadNumber(),
    leadId: proforma.lead_id ?? proforma.client_id ?? null,
    isLegacyLead: true,
    language,
  });

  const handleSendConfirm = async (language: ProformaSendLanguage) => {
    if (!id || !proforma) return;
    setSending(true);
    try {
      const result = await sendProformaInvoiceBundle(buildSendInput(language));
      collectProformaSendPartialErrors(result).forEach((message) => toast.error(message));
      if (
        result.emailError?.message === 'MAILBOX_NOT_CONNECTED' ||
        (result.emailError as Error & { code?: string })?.code === 'MAILBOX_NOT_CONNECTED'
      ) {
        showReconnectModal('Connect Outlook to send invoices by email.');
      }
      toast.success(buildProformaSendSuccessMessage(result, language));
      setSendLanguageModalOpen(false);
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

  if (loading) return <div className="p-8 text-center">Loading proforma...</div>;
  if (error) return <div className="p-8 text-center text-red-600">Error: {error}</div>;
  if (!proforma) return <div className="p-8 text-center text-yellow-600">No proforma data found.</div>;

  const currencyLabel = proformaDisplayCurrency({
    currency_code: proforma.currency_code,
    currency_id: proforma.currency_id,
  });

  const displayNotes = getPublicProformaDisplayNotes(proforma.notes);
  const isLegacySubLead = Boolean(leadData?.master_id && String(leadData.master_id).trim() !== '');
  const financesTabPath = buildClientFinancesTabPath({
    isLegacy: true,
    leadId: proforma.lead_id,
    leadNumber: formatLeadNumber(),
    manualId: isLegacySubLead
      ? String(leadData.master_id)
      : String(leadData?.id ?? proforma.lead_id ?? ''),
  });

  return (
    <div className="w-full min-h-0">
      <ProformaSendLanguageModal
        open={sendLanguageModalOpen}
        onClose={() => !sending && setSendLanguageModalOpen(false)}
        onConfirm={handleSendConfirm}
        sending={sending}
        contactLabel={proforma.client_name || undefined}
      />
      <ProformaViewSideNotes notes={displayNotes || null} />
      {/* Fixed action bar — screen only, under header, clear of sidebar on md+ */}
      <div className="print-hide fixed top-[calc(env(safe-area-inset-top,0px)+2.75rem+0.5rem+0.75rem)] md:top-[calc(3rem+0.75rem)] left-0 md:left-24 right-0 z-30 flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-3 shadow-sm">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <ProformaBackToLeadButton href={financesTabPath} />
          <h1 className="min-w-0 truncate text-lg font-bold text-gray-900">
            Invoice - {formatLeadNumber()}
            {proforma.client_name ? ` - ${proforma.client_name}` : ''}
          </h1>
          <ProformaPaidBadge paid={proforma.paymentPaid} paidAt={proforma.paid_at} />
        </div>
        <ProformaViewActionButtons
          onEdit={() => navigate(`/proforma-legacy/edit/${id}`)}
          onPrint={handlePrint}
          onSend={() => setSendLanguageModalOpen(true)}
          onShare={handleShare}
          onDelete={handleDelete}
          sending={sending}
          sharing={sharing}
        />
      </div>
      <div className="min-h-[calc(100dvh-10rem)] bg-gray-100 px-4 pb-12 pt-20 md:px-8 print:bg-white print:p-0 print:min-h-0">
      {/* Inline style override for html2pdf/html2canvas color compatibility */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          main,
          main * {
            visibility: visible !important;
          }
          .print-hide {
            display: none !important;
          }
          body, html {
            margin: 0 !important;
            padding: 0 !important;
          }
          .app-main-scroll {
            padding: 0 !important;
            overflow: visible !important;
          }
          #invoice-print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            min-height: auto !important;
            margin: 0 !important;
            padding: 20px !important;
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            background: white !important;
            overflow: visible !important;
          }
          #invoice-print-area,
          #invoice-print-area * {
            color: #222 !important;
            box-shadow: none !important;
          }
          #invoice-print-area .text-primary {
            color: #006BB1 !important;
          }
          #invoice-print-area .bg-primary {
            background: #006BB1 !important;
            background-color: #006BB1 !important;
            color: white !important;
          }
          #invoice-print-area .bg-gray-50 {
            background: #f9fafb !important;
            background-color: #f9fafb !important;
          }
          #invoice-print-area .proforma-from-bill-grid {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            gap: 2rem !important;
          }
        }
      `}</style>
      {/* Info section (PDF target) */}
      <div
        ref={invoiceRef}
        id="invoice-print-area"
        className="relative mx-auto w-full max-w-[1100px] overflow-hidden rounded-lg border border-gray-200/90 bg-white p-8 shadow-[0_4px_24px_rgba(0,0,0,0.08)] md:p-10 print:rounded-none print:border-0 print:shadow-none"
      >
        {/* Logo and Title for print and PDF */}
        <div className="flex items-start justify-between gap-4 mb-14">
          <div>
            <div className="text-2xl font-extrabold tracking-tight leading-tight text-gray-900 md:text-3xl">Invoice</div>
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
        <div className="proforma-from-bill-grid grid grid-cols-1 lg:grid-cols-2 print:grid-cols-2 gap-8 mb-8">
          {/* Company Info */}
          <div className="mb-4">
            <ProformaFromCompanyInfo showFromLabel showPhoneLabel />
            <div className="mb-12"></div>
          </div>
          <div>
            <div className="font-semibold text-gray-700 mb-1">Bill To:</div>
            <div className="text-lg font-bold text-gray-900">{proforma.client_name}</div>
            {proforma.client_phone && (
              <div className="text-sm text-gray-500">{proforma.client_phone}</div>
            )}
            {proforma.client_email && (
              <div className="text-sm text-gray-500">{proforma.client_email}</div>
            )}
            {proforma.lead_number && (
              <div className="text-sm text-gray-500 font-semibold">Case #: {formatLeadNumber()}</div>
            )}
            {!(proforma.client_phone || proforma.client_email) && (
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
              {(proforma.rows || []).map((row: any, idx: number) => (
                <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-2 text-gray-900 font-medium">{row.description}</td>
                  <td className="px-4 py-2 text-right">{row.qty}</td>
                  <td className="px-4 py-2 text-right">{currencyLabel} {row.rate}</td>
                  <td className="px-4 py-2 text-right font-bold">{currencyLabel} {row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Totals summary */}
        <div className="flex flex-col md:flex-row md:justify-end gap-4 mb-6">
          <div className="w-full md:w-1/2 bg-white rounded-xl p-6 border border-gray-200">
            {vatTotals && (
              <ProformaVatTotalsBlock currencyLabel={currencyLabel} resolved={vatTotals} />
            )}
            <ProformaTotalInNis info={exchangeInfo} loading={exchangeLoading} variant="card" />
          </div>
        </div>
        <ProformaBankDetails details={resolveBankAccountFromProforma(proforma)} variant="card" />
        <ProformaExchangeRateFooter info={exchangeInfo} loading={exchangeLoading} variant="card" />
        <ProformaIssuedByFooter name={proforma.issuedBy} date={proforma.issuedDate} />
        <ProformaDocumentStamp variant="card" />
      </div>
      {pdfLoading && (
        <div className="print-hide fixed inset-0 bg-black bg-opacity-20 flex items-center justify-center z-50">
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

export default ProformaLegacyViewPage;
