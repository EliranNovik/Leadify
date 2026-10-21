import { supabase } from './supabase';

/**
 * Folder permissions (`public.document_folder_access`). A grant covers the folder it names and
 * everything under it. A folder with no grant anywhere up its chain is open to all staff, so
 * adding the first grant is what locks a folder down.
 *
 * Only admins may write these; the policies in sql/2026-10-21_document_folders.sql enforce it,
 * the UI only hides the controls.
 */

export type DocumentFolderGrant = {
  id: string;
  folder_id: string;
  employee_id: number | null;
  department_id: number | null;
  role: string | null;
  can_view: boolean;
  can_edit: boolean;
  created_at: string;
};

/** Login roles from `users.role`, matching the User Management dropdown. */
export const DOCUMENT_ACCESS_ROLES = [
  'admin',
  'handler',
  'closer',
  'scheduler',
  'expert',
  'user',
] as const;

const GRANT_SELECT =
  'id, folder_id, employee_id, department_id, role, can_view, can_edit, created_at';

export async function fetchFolderGrants(folderId: string): Promise<DocumentFolderGrant[]> {
  const { data, error } = await supabase
    .from('document_folder_access')
    .select(GRANT_SELECT)
    .eq('folder_id', folderId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []) as DocumentFolderGrant[];
}

export type NewFolderGrant = {
  folderId: string;
  employeeId?: number | null;
  departmentId?: number | null;
  role?: string | null;
  canEdit?: boolean;
  grantedByEmployeeId?: number | null;
};

export async function addFolderGrant(grant: NewFolderGrant): Promise<DocumentFolderGrant> {
  const subjects = [grant.employeeId, grant.departmentId, grant.role].filter(
    (value) => value != null && value !== '',
  );
  if (subjects.length !== 1) {
    throw new Error('Pick exactly one person, department or role');
  }

  const { data, error } = await supabase
    .from('document_folder_access')
    .insert({
      folder_id: grant.folderId,
      employee_id: grant.employeeId ?? null,
      department_id: grant.departmentId ?? null,
      role: grant.role || null,
      can_view: true,
      can_edit: grant.canEdit ?? false,
      granted_by_employee_id: grant.grantedByEmployeeId ?? null,
    })
    .select(GRANT_SELECT)
    .single();

  if (error) throw error;
  return data as DocumentFolderGrant;
}

export async function setFolderGrantCanEdit(
  grantId: string,
  canEdit: boolean,
): Promise<DocumentFolderGrant> {
  const { data, error } = await supabase
    .from('document_folder_access')
    .update({ can_edit: canEdit })
    .eq('id', grantId)
    .select(GRANT_SELECT)
    .single();

  if (error) throw error;
  return data as DocumentFolderGrant;
}

export async function removeFolderGrant(grantId: string): Promise<void> {
  const { error } = await supabase.from('document_folder_access').delete().eq('id', grantId);
  if (error) throw error;
}

export type DepartmentOption = { id: number; name: string };

export async function fetchDepartmentOptions(): Promise<DepartmentOption[]> {
  const { data, error } = await supabase
    .from('tenant_departement')
    .select('id, name')
    .order('name', { ascending: true });

  if (error) throw error;
  return (data || []).filter((row: any) => row?.name) as DepartmentOption[];
}

export function describeGrantSubject(
  grant: DocumentFolderGrant,
  employeeNames: Map<number, string>,
  departmentNames: Map<number, string>,
): string {
  if (grant.employee_id != null) {
    return employeeNames.get(grant.employee_id) || `Employee ${grant.employee_id}`;
  }
  if (grant.department_id != null) {
    return `${departmentNames.get(grant.department_id) || `Department ${grant.department_id}`} (department)`;
  }
  if (grant.role) {
    return `Everyone with the ${grant.role} role`;
  }
  return 'Unknown';
}
