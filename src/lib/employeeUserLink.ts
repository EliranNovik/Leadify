import { supabase } from './supabase';

/**
 * Next numeric primary key for tables that use integer identity but often need
 * an explicit id (sequence can lag behind MAX(id) after manual inserts).
 */
export async function fetchNextNumericId(tableName: string): Promise<number> {
  const { data, error } = await supabase
    .from(tableName)
    .select('id')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not resolve next id for ${tableName}: ${error.message}`);
  }

  const maxId = data?.id != null ? Number(data.id) : 0;
  if (!Number.isFinite(maxId) || maxId < 0) {
    throw new Error(`Invalid max id for ${tableName}: ${String(data?.id)}`);
  }

  return Math.floor(maxId) + 1;
}

/**
 * Insert a row with an explicit next id, retrying on unique conflicts (23505).
 * Never falls back to id=1.
 */
export async function insertWithNextNumericId<T = any>(
  tableName: string,
  payload: Record<string, unknown>,
  options?: { maxAttempts?: number },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 8;
  let candidate = await fetchNextNumericId(tableName);
  let lastError: { code?: string; message?: string } | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const insertPayload = { ...payload, id: candidate };
    delete (insertPayload as any).created_at;
    delete (insertPayload as any).updated_at;

    const { data, error } = await supabase
      .from(tableName)
      .insert([insertPayload])
      .select()
      .single();

    if (!error) {
      return data as T;
    }

    lastError = error;
    if (error.code !== '23505') {
      throw error;
    }

    // Collision — re-read max and bump past the failed candidate.
    const freshNext = await fetchNextNumericId(tableName);
    candidate = Math.max(freshNext, candidate + 1);
  }

  throw lastError ?? new Error(`Failed to insert into ${tableName} after ${maxAttempts} id attempts`);
}

/**
 * Canonical employee↔user link is users.employee_id → tenants_employee.id.
 * Clears any previous user linked to this employee, then assigns the selected user.
 */
export async function syncEmployeeConnectedUser(
  employeeId: number,
  userId: string | null | undefined,
): Promise<void> {
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    throw new Error('Invalid employee id for user link');
  }

  const { error: clearError } = await supabase
    .from('users')
    .update({ employee_id: null })
    .eq('employee_id', employeeId);

  if (clearError) {
    throw clearError;
  }

  const trimmed = userId != null ? String(userId).trim() : '';
  if (!trimmed) return;

  const { error: linkError } = await supabase
    .from('users')
    .update({ employee_id: employeeId, is_staff: true, is_active: true })
    .eq('id', trimmed);

  if (linkError) {
    throw linkError;
  }
}

export async function fetchUserIdLinkedToEmployee(
  employeeId: number,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('employee_id', employeeId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching linked user for employee:', error);
    return null;
  }

  return data?.id ? String(data.id) : null;
}
