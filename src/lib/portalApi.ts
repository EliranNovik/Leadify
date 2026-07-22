import {
  dedupePortalSubEffortRows,
  normalizePortalSubEffortFolders,
  type PortalSubEffortRow,
} from './portalSubEfforts';
import { supabase } from './supabase';
import { getPortalSessionToken } from './portalSession';

export type PortalLeadSummary = {
  is_legacy: boolean;
  new_lead_id: string | null;
  legacy_lead_id: number | null;
  lead_number: string;
  display_name: string;
  stage: string | number | null;
  stage_name: string | null;
};

export type PortalContact = {
  id: number;
  name: string;
  email: string | null;
  portal_profile_image_path?: string | null;
};

export type PortalSessionContext = {
  ok: boolean;
  session_token?: string;
  lead_summary?: PortalLeadSummary;
  contact?: PortalContact;
  expires_at?: string;
};

export type PortalProformaRow = {
  id: number;
  public_token: string;
  is_legacy: boolean;
  paid_at?: string | null;
  value?: number | null;
  value_vat?: number | null;
  currency?: string | null;
  created_at?: string | null;
};

export type PortalPaymentRow = {
  id: number;
  due_date: string | null;
  value: number;
  value_vat: number;
  paid: boolean;
  paid_at: string | null;
  currency: string | null;
  secure_token: string | null;
  link_status: string | null;
  public_token: string | null;
  is_legacy: boolean;
  proforma_id: number | null;
  payper_invoice_link?: string | null;
  payper_invoice_number?: string | null;
  has_proforma?: boolean;
  order?: string | number | null;
};

export type PortalDocumentClassification = {
  id: string;
  slug: string;
  label: string;
  sort_order?: number;
};

/** Employee-created folder on a sub-effort (CRM documents box). */
export type PortalDocumentFolder = {
  id: string;
  title: string;
  note?: string | null;
  sort_order?: number;
  created_at?: string;
  created_by?: string | null;
  lead_sub_effort_id?: number | null;
  sub_effort_name?: string | null;
  classification_id?: string | null;
  classification_slug?: string | null;
  classification_label?: string | null;
};

export type PortalDocumentRow = {
  id: string;
  file_name: string;
  storage_path: string | null;
  download_url?: string | null;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
  uploaded_by?: string | null;
  classification_id?: string | null;
  classification_slug?: string | null;
  classification_label?: string | null;
  contact_id?: number | null;
  document_type_id?: string | null;
  document_type_name?: string | null;
  contact_name?: string | null;
  source?: 'case' | 'subeffort';
  /** Set when the file lives in a CRM sub-effort folder. */
  folder_id?: string | null;
  lead_sub_effort_id?: number | null;
  sub_effort_name?: string | null;
};

export type PortalLeadCaseDocumentType = {
  id: string;
  name: string;
  sort_order: number;
};

function tokenOrThrow(): string {
  const t = getPortalSessionToken();
  if (!t) throw new Error('Not logged in');
  return t;
}

function inferImageMimeType(file: File): string {
  const trimmed = file.type?.trim();
  if (trimmed) return trimmed;
  const ext = file.name.split('.').pop()?.toLowerCase();
  const byExt: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return byExt[ext || ''] || 'image/jpeg';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Failed to read file'));
        return;
      }
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64 || '');
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export async function portalLogin(leadRef: string, email: string, password: string) {
  const normalizedRef = decodeURIComponent(leadRef).trim();
  const { data, error } = await supabase.rpc('portal_login', {
    p_lead_ref: normalizedRef,
    p_email: email.trim(),
    p_password: password,
  });
  if (error) throw error;
  return data as {
    ok: boolean;
    error?: string;
    session_token?: string;
    lead_ref?: string;
    lead_summary?: PortalLeadSummary;
    contact?: PortalContact;
  };
}

export async function portalValidateSession(token?: string): Promise<PortalSessionContext> {
  const t = token ?? getPortalSessionToken();
  if (!t) return { ok: false };
  const { data, error } = await supabase.rpc('portal_validate_session', { p_token: t });
  if (error) throw error;
  return (data ?? { ok: false }) as PortalSessionContext;
}

export async function portalLogout(): Promise<void> {
  const t = getPortalSessionToken();
  if (t) {
    await supabase.rpc('portal_logout', { p_token: t });
  }
}

export type PortalTeamContact = {
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
};

export async function portalGetCaseSummary() {
  const { data, error } = await supabase.rpc('portal_get_case_summary', {
    p_token: tokenOrThrow(),
  });
  if (error) throw error;
  return data as {
    lead: PortalLeadSummary;
    handler_name: string | null;
    handler_photo_url?: string | null;
    handler_contact?: PortalTeamContact | null;
    handler_department?: string | null;
    retainer_handler_name: string | null;
    retainer_handler_photo_url?: string | null;
    retainer_handler_contact?: PortalTeamContact | null;
    retainer_handler_department?: string | null;
    department_manager_name: string | null;
    department_manager_photo_url?: string | null;
    department_manager_contact?: PortalTeamContact | null;
    department_manager_department?: string | null;
    main_category_name?: string | null;
    category: string | null;
  } | null;
}

export async function portalGetSubEfforts() {
  const { data, error } = await supabase.rpc('portal_get_sub_efforts', {
    p_token: tokenOrThrow(),
  });
  if (error) throw error;
  const payload = data as {
    rows?: Array<Record<string, unknown>>;
    sub_efforts?: Array<Record<string, unknown>>;
    category_id?: number | null;
    folders?: unknown;
  } | null;
  if (!payload) return null;
  const rawRows = payload.rows ?? payload.sub_efforts ?? [];
  return {
    rows: dedupePortalSubEffortRows(rawRows),
    category_id: payload.category_id ?? null,
    folders: normalizePortalSubEffortFolders(payload.folders),
  };
}

export type { PortalSubEffortRow, PortalSubEffortFolder } from './portalSubEfforts';

export async function portalGetFinances() {
  const { data, error } = await supabase.rpc('portal_get_finances', {
    p_token: tokenOrThrow(),
  });
  if (error) throw error;
  return data as {
    payments: PortalPaymentRow[];
    proformas: PortalProformaRow[];
    is_legacy: boolean;
  } | null;
}

export async function portalGetDocuments() {
  const { data, error } = await supabase.rpc('portal_get_documents', {
    p_token: tokenOrThrow(),
  });
  if (error) throw error;
  return data as {
    documents: PortalDocumentRow[];
    folders?: PortalDocumentFolder[];
    classifications: PortalDocumentClassification[];
    lead_number: string;
  } | null;
}

export async function portalGetDocumentSignedUrls(storagePaths: string[]): Promise<Record<string, string>> {
  const sessionToken = tokenOrThrow();
  const { data, error } = await supabase.functions.invoke('portal-documents', {
    body: { session_token: sessionToken, storage_paths: storagePaths },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || 'Failed to get document URLs');
  return (data.urls ?? {}) as Record<string, string>;
}

export async function portalGetLeadCaseDocumentTypes(): Promise<PortalLeadCaseDocumentType[]> {
  const { data, error } = await supabase.rpc('portal_get_lead_case_document_types', {
    p_token: tokenOrThrow(),
  });
  if (error) throw error;
  const types = (data as { types?: PortalLeadCaseDocumentType[] } | null)?.types ?? [];
  return types.map((t) => ({
    id: String(t.id),
    name: String(t.name ?? ''),
    sort_order: Number(t.sort_order ?? 0),
  }));
}

export async function portalPrepareDocumentUpload(
  fileName: string,
  mimeType?: string,
  fileSize?: number,
  contactId?: number,
  documentTypeId?: string,
) {
  const { data, error } = await supabase.rpc('portal_prepare_document_upload', {
    p_token: tokenOrThrow(),
    p_file_name: fileName,
    p_mime_type: mimeType ?? null,
    p_file_size: fileSize ?? null,
    p_contact_id: contactId ?? null,
    p_document_type_id: documentTypeId ?? null,
  });
  if (error) throw error;
  return data as {
    ok: boolean;
    error?: string;
    storage_path?: string;
    bucket?: string;
  };
}

export async function portalFinalizeDocumentUpload(storagePath: string) {
  const { data, error } = await supabase.rpc('portal_finalize_document_upload', {
    p_token: tokenOrThrow(),
    p_storage_path: storagePath,
  });
  if (error) throw error;
  return data as { ok: boolean; error?: string; document_id?: number };
}

export async function portalUploadDocument(
  file: File,
  opts?: { contactId?: number; documentTypeId?: string },
): Promise<{ documentId?: string }> {
  const prep = await portalPrepareDocumentUpload(
    file.name,
    file.type || undefined,
    file.size,
    opts?.contactId,
    opts?.documentTypeId,
  );
  if (!prep.ok || !prep.storage_path || !prep.bucket) {
    throw new Error(prep.error || 'Upload preparation failed');
  }

  const { error: uploadErr } = await supabase.storage
    .from(prep.bucket)
    .upload(prep.storage_path, file, {
      contentType: file.type?.trim() || undefined,
      upsert: false,
    });
  if (uploadErr) throw uploadErr;

  const fin = await portalFinalizeDocumentUpload(prep.storage_path);
  if (!fin.ok) {
    await supabase.storage.from(prep.bucket).remove([prep.storage_path]).catch(() => undefined);
    throw new Error(fin.error || 'Failed to register document');
  }

  const documentId = fin.document_id != null ? String(fin.document_id) : undefined;
  if (documentId) {
    void supabase.functions
      .invoke('case-document-summarize', { body: { documentId } })
      .catch((err) => console.warn('case-document-summarize:', err));
  }

  return { documentId };
}

export async function portalUploadDocuments(
  files: File[],
  opts?: { contactId?: number; documentTypeId?: string },
): Promise<void> {
  for (const file of files) {
    await portalUploadDocument(file, opts);
  }
}

export async function portalGetContactProfileSignedUrls(storagePaths: string[]): Promise<Record<string, string>> {
  const sessionToken = tokenOrThrow();
  const { data, error } = await supabase.functions.invoke('portal-contact-profiles', {
    body: { session_token: sessionToken, storage_paths: storagePaths },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || 'Failed to get profile URLs');
  return (data.urls ?? {}) as Record<string, string>;
}

export async function portalPrepareContactProfileUpload(
  contactId: number,
  fileName: string,
  mimeType?: string,
  fileSize?: number,
) {
  const { data, error } = await supabase.rpc('portal_prepare_contact_profile_upload', {
    p_token: tokenOrThrow(),
    p_contact_id: contactId,
    p_file_name: fileName,
    p_mime_type: mimeType ?? null,
    p_file_size: fileSize ?? null,
  });
  if (error) throw error;
  return data as {
    ok: boolean;
    error?: string;
    storage_path?: string;
    bucket?: string;
  };
}

export async function portalFinalizeContactProfileUpload(contactId: number, storagePath: string) {
  const { data, error } = await supabase.rpc('portal_finalize_contact_profile_upload', {
    p_token: tokenOrThrow(),
    p_contact_id: contactId,
    p_storage_path: storagePath,
  });
  if (error) throw error;
  return data as {
    ok: boolean;
    error?: string;
    contact_id?: number;
    portal_profile_image_path?: string;
  };
}

export async function portalUploadContactProfile(contactId: number, file: File) {
  const mimeType = inferImageMimeType(file);
  const prep = await portalPrepareContactProfileUpload(
    contactId,
    file.name,
    mimeType,
    file.size,
  );
  if (!prep.ok || !prep.storage_path || !prep.bucket) {
    throw new Error(prep.error || 'Upload preparation failed');
  }

  const sessionToken = tokenOrThrow();
  const fileBase64 = await fileToBase64(file);
  const { data: uploadData, error: uploadErr } = await supabase.functions.invoke('portal-contact-profiles', {
    body: {
      action: 'upload',
      session_token: sessionToken,
      contact_id: contactId,
      storage_path: prep.storage_path,
      content_type: mimeType,
      file_base64: fileBase64,
    },
  });

  if (uploadErr) {
    throw new Error(uploadErr.message || 'Upload failed');
  }
  if (!uploadData?.ok) {
    throw new Error(uploadData?.error || 'Upload failed');
  }

  const fin = await portalFinalizeContactProfileUpload(contactId, prep.storage_path);
  if (!fin.ok) throw new Error(fin.error || 'Failed to save profile photo');
  return fin;
}

export async function portalGetContacts() {
  const { data, error } = await supabase.rpc('portal_get_contacts', {
    p_token: tokenOrThrow(),
  });
  if (error) throw error;
  return data as {
    contacts: Array<{
      id: number;
      name: string;
      mobile: string | null;
      phone: string | null;
      email: string | null;
      address: string | null;
      id_passport: string | null;
      country_id: number | null;
      is_main: boolean;
      portal_profile_image_path: string | null;
    }>;
  } | null;
}

export type PortalContactPoaRow = {
  id: string;
  secure_token: string;
  status: 'pending' | 'sent' | 'viewed' | 'signed' | 'cancelled' | string;
  type_name: string | null;
  signed_at: string | null;
  created_at: string;
};

export async function portalGetContactPoas(contactId: number): Promise<PortalContactPoaRow[]> {
  const { data, error } = await supabase.rpc('portal_poa_list_for_contact', {
    p_token: tokenOrThrow(),
    p_contact_id: contactId,
  });
  if (error) throw error;
  if (!data || data.ok === false) {
    throw new Error((data && data.error) || 'Failed to load POAs');
  }
  return (data.poas || []) as PortalContactPoaRow[];
}

export type PortalNotificationType =
  | 'poa_new'
  | 'poa_signed'
  | 'contract_new'
  | 'contract_signed'
  | 'contact_new'
  | 'meeting_new'
  | 'document_new'
  | 'status_new'
  | 'status_updated'
  | string;

export type PortalNotificationRow = {
  id: string;
  type: PortalNotificationType;
  title: string;
  subtitle: string | null;
  ts: string;
  tab: 'summary' | 'stages' | 'finance' | 'documents' | 'contacts' | 'meetings' | string;
};

export async function portalGetNotifications(limit = 50): Promise<PortalNotificationRow[]> {
  const { data, error } = await supabase.rpc('portal_get_notifications', {
    p_token: tokenOrThrow(),
    p_limit: limit,
  });
  if (error) throw error;
  if (!data || data.ok === false) {
    throw new Error((data && data.error) || 'Failed to load notifications');
  }
  return (data.notifications || []) as PortalNotificationRow[];
}

export type PortalContactContractRow = {
  id: string;
  public_token: string;
  status: 'draft' | 'signed' | string;
  is_legacy: boolean;
  title: string | null;
  signed_at: string | null;
  created_at: string | null;
};

export async function portalGetContactContracts(
  contactId: number,
): Promise<PortalContactContractRow[]> {
  const { data, error } = await supabase.rpc('portal_contract_list_for_contact', {
    p_token: tokenOrThrow(),
    p_contact_id: contactId,
  });
  if (error) throw error;
  if (!data || data.ok === false) {
    throw new Error((data && data.error) || 'Failed to load contracts');
  }
  return (data.contracts || []) as PortalContactContractRow[];
}

export async function portalUpdateContact(contactId: number, fields: Record<string, unknown>) {
  const { data, error } = await supabase.rpc('portal_update_contact', {
    p_token: tokenOrThrow(),
    p_contact_id: contactId,
    p_fields: fields,
  });
  if (error) throw error;
  return data as { ok: boolean; error?: string };
}

export type PortalMeetingRow = {
  id: number | string;
  meeting_date: string | null;
  meeting_time: string | null;
  meeting_location: string | null;
  is_physical_meeting?: boolean;
  meeting_address?: string | null;
  meeting_subject: string | null;
  join_url: string | null;
  status: string;
  created_at: string | null;
};

export type PortalMeetingRequestRow = {
  id: number;
  preferred_date: string;
  preferred_time_range: string | null;
  notes: string | null;
  status: 'pending' | 'confirmed' | 'cancelled' | string;
  created_at: string;
  updated_at: string;
};

export async function portalGetBookingAccess() {
  const { data, error } = await supabase.rpc('portal_get_booking_access', {
    p_token: tokenOrThrow(),
  });
  if (error) throw error;
  return data as { ok: boolean; error?: string; booking_token?: string } | null;
}

export async function portalGetMeetings() {
  const { data, error } = await supabase.rpc('portal_get_meetings', {
    p_token: tokenOrThrow(),
  });
  if (error) throw error;
  return data as {
    meetings: PortalMeetingRow[];
    requests: PortalMeetingRequestRow[];
  } | null;
}

export async function portalCreateMeetingRequest(payload: {
  preferred_date: string;
  preferred_time_range?: string;
  notes?: string;
}) {
  const { data, error } = await supabase.rpc('portal_create_meeting_request', {
    p_token: tokenOrThrow(),
    p_payload: payload,
  });
  if (error) throw error;
  return data as { ok: boolean; error?: string; id?: number };
}

export async function portalStaffGetStatus(
  leadId: string,
  leadType: string,
  leadNumber?: string | null,
) {
  const { portalStaffGetStatus: getStatus } = await import('./portalStaffApi');
  return getStatus(leadId, leadType, leadNumber);
}

export async function portalStaffSetPassword(
  leadId: string,
  leadType: string,
  options: {
    password?: string | null;
    enabled: boolean;
    leadNumber?: string | null;
  },
) {
  const { portalStaffSetPassword: setPassword } = await import('./portalStaffApi');
  return setPassword(leadId, leadType, options);
}

export function buildPortalUrl(leadRef: string): string {
  const ref = encodeURIComponent(leadRef);
  return `${window.location.origin}/portal/${ref}`;
}
