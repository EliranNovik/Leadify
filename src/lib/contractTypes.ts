import { supabase } from './supabase';

export type ContractTypeSlug =
  | 'client_contract'
  | 'employee_contract'
  | 'firm_contract'
  | 'other_contract';

export type ContractType = {
  id: number;
  slug: ContractTypeSlug | string;
  name: string;
  sort_order: number;
  active: boolean;
};

export async function fetchContractTypes(options?: {
  activeOnly?: boolean;
}): Promise<ContractType[]> {
  let query = supabase
    .from('contract_types')
    .select('id, slug, name, sort_order, active')
    .order('sort_order', { ascending: true });

  if (options?.activeOnly !== false) {
    query = query.eq('active', true);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as ContractType[];
}

export async function fetchContractTypeBySlug(
  slug: ContractTypeSlug | string,
): Promise<ContractType | null> {
  const { data, error } = await supabase
    .from('contract_types')
    .select('id, slug, name, sort_order, active')
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw error;
  return (data as ContractType | null) ?? null;
}

export function isEmployeeContractType(
  type: { slug?: string | null } | null | undefined,
): boolean {
  return type?.slug === 'employee_contract';
}
