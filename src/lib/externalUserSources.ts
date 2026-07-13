import { supabase } from './supabase';
import { parseExternSourceIds } from '../components/ExternalUserLeadsGraph';

/** misc_leadsource ids assigned to the logged-in external user (`users.extern_source_id`). */
export async function fetchCurrentUserExternSourceIds(): Promise<string[]> {
  const {
    data: { user: authUser },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !authUser) {
    return [];
  }

  const { data: row, error } = await supabase
    .from('users')
    .select('extern_source_id')
    .eq('auth_id', authUser.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const ids = parseExternSourceIds(row?.extern_source_id);
  return ids.map((id) => String(id));
}
