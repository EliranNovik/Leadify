import { supabase } from './supabase';
import { convertToNIS } from './currencyConversion';

// Bonus calculation interfaces
export interface BonusRole {
  role: string;
  percentage: number;
  isPoolBased: boolean; // true for Marketing, Collection, Partners & Co
}

export interface EmployeeBonus {
  employeeId: string;
  employeeName: string;
  totalBonus: number;
  roleBonuses: RoleBonus[];
  monthlyPoolBonus?: number;
}

export interface RoleBonus {
  role: string;
  percentage: number;
  baseAmount: number;
  bonusAmount: number;
  leadCount: number;
  isPoolBased: boolean;
}

export interface LeadData {
  id: string;
  total: number;
  currency_id: string;
  meeting_scheduler_id?: string;
  meeting_manager_id?: string;
  meeting_lawyer_id?: string;
  closer_id?: string;
  expert_id?: string;
  case_handler_id?: string;
  cdate: string;
  status: number;
}

export interface InvoiceData {
  id: string;
  amount: number;
  currency_id: string;
  lead_id: string;
  created_at: string;
}

export interface MonthlyBonusPool {
  id: string;
  year: number;
  month: number;
  total_bonus_pool: number;
  total_revenue: number;
  pool_percentage: number;
  created_at: string;
  updated_at: string;
  created_by?: number;
  updated_by?: number;
}

// Bonus role configurations with two-tier system
export const BONUS_ROLES: { [key: string]: { groupPercentage: number; roles: BonusRole[] } } = {
  sales: {
    groupPercentage: 40, // Sales group gets 40% of monthly pool
    roles: [
      { role: 's', percentage: 30, isPoolBased: false }, // Scheduler
      { role: 'z', percentage: 20, isPoolBased: false }, // Manager (z/Z)
      { role: 'c', percentage: 40, isPoolBased: false }, // Closer
      { role: 'lawyer', percentage: 25, isPoolBased: false }, // Helper Closer
      { role: 'e', percentage: 10, isPoolBased: false }, // Expert
    ]
  },
  handlers: {
    groupPercentage: 30, // Handlers group gets 30% of monthly pool
    roles: [
      { role: 'h', percentage: 70, isPoolBased: false }, // Handler (case_handler_id)
      { role: 'e', percentage: 10, isPoolBased: false }, // Expert
    ]
  },
  marketing: {
    groupPercentage: 5, // Marketing group gets 5% of monthly pool
    roles: [
      { role: 'ma', percentage: 100, isPoolBased: true }, // Marketing - 100% of their group allocation
    ]
  },
  collection: {
    groupPercentage: 5, // Collection group gets 5% of monthly pool
    roles: [
      { role: 'col', percentage: 100, isPoolBased: true }, // Collection - 100% of their group allocation
    ]
  },
  partners: {
    groupPercentage: 20, // Partners group gets 20% of monthly pool
    roles: [
      { role: 'p', percentage: 100, isPoolBased: true }, // Partners & Co - 100% of their group allocation
    ]
  },
};

// Role mapping for easier lookup
export const ROLE_MAPPING: { [key: string]: string } = {
  's': 'Scheduler',
  'z': 'Manager',
  'Z': 'Manager',
  'c': 'Closer',
  'lawyer': 'Helper Closer',
  'e': 'Expert',
  'h': 'Handler',
  'ma': 'Marketing',
  'col': 'Collection',
  'p': 'Partner',
};

// Get bonus configuration for a role
export const getBonusConfig = (role: string): { groupPercentage: number; roles: BonusRole[] } | null => {
  // Determine which bonus category this role belongs to
  if (['s', 'z', 'Z', 'c', 'lawyer', 'e'].includes(role)) {
    return BONUS_ROLES.sales;
  } else if (['h', 'e'].includes(role)) {
    return BONUS_ROLES.handlers;
  } else if (role === 'ma') {
    return BONUS_ROLES.marketing;
  } else if (role === 'col') {
    return BONUS_ROLES.collection;
  } else if (role === 'p') {
    return BONUS_ROLES.partners;
  }
  return null;
};

// Get specific role configuration within a group
export const getRoleConfig = (role: string): BonusRole | null => {
  const groupConfig = getBonusConfig(role);
  if (!groupConfig) return null;
  
  return groupConfig.roles.find(r => r.role === role) || null;
};

// Test Supabase connection
const testSupabaseConnection = async (): Promise<boolean> => {
  try {
    console.log('🔍 Testing Supabase connection...');
    const { data, error } = await supabase
      .from('leads_leadstage')
      .select('count')
      .limit(1);
    
    if (error) {
      console.error('❌ Supabase connection test failed:', error);
      return false;
    }
    
    console.log('✅ Supabase connection test successful');
    return true;
  } catch (err) {
    console.error('❌ Supabase connection test error:', err);
    return false;
  }
};

// Calculate sales bonus for an employee - UPDATED 2025-01-28 16:50 - CACHE BUST
export const calculateSalesBonus = async (
  employeeId: string,
  dateFrom: string,
  dateTo: string,
  monthlyBonusPool?: MonthlyBonusPool
): Promise<RoleBonus[]> => {
  console.log(`🎯 calculateSalesBonus called for employee ${employeeId}, dateFrom: ${dateFrom}, dateTo: ${dateTo}`);
  console.log(`🚨🚨🚨 NEW VERSION 2025-01-28 16:50 - PROPORTIONAL CALCULATION + FIXED DB COLUMN 🚨🚨🚨`);
  
  const roleBonuses: RoleBonus[] = [];
  
  // Test connection first
  const connectionOk = await testSupabaseConnection();
  if (!connectionOk) {
    console.error('❌ Supabase connection failed, aborting bonus calculation');
    return roleBonuses;
  }
  
  // First get signed stages (stage = 60) in the date range
  console.log(`🔍 Fetching signed stages (stage=60) for date range: ${dateFrom} to ${dateTo}`);
  
  let signedStages: any[] = [];
  
  try {
    const { data, error: stagesError } = await supabase
      .from('leads_leadstage')
      .select('lead_id, cdate')
      .eq('stage', 60)
      .gte('cdate', dateFrom)
      .lte('cdate', dateTo);

    if (stagesError) {
      console.error('❌ Error fetching signed stages for sales bonus:', stagesError);
      console.error('Stages error details:', {
        message: stagesError.message,
        details: stagesError.details,
        hint: stagesError.hint,
        code: stagesError.code
      });
      return roleBonuses;
    }

    signedStages = data || [];
    console.log(`✅ Successfully fetched ${signedStages.length} signed stages`);
  } catch (networkError: any) {
    console.error('❌ Network error fetching signed stages for sales bonus:', networkError);
    console.error('Network error details:', {
      message: networkError?.message || 'Unknown error',
      name: networkError?.name || 'Unknown',
      stack: networkError?.stack || 'No stack trace'
    });
    return roleBonuses;
  }

  if (!signedStages || signedStages.length === 0) {
    console.log(`❌ No signed stages found for date range ${dateFrom} to ${dateTo}`);
    return roleBonuses;
  }

  // Get unique lead IDs from signed stages
  const signedLeadIds = [...new Set(signedStages.map(stage => stage.lead_id))];
  console.log(`📊 Found ${signedLeadIds.length} unique signed lead IDs`);

  // Now get the leads data for these signed leads
  console.log(`🔍 Fetching leads data for ${signedLeadIds.length} signed lead IDs:`, signedLeadIds);
  
  let leads: any[] = [];
  
  try {
    const { data, error } = await supabase
      .from('leads_lead')
      .select(`
        id,
        total,
        currency_id,
        meeting_scheduler_id,
        meeting_manager_id,
        meeting_lawyer_id,
        closer_id,
        expert_id,
        case_handler_id,
        cdate
      `)
      .in('id', signedLeadIds);

    if (error) {
      console.error('❌ Error fetching leads for sales bonus:', error);
      console.error('Error details:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
      return roleBonuses;
    }

    leads = data || [];
    console.log(`✅ Successfully fetched ${leads.length} leads from leads_lead table`);
  } catch (networkError: any) {
    console.error('❌ Network error fetching leads for sales bonus:', networkError);
    console.error('Network error details:', {
      message: networkError?.message || 'Unknown error',
      name: networkError?.name || 'Unknown',
      stack: networkError?.stack || 'No stack trace'
    });
    return roleBonuses;
  }

  console.log(`📊 Found ${leads.length} signed leads for sales bonus calculation`);
  
  if (!leads || leads.length === 0) {
    console.log(`❌ No signed leads found for date range ${dateFrom} to ${dateTo}`);
    return roleBonuses;
  }

  // Filter leads where employee has a role
  console.log(`🔍 Filtering leads for employee ${employeeId} (type: ${typeof employeeId})`);
  console.log(`📋 Sample lead data:`, leads[0]);
  
  const employeeLeads = leads.filter((lead: any) => {
    const hasRole = 
      lead.meeting_scheduler_id === employeeId.toString() ||
      lead.meeting_manager_id === employeeId.toString() ||
      lead.meeting_lawyer_id === employeeId.toString() ||
      lead.closer_id === employeeId.toString() ||
      lead.expert_id === employeeId.toString() ||
      lead.case_handler_id === employeeId.toString();
    
    if (hasRole) {
      console.log(`✅ Found lead ${lead.id} with role for employee ${employeeId}`);
    }
    
    return hasRole;
  });
  
  console.log(`📊 Found ${employeeLeads.length} leads where employee ${employeeId} has a role`);

  // Group leads by role
  const leadsByRole: { [key: string]: LeadData[] } = {};
  
  employeeLeads.forEach((lead: any) => {
    if (lead.meeting_scheduler_id === employeeId.toString()) {
      if (!leadsByRole['s']) leadsByRole['s'] = [];
      leadsByRole['s'].push(lead);
    }
    if (lead.meeting_manager_id === employeeId.toString()) {
      if (!leadsByRole['z']) leadsByRole['z'] = [];
      leadsByRole['z'].push(lead);
    }
    if (lead.meeting_lawyer_id === employeeId.toString()) {
      if (!leadsByRole['lawyer']) leadsByRole['lawyer'] = [];
      leadsByRole['lawyer'].push(lead);
    }
    if (lead.closer_id === employeeId.toString()) {
      if (!leadsByRole['c']) leadsByRole['c'] = [];
      leadsByRole['c'].push(lead);
    }
    if (lead.expert_id === employeeId.toString()) {
      if (!leadsByRole['e']) leadsByRole['e'] = [];
      leadsByRole['e'].push(lead);
    }
    if (lead.case_handler_id === employeeId.toString()) {
      if (!leadsByRole['h']) leadsByRole['h'] = [];
      leadsByRole['h'].push(lead);
    }
  });

  // Calculate bonus for each role using two-tier system
  Object.entries(leadsByRole).forEach(([role, roleLeads]) => {
    const totalAmount = roleLeads.reduce((sum, lead) => {
      const leadTotal = parseFloat(lead.total.toString()) || 0;
      console.log(`🔍 Lead ${lead.id} total: ${lead.total} (parsed: ${leadTotal})`);
      return sum + leadTotal;
    }, 0);
    
    console.log(`📊 Role ${role} - Total amount: ${totalAmount}, Lead count: ${roleLeads.length}`);
    
    // Get role configuration
    const roleConfig = getRoleConfig(role);
    const groupConfig = getBonusConfig(role);
    
    if (!roleConfig || !groupConfig) {
      console.log(`No bonus configuration found for role: ${role}`);
      return;
    }

    // Two-tier calculation:
    // 1. Group gets percentage of monthly pool
    // 2. Role gets percentage of group allocation
    let finalPercentage = roleConfig.percentage;
    
    if (monthlyBonusPool && monthlyBonusPool.pool_percentage > 0) {
      // First tier: Group percentage of pool
      const groupPoolPercentage = groupConfig.groupPercentage;
      
      // Second tier: Role percentage of group allocation
      const roleGroupPercentage = roleConfig.percentage;
      
      // Final calculation: (Group % of Pool) * (Role % of Group) / 100
      finalPercentage = (groupPoolPercentage * roleGroupPercentage) / 100;
      
      console.log(`🎯 Two-tier bonus calculation for ${role}:`, {
        groupPoolPercentage,
        roleGroupPercentage,
        finalPercentage,
        poolPercentage: monthlyBonusPool.pool_percentage
      });
    }

    // Calculate bonus based on employee's proportional contribution
    let bonusAmount = 0;
    
    console.log(`🔍 DEBUG: monthlyBonusPool check for ${role}:`, {
      monthlyBonusPool: monthlyBonusPool,
      hasPool: !!monthlyBonusPool,
      poolPercentage: monthlyBonusPool?.pool_percentage,
      condition: !!(monthlyBonusPool && monthlyBonusPool.pool_percentage > 0)
    });
    
    // Use proportional calculation even when no pool exists
    if (monthlyBonusPool && monthlyBonusPool.pool_percentage > 0) {
      // Get the group's total allocation from the pool
      const groupAllocation = (monthlyBonusPool.total_bonus_pool * groupConfig.groupPercentage) / 100;
      
      // Calculate this employee's share based on their contribution to total revenue
      // We need to get the total revenue for all employees in this role to calculate proportion
      const employeeProportion = totalAmount / monthlyBonusPool.total_revenue;
      
      // Employee's bonus = (Group allocation * Role percentage * Employee proportion) / 100
      bonusAmount = (groupAllocation * roleConfig.percentage * employeeProportion) / 100;
      
      console.log(`💰 Proportional bonus calculation for ${role} (UPDATED 2025-01-28 16:45):`, {
        poolAmount: monthlyBonusPool.total_bonus_pool,
        groupAllocation,
        employeeRevenue: totalAmount,
        totalRevenue: monthlyBonusPool.total_revenue,
        employeeProportion: (employeeProportion * 100).toFixed(2) + '%',
        rolePercentage: roleConfig.percentage,
        bonusAmount,
        calculation: `(${groupAllocation} * ${roleConfig.percentage} * ${(employeeProportion * 100).toFixed(2)}%) / 100 = ${bonusAmount}`
      });
    } else {
      // Fallback: Use proportional calculation with estimated pool
      // Estimate pool as 10% of total revenue when no pool is configured
      const estimatedPool = totalAmount * 10; // 10x the employee's revenue as pool estimate
      const groupAllocation = (estimatedPool * groupConfig.groupPercentage) / 100;
      const employeeProportion = 1; // Since we only have this employee's data
      
      bonusAmount = (groupAllocation * roleConfig.percentage * employeeProportion) / 100;
      
      console.log(`💰 Fallback proportional bonus calculation for ${role} (no pool configured):`, {
        estimatedPool,
        groupAllocation,
        employeeRevenue: totalAmount,
        employeeProportion: "100%",
        rolePercentage: roleConfig.percentage,
        bonusAmount,
        calculation: `(${groupAllocation} * ${roleConfig.percentage} * 100%) / 100 = ${bonusAmount}`
      });
    }
    
    roleBonuses.push({
      role,
      percentage: finalPercentage,
      baseAmount: totalAmount,
      bonusAmount: bonusAmount,
      leadCount: roleLeads.length,
      isPoolBased: roleConfig.isPoolBased,
    });
  });

  return roleBonuses;
};

// Calculate handlers bonus for an employee - UPDATED 2025-01-28 17:00 - FIXED TO USE CONTRACT SIGNED AMOUNTS
export const calculateHandlersBonus = async (
  employeeId: string,
  dateFrom: string,
  dateTo: string,
  monthlyBonusPool?: MonthlyBonusPool
): Promise<RoleBonus[]> => {
  console.log(`🎯 calculateHandlersBonus called for employee ${employeeId}, dateFrom: ${dateFrom}, dateTo: ${dateTo}`);
  console.log(`🚨🚨🚨 NEW HANDLERS VERSION 2025-01-28 17:00 - FIXED TO USE CONTRACT SIGNED AMOUNTS INSTEAD OF INVOICED 🚨🚨🚨`);
  
  const roleBonuses: RoleBonus[] = [];
  
  // First get signed stages (stage = 60) in the date range
  const { data: signedStages, error: stagesError } = await supabase
    .from('leads_leadstage')
    .select('lead_id, cdate')
    .eq('stage', 60)
    .gte('cdate', dateFrom)
    .lte('cdate', dateTo);

  if (stagesError) {
    console.error('Error fetching signed stages for handlers bonus:', stagesError);
    return roleBonuses;
  }

  if (!signedStages || signedStages.length === 0) {
    console.log(`❌ No signed stages found for handlers bonus calculation`);
    return roleBonuses;
  }

  // Get unique lead IDs from signed stages
  const signedLeadIds = [...new Set(signedStages.map(stage => stage.lead_id))];
  console.log(`📊 Found ${signedLeadIds.length} unique signed lead IDs for handlers`);

  // Now get the leads data for these signed leads
  const { data: leads, error } = await supabase
    .from('leads_lead')
    .select(`
      id,
      total,
      currency_id,
      case_handler_id,
      expert_id,
      cdate
    `)
    .in('id', signedLeadIds);

  if (error) {
    console.error('Error fetching leads for handlers bonus:', error);
    return roleBonuses;
  }

  console.log(`📊 Found ${leads?.length || 0} signed leads for handlers bonus calculation`);
  
  if (!leads || leads.length === 0) {
    console.log(`❌ No signed leads found for handlers bonus calculation`);
    return roleBonuses;
  }

  // Filter leads where employee has a role
  console.log(`🔍 Filtering leads for handler employee ${employeeId} (type: ${typeof employeeId})`);
  console.log(`📋 Sample lead data:`, leads[0]);
  
  const employeeLeads = leads.filter((lead: any) => {
    const hasRole = 
      lead.case_handler_id === employeeId.toString() ||
      lead.expert_id === employeeId.toString();
    
    if (hasRole) {
      console.log(`✅ Found handler lead ${lead.id} with role for employee ${employeeId}`);
    }
    
    return hasRole;
  });
  
  console.log(`📊 Found ${employeeLeads.length} leads where handler employee ${employeeId} has a role`);

  // Group leads by role - using contract signed amounts (lead.total) like sales bonus calculation
  const leadsByRole: { [key: string]: LeadData[] } = {};
  
  employeeLeads.forEach((lead: any) => {
    if (lead.case_handler_id === employeeId.toString()) {
      if (!leadsByRole['h']) leadsByRole['h'] = [];
      leadsByRole['h'].push(lead);
    }
    if (lead.expert_id === employeeId.toString()) {
      if (!leadsByRole['e']) leadsByRole['e'] = [];
      leadsByRole['e'].push(lead);
    }
  });

  // Calculate bonus for each role using two-tier system
  Object.entries(leadsByRole).forEach(([role, roleLeads]) => {
    // Calculate total contract signed amount for this role (using lead.total like sales bonus)
    const totalAmount = roleLeads.reduce((sum, lead) => {
      const leadTotal = parseFloat(lead.total.toString()) || 0;
      console.log(`🔍 Handler Lead ${lead.id} total: ${lead.total} (parsed: ${leadTotal})`);
      return sum + leadTotal;
    }, 0);
    
    console.log(`📊 Handler Role ${role} - Total contract amount: ${totalAmount}, Lead count: ${roleLeads.length}`);
    // Get role configuration
    const roleConfig = getRoleConfig(role);
    const groupConfig = getBonusConfig(role);
    
    if (!roleConfig || !groupConfig) {
      console.log(`No bonus configuration found for role: ${role}`);
      return;
    }

    // Two-tier calculation:
    // 1. Group gets percentage of monthly pool
    // 2. Role gets percentage of group allocation
    let finalPercentage = roleConfig.percentage;
    
    if (monthlyBonusPool && monthlyBonusPool.pool_percentage > 0) {
      // First tier: Group percentage of pool
      const groupPoolPercentage = groupConfig.groupPercentage;
      
      // Second tier: Role percentage of group allocation
      const roleGroupPercentage = roleConfig.percentage;
      
      // Final calculation: (Group % of Pool) * (Role % of Group) / 100
      finalPercentage = (groupPoolPercentage * roleGroupPercentage) / 100;
      
      console.log(`🎯 Two-tier handlers bonus calculation for ${role}:`, {
        groupPoolPercentage,
        roleGroupPercentage,
        finalPercentage,
        poolPercentage: monthlyBonusPool.pool_percentage
      });
    }
    
    // Calculate bonus based on employee's proportional contribution
    let bonusAmount = 0;
    
    console.log(`🔍 DEBUG: monthlyBonusPool check for handlers ${role}:`, {
      monthlyBonusPool: monthlyBonusPool,
      hasPool: !!monthlyBonusPool,
      poolPercentage: monthlyBonusPool?.pool_percentage,
      condition: !!(monthlyBonusPool && monthlyBonusPool.pool_percentage > 0)
    });
    
    if (monthlyBonusPool && monthlyBonusPool.pool_percentage > 0) {
      // Get the group's total allocation from the pool
      const groupAllocation = (monthlyBonusPool.total_bonus_pool * groupConfig.groupPercentage) / 100;
      
      // Calculate this employee's share based on their contribution to total revenue
      const employeeProportion = totalAmount / monthlyBonusPool.total_revenue;
      
      // Employee's bonus = (Group allocation * Role percentage * Employee proportion) / 100
      bonusAmount = (groupAllocation * roleConfig.percentage * employeeProportion) / 100;
      
      console.log(`💰 Proportional handlers bonus calculation for ${role} (UPDATED 2025-01-28 16:45):`, {
        poolAmount: monthlyBonusPool.total_bonus_pool,
        groupAllocation,
        employeeContractAmount: totalAmount,
        totalRevenue: monthlyBonusPool.total_revenue,
        employeeProportion: (employeeProportion * 100).toFixed(2) + '%',
        rolePercentage: roleConfig.percentage,
        bonusAmount,
        calculation: `(${groupAllocation} * ${roleConfig.percentage} * ${(employeeProportion * 100).toFixed(2)}%) / 100 = ${bonusAmount}`
      });
    } else {
      // Fallback: Use proportional calculation with estimated pool
      // Estimate pool as 10% of total revenue when no pool is configured
      const estimatedPool = totalAmount * 10; // 10x the employee's contract amount as pool estimate
      const groupAllocation = (estimatedPool * groupConfig.groupPercentage) / 100;
      const employeeProportion = 1; // Since we only have this employee's data
      
      bonusAmount = (groupAllocation * roleConfig.percentage * employeeProportion) / 100;
      
      console.log(`💰 Fallback proportional handlers bonus calculation for ${role} (no pool configured):`, {
        estimatedPool,
        groupAllocation,
        employeeContractAmount: totalAmount,
        employeeProportion: "100%",
        rolePercentage: roleConfig.percentage,
        bonusAmount,
        calculation: `(${groupAllocation} * ${roleConfig.percentage} * 100%) / 100 = ${bonusAmount}`
      });
    }
    
    roleBonuses.push({
      role,
      percentage: finalPercentage,
      baseAmount: totalAmount,
      bonusAmount: bonusAmount,
      leadCount: roleLeads.length,
      isPoolBased: roleConfig.isPoolBased,
    });
  });

  return roleBonuses;
};

// Calculate monthly pool bonus for Marketing, Collection, Partners
export const calculatePoolBonus = async (
  employeeId: string,
  role: string,
  dateFrom: string,
  dateTo: string,
  monthlyPoolAmount: number
): Promise<RoleBonus[]> => {
  const roleBonuses: RoleBonus[] = [];
  
  // Get role configuration
  const roleConfig = getRoleConfig(role);
  const groupConfig = getBonusConfig(role);
  
  if (!roleConfig || !groupConfig) {
    console.log(`No bonus configuration found for pool role: ${role}`);
    return roleBonuses;
  }

  // Get all employees with this role
  const { data: employees, error } = await supabase
    .from('tenants_employee')
    .select('id, bonuses_role')
    .eq('bonuses_role', role);

  if (error) {
    console.error('Error fetching pool employees:', error);
    return roleBonuses;
  }

  if (!employees || employees.length === 0) {
    return roleBonuses;
  }

  // Two-tier calculation for pool-based roles:
  // 1. Group gets percentage of monthly pool
  // 2. Role gets percentage of group allocation (usually 100% for pool roles)
  const groupPoolPercentage = groupConfig.groupPercentage;
  const roleGroupPercentage = roleConfig.percentage;
  
  // Calculate per-employee share: (Group % of Pool) * (Role % of Group) / 100 / Number of employees
  const perEmployeeShare = (monthlyPoolAmount * groupPoolPercentage * roleGroupPercentage) / 10000 / employees.length;
  
  console.log(`🎯 Two-tier pool bonus calculation for ${role}:`, {
    groupPoolPercentage,
    roleGroupPercentage,
    monthlyPoolAmount,
    employeesCount: employees.length,
    perEmployeeShare
  });
  
  roleBonuses.push({
    role: role,
    percentage: (groupPoolPercentage * roleGroupPercentage) / 100,
    baseAmount: monthlyPoolAmount,
    bonusAmount: perEmployeeShare,
    leadCount: 0,
    isPoolBased: true,
  });

  return roleBonuses;
};

// Main function to calculate employee bonus
export const calculateEmployeeBonus = async (
  employeeId: string,
  employeeRole: string,
  dateFrom: string,
  dateTo: string,
  monthlyPoolAmount: number = 0
): Promise<EmployeeBonus> => {
  console.log(`🎯 calculateEmployeeBonus called for employee ${employeeId}, role: ${employeeRole}, dateFrom: ${dateFrom}, dateTo: ${dateTo}`);
  console.log(`🔍 DEBUG: Function entry point reached`);
  console.log(`🚨 CRITICAL DEBUG: This should definitely appear in console!`);
  console.log(`🚨 CRITICAL DEBUG: Employee ID type: ${typeof employeeId}, value: ${employeeId}`);
  
  const roleBonuses: RoleBonus[] = [];
  
  // Extract year and month from dateFrom to fetch monthly bonus pool
  const fromDate = new Date(dateFrom);
  const year = fromDate.getFullYear();
  const month = fromDate.getMonth() + 1; // getMonth() returns 0-11, we need 1-12
  
  console.log(`🎯 Extracted year: ${year}, month: ${month} from dateFrom: ${dateFrom}`);
  
  // Fetch monthly bonus pool for the period
  const monthlyBonusPool = await fetchMonthlyBonusPool(year, month);
  
  // If no pool exists, we can still calculate bonuses but they won't be pool-based
  if (!monthlyBonusPool) {
    console.log(`⚠️ No monthly bonus pool found for ${year}-${month}, using base percentages`);
    console.log(`🔍 This means the condition 'monthlyBonusPool && monthlyBonusPool.pool_percentage > 0' will be FALSE`);
  } else {
    console.log(`✅ Found monthly bonus pool for ${year}-${month}:`, monthlyBonusPool);
    console.log(`🔍 Pool percentage: ${monthlyBonusPool.pool_percentage}, condition will be: ${!!(monthlyBonusPool && monthlyBonusPool.pool_percentage > 0)}`);
  }
  
  // Determine which calculation method to use
  console.log(`🎯 Checking role ${employeeRole} against role categories...`);
  
  if (['s', 'z', 'Z', 'c', 'lawyer', 'e'].includes(employeeRole)) {
    console.log(`✅ Role ${employeeRole} matches sales roles, calculating sales bonus...`);
    // Sales roles - calculate from signed contracts
    const salesBonuses = await calculateSalesBonus(employeeId, dateFrom, dateTo, monthlyBonusPool || undefined);
    console.log(`📊 Sales bonuses calculated:`, salesBonuses);
    roleBonuses.push(...salesBonuses);
  } else if (['h'].includes(employeeRole)) {
    console.log(`✅ Role ${employeeRole} matches handler roles, calculating handler bonus...`);
    // Handler roles - calculate from invoiced amounts
    const handlerBonuses = await calculateHandlersBonus(employeeId, dateFrom, dateTo, monthlyBonusPool || undefined);
    console.log(`📊 Handler bonuses calculated:`, handlerBonuses);
    roleBonuses.push(...handlerBonuses);
  } else if (['ma', 'col', 'p'].includes(employeeRole)) {
    console.log(`✅ Role ${employeeRole} matches pool-based roles, calculating pool bonus...`);
    // Pool-based roles - calculate from monthly pool
    const poolBonuses = await calculatePoolBonus(employeeId, employeeRole, dateFrom, dateTo, monthlyPoolAmount);
    console.log(`📊 Pool bonuses calculated:`, poolBonuses);
    roleBonuses.push(...poolBonuses);
  } else {
    console.log(`❌ Role ${employeeRole} does not match any known role categories`);
  }

  const totalBonus = roleBonuses.reduce((sum, bonus) => sum + bonus.bonusAmount, 0);
  
  console.log(`🎯 Final bonus calculation for employee ${employeeId}:`, {
    totalBonus,
    roleBonusesCount: roleBonuses.length,
    roleBonuses: roleBonuses
  });

  return {
    employeeId,
    employeeName: '', // Will be filled by caller
    totalBonus,
    roleBonuses,
    monthlyPoolBonus: roleBonuses.find(b => b.isPoolBased)?.bonusAmount,
  };
};

// Get role display name
export const getRoleDisplayName = (roleCode: string): string => {
  return ROLE_MAPPING[roleCode] || roleCode;
};

// Fetch monthly bonus pool for a specific month/year
export const fetchMonthlyBonusPool = async (year: number, month: number): Promise<MonthlyBonusPool | null> => {
  try {
    console.log(`🔍 Fetching monthly bonus pool for ${year}-${month}`);
    
    const { data, error } = await supabase
      .from('monthly_bonus_pools')
      .select('*')
      .eq('year', year)
      .eq('month', month)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No pool found for this month/year
        console.log(`📊 No bonus pool found for ${year}-${month}`);
        return null;
      }
      console.error('❌ Error fetching monthly bonus pool:', error);
      return null;
    }

    console.log(`✅ Found existing bonus pool:`, data);
    return data;
  } catch (err) {
    console.error('❌ Error fetching monthly bonus pool:', err);
    return null;
  }
};

// Fetch total revenue for a specific month/year using the same logic as the main system
export const fetchMonthlyRevenue = async (year: number, month: number): Promise<number> => {
  try {
    // Get the date range for the month
    const startDate = new Date(year, month - 1, 1).toISOString().split('T')[0];
    const endDate = new Date(year, month, 0).toISOString().split('T')[0];

    console.log(`🔍 Fetching monthly revenue for ${year}-${month}:`, { startDate, endDate });

    // Use the EXACT same logic as Employee Performance page: department-based revenue calculation
    // First, get ALL departments from tenant_departement to create a mapping
    const { data: allDepartments, error: departmentsError } = await supabase
      .from('tenant_departement')
      .select('id, name, important')
      .order('id');
    
    if (departmentsError) {
      console.error('Error fetching departments:', departmentsError);
      return 0;
    }
    
    // Create department ID to name mapping
    const departmentMap: { [key: number]: string } = {};
    allDepartments?.forEach(dept => {
      departmentMap[dept.id] = dept.name;
    });
    
    // Fetch signed stages (stage 60 - agreement signed) for the date range
    const { data: signedStages, error: stagesError } = await supabase
      .from('leads_leadstage')
      .select('id, date, lead_id')
      .eq('stage', 60)
      .gte('date', startDate)
      .lte('date', endDate);

    if (stagesError) {
      console.error('Error fetching signed stages:', stagesError);
      return 0;
    }

    console.log(`📊 Found ${signedStages?.length || 0} signed stages (stage 60) for ${year}-${month}`);

    if (!signedStages || signedStages.length === 0) {
      console.log(`⚠️ No signed stages found for ${year}-${month}, revenue is 0`);
      return 0;
    }

    // Get unique lead IDs from signed stages
    const leadIds = [...new Set(signedStages.map(stage => stage.lead_id).filter(id => id !== null))];
    console.log(`📋 Found ${leadIds.length} unique signed lead IDs for ${year}-${month}`);

    // Fetch leads data with department mappings (EXACT same query as Employee Performance page)
    const { data: leadsData, error: leadsError } = await supabase
      .from('leads_lead')
      .select(`
        id, total, currency_id,
        misc_category(
          id, name, parent_id,
          misc_maincategory(
            id, name, department_id,
            tenant_departement(id, name)
          )
        )
      `)
      .in('id', leadIds);

    if (leadsError) {
      console.error('Error fetching leads data:', leadsError);
      return 0;
    }

    console.log(`✅ Found ${leadsData?.length || 0} signed leads for ${year}-${month}`);

    // Calculate total revenue using EXACT same logic as Employee Performance page
    let totalRevenue = 0;
    const leadsMap = new Map(leadsData?.map(lead => [lead.id, lead]) || []);
    
    signedStages.forEach(stageRecord => {
      const lead = leadsMap.get(stageRecord.lead_id);
      if (lead) {
        const amount = parseFloat(lead.total) || 0;
        const amountInNIS = convertToNIS(amount, lead.currency_id);
        totalRevenue += amountInNIS; // Use NIS amount (same as Employee Performance page)
      }
    });

    console.log(`💰 Total revenue for ${year}-${month}: ₪${totalRevenue.toLocaleString()}`);

    return totalRevenue;
  } catch (err) {
    console.error('Error fetching monthly revenue:', err);
    return 0;
  }
};

// Create or update monthly bonus pool
export const createOrUpdateMonthlyBonusPool = async (
  year: number,
  month: number,
  totalBonusPool: number,
  totalRevenue?: number
): Promise<MonthlyBonusPool | null> => {
  try {
    console.log(`🏗️ Creating/updating monthly bonus pool for ${year}-${month}:`, {
      totalBonusPool,
      totalRevenueProvided: totalRevenue !== undefined
    });

    // If totalRevenue is not provided, fetch it
    if (totalRevenue === undefined) {
      console.log('📊 Fetching total revenue...');
      totalRevenue = await fetchMonthlyRevenue(year, month);
    }

    console.log(`💰 Final values:`, {
      year,
      month,
      totalBonusPool,
      totalRevenue,
      poolPercentage: totalRevenue > 0 ? (totalBonusPool / totalRevenue) * 100 : 0
    });

    const { data, error } = await supabase
      .from('monthly_bonus_pools')
      .upsert({
        year,
        month,
        total_bonus_pool: totalBonusPool,
        total_revenue: totalRevenue,
      }, {
        onConflict: 'year,month'
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating/updating monthly bonus pool:', error);
      return null;
    }

    console.log('✅ Monthly bonus pool saved successfully:', data);
    return data;
  } catch (err) {
    console.error('Error creating/updating monthly bonus pool:', err);
    return null;
  }
};
