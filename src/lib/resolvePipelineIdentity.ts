import { supabase } from './supabase';

export type PipelineViewAs = {
  employeeId: number;
  displayName: string;
  fullName: string;
  userId: string | null;
  photoUrl: string | null;
};

export type PipelineIdentity = {
  userId: string | null;
  employeeId: number;
  displayName: string;
  fullName: string;
};

/** Identity used to load a pipeline: the viewed employee, or the signed-in user. */
export async function resolvePipelineIdentity(
  viewAs?: PipelineViewAs | null,
): Promise<PipelineIdentity> {
  if (viewAs?.employeeId) {
    return {
      userId: viewAs.userId,
      employeeId: viewAs.employeeId,
      displayName: viewAs.displayName || viewAs.fullName,
      fullName: viewAs.fullName || viewAs.displayName,
    };
  }

  const { data: authData } = await supabase.auth.getUser();
  const authId = authData.user?.id;
  if (!authId) throw new Error('Not signed in');

  const { data: userRow, error } = await supabase
    .from('users')
    .select(
      `
      id,
      employee_id,
      full_name,
      tenants_employee!employee_id (
        id,
        display_name
      )
    `,
    )
    .eq('auth_id', authId)
    .maybeSingle();
  if (error) throw error;

  const employeeId = userRow?.employee_id != null ? Number(userRow.employee_id) : null;
  const empJoin = userRow?.tenants_employee as { display_name?: string } | { display_name?: string }[] | null;
  const joined = Array.isArray(empJoin) ? empJoin[0] : empJoin;
  const displayName = String(joined?.display_name || userRow?.full_name || '').trim();
  const fullName = String(userRow?.full_name || displayName).trim();
  if (!employeeId) throw new Error('No employee record for the current user');

  return {
    userId: userRow?.id ? String(userRow.id) : null,
    employeeId,
    displayName: displayName || fullName,
    fullName: fullName || displayName,
  };
}
