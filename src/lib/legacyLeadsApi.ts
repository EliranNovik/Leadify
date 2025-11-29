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
  status?: string | number | null; // For new leads: 'active' | 'inactive', for legacy leads: 1 (active) | 10 (inactive)
  isFuzzyMatch: boolean;
  isContact?: boolean; // True if this result is from a contact (not main contact)
  contactName?: string; // The contact's name if it's a contact
  isMainContact?: boolean; // True if this is the main contact
}

// Search cache to avoid repeated queries
const searchCache = new Map<string, { results: CombinedLead[], timestamp: number }>();
const CACHE_DURATION = 30000; // 30 seconds cache

// Short-term incremental cache
let lastQueryNormalized = '';
let lastResults: CombinedLead[] = [];

// Timeout helper for queries
const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
};

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
        id: String(data.id), // Legacy leads use numeric ID as string, no prefix
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

    // Check cache first - use normalized query as key for consistency
    const cacheKey = normalizedQuery;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.results;
    }

    // Incremental cache: if new query is a continuation of previous query, filter previous results
    if (lastResults.length > 0 && lastQueryNormalized && normalizedQuery.startsWith(lastQueryNormalized) && normalizedQuery.length > lastQueryNormalized.length) {
      const filtered = lastResults.filter(result =>
        resultMatchesQuery(result, normalizedQuery, queryWords, digitsOnly)
      );
      if (filtered.length > 0) {
        // Update cache and incremental cache
        searchCache.set(cacheKey, { results: filtered, timestamp: Date.now() });
        lastQueryNormalized = normalizedQuery;
        lastResults = filtered;
        return filtered;
      }
    }

    // Check if query looks like an email (contains @)
    const isEmailQuery = trimmedQuery.includes('@');
    
    // Distinguish between lead numbers and phone numbers:
    // - Lead numbers: short (typically < 10 digits) or have L/C prefix
    // - Phone numbers: long (>= 10 digits) without L/C prefix
    const isLikelyPhoneNumber = digitsOnly.length >= 10 && !hasLPrefix && !hasCPrefix;
    
    // Check if query is a pure number - we'll search BOTH lead_number AND phone fields
    const isNumericQuery = hasOnlyDigits && numericQuery.length > 0;
    
    // For numeric queries, we search both lead_number/id AND phone fields
    // No need to distinguish - search everything!

    // Removed verbose logging for performance

    // PHASE 1: Try exact matches first (fast, immediate results)
    const newLeadsPromise = (async () => {
      const MIN_RESULTS_FOR_IMMEDIATE_RETURN = 10;
      
      // First, try exact matches only (fastest)
      const exactFilters: string[] = [];
      
      if (isNumericQuery) {
        // Exact lead number matches (fastest)
        exactFilters.push(`lead_number.eq.${trimmedQuery}`);
        exactFilters.push(`lead_number.eq.${numericQuery}`);
        if (uppercaseQuery !== trimmedQuery) {
          exactFilters.push(`lead_number.eq.${uppercaseQuery}`);
        }
        if (!hasLPrefix && !hasCPrefix) {
          exactFilters.push(`lead_number.eq.L${numericQuery}`);
          exactFilters.push(`lead_number.eq.C${numericQuery}`);
        }
        
        // For phone numbers, try exact phone matches
        if (isLikelyPhoneNumber && digitsOnly.length >= 7 && digitsOnly.length <= 15) {
          exactFilters.push(`phone.eq.${digitsOnly}`);
          exactFilters.push(`mobile.eq.${digitsOnly}`);
        }
      } else if (isEmailQuery) {
        // Exact email match
        exactFilters.push(`email.eq.${trimmedQuery}`);
        exactFilters.push(`email.ilike.${trimmedQuery}`); // Case-insensitive exact
      } else {
        // Exact name matches (starts with, case-insensitive)
        exactFilters.push(`name.ilike.${trimmedQuery}`);
        exactFilters.push(`name.ilike.${trimmedQuery}%`);
        exactFilters.push(`lead_number.eq.${trimmedQuery}`);
        if (!hasLPrefix && !hasCPrefix && numericQuery) {
          exactFilters.push(`lead_number.eq.L${numericQuery}`);
          exactFilters.push(`lead_number.eq.C${numericQuery}`);
        }
      }
      
      if (exactFilters.length > 0) {
        const exactQuery = supabase
          .from('leads')
          .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
          .limit(MIN_RESULTS_FOR_IMMEDIATE_RETURN + 5);
        
        const exactResult = await exactQuery.or(exactFilters.join(','));
        
        // If we have enough exact matches, return immediately (fast path)
        if (exactResult.data && exactResult.data.length >= MIN_RESULTS_FOR_IMMEDIATE_RETURN) {
          return exactResult;
        }
        
        // If we have some exact matches but not enough, we'll combine with fuzzy
        // Store exact results to merge later
        const exactData = exactResult.data || [];
        
        // PHASE 2: Do fuzzy search to get more results
        const fuzzyFilters = new Set<string>(exactFilters); // Start with exact filters
        
        if (isNumericQuery) {
          // Add fuzzy lead number matches
          fuzzyFilters.add(`lead_number.ilike.%${trimmedQuery}%`);
          fuzzyFilters.add(`lead_number.ilike.%${numericQuery}%`);
        if (digitsOnly && digitsOnly !== numericQuery) {
            fuzzyFilters.add(`lead_number.ilike.%${digitsOnly}%`);
          }
          
          // For phone numbers, add phone fuzzy search
          if (isLikelyPhoneNumber || (digitsOnly.length >= 5)) {
            if (lastFiveDigits.length >= 5) {
              fuzzyFilters.add(`phone.ilike.%${lastFiveDigits}%`);
              fuzzyFilters.add(`mobile.ilike.%${lastFiveDigits}%`);
            }
            if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
              fuzzyFilters.add(`phone.ilike.%${digitsOnly}%`);
              fuzzyFilters.add(`mobile.ilike.%${digitsOnly}%`);
            }
          }
        } else if (isEmailQuery) {
          fuzzyFilters.add(`email.ilike.%${trimmedQuery}%`);
        } else {
          // Text search: prioritize starts-with, then contains
          fuzzyFilters.add(`name.ilike.${trimmedQuery}%`);
          fuzzyFilters.add(`name.ilike.%${trimmedQuery}%`);
          fuzzyFilters.add(`lead_number.ilike.${trimmedQuery}%`);
          fuzzyFilters.add(`lead_number.ilike.%${trimmedQuery}%`);
          
          if (!hasLPrefix && !hasCPrefix && numericQuery) {
            fuzzyFilters.add(`lead_number.ilike.L${numericQuery}%`);
            fuzzyFilters.add(`lead_number.ilike.C${numericQuery}%`);
          }
          
          if (queryWords.length > 1) {
            queryWords.forEach(word => {
              if (word.length >= 2) {
                fuzzyFilters.add(`name.ilike.${word}%`);
                fuzzyFilters.add(`name.ilike.%${word}%`);
              }
            });
          }
          
          // Phone search for text queries
          if (isLikelyPhoneNumber && lastFiveDigits.length >= 5) {
            fuzzyFilters.add(`phone.ilike.%${lastFiveDigits}%`);
            fuzzyFilters.add(`mobile.ilike.%${lastFiveDigits}%`);
          }
        }
        
        const fuzzyQuery = supabase
          .from('leads')
          .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
          .limit(10);
        
        const fuzzyResult = await fuzzyQuery.or(Array.from(fuzzyFilters).join(','));
        
        // Merge exact and fuzzy results, removing duplicates
        const exactIds = new Set(exactData.map((r: any) => r.id));
        const fuzzyData = (fuzzyResult.data || []).filter((r: any) => !exactIds.has(r.id));
        const mergedData = [...exactData, ...fuzzyData].slice(0, 10);
        
        return { data: mergedData, error: fuzzyResult.error };
      }
      
      // Fallback: if no exact filters, do fuzzy search directly
      const fuzzyQuery = supabase
        .from('leads')
        .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
        .limit(10);

      if (isEmailQuery) {
        return await fuzzyQuery.ilike('email', `%${trimmedQuery}%`);
      }

      const fuzzyConditions = new Set<string>([
        `name.ilike.${trimmedQuery}%`,
        `name.ilike.%${trimmedQuery}%`,
        `lead_number.ilike.${trimmedQuery}%`,
        `lead_number.ilike.%${trimmedQuery}%`,
      ]);

      if (!hasLPrefix && !hasCPrefix && numericQuery) {
        fuzzyConditions.add(`lead_number.ilike.L${numericQuery}%`);
        fuzzyConditions.add(`lead_number.ilike.C${numericQuery}%`);
      }

      if (queryWords.length > 1) {
        queryWords.forEach(word => {
          if (word.length >= 2) {
            fuzzyConditions.add(`name.ilike.${word}%`);
            fuzzyConditions.add(`name.ilike.%${word}%`);
          }
        });
      }
      
      if (isLikelyPhoneNumber && lastFiveDigits.length >= 5) {
        fuzzyConditions.add(`phone.ilike.%${lastFiveDigits}%`);
        fuzzyConditions.add(`mobile.ilike.%${lastFiveDigits}%`);
      }
      
      return await fuzzyQuery.or(Array.from(fuzzyConditions).join(','));
    })();

    // Search contacts for new leads (by name, email, phone)
    // Note: Searching by lead_number is handled separately by fetching contacts for leads found by lead_number
    const newContactsPromise = (async () => {
      if (trimmedQuery.length < 2) return { data: [], error: null };
      
      const isEmailQuery = trimmedQuery.includes('@');
      const digitsOnly = trimmedQuery.replace(/\D/g, '');
      const lastFiveDigits = digitsOnly.slice(-5);
      
      // Distinguish between lead numbers and phone numbers:
      // - Lead numbers: short (typically < 10 digits) or have L/C prefix
      // - Phone numbers: long (>= 10 digits) without L/C prefix
      const isLikelyPhoneNumber = digitsOnly.length >= 10 && !hasLPrefix && !hasCPrefix;
      const looksLikeLeadNumber = hasLPrefix || hasCPrefix || (isNumericQuery && hasOnlyDigits && digitsOnly.length < 10);
      
      // Skip contact search if query looks like a lead number (short numeric) - we'll get contacts via lead number search
      if (looksLikeLeadNumber && !isLikelyPhoneNumber) {
        return { data: [], error: null };
      }
      
      const shouldSearchPhones = isLikelyPhoneNumber || (digitsOnly.length >= 5 && !looksLikeLeadNumber);
      
      const contactFilters: string[] = [];
      
      if (isEmailQuery) {
        // When querying leads_contact table directly, don't use table prefix
        contactFilters.push(`email.ilike.%${trimmedQuery}%`);
      } else if (shouldSearchPhones) {
        // Search by last 5 digits for phone numbers
        contactFilters.push(`phone.ilike.%${lastFiveDigits}%`);
        contactFilters.push(`mobile.ilike.%${lastFiveDigits}%`);
        // Also try full phone number if it's a reasonable length
        if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
          contactFilters.push(`phone.ilike.%${digitsOnly}%`);
          contactFilters.push(`mobile.ilike.%${digitsOnly}%`);
        }
      } else {
        // Search by name - don't use table prefix when querying table directly
        const nameWords = trimmedQuery.split(/\s+/).filter(Boolean);
        nameWords.forEach(word => {
          if (word.length >= 2) {
            contactFilters.push(`name.ilike.%${word}%`);
          }
        });
        // Also search for full name (replace spaces with % for pattern matching)
        if (trimmedQuery.length >= 2) {
          const fullNamePattern = trimmedQuery.replace(/\s+/g, '%');
          contactFilters.push(`name.ilike.%${fullNamePattern}%`);
        }
        // Add exact match and case variations for better results
        contactFilters.push(`name.ilike.${trimmedQuery}%`);
        contactFilters.push(`name.ilike.%${trimmedQuery}%`);
        if (trimmedQuery !== trimmedQuery.toLowerCase()) {
          contactFilters.push(`name.ilike.%${trimmedQuery.toLowerCase()}%`);
        }
        if (trimmedQuery !== trimmedQuery.toUpperCase()) {
          contactFilters.push(`name.ilike.%${trimmedQuery.toUpperCase()}%`);
        }
      }
      
      if (contactFilters.length === 0) return { data: [], error: null };
      
      try {
        // Step 1: Search leads_contact table directly
        const { data: contactsData, error: contactsError } = await supabase
          .from('leads_contact')
          .select('id, name, email, phone, mobile')
          .or(contactFilters.join(','))
          .limit(100);
        
        if (contactsError) {
          console.warn('[searchLeads] New leads contact search error', contactsError);
          return { data: [], error: contactsError };
        }
        
        if (!contactsData || contactsData.length === 0) {
          return { data: [], error: null };
        }
        
        // Step 2: Get contact IDs and fetch relationships with leads (both new and legacy)
        let contactIds = contactsData.map(c => c.id);
        
        // If query is long enough, try exact name match for better results
        if (trimmedQuery.length >= 3) {
          try {
            const { data: exactMatchContacts, error: exactError } = await supabase
              .from('leads_contact')
              .select('id, name, email, phone, mobile')
              .ilike('name', trimmedQuery)
              .limit(10);
            
            if (!exactError && exactMatchContacts && exactMatchContacts.length > 0) {
              // Add contacts that aren't already in the list
              exactMatchContacts.forEach((contact: any) => {
                if (!contactsData.find((c: any) => c.id === contact.id)) {
                  contactsData.push(contact);
                  if (!contactIds.includes(contact.id)) {
                    contactIds.push(contact.id);
                  }
                }
              });
            }
          } catch (err) {
            // Silently continue if exact match fails
          }
        }
        
        // Fetch ALL relationships first (both new and legacy)
        // Increase limit to ensure we get all relationships
        const { data: allRelationships, error: allRelationshipsError } = await supabase
          .from('lead_leadcontact')
          .select(`
            newlead_id,
            lead_id,
            main,
            contact_id
          `)
          .in('contact_id', contactIds)
          .limit(500);
        
        console.log('[searchLeads] All relationships found:', allRelationships?.length || 0);
        console.log('[searchLeads] Sample relationships:', allRelationships?.slice(0, 5));
        
        if (allRelationshipsError) {
          console.warn('[searchLeads] Error fetching all relationships', allRelationshipsError);
          return { data: [], error: allRelationshipsError };
        }
        
        // Separate new and legacy relationships
        const newLeadRelationships = (allRelationships || []).filter((rel: any) => rel.newlead_id);
        const legacyLeadRelationships = (allRelationships || []).filter((rel: any) => rel.lead_id);
        
        console.log('[searchLeads] New lead relationships:', newLeadRelationships.length);
        console.log('[searchLeads] Legacy lead relationships:', legacyLeadRelationships.length);
        
        // Check if any Ron Decker contact's relationship is found
        const ronDeckerContacts = contactsData?.filter((c: any) => {
          const name = (c.name || '').toLowerCase();
          return name.includes('ron') && name.includes('decker');
        });
        if (ronDeckerContacts && ronDeckerContacts.length > 0) {
          ronDeckerContacts.forEach((contact: any) => {
            const relationship = allRelationships?.find((rel: any) => rel.contact_id === contact.id);
            // Debug logging removed for performance
          });
        } else {
          // Also check contact ID 192970 directly if we know it exists
          const relationship192970 = allRelationships?.find((rel: any) => rel.contact_id === 192970);
          // Removed debug code for contact 192970
        }
        
        // Now fetch lead details for new leads
        const newLeadIds = newLeadRelationships.map((rel: any) => rel.newlead_id).filter(Boolean);
        let newLeadsData: any[] = [];
        
        if (newLeadIds.length > 0) {
          const { data: newLeads, error: newLeadsError } = await supabase
            .from('leads')
            .select('id, lead_number, name, topic, stage, created_at')
            .in('id', newLeadIds)
            .limit(100);
          
          if (newLeadsError) {
            console.warn('[searchLeads] Error fetching new leads', newLeadsError);
          } else {
            newLeadsData = newLeads || [];
          }
        }
        
        // Fetch lead details for legacy leads
        const legacyLeadIds = legacyLeadRelationships.map((rel: any) => rel.lead_id).filter(Boolean);
        let legacyLeadsData: any[] = [];
        
        if (legacyLeadIds.length > 0) {
          const { data: legacyLeads, error: legacyLeadsError } = await supabase
            .from('leads_lead')
            .select('id, manual_id, lead_number, name, topic, stage, cdate')
            .in('id', legacyLeadIds)
            .limit(100);
          
          if (legacyLeadsError) {
            console.warn('[searchLeads] Error fetching legacy leads', legacyLeadsError);
          } else {
            legacyLeadsData = legacyLeads || [];
          }
        }
        
        // Step 3: Combine contact data with relationship and lead data
        const combinedData: any[] = [];
        
        // Process new lead relationships
        newLeadRelationships.forEach((rel: any) => {
          const contact = contactsData.find((c: any) => c.id === rel.contact_id);
          const lead = newLeadsData.find((l: any) => l.id === rel.newlead_id);
          
          if (contact && lead) {
            combinedData.push({
              newlead_id: rel.newlead_id,
              main: rel.main,
              leads_contact: contact,
              leads: lead,
            });
          }
          // Removed verbose logging for performance
        });
        
        // Process legacy lead relationships
        legacyLeadRelationships.forEach((rel: any) => {
          const contact = contactsData.find((c: any) => c.id === rel.contact_id);
          const lead = legacyLeadsData.find((l: any) => l.id === rel.lead_id);
          
          if (contact && lead) {
            combinedData.push({
              lead_id: rel.lead_id,
              main: rel.main,
              leads_contact: contact,
              leads_lead: {
                id: lead.id,
                lead_number: lead.lead_number || lead.manual_id || String(lead.id),
                name: lead.name,
                topic: lead.topic,
                stage: lead.stage,
                cdate: lead.cdate,
              },
            });
          }
          // Removed verbose logging for performance
        });
        
        // Sort by relevance - prioritize exact matches and main contacts
        combinedData.sort((a: any, b: any) => {
          const aName = (a.leads_contact?.name || '').toLowerCase();
          const bName = (b.leads_contact?.name || '').toLowerCase();
          const queryLower = trimmedQuery.toLowerCase();
          
          // Exact match first
          if (aName === queryLower && bName !== queryLower) return -1;
          if (bName === queryLower && aName !== queryLower) return 1;
          
          // Starts with query
          if (aName.startsWith(queryLower) && !bName.startsWith(queryLower)) return -1;
          if (bName.startsWith(queryLower) && !aName.startsWith(queryLower)) return 1;
          
          // Main contact first
          if (a.main === 'true' && b.main !== 'true') return -1;
          if (b.main === 'true' && a.main !== 'true') return 1;
          
          return 0;
        });
        
        // Return limited results for performance
        return { data: combinedData.slice(0, 50), error: null };
      } catch (err) {
        console.error('[searchLeads] Error searching new leads contacts', err);
        return { data: [], error: err };
      }
    })();

    // PHASE 1: Get new leads first (fast) - return immediately if we have results
    const newResponse = await newLeadsPromise;
    
    // Transform new leads immediately for fast rendering
    const newLeadsResults: CombinedLead[] = [];
    if (newResponse.data && newResponse.data.length > 0) {
      newResponse.data.forEach((lead: any) => {
        newLeadsResults.push({
          id: lead.id,
          lead_number: lead.lead_number || '',
          name: lead.name || '',
          email: lead.email || '',
          phone: lead.phone || '',
          mobile: lead.mobile || '',
          topic: lead.topic || '',
          stage: String(lead.stage || ''),
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
        });
      });
      
      // If we have enough new leads, return immediately (prioritize new leads)
      if (newLeadsResults.length >= 10) {
        const cacheKey = normalizedQuery;
        searchCache.set(cacheKey, { results: newLeadsResults, timestamp: Date.now() });
        lastQueryNormalized = normalizedQuery;
        lastResults = newLeadsResults;
        return newLeadsResults.slice(0, 20); // Return immediately for fast rendering
      }
    }
    
    // If we don't have enough new leads, continue with legacy/contact searches
    const MIN_RESULTS_TO_SKIP_FUZZY = 10;
    const hasEnoughResults = newLeadsResults.length >= MIN_RESULTS_TO_SKIP_FUZZY;
    
    // Only do legacy and contact searches if we don't have enough direct results
    let legacyResults: CombinedLead[] = [];
    let newContactsResponse: { data: any[]; error: any } = { data: [], error: null };
    
    if (!hasEnoughResults) {
      // PHASE 2: Do legacy search (only if needed)
      const legacySearchPromise = withTimeout(
      searchLegacyLeads(trimmedQuery),
        3000, // Reduced to 3 seconds for faster response
        'Legacy search timeout'
      ).catch((error: any) => {
        if (error.message === 'Legacy search timeout' || error.code === '57014') {
          return [];
        }
        console.error('[searchLeads] Legacy search error:', error);
        return [];
      });
      
      // PHASE 3: Do contact search (only if needed)
      // Skip contact search if query looks like a lead number
      const looksLikeLeadNumber = hasLPrefix || hasCPrefix || (isNumericQuery && hasOnlyDigits && digitsOnly.length < 10);
      const shouldSkipContactSearch = looksLikeLeadNumber && !isLikelyPhoneNumber;
      
      const contactsPromise = shouldSkipContactSearch 
        ? Promise.resolve({ data: [], error: null })
        : newContactsPromise;
      
      [legacyResults, newContactsResponse] = await Promise.all([
        legacySearchPromise,
        contactsPromise,
      ]);
      
      // If we now have enough results, we can skip expensive contact processing
      const totalResultsSoFar = (newResponse.data?.length || 0) + legacyResults.length;
      if (totalResultsSoFar >= MIN_RESULTS_TO_SKIP_FUZZY) {
        // We have enough, skip expensive contact processing
        newContactsResponse = { data: [], error: null };
      }
    }
    
    // Early return if we have enough results from direct searches
    const totalDirectResults = (newResponse.data?.length || 0) + legacyResults.length;
    if (totalDirectResults >= MIN_RESULTS_TO_SKIP_FUZZY && (!newContactsResponse.data || newContactsResponse.data.length === 0)) {
      // Transform and return results immediately
      const results: CombinedLead[] = [];
      
      // Transform new leads
      if (newResponse.data) {
        newResponse.data.forEach((lead: any) => {
          results.push({
            id: lead.id,
            lead_number: lead.lead_number || '',
            name: lead.name || '',
            email: lead.email || '',
            phone: lead.phone || '',
            mobile: lead.mobile || '',
            topic: lead.topic || '',
            stage: String(lead.stage || ''),
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
          });
        });
      }
      
      // Add legacy results
      results.push(...legacyResults);
      
      // Sort and cache
      results.sort((a, b) => {
        const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bDate - aDate;
      });
      
      const cacheKey = normalizedQuery;
      searchCache.set(cacheKey, { results, timestamp: Date.now() });
      lastQueryNormalized = normalizedQuery;
      lastResults = results;
      
      return results.slice(0, 20); // Return top 20
    }
    
    // If searching by lead number, also fetch all contacts for matching leads
    const leadNumberContactsPromise = (async () => {
      // Only do this if the query looks like a lead number (has L/C prefix or is numeric)
      const looksLikeLeadNumber = hasLPrefix || hasCPrefix || (isNumericQuery && hasOnlyDigits);
      
      if (!looksLikeLeadNumber || !newResponse.data || newResponse.data.length === 0) {
        return { data: [], error: null };
      }
      
      // Get all lead IDs from the search results
      const leadIds = newResponse.data.map((lead: any) => lead.id).filter(Boolean);
      
      if (leadIds.length === 0) return { data: [], error: null };
      
      try {
        // Fetch all contacts for these leads
        const { data, error } = await supabase
          .from('lead_leadcontact')
          .select(`
            newlead_id,
            main,
            leads_contact (
              id,
              name,
              email,
              phone,
              mobile
            ),
            leads!newlead_id (
              id,
              lead_number,
              name,
              topic,
              stage,
              created_at
            )
          `)
          .in('newlead_id', leadIds)
          .limit(50);
        
        if (error) {
          console.warn('[searchLeads] Lead number contacts fetch error', error);
          return { data: [], error };
        }
        
        return { data: data || [], error: null };
      } catch (err) {
        console.error('[searchLeads] Error fetching lead number contacts', err);
        return { data: [], error: err };
      }
    })();
    
    // Also fetch contacts for legacy leads found by lead number
    const legacyLeadNumberContactsPromise = (async () => {
      const looksLikeLeadNumber = isNumericQuery && hasOnlyDigits;
      
      if (!looksLikeLeadNumber || !legacyResults || legacyResults.length === 0) {
        return { data: [], error: null };
      }
      
      // Get all legacy lead IDs from the search results
      const leadIds = legacyResults
        .filter(r => r.lead_type === 'legacy')
        .map(r => typeof r.id === 'number' ? r.id : parseInt(String(r.id), 10))
        .filter(id => !isNaN(id));
      
      if (leadIds.length === 0) return { data: [], error: null };
      
      try {
        // Fetch all contacts for these legacy leads
        const { data, error } = await supabase
          .from('lead_leadcontact')
          .select(`
            lead_id,
            main,
            leads_contact (
              id,
              name,
              email,
              phone,
              mobile,
              additional_emails,
              additional_phones
            )
          `)
          .in('lead_id', leadIds)
          .limit(50);
        
        if (error) {
          console.warn('[searchLeads] Legacy lead number contacts fetch error', error);
          return { data: [], error: null };
        }
        
        // Map to include lead info from legacyResults
        const mappedData = (data || []).map((item: any) => {
          const leadId = item.lead_id;
          const matchingLead = legacyResults.find(r => 
            r.lead_type === 'legacy' && 
            (typeof r.id === 'number' ? r.id : parseInt(String(r.id), 10)) === leadId
          );
          
          return {
            ...item,
            leads_lead: matchingLead ? {
              id: matchingLead.id,
              lead_number: matchingLead.lead_number || matchingLead.manual_id,
              name: matchingLead.name,
              topic: matchingLead.topic,
              stage: matchingLead.stage,
              cdate: matchingLead.created_at,
            } : null,
          };
        });
        
        return { data: mappedData, error: null };
      } catch (err) {
        console.error('[searchLeads] Error fetching legacy lead number contacts', err);
        return { data: [], error: err };
      }
    })();
    
    const [leadNumberContactsResponse, legacyLeadNumberContactsResponse] = await Promise.all([
      leadNumberContactsPromise,
      legacyLeadNumberContactsPromise,
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
        isContact: false,
        isMainContact: false,
      }));
      results.push(...transformedNewLeads);
    }
    
    // Process new leads contacts (includes both new and legacy leads now)
    if (!newContactsResponse.error && newContactsResponse.data) {
      const contactResults: CombinedLead[] = newContactsResponse.data
        .filter((item: any) => {
          // Check for new lead (has leads) or legacy lead (has leads_lead)
          const hasNewLead = !!item.leads;
          const hasLegacyLead = !!item.leads_lead;
          const hasContact = !!item.leads_contact;
          return (hasNewLead || hasLegacyLead) && hasContact;
        })
        .map((item: any) => {
          const contact = Array.isArray(item.leads_contact) ? item.leads_contact[0] : item.leads_contact;
          const isMain = item.main === true || item.main === 'true';
          
          // Handle new leads
          if (item.leads) {
            const lead = Array.isArray(item.leads) ? item.leads[0] : item.leads;
            return {
              id: lead.id,
              lead_number: lead.lead_number || '',
              manual_id: lead.lead_number || null,
              name: contact.name || '',
              email: contact.email || '',
              phone: contact.phone || '',
              mobile: contact.mobile || '',
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
              isContact: !isMain,
              contactName: contact.name || '',
              isMainContact: isMain,
            };
          }
          
          // Handle legacy leads
          if (item.leads_lead) {
            const lead = item.leads_lead;
            return {
            id: String(lead.id), // Legacy leads use numeric ID as string, no prefix
              lead_number: lead.lead_number || String(lead.id),
              manual_id: lead.lead_number || String(lead.id),
              name: contact.name || '',
              email: contact.email || '',
              phone: contact.phone || '',
              mobile: contact.mobile || '',
              topic: lead.topic || '',
              stage: lead.stage || '',
              source: '',
              created_at: lead.cdate || '',
              updated_at: lead.cdate || '',
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
              isContact: !isMain,
              contactName: contact.name || '',
              isMainContact: isMain,
            };
          }
          
          return null;
        })
        .filter((item: any) => item !== null) as CombinedLead[];
      
      results.push(...contactResults);
    }
    
    // Process legacy leads
    if (Array.isArray(legacyResults) && legacyResults.length > 0) {
      console.log(`[searchLeads] Adding ${legacyResults.length} legacy results to results array`);
      console.log(`[searchLeads] Legacy result IDs (first 10):`, legacyResults.slice(0, 10).map(r => ({ id: r.id, name: r.name })));
      console.log(`[searchLeads] Looking for 192291 in legacyResults:`, legacyResults.some(r => String(r.id) === '192291'));
      console.log(`[searchLeads] Looking for 192191 in legacyResults:`, legacyResults.some(r => String(r.id) === '192191'));
      results.push(...legacyResults);
    }
    
    // Process contacts found by lead number for new leads
    if (!leadNumberContactsResponse.error && leadNumberContactsResponse.data) {
      const leadNumberContactResults: CombinedLead[] = leadNumberContactsResponse.data
        .filter((item: any) => item.leads && item.leads_contact)
        .map((item: any) => {
          const lead = Array.isArray(item.leads) ? item.leads[0] : item.leads;
          const contact = Array.isArray(item.leads_contact) ? item.leads_contact[0] : item.leads_contact;
          const isMain = item.main === true || item.main === 'true';
          
          return {
            id: lead.id,
            lead_number: lead.lead_number || '',
            manual_id: lead.lead_number || null,
            name: contact.name || '',
            email: contact.email || '',
            phone: contact.phone || '',
            mobile: contact.mobile || '',
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
            isContact: !isMain,
            contactName: contact.name || '',
            isMainContact: isMain,
          };
        });
      results.push(...leadNumberContactResults);
    }
    
    // Process contacts found by lead number for legacy leads
    if (!legacyLeadNumberContactsResponse.error && legacyLeadNumberContactsResponse.data) {
      const legacyLeadNumberContactResults: CombinedLead[] = legacyLeadNumberContactsResponse.data
        .filter((item: any) => item.leads_contact && item.leads_lead)
        .map((item: any) => {
          const lead = item.leads_lead;
          const contact = Array.isArray(item.leads_contact) ? item.leads_contact[0] : item.leads_contact;
          const isMain = item.main === true || item.main === 'true';
          
          return {
            id: String(lead.id), // Legacy leads use numeric ID as string, no prefix
            lead_number: lead.lead_number || String(lead.id),
            manual_id: lead.lead_number || String(lead.id),
            name: contact.name || '',
            email: contact.email || '',
            phone: contact.phone || '',
            mobile: contact.mobile || '',
            topic: lead.topic || '',
            stage: lead.stage || '',
            source: '',
            created_at: lead.cdate || '',
            updated_at: lead.cdate || '',
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
            isContact: !isMain,
            contactName: contact.name || '',
            isMainContact: isMain,
          };
        });
      results.push(...legacyLeadNumberContactResults);
    }
    
    // Remove duplicates - prioritize main leads over contacts
    // Separate main leads and contacts first
    const mainLeads = new Map<string, CombinedLead>();
    const contacts = new Map<string, CombinedLead>();
    
    results.forEach((lead) => {
      const leadId = String(lead.id);
      
      if (lead.isContact && lead.contactName) {
        // This is a contact - use contactName + leadId as key
        const key = `${leadId}-${lead.contactName}-${lead.lead_type}`;
        if (!contacts.has(key)) {
          contacts.set(key, lead);
        }
      } else {
        // This is a main lead - use just leadId as key
        const key = `${leadId}-${lead.lead_type}`;
        // Always keep main leads, they take priority
        mainLeads.set(key, lead);
      }
    });
    
    // Combine: all main leads first, then contacts (but exclude contacts for leads we already have as main)
    const uniqueResults: CombinedLead[] = [];
    const mainLeadIds = new Set(Array.from(mainLeads.values()).map(l => String(l.id)));
    
    // Add all main leads
    uniqueResults.push(...Array.from(mainLeads.values()));
    
    // Add contacts only if their lead ID is not already in main leads
    contacts.forEach((contact) => {
      const contactLeadId = String(contact.id);
      if (!mainLeadIds.has(contactLeadId)) {
        uniqueResults.push(contact);
      }
    });
    
    console.log(`[searchLeads] After deduplication: ${uniqueResults.length} results (from ${results.length} before deduplication)`);
    console.log(`[searchLeads] Legacy results in uniqueResults:`, uniqueResults.filter(r => r.lead_type === 'legacy').length);
    console.log(`[searchLeads] Looking for 192291 in uniqueResults:`, uniqueResults.some(r => String(r.id) === '192291'));
    console.log(`[searchLeads] Looking for 192191 in uniqueResults:`, uniqueResults.some(r => String(r.id) === '192191'));
    console.log(`[searchLeads] Sample uniqueResults IDs:`, uniqueResults.slice(0, 10).map(r => ({ id: r.id, name: r.name, isContact: r.isContact })));
    
    // Sort by relevance - prioritize exact matches and contacts that match the query
    const queryLower = trimmedQuery.toLowerCase();
    uniqueResults.sort((a, b) => {
      const aName = ((a.contactName || a.name) || '').toLowerCase();
      const bName = ((b.contactName || b.name) || '').toLowerCase();
      
      // Exact match first (case-insensitive)
      const aExact = aName === queryLower;
      const bExact = bName === queryLower;
      if (aExact && !bExact) return -1;
      if (bExact && !aExact) return 1;
      
      // Starts with query
      const aStarts = aName.startsWith(queryLower);
      const bStarts = bName.startsWith(queryLower);
      if (aStarts && !bStarts) return -1;
      if (bStarts && !aStarts) return 1;
      
      // Contains query as whole phrase
      const aContainsPhrase = aName.includes(queryLower);
      const bContainsPhrase = bName.includes(queryLower);
      if (aContainsPhrase && !bContainsPhrase) return -1;
      if (bContainsPhrase && !aContainsPhrase) return 1;
      
      // Main contacts before non-main contacts
      if (a.isMainContact && !b.isMainContact) return -1;
      if (b.isMainContact && !a.isMainContact) return 1;
      
      // Contacts before leads (if query matches contact name)
      if (a.isContact && a.contactName && aName.includes(queryLower) && !b.isContact) return -1;
      if (b.isContact && b.contactName && bName.includes(queryLower) && !a.isContact) return 1;
      
      return 0;
    });
    
    // Calculate string similarity (simple Levenshtein-like distance)
    const calculateSimilarity = (str1: string, str2: string): number => {
      const s1 = str1.toLowerCase();
      const s2 = str2.toLowerCase();
      
      // Exact match
      if (s1 === s2) return 1.0;
      
      // One contains the other
      if (s1.includes(s2) || s2.includes(s1)) return 0.8;
      
      // Calculate simple similarity based on common characters
      const longer = s1.length > s2.length ? s1 : s2;
      const shorter = s1.length > s2.length ? s2 : s1;
      
      if (longer.length === 0) return 1.0;
      
      // Count matching characters in order
      let matches = 0;
      let shortIndex = 0;
      for (let i = 0; i < longer.length && shortIndex < shorter.length; i++) {
        if (longer[i] === shorter[shortIndex]) {
          matches++;
          shortIndex++;
        }
      }
      
      // Also check word-by-word similarity
      const words1 = s1.split(/\s+/);
      const words2 = s2.split(/\s+/);
      let wordMatches = 0;
      for (const word1 of words1) {
        for (const word2 of words2) {
          if (word1 === word2) {
            wordMatches++;
            break;
          }
        }
      }
      
      const charSimilarity = matches / longer.length;
      const wordSimilarity = wordMatches / Math.max(words1.length, words2.length);
      
      return (charSimilarity * 0.6 + wordSimilarity * 0.4);
    };
    
    // Limit to max 10 fuzzy results (exact matches are unlimited)
    const exactMatches = uniqueResults.filter((lead) => {
      const name = ((lead.contactName || lead.name) || '').toLowerCase();
      return name === queryLower || 
             lead.lead_number === trimmedQuery ||
             lead.email?.toLowerCase() === queryLower ||
             lead.phone === trimmedQuery ||
             lead.mobile === trimmedQuery;
    });
    
    const fuzzyMatches = uniqueResults
      .filter((lead) => {
        const name = ((lead.contactName || lead.name) || '').toLowerCase();
        return name !== queryLower && 
               lead.lead_number !== trimmedQuery &&
               lead.email?.toLowerCase() !== queryLower &&
               lead.phone !== trimmedQuery &&
               lead.mobile !== trimmedQuery;
      })
      .map((lead) => {
        const name = (lead.contactName || lead.name) || '';
        const similarity = calculateSimilarity(name, trimmedQuery);
        return { lead, similarity };
      })
      .sort((a, b) => b.similarity - a.similarity) // Sort by similarity (highest first)
      .slice(0, 10) // Strictly limit to 10 fuzzy results
      .map(item => item.lead); // Extract just the leads
    
    const finalResults = [...exactMatches, ...fuzzyMatches];
    
    console.log(`[searchLeads] Final results: ${finalResults.length} (${exactMatches.length} exact + ${fuzzyMatches.length} fuzzy)`);
    console.log(`[searchLeads] Legacy results in finalResults:`, finalResults.filter(r => r.lead_type === 'legacy').length);
    console.log(`[searchLeads] Looking for 192291 in finalResults:`, finalResults.some(r => String(r.id) === '192291'));
    console.log(`[searchLeads] Looking for 192191 in finalResults:`, finalResults.some(r => String(r.id) === '192191'));
    
    searchCache.set(cacheKey, { results: finalResults, timestamp: Date.now() });
    lastQueryNormalized = normalizedQuery;
    lastResults = finalResults;

    return finalResults;

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
    const normalizedQuery = trimmedQuery.toLowerCase();
    const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);
    const digitsOnly = trimmedQuery.replace(/\D/g, '');
    const suffixDigitsMatch = trimmedQuery.match(/[0-9]+$/);
    const normalizedNumeric = suffixDigitsMatch ? suffixDigitsMatch[0] : '';
    const isNumericQuery = normalizedNumeric.length > 0;
    const isEmailQuery = trimmedQuery.includes('@');
    const leadNumberLike = /^[a-zA-Z]{0,2}\d+$/.test(trimmedQuery);
    
    // Check if query is primarily text (has letters) - if so, it's a name search
    const hasLetters = /[a-zA-Z]/.test(trimmedQuery);
    const isTextQuery = hasLetters && !isEmailQuery;
    
    // Distinguish between lead numbers and phone numbers:
    // - Lead numbers: short (typically < 10 digits) or have letter prefix
    // - Phone numbers: long (>= 10 digits) without letter prefix
    const isLikelyPhoneNumber = digitsOnly.length >= 10 && !leadNumberLike && !hasLetters;
    const shouldSearchPhones = isLikelyPhoneNumber || (digitsOnly.length >= 5 && !leadNumberLike && !isEmailQuery && !hasLetters);
    const shouldSearchContactNames = !isNumericQuery && !isEmailQuery;

    // Removed verbose logging for performance

    const contactInfoMap = new Map<number, LegacyContactInfo>();
    const contactLeadIds = new Set<number>();
    const contactMatchMap = new Map<number, { contactName: string; isMain: boolean }>();

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
      // When querying leads_contact table directly, don't use table prefix
      contactFilters.push(`email.ilike.%${trimmedQuery}%`);
      contactFilters.push(`additional_emails.ilike.%${trimmedQuery}%`);
    } else if (shouldSearchPhones) {
      const lastFiveDigits = digitsOnly.slice(-5);
      contactFilters.push(`phone.ilike.%${lastFiveDigits}%`);
      contactFilters.push(`mobile.ilike.%${lastFiveDigits}%`);
      contactFilters.push(`additional_phones.ilike.%${lastFiveDigits}%`);
      // Also try full phone number if it's a reasonable length
      if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
        contactFilters.push(`phone.ilike.%${digitsOnly}%`);
        contactFilters.push(`mobile.ilike.%${digitsOnly}%`);
        contactFilters.push(`additional_phones.ilike.%${digitsOnly}%`);
      }
    } else if (shouldSearchContactNames && trimmedQuery.length >= 2) {
      // Search by name - don't use table prefix when querying table directly
      const nameWords = trimmedQuery.split(/\s+/).filter(Boolean);
      nameWords.forEach(word => {
        if (word.length >= 2) {
          contactFilters.push(`name.ilike.%${word}%`);
        }
      });
      // Also search for full name (replace spaces with % for pattern matching)
      if (trimmedQuery.length >= 2) {
        const fullNamePattern = trimmedQuery.replace(/\s+/g, '%');
        contactFilters.push(`name.ilike.%${fullNamePattern}%`);
      }
    }

    if (contactFilters.length > 0) {
      try {
        // Step 1: Search leads_contact table directly (can't filter on nested tables)
        const { data: contactsData, error: contactsError } = await supabase
          .from('leads_contact')
          .select('id, name, email, phone, mobile, additional_emails, additional_phones')
          .or(contactFilters.join(','))
          .limit(100);
        
        if (contactsError) {
          console.warn('[searchLegacyLeads] Contact search error (step 1)', contactsError);
        } else if (contactsData && contactsData.length > 0) {
          // Step 2: Get contact IDs and fetch relationships with legacy leads
          const contactIds = contactsData.map(c => c.id);
          
          const { data: relationshipsData, error: relationshipsError } = await supabase
            .from('lead_leadcontact')
            .select('lead_id, main, contact_id')
            .in('contact_id', contactIds)
            .not('lead_id', 'is', null)
            .limit(100);
          
          if (relationshipsError) {
            console.warn('[searchLegacyLeads] Contact search error (step 2)', relationshipsError);
          } else if (relationshipsData) {
            // Step 3: Map contacts to leads
            relationshipsData.forEach((rel: any) => {
              const leadId = rel.lead_id;
              const contact = contactsData.find((c: any) => c.id === rel.contact_id);
              
              if (!leadId || !contact) return;
              
              const isMain = rel.main === true || rel.main === 'true';
              contactLeadIds.add(leadId);
              contactInfoMap.set(leadId, {
                name: contact.name,
                email: contact.email,
                additionalEmails: splitValues(contact.additional_emails),
                phone: contact.phone,
                mobile: contact.mobile,
                additionalPhones: splitValues(contact.additional_phones),
              });
              // Store contact match info for marking results
              contactMatchMap.set(leadId, {
                contactName: contact.name || '',
                isMain: isMain,
              });
            });
          }
        }
      } catch (err) {
        console.error('[searchLegacyLeads] Contact search error', err);
      }
    }

    const MAX_RESULTS = 20;
    const MIN_EXACT_RESULTS = 10;

    // PHASE 1: Try exact matches first (fast)
    let exactRows: any[] = [];
    
    try {
      if (isNumericQuery && normalizedNumeric) {
        const numericValue = parseInt(normalizedNumeric, 10);
        const exactFilters: string[] = [];

        if (!Number.isNaN(numericValue)) {
          exactFilters.push(`id.eq.${numericValue}`);
          exactFilters.push(`lead_number.eq.${numericValue}`);
        }

        if (exactFilters.length > 0) {
          const exactQuery = supabase
            .from('leads_lead')
            .select('id, manual_id, lead_number, name, topic, email, additional_emails, phone, mobile, additional_phones, stage, cdate')
            .or(exactFilters.join(','))
            .limit(MIN_EXACT_RESULTS);
          
          const exactResult = await exactQuery;
          if (exactResult.data) {
            exactRows = exactResult.data;
            exactRows.forEach(row => contactLeadIds.add(row.id));
          }
        }
      } else if (isEmailQuery) {
        // Try exact email first
        const exactQuery = supabase
          .from('leads_lead')
          .select('id, manual_id, lead_number, name, topic, email, additional_emails, phone, mobile, additional_phones, stage, cdate')
          .or(`email.eq.${trimmedQuery},email.ilike.${trimmedQuery}`)
          .limit(MIN_EXACT_RESULTS);
        
        const exactResult = await exactQuery;
        if (exactResult.data) {
          exactRows = exactResult.data;
          exactRows.forEach(row => contactLeadIds.add(row.id));
        }
      } else if (isTextQuery && trimmedQuery.length >= 2) {
        // Try exact name matches first (case-insensitive)
        // Use comprehensive patterns to catch all variations
        const exactNameFilters: string[] = [];
        const lowerQuery = trimmedQuery.toLowerCase();
        const upperQuery = trimmedQuery.toUpperCase();
        
        // 1. Exact match (case-insensitive) - highest priority
        exactNameFilters.push(`name.ilike.${trimmedQuery}`);
        exactNameFilters.push(`name.ilike.${lowerQuery}`);
        exactNameFilters.push(`name.ilike.${upperQuery}`);
        
        // 2. Starts with - high priority
        exactNameFilters.push(`name.ilike.${trimmedQuery}%`);
        exactNameFilters.push(`name.ilike.${lowerQuery}%`);
        exactNameFilters.push(`name.ilike.${upperQuery}%`);
        
        // 3. Contains - medium priority (for partial matches)
        exactNameFilters.push(`name.ilike.%${trimmedQuery}%`);
        exactNameFilters.push(`name.ilike.%${lowerQuery}%`);
        exactNameFilters.push(`name.ilike.%${upperQuery}%`);
        
        // 4. For multi-word queries, try exact phrase match and individual words
        if (queryWords.length > 1) {
          // Exact phrase with spaces as wildcards
          const exactPhrase = trimmedQuery.replace(/\s+/g, '%');
          exactNameFilters.push(`name.ilike.%${exactPhrase}%`);
          
          // Each word individually (starts with and contains)
          queryWords.forEach(word => {
            if (word.length >= 2) {
              exactNameFilters.push(`name.ilike.${word}%`);
              exactNameFilters.push(`name.ilike.%${word}%`);
            }
          });
        }
        
        const exactQuery = supabase
          .from('leads_lead')
          .select('id, manual_id, lead_number, name, topic, email, additional_emails, phone, mobile, additional_phones, stage, cdate')
          .or(exactNameFilters.join(','))
          .order('cdate', { ascending: false })
          .limit(MAX_RESULTS); // Increased limit to get more exact matches
        
        const exactResult = await exactQuery;
        if (exactResult.error) {
          console.warn('[searchLegacyLeads] Exact name query error:', exactResult.error);
        }
        if (exactResult.data) {
          console.log(`[searchLegacyLeads] Exact name query found ${exactResult.data.length} results for "${trimmedQuery}"`);
          if (exactResult.data.length > 0) {
            exactRows = exactResult.data;
            exactRows.forEach(row => contactLeadIds.add(row.id));
            
            // Sort exact results by relevance (exact match > starts with > contains)
            exactRows.sort((a, b) => {
              const aName = (a.name || '').toLowerCase();
              const bName = (b.name || '').toLowerCase();
              const queryLower = lowerQuery;
              
              // Exact match first
              const aExact = aName === queryLower;
              const bExact = bName === queryLower;
              if (aExact && !bExact) return -1;
              if (bExact && !aExact) return 1;
              
              // Starts with second
              const aStarts = aName.startsWith(queryLower);
              const bStarts = bName.startsWith(queryLower);
              if (aStarts && !bStarts) return -1;
              if (bStarts && !aStarts) return 1;
              
              return 0;
            });
          }
        } else {
          console.log(`[searchLegacyLeads] Exact name query returned no data for "${trimmedQuery}"`);
        }
      }
    } catch (error) {
      console.warn('[searchLegacyLeads] Error in exact match query', error);
    }

    // PHASE 2: Always do fuzzy search for name queries to ensure comprehensive results
    // For name queries, we want both exact and fuzzy matches
    let fuzzyRows: any[] = [];
    
    // Always run fuzzy search for name queries to ensure we find all matches
    // This ensures we don't miss leads that match but weren't in the exact query
    const shouldRunFuzzy = isTextQuery;
    const needsMoreResults = exactRows.length < MIN_EXACT_RESULTS;
    
    // Always run fuzzy for name queries, or if we need more results
    if (shouldRunFuzzy || needsMoreResults) {
    let legacyQuery = supabase
      .from('leads_lead')
        .select('id, manual_id, lead_number, name, topic, email, additional_emails, phone, mobile, additional_phones, stage, cdate')
      .order('cdate', { ascending: false })
        .limit(10); // Limit fuzzy matches to 10 as requested

    try {
      if (isNumericQuery && normalizedNumeric) {
        const numericValue = parseInt(normalizedNumeric, 10);
        const numericFilters = new Set<string>();

          // Add exact filters first
        if (!Number.isNaN(numericValue)) {
          numericFilters.add(`id.eq.${numericValue}`);
          numericFilters.add(`lead_number.eq.${numericValue}`);
        }

          // Then add fuzzy
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
      } else if (isTextQuery) {
        // Name search - comprehensive patterns
        const normalizePattern = (value: string) =>
          value
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .join('%');
        
        const wildcardQuery = normalizePattern(trimmedQuery);
        const lowerQuery = trimmedQuery.toLowerCase();
        const upperQuery = trimmedQuery.toUpperCase();
        const textFilters = new Set<string>([
          // Exact match patterns
          `name.ilike.${trimmedQuery}`,      // Exact match
          `name.ilike.${lowerQuery}`,        // Exact match lowercase
          `name.ilike.${upperQuery}`,        // Exact match uppercase
          `name.ilike.${trimmedQuery}%`,     // Starts with
          `name.ilike.${lowerQuery}%`,       // Starts with lowercase
          `name.ilike.${upperQuery}%`,       // Starts with uppercase
          `name.ilike.%${trimmedQuery}%`,    // Contains
          `name.ilike.%${lowerQuery}%`,      // Contains lowercase
          `name.ilike.%${upperQuery}%`,      // Contains uppercase
          `topic.ilike.%${wildcardQuery}%`,  // Topic contains
        ]);

        // For multi-word queries, add individual word matches
        const words = trimmedQuery.split(/\s+/).filter(Boolean);
        if (words.length > 1) {
          words.forEach(word => {
            if (word.length >= 2) {
              const wordLower = word.toLowerCase();
              textFilters.add(`name.ilike.${word}%`);      // Word starts with
              textFilters.add(`name.ilike.${wordLower}%`); // Word starts with lowercase
              textFilters.add(`name.ilike.%${word}%`);     // Word contains
              textFilters.add(`name.ilike.%${wordLower}%`); // Word contains lowercase
            }
          });
          
          // Also try exact phrase with spaces as wildcards
          const exactPhrase = trimmedQuery.replace(/\s+/g, '%');
          textFilters.add(`name.ilike.%${exactPhrase}%`);
        }

        legacyQuery = legacyQuery.or(Array.from(textFilters).join(','));
      }
    } catch (error) {
      console.warn('[searchLegacyLeads] Error building legacy query', error);
    }

      // Add timeout to legacy query (3 seconds max for fuzzy search)
      try {
        const queryPromise = legacyQuery as unknown as Promise<{ data: any[] | null; error: any }>;
        const result: any = await withTimeout(
          queryPromise,
          3000, // 3 second timeout for fuzzy
          'Legacy query timeout'
        );
        fuzzyRows = result.data || [];
      } catch (timeoutError: any) {
        if (timeoutError.message === 'Legacy query timeout') {
          console.warn('[searchLegacyLeads] Fuzzy query timed out, using exact matches only');
        }
      }
    }

    // Combine exact and fuzzy results, prioritizing exact matches
    // Ensure IDs are numbers for consistent comparison
    const exactIds = new Set(exactRows.map((r: any) => Number(r.id)));
    console.log(`[searchLegacyLeads] Exact IDs found: ${exactIds.size}`, Array.from(exactIds).slice(0, 5));
    console.log(`[searchLegacyLeads] Sample exact row IDs:`, exactRows.slice(0, 5).map((r: any) => ({ id: r.id, name: r.name, idType: typeof r.id })));
    
    const uniqueFuzzyRows = fuzzyRows.filter((r: any) => !exactIds.has(r.id));
    console.log(`[searchLegacyLeads] Unique fuzzy rows after filtering: ${uniqueFuzzyRows.length}`);
    
    // Limit fuzzy matches to exactly 10 as requested
    const limitedFuzzyRows = uniqueFuzzyRows.slice(0, 10);
    
    // Put exact matches first, then fuzzy matches (max 10 fuzzy)
    // IMPORTANT: Keep ALL exact matches, don't limit them
    const allExactRows = exactRows; // Keep all exact matches
    const baseRows = [...allExactRows, ...limitedFuzzyRows];
    
    console.log(`[searchLegacyLeads] Base rows: ${baseRows.length} (${allExactRows.length} exact + ${limitedFuzzyRows.length} fuzzy)`);
    
    // Update contactLeadIds with all results
    baseRows.forEach(row => contactLeadIds.add(row.id));
    allExactRows.forEach(row => contactLeadIds.add(row.id));

    // Combine primaryMatches (from contact search) with baseRows
    // Remove duplicates, keeping exact matches first
    const primaryMatchIds = new Set(primaryMatches.map((r: any) => r.id));
    const uniqueBaseRows = baseRows.filter((r: any) => !primaryMatchIds.has(r.id));
    
    // Ensure exact matches are always included first
    // Limit fuzzy matches to exactly 10 as requested
    // Ensure ID comparison uses numbers
    const exactInBase = baseRows.filter((r: any) => exactIds.has(Number(r.id)));
    const fuzzyInBase = baseRows.filter((r: any) => !exactIds.has(Number(r.id))).slice(0, 10); // Strictly limit to 10
    
    // Get base IDs first to avoid circular reference
    const baseIdsFromRows = new Set<number>([...exactInBase, ...fuzzyInBase].map((row: any) => Number(row.id)));
    const primaryMatchesFiltered = primaryMatches.filter((r: any) => !exactIds.has(Number(r.id)) && !baseIdsFromRows.has(Number(r.id))).slice(0, Math.max(0, 10 - fuzzyInBase.length));
    const baseResults: any[] = [...exactInBase, ...fuzzyInBase, ...primaryMatchesFiltered];
    
    console.log(`[searchLegacyLeads] Base results: ${baseResults.length} (${exactInBase.length} exact + ${fuzzyInBase.length} fuzzy + ${primaryMatchesFiltered.length} primary)`);
    
    const baseIds = new Set<number>(baseResults.map((row: any) => row.id));

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

    // Limit total results: exact matches + max 10 fuzzy matches
    const allCombinedRows = Array.from(combinedMap.values());
    // Legacy leads have numeric IDs (as numbers or strings), new leads have L/C prefix
    const getNumericId = (id: any): number => {
      if (typeof id === 'number') return id;
      if (typeof id === 'string') {
        // If it's a string, try to parse it as a number (legacy leads are just numbers)
        const num = Number(id);
        if (!isNaN(num)) return num;
      }
      return Number(id);
    };
    // Ensure ID comparison uses numbers
    const exactInCombined = allCombinedRows.filter((r: any) => exactIds.has(getNumericId(r.id)));
    // Strictly limit fuzzy matches to 10
    const fuzzyInCombined = allCombinedRows
      .filter((r: any) => !exactIds.has(getNumericId(r.id)))
      .slice(0, 10); // Hard limit of 10 fuzzy results
    const combinedRows = [...exactInCombined, ...fuzzyInCombined];
    
    console.log(`[searchLegacyLeads] Final combined rows: ${combinedRows.length} (${exactInCombined.length} exact + ${fuzzyInCombined.length} fuzzy)`);
    console.log(`[searchLegacyLeads] Sample exact IDs in final:`, exactInCombined.slice(0, 5).map((r: any) => ({ id: r.id, name: r.name, numericId: getNumericId(r.id) })));
    console.log(`[searchLegacyLeads] All exact IDs in combinedRows (before transform):`, exactInCombined.map((r: any) => r.id).sort((a: number, b: number) => b - a));
    console.log(`[searchLegacyLeads] Looking for 192291 in exactInCombined:`, exactInCombined.some((r: any) => r.id === 192291 || getNumericId(r.id) === 192291));
    const combinedResults: CombinedLead[] = combinedRows.map(row => {
      const contactInfo = contactInfoMap.get(row.id) || null;
      const contactMatch = contactMatchMap.get(row.id);
      const isContactMatch = !!contactMatch;
      const isMainContact = contactMatch?.isMain || false;

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

      // If this is a contact match, use contact name; otherwise use lead name
      const displayName = isContactMatch && contactInfo?.name 
        ? contactInfo.name 
        : (row.name || contactInfo?.name || '');

      return {
        id: String(row.id), // Legacy leads use numeric ID as string, no prefix
        lead_number: leadNumber,
        manual_id: row.manual_id ? String(row.manual_id) : null,
        name: displayName,
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
        isContact: isContactMatch && !isMainContact,
        contactName: isContactMatch ? (contactInfo?.name || '') : undefined,
        isMainContact: isMainContact,
      };
    });

    // Sort by relevance first (exact matches first), then by date
    // Legacy leads have numeric IDs (as strings), new leads have L/C prefix
    // Define this BEFORE using it in sort
    const getNumericIdFromCombined = (id: string | number): number => {
      if (typeof id === 'number') return id;
      if (typeof id === 'string') {
        // Legacy leads are just numbers as strings, new leads have L/C prefix
        const num = Number(id);
        if (!isNaN(num)) return num;
      }
      return Number(id);
    };

    combinedResults.sort((a, b) => {
      const aIsExact = exactIds.has(getNumericIdFromCombined(a.id));
      const bIsExact = exactIds.has(getNumericIdFromCombined(b.id));
      
      // Exact matches first
      if (aIsExact && !bIsExact) return -1;
      if (bIsExact && !aIsExact) return 1;
      
      // Within exact matches, sort by date (newest first)
      if (aIsExact && bIsExact) {
        const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bDate - aDate;
      }
      
      // Within fuzzy matches, sort by date (newest first)
      const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bDate - aDate;
    });

    console.log('[searchLegacyLeads] Legacy results count', combinedResults.length);
    // Ensure ID comparison uses numbers
    const exactInFinal = combinedResults.filter((r: any) => exactIds.has(getNumericIdFromCombined(r.id)));
    console.log('[searchLegacyLeads] Exact matches in final results:', exactInFinal.length);
    console.log('[searchLegacyLeads] Sample exact match names:', exactInFinal.slice(0, 5).map((r: any) => ({ id: r.id, name: r.name, numericId: getNumericIdFromCombined(r.id) })));
    console.log('[searchLegacyLeads] All exact IDs in final (showing all, not limited):', exactInFinal.map((r: any) => r.id));
    console.log('[searchLegacyLeads] Looking for 192291 in final results:', exactInFinal.some((r: any) => getNumericIdFromCombined(r.id) === 192291));
    console.log('[searchLegacyLeads] Looking for 192191 in final results:', exactInFinal.some((r: any) => getNumericIdFromCombined(r.id) === 192191));
    return combinedResults;
  } catch (error) {
    console.error('Error searching legacy leads:', error);
    return [];
  }
}