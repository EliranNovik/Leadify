import { supabase } from './supabase';
import { isUsableEmployeePhotoUrl, resolveEmployeePhotoUrl } from './employeePhotoUrl';

export const COMPANY_SIGNATURE_SETTINGS_ID = 1;
export const SIGNATURE_IMAGES_BUCKET = 'signature-templates';

export const DEFAULT_COMPANY_SIGNATURE_SETTINGS: CompanySignatureSettings = {
  id: COMPANY_SIGNATURE_SETTINGS_ID,
  company_name: 'Decker Pex Levi Law Offices',
  logo_url: null,
  secondary_logo_url: null,
  website_url: 'https://www.deckerlaw.co.il',
  facebook_url: 'https://www.facebook.com/DeckerPexCo',
  linkedin_url: 'https://www.linkedin.com/company/decker-pex-co/',
  youtube_url: 'https://www.youtube.com/@DeckerPexLawoffice',
  instagram_url: null,
  office_phone: null,
  office_address: 'Twin Towers, 2 Jabotinsky St., Ramat Gan, Israel',
  signature_disclaimer: null,
  signature_enabled: true,
  show_logo: true,
  show_secondary_logo: true,
  show_facebook: true,
  show_linkedin: true,
  show_youtube: true,
  show_instagram: false,
  show_website: true,
  show_office_address: true,
  show_office_phone: false,
  facebook_icon_url: null,
  linkedin_icon_url: null,
  youtube_icon_url: null,
  website_icon_url: null,
  instagram_icon_url: null,
  updated_at: null,
};

export type CompanySignatureSettings = {
  id: number;
  company_name: string;
  logo_url: string | null;
  secondary_logo_url: string | null;
  website_url: string | null;
  facebook_url: string | null;
  linkedin_url: string | null;
  youtube_url: string | null;
  instagram_url: string | null;
  office_phone: string | null;
  office_address: string | null;
  signature_disclaimer: string | null;
  signature_enabled: boolean;
  show_logo: boolean;
  show_secondary_logo: boolean;
  show_facebook: boolean;
  show_linkedin: boolean;
  show_youtube: boolean;
  show_instagram: boolean;
  show_website: boolean;
  show_office_address: boolean;
  show_office_phone: boolean;
  facebook_icon_url: string | null;
  linkedin_icon_url: string | null;
  youtube_icon_url: string | null;
  website_icon_url: string | null;
  instagram_icon_url: string | null;
  updated_at: string | null;
};

export type UserSignatureProfile = {
  id: string | null;
  employee_id: number;
  job_title: string;
  department_override: string;
  signature_enabled: boolean;
};

export type SignaturePerson = {
  employeeId: number;
  displayName: string;
  jobTitle: string;
  department: string;
  phone: string;
  email: string;
  profileImageUrl: string | null;
  signatureEnabled: boolean;
};

export type SignatureEmployeeRow = {
  id: number;
  display_name: string;
  official_name: string;
  photo_url: string | null;
  photo: string | null;
  mobile: string | null;
  phone: string | null;
  department_name: string;
  email: string | null;
  fired?: boolean | null;
};

const SETTINGS_SELECT = `
  id,
  company_name,
  logo_url,
  secondary_logo_url,
  website_url,
  facebook_url,
  linkedin_url,
  youtube_url,
  instagram_url,
  office_phone,
  office_address,
  signature_disclaimer,
  signature_enabled,
  show_logo,
  show_secondary_logo,
  show_facebook,
  show_linkedin,
  show_youtube,
  show_instagram,
  show_website,
  show_office_address,
  show_office_phone,
  facebook_icon_url,
  linkedin_icon_url,
  youtube_icon_url,
  website_icon_url,
  instagram_icon_url,
  updated_at
`;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function asNullableString(value: unknown): string | null {
  const text = asString(value).trim();
  return text || null;
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value == null) return fallback;
  return Boolean(value);
}

function mapSettings(row: Record<string, unknown> | null | undefined): CompanySignatureSettings {
  if (!row) return { ...DEFAULT_COMPANY_SIGNATURE_SETTINGS };
  return {
    id: Number(row.id) || COMPANY_SIGNATURE_SETTINGS_ID,
    company_name: asString(row.company_name) || DEFAULT_COMPANY_SIGNATURE_SETTINGS.company_name,
    logo_url: asNullableString(row.logo_url),
    secondary_logo_url: asNullableString(row.secondary_logo_url),
    website_url: asNullableString(row.website_url) || DEFAULT_COMPANY_SIGNATURE_SETTINGS.website_url,
    facebook_url: asNullableString(row.facebook_url) || DEFAULT_COMPANY_SIGNATURE_SETTINGS.facebook_url,
    linkedin_url: asNullableString(row.linkedin_url) || DEFAULT_COMPANY_SIGNATURE_SETTINGS.linkedin_url,
    youtube_url: asNullableString(row.youtube_url) || DEFAULT_COMPANY_SIGNATURE_SETTINGS.youtube_url,
    instagram_url: asNullableString(row.instagram_url),
    office_phone: asNullableString(row.office_phone),
    office_address: asNullableString(row.office_address),
    signature_disclaimer: asNullableString(row.signature_disclaimer),
    signature_enabled: asBool(row.signature_enabled, true),
    show_logo: asBool(row.show_logo, true),
    show_secondary_logo: asBool(row.show_secondary_logo, true),
    show_facebook: asBool(row.show_facebook, true),
    show_linkedin: asBool(row.show_linkedin, true),
    show_youtube: asBool(row.show_youtube, true),
    show_instagram: asBool(row.show_instagram, false),
    show_website: asBool(row.show_website, true),
    show_office_address: asBool(row.show_office_address, true),
    show_office_phone: asBool(row.show_office_phone, false),
    facebook_icon_url: asNullableString(row.facebook_icon_url),
    linkedin_icon_url: asNullableString(row.linkedin_icon_url),
    youtube_icon_url: asNullableString(row.youtube_icon_url),
    website_icon_url: asNullableString(row.website_icon_url),
    instagram_icon_url: asNullableString(row.instagram_icon_url),
    updated_at: asNullableString(row.updated_at),
  };
}

export function emptySignatureProfile(employeeId: number): UserSignatureProfile {
  return {
    id: null,
    employee_id: employeeId,
    job_title: '',
    department_override: '',
    signature_enabled: true,
  };
}

export function buildSignaturePerson(
  employee: SignatureEmployeeRow,
  profile: UserSignatureProfile | null,
): SignaturePerson {
  const name =
    (employee.official_name || '').trim() ||
    (employee.display_name || '').trim() ||
    'Employee';
  const department =
    (profile?.department_override || '').trim() ||
    (employee.department_name || '').trim();
  const phone = (employee.mobile || '').trim() || (employee.phone || '').trim();
  const photo = resolveEmployeePhotoUrl(employee.photo_url, employee.photo);

  return {
    employeeId: employee.id,
    displayName: name,
    jobTitle: (profile?.job_title || '').trim(),
    department,
    phone,
    email: (employee.email || '').trim(),
    profileImageUrl: photo,
    signatureEnabled: profile?.signature_enabled !== false,
  };
}

export async function fetchCompanySignatureSettings(): Promise<CompanySignatureSettings> {
  const { data, error } = await supabase
    .from('company_signature_settings')
    .select(SETTINGS_SELECT)
    .eq('id', COMPANY_SIGNATURE_SETTINGS_ID)
    .maybeSingle();

  if (error) {
    console.warn('company_signature_settings unavailable:', error.message);
    return { ...DEFAULT_COMPANY_SIGNATURE_SETTINGS };
  }

  if (!data) {
    const { data: inserted, error: insertError } = await supabase
      .from('company_signature_settings')
      .insert({ id: COMPANY_SIGNATURE_SETTINGS_ID })
      .select(SETTINGS_SELECT)
      .maybeSingle();
    if (insertError || !inserted) {
      return { ...DEFAULT_COMPANY_SIGNATURE_SETTINGS };
    }
    return mapSettings(inserted as Record<string, unknown>);
  }

  return mapSettings(data as Record<string, unknown>);
}

export async function saveCompanySignatureSettings(
  patch: Partial<CompanySignatureSettings>,
): Promise<CompanySignatureSettings> {
  const rest = { ...patch };
  delete rest.id;
  delete rest.updated_at;
  const { data, error } = await supabase
    .from('company_signature_settings')
    .upsert({ id: COMPANY_SIGNATURE_SETTINGS_ID, ...rest }, { onConflict: 'id' })
    .select(SETTINGS_SELECT)
    .single();

  if (error) throw error;
  return mapSettings(data as Record<string, unknown>);
}

export async function fetchUserSignatureProfile(
  employeeId: number,
): Promise<UserSignatureProfile> {
  const { data, error } = await supabase
    .from('user_signature_profiles')
    .select('id, employee_id, job_title, department_override, signature_enabled')
    .eq('employee_id', employeeId)
    .maybeSingle();

  if (error) {
    console.warn('user_signature_profiles unavailable:', error.message);
    return emptySignatureProfile(employeeId);
  }
  if (!data) return emptySignatureProfile(employeeId);

  return {
    id: asString(data.id) || null,
    employee_id: Number(data.employee_id) || employeeId,
    job_title: asString(data.job_title),
    department_override: asString(data.department_override),
    signature_enabled: asBool(data.signature_enabled, true),
  };
}

export async function upsertUserSignatureProfile(
  employeeId: number,
  patch: Pick<UserSignatureProfile, 'job_title' | 'department_override' | 'signature_enabled'>,
): Promise<UserSignatureProfile> {
  const payload = {
    employee_id: employeeId,
    job_title: patch.job_title.trim() || null,
    department_override: patch.department_override.trim() || null,
    signature_enabled: patch.signature_enabled,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('user_signature_profiles')
    .upsert(payload, { onConflict: 'employee_id' })
    .select('id, employee_id, job_title, department_override, signature_enabled')
    .single();

  if (error) throw error;

  return {
    id: asString(data.id) || null,
    employee_id: Number(data.employee_id) || employeeId,
    job_title: asString(data.job_title),
    department_override: asString(data.department_override),
    signature_enabled: asBool(data.signature_enabled, true),
  };
}

export async function updateEmployeeSignatureContact(
  employeeId: number,
  fields: {
    official_name?: string;
    mobile?: string;
    phone?: string;
    photo_url?: string | null;
  },
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (fields.official_name != null) update.official_name = fields.official_name.trim();
  if (fields.mobile != null) update.mobile = fields.mobile.trim();
  if (fields.phone != null) update.phone = fields.phone.trim();
  if (fields.photo_url !== undefined) update.photo_url = fields.photo_url;

  if (Object.keys(update).length === 0) return;

  const { error } = await supabase
    .from('tenants_employee')
    .update(update)
    .eq('id', employeeId);

  if (error) throw error;
}

async function fetchEmployeeEmail(employeeId: number): Promise<string | null> {
  const { data } = await supabase
    .from('users')
    .select('email')
    .eq('employee_id', employeeId)
    .maybeSingle();
  return asNullableString(data?.email);
}

export async function fetchSignatureEmployee(
  employeeId: number,
  options?: { email?: string | null },
): Promise<SignatureEmployeeRow | null> {
  const { data, error } = await supabase
    .from('tenants_employee')
    .select(`
      id,
      display_name,
      official_name,
      photo_url,
      photo,
      mobile,
      phone,
      fired,
      department_id,
      tenant_departement!department_id ( name )
    `)
    .eq('id', employeeId)
    .maybeSingle();

  if (error || !data) return null;

  const dept = data.tenant_departement as { name?: string } | { name?: string }[] | null;
  const departmentName = Array.isArray(dept) ? dept[0]?.name : dept?.name;
  const email =
    options && 'email' in options
      ? asNullableString(options.email)
      : await fetchEmployeeEmail(employeeId);

  return {
    id: Number(data.id),
    display_name: asString(data.display_name),
    official_name: asString(data.official_name) || asString(data.display_name),
    photo_url: asNullableString(data.photo_url),
    photo: asNullableString(data.photo),
    mobile: asNullableString(data.mobile),
    phone: asNullableString(data.phone),
    department_name: departmentName || '',
    email,
    fired: Boolean(data.fired),
  };
}

export async function fetchSignatureEmployeeDirectory(): Promise<SignatureEmployeeRow[]> {
  const { data: employees, error } = await supabase
    .from('tenants_employee')
    .select(`
      id,
      display_name,
      official_name,
      photo_url,
      photo,
      mobile,
      phone,
      fired,
      department_id,
      tenant_departement!department_id ( name )
    `)
    .or('fired.is.null,fired.eq.false')
    .order('official_name', { ascending: true });

  if (error || !employees) {
    console.warn('Failed to load signature employee directory:', error?.message);
    return [];
  }

  const ids = employees.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
  const emailByEmployeeId = new Map<number, string>();

  if (ids.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('employee_id, email')
      .in('employee_id', ids);
    for (const user of users || []) {
      const employeeId = Number(user.employee_id);
      const email = asNullableString(user.email);
      if (employeeId && email) emailByEmployeeId.set(employeeId, email);
    }
  }

  return employees.map((row) => {
    const dept = row.tenant_departement as { name?: string } | { name?: string }[] | null;
    const departmentName = Array.isArray(dept) ? dept[0]?.name : dept?.name;
    const id = Number(row.id);
    return {
      id,
      display_name: asString(row.display_name),
      official_name: asString(row.official_name) || asString(row.display_name),
      photo_url: asNullableString(row.photo_url),
      photo: asNullableString(row.photo),
      mobile: asNullableString(row.mobile),
      phone: asNullableString(row.phone),
      department_name: departmentName || '',
      email: emailByEmployeeId.get(id) || null,
      fired: Boolean(row.fired),
    };
  });
}

export async function fetchCurrentUserSignatureContext(): Promise<{
  employee: SignatureEmployeeRow;
  profile: UserSignatureProfile;
  settings: CompanySignatureSettings;
} | null> {
  // getSession() is local; getUser() hits the Auth server and stalls compose.
  const { data: sessionData } = await supabase.auth.getSession();
  let userId = sessionData.session?.user?.id || '';
  if (!userId) {
    const { data: auth } = await supabase.auth.getUser();
    userId = auth.user?.id || '';
  }
  if (!userId) return null;

  const { data: userRow } = await supabase
    .from('users')
    .select('employee_id, email')
    .eq('auth_id', userId)
    .maybeSingle();

  const employeeId = Number(userRow?.employee_id);
  if (!employeeId) return null;

  const [employee, profile, settings] = await Promise.all([
    fetchSignatureEmployee(employeeId, { email: userRow?.email ?? null }),
    fetchUserSignatureProfile(employeeId),
    fetchCompanySignatureSettings(),
  ]);

  if (!employee) return null;
  if (!employee.email && userRow?.email) {
    employee.email = asNullableString(userRow.email);
  }

  return { employee, profile, settings };
}

export function isPublicHttpsImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('data:')) return false;
  if (!isUsableEmployeePhotoUrl(trimmed)) return false;
  return /^https:\/\//i.test(trimmed) || trimmed.startsWith('/');
}

export function toAbsolutePublicUrl(url: string | null | undefined, origin?: string): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('data:')) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!trimmed.startsWith('/')) return '';
  const base =
    origin ||
    (typeof window !== 'undefined' ? window.location.origin : '') ||
    '';
  return base ? `${base}${trimmed}` : trimmed;
}

export async function uploadSignatureAsset(
  file: File,
  prefix: string,
): Promise<string> {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `company/${prefix}_${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(SIGNATURE_IMAGES_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: true,
    contentType: file.type || `image/${ext}`,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(SIGNATURE_IMAGES_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadEmployeeSignaturePhoto(
  employeeId: number,
  file: File,
): Promise<string> {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${employeeId}_avatar_sig_${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('My-Profile').upload(path, file, {
    cacheControl: '3600',
    upsert: true,
    contentType: file.type || `image/${ext}`,
  });
  if (error) throw error;
  const { data } = supabase.storage.from('My-Profile').getPublicUrl(path);
  const publicUrl = data.publicUrl;
  await updateEmployeeSignatureContact(employeeId, { photo_url: publicUrl });
  return publicUrl;
}
