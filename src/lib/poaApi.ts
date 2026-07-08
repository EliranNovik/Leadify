import { supabase } from './supabase';
import { getFrontendBaseUrl } from './api';

export type PoaStatus = 'pending' | 'sent' | 'viewed' | 'signed' | 'cancelled';

export interface PoaTypeRow {
  id: number;
  key: string;
  name: string;
  language: string;
  direction: string;
  jurisdiction: string | null;
  description: string | null;
}

export interface PoaListItem {
  id: string;
  secure_token: string;
  status: PoaStatus;
  poa_type_id: number | null;
  template_id: string | null;
  type_key: string;
  type_name: string;
  type_language: string;
  signer_name: string | null;
  created_at: string;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  expires_at: string | null;
}

export interface PoaPublicData {
  poa: {
    id: string;
    status: PoaStatus;
    field_data: Record<string, string>;
    signatures: Record<string, string>;
    signer_name: string | null;
    signer_email: string | null;
    signed_at: string | null;
    created_at: string;
  };
  type: {
    id: number;
    key: string;
    name: string;
    language: string;
    direction: string;
    jurisdiction: string | null;
    description: string | null;
  };
  /** Present only for template-based POAs (poa_documents.template_id set). */
  template?: {
    id: string;
    name: string;
    description: string | null;
    body: string;
    fields: import('./poaTemplateFields').PoaTemplateField[];
    direction: string;
    language: string;
    font_family?: string | null;
    font_size?: string | null;
  } | null;
  contact: {
    id: number;
    name: string | null;
    email: string | null;
    phone: string | null;
    mobile: string | null;
    address: string | null;
    id_passport: string | null;
  };
}

/** Sibling POA in the same contact's signing sequence (for chaining + progress). */
export interface PoaSiblingItem {
  id: string;
  secure_token: string;
  status: PoaStatus;
  type_name: string | null;
  created_at: string;
  signed_at: string | null;
}

/** Public link a client uses to fill + sign a POA. */
export function buildPoaUrl(secureToken: string): string {
  return `${getFrontendBaseUrl()}/poa/${encodeURIComponent(secureToken)}`;
}

// -----------------------------------------------------------------------------
// Public (anon) — used by the /poa/:token page
// -----------------------------------------------------------------------------

export async function fetchPoaByToken(token: string): Promise<PoaPublicData> {
  const { data, error } = await supabase.rpc('poa_get_public', { p_token: token });
  if (error) throw new Error(error.message);
  if (!data || data.ok === false) {
    throw new Error((data && data.error) || 'POA not found');
  }
  return data as PoaPublicData;
}

/** All non-cancelled POAs for the same contact, oldest first (signing sequence). */
export async function fetchPoaSiblings(token: string): Promise<PoaSiblingItem[]> {
  const { data, error } = await supabase.rpc('poa_siblings_public', { p_token: token });
  if (error) throw new Error(error.message);
  if (!data || data.ok === false) return [];
  return (data.poas || []) as PoaSiblingItem[];
}

export async function submitPoa(params: {
  token: string;
  fieldData: Record<string, string>;
  signatures: Record<string, string>;
  signerName?: string | null;
  signerEmail?: string | null;
}): Promise<{ id: string }> {
  const { data, error } = await supabase.rpc('poa_submit_public', {
    p_token: params.token,
    p_field_data: params.fieldData,
    p_signatures: params.signatures,
    p_signer_name: params.signerName ?? null,
    p_signer_email: params.signerEmail ?? null,
  });
  if (error) throw new Error(error.message);
  if (!data || data.ok === false) {
    throw new Error((data && data.error) || 'Failed to submit POA');
  }
  return { id: data.id as string };
}

// -----------------------------------------------------------------------------
// Staff (authenticated)
// -----------------------------------------------------------------------------

export async function fetchPoaTypes(): Promise<PoaTypeRow[]> {
  const { data, error } = await supabase
    .from('poa_types')
    .select('id, key, name, language, direction, jurisdiction, description, sort_order, is_active')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as PoaTypeRow[];
}

export async function createPoa(params: {
  contactId: number;
  poaTypeId: number;
  newLeadId?: string | null;
  legacyLeadId?: number | null;
  prefill?: Record<string, string>;
  createdBy?: string | null;
}): Promise<{ id: string; secureToken: string; typeKey: string; typeName: string }> {
  const { data, error } = await supabase.rpc('poa_create', {
    p_contact_id: params.contactId,
    p_poa_type_id: params.poaTypeId,
    p_new_lead_id: params.newLeadId ?? null,
    p_legacy_lead_id: params.legacyLeadId ?? null,
    p_prefill: params.prefill ?? {},
    p_created_by: params.createdBy ?? null,
  });
  if (error) throw new Error(error.message);
  if (!data || data.ok === false) {
    throw new Error((data && data.error) || 'Failed to create POA');
  }
  return {
    id: data.id as string,
    secureToken: data.secure_token as string,
    typeKey: data.type_key as string,
    typeName: data.type_name as string,
  };
}

export async function listPoasForContact(contactId: number): Promise<PoaListItem[]> {
  const { data, error } = await supabase.rpc('poa_list_for_contact', { p_contact_id: contactId });
  if (error) throw new Error(error.message);
  if (!data || data.ok === false) {
    throw new Error((data && data.error) || 'Failed to load POAs');
  }
  return (data.poas || []) as PoaListItem[];
}

export async function markPoaSent(id: string): Promise<void> {
  const { data, error } = await supabase.rpc('poa_mark_sent', { p_id: id });
  if (error) throw new Error(error.message);
  if (!data || data.ok === false) throw new Error((data && data.error) || 'Failed to update POA');
}

export async function cancelPoa(id: string): Promise<void> {
  const { data, error } = await supabase.rpc('poa_cancel', { p_id: id });
  if (error) throw new Error(error.message);
  if (!data || data.ok === false) throw new Error((data && data.error) || 'Failed to cancel POA');
}

export async function deletePoa(id: string): Promise<void> {
  const { data, error } = await supabase.rpc('poa_delete', { p_id: id });
  if (error) throw new Error(error.message);
  if (!data || data.ok === false) throw new Error((data && data.error) || 'Failed to delete POA');
}

export interface PoaEditData {
  poa: {
    id: string;
    secure_token: string;
    status: PoaStatus;
    template_id: string;
    field_data: Record<string, string>;
    created_at: string;
    signed_at: string | null;
  };
  document: {
    name: string;
    description: string | null;
    body: string;
    fields: import('./poaTemplateFields').PoaTemplateField[];
    direction: string;
    font_family: string;
    font_size: string;
    language: string;
  };
  contact: PoaPublicData['contact'];
  lead: {
    new_lead_id: string | null;
    legacy_lead_id: number | null;
  };
  read_only: boolean;
}

/** Staff editor — load a template-based POA instance with effective body/fields. */
export async function fetchPoaForEdit(token: string): Promise<PoaEditData> {
  const { data, error } = await supabase.rpc('poa_get_for_edit', { p_token: token });
  if (error) throw new Error(error.message);
  if (!data || data.ok === false) {
    throw new Error((data && data.error) || 'POA not found');
  }
  return data as PoaEditData;
}

/** Staff editor — save per-instance document content (not allowed after signing). */
export async function updatePoaDocument(params: {
  token: string;
  body: string;
  fields: import('./poaTemplateFields').PoaTemplateField[];
  direction?: string;
  fontFamily?: string | null;
  fontSize?: string | null;
}): Promise<void> {
  const { data, error } = await supabase.rpc('poa_update_document', {
    p_token: params.token,
    p_body: params.body,
    p_fields: params.fields,
    p_direction: params.direction ?? 'ltr',
    p_font_family: params.fontFamily ?? null,
    p_font_size: params.fontSize ?? null,
  });
  if (error) throw new Error(error.message);
  if (!data || data.ok === false) {
    throw new Error((data && data.error) || 'Failed to save POA');
  }
}
