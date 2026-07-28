import { supabase } from './supabase';
import type { LeadFeeIdentity } from './leadSubcontractorFees';
import { resolveLeadFeeIdentity } from './leadSubcontractorFees';
import {
  displaySymbolForPaymentSave,
  resolveCurrencyIdForSave,
} from './paymentPlanCurrency';
import { calculatePaymentPlanVatAmount } from './paymentPlanVat';
import { isExpenseNoVatPayment } from './proformaVat';

export { resolveLeadFeeIdentity };
export type { LeadFeeIdentity };

/** Finances payment_order / display label for expense rows (order 99). */
export const LEAD_EXPENSE_PAYMENT_ORDER = 'Expense' as const;

export type LeadExpensePaidBy = 'firm' | 'client';

export type LeadExpenseTypeRow = {
  id: string;
  code: string;
  label: string;
  sort_order: number;
  is_active: boolean;
};

export type LeadExpenseRow = {
  id: number;
  created_at: string;
  updated_at: string;
  lead_type: 'new' | 'legacy' | null;
  new_lead_id: string | null;
  legacy_lead_id: number | null;
  lead_number: string | null;
  expense_type_id: string;
  amount: number;
  currency_id: number | null;
  expense_date: string | null;
  notes: string | null;
  include_vat: boolean;
  paid_by: LeadExpensePaidBy;
  is_reimbursable: boolean;
  is_reimbursed: boolean;
  contact_id: number | null;
  payment_plan_id: number | null;
  legacy_payment_plan_row_id: number | null;
  created_by: string | null;
  lead_expense_types?: { id: string; code: string; label: string } | null;
  accounting_currencies?: { id: number; name: string; iso_code: string | null } | null;
  leads_contact?: { id: number; name: string | null } | null;
};

export type LeadExpenseContactOption = {
  id: number;
  name: string;
  isMain?: boolean;
};

const EXPENSE_SELECT = `
  id,
  created_at,
  updated_at,
  lead_type,
  new_lead_id,
  legacy_lead_id,
  lead_number,
  expense_type_id,
  amount,
  currency_id,
  expense_date,
  notes,
  include_vat,
  paid_by,
  is_reimbursable,
  is_reimbursed,
  contact_id,
  payment_plan_id,
  legacy_payment_plan_row_id,
  created_by,
  lead_expense_types:expense_type_id ( id, code, label ),
  accounting_currencies:currency_id ( id, name, iso_code ),
  leads_contact:contact_id ( id, name )
`;

function normalizeExpenseRow(row: any): LeadExpenseRow {
  const typeJoin = Array.isArray(row.lead_expense_types)
    ? row.lead_expense_types[0]
    : row.lead_expense_types;
  const currencyJoin = Array.isArray(row.accounting_currencies)
    ? row.accounting_currencies[0]
    : row.accounting_currencies;
  const contactJoin = Array.isArray(row.leads_contact)
    ? row.leads_contact[0]
    : row.leads_contact;
  const paidBy = row.paid_by === 'firm' ? 'firm' : 'client';

  return {
    id: Number(row.id),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    lead_type: row.lead_type === 'legacy' ? 'legacy' : row.lead_type === 'new' ? 'new' : null,
    new_lead_id: row.new_lead_id != null ? String(row.new_lead_id) : null,
    legacy_lead_id: row.legacy_lead_id != null ? Number(row.legacy_lead_id) : null,
    lead_number: row.lead_number != null ? String(row.lead_number) : null,
    expense_type_id: String(row.expense_type_id),
    amount: Number(row.amount) || 0,
    currency_id: row.currency_id != null ? Number(row.currency_id) : null,
    expense_date: row.expense_date != null ? String(row.expense_date).slice(0, 10) : null,
    notes: row.notes != null ? String(row.notes) : null,
    include_vat: Boolean(row.include_vat),
    paid_by: paidBy,
    is_reimbursable: Boolean(row.is_reimbursable),
    is_reimbursed: Boolean(row.is_reimbursed),
    contact_id: row.contact_id != null ? Number(row.contact_id) : null,
    payment_plan_id: row.payment_plan_id != null ? Number(row.payment_plan_id) : null,
    legacy_payment_plan_row_id:
      row.legacy_payment_plan_row_id != null ? Number(row.legacy_payment_plan_row_id) : null,
    created_by: row.created_by != null ? String(row.created_by) : null,
    lead_expense_types: typeJoin
      ? {
          id: String(typeJoin.id),
          code: String(typeJoin.code ?? ''),
          label: String(typeJoin.label ?? ''),
        }
      : null,
    accounting_currencies: currencyJoin
      ? {
          id: Number(currencyJoin.id),
          name: String(currencyJoin.name ?? ''),
          iso_code: currencyJoin.iso_code ?? null,
        }
      : null,
    leads_contact: contactJoin
      ? {
          id: Number(contactJoin.id),
          name: contactJoin.name != null ? String(contactJoin.name) : null,
        }
      : null,
  };
}

function normalizePaidFlags(input: {
  paidBy: LeadExpensePaidBy;
  isReimbursable: boolean;
  isReimbursed: boolean;
}): { paid_by: LeadExpensePaidBy; is_reimbursable: boolean; is_reimbursed: boolean } {
  const isReimbursable = Boolean(input.isReimbursable);
  const isReimbursed = Boolean(input.isReimbursed) && isReimbursable;
  return {
    paid_by: input.paidBy === 'firm' ? 'firm' : 'client',
    is_reimbursable: isReimbursable,
    is_reimbursed: isReimbursed,
  };
}

function buildFinanceNotes(params: {
  typeLabel?: string | null;
  paidBy: LeadExpensePaidBy;
  includeVat: boolean;
  notes?: string | null;
}): string {
  const parts: string[] = [];
  if (params.typeLabel?.trim()) parts.push(params.typeLabel.trim());
  parts.push(params.paidBy === 'firm' ? 'Paid by firm' : 'Paid by client');
  parts.push(params.includeVat ? 'With VAT' : 'Without VAT');
  if (params.notes?.trim()) parts.push(params.notes.trim());
  return parts.join('\n');
}

function resolveExpenseVatAmount(params: {
  amount: number;
  includeVat: boolean;
  expenseDate?: string | null;
}): number {
  return calculatePaymentPlanVatAmount(
    params.amount,
    Boolean(params.includeVat),
    params.expenseDate || null,
  );
}

export function dispatchPaymentPlanChanged(leadId: string | number | null | undefined) {
  if (typeof window === 'undefined' || leadId == null) return;
  window.dispatchEvent(
    new CustomEvent('paymentPlan:changed', { detail: { leadId: String(leadId) } }),
  );
}

async function resolveCreatedByDisplayName(): Promise<string> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) return 'System User';
    const { data } = await supabase
      .from('users')
      .select('full_name, first_name, last_name, email')
      .eq('email', user.email)
      .maybeSingle();
    if (!data) return user.email;
    const full = String((data as any).full_name || '').trim();
    if (full) return full;
    const first = String((data as any).first_name || '').trim();
    const last = String((data as any).last_name || '').trim();
    return [first, last].filter(Boolean).join(' ') || user.email;
  } catch {
    return 'System User';
  }
}

async function resolveContactName(contactId: number): Promise<string> {
  const { data, error } = await supabase
    .from('leads_contact')
    .select('id, name')
    .eq('id', contactId)
    .maybeSingle();
  if (error) throw error;
  const name = String(data?.name || '').trim();
  return name || `Contact #${contactId}`;
}

async function resolveExpenseTypeLabel(expenseTypeId: string): Promise<string> {
  const { data, error } = await supabase
    .from('lead_expense_types')
    .select('label')
    .eq('id', expenseTypeId)
    .maybeSingle();
  if (error) throw error;
  return String(data?.label || '').trim() || 'Expense';
}

async function createFinanceExpenseRow(input: {
  identity: LeadFeeIdentity;
  contactId: number;
  contactName: string;
  amount: number;
  currencyId: number | null;
  expenseDate?: string | null;
  includeVat: boolean;
  paidBy: LeadExpensePaidBy;
  notes: string;
}): Promise<{ paymentPlanId: number | null; legacyPaymentPlanRowId: number | null }> {
  const currencyId = resolveCurrencyIdForSave(
    { currency_id: input.currencyId },
    undefined,
  );
  const currency = displaySymbolForPaymentSave(
    { currency_id: currencyId },
    undefined,
  );
  const vatValue = resolveExpenseVatAmount({
    amount: input.amount,
    includeVat: input.includeVat,
    expenseDate: input.expenseDate,
  });
  const expensePaidBy = input.paidBy === 'firm' ? 'firm' : 'client';
  const today = new Date().toISOString().slice(0, 10);

  if (input.identity.leadType === 'legacy' && input.identity.legacyLeadId != null) {
    const paymentId = Date.now() + Math.floor(Math.random() * 1_000_000);
    const payload = {
      id: paymentId,
      cdate: today,
      udate: today,
      date: input.expenseDate || null,
      value: input.amount,
      vat_value: vatValue,
      lead_id: input.identity.legacyLeadId,
      notes: input.notes,
      due_date: null,
      due_percent: '0%',
      order: 99, // Expense
      currency_id: currencyId,
      client_id: input.contactId,
      expense_paid_by: expensePaidBy,
    };
    const { data, error } = await supabase
      .from('finances_paymentplanrow')
      .insert(payload)
      .select('id')
      .single();
    if (error) throw error;
    return {
      paymentPlanId: null,
      legacyPaymentPlanRowId: Number(data.id),
    };
  }

  if (!input.identity.newLeadId) {
    throw new Error('Invalid lead identity for finance expense row');
  }

  const createdBy = await resolveCreatedByDisplayName();
  const payload: Record<string, unknown> = {
    lead_id: input.identity.newLeadId,
    due_percent: 0,
    percent: 0,
    due_date: input.expenseDate || null,
    value: input.amount,
    value_vat: vatValue,
    client_name: input.contactName,
    client_id: input.contactId,
    payment_order: LEAD_EXPENSE_PAYMENT_ORDER,
    notes: input.notes,
    currency,
    currency_id: currencyId,
    created_by: createdBy,
    expense_paid_by: expensePaidBy,
  };

  const { data, error } = await supabase
    .from('payment_plans')
    .insert(payload)
    .select('id')
    .single();
  if (error) throw error;
  return {
    paymentPlanId: Number(data.id),
    legacyPaymentPlanRowId: null,
  };
}

async function updateFinanceExpenseRow(input: {
  identity: LeadFeeIdentity;
  paymentPlanId: number | null;
  legacyPaymentPlanRowId: number | null;
  contactId: number;
  contactName: string;
  amount: number;
  currencyId: number | null;
  expenseDate?: string | null;
  includeVat: boolean;
  paidBy: LeadExpensePaidBy;
  notes: string;
}): Promise<{ paymentPlanId: number | null; legacyPaymentPlanRowId: number | null }> {
  if (
    (input.identity.leadType === 'legacy' && input.legacyPaymentPlanRowId == null) ||
    (input.identity.leadType === 'new' && input.paymentPlanId == null)
  ) {
    return createFinanceExpenseRow(input);
  }

  const currencyId = resolveCurrencyIdForSave(
    { currency_id: input.currencyId },
    undefined,
  );
  const currency = displaySymbolForPaymentSave(
    { currency_id: currencyId },
    undefined,
  );
  const vatValue = resolveExpenseVatAmount({
    amount: input.amount,
    includeVat: input.includeVat,
    expenseDate: input.expenseDate,
  });
  const expensePaidBy = input.paidBy === 'firm' ? 'firm' : 'client';

  if (input.identity.leadType === 'legacy' && input.legacyPaymentPlanRowId != null) {
    const { error } = await supabase
      .from('finances_paymentplanrow')
      .update({
        udate: new Date().toISOString().slice(0, 10),
        date: input.expenseDate || null,
        value: input.amount,
        vat_value: vatValue,
        notes: input.notes,
        order: 99,
        currency_id: currencyId,
        client_id: input.contactId,
        expense_paid_by: expensePaidBy,
      })
      .eq('id', input.legacyPaymentPlanRowId);
    if (error) throw error;
    return {
      paymentPlanId: null,
      legacyPaymentPlanRowId: input.legacyPaymentPlanRowId,
    };
  }

  if (input.paymentPlanId == null) {
    return createFinanceExpenseRow(input);
  }

  const { error } = await supabase
    .from('payment_plans')
    .update({
      due_percent: 0,
      percent: 0,
      due_date: input.expenseDate || null,
      value: input.amount,
      value_vat: vatValue,
      client_name: input.contactName,
      client_id: input.contactId,
      payment_order: LEAD_EXPENSE_PAYMENT_ORDER,
      notes: input.notes,
      currency,
      currency_id: currencyId,
      expense_paid_by: expensePaidBy,
    })
    .eq('id', input.paymentPlanId);
  if (error) throw error;
  return {
    paymentPlanId: input.paymentPlanId,
    legacyPaymentPlanRowId: null,
  };
}

async function deleteFinanceExpenseRow(input: {
  paymentPlanId: number | null;
  legacyPaymentPlanRowId: number | null;
}): Promise<void> {
  if (input.legacyPaymentPlanRowId != null) {
    const { error } = await supabase
      .from('finances_paymentplanrow')
      .delete()
      .eq('id', input.legacyPaymentPlanRowId);
    if (error) throw error;
  }
  if (input.paymentPlanId != null) {
    const { error } = await supabase.from('payment_plans').delete().eq('id', input.paymentPlanId);
    if (error) throw error;
  }
}

export async function fetchLeadExpenseTypes(): Promise<LeadExpenseTypeRow[]> {
  const { data, error } = await supabase
    .from('lead_expense_types')
    .select('id, code, label, sort_order, is_active')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: String(row.id),
    code: String(row.code ?? ''),
    label: String(row.label ?? ''),
    sort_order: Number(row.sort_order) || 0,
    is_active: Boolean(row.is_active),
  }));
}

export async function fetchLeadExpenses(identity: LeadFeeIdentity): Promise<LeadExpenseRow[]> {
  let query = supabase
    .from('lead_expenses')
    .select(EXPENSE_SELECT)
    .order('created_at', { ascending: false });

  if (identity.leadType === 'legacy' && identity.legacyLeadId != null) {
    query = query.eq('legacy_lead_id', identity.legacyLeadId);
  } else if (identity.newLeadId) {
    query = query.eq('new_lead_id', identity.newLeadId);
  } else {
    return [];
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(normalizeExpenseRow);
}

export async function fetchLeadExpenseContacts(
  identity: LeadFeeIdentity,
): Promise<LeadExpenseContactOption[]> {
  let query = supabase.from('lead_leadcontact').select(`
    main,
    contact_id,
    leads_contact!inner ( id, name )
  `);

  if (identity.leadType === 'legacy' && identity.legacyLeadId != null) {
    query = query.eq('lead_id', identity.legacyLeadId);
  } else if (identity.newLeadId) {
    query = query.eq('newlead_id', identity.newLeadId);
  } else {
    return [];
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || [])
    .map((row: any) => {
      const contact = Array.isArray(row.leads_contact) ? row.leads_contact[0] : row.leads_contact;
      const id = Number(contact?.id ?? row.contact_id);
      if (!Number.isFinite(id)) return null;
      return {
        id,
        name: String(contact?.name || '').trim() || `Contact #${id}`,
        isMain: row.main === true || row.main === 'true',
      } satisfies LeadExpenseContactOption;
    })
    .filter((c): c is LeadExpenseContactOption => c != null)
    .sort((a, b) => {
      if (a.isMain && !b.isMain) return -1;
      if (!a.isMain && b.isMain) return 1;
      return a.name.localeCompare(b.name);
    });
}

export async function insertLeadExpense(input: {
  identity: LeadFeeIdentity;
  expenseTypeId: string;
  amount: number;
  currencyId: number | null;
  expenseDate?: string | null;
  notes?: string | null;
  includeVat?: boolean;
  paidBy: LeadExpensePaidBy;
  isReimbursable: boolean;
  isReimbursed: boolean;
  contactId: number;
  createdBy?: string | null;
}): Promise<LeadExpenseRow> {
  if (!Number.isFinite(input.contactId)) {
    throw new Error('Select a related client contact');
  }

  const includeVat = Boolean(input.includeVat);
  const flags = normalizePaidFlags(input);
  const [contactName, typeLabel] = await Promise.all([
    resolveContactName(input.contactId),
    resolveExpenseTypeLabel(input.expenseTypeId),
  ]);
  const financeNotes = buildFinanceNotes({
    typeLabel,
    paidBy: flags.paid_by,
    includeVat,
    notes: input.notes,
  });

  const financeIds = await createFinanceExpenseRow({
    identity: input.identity,
    contactId: input.contactId,
    contactName,
    amount: input.amount,
    currencyId: input.currencyId,
    expenseDate: input.expenseDate,
    includeVat,
    paidBy: flags.paid_by,
    notes: financeNotes,
  });

  const payload = {
    lead_type: input.identity.leadType,
    new_lead_id: input.identity.leadType === 'new' ? input.identity.newLeadId : null,
    legacy_lead_id: input.identity.leadType === 'legacy' ? input.identity.legacyLeadId : null,
    lead_number: input.identity.leadNumber || null,
    expense_type_id: input.expenseTypeId,
    amount: input.amount,
    currency_id: input.currencyId,
    expense_date: input.expenseDate?.trim() || null,
    notes: input.notes?.trim() || null,
    include_vat: includeVat,
    ...flags,
    contact_id: input.contactId,
    payment_plan_id: financeIds.paymentPlanId,
    legacy_payment_plan_row_id: financeIds.legacyPaymentPlanRowId,
    created_by: input.createdBy || null,
    updated_by: input.createdBy || null,
  };

  const { data, error } = await supabase
    .from('lead_expenses')
    .insert(payload)
    .select(EXPENSE_SELECT)
    .single();

  if (error) {
    try {
      await deleteFinanceExpenseRow(financeIds);
    } catch (cleanupErr) {
      console.warn('[leadExpenses] finance row cleanup failed after expense insert error', cleanupErr);
    }
    throw error;
  }

  const leadId =
    input.identity.leadType === 'legacy'
      ? `legacy_${input.identity.legacyLeadId}`
      : input.identity.newLeadId;
  dispatchPaymentPlanChanged(leadId);

  return normalizeExpenseRow(data);
}

export async function updateLeadExpense(input: {
  expenseId: number;
  identity: LeadFeeIdentity;
  expenseTypeId: string;
  amount: number;
  currencyId: number | null;
  expenseDate?: string | null;
  notes?: string | null;
  includeVat?: boolean;
  paidBy: LeadExpensePaidBy;
  isReimbursable: boolean;
  isReimbursed: boolean;
  contactId: number;
  updatedBy?: string | null;
}): Promise<void> {
  if (!Number.isFinite(input.contactId)) {
    throw new Error('Select a related client contact');
  }

  const { data: existing, error: fetchErr } = await supabase
    .from('lead_expenses')
    .select('payment_plan_id, legacy_payment_plan_row_id')
    .eq('id', input.expenseId)
    .single();
  if (fetchErr) throw fetchErr;

  const includeVat = Boolean(input.includeVat);
  const flags = normalizePaidFlags(input);
  const [contactName, typeLabel] = await Promise.all([
    resolveContactName(input.contactId),
    resolveExpenseTypeLabel(input.expenseTypeId),
  ]);
  const financeNotes = buildFinanceNotes({
    typeLabel,
    paidBy: flags.paid_by,
    includeVat,
    notes: input.notes,
  });

  const financeIds = await updateFinanceExpenseRow({
    identity: input.identity,
    paymentPlanId:
      existing?.payment_plan_id != null ? Number(existing.payment_plan_id) : null,
    legacyPaymentPlanRowId:
      existing?.legacy_payment_plan_row_id != null
        ? Number(existing.legacy_payment_plan_row_id)
        : null,
    contactId: input.contactId,
    contactName,
    amount: input.amount,
    currencyId: input.currencyId,
    expenseDate: input.expenseDate,
    includeVat,
    paidBy: flags.paid_by,
    notes: financeNotes,
  });

  const { error } = await supabase
    .from('lead_expenses')
    .update({
      expense_type_id: input.expenseTypeId,
      amount: input.amount,
      currency_id: input.currencyId,
      expense_date: input.expenseDate?.trim() || null,
      notes: input.notes?.trim() || null,
      include_vat: includeVat,
      ...flags,
      contact_id: input.contactId,
      payment_plan_id: financeIds.paymentPlanId,
      legacy_payment_plan_row_id: financeIds.legacyPaymentPlanRowId,
      updated_at: new Date().toISOString(),
      updated_by: input.updatedBy || null,
    })
    .eq('id', input.expenseId);
  if (error) throw error;

  const leadId =
    input.identity.leadType === 'legacy'
      ? `legacy_${input.identity.legacyLeadId}`
      : input.identity.newLeadId;
  dispatchPaymentPlanChanged(leadId);
}

export async function deleteLeadExpense(
  expenseId: number,
  identity?: LeadFeeIdentity | null,
): Promise<void> {
  const { data: existing, error: fetchErr } = await supabase
    .from('lead_expenses')
    .select('payment_plan_id, legacy_payment_plan_row_id, new_lead_id, legacy_lead_id, lead_type')
    .eq('id', expenseId)
    .single();
  if (fetchErr) throw fetchErr;

  const { error } = await supabase.from('lead_expenses').delete().eq('id', expenseId);
  if (error) throw error;

  try {
    await deleteFinanceExpenseRow({
      paymentPlanId:
        existing?.payment_plan_id != null ? Number(existing.payment_plan_id) : null,
      legacyPaymentPlanRowId:
        existing?.legacy_payment_plan_row_id != null
          ? Number(existing.legacy_payment_plan_row_id)
          : null,
    });
  } catch (err) {
    console.warn('[leadExpenses] finance row delete failed after expense delete', err);
  }

  const leadId =
    identity?.leadType === 'legacy'
      ? identity.legacyLeadId != null
        ? `legacy_${identity.legacyLeadId}`
        : null
      : identity?.newLeadId ||
        (existing?.new_lead_id != null
          ? String(existing.new_lead_id)
          : existing?.legacy_lead_id != null
            ? `legacy_${existing.legacy_lead_id}`
            : null);
  dispatchPaymentPlanChanged(leadId);
}

export function sumLeadExpenseAmounts(
  expenses: Array<{ amount?: number | string | null }>,
): number {
  return expenses.reduce((sum, row) => {
    const n = Number(row.amount ?? 0);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

export function paidByLabel(paidBy: LeadExpensePaidBy): string {
  return paidBy === 'client' ? 'Paid by client' : 'Paid by firm';
}

/** Firm-paid expenses reduce lead total value; client-paid do not (and never inflate contract total). */
export function expenseReducesLeadTotal(paidBy: LeadExpensePaidBy | string | null | undefined): boolean {
  return String(paidBy || '').toLowerCase() === 'firm';
}

/** Amount to subtract from lead total for one expense row (amount + VAT when include_vat). */
export function leadExpenseReductionAmount(row: {
  amount?: number | string | null;
  include_vat?: boolean | null;
  expense_date?: string | null;
  paid_by?: LeadExpensePaidBy | string | null;
}): number {
  if (!expenseReducesLeadTotal(row.paid_by)) return 0;
  const amount = Number(row.amount) || 0;
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const vat = resolveExpenseVatAmount({
    amount,
    includeVat: Boolean(row.include_vat),
    expenseDate: row.expense_date,
  });
  return Math.round((amount + vat) * 100) / 100;
}

/** Sum of firm-paid expenses that should reduce lead total value. */
export async function fetchFirmPaidExpenseReductionTotal(
  identity: LeadFeeIdentity,
): Promise<number> {
  let query = supabase
    .from('lead_expenses')
    .select('amount, include_vat, expense_date, paid_by')
    .eq('paid_by', 'firm');

  if (identity.leadType === 'legacy' && identity.legacyLeadId != null) {
    query = query.eq('legacy_lead_id', identity.legacyLeadId);
  } else if (identity.newLeadId) {
    query = query.eq('new_lead_id', identity.newLeadId);
  } else {
    return 0;
  }

  const { data, error } = await query;
  if (error) throw error;
  return Math.round(
    (data || []).reduce((sum, row) => sum + leadExpenseReductionAmount(row as any), 0) * 100,
  ) / 100;
}

/** Payment-plan row helper: firm-paid Expense rows reduce lead total; client-paid do not. */
export function isFirmPaidExpensePlanRow(row: {
  order?: string | number | null;
  payment_order?: string | number | null;
  expense_paid_by?: string | null;
  expensePaidBy?: string | null;
}): boolean {
  const order = row.payment_order ?? row.order;
  if (!isExpenseNoVatPayment(order)) return false;
  const paidBy = row.expense_paid_by ?? row.expensePaidBy;
  return expenseReducesLeadTotal(paidBy);
}
