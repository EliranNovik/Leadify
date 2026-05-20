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
import ProformaBankAccountSelect from '../components/proforma/ProformaBankAccountSelect';
import ProformaBankDetails from '../components/proforma/ProformaBankDetails';
import ProformaFromCompanyInfo from '../components/proforma/ProformaFromCompanyInfo';
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
      // Fetch client info from the specific contact (client_id) that the payment plan is based on
      let clientName = data.client_name || 'Client';
      let clientEmail = '';
      let clientPhone = '';

      // Use client_id from payment plan to get the correct contact
      if (data.client_id) {
        try {
          // First try new leads - get contact from contacts table
          const { data: newContactData } = await supabase
            .from('contacts')
            .select('name, email, phone')
            .eq('id', data.client_id)
            .single();

          if (newContactData) {
            clientName = newContactData.name || clientName;
            clientEmail = newContactData.email || '';
            clientPhone = newContactData.phone || '';
          } else {
            // If not found in new contacts, try legacy leads_contact table
            const { data: legacyContactData } = await supabase
              .from('leads_contact')
              .select('name, email, phone')
              .eq('id', data.client_id)
              .single();

            if (legacyContactData) {
              clientName = legacyContactData.name || clientName;
              clientEmail = legacyContactData.email || '';
              clientPhone = legacyContactData.phone || '';
            }
          }
        } catch (contactError) {
          console.error('Error fetching contact data:', contactError);
          // Fallback to client_name if contact fetch fails
        }
      } else if (data.lead_id) {
        // Fallback: if no client_id, try to get main contact from lead (old behavior)
        const { data: newLeadData } = await supabase
          .from('leads')
          .select('id')
          .eq('id', data.lead_id)
          .single();

        if (newLeadData) {
          try {
            // Try to get the main contact
            const { data: leadContacts } = await supabase
              .from('lead_leadcontact')
              .select('contact_id')
              .eq('newlead_id', data.lead_id)
              .eq('main', 'true')
              .limit(1);

            let contactId = null;
            if (leadContacts && leadContacts.length > 0) {
              contactId = leadContacts[0].contact_id;
            } else {
              // Fallback: get any contact for this lead
              const { data: allContacts } = await supabase
                .from('lead_leadcontact')
                .select('contact_id')
                .eq('newlead_id', data.lead_id)
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
                clientName = contactData.name || clientName;
                clientEmail = contactData.email || '';
                clientPhone = contactData.phone || '';
              }
            }
          } catch (contactError) {
            // Error handling - contact data will remain empty
          }
        } else {
          // Try legacy leads_lead table
          const { data: legacyLeadData } = await supabase
            .from('leads_lead')
            .select('name')
            .eq('id', data.lead_id)
            .single();

          if (legacyLeadData) {
            clientName = legacyLeadData.name || 'Client';
          }
        }
      }
      setPayment(data);

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
        currency: data.currency,
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
          currency: (existingProforma.currency as string) || data.currency,
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
          paymentRowId: data.id,
          email: existingProforma.email || clientEmail,
          phone: existingProforma.phone || clientPhone,
          bankAccountId: existingProforma.bankAccountId ?? '',
          bankAccountDetails:
            existingProforma.bankAccountDetails ??
            resolveBankAccountFromProforma(existingProforma as { bankAccountDetails?: BankAccountSnapshot | null }),
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
          paymentRowId: data.id,
          payment: data.value + data.value_vat,
          base: data.value,
          vat: vatState.vat,
          language: 'EN',
          rows: initialRows,
          addVat: vatState.addVat,
          totalWithVat: vatState.totalWithVat,
          currency: data.currency || '₪',
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
          valueVat: payment.value_vat,
          paymentOrder: proformaData.paymentOrder ?? payment.payment_order,
          dueDate: proformaData.dueDate ?? payment.due_date,
          subtotal,
        });
        const info = await fetchProformaExchangeRateInfo({
          currency: currencyInputFromNewPayment(payment, proformaData.currency),
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
      const currency = proformaData.currency || '₪';
      const { addVat, vat, totalWithVat } = computeProformaVatFromPayment({
        currency,
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
      });
      const { error } = await supabase
        .from('payment_plans')
        .update({ proforma: proformaContent })
        .eq('id', paymentId);
      if (error) throw error;
      toast.success(isEditMode ? 'Proforma updated successfully!' : 'Proforma created and saved successfully!');
      navigate(-1);
    } catch (error) {
      toast.error('Failed to save proforma. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Helper to get currency symbol
  const getCurrencySymbol = (currency: string | undefined) => {
    if (!currency) return '₪';
    if (currency === 'USD' || currency === '$') return '$';
    if (currency === '₪') return '₪';
    return currency;
  };

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
    valueVat: payment?.value_vat,
    paymentOrder: proformaData.paymentOrder ?? payment?.payment_order,
    dueDate: proformaData.dueDate ?? payment?.due_date,
    subtotal: previewSubtotal,
  });
  const vatPercentLabel = Math.round(previewVat.vatRate * 100);

  return (
    <div className="relative w-full max-w-none py-6 md:py-8 px-4 md:px-6 lg:px-8">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="absolute top-6 right-4 md:top-8 md:right-6 lg:right-8 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900"
        aria-label="Close"
      >
        <XMarkIcon className="h-5 w-5" />
      </button>
      <div className="mb-8 pr-12">
        <h2 className="text-3xl font-extrabold text-gray-900">{isEditMode ? 'Edit Proforma' : 'Create Proforma'}</h2>
      </div>
      {/* Main two-column layout: left = editor, right = live preview */}
      <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
        <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x divide-gray-200 items-stretch">
        {/* Left: editing tools */}
        <div className="flex flex-col gap-8 p-6 lg:p-8 min-h-[700px] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-4">
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
        {/* Right: preview on grey canvas with white invoice sheet */}
        <div className="bg-gray-100 p-4 md:p-6 lg:p-8 min-h-[700px]">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Preview</h3>
          <div className="relative bg-white rounded-lg shadow-md border border-gray-200/80 p-4 md:p-6 lg:p-8 min-h-full flex flex-col gap-4 md:gap-6">
          {/* Header with logo and title */}
          <div className="flex items-start justify-between gap-4 mb-6 md:mb-8 border-b pb-4 md:pb-6">
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
                  <div className="text-sm text-gray-500 font-semibold">Lead #: {formatLeadNumber()}</div>
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
          {/* Created by at bottom left inside the card */}
          <div className="mt-8 text-xs text-gray-400 text-left">
            Created by: {userFullName || ''}
          </div>
          <ProformaDocumentStamp variant="card" />
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};

export default ProformaCreatePage; 