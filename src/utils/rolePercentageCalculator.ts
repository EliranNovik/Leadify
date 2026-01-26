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
  manager?: string | number | null;
  expert?: string | number | null;
  handler?: string | number | null; // Handler role
  helperCloser?: string | number | null; // Also known as meeting_lawyer_id / helper
}

export interface LegacyLeadRoles {
  closer_id?: number | null;
  meeting_scheduler_id?: number | null;
  meeting_manager_id?: number | null;
  expert_id?: number | null;
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
 * Check if an employee has a specific role in a new lead
 */
const hasRole = (lead: LeadRoles, employeeId: string | number, role: keyof LeadRoles): boolean => {
  const roleValue = lead[role];
  if (roleValue === null || roleValue === undefined) return false;
  return normalizeEmployeeId(roleValue, employeeId);
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
 * @returns The percentage (0 to 1) of the lead amount the employee should receive
 */
export const calculateSignedPortionPercentage = (
  lead: LeadRoles,
  employeeId: string | number,
  rolePercentages?: RolePercentagesMap
): number => {
  let percentage = 0;

  // Get role percentages from parameter or use defaults
  const getRolePercentage = (roleName: string): number => {
    if (rolePercentages && rolePercentages.has(roleName)) {
      // Convert from 0-100 to 0-1
      return (rolePercentages.get(roleName)! / 100);
    }
    // Fallback to defaults
    const defaultValue = DEFAULT_ROLE_PERCENTAGES[roleName as keyof typeof DEFAULT_ROLE_PERCENTAGES];
    return defaultValue !== undefined ? defaultValue : 0;
  };

  // Check if employee is Helper Closer (helper/meeting_lawyer_id)
  const isHelperCloser = hasRole(lead, employeeId, 'helperCloser');
  
  // Check if employee is Closer
  const isCloser = hasRole(lead, employeeId, 'closer');
  
  // Special case: If both Closer and Helper Closer exist on the lead
  // Check if there's a Helper Closer assigned (regardless of who it is)
  const hasHelperCloser = lead.helperCloser !== null && lead.helperCloser !== undefined;
  
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
  if (hasRole(lead, employeeId, 'scheduler')) {
    percentage += getRolePercentage('SCHEDULER');
  }
  
  if (hasRole(lead, employeeId, 'manager')) {
    percentage += getRolePercentage('MANAGER');
  }
  
  if (hasRole(lead, employeeId, 'expert')) {
    percentage += getRolePercentage('EXPERT');
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
  rolePercentages?: RolePercentagesMap
): number => {
  let percentage = 0;

  // Get role percentages from parameter or use defaults
  const getRolePercentage = (roleName: string): number => {
    if (rolePercentages && rolePercentages.has(roleName)) {
      // Convert from 0-100 to 0-1
      return (rolePercentages.get(roleName)! / 100);
    }
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
  
  if (hasLegacyRole(lead, employeeId, 'expert_id')) {
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
 * @returns The amount (in NIS) the employee should receive from this lead
 */
export const calculateSignedPortionAmount = (
  leadAmount: number,
  lead: LeadRoles | LegacyLeadRoles,
  employeeId: string | number,
  isLegacy: boolean = false,
  rolePercentages?: RolePercentagesMap
): number => {
  const percentage = isLegacy
    ? calculateLegacySignedPortionPercentage(lead as LegacyLeadRoles, Number(employeeId), rolePercentages)
    : calculateSignedPortionPercentage(lead as LeadRoles, employeeId, rolePercentages);
  
  return leadAmount * percentage;
};
