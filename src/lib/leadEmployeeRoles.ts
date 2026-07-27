import type { ComponentType, SVGProps } from 'react';
import {
  AcademicCapIcon,
  BanknotesIcon,
  BriefcaseIcon,
  CalendarIcon,
  CogIcon,
  HandRaisedIcon,
  MegaphoneIcon,
  UserCircleIcon,
  UserIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import { supabase } from './supabase';
import type { LeadReportingType } from './employeeLeadReporting';
import {
  legacyLeadMatchesExpert,
  newLeadFieldMatchesEmployee,
  newLeadMatchesExpert,
} from '../utils/rolePercentageCalculator';

export type LeadRoleDefinition = {
  id: string;
  title: string;
};

export type LeadEmployeeRole = LeadRoleDefinition;

type HeroIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** Same icons as RolesTab.getRoleIcon. */
export function getLeadRoleIcon(roleId: string): HeroIcon {
  switch (roleId) {
    case 'scheduler':
      return CalendarIcon;
    case 'manager':
      return UserCircleIcon;
    case 'helper':
      return WrenchScrewdriverIcon;
    case 'expert':
      return AcademicCapIcon;
    case 'closer':
      return HandRaisedIcon;
    case 'handler':
      return CogIcon;
    case 'retainer_handler':
      return BriefcaseIcon;
    case 'collection_manager':
      return BanknotesIcon;
    case 'marketing_officer':
      return MegaphoneIcon;
    default:
      return UserIcon;
  }
}

/** Same role set as RolesTab (Sales / Handlers / Finance / Marketing). */
export const LEAD_ROLE_DEFINITIONS: LeadRoleDefinition[] = [
  { id: 'scheduler', title: 'Scheduler' },
  { id: 'manager', title: 'Manager' },
  { id: 'helper', title: 'Helper' },
  { id: 'expert', title: 'Expert' },
  { id: 'closer', title: 'Closer' },
  { id: 'handler', title: 'Handler' },
  { id: 'retainer_handler', title: 'Retention Handler' },
  { id: 'collection_manager', title: 'Collection manager' },
  { id: 'marketing_officer', title: 'Marketing Officer' },
];

const ROLE_BY_ID = Object.fromEntries(
  LEAD_ROLE_DEFINITIONS.map((r) => [r.id, r]),
) as Record<string, LeadRoleDefinition>;

function roleOf(id: string): LeadEmployeeRole {
  return ROLE_BY_ID[id] || { id, title: id };
}

/**
 * Columns RolesTab writes on `leads`.
 * Keep this list conservative — missing columns make PostgREST reject the whole select.
 */
const NEW_LEAD_ROLE_SELECT = [
  'scheduler',
  'manager',
  'helper',
  'expert',
  'closer',
  'handler',
  'case_handler_id',
  'retainer_handler_id',
  'meeting_collection_id',
  'marketing_officer_id',
].join(', ');

/** Narrower fallback if optional columns (e.g. marketing_officer_id) are missing in an older DB. */
const NEW_LEAD_ROLE_SELECT_MINIMAL = [
  'scheduler',
  'manager',
  'helper',
  'expert',
  'closer',
  'handler',
  'case_handler_id',
  'retainer_handler_id',
].join(', ');

/** ID columns on `leads_lead` used by RolesTab (no text role columns). */
const LEGACY_LEAD_ROLE_SELECT = [
  'meeting_scheduler_id',
  'meeting_manager_id',
  'meeting_lawyer_id',
  'expert_id',
  'closer_id',
  'case_handler_id',
  'retainer_handler_id',
  'meeting_collection_id',
  'marketing_officer_id',
].join(', ');

function matchesId(value: unknown, employeeId: number): boolean {
  if (value == null || value === '') return false;
  const n = Number(value);
  return Number.isFinite(n) && n === employeeId;
}

function rolesFromNewLeadRow(
  row: Record<string, unknown>,
  employeeId: number,
  employeeName: string,
): LeadEmployeeRole[] {
  const roles: LeadEmployeeRole[] = [];
  const name = employeeName || '';

  if (newLeadFieldMatchesEmployee(row.scheduler, employeeId, name)) {
    roles.push(roleOf('scheduler'));
  }
  if (
    newLeadFieldMatchesEmployee(row.manager, employeeId, name) ||
    matchesId(row.meeting_manager_id, employeeId)
  ) {
    roles.push(roleOf('manager'));
  }
  if (
    newLeadFieldMatchesEmployee(row.helper, employeeId, name) ||
    matchesId(row.meeting_lawyer_id, employeeId)
  ) {
    roles.push(roleOf('helper'));
  }
  if (newLeadMatchesExpert(row, employeeId, name)) {
    roles.push(roleOf('expert'));
  }
  if (newLeadFieldMatchesEmployee(row.closer, employeeId, name)) {
    roles.push(roleOf('closer'));
  }
  if (
    newLeadFieldMatchesEmployee(row.handler, employeeId, name) ||
    matchesId(row.case_handler_id, employeeId)
  ) {
    roles.push(roleOf('handler'));
  }
  if (matchesId(row.retainer_handler_id, employeeId)) {
    roles.push(roleOf('retainer_handler'));
  }
  if (matchesId(row.meeting_collection_id, employeeId)) {
    roles.push(roleOf('collection_manager'));
  }
  if (matchesId(row.marketing_officer_id, employeeId)) {
    roles.push(roleOf('marketing_officer'));
  }

  return roles;
}

function rolesFromLegacyLeadRow(
  row: Record<string, unknown>,
  employeeId: number,
  employeeName: string,
): LeadEmployeeRole[] {
  const roles: LeadEmployeeRole[] = [];

  if (matchesId(row.meeting_scheduler_id, employeeId)) roles.push(roleOf('scheduler'));
  if (matchesId(row.meeting_manager_id, employeeId)) roles.push(roleOf('manager'));
  if (matchesId(row.meeting_lawyer_id, employeeId)) roles.push(roleOf('helper'));
  if (legacyLeadMatchesExpert(row, employeeId, employeeName || '')) roles.push(roleOf('expert'));
  if (matchesId(row.closer_id, employeeId)) roles.push(roleOf('closer'));
  if (matchesId(row.case_handler_id, employeeId)) roles.push(roleOf('handler'));
  if (matchesId(row.retainer_handler_id, employeeId)) roles.push(roleOf('retainer_handler'));
  if (matchesId(row.meeting_collection_id, employeeId)) roles.push(roleOf('collection_manager'));
  if (matchesId(row.marketing_officer_id, employeeId)) roles.push(roleOf('marketing_officer'));

  return roles;
}

async function resolveNewLeadId(params: {
  newLeadId: string | null;
  leadNumber: string;
}): Promise<string | null> {
  if (params.newLeadId) return params.newLeadId;
  const leadNumber = String(params.leadNumber || '').trim();
  if (!leadNumber || leadNumber === '—') return null;

  const { data, error } = await supabase
    .from('leads')
    .select('id')
    .eq('lead_number', leadNumber)
    .maybeSingle();
  if (error) {
    console.error('[leadEmployeeRoles] resolve by lead_number failed:', error);
    return null;
  }
  return data?.id ? String(data.id) : null;
}

async function fetchLeadRoleRow(params: {
  leadType: LeadReportingType | null;
  newLeadId: string | null;
  legacyLeadId: number | null;
  leadNumber: string;
}): Promise<{ kind: 'new' | 'legacy'; row: Record<string, unknown> } | null> {
  const preferLegacy = params.leadType === 'legacy' && params.legacyLeadId != null;

  if (preferLegacy) {
    const { data, error } = await supabase
      .from('leads_lead')
      .select(LEGACY_LEAD_ROLE_SELECT)
      .eq('id', params.legacyLeadId!)
      .maybeSingle();
    if (error) {
      console.error('[leadEmployeeRoles] legacy fetch failed:', error);
      throw new Error(error.message || 'Failed to load employee roles');
    }
    if (data) return { kind: 'legacy', row: data as Record<string, unknown> };
  }

  const newLeadId = await resolveNewLeadId(params);
  if (newLeadId) {
    const primary = await supabase
      .from('leads')
      .select(NEW_LEAD_ROLE_SELECT)
      .eq('id', newLeadId)
      .maybeSingle();

    if (primary.error) {
      console.warn('[leadEmployeeRoles] new lead select failed, retrying minimal:', primary.error);
      const fallback = await supabase
        .from('leads')
        .select(NEW_LEAD_ROLE_SELECT_MINIMAL)
        .eq('id', newLeadId)
        .maybeSingle();
      if (fallback.error) {
        console.error('[leadEmployeeRoles] new lead fetch failed:', fallback.error);
        throw new Error(fallback.error.message || 'Failed to load employee roles');
      }
      if (fallback.data) return { kind: 'new', row: fallback.data as Record<string, unknown> };
    } else if (primary.data) {
      return { kind: 'new', row: primary.data as Record<string, unknown> };
    }
  }

  // Fallback: legacy id without leadType hint (rare allocation rows)
  if (!preferLegacy && params.legacyLeadId != null) {
    const { data, error } = await supabase
      .from('leads_lead')
      .select(LEGACY_LEAD_ROLE_SELECT)
      .eq('id', params.legacyLeadId)
      .maybeSingle();
    if (error) {
      console.error('[leadEmployeeRoles] legacy fallback fetch failed:', error);
      throw new Error(error.message || 'Failed to load employee roles');
    }
    if (data) return { kind: 'legacy', row: data as Record<string, unknown> };
  }

  return null;
}

/**
 * Resolve which Roles-tab roles this employee holds on a lead.
 */
export async function fetchEmployeeRolesOnLead(params: {
  employeeId: number;
  employeeName: string;
  leadType: LeadReportingType | null;
  newLeadId: string | null;
  legacyLeadId: number | null;
  leadNumber: string;
}): Promise<LeadEmployeeRole[]> {
  const fetched = await fetchLeadRoleRow(params);
  if (!fetched) return [];
  return fetched.kind === 'legacy'
    ? rolesFromLegacyLeadRow(fetched.row, params.employeeId, params.employeeName)
    : rolesFromNewLeadRow(fetched.row, params.employeeId, params.employeeName);
}

/**
 * Roles for many employees on one lead (all-time detail table).
 */
export async function fetchRolesByEmployeeOnLead(params: {
  leadType: LeadReportingType | null;
  newLeadId: string | null;
  legacyLeadId: number | null;
  leadNumber: string;
  employees: Array<{ employeeId: number; employeeName: string }>;
}): Promise<Map<number, LeadEmployeeRole[]>> {
  const map = new Map<number, LeadEmployeeRole[]>();
  if (params.employees.length === 0) return map;

  const fetched = await fetchLeadRoleRow(params);
  for (const emp of params.employees) {
    if (!fetched) {
      map.set(emp.employeeId, []);
      continue;
    }
    map.set(
      emp.employeeId,
      fetched.kind === 'legacy'
        ? rolesFromLegacyLeadRow(fetched.row, emp.employeeId, emp.employeeName)
        : rolesFromNewLeadRow(fetched.row, emp.employeeId, emp.employeeName),
    );
  }
  return map;
}
