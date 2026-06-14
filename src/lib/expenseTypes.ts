import { supabase } from './supabase';

export type ExpenseTypeRow = {
  id: string;
  code: string;
  label: string;
  sort_order?: number;
  is_active?: boolean;
};

export const EXPENSE_TYPE_CODE_MARKETING = 'marketing_expense';
export const EXPENSE_TYPE_CODE_RENT = 'rent';
export const EXPENSE_TYPE_CODE_OFFICE = 'office_expense';

export const ROUTED_FIRM_MANAGEMENT_EXPENSE_TYPE_CODES = [
  EXPENSE_TYPE_CODE_MARKETING,
  EXPENSE_TYPE_CODE_RENT,
  EXPENSE_TYPE_CODE_OFFICE,
] as const;

export type RoutedFirmManagementExpenseTypeCode =
  (typeof ROUTED_FIRM_MANAGEMENT_EXPENSE_TYPE_CODES)[number];

export async function fetchActiveExpenseTypes(): Promise<ExpenseTypeRow[]> {
  const { data, error } = await supabase
    .from('expense_types')
    .select('id, code, label, sort_order, is_active')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return (data || []) as ExpenseTypeRow[];
}

export function expenseTypeLabel(
  expenseTypeId: string | null | undefined,
  types: ExpenseTypeRow[],
): string {
  if (!expenseTypeId) return '—';
  return types.find((t) => t.id === expenseTypeId)?.label ?? '—';
}

export function defaultMarketingExpenseTypeId(types: ExpenseTypeRow[]): string | null {
  return (
    types.find((t) => t.code === EXPENSE_TYPE_CODE_MARKETING)?.id ??
    types[0]?.id ??
    null
  );
}

export function expenseTypeIdByCode(
  types: ExpenseTypeRow[],
  code: string,
): string | null {
  return types.find((t) => t.code === code)?.id ?? null;
}

export function expenseTypeLabelByCode(
  types: ExpenseTypeRow[],
  code: string,
): string | null {
  return types.find((t) => t.code === code)?.label ?? null;
}

export function isRoutedFirmManagementExpenseTypeCode(
  code: string | null | undefined,
): code is RoutedFirmManagementExpenseTypeCode {
  if (!code) return false;
  return (ROUTED_FIRM_MANAGEMENT_EXPENSE_TYPE_CODES as readonly string[]).includes(code);
}
