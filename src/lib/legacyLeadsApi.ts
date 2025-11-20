import { supabase } from './supabase';

// Interface for legacy leads from leads_lead table
export interface LegacyLead {
  id: bigint;
  cdate: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  topic: string | null;
  stage: bigint | null;
  lead_number: bigint | null;
}

// Interface for new leads from leads table
export interface NewLead {
  id: string;
  lead_number: string;
  name: string;
  email: string;
  phone: string;
  mobile: string;
  topic: string;
  stage: string;
  created_at: string;
}

// Combined interface for unified lead data
export interface CombinedLead {
  id: string;
  lead_number: string;
  manual_id?: string | null;
  name: string;
  email: string;
  phone: string;
  mobile: string;
  topic: string;
  stage: string;
  source: string;
  created_at: string;
  updated_at: string;
  notes: string;
  special_notes: string;
  next_followup: string;
  probability: string;
  category: string;
  language: string;
  balance: string;
  lead_type: 'legacy' | 'new';
  unactivation_reason: string | null;
  deactivate_note: string | null;
  isFuzzyMatch: boolean;
}

// Search cache to avoid repeated queries
const searchCache = new Map<string, { results: CombinedLead[], timestamp: number }>();
const CACHE_DURATION = 30000; // 30 seconds cache

// Short-term incremental cache
let lastQueryNormalized = '';
let lastResults: CombinedLead[] = [];

const normalizeValue = (value: string | null | undefined): string =>
  (value || '').toLowerCase();

const digitsFromValue = (value: string | null | undefined): string =>
  (value || '').replace(/\D/g, '');

const resultMatchesQuery = (
  result: CombinedLead,
  normalizedQuery: string,
  queryWords: string[],
  digitsOnly: string,
): boolean => {
  const name = normalizeValue(result.name);
  const email = normalizeValue(result.email);
  const topic = normalizeValue(result.topic);
  const leadNumber = normalizeValue(result.lead_number);
  const phone = normalizeValue(result.phone);
  const mobile = normalizeValue(result.mobile);

  const fields = [name, email, topic, leadNumber, phone, mobile];

  if (fields.some(field => field === normalizedQuery)) return true;
  if (fields.some(field => field.startsWith(normalizedQuery))) return true;
  if (fields.some(field => field.includes(normalizedQuery))) return true;

  if (queryWords.length > 1) {
    const combinedFields = [name, topic];
    if (combinedFields.some(field => queryWords.every(word => field.includes(word)))) {
      return true;
    }
  }

  if (digitsOnly) {
    const fieldDigits = [
      digitsFromValue(result.lead_number),
      digitsFromValue(result.phone),
      digitsFromValue(result.mobile),
    ];
    if (fieldDigits.some(value => value.includes(digitsOnly))) {
      return true;
    }
  }

  return false;
};

const splitValues = (value: string | null | undefined): string[] =>
  value
    ? value
        .split(/[\s,;|\n\r]+/)
        .map(v => v.trim())
        .filter(Boolean)
    : [];

const firstNonEmpty = (...values: Array<string | null | undefined>): string | null => {
  for (const value of values) {
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

interface LegacyContactInfo {
  name?: string | null;
  email?: string | null;
  additionalEmails: string[];
  phone?: string | null;
  mobile?: string | null;
  additionalPhones: string[];
}

// Clear cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of searchCache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      searchCache.delete(key);
    }
  }
}, 60000); // Clean cache every minute

// Fetch a single lead by ID (works for both legacy and new leads)
export async function fetchLeadById(leadId: string): Promise<CombinedLead | null> {
  try {
    // Check if it's a legacy lead ID
    if (leadId.startsWith('legacy_')) {
      const numericId = leadId.replace('legacy_', '');
      const { data, error } = await supabase
        .from('leads_lead')
        .select(`
          id, 
          name, 
          email, 
          phone, 
          mobile, 
          topic, 
          stage, 
          cdate,
          lead_stages(name)
        `)
        .eq('id', numericId)
        .single();

      if (error || !data) {
        console.error('Error fetching legacy lead:', error);
        return null;
      }

      return {
        id: `legacy_${data.id}`,
        lead_number: String(data.id),
        name: data.name || '',
        email: data.email || '',
        phone: data.phone || '',
        mobile: data.mobile || '',
        topic: data.topic || '',
        stage: ((data as any).lead_stages as any)?.[0]?.name || String(data.stage || ''),
        source: '',
        created_at: data.cdate || '',
        updated_at: data.cdate || '',
        notes: '',
        special_notes: '',
        next_followup: '',
        probability: '',
        category: '',
        language: '',
        balance: '',
        lead_type: 'legacy',
        unactivation_reason: null,
        deactivate_note: null,
        isFuzzyMatch: false,
      };
    } else {
      // It's a new lead ID
      const { data, error } = await supabase
        .from('leads')
        .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
        .eq('id', leadId)
        .single();

      if (error || !data) {
        console.error('Error fetching new lead:', error);
        return null;
      }

      return {
        id: data.id,
        lead_number: data.lead_number || '',
        name: data.name || '',
        email: data.email || '',
        phone: data.phone || '',
        mobile: data.mobile || '',
        topic: data.topic || '',
        stage: data.stage || '',
        source: '',
        created_at: data.created_at || '',
        updated_at: data.created_at || '',
        notes: '',
        special_notes: '',
        next_followup: '',
        probability: '',
        category: '',
        language: '',
        balance: '',
        lead_type: 'new',
        unactivation_reason: null,
        deactivate_note: null,
        isFuzzyMatch: false,
      };
    }
  } catch (error) {
    console.error('Error fetching lead by ID:', error);
    return null;
  }
}

// Fetch all leads (both new and legacy) - used for client listing
export async function fetchAllLeads(): Promise<CombinedLead[]> {
  try {
    const results: CombinedLead[] = [];
    
    // Fetch new leads only (legacy leads are too slow)
    try {
      const { data: newLeads, error: newError } = await supabase
        .from('leads')
        .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
        .order('created_at', { ascending: false })
        .limit(1000); // Limit to prevent memory issues
      
      if (!newError && newLeads) {
        const transformedNewLeads: CombinedLead[] = newLeads.map((lead: any) => ({
          id: lead.id,
          lead_number: lead.lead_number || '',
          name: lead.name || '',
          email: lead.email || '',
          phone: lead.phone || '',
          mobile: lead.mobile || '',
          topic: lead.topic || '',
          stage: lead.stage || '',
          source: '',
          created_at: lead.created_at || '',
          updated_at: lead.created_at || '',
          notes: '',
          special_notes: '',
          next_followup: '',
          probability: '',
          category: '',
          language: '',
          balance: '',
          lead_type: 'new' as const,
          unactivation_reason: null,
          deactivate_note: null,
          isFuzzyMatch: false,
        }));
        results.push(...transformedNewLeads);
      }
    } catch (newError) {
      console.error('Error fetching new leads:', newError);
      // Continue even if new leads fail
    }
    
    // Sort by creation date (newest first)
    return results.sort((a, b) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    
  } catch (error) {
    console.error('Error fetching all leads:', error);
    return [];
  }
}

// Fast search function - searches both new and legacy leads in parallel
export async function searchLeads(query: string): Promise<CombinedLead[]> {
  try {
    // Don't search if query is too short
    if (!query || query.trim().length < 2) {
      return [];
    }

    const trimmedQuery = query.trim();
    const normalizedQuery = trimmedQuery.toLowerCase();
    const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);
    
    // Strip "L" or "C" prefix if present (e.g., "L164084" -> "164084", "C164084" -> "164084")
    const numericQuery = trimmedQuery.replace(/^[LC]/i, '');
    const digitsOnly = numericQuery.replace(/\D/g, '');
    const lastFiveDigits = digitsOnly.slice(-5);
    
    // Check if the original numericQuery (after stripping L/C) is a pure number
    // This helps distinguish between "164084" (pure number = lead number) 
    // and "1640849" or "164084 something" (contains digits but not pure number)
    const hasOnlyDigits = /^\d+$/.test(numericQuery);
    
    // Detect if original query has L or C prefix (for exact matching in new leads)
    const hasLPrefix = /^L/i.test(trimmedQuery);
    const hasCPrefix = /^C/i.test(trimmedQuery);
    const isPrefixedNumeric = /^[A-Za-z]{1,3}\d+$/.test(trimmedQuery);
    const uppercaseQuery = trimmedQuery.toUpperCase();
    const lowercaseQuery = trimmedQuery.toLowerCase();

    // Check cache first
    const cacheKey = trimmedQuery.toLowerCase();
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      console.log('[searchLeads] Using cached results', { count: cached.results.length });
      return cached.results;
    }

    if (lastResults.length && lastQueryNormalized && normalizedQuery.startsWith(lastQueryNormalized)) {
      const filtered = lastResults.filter(result =>
        resultMatchesQuery(result, normalizedQuery, queryWords, digitsOnly)
      );
      if (filtered.length > 0) {
        console.log('[searchLeads] Returning filtered results from incremental cache', { count: filtered.length });
        searchCache.set(cacheKey, { results: filtered, timestamp: Date.now() });
        lastQueryNormalized = normalizedQuery;
        lastResults = filtered;
        return filtered;
      }
    }

    // Check if query looks like an email (contains @)
    const isEmailQuery = trimmedQuery.includes('@');
    
    // Check if query is a pure number - we'll search BOTH lead_number AND phone fields
    const isNumericQuery = hasOnlyDigits && numericQuery.length > 0;
    
    // For numeric queries, we search both lead_number/id AND phone fields
    // No need to distinguish - search everything!

    console.log('[searchLeads] Query received', { raw: query, trimmedQuery, numericQuery, isNumericQuery, isEmailQuery, digitsOnly, lastFiveDigits });

    const newLeadsPromise = (async () => {
      let newQuery = supabase
        .from('leads')
        .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
        .limit(10);
      
      if (isNumericQuery) {
        const leadNumberFilters = new Set<string>();
        leadNumberFilters.add(`lead_number.eq.${trimmedQuery}`);
        leadNumberFilters.add(`lead_number.eq.${numericQuery}`);
        if (uppercaseQuery !== trimmedQuery) {
          leadNumberFilters.add(`lead_number.eq.${uppercaseQuery}`);
        }
        if (lowercaseQuery !== trimmedQuery) {
          leadNumberFilters.add(`lead_number.eq.${lowercaseQuery}`);
        }
        if (!hasLPrefix && !hasCPrefix) {
          leadNumberFilters.add(`lead_number.eq.L${numericQuery}`);
          leadNumberFilters.add(`lead_number.eq.C${numericQuery}`);
        }

        leadNumberFilters.add(`lead_number.ilike.%${trimmedQuery}%`);
        leadNumberFilters.add(`lead_number.ilike.%${numericQuery}%`);
        if (digitsOnly && digitsOnly !== numericQuery) {
          leadNumberFilters.add(`lead_number.ilike.%${digitsOnly}%`);
        }

        const includePhoneSearch = digitsOnly.length >= 5 && !isPrefixedNumeric;
        const phoneSearch = includePhoneSearch
          ? [
              `phone.ilike.%${lastFiveDigits}%`,
              `mobile.ilike.%${lastFiveDigits}%`,
            ]
          : [];

        if (!includePhoneSearch && digitsOnly && digitsOnly !== numericQuery) {
          leadNumberFilters.add(`lead_number.eq.${digitsOnly}`);
        }

        const filterParts = [...leadNumberFilters, ...phoneSearch];
        return await newQuery.or(filterParts.join(','));
      }

      if (isEmailQuery) {
        return await newQuery.ilike('email', `%${trimmedQuery}%`);
      }

      const conditions = new Set<string>([
        `name.ilike.${trimmedQuery}`,
        `name.ilike.${trimmedQuery}%`,
        `name.ilike.%${trimmedQuery}%`,
        `topic.ilike.${trimmedQuery}`,
        `topic.ilike.${trimmedQuery}%`,
        `topic.ilike.%${trimmedQuery}%`,
        `lead_number.ilike.${trimmedQuery}`,
        `lead_number.ilike.${trimmedQuery}%`,
        `lead_number.ilike.%${trimmedQuery}%`,
      ]);

      if (!hasLPrefix && !hasCPrefix) {
        conditions.add(`lead_number.ilike.L${numericQuery}%`);
        conditions.add(`lead_number.ilike.C${numericQuery}%`);
      }

      if (queryWords.length > 1) {
        queryWords.forEach(word => conditions.add(`name.ilike.%${word}%`));
      }

      if (digitsOnly.length >= 5 && !isPrefixedNumeric) {
        conditions.add(`phone.ilike.%${digitsOnly}%`);
        conditions.add(`mobile.ilike.%${digitsOnly}%`);
      }

      return await newQuery.or(Array.from(conditions).join(','));
    })();

    const [newResponse, legacyResults] = await Promise.all([
      newLeadsPromise,
      searchLegacyLeads(trimmedQuery),
    ]);
    
    // Process results from both tables
    const results: CombinedLead[] = [];
    
    // Process new leads
    if (!newResponse.error && newResponse.data) {
      const transformedNewLeads: CombinedLead[] = newResponse.data.map((lead: any) => ({
        id: lead.id,
        lead_number: lead.lead_number || '',
        manual_id: lead.lead_number || null,
        name: lead.name || '',
        email: lead.email || '',
        phone: lead.phone || '',
        mobile: lead.mobile || '',
        topic: lead.topic || '',
        stage: lead.stage || '',
        source: '',
        created_at: lead.created_at || '',
        updated_at: lead.created_at || '',
        notes: '',
        special_notes: '',
        next_followup: '',
        probability: '',
        category: '',
        language: '',
        balance: '',
        lead_type: 'new' as const,
        unactivation_reason: null,
        deactivate_note: null,
        isFuzzyMatch: false,
      }));
      results.push(...transformedNewLeads);
    }
    
    // Process legacy leads
    if (Array.isArray(legacyResults) && legacyResults.length > 0) {
      results.push(...legacyResults);
    }
    
    // Remove duplicates (keep first occurrence)
    const uniqueResults = results.filter((lead, index, self) => 
      index === self.findIndex(l => l.id === lead.id)
    );
    
    searchCache.set(cacheKey, { results: uniqueResults, timestamp: Date.now() });
    lastQueryNormalized = normalizedQuery;
    lastResults = uniqueResults;

    console.log('[searchLeads] Returning results', { count: uniqueResults.length, new: newResponse.data?.length || 0, legacy: legacyResults.length || 0 });
    return uniqueResults;

  } catch (error) {
    console.error('Error searching leads:', error);
    return [];
  }
}

// Separate function to search legacy leads (call this separately if needed)
export async function searchLegacyLeads(query: string): Promise<CombinedLead[]> {
  try {
    // Don't search if query is too short
    if (!query || query.trim().length < 2) {
      return [];
    }

    const trimmedQuery = query.trim();
    const digitsOnly = trimmedQuery.replace(/\D/g, '');
    const suffixDigitsMatch = trimmedQuery.match(/[0-9]+$/);
    const normalizedNumeric = suffixDigitsMatch ? suffixDigitsMatch[0] : '';
    const isNumericQuery = normalizedNumeric.length > 0;
    const isEmailQuery = trimmedQuery.includes('@');
    const leadNumberLike = /^[a-zA-Z]{0,2}\d+$/.test(trimmedQuery);
    const shouldSearchPhones = digitsOnly.length >= 5 && !leadNumberLike && !isEmailQuery;
    const shouldSearchContactNames = !isNumericQuery && !isEmailQuery;

    console.log('[searchLegacyLeads] Searching legacy leads', {
      trimmedQuery,
      normalizedNumeric,
      digitsOnly,
      isNumericQuery,
      isEmailQuery,
      shouldSearchPhones,
    });

    const contactInfoMap = new Map<number, LegacyContactInfo>();
    const contactLeadIds = new Set<number>();

    const primaryMatches: any[] = [];

    if (isNumericQuery && normalizedNumeric) {
      const numericValue = parseInt(normalizedNumeric, 10);
      const exactFilters: string[] = [];

      if (!Number.isNaN(numericValue)) {
        exactFilters.push(`id.eq.${numericValue}`);
        exactFilters.push(`lead_number.eq.${numericValue}`);
      }

      if (trimmedQuery !== normalizedNumeric && /^\d+$/.test(trimmedQuery)) {
        exactFilters.push(`lead_number.eq.${trimmedQuery}`);
      }

      if (exactFilters.length > 0) {
        const { data: directRows, error: directError } = await supabase
          .from('leads_lead')
          .select(
            'id, manual_id, lead_number, name, topic, email, additional_emails, phone, mobile, additional_phones, stage, cdate'
          )
          .or(exactFilters.join(','))
          .limit(10);

        if (directError) {
          console.warn('[searchLegacyLeads] Direct numeric lookup error', directError);
        } else if (directRows) {
          primaryMatches.push(...directRows);
          directRows.forEach(row => contactLeadIds.add(row.id));
        }
      }
    }

    const normalizePattern = (value: string) =>
      value
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .join('%');

    const contactFilters: string[] = [];
    if (isEmailQuery) {
      contactFilters.push(`leads_contact.email.ilike.%${trimmedQuery}%`);
      contactFilters.push(`leads_contact.additional_emails.ilike.%${trimmedQuery}%`);
    } else if (shouldSearchPhones) {
      const lastFiveDigits = digitsOnly.slice(-5);
      contactFilters.push(`leads_contact.phone.ilike.%${lastFiveDigits}%`);
      contactFilters.push(`leads_contact.mobile.ilike.%${lastFiveDigits}%`);
      contactFilters.push(`leads_contact.additional_phones.ilike.%${lastFiveDigits}%`);
    } else if (shouldSearchContactNames && trimmedQuery.length >= 2) {
      const wildcardQuery = normalizePattern(trimmedQuery);
      contactFilters.push(`leads_contact.name.ilike.%${wildcardQuery}%`);
      const nameWords = trimmedQuery.split(/\s+/).filter(Boolean);
      if (nameWords.length > 1) {
        nameWords.forEach(word => contactFilters.push(`leads_contact.name.ilike.%${word}%`));
      }
    }

    if (contactFilters.length > 0) {
      const { data: contactMatches, error: contactError } = await supabase
        .from('lead_leadcontact')
        .select(`
          lead_id,
          main,
          leads_contact (
            name,
            email,
            phone,
            mobile,
            additional_emails,
            additional_phones
          )
        `)
        .eq('main', 'true')
        .or(contactFilters.join(','))
        .limit(50);

      if (contactError) {
        console.warn('[searchLegacyLeads] Contact search error', contactError);
      } else if (contactMatches) {
        contactMatches.forEach(match => {
          const leadId = match.lead_id;
          const contactData = Array.isArray(match.leads_contact)
            ? match.leads_contact[0]
            : match.leads_contact;

          if (!leadId || !contactData) return;

          contactLeadIds.add(leadId);
          contactInfoMap.set(leadId, {
            name: contactData.name,
            email: contactData.email,
            additionalEmails: splitValues(contactData.additional_emails),
            phone: contactData.phone,
            mobile: contactData.mobile,
            additionalPhones: splitValues(contactData.additional_phones),
          });
        });
      }
    }

    const MAX_RESULTS = 20;

    let legacyQuery = supabase
      .from('leads_lead')
      .select(
        'id, manual_id, lead_number, name, topic, email, additional_emails, phone, mobile, additional_phones, stage, cdate'
      )
      .order('cdate', { ascending: false })
      .limit(MAX_RESULTS);

    try {
      if (isNumericQuery && normalizedNumeric) {
        const numericValue = parseInt(normalizedNumeric, 10);
        const numericFilters = new Set<string>();

        if (!Number.isNaN(numericValue)) {
          numericFilters.add(`id.eq.${numericValue}`);
          numericFilters.add(`lead_number.eq.${numericValue}`);
        }

        if (shouldSearchPhones) {
          const lastFiveDigits = digitsOnly.slice(-5);
          numericFilters.add(`phone.ilike.%${lastFiveDigits}%`);
          numericFilters.add(`mobile.ilike.%${lastFiveDigits}%`);
          numericFilters.add(`additional_phones.ilike.%${lastFiveDigits}%`);
        }

        if (numericFilters.size > 0) {
          legacyQuery = legacyQuery.or(Array.from(numericFilters).join(','));
        }
      } else if (isEmailQuery) {
        legacyQuery = legacyQuery.or(
          [`email.ilike.%${trimmedQuery}%`, `additional_emails.ilike.%${trimmedQuery}%`].join(',')
        );
      } else if (shouldSearchPhones) {
        const lastFiveDigits = digitsOnly.slice(-5);
        legacyQuery = legacyQuery.or(
          [
            `phone.ilike.%${lastFiveDigits}%`,
            `mobile.ilike.%${lastFiveDigits}%`,
            `additional_phones.ilike.%${lastFiveDigits}%`,
          ].join(',')
        );
      } else {
        const wildcardQuery = normalizePattern(trimmedQuery);
        const textFilters = new Set<string>([
          `name.ilike.%${wildcardQuery}%`,
          `topic.ilike.%${wildcardQuery}%`,
        ]);

        const words = trimmedQuery.split(/\s+/).filter(Boolean);
        if (words.length > 1) {
          words.forEach(word => textFilters.add(`name.ilike.%${word}%`));
        }

        legacyQuery = legacyQuery.or(Array.from(textFilters).join(','));
      }
    } catch (error) {
      console.warn('[searchLegacyLeads] Error building legacy query', error);
    }

    const { data: baseRows, error: baseError } = await legacyQuery;
    if (baseError) {
      console.error('[searchLegacyLeads] Base legacy query error', baseError);
    }

    const baseResults = [...primaryMatches, ...(baseRows || [])];
    const baseIds = new Set<number>(baseResults.map(row => row.id));

    // Fetch additional leads that matched contact filters but were missing from the base query
    const missingContactLeadIds = Array.from(contactLeadIds).filter(id => !baseIds.has(id));
    let contactRows: any[] = [];

    if (missingContactLeadIds.length > 0) {
      const { data: extraRows, error: extraError } = await supabase
        .from('leads_lead')
        .select(
          'id, manual_id, lead_number, name, topic, email, additional_emails, phone, mobile, additional_phones, stage, cdate'
        )
        .in('id', missingContactLeadIds.slice(0, MAX_RESULTS))
        .limit(MAX_RESULTS);

      if (extraError) {
        console.warn('[searchLegacyLeads] Error fetching contact-only leads', extraError);
      } else if (extraRows) {
        contactRows = extraRows;
      }
    }

    const combinedMap = new Map<number, any>();
    [...baseResults, ...contactRows].forEach(row => {
      if (!combinedMap.has(row.id)) {
        combinedMap.set(row.id, row);
      }
    });

    if (combinedMap.size === 0) {
      return [];
    }

    const combinedRows = Array.from(combinedMap.values()).slice(0, MAX_RESULTS);
    const combinedResults: CombinedLead[] = combinedRows.map(row => {
      const contactInfo = contactInfoMap.get(row.id) || null;

      const leadAdditionalEmails = splitValues(row.additional_emails);
      const leadAdditionalPhones = splitValues(row.additional_phones);

      const allEmails = [
        row.email,
        ...leadAdditionalEmails,
        contactInfo?.email,
        ...(contactInfo?.additionalEmails || []),
      ].filter(Boolean) as string[];

      const allPhones = [
        row.mobile,
        row.phone,
        ...leadAdditionalPhones,
        contactInfo?.mobile,
        contactInfo?.phone,
        ...(contactInfo?.additionalPhones || []),
      ].filter(Boolean) as string[];

      const primaryMobile =
        firstNonEmpty(row.mobile, contactInfo?.mobile, contactInfo?.phone, allPhones[0]) || '';
      const primaryPhone =
        firstNonEmpty(
          row.phone,
          contactInfo?.phone,
          allPhones.find(value => value !== primaryMobile)
        ) || primaryMobile;

      const leadNumber =
        row.lead_number != null ? String(row.lead_number) : row.id != null ? String(row.id) : '';

      return {
        id: `legacy_${row.id}`,
        lead_number: leadNumber,
        manual_id: row.manual_id ? String(row.manual_id) : null,
        name: row.name || contactInfo?.name || '',
        email: allEmails[0] || '',
        phone: primaryPhone,
        mobile: primaryMobile,
        topic: row.topic || '',
        stage: String(row.stage || ''),
        source: '',
        created_at: row.cdate || '',
        updated_at: row.cdate || '',
        notes: '',
        special_notes: '',
        next_followup: '',
        probability: '',
        category: '',
        language: '',
        balance: '',
        lead_type: 'legacy' as const,
        unactivation_reason: null,
        deactivate_note: null,
        isFuzzyMatch: false,
      };
    });

    combinedResults.sort((a, b) => {
      const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bDate - aDate;
    });

    console.log('[searchLegacyLeads] Legacy results count', combinedResults.length);
    return combinedResults;
  } catch (error) {
    console.error('Error searching legacy leads:', error);
    return [];
  }
}