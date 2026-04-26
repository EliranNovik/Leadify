/**
 * Utility functions for calculating employee portion percentages based on roles
 * 
 * Role percentages:
 * - Closer: 40%
 * - Scheduler: 30%
 * - Meeting Manager: 20%
 * - Expert: 10%
 * - Helper Closer: 50/50 with Closer (if Helper Closer exists, both get 20% each instead of Closer 40%)
 */

export interface LeadRoles {
  closer?: string | number | null;
  scheduler?: string | number | null;
  /** Meeting manager (new leads). Often mirrored as meeting_manager_id. */
  manager?: string | number | null;
  meeting_manager_id?: string | number | null;
  /** Display name, numeric id string, or id; see also expert_id. */
  expert?: string | number | null;
  /** Numeric expert FK on new `leads` when set alongside or instead of `expert`. */
  expert_id?: string | number | null;
  handler?: string | number | null; // Handler role
  helperCloser?: string | number | null; // Also known as meeting_lawyer_id / helper
}

export interface LegacyLeadRoles {
  closer_id?: number | null;
  meeting_scheduler_id?: number | null;
  meeting_manager_id?: number | null;
  expert_id?: number | null;
  /** When present, matched by name/ID the same as new leads. */
  expert?: string | number | null;
  case_handler_id?: number | null; // Handler role
  meeting_lawyer_id?: number | null; // Helper Closer
}

// Default role percentages (used as fallback if not provided)
export const DEFAULT_ROLE_PERCENTAGES = {
  CLOSER: 0.4, // 40%
  SCHEDULER: 0.3, // 30%
  MANAGER: 0.2, // 20%
  EXPERT: 0.1, // 10%
  HANDLER: 0.0, // 0% (Handler doesn't get a percentage in signed portion calculation)
  CLOSER_WITH_HELPER: 0.2, // 20% when Helper Closer exists
  HELPER_CLOSER: 0.2, // 20% when Helper Closer exists
} as const;

// Type for role percentages map (from database)
export type RolePercentagesMap = Map<string, number>;

/**
 * Normalize employee identifier (handle both string and number)
 */
const normalizeEmployeeId = (value: any, targetId: string | number): boolean => {
  if (value === null || value === undefined) return false;

  const targetIdStr = String(targetId);
  const valueStr = String(value);

  // Check if they match as strings
  if (valueStr === targetIdStr) return true;

  // Check if they match as numbers
  const targetNum = Number(targetId);
  const valueNum = Number(value);

  if (!isNaN(targetNum) && !isNaN(valueNum) && targetNum === valueNum) {
    return true;
  }

  return false;
};

/**
 * Match a new-lead role field to an employee the same way {@link hasRole} does
 * (numeric ID, numeric string ID, or case-insensitive display name).
 * Use this from role-combination / lead filtering so "who has which roles" always matches
 * {@link calculateSignedPortionPercentage} and contribution totals.
 */
export function newLeadFieldMatchesEmployee(
  value: any,
  employeeId: string | number,
  employeeName: string
): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (normalizeEmployeeId(value, employeeId)) return true;
  if (typeof value === 'string' && employeeName) {
    const v = value.trim().toLowerCase();
    const e = employeeName.trim().toLowerCase();
    if (!v || !e) return false;
    if (v === e) return true;
    const vParts = v.split(/\s+/).filter(Boolean);
    const eParts = e.split(/\s+/).filter(Boolean);
    // Roles tab / UI often saves a short first name ("Eliran") while directory name is full ("Eliran Novik").
    // Only treat single-token stored values as matching the employee's first token (avoids "Mary" vs "Mary Jane" on the lead).
    if (vParts.length === 1 && eParts.length > 0 && vParts[0] === eParts[0]) return true;
    return false;
  }
  return false;
}

/**
 * New `leads` row: expert may be stored as `expert_id` (numeric FK) and/or `expert` (id string, numeric string, or display name).
 * Matches the same way as the rest of sales contribution (e.g. handler uses handler + case_handler_id).
 */
export function newLeadMatchesExpert(lead: any, employeeId: number, employeeName: string): boolean {
  if (lead == null) return false;
  if (lead.expert_id != null && lead.expert_id !== '' && Number(lead.expert_id) === Number(employeeId)) {
    return true;
  }
  if (lead.expert) {
    return newLeadFieldMatchesEmployee(lead.expert, employeeId, employeeName);
  }
  return false;
}

/**
 * Legacy `leads_lead` row: `expert_id` (FK) and/or optional `expert` text when present in data.
 */
export function legacyLeadMatchesExpert(lead: any, employeeId: number, employeeName: string): boolean {
  if (lead == null) return false;
  if (lead.expert_id != null && lead.expert_id !== '' && Number(lead.expert_id) === Number(employeeId)) {
    return true;
  }
  if (lead.expert != null && lead.expert !== '') {
    return newLeadFieldMatchesEmployee(lead.expert, employeeId, employeeName);
  }
  return false;
}

/** When employee_id is unknown, numeric field matching must not false-positive; name-only paths still work. */
const NO_EMPLOYEE_ID_SENTINEL = -999999999;

function resolveIdForNewLeadRoleMatch(employeeId: number | null | undefined): number {
  if (employeeId != null && Number.isFinite(Number(employeeId))) return Number(employeeId);
  return NO_EMPLOYEE_ID_SENTINEL;
}

/**
 * True if this employee is assigned to any sales role on a new `leads` row (same fields as RolesTab / contribution).
 */
export function employeeHasAnySalesRoleOnNewLead(
  lead: any,
  employeeId: number | null | undefined,
  employeeName: string
): boolean {
  if (!lead) return false;
  const name = (employeeName || '').trim();
  const idM = resolveIdForNewLeadRoleMatch(employeeId);

  if (lead.closer && newLeadFieldMatchesEmployee(lead.closer, idM, name)) return true;
  if (lead.scheduler && newLeadFieldMatchesEmployee(lead.scheduler, idM, name)) return true;

  if (lead.handler && newLeadFieldMatchesEmployee(lead.handler, idM, name)) return true;
  if (
    lead.case_handler_id != null &&
    lead.case_handler_id !== '' &&
    idM !== NO_EMPLOYEE_ID_SENTINEL &&
    Number(lead.case_handler_id) === idM
  ) {
    return true;
  }

  if (lead.helper != null && lead.helper !== '' && newLeadFieldMatchesEmployee(lead.helper, idM, name)) return true;
  if (
    lead.meeting_lawyer_id != null &&
    lead.meeting_lawyer_id !== '' &&
    idM !== NO_EMPLOYEE_ID_SENTINEL &&
    Number(lead.meeting_lawyer_id) === idM
  ) {
    return true;
  }
  if (lead.lawyer != null && lead.lawyer !== '') {
    const lawyerValue = lead.lawyer;
    if (name && typeof lawyerValue === 'string' && lawyerValue.toLowerCase() === name.toLowerCase()) return true;
    if (idM !== NO_EMPLOYEE_ID_SENTINEL && Number(lawyerValue) === idM) return true;
  }

  if (newLeadMatchesExpert(lead, idM, name)) return true;

  if (lead.manager != null && lead.manager !== '') {
    const managerValue = lead.manager;
    if (typeof managerValue === 'string') {
      const numericValue = Number(managerValue);
      if (!Number.isNaN(numericValue) && numericValue.toString() === String(managerValue).trim()) {
        if (idM !== NO_EMPLOYEE_ID_SENTINEL && numericValue === idM) return true;
      } else if (newLeadFieldMatchesEmployee(managerValue, idM, name)) {
        return true;
      }
    } else if (idM !== NO_EMPLOYEE_ID_SENTINEL && Number(managerValue) === idM) {
      return true;
    }
  }
  if (
    lead.meeting_manager_id != null &&
    lead.meeting_manager_id !== '' &&
    idM !== NO_EMPLOYEE_ID_SENTINEL &&
    Number(lead.meeting_manager_id) === idM
  ) {
    return true;
  }

  if (idM !== NO_EMPLOYEE_ID_SENTINEL) {
    if (lead.retainer_handler_id != null && lead.retainer_handler_id !== '' && Number(lead.retainer_handler_id) === idM) {
      return true;
    }
    if (lead.meeting_collection_id != null && lead.meeting_collection_id !== '' && Number(lead.meeting_collection_id) === idM) {
      return true;
    }
    if (lead.marketing_officer_id != null && lead.marketing_officer_id !== '' && Number(lead.marketing_officer_id) === idM) {
      return true;
    }
  }

  return false;
}

/**
 * True if this employee is assigned to any sales role on a `leads_lead` row (legacy IDs).
 */
export function employeeHasAnySalesRoleOnLegacyLead(
  lead: any,
  employeeId: number | null | undefined,
  employeeName: string
): boolean {
  if (!lead) return false;
  const idM = resolveIdForNewLeadRoleMatch(employeeId);
  if (idM === NO_EMPLOYEE_ID_SENTINEL) return false;

  if (lead.closer_id && Number(lead.closer_id) === idM) return true;
  if (lead.meeting_scheduler_id && Number(lead.meeting_scheduler_id) === idM) return true;
  if (lead.meeting_manager_id && Number(lead.meeting_manager_id) === idM) return true;
  if (lead.meeting_lawyer_id && Number(lead.meeting_lawyer_id) === idM) return true;
  if (lead.case_handler_id && Number(lead.case_handler_id) === idM) return true;
  if (legacyLeadMatchesExpert(lead, idM, employeeName || '')) return true;
  if (lead.retainer_handler_id != null && lead.retainer_handler_id !== '' && Number(lead.retainer_handler_id) === idM) {
    return true;
  }
  if (lead.meeting_collection_id != null && lead.meeting_collection_id !== '' && Number(lead.meeting_collection_id) === idM) {
    return true;
  }
  if (lead.marketing_officer_id != null && lead.marketing_officer_id !== '' && Number(lead.marketing_officer_id) === idM) {
    return true;
  }
  return false;
}

/**
 * New `leads` row plus optional linked `leads_lead` (e.g. when `leads.legacy_lead_id` is set).
 */
export function employeeHasAnySalesRoleOnLeadBundle(
  newLeadRow: any | null | undefined,
  legacyLeadRow: any | null | undefined,
  employeeId: number | null | undefined,
  employeeName: string
): boolean {
  if (newLeadRow && employeeHasAnySalesRoleOnNewLead(newLeadRow, employeeId, employeeName)) return true;
  if (legacyLeadRow && employeeHasAnySalesRoleOnLegacyLead(legacyLeadRow, employeeId, employeeName)) return true;
  return false;
}

/** Resolve % from map with DB label aliases (e.g. Meeting Manager vs MANAGER) */
const getPercentageFromMap = (map: RolePercentagesMap | undefined, canonicalKey: string): number | null => {
  if (!map) return null;
  if (map.has(canonicalKey)) return (map.get(canonicalKey)! / 100);
  const aliasGroups: Record<string, string[]> = {
    MANAGER: ['MEETING_MANAGER', 'Meeting Manager', 'Meeting manager', 'meeting_manager'],
    SCHEDULER: ['SCHEDULER', 'Scheduler'],
    CLOSER: ['CLOSER', 'Closer'],
    EXPERT: ['EXPERT', 'Expert'],
    HANDLER: ['HANDLER', 'Handler'],
    CLOSER_WITH_HELPER: ['CLOSER_WITH_HELPER', 'CLOSER WITH HELPER'],
    HELPER_CLOSER: ['HELPER_CLOSER', 'Helper Closer', 'Helper closer'],
  };
  for (const alt of aliasGroups[canonicalKey] || []) {
    if (map.has(alt)) return map.get(alt)! / 100;
  }
  return null;
};

/** Expert % as 0–1 (same resolution as signed portion, including default 10%). */
export const getExpertPercentageDecimal = (rolePercentages: RolePercentagesMap | undefined): number => {
  const p = getPercentageFromMap(rolePercentages, 'EXPERT');
  return p != null ? p : DEFAULT_ROLE_PERCENTAGES.EXPERT;
};

/**
 * Check if an employee has a specific role in a new lead
 */
const hasRole = (lead: LeadRoles, employeeId: string | number, role: keyof LeadRoles, employeeName?: string): boolean => {
  // Meeting manager: value may be on manager and/or meeting_manager_id (new leads)
  if (role === 'manager') {
    const roleValue = lead.manager != null && lead.manager !== '' ? lead.manager : (lead as LeadRoles).meeting_manager_id;
    if (roleValue === null || roleValue === undefined || roleValue === '') return false;
    if (normalizeEmployeeId(roleValue, employeeId)) return true;
    if (employeeName && typeof roleValue === 'string' && roleValue.toLowerCase() === employeeName.toLowerCase()) return true;
    return false;
  }

  if (role === 'expert') {
    return newLeadMatchesExpert(lead, Number(employeeId), employeeName || '');
  }

  const roleValue = lead[role];
  if (roleValue === null || roleValue === undefined) return false;

  // First try ID matching
  if (normalizeEmployeeId(roleValue, employeeId)) {
    return true;
  }

  // If ID doesn't match and we have employeeName, try name matching
  if (employeeName && typeof roleValue === 'string') {
    return roleValue.toLowerCase() === employeeName.toLowerCase();
  }

  return false;
};

/**
 * Check if an employee has a specific role in a legacy lead
 */
const hasLegacyRole = (lead: LegacyLeadRoles, employeeId: number, role: keyof LegacyLeadRoles): boolean => {
  const roleValue = lead[role];
  if (roleValue === null || roleValue === undefined) return false;
  return Number(roleValue) === Number(employeeId);
};

/**
 * Calculate the signed portion percentage for an employee in a new lead
 * 
 * @param lead - The lead with role assignments
 * @param employeeId - The employee ID to calculate for
 * @param rolePercentages - Map of role names to percentages (from database, 0-100), defaults to DEFAULT_ROLE_PERCENTAGES
 * @param employeeName - Optional employee name for matching (used when roles are stored as names)
 * @returns The percentage (0 to 1) of the lead amount the employee should receive
 */
export const calculateSignedPortionPercentage = (
  lead: LeadRoles,
  employeeId: string | number,
  rolePercentages?: RolePercentagesMap,
  employeeName?: string
): number => {
  let percentage = 0;

  // Get role percentages from parameter or use defaults
  const getRolePercentage = (roleName: string): number => {
    const fromMap = getPercentageFromMap(rolePercentages, roleName);
    if (fromMap != null) return fromMap;
    // Fallback to defaults
    const defaultValue = DEFAULT_ROLE_PERCENTAGES[roleName as keyof typeof DEFAULT_ROLE_PERCENTAGES];
    return defaultValue !== undefined ? defaultValue : 0;
  };

  // Check if employee is Helper Closer (helper/meeting_lawyer_id)
  const isHelperCloser = hasRole(lead, employeeId, 'helperCloser', employeeName);

  // Check if employee is Closer
  const isCloser = hasRole(lead, employeeId, 'closer', employeeName);

  // Special case: If both Closer and Helper Closer exist on the lead
  // Check if there's a Helper Closer assigned (regardless of who it is)
  const hasHelperCloser = lead.helperCloser !== null && lead.helperCloser !== undefined;

  if (isCloser) {
    if (hasHelperCloser) {
      // If Helper Closer exists, Closer gets CLOSER_WITH_HELPER percentage
      const closerWithHelperPct = getRolePercentage('CLOSER_WITH_HELPER');
      percentage += closerWithHelperPct;
    } else {
      // Normal case: Closer gets CLOSER percentage
      const closerPct = getRolePercentage('CLOSER');
      percentage += closerPct;
    }
  }

  if (isHelperCloser) {
    // Helper Closer always gets HELPER_CLOSER percentage when they exist
    const helperCloserPct = getRolePercentage('HELPER_CLOSER');
    percentage += helperCloserPct;
  }

  // Check other roles (these are independent)
  if (hasRole(lead, employeeId, 'scheduler', employeeName)) {
    const schedulerPct = getRolePercentage('SCHEDULER');
    percentage += schedulerPct;
  }

  if (hasRole(lead, employeeId, 'manager', employeeName)) {
    const managerPct = getRolePercentage('MANAGER');
    percentage += managerPct;
  }

  if (hasRole(lead, employeeId, 'expert', employeeName)) {
    const expertPct = getRolePercentage('EXPERT');
    percentage += expertPct;
  }

  // Handler role percentage should NOT be included in signed portion calculation
  // Handler percentages are only applied to due normalized amounts
  // if (hasRole(lead, employeeId, 'handler')) {
  //   percentage += getRolePercentage('HANDLER');
  // }

  return percentage;
};

/**
 * Calculate the signed portion percentage for an employee in a legacy lead
 * 
 * @param lead - The legacy lead with role assignments
 * @param employeeId - The employee ID to calculate for
 * @param rolePercentages - Map of role names to percentages (from database, 0-100), defaults to DEFAULT_ROLE_PERCENTAGES
 * @returns The percentage (0 to 1) of the lead amount the employee should receive
 */
export const calculateLegacySignedPortionPercentage = (
  lead: LegacyLeadRoles,
  employeeId: number,
  rolePercentages?: RolePercentagesMap,
  employeeName = ''
): number => {
  let percentage = 0;

  // Get role percentages from parameter or use defaults
  const getRolePercentage = (roleName: string): number => {
    const fromMap = getPercentageFromMap(rolePercentages, roleName);
    if (fromMap != null) return fromMap;
    // Fallback to defaults
    const defaultValue = DEFAULT_ROLE_PERCENTAGES[roleName as keyof typeof DEFAULT_ROLE_PERCENTAGES];
    return defaultValue !== undefined ? defaultValue : 0;
  };

  // Check if employee is Helper Closer (meeting_lawyer_id)
  const isHelperCloser = hasLegacyRole(lead, employeeId, 'meeting_lawyer_id');

  // Check if employee is Closer
  const isCloser = hasLegacyRole(lead, employeeId, 'closer_id');

  // Special case: If both Closer and Helper Closer exist on the lead
  // Check if there's a Helper Closer assigned (regardless of who it is)
  const hasHelperCloser = lead.meeting_lawyer_id !== null && lead.meeting_lawyer_id !== undefined;

  if (isCloser) {
    if (hasHelperCloser) {
      // If Helper Closer exists, Closer gets CLOSER_WITH_HELPER percentage
      percentage += getRolePercentage('CLOSER_WITH_HELPER');
    } else {
      // Normal case: Closer gets CLOSER percentage
      percentage += getRolePercentage('CLOSER');
    }
  }

  if (isHelperCloser) {
    // Helper Closer always gets HELPER_CLOSER percentage when they exist
    percentage += getRolePercentage('HELPER_CLOSER');
  }

  // Check other roles (these are independent)
  if (hasLegacyRole(lead, employeeId, 'meeting_scheduler_id')) {
    percentage += getRolePercentage('SCHEDULER');
  }

  if (hasLegacyRole(lead, employeeId, 'meeting_manager_id')) {
    percentage += getRolePercentage('MANAGER');
  }

  if (legacyLeadMatchesExpert(lead as any, employeeId, employeeName)) {
    percentage += getRolePercentage('EXPERT');
  }

  // Handler role percentage should NOT be included in signed portion calculation
  // Handler percentages are only applied to due normalized amounts
  // if (hasLegacyRole(lead, employeeId, 'case_handler_id')) {
  //   percentage += getRolePercentage('HANDLER');
  // }

  return percentage;
};

/**
 * Calculate the signed portion amount for an employee in a lead
 * 
 * @param leadAmount - The total signed amount for the lead (in NIS)
 * @param lead - The lead with role assignments
 * @param employeeId - The employee ID to calculate for
 * @param isLegacy - Whether this is a legacy lead
 * @param rolePercentages - Map of role names to percentages (from database, 0-100), defaults to DEFAULT_ROLE_PERCENTAGES
 * @param employeeName - Optional employee name for matching (used when roles are stored as names)
 * @returns The amount (in NIS) the employee should receive from this lead
 */
export const calculateSignedPortionAmount = (
  leadAmount: number,
  lead: LeadRoles | LegacyLeadRoles,
  employeeId: string | number,
  isLegacy: boolean = false,
  rolePercentages?: RolePercentagesMap,
  employeeName?: string
): number => {
  const percentage = isLegacy
    ? calculateLegacySignedPortionPercentage(lead as LegacyLeadRoles, Number(employeeId), rolePercentages, employeeName)
    : calculateSignedPortionPercentage(lead as LeadRoles, employeeId, rolePercentages, employeeName);

  return leadAmount * percentage;
};
