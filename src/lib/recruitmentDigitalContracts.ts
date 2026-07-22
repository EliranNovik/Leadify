import { v4 as uuidv4 } from 'uuid';
import { getFrontendBaseUrl } from './api';
import { fetchContractTypeBySlug } from './contractTypes';
import { supabase } from './supabase';

/** Same TipTap templates as employees (`employee_contract`), owned by a CRM user. */
export type RecruitmentDigitalContract = {
  id: string;
  status: string;
  signed_at?: string | null;
  public_token?: string | null;
  template_id?: string | null;
  contract_type_id?: number | null;
  user_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  template_name?: string | null;
};

export type RecruitmentContractTemplateOption = {
  id: string;
  name: string;
  sourceTable: 'contract_templates' | 'misc_contracttemplate';
  contract_type_id?: number | null;
  active?: boolean | null;
};

export type RecruitmentUser = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  is_active: boolean | null;
  employee_id: number | null;
  extern: boolean | null;
  created_at?: string | null;
};

function mapContractRow(row: any): RecruitmentDigitalContract {
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
    user_id: row.user_id ? String(row.user_id) : null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    template_name: template?.name ?? null,
  };
}

function isExternFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function recruitmentUserDisplayName(user: Pick<
  RecruitmentUser,
  'full_name' | 'first_name' | 'last_name' | 'email'
>): string {
  const full = String(user.full_name || '').trim();
  if (full) return full;
  const parts = [user.first_name, user.last_name].map((p) => String(p || '').trim()).filter(Boolean);
  if (parts.length) return parts.join(' ');
  return String(user.email || '').trim() || 'User';
}

/** Users with no employee link and not marked external (recruitment pool). */
export async function fetchRecruitmentUsers(): Promise<RecruitmentUser[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, first_name, last_name, full_name, is_active, employee_id, extern, created_at')
    .is('employee_id', null)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data || [])
    .filter((row) => !isExternFlag(row.extern))
    .map((row) => ({
      id: String(row.id),
      email: row.email ?? null,
      first_name: row.first_name ?? null,
      last_name: row.last_name ?? null,
      full_name: row.full_name ?? null,
      is_active: row.is_active ?? null,
      employee_id: row.employee_id ?? null,
      extern: row.extern ?? null,
      created_at: row.created_at ?? null,
    }));
}

export async function fetchRecruitmentContractTemplates(): Promise<RecruitmentContractTemplateOption[]> {
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

export async function fetchRecruitmentDigitalContracts(
  userId: string,
): Promise<RecruitmentDigitalContract[]> {
  const employeeType = await fetchContractTypeBySlug('employee_contract');
  if (!employeeType) return [];

  const { data, error } = await supabase
    .from('contracts')
    .select(
      'id, status, signed_at, public_token, template_id, contract_type_id, user_id, created_at, updated_at, contract_templates(name)',
    )
    .eq('user_id', userId)
    .eq('contract_type_id', employeeType.id)
    .is('employee_id', null)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(mapContractRow);
}

/** Latest recruitment contract status per user: signed if any signed, else pending. */
export async function fetchRecruitmentContractStatusByUserId(): Promise<
  Record<string, 'pending' | 'signed'>
> {
  const employeeType = await fetchContractTypeBySlug('employee_contract');
  if (!employeeType) return {};

  const { data, error } = await supabase
    .from('contracts')
    .select('user_id, status, signed_at, created_at')
    .eq('contract_type_id', employeeType.id)
    .not('user_id', 'is', null)
    .is('employee_id', null)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const byUser: Record<string, 'pending' | 'signed'> = {};
  for (const row of data || []) {
    const userId = row.user_id ? String(row.user_id) : '';
    if (!userId) continue;
    const isSigned =
      String(row.status || '').toLowerCase() === 'signed' || Boolean(row.signed_at);
    if (isSigned) {
      byUser[userId] = 'signed';
      continue;
    }
    if (!byUser[userId]) {
      byUser[userId] = 'pending';
    }
  }
  return byUser;
}

export async function createRecruitmentDigitalContract(params: {
  userId: string;
  templateId: string;
  contactName?: string | null;
  contactEmail?: string | null;
}): Promise<RecruitmentDigitalContract> {
  const employeeType = await fetchContractTypeBySlug('employee_contract');
  if (!employeeType) {
    throw new Error('Employee contract type is not configured. Run the contract_types migration.');
  }

  const publicToken = uuidv4();
  const insertPayload = {
    user_id: params.userId,
    employee_id: null,
    client_id: null,
    legacy_id: null,
    external_firm_id: null,
    template_id: params.templateId,
    contract_type_id: employeeType.id,
    status: 'draft',
    public_token: publicToken,
    contact_name: params.contactName || null,
    contact_email: params.contactEmail || null,
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
      'id, status, signed_at, public_token, template_id, contract_type_id, user_id, created_at, updated_at, contract_templates(name)',
    )
    .single();

  if (error) throw error;
  return mapContractRow(data);
}

export async function ensureRecruitmentContractPublicToken(contractId: string): Promise<string> {
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

export function buildRecruitmentContractEditorPath(userId: string, contractId: string): string {
  return `/hr/recruitment/${userId}/contract/${contractId}`;
}

export function buildRecruitmentContractPublicUrl(contractId: string, publicToken: string): string {
  return `${getFrontendBaseUrl()}/public-recruitment-contract/${contractId}/${publicToken}`;
}

export async function fetchRecruitmentUserById(userId: string): Promise<RecruitmentUser | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, first_name, last_name, full_name, is_active, employee_id, extern, created_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: String(data.id),
    email: data.email ?? null,
    first_name: data.first_name ?? null,
    last_name: data.last_name ?? null,
    full_name: data.full_name ?? null,
    is_active: data.is_active ?? null,
    employee_id: data.employee_id ?? null,
    extern: data.extern ?? null,
    created_at: data.created_at ?? null,
  };
}
