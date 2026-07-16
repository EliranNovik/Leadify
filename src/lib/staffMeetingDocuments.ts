export type StaffMeetingDocumentsContext =
  | { mode: 'lead'; leadNumber: string; clientName: string; clientId?: string | null }
  | { mode: 'meeting'; staffMeetingId: number; meetingTitle: string };

const SEQUENCE_SLUGS = new Set(['sequence_of_events', 'sequence-of-events']);
const LEGAL_CLAIMS_SLUGS = new Set(['legal_claims', 'legal-claims']);
const EXPERT_SLUGS = new Set(['expert']);
const CONTRACT_SLUGS = new Set(['contract']);

export function isSequenceOfEventsSlug(slug: string | null | undefined): boolean {
  return !!slug && SEQUENCE_SLUGS.has(slug.trim().toLowerCase());
}

export function isLegalClaimsSlug(slug: string | null | undefined): boolean {
  return !!slug && LEGAL_CLAIMS_SLUGS.has(slug.trim().toLowerCase());
}

export function isExpertSlug(slug: string | null | undefined): boolean {
  return !!slug && EXPERT_SLUGS.has(slug.trim().toLowerCase());
}

export function isContractSlug(slug: string | null | undefined): boolean {
  return !!slug && CONTRACT_SLUGS.has(slug.trim().toLowerCase());
}

export function isSequenceOfEventsClassification(row: {
  slug?: string | null;
  label?: string | null;
}): boolean {
  if (isSequenceOfEventsSlug(row.slug)) return true;
  const label = String(row.label ?? '')
    .trim()
    .toLowerCase();
  return label === 'sequence of events';
}

export function isLegalClaimsClassification(row: {
  slug?: string | null;
  label?: string | null;
}): boolean {
  if (isLegalClaimsSlug(row.slug)) return true;
  const label = String(row.label ?? '')
    .trim()
    .toLowerCase();
  return label === 'legal claims';
}

export function isExpertClassification(row: {
  slug?: string | null;
  label?: string | null;
}): boolean {
  if (isExpertSlug(row.slug)) return true;
  const label = String(row.label ?? '')
    .trim()
    .toLowerCase();
  return label === 'expert';
}

export function isContractClassification(row: {
  slug?: string | null;
  label?: string | null;
}): boolean {
  if (isContractSlug(row.slug)) return true;
  const label = String(row.label ?? '')
    .trim()
    .toLowerCase();
  return label === 'contract';
}

/**
 * Collapse duplicate Sequence of Events classifications (portal `sequence-of-events` + CRM
 * `sequence_of_events`) into one tab. Prefer underscore slug, matching portal SQL.
 */
export function mergeSequenceOfEventsClassifications<
  T extends { id: string; slug: string; label: string; sort_order?: number },
>(rows: T[]): {
  tabs: T[];
  /** Every classification id (including aliases) → canonical tab id. */
  canonicalIdByAlias: Map<string, string>;
  /** Canonical tab id → all ids that should count/filter under that tab. */
  aliasIdsByCanonical: Map<string, Set<string>>;
} {
  return mergeAliasClassifications(rows, isSequenceOfEventsClassification, 'sequence_of_events');
}

/**
 * Collapse duplicate Legal Claims classifications (`legal_claims` + `legal-claims`) into one tab.
 */
export function mergeLegalClaimsClassifications<
  T extends { id: string; slug: string; label: string; sort_order?: number },
>(rows: T[]): {
  tabs: T[];
  canonicalIdByAlias: Map<string, string>;
  aliasIdsByCanonical: Map<string, Set<string>>;
} {
  return mergeAliasClassifications(rows, isLegalClaimsClassification, 'legal_claims');
}

export function mergeExpertClassifications<
  T extends { id: string; slug: string; label: string; sort_order?: number },
>(rows: T[]): {
  tabs: T[];
  canonicalIdByAlias: Map<string, string>;
  aliasIdsByCanonical: Map<string, Set<string>>;
} {
  return mergeAliasClassifications(rows, isExpertClassification, 'expert');
}

export function mergeContractClassifications<
  T extends { id: string; slug: string; label: string; sort_order?: number },
>(rows: T[]): {
  tabs: T[];
  canonicalIdByAlias: Map<string, string>;
  aliasIdsByCanonical: Map<string, Set<string>>;
} {
  return mergeAliasClassifications(rows, isContractClassification, 'contract');
}

function mergeAliasClassifications<
  T extends { id: string; slug: string; label: string; sort_order?: number },
>(
  rows: T[],
  isAliasGroup: (row: T) => boolean,
  preferredSlug: string,
): {
  tabs: T[];
  canonicalIdByAlias: Map<string, string>;
  aliasIdsByCanonical: Map<string, Set<string>>;
} {
  const canonicalIdByAlias = new Map<string, string>();
  const aliasIdsByCanonical = new Map<string, Set<string>>();
  const groupRows = rows.filter((r) => isAliasGroup(r));

  let canonical: T | null = null;
  if (groupRows.length > 0) {
    canonical =
      groupRows.find((r) => r.slug.trim().toLowerCase() === preferredSlug) ||
      groupRows.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0] ||
      groupRows[0];

    const aliasIds = new Set(groupRows.map((r) => r.id));
    aliasIdsByCanonical.set(canonical.id, aliasIds);
    for (const id of aliasIds) canonicalIdByAlias.set(id, canonical.id);
  }

  const tabs: T[] = [];
  let insertedGroup = false;
  for (const row of rows) {
    if (isAliasGroup(row)) {
      if (!insertedGroup && canonical) {
        tabs.push(canonical);
        insertedGroup = true;
      }
      continue;
    }
    tabs.push(row);
    canonicalIdByAlias.set(row.id, row.id);
    aliasIdsByCanonical.set(row.id, new Set([row.id]));
  }

  return { tabs, canonicalIdByAlias, aliasIdsByCanonical };
}

export function isPlaceholderStaffLead(lead: any): boolean {
  if (!lead) return true;
  const id = String(lead.id ?? '');
  if (id.startsWith('staff-')) return true;
  if (String(lead.lead_number ?? '').toUpperCase() === 'STAFF') return true;
  if (lead.email === '--') return true;
  return false;
}

/** Resolve whether docs go to lead (sequence of events) or staff_meeting_documents. */
export function resolveStaffMeetingDocumentsContext(
  meeting: any,
  dbMeetingId: number | null,
): StaffMeetingDocumentsContext | null {
  if (!dbMeetingId || !Number.isFinite(dbMeetingId)) return null;

  const title = String(
    meeting?.meeting_subject || meeting?.subject || meeting?.lead?.name || 'Internal meeting',
  ).trim();

  const lead = meeting?.lead;
  const legacyLead = meeting?.legacy_lead;

  if (!isPlaceholderStaffLead(lead) && lead?.lead_number) {
    return {
      mode: 'lead',
      leadNumber: String(lead.lead_number),
      clientName: String(lead.name || title),
      clientId: lead.id != null ? String(lead.id) : null,
    };
  }

  if (meeting?.client_id && lead?.lead_number && !isPlaceholderStaffLead(lead)) {
    return {
      mode: 'lead',
      leadNumber: String(lead.lead_number),
      clientName: String(lead.name || title),
      clientId: String(meeting.client_id),
    };
  }

  if (meeting?.legacy_lead_id != null || legacyLead?.id != null) {
    const legacyId = legacyLead?.id ?? meeting.legacy_lead_id;
    const leadNumber = legacyLead?.lead_number ?? String(legacyId);
    return {
      mode: 'lead',
      leadNumber: String(leadNumber),
      clientName: String(legacyLead?.name || title),
      clientId: legacyId != null ? `legacy_${legacyId}` : null,
    };
  }

  return { mode: 'meeting', staffMeetingId: dbMeetingId, meetingTitle: title };
}

/** Lead record for client navigation when an internal meeting is tied to a lead. */
export function resolveStaffMeetingLinkedLead(meeting: any): Record<string, any> | null {
  if (!meeting) return null;

  const lead = meeting.lead;
  const legacyLead = meeting.legacy_lead;

  const asLegacy = (legacyId: string | number, row?: Record<string, any> | null) => {
    const idStr = String(legacyId).replace(/^legacy_/, '');
    return {
      ...(row || {}),
      id: row?.id != null && String(row.id).startsWith('legacy_') ? row.id : `legacy_${idStr}`,
      lead_type: 'legacy',
      lead_number: row?.lead_number ?? idStr,
      name: row?.name ?? lead?.name,
      manual_id: row?.manual_id,
    };
  };

  const asNew = (row: Record<string, any>, clientId?: string | null) => ({
    ...row,
    id: clientId ?? row.id,
    lead_type: row.lead_type || 'new',
    lead_number: row.lead_number,
    name: row.name,
    manual_id: row.manual_id,
  });

  if (!isPlaceholderStaffLead(lead) && lead?.lead_number) {
    if (lead.lead_type === 'legacy' || String(lead.id ?? '').startsWith('legacy_')) {
      const legacyId = String(lead.id ?? '').replace(/^legacy_/, '') || lead.lead_number;
      return asLegacy(legacyId, lead);
    }
    return asNew(lead, meeting.client_id ?? lead.id);
  }

  if (meeting?.legacy_lead_id != null || legacyLead?.id != null) {
    const legacyId = legacyLead?.id ?? meeting.legacy_lead_id;
    return asLegacy(legacyId, legacyLead);
  }

  const subject = String(meeting.meeting_subject || lead?.name || meeting.name || '').trim();
  const hashMatch = subject.match(/\[#([^\]]+)\]/);
  if (hashMatch) {
    const leadNumber = hashMatch[1].trim();
    if (/^\d+$/.test(leadNumber)) {
      return asLegacy(leadNumber, { lead_number: leadNumber, name: lead?.name });
    }
    return asNew(
      { lead_number: leadNumber, name: lead?.name, manual_id: lead?.manual_id },
      meeting.client_id ?? leadNumber,
    );
  }

  if (meeting?.client_id && lead?.lead_number && lead.lead_number !== 'STAFF') {
    return asNew(lead, meeting.client_id);
  }

  return null;
}
