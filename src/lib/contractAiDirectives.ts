import { supabase } from './supabase';
import { FEE_AGREEMENT_PRINCIPLES, feeAgreementInstruction } from './feeAgreementPolicy';

export type ContractAiCategory = 'policy' | 'rule' | 'behavior';

export type ContractAiDirective = {
  id: string;
  category: ContractAiCategory;
  title: string;
  line: string | null;
  body: string;
  sort_order: number;
  is_active: boolean;
  created_by?: string | null;
  created_at?: string | null;
};

export type ContractAiPolicy = {
  id: string;
  title: string;
  summary: string;
  line: string;
};

const CATEGORY_LABEL: Record<ContractAiCategory, string> = {
  policy: 'Policies',
  rule: 'Rules',
  behavior: 'Behavior',
};

export function contractAiCategoryLabel(category: ContractAiCategory): string {
  return CATEGORY_LABEL[category];
}

export async function fetchContractAiDirectives(): Promise<ContractAiDirective[] | null> {
  const { data, error } = await supabase
    .from('contract_ai_directives')
    .select('id, category, title, line, body, sort_order, is_active')
    .order('sort_order', { ascending: true })
    .order('title', { ascending: true });
  if (error) return null;
  return (data || []) as ContractAiDirective[];
}

const FALLBACK_POLICIES: ContractAiPolicy[] = FEE_AGREEMENT_PRINCIPLES.map((principle) => ({
  id: principle.id,
  title: principle.title,
  summary: principle.summary,
  line: principle.line,
}));

export function policiesFromDirectives(rows: ContractAiDirective[] | null): ContractAiPolicy[] {
  if (rows == null) return FALLBACK_POLICIES;
  return rows
    .filter((row) => row.is_active && row.category === 'policy' && row.body.trim())
    .map((row) => ({
      id: row.id,
      title: row.title.trim(),
      summary: row.body.trim(),
      line: (row.line || '').trim(),
    }));
}

export function instructionFromDirectives(rows: ContractAiDirective[] | null): string {
  if (rows == null) return feeAgreementInstruction();
  const active = rows.filter((row) => row.is_active && row.body.trim());
  if (active.length === 0) return '';

  const section = (category: ContractAiCategory, intro: string) => {
    const items = active.filter((row) => row.category === category);
    if (items.length === 0) return '';
    const lines = items.map((row, index) => `${index + 1}. ${row.title}: ${row.body.trim()}`);
    return `${intro}\n${lines.join('\n')}`;
  };

  return [
    section(
      'policy',
      'POLICIES (mandatory for this client fee agreement). Every policy must be stated explicitly in the contract language. Equivalent wording counts. A heading alone does not count. On every review, say which policies are already explicit and which are missing. If asked to add the missing ones, insert them as explicit clauses and do not weaken existing terms.',
    ),
    section('rule', 'RULES. Follow every rule while reviewing or editing the contract.'),
    section('behavior', 'BEHAVIOR. Write in this way.'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function loadContractAiContext(): Promise<{
  instruction: string;
  policies: ContractAiPolicy[];
}> {
  const rows = await fetchContractAiDirectives();
  return {
    instruction: instructionFromDirectives(rows),
    policies: policiesFromDirectives(rows),
  };
}
