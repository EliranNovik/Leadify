import { v4 as uuidv4 } from 'uuid';
import { getFrontendBaseUrl } from './api';
import { fetchTemplateContentSnapshot } from './contractContentSnapshot';
import { fetchContractTypeBySlug } from './contractTypes';
import { supabase } from './supabase';

export type EmployeeDigitalContract = {
  id: string;
  status: string;
  signed_at?: string | null;
  public_token?: string | null;
  template_id?: string | null;
  contract_type_id?: number | null;
  employee_id?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  template_name?: string | null;
};

export type EmployeeContractTemplateOption = {
  id: string;
  name: string;
  sourceTable: 'contract_templates' | 'misc_contracttemplate';
  contract_type_id?: number | null;
  active?: boolean | null;
};

function mapContractRow(row: any): EmployeeDigitalContract {
  const template = Array.isArray(row.contract_templates)
    ? row.contract_templates[0]
    : row.contract_templates;
  return {
    id: String(row.id),
    status: row.status || 'draft',
    signed_at: row.signed_at ?? null,
    public_token: row.public_token ?? null,
    template_id: row.template_id ?? null,
    contract_type_id: row.contract_type_id ?? null,
    employee_id: row.employee_id ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    template_name: template?.name ?? null,
  };
}

export async function fetchEmployeeContractTemplates(): Promise<EmployeeContractTemplateOption[]> {
  const employeeType = await fetchContractTypeBySlug('employee_contract');
  if (!employeeType) return [];

  const { data, error } = await supabase
    .from('contract_templates')
    .select('id, name, active, contract_type_id')
    .eq('contract_type_id', employeeType.id)
    .order('name', { ascending: true });

  if (error) throw error;

  return (data || [])
    .filter((t) => t.active !== false)
    .map((t) => ({
      id: String(t.id),
      name: t.name || 'Untitled template',
      sourceTable: 'contract_templates' as const,
      contract_type_id: t.contract_type_id ?? null,
      active: t.active,
    }));
}

export async function fetchEmployeeDigitalContracts(
  employeeId: number,
): Promise<EmployeeDigitalContract[]> {
  const employeeType = await fetchContractTypeBySlug('employee_contract');
  if (!employeeType) return [];

  const { data, error } = await supabase
    .from('contracts')
    .select(
      'id, status, signed_at, public_token, template_id, contract_type_id, employee_id, created_at, updated_at, contract_templates(name)',
    )
    .eq('employee_id', employeeId)
    .eq('contract_type_id', employeeType.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(mapContractRow);
}

export async function createEmployeeDigitalContract(params: {
  employeeId: number;
  templateId: string;
  contactName?: string | null;
  contactEmail?: string | null;
}): Promise<EmployeeDigitalContract> {
  const employeeType = await fetchContractTypeBySlug('employee_contract');
  if (!employeeType) {
    throw new Error('Employee contract type is not configured. Run the contract_types migration.');
  }

  const publicToken = uuidv4();
  // Snapshot admin template body onto this contract so edits stay per-employee.
  const customContent = await fetchTemplateContentSnapshot(params.templateId);
  const insertPayload = {
    employee_id: params.employeeId,
    client_id: null,
    legacy_id: null,
    template_id: params.templateId,
    contract_type_id: employeeType.id,
    status: 'draft',
    public_token: publicToken,
    contact_name: params.contactName || null,
    contact_email: params.contactEmail || null,
    custom_content: customContent,
    applicant_count: 1,
    custom_pricing: {
      applicant_count: 1,
      pricing_tiers: {},
      total_amount: 0,
      discount_percentage: 0,
      discount_amount: 0,
      final_amount: 0,
      payment_plan: [],
      currency: null,
      archival_research_fee: 0,
      include_vat: false,
    },
  };

  const { data, error } = await supabase
    .from('contracts')
    .insert(insertPayload)
    .select(
      'id, status, signed_at, public_token, template_id, contract_type_id, employee_id, created_at, updated_at, contract_templates(name)',
    )
    .single();

  if (error) throw error;
  return mapContractRow(data);
}

export async function ensureEmployeeContractPublicToken(
  contractId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('contracts')
    .select('public_token')
    .eq('id', contractId)
    .maybeSingle();

  if (error) throw error;

  if (data?.public_token) return String(data.public_token);

  const token = uuidv4();
  const { error: updateError } = await supabase
    .from('contracts')
    .update({ public_token: token })
    .eq('id', contractId);

  if (updateError) throw updateError;
  return token;
}

export function buildEmployeeContractEditorPath(
  employeeId: number,
  contractId: string,
): string {
  return `/hr/employees/${employeeId}/contract/${contractId}`;
}

export function buildEmployeeContractPublicUrl(
  contractId: string,
  publicToken: string,
): string {
  return `${getFrontendBaseUrl()}/public-hr-contract/${contractId}/${publicToken}`;
}
