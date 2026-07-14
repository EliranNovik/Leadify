import { supabase } from './supabase';
import { getSourceDisplayFromJoin } from './leadSourceId';

export type DuplicateContactMatch = {
  contactId: number;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  contactMobile: string | null;
  contactCountry: string | null;
  leadId: string | number;
  leadNumber: string;
  leadName: string;
  leadType: 'new' | 'legacy';
  matchingFields: string[];
  stage: string | number | null;
  stageColour?: string | null;
  category: string | null;
  topic: string | null;
  source: string | null;
  status: string | number | null;
  /** True when this row is the lead the page was opened from. */
  isCurrentLead?: boolean;
};

function getCategoryDisplayFromJoin(lead: any): string | null {
  const cat = lead?.misc_category;
  if (!cat) return null;
  const record = Array.isArray(cat) ? cat[0] : cat;
  if (!record?.name) return null;
  const main = Array.isArray(record.misc_maincategory)
    ? record.misc_maincategory[0]
    : record.misc_maincategory;
  return main?.name ? `${record.name} (${main.name})` : record.name || null;
}

function getStageMetaFromJoin(lead: any): { name: string | null; colour: string | null } {
  const stageJoin = Array.isArray(lead?.lead_stages) ? lead.lead_stages[0] : lead?.lead_stages;
  if (stageJoin?.name) {
    return {
      name: String(stageJoin.name),
      colour: stageJoin.colour ? String(stageJoin.colour) : null,
    };
  }
  if (lead?.stage != null && lead.stage !== '') {
    return { name: String(lead.stage), colour: null };
  }
  return { name: null, colour: null };
}

function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
}

function isLegacyLeadClient(client: { id?: string | number; lead_type?: string }): boolean {
  return (
    client.lead_type === 'legacy' ||
    String(client.id ?? '').startsWith('legacy_')
  );
}

/** Persist duplicate list for the clients page badge / warm cache. */
export function persistDuplicateContactsCache(
  storageKey: string,
  duplicates: DuplicateContactMatch[]
): void {
  try {
    sessionStorage.setItem(
      `clientsPage_duplicateContacts_${storageKey}`,
      JSON.stringify(duplicates)
    );
  } catch {
    // ignore quota / private mode
  }
}

export function readDuplicateContactsCache(
  storageKey: string
): DuplicateContactMatch[] | null {
  try {
    const raw = sessionStorage.getItem(`clientsPage_duplicateContacts_${storageKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DuplicateContactMatch[]) : null;
  } catch {
    return null;
  }
}

export function getDuplicateContactsStorageKey(client: {
  id?: string | number;
  lead_number?: string | null;
  manual_id?: string | null;
  lead_type?: string;
}): string | undefined {
  if (isLegacyLeadClient(client)) {
    return String(client.id ?? '').replace(/^legacy_/, '') || String(client.id ?? '');
  }
  return (
    client.lead_number ||
    client.manual_id ||
    (client.id != null ? String(client.id) : undefined) ||
    undefined
  );
}

/**
 * Resolve a client by URL lead_number (new lead_number or legacy id / lead_number / manual_id).
 */
export async function resolveClientForDuplicates(
  leadNumberParam: string
): Promise<{
  id: string | number;
  lead_number?: string | null;
  name?: string | null;
  lead_type: 'new' | 'legacy';
  manual_id?: string | null;
} | null> {
  const raw = String(leadNumberParam || '').trim();
  if (!raw) return null;

  const { data: newLead } = await supabase
    .from('leads')
    .select('id, lead_number, name, manual_id')
    .eq('lead_number', raw)
    .maybeSingle();

  if (newLead?.id) {
    return {
      id: newLead.id,
      lead_number: newLead.lead_number,
      name: newLead.name,
      lead_type: 'new',
      manual_id: newLead.manual_id,
    };
  }

  const numericId = /^\d+$/.test(raw) ? Number(raw) : null;
  let legacyQuery = supabase
    .from('leads_lead')
    .select('id, lead_number, name, manual_id')
    .limit(1);

  if (numericId != null && !Number.isNaN(numericId)) {
    legacyQuery = legacyQuery.or(
      `id.eq.${numericId},lead_number.eq.${raw},manual_id.eq.${raw}`
    );
  } else {
    legacyQuery = legacyQuery.or(`lead_number.eq.${raw},manual_id.eq.${raw}`);
  }

  const { data: legacyRows } = await legacyQuery;
  const legacyLead = Array.isArray(legacyRows) ? legacyRows[0] : legacyRows;
  if (legacyLead?.id != null) {
    return {
      id: `legacy_${legacyLead.id}`,
      lead_number: legacyLead.lead_number,
      name: legacyLead.name,
      lead_type: 'legacy',
      manual_id: legacyLead.manual_id,
    };
  }

  return null;
}

/**
 * Find contacts linked to other leads that share email/phone/mobile/name with the current lead's contacts.
 * Logic matches the previous Clients.tsx implementation (lead_leadcontact joins).
 */
export async function findDuplicateContacts(currentClient: {
  id: string | number;
  lead_number?: string | null;
  name?: string | null;
  lead_type?: string;
}): Promise<DuplicateContactMatch[]> {
  if (!currentClient?.id) return [];

  try {
    const isLegacyLead = isLegacyLeadClient(currentClient);
    const currentLeadId = isLegacyLead
      ? String(currentClient.id).replace(/^legacy_/, '')
      : currentClient.id;

    const leadContactsResult = await supabase
      .from('lead_leadcontact')
      .select('contact_id, main, newlead_id, lead_id')
      .or(
        isLegacyLead
          ? `lead_id.eq.${currentLeadId}`
          : `newlead_id.eq.${currentLeadId}`
      );

    const leadContacts = leadContactsResult.data;
    if (!leadContacts || leadContacts.length === 0) {
      return [];
    }

    const contactIds = leadContacts.map((lc) => lc.contact_id).filter(Boolean);
    if (contactIds.length === 0) {
      return [];
    }

    const currentContactsResult = await supabase
      .from('leads_contact')
      .select('id, name, email, phone, mobile')
      .in('id', contactIds);

    const currentContacts = currentContactsResult.data || [];
    if (currentContacts.length === 0) {
      return [];
    }

    const allFilters: string[] = [];
    const contactFilterMap = new Map<number, string[]>();

    for (const currentContact of currentContacts) {
      const filters: string[] = [];

      if (currentContact.email) {
        filters.push(`email.eq.${currentContact.email}`);
      }
      if (currentContact.name) {
        filters.push(`name.ilike.%${currentContact.name}%`);
      }
      if (currentContact.phone) {
        const normalizedPhone = normalizePhone(currentContact.phone);
        if (normalizedPhone) {
          filters.push(`phone.eq.${currentContact.phone}`);
          filters.push(`mobile.eq.${currentContact.phone}`);
        }
      }
      if (currentContact.mobile) {
        const normalizedMobile = normalizePhone(currentContact.mobile);
        if (normalizedMobile) {
          filters.push(`phone.eq.${currentContact.mobile}`);
          filters.push(`mobile.eq.${currentContact.mobile}`);
        }
      }

      if (filters.length > 0) {
        allFilters.push(...filters);
        contactFilterMap.set(currentContact.id, filters);
      }
    }

    if (allFilters.length === 0) {
      return [];
    }

    const { data: allDuplicateContacts } = await supabase
      .from('leads_contact')
      .select('id, name, email, phone, mobile, country_id, misc_country!country_id(id, name)')
      .or(allFilters.join(','));

    const duplicateContacts = (allDuplicateContacts || []).filter(
      (dc) => !contactIds.includes(dc.id)
    );

    if (duplicateContacts.length === 0) {
      return [];
    }

    const duplicateContactIds = duplicateContacts.map((dc) => dc.id);
    const { data: relationships } = await supabase
      .from('lead_leadcontact')
      .select('contact_id, newlead_id, lead_id')
      .in('contact_id', duplicateContactIds);

    if (!relationships || relationships.length === 0) {
      return [];
    }

    const newLeadIds = [
      ...new Set(relationships.map((r) => r.newlead_id).filter(Boolean)),
    ] as string[];
    const legacyLeadIds = [
      ...new Set(relationships.map((r) => r.lead_id).filter(Boolean)),
    ] as number[];

    const [newLeadsResult, legacyLeadsResult] = await Promise.all([
      newLeadIds.length > 0
        ? supabase
            .from('leads')
            .select(
              `
              id,
              lead_number,
              name,
              stage,
              category,
              category_id,
              master_id,
              status,
              topic,
              source_id,
              misc_category!fk_leads_category_id ( id, name, parent_id, misc_maincategory!parent_id ( id, name ) ),
              misc_leadsource!fk_leads_source_id ( id, name ),
              lead_stages!leads_stage_fkey(name, colour)
            `
            )
            .in('id', newLeadIds)
            .is('master_id', null)
        : Promise.resolve({ data: [] as any[] }),
      legacyLeadIds.length > 0
        ? supabase
            .from('leads_lead')
            .select(
              `
              id,
              name,
              stage,
              category_id,
              category,
              master_id,
              status,
              topic,
              source_id,
              misc_category!leads_lead_category_id_fkey ( id, name, parent_id, misc_maincategory!parent_id ( id, name ) ),
              misc_leadsource!leads_lead_source_id_fkey ( id, name ),
              lead_stages!fk_leads_lead_stage(name, colour)
            `
            )
            .in('id', legacyLeadIds)
            .is('master_id', null)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const newLeads = newLeadsResult.data || [];
    const legacyLeads = legacyLeadsResult.data || [];

    const duplicateMatches: DuplicateContactMatch[] = [];
    const processedLeads = new Set<string>();

    for (const duplicateContact of duplicateContacts) {
      const contactRelationships = relationships.filter(
        (r) => r.contact_id === duplicateContact.id
      );

      for (const rel of contactRelationships) {
        if (rel.newlead_id) {
          const lead = newLeads.find((l: any) => l.id === rel.newlead_id);
          if (lead && lead.id !== currentLeadId && !processedLeads.has(`new_${lead.id}`)) {
            const matchingCurrentContact = currentContacts.find((cc) => {
              const contactFilters = contactFilterMap.get(cc.id) || [];
              return contactFilters.some((filter) => {
                if (filter.includes('email.eq.') && duplicateContact.email) {
                  return filter.includes(duplicateContact.email);
                }
                if (filter.includes('phone.eq.') || filter.includes('mobile.eq.')) {
                  const normalized = normalizePhone(
                    duplicateContact.phone || duplicateContact.mobile
                  );
                  return (
                    Boolean(normalized) &&
                    (normalizePhone(cc.phone) === normalized ||
                      normalizePhone(cc.mobile) === normalized)
                  );
                }
                return false;
              });
            });

            if (matchingCurrentContact) {
              const matchingFields: string[] = [];
              if (
                matchingCurrentContact.email &&
                duplicateContact.email &&
                matchingCurrentContact.email.toLowerCase() ===
                  duplicateContact.email.toLowerCase()
              ) {
                matchingFields.push('email');
              }
              const normCurrentPhone = normalizePhone(matchingCurrentContact.phone);
              const normCurrentMobile = normalizePhone(matchingCurrentContact.mobile);
              const normDupPhone = normalizePhone(duplicateContact.phone);
              const normDupMobile = normalizePhone(duplicateContact.mobile);

              if (normCurrentPhone && normDupPhone && normCurrentPhone === normDupPhone) {
                matchingFields.push('phone');
              }
              if (normCurrentMobile && normDupMobile && normCurrentMobile === normDupMobile) {
                matchingFields.push('mobile');
              }
              if (normCurrentPhone && normDupMobile && normCurrentPhone === normDupMobile) {
                matchingFields.push('phone/mobile');
              }
              if (normCurrentMobile && normDupPhone && normCurrentMobile === normDupPhone) {
                matchingFields.push('mobile/phone');
              }

              if (matchingFields.length > 0) {
                processedLeads.add(`new_${lead.id}`);
                const stageMeta = getStageMetaFromJoin(lead);
                duplicateMatches.push({
                  contactId: duplicateContact.id,
                  contactName: duplicateContact.name || 'Unknown',
                  contactEmail: duplicateContact.email,
                  contactPhone: duplicateContact.phone,
                  contactMobile: duplicateContact.mobile,
                  contactCountry: (() => {
                    const country = Array.isArray(duplicateContact.misc_country)
                      ? duplicateContact.misc_country[0]
                      : duplicateContact.misc_country;
                    return (country as { name?: string } | null | undefined)?.name || null;
                  })(),
                  leadId: lead.id,
                  leadNumber: lead.lead_number || String(lead.id),
                  leadName: lead.name || 'Unknown',
                  leadType: 'new',
                  matchingFields,
                  stage: stageMeta.name,
                  stageColour: stageMeta.colour,
                  category: getCategoryDisplayFromJoin(lead) ?? lead.category ?? null,
                  topic: lead.topic || null,
                  source: getSourceDisplayFromJoin(lead) ?? null,
                  status: lead.status || null,
                });
              }
            }
          }
        }
      }
    }

    for (const duplicateContact of duplicateContacts) {
      const contactRelationships = relationships.filter(
        (r) => r.contact_id === duplicateContact.id
      );

      for (const rel of contactRelationships) {
        if (rel.lead_id) {
          const lead = legacyLeads.find((l: any) => l.id === rel.lead_id);
          if (
            lead &&
            String(lead.id) !== String(currentLeadId) &&
            !processedLeads.has(`legacy_${lead.id}`)
          ) {
            const matchingCurrentContact = currentContacts.find((cc) => {
              const contactFilters = contactFilterMap.get(cc.id) || [];
              return contactFilters.some((filter) => {
                if (filter.includes('email.eq.') && duplicateContact.email) {
                  return filter.includes(duplicateContact.email);
                }
                if (filter.includes('phone.eq.') || filter.includes('mobile.eq.')) {
                  const normalized = normalizePhone(
                    duplicateContact.phone || duplicateContact.mobile
                  );
                  return (
                    Boolean(normalized) &&
                    (normalizePhone(cc.phone) === normalized ||
                      normalizePhone(cc.mobile) === normalized)
                  );
                }
                return false;
              });
            });

            if (matchingCurrentContact) {
              const matchingFields: string[] = [];
              if (
                matchingCurrentContact.email &&
                duplicateContact.email &&
                matchingCurrentContact.email.toLowerCase() ===
                  duplicateContact.email.toLowerCase()
              ) {
                matchingFields.push('email');
              }
              const normCurrentPhone = normalizePhone(matchingCurrentContact.phone);
              const normCurrentMobile = normalizePhone(matchingCurrentContact.mobile);
              const normDupPhone = normalizePhone(duplicateContact.phone);
              const normDupMobile = normalizePhone(duplicateContact.mobile);

              if (normCurrentPhone && normDupPhone && normCurrentPhone === normDupPhone) {
                matchingFields.push('phone');
              }
              if (normCurrentMobile && normDupMobile && normCurrentMobile === normDupMobile) {
                matchingFields.push('mobile');
              }
              if (normCurrentPhone && normDupMobile && normCurrentPhone === normDupMobile) {
                matchingFields.push('phone/mobile');
              }
              if (normCurrentMobile && normDupPhone && normCurrentMobile === normDupPhone) {
                matchingFields.push('mobile/phone');
              }

              if (matchingFields.length > 0) {
                processedLeads.add(`legacy_${lead.id}`);
                const stageMeta = getStageMetaFromJoin(lead);
                duplicateMatches.push({
                  contactId: duplicateContact.id,
                  contactName: duplicateContact.name || 'Unknown',
                  contactEmail: duplicateContact.email,
                  contactPhone: duplicateContact.phone,
                  contactMobile: duplicateContact.mobile,
                  contactCountry: (() => {
                    const country = Array.isArray(duplicateContact.misc_country)
                      ? duplicateContact.misc_country[0]
                      : duplicateContact.misc_country;
                    return (country as { name?: string } | null | undefined)?.name || null;
                  })(),
                  leadId: `legacy_${lead.id}`,
                  leadNumber: String(lead.id),
                  leadName: lead.name || 'Unknown',
                  leadType: 'legacy',
                  matchingFields,
                  stage: stageMeta.name,
                  stageColour: stageMeta.colour,
                  category: getCategoryDisplayFromJoin(lead) ?? lead.category ?? null,
                  topic: lead.topic || null,
                  source: getSourceDisplayFromJoin(lead) ?? null,
                  status: lead.status || null,
                });
              }
            }
          }
        }
      }
    }

    return Array.from(
      new Map(duplicateMatches.map((m) => [m.leadNumber, m])).values()
    );
  } catch (error) {
    console.error('Error finding duplicate contacts:', error);
    return [];
  }
}

/**
 * Load the opened-from lead as a row so the duplicates page can show the full group.
 */
export async function fetchCurrentLeadMatch(currentClient: {
  id: string | number;
  lead_number?: string | null;
  name?: string | null;
  lead_type?: string;
  manual_id?: string | null;
}): Promise<DuplicateContactMatch | null> {
  if (!currentClient?.id) return null;

  try {
    const isLegacyLead = isLegacyLeadClient(currentClient);
    const currentLeadId = isLegacyLead
      ? String(currentClient.id).replace(/^legacy_/, '')
      : currentClient.id;

    const leadContactsResult = await supabase
      .from('lead_leadcontact')
      .select('contact_id, main, newlead_id, lead_id')
      .or(
        isLegacyLead
          ? `lead_id.eq.${currentLeadId}`
          : `newlead_id.eq.${currentLeadId}`
      );

    const leadContacts = leadContactsResult.data || [];
    const mainLink =
      leadContacts.find((lc) => String(lc.main) === 'true' || lc.main === true) ||
      leadContacts[0];
    const contactIds = leadContacts.map((lc) => lc.contact_id).filter(Boolean);

    let contact: {
      id: number;
      name: string | null;
      email: string | null;
      phone: string | null;
      mobile: string | null;
      misc_country?: { name?: string } | { name?: string }[] | null;
    } | null = null;

    if (mainLink?.contact_id) {
      const { data } = await supabase
        .from('leads_contact')
        .select('id, name, email, phone, mobile, country_id, misc_country!country_id(id, name)')
        .eq('id', mainLink.contact_id)
        .maybeSingle();
      contact = data;
    } else if (contactIds.length > 0) {
      const { data } = await supabase
        .from('leads_contact')
        .select('id, name, email, phone, mobile, country_id, misc_country!country_id(id, name)')
        .in('id', contactIds)
        .limit(1)
        .maybeSingle();
      contact = data;
    }

    const countryRel = contact?.misc_country;
    const countryRecord = Array.isArray(countryRel) ? countryRel[0] : countryRel;

    let leadRow: any = null;
    if (isLegacyLead) {
      const { data } = await supabase
        .from('leads_lead')
        .select(
          `
          id, name, stage, category, category_id, status, topic, source_id,
          misc_category!leads_lead_category_id_fkey ( id, name, parent_id, misc_maincategory!parent_id ( id, name ) ),
          misc_leadsource!leads_lead_source_id_fkey ( id, name ),
          lead_stages!fk_leads_lead_stage(name, colour)
        `
        )
        .eq('id', currentLeadId)
        .maybeSingle();
      leadRow = data;
    } else {
      const { data } = await supabase
        .from('leads')
        .select(
          `
          id, lead_number, name, stage, category, category_id, status, topic, source_id,
          misc_category!fk_leads_category_id ( id, name, parent_id, misc_maincategory!parent_id ( id, name ) ),
          misc_leadsource!fk_leads_source_id ( id, name ),
          lead_stages!leads_stage_fkey(name, colour)
        `
        )
        .eq('id', currentLeadId)
        .maybeSingle();
      leadRow = data;
    }

    if (!leadRow) return null;

    const stageMeta = getStageMetaFromJoin(leadRow);
    const leadNumber = isLegacyLead
      ? String(leadRow.id)
      : leadRow.lead_number ||
        currentClient.lead_number ||
        currentClient.manual_id ||
        String(leadRow.id);

    return {
      contactId: contact?.id ?? 0,
      contactName: contact?.name || currentClient.name || 'Unknown',
      contactEmail: contact?.email || null,
      contactPhone: contact?.phone || null,
      contactMobile: contact?.mobile || null,
      contactCountry: countryRecord?.name || null,
      leadId: isLegacyLead ? `legacy_${leadRow.id}` : leadRow.id,
      leadNumber: String(leadNumber),
      leadName: leadRow.name || currentClient.name || 'Unknown',
      leadType: isLegacyLead ? 'legacy' : 'new',
      matchingFields: [],
      stage: stageMeta.name,
      stageColour: stageMeta.colour,
      category: getCategoryDisplayFromJoin(leadRow) ?? leadRow.category ?? null,
      topic: leadRow.topic || null,
      source: getSourceDisplayFromJoin(leadRow) ?? null,
      status: leadRow.status || null,
      isCurrentLead: true,
    };
  } catch (error) {
    console.error('Error fetching current lead for duplicates:', error);
    return null;
  }
}

/**
 * Load duplicates for a URL lead_number; uses session cache when present.
 * When includeCurrentLead is true, prepends the opened-from lead to the list (not cached).
 */
export async function loadDuplicateContactsForLeadNumber(
  leadNumberParam: string,
  options?: { preferCache?: boolean; includeCurrentLead?: boolean }
): Promise<{
  client: Awaited<ReturnType<typeof resolveClientForDuplicates>>;
  duplicates: DuplicateContactMatch[];
  fromCache: boolean;
}> {
  const client = await resolveClientForDuplicates(leadNumberParam);
  if (!client) {
    return { client: null, duplicates: [], fromCache: false };
  }

  const storageKey = getDuplicateContactsStorageKey(client);
  let duplicates: DuplicateContactMatch[] = [];
  let fromCache = false;

  if (options?.preferCache !== false && storageKey) {
    const cached = readDuplicateContactsCache(storageKey);
    if (cached) {
      duplicates = cached.filter((d) => !d.isCurrentLead);
      fromCache = true;
    }
  }

  if (!fromCache) {
    duplicates = await findDuplicateContacts(client);
    if (storageKey) {
      persistDuplicateContactsCache(storageKey, duplicates);
    }
  }

  if (options?.includeCurrentLead) {
    const current = await fetchCurrentLeadMatch(client);
    if (current) {
      const currentKey = String(current.leadNumber);
      duplicates = [
        current,
        ...duplicates.filter((d) => String(d.leadNumber) !== currentKey),
      ];
    }
  }

  return { client, duplicates, fromCache };
}
