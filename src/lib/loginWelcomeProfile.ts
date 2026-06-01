import { supabase } from './supabase';

export type WelcomeProfile = {
  name: string;
  imageUrl: string;
};

/** Resolve display name + avatar for post-login welcome UI. */
export async function fetchWelcomeProfileForEmail(email: string, authUser?: { user_metadata?: Record<string, unknown> }): Promise<WelcomeProfile> {
  let name = email;
  let imageUrl = '';

  const { data: withJoin, error: joinErr } = await supabase
    .from('users')
    .select(`
      first_name,
      last_name,
      full_name,
      employee_id,
      tenants_employee!users_employee_id_fkey(
        official_name,
        display_name,
        photo,
        photo_url
      )
    `)
    .eq('email', email)
    .single();

  let userData: {
    first_name?: string;
    last_name?: string;
    full_name?: string;
    tenants_employee?: unknown;
  } | null = null;

  if (!joinErr && withJoin) {
    userData = withJoin;
  } else {
    const { data: fallbackData, error: fallbackErr } = await supabase
      .from('users')
      .select('first_name, last_name, full_name, employee_id')
      .eq('email', email)
      .single();
    if (!fallbackErr && fallbackData) {
      userData = fallbackData;
    }
  }

  if (userData) {
    const empData = userData.tenants_employee
      ? (Array.isArray(userData.tenants_employee) ? userData.tenants_employee[0] : userData.tenants_employee)
      : null;

    if (empData && typeof empData === 'object') {
      const emp = empData as { photo_url?: string; photo?: string; official_name?: string; display_name?: string };
      imageUrl = (emp.photo_url && String(emp.photo_url).trim()) || (emp.photo && String(emp.photo).trim()) || '';
      if (emp.official_name?.trim()) {
        name = emp.official_name.trim();
      } else if (emp.display_name?.trim()) {
        name = emp.display_name.trim();
      } else if (userData.first_name?.trim() && userData.last_name?.trim()) {
        name = `${userData.first_name.trim()} ${userData.last_name.trim()}`;
      } else if (userData.full_name?.trim()) {
        name = userData.full_name.trim();
      }
    } else if (userData.first_name?.trim() && userData.last_name?.trim()) {
      name = `${userData.first_name.trim()} ${userData.last_name.trim()}`;
    } else if (userData.full_name?.trim()) {
      name = userData.full_name.trim();
    }
  } else if (authUser?.user_metadata) {
    const meta = authUser.user_metadata;
    const fromMeta = (meta.first_name as string) || (meta.full_name as string);
    if (fromMeta?.trim()) name = fromMeta.trim();
  }

  return { name, imageUrl };
}
