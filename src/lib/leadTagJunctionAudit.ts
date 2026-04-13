import { supabase } from './supabase';

/** Fields appended to each `leads_lead_tags` insert row for audit. */
export type LeadTagJunctionAuditFields = {
  employee_id: number | null;
  tagged_at: string;
};

/**
 * `tenants_employee.id` for the signed-in app user (via `users.employee_id`).
 */
export async function getEmployeeIdForLeadTagAudit(): Promise<number | null> {
  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user?.id) return null;

    let { data: userRow } = await supabase
      .from('users')
      .select('employee_id')
      .eq('auth_id', user.id)
      .maybeSingle();

    if ((userRow?.employee_id == null || userRow.employee_id === '') && user.email) {
      const { data: byEmail } = await supabase
        .from('users')
        .select('employee_id')
        .eq('email', user.email)
        .maybeSingle();
      userRow = byEmail;
    }

    if (userRow?.employee_id == null || userRow.employee_id === '') return null;
    const n = Number(userRow.employee_id);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function buildLeadTagJunctionAuditFields(): Promise<LeadTagJunctionAuditFields> {
  const employee_id = await getEmployeeIdForLeadTagAudit();
  return {
    employee_id,
    tagged_at: new Date().toISOString(),
  };
}
