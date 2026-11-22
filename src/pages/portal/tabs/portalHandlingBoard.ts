import {
  communicationRoleForStage,
  handlingStageForActiveType,
  isCitizenshipHandlerStageLead,
  readHandlingActiveType,
  rolesForHandlingStage,
  type HandlingStageId,
} from '../../../lib/handlingRoles';

export type PortalHandlingPerson = {
  roleId: string;
  name: string;
  /** English name used to open the same business card as the dashboard. */
  lookupName: string;
  photoUrl: string | null;
};

export type PortalHandlingBoard = {
  activeStageId: HandlingStageId;
  contact: PortalHandlingPerson | null;
  others: PortalHandlingPerson[];
  /** Everyone assigned on the case, so a stage window can name who does each step. */
  assigned: PortalHandlingPerson[];
};

type SummaryLike = {
  category?: string | null;
  main_category_name?: string | null;
  active_handler_type?: number | null;
  handling_roles?: Array<{
    role?: string | null;
    name?: string | null;
    name_he?: string | null;
    photo_url?: string | null;
  }> | null;
  handler_name?: string | null;
  handler_name_he?: string | null;
  handler_photo_url?: string | null;
  retainer_handler_name?: string | null;
  retainer_handler_name_he?: string | null;
  retainer_handler_photo_url?: string | null;
} | null | undefined;

function pickName(
  preferHebrew: boolean,
  english: string | null | undefined,
  hebrew: string | null | undefined,
): string {
  const en = english?.trim() || '';
  const he = hebrew?.trim() || '';
  if (preferHebrew && he && he !== en) return he;
  return en || he;
}

function usableName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed === '—' || trimmed === 'Not assigned' || trimmed === '---') return null;
  return trimmed;
}

/** German and Austrian citizenship only. Other case types keep the checklist on its own. */
export function buildPortalHandlingBoard(
  summary: SummaryLike,
  language: string,
): PortalHandlingBoard | null {
  if (!summary || summary.active_handler_type == null) return null;
  const lead = {
    category: summary.category,
    main_category_name: summary.main_category_name,
    category_name: summary.category,
  };
  if (!isCitizenshipHandlerStageLead(lead)) return null;

  const activeType = readHandlingActiveType(summary.active_handler_type);
  const stage = handlingStageForActiveType(activeType, lead);
  if (!stage) return null;

  const preferHebrew = language.toLowerCase().startsWith('he');
  const people = new Map<string, PortalHandlingPerson[]>();
  const push = (
    roleId: string,
    name: string | null,
    lookupName: string | null,
    photoUrl: string | null | undefined,
  ) => {
    const usable = name ? usableName(name) : null;
    const lookup = usableName(lookupName) || usable;
    if (!roleId || !usable || !lookup) return;
    const list = people.get(roleId) ?? [];
    if (list.some((person) => person.name === usable)) return;
    list.push({ roleId, name: usable, lookupName: lookup, photoUrl: photoUrl?.trim() || null });
    people.set(roleId, list);
  };

  for (const row of summary.handling_roles ?? []) {
    const roleId = row.role?.trim() || '';
    push(roleId, pickName(preferHebrew, row.name, row.name_he), row.name ?? null, row.photo_url);
  }
  push(
    'handler',
    pickName(preferHebrew, summary.handler_name, summary.handler_name_he),
    summary.handler_name ?? null,
    summary.handler_photo_url,
  );
  push(
    'retainer_handler',
    pickName(preferHebrew, summary.retainer_handler_name, summary.retainer_handler_name_he),
    summary.retainer_handler_name ?? null,
    summary.retainer_handler_photo_url,
  );

  const stageRoles = rolesForHandlingStage(stage.id, lead);
  const contactRoleId = communicationRoleForStage(stage.id, lead)?.id ?? null;
  const contact = contactRoleId ? people.get(contactRoleId)?.[0] ?? null : null;
  const others = stageRoles
    .filter((role) => role.id !== contactRoleId)
    .flatMap((role) => people.get(role.id) ?? []);

  return {
    activeStageId: stage.id,
    contact,
    others,
    assigned: [...people.values()].flat(),
  };
}
