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

/**
 * Citizenship is stored as a subcategory under a main category.
 * A lead shows as "Undefined (Germany)": the subcategory is Undefined and the
 * main category is Germany or Austria. Some rows use the full citizenship name.
 */
const CITIZENSHIP_HANDLER_STAGE_CATEGORIES = new Set([
  'austrian citizenship',
  'german citizenship',
  'austria',
  'germany',
]);

function normalizedCategoryName(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function categoryNamesFromLead(lead: any): string[] {
  const joined = Array.isArray(lead?.misc_category) ? lead.misc_category[0] : lead?.misc_category;
  const main = Array.isArray(joined?.misc_maincategory)
    ? joined.misc_maincategory[0]
    : joined?.misc_maincategory;
  const names = [
    normalizedCategoryName(joined?.name),
    normalizedCategoryName(main?.name),
    normalizedCategoryName(lead?.category_name),
    normalizedCategoryName(lead?.main_category),
    normalizedCategoryName(lead?.main_category_name),
  ];
  const display = normalizedCategoryName(lead?.category);
  if (display) {
    names.push(display);
    const parenthetical = display.match(/\(([^)]+)\)\s*$/);
    if (parenthetical) names.push(parenthetical[1].trim());
  }
  return names.filter(Boolean);
}

/** Austrian or German citizenship leads. The handler owns stage 1 on these cases. */
export function isCitizenshipHandlerStageLead(lead: any): boolean {
  return categoryNamesFromLead(lead).some((name) => CITIZENSHIP_HANDLER_STAGE_CATEGORIES.has(name));
}

/** Stage stored for this active worker. The case handler has none, except on citizenship leads, where it takes stage 1. */
export function handlingStageIdForActiveType(
  activeType: number | null | undefined,
  lead?: any,
): HandlingStageId | null {
  const role = handlingRoleByType(activeType);
  if (!role) return null;
  if (role.id === 'handler' && isCitizenshipHandlerStageLead(lead)) return 1;
  return role.stageId;
}

export function handlingStageForActiveType(
  activeType: number | null | undefined,
  lead?: any,
): HandlingStage | null {
  return handlingStageById(handlingStageIdForActiveType(activeType, lead));
}

/** The three roles a case can show as the active person in the header. Each one speaks to the client. */
const CLIENT_CONTACT_ROLE_IDS = ['handler', 'client_support', 'retainer_handler'] as const;

export function isClientContactRole(roleId: string | null | undefined): boolean {
  return (CLIENT_CONTACT_ROLE_IDS as readonly string[]).includes(String(roleId || ''));
}

/** Roles that work the current stage, client-contact role first. */
export function rolesForHandlingStage(
  stageId: HandlingStageId | null | undefined,
  lead?: any,
): HandlingRole[] {
  if (stageId == null) return [];
  const roles = HANDLING_SWITCH_ROLES.filter((role) => {
    if (role.id === 'handler') return stageId === 1 && isCitizenshipHandlerStageLead(lead);
    return role.stageId === stageId;
  });
  const contactId = communicationRoleForStage(stageId, lead)?.id;
  return roles.slice().sort((a, b) => Number(b.id === contactId) - Number(a.id === contactId));
}

/** The role that speaks to the client during this stage. On citizenship leads the handler speaks during stage 1. */
export function communicationRoleForStage(
  stageId: HandlingStageId | null | undefined,
  lead?: any,
): HandlingRole | null {
  if (stageId == null) return null;
  if (stageId === 1 && isCitizenshipHandlerStageLead(lead)) {
    return handlingRoleById('handler');
  }
  return (
    HANDLING_SWITCH_ROLES.find(
      (role) => role.communicatesWithClient && role.stageId === stageId,
    ) ?? null
  );
}

/** Preserve 1 and 3–10. Anything else, including empty, is the case handler (2). Type 5 was Application Manager and now stays on stage 1 as Submission Manager. */
export function readHandlingActiveType(value: unknown): number {
  const n = Number(value);
  if (n === 9) return 3;
  if (n === 5) return 4;
  if (n === 1 || (Number.isFinite(n) && n >= 3 && n <= 10)) return n;
  return 2;
}

/** Columns the client screen must keep on the lead row for the handling roles and stage. */
export function handlingFieldsFromLead(row: any): Record<string, unknown> {
  return {
    submission_manager_id: row?.submission_manager_id ?? null,
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
