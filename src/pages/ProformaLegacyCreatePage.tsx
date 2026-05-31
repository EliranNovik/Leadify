import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { DocumentTextIcon, Cog6ToothIcon, ChartPieIcon, ChatBubbleLeftRightIcon, XMarkIcon, CheckIcon, PrinterIcon, EnvelopeIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { generateProformaName } from '../lib/proforma';
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
  embedLegacyBankInNotes,
  fetchActiveBankAccounts,
  fetchBankAccountById,
  parseLegacyBankFromNotes,
  resolveBankAccountFromProforma,
  type BankAccountRecord,
  type BankAccountSnapshot,
} from '../lib/bankAccounts';
import { getLegacyNotesPrefix, getPublicProformaDisplayNotes } from '../lib/proformaNotes';
import {
  currencyInputFromLegacyProforma,
  fetchProformaExchangeRateInfo,
  type ProformaExchangeRateInfo,
} from '../lib/proformaExchangeRate';

import { computeProformaVatFromPayment, getVatRateForLegacyLead } from '../lib/proformaVat';
import { ensureProformaPaymentLink } from '../lib/proformaPaymentLink';
import { formatLegacyLeadNumber } from '../lib/masterLeadApi';
import {
  displaySymbolForPaymentSave,
  mapLeadCurrencyToSymbol,
  resolveCurrencyIdForSave,
  resolveProformaCurrency,
} from '../lib/paymentPlanCurrency';
import { resolvePaymentPlanContact } from '../lib/resolvePaymentPlanContact';

function parseContactId(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

/** Matches invoice sheet on ProformaLegacyViewPage */
const PROFORMA_INVOICE_SHEET_CLASS =
  'relative mx-auto w-full max-w-[1100px] overflow-hidden rounded-lg border border-gray-200/90 bg-white p-8 shadow-[0_4px_24px_rgba(0,0,0,0.08)] md:p-10';

/** URL client_id, then payment-plan row client_id (contact), then main-contact fallback. */
function resolveLegacyProformaContactId(
  urlClientId: string | null,
  pprClientId: number | string | null | undefined,
): number | null {
  const fromUrl = urlClientId ? parseContactId(urlClientId) : null;
  if (fromUrl != null) return fromUrl;
  return parseContactId(pprClientId ?? null);
}

function resolveLegacyProformaCurrency(
  input: {
    currency_id?: number | string | null;
    currency?: string | null;
    currency_code?: string | null;
    lead_currency_id?: number | string | null;
  },
) {
  return resolveProformaCurrency({
    currency_id: input.currency_id,
    currency: input.currency ?? (input.currency_code ? mapLeadCurrencyToSymbol(input.currency_code) : null),
    lead_currency_id: input.lead_currency_id,
  });
}

const ProformaLegacyCreatePage: React.FC = () => {
  const { leadId, proformaId } = useParams<{ leadId?: string; proformaId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isEditMode = Boolean(proformaId);
  const [loading, setLoading] = useState(true);
  const [legacyNotesPrefix, setLegacyNotesPrefix] = useState<string | null>(null);
  const [lead, setLead] = useState<any>(null);
  const [proformaData, setProformaData] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [userFullName, setUserFullName] = useState<string | null>(null);
  const [clientId, setClientId] = useState<number | null>(null);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [subLeadsCount, setSubLeadsCount] = useState<number>(0);
  const [isMasterLead, setIsMasterLead] = useState<boolean>(false);
  const [exchangeInfo, setExchangeInfo] = useState<ProformaExchangeRateInfo | null>(null);
  const [exchangeLoading, setExchangeLoading] = useState(false);
  const [bankAccounts, setBankAccounts] = useState<BankAccountRecord[]>([]);
  const [bankAccountsLoading, setBankAccountsLoading] = useState(true);

  useEffect(() => {
    const loadBankAccounts = async () => {
      setBankAccountsLoading(true);
      try {
        const accounts = await fetchActiveBankAccounts();
        setBankAccounts(accounts);
      } catch (err) {
        console.error('[ProformaLegacyCreatePage] bank accounts:', err);
        toast.error('Failed to load bank accounts');
      } finally {
        setBankAccountsLoading(false);
      }
    };
    void loadBankAccounts();
  }, []);

  useEffect(() => {
    const loadExistingProforma = async (invoiceId: string) => {
      setLoading(true);
      setLegacyNotesPrefix(null);

      const { data, error } = await supabase
        .from('proforma_with_rows')
        .select('*')
        .eq('id', invoiceId)
        .single();

      if (error || !data) {
        toast.error('Failed to load proforma');
        setLoading(false);
        return;
      }

      const { data: invoiceMeta } = await supabase
        .from('proformainvoice')
        .select('ppr_id, client_id')
        .eq('id', invoiceId)
        .single();

      let paymentPlanDate: string | null = null;
      let paymentPlanOrder: number | string | null = null;
      let paymentPlanCurrencyId: number | string | null = null;
      let paymentPaid = false;
      let paidAt: string | null = null;
      if (invoiceMeta?.ppr_id) {
        const { data: pprData } = await supabase
          .from('finances_paymentplanrow')
          .select('date, due_date, actual_date, order, currency_id')
          .eq('id', invoiceMeta.ppr_id)
          .single();
        if (pprData) {
          paymentPlanDate = pprData.date || pprData.due_date || null;
          paymentPlanOrder = pprData.order ?? null;
          paymentPlanCurrencyId = pprData.currency_id ?? null;
          paymentPaid = Boolean(pprData.actual_date);
          paidAt = pprData.actual_date || null;
        }
      }

      const leadIdNum = data.lead_id;
      if (!leadIdNum) {
        toast.error('Proforma has no linked lead');
        setLoading(false);
        return;
      }

      const { data: leadData, error: leadError } = await supabase
        .from('leads_lead')
        .select(`
          *,
          accounting_currencies!leads_lead_currency_id_fkey (
            name,
            iso_code
          )
        `)
        .eq('id', leadIdNum)
        .single();

      if (leadError || !leadData) {
        toast.error('Failed to load lead details');
        setLoading(false);
        return;
      }

      setLead(leadData);
      if (invoiceMeta?.client_id) {
        setClientId(Number(invoiceMeta.client_id));
      }

      let clientName = data.client_name || leadData.name || 'Client';
      let clientEmail = data.client_email || '';
      let clientPhone = data.client_phone || '';

      const resolvedContact = await resolvePaymentPlanContact({
        leadId: leadIdNum,
        clientId: invoiceMeta?.client_id,
        clientNameFallback: data.client_name,
        leadNameFallback: leadData.name,
      });
      clientName = resolvedContact.name || clientName;
      clientEmail = resolvedContact.email || clientEmail;
      clientPhone = resolvedContact.phone || clientPhone;

      let bankAccountDetails = parseLegacyBankFromNotes(data.notes) ?? null;
      if (!bankAccountDetails && data.bank_account_id) {
        const bankId = String(data.bank_account_id);
        if (/^[0-9a-f-]{36}$/i.test(bankId)) {
          bankAccountDetails = await fetchBankAccountById(bankId);
        }
      }

      const resolvedCurrencyId =
        paymentPlanCurrencyId ?? data.currency_id ?? leadData.currency_id;
      const { displaySymbol: currencySymbol, currencyId: normalizedCurrencyId } =
        await resolveLegacyProformaCurrency({
          currency_id: resolvedCurrencyId,
          currency_code: data.currency_code,
          lead_currency_id: leadData.currency_id,
        });

      const rows = Array.isArray(data.rows)
        ? data.rows.map((row: { description?: string; qty?: number; rate?: number; total?: number }) => ({
            description: row.description ?? '',
            qty: Number(row.qty) || 1,
            rate: Number(row.rate) || 0,
            total: Number(row.total) || 0,
          }))
        : [{ description: 'Legal Services', qty: 1, rate: 0, total: 0 }];

      setLegacyNotesPrefix(getLegacyNotesPrefix(data.notes));

      const editSubtotal = rows.reduce((sum: number, r: { total: number }) => sum + Number(r.total), 0);
      const editVatState = computeProformaVatFromPayment({
        currency: currencySymbol,
        currency_id: normalizedCurrencyId,
        valueVat: data.vat_value,
        paymentOrder: paymentPlanOrder,
        dueDate: paymentPlanDate,
        subtotal: editSubtotal,
      });

      setProformaData({
        client: clientName,
        clientId: leadData.id,
        leadId: leadData.id,
        pprId: invoiceMeta?.ppr_id ? String(invoiceMeta.ppr_id) : null,
        paymentPlanDate,
        paymentOrder: paymentPlanOrder,
        payment: Number(data.total) || 0,
        base: Number(data.sub_total || data.total_base) || 0,
        vat: editVatState.vat,
        language: 'EN',
        rows,
        addVat: editVatState.addVat,
        totalWithVat: editVatState.totalWithVat,
        currency: currencySymbol,
        currency_id: normalizedCurrencyId,
        paymentPaid,
        paid_at: paidAt,
        bankAccount: bankAccountDetails?.name ?? '',
        bankAccountId: bankAccountDetails?.id ?? '',
        bankAccountDetails,
        notes: getPublicProformaDisplayNotes(data.notes),
        email: clientEmail,
        phone: clientPhone,
        issuedDate: data.cdate ?? null,
      });
      setLoading(false);
    };

    const fetchLead = async () => {
      setLoading(true);
      setLegacyNotesPrefix(null);
      setProformaData(null);
      setLead(null);

      console.log('🔍 Full URL:', window.location.href);
      console.log('🔍 Location search:', location.search);

      // Get ppr_id and client_id from URL parameters
      const urlParams = new URLSearchParams(location.search);
      const pprId = urlParams.get('ppr_id');
      const clientIdParam = urlParams.get('client_id');

      console.log('🔍 ProformaLegacyCreate - pprId from URL:', pprId);
      console.log('🔍 ProformaLegacyCreate - clientId from URL:', clientIdParam);

      // Fetch payment plan row description and order if ppr_id is available
      let paymentPlanDescription = '';
      let paymentPlanOrder = '';
      let pprData: any = null;

      if (pprId) {
        console.log('🔍 Fetching payment plan data for pprId:', pprId);

        // First, let's check if there are any records with this ID
        const { data: allRecords, error: allRecordsError } = await supabase
          .from('finances_paymentplanrow')
          .select('id, "order", notes')
          .eq('id', pprId);

        console.log('🔍 All records with this ID:', { allRecords, allRecordsError });

        const { data: fetchedPprData, error: pprError } = await supabase
          .from('finances_paymentplanrow')
          .select('"order", notes, value, value_base, vat_value, currency_id, date, due_date, actual_date, client_id')
          .eq('id', pprId)
          .single();

        console.log('🔍 Payment plan data result:', { fetchedPprData, pprError });
        if (pprError) {
          console.error('❌ Payment plan query error:', pprError);
        }

        if (fetchedPprData) {
          pprData = fetchedPprData;
          console.log('🔍 Payment plan data:', {
            notes: pprData.notes,
            order: pprData.order,
            value: pprData.value,
            value_base: pprData.value_base,
            vat_value: pprData.vat_value,
            currency_id: pprData.currency_id
          });

          if (pprData.notes) {
            paymentPlanDescription = pprData.notes;
            console.log('🔍 Set paymentPlanDescription from notes:', paymentPlanDescription);
          }
          if (pprData.order) {
            // Map numeric order to text description (same logic as FinancesTab)
            const getOrderText = (orderNumber: number): string => {
              switch (orderNumber) {
                case 1: return 'First Payment';
                case 5: return 'Intermediate Payment';
                case 9: return 'Final Payment';
                case 90: return 'Single Payment';
                case 99: return 'Expense (no VAT)';
                default: return `Payment ${orderNumber}`;
              }
            };
            paymentPlanOrder = getOrderText(pprData.order);
            console.log('🔍 Mapped order:', pprData.order, 'to:', paymentPlanOrder);
          }
        }
      } else {
        console.log('🔍 No pprId found in URL parameters');
      }

      const resolvedContactId = resolveLegacyProformaContactId(clientIdParam, pprData?.client_id);
      if (resolvedContactId != null) {
        setClientId(resolvedContactId);
      }

      const { data, error } = await supabase
        .from('leads_lead')
        .select(`
          *,
          accounting_currencies!leads_lead_currency_id_fkey (
            name,
            iso_code
          )
        `)
        .eq('id', leadId)
        .single();
      if (error) {
        toast.error('Failed to load lead details');
        setLoading(false);
        return;
      }
      setLead(data);

      const resolvedContact = await resolvePaymentPlanContact({
        leadId: data.id,
        clientId: resolvedContactId,
        leadNameFallback: data.name,
      });
      const clientName = resolvedContact.name;
      const clientEmail = resolvedContact.email;
      const clientPhone = resolvedContact.phone;

      // Fetch subleads data for lead number formatting (for legacy leads)
      try {
        const masterId = data.master_id;
        const leadId = String(data.id);

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
            .eq('master_id', data.id);

          const subLeadsCountValue = subLeads?.length || 0;
          setSubLeadsCount(subLeadsCountValue);
          setIsMasterLead(subLeadsCountValue > 0);
        }
      } catch (error) {
        console.error('Error fetching subleads data:', error);
      }

      console.log('🔍 Final description values:', {
        pprId,
        paymentPlanOrder,
        paymentPlanDescription,
        leadDescription: data.description,
        finalDescription: paymentPlanOrder || paymentPlanDescription || data.description || 'Legal Services'
      });

      // Determine currency and amounts — payment plan row currency wins over lead
      const resolvedCurrencyId = pprData?.currency_id ?? data.currency_id;
      const { displaySymbol: currencySymbol, currencyId: normalizedCurrencyId } =
        await resolveLegacyProformaCurrency({
          currency_id: resolvedCurrencyId,
          lead_currency_id: data.currency_id,
        });

      const paymentAmount = pprData?.value ? Number(pprData.value) : (data.total || 0);
      const baseAmount = pprData?.value_base ? Number(pprData.value_base) : (data.total || 0);
      const vatAmount = pprData?.vat_value ? Number(pprData.vat_value) : 0;

      console.log('🔍 Currency info:', {
        leadCurrencyId: data.currency_id,
        paymentPlanCurrencyId: pprData?.currency_id,
        finalCurrencyId: normalizedCurrencyId,
        currencySymbol,
      });

      console.log('🔍 Amount info:', {
        leadTotal: data.total,
        paymentPlanValue: pprData?.value,
        paymentPlanValueBase: pprData?.value_base,
        paymentPlanVatValue: pprData?.vat_value,
        finalPaymentAmount: paymentAmount,
        finalBaseAmount: baseAmount,
        finalVatAmount: vatAmount
      });

      const paymentPlanDate = pprData?.date || pprData?.due_date || null;
      const initialRows = [
        {
          description: paymentPlanOrder || paymentPlanDescription || data.description || 'Legal Services',
          qty: 1,
          rate: paymentAmount,
          total: paymentAmount,
        },
      ];
      const initialSubtotal = paymentAmount;
      const createVatState = computeProformaVatFromPayment({
        currency: currencySymbol,
        currency_id: normalizedCurrencyId,
        valueVat: vatAmount,
        paymentOrder: pprData?.order ?? null,
        dueDate: paymentPlanDate,
        subtotal: initialSubtotal,
      });

      setProformaData({
        client: clientName,
        clientId: data.id,
        leadId: data.id,
        planContactId: resolvedContactId ?? (pprData?.client_id != null ? Number(pprData.client_id) : null),
        pprId: pprId,
        paymentPlanDate,
        paymentOrder: pprData?.order ?? null,
        payment: paymentAmount,
        base: baseAmount,
        vat: createVatState.vat,
        paymentValueVat: vatAmount,
        language: 'EN',
        rows: initialRows,
        addVat: createVatState.addVat,
        totalWithVat: createVatState.totalWithVat,
        currency: currencySymbol,
        currency_id: normalizedCurrencyId,
        paymentPaid: Boolean(pprData?.actual_date),
        paid_at: pprData?.actual_date ?? null,
        bankAccount: '',
        bankAccountId: '',
        bankAccountDetails: null as BankAccountSnapshot | null,
        notes: '',
        email: clientEmail,
        phone: clientPhone,
      });
      setLoading(false);
    };
    if (proformaId) {
      void loadExistingProforma(proformaId);
    } else if (leadId) {
      void fetchLead();
    }
  }, [leadId, proformaId, location.search]);

  useEffect(() => {
    if (!proformaData) {
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
          currency_id: proformaData.currency_id,
          valueVat: proformaData.paymentValueVat ?? proformaData.vat,
          paymentOrder: proformaData.paymentOrder,
          dueDate: proformaData.paymentPlanDate,
          subtotal,
        });
        const info = await fetchProformaExchangeRateInfo({
          currency: currencyInputFromLegacyProforma({
            currency_id: proformaData.currency_id,
            currency_code: proformaData.currency,
          }),
          paid: Boolean(proformaData.paymentPaid),
          paidAt: proformaData.paid_at ?? null,
          subtotal,
          vat,
          total,
        });
        if (!cancelled) setExchangeInfo(info);
      } catch (err) {
        console.error('[ProformaLegacyCreatePage] exchange rate:', err);
        if (!cancelled) setExchangeInfo(null);
      } finally {
        if (!cancelled) setExchangeLoading(false);
      }
    };

    void loadExchange();
    return () => {
      cancelled = true;
    };
  }, [proformaData]);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && user.email) {
        // Fetch user full name
        const { data: userData, error } = await supabase
          .from('users')
          .select('full_name')
          .eq('email', user.email)
          .single();
        if (!error && userData?.full_name) {
          setUserFullName(userData.full_name);
        }

        // Fetch employee ID from users table (users.employee_id -> tenants_employee.id)
        const { data: userWithEmployee, error: userError } = await supabase
          .from('users')
          .select('id, email, employee_id, tenants_employee!employee_id(id, display_name)')
          .eq('email', user.email)
          .single();

        if (!userError && userWithEmployee?.employee_id) {
          setEmployeeId(userWithEmployee.employee_id);
          console.log('✅ [ProformaLegacyCreate] Employee ID found via users table:', {
            userId: userWithEmployee.id,
            employeeId: userWithEmployee.employee_id,
            email: userWithEmployee.email,
            display_name: (userWithEmployee.tenants_employee as any)?.display_name || null
          });
        } else {
          console.error('❌ [ProformaLegacyCreate] Could not find employee ID via users table:', {
            userEmail: user.email,
            error: userError,
            userData: userWithEmployee
          });

          // Fallback: Try direct lookup in tenants_employee by email (in case email field exists there)
          const { data: employeeData, error: employeeError } = await supabase
            .from('tenants_employee')
            .select('id, email, display_name')
            .eq('email', user.email)
            .maybeSingle();

          if (!employeeError && employeeData?.id) {
            setEmployeeId(employeeData.id);
            console.log('✅ [ProformaLegacyCreate] Employee ID found via direct tenants_employee lookup:', {
              id: employeeData.id,
              email: employeeData.email,
              display_name: employeeData.display_name
            });
          } else {
            console.error('❌ [ProformaLegacyCreate] Could not find employee ID via any method:', {
              userEmail: user.email,
              usersTableError: userError,
              tenantsEmployeeError: employeeError
            });
          }
        }
      }
    };
    fetchUser();
  }, []);

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
      const proformaName = isEditMode ? null : await generateProformaName();

      // Calculate totals
      const total = proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0);
      const totalBase = total;

      const { addVat, vat, totalWithVat } = computeProformaVatFromPayment({
        currency: proformaData.currency,
        currency_id: proformaData.currency_id,
        valueVat: proformaData.vat,
        paymentOrder: proformaData.paymentOrder,
        dueDate: proformaData.paymentPlanDate,
        subtotal: total,
      });

      // Prepare rows data - pass as array, Supabase will convert to jsonb
      const rowsData = proformaData.rows.map((row: any) => ({
        description: row.description,
        qty: Number(row.qty),
        rate: Number(row.rate),
        total: Number(row.total)
      }));

      let currencyId = resolveCurrencyIdForSave({
        currency: proformaData.currency,
        currency_id: proformaData.currency_id,
      });
      if ((!currencyId || currencyId <= 0) && proformaData.pprId) {
        const { data: pprData } = await supabase
          .from('finances_paymentplanrow')
          .select('currency_id')
          .eq('id', proformaData.pprId)
          .single();
        if (pprData?.currency_id) {
          currencyId = resolveCurrencyIdForSave({ currency_id: pprData.currency_id });
        }
      } else if ((!currencyId || currencyId <= 0) && lead?.currency_id) {
        currencyId = resolveCurrencyIdForSave({ currency_id: lead.currency_id });
      }

      const currencySymbol = displaySymbolForPaymentSave({
        currency: proformaData.currency,
        currency_id: currencyId,
      });

      let notes = proformaData.notes || '';
      if (isEditMode && legacyNotesPrefix) {
        notes = notes ? `${legacyNotesPrefix}\n${notes}` : legacyNotesPrefix;
      } else if (proformaName) {
        notes = notes ? `${proformaName}\n${notes}` : proformaName;
      }
      notes = embedLegacyBankInNotes(notes, proformaData.bankAccountDetails ?? null);

      if (isEditMode && proformaId) {
        const { error: updateError } = await supabase
          .from('proformainvoice')
          .update({
            total: totalWithVat,
            total_base: totalBase,
            vat_value: vat,
            notes,
            sub_total: totalBase,
            add_vat: addVat ? 't' : 'f',
            currency_id: currencyId,
            client_id: clientId,
          })
          .eq('id', proformaId);

        if (updateError) throw updateError;

        const { error: deleteRowsError } = await supabase
          .from('proformainvoicerow')
          .delete()
          .eq('invoice_id', proformaId);

        if (deleteRowsError) throw deleteRowsError;

        const rowInserts = rowsData.map((row: { description: string; qty: number; rate: number; total: number }) => ({
          description: row.description,
          qty: row.qty,
          rate: row.rate,
          total: row.total,
          invoice_id: Number(proformaId),
        }));

        const { error: insertRowsError } = await supabase.from('proformainvoicerow').insert(rowInserts);
        if (insertRowsError) throw insertRowsError;

        setIsSaving(false);
        toast.success('Proforma updated successfully!');
        navigate(`/proforma-legacy/${proformaId}`);
        return;
      }

      // Warn if employeeId is not set
      if (!employeeId) {
        console.warn('⚠️ [ProformaLegacyCreate] Employee ID is not set! Proforma will be created without creator_id.');
        toast.error('Warning: Could not find employee ID. Proforma will be created without creator information.');
      }

      // Debug: Log the values being passed
      console.log('🔍 [ProformaLegacyCreate] Creating proforma with:', {
        p_lead_id: parseInt(leadId!),
        p_client_id: clientId,
        p_creator_id: employeeId,
        p_ppr_id: proformaData.pprId ? parseInt(proformaData.pprId) : null,
        employeeIdState: employeeId,
        hasEmployeeId: !!employeeId
      });

      // Create proforma using the function we created in SQL
      let { data, error } = await supabase.rpc('create_proforma_with_rows', {
        p_lead_id: parseInt(leadId!),
        p_total: totalWithVat,
        p_total_base: totalBase,
        p_vat_value: vat,
        p_notes: notes,
        p_sub_total: totalBase,
        p_add_vat: addVat ? 't' : 'f',
        p_currency_id: currencyId,
        p_client_id: clientId, // Use client_id from URL parameter (contact_id)
        p_bank_account_id: null,
        p_ppr_id: proformaData.pprId ? parseInt(proformaData.pprId) : null,
        p_creator_id: employeeId, // Use employee ID from logged-in user
        p_rows: rowsData // Pass array directly, Supabase converts to jsonb
      });

      if (error) {
        console.error('❌ [ProformaLegacyCreate] Error creating proforma:', error);
      } else {
        console.log('✅ [ProformaLegacyCreate] Proforma created successfully:', data);
      }

      // If we get a duplicate key error (sequence out of sync), try to fix it and retry
      if (error && error.code === '23505') {
        console.log('🔧 Duplicate key error detected - fixing sequences and retrying...');

        // Fix both sequences (proformainvoice and proformainvoicerow)
        const { error: fixError } = await supabase.rpc('fix_proformainvoice_sequence');
        if (fixError) {
          console.error('❌ Error fixing sequences:', fixError);
          throw new Error('Failed to fix sequences. Please run the fix script manually.');
        }

        console.log('✅ Sequences fixed, retrying proforma creation...');

        // Retry creating the proforma (with a small delay to ensure sequences are updated)
        await new Promise(resolve => setTimeout(resolve, 100));

        const retryResult = await supabase.rpc('create_proforma_with_rows', {
          p_lead_id: parseInt(leadId!),
          p_total: totalWithVat,
          p_total_base: totalBase,
          p_vat_value: vat,
          p_notes: notes,
          p_sub_total: totalBase,
          p_add_vat: addVat ? 't' : 'f',
          p_currency_id: currencyId,
          p_client_id: clientId, // Use client_id from URL parameter (contact_id)
          p_bank_account_id: null,
          p_ppr_id: proformaData.pprId ? parseInt(proformaData.pprId) : null,
          p_creator_id: employeeId, // Use employee ID from logged-in user
          p_rows: rowsData
        });

        if (retryResult.error) {
          // If it still fails after fixing, it might be a different issue
          console.error('❌ Error after sequence fix:', retryResult.error);
          throw retryResult.error;
        }

        data = retryResult.data;
        console.log('✅ Proforma created successfully after sequence fix');
      } else if (error) {
        throw error;
      }

      const newProformaId = data != null ? String(data) : null;
      if (newProformaId && proformaData.pprId && leadId) {
        const leadNumber = lead
          ? formatLegacyLeadNumber(lead, subLeadsCount || undefined, isMasterLead)
          : String(leadId);
        const orderLabel =
          proformaData.rows?.[0]?.description ||
          (proformaData.paymentOrder != null ? String(proformaData.paymentOrder) : 'Payment');

        await ensureProformaPaymentLink({
          paymentPlanId: proformaData.pprId,
          leadClientId: leadId,
          leadType: 'legacy',
          isLegacyPaymentPlan: true,
          planContactId:
            proformaData.planContactId != null
              ? Number(proformaData.planContactId)
              : null,
          value: totalBase,
          valueVat: vat,
          currency: currencySymbol,
          order: orderLabel,
          clientName: proformaData.client || lead?.name || 'Client',
          leadNumber,
        });
      }

      setIsSaving(false);
      toast.success('Proforma created and saved successfully!');
      if (newProformaId) {
        navigate(`/proforma-legacy/${newProformaId}`);
      } else {
        navigate(-1);
      }
    } catch (error) {
      console.error('Error saving proforma:', error);
      toast.error('Failed to save proforma. Please try again.');
      setIsSaving(false);
    }
  };

  if (loading || !proformaData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen text-center">
        <DocumentTextIcon className="w-16 h-16 text-primary mb-4" />
        <div className="text-2xl font-bold text-gray-800 mb-2">Loading proforma...</div>
      </div>
    );
  }

  const getCurrencySymbol = (currency: string | undefined) => mapLeadCurrencyToSymbol(currency);

  const previewSubtotal = proformaData.rows.reduce(
    (sum: number, r: { total: number }) => sum + Number(r.total),
    0,
  );
  const previewVat = computeProformaVatFromPayment({
    currency: proformaData.currency,
    currency_id: proformaData.currency_id,
    valueVat: proformaData.paymentValueVat ?? proformaData.vat,
    paymentOrder: proformaData.paymentOrder,
    dueDate: proformaData.paymentPlanDate,
    subtotal: previewSubtotal,
  });
  const vatPercentLabel = Math.round(previewVat.vatRate * 100);

  const formatLeadNumberForNav = () => {
    if (!lead) return '';
    const masterId = lead.master_id;
    const idStr = String(lead.id || proformaData?.clientId || leadId || '');
    if (!masterId || String(masterId).trim() === '') {
      const isSuccessStage = lead.stage === 100 || lead.stage === '100';
      if (isSuccessStage && idStr && !idStr.startsWith('C')) return `C${idStr}`;
      return idStr;
    }
    const suffix = subLeadsCount > 0 ? subLeadsCount : 2;
    const formatted = `${masterId}/${suffix}`;
    const isSuccessStage = lead.stage === 100 || lead.stage === '100';
    if (isSuccessStage && !formatted.startsWith('C')) {
      return formatted.replace(/^L/, 'C').replace(/^(\d+)/, 'C$1');
    }
    return formatted;
  };

  const isLegacySubLead = Boolean(lead?.master_id && String(lead.master_id).trim() !== '');
  const financesTabPath = buildClientFinancesTabPath({
    isLegacy: true,
    leadId: lead?.id ?? proformaData?.leadId ?? leadId,
    leadNumber: formatLeadNumberForNav(),
    manualId: isLegacySubLead ? String(lead.master_id) : String(lead?.id ?? leadId ?? ''),
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
                // Format lead number using same logic as Clients.tsx formatLegacyLeadNumber (for legacy leads)
                const formatLeadNumber = () => {
                  if (!lead) return proformaData.clientId || '---';

                  const masterId = lead.master_id;
                  const leadId = String(lead.id || proformaData.clientId || '---');

                  // If master_id is null/empty, it's a master lead - return just the ID (no /1 suffix for legacy leads)
                  if (!masterId || String(masterId).trim() === '') {
                    // For legacy leads, add "C" prefix for success stage (stage 100)
                    const isSuccessStage = lead.stage === 100 || lead.stage === '100';
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
                  const isSuccessStage = lead.stage === 100 || lead.stage === '100';
                  if (isSuccessStage && !formattedNumber.startsWith('C')) {
                    // Replace L prefix with C if success stage, or add C prefix
                    return formattedNumber.replace(/^L/, 'C').replace(/^(\d+)/, 'C$1');
                  }

                  return formattedNumber;
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
            <div><span className="font-semibold text-gray-700">Proforma #:</span> <span className="text-gray-900">{isEditMode ? proformaId : leadId}</span></div>
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
                  <span className="font-bold text-gray-900">
                    {getCurrencySymbol(proformaData.currency)} {previewVat.vat.toFixed(2)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-xl mt-4 border-t pt-4 font-extrabold">
                <span>Total</span>
                <span className="text-green-600">
                  {getCurrencySymbol(proformaData.currency)} {previewVat.totalWithVat.toFixed(2)}
                </span>
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
            date={proformaData?.issuedDate ?? new Date().toISOString()}
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

export default ProformaLegacyCreatePage;
