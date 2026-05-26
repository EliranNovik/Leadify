import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { DocumentTextIcon, Cog6ToothIcon, ChartPieIcon, ChatBubbleLeftRightIcon, XMarkIcon, CheckIcon, PrinterIcon, EnvelopeIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { generateProformaName } from '../lib/proforma';
import { formatNewLeadDisplayNumber } from '../lib/proformaLeadNumber';
import { computeProformaVatFromPayment } from '../lib/proformaVat';
import ProformaExchangeRateFooter from '../components/proforma/ProformaExchangeRateFooter';
import ProformaTotalInNis from '../components/proforma/ProformaTotalInNis';
import ProformaDocumentStamp from '../components/proforma/ProformaDocumentStamp';
import ProformaIssuedByFooter from '../components/proforma/ProformaIssuedByFooter';
import ProformaBankAccountSelect from '../components/proforma/ProformaBankAccountSelect';
import ProformaBankDetails from '../components/proforma/ProformaBankDetails';
import ProformaFromCompanyInfo from '../components/proforma/ProformaFromCompanyInfo';
import ProformaBackToLeadButton from '../components/proforma/ProformaBackToLeadButton';
import { buildClientFinancesTabPath } from '../lib/proformaClientNavigation';
import {
  fetchActiveBankAccounts,
  resolveBankAccountFromProforma,
  type BankAccountRecord,
  type BankAccountSnapshot,
} from '../lib/bankAccounts';
import {
  currencyInputFromNewPayment,
  fetchProformaExchangeRateInfo,
  type ProformaExchangeRateInfo,
} from '../lib/proformaExchangeRate';
import {
  displaySymbolForPaymentSave,
  mapLeadCurrencyToSymbol,
  resolveCurrencyIdForSave,
  resolveProformaCurrency,
} from '../lib/paymentPlanCurrency';
import { resolvePaymentPlanContact } from '../lib/resolvePaymentPlanContact';
import { ensureProformaPaymentLink } from '../lib/proformaPaymentLink';

/** Matches invoice sheet on ProformaViewPage */
const PROFORMA_INVOICE_SHEET_CLASS =
  'relative mx-auto w-full max-w-[1100px] overflow-hidden rounded-lg border border-gray-200/90 bg-white p-8 shadow-[0_4px_24px_rgba(0,0,0,0.08)] md:p-10';

const ProformaCreatePage: React.FC = () => {
  const { paymentId } = useParams<{ paymentId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [payment, setPayment] = useState<any>(null);
  const [proformaData, setProformaData] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [userFullName, setUserFullName] = useState<string | null>(null);
  const [leadData, setLeadData] = useState<any>(null);
  const [subLeadsCount, setSubLeadsCount] = useState<number>(0);
  const [isMasterLead, setIsMasterLead] = useState<boolean>(false);
  const [exchangeInfo, setExchangeInfo] = useState<ProformaExchangeRateInfo | null>(null);
  const [exchangeLoading, setExchangeLoading] = useState(false);
  const [bankAccounts, setBankAccounts] = useState<BankAccountRecord[]>([]);
  const [bankAccountsLoading, setBankAccountsLoading] = useState(true);
  const [isEditMode, setIsEditMode] = useState(false);

  useEffect(() => {
    const fetchPayment = async () => {
      setLoading(true);
      setPayment(null);
      setProformaData(null);
      setIsEditMode(false);
      const { data, error } = await supabase
        .from('payment_plans')
        .select('*')
        .eq('id', paymentId)
        .single();
      if (error) {
        toast.error('Failed to load payment details');
        setLoading(false);
        return;
      }

      const resolvedContact = await resolvePaymentPlanContact({
        leadId: data.lead_id,
        clientId: data.client_id,
        clientNameFallback: data.client_name,
      });
      const clientName = resolvedContact.name;
      const clientEmail = resolvedContact.email;
      const clientPhone = resolvedContact.phone;

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
        await resolveProformaCurrency({
          currency: data.currency,
          currency_id: data.currency_id,
          lead_currency_id: leadCurrencyId,
          proposal_currency: proposalCurrency,
          balance_currency: balanceCurrency,
        });

      const paymentWithCurrency = {
        ...data,
        currency: resolvedCurrency,
        currency_id: resolvedCurrencyId,
      };
      setPayment(paymentWithCurrency);

      let existingProforma: Record<string, unknown> | null = null;
      if (data.proforma) {
        try {
          existingProforma =
            typeof data.proforma === 'string' ? JSON.parse(data.proforma) : data.proforma;
        } catch {
          existingProforma = null;
        }
      }

      const initialRows = [
        { description: data.payment_order, qty: 1, rate: data.value, total: data.value },
      ];
      const initialSubtotal = initialRows.reduce((sum: number, r: { total: number }) => sum + Number(r.total), 0);
      const vatState = computeProformaVatFromPayment({
        currency: resolvedCurrency,
        currency_id: paymentWithCurrency.currency_id,
        valueVat: data.value_vat,
        paymentOrder: data.payment_order,
        dueDate: data.due_date,
        subtotal: initialSubtotal,
      });

      if (existingProforma) {
        setIsEditMode(true);
        const rows = Array.isArray(existingProforma.rows) ? existingProforma.rows : initialRows;
        const subtotal = rows.reduce((sum: number, r: { total: number }) => sum + Number(r.total), 0);
        const refreshedVat = computeProformaVatFromPayment({
          currency: resolvedCurrency,
          currency_id: paymentWithCurrency.currency_id,
          valueVat: data.value_vat,
          paymentOrder: data.payment_order,
          dueDate: data.due_date,
          subtotal,
        });
        setProformaData({
          ...existingProforma,
          rows,
          client: existingProforma.client || clientName,
          clientId: existingProforma.clientId ?? data.lead_id,
          contactId: existingProforma.contactId ?? resolvedContact.contactId ?? data.client_id,
          paymentRowId: data.id,
          email: existingProforma.email || clientEmail,
          phone: existingProforma.phone || clientPhone,
          bankAccountId: existingProforma.bankAccountId ?? '',
          bankAccountDetails:
            existingProforma.bankAccountDetails ??
            resolveBankAccountFromProforma(existingProforma as { bankAccountDetails?: BankAccountSnapshot | null }),
          currency: resolvedCurrency,
          currency_id: paymentWithCurrency.currency_id,
          addVat: refreshedVat.addVat,
          vat: refreshedVat.vat,
          totalWithVat: refreshedVat.totalWithVat,
          dueDate: data.due_date,
          paymentOrder: data.payment_order,
        });
      } else {
        setIsEditMode(false);
        setProformaData({
          client: clientName,
          clientId: data.lead_id,
          contactId: resolvedContact.contactId ?? data.client_id ?? null,
          paymentRowId: data.id,
          payment: data.value + data.value_vat,
          base: data.value,
          vat: vatState.vat,
          language: 'EN',
          rows: initialRows,
          addVat: vatState.addVat,
          totalWithVat: vatState.totalWithVat,
          currency: resolvedCurrency,
          currency_id: paymentWithCurrency.currency_id,
          bankAccount: '',
          bankAccountId: '',
          bankAccountDetails: null as BankAccountSnapshot | null,
          notes: '',
          email: clientEmail,
          phone: clientPhone,
          dueDate: data.due_date,
          paymentOrder: data.payment_order,
        });
      }
      setLoading(false);
    };
    if (paymentId) fetchPayment();
  }, [paymentId]);

  useEffect(() => {
    if (!proformaData || !payment) {
      setExchangeInfo(null);
      return;
    }

    let cancelled = false;
    const loadExchange = async () => {
      setExchangeLoading(true);
      try {
        const subtotal = proformaData.rows.reduce((sum: number, r: { total: number }) => sum + Number(r.total), 0);
        const { vat, totalWithVat: total } = computeProformaVatFromPayment({
          currency: proformaData.currency,
          currency_id: proformaData.currency_id ?? payment?.currency_id,
          valueVat: payment.value_vat,
          paymentOrder: proformaData.paymentOrder ?? payment.payment_order,
          dueDate: proformaData.dueDate ?? payment.due_date,
          subtotal,
        });
        const info = await fetchProformaExchangeRateInfo({
          currency: currencyInputFromNewPayment(
            {
              currency_id: proformaData.currency_id ?? payment.currency_id,
              currency: proformaData.currency,
            },
            proformaData.currency,
          ),
          paid: Boolean(payment.paid),
          paidAt: payment.paid_at ?? null,
          subtotal,
          vat,
          total,
        });
        if (!cancelled) setExchangeInfo(info);
      } catch (err) {
        console.error('[ProformaCreatePage] exchange rate:', err);
        if (!cancelled) setExchangeInfo(null);
      } finally {
        if (!cancelled) setExchangeLoading(false);
      }
    };

    void loadExchange();
    return () => {
      cancelled = true;
    };
  }, [proformaData, payment]);

  useEffect(() => {
    const loadBankAccounts = async () => {
      setBankAccountsLoading(true);
      try {
        const accounts = await fetchActiveBankAccounts();
        setBankAccounts(accounts);
      } catch (err) {
        console.error('[ProformaCreatePage] bank accounts:', err);
        toast.error('Failed to load bank accounts');
      } finally {
        setBankAccountsLoading(false);
      }
    };
    void loadBankAccounts();
  }, []);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && user.email) {
        const { data: userData, error } = await supabase
          .from('users')
          .select('full_name')
          .eq('email', user.email)
          .single();
        if (!error && userData?.full_name) {
          setUserFullName(userData.full_name);
        }
      }
    };
    fetchUser();
  }, []);

  // Fetch lead data for lead number formatting
  useEffect(() => {
    const fetchLeadData = async () => {
      if (proformaData?.clientId) {
        try {
          const { data: leadInfo } = await supabase
            .from('leads')
            .select('lead_number, manual_id, master_id, stage')
            .eq('id', proformaData.clientId)
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
                .eq('master_id', proformaData.clientId);

              const subLeadsCountValue = subLeads?.length || 0;
              setSubLeadsCount(subLeadsCountValue);
              setIsMasterLead(subLeadsCountValue > 0);
            }
          }
        } catch (error) {
          console.error('Error fetching lead data:', error);
        }
      }
    };
    fetchLeadData();
  }, [proformaData?.clientId]);

  const handleProformaRowChange = (idx: number, field: string, value: any) => {
    if (field !== 'description') return;
    setProformaData((prev: any) => {
      const rows = prev.rows.map((row: any, i: number) =>
        i === idx ? { ...row, description: value } : row,
      );
      return { ...prev, rows };
    });
  };

  const handleBankAccountChange = (accountId: string, snapshot: BankAccountSnapshot | null) => {
    setProformaData((prev: any) => ({
      ...prev,
      bankAccountId: accountId,
      bankAccount: snapshot?.name ?? '',
      bankAccountDetails: snapshot,
    }));
  };

  const handleSaveProforma = async () => {
    setIsSaving(true);
    try {
      const proformaName = isEditMode && proformaData.proformaName
        ? proformaData.proformaName
        : await generateProformaName();
      // Calculate totals
      const total = proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0);
      const currencyId = resolveCurrencyIdForSave({
        currency: proformaData.currency,
        currency_id: proformaData.currency_id ?? payment?.currency_id,
      });
      const currency = displaySymbolForPaymentSave({
        currency: proformaData.currency,
        currency_id: currencyId,
      });
      const { addVat, vat, totalWithVat } = computeProformaVatFromPayment({
        currency,
        currency_id: currencyId,
        valueVat: payment?.value_vat,
        paymentOrder: proformaData.paymentOrder ?? payment?.payment_order,
        dueDate: proformaData.dueDate ?? payment?.due_date,
        subtotal: total,
      });
      // Ensure email/phone are present
      const email = proformaData.email || '';
      const phone = proformaData.phone || '';
      const leadNumber = formatNewLeadDisplayNumber(leadData, {
        subLeadsCount,
        isMasterLead,
      });
      const proformaContent = JSON.stringify({
        ...proformaData,
        lead_number: leadNumber || proformaData.lead_number || '',
        proformaName,
        total,
        vat,
        totalWithVat,
        createdAt: isEditMode && proformaData.createdAt
          ? proformaData.createdAt
          : new Date().toISOString(),
        createdBy: isEditMode && proformaData.createdBy
          ? proformaData.createdBy
          : userFullName || '',
        email,
        phone,
        addVat,
        currency,
        currency_id: currencyId,
      });
      const { error } = await supabase
        .from('payment_plans')
        .update({ proforma: proformaContent })
        .eq('id', paymentId);
      if (error) throw error;

      if (!isEditMode) {
        await ensureProformaPaymentLink({
          paymentPlanId: paymentId!,
          leadClientId: payment.lead_id || proformaData.clientId,
          value: Number(payment.value) || 0,
          valueVat: Number(payment.value_vat ?? vat) || 0,
          currency,
          order: String(proformaData.paymentOrder ?? payment.payment_order ?? 'Payment'),
          clientName: proformaData.client || 'Client',
          leadNumber: leadNumber || proformaData.lead_number || '',
        });
      }

      toast.success(isEditMode ? 'Proforma updated successfully!' : 'Proforma created and saved successfully!');
      navigate(`/proforma/${paymentId}`);
    } catch (error) {
      toast.error('Failed to save proforma. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const getCurrencySymbol = (currency: string | undefined) => mapLeadCurrencyToSymbol(currency);

  if (loading || !proformaData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen text-center">
        <DocumentTextIcon className="w-16 h-16 text-primary mb-4" />
        <div className="text-2xl font-bold text-gray-800 mb-2">Loading proforma...</div>
      </div>
    );
  }

  const previewSubtotal = proformaData.rows.reduce(
    (sum: number, r: { total: number }) => sum + Number(r.total),
    0,
  );
  const previewVat = computeProformaVatFromPayment({
    currency: proformaData.currency,
    currency_id: payment?.currency_id ?? proformaData.currency_id,
    valueVat: payment?.value_vat,
    paymentOrder: proformaData.paymentOrder ?? payment?.payment_order,
    dueDate: proformaData.dueDate ?? payment?.due_date,
    subtotal: previewSubtotal,
  });
  const vatPercentLabel = Math.round(previewVat.vatRate * 100);

  const leadNumberForNav = formatNewLeadDisplayNumber(leadData, {
    subLeadsCount,
    isMasterLead,
  });
  const financesTabPath = buildClientFinancesTabPath({
    isLegacy: false,
    leadNumber: leadNumberForNav || undefined,
    manualId: leadData?.manual_id,
    leadId: proformaData?.clientId ?? payment?.lead_id,
  });

  return (
    <div className="w-full min-h-0">
      <div className="border-b border-gray-200 bg-white px-4 py-4 md:px-8 md:py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <ProformaBackToLeadButton href={financesTabPath} />
            <h2 className="min-w-0 truncate text-2xl font-extrabold text-gray-900 md:text-3xl">
              {isEditMode ? 'Edit Proforma' : 'Create Proforma'}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900"
            aria-label="Close"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="min-h-[calc(100dvh-10rem)] bg-gray-100 px-4 pb-12 pt-6 md:px-8">
        <div className="mx-auto grid max-w-[2400px] grid-cols-1 gap-8 xl:grid-cols-2 xl:items-start">
        {/* Editor column */}
        <div className="flex flex-col gap-4">
          <div className="mx-auto flex w-full max-w-[1100px] flex-wrap items-center justify-between gap-4 px-1">
            <h3 className="text-lg font-bold text-gray-900">Invoice</h3>
            <div className="flex gap-3">
              <button type="button" className="btn btn-outline" onClick={() => navigate(-1)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={handleSaveProforma} disabled={isSaving}>
                {isSaving ? 'Saving...' : isEditMode ? 'Save Changes' : 'Save Proforma'}
              </button>
            </div>
          </div>
          <div className={PROFORMA_INVOICE_SHEET_CLASS}>
          <div className="flex flex-col gap-8">
          <div className="overflow-x-auto mb-4">
            <table className="table w-full min-w-[500px]">
              <thead>
                <tr className="bg-white">
                  <th className="text-sm font-semibold text-gray-700">Description</th>
                  <th className="text-sm font-semibold text-gray-700">Qty</th>
                  <th className="text-sm font-semibold text-gray-700">Rate</th>
                  <th className="text-sm font-semibold text-gray-700">Total</th>
                </tr>
              </thead>
              <tbody>
                {proformaData.rows.map((row: any, idx: number) => (
                  <tr key={idx} className="hover:bg-gray-50 transition-colors">
                    <td>
                      <input
                        className="input input-bordered w-56 text-base py-3 px-4"
                        value={row.description}
                        onChange={e => handleProformaRowChange(idx, 'description', e.target.value)}
                        placeholder="Item description"
                      />
                    </td>
                    <td>
                      <input
                        className="input input-bordered w-16 cursor-not-allowed bg-gray-50 text-base text-right py-3 px-4 no-arrows"
                        type="number"
                        value={row.qty}
                        readOnly
                        tabIndex={-1}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        style={{ MozAppearance: 'textfield' }}
                      />
                    </td>
                    <td>
                      <input
                        className="input input-bordered w-32 cursor-not-allowed bg-gray-50 text-base text-right py-3 px-4 no-arrows"
                        type="number"
                        value={row.rate}
                        readOnly
                        tabIndex={-1}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        style={{ MozAppearance: 'textfield' }}
                      />
                    </td>
                    <td>
                      <input className="input input-bordered w-32 cursor-not-allowed bg-gray-50 text-base text-right font-semibold py-3 px-4 no-arrows" type="number" value={row.total} readOnly
                        tabIndex={-1}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        style={{ MozAppearance: 'textfield' }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Settings */}
          <h3 className="text-lg font-bold text-gray-800 mb-4">Settings</h3>
          <div className="mb-4 max-w-md">
            <ProformaBankAccountSelect
              accounts={bankAccounts}
              loading={bankAccountsLoading}
              value={proformaData.bankAccountId || ''}
              onChange={handleBankAccountChange}
            />
          </div>
          {/* Notes */}
          <h3 className="text-lg font-bold text-gray-800 mb-4">Notes</h3>
          <textarea
            className="textarea textarea-bordered w-full min-h-[120px] text-sm mb-4"
            value={proformaData.notes}
            onChange={e => setProformaData((prev: any) => ({ ...prev, notes: e.target.value }))}
            placeholder="Add any additional notes or terms..."
          />
          </div>
          </div>
        </div>
        {/* Preview — same sheet size and style as invoice view */}
        <div className="flex flex-col gap-4">
          <h3 className="text-lg font-bold text-gray-900 px-1">Preview</h3>
          <div className={PROFORMA_INVOICE_SHEET_CLASS}>
          <div className="flex flex-col gap-4 md:gap-6">
          {/* Header with logo and title */}
          <div className="flex items-start justify-between gap-4 mb-6 md:mb-14">
            <div className="min-w-0 flex-1">
              <div className="text-xl font-extrabold tracking-tight leading-tight text-gray-900 md:text-3xl">Invoice</div>
            </div>
            <div className="flex flex-shrink-0 items-center justify-center">
              <img
                src="/DPL-LOGO1.png"
                alt="DPL Logo"
                className="h-12 w-auto max-w-[7rem] object-contain md:h-16 md:max-w-[9rem]"
              />
            </div>
          </div>
          {/* Info section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 lg:gap-8 mb-6 md:mb-8">
            {/* Company Info */}
            <div className="mb-4">
              <ProformaFromCompanyInfo showFromLabel showPhoneLabel />
            </div>
            <div>
              <div className="font-semibold text-gray-700 mb-1">Bill To:</div>
              <div className="text-lg font-bold text-gray-900">{proformaData.client}</div>
              {proformaData.phone && (
                <div className="text-sm text-gray-500">{proformaData.phone}</div>
              )}
              {proformaData.email && (
                <div className="text-sm text-gray-500">{proformaData.email}</div>
              )}
              {proformaData.clientId && (() => {
                // Format lead number using same logic as ClientHeader
                const formatLeadNumber = () => {
                  if (!leadData) return '---';
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

                return (
                  <div className="text-sm text-gray-500 font-semibold">Case #: {formatLeadNumber()}</div>
                );
              })()}
              {!(proformaData.phone || proformaData.email) && (
                <div className="text-xs text-red-400">No client phone/email found.</div>
              )}
            </div>
          </div>
          {/* Proforma number and date row */}
          <div className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center gap-2 mb-6 md:mb-8">
            <div><span className="font-semibold text-gray-700">Proforma #:</span> <span className="text-gray-900">{proformaData.proformaName || ''}</span></div>
            <div><span className="font-semibold text-gray-700">Date:</span> <span className="text-gray-900">{new Date().toLocaleDateString()}</span></div>
          </div>
          {/* Table */}
          <div className="mb-6 md:mb-8 overflow-x-auto">
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
                {proformaData.rows.map((row: any, idx: number) => (
                  <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2 text-gray-900 font-medium">{row.description}</td>
                    <td className="px-4 py-2 text-right">{row.qty}</td>
                    <td className="px-4 py-2 text-right">{getCurrencySymbol(proformaData.currency)} {row.rate}</td>
                    <td className="px-4 py-2 text-right font-bold">{getCurrencySymbol(proformaData.currency)} {row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Totals summary */}
          <div className="flex flex-col sm:flex-row sm:justify-end gap-4 mb-6">
            <div className="w-full sm:w-full md:w-4/5 lg:w-3/4 xl:w-2/3 bg-white rounded-xl p-4 md:p-6 border border-gray-200">
              <div className="flex justify-between text-lg mb-2">
                <span className="font-semibold text-gray-700">Subtotal</span>
                <span className="font-bold text-gray-900">{getCurrencySymbol(proformaData.currency)} {previewSubtotal}</span>
              </div>
              {previewVat.addVat && (
                <div className="flex justify-between text-lg mb-2">
                  <span className="font-semibold text-gray-700">VAT ({vatPercentLabel}%)</span>
                  <span className="font-bold text-gray-900">{getCurrencySymbol(proformaData.currency)} {previewVat.vat.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-xl mt-4 border-t pt-4 font-extrabold">
                <span>Total</span>
                <span style={{ color: '#006BB1' }}>{getCurrencySymbol(proformaData.currency)} {previewVat.totalWithVat}</span>
              </div>
              <ProformaTotalInNis info={exchangeInfo} loading={exchangeLoading} variant="card" />
            </div>
          </div>
          {/* Notes */}
          {proformaData.notes && (
            <div className="mt-6 p-4 bg-yellow-50 rounded-lg border-l-4 border-yellow-400 text-gray-700 italic">
              <span className="font-semibold">Notes:</span> {proformaData.notes}
            </div>
          )}
          <ProformaBankDetails details={resolveBankAccountFromProforma(proformaData)} variant="card" />
          <ProformaExchangeRateFooter info={exchangeInfo} loading={exchangeLoading} variant="card" />
          <ProformaIssuedByFooter
            name={userFullName}
            date={proformaData?.createdAt ?? new Date().toISOString()}
            label="Created by"
            className="mt-8 text-xs text-gray-400 text-left"
          />
          <ProformaDocumentStamp variant="card" />
          </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};

export default ProformaCreatePage; 