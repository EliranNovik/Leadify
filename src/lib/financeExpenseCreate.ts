import { supabase } from './supabase';
import {
  dispatchPaymentPlanChanged,
  insertLeadExpense,
  updateLeadExpense,
  deleteLeadExpense,
  type LeadExpensePaidBy,
} from './leadExpenses';
import {
  insertLeadSubcontractorFee,
  updateLeadSubcontractorFee,
  deleteLeadSubcontractorFee,
  type LeadFeeIdentity,
} from './leadSubcontractorFees';
import { FIRM_MANAGEMENT_DEFAULT_CURRENCY, toBillingMonthStart } from './firmManagementCosts';
import {
  fetchFinanceExpenseDocumentsForEntries,
  deleteFinanceExpenseDocumentsForEntry,
  type FinanceExpenseDocumentRow,
} from './financeExpenseDocuments';
import { resolveEmployeePhotoUrl } from './employeePhotoUrl';

export type FinanceExpenseKind = 'lead' | 'subcontractor' | 'other_firm' | 'office' | 'marketing';

export const FINANCE_EXPENSE_KIND_LABEL: Record<FinanceExpenseKind, string> = {
  lead: 'Client',
  subcontractor: 'Subcontractor',
  other_firm: 'Other firm',
  office: 'Office',
  marketing: 'Marketing',
};

export type FinanceExpenseEntryRow = {
  id: number;
  listKey: string;
  created_at: string;
  kind: FinanceExpenseKind;
  destination_table: string;
  destination_id: string;
  expense_date: string | null;
  amount: number;
  currency_code: string | null;
  firm_id: string | null;
  new_lead_id: string | null;
  legacy_lead_id: number | null;
  category_label: string | null;
  vendor_label: string | null;
  lead_number: string | null;
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_by_photo: string | null;
  documents: FinanceExpenseDocumentRow[];
};

export type FinanceExpenseListFilters = {
  kind?: FinanceExpenseKind | '';
  search?: string;
  dateFrom?: string;
  dateTo?: string;
};

const KIND_TABLE: Record<FinanceExpenseKind, string> = {
  lead: 'lead_expenses',
  subcontractor: 'lead_subcontractor_fees',
  other_firm: 'firm_management_costs',
  office: 'office_expenses',
  marketing: 'source_media_expense',
};

function monthStart(value: string): string {
  const fromLib = toBillingMonthStart(value);
  if (fromLib) return fromLib;
  const s = value.trim().slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (!m) throw new Error('Enter a valid month');
  return `${m[1]}-${m[2]}-01`;
}

async function currentAuthUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

async function upsertRegistry(row: {
  kind: FinanceExpenseKind;
  destinationId: string | number;
  expenseDate: string | null;
  amount: number;
  currencyCode: string | null;
  firmId?: string | null;
  newLeadId?: string | null;
  legacyLeadId?: number | null;
  categoryLabel?: string | null;
  vendorLabel?: string | null;
  notes?: string | null;
}): Promise<number | null> {
  const createdBy = await currentAuthUserId();
  const payload = {
    kind: row.kind,
    destination_table: KIND_TABLE[row.kind],
    destination_id: String(row.destinationId),
    expense_date: row.expenseDate,
    amount: row.amount,
    currency_code: row.currencyCode,
    firm_id: row.firmId || null,
    new_lead_id: row.newLeadId || null,
    legacy_lead_id: row.legacyLeadId ?? null,
    category_label: row.categoryLabel || null,
    vendor_label: row.vendorLabel || null,
    notes: row.notes || null,
    created_by: createdBy,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('finance_expense_entries')
    .upsert(payload, { onConflict: 'destination_table,destination_id' })
    .select('id')
    .maybeSingle();
  if (error) {
    console.warn('[financeExpenseCreate] registry upsert failed:', error.message || error);
    return null;
  }
  return data?.id != null ? Number(data.id) : null;
}

export type CreateFinanceExpenseResult = {
  destinationId: string;
  entryId: number | null;
  updated?: boolean;
  needsConfirm?: boolean;
  existingAmount?: number;
};

export type CreateLeadFinanceExpenseInput = {
  identity: LeadFeeIdentity;
  expenseTypeId: string;
  expenseTypeLabel: string;
  amount: number;
  currencyId: number | null;
  currencyCode: string | null;
  expenseDate: string | null;
  notes?: string | null;
  includeVat?: boolean;
  paidBy: LeadExpensePaidBy;
  contactId: number;
  vendorLabel?: string | null;
};

export async function createLeadFinanceExpense(input: CreateLeadFinanceExpenseInput) {
  const createdBy = await currentAuthUserId();
  const row = await insertLeadExpense({
    identity: input.identity,
    expenseTypeId: input.expenseTypeId,
    amount: input.amount,
    currencyId: input.currencyId,
    expenseDate: input.expenseDate,
    notes: input.notes,
    includeVat: input.includeVat,
    paidBy: input.paidBy,
    isReimbursable: false,
    isReimbursed: false,
    contactId: input.contactId,
    createdBy,
  });
  const entryId = await upsertRegistry({
    kind: 'lead',
    destinationId: row.id,
    expenseDate: input.expenseDate,
    amount: input.amount,
    currencyCode: input.currencyCode,
    newLeadId: input.identity.leadType === 'new' ? input.identity.newLeadId : null,
    legacyLeadId: input.identity.leadType === 'legacy' ? input.identity.legacyLeadId : null,
    categoryLabel: input.expenseTypeLabel,
    vendorLabel: input.vendorLabel || null,
    notes: input.notes || null,
  });
  return { destinationId: String(row.id), entryId, updated: false };
}

export type CreateSubcontractorFinanceExpenseInput = {
  identity: LeadFeeIdentity;
  firmId: string;
  firmName: string;
  amount: number;
  currencyId: number | null;
  currencyCode: string | null;
  notes?: string | null;
  expenseDate?: string | null;
};

export async function createSubcontractorFinanceExpense(input: CreateSubcontractorFinanceExpenseInput) {
  const createdBy = await currentAuthUserId();
  const row = await insertLeadSubcontractorFee({
    identity: input.identity,
    firmId: input.firmId,
    amount: input.amount,
    currencyId: input.currencyId,
    notes: input.notes,
    createdBy,
  });
  const entryId = await upsertRegistry({
    kind: 'subcontractor',
    destinationId: row.id,
    expenseDate: input.expenseDate || row.created_at.slice(0, 10),
    amount: input.amount,
    currencyCode: input.currencyCode,
    firmId: input.firmId,
    newLeadId: input.identity.leadType === 'new' ? input.identity.newLeadId : null,
    legacyLeadId: input.identity.leadType === 'legacy' ? input.identity.legacyLeadId : null,
    categoryLabel: 'Subcontractor fee',
    vendorLabel: input.firmName,
    notes: input.notes || null,
  });
  return { destinationId: String(row.id), entryId, updated: false };
}

export type CreateOtherFirmFinanceExpenseInput = {
  firmId: string;
  firmName: string;
  billingMonth: string;
  amount: number;
  currencyCode?: string | null;
  expenseTypeId: string;
  expenseTypeLabel: string;
  notes?: string | null;
};

export async function createOtherFirmFinanceExpense(input: CreateOtherFirmFinanceExpenseInput) {
  const billing_month = monthStart(input.billingMonth);
  const currency = (input.currencyCode || FIRM_MANAGEMENT_DEFAULT_CURRENCY).trim() || 'ILS';
  const { data, error } = await supabase
    .from('firm_management_costs')
    .insert({
      firm_id: input.firmId,
      billing_month,
      amount: input.amount,
      currency,
      notes: input.notes?.trim() || null,
      expense_type_id: input.expenseTypeId,
    })
    .select('id')
    .single();
  if (error) throw error;
  const entryId = await upsertRegistry({
    kind: 'other_firm',
    destinationId: data.id,
    expenseDate: billing_month,
    amount: input.amount,
    currencyCode: currency,
    firmId: input.firmId,
    categoryLabel: input.expenseTypeLabel,
    vendorLabel: input.firmName,
    notes: input.notes || null,
  });
  return { destinationId: String(data.id), entryId, updated: false };
}

export type CreateOfficeFinanceExpenseInput = {
  firmId: string;
  firmName: string;
  amount: number;
  currencyCode?: string | null;
  expenseTypeId: string;
  expenseTypeLabel: string;
  description?: string | null;
  paid?: boolean;
  paidAt?: string | null;
  expenseDate?: string | null;
};

export async function createOfficeFinanceExpense(input: CreateOfficeFinanceExpenseInput) {
  const currency = (input.currencyCode || FIRM_MANAGEMENT_DEFAULT_CURRENCY).trim() || 'ILS';
  const paid = Boolean(input.paid);
  const paidAt = paid ? input.paidAt || new Date().toISOString().slice(0, 10) : null;
  const createdBy = await currentAuthUserId();
  const { data, error } = await supabase
    .from('office_expenses')
    .insert({
      firm_id: input.firmId,
      amount: input.amount,
      currency,
      expense_type_id: input.expenseTypeId,
      description: input.description?.trim() || null,
      paid,
      paid_at: paidAt,
      created_by: createdBy,
    })
    .select('id')
    .single();
  if (error) throw error;
  const entryId = await upsertRegistry({
    kind: 'office',
    destinationId: data.id,
    expenseDate: input.expenseDate || paidAt || new Date().toISOString().slice(0, 10),
    amount: input.amount,
    currencyCode: currency,
    firmId: input.firmId,
    categoryLabel: input.expenseTypeLabel,
    vendorLabel: input.firmName,
    notes: input.description || null,
  });
  return { destinationId: String(data.id), entryId, updated: false };
}

export type CreateMarketingFinanceExpenseInput = {
  leadSourceId: number;
  leadSourceName: string;
  expenseMonth: string;
  amount: number;
  confirmUpdate?: boolean;
};

export async function findMarketingSourceMonthExpense(leadSourceId: number, expenseMonth: string) {
  const expense_month = monthStart(expenseMonth);
  const { data, error } = await supabase
    .from('source_media_expense')
    .select('id, amount')
    .eq('lead_source_id', leadSourceId)
    .eq('expense_month', expense_month)
    .maybeSingle();
  if (error) throw error;
  return data
    ? { id: Number(data.id), amount: Number(data.amount) || 0, expenseMonth: expense_month }
    : null;
}

export async function createMarketingFinanceExpense(input: CreateMarketingFinanceExpenseInput) {
  const expense_month = monthStart(input.expenseMonth);
  const existing = await findMarketingSourceMonthExpense(input.leadSourceId, expense_month);
  const createdBy = await currentAuthUserId();

  if (existing) {
    if (!input.confirmUpdate) {
      return {
        destinationId: String(existing.id),
        entryId: null,
        updated: false,
        needsConfirm: true,
        existingAmount: existing.amount,
      };
    }
    const { error } = await supabase
      .from('source_media_expense')
      .update({ amount: input.amount })
      .eq('id', existing.id);
    if (error) throw error;
    const entryId = await upsertRegistry({
      kind: 'marketing',
      destinationId: existing.id,
      expenseDate: expense_month,
      amount: input.amount,
      currencyCode: 'ILS',
      categoryLabel: 'Source media',
      vendorLabel: input.leadSourceName,
    });
    return { destinationId: String(existing.id), entryId, updated: true, needsConfirm: false };
  }

  const { data, error } = await supabase
    .from('source_media_expense')
    .insert({
      lead_source_id: input.leadSourceId,
      expense_month,
      amount: input.amount,
      created_by: createdBy,
    })
    .select('id')
    .single();
  if (error) throw error;
  const entryId = await upsertRegistry({
    kind: 'marketing',
    destinationId: data.id,
    expenseDate: expense_month,
    amount: input.amount,
    currencyCode: 'ILS',
    categoryLabel: 'Source media',
    vendorLabel: input.leadSourceName,
  });
  return { destinationId: String(data.id), entryId, updated: false, needsConfirm: false };
}

export async function ensureFinanceExpenseRegistry(row: FinanceExpenseEntryRow): Promise<number> {
  if (Number.isFinite(row.id) && row.id > 0) return row.id;
  const id = await upsertRegistry({
    kind: row.kind,
    destinationId: row.destination_id,
    expenseDate: row.expense_date,
    amount: row.amount,
    currencyCode: row.currency_code,
    firmId: row.firm_id,
    newLeadId: row.new_lead_id,
    legacyLeadId: row.legacy_lead_id,
    categoryLabel: row.category_label,
    vendorLabel: row.vendor_label,
    notes: row.notes,
  });
  if (!id) throw new Error('Could not attach documents. Run the finance expense SQL.');
  return id;
}

export async function ensureRegistryForKindDestination(input: {
  kind: 'lead' | 'subcontractor';
  destinationId: string | number;
  expenseDate?: string | null;
  amount?: number;
  currencyCode?: string | null;
  firmId?: string | null;
  newLeadId?: string | null;
  legacyLeadId?: number | null;
  categoryLabel?: string | null;
  vendorLabel?: string | null;
  notes?: string | null;
}): Promise<number> {
  const id = await upsertRegistry({
    kind: input.kind,
    destinationId: input.destinationId,
    expenseDate: input.expenseDate || null,
    amount: input.amount || 0,
    currencyCode: input.currencyCode || null,
    firmId: input.firmId,
    newLeadId: input.newLeadId,
    legacyLeadId: input.legacyLeadId,
    categoryLabel: input.categoryLabel,
    vendorLabel: input.vendorLabel,
    notes: input.notes,
  });
  if (!id) throw new Error('Could not attach documents. Run the finance expense SQL.');
  return id;
}

export async function fetchFinanceDocsByDestinationIds(
  destinationTable: string,
  destinationIds: Array<string | number>,
): Promise<Map<string, { entryId: number; documents: FinanceExpenseDocumentRow[] }>> {
  const map = new Map<string, { entryId: number; documents: FinanceExpenseDocumentRow[] }>();
  const ids = [...new Set(destinationIds.map((id) => String(id)).filter(Boolean))];
  if (!ids.length) return map;
  const { data, error } = await supabase
    .from('finance_expense_entries')
    .select('id, destination_id')
    .eq('destination_table', destinationTable)
    .in('destination_id', ids);
  if (error || !data?.length) return map;
  const entryIds = data.map((row: any) => Number(row.id)).filter((n) => Number.isFinite(n) && n > 0);
  const docsMap = await fetchFinanceExpenseDocumentsForEntries(entryIds);
  data.forEach((row: any) => {
    const dest = String(row.destination_id);
    const entryId = Number(row.id);
    map.set(dest, { entryId, documents: docsMap.get(entryId) || [] });
  });
  return map;
}

export type FinanceExpenseEditDetails = {
  amount: number;
  notes: string;
  expenseDate: string | null;
  month: string | null;
  firmId: string | null;
  expenseTypeId: string | null;
  currencyId: number | null;
  currencyCode: string | null;
  contactId: number | null;
  paidBy: LeadExpensePaidBy;
  includeVat: boolean;
  paid: boolean;
  paidAt: string | null;
  leadSourceId: number | null;
  leadType: 'new' | 'legacy' | null;
  newLeadId: string | null;
  legacyLeadId: number | null;
  leadNumber: string | null;
  clientName: string | null;
};

export async function fetchFinanceExpenseEditDetails(
  row: FinanceExpenseEntryRow,
): Promise<FinanceExpenseEditDetails> {
  const base: FinanceExpenseEditDetails = {
    amount: row.amount,
    notes: row.notes || '',
    expenseDate: row.expense_date,
    month: row.expense_date ? String(row.expense_date).slice(0, 7) : null,
    firmId: row.firm_id,
    expenseTypeId: null,
    currencyId: null,
    currencyCode: row.currency_code,
    contactId: null,
    paidBy: 'client',
    includeVat: false,
    paid: false,
    paidAt: null,
    leadSourceId: null,
    leadType: row.legacy_lead_id != null ? 'legacy' : row.new_lead_id ? 'new' : null,
    newLeadId: row.new_lead_id,
    legacyLeadId: row.legacy_lead_id,
    leadNumber: row.lead_number,
    clientName: row.kind === 'lead' ? row.vendor_label : null,
  };

  if (row.kind === 'lead') {
    const { data, error } = await supabase
      .from('lead_expenses')
      .select(
        'amount, notes, expense_date, expense_type_id, currency_id, contact_id, paid_by, include_vat, lead_number, new_lead_id, legacy_lead_id, leads_contact:contact_id ( name )',
      )
      .eq('id', row.destination_id)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      const contact = Array.isArray(data.leads_contact) ? data.leads_contact[0] : data.leads_contact;
      base.amount = Number(data.amount) || 0;
      base.notes = data.notes != null ? String(data.notes) : '';
      base.expenseDate = data.expense_date ? String(data.expense_date).slice(0, 10) : row.expense_date;
      base.expenseTypeId = data.expense_type_id != null ? String(data.expense_type_id) : null;
      base.currencyId = data.currency_id != null ? Number(data.currency_id) : null;
      base.contactId = data.contact_id != null ? Number(data.contact_id) : null;
      base.paidBy = data.paid_by === 'firm' ? 'firm' : 'client';
      base.includeVat = Boolean(data.include_vat);
      base.newLeadId = data.new_lead_id != null ? String(data.new_lead_id) : row.new_lead_id;
      base.legacyLeadId = data.legacy_lead_id != null ? Number(data.legacy_lead_id) : row.legacy_lead_id;
      base.leadNumber = data.lead_number != null ? String(data.lead_number) : row.lead_number;
      base.clientName = contact?.name != null ? String(contact.name) : row.vendor_label;
      base.leadType = base.legacyLeadId != null ? 'legacy' : 'new';
    }
  } else if (row.kind === 'subcontractor') {
    const { data, error } = await supabase
      .from('lead_subcontractor_fees')
      .select('amount, notes, firm_id, currency_id, lead_number, new_lead_id, legacy_lead_id')
      .eq('id', row.destination_id)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      base.amount = Number(data.amount) || 0;
      base.notes = data.notes != null ? String(data.notes) : '';
      base.firmId = data.firm_id != null ? String(data.firm_id) : row.firm_id;
      base.currencyId = data.currency_id != null ? Number(data.currency_id) : null;
      base.newLeadId = data.new_lead_id != null ? String(data.new_lead_id) : row.new_lead_id;
      base.legacyLeadId = data.legacy_lead_id != null ? Number(data.legacy_lead_id) : row.legacy_lead_id;
      base.leadNumber = data.lead_number != null ? String(data.lead_number) : row.lead_number;
      base.leadType = base.legacyLeadId != null ? 'legacy' : 'new';
    }
  } else if (row.kind === 'other_firm') {
    const { data, error } = await supabase
      .from('firm_management_costs')
      .select('amount, notes, firm_id, currency, billing_month, expense_type_id')
      .eq('id', row.destination_id)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      base.amount = Number(data.amount) || 0;
      base.notes = data.notes != null ? String(data.notes) : '';
      base.firmId = data.firm_id != null ? String(data.firm_id) : row.firm_id;
      base.currencyCode = data.currency != null ? String(data.currency) : row.currency_code;
      base.month = data.billing_month ? String(data.billing_month).slice(0, 7) : base.month;
      base.expenseTypeId = data.expense_type_id != null ? String(data.expense_type_id) : null;
    }
  } else if (row.kind === 'office') {
    const { data, error } = await supabase
      .from('office_expenses')
      .select('amount, description, firm_id, currency, expense_type_id, paid, paid_at')
      .eq('id', row.destination_id)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      base.amount = Number(data.amount) || 0;
      base.notes = data.description != null ? String(data.description) : '';
      base.firmId = data.firm_id != null ? String(data.firm_id) : row.firm_id;
      base.currencyCode = data.currency != null ? String(data.currency) : row.currency_code;
      base.expenseTypeId = data.expense_type_id != null ? String(data.expense_type_id) : null;
      base.paid = Boolean(data.paid);
      base.paidAt = data.paid_at ? String(data.paid_at).slice(0, 10) : null;
    }
  } else if (row.kind === 'marketing') {
    const { data, error } = await supabase
      .from('source_media_expense')
      .select('amount, expense_month, lead_source_id')
      .eq('id', row.destination_id)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      base.amount = Number(data.amount) || 0;
      base.month = data.expense_month ? String(data.expense_month).slice(0, 7) : base.month;
      base.leadSourceId = data.lead_source_id != null ? Number(data.lead_source_id) : null;
    }
  }
  return base;
}

export async function updateFinanceExpense(input: {
  row: FinanceExpenseEntryRow;
  identity?: LeadFeeIdentity | null;
  expenseTypeId?: string | null;
  expenseTypeLabel?: string | null;
  amount: number;
  currencyId?: number | null;
  currencyCode?: string | null;
  expenseDate?: string | null;
  month?: string | null;
  notes?: string | null;
  includeVat?: boolean;
  paidBy?: LeadExpensePaidBy;
  contactId?: number | null;
  firmId?: string | null;
  firmName?: string | null;
  paid?: boolean;
  paidAt?: string | null;
  leadSourceId?: number | null;
  leadSourceName?: string | null;
  vendorLabel?: string | null;
}): Promise<void> {
  const row = input.row;
  const updatedBy = await currentAuthUserId();
  if (row.kind === 'lead') {
    if (!input.identity) throw new Error('Choose a lead');
    if (!input.expenseTypeId) throw new Error('Choose an expense type');
    if (input.contactId == null || !Number.isFinite(input.contactId)) throw new Error('Choose a related contact');
    await updateLeadExpense({
      expenseId: Number(row.destination_id),
      identity: input.identity,
      expenseTypeId: input.expenseTypeId,
      amount: input.amount,
      currencyId: input.currencyId ?? null,
      expenseDate: input.expenseDate,
      notes: input.notes,
      includeVat: input.includeVat,
      paidBy: input.paidBy || 'client',
      isReimbursable: false,
      isReimbursed: false,
      contactId: input.contactId,
      updatedBy,
    });
    await upsertRegistry({
      kind: 'lead',
      destinationId: row.destination_id,
      expenseDate: input.expenseDate || null,
      amount: input.amount,
      currencyCode: input.currencyCode || null,
      newLeadId: input.identity.leadType === 'new' ? input.identity.newLeadId : null,
      legacyLeadId: input.identity.leadType === 'legacy' ? input.identity.legacyLeadId : null,
      categoryLabel: input.expenseTypeLabel,
      vendorLabel: input.vendorLabel || null,
      notes: input.notes,
    });
    return;
  }
  if (row.kind === 'subcontractor') {
    if (!input.identity) throw new Error('Choose a lead');
    if (!input.firmId) throw new Error('Choose a firm');
    await updateLeadSubcontractorFee({
      feeId: Number(row.destination_id),
      firmId: input.firmId,
      amount: input.amount,
      currencyId: input.currencyId ?? null,
      notes: input.notes,
      updatedBy,
    });
    await upsertRegistry({
      kind: 'subcontractor',
      destinationId: row.destination_id,
      expenseDate: input.expenseDate || row.expense_date,
      amount: input.amount,
      currencyCode: input.currencyCode || null,
      firmId: input.firmId,
      newLeadId: input.identity.leadType === 'new' ? input.identity.newLeadId : null,
      legacyLeadId: input.identity.leadType === 'legacy' ? input.identity.legacyLeadId : null,
      categoryLabel: 'Subcontractor fee',
      vendorLabel: input.firmName,
      notes: input.notes,
    });
    return;
  }
  if (row.kind === 'other_firm') {
    if (!input.firmId || !input.expenseTypeId) throw new Error('Choose a firm and category');
    const billing_month = monthStart(input.month || input.expenseDate || '');
    const currency = (input.currencyCode || FIRM_MANAGEMENT_DEFAULT_CURRENCY).trim() || 'ILS';
    const { error } = await supabase
      .from('firm_management_costs')
      .update({
        firm_id: input.firmId,
        billing_month,
        amount: input.amount,
        currency,
        notes: input.notes?.trim() || null,
        expense_type_id: input.expenseTypeId,
      })
      .eq('id', row.destination_id);
    if (error) throw error;
    await upsertRegistry({
      kind: 'other_firm',
      destinationId: row.destination_id,
      expenseDate: billing_month,
      amount: input.amount,
      currencyCode: currency,
      firmId: input.firmId,
      categoryLabel: input.expenseTypeLabel,
      vendorLabel: input.firmName,
      notes: input.notes,
    });
    return;
  }
  if (row.kind === 'office') {
    if (!input.firmId || !input.expenseTypeId) throw new Error('Choose a firm and category');
    const currency = (input.currencyCode || FIRM_MANAGEMENT_DEFAULT_CURRENCY).trim() || 'ILS';
    const paid = Boolean(input.paid);
    const paidAt = paid ? input.paidAt || input.expenseDate || null : null;
    const { error } = await supabase
      .from('office_expenses')
      .update({
        firm_id: input.firmId,
        amount: input.amount,
        currency,
        expense_type_id: input.expenseTypeId,
        description: input.notes?.trim() || null,
        paid,
        paid_at: paidAt,
      })
      .eq('id', row.destination_id);
    if (error) throw error;
    await upsertRegistry({
      kind: 'office',
      destinationId: row.destination_id,
      expenseDate: input.expenseDate || paidAt,
      amount: input.amount,
      currencyCode: currency,
      firmId: input.firmId,
      categoryLabel: input.expenseTypeLabel,
      vendorLabel: input.firmName,
      notes: input.notes,
    });
    return;
  }
  if (!input.leadSourceId) throw new Error('Choose a lead source');
  const expense_month = monthStart(input.month || '');
  const { error } = await supabase
    .from('source_media_expense')
    .update({
      lead_source_id: input.leadSourceId,
      expense_month,
      amount: input.amount,
    })
    .eq('id', row.destination_id);
  if (error) throw error;
  await upsertRegistry({
    kind: 'marketing',
    destinationId: row.destination_id,
    expenseDate: expense_month,
    amount: input.amount,
    currencyCode: 'ILS',
    categoryLabel: 'Source media',
    vendorLabel: input.leadSourceName,
  });
}

export async function deleteFinanceExpense(row: FinanceExpenseEntryRow): Promise<void> {
  if (row.kind === 'lead') {
    await deleteLeadExpense(Number(row.destination_id));
  } else if (row.kind === 'subcontractor') {
    await deleteLeadSubcontractorFee(Number(row.destination_id));
  } else if (row.kind === 'other_firm') {
    const { error } = await supabase.from('firm_management_costs').delete().eq('id', row.destination_id);
    if (error) throw error;
  } else if (row.kind === 'office') {
    const { error } = await supabase.from('office_expenses').delete().eq('id', row.destination_id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('source_media_expense').delete().eq('id', row.destination_id);
    if (error) throw error;
  }
  if (row.id > 0) {
    await deleteFinanceExpenseDocumentsForEntry(row.id);
    await supabase.from('finance_expense_entries').delete().eq('id', row.id);
  } else {
    await supabase
      .from('finance_expense_entries')
      .delete()
      .eq('destination_table', row.destination_table)
      .eq('destination_id', row.destination_id);
  }
}

function shiftDateIso(dateIso: string, days: number): string {
  const dt = new Date(`${dateIso.slice(0, 10)}T12:00:00`);
  dt.setDate(dt.getDate() + days);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function localYmdFromTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function rowInDateRange(row: FinanceExpenseEntryRow, from: string, to: string): boolean {
  if (!from && !to) return true;
  const days = [localYmdFromTimestamp(row.expense_date), localYmdFromTimestamp(row.created_at)];
  return days.some((day) => Boolean(day && (!from || day >= from) && (!to || day <= to)));
}

function joinLabel(value: unknown, field: string): string | null {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  const raw = row?.[field];
  return raw != null && String(raw).trim() ? String(raw).trim() : null;
}

function isoFromCurrencyJoin(value: unknown): string | null {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  const iso = row?.iso_code != null ? String(row.iso_code).trim() : '';
  if (iso) return iso.toUpperCase();
  const name = row?.name != null ? String(row.name).trim() : '';
  return name || null;
}

function emptyEntry(partial: Omit<FinanceExpenseEntryRow, 'documents' | 'listKey' | 'created_by_name' | 'created_by_photo' | 'lead_number'> & {
  listKey?: string;
  created_by_name?: string | null;
  created_by_photo?: string | null;
  documents?: FinanceExpenseDocumentRow[];
  lead_number?: string | null;
}): FinanceExpenseEntryRow {
  const leadNumber = partial.lead_number != null ? String(partial.lead_number).trim() : '';
  return {
    ...partial,
    listKey: partial.listKey || `${partial.kind}:${partial.destination_id}`,
    lead_number: leadNumber || null,
    created_by_name: partial.created_by_name ?? null,
    created_by_photo: partial.created_by_photo ?? null,
    documents: partial.documents || [],
  };
}

async function resolveCreators(
  authIds: string[],
): Promise<Map<string, { name: string; photoUrl: string | null }>> {
  const byAuth = new Map<string, { name: string; photoUrl: string | null }>();
  const ids = [...new Set(authIds.filter(Boolean))];
  if (!ids.length) return byAuth;

  const mapRows = (users: any[]) => {
    users.forEach((u: any) => {
      const empRaw = u.tenants_employee;
      const emp = Array.isArray(empRaw) ? empRaw[0] : empRaw;
      const display = String(emp?.display_name || '').trim();
      const full = String(u.full_name || '').trim();
      const firstLast = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
      const name = display || full || firstLast || String(u.email || '').trim() || '—';
      byAuth.set(String(u.auth_id), {
        name,
        photoUrl: resolveEmployeePhotoUrl(emp?.photo_url, emp?.photo),
      });
    });
  };

  const withPhoto = await supabase
    .from('users')
    .select(
      'auth_id, full_name, first_name, last_name, email, tenants_employee!employee_id(display_name, photo_url, photo)',
    )
    .in('auth_id', ids);
  if (!withPhoto.error) {
    mapRows(withPhoto.data || []);
    return byAuth;
  }

  const fallback = await supabase
    .from('users')
    .select('auth_id, full_name, first_name, last_name, email')
    .in('auth_id', ids);
  if (fallback.error) {
    console.warn('[fetchFinanceExpenseEntries] creators:', fallback.error);
    return byAuth;
  }
  mapRows(fallback.data || []);
  return byAuth;
}

function matchesSearch(row: FinanceExpenseEntryRow, search: string): boolean {
  if (!search) return true;
  const q = search.toLowerCase();
  return [row.vendor_label, row.lead_number, row.category_label, row.notes, row.created_by_name]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(q));
}

export async function fetchFinanceExpenseEntries(
  filters: FinanceExpenseListFilters = {},
): Promise<FinanceExpenseEntryRow[]> {
  const from = filters.dateFrom?.trim() || '';
  const to = filters.dateTo?.trim() || from;
  const kindFilter = filters.kind || '';
  const include = (k: FinanceExpenseKind) => !kindFilter || kindFilter === k;

  // Widen created_at by a day so Israel-local "today" is not clipped by UTC midnight.
  const fetchFrom = from ? shiftDateIso(from, -1) : '';
  const fetchToExclusive = to ? shiftDateIso(to, 1) : '';

  const dateOrCreated = (dateCol: string) => {
    if (!from && !to) return null;
    const parts: string[] = [];
    if (from && to) {
      parts.push(`and(${dateCol}.gte.${from},${dateCol}.lte.${to})`);
      parts.push(`and(created_at.gte.${fetchFrom},created_at.lt.${fetchToExclusive})`);
    } else if (from) {
      parts.push(`${dateCol}.gte.${from}`);
      parts.push(`created_at.gte.${fetchFrom}`);
    } else {
      parts.push(`${dateCol}.lte.${to}`);
      parts.push(`created_at.lt.${fetchToExclusive}`);
    }
    return parts.join(',');
  };

  const applyCreatedAt = (q: any) => {
    if (fetchFrom) q = q.gte('created_at', fetchFrom);
    if (fetchToExclusive) q = q.lt('created_at', fetchToExclusive);
    return q;
  };

  const safeTable = async (
    label: string,
    run: () => Promise<FinanceExpenseEntryRow[]>,
  ): Promise<FinanceExpenseEntryRow[]> => {
    try {
      return await run();
    } catch (err) {
      console.warn(`[fetchFinanceExpenseEntries] ${label}:`, err);
      return [];
    }
  };

  const tasks: Array<Promise<FinanceExpenseEntryRow[]>> = [];

  if (include('lead')) {
    tasks.push(
      safeTable('lead_expenses', async () => {
        let q = supabase
          .from('lead_expenses')
          .select(
            'id, created_at, created_by, amount, expense_date, notes, lead_number, new_lead_id, legacy_lead_id, lead_expense_types:expense_type_id ( label ), accounting_currencies:currency_id ( name, iso_code ), leads_contact:contact_id ( name )',
          )
          .order('created_at', { ascending: false })
          .limit(300);
        const orExpr = dateOrCreated('expense_date');
        if (orExpr) q = q.or(orExpr);
        const { data, error } = await q;
        if (error) throw error;
        return (data || []).map((row: any) =>
          emptyEntry({
            id: Number(row.id),
            created_at: String(row.created_at),
            kind: 'lead',
            destination_table: 'lead_expenses',
            destination_id: String(row.id),
            expense_date: row.expense_date
              ? String(row.expense_date).slice(0, 10)
              : localYmdFromTimestamp(row.created_at),
            amount: Number(row.amount) || 0,
            currency_code: isoFromCurrencyJoin(row.accounting_currencies),
            firm_id: null,
            new_lead_id: row.new_lead_id != null ? String(row.new_lead_id) : null,
            legacy_lead_id: row.legacy_lead_id != null ? Number(row.legacy_lead_id) : null,
            category_label: joinLabel(row.lead_expense_types, 'label'),
            vendor_label: joinLabel(row.leads_contact, 'name'),
            lead_number: row.lead_number != null ? String(row.lead_number) : null,
            notes: row.notes != null ? String(row.notes) : null,
            created_by: row.created_by != null ? String(row.created_by) : null,
          }),
        );
      }),
    );
  }

  if (include('subcontractor')) {
    tasks.push(
      safeTable('lead_subcontractor_fees', async () => {
        let q = supabase
          .from('lead_subcontractor_fees')
          .select(
            'id, created_at, created_by, amount, notes, lead_number, new_lead_id, legacy_lead_id, firm_id, firms:firm_id ( name ), accounting_currencies:currency_id ( name, iso_code )',
          )
          .order('created_at', { ascending: false })
          .limit(300);
        q = applyCreatedAt(q);
        const { data, error } = await q;
        if (error) throw error;
        return (data || []).map((row: any) =>
          emptyEntry({
            id: Number(row.id),
            created_at: String(row.created_at),
            kind: 'subcontractor',
            destination_table: 'lead_subcontractor_fees',
            destination_id: String(row.id),
            expense_date: localYmdFromTimestamp(row.created_at),
            amount: Number(row.amount) || 0,
            currency_code: isoFromCurrencyJoin(row.accounting_currencies),
            firm_id: row.firm_id != null ? String(row.firm_id) : null,
            new_lead_id: row.new_lead_id != null ? String(row.new_lead_id) : null,
            legacy_lead_id: row.legacy_lead_id != null ? Number(row.legacy_lead_id) : null,
            category_label: 'Subcontractor fee',
            vendor_label: joinLabel(row.firms, 'name'),
            lead_number: row.lead_number != null ? String(row.lead_number) : null,
            notes: row.notes != null ? String(row.notes) : null,
            created_by: row.created_by != null ? String(row.created_by) : null,
          }),
        );
      }),
    );
  }

  if (include('other_firm')) {
    tasks.push(
      safeTable('firm_management_costs', async () => {
        let q = supabase
          .from('firm_management_costs')
          .select(
            'id, created_at, amount, currency, notes, billing_month, firm_id, firms:firm_id ( name ), expense_types:expense_type_id ( label )',
          )
          .order('created_at', { ascending: false })
          .limit(300);
        const orExpr = dateOrCreated('billing_month');
        if (orExpr) q = q.or(orExpr);
        const { data, error } = await q;
        if (error) throw error;
        return (data || []).map((row: any) =>
          emptyEntry({
            id: Number(row.id) || 0,
            created_at: String(row.created_at),
            kind: 'other_firm',
            destination_table: 'firm_management_costs',
            destination_id: String(row.id),
            expense_date: row.billing_month
              ? String(row.billing_month).slice(0, 10)
              : localYmdFromTimestamp(row.created_at),
            amount: Number(row.amount) || 0,
            currency_code: row.currency != null ? String(row.currency) : 'ILS',
            firm_id: row.firm_id != null ? String(row.firm_id) : null,
            new_lead_id: null,
            legacy_lead_id: null,
            category_label: joinLabel(row.expense_types, 'label'),
            vendor_label: joinLabel(row.firms, 'name'),
            notes: row.notes != null ? String(row.notes) : null,
            created_by: null,
          }),
        );
      }),
    );
  }

  if (include('office')) {
    tasks.push(
      safeTable('office_expenses', async () => {
        let q = supabase
          .from('office_expenses')
          .select(
            'id, created_at, created_by, amount, currency, description, paid_at, firm_id, firms:firm_id ( name ), office_expense_types:expense_type_id ( label )',
          )
          .order('created_at', { ascending: false })
          .limit(300);
        const orExpr = dateOrCreated('paid_at');
        if (orExpr) q = q.or(orExpr);
        const { data, error } = await q;
        if (error) throw error;
        return (data || []).map((row: any) =>
          emptyEntry({
            id: 0,
            created_at: String(row.created_at),
            kind: 'office',
            destination_table: 'office_expenses',
            destination_id: String(row.id),
            expense_date: row.paid_at
              ? String(row.paid_at).slice(0, 10)
              : localYmdFromTimestamp(row.created_at),
            amount: Number(row.amount) || 0,
            currency_code: row.currency != null ? String(row.currency) : 'ILS',
            firm_id: row.firm_id != null ? String(row.firm_id) : null,
            new_lead_id: null,
            legacy_lead_id: null,
            category_label: joinLabel(row.office_expense_types, 'label'),
            vendor_label: joinLabel(row.firms, 'name'),
            notes: row.description != null ? String(row.description) : null,
            created_by: row.created_by != null ? String(row.created_by) : null,
          }),
        );
      }),
    );
  }

  if (include('marketing')) {
    tasks.push(
      safeTable('source_media_expense', async () => {
        let q = supabase
          .from('source_media_expense')
          .select(
            'id, created_at, created_by, amount, expense_month, lead_source_id, misc_leadsource:lead_source_id ( name )',
          )
          .order('created_at', { ascending: false })
          .limit(300);
        const orExpr = dateOrCreated('expense_month');
        if (orExpr) q = q.or(orExpr);
        const { data, error } = await q;
        if (error) throw error;
        return (data || []).map((row: any) =>
          emptyEntry({
            id: Number(row.id),
            created_at: String(row.created_at),
            kind: 'marketing',
            destination_table: 'source_media_expense',
            destination_id: String(row.id),
            expense_date: row.expense_month
              ? String(row.expense_month).slice(0, 10)
              : localYmdFromTimestamp(row.created_at),
            amount: Number(row.amount) || 0,
            currency_code: 'ILS',
            firm_id: null,
            new_lead_id: null,
            legacy_lead_id: null,
            category_label: 'Source media',
            vendor_label: joinLabel(row.misc_leadsource, 'name'),
            notes: null,
            created_by: row.created_by != null ? String(row.created_by) : null,
          }),
        );
      }),
    );
  }

  const groups = await Promise.all(tasks);
  const merged = new Map<string, FinanceExpenseEntryRow>();
  groups.flat().forEach((row) => {
    merged.set(row.listKey, row);
  });

  const registrySelect =
    'id, created_at, kind, destination_table, destination_id, expense_date, amount, currency_code, firm_id, new_lead_id, legacy_lead_id, category_label, vendor_label, notes, created_by';
  let registryRows: any[] = [];
  try {
    let registryQuery = supabase.from('finance_expense_entries').select(registrySelect).limit(400);
    const registryOr = dateOrCreated('expense_date');
    if (registryOr) registryQuery = registryQuery.or(registryOr);
    if (kindFilter) registryQuery = registryQuery.eq('kind', kindFilter);
    const { data, error } = await registryQuery;
    if (error && !/schema cache|does not exist|relation/i.test(error.message || '')) {
      throw error;
    }
    registryRows = data || [];

    const destIds = [...merged.values()].map((r) => r.destination_id).filter(Boolean).slice(0, 200);
    if (destIds.length) {
      let extraQuery = supabase.from('finance_expense_entries').select(registrySelect).in('destination_id', destIds);
      if (kindFilter) extraQuery = extraQuery.eq('kind', kindFilter);
      const extra = await extraQuery;
      if (!extra.error && extra.data?.length) {
        registryRows = [...registryRows, ...extra.data];
      }
    }
  } catch (err: any) {
    if (!/schema cache|does not exist|relation/i.test(err?.message || '')) {
      console.warn('[fetchFinanceExpenseEntries] registry:', err);
    }
  }

  (registryRows || []).forEach((row: any) => {
    const listKey = `${row.kind}:${row.destination_id}`;
    const existing = merged.get(listKey);
    if (existing) {
      merged.set(listKey, {
        ...existing,
        id: Number(row.id) || existing.id,
        created_by: existing.created_by || (row.created_by != null ? String(row.created_by) : null),
        vendor_label: existing.vendor_label || (row.vendor_label != null ? String(row.vendor_label) : null),
        lead_number: existing.lead_number,
        category_label: existing.category_label || (row.category_label != null ? String(row.category_label) : null),
      });
      return;
    }
    merged.set(
      listKey,
      emptyEntry({
        id: Number(row.id),
        created_at: String(row.created_at),
        kind: row.kind as FinanceExpenseKind,
        destination_table: String(row.destination_table),
        destination_id: String(row.destination_id),
        expense_date:
          row.expense_date != null
            ? String(row.expense_date).slice(0, 10)
            : localYmdFromTimestamp(row.created_at),
        amount: Number(row.amount) || 0,
        currency_code: row.currency_code != null ? String(row.currency_code) : null,
        firm_id: row.firm_id != null ? String(row.firm_id) : null,
        new_lead_id: row.new_lead_id != null ? String(row.new_lead_id) : null,
        legacy_lead_id: row.legacy_lead_id != null ? Number(row.legacy_lead_id) : null,
        category_label: row.category_label != null ? String(row.category_label) : null,
        vendor_label: row.vendor_label != null ? String(row.vendor_label) : null,
        lead_number: null,
        notes: row.notes != null ? String(row.notes) : null,
        created_by: row.created_by != null ? String(row.created_by) : null,
      }),
    );
  });

  const rows = [...merged.values()];
  const creators = await resolveCreators(rows.map((r) => r.created_by || '').filter(Boolean));
  const registryIds = rows.map((r) => r.id).filter((id) => Number.isFinite(id) && id > 0);
  const docsByEntry = await fetchFinanceExpenseDocumentsForEntries(registryIds);

  const search = filters.search?.trim() || '';
  return rows
    .map((row) => {
      const creator = row.created_by ? creators.get(row.created_by) : null;
      return {
        ...row,
        created_by_name: creator?.name || (row.created_by ? '—' : '—'),
        created_by_photo: creator?.photoUrl || null,
        documents: docsByEntry.get(row.id) || [],
      };
    })
    .filter((row) => rowInDateRange(row, from, to))
    .filter((row) => matchesSearch(row, search))
    .sort((a, b) => {
      const da = a.expense_date || a.created_at;
      const db = b.expense_date || b.created_at;
      return db.localeCompare(da);
    });
}

export function formatFinanceExpenseAmount(amount: number, currencyCode?: string | null): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  const code = (currencyCode || 'ILS').toUpperCase();
  const symbol = code === 'ILS' || code === 'NIS' ? '₪' : code === 'USD' ? '$' : code === 'EUR' ? '€' : code === 'GBP' ? '£' : `${code} `;
  return `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
