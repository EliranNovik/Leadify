import { supabase } from './supabase';
import { resolveEmployeePhotoUrl } from './employeePhotoUrl';
import { FINANCE_CASH_BOX_DOCUMENTS_BUCKET } from './financeCashBoxDocuments';

export type CashBoxTransaction = {
  id: string;
  amount_nis: number;
  expense_type_id: string | null;
  cash_in_category_id: string | null;
  category_key: string | null;
  category_label: string | null;
  employee_id: number | null;
  employee_name: string | null;
  employee_photo_url: string | null;
  notes: string | null;
  transaction_date: string;
  created_by: string | null;
  created_by_name: string | null;
  created_by_photo_url: string | null;
  created_at: string;
};

export type CashBoxTransactionInput = {
  direction: 'add' | 'remove';
  amount: number;
  categoryId: string | null;
  employeeId: number | null;
  notes: string | null;
  transactionDate: string;
};

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function fetchCashBoxTransactions(): Promise<CashBoxTransaction[]> {
  const { data, error } = await supabase
    .from('finance_cash_box_transactions')
    .select(`
      id, amount_nis, expense_type_id, cash_in_category_id, employee_id, notes,
      transaction_date, created_by, created_at,
      lead_expense_types:expense_type_id ( label ),
      finance_cash_in_categories:cash_in_category_id ( label ),
      tenants_employee:employee_id ( display_name, photo_url, photo )
    `)
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;

  const creatorIds = Array.from(
    new Set((data || []).map((row: any) => row.created_by).filter(Boolean)),
  );
  const creators = new Map<string, { name: string; photoUrl: string | null }>();
  if (creatorIds.length) {
    const { data: users } = await supabase
      .from('users')
      .select('auth_id, first_name, tenants_employee:employee_id(display_name, photo_url, photo)')
      .in('auth_id', creatorIds);
    (users || []).forEach((user: any) => {
      const employee = relationOne<any>(user.tenants_employee);
      const name =
        employee?.display_name ||
        user.first_name ||
        'User';
      if (user.auth_id) {
        creators.set(user.auth_id, {
          name,
          photoUrl: resolveEmployeePhotoUrl(employee?.photo_url, employee?.photo),
        });
      }
    });
  }

  return (data || []).map((row: any) => {
    const employee = relationOne<any>(row.tenants_employee);
    const creator = row.created_by ? creators.get(row.created_by) : null;
    return {
    id: row.id,
    amount_nis: Number(row.amount_nis) || 0,
    expense_type_id: row.expense_type_id,
    cash_in_category_id: row.cash_in_category_id,
    category_key: row.cash_in_category_id
      ? `in:${row.cash_in_category_id}`
      : row.expense_type_id
        ? `out:${row.expense_type_id}`
        : null,
    category_label:
      relationOne<any>(row.finance_cash_in_categories)?.label ||
      relationOne<any>(row.lead_expense_types)?.label ||
      null,
    employee_id: row.employee_id == null ? null : Number(row.employee_id),
    employee_name: employee?.display_name || null,
    employee_photo_url: resolveEmployeePhotoUrl(employee?.photo_url, employee?.photo),
    notes: row.notes,
    transaction_date: row.transaction_date,
    created_by: row.created_by,
    created_by_name: creator?.name || null,
    created_by_photo_url: creator?.photoUrl || null,
    created_at: row.created_at,
    };
  });
}

function payload(input: CashBoxTransactionInput) {
  const absoluteAmount = Math.abs(Number(input.amount));
  if (!Number.isFinite(absoluteAmount) || absoluteAmount <= 0) {
    throw new Error('Enter an amount greater than zero');
  }
  return {
    amount_nis: input.direction === 'remove' ? -absoluteAmount : absoluteAmount,
    expense_type_id: input.direction === 'remove' ? input.categoryId || null : null,
    cash_in_category_id: input.direction === 'add' ? input.categoryId || null : null,
    employee_id: input.employeeId || null,
    notes: input.notes?.trim() || null,
    transaction_date: input.transactionDate,
  };
}

export type CashInCategory = {
  id: string;
  code: string;
  label: string;
  description: string | null;
  sort_order: number;
};

export async function fetchCashInCategories(): Promise<CashInCategory[]> {
  const { data, error } = await supabase
    .from('finance_cash_in_categories')
    .select('id, code, label, description, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data || []) as CashInCategory[];
}

export async function createCashBoxTransaction(input: CashBoxTransactionInput): Promise<string> {
  const { data, error } = await supabase
    .from('finance_cash_box_transactions')
    .insert(payload(input))
    .select('id')
    .single();
  if (error) throw error;
  return String(data.id);
}

export async function updateCashBoxTransaction(
  id: string,
  input: CashBoxTransactionInput,
): Promise<void> {
  const { error } = await supabase
    .from('finance_cash_box_transactions')
    .update(payload(input))
    .eq('id', id);
  if (error) throw error;
}

export async function deleteCashBoxTransaction(id: string): Promise<void> {
  const { data: documents } = await supabase
    .from('finance_cash_box_documents')
    .select('storage_path')
    .eq('transaction_id', id);
  const paths = (documents || []).map((row: any) => String(row.storage_path || '')).filter(Boolean);
  if (paths.length) {
    const { error: storageError } = await supabase.storage
      .from(FINANCE_CASH_BOX_DOCUMENTS_BUCKET)
      .remove(paths);
    if (storageError) throw storageError;
  }
  const { error } = await supabase.from('finance_cash_box_transactions').delete().eq('id', id);
  if (error) throw error;
}

export function formatCashBoxNis(amount: number): string {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount || 0);
}
