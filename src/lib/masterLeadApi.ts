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
  agreement?: any; // Will be React node, but we'll handle it in component
  docs_url?: string;
  scheduler?: string;
  closer?: string;
  handler?: string;
  master_id?: string;
  isMaster?: boolean;
  route?: string;
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
    const { data: masterLead, error: masterError } = await supabase
      .from('leads')
      .select('*')
      .eq('lead_number', baseLeadNumber)
      .maybeSingle();

    if (masterError) {
      console.error('Error fetching new master lead:', masterError);
    }

    if (!masterLead) {
      return { success: false };
    }

    const { data: subLeadsData, error: subLeadsError } = await supabase
      .from('leads')
      .select('*')
      .like('lead_number', `${baseLeadNumber}/%`)
      .order('lead_number', { ascending: true });

    if (subLeadsError) {
      console.error('Error fetching new sub-leads:', subLeadsError);
      return { success: true, masterLead, subLeads: [], error: 'Failed to fetch sub-leads' };
    }

    const leadIdsForContacts = [
      masterLead?.id,
      ...(subLeadsData?.map((lead: any) => lead.id) || []),
    ].filter(Boolean);

    const leadIdsForContracts = leadIdsForContacts;

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
      leadIdsForContracts.length > 0
        ? supabase
          .from('contracts')
          .select('id, client_id')
          .in('client_id', leadIdsForContracts.map(id => String(id)))
        : Promise.resolve({ data: null, error: null })
    ]);

    const stageNameLookup = new Map<string, string>();
    stageDefinitions?.forEach(stage => {
      if (stage?.id !== undefined && stage?.id !== null) {
        stageNameLookup.set(String(stage.id), stage.name || String(stage.id));
      }
    });

    const employeeMap = new Map<number, string>();
    employees?.forEach(emp => {
      if (emp.id && emp.display_name) {
        employeeMap.set(emp.id, emp.display_name);
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

    const newContractsMap = new Map<string, { id: string; isLegacy: boolean }>();
    if (newContractsData) {
      newContractsData.forEach((contract: any) => {
        if (contract.client_id && contract.id) {
          newContractsMap.set(String(contract.client_id), {
            id: contract.id,
            isLegacy: false
          });
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

    const formatNewLead = (lead: any, isMaster: boolean, hasSubLeads: boolean = false): SubLead => {
      let leadNumberValue = lead.lead_number || baseLeadNumber;
      if (isMaster && hasSubLeads && !leadNumberValue.includes('/')) {
        leadNumberValue = `${leadNumberValue}/1`;
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
      const schedulerIdValue = lead.meeting_scheduler_id || lead.scheduler_id;
      if (schedulerIdValue) {
        const schedulerIdNum = typeof schedulerIdValue === 'string' ? parseInt(schedulerIdValue, 10) : schedulerIdValue;
        if (!isNaN(schedulerIdNum) && employeeMap.has(schedulerIdNum)) {
          schedulerName = employeeMap.get(schedulerIdNum)!;
        }
      }
      if (schedulerName === '---') {
        const schedulerText = lead.scheduler || lead.meeting_scheduler;
        if (schedulerText) {
          const schedulerTextNum = typeof schedulerText === 'string' ? parseInt(schedulerText.trim(), 10) : NaN;
          if (!isNaN(schedulerTextNum) && employeeMap.has(schedulerTextNum)) {
            schedulerName = employeeMap.get(schedulerTextNum)!;
          } else {
            schedulerName = schedulerText;
          }
        }
      }

      // Map closer
      let closerName = '---';
      const closerIdValue = lead.closer_id || lead.meeting_closer_id;
      if (closerIdValue) {
        const closerIdNum = typeof closerIdValue === 'string' ? parseInt(closerIdValue, 10) : closerIdValue;
        if (!isNaN(closerIdNum) && employeeMap.has(closerIdNum)) {
          closerName = employeeMap.get(closerIdNum)!;
        }
      }
      if (closerName === '---') {
        const closerText = lead.closer || lead.meeting_closer;
        if (closerText) {
          const closerTextNum = typeof closerText === 'string' ? parseInt(closerText.trim(), 10) : NaN;
          if (!isNaN(closerTextNum) && employeeMap.has(closerTextNum)) {
            closerName = employeeMap.get(closerTextNum)!;
          } else {
            closerName = closerText;
          }
        }
      }

      // Map handler
      let handlerName = '---';
      const handlerIdValue = lead.case_handler_id || lead.handler_id;
      if (handlerIdValue) {
        const handlerIdNum = typeof handlerIdValue === 'string' ? parseInt(handlerIdValue, 10) : handlerIdValue;
        if (!isNaN(handlerIdNum) && employeeMap.has(handlerIdNum)) {
          handlerName = employeeMap.get(handlerIdNum)!;
        }
      }
      if (handlerName === '---') {
        const handlerText = lead.handler || lead.case_handler;
        if (handlerText) {
          const handlerTextNum = typeof handlerText === 'string' ? parseInt(handlerText.trim(), 10) : NaN;
          if (!isNaN(handlerTextNum) && employeeMap.has(handlerTextNum)) {
            handlerName = employeeMap.get(handlerTextNum)!;
          } else {
            handlerName = handlerText;
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
        closer: closerName,
        handler: handlerName,
        master_id: lead.master_id || baseLeadNumber,
        isMaster,
        route: buildClientRoute(manualValue, routeLeadNumber),
      };
    };

    const hasSubLeads = subLeadsData && subLeadsData.length > 0;
    processedSubLeads.push(formatNewLead(masterLead, true, hasSubLeads));
    subLeadsData?.forEach((lead: any) => processedSubLeads.push(formatNewLead(lead, false, false)));

    processedSubLeads.sort((a, b) => {
      if (a.isMaster && !b.isMaster) return -1;
      if (!a.isMaster && b.isMaster) return 1;
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

    const allLeadIds = [masterLead?.id, ...(subLeadsData?.map(lead => lead.id) || [])].filter(Boolean);

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
      allLeadIds.length > 0
        ? supabase
          .from('contracts')
          .select('id, legacy_id')
          .in('legacy_id', allLeadIds)
          .order('created_at', { ascending: false })
        : Promise.resolve({ data: null, error: null }),
      allLeadIds.length > 0
        ? supabase
          .from('lead_leadcontact')
          .select('lead_id, id, public_token, contract_html, signed_contract_html')
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

    const contractsMap = new Map<string, ContractData>();

    if (contractsData) {
      contractsData.forEach((contract: any) => {
        if (contract.legacy_id && contract.id) {
          contractsMap.set(String(contract.legacy_id), {
            id: contract.id,
            isLegacy: false
          });
        }
      });
    }

    if (legacyContractsData) {
      legacyContractsData.forEach((lc: any) => {
        const hasContract = (lc.contract_html && lc.contract_html !== '\\N' && lc.contract_html.trim() !== '') ||
          (lc.signed_contract_html && lc.signed_contract_html !== '\\N' && lc.signed_contract_html.trim() !== '');

        if (lc.lead_id && lc.id && hasContract && !contractsMap.has(String(lc.lead_id))) {
          const leadIdNum = Number(lc.lead_id);
          const signedDate = signedDatesMap.get(leadIdNum);

          contractsMap.set(String(lc.lead_id), {
            id: `legacy_${lc.id}`,
            isLegacy: true,
            contractHtml: lc.contract_html,
            signedContractHtml: lc.signed_contract_html,
            public_token: lc.public_token,
            signed_at: signedDate
          });
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
    employees?.forEach(emp => employeeMap.set(String(emp.id), emp.display_name));

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
      const hasSubLeads = subLeadsData && subLeadsData.length > 0;
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
        closer: (() => {
          const closer = Array.isArray(masterLead.closer) ? masterLead.closer[0] : masterLead.closer;
          return (closer as any)?.display_name || '---';
        })(),
        handler: (() => {
          const handler = Array.isArray(masterLead.handler) ? masterLead.handler[0] : masterLead.handler;
          return (handler as any)?.display_name || '---';
        })(),
        master_id: masterLead.master_id,
        isMaster: true,
        route: `/clients/${masterLead.id}`
      });
    }

    if (subLeadsData) {
      const subLeadsWithSuffix = subLeadsData.map((lead) => {
        let subLeadSuffix: number | undefined;
        if (lead.master_id) {
          const sameMasterLeads = subLeadsData.filter(l => l.master_id === lead.master_id);
          const sortedSameMaster = [...sameMasterLeads].sort((a, b) => a.id - b.id);
          const currentIndex = sortedSameMaster.findIndex(l => l.id === lead.id);
          subLeadSuffix = currentIndex >= 0 ? currentIndex + 2 : sameMasterLeads.length + 2;
        }
        return { lead, subLeadSuffix };
      });

      subLeadsWithSuffix.forEach(({ lead, subLeadSuffix }) => {
        const formattedLeadNumber = formatLegacyLeadNumber(lead, subLeadSuffix, false);
        const displayNumber = lead.stage === 100 ? `C${formattedLeadNumber}` : formattedLeadNumber;
        const currencyInfo = getCurrencyInfo(lead);

        processedSubLeads.push({
          id: `legacy_${lead.id}`,
          lead_number: displayNumber,
          actual_lead_id: String(lead.id),
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
          closer: (() => {
            const closer = Array.isArray(lead.closer) ? lead.closer[0] : lead.closer;
            return (closer as any)?.display_name || '---';
          })(),
          handler: (() => {
            const handler = Array.isArray(lead.handler) ? lead.handler[0] : lead.handler;
            return (handler as any)?.display_name || '---';
          })(),
          master_id: lead.master_id,
          isMaster: false,
          route: `/clients/${lead.id}`
        });
      });
    }

    processedSubLeads.sort((a, b) => {
      if (a.isMaster && !b.isMaster) return -1;
      if (!a.isMaster && b.isMaster) return 1;
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
