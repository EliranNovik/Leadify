import { supabase } from './supabase';
import { coerceEmployeeWorksFromHome } from './clockInLocations';
import { normalizeEmployeeMinHours } from './employeeLeadReporting';
import type { UnavailabilityType } from './employeeUnavailabilities';

export const CONTRIBUTION_DEPARTMENT_ROLES = ['Sales', 'Handlers', 'Partners', 'Marketing', 'Finance'] as const;

export type ContributionDepartmentRole = (typeof CONTRIBUTION_DEPARTMENT_ROLES)[number];

const EXCLUDED_EMPLOYEE_IDS = new Set([177, 137]);

const EXCLUDED_EMAILS = new Set(['noscheduler@lawoffice.org.il']);

const EXCLUDED_DISPLAY_NAMES = new Set([
  'FINANCE',
  'INTERNS',
  'NO SCHEDULER',
  'Mango Test',
  'pink',
  'Interns',
]);

/** Bonus roles grouped into leadership departments (not shown in tenant department sections). */
const LEADERSHIP_ROLE_TO_DEPARTMENT: Record<string, string> = {
  dv: 'Development',
  pm: 'Project Management',
  m: 'Management',
  z: 'Management',
  ma: 'Marketing',
  f: 'Finance',
  se: 'Administration',
  b: 'Bookkeeping',
  d: 'Operations',
  col: 'Collection',
};

const LEADERSHIP_DEPARTMENT_ORDER = [
  'Management',
  'Project Management',
  'Development',
  'Marketing',
  'Finance',
  'Bookkeeping',
  'Collection',
  'Administration',
  'Operations',
];

export interface OrganizationEmployee {
  id: number;
  display_name: string;
  official_name: string | null;
  photo_url: string | null;
  email: string;
  phone: string | null;
  mobile: string | null;
  employee_mobile: string | null;
  phone_ext: string | null;
  linkedin_url: string | null;
  chat_background_image_url: string | null;
  diplom: string | null;
  school: string | null;
  bonuses_role: string | null;
  department: string | null;
  department_id: number | null;
  min_hours: number;
  works_from_home: boolean;
  is_superuser: boolean;
  date_of_birth: string | null;
  fieldRoles: ContributionDepartmentRole[];
  chatUserId: string | null;
  isClockedIn: boolean;
  unavailabilityType: UnavailabilityType | null;
  unavailabilityStartDate: string | null;
  unavailabilityEndDate: string | null;
}

export interface OrganizationDepartmentGroup {
  name: string;
  employees: OrganizationEmployee[];
}

export interface OrganizationData {
  partners: OrganizationEmployee[];
  leadership: OrganizationDepartmentGroup[];
  departments: OrganizationDepartmentGroup[];
  allEmployees: OrganizationEmployee[];
}

export function getBonusesRoleDisplayName(roleCode: string | null | undefined): string {
  if (!roleCode) return '';

  const roleMap: Record<string, string> = {
    c: 'Closer',
    s: 'Scheduler',
    h: 'Handler',
    n: 'No role',
    e: 'Expert',
    z: 'Manager',
    Z: 'Manager',
    p: 'Partner',
    m: 'Manager',
    dm: 'Department Manager',
    pm: 'Project Manager',
    se: 'Secretary',
    b: 'Book keeper',
    partners: 'Partners',
    dv: 'Developer',
    ma: 'Marketing',
    P: 'Partner',
    M: 'Manager',
    DM: 'Department Manager',
    PM: 'Project Manager',
    SE: 'Secretary',
    B: 'Book keeper',
    Partners: 'Partners',
    d: 'Diverse',
    f: 'Finance',
    col: 'Collection',
    lawyer: 'Helper Closer',
  };

  return roleMap[roleCode] || roleCode;
}

export function getEmployeeDisplayLabel(employee: OrganizationEmployee): string {
  return employee.official_name?.trim() || employee.display_name || 'Unknown';
}

export function isPartnerBonusRole(bonusesRole: string | null | undefined): boolean {
  return bonusesRole?.trim().toLowerCase() === 'p';
}

export function isDepartmentManagerBonusRole(bonusesRole: string | null | undefined): boolean {
  return bonusesRole?.trim().toLowerCase() === 'dm';
}

export function getLeadershipDepartment(bonusesRole: string | null | undefined): string | null {
  const role = bonusesRole?.trim();
  if (!role || isPartnerBonusRole(role) || isDepartmentManagerBonusRole(role)) return null;
  return LEADERSHIP_ROLE_TO_DEPARTMENT[role.toLowerCase()] || null;
}

function isExcludedEmployee(
  employeeId: number,
  email: string | null | undefined,
  displayName: string,
): boolean {
  if (EXCLUDED_EMPLOYEE_IDS.has(employeeId)) return true;
  const normalizedEmail = email?.trim().toLowerCase();
  if (normalizedEmail && EXCLUDED_EMAILS.has(normalizedEmail)) return true;
  if (EXCLUDED_DISPLAY_NAMES.has(displayName)) return true;
  return false;
}

function sortByName(a: OrganizationEmployee, b: OrganizationEmployee): number {
  return getEmployeeDisplayLabel(a).localeCompare(getEmployeeDisplayLabel(b), undefined, {
    sensitivity: 'base',
  });
}

function sortDepartmentGroups(groups: OrganizationDepartmentGroup[]): OrganizationDepartmentGroup[] {
  return [...groups].sort((a, b) => {
    const orderA = LEADERSHIP_DEPARTMENT_ORDER.indexOf(a.name);
    const orderB = LEADERSHIP_DEPARTMENT_ORDER.indexOf(b.name);
    if (orderA !== -1 && orderB !== -1) return orderA - orderB;
    if (orderA !== -1) return -1;
    if (orderB !== -1) return 1;
    if (a.name === 'Unassigned') return 1;
    if (b.name === 'Unassigned') return -1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

function normalizeDepartmentName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed || 'Unassigned';
}

function getTodayIsoLocal(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function unavailabilityOverlapsDay(
  startDate: string,
  endDate: string | null | undefined,
  day: string,
): boolean {
  const end = endDate ?? startDate;
  return startDate <= day && end >= day;
}

const UNAVAILABILITY_PRIORITY: Record<UnavailabilityType, number> = {
  sick_days: 3,
  vacation: 2,
  general: 1,
};

type UnavailabilityInfo = {
  type: UnavailabilityType;
  startDate: string;
  endDate: string | null;
};

function pickPrimaryUnavailability(
  current: UnavailabilityInfo | undefined,
  next: UnavailabilityInfo,
): UnavailabilityInfo {
  if (!current) return next;
  if (UNAVAILABILITY_PRIORITY[next.type] > UNAVAILABILITY_PRIORITY[current.type]) return next;
  if (next.type === current.type) return next;
  return current;
}

function sortDepartmentEmployees(employees: OrganizationEmployee[]): OrganizationEmployee[] {
  return [...employees].sort((a, b) => {
    const aIsManager = isDepartmentManagerBonusRole(a.bonuses_role) ? 0 : 1;
    const bIsManager = isDepartmentManagerBonusRole(b.bonuses_role) ? 0 : 1;
    if (aIsManager !== bIsManager) return aIsManager - bIsManager;
    return sortByName(a, b);
  });
}

function buildDepartmentGroups(
  employees: OrganizationEmployee[],
  resolveDepartment: (employee: OrganizationEmployee) => string,
  pinManagersFirst = false,
): OrganizationDepartmentGroup[] {
  const departmentMap = new Map<string, OrganizationEmployee[]>();

  employees.forEach((employee) => {
    const departmentName = resolveDepartment(employee);
    if (!departmentMap.has(departmentName)) {
      departmentMap.set(departmentName, []);
    }
    departmentMap.get(departmentName)!.push(employee);
  });

  return Array.from(departmentMap.entries()).map(([name, groupEmployees]) => ({
    name,
    employees: pinManagersFirst
      ? sortDepartmentEmployees(groupEmployees)
      : groupEmployees.sort(sortByName),
  }));
}

export async function fetchOrganizationData(): Promise<OrganizationData> {
  const [{ data: allEmployeesData, error: employeesError }, { data: roleAssignments, error: rolesError }] =
    await Promise.all([
      supabase
        .from('users')
        .select(`
          id,
          full_name,
          email,
          employee_id,
          is_active,
          is_staff,
          is_superuser,
          tenants_employee!employee_id(
            id,
            display_name,
            official_name,
            photo_url,
            photo,
            phone,
            mobile,
            employee_mobile,
            phone_ext,
            linkedin_url,
            chat_background_image_url,
            diplom,
            school,
            bonuses_role,
            department_id,
            min_hours,
            works_from_home,
            date_of_birth,
            tenant_departement!department_id(
              id,
              name
            )
          )
        `)
        .not('employee_id', 'is', null)
        .eq('is_active', true)
        .eq('is_staff', true),
      supabase
        .from('employee_field_assignments')
        .select('employee_id, department_role')
        .in('department_role', [...CONTRIBUTION_DEPARTMENT_ROLES])
        .eq('is_active', true),
    ]);

  if (employeesError) throw employeesError;
  if (rolesError) throw rolesError;

  const fieldRolesByEmployee = new Map<number, Set<ContributionDepartmentRole>>();

  (roleAssignments || []).forEach((row: { employee_id: number; department_role: string }) => {
    const employeeId = Number(row.employee_id);
    const role = row.department_role as ContributionDepartmentRole;
    if (!employeeId || !CONTRIBUTION_DEPARTMENT_ROLES.includes(role)) return;

    if (!fieldRolesByEmployee.has(employeeId)) {
      fieldRolesByEmployee.set(employeeId, new Set());
    }
    fieldRolesByEmployee.get(employeeId)!.add(role);
  });

  const uniqueEmployeesMap = new Map<number, OrganizationEmployee>();

  (allEmployeesData || [])
    .filter((user: any) => user.tenants_employee && user.email)
    .forEach((user: any) => {
      const employee = user.tenants_employee as any;
      const employeeId = Number(employee.id);
      if (!employeeId || uniqueEmployeesMap.has(employeeId)) return;

      const displayName = employee.display_name || user.full_name || 'Unknown';
      if (isExcludedEmployee(employeeId, user.email, displayName)) return;

      const dept = Array.isArray(employee.tenant_departement)
        ? employee.tenant_departement[0]
        : employee.tenant_departement;

      const fieldRoles = Array.from(fieldRolesByEmployee.get(employeeId) || []).sort((a, b) =>
        a.localeCompare(b),
      );

      const schoolValue = Array.isArray(employee.school) && employee.school.length > 0
        ? employee.school[0]
        : (employee.school || null);

      const isSuperuser =
        user.is_superuser === true ||
        user.is_superuser === 'true' ||
        user.is_superuser === 1;

      uniqueEmployeesMap.set(employeeId, {
        id: employeeId,
        display_name: displayName,
        official_name: employee.official_name || null,
        photo_url: employee.photo_url || employee.photo || null,
        email: user.email,
        phone: employee.phone || null,
        mobile: employee.mobile || null,
        employee_mobile: employee.employee_mobile || null,
        phone_ext: employee.phone_ext || null,
        linkedin_url: employee.linkedin_url || null,
        chat_background_image_url: employee.chat_background_image_url || null,
        diplom: employee.diplom || null,
        school: schoolValue,
        bonuses_role: employee.bonuses_role || null,
        department: dept?.name || null,
        department_id: employee.department_id || dept?.id || null,
        min_hours: normalizeEmployeeMinHours(employee.min_hours),
        works_from_home: coerceEmployeeWorksFromHome(employee.works_from_home),
        is_superuser: isSuperuser,
        date_of_birth: employee.date_of_birth || null,
        fieldRoles,
        chatUserId: user.id ? String(user.id) : null,
        isClockedIn: false,
        unavailabilityType: null,
        unavailabilityStartDate: null,
        unavailabilityEndDate: null,
      });
    });

  const employeeIds = Array.from(uniqueEmployeesMap.keys());
  const clockedInIds = new Set<number>();
  const unavailabilityByEmployee = new Map<number, UnavailabilityInfo>();

  if (employeeIds.length > 0) {
    const today = getTodayIsoLocal();

    const [clockResult, unavailResult] = await Promise.all([
      supabase
        .from('employee_clock_in')
        .select('employee_id')
        .in('employee_id', employeeIds)
        .eq('is_active', true),
      supabase
        .from('employee_unavailability_reasons')
        .select('employee_id, unavailability_type, start_date, end_date, approved, declined')
        .in('employee_id', employeeIds)
        .lte('start_date', today),
    ]);

    if (clockResult.error) throw clockResult.error;
    if (unavailResult.error) throw unavailResult.error;

    for (const row of clockResult.data ?? []) {
      const id = Number(row.employee_id);
      if (!Number.isNaN(id)) clockedInIds.add(id);
    }

    for (const row of unavailResult.data ?? []) {
      const id = Number(row.employee_id);
      const type = row.unavailability_type as UnavailabilityType;
      if (Number.isNaN(id) || !type) continue;
      // Only approved leave counts toward org live status (pending/declined ignored)
      if ((row as { declined?: boolean }).declined === true) continue;
      if ((row as { approved?: boolean }).approved !== true) continue;
      if (!unavailabilityOverlapsDay(row.start_date, row.end_date, today)) continue;

      unavailabilityByEmployee.set(
        id,
        pickPrimaryUnavailability(unavailabilityByEmployee.get(id), {
          type,
          startDate: row.start_date,
          endDate: row.end_date,
        }),
      );
    }

    for (const id of employeeIds) {
      const employee = uniqueEmployeesMap.get(id);
      if (!employee) continue;
      const unavailability = clockedInIds.has(id) ? null : (unavailabilityByEmployee.get(id) ?? null);
      uniqueEmployeesMap.set(id, {
        ...employee,
        isClockedIn: clockedInIds.has(id),
        unavailabilityType: unavailability?.type ?? null,
        unavailabilityStartDate: unavailability?.startDate ?? null,
        unavailabilityEndDate: unavailability?.endDate ?? null,
      });
    }
  }

  const allEmployees = Array.from(uniqueEmployeesMap.values()).sort(sortByName);

  const partners = allEmployees
    .filter((employee) => isPartnerBonusRole(employee.bonuses_role))
    .sort(sortByName);

  const partnerIds = new Set(partners.map((employee) => employee.id));

  const leadershipEmployees = allEmployees.filter(
    (employee) =>
      !partnerIds.has(employee.id) && Boolean(getLeadershipDepartment(employee.bonuses_role)),
  );

  const leadershipIds = new Set(leadershipEmployees.map((employee) => employee.id));

  const leadership = sortDepartmentGroups(
    buildDepartmentGroups(leadershipEmployees, (employee) => {
      return getLeadershipDepartment(employee.bonuses_role) || 'Unassigned';
    }),
  );

  const departments = sortDepartmentGroups(
    buildDepartmentGroups(
      allEmployees.filter(
        (employee) => !partnerIds.has(employee.id) && !leadershipIds.has(employee.id),
      ),
      (employee) => normalizeDepartmentName(employee.department),
      true,
    ),
  );

  return { partners, leadership, departments, allEmployees };
}

export function employeeMatchesSearch(employee: OrganizationEmployee, searchTerm: string): boolean {
  const query = searchTerm.trim().toLowerCase();
  if (!query) return true;

  const roleLabel = getBonusesRoleDisplayName(employee.bonuses_role).toLowerCase();
  const fieldRoleLabels = employee.fieldRoles.join(' ').toLowerCase();
  const leadershipDept = (getLeadershipDepartment(employee.bonuses_role) || '').toLowerCase();

  return (
    getEmployeeDisplayLabel(employee).toLowerCase().includes(query) ||
    employee.display_name.toLowerCase().includes(query) ||
    employee.email.toLowerCase().includes(query) ||
    (employee.department || '').toLowerCase().includes(query) ||
    leadershipDept.includes(query) ||
    roleLabel.includes(query) ||
    fieldRoleLabels.includes(query) ||
    (employee.phone || '').includes(searchTerm.trim()) ||
    (employee.mobile || '').includes(searchTerm.trim()) ||
    (employee.employee_mobile || '').includes(searchTerm.trim())
  );
}
