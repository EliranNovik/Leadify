/**
 * Shared catalog helpers for employee bonuses/org roles.
 * DB: `public.employee_roles` (id PK) + `tenants_employee.bonuses_role_id` FK
 * (see sql/2026-08-12_employee_roles.sql). Text `bonuses_role` stays synced to `code`.
 *
 * Prefer importing from this module instead of local role maps.
 */

export type EmployeeRoleOption = {
  value: string;
  label: string;
};

export type EmployeeRoleDefinition = EmployeeRoleOption & {
  /** When set, this code is a legacy alias of another canonical code. */
  aliasOf?: string;
  selectable?: boolean;
  sortOrder?: number;
};

/** Canonical selectable roles (admin / HR dropdowns). */
export const EMPLOYEE_ROLE_SELECT_OPTIONS: EmployeeRoleOption[] = [
  { value: 'One-time bonus (temporary)', label: 'One-time bonus (temporary)' },
  { value: 'No bonuses', label: 'No bonuses' },
  { value: 'c', label: 'Closer' },
  { value: 's', label: 'Scheduler' },
  { value: 'h', label: 'Handler' },
  { value: 'e', label: 'Expert' },
  { value: 'z', label: 'Manager' },
  { value: 'm', label: 'Manager' },
  { value: 'p', label: 'Partner' },
  { value: 'dm', label: 'Department Manager' },
  { value: 'pm', label: 'Project Manager' },
  { value: 'om', label: 'Office Manager' },
  { value: 'se', label: 'Secretary' },
  { value: 'b', label: 'Book keeper' },
  { value: 'partners', label: 'Partners' },
  { value: 'dv', label: 'Developer' },
  { value: 'ma', label: 'Marketing' },
  { value: 'f', label: 'Finance' },
  { value: 'col', label: 'Collection' },
  { value: 'd', label: 'Diverse' },
  { value: 'lawyer', label: 'Helper Closer' },
  { value: 'n', label: 'No role' },
];

/** HR edit modal — same catalog without legacy one-time / no-bonuses free-text rows. */
export const EMPLOYEE_ROLE_HR_OPTIONS: EmployeeRoleOption[] = [
  { value: 'c', label: 'Closer' },
  { value: 's', label: 'Scheduler' },
  { value: 'h', label: 'Handler' },
  { value: 'e', label: 'Expert' },
  { value: 'p', label: 'Partner' },
  { value: 'dm', label: 'Department Manager' },
  { value: 'pm', label: 'Project Manager' },
  { value: 'om', label: 'Office Manager' },
  { value: 'm', label: 'Manager' },
  { value: 'z', label: 'Manager' },
  { value: 'se', label: 'Secretary' },
  { value: 'b', label: 'Book keeper' },
  { value: 'dv', label: 'Developer' },
  { value: 'ma', label: 'Marketing' },
  { value: 'f', label: 'Finance' },
  { value: 'col', label: 'Collection' },
  { value: 'd', label: 'Diverse' },
  { value: 'lawyer', label: 'Helper Closer' },
  { value: 'n', label: 'No role' },
  { value: 'partners', label: 'Partners' },
];

/**
 * Full display map: canonical codes + legacy aliases (uppercase, helper-closer, etc.).
 * Keep in sync with `sql/2026-08-12_employee_roles.sql`.
 */
export const EMPLOYEE_ROLE_DISPLAY_MAP: Record<string, string> = {
  'One-time bonus (temporary)': 'One-time bonus (temporary)',
  'No bonuses': 'No bonuses',
  c: 'Closer',
  s: 'Scheduler',
  h: 'Handler',
  n: 'No role',
  e: 'Expert',
  z: 'Manager',
  Z: 'Manager',
  m: 'Manager',
  M: 'Manager',
  p: 'Partner',
  P: 'Partner',
  dm: 'Department Manager',
  DM: 'Department Manager',
  pm: 'Project Manager',
  PM: 'Project Manager',
  om: 'Office Manager',
  OM: 'Office Manager',
  se: 'Secretary',
  SE: 'Secretary',
  b: 'Book keeper',
  B: 'Book keeper',
  partners: 'Partners',
  Partners: 'Partners',
  dv: 'Developer',
  ma: 'Marketing',
  d: 'Diverse',
  f: 'Finance',
  col: 'Collection',
  lawyer: 'Helper Closer',
  'helper-closer': 'Helper Closer',
  // Longer labels sometimes stored / passed through UI
  scheduler: 'Scheduler',
  expert: 'Expert',
  handler: 'Handler',
  closer: 'Closer',
  manager: 'Manager',
  partner: 'Partner',
  admin: 'Administrator',
  administrator: 'Administrator',
  advocate: 'Advocate',
  adv: 'Advocate',
  lawyer_full: 'Lawyer',
  l: 'Lawyer',
  a: 'Administrator',
  coordinator: 'Coordinator',
  'department manager': 'Department Manager',
  'book keeper': 'Book Keeper',
  marketing: 'Marketing',
  sales: 'Sales',
};

/** @deprecated Prefer EMPLOYEE_ROLE_DISPLAY_MAP — kept for bonusCalculation imports. */
export const ROLE_MAPPING = EMPLOYEE_ROLE_DISPLAY_MAP;

export function getEmployeeRoleDisplayName(
  roleCode: string | null | undefined,
  fallback: string = '',
): string {
  if (roleCode == null) return fallback;
  const raw = String(roleCode).trim();
  if (!raw) return fallback;

  if (EMPLOYEE_ROLE_DISPLAY_MAP[raw]) return EMPLOYEE_ROLE_DISPLAY_MAP[raw];

  const lower = raw.toLowerCase();
  if (EMPLOYEE_ROLE_DISPLAY_MAP[lower]) return EMPLOYEE_ROLE_DISPLAY_MAP[lower];

  return raw || fallback;
}

/** Alias used across org / HR modules. */
export const getBonusesRoleDisplayName = getEmployeeRoleDisplayName;

/** Alias used in salary reports. */
export const getSalaryRoleDisplayName = (roleCode: string | null | undefined): string =>
  getEmployeeRoleDisplayName(roleCode, 'No role');

/** Alias used in bonus calculation + many UI surfaces. */
export const getRoleDisplayName = (roleCode: string | null | undefined): string =>
  getEmployeeRoleDisplayName(roleCode, roleCode || 'No role');

export function isPartnerBonusRole(bonusesRole: string | null | undefined): boolean {
  return bonusesRole?.trim().toLowerCase() === 'p';
}

export function isDepartmentManagerBonusRole(bonusesRole: string | null | undefined): boolean {
  return bonusesRole?.trim().toLowerCase() === 'dm';
}

export function isOfficeManagerBonusRole(bonusesRole: string | null | undefined): boolean {
  return bonusesRole?.trim().toLowerCase() === 'om';
}

/** Partner / leadership filter used on performance pages. */
export const PARTNERS_AND_CO_ROLE_CODES = [
  'p',
  'm',
  'dm',
  'pm',
  'om',
  'se',
  'b',
  'partners',
  'dv',
] as const;

export function isPartnersAndCoRole(bonusesRole: string | null | undefined): boolean {
  const code = bonusesRole?.trim() || '';
  return (PARTNERS_AND_CO_ROLE_CODES as readonly string[]).includes(code);
}
