// Search cache to avoid repeated queries
const searchCache = new Map<string, { results: CombinedLead[], timestamp: number }>();
const CACHE_DURATION = 30000; // 30 seconds cache

// Clear cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of searchCache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      searchCache.delete(key);
    }
  }
}, 60000); // Clean cache every minute

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

    // Check cache first
    const cacheKey = trimmedQuery.toLowerCase();
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      console.log('[searchLeads] Using cached results', { count: cached.results.length });
      return cached.results;
    }

    // Check if query looks like an email (contains @)
    const isEmailQuery = trimmedQuery.includes('@');
    
    // Check if query is a pure number - we'll search BOTH lead_number AND phone fields
    const isNumericQuery = hasOnlyDigits && numericQuery.length > 0;
    
    // For numeric queries, we search both lead_number/id AND phone fields
    // No need to distinguish - search everything!

    console.log('[searchLeads] Query received', { raw: query, trimmedQuery, numericQuery, isNumericQuery, isEmailQuery, digitsOnly, lastFiveDigits });

    // Search both tables in PARALLEL for speed
    const [newPromise, legacyPromise] = await Promise.allSettled([
      // Search new leads
      (async () => {
        let newQuery = supabase
          .from('leads')
          .select('id, lead_number, name, email, phone, mobile, topic, stage, created_at')
          .limit(10);
        
        if (isNumericQuery) {
          // Search both lead_number AND phone fields
          // For lead_number: search exact query, numeric part, and with L/C prefixes if no prefix given
          // For phone: use last 5 digits (works better across different phone formats)
          let leadNumberConditions = `lead_number.eq.${trimmedQuery}`;
          if (!hasLPrefix && !hasCPrefix) {
            // If no prefix, try with L and C prefixes too
            leadNumberConditions += `,lead_number.eq.L${numericQuery},lead_number.eq.C${numericQuery}`;
          }
          // Always also try without any prefix (numeric only)
          leadNumberConditions += `,lead_number.eq.${numericQuery}`;
          
          const phoneSearch = digitsOnly.length >= 5 
            ? `phone.ilike.%${lastFiveDigits}%,mobile.ilike.%${lastFiveDigits}%`
            : `phone.ilike.%${digitsOnly}%,mobile.ilike.%${digitsOnly}%`;
          
          return await newQuery.or(`${leadNumberConditions},${phoneSearch}`);
        } else if (isEmailQuery) {
          return await newQuery.ilike('email', `%${trimmedQuery}%`);
        } else {
          // For text, search name, topic, lead_number (with L/C prefix handling), AND phone fields
          // Try exact match first (fastest), then partial match
          const digitsInQuery = trimmedQuery.replace(/\D/g, '');
          const numericPart = trimmedQuery.replace(/^[LC]/i, '').replace(/\D/g, '');
          
          // Build lead_number search conditions
          let leadNumberSearch = `lead_number.ilike.${trimmedQuery}%`;
          if (numericPart.length > 0 && trimmedQuery !== numericPart) {
            // If there's a prefix, also try without prefix
            leadNumberSearch += `,lead_number.ilike.${numericPart}%`;
          }
          if (numericPart.length > 0 && !hasLPrefix && !hasCPrefix) {
            // If no prefix, also try with L and C
            leadNumberSearch += `,lead_number.ilike.L${numericPart}%,lead_number.ilike.C${numericPart}%`;
          }
          
          if (digitsInQuery.length >= 5) {
            // If query contains 5+ digits, also search phone fields
            return await newQuery.or(`name.ilike.${trimmedQuery}%,topic.ilike.${trimmedQuery}%,${leadNumberSearch},phone.ilike.%${digitsInQuery}%,mobile.ilike.%${digitsInQuery}%,name.ilike.%${trimmedQuery}%,topic.ilike.%${trimmedQuery}%`);
          } else {
            // Regular text search without phone
            return await newQuery.or(`name.ilike.${trimmedQuery}%,topic.ilike.${trimmedQuery}%,${leadNumberSearch},name.ilike.%${trimmedQuery}%,topic.ilike.%${trimmedQuery}%`);
          }
        }
      })(),
      
      // Search legacy leads with optimized queries (include stage join)
      (async () => {
        let legacyQuery = supabase
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
          .limit(10); // Limit to prevent slow queries
        
        if (isNumericQuery) {
          // For legacy leads, search BOTH id (lead_number) AND phone fields
          // id IS the lead_number in leads_lead table
          const numericValue = parseInt(numericQuery);
          // Search: exact id match OR phone contains last 5 digits
          // Using last 5 digits for phone (works better across different formats)
          const phoneSearch = digitsOnly.length >= 5 
            ? `phone.ilike.%${lastFiveDigits}%,mobile.ilike.%${lastFiveDigits}%`
            : `phone.ilike.%${digitsOnly}%,mobile.ilike.%${digitsOnly}%`;
          return await legacyQuery.or(`id.eq.${numericValue},${phoneSearch}`);
        } else if (isEmailQuery) {
          // Email search - exact or partial
          return await legacyQuery.ilike('email', `%${trimmedQuery}%`);
        } else {
          // Text search - search name, topic, AND phone fields
          // Try exact/prefix match first (uses text_pattern_ops index efficiently)
          const digitsInQuery = trimmedQuery.replace(/\D/g, '');
          if (digitsInQuery.length >= 5) {
            // If query contains 5+ digits, also search phone fields
            return await legacyQuery.or(`name.ilike.${trimmedQuery}%,topic.ilike.${trimmedQuery}%,phone.ilike.%${digitsInQuery}%,mobile.ilike.%${digitsInQuery}%,name.ilike.%${trimmedQuery}%,topic.ilike.%${trimmedQuery}%`);
          } else {
            // Regular text search without phone
            return await legacyQuery.or(`name.ilike.${trimmedQuery}%,topic.ilike.${trimmedQuery}%,name.ilike.%${trimmedQuery}%,topic.ilike.%${trimmedQuery}%`);
          }
        }
      })(),
    ]);
    
    // Process results from both tables
    const results: CombinedLead[] = [];
    
    // Process new leads
    if (newPromise.status === 'fulfilled' && newPromise.value.data) {
      const transformedNewLeads: CombinedLead[] = newPromise.value.data.map((lead: any) => ({
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
    
    // Process legacy leads
    if (legacyPromise.status === 'fulfilled' && legacyPromise.value.data) {
      const transformedLegacyLeads: CombinedLead[] = legacyPromise.value.data.map((lead: any) => {
        // Get stage name from joined table (LEFT JOIN returns array)
        const stageName = (lead.lead_stages as any)?.[0]?.name || String(lead.stage || '');
        
        return {
          id: `legacy_${lead.id}`,
          lead_number: String(lead.id), // In leads_lead, id IS the lead_number
          name: lead.name || '',
          email: lead.email || '',
          phone: lead.phone || '',
          mobile: lead.mobile || '',
          topic: lead.topic || '',
          stage: stageName,
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
        };
      });
      results.push(...transformedLegacyLeads);
    }
    
    // Remove duplicates (keep first occurrence)
    const uniqueResults = results.filter((lead, index, self) => 
      index === self.findIndex(l => l.id === lead.id)
    );
    
    // Cache the results
    searchCache.set(cacheKey, { results: uniqueResults, timestamp: Date.now() });
    
    console.log('[searchLeads] Returning results', { count: uniqueResults.length, new: newPromise.status === 'fulfilled' ? newPromise.value.data?.length || 0 : 0, legacy: legacyPromise.status === 'fulfilled' ? legacyPromise.value.data?.length || 0 : 0 });
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
    const lastFiveDigits = digitsOnly.slice(-5);

    // Check if query looks like a phone number
    const isPhoneQuery = lastFiveDigits.length === 5;
    
    // Check if query is a number for exact ID matching
    const isNumericQuery = !isPhoneQuery && !isNaN(Number(trimmedQuery));
    
    // Check if query looks like an email
    const isEmailQuery = trimmedQuery.includes('@');

    console.log('[searchLegacyLeads] Searching legacy leads', { isNumericQuery, isPhoneQuery, isEmailQuery, lastFiveDigits });

    let legacyQuery = supabase
      .from('leads_lead')
      .select('id, name, email, phone, mobile, topic, stage, cdate, lead_number')
      .limit(10); // Limit to prevent slow queries
    
    let legacyResults: any = { data: [] };
    
    try {
      if (isNumericQuery) {
        // For numeric queries, search by ID
        legacyResults = await legacyQuery.eq('id', parseInt(trimmedQuery));
      } else if (isPhoneQuery) {
        // For phone queries, match last 5 digits
        legacyResults = await legacyQuery.or(`phone.ilike.%${lastFiveDigits}%,mobile.ilike.%${lastFiveDigits}%`);
      } else if (isEmailQuery) {
        // For email queries, search email field
        legacyResults = await legacyQuery.ilike('email', `%${trimmedQuery}%`);
      } else {
        // For text queries, search name and topic only (simpler, faster)
        legacyResults = await legacyQuery.or(`name.ilike.%${trimmedQuery}%,topic.ilike.%${trimmedQuery}%`);
      }
    } catch (error) {
      console.log('[searchLegacyLeads] Legacy search error:', error);
    }
    
    // Transform legacy results
    const results: CombinedLead[] = [];
    if (legacyResults.data) {
      const transformedLegacyLeads: CombinedLead[] = legacyResults.data.map((lead: any) => ({
        id: `legacy_${lead.id}`,
        lead_number: String(lead.id),
        name: lead.name || '',
        email: lead.email || '',
        phone: lead.phone || '',
        mobile: lead.mobile || '',
        topic: lead.topic || '',
        stage: String(lead.stage || ''),
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
      }));
      results.push(...transformedLegacyLeads);
    }
    
    console.log('[searchLegacyLeads] Legacy results count', results.length);
    return results;

  } catch (error) {
    console.error('Error searching legacy leads:', error);
    return [];
  }
}