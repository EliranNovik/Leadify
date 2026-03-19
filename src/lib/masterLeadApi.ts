import { supabase } from './supabase';
import { getStageName } from './stageUtils';

export interface SubLead {
  id: string;
  lead_number: string;
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

// Helper function to format lead number for legacy leads
export const formatLegacyLeadNumber = (legacyLead: any, subLeadSuffix?: number, hasSubLeads: boolean = false): string => {
  const masterId = legacyLead.master_id;
  const leadId = String(legacyLead.id);

  if (!masterId || String(masterId).trim() === '') {
    return hasSubLeads ? `${leadId}/1` : leadId;
  }

  if (subLeadSuffix !== undefined) {
    return `${masterId}/${subLeadSuffix}`;
  }

  return `${masterId}/?`;
};

// Helper function to get currency symbol
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
    // Normalized base for linked_master_lead (we save without L/C prefix in linkLeadToChain)
    const normalizedBaseForLinked = normalizeBaseLeadNumber(baseLeadNumber);

    // First, try to find master lead with exact match
    let { data: masterLead, error: masterError } = await supabase
      .from('leads')
      .select('*')
      .eq('lead_number', baseLeadNumber)
      .maybeSingle();

    // If not found, try with /1 suffix (in case master has sub-leads)
    if (!masterLead && !masterError) {
      const { data: masterWithSuffix } = await supabase
        .from('leads')
        .select('*')
        .eq('lead_number', `${baseLeadNumber}/1`)
        .maybeSingle();

      if (masterWithSuffix) {
        masterLead = masterWithSuffix;
      }
    }

    if (masterError) {
      console.error('Error fetching new master lead:', masterError);
    }

    if (!masterLead) {
      return { success: false };
    }

    // Fetch all sub-leads (all leads with baseLeadNumber/ suffix)
    // This will include /1, /2, /3, /4, /5, /6, etc.
    const { data: subLeadsData, error: subLeadsError } = await supabase
      .from('leads')
      .select('*')
      .like('lead_number', `${baseLeadNumber}/%`)
      .order('lead_number', { ascending: true });

    if (subLeadsError) {
      console.error('Error fetching new sub-leads:', subLeadsError);
      return { success: true, masterLead, subLeads: [], error: 'Failed to fetch sub-leads' };
    }

    // Filter out the master lead itself from sub-leads if it appears (shouldn't happen, but just in case)
    const filteredSubLeadsFromPattern = subLeadsData?.filter(lead => {
      const leadNum = String(lead.lead_number || '');
      // Exclude the exact baseLeadNumber match (master lead)
      return leadNum !== baseLeadNumber;
    }) || [];

    // Also include new leads and legacy leads that point to this master via linked_master_lead (text: "L210292" or "210292").
    const linkedMasterValues = [normalizedBaseForLinked, baseLeadNumber].filter(Boolean);
    const [
      { data: linkedSubLeadsData },
      { data: linkedLegacyToNewData }
    ] = await Promise.all([
      supabase.from('leads').select('*').in('linked_master_lead', linkedMasterValues),
      supabase.from('leads_lead').select('*, accounting_currencies!leads_lead_currency_id_fkey (name, iso_code)').in('linked_master_lead', linkedMasterValues)
    ]);

    const linkedSubLeads = (linkedSubLeadsData || []).filter((lead: any) => {
      if (!lead || !lead.id) return false;
      if (masterLead?.id && String(lead.id) === String(masterLead.id)) return false;
      return !filteredSubLeadsFromPattern.some((existing: any) => String(existing.id) === String(lead.id));
    });

    const filteredSubLeads = [...filteredSubLeadsFromPattern, ...linkedSubLeads];

    const leadIdsForContacts = [
      masterLead?.id,
      ...(filteredSubLeads.map((lead: any) => lead.id) || []),
    ].filter(Boolean);

    const leadIdsForContracts = leadIdsForContacts;

    // Fetch main contacts for each lead to get their contracts
    const mainContactsMap = new Map<string, number>(); // leadId -> mainContactId

    // For new leads, fetch main contacts from contacts table and lead_leadcontact
    if (leadIdsForContacts.length > 0) {
      console.log('🔍 Fetching main contacts for leads:', leadIdsForContacts);

      // Fetch from contacts table (new leads structure)
      const { data: contactsData } = await supabase
        .from('contacts')
        .select('id, lead_id, is_main_applicant, relationship')
        .in('lead_id', leadIdsForContacts.map(id => String(id)));

      console.log('🔍 Contacts from contacts table:', contactsData);

      if (contactsData) {
        contactsData.forEach((contact: any) => {
          const isMain = contact.is_main_applicant === true ||
            contact.relationship === 'persecuted_person';
          if (isMain && contact.lead_id) {
            console.log('🔍 Found main contact:', contact.id, 'for lead:', contact.lead_id);
            mainContactsMap.set(String(contact.lead_id), contact.id);
          }
        });
      }

      // Also check lead_leadcontact for main contacts (fallback)
      const { data: leadContacts } = await supabase
        .from('lead_leadcontact')
        .select('newlead_id, contact_id, main')
        .in('newlead_id', leadIdsForContacts.map(id => String(id)))
        .eq('main', 'true');

      console.log('🔍 Main contacts from lead_leadcontact:', leadContacts);

      if (leadContacts) {
        leadContacts.forEach((lc: any) => {
          if (lc.newlead_id && !mainContactsMap.has(String(lc.newlead_id))) {
            console.log('🔍 Found main contact from lead_leadcontact:', lc.contact_id, 'for lead:', lc.newlead_id);
            mainContactsMap.set(String(lc.newlead_id), lc.contact_id);
          }
        });
      }

      console.log('🔍 Final mainContactsMap:', Array.from(mainContactsMap.entries()));
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
      console.log('🔍 Processing new contracts:', newContractsData.length, 'contracts');
      newContractsData.forEach((contract: any) => {
        if (!contract.client_id || !contract.id) return;

        const leadId = String(contract.client_id);
        const mainContactId = mainContactsMap.get(leadId);

        console.log('🔍 Contract:', contract.id, 'for lead:', leadId, 'contact_id:', contract.contact_id, 'mainContactId:', mainContactId);

        // Only assign contract if it belongs to the main contact
        if (contract.contact_id && mainContactId && contract.contact_id === mainContactId) {
          // Only set if we don't already have a contract for this lead, or if this one is more recent/signed
          const existing = newContractsMap.get(leadId);
          if (!existing) {
            console.log('🔍 ✅ Assigning contract', contract.id, 'to lead', leadId);
            newContractsMap.set(leadId, {
              id: contract.id,
              isLegacy: false
            });
          }
        } else if (!contract.contact_id && mainContactId) {
          // Fallback: if no contact_id, assign to main contact (backward compatibility)
          // Only if this lead has a main contact
          const existing = newContractsMap.get(leadId);
          if (!existing) {
            console.log('🔍 ✅ Assigning contract (no contact_id)', contract.id, 'to lead', leadId);
            newContractsMap.set(leadId, {
              id: contract.id,
              isLegacy: false
            });
          }
        } else {
          console.log('🔍 ❌ Skipping contract', contract.id, '- does not match main contact');
        }
      });
      console.log('🔍 Final newContractsMap:', Array.from(newContractsMap.entries()));
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
        actual_lead_id: manualValue || leadNumberValue || String(lead.id),
        manual_id: manualValue,
        name: lead.name || 'Unknown',
        total: totalValue,
        currency: currencyCode,
        currency_symbol: getCurrencySymbol(currencyCode),
        category: categoryName,
        topic: lead.topic || null,
        stage: String(lead.stage),
        contact: contactName,
        applicants: Number(applicantsValue) || 0,
        agreement: null, // Will be set in component
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
      const linkedOnly = !!(lead.linked_master_lead != null && String(lead.linked_master_lead).trim() !== '');
      processedSubLeads.push(formatNewLead(lead, false, false, linkedOnly));
    });

    // Legacy leads linked to this new master (cross-save: legacy sublead → new master)
    (linkedLegacyToNewData || []).forEach((lead: any) => {
      if (!lead || lead.id == null) return;
      const currencyInfo = getCurrencyInfo(lead);
      processedSubLeads.push({
        id: `legacy_${lead.id}`,
        lead_number: String(lead.id),
        actual_lead_id: String(lead.id),
        isLinkedOnly: true,
        manual_id: lead.manual_id,
        name: lead.name || 'Unknown',
        total: getLegacyLeadTotal(lead),
        currency: currencyInfo.currency,
        currency_symbol: currencyInfo.symbol,
        category: getCategoryName(lead.category_id, categories || []),
        topic: lead.topic || null,
        stage: String(lead.stage ?? ''),
        contact: lead.name || '---',
        applicants: parseInt(lead.no_of_applicants) || 0,
        agreement: null,
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

    const { data: masterLead, error: masterError } = await supabase
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
      .single();

    if (masterError) {
      console.error('Error fetching master lead:', masterError);
      return { success: false, error: 'Failed to fetch master lead information' };
    }

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
      .or(`master_id.eq.${baseLeadNumber},master_id.eq.${normalizedId}`)
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
      .eq('linked_master_lead', masterLegacyIdStr);

    // New leads linked to this legacy master (linked_master_lead = legacy id as text)
    const { data: linkedNewToLegacyData } = await supabase
      .from('leads')
      .select('*')
      .eq('linked_master_lead', masterLegacyIdStr);

    const existingIds = new Set((subLeadsData || []).map((l: any) => l.id));
    const linkedLegacySubLeads = (linkedLegacyData || []).filter(
      (l: any) => l?.id != null && !existingIds.has(l.id)
    );
    const allLegacySubLeads = [...(subLeadsData || []), ...linkedLegacySubLeads];

    const allLeadIds = [masterLead?.id, ...allLegacySubLeads.map(lead => lead.id)].filter(Boolean);

    // Fetch main contacts for legacy leads
    const legacyMainContactsMap = new Map<number, number>(); // leadId -> mainContactId

    if (allLeadIds.length > 0) {
      console.log('🔍 Fetching main contacts for legacy leads:', allLeadIds);
      const { data: mainLeadContacts } = await supabase
        .from('lead_leadcontact')
        .select('lead_id, contact_id, main')
        .in('lead_id', allLeadIds)
        .eq('main', 'true');

      console.log('🔍 Main contacts from lead_leadcontact for legacy leads:', mainLeadContacts);

      if (mainLeadContacts) {
        mainLeadContacts.forEach((lc: any) => {
          if (lc.lead_id && lc.contact_id) {
            console.log('🔍 Found main contact:', lc.contact_id, 'for legacy lead:', lc.lead_id);
            legacyMainContactsMap.set(Number(lc.lead_id), lc.contact_id);
          }
        });
      }

      console.log('🔍 Final legacyMainContactsMap:', Array.from(legacyMainContactsMap.entries()));
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
          .select('lead_id, id, contact_id, public_token, contract_html, signed_contract_html')
          .in('lead_id', allLeadIds)
        : Promise.resolve({ data: null, error: null }),
      allLeadIds.length > 0
        ? supabase
          .from('leads_leadstage')
          .select('lead_id, cdate')
          .in('lead_id', allLeadIds)
          .eq('stage', 60)
          .order('cdate', { ascending: false })
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
            console.log('🔍 Fallback main contact for lead', leadId, '-> contact', first.contact_id);
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
        if (contract.contact_id && mainContactId && contract.contact_id === mainContactId) {
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
        }
      });
    }

    // Process legacy contracts (filtered by main contact)
    // This matches ContactInfoTab logic: fetch by lead_id, then filter by main contact's contact_id
    if (legacyContractsData) {
      console.log('🔍 Processing legacy contracts:', legacyContractsData.length, 'contracts');
      legacyContractsData.forEach((lc: any) => {
        const hasContract = (lc.contract_html && lc.contract_html !== '\\N' && lc.contract_html.trim() !== '') ||
          (lc.signed_contract_html && lc.signed_contract_html !== '\\N' && lc.signed_contract_html.trim() !== '');

        if (!lc.lead_id || !lc.id || !hasContract) {
          console.log('🔍 Skipping legacy contract - missing data:', { lead_id: lc.lead_id, id: lc.id, hasContract });
          return;
        }

        const leadId = String(lc.lead_id);
        const mainContactId = legacyMainContactsMap.get(Number(lc.lead_id));

        console.log('🔍 Legacy contract:', lc.id, 'for lead:', leadId, 'contact_id:', lc.contact_id, 'mainContactId:', mainContactId);

        // Assign when this row's contact_id matches the lead's main (or fallback) contact (same as ContactInfoTab)
        if (mainContactId != null && mainContactId === lc.contact_id) {
          const leadIdNum = Number(lc.lead_id);
          const signedDate = signedDatesMap.get(leadIdNum);
          const hasSignedContract = lc.signed_contract_html &&
            lc.signed_contract_html.trim() !== '' &&
            lc.signed_contract_html !== '\\N';
          // When contract has signed content but no stage 60 date, still treat as signed (same as ContactInfoTab)
          const effectiveSignedAt = signedDate ?? (hasSignedContract ? new Date().toISOString() : undefined);

          const existing = contractsMap.get(leadId);

          if (!existing || existing.isLegacy === false) {
            console.log('🔍 ✅ Assigning legacy contract', lc.id, 'to lead', leadId);
            contractsMap.set(leadId, {
              id: `legacy_${lc.id}`,
              isLegacy: true,
              contractHtml: lc.contract_html,
              signedContractHtml: lc.signed_contract_html,
              public_token: lc.public_token,
              signed_at: effectiveSignedAt
            });
          } else {
            console.log('🔍 ⚠️ Legacy contract already exists for lead', leadId, '- keeping existing');
          }
        } else {
          console.log('🔍 ❌ Skipping legacy contract', lc.id, '- does not match main contact');
        }
      });
      console.log('🔍 Final contractsMap after legacy processing:', Array.from(contractsMap.entries()));
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
        actual_lead_id: String(masterLead.id),
        manual_id: masterLead.manual_id,
        name: masterLead.name || 'Unknown',
        total: getLegacyLeadTotal(masterLead),
        currency: currencyInfo.currency,
        currency_symbol: currencyInfo.symbol,
        category: getCategoryName(masterLead.category_id, categories || []),
        topic: masterLead.topic || null,
        stage: String(masterLead.stage),
        contact: getContactInfo(masterLead, contactMap),
        applicants: parseInt(masterLead.no_of_applicants) || 0,
        agreement: null, // Will be set in component
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
        const isLinkedOnly = lead.linked_master_lead != null && (lead.master_id == null || String(lead.master_id).trim() === '');
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
        const isLinkedOnly = lead.linked_master_lead != null && (lead.master_id == null || String(lead.master_id).trim() === '');
        const formattedLeadNumber = isLinkedOnly ? String(lead.id) : formatLegacyLeadNumber(lead, subLeadSuffix, false);
        const displayNumber = lead.stage === 100 ? `C${formattedLeadNumber}` : formattedLeadNumber;
        const currencyInfo = getCurrencyInfo(lead);

        processedSubLeads.push({
          id: `legacy_${lead.id}`,
          lead_number: displayNumber,
          actual_lead_id: String(lead.id),
          isLinkedOnly: isLinkedOnly || undefined,
          manual_id: lead.manual_id,
          name: lead.name || 'Unknown',
          total: getLegacyLeadTotal(lead),
          currency: currencyInfo.currency,
          currency_symbol: currencyInfo.symbol,
          category: getCategoryName(lead.category_id, categories || []),
          topic: lead.topic || null,
          stage: String(lead.stage),
          contact: getContactInfo(lead, contactMap),
          applicants: parseInt(lead.no_of_applicants) || 0,
          agreement: null, // Will be set in component
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

    // New leads linked to this legacy master (cross-save: new sublead → legacy master)
    (linkedNewToLegacyData || []).forEach((lead: any) => {
      if (!lead?.id) return;
      const totalRaw = lead.balance ?? lead.proposal_total ?? 0;
      const totalValue = typeof totalRaw === 'number' ? totalRaw : parseFloat(String(totalRaw)) || 0;
      const currencyCode = (lead.balance_currency || lead.currency || 'NIS') as string;
      const leadNum = lead.lead_number || String(lead.id);
      processedSubLeads.push({
        id: String(lead.id),
        lead_number: leadNum,
        actual_lead_id: leadNum,
        manual_id: lead.manual_id,
        name: lead.name || 'Unknown',
        total: totalValue,
        currency: currencyCode,
        currency_symbol: getCurrencySymbol(currencyCode),
        category: getCategoryName(lead.category_id, categories || []),
        topic: lead.topic || null,
        stage: String(lead.stage ?? ''),
        contact: lead.name || '---',
        applicants: Number(lead.number_of_applicants_meeting ?? lead.number_of_applicants ?? lead.applicants ?? 0) || 0,
        agreement: null,
        scheduler: '---',
        scheduler_id: undefined,
        closer: '---',
        closer_id: undefined,
        handler: '---',
        handler_id: undefined,
        master_id: undefined,
        isMaster: false,
        isLinkedOnly: true,
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

/**
 * Normalize base lead number to the numeric base only (e.g. "6/1" or "L6/1" -> "6")
 * so that "existing" query matches all subleads (6/1, 6/2, ...) and nextSuffix is correct.
 */
function normalizeBaseLeadNumber(baseLeadNumber: string): string {
  const trimmed = (baseLeadNumber || '').trim().replace(/^[LC]/i, '');
  const firstSegment = trimmed.includes('/') ? trimmed.split('/')[0] : trimmed;
  return firstSegment || baseLeadNumber;
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
