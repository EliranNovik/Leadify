import { supabase } from './supabase';

export type ClockInGateStatus =
  | 'loading'
  | 'exempt'
  | 'no_employee'
  | 'blocked'
  | 'allowed';

export type ClockInGateProfile = {
  isExternalUser: boolean;
  employeeId: number | null;
};

export type FetchClockInGateProfileResult = {
  profile: ClockInGateProfile;
  /** True when a `users` row was returned (not an empty RLS/auth miss). */
  userRowFound: boolean;
  /** True when the Supabase query itself failed. */
  queryFailed: boolean;
};

function parseExternFlag(extern: unknown): boolean {
  return (
    extern === true
    || extern === 'true'
    || extern === 1
    || extern === '1'
    || (typeof extern === 'string' && extern.toLowerCase() === 'true')
  );
}

function toEmployeeId(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function profileFromRow(row: { employee_id?: unknown; extern?: unknown } | null): ClockInGateProfile {
  return {
    isExternalUser: parseExternFlag(row?.extern),
    employeeId: toEmployeeId(row?.employee_id),
  };
}

async function queryClockInGateProfileRow(
  authUserId: string,
  email?: string | null,
): Promise<{ row: { employee_id?: unknown; extern?: unknown } | null; error: unknown | null }> {
  const { data, error } = await supabase
    .from('users')
    .select('employee_id, extern')
    .eq('auth_id', authUserId)
    .maybeSingle();

  if (!error && data) {
    return { row: data, error: null };
  }

  // Same fallback as AuthContext — some accounts resolve by email when auth_id lags.
  if (email) {
    const byEmail = await supabase
      .from('users')
      .select('employee_id, extern')
      .eq('email', email)
      .maybeSingle();

    if (!byEmail.error && byEmail.data) {
      return { row: byEmail.data, error: null };
    }

    if (error) {
      return { row: null, error };
    }
    if (byEmail.error) {
      return { row: null, error: byEmail.error };
    }
  }

  if (error) {
    return { row: null, error };
  }

  return { row: null, error: null };
}

/**
 * Loads clock-in gate profile for the signed-in auth user.
 *
 * Important: an empty result ({ data: null, error: null }) can mean either
 * "no users row" OR a transient JWT/RLS miss. Callers must not treat that as
 * a confirmed unlinked account without retry / prior-state guards.
 */
export async function fetchClockInGateProfile(
  authUserId: string,
  options?: { email?: string | null; retryOnEmpty?: boolean },
): Promise<FetchClockInGateProfileResult> {
  const email = options?.email ?? null;
  const retryOnEmpty = options?.retryOnEmpty !== false;

  let { row, error } = await queryClockInGateProfileRow(authUserId, email);

  if (error) {
    console.error('Clock-in gate: failed to load user profile', error);
    return {
      profile: { isExternalUser: false, employeeId: null },
      userRowFound: false,
      queryFailed: true,
    };
  }

  if (!row && retryOnEmpty) {
    // Empty can be a race: session marked ready before the JWT is attached to PostgREST.
    await new Promise((r) => setTimeout(r, 200));
    await supabase.auth.getSession().catch(() => null);
    const retry = await queryClockInGateProfileRow(authUserId, email);
    if (retry.error) {
      console.error('Clock-in gate: failed to load user profile (retry)', retry.error);
      return {
        profile: { isExternalUser: false, employeeId: null },
        userRowFound: false,
        queryFailed: true,
      };
    }
    row = retry.row;
  }

  if (!row) {
    return {
      profile: { isExternalUser: false, employeeId: null },
      userRowFound: false,
      queryFailed: false,
    };
  }

  return {
    profile: profileFromRow(row),
    userRowFound: true,
    queryFailed: false,
  };
}

export async function fetchIsEmployeeClockedIn(employeeId: number): Promise<boolean> {
  const { data, error } = await supabase
    .from('employee_clock_in')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('is_active', true)
    .order('clock_in_time', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error('Clock-in gate: failed to check active clock-in', error);
    return false;
  }

  return data != null;
}

export function resolveClockInGateStatus(
  profile: ClockInGateProfile,
  isClockedIn: boolean,
): ClockInGateStatus {
  if (profile.isExternalUser) return 'exempt';
  if (profile.employeeId == null) return 'no_employee';
  return isClockedIn ? 'allowed' : 'blocked';
}

export function isClockInGateOpen(status: ClockInGateStatus): boolean {
  return status === 'exempt' || status === 'allowed';
}
