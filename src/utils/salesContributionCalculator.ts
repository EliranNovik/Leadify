import { convertToNIS } from '../lib/currencyConversion';
import { calculateSignedPortionAmount, calculateSignedPortionPercentage } from './rolePercentageCalculator';

export interface EmployeeCalculationInput {
    employeeId: number;
    employeeName: string;
    leads: {
        newLeads: any[];
        legacyLeads: any[];
    };
    payments: {
        newPayments: Map<string, number>;
        legacyPayments: Map<number, number>;
    };
    totalDueAmount: number; // Total due from fetchDueAmounts (all handler leads, not just signed)
    totalSignedOverall: number;
    totalIncome: number;
    dueNormalizedPercentage: number;
    rolePercentages: Map<string, number>;
}

export interface EmployeeCalculationResult {
    employeeId: number;
    signed: number;
    due: number;
    signedNormalized: number;
    dueNormalized: number;
    signedPortion: number;
    duePortion: number;
    contribution: number;
    salaryBudget: number;
    roleBreakdown: Array<{
        role: string;
        signedTotal: number;
        dueTotal: number;
        roles: string[];
    }>;
}

/**
 * Parse numeric amount from various formats
 */
export const parseNumericAmount = (val: any): number => {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        const cleaned = val.replace(/[^0-9.-]/g, '');
        const parsed = parseFloat(cleaned);
        return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
};

/**
 * Build currency metadata from various sources
 */
export const buildCurrencyMeta = (...candidates: any[]): { displaySymbol: string; conversionValue: string | number } => {
    for (const candidate of candidates) {
        if (candidate === null || candidate === undefined) continue;
        const rawValue = Array.isArray(candidate) ? candidate[0] : candidate;
        if (rawValue === null || rawValue === undefined) continue;

        if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
            const currencyMap: { [key: number]: string } = { 1: 'NIS', 2: 'USD', 3: 'EUR', 4: 'GBP' };
            return { displaySymbol: '₪', conversionValue: currencyMap[rawValue] || 'NIS' };
        }

        const valueStr = rawValue.toString().trim();
        if (!valueStr) continue;

        const numeric = Number(valueStr);
        if (!Number.isNaN(numeric) && numeric.toString() === valueStr) {
            const currencyMap: { [key: number]: string } = { 1: 'NIS', 2: 'USD', 3: 'EUR', 4: 'GBP' };
            return { displaySymbol: '₪', conversionValue: currencyMap[numeric] || 'NIS' };
        }

        const upper = valueStr.toUpperCase();
        if (upper === '₪' || upper === 'NIS' || upper === 'ILS') {
            return { displaySymbol: '₪', conversionValue: 'NIS' };
        }
        if (upper === 'USD' || valueStr === '$') {
            return { displaySymbol: '$', conversionValue: 'USD' };
        }
        if (upper === 'EUR' || valueStr === '€') {
            return { displaySymbol: '€', conversionValue: 'EUR' };
        }
        if (upper === 'GBP' || valueStr === '£') {
            return { displaySymbol: '£', conversionValue: 'GBP' };
        }
    }
    return { displaySymbol: '₪', conversionValue: 'NIS' };
};

/**
 * Calculate amount after fee for a new lead
 */
export const calculateNewLeadAmount = (lead: any): number => {
    const balanceAmount = parseFloat(lead.balance || 0);
    const proposalAmount = parseFloat(lead.proposal_total || 0);
    const rawAmount = balanceAmount || proposalAmount || 0;
    const currencyCode = lead.accounting_currencies?.iso_code || lead.balance_currency || lead.proposal_currency || 'NIS';
    const amountInNIS = convertToNIS(rawAmount, currencyCode);

    const subcontractorFee = parseNumericAmount(lead.subcontractor_fee) || 0;
    const currencyMeta = buildCurrencyMeta(lead.currency_id, lead.proposal_currency, lead.balance_currency);
    const subcontractorFeeNIS = convertToNIS(subcontractorFee, currencyMeta.conversionValue);

    return amountInNIS - subcontractorFeeNIS;
};

/**
 * Calculate amount after fee for a legacy lead
 */
export const calculateLegacyLeadAmount = (lead: any): number => {
    const currencyId = lead.currency_id;
    const numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
    let resolvedAmount = 0;
    if (numericCurrencyId === 1) {
        resolvedAmount = parseNumericAmount(lead.total_base) || 0;
    } else {
        resolvedAmount = parseNumericAmount(lead.total) || 0;
    }

    const currencyMeta = buildCurrencyMeta(
        lead.currency_id,
        lead.meeting_total_currency_id,
        lead.accounting_currencies
    );

    const amountNIS = convertToNIS(resolvedAmount, currencyMeta.conversionValue);
    const subcontractorFee = parseNumericAmount(lead.subcontractor_fee) || 0;
    const subcontractorFeeNIS = convertToNIS(subcontractorFee, currencyMeta.conversionValue);

    return amountNIS - subcontractorFeeNIS;
};

/**
 * Check if employee is in a role for a new lead
 */
const checkEmployeeInRole = (
    lead: any,
    roleField: string,
    roleName: string,
    employeeId: number,
    employeeName: string
): boolean => {
    if (roleName === 'Helper Handler') {
        return false; // No direct field exists
    }

    if (roleField === 'closer' && lead.closer) {
        const closerValue = lead.closer;
        return typeof closerValue === 'string'
            ? closerValue.toLowerCase() === employeeName.toLowerCase()
            : Number(closerValue) === employeeId;
    } else if (roleField === 'scheduler' && lead.scheduler) {
        const schedulerValue = lead.scheduler;
        return typeof schedulerValue === 'string'
            ? schedulerValue.toLowerCase() === employeeName.toLowerCase()
            : Number(schedulerValue) === employeeId;
    } else if (roleField === 'handler') {
        if (lead.handler) {
            const handlerValue = lead.handler;
            if (typeof handlerValue === 'string' && handlerValue.toLowerCase() === employeeName.toLowerCase()) {
                return true;
            }
            if (Number(handlerValue) === employeeId) {
                return true;
            }
        }
        if (lead.case_handler_id && Number(lead.case_handler_id) === employeeId) {
            return true;
        }
        return false;
    } else if (roleField === 'helper' && lead.helper) {
        const helperValue = lead.helper;
        return typeof helperValue === 'string'
            ? helperValue.toLowerCase() === employeeName.toLowerCase()
            : Number(helperValue) === employeeId;
    } else if (roleField === 'expert' && lead.expert) {
        return Number(lead.expert) === employeeId;
    } else if (roleField === 'meeting_manager_id' && lead.meeting_manager_id) {
        return Number(lead.meeting_manager_id) === employeeId;
    }
    return false;
};

/**
 * Check if employee is in a role for a legacy lead
 */
const checkEmployeeInRoleLegacy = (lead: any, roleField: string, employeeId: number): boolean => {
    if (roleField === 'closer_id' && lead.closer_id) {
        return Number(lead.closer_id) === employeeId;
    } else if (roleField === 'meeting_scheduler_id' && lead.meeting_scheduler_id) {
        return Number(lead.meeting_scheduler_id) === employeeId;
    } else if (roleField === 'meeting_lawyer_id' && lead.meeting_lawyer_id) {
        return Number(lead.meeting_lawyer_id) === employeeId;
    } else if (roleField === 'case_handler_id' && lead.case_handler_id) {
        return Number(lead.case_handler_id) === employeeId;
    } else if (roleField === 'expert_id' && lead.expert_id) {
        return Number(lead.expert_id) === employeeId;
    } else if (roleField === 'meeting_manager_id' && lead.meeting_manager_id) {
        return Number(lead.meeting_manager_id) === employeeId;
    }
    return false;
};

/**
 * Calculate normalization ratio based on income and total signed
 */
export const calculateNormalizationRatio = (totalIncome: number, totalSigned: number): number => {
    if (totalIncome > 0 && totalSigned > 0 && totalIncome < totalSigned) {
        return totalIncome / totalSigned;
    }
    return 1;
};

/**
 * Calculate all employee metrics in one batch
 * This is a PURE function - no side effects, no async
 */
export const calculateEmployeeMetrics = (input: EmployeeCalculationInput): EmployeeCalculationResult => {
    const {
        employeeId,
        employeeName,
        leads,
        payments,
        totalDueAmount,
        totalSignedOverall,
        totalIncome,
        dueNormalizedPercentage,
        rolePercentages,
    } = input;

    const roles = [
        { name: 'Closer', legacyField: 'closer_id', newField: 'closer' },
        { name: 'Scheduler', legacyField: 'meeting_scheduler_id', newField: 'scheduler' },
        { name: 'Helper Closer', legacyField: 'meeting_lawyer_id', newField: 'helper' },
        { name: 'Handler', legacyField: 'case_handler_id', newField: 'handler' },
        { name: 'Meeting Manager', legacyField: 'meeting_manager_id', newField: 'meeting_manager_id' },
        { name: 'Helper Handler', legacyField: null, newField: null },
        { name: 'Expert', legacyField: 'expert_id', newField: 'expert' },
    ];

    // Step 1: Group leads by role combinations
    const roleCombinationMap = new Map<string, { roles: string[]; signedTotal: number; dueTotal: number }>();

    // Process new leads
    leads.newLeads.forEach((lead: any) => {
        const employeeRoles: string[] = [];

        roles.forEach(role => {
            if (role.newField && checkEmployeeInRole(lead, role.newField, role.name, employeeId, employeeName)) {
                employeeRoles.push(role.name);
            }
        });

        const isHandler = checkEmployeeInRole(lead, 'handler', 'Handler', employeeId, employeeName);
        if (employeeRoles.length === 0 && isHandler) {
            employeeRoles.push('Handler');
        }

        if (employeeRoles.length > 0) {
            const sortedRoles = [...employeeRoles].sort();
            const combinationKey = sortedRoles.join(', ');
            const isHandlerOnly = employeeRoles.length === 1 && employeeRoles[0] === 'Handler';

            const amountAfterFee = calculateNewLeadAmount(lead);
            const dueAmount = isHandler ? (payments.newPayments.get(lead.id) || 0) : 0;

            const existing = roleCombinationMap.get(combinationKey);
            if (existing) {
                if (!isHandlerOnly) {
                    existing.signedTotal += amountAfterFee;
                }
                existing.dueTotal += dueAmount;
            } else {
                roleCombinationMap.set(combinationKey, {
                    roles: sortedRoles,
                    signedTotal: isHandlerOnly ? 0 : amountAfterFee,
                    dueTotal: dueAmount,
                });
            }
        }
    });

    // Process legacy leads
    leads.legacyLeads.forEach((lead: any) => {
        const employeeRoles: string[] = [];

        roles.forEach(role => {
            if (role.legacyField && checkEmployeeInRoleLegacy(lead, role.legacyField, employeeId)) {
                employeeRoles.push(role.name);
            }
        });

        const isHandler = checkEmployeeInRoleLegacy(lead, 'case_handler_id', employeeId);
        if (employeeRoles.length === 0 && isHandler) {
            employeeRoles.push('Handler');
        }

        if (employeeRoles.length > 0) {
            const sortedRoles = [...employeeRoles].sort();
            const combinationKey = sortedRoles.join(', ');
            const isHandlerOnly = employeeRoles.length === 1 && employeeRoles[0] === 'Handler';

            const amountAfterFee = calculateLegacyLeadAmount(lead);
            const dueAmount = isHandler ? (payments.legacyPayments.get(Number(lead.id)) || 0) : 0;

            const existing = roleCombinationMap.get(combinationKey);
            if (existing) {
                if (!isHandlerOnly) {
                    existing.signedTotal += amountAfterFee;
                }
                existing.dueTotal += dueAmount;
            } else {
                roleCombinationMap.set(combinationKey, {
                    roles: sortedRoles,
                    signedTotal: isHandlerOnly ? 0 : amountAfterFee,
                    dueTotal: dueAmount,
                });
            }
        }
    });

    // Step 2: Calculate signed portion from all leads
    let totalSignedPortion = 0;
    let debugNewLeadsCount = 0;
    let debugNewLeadsWithRoles = 0;
    let debugNewLeadsPortion = 0;

    // Process new leads for signed portion
    leads.newLeads.forEach((lead: any) => {
        const employeeRoles: string[] = [];
        roles.forEach(role => {
            if (role.newField && checkEmployeeInRole(lead, role.newField, role.name, employeeId, employeeName)) {
                employeeRoles.push(role.name);
            }
        });

        const isHandlerOnly = employeeRoles.length === 1 && employeeRoles[0] === 'Handler';
        if (employeeRoles.length > 0 && !isHandlerOnly) {
            debugNewLeadsWithRoles++;
            const amountAfterFee = calculateNewLeadAmount(lead);
            const leadRoles = {
                closer: lead.closer,
                scheduler: lead.scheduler,
                manager: lead.meeting_manager_id,
                expert: lead.expert,
                handler: lead.handler,
                helperCloser: lead.helper,
            };

            const signedPortion = calculateSignedPortionAmount(
                amountAfterFee,
                leadRoles,
                employeeId,
                false,
                rolePercentages,
                employeeName
            );
            totalSignedPortion += signedPortion;
            debugNewLeadsPortion += signedPortion;

            // Debug: Log if signedPortion is 0 but should have value
            if (signedPortion === 0 && amountAfterFee > 0) {
                const calculatedPercentage = calculateSignedPortionPercentage(leadRoles, employeeId, rolePercentages, employeeName);
                console.warn(`⚠️ Zero signedPortion for new lead ${lead.id} (employee ${employeeId} ${employeeName}):`, {
                    amountAfterFee,
                    employeeRoles,
                    leadRoles,
                    calculatedPercentage,
                    signedPortionShouldBe: amountAfterFee * calculatedPercentage,
                    rolePercentages: rolePercentages ? Array.from(rolePercentages.entries()) : []
                });
            }
        }
        debugNewLeadsCount++;
    });

    // Process legacy leads for signed portion
    let debugLegacyLeadsCount = 0;
    let debugLegacyLeadsWithRoles = 0;
    let debugLegacyLeadsPortion = 0;

    leads.legacyLeads.forEach((lead: any) => {
        const employeeRoles: string[] = [];
        roles.forEach(role => {
            if (role.legacyField && checkEmployeeInRoleLegacy(lead, role.legacyField, employeeId)) {
                employeeRoles.push(role.name);
            }
        });

        const isHandlerOnly = employeeRoles.length === 1 && employeeRoles[0] === 'Handler';
        if (employeeRoles.length > 0 && !isHandlerOnly) {
            debugLegacyLeadsWithRoles++;
            const amountAfterFee = calculateLegacyLeadAmount(lead);
            const leadRoles = {
                closer_id: lead.closer_id,
                meeting_scheduler_id: lead.meeting_scheduler_id,
                meeting_manager_id: lead.meeting_manager_id,
                expert_id: lead.expert_id,
                case_handler_id: lead.case_handler_id,
                meeting_lawyer_id: lead.meeting_lawyer_id,
            };

            const signedPortion = calculateSignedPortionAmount(
                amountAfterFee,
                leadRoles,
                employeeId,
                true,
                rolePercentages,
                employeeName
            );
            totalSignedPortion += signedPortion;
            debugLegacyLeadsPortion += signedPortion;

            // Debug: Log if signedPortion is 0 but should have value
            if (signedPortion === 0 && amountAfterFee > 0) {
                console.warn(`⚠️ Zero signedPortion for legacy lead ${lead.id} (employee ${employeeId}):`, {
                    amountAfterFee,
                    employeeRoles,
                    leadRoles,
                    rolePercentages: rolePercentages ? Array.from(rolePercentages.entries()) : []
                });
            }
        }
        debugLegacyLeadsCount++;
    });

    // Step 3: Calculate totals from role combinations
    let totalSigned = 0;
    roleCombinationMap.forEach((data) => {
        const isHandlerOnly = data.roles.length === 1 && data.roles[0] === 'Handler';
        if (!isHandlerOnly) {
            totalSigned += data.signedTotal;
        }
    });

    // Use totalDueAmount from fetchDueAmounts (includes all handler leads, not just signed ones)
    const totalDue = totalDueAmount;

    // If handler has due amounts but no role combinations, add Handler-only entry
    if (totalDue > 0 && roleCombinationMap.size === 0) {
        roleCombinationMap.set('Handler', {
            roles: ['Handler'],
            signedTotal: 0,
            dueTotal: totalDue,
        });
    } else if (totalDue > 0) {
        // Update handler combination with correct due total
        let handlerFound = false;
        roleCombinationMap.forEach((data, key) => {
            if (data.roles.length === 1 && data.roles[0] === 'Handler') {
                data.dueTotal = totalDue;
                handlerFound = true;
            }
        });
        // If handler has due but no handler combination exists, add it
        if (!handlerFound) {
            roleCombinationMap.set('Handler', {
                roles: ['Handler'],
                signedTotal: 0,
                dueTotal: totalDue,
            });
        }
    }

    // Step 4: Calculate normalized values
    const normalizationRatio = calculateNormalizationRatio(totalIncome, totalSignedOverall);
    const signedNormalized = totalSigned * normalizationRatio;
    const dueNormalizedPercentageValue = (dueNormalizedPercentage || 0) / 100;
    const dueNormalized = totalDue * dueNormalizedPercentageValue;

    // Step 5: Calculate portions
    // IMPORTANT: Calculate percentages from normalized values, not from raw totals

    // Signed portion: Calculate percentage from signedNormalized (excluding handler/helper handler)
    // We calculate what percentage of totalSigned this employee should get, then apply to signedNormalized
    let signedPortionNormalized = 0;
    if (totalSigned > 0) {
        // Calculate the percentage of totalSigned that this employee should get
        const signedPortionPercentage = totalSignedPortion / totalSigned;
        // Apply that percentage to signedNormalized
        signedPortionNormalized = signedNormalized * signedPortionPercentage;
    }


    // Due portion: Calculate percentage from dueNormalized (handler/helper handler roles + Expert exception)
    const handlerPercentage = rolePercentages && rolePercentages.has('HANDLER')
        ? (rolePercentages.get('HANDLER')! / 100)
        : 0;
    // Helper Handler percentage (if exists in rolePercentages)
    const helperHandlerPercentage = rolePercentages && rolePercentages.has('HELPER_HANDLER')
        ? (rolePercentages.get('HELPER_HANDLER')! / 100)
        : 0;

    // Check if employee has Expert role in any leads (Expert is exception - gets percentage in both signed and due)
    // Expert should get percentage of dueNormalized if they have Expert role on any lead
    let hasExpertRole = false;
    roleCombinationMap.forEach((data) => {
        if (data.roles.includes('Expert')) {
            hasExpertRole = true;
        }
    });

    // Expert percentage (if employee has Expert role)
    const expertPercentage = hasExpertRole && rolePercentages && rolePercentages.has('EXPERT')
        ? (rolePercentages.get('EXPERT')! / 100)
        : 0;

    // Apply handler, helper handler, and expert percentages to dueNormalized
    const duePortionNormalized = dueNormalized * (handlerPercentage + helperHandlerPercentage + expertPercentage);

    // Step 6: Calculate base contribution (signed + due portions)
    const baseContribution = signedPortionNormalized + duePortionNormalized;

    // Step 7: Apply 35% to get final contribution amount
    const contribution = baseContribution * 0.35;

    // Debug logging for employees with 0 contribution but should have data
    if (contribution === 0 && (totalSigned > 0 || totalDue > 0)) {
        console.warn(`⚠️ Zero contribution but has data for employee ${employeeId} (${employeeName}):`, {
            totalSigned,
            totalDue,
            totalSignedPortion,
            signedNormalized,
            dueNormalized,
            signedPortionNormalized,
            duePortionNormalized,
            baseContribution,
            contribution,
            newLeadsCount: debugNewLeadsCount,
            newLeadsWithRoles: debugNewLeadsWithRoles,
            newLeadsPortion: debugNewLeadsPortion,
            legacyLeadsCount: debugLegacyLeadsCount,
            legacyLeadsWithRoles: debugLegacyLeadsWithRoles,
            legacyLeadsPortion: debugLegacyLeadsPortion,
            rolePercentages: rolePercentages ? Array.from(rolePercentages.entries()) : [],
            roleCombinationMapSize: roleCombinationMap.size,
            roleCombinations: Array.from(roleCombinationMap.entries()).map(([key, data]) => ({
                key,
                roles: data.roles,
                signedTotal: data.signedTotal,
                dueTotal: data.dueTotal
            }))
        });
    }

    // Step 8: Calculate salary budget (40% of final contribution)
    const salaryBudget = contribution * 0.4;

    // Step 7: Convert role combination map to array
    const roleBreakdown = Array.from(roleCombinationMap.entries()).map(([combinationKey, data]) => ({
        role: combinationKey,
        signedTotal: data.signedTotal,
        dueTotal: data.dueTotal,
        roles: data.roles,
    }));

    return {
        employeeId,
        signed: totalSigned,
        due: totalDue,
        signedNormalized,
        dueNormalized,
        signedPortion: signedPortionNormalized,
        duePortion: duePortionNormalized,
        contribution,
        salaryBudget,
        roleBreakdown,
    };
};

/**
 * Batch calculate metrics for multiple employees
 * This ensures all calculations are done before any state updates
 */
export const batchCalculateEmployeeMetrics = (
    inputs: EmployeeCalculationInput[]
): Map<number, EmployeeCalculationResult> => {
    const results = new Map<number, EmployeeCalculationResult>();

    // Calculate all employees synchronously
    inputs.forEach(input => {
        const result = calculateEmployeeMetrics(input);
        results.set(input.employeeId, result);
    });

    return results;
};
