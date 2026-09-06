import { supabase } from './supabase';
import { getStageName } from './stageUtils';

export interface SubLead {
  id: string;
  lead_number: string;
  /** Lead number used for case documents (no display-only /1 or C prefix). */
  document_lead_number?: string;
  actual_lead_id: string;
  manual_id?: string;
  name: string;
  total?: number;
  currency?: string;
  currency_symbol?: string;
  category?: string;
  topic?: string;
  stage?: string;
  contact?: string;
  applicants?: number;
  agreement?: string; // Contract ID (string) for serialization
  agreementIsLegacy?: boolean; // Flag to indicate if contract is legacy
  docs_url?: string;
  scheduler?: string;
  scheduler_id?: number; // Employee ID for scheduler
  closer?: string;
  closer_id?: number; // Employee ID for closer
  handler?: string;
  handler_id?: number; // Employee ID for handler
  master_id?: string;
  isMaster?: boolean;
  route?: string;
  /** True when lead is in chain only via linked_master_lead (display actual lead number, not master/suffix) */
  isLinkedOnly?: boolean;
}

export interface ContractData {
  id: string;
  isLegacy: boolean;
  contractHtml?: string;
  signedContractHtml?: string;
  public_token?: string;
  signed_at?: string;
}

/**
 * Normalize base lead number to the numeric base only (e.g. "6/1" or "L6/1" -> "6")
 */
function normalizeBaseLeadNumber(baseLeadNumber: string): string {
  const trimmed = (baseLeadNumber || '').trim().replace(/^[LC]/i, '');
  const firstSegment = trimmed.includes('/') ? trimmed.split('/')[0] : trimmed;
  return firstSegment || baseLeadNumber;
}

/** Values Clients.tsx uses when resolving linked_master_lead / master_id. */
function linkedMasterLookupValues(...rawValues: Array<string | number | null | undefined>): string[] {
  const values = new Set<string>();
  rawValues.forEach((raw) => {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) return;
    const noPrefix = trimmed.replace(/^[LC]/i, '').split('/')[0];
    [trimmed, noPrefix, `${noPrefix}/1`, `L${noPrefix}`, `C${noPrefix}`, `L${noPrefix}/1`, `C${noPrefix}/1`]
      .filter(Boolean)
      .forEach((value) => values.add(value));
  });
  return [...values];
}

/**
 * True when linked_master_lead points at another lead (not the row's own self-root marker).
 * New masters may store linked_master_lead = their own lead_number after the first combine.
 */
export function isNonSelfLinkedMasterLead(
  linkedMasterLead: string | number | null | undefined,
  ownLeadNumber?: string | null,
  ownId?: string | number | null
): boolean {
  if (linkedMasterLead == null) return false;
  const linked = String(linkedMasterLead).trim();
  if (!linked) return false;

  const normalize = (v: string) =>
    v.trim().replace(/^[LC]/i, '').split('/')[0];

  const linkedNorm = normalize(linked);

  if (ownLeadNumber != null && String(ownLeadNumber).trim() !== '') {
    const own = String(ownLeadNumber).trim();
    if (linked === own || linkedNorm === normalize(own)) return false;
  }

  if (ownId != null) {
    const idStr = String(ownId).replace(/^legacy_/, '').trim();
    if (idStr && (linked === idStr || linkedNorm === idStr)) return false;
  }

  return true;
}

// Helper function to get category name with main category
export const getCategoryName = (categoryId: string | number | null | undefined, categories: any[]): string => {
  if (!categoryId || !categories || categories.length === 0) {
    return 'Unknown';
  }

  const category = categories.find((cat: any) => cat.id.toString() === categoryId.toString());
  if (category) {
    if (category.misc_maincategory?.name) {
      return `${category.name} (${category.misc_maincategory.name})`;
    } else {
      return category.name;
    }
  }

  return 'Unknown';
};

function isSelfOrEmptyMasterId(masterId: unknown, leadId: unknown): boolean {
  const mid = masterId == null ? '' : String(masterId).trim();
  if (!mid) return true;
  const lid = String(leadId ?? '').replace(/^legacy_/, '').trim();
  return Boolean(lid) && mid === lid;
}

// Helper function to format lead number for legacy leads
export const formatLegacyLeadNumber = (legacyLead: any, subLeadSuffix?: number, hasSubLeads: boolean = false): string => {
  const leadId = String(legacyLead?.id ?? '').replace(/^legacy_/, '');
  const masterId = legacyLead?.master_id == null ? '' : String(legacyLead.master_id).trim();

  if (isSelfOrEmptyMasterId(masterId, leadId)) {
    return hasSubLeads ? `${leadId}/1` : leadId;
  }

  if (subLeadSuffix != null && Number.isFinite(Number(subLeadSuffix))) {
    return `${masterId}/${subLeadSuffix}`;
  }

  return `${masterId}/2`;
};

// Helper function to get currency symbol
function resolveNewLeadRole(
  lead: any,
  idFields: string[],
  textFields: string[],
  employeeMap: Map<any, string>,
  employeeNameToIdMap: Map<string, number>,
): { name: string; id?: number } {
  const lookupName = (id: number) =>
    employeeMap.get(id) || employeeMap.get(String(id)) || employeeMap.get(Number(id));

  for (const field of idFields) {
    const raw = lead?.[field];
    if (raw == null || raw === '') continue;
    const idNum = typeof raw === 'string' ? parseInt(String(raw), 10) : Number(raw);
    if (Number.isNaN(idNum)) continue;
    const name = lookupName(idNum);
    if (name) return { name, id: idNum };
    return { name: '---', id: idNum };
  }

  for (const field of textFields) {
    const text = lead?.[field];
    if (text == null) continue;
    const trimmed = String(text).trim();
    if (!trimmed || trimmed === '---' || trimmed === '--' || /^not[_\s]?assigned$/i.test(trimmed)) {
      continue;
    }
    if (/^\d+$/.test(trimmed)) {
      const idNum = parseInt(trimmed, 10);
      const name = lookupName(idNum);
      if (name) return { name, id: idNum };
    }
    const foundId = employeeNameToIdMap.get(trimmed.toLowerCase());
    if (foundId != null) return { name: lookupName(foundId) || trimmed, id: foundId };
    return { name: trimmed };
  }

  return { name: '---' };
}

export const getCurrencySymbol = (currencyCode?: string): string => {
  if (!currencyCode) return '₪';
  const symbols: { [key: string]: string } = {
    'ILS': '₪',
    'NIS': '₪',
    'USD': '$',
    'EUR': '€',
    'GBP': '£',
    'CAD': 'C$',
    'AUD': 'A$'
  };
  return symbols[currencyCode.toUpperCase()] || currencyCode;
};

// Helper function to get currency info from lead data
export const getCurrencyInfo = (lead: any) => {
  if (lead.accounting_currencies?.name) {
    return {
      currency: lead.accounting_currencies.name,
      symbol: getCurrencySymbol(lead.accounting_currencies.iso_code || lead.accounting_currencies.name)
    };
  } else {
    switch (lead.currency_id) {
      case 1: return { currency: 'NIS', symbol: '₪' };
      case 2: return { currency: 'USD', symbol: '$' };
      case 3: return { currency: 'EUR', symbol: '€' };
      default: return { currency: 'NIS', symbol: '₪' };
    }
  }
};

// Helper function to format contact information
export const getContactInfo = (lead: any, contactMap: Map<string, any>): string => {
  const contactInfo = contactMap.get(String(lead.id));

  if (contactInfo?.name && contactInfo.name.trim()) {
    return contactInfo.name.trim();
  } else if (lead.name && lead.name.trim()) {
    return lead.name.trim();
  }

  return '---';
};

// Helper function to calculate total for legacy leads (same logic as Clients.tsx)
export const getLegacyLeadTotal = (lead: any): number => {
  // For legacy leads: if currency_id is 1 (NIS/ILS), use total_base; otherwise use total
  const currencyId = lead.currency_id;
  let numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
  if (!numericCurrencyId || isNaN(numericCurrencyId)) {
    numericCurrencyId = 1; // Default to NIS
  }

  if (numericCurrencyId === 1) {
    // For currency_id 1, use total_base (only, no fallback)
    return Number(lead.total_base ?? 0);
  } else {
    // For other currencies, use total column (only, no fallback)
    return Number(lead.total ?? 0);
  }
};

// Helper function to build client route
export const buildClientRoute = (manualId?: string | null, leadNumberValue?: string | null): string => {
  const manualString = manualId?.toString().trim() || '';
  const leadString = leadNumberValue?.toString().trim() || '';
  const isSubLeadNumber = leadString.includes('/');

  if (isSubLeadNumber && manualString !== '') {
    const query = leadString !== '' ? `?lead=${encodeURIComponent(leadString)}` : '';
    return `/clients/${encodeURIComponent(manualString)}` + query;
  }

  if (leadString !== '') {
    return `/clients/${encodeURIComponent(leadString)}`;
  }

  if (manualString !== '') {
    return `/clients/${encodeURIComponent(manualString)}`;
  }

  return '/clients';
};

// Extract numeric ID from value
export const extractNumericId = (value: string | null | undefined): string | null => {
  if (!value) return null;
  if (/^\d+$/.test(value)) return value;
  const digitsOnly = value.replace(/\D/g, '');
  return digitsOnly.length > 0 ? digitsOnly : null;
};

// Fetch new master lead and sub-leads
export const fetchNewMasterLead = async (
  baseLeadNumber: string,
  setContractsDataMap: (updater: (prev: Map<string, ContractData>) => Map<string, ContractData>) => void
): Promise<{ success: boolean; masterLead?: any; subLeads?: SubLead[]; error?: string }> => {
  try {
    // Find master lead in one round-trip (exact, L/C prefix, /1 variants, manual_id)
    const normalizedBaseForLinked = normalizeBaseLeadNumber(baseLeadNumber);
    const numericBase = String(normalizedBaseForLinked || '').replace(/^[LC]/i, '');
    const masterOr: string[] = [
      `lead_number.eq.${baseLeadNumber}`,
      `lead_number.eq.${normalizedBaseForLinked}`,
      `lead_number.eq.${baseLeadNumber}/1`,
      `lead_number.eq.${normalizedBaseForLinked}/1`,
    ];
    if (!String(baseLeadNumber).startsWith('L') && !String(baseLeadNumber).startsWith('C')) {
      masterOr.push(`lead_number.eq.L${numericBase}`, `lead_number.eq.C${numericBase}`, `lead_number.eq.L${numericBase}/1`);
    }
    if (/^\d+$/.test(numericBase)) {
      masterOr.push(`manual_id.eq.${numericBase}`);
    }

    const { data: masterRows, error: masterError } = await supabase
      .from('leads')
      .select('*')
      .or([...new Set(masterOr)].join(','))
      .limit(5);

    if (masterError) {
      console.error('Error fetching new master lead:', masterError);
    }

    // Prefer exact / base match, then /1 master row
    const masterCandidates = masterRows || [];
    let masterLead =
      masterCandidates.find((l: any) => String(l.lead_number) === String(baseLeadNumber)) ||
      masterCandidates.find((l: any) => String(l.lead_number) === String(normalizedBaseForLinked)) ||
      masterCandidates.find((l: any) => String(l.lead_number) === `${baseLeadNumber}/1` || String(l.lead_number) === `${normalizedBaseForLinked}/1` || String(l.lead_number) === `L${numericBase}/1`) ||
      masterCandidates.find((l: any) => !l.master_id || String(l.master_id).trim() === '') ||
      masterCandidates[0] ||
      null;

    if (!masterLead) {
      return { success: false };
    }

    // Fetch all sub-leads (all leads with baseLeadNumber/ suffix)
    // This will include /1, /2, /3, /4, /5, /6, etc.
    const patternBases = [...new Set([baseLeadNumber, normalizedBaseForLinked, `L${numericBase}`, numericBase].filter(Boolean))];
    const likeFilters = patternBases.map((b) => `lead_number.like.${b}/%`).join(',');
    const { data: subLeadsData, error: subLeadsError } = await supabase
      .from('leads')
      .select('*')
      .or(likeFilters)
      .order('lead_number', { ascending: true });

    if (subLeadsError) {
      console.error('Error fetching new sub-leads:', subLeadsError);
      return { success: true, masterLead, subLeads: [], error: 'Failed to fetch sub-leads' };
    }

    // Filter out the master lead itself from sub-leads if it appears (shouldn't happen, but just in case)
    const filteredSubLeadsFromPattern = subLeadsData?.filter(lead => {
      const leadNum = String(lead.lead_number || '');
      // Exclude the exact baseLeadNumber match (master lead)
      return leadNum !== baseLeadNumber && leadNum !== String(masterLead.lead_number || '');
    }) || [];

    // Sub-leads linked by master_id (UUID) — same path Clients.tsx uses
    const masterIdOrConditions: string[] = [];
    if (masterLead?.id) {
      masterIdOrConditions.push(`master_id.eq.${masterLead.id}`);
    }
    if (/^\d+$/.test(numericBase)) {
      masterIdOrConditions.push(`master_id.eq.${numericBase}`);
    }
    const leadNumberBase = String(masterLead.lead_number || '')
      .replace(/^[LC]/i, '')
      .split('/')[0];
    if (/^\d+$/.test(leadNumberBase) && leadNumberBase !== numericBase) {
      masterIdOrConditions.push(`master_id.eq.${leadNumberBase}`);
    }

    const byMasterIdPromise =
      masterIdOrConditions.length > 0
        ? supabase
            .from('leads')
            .select('*')
            .or(masterIdOrConditions.join(','))
            .not('master_id', 'is', null)
        : Promise.resolve({ data: null as any[] | null, error: null });

    // Also include new leads and legacy leads that point to this master via linked_master_lead (text: "L210292" or "210292").
    const linkedMasterValues = linkedMasterLookupValues(
      normalizedBaseForLinked,
      baseLeadNumber,
      masterLead?.lead_number,
      masterLead?.manual_id,
    );
    const [
      { data: linkedSubLeadsData },
      { data: linkedLegacyToNewData },
      { data: byMasterIdData }
    ] = await Promise.all([
      supabase.from('leads').select('*').in('linked_master_lead', linkedMasterValues),
      supabase.from('leads_lead').select('*, accounting_currencies!leads_lead_currency_id_fkey (name, iso_code)').in('linked_master_lead', linkedMasterValues),
      byMasterIdPromise
    ]);

    const mergeNewSubLead = (acc: any[], lead: any) => {
      if (!lead || !lead.id) return acc;
      if (masterLead?.id && String(lead.id) === String(masterLead.id)) return acc;
      if (acc.some((existing: any) => String(existing.id) === String(lead.id))) return acc;
      acc.push(lead);
      return acc;
    };

    let filteredSubLeads = [...filteredSubLeadsFromPattern];
    (byMasterIdData || []).forEach((lead: any) => {
      filteredSubLeads = mergeNewSubLead(filteredSubLeads, lead);
    });
    (linkedSubLeadsData || []).forEach((lead: any) => {
      filteredSubLeads = mergeNewSubLead(filteredSubLeads, lead);
    });

    const leadIdsForContacts = [
      masterLead?.id,
      ...(filteredSubLeads.map((lead: any) => lead.id) || []),
    ].filter(Boolean);

    const leadIdsForContracts = leadIdsForContacts;

    // Fetch main contacts for each lead to get their contracts
    const mainContactsMap = new Map<string, number>(); // leadId -> mainContactId

    // For new leads, fetch main contacts from contacts table and lead_leadcontact
    if (leadIdsForContacts.length > 0) {
      const { data: contactsData } = await supabase
        .from('contacts')
        .select('id, lead_id, is_main_applicant, relationship')
        .in('lead_id', leadIdsForContacts.map(id => String(id)));

      if (contactsData) {
        contactsData.forEach((contact: any) => {
          const isMain = contact.is_main_applicant === true ||
            contact.relationship === 'persecuted_person';
          if (isMain && contact.lead_id) {
            mainContactsMap.set(String(contact.lead_id), contact.id);
          }
        });
      }

      const { data: leadContacts } = await supabase
        .from('lead_leadcontact')
        .select('newlead_id, contact_id, main')
        .in('newlead_id', leadIdsForContacts.map(id => String(id)))
        .eq('main', 'true');

      if (leadContacts) {
        leadContacts.forEach((lc: any) => {
          if (lc.newlead_id && !mainContactsMap.has(String(lc.newlead_id))) {
            mainContactsMap.set(String(lc.newlead_id), lc.contact_id);
          }
        });
      }
    }

    // Parallelize all independent queries
    const [
      { data: categories },
      { data: stageDefinitions },
      { data: employees },
      { data: contactsData },
      { data: newContractsData }
    ] = await Promise.all([
      supabase
        .from('misc_category')
        .select(`
            id,
            name,
            parent_id,
            misc_maincategory!parent_id (
              id,
              name
            )
          `)
        .order('name', { ascending: true }),
      supabase
        .from('lead_stages')
        .select('id, name'),
      supabase
        .from('tenants_employee')
        .select('id, display_name'),
      leadIdsForContacts.length > 0
        ? supabase
          .from('contacts')
          .select('id, lead_id, name, is_main_applicant, relationship')
          .in('lead_id', leadIdsForContacts.map(id => String(id)))
        : Promise.resolve({ data: null, error: null }),
      // Fetch contracts for all leads, then filter by main contact
      // This matches ContactInfoTab logic: fetch by client_id, then map by contact_id
      leadIdsForContracts.length > 0
        ? supabase
          .from('contracts')
          .select('id, client_id, contact_id')
          .in('client_id', leadIdsForContracts.map(id => String(id)))
          .order('created_at', { ascending: false })
        : Promise.resolve({ data: null, error: null })
    ]);

    const stageNameLookup = new Map<string, string>();
    stageDefinitions?.forEach(stage => {
      if (stage?.id !== undefined && stage?.id !== null) {
        stageNameLookup.set(String(stage.id), stage.name || String(stage.id));
      }
    });

    const employeeMap = new Map<number, string>();
    const employeeNameToIdMap = new Map<string, number>(); // Reverse map: display_name -> id
    employees?.forEach(emp => {
      if (emp.id && emp.display_name) {
        employeeMap.set(emp.id, emp.display_name);
        // Create reverse map for looking up IDs by display name
        employeeNameToIdMap.set(emp.display_name.trim().toLowerCase(), emp.id);
      }
    });

    const contactsByLead = new Map<string, any[]>();
    if (contactsData) {
      contactsData.forEach(contact => {
        if (!contact.lead_id) return;
        const key = String(contact.lead_id);
        const existing = contactsByLead.get(key) || [];
        existing.push(contact);
        contactsByLead.set(key, existing);
      });
    }

    const isTruthy = (value: any) => value === true || value === 'true' || value === 't' || value === '1';

    const resolveContactName = (lead: any): string => {
      const contactList = (contactsByLead.get(String(lead.id)) || []).slice();

      if (contactList.length > 0) {
        contactList.sort((a, b) => {
          const aMain = isTruthy(a.is_main_applicant) || (typeof a.relationship === 'string' && a.relationship.toLowerCase() === 'persecuted_person');
          const bMain = isTruthy(b.is_main_applicant) || (typeof b.relationship === 'string' && b.relationship.toLowerCase() === 'persecuted_person');
          if (aMain === bMain) return 0;
          return aMain ? -1 : 1;
        });

        const selectedContact = contactList[0];
        if (selectedContact?.name && selectedContact.name.trim()) {
          return selectedContact.name.trim();
        }
      }

      if (Array.isArray(lead.additional_contacts) && lead.additional_contacts.length > 0) {
        const additionalContact = lead.additional_contacts.find((contact: any) => contact?.name && contact.name.trim());
        if (additionalContact?.name) {
          return additionalContact.name.trim();
        }
      }

      const fallbackName = lead.anchor_full_name || lead.contact_name || lead.primary_contact_name || lead.name;
      return fallbackName && typeof fallbackName === 'string' && fallbackName.trim() ? fallbackName.trim() : '---';
    };

    // Map contracts to leads based on main contacts
    // This matches ContactInfoTab logic: fetch by client_id, then filter by main contact's contact_id
    const newContractsMap = new Map<string, { id: string; isLegacy: boolean }>();
    if (newContractsData) {
      newContractsData.forEach((contract: any) => {
        if (!contract.client_id || !contract.id) return;

        const leadId = String(contract.client_id);
        const mainContactId = mainContactsMap.get(leadId);

        if (
          contract.contact_id != null &&
          mainContactId != null &&
          Number(contract.contact_id) === Number(mainContactId)
        ) {
          const existing = newContractsMap.get(leadId);
          if (!existing) {
            newContractsMap.set(leadId, {
              id: contract.id,
              isLegacy: false
            });
          }
        } else if (!contract.contact_id && mainContactId) {
          const existing = newContractsMap.get(leadId);
          if (!existing) {
            newContractsMap.set(leadId, {
              id: contract.id,
              isLegacy: false
            });
          }
        }
      });
    }

    // Update contractsDataMap
    setContractsDataMap(prev => {
      const merged = new Map(prev);
      newContractsMap.forEach((value, key) => {
        merged.set(key, value);
      });
      return merged;
    });

    const processedSubLeads: SubLead[] = [];

    const formatNewLead = (lead: any, isMaster: boolean, hasSubLeads: boolean = false, isLinkedOnly: boolean = false): SubLead => {
      let leadNumberValue = lead.lead_number || baseLeadNumber;
      if (isMaster && hasSubLeads && !leadNumberValue.includes('/')) {
        leadNumberValue = `${leadNumberValue}/1`;
      }
      // Linked-only leads: show actual lead number (no master/suffix)
      if (isLinkedOnly && lead.lead_number) {
        leadNumberValue = lead.lead_number;
      }
      const manualValue = lead.manual_id ? String(lead.manual_id) : undefined;
      // For new leads: use balance first, then proposal_total (same logic as Clients.tsx)
      const totalRaw = lead.balance ?? lead.proposal_total ?? 0;
      const totalValue = typeof totalRaw === 'number' ? totalRaw : parseFloat(String(totalRaw)) || 0;
      const currencyCode = (lead.balance_currency || lead.currency || 'NIS') as string;
      const categoryName = getCategoryName(lead.category_id, categories || []) || lead.category || 'Unknown';
      const applicantsValue = lead.number_of_applicants_meeting ?? lead.number_of_applicants ?? lead.applicants ?? 0;
      const contactName = resolveContactName(lead);

      // Map scheduler
      let schedulerName = '---';
      let finalSchedulerId: number | undefined = undefined;
      const schedulerIdValue = lead.meeting_scheduler_id || lead.scheduler_id;
      if (schedulerIdValue) {
        const schedulerIdNum = typeof schedulerIdValue === 'string' ? parseInt(schedulerIdValue, 10) : schedulerIdValue;
        if (!isNaN(schedulerIdNum) && employeeMap.has(schedulerIdNum)) {
          schedulerName = employeeMap.get(schedulerIdNum)!;
          finalSchedulerId = schedulerIdNum;
        }
      }
      if (schedulerName === '---') {
        const schedulerText = lead.scheduler || lead.meeting_scheduler;
        if (schedulerText) {
          const schedulerTextNum = typeof schedulerText === 'string' ? parseInt(schedulerText.trim(), 10) : NaN;
          if (!isNaN(schedulerTextNum) && employeeMap.has(schedulerTextNum)) {
            schedulerName = employeeMap.get(schedulerTextNum)!;
            finalSchedulerId = schedulerTextNum;
          } else {
            schedulerName = schedulerText;
            // Try to find employee ID by display name
            const foundId = employeeNameToIdMap.get(schedulerText.trim().toLowerCase());
            if (foundId) {
              finalSchedulerId = foundId;
            }
          }
        }
      }

      // Map closer
      let closerName = '---';
      let finalCloserId: number | undefined = undefined;
      const closerIdValue = lead.closer_id || lead.meeting_closer_id;
      if (closerIdValue) {
        const closerIdNum = typeof closerIdValue === 'string' ? parseInt(closerIdValue, 10) : closerIdValue;
        if (!isNaN(closerIdNum) && employeeMap.has(closerIdNum)) {
          closerName = employeeMap.get(closerIdNum)!;
          finalCloserId = closerIdNum;
        }
      }
      if (closerName === '---') {
        const closerText = lead.closer || lead.meeting_closer;
        if (closerText) {
          const closerTextNum = typeof closerText === 'string' ? parseInt(closerText.trim(), 10) : NaN;
          if (!isNaN(closerTextNum) && employeeMap.has(closerTextNum)) {
            closerName = employeeMap.get(closerTextNum)!;
            finalCloserId = closerTextNum;
          } else {
            closerName = closerText;
            // Try to find employee ID by display name
            const foundId = employeeNameToIdMap.get(closerText.trim().toLowerCase());
            if (foundId) {
              finalCloserId = foundId;
            }
          }
        }
      }

      // Map handler
      let handlerName = '---';
      let finalHandlerId: number | undefined = undefined;
      const handlerIdValue = lead.case_handler_id || lead.handler_id;
      if (handlerIdValue) {
        const handlerIdNum = typeof handlerIdValue === 'string' ? parseInt(handlerIdValue, 10) : handlerIdValue;
        if (!isNaN(handlerIdNum) && employeeMap.has(handlerIdNum)) {
          handlerName = employeeMap.get(handlerIdNum)!;
          finalHandlerId = handlerIdNum;
        }
      }
      if (handlerName === '---') {
        const handlerText = lead.handler || lead.case_handler;
        if (handlerText) {
          const handlerTextNum = typeof handlerText === 'string' ? parseInt(handlerText.trim(), 10) : NaN;
          if (!isNaN(handlerTextNum) && employeeMap.has(handlerTextNum)) {
            handlerName = employeeMap.get(handlerTextNum)!;
            finalHandlerId = handlerTextNum;
          } else {
            handlerName = handlerText;
            // Try to find employee ID by display name
            const foundId = employeeNameToIdMap.get(handlerText.trim().toLowerCase());
            if (foundId) {
              finalHandlerId = foundId;
            }
          }
        }
      }

      // For master leads, use simple lead_number (without /1) for the route
      // For subleads, use the full lead_number with suffix
      const routeLeadNumber = isMaster
        ? (lead.lead_number || baseLeadNumber) // Use base lead_number without /1 suffix
        : leadNumberValue; // Use full lead_number with suffix for subleads

      return {
        id: String(lead.id),
        lead_number: leadNumberValue,
        document_lead_number: String(lead.lead_number || baseLeadNumber || '').trim() || leadNumberValue,
        actual_lead_id: manualValue || leadNumberValue || String(lead.id),
        manual_id: manualValue ?? undefined,
        name: lead.name || 'Unknown',
        total: totalValue,
        currency: currencyCode,
        currency_symbol: getCurrencySymbol(currencyCode),
        category: categoryName,
        topic: lead.topic || undefined,
        stage: String(lead.stage),
        contact: contactName,
        applicants: Number(applicantsValue) || 0,
        agreement: undefined, // Will be set in component
        scheduler: schedulerName,
        scheduler_id: finalSchedulerId,
        closer: closerName,
        closer_id: finalCloserId,
        handler: handlerName,
        handler_id: finalHandlerId,
        master_id: lead.master_id || baseLeadNumber,
        isMaster,
        isLinkedOnly: isLinkedOnly || undefined,
        route: buildClientRoute(manualValue, routeLeadNumber),
      };
    };

    const hasSubLeads = filteredSubLeads && filteredSubLeads.length > 0;
    processedSubLeads.push(formatNewLead(masterLead, true, hasSubLeads, false));
    filteredSubLeads.forEach((lead: any) => {
      const linkedOnly = isNonSelfLinkedMasterLead(lead.linked_master_lead, lead.lead_number, lead.id);
      processedSubLeads.push(formatNewLead(lead, false, false, linkedOnly));
    });

    // Legacy leads linked to this new master (cross-save: legacy sublead → new master)
    (linkedLegacyToNewData || []).forEach((lead: any) => {
      if (!lead || lead.id == null) return;
      const currencyInfo = getCurrencyInfo(lead);
      processedSubLeads.push({
        id: `legacy_${lead.id}`,
        lead_number: String(lead.id),
        document_lead_number: String(lead.id),
        actual_lead_id: String(lead.id),
        isLinkedOnly: true,
        manual_id: lead.manual_id ?? undefined,
        name: lead.name || 'Unknown',
        total: getLegacyLeadTotal(lead),
        currency: currencyInfo.currency,
        currency_symbol: currencyInfo.symbol,
        category: getCategoryName(lead.category_id, categories || []),
        topic: lead.topic || undefined,
        stage: String(lead.stage ?? ''),
        contact: lead.name || '---',
        applicants: parseInt(lead.no_of_applicants) || 0,
        agreement: undefined,
        scheduler: '---',
        scheduler_id: lead.meeting_scheduler_id,
        closer: '---',
        closer_id: lead.closer_id,
        handler: '---',
        handler_id: lead.case_handler_id,
        master_id: lead.master_id,
        isMaster: false,
        route: `/clients/${lead.id}`,
      });
    });

    // Order: master first, then traditional subleads (6/1, 6/2, ...), then linked-only leads at the bottom
    processedSubLeads.sort((a, b) => {
      if (a.isMaster && !b.isMaster) return -1;
      if (!a.isMaster && b.isMaster) return 1;
      if (a.isLinkedOnly && !b.isLinkedOnly) return 1;
      if (!a.isLinkedOnly && b.isLinkedOnly) return -1;
      if (a.isLinkedOnly && b.isLinkedOnly) return String(a.lead_number).localeCompare(String(b.lead_number));
      const extractOrder = (leadNumber: string) => {
        const parts = leadNumber.split('/');
        const lastPart = parts[parts.length - 1];
        return parseInt(lastPart, 10) || 0;
      };
      return extractOrder(a.lead_number) - extractOrder(b.lead_number);
    });

    return { success: true, masterLead, subLeads: processedSubLeads };
  } catch (error) {
    console.error('Error handling new master lead:', error);
    return { success: false, error: 'An unexpected error occurred while fetching master lead data' };
  }
};

// Fetch legacy master lead and sub-leads
export const fetchLegacyMasterLead = async (
  baseLeadNumber: string,
  normalizedId: string,
  setContractsDataMap: (updater: (prev: Map<string, ContractData>) => Map<string, ContractData>) => void
): Promise<{ success: boolean; masterLead?: any; subLeads?: SubLead[]; error?: string }> => {
  try {
    const legacyId = parseInt(normalizedId, 10);

    const { data: masterLeadRow, error: masterError } = await supabase
      .from('leads_lead')
      .select(`
          id, name, total, total_base, stage, manual_id, master_id,
          category_id,
          topic,
          meeting_scheduler_id,
          closer_id,
          case_handler_id,
          retainer_handler_id,
          docs_url,
          currency_id,
          no_of_applicants,
          accounting_currencies!leads_lead_currency_id_fkey (
            name,
            iso_code
          ),
          scheduler:tenants_employee!meeting_scheduler_id (
            display_name
          ),
          closer:tenants_employee!closer_id (
            display_name
          ),
          handler:tenants_employee!case_handler_id (
            display_name
          )
        `)
      .eq('id', legacyId)
      .maybeSingle();

    if (masterError) {
      console.error('Error fetching master lead:', masterError);
      return { success: false, error: 'Failed to fetch master lead information' };
    }
    if (!masterLeadRow) {
      return { success: false, error: 'Legacy lead not found' };
    }

    let masterLead = masterLeadRow;
    const parentMasterId = String(masterLead.master_id || '').trim();
    if (parentMasterId && !isSelfOrEmptyMasterId(parentMasterId, masterLead.id)) {
      const parentNumeric = parseInt(parentMasterId, 10);
      if (!Number.isNaN(parentNumeric)) {
        const { data: parentLead } = await supabase
          .from('leads_lead')
          .select(`
          id, name, total, total_base, stage, manual_id, master_id,
          category_id,
          topic,
          meeting_scheduler_id,
          closer_id,
          case_handler_id,
          retainer_handler_id,
          docs_url,
          currency_id,
          no_of_applicants,
          accounting_currencies!leads_lead_currency_id_fkey (
            name,
            iso_code
          ),
          scheduler:tenants_employee!meeting_scheduler_id (
            display_name
          ),
          closer:tenants_employee!closer_id (
            display_name
          ),
          handler:tenants_employee!case_handler_id (
            display_name
          )
        `)
          .eq('id', parentNumeric)
          .maybeSingle();
        if (parentLead) masterLead = parentLead;
      }
    }

    const rootLegacyId = String(masterLead.id);
    const subLeadsQuery = supabase
      .from('leads_lead')
      .select(`
          id, name, total, total_base, stage, manual_id, master_id,
          category_id,
          topic,
          meeting_scheduler_id,
          closer_id,
          case_handler_id,
          retainer_handler_id,
          docs_url,
          currency_id,
          no_of_applicants,
          accounting_currencies!leads_lead_currency_id_fkey (
            name,
            iso_code
          ),
          scheduler:tenants_employee!meeting_scheduler_id (
            display_name
          ),
          closer:tenants_employee!closer_id (
            display_name
          ),
          handler:tenants_employee!case_handler_id (
            display_name
          )
        `)
      .or(`master_id.eq.${rootLegacyId},master_id.eq.${baseLeadNumber},master_id.eq.${normalizedId}`)
      .order('id', { ascending: true })
      .limit(50);

    const [
      { data: subLeadsData },
      { data: categories },
      { data: employees }
    ] = await Promise.all([
      subLeadsQuery,
      supabase
        .from('misc_category')
        .select(`
            id,
            name,
            parent_id,
            misc_maincategory!parent_id (
              id,
              name
            )
          `)
        .order('name', { ascending: true }),
      supabase
        .from('tenants_employee')
        .select('id, display_name')
    ]);

    // Also include legacy leads linked via linked_master_lead (column is text: legacy id or new lead number)
    const masterLegacyId = masterLead?.id != null ? Number(masterLead.id) : Number(legacyId);
    const masterLegacyIdStr = String(masterLegacyId);
    const { data: linkedLegacyData, error: linkedLegacyError } = await supabase
      .from('leads_lead')
      .select(`
          id, name, total, total_base, stage, manual_id, master_id, linked_master_lead,
          category_id,
          topic,
          meeting_scheduler_id,
          closer_id,
          case_handler_id,
          retainer_handler_id,
          docs_url,
          currency_id,
          no_of_applicants,
          accounting_currencies!leads_lead_currency_id_fkey (
            name,
            iso_code
          ),
          scheduler:tenants_employee!meeting_scheduler_id (
            display_name
          ),
          closer:tenants_employee!closer_id (
            display_name
          ),
          handler:tenants_employee!case_handler_id (
            display_name
          )
        `)
      .in('linked_master_lead', linkedMasterLookupValues(masterLegacyIdStr, baseLeadNumber, normalizedId));

    // New leads linked to this legacy master (linked_master_lead = legacy id as text)
    // PLUS new leads whose master_id is the corresponding new-lead UUID or numeric legacy id
    // (same resolution Clients.tsx uses — master_id UUID is the common case for new subleads)
    const newMasterLookupOr: string[] = [
      `lead_number.eq.${masterLegacyIdStr}`,
      `lead_number.eq.L${masterLegacyIdStr}`,
      `lead_number.eq.C${masterLegacyIdStr}`,
      `lead_number.eq.${masterLegacyIdStr}/1`,
      `lead_number.eq.L${masterLegacyIdStr}/1`,
      `manual_id.eq.${masterLegacyIdStr}`,
    ];
    const { data: newMasterRows } = await supabase
      .from('leads')
      .select('id, lead_number, manual_id')
      .or(newMasterLookupOr.join(','))
      .limit(1);
    const newMasterForLegacy = newMasterRows?.[0] ?? null;

    const linkedNewValues = linkedMasterLookupValues(masterLegacyIdStr, baseLeadNumber, normalizedId);
    const newLeadSelect = `
        id, lead_number, manual_id, name, stage, master_id, linked_master_lead,
        category_id, topic, balance, proposal_total, balance_currency, number_of_applicants_meeting,
        meeting_scheduler_id, closer_id, case_handler_id, scheduler, closer, handler
      `;
    const newLeadByMasterIdQueries = [
      supabase.from('leads').select(newLeadSelect).eq('master_id', masterLegacyIdStr),
    ];
    if (newMasterForLegacy?.id) {
      newLeadByMasterIdQueries.push(
        supabase.from('leads').select(newLeadSelect).eq('master_id', newMasterForLegacy.id),
      );
    }
    const [{ data: linkedNewByMasterIdRows }, { data: linkedNewByLinkedRows }] = await Promise.all([
      Promise.all(newLeadByMasterIdQueries).then((results) => ({
        data: results.flatMap((result) => result.data || []),
      })),
      linkedNewValues.length > 0
        ? supabase.from('leads').select(newLeadSelect).in('linked_master_lead', linkedNewValues)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const linkedNewToLegacyRaw = [
      ...(linkedNewByMasterIdRows || []),
      ...(linkedNewByLinkedRows || []),
    ];

    // Exclude the corresponding new master row itself; keep true subleads / linked leads only
    const linkedNewToLegacyData = (linkedNewToLegacyRaw || []).filter((lead: any) => {
      if (!lead?.id) return false;
      if (newMasterForLegacy?.id && String(lead.id) === String(newMasterForLegacy.id)) return false;
      return true;
    });

    const existingIds = new Set((subLeadsData || []).map((l: any) => l.id));
    const linkedLegacySubLeads = (linkedLegacyData || []).filter(
      (l: any) => l?.id != null && !existingIds.has(l.id)
    );
    const allLegacySubLeads = [...(subLeadsData || []), ...linkedLegacySubLeads];

    const allLeadIds = [masterLead?.id, ...allLegacySubLeads.map(lead => lead.id)].filter(Boolean);
    const newLinkedLeadIds = linkedNewToLegacyData.map((l: any) => l.id).filter(Boolean);

    // Fetch main contacts for legacy leads
    const legacyMainContactsMap = new Map<number, number>(); // leadId -> mainContactId

    if (allLeadIds.length > 0) {
      const { data: mainLeadContacts } = await supabase
        .from('lead_leadcontact')
        .select('lead_id, contact_id, main')
        .in('lead_id', allLeadIds)
        .eq('main', 'true');

      if (mainLeadContacts) {
        mainLeadContacts.forEach((lc: any) => {
          if (lc.lead_id && lc.contact_id) {
            legacyMainContactsMap.set(Number(lc.lead_id), lc.contact_id);
          }
        });
      }
    }

    const [
      { data: leadContacts },
      { data: contractsData },
      { data: legacyContractsData },
      { data: stageData }
    ] = await Promise.all([
      allLeadIds.length > 0
        ? supabase
          .from('lead_leadcontact')
          .select('lead_id, contact_id')
          .in('lead_id', allLeadIds)
        : Promise.resolve({ data: null, error: null }),
      // For legacy leads, fetch new contracts for all leads, then filter by main contact
      // This matches ContactInfoTab logic: fetch by legacy_id, then map by contact_id
      allLeadIds.length > 0
        ? supabase
          .from('contracts')
          .select('id, legacy_id, contact_id')
          .in('legacy_id', allLeadIds)
          .order('created_at', { ascending: false })
        : Promise.resolve({ data: null, error: null }),
      // For legacy leads, fetch legacy contracts for all leads, then filter by main contact
      // This matches ContactInfoTab logic: fetch by lead_id, then map by contact_id
      allLeadIds.length > 0
        ? supabase
          .from('lead_leadcontact')
          .select('lead_id, id, contact_id, public_token')
          .in('lead_id', allLeadIds)
          .or('contract_html.not.is.null,signed_contract_html.not.is.null')
        : Promise.resolve({ data: null, error: null }),
      allLeadIds.length > 0
        ? supabase
          .from('leads_leadstage')
          .select('lead_id, cdate')
          .in('lead_id', allLeadIds)
          .eq('stage', 60)
          .order('cdate', { ascending: false })
          .limit(200)
        : Promise.resolve({ data: null, error: null })
    ]);

    const signedDatesMap = new Map<number, string>();
    if (stageData) {
      stageData.forEach(stage => {
        const leadId = Number(stage.lead_id);
        if (!signedDatesMap.has(leadId) ||
          (stage.cdate && (!signedDatesMap.get(leadId) || new Date(stage.cdate) > new Date(signedDatesMap.get(leadId)!)))) {
          if (stage.cdate) {
            signedDatesMap.set(leadId, stage.cdate);
          }
        }
      });
    }

    // Fallback: for leads with no main=true contact, use first contact from lead_leadcontact (same idea as ContactInfoTab which assigns by contact_id)
    if (leadContacts && leadContacts.length > 0) {
      allLeadIds.forEach((leadId: number) => {
        if (!legacyMainContactsMap.has(leadId)) {
          const first = leadContacts.find((lc: any) => Number(lc.lead_id) === leadId);
          if (first && first.contact_id) {
            legacyMainContactsMap.set(leadId, first.contact_id);
          }
        }
      });
    }

    const contractsMap = new Map<string, ContractData>();

    // Create reverse map: contact_id -> lead_id for legacy leads
    const legacyContactToLeadMap = new Map<number, number>();
    legacyMainContactsMap.forEach((contactId, leadId) => {
      legacyContactToLeadMap.set(contactId, leadId);
    });

    // Process new contracts for legacy leads (filtered by main contact)
    // This matches ContactInfoTab logic: fetch by legacy_id, then filter by main contact's contact_id
    if (contractsData) {
      contractsData.forEach((contract: any) => {
        if (!contract.legacy_id || !contract.id) return;

        const leadId = String(contract.legacy_id);
        const mainContactId = legacyMainContactsMap.get(Number(leadId));

        // Only assign contract if it belongs to the main contact
        if (
          contract.contact_id != null &&
          mainContactId != null &&
          Number(contract.contact_id) === Number(mainContactId)
        ) {
          // Only set if we don't already have a contract for this lead
          if (!contractsMap.has(leadId)) {
            contractsMap.set(leadId, {
              id: contract.id,
              isLegacy: false
            });
          }
        } else if (!contract.contact_id && mainContactId) {
          // Fallback: if no contact_id, assign to main contact (backward compatibility)
          // Only if this lead has a main contact
          if (!contractsMap.has(leadId)) {
            contractsMap.set(leadId, {
              id: contract.id,
              isLegacy: false
            });
          }
        } else if (contract.contact_id == null && !mainContactId) {
          // Last resort: any contract on this legacy_id when we have no main contact mapping
          if (!contractsMap.has(leadId)) {
            contractsMap.set(leadId, {
              id: contract.id,
              isLegacy: false
            });
          }
        }
      });
    }

    // Process legacy contracts (filtered by main contact)
    // This matches ContactInfoTab logic: fetch by lead_id, then filter by main contact's contact_id
    if (legacyContractsData) {
      legacyContractsData.forEach((lc: any) => {
        if (!lc.lead_id || !lc.id) return;

        const leadId = String(lc.lead_id);
        const mainContactId = legacyMainContactsMap.get(Number(lc.lead_id));

        if (mainContactId != null && Number(mainContactId) === Number(lc.contact_id)) {
          const leadIdNum = Number(lc.lead_id);
          const signedDate = signedDatesMap.get(leadIdNum);
          const existing = contractsMap.get(leadId);

          if (!existing || existing.isLegacy === false) {
            contractsMap.set(leadId, {
              id: `legacy_${lc.id}`,
              isLegacy: true,
              public_token: lc.public_token,
              signed_at: signedDate
            });
          }
        }
      });
    }

    // Contracts for new (UUID) subleads linked into this legacy master chain
    if (newLinkedLeadIds.length > 0) {
      const { data: newLinkedContracts } = await supabase
        .from('contracts')
        .select('id, client_id, contact_id')
        .in('client_id', newLinkedLeadIds.map((id: any) => String(id)))
        .order('created_at', { ascending: false });

      (newLinkedContracts || []).forEach((contract: any) => {
        if (!contract?.client_id || !contract?.id) return;
        const leadId = String(contract.client_id);
        if (!contractsMap.has(leadId)) {
          contractsMap.set(leadId, { id: contract.id, isLegacy: false });
        }
      });
    }

    setContractsDataMap(() => contractsMap);

    const contactIds = leadContacts?.map(lc => lc.contact_id).filter(Boolean) || [];
    let contactDetails: any[] = [];

    if (contactIds.length > 0) {
      const { data: contacts } = await supabase
        .from('leads_contact')
        .select('id, name, phone, email, mobile')
        .in('id', contactIds);

      contactDetails = contacts || [];
    }

    const employeeMap = new Map();
    const employeeNameToIdMap = new Map<string, number>(); // Reverse map: display_name -> id
    employees?.forEach(emp => {
      if (emp.id && emp.display_name) {
        employeeMap.set(String(emp.id), emp.display_name);
        // Create reverse map for looking up IDs by display name
        employeeNameToIdMap.set(emp.display_name.trim().toLowerCase(), emp.id);
      }
    });

    const contactMap = new Map();
    const contactDetailsMap = new Map();
    contactDetails.forEach(contact => {
      contactDetailsMap.set(contact.id, contact);
    });

    leadContacts?.forEach(leadContact => {
      if (leadContact.contact_id && contactDetailsMap.has(leadContact.contact_id)) {
        contactMap.set(String(leadContact.lead_id), contactDetailsMap.get(leadContact.contact_id));
      }
    });

    const processedSubLeads: SubLead[] = [];

    if (masterLead) {
      const hasSubLeads = allLegacySubLeads.length > 0;
      const formattedLeadNumber = formatLegacyLeadNumber(masterLead, undefined, hasSubLeads);
      const displayNumber = masterLead.stage === 100 ? `C${formattedLeadNumber}` : formattedLeadNumber;
      const currencyInfo = getCurrencyInfo(masterLead);

      processedSubLeads.push({
        id: `legacy_${masterLead.id}`,
        lead_number: displayNumber,
        document_lead_number: String(masterLead.id),
        actual_lead_id: String(masterLead.id),
        manual_id: masterLead.manual_id ?? undefined,
        name: masterLead.name || 'Unknown',
        total: getLegacyLeadTotal(masterLead),
        currency: currencyInfo.currency,
        currency_symbol: currencyInfo.symbol,
        category: getCategoryName(masterLead.category_id, categories || []),
        topic: masterLead.topic || undefined,
        stage: String(masterLead.stage),
        contact: getContactInfo(masterLead, contactMap),
        applicants: parseInt(masterLead.no_of_applicants) || 0,
        agreement: undefined, // Will be set in component
        scheduler: (() => {
          const scheduler = Array.isArray(masterLead.scheduler) ? masterLead.scheduler[0] : masterLead.scheduler;
          return (scheduler as any)?.display_name || '---';
        })(),
        scheduler_id: masterLead.meeting_scheduler_id || undefined,
        closer: (() => {
          const closer = Array.isArray(masterLead.closer) ? masterLead.closer[0] : masterLead.closer;
          return (closer as any)?.display_name || '---';
        })(),
        closer_id: masterLead.closer_id || undefined,
        handler: (() => {
          const handler = Array.isArray(masterLead.handler) ? masterLead.handler[0] : masterLead.handler;
          return (handler as any)?.display_name || '---';
        })(),
        handler_id: masterLead.case_handler_id || undefined,
        master_id: masterLead.master_id,
        isMaster: true,
        route: `/clients/${masterLead.id}`
      });
    }

    if (allLegacySubLeads.length > 0) {
      const masterIdSubLeadsCount = (subLeadsData || []).length;
      let linkedOnlySuffix = masterIdSubLeadsCount + 2;

      const subLeadsWithSuffix = allLegacySubLeads.map((lead: any) => {
        const isLinkedOnly = isNonSelfLinkedMasterLead(lead.linked_master_lead, null, lead.id) && (lead.master_id == null || String(lead.master_id).trim() === '');
        if (isLinkedOnly) {
          const suffix = linkedOnlySuffix++;
          return { lead, subLeadSuffix: suffix, displayAsId: false };
        }
        let subLeadSuffix: number | undefined;
        if (lead.master_id) {
          const sameMasterLeads = allLegacySubLeads.filter((l: any) => l.master_id === lead.master_id);
          const sortedSameMaster = [...sameMasterLeads].sort((a: any, b: any) => a.id - b.id);
          const currentIndex = sortedSameMaster.findIndex((l: any) => l.id === lead.id);
          subLeadSuffix = currentIndex >= 0 ? currentIndex + 2 : sameMasterLeads.length + 2;
        }
        return { lead, subLeadSuffix, displayAsId: false };
      });

      subLeadsWithSuffix.forEach(({ lead, subLeadSuffix, displayAsId }: { lead: any; subLeadSuffix?: number; displayAsId: boolean }) => {
        const isLinkedOnly = isNonSelfLinkedMasterLead(lead.linked_master_lead, null, lead.id) && (lead.master_id == null || String(lead.master_id).trim() === '');
        const formattedLeadNumber = isLinkedOnly ? String(lead.id) : formatLegacyLeadNumber(lead, subLeadSuffix, false);
        const displayNumber = lead.stage === 100 ? `C${formattedLeadNumber}` : formattedLeadNumber;
        const currencyInfo = getCurrencyInfo(lead);

        processedSubLeads.push({
          id: `legacy_${lead.id}`,
          lead_number: displayNumber,
          document_lead_number: isLinkedOnly ? String(lead.id) : String(lead.id),
          actual_lead_id: String(lead.id),
          isLinkedOnly: isLinkedOnly || undefined,
          manual_id: lead.manual_id ?? undefined,
          name: lead.name || 'Unknown',
          total: getLegacyLeadTotal(lead),
          currency: currencyInfo.currency,
          currency_symbol: currencyInfo.symbol,
          category: getCategoryName(lead.category_id, categories || []),
          topic: lead.topic || undefined,
          stage: String(lead.stage),
          contact: getContactInfo(lead, contactMap),
          applicants: parseInt(lead.no_of_applicants) || 0,
          agreement: undefined, // Will be set in component
          scheduler: (() => {
            const scheduler = Array.isArray(lead.scheduler) ? lead.scheduler[0] : lead.scheduler;
            return (scheduler as any)?.display_name || '---';
          })(),
          scheduler_id: lead.meeting_scheduler_id || undefined,
          closer: (() => {
            const closer = Array.isArray(lead.closer) ? lead.closer[0] : lead.closer;
            return (closer as any)?.display_name || '---';
          })(),
          closer_id: lead.closer_id || undefined,
          handler: (() => {
            const handler = Array.isArray(lead.handler) ? lead.handler[0] : lead.handler;
            return (handler as any)?.display_name || '---';
          })(),
          handler_id: lead.case_handler_id || undefined,
          master_id: lead.master_id,
          isMaster: false,
          route: `/clients/${lead.id}`
        });
      });
    }

    // New leads linked to this legacy master (cross-save: new sublead → legacy master / UUID master_id)
    (linkedNewToLegacyData || []).forEach((lead: any) => {
      if (!lead?.id) return;
      if (processedSubLeads.some((p) => String(p.id) === String(lead.id))) return;
      const totalRaw = lead.balance ?? lead.proposal_total ?? 0;
      const totalValue = typeof totalRaw === 'number' ? totalRaw : parseFloat(String(totalRaw)) || 0;
      const currencyCode = (lead.balance_currency || lead.currency || 'NIS') as string;
      const leadNum = lead.lead_number || String(lead.id);
      const hasMasterId = lead.master_id != null && String(lead.master_id).trim() !== '';
      const linkedOnly = !hasMasterId && isNonSelfLinkedMasterLead(lead.linked_master_lead, lead.lead_number, lead.id);
      const schedulerRole = resolveNewLeadRole(
        lead,
        ['meeting_scheduler_id', 'scheduler_id'],
        ['scheduler', 'meeting_scheduler'],
        employeeMap,
        employeeNameToIdMap,
      );
      const closerRole = resolveNewLeadRole(
        lead,
        ['closer_id', 'meeting_closer_id'],
        ['closer', 'meeting_closer'],
        employeeMap,
        employeeNameToIdMap,
      );
      const handlerRole = resolveNewLeadRole(
        lead,
        ['case_handler_id', 'handler_id'],
        ['handler', 'case_handler'],
        employeeMap,
        employeeNameToIdMap,
      );
      processedSubLeads.push({
        id: String(lead.id),
        lead_number: leadNum,
        document_lead_number: leadNum,
        actual_lead_id: leadNum,
        manual_id: lead.manual_id ?? undefined,
        name: lead.name || 'Unknown',
        total: totalValue,
        currency: currencyCode,
        currency_symbol: getCurrencySymbol(currencyCode),
        category: getCategoryName(lead.category_id, categories || []),
        topic: lead.topic || undefined,
        stage: String(lead.stage ?? ''),
        contact: lead.name || '---',
        applicants: Number(lead.number_of_applicants_meeting ?? lead.number_of_applicants ?? lead.applicants ?? 0) || 0,
        agreement: contractsMap.get(String(lead.id))?.id ?? undefined,
        agreementIsLegacy: contractsMap.get(String(lead.id))?.isLegacy,
        scheduler: schedulerRole.name,
        scheduler_id: schedulerRole.id,
        closer: closerRole.name,
        closer_id: closerRole.id,
        handler: handlerRole.name,
        handler_id: handlerRole.id,
        master_id: lead.master_id || undefined,
        isMaster: false,
        isLinkedOnly: linkedOnly || undefined,
        route: `/clients/${lead.lead_number || lead.id}`,
      });
    });

    // Order: master first, then traditional subleads (by suffix), then linked-only leads at the bottom
    processedSubLeads.sort((a, b) => {
      if (a.isMaster && !b.isMaster) return -1;
      if (!a.isMaster && b.isMaster) return 1;
      if (a.isLinkedOnly && !b.isLinkedOnly) return 1;
      if (!a.isLinkedOnly && b.isLinkedOnly) return -1;
      if (a.isLinkedOnly && b.isLinkedOnly) return String(a.lead_number).localeCompare(String(b.lead_number));
      const getNumericPart = (leadNumber: string) => {
        const cleanNumber = leadNumber.replace(/^C/, '');
        const parts = cleanNumber.split('/');
        const lastPart = parts[parts.length - 1];
        return parseInt(lastPart) || 0;
      };
      return getNumericPart(a.lead_number) - getNumericPart(b.lead_number);
    });

    return { success: true, masterLead, subLeads: processedSubLeads };
  } catch (error) {
    console.error('Error fetching legacy master lead:', error);
    return { success: false, error: 'An unexpected error occurred while fetching data' };
  }
};

export type ChainRootInfo = {
  /** Value passed to linkLeadToChain as baseLeadNumber (legacy id string or full new lead_number). */
  baseLeadNumber: string;
  isLegacyChain: boolean;
  masterLeadInfo: { id?: number | string };
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isLegacyMasterLinkValue(value: string): boolean {
  const trimmed = (value || '').trim();
  if (!trimmed || /^L/i.test(trimmed)) return false;
  const numeric = normalizeBaseLeadNumber(trimmed);
  return /^\d+$/.test(numeric);
}

/**
 * Resolve the chain root for creating/linking a sublead from a parent lead.
 * Prefer non-self linked_master_lead, then traditional master_id, else the parent itself.
 */
export async function resolveChainRootFromLead(lead: {
  id: string | number;
  lead_type?: string | null;
  lead_number?: string | null;
  master_id?: string | number | null;
  linked_master_lead?: string | number | null;
}): Promise<{ success: true; root: ChainRootInfo } | { success: false; error: string }> {
  try {
    const isLegacyParent =
      lead.lead_type === 'legacy' || String(lead.id).startsWith('legacy_');
    const ownId = String(lead.id);
    const ownLeadNumber = lead.lead_number != null ? String(lead.lead_number) : null;

    if (isNonSelfLinkedMasterLead(lead.linked_master_lead, ownLeadNumber, ownId)) {
      const linked = String(lead.linked_master_lead).trim();
      if (isLegacyMasterLinkValue(linked)) {
        const numericId = parseInt(normalizeBaseLeadNumber(linked), 10);
        if (Number.isNaN(numericId)) {
          return { success: false, error: 'Invalid linked master lead id' };
        }
        return {
          success: true,
          root: {
            baseLeadNumber: String(numericId),
            isLegacyChain: true,
            masterLeadInfo: { id: numericId },
          },
        };
      }
      return {
        success: true,
        root: {
          baseLeadNumber: linked.includes('/') ? linked.split('/')[0] : linked,
          isLegacyChain: false,
          masterLeadInfo: {},
        },
      };
    }

    const masterIdRaw =
      lead.master_id != null && String(lead.master_id).trim() !== ''
        ? String(lead.master_id).trim()
        : null;

    if (masterIdRaw) {
      if (isUuid(masterIdRaw)) {
        const { data: masterRow, error } = await supabase
          .from('leads')
          .select('id, lead_number')
          .eq('id', masterIdRaw)
          .maybeSingle();
        if (error) {
          console.error('resolveChainRootFromLead: master fetch failed', error);
          return { success: false, error: 'Failed to resolve master lead' };
        }
        const leadNumber = (masterRow?.lead_number || '').trim();
        if (!leadNumber) {
          return { success: false, error: 'Master lead has no lead number' };
        }
        return {
          success: true,
          root: {
            baseLeadNumber: leadNumber.includes('/') ? leadNumber.split('/')[0] : leadNumber,
            isLegacyChain: false,
            masterLeadInfo: { id: masterRow!.id },
          },
        };
      }

      // Numeric master_id: legacy root (or legacy-style id)
      const numericId = parseInt(normalizeBaseLeadNumber(masterIdRaw), 10);
      if (Number.isNaN(numericId)) {
        return { success: false, error: 'Invalid master lead id' };
      }
      return {
        success: true,
        root: {
          baseLeadNumber: String(numericId),
          isLegacyChain: true,
          masterLeadInfo: { id: numericId },
        },
      };
    }

    // Parent is the chain root
    if (isLegacyParent) {
      const numericId = parseInt(String(lead.id).replace(/^legacy_/, ''), 10);
      if (Number.isNaN(numericId)) {
        return { success: false, error: 'Invalid legacy lead id' };
      }
      return {
        success: true,
        root: {
          baseLeadNumber: String(numericId),
          isLegacyChain: true,
          masterLeadInfo: { id: numericId },
        },
      };
    }

    const parentLeadNumber = (lead.lead_number || '').trim();
    if (!parentLeadNumber) {
      return { success: false, error: 'Unable to determine master lead number' };
    }
    return {
      success: true,
      root: {
        baseLeadNumber: parentLeadNumber.includes('/')
          ? parentLeadNumber.split('/')[0]
          : parentLeadNumber,
        isLegacyChain: false,
        masterLeadInfo: { id: lead.id },
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to resolve chain root';
    console.error('resolveChainRootFromLead error:', err);
    return { success: false, error: message };
  }
}

export type CreateAndLinkLeadParams = {
  name: string;
  email?: string | null;
  phone?: string | null;
  topic?: string | null;
  language?: string | null;
  source?: string | null;
  createdBy?: string | null;
  balanceCurrency?: string;
  proposalCurrency?: string;
  /** Extra columns to patch onto the new leads row after RPC create (no master_id). */
  extraFields?: Record<string, unknown>;
  baseLeadNumber: string;
  isLegacyChain: boolean;
  masterLeadInfo?: { id?: number | string } | null;
};

export type CreateAndLinkLeadResult = {
  success: boolean;
  id?: string;
  lead_number?: string;
  error?: string;
};

/**
 * Create a standalone lead in `leads` (own L-number) and attach it via linked_master_lead.
 * Uses create_new_lead_v4 with v3 fallback — same path as Combine, without traditional master_id / BASE/N.
 */
export async function createAndLinkLeadToChain(
  params: CreateAndLinkLeadParams
): Promise<CreateAndLinkLeadResult> {
  try {
    const rpcBase = {
      p_lead_name: params.name,
      p_lead_email: params.email || null,
      p_lead_phone: params.phone || null,
      p_lead_topic: params.topic || null,
      p_lead_language: params.language || 'HE',
      p_lead_source: params.source || 'Manual',
      p_created_by: params.createdBy || null,
      p_balance_currency: params.balanceCurrency || 'NIS',
      p_proposal_currency: params.proposalCurrency || 'NIS',
    };

    let created: { id: string; lead_number: string } | null = null;
    let lastError: { message?: string } | null = null;

    const v4 = await supabase.rpc('create_new_lead_v4', rpcBase);
    lastError = v4.error;
    if (!lastError && v4.data?.[0]?.id) {
      created = {
        id: String(v4.data[0].id),
        lead_number: String(v4.data[0].lead_number || ''),
      };
    }

    if (lastError?.message?.includes('does not exist')) {
      const v3 = await supabase.rpc('create_new_lead_v3', {
        p_lead_name: rpcBase.p_lead_name,
        p_lead_email: rpcBase.p_lead_email,
        p_lead_phone: rpcBase.p_lead_phone,
        p_lead_topic: rpcBase.p_lead_topic,
        p_lead_language: rpcBase.p_lead_language,
        p_lead_source: rpcBase.p_lead_source,
        p_created_by: rpcBase.p_created_by,
      });
      lastError = v3.error;
      if (!lastError && v3.data?.[0]?.id) {
        created = {
          id: String(v3.data[0].id),
          lead_number: String(v3.data[0].lead_number || ''),
        };
      }
    }

    if (lastError || !created) {
      return {
        success: false,
        error: lastError?.message || 'Failed to create lead',
      };
    }

    if (params.extraFields && Object.keys(params.extraFields).length > 0) {
      // Never set master_id on combine-chain creates
      const { master_id: _omitMasterId, ...safeFields } = params.extraFields as Record<
        string,
        unknown
      > & { master_id?: unknown };
      const { error: updateError } = await supabase
        .from('leads')
        .update(safeFields)
        .eq('id', created.id);
      if (updateError) {
        console.error('createAndLinkLeadToChain: extraFields update failed', updateError);
        return { success: false, error: updateError.message, id: created.id, lead_number: created.lead_number };
      }
    }

    const linkResult = await linkLeadToChain(
      created.id,
      'new',
      params.baseLeadNumber,
      params.isLegacyChain,
      params.masterLeadInfo
    );

    if (!linkResult.success) {
      return {
        success: false,
        error: linkResult.error || 'Lead created but failed to link to chain',
        id: created.id,
        lead_number: created.lead_number,
      };
    }

    return {
      success: true,
      id: created.id,
      lead_number: created.lead_number,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create and link lead';
    console.error('createAndLinkLeadToChain error:', err);
    return { success: false, error: message };
  }
}

/**
 * Link an existing lead (new or legacy) to a master-lead chain using the linked_master_lead column.
 * Both leads and leads_lead use linked_master_lead as TEXT so we can cross-save:
 * - Legacy master: store master id as string (e.g. "191799").
 * - New master: store master lead_number as string (e.g. "L210292").
 */
export async function linkLeadToChain(
  leadId: string,
  leadType: 'new' | 'legacy',
  baseLeadNumber: string,
  isLegacyChain: boolean,
  masterLeadInfo?: { id?: number | string } | null
): Promise<{ success: boolean; nextSuffix?: number; error?: string }> {
  try {
    const base = normalizeBaseLeadNumber(baseLeadNumber);
    if (!base) {
      return { success: false, error: 'Invalid base lead number' };
    }

    // Value to save in linked_master_lead (always text): legacy master id as string, or new master lead_number
    const legacyMasterId = isLegacyChain && (masterLeadInfo?.id != null ? Number(masterLeadInfo.id) : parseInt(base, 10));
    const legacyMasterValue = !Number.isNaN(legacyMasterId) ? String(legacyMasterId) : null;
    const newMasterLeadNumber = (baseLeadNumber || '').trim();

    if (leadType === 'legacy') {
      // Sublead is legacy: update leads_lead. linked_master_lead is text (legacy id or new lead number).
      const legacyLeadId = leadId.replace(/^legacy_/, '');
      const numericLeadId = parseInt(legacyLeadId, 10);
      if (Number.isNaN(numericLeadId)) {
        return { success: false, error: 'Invalid legacy lead id' };
      }
      const valueToSave = isLegacyChain ? legacyMasterValue : newMasterLeadNumber;
      if (valueToSave == null || valueToSave === '') {
        return { success: false, error: isLegacyChain ? 'Invalid master lead id' : 'Invalid master lead number' };
      }
      const { error } = await supabase
        .from('leads_lead')
        .update({ linked_master_lead: valueToSave })
        .eq('id', numericLeadId);
      if (error) {
        console.error('Error linking legacy lead to chain via linked_master_lead:', error);
        return { success: false, error: error.message };
      }
      return { success: true };
    }

    // Sublead is new: update leads table. linked_master_lead is text (legacy id or new lead number).
    const valueToSave = isLegacyChain ? legacyMasterValue : newMasterLeadNumber;
    if (valueToSave == null || valueToSave === '') {
      return { success: false, error: isLegacyChain ? 'Invalid master lead id' : 'Invalid master lead number' };
    }
    const { error: subError } = await supabase
      .from('leads')
      .update({ linked_master_lead: valueToSave })
      .eq('id', leadId);
    if (subError) {
      console.error('Error linking new lead to chain via linked_master_lead:', subError);
      return { success: false, error: subError.message };
    }

    // If master is new: set master row's linked_master_lead to its own lead number (chain root).
    if (!isLegacyChain) {
      const masterIdRaw = masterLeadInfo?.id;
      const isUuid = typeof masterIdRaw === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(masterIdRaw);
      let masterRowId: string | null = isUuid && masterIdRaw ? String(masterIdRaw) : null;
      if (!masterRowId) {
        const linkedMasterValues = [newMasterLeadNumber, base, `${newMasterLeadNumber}/1`, `${base}/1`].filter(Boolean);
        const uniqueValues = [...new Set(linkedMasterValues)];
        const { data: masterRows } = await supabase
          .from('leads')
          .select('id')
          .in('lead_number', uniqueValues)
          .limit(1);
        masterRowId = masterRows?.[0]?.id ? String(masterRows[0].id) : null;
      }
      if (masterRowId) {
        const { error: masterError } = await supabase
          .from('leads')
          .update({ linked_master_lead: newMasterLeadNumber })
          .eq('id', masterRowId);
        if (masterError) {
          console.error('Error setting master linked_master_lead:', masterError);
        }
      }
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to link lead to chain';
    console.error('linkLeadToChain error:', err);
    return { success: false, error: message };
  }
}

/**
 * Break the link for one or more linked-only leads (clear linked_master_lead).
 * Only affects leads that were linked via linked_master_lead; does not change sublead (master_id) logic.
 */
export async function breakLinkedLeads(
  items: { id: string; type: 'new' | 'legacy' }[]
): Promise<{ success: boolean; error?: string }> {
  if (!items.length) {
    return { success: true };
  }
  try {
    for (const item of items) {
      if (item.type === 'legacy') {
        const legacyId = item.id.replace(/^legacy_/, '');
        const numericId = parseInt(legacyId, 10);
        if (Number.isNaN(numericId)) continue;
        const { error } = await supabase
          .from('leads_lead')
          .update({ linked_master_lead: null })
          .eq('id', numericId);
        if (error) {
          console.error('Error breaking legacy link:', error);
          return { success: false, error: error.message };
        }
      } else {
        const { error } = await supabase
          .from('leads')
          .update({ linked_master_lead: null })
          .eq('id', item.id);
        if (error) {
          console.error('Error breaking new lead link:', error);
          return { success: false, error: error.message };
        }
      }
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to break link';
    console.error('breakLinkedLeads error:', err);
    return { success: false, error: message };
  }
}
