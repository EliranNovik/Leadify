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

function parseExternFlag(extern: unknown): boolean {
  return (
    extern === true
    || extern === 'true'
    || extern === 1
    || extern === '1'
    || (typeof extern === 'string' && extern.toLowerCase() === 'true')
  );
}

export async function fetchClockInGateProfile(authUserId: string): Promise<ClockInGateProfile> {
  const { data, error } = await supabase
    .from('users')
    .select('employee_id, extern')
    .eq('auth_id', authUserId)
    .maybeSingle();

  if (error) {
    console.error('Clock-in gate: failed to load user profile', error);
    return { isExternalUser: false, employeeId: null };
  }

  const employeeId = data?.employee_id != null && data.employee_id !== ''
    ? Number(data.employee_id)
    : null;

  return {
    isExternalUser: parseExternFlag(data?.extern),
    employeeId: Number.isFinite(employeeId) ? employeeId : null,
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
