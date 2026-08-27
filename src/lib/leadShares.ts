import { supabase } from './supabase';

export type LeadShareNotification = {
  id: string;
  leadNumber: string;
  leadRouteId: string;
  leadName: string | null;
  createdAt: string;
  sharedByEmployeeId: number;
  sharedByName: string;
  sharedByPhotoUrl: string | null;
};

type SharerEmployeeJoin = {
  id?: number | null;
  display_name?: string | null;
  photo_url?: string | null;
  photo?: string | null;
};

function asEmployee(join: SharerEmployeeJoin | SharerEmployeeJoin[] | null | undefined): SharerEmployeeJoin | null {
  if (!join) return null;
  return Array.isArray(join) ? join[0] ?? null : join;
}

export async function resolveAuthEmployeeId(authUserId: string | null | undefined): Promise<number | null> {
  const authId = String(authUserId ?? '').trim();
  if (!authId) return null;

  const { data: userRow } = await supabase
    .from('users')
    .select('id, employee_id')
    .eq('auth_id', authId)
    .maybeSingle();

  const fromUsers = Number(userRow?.employee_id);
  if (Number.isFinite(fromUsers) && fromUsers > 0) return fromUsers;

  if (userRow?.id) {
    const { data: emp } = await supabase
      .from('tenants_employee')
      .select('id')
      .eq('user_id', userRow.id)
      .maybeSingle();
    const fromEmp = Number(emp?.id);
    if (Number.isFinite(fromEmp) && fromEmp > 0) return fromEmp;
  }

  return null;
}

export async function createLeadShare(params: {
  leadNumber: string;
  leadRouteId: string;
  leadName: string | null;
  sharedByEmployeeId: number;
  sharedWithEmployeeId: number;
}): Promise<{ ok: true } | { ok: false; reason: 'self' | 'duplicate' | 'error'; message: string }> {
  const leadRouteId = String(params.leadRouteId ?? '').trim();
  const leadNumber = String(params.leadNumber ?? '').trim() || leadRouteId;
  if (!leadRouteId) {
    return { ok: false, reason: 'error', message: 'Missing lead' };
  }
  if (params.sharedByEmployeeId === params.sharedWithEmployeeId) {
    return { ok: false, reason: 'self', message: 'You cannot share a lead with yourself' };
  }

  const { data: existing, error: existingError } = await supabase
    .from('lead_shares')
    .select('id')
    .eq('shared_with_employee_id', params.sharedWithEmployeeId)
    .eq('lead_route_id', leadRouteId)
    .is('read_at', null)
    .limit(1);

  if (existingError) {
    console.error('Lead share duplicate check failed:', existingError);
    return { ok: false, reason: 'error', message: 'Could not share lead' };
  }
  if (existing && existing.length > 0) {
    return { ok: false, reason: 'duplicate', message: 'This lead is already shared with them' };
  }

  const { error } = await supabase.from('lead_shares').insert({
    lead_number: leadNumber,
    lead_route_id: leadRouteId,
    lead_name: params.leadName?.trim() || null,
    shared_by_employee_id: params.sharedByEmployeeId,
    shared_with_employee_id: params.sharedWithEmployeeId,
  });

  if (error) {
    console.error('Lead share insert failed:', error);
    return { ok: false, reason: 'error', message: 'Could not share lead' };
  }
  return { ok: true };
}

export async function fetchUnreadLeadShares(employeeId: number): Promise<LeadShareNotification[]> {
  if (!Number.isFinite(employeeId) || employeeId <= 0) return [];

  const { data, error } = await supabase
    .from('lead_shares')
    .select(`
      id,
      lead_number,
      lead_route_id,
      lead_name,
      created_at,
      shared_by_employee_id,
      sharer:tenants_employee!shared_by_employee_id (
        id,
        display_name,
        photo_url,
        photo
      )
    `)
    .eq('shared_with_employee_id', employeeId)
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(50);

  let rows = data ?? [];
  if (error) {
    const fallback = await supabase
      .from('lead_shares')
      .select('id, lead_number, lead_route_id, lead_name, created_at, shared_by_employee_id')
      .eq('shared_with_employee_id', employeeId)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(50);
    if (fallback.error) {
      console.error('Error fetching lead shares:', error, fallback.error);
      return [];
    }
    rows = fallback.data ?? [];
  }

  const missingSharerIds = [...new Set(
    rows
      .filter((row: any) => !asEmployee(row.sharer) && !asEmployee(row.tenants_employee))
      .map((row: any) => Number(row.shared_by_employee_id))
      .filter((id) => Number.isFinite(id) && id > 0),
  )];

  const sharerById = new Map<number, SharerEmployeeJoin>();
  if (missingSharerIds.length > 0) {
    const { data: employees } = await supabase
      .from('tenants_employee')
      .select('id, display_name, photo_url, photo')
      .in('id', missingSharerIds);
    for (const emp of employees ?? []) {
      sharerById.set(Number(emp.id), emp);
    }
  }

  return rows.map((row: any) => {
    const sharer = asEmployee(row.sharer) || asEmployee(row.tenants_employee) || sharerById.get(Number(row.shared_by_employee_id)) || null;
    const employeeIdRaw = Number(row.shared_by_employee_id ?? sharer?.id);
    return {
      id: String(row.id),
      leadNumber: String(row.lead_number ?? '').trim(),
      leadRouteId: String(row.lead_route_id ?? '').trim(),
      leadName: row.lead_name ? String(row.lead_name).trim() : null,
      createdAt: String(row.created_at ?? ''),
      sharedByEmployeeId: Number.isFinite(employeeIdRaw) ? employeeIdRaw : 0,
      sharedByName: String(sharer?.display_name ?? '').trim() || 'Someone',
      sharedByPhotoUrl: String(sharer?.photo_url || sharer?.photo || '').trim() || null,
    };
  });
}

export async function markLeadSharesRead(ids: string[]): Promise<void> {
  const unique = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
  if (unique.length === 0) return;
  const { error } = await supabase
    .from('lead_shares')
    .update({ read_at: new Date().toISOString() })
    .in('id', unique)
    .is('read_at', null);
  if (error) {
    console.error('Error marking lead shares as read:', error);
  }
}
