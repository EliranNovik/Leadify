import { supabase } from './supabase';
import {
  getUnavailabilityApprovalStatus,
  normalizeUnavailabilityApprovalFields,
  unavailabilityDateRangeLabel,
  unavailabilityReasonText,
  unavailabilityTypeLabel,
  type EmployeeUnavailabilityEntry,
  type UnavailabilityType,
  UNAVAILABILITY_SELECT,
} from './employeeUnavailabilities';

export type UnavailabilityApprovalRecord = EmployeeUnavailabilityEntry & {
  employee_name?: string;
  employee_department?: string;
  employee_photo_url?: string | null;
  employee_email?: string | null;
  employee_phone?: string | null;
  employee_mobile?: string | null;
  employee_chat_user_id?: string | null;
};

type UnavailabilityApprovalRow = EmployeeUnavailabilityEntry & {
  tenants_employee?:
    | {
        display_name: string | null;
        photo_url?: string | null;
        photo?: string | null;
        phone?: string | null;
        mobile?: string | null;
        tenant_departement?: { name: string } | { name: string }[] | null;
      }
    | Array<{
        display_name: string | null;
        photo_url?: string | null;
        photo?: string | null;
        phone?: string | null;
        mobile?: string | null;
        tenant_departement?: { name: string } | { name: string }[] | null;
      }>
    | null;
};

const PENDING_WITH_EMPLOYEE_SELECT = `
  ${UNAVAILABILITY_SELECT},
  tenants_employee!employee_id (
    display_name,
    photo_url,
    photo,
    phone,
    mobile,
    tenant_departement!department_id ( name )
  )
`;

function mapApprovalRows(rows: UnavailabilityApprovalRow[]): UnavailabilityApprovalRecord[] {
  return rows.map((row) => {
    const te = Array.isArray(row.tenants_employee) ? row.tenants_employee[0] : row.tenants_employee;
    const dept = Array.isArray(te?.tenant_departement)
      ? te?.tenant_departement[0]
      : te?.tenant_departement;
    const normalized = normalizeUnavailabilityApprovalFields(row);
    return {
      ...normalized,
      employee_name: te?.display_name?.trim() || `Employee #${row.employee_id}`,
      employee_department: dept?.name || '—',
      employee_photo_url:
        (typeof te?.photo_url === 'string' && te.photo_url.trim()) ||
        (typeof te?.photo === 'string' && te.photo.trim()) ||
        null,
      employee_phone: te?.phone?.trim() || null,
      employee_mobile: te?.mobile?.trim() || null,
    };
  });
}

async function enrichWithContacts(
  rows: UnavailabilityApprovalRecord[],
): Promise<UnavailabilityApprovalRecord[]> {
  const employeeIds = [...new Set(rows.map((row) => row.employee_id))];
  if (employeeIds.length === 0) return rows;

  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, employee_id')
    .in('employee_id', employeeIds);

  if (error) throw error;

  const userByEmployeeId = new Map<number, { id: string; email: string | null }>();
  for (const user of users || []) {
    if (user.employee_id == null) continue;
    userByEmployeeId.set(user.employee_id, {
      id: user.id,
      email: user.email ?? null,
    });
  }

  return rows.map((row) => {
    const linkedUser = userByEmployeeId.get(row.employee_id);
    return {
      ...row,
      employee_email: linkedUser?.email ?? row.employee_email ?? null,
      employee_chat_user_id: linkedUser?.id ?? null,
    };
  });
}

export async function fetchPendingUnavailabilityCount(): Promise<number> {
  const { count, error } = await supabase
    .from('employee_unavailability_reasons')
    .select('id', { count: 'exact', head: true })
    .eq('approved', false)
    .eq('declined', false);

  if (error) throw error;
  return count ?? 0;
}

export async function fetchPendingUnavailabilitiesForApproval(): Promise<UnavailabilityApprovalRecord[]> {
  const { data, error } = await supabase
    .from('employee_unavailability_reasons')
    .select(PENDING_WITH_EMPLOYEE_SELECT)
    .eq('approved', false)
    .eq('declined', false)
    .order('start_date', { ascending: true });

  if (error) throw error;
  const mapped = mapApprovalRows((data || []) as UnavailabilityApprovalRow[]);
  return enrichWithContacts(mapped);
}

export async function approveUnavailabilityRecord(
  recordId: number,
  approverAuthUserId: string,
): Promise<void> {
  const { error } = await supabase
    .from('employee_unavailability_reasons')
    .update({
      approved: true,
      declined: false,
      approved_by: approverAuthUserId,
      approved_at: new Date().toISOString(),
      decline_note: null,
    })
    .eq('id', recordId);

  if (error) throw error;
}

export async function declineUnavailabilityRecord(
  recordId: number,
  approverAuthUserId: string,
  declineNote?: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('employee_unavailability_reasons')
    .update({
      approved: false,
      declined: true,
      approved_by: approverAuthUserId,
      approved_at: new Date().toISOString(),
      decline_note: declineNote?.trim() || null,
    })
    .eq('id', recordId);

  if (error) throw error;
}

export function unavailabilityApprovalSummary(record: UnavailabilityApprovalRecord): string {
  const type = unavailabilityTypeLabel(record.unavailability_type);
  const range = unavailabilityDateRangeLabel(record.start_date, record.end_date);
  const reason = unavailabilityReasonText(record);
  return `${type}: ${range}${reason && reason !== '—' ? ` — ${reason}` : ''}`;
}

export function unavailabilityNeedsDocument(record: {
  unavailability_type: UnavailabilityType | string;
  document_url?: string | null;
}): boolean {
  return (
    record.unavailability_type === 'sick_days' &&
    !Boolean(record.document_url?.trim())
  );
}

export { getUnavailabilityApprovalStatus };
