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
    
    // Distinguish between lead numbers and phone numbers:
    // - Lead numbers: short (typically < 10 digits) or have L/C prefix
    // - Phone numbers: long (>= 10 digits) without L/C prefix
    const isLikelyPhoneNumber = digitsOnly.length >= 10 && !hasLPrefix && !hasCPrefix;
    
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

        // For phone numbers (long numeric queries), prioritize phone search
        // For lead numbers (short numeric queries), prioritize lead number search
        const includePhoneSearch = isLikelyPhoneNumber || (digitsOnly.length >= 5 && !isPrefixedNumeric && !isNumericQuery);
        const phoneSearch = includePhoneSearch
          ? [
              `phone.ilike.%${lastFiveDigits}%`,
              `mobile.ilike.%${lastFiveDigits}%`,
            ]
          : [];
        
        // If it's a long phone number, also try full number
        if (isLikelyPhoneNumber && digitsOnly.length >= 7 && digitsOnly.length <= 15) {
          phoneSearch.push(`phone.ilike.%${digitsOnly}%`);
          phoneSearch.push(`mobile.ilike.%${digitsOnly}%`);
        }

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

      // For phone numbers, search by phone fields
      if (isLikelyPhoneNumber) {
        // Try last 5 digits
        if (lastFiveDigits.length >= 5) {
          conditions.add(`phone.ilike.%${lastFiveDigits}%`);
          conditions.add(`mobile.ilike.%${lastFiveDigits}%`);
        }
        // Also try full number if reasonable length
        if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
          conditions.add(`phone.ilike.%${digitsOnly}%`);
          conditions.add(`mobile.ilike.%${digitsOnly}%`);
        }
      } else if (digitsOnly.length >= 5 && !isPrefixedNumeric) {
        conditions.add(`phone.ilike.%${lastFiveDigits}%`);
        conditions.add(`mobile.ilike.%${lastFiveDigits}%`);
      }

      return await newQuery.or(Array.from(conditions).join(','));
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
        console.log('[searchLeads] Searching new leads contacts with filters:', contactFilters);
        
        // Step 1: Search leads_contact table directly (can't filter on nested tables)
        // Increase limit to ensure we get all matching contacts, especially for exact matches
        const { data: contactsData, error: contactsError } = await supabase
          .from('leads_contact')
          .select('id, name, email, phone, mobile')
          .or(contactFilters.join(','))
          .limit(100);
        
        if (contactsError) {
          console.warn('[searchLeads] New leads contact search error (step 1)', contactsError);
          return { data: [], error: contactsError };
        }
        
        console.log('[searchLeads] Found contacts:', contactsData?.length || 0);
        // Check if "Ron Decker" is in the found contacts
        const ronDeckerContact = contactsData?.find((c: any) => {
          const name = (c.name || '').toLowerCase();
          return name.includes('ron') && name.includes('decker');
        });
        console.log('[searchLeads] Ron Decker contact found in initial search:', ronDeckerContact ? {
          id: ronDeckerContact.id,
          name: ronDeckerContact.name,
          email: ronDeckerContact.email
        } : 'NOT FOUND');
        
        // Also check all contact names to see what we got
        const allContactNames = contactsData?.map((c: any) => `${c.id}: ${c.name}`).slice(0, 20);
        console.log('[searchLeads] First 20 contact names:', allContactNames);
        
        if (!contactsData || contactsData.length === 0) {
          console.log('[searchLeads] No contacts found for new leads');
          return { data: [], error: null };
        }
        
        // Step 2: Get contact IDs and fetch relationships with leads (both new and legacy)
        let contactIds = contactsData.map(c => c.id);
        console.log('[searchLeads] Searching for relationships for contact IDs:', contactIds.slice(0, 10), '... (total:', contactIds.length, ')');
        
        // If exact match contact not found, try a more specific search for the exact name
        // This helps when the contact exists but wasn't in the first 100 results due to ranking
        if (!ronDeckerContact && trimmedQuery.length >= 3) {
          console.log('[searchLeads] Trying exact name match search for:', trimmedQuery);
          try {
            const { data: exactMatchContacts, error: exactError } = await supabase
              .from('leads_contact')
              .select('id, name, email, phone, mobile')
              .ilike('name', trimmedQuery)
              .limit(10);
            
            if (!exactError && exactMatchContacts && exactMatchContacts.length > 0) {
              console.log('[searchLeads] Found exact match contacts:', exactMatchContacts.length);
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
            console.log('[searchLeads] Error in exact match search:', err);
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
            console.log('[searchLeads] Ron Decker contact relationship:', {
              contactId: contact.id,
              contactName: contact.name,
              relationship: relationship ? {
                contact_id: relationship.contact_id,
                newlead_id: relationship.newlead_id,
                lead_id: relationship.lead_id,
                main: relationship.main
              } : 'NO RELATIONSHIP FOUND'
            });
          });
        } else {
          // Also check contact ID 192970 directly if we know it exists
          const relationship192970 = allRelationships?.find((rel: any) => rel.contact_id === 192970);
          if (relationship192970) {
            console.log('[searchLeads] Found relationship for contact ID 192970:', relationship192970);
            // Fetch the contact directly
            try {
              const { data: contact192970, error: contactError } = await supabase
                .from('leads_contact')
                .select('id, name, email, phone, mobile')
                .eq('id', 192970)
                .single();
              
              if (!contactError && contact192970) {
                console.log('[searchLeads] Fetched contact 192970:', contact192970);
                contactsData.push(contact192970);
                // Re-fetch relationships if needed
                if (!contactIds.includes(192970)) {
                  contactIds.push(192970);
                }
              }
            } catch (err) {
              console.log('[searchLeads] Error fetching contact 192970:', err);
            }
          }
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
            console.log('[searchLeads] Fetched new leads:', newLeadsData.length);
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
            console.log('[searchLeads] Fetched legacy leads:', legacyLeadsData.length);
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
          } else {
            console.log('[searchLeads] Skipping new lead relationship - missing contact or lead:', { 
              hasContact: !!contact, 
              hasLead: !!lead, 
              contactId: rel.contact_id,
              newleadId: rel.newlead_id,
              contactName: contact?.name,
              leadName: lead?.name
            });
          }
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
          } else {
            console.log('[searchLeads] Skipping legacy lead relationship - missing contact or lead:', { 
              hasContact: !!contact, 
              hasLead: !!lead, 
              contactId: rel.contact_id,
              leadId: rel.lead_id,
              contactName: contact?.name,
              leadName: lead?.name
            });
          }
        });
        
        console.log('[searchLeads] Combined contact data:', combinedData.length);
        
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
        
        console.log('[searchLeads] Combined contact data (after sorting):', combinedData.length);
        // Log first few contact names to verify "Ron Decker" is in there
        const contactNames = combinedData.map((item: any) => item.leads_contact?.name || '').filter(Boolean);
        console.log('[searchLeads] Contact names found (first 20):', contactNames.slice(0, 20));
        const ronDeckerMatches = combinedData.filter((item: any) => {
          const name = (item.leads_contact?.name || '').toLowerCase();
          return name.includes('ron') && name.includes('decker');
        });
        console.log('[searchLeads] Ron Decker matches:', ronDeckerMatches.length, ronDeckerMatches.map((item: any) => ({
          name: item.leads_contact?.name,
          leadId: item.lead_id || item.newlead_id,
          leadType: item.lead_id ? 'legacy' : 'new',
          main: item.main
        })));
        
        // Return more results to ensure we don't miss matches
        return { data: combinedData.slice(0, 50), error: null };
      } catch (err) {
        console.error('[searchLeads] Error searching new leads contacts', err);
        return { data: [], error: err };
      }
    })();

    const [newResponse, legacyResults, newContactsResponse] = await Promise.all([
      newLeadsPromise,
      searchLegacyLeads(trimmedQuery),
      newContactsPromise,
    ]);
    
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
    console.log('[searchLeads] Checking new contacts response:', { 
      hasError: !!newContactsResponse.error, 
      hasData: !!newContactsResponse.data, 
      dataLength: newContactsResponse.data?.length || 0 
    });
    
    if (!newContactsResponse.error && newContactsResponse.data) {
      console.log('[searchLeads] Processing contacts:', newContactsResponse.data.length);
      console.log('[searchLeads] Sample contact data:', newContactsResponse.data.slice(0, 3).map((item: any) => ({
        contactName: item.leads_contact?.name,
        hasLeads: !!item.leads,
        hasLeadsLead: !!item.leads_lead,
        leadId: item.lead_id || item.newlead_id
      })));
      
      const contactResults: CombinedLead[] = newContactsResponse.data
        .filter((item: any) => {
          // Check for new lead (has leads) or legacy lead (has leads_lead)
          const hasNewLead = !!item.leads;
          const hasLegacyLead = !!item.leads_lead;
          const hasContact = !!item.leads_contact;
          const isValid = (hasNewLead || hasLegacyLead) && hasContact;
          
          if (!isValid) {
            console.log('[searchLeads] Filtering out item:', { hasNewLead, hasLegacyLead, hasContact, item });
          }
          return isValid;
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
              id: lead.id,
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
      
      console.log('[searchLeads] Processed contact results:', contactResults.length);
      results.push(...contactResults);
    } else {
      console.log('[searchLeads] No contacts to process:', { 
        error: newContactsResponse.error, 
        data: newContactsResponse.data 
      });
    }
    
    // Process legacy leads
    if (Array.isArray(legacyResults) && legacyResults.length > 0) {
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
            id: lead.id,
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
    
    // Remove duplicates (keep first occurrence)
    // Use a combination of lead id, contactName, and lead_type to identify unique contacts
    // This ensures contacts with the same name but different leads are both shown
    const uniqueResults = results.filter((lead, index, self) => {
      // For contacts, use contactName + lead id to distinguish them
      // For main leads, use just id
      const key = lead.isContact && lead.contactName
        ? `${lead.id}-${lead.contactName}-${lead.lead_type}`
        : `${lead.id}-${lead.lead_type}`;
      return index === self.findIndex(l => {
        const lKey = l.isContact && l.contactName
          ? `${l.id}-${l.contactName}-${l.lead_type}`
          : `${l.id}-${l.lead_type}`;
        return lKey === key;
      });
    });
    
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
    
    // Log Ron Decker in final results
    const ronDeckerInFinal = uniqueResults.filter(r => {
      const name = (r.contactName || r.name || '').toLowerCase();
      return name.includes('ron') && name.includes('decker');
    });
    console.log('[searchLeads] Ron Decker in final unique results:', ronDeckerInFinal.length, ronDeckerInFinal.map(r => ({
      id: r.id,
      name: r.name,
      contactName: r.contactName,
      lead_number: r.lead_number,
      lead_type: r.lead_type,
      isContact: r.isContact,
      position: uniqueResults.indexOf(r)
    })));
    
    console.log('[searchLeads] First 10 results after final sort:', uniqueResults.slice(0, 10).map(r => ({
      name: r.contactName || r.name,
      isContact: r.isContact,
      lead_number: r.lead_number
    })));
    
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
    // Distinguish between lead numbers and phone numbers:
    // - Lead numbers: short (typically < 10 digits) or have letter prefix
    // - Phone numbers: long (>= 10 digits) without letter prefix
    const isLikelyPhoneNumber = digitsOnly.length >= 10 && !leadNumberLike;
    const shouldSearchPhones = isLikelyPhoneNumber || (digitsOnly.length >= 5 && !leadNumberLike && !isEmailQuery);
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
        const normalizePattern = (value: string) =>
          value
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .join('%');
        
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
        id: `legacy_${row.id}`,
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