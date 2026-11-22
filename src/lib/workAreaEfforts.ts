export type WorkAreaId = 'marketing' | 'sales' | 'handling' | 'finances' | 'development';

export type EffortAreaId = Exclude<WorkAreaId, 'handling'>;

export type WorkArea = {
  id: WorkAreaId;
  label: string;
};

export type WorkEffort = {
  id: string;
  area: EffortAreaId;
  category: string;
  name: string;
};

/** An external firm tied to one effort on this day. */
export type EffortFirmLink = {
  id: string;
  name: string;
  imageUrl: string | null;
};

/** A lead tied to one effort on this day. An effort can have several. */
export type EffortLeadLink = {
  key: string;
  leadType: 'new' | 'legacy';
  newLeadId: string | null;
  legacyLeadId: number | null;
  leadNumber: string;
  clientName: string;
};

export type EffortAllocationInput = {
  area: EffortAreaId;
  effortId: string;
  percent: number;
  /** Empty means General: the time is not for one department. */
  departmentIds: number[];
  firms: EffortFirmLink[];
  leads: EffortLeadLink[];
};

export type EffortTimeDraft = {
  percent: number;
  departmentIds: number[];
  firms: EffortFirmLink[];
  leads: EffortLeadLink[];
};

export const WORK_AREAS: WorkArea[] = [
  { id: 'marketing', label: 'Marketing' },
  { id: 'sales', label: 'Sales' },
  { id: 'handling', label: 'Handling' },
  { id: 'finances', label: 'Finances' },
  { id: 'development', label: 'Development' },
];

/**
 * Day-to-day work inside each area. Handling stays on lead allocations, so it has no efforts here.
 */
export const WORK_EFFORTS: WorkEffort[] = [
  { id: 'marketing.meetings', area: 'marketing', category: 'Meetings', name: 'Meetings' },
  { id: 'marketing.paid_ads', area: 'marketing', category: 'Campaigns', name: 'Paid ads' },
  { id: 'marketing.landing_pages', area: 'marketing', category: 'Campaigns', name: 'Landing pages and forms' },
  { id: 'marketing.tracking', area: 'marketing', category: 'Campaigns', name: 'Campaign tracking' },
  { id: 'marketing.website', area: 'marketing', category: 'Content', name: 'Website and blog' },
  { id: 'marketing.social', area: 'marketing', category: 'Content', name: 'Social media' },
  { id: 'marketing.email', area: 'marketing', category: 'Content', name: 'Email and newsletters' },
  { id: 'marketing.lead_sources', area: 'marketing', category: 'Pipeline', name: 'Lead source review' },
  { id: 'marketing.partners', area: 'marketing', category: 'Pipeline', name: 'Partners and referrals' },
  { id: 'marketing.reporting', area: 'marketing', category: 'Pipeline', name: 'Marketing reporting' },

  { id: 'sales.meetings', area: 'sales', category: 'Meetings', name: 'Meetings' },
  { id: 'sales.first_contact', area: 'sales', category: 'New leads', name: 'First contact and follow-up' },
  { id: 'sales.qualification', area: 'sales', category: 'New leads', name: 'Qualification' },
  { id: 'sales.proposals', area: 'sales', category: 'Offers', name: 'Proposals and pricing' },
  { id: 'sales.contracts', area: 'sales', category: 'Offers', name: 'Contracts and signing' },
  { id: 'sales.pipeline', area: 'sales', category: 'Pipeline', name: 'Pipeline review' },
  { id: 'sales.handoff', area: 'sales', category: 'Pipeline', name: 'Handoff to handling' },

  { id: 'finances.meetings', area: 'finances', category: 'Meetings', name: 'Meetings' },
  { id: 'finances.proformas', area: 'finances', category: 'Billing', name: 'Proformas and invoices' },
  { id: 'finances.payment_plans', area: 'finances', category: 'Billing', name: 'Payment plans and VAT' },
  { id: 'finances.receipts', area: 'finances', category: 'Billing', name: 'Receipts' },
  { id: 'finances.collection', area: 'finances', category: 'Collection', name: 'Payment follow-up' },
  { id: 'finances.refunds', area: 'finances', category: 'Collection', name: 'Refunds and adjustments' },
  { id: 'finances.reconciliation', area: 'finances', category: 'Collection', name: 'Bank reconciliation' },
  { id: 'finances.balances', area: 'finances', category: 'Reporting', name: 'Cash and balances' },
  { id: 'finances.payroll', area: 'finances', category: 'Reporting', name: 'Payroll support' },

  { id: 'development.meetings', area: 'development', category: 'Meetings', name: 'Meetings' },
  { id: 'development.crm', area: 'development', category: 'Product', name: 'CRM features' },
  { id: 'development.portal', area: 'development', category: 'Product', name: 'Client portal' },
  { id: 'development.bugs', area: 'development', category: 'Product', name: 'Bug fixes' },
  { id: 'development.integrations', area: 'development', category: 'Integrations', name: 'Microsoft, WhatsApp, and email' },
  { id: 'development.imports', area: 'development', category: 'Integrations', name: 'Sheets and imports' },
  { id: 'development.data', area: 'development', category: 'Integrations', name: 'Database and data' },
  { id: 'development.reports', area: 'development', category: 'Operations', name: 'Reports and internal tools' },
  { id: 'development.automation', area: 'development', category: 'Operations', name: 'Automation' },
];

const EFFORT_BY_ID = new Map(WORK_EFFORTS.map((effort) => [effort.id, effort]));

export function workAreaById(id: WorkAreaId): WorkArea {
  return WORK_AREAS.find((area) => area.id === id) ?? WORK_AREAS[2];
}

export function effortsForArea(area: EffortAreaId): WorkEffort[] {
  return WORK_EFFORTS.filter((effort) => effort.area === area);
}

export function effortById(id: string): WorkEffort | undefined {
  return EFFORT_BY_ID.get(id);
}

export function effortCategories(area: EffortAreaId): { category: string; efforts: WorkEffort[] }[] {
  const groups: { category: string; efforts: WorkEffort[] }[] = [];
  for (const effort of effortsForArea(area)) {
    const existing = groups.find((group) => group.category === effort.category);
    if (existing) existing.efforts.push(effort);
    else groups.push({ category: effort.category, efforts: [effort] });
  }
  return groups;
}

export function isEffortArea(id: WorkAreaId): id is EffortAreaId {
  return id !== 'handling';
}

export function effortInputsFromDrafts(
  areas: WorkAreaId[],
  drafts: Record<string, EffortTimeDraft>,
  extraEfforts: WorkEffort[] = [],
): EffortAllocationInput[] {
  const selected = new Set(areas);
  return [...WORK_EFFORTS, ...extraEfforts].flatMap((effort) => {
    if (!selected.has(effort.area)) return [];
    const draft = drafts[effort.id];
    const percent = Number(draft?.percent || 0);
    if (!(percent > 0)) return [];
    const departmentIds = (draft?.departmentIds ?? [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id));
    return [{
      area: effort.area,
      effortId: effort.id,
      percent,
      departmentIds,
      firms: draft?.firms ?? [],
      leads: draft?.leads ?? [],
    }];
  });
}
