import { buildApiUrl } from './api';
import { supabase } from './supabase';

/**
 * On hire: switch the linked CRM user's login email (users.email + auth) to the
 * Outlook/work address. The original private/recruitment email is preserved on
 * users.employee_private_email by the backend.
 */
export async function applyHireWorkEmail(userId: string, workEmail: string): Promise<void> {
  const id = String(userId || '').trim();
  const email = String(workEmail || '').trim().toLowerCase();
  if (!id) throw new Error('User id is required');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid work email is required');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Your admin session has expired. Please sign in again.');
  }

  const { data: existing, error: fetchError } = await supabase
    .from('users')
    .select('id, email, first_name, last_name, full_name, role, is_active, is_staff, is_superuser')
    .eq('id', id)
    .single();

  if (fetchError || !existing) {
    throw new Error(fetchError?.message || 'User not found');
  }

  const response = await fetch(buildApiUrl(`/api/users/${encodeURIComponent(id)}`), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      email,
      first_name: existing.first_name,
      last_name: existing.last_name,
      full_name: existing.full_name,
      role: existing.role,
      is_active: existing.is_active,
      is_staff: true,
      is_superuser: existing.is_superuser,
    }),
  });

  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) {
    throw new Error(result?.error || 'Failed to update work email on auth/user');
  }
}
