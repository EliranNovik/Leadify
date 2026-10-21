import { fetchMainDepartments } from './mainDepartments';

/**
 * Office documents are kept in one space per firm department, plus the original admin-only
 * space. `scopeKey` is what `document_index` reports for a row, so the drive can filter on it.
 */
export type OfficeSpace = {
  scopeKey: string;
  label: string;
  departmentId: number | null;
  /**
   * Scope keys this space answers to. The admin space also takes 'office', which is what the
   * first version of document_index reported before it knew about departments.
   */
  matchScopeKeys: string[];
};

export const OFFICE_ADMIN_SPACE: OfficeSpace = {
  scopeKey: 'admins',
  label: 'Admins',
  departmentId: null,
  matchScopeKeys: ['admins', 'office'],
};

export function officeSpaceScopeKey(departmentId: number | null): string {
  return departmentId == null ? OFFICE_ADMIN_SPACE.scopeKey : `dept-${departmentId}`;
}

export async function fetchOfficeSpaces(): Promise<OfficeSpace[]> {
  const departments = await fetchMainDepartments();
  return [
    OFFICE_ADMIN_SPACE,
    ...departments.map((department) => ({
      scopeKey: officeSpaceScopeKey(department.id),
      label: department.name,
      departmentId: department.id,
      matchScopeKeys: [officeSpaceScopeKey(department.id)],
    })),
  ];
}
