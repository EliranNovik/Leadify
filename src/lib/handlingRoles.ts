/**
 * Handling roles and the three handling stages.
 *
 * The numbers on `activeType` are `leads.active_handler_type` / `leads_lead.active_handler_type`.
 * 1, 2 and 3 stay the original three (completion coordinator, handler, case monitoring coordinator).
 * 4–10 are the additional handling roles. The stage on a case follows the active role.
 *
 * Keep this in step with sql/2026-11-08_handling_roles_and_stages.sql.
 */

export type HandlingStageId = 1 | 2 | 3;

export type HandlingStage = {
  id: HandlingStageId;
  code: string;
  name: string;
  shortLabel: string;
  description: string;
};

export type HandlingRole = {
  /** Roles-tab id. Completion coordinator keeps `retainer_handler` so the existing column stays. */
  id: string;
  title: string;
  /** Compact label for the header chip. */
  shortLabel: string;
  focus: string;
  responsibilities: string;
  /** Value stored in active_handler_type when this role is the active worker. */
  activeType: number;
  /** Employee id column on leads and leads_lead. */
  column: string;
  stageId: HandlingStageId | null;
  /** This role is the client-communication owner for that stage. */
  communicatesWithClient: boolean;
};

export const HANDLING_STAGES: HandlingStage[] = [
  {
    id: 1,
    code: 'app_prep_submission',
    name: 'Application Preparation and Submission',
    shortLabel: 'App. Prep. & Submission',
    description:
      'Prepare the citizenship application and submit it. This stage covers department oversight, application handling, scanning and file management, collecting documents, and notarization.',
  },
  {
    id: 2,
    code: 'wait_monitor',
    name: 'Waiting and Monitoring',
    shortLabel: 'Wait & Monitor',
    description:
      'Wait and follow the case until the authorities ask for additional documentation. This stage is client relations and case follow-up.',
  },
  {
    id: 3,
    code: 'add_docs_citizenship',
    name: 'Additional Documentation and Obtaining Citizenship',
    shortLabel: 'Add. Docs & Obt. Citizenship',
    description:
      'Finish additional documentation and obtain citizenship. This stage covers liaison with the Austrian and German authorities, completing the file, and coordinating with the client.',
  },
];

export const HANDLING_SWITCH_ROLES: HandlingRole[] = [
  {
    id: 'handler',
    title: 'Handler',
    shortLabel: 'Handler',
    focus: 'Case handler',
    responsibilities:
      'The case handler assigned on the lead. This role is outside the three handling stages.',
    activeType: 2,
    column: 'case_handler_id',
    stageId: null,
    communicatesWithClient: false,
  },
  {
    id: 'submission_manager',
    title: 'Submission Manager',
    shortLabel: 'Submission Mgr',
    focus: 'Department management',
    responsibilities:
      'Runs the submissions department and oversees how applications are prepared and filed.',
    activeType: 4,
    column: 'submission_manager_id',
    stageId: 1,
    communicatesWithClient: false,
  },
  {
    id: 'application_manager',
    title: 'Application Manager',
    shortLabel: 'Application Mgr',
    focus: 'Application handling',
    responsibilities:
      'Handles preparation of the application. Responsible for client communication during application preparation and submission.',
    activeType: 5,
    column: 'application_manager_id',
    stageId: 1,
    communicatesWithClient: true,
  },
  {
    id: 'digital_case_coordinator',
    title: 'Digital Case Coordinator',
    shortLabel: 'Digital Case',
    focus: 'Document scanning and file management',
    responsibilities: 'Scans documents and keeps the digital case file in order.',
    activeType: 6,
    column: 'digital_case_coordinator_id',
    stageId: 1,
    communicatesWithClient: false,
  },
  {
    id: 'document_procurement_coordinator',
    title: 'Document Procurement Coordinator',
    shortLabel: 'Doc Procurement',
    focus: 'Document collection',
    responsibilities: 'Collects the documents the application needs. Assigned per case.',
    activeType: 7,
    column: 'document_procurement_coordinator_id',
    stageId: 1,
    communicatesWithClient: false,
  },
  {
    id: 'certification_coordinator',
    title: 'Certification Coordinator',
    shortLabel: 'Certification',
    focus: 'Notarization and authentication',
    responsibilities: 'Arranges notarization and authentication of documents.',
    activeType: 8,
    column: 'certification_coordinator_id',
    stageId: 1,
    communicatesWithClient: false,
  },
  {
    id: 'authorities_coordinator',
    title: 'Authorities Coordinator',
    shortLabel: 'Authorities',
    focus: 'Liaison with Austrian and German authorities',
    responsibilities: 'Liaises with the Austrian and German authorities on the case.',
    activeType: 10,
    column: 'authorities_coordinator_id',
    stageId: 3,
    communicatesWithClient: false,
  },
  {
    id: 'retainer_handler',
    title: 'Completion Coordinator',
    shortLabel: 'Completion',
    focus: 'Documentation completion and client coordination',
    responsibilities:
      'Completes the remaining documentation and coordinates with the client through to citizenship. Responsible for client communication during additional documentation and obtaining citizenship.',
    activeType: 1,
    column: 'retainer_handler_id',
    stageId: 3,
    communicatesWithClient: true,
  },
  {
    id: 'client_support',
    title: 'Case Monitoring Coordinator',
    shortLabel: 'Case Monitoring',
    focus: 'Client relations and case follow-up',
    responsibilities:
      'Follows the case while it waits with the authorities and keeps the client updated. Responsible for client communication during waiting and monitoring.',
    activeType: 3,
    column: 'client_support_id',
    stageId: 2,
    communicatesWithClient: true,
  },
];

/** New id-backed roles. Completion coordinator, handler, and client support already had columns. */
export const EXTRA_HANDLING_ROLES: HandlingRole[] = HANDLING_SWITCH_ROLES.filter(
  (role) =>
    role.id !== 'handler' && role.id !== 'retainer_handler' && role.id !== 'client_support',
);

const ROLE_BY_ID = new Map(HANDLING_SWITCH_ROLES.map((role) => [role.id, role]));
const ROLE_BY_TYPE = new Map(HANDLING_SWITCH_ROLES.map((role) => [role.activeType, role]));
const STAGE_BY_ID = new Map(HANDLING_STAGES.map((stage) => [stage.id, stage]));

export function handlingRoleById(id: string | null | undefined): HandlingRole | null {
  if (!id) return null;
  return ROLE_BY_ID.get(id) ?? null;
}

export function handlingRoleByType(activeType: number | null | undefined): HandlingRole | null {
  if (activeType == null) return null;
  return ROLE_BY_TYPE.get(Number(activeType)) ?? null;
}

export function handlingStageById(stageId: number | null | undefined): HandlingStage | null {
  if (stageId == null) return null;
  return STAGE_BY_ID.get(Number(stageId) as HandlingStageId) ?? null;
}

export function handlingStageForRole(roleId: string | null | undefined): HandlingStage | null {
  const role = handlingRoleById(roleId);
  if (!role?.stageId) return null;
  return handlingStageById(role.stageId);
}

/** Stage that should be stored when this active_handler_type owns the case. Null for the case handler. */
export function handlingStageIdForActiveType(activeType: number | null | undefined): HandlingStageId | null {
  return handlingRoleByType(activeType)?.stageId ?? null;
}

export function handlingStageForActiveType(activeType: number | null | undefined): HandlingStage | null {
  return handlingStageById(handlingStageIdForActiveType(activeType));
}

/** The role that speaks to the client during this stage. */
export function communicationRoleForStage(stageId: HandlingStageId | null | undefined): HandlingRole | null {
  if (stageId == null) return null;
  return (
    HANDLING_SWITCH_ROLES.find(
      (role) => role.communicatesWithClient && role.stageId === stageId,
    ) ?? null
  );
}

/** Preserve 1 and 3–10. Anything else, including empty, is the case handler (2). */
export function readHandlingActiveType(value: unknown): number {
  const n = Number(value);
  if (n === 9) return 3;
  if (n === 1 || (Number.isFinite(n) && n >= 3 && n <= 10)) return n;
  return 2;
}

/** Columns the client screen must keep on the lead row for the handling roles and stage. */
export function handlingFieldsFromLead(row: any): Record<string, unknown> {
  return {
    submission_manager_id: row?.submission_manager_id ?? null,
    application_manager_id: row?.application_manager_id ?? null,
    digital_case_coordinator_id: row?.digital_case_coordinator_id ?? null,
    document_procurement_coordinator_id: row?.document_procurement_coordinator_id ?? null,
    certification_coordinator_id: row?.certification_coordinator_id ?? null,
    authorities_coordinator_id: row?.authorities_coordinator_id ?? null,
    handling_stage_id: row?.handling_stage_id ?? null,
    active_handler_type: readHandlingActiveType(row?.active_handler_type),
  };
}

export function employeeIdOnLead(lead: any, roleId: string): number | null {
  const role = handlingRoleById(roleId);
  if (!role || !lead) return null;
  const raw = lead[role.column];
  if (raw == null || raw === '' || raw === '---' || raw === '--') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type HandlingMenuSeed = {
  type: number;
  key: string;
  id: number | null;
  /** Full title, used in the switch menu. */
  rolesLabel: string;
  /** Compact title for the active chip. */
  chipLabel: string;
  display: string;
};

export function partitionHandlingRoles(args: {
  visible: boolean;
  idFor: (roleId: string) => number | null;
  displayFor: (roleId: string, id: number | null) => string;
  isEmpty: (id: number | null, display: string) => boolean;
}): { assigned: HandlingMenuSeed[]; missing: HandlingMenuSeed[] } {
  const assigned: HandlingMenuSeed[] = [];
  const missing: HandlingMenuSeed[] = [];
  if (!args.visible) return { assigned, missing };
  for (const role of HANDLING_SWITCH_ROLES) {
    const id = args.idFor(role.id);
    const display = args.displayFor(role.id, id);
    if (args.isEmpty(id, display)) {
      missing.push({
        type: role.activeType,
        key: role.id,
        id: null,
        rolesLabel: role.title,
        chipLabel: role.shortLabel,
        display: 'Not assigned',
      });
    } else {
      assigned.push({
        type: role.activeType,
        key: role.id,
        id,
        rolesLabel: role.title,
        chipLabel: role.shortLabel,
        display,
      });
    }
  }
  return { assigned, missing };
}
