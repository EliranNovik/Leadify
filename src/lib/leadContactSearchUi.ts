import type { CombinedLead } from './legacyLeadsApi';
import { buildContactBridgeRoute } from './contactBridgeApi';

export function formatLeadContactSearchSubtitle(lead: CombinedLead): string {
  const parts: string[] = [];
  if (lead.lead_number) parts.push(lead.lead_number);
  if (lead.isContact && lead.contactName) parts.push(lead.contactName);
  else if (lead.name) parts.push(lead.name);
  if (lead.mobile) parts.push(lead.mobile);
  else if (lead.phone) parts.push(lead.phone);
  if (lead.email) parts.push(lead.email);
  return parts.filter(Boolean).join(' · ');
}

export function getLeadContactSearchResultTitle(lead: CombinedLead): string {
  if (lead.isContact && lead.contactName) return lead.contactName;
  return lead.name || lead.lead_number || 'Unknown lead';
}

export function getLeadContactSearchResultKey(lead: CombinedLead, index: number): string {
  if (lead.isContact && lead.contact_id) {
    return `contact-${lead.contact_id}`;
  }
  return `${lead.lead_type}-${lead.id}-${lead.isContact ? 'contact' : 'lead'}-${lead.contactName || ''}-${index}`;
}

export function isLeadContactSearchResultContact(lead: CombinedLead): boolean {
  return Boolean(lead.isContact);
}

export function isLeadContactSearchInactive(lead: CombinedLead): boolean {
  if (lead.lead_type === 'legacy') {
    return lead.status === 10 || lead.status === '10';
  }
  return lead.status === 'inactive' || String(lead.stage) === '91';
}

export function getLeadContactSearchInitials(lead: CombinedLead): string {
  const name = getLeadContactSearchResultTitle(lead);
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  );
}

function stripLeadNumberPrefix(value: string): string {
  return value.replace(/^#/, '').trim().replace(/^[LC]/i, '');
}

function parseSubleadParts(value: string): { master: string; suffix: string } | null {
  const trimmed = value.replace(/^#/, '').trim();
  if (!trimmed.includes('/')) return null;

  const slashIndex = trimmed.indexOf('/');
  const base = trimmed.slice(0, slashIndex);
  const suffix = trimmed.slice(slashIndex + 1).trim();
  const master = stripLeadNumberPrefix(base);
  if (!master || !suffix) return null;

  return { master, suffix };
}

function normalizeLeadNumber(value: string): string {
  const parts = parseSubleadParts(value);
  if (parts) {
    return `${parts.master.toLowerCase()}/${parts.suffix.toLowerCase()}`;
  }
  return stripLeadNumberPrefix(value).toLowerCase();
}

function hasMeaningfulLeadContactSearchName(lead: CombinedLead): boolean {
  const name = (lead.isContact ? lead.contactName : lead.name) || '';
  const trimmed = name.trim();
  if (!trimmed) return false;

  const leadNumber = normalizeLeadNumber(lead.lead_number || '');
  const nameNorm = normalizeLeadNumber(trimmed);
  if (leadNumber && (nameNorm === leadNumber || trimmed.toLowerCase() === leadNumber)) {
    return false;
  }

  return true;
}

function isLeadNumberOnlySearchTitle(lead: CombinedLead): boolean {
  if (lead.isContact) return false;

  const title = (lead.name || lead.lead_number || '').trim();
  if (!title) return false;

  const leadNumber = normalizeLeadNumber(lead.lead_number || '');
  const titleNorm = normalizeLeadNumber(title);
  return Boolean(leadNumber && titleNorm === leadNumber);
}

function getContactDedupeKey(result: CombinedLead): string | null {
  if (!result.isContact) return null;

  const contactId = result.contact_id?.trim();
  if (contactId) return `contact:${contactId}`;

  const name = (result.contactName || result.name || '').trim().toLowerCase();
  const email = (result.email || '').trim().toLowerCase();
  const phone = (result.mobile || result.phone || '').replace(/\D/g, '');
  if (name) return `contact-name:${name}:${email}:${phone}`;

  return null;
}

function pickPreferredContactSearchResult(group: CombinedLead[]): CombinedLead {
  return (
    group.find((result) => result.isMainContact) ||
    group.find((result) => !isLeadContactSearchInactive(result)) ||
    group[0]
  );
}

function isSearchSublead(lead: CombinedLead): boolean {
  if (lead.isContact) return false;
  if (lead.master_id != null && String(lead.master_id).trim() !== '') return true;
  if (lead.linked_master_lead != null && String(lead.linked_master_lead).trim() !== '') return true;
  return (lead.lead_number || '').includes('/');
}

function getSearchMasterFamilyKey(lead: CombinedLead): string | null {
  if (lead.isContact) return null;

  if (lead.lead_type === 'legacy') {
    if (lead.master_id != null && String(lead.master_id).trim() !== '') {
      return `legacy:${lead.master_id}`;
    }
    if ((lead.lead_number || '').includes('/')) {
      const base = lead.lead_number.split('/')[0].replace(/^[#LC]/gi, '');
      return `legacy:${base}`;
    }
    return `legacy:${lead.id}`;
  }

  if (lead.master_id != null && String(lead.master_id).trim() !== '') {
    return `new:${lead.master_id}`;
  }
  if (lead.linked_master_lead != null && String(lead.linked_master_lead).trim() !== '') {
    return `new-linked:${lead.linked_master_lead}`;
  }
  if ((lead.lead_number || '').includes('/')) {
    return `new:${lead.lead_number.split('/')[0]}`;
  }
  return `new:${lead.id}`;
}

function promoteSearchResultToMaster(lead: CombinedLead): CombinedLead {
  if (!isSearchSublead(lead)) return lead;

  if (lead.lead_type === 'legacy') {
    const masterId =
      lead.master_id != null && String(lead.master_id).trim() !== ''
        ? String(lead.master_id)
        : lead.lead_number.split('/')[0].replace(/^[#LC]/gi, '');
    const masterNumber = (lead.lead_number || '').includes('/')
      ? lead.lead_number.split('/')[0]
      : masterId;

    return {
      ...lead,
      id: masterId,
      lead_number: masterNumber,
      manual_id: masterNumber,
      master_id: null,
      linked_master_lead: null,
    };
  }

  const masterNumber = (lead.lead_number || '').includes('/')
    ? lead.lead_number.split('/')[0]
    : lead.lead_number;
  const masterId =
    lead.master_id != null && String(lead.master_id).trim() !== ''
      ? String(lead.master_id)
      : lead.linked_master_lead != null && String(lead.linked_master_lead).trim() !== ''
        ? String(lead.linked_master_lead)
        : lead.id;

  return {
    ...lead,
    id: masterId,
    lead_number: masterNumber,
    manual_id: masterNumber,
    master_id: null,
    linked_master_lead: null,
  };
}

function isExactSubleadQueryMatch(lead: CombinedLead, query: string): boolean {
  const queryParts = parseSubleadParts(query.trim());
  const leadParts = parseSubleadParts(lead.lead_number || '');
  if (!queryParts || !leadParts) return false;
  return (
    queryParts.master.toLowerCase() === leadParts.master.toLowerCase() &&
    queryParts.suffix.toLowerCase() === leadParts.suffix.toLowerCase()
  );
}

function isExactLeadNumberQueryMatch(lead: CombinedLead, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed || trimmed.includes('/')) return false;
  if ((lead.lead_number || '').includes('/')) return false;

  const queryNorm = normalizeLeadNumber(trimmed);
  const leadNorm = normalizeLeadNumber(lead.lead_number || '');
  return Boolean(queryNorm && leadNorm && queryNorm === leadNorm);
}

function isSubleadQuery(query: string): boolean {
  return Boolean(parseSubleadParts(query.trim()));
}

function pickPreferredMasterFamilyResult(group: CombinedLead[], query: string): CombinedLead {
  const exactSublead = group.find((result) => isExactSubleadQueryMatch(result, query));
  if (exactSublead) return exactSublead;

  const exactLeadNumber = group.find((result) => isExactLeadNumberQueryMatch(result, query));
  if (exactLeadNumber) return exactLeadNumber;

  // Never collapse a specific sublead search down to the master row.
  if (isSubleadQuery(query)) {
    const subleads = group.filter((result) => isSearchSublead(result));
    if (subleads.length > 0) return subleads[0];
  }

  const master = group.find((result) => !isSearchSublead(result));
  return master || promoteSearchResultToMaster(group[0]);
}

function collapseSearchResultsToMasterLeads(results: CombinedLead[], query: string): CombinedLead[] {
  const familyGroups = new Map<string, CombinedLead[]>();

  for (const result of results) {
    if (result.isContact) continue;
    const familyKey = getSearchMasterFamilyKey(result);
    if (!familyKey) continue;
    const group = familyGroups.get(familyKey);
    if (group) group.push(result);
    else familyGroups.set(familyKey, [result]);
  }

  const chosenByFamily = new Map<string, CombinedLead>();
  for (const [familyKey, group] of familyGroups) {
    chosenByFamily.set(familyKey, pickPreferredMasterFamilyResult(group, query));
  }

  const seenFamilies = new Set<string>();
  const seenContactKeys = new Set<string>();
  const collapsed: CombinedLead[] = [];

  for (const result of results) {
    if (result.isContact) {
      const contactKey = getContactDedupeKey(result);
      if (contactKey) {
        if (seenContactKeys.has(contactKey)) continue;
        seenContactKeys.add(contactKey);
      }
      collapsed.push(promoteSearchResultToMaster(result));
      continue;
    }

    const familyKey = getSearchMasterFamilyKey(result);
    if (!familyKey) {
      collapsed.push(result);
      continue;
    }
    if (seenFamilies.has(familyKey)) continue;

    seenFamilies.add(familyKey);
    collapsed.push(chosenByFamily.get(familyKey)!);
  }

  return collapsed;
}

/** Drop redundant lead rows whose title is only the lead number when a named result exists. */
export function dedupeLeadContactSearchResults(results: CombinedLead[], query = ''): CombinedLead[] {
  const byLeadKey = new Map<string, CombinedLead[]>();

  for (const result of results) {
    const key = `${result.lead_type}:${result.id}`;
    const group = byLeadKey.get(key);
    if (group) group.push(result);
    else byLeadKey.set(key, [result]);
  }

  const leadsWithNamedResult = new Set<string>();
  for (const [key, group] of byLeadKey) {
    if (group.some(hasMeaningfulLeadContactSearchName)) {
      leadsWithNamedResult.add(key);
    }
  }

  const afterLeadDedupe = results.filter((result) => {
    const key = `${result.lead_type}:${result.id}`;
    if (!leadsWithNamedResult.has(key)) return true;
    if (result.isContact) return true;
    if (hasMeaningfulLeadContactSearchName(result)) return true;
    return !isLeadNumberOnlySearchTitle(result);
  });

  const contactGroups = new Map<string, CombinedLead[]>();
  for (const result of afterLeadDedupe) {
    const contactKey = getContactDedupeKey(result);
    if (!contactKey) continue;
    const group = contactGroups.get(contactKey);
    if (group) group.push(result);
    else contactGroups.set(contactKey, [result]);
  }

  const chosenContactByKey = new Map<string, CombinedLead>();
  for (const [contactKey, group] of contactGroups) {
    chosenContactByKey.set(contactKey, pickPreferredContactSearchResult(group));
  }

  const afterContactDedupe = afterLeadDedupe.filter((result) => {
    const contactKey = getContactDedupeKey(result);
    if (!contactKey) return true;
    return chosenContactByKey.get(contactKey) === result;
  });

  // Sublead searches (e.g. 209994/3) must keep the exact sublead row and route.
  if (isSubleadQuery(query)) {
    const exactSubleads = afterContactDedupe.filter(
      (result) => !result.isContact && isExactSubleadQueryMatch(result, query),
    );
    if (exactSubleads.length > 0) {
      return exactSubleads;
    }
  }

  return collapseSearchResultsToMasterLeads(afterContactDedupe, query);
}

export function combinedLeadToRouteLead(lead: CombinedLead) {
  return {
    lead_type: lead.lead_type,
    lead_number: lead.lead_number,
    manual_id: lead.manual_id,
    id: lead.lead_type === 'legacy' ? `legacy_${String(lead.id).replace(/^legacy_/, '')}` : lead.id,
    name: lead.name,
  };
}

type ClientRouteLead = Pick<
  CombinedLead,
  'id' | 'lead_number' | 'lead_type' | 'manual_id' | 'isContact' | 'contact_id'
>;

/** Client route for a search/recent lead — aligned with Clients.tsx buildClientRoute. */
export function buildClientRouteFromCombinedLead(lead: ClientRouteLead): string {
  if (lead.isContact && lead.contact_id?.trim()) {
    return buildContactBridgeRoute(lead.contact_id);
  }

  const leadNumber = (lead.lead_number || '').trim();
  const manualId = lead.manual_id != null ? String(lead.manual_id).trim() : '';
  const isSubLead = leadNumber.includes('/');

  if (lead.lead_type === 'legacy') {
    const legacyId = String(lead.id).replace(/^legacy_/, '');
    if (isSubLead) {
      return `/clients/${encodeURIComponent(legacyId)}?lead=${encodeURIComponent(leadNumber)}`;
    }
    return `/clients/${encodeURIComponent(legacyId)}`;
  }

  const isNewLeadFormat =
    lead.lead_type === 'new' ||
    leadNumber.startsWith('L') ||
    leadNumber.startsWith('C') ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      leadNumber.split('/')[0],
    );

  if (isSubLead && isNewLeadFormat) {
    let routeLeadNumber = leadNumber;
    const baseSegment = routeLeadNumber.split('/')[0] || '';
    if (lead.lead_type === 'new' && !/^[LC]/i.test(baseSegment)) {
      routeLeadNumber = `L${routeLeadNumber}`;
    }
    return `/clients/${encodeURIComponent(routeLeadNumber)}`;
  }

  if (isSubLead && manualId !== '') {
    return `/clients/${encodeURIComponent(manualId)}?lead=${encodeURIComponent(leadNumber)}`;
  }

  if (isSubLead) {
    const base = leadNumber.split('/')[0];
    return `/clients/${encodeURIComponent(base)}?lead=${encodeURIComponent(leadNumber)}`;
  }

  if (leadNumber !== '') {
    return `/clients/${encodeURIComponent(leadNumber)}`;
  }

  if (manualId !== '') {
    return `/clients/${encodeURIComponent(manualId)}`;
  }

  return `/clients/${encodeURIComponent(String(lead.id))}`;
}

export type RecentLeadRouteInput = {
  id: string;
  lead_number: string;
  lead_type?: 'legacy' | 'new';
};

export function buildClientRouteFromRecentLead(lead: RecentLeadRouteInput): string {
  const id = (lead.id || '').trim();
  const leadNumber = (lead.lead_number || '').trim();
  let leadType = lead.lead_type;
  if (!leadType) {
    const looksLikeNewLead =
      leadNumber.startsWith('L') ||
      leadNumber.startsWith('C') ||
      id.startsWith('L') ||
      id.startsWith('C') ||
      id.includes('-');
    leadType = looksLikeNewLead ? 'new' : 'legacy';
  }

  return buildClientRouteFromCombinedLead({
    id,
    lead_number: leadNumber,
    lead_type: leadType,
    manual_id: leadNumber.includes('/') ? leadNumber.split('/')[0] : leadNumber || id,
  });
}

export function navigateLeadContactSearchResult(
  lead: CombinedLead,
  navigate: (to: string) => void,
): void {
  navigate(buildClientRouteFromCombinedLead(lead));
}

export function meetingMatchesCombinedLead(meeting: any, lead: CombinedLead): boolean {
  if (meeting?.calendar_type === 'staff') return false;

  const meetingLead = meeting?.lead;
  if (!meetingLead) return false;

  const targetNumber = (lead.lead_number || '').trim().toLowerCase();
  const meetingNumber = (meetingLead.lead_number || '').trim().toLowerCase();

  if (targetNumber && meetingNumber) {
    if (meetingNumber === targetNumber) return true;
    if (meetingNumber.includes(targetNumber) || targetNumber.includes(meetingNumber)) return true;
  }

  if (lead.lead_type === 'new') {
    return String(meetingLead.id) === String(lead.id);
  }

  const legacyId = String(lead.id).replace(/^legacy_/, '');
  const meetingLegacyId = String(meetingLead.id ?? meeting?.legacy_lead_id ?? '').replace(/^legacy_/, '');
  return meetingLegacyId === legacyId;
}
