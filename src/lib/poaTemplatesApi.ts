import { supabase } from './supabase';
import type { PoaTemplateField } from './poaTemplateFields';

export interface PoaTemplateRow {
  id: string;
  name: string;
  description: string | null;
  category_id: number | null;
  language_id: string | null;
  direction: string;
  body: string;
  fields: PoaTemplateField[];
  font_family: string | null;
  font_size: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PoaTemplateInput {
  name: string;
  description?: string | null;
  category_id?: number | null;
  language_id?: string | null;
  direction?: string;
  body: string;
  fields: PoaTemplateField[];
  font_family?: string | null;
  font_size?: string | null;
  is_active?: boolean;
  sort_order?: number;
}

const TABLE = 'poa_templates';
const SELECT =
  'id, name, description, category_id, language_id, direction, body, fields, font_family, font_size, is_active, sort_order, created_at, updated_at';

export async function listPoaTemplates(): Promise<PoaTemplateRow[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(SELECT)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as PoaTemplateRow[];
}

/** Active templates for the "create POA" picker. */
export async function listActivePoaTemplates(): Promise<PoaTemplateRow[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(SELECT)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as PoaTemplateRow[];
}

export async function createPoaTemplate(
  input: PoaTemplateInput,
  createdBy?: string | null,
): Promise<PoaTemplateRow> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ ...input, created_by: createdBy ?? null })
    .select(SELECT)
    .single();
  if (error) throw new Error(error.message);
  return data as PoaTemplateRow;
}

export async function updatePoaTemplate(
  id: string,
  input: Partial<PoaTemplateInput>,
): Promise<PoaTemplateRow> {
  const { data, error } = await supabase
    .from(TABLE)
    .update(input)
    .eq('id', id)
    .select(SELECT)
    .single();
  if (error) throw new Error(error.message);
  return data as PoaTemplateRow;
}

export async function deletePoaTemplate(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Create a POA instance for a contact from a template; returns the secure token. */
export async function createPoaFromTemplate(params: {
  contactId: number;
  templateId: string;
  newLeadId?: string | null;
  legacyLeadId?: number | null;
  prefill?: Record<string, string>;
  createdBy?: string | null;
}): Promise<{ id: string; secureToken: string; typeName: string }> {
  const { data, error } = await supabase.rpc('poa_create_from_template', {
    p_contact_id: params.contactId,
    p_template_id: params.templateId,
    p_new_lead_id: params.newLeadId ?? null,
    p_legacy_lead_id: params.legacyLeadId ?? null,
    p_prefill: params.prefill ?? {},
    p_created_by: params.createdBy ?? null,
  });
  if (error) throw new Error(error.message);
  if (!data || data.ok === false) {
    throw new Error((data && data.error) || 'Failed to create POA from template');
  }
  return {
    id: data.id as string,
    secureToken: data.secure_token as string,
    typeName: data.type_name as string,
  };
}

// Lookups for the manager dropdowns -----------------------------------------

export interface PoaLookupOption {
  id: number;
  name: string;
}

export async function fetchPoaCategories(): Promise<PoaLookupOption[]> {
  const { data, error } = await supabase
    .from('misc_maincategory')
    .select('id, name')
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as PoaLookupOption[];
}

export interface PoaLanguageOption {
  id: string;
  name: string;
  iso_code: string;
}

export async function fetchPoaLanguages(): Promise<PoaLanguageOption[]> {
  const { data, error } = await supabase
    .from('languages')
    .select('id, name, iso_code')
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as PoaLanguageOption[];
}
